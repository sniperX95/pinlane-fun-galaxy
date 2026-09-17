// UN MAIL QUI ARRIVE S AFFICHE TOUT SEUL, SANS QUE PERSONNE NE RECHARGE.
//
// Ce que ce gate mesure, et pourquoi il existe.
//
// La decision « faut-il recharger ? » est deja mesuree ailleurs, en Node, sur une
// horloge controlee (ops-live-check). Ca ne prouve RIEN sur la vraie page : il
// restait tout le cablage entre ce module et l ecran, et c est exactement la que
// ca a casse la premiere fois. Movsar a du recharger a la main pour voir un mail
// arrive, alors que le module etait vert.
//
// Ce gate-ci pilote donc la VRAIE page dans un vrai navigateur, fait arriver un
// mail cote serveur, et regarde l ecran. Sans jamais recharger.
//
// LES QUATRE PROPRIETES :
//
//   [A] LA PAGE PART D UN ETAT CONNU. Sans ce point de depart affiche, tout ce
//       qui suit mesurerait une page vide.
//
//   [B] UN MAIL QUI ARRIVE APPARAIT TOUT SEUL. C est la demande, mot pour mot :
//       « faut que ce soit instant, la je dois recharger, c est relou a mort ».
//
//   [C] ET LA PAGE N A PAS ETE RECHARGEE POUR AUTANT. Un temoin est pose dans la
//       page AVANT l arrivee du mail : s il survit, aucun rechargement n a eu
//       lieu et c est bien la synchronisation qui a travaille. Sans ce temoin,
//       [B] serait vert meme si le navigateur avait tout recharge.
//
//   [D] QUAND RIEN NE BOUGE, RIEN N EST REDEMANDE. Le pouls est lu souvent, mais
//       les donnees lourdes ne sont rechargees que lorsque l empreinte change.
//       Sans ce controle, on aurait remplace « jamais de mise a jour » par
//       « toute la console rechargee en boucle ».
//
// Usage : node scripts/live-refresh-check.js
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_LIVE_PORT || 4231);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

let failures = 0;
function ok(cond, label, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures += 1;
  return cond;
}

function serveStatic() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname === '') filePath = path.join(ROOT, 'index.html');
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(content);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

const MOI = 'membre-qa';

async function installMock(page) {
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await page.addInitScript(({ expiresAt, moi }) => {
    const perms = ['dashboard.view', 'planning.view', 'reservations.view', 'clients.view', 'emails.view', 'emails.send', 'campaigns.manage', 'settings.manage', 'direction.view'];
    const qaSession = { token: 'qa', cookieBacked: false, centerId: 'libramont', expiresAt, member: { id: moi, name: 'Moi QA', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };

    function mailRecu(id, from, subject, texte) {
      return {
        id, centerId: 'libramont', channel: 'email', direction: 'inbound', status: 'received',
        templateId: null, recipient: from, subject,
        createdAt: new Date().toISOString(),
        payload: {
          from, textBody: texte,
          analysis: {
            intent: 'autre', intentLabel: 'Autre', summary: texte.slice(0, 60),
            urgency: 'normale', provider: 'rules',
            reply: { subject: `Re: ${subject}`, body: 'Bonjour,' },
          },
        },
      };
    }

    // L etat SERVEUR, pilotable depuis le test : au depart un seul mail.
    window.__QA_SERVEUR__ = {
      comms: [mailRecu(41, 'marie@exemple.be', 'Anniversaire samedi', 'Bonjour, avez-vous de la place samedi ?')],
      empreinte: 'depart',
      // Combien de fois les DONNEES LOURDES ont ete demandees, et combien de
      // fois le POULS a ete lu. C est leur ecart qui prouve l economie.
      lecturesLourdes: 0,
      lecturesPouls: 0,
      // Depuis la refonte v4 (2026-09-17), la page Recus lit des CONVERSATIONS
      // (action emailThreads) derivees des memes mails : elles aussi doivent
      // etre relues quand l empreinte change, et seulement dans ce cas.
      lecturesFils: 0,
    };
    window.__QA_FAIRE_ARRIVER_UN_MAIL__ = function () {
      const s = window.__QA_SERVEUR__;
      s.comms = [mailRecu(42, 'nouveau@exemple.be', 'Je peux amener mon gateau ?', 'Bonjour, est-ce que je peux amener mon propre gateau ?')].concat(s.comms);
      s.empreinte = 'apres-le-mail';
    };

    const nf = window.fetch.bind(window);
    const J = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      let u;
      try { u = new URL(url, location.origin); } catch (e) { return nf(input, init); }
      if (!u.pathname.startsWith('/api/')) return nf(input, init);
      const s = window.__QA_SERVEUR__;
      const method = String((init && init.method) || 'GET').toUpperCase();
      if (method === 'POST' && u.pathname === '/api/ops') return J({ ok: true });
      if (u.pathname === '/api/staff-auth') {
        return J({
          ok: true, authenticated: true, session: qaSession,
          accessControl: {
            selectedRoleId: 'direction', selectedMemberId: moi,
            roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: perms }],
            members: [{ id: moi, name: 'Moi QA', contact: 'moi@x', roleId: 'direction', status: 'active', code: 'X', lastSeen: new Date().toISOString() }],
            events: [], permissions: perms,
          },
        });
      }
      const action = u.searchParams.get('action');
      if (u.pathname === '/api/ops' && action === 'pulse') {
        s.lecturesPouls += 1;
        return J({ ok: true, empreinte: s.empreinte });
      }
      if (u.pathname === '/api/ops' && action === 'emailThreads') {
        s.lecturesFils += 1;
        const threads = s.comms.filter((c) => c.direction === 'inbound').map((c) => ({
          id: c.id, centerId: 'libramont', contactEmail: c.recipient, contactName: '', subject: c.subject, status: 'open', origin: 'inbound',
          messageCount: 1, inboundCount: 1, outboundCount: 0, firstMessageAt: c.createdAt, lastMessageAt: c.createdAt, lastInboundAt: c.createdAt, lastOutboundAt: null,
          lastDirection: 'inbound', snippet: String(c.payload.textBody || '').slice(0, 120), lastInboundId: c.id, luParMoi: false, lecteurs: [], prise: null,
          intention: c.payload.analysis ? c.payload.analysis.intent : '', question: false, reponduPar: null,
        }));
        return J({ ok: true, threads, total: threads.length });
      }
      if (u.pathname === '/api/ops' && action === 'emailClaims') return J({ ok: true, claims: [] });
      if (u.pathname === '/api/ops' && action === 'communications') {
        s.lecturesLourdes += 1;
        return J({ ok: true, communications: s.comms });
      }
      if (u.pathname === '/api/ops' && action === 'emailStudio') return J({ ok: true, templates: [], identities: [{ id: 1, label: 'Accueil', email: 'contact@fungalaxy.be', isDefault: true }], channel: { resendConfigured: true, aiConfigured: false } });
      if (u.pathname === '/api/ops') return J({ ok: true, communications: s.comms, samples: [], suggestions: [], events: [], claims: [], settings: {}, defaults: {}, sequences: [], overrides: {}, stats: {} });
      if (u.pathname === '/api/simulation') return J({ ok: true, status: 'idle', simulation: null });
      return nf(input, init);
    };
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession));
  }, { expiresAt, moi: MOI });
}

async function texteDeLaPage(page) {
  return page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
}

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  try {
    await installMock(page);
    await page.goto(`${BASE_URL}/?v=live-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
    await page.evaluate(() => { state.staffMenuPage = 'emails'; state.staffTheme = 'dark'; save(); setView('staff'); renderStaff(); });
    await page.waitForTimeout(1200);
    // La section Recus : les conversations, comme un membre de l equipe les lit.
    await page.evaluate(() => { if (typeof pv2EmailsGo === 'function') pv2EmailsGo('recus'); });
    await page.waitForTimeout(400);

    // =====================================================================
    console.log('[A] la page part d un etat connu');
    // =====================================================================
    const cableEnPlace = await page.evaluate(() => ({
      module: typeof window.creerSynchroLive === 'function',
      boucle: typeof window.synchroniserLaConsole === 'function',
      chargeur: typeof window.loadOpsAdmin === 'function',
      surEmails: typeof window.isStaffEmailsActive === 'function' ? window.isStaffEmailsActive() : null,
      page: typeof window.pageActiveDeLaConsole === 'function' ? window.pageActiveDeLaConsole(window) : 'inconnu',
    }));
    ok(cableEnPlace.module && cableEnPlace.boucle, '[A] le module de synchronisation est bien charge dans la page', JSON.stringify(cableEnPlace));
    ok(cableEnPlace.page === 'emails', '[A] et il reconnait la page Emails comme active (sinon il ne lirait jamais rien)', cableEnPlace.page);
    const depart = await texteDeLaPage(page);
    ok(/Anniversaire samedi/.test(depart), '[A] le mail de depart est affiche');
    ok(!/Je peux amener mon gateau/.test(depart), '[A] et le mail qui n est pas encore arrive n y est pas');

    // =====================================================================
    console.log('\n[D] quand rien ne bouge, rien n est redemande');
    // =====================================================================
    const avant = await page.evaluate(() => ({ ...window.__QA_SERVEUR__, comms: undefined }));
    await page.waitForTimeout(9000);
    const apresRepos = await page.evaluate(() => ({ ...window.__QA_SERVEUR__, comms: undefined }));
    ok(apresRepos.lecturesPouls > avant.lecturesPouls,
      '[D] le pouls est bien lu pendant ce temps (la boucle tourne vraiment)',
      `${avant.lecturesPouls} -> ${apresRepos.lecturesPouls} lectures`);
    ok(apresRepos.lecturesLourdes === avant.lecturesLourdes,
      '[D] et les donnees lourdes ne sont PAS redemandees tant que rien ne bouge',
      `${avant.lecturesLourdes} -> ${apresRepos.lecturesLourdes}`);
    ok(avant.lecturesFils > 0 && apresRepos.lecturesFils === avant.lecturesFils,
      '[D] les conversations ont ete lues une fois, et ne sont PAS relues tant que rien ne bouge',
      `${avant.lecturesFils} -> ${apresRepos.lecturesFils}`);

    // =====================================================================
    console.log('\n[B] un mail qui arrive apparait tout seul');
    // =====================================================================
    // LE TEMOIN : pose AVANT, il ne survit a aucun rechargement de page.
    await page.evaluate(() => { window.__QA_TEMOIN__ = 'pose-avant-le-mail'; });
    await page.evaluate(() => window.__QA_FAIRE_ARRIVER_UN_MAIL__());
    let vu = false;
    for (let i = 0; i < 20 && !vu; i += 1) {
      await page.waitForTimeout(1000);
      vu = /Je peux amener mon gateau/.test(await texteDeLaPage(page));
    }
    ok(vu, '[B] le mail arrive s affiche SANS que personne ne recharge la page');
    const apresMail = await page.evaluate(() => ({ ...window.__QA_SERVEUR__, comms: undefined }));
    ok(apresMail.lecturesLourdes > apresRepos.lecturesLourdes,
      '[B] et il a bien fallu recharger les donnees pour ca (l empreinte avait change)',
      `${apresRepos.lecturesLourdes} -> ${apresMail.lecturesLourdes}`);
    ok(apresMail.lecturesFils > apresRepos.lecturesFils,
      '[B] et les conversations ont ete relues aussi (sinon Recus resterait fige)',
      `${apresRepos.lecturesFils} -> ${apresMail.lecturesFils}`);

    // =====================================================================
    console.log('\n[C] et la page n a pas ete rechargee pour autant');
    // =====================================================================
    const temoin = await page.evaluate(() => window.__QA_TEMOIN__ || '(disparu)');
    ok(temoin === 'pose-avant-le-mail',
      '[C] le temoin pose avant l arrivee du mail a survecu : aucun rechargement de page', temoin);

    if (errs.length) console.log('\nErreurs console :\n' + errs.slice(0, 5).join('\n'));
    console.log(failures ? `\n${failures} controle(s) en echec.` : '\nlive-refresh-check: ALL OK');
  } finally {
    await browser.close();
    server.close();
  }
  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  console.error('FAIL  gate interrompu :', error && error.stack || error);
  process.exit(1);
});

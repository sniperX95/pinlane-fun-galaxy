// LE PARCOURS DE RESERVATION NE DOIT JAMAIS APPARAITRE SUR LA CONSOLE.
//
// Defaut rapporte par le proprietaire (capture du 2026-08-06) : en rechargeant
// app.pinlane.be/#/staff/emails, le PARCOURS CLIENT s'affichait 1 a 2 secondes
// avant la console. Deux causes cumulees :
//   1. #clientView est la seule vue peinte par le HTML (staffView et adminView
//      naissent .hidden) : le navigateur la montre des la premiere peinture ;
//   2. setView() vivait APRES le controle de session et deux synchros reseau
//      (bootstrapApp), donc la bascule attendait le serveur.
//
// Ce gate ne regarde pas le code : il ECHANTILLONNE L'ECRAN. Un observateur
// pose AVANT tout script du bundle (addInitScript) releve a chaque frame si le
// parcours est visible. Une seule frame visible = rouge. La contre-preuve est
// dans le meme fichier : on rejoue la page en neutralisant le drapeau de
// demarrage, et le gate DOIT rougir (sinon il ne prouve rien).
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_BOOT_PORT || 4231);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

// Le serveur RALENTIT volontairement les scripts du bundle et les appels API.
// Sans cela, la machine de test avale tout en quelques millisecondes et le
// flash n'a pas le temps d'exister : le gate serait vert sans rien prouver.
// C'est la condition reelle du proprietaire (bundle lourd + reseau) reproduite.
const SCRIPT_DELAY_MS = Number(process.env.PINLANE_BOOT_SCRIPT_DELAY || 260);

function serveStatic() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname === '') filePath = path.join(ROOT, 'index.html');
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      const send = () => {
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(content);
      };
      if (path.extname(filePath).toLowerCase() === '.js') setTimeout(send, SCRIPT_DELAY_MS);
      else send();
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

// L'observateur est injecte AVANT le premier script de la page : il voit donc
// la toute premiere peinture, celle que personne ne mesure jamais.
async function installProbe(page, { neutralizeBootFlag = false } = {}) {
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await page.addInitScript(({ expiresAt, neutralizeBootFlag }) => {
    const perms = ['dashboard.view', 'planning.view', 'reservations.view', 'clients.view', 'emails.view', 'emails.send', 'campaigns.manage', 'marketing.agents', 'settings.manage', 'direction.view'];
    const qaSession = { token: 'qa', cookieBacked: false, centerId: 'libramont', expiresAt, member: { id: 'qa', name: 'QA', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession));
    window.localStorage.setItem('funGalaxy_v4', JSON.stringify({ view: 'staff', staffMenuPage: 'emails' }));

    // CONTRE-PREUVE : on rend le drapeau de demarrage inoperant (comme avant le
    // correctif). Le flash doit alors reapparaitre et le gate rougir.
    if (neutralizeBootFlag) {
      const realSet = Element.prototype.setAttribute;
      Element.prototype.setAttribute = function (name, value) {
        if (this === document.documentElement && name === 'data-boot') return;
        return realSet.call(this, name, value);
      };
    }

    // Le relevé : a chaque frame, le parcours est-il reellement visible ?
    // On lit la geometrie ET le style calcule : un noeud present mais couvert
    // par le voile ne compte pas comme visible.
    const probe = { frames: 0, clientVisible: 0, firstClientAt: -1, staffAt: -1, t0: performance.now() };
    window.__BOOT_PROBE__ = probe;
    const veiled = () => {
      const style = getComputedStyle(document.documentElement, '::before');
      return document.documentElement.getAttribute('data-boot') === 'app'
        && style && style.content !== 'none' && style.position === 'fixed';
    };
    const visible = (el) => {
      if (!el) return false;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 40 && r.height > 40 && r.top < window.innerHeight;
    };
    const tick = () => {
      probe.frames += 1;
      const client = document.getElementById('clientView');
      const staff = document.getElementById('staffView');
      if (visible(client) && !veiled()) {
        probe.clientVisible += 1;
        if (probe.firstClientAt < 0) probe.firstClientAt = Math.round(performance.now() - probe.t0);
      }
      if (probe.staffAt < 0 && visible(staff)) probe.staffAt = Math.round(performance.now() - probe.t0);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    // Reseau simule, LENT : c'est ce qui retardait setView() en production.
    const J = (p) => new Response(JSON.stringify(p), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
    const slow = (payload) => new Promise((resolve) => setTimeout(() => resolve(J(payload)), 700));
    const lanes = () => Array.from({ length: 8 }).reduce((a, _, i) => { a[i + 1] = 'active'; return a; }, {});
    const nf = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const u = new URL(raw, window.location.origin);
      if (u.pathname === '/api/staff-auth') return slow({ ok: true, authenticated: true, session: qaSession, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: perms }], members: [{ id: 'qa', name: 'QA', contact: 'q@x', roleId: 'direction', status: 'active', code: 'X', lastSeen: new Date().toISOString() }], events: [], permissions: perms } });
      if (u.pathname === '/api/staff-state') return slow({ ok: true, revision: 'qa', reservations: [], laneStatuses: lanes(), centerId: 'libramont' });
      if (u.pathname === '/api/admin-range') return slow({ ok: true, reservations: [], emails: [], agentEvents: [], centerId: 'libramont' });
      if (u.pathname === '/api/public-booking-meta') return slow({ ok: true, today: new Date().toISOString().slice(0, 10), durationOptions: [], formules: [], center: { id: 'libramont', status: 'active', defaultSchedule: { regular: {}, holiday: {} }, holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] }, offerAvailability: {} } });
      if (u.pathname.startsWith('/api/')) return slow({ ok: true });
      return nf(input, init);
    };
  }, { expiresAt, neutralizeBootFlag });
}

let failures = 0;
function ok(cond, label) { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`); if (!cond) failures += 1; return cond; }

async function measure(browser, opts) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await installProbe(page, opts);
  await page.goto(`${BASE_URL}/#/staff/emails`, { waitUntil: 'load', timeout: 45000 });
  // On laisse vivre le demarrage complet (auth + synchros simulees lentes),
  // PLUS la fenetre du filet de re-rendu post-chargement.
  await page.waitForTimeout(3400);
  const probe = await page.evaluate(() => window.__BOOT_PROBE__);
  probe.pageFilled = await page.evaluate(() => {
    const el = document.getElementById('staffEmailsPage');
    return Boolean(el && el.children.length > 0 && el.textContent.trim().length > 40);
  });
  await page.close();
  return probe;
}

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    console.log('\n[RECHARGEMENT SUR #/staff/emails] le parcours de reservation ne doit JAMAIS se voir');
    const run = await measure(browser, {});
    ok(run.frames > 30, `l'ecran a bien ete echantillonne (${run.frames} frames relevees)`);
    ok(run.staffAt >= 0, `la console finit par s'afficher (a ${run.staffAt} ms)`);
    ok(run.clientVisible === 0,
      `AUCUNE frame ne montre le parcours de reservation (${run.clientVisible} frame(s) fautive(s)${run.firstClientAt >= 0 ? `, la premiere a ${run.firstClientAt} ms` : ''})`);
    // LA PAGE ACTIVE A DU CONTENU (bug « la page reste noire, on recharge »,
    // 2026-08-06) : setView anticipe pouvait appeler renderStaff AVANT que
    // staff-pages-v2.js (defer, charge apres app-main, ici RALENTI expres) ne
    // definisse le rendu des pages : ReferenceError, page vide a vie. Le
    // harnais lent reproduit la course ; cette assertion la verrouille.
    ok(run.pageFilled === true,
      'la page staff ACTIVE porte du contenu (jamais une zone noire qui exige un rechargement)');

    /* ══ CONTRE-PREUVE ══════════════════════════════════════════════════════
       Un gate qui ne sait pas rougir ne prouve rien. On rejoue exactement la
       meme page en neutralisant le drapeau de demarrage : le defaut d'origine
       revient, et ces memes assertions doivent tomber. */
    console.log('\n[CONTRE-PREUVE] drapeau de demarrage neutralise : le defaut doit REVENIR');
    const broken = await measure(browser, { neutralizeBootFlag: true });
    ok(broken.clientVisible > 0,
      `sans le drapeau, le parcours redevient visible (${broken.clientVisible} frame(s), premiere a ${broken.firstClientAt} ms) : le gate sait rougir`);
  } catch (error) {
    console.error('\nboot-flash-check FAIL:', error.stack || error.message);
    failures += 1;
  } finally {
    await browser.close();
    server.close();
  }
  if (failures) { console.error(`\nboot-flash-check: ${failures} FAIL`); process.exit(1); }
  console.log('\nboot-flash-check: ALL OK - la console ne montre jamais le parcours de reservation.');
}

main();

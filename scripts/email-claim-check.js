// DEUX PERSONNES NE REPONDENT PAS AU MEME MAIL SANS LE SAVOIR.
//
// Ce que ce gate mesure, et pourquoi.
//
// La boite d un centre est ouverte par plusieurs personnes en meme temps. Avant
// ce travail, chacune redigeait sa reponse sans aucune idee que l autre
// redigeait la sienne : le client recevait deux reponses, parfois
// contradictoires, et personne au centre ne s en apercevait. La synchronisation
// vivante de la console ne suffit pas a l eviter : elle montre une reponse une
// fois PARTIE, pas pendant qu on l ecrit.
//
// La reponse est une PRISE DE MAIN, consultative : « untel repond a ce
// message ». Elle previent, elle n interdit pas, parce que la personne devant
// l ecran sait des choses que le produit ignore (le collegue vient de partir,
// il a demande de reprendre).
//
// Playwright pilote la VRAIE page, avec de vrais evenements de frappe : c est
// la seule facon de prouver qu une pastille apparait au bon moment et qu une
// prise part quand quelqu un commence a ecrire.
//
// LES HUIT PROPRIETES :
//
//   [A] SANS PRISE, RIEN NE S AFFICHE. Une pastille permanente serait du bruit,
//       et le bruit finit par ne plus etre lu.
//
//   [B] ECRIRE PREND LA MAIN, LIRE NON. La prise part au PREMIER CARACTERE, pas
//       a l ouverture du mail : consulter un message n est pas y repondre, et
//       prendre la main en lisant bloquerait des collegues pour rien.
//
//   [G] OUVRIR UN MAIL, C EST S EN OCCUPER. Demande explicite : « des que
//       quelqu un ouvre et donc s occupe du mail, on voit ». C est le rythme de
//       travail reel : on ouvre un message parce qu on va le traiter, et le
//       collegue doit le savoir tout de suite, pas au moment ou la reponse est
//       deja a moitie ecrite. La prise expire seule en trois minutes, donc
//       parcourir la boite ne bloque personne durablement.
//
//   [H] LE FONDATEUR NE POSE JAMAIS DE PRISE. Il ouvre des mails pour regarder
//       comment tourne le produit : afficher « le fondateur s occupe de ce
//       message » ferait attendre une equipe pour rien, et l habituerait a
//       ignorer la pastille le jour ou elle compte.
//
//   [C] LA PRISE D UN AUTRE SE VOIT, AVEC SON NOM ET SON ROLE. « Quelqu un
//       repond » ne sert a rien : on ne sait pas a qui parler. Et dans un centre
//       ou plusieurs personnes se relaient, savoir que c est la DIRECTION qui
//       repond, et pas un equipier du bar, change ce qu on fait ensuite. « Quelqu un repond » ne sert
//       a rien : on ne sait pas a qui parler. Le nom, et depuis quand.
//
//   [D] MA PROPRE PRISE NE M ALERTE PAS. S alerter soi-meme apprendrait a
//       ignorer la pastille, et elle ne servirait plus quand elle compte.
//
//   [E] UNE PRISE EXPIREE NE BLOQUE PLUS RIEN. Un onglet ferme, un navigateur
//       qui plante, une pause : le mail doit redevenir libre tout seul. C est
//       pour ca que la prise porte une date d expiration et pas un verrou.
//
//   [F] ENVOYER LIBERE LA MAIN. Garder la prise apres l envoi ferait croire a
//       un collegue que quelqu un ecrit encore, sur un mail deja traite.
//
// Usage : node scripts/email-claim-check.js
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_CLAIM_PORT || 4219);
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

// L identifiant de MA session dans le gate : c est lui qui separe « ma prise »
// de « celle d un autre ».
const MOI = 'membre-qa';

async function installMock(page) {
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await page.addInitScript(({ expiresAt, moi }) => {
    const perms = ['dashboard.view', 'planning.view', 'reservations.view', 'clients.view', 'emails.view', 'emails.send', 'campaigns.manage', 'settings.manage', 'direction.view'];
    const qaSession = { token: 'qa', cookieBacked: false, centerId: 'libramont', expiresAt, member: { id: moi, name: 'Moi QA', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };

    // Le mail recu sur lequel tout se joue.
    const comms = [{
      id: 42, centerId: 'libramont', channel: 'email', direction: 'inbound', status: 'received',
      templateId: null, recipient: 'marie@exemple.be', subject: 'Anniversaire samedi',
      createdAt: new Date(Date.now() - 600e3).toISOString(),
      payload: {
        from: 'marie@exemple.be',
        textBody: 'Bonjour, avez-vous de la place samedi pour huit enfants ?',
        analysis: {
          intent: 'anniversaire', intentLabel: 'Anniversaire',
          summary: 'Demande une place samedi pour huit enfants',
          urgency: 'normale', provider: 'rules', clientName: 'Marie',
          reply: { subject: 'Re: Anniversaire samedi', body: 'Bonjour Marie,\n\nOui, nous avons de la place.' },
        },
      },
    }];

    // L etat des prises, pilotable depuis le test.
    window.__QA_CLAIMS__ = [];
    window.__QA_APPELS__ = { claim: [], release: [], send: [] };

    const nf = window.fetch.bind(window);
    const J = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      // On decide sur le CHEMIN, pas sur la forme de l URL : le code appelant
      // utilise tantot "/api/ops", tantot une URL absolue de meme origine.
      // Ne reconnaitre que la forme relative laissait passer des appels au
      // vrai serveur, qui repond 404, et la session etait effacee.
      let u;
      try { u = new URL(url, location.origin); } catch (e) { return nf(input, init); }
      if (!u.pathname.startsWith('/api/')) return nf(input, init);
      const method = String((init && init.method) || 'GET').toUpperCase();
      if (method === 'POST' && u.pathname === '/api/ops') {
        const b = JSON.parse((init && init.body) || '{}');
        if (b.action === 'claimInboundEmail') {
          window.__QA_APPELS__.claim.push(b.communicationId);
          return J({ ok: true, claim: { communicationId: b.communicationId, memberId: moi, memberName: 'Moi QA', claimedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 180e3).toISOString() } });
        }
        if (b.action === 'releaseInboundEmail') {
          window.__QA_APPELS__.release.push(b.communicationId);
          return J({ ok: true });
        }
        if (b.action === 'sendDirectEmail') {
          window.__QA_APPELS__.send.push(b);
          return J({ ok: true, communication: { id: 99 } });
        }
        return J({ ok: true });
      }
      // SANS CETTE REPONSE, LE GATE SE FAIT DECONNECTER. L application valide
      // la session stockee aupres du serveur au demarrage ; un 404 la fait
      // effacer, et la page affiche l ecran de connexion. Tout le reste du gate
      // mesurerait alors une page vide en croyant mesurer la boite mail.
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
      if (u.pathname === '/api/ops' && action === 'emailClaims') return J({ ok: true, claims: window.__QA_CLAIMS__ });
      if (u.pathname === '/api/ops' && action === 'pulse') return J({ ok: true, empreinte: window.__QA_EMPREINTE__ || 'stable' });
      if (u.pathname === '/api/ops' && action === 'communications') return J({ ok: true, communications: comms });
      if (u.pathname === '/api/ops' && action === 'emailStudio') return J({ ok: true, templates: [], identities: [{ id: 1, label: 'Accueil', email: 'contact@fungalaxy.be', isDefault: true }], channel: { resendConfigured: true, aiConfigured: false } });
      if (u.pathname === '/api/ops') return J({ ok: true, communications: comms, samples: [], suggestions: [], events: [], claims: window.__QA_CLAIMS__, settings: {}, defaults: {}, sequences: [], overrides: {}, stats: {} });
      if (u.pathname === '/api/simulation') return J({ ok: true, status: 'idle', simulation: null });
      // Tout le reste part au vrai reseau, comme dans le harnais de la page
      // Emails : repondre « ok » a une route inconnue (la session staff, par
      // exemple) fabriquerait une reponse valide mais vide, et l application se
      // deconnecterait sans que le gate sache pourquoi.
      return nf(input, init);
    };
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession));
  }, { expiresAt, moi: MOI });
}

// Le detail du mail recu, ouvert : c est la qu on tape et que la pastille vit.
async function ouvrirLeMail(page) {
  await page.evaluate(() => {
    if (typeof pv2EmailFilter === 'function') pv2EmailFilter('inbound');
  });
  await page.waitForTimeout(250);
  const uid = await page.evaluate(() => {
    const rows = typeof getStaffEmailRows === 'function' ? getStaffEmailRows() : [];
    const cible = rows.find((r) => Number(r.id) === 42);
    if (cible && typeof pv2SelectEmail === 'function') pv2SelectEmail(cible.uid);
    else if (cible) { pv2Mail.selected = cible.uid; renderStaffEmailsPage(); }
    return cible ? cible.uid : '';
  });
  await page.waitForTimeout(250);
  return uid;
}

async function texteDuBandeau(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.pv2-prise-alerte');
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
  });
}

async function poserPrise(page, { memberId, memberName, memberRole = '', ilYaMinutes = 0, expireeDepuisMinutes = 0 }) {
  await page.evaluate(({ memberId, memberName, memberRole, ilYaMinutes, expireeDepuisMinutes }) => {
    window.__QA_CLAIMS__ = [{
      communicationId: 42,
      centerId: 'libramont',
      memberId,
      memberName,
      memberRole,
      claimedAt: new Date(Date.now() - ilYaMinutes * 60000).toISOString(),
      expiresAt: new Date(Date.now() + (expireeDepuisMinutes ? -expireeDepuisMinutes * 60000 : 180000)).toISOString(),
    }];
    if (typeof opsAdminCache === 'object' && opsAdminCache) opsAdminCache.claims = window.__QA_CLAIMS__;
    if (typeof renderStaffEmailsPage === 'function') renderStaffEmailsPage();
  }, { memberId, memberName, memberRole, ilYaMinutes, expireeDepuisMinutes });
  await page.waitForTimeout(200);
}

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  try {
    await installMock(page);
    await page.goto(`${BASE_URL}/?v=claim-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
    await page.evaluate(() => { state.staffMenuPage = 'emails'; state.staffTheme = 'dark'; save(); setView('staff'); renderStaff(); });
    await page.waitForTimeout(900);
    await page.waitForFunction(() => typeof opsAdminCache !== 'undefined' && (opsAdminCache.communications || []).length > 0, null, { timeout: 10000 }).catch(() => {});

    const uid = await ouvrirLeMail(page);
    ok(Boolean(uid), 'le mail recu est ouvert (la situation est montee)', uid);
    const champVisible = await page.evaluate(() => Boolean(document.querySelector('.pv2-inbox-reply-body')));
    ok(champVisible, 'le champ de reponse est a l ecran : la suite mesure quelque chose de reel');

    // =====================================================================
    console.log('\n[A] sans prise, rien ne s affiche');
    // =====================================================================
    ok((await texteDuBandeau(page)) === '', '[A] aucune pastille quand personne ne repond', await texteDuBandeau(page));

    // =====================================================================
    console.log('\n[G] ouvrir un mail, c est s en occuper');
    // =====================================================================
    // Le mail a ete ouvert plus haut par ouvrirLeMail() : la prise doit deja
    // etre partie, AVANT la moindre frappe.
    const alOuverture = await page.evaluate(() => window.__QA_APPELS__.claim.slice());
    ok(alOuverture.length >= 1 && Number(alOuverture[0]) === 42,
      '[G] ouvrir le mail a suffi a poser la prise, sans taper un seul caractere', JSON.stringify(alOuverture));

    // =====================================================================
    console.log('\n[B] ecrire ne pose pas une deuxieme prise');
    // =====================================================================
    const avantFrappe = await page.evaluate(() => window.__QA_APPELS__.claim.length);
    await page.click('.pv2-inbox-reply-body');
    await page.keyboard.type('Bonjour Marie, ');
    await page.waitForTimeout(400);
    const apresFrappe = await page.evaluate(() => window.__QA_APPELS__.claim);
    ok(apresFrappe.length === avantFrappe,
      '[B] ecrire sur un mail deja pris ne redemande rien : une prise, pas une par touche',
    `${avantFrappe} -> ${apresFrappe.length}`);
    ok(apresFrappe.every((id) => Number(id) === 42),
      '[B] et toutes les prises portent bien sur CE mail', JSON.stringify(apresFrappe));

    // =====================================================================
    console.log('\n[C] la prise d un autre se voit, avec son nom');
    // =====================================================================
    await poserPrise(page, { memberId: 'sophie', memberName: 'Sophie', memberRole: 'Manager', ilYaMinutes: 3 });
    const bandeau = await texteDuBandeau(page);
    ok(/Sophie/.test(bandeau), '[C] le NOM de la personne apparait, pas « quelqu un »', bandeau);
    ok(/Manager/.test(bandeau), '[C] et SON ROLE : on ne reagit pas pareil selon qui repond', bandeau);
    ok(/3 min/.test(bandeau), '[C] et depuis combien de temps elle y est', bandeau);
    ok(/deux r[ée]ponses/i.test(bandeau), '[C] avec la consequence dite en clair, pas un code couleur seul');

    // =====================================================================
    console.log('\n[D] ma propre prise ne m alerte pas');
    // =====================================================================
    await poserPrise(page, { memberId: MOI, memberName: 'Moi QA', memberRole: 'Direction', ilYaMinutes: 1 });
    ok((await texteDuBandeau(page)) === '', '[D] ma propre prise ne declenche aucune alerte', await texteDuBandeau(page));

    // =====================================================================
    console.log('\n[E] une prise expiree ne bloque plus rien');
    // =====================================================================
    await poserPrise(page, { memberId: 'sophie', memberName: 'Sophie', memberRole: 'Manager', ilYaMinutes: 30, expireeDepuisMinutes: 5 });
    ok((await texteDuBandeau(page)) === '',
      '[E] une prise perimee (onglet ferme il y a longtemps) n affiche plus rien', await texteDuBandeau(page));
    // Et la preuve que ce vert ne vient pas d un bandeau casse : la meme prise,
    // encore vivante, s affiche.
    await poserPrise(page, { memberId: 'sophie', memberName: 'Sophie', memberRole: 'Manager', ilYaMinutes: 30 });
    ok(/Sophie/.test(await texteDuBandeau(page)),
      '[E] alors que la meme prise, encore vivante, s affiche bien (le controle precedent mesure l expiration, pas une panne)');

    // =====================================================================
    console.log('\n[F] envoyer libere la main');
    // =====================================================================
    await poserPrise(page, { memberId: MOI, memberName: 'Moi QA', memberRole: 'Direction', ilYaMinutes: 1 });
    await page.evaluate(() => { window.confirm = () => true; });
    const relachesAvant = await page.evaluate(() => window.__QA_APPELS__.release.length);
    await page.evaluate((u) => pv2InboxReply(u), uid);
    await page.waitForTimeout(700);
    const envois = await page.evaluate(() => window.__QA_APPELS__.send.length);
    const relaches = await page.evaluate(() => window.__QA_APPELS__.release);
    ok(envois === 1, '[F] la reponse part bien (sinon la suite ne prouverait rien)', `${envois} envoi(s)`);
    ok(relaches.length > relachesAvant && Number(relaches[relaches.length - 1]) === 42,
      '[F] et la main est relachee sur ce mail : plus personne ne le croit en cours', JSON.stringify(relaches));

    // =====================================================================
    console.log('\n[H] le fondateur ne pose jamais de prise');
    // =====================================================================
    // Mesure sur la REGLE DU SERVEUR, pas sur le bouchon du navigateur : un
    // mock qui reproduirait la regle ne prouverait que lui-meme.
    const { __test } = require(path.join(ROOT, 'api/ops.js'));
    const ignore = __test && __test.priseIgnoreePourCetteSession;
    ok(typeof ignore === 'function', '[H] la regle du fondateur est mesurable');
    const fondateur = { member: { id: 'movsar' }, role: { id: 'founder', name: 'Fondateur' }, permissions: ['platform.admin', 'emails.view'] };
    const directrice = { member: { id: 'sophie' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: ['emails.view', 'emails.send', 'direction.view'] };
    const bar = { member: { id: 'lea' }, role: { id: 'bar', name: 'Bar' }, permissions: ['emails.view'] };
    ok(ignore(fondateur) === true, '[H] une session fondateur ne pose pas de prise');
    ok(ignore(directrice) === false, '[H] une directrice, si (sinon plus personne ne serait signale)');
    ok(ignore(bar) === false, '[H] un equipier du bar aussi');
    ok(ignore(null) === false, '[H] et une session absente ne passe pas pour le fondateur');

    if (errs.length) console.log('\nErreurs console :\n' + errs.slice(0, 5).join('\n'));
    console.log(failures ? `\n${failures} controle(s) en echec.` : '\nemail-claim-check: ALL OK');
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

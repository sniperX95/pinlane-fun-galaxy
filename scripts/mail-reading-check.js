// UN MAIL RECU SE LIT COMME UN MAIL.
//
// Pourquoi ce gate existe, mot pour mot : « c est super moche comme ca, il faut
// qu on voie vraiment comme sur Gmail ». Le mail etait jete brut dans un cadre a
// defilement, chevrons de citation compris. Sur une reponse de deux mots, la
// question du client etait litteralement introuvable a l ecran, noyee sous trois
// ecrans de fil recopie.
//
// La regle de separation est deja mesuree seule (email-thread-check). Ca ne
// prouve rien sur l ECRAN : il restait tout le rendu. Ce gate-ci pilote donc la
// vraie page avec le vrai mail recu en production, et regarde ce qui s affiche.
//
// LES CINQ PROPRIETES :
//
//   [A] LE MESSAGE EST VISIBLE, EN ENTIER. C est la seule chose que la personne
//       a reellement ecrite.
//
//   [B] LA CITATION N EST PAS AFFICHEE AU DEPART. C est tout l interet : sans
//       ca, on revient exactement au probleme.
//
//   [C] ELLE SE RETROUVE EN UN CLIC. Replier n est pas supprimer : un fil de
//       conversation perdu serait pire que le bruit qu on enleve.
//
//   [D] QUI ECRIT ET QUAND SE LISENT EN TETE. Un mail sans expediteur visible
//       oblige a deviner a qui on repond.
//
//   [E] LA CITATION DEPLIEE EST LISIBLE. La deplier pour retrouver les chevrons
//       empiles n aurait rien regle.
//
// Usage : node scripts/mail-reading-check.js
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_READ_PORT || 4233);
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

    // LE VRAI MAIL RECU EN PRODUCTION le 2026-09-06, recopie tel quel : une
    // question de deux lignes noyee sous le fil de la confirmation.
    const corpsReel = [
      'Bonjour, est-ce que je peux amener mon propre gateau ?',
      '',
      'Le dim. 6 sept. 2026 à 20:54, Fun Galaxy Libramont <contact@pinlane.be> a',
      'écrit :',
      '',
      '> Bowling',
      '>',
      '> Fun Galaxy Libramont',
      '>',
      '> Réservation confirmée',
      '> On vous attend mardi 8 septembre',
      '>',
      '> Rendez-vous à 16:00. Arrivez 10 minutes avant.',
    ].join('\n');

    const comms = [{
      id: 42, centerId: 'libramont', channel: 'email', direction: 'inbound', status: 'received',
      templateId: null, recipient: 'ansarbis2.0@gmail.com',
      subject: "Re: C'est confirmé : on vous attend mardi 8 septembre",
      createdAt: new Date(Date.now() - 300e3).toISOString(),
      payload: {
        from: 'ansarbis2.0@gmail.com',
        fromName: 'Ansar Bis',
        receivedAt: new Date(Date.now() - 300e3).toISOString(),
        textBody: corpsReel,
        analysis: {
          intent: 'autre', intentLabel: 'Autre',
          summary: 'Le client demande s il peut apporter sa propre nourriture.',
          urgency: 'normale', provider: 'rules', clientName: 'Ansar',
          reply: { subject: 'Votre question pour mardi 8 septembre', body: 'Bonjour Ansar,' },
        },
      },
    }];

    const nf = window.fetch.bind(window);
    const J = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      let u;
      try { u = new URL(url, location.origin); } catch (e) { return nf(input, init); }
      if (!u.pathname.startsWith('/api/')) return nf(input, init);
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
      if (u.pathname === '/api/ops' && action === 'pulse') return J({ ok: true, empreinte: 'stable' });
      if (u.pathname === '/api/ops' && action === 'emailClaims') return J({ ok: true, claims: [] });
      if (u.pathname === '/api/ops' && action === 'communications') return J({ ok: true, communications: comms });
      if (u.pathname === '/api/ops' && action === 'emailStudio') return J({ ok: true, templates: [], identities: [{ id: 1, label: 'Accueil', email: 'contact@fungalaxy.be', isDefault: true }], channel: { resendConfigured: true, aiConfigured: false } });
      if (u.pathname === '/api/ops') return J({ ok: true, communications: comms, samples: [], suggestions: [], events: [], claims: [], settings: {}, defaults: {}, sequences: [], overrides: {}, stats: {} });
      if (u.pathname === '/api/simulation') return J({ ok: true, status: 'idle', simulation: null });
      return nf(input, init);
    };
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession));
  }, { expiresAt, moi: MOI });
}

async function lire(page) {
  return page.evaluate(() => {
    const q = (s) => document.querySelector(`#staffEmailsPage ${s}`);
    const t = (s) => { const el = q(s); return el ? el.textContent.replace(/\s+/g, ' ').trim() : ''; };
    return {
      corps: t('.pv2-mail-corps'),
      entete: t('.pv2-mail-entete'),
      historique: t('.pv2-mail-historique'),
      boutonPresent: Boolean(q('.pv2-mail-plus')),
      // Ligne a ligne : un chevron de citation est en DEBUT de ligne. Chercher
      // un « > » n importe ou attrapait <contact@pinlane.be>, une adresse
      // parfaitement legitime.
      lignesCorps: (q('.pv2-mail-corps') || { innerText: '' }).innerText.split('\n'),
      lignesHistorique: (q('.pv2-mail-historique') || { innerText: '' }).innerText.split('\n'),
      pastille: t('.pv2-mail-pastille'),
      quand: t('.pv2-mail-quand'),
    };
  });
}

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  try {
    await installMock(page);
    await page.goto(`${BASE_URL}/?v=read-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
    await page.evaluate(() => { state.staffMenuPage = 'emails'; state.staffTheme = 'dark'; save(); setView('staff'); renderStaff(); });
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      if (typeof pv2EmailFilter === 'function') pv2EmailFilter('inbound');
      const rows = typeof getStaffEmailRows === 'function' ? getStaffEmailRows() : [];
      const cible = rows.find((r) => Number(r.id) === 42);
      if (cible && typeof pv2SelectEmail === 'function') pv2SelectEmail(cible.uid);
    });
    await page.waitForTimeout(500);

    // Capture optionnelle : PINLANE_READ_SHOT=<dossier> pour REGARDER l ecran au
    // lieu de le deviner. Le harnais est deja monte (session, mock, navigation) :
    // le dupliquer ailleurs le ferait diverger en silence. N altere ni les
    // assertions ni le code de sortie.
    if (process.env.PINLANE_READ_SHOT) {
      const dossier = process.env.PINLANE_READ_SHOT;
      fs.mkdirSync(dossier, { recursive: true });
      for (const theme of ["dark", "light"]) {
        await page.evaluate((t) => { setStaffTheme(t); }, theme);
        await page.waitForTimeout(400);
        const panneau = await page.$("#staffEmailsPage .pv2-mail-detail");
        if (panneau) await panneau.screenshot({ path: path.join(dossier, `mail-${theme}.png`) });
      }
      await page.evaluate(() => { setStaffTheme("dark"); });
      await page.waitForTimeout(300);
    }

    const regleChargee = await page.evaluate(() => Boolean(window.PinlaneEmailThread && window.PinlaneEmailThread.separerCitation));
    ok(regleChargee, 'la regle de separation est chargee dans la page (sinon tout le reste serait un faux vert)');
    const vue = await lire(page);
    ok(Boolean(vue.corps), 'le corps du mail est bien rendu (la situation est montee)', vue.corps.slice(0, 40));

    // =====================================================================
    console.log('\n[A] le message est visible, en entier');
    // =====================================================================
    ok(/je peux amener mon propre gateau/i.test(vue.corps),
      '[A] la question du client s affiche', vue.corps.slice(0, 60));

    // =====================================================================
    console.log('\n[B] la citation n est pas affichee au depart');
    // =====================================================================
    ok(!/Reservation confirmee|Réservation confirmée/i.test(vue.corps),
      '[B] le fil recopie de la confirmation n est PAS a l ecran', vue.corps.slice(0, 80));
    ok(!/Rendez-vous à 16:00/.test(vue.corps), '[B] ni aucune de ses lignes');
    ok(!vue.lignesCorps.some((l) => /^s*>/.test(l)),
    '[B] et plus une seule ligne prefixee d un chevron',
    JSON.stringify(vue.lignesCorps.filter((l) => /^s*>/.test(l)).slice(0, 2)));
    ok(vue.boutonPresent, '[B] mais un bouton signale qu il y a autre chose (rien n est cache en silence)');

    // =====================================================================
    console.log('\n[D] qui ecrit et quand se lisent en tete');
    // =====================================================================
    ok(/Ansar Bis/.test(vue.entete), '[D] le nom de l expediteur', vue.entete.slice(0, 60));
    ok(/ansarbis2\.0@gmail\.com/.test(vue.entete), '[D] et son adresse');
    ok(vue.pastille === 'A', '[D] avec son initiale en pastille', vue.pastille);
    ok(Boolean(vue.quand), '[D] et la date de reception', vue.quand);

    // =====================================================================
    console.log('\n[C] la citation se retrouve en un clic');
    // =====================================================================
    await page.click('#staffEmailsPage .pv2-mail-plus');
    await page.waitForTimeout(400);
    const apres = await lire(page);
    ok(/Réservation confirmée/.test(apres.historique),
      '[C] le fil est de retour : replier n est pas supprimer', apres.historique.slice(0, 60));
    ok(/je peux amener mon propre gateau/i.test(apres.corps),
      '[C] et le message reste visible au-dessus');

    // =====================================================================
    console.log('\n[E] la citation depliee est lisible');
    // =====================================================================
    const citees = apres.lignesHistorique.filter((l) => /^s*>/.test(l));
  ok(apres.lignesHistorique.length > 1 && citees.length === 0,
    '[E] le fil deplie compte plusieurs lignes, et aucune ne commence par un chevron',
    `${apres.lignesHistorique.length} ligne(s), ${citees.length} encore citee(s)`);

    if (errs.length) console.log('\nErreurs console :\n' + errs.slice(0, 5).join('\n'));
    console.log(failures ? `\n${failures} controle(s) en echec.` : '\nmail-reading-check: ALL OK');
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

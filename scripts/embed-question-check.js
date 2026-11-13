// LA QUESTION DE L INTERRUPTEUR DU SITE, POSEE DANS LA PAGE (2026-11-13).
//
// La nuit du 13/11, le premier clic d Ansar sur « Rendre l ancien formulaire du
// site » n a rien envoye : la fenetre « OK » du navigateur n avait pas ete validee
// (journal 553). La question se pose maintenant dans le bloc « Sur votre site » de
// la page Etablissement. Ce gate joue la vraie console dans un vrai navigateur :
//   [A] aucune fenetre du navigateur, a aucun moment ;
//   [B] le premier clic pose la question dans le bloc, sans rien envoyer ; couper
//       la reservation en ligne se dit en rouge, le focus va sur « Retour » ;
//   [C] « Retour » et Echap retirent la question sans rien envoyer ;
//   [D] la question tient a travers un repeint de la page ;
//   [E] confirmer envoie UNE fois setEmbedState (centre, actif), le bouton attend,
//       puis le bloc dit le nouvel etat lu au serveur ; un double clic n envoie
//       qu une fois ;
//   [F] remettre Pinlane : question en bleu, le focus sur le bouton qui agit ;
//   [G] une question posee a Libramont ne s affiche pas a Gembloux.
// --contre-preuves : trois mutations du vrai fichier, servies en memoire, doivent
// chacune faire rougir le gate (la fenetre du navigateur revenue, la question qui
// vaut pour tous les centres, le double envoi).
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_EMBED_QUESTION_PORT || 4219);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webp': 'image/webp', '.jpg': 'image/jpeg' };

const centerConfig = (() => {
  const cc = require(path.join(ROOT, 'lib', 'center-config'));
  const baseline = require(path.join(ROOT, 'ops-knowledge', 'centers.json'));
  return {
    ok: true,
    centers: (baseline.centers || []).map((center) => ({ id: center.id, name: center.name, clientId: 'fungalaxy', clientName: 'Fun Galaxy', ...cc.toEditableConfig(center) })),
    activities: [],
  };
})();

const MUTATIONS = {
  'fenetre-du-navigateur': {
    de: "function demanderBasculeFormulaire(actif) {\n",
    vers: "function demanderBasculeFormulaire(actif) {\n  if (typeof confirm === 'function' && !confirm('Confirmer ?')) return;\n  basculerFormulaireDuSite(actif); return;\n",
  },
  'question-de-tous-les-centres': {
    de: 'const question = embedQuestion && center && embedQuestion.centerId === center.id ? embedQuestion : null;',
    vers: 'const question = embedQuestion || null;',
  },
  'double-envoi': {
    de: '  if (embedEnCours) return;\n  const centerId = getActiveOpsCenterId();',
    vers: '  const centerId = getActiveOpsCenterId();',
  },
};

function serveur(mutation) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    let fichier = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname === '') fichier = path.join(ROOT, 'index.html');
    if (!fichier.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(fichier, (err, contenu) => {
      if (err) { res.writeHead(404); res.end(); return; }
      let corps = contenu;
      if (mutation && url.pathname === '/assets/app-main.js') {
        const texte = contenu.toString('utf8').replace(/\r\n/g, '\n');
        const m = MUTATIONS[mutation];
        if (!texte.includes(m.de)) { res.writeHead(500); res.end(`mutation ${mutation} : ancre introuvable`); return; }
        corps = Buffer.from(texte.replace(m.de, m.vers), 'utf8');
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(fichier).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(corps);
    });
  });
  return new Promise((ok, ko) => { server.once('error', ko); server.listen(PORT, '127.0.0.1', () => ok(server)); });
}

async function poserLeMock(page) {
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await page.addInitScript(({ expiresAt, CENTER_CONFIG }) => {
    const perms = ['dashboard.view', 'planning.view', 'reservations.view', 'clients.view', 'settings.manage', 'direction.view', 'centers.switch'];
    const session = { token: 'qa', cookieBacked: false, centerId: 'libramont', expiresAt, member: { id: 'qa', name: 'Rachel', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };
    const J = (p) => {
      const corps = JSON.stringify(p);
      let h = 0;
      for (let i = 0; i < corps.length; i += 1) h = (h * 31 + corps.charCodeAt(i)) | 0;
      return new Response(corps, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', etag: `qa-${(h >>> 0).toString(36)}` } });
    };
    const natif = window.fetch.bind(window);
    // Le serveur du banc garde l etat de chaque centre, comme centers.settings.config.embed.
    const embed = {};
    window.__ENVOIS__ = [];
    window.fetch = async (input, init = {}) => {
      const u = new URL(typeof input === 'string' ? input : (input && input.url) || '', window.location.origin);
      const methode = String(init.method || 'GET').toUpperCase();
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', locked: true, permissions: perms }], members: [{ id: 'qa', name: 'Rachel', roleId: 'direction' }] } });
      if (u.pathname === '/api/staff-state') return J({ ok: true, revision: 'qa', reservations: [], laneStatuses: {}, centerId: 'libramont' });
      if (u.pathname === '/api/public-booking-meta') return J({ ok: true, today: '2026-07-18', durationOptions: [], formules: [] });
      if (u.pathname === '/api/admin-range') return J({ ok: true, reservations: [], emails: [], agentEvents: [], centerId: 'libramont' });
      if (u.pathname === '/api/ops' && methode === 'POST') {
        const corps = JSON.parse(init.body || '{}');
        if (corps.action === 'setEmbedState') {
          window.__ENVOIS__.push(corps);
          await new Promise((r) => setTimeout(r, 500));
          embed[corps.centerId] = { actif: corps.actif === true, bascule: new Date().toISOString(), basculePar: 'Rachel' };
          return J({ ok: true });
        }
        return J({ ok: true });
      }
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'centerConfig') {
        return J({ ...CENTER_CONFIG, centers: CENTER_CONFIG.centers.map((c) => (embed[c.id] ? { ...c, embed: embed[c.id] } : c)) });
      }
      if (u.pathname === '/api/ops') return J({ ok: true, communications: [], samples: [], suggestions: [], events: [], ecosystem: null, agents: [], activations: [], orchestration: {}, blocks: [] });
      return natif(input, init);
    };
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(session));
  }, { expiresAt, CENTER_CONFIG: centerConfig });
}

async function jouer(mutation) {
  let echecs = 0;
  const ok = (cond, label) => { if (!mutation || !cond) console.log(`${cond ? 'ok  ' : 'FAIL'}  ${mutation ? `[${mutation}] ` : ''}${label}`); if (!cond) echecs += 1; return cond; };
  const server = await serveur(mutation);
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'fr-BE', timezoneId: 'Europe/Brussels', serviceWorkers: 'block' });
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    const erreurs = [];
    let fenetres = 0;
    page.on('pageerror', (e) => erreurs.push(e.message));
    page.on('dialog', (d) => { fenetres += 1; d.accept().catch(() => {}); });
    await poserLeMock(page);
    await page.goto(`${BASE_URL}/?v=embed-question`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function' && typeof window.renderStaffUtilityPage === 'function', null, { timeout: 20000 });
    await page.evaluate(() => {
      state.currentDate = '2026-07-18';
      state.adminCenterId = 'libramont';
      state.staffMenuPage = 'establishment';
      state.establishmentTab = 'centre';
      state.establishmentEditing = false;
      save();
      setView('staff');
    });
    await page.waitForSelector('[data-estab-page][data-eb-center="libramont"] .eb-m', { state: 'visible' });
    await page.evaluate(() => ebOuvrir('formulaire'));
    const bouton = page.locator('#estab-embed-champ .estab-embed-bouton');
    await bouton.waitFor({ state: 'visible' });
    const lire = () => page.evaluate(() => {
      const champ = document.getElementById('estab-embed-champ');
      const q = champ && champ.querySelector('.estab-embed-question');
      const b = champ && champ.querySelector('.estab-embed-bouton');
      const actif = document.activeElement;
      return {
        etat: champ ? (champ.querySelector('.estab-embed-etat strong') || {}).textContent || '' : '',
        question: q ? { texte: q.textContent.replace(/\s+/g, ' ').trim(), risque: q.classList.contains('est-risque') } : null,
        bouton: b ? { texte: b.textContent.replace(/\s+/g, ' ').trim(), desactive: b.disabled } : null,
        focus: actif ? (actif.hasAttribute('data-embed-retour') ? 'retour' : actif.hasAttribute('data-embed-confirmer') ? 'confirmer' : actif.className || actif.tagName) : '',
        envois: window.__ENVOIS__.length,
      };
    });

    let l = await lire();
    ok(l.etat === 'Le formulaire Pinlane est en ligne' && l.bouton && /Rendre l’ancien formulaire du site/.test(l.bouton.texte), `[B] depart : Pinlane en ligne, le bouton « Rendre l’ancien formulaire du site » (obtenu ${l.etat} / ${l.bouton && l.bouton.texte})`);

    await bouton.click();
    l = await lire();
    ok(l.question && l.question.risque && /l’ancien formulaire revient/.test(l.question.texte), `[B] le clic pose la question dans le bloc, en rouge (obtenu ${JSON.stringify(l.question)})`);
    ok(l.envois === 0, `[B] rien n est envoye avant de confirmer (obtenu ${l.envois} envoi)`);
    ok(l.focus === 'retour', `[B] le focus va sur « Retour » pour couper la reservation en ligne (obtenu ${l.focus})`);

    await page.locator('[data-embed-retour]').click();
    l = await lire();
    ok(!l.question && l.bouton && l.envois === 0, `[C] « Retour » retire la question sans rien envoyer (question ${Boolean(l.question)}, envois ${l.envois})`);

    await bouton.click();
    await page.keyboard.press('Escape');
    l = await lire();
    ok(!l.question && l.envois === 0, `[C] Echap retire la question sans rien envoyer (question ${Boolean(l.question)}, envois ${l.envois})`);

    await bouton.click();
    await page.evaluate(() => renderStaffUtilityPage());
    await page.evaluate(() => ebOuvrir('formulaire'));
    l = await lire();
    ok(Boolean(l.question), `[D] la question tient a travers un repeint de la page (obtenu ${Boolean(l.question)})`);

    // [G] la question posee a Libramont ne vaut pas pour Gembloux.
    // Le banc change de centre a la main (la session du faux serveur reste a Libramont) : une relecture de la
    // session en route peut remettre l autre centre (vu une fois sur GitHub le 13/11, 15 s d attente pour rien).
    // Le centre se repose donc jusqu a ce que la page le montre.
    const allerA = async (id) => {
      await page.waitForFunction((c) => {
        if (document.querySelector(`[data-estab-page][data-eb-center="${c}"]`)) return true;
        state.adminCenterId = c; save(); renderStaffUtilityPage();
        return Boolean(document.querySelector(`[data-estab-page][data-eb-center="${c}"]`));
      }, id, { polling: 250, timeout: 15000 });
      await page.evaluate(() => ebOuvrir('formulaire'));
    };
    await allerA('gembloux');
    l = await lire();
    ok(!l.question, `[G] une question posee a Libramont ne s affiche pas a Gembloux (obtenu ${Boolean(l.question)})`);
    await allerA('libramont');

    // [E] confirmer, deux fois tres vite : un seul envoi, le bouton attend, puis l etat relu.
    await page.locator('[data-embed-confirmer]').waitFor({ state: 'visible' });
    await page.evaluate(() => { const b = document.querySelector('[data-embed-confirmer]'); b.click(); b.click(); });
    l = await lire();
    ok(l.bouton && l.bouton.desactive && /Un instant/.test(l.bouton.texte), `[E] pendant l envoi, le bouton attend (obtenu ${JSON.stringify(l.bouton)})`);
    await page.waitForFunction(() => /formulaire d’origine du site est rendu/.test((document.querySelector('#estab-embed-champ .estab-embed-etat strong') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(700);
    l = await lire();
    const envois = await page.evaluate(() => window.__ENVOIS__);
    ok(envois.length === 1 && envois[0].centerId === 'libramont' && envois[0].actif === false, `[E] un seul envoi setEmbedState (libramont, actif false) (obtenu ${JSON.stringify(envois)})`);
    ok(l.etat === 'Le formulaire d’origine du site est rendu' && l.bouton && /Remettre le formulaire Pinlane/.test(l.bouton.texte) && !l.bouton.desactive, `[E] le bloc dit l etat relu au serveur (obtenu ${l.etat} / ${l.bouton && l.bouton.texte})`);

    // [F] remettre Pinlane : question bleue, le focus sur le bouton qui agit.
    await page.locator('#estab-embed-champ .estab-embed-bouton').click();
    l = await lire();
    ok(l.question && !l.question.risque && l.focus === 'confirmer', `[F] remettre Pinlane : question bleue, focus sur le bouton qui agit (obtenu ${JSON.stringify(l.question)}, focus ${l.focus})`);
    await page.locator('[data-embed-confirmer]').click();
    await page.waitForFunction(() => /Pinlane est en ligne/.test((document.querySelector('#estab-embed-champ .estab-embed-etat strong') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    const envois2 = await page.evaluate(() => window.__ENVOIS__);
    ok(envois2.length === 2 && envois2[1].actif === true, `[F] le second envoi remet Pinlane (obtenu ${JSON.stringify(envois2.map((e) => e.actif))})`);

    ok(fenetres === 0, `[A] aucune fenetre du navigateur (obtenu ${fenetres})`);
    ok(erreurs.length === 0, `aucune erreur JavaScript (obtenu ${erreurs.join(' | ') || 'aucune'})`);
  } catch (e) {
    ok(false, `deroulement : ${e.message.split('\n')[0]}`);
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
  return echecs;
}

(async () => {
  if (process.argv.includes('--contre-preuves')) {
    let ratees = 0;
    for (const nom of Object.keys(MUTATIONS)) {
      const echecs = await jouer(nom);
      console.log(`${echecs > 0 ? 'ok  ' : 'FAIL'}  contre-preuve ${nom} : ${echecs > 0 ? `rougit (${echecs})` : 'reste verte'}`);
      if (echecs === 0) ratees += 1;
    }
    process.exit(ratees ? 1 : 0);
  }
  const echecs = await jouer(null);
  console.log(echecs ? `\nFAIL ${echecs}` : '\nOK');
  process.exit(echecs ? 1 : 0);
})();

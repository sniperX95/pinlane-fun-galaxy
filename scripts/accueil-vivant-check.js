// L ACCUEIL QUI SALUE, ET NE DIT QUE DU VRAI.
//
// Movsar, 2026-09-25, devant l interface d Accountable : « une mascotte en
// dessin ... active, animée ... plus vivant, plus pro, avec que des choses qui
// sont vraiment réelles, un workflow super connecté, pas de fausses data, pas
// de chose répétée ». La Vue d ensemble :
//
// [A] SALUE ET COMPTE. « Bonjour Camille » (le prenom de la session), puis une
//     phrase qui est EXACTEMENT le nombre de lignes de la carte « À faire ».
//     Cette carte reunit les alertes de la journee ET la boite mail reelle
//     (emailOverview : mails a repondre, questions de l agent, envois en
//     echec), chaque ligne menant a sa section de la page Emails. Elle passe
//     sous les chiffres, avant les graphiques. Pino salue ; le noeud est repris
//     au re-rendu (le salut ne se rejoue pas au poll) ; l entree de page joue
//     une fois par navigation. Le fil de la journee compte sur l heure reelle,
//     et la tuile fausse « Lasers disponibles N / N » n existe plus.
// [B] TOUT EST FAIT : boite vide, journee reglee : « Tout est à jour », Pino
//     se rejouit.
// [C] BOITE ILLISIBLE (500) : l accueil ne dit JAMAIS « Tout est à jour » (un
//     compte absent n est pas un zero), Pino ne se rejouit pas.
// [D] LES REGLES, lues dans la page : le fil d une date passee est termine,
//     d une date future a venir ; le prenom ne sort pas d un compte de centre,
//     de role ou de secours ; « Bonsoir » a partir de 18 h.
// [E] SANS LE DROIT DE LIRE LES MAILS : aucune lecture de la boite, aucune
//     ligne mail.
// [F] LE CHARGEMENT DE LA CONSOLE n est plus habille en erreur : forme calme,
//     Pino qui reflechit.
//
// Serveur : scripts/dev-console-server.js (fixtures, aucun reseau, aucune
// base, aucun vrai mail). Horloge figee au 2026-09-25 15:30.
//
// CONTRE-PREUVES : `--contre-preuves` sert app-main.js casse expres, une
// mutation a la fois, et exige que chacune rougisse sa cible.
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawnSync } = require('child_process');
const { chromium } = require('playwright-core');
const dev = require('./dev-console-server.js');

const ROOT = path.join(__dirname, '..');
// 4294 : aucun autre gate ne le prend (deux gates au meme port dans une vague
// se tuent).
const PORT = Number(process.env.PINLANE_ACCUEIL_PORT || 4294);
const BASE = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CASSE = String(process.env.ACCUEIL_CASSE || '');
const JOUR = '2026-09-25';
const HEURE = `${JOUR}T15:30:00`;

// Chaque contre-preuve : [ancre exacte (LF), remplacement, controle qui doit rougir].
const MUTATIONS = {
  inbox: ['  if (open) {\n    const oldest', '  if (false) {\n    const oldest', '[A] la ligne « mails à répondre »'],
  compte: ['const todoCount = inboxTodos.length + getStaffDashboardAlertDefinitions(metrics).length;', 'const todoCount = getStaffDashboardAlertDefinitions(metrics).length;', '[A] la phrase du haut compte les lignes'],
  vide: ['    if (!inboxKnown) {\n      return `<div class="dash-todo-empty">', '    if (false) {\n      return `<div class="dash-todo-empty">', '[C] la carte ne dit pas « Tout est à jour »'],
  ligne: [": (inboxKnown ? 'Tout est à jour, rien ne vous attend.' : 'Aucune alerte sur la journée.');", ": 'Tout est à jour, rien ne vous attend.';", '[C] la phrase du haut'],
  pino: ['      slot.replaceChildren(previousPino);\n', '', '[A] Pino est repris au re-rendu'],
  entree: ["root.classList.toggle('dash-enter', arriving && !prefersReducedMotion());", "root.classList.add('dash-enter');", '[A] l entree ne rejoue pas au re-rendu'],
  passe: ['  if (state.currentDate < today) return { upcoming: 0, live: 0, done: timed.length };\n', '', '[D] une date passee est terminee'],
  prenom: ["  if (first.length < 2 || first.length > 24 || reserved.has(plain(first))) return '';", "  if (first.length < 2 || first.length > 24) return '';", '[D] pas de prenom tire du centre'],
  droit: ['  if (!canSeeDashInbox()) return;\n  const centre = getCurrentStaffCenterId();', '  const centre = getCurrentStaffCenterId();', '[E] aucune lecture de la boite'],
  dodo: ["allClear ? (metrics.planningWindow && metrics.planningWindow.closed ? 'sleep' : 'happy') : 'wave';", "allClear ? 'happy' : 'wave';", '[B] un jour de fermeture ou tout est fait, Pino dort'],
  chargement: ["    status.className = 'staff-console-loading';", "    status.className = 'admin-load-error';", '[F] le chargement a sa forme calme'],
};

let echecs = 0;
let reussis = 0;
const rouges = [];
function ok(cond, label, detail) {
  if (cond) { reussis += 1; console.log(`ok    ${label}${detail ? `  ${detail}` : ''}`); return; }
  echecs += 1;
  rouges.push(label);
  console.log(`FAIL  ${label}${detail ? `  ${detail}` : ''}`);
}

// Trois reservations le jour du test : finie et payee (10 h), en cours et
// arrivee sans paiement (15 h), a venir non payee (18 h).
const resa = (id, startTime, lane, status, price, name, pax) => ({
  id, date: JOUR, startTime, duration: 60, type: 'bowling', lanes: [lane], pax, price, status,
  name, email: `${id}@exemple.be`, phone: '+32470000000', centerId: dev.CENTER_ID, validationStatus: 'confirmed',
});
const JOURNEE = [
  resa('r-done', '10:00', 1, 'paid', 90, 'Famille Martin', 6),
  resa('r-live', '15:00', 2, 'arrived', 120, 'Anniversaire Lucas', 10),
  resa('r-next', '18:00', 3, 'confirmed', 60, 'Groupe Dubois', 4),
];
const REGLEE = JOURNEE.map((r) => ({ ...r, status: 'paid' }));
const PISTES = (maintenance) => Array.from({ length: 8 }, (_, i) => i + 1)
  .reduce((acc, lane) => { acc[lane] = maintenance.includes(lane) ? 'maintenance' : 'active'; return acc; }, {});

function serveur() {
  const interne = dev.creerServeur(dev.creerRepondeurFixtures({ origine: BASE }));
  const servir = interne.listeners('request')[0];
  return http.createServer((req, res) => {
    const url = new URL(req.url, BASE);
    if (CASSE && url.pathname === '/assets/app-main.js') {
      const mutation = MUTATIONS[CASSE];
      if (!mutation) { console.error(`accueil-vivant-check: contre-preuve inconnue ${CASSE}`); process.exit(2); }
      const src = fs.readFileSync(path.join(ROOT, 'assets', 'app-main.js'), 'utf8').replace(/\r\n/g, '\n');
      if (src.split(mutation[0]).length !== 2) { console.error(`accueil-vivant-check: la contre-preuve ${CASSE} ne trouve pas son ancre une seule fois (le code a change ?)`); process.exit(2); }
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(src.replace(mutation[0], mutation[1]));
      return;
    }
    servir(req, res);
  });
}

// Une page de console sur l accueil, horloge figee, journee et boite choisies.
async function ouvrir(browser, { journee = JOURNEE, maintenance = [8], boite = 'fixtures', largeur = 1440, retarderScripts = false, horloge = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: largeur, height: 900 } });
  const page = await ctx.newPage();
  const erreurs = [];
  const lectures = [];
  page.on('pageerror', (e) => erreurs.push(String((e && e.message) || e)));
  page.on('request', (r) => { if (r.url().indexOf('action=emailOverview') >= 0) lectures.push(r.url()); });
  // L horloge figee remplace aussi les minuteries de la page : le chargement
  // de la console [F] s en passe, il ne depend pas de l heure.
  if (horloge) await page.clock.install({ time: new Date(HEURE) });
  await page.addInitScript((jour) => {
    try { localStorage.setItem('funGalaxy_v4', JSON.stringify({ view: 'staff', staffMenuPage: 'dashboard', currentDate: jour, staffTheme: 'light' })); } catch (e) { /* stockage indisponible */ }
  }, JOUR);
  await page.route('**/api/staff-state**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, revision: 'accueil', reservations: journee, laneStatuses: PISTES(maintenance), centerId: dev.CENTER_ID }),
  }));
  if (boite === 'vide') {
    await page.route('**/api/ops?action=emailOverview**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, aRepondre: 0, questions: 0, echecs7j: 0, plusAncienneAttenteAt: null, sequences: [] }) }));
  } else if (boite === 'panne') {
    await page.route('**/api/ops?action=emailOverview**', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, message: 'panne' }) }));
  }
  if (retarderScripts) {
    await page.route('**/assets/staff-pages-v2.js**', async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.continue(); });
  }
  // Scripts retardes : on n attend pas l evenement load, que le script injecte
  // retient, sinon le chargement est deja fini quand on le regarde.
  await page.goto(`${BASE}/#/staff/dashboard`, retarderScripts ? { waitUntil: 'commit' } : undefined);
  return { ctx, page, erreurs, lectures };
}

async function lire(page) {
  return page.evaluate(() => {
    const t = (sel) => { const n = document.querySelector(sel); return n ? n.textContent.replace(/\s+/g, ' ').trim() : null; };
    const root = document.getElementById('staffDashboardPage');
    const rows = [...root.querySelectorAll('.dash-alert-row')].map((r) => ({
      kind: r.getAttribute('data-todo'),
      titre: r.querySelector('strong').textContent.trim(),
      texte: r.querySelector('p').textContent.trim(),
      bouton: r.querySelector('button').textContent.trim(),
    }));
    const pino = root.querySelector('.dash-hello-pino > .pm');
    const sections = [...root.children].map((n) => n.className);
    return {
      h1: t('.dash-hello h1'),
      ligne: t('.dash-hello-line'),
      pastille: t('.dash-todo-count'),
      mood: pino ? pino.getAttribute('data-mood') : null,
      rows,
      vide: t('.dash-todo-empty'),
      videClair: Boolean(root.querySelector('.dash-todo-empty.is-clear')),
      fil: [...root.querySelectorAll('.dash-flow-card [data-flow]')].reduce((acc, n) => { acc[n.getAttribute('data-flow')] = n.querySelector('strong').textContent.trim(); return acc; }, {}),
      filMeta: t('.dash-flow-card .dash-card-meta'),
      texte: root.textContent.replace(/\s+/g, ' '),
      ordreAfaireAvantGraphiques: sections.findIndex((c) => /dash-grid-bottom/.test(c)) < sections.findIndex((c) => /dash-grid-main/.test(c)),
      debordement: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

async function attendreAccueil(page, predicat) {
  await page.waitForSelector('.dash-hello h1', { timeout: 20000 });
  try {
    await page.waitForFunction(predicat, null, { timeout: 8000 });
  } catch (error) { /* le controle suivant dira ce qui manque */ }
}

async function main() {
  if (process.argv.includes('--contre-preuves')) {
    let manquees = 0;
    for (const [nom, [, , cible]] of Object.entries(MUTATIONS)) {
      const r = spawnSync(process.execPath, [__filename], { env: { ...process.env, ACCUEIL_CASSE: nom }, encoding: 'utf8', timeout: 240000 });
      const sortie = `${r.stdout || ''}${r.stderr || ''}`;
      const cibleRouge = sortie.split('\n').some((l) => l.startsWith('FAIL') && l.indexOf(cible) >= 0);
      const mord = r.status === 1 && cibleRouge;
      if (!mord) manquees += 1;
      console.log(`${mord ? 'ok  ' : 'FAIL'}  contre-preuve ${nom} : ${mord ? `rougit « ${cible} »` : `ne mord pas (code ${r.status}, cible ${cibleRouge ? 'rouge' : 'verte'})`}`);
    }
    console.log(`accueil-vivant-check --contre-preuves: ${Object.keys(MUTATIONS).length - manquees}/${Object.keys(MUTATIONS).length} mordent`);
    process.exit(manquees ? 1 : 0);
  }

  const srv = serveur();
  await new Promise((resolve, reject) => { srv.once('error', reject); srv.listen(PORT, '127.0.0.1', resolve); });
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    // =====================================================================
    console.log('[A] SALUE ET COMPTE');
    // =====================================================================
    const a = await ouvrir(browser);
    await attendreAccueil(a.page, () => document.querySelectorAll('#staffDashboardPage [data-todo="inbox"]').length > 0);
    const va = await lire(a.page);
    ok(va.h1 === 'Bonjour Camille', '[A] le bonjour porte le prenom de la session', `« ${va.h1} »`);
    ok(va.rows.length === 5 && va.ligne === `${va.rows.length} choses vous attendent.` && va.pastille === String(va.rows.length),
      '[A] la phrase du haut compte les lignes de « À faire »', `« ${va.ligne} », pastille ${va.pastille}, ${va.rows.length} lignes`);
    const mails = va.rows.find((r) => r.kind === 'inbox') || {};
    ok(mails.titre === '2 mails à répondre' && /^Le plus ancien attend depuis \d+ h\.$/.test(mails.texte) && mails.bouton === 'Répondre',
      '[A] la ligne « mails à répondre » vient de la boite reelle', JSON.stringify(mails));
    const agent = va.rows.find((r) => r.kind === 'agent') || {};
    ok(agent.titre === '1 question de l’agent' && agent.bouton === 'Lui répondre', '[A] la ligne des questions de l agent', JSON.stringify(agent));
    const echec = va.rows.find((r) => r.kind === 'bounce') || {};
    ok(echec.titre === '1 mail non parti' && echec.bouton === 'Voir', '[A] la ligne des envois en echec', JSON.stringify(echec));
    ok(va.rows[0] && va.rows[0].kind === 'payment', '[A] le client sur place qui n a pas paye passe en tete (Prioritaire)', va.rows.map((r) => r.kind).join(', '));
    ok(va.ordreAfaireAvantGraphiques, '[A] « À faire » passe avant les graphiques');
    ok(va.fil.upcoming === '1 session' && va.fil.live === '1 session' && va.fil.done === '1 session' && va.fil.maintenance === '1 / 8' && va.filMeta === 'En direct',
      '[A] le fil de la journee compte sur l heure reelle (15:30 : une finie, une en cours, une a venir)', JSON.stringify(va.fil) + ` ${va.filMeta}`);
    ok(va.texte.indexOf('Lasers disponibles') < 0, '[A] la tuile fausse « Lasers disponibles » n existe plus');
    ok(va.mood === 'wave', '[A] Pino salue a l arrivee', va.mood);
    const reprise = await a.page.evaluate(() => {
      const avant = document.querySelector('.dash-hello-pino > .pm');
      renderStaffDashboard();
      const apres = document.querySelector('.dash-hello-pino > .pm');
      return { meme: Boolean(avant) && avant === apres, entree: document.getElementById('staffDashboardPage').classList.contains('dash-enter') };
    });
    ok(reprise.meme, '[A] Pino est repris au re-rendu (le salut ne se rejoue pas au poll)');
    ok(reprise.entree === false, '[A] l entree ne rejoue pas au re-rendu');
    const arrivee = await a.page.evaluate(() => {
      openStaffMenuPage('reservations');
      openStaffMenuPage('dashboard');
      return document.getElementById('staffDashboardPage').classList.contains('dash-enter');
    });
    ok(arrivee, '[A] l entree joue quand on revient d une autre page');
    await a.page.evaluate(() => { const b = document.querySelector('[data-todo="inbox"] button'); if (b) b.click(); });
    const versRecus = await a.page.evaluate(() => ({ page: state.staffMenuPage, section: state.staffEmailsSection }));
    ok(versRecus.page === 'emails' && versRecus.section === 'recus', '[A] « Répondre » mene aux mails recus', JSON.stringify(versRecus));
    await a.page.evaluate(() => openStaffMenuPage('dashboard'));
    await a.page.evaluate(() => { const b = document.querySelector('[data-todo="agent"] button'); if (b) b.click(); });
    const versAgent = await a.page.evaluate(() => ({ page: state.staffMenuPage, section: state.staffEmailsSection }));
    ok(versAgent.page === 'emails' && versAgent.section === 'agent', '[A] « Lui répondre » mene a la section de l agent', JSON.stringify(versAgent));
    ok(a.erreurs.length === 0, '[A] aucune erreur JavaScript', a.erreurs.slice(0, 3).join(' | '));
    await a.ctx.close();

    const tel = await ouvrir(browser, { largeur: 390 });
    await attendreAccueil(tel.page, () => document.querySelectorAll('#staffDashboardPage [data-todo="inbox"]').length > 0);
    const vt = await lire(tel.page);
    ok(vt.debordement <= 0, '[A] au telephone, rien ne deborde en largeur', `${vt.debordement} px`);
    await tel.ctx.close();

    // =====================================================================
    console.log('');
    console.log('[B] TOUT EST FAIT');
    // =====================================================================
    const b = await ouvrir(browser, { journee: REGLEE, maintenance: [], boite: 'vide' });
    await attendreAccueil(b.page, () => /Tout est à jour/.test((document.querySelector('.dash-hello-line') || {}).textContent || ''));
    const vb = await lire(b.page);
    ok(vb.ligne === 'Tout est à jour, rien ne vous attend.' && vb.rows.length === 0 && vb.pastille === null, '[B] la phrase dit « Tout est à jour » quand la liste est vide et la boite lue', `« ${vb.ligne} »`);
    ok(vb.videClair && /^Tout est à jour/.test(vb.vide || ''), '[B] la carte dit « Tout est à jour »', `« ${vb.vide} »`);
    ok(vb.mood === 'happy', '[B] Pino se rejouit', vb.mood);
    const ferme = await b.page.evaluate(() => {
      const vrai = getPlanningWindow;
      window.getPlanningWindow = (date) => ({ ...vrai(date), closed: true });
      renderStaffDashboard();
      const humeur = document.querySelector('.dash-hello-pino > .pm').getAttribute('data-mood');
      window.getPlanningWindow = vrai;
      renderStaffDashboard();
      return humeur;
    });
    ok(ferme === 'sleep', '[B] un jour de fermeture ou tout est fait, Pino dort', ferme);
    ok(b.erreurs.length === 0, '[B] aucune erreur JavaScript', b.erreurs.slice(0, 3).join(' | '));
    await b.ctx.close();

    // =====================================================================
    console.log('');
    console.log('[C] BOITE ILLISIBLE');
    // =====================================================================
    const c = await ouvrir(browser, { journee: REGLEE, maintenance: [], boite: 'panne' });
    await attendreAccueil(c.page, () => Boolean(document.querySelector('.dash-todo-empty')));
    await c.page.waitForFunction(() => dashInbox.done === true, null, { timeout: 8000 }).catch(() => {});
    const vc = await lire(c.page);
    ok(vc.ligne === 'Aucune alerte sur la journée.', '[C] la phrase du haut', `« ${vc.ligne} »`);
    ok(Boolean(vc.vide) && vc.vide.indexOf('Tout est à jour') < 0 && !vc.videClair && /La boîte mail n'a pas pu être lue/.test(vc.vide), '[C] la carte ne dit pas « Tout est à jour »', `« ${vc.vide} »`);
    ok(vc.mood !== 'happy', '[C] Pino ne se rejouit pas sur un compte inconnu', vc.mood);
    ok(c.erreurs.length === 0, '[C] aucune erreur JavaScript', c.erreurs.slice(0, 3).join(' | '));

    // =====================================================================
    console.log('');
    console.log('[D] LES REGLES');
    // =====================================================================
    const regles = await c.page.evaluate((jours) => {
      const rows = state.reservations && state.reservations.length ? state.reservations : [];
      const garde = state.currentDate;
      state.currentDate = jours.hier; const passe = getStaffDashDayFlow(rows);
      state.currentDate = jours.demain; const futur = getStaffDashDayFlow(rows);
      state.currentDate = garde;
      const session = state.staffAuthSession;
      const essai = (member) => { state.staffAuthSession = { ...session, member }; return getStaffGreetingFirstName(); };
      const prenoms = {
        centre: essai({ ...session.member, name: 'Fun Galaxy Libramont' }),
        plateforme: essai({ ...session.member, name: 'Proprietaire plateforme' }),
        secours: essai({ ...session.member, name: 'Marie Dupont', emergency: true }),
        personne: essai({ ...session.member, name: 'Marie Dupont' }),
      };
      state.staffAuthSession = session;
      return {
        n: rows.length, passe, futur, prenoms,
        soir: getStaffGreetingWord(new Date(2026, 8, 25, 19, 0)),
        matin: getStaffGreetingWord(new Date(2026, 8, 25, 9, 0)),
      };
    }, { hier: '2026-09-24', demain: '2026-09-26' });
    ok(regles.n === 3 && regles.passe.done === 3 && regles.passe.upcoming === 0 && regles.passe.live === 0, '[D] une date passee est terminee', JSON.stringify(regles.passe));
    ok(regles.futur.upcoming === 3 && regles.futur.done === 0 && regles.futur.live === 0, '[D] une date future est a venir', JSON.stringify(regles.futur));
    ok(regles.prenoms.centre === '' && regles.prenoms.plateforme === '', '[D] pas de prenom tire du centre', JSON.stringify(regles.prenoms));
    ok(regles.prenoms.secours === '' && regles.prenoms.personne === 'Marie', '[D] une session de secours n a pas de prenom, une personne si', JSON.stringify(regles.prenoms));
    ok(regles.soir === 'Bonsoir' && regles.matin === 'Bonjour', '[D] « Bonsoir » a partir de 18 h', `${regles.matin} / ${regles.soir}`);

    // =====================================================================
    console.log('');
    console.log('[E] SANS LE DROIT DE LIRE LES MAILS');
    // =====================================================================
    const avant = c.lectures.length;
    await c.page.evaluate(() => {
      window.__sessionGardee = state.staffAuthSession;
      state.staffAuthSession = { ...state.staffAuthSession, role: { ...(state.staffAuthSession.role || {}), locked: false }, permissions: ['dashboard.view', 'planning.view', 'reservations.view'] };
      dashInbox.done = false;
      dashInbox.at = 0;
      renderStaffDashboard();
    });
    // Le droit reste retire toute la fenetre : un rendu du poll pendant ce
    // temps doit, lui aussi, s abstenir de lire la boite.
    await c.page.waitForTimeout(400);
    const sansDroit = await c.page.evaluate(() => {
      renderStaffDashboard();
      const lignes = document.querySelectorAll('#staffDashboardPage [data-todo="inbox"], #staffDashboardPage [data-todo="agent"], #staffDashboardPage [data-todo="bounce"]').length;
      const resultat = { voit: canSeeDashInbox(), lignes, enCours: dashInbox.loading };
      state.staffAuthSession = window.__sessionGardee;
      return resultat;
    });
    ok(sansDroit.voit === false && sansDroit.lignes === 0 && sansDroit.enCours === false && c.lectures.length === avant, '[E] aucune lecture de la boite', JSON.stringify({ ...sansDroit, lectures: c.lectures.length - avant }));
    await c.ctx.close();

    // =====================================================================
    console.log('');
    console.log('[F] LE CHARGEMENT DE LA CONSOLE');
    // =====================================================================
    const f = await ouvrir(browser, { retarderScripts: true, horloge: false });
    let charge = null;
    try {
      await f.page.waitForSelector('#staffConsoleLoadStatus', { timeout: 10000 });
      charge = await f.page.evaluate(() => {
        const s = document.getElementById('staffConsoleLoadStatus');
        return { classe: s.className, role: s.getAttribute('role'), pino: Boolean(s.querySelector('.pm--think')), texte: s.textContent.trim() };
      });
    } catch (error) { charge = { erreur: error.message }; }
    ok(Boolean(charge) && charge.classe === 'staff-console-loading' && charge.role === 'status' && charge.pino && charge.texte === 'Chargement de la console…',
      '[F] le chargement a sa forme calme', JSON.stringify(charge));
    await f.ctx.close();
  } finally {
    await browser.close();
    srv.close();
  }
  console.log('');
  console.log(`accueil-vivant-check: ${reussis} ok, ${echecs} echec(s)${CASSE ? ` (contre-preuve ${CASSE})` : ''}`);
  process.exit(echecs ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });

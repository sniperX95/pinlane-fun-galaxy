// L ACCUEIL QUI SALUE, MONTRE LE MOMENT, ET NE DIT QUE DU VRAI.
//
// Movsar, 2026-09-25 : « plus vivant, plus pro, avec que des choses qui sont
// vraiment réelles, pas de fausses data, pas de chose répétée ». Puis le
// 2026-09-29 : « pas assez facile à comprendre one shot, pas toutes les infos
// importantes, mais pas trop d info ». La Vue d ensemble (refonte du
// 2026-09-30, journal 358) repond a trois questions, dans cet ordre :
//
// [A] SALUE, MONTRE LE MOMENT, ET COMPTE. « Bonjour Camille » (le prenom de la
//     session). Le jour meme, « En ce moment » donne quatre chiffres tires de
//     la file de la page Terrain : qui arrive dans l heure, qui est EN RETARD
//     (l heure est passee, personne n a pointe), qui est sur place, et
//     l argent des groupes qui ont fini sans payer (« À clôturer »). Le retard
//     et cet argent ne se repetent PAS dans « À traiter », qui garde les mails,
//     les questions de l agent, les verifications, les pistes. La pastille du
//     haut nomme les deux (« 2 urgences · 4 à traiter »), prend la gravite la
//     plus haute, et mene a la premiere urgence. Aucune mascotte, aucune
//     liste de reservations, ni anneau ni selecteur de graphique.
// [B] TOUT EST FAIT : bande calme, boite vide : « Tout est à jour », en vert.
// [C] BOITE ILLISIBLE (500) : l accueil ne dit JAMAIS « Tout est à jour » (un
//     compte absent n est pas un zero), la pastille reste neutre.
// [D] LES REGLES, lues dans la page : pas de bandeau hors du jour meme ; le
//     retard est un groupe non pointe dont l heure est passee (un groupe paye
//     n est jamais en retard) ; la reference des tuiles est le MEME JOUR la
//     semaine d avant, et une date future ne se compare pas ; une date passee
//     garde ses paiements non soldes, le jour meme n en fait pas une tache ;
//     le prenom ne sort pas d un compte de centre, de role ou de secours ;
//     « Bonsoir » a partir de 18 h.
// [E] SANS LE DROIT DE LIRE LES MAILS : aucune lecture de la boite.
// [F] LE CHARGEMENT DE LA CONSOLE a sa forme calme.
// [G] « TOUT ENCAISSER » N ENCAISSE QUE CE QUE LE PANNEAU MONTRE. Il marquait
//     payees toutes les reservations non payees du jour, les groupes de ce
//     soir compris, depuis un panneau qui n en listait qu une.
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
  compte: ['  const pending = [...urgent, ...listed];', '  const pending = listed;', '[A] la pastille du haut nomme les urgences et ce qui est à traiter'],
  bande: ['  const alerts = [...extra, ...definitions.filter(alert => !alert.band)];', '  const alerts = [...extra, ...definitions];', '[A] le retard et l argent des groupes finis ne se repetent pas dans « À traiter »'],
  retard: ["    if (isUpcomingReservationStatus(item.reservation.status || 'pending') && item.start <= board.now) late.push(item);", '    if (false) late.push(item);', '[A] « En retard » compte le groupe non pointe dont l heure est passee'],
  vide: ['    if (!inboxKnown) {\n      return `<div class="dash-todo-empty">', '    if (false) {\n      return `<div class="dash-todo-empty">', '[C] la carte ne dit pas « Tout est à jour »'],
  ligne: [": (inboxKnown ? 'Tout est à jour' : 'Aucune alerte sur la journée');", ": 'Tout est à jour';", '[C] la pastille du haut'],
  ton: ["topRank === null ? (inboxKnown ? 'ok' : 'unknown')", "topRank === null ? 'ok'", '[C] la pastille reste neutre'],
  gravite: ["(['critical', 'important', 'info'][topRank] || 'info')", "'info'", '[A] la pastille prend la gravite la plus haute'],
  entree: ["root.classList.toggle('dash-enter', arriving && !prefersReducedMotion());", "root.classList.add('dash-enter');", '[A] l entree ne rejoue pas au re-rendu'],
  jour: ["  if (board.when !== 'today') return null;\n", '', '[D] pas de bandeau « En ce moment » hors du jour meme'],
  reference: ['  const weekAgoDate = addDays(state.currentDate, -7);', '  const weekAgoDate = addDays(state.currentDate, -1);', '[D] la reference est le meme jour la semaine d avant'],
  futur: ['  const weekAgo = state.currentDate <= todayStr() && fullSeries.length >= 8', '  const weekAgo = fullSeries.length >= 8', '[D] une date future ne se compare pas'],
  paye: ['  } else if (state.currentDate < todayStr()) {\n    const unpaidRows', '  } else if (false) {\n    const unpaidRows', '[D] une date passee garde ses paiements non soldes'],
  encaisser: ["  const rows = (alert && alert.rows ? alert.rows : []).filter(r => r.status !== 'paid' && r.status !== 'cancelled');", "  const rows = metrics.activeReservations.filter(r => r.status !== 'paid');", '[G] « Tout encaisser » n encaisse que le panneau'],
  prenom: ["  if (first.length < 2 || first.length > 24 || reserved.has(plain(first))) return '';", "  if (first.length < 2 || first.length > 24) return '';", '[D] pas de prenom tire du centre'],
  droit: ['  if (!canSeeDashInbox()) return;\n  const centre = getCurrentStaffCenterId();', '  const centre = getCurrentStaffCenterId();', '[E] aucune lecture de la boite'],
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

// Cinq reservations a 15:30 : finie et payee (10 h), finie SANS paiement
// (13:30-14:30, pointee), en cours et pointee (15 h), EN RETARD (15 h, jamais
// pointee), et a venir ce soir non payee (18 h, pas une tache).
const resa = (id, startTime, lane, status, price, name, pax) => ({
  id, date: JOUR, startTime, duration: 1, type: 'bowling', lanes: [lane], pax, price, status,
  name, email: `${id}@exemple.be`, phone: '+32470000000', centerId: dev.CENTER_ID, validationStatus: 'confirmed',
});
const JOURNEE = [
  resa('r-done', '10:00', 1, 'paid', 90, 'Famille Martin', 6),
  resa('r-fini', '13:30', 5, 'arrived', 70, 'Club Dubois', 5),
  resa('r-live', '15:00', 2, 'arrived', 120, 'Anniversaire Lucas', 10),
  resa('r-retard', '15:00', 4, 'confirmed', 50, 'Famille Renard', 4),
  resa('r-next', '18:00', 3, 'confirmed', 60, 'Groupe Dubois', 4),
];
const REGLEE = JOURNEE.map((r) => ({ ...r, status: 'paid' }));
const PISTES = (maintenance) => Array.from({ length: 8 }, (_, i) => i + 1)
  .reduce((acc, lane) => { acc[lane] = maintenance.includes(lane) ? 'maintenance' : 'active'; return acc; }, {});

function serveur() {
  // Les fixtures datent leurs mails sur l horloge figee de la page, pas sur
  // l heure reelle : sinon le gate rougit chaque soir (« moins d une heure »).
  const interne = dev.creerServeur(dev.creerRepondeurFixtures({ origine: BASE, maintenant: new Date(HEURE).getTime() }));
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
  const ecritures = [];
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
  // Ce que la console ECRIT (statuts) : releve, jamais envoye plus loin.
  await page.route('**/api/staff-reservations**', async (route) => {
    const req = route.request();
    let corps = {};
    try { corps = JSON.parse(req.postData() || '{}'); } catch (e) { corps = {}; }
    if (req.method() !== 'GET') ecritures.push({ methode: req.method(), id: String(corps.id), status: corps.status });
    const cible = journee.find((r) => String(r.id) === String(corps.id));
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, reservation: cible ? { ...cible, status: corps.status || cible.status } : null, automation: { communications: 0, jobs: 0, refreshed: false } }) });
  });
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
  return { ctx, page, erreurs, lectures, ecritures };
}

async function lire(page) {
  return page.evaluate(() => {
    const t = (sel, racine = document) => { const n = racine.querySelector(sel); return n ? n.textContent.replace(/\s+/g, ' ').trim() : null; };
    const root = document.getElementById('staffDashboardPage');
    const rows = [...root.querySelectorAll('.dash-alert-row')].map((r) => ({
      kind: r.getAttribute('data-todo'),
      titre: r.querySelector('strong').textContent.trim(),
      texte: r.querySelector('p').textContent.trim(),
      bouton: r.querySelector('button').textContent.trim(),
    }));
    const etat = root.querySelector('.dash-hello .dash-state');
    const bande = [...root.querySelectorAll('.dash-now [data-now]')].reduce((acc, n) => {
      acc[n.getAttribute('data-now')] = {
        label: t('.dash-now-label', n),
        valeur: t('.dash-now-value', n),
        sous: t('.dash-now-sub', n),
        ton: [...n.classList].find((c) => c.startsWith('tone-')) || null,
      };
      return acc;
    }, {});
    const sections = [...root.children].map((n) => n.className);
    const titres = [...root.querySelectorAll('h2')].map((h) => h.textContent.replace(/\s+/g, ' ').trim());
    return {
      h1: t('.dash-hello h1'),
      ligne: t('.dash-hello-line'),
      pastille: t('.dash-todo-count'),
      etat: etat ? {
        texte: etat.textContent.replace(/\s+/g, ' ').trim(),
        ton: [...etat.classList].find((c) => c.startsWith('tone-')) || null,
        compte: etat.getAttribute('data-todo-count'),
        bouton: etat.tagName === 'BUTTON',
      } : {},
      mascotte: Boolean(document.querySelector('.pm, .dash-hello-pino')) || typeof window.PinlaneMascot !== 'undefined',
      videOk: Boolean(root.querySelector('.dash-todo-empty.is-clear .dash-todo-icon.pr-ok')),
      rows,
      bande,
      bandeTitre: t('.dash-now h2'),
      vide: t('.dash-todo-empty'),
      videClair: Boolean(root.querySelector('.dash-todo-empty.is-clear')),
      sousResa: t('[data-kpi="resa"] .dash-kpi-sub'),
      selecteur: Boolean(root.querySelector('.dash-chart-picker')),
      titres,
      texte: root.textContent.replace(/\s+/g, ' '),
      ordre: sections,
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
    console.log('[A] SALUE, MONTRE LE MOMENT, ET COMPTE');
    // =====================================================================
    const a = await ouvrir(browser);
    await attendreAccueil(a.page, () => document.querySelectorAll('#staffDashboardPage [data-todo="inbox"]').length > 0);
    const va = await lire(a.page);
    // formatMoney pose une espace fine insecable avant « € » : lue dans la
    // page, toute espace est ramenee a une espace simple, la reference aussi.
    const argent = await a.page.evaluate(() => formatMoney(70).replace(/\s+/g, ' '));
    ok(va.h1 === 'Bonjour Camille', '[A] le bonjour porte le prenom de la session', `« ${va.h1} »`);
    // L ordre : le bonjour, le moment, la journee, puis ce qui attend.
    const rang = (motif) => va.ordre.findIndex((c) => motif.test(c));
    ok(rang(/dash-hello/) === 0 && rang(/dash-now/) === 1 && rang(/dash-section-head/) === 2 && rang(/dash-kpis/) === 3 && rang(/dash-grid-bottom/) === 4,
      '[A] l ordre de lecture : le bonjour, « En ce moment », la journee, ce qui attend', va.ordre.join(' | '));
    const b = va.bande;
    ok(va.bandeTitre === 'En ce moment' && Object.keys(b).join(',') === 'next,late,onsite,closing',
      '[A] « En ce moment » porte quatre cases, dans l ordre de la page Terrain', `${va.bandeTitre} : ${Object.keys(b).join(',')}`);
    ok(b.next && b.next.label === "D'ici 16:30" && b.next.valeur === 'Personne' && b.next.sous === 'prochain à 18:00' && b.next.ton === 'tone-neutral',
      '[A] « D ici 16:30 » : personne dans l heure, le prochain a 18:00', JSON.stringify(b.next));
    ok(b.late && b.late.valeur === '1 groupe' && b.late.sous === 'pas pointé · depuis 30 min' && b.late.ton === 'tone-important',
      '[A] « En retard » compte le groupe non pointe dont l heure est passee', JSON.stringify(b.late));
    ok(b.onsite && b.onsite.valeur === '1 groupe' && b.onsite.sous === '10 joueurs · prochaine fin 16:00' && b.onsite.ton === 'tone-neutral',
      '[A] « Sur place » ne compte que le groupe pointe (le retard n y est pas)', JSON.stringify(b.onsite));
    ok(b.closing && b.closing.valeur === argent && b.closing.sous === '1 groupe a fini sans payer' && b.closing.ton === 'tone-critical',
      '[A] « À clôturer » dit l argent du groupe fini sans payer, en rouge', `${JSON.stringify(b.closing)} (attendu ${argent})`);
    ok(va.rows.length === 4 && !va.rows.some((r) => ['overdue', 'noshow', 'payment'].includes(r.kind)),
      '[A] le retard et l argent des groupes finis ne se repetent pas dans « À traiter »', va.rows.map((r) => r.kind).join(', '));
    ok(!va.rows.some((r) => r.kind === 'payment') && va.texte.indexOf('non payée') < 0,
      '[A] le groupe de ce soir, pas encore venu, n est pas une tache', va.rows.map((r) => r.titre).join(' | '));
    ok(va.etat.texte === '2 urgences · 4 à traiter' && va.etat.compte === '6' && va.pastille === '4',
      '[A] la pastille du haut nomme les urgences et ce qui est à traiter', `« ${va.etat.texte} », compte ${va.etat.compte}, carte ${va.pastille}`);
    ok(va.etat.ton === 'tone-critical', '[A] la pastille prend la gravite la plus haute (un groupe fini sans payer)', va.etat.ton);
    const mails = va.rows.find((r) => r.kind === 'inbox') || {};
    ok(mails.titre === '2 mails à répondre' && /^Le plus ancien attend depuis \d+ h\.$/.test(mails.texte) && mails.bouton === 'Répondre',
      '[A] la ligne « mails à répondre » vient de la boite reelle', JSON.stringify(mails));
    const agent = va.rows.find((r) => r.kind === 'agent') || {};
    ok(agent.titre === '1 question de l’agent' && agent.bouton === 'Répondre', '[A] la ligne des questions de l agent', JSON.stringify(agent));
    const echec = va.rows.find((r) => r.kind === 'bounce') || {};
    ok(echec.titre === '1 envoi en échec' && echec.bouton === 'Voir', '[A] la ligne des envois en echec', JSON.stringify(echec));
    ok(va.rows[0] && va.rows[0].kind === 'inbox', '[A] les mails qui attendent passent en tete de « À traiter »', va.rows.map((r) => r.kind).join(', '));
    ok(va.sousResa === '5 bowling', '[A] la composition de la journee tient sous le nombre de reservations', `« ${va.sousResa} »`);
    ok(!va.selecteur && !va.titres.some((t) => /par activité|Formules du jour|Affluence/i.test(t)) && va.titres.includes('Arrivées par heure'),
      '[A] ni anneau, ni classement, ni selecteur de graphique : les arrivees par heure', va.titres.join(' · '));
    ok(va.texte.indexOf('Lasers disponibles') < 0, '[A] la tuile fausse « Lasers disponibles » n existe plus');
    ok(!va.mascotte, '[A] aucune mascotte ni dessin sur l accueil');
    const focus = await a.page.evaluate(() => {
      const bouton = document.querySelector('.dash-hello .dash-state');
      if (!bouton || bouton.tagName !== 'BUTTON') return 'pas de bouton';
      bouton.click();
      const f = document.activeElement;
      return f && f.classList.contains('dash-now-cell') && f.getAttribute('data-now') === 'late' ? 'ok' : (f ? `${f.className} ${f.getAttribute('data-now') || ''}` : 'rien');
    });
    ok(focus === 'ok', '[A] la pastille mene a la premiere urgence (la case « En retard » prend le focus)', focus);
    const reprise = await a.page.evaluate(() => {
      renderStaffDashboard();
      return { entree: document.getElementById('staffDashboardPage').classList.contains('dash-enter') };
    });
    ok(reprise.entree === false, '[A] l entree ne rejoue pas au re-rendu');
    const arrivee = await a.page.evaluate(() => {
      openStaffMenuPage('reservations');
      openStaffMenuPage('dashboard');
      return document.getElementById('staffDashboardPage').classList.contains('dash-enter');
    });
    ok(arrivee, '[A] l entree joue quand on revient d une autre page');
    await a.page.evaluate(() => { const bouton = document.querySelector('[data-todo="inbox"] button'); if (bouton) bouton.click(); });
    const versRecus = await a.page.evaluate(() => ({ page: state.staffMenuPage, section: state.staffEmailsSection }));
    ok(versRecus.page === 'emails' && versRecus.section === 'recus', '[A] « Répondre » mene aux mails recus', JSON.stringify(versRecus));
    await a.page.evaluate(() => openStaffMenuPage('dashboard'));
    await a.page.evaluate(() => { const bouton = document.querySelector('[data-todo="agent"] button'); if (bouton) bouton.click(); });
    const versAgent = await a.page.evaluate(() => ({ page: state.staffMenuPage, section: state.staffEmailsSection }));
    ok(versAgent.page === 'emails' && versAgent.section === 'agent', '[A] « Répondre » (questions de l agent) mene a la section de l agent', JSON.stringify(versAgent));
    await a.page.evaluate(() => openStaffMenuPage('dashboard'));
    await a.page.evaluate(() => { const c = document.querySelector('.dash-now [data-now="onsite"]'); if (c) c.click(); });
    const versTerrain = await a.page.evaluate(() => state.staffMenuPage);
    ok(versTerrain === 'arrivals', '[A] « Sur place » mene a la page Terrain', versTerrain);
    ok(a.erreurs.length === 0, '[A] aucune erreur JavaScript', a.erreurs.slice(0, 3).join(' | '));

    // =====================================================================
    console.log('');
    console.log('[G] « TOUT ENCAISSER » N ENCAISSE QUE LE PANNEAU');
    // =====================================================================
    await a.page.evaluate(() => openStaffMenuPage('dashboard'));
    await a.page.evaluate(() => { const c = document.querySelector('.dash-now [data-now="closing"]'); if (c) c.click(); });
    await a.page.waitForSelector('#staffDashboardDetailOverlay .dashboard-detail-modal', { timeout: 5000 }).catch(() => {});
    const panneau = await a.page.evaluate(() => {
      const m = document.querySelector('#staffDashboardDetailOverlay .dashboard-detail-modal');
      if (!m) return null;
      return {
        titre: (m.querySelector('#dashboardDetailTitle') || {}).textContent || '',
        dossiers: m.querySelectorAll('.dashboard-detail-row').length,
        stats: [...m.querySelectorAll('.dashboard-detail-summary article')].map((n) => [...n.children].map((x) => x.textContent.replace(/\s+/g, ' ').trim()).join(' | ')),
      };
    });
    ok(Boolean(panneau) && panneau.titre === 'À clôturer' && panneau.dossiers === 1,
      '[G] la case « À clôturer » ouvre son panneau, avec le seul groupe fini', JSON.stringify(panneau));
    ok(Boolean(panneau) && panneau.stats.length === 3 && panneau.stats[0] === 'En retard | 1 | à pointer ou appeler' && panneau.stats[1] === 'Sur place | 1 | groupe pointé' && panneau.stats[2] === `À clôturer | ${argent} | 1 groupe fini sans payer`,
      '[G] les chiffres du panneau sont ceux du bandeau', JSON.stringify(panneau && panneau.stats));
    await a.page.evaluate(() => {
      const b = [...document.querySelectorAll('#staffDashboardDetailOverlay .dashboard-detail-actions button')].find((x) => x.textContent.trim() === 'Tout encaisser');
      if (b) b.click();
    });
    const confirmation = await a.page.waitForSelector('.staff-confirm', { timeout: 4000 }).then(() => a.page.evaluate(() => document.querySelector('.staff-confirm strong').textContent.trim())).catch(() => null);
    await a.page.evaluate(() => { const b = document.querySelector('.staff-confirm [data-role="confirm-ok"]'); if (b) b.click(); });
    await a.page.waitForTimeout(900);
    const ecritsPayes = a.ecritures.filter((e) => e.status === 'paid').map((e) => e.id);
    ok(confirmation === 'Marquer 1 réservation comme payée ?' && ecritsPayes.length === 1 && ecritsPayes[0] === 'r-fini',
      '[G] « Tout encaisser » n encaisse que le panneau', `confirmation « ${confirmation} », ecritures ${JSON.stringify(a.ecritures)}`);
    await a.ctx.close();

    const tel = await ouvrir(browser, { largeur: 390 });
    await attendreAccueil(tel.page, () => document.querySelectorAll('#staffDashboardPage [data-todo="inbox"]').length > 0);
    const vt = await lire(tel.page);
    ok(vt.debordement <= 0, '[A] au telephone, rien ne deborde en largeur', `${vt.debordement} px`);
    const coupe = await tel.page.evaluate(() => [...document.querySelectorAll('.dash-now-sub, .dash-kpi-sub')].filter((n) => n.scrollWidth > n.clientWidth + 1).map((n) => n.textContent.trim()));
    ok(coupe.length === 0, '[A] au telephone, aucune phrase du bandeau ni des tuiles n est coupee', coupe.join(' | '));
    await tel.ctx.close();

    // =====================================================================
    console.log('');
    console.log('[B] TOUT EST FAIT');
    // =====================================================================
    const bb = await ouvrir(browser, { journee: REGLEE, maintenance: [], boite: 'vide' });
    await attendreAccueil(bb.page, () => /Tout est à jour/.test((document.querySelector('.dash-hello-line') || {}).textContent || ''));
    const vb = await lire(bb.page);
    ok(vb.etat.texte === 'Tout est à jour' && vb.etat.ton === 'tone-ok' && vb.etat.bouton === false && vb.rows.length === 0 && vb.pastille === null,
      '[B] la pastille dit « Tout est à jour », en vert, quand la liste est vide et la boite lue', JSON.stringify(vb.etat));
    ok(vb.videClair && /^Tout est à jour/.test(vb.vide || ''), '[B] la carte dit « Tout est à jour »', `« ${vb.vide} »`);
    ok(vb.videOk, '[B] la carte vide porte la coche verte');
    ok(vb.bande.late && vb.bande.late.valeur === 'Aucun' && vb.bande.late.ton === 'tone-ok' && vb.bande.closing && vb.bande.closing.valeur === 'Rien' && vb.bande.closing.ton === 'tone-ok',
      '[B] le bandeau est calme : aucun retard, rien a cloturer', JSON.stringify({ late: vb.bande.late, closing: vb.bande.closing }));
    ok(bb.erreurs.length === 0, '[B] aucune erreur JavaScript', bb.erreurs.slice(0, 3).join(' | '));
    await bb.ctx.close();

    // =====================================================================
    console.log('');
    console.log('[C] BOITE ILLISIBLE');
    // =====================================================================
    const c = await ouvrir(browser, { journee: REGLEE, maintenance: [], boite: 'panne' });
    await attendreAccueil(c.page, () => Boolean(document.querySelector('.dash-todo-empty')));
    await c.page.waitForFunction(() => dashInbox.done === true, null, { timeout: 8000 }).catch(() => {});
    const vc = await lire(c.page);
    ok(vc.etat.texte === 'Aucune alerte sur la journée', '[C] la pastille du haut', `« ${vc.etat.texte} »`);
    ok(Boolean(vc.vide) && vc.vide.indexOf('Tout est à jour') < 0 && !vc.videClair && /La boîte mail n'a pas pu être lue/.test(vc.vide), '[C] la carte ne dit pas « Tout est à jour »', `« ${vc.vide} »`);
    ok(vc.etat.ton === 'tone-unknown', '[C] la pastille reste neutre sur un compte inconnu (ni verte, ni rouge)', vc.etat.ton);
    ok(c.erreurs.length === 0, '[C] aucune erreur JavaScript', c.erreurs.slice(0, 3).join(' | '));

    // =====================================================================
    console.log('');
    console.log('[D] LES REGLES');
    // =====================================================================
    const regles = await c.page.evaluate(({ jours, journee }) => {
      const garde = state.currentDate;
      const aDate = (date) => journee.map((r) => ({ ...r, date }));
      // Le bandeau : le jour meme seulement.
      state.currentDate = jours.hier; const passe = getStaffDashNow(aDate(jours.hier));
      state.currentDate = jours.demain; const futur = getStaffDashNow(aDate(jours.demain));
      state.currentDate = garde;
      const auj = getStaffDashNow(journee);
      const payeEnCours = getStaffDashNow(journee.map((r) => (r.id === 'r-retard' ? { ...r, status: 'paid' } : r)));
      // La reference : le meme jour la semaine d avant, jamais pour une date future.
      const serie = (fin, auJour) => Array.from({ length: 14 }, (_, i) => {
        const date = addDays(fin, i - 13);
        return date === auJour ? { date, reservations: 3, players: 12, revenue: 210, collected: 210, laneHours: 2 } : { date, reservations: 9, players: 40, revenue: 600, collected: 600, laneHours: 6 };
      });
      const cle = (d) => `${getCurrentStaffCenterId()}|${d}`;
      staffDaySeriesCache.set(cle(garde), { days: serie(garde, addDays(garde, -7)), at: Date.now(), loading: false });
      const mAuj = getStaffDashboardMetrics(journee);
      staffDaySeriesCache.set(cle(jours.demain), { days: serie(jours.demain, addDays(jours.demain, -7)), at: Date.now(), loading: false });
      state.currentDate = jours.demain; const mFutur = getStaffDashboardMetrics(aDate(jours.demain));
      // Les paiements non soldes : une date passee les garde, le jour meme non.
      state.currentDate = jours.hier;
      const alertesPasse = getStaffDashboardAlertDefinitions(getStaffDashboardMetrics(aDate(jours.hier)));
      state.currentDate = garde;
      const alertesAuj = getStaffDashboardAlertDefinitions(getStaffDashboardMetrics(journee));
      staffDaySeriesCache.delete(cle(garde));
      staffDaySeriesCache.delete(cle(jours.demain));
      const session = state.staffAuthSession;
      const essai = (member) => { state.staffAuthSession = { ...session, member }; return getStaffGreetingFirstName(); };
      const prenoms = {
        centre: essai({ ...session.member, name: 'Fun Galaxy Libramont' }),
        plateforme: essai({ ...session.member, name: 'Proprietaire plateforme' }),
        secours: essai({ ...session.member, name: 'Marie Dupont', emergency: true }),
        personne: essai({ ...session.member, name: 'Marie Dupont' }),
      };
      state.staffAuthSession = session;
      const ids = (items) => (items || []).map((item) => item.reservation.id).join(',');
      const paiement = alertesPasse.find((alerte) => alerte.kind === 'payment');
      return {
        passe, futur,
        auj: auj && { late: ids(auj.late), onsite: ids(auj.onsite), closing: ids(auj.closing), next: ids(auj.next), later: ids(auj.later) },
        payeEnCours: payeEnCours && { late: ids(payeEnCours.late), onsite: ids(payeEnCours.onsite) },
        reference: { date: mAuj.referenceDate, attendue: addDays(garde, -7), resa: mAuj.referenceReservations, joueurs: mAuj.referencePlayers, ca: mAuj.referenceRevenue },
        referenceFutur: mFutur.referenceReservations,
        paiementPasse: paiement ? paiement.rows.map((r) => r.id).sort().join(',') : null,
        kindsPasse: alertesPasse.map((alerte) => alerte.kind).join(','),
        kindsAuj: alertesAuj.map((alerte) => alerte.kind).join(','),
        prenoms,
        soir: getStaffGreetingWord(new Date(2026, 8, 25, 19, 0)),
        matin: getStaffGreetingWord(new Date(2026, 8, 25, 9, 0)),
      };
    }, { jours: { hier: '2026-09-24', demain: '2026-09-26' }, journee: JOURNEE });
    ok(regles.passe === null && regles.futur === null && Boolean(regles.auj), '[D] pas de bandeau « En ce moment » hors du jour meme', `passe ${JSON.stringify(regles.passe)}, futur ${JSON.stringify(regles.futur)}`);
    ok(Boolean(regles.auj) && regles.auj.late === 'r-retard' && regles.auj.onsite === 'r-live' && regles.auj.closing === 'r-fini' && regles.auj.next === '' && regles.auj.later === 'r-next',
      '[D] chaque groupe a une seule place : en retard, sur place, a cloturer, plus tard', JSON.stringify(regles.auj));
    ok(Boolean(regles.payeEnCours) && regles.payeEnCours.late === '' && regles.payeEnCours.onsite.split(',').sort().join(',') === 'r-live,r-retard',
      '[D] un groupe paye n est jamais en retard', JSON.stringify(regles.payeEnCours));
    ok(regles.reference.date === regles.reference.attendue && regles.reference.resa === 3 && regles.reference.joueurs === 12 && regles.reference.ca === 210,
      '[D] la reference est le meme jour la semaine d avant', JSON.stringify(regles.reference));
    ok(regles.referenceFutur === null, '[D] une date future ne se compare pas', String(regles.referenceFutur));
    ok(regles.paiementPasse === 'r-fini,r-live,r-next,r-retard' && regles.kindsPasse.indexOf('noshow') < 0 && regles.kindsPasse.indexOf('overdue') < 0,
      '[D] une date passee garde ses paiements non soldes', `${regles.paiementPasse} (${regles.kindsPasse})`);
    ok(regles.kindsAuj.split(',').indexOf('payment') < 0, '[D] le jour meme, un groupe pas encore venu n est pas un paiement a faire', regles.kindsAuj);
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
        return { classe: s.className, role: s.getAttribute('role'), anneau: Boolean(s.querySelector('.staff-console-spinner')), dessin: Boolean(s.querySelector('.pm, svg')), texte: s.textContent.trim() };
      });
    } catch (error) { charge = { erreur: error.message }; }
    ok(Boolean(charge) && charge.classe === 'staff-console-loading' && charge.role === 'status' && charge.anneau && !charge.dessin && charge.texte === 'Chargement de la console…',
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

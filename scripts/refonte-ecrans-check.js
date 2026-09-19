// LES DEUX ECRANS DU PARCOURS, REFONDUS. Un gate par defaut nomme.
//
// Movsar, 2026-09-18, capture a l appui :
//
//   « YA TROP de texte inutile pas simple a comprendre pas usage friendly par
//     exemple pour laser game ya 3phrases c trop et souvent ca dit la meme
//     chose et moche en pllus trop ia pas assez facile comprehensible faut
//     gamifie de maniere vraiment pro / en bas ya aussi 2bloc alors que on peut
//     en faire un bloc bcp plus beau facile a comprendre et usage friendly
//     aussi genre le "sans horaire" pq a part ? »
//
//   et, sur l ecran d avant : « tous ceux a qui jai montrer ils ont du passer
//   2minutes a comprendre ».
//
// CE QUI EST TENU ICI, sur le vrai tunnel dans un navigateur :
//   [1] l etape Laser Game ne dit pas deux fois la meme chose ;
//   [2] le bas de l ecran est UN bloc, pas deux ;
//   [3] ce qui se vit « sans horaire » est une ligne de ce bloc, et il ne
//       disparait pas pour autant ;
//   [4] le recapitulatif se lit dans l ordre de la visite : on arrive, puis on
//       joue ;
//   [5] l ecran des reglages pose une QUESTION par activite, et dit ce que ces
//       choix coutent ;
//   [6] contre-epreuve : remettre la redite du laser rend ce gate rouge.
//
// CE QUI N EST PAS TENU ICI : que l ecran soit beau. Un gate ne juge pas le
// gout. Il tient les faits que Movsar a nommes, et qui se comptent.
//
// Lancement : node scripts/refonte-ecrans-check.js
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP_JS = path.join(ROOT, 'assets/app-main.js');
const CSS = path.join(ROOT, 'assets/pinlane-client.css');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright-core'));
const PORT = Number(process.env.PINLANE_REFONTE_PORT || 4267);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

function nextSaturday() {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).split('-').map(Number);
  const c = new Date(Date.UTC(y, m - 1, d));
  do { c.setUTCDate(c.getUTCDate() + 1); } while (c.getUTCDay() !== 6);
  return c.toISOString().slice(0, 10);
}
const DATE = nextSaturday();

// Le .env local porte la production : l instantane est neutralise AVANT que
// l API ne soit chargee, donc aucune lecture de base.
const database = require(path.join(ROOT, 'lib/database'));
database.readAvailabilitySnapshot = async () => ({ reservations: [], laneStatuses: {}, blocks: [], date: DATE, centerId: 'libramont' });
let availability = require(path.join(ROOT, 'api/public-availability.js'));

// RECHARGER L API APRES AVOIR MUTE LE MOTEUR. Un fichier mute sur le disque ne
// change rien a un module deja require : la contre-epreuve du bloc [10] ne
// mordrait pas et se tairait. On vide donc le cache du moteur ET de tout ce qui
// le require sur ce chemin. Le module lib/database n est PAS vide : c est sur lui
// que l instantane est neutralise plus haut, et le rechargement de l API va le
// relire tel quel.
const MODULES_DU_MOTEUR = [
  'lib/ops-engine.js', 'lib/availability-slots.js', 'lib/booking-complements.js',
  'lib/ops-agents.js', 'api/public-availability.js',
];
function rechargerLApi() {
  MODULES_DU_MOTEUR.forEach((m) => { delete require.cache[require.resolve(path.join(ROOT, m))]; });
  availability = require(path.join(ROOT, 'api/public-availability.js'));
}

let failures = 0;
function record(label, cond, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` :: ${detail}` : ''}`);
  if (!cond) failures += 1;
  return cond;
}
function section(titre) { console.log(`\n--- ${titre}`); }

const ACTIVITIES = [
  { id: 'bowling', name: 'Bowling', planned: true, priceType: 'grid_bowling', priceValue: null, unitLabel: 'par piste', order: 1, defaultMinutes: 60 },
  { id: 'laser_game', name: 'Laser Game', planned: true, priceType: 'grid_laser', priceValue: null, unitLabel: 'par personne', order: 2, defaultMinutes: 22 },
  { id: 'minigolf_blacklight', name: 'Minigolf Blacklight', planned: false, priceType: 'per_pax', priceValue: null, unitLabel: 'par personne', note: '12 niveaux', order: 3, defaultMinutes: 45 },
  { id: 'billards', name: 'Billards', planned: false, priceType: 'per_unit_hour', priceValue: null, unitLabel: 'par table et par heure', order: 5, defaultMinutes: 60, minMinutes: 60, maxMinutes: 180, stepMinutes: 60 },
  { id: 'arcade_time', name: 'Arcades', planned: false, priceType: 'per_pax', priceValue: null, unitLabel: '', order: 6, defaultMinutes: 30 },
  { id: 'playground', name: 'Playground', planned: false, priceType: 'per_pax', priceValue: 12, unitLabel: 'par enfant', order: 7, defaultMinutes: 60 },
  { id: 'duckpin_bowling', name: 'Duckpin Bowling', planned: false, priceType: 'grid_bowling', priceValue: null, unitLabel: 'par piste', order: 8, defaultMinutes: 60 },
  { id: 'fun_run', name: 'Fun Run by PIXEL', planned: false, priceType: 'grid_fun_run', priceValue: null, unitLabel: 'par session', note: '5 joueurs max.', order: 9, defaultMinutes: 15 },
];

function metaPayload() {
  return {
    ok: true, today: DATE, durationOptions: [], formules: [], activities: ACTIVITIES,
    center: {
      id: 'libramont', status: 'active',
      defaultSchedule: { regular: { 0: { open: '10:00', close: '22:00' }, 1: null, 2: { open: '14:00', close: '22:00' }, 3: { open: '12:00', close: '22:00' }, 4: { open: '14:00', close: '22:00' }, 5: { open: '14:00', close: '24:00' }, 6: { open: '10:00', close: '24:00' } }, holiday: {} },
      holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] }, offerAvailability: {},
      day: { date: DATE, open: true, schedule: { open: 10, close: 24, label: '10h - Minuit' }, closedLabel: '', closedWindows: [], unavailableFormulaIds: [], unavailableActivityIds: [], unavailableFormulaReason: {} },
    },
  };
}

function serveStatic() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, BASE_URL);
    if (url.pathname === '/api/public-booking-meta') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(metaPayload()));
      return;
    }
    if (url.pathname === '/api/public-availability') {
      try { await availability(req, res); } catch (error) { res.writeHead(500); res.end(JSON.stringify({ ok: false })); }
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    let p = decodeURIComponent(url.pathname);
    if (p === '/' || p === '/reserver' || p.startsWith('/reserver/')) p = '/index.html';
    const filePath = path.resolve(path.join(ROOT, p));
    if (!filePath.startsWith(path.resolve(ROOT))) { res.writeHead(403); res.end(); return; }
    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(content);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

// LES VAGUES DU GROUPE, TELLES QUE LES DEUX ECRANS LES ANNONCENT.
// On lit le plan du creneau (ce que le moteur a reellement pose), la ligne
// « Vos rendez-vous » de la carte de visite, et les rendez-vous du
// recapitulatif de validation apres que le VRAI chargeur a pose le plan.
async function releverLesVagues(page, options) {
  const valider = !options || options.valider !== false;
  const avantClic = await page.evaluate(() => {
    const i = typeof getCurrentFormulaAnchorSlotIndex === 'function' ? getCurrentFormulaAnchorSlotIndex() : -1;
    const slot = i >= 0 ? (state.availableSlots || [])[i] : null;
    const blocs = ((slot && slot.opsPlan && slot.opsPlan.resourceBlocks) || [])
      .filter((b) => b.resourceType === 'laser_arena' && b.startTime)
      .map((b) => ({
        debut: b.startTime,
        partie: Number(b.countIndex || 1),
        vague: Number(b.groupWaveIndex || 1),
        vagues: Number(b.groupWaveCount || 1),
        joueurs: Number(b.players || 0),
      }));
    const ligne = [...document.querySelectorAll('.visit-line')]
      .map((l) => l.textContent.replace(/\s+/g, ' ').trim())
      .find((t) => /rendez-vous/i.test(t)) || '';
    return { pax: state.booking.pax, blocs, ligneVisite: ligne };
  });
  // Le VRAI chargeur : « Valider ces horaires » appelle selectSlot, qui pose
  // opsPlan sur la reservation. C est ce que le recapitulatif de validation
  // relit ensuite.
  const bouton = valider ? await page.$('.formula-plan-confirm') : null;
  if (bouton) await bouton.click().catch(() => {});
  if (valider) await page.waitForTimeout(1600);
  const recapValidation = !valider ? null : await page.evaluate(() => {
    if (typeof getFormulaRecapModel !== 'function') return null;
    const modele = getFormulaRecapModel(state.booking);
    return modele && Array.isArray(modele.appointments) ? modele.appointments : null;
  });
  return {
    ...avantClic,
    heuresDistinctes: [...new Set(avantClic.blocs.map((b) => b.debut))].sort(),
    partiesDistinctes: new Set(avantClic.blocs.map((b) => b.partie)).size,
    recapValidation,
  };
}

// Le parcours d un client, jusqu aux deux ecrans : 49 joueurs (l effectif de la
// capture), bowling + laser + minigolf, et trois parties de laser. Le minigolf
// est ce qui fait apparaitre le « sans horaire ».
// LE NOMBRE DE JOUEURS EST UN PARAMETRE depuis le 2026-09-19 : le bloc [11]
// a besoin d un groupe que les pistes ne peuvent pas recevoir d un coup. Les
// autres blocs gardent 49, et rien ne change pour eux.
async function ouvrirLesDeuxEcrans(browser, etiquette, joueurs = 49) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/reserver/libramont?v=refonte-${etiquette}-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForFunction(() => typeof window.goStep2 === 'function' && document.querySelectorAll('#clientView .activity-card').length >= 8, null, { timeout: 20000 });
  await page.evaluate(({ date, joueurs }) => {
    const d = document.getElementById('fDate');
    d.value = date; d.dispatchEvent(new Event('change', { bubbles: true }));
    const p = document.getElementById('fPax');
    if (p) { p.value = String(joueurs); p.dispatchEvent(new Event('change', { bubbles: true })); p.dispatchEvent(new Event('input', { bubbles: true })); }
  }, { date: DATE, joueurs });
  await page.waitForTimeout(600);
  const grilleVisible = () => page.evaluate(() => {
    const g = document.querySelector('#clientView .activity-grid');
    return Boolean(g) && g.getBoundingClientRect().height > 0;
  });
  for (let i = 0; i < 4 && !(await grilleVisible()); i += 1) {
    const c = page.locator('#btnVenueContinue');
    if (!(await c.isVisible().catch(() => false))) break;
    await c.click({ timeout: 4000 });
    await page.waitForTimeout(450);
  }
  if (!(await grilleVisible())) throw new Error('montage impossible : grille des activites masquee');
  for (const id of ['bowling', 'laser_game', 'minigolf_blacklight']) {
    const t = page.locator(`#clientView .activity-card[data-activity="${id}"] .activity-toggle`).first();
    if ((await t.getAttribute('aria-pressed')) !== 'true') await t.click({ timeout: 6000 });
    await page.waitForTimeout(300);
  }
  await page.locator('#btnStep1').click({ timeout: 6000 });
  await page.waitForTimeout(900);
  return { context, page };
}

async function allerAuxHeures(page) {
  await page.evaluate(() => {
    const p = document.querySelector('[data-activity-options="laser_game"] [data-opt="games"][data-val="3"]');
    if (p) p.click();
  });
  await page.waitForTimeout(500);
  await page.locator('#btnStep1').click({ timeout: 6000 });
  await page.waitForFunction(() => document.querySelectorAll('.anchor-row[data-anchor] .anchor-chip').length > 10, null, { timeout: 25000 });
  await page.waitForTimeout(1200);
}

// Ce que le client LIT dans un element : une ligne par noeud de texte visible.
// C est ainsi qu on compte une redite, pas en lisant la source.
const LIGNES_DE = (selecteur) => {
  const racine = document.querySelector(selecteur);
  if (!racine) return null;
  const out = [];
  const walker = document.createTreeWalker(racine, NodeFilter.SHOW_TEXT);
  let n = walker.nextNode();
  while (n) {
    const t = (n.textContent || '').replace(/\s+/g, ' ').trim();
    const el = n.parentElement;
    if (t && el && el.offsetParent !== null) out.push(t);
    n = walker.nextNode();
  }
  return out;
};

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const { context, page } = await ouvrirLesDeuxEcrans(browser, 'nominal');
  page.on('pageerror', (e) => record('aucune erreur de page', false, e.message));

  // ====================================================================== [5]
  section('[5] L ecran des reglages : une QUESTION par activite, et ce que ca coute');
  const reglages = await page.evaluate(() => ({
    titre: (document.querySelector('.activity-configurator-title') || {}).textContent || '',
    compteur: (document.querySelector('[data-role="config-count"]') || {}).textContent || '',
    lead: (document.querySelector('.activity-configurator-lead') || {}).textContent || '',
    questions: [...document.querySelectorAll('.activity-config-row.is-visible .activity-config-hint')].map((e) => e.textContent.trim()),
  }));
  record('montage : l ecran des reglages est bien monte', reglages.titre.length > 3 && reglages.questions.length >= 2,
    JSON.stringify(reglages.questions));
  reglages.questions.forEach((q) => record(`« ${q} » est une question`, /\?$/.test(q)));
  record('le compteur parle d ACTIVITES, pas de « reglages actifs »',
    /activité/i.test(reglages.compteur) && !/réglages? actif/i.test(reglages.compteur), JSON.stringify(reglages.compteur));
  record('l ecran dit que rien ne se paie a l avance',
    /avance|sur place/i.test(reglages.lead), JSON.stringify(reglages.lead));

  await allerAuxHeures(page);

  // ====================================================================== [1]
  section('[1] L etape Laser Game ne dit pas deux fois la meme chose');
  const laser = await page.evaluate((sel) => {
    const racine = document.querySelector(sel);
    const tete = racine ? racine.querySelector('.anchor-row-head') : null;
    const out = [];
    if (tete) {
      const walker = document.createTreeWalker(tete, NodeFilter.SHOW_TEXT);
      let n = walker.nextNode();
      while (n) {
        const t = (n.textContent || '').replace(/\s+/g, ' ').trim();
        if (t && n.parentElement && n.parentElement.offsetParent !== null) out.push(t);
        n = walker.nextNode();
      }
    }
    return {
      teteLignes: out,
      compteur: ((racine && racine.querySelector('.anchor-part-count')) || {}).textContent || '',
      detail: ((tete && tete.querySelector('small')) || {}).textContent || '',
    };
  }, '.anchor-row[data-anchor="laser_game"]');
  record('montage : l etape laser porte bien son compteur', laser.compteur.length > 10, JSON.stringify(laser.compteur));
  // LA REDITE, MESUREE : le nombre de parties achetees ne s ecrit qu une fois
  // dans la tete de l etape. Avant la refonte, « 3 parties » etait dans la
  // ligne de detail ET dans le compteur.
  const texteLaser = `${laser.teteLignes.join(' ')} ${laser.compteur}`;
  const fois = (texteLaser.match(/3 parties/g) || []).length;
  record('« 3 parties » est ecrit UNE fois, pas deux', fois === 1, `${fois} fois :: ${JSON.stringify(texteLaser.slice(0, 140))}`);
  record('et la ligne de detail redondante a disparu de la tete', laser.detail.trim() === '', JSON.stringify(laser.detail));
  record('le compteur porte TOUT : parties achetees, heures posees, et le reste',
    /3 partie/.test(laser.compteur) && /heure/.test(laser.compteur) && /quipe/i.test(laser.compteur),
    JSON.stringify(laser.compteur));

  // ====================================================================== [2]
  section('[2] Le bas de l ecran est UN bloc, pas deux');
  const bas = await page.evaluate(() => ({
    etapesLibres: document.querySelectorAll('.visit-rail-step-free').length,
    panneaux: document.querySelectorAll('#slotList .formula-program-panel, #slotList .anchor-status').length,
    passDansPanneau: Boolean(document.querySelector('.formula-visit-summary .anchor-free-pass')),
    passHorsPanneau: Boolean(document.querySelector('.anchor-free-pass:not(.formula-visit-summary .anchor-free-pass)')
      && !document.querySelector('.formula-visit-summary .anchor-free-pass')),
  }));
  record('plus aucune etape « sans horaire » a part dans le fil', bas.etapesLibres === 0, `${bas.etapesLibres}`);
  record('un SEUL panneau en bas de l ecran', bas.panneaux === 1, `${bas.panneaux}`);

  // ====================================================================== [3]
  section('[3] Ce qui se vit sans horaire n a pas disparu pour autant');
  const libre = await page.evaluate(() => {
    const el = document.querySelector('.anchor-free-pass');
    return { present: Boolean(el), texte: el ? el.textContent.replace(/\s+/g, ' ').trim() : '' };
  });
  record('la ligne « sans horaire » est la', libre.present && /Minigolf/i.test(libre.texte), JSON.stringify(libre.texte.slice(0, 110)));
  record('elle est DANS le recapitulatif de la visite', bas.passDansPanneau);
  record('et elle ne porte aucune heure', !/\d{1,2}:\d{2}/.test(libre.texte), JSON.stringify(libre.texte.slice(0, 110)));

  // ====================================================================== [4]
  section('[4] Le recapitulatif se lit dans l ordre de la visite');
  const ordre = await page.evaluate(() => [...document.querySelectorAll('.formula-visit-summary .visit-line .visit-tag')].map((e) => e.textContent.trim()));
  record('montage : le recapitulatif porte plusieurs lignes', ordre.length >= 3, JSON.stringify(ordre));
  record('l ARRIVEE vient en premier (c est la seule heure a retenir)',
    ordre[0] === 'Arrivée', JSON.stringify(ordre));
  record('et ce qui se vit sans horaire vient en dernier',
    /Sans horaire|Pass liberté/.test(ordre[ordre.length - 1] || ''), JSON.stringify(ordre));

  // ====================================================================== [7]
  section('[7] Une heure qui coince reste cliquable, et elle DIT pourquoi');
  // Movsar, 2026-09-18 : « ya toujours des fois ou des boutons sont impossible
  // a cliquer. Non, meme si ca coince faut que ce soit cliquable, mais explique
  // alors, sous un ptit design pointille [...] avec un i en rond ».
  // La situation se monte pour de vrai : on retient les TROIS heures de laser,
  // ce qui bloque les autres.
  await page.evaluate(() => {
    const ligne = document.querySelector('.anchor-row[data-anchor="laser_game"]');
    const libres = [...(ligne ? ligne.querySelectorAll('.anchor-chip:not(.active):not([data-coince])') : [])];
    libres.slice(0, 2).forEach((c) => c.click());
  });
  await page.waitForTimeout(2500);
  const coince = await page.evaluate(() => {
    const ligne = document.querySelector('.anchor-row[data-anchor="laser_game"]');
    const bloquees = [...(ligne ? ligne.querySelectorAll('.anchor-chip[aria-disabled="true"]') : [])];
    return {
      retenues: [...(ligne ? ligne.querySelectorAll('.anchor-chip.active') : [])].length,
      bloquees: bloquees.length,
      mortes: bloquees.filter((c) => c.disabled).length,
      sansRaison: bloquees.filter((c) => !(c.getAttribute('data-coince') || '').trim()).length,
      sansInfo: bloquees.filter((c) => !c.querySelector('.slot-card-info')).length,
      horsClavier: bloquees.filter((c) => c.tabIndex < 0).length,
      pointille: bloquees.length ? getComputedStyle(bloquees[0]).borderStyle : '',
      exemple: bloquees.length ? bloquees[0].getAttribute('data-coince') : '',
    };
  });
  record('montage : les trois heures sont retenues, donc les autres coincent',
    coince.retenues === 3 && coince.bloquees > 0, JSON.stringify({ retenues: coince.retenues, bloquees: coince.bloquees }));
  record('AUCUNE n est morte : elles restent cliquables', coince.mortes === 0, `${coince.mortes} morte(s)`);
  record('chacune porte sa raison', coince.sansRaison === 0, `${coince.sansRaison} sans raison :: ${JSON.stringify(coince.exemple)}`);
  record('chacune porte la pastille ⓘ', coince.sansInfo === 0, `${coince.sansInfo} sans ⓘ`);
  record('chacune reste atteignable au clavier', coince.horsClavier === 0, `${coince.horsClavier} hors du parcours`);
  record('et leur contour est pointille', coince.pointille === 'dashed', coince.pointille);

  // LE ROUGE NE SERT QUE POUR UN OBSTACLE. Quand le client coche « l equipe
  // place mes parties », les 28 heures coincent d un coup : les peindre en
  // rouge ferait une alarme pour un etat parfaitement normal, qu il a choisi.
  const motifs = await page.evaluate(() => {
    const lire = () => [...document.querySelectorAll('.anchor-row[data-anchor="laser_game"] .anchor-chip[data-coince]')]
      .map((c) => ({ motif: c.getAttribute('data-coince-motif'), bord: getComputedStyle(c).borderTopColor }));
    const pleines = lire();
    const case_ = document.querySelector('.anchor-row[data-anchor="laser_game"] .anchor-onsite input');
    if (case_) { case_.checked = true; case_.dispatchEvent(new Event('change', { bubbles: true })); }
    return { pleines, cocheFaite: Boolean(case_) };
  });
  // UN TROISIEME MOTIF EXISTE DEPUIS LE 2026-09-19 : « vague », les heures que
  // les propres passages du groupe emportent (bloc [10]). Ce n est ni un
  // obstacle du centre ni une decision du client : elles sont peintes en
  // accent, pas en rouge. La regle tenue ici reste la meme qu avant : avec une
  // liste pleine, AUCUNE heure ne se presente comme un choix du client, et
  // l obstacle est bien present. Asserter « toutes obstacle » etait une
  // formulation, pas la regle.
  record('liste pleine : le motif est un OBSTACLE, jamais un choix du client',
    motifs.pleines.length > 0
      && motifs.pleines.every((m) => m.motif === 'obstacle' || m.motif === 'vague')
      && motifs.pleines.some((m) => m.motif === 'obstacle'),
    JSON.stringify([...new Set(motifs.pleines.map((m) => m.motif))]));
  await page.waitForTimeout(2200);
  const choix = await page.evaluate(() => {
    const chips = [...document.querySelectorAll('.anchor-row[data-anchor="laser_game"] .anchor-chip[data-coince]')];
    const rouge = getComputedStyle(document.documentElement).getPropertyValue('--danger').trim();
    return {
      n: chips.length,
      motifs: [...new Set(chips.map((c) => c.getAttribute('data-coince-motif')))],
      bords: [...new Set(chips.map((c) => getComputedStyle(c).borderTopColor))],
      styles: [...new Set(chips.map((c) => getComputedStyle(c).borderTopStyle))],
      rouge,
    };
  });
  record('montage : cocher « l equipe place mes parties » fait coincer toute la grille',
    motifs.cocheFaite && choix.n >= 10, JSON.stringify({ coche: motifs.cocheFaite, n: choix.n }));
  record('et ce cas-la porte le motif « choix », pas « obstacle »',
    choix.motifs.length === 1 && choix.motifs[0] === 'choix', JSON.stringify(choix.motifs));
  record('donc AUCUNE de ces heures n est peinte en rouge',
    choix.bords.every((b) => !b.includes('203, 42, 47') && !b.includes('247, 85, 85')), JSON.stringify(choix.bords));
  record('elles restent pointillees (l heure n est pas prenable)',
    choix.styles.length === 1 && choix.styles[0] === 'dashed', JSON.stringify(choix.styles));

  // On remet la case comme avant, pour que les blocs suivants mesurent l etat
  // nominal et pas celui-ci.
  await page.evaluate(() => {
    const c = document.querySelector('.anchor-row[data-anchor="laser_game"] .anchor-onsite input');
    if (c) { c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  await page.waitForTimeout(2200);

  // Le clic OUVRE l explication, au lieu de ne rien faire.
  const apresClic = await page.evaluate(() => {
    const c = document.querySelector('.anchor-row[data-anchor="laser_game"] .anchor-chip[aria-disabled="true"]');
    if (!c) return null;
    // AVANT / APRES, pas un chiffre en dur : le bloc du motif a coche puis
    // decoche la case juste au-dessus, ce qui a remis les choix a zero. Un
    // « 3 » ecrit ici affirmerait un etat que ce gate ne monte plus.
    const avant = document.querySelectorAll('.anchor-row[data-anchor="laser_game"] .anchor-chip.active').length;
    c.click();
    const bulle = c.querySelector('.slot-card-why');
    return {
      ouverte: c.hasAttribute('data-coince-ouvert'),
      visible: bulle ? getComputedStyle(bulle).display !== 'none' : false,
      texte: bulle ? bulle.textContent.trim() : '',
      retenuesAvant: avant,
      retenuesApres: document.querySelectorAll('.anchor-row[data-anchor="laser_game"] .anchor-chip.active').length,
    };
  });
  record('cliquer une heure qui coince OUVRE son explication', Boolean(apresClic && apresClic.ouverte && apresClic.visible),
    JSON.stringify(apresClic && apresClic.texte.slice(0, 90)));
  record('et ne change RIEN au choix du client',
    Boolean(apresClic) && apresClic.retenuesApres === apresClic.retenuesAvant,
    `${apresClic && apresClic.retenuesAvant} -> ${apresClic && apresClic.retenuesApres}`);

  // LA BULLE RESTE CHEZ ELLE. Centree sur sa pastille, elle debordait de la
  // colonne et se posait sur le panneau voisin ; on la recadre sur la grille.
  // Sans ce controle, la correction se perd au premier changement de largeur.
  const dedans = await page.evaluate(() => {
    const ouverte = document.querySelector('.anchor-chip[data-coince-ouvert]');
    const bulle = ouverte ? ouverte.querySelector('.slot-card-why') : null;
    const grille = ouverte ? ouverte.closest('.anchor-chip-grid') : null;
    if (!bulle || !grille) return null;
    const b = bulle.getBoundingClientRect();
    const g = grille.getBoundingClientRect();
    return { deborde: Math.round(Math.max(0, g.left - b.left) + Math.max(0, b.right - g.right)), largeur: Math.round(b.width) };
  });
  record('la bulle ne deborde pas de sa grille d heures',
    Boolean(dedans) && dedans.deborde === 0, JSON.stringify(dedans));

  // ====================================================================== [8]
  section('[8] Les pastilles d heure ont toutes la meme hauteur');
  // Movsar : « des fois les boutons sont gros des fois ils sont petits donc
  // jaime pas dutout ». Une rangee de grille prend la hauteur de son element le
  // plus haut : sans egalisation, deux rangees voisines n avaient pas la meme.
  // Toutes les periodes ouvertes : c est la liste complete que le client
  // balaye, et c est la qu il voyait des tailles differentes.
  // TOUTES les periodes de TOUTES les activites : c est l ecran entier que
  // Movsar balaye, et l ecart mesure en production etait ENTRE deux activites.
  await page.evaluate(() => {
    document.querySelectorAll('.slot-period:not(.is-open) .slot-period-head').forEach((h) => h.click());
  });
  await page.waitForTimeout(900);
  // Le releve sert deux fois : au bureau et au telephone. Une seule fonction,
  // pour que les deux largeurs soient jugees a la meme aune.
  const releverHauteurs = async (pg) => pg.evaluate(() => {
    const grilles = [...document.querySelectorAll('.anchor-chip-grid')]
      .filter((g) => g.getBoundingClientRect().height > 0);
    const parGrille = grilles.map((g) => {
      const h = [...g.querySelectorAll('.anchor-chip')].map((c) => Math.round(c.getBoundingClientRect().height));
      const rangee = g.closest('.anchor-row');
      return {
        ou: rangee ? rangee.getAttribute('data-anchor') : '?',
        n: h.length,
        distinctes: [...new Set(h)].length,
        min: Math.min(...h),
        max: Math.max(...h),
      };
    });
    const toutes = [...document.querySelectorAll('.anchor-chip')]
      .filter((c) => c.getBoundingClientRect().height > 0)
      .map((c) => Math.round(c.getBoundingClientRect().height));
    // LA PLUS HAUTE, ET CE QU ELLE PORTE. Un gate qui dit seulement « 83 px »
    // laisse regler un chiffre a tatons ; celui qui nomme la structure dit
    // quoi corriger.
    const visibles = [...document.querySelectorAll('.anchor-chip')]
      .filter((c) => c.getBoundingClientRect().height > 0);
    const plusHaute = visibles.reduce((m, c) => (
      c.getBoundingClientRect().height > (m ? m.getBoundingClientRect().height : 0) ? c : m
    ), null);
    return {
      grilles: parGrille.length,
      total: toutes.length,
      hauteursDeLEcran: [...new Set(toutes)].sort((a, b) => a - b),
      parGrille,
      laPlusHaute: plusHaute ? {
        h: Math.round(plusHaute.getBoundingClientRect().height),
        structure: [...plusHaute.children].map((e) => String(e.className).trim().split(/\s+/)[0]).join('+'),
        lignes: [...plusHaute.children].map((e) => `${String(e.className).trim().split(/\s+/)[0]}=${Math.round(e.getBoundingClientRect().height)}px`).join(' '),
        txt: (plusHaute.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60),
      } : null,
    };
  });

  const hauteurs = await releverHauteurs(page);
  record('montage : l ecran porte plusieurs listes et assez de pastilles pour comparer',
    hauteurs && hauteurs.total >= 20 && hauteurs.grilles >= 2,
    JSON.stringify({ grilles: hauteurs.grilles, total: hauteurs.total }));
  // Une liste ouverte = une grille. C est DANS une liste que Movsar voyait des
  // cases de tailles differentes cote a cote.
  const bancales = (hauteurs.parGrille || []).filter((g) => g.distinctes !== 1);
  record('dans chaque liste, toutes les pastilles ont la MEME hauteur',
    bancales.length === 0, JSON.stringify(bancales.length ? bancales : hauteurs.parGrille));
  // ET ENTRE LES LISTES. C est la moitie de la regle qui manquait : mesuree en
  // production le 2026-09-18, une grille tombait a 67 px et sa voisine a
  // 51 px, chacune parfaitement uniforme de son cote.
  record('et d une liste a l autre, la hauteur ne change pas non plus',
    (hauteurs.hauteursDeLEcran || []).length === 1,
    JSON.stringify({ hauteurs: hauteurs.hauteursDeLEcran, laPlusHaute: hauteurs.laPlusHaute, parGrille: hauteurs.parGrille.map((g) => `${g.ou}:${g.min}-${g.max}`) }));

  // AU TELEPHONE AUSSI, la ou Movsar regarde. Trois colonnes etroites : la
  // pastille n a pas la meme forme, donc pas le meme plancher.
  await page.setViewportSize({ width: 390, height: 1400 });
  await page.waitForTimeout(900);
  // LE MEME ECRAN, PAS UN SOUS-ENSEMBLE. Le changement de largeur replie des
  // periodes : mesurer sans les rouvrir jugeait trois grilles sur six, et une
  // moitie d ecran uniforme ne prouve rien sur l autre.
  await page.evaluate(() => {
    document.querySelectorAll('.slot-period:not(.is-open) .slot-period-head').forEach((h) => h.click());
  });
  await page.waitForTimeout(900);
  // AU TELEPHONE, LE CLIENT VOIT UNE ACTIVITE A LA FOIS. L ecran est pagine
  // (data-mobile-page, « Continuer »), donc mesurer la premiere page jugeait
  // trois grilles sur six. On parcourt les pages, et la regle porte sur leur
  // REUNION : c est le meme client qui les traverse a la suite.
  const pagesTel = [];
  for (let n = 0; n < 6; n += 1) {
    await page.evaluate(() => {
      document.querySelectorAll('.slot-period:not(.is-open) .slot-period-head').forEach((h) => h.click());
    });
    await page.waitForTimeout(700);
    pagesTel.push(await releverHauteurs(page));
    const suivante = await page.$('.anchor-mobile-continue:not([disabled])');
    const dernier = await page.evaluate(() => Boolean(document.querySelector('.formula-anchor-picker[data-mobile-last]')));
    if (!suivante || dernier) break;
    await suivante.click().catch(() => {});
    await page.waitForTimeout(1200);
  }
  // LE COMPTEUR COMPTE DES ACTIVITES, IL DOIT DONC LE DIRE. Il annoncait
  // « Creneau 1 sur 2 » sous « Bowling » : un client qui choisit UNE heure de
  // bowling lisait qu il lui en faut deux.
  const compteurTel = await page.evaluate(() => (
    (document.querySelector('[data-role="anchor-mobile-count"]') || {}).textContent || ''
  ).replace(/\s+/g, ' ').trim());
  record('le compteur du telephone compte des ACTIVITES, et le dit',
    /^Activit/i.test(compteurTel) && /sur \d+/.test(compteurTel) && !/cr[eé]neau/i.test(compteurTel),
    JSON.stringify({ compteur: compteurTel }));

  const activitesTel = [...new Set(pagesTel.flatMap((t) => (t.parGrille || []).map((g) => g.ou)))];
  const totalTel = pagesTel.reduce((acc, t) => acc + t.total, 0);
  const hauteursTel = [...new Set(pagesTel.flatMap((t) => t.hauteursDeLEcran || []))].sort((a, b) => a - b);
  record('montage : les pages telephone couvrent les MEMES activites que le bureau',
    totalTel >= 20 && activitesTel.length >= 2,
    JSON.stringify({ pages: pagesTel.length, total: totalTel, activites: activitesTel }));
  record('au telephone, toutes les pastilles ont la MEME hauteur, page apres page',
    hauteursTel.length === 1,
    JSON.stringify({ hauteurs: hauteursTel, parPage: pagesTel.map((t) => `${(t.parGrille[0] || {}).ou}:${(t.hauteursDeLEcran || []).join('/')}`) }));
  await page.setViewportSize({ width: 1280, height: 1600 });
  await page.waitForTimeout(400);

  // ====================================================================== [9]
  section('[9] Un groupe scinde lit TOUTES ses heures de laser, sur les deux ecrans');
  // 49 joueurs pour une arene de 30 postes : le groupe passe en DEUX vagues
  // (lib/ops-engine.js, splitGroupIntoWaves). Les deux vagues d une meme
  // partie portent le MEME countIndex, et les deux ecrans qui annoncent
  // l heure s en remettaient a cette cle : la carte de visite gardait la
  // derniere vague, le recapitulatif de validation la premiere. Mesure sur la
  // production : pastille 11:00, panneau « Laser Game 11:30 ».
  // On passe par le VRAI chargeur (« Valider ces horaires » appelle
  // selectSlot, qui pose opsPlan sur la reservation) plutot que de fabriquer
  // l entree du calcul : prouver la fonction ne prouve pas qu elle est nourrie.
  const vagues = await releverLesVagues(page);
  record('montage : le plan pose bien PLUSIEURS vagues pour la meme partie',
    vagues.blocs.length >= 2 && vagues.heuresDistinctes.length >= 2 && vagues.partiesDistinctes === 1,
    JSON.stringify({ pax: vagues.pax, blocs: vagues.blocs }));
  const toutesDites = vagues.heuresDistinctes.every((h) => vagues.ligneVisite.includes(h));
  record('la carte de visite annonce CHAQUE vague, pas la derniere',
    vagues.heuresDistinctes.length >= 2 && toutesDites,
    JSON.stringify({ heures: vagues.heuresDistinctes, ligne: vagues.ligneVisite.slice(0, 130) }));
  record('et elle DIT que le groupe passe en plusieurs fois',
    /groupe\s*1\s*sur\s*2/i.test(vagues.ligneVisite) && /groupe\s*2\s*sur\s*2/i.test(vagues.ligneVisite),
    JSON.stringify({ ligne: vagues.ligneVisite.slice(0, 130) }));
  // LES DEUX ECRANS DISENT LA MEME CHOSE. C est l ecart entre eux qui faisait
  // le mensonge : la meme reservation annoncait 11:30 ici et 11:00 la.
  const laserVisite = vagues.ligneVisite.match(/Laser Game \d{2}:\d{2}/g) || [];
  const laserRecap = (vagues.recapValidation || []).filter((t) => /^Laser Game/.test(t))
    .map((t) => (t.match(/Laser Game \d{2}:\d{2}/) || [''])[0]);
  record('le recapitulatif de validation annonce exactement les memes heures',
    laserVisite.length >= 2 && JSON.stringify(laserVisite) === JSON.stringify(laserRecap),
    JSON.stringify({ visite: laserVisite, validation: laserRecap }));

  await context.close();

  // ===================================================================== [10]
  section('[10] Ce que le second passage du groupe emporte est dit, et pointille');
  // Le groupe de 49 ne tient pas dans une arene de 30 : il joue en DEUX
  // passages. Une partie lancee a 10:00 tient donc l arene jusqu a 10:55, et
  // 10:30 est deja prise par le client lui-meme. Avant le 2026-09-18 l ecran
  // offrait 10:30 avec « Bowling se decale » et l acceptait : trois heures
  // retenues 10:00, 10:30, 11:00, soit 49 joueurs dans 30 postes a 10:30.
  const { context: ctx10, page: p10 } = await ouvrirLesDeuxEcrans(browser, 'vagues');
  await allerAuxHeures(p10);
  const LIGNE_LASER = '.anchor-row[data-anchor="laser_game"]';
  // LE MONTAGE, AVANT LE COMPORTEMENT. Le nombre de passages est derive ICI, a
  // partir du nombre de joueurs et de la capacite declaree du centre : ce n est
  // pas la fonction sous test qui le fournit.
  const montage = await p10.evaluate((sel) => ({
    pax: Number(state.booking.pax) || 0,
    postes: typeof getLaserArenaCapacity === 'function' ? getLaserArenaCapacity() : 0,
    pastilles: document.querySelectorAll(`${sel} .anchor-chip`).length,
  }), LIGNE_LASER);
  const passages = montage.postes > 0 ? Math.ceil(montage.pax / montage.postes) : 0;
  record('montage : le groupe ne tient pas en une fois dans l arene',
    montage.pax === 49 && montage.postes > 0 && passages === 2 && montage.pastilles > 10,
    JSON.stringify({ ...montage, passages }));

  // On retient une heure LIBRE, puis on regarde ce que l ecran fait de la
  // suivante. Les heures sont sur la grille des departs (:00/:30) et se
  // suivent dans la liste : la « suivante » est la pastille d apres, prise
  // dans le MEME moment deplie (un moment replie n a pas de pastille a
  // l ecran, et un clic dessus ne serait pas celui d un client).
  const suite = await p10.evaluate((sel) => {
    const chips = [...document.querySelectorAll(`${sel} .slot-period.is-open .anchor-chip`)];
    const index = chips.findIndex((c, i) => i + 1 < chips.length && !c.classList.contains('active')
      && !c.hasAttribute('data-coince') && !c.classList.contains('is-unavailable'));
    return { cliquee: index >= 0 ? chips[index].dataset.time : '', suivante: index >= 0 ? chips[index + 1].dataset.time : '' };
  }, LIGNE_LASER);
  record('montage : une heure libre et son heure suivante existent', Boolean(suite.cliquee && suite.suivante), JSON.stringify(suite));
  const cliquer = (page, heure) => page.evaluate((args) => {
    const chip = document.querySelector(`${args[0]} .anchor-chip[data-time="${args[1]}"]`);
    if (chip) chip.click();
  }, [LIGNE_LASER, heure]);
  await cliquer(p10, suite.cliquee);
  await p10.waitForTimeout(2500);

  const vu = await p10.evaluate((args) => {
    const [sel, heure] = args;
    const chip = document.querySelector(`${sel} .anchor-chip[data-time="${heure}"]`);
    const cliquee = document.querySelector(`${sel} .anchor-chip[data-time="${args[2]}"]`);
    if (!chip) return null;
    const style = getComputedStyle(chip);
    const racine = getComputedStyle(document.documentElement);
    const pas = typeof getVisitRailSteps === 'function' ? getVisitRailSteps() : [];
    const laser = pas.find((s) => s.activity.activityId === 'laser_game');
    const item = laser ? (laser.activity.times || []).find((t) => t.time === heure) : null;
    return {
      motif: chip.getAttribute('data-coince-motif') || '',
      phrase: chip.getAttribute('data-coince') || '',
      secondaire: ((chip.querySelector('.slot-card-meta') || {}).textContent || '').trim(),
      info: Boolean(chip.querySelector('.slot-card-info')),
      pointille: style.borderTopStyle,
      bord: style.borderTopColor,
      danger: (racine.getPropertyValue('--danger') || '').trim(),
      accent: (racine.getPropertyValue('--accent') || '').trim(),
      cliqueeActive: Boolean(cliquee && cliquee.classList.contains('active')),
      retenues: [...document.querySelectorAll(`${sel} .anchor-chip.active`)].map((c) => c.dataset.time),
      moteur: item ? { ok: item.ok !== false, conflit: (item.conflict || {}).activityId || '', raison: item.reason || '' } : null,
    };
  }, [LIGNE_LASER, suite.suivante, suite.cliquee]);
  record('montage : l heure cliquee est bien retenue', Boolean(vu && vu.cliqueeActive), JSON.stringify({ retenues: vu && vu.retenues }));
  record('l heure du second passage porte le motif « vague »', Boolean(vu && vu.motif === 'vague'),
    JSON.stringify({ heure: suite.suivante, motif: vu && vu.motif, phrase: (vu && vu.phrase || '').slice(0, 90) }));
  // POINTILLE, ET PAS ROUGE : ce n est pas une panne, l heure est deja a lui.
  record('elle est en POINTILLE, et son bord n est pas celui d un obstacle',
    Boolean(vu && vu.pointille === 'dashed' && vu.bord && vu.danger && vu.bord !== vu.danger),
    JSON.stringify({ style: vu && vu.pointille, bord: vu && vu.bord, danger: vu && vu.danger }));
  record('elle porte un ⓘ et une phrase qui nomme l autre groupe ET l heure d ou il vient',
    Boolean(vu && vu.info && /groupe/i.test(vu.phrase) && vu.phrase.includes(suite.cliquee)),
    JSON.stringify({ info: vu && vu.info, phrase: (vu && vu.phrase || '').slice(0, 160) }));
  record('son secondaire dit a QUI est l heure, pas la mecanique du moteur',
    Boolean(vu && /groupe/i.test(vu.secondaire) && !/chevauche/i.test(vu.secondaire)),
    JSON.stringify({ secondaire: vu && vu.secondaire }));
  // LE MOTEUR DIT LA MEME CHOSE QUE L ECRAN. Nommer le bowling faisait proposer
  // « On decale », et decaler le bowling ne libere pas l arene.
  record('le moteur nomme le chevauchement INDEPLACABLE : la partie de laser',
    Boolean(vu && vu.moteur && vu.moteur.ok === false && vu.moteur.conflit === 'laser_game'),
    JSON.stringify(vu && vu.moteur));

  // ET SURTOUT : elle ne se prend pas. C est le trou, pas l habillage.
  const avantClic = (vu && vu.retenues || []).join('|');
  await cliquer(p10, suite.suivante);
  await p10.waitForTimeout(2000);
  const apresClicVague = await p10.evaluate((sel) => [...document.querySelectorAll(`${sel} .anchor-chip.active`)].map((c) => c.dataset.time).join('|'), LIGNE_LASER);
  record('cliquer cette heure ne la retient PAS : le clic explique, il ne reserve pas',
    apresClicVague === avantClic, JSON.stringify({ avant: avantClic, apres: apresClicVague }));

  // UNE HEURE RETENUE SE RETIRE TOUJOURS (mesure du 2026-09-18 : 11:00 restait
  // retenue ET disait « pas prenable », et son clic ouvrait une bulle au lieu
  // de la liberer, pendant que le compteur invitait a cliquer pour retirer).
  await cliquer(p10, suite.cliquee);
  await p10.waitForTimeout(2000);
  const apresRetrait = await p10.evaluate((sel) => [...document.querySelectorAll(`${sel} .anchor-chip.active`)].map((c) => c.dataset.time), LIGNE_LASER);
  record('une heure retenue se retire d un clic, toujours',
    !apresRetrait.includes(suite.cliquee), JSON.stringify({ avant: avantClic, apres: apresRetrait.join('|') }));
  await ctx10.close();

  // =================================================== [10] contre-epreuves
  section('[10 bis] Contre-epreuves : sans la regle, ce gate rougit-il ?');
  const appAvant = fs.readFileSync(APP_JS, 'utf8');
  const moteurAvant = fs.readFileSync(path.join(ROOT, 'lib/ops-engine.js'), 'utf8');
  try {
    const fdl = appAvant.includes('\r\n') ? '\r\n' : '\n';
    // (a) L ECRAN : la carte des heures emportees redevient vide. Rien d autre
    // ne bouge, donc ce qui rougit ne peut venir que de cette regle-la.
    const ancre = 'function heuresEmporteesParLeLaser(heuresRetenues, pax) {';
    if (appAvant.split(ancre).length - 1 !== 1) throw new Error('ancre de heuresEmporteesParLeLaser introuvable');
    fs.writeFileSync(APP_JS, appAvant.split(ancre).join(`${ancre}${fdl}  if (true) return new Map();`));
    const { context: ctxA, page: pA } = await ouvrirLesDeuxEcrans(browser, 'vagues-mutant-ecran');
    await allerAuxHeures(pA);
    await cliquer(pA, suite.cliquee);
    await pA.waitForTimeout(2500);
    const sansRegle = await pA.evaluate((args) => {
      const chip = document.querySelector(`${args[0]} .anchor-chip[data-time="${args[1]}"]`);
      return chip ? { motif: chip.getAttribute('data-coince-motif') || '', secondaire: ((chip.querySelector('.slot-card-meta') || {}).textContent || '').trim() } : null;
    }, [LIGNE_LASER, suite.suivante]);
    record('sans la carte des heures emportees, l heure perd son motif « vague » : ce gate ROUGIRAIT',
      Boolean(sansRegle && sansRegle.motif !== 'vague'), JSON.stringify(sansRegle));
    await ctxA.close();
    fs.writeFileSync(APP_JS, appAvant);

    // (b) LE MOTEUR : on remet le premier chevauchement venu, celui qui nommait
    // le bowling. Le module est deja charge : sans rechargement, la mutation ne
    // mordrait pas et la contre-epreuve se tairait.
    const ancreMoteur = `    const hit = windows.find((item) => item.activityId === anchor.activityId && chevauche(item))
      || windows.find(chevauche);`.split('\n').join(moteurAvant.includes('\r\n') ? '\r\n' : '\n');
    if (moteurAvant.split(ancreMoteur).length - 1 !== 1) throw new Error('ancre du chevauchement introuvable');
    fs.writeFileSync(path.join(ROOT, 'lib/ops-engine.js'), moteurAvant.split(ancreMoteur).join('    const hit = windows.find(chevauche);'));
    rechargerLApi();
    const { context: ctxB, page: pB } = await ouvrirLesDeuxEcrans(browser, 'vagues-mutant-moteur');
    await allerAuxHeures(pB);
    await cliquer(pB, suite.cliquee);
    await pB.waitForTimeout(2500);
    const sansPriorite = await pB.evaluate((args) => {
      const pas = typeof getVisitRailSteps === 'function' ? getVisitRailSteps() : [];
      const laser = pas.find((s) => s.activity.activityId === 'laser_game');
      const item = laser ? (laser.activity.times || []).find((t) => t.time === args[1]) : null;
      return item ? { conflit: (item.conflict || {}).activityId || '', raison: item.reason || '' } : null;
    }, [LIGNE_LASER, suite.suivante]);
    record('avec le premier chevauchement venu, le moteur nomme une AUTRE activite : ce gate ROUGIRAIT',
      Boolean(sansPriorite && sansPriorite.conflit && sansPriorite.conflit !== 'laser_game'), JSON.stringify(sansPriorite));
    await ctxB.close();
  } catch (error) {
    record('contre-epreuves des vagues montables', false, error.message);
  } finally {
    fs.writeFileSync(APP_JS, appAvant);
    fs.writeFileSync(path.join(ROOT, 'lib/ops-engine.js'), moteurAvant);
    rechargerLApi();
  }
  record('app-main.js restaure apres les contre-epreuves des vagues', fs.readFileSync(APP_JS, 'utf8') === appAvant);
  record('lib/ops-engine.js restaure apres les contre-epreuves des vagues',
    fs.readFileSync(path.join(ROOT, 'lib/ops-engine.js'), 'utf8') === moteurAvant);

  // ====================================================================== [6]
  // ===================================================================== [11]
  section('[11] A l ecran, le second service de BOWLING se voit et s explique');
  const { context: ctx11, page: p11 } = await ouvrirLesDeuxEcrans(browser, 'bowling-scinde', 70);
  // On ne touche PAS au reglage du laser : une seule partie suffit, et trois
  // parties pour 70 joueurs feraient neuf lancements qui brouilleraient la
  // lecture du bowling.
  await p11.evaluate(() => { const b = document.getElementById('btnStep1'); if (b) b.click(); });
  await p11.waitForFunction(() => document.querySelectorAll('.anchor-row[data-anchor="bowling"] .anchor-chip').length > 10, null, { timeout: 25000 });
  await p11.waitForTimeout(1200);
  const LIGNE_BOWLING = '.anchor-row[data-anchor="bowling"]';
  const montage11 = await p11.evaluate(() => ({
    pax: Number(state.booking.pax) || 0,
    services: typeof splitGroupIntoBowlingServices === 'function' ? splitGroupIntoBowlingServices(Number(state.booking.pax) || 0) : null,
    pastilles: document.querySelectorAll('.anchor-row[data-anchor="bowling"] .anchor-chip').length,
  }));
  record('montage : 70 joueurs ne tiennent pas sur les pistes d un coup',
    montage11.pax === 70 && Array.isArray(montage11.services) && montage11.services.length >= 2 && montage11.pastilles > 10,
    JSON.stringify(montage11));

  const cliquerB = (heure) => p11.evaluate((args) => {
    const chip = document.querySelector(`${args[0]} .anchor-chip[data-time="${args[1]}"]`);
    if (chip) chip.click();
  }, [LIGNE_BOWLING, heure]);
  const libre11 = await p11.evaluate((sel) => {
    const chips = [...document.querySelectorAll(`${sel} .slot-period.is-open .anchor-chip`)];
    const c = chips.find((x) => !x.classList.contains('active') && !x.hasAttribute('data-coince') && !x.classList.contains('is-unavailable'));
    return c ? c.dataset.time : '';
  }, LIGNE_BOWLING);
  record('montage : une heure de bowling est libre', Boolean(libre11), libre11);
  await cliquerB(libre11);
  await p11.waitForTimeout(2500);

  const vu11 = await p11.evaluate((args) => {
    const [sel, heure, duree] = args;
    const minutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
    const lire = (t) => {
      const chip = document.querySelector(`${sel} .anchor-chip[data-time="${t}"]`);
      if (!chip) return null;
      const style = getComputedStyle(chip);
      return {
        heure: t,
        actif: chip.classList.contains('active'),
        motif: chip.getAttribute('data-coince-motif') || '',
        phrase: chip.getAttribute('data-coince') || '',
        meta: ((chip.querySelector('.slot-card-meta') || {}).textContent || '').trim(),
        info: Boolean(chip.querySelector('.slot-card-info')),
        pointille: style.borderTopStyle,
        bord: style.borderTopColor,
      };
    };
    const base = minutes(heure);
    const enTexte = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    return {
      retenue: lire(heure),
      // Dans le PREMIER service : occupee, mais par le groupe qui joue.
      pendantLePremier: lire(enTexte(base + 30)),
      // Le SECOND service commence une duree plus tard.
      secondService: [lire(enTexte(base + duree)), lire(enTexte(base + duree + 30))],
      danger: (getComputedStyle(document.documentElement).getPropertyValue('--danger') || '').trim(),
    };
  }, [LIGNE_BOWLING, libre11, 60]);

  record('montage : l heure cliquee est retenue', Boolean(vu11.retenue && vu11.retenue.actif), JSON.stringify(vu11.retenue));
  record('les heures du SECOND service portent le motif « vague »',
    vu11.secondService.every((c) => c && c.motif === 'vague'),
    JSON.stringify(vu11.secondService.map((c) => c && `${c.heure}:${c.motif}`)));
  record('et leur phrase nomme l autre groupe ET l heure d ou il vient',
    vu11.secondService.every((c) => c && /groupe/i.test(c.phrase) && c.phrase.includes(libre11) && /piste/i.test(c.phrase)),
    JSON.stringify((vu11.secondService[0] || {}).phrase || ''));
  record('elles sont en POINTILLE, et pas peintes comme un obstacle',
    vu11.secondService.every((c) => c && c.pointille === 'dashed' && c.bord && c.bord !== vu11.danger),
    JSON.stringify(vu11.secondService.map((c) => c && `${c.pointille}/${c.bord}`)));
  record('elles portent un i en rond', vu11.secondService.every((c) => c && c.info),
    JSON.stringify(vu11.secondService.map((c) => c && c.info)));
  // CE QUI NE DOIT PAS ETRE MARQUE : l heure ou le PREMIER groupe joue encore.
  record('l heure ou le premier groupe joue n est PAS annoncee comme le second',
    Boolean(vu11.pendantLePremier) && vu11.pendantLePremier.motif !== 'vague',
    JSON.stringify(vu11.pendantLePremier && `${vu11.pendantLePremier.heure}:${vu11.pendantLePremier.motif}`));
  // ET ELLE NE SE PREND PAS : c est le trou, pas l habillage.
  const avant11 = await p11.evaluate((sel) => [...document.querySelectorAll(`${sel} .anchor-chip.active`)].map((c) => c.dataset.time).join('|'), LIGNE_BOWLING);
  await cliquerB((vu11.secondService[0] || {}).heure || '');
  await p11.waitForTimeout(2000);
  const apres11 = await p11.evaluate((sel) => [...document.querySelectorAll(`${sel} .anchor-chip.active`)].map((c) => c.dataset.time).join('|'), LIGNE_BOWLING);
  record('cliquer l heure du second groupe ne la retient pas', apres11 === avant11,
    JSON.stringify({ avant: avant11, apres: apres11 }));
  await ctx11.close();

  section('[6] Contre-epreuve par mutation : ce gate sait-il rougir ?');
  const original = fs.readFileSync(APP_JS, 'utf8');
  const originalCss = fs.readFileSync(CSS, 'utf8');
  const ancre = `    ? (partCount > 1
      ? ''
      : \`Session de \${activity.durationMinutes} min\`)`;
  try {
    const fdl = original.includes('\r\n') ? '\r\n' : '\n';
    const ancreFdl = ancre.split('\n').join(fdl);
    if (original.split(ancreFdl).length - 1 !== 1) throw new Error('ancre de la ligne de detail introuvable');
    // On REMET la ligne que Movsar a comptee en trop, mot pour mot.
    const retour = `    ? (partCount > 1
      ? \`\${partCount} parties · choisissez vos heures, l’équipe place les autres\`
      : \`Session de \${activity.durationMinutes} min\`)`.split('\n').join(fdl);
    let mutant = original.split(ancreFdl).join(retour);
    // Et on remet `disabled` sur les heures qui coincent : le bouton mort.
    const ancreBouton = 'aria-pressed="${isActive ? \'true\' : \'false\'}" aria-label="${escapeHtml(coince';
    if (mutant.split(ancreBouton).length - 1 !== 1) throw new Error('ancre du bouton introuvable');
    mutant = mutant.split(ancreBouton).join('${coince ? \' disabled\' : \'\'} ' + ancreBouton);
    // Et on remet la cle d origine du dedoublonnage des vagues.
    const ancreCle = '.map((block) => [`${Number(block.countIndex || 1)}.${Number(block.groupWaveIndex || 1)}`, block]))';
    if (mutant.split(ancreCle).length - 1 !== 1) throw new Error('ancre de la cle des vagues introuvable');
    mutant = mutant.split(ancreCle).join('.map((block) => [Number(block.countIndex || 1), block]))');
    fs.writeFileSync(APP_JS, mutant);
    // Et on remet l ancienne egalisation, celle qui calait chaque grille sur
    // SON propre contenu : c est exactement le defaut mesure en production.
    const ancreCss = '  grid-auto-rows: minmax(var(--hauteur-pastille), auto);';
    if (originalCss.split(ancreCss).length - 1 !== 1) throw new Error('ancre CSS des rangees introuvable');
    fs.writeFileSync(CSS, originalCss.split(ancreCss).join('  grid-auto-rows: 1fr;'));

    const { context: ctx2, page: p2 } = await ouvrirLesDeuxEcrans(browser, 'mutant');
    await allerAuxHeures(p2);
    const mute = await p2.evaluate((sel) => {
      const racine = document.querySelector(sel);
      const tete = racine ? racine.querySelector('.anchor-row-head') : null;
      return `${tete ? tete.textContent : ''} ${((racine && racine.querySelector('.anchor-part-count')) || {}).textContent || ''}`.replace(/\s+/g, ' ');
    }, '.anchor-row[data-anchor="laser_game"]');
    const foisMute = (mute.match(/3 parties/g) || []).length;
    record('avec la ligne de detail remise, « 3 parties » est ecrit DEUX fois : ce gate ROUGIRAIT',
      foisMute === 2, `${foisMute} fois :: ${JSON.stringify(mute.slice(0, 140))}`);

    // ET LA CLE D ORIGINE FAIT DISPARAITRE UNE VAGUE. Releve AVANT les clics
    // qui suivent : ils changent le choix du client et cassent la combinaison,
    // donc la carte de visite ne serait plus la pour etre jugee. Et sans
    // valider, pour que la suite du mutant garde son ecran.
    const vaguesMute = await releverLesVagues(p2, { valider: false });
    const perdues = vaguesMute.heuresDistinctes.filter((h) => !vaguesMute.ligneVisite.includes(h));
    record('avec la cle d origine, une vague DISPARAIT du recapitulatif : ce gate ROUGIRAIT',
      vaguesMute.heuresDistinctes.length >= 2 && perdues.length >= 1,
      JSON.stringify({ heures: vaguesMute.heuresDistinctes, perdues, ligne: vaguesMute.ligneVisite.slice(0, 110) }));

    // Dans le MEME chargement mute : les deux autres regressions.
    await p2.evaluate(() => {
      const ligne = document.querySelector('.anchor-row[data-anchor="laser_game"]');
      [...(ligne ? ligne.querySelectorAll('.anchor-chip:not(.active):not([data-coince])') : [])].slice(0, 2).forEach((c) => c.click());
    });
    await p2.waitForTimeout(2500);
    const mortes = await p2.evaluate(() => {
      const bloquees = [...document.querySelectorAll('.anchor-row[data-anchor="laser_game"] .anchor-chip[disabled]')];
      return bloquees.length;
    });
    record('avec `disabled` remis, les heures bloquees redeviennent MORTES : ce gate ROUGIRAIT',
      mortes > 0, `${mortes} pastille(s) morte(s)`);

    await p2.evaluate(() => {
      document.querySelectorAll('.slot-period:not(.is-open) .slot-period-head').forEach((h) => h.click());
    });
    await p2.waitForTimeout(900);
    const inegales = await p2.evaluate(() => {
      const toutes = [...document.querySelectorAll('.anchor-chip')]
        .filter((c) => c.getBoundingClientRect().height > 0)
        .map((c) => Math.round(c.getBoundingClientRect().height));
      return { total: toutes.length, hauteurs: [...new Set(toutes)].sort((a, b) => a - b) };
    });
    record('sans le plancher partage, l ecran reprend DEUX hauteurs de pastille : ce gate ROUGIRAIT',
      inegales.total >= 20 && inegales.hauteurs.length > 1, JSON.stringify(inegales));

    await ctx2.close();
  } catch (error) {
    record('contre-epreuve montable', false, error.message);
  } finally {
    fs.writeFileSync(APP_JS, original);
    fs.writeFileSync(CSS, originalCss);
  }
  record('app-main.js restaure a l identique', fs.readFileSync(APP_JS, 'utf8') === original);
  record('pinlane-client.css restaure a l identique', fs.readFileSync(CSS, 'utf8') === originalCss);

  await browser.close();
  server.close();
  console.log(`\n${failures === 0 ? 'REFONTE ECRANS OK' : `REFONTE ECRANS : ${failures} echec(s)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('ECHEC', e); process.exit(1); });

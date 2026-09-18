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
const availability = require(path.join(ROOT, 'api/public-availability.js'));

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

// Le parcours d un client, jusqu aux deux ecrans : 49 joueurs (l effectif de la
// capture), bowling + laser + minigolf, et trois parties de laser. Le minigolf
// est ce qui fait apparaitre le « sans horaire ».
async function ouvrirLesDeuxEcrans(browser, etiquette) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/reserver/libramont?v=refonte-${etiquette}-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForFunction(() => typeof window.goStep2 === 'function' && document.querySelectorAll('#clientView .activity-card').length >= 8, null, { timeout: 20000 });
  await page.evaluate((date) => {
    const d = document.getElementById('fDate');
    d.value = date; d.dispatchEvent(new Event('change', { bubbles: true }));
    const p = document.getElementById('fPax');
    if (p) { p.value = '49'; p.dispatchEvent(new Event('change', { bubbles: true })); p.dispatchEvent(new Event('input', { bubbles: true })); }
  }, DATE);
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

  // Le clic OUVRE l explication, au lieu de ne rien faire.
  const apresClic = await page.evaluate(() => {
    const c = document.querySelector('.anchor-row[data-anchor="laser_game"] .anchor-chip[aria-disabled="true"]');
    if (!c) return null;
    c.click();
    const bulle = c.querySelector('.slot-card-why');
    return {
      ouverte: c.hasAttribute('data-coince-ouvert'),
      visible: bulle ? getComputedStyle(bulle).display !== 'none' : false,
      texte: bulle ? bulle.textContent.trim() : '',
      retenuesApres: document.querySelectorAll('.anchor-row[data-anchor="laser_game"] .anchor-chip.active').length,
    };
  });
  record('cliquer une heure qui coince OUVRE son explication', Boolean(apresClic && apresClic.ouverte && apresClic.visible),
    JSON.stringify(apresClic && apresClic.texte.slice(0, 90)));
  record('et ne change RIEN au choix du client', apresClic && apresClic.retenuesApres === 3, `${apresClic && apresClic.retenuesApres}`);

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
  await page.evaluate(() => {
    document.querySelectorAll('.anchor-row[data-anchor="laser_game"] .slot-period:not(.is-open) .slot-period-head').forEach((h) => h.click());
  });
  await page.waitForTimeout(800);
  const hauteurs = await page.evaluate(() => {
    const grilles = [...document.querySelectorAll('.anchor-row[data-anchor="laser_game"] .anchor-chip-grid')]
      .filter((g) => g.getBoundingClientRect().height > 0);
    const parGrille = grilles.map((g) => {
      const h = [...g.querySelectorAll('.anchor-chip')].map((c) => Math.round(c.getBoundingClientRect().height));
      return { n: h.length, distinctes: [...new Set(h)].length, min: Math.min(...h), max: Math.max(...h) };
    });
    return { grilles: parGrille.length, total: parGrille.reduce((s, g) => s + g.n, 0), parGrille };
  });
  record('montage : la rangee porte assez de pastilles pour comparer',
    hauteurs && hauteurs.total >= 8, JSON.stringify({ grilles: hauteurs.grilles, total: hauteurs.total }));
  // Une liste ouverte = une grille. C est DANS une liste que Movsar voyait des
  // cases de tailles differentes cote a cote.
  const bancales = (hauteurs.parGrille || []).filter((g) => g.distinctes !== 1);
  record('dans chaque liste, toutes les pastilles ont la MEME hauteur',
    bancales.length === 0, JSON.stringify(bancales.length ? bancales : hauteurs.parGrille));

  await context.close();

  // ====================================================================== [6]
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
    fs.writeFileSync(APP_JS, mutant);
    // Et on retire l egalisation des rangees : les tailles repartent en vrac.
    const ancreCss = '  grid-auto-rows: 1fr;';
    if (originalCss.split(ancreCss).length - 1 !== 1) throw new Error('ancre CSS des rangees introuvable');
    fs.writeFileSync(CSS, originalCss.split(ancreCss).join('  grid-auto-rows: auto;'));

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

    const inegales = await p2.evaluate(() => {
      const g = [...document.querySelectorAll('.anchor-row[data-anchor="laser_game"] .anchor-chip-grid')]
        .filter((x) => x.getBoundingClientRect().height > 0)
        .map((x) => [...new Set([...x.querySelectorAll('.anchor-chip')].map((c) => Math.round(c.getBoundingClientRect().height)))].length);
      return { grilles: g, bancales: g.filter((n) => n !== 1).length };
    });
    record('sans l egalisation des rangees, des pastilles de la MEME liste n ont plus la meme hauteur : ce gate ROUGIRAIT',
      inegales.bancales > 0, JSON.stringify(inegales));
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

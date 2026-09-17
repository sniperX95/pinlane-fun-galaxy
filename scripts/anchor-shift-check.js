// UNE HEURE QUI CHEVAUCHE L AUTRE ACTIVITE N EST PAS UN MUR (entretien Seb,
// 2026-09-17).
//
// Movsar, capture a l appui : « la sur les choix ya bcp de case grise ou on
// peut pas choisir donc cest chiant si qlq veut 18H30 laser game il comprend
// pas pq il peut pas [...] fait un truc plus logique avec de beau message
// d'attention si ca bloque etc mais pas empecher comme ca ».
//
// CE QUI ETAIT MESURE AVANT (dev-tunnel, bowling 14:00 retenu) : les heures
// 14:00 et 14:30 du Laser Game portaient « Chevauche Bowling 14:00 », grisees
// et `disabled`. Le seul obstacle etait une heure retenue pour l AUTRE
// activite : rien d indisponible, juste un ordre a changer. Le client n avait
// aucun moyen de dire « je veux le laser a cette heure-la ».
//
// LA REGLE MAINTENANT : cette pastille se prend. Elle annonce ce qu elle
// deplace (« On decale », « Bowling se decale »), et le clic replace l autre
// activite AUTOUR de l heure demandee (collee apres, sinon juste avant). Une
// capacite pleine, une fermeture ou un blocage restent des refus : rien ne les
// deplace, et ce gate le verifie aussi.
//
// Lancement : node scripts/anchor-shift-check.js
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const APP_JS = path.join(ROOT, 'assets/app-main.js');
const PORT = Number(process.env.PINLANE_ANCHOR_SHIFT_PORT || 4252);
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

// Aucun acces base : l instantane est neutralise AVANT le chargement de l API
// (le .env porte la production).
const database = require('../lib/database');
database.readAvailabilitySnapshot = async () => ({ reservations: [], laneStatuses: {}, blocks: [], date: DATE, centerId: 'libramont' });
const availability = require('../api/public-availability.js');

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

let failures = 0;
function record(label, cond, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` :: ${detail}` : ''}`);
  if (!cond) failures += 1;
  return cond;
}
function section(title) { console.log(`\n--- ${title}`); }

async function withSourceMutation(file, from, to, run) {
  const original = fs.readFileSync(file, 'utf8');
  const count = original.split(from).length - 1;
  if (count !== 1) throw new Error(`ancre trouvee ${count} fois dans ${path.basename(file)}`);
  try {
    fs.writeFileSync(file, original.split(from).join(to));
    return await run();
  } finally {
    fs.writeFileSync(file, original);
    if (fs.readFileSync(file, 'utf8') !== original) throw new Error(`${path.basename(file)} non restaure`);
  }
}

// Le composeur de visite, monte pour de vrai : jour ouvert, deux activites
// planifiees (bowling + laser), et une heure retenue pour le bowling.
async function ouvrirComposeur(browser, etiquette) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/reserver/libramont?v=shift-${etiquette}-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForFunction(() => typeof window.goStep2 === 'function' && document.querySelectorAll('#clientView .activity-card').length >= 8, null, { timeout: 20000 });
  await page.evaluate((date) => {
    const champ = document.getElementById('fDate');
    champ.value = date;
    champ.dispatchEvent(new Event('change', { bubbles: true }));
  }, DATE);
  await page.waitForTimeout(500);
  const grilleVisible = () => page.evaluate(() => {
    const grille = document.querySelector('#clientView .activity-grid');
    return Boolean(grille) && grille.getBoundingClientRect().height > 0;
  });
  for (let pas = 0; pas < 4 && !(await grilleVisible()); pas += 1) {
    const continuer = page.locator('#btnVenueContinue');
    if (!(await continuer.isVisible().catch(() => false))) break;
    await continuer.click({ timeout: 4000 });
    await page.waitForTimeout(450);
  }
  if (!(await grilleVisible())) throw new Error('montage impossible : grille des activites masquee');
  for (const id of ['bowling', 'laser_game']) {
    const toggle = page.locator(`#clientView .activity-card[data-activity="${id}"] .activity-toggle`).first();
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click({ timeout: 6000 });
    await page.waitForTimeout(300);
  }
  const panier = await page.evaluate(() => (typeof getChosenActivities === 'function' ? getChosenActivities().map((a) => a.id) : []));
  if (!panier.includes('bowling') || !panier.includes('laser_game')) throw new Error(`montage impossible : panier ${panier.join(',') || 'vide'}`);
  // Ecran des reglages, puis les heures.
  await page.locator('#btnStep1').click({ timeout: 6000 });
  await page.waitForTimeout(600);
  await page.locator('#btnStep1').click({ timeout: 6000 });
  await page.waitForFunction(() => document.querySelectorAll('.anchor-row[data-anchor] .anchor-chip').length > 10, null, { timeout: 25000 });
  await page.waitForTimeout(800);
  // Une heure RETENUE pour le bowling : c est elle qui fait chevaucher les
  // heures voisines du laser.
  await page.evaluate(() => {
    const chip = document.querySelector('.anchor-row[data-anchor="bowling"] .anchor-chip[data-time="14:00"]');
    if (chip) chip.click();
  });
  const pose = await page.waitForFunction(() => {
    const times = (typeof state !== 'undefined' && state.booking && state.booking.preference && state.booking.preference.preferredTimes) || {};
    return times.bowling === '14:00';
  }, null, { timeout: 15000 }).then(() => true).catch(() => false);
  if (!pose) {
    const diag = await page.evaluate(() => {
      const row = document.querySelector('.anchor-row[data-anchor="bowling"]');
      const chip = row ? row.querySelector('.anchor-chip[data-time="14:00"]') : null;
      return {
        rangees: [...document.querySelectorAll('.anchor-row[data-anchor]')].map((r) => r.getAttribute('data-anchor')),
        chipsBowling: row ? row.querySelectorAll('.anchor-chip').length : -1,
        chip14: chip ? { disabled: chip.disabled, classes: chip.className } : null,
        heures: (typeof state !== 'undefined' && state.booking.preference && state.booking.preference.preferredTimes) || null,
        erreurs: window.__erreursGate || [],
      };
    });
    throw new Error(`montage impossible : le bowling n a pas pris 14:00 ${JSON.stringify(diag)}`);
  }
  await page.waitForTimeout(1500);
  return { context, page };
}

// Ce que la pastille du laser a 14:00 dit et permet.
const ETAT_PASTILLE = () => {
  const chip = document.querySelector('.anchor-row[data-anchor="laser_game"] .anchor-chip[data-time="14:00"]');
  // `formulaAnchorData` est declare en let dans la page : il n est PAS une
  // propriete de window (le premier jet de ce gate lisait donc toujours null).
  const donneesAncres = typeof formulaAnchorData !== 'undefined' && formulaAnchorData ? formulaAnchorData : {};
  const laser = ((donneesAncres.activities) || []).find((a) => a.activityId === 'laser_game');
  const donnee = laser ? (laser.times || []).find((t) => t.time === '14:00') : null;
  return {
    existe: Boolean(chip),
    desactivee: chip ? chip.disabled : null,
    decalable: chip ? chip.classList.contains('is-shiftable') : null,
    grisee: chip ? chip.classList.contains('is-unavailable') : null,
    tag: chip ? ((chip.querySelector('.slot-card-tag') || {}).textContent || '').trim() : '',
    meta: chip ? ((chip.querySelector('.slot-card-meta') || {}).textContent || '').trim() : '',
    nom: chip ? (chip.getAttribute('aria-label') || '') : '',
    code: donnee ? donnee.code || '' : '',
    conflit: donnee ? donnee.conflict || null : null,
    heures: (typeof state !== 'undefined' && state.booking.preference && state.booking.preference.preferredTimes) || {},
  };
};

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    section('Montage : bowling retenu a 14:00, le laser chevauche a 14:00');
    const { context, page } = await ouvrirComposeur(browser, 'nominal');
    const avant = await page.evaluate(ETAT_PASTILLE);
    record('montage : le bowling est retenu a 14:00', avant.heures.bowling === '14:00', JSON.stringify(avant.heures));
    record('montage : le moteur juge bien 14:00 en chevauchement', avant.code === 'anchor_overlap', `code=${avant.code}`);
    record('montage : il nomme l activite chevauchee', Boolean(avant.conflit && avant.conflit.activityId === 'bowling'), JSON.stringify(avant.conflit));

    section('La pastille se prend et annonce ce qu elle deplace');
    record('elle n est PAS desactivee', avant.desactivee === false, `disabled=${avant.desactivee}`);
    record('elle n est pas grisee comme une heure impossible', avant.grisee === false);
    record('elle porte l etat « on decale »', avant.decalable === true && /décale/i.test(avant.tag), `tag=${avant.tag}`);
    record('elle nomme ce qui bouge', /bowling/i.test(avant.meta), `meta=${avant.meta}`);
    record('son nom accessible le dit aussi', /décale/i.test(avant.nom), avant.nom);

    section('Le clic prend l heure demandee et replace l autre activite');
    await page.evaluate(() => document.querySelector('.anchor-row[data-anchor="laser_game"] .anchor-chip[data-time="14:00"]').click());
    await page.waitForFunction(() => {
      const times = (typeof state !== 'undefined' && state.booking.preference && state.booking.preference.preferredTimes) || {};
      return times.laser_game === '14:00';
    }, null, { timeout: 20000 }).catch(() => null);
    await page.waitForTimeout(2500);
    const apres = await page.evaluate(() => ({
      heures: state.booking.preference.preferredTimes,
      parties: state.booking.preference.laserGameTimes,
      creneaux: (state.availableSlots || []).length,
      message: (document.querySelector('#clientView .slot-empty, #clientView .anchor-guard') || {}).textContent || '',
      fin: ((state.availableSlots || [])[0] || {}).visitEndTime || (((state.availableSlots || [])[0] || {}).opsPlan || {}).endTime || '',
    }));
    record('le laser a bien pris 14:00', apres.heures.laser_game === '14:00', JSON.stringify(apres.heures));
    record('le bowling a ete DEPLACE, il ne reste pas a 14:00', apres.heures.bowling !== '14:00', `bowling=${apres.heures.bowling}`);
    // Colle apres l heure demandee : le laser dure 25 min sur la grille de 30.
    record('le bowling est replace JUSTE APRES, pas au petit matin', apres.heures.bowling === '14:30', `bowling=${apres.heures.bowling}`);
    record('un creneau reste propose (aucun cul-de-sac)', apres.creneaux >= 1, `${apres.creneaux} creneau(x) ${apres.message}`);
    record('la visite annonce une fin', Boolean(apres.fin), `fin=${apres.fin}`);
    await context.close();

    section('Ce qui n est pas deplacable reste un refus');
    {
      const { context: ctx2, page: page2 } = await ouvrirComposeur(browser, 'fermeture');
      const fermeture = await page2.evaluate(() => {
        const chips = [...document.querySelectorAll('.anchor-row[data-anchor="bowling"] .anchor-chip')];
        const dernier = chips[chips.length - 1];
        return {
          time: dernier ? dernier.getAttribute('data-time') : '',
          desactivee: dernier ? dernier.disabled : null,
          grisee: dernier ? dernier.classList.contains('is-unavailable') : null,
          decalable: dernier ? dernier.classList.contains('is-shiftable') : null,
          meta: dernier ? ((dernier.querySelector('.slot-card-meta') || {}).textContent || '').trim() : '',
        };
      });
      record('la derniere heure de la journee est refusee par la FERMETURE', fermeture.grisee === true && fermeture.desactivee === true, JSON.stringify(fermeture));
      record('elle n est pas presentee comme deplacable', fermeture.decalable === false, `decalable=${fermeture.decalable}`);
      record('elle dit pourquoi', /fin apr|minuit|ferm/i.test(fermeture.meta), fermeture.meta);
      await ctx2.close();
    }

    section('Contre-epreuve par mutation du code de production');
    try {
      const mute = await withSourceMutation(
        APP_JS,
        "const decalable = unavailable && item.code === 'anchor_overlap' && Boolean(conflit);",
        'const decalable = false;',
        async () => {
          const { context: ctx3, page: page3 } = await ouvrirComposeur(browser, 'mute');
          const etat = await page3.evaluate(ETAT_PASTILLE);
          await page3.evaluate(() => {
            const chip = document.querySelector('.anchor-row[data-anchor="laser_game"] .anchor-chip[data-time="14:00"]');
            if (chip) chip.click();
          });
          await page3.waitForTimeout(2500);
          const heures = await page3.evaluate(() => state.booking.preference.preferredTimes);
          await ctx3.close();
          return { etat, heures };
        },
      );
      record('sans la regle, la pastille redevient un mur : ce gate ROUGIRAIT', mute.etat.desactivee === true && mute.etat.decalable === false, JSON.stringify({ disabled: mute.etat.desactivee, decalable: mute.etat.decalable }));
      record('et le clic ne donne plus l heure demandee', mute.heures.laser_game !== '14:00', JSON.stringify(mute.heures));
    } catch (error) {
      record('contre-epreuve montable', false, error.message);
    }
    record('app-main.js restaure a l identique', fs.readFileSync(APP_JS, 'utf8').includes("const decalable = unavailable && item.code === 'anchor_overlap' && Boolean(conflit);"));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n${failures === 0 ? 'ANCHOR SHIFT OK' : `ANCHOR SHIFT : ${failures} echec(s)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => { console.error('ECHEC', error); process.exit(1); });

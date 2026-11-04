'use strict';
// DEUX CENTRES, UN SITE, AUCUNE INTERFERENCE (Ansar, 2026-11-04 : « que gembloux et libramont soit dissocie [...] quon
// ai pas des interferance et des resa qui spawn a gembloux et pas a libra »). La vraie page, le vrai embed.js, les vrais
// gestionnaires du serveur ; seule la base est en memoire. Rien ne part en ligne.
//
//   [A] les deux lignes du site sur une meme page : chaque cadre ne parle que de son centre, une reservation faite dans
//       le cadre de Gembloux est rangee a Gembloux, et le signal de mesure dit Gembloux ;
//   [B] remplir le laser ou les pistes d un centre ne prend aucune place a l autre, dans les deux sens ;
//   [C] le serveur refuse ce que l autre centre vend, un centre absent et un centre inconnu ;
//   [D] une ligne sans centre ne monte aucun formulaire : elle laisse celui du site, jamais Libramont par defaut ;
//   [E] une ligne ou une adresse mal ecrite : l espace et la majuscule ne changent pas de centre, un nom qui n est pas un
//       centre ne vend rien, et surtout pas Libramont.
//
// Lancement : node scripts/centres-dissocies-check.js
for (const nom of Object.keys(process.env)) if (/^(PG|DATABASE|POSTGRES|RESEND)/i.test(nom)) delete process.env[nom];
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_CENTRES_DISSOCIES_PORT || 5291);
const BASE = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

let echecs = 0;
let total = 0;
function ok(condition, message, detail) {
  total += 1;
  if (condition) { console.log(`ok    ${message}`); return; }
  echecs += 1;
  console.log(`FAIL  ${message}${detail === undefined ? '' : `  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`.slice(0, 700)}`);
}

// LA BASE EN MEMOIRE, posee avant que les gestionnaires ne soient charges.
function mock(rel, exports) { const r = require.resolve(path.join(ROOT, rel)); require.cache[r] = { id: r, filename: r, loaded: true, exports }; }
mock('lib/rate-limit', { enforceRateLimit: () => false, checkRateLimit: () => ({ allowed: true, remaining: 999, retryAfterSeconds: 0 }), getClientIp: () => 'banc' });
const kn = require('../lib/ops-knowledge');
kn.refreshCenterOverrides = async () => false;
kn.refreshCatalog = async () => false;
require('../lib/booking-config').refreshFormuleOverrides = async () => false;
const database = require('../lib/database');
const DOSSIERS = [];
let id = 5000;
database.readAvailabilitySnapshot = async (date, centerId) => ({ date, centerId, laneStatuses: {}, blocks: [], reservations: DOSSIERS.filter((r) => r.date === date && r.centerId === centerId) });
database.readStaffState = database.readAvailabilitySnapshot;
database.createOpsEvent = async () => ({});
database.createSlotHold = async (p, o) => ({ expiresAt: new Date(Date.now() + 600000).toISOString(), minutes: 10, jeton: o && o.jeton });
database.readMatchingSlotHold = async () => null;
database.readUpsellSlotHold = async () => null;
database.releaseSlotHold = async () => ({ released: 1 });
if (database.reservationDejaConfirmee) database.reservationDejaConfirmee = async () => null;
database.createReservation = async (payload) => {
  const range = database.normalizeReservationPayload({ ...payload }, {});
  const row = { ...range, id: id += 1, date: payload.date, centerId: payload.centerId, status: range.status || 'pending', opsPlan: payload.opsPlan, program: payload.program, price: payload.price ?? range.price, pax: payload.pax };
  DOSSIERS.push(row);
  return row;
};
require('../lib/reservation-ops').afterReservationCreated = async () => ({ communications: [], warnings: [] });
// Les journaux d audit ne partent nulle part sans base : ils n ont rien a dire ici.
for (const nom of ['error', 'warn']) { const o = console[nom]; console[nom] = (...a) => { if (!/ECRITURE PERDUE|TRACE PERDUE|DATABASE_URL/.test(String(a[0]))) o(...a); }; }
const reservations = require('../api/public-reservations.js');
const availability = require('../api/public-availability.js');
const meta = require('../api/public-booking-meta.js');

// Les reglages que la prod porte en base : les horaires du site, les armes et les parties de chaque centre.
const HEURES = {
  regular: { 0: { open: '10:00', close: '22:00' }, 1: null, 2: { open: '14:00', close: '22:00' }, 3: { open: '12:00', close: '22:00' }, 4: { open: '14:00', close: '22:00' }, 5: { open: '14:00', close: '24:00' }, 6: { open: '10:00', close: '24:00' } },
  holiday: { 0: { open: '10:00', close: '22:00' }, 1: { open: '10:00', close: '22:00' }, 2: { open: '10:00', close: '22:00' }, 3: { open: '10:00', close: '22:00' }, 4: { open: '10:00', close: '22:00' }, 5: { open: '10:00', close: '24:00' }, 6: { open: '10:00', close: '24:00' } },
};
const fiche = (c) => JSON.parse(fs.readFileSync(path.join(ROOT, 'ops-knowledge/centers.json'), 'utf8')).centers.find((x) => x.id === c);
const reglage = (c, armes, parties) => ({ defaultSchedule: HEURES, resources: { ...fiche(c).resources, laser: { ...fiche(c).resources.laser, weaponCount: armes, parallelLaunches: parties, ...(parties > 1 ? { canSplitGroupsCleanly: true, requiresCompleteGroupBeforeLaunch: false } : {}) } } });
kn.applyCenterOverrides(new Map([['libramont', reglage('libramont', 30, 1)], ['gembloux', reglage('gembloux', 20, 6)]]));

const hote = (lignes) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Le site du client</title></head><body style="background:#000">
<div id="ancien" class="ancien">Formulaire du site</div><div id="zoneA"></div><div id="zoneB"></div>${lignes}</body></html>`;
const LIGNE = (centre, zone) => `<script src="${BASE}/embed.js"${centre ? ` data-center="${centre}"` : ''} data-design="fungalaxy" data-target="#${zone}" data-fallback="#ancien" data-track="datalayer"></script>`;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const serveur = http.createServer(async (rq, rs) => {
  const u = new URL(rq.url, BASE);
  try {
    if (u.pathname === '/hote-deux') { rs.writeHead(200, { 'Content-Type': TYPES['.html'] }); rs.end(hote(LIGNE('libramont', 'zoneA') + LIGNE('gembloux', 'zoneB'))); return; }
    if (u.pathname === '/hote-sans') { rs.writeHead(200, { 'Content-Type': TYPES['.html'] }); rs.end(hote(LIGNE('', 'zoneA'))); return; }
    if (u.pathname === '/hote-mal') { rs.writeHead(200, { 'Content-Type': TYPES['.html'] }); rs.end(hote(LIGNE('Gembloux ', 'zoneA'))); return; }
    if (u.pathname === '/api/public-booking-meta' && rq.method === 'POST') { rq.resume(); rs.writeHead(202, { 'Content-Type': 'application/json' }); rs.end('{"ok":true}'); return; }
    if (u.pathname === '/api/public-booking-meta') { await meta(rq, rs); return; }
    if (u.pathname === '/api/public-availability') { await availability(rq, rs); return; }
    if (u.pathname === '/api/public-holds') { rq.url = '/api/public-reservations?action=hold'; await reservations(rq, rs); return; }
    if (u.pathname === '/api/public-reservations') { await reservations(rq, rs); return; }
    if (u.pathname.startsWith('/api/')) { rq.resume(); rs.writeHead(204); rs.end(); return; }
    const rel = /^\/fungalaxy(\/|$)/.test(u.pathname) ? 'fungalaxy.html' : decodeURIComponent(u.pathname.replace(/^\/+/, ''));
    const f = path.join(ROOT, rel);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { rs.writeHead(404); rs.end('absent'); return; }
    rs.writeHead(200, { 'Content-Type': TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(f).pipe(rs);
  } catch (e) {
    if (!rs.headersSent) rs.writeHead(500, { 'Content-Type': 'application/json' });
    rs.end(JSON.stringify({ ok: false, message: String(e.message) }));
  }
});

const MOIS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const attendre = (cible, fn, ms, arg) => cible.waitForFunction(fn, arg, { timeout: ms || 12000, polling: 80 }).then(() => true).catch(() => false);
// Jusqu a l ecran des heures, dans une page ou dans un cadre.
async function jusquAuxHeures(cible, { date, pax, activite, pilule }) {
  await attendre(cible, () => document.body.classList.contains('is-ready') && document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour', 20000);
  await cible.click('#dayBtn');
  await attendre(cible, () => !document.querySelector('#dayPop').hidden && document.querySelectorAll('#calGrid .fg-cal__day').length >= 28);
  const [y, mo] = date.split('-').map(Number);
  for (let k = 0; k < 14; k += 1) {
    const titre = await cible.evaluate(() => document.querySelector('#calTitle').textContent.trim());
    if (titre === `${MOIS[mo - 1]} ${y}`) break;
    await cible.click('#calNext');
    await attendre(cible, (t) => document.querySelector('#calTitle').textContent.trim() !== t, 3000, titre);
  }
  await attendre(cible, (d) => { const b = document.querySelector(`#calGrid .fg-cal__day[data-date="${d}"]`); return b && !b.classList.contains('is-loading'); }, 8000, date);
  await cible.click(`#calGrid .fg-cal__day[data-date="${date}"]`);
  await cible.waitForTimeout(300);
  await cible.fill('#paxInput', String(pax));
  await cible.press('#paxInput', 'Tab');
  await cible.waitForTimeout(250);
  await cible.click('#goActivities');
  await attendre(cible, () => document.querySelector('.fg-scene[data-scene="activites"].is-active') && !document.querySelector('.fg-scene.is-entering'));
  await cible.waitForTimeout(400);
  await cible.click(`[data-activity-toggle="${activite}"]`);
  await cible.waitForTimeout(350);
  if (pilule) { await cible.click(pilule); await cible.waitForTimeout(250); }
  await cible.click('#goHours');
  await attendre(cible, () => document.querySelector('.fg-scene[data-scene="heures"].is-active') && !document.querySelector('.fg-scene.is-entering'));
  await attendre(cible, () => !document.querySelector('#hourZone').classList.contains('is-busy') && document.querySelector('#planZone .fg-visit, #planZone .fg-notice'), 20000);
  await cible.waitForTimeout(500);
}
async function ouvrirLigne(cible, cle) {
  await cible.evaluate((c) => { const li = document.querySelector(`#hourZone .fg-etape[data-cle="${c}"]`); if (li && !li.classList.contains('is-open')) li.querySelector('.fg-etape__tete').click(); }, cle);
  await cible.waitForTimeout(600);
}
const puceLibre = (cible, cle, heure) => cible.evaluate(({ c, h }) => { const p = document.querySelector(`#hourZone .fg-track[data-activity="${c}"] .fg-chip[data-time="${h}"]`); return p ? !p.classList.contains('is-off') : null; }, { c: cle, h: heure });
// De l heure choisie a l ecran final.
async function finir(cible, cle, heure) {
  await ouvrirLigne(cible, cle);
  await cible.click(`#hourZone .fg-track[data-activity="${cle}"] .fg-chip[data-time="${heure}"]`);
  await cible.waitForTimeout(1200);
  await attendre(cible, () => !document.querySelector('#hourZone').classList.contains('is-busy') && !document.querySelector('#goContact').disabled, 15000);
  await cible.click('#goContact');
  await attendre(cible, () => { const v = document.querySelector('#vitrine'); return (v && !v.hidden) || (document.querySelector('.fg-scene[data-scene="contact"].is-active') && !document.querySelector('.fg-scene.is-entering')); }, 15000);
  if (await cible.evaluate(() => { const v = document.querySelector('#vitrine'); return Boolean(v && !v.hidden); })) { await cible.click('#vitrine .fg-vitrine__non'); await cible.waitForTimeout(400); }
  await attendre(cible, () => document.querySelector('.fg-scene[data-scene="contact"].is-active') && !document.querySelector('.fg-scene.is-entering'), 15000);
  await cible.fill('#cPrenom', 'Essai');
  await cible.fill('#cNom', 'Banc');
  await cible.fill('#cEmail', 'qa@example.com');
  await cible.fill('#cTel', '0470000000');
  await cible.click('.fg-occasion[data-occasion="amis"]');
  await cible.evaluate(() => { const c = document.querySelector('#cConsent'); if (!c.checked) c.click(); });
  await cible.click('#goRecap');
  await attendre(cible, () => document.querySelector('.fg-scene[data-scene="recap"].is-active') && !document.querySelector('.fg-scene.is-entering'), 15000);
  await attendre(cible, () => { const v = document.querySelector('#vitrine'); return !v || !v.hasAttribute('data-attendue'); }, 5000);
  if (await cible.evaluate(() => { const v = document.querySelector('#vitrine'); return Boolean(v && !v.hidden); })) { await cible.click('#vitrine .fg-vitrine__non'); await cible.waitForTimeout(350); }
  await cible.click('#confirmBtn');
  return attendre(cible, () => document.querySelector('.fg-scene[data-scene="fin"].is-active'), 20000);
}
async function page(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const p = await ctx.newPage();
  p.setDefaultTimeout(15000);
  return { ctx, p };
}
async function reserverDirect(browser, centre, { date, pax, activite, heure, pilule }) {
  const { ctx, p } = await page(browser);
  await p.goto(`${BASE}/fungalaxy/${centre}`, { waitUntil: 'networkidle', timeout: 45000 });
  await jusquAuxHeures(p, { date, pax, activite, pilule });
  const fini = await finir(p, activite, heure);
  await ctx.close();
  return fini;
}
async function libreA(browser, centre, { date, pax, activite, heure }) {
  const { ctx, p } = await page(browser);
  await p.goto(`${BASE}/fungalaxy/${centre}`, { waitUntil: 'networkidle', timeout: 45000 });
  await jusquAuxHeures(p, { date, pax, activite });
  await ouvrirLigne(p, activite);
  const libre = await puceLibre(p, activite, heure);
  await ctx.close();
  return libre;
}
const dossiersDe = (centre) => DOSSIERS.filter((r) => r.centerId === centre);

async function deuxLignes(browser, date) {
  const { ctx, p } = await page(browser);
  const appels = [];
  p.on('request', (r) => { const m = r.url().match(/\/api\/public-[a-z-]+/); if (m) { const f = r.frame(); appels.push({ de: f.url(), url: r.url(), corps: r.postData() }); } });
  await p.goto(`${BASE}/hote-deux`, { waitUntil: 'networkidle', timeout: 45000 });
  const cadres = await p.evaluate(() => [...document.querySelectorAll('iframe')].map((f) => f.src.split('?')[0]));
  ok(cadres.length === 2 && cadres[0].endsWith('/fungalaxy/libramont') && cadres[1].endsWith('/fungalaxy/gembloux'), '[A] les deux lignes montent deux cadres, chacun sur son centre', cadres);
  const cadre = (c) => p.frames().find((f) => f.url().includes(`/fungalaxy/${c}`));
  const lib = cadre('libramont');
  const gem = cadre('gembloux');
  await attendre(lib, () => document.querySelector('.fg-centre--cadre') && document.querySelector('.fg-centre--cadre').textContent, 15000);
  await attendre(gem, () => document.querySelector('.fg-centre--cadre') && document.querySelector('.fg-centre--cadre').textContent, 15000);
  const noms = [await lib.evaluate(() => document.querySelector('.fg-centre--cadre').textContent), await gem.evaluate(() => document.querySelector('.fg-centre--cadre').textContent)];
  ok(noms[0] === 'Libramont' && noms[1] === 'Gembloux', '[A] chaque cadre dit son centre', noms);
  // Une reservation dans le cadre de Gembloux, l autre formulaire ouvert a cote.
  await p.evaluate(() => { document.querySelectorAll('iframe')[1].scrollIntoView(); });
  await jusquAuxHeures(gem, { date, pax: 4, activite: 'bowling' });
  const avant = DOSSIERS.length;
  const fini = await finir(gem, 'bowling', '19:00');
  ok(fini, '[A] la reservation va au bout dans le cadre de Gembloux');
  const neufs = DOSSIERS.slice(avant);
  ok(neufs.length === 1 && neufs[0].centerId === 'gembloux', '[A] une seule reservation, rangee a Gembloux', neufs.map((r) => r.centerId));
  const signaux = await p.evaluate(() => (window.dataLayer || []).filter((e) => e.event === 'pinlane_booking').map((e) => e.pinlane));
  ok(signaux.length === 1 && signaux[0].center === 'gembloux', '[A] le signal de mesure du site dit Gembloux, une seule fois', signaux);
  const etrangers = appels.filter((a) => {
    const c = a.de.includes('/fungalaxy/gembloux') ? 'gembloux' : a.de.includes('/fungalaxy/libramont') ? 'libramont' : '';
    if (!c) return false;
    const u = new URL(a.url);
    const nomme = u.searchParams.get('centerId') || u.searchParams.get('center');
    const corps = a.corps ? (() => { try { return JSON.parse(a.corps).centerId || ''; } catch (e) { return ''; } })() : '';
    return (nomme && nomme !== c) || (corps && corps !== c);
  });
  ok(appels.length > 4 && etrangers.length === 0, `[A] aucun des ${appels.length} appels des deux cadres ne nomme l autre centre`, etrangers.slice(0, 3));
  await ctx.close();
}

async function remplir(browser, date) {
  // Le laser de Gembloux plein a 15:00 : Libramont garde le sien.
  ok(await reserverDirect(browser, 'gembloux', { date, pax: 20, activite: 'laser_game', heure: '15:00' }), '[B] Gembloux : 20 joueurs au laser a 15:00');
  ok(dossiersDe('libramont').every((r) => r.startTime !== '15:00'), '[B] rien de neuf a Libramont', dossiersDe('libramont').map((r) => r.startTime));
  ok(await libreA(browser, 'gembloux', { date, pax: 4, activite: 'laser_game', heure: '15:00' }) === false, '[B] Gembloux : 15:00 est complet au laser');
  ok(await libreA(browser, 'libramont', { date, pax: 4, activite: 'laser_game', heure: '15:00' }) === true, '[B] Libramont : 15:00 reste libre au laser');
  // Le laser de Libramont plein a 16:00 : Gembloux garde le sien.
  ok(await reserverDirect(browser, 'libramont', { date, pax: 30, activite: 'laser_game', heure: '16:00' }), '[B] Libramont : 30 joueurs au laser a 16:00');
  ok(await libreA(browser, 'libramont', { date, pax: 4, activite: 'laser_game', heure: '16:00' }) === false, '[B] Libramont : 16:00 est complet au laser');
  ok(await libreA(browser, 'gembloux', { date, pax: 4, activite: 'laser_game', heure: '16:00' }) === true, '[B] Gembloux : 16:00 reste libre au laser');
  // Toutes les pistes de Libramont a 20:00 : les memes numeros restent libres a Gembloux.
  ok(await reserverDirect(browser, 'libramont', { date, pax: 30, activite: 'bowling', heure: '20:00' }), '[B] Libramont : 5 pistes a 20:00');
  ok(await reserverDirect(browser, 'libramont', { date, pax: 18, activite: 'bowling', heure: '20:00' }), '[B] Libramont : les 3 dernieres pistes a 20:00');
  ok(await libreA(browser, 'libramont', { date, pax: 4, activite: 'bowling', heure: '20:00' }) === false, '[B] Libramont : plus aucune piste a 20:00');
  ok(await libreA(browser, 'gembloux', { date, pax: 4, activite: 'bowling', heure: '20:00' }) === true, '[B] Gembloux : les pistes restent libres a 20:00');
  ok(await reserverDirect(browser, 'gembloux', { date, pax: 6, activite: 'bowling', heure: '20:00' }), '[B] Gembloux : une piste a 20:00, sur le meme numero que Libramont');
  const pisteLib = dossiersDe('libramont').filter((r) => r.startTime === '20:00').flatMap((r) => r.lanes || []);
  const pisteGem = dossiersDe('gembloux').filter((r) => r.startTime === '20:00').flatMap((r) => r.lanes || []);
  ok(pisteLib.length === 8 && pisteGem.length === 1 && pisteLib.includes(pisteGem[0]), '[B] les numeros de piste sont propres a chaque centre', { pisteLib, pisteGem });
  ok(DOSSIERS.every((r) => ['libramont', 'gembloux'].includes(r.centerId)), '[B] chaque dossier porte son centre', DOSSIERS.map((r) => r.centerId));
}

async function refus(date) {
  const poster = async (corps) => {
    const avant = DOSSIERS.length;
    const r = await fetch(`${BASE}/api/public-reservations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Essai Banc', phone: '0470000000', email: 'qa@example.com', date, startTime: '15:00', pax: 4, channel: 'public', type: 'visite', label: 'Votre visite', price: 50, quotedPrice: 50, ...corps }) });
    let j = null;
    try { j = await r.json(); } catch (e) { j = null; }
    return { statut: r.status, message: j && (j.message || j.error), ecrit: DOSSIERS.length - avant, alternatives: j && Array.isArray(j.alternatives) ? j.alternatives.length : 0 };
  };
  // Le temoin : ce meme corps minimal passe, quand le centre vend ce qu on lui demande. Un refus plus bas veut donc dire
  // quelque chose ; le message de refus est lu, pas seulement le statut.
  const temoin = await poster({ centerId: 'gembloux', program: [{ activityId: 'golf_oclock', participants: 4 }], startTime: '11:00' });
  ok(temoin.statut < 300 && temoin.ecrit === 1, '[C] temoin : le meme corps passe pour le Golf o Clock a Gembloux', temoin);
  if (process.env.CD_VOIR) console.log('temoin', JSON.stringify(temoin));
  const sansCentre = await poster({ program: [{ activityId: 'minigolf_blacklight' }] });
  ok(sansCentre.statut === 422 && sansCentre.ecrit === 0, '[C] sans centre : refuse, jamais Libramont par defaut', sansCentre);
  const inconnu = await poster({ centerId: 'ciney-bis', program: [{ activityId: 'minigolf_blacklight' }] });
  ok(inconnu.statut >= 400 && inconnu.statut < 500 && inconnu.ecrit === 0, '[C] centre inconnu : refuse', inconnu);
  const golf = await poster({ centerId: 'libramont', program: [{ activityId: 'golf_oclock' }] });
  if (process.env.CD_VOIR) console.log('refus', JSON.stringify({ sansCentre, inconnu, golf }));
  const dit = (r) => /au moins une activit|ne peut pas .tre planifi/i.test(String(r.message || ''));
  ok(golf.statut >= 400 && golf.statut < 500 && golf.ecrit === 0 && dit(golf), '[C] le Golf o Clock de Gembloux est refuse a Libramont', golf);
  const run = await poster({ centerId: 'gembloux', program: [{ activityId: 'fun_run', minutes: 15 }] });
  ok(run.statut >= 400 && run.statut < 500 && run.ecrit === 0 && dit(run), '[C] le Fun Run de Libramont est refuse a Gembloux', run);
  const plaine = await poster({ centerId: 'gembloux', program: [{ activityId: 'playground' }] });
  ok(plaine.statut >= 400 && plaine.statut < 500 && plaine.ecrit === 0 && dit(plaine), '[C] la plaine de jeux de Libramont est refusee a Gembloux', plaine);
  const f6 = await poster({ centerId: 'gembloux', type: 'formule', formuleId: 'f6', pax: 8, program: undefined, price: 144, quotedPrice: 144 });
  if (process.env.CD_VOIR) console.log('refus', JSON.stringify({ run, plaine, f6 }));
  ok(f6.statut >= 400 && f6.statut < 500 && f6.ecrit === 0 && dit(f6) && f6.alternatives === 0, '[C] la Formule 6 de Libramont est refusee a Gembloux, sans autre horaire a proposer', f6);
  const runTemoin = await poster({ centerId: 'libramont', program: [{ activityId: 'fun_run', minutes: 15, participants: 4 }], startTime: '11:00', price: 30, quotedPrice: 30 });
  ok(runTemoin.statut < 300 && runTemoin.ecrit === 1, '[C] temoin : le meme corps passe pour le Fun Run a Libramont', runTemoin);
  const f6Temoin = await poster({ centerId: 'libramont', type: 'formule', formuleId: 'f6', pax: 8, program: undefined, price: 144, quotedPrice: 144, startTime: '10:00' });
  ok(f6Temoin.statut < 300 || f6Temoin.alternatives > 0, '[C] temoin : a Libramont, la Formule 6 se vend (ce corps minimal recoit ses horaires possibles)', f6Temoin);
}

async function sansCentre(browser) {
  const { ctx, p } = await page(browser);
  const erreurs = [];
  p.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text()); });
  await p.goto(`${BASE}/hote-sans`, { waitUntil: 'load', timeout: 30000 });
  await p.waitForTimeout(500);
  const e = await p.evaluate(() => ({ cadres: document.querySelectorAll('iframe').length, ancien: getComputedStyle(document.getElementById('ancien')).display }));
  ok(e.cadres === 0, '[D] une ligne sans centre ne monte aucun formulaire', e);
  ok(e.ancien !== 'none', '[D] et le formulaire du site reste visible', e);
  ok(erreurs.some((t) => /data-center/.test(t)), '[D] et l erreur se lit dans la console du navigateur', erreurs);
  await ctx.close();
}

// Ce qu une adresse demande au serveur, et ce que le visiteur voit.
async function ouvrirAdresse(browser, adresse) {
  const { ctx, p } = await page(browser);
  const centres = new Set();
  p.on('request', (r) => { const m = r.url().match(/\/api\/public-[a-z-]+\?[^#]*?(?:centerId|center)=([^&]+)/); if (m) centres.add(decodeURIComponent(m[1])); });
  await p.goto(`${BASE}${adresse}`, { waitUntil: 'networkidle', timeout: 45000 });
  await p.waitForTimeout(500);
  const vu = await p.evaluate(() => {
    const a = document.querySelector('#fgAlert');
    const nom = document.querySelector('.fg-centre--cadre, .fg-centre');
    return { alerte: a && !a.hidden ? a.textContent.trim() : '', nom: nom ? nom.textContent.trim() : '', pret: document.body.classList.contains('is-ready') };
  });
  return { ctx, p, centres: [...centres], vu };
}

async function adresses(browser) {
  const { ctx, p } = await page(browser);
  await p.goto(`${BASE}/hote-mal`, { waitUntil: 'networkidle', timeout: 45000 });
  const cadres = await p.evaluate(() => [...document.querySelectorAll('iframe')].map((f) => f.src.split('?')[0]));
  ok(cadres.length === 1 && cadres[0].endsWith('/fungalaxy/gembloux'), '[E] data-center="Gembloux " (majuscule, espace) monte Gembloux', cadres);
  await ctx.close();
  const espace = await ouvrirAdresse(browser, '/fungalaxy/gembloux%20');
  ok(espace.centres.length > 0 && espace.centres.every((c) => c === 'gembloux'), '[E] /fungalaxy/gembloux%20 reste Gembloux', espace.centres);
  await espace.ctx.close();
  const majuscule = await ouvrirAdresse(browser, '/fungalaxy/GEMBLOUX');
  ok(majuscule.centres.length > 0 && majuscule.centres.every((c) => c === 'gembloux'), '[E] /fungalaxy/GEMBLOUX reste Gembloux', majuscule.centres);
  await majuscule.ctx.close();
  for (const adresse of ['/fungalaxy/g', '/fungalaxy/pas-un-centre', '/fungalaxy/%C3%A9%C3%A9%C3%A9']) {
    const ouvert = await ouvrirAdresse(browser, adresse);
    ok(!ouvert.centres.includes('libramont'), `[E] ${adresse} ne demande rien a Libramont`, ouvert.centres);
    ok(/centre inconnu/i.test(ouvert.vu.alerte), `[E] ${adresse} dit que ce centre n existe pas`, ouvert.vu);
    ok(!/libramont/i.test(ouvert.vu.nom), `[E] ${adresse} n affiche pas Libramont`, ouvert.vu);
    // Le visiteur ne peut rien reserver : le serveur n a pas de centre, donc pas de jour a proposer.
    const avant = DOSSIERS.length;
    await ouvert.p.click('#goActivities', { timeout: 1500, force: true }).catch(() => {});
    await ouvert.p.waitForTimeout(300);
    const scene = await ouvert.p.evaluate(() => { const s = document.querySelector('.fg-scene.is-active'); return s ? s.dataset.scene : ''; });
    ok(scene !== 'heures' && scene !== 'contact' && DOSSIERS.length === avant, `[E] ${adresse} ne mene a aucune reservation`, { scene });
    await ouvert.ctx.close();
  }
}

(async () => {
  await new Promise((r) => serveur.listen(PORT, '127.0.0.1', r));
  const m = await (await fetch(`${BASE}/api/public-booking-meta?centerId=gembloux&calendar=60&calendarFrom=${new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10)}`)).json();
  // Le premier samedi normal a venir : ni vacances, ni ferie, ouvert jusqu a minuit.
  const jour = m.center.calendar.find((d) => d.weekday === 6 && d.open && !d.holiday);
  ok(Boolean(jour), 'MONTAGE : un samedi normal a venir', m.center.calendar.length);
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    const seul = process.env.CD_SEUL || 'ABCDE';
    if (seul.includes('A')) await deuxLignes(browser, jour.date);
    if (seul.includes('B')) await remplir(browser, jour.date);
    if (seul.includes('C')) await refus(jour.date);
    if (seul.includes('D')) await sansCentre(browser);
    if (seul.includes('E')) await adresses(browser);
  } finally {
    await browser.close();
    serveur.close();
  }
  console.log(echecs ? `\ncentres-dissocies-check: ${echecs} ECHEC(S) sur ${total}` : `\ncentres-dissocies-check: ALL OK (${total})`);
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

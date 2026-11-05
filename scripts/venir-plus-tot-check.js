'use strict';
// VENIR PLUS TOT (Ansar, 2026-11-05 : « on a aucune info, c est dans le flou [...] qu ils soient obliges de choisir une
// activite »). A la carte, plus d heure d arrivee libre : pour venir avant le bowling ou le laser, le client choisit ce qu il
// fait. La vraie page, les vrais gestionnaires du serveur ; seule la base est en memoire. Rien ne part en ligne.
//
//   [A] plus de ligne d arrivee a la carte : le rendez-vous se lit, le bouton n apparait que s il y a le temps ;
//   [B] le choix : les activites libres de CE centre, leur duree, leur vrai prix ; ni le bowling, ni le laser ;
//   [C] un toucher : l activite passe en tete, le rendez-vous se calcule, le bowling ne bouge pas, le prix suit ;
//   [D] tout reste relie : l heure du bowling deplace le rendez-vous ; plus le temps avant, l ecran le dit et l activite reste ;
//   [E] une deuxieme activite, le retrait, et ce qui etait deja dans la visite ;
//   [F] une heure complete : une seule proposition, puis venir a cette heure et jouer a la premiere heure libre ;
//   [G] jusqu au bout : le dossier, le plan enregistre, le mail, la feuille de secours ;
//   [H] les lecteurs de la console : la fiche et le grand tableau, et la fin de visite qui ne compte pas deux fois ;
//   [I] une formule garde sa ligne : son libre est dans son prix.
//
// Lancement : node scripts/venir-plus-tot-check.js
for (const nom of Object.keys(process.env)) if (/^(PG|DATABASE|POSTGRES|RESEND)/i.test(nom)) delete process.env[nom];
const fs = require('fs');
const http = require('http');
const path = require('path');
const vm = require('vm');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_VENIR_PLUS_TOT_PORT || 5293);
const BASE = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

let echecs = 0;
let total = 0;
function ok(condition, message, detail) {
  total += 1;
  if (condition) { console.log(`ok    ${message}`); return; }
  echecs += 1;
  console.log(`FAIL  ${message}${detail === undefined ? '' : `  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`.slice(0, 900)}`);
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
let id = 7000;
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
for (const nom of ['error', 'warn']) { const o = console[nom]; console[nom] = (...a) => { if (!/ECRITURE PERDUE|TRACE PERDUE|DATABASE_URL/.test(String(a[0]))) o(...a); }; }
const reservations = require('../api/public-reservations.js');
const availability = require('../api/public-availability.js');
const meta = require('../api/public-booking-meta.js');
const communications = require('../lib/ops-communications');
const feuille = require('../lib/feuille-secours');
const { poserLesActivitesDAvant } = require('../lib/visit-program');

// Les horaires du site et les prix du catalogue : ceux que la prod porte en base.
const HEURES = {
  regular: { 0: { open: '10:00', close: '22:00' }, 1: null, 2: { open: '14:00', close: '22:00' }, 3: { open: '12:00', close: '22:00' }, 4: { open: '14:00', close: '22:00' }, 5: { open: '14:00', close: '24:00' }, 6: { open: '10:00', close: '24:00' } },
  holiday: { 0: { open: '10:00', close: '22:00' }, 1: { open: '10:00', close: '22:00' }, 2: { open: '10:00', close: '22:00' }, 3: { open: '10:00', close: '22:00' }, 4: { open: '10:00', close: '22:00' }, 5: { open: '10:00', close: '24:00' }, 6: { open: '10:00', close: '24:00' } },
};
const fiche = (c) => JSON.parse(fs.readFileSync(path.join(ROOT, 'ops-knowledge/centers.json'), 'utf8')).centers.find((x) => x.id === c);
kn.applyCenterOverrides(new Map(['libramont', 'gembloux'].map((c) => [c, { defaultSchedule: HEURES, resources: fiche(c).resources, holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: ['manual', 'public', 'school_short'] } }])));
const socle = JSON.parse(fs.readFileSync(path.join(ROOT, 'ops-knowledge/activities.json'), 'utf8')).activities;
const PRIX = [['minigolf_blacklight', 'per_pax', 10, 'par personne'], ['golf_oclock', 'per_pax', 12.5, 'par personne'], ['billards', 'per_unit_hour', 10, 'par table et par heure'], ['playground', 'per_pax', 12, 'par enfant']];
require('../lib/catalog-store').applyCatalogState({ activities: PRIX.map(([aid, type, valeur, unite], i) => { const b = socle.find((x) => x.id === aid) || {}; return { id: aid, center_id: null, name: b.name || aid, resource_type: b.resourceType, duration_model: b.durationModel, service_model: b.serviceModel, risk_drivers: b.riskDrivers, planning_pressure: b.planningPressure, price_type: type, price_value: valeur, price_unit: unite, booking_order: i, bookable: true, active: true, source: 'seed' }; }) });

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.webm': 'video/webm', '.avif': 'image/avif' };
const serveur = http.createServer(async (rq, rs) => {
  const u = new URL(rq.url, BASE);
  try {
    if (u.pathname === '/api/public-booking-meta' && rq.method === 'POST') { rq.resume(); rs.writeHead(202, { 'Content-Type': 'application/json' }); rs.end('{"ok":true,"enregistres":0}'); return; }
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

// Le prochain samedi a plus d une semaine : ouvert de 10:00 a minuit, vacances ou non.
const SAMEDI = (() => { const d = new Date(Date.now() + 8 * 86400000); while (d.getUTCDay() !== 6) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })();
const MOIS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const attendre = (page, fn, ms, arg) => page.waitForFunction(fn, arg, { timeout: ms || 12000, polling: 80 }).then(() => true).catch(() => false);
const calme = async (page) => {
  await attendre(page, () => !document.querySelector('#hourZone').classList.contains('is-busy') && document.querySelector('#planZone .fg-visit, #planZone .fg-notice'), 15000);
  await page.waitForTimeout(350);
};

async function ouvrir(browser, { centre = 'gembloux', pax = 6, activites = ['bowling'], formule = '', w = 390, h = 844, avantHeures = null }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 700 });
  const page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  page.erreurs = [];
  page.on('pageerror', (e) => page.erreurs.push(String(e.message || e)));
  await page.goto(`${BASE}/fungalaxy/${centre}`, { waitUntil: 'networkidle', timeout: 45000 });
  await attendre(page, () => document.body.classList.contains('is-ready') && document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour', 15000);
  await page.click('#dayBtn');
  await attendre(page, () => !document.querySelector('#dayPop').hidden && document.querySelectorAll('#calGrid .fg-cal__day').length >= 28, 5000);
  const [annee, mois] = SAMEDI.split('-').map(Number);
  const cible = `${MOIS[mois - 1]} ${annee}`;
  for (let k = 0; k < 14; k += 1) {
    const titre = await page.evaluate(() => document.querySelector('#calTitle').textContent.trim());
    if (titre === cible) break;
    await page.click('#calNext');
    await attendre(page, (t) => document.querySelector('#calTitle').textContent.trim() !== t, 3000, titre);
  }
  await attendre(page, (d) => { const b = document.querySelector(`#calGrid .fg-cal__day[data-date="${d}"]`); return b && !b.classList.contains('is-loading'); }, 8000, SAMEDI);
  await page.click(`#calGrid .fg-cal__day[data-date="${SAMEDI}"]`);
  await page.waitForTimeout(250);
  await page.fill('#paxInput', String(pax));
  await page.press('#paxInput', 'Tab');
  await page.waitForTimeout(200);
  await page.click('#goActivities');
  await attendre(page, () => document.querySelector('.fg-scene[data-scene="activites"].is-active') && !document.querySelector('.fg-scene.is-entering'), 5000);
  await page.waitForTimeout(300);
  if (formule) { await page.click('#tabFor'); await page.waitForTimeout(300); await page.click(`.fg-card--formule[data-formule="${formule}"]`); await page.waitForTimeout(250); }
  else for (const a of activites) { await page.click(`[data-activity-toggle="${a}"]`); await page.waitForTimeout(250); }
  if (avantHeures) await avantHeures(page);
  await page.click('#goHours');
  await attendre(page, () => document.querySelector('.fg-scene[data-scene="heures"].is-active') && !document.querySelector('.fg-scene.is-entering'), 6000);
  await calme(page);
  return { ctx, page };
}
const lire = (page) => page.evaluate(() => {
  const t = (e) => (e ? e.textContent.replace(/\s+/g, ' ').trim() : '');
  const plus = document.querySelector('[data-avant-ouvrir]');
  const visite = t(document.querySelector('#planZone .fg-visit'));
  const montant = /Total indicatif\s*(\d+(?:,\d+)?)/.exec(visite);
  return {
    ligneArrivee: Boolean(document.querySelector('.fg-etape[data-cle="arrivee"]')),
    rdv: t(document.querySelector('.fg-rdv__heure')),
    bouton: plus && !plus.hidden ? t(plus) : '',
    lignes: [...document.querySelectorAll('.fg-etapes > .fg-etape:not(.fg-etape--borne)')].map((li) => { const h = li.querySelector('.fg-etape__heure'); return `${t(li.querySelector('.fg-etape__quoi b'))} ${h.dataset.mot || t(h)}`; }),
    recap: [...document.querySelectorAll('#planZone .fg-visit__step')].map(t),
    total: montant ? Number(montant[1].replace(',', '.')) : null,
    conseil: [...document.querySelectorAll('.fg-conseil')].filter((c) => !c.hidden).map(t).join(' | '),
    debord: document.documentElement.scrollWidth > innerWidth,
  };
});
async function poser(page, activite, heure) {
  const trouvee = await page.evaluate(({ activite, heure }) => {
    const li = document.querySelector(`.fg-etape[data-cle="${activite}"]`);
    if (li && !li.classList.contains('is-open')) li.querySelector('.fg-etape__tete').click();
    const chip = document.querySelector(`.fg-track[data-activity="${activite}"] .fg-chip[data-time="${heure}"]`);
    if (!chip) return false;
    const sec = chip.closest('.fg-period');
    if (sec && !sec.classList.contains('is-open')) { const b = sec.querySelector('.fg-period__btn'); if (b) b.click(); }
    chip.click();
    return true;
  }, { activite, heure });
  await calme(page);
  return trouvee;
}
const choix = (page) => page.evaluate(() => [...document.querySelectorAll('[data-avant-choix]')].map((b) => ({ id: b.dataset.avantChoix, texte: b.textContent.replace(/\s+/g, ' ').trim(), hauteur: Math.round(b.getBoundingClientRect().height) })));
const selectionnee = (page, a) => page.evaluate((x) => document.querySelector(`#gridAct .fg-card[data-activity="${x}"]`).classList.contains('is-on'), a);
const fermerVitrine = async (page) => {
  await attendre(page, () => { const v = document.querySelector('#vitrine'); return !v || !v.hasAttribute('data-attendue'); }, 5000);
  if (await page.evaluate(() => { const v = document.querySelector('#vitrine'); return Boolean(v && !v.hidden); })) { await page.click('#vitrine .fg-vitrine__non'); await page.waitForTimeout(350); }
};

// Une fonction de la console, tiree du vrai fichier et lancee a part.
function fonction(fichier, debut, fin, contexte) {
  const s = fs.readFileSync(path.join(ROOT, fichier), 'utf8').replace(/\r\n/g, '\n');
  const i = s.indexOf(debut);
  const j = s.indexOf(fin, i);
  if (i < 0 || j < 0) throw new Error(`${fichier} : ${debut}`);
  const c = vm.createContext(contexte);
  vm.runInContext(s.slice(i, j + fin.length), c);
  return c;
}

(async () => {
  await new Promise((r) => serveur.listen(PORT, r));
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    // [A] A LA CARTE, PLUS D HEURE D ARRIVEE LIBRE.
    let { ctx, page } = await ouvrir(browser, { centre: 'gembloux' });
    const depart = await lire(page);
    ok(!depart.ligneArrivee, '[A] plus de ligne « Arrivée » a la carte', depart);
    ok(depart.rdv === '10:00' && !depart.bouton, '[A] a l ouverture, le rendez-vous se lit et il n y a pas de plus tot', depart);
    await poser(page, 'bowling', '16:00');
    const seize = await lire(page);
    ok(seize.rdv === '15:50' && seize.bouton === 'Venir plus tôt', '[A] bowling a 16:00 : rendez-vous 15:50, et le bouton apparait', seize);
    ok(!/Rendez-vous/.test(seize.conseil) && seize.recap.some((l) => /15:50\s*Rendez-vous/.test(l)), '[A] le recapitulatif dit le meme mot', seize.recap);

    // [B] LE CHOIX.
    await page.click('[data-avant-ouvrir]');
    await page.waitForTimeout(150);
    const liste = await choix(page);
    const de = (a) => (liste.find((x) => x.id === a) || {}).texte || '';
    ok(await page.evaluate(() => document.querySelector('.fg-avant__titre').textContent.includes('Que faites-vous avant')), '[B] la question est posee');
    ok(liste.map((x) => x.id).sort().join() === 'arcade_time,billards,golf_oclock,minigolf_blacklight', '[B] les activites libres de Gembloux, ni le bowling, ni le laser', liste.map((x) => x.id));
    ok(/45 min/.test(de('golf_oclock')) && /12,50/.test(de('golf_oclock')) && !/Dès/.test(de('golf_oclock')), '[B] le golf : sa duree, son vrai prix', de('golf_oclock'));
    ok(/1 h/.test(de('billards')) && /10 €/.test(de('billards')) && liste[liste.length - 1].id === 'billards', '[B] le billard, qui se paie a la table, vient en dernier', liste.map((x) => x.id));
    ok(liste.every((x) => x.hauteur >= 44), '[B] chaque choix se touche au doigt', liste.map((x) => x.hauteur));
    ok(!(await lire(page)).debord, '[B] rien ne deborde au telephone');

    // [C] UN TOUCHER.
    await page.click('[data-avant-choix="golf_oclock"]');
    await calme(page);
    const golf = await lire(page);
    ok(golf.rdv === '15:00', '[C] le rendez-vous se calcule : 45 min de golf et l accueil avant 16:00, sur l heure pleine', golf.rdv);
    ok(/^Golf o'Clock 15:00/.test(golf.lignes[0]) && /^Bowling 16:00/.test(golf.lignes[1]), '[C] le golf en tete, le bowling n a pas bouge', golf.lignes);
    ok(/^15:00\s*Golf o'Clock/.test(golf.recap[0]) && golf.recap.some((l) => /^16:00\s*Bowling/.test(l)), '[C] le recapitulatif dit la journee dans l ordre', golf.recap);
    ok(golf.total === seize.total + 75, '[C] le prix suit : 6 x 12,50 €', { avant: seize.total, apres: golf.total });
    ok(await selectionnee(page, 'golf_oclock'), '[C] retour aux activites : le golf y est coche');
    ok(golf.bouton === 'Encore plus tôt' && !(await page.evaluate(() => { const p = document.querySelector('#fgAvant'); return p && !p.hidden; })), '[C] le choix se referme', golf.bouton);

    // [D] TOUT RESTE RELIE.
    await poser(page, 'bowling', '18:00');
    const dixHuit = await lire(page);
    ok(dixHuit.rdv === '17:00' && /^Golf o'Clock 17:00/.test(dixHuit.lignes[0]), '[D] le bowling passe a 18:00 : le rendez-vous le suit', dixHuit);
    await poser(page, 'bowling', '10:30');
    const tot = await lire(page);
    ok(tot.rdv === '10:20' && tot.lignes.length === 1, '[D] bowling a 10:30, trop tot pour le golf : il n est plus avant', tot);
    ok(/Golf o'Clock après : plus le temps avant 10:30/.test(tot.conseil), '[D] et l ecran le dit', tot.conseil);
    ok(await selectionnee(page, 'golf_oclock') && tot.total === golf.total, '[D] le golf reste dans la visite, au meme prix', tot.total);
    await poser(page, 'bowling', '16:00');

    // [E] UNE DEUXIEME ACTIVITE, ET LE RETRAIT.
    await page.click('[data-avant-ouvrir]');
    await page.waitForTimeout(150);
    const encore = await choix(page);
    ok(encore[0].id === 'golf_oclock' && /déjà dans votre visite/.test(encore[0].texte), '[E] ce qui est deja dans la visite vient en premier, sans prix en plus', encore[0]);
    await page.click('[data-avant-choix="golf_oclock"]');
    await calme(page);
    await page.click('[data-avant-ouvrir]');
    await page.waitForTimeout(150);
    await page.click('[data-avant-choix="arcade_time"]');
    await calme(page);
    const deux = await lire(page);
    ok(deux.rdv === '14:30' && /^Golf o'Clock 14:30/.test(deux.lignes[0]) && /^Arcades 15:15/.test(deux.lignes[1]) && /^Bowling 16:00/.test(deux.lignes[2]), '[E] deux activites : elles se suivent, le rendez-vous recule', deux);
    await page.click('[data-avant-retirer="arcade_time"]');
    await calme(page);
    const retire = await lire(page);
    ok(retire.rdv === '15:00' && retire.lignes.length === 2 && !(await selectionnee(page, 'arcade_time')), '[E] la croix retire ce que le choix avait ajoute, et le rendez-vous revient', retire);
    await page.click('[data-avant-retirer="golf_oclock"]');
    await calme(page);
    const sans = await lire(page);
    ok(sans.rdv === '15:50' && sans.lignes.length === 1 && await selectionnee(page, 'golf_oclock'), '[E] le golf deja choisi reste dans la visite', sans);
    await page.click('[data-avant-ouvrir]');
    await page.waitForTimeout(150);
    await page.click('[data-avant-choix="golf_oclock"]');
    await calme(page);

    // [G] JUSQU AU BOUT.
    await page.click('#goContact');
    await attendre(page, () => { const v = document.querySelector('#vitrine'); return (v && !v.hidden) || (document.querySelector('.fg-scene[data-scene="contact"].is-active') && !document.querySelector('.fg-scene.is-entering')); }, 12000);
    await fermerVitrine(page);
    await attendre(page, () => document.querySelector('.fg-scene[data-scene="contact"].is-active') && !document.querySelector('.fg-scene.is-entering'), 12000);
    await page.fill('#cPrenom', 'Essai'); await page.fill('#cNom', 'Banc'); await page.fill('#cEmail', 'qa@example.com'); await page.fill('#cTel', '0470000000');
    await page.click('.fg-occasion[data-occasion="amis"]');
    await page.evaluate(() => { const c = document.querySelector('#cConsent'); if (!c.checked) c.click(); });
    await page.click('#goRecap');
    await attendre(page, () => document.querySelector('.fg-scene[data-scene="recap"].is-active') && !document.querySelector('.fg-scene.is-entering'), 12000);
    await page.waitForTimeout(400);
    await fermerVitrine(page);
    const finale = await page.evaluate(() => document.querySelector('#recap').textContent.replace(/\s+/g, ' '));
    ok(/Rendez-vous à 15:00/.test(finale) && finale.indexOf("Golf o'Clock") < finale.indexOf('Bowling'), '[G] le recapitulatif final dit le rendez-vous et l ordre', finale.slice(0, 300));
    await page.click('#confirmBtn');
    await attendre(page, () => document.querySelector('.fg-scene[data-scene="fin"].is-active'), 15000);
    await page.waitForTimeout(250);
    const fin = await page.evaluate(() => document.querySelector('#finBody').textContent.replace(/\s+/g, ' '));
    ok(/Rendez-vous à 15:00/.test(fin) && fin.indexOf("Golf o'Clock") < fin.indexOf('Bowling'), '[G] l ecran de fin aussi', fin.slice(0, 300));
    const d = DOSSIERS[DOSSIERS.length - 1];
    const lignesDossier = (d.program && d.program.items) || d.program || [];
    ok(d.centerId === 'gembloux' && d.startTime === '15:00' && lignesDossier.some((x) => x.activityId === 'golf_oclock' && x.avant === true), '[G] le dossier : a Gembloux, a 15:00, le golf marque avant', { centre: d.centerId, debut: d.startTime });
    const posee = (d.opsPlan.timeline || []).find((s) => s.activityId === 'golf_oclock');
    ok(posee && posee.flexible === false && posee.startTime === '15:00' && posee.endTime === '15:45', '[G] le plan enregistre : le golf a son heure, comme une activite a heure', posee);
    const mail = JSON.stringify(communications.buildMessage({ reservation: { ...d, name: 'Essai Banc', email: 'qa@example.com', phone: '0470000000' }, templateId: 'confirmation', channel: 'email' }));
    ok(/Rendez-vous à 15:00/.test(mail) && /15:00 à 15:45, Golf o'Clock/.test(mail) && mail.indexOf("Golf o'Clock") < mail.indexOf('16:00 à 17:00, Bowling'), '[G] le mail : le rendez-vous, puis le programme dans l ordre', mail.slice(0, 500));
    ok(!/Golf o'Clock, à votre rythme/.test(mail), '[G] le mail ne le redit pas « à votre rythme »');
    const secours = feuille.texteProgramme(d);
    ok(/^15:00-15:45 Golf o'Clock/.test(secours[0]) && /^16:00-17:00 Bowling/.test(secours[1]), '[G] la feuille de secours le dit a son heure', secours);
    ok(page.erreurs.length === 0, '[A-G] aucune erreur de page', page.erreurs);
    await ctx.close();

    // Un dossier recalcule sans arrivee : le golf reste une activite libre, rien ne se perd.
    const sansArrivee = poserLesActivitesDAvant({ timeline: [] }, lignesDossier);
    ok(sansArrivee.timeline.length === 0, '[G] sans arrivee composee, le plan ne pose rien');
    const mailSans = JSON.stringify(communications.buildMessage({ reservation: { ...d, name: 'Essai Banc', email: 'qa@example.com', phone: '0470000000', opsPlan: { ...d.opsPlan, timeline: (d.opsPlan.timeline || []).filter((s) => s.activityId !== 'golf_oclock') } }, templateId: 'confirmation', channel: 'email' }));
    ok(/Golf o'Clock, à votre rythme/.test(mailSans), '[G] et le mail le garde, a son rythme', mailSans.slice(0, 500));

    // [E bis] Ce qui a ete choisi a l ecran des activites : la croix le rend libre, il reste dans la visite.
    ({ ctx, page } = await ouvrir(browser, { centre: 'libramont', activites: ['bowling', 'minigolf_blacklight'] }));
    await poser(page, 'bowling', '16:00');
    const libre = await lire(page);
    await page.click('[data-avant-ouvrir]');
    await page.waitForTimeout(150);
    const dejaLa = await choix(page);
    ok(dejaLa[0].id === 'minigolf_blacklight' && /déjà dans votre visite/.test(dejaLa[0].texte), '[E] le minigolf deja choisi, en premier', dejaLa[0]);
    ok(!dejaLa.some((x) => x.id === 'golf_oclock'), '[B] Libramont ne propose pas le golf de Gembloux', dejaLa.map((x) => x.id));
    await page.click('[data-avant-choix="minigolf_blacklight"]');
    await calme(page);
    const avantLui = await lire(page);
    ok(avantLui.rdv === '15:00' && avantLui.total === libre.total, '[E] un toucher le met avant, sans rien ajouter au prix', { rdv: avantLui.rdv, avant: libre.total, apres: avantLui.total });
    await page.click('[data-avant-retirer="minigolf_blacklight"]');
    await calme(page);
    ok(await selectionnee(page, 'minigolf_blacklight') && (await lire(page)).rdv === '15:50', '[E] la croix le rend libre, il reste dans la visite');
    ok(page.erreurs.length === 0, '[E] aucune erreur de page', page.erreurs);
    await ctx.close();

    // [F] UNE HEURE COMPLETE (marquee complete a l ecran ; le reste est le vrai serveur).
    ({ ctx, page } = await ouvrir(browser, { centre: 'libramont', avantHeures: async (p) => {
      await p.route('**/api/public-availability*', async (route) => {
        const r = await route.fetch();
        const j = await r.json().catch(() => null);
        if (j && j.anchors && Array.isArray(j.anchors.activities)) j.anchors.activities.forEach((a) => { if (a.activityId === 'bowling') (a.times || []).forEach((t) => { if (t.time === '16:00' || t.time === '16:30') { t.ok = false; t.code = 'capacity'; t.reason = 'Complet'; } }); });
        await route.fulfill({ response: r, json: j });
      });
    } }));
    await poser(page, 'bowling', '16:00');
    await page.waitForTimeout(300);
    const boite = await page.evaluate(() => [...document.querySelectorAll('.fg-quand')].map((b) => b.textContent.replace(/\s+/g, ' ').trim()));
    ok(boite.length === 1 && /Venir à 16:00 quand même/.test(boite[0]) && /bowling dès 17:00/.test(boite[0]), '[F] une heure complete : une seule proposition, avec l heure la plus proche', boite);
    ok(await page.evaluate(() => document.querySelectorAll('[data-avant-choix]').length === 0), '[F] rien d autre tant qu on ne la touche pas');
    await poser(page, 'bowling', '16:00');
    ok(await page.evaluate(() => document.querySelectorAll('.fg-quand').length === 1), '[F] retouchee, elle ne se repete pas');
    await page.click('[data-avant-ici]');
    await page.waitForTimeout(200);
    const ici = await choix(page);
    ok(await page.evaluate(() => /Que faites-vous à 16:00/.test(document.querySelector('.fg-quand').textContent)) && /puis bowling à 17:00/.test((ici.find((x) => x.id === 'minigolf_blacklight') || {}).texte) && /puis bowling à 17:30/.test((ici.find((x) => x.id === 'billards') || {}).texte), '[F] chaque activite dit l heure du bowling qui la suit', ici);
    await page.click('[data-avant-choix="minigolf_blacklight"]');
    await calme(page);
    const venu = await lire(page);
    ok(venu.rdv === '16:00' && /^Minigolf Blacklight 16:00/.test(venu.lignes[0]) && /^Bowling 17:00/.test(venu.lignes[1]), '[F] il vient a 16:00, joue au minigolf, puis au bowling a 17:00', venu);
    ok(await page.evaluate(() => document.querySelectorAll('.fg-quand').length === 0), '[F] la proposition s en va');
    ok(page.erreurs.length === 0, '[F] aucune erreur de page', page.erreurs);
    await ctx.close();

    // [I] UNE FORMULE GARDE SA LIGNE.
    ({ ctx, page } = await ouvrir(browser, { centre: 'gembloux', pax: 8, formule: 'f1' }));
    const formule = await lire(page);
    ok(formule.ligneArrivee && !formule.rdv && !formule.bouton, '[I] la formule 1 garde sa ligne d arrivee : son libre est dans son prix', formule);
    ok(page.erreurs.length === 0, '[I] aucune erreur de page', page.erreurs);
    await ctx.close();
  } finally {
    await browser.close();
    serveur.close();
  }

  // [H] LES LECTEURS DE LA CONSOLE.
  const pas = [{ type: 'activity', activityId: 'golf_oclock', flexible: false, startTime: '15:00', endTime: '15:45' }];
  const ligne = { activityId: 'golf_oclock', planned: false, avant: true, minutes: 45, name: "Golf o'Clock", participants: 6 };
  const horaires = fonction('assets/app-main.js', 'function getEtapeAvant(', '\n}\n', {});
  ok(horaires.getEtapeAvant({ opsPlan: { timeline: pas } }, ligne).startTime === '15:00', '[H] la fiche trouve l heure dans le plan');
  ok(horaires.getEtapeAvant({ opsPlan: { timeline: [] } }, ligne) === null && horaires.getEtapeAvant({ opsPlan: { timeline: pas } }, { ...ligne, avant: false }) === null, '[H] sans etape posee, ou sans la marque : une activite libre');
  const bloc = fonction('assets/app-main.js', 'function getVisiteLibreApres(', '\n}\n', { ligneALaJournee: () => false, getEtapeAvant: horaires.getEtapeAvant });
  const fenetres = [{ start: 16, end: 17, activityId: 'bowling', resourceType: 'bowling_lane' }];
  ok(bloc.getVisiteLibreApres({ program: { items: [ligne] }, opsPlan: { timeline: pas } }, fenetres) === 0, '[H] ce qui s est joue avant n allonge pas la fin de la visite');
  const temoin = bloc.getVisiteLibreApres({ program: { items: [{ ...ligne, avant: false }] }, opsPlan: { timeline: [] } }, fenetres);
  ok(temoin > 0, '[H] temoin : la meme activite libre, elle, se joue apres', temoin);
  const tableau = fonction('assets/pinlane-planning-global.js', 'function gpLibres(g) {', '\n  }\n', {
    getEtapeAvant: horaires.getEtapeAvant, nomActivite: (it) => it.name, gpMinutes: (a, it) => (it && it.minutes) || 0, ligneALaJournee: () => false, timeToNum: (t) => { const [h, m] = t.split(':').map(Number); return h + m / 60; },
    GP_SANS_DUREE: {}, getStaffResourceWindows: () => [{ start: 16, end: 17 }], getStaffFormulaTimedItems: () => [],
  });
  const cases = tableau.gpLibres({ r: { program: { items: [ligne] }, opsPlan: { timeline: pas } }, span: { start: 15, end: 17 } });
  ok(cases.places.length === 1 && cases.places[0].start === 15 && cases.places[0].end === 15.75 && cases.places[0].l.id === 'golf_oclock', '[H] le grand tableau pose sa case a 15:00, avant le bowling', JSON.parse(JSON.stringify(cases.places)));

  console.log(echecs ? `\nvenir-plus-tot-check: ${echecs} ECHEC(S) sur ${total}` : `\nvenir-plus-tot-check: ALL OK (${total})`);
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error('ERREUR DU GATE', e.stack || e.message); process.exit(1); });

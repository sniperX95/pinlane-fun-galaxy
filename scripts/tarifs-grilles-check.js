// LES PRIX DU BOWLING, DU LASER ET DU FUN RUN SE REGLENT PAR CENTRE (2026-11-04, lot 2
// de l onglet Tarifs & formules).
//
// Le gerant change la grille de SON centre dans la planche de l activite. Ce gate joue
// tout le chemin, sur le VRAI code : la console reelle (Edge, index.html), le POST
// qu elle envoie, les VRAIS handlers api/ops, api/public-booking-meta et
// api/public-reservations, le vrai calcul lib/booking-config.getBasePrice. Seule la
// base est une liste en memoire ('pg' remplace dans require.cache) : la production
// n est jamais touchee, rien ne part.
//
//   [S] LE SERVEUR. Un POST du droit Tarifs change le prix de CE centre : getBasePrice,
//       le Fun Run, le palier du comptoir, le catalogue public, une vraie reservation,
//       son mail, et ce que dit l agent. Gembloux garde le sien ; N4 garde son tarif a
//       la partie. Un prix au centime se facture au centime. Publier n ouvre pas un
//       centre en preparation. Les refus : sans le droit, case a 0, case inventee,
//       'all', une autre entreprise, et la porte des reglages du centre, qui n ecrit
//       ni la grille ni le tarif a la partie.
//   [E] L ECRAN. Taper dans une case : les fils partent vers les endroits touches, la
//       valeur change dans chacun, l autre centre reste affiche avec son prix, la ligne
//       garde le prix publie. Publier : UN POST, signe du centre affiche (la session
//       est sur Gembloux, l ecran sur Libramont), et le vrai serveur le prend.
//   [C] LE COMPTOIR ET LE FORMULAIRE. La vraie fenetre Reserver chiffre au prix du
//       centre, le vrai formulaire client aussi, Gembloux garde le sien, et un
//       formulaire DEJA OUVERT reprend le prix sans recharger.
//   [N] N4 regle ses prix a la partie dans la meme planche, et ne voit pas de grille.
//   [M] CHAQUE PREUVE MORD : des mutations compilees en memoire (le disque n est jamais
//       touche) rougissent le controle qu elles visent.
//
// Sortie 0 quand tout est vert, 1 sinon.
// Lancement : node scripts/tarifs-grilles-check.js
//             node scripts/tarifs-grilles-check.js --contre-preuves (15 min)
//             node scripts/tarifs-grilles-check.js --mutation=<nom>
//             PINLANE_GATE_CAPTURES=<dossier> : pose les images de chaque etat.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const Module = require('module');
const path = require('path');
const { spawnSync } = require('child_process');

process.env.NODE_ENV = 'test';
delete process.env.VERCEL;
process.env.PINLANE_CALENDAR_SYNC = 'off';
process.env.DATABASE_URL = 'postgres://gate/gate';
process.env.DATABASE_SSL = 'disable';
process.env.STAFF_AUTH_SECRET = 'gate-tarifs-grilles-secret-2026';
process.env.PLATFORM_OWNER_CODE = 'GATE-OWNER-GRILLES-2026';

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_TARIFS_GRILLES_PORT || 4373);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CAPTURES = process.env.PINLANE_GATE_CAPTURES || '';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webp': 'image/webp',
};
const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
const LF = String.fromCharCode(10);

// ---------------------------------------------------------------------------
// LES CONTRE-PREUVES. Chaque mutation casse une ligne de production et nomme le
// controle qui doit rougir. `partie` : la partie du gate qui la voit.
// ---------------------------------------------------------------------------
const MUTATIONS = {
  'calcul-sans-la-grille': { partie: 'S', fichier: 'lib/booking-config.js', de: 'return grillesEffectives(centre && centre.grillesTarif);', vers: 'return GRILLES_DE_DEPART;', cible: '[S] getBasePrice suit la grille de Libramont : bowling' },
  'fun-run-sans-le-centre': { partie: 'S', fichier: 'lib/activity-catalog.js', de: 'const grille = grillesDuCentre(centerId).funRunOptions;', vers: "const grille = grillesDuCentre('').funRunOptions;", cible: '[S] le Fun Run se facture au prix du centre' },
  'catalogue-public-sans-la-grille': { partie: 'S', fichier: 'api/public-booking-meta.js', de: 'const grilles = grillesEffectives(center && center.grillesTarif);', vers: 'const grilles = grillesEffectives(null);', cible: '[S] le catalogue public de Libramont sert ses prix' },
  'porte-des-reglages-ouverte': { partie: 'S', fichier: 'api/ops.js', de: 'sansGrillesTarif(sansCatalogueSurMesure(body.config || {}))', vers: 'sansCatalogueSurMesure(body.config || {})', cible: '[S] la porte des reglages n ecrit pas les prix' },
  'grille-perdue-a-la-sauvegarde': { partie: 'S', fichier: 'lib/center-config.js', de: 'grillesTarif: normalizeGrillesTarif(merged.grillesTarif, { strict }),', vers: 'grillesTarif: null,', cible: '[S] une autre sauvegarde garde la grille' },
  'zero-accepte': { partie: 'S', fichier: 'lib/booking-config.js', de: 'prix > 0 && prix <= PRIX_GRILLE_MAX', vers: 'prix >= 0 && prix <= PRIX_GRILLE_MAX', cible: '[S] une case a 0 est refusee' },
  'droit-tarifs-oublie': { partie: 'S', fichier: 'api/ops.js', de: "'saveSurMesure', 'saveGrillesTarif', 'garderFormuleSurMesure',", vers: "'saveSurMesure', 'garderFormuleSurMesure',", cible: '[S] sans le droit Tarifs, le POST est refuse' },
  'agent-sur-la-constante': { partie: 'S', fichier: 'lib/center-facts.js', de: 'const { bowlingPrices, laserOptions } = grillesEffectives(centre && centre.grillesTarif);', vers: 'const { bowlingPrices, laserOptions } = grillesEffectives(null);', cible: '[S] l agent annonce les prix du centre' },
  'parties-sur-une-grille': { partie: 'S', fichier: 'lib/center-config.js', de: "if (!tarif) refusGrille('Ce centre ne vend pas son bowling à la partie.');", vers: 'if (!tarif) return saveCenterConfigOverride(pool, id, {});', cible: '[S] un centre a la grille refuse les prix a la partie' },
  'statut-reecrit': { partie: 'S', fichier: 'lib/center-config.js', de: 'if (STATUS_VALUES.has(colonne.rows[0]?.status)) mergedInput.status = colonne.rows[0].status;', vers: '', cible: '[S] publier un prix n ouvre pas un centre en preparation' },
  'porte-tarif-a-la-partie': { partie: 'S', fichier: 'lib/center-config.js', de: "if (!isPlainObject(bowling) || !('pricing' in bowling)) return reste;", vers: 'return reste;', cible: '[S] la porte des reglages ne fait pas passer un centre a la partie' },
  'laser-arrondi-a-l-euro': { partie: 'S', fichier: 'lib/reservation-request.js', de: "const auCentime = request.type === 'bowling' || request.type === 'laser';", vers: 'const auCentime = false;', cible: '[S] un laser seul au centime se facture au centime' },
  'case-non-touchee-ecrasee': { partie: 'S', fichier: 'lib/center-config.js', de: '(prix === null ? tier.prices[i] : prixDeGrille(prix))', vers: 'prixDeGrille(prix)', cible: '[S] une case non touchee garde son prix' },
  'bruit-de-virgule': { partie: 'S', fichier: 'lib/booking-config.js', de: 'return auCentime(option.price * pax);', vers: 'return option.price * pax;', cible: '[S] un montant se pose au centime, sans bruit de virgule' },
  'fils-coupes': { partie: 'E', fichier: 'assets/staff-pages-v2.js', de: "const tfLieuxGrille = () => ['formulaire', 'fin', 'mails', 'comptoir'];", vers: 'const tfLieuxGrille = () => [];', cible: '[E] les fils partent de la case vers les endroits touches' },
  'publier-sans-le-centre': { partie: 'E', fichier: 'assets/staff-pages-v2.js', de: "apiRequest(tfOps(), { method: 'POST', body: pevBody(e.corps) })", vers: "apiRequest(tfOps(), { method: 'POST', body: JSON.stringify(e.corps) })", cible: '[E] le POST est signe du centre affiche' },
  'ligne-suit-le-brouillon': { partie: 'E', fichier: 'assets/staff-pages-v2.js', de: 'tfPrixCarte(a, a.publie, { publie: true })', vers: 'tfPrixCarte(a, a.publie)', cible: '[E] la ligne garde le prix publie apres un nouveau rendu' },
  'champs-ouverts-pendant-l-envoi': { partie: 'E', fichier: 'assets/staff-pages-v2.js', de: 'champsFiges(true);', vers: '', cible: '[E] pendant l envoi, les cases ne se tapent pas' },
  'ticket-a-l-euro': { partie: 'C', fichier: 'assets/app-main.js', de: '<span class="amount">${formatMontant(total)}', vers: '<span class="amount">${formatMoney(total)}', cible: '[C] le ticket dit le montant au centime' },
  'tunnel-point-decimal': { partie: 'C', fichier: 'assets/app-main.js', de: 'return `dès ${formatPrixCourt(getDurationOptionsCatalog()[0].price)}€ la piste`;', vers: 'return `dès ${getDurationOptionsCatalog()[0].price}€ la piste`;', cible: '[C] un prix au centime s ecrit en francais dans la console' },
  'n4-renvoie-tout': { partie: 'N', fichier: 'assets/staff-pages-v2.js', de: 'parties[`${t}-${i}`] : null)),', vers: 'parties[`${t}-${i}`] : Number(prix))),', cible: '[N] seule la case touchee voyage' },
  'comptoir-laser-constante': { partie: 'C', fichier: 'assets/booking-core.js', de: "const options = getBookingCatalogConfig()?.laserOptions;\n  if (Array.isArray(options) && options.length) return options;\n  if (!centerScheduleConfig?.grillesTarif) return LASER_GAME_OPTIONS;", vers: 'return LASER_GAME_OPTIONS;', cible: '[C] Reserver chiffre le laser au prix du centre' },
  'comptoir-fun-run-constante': { partie: 'C', fichier: 'assets/booking-core.js', de: 'const grille = getFunRunOptionsCatalog();', vers: 'const grille = FUN_RUN_OPTIONS;', cible: '[C] Reserver chiffre le Fun Run au prix du centre' },
  'comptoir-sans-configuration': { partie: 'C', fichier: 'assets/booking-core.js', de: "const grille = centerScheduleConfig?.grillesTarif?.[nom];", vers: 'const grille = null;', cible: '[C] la configuration staff dit le meme prix que le catalogue public' },
  'formulaire-ouvert-fige': { partie: 'C', fichier: 'assets/fungalaxy-booking.js', de: "['durationOptions', 'laserOptions', 'funRunOptions'].forEach(function (cle) { if (Array.isArray(j[cle])) meta[cle] = j[cle]; });", vers: '', cible: '[C] un formulaire deja ouvert reprend le prix sans recharger' },
  'n4-recoit-la-grille': { partie: 'N', fichier: 'assets/staff-pages-v2.js', de: "return id === 'bowling' && tfTarifParties() ? 'parties' : 'bowling';", vers: "return 'bowling';", cible: '[N] N4 voit ses prix a la partie, pas de grille par piste' },
};

const argMutation = (process.argv.find((a) => a.startsWith('--mutation=')) || '').slice('--mutation='.length);
const MUTATION = argMutation ? MUTATIONS[argMutation] : null;
if (argMutation && !MUTATION) { console.error(`mutation inconnue : ${argMutation}`); process.exit(2); }
function muter(rel, contenu) {
  if (!MUTATION || MUTATION.fichier !== rel) return contenu;
  const source = contenu.split(CRLF).join(LF);
  if (!source.includes(MUTATION.de)) throw new Error(`ancre de mutation absente de ${rel} : ${MUTATION.de.slice(0, 70)}`);
  return source.split(MUTATION.de).join(MUTATION.vers);
}
const compilePrecedent = Module.prototype._compile;
Module.prototype._compile = function (contenu, nom) {
  const rel = path.relative(ROOT, nom).split(path.sep).join('/');
  return compilePrecedent.call(this, muter(rel, contenu), nom);
};

// ---------------------------------------------------------------------------
// LE PETIT JOURNAL DU GATE.
// ---------------------------------------------------------------------------
const echecs = [];
let controles = 0;
function ok(cond, nom, detail = '') {
  controles += 1;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${nom}${cond || !detail ? '' : `  [${detail}]`}`);
  if (!cond) echecs.push(nom);
  return cond;
}
function section(titre) { console.log(`\n${titre}`); }

// ---------------------------------------------------------------------------
// LA BASE EN MEMOIRE. Trois centres de deux entreprises, comme en production :
// Libramont et Gembloux (Fun Galaxy), N4 qui vend son bowling a la partie.
// ---------------------------------------------------------------------------
const TARIF_N4 = {
  mode: 'per_game_per_person',
  minutesPerGame: 60,
  minutesPerPlayerPerGame: 10,
  tiers: [{ days: [3, 4], prices: [6, 11] }, { days: [0, 5, 6], prices: [7, 13] }],
};
const db = {
  clients: [{ id: 'fungalaxy', name: 'Fun Galaxy' }, { id: 'n4-bowling', name: 'N4 Bowling' }, { id: 'client-neuf', name: 'Client Neuf' }],
  centers: [
    { id: 'libramont', name: 'Fun Galaxy Libramont', status: 'active', timezone: 'Europe/Brussels', settings: null, client_id: 'fungalaxy' },
    { id: 'gembloux', name: 'Fun Galaxy Gembloux', status: 'active', timezone: 'Europe/Brussels', settings: null, client_id: 'fungalaxy' },
    { id: 'centre-neuf', name: 'Centre Neuf', status: 'planned', timezone: 'Europe/Brussels', settings: null, client_id: 'client-neuf' },
    { id: 'n4-bowling', name: 'N4 Bowling', status: 'active', timezone: 'Europe/Brussels', client_id: 'n4-bowling', settings: { config: { resources: { bowling: { laneCount: 8, normalCapacityPerLane: 6, emergencyCapacityPerLane: 7, pricing: TARIF_N4 }, laser: { weaponCount: 0 }, partyTables: null }, activityAvailability: { bowling: true } } } },
  ],
};
let versionCentres = 1;
const ecritures = [];
const hash = (v) => crypto.createHash('sha256').update(`${process.env.STAFF_AUTH_SECRET}:${String(v || '').trim()}`).digest('hex');
const TOKENS = { libramont: 'gate-direction-libramont', gembloux: 'gate-direction-gembloux', n4: 'gate-direction-n4', neuf: 'gate-direction-neuf', accueil: 'gate-accueil-libramont' };
const session = (token, centerId, { locked = true, permissions = [] } = {}) => ({
  token_hash: hash(token), center_id: centerId, expires_at: new Date(Date.now() + 3600000).toISOString(),
  member_id: `${centerId}:gate`, member_name: 'Gate', contact: '', member_status: 'active',
  role_id: locked ? 'direction' : 'accueil', role_name: locked ? 'Direction' : 'Accueil', role_code: locked ? 'DI' : 'AC', permissions, locked,
});
const SESSIONS = new Map([
  [hash(TOKENS.libramont), session(TOKENS.libramont, 'libramont')],
  [hash(TOKENS.gembloux), session(TOKENS.gembloux, 'gembloux')],
  [hash(TOKENS.n4), session(TOKENS.n4, 'n4-bowling')],
  [hash(TOKENS.neuf), session(TOKENS.neuf, 'centre-neuf')],
  // Les reglages sans les tarifs : la porte de saveCenterConfig, pas celle des prix.
  [hash(TOKENS.accueil), session(TOKENS.accueil, 'libramont', { locked: false, permissions: ['dashboard.view', 'planning.view', 'reservations.view', 'settings.manage', 'ai.ops'] })],
]);
const clone = (x) => JSON.parse(JSON.stringify(x));
class FakePool {
  async query(text, params = []) {
    const sql = String(text).replace(/\s+/g, ' ').trim();
    if (sql.includes('empreintes-caches')) return { rows: [{ centres: `v${versionCentres}`, surcharges: 'x', catalogue: 'x', blocages: {} }], rowCount: 1 };
    if (/^update centers set settings = jsonb_set/i.test(sql)) {
      const ligne = db.centers.find((c) => c.id === params[0]);
      if (!ligne) return { rows: [], rowCount: 0 };
      ligne.settings = { ...(ligne.settings || {}), config: JSON.parse(params[1]) };
      ligne.status = params[2];
      versionCentres += 1;
      ecritures.push(params[0]);
      return { rows: [], rowCount: 1 };
    }
    if (/from centers\b/i.test(sql)) {
      const voulus = params.map(String);
      const lignes = /where/i.test(sql) && voulus.length ? db.centers.filter((c) => voulus.includes(c.id)) : db.centers;
      return { rows: lignes.map((c) => ({ ...clone(c), client_name: (db.clients.find((x) => x.id === c.client_id) || {}).name || null })), rowCount: lignes.length };
    }
    if (/from clients\b/i.test(sql)) return { rows: clone(db.clients), rowCount: db.clients.length };
    if (/from staff_sessions s/i.test(sql) && /s\.token_hash = \$1/.test(sql)) {
      const ligne = SESSIONS.get(String(params[0] || ''));
      return ligne ? { rows: [{ ...ligne }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 0 };
  }
  async connect() { const self = this; return { query: (t, p) => self.query(t, p), release() {} }; }
  async end() {}
  on() {}
}
const pgPath = require.resolve('pg');
require.cache[pgPath] = { id: pgPath, filename: pgPath, loaded: true, exports: { Pool: FakePool } };
const rateLimit = require.resolve(path.join(ROOT, 'lib/rate-limit'));
require.cache[rateLimit] = { id: rateLimit, filename: rateLimit, loaded: true, exports: { enforceRateLimit: () => false, checkRateLimit: () => ({ allowed: true, remaining: 999, retryAfterSeconds: 0 }), getClientIp: () => 'gate' } };

// ---------------------------------------------------------------------------
// LE CODE APPLICATIF REEL.
// ---------------------------------------------------------------------------
const database = require(path.join(ROOT, 'lib/database'));
const RESERVATIONS = [];
let prochainId = 100;
database.readAvailabilitySnapshot = async (date, centerId = 'libramont') => ({ date, centerId, laneStatuses: {}, blocks: [], reservations: RESERVATIONS.filter((r) => r.date === date && r.centerId === centerId) });
database.readStaffState = database.readAvailabilitySnapshot;
database.createOpsEvent = async () => ({});
database.createReservation = async (payload) => {
  const ligne = { ...database.normalizeReservationPayload({ ...payload }, {}), id: (prochainId += 1), date: payload.date, centerId: payload.centerId };
  RESERVATIONS.push(ligne);
  return ligne;
};
const rops = require(path.join(ROOT, 'lib/reservation-ops'));
rops.afterReservationCreated = async () => ({ communications: [], warnings: [] });
const opsHandler = require(path.join(ROOT, 'api/ops.js'));
const metaHandler = require(path.join(ROOT, 'api/public-booking-meta.js'));
const availabilityHandler = require(path.join(ROOT, 'api/public-availability.js'));
const reservationsHandler = require(path.join(ROOT, 'api/public-reservations.js'));
const { getBasePrice, getBowlingGameOptions, BOWLING_PRICES } = require(path.join(ROOT, 'lib/booking-config'));
const { normalizeProgram } = require(path.join(ROOT, 'lib/visit-program'));
const { activityLinePrice } = require(path.join(ROOT, 'lib/activity-catalog'));
const { refreshCenterOverrides, getCenter, publicBookingBlockReason } = require(path.join(ROOT, 'lib/ops-knowledge'));
const { prixUnitaires } = require(path.join(ROOT, 'lib/center-facts'));
const { buildMessage } = require(path.join(ROOT, 'lib/ops-communications'));
const { getPool } = database;
const { jourDeTest } = require('./jour-de-test');
const DATE = jourDeTest({ jour: 6 });
const MERCREDI = jourDeTest({ jour: 3 });

// ---- Faux req / res pour appeler un handler depuis le gate --------------------
function fauxRes() {
  return {
    statusCode: 200, headers: {}, body: null, headersSent: false,
    setHeader(n, v) { this.headers[String(n).toLowerCase()] = v; },
    getHeader(n) { return this.headers[String(n).toLowerCase()]; },
    removeHeader(n) { delete this.headers[String(n).toLowerCase()]; },
    writeHead(s, h) { this.statusCode = s; Object.assign(this.headers, h || {}); },
    end(p) { if (p !== undefined && this.body === null) this.body = p; this.ended = true; },
    write(c) { this.body = (this.body || '') + c; },
  };
}
function fauxReq({ method = 'GET', url = '/', token = '', body = null } = {}) {
  const headers = { host: '127.0.0.1', 'x-forwarded-for': '203.0.113.9' };
  if (token) headers['x-staff-session'] = token;
  const contenu = body === null ? '' : JSON.stringify(body);
  return { method, url, headers, socket: { remoteAddress: '203.0.113.9' }, async *[Symbol.asyncIterator]() { if (contenu) yield Buffer.from(contenu, 'utf8'); } };
}
async function appeler(handler, req) {
  const res = fauxRes();
  await handler(req, res);
  let json = null;
  try { json = JSON.parse(String(res.body || '')); } catch (e) { json = null; }
  return { status: res.statusCode, json };
}
const opsPost = (token, body) => appeler(opsHandler, fauxReq({ method: 'POST', url: '/api/ops', token, body }));
const meta = (centerId) => appeler(metaHandler, fauxReq({ url: `/api/public-booking-meta?centerId=${encodeURIComponent(centerId)}` }));
const prixMeta = (m, cle, champ, valeur) => Number((((m.json && m.json[cle]) || []).find((o) => Number(o[champ]) === valeur) || {}).price);
const config = (id) => (db.centers.find((c) => c.id === id).settings || {}).config || {};
// Une grille absente se lit vide : le controle vise rougit, le gate ne plante pas avant.
const casesDe = (id, nom) => (config(id).grillesTarif || {})[nom] || {};
async function rafraichir() { await refreshCenterOverrides(getPool(), { force: true }); }
async function remiseAZero() {
  db.centers.find((c) => c.id === 'libramont').settings = null;
  const n4 = config('n4-bowling');
  n4.resources.bowling.pricing = clone(TARIF_N4);
  delete n4.grillesTarif;
  versionCentres += 1;
  RESERVATIONS.length = 0;
  ecritures.length = 0;
  await rafraichir();
}
const PRIX_POSES = { bowling: { 1: 42 }, laser: { 2: 20 }, funRun: { 15: 32 } };

// ---------------------------------------------------------------------------
// [S] LE SERVEUR.
// ---------------------------------------------------------------------------
async function serveur() {
  section('[S] Le serveur : un prix par centre');
  await rafraichir();
  const LANES = 2;
  const PAX = 10;
  ok(getBasePrice('bowling', 1, LANES, PAX, '', 'libramont') === 78 && getBasePrice('bowling', 1, LANES, PAX, '', 'gembloux') === 78, '[S] MONTAGE au depart, les deux centres sont au tarif de depart');

  // LES REFUS, avant toute ecriture.
  const sansDroit = await opsPost(TOKENS.accueil, { action: 'saveGrillesTarif', centerId: 'libramont', grilles: { bowling: { 1: 42 } } });
  ok(sansDroit.status === 403 && !ecritures.length, '[S] sans le droit Tarifs, le POST est refuse', `${sansDroit.status} ${JSON.stringify(sansDroit.json)}`);
  const refus = [
    ['[S] une case a 0 est refusee', { bowling: { 1: 0 } }],
    ['[S] une case au-dela de 1000 est refusee', { laser: { 1: 1001 } }],
    ['[S] une duree inventee est refusee', { bowling: { 3: 90 } }],
    ['[S] une grille inconnue est refusee', { minigolf: { 1: 5 } }],
    ['[S] un corps vide est refuse', {}],
    ['[S] un centre a la grille refuse les prix a la partie', { parties: [{ days: [3, 4], prices: [8, 12] }] }],
  ];
  for (const [nom, grilles] of refus) {
    const r = await opsPost(TOKENS.libramont, { action: 'saveGrillesTarif', centerId: 'libramont', grilles });
    ok(r.status === 422 && !ecritures.length, nom, `${r.status} ${JSON.stringify(r.json)} ecritures ${ecritures.length}`);
  }
  const tous = await opsPost(TOKENS.libramont, { action: 'saveGrillesTarif', centerId: 'all', grilles: { bowling: { 1: 42 } } });
  ok(tous.status >= 400 && !ecritures.length, "[S] 'all' est refuse : un centre ne regle que le sien", `${tous.status}`);
  const etranger = await opsPost(TOKENS.n4, { action: 'saveGrillesTarif', centerId: 'libramont', grilles: { bowling: { 1: 42 } } });
  ok(etranger.status === 403 && !ecritures.length, '[S] une autre entreprise ne regle pas le prix de Libramont', `${etranger.status}`);
  const porte = await opsPost(TOKENS.accueil, { action: 'saveCenterConfig', centerId: 'libramont', config: { grillesTarif: { bowling: { 1: 99 } } } });
  await rafraichir();
  ok(porte.status === 200 && getBasePrice('bowling', 1, LANES, PAX, '', 'libramont') === 78, '[S] la porte des reglages n ecrit pas les prix', `${porte.status} ${getBasePrice('bowling', 1, LANES, PAX, '', 'libramont')}`);
  const aLaPartie = { mode: 'per_game_per_person', minutesPerGame: 60, minutesPerPlayerPerGame: 10, tiers: [{ days: [0, 1, 2, 3, 4, 5, 6], prices: [1] }] };
  const porteTarif = await opsPost(TOKENS.accueil, { action: 'saveCenterConfig', centerId: 'libramont', config: { resources: { bowling: { pricing: aLaPartie } } } });
  await rafraichir();
  ok(porteTarif.status === 200 && !getCenter('libramont').resources.bowling.pricing, '[S] la porte des reglages ne fait pas passer un centre a la partie', `${porteTarif.status} ${JSON.stringify(getCenter('libramont').resources.bowling.pricing)}`);
  // UN CENTRE EN PREPARATION : sa colonne dit planned, sans configuration il vaudrait
  // 'active' par defaut. Regler ses prix avant d ouvrir ne l ouvre pas.
  const neuf = await opsPost(TOKENS.neuf, { action: 'saveGrillesTarif', centerId: 'centre-neuf', grilles: { bowling: { 1: 42 } } });
  const ligneNeuf = db.centers.find((c) => c.id === 'centre-neuf');
  await rafraichir();
  ok(neuf.status === 200 && ligneNeuf.status === 'planned' && ligneNeuf.settings.config.status === 'planned' && Boolean(publicBookingBlockReason('centre-neuf')), '[S] publier un prix n ouvre pas un centre en preparation', `${neuf.status} colonne ${ligneNeuf.status} config ${ligneNeuf.settings && ligneNeuf.settings.config.status}`);
  ecritures.length = 0;

  // LE POST DU GERANT.
  const pose = await opsPost(TOKENS.libramont, { action: 'saveGrillesTarif', centerId: 'libramont', grilles: PRIX_POSES });
  ok(pose.status === 200 && pose.json && pose.json.centerId === 'libramont', '[S] le POST du droit Tarifs est accepte', JSON.stringify(pose.json));
  ok(ecritures.join() === 'libramont', '[S] une seule ligne est ecrite, celle du centre', ecritures.join());
  ok(!config('gembloux').grillesTarif, '[S] la ligne de Gembloux ne porte rien', JSON.stringify(config('gembloux').grillesTarif));

  // LE CALCUL.
  ok(getBasePrice('bowling', 1, LANES, PAX, '', 'libramont') === 84, '[S] getBasePrice suit la grille de Libramont : bowling', `${getBasePrice('bowling', 1, LANES, PAX, '', 'libramont')}`);
  ok(getBasePrice('bowling', 1, LANES, PAX, '', 'gembloux') === 78, '[S] Gembloux garde son prix : bowling', `${getBasePrice('bowling', 1, LANES, PAX, '', 'gembloux')}`);
  ok(getBasePrice('bowling', 0.5, LANES, PAX, '', 'libramont') === 40, '[S] une case non touchee reste au tarif de depart', `${getBasePrice('bowling', 0.5, LANES, PAX, '', 'libramont')}`);
  ok(getBasePrice('laser', 1, 0, PAX, '', 'libramont') === 200 && getBasePrice('laser', 1, 0, PAX, '', 'gembloux') === 180, '[S] getBasePrice suit la grille de Libramont : laser', `${getBasePrice('laser', 1, 0, PAX, '', 'libramont')} / ${getBasePrice('laser', 1, 0, PAX, '', 'gembloux')}`);
  // Le palier du comptoir part de la grille du centre : 2 h 30 = 2 h (78) + 30 min (20).
  ok(getBasePrice('bowling', 2.5, 1, PAX, '', 'gembloux', { auPalier: true }) === 98, '[S] MONTAGE le palier du comptoir a Gembloux', `${getBasePrice('bowling', 2.5, 1, PAX, '', 'gembloux', { auPalier: true })}`);
  await opsPost(TOKENS.libramont, { action: 'saveGrillesTarif', centerId: 'libramont', grilles: { bowling: { 2: 80 } } });
  ok(getBasePrice('bowling', 2.5, 1, PAX, '', 'libramont', { auPalier: true }) === 100, '[S] le palier du comptoir part de la grille du centre', `${getBasePrice('bowling', 2.5, 1, PAX, '', 'libramont', { auPalier: true })}`);
  const apresDeuxPosts = casesDe('libramont', 'bowling');
  ok(apresDeuxPosts['1'] === 42 && apresDeuxPosts['2'] === 80, '[S] un POST suivant ajoute sa case et garde les autres', JSON.stringify(apresDeuxPosts));

  const programme = (centerId) => normalizeProgram([{ activityId: 'fun_run', minutes: 15 }, { activityId: 'bowling', duration: 1 }, { activityId: 'laser_game', games: 2 }, { activityId: 'duckpin_bowling', duration: 1 }], { centerId, pax: PAX, dateStr: DATE, startTime: '14:00', bowlingConfig: getCenter(centerId).resources.bowling });
  const lignes = (p) => Object.fromEntries(p.items.map((i) => [i.activityId, i.price]));
  const lib = lignes(programme('libramont'));
  const gem = lignes(programme('gembloux'));
  // Gembloux ne vend pas le Fun Run : sa grille se lit sur la meme ligne de calcul.
  const funRun = { id: 'fun_run', priceType: 'grid_fun_run' };
  ok(lib.fun_run === 64 && activityLinePrice(funRun, { minutes: 15, sessions: 2, centerId: 'gembloux' }) === 60, '[S] le Fun Run se facture au prix du centre', `Libramont ${lib.fun_run}, Gembloux ${activityLinePrice(funRun, { minutes: 15, sessions: 2, centerId: 'gembloux' })} (2 sessions)`);
  ok(lib.bowling === 84 && gem.bowling === 78 && lib.laser_game === 200 && gem.laser_game === 180, '[S] un programme se facture au prix du centre', JSON.stringify({ lib, gem }));
  // Gembloux ne vend pas le Duckpin : seul Libramont le facture.
  ok(lib.duckpin_bowling === 84, '[S] le Duckpin se facture sur la grille du centre', JSON.stringify({ lib, gem }));

  // LE CATALOGUE PUBLIC, ce que lit le formulaire.
  const mLib = await meta('libramont');
  const mGem = await meta('gembloux');
  ok(prixMeta(mLib, 'durationOptions', 'value', 1) === 42 && prixMeta(mLib, 'laserOptions', 'games', 2) === 20 && prixMeta(mLib, 'funRunOptions', 'minutes', 15) === 32
    && Number(mLib.json.bowlingPrices['1']) === 42 && Number(mLib.json.center.booking.bowlingPrices['1']) === 42 && Number(mLib.json.center.booking.funRunOptions[0].price) === 32, '[S] le catalogue public de Libramont sert ses prix', JSON.stringify(mLib.json && mLib.json.durationOptions));
  ok(prixMeta(mGem, 'durationOptions', 'value', 1) === BOWLING_PRICES[1] && prixMeta(mGem, 'laserOptions', 'games', 2) === 18 && prixMeta(mGem, 'funRunOptions', 'minutes', 15) === 30, '[S] le catalogue public de Gembloux garde les siens', JSON.stringify(mGem.json && mGem.json.durationOptions));

  // UNE VRAIE RESERVATION, par le vrai handler public, et son mail.
  const reservation = await appeler(reservationsHandler, fauxReq({ method: 'POST', url: '/api/public-reservations', body: {
    centerId: 'libramont', type: 'visite', date: DATE, startTime: '14:00', pax: PAX, name: 'Gate Grilles', phone: '+32470000000', email: 'gate@exemple.be', consent: true, contactConsent: true, price: 1,
    program: { items: [{ activityId: 'bowling', duration: 1 }] },
  } }));
  const ligne = RESERVATIONS[RESERVATIONS.length - 1];
  ok(reservation.status >= 200 && reservation.status < 300 && ligne && Number(ligne.price) === 84, '[S] une reservation du formulaire est facturee au prix du centre, pas au prix envoye', `${reservation.status} ${JSON.stringify(reservation.json).slice(0, 180)} prix ${ligne && ligne.price}`);
  const mail = ligne ? buildMessage({ reservation: { ...ligne, name: 'Gate Grilles', email: 'gate@exemple.be', centerId: 'libramont' }, templateId: 'reservation_confirmation', channel: 'email' }) : null;
  const texteMail = JSON.stringify(mail || {});
  ok(/84\s*€/.test(texteMail), '[S] le mail de confirmation dit le prix du centre', texteMail.slice(0, 240));

  // L AGENT.
  const facteLib = prixUnitaires(getCenter('libramont'), DATE);
  const facteGem = prixUnitaires(getCenter('gembloux'), DATE);
  ok(JSON.stringify(facteLib.bowling || {}).includes('42 EUR la piste') && JSON.stringify(facteLib.laser || {}).includes('20 EUR par personne') && JSON.stringify(facteGem.bowling || {}).includes('39 EUR la piste'), '[S] l agent annonce les prix du centre', JSON.stringify({ facteLib: facteLib.bowling, facteGem: facteGem.bowling }));

  // UNE CASE AU CENTIME SE FACTURE AU CENTIME, ce que le tunnel annonce : laser seul.
  await opsPost(TOKENS.libramont, { action: 'saveGrillesTarif', centerId: 'libramont', grilles: { laser: { 1: 9.5 } } });
  const contact = { name: 'Gate Centimes', phone: '+32470000000', email: 'gate@exemple.be', consent: true, contactConsent: true };
  const laserSeul = await appeler(reservationsHandler, fauxReq({ method: 'POST', url: '/api/public-reservations', body: { centerId: 'libramont', type: 'laser', date: DATE, startTime: '15:00', pax: 5, laserGames: 1, duration: 0.5, ...contact } }));
  const ligneLaser = RESERVATIONS[RESERVATIONS.length - 1];
  ok(laserSeul.status >= 200 && laserSeul.status < 300 && ligneLaser && Number(ligneLaser.price) === 47.5, '[S] un laser seul au centime se facture au centime', `${laserSeul.status} ${JSON.stringify(laserSeul.json).slice(0, 180)} prix ${ligneLaser && ligneLaser.price}`);
  const mailLaser = JSON.stringify(ligneLaser ? buildMessage({ reservation: { ...ligneLaser, ...contact, centerId: 'libramont' }, templateId: 'reservation_confirmation', channel: 'email' }) : {});
  ok(/47,50\s*€/.test(mailLaser), '[S] son mail dit le meme montant au centime', mailLaser.slice(0, 240));
  await opsPost(TOKENS.libramont, { action: 'saveGrillesTarif', centerId: 'libramont', grilles: { laser: { 1: 9.9 } } });
  ok(getBasePrice('laser', 0.5, 0, 3, '', 'libramont') === 29.7, '[S] un montant se pose au centime, sans bruit de virgule', `${getBasePrice('laser', 0.5, 0, 3, '', 'libramont')}`);
  await opsPost(TOKENS.libramont, { action: 'saveGrillesTarif', centerId: 'libramont', grilles: { laser: { 1: 10 } } });

  // UNE AUTRE SAUVEGARDE du centre ne perd pas la grille.
  const autre = await opsPost(TOKENS.libramont, { action: 'saveCenterConfig', centerId: 'libramont', config: { customRequest: { fromPax: 40 } } });
  ok(autre.status === 200 && Number(casesDe('libramont', 'bowling')['1']) === 42 && getBasePrice('bowling', 1, LANES, PAX, '', 'libramont') === 84, '[S] une autre sauvegarde garde la grille', `${autre.status} ${JSON.stringify(config('libramont').grillesTarif)}`);

  // N4 : SON TARIF RESTE LE SIEN.
  const n4Pose = await opsPost(TOKENS.n4, { action: 'saveGrillesTarif', centerId: 'n4-bowling', grilles: { parties: [{ days: [3, 4], prices: [6.5, 11] }] } });
  const tarifN4 = config('n4-bowling').resources.bowling.pricing;
  ok(n4Pose.status === 200 && tarifN4.tiers[0].prices[0] === 6.5 && tarifN4.tiers[0].prices[1] === 11 && tarifN4.tiers[1].prices[0] === 7, '[S] N4 regle son prix a la partie, le reste de son tarif ne bouge pas', JSON.stringify(tarifN4));
  ok(tarifN4.mode === 'per_game_per_person' && tarifN4.minutesPerPlayerPerGame === 10 && config('n4-bowling').resources.bowling.laneCount === 8, '[S] la forme du tarif de N4 et ses pistes ne bougent pas', JSON.stringify(config('n4-bowling').resources.bowling));
  const reglageN4 = getCenter('n4-bowling').resources.bowling;
  const partieN4 = getBowlingGameOptions(reglageN4, MERCREDI, { pax: 4, laneCount: 1 })[0];
  ok(partieN4.price === 6.5 && getBasePrice('bowling', partieN4.value, 1, 4, '', 'n4-bowling', { bowlingConfig: reglageN4, dateStr: MERCREDI }) === 26, '[S] getBasePrice suit le prix a la partie de N4', JSON.stringify(partieN4));
  ok(!config('n4-bowling').grillesTarif, '[S] N4 ne recoit aucune grille par piste', JSON.stringify(config('n4-bowling').grillesTarif));
  // N4 au centime, comme l annonce son tunnel : 5 joueurs a 6,50 EUR.
  const n4Public = await appeler(reservationsHandler, fauxReq({ method: 'POST', url: '/api/public-reservations', body: { centerId: 'n4-bowling', type: 'bowling', date: MERCREDI, startTime: '18:00', pax: 5, duration: partieN4.value, name: 'Gate N4', phone: '+32470000001', email: 'gate-n4@exemple.be', consent: true, contactConsent: true } }));
  const ligneN4 = RESERVATIONS[RESERVATIONS.length - 1];
  ok(n4Public.status >= 200 && n4Public.status < 300 && ligneN4 && ligneN4.centerId === 'n4-bowling' && Number(ligneN4.price) === 32.5, '[S] N4 facture sa partie au centime', `${n4Public.status} ${JSON.stringify(n4Public.json).slice(0, 200)} prix ${ligneN4 && ligneN4.price}`);
  // Une case que le gerant n a pas touchee ne voyage pas : elle garde le prix du centre.
  const n4Case = await opsPost(TOKENS.n4, { action: 'saveGrillesTarif', centerId: 'n4-bowling', grilles: { parties: [{ days: [3, 4], prices: [null, 12] }] } });
  const tarifApres = config('n4-bowling').resources.bowling.pricing;
  ok(n4Case.status === 200 && tarifApres.tiers[0].prices.join() === '6.5,12' && tarifApres.tiers[1].prices.join() === '7,13', '[S] une case non touchee garde son prix', `${n4Case.status} ${JSON.stringify(tarifApres.tiers)}`);
  await opsPost(TOKENS.n4, { action: 'saveGrillesTarif', centerId: 'n4-bowling', grilles: { parties: [{ days: [3, 4], prices: [null, 11] }] } });
  ok(Number(casesDe('libramont', 'bowling')['1']) === 42 && getBasePrice('bowling', 1, LANES, PAX, '', 'libramont') === 84, '[S] le prix de N4 ne touche pas Libramont');
  const n4Change = await opsPost(TOKENS.n4, { action: 'saveGrillesTarif', centerId: 'n4-bowling', grilles: { parties: [{ days: [1], prices: [9] }] } });
  ok(n4Change.status === 422, '[S] un palier de jours inconnu est refuse', `${n4Change.status}`);
  const n4Zero = await opsPost(TOKENS.n4, { action: 'saveGrillesTarif', centerId: 'n4-bowling', grilles: { parties: [{ days: [3, 4], prices: [0, 11] }] } });
  ok(n4Zero.status === 422, '[S] un prix a la partie a 0 est refuse', `${n4Zero.status}`);
}

// ---------------------------------------------------------------------------
// LE SERVEUR DE PAGES : les fichiers du depot (mutes en memoire si demande) et les
// vrais handlers publics.
// ---------------------------------------------------------------------------
function serveurDePages() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, BASE_URL);
    const route = { '/api/ops': opsHandler, '/api/public-booking-meta': metaHandler, '/api/public-availability': availabilityHandler, '/api/public-reservations': reservationsHandler }[url.pathname];
    if (route) {
      try { await route(req, res); } catch (error) {
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: String((error && error.message) || error) }));
      }
      return;
    }
    let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (rel === '' || rel === 'reserver' || rel.startsWith('reserver/')) rel = 'index.html';
    const fichier = path.join(ROOT, rel);
    if (!fichier.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(fichier, (err, contenu) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(fichier).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(MUTATION && MUTATION.fichier === rel ? muter(rel, contenu.toString('utf8')) : contenu);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

// La console est la vraie. Passent au vrai serveur tout ce qui porte un prix : le
// catalogue public, la configuration du centre, la lecture du catalogue et le POST ; le
// reste de la console (session, journee) lit un double, sans rapport avec les prix.
async function poserDoubles(page, { token, centerId, n4 = false }) {
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const centres = n4
    ? [{ id: 'n4-bowling', name: 'N4 Bowling', status: 'active', clientId: 'n4-bowling', clientName: 'N4 Bowling', resources: config('n4-bowling').resources, activityAvailability: { bowling: true } }]
    : [
      { id: 'libramont', name: 'Fun Galaxy Libramont', status: 'active', clientId: 'fungalaxy', clientName: 'Fun Galaxy', resources: getCenter('libramont').resources },
      { id: 'gembloux', name: 'Fun Galaxy Gembloux', status: 'active', clientId: 'fungalaxy', clientName: 'Fun Galaxy', resources: getCenter('gembloux').resources },
    ];
  await page.addInitScript(({ token, centerId, expiresAt, n4, centres }) => {
    const permissions = ['dashboard.view', 'planning.view', 'emails.view', 'reservations.view', 'reservations.create', 'reservations.quick', 'pricing.manage', 'settings.manage', 'direction.view'];
    const qaSession = { token, cookieBacked: false, centerId, expiresAt, member: { id: `${centerId}:dir`, name: 'Direction' }, role: { id: 'director', name: 'Direction', locked: false }, permissions };
    window.__posts = [];
    const J = (p) => new Response(JSON.stringify(p), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
    const natif = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const brut = typeof input === 'string' ? input : (input && input.url) || '';
      let u;
      try { u = new URL(brut, window.location.origin); } catch (e) { return natif(input, init); }
      const methode = String(init.method || 'GET').toUpperCase();
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session: qaSession });
      if (u.pathname === '/api/public-booking-meta' || u.pathname === '/api/public-availability') return natif(input, init);
      if (u.pathname === '/api/ops') {
        const action = u.searchParams.get('action');
        if (methode === 'POST') {
          let corps = {};
          try { corps = JSON.parse(init.body || '{}'); } catch (e) { corps = {}; }
          window.__posts.push(corps);
          if (corps.action === 'saveGrillesTarif') {
            if (window.__retenue) await window.__retenue;
            return natif(input, init);
          }
          return J({ ok: true });
        }
        // La vraie configuration du centre : elle remplace le catalogue public dans la
        // console des qu elle arrive, et un double sans prix ferait croire au comptoir
        // que le centre n en a pas.
        if (action === 'centerConfig' || (action === 'clientCatalog' && !n4)) return natif(input, init);
        // N4 n existe qu en base : son catalogue d activites n est pas celui du socle.
        if (action === 'clientCatalog') return J({ ok: true, testData: true, centerId, formulas: [], activities: [{ id: 'bowling', name: 'Bowling', bookable: true, priceType: 'grid_bowling', resourceType: 'bowling_lane' }], centerActivityIds: ['bowling'], centerOpenDays: null });
        return J({ ok: true, centers: centres });
      }
      if (u.pathname.startsWith('/api/')) return J({ ok: true, reservations: [], laneStatuses: {}, communications: [] });
      return natif(input, init);
    };
    try { localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession)); } catch (e) { /* ignore */ }
  }, { token, centerId, expiresAt, n4, centres });
}
async function ouvrirActivites(page, centreAffiche) {
  await page.goto(`${BASE_URL}/?v=grilles-${Date.now()}`, { waitUntil: 'load', timeout: 45000 });
  await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
  await page.evaluate(async () => { setView('staff'); await ensureStaffConsolesLoaded(); });
  await page.waitForFunction(() => typeof window.renderStaffPricingPage === 'function' && typeof state !== 'undefined', null, { timeout: 15000 });
  await page.evaluate((c) => { if (typeof hasSavedAuth === 'function') hasSavedAuth(); state.adminCenterId = c; state.staffMenuPage = 'prices'; state.staffPricingTab = 'activites'; setView('staff'); }, centreAffiche);
}
const texte = (page, selecteur) => page.evaluate((s) => { const el = document.querySelector(s); return el ? el.textContent.replace(/\s+/g, ' ').trim() : ''; }, selecteur);
const lieu = (page, cle) => texte(page, `#staffPricingPage [data-tf-lieu="${cle}"]`);
// « à publier » reste dans le DOM, cache : seul l attribut dit s il se voit.
const dit = (page, activite) => page.evaluate((id) => { const m = document.querySelector(`#staffPricingPage [data-tf-act="${id}"] [data-tf-modifie]`); return Boolean(m && !m.hidden); }, activite);
async function taperCase(page, champ, valeur) {
  await page.click(`#staffPricingPage input[data-tf-champ="${champ}"]`);
  await page.keyboard.press('Control+A');
  await page.keyboard.type(String(valeur), { delay: 40 });
  await page.waitForTimeout(1100);
}
// Edge se ferme parfois tres lentement (un run sur cinq a tenu plus de 280 s apres son
// dernier controle) : le verdict ne l attend pas.
const fermer = (x) => Promise.race([x.close().catch(() => {}), new Promise((r) => { setTimeout(r, 5000); })]);
async function capture(page, nom) {
  if (CAPTURES) await page.screenshot({ path: path.join(CAPTURES, nom) });
}

// ---------------------------------------------------------------------------
// [E] L ECRAN.
// ---------------------------------------------------------------------------
async function ecran(browser) {
  section('[E] L ecran : la planche de l activite, les fils, Publier');
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  // La session est sur Gembloux, l ecran sur Libramont : seul le centre AFFICHE compte.
  await poserDoubles(page, { token: TOKENS.gembloux, centerId: 'gembloux' });
  await ouvrirActivites(page, 'libramont');
  await page.waitForSelector('#staffPricingPage [data-tf-prix-act="bowling"]', { state: 'visible', timeout: 20000 }).catch(() => {});
  const ligne0 = await texte(page, '#staffPricingPage [data-tf-act="bowling"]');
  ok(/1 heure 39\s*€/.test(ligne0) && /Dès 20\s*€/.test(ligne0) && /Libramont/.test(ligne0), '[E] la ligne Bowling lit la grille du centre', ligne0.slice(0, 160));
  ok(!/Pinlane, pour tous/.test(ligne0), '[E] plus de « Pinlane, pour tous les centres » sur la ligne', ligne0.slice(0, 160));

  await page.click('#staffPricingPage [data-tf-prix-act="bowling"]');
  await page.waitForFunction(() => document.activeElement && (document.activeElement.getAttribute('data-tf-champ') || '').startsWith('grille:bowling:'), null, { timeout: 5000 }).catch(() => {});
  ok(await page.evaluate(() => (document.activeElement.getAttribute('data-tf-champ') || '').startsWith('grille:bowling:')), '[E] un clic sur le prix ouvre la planche et donne le focus a la premiere case');
  const planche0 = await texte(page, '#staffPricingPage [data-tf-planche="bowling"]');
  ok(!/Bientôt réglable|Fixé par Pinlane/.test(planche0), '[E] la planche ne dit plus « Bientôt réglable »', planche0.slice(0, 160));
  ok(/Pour Libramont/.test(planche0), '[E] la planche dit pour quel centre', planche0.slice(0, 200));
  ok(/même grille sert au Bowling et Duckpin/.test(planche0), '[E] la planche dit que le Duckpin suit la meme grille', planche0.slice(0, 400));
  ok(await page.$$eval('#staffPricingPage [data-tf-planche="bowling"] input[data-tf-champ^="grille:bowling:"]', (l) => l.length) === 4, '[E] quatre cases, une par duree');
  await page.evaluate(() => document.activeElement.blur());
  await page.waitForTimeout(300);
  await capture(page, 'grille-1-bowling-au-repos.png');

  // Les fils : au focus, ils partent de la case vers chaque endroit touche.
  await page.click('#staffPricingPage input[data-tf-champ="grille:bowling:1"]');
  await page.waitForTimeout(500);
  const fils = await page.evaluate(() => {
    const planche = document.querySelector('#staffPricingPage [data-tf-planche="bowling"]');
    const etats = Object.fromEntries([...planche.querySelectorAll('[data-tf-lieu]')].map((el) => [el.getAttribute('data-tf-lieu'), el.getAttribute('data-tf-etat')]));
    const paths = [...planche.querySelectorAll('path[data-tf-fil]')];
    const trace = planche.querySelector('.tf-trace');
    const case1 = planche.querySelector('[data-tf-r="grille:bowling:1"]');
    const portCase = planche.querySelector('[data-tf-fil-depart]');
    const rangee = case1 ? case1.getBoundingClientRect() : { top: 0, bottom: 0 };
    const port = portCase ? portCase.getBoundingClientRect() : { top: -1, bottom: -1 };
    return {
      etats,
      fils: paths.map((p) => p.getAttribute('data-tf-fil')),
      longueurs: paths.map((p) => p.getTotalLength()),
      champ: trace ? trace.getAttribute('data-tf-champ') : '',
      actif: case1 && case1.classList.contains('is-actif'),
      departDansLaRangee: port.top >= rangee.top - 1 && port.bottom <= rangee.bottom + 1,
      phraseAutres: planche.querySelector('[data-tf-lieu="autres"] [data-tf-phrase]').textContent,
    };
  });
  ok(['formulaire', 'fin', 'mails', 'comptoir'].every((l) => fils.fils.includes(l) && fils.etats[l] === 'concerne') && fils.longueurs.length === 4 && fils.longueurs.every((x) => x > 20) && fils.champ === 'grille:bowling:1', '[E] les fils partent de la case vers les endroits touches', JSON.stringify(fils));
  ok(fils.actif && fils.departDansLaRangee, '[E] le fil part bien de la rangee de la case en main', JSON.stringify(fils));
  ok(fils.etats.autres === 'pas-concerne' && /Gembloux garde son propre prix/.test(fils.phraseAutres), '[E] l autre centre est dit pas concerne', JSON.stringify(fils.etats) + fils.phraseAutres);

  // Le mouvement passe en 1 s : on note le point et l eclat quand ils arrivent.
  await page.evaluate(() => {
    window.__vus = { goutte: 0, eclat: 0 };
    new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => {
      if (!(n instanceof Element)) return;
      if (n.classList.contains('tf-goutte')) window.__vus.goutte += 1;
      if (n.classList.contains('tf-eclat')) window.__vus.eclat += 1;
    }))).observe(document.querySelector('#staffPricingPage'), { childList: true, subtree: true });
  });
  await taperCase(page, 'grille:bowling:1', '42');
  const apres = { formulaire: await lieu(page, 'formulaire'), fin: await lieu(page, 'fin'), mails: await lieu(page, 'mails'), comptoir: await lieu(page, 'comptoir'), autres: await lieu(page, 'autres') };
  ok(/1 heure\s*42\s*€/.test(apres.formulaire) && /2 pistes × 42\s*€/.test(apres.formulaire) && /84\s*€/.test(apres.formulaire), '[E] le formulaire suit le brouillon : case, pistes, total', apres.formulaire);
  ok(/Montant indicatif 84\s*€/.test(apres.fin), '[E] l ecran de fin suit le brouillon', apres.fin);
  ok(/Montant estimé\s*84\s*€/.test(apres.mails), '[E] le mail suit le brouillon', apres.mails);
  ok(/84\s*€/.test(apres.comptoir) && /2 pistes/.test(apres.comptoir), '[E] Reserver suit le brouillon', apres.comptoir);
  ok(/39\s*€ à Gembloux/.test(apres.autres), '[E] Gembloux reste affiche avec SON prix', apres.autres);
  const vus = await page.evaluate(() => window.__vus);
  ok(vus.goutte > 0 && vus.eclat > 0, '[E] le point court sur les fils et l endroit s eclaire', JSON.stringify(vus));
  const couleurs = await page.evaluate(() => {
    const planche = document.querySelector('#staffPricingPage [data-tf-planche="bowling"]');
    const c = (cle) => { const el = planche.querySelector(`[data-tf-lieu="formulaire"] [data-tf-val="${cle}"]`); return el ? getComputedStyle(el).color : ''; };
    return { visee: c('opt:grille:bowling:1'), autre: c('opt:grille:bowling:2') };
  });
  ok(Boolean(couleurs.visee) && couleurs.visee !== couleurs.autre, '[E] la valeur de la case en main prend l accent, pas ses voisines', JSON.stringify(couleurs));
  await capture(page, 'grille-2-bowling-les-fils.png');
  const ligne1 = await texte(page, '#staffPricingPage [data-tf-act="bowling"]');
  ok(/1 heure 39\s*€/.test(ligne1) && await dit(page, 'bowling'), '[E] la ligne garde le prix publie et dit « à publier »', ligne1.slice(0, 160));
  ok(await dit(page, 'duckpin_bowling') && !(await dit(page, 'laser_game')), '[E] le Duckpin, meme grille, dit aussi « à publier », pas le laser');

  // Une case illisible : elle le dit, et reprend sa valeur en sortant.
  await page.click('#staffPricingPage input[data-tf-champ="grille:bowling:0.5"]');
  await page.keyboard.press('Control+A');
  await page.keyboard.type('0', { delay: 30 });
  await page.waitForTimeout(250);
  const aide = await texte(page, '#staffPricingPage [data-tf-aide="grille:bowling:0.5"]');
  ok(/plus de 0/.test(aide), '[E] une case a 0 le dit tout de suite', aide);
  await capture(page, 'grille-2b-case-a-zero.png');
  await page.click('#staffPricingPage input[data-tf-champ="grille:bowling:1"]');
  await page.waitForTimeout(250);
  ok(await page.$eval('#staffPricingPage input[data-tf-champ="grille:bowling:0.5"]', (el) => el.value) === '20', '[E] en sortant, elle reprend sa valeur');

  // La case la moins chere : le « Dès » de la planche suit, celui de la ligne attend.
  await taperCase(page, 'grille:bowling:0.5', '18');
  const des = await lieu(page, 'formulaire');
  ok(/Dès 18\s*€/.test(des), '[E] le « Dès » de la planche suit la case la moins chere', des);
  // LASER : une autre activite, le meme brouillon. L ouvrir repeint toute la page.
  await page.click('#staffPricingPage [data-tf-prix-act="laser_game"]');
  await page.waitForSelector('#staffPricingPage [data-tf-planche="laser_game"]', { state: 'visible', timeout: 5000 });
  const ligneRepeinte = await texte(page, '#staffPricingPage [data-tf-act="bowling"]');
  ok(/Dès 20\s*€/.test(ligneRepeinte) && /1 heure 39\s*€/.test(ligneRepeinte) && await dit(page, 'bowling'), '[E] la ligne garde le prix publie apres un nouveau rendu', ligneRepeinte.slice(0, 160));
  await taperCase(page, 'grille:laser:2', '20');
  const laser = await lieu(page, 'formulaire');
  ok(/2 parties\s*20\s*€/.test(laser) && /10 joueurs × 20\s*€/.test(laser) && /200\s*€/.test(laser), '[E] le laser se chiffre par joueur', laser);
  // FUN RUN.
  await page.click('#staffPricingPage [data-tf-prix-act="fun_run"]');
  await page.waitForSelector('#staffPricingPage [data-tf-planche="fun_run"]', { state: 'visible', timeout: 5000 });
  await taperCase(page, 'grille:funRun:15', '32');
  const funRun = await lieu(page, 'formulaire');
  ok(/15 min\s*32\s*€/.test(funRun) && /2 sessions × 32\s*€/.test(funRun) && /64\s*€/.test(funRun), '[E] le Fun Run se chiffre par session', funRun);
  const mise = await page.evaluate(() => {
    const planche = document.querySelector('#staffPricingPage [data-tf-planche]');
    const table = planche.closest('.tf-table');
    const b = document.querySelector('#staffPricingPage [data-tf-barre] [data-tf-action="publier"]');
    const r = b.getBoundingClientRect();
    const dessus = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { n: document.querySelector('[data-tf-barre-n]').textContent, touche: Boolean(dessus && b.contains(dessus)), bas: r.bottom, fenetre: innerHeight, deborde: table.scrollWidth - table.clientWidth, page: document.documentElement.scrollWidth - innerWidth };
  });
  ok(mise.n === '4' && mise.touche && mise.bas <= mise.fenetre, '[E] la barre compte quatre changements et Publier se touche', JSON.stringify(mise));
  ok(mise.deborde <= 1 && mise.page <= 1, '[E] la planche tient dans sa table', JSON.stringify(mise));

  // Le recapitulatif.
  await page.click('#staffPricingPage [data-tf-action="voir"]');
  await page.waitForSelector('#staffPricingPage [data-tf-changement="bowling|1"]', { state: 'visible', timeout: 5000 });
  await page.waitForTimeout(350);
  const chg = await texte(page, '#staffPricingPage [data-tf-changement="bowling|1"]');
  ok(/1 heure : 39\s*€ → 42\s*€ la piste/.test(chg) && /78\s*€.*84\s*€/.test(chg) && /39\s*€ à Gembloux/.test(chg), '[E] « Ce qui change » dit l avant, l apres et Gembloux', chg.slice(0, 400));
  await capture(page, 'grille-3-ce-qui-change.png');
  await page.click('#staffPricingPage [data-tf-changement="bowling|0.5"] [data-tf-action="annuler-changement"]');
  await page.waitForTimeout(250);
  ok(await page.$('#staffPricingPage [data-tf-changement="bowling|0.5"]') === null && await page.$('#staffPricingPage [data-tf-changement="bowling|1"]') !== null, '[E] un changement s annule seul, les autres restent');
  await page.click('#staffPricingPage [data-tf-tiroir] .tf-t-fermer');
  await page.waitForTimeout(250);

  // PUBLIER : un POST, signe du centre affiche, pris par le vrai serveur.
  const centreAffiche = await page.evaluate(() => getCurrentStaffCenterId());
  await page.evaluate(() => { window.__retenue = new Promise((r) => { window.__lacher = r; }); });
  await page.click('#staffPricingPage [data-tf-barre] [data-tf-action="publier"]');
  await page.waitForFunction(() => window.__posts.some((b) => b.action === 'saveGrillesTarif'), null, { timeout: 8000 }).catch(() => {});
  const figees = await page.$$eval('#staffPricingPage input[data-tf-champ]', (l) => l.length > 0 && l.every((x) => x.readOnly));
  ok(figees, '[E] pendant l envoi, les cases ne se tapent pas');
  await page.evaluate(() => { window.__retenue = null; window.__lacher(); });
  await page.waitForTimeout(800);
  const posts = await page.evaluate(() => window.__posts.filter((b) => b.action === 'saveGrillesTarif'));
  const post = posts[0] || {};
  ok(posts.length === 1, '[E] une seule ecriture pour toutes les cases', JSON.stringify(posts));
  ok(centreAffiche === 'libramont' && post.centerId === 'libramont', '[E] le POST est signe du centre affiche', `${post.centerId} / ecran ${centreAffiche}, session sur gembloux`);
  ok(JSON.stringify(post.grilles) === JSON.stringify(PRIX_POSES), '[E] le POST ne porte que les cases changees', JSON.stringify(post.grilles));
  ok(ecritures.join() === 'libramont' && Number(casesDe('libramont', 'bowling')['1']) === 42 && !config('gembloux').grillesTarif, '[E] le vrai serveur a ecrit la ligne de Libramont, et elle seule', `${ecritures.join()} ${JSON.stringify(config('libramont').grillesTarif)}`);
  ok(getBasePrice('bowling', 1, 2, 10, '', 'libramont') === 84 && getBasePrice('bowling', 1, 2, 10, '', 'gembloux') === 78, '[E] getBasePrice suit ce que l ecran a publie', `${getBasePrice('bowling', 1, 2, 10, '', 'libramont')}`);

  await page.waitForFunction(() => /1 heure 42\s*€/.test((document.querySelector('#staffPricingPage [data-tf-act="bowling"]') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(600);
  const ligne2 = await texte(page, '#staffPricingPage [data-tf-act="bowling"]');
  ok(/1 heure 42\s*€/.test(ligne2) && !(await dit(page, 'bowling')), '[E] la ligne dit le nouveau prix apres la publication, sans « à publier »', ligne2.slice(0, 160));
  ok(await page.$('#staffPricingPage [data-tf-barre]') === null, '[E] la barre s en va, plus rien a publier');
  ok(await page.$$eval('#staffPricingPage input[data-tf-champ]', (l) => l.length > 0 && l.every((x) => !x.readOnly)), '[E] apres l envoi, les cases se tapent de nouveau');
  if (CAPTURES) await etatsAuRegard(page);
  ok(erreurs.length === 0, '[E] aucune erreur de page', erreurs.join(' | '));
  await fermer(page);
}

// Les etats qu on ouvre pour les regarder, seulement quand on demande les images.
async function etatsAuRegard(page) {
  await capture(page, 'grille-7-publie.png');
  for (const [id, nom] of [['laser_game', 'laser'], ['duckpin_bowling', 'duckpin'], ['fun_run', 'fun-run']]) {
    await page.click(`#staffPricingPage [data-tf-prix-act="${id}"]`);
    await page.waitForSelector(`#staffPricingPage [data-tf-planche="${id}"]`, { state: 'visible', timeout: 5000 });
    await page.evaluate(() => { document.activeElement.blur(); document.querySelector('#staffPricingPage [data-tf-act].is-ouverte').scrollIntoView({ block: 'start' }); });
    await page.waitForTimeout(500);
    await capture(page, `grille-8-${nom}.png`);
  }
  await page.evaluate(() => setStaffTheme('light'));
  await page.waitForTimeout(500);
  await capture(page, 'grille-9-theme-clair.png');
  await page.evaluate(() => setStaffTheme('dark'));
  for (const [largeur, hauteur, nom] of [[1024, 768, 'tablette'], [390, 844, 'telephone']]) {
    await page.setViewportSize({ width: largeur, height: hauteur });
    await page.waitForTimeout(500);
    await page.evaluate(() => document.querySelector('#staffPricingPage [data-tf-act].is-ouverte').scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(300);
    await capture(page, `grille-10-${nom}.png`);
  }
}

// ---------------------------------------------------------------------------
// [C] LE COMPTOIR ET LE FORMULAIRE, sur des prix poses par le vrai POST.
// ---------------------------------------------------------------------------
async function comptoir(browser) {
  section('[C] Reserver suit le prix du centre');
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  await poserDoubles(page, { token: TOKENS.libramont, centerId: 'libramont' });
  await ouvrirActivites(page, 'libramont');
  await page.waitForSelector('#staffPricingPage [data-tf-act="bowling"]', { state: 'visible', timeout: 20000 }).catch(() => {});
  await page.waitForFunction(() => getBowlingPrices()[1] === 42, null, { timeout: 8000 }).catch(() => {});

  // LA VRAIE FENETRE RESERVER : ce que l equipe lit au comptoir.
  await page.evaluate((date) => { openQuickBook({ date, pax: 10 }); }, DATE);
  await page.waitForSelector('.qb-modal.rv.rs', { state: 'visible', timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(400);
  const fenetre = await texte(page, '.qb-modal.rv.rs');
  ok(/Bowling\s*42\s*€ la piste/.test(fenetre) && /Bowling 1 h.*84\s*€/.test(fenetre), '[C] Reserver chiffre le bowling au prix du centre', fenetre.slice(0, 260));
  ok(/Pixel\s*64\s*€/.test(fenetre), '[C] Reserver chiffre le Fun Run au prix du centre', fenetre.slice(0, 500));
  ok(/Duckpin\s*84\s*€/.test(fenetre), '[C] le Duckpin suit la meme grille', fenetre.slice(0, 500));
  await page.click('.qb-modal.rv.rs [data-quoi="laser_game"][data-var="2"]');
  await page.waitForTimeout(300);
  // (le laser est replie a cote du bowling propose : « Choisir » le prend a sa place, 2026-11-08)
  await page.click('.qb-modal.rv.rs #rsAjout-laser_game');
  await page.waitForTimeout(500);
  const avecLaser = await texte(page, '.qb-modal.rv.rs');
  ok(/Laser\s*20\s*€ par joueur/.test(avecLaser) && /Laser, 2 parties.*200\s*€/.test(avecLaser), '[C] Reserver chiffre le laser au prix du centre', avecLaser.slice(-500));
  await capture(page, 'grille-4-reserver.png');

  // La configuration staff (sans bloc booking) dit la meme chose : c est la voie d un
  // role qui a les reglages, une fois sa configuration arrivee.
  const parConfig = await page.evaluate((date) => {
    const avant = getCenterScheduleConfig();
    setCenterScheduleConfig({ id: 'libramont', resources: avant.resources, grillesTarif: { bowling: { 1: 42 }, laser: { 2: 20 }, funRun: { 15: 32 } } });
    const lu = { bowling: getBasePrice('bowling', 1, 2, 10, '', date), laser: getBasePrice('laser', 1, 0, 10, '', date), funRun: getFunRunOptionsCatalog()[0].price, autre: getBasePrice('bowling', 2, 1, 1, '', date) };
    setCenterScheduleConfig(avant);
    return lu;
  }, DATE);
  ok(parConfig.bowling === 84 && parConfig.laser === 200 && parConfig.funRun === 32 && parConfig.autre === 78, '[C] la configuration staff dit le meme prix que le catalogue public', JSON.stringify(parConfig));
  // Une grille peut porter des centimes : elle s ecrit en francais, jamais « 20.5€ ».
  const auCentime = await page.evaluate(() => {
    const avant = getCenterScheduleConfig();
    setCenterScheduleConfig({ id: 'libramont', resources: avant.resources, grillesTarif: { bowling: { 0.5: 20.5 } } });
    const lu = activityPriceHint({ id: 'bowling', priceType: 'grid_bowling' }, 10);
    setCenterScheduleConfig(avant);
    return lu;
  });
  ok(auCentime === 'dès 20,50€ la piste', '[C] un prix au centime s ecrit en francais dans la console', auCentime);
  const ticket = await page.evaluate((date) => {
    const html = renderPosCaisse({ id: 77, status: 'confirmed', type: 'bowling', label: 'Bowling', centerId: 'libramont', date, startTime: '15:00', duration: 1, pax: 5, lanes: [1], price: 39.5, basePrice: 39.5, extras: [] });
    const zone = document.createElement('div');
    zone.innerHTML = html;
    return { total: zone.querySelector('.receipt-total .amount').textContent, ajuste: Boolean(zone.querySelector('.receipt-custom')), etiquette: getPricingPriceLabel({ type: 'laser', price: 6.5 }) };
  }, DATE);
  ok(/^39,50\s*€$/.test(ticket.total.trim()) && !ticket.ajuste, '[C] le ticket dit le montant au centime', JSON.stringify(ticket));
  ok(/^6,50\s*€ \/ personne$/.test(ticket.etiquette), '[C] Copier et Exporter disent le prix au centime', JSON.stringify(ticket));
  ok(erreurs.length === 0, '[C] aucune erreur de page au comptoir', erreurs.join(' | '));
  await fermer(page);
}

async function formulaireClient(browser) {
  section('[C] Le formulaire client suit le prix du centre');
  const ouvrir = async (centre) => {
    const f = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    f.on('pageerror', (e) => ok(false, `[C] erreur de page dans le formulaire de ${centre}`, e.message));
    await f.goto(`${BASE_URL}/fungalaxy.html?center=${centre}`, { waitUntil: 'load', timeout: 45000 });
    await f.click('#dayBtn');
    for (let i = 0; i < 6; i += 1) {
      if (await f.evaluate((d) => Boolean(document.querySelector(`#calGrid .fg-cal__day[data-date="${d}"]`)), DATE)) break;
      await f.click('#calNext');
    }
    await f.click(`#calGrid .fg-cal__day[data-date="${DATE}"]`);
    await f.fill('#paxInput', '10');
    await f.click('#goActivities');
    await f.waitForSelector('#gridAct .fg-card[data-activity="bowling"]', { timeout: 15000 });
    return f;
  };
  const carte = (f, id) => texte(f, `#gridAct li[data-activity="${id}"]`);
  const lib = await ouvrir('libramont');
  await lib.click('#gridAct .fg-card[data-activity="bowling"]');
  await lib.waitForTimeout(300);
  const bowling = await carte(lib, 'bowling');
  ok(/2 pistes × 42\s*€ = 84\s*€/.test(bowling) && /1 heure\s*42\s*€/.test(bowling), '[C] la carte du bowling a Libramont dit le prix du centre', bowling);
  const funRun = await carte(lib, 'fun_run');
  ok(/Dès 32\s*€ \/ session/.test(funRun) && /15 min\s*32\s*€/.test(funRun), '[C] la carte du Fun Run a Libramont dit le prix du centre', funRun);
  const laser = await carte(lib, 'laser_game');
  ok(/2 parties\s*20\s*€/.test(laser), '[C] la carte du laser a Libramont dit le prix du centre', laser);
  await capture(lib, 'grille-5-formulaire-client.png');

  const gem = await ouvrir('gembloux');
  await gem.click('#gridAct .fg-card[data-activity="bowling"]');
  await gem.waitForTimeout(300);
  const bowlingGem = await carte(gem, 'bowling');
  ok(/2 pistes × 39\s*€ = 78\s*€/.test(bowlingGem), '[C] le formulaire de Gembloux garde son prix', bowlingGem);
  await fermer(gem);

  // UN FORMULAIRE DEJA OUVERT : le gerant publie, le client revient sur l onglet.
  await lib.evaluate(() => { window.__memeChargement = 1; });
  const encore = await opsPost(TOKENS.libramont, { action: 'saveGrillesTarif', centerId: 'libramont', grilles: { bowling: { 1: 44 }, funRun: { 15: 33 } } });
  ok(encore.status === 200, '[C] MONTAGE le gerant publie pendant que le formulaire est ouvert', `${encore.status}`);
  await lib.bringToFront();
  await lib.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await lib.waitForFunction(() => /× 44\s*€ = 88\s*€/.test((document.querySelector('#gridAct li[data-activity="bowling"]') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
  const ouvert = { bowling: await carte(lib, 'bowling'), funRun: await carte(lib, 'fun_run'), meme: await lib.evaluate(() => window.__memeChargement === 1) };
  ok(ouvert.meme && /2 pistes × 44\s*€ = 88\s*€/.test(ouvert.bowling) && /Dès 33\s*€ \/ session/.test(ouvert.funRun), '[C] un formulaire deja ouvert reprend le prix sans recharger', JSON.stringify(ouvert));
  // Une grille peut porter des centimes : le client lit « 44,50 € », jamais « 44,5 € ».
  await opsPost(TOKENS.libramont, { action: 'saveGrillesTarif', centerId: 'libramont', grilles: { bowling: { 1: 44.5 } } });
  await lib.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await lib.waitForFunction(() => /= 89\s*€/.test((document.querySelector('#gridAct li[data-activity="bowling"]') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
  const auCentime = await carte(lib, 'bowling');
  ok(/2 pistes × 44,50\s*€ = 89\s*€/.test(auCentime), '[C] un prix au centime s ecrit en francais dans le formulaire', auCentime);
  await fermer(lib);
}

// ---------------------------------------------------------------------------
// [N] N4 : SES PRIX A LA PARTIE, DANS LA MEME PLANCHE.
// ---------------------------------------------------------------------------
async function n4(browser) {
  section('[N] N4 regle son bowling a la partie');
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  await poserDoubles(page, { token: TOKENS.n4, centerId: 'n4-bowling', n4: true });
  await ouvrirActivites(page, 'n4-bowling');
  await page.waitForSelector('#staffPricingPage [data-tf-act="bowling"]', { state: 'visible', timeout: 20000 }).catch(() => {});
  await page.waitForFunction(() => /€/.test((document.querySelector('#staffPricingPage [data-tf-act="bowling"]') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
  const ligne = await texte(page, '#staffPricingPage [data-tf-act="bowling"]');
  ok(/1 partie.*6\s*€/.test(ligne) && !/piste/.test(ligne), '[N] N4 voit ses prix a la partie, pas de grille par piste', ligne.slice(0, 220));
  await page.click('#staffPricingPage [data-tf-act="bowling"] .tf-ligne-btn');
  await page.waitForSelector('#staffPricingPage [data-tf-planche="bowling"]', { state: 'visible', timeout: 5000 });
  const champs = await page.$$eval('#staffPricingPage [data-tf-planche="bowling"] input[data-tf-champ]', (l) => l.map((x) => x.getAttribute('data-tf-champ')));
  ok(champs.length === 4 && champs.every((c) => c.startsWith('grille:parties:')), '[N] une case par partie et par palier de jours', champs.join(','));
  await taperCase(page, 'grille:parties:0-0', '6,50');
  const form = await lieu(page, 'formulaire');
  ok(/1 partie[^·]*6,50\s*€/.test(form) && /10 joueurs × 6,50\s*€/.test(form) && /65\s*€/.test(form), '[N] la planche chiffre par joueur', form);
  ok(await page.$('#staffPricingPage [data-tf-lieu="autres"]') === null, '[N] pas d autre centre dans son entreprise, pas d endroit pour lui');
  await capture(page, 'grille-6-n4-a-la-partie.png');
  if (CAPTURES) {
    await page.click('#staffPricingPage [data-tf-action="voir"]');
    await page.waitForSelector('#staffPricingPage [data-tf-changement]', { state: 'visible', timeout: 5000 });
    await page.waitForTimeout(350);
    await capture(page, 'grille-6b-n4-ce-qui-change.png');
    await page.click('#staffPricingPage [data-tf-tiroir] .tf-t-fermer');
    await page.waitForTimeout(250);
  }
  // Un collegue change un autre prix pendant que la case est en main : l ecran ne le sait pas.
  config('n4-bowling').resources.bowling.pricing.tiers[1].prices[0] = 8;
  versionCentres += 1;
  await page.click('#staffPricingPage [data-tf-barre] [data-tf-action="publier"]');
  await page.waitForFunction(() => window.__posts.some((b) => b.action === 'saveGrillesTarif'), null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(800);
  const post = (await page.evaluate(() => window.__posts.filter((b) => b.action === 'saveGrillesTarif')))[0] || { grilles: {} };
  ok(post.centerId === 'n4-bowling' && !post.grilles.bowling, '[N] le POST porte ses prix a la partie, signe de N4', JSON.stringify(post));
  ok(JSON.stringify(post.grilles.parties) === JSON.stringify([{ days: [3, 4], prices: [6.5, null] }]), '[N] seule la case touchee voyage', JSON.stringify(post.grilles.parties));
  const tarif = config('n4-bowling').resources.bowling.pricing;
  ok(tarif.tiers[0].prices.join() === '6.5,11' && !config('n4-bowling').grillesTarif, '[N] le vrai serveur l a ecrit dans le tarif de N4, sans grille', JSON.stringify(tarif));
  ok(tarif.tiers[1].prices[0] === 8, '[N] le prix que le collegue vient de poser reste', JSON.stringify(tarif));
  await page.waitForFunction(() => /1 partie[^·]*6,50\s*€/.test((document.querySelector('#staffPricingPage [data-tf-act="bowling"]') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
  const ligne2 = await texte(page, '#staffPricingPage [data-tf-act="bowling"]');
  ok(/1 partie[^·]*6,50\s*€/.test(ligne2), '[N] la ligne relit le nouveau prix', ligne2.slice(0, 220));
  ok(erreurs.length === 0, '[N] aucune erreur de page', erreurs.join(' | '));
  await fermer(page);
}

async function semer() {
  await remiseAZero();
  const r = await opsPost(TOKENS.libramont, { action: 'saveGrillesTarif', centerId: 'libramont', grilles: PRIX_POSES });
  if (r.status !== 200) throw new Error(`MONTAGE : le POST de depart est refuse (${r.status})`);
}

// ---------------------------------------------------------------------------
// [M] CHAQUE PREUVE MORD. Rejoue le gate avec une ligne de production cassee, en
// memoire, et exige que le controle vise rougisse.
// ---------------------------------------------------------------------------
function contrePreuves() {
  section('[M] Les contre-preuves');
  Object.entries(MUTATIONS).forEach(([nom, m]) => {
    const r = spawnSync(process.execPath, [__filename, `--mutation=${nom}`], { encoding: 'utf8', timeout: 240000, env: { ...process.env, PINLANE_GATE_CAPTURES: '' } });
    const sortie = `${r.stdout || ''}${r.stderr || ''}`;
    const rouge = sortie.split(/\r?\n/).some((l) => l.startsWith('FAIL') && l.includes(m.cible));
    ok(r.status === 1 && rouge, `[M] ${nom} rougit « ${m.cible} »`, `sortie ${r.status}${rouge ? '' : ' ; controle vise reste vert ou absent'} ; ${sortie.split(/\r?\n/).filter((l) => l.startsWith('FAIL') || l.startsWith('ERREUR')).slice(0, 3).join(' | ').slice(0, 300)}`);
  });
}

async function main() {
  const seule = MUTATION ? MUTATION.partie : '';
  if (!MUTATION || seule === 'S') await serveur();
  if (seule === 'S') { console.log(echecs.length ? '\nROUGE' : '\nVERT'); process.exit(echecs.length ? 1 : 0); }
  const { chromium } = require('playwright-core');
  const pages = await serveurDePages();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    if (!MUTATION || seule === 'E') { await remiseAZero(); await ecran(browser); }
    if (!MUTATION || seule === 'C') { await semer(); await comptoir(browser); await formulaireClient(browser); }
    if (!MUTATION || seule === 'N') { await remiseAZero(); await n4(browser); }
  } finally {
    await fermer(browser);
    pages.close();
  }
  if (!MUTATION && !echecs.length && process.argv.includes('--contre-preuves')) contrePreuves();
  console.log(echecs.length ? `\nROUGE : ${echecs.length} echec(s) sur ${controles}` : `\nVERT : ${controles} controles`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((e) => { console.error('ERREUR', e && e.stack ? e.stack : e); process.exit(1); });

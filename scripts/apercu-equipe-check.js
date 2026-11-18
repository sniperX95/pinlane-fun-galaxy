// L APERCU DE L EQUIPE ET LES ECRANS DE COUPURE QUI DISENT VRAI (2026-11-18).
//
// Pourquoi ce gate existe. Depuis le 13/11, la reservation en ligne de Libramont et de Gembloux est coupee par
// l interrupteur de la console (lib/ops-knowledge.js coupureEnLigne, scripts/coupure-en-ligne-check.js). Ansar, le
// 18/11 : « fais en sorte que je puisse revoir dans app.pinlane.be/reserver/libramont, et gembloux aussi, le
// formulaire, parce que je le vois plus du tout ; et l endroit ou les clients peuvent appuyer sur le bouton revenir
// au formulaire d avant est bugge parce que la ca dit que le formulaire est en ligne genre sur le site alors que pas
// du tout ». La regle du 14/11 reste entiere pour tout visiteur : aucun client ne voit le formulaire, ne reserve, ne
// recoit de mail.
//
// LES PROPRIETES. Les vrais gestionnaires sur une base simulee, la vraie lecture de la session (le cookie
// pinlane_staff_session, lib/staff-auth getStaffSessionFromToken puis sessionAuCentre), aucun appel sortant ; puis
// Edge sur les vrais fichiers, servis par ces gestionnaires.
//   [A] l apercu ne s ouvre qu a l equipe de CE centre, ou au fondateur, et seulement quand la page le demande. Un
//       visiteur, un membre d un autre centre, un centre qui n a rien publie : rien. L equipe y voit les heures.
//   [B] une reponse d apercu est privee (private, no-store, Vary Cookie). La reponse sans apercu garde ses en-tetes
//       de production (no-store, max-age=0 ; Vary Origin) et le meme corps, cookie de la console ou pas.
//   [C] rien ne passe en apercu : reservation, retenue des heures, demande sur mesure refusees par le serveur, session
//       ou pas, et rien ne s ecrit ni ne part. Dans le navigateur, aucun envoi, aucune statistique, et le formulaire
//       dit que c est un apercu.
//   [D] les ecrans de coupure disent vrai : la phrase nomme le site du centre et son telephone, deux liens ;
//       /reserver/libramont dit la meme phrase dans son cadre, sans « ne s est pas charge » ni lien qui pretend
//       reserver en ligne.
//   [E] l apercu dans le navigateur : le bandeau, le formulaire, les heures, jusqu au recapitulatif ; dans la page de
//       Libramont aussi ; pour le fondateur ; jamais pour un membre d un autre centre.
//   [F] sur le site d un autre domaine, rien ne change : le cadre n y demande pas l apercu, le cookie de la console n y
//       part pas, et la balise data-page="pinlane" n y fait rien.
//
// Les contre-preuves servent le code mute en memoire : aucun fichier n est ecrit.
// Lancement : node scripts/apercu-equipe-check.js [--contre-preuves] [--captures=<dossier>]
'use strict';
['DATABASE_URL', 'POSTGRES_URL', 'RESEND_API_KEY', 'RESEND_INBOUND_API_KEY', 'TELEGRAM_JETON', 'TELEGRAM_CHAT', 'TELEGRAM_GROUPE', 'TELEGRAM_SUJETS', 'ANTHROPIC_API_KEY', 'STAFF_AUTH_SECRET', 'PLATFORM_OWNER_CODE', 'VERCEL'].forEach((cle) => { delete process.env[cle]; });
// Le repli de developpement de lib/staff-auth (secret de signature local) : refuse en production.
process.env.ALLOW_INSECURE_STAFF_CODES = 'true';
process.env.PINLANE_CALENDAR_SYNC = 'off';
const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const Module = require('module');
const { Readable } = require('stream');
const { spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_APERCU_PORT || 4264);
const BASE_URL = `http://127.0.0.1:${PORT}`;
// Un autre site, au sens du navigateur : le cadre y est pose comme sur fungalaxy.be.
const TIERS = `http://fungalaxy.test:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CODE = 'reservation_en_ligne_coupee';
const COOKIE = 'pinlane_staff_session';
const CAPTURES = (process.argv.find((a) => a.startsWith('--captures=')) || '').slice('--captures='.length);

// ---------- les mutations (contre-preuves), appliquees en memoire ----------
const MUTATIONS = {
  'apercu-sans-session': { f: 'lib/apercu-equipe.js', de: '  return entre ? { bandeau: BANDEAU, envoi: ENVOI } : null;', vers: '  return { bandeau: BANDEAU, envoi: ENVOI };', lettre: 'A' },
  'apercu-a-tout-le-personnel': { f: 'lib/apercu-equipe.js', de: "  try { entre = await require('./staff-auth').sessionAuCentre(session, id); } catch (error) { entre = null; }", vers: '  entre = session;', lettre: 'A' },
  'apercu-sans-demande': { f: 'lib/apercu-equipe.js', de: '  if (!apercuDemande(req)) return null;\n', vers: '', lettre: 'A' },
  'apercu-centre-non-publie': { f: 'lib/apercu-equipe.js', de: "  if (require('./centre-publie').manqueAPublier(centre)) return null;\n", vers: '', lettre: 'A' },
  'apercu-sans-heures': { f: 'api/public-availability.js', de: '    if (coupure && !(await apercuDeLEquipe(req, res, centerDoc))) {', vers: '    if (coupure) {', lettre: 'A' },
  'apercu-en-cache-public': { f: 'lib/apercu-equipe.js', de: '  reponsePrivee(res);\n  const id', vers: '  const id', lettre: 'B' },
  'cache-repose-apres': { f: 'lib/apercu-equipe.js', de: "    return poser(nom, cle === 'cache-control' ? CACHE_PRIVE : cle === 'vary' ? VARY_PRIVE : valeur);", vers: '    return poser(nom, valeur);', lettre: 'B' },
  'reservation-en-apercu': { f: 'lib/demande-publique.js', de: '  const coupure = coupureEnLigne(requestedCenterId);\n', vers: "  const coupure = '';\n", lettre: 'C' },
  'demande-sur-mesure-en-apercu': { f: 'api/public-booking-meta.js', de: '  const coupure = coupureEnLigne(centerId);\n  if (coupure) {\n    sendError(', vers: "  const coupure = '';\n  if (coupure) {\n    sendError(", lettre: 'C' },
  'confirmation-envoyee-en-apercu': { f: 'assets/fungalaxy-booking.js', de: "    if (APERCU) { erreurEnvoi('<b>' + esc(APERCU.envoi || '') + '</b>'); return; }\n", vers: '', lettre: 'C' },
  'heures-retenues-en-apercu': { f: 'assets/fungalaxy-booking.js', de: '    if (APERCU) { versLeContact(); return; }\n', vers: '', lettre: 'C' },
  'sur-mesure-envoyee-en-apercu': { f: 'assets/fungalaxy-sur-mesure.js', de: "      if (apercu) { smErreur('<b>' + esc(apercu.envoi || '') + '</b>'); return; }\n", vers: '', lettre: 'C' },
  'statistiques-en-apercu': { f: 'assets/fungalaxy-booking.js', de: "        VISITE = '';\n", vers: '', lettre: 'C' },
  'phrase-floue': { f: 'lib/ops-knowledge.js', de: "  const ou = site ? `Réservez sur ${site}${tel ? ` ou appelez le ${tel}` : ''}.` : tel ? `Appelez le ${tel} pour réserver.` : '';", vers: "  const ou = `Réservez par le formulaire du site du centre${tel ? `, ou appelez le ${tel}` : ''}.`;", lettre: 'D' },
  'coupure-sans-liens': { f: 'assets/fungalaxy-booking.js', de: '    lierLaCoupure(p, texte);\n', vers: '', lettre: 'D' },
  'page-libramont-sans-cadre': { f: 'embed.js', de: '  if (pageDePinlane) { monterPinlane(); return; }\n', vers: '', lettre: 'D' },
  'page-libramont-retire-le-cadre': { f: 'embed.js', de: '    if (pageDePinlane) return;\n', vers: '', lettre: 'D' },
  'balise-page-oubliee': { f: 'fungalaxy-site.html', de: ' data-page="pinlane"', vers: '', lettre: 'D' },
  'apercu-jamais-demande': { f: 'assets/fungalaxy-booking.js', de: '        return j.coupure ? demanderApercu(q, j) : j;\n', vers: '        return j;\n', lettre: 'E' },
  'bandeau-absent': { f: 'assets/fungalaxy-booking.js', de: '        if (APERCU) montrerApercu();\n', vers: '', lettre: 'E' },
  'lecture-sans-session': { f: 'assets/fungalaxy-booking.js', de: "credentials: apercu ? 'same-origin' : 'omit'", vers: "credentials: 'omit'", lettre: 'E' },
  'cadre-tiers-demande-apercu': { f: 'assets/fungalaxy-booking.js', de: '    if (!surUnePageDePinlane()) return coupe;\n', vers: '', lettre: 'F' },
  'balise-honoree-ailleurs': { f: 'embed.js', de: "script.getAttribute('data-page') === 'pinlane' && window.location.origin === origin;", vers: "script.getAttribute('data-page') === 'pinlane';", lettre: 'F' },
};
const MUTATION = (process.argv.find((a) => a.startsWith('--mutation=')) || '').slice('--mutation='.length);
if (MUTATION && !MUTATIONS[MUTATION]) { console.error(`mutation inconnue : ${MUTATION}`); process.exit(2); }
// Une contre-preuve ne joue que la lettre qu elle doit faire rougir.
const LETTRES = MUTATION ? [MUTATIONS[MUTATION].lettre] : null;
const joue = (...l) => !LETTRES || l.some((x) => LETTRES.includes(x));

const brut = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n');
function lf(f) {
  let t = brut(f);
  const m = MUTATION ? MUTATIONS[MUTATION] : null;
  if (m && m.f === f) {
    if (t.split(m.de).length !== 2) throw new Error(`ANCRE DE MUTATION absente ou multiple (${MUTATION}) dans ${f}`);
    t = t.split(m.de).join(m.vers);
  }
  return t;
}
// Le code du serveur se charge mute lui aussi, sans toucher au disque.
const compiler = Module.prototype._compile;
Module.prototype._compile = function compilerMute(contenu, fichier) {
  const m = MUTATION ? MUTATIONS[MUTATION] : null;
  if (m && path.resolve(fichier) === path.join(ROOT, m.f)) {
    const t = String(contenu).split('\r\n').join('\n');
    if (t.split(m.de).length !== 2) throw new Error(`ANCRE DE MUTATION absente ou multiple (${MUTATION}) dans ${m.f}`);
    return compiler.call(this, t.split(m.de).join(m.vers), fichier);
  }
  return compiler.call(this, contenu, fichier);
};

let rouges = 0;
let lettre = '';
function section(titre) { lettre = (titre.match(/^\[([A-Z])\]/) || [])[1] || ''; console.log(`\n${titre}`); }
function ok(condition, quoi, detail) {
  if (condition) { console.log(`ok    ${quoi}`); return; }
  rouges += 1;
  console.log(`ROUGE [${lettre}] ${quoi}${detail !== undefined ? ` : ${String(detail).slice(0, 300)}` : ''}`);
}

// ---------- les contre-preuves ----------
if (process.argv.includes('--contre-preuves')) {
  const env = { ...process.env, PINLANE_APERCU_PORT: String(PORT + 4) };
  // Une contre-preuve ne vaut que si le gate est vert sans elle.
  const temoin = spawnSync(process.execPath, [__filename], { cwd: ROOT, encoding: 'utf8', env, timeout: 300000 });
  if (temoin.status !== 0) {
    console.log(`${temoin.stdout || ''}${temoin.stderr || ''}`.split('\n').filter((l) => /ROUGE|Error/.test(l)).join('\n'));
    console.log('\napercu-equipe-check --contre-preuves: le gate est rouge sans mutation, aucune contre-preuve ne compte');
    process.exit(1);
  }
  let rates = 0;
  for (const [nom, m] of Object.entries(MUTATIONS)) {
    const r = spawnSync(process.execPath, [__filename, `--mutation=${nom}`], { cwd: ROOT, encoding: 'utf8', env, timeout: 300000 });
    const sortie = `${r.stdout || ''}${r.stderr || ''}`;
    const mord = r.status === 1 && sortie.includes(`ROUGE [${m.lettre}]`) && !/ANCRE DE MUTATION/.test(sortie);
    if (!mord) rates += 1;
    console.log(`${mord ? 'TUEE ' : 'VIVANTE'} ${nom} (attendu : ROUGE [${m.lettre}], sortie ${r.status})${mord ? '' : `\n${sortie.split('\n').filter((l) => /ROUGE|ANCRE|Error/.test(l)).slice(0, 6).join('\n')}`}`);
  }
  console.log(rates ? `\napercu-equipe-check --contre-preuves: ${rates} mutation(s) vivante(s)` : `\napercu-equipe-check --contre-preuves: ALL OK - chaque regle retiree fait rougir sa lettre (${Object.keys(MUTATIONS).length})`);
  process.exit(rates ? 1 : 0);
}

// ---------- aucun appel sortant ----------
const SORTANTS = [];
global.fetch = async (url) => { SORTANTS.push(String(url).slice(0, 80)); throw new Error('aucun appel sortant dans ce gate'); };

// ---------- la base simulee ----------
// Les deux centres coupes depuis la console (centers.settings.config.embed), comme en production le 18/11, et un
// centre ne dans la console qui n a rien publie, coupe lui aussi.
let LIGNES = [];
let version = 0;
const ECRITURES = [];
const CENTRES_FICHIER = require(path.join(ROOT, 'ops-knowledge/centers.json')).centers;
const nomDuFichier = (id) => (CENTRES_FICHIER.find((c) => c.id === id) || {}).name || id;
function poserCentres({ libramont = false, gembloux = false } = {}) {
  const ligne = (id, coupe) => ({ id, name: nomDuFichier(id), status: 'active', timezone: 'Europe/Brussels', settings: { config: { embed: { actif: !coupe, bascule: '2026-11-13T05:40:00.000Z', basculePar: 'Ansar' } } } });
  LIGNES = [ligne('libramont', libramont), ligne('gembloux', gembloux), { ...ligne('gate-nu', true), name: 'Gate Nu' }];
  version += 1;
}

// Les sessions de la console : la ligne que la base rend pour le jeton du cookie (staff_sessions, staff_members,
// staff_roles). Le reste, le vrai code le fait.
const DEMAIN_SOIR = new Date(Date.now() + 12 * 3600 * 1000).toISOString();
const ligneSession = (centre, membre, role, permissions, verrou = false) => ({
  center_id: centre, expires_at: DEMAIN_SOIR, member_id: `${centre}:${membre}`, member_name: membre, contact: '', member_status: 'active',
  role_id: role, role_name: role, role_code: role.toUpperCase(), permissions, locked: verrou,
});
const SESSIONS = {
  'jeton-libramont': ligneSession('libramont', 'accueil', 'accueil', ['reservations.view']),
  'jeton-gembloux': ligneSession('gembloux', 'accueil', 'accueil', ['reservations.view']),
  'jeton-fondateur': ligneSession('libramont', 'platform-owner', 'platform-owner', ['direction.view', 'centers.switch', 'platform.admin'], true),
  'jeton-nu': ligneSession('gate-nu', 'direction', 'direction', [], true),
};

function purger() {
  for (const cle of Object.keys(require.cache)) {
    if (cle.startsWith(ROOT) && !cle.includes(`${path.sep}node_modules${path.sep}`)) delete require.cache[cle];
  }
}
function monter() {
  purger();
  const database = require(path.join(ROOT, 'lib/database'));
  const { SQL_EMPREINTES } = require(path.join(ROOT, 'lib/cache-empreintes'));
  let empreinte = null;
  const requete = async (sql, params = []) => {
    const s = String((sql && sql.text) || sql);
    const ecriture = /^\s*(insert|update|delete|with\b[\s\S]*\b(insert|update|delete)\b)/i.test(s);
    // Les lignes de la console (staff_*) ne sont ni une reservation ni un mail.
    if (ecriture && !/staff_/.test(s)) ECRITURES.push(s.replace(/\s+/g, ' ').slice(0, 70));
    if (s === SQL_EMPREINTES) return { rows: [{ centres: `v${version}` }], rowCount: 1 };
    if (/from centers/.test(s)) return { rows: LIGNES, rowCount: LIGNES.length };
    // Le schema des sessions est deja en place (les comptes proprietaires de la plateforme, avec leur code).
    if (/select id, access_code_hash from staff_members where id = any/.test(s)) {
      const code = empreinte(require(path.join(ROOT, 'lib/staff-auth')).__test.getPlatformOwnerCode());
      const rows = (params[0] || []).map((id) => ({ id, access_code_hash: code }));
      return { rows, rowCount: rows.length };
    }
    if (/from staff_sessions s\b/.test(s)) {
      const jeton = Object.keys(SESSIONS).find((j) => empreinte(j) === params[0]);
      return jeton ? { rows: [{ token_hash: params[0], ...SESSIONS[jeton] }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 0 };
  };
  database.getPool = () => ({ query: requete, connect: async () => ({ query: requete, release() {} }), on() {}, end: async () => {} });
  // Une journee vide : les heures se calculent sur la configuration du centre, sans reservation.
  database.readAvailabilitySnapshot = async (date, centerId) => ({ reservations: [], laneStatuses: {}, blocks: [], date, centerId });
  for (const nom of ['createReservation', 'createCommunication', 'createCustomRequest']) {
    if (typeof database[nom] === 'function') database[nom] = async () => { ECRITURES.push(nom); throw new Error(`${nom} interdit dans ce gate`); };
  }
  require(path.join(ROOT, 'lib/rate-limit')).enforceRateLimit = () => false;
  require(path.join(ROOT, 'lib/secours-envoi')).transmettreEnPanne = async () => { SORTANTS.push('boite de secours'); return false; };
  const staffAuth = require(path.join(ROOT, 'lib/staff-auth'));
  // Le hachage des jetons de session de lib/staff-auth (hashSecret), avec son secret de developpement.
  empreinte = (valeur) => crypto.createHash('sha256').update(`${staffAuth.__test.getAuthSecret()}:${String(valeur || '').trim()}`).digest('hex');
  let apercuLib = null;
  try { apercuLib = require(path.join(ROOT, 'lib/apercu-equipe')); } catch (error) { apercuLib = null; }
  return {
    ops: require(path.join(ROOT, 'lib/ops-knowledge')),
    reservations: require(path.join(ROOT, 'api/public-reservations')),
    meta: require(path.join(ROOT, 'api/public-booking-meta')),
    heures: require(path.join(ROOT, 'api/public-availability')),
    textes: apercuLib || { BANDEAU: '', ENVOI: '' },
    database,
  };
}

async function appeler(handler, { method = 'GET', url, body = null, jeton = '' }) {
  const corps = body ? JSON.stringify(body) : '';
  const req = Readable.from(corps ? [Buffer.from(corps)] : []);
  const headers = { host: 'app.pinlane.test', 'content-type': 'application/json' };
  if (jeton) headers.cookie = `_ga=GA1.1.1; ${COOKIE}=${encodeURIComponent(jeton)}`;
  Object.assign(req, { method, url, headers, socket: { remoteAddress: '203.0.113.7' }, connection: { remoteAddress: '203.0.113.7' } });
  const res = {
    statusCode: 200, headers: {}, headersSent: false, req,
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
    getHeader(k) { return this.headers[String(k).toLowerCase()]; },
    removeHeader(k) { delete this.headers[String(k).toLowerCase()]; },
    writeHead(s, h) { this.statusCode = s; if (h) Object.entries(h).forEach(([k, v]) => this.setHeader(k, v)); return this; },
    write(b) { this.corps = (this.corps || '') + String(b || ''); return true; },
    end(b) { if (b) this.corps = (this.corps || '') + String(b); this.headersSent = true; },
  };
  await handler(req, res);
  let json = null;
  try { json = JSON.parse(res.corps || ''); } catch (error) { json = null; }
  return { statut: res.statusCode, json, corps: String(res.corps || ''), entetes: res.headers };
}

function jourOuvert(m, centre) {
  return require(path.join(ROOT, 'scripts/jour-de-test')).jourDeTest({ jour: 6, centre });
}
function demandeDe(centre, date) {
  return {
    centerId: centre, date, startTime: '15:00', pax: 4, type: 'bowling', duration: 1,
    name: 'Essai du gate', email: 'essai@exemple.invalid', phone: '0400000000',
    program: [{ activityId: 'bowling', participants: 4, minutes: 60 }],
  };
}

// ============================================================================================================
// LE SERVEUR
// ============================================================================================================
async function serveur(m) {
  poserCentres({ libramont: true, gembloux: true });
  await m.ops.refreshCenterOverrides(m.database.getPool());
  const { BANDEAU, ENVOI } = m.textes;
  const telDe = (id) => ((CENTRES_FICHIER.find((c) => c.id === id) || {}).publicInfo || {}).phone || '';
  const cat = (centre, { jeton = '', apercu = true } = {}) => appeler(m.meta, { url: `/api/public-booking-meta?centerId=${centre}&calendar=45${apercu ? '&apercu=1' : ''}`, jeton });
  const samediL = jourOuvert(m, 'libramont');
  const heures = (centre, { jeton = '', apercu = true } = {}) => appeler(m.heures, { url: `/api/public-availability?centerId=${centre}&date=${samediL}&pax=4&type=bowling&duration=1${apercu ? '&apercu=1' : ''}`, jeton });
  const aApercu = (r) => Boolean(r.json && r.json.ok !== false && r.json.apercu && !('coupure' in r.json));
  const estCoupe = (r) => Boolean(r.json && /ne se prennent pas ici/.test(String(r.json.coupure || '')) && !('apercu' in r.json));

  const visiteur = await cat('libramont');
  const equipeL = await cat('libramont', { jeton: 'jeton-libramont' });
  const fondateurG = await cat('gembloux', { jeton: 'jeton-fondateur' });
  const gemblouxChezL = await cat('libramont', { jeton: 'jeton-gembloux' });
  const equipeSansDemande = await cat('libramont', { jeton: 'jeton-libramont', apercu: false });
  const visiteurSansDemande = await cat('libramont', { apercu: false });
  const inconnu = await cat('libramont', { jeton: 'jeton-qui-n-existe-pas' });
  const nu = await cat('gate-nu', { jeton: 'jeton-nu' });
  const heuresEquipe = await heures('libramont', { jeton: 'jeton-libramont' });
  const heuresVisiteur = await heures('libramont');
  const heuresSansDemande = await heures('libramont', { jeton: 'jeton-libramont', apercu: false });
  const heuresAutreCentre = await heures('libramont', { jeton: 'jeton-gembloux' });

  if (joue('A')) {
    section('[A] L APERCU NE S OUVRE QU A L EQUIPE DE CE CENTRE, ET SEULEMENT QUAND LA PAGE LE DEMANDE');
    ok(BANDEAU && ENVOI, 'MONTAGE : les textes de l apercu existent (lib/apercu-equipe.js)');
    ok(estCoupe(visiteur), 'un visiteur qui demande l apercu recoit la coupure, rien d autre', visiteur.corps.slice(0, 200));
    ok(aApercu(equipeL) && equipeL.json.apercu.bandeau === BANDEAU && equipeL.json.apercu.envoi === ENVOI, 'l equipe de Libramont, connectee a la console (cookie), recoit l apercu de Libramont, sans la coupure', equipeL.corps.slice(0, 200));
    ok(aApercu(equipeL) && Array.isArray(equipeL.json.formules) && equipeL.json.formules.length > 0 && Array.isArray(equipeL.json.activities) && equipeL.json.activities.length > 0 && equipeL.json.center && equipeL.json.center.id === 'libramont', 'l apercu porte le vrai catalogue du centre : formules, activites, centre', JSON.stringify({ formules: (equipeL.json || {}).formules && equipeL.json.formules.length, activites: (equipeL.json || {}).activities && equipeL.json.activities.length }));
    ok(aApercu(fondateurG), 'le fondateur (platform.admin) recoit l apercu de Gembloux', fondateurG.corps.slice(0, 200));
    ok(estCoupe(gemblouxChezL), 'un membre de l equipe de Gembloux ne recoit pas l apercu de Libramont', gemblouxChezL.corps.slice(0, 200));
    ok(estCoupe(inconnu), 'une session inconnue ou expiree vaut un visiteur', inconnu.corps.slice(0, 200));
    ok(estCoupe(equipeSansDemande), 'sans la demande (apercu=1), l equipe connectee lit la coupure comme un visiteur', equipeSansDemande.corps.slice(0, 200));
    ok(Boolean(nu.json) && !('apercu' in nu.json) && Boolean(nu.json.coupure), 'un centre qui n a rien publie n a pas d apercu, meme pour sa direction : il montrerait les heures et les prix d un autre', nu.corps.slice(0, 200));
    const slots = (r) => (r.json && Array.isArray(r.json.slots) ? r.json.slots : null);
    ok(slots(heuresEquipe) && slots(heuresEquipe).length > 0 && heuresEquipe.json.code !== CODE, `l equipe voit les heures du ${samediL} en apercu`, heuresEquipe.corps.slice(0, 200));
    ok(slots(heuresVisiteur) && slots(heuresVisiteur).length === 0 && heuresVisiteur.json.code === CODE, 'un visiteur qui demande l apercu ne voit aucune heure, avec la phrase', heuresVisiteur.corps.slice(0, 200));
    ok(slots(heuresSansDemande) && slots(heuresSansDemande).length === 0 && heuresSansDemande.json.code === CODE && slots(heuresAutreCentre) && slots(heuresAutreCentre).length === 0 && heuresAutreCentre.json.code === CODE, 'sans la demande, ou pour un membre d un autre centre : aucune heure', `${heuresSansDemande.corps.slice(0, 100)} | ${heuresAutreCentre.corps.slice(0, 100)}`);
    // Ouvert, il n y a rien a apercevoir : la reponse est celle de tout le monde.
    poserCentres({ libramont: true, gembloux: false });
    await m.ops.refreshCenterOverrides(m.database.getPool());
    const ouvert = await cat('gembloux', { jeton: 'jeton-gembloux' });
    ok(Boolean(ouvert.json) && ouvert.json.ok !== false && !('apercu' in ouvert.json) && !('coupure' in ouvert.json), 'centre ouvert : ni apercu ni coupure, le catalogue de tout le monde', ouvert.corps.slice(0, 200));
    poserCentres({ libramont: true, gembloux: true });
    await m.ops.refreshCenterOverrides(m.database.getPool());
  }

  if (joue('B')) {
    section('[B] UNE REPONSE D APERCU N EST JAMAIS PUBLIQUE ; LA REPONSE SANS APERCU EST CELLE D AVANT');
    const prive = (r) => /\bprivate\b/.test(String(r.entetes['cache-control'] || '')) && /\bno-store\b/.test(String(r.entetes['cache-control'] || '')) && !/\bpublic\b|s-maxage/.test(String(r.entetes['cache-control'] || '')) && /\bCookie\b/.test(String(r.entetes.vary || ''));
    ok(aApercu(equipeL) && prive(equipeL), 'le catalogue d apercu : private, no-store, et Vary Cookie (aucun cache partage ne le garde)', JSON.stringify(equipeL.entetes));
    ok(slots0(heuresEquipe) && prive(heuresEquipe), 'les heures d apercu : private, no-store, et Vary Cookie', JSON.stringify(heuresEquipe.entetes));
    ok(prive(visiteur) && prive(heuresVisiteur), 'une demande d apercu refusee repond privee elle aussi', `${JSON.stringify(visiteur.entetes)} | ${JSON.stringify(heuresVisiteur.entetes)}`);
    // Les en-tetes lus en production le 18/11 sur ?centerId=libramont : no-store, max-age=0 ; Vary: Origin.
    const production = (r) => r.entetes['cache-control'] === 'no-store, max-age=0' && r.entetes.vary === 'Origin';
    ok(production(visiteurSansDemande) && production(equipeSansDemande), 'sans apercu demande, les en-tetes de production restent (no-store, max-age=0 ; Vary Origin), cookie ou pas', `${JSON.stringify(visiteurSansDemande.entetes)} | ${JSON.stringify(equipeSansDemande.entetes)}`);
    ok(visiteurSansDemande.statut === 200 && visiteurSansDemande.corps === equipeSansDemande.corps, 'sans apercu demande, le corps est le meme au caractere pres avec ou sans le cookie de la console', `${visiteurSansDemande.corps.length} / ${equipeSansDemande.corps.length}`);
    ok(production(heuresSansDemande), 'les heures sans apercu demande gardent leurs en-tetes de production', JSON.stringify(heuresSansDemande.entetes));
  }

  if (joue('C')) {
    section('[C] RIEN NE SE RESERVE, NE SE RETIENT NI NE SE DEMANDE EN APERCU (le serveur)');
    const samedi = jourOuvert(m, 'libramont');
    const avant = { ecritures: ECRITURES.length, sortants: SORTANTS.length };
    const refus = [];
    for (const jeton of ['', 'jeton-libramont', 'jeton-fondateur']) {
      for (const url of ['/api/public-reservations', '/api/public-reservations?action=hold', '/api/public-reservations?apercu=1', '/api/public-reservations?action=hold&apercu=1']) {
        refus.push({ jeton, url, r: await appeler(m.reservations, { method: 'POST', url, body: demandeDe('libramont', samedi), jeton }) });
      }
      refus.push({ jeton, url: '/api/custom-request', r: await appeler(m.meta, { method: 'POST', url: '/api/custom-request?apercu=1', jeton, body: { kind: 'custom-request', centerId: 'libramont', contactName: 'Essai du gate', email: 'essai@exemple.invalid', phone: '0400000000', pax: 40, message: 'Un groupe de quarante.', requestedDate: samedi } }) });
    }
    const passes = refus.filter((x) => !(x.r.statut === 422 && x.r.json && x.r.json.code === CODE));
    ok(passes.length === 0, `reservation, retenue des heures et demande sur mesure refusees (422, ${CODE}) : visiteur, equipe du centre, fondateur, avec ou sans apercu (${refus.length} essais)`, JSON.stringify(passes.map((x) => ({ jeton: x.jeton, url: x.url, statut: x.r.statut, corps: x.r.corps.slice(0, 80) }))));
    ok(ECRITURES.length === avant.ecritures, 'rien ne s ecrit : ni reservation, ni retenue, ni demande, ni mail en file', JSON.stringify(ECRITURES.slice(avant.ecritures)));
    ok(SORTANTS.length === avant.sortants, 'rien ne part : aucun mail, aucune alerte', JSON.stringify(SORTANTS.slice(avant.sortants)));
    const refusDeLaReservation = refus.find((x) => x.url === '/api/public-reservations' && x.jeton === 'jeton-libramont');
    ok(Boolean(refusDeLaReservation) && refusDeLaReservation.r.json && refusDeLaReservation.r.json.message === m.ops.coupureEnLigne('libramont') && !/[<>]/.test(refusDeLaReservation.r.json.message), 'le refus du serveur dit la phrase de coupure, en texte, sans HTML', refusDeLaReservation && refusDeLaReservation.r.corps.slice(0, 200));
  }

  if (joue('D')) {
    section('[D] LA PHRASE DE COUPURE NOMME LE SITE DU CENTRE ET SON TELEPHONE (le serveur)');
    const ecriture = require(path.join(ROOT, 'lib/client-writing'));
    for (const id of ['gembloux', 'libramont']) {
      const phrase = m.ops.coupureEnLigne(id);
      const attendue = `Les réservations en ligne de ${nomDuFichier(id)} ne se prennent pas ici pour le moment. Réservez sur fungalaxy.be ou appelez le ${telDe(id)}.`;
      ok(phrase === attendue, `${id} : « ${attendue} »`, phrase);
      ok(!/formulaire du site|<|>|[\u2013\u2014]/.test(phrase) && ecriture.verifierEcritureClient(phrase, { etat: 'sans-promesse' }).length === 0, `${id} : une phrase en texte, sans « formulaire du site », sans tiret long, conforme a lib/client-writing`, JSON.stringify(ecriture.verifierEcritureClient(phrase, { etat: 'sans-promesse' })));
    }
    // Sans site, le telephone seul ; ni l un ni l autre, la premiere phrase seule.
    const fiche = (plus) => ({ id: 'gate-coupe', name: 'Salle Essai', status: 'active', timezone: 'Europe/Brussels', config: { embed: { actif: false }, ...plus } });
    m.ops.applyCenterRecords([fiche({ publicInfo: { phone: '081/00.00.00' } })]);
    const sansSite = m.ops.coupureEnLigne('gate-coupe');
    m.ops.applyCenterRecords([fiche({})]);
    const sansRien = m.ops.coupureEnLigne('gate-coupe');
    m.ops.applyCenterRecords([fiche({ identity: { siteUrl: 'https://www.salle-essai.example/reserver' } })]);
    const sitePlein = m.ops.coupureEnLigne('gate-coupe');
    ok(sansRien === 'Les réservations en ligne de Salle Essai ne se prennent pas ici pour le moment.', 'sans site ni telephone : la premiere phrase seule, aucun renvoi invente', sansRien);
    ok(/^Les réservations en ligne de Salle Essai ne se prennent pas ici pour le moment\. (Appelez le 081\/00\.00\.00 pour réserver\.)?$/.test(sansSite) && !/site/.test(sansSite), 'sans site : jamais « le site », le telephone seul quand la fiche en a un', sansSite);
    ok(/Réservez sur salle-essai\.example\.$/.test(sitePlein), 'le site se dit par son adresse, sans www ni chemin', sitePlein);
    poserCentres({ libramont: true, gembloux: true });
    await m.ops.refreshCenterOverrides(m.database.getPool());
  }
}
function slots0(r) { return Boolean(r.json && Array.isArray(r.json.slots) && r.json.slots.length > 0); }

// ============================================================================================================
// LE NAVIGATEUR
// ============================================================================================================
const MIME = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8', '.ico': 'image/x-icon' };
const NAV = { m: null, requetes: [], etat: '', tiers: '' };
function pageTiers(avecBalise) {
  // Le theme de Fun Galaxy et la ligne posee dans WordPress (docs/embed-wordpress.md), sur un autre domaine.
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Contact</title></head><body style="background:#000;color:#fff">
    <section id="booking"><div class="container">
      <div id="ancien"><form><label>Ancien formulaire du site</label><input name="nom"></form></div>
    </div></section>
    <script src="${BASE_URL}/embed.js" data-center="libramont" data-design="fungalaxy" data-target="#booking .container" data-fallback="#ancien"${avecBalise ? ' data-page="pinlane"' : ''}></script>
  </body></html>`;
}
async function corpsDe(req) {
  const morceaux = [];
  for await (const m of req) morceaux.push(Buffer.from(m));
  return Buffer.concat(morceaux).toString('utf8');
}
function serveurNavigateur() {
  const srv = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, BASE_URL);
      const p = url.pathname;
      if (p.startsWith('/api/')) {
        const corps = req.method === 'POST' ? await corpsDe(req) : '';
        let kind = '';
        try { kind = String((JSON.parse(corps || '{}') || {}).kind || ''); } catch (error) { kind = ''; }
        NAV.requetes.push({ chemin: p, methode: req.method, apercu: url.searchParams.get('apercu') === '1', cookie: new RegExp(`${COOKIE}=`).test(String(req.headers.cookie || '')), kind, etat: url.searchParams.get('embedState') === '1' });
        if (p === '/api/public-booking-meta' && req.method === 'GET' && url.searchParams.get('embedState') === '1' && NAV.etat) {
          // Lue depuis l autre site : la reponse le permet, comme celle de production (lib/http.js setCors).
          res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': String(req.headers.origin || '*') });
          res.end(JSON.stringify({ ok: true, center: url.searchParams.get('center'), actif: NAV.etat === 'actif' }));
          return;
        }
        const routes = { '/api/public-booking-meta': [NAV.m.meta], '/api/custom-request': [NAV.m.meta], '/api/public-reservations': [NAV.m.reservations], '/api/public-holds': [NAV.m.reservations, '/api/public-reservations?action=hold'], '/api/public-availability': [NAV.m.heures] };
        const route = routes[p];
        if (!route) { res.writeHead(404, { 'Content-Type': MIME['.json'] }); res.end('{"ok":false}'); return; }
        const r2 = Readable.from(corps ? [Buffer.from(corps)] : []);
        Object.assign(r2, { method: req.method, url: route[1] || (p + url.search), headers: req.headers, socket: req.socket, connection: req.socket });
        await route[0](r2, res);
        return;
      }
      // Le chargement du formulaire lui-meme compte aussi : [F] le veut absent, ou sans cookie.
      if (/^\/(reserver|fungalaxy)\//.test(p)) NAV.requetes.push({ chemin: p, methode: 'PAGE', apercu: false, cookie: new RegExp(`${COOKIE}=`).test(String(req.headers.cookie || '')), kind: '', etat: false });
      let rel = '';
      if (p === '/site-tiers') { res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' }); res.end(pageTiers(NAV.tiers === 'balise')); return; }
      if (/^\/reserver\/libramont\/?$/.test(p)) rel = 'fungalaxy-site.html';
      else if (/^\/(reserver|fungalaxy)(\/[a-z0-9-]+)?\/?$/.test(p)) rel = 'fungalaxy.html';
      else rel = decodeURIComponent(p).replace(/^\/+/, '');
      const fichier = path.join(ROOT, rel);
      if (!fichier.startsWith(ROOT) || !fs.existsSync(fichier) || !fs.statSync(fichier).isFile()) { res.writeHead(404); res.end(''); return; }
      const ext = path.extname(fichier).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(['.js', '.css', '.html'].includes(ext) ? lf(rel.split(path.sep).join('/')) : fs.readFileSync(fichier));
    } catch (error) {
      if (!res.headersSent) res.writeHead(500);
      res.end(String((error && error.message) || error).slice(0, 200));
    }
  });
  return new Promise((resolve, reject) => { srv.once('error', reject); srv.listen(PORT, '127.0.0.1', () => resolve(srv)); });
}

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
async function attendre(page, fn, ms, arg) {
  try { await page.waitForFunction(fn, arg, { timeout: ms, polling: 100 }); return true; } catch (error) {
    return Boolean(await page.evaluate(fn, arg).catch(() => false));
  }
}
async function allerAuMois(page, date) {
  const [y, mo] = date.split('-').map(Number);
  const cible = `${MOIS[mo - 1][0].toUpperCase()}${MOIS[mo - 1].slice(1)} ${y}`;
  for (let k = 0; k < 16; k += 1) {
    const titre = await page.evaluate(() => document.querySelector('#calTitle').textContent.trim());
    if (titre === cible) break;
    const [nom, an] = titre.split(' ');
    const courant = Number(an) * 12 + MOIS.indexOf(nom.toLowerCase());
    await page.click(y * 12 + (mo - 1) > courant ? '#calNext' : '#calPrev');
    await attendre(page, (t) => document.querySelector('#calTitle').textContent.trim() !== t, 3000, titre);
  }
  return attendre(page, (d) => { const b = document.querySelector(`#calGrid .fg-cal__day[data-date="${d}"]`); return b && !b.classList.contains('is-loading'); }, 8000, date);
}
async function capturer(page, nom) {
  if (!CAPTURES) return;
  fs.mkdirSync(CAPTURES, { recursive: true });
  await page.screenshot({ path: path.join(CAPTURES, `${nom}.png`), fullPage: false }).catch((e) => console.log(`capture ${nom} ratee : ${e.message}`));
  console.log(`capture : ${path.join(CAPTURES, `${nom}.png`)}`);
}
// Ce que montre le formulaire, dans la page ou dans son cadre.
const LIRE_FORMULAIRE = () => {
  const vu = (el) => Boolean(el) && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
  const coupe = document.querySelector('.fg-coupe');
  const apercu = document.querySelector('.fg-apercu');
  const autres = [...document.body.children].filter((el) => el !== coupe && el.tagName !== 'SCRIPT' && vu(el));
  return {
    pret: document.body.classList.contains('is-ready'),
    coupe: document.body.classList.contains('is-coupe'),
    phrase: coupe && vu(coupe) ? coupe.textContent.trim() : '',
    liens: coupe ? [...coupe.querySelectorAll('a')].map((a) => ({ href: a.getAttribute('href'), texte: a.textContent.trim(), cible: a.getAttribute('target') || '' })) : [],
    autresVisibles: document.body.classList.contains('is-coupe') ? autres.map((el) => el.tagName + (el.id ? `#${el.id}` : '')).slice(0, 5) : [],
    bandeau: apercu && vu(apercu) ? apercu.textContent.trim() : '',
    formulaire: vu(document.querySelector('#dayBtn')),
    deborde: document.documentElement.scrollHeight - innerHeight,
  };
};

async function navigateur(m) {
  const { chromium } = require('playwright-core');
  NAV.m = m;
  const srv = await serveurNavigateur();
  const nav = await chromium.launch({ executablePath: BROWSER_PATH, headless: true, args: [`--host-resolver-rules=MAP fungalaxy.test 127.0.0.1`] });
  const { BANDEAU, ENVOI } = m.textes;
  const contexte = async (jeton) => {
    const ctx = await nav.newContext({ viewport: { width: 1280, height: 900 } });
    // Rien ne sort du banc (polices, mesures) : seuls les deux sites du gate repondent.
    await ctx.route((u) => !/^(127\.0\.0\.1|fungalaxy\.test)$/.test(u.hostname), (r) => r.abort());
    if (jeton) await ctx.addCookies([{ name: COOKIE, value: jeton, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' }]);
    return ctx;
  };
  const preparer = (etat = '', tiers = '') => { NAV.requetes = []; NAV.etat = etat; NAV.tiers = tiers; };
  const envois = () => NAV.requetes.filter((r) => r.methode === 'POST' && !(r.chemin === '/api/public-booking-meta' && r.kind === 'erreur-formulaire'));
  const telG = ((CENTRES_FICHIER.find((c) => c.id === 'gembloux') || {}).publicInfo || {}).phone || '';
  const telL = ((CENTRES_FICHIER.find((c) => c.id === 'libramont') || {}).publicInfo || {}).phone || '';
  const lienSite = (f) => f.liens.some((l) => l.href === 'https://fungalaxy.be/' && l.texte === 'fungalaxy.be' && l.cible === '_top');
  const lienTel = (f, tel) => f.liens.some((l) => l.href === `tel:${tel.replace(/[^\d+]/g, '')}` && l.texte === tel);
  const cadreDe = async (page, motif) => {
    for (let k = 0; k < 100; k += 1) { const f = page.frames().find((x) => motif.test(x.url())); if (f) return f; await page.waitForTimeout(100); }
    return null;
  };
  try {
    if (joue('D')) {
      section('[D] LES ECRANS DE COUPURE DISENT VRAI (le navigateur)');
      const ctx = await contexte('');
      const page = await ctx.newPage();
      preparer();
      await page.goto(`${BASE_URL}/reserver/gembloux`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await attendre(page, () => document.body.classList.contains('is-coupe'), 15000);
      const g = await page.evaluate(LIRE_FORMULAIRE);
      await capturer(page, 'gembloux-coupe');
      if (CAPTURES) { await page.setViewportSize({ width: 390, height: 844 }); await capturer(page, 'gembloux-coupe-telephone'); await page.setViewportSize({ width: 1280, height: 900 }); }
      ok(g.coupe && g.phrase === m.ops.coupureEnLigne('gembloux') && g.autresVisibles.length === 0 && g.deborde <= 1, '/reserver/gembloux : la phrase du serveur, rien d autre a l ecran, et la page ne defile pas', JSON.stringify(g));
      ok(lienSite(g) && lienTel(g, telG) && g.liens.length === 2, '/reserver/gembloux : « fungalaxy.be » mene au site du centre (toute la fenetre), le numero appelle le centre', JSON.stringify(g.liens));
      preparer();
      await page.goto(`${BASE_URL}/reserver/libramont`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const cadre = await cadreDe(page, /\/fungalaxy\/libramont\?embed=1/);
      if (cadre) await attendre(cadre, () => document.body.classList.contains('is-coupe'), 15000);
      await page.waitForTimeout(600);
      const l = cadre ? await cadre.evaluate(LIRE_FORMULAIRE) : null;
      const site = await page.evaluate(() => {
        const vu = (el) => Boolean(el) && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none';
        const iframe = document.querySelector('.pinlane-slot iframe');
        return {
          cadre: vu(iframe), hauteur: iframe ? Math.round(iframe.getBoundingClientRect().height) : 0,
          repli: vu(document.querySelector('#reservationRepli')),
          texte: document.body.innerText,
          liens: [...document.querySelectorAll('a')].filter(vu).map((a) => ({ href: a.getAttribute('href'), texte: a.textContent.trim() })),
        };
      });
      await capturer(page, 'libramont-coupe');
      ok(Boolean(l) && site.cadre && l.coupe && l.phrase === m.ops.coupureEnLigne('libramont') && lienSite(l) && lienTel(l, telL), '/reserver/libramont : le cadre reste et dit la phrase de coupure de Libramont, avec ses deux liens', JSON.stringify({ l, cadre: site.cadre }));
      ok(!site.repli && !/ne s.est pas charg/i.test(site.texte), '/reserver/libramont : plus de « Le formulaire de réservation ne s’est pas chargé »', site.texte.slice(0, 200));
      ok(!site.liens.some((x) => /r[ée]server en ligne/i.test(x.texte) || /\/reserver\?/.test(String(x.href))), '/reserver/libramont : aucun lien qui pretend reserver en ligne', JSON.stringify(site.liens));
      ok(site.hauteur > 0 && site.hauteur < 400 && Boolean(l) && l.deborde <= 1, '/reserver/libramont : le cadre prend la hauteur de la phrase, sans defiler ni laisser un grand vide sous l en-tete', `${site.hauteur} px, deborde de ${l && l.deborde} px`);
      await ctx.close();
    }

    if (joue('C', 'E')) {
      section('[E] L APERCU DANS LE NAVIGATEUR : le bandeau, le formulaire, les heures, le recapitulatif');
      const ctx = await contexte('jeton-gembloux');
      const page = await ctx.newPage();
      preparer();
      await page.goto(`${BASE_URL}/reserver/gembloux`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await attendre(page, () => document.body.classList.contains('is-ready'), 15000);
      await page.waitForTimeout(300);
      const debut = await page.evaluate(LIRE_FORMULAIRE);
      await capturer(page, 'apercu-gembloux');
      if (CAPTURES) { await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300); await capturer(page, 'apercu-gembloux-telephone'); await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForTimeout(300); }
      ok(!debut.coupe && debut.formulaire && debut.bandeau === BANDEAU, '/reserver/gembloux, equipe de Gembloux connectee : le formulaire s ouvre sous le bandeau d apercu', JSON.stringify(debut));
      const lecturesApercu = NAV.requetes.filter((r) => r.methode === 'GET' && r.apercu);
      ok(lecturesApercu.length > 0 && lecturesApercu.every((r) => r.cookie), 'chaque lecture d apercu joint la session de la console (cookie HttpOnly du domaine)', JSON.stringify(NAV.requetes.slice(0, 6)));
      const date = jourOuvert(m, 'gembloux');
      let etape = 'jour';
      let recap = false;
      let messageEnvoi = '';
      try {
        await page.click('#dayBtn');
        if (!(await allerAuMois(page, date))) throw new Error('mois');
        await page.click(`#calGrid .fg-cal__day[data-date="${date}"]`);
        await attendre(page, () => document.querySelector('#dayPop').hidden, 3000);
        etape = 'activites';
        await page.click('#goActivities');
        await attendre(page, () => document.querySelector('.fg-scene[data-scene="activites"].is-active'), 8000);
        await page.click('#gridAct .fg-card[data-activity="bowling"]');
        await page.click('#goHours');
        etape = 'heures';
        if (!(await attendre(page, () => !document.querySelector('#goContact').disabled, 25000))) throw new Error('heures');
        await capturer(page, 'apercu-heures');
        await page.click('#goContact');
        etape = 'coordonnees';
        if (!(await attendre(page, () => document.querySelector('.fg-scene[data-scene="contact"].is-active'), 8000))) throw new Error('coordonnees');
        await page.fill('#cPrenom', 'Equipe'); await page.fill('#cNom', 'Apercu'); await page.fill('#cEmail', 'apercu@exemple.invalid'); await page.fill('#cTel', '0472000000');
        await page.click('#occasions .fg-occasion[data-occasion="amis"]').catch(() => page.click('#occasions .fg-occasion'));
        await page.check('#cConsent');
        await page.click('#goRecap');
        etape = 'recapitulatif';
        recap = await attendre(page, () => document.querySelector('.fg-scene[data-scene="recap"].is-active'), 8000);
        await attendre(page, () => { const v = document.querySelector('#vitrine'); return !v || !v.hasAttribute('data-attendue'); }, 5000);
        if (await page.evaluate(() => { const v = document.querySelector('#vitrine'); return Boolean(v && !v.hidden); })) {
          await page.click('#vitrine .fg-vitrine__non');
          await attendre(page, () => document.querySelector('#vitrine').hidden, 3000);
        }
        etape = 'envoi';
        await page.click('#confirmBtn');
        await attendre(page, () => { const e = document.querySelector('#confirmErr'); return e && !e.hidden; }, 6000);
        await page.waitForTimeout(1200);
        messageEnvoi = await page.evaluate(() => { const e = document.querySelector('#confirmErr'); return e && !e.hidden ? e.textContent.trim() : ''; });
        await page.evaluate(() => { const e = document.querySelector('#confirmErr'); if (e) e.scrollIntoView({ block: 'center' }); });
        await capturer(page, 'apercu-envoi');
      } catch (error) {
        console.log(`(parcours arrete a l etape ${etape} : ${error.message})`);
      }
      ok(recap, `l apercu va jusqu au recapitulatif (jour ${date}, bowling, heures, coordonnees)`, `arrete a l etape ${etape}`);
      ok(messageEnvoi === ENVOI, 'le bouton de validation dit que c est un apercu', messageEnvoi || '(rien)');
      const envoisE = envois();
      const lecturesSansApercu = NAV.requetes.filter((r) => r.methode === 'GET' && !r.apercu && /public-availability/.test(r.chemin));
      ok(lecturesSansApercu.length === 0, 'les heures se lisent en apercu (apercu=1), jamais en visiteur', JSON.stringify(lecturesSansApercu.slice(0, 3)));

      section('[C] RIEN NE PART DE L APERCU (le navigateur)');
      ok(!envoisE.some((r) => /public-(reservations|holds)|custom-request/.test(r.chemin)), 'aucune retenue, aucune reservation, aucune demande n est envoyee', JSON.stringify(envoisE));
      ok(!envoisE.some((r) => /^(etapes|vitrine|heures-pleines)$/.test(r.kind)), 'la visite de l equipe ne compte pas dans les statistiques des visiteurs', JSON.stringify(envoisE));
      ok(recap && messageEnvoi === ENVOI, 'MONTAGE : le parcours a bien touche le bouton de validation', etape);
      // La demande sur mesure : son bouton d envoi, touche en apercu.
      preparer();
      await page.goto(`${BASE_URL}/fungalaxy/gembloux?start=sur-mesure`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const charge = await attendre(page, () => Boolean(document.querySelector('#smSend')) && Boolean(document.querySelector('.fg-apercu')), 20000);
      await page.evaluate(() => { const b = document.querySelector('#smSend'); if (b) b.click(); });
      await page.waitForTimeout(1200);
      const sm = await page.evaluate(() => { const e = document.querySelector('#smSendErr'); return e && !e.hidden ? e.textContent.trim() : ''; });
      ok(charge && sm === ENVOI && !envois().some((r) => /custom-request/.test(r.chemin) || r.kind === 'custom-request'), 'la demande sur mesure n envoie rien en apercu, et le dit', JSON.stringify({ charge, sm, envois: envois() }));
      await ctx.close();
    }

    if (joue('E')) {
      section('[E] L APERCU AILLEURS : la page de Libramont, le fondateur, un autre centre');
      const ctxL = await contexte('jeton-libramont');
      const pl = await ctxL.newPage();
      preparer();
      await pl.goto(`${BASE_URL}/reserver/libramont`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const cadre = await cadreDe(pl, /\/fungalaxy\/libramont\?embed=1/);
      if (cadre) await attendre(cadre, () => document.body.classList.contains('is-ready'), 15000);
      await pl.waitForTimeout(800);
      const l = cadre ? await cadre.evaluate(LIRE_FORMULAIRE) : null;
      await capturer(pl, 'apercu-libramont');
      ok(Boolean(l) && !l.coupe && l.formulaire && l.bandeau === BANDEAU, '/reserver/libramont, equipe de Libramont connectee : le formulaire dans la page du site, sous le bandeau', JSON.stringify(l));
      preparer();
      await pl.goto(`${BASE_URL}/fungalaxy/gembloux`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await attendre(pl, () => document.body.classList.contains('is-ready'), 15000);
      await pl.waitForTimeout(300);
      const autre = await pl.evaluate(LIRE_FORMULAIRE);
      ok(autre.coupe && !autre.bandeau && !autre.formulaire && autre.phrase === m.ops.coupureEnLigne('gembloux'), '/fungalaxy/gembloux, equipe de Libramont : la coupure, comme un visiteur', JSON.stringify(autre));
      await ctxL.close();
      const ctxF = await contexte('jeton-fondateur');
      const pf = await ctxF.newPage();
      preparer();
      await pf.goto(`${BASE_URL}/fungalaxy/libramont`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await attendre(pf, () => document.body.classList.contains('is-ready'), 15000);
      await pf.waitForTimeout(300);
      const f = await pf.evaluate(LIRE_FORMULAIRE);
      ok(!f.coupe && f.formulaire && f.bandeau === BANDEAU, '/fungalaxy/libramont, le fondateur : l apercu', JSON.stringify(f));
      await ctxF.close();
    }

    if (joue('F')) {
      section('[F] SUR LE SITE D UN AUTRE DOMAINE, RIEN NE CHANGE');
      // L equipe de Libramont est connectee a la console dans ce navigateur, et visite le site du centre.
      const ctx = await contexte('jeton-libramont');
      const page = await ctx.newPage();
      // Coupe, mais « en ligne » encore lu en cache par la page du site : le cadre se monte, lit la coupure et se retire.
      preparer('actif', '');
      await page.goto(`${TIERS}/site-tiers`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const monte = await attendre(page, () => Boolean(document.querySelector('iframe')), 8000);
      await attendre(page, () => !document.querySelector('iframe'), 12000);
      await page.waitForTimeout(800);
      const e1 = await page.evaluate(() => ({ cadre: Boolean(document.querySelector('iframe')), ancien: getComputedStyle(document.querySelector('#ancien')).display !== 'none' }));
      const demandes = NAV.requetes.filter((r) => !r.etat);
      ok(monte && !e1.cadre && e1.ancien, 'MONTAGE : le cadre pose sur l autre site lit la coupure et se retire, l ancien formulaire reste', JSON.stringify(e1));
      ok(demandes.length > 0 && !demandes.some((r) => r.apercu), 'le formulaire dans le cadre d un autre site ne demande jamais l apercu', JSON.stringify(demandes));
      ok(!NAV.requetes.some((r) => r.cookie), 'le cookie de la console ne part d aucune lecture du cadre pose sur un autre site', JSON.stringify(NAV.requetes));
      // La balise de la page de Pinlane, recopiee sur un autre site : coupe, rien ne se monte.
      preparer('coupe', 'balise');
      await page.goto(`${TIERS}/site-tiers`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2500);
      const e2 = await page.evaluate(() => ({ cadre: Boolean(document.querySelector('iframe')), ancien: getComputedStyle(document.querySelector('#ancien')).display !== 'none' }));
      ok(!e2.cadre && e2.ancien && !NAV.requetes.some((r) => /fungalaxy/.test(r.chemin)), 'data-page="pinlane" sur un autre domaine ne change rien : coupe, aucun cadre, l ancien formulaire reste', JSON.stringify({ e2, requetes: NAV.requetes }));
      await ctx.close();
    }
  } finally {
    await nav.close();
    srv.close();
  }
}

(async () => {
  const m = monter();
  await serveur(m);
  if (joue('C', 'D', 'E', 'F')) await navigateur(m);
  purger();
  console.log(`\napercu-equipe-check: ${rouges ? `${rouges} ROUGE(S)` : 'ALL OK'}`);
  process.exit(rouges ? 1 : 0);
})().catch((e) => { console.error(`ROUGE [${lettre}] le gate a plante : ${e && e.stack}`); process.exit(1); });

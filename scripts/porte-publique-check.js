// LA PORTE PUBLIQUE : CE QU UN INCONNU NE PEUT PLUS FAIRE (2026-11-18, avant-lancement B2 et B3).
//
// [M] LA COPIE RATEE (B2). Les numeros de reservation se suivent : n importe qui faisait sonner « copie ratee »,
//     URGENT, sur les vraies reservations de l heure. Le signal ne sonne plus que s il porte ce que seul le client a
//     recu : un jeton de sa reservation (retenue ou cle de confirmation, dont la base garde l empreinte) ou, pour une
//     demande de groupe, la preuve rendue avec son numero. Sans elle, rien ne sonne et la base n est pas lue.
// [E] LES ERREURS DU FORMULAIRE (B3). Toutes portaient le meme membre (public:<centre>) : 20 fausses erreurs d un seul
//     envoyeur remplissaient le plafond de l heure et faisaient taire les vrais plantages de tous. Le membre est
//     maintenant l appareil (bloc d adresse et navigateur, en empreinte) : l envoyeur ne remplit que le sien.
//
// Zero reseau, zero base : 'pg' est remplace avant tout require du depot, les alertes sont gardees en memoire.
// Les contre-preuves chargent le code mute en memoire : aucun fichier n est ecrit.
// Lancement : node scripts/porte-publique-check.js [--contre-preuves]

'use strict';

['DATABASE_URL', 'POSTGRES_URL', 'RESEND_API_KEY', 'TELEGRAM_JETON', 'TELEGRAM_CHAT', 'TELEGRAM_GROUPE', 'VERCEL'].forEach((cle) => { delete process.env[cle]; });
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://gate/gate';
process.env.DATABASE_SSL = 'disable';
process.env.PINLANE_CALENDAR_SYNC = 'off';
process.env.STAFF_AUTH_SECRET = 'secret-du-gate-porte-publique';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const Module = require('module');
const { Readable } = require('stream');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const META = path.join(ROOT, 'api', 'public-booking-meta.js');

const MUTATIONS = {
  'miroir-reservation-sans-jeton': { f: 'api/public-booking-meta.js', de: " and exists (select 1 from slot_holds h where h.reservation_id = reservations.id and h.release_reason = 'converted' and h.token_hash = any($3::text[]))", vers: '', lettre: 'M' },
  'miroir-demande-sans-preuve': { f: 'api/public-booking-meta.js', de: 'estDemande ? !demandeProuvee(centre, numero, body.preuve) : !empreintes.length', vers: 'estDemande ? false : !empreintes.length', lettre: 'M' },
  'miroir-preuve-sans-centre': { f: 'api/public-booking-meta.js', de: 'update(`${centre}:d${numero}`)', vers: 'update(`d${numero}`)', lettre: 'M' },
  'erreurs-un-seul-compteur': { f: 'api/public-booking-meta.js', de: '    memberId: membreDuFormulaire(req, centre),\n', vers: '    memberId: `public:${centre}`,\n', lettre: 'E' },
  'erreurs-adresse-entiere': { f: 'api/public-booking-meta.js', de: '`${cleDeLAdresse(getClientIp(req))}|', vers: '`${getClientIp(req)}|', lettre: 'E' },
};
const MUTATION = (process.argv.find((a) => a.startsWith('--mutation=')) || '').slice('--mutation='.length);
if (MUTATION && !MUTATIONS[MUTATION]) { console.error(`mutation inconnue : ${MUTATION}`); process.exit(2); }
function muter(fichier, texte) {
  const m = MUTATION ? MUTATIONS[MUTATION] : null;
  const t = String(texte).split('\r\n').join('\n');
  if (!m || path.resolve(fichier) !== path.join(ROOT, m.f)) return t;
  if (t.split(m.de).length !== 2) throw new Error(`ANCRE DE MUTATION absente ou multiple (${MUTATION}) dans ${m.f}`);
  return t.split(m.de).join(m.vers);
}
const compiler = Module.prototype._compile;
Module.prototype._compile = function compilerMute(contenu, fichier) {
  return compiler.call(this, muter(fichier, contenu), fichier);
};

let rouges = 0;
let lettre = '';
function section(titre) { lettre = (titre.match(/^\[([A-Z])\]/) || [])[1] || ''; console.log(`\n${titre}`); }
function ok(condition, quoi, detail) {
  if (condition) { console.log(`ok    ${quoi}`); return; }
  rouges += 1;
  console.log(`ROUGE [${lettre}] ${quoi}${detail !== undefined ? ` : ${String(detail).slice(0, 300)}` : ''}`);
}

if (process.argv.includes('--contre-preuves')) {
  const temoin = spawnSync(process.execPath, [__filename], { cwd: ROOT, encoding: 'utf8', timeout: 180000 });
  if (temoin.status !== 0) { console.log(`${temoin.stdout || ''}${temoin.stderr || ''}`.split('\n').filter((l) => /ROUGE|Error/.test(l)).join('\n')); console.log('\nporte-publique-check --contre-preuves: le gate est rouge sans mutation, aucune contre-preuve ne compte'); process.exit(1); }
  let rates = 0;
  for (const [nom, m] of Object.entries(MUTATIONS)) {
    const r = spawnSync(process.execPath, [__filename, `--mutation=${nom}`], { cwd: ROOT, encoding: 'utf8', timeout: 180000 });
    const sortie = `${r.stdout || ''}${r.stderr || ''}`;
    const mord = r.status === 1 && sortie.includes(`ROUGE [${m.lettre}]`) && !/ANCRE DE MUTATION/.test(sortie);
    if (!mord) rates += 1;
    console.log(`${mord ? 'TUEE ' : 'VIVANTE'} ${nom} (attendu : ROUGE [${m.lettre}], sortie ${r.status})${mord ? '' : `\n${sortie.split('\n').filter((l) => /ROUGE|ANCRE|Error/.test(l)).slice(0, 6).join('\n')}`}`);
  }
  console.log(rates ? `\nporte-publique-check --contre-preuves: ${rates} mutation(s) vivante(s)` : '\nporte-publique-check --contre-preuves: ALL OK - chaque correctif retire fait rougir sa lettre');
  process.exit(rates ? 1 : 0);
}

// ---------------------------------------------------------------------------
// La base factice : les centres nes dans la console, les reservations et demandes de l heure, les erreurs.
// ---------------------------------------------------------------------------
const JOURS = { open: '10:00', close: '22:00' };
const PUBLIE = { config: { defaultSchedule: { regular: { 0: JOURS, 1: JOURS, 2: JOURS, 3: JOURS, 4: JOURS, 5: JOURS, 6: JOURS }, holiday: {} }, grillesTarif: { bowling: { 0.5: 17, 1: 33, 1.5: 49, 2: 65 }, laser: { 1: 9, 2: 16, 3: 22 } } } };
const CENTRES = [
  { id: 'gate-actif', name: 'Gate Actif', status: 'active', timezone: 'Europe/Brussels', settings: PUBLIE },
  { id: 'gate-prevu', name: 'Gate Prevu Secret', status: 'planned', timezone: 'Europe/Brussels', settings: PUBLIE },
  { id: 'gate-ferme', name: 'Gate Ferme Secret', status: 'closed', timezone: 'Europe/Brussels', settings: PUBLIE },
];
const empreinte = (jeton) => crypto.createHash('sha256').update(jeton).digest('hex');
// La reservation 4301 de Libramont a ete confirmee avec cette cle (noterConfirmationSansBlocage en garde l empreinte).
const CLE_DU_CLIENT = 'cleDuClientQuiAReserve4301abcdefghijklmnop';
const JETON_FAUX = 'jetonBienFormeMaisQuiNestPasLeSien0123456789';
const LECTURES = { reservations: 0, demandes: 0 };
const ERREURS = [];

class FakePool {
  async query(text, params = []) {
    const sql = String(text).replace(/\s+/g, ' ').trim();
    if (/from centers\b/i.test(sql)) {
      const voulus = (params || []).map((v) => String(v == null ? '' : v));
      const lignes = /\bwhere\b/i.test(sql) && voulus.length ? CENTRES.filter((row) => voulus.includes(row.id)) : CENTRES;
      return { rows: lignes.map((row) => JSON.parse(JSON.stringify(row))), rowCount: lignes.length };
    }
    if (/^select id from reservations\b/i.test(sql)) {
      LECTURES.reservations += 1;
      const existe = params[0] === 'libramont' && Number(params[1]) === 4301;
      // La clause de la base, jouee ici : la reservation n est rendue que si un jeton recu est celui de son client.
      const prouvee = !/slot_holds/.test(sql) || (Array.isArray(params[2]) && params[2].includes(empreinte(CLE_DU_CLIENT)));
      return { rows: existe && prouvee ? [{ id: 4301 }] : [], rowCount: existe && prouvee ? 1 : 0 };
    }
    if (/^select id from custom_requests\b/i.test(sql)) {
      LECTURES.demandes += 1;
      const existe = params[0] === 'libramont' && Number(params[1]) === 77;
      return { rows: existe ? [{ id: 77 }] : [], rowCount: existe ? 1 : 0 };
    }
    if (/count\(\*\)::int as recent from client_errors/i.test(sql)) {
      return { rows: [{ recent: ERREURS.filter((e) => e.member_id === params[0]).length }], rowCount: 1 };
    }
    if (/^insert into client_errors/i.test(sql)) {
      ERREURS.push({ id: ERREURS.length + 1, center_id: params[0], message: params[2], stack_hash: params[6], member_id: params[8] });
      return { rows: [{ id: ERREURS.length }], rowCount: 1 };
    }
    if (/from client_errors/i.test(sql)) return { rows: [{ rang: 1, personnes: 1, siens: 1 }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  }
  async connect() { const self = this; return { query: (t, p) => self.query(t, p), release() {} }; }
  on() { return this; }
  async end() {}
}
const PG_PATH = require.resolve('pg');
require.cache[PG_PATH] = { id: PG_PATH, filename: PG_PATH, loaded: true, exports: { Pool: FakePool, Client: FakePool } };

// Les alertes restent ici ; le limiteur de debit n est pas ce que ce gate mesure (il le serait par adresse, et [E]
// envoie vingt-cinq erreurs du meme appareil) ; les sessions du personnel sont celles que la requete nomme.
const ALERTES = [];
require(path.join(ROOT, 'lib', 'garde-alertes')).alerter = async (cle, texte, options) => { ALERTES.push({ cle, texte, options }); return { ok: true }; };
require(path.join(ROOT, 'lib', 'rate-limit')).enforceRateLimit = () => false;
const SESSIONS = {
  prevu: { centerId: 'gate-prevu', permissions: [], role: { id: 'r', locked: false } },
  actif: { centerId: 'gate-actif', permissions: [], role: { id: 'r', locked: false } },
  fondateur: { centerId: 'libramont', permissions: ['platform.admin'], role: { id: 'r', locked: false } },
};
require(path.join(ROOT, 'lib', 'session-du-personnel')).sessionDuPersonnel = async (req) => SESSIONS[(req.headers || {})['x-staff-session']] || null;

function fakeRes() {
  return {
    statusCode: 200, headers: {}, body: null, headersSent: false,
    setHeader(n, v) { this.headers[String(n).toLowerCase()] = v; },
    getHeader(n) { return this.headers[String(n).toLowerCase()]; },
    removeHeader(n) { delete this.headers[String(n).toLowerCase()]; },
    writeHead(s) { this.statusCode = s; return this; },
    end(b) { if (b !== undefined && this.body === null) this.body = String(b); this.headersSent = true; },
  };
}
async function poster(handler, corps, { ip = '203.0.113.9', ua = 'Gate/1.0' } = {}) {
  const brut = Buffer.from(JSON.stringify(corps));
  const req = Readable.from([brut]);
  Object.assign(req, { method: 'POST', url: '/api/public-booking-meta', headers: { host: 'pinlane.test', 'content-type': 'application/json', 'content-length': String(brut.length), 'x-forwarded-for': ip, 'user-agent': ua }, socket: { remoteAddress: ip } });
  const res = fakeRes();
  await handler(req, res);
  return res;
}
async function lire(handler, query, headers = {}) {
  const req = { method: 'GET', url: `/api/public-booking-meta?${query}`, headers: { host: 'pinlane.test', 'x-forwarded-for': '198.51.100.7', ...headers }, socket: { remoteAddress: '198.51.100.7' } };
  const res = fakeRes();
  await handler(req, res);
  let json = null;
  try { json = JSON.parse(res.body || ''); } catch (error) { json = null; }
  return { status: res.statusCode, json, brut: res.body || '' };
}

(async () => {
  const infos = console.info;
  console.info = () => {};
  const handler = require(META);
  const { preuveDeLaDemande } = handler.__test;

  // =========================================================================
  section('[M] LA COPIE RATEE (B2) : seul celui qui a reserve fait sonner');
  // =========================================================================
  {
    const signal = (extra) => ({ kind: 'miroir', centerId: 'libramont', ok: false, raison: 'refuse:17', lignes: 2, envoyees: 1, ...extra });
    const r0 = await poster(handler, signal({ reservationId: 4301 }));
    ok(r0.statusCode === 202 && ALERTES.length === 0, 'un inconnu qui donne le numero d une vraie reservation : 202, rien ne sonne', `${r0.statusCode} ${ALERTES.length}`);
    ok(LECTURES.reservations === 0, 'et la base n est meme pas lue (aucun jeton)', `${LECTURES.reservations} lecture(s)`);
    await poster(handler, signal({ reservationId: 4301, jetons: [JETON_FAUX] }));
    ok(ALERTES.length === 0 && LECTURES.reservations === 1, 'un jeton bien forme qui n est pas celui du client : rien ne sonne', `${ALERTES.length} alerte(s), ${LECTURES.reservations} lecture(s)`);
    await poster(handler, signal({ reservationId: 4301, jetons: ['court', '<b>x</b>'] }));
    ok(ALERTES.length === 0 && LECTURES.reservations === 1, 'des morceaux mal formes ne valent pas un jeton', `${ALERTES.length} alerte(s)`);
    await poster(handler, signal({ reservationId: 4301, jetons: [JETON_FAUX, CLE_DU_CLIENT] }));
    const a = ALERTES[0] || {};
    ok(ALERTES.length === 1 && a.cle === 'miroir:libramont:4301' && (a.options || {}).urgent === true, 'le client, avec la cle de sa confirmation (deuxieme jeton) : la copie ratee sonne, URGENT', `${ALERTES.length} ${a.cle}`);

    await poster(handler, signal({ reservationId: 0, demandeId: 77 }));
    ok(ALERTES.length === 1, 'une demande de groupe sans preuve : rien ne sonne', `${ALERTES.length}`);
    await poster(handler, signal({ reservationId: 0, demandeId: 77, preuve: preuveDeLaDemande('libramont', 78) }));
    ok(ALERTES.length === 1, 'la preuve d une autre demande ne vaut pas pour celle-ci', `${ALERTES.length}`);
    await poster(handler, signal({ reservationId: 0, demandeId: 77, preuve: preuveDeLaDemande('gembloux', 77) }));
    ok(ALERTES.length === 1, 'la preuve du meme numero dans un autre centre non plus', `${ALERTES.length}`);
    ok(LECTURES.demandes === 0, 'et sans preuve valable, la base n est pas lue', `${LECTURES.demandes}`);
    await poster(handler, signal({ reservationId: 0, demandeId: 77, preuve: preuveDeLaDemande('libramont', 77) }));
    ok(ALERTES.length === 2 && (ALERTES[1] || {}).cle === 'miroir:libramont:d77', 'la preuve rendue avec la demande 77 : la copie ratee sonne', `${ALERTES.length} ${(ALERTES[1] || {}).cle}`);

    const source = muter(META, fs.readFileSync(META, 'utf8'));
    ok(/preuveMiroir: preuveDeLaDemande\(centerId, lead\.id\),/.test(source), 'la preuve relue est celle que la demande rend au client (handleCustomRequest)');
  }

  // =========================================================================
  section('[E] LES ERREURS DU FORMULAIRE (B3) : un appareil, un compteur');
  // =========================================================================
  {
    const erreur = (message) => ({ kind: 'erreur-formulaire', centerId: 'libramont', scene: 'date', message, source: 'https://app.pinlane.be/assets/fungalaxy-booking.js', lineno: 1, colno: 1, stack: `Error: ${message}\n    at x (https://app.pinlane.be/assets/fungalaxy-booking.js:1:1)` });
    const ROBOT = { ip: '203.0.113.50', ua: 'Robot/1.0' };
    for (let k = 0; k < 25; k += 1) await poster(handler, erreur(`fausse erreur ${k}`), ROBOT);
    const membresRobot = [...new Set(ERREURS.map((e) => e.member_id))];
    ok(membresRobot.length === 1 && ERREURS.length === 20, 'un envoyeur seul remplit son propre plafond, 20 lignes, pas plus', `${ERREURS.length} lignes, ${membresRobot.length} membre(s)`);
    ok(/^public:libramont:[0-9a-f]{16}$/.test(membresRobot[0] || '') && !/203\.0\.113/.test(membresRobot[0] || ''), 'le membre commence par public:<centre> et ne porte pas l adresse en clair', membresRobot[0]);
    const avant = ALERTES.length;
    await poster(handler, erreur('Le catalogue ne s est pas charge'), { ip: '198.51.100.20', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' });
    const vraie = ERREURS.find((e) => /catalogue/.test(e.message));
    ok(Boolean(vraie) && vraie.member_id !== membresRobot[0], 'la vraie erreur d un client, juste apres, est enregistree sous son propre appareil', vraie ? vraie.member_id : 'perdue');
    ok(ALERTES.length === avant + 1, 'et elle se dit', `${ALERTES.length - avant} alerte(s)`);
    await poster(handler, erreur('ipv6 un'), { ip: '2001:db8:1:2::5', ua: 'Navigateur/1' });
    await poster(handler, erreur('ipv6 deux'), { ip: '2001:db8:1:2:aaaa::9', ua: 'Navigateur/1' });
    await poster(handler, erreur('ipv6 trois'), { ip: '2001:db8:1:2::5', ua: 'Navigateur/2' });
    const membre = (m) => (ERREURS.find((e) => e.message === m) || {}).member_id;
    ok(Boolean(membre('ipv6 un')) && membre('ipv6 un') === membre('ipv6 deux'), 'deux adresses du meme bloc /64 sont le meme appareil (changer d adresse ne rend pas un plafond neuf)', `${membre('ipv6 un')} / ${membre('ipv6 deux')}`);
    ok(Boolean(membre('ipv6 trois')) && membre('ipv6 trois') !== membre('ipv6 un'), 'un autre navigateur derriere la meme adresse a son propre compteur', `${membre('ipv6 trois')}`);
  }

  console.info = infos;
  console.log(rouges ? `\nporte-publique-check: ${rouges} ROUGE(S)` : '\nporte-publique-check: ALL OK');
  process.exit(rouges ? 1 : 0);
})().catch((error) => { console.error(error && (error.stack || error)); process.exit(1); });

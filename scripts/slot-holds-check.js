// LES HORAIRES BLOQUES PENDANT QU UN CLIENT RESERVE : CE QUE LE SERVEUR
// GARANTIT (migration 0049, 2026-09-29).
//
// Movsar : « lorsqu un client choisit ses horaires, ca montre que les horaires
// choisis sont bloques pour lui pendant 10 minutes max, et ca bloque vraiment :
// s il prend 2 pistes, ca compte comme s il avait ces 2 pistes ; au bout du
// timer, s il n a pas confirme, ca annule et c est relibere. Pareil pour le
// laser game. Un vrai systeme, sinon si 3 personnes sont sur la meme page au
// meme moment ca va causer des problemes. »
//
// Zero reseau, zero base : le module 'pg' est remplace, AVANT tout require de
// lib/database.js, par une base en memoire qui se comporte comme Postgres la
// ou ca compte ici :
//   - de VRAIES transactions (ecritures visibles des autres au COMMIT
//     seulement, transaction abandonnee apres une erreur hors savepoint) ;
//   - de VRAIS verrous consultatifs (pg_advisory_xact_lock attend) ;
//   - l INDEX UNIQUE du jeton actif (une insertion concurrente attend la
//     premiere, puis echoue en 23505) ;
//   - les verrous de ligne d un UPDATE ;
//   - une horloge `now()` que le gate avance (l echeance sans attendre).
// Chaque requete rend la main a la boucle d evenements : des appels lances
// ensemble s entrelacent vraiment. Les vrais handlers (api/public-reservations
// pour le blocage et la confirmation, api/public-availability) et le vrai
// moteur y sont rejoues. Rien ne part : communications et automatisations sont
// remplacees par des doubles muets.
//
//   [A] TROIS CLIENTS, LA DERNIERE PISTE, AU MEME MOMENT : un seul la retient.
//   [B] LE CLIENT QUI RETIENT voit toujours ses horaires libres ; les autres
//       ne les voient plus (la grille publique).
//   [C] IL CONFIRME : la reservation prend EXACTEMENT les pistes retenues, le
//       blocage devient la reservation (plus aucun blocage en cours).
//   [D] UN AUTRE NE PEUT PAS CONFIRMER PAR-DESSUS un blocage en cours.
//   [E] L ECHEANCE : 10 minutes apres, sans confirmation, la place revient ;
//       le client en retard ne passe plus par-dessus celui qui l a reprise.
//   [F] REMPLACER, LIBERER : un nouveau choix remplace l ancien, liberer rend
//       la place tout de suite.
//   [G] LE LASER : un blocage compte dans l arene comme une reservation.
//   [H] LE PLAFOND PAR APPAREIL : 3 blocages en cours, pas un de plus.
//   [I] LA CONFIRMATION RENVOYEE (reponse perdue) rend la meme reservation ;
//       deux envois simultanes n en creent qu une ; un jeton confirme ne
//       retient plus rien.
//   [J] LE STAFF est refuse sur un creneau retenu, et le message dit quand la
//       place se libere ; une vraie reservation, elle, ne l annonce pas.
//   [K] SANS LA TABLE (0049 pas encore jouee) : tout marche comme avant, le
//       blocage repond 503.
//   [L] LE PLAN RETENU EST CELUI CONFIRME : la confirmation reprend les pistes
//       et le plan que le blocage gardait, meme si l ecran en montrait
//       d autres.
//
// CONTRE-EPREUVES PAR MUTATION, compilees en memoire (crochet sur
// Module.prototype._compile, le disque n est jamais touche).
//
// Usage : node scripts/slot-holds-check.js
'use strict';
const path = require('path');
const Module = require('module');
const { Readable } = require('stream');

const ROOT = path.resolve(__dirname, '..');
const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
const LF = String.fromCharCode(10);
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://gate:gate@127.0.0.1:1/gate';
process.env.PINLANE_CALENDAR_SYNC = 'off';

let failures = 0;
function ok(cond, label, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures += 1;
  return cond;
}

// ---------------------------------------------------------------------------
// Mutations en memoire.
// ---------------------------------------------------------------------------
let mutations = [];
const compileOrigine = Module.prototype._compile;
Module.prototype._compile = function (contenu, nom) {
  const rel = path.relative(ROOT, nom).split(path.sep).join('/');
  const editions = mutations.filter((e) => e.fichier === rel);
  if (!editions.length) return compileOrigine.call(this, contenu, nom);
  let mute = contenu.split(CRLF).join(LF);
  for (const { de, vers } of editions) {
    if (mute.split(de).length - 1 !== 1) throw new Error(`ancre absente ou multiple dans ${rel} : ${de.slice(0, 70)}`);
    mute = mute.split(de).join(vers);
  }
  return compileOrigine.call(this, mute, nom);
};

// ---------------------------------------------------------------------------
// LA BASE EN MEMOIRE.
// ---------------------------------------------------------------------------
const base = {
  reservations: new Map(),
  holds: new Map(),
  seqRes: 5000,
  seqHold: 0,
  horloge: Date.now(),
  tableAbsente: false,
  verrousPris: [],
  // Appele a la prochaine demande de verrou consultatif : un autre client
  // agit entre la lecture du moteur et le verrou.
  avantVerrou: null,
};
const verrous = new Map(); // cle consultative -> { tx, n }
const clesEnCours = new Map(); // empreinte de jeton -> transaction qui l insere
const lignesVerrouillees = new Map(); // id de blocage -> transaction

function tick() { return new Promise((resolve) => setImmediate(resolve)); }
function maintenant() { return new Date(base.horloge); }
function vide() { return { rows: [], rowCount: 0 }; }
function clone(v) {
  return JSON.parse(JSON.stringify(v), (k, val) => (['expires_at', 'released_at', 'created_at', 'updated_at'].includes(k) && val ? new Date(val) : val));
}

class Transaction {
  constructor() {
    this.reservations = new Map();
    this.holds = new Map();
    this.verrous = [];
    this.cles = [];
    this.lignes = [];
    this.abandonnee = false;
    this.fini = false;
    this.promesse = new Promise((resolve) => { this.terminer = resolve; });
  }
}

function vue(tx, table) {
  const m = new Map(base[table]);
  if (tx) tx[table].forEach((row, id) => m.set(id, row));
  return m;
}
function ecrire(tx, table, id, row) {
  if (tx) tx[table].set(id, row); else base[table].set(id, row);
}
function finir(tx, valider) {
  if (valider) {
    tx.reservations.forEach((row, id) => base.reservations.set(id, row));
    tx.holds.forEach((row, id) => base.holds.set(id, row));
  }
  tx.verrous.forEach((cle) => { if (verrous.get(cle) && verrous.get(cle).tx === tx) verrous.delete(cle); });
  tx.cles.forEach((cle) => { if (clesEnCours.get(cle) === tx) clesEnCours.delete(cle); });
  tx.lignes.forEach((id) => { if (lignesVerrouillees.get(id) === tx) lignesVerrouillees.delete(id); });
  tx.fini = true;
  tx.terminer();
}

async function prendreVerrou(tx, cle) {
  for (;;) {
    const v = verrous.get(cle);
    if (!v) { verrous.set(cle, { tx, n: 1 }); tx.verrous.push(cle); return; }
    if (v.tx === tx) { v.n += 1; return; }
    await v.tx.promesse;
  }
}

// Un UPDATE attend les lignes qu une autre transaction a modifiees, puis
// relit : exactement ce que fait Postgres en READ COMMITTED.
async function mettreAJourBlocages(tx, filtre, changer) {
  for (;;) {
    const cibles = [...vue(tx, 'holds').values()].filter(filtre);
    const tenue = cibles.map((h) => lignesVerrouillees.get(h.id)).find((autre) => autre && autre !== tx && !autre.fini);
    if (tenue) { await tenue.promesse; continue; }
    cibles.forEach((h) => {
      ecrire(tx, 'holds', h.id, { ...h, ...changer(h) });
      if (tx) { lignesVerrouillees.set(h.id, tx); tx.lignes.push(h.id); }
    });
    return { rows: [], rowCount: cibles.length };
  }
}

const ACTIF = (h) => h.released_at === null && h.expires_at.getTime() > base.horloge;

async function sqlBlocages(tx, s, p) {
  if (base.tableAbsente) throw Object.assign(new Error('relation "slot_holds" does not exist'), { code: '42P01' });
  if (/^select id, payload, expires_at from slot_holds where center_id = \$1 and date = \$2 and released_at is null and expires_at > now\(\) and token_hash <> \$3 order by id asc;?$/.test(s)) {
    const rows = [...vue(tx, 'holds').values()]
      .filter((h) => h.center_id === p[0] && h.date === p[1] && ACTIF(h) && h.token_hash !== p[2])
      .sort((a, b) => a.id - b.id)
      .map((h) => ({ id: h.id, payload: clone(h.payload), expires_at: new Date(h.expires_at) }));
    return { rows, rowCount: rows.length };
  }
  if (/^select payload from slot_holds where token_hash = \$1 and center_id = \$2 and date = \$3 and released_at is null and expires_at > now\(\) order by id desc limit 1;?$/.test(s)) {
    const rows = [...vue(tx, 'holds').values()]
      .filter((h) => h.token_hash === p[0] && h.center_id === p[1] && h.date === p[2] && ACTIF(h))
      .sort((a, b) => b.id - a.id).slice(0, 1)
      .map((h) => ({ payload: clone(h.payload) }));
    return { rows, rowCount: rows.length };
  }
  if (/^select r\.\* from slot_holds h join reservations r on r\.id = h\.reservation_id where h\.token_hash = \$1 and h\.release_reason = 'converted' and r\.status <> 'cancelled' order by h\.id desc limit 1;?$/.test(s)) {
    const reservations = vue(tx, 'reservations');
    const rows = [...vue(tx, 'holds').values()]
      .filter((h) => h.token_hash === p[0] && h.release_reason === 'converted' && reservations.has(h.reservation_id)
        && reservations.get(h.reservation_id).status !== 'cancelled')
      .sort((a, b) => b.id - a.id).slice(0, 1)
      .map((h) => clone(reservations.get(h.reservation_id)));
    return { rows, rowCount: rows.length };
  }
  if (/^select count\(\*\)::int as n from slot_holds where ip_hash = \$1 and token_hash <> \$2 and released_at is null and expires_at > now\(\);?$/.test(s)) {
    const n = [...vue(tx, 'holds').values()].filter((h) => h.ip_hash === p[0] && h.token_hash !== p[1] && ACTIF(h)).length;
    return { rows: [{ n }], rowCount: 1 };
  }
  let m = /^update slot_holds set released_at = now\(\), release_reason = '(replaced|released)' where token_hash = \$1 and released_at is null;?$/.exec(s);
  if (m) {
    const raison = m[1];
    return mettreAJourBlocages(tx, (h) => h.token_hash === p[0] && h.released_at === null, () => ({ released_at: maintenant(), release_reason: raison }));
  }
  if (/^update slot_holds set released_at = now\(\), release_reason = 'converted', reservation_id = \$2 where token_hash = \$1 and released_at is null;?$/.test(s)) {
    return mettreAJourBlocages(tx, (h) => h.token_hash === p[0] && h.released_at === null, () => ({ released_at: maintenant(), release_reason: 'converted', reservation_id: Number(p[1]) }));
  }
  if (/^insert into slot_holds \(center_id, date, start_time, token_hash, ip_hash, payload, expires_at\) values \(\$1, \$2, \$3, \$4, \$5, \$6::jsonb, now\(\) \+ make_interval\(mins => \$7\)\) returning id, expires_at;?$/.test(s)) {
    // L index unique partiel (token_hash) where released_at is null : une
    // insertion concurrente du meme jeton attend la premiere, puis echoue.
    for (;;) {
      const autre = clesEnCours.get(p[3]);
      if (autre && autre !== tx && !autre.fini) { await autre.promesse; continue; }
      break;
    }
    if ([...vue(tx, 'holds').values()].some((h) => h.token_hash === p[3] && h.released_at === null)) {
      throw Object.assign(new Error('duplicate key value violates unique constraint "slot_holds_jeton_actif_idx"'), { code: '23505' });
    }
    base.seqHold += 1;
    const row = {
      id: base.seqHold, center_id: p[0], date: p[1], start_time: p[2], token_hash: p[3], ip_hash: p[4],
      payload: JSON.parse(p[5]), created_at: maintenant(), expires_at: new Date(base.horloge + Number(p[6]) * 60000),
      released_at: null, release_reason: null, reservation_id: null,
    };
    ecrire(tx, 'holds', row.id, row);
    if (tx) { clesEnCours.set(p[3], tx); tx.cles.push(p[3]); }
    return { rows: [{ id: row.id, expires_at: new Date(row.expires_at) }], rowCount: 1 };
  }
  if (/^delete from slot_holds where coalesce\(released_at, expires_at\) < now\(\) - interval '7 days';?$/.test(s)) {
    const limite = base.horloge - 7 * 24 * 3600 * 1000;
    let n = 0;
    [...base.holds.values()].forEach((h) => { if ((h.released_at || h.expires_at).getTime() < limite) { base.holds.delete(h.id); n += 1; } });
    return { rows: [], rowCount: n };
  }
  throw new Error(`SQL slot_holds non simulee : ${s.slice(0, 160)}`);
}

async function executer(tx, s, p) {
  if (/^savepoint \w+$/i.test(s) || /^release savepoint \w+$/i.test(s)) return vide();
  if (/^rollback to savepoint \w+$/i.test(s)) { if (tx) tx.abandonnee = false; return vide(); }
  if (/^select pg_advisory_xact_lock\(hashtext\(\$1\)\);?$/.test(s)) {
    if (typeof base.avantVerrou === 'function') { const f = base.avantVerrou; base.avantVerrou = null; f(); }
    base.verrousPris.push(String(p[0]));
    if (tx) await prendreVerrou(tx, String(p[0]));
    return { rows: [{}], rowCount: 1 };
  }
  if (/slot_holds/.test(s)) return sqlBlocages(tx, s, p);
  if (/^select \* from reservations where date = \$1 and center_id = \$2 and status <> 'cancelled'( and id <> \$3)? order by start_time asc, id asc;?$/.test(s)) {
    const rows = [...vue(tx, 'reservations').values()]
      .filter((r) => r.date === p[0] && r.center_id === p[1] && r.status !== 'cancelled' && (!p[2] || r.id !== Number(p[2])))
      .sort((a, b) => a.start_time.localeCompare(b.start_time) || a.id - b.id)
      .map(clone);
    return { rows, rowCount: rows.length };
  }
  if (/^insert into reservations \(/.test(s)) {
    const [center_id, channel, name, phone, email, date, start_time, duration, total_duration, lanes, pax, status, base_price, price, type, formule_id, label, occasion, extras, payment_method, notes, ops_plan, risk_level, risk_score, validation_status, activity_progress, program, companions] = p;
    base.seqRes += 1;
    const row = {
      id: base.seqRes, center_id, channel, name, phone, email, date, start_time, duration, total_duration,
      lanes: (lanes || []).map(Number), pax, status, base_price, price, type, formule_id, label, occasion,
      extras: JSON.parse(extras || '[]'), payment_method, notes, ops_plan: ops_plan ? JSON.parse(ops_plan) : null,
      risk_level, risk_score, validation_status, activity_progress: JSON.parse(activity_progress || '{}'),
      program: program ? JSON.parse(program) : null, companions, created_at: maintenant(), updated_at: maintenant(),
    };
    ecrire(tx, 'reservations', row.id, row);
    return { rows: [clone(row)], rowCount: 1 };
  }
  if (/^(select|update|delete|insert)\b/i.test(s) && /\breservations\b/.test(s) && !/\bfrom (ops_events|communications|ops_jobs)\b/.test(s)) {
    throw new Error(`SQL reservations non simulee : ${s.slice(0, 160)}`);
  }
  return vide();
}

class FauxClient {
  constructor() { this.tx = null; }
  async query(sql, params = []) {
    await tick();
    const s = String(sql).replace(/\s+/g, ' ').trim();
    if (s === 'BEGIN') { this.tx = new Transaction(); return vide(); }
    if (s === 'COMMIT' || s === 'ROLLBACK') {
      const tx = this.tx;
      this.tx = null;
      if (tx) finir(tx, s === 'COMMIT' && !tx.abandonnee);
      return vide();
    }
    if (this.tx && this.tx.abandonnee && !/^rollback to savepoint/i.test(s)) {
      throw new Error('current transaction is aborted, commands ignored until end of transaction block');
    }
    try {
      return await executer(this.tx, s, params);
    } catch (error) {
      if (this.tx) this.tx.abandonnee = true;
      throw error;
    }
  }
  release() {}
}
class FauxPool {
  async connect() { return new FauxClient(); }
  query(sql, params) { return new FauxClient().query(sql, params); }
  on() {}
  end() {}
}
const pgPath = require.resolve('pg', { paths: [ROOT] });
require.cache[pgPath] = { id: pgPath, filename: pgPath, loaded: true, exports: { Pool: FauxPool, Client: FauxClient, types: { setTypeParser() {} } } };

// ---------------------------------------------------------------------------
// LES MODULES : la base, le moteur et les handlers sont les vrais ; ce qui
// enverrait quelque chose (communications, automatisations) est muet.
// ---------------------------------------------------------------------------
function remplacer(relatif, surcharge) {
  const chemin = require.resolve(path.join(ROOT, relatif));
  const reel = require(chemin);
  require.cache[chemin] = { id: chemin, filename: chemin, loaded: true, exports: { ...reel, ...surcharge } };
}
const MUETS = () => {
  remplacer('lib/ops-communications.js', {
    enqueueReservationCommunications: async () => [],
    dispatchDueCommunications: async () => ({ sent: 0 }),
    sendCustomRequestAck: async () => ({ skipped: true }),
  });
  remplacer('lib/ops-jobs.js', { enqueueReservationAutomation: async () => [] });
};

function charger() {
  for (const cle of Object.keys(require.cache)) {
    if (!cle.startsWith(ROOT) || cle.includes(`${path.sep}node_modules${path.sep}`)) continue;
    if (cle === __filename) continue;
    delete require.cache[cle];
  }
  MUETS();
  const S = {};
  S.db = require(path.join(ROOT, 'lib/database.js'));
  S.reservations = require(path.join(ROOT, 'api/public-reservations.js'));
  S.dispo = require(path.join(ROOT, 'api/public-availability.js'));
  S.ops = require(path.join(ROOT, 'lib/reservation-ops.js'));
  S.requete = require(path.join(ROOT, 'lib/reservation-request.js'));
  return S;
}

// ---------------------------------------------------------------------------
// Les appels HTTP, comme le navigateur les fait.
// ---------------------------------------------------------------------------
let ipSuivante = 10;
function ipNeuve() { ipSuivante += 1; return `10.20.${Math.floor(ipSuivante / 250)}.${ipSuivante % 250}`; }

async function appeler(handler, { methode = 'POST', url, corps, ip = ipNeuve(), entetes = {} }) {
  const req = Readable.from(corps === undefined ? [] : [Buffer.from(JSON.stringify(corps))]);
  req.method = methode;
  req.url = url;
  req.headers = { host: 'localhost', 'content-type': 'application/json', 'x-forwarded-for': ip, ...entetes };
  req.socket = { remoteAddress: ip };
  const res = {
    statusCode: 200,
    entetes: {},
    corps: '',
    req,
    setHeader(k, v) { this.entetes[k.toLowerCase()] = v; },
    getHeader(k) { return this.entetes[k.toLowerCase()]; },
    end(b) { this.corps = String(b || ''); },
  };
  await handler(req, res);
  let json = null;
  try { json = JSON.parse(res.corps); } catch (e) { json = null; }
  return { statut: res.statusCode, json: json || {} };
}

// Un jour ouvert, a une semaine au moins : jamais aujourd hui (un gate qui
// reserve aujourd hui rougit le soir).
function jourDeTest() {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).split('-').map(Number);
  const c = new Date(Date.UTC(y, m - 1, d + 7));
  while (c.getUTCDay() !== 6) c.setUTCDate(c.getUTCDate() + 1);
  return c.toISOString().slice(0, 10);
}
const JOUR = jourDeTest();

// Le corps que le formulaire envoie (payload() de fungalaxy-booking.js), sans
// coordonnees pour un blocage.
function visite(heure, lignes, extra = {}) {
  const pins = {};
  lignes.forEach((l) => { if (!l.sansHeure) pins[l.activityId] = heure; });
  return {
    centerId: 'libramont', date: JOUR, startTime: heure, pax: 4, companions: 0, channel: 'public', occasion: '',
    type: 'visite', program: lignes.map(({ sansHeure, ...l }) => l),
    preference: { preferredTimes: pins, laserGameTimes: [], laserPlacement: 'scheduled', arrivalConfidence: 'normal' },
    price: 0, basePrice: 0, duration: 1, totalDuration: 1, ...extra,
  };
}
const BOWLING = (heure, extra) => visite(heure, [{ activityId: 'bowling', duration: 1 }], extra);
const LASER = (heure, extra) => visite(heure, [{ activityId: 'laser_game', games: 1 }], extra);
function avecContact(corps, n = 1) {
  return { ...corps, name: `Client Essai ${n}`, email: `client${n}@example.test`, phone: '0470000000' };
}

function retenir(S, corps, options = {}) {
  return appeler(S.reservations, { url: '/api/public-reservations?action=hold', corps, ...options });
}
function confirmer(S, corps, options = {}) {
  return appeler(S.reservations, { url: '/api/public-reservations', corps, ...options });
}
function liberer(S, jeton) {
  return appeler(S.reservations, { url: '/api/public-reservations?action=hold', corps: { release: true, holdToken: jeton } });
}
async function heuresLibres(S, corps, jeton = '') {
  const q = new URLSearchParams({ centerId: 'libramont', date: JOUR, pax: String(corps.pax), type: 'bowling', duration: '1' });
  const r = await appeler(S.dispo, { methode: 'GET', url: `/api/public-availability?${q}`, entetes: jeton ? { 'x-pinlane-hold': jeton } : {} });
  return (r.json.slots || []).map((slot) => slot.time);
}

function reservationLigne(id, heure, lanes, extra = {}) {
  return {
    id, center_id: 'libramont', channel: 'staff', name: `Groupe ${id}`, phone: '0470000000', email: '', date: JOUR,
    start_time: heure, duration: 1, total_duration: 1, lanes, pax: 4, status: 'confirmed', base_price: 30, price: 30,
    type: 'bowling', formule_id: null, label: 'Bowling', occasion: '', extras: [], payment_method: null, notes: '',
    ops_plan: null, risk_level: '', risk_score: null, validation_status: 'confirmed', activity_progress: {}, program: null,
    companions: 0, created_at: maintenant(), updated_at: maintenant(), ...extra,
  };
}

function semer(reservations = []) {
  base.reservations.clear();
  base.holds.clear();
  base.horloge = Date.now();
  base.tableAbsente = false;
  base.verrousPris.length = 0;
  base.avantVerrou = null;
  reservations.forEach((r) => base.reservations.set(r.id, r));
  if (globalThis.__pinlaneRateBuckets) globalThis.__pinlaneRateBuckets.clear();
}
// Sept pistes sur huit prises a 15:00 : la huitieme est la derniere.
const SEPT_PISTES = () => [1, 2, 3, 4, 5, 6, 7].map((l) => reservationLigne(900 + l, '15:00', [l]));
const blocagesEnCours = () => [...base.holds.values()].filter(ACTIF);
const reservationsPubliques = () => [...base.reservations.values()].filter((r) => r.channel === 'public');

// ---------------------------------------------------------------------------
// LES SCENARIOS. Chacun rend des faits ; les verdicts sont poses plus bas, et
// les contre-epreuves rejouent les memes scenarios sur un code casse.
// ---------------------------------------------------------------------------
async function scenarioTrois(S) {
  semer(SEPT_PISTES());
  const trois = await Promise.all([1, 2, 3].map(() => retenir(S, BOWLING('15:00'))));
  const gagnant = trois.find((r) => r.statut === 201);
  return {
    statuts: trois.map((r) => r.statut).sort().join(','),
    codes: trois.filter((r) => r.statut !== 201).map((r) => r.json.code).join(','),
    messages: trois.filter((r) => r.statut !== 201).map((r) => r.json.message),
    enCours: blocagesEnCours().length,
    gagnant,
    pistesRetenues: blocagesEnCours().map((h) => (h.payload.lanes || []).join('+')).join(','),
  };
}

async function scenarioGrille(S) {
  semer(SEPT_PISTES());
  const a = await retenir(S, BOWLING('15:00'));
  const pourLui = await heuresLibres(S, BOWLING('15:00'), a.json.holdToken);
  const pourLesAutres = await heuresLibres(S, BOWLING('15:00'));
  return { tenu: a.statut, pourLui: pourLui.includes('15:00'), pourLesAutres: pourLesAutres.includes('15:00'), autreHeure: pourLesAutres.includes('16:00') };
}

async function scenarioConfirmer(S) {
  semer(SEPT_PISTES());
  const a = await retenir(S, BOWLING('15:00'));
  const pistesTenues = blocagesEnCours().map((h) => (h.payload.lanes || []).join('+')).join(',');
  const autre = await confirmer(S, avecContact(BOWLING('15:00'), 2));
  const lui = await confirmer(S, avecContact({ ...BOWLING('15:00'), holdToken: a.json.holdToken }, 1));
  const tenu = [...base.holds.values()].find((h) => h.token_hash && h.release_reason === 'converted');
  return {
    tenu: a.statut,
    autre: autre.statut,
    lui: lui.statut,
    pistesTenues,
    pistesReservees: lui.json.reservation ? (lui.json.reservation.lanes || []).join('+') : '',
    enCours: blocagesEnCours().length,
    converti: Boolean(tenu && lui.json.reservation && tenu.reservation_id === lui.json.reservation.id),
    lignes: reservationsPubliques().length,
  };
}

async function scenarioEcheance(S) {
  semer(SEPT_PISTES());
  const b = await retenir(S, BOWLING('15:00'));
  const avant = await retenir(S, BOWLING('15:00'));
  base.horloge += 9 * 60000 + 59000;
  const juste = await retenir(S, BOWLING('15:00'));
  base.horloge += 2000;
  const apres = await retenir(S, BOWLING('15:00'));
  const retard = await confirmer(S, avecContact({ ...BOWLING('15:00'), holdToken: b.json.holdToken }, 3));
  return {
    b: b.statut, avant: avant.statut, juste: juste.statut, apres: apres.statut, retard: retard.statut,
    minutes: b.json.minutes, echeance: Date.parse(b.json.expiresAt) - Date.parse(b.json.serverNow),
    lignes: reservationsPubliques().length,
  };
}

async function scenarioRemplacerLiberer(S) {
  semer(SEPT_PISTES());
  const a = await retenir(S, BOWLING('15:00'));
  const jeton = a.json.holdToken;
  const change = await retenir(S, { ...BOWLING('17:00'), holdToken: jeton });
  const apresChange = blocagesEnCours().map((h) => h.start_time).join(',');
  const autreA15 = await retenir(S, BOWLING('15:00'));
  const libere = await liberer(S, autreA15.json.holdToken);
  const encore = await retenir(S, BOWLING('15:00'));
  return {
    change: change.statut, memeJeton: change.json.holdToken === jeton, apresChange, autreA15: autreA15.statut,
    libere: libere.statut, liberees: libere.json.released, encore: encore.statut,
  };
}

async function scenarioLaser(S) {
  semer([]);
  const a = await retenir(S, LASER('16:00', { pax: 20 }));
  const b = await retenir(S, LASER('16:00', { pax: 15 }));
  const c = await retenir(S, LASER('16:00', { pax: 10 }));
  const d = await retenir(S, LASER('16:00', { pax: 2 }));
  const ailleurs = await retenir(S, LASER('18:00', { pax: 15 }));
  return { a: a.statut, b: b.statut, bCode: b.json.code, bMessage: b.json.message || '', c: c.statut, d: d.statut, ailleurs: ailleurs.statut };
}

async function scenarioPlafond(S) {
  semer([]);
  const ip = '10.99.0.7';
  const heures = ['11:00', '12:00', '13:00', '14:00'];
  const r = [];
  for (const h of heures) r.push(await retenir(S, BOWLING(h), { ip }));
  const ailleurs = await retenir(S, BOWLING('18:00'), { ip: '10.99.0.8' });
  // Le meme appareil remplace un de ses blocages : ce n est pas un de plus.
  const remplace = await retenir(S, { ...BOWLING('19:00'), holdToken: r[0].json.holdToken }, { ip });
  return { statuts: r.map((x) => x.statut).join(','), code: r[3].json.code, ailleurs: ailleurs.statut, remplace: remplace.statut };
}

async function scenarioRejeu(S) {
  semer([]);
  const a = await retenir(S, BOWLING('15:00'));
  const corps = avecContact({ ...BOWLING('15:00'), holdToken: a.json.holdToken }, 5);
  const une = await confirmer(S, corps);
  const deux = await confirmer(S, corps);
  const encore = await retenir(S, { ...BOWLING('15:00'), holdToken: a.json.holdToken });
  // Deux envois simultanes d une confirmation.
  const b = await retenir(S, BOWLING('18:00'));
  const corpsB = avecContact({ ...BOWLING('18:00'), holdToken: b.json.holdToken }, 6);
  const ensemble = await Promise.all([confirmer(S, corpsB), confirmer(S, corpsB)]);
  return {
    une: une.statut, deux: deux.statut, rejoue: deux.json.replay === true,
    memeId: Boolean(une.json.reservation && deux.json.reservation && une.json.reservation.id === deux.json.reservation.id),
    encore: encore.statut, encoreCode: encore.json.code,
    ensemble: ensemble.map((r) => r.statut).sort().join(','),
    ensembleMemeId: ensemble[0].json.reservation && ensemble[1].json.reservation && ensemble[0].json.reservation.id === ensemble[1].json.reservation.id,
    lignes: reservationsPubliques().length,
  };
}

async function scenarioStaff(S) {
  semer(SEPT_PISTES());
  const a = await retenir(S, BOWLING('15:00'));
  const staff = { centerId: 'libramont', channel: 'staff', name: 'Comptoir', phone: '0470000000', email: '', date: JOUR, startTime: '15:00', duration: 1, totalDuration: 1, pax: 4, type: 'bowling', laneCount: 1, requiresLanes: true, lanes: [] };
  let refus = '';
  try { await S.db.createReservation(staff); } catch (error) { refus = error.message; }
  // Une VRAIE reservation sur la derniere piste, et un blocage LASER a la
  // meme heure : le blocage chevauche la visite, mais le refus vient des
  // pistes. Il ne promet donc aucune liberation.
  semer([...SEPT_PISTES(), reservationLigne(908, '15:00', [8])]);
  const laser = await retenir(S, LASER('15:00', { pax: 6 }));
  let refusReel = '';
  try { await S.db.createReservation(staff); } catch (error) { refusReel = error.message; }
  return { tenu: a.statut, refus, laser: laser.statut, refusReel };
}

async function scenarioSansTable(S) {
  semer(SEPT_PISTES());
  base.tableAbsente = true;
  const libres = await heuresLibres(S, BOWLING('15:00'));
  const bloque = await retenir(S, BOWLING('15:00'));
  const reserve = await confirmer(S, avecContact(BOWLING('15:00'), 8));
  base.tableAbsente = false;
  return { libres: libres.includes('15:00'), bloque: bloque.statut, code: bloque.json.code, reserve: reserve.statut, message: reserve.json.message || '' };
}

// Le plan retenu : bowling + laser, les pistes de l ecran (1) sont prises
// par un autre entre la page des horaires et le blocage. Le blocage prend
// les pistes que le moteur trouve libres ; la confirmation, qui renvoie les
// pistes de l ecran, doit obtenir celles retenues.
async function scenarioPlanRetenu(S) {
  semer([]);
  const corps = visite('15:00', [{ activityId: 'bowling', duration: 1 }, { activityId: 'laser_game', games: 1, sansHeure: true }]);
  const ecran = await S.ops.prepareReservationOps(S.requete.normalizeReservationRequest(corps, { channel: 'public' }), 'public');
  const pistesEcran = ecran.opsPlan && Array.isArray(ecran.opsPlan.assignedLanes) ? ecran.opsPlan.assignedLanes : [];
  base.reservations.set(990, reservationLigne(990, '15:00', pistesEcran.slice(), { duration: 2, total_duration: 2 }));
  const a = await retenir(S, { ...corps, lanes: pistesEcran });
  const tenues = blocagesEnCours().map((h) => (h.payload.lanes || []).join('+')).join(',');
  const lui = await confirmer(S, avecContact({ ...corps, lanes: pistesEcran, holdToken: a.json.holdToken }, 9));

  // LA COURSE : le client retient la piste 8 (la seule libre) ; une
  // reservation de la piste 1 est annulee ; il confirme, le moteur (qui ne
  // compte pas son propre blocage) choisit alors la piste 1 ; et entre la
  // lecture du moteur et le verrou, un autre client retient la piste 1. La
  // confirmation doit obtenir la piste 8, qui lui etait gardee.
  semer([2, 3, 4, 5, 6, 7].map((l) => reservationLigne(900 + l, '15:00', [l])).concat([reservationLigne(991, '15:00', [1])]));
  const b = await retenir(S, corps);
  const tenue = blocagesEnCours()[0];
  base.reservations.set(991, { ...base.reservations.get(991), status: 'cancelled' });
  base.avantVerrou = () => {
    const pa = clone(tenue.payload);
    pa.lanes = [1];
    ((pa.opsPlan && pa.opsPlan.resourceBlocks) || []).forEach((bloc) => { if (bloc.resourceType === 'bowling_lane') bloc.lanes = [1]; });
    if (pa.opsPlan) pa.opsPlan.assignedLanes = [1];
    base.seqHold += 1;
    base.holds.set(base.seqHold, {
      id: base.seqHold, center_id: 'libramont', date: JOUR, start_time: tenue.start_time, token_hash: 'c'.repeat(64), ip_hash: '',
      payload: pa, created_at: maintenant(), expires_at: new Date(base.horloge + 600000), released_at: null, release_reason: null, reservation_id: null,
    });
  };
  const course = await confirmer(S, avecContact({ ...corps, holdToken: b.json.holdToken }, 10));
  return {
    pistesEcran: pistesEcran.join('+'), tenu: a.statut, tenues, lui: lui.statut, message: lui.json.message || '',
    reservees: lui.json.reservation ? (lui.json.reservation.lanes || []).join('+') : '',
    courseTenues: tenue ? (tenue.payload.lanes || []).join('+') : '', course: course.statut, courseMessage: course.json.message || '',
    courseReservees: course.json.reservation ? (course.json.reservation.lanes || []).join('+') : '',
  };
}

async function tout(S) {
  return {
    trois: await scenarioTrois(S),
    grille: await scenarioGrille(S),
    confirmer: await scenarioConfirmer(S),
    echeance: await scenarioEcheance(S),
    remplacer: await scenarioRemplacerLiberer(S),
    laser: await scenarioLaser(S),
    plafond: await scenarioPlafond(S),
    rejeu: await scenarioRejeu(S),
    staff: await scenarioStaff(S),
    sansTable: await scenarioSansTable(S),
    planRetenu: await scenarioPlanRetenu(S),
  };
}

const LIBERE_A = /sans confirmation, la place se libère au plus tard à \d{2}:\d{2}\./;

async function main() {
  const S = charger();
  const R = await tout(S);

  console.log('\n[A] Trois clients, la derniere piste, au meme moment');
  ok(R.trois.statuts === '201,409,409', 'un seul retient la derniere piste, les deux autres sont refuses', R.trois.statuts);
  ok(R.trois.enCours === 1, 'un seul blocage en cours', String(R.trois.enCours));
  ok(R.trois.pistesRetenues === '8', 'il tient la piste 8, la seule libre', R.trois.pistesRetenues);
  ok(R.trois.messages.every((m) => /^Ces horaires ne sont plus libres\./.test(m)), 'les refus disent que les horaires ne sont plus libres', R.trois.messages.join(' | '));
  ok(R.trois.messages.every((m) => LIBERE_A.test(m)), 'et disent quand la place se libere', R.trois.messages.join(' | '));
  ok(R.trois.gagnant && /^[A-Za-z0-9_-]{32,64}$/.test(R.trois.gagnant.json.holdToken || ''), 'le gagnant recoit son jeton');

  console.log('\n[B] La grille publique');
  ok(R.grille.tenu === 201 && R.grille.pourLui, 'le client qui retient voit toujours 15:00 libre');
  ok(!R.grille.pourLesAutres, 'les autres ne voient plus 15:00');
  ok(R.grille.autreHeure, 'les autres voient toujours 16:00 (rien d autre ne bouge)');

  console.log('\n[C][D] Confirmer');
  ok(R.confirmer.autre === 409, 'un autre client ne confirme pas par-dessus le blocage', String(R.confirmer.autre));
  ok(R.confirmer.lui === 201, 'le client qui retient confirme', String(R.confirmer.lui));
  ok(R.confirmer.pistesReservees === R.confirmer.pistesTenues && R.confirmer.pistesTenues === '8', 'sa reservation prend exactement la piste retenue', `${R.confirmer.pistesTenues} -> ${R.confirmer.pistesReservees}`);
  ok(R.confirmer.converti && R.confirmer.enCours === 0, 'le blocage est devenu la reservation, plus rien n est retenu');
  ok(R.confirmer.lignes === 1, 'une seule reservation publique', String(R.confirmer.lignes));

  console.log('\n[E] L echeance');
  ok(R.echeance.minutes === 10 && Math.abs(R.echeance.echeance - 600000) < 5000, 'le blocage dure 10 minutes', `${R.echeance.minutes} min, ${R.echeance.echeance} ms`);
  ok(R.echeance.b === 201 && R.echeance.avant === 409 && R.echeance.juste === 409, 'avant 10 minutes, la place reste retenue');
  ok(R.echeance.apres === 201, 'apres 10 minutes sans confirmation, la place est relibree', String(R.echeance.apres));
  ok(R.echeance.retard === 409 && R.echeance.lignes === 0, 'le client en retard ne passe pas par-dessus celui qui l a reprise', String(R.echeance.retard));

  console.log('\n[F] Remplacer, liberer');
  ok(R.remplacer.change === 201 && R.remplacer.memeJeton && R.remplacer.apresChange === '17:00', 'un nouveau choix remplace l ancien (un seul blocage, a 17:00)', R.remplacer.apresChange);
  ok(R.remplacer.autreA15 === 201, '15:00 est rendu au moment du changement');
  ok(R.remplacer.libere === 200 && R.remplacer.liberees === 1 && R.remplacer.encore === 201, 'liberer rend la place tout de suite');

  console.log('\n[G] Le laser');
  ok(R.laser.a === 201 && R.laser.b === 409, 'un blocage de 20 joueurs occupe l arene : 15 de plus depasseraient les 30 armes', `${R.laser.a}/${R.laser.b} ${R.laser.bMessage}`);
  ok(R.laser.c === 201 && R.laser.d === 409, 'les 10 dernieres armes se prennent, puis plus rien', `${R.laser.c}/${R.laser.d}`);
  ok(R.laser.ailleurs === 201, 'une autre heure reste libre');

  console.log('\n[H] Le plafond par appareil');
  ok(R.plafond.statuts === '201,201,201,429' && R.plafond.code === 'hold_limit', 'trois blocages en cours par appareil, pas un de plus', R.plafond.statuts);
  ok(R.plafond.ailleurs === 201, 'un autre appareil n est pas touche');
  ok(R.plafond.remplace === 201, 'changer un de ses choix reste possible');

  console.log('\n[I] La confirmation renvoyee');
  ok(R.rejeu.une === 201 && R.rejeu.deux === 200 && R.rejeu.rejoue && R.rejeu.memeId, 'renvoyee, elle rend la meme reservation');
  ok(R.rejeu.encore === 409 && R.rejeu.encoreCode === 'already_confirmed', 'un jeton confirme ne retient plus rien', `${R.rejeu.encore} ${R.rejeu.encoreCode}`);
  ok(R.rejeu.ensemble === '200,201' && R.rejeu.ensembleMemeId, 'deux envois simultanes : une reservation, rendue deux fois', R.rejeu.ensemble);
  ok(R.rejeu.lignes === 2, 'deux confirmations distinctes, deux reservations, pas quatre', String(R.rejeu.lignes));

  console.log('\n[J] Le staff');
  ok(R.staff.tenu === 201 && /Aucune piste/.test(R.staff.refus) && LIBERE_A.test(R.staff.refus), 'le staff est refuse sur la piste retenue, et le message dit quand elle se libere', R.staff.refus);
  ok(R.staff.laser === 201 && /Aucune piste/.test(R.staff.refusReel) && !/se libère/.test(R.staff.refusReel), 'une vraie reservation ne promet aucune liberation, meme avec un blocage laser a la meme heure', `${R.staff.laser} ${R.staff.refusReel}`);

  console.log('\n[K] Sans la table');
  ok(R.sansTable.libres && R.sansTable.reserve === 201, 'la grille et la reservation marchent comme avant', `${R.sansTable.libres} ${R.sansTable.reserve} ${R.sansTable.message}`);
  ok(R.sansTable.bloque === 503 && R.sansTable.code === 'hold_unavailable', 'le blocage repond 503, le formulaire continue sans', `${R.sansTable.bloque} ${R.sansTable.code}`);

  console.log('\n[L] Le plan retenu est celui confirme');
  ok(R.planRetenu.tenu === 201 && R.planRetenu.tenues && R.planRetenu.tenues !== R.planRetenu.pistesEcran, 'le blocage prend les pistes libres, pas celles de l ecran deja prises', `${R.planRetenu.pistesEcran} -> ${R.planRetenu.tenues}`);
  ok(R.planRetenu.lui === 201 && R.planRetenu.reservees === R.planRetenu.tenues, 'la confirmation obtient les pistes retenues', `${R.planRetenu.lui} ${R.planRetenu.reservees} ${R.planRetenu.message}`);
  ok(R.planRetenu.courseTenues === '8' && R.planRetenu.course === 201 && R.planRetenu.courseReservees === '8', 'meme quand le moteur choisit une autre piste, prise juste avant le verrou : la piste gardee est obtenue', `${R.planRetenu.courseTenues} -> ${R.planRetenu.course} ${R.planRetenu.courseReservees} ${R.planRetenu.courseMessage}`);

  // --- Contre-epreuves --------------------------------------------------------
  console.log('\n[M] Contre-epreuves (code casse en memoire, le disque n est jamais touche)');
  const CONTRE = [
    { label: 'sans les blocages dans la lecture sous verrou, trois clients prennent la meme piste', de: '  if (options.blocages === false) return reservations;', vers: '  return reservations;', rouge: (r) => r.trois.statuts !== '201,409,409' },
    { label: 'sans le verrou de la journee, deux blocages passent ensemble', de: "async function verifierRessourcesSousVerrou(client, payload, { saufJeton = '', verifierProgramme = null, signatureDemande = '' } = {}) {\n  await lockDate(client, payload.date, payload.centerId);", vers: "async function verifierRessourcesSousVerrou(client, payload, { saufJeton = '', verifierProgramme = null, signatureDemande = '' } = {}) {", rouge: (r) => r.trois.statuts !== '201,409,409' },
    { label: 'sans exclure son propre jeton, le client ne peut plus confirmer', de: '  const valeurs = [centerId, date, empreinteJetonBlocage(saufJeton)];', vers: "  const valeurs = [centerId, date, ''];", rouge: (r) => r.confirmer.lui !== 201 },
    { label: 'sans la conversion, le blocage survit a la reservation', de: '    await convertirBlocage(client, input.holdToken, reservation.id);', vers: '', rouge: (r) => r.confirmer.enCours !== 0 },
    { label: 'sans l echeance de 10 minutes, la place ne revient pas', de: 'const DUREE_BLOCAGE_MINUTES = 10;', vers: 'const DUREE_BLOCAGE_MINUTES = 100000;', rouge: (r) => r.echeance.apres === 409 },
    { label: 'sans le plafond, un appareil retient tout', de: '      if (Number(autres.rows[0] && autres.rows[0].n) >= BLOCAGES_MAX_PAR_APPAREIL) {', vers: '      if (false) {', rouge: (r) => r.plafond.statuts !== '201,201,201,429' },
    { label: 'sans le rejeu, une confirmation renvoyee cree une deuxieme reservation', de: '    if (deja) throw reservationDejaConfirmeeErreur(deja);', vers: '', rouge: (r) => r.rejeu.ensemble !== '200,201' || r.rejeu.encore !== 409 },
    { label: 'sans reprendre le plan retenu, la confirmation perd ses pistes', de: '  const garde = await planDuBlocage(client, saufJeton, payload, signatureDemande);', vers: '  const garde = null;', rouge: (r) => !(r.planRetenu.course === 201 && r.planRetenu.courseReservees === '8') },
    { label: 'sans verifier la cause, une vraie reservation promettrait une liberation', de: '      try { verifier(sansBlocages); blocagesEnCause = true; } catch (autre) { blocagesEnCause = false; }', vers: '      blocagesEnCause = true;', rouge: (r) => /se libère/.test(r.staff.refusReel) || !LIBERE_A.test(r.staff.refus) },
  ];
  for (const c of CONTRE) {
    mutations = [{ fichier: 'lib/database.js', de: c.de, vers: c.vers }];
    let rouge = false;
    let detail = '';
    try {
      const casse = await tout(charger());
      rouge = c.rouge(casse);
    } catch (error) {
      detail = error.message.slice(0, 120);
      rouge = !/ancre absente/.test(error.message);
    }
    mutations = [];
    ok(rouge, `contre-epreuve : ${c.label}`, detail);
  }
  // Le handler : sans lui, la grille publique ignore le jeton du client.
  mutations = [{ fichier: 'api/public-availability.js', de: "    const saufJeton = String(req.headers['x-pinlane-hold'] || '').trim();", vers: "    const saufJeton = '';" }];
  let grilleRouge = false;
  try { grilleRouge = !(await scenarioGrille(charger())).pourLui; } catch (error) { grilleRouge = false; }
  mutations = [];
  ok(grilleRouge, 'contre-epreuve : sans l en-tete, le client ne voit plus ses propres horaires');

  // Le code restaure repasse au vert.
  const restaure = await scenarioTrois(charger());
  ok(restaure.statuts === '201,409,409', 'code restaure : un seul client retient la derniere piste', restaure.statuts);

  if (failures) {
    console.error(`\nslot-holds-check: ${failures} defaut(s).`);
    process.exit(1);
  }
  console.log('\nslot-holds-check: ALL OK (les horaires retenus tiennent, a trois comme a un, et se liberent a l echeance)');
}

if (require.main === module) {
  main().catch((error) => {
    console.error('slot-holds-check: ERREUR', error && (error.stack || error.message || error));
    process.exit(1);
  });
} else {
  // Le banc, pour les gates qui regardent les blocages ailleurs (la console) :
  // la vraie chaine serveur, de la demande publique a la lecture staff-state,
  // sur la base en memoire. Aucune base, aucun envoi.
  module.exports = { charger, semer, retenir, liberer, visite, BOWLING, LASER, reservationLigne, JOUR, base };
}

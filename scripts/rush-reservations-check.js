// LE RUSH : CE QUE LE SERVEUR REPOND QUAND DES CLIENTS ARRIVENT ENSEMBLE (2026-11-05).
//
// Trouve par 50 reservations simultanees, le vrai code sur une COPIE de la base. Aucune piste en double, aucune
// reservation perdue, mais :
//   - des clients sur la meme heure composent le meme plan : le premier passe, le controle sous le verrou refuse les
//     autres, qui lisaient « plus libres » alors que 7 pistes sur 8 l etaient (1 reservation pour 50 clients) ;
//   - l attente d une connexion qui expire (« timeout exceeded when trying to connect ») n etait pas reconnue comme
//     une panne : le client lisait « plus libres », ou le message technique en clair, et personne n etait prevenu.
//
//   [A] L ATTENTE QUI EXPIRE EST UNE PANNE : retenue en 503 hold_unavailable, jamais slot_taken.
//   [B] IDEM A LA CONFIRMATION : 503, la boite de secours et l alerte, jamais « ce creneau a change ».
//   [C] LES HEURES : 503 et une phrase neutre, jamais le message technique.
//   [D] LE PLAN PERIME SE RECOMPOSE : retenue et confirmation repassent par le moteur, avec les nouvelles pistes.
//   [E] LE REJEU EST BORNE : 4 essais au plus, puis le refus d avant.
//   [F] UN BLOCAGE N EST JAMAIS RECOMPOSE : ses pistes lui sont gardees. Un autre refus n est pas rejoue.
//   [G] LE VRAI CONTROLE SOUS LE VERROU marque son refus : sans la marque, le rejeu serait mort.
//   [I] LA MEME HEURE, UNE AUTRE PISTE : la piste du plan vient d etre prise, le client recoit une piste libre, et le
//       plan le dit partout. Un groupe garde des pistes voisines. Le comptoir et un plan en vagues restent refuses.
//   [H] LE POOL : 10 connexions et 8 s de patience, sous le delai de la sonde (10 s).
//
// Zero reseau, zero base : le module 'pg' est remplace AVANT tout require de lib/database.js. Contre-epreuves par
// mutation, compilees en memoire : le disque n est jamais touche.
//
// Usage : node scripts/rush-reservations-check.js
'use strict';
const http = require('http');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const LF = String.fromCharCode(10);
const CRLF = String.fromCharCode(13) + LF;
process.env.DATABASE_URL = 'postgres://gate:gate@127.0.0.1:1/gate';
process.env.STAFF_AUTH_SECRET = 'gate-rush-sans-valeur-0123456789abcdef';
for (const nom of ['RESEND_API_KEY', 'TELEGRAM_JETON', 'TELEGRAM_CHAT', 'DATABASE_POOL_MAX']) delete process.env[nom];

let failures = 0;
function ok(cond, label, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures += 1;
  return cond;
}

// Mutations en memoire.
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

// La base en memoire : le vrai controle sous le verrou y lit une reservation sur la piste 1, de 16:00 a 17:00.
const OCCUPANTE = {
  id: 1, center_id: 'libramont', channel: 'public', name: 'Gate', phone: '+32470000000', email: '', date: '2027-03-06', start_time: '16:00', duration: 1, total_duration: 1,
  get lanes() { return S.occupees; }, pax: 4, status: 'confirmed', validation_status: 'confirmed', base_price: 39, price: 39, type: 'visite', label: 'Votre visite', occasion: '', companions: 0, extras: [],
  notes: '', activity_progress: {}, program: null, ops_plan: null, created_at: new Date(), updated_at: new Date(),
};
class FauxClient {
  async connect() {}
  async end() {}
  on() {}
  release() {}
  async query(sql) {
    const texte = String(sql && sql.text ? sql.text : sql);
    if (/^\s*select\s+\*\s+from\s+reservations/i.test(texte)) return { rows: [{ ...OCCUPANTE, lanes: S.occupees }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  }
}
class FauxPool {
  constructor(options) { this.options = options || {}; }
  async connect() { return new FauxClient(); }
  query(sql) { return new FauxClient().query(sql); }
  on() {}
  async end() {}
}
const pgPath = require.resolve('pg', { paths: [ROOT] });
require.cache[pgPath] = { id: pgPath, filename: pgPath, loaded: true, exports: { Pool: FauxPool, Client: FauxClient, types: { setTypeParser() {} } } };

// Ce que chaque scenario decide.
const S = {};
function remettre() {
  Object.assign(S, {
    occupees: [1],
    plans: 0,
    pistesParTour: [],
    appelsRetenue: [],
    appelsResa: [],
    plan: (n) => ({ price: 39, laneCount: 1, opsPlan: { assignedLanes: [n], resourceBlocks: [] } }),
    retenue: async () => ({ expiresAt: '2027-03-06T15:00:00.000Z', minutes: 10 }),
    resa: async (p) => ({ id: 77, centerId: 'libramont', lanes: p.lanes, status: 'pending', validationStatus: 'confirmed' }),
    held: null,
    dispo: async () => { throw new Error('timeout exceeded when trying to connect'); },
    secours: 0,
    alertes: 0,
  });
}
remettre();
const perime = () => Object.assign(new Error('Ce créneau vient de changer. Merci de relancer la recherche avant de confirmer.'), { refusSousVerrou: true });
const EXPIRE = 'timeout exceeded when trying to connect';

function surcharger(rel, surcharge) {
  const chemin = require.resolve(path.join(ROOT, rel));
  delete require.cache[chemin];
  const reel = require(chemin);
  require.cache[chemin] = { id: chemin, filename: chemin, loaded: true, exports: { ...reel, ...surcharge } };
}
// Charge les gestionnaires avec des mutations eventuelles : tout ce qui depend d elles est recompile.
function charger(actives = []) {
  mutations = actives;
  for (const rel of ['lib/database.js', 'lib/demande-publique.js', 'lib/reservation-ops.js', 'api/public-reservations.js', 'api/public-availability.js']) {
    delete require.cache[require.resolve(path.join(ROOT, rel))];
  }
  const vraieBase = require(path.join(ROOT, 'lib/database.js'));
  surcharger('lib/database.js', {
    createSlotHold: (p) => { S.appelsRetenue.push(p.lanes); return S.retenue(p); },
    createReservation: (p) => { S.appelsResa.push(p.lanes); return S.resa(p); },
    readMatchingSlotHold: async () => S.held,
    readUpsellSlotHold: async () => null,
    reservationDejaConfirmee: async () => null,
    readAvailabilitySnapshot: (...a) => S.dispo(...a),
    readStaffState: (...a) => S.dispo(...a),
  });
  surcharger('lib/rate-limit.js', { enforceRateLimit: () => false });
  surcharger('lib/demande-publique.js', { ouvrirDemandePublique: async () => ({ ok: true }) });
  surcharger('lib/reservation-request.js', { normalizeReservationRequest: (b) => ({ ...b, channel: 'public', program: { items: [] } }) });
  surcharger('lib/reservation-ops.js', {
    prepareReservationOps: async () => { S.plans += 1; return S.plan(S.plans); },
    afterReservationCreated: async () => ({ communications: [], warnings: [] }),
    dotationDepassee: () => '',
  });
  surcharger('lib/audit-log.js', { writeAuditLog: async () => ({}) });
  surcharger('lib/garde-alertes.js', { alerter: async () => { S.alertes += 1; } });
  surcharger('lib/secours-envoi.js', { transmettreEnPanne: async () => { S.secours += 1; return false; } });
  surcharger('lib/reservation-alternatives.js', { findReservationAlternatives: async () => [] });
  const reservations = require(path.join(ROOT, 'api/public-reservations.js'));
  const availability = require(path.join(ROOT, 'api/public-availability.js'));
  mutations = [];
  return { reservations, availability, vraieBase };
}

async function servir(g, fn) {
  const serveur = http.createServer((rq, rs) => {
    if (rq.url.startsWith('/api/public-availability')) { g.availability(rq, rs); return; }
    g.reservations(rq, rs);
  });
  await new Promise((r) => serveur.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${serveur.address().port}`;
  try { return await fn(base); } finally { await new Promise((r) => serveur.close(r)); }
}
const CORPS = { centerId: 'libramont', date: '2027-03-06', startTime: '16:00', pax: 4, name: 'Gate', phone: '+32470000000', email: 'gate@example.com', lanes: [1] };
async function poster(base, chemin, corps = CORPS) {
  const r = await fetch(base + chemin, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corps) });
  return { code: r.status, json: await r.json().catch(() => ({})) };
}
const RETENUE = '/api/public-reservations?action=hold';
const CONFIRMATION = '/api/public-reservations';

(async () => {
  const g = charger();
  await servir(g, async (base) => {
    // [A]
    remettre();
    S.retenue = async () => { throw new Error(EXPIRE); };
    const a = await poster(base, RETENUE);
    ok(a.code === 503 && a.json.code === 'hold_unavailable', '[A] l attente qui expire, a la retenue : une panne, le formulaire continue sans blocage', `${a.code} ${a.json.code}`);
    ok(!/plus libres/.test(a.json.message || ''), '[A] jamais « plus libres » pour une panne', a.json.message);

    // [B]
    remettre();
    S.resa = async () => { throw new Error(EXPIRE); };
    const b = await poster(base, CONFIRMATION);
    ok(b.code === 503, '[B] l attente qui expire, a la confirmation : 503', `${b.code}`);
    ok(!/changer|timeout/.test(b.json.message || ''), '[B] ni « ce creneau a change » ni le message technique', b.json.message);
    ok(S.secours === 1 && S.alertes === 1, '[B] la boite de secours et l alerte sont prevenues', `secours ${S.secours} alertes ${S.alertes}`);

    // [C]
    remettre();
    const q = new URLSearchParams({ centerId: 'libramont', date: '2027-03-06', pax: '4', type: 'visite', program: JSON.stringify([{ activityId: 'bowling', duration: 1 }]) });
    const c = await fetch(`${base}/api/public-availability?${q}`);
    const cj = await c.json().catch(() => ({}));
    ok(c.status === 503 && !/timeout/.test(cj.message || ''), '[C] les heures : 503 et une phrase neutre', `${c.status} ${cj.message}`);

    // [D]
    remettre();
    let tour = 0;
    S.retenue = async () => { tour += 1; if (tour === 1) throw perime(); return { expiresAt: 'x', minutes: 10 }; };
    const d1 = await poster(base, RETENUE);
    ok(d1.code === 201 && S.plans === 2, '[D] retenue : le plan perime se recompose, le client a sa place', `${d1.code}, ${S.plans} plans`);
    ok(JSON.stringify(S.appelsRetenue) === '[[1],[2]]', '[D] retenue : le second essai prend les pistes du nouveau plan', JSON.stringify(S.appelsRetenue));
    remettre();
    tour = 0;
    S.resa = async (p) => { tour += 1; if (tour === 1) throw perime(); return { id: 77, centerId: 'libramont', lanes: p.lanes, status: 'pending', validationStatus: 'confirmed' }; };
    const d2 = await poster(base, CONFIRMATION);
    ok(d2.code === 201 && S.plans === 2 && d2.json.reservation && d2.json.reservation.lanes[0] === 2, '[D] confirmation : idem, sur la piste du nouveau plan', `${d2.code}, ${S.plans} plans`);

    // [E]
    remettre();
    S.retenue = async () => { throw perime(); };
    const e1 = await poster(base, RETENUE);
    ok(e1.code === 409 && e1.json.code === 'slot_taken' && S.appelsRetenue.length === 4, '[E] retenue : 4 essais au plus, puis le refus d avant', `${e1.code} ${e1.json.code}, ${S.appelsRetenue.length} essais`);
    remettre();
    S.resa = async () => { throw perime(); };
    const e2 = await poster(base, CONFIRMATION);
    ok(e2.code >= 400 && e2.code < 500 && S.appelsResa.length === 4, '[E] confirmation : 4 essais au plus', `${e2.code}, ${S.appelsResa.length} essais`);

    // [F]
    remettre();
    S.held = { opsPlan: { resourceBlocks: [], assignedLanes: [5] }, lanes: [5], price: 39, startTime: '16:00' };
    S.resa = async () => { throw perime(); };
    const f1 = await poster(base, CONFIRMATION);
    ok(S.appelsResa.length === 1 && S.plans === 0, '[F] une demande qui tient un blocage n est jamais recomposee', `${f1.code}, ${S.appelsResa.length} essai, ${S.plans} plan`);
    remettre();
    S.retenue = async () => { throw new Error('Ce centre n est pas encore ouvert aux réservations.'); };
    await poster(base, RETENUE);
    ok(S.appelsRetenue.length === 1, '[F] un autre refus n est pas rejoue', `${S.appelsRetenue.length} essai`);
  });

  // [G] le vrai controle, sans surcharge : une reservation occupe la piste 1 a 16:00.
  const bloc = { resourceType: 'bowling_lane', activityId: 'bowling', lanes: [1], requiredLanes: 1, start: 960, end: 1020, startTime: '16:00', endTime: '17:00', players: 4 };
  const DEMANDE = { centerId: 'libramont', channel: 'public', date: '2027-03-06', startTime: '16:00', duration: 1, totalDuration: 1, pax: 4, type: 'bowling', label: 'Votre visite', laneCount: 1, lanes: [1], requiresLanes: true, price: 39, basePrice: 39, opsPlan: { assignedLanes: [1], resourceBlocks: [bloc], timeline: [{ activityId: 'bowling', start: 960, end: 1020, lanes: [1] }] } };
  const retenir = (vraieBase, demande) => vraieBase.createSlotHold(demande, { jeton: vraieBase.nouveauJetonBlocage() }).then((v) => ({ v }), (e) => ({ e }));
  const verifierG = async (vraieBase) => {
    S.occupees = [1, 2, 3, 4, 5, 6, 7, 8];
    return (await retenir(vraieBase, DEMANDE)).e;
  };
  const eg = await verifierG(g.vraieBase);
  ok(eg && eg.refusSousVerrou === true, '[G] le vrai controle sous le verrou marque son refus, toutes les pistes prises', eg ? String(eg.message).slice(0, 60) : 'aucun refus');

  // [I]
  S.occupees = [1];
  const i1 = await retenir(g.vraieBase, DEMANDE);
  ok(i1.v && JSON.stringify(i1.v.lanes) === '[2]', '[I] la piste du plan vient d etre prise : la suivante, au lieu d un refus', i1.v ? JSON.stringify(i1.v.lanes) : String(i1.e && i1.e.message).slice(0, 80));
  const plan1 = i1.v && i1.v.opsPlan;
  ok(plan1 && JSON.stringify(plan1.assignedLanes) === '[2]' && JSON.stringify(plan1.resourceBlocks[0].lanes) === '[2]' && JSON.stringify(plan1.timeline[0].lanes) === '[2]', '[I] le plan dit la nouvelle piste partout : resume, bloc, chronologie');
  S.occupees = [1, 2, 4];
  const i2 = await retenir(g.vraieBase, { ...DEMANDE, pax: 8, laneCount: 2, lanes: [1, 2], opsPlan: { assignedLanes: [1, 2], resourceBlocks: [{ ...bloc, lanes: [1, 2], requiredLanes: 2, players: 8 }] } });
  ok(i2.v && JSON.stringify(i2.v.lanes) === '[5,6]', '[I] un groupe garde des pistes voisines', i2.v ? JSON.stringify(i2.v.lanes) : String(i2.e && i2.e.message).slice(0, 80));
  S.occupees = [1, 2, 3, 4, 5, 6, 7];
  const i3 = await retenir(g.vraieBase, { ...DEMANDE, pax: 8, laneCount: 2, lanes: [1, 2], opsPlan: { assignedLanes: [1, 2], resourceBlocks: [{ ...bloc, lanes: [1, 2], requiredLanes: 2, players: 8 }] } });
  ok(i3.e && i3.e.refusSousVerrou === true, '[I] pas assez de pistes libres : le refus reste', i3.e ? '' : 'accepte');
  S.occupees = [1];
  const vagues = [{ ...bloc, lanes: [1], groupWaveCount: 2, groupWaveIndex: 1 }, { ...bloc, lanes: [2], start: 1020, end: 1080, startTime: '17:00', endTime: '18:00', groupWaveCount: 2, groupWaveIndex: 2 }];
  const i4 = await retenir(g.vraieBase, { ...DEMANDE, lanes: [1, 2], laneCount: 2, pax: 8, opsPlan: { assignedLanes: [1, 2], resourceBlocks: vagues } });
  ok(i4.e && i4.e.refusSousVerrou === true, '[I] un plan en vagues garde ses pistes : c est au moteur de le recomposer', i4.e ? '' : 'accepte');
  const comptoir = await g.vraieBase.createReservation({ ...DEMANDE, channel: 'staff', name: 'Gate', phone: '+32470000000' }).then(() => null, (e) => e);
  ok(comptoir && /vient de changer/.test(comptoir.message), '[I] le comptoir n est jamais deplace en silence', comptoir ? String(comptoir.message).slice(0, 70) : 'accepte');

  // [H]
  const options = g.vraieBase.getPool().options;
  ok(Number(options.max) === 10, '[H] 10 connexions par defaut', `${options.max}`);
  ok(Number(options.connectionTimeoutMillis) === 8000 && options.connectionTimeoutMillis < 10000, '[H] 8 s de patience, sous le delai de la sonde', `${options.connectionTimeoutMillis}`);

  // CONTRE-EPREUVES : chaque regle retiree, son controle rougit.
  console.log('\ncontre-epreuves');
  const m1 = charger([{ fichier: 'lib/demande-publique.js', de: '/tuple concurrently|timeout exceeded|', vers: '/tuple concurrently|' }]);
  await servir(m1, async (base) => {
    remettre();
    S.retenue = async () => { throw new Error(EXPIRE); };
    const x = await poster(base, RETENUE);
    ok(x.code === 409 && x.json.code === 'slot_taken', 'sans la regle : l ancien « plus libres » revient', `${x.code} ${x.json.code}`);
  });
  const m2 = charger([{ fichier: 'api/public-reservations.js', de: 'Boolean(error && error.refusSousVerrou) && essai < ESSAIS_SOUS_VERROU', vers: 'false && essai < ESSAIS_SOUS_VERROU' }]);
  await servir(m2, async (base) => {
    remettre();
    S.retenue = async () => { throw perime(); };
    const x = await poster(base, RETENUE);
    ok(x.code === 409 && S.appelsRetenue.length === 1, 'sans le rejeu : un seul essai, le client est refuse', `${S.appelsRetenue.length} essai`);
  });
  const m3 = charger([{ fichier: 'lib/database.js', de: '    error.refusSousVerrou = true;\n', vers: '' }]);
  const em3 = await verifierG(m3.vraieBase);
  ok(em3 && !em3.refusSousVerrou, 'sans la marque : le controle [G] la voit manquer');
  const m4 = charger([{ fichier: 'lib/database.js', de: "!garde && payload.channel === 'public');", vers: 'false);' }]);
  S.occupees = [1];
  const em4 = await retenir(m4.vraieBase, DEMANDE);
  ok(em4.e && /vient de changer/.test(em4.e.message), 'sans le rechange : l ancien refus a tort revient', em4.e ? '' : 'accepte');

  if (failures) { console.error(`\nrush-reservations-check: ${failures} FAIL`); process.exit(1); }
  console.log('\nrush-reservations-check: ALL OK');
  process.exit(0);
})().catch((e) => { console.error('ERREUR', e && e.stack ? e.stack.slice(0, 800) : e); process.exit(1); });

// LES PLAFONDS DU COMPTOIR SONT LEVES, CEUX DU TUNNEL NE BOUGENT PAS (gate ne
// le 2026-10-08, regle S1 de la fenetre Reserver).
//
// Movsar : « on est le staff, on doit pouvoir faire ce qu on veut ». Au
// comptoir, et seulement au comptoir (le canal pose par l API, jamais le corps
// de la demande) :
//   [1] une visite prend de 1 a 12 parties de laser ; 13 est refuse avec une
//       phrase qui dit la borne ;
//   [2] une visite prend un bowling de 30 min a 6 h, par demi-heure ; 6 h 30
//       ou 1 h 45 sont refuses avec la borne ;
//   [3] un laser seul pose TOUTES ses parties, et chacune compte : la base
//       refuse un second groupe sur l arene pleine de la 2e partie ;
//   [4] un bowling seul garde le nombre de pistes demande au-dessus du minimum,
//       borne au parc du centre ;
//   [5] le tunnel public rend MOT POUR MOT ce qu il rendait avant ce lot :
//       les sorties ci-dessous ont ete relevees en executant le code de
//       14388e3 (avant la fenetre) sur les memes demandes ;
//   [6] contre-preuves par mutation.
//
// Zero reseau, zero base (le moteur lit une journee fournie par le gate).
// Lancement : node scripts/reserver-plafonds-check.js
'use strict';
const path = require('path');
const Module = require('module');

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://gate:gate@127.0.0.1:1/gate';
process.env.PINLANE_CALENDAR_SYNC = 'off';

const ROOT = path.resolve(__dirname, '..');
const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
const LF = String.fromCharCode(10);

let failures = 0;
function ok(cond, label, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures += 1;
  return cond;
}

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

function charger() {
  for (const cle of Object.keys(require.cache)) {
    if (cle.startsWith(ROOT) && !cle.includes(`${path.sep}node_modules${path.sep}`) && cle !== __filename) delete require.cache[cle];
  }
  return {
    requete: require(path.join(ROOT, 'lib/reservation-request.js')),
    ops: require(path.join(ROOT, 'lib/reservation-ops.js')),
    db: require(path.join(ROOT, 'lib/database.js')),
  };
}

// Un samedi a venir, hors vacances et feries (scripts/jour-de-test.js) : le
// moteur refuse une date passee, et [5] a ete releve un samedi hors vacances.
const JOUR = require('./jour-de-test').jourDeTest({ jour: 6 });
const VIDE = async () => ({ reservations: [], laneStatuses: {} });
const BASE = { centerId: 'libramont', date: JOUR, name: 'Plafonds', phone: '0470', email: 'a@b.be', startTime: '15:00', pax: 4 };

// Une demande, sur le chemin exact de l API : normalisation puis moteur.
async function preparer(M, canal, corps, readState = VIDE) {
  const request = M.requete.normalizeReservationRequest(corps, { channel: canal, centerId: 'libramont' });
  const ops = await M.ops.prepareReservationOps(request, canal, { readState });
  return { request, ops, dossier: { ...request, ...ops } };
}

// La sortie d une demande, dans la forme relevee sur 14388e3.
async function sortie(M, canal, corps) {
  try {
    const { ops, dossier: d } = await preparer(M, canal, corps);
    const blocs = ((d.opsPlan && d.opsPlan.resourceBlocks) || []).map((b) => `${b.resourceType === 'laser_arena' ? 'L' : 'B'}${b.countIndex || 1}@${b.startTime}${(b.lanes || []).length ? 'p' + b.lanes.join('+') : ''}${b.manualLaserPass ? 'm' : ''}`).join(' ');
    const items = ((d.program && d.program.items) || []).map((it) => `${it.activityId}:${it.games || it.duration || ''}=${it.price}`).join(' ');
    return `ok type=${d.type} prix=${d.price} base=${d.basePrice} duree=${d.duration} parties=${d.laserGames || ''} dispo=${ops.planAvailable} refus=${ops.planRefusal || ''} alerte=${ops.planWarning || ''} prog=[${items}] blocs=[${blocs}]`;
  } catch (e) {
    return `ERREUR ${e.statusCode || ''} ${e.message}`;
  }
}

// [5] Le tunnel, releve sur 14388e3 (sonde executee le 2026-10-08 sur
// l arbre `git archive 14388e3`, memes demandes, journee vide).
const TUNNEL_AVANT = [
  ['visite laser 4 parties', { ...BASE, type: 'visite', program: [{ activityId: 'laser_game', games: 4, participants: 4 }], preference: { preferredTimes: { laser_game: '15:00' }, laserGameTimes: [], laserPlacement: 'scheduled' } },
    'ERREUR 422 Nombre de parties indisponible. Choisissez une option proposée.'],
  ['visite laser 13 parties', { ...BASE, type: 'visite', program: [{ activityId: 'laser_game', games: 13, participants: 4 }] },
    'ERREUR 422 Nombre de parties indisponible. Choisissez une option proposée.'],
  ['visite bowling 2 h 30', { ...BASE, type: 'visite', program: [{ activityId: 'bowling', duration: 2.5, participants: 4 }] },
    'ERREUR 422 Durée indisponible pour cette activité. Choisissez une durée proposée.'],
  ['visite bowling 1 h 45', { ...BASE, type: 'visite', program: [{ activityId: 'bowling', duration: 1.75, participants: 4 }] },
    'ERREUR 422 Durée indisponible pour cette activité. Choisissez une durée proposée.'],
  ['visite bowling 1 h', { ...BASE, type: 'visite', program: [{ activityId: 'bowling', duration: 1, participants: 4 }], preference: { preferredTimes: { bowling: '15:00' } } },
    'ok type=bowling prix=39 base=39 duree=1 parties= dispo=true refus= alerte= prog=[bowling:1=39] blocs=[B1@15:00p1]'],
  ['laser seul 4 parties', { ...BASE, type: 'laser', laserGames: 4, duration: 2 },
    'ok type=laser prix=100 base=100 duree=1.5 parties=3 dispo=true refus= alerte= prog=[] blocs=[L1@15:00]'],
  ['laser seul 3 parties', { ...BASE, type: 'laser', laserGames: 3, duration: 1.5 },
    'ok type=laser prix=100 base=100 duree=1.5 parties=3 dispo=true refus= alerte= prog=[] blocs=[L1@15:00]'],
  ['bowling seul 2 h 30', { ...BASE, type: 'bowling', duration: 2.5, totalDuration: 2.5 },
    'ERREUR  Durée indisponible pour cette activité. Choisissez une durée proposée.'],
  ['bowling seul 4 joueurs, 3 pistes demandees', { ...BASE, type: 'bowling', duration: 1, totalDuration: 1, laneCount: 3 },
    'ok type=bowling prix=39 base=39 duree=1 parties= dispo=true refus= alerte= prog=[] blocs=[B1@15:00p1]'],
];

async function mesurer() {
  const M = charger();
  const f = {};
  // [1] et [2] : le programme du comptoir.
  f.parties = [];
  for (let n = 0; n <= 13; n += 1) {
    try {
      const r = M.requete.normalizeReservationRequest({ ...BASE, type: 'visite', program: [{ activityId: 'laser_game', games: n || '0', participants: 4 }] }, { channel: 'staff', centerId: 'libramont' });
      f.parties.push(`${n}:${r.program.items[0].games}`);
    } catch (e) { f.parties.push(`${n}:refus(${e.message})`); }
  }
  f.durees = [];
  for (const h of [0.25, 0.5, 1, 1.5, 1.75, 2, 2.5, 3, 4.5, 6, 6.5]) {
    try {
      const r = M.requete.normalizeReservationRequest({ ...BASE, type: 'visite', program: [{ activityId: 'bowling', duration: h, participants: 4 }] }, { channel: 'staff', centerId: 'libramont' });
      f.durees.push(`${h}:${r.program.items[0].duration}`);
    } catch (e) { f.durees.push(`${h}:refus(${e.message})`); }
  }
  // [3] Le laser seul du comptoir : 20 joueurs, 2 parties a 15:00, puis un
  // second groupe de 20 a 15:30, l heure de la 2e partie du premier.
  const premier = await preparer(M, 'staff', { ...BASE, type: 'laser', pax: 20, laserGames: 2, duration: 1, startTime: '15:00' });
  f.laserBlocs = (premier.dossier.opsPlan.resourceBlocks || []).filter((b) => b.resourceType === 'laser_arena')
    .map((b) => `${b.countIndex}@${b.startTime}${b.manualLaserPass ? 'm' : ''}`).join(' ');
  const quatre = await preparer(M, 'staff', { ...BASE, type: 'laser', pax: 4, laserGames: 4, duration: 2 });
  f.quatreBlocs = (quatre.dossier.opsPlan.resourceBlocks || []).filter((b) => b.resourceType === 'laser_arena').length;
  f.quatrePrix = `${quatre.dossier.basePrice}|${quatre.dossier.price}|${quatre.dossier.laserGames}`;
  const enBase = { ...premier.dossier, id: 7001, status: 'confirmed', lanes: [] };
  const second = await preparer(M, 'staff', { ...BASE, type: 'laser', pax: 20, laserGames: 1, duration: 0.5, startTime: '15:30' },
    async () => ({ reservations: [enBase], laneStatuses: {} }));
  f.secondMoteur = second.ops.planAvailable === false ? `refus: ${second.ops.planRefusal}` : 'accepte';
  try {
    M.db.validateReservationResources({ ...second.dossier, name: 'Second', phone: '0470' }, [enBase], {}, [], JOUR);
    f.secondBase = 'accepte';
  } catch (e) { f.secondBase = `refus: ${e.message}`; }
  // [4] Le nombre de pistes d un bowling seul du comptoir.
  const pistes = async (pax, laneCount) => {
    const r = await preparer(M, 'staff', { ...BASE, type: 'bowling', pax, duration: 1, totalDuration: 1, laneCount, lanes: [] });
    return ((r.dossier.opsPlan && r.dossier.opsPlan.resourceBlocks) || []).filter((b) => b.resourceType === 'bowling_lane').flatMap((b) => b.lanes || []).length;
  };
  f.pistes = `${await pistes(4, 3)},${await pistes(4, 20)},${await pistes(12, 1)}`;
  // [5] Le tunnel.
  f.tunnel = [];
  for (const [nom, corps] of TUNNEL_AVANT) f.tunnel.push([nom, await sortie(M, 'public', corps)]);
  return f;
}

function verifier(f, afficher = true) {
  const notes = [];
  const v = (cond, label) => notes.push([Boolean(cond), label]);
  const partiesOk = f.parties.slice(1, 13).every((x, i) => x === `${i + 1}:${i + 1}`);
  v(partiesOk, `[1] la visite du comptoir prend 1 a 12 parties (${f.parties.slice(1, 13).join(' ')})`);
  v(/^13:refus\(Nombre de parties indisponible : de 1 à 12 parties\.\)$/.test(f.parties[13]) && /^0:refus/.test(f.parties[0]),
    `[1] 13 parties et 0 partie refusees, la borne dite (${f.parties[13]})`);
  const durees = Object.fromEntries(f.durees.map((x) => [x.split(':')[0], x.split(':').slice(1).join(':')]));
  v(['0.5', '1', '1.5', '2', '2.5', '3', '4.5', '6'].every((h) => durees[h] === h),
    `[2] le bowling du comptoir va de 30 min a 6 h par demi-heure (${['0.5', '2.5', '4.5', '6'].map((h) => `${h}=${durees[h]}`).join(' ')})`);
  v(['0.25', '1.75', '6.5'].every((h) => durees[h] === 'refus(Durée indisponible : de 30 min à 6 h, par demi-heure.)'),
    `[2] 15 min, 1 h 45 et 6 h 30 refuses avec la borne (${durees['6.5']})`);
  v(f.laserBlocs === '1@15:00 2@15:30m', `[3] le laser seul pose ses 2 parties, la 2e comptee (${f.laserBlocs})`);
  v(f.quatreBlocs === 4 && f.quatrePrix === '140|140|4', `[3] 4 parties : 4 departs, 35 EUR par joueur (${f.quatreBlocs} departs, base|prix|parties ${f.quatrePrix})`);
  v(/^refus: /.test(f.secondMoteur), `[3] le moteur voit l arene pleine de la 2e partie (${f.secondMoteur})`);
  v(/Laser Game complet sur ce créneau \(40\/30 joueurs/.test(f.secondBase), `[3] la base refuse le second groupe (${f.secondBase})`);
  v(f.pistes === '3,8,2', `[4] pistes du bowling seul : 3 demandees -> 3, 20 -> le parc (8), 1 pour 12 joueurs -> le minimum (2) : ${f.pistes}`);
  TUNNEL_AVANT.forEach(([nom, , attendu]) => {
    const mesure = (f.tunnel.find(([n]) => n === nom) || [])[1];
    v(mesure === attendu, `[5] tunnel, ${nom} : identique a 14388e3${mesure === attendu ? '' : ` (mesure « ${mesure} »)`}`);
  });
  if (afficher) notes.forEach(([cond, label]) => ok(cond, label));
  return notes;
}

async function contrePreuve(nom, mutation, attendu) {
  mutations = [mutation];
  let rouges = [];
  try {
    rouges = verifier(await mesurer(), false).filter(([cond]) => !cond).map(([, l]) => l);
  } catch (error) {
    mutations = [];
    ok(!/ancre absente/.test(error.message), `contre-preuve « ${nom} » : le gate ROUGIT`, `exception : ${error.message.slice(0, 160)}`);
    return;
  }
  mutations = [];
  const trouve = rouges.find((l) => attendu.test(l));
  ok(Boolean(trouve), `contre-preuve « ${nom} » : le gate ROUGIT`, (trouve || `aucune attendue, ${rouges.length} rouge(s)`).slice(0, 170));
}

(async () => {
  try {
    console.log('\n[1-5] LES PLAFONDS DU COMPTOIR, LE TUNNEL INCHANGE');
    verifier(await mesurer());
    console.log('\n[6] CONTRE-PREUVES PAR MUTATION');
    await contrePreuve('la visite du comptoir garde la grille du tunnel',
      { fichier: 'lib/visit-program.js', de: '  const auComptoir = staff && Number.isInteger(Number(value)) ? optionLaserAuPalier(LASER_GAME_OPTIONS, Number(value)) : null;', vers: '  const auComptoir = null;' },
      /\[1\] la visite du comptoir prend 1 a 12 parties/);
    await contrePreuve('le laser seul du comptoir ne pose que sa 1re partie',
      { fichier: 'lib/ops-engine.js', de: "  const toutesLesParties = input.channel === 'staff';", vers: '  const toutesLesParties = false;' },
      /\[3\] le laser seul pose ses 2 parties/);
    await contrePreuve('le nombre de pistes voulu est ignore',
      { fichier: 'lib/ops-engine.js', de: "  const demandees = input.channel === 'staff' ? Math.trunc(Number(input.laneCount) || 0) : 0;", vers: '  const demandees = 0;' },
      /\[4\] pistes du bowling seul/);
    await contrePreuve('le plafond leve fuit vers le tunnel',
      { fichier: 'lib/ops-engine.js', de: "  const demandees = input.channel === 'staff' ? Math.trunc(Number(input.laneCount) || 0) : 0;", vers: '  const demandees = Math.trunc(Number(input.laneCount) || 0);' },
      /\[5\] tunnel, bowling seul 4 joueurs, 3 pistes demandees/);
  } catch (error) {
    console.error('\nreserver-plafonds-check ERREUR', error.stack || error.message);
    failures += 1;
  }
  if (failures) { console.error(`\nreserver-plafonds-check: ${failures} FAIL`); process.exit(1); }
  console.log('\nreserver-plafonds-check: ALL OK - le comptoir vend 12 parties et 6 h, le tunnel rend ce qu il rendait.');
  process.exit(0);
})();

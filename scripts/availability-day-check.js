// Gate du VERDICT PUBLIC DU JOUR (cle `day` de api/public-booking-meta.js).
//
// Pourquoi ce gate existe : jusqu'ici AUCUN script ne require ce module, ils le
// mockent tous (16 gates renvoient {ok:true, formules:[], center:null}). Le
// payload public n'avait donc aucun contrat verifie, et le client annoncait
// "Ouvert 14h - 22h" un jour ou le cockpit avait ferme le centre.
//
// Zero reseau, zero base : 'pg' est remplace dans require.cache AVANT tout
// require applicatif (motif de scripts/availability-blocks-check.js). Le faux
// pool OBEIT AU TEXTE SQL pour availability_blocks.
//
// CE QUE CE GATE PROUVE (comportement, pas presence de chaine) :
//   1. Sans blocage, `day` decrit exactement la grille hebdo historique.
//   2. center jour entier  => open:false + 'Fermé exceptionnellement ce jour'.
//   3. center de plage     => open:true  + closedWindows bornees et fusionnees.
//   4. formula jour entier => id dans unavailableFormulaIds, reason 'formula'.
//   5. laser_game bloque   => f1 (ancre laser) grisee, reason 'laser_game' ;
//      f3 (ancre bowling seule) INTACTE.
//   6. activityAvailability.bowling === false => 'bowling' dans
//      unavailableActivityIds, et les formules a ancre bowling grisees.
//   7. Grille fermee (lundi) => 'Fermé ce jour' ; date passee => 'Date passée'.
//   8. CONTRAT HTTP : sans parametre date, la reponse est STRICTEMENT celle
//      d'avant (cle 'day' absente) ; avec date, la cle apparait.
//   9. CONTRAT DE FUITE : aucune ligne brute de availability_blocks ne sort.
//      Ni reason, ni createdBy, ni id, ni scope 'lane'.
//  10. Isolation multi-tenant : un blocage pose sur un autre centre n'entre pas.
//   + 3 contre-preuves par MUTATION (edition inverse, jamais git checkout).
//
// Lancement : node scripts/availability-day-check.js

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;
function ok(cond, label) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`);
  if (!cond) failures += 1;
  return cond;
}

// ---------------------------------------------------------------------------
// Dates de reference (verifiees ci-dessous). Toutes FUTURES pour que le verdict
// "Date passée" ne masque pas les autres cas.
// ---------------------------------------------------------------------------
const MON = '2026-08-31'; // lundi : grille hebdo fermee (getSchedule -> null)
const TUE = '2026-09-01'; // mardi : 14h - 22h
const WED = '2026-09-02'; // mercredi : 12h - 22h
const PAST = '2020-01-02'; // date passee

// ---------------------------------------------------------------------------
// Faux pool pg : sert availability_blocks depuis un store en memoire.
// ---------------------------------------------------------------------------
const store = { blockRows: [] };

class FakePool {
  constructor(options = {}) { this.options = options; }

  async query(text, params = []) {
    const sql = String(text);
    if (/^\s*(begin|commit|rollback|savepoint)/i.test(sql)) return { rows: [], rowCount: 0 };
    if (/from availability_blocks/i.test(sql)) {
      const center = params[0];
      const rows = store.blockRows.filter((row) => row.center_id === center);
      return { rows, rowCount: rows.length };
    }
    return { rows: [], rowCount: 0 };
  }

  async connect() {
    const self = this;
    return { query: (t, p) => self.query(t, p), release() {} };
  }

  async end() {}
}

const pgPath = require.resolve('pg');
require.cache[pgPath] = { id: pgPath, filename: pgPath, loaded: true, exports: { Pool: FakePool } };
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake/fake';
process.env.DATABASE_SSL = 'disable';

const ab = require('../lib/availability-blocks');
const { getCenter } = require('../lib/ops-knowledge');
const { getSchedule } = require('../lib/booking-config');
const apiPath = require.resolve('../api/public-booking-meta');
let api = require('../api/public-booking-meta');

const CENTER = getCenter('libramont');

// ---------------------------------------------------------------------------
// Fabriques (forme des lignes SQL, snake_case, comme pg).
// ---------------------------------------------------------------------------
function rawBlock(patch = {}) {
  return {
    id: patch.id === undefined ? 1 : patch.id,
    center_id: patch.center_id || 'libramont',
    scope_type: patch.scope_type,
    scope_ref: patch.scope_ref === undefined ? null : patch.scope_ref,
    recurrence: patch.recurrence || 'once',
    date: patch.date === undefined ? null : patch.date,
    day_of_week: patch.day_of_week === undefined ? null : patch.day_of_week,
    date_from: patch.date_from === undefined ? null : patch.date_from,
    date_until: patch.date_until === undefined ? null : patch.date_until,
    start_time: patch.start_time === undefined ? null : patch.start_time,
    end_time: patch.end_time === undefined ? null : patch.end_time,
    reason: patch.reason || '',
    created_by: patch.created_by || '',
  };
}

function normBlocks(rows) {
  return rows.map(ab.normalizeBlockRow);
}

// Verdict construit par le VRAI code de l'endpoint (fonction exposee __test).
function day(blocks, dateISO, centerPatch = null) {
  const centerDoc = centerPatch ? { ...CENTER, ...centerPatch } : CENTER;
  return api.__test.buildDayStatus(blocks, dateISO, centerDoc, 'libramont');
}

// ---------------------------------------------------------------------------
// Faux req/res pour appeler le VRAI handler HTTP.
// ---------------------------------------------------------------------------
let ipSeq = 0;
async function callApi(query, handler = api) {
  ipSeq += 1;
  const ip = `10.0.0.${ipSeq % 250}`;
  const req = {
    method: 'GET',
    url: `/api/public-booking-meta${query}`,
    headers: { host: 'localhost', 'x-forwarded-for': ip },
    socket: { remoteAddress: ip },
  };
  const res = { statusCode: 0, headers: {}, body: '' };
  res.setHeader = (key, value) => { res.headers[key] = value; };
  res.end = (chunk) => { res.body = chunk === undefined ? '' : String(chunk); };
  await handler(req, res);
  let payload = {};
  try { payload = JSON.parse(res.body || '{}'); } catch (error) { payload = {}; }
  return { status: res.statusCode, payload, raw: res.body };
}

// Force le rechargement du cache TTL 30 s des blocages entre deux fixtures.
async function setStoreBlocks(rows) {
  store.blockRows = rows.slice();
  const { getPool } = require('../lib/database');
  await ab.refreshAvailabilityBlocks(getPool(), { centerId: 'libramont', force: true });
  await ab.refreshAvailabilityBlocks(getPool(), { centerId: 'gembloux', force: true });
}

(async () => {
  ok(new Date(2026, 7, 31).getDay() === 1, `${MON} est bien un lundi (dow 1)`);
  ok(new Date(2026, 8, 1).getDay() === 2, `${TUE} est bien un mardi (dow 2)`);
  ok(getSchedule(MON, CENTER) === null, `${MON} : la grille hebdo du centre est bien fermee`);
  const tueSchedule = getSchedule(TUE, CENTER);
  ok(tueSchedule && tueSchedule.open === 14 && tueSchedule.close === 22, `${TUE} : grille 14h - 22h (fixture)`);

  // =========================================================================
  console.log('\n[1] SANS blocage : day decrit exactement la grille historique');
  // =========================================================================
  const baseline = day([], TUE);
  ok(baseline.open === true, 'mardi sans blocage : open === true');
  ok(baseline.closedLabel === '', 'mardi sans blocage : aucun libelle de fermeture');
  ok(Array.isArray(baseline.closedWindows) && baseline.closedWindows.length === 0, 'mardi sans blocage : aucune coupure');
  ok(baseline.unavailableFormulaIds.length === 0 && baseline.unavailableActivityIds.length === 0,
    'mardi sans blocage : aucune formule ni activite grisee');
  ok(baseline.schedule && baseline.schedule.open === tueSchedule.open && baseline.schedule.close === tueSchedule.close
    && baseline.schedule.label === tueSchedule.label,
    'day.schedule est EXACTEMENT getSchedule (aucune grille reinventee)');
  ok(baseline.date === TUE, 'day.date fait echo de la date demandee (anti-course cote client)');

  // =========================================================================
  console.log('\n[2] blocage center JOUR ENTIER : open false + libelle exceptionnel');
  // =========================================================================
  const centerFullDay = normBlocks([rawBlock({ scope_type: 'center', date: TUE, reason: 'Privatise Dupont SA', created_by: 'seb@fungalaxy.be' })]);
  const closedDay = day(centerFullDay, TUE);
  ok(closedDay.open === false, 'center bloque jour entier : open === false');
  ok(closedDay.closedLabel === 'Fermé exceptionnellement ce jour', 'libelle FIGE "Fermé exceptionnellement ce jour"');
  ok(closedDay.schedule !== null, 'la grille hebdo reste exposee (le centre ouvre normalement ce jour de semaine)');
  ok(closedDay.closedWindows.length === 0, 'jour ferme : aucune coupure partielle annoncee (le bloc closed suffit)');
  ok(day(centerFullDay, WED).open === true, 'le blocage ponctuel de mardi ne ferme pas mercredi');

  // Un blocage center qui couvre TOUTE l'amplitude ferme aussi la journee.
  const centerFullRange = normBlocks([rawBlock({ scope_type: 'center', date: TUE, start_time: '14:00', end_time: '22:00' })]);
  ok(day(centerFullRange, TUE).open === false, 'plage couvrant toute l amplitude 14-22 : open === false');

  // =========================================================================
  console.log('\n[3] blocage center de PLAGE : open true + closedWindows bornees et fusionnees');
  // =========================================================================
  const cut = day(normBlocks([rawBlock({ scope_type: 'center', date: TUE, start_time: '16:00', end_time: '18:00', reason: 'Panne chauffage' })]), TUE);
  ok(cut.open === true, 'coupure 16-18 sur une journee 14-22 : le centre reste ouvert');
  ok(cut.closedWindows.length === 1 && cut.closedWindows[0].start === '16:00' && cut.closedWindows[0].end === '18:00',
    'closedWindows expose la coupure 16:00 - 18:00');

  const merged = day(normBlocks([
    rawBlock({ id: 1, scope_type: 'center', date: TUE, start_time: '17:00', end_time: '18:00' }),
    rawBlock({ id: 2, scope_type: 'center', date: TUE, start_time: '16:00', end_time: '17:00' }),
  ]), TUE);
  ok(merged.closedWindows.length === 1 && merged.closedWindows[0].start === '16:00' && merged.closedWindows[0].end === '18:00',
    'deux coupures adjacentes (dans le desordre) sont triees ET fusionnees en une seule');

  const bounded = day(normBlocks([rawBlock({ scope_type: 'center', date: TUE, start_time: '08:00', end_time: '15:00' })]), TUE);
  ok(bounded.closedWindows.length === 1 && bounded.closedWindows[0].start === '14:00',
    'une coupure qui deborde avant l ouverture est bornee a l amplitude (14:00)');

  const disjoint = day(normBlocks([
    rawBlock({ id: 1, scope_type: 'center', date: TUE, start_time: '15:00', end_time: '16:00' }),
    rawBlock({ id: 2, scope_type: 'center', date: TUE, start_time: '19:00', end_time: '20:00' }),
  ]), TUE);
  ok(disjoint.closedWindows.length === 2 && disjoint.closedWindows[0].start === '15:00' && disjoint.closedWindows[1].start === '19:00',
    'deux coupures disjointes restent deux entrees, triees');

  // Un blocage de LANE ne produit jamais de coupure centre.
  ok(day(normBlocks([rawBlock({ scope_type: 'lane', scope_ref: '3', date: TUE, start_time: '16:00', end_time: '18:00' })]), TUE).closedWindows.length === 0,
    'un blocage de PISTE ne cree aucune coupure centre (portee respectee)');

  // =========================================================================
  console.log('\n[4] blocage FORMULE jour entier : id grise, motif "formula"');
  // =========================================================================
  const formulaBlocked = day(normBlocks([rawBlock({ scope_type: 'formula', scope_ref: 'f1', date: TUE })]), TUE);
  ok(formulaBlocked.unavailableFormulaIds.includes('f1'), 'f1 bloquee jour entier entre dans unavailableFormulaIds');
  ok(formulaBlocked.unavailableFormulaReason.f1 === 'formula', 'le motif expose est le CODE ferme "formula"');
  ok(!formulaBlocked.unavailableFormulaIds.includes('f3'), 'le blocage de f1 ne grise pas f3 (portee respectee)');
  ok(formulaBlocked.open === true, 'une formule bloquee ne ferme pas le centre');

  // LIMITE ASSUMEE : une PLAGE horaire ne grise rien.
  const formulaRange = day(normBlocks([rawBlock({ scope_type: 'formula', scope_ref: 'f1', date: TUE, start_time: '18:00', end_time: '20:00' })]), TUE);
  ok(formulaRange.unavailableFormulaIds.length === 0,
    'blocage de PLAGE sur f1 : AUCUN grisage (le moteur ne prononce qu un retrait de creneaux)');

  // =========================================================================
  console.log('\n[5] blocage ACTIVITE laser_game jour entier : formules a ancre laser grisees');
  // =========================================================================
  const laserBlocked = day(normBlocks([rawBlock({ scope_type: 'activity', scope_ref: 'laser_game', date: TUE })]), TUE);
  ok(laserBlocked.unavailableActivityIds.includes('laser_game'), 'laser_game entre dans unavailableActivityIds');
  ok(!laserBlocked.unavailableActivityIds.includes('bowling'), 'le bowling reste disponible');
  ok(laserBlocked.unavailableFormulaIds.includes('f1') && laserBlocked.unavailableFormulaReason.f1 === 'laser_game',
    'f1 (ancres bowling + laser) est grisee avec le motif "laser_game"');
  ok(laserBlocked.unavailableFormulaIds.includes('f2') && laserBlocked.unavailableFormulaReason.f2 === 'laser_game',
    'f2 (ancre laser seule) est grisee avec le motif "laser_game"');
  ok(!laserBlocked.unavailableFormulaIds.includes('f3'), 'f3 (ancre bowling seule) N EST PAS grisee');
  ok(!laserBlocked.unavailableFormulaIds.includes('f6'), 'f6 (aucune ancre) N EST PAS grisee (limite assumee, documentee)');
  ok(laserBlocked.open === true, 'une activite bloquee ne ferme pas le centre');

  const laserRange = day(normBlocks([rawBlock({ scope_type: 'activity', scope_ref: 'laser_game', date: TUE, start_time: '18:00', end_time: '20:00' })]), TUE);
  ok(laserRange.unavailableActivityIds.length === 0 && laserRange.unavailableFormulaIds.length === 0,
    'blocage de PLAGE sur laser_game : AUCUN grisage, aucun segment eteint');

  // Activite NON-ancre VENDABLE (playground est propose par Libramont) : elle
  // s'eteint pour le client, sans jamais griser une formule. La "limite assumee"
  // d'avant (aucun verdict) valait tant que ces activites n'etaient pas
  // reservables ; depuis qu'elles le sont, laisser reserver un playground ferme
  // serait le vrai defaut.
  const playgroundBlocked = day(normBlocks([rawBlock({ scope_type: 'activity', scope_ref: 'playground', date: TUE })]), TUE);
  ok(playgroundBlocked.unavailableActivityIds.includes('playground'),
    'activite libre vendable (playground) bloquee : elle entre dans unavailableActivityIds');
  ok(playgroundBlocked.unavailableFormulaIds.length === 0,
    'une activite libre bloquee ne grise AUCUNE formule (le moteur ne depend que des ancres)');
  ok(!playgroundBlocked.unavailableActivityIds.includes('bowling')
    && !playgroundBlocked.unavailableActivityIds.includes('laser_game'),
    'les deux activites planifiees restent disponibles');

  // =========================================================================
  console.log('\n[6] activityAvailability : le on/off permanent remonte enfin au client');
  // =========================================================================
  const bowlingOff = day([], TUE, { activityAvailability: { ...CENTER.activityAvailability, bowling: false } });
  ok(bowlingOff.unavailableActivityIds.includes('bowling'), 'activityAvailability.bowling === false => "bowling" dans unavailableActivityIds');
  ok(bowlingOff.unavailableFormulaIds.includes('f3') && bowlingOff.unavailableFormulaReason.f3 === 'bowling',
    'f3 (ancre bowling) grisee avec le motif "bowling"');
  ok(!bowlingOff.unavailableFormulaIds.includes('f2'), 'f2 (ancre laser seule) reste disponible');
  ok(day([], TUE, { activityAvailability: {} }).unavailableActivityIds.length === 0,
    'sans config activityAvailability : aucune activite eteinte (comportement historique)');

  // =========================================================================
  console.log('\n[7] grille fermee et date passee : libelles figes, jamais le champ reason');
  // =========================================================================
  const monday = day([], MON);
  ok(monday.open === false && monday.schedule === null, 'lundi (grille hebdo fermee) : open false + schedule null');
  ok(monday.closedLabel === 'Fermé ce jour', 'lundi : libelle FIGE "Fermé ce jour"');

  const past = day(normBlocks([rawBlock({ scope_type: 'center', date: PAST })]), PAST);
  ok(past.open === false && past.closedLabel === 'Date passée', 'date passee : open false + libelle "Date passée"');

  // =========================================================================
  console.log('\n[8] CONTRAT HTTP : sans date, reponse STRICTEMENT historique');
  // =========================================================================
  await setStoreBlocks([rawBlock({ scope_type: 'center', date: TUE, reason: 'Privatise Dupont SA', created_by: 'seb@fungalaxy.be' })]);

  const noDate = await callApi('?centerId=libramont');
  ok(noDate.status === 200, 'GET sans date : 200');
  ok(noDate.payload.center && Object.prototype.hasOwnProperty.call(noDate.payload.center, 'day') === false,
    'GET sans date : la cle "day" est ABSENTE (les 16 gates qui mockent cet endpoint restent verts)');
  ok(Array.isArray(noDate.payload.formules) && noDate.payload.formules.length > 0, 'GET sans date : le catalogue reste servi');
  ok(noDate.payload.center.defaultSchedule && noDate.payload.center.booking && noDate.payload.center.holidaySettings,
    'GET sans date : toutes les cles historiques sont intactes');

  const badDate = await callApi('?centerId=libramont&date=demain');
  ok(badDate.status === 200 && !Object.prototype.hasOwnProperty.call(badDate.payload.center || {}, 'day'),
    'GET avec date MALFORMEE : 200 sans "day" (surface de config, jamais une 400)');

  const withDate = await callApi(`?centerId=libramont&date=${TUE}`);
  ok(withDate.status === 200 && withDate.payload.center && withDate.payload.center.day,
    'GET avec date valide : la cle "day" apparait');
  ok(withDate.payload.center.day.open === false && withDate.payload.center.day.closedLabel === 'Fermé exceptionnellement ce jour',
    'le verdict HTTP porte bien la fermeture posee en base (bout en bout)');
  ok(withDate.payload.center.day.date === TUE, 'le verdict HTTP fait echo de la date demandee');

  const openDate = await callApi(`?centerId=libramont&date=${WED}`);
  ok(openDate.payload.center.day.open === true && openDate.payload.center.day.closedLabel === '',
    'une autre date reste ouverte (le blocage ponctuel ne deborde pas)');

  // =========================================================================
  console.log('\n[9] CONTRAT DE FUITE : aucune ligne brute de availability_blocks ne sort');
  // =========================================================================
  await setStoreBlocks([
    rawBlock({ id: 41, scope_type: 'center', date: TUE, start_time: '16:00', end_time: '18:00', reason: 'Privatise Dupont SA', created_by: 'seb@fungalaxy.be' }),
    rawBlock({ id: 42, scope_type: 'lane', scope_ref: '5', date: TUE, reason: 'Piste capricieuse', created_by: 'technicien@fungalaxy.be' }),
    rawBlock({ id: 43, scope_type: 'activity', scope_ref: 'laser_game', date: TUE, reason: 'Panne laser', created_by: 'seb@fungalaxy.be' }),
  ]);
  const leaky = await callApi(`?centerId=libramont&date=${TUE}`);
  const serialized = leaky.raw;
  const forbidden = [
    'Privatise Dupont SA', 'Piste capricieuse', 'Panne laser',
    'seb@fungalaxy.be', 'technicien@fungalaxy.be',
    '"reason"', '"createdBy"', '"scopeType"', '"scopeRef"', '"lane"', '"recurrence"',
  ];
  forbidden.forEach((needle) => {
    ok(!serialized.includes(needle), `le payload public ne contient jamais ${needle}`);
  });
  ok(leaky.payload.center.day.closedWindows.length === 1, 'la coupure centre est bien exposee (le verdict, pas la ligne)');
  ok(leaky.payload.center.day.unavailableActivityIds.includes('laser_game'), 'le laser bloque est bien expose (le verdict, pas la ligne)');
  const reasonCodes = new Set(Object.values(leaky.payload.center.day.unavailableFormulaReason));
  ok([...reasonCodes].every((code) => ['formula', 'bowling', 'laser_game'].includes(code)),
    'unavailableFormulaReason ne contient que les CODES fermes formula|bowling|laser_game');

  // =========================================================================
  console.log('\n[10] isolation multi-tenant : un blocage d un autre centre n entre pas');
  // =========================================================================
  await setStoreBlocks([rawBlock({ center_id: 'gembloux', scope_type: 'center', date: TUE })]);
  const otherTenant = await callApi(`?centerId=libramont&date=${TUE}`);
  ok(otherTenant.payload.center.day.open === true,
    'un blocage pose sur gembloux ne ferme pas libramont (where center_id = $1)');

  // Fail-soft : pool en incident => day decrit l etat sans blocage, jamais d erreur.
  const brokenQuery = FakePool.prototype.query;
  FakePool.prototype.query = async () => { throw new Error('base indisponible'); };
  await ab.refreshAvailabilityBlocks(require('../lib/database').getPool(), { centerId: 'libramont', force: true });
  const failSoft = await callApi(`?centerId=libramont&date=${MON}`);
  FakePool.prototype.query = brokenQuery;
  ok(failSoft.status === 200 && failSoft.payload.ok === true, 'incident base : la reponse publique reste 200 (fail-soft)');
  ok(failSoft.payload.center.day && failSoft.payload.center.day.closedLabel === 'Fermé ce jour',
    'incident base : le verdict retombe sur la seule grille hebdo, sans planter');

  // =========================================================================
  console.log('\n[11] contre-preuves par MUTATION (edition inverse, le gate sait rougir)');
  // =========================================================================
  // Les ancres sont ecrites en \n, mais le fichier vit en CRLF sur Windows :
  // sans cette normalisation l'ancre est introuvable et le gate rougit pour une
  // raison qui n'a rien a voir avec le code teste.
  function toFileEol(text, original) {
    return original.includes('\r\n') ? text.replace(/\r?\n/g, '\r\n') : text.replace(/\r\n/g, '\n');
  }

  async function withMutation(rawAnchor, rawReplacement, probe, label) {
    const original = fs.readFileSync(apiPath, 'utf8');
    const anchor = toFileEol(rawAnchor, original);
    const replacement = toFileEol(rawReplacement, original);
    const occurrences = original.split(anchor).length - 1;
    if (occurrences !== 1) {
      console.error(`availability-day-check: ancre de mutation introuvable ou ambigue (${occurrences}) : ${label}`);
      process.exit(1);
    }
    const mutated = original.replace(anchor, replacement);
    if (mutated === original) {
      console.error(`availability-day-check: mutation sans effet sur le fichier : ${label}`);
      process.exit(1);
    }
    fs.writeFileSync(apiPath, mutated);
    let holds = true;
    try {
      delete require.cache[apiPath];
      holds = await probe(require('../api/public-booking-meta'));
    } finally {
      fs.writeFileSync(apiPath, original); // restauration par EDITION INVERSE
      delete require.cache[apiPath];
      api = require('../api/public-booking-meta');
    }
    if (holds) {
      console.error(`availability-day-check: MUTATION SANS EFFET, le gate ne sait pas rougir : ${label}`);
      process.exit(1);
    }
    ok(true, `mutation "${label}" : l invariant est viole, le gate ROUGIRAIT`);
    const restored = await probe(api);
    ok(restored, `restauration inverse "${label}" : l invariant tient de nouveau`);
  }

  const laserBlockFixture = normBlocks([rawBlock({ scope_type: 'activity', scope_ref: 'laser_game', date: TUE })]);
  const centerBlockFixture = normBlocks([rawBlock({ scope_type: 'center', date: TUE, reason: 'Privatise Dupont SA' })]);

  // Sonde ACTIVITE : laser bloque jour entier => f1 grisee.
  await withMutation(
    '|| isActivityFullyBlockedOn(blocks, dayDate, id));',
    '|| false);',
    async (mod) => {
      const verdict = mod.__test.buildDayStatus(laserBlockFixture, TUE, CENTER, 'libramont');
      return verdict.unavailableActivityIds.includes('laser_game') && verdict.unavailableFormulaIds.includes('f1');
    },
    'detection du blocage jour entier d une activite neutralisee',
  );

  // Sonde FERMETURE : center jour entier => open false.
  await withMutation(
    'if (!isCenterClosedAt(blocks, dayDate, Math.round(value * 60))) openMarks += 1;',
    'openMarks += 1;',
    async (mod) => mod.__test.buildDayStatus(centerBlockFixture, TUE, CENTER, 'libramont').open === false,
    'balayage des marques :00/:30 neutralise (le centre ne se ferme plus jamais)',
  );

  // Sonde FUITE : le champ reason du staff ne doit JAMAIS sortir.
  await withMutation(
    '    closedLabel,\n    closedWindows,',
    '    closedLabel,\n    reason: resolveBlocksForDate(blocks, dayDate).map((block) => block.reason).join(\' \'),\n    closedWindows,',
    async (mod) => !JSON.stringify(mod.__test.buildDayStatus(centerBlockFixture, TUE, CENTER, 'libramont')).includes('Privatise Dupont SA'),
    'reason du staff reinjecte dans le verdict public (fuite de donnee interne)',
  );

  await setStoreBlocks([]);

  if (failures) {
    console.error(`\navailability-day-check: ${failures} FAIL`);
    process.exit(1);
  }
  console.log('\navailability-day-check: ALL OK');
})().catch((error) => {
  console.error('availability-day-check: exception', error);
  process.exit(1);
});

'use strict';
// CE QUE LE SITE DU CLIENT DIT, CE QUE LE FORMULAIRE SERT (fungalaxy.be, relu le 2026-11-04). Sans base : le socle.
// Pour chaque centre, la vraie reponse de /api/public-booking-meta, confrontee au site, activite par activite.
for (const nom of Object.keys(process.env)) if (/^(PG|DATABASE|POSTGRES)/i.test(nom)) delete process.env[nom];
const assert = require('assert');
const meta = require('../api/public-booking-meta.js');

let echecs = 0;
let total = 0;
function ok(condition, message, detail) {
  total += 1;
  if (condition) { console.log(`ok    ${message}`); return; }
  echecs += 1;
  console.log(`FAIL  ${message}${detail === undefined ? '' : `  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
}
async function lire(centerId) {
  const res = {
    statusCode: 200, corps: '', headers: {},
    setHeader(k, v) { this.headers[k] = v; }, getHeader(k) { return this.headers[k]; },
    writeHead(s) { this.statusCode = s; return this; }, end(c) { this.corps += c || ''; }, write(c) { this.corps += c || ''; },
  };
  await meta({ method: 'GET', url: `/api/public-booking-meta?centerId=${centerId}`, headers: { host: 'banc' }, query: { centerId }, socket: {} }, res);
  assert.strictEqual(res.statusCode, 200);
  return JSON.parse(res.corps);
}
const FORMULES = { f1: [26, 34, true], f2: [30, 45, true], f3: [28, 34, true], f4: [39, 48, true], f5: [26, 32, true], bts: [20, 59, true], mm: [25, 90, true], css: [55, null, false], kfd: [30, null, true], hlg: [20, null, false], ffm: [30, null, false] };
const FETES = { f6: [18, 20, true], f7: [24, 30, true], f8: [28, 37, true] };

(async () => {
  const gembloux = await lire('gembloux');
  const libramont = await lire('libramont');
  for (const [nom, m] of [['Gembloux', gembloux], ['Libramont', libramont]]) {
    const a = (id) => m.activities.find((x) => x.id === id);
    ok(m.center.city === nom, `[${nom}] le centre dit sa ville`, m.center.city);
    ok(/\d{4} /.test(m.center.address || ''), `[${nom}] le centre dit son adresse`, m.center.address);
    ok(JSON.stringify(m.durationOptions.filter((o) => o.value <= 1).map((o) => o.price)) === '[20,39]', `[${nom}] bowling : 30 min 20 EUR, 1 h 39 EUR la piste`, m.durationOptions);
    ok(m.center.booking.normalCapacityPerLane === 6 && m.center.booking.laneCount === 8, `[${nom}] 8 pistes, 6 joueurs par piste`, m.center.booking);
    ok(JSON.stringify(m.laserOptions.map((o) => o.price)) === '[10,18,25]', `[${nom}] laser : 10, 18, 25 EUR par personne`, m.laserOptions);
    ok(a('laser_game').minAge === 7 && a('laser_game').minHeightCm === 130 && a('laser_game').minPax === 2 && a('laser_game').gameMinutes === 20, `[${nom}] laser : 7 ans, 1,30 m, 2 joueurs, 20 min de jeu`, a('laser_game'));
    ok(a('minigolf_blacklight').minAge === 3 && /12 trous/.test(a('minigolf_blacklight').note), `[${nom}] minigolf : 3 ans, 12 trous`, a('minigolf_blacklight'));
    ok(a('billards').units === 6 && a('billards').minAge === 10 && a('billards').maxPlayersPerTable === 4, `[${nom}] billard : 6 tables, 10 ans, 4 joueurs par table`, a('billards'));
    const cartes = a('arcade_time').arcadeOffers;
    ok(JSON.stringify(cartes.timeOffers.map((o) => [o.minutes, o.price])) === '[[30,15],[60,25]]', `[${nom}] arcades au temps : 15 EUR les 30 min, 25 EUR l heure`, cartes.timeOffers);
    ok(JSON.stringify(cartes.creditOffers.map((o) => [o.price, o.bonusCredits])) === '[[10,0],[25,10],[35,15],[50,25]]', `[${nom}] cartes : 10, 25 + 10, 35 + 15, 50 + 25`, cartes.creditOffers);
    const attendues = { ...FORMULES, ...(nom === 'Libramont' ? FETES : {}) };
    const vendues = m.formules.filter((f) => !(f.missingActivityIds || []).length);
    ok(JSON.stringify(vendues.map((f) => f.id).sort()) === JSON.stringify(Object.keys(attendues).sort()), `[${nom}] les formules du centre, ni plus ni moins`, vendues.map((f) => f.id));
    for (const [id, [prix, barre, horsVacances]] of Object.entries(attendues)) {
      const f = m.formules.find((x) => x.id === id);
      ok(f && f.price === prix && (barre == null ? f.oldPrice == null : f.oldPrice === barre) && Boolean(f.noHolidays) === horsVacances, `[${nom}] ${id} : ${prix} EUR${barre ? `, barre ${barre}` : ''}${horsVacances ? ', hors vacances' : ''}`, f);
    }
  }
  const ids = (m) => m.activities.map((x) => x.id).sort().join(' ');
  ok(ids(gembloux) === 'arcade_time billards bowling golf_oclock laser_game minigolf_blacklight', '[Gembloux] ses six activites, sans plaine de jeux, duckpin ni Fun Run', ids(gembloux));
  ok(ids(libramont) === 'arcade_time billards bowling duckpin_bowling fun_run laser_game minigolf_blacklight playground', '[Libramont] ses huit activites, sans Golf o Clock', ids(libramont));
  const golf = gembloux.activities.find((x) => x.id === 'golf_oclock');
  ok(golf.priceValue === 12.5 && golf.minAge === 7 && /12 trous/.test(golf.note) && /6 joueurs/.test(golf.note), '[Gembloux] Golf o Clock : 12,50 EUR, 7 ans, 12 trous, 6 par groupe', golf);
  ok(gembloux.center.booking.laserArenaCapacity === 20, '[Gembloux] laser : 20 armes', gembloux.center.booking.laserArenaCapacity);
  ok(libramont.center.booking.laserArenaCapacity === 30, '[Libramont] laser : 30 armes', libramont.center.booking.laserArenaCapacity);
  ok(JSON.stringify(libramont.funRunOptions.map((o) => [o.minutes, o.price])) === '[[15,30],[30,55],[60,100]]', '[Libramont] Fun Run : 15 min 30 EUR, 30 min 55 EUR, 60 min 100 EUR', libramont.funRunOptions);
  const run = libramont.activities.find((x) => x.id === 'fun_run');
  ok(run.minAge === 6 && run.capacityPerUnit === 5, '[Libramont] Fun Run : 6 ans, 5 joueurs par session', run);
  const duck = libramont.activities.find((x) => x.id === 'duckpin_bowling');
  ok(duck.units === 2 && duck.capacityPerUnit === 6, '[Libramont] duckpin : 2 pistes, 6 joueurs', duck);
  const plaine = libramont.activities.find((x) => x.id === 'playground');
  ok(plaine.dayAccess === true, '[Libramont] plaine de jeux : a la journee', plaine);
  console.log(echecs ? `\nsite-centres-check: ${echecs} ECHEC(S) sur ${total}` : `\nsite-centres-check: ALL OK (${total})`);
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

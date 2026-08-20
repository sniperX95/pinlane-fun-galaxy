// LE GATE DU BOWLING VENDU AUX PARTIES (2026-08-20).
//
// LA QUESTION POSEE : deux centres peuvent-ils vendre le bowling de deux
// facons DIFFERENTES, chacun le sien, sans que l'un contamine l'autre ?
//
// Fun Galaxy vend PAR PISTE ET PAR DUREE (39 EUR l'heure la piste, grille
// historique du produit). N4 Bowling vend PAR PERSONNE ET PAR PARTIE, avec un
// prix qui depend du jour (6 EUR la partie du mercredi au jeudi, 7 EUR du
// vendredi au dimanche, la deuxieme partie moins chere). Ces deux modeles
// doivent coexister dans la MEME base et le MEME code, chacun chez lui.
//
// CE QU'IL VERROUILLE
//   1. Le tarif est une DONNEE DE CENTRE : un centre sans `pricing` garde la
//      grille au centime pres, aucune ligne de sa configuration ne change.
//   2. Le prix AFFICHE par le tunnel est le prix FACTURE par le serveur. Le
//      calcul existe des deux cotes (lib/booking-config et assets/booking-core) :
//      s'ils divergent, le client voit un montant et en paie un autre.
//   3. Le prix suit le JOUR : la meme partie ne vaut pas le meme prix un jeudi
//      et un samedi, et un jour sans tarif ne vend rien.
//   4. Une nuit qui deborde sur le lendemain (fermeture a 1 h ou 2 h du matin)
//      produit de vrais creneaux, ecrits 25:00 en interne et lus 01:00 par le
//      client.
//   5. CONTRE-PREUVE : la portee retiree, le gate rougit.
//
// Zero reseau, zero base. Lancement : node scripts/bowling-per-game-check.js

const path = require('path');
const fs = require('fs');
const vm = require('vm');

process.env.NODE_ENV = 'test';
delete process.env.VERCEL;
process.env.DATABASE_URL = 'postgres://gate/gate';
process.env.DATABASE_SSL = 'disable';

const ROOT = path.resolve(__dirname, '..');

let failures = 0;
let assertions = 0;
function section(title) { console.log(`\n${title}`); }
function ok(condition, label) {
  assertions += 1;
  if (condition) { console.log(`  [OK] ${label}`); return true; }
  failures += 1;
  console.log(`  [FAIL] ${label}`);
  return false;
}

// 'pg' neutralise avant tout require applicatif : la base n'est jamais touchee.
class FakePool {
  async query() { return { rows: [], rowCount: 0 }; }
  async connect() { return { query: async () => ({ rows: [], rowCount: 0 }), release() {} }; }
  async end() {}
}
const pgPath = require.resolve('pg');
require.cache[pgPath] = { id: pgPath, filename: pgPath, loaded: true, exports: { Pool: FakePool } };

const bookingConfig = require(path.join(ROOT, 'lib', 'booking-config.js'));
const { normalizeCenterConfig } = require(path.join(ROOT, 'lib', 'center-config.js'));
const { applyCenterRecords, getCenter } = require(path.join(ROOT, 'lib', 'ops-knowledge.js'));
const reservationRequest = require(path.join(ROOT, 'lib', 'reservation-request.js'));

// ── Les deux centres du gate ────────────────────────────────────────────────
const GRID_CENTER = 'gate-grille';     // vend a la grille, comme Fun Galaxy
const GAMES_CENTER = 'gate-parties';   // vend aux parties, comme N4

const GAMES_PRICING = {
  mode: 'per_game_per_person',
  minutesPerGame: 60,
  tiers: [
    { days: [3, 4], prices: [6, 11] },      // mercredi, jeudi
    { days: [5, 6, 0], prices: [7, 13] },   // vendredi, samedi, dimanche
  ],
};

// Vendredi ferme a 1 h, samedi a 2 h : 25:00 et 26:00.
const LATE_SCHEDULE = {
  regular: {
    0: { open: '12:00', close: '23:00' },
    1: null,
    2: null,
    3: { open: '12:00', close: '23:00' },
    4: { open: '15:00', close: '23:00' },
    5: { open: '15:00', close: '25:00' },
    6: { open: '12:00', close: '26:00' },
  },
  holiday: {},
};

function centerRecord(id, { pricing = null, schedule = null } = {}) {
  const config = normalizeCenterConfig({
    status: 'active',
    timezone: 'Europe/Brussels',
    resources: {
      bowling: {
        laneCount: 8,
        normalCapacityPerLane: 12,
        emergencyCapacityPerLane: 12,
        ...(pricing ? { pricing } : {}),
      },
      laser: null,
    },
    ...(schedule ? { defaultSchedule: schedule } : {}),
  }, id);
  // La forme attendue par applyCenterRecords : la config vit sous `config`
  // (rebuildMergedCenters lit `record.config`), pas a plat sur la ligne.
  return { id, name: id, status: 'active', timezone: 'Europe/Brussels', fromDatabase: true, config };
}

// Un jour precis A VENIR, calcule et jamais ecrit en dur (trois bombes
// d'horloge payees sur ce depot). weekday : 0 = dimanche .. 6 = samedi.
function nextWeekday(weekday, minDaysAhead = 2) {
  const [year, month, day] = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()).split('-').map(Number);
  const cursor = new Date(Date.UTC(year, month - 1, day));
  for (let i = 0; i < minDaysAhead; i += 1) cursor.setUTCDate(cursor.getUTCDate() + 1);
  while (cursor.getUTCDay() !== weekday) cursor.setUTCDate(cursor.getUTCDate() + 1);
  return cursor.toISOString().slice(0, 10);
}

// Le calcul de prix du NAVIGATEUR, charge tel quel depuis assets/booking-core.js.
// On ne le reecrit pas : on execute le fichier qui part en production.
function loadBrowserCore(pricingServed) {
  const source = fs.readFileSync(path.join(ROOT, 'assets', 'booking-core.js'), 'utf8');
  // Le fichier s'expose sur `window` ou, a defaut, sur l'objet global. Dans un
  // contexte vm il n'y a pas de `window` : il se pose donc sur le bac a sable,
  // exactement comme il le ferait sur un navigateur sans window (aucun stub).
  const sandbox = { console };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'assets/booking-core.js' });
  const core = sandbox.PinlaneBookingCore;
  if (!core) throw new Error('assets/booking-core.js ne s expose plus : PinlaneBookingCore absent.');
  core.setCenterScheduleConfig({ booking: pricingServed ? { bowlingPricing: pricingServed } : {} });
  return core;
}

function run() {
  applyCenterRecords([
    centerRecord(GRID_CENTER),
    centerRecord(GAMES_CENTER, { pricing: GAMES_PRICING, schedule: LATE_SCHEDULE }),
  ]);

  const thursday = nextWeekday(4);
  const saturday = nextWeekday(6);
  const monday = nextWeekday(1);

  section('[0] Le tarif est une DONNEE DE CENTRE, pas une constante du produit');
  const gridBowling = getCenter(GRID_CENTER).resources.bowling;
  const gamesBowling = getCenter(GAMES_CENTER).resources.bowling;
  ok(gridBowling.pricing === null, 'le centre a la grille ne porte AUCUN tarif par parties');
  ok(gamesBowling.pricing && gamesBowling.pricing.mode === 'per_game_per_person',
    'le centre aux parties porte le sien');
  ok(bookingConfig.getBowlingGameOptions(gridBowling, thursday) === null,
    'la grille ne propose pas de parties (null, comportement historique)');

  section('[1] Le centre A LA GRILLE ne change pas d un centime');
  const gridCases = [[0.5, 1, 20], [1, 1, 39], [1.5, 1, 59], [2, 1, 78], [1, 2, 78], [2, 3, 234]];
  gridCases.forEach(([duration, lanes, expected]) => {
    const price = bookingConfig.getBasePrice('bowling', duration, lanes, 10, '', GRID_CENTER,
      { bowlingConfig: gridBowling, dateStr: thursday });
    ok(price === expected, `${duration} h sur ${lanes} piste(s) = ${expected} EUR (obtenu ${price})`);
  });

  section('[2] Le centre AUX PARTIES vend par personne, et le jour compte');
  const gamesThursday = bookingConfig.getBowlingGameOptions(gamesBowling, thursday);
  const gamesSaturday = bookingConfig.getBowlingGameOptions(gamesBowling, saturday);
  const gamesMonday = bookingConfig.getBowlingGameOptions(gamesBowling, monday);
  ok(gamesThursday.length === 2 && gamesThursday[0].price === 6 && gamesThursday[1].price === 11,
    `jeudi : 1 partie 6 EUR, 2 parties 11 EUR (obtenu ${JSON.stringify(gamesThursday.map((g) => g.price))})`);
  ok(gamesSaturday.length === 2 && gamesSaturday[0].price === 7 && gamesSaturday[1].price === 13,
    `samedi : 7 EUR et 13 EUR (obtenu ${JSON.stringify(gamesSaturday.map((g) => g.price))})`);
  ok(gamesMonday.length === 0, 'lundi : aucun tarif publie, donc rien a vendre en ligne');
  ok(gamesThursday[1].durationMinutes === 120 && gamesThursday[1].value === 2,
    '2 parties bloquent la piste 120 minutes (la duree DERIVE des parties)');

  const price4Thursday = bookingConfig.getBasePrice('bowling', 1, 1, 4, '', GAMES_CENTER,
    { bowlingConfig: gamesBowling, dateStr: thursday });
  ok(price4Thursday === 24, `4 joueurs, 1 partie, jeudi = 24 EUR (obtenu ${price4Thursday})`);
  const price4Saturday = bookingConfig.getBasePrice('bowling', 2, 1, 4, '', GAMES_CENTER,
    { bowlingConfig: gamesBowling, dateStr: saturday });
  ok(price4Saturday === 52, `4 joueurs, 2 parties, samedi = 52 EUR (obtenu ${price4Saturday})`);
  // Le nombre de PISTES ne doit RIEN changer au prix : c'est le nombre de
  // JOUEURS qui paie. Sans cette assertion, une regression vers la grille
  // passerait inapercue des que le groupe tient sur une piste.
  const price12 = bookingConfig.getBasePrice('bowling', 1, 2, 12, '', GAMES_CENTER,
    { bowlingConfig: gamesBowling, dateStr: thursday });
  ok(price12 === 72, `12 joueurs sur 2 pistes, 1 partie, jeudi = 72 EUR (obtenu ${price12})`);

  const priceUnsold = bookingConfig.getBasePrice('bowling', 1.5, 1, 4, '', GAMES_CENTER,
    { bowlingConfig: gamesBowling, dateStr: thursday });
  ok(priceUnsold === 0, `une duree non vendue rend 0, jamais un prix de grille (obtenu ${priceUnsold})`);

  section('[3] Le prix AFFICHE est le prix FACTURE');
  const browser = loadBrowserCore(GAMES_PRICING);
  const shownThursday = browser.getBasePrice('bowling', 1, 1, 4, '', thursday);
  const shownSaturday = browser.getBasePrice('bowling', 2, 1, 4, '', saturday);
  ok(shownThursday === price4Thursday,
    `le navigateur affiche ${shownThursday} EUR, le serveur en calcule ${price4Thursday}`);
  ok(shownSaturday === price4Saturday,
    `le navigateur affiche ${shownSaturday} EUR, le serveur en calcule ${price4Saturday}`);
  // Et le prix REELLEMENT porte par la reservation, calcule par le chemin
  // d'ecriture (lib/reservation-request), pas par une reformulation.
  const booked = reservationRequest.normalizeReservationRequest({
    centerId: GAMES_CENTER,
    type: 'bowling',
    date: thursday,
    startTime: '19:00',
    duration: 1,
    pax: 4,
    name: 'Gate Parties',
    email: 'gate@example.test',
    phone: '0470000000',
  });
  ok(Number(booked.price) === price4Thursday,
    `la reservation porte ${booked.price} EUR, le tunnel en affichait ${shownThursday}`);

  // Garde anti-abus : une duree forgee ne se facture pas a 0 EUR en silence.
  let forgedRefused = false;
  try {
    reservationRequest.normalizeReservationRequest({
      centerId: GAMES_CENTER,
      type: 'bowling',
      date: thursday,
      startTime: '19:00',
      duration: 1.75,
      pax: 4,
      name: 'Gate Parties',
      email: 'gate@example.test',
      phone: '0470000000',
    });
  } catch (error) {
    forgedRefused = true;
  }
  ok(forgedRefused, 'une duree qui n est pas une option vendue est REFUSEE, pas facturee 0 EUR');

  const browserGrid = loadBrowserCore(null);
  ok(browserGrid.getBasePrice('bowling', 1, 2, 10, '', thursday) === 78,
    'sans tarif servi, le navigateur retombe sur la grille (78 EUR, comme le serveur)');

  section('[4] Une nuit qui deborde sur le lendemain');
  const lateCenter = getCenter(GAMES_CENTER);
  const fridaySchedule = bookingConfig.getSchedule(nextWeekday(5), lateCenter);
  const saturdaySchedule = bookingConfig.getSchedule(saturday, lateCenter);
  ok(fridaySchedule && Number(fridaySchedule.close) === 25,
    `vendredi ferme a 25 h, soit 1 h du matin (obtenu ${fridaySchedule && fridaySchedule.close})`);
  ok(saturdaySchedule && Number(saturdaySchedule.close) === 26,
    `samedi ferme a 26 h, soit 2 h du matin (obtenu ${saturdaySchedule && saturdaySchedule.close})`);
  ok(browser.displayTime('25:00') === '01:00', 'le client lit 01:00 la ou la donnee dit 25:00');
  ok(browser.displayTime('26:30') === '02:30', 'et 02:30 la ou elle dit 26:30');
  ok(browser.displayTime('23:00') === '23:00', 'une heure normale ne bouge pas');
  // Le BANDEAU d'horaires a son propre formateur : il disait « Minuit » pour
  // toute fermeture au-dela de 24 h, donc un centre ouvert jusqu'a 2 h se
  // privait de deux heures de reservations dans son propre message.
  ok(browser.buildScheduleLabel(12, 26) === '12h - 2h',
    `samedi 12h-26h se lit « 12h - 2h » (obtenu « ${browser.buildScheduleLabel(12, 26)} »)`);
  ok(browser.buildScheduleLabel(15, 25) === '15h - 1h',
    `vendredi 15h-25h se lit « 15h - 1h » (obtenu « ${browser.buildScheduleLabel(15, 25)} »)`);
  ok(browser.buildScheduleLabel(10, 24) === '10h - Minuit',
    `minuit pile se dit toujours « Minuit » (obtenu « ${browser.buildScheduleLabel(10, 24)} »)`);

  section('[5] LA VENTE « A LA CARTE » suit le meme tarif que le reste');
  // Le programme a la carte est le chemin REELLEMENT emprunte par le tunnel :
  // le bloc « duree de jeu » historique est cache dans ce mode. Il a donc son
  // propre calcul de prix, cote serveur (lib/visit-program) comme cote
  // navigateur. Les trois doivent dire le meme montant, sinon le client voit un
  // total et en paie un autre.
  const visitProgram = require(path.join(ROOT, 'lib', 'visit-program.js'));
  const carte = visitProgram.normalizeProgram(
    [{ activityId: 'bowling', duration: 1 }],
    { centerId: GAMES_CENTER, pax: 6, bowlingConfig: gamesBowling, dateStr: saturday },
  );
  const ligne = (carte.items || [])[0] || {};
  ok(Number(ligne.price) === 42,
    `6 joueurs, 1 partie, samedi, a la carte = 42 EUR (obtenu ${ligne.price})`);
  ok(Number(ligne.laneCount) === 1,
    `le nombre de pistes est dit (${ligne.laneCount}) mais ne multiplie pas le prix`);
  const carteGrille = visitProgram.normalizeProgram(
    [{ activityId: 'bowling', duration: 1 }],
    { centerId: GRID_CENTER, pax: 6, bowlingConfig: gridBowling, dateStr: saturday },
  );
  ok(Number((carteGrille.items || [])[0].price) === 39,
    `et le centre a la grille facture toujours 39 EUR la piste (obtenu ${(carteGrille.items || [])[0].price})`);

  section('[6] LE TARIF D UNE ACTIVITE peut dependre du jour et du creneau');
  const { normalizeActivityPricing, resolveActivityUnitPrice } = require(path.join(ROOT, 'lib', 'activity-pricing.js'));
  const { activityLinePrice } = require(path.join(ROOT, 'lib', 'activity-catalog.js'));
  const karaPricing = normalizeActivityPricing({
    mode: 'per_person',
    tiers: [{ days: [3], untilMinutes: '18:00', price: 7.5, label: 'Mercredi apres-midi' }],
  });
  ok(Boolean(karaPricing) && karaPricing.tiers[0].untilMinutes === 1080,
    `« 18:00 » se normalise en 1080 minutes (obtenu ${karaPricing && karaPricing.tiers[0].untilMinutes})`);
  // Un palier sans jour NI fenetre serait un prix de base deguise : refuse.
  ok(normalizeActivityPricing({ mode: 'per_person', tiers: [{ price: 1 }] }) === null,
    'un palier sans jour ni plage horaire est refuse');
  // Une fenetre fermee a l envers ne s appliquerait jamais : refusee a l ecriture.
  ok(normalizeActivityPricing({ mode: 'per_person', tiers: [{ days: [3], fromMinutes: 1080, untilMinutes: 720, price: 1 }] }) === null,
    'une plage horaire fermee a l envers est refusee');

  const mercredi = nextWeekday(3);
  const jeudi = nextWeekday(4);
  ok(resolveActivityUnitPrice(karaPricing, 10, { dateStr: mercredi, startTime: '15:00' }) === 7.5,
    'mercredi 15h : le palier gagne (7,50 EUR)');
  ok(resolveActivityUnitPrice(karaPricing, 10, { dateStr: mercredi, startTime: '20:00' }) === 10,
    'mercredi 20h : hors fenetre, prix de base (10 EUR)');
  ok(resolveActivityUnitPrice(karaPricing, 10, { dateStr: jeudi, startTime: '15:00' }) === 10,
    'jeudi 15h : mauvais jour, prix de base (10 EUR)');
  // LA REGLE DE SURETE : sans creneau, jamais la promo. Le montant affiche ne
  // peut que BAISSER une fois l heure connue, jamais monter.
  ok(resolveActivityUnitPrice(karaPricing, 10, { dateStr: mercredi }) === 10,
    'sans creneau choisi : prix de base, jamais le palier');

  const kara = { id: 'kara-box', priceType: 'per_pax', priceValue: 10, pricing: karaPricing };
  ok(activityLinePrice(kara, { pax: 8, dateStr: mercredi, startTime: '15:00' }) === 60,
    `8 personnes, mercredi 15h = 60 EUR (obtenu ${activityLinePrice(kara, { pax: 8, dateStr: mercredi, startTime: '15:00' })})`);
  ok(activityLinePrice(kara, { pax: 8, dateStr: mercredi, startTime: '20:00' }) === 80,
    `8 personnes, mercredi 20h = 80 EUR (obtenu ${activityLinePrice(kara, { pax: 8, dateStr: mercredi, startTime: '20:00' })})`);
  ok(activityLinePrice({ id: 'x', priceType: 'per_pax', priceValue: 10 }, { pax: 8, dateStr: mercredi, startTime: '15:00' }) === 80,
    'une activite SANS paliers garde son prix unique (80 EUR)');

  // Le NAVIGATEUR doit dire le meme montant que le serveur, sinon le client
  // voit un total et en paie un autre.
  const browserKara = loadBrowserCore(GAMES_PRICING);
  ok(browserKara.getFreeActivityPrice(kara, { pax: 8, dateStr: mercredi, startTime: '15:00' }) === 60,
    `le navigateur annonce 60 EUR la ou le serveur en calcule 60 (obtenu ${browserKara.getFreeActivityPrice(kara, { pax: 8, dateStr: mercredi, startTime: '15:00' })})`);
  ok(browserKara.getFreeActivityPrice(kara, { pax: 8, dateStr: mercredi }) === 80,
    'et sans creneau, le navigateur annonce lui aussi le prix de base');

  section('[7] CONTRE-PREUVE : sans le tarif du centre, le prix redevient celui de la grille');
  const withoutPricing = bookingConfig.getBasePrice('bowling', 1, 1, 4, '', GAMES_CENTER,
    { bowlingConfig: gridBowling, dateStr: thursday });
  ok(withoutPricing === 39 && withoutPricing !== price4Thursday,
    `sans la donnee de centre : ${withoutPricing} EUR au lieu de ${price4Thursday}, le gate sait rougir`);
  const withoutDate = bookingConfig.getBasePrice('bowling', 1, 1, 4, '', GAMES_CENTER,
    { bowlingConfig: gamesBowling });
  ok(withoutDate === 0,
    `sans la date, un centre aux parties rend 0 plutot qu un prix de grille (obtenu ${withoutDate})`);
}

try {
  run();
} catch (error) {
  console.error('\nGATE ROUGE (exception) :', error && error.stack ? error.stack : error);
  process.exit(1);
}
console.log(`\n${failures === 0 ? 'GATE VERT' : 'GATE ROUGE'} : ${assertions - failures}/${assertions} assertions`);
process.exit(failures === 0 ? 0 : 1);

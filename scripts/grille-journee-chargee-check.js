// LA GRILLE D UNE JOURNEE CHARGEE DIT LA MEME CHOSE QUE LA RESERVATION.
//
// Movsar, 2026-09-29, captures a l appui : « je vois complet, mais quand je
// choisis un horaire ce n est plus complet ». Journee reelle du 30/09 (lue en
// lecture seule), 25 joueurs, bowling 1h30 et 3 parties de laser : la grille
// du laser disait 14:00 et 14:30 complets, puis libres des que la partie 1
// etait choisie a 13:30. Reserver la partie 1 a 14:00 marchait pourtant, le
// bowling pose a 15:30 : la grille n essayait le bowling que colle au laser
// (12:30 et 14:30, deux places prises), la reservation le posait a la premiere
// place libre (lib/ops-engine.js, visitFeasibilityAt, « plus loin »).
//
// Ce gate rejoue cette journee sur le vrai moteur (l API en processus), les
// huit pistes prises de 13:30 a 15:30 :
//   [A] chaque heure du laser : la grille et la reservation rendent le meme
//       verdict ; 14:00 et 14:30 sont reservables, et la grille le dit ;
//   [B] chaque heure du bowling : le meme verdict que la reservation ;
//   [C] choisir la partie 1 a l heure proposee ne libere aucune heure que la
//       grille disait complete ;
//   [D] contre-epreuve : sans la recherche « plus loin », ce gate ROUGIT (la
//       mutation passe par un crochet de compilation : le moteur n est jamais
//       reecrit sur le disque).
//
// Lancement : node scripts/grille-journee-chargee-check.js
'use strict';
const path = require('path');
const Module = require('module');

delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
delete process.env.RESEND_API_KEY;
process.env.PINLANE_CALENDAR_SYNC = 'off';

const ROOT = path.resolve(__dirname, '..');
const ENGINE = path.join(ROOT, 'lib/ops-engine.js');
const CENTRE = 'libramont';

let echecs = 0;
function ok(cond, label, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail ? `\n      ${detail}` : ''}`);
  if (!cond) echecs += 1;
  return Boolean(cond);
}
function section(titre) { console.log(`\n[${titre}]`); }

// Un mercredi a plus d une semaine, au fuseau du centre : jamais aujourd hui.
function mercrediLointain() {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).split('-').map(Number);
  const c = new Date(Date.UTC(y, m - 1, d + 7));
  do { c.setUTCDate(c.getUTCDate() + 1); } while (c.getUTCDay() !== 3);
  return c.toISOString().slice(0, 10);
}
const DATE = mercrediLointain();

// Les huit pistes prises de 13:30 a 15:30 (deux heures), comme le 30/09.
const DOSSIERS = Array.from({ length: 8 }, (_, k) => ({
  id: 9101 + k, centerId: CENTRE, date: DATE, startTime: '13:30', duration: 2, totalDuration: 2, pax: 5,
  lanes: [k + 1], laneCount: 1, status: 'confirmed', validationStatus: 'confirmed', type: 'bowling', program: null, opsPlan: null,
}));
const PROGRAMME = [{ activityId: 'bowling', duration: 1.5 }, { activityId: 'laser_game', games: 3 }];
const PAX = 25;

// LE CROCHET DE COMPILATION, pose AVANT tout require du moteur : la
// contre-epreuve remplace une ligne du source au moment ou Node le compile.
// `appliquee` prouve que la mutation a mordu.
const mutation = { ancre: '', remplace: '', appliquee: 0, trouvee: -1 };
const compiler = Module.prototype._compile;
Module.prototype._compile = function compilerAvecMutation(source, fichier) {
  if (mutation.ancre && path.resolve(fichier) === path.resolve(ENGINE)) {
    mutation.trouvee = source.split(mutation.ancre).length - 1;
    if (mutation.trouvee === 1) {
      source = source.split(mutation.ancre).join(mutation.remplace);
      mutation.appliquee += 1;
    }
  }
  return compiler.call(this, source, fichier);
};

// Le moteur, rechargé a neuf (la contre-epreuve le recharge mute). Le
// limiteur de debit est neutralise : ce gate fait des dizaines d appels, un
// refus du limiteur ressemblerait a un refus metier (un autre gate le couvre).
function charger() {
  Object.keys(require.cache)
    .filter((cle) => cle.startsWith(ROOT) && !cle.includes(`${path.sep}node_modules${path.sep}`))
    .forEach((cle) => { delete require.cache[cle]; });
  const limiteur = require.resolve(path.join(ROOT, 'lib/rate-limit'));
  require.cache[limiteur] = { id: limiteur, filename: limiteur, loaded: true, exports: {
    enforceRateLimit: () => false,
    checkRateLimit: () => ({ allowed: true, remaining: 999, retryAfterSeconds: 0 }),
    getClientIp: () => 'gate',
  } };
  const database = require(path.join(ROOT, 'lib/database.js'));
  database.readAvailabilitySnapshot = async (date, centerId = CENTRE) => ({ date, centerId, reservations: DOSSIERS.filter((r) => r.date === date), laneStatuses: {}, blocks: [] });
  const api = require(path.join(ROOT, 'api/public-availability.js'));
  const { disponibiliteInterne } = require(path.join(ROOT, 'lib/disponibilite-interne.js'));
  return (extra = {}) => disponibiliteInterne({
    centerId: CENTRE, date: DATE, pax: String(PAX), type: 'visite', program: JSON.stringify(PROGRAMME), softReserve: '1',
    ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])),
  }, { handler: api });
}

const piste = (json, id) => ((((json || {}).anchors || {}).activities || []).find((a) => a.activityId === id) || { times: [] });
const accepte = (rep) => rep.status === 200 && rep.json && Array.isArray(rep.json.slots) && rep.json.slots.length > 0;

// La grille et la reservation, heure par heure, pour une piste.
async function comparer(dispo, id) {
  const grille = piste((await dispo()).json, id).times;
  const desaccords = [];
  for (const entree of grille) {
    const pose = id === 'laser_game'
      ? { preferredTimes: { laser_game: entree.time }, laserGameTimes: [entree.time] }
      : { preferredTimes: { [id]: entree.time } };
    const reservation = accepte(await dispo(pose));
    if (reservation !== (entree.ok !== false)) {
      desaccords.push(`${entree.time} : grille ${entree.ok !== false ? 'possible' : `impossible (${entree.code} ${entree.reason})`}, reservation ${reservation ? 'acceptee' : 'refusee'}`);
    }
  }
  return { grille, desaccords };
}

async function mesurer(dispo) {
  const r = {};
  r.base = await dispo();
  r.laser = await comparer(dispo, 'laser_game');
  r.bowling = await comparer(dispo, 'bowling');
  const propose = ((r.base.json && r.base.json.anchors && r.base.json.anchors.defaultTimes) || {}).laser_game || '';
  r.propose = propose;
  if (propose) {
    const apres = piste((await dispo({ preferredTimes: { laser_game: propose }, laserGameTimes: [propose] })).json, 'laser_game').times;
    const avant = r.laser.grille;
    r.liberees = avant.filter((x) => x.ok === false).map((x) => x.time).filter((t) => apres.some((y) => y.time === t && y.ok !== false));
  }
  return r;
}

async function main() {
  console.log(`[date] mercredi ${DATE}, huit pistes prises de 13:30 a 15:30, ${PAX} joueurs, bowling 1h30 et 3 parties de laser`);
  const r = await mesurer(charger());

  section('A. LE LASER : LA GRILLE DIT CE QUE LA RESERVATION FAIT');
  const bowlingSeul = piste(r.base.json, 'bowling').times;
  const pris = bowlingSeul.filter((x) => x.ok === false && x.code === 'capacity').map((x) => x.time);
  ok(r.base.status === 200 && pris.includes('13:30') && pris.includes('14:30') && !pris.includes('15:30'),
    'MONTAGE les pistes sont prises de 13:30 a 15:30 (bowling complet a ces heures-la, libre a 15:30)', JSON.stringify(pris));
  const heure = (t) => r.laser.grille.find((x) => x.time === t);
  ok(r.laser.grille.length > 10, `MONTAGE la grille du laser a ses heures (${r.laser.grille.length})`);
  ok(r.laser.desaccords.length === 0, `chaque heure du laser : grille = reservation (${r.laser.grille.length} heures)`, r.laser.desaccords.join(' | '));
  ok(heure('14:00') && heure('14:00').ok !== false && heure('14:30') && heure('14:30').ok !== false,
    'la partie 1 a 14:00 et a 14:30 se reserve (bowling a 15:30), et la grille le dit', JSON.stringify([heure('14:00'), heure('14:30')]));

  section('B. LE BOWLING : LA GRILLE DIT CE QUE LA RESERVATION FAIT');
  ok(r.bowling.desaccords.length === 0, `chaque heure du bowling : grille = reservation (${r.bowling.grille.length} heures)`, r.bowling.desaccords.join(' | '));

  section('C. CHOISIR NE LIBERE RIEN');
  ok(Boolean(r.propose), `MONTAGE une partie 1 est proposee (${r.propose || 'aucune'})`);
  ok(Array.isArray(r.liberees) && r.liberees.length === 0, `choisir la partie 1 a ${r.propose} ne libere aucune heure dite complete`, JSON.stringify(r.liberees));

  section('D. CONTRE-EPREUVE');
  let casse = null;
  Object.assign(mutation, { ancre: '    for (const arrangement of plusLoinEssais) {', remplace: '    for (const arrangement of []) {', appliquee: 0, trouvee: -1 });
  try {
    casse = await mesurer(charger());
  } finally {
    mutation.ancre = '';
  }
  if (ok(mutation.trouvee === 1 && mutation.appliquee >= 1, 'contre-epreuve montable : la recherche « plus loin » une seule fois dans lib/ops-engine.js', `trouvee ${mutation.trouvee} fois, appliquee ${mutation.appliquee}`)) {
    ok(Boolean(casse) && casse.laser.desaccords.length > 0,
      'sans la recherche « plus loin », la grille du laser contredit la reservation : ce gate ROUGIRAIT', casse ? casse.laser.desaccords.slice(0, 3).join(' | ') : 'mesure impossible');
  }
  const retour = await mesurer(charger());
  ok(retour.laser.desaccords.length === 0, 'le moteur d origine recharge : la grille et la reservation se rejoignent de nouveau');

  console.log(`\n${echecs === 0 ? 'grille-journee-chargee-check: ALL OK' : `grille-journee-chargee-check: ${echecs} echec(s)`}`);
  process.exit(echecs === 0 ? 0 : 1);
}

main().catch((error) => { console.error(error); process.exit(1); });

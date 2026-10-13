// UNE FORMULE ILLIMITEE NE DEMANDE QUE L HEURE D ARRIVEE.
//
// Brief Movsar 2026-09-02 (P1) : « Les formules illimitees (Matin Malin, Kids
// Fun Day...) doivent demander UNIQUEMENT l heure d arrivee, validee par
// rapport aux horaires d ouverture et a la periode de la formule. » Mesure du
// 2026-09-03 sur le vrai moteur : MATIN MALIN affichait une grille de laser
// dont 27 heures sur 28 etaient impossibles (« doit terminer avant 12:00 »),
// et n acceptait que 10:00 ; KIDS FUN DAY ne rendait aucun creneau du tout
// (« Aucun scenario automatique sur »). Le moteur additionnait les etapes
// (arcades 90 min + 2 lasers...) comme un programme a enchainer, alors que
// tout se prend a volonte dans une periode.
//
// Ce gate verifie sur le vrai moteur (l API en processus, snapshot vide) :
//
//   A. MATIN MALIN un samedi (ouvert 10:00, periode jusqu a 12:00) : aucune
//      ancre, des arrivees de 10:00 a 11:30 (l ouverture comprise), chaque
//      visite finit a 12:00, les parties de laser sont a placer sur place.
//   B. MATIN MALIN un mardi (ouvert 14:00) : aucune arrivee, et le message dit
//      pourquoi (la periode est passee avant l ouverture).
//   C. KIDS FUN DAY un mercredi (periode 12:00-17:00) : arrivees de 12:00 a
//      16:30, chaque visite finit a 17:00 ; un jeudi : indisponible ce jour.
//   D. LA VALIDATION SUIT LA GRILLE : une arrivee proposee est acceptee par la
//      planification a l heure exacte ; une arrivee hors periode est refusee
//      avec la plage possible dans la raison.
//   E. LES HORAIRES SONT DES DONNEES : la meme formule sur un centre dont le
//      planning est edite (fermeture avancee) rend une plage differente.
//
// Contre-epreuve par mutation : le moteur cesse de reconnaitre la fenetre
// ouverte, le gate rougit, et le moteur est restaure a l identique.
//
// Lancement : node scripts/open-window-formula-check.js
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const ENGINE = path.join(ROOT, 'lib/ops-engine.js');
const PORT = Number(process.env.PINLANE_OPEN_WINDOW_PORT || 4631);
const BASE_URL = `http://127.0.0.1:${PORT}`;

function mockModule(relPath, exports) {
  const resolu = require.resolve(relPath);
  require.cache[resolu] = { id: resolu, filename: resolu, loaded: true, exports };
}
mockModule('../lib/rate-limit', {
  enforceRateLimit: () => false,
  checkRateLimit: () => ({ allowed: true, remaining: 999, retryAfterSeconds: 0 }),
  getClientIp: () => 'gate',
});

// Les horaires du centre sont une DONNEE : pour la propriete E on remplace le
// planning du samedi (fermeture avancee a 11:00) AVANT que le moteur et l API
// ne capturent getSchedule, importe de lib/booking-config (lib/database charge deja le moteur : le crochet
// se pose donc avant TOUT require applicatif), et on verifie que la plage
// d arrivees suit.
const bookingConfig = require('../lib/booking-config');
const realGetSchedule = bookingConfig.getSchedule;
let scheduleOverride = null;
let todayOverride = null;
let clockOverride = null;
const realToday = bookingConfig.todayStr;
const realClock = bookingConfig.currentTimeDecimal;
bookingConfig.todayStr = () => todayOverride || realToday();
bookingConfig.currentTimeDecimal = () => clockOverride ?? realClock();
bookingConfig.getSchedule = (date, center) => (scheduleOverride ? scheduleOverride(date, center) : realGetSchedule(date, center));

const database = require('../lib/database');
let fixtureBlocks = [];
database.readAvailabilitySnapshot = async (args) => ({ reservations: [], laneStatuses: {}, blocks: fixtureBlocks, date: (args && args.date) || '', centerId: 'libramont' });
const availability = require('../api/public-availability.js');
const { planningAgent } = require('../lib/ops-agents');

// Des jours STRICTEMENT futurs, un par jour de semaine utile, HORS VACANCES
// SCOLAIRES ET FERIES : ces jours-la le centre suit ses horaires vacances et
// MATIN MALIN comme KIDS FUN DAY ne se prennent pas. Le 2026-10-13, le mardi
// suivant (20 octobre, conge d automne) rougissait la section B : le message
// parlait des vacances, pas de l ouverture a 14:00.
function nextDow(dow) {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date()).split('-').map(Number);
  const centre = require('../lib/ops-knowledge').getCenter('libramont');
  const c = new Date(Date.UTC(y, m - 1, d));
  for (let semaines = 0; semaines < 12; semaines += 1) {
    do { c.setUTCDate(c.getUTCDate() + 1); } while (c.getUTCDay() !== dow);
    const jour = c.toISOString().slice(0, 10);
    if (!bookingConfig.isHolidayScheduleDate(jour, centre) && !bookingConfig.isFormulaBlockedDate(jour, centre)) return jour;
  }
  return c.toISOString().slice(0, 10);
}
const SAMEDI = nextDow(6);
const MARDI = nextDow(2);
const MERCREDI = nextDow(3);
const JEUDI = nextDow(4);

let failures = 0;
function ok(condition, message) {
  console.log(`${condition ? 'OK  ' : 'FAIL'}  ${message}`);
  if (!condition) failures += 1;
  return condition;
}

function serve() {
  const server = http.createServer(async (req, res) => {
    try {
      await availability(req, res);
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, message: String(error && error.message) }));
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

function get(chemin) {
  return new Promise((resolve, reject) => {
    http.get(BASE_URL + chemin, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (error) { reject(new Error(`reponse illisible : ${body.slice(0, 200)}`)); }
      });
    }).on('error', reject);
  });
}

function params(formuleId, date, pax = 2) {
  return new URLSearchParams({ date, type: 'formule', formuleId, pax: String(pax), centerId: 'libramont' }).toString();
}
const heures = (payload) => (payload.slots || []).map((slot) => slot.time);
const fins = (payload) => [...new Set((payload.slots || []).map((slot) => slot.opsPlan && slot.opsPlan.endTime))];
const ancres = (payload) => ((payload.anchors && payload.anchors.activities) || []).length;

async function main() {
  const server = await serve();
  try {
    console.log(`[dates] samedi ${SAMEDI}, mardi ${MARDI}, mercredi ${MERCREDI}, jeudi ${JEUDI}`);

    // --- A. MATIN MALIN un samedi ------------------------------------------
    const mmSamedi = await get('/api/public-availability?' + params('mm', SAMEDI));
    ok(ancres(mmSamedi) === 0, `MATIN MALIN : aucune ancre a choisir, seulement l arrivee (${ancres(mmSamedi)} ancre)`);
    const attenduMm = ['10:00', '10:30', '11:00', '11:30'];
    ok(JSON.stringify(heures(mmSamedi)) === JSON.stringify(attenduMm),
      `MATIN MALIN samedi : arrivees de l ouverture a la derniere demi-heure avant 12:00 (${heures(mmSamedi).join(', ') || 'aucune'})`);
    ok(fins(mmSamedi).length === 1 && fins(mmSamedi)[0] === '12:00', `MATIN MALIN samedi : chaque visite finit a la fin de la periode (${fins(mmSamedi).join(', ') || 'aucune'})`);
    const premier = (mmSamedi.slots || [])[0];
    const passPlan = premier && premier.opsPlan && premier.opsPlan.laserPassPlan;
    ok(Boolean(passPlan) && passPlan.mode === 'all_on_site' && Number(passPlan.remainingGames) === 2,
      `MATIN MALIN : les parties de laser se placent sur place avec l equipe (${passPlan ? `${passPlan.mode}, ${passPlan.remainingGames} a placer` : 'aucun plan'})`);
    ok(Boolean(premier) && !(premier.opsPlan.resourceBlocks || []).some((block) => block.resourceType === 'laser_arena'),
      'MATIN MALIN : aucune session de laser posee au planning a une heure fixe');

    // --- B. MATIN MALIN un mardi (ouvre 14:00) -------------------------------
    const mmMardi = await get('/api/public-availability?' + params('mm', MARDI));
    ok(heures(mmMardi).length === 0, `MATIN MALIN mardi : aucune arrivee (le centre ouvre apres la periode) (${heures(mmMardi).length})`);
    ok(/12:00|periode|période|ouvre/i.test(mmMardi.message || ''), `MATIN MALIN mardi : le message explique (« ${mmMardi.message || ''} »)`);

    // --- C. KIDS FUN DAY ---------------------------------------------------
    const kfdMercredi = await get('/api/public-availability?' + params('kfd', MERCREDI));
    const attenduKfd = ['12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30'];
    ok(ancres(kfdMercredi) === 0, `KIDS FUN DAY : aucune ancre (${ancres(kfdMercredi)})`);
    ok(JSON.stringify(heures(kfdMercredi)) === JSON.stringify(attenduKfd),
      `KIDS FUN DAY mercredi : arrivees de 12:00 a 16:30 (${heures(kfdMercredi).join(', ') || 'aucune'})`);
    ok(fins(kfdMercredi).length === 1 && fins(kfdMercredi)[0] === '17:00', `KIDS FUN DAY mercredi : chaque visite finit a 17:00 (${fins(kfdMercredi).join(', ') || 'aucune'})`);
    const kfdJeudi = await get('/api/public-availability?' + params('kfd', JEUDI));
    ok(heures(kfdJeudi).length === 0 && /jour/i.test(kfdJeudi.message || ''), `KIDS FUN DAY jeudi : indisponible ce jour (« ${kfdJeudi.message || ''} »)`);

    // --- D. La validation suit la grille -----------------------------------
    const context = { reservations: [], laneStatuses: {}, blocks: [] };
    const plan1100 = planningAgent({ centerId: 'libramont', date: SAMEDI, type: 'formule', formuleId: 'mm', pax: 2, startTime: '11:00', preference: {} }, context);
    ok(Boolean(plan1100 && plan1100.plan && plan1100.plan.ok) && plan1100.plan.recommended && plan1100.plan.recommended.startTime === '11:00' && plan1100.plan.recommended.endTime === '12:00',
      `MATIN MALIN 11:00 : la planification accepte l arrivee exacte (${plan1100 && plan1100.plan ? `${plan1100.plan.ok} ${plan1100.plan.recommended ? `${plan1100.plan.recommended.startTime}-${plan1100.plan.recommended.endTime}` : plan1100.plan.reason}` : 'aucun plan'})`);
    const plan1200 = planningAgent({ centerId: 'libramont', date: SAMEDI, type: 'formule', formuleId: 'mm', pax: 2, startTime: '12:00', preference: {} }, context);
    ok(Boolean(plan1200 && plan1200.plan) && !plan1200.plan.ok && /10:00/.test(plan1200.plan.reason || '') && /11:30/.test(plan1200.plan.reason || ''),
      `MATIN MALIN 12:00 : refusee avec la plage possible (« ${plan1200 && plan1200.plan ? plan1200.plan.reason : ''} »)`);
    const plan1000 = planningAgent({ centerId: 'libramont', date: SAMEDI, type: 'formule', formuleId: 'mm', pax: 2, startTime: '10:00', preference: {} }, context);
    ok(Boolean(plan1000 && plan1000.plan && plan1000.plan.ok), 'MATIN MALIN 10:00 : l heure d ouverture est reservable');

    // --- E. Les horaires sont des donnees ----------------------------------
    // Le meme samedi, avec un planning EDITE qui ferme a 11:00 : la periode se
    // raccourcit a 11:00 et la derniere arrivee recule a 10:30.
    scheduleOverride = (date, center) => (date === SAMEDI ? { open: 10, close: 11, label: '10h - 11h' } : realGetSchedule(date, center));
    try {
      const mmEdite = await get('/api/public-availability?' + params('mm', SAMEDI));
      ok(JSON.stringify(heures(mmEdite)) === JSON.stringify(['10:00', '10:30']) && fins(mmEdite).length === 1 && fins(mmEdite)[0] === '11:00',
        `horaires edites (fermeture 11:00) : arrivees 10:00 et 10:30, fin 11:00 (${heures(mmEdite).join(', ') || 'aucune'} ; fins ${fins(mmEdite).join(', ') || 'aucune'})`);
    } finally {
      scheduleOverride = null;
    }
    todayOverride = SAMEDI; clockOverride = 12.01;
    const elapsed = await get('/api/public-availability?' + params('mm', SAMEDI));
    ok(heures(elapsed).length === 0 && /plus aucune.*12:00/i.test(elapsed.message || ''), 'MATIN MALIN après midi : aucune arrivée et raison explicite');
    const elapsedCards = await get('/api/public-availability?' + new URLSearchParams({ date: SAMEDI, type: 'durees', pax: '2', centerId: 'libramont' }));
    ok(elapsedCards.formulaAvailability?.mm?.available === false && /12:00/.test(elapsedCards.formulaAvailability.mm.reason), 'Carte MATIN MALIN après midi : indisponibilité issue de la même grille');
    todayOverride = null; clockOverride = null;
    fixtureBlocks = [{ id: 99, centerId: 'libramont', scopeType: 'formula', scopeRef: 'mm', recurrence: 'once', date: SAMEDI, startMin: null, endMin: null, reason: 'Local fixture' }];
    const blocked = await get('/api/public-availability?' + new URLSearchParams({ date: SAMEDI, type: 'durees', pax: '2', centerId: 'libramont' }));
    ok(blocked.formulaAvailability?.mm?.available === false, 'Carte MATIN MALIN bloquée par le centre : indisponible');
    fixtureBlocks = [];
  } finally {
    server.close();
  }

  if (failures) {
    console.error(`\nopen-window-formula-check: ${failures} defaut(s).`);
    process.exit(1);
  }
  console.log('\nopen-window-formula-check: ALL OK (arrivee seule, periode et horaires respectes, validation alignee, horaires = donnees)');
}

if (process.argv.includes('--mutate')) {
  const source = fs.readFileSync(ENGINE, 'utf8');
  const marqueur = "  return Boolean(formula) && String(formula.orderPolicy || '') === 'open_window';";
  if (!source.includes(marqueur)) {
    console.error('mutation impossible : isOpenWindowFormula est introuvable dans lib/ops-engine.js');
    process.exit(1);
  }
  const mute = source.replace(marqueur, '  return false && Boolean(formula);');
  fs.writeFileSync(ENGINE, mute);
  const { spawnSync } = require('child_process');
  const run = spawnSync(process.execPath, [__filename], { encoding: 'utf8' });
  fs.writeFileSync(ENGINE, source);
  console.log(run.stdout || '');
  if (run.status === 0) {
    console.error('CONTRE-EPREUVE RATEE : le gate reste vert quand le moteur ignore la fenetre ouverte.');
    process.exit(1);
  }
  console.log('contre-epreuve OK : fenetre ouverte ignoree, le gate rougit ; moteur restaure a l identique.');
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

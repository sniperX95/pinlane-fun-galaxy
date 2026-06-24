const assert = require('assert');
const { buildSimulationPlanPreview } = require('../lib/ops-simulation');
const { planningAgent } = require('../lib/ops-agents');

const iterationsArg = process.argv.find((arg) => arg.startsWith('--iterations='));
const iterations = iterationsArg ? Math.max(1, Number(iterationsArg.split('=')[1]) || 1) : 2500;

function addDays(dateStr, delta) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + delta);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function runPlanShapeTest() {
  const preview = buildSimulationPlanPreview({ centerId: 'libramont', date: '2026-05-20' });
  const steps = preview.steps;
  const bookingSteps = steps.filter((step) => step.type === 'booking');
  const dates = new Set(bookingSteps.map((step) => step.body.date));
  const channels = new Set(bookingSteps.map((step) => step.channel));
  const types = new Set(bookingSteps.map((step) => step.body.type));
  const names = new Set(bookingSteps.map((step) => step.body.name));
  const formulaSteps = bookingSteps.filter((step) => step.body.type === 'formule');
  const formulaIds = new Set(formulaSteps.map((step) => step.body.formuleId));
  const bowlingDurations = new Set(
    bookingSteps
      .filter((step) => step.body.type === 'bowling')
      .map((step) => Number(step.body.duration)),
  );
  const laserGameCounts = new Set(
    bookingSteps
      .filter((step) => step.body.type === 'laser')
      .map((step) => Number(step.body.laserGames)),
  );

  assert(steps.length >= 150, 'simulation doit couvrir un vrai rush lourd, pas trois actions');
  assert(bookingSteps.length >= 100, 'simulation doit creer beaucoup de reservations variees');
  assert(dates.size >= 18, 'simulation doit couvrir plusieurs semaines de donnees');
  assert(names.size >= 80, 'simulation doit varier les noms et les personas');
  assert(channels.has('sim-client'), 'simulation client manquante');
  assert(channels.has('sim-staff'), 'simulation staff manquante');
  assert(types.has('bowling'), 'booking bowling manquant');
  assert(types.has('laser'), 'booking laser manquant');
  assert(types.has('formule'), 'booking formule manquant');
  assert(formulaSteps.length >= 55, 'simulation doit contenir beaucoup de formules');
  assert(formulaIds.size >= 12, 'simulation doit couvrir presque toutes les formules');
  assert([0.5, 1, 1.5, 2].every((duration) => bowlingDurations.has(duration)), 'durees bowling variees manquantes');
  assert([1, 2, 3].every((games) => laserGameCounts.has(games)), 'parties laser variees manquantes');
  assert(steps.filter((step) => step.type === 'delay').length >= 18, 'retards terrain insuffisants');
  assert(steps.some((step) => step.type === 'orchestrate'), 'lectures orchestrateur manquantes');
  assert(bookingSteps.some((step) => Number(step.body.pax) >= 50), 'cas groupe tres lourd manquant');
  assert(bookingSteps.some((step) => String(step.pressure || '').includes('expected_guardrail')), 'cas garde-fou attendu manquant');
}

function runScenarioProfileTest() {
  const base = { centerId: 'libramont', date: '2026-05-20' };
  const quiet = buildSimulationPlanPreview({ ...base, scenario: 'quiet' });
  const normal = buildSimulationPlanPreview({ ...base, scenario: 'normal' });
  const rush = buildSimulationPlanPreview({ ...base, scenario: 'rush' });
  const max = buildSimulationPlanPreview({ ...base, scenario: 'max' });

  const bookingCount = (preview) => preview.steps.filter((step) => step.type === 'booking').length;
  const bookingTypes = (preview) => new Set(preview.steps.filter((step) => step.type === 'booking').map((step) => step.body.type));

  assert.strictEqual(quiet.profile.id, 'quiet', 'profil quiet non resolu');
  assert.strictEqual(normal.profile.id, 'normal', 'profil normal non resolu');
  assert.strictEqual(rush.profile.id, 'rush', 'profil rush non resolu');
  assert.strictEqual(max.profile.id, 'max', 'profil max non resolu');
  assert(bookingCount(quiet) >= 10 && bookingCount(quiet) <= 12, 'profil quasi vide doit rester autour de 10 reservations');
  assert(bookingCount(normal) > bookingCount(quiet), 'profil normal doit etre plus charge que quiet');
  assert(bookingCount(rush) > bookingCount(normal), 'profil rush doit etre plus charge que normal');
  assert(bookingCount(max) > bookingCount(rush), 'profil max doit couvrir le stress complet');
  ['bowling', 'laser', 'formule'].forEach((type) => {
    assert(bookingTypes(quiet).has(type), `profil quiet doit garder le type ${type}`);
    assert(bookingTypes(normal).has(type), `profil normal doit garder le type ${type}`);
    assert(bookingTypes(rush).has(type), `profil rush doit garder le type ${type}`);
  });
}

function runPlanningSmoke(iterationsCount) {
  const dates = Array.from({ length: 14 }, (_, index) => addDays('2026-05-20', index));
  const types = ['bowling', 'laser', 'formule'];
  const formulas = ['f1', 'f2', 'f3', 'f4', 'f5', 'ffm'];
  const times = ['10:00', '10:30', '12:00', '13:30', '14:00', '15:30', '17:00', '18:30', '20:00'];

  for (let index = 0; index < iterationsCount; index += 1) {
    const type = types[index % types.length];
    const pax = 1 + ((index * 17) % 70);
    const date = dates[index % dates.length];
    const startTime = times[(index * 5) % times.length];
    const body = {
      centerId: 'libramont',
      date,
      startTime,
      pax,
      type,
      duration: type === 'laser' ? 0.5 + ((index % 3) * 0.5) : 0.5 + ((index % 4) * 0.5),
      totalDuration: type === 'formule' ? 2.5 : undefined,
      laserGames: type === 'laser' ? 1 + (index % 3) : 0,
      formuleId: type === 'formule' ? formulas[index % formulas.length] : '',
      preference: {
        firstActivityId: index % 2 ? 'bowling' : 'laser_game',
        preferredBowlingTime: index % 2 ? startTime : '',
        preferredLaserTime: index % 2 ? '' : startTime,
      },
    };
    const result = planningAgent(body, { reservations: [], laneStatuses: {} });
    assert(result && result.plan, `planning vide iteration ${index}`);
    assert(typeof result.plan.ok === 'boolean', `planning sans statut iteration ${index}`);
    assert(result.guardrails.length >= 2, `garde-fous absents iteration ${index}`);
  }
}

runPlanShapeTest();
runScenarioProfileTest();
runPlanningSmoke(iterations);

console.log(JSON.stringify({
  ok: true,
  checks: {
    simulationPlanShape: 'ok',
    simulationProfiles: 'ok',
    planningSmokeIterations: iterations,
  },
}, null, 2));

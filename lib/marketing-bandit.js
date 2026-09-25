// Bandit d'angles (Phase 3) : teste des accroches, amplifie ce qui convertit.
//
// Chaque « angle » est un bras. À la génération, on ÉCHANTILLONNE un angle
// (Thompson sampling gaussien) : au début tout est exploré (variance haute),
// puis on exploite les angles qui gagnent. La récompense vient de la MESURE
// réelle J+14 (effet net > 0 = succès) : jamais d'auto-jugement du LLM. Zéro
// token : pur calcul. Persistance dans marketing_arms.
const { getPool } = require('./database');

const ANGLES = [
  { key: 'actualite', label: 'Accroche actualité', guidance: 'Accroche sur l\'actualité immédiate (la météo du jour, un événement local, le début des vacances), le « pourquoi maintenant ».' },
  { key: 'situation', label: 'Situation vécue', guidance: 'Peins une scène concrète et sensorielle (le strike qui fait crier, la bande de copains, l\'anniversaire réussi) plutôt qu\'une promo frontale.' },
  { key: 'offre', label: 'Offre en avant', guidance: 'Mets l\'offre ou l\'avantage clairement en avant, avec un bénéfice net et lisible.' },
  { key: 'urgence', label: 'Rareté / urgence', guidance: 'Donne une vraie raison d\'agir maintenant (créneaux limités, soirée unique, ça se remplit vite), sans jamais mentir sur la disponibilité.' },
  { key: 'proximite', label: 'Fierté locale', guidance: 'Joue la proximité et l\'ancrage local (« à 5 minutes », « votre centre à [ville] ») et la fierté d\'appartenance.' },
];

function angleByKey(key) {
  return ANGLES.find((angle) => angle.key === key) || null;
}

// Box-Muller → un tirage gaussien standard depuis un générateur uniforme (0,1).
function gaussian(rng) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// PUR : Thompson sampling gaussien. arms = { key: {successes, failures} }.
// Prior Laplace (chaque bras démarre à p=0.5, variance forte → exploration).
function pickAngle(arms = {}, { rng = Math.random } = {}) {
  let bestKey = ANGLES[0].key;
  let bestSample = -Infinity;
  for (const angle of ANGLES) {
    const arm = arms[angle.key] || { successes: 0, failures: 0 };
    const n = (Number(arm.successes) || 0) + (Number(arm.failures) || 0);
    const p = ((Number(arm.successes) || 0) + 1) / (n + 2);
    const variance = (p * (1 - p)) / (n + 1);
    const sample = p + gaussian(rng) * Math.sqrt(variance);
    if (sample > bestSample) { bestSample = sample; bestKey = angle.key; }
  }
  return bestKey;
}

// ── Persistance ──────────────────────────────────────────────────────────────

async function loadArms(centerId, { query } = {}) {
  const run = query || ((text, params) => getPool().query(text, params));
  const result = await run('select angle_key, successes, failures from marketing_arms where center_id = $1;', [centerId]).catch(() => ({ rows: [] }));
  const arms = {};
  for (const row of result.rows) {
    arms[row.angle_key] = { successes: Number(row.successes) || 0, failures: Number(row.failures) || 0 };
  }
  return arms;
}

// Choisit l'angle à tester pour ce centre (fail-soft : sans DB → exploration).
async function recommendAngle(centerId, { query, rng } = {}) {
  const arms = await loadArms(centerId, { query });
  return pickAngle(arms, { rng });
}

// Récompense un angle depuis une mesure réelle (won = effet net positif).
async function recordAngleOutcome(centerId, angleKey, won, { query } = {}) {
  if (!angleByKey(angleKey)) return { ok: false };
  const run = query || ((text, params) => getPool().query(text, params));
  const column = won ? 'successes' : 'failures';
  await run(
    `insert into marketing_arms (center_id, angle_key, successes, failures, updated_at)
     values ($1, $2, $3, $4, now())
     on conflict (center_id, angle_key) do update set ${column} = marketing_arms.${column} + 1, updated_at = now();`,
    [centerId, angleKey, won ? 1 : 0, won ? 0 : 1],
  ).catch(() => null);
  return { ok: true, angleKey, won: Boolean(won) };
}

module.exports = {
  ANGLES,
  angleByKey,
  pickAngle,
  loadArms,
  recommendAngle,
  recordAngleOutcome,
};

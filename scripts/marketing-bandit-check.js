// Bandit d'angles (Phase 3) : tests. Thompson sampling (pur, rng injecté) +
// persistance/reward mockés. Aucun réseau, aucune DB réelle.
const assert = require('assert');
const bandit = require('../lib/marketing-bandit');

async function main() {
  let passed = 0;
  const check = async (name, fn) => { await fn(); passed += 1; console.log('  ok ', name); };
  const constRng = (value) => () => value;

  await check('pickAngle : clé valide même sans données (exploration)', async () => {
    const key = bandit.pickAngle({}, { rng: Math.random });
    assert.ok(bandit.angleByKey(key), `angle valide: ${key}`);
  });

  await check('pickAngle : le bras dominant est exploité', async () => {
    const key = bandit.pickAngle({ offre: { successes: 100, failures: 0 } }, { rng: constRng(0.5) });
    assert.strictEqual(key, 'offre', 'un bras 100/0 doit gagner');
  });

  await check('pickAngle : bras perdant évité au profit d’un neuf', async () => {
    // 'actualite' a beaucoup échoué (moyenne ~0.01, faible variance) → un bras
    // neuf (moyenne 0.5, forte variance) passe devant dès qu'un tirage explore
    // vers le haut. rng=0.1 → tirage gaussien positif → l'exploration l'emporte.
    const key = bandit.pickAngle({ actualite: { successes: 0, failures: 100 } }, { rng: constRng(0.1) });
    assert.notStrictEqual(key, 'actualite', 'un bras 0/100 ne doit pas être choisi');
  });

  await check('recordAngleOutcome : upsert succès (SQL + params)', async () => {
    let captured = null;
    const query = async (sql, params) => { captured = { sql, params }; return { rows: [] }; };
    const r = await bandit.recordAngleOutcome('libramont', 'offre', true, { query });
    assert.strictEqual(r.ok, true);
    assert.ok(/insert into marketing_arms/i.test(captured.sql));
    assert.ok(/successes = marketing_arms\.successes \+ 1/.test(captured.sql), 'incrémente successes');
    assert.deepStrictEqual(captured.params.slice(0, 2), ['libramont', 'offre']);
  });

  await check('recordAngleOutcome : échec incrémente failures', async () => {
    let captured = null;
    await bandit.recordAngleOutcome('libramont', 'offre', false, { query: async (sql) => { captured = sql; return { rows: [] }; } });
    assert.ok(/failures = marketing_arms\.failures \+ 1/.test(captured));
  });

  await check('recordAngleOutcome : angle inconnu ignoré (aucune requête)', async () => {
    const r = await bandit.recordAngleOutcome('libramont', 'nimportequoi', true, { query: async () => { throw new Error('ne doit pas requêter'); } });
    assert.strictEqual(r.ok, false);
  });

  await check('loadArms : mappe les lignes DB', async () => {
    const arms = await bandit.loadArms('libramont', { query: async () => ({ rows: [{ angle_key: 'offre', successes: 3, failures: 1 }] }) });
    assert.deepStrictEqual(arms.offre, { successes: 3, failures: 1 });
  });

  await check('recommendAngle : Thompson depuis les bras chargés', async () => {
    const key = await bandit.recommendAngle('libramont', { query: async () => ({ rows: [{ angle_key: 'urgence', successes: 50, failures: 0 }] }), rng: constRng(0.5) });
    assert.strictEqual(key, 'urgence');
  });

  await check('recommendAngle : fail-soft sans DB → angle valide', async () => {
    const key = await bandit.recommendAngle('libramont', { query: async () => { throw new Error('db down'); }, rng: Math.random });
    assert.ok(bandit.angleByKey(key));
  });

  console.log(`\nmarketing-bandit-check: ${passed} tests OK ✓`);
}

main().catch((error) => { console.error('marketing-bandit-check FAIL:', error.stack || error.message); process.exit(1); });

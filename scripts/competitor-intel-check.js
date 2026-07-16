// Renseignement concurrent (Phase 2 « Éclaireur ») : tests des fonctions backend.
// Google Places (parsing + fail-soft sans clé), extraction structurée du site
// (mapping + grounding + fail-soft). Aucun réseau réel (fetch/LLM mockés).
const assert = require('assert');
const cw = require('../lib/competitor-watch');

async function main() {
  let passed = 0;
  const check = async (name, fn) => { await fn(); passed += 1; console.log('  ok ', name); };

  // ── Google Places (New) ─────────────────────────────────────────────────────
  process.env.GOOGLE_MAPS_API_KEY = 'test-key';

  await check('Places : parse rating + userRatingCount + id, bon endpoint/headers', async () => {
    let captured = null;
    const fetchImpl = async (url, opts) => { captured = { url, opts }; return { ok: true, json: async () => ({ places: [{ id: 'ChIJ123', displayName: { text: 'Bowling Marche' }, rating: 4.2, userRatingCount: 187 }] }) }; };
    const stats = await cw.fetchCompetitorPlaceStats('Bowling Marche', { fetchImpl });
    assert.ok(stats && stats.rating === 4.2 && stats.reviewsCount === 187 && stats.placeId === 'ChIJ123', 'rating/count/id extraits');
    assert.strictEqual(captured.url, 'https://places.googleapis.com/v1/places:searchText');
    assert.strictEqual(captured.opts.headers['X-Goog-Api-Key'], 'test-key');
    assert.ok(captured.opts.headers['X-Goog-FieldMask'].includes('places.rating') && captured.opts.headers['X-Goog-FieldMask'].includes('places.userRatingCount'), 'FieldMask correct');
    assert.ok(/Belgique/.test(JSON.parse(captured.opts.body).textQuery), 'requête ancrée Belgique');
  });

  await check('Places : réponse vide → null', async () => {
    const stats = await cw.fetchCompetitorPlaceStats('Inconnu', { fetchImpl: async () => ({ ok: true, json: async () => ({ places: [] }) }) });
    assert.strictEqual(stats, null);
  });

  await check('Places : HTTP non-ok → null (fail-soft)', async () => {
    const stats = await cw.fetchCompetitorPlaceStats('X', { fetchImpl: async () => ({ ok: false, json: async () => ({}) }) });
    assert.strictEqual(stats, null);
  });

  await check('Places : sans clé → null, aucun appel réseau', async () => {
    delete process.env.GOOGLE_MAPS_API_KEY; delete process.env.GOOGLE_PLACES_API_KEY;
    const stats = await cw.fetchCompetitorPlaceStats('Bowling Marche', { fetchImpl: async () => { throw new Error('ne doit pas être appelé'); } });
    assert.strictEqual(stats, null);
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
  });

  await check('refreshCompetitorPlaces : sans clé → skip, aucune requête', async () => {
    delete process.env.GOOGLE_MAPS_API_KEY; delete process.env.GOOGLE_PLACES_API_KEY;
    const r = await cw.refreshCompetitorPlaces('libramont', { deps: { query: async () => { throw new Error('ne doit pas requêter'); } } });
    assert.strictEqual(r.skipped, 'no_key');
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
  });

  // ── Extraction structurée du site ──────────────────────────────────────────
  await check('signaux site : mapping + filtre labels vides + cap 8', async () => {
    const call = async () => ({ items: [{ type: 'prix', label: 'Bowling', price: '6 €' }, { type: 'offre', label: '', price: '' }, ...Array.from({ length: 10 }, () => ({ type: 'x', label: 'y', price: '' }))] });
    const sigs = await cw.extractCompetitorSignals('Bowling à 6 €, anniversaires, laser game, texte assez long pour dépasser le seuil.', { deps: { callLlmJson: call } });
    assert.ok(sigs.length <= 8, 'cap 8');
    assert.ok(sigs.every((s) => s.label), 'labels vides filtrés');
    assert.ok(sigs.some((s) => s.price === '6 €'), 'prix conservé');
  });

  await check('signaux site : LLM null → [] (fail-soft)', async () => {
    const sigs = await cw.extractCompetitorSignals('texte assez long pour dépasser le seuil minimal de garde ici.', { deps: { callLlmJson: async () => null } });
    assert.deepStrictEqual(sigs, []);
  });

  await check('signaux site : texte trop court → [], aucun appel', async () => {
    const sigs = await cw.extractCompetitorSignals('court', { deps: { callLlmJson: async () => { throw new Error('ne doit pas appeler'); } } });
    assert.deepStrictEqual(sigs, []);
  });

  delete process.env.GOOGLE_MAPS_API_KEY;
  console.log(`\ncompetitor-intel-check: ${passed} tests OK ✓`);
}

main().catch((error) => { console.error('competitor-intel-check FAIL:', error.stack || error.message); process.exit(1); });

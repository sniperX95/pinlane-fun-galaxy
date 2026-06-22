const assert = require('assert');
const {
  buildCenterFacts,
  buildDraftForPlatform,
  buildSignalPack,
  defaultCriteriaFor,
  scoreDraft,
} = require('../lib/marketing-agents');

function run() {
  const libramontFacts = buildCenterFacts('libramont');
  const gemblouxFacts = buildCenterFacts('gembloux');
  const signals = buildSignalPack({
    reservations: [
      { type: 'bowling', pax: 8, price: 78, status: 'pending' },
      { type: 'laser', pax: 18, price: 180, status: 'pending' },
      { type: 'formule', pax: 12, price: 336, status: 'paid' },
    ],
    suggestions: [],
    events: [],
  });

  assert.strictEqual(libramontFacts.hasGolfOClock, false, 'Libramont must not expose Golf oClock');
  assert.strictEqual(gemblouxFacts.hasGolfOClock, true, 'Gembloux must expose Golf oClock');

  for (const platform of ['facebook', 'instagram', 'tiktok', 'linkedin', 'email']) {
    const draft = buildDraftForPlatform({
      platform,
      facts: libramontFacts,
      signals,
      objective: 'formules',
    });
    assert.ok(draft.body.length > 80, `${platform} draft should not be empty`);
    assert.ok(!/golf o'?clock/i.test(draft.body), `${platform} draft must not invent Golf oClock in Libramont`);
    const evaluation = scoreDraft({
      text: draft.body,
      platform,
      facts: libramontFacts,
      signals,
      criteria: defaultCriteriaFor(platform),
    });
    assert.ok(evaluation.score >= 70, `${platform} should be usable or close to usable`);
    assert.strictEqual(evaluation.blocked, false, `${platform} should not be blocked`);
  }

  const blocked = scoreDraft({
    text: 'Golf oClock a Libramont avec session laser privee garantie et escape game.',
    platform: 'facebook',
    facts: libramontFacts,
    signals,
    criteria: defaultCriteriaFor('facebook'),
  });
  assert.strictEqual(blocked.blocked, true, 'Forbidden claims must block the draft');
  assert.ok(blocked.score <= 35, 'Blocked drafts must be heavily capped');

  const gemblouxDraft = buildDraftForPlatform({
    platform: 'facebook',
    facts: gemblouxFacts,
    signals,
    objective: 'laser',
  });
  assert.ok(/Gembloux/i.test(gemblouxDraft.body), 'Gembloux draft must mention the correct center city');
  assert.ok(!/Libramont/i.test(gemblouxDraft.body), 'Gembloux draft must not leak Libramont facts');

  const learnedCriterion = scoreDraft({
    text: 'Une formule anniversaire simple pour famille et groupe local.',
    platform: 'facebook',
    facts: libramontFacts,
    signals,
    criteria: [{
      id: 'observed_anniversaire_simple',
      label: 'Signal observe',
      weight: 1,
      evidence: { keywords: ['anniversaire', 'famille'] },
    }],
  });
  assert.ok(learnedCriterion.score >= 85, 'Learned criteria should reward observed keywords');

  const learnedMissing = scoreDraft({
    text: 'Message neutre sans pattern social particulier.',
    platform: 'facebook',
    facts: libramontFacts,
    signals,
    criteria: [{
      id: 'observed_anniversaire_simple',
      label: 'Signal observe',
      weight: 1,
      evidence: { keywords: ['anniversaire', 'famille'] },
    }],
  });
  assert.ok(learnedMissing.score < learnedCriterion.score, 'Learned criteria should penalize absent observed patterns');

  console.log('Marketing agent tests passed.');
}

run();

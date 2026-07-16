const assert = require('assert');
const {
  buildCenterFacts,
  buildDraftForPlatform,
  buildSignalPack,
  collectFactNumbers,
  defaultCriteriaFor,
  scoreDraft,
  ungroundedPriceClaims,
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

  // ── Défaut C de l'audit : le scorer ne récompense plus l'invention ─────────

  // Garde échantillon : les faits du centre portent bien des chiffres à fonder.
  const factNumbers = collectFactNumbers(libramontFacts, signals);
  assert.ok(factNumbers.size >= 3, `collectFactNumbers doit trouver des chiffres réels (obtenu ${factNumbers.size})`);
  assert.ok(factNumbers.has(String(libramontFacts.laneCount)), 'le nombre de pistes est un chiffre fondé');

  // Le scénario exact de l'audit : « -20% avant 17h » inventé → BLOQUÉ.
  const promoInventee = scoreDraft({
    text: 'Profite de -20% avant 17h sur toutes les pistes ce weekend a Libramont.',
    platform: 'facebook',
    facts: libramontFacts,
    signals,
    criteria: defaultCriteriaFor('facebook'),
  });
  assert.strictEqual(promoInventee.blocked, true, 'un pourcentage inventé doit bloquer le draft');
  assert.ok(promoInventee.score <= 35, 'un draft à promo inventée est plafonné comme un claim interdit');
  assert.ok(promoInventee.priceClaims.some((c) => /pourcentage invente/.test(c)), 'le motif du blocage est explicite');

  // Prix en euros inventé → bloqué aussi.
  const prixInvente = ungroundedPriceClaims('La partie a 3,50 € ce soir seulement !', libramontFacts, signals);
  assert.ok(prixInvente.some((c) => /prix invente/.test(c)), 'un prix en euros absent des faits est un claim');

  // Offre non décidée par le centre (gratuit/offert) → bloquée.
  const offreInventee = ungroundedPriceClaims('Une partie offerte pour chaque anniversaire !', libramontFacts, signals);
  assert.ok(offreInventee.length > 0, 'une offre inventée (offert/gratuit) est un claim');

  // Un chiffre FONDÉ (les pistes réelles du centre) ne bloque pas et crédite.
  const chiffreFonde = scoreDraft({
    text: `Nos ${libramontFacts.laneCount} pistes de bowling t'attendent a Libramont pour ton anniversaire en famille. Reserve ta piste.`,
    platform: 'facebook',
    facts: libramontFacts,
    signals,
    criteria: defaultCriteriaFor('facebook'),
  });
  assert.strictEqual(chiffreFonde.blocked, false, 'un chiffre fondé sur les faits ne bloque pas');
  const proofFonde = chiffreFonde.checks.find((c) => c.id === 'proof_from_data');
  assert.ok(proofFonde && proofFonde.score >= 78, 'un chiffre fondé crédite proof_from_data');

  // Un chiffre NON fondé (sans motif prix) ne bloque pas mais ne crédite RIEN.
  const chiffreNonFonde = scoreDraft({
    text: 'Deja 8541 visiteurs conquis ce mois-ci, viens voir pourquoi tout le monde en parle a Libramont.',
    platform: 'facebook',
    facts: libramontFacts,
    signals,
    criteria: defaultCriteriaFor('facebook'),
  });
  const proofNonFonde = chiffreNonFonde.checks.find((c) => c.id === 'proof_from_data');
  assert.ok(proofNonFonde && proofNonFonde.score <= 58, `un chiffre non fondé ne crédite pas la preuve (obtenu ${proofNonFonde.score})`);

  // Le SEUL prix réel des faits (golf o'clock Gembloux, 12,50 €/pers) est
  // fondé, sous ses deux écritures. Garde échantillon : le fait existe.
  assert.ok(JSON.stringify(gemblouxFacts).includes('12.5'), 'échantillon non vide : le prix golf o\'clock est dans les faits Gembloux');
  assert.strictEqual(ungroundedPriceClaims('Le golf o\'clock a 12,50 € par personne.', gemblouxFacts, signals).length, 0,
    'un prix présent dans les faits du centre ne bloque pas (12,50 €)');
  assert.strictEqual(ungroundedPriceClaims('Le golf o\'clock a 12.5 euros par personne.', gemblouxFacts, signals).length, 0,
    'même prix, autre écriture : toujours fondé');
  assert.ok(ungroundedPriceClaims('La partie a 9,99 € ce soir.', gemblouxFacts, signals).some((c) => /prix invente/.test(c)),
    'un autre montant reste un prix inventé, même dans le centre qui a un prix');

  // Un nombre qui existe ailleurs dans les faits (horaire, capacité) ne fonde
  // JAMAIS un pourcentage : « -20% » bloque même si « 20 » traîne quelque part.
  assert.ok(factNumbers.has('20') || factNumbers.has('100') || factNumbers.size > 0, 'échantillon : des nombres non-prix existent dans les faits');
  assert.ok(ungroundedPriceClaims('Profite de -20% avant 17h', libramontFacts, signals).some((c) => /pourcentage invente/.test(c)),
    'un pourcentage n\'est fondé que par un fait qui porte un pourcentage');

  // Anti-pollution : les tournures de forbiddenClaims (« 100% disponible »,
  // « reduction garantie ») ne rendent JAMAIS un pourcentage ou une offre fondés.
  assert.ok(ungroundedPriceClaims('Salle 100% disponible ce soir', libramontFacts, signals).some((c) => /pourcentage invente/.test(c)),
    'le « 100% » de forbiddenClaims ne fonde pas un pourcentage');
  const reduction = ungroundedPriceClaims('Grosse reduction ce soir', libramontFacts, signals);
  assert.ok(reduction.some((c) => /reduction/.test(c)), 'le mot « reduction » de forbiddenClaims ne fonde pas une offre');

  console.log('Marketing agent tests passed.');
}

run();

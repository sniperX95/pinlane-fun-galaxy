const assert = require('assert');
const {
  buildCenterFacts,
  buildDraftForPlatform,
  buildSignalPack,
  buildMarketingStrategy,
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


  // ── UN CREUX MESURE N EST PAS UN CENTRE VIDE ──────────────────────────────
  // `quiet = activeReservations.length <= 3` sur la fenetre du contexte
  // marketing, qui vaut TRENTE JOURS. Trois reservations en un mois sur un
  // centre de 8 pistes ouvert 6 jours sur 7, ce n est pas une periode calme :
  // c est un centre a l arret. L angle « creneau calme » se declenchait donc
  // exactement quand il n y a rien a remplir, et jamais quand il y a un vrai
  // trou (mesure du 2026-09-09 : 75 reservations sur 30 jours dont un mardi
  // entierement mort, quiet = false, l angle ne partait pas).

  // MONTAGE : le fait du creux vient du VRAI producteur, pas de ma main. Sans
  // ca, ce gate testerait un `dow_worst` que l entrepot n emet peut-etre pas.
  const { computeFactsFromRows } = require('../lib/center-metrics');
  const lignesEntrepot = Array.from({ length: 140 }, (unused, i) => {
    const jour = new Date(Date.parse('2026-04-05T00:00:00Z') + i * 86400000);
    const dow = jour.getUTCDay();
    const visiteurs = dow === 2 ? 40 : 150 + dow * 5;
    return {
      date: jour.toISOString().slice(0, 10),
      visitors: visiteurs,
      revenue_total: visiteurs * 30,
      weather_tmax: null,
      is_school_holiday: false,
    };
  });
  const bundleReel = computeFactsFromRows(lignesEntrepot);
  const faitCreux = (bundleReel.facts || []).find((f) => f.id === 'dow_worst');
  assert.ok(faitCreux, 'MONTAGE : l entrepot emet bien un fait dow_worst');
  assert.strictEqual(faitCreux.dow, 2, 'MONTAGE : le creux mesure est bien le mardi');
  assert.strictEqual(faitCreux.confidence, 'solide',
    `MONTAGE : sur 140 jours la confiance est solide (obtenu ${faitCreux.confidence})`);

  const resaActives = Array.from({ length: 75 }, () => ({
    type: 'bowling', pax: 5, price: 150, status: 'paid', start_time: '18:00',
  }));
  const resaArret = resaActives.slice(0, 3);

  const actifAvecCreux = buildSignalPack({ reservations: resaActives, dataFacts: bundleReel });
  assert.strictEqual(actifAvecCreux.quiet, false, 'MONTAGE : 75 reservations, la fenetre n est pas vide');
  assert.ok(actifAvecCreux.creux, 'LE POINT : un centre ACTIF avec un creux mesure declenche l angle');
  assert.strictEqual(actifAvecCreux.creux.dow, 2, 'et le creux est celui que l entrepot a mesure');

  // CONTRE-PREUVE, le defaut d avant : un centre a l arret SANS creux mesure
  // ne declenche plus rien. C etait le seul cas ou l angle partait.
  const arretSansCreux = buildSignalPack({ reservations: resaArret, dataFacts: null });
  assert.strictEqual(arretSansCreux.quiet, true, 'MONTAGE : 3 reservations, la fenetre EST vide');
  assert.strictEqual(arretSansCreux.creux, null,
    'CONTRE-PREUVE : une fenetre vide ne fabrique plus un creneau calme');

  // FAIL-OPEN : sans entrepot, aucun creux. On ne constate que ce qu on mesure.
  assert.strictEqual(buildSignalPack({ reservations: resaActives, dataFacts: null }).creux, null,
    'sans entrepot, aucun creux');

  // EXPLORATOIRE NE COMPTE PAS : sous 90 jours l entrepot marque lui-meme ses
  // faits ainsi, et un angle commercial ne se batit pas sur une donnee que son
  // producteur declare insuffisante.
  const bundleCourt = computeFactsFromRows(lignesEntrepot.slice(0, 40));
  const faitCourt = (bundleCourt.facts || []).find((f) => f.id === 'dow_worst');
  assert.ok(!faitCourt || faitCourt.confidence === 'exploratoire',
    `MONTAGE : sur 40 jours le fait est exploratoire (obtenu ${faitCourt && faitCourt.confidence})`);
  assert.strictEqual(buildSignalPack({ reservations: resaActives, dataFacts: bundleCourt }).creux, null,
    'un creux exploratoire ne declenche pas l angle');

  // L INSIGHT EST LE FAIT, plus une phrase prefaite. « Periode calme detectee:
  // pousser les creneaux tranquilles remplit les creux » ne nommait ni le jour,
  // ni le chiffre, ni l echantillon.
  const strategieAvecCreux = buildMarketingStrategy({
    facts: libramontFacts, signals: actifAvecCreux, drafts: [], observations: [],
  });
  const caseCreux = (strategieAvecCreux.gapAnalysis || []).find((g) => g.occasion === 'creneau_calme');
  assert.ok(caseCreux, 'MONTAGE : l occasion creneau calme est bien dans l analyse');
  assert.strictEqual(caseCreux.status, 'a-renforcer', 'le creux mesure rend l occasion prioritaire');
  assert.strictEqual(caseCreux.insight, faitCreux.label,
    `l insight EST le fait mesure, recopie (obtenu : ${caseCreux.insight})`);
  assert.ok(!/Periode calme detectee/.test(caseCreux.insight),
    'et plus la phrase prefaite qui ne nommait rien');

  // CONTRE-PREUVE : un run PERSISTE avant ce changement n a pas de `creux`.
  // L angle ne part pas, et rien ne casse.
  const signauxAnciens = { ...actifAvecCreux };
  delete signauxAnciens.creux;
  const strategieAncienne = buildMarketingStrategy({
    facts: libramontFacts, signals: signauxAnciens, drafts: [], observations: [],
  });
  const caseAncienne = (strategieAncienne.gapAnalysis || []).find((g) => g.occasion === 'creneau_calme');
  assert.ok(caseAncienne, 'CONTRE-PREUVE : un run d avant ne fait pas tomber l analyse');
  assert.notStrictEqual(caseAncienne.status, 'a-renforcer',
    'et son angle ne se declenche pas faute de creux mesure');

  // L OBJECTIF DU CYCLE SUIT LE CREUX, pas la fenetre. `chooseObjective` n est
  // pas exporte : on l observe par l occasion que buildDraftForPlatform
  // choisit, qui est aussi ce que le gerant verra.
  const brouillonAvecCreux = buildDraftForPlatform({
    platform: 'facebook', facts: libramontFacts, signals: actifAvecCreux,
  });
  assert.strictEqual(brouillonAvecCreux.occasion, 'creneau_calme',
    `un creux mesure oriente le cycle sur le creneau calme (obtenu ${brouillonAvecCreux.occasion})`);
  const brouillonFenetreVide = buildDraftForPlatform({
    platform: 'facebook', facts: libramontFacts, signals: arretSansCreux,
  });
  assert.notStrictEqual(brouillonFenetreVide.occasion, 'creneau_calme',
    'une fenetre vide n oriente plus le cycle sur le creneau calme');

  // ET L ATTRIBUTION PAR CANAL suit la meme regle. Elle porte la meme
  // intention que chooseObjective et n avait aucune couverture : la mutation
  // qui la recablait sur une fenetre vide laissait tout vert.
  // Le canal `email` recoit creneau_calme par AFFINITE de canal, avec ou sans
  // creux : ce n est pas le signal. Ce qui change, c est la PRIORITE, qui le
  // place sur le premier canal dont l affinite le contient, donc facebook.
  const { assignPlatformOccasions } = require('../lib/marketing-agents');
  const canauxAvecCreux = assignPlatformOccasions(actifAvecCreux);
  assert.strictEqual(canauxAvecCreux.facebook, 'creneau_calme',
    `un creux mesure rend le creneau calme prioritaire (obtenu ${JSON.stringify(canauxAvecCreux)})`);
  const canauxFenetreVide = assignPlatformOccasions(arretSansCreux);
  assert.notStrictEqual(canauxFenetreVide.facebook, 'creneau_calme',
    `une fenetre vide ne le rend plus prioritaire (obtenu ${JSON.stringify(canauxFenetreVide)})`);
  console.log('Marketing agent tests passed.');
}

run();

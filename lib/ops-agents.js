const { analyzeDelay, buildLearningSuggestions, planReservation } = require('./ops-engine');
const { architectureAgent, orchestratorAgent } = require('./agent-skill-registry');
const { getCenter, getFormula } = require('./ops-knowledge');
const { planningDecisionFor } = require('./validation-policy');

function planningAgent(input, context = {}) {
  const plan = planReservation(input, context);
  const policy = planningDecisionFor(plan);
  return {
    agent: 'planning-agent',
    ok: plan.ok,
    decision: policy.decision,
    requiresHumanReview: policy.requiresHumanReview,
    plan,
    guardrails: [
      'Confirmation automatique seulement si le mode de validation et le risque le permettent.',
      'Les conflits bowling/laser/tables sont bloquants.',
      'Validation humaine uniquement en dernier recours: conflit bloquant, risque critical ou aucun scenario sur.',
    ],
    nextAction: policy.nextAction,
  };
}

function delayAgent(input, context = {}) {
  const impact = analyzeDelay(input, context);
  return {
    agent: 'delay-agent',
    ok: impact.ok,
    decision: impact.ok ? 'delay_ready_for_confirmation' : 'alternative_required',
    impact,
    nextAction: impact.actions[0],
  };
}

function communicationAgent(input) {
  const center = getCenter(input.centerId || 'libramont');
  const formula = input.formuleId ? getFormula(input.formuleId) : null;
  const clientName = input.name || 'Bonjour';
  const arrivalTime = input.startTime || input.plan?.recommended?.startTime || '';
  const arrivalLead = formula ? 15 : 10;
  const plan = input.plan?.recommended || input.opsPlan || null;
  const commitmentLines = Array.isArray(plan?.customerCommitment) ? plan.customerCommitment : [];
  const fixedCommitments = Array.isArray(plan?.entitlements?.fixedCommitments) ? plan.entitlements.fixedCommitments : [];
  const subject = formula
    ? `Votre demande ${formula.name} chez ${center.name}`
    : `Votre reservation chez ${center.name}`;

  const body = [
    `${clientName},`,
    '',
    formula
      ? `Nous avons bien reçu votre demande pour ${formula.name}. Le système bloque les activités horaires possibles et garde les activités libres souples sur place.`
      : `Votre reservation bowling est bien prise en compte.`,
    arrivalTime ? `Merci de prevoir une arrivee ${arrivalLead} minutes avant ${arrivalTime}.` : `Merci de prevoir une arrivee ${arrivalLead} minutes avant l'heure confirmee.`,
    fixedCommitments.length
      ? `Créneaux prévus: ${fixedCommitments.slice(0, 3).map((item) => `${item.label} ${item.startTime}`).join(', ')}.`
      : '',
    commitmentLines.length ? commitmentLines[0] : '',
    formula && center.id === 'libramont'
      ? `Pour le Laser Game à Libramont, le groupe doit idéalement être complet avant le lancement afin d'éviter un décalage des activités suivantes.`
      : '',
    '',
    'A tres vite,',
    center.name,
  ].filter(Boolean).join('\n');

  return {
    agent: 'communication-agent',
    ok: true,
    channel: input.channel || 'email',
    subject,
    body,
    reminders: [
      { offsetHours: -48, channel: 'email', label: 'Rappel J-2' },
      { offsetHours: -6, channel: 'email', label: 'Rappel jour J' },
    ],
    smsStandby: {
      enabled: false,
      reason: 'Fournisseur SMS non branche; garder le code possible sans afficher de promesse client.',
    },
    commitmentModel: {
      source: 'competitive_playbook',
      stages: [
        'demande recue',
        'confirmation avec créneaux critiques',
        'rappel J-2',
        'rappel jour J',
        'journalisation no-show ou retard pour apprentissage',
      ],
    },
    guardrails: [
      'Ne pas promettre une formule complexe comme confirmee si le planning indique validation humaine.',
      'Toujours rappeler l arrivee en avance pour les formules avec laser.',
    ],
  };
}

function directorAgent(input = {}) {
  const reservations = Array.isArray(input.reservations) ? input.reservations : [];
  const byCenter = reservations.reduce((accumulator, reservation) => {
    const centerId = reservation.centerId || input.centerId || 'libramont';
    if (!accumulator[centerId]) accumulator[centerId] = { reservations: 0, pax: 0, revenue: 0, risks: 0 };
    accumulator[centerId].reservations += 1;
    accumulator[centerId].pax += Number(reservation.pax || 0);
    accumulator[centerId].revenue += Number(reservation.price || 0);
    if (reservation.riskLevel === 'high' || reservation.riskLevel === 'critical') accumulator[centerId].risks += 1;
    return accumulator;
  }, {});

  return {
    agent: 'director-agent',
    ok: true,
    summary: byCenter,
    alerts: Object.entries(byCenter)
      .filter(([, stats]) => stats.risks > 0)
      .map(([centerId, stats]) => `${centerId}: ${stats.risks} reservation(s) a risque a surveiller.`),
  };
}

function learningAgent(input = {}) {
  const result = buildLearningSuggestions(input.events || []);
  return {
    agent: 'learning-agent',
    ok: true,
    ...result,
    guardrails: [
      'Aucune modification automatique des durees critiques.',
      'Chaque suggestion doit être approuvée par direction/staff avant activation.',
      'Les données observées restent rattachées au centre pour éviter de mélanger Libramont, Gembloux et Ciney.',
    ],
  };
}

// L'agent marketing existait dans le code mais n'etait declare NULLE PART : dix
// agents portent une mission, des skills et des garde-fous, lui n'en avait
// aucun. Ce handler est son point d'entree runtime, et l'audit du catalogue
// exige qu'il existe pour qu'il ait le droit d'etre « live ».
//
// Ce qu'il fait, et volontairement rien de plus : dire si l'agent a de quoi
// PARLER pour ce centre, et sinon pourquoi. Il n'appelle aucun modele et ne
// rend aucun texte : ecrire est le travail de lib/center-advisor.js, qui a ses
// propres garde-fous. Melanger les deux ferait un handler qui depense de
// l'argent sans qu'on le lui demande.
// Fail-soft : un catalogue illisible ne doit pas empecher l agent de dire s il
// a de quoi parler. Il rendra une liste vide, ce qui est visible, plutot que
// de jeter une exception au milieu d un cycle.
function gardesDeclarees() {
  try {
    const { getAgentSkillCatalog } = require('./agent-skill-registry');
    const agent = (getAgentSkillCatalog().agents || []).find((a) => a.id === 'marketing-agent');
    return (agent && agent.guardrails) || [];
  } catch {
    return [];
  }
}

function marketingAgent(input = {}) {
  const { peutAffirmer } = require('./center-guards');
  const { porteDeQuoiParler, NATURES_PROPOSABLES } = require('./center-advisor');
  const centerId = input.centerId || 'libramont';
  const fiche = input.fiche || {};
  const faits = Object.values(fiche);

  const parNature = {};
  NATURES_PROPOSABLES.forEach((nature) => {
    parNature[nature] = faits.filter((f) => peutAffirmer(f, nature).autorise).length;
  });
  // Toujours zero, par construction : un changement de regle commerciale ne se
  // conclut pas depuis un historique produit sous l'ancienne regle. Le chiffre
  // est expose pour que ce refus soit VISIBLE, pas implicite.
  parNature.regle_commerciale = faits.filter((f) => peutAffirmer(f, 'regle_commerciale').autorise).length;

  const aDeQuoiParler = porteDeQuoiParler(fiche);
  return {
    agent: 'marketing-agent',
    ok: true,
    centerId,
    faitsDisponibles: faits.length,
    parNature,
    aDeQuoiParler,
    motif: aDeQuoiParler
      ? ''
      : 'ni horaires, ni prix, ni estimation solide pour ce centre : rien a dire, et aucun appel modele',
    // LUE dans le registre, jamais recopiee. Cette liste existait en deux
    // exemplaires, ici et dans ops-knowledge/agent-skills.json, et les deux
    // avaient deja diverge : le registre ignorait l audience, les unites, la
    // memoire et le cadratin. Deux copies d une meme verite divergent toujours,
    // alors il n y en a plus qu une.
    guardrails: gardesDeclarees(),
  };
}

module.exports = {
  architectureAgent,
  communicationAgent,
  marketingAgent,
  delayAgent,
  directorAgent,
  learningAgent,
  orchestratorAgent,
  planningAgent,
};

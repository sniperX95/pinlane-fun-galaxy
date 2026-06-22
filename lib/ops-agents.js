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

module.exports = {
  architectureAgent,
  communicationAgent,
  delayAgent,
  directorAgent,
  learningAgent,
  orchestratorAgent,
  planningAgent,
};

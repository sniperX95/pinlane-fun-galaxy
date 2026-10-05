function hasBlockingConflict(recommended) {
  return (recommended?.conflicts || []).some((conflict) => conflict.severity === 'blocking');
}

function isLaserBusy(recommended) {
  const sharing = recommended?.laserSharing || null;
  if (sharing?.sharedNow) return true;
  return (recommended?.resourceBlocks || []).some((block) =>
    block.resourceType === 'laser_arena'
    && (Number(block.playersBefore || 0) > 0 || block.sharedSession === true));
}

function shouldRequestHumanReview({ validationMode = '', recommended = null } = {}) {
  // Choix ops Movsar (2026-07-18) : le staff n'est alerte (email) QUE sur
  // l'intention explicite de l'operateur. Le risque eleve mais placable
  // s'auto-confirme et remonte dans « A surveiller » (via riskLevel), sans
  // email. Les cas vraiment infaisables (pas de plan sur / conflit bloquant)
  // sont geres directement dans reservation-ops (staff_review) et bloques cote
  // public (blockOnlineConfirmation). Objectif : moins de mails, tous
  // actionnables.
  if (validationMode === 'required') return true;
  if (validationMode === 'required_when_laser_busy') return isLaserBusy(recommended);
  return false;
}

function planningDecisionFor(plan = {}) {
  const recommended = plan.recommended || null;
  // Validation humaine = intention explicite de l'operateur OU conflit bloquant
  // (resa non placable). Le pas-de-plan est traite juste apres (no_safe_slot).
  const requiresHumanReview = shouldRequestHumanReview({ validationMode: plan.validationMode, recommended })
    || hasBlockingConflict(recommended);

  if (!plan.ok) {
    return {
      decision: 'no_safe_slot',
      requiresHumanReview: false,
      nextAction: 'Demander un ajustement horaire ou une validation staff.',
    };
  }

  if (requiresHumanReview) {
    return {
      decision: 'staff_review_required',
      requiresHumanReview: true,
      nextAction: `Préparer la validation staff pour ${recommended?.startTime || 'le créneau proposé'}, risque ${recommended?.risk?.level || 'à vérifier'}.`,
    };
  }

  return {
    decision: 'auto_confirmation_ready',
    requiresHumanReview: false,
    nextAction: `Confirmer ${recommended?.startTime || 'le créneau proposé'} si aucun nouveau blocage n'est détecté, risque ${recommended?.risk?.level || 'normal'}.`,
  };
}

// LE MODE DE VALIDATION D UNE FORMULE, POUR UN CENTRE (2026-10-05).
// Movsar : « l idee c est de pouvoir rendre ca parametrable completement cote
// produit ». Le reglage se pose dans Tarifs & formules, par centre
// (formule_overrides.human_validation) ; sans reglage du centre, c est celui du
// catalogue, sinon « seulement si impossible ». UNE seule lecture pour le
// moteur (ops-engine), l agent mail (ce qu il promet au client) et l ecran :
// trois lectures divergeraient.
const MODES_VALIDATION = ['recommended', 'required_when_laser_busy', 'required'];
function modeValidationFormule(formula, centerId) {
  let override = null;
  try {
    const { resolveFormuleOverride } = require('./booking-config');
    if (typeof resolveFormuleOverride === 'function' && formula && formula.id) override = resolveFormuleOverride(formula.id, centerId);
  } catch (error) { override = null; }
  const mode = String((override && override.humanValidation) || (formula && formula.humanValidation) || 'recommended').trim();
  return MODES_VALIDATION.includes(mode) ? mode : 'recommended';
}

module.exports = {
  MODES_VALIDATION,
  modeValidationFormule,
  planningDecisionFor,
  shouldRequestHumanReview,
};

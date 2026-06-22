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

function shouldRequestHumanReview({ isFormula = false, validationMode = '', recommended = null, planOk = false } = {}) {
  if (!isFormula) return false;
  if (!planOk || hasBlockingConflict(recommended)) return true;
  if (recommended?.risk?.level === 'critical') return true;
  if (validationMode === 'required') return true;
  if (validationMode === 'required_when_laser_busy') return isLaserBusy(recommended);
  return false;
}

function planningDecisionFor(plan = {}) {
  const recommended = plan.recommended || null;
  const isFormula = Boolean(plan.formulaId || plan.formulaName);
  const requiresHumanReview = shouldRequestHumanReview({
    isFormula,
    validationMode: plan.validationMode,
    recommended,
    planOk: plan.ok,
  });

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

module.exports = {
  planningDecisionFor,
  shouldRequestHumanReview,
};

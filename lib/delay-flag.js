// Helpers PURS pour le flag d'affichage « retard » d'une réservation
// (opsPlan.delayFlag). Extraits de api/ops.js pour être testables isolément :
// aucune dépendance (hors Date) : sûrs à require côté handler ET côté test.

// Estampe / actualise le flag de retard sur un plan Ops.
// - minutes      : delta de CE retard (min). CUMULÉ au flag existant pour que le
//                  badge affiche le total (+5 puis +10 => +15), au lieu de ne
//                  montrer que le dernier delta.
// - from / to    : bornes horaires. `from` (heure d'origine) est CONSERVÉ depuis
//                  le premier retard, jamais écrasé par une heure déjà décalée.
// - existingFlag : le delayFlag actuellement en base. Nécessaire car `opsPlan`
//                  reçu ici est le plan DÉJÀ décalé et ne porte plus l'ancien
//                  flag : c'est de lui qu'on lit le cumul et l'origine.
// - origin       : snapshot pré-décalage { startTime, opsPlan, lanes } posé au
//                  1er retard, utilisé par le revert pour restaurer le vrai
//                  créneau. Conservé tel quel aux retards suivants.
function stampDelayFlag(opsPlan, { minutes, from, to, existingFlag = null, origin = null } = {}) {
  const base = opsPlan && typeof opsPlan === 'object' ? opsPlan : {};
  const prev = existingFlag && !existingFlag.cleared ? existingFlag : null;
  return {
    ...base,
    delayFlag: {
      minutes: (prev ? Number(prev.minutes) || 0 : 0) + (Number(minutes) || 0),
      from: prev && prev.from ? prev.from : (from || ''),
      to: to || '',
      origin: prev && prev.origin ? prev.origin : (origin || null),
      flaggedAt: new Date().toISOString(),
      cleared: false,
    },
  };
}

// Marque le flag comme retiré (masquage visuel), sans toucher à l'horaire.
function clearDelayFlagOnPlan(opsPlan) {
  if (!opsPlan || typeof opsPlan !== 'object' || !opsPlan.delayFlag) return { plan: opsPlan, changed: false };
  return {
    plan: {
      ...opsPlan,
      delayFlag: {
        ...opsPlan.delayFlag,
        cleared: true,
        clearedAt: new Date().toISOString(),
      },
    },
    changed: true,
  };
}

module.exports = { stampDelayFlag, clearDelayFlagOnPlan };

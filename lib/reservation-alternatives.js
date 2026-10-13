const {
  FORMULES,
  getFormuleAvailability,
  getFormuleTotalDuration,
  getRequiredLaneCount,
  getSchedule,
} = require('./booking-config');
const { readStaffState } = require('./database');
const { prepareReservationOps } = require('./reservation-ops');
const { normalizeReservationRequest } = require('./reservation-request');
const { getCenter } = require('./ops-knowledge');
const { demandeUneArrivee } = require('./ops-engine');

function centerDocFor(request) {
  try {
    return getCenter(request.centerId || 'libramont') || null;
  } catch (error) {
    return null;
  }
}

function addDays(dateStr, delta) {
  const [year, month, day] = String(dateStr || '').split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + Number(delta || 0));
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function timeToMinutes(value) {
  const [hours, minutes] = String(value || '00:00').split(':').map(Number);
  return (Number(hours) || 0) * 60 + (Number(minutes) || 0);
}

function minutesToTime(value) {
  const safe = Math.max(0, Math.round(Number(value) || 0));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

function formulaFor(request) {
  return FORMULES.find((item) => item.id === (request.formuleId || request.formulaId)) || null;
}

function getRequestDurationHours(request) {
  if (request.type === 'formule') {
    const formula = formulaFor(request);
    return Math.max(0.5, Number(getFormuleTotalDuration(formula) || request.totalDuration || 2.5));
  }
  return Math.max(0.5, Number(request.totalDuration || request.duration || 1));
}

function getSearchDates(date, spanDays) {
  const offsets = [];
  for (let index = 0; index <= Number(spanDays || 10); index += 1) offsets.push(index);
  [14, 21, 28].forEach((offset) => {
    if (!offsets.includes(offset)) offsets.push(offset);
  });
  return offsets.map((offset) => addDays(date, offset));
}

function buildPreferenceVariants(request) {
  if (request.type !== 'formule') {
    const demande = request.preference || {};
    const variantes = [{ preference: demande, reason: 'Même demande' }];
    // UNE VISITE DONT LES HEURES ETAIENT POSEES (formulaire Fun Galaxy,
    // tunnel) : ces heures-la sont justement celles qui viennent d etre prises.
    // Les garder pour chaque candidat renvoyait tout au lendemain a la meme
    // heure, alors que la journee demandee avait encore de la place (campagne
    // du 2026-09-29 : le perdant de la course pour la derniere piste de 16:00
    // ne se voyait proposer que le dimanche). Relachees, le moteur recompose
    // la visite autour de l heure candidate, comme pour une formule.
    const heures = demande.preferredTimes && typeof demande.preferredTimes === 'object' ? Object.values(demande.preferredTimes) : [];
    const posees = heures.some(Boolean) || Boolean(demande.preferredBowlingTime || demande.preferredLaserTime)
      || (Array.isArray(demande.laserGameTimes) && demande.laserGameTimes.some(Boolean));
    if (posees) {
      variantes.push({
        preference: { ...demande, preferredTimes: {}, preferredBowlingTime: '', preferredLaserTime: '', laserGameTimes: [], laserPlacement: 'scheduled' },
        reason: 'Même demande, horaires adaptés',
      });
    }
    return variantes;
  }

  const base = request.preference || {};
  // UNE FORMULE PAR HEURE D ARRIVEE (2026-10-12) : chaque candidat est une
  // arrivee a son heure (findReservationAlternatives la pose), et le moteur y
  // place lui-meme le bowling et le laser, dans les deux ordres. Les heures du
  // client sont relachees : elles viennent d etre refusees, et a une autre
  // arrivee elles tomberaient avant elle.
  if (demandeUneArrivee(base)) {
    return [{
      preference: { ...base, preferredTimes: {}, preferredBowlingTime: '', preferredLaserTime: '', laserGameTimes: [], laserPlacement: 'scheduled' },
      reason: 'Même formule, heure d’arrivée adaptée',
    }];
  }
  const order = Array.isArray(base.activityOrder) ? base.activityOrder : [];
  const variants = [
    { preference: base, reason: 'Même ordre et mêmes heures' },
    {
      // Variante « horaires adaptés » : on relâche les ancres choisies (et
      // l'option laser sur place) pour laisser le moteur recomposer librement.
      preference: {
        ...base,
        preferredTimes: {},
        preferredBowlingTime: '',
        preferredLaserTime: '',
        laserPlacement: 'scheduled',
      },
      reason: 'Même ordre, horaires adaptés',
    },
  ];

  const timed = order.filter((item) => ['bowling', 'laser_game'].includes(item));
  timed.forEach((firstActivityId) => {
    variants.push({
      preference: {
        ...base,
        firstActivityId,
        activityOrder: [
          firstActivityId,
          ...order.filter((item) => item !== firstActivityId),
        ],
        preferredTimes: {},
        preferredBowlingTime: '',
        preferredLaserTime: '',
        laserPlacement: 'scheduled',
      },
      reason: firstActivityId === 'laser_game' ? 'Laser avant Bowling' : 'Bowling avant Laser',
    });
  });

  const seen = new Set();
  return variants.filter((variant) => {
    const key = JSON.stringify(variant.preference || {});
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getTimeCandidates({ request, date, durationHours, formula, center = null }) {
  const schedule = getSchedule(date, center);
  if (!schedule) return [];

  let min = Math.round(Number(schedule.open || 10) * 60);
  let max = Math.round(Number(schedule.close || 22) * 60) - Math.round(durationHours * 60);
  if (formula?.timeLimit?.min) min = Math.max(min, Math.round(Number(formula.timeLimit.min) * 60));
  if (formula?.timeLimit?.max) max = Math.min(max, Math.round(Number(formula.timeLimit.max) * 60) - Math.round(durationHours * 60));
  if (max < min) return [];

  const requested = timeToMinutes(request.startTime || minutesToTime(min));
  const offsets = date === request.date
    ? [30, -30, 60, -60, 90, -90, 120, -120, 150, 180, 240, 300, 360, 0]
    : [0, 30, 60, 90, 120, 150, 180, 240, 300, 360, -30, -60];
  const values = [];
  offsets.forEach((offset) => {
    const candidate = Math.min(max, Math.max(min, requested + offset));
    const rounded = Math.round(candidate / 15) * 15;
    if (rounded >= min && rounded <= max) values.push(rounded);
  });
  for (let value = min; value <= max; value += 30) values.push(value);
  return [...new Set(values)].sort((left, right) => {
    const sameDayWeight = date === request.date ? 0 : 100000;
    return sameDayWeight + Math.abs(left - requested) - Math.abs(right - requested);
  });
}

function hasBlockingConflict(plan) {
  return (plan?.conflicts || []).some((conflict) => conflict.severity === 'blocking');
}

function summarizeAlternative(request, candidate, ops, variantReason) {
  const plan = ops.opsPlan || {};
  const blocks = Array.isArray(plan.resourceBlocks) ? plan.resourceBlocks : [];
  const bowling = blocks.find((block) => block.resourceType === 'bowling_lane');
  const laser = blocks.find((block) => block.resourceType === 'laser_arena');
  const lanes = plan.assignedLanes || bowling?.lanes || candidate.lanes || [];
  const parts = [];

  if (request.type === 'formule') {
    parts.push(request.label || formulaFor(request)?.name || 'Formule');
    if (plan.arrivalPlan?.arrivalTime) parts.push(`Arrivée ${plan.arrivalPlan.arrivalTime}`);
    if (bowling?.startTime) parts.push(`Bowling ${bowling.startTime}`);
    if (laser?.startTime) parts.push(`Laser ${laser.startTime}`);
    if (plan.endTime) parts.push(`fin ${plan.endTime}`);
  } else if (request.type === 'laser') {
    const remaining = plan.laserSharing?.remainingPlaces ?? laser?.remainingWeapons;
    parts.push(`Laser ${candidate.startTime}`);
    if (Number.isFinite(Number(remaining))) parts.push(`${remaining} place(s) restantes après votre groupe`);
  } else {
    parts.push(`Bowling ${candidate.startTime}`);
    if (lanes.length) parts.push(`piste(s) ${lanes.join(', ')}`);
  }

  return {
    date: candidate.date,
    startTime: candidate.startTime,
    type: request.type,
    formuleId: request.formuleId || '',
    label: request.label || '',
    pax: Number(request.pax || 0),
    lanes,
    opsPlan: plan,
    validationStatus: ops.validationStatus || 'confirmed',
    riskLevel: ops.riskLevel || plan.risk?.level || '',
    reason: variantReason,
    summary: parts.filter(Boolean).join(' · '),
  };
}

async function findReservationAlternatives(input, options = {}) {
  const channel = options.channel || input.channel || 'public';
  const request = normalizeReservationRequest(input, { channel });
  const limit = Math.max(1, Number(options.limit || 5));
  const spanDays = Math.max(1, Number(options.spanDays || 10));
  const maxChecks = Math.max(limit, Number(options.maxChecks || 120));
  const formula = formulaFor(request);
  const center = centerDocFor(request);
  const bowlingConfig = center?.resources?.bowling || null;
  const durationHours = getRequestDurationHours(request);
  const alternatives = [];
  const reviewAlternatives = [];
  const seen = new Set();
  let checks = 0;
  const parArrivee = request.type === 'formule' && demandeUneArrivee(request.preference);
  // Le verdict sans arrivee des combinaisons d un jour ne depend pas de
  // l heure d arrivee : il se garde d un candidat a l autre du meme jour.
  const memosArrivee = new Map();
  const memoDuJour = (jour) => {
    if (!memosArrivee.has(jour)) memosArrivee.set(jour, new Map());
    return memosArrivee.get(jour);
  };

  // Chaque candidat relit le state de la même date en DB : on mémoïse le
  // snapshot par date le temps d'une recherche (1 lecture/date, N+1 évité).
  const snapshotCache = new Map();
  const readStateCached = (snapshotDate, snapshotCenterId) => {
    const cacheKey = `${snapshotDate}|${snapshotCenterId}`;
    if (!snapshotCache.has(cacheKey)) {
      // Une alternative ne tombe jamais sur des horaires retenus par un autre
      // client en train de reserver (migration 0049).
      snapshotCache.set(cacheKey, readStaffState(snapshotDate, snapshotCenterId, { avecBlocages: true, saufJeton: options.saufJeton || '' }).catch((error) => {
        snapshotCache.delete(cacheKey);
        throw error;
      }));
    }
    return snapshotCache.get(cacheKey);
  };

  for (const date of getSearchDates(request.date, spanDays)) {
    if (request.type === 'formule' && formula) {
      const availability = getFormuleAvailability(formula, date, Number(request.pax || 1), '', center);
      if (!availability.ok) continue;
    }
    for (const startMinutes of getTimeCandidates({ request, date, durationHours, formula, center })) {
      // Une arrivee se choisit sur la grille (:00/:30), comme a l ecran.
      if (parArrivee && startMinutes % 30 !== 0) continue;
      for (const variant of buildPreferenceVariants(request)) {
        if (checks >= maxChecks) break;
        const startTime = minutesToTime(startMinutes);
        const key = `${date}|${startTime}|${JSON.stringify(variant.preference || {})}`;
        if (seen.has(key)) continue;
        seen.add(key);
        checks += 1;

        const candidate = {
          ...request,
          channel,
          date,
          startTime,
          opsPlan: null,
          ops_plan: null,
          lanes: [],
          laneCount: getRequiredLaneCount(request.type, request.pax, request.formuleId || '', bowlingConfig),
          preference: parArrivee
            ? { ...(variant.preference || {}), arrivalTime: startTime }
            : (variant.preference || {}),
        };

        try {
          const ops = await prepareReservationOps(candidate, channel, {
            readState: readStateCached,
            ...(parArrivee ? { arrivalMemo: memoDuJour(date) } : {}),
          });
          if (ops.blockOnlineConfirmation || !ops.opsPlan || hasBlockingConflict(ops.opsPlan)) continue;
          const alternative = summarizeAlternative(request, candidate, ops, variant.reason);
          if (ops.requiresHumanReview) reviewAlternatives.push(alternative);
          else alternatives.push(alternative);
          if (alternatives.length >= limit) return alternatives.slice(0, limit);
        } catch (error) {
          // Alternative candidate rejected; keep searching.
        }
      }
      if (checks >= maxChecks) break;
    }
    if (alternatives.length >= limit || checks >= maxChecks) break;
  }

  return alternatives.length ? alternatives.slice(0, limit) : reviewAlternatives.slice(0, limit);
}

module.exports = {
  findReservationAlternatives,
};

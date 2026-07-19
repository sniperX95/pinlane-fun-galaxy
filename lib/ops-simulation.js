const {
  createCommunication,
  createDecisionLog,
  createOpsEvent,
  createReservation,
  createSimulationRun,
  deleteSimulationData,
  getLatestSimulationRun,
  getSimulationRun,
  listCommunications,
  listDecisionLogs,
  readAdminRangeState,
  readStaffState,
  updateReservation,
  updateSimulationRun,
} = require('./database');
const { emailShell, buildMessage } = require('./ops-communications');
const { delayAgent } = require('./ops-agents');
const { prepareReservationOps } = require('./reservation-ops');
const { findReservationAlternatives } = require('./reservation-alternatives');
const {
  FORMULES,
  BOWLING_PRICES,
  getFormuleTotalDuration,
  getFormuleAvailability,
  getSchedule,
  todayStr,
} = require('./booking-config');
const { runOrchestratorForCenter } = require('./orchestrator-runner');

const DEFAULT_CENTER_ID = 'libramont';
const DEFAULT_SPEED_FACTOR = 96;
const SIMULATION_EMAIL_DOMAIN = 'simulation.fungalaxy.invalid';

function normalizeCenterId(value = DEFAULT_CENTER_ID) {
  return String(value || DEFAULT_CENTER_ID).trim().toLowerCase();
}

function assertSimulationCenter(run, centerId = DEFAULT_CENTER_ID) {
  const expectedCenterId = normalizeCenterId(centerId);
  if (run && normalizeCenterId(run.centerId) !== expectedCenterId) {
    throw new Error('Simulation inaccessible pour ce centre.');
  }
}

const SIMULATION_PROFILES = {
  quiet: {
    id: 'quiet',
    label: 'Quasi vide',
    description: 'Une journee calme avec 10 demandes pour verifier que le moteur reste lisible.',
    bookingLimit: 10,
    dayLimit: 1,
    mix: { bowling: 4, laser: 3, formule: 3 },
    statusLimit: 4,
    delayLimit: 2,
    orchestratorLimit: 2,
    startBatch: 24,
  },
  normal: {
    id: 'normal',
    label: 'Journee normale',
    description: 'Un vrai service exploitable: bowling, laser, formules, retards et validations.',
    bookingLimit: 34,
    dayLimit: 4,
    mix: { bowling: 11, laser: 9, formule: 14 },
    statusLimit: 14,
    delayLimit: 6,
    orchestratorLimit: 4,
    startBatch: 36,
  },
  rush: {
    id: 'rush',
    label: 'Rush fort',
    description: 'Journee lourde multi-activites pour tester les limites terrain et les alternatives.',
    bookingLimit: 78,
    dayLimit: 14,
    mix: { bowling: 22, laser: 18, formule: 38 },
    statusLimit: 28,
    delayLimit: 16,
    orchestratorLimit: 8,
    startBatch: 48,
  },
  max: {
    id: 'max',
    label: 'Stress maximum',
    description: 'Tout le scenario: charge maximale, multi-jours, garde-fous et cas extremes.',
    bookingLimit: 999,
    dayLimit: 28,
    mix: null,
    statusLimit: 999,
    delayLimit: 999,
    orchestratorLimit: 999,
    startBatch: 80,
  },
};

const SIMULATION_PROFILE_ALIASES = {
  low: 'quiet',
  light: 'quiet',
  calme: 'quiet',
  empty: 'quiet',
  standard: 'normal',
  real: 'normal',
  reel: 'normal',
  rush_day_plus_two_week_proof: 'max',
  stress: 'max',
  full: 'max',
  expert: 'max',
};

function resolveSimulationProfile(value = 'max') {
  const raw = String(value || 'max').toLowerCase();
  const id = SIMULATION_PROFILE_ALIASES[raw] || raw;
  return SIMULATION_PROFILES[id] || SIMULATION_PROFILES.max;
}

function getSimulationProfiles() {
  return Object.values(SIMULATION_PROFILES).map((profile) => ({
    id: profile.id,
    label: profile.label,
    description: profile.description,
    bookingLimit: profile.bookingLimit >= 900 ? 'max' : profile.bookingLimit,
    dayLimit: profile.dayLimit,
    startBatch: profile.startBatch,
  }));
}

function assertDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) {
    throw new Error('Date simulation invalide.');
  }
  return String(value);
}

function addDays(dateStr, delta) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + delta);
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

function addMinutes(time, minutes) {
  return minutesToTime(timeToMinutes(time) + Number(minutes || 0));
}

function eventTimestamp(date, time) {
  const safeDate = assertDate(date);
  const safeTime = /^\d{2}:\d{2}$/.test(String(time || '')) ? String(time) : '10:00';
  return `${safeDate}T${safeTime}:00+02:00`;
}

function euro(value) {
  return Math.round(Number(value) || 0);
}

function formulaPrice(formuleId, pax) {
  const formula = FORMULES.find((item) => item.id === formuleId);
  if (!formula) return 0;
  if (formula.type === 'per_lane') return formula.price * Math.max(1, Math.ceil(Number(pax || 1) / 6));
  return formula.price * Math.max(1, Number(pax || 1));
}

function bowlingPrice(duration, pax) {
  return euro((BOWLING_PRICES[duration] || 39) * Math.max(1, Math.ceil(Number(pax || 1) / 6)));
}

function laserPrice(games, pax) {
  const perPerson = games >= 3 ? 25 : games >= 2 ? 18 : 10;
  return euro(perPerson * Math.max(1, Number(pax || 1)));
}

function makeRunId(centerId, date) {
  return `sim_${centerId}_${date}_${Date.now().toString(36)}`;
}

function makeEmail(runId, key) {
  return `${key}.${runId}@${SIMULATION_EMAIL_DOMAIN}`.toLowerCase().replace(/[^a-z0-9@._-]/g, '');
}

function makePhone(index) {
  return `+32470${String(860000 + index).slice(-6)}`;
}

function hashString(value) {
  let hash = 2166136261;
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createRng(seed) {
  let value = hashString(seed) || 0x9e3779b9;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(random, values) {
  return values[Math.floor(random() * values.length) % values.length];
}

function rotatePick(values, index) {
  return values[index % values.length];
}

function dayOfWeek(dateStr) {
  const [year, month, day] = String(dateStr).split('-').map(Number);
  return new Date(year, month - 1, day).getDay();
}

function clampTimeToSchedule(dateStr, desiredTime, durationHours = 1) {
  const schedule = getSchedule(dateStr);
  if (!schedule) return desiredTime;
  const desired = timeToMinutes(desiredTime);
  const open = Math.round(Number(schedule.open) * 60);
  const close = Math.round(Number(schedule.close) * 60);
  const duration = Math.round(Number(durationHours || 1) * 60);
  const latest = Math.max(open, close - duration);
  return minutesToTime(Math.min(Math.max(desired, open), latest));
}

function bookingStep(key, minute, body, options = {}) {
  return {
    type: 'booking',
    key,
    minute,
    channel: options.channel || 'sim-client',
    persona: options.persona || 'client-agent',
    pressure: options.pressure || 'normal',
    body,
  };
}

function statusStep(key, minute, status, options = {}) {
  return {
    type: 'status',
    key,
    minute,
    status,
    agentId: options.agentId || 'field-pilot-agent',
    reason: options.reason || '',
  };
}

function delayStep(key, minute, delayMinutes, reasonId, options = {}) {
  return {
    type: 'delay',
    key,
    minute,
    delayMinutes,
    reasonId,
    agentId: options.agentId || 'delay-agent',
    note: options.note || '',
  };
}

function orchestratorStep(minute, date, options = {}) {
  return {
    type: 'orchestrate',
    key: options.key || `orchestrate-${minute}`,
    minute,
    date,
    agentId: 'orchestrator-agent',
    reason: options.reason || 'Lecture rush en continu',
  };
}

function baseReservation(centerId, runId, date, index, overrides = {}) {
  return {
    centerId,
    name: overrides.name || `SIM Client ${String(index).padStart(2, '0')}`,
    phone: overrides.phone || makePhone(index),
    email: overrides.email || makeEmail(runId, `client${index}`),
    date,
    startTime: overrides.startTime || '12:00',
    duration: Number(overrides.duration || 1),
    totalDuration: Number(overrides.totalDuration || overrides.duration || 1),
    pax: Number(overrides.pax || 4),
    status: overrides.status || 'pending',
    type: overrides.type || 'bowling',
    formuleId: overrides.formuleId || '',
    label: overrides.label || 'Bowling classique',
    basePrice: euro(overrides.basePrice ?? overrides.price ?? 0),
    price: euro(overrides.price ?? 0),
    paymentMethod: overrides.paymentMethod || 'Sur place',
    extras: overrides.extras || [],
    preference: overrides.preference || {},
    laserGames: overrides.laserGames || overrides.games || 0,
  };
}

function buildRushSteps({ centerId, date, runId }) {
  const random = createRng(`${runId}:${centerId}:${date}`);
  const steps = [];
  const bookingKeys = {
    bowling: [],
    laser: [],
    formule: [],
  };
  let index = 1;

  const names = [
    'Famille Martin',
    'Anniversaire Mila',
    'Club Basket Centre',
    'Ecole Saint-Pierre',
    'Famille Laurent',
    'Entreprise Ardenne',
    'Anniversaire Noah',
    'Groupe Scouts Sud',
    'Famille Dubois',
    'Team Comptoir',
    'Anniversaire Jade',
    'College Saint-Hubert',
    'Afterwork Garage Central',
    'Famille Leclercq',
    'Anniversaire Adam',
    'Club Foot Libramont',
    'Maison des Jeunes',
    'Anniversaire Lina',
    'Groupe Cousins',
    'Equipe Pharmacie',
    'Famille Lambert',
    'Anniversaire Ines',
    'EVJF Camille',
    'Club Judo',
    'Anniversaire Sami',
    'Groupe Proximite',
    'Famille Simon',
    'Ecole Communale',
    'Anniversaire Nora',
    'Team Atelier',
    'Famille Petit',
    'Anniversaire Yanis',
    'Association Parents',
    'Groupe Entre Amis',
    'Famille Renard',
    'Anniversaire Emma',
    'Bureau Fiduciaire',
    'Anniversaire Lucas',
    'Groupe Voisins',
    'Equipe Boulangerie',
    'Famille Colin',
    'Anniversaire Tom',
    'Stage Vacances',
    'Club Danse',
    'Anniversaire Sarah',
    'Groupe Hockey',
    'Famille Bernard',
    'Entreprise Nord',
  ];

  const firstActivities = ['agent', 'bowling', 'laser_game', 'arcade_time', 'minigolf_blacklight'];
  const delayReasons = ['late_arrival', 'incomplete_group', 'bar_queue', 'bowling_issue', 'laser_bug'];
  const delayNotes = [
    'Le groupe arrive en plusieurs vagues.',
    'Passage bar avant lancement.',
    'Parent organisateur bloque au paiement.',
    'Briefing plus long que prevu.',
    'Une partie du groupe veut inverser les activites.',
    'Retard caisse et chaussures.',
    'Groupe laser incomplet au moment de lancer.',
    'Correction manuelle demandee par le staff.',
  ];

  const formulaById = (formuleId) => FORMULES.find((item) => item.id === formuleId) || null;
  const textHas = (formula, token) => (formula?.desc || []).some((line) => String(line).toLowerCase().includes(token));
  const hasLaser = (formula) => textHas(formula, 'laser');
  const hasArcade = (formula) => textHas(formula, 'arcade');
  const hasMiniGolf = (formula) => textHas(formula, 'mini');
  const hasPlayground = (formula) => textHas(formula, 'plaine');

  const addBooking = (key, minute, channel, body, options = {}) => {
    const finalBody = {
      ...body,
      name: `${body.name} #${String(index).padStart(2, '0')}`,
      email: body.email || makeEmail(runId, `${key}-${index}`),
      phone: body.phone || makePhone(index),
    };
    if (bookingKeys[finalBody.type]) bookingKeys[finalBody.type].push(key);
    steps.push(bookingStep(key, minute, finalBody, { channel, ...options }));
    index += 1;
  };

  const makeName = (kind, order) => {
    const base = rotatePick(names, order + Math.floor(random() * 9));
    if (kind === 'formule') return `${base} Formule`;
    if (kind === 'laser') return `${base} Laser`;
    return `${base} Bowling`;
  };

  const defaultFormulaTime = (formula, order = 0) => {
    const id = formula?.id || '';
    if (id === 'mm') return '10:00';
    if (id === 'kfd') return rotatePick(['12:00', '12:30', '13:00', '13:30', '14:00'], order);
    if (id === 'bts') return rotatePick(['18:00', '18:30', '19:00', '19:30'], order);
    if (id === 'css') return rotatePick(['18:00', '19:00', '20:00'], order);
    if (id === 'hlg') return rotatePick(['14:30', '15:30', '17:00', '18:30'], order);
    if (id === 'ffm') return rotatePick(['18:00', '18:30', '19:00', '20:00'], order);
    return rotatePick(['12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '17:00', '18:00', '19:00', '20:00'], order);
  };

  const findFormulaDate = (formuleId, preferredOffset = 0, pax = 6, order = 0) => {
    const formula = formulaById(formuleId);
    if (!formula) return date;
    for (let attempt = 0; attempt < 56; attempt += 1) {
      const candidate = addDays(date, preferredOffset + attempt);
      const schedule = getSchedule(candidate);
      if (!schedule) continue;
      if (formula.id === 'mm' && Number(schedule.open) > 10) continue;
      const startTime = clampTimeToSchedule(candidate, defaultFormulaTime(formula, order + attempt), getFormuleTotalDuration(formula) || 1);
      const availability = getFormuleAvailability(formula, candidate, Math.max(Number(pax || 1), Number(formula.minPax || 1)), startTime);
      if (availability.ok) return candidate;
    }
    return date;
  };

  const buildFormulaPreference = (formula, startTime, order) => {
    let firstActivityId = rotatePick(firstActivities, order);
    if (firstActivityId === 'agent') firstActivityId = '';
    if (firstActivityId === 'bowling' && !formula?.hasBowling) {
      firstActivityId = hasLaser(formula) ? 'laser_game' : hasMiniGolf(formula) ? 'minigolf_blacklight' : hasArcade(formula) ? 'arcade_time' : '';
    }
    if (firstActivityId === 'laser_game' && !hasLaser(formula)) {
      firstActivityId = formula?.hasBowling ? 'bowling' : hasMiniGolf(formula) ? 'minigolf_blacklight' : hasArcade(formula) ? 'arcade_time' : '';
    }
    if (!firstActivityId) {
      if (formula?.hasBowling && order % 2 === 0) firstActivityId = 'bowling';
      else if (hasLaser(formula)) firstActivityId = 'laser_game';
      else if (hasMiniGolf(formula)) firstActivityId = 'minigolf_blacklight';
      else if (hasArcade(formula)) firstActivityId = 'arcade_time';
      else if (hasPlayground(formula)) firstActivityId = 'playground';
    }
    return {
      firstActivityId,
      preferredBowlingTime: formula?.hasBowling && (firstActivityId === 'bowling' || order % 3 === 0) ? startTime : '',
      preferredLaserTime: hasLaser(formula) && (firstActivityId === 'laser_game' || order % 4 === 0) ? startTime : '',
      arrivalConfidence: rotatePick(['normal', 'uncertain', 'late_risk', 'very_punctual'], order),
      staffHint: rotatePick([
        'Client veut rester flexible entre les activites.',
        'Anniversaire avec boissons avant ou apres activite.',
        'Groupe susceptible de demander une pause libre.',
        'Laisser le planning proposer le meilleur enchainement.',
      ], order),
    };
  };

  const scheduleFor = (targetDate, desiredTime, duration) => clampTimeToSchedule(targetDate, desiredTime, duration);

  const bowlingStarts = ['12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30', '18:30', '19:30', '20:00', '20:30', '21:00', '21:30'];
  const bowlingPax = [2, 4, 5, 6, 7, 8, 11, 12, 14, 16, 18, 21, 23, 28, 31, 36, 42, 55];
  const bowlingDurations = [0.5, 1, 1.5, 2, 1, 1.5, 0.5, 2];

  bowlingStarts.forEach((start, order) => {
    const pax = rotatePick(bowlingPax, order * 3);
    const duration = rotatePick(bowlingDurations, order);
    const startTime = scheduleFor(date, start, duration);
    const price = bowlingPrice(duration, pax);
    addBooking(`bowl-${order}-${start.replace(':', '')}`, 4 + order * 5, order % 3 === 0 ? 'sim-staff' : 'sim-client', baseReservation(centerId, runId, date, index, {
      name: makeName('bowling', order),
      startTime,
      pax,
      duration,
      totalDuration: duration,
      price,
      basePrice: price,
      status: rotatePick(['pending', 'pending', 'confirmed', 'paid'], order),
      type: 'bowling',
      label: duration === 1 ? 'Bowling classique' : `Bowling ${String(duration).replace('.', ',')}h`,
    }), {
      persona: order % 3 === 0 ? 'staff-agent' : 'client-agent',
      pressure: pax >= 36 ? 'large_bowling_multi_lane' : duration !== 1 ? 'bowling_duration_variant' : 'bowling_direct',
    });
  });

  const laserStarts = ['12:00', '12:25', '12:50', '13:20', '13:50', '14:20', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30', '18:00', '18:25', '19:00', '20:00'];
  const laserPax = [4, 6, 8, 10, 12, 15, 18, 21, 24, 27, 30, 7, 13, 19, 23, 29];
  const laserGames = [1, 2, 3, 1, 2, 1, 3, 2];

  laserStarts.forEach((start, order) => {
    const pax = rotatePick(laserPax, order * 5);
    const games = rotatePick(laserGames, order);
    const startTime = scheduleFor(date, start, games * 0.5);
    const price = laserPrice(games, pax);
    addBooking(`laser-${order}-${start.replace(':', '')}`, 12 + order * 6, order % 4 === 0 ? 'sim-staff' : 'sim-client', baseReservation(centerId, runId, date, index, {
      name: makeName('laser', order),
      startTime,
      pax,
      duration: games * 0.5,
      totalDuration: games * 0.5,
      price,
      basePrice: price,
      type: 'laser',
      label: `${games} partie${games > 1 ? 's' : ''} Laser Game`,
      laserGames: games,
      preference: {
        preferredLaserTime: startTime,
        firstActivityId: 'laser_game',
        chainLaserGames: order % 3 === 0,
      },
    }), {
      pressure: games > 1 ? 'laser_multiple_games_choose_chain_or_pause' : 'laser_shared_session_capacity',
    });
  });

  const formulaWave = [
    'f1', 'f4', 'f2', 'f5', 'f3', 'f4', 'f6', 'f7', 'f8', 'f1', 'f4', 'f2',
    'f5', 'f3', 'f4', 'f6', 'f7', 'f8', 'f1', 'f4', 'f2', 'f5', 'f3', 'f4',
    'bts', 'kfd', 'hlg', 'ffm', 'css', 'mm', 'f7', 'f8', 'f4', 'f2', 'f1', 'f5',
    'f3', 'f4', 'f6', 'ffm',
  ];
  const formulaPax = [6, 7, 8, 10, 12, 14, 16, 18, 21, 24, 27, 30, 11, 15, 19, 23, 28, 34, 36, 42];

  formulaWave.forEach((formuleId, order) => {
    const formula = formulaById(formuleId);
    if (!formula) return;
    const pax = Math.max(Number(formula.minPax || 1), rotatePick(formulaPax, order * 7));
    const preferredOffset = order < 18 ? 0 : 1 + (order % 14);
    const formulaDate = findFormulaDate(formuleId, preferredOffset, pax, order);
    const duration = Number(formula.bowlingDur || (formula.hasBowling ? 1 : 0.5));
    const totalDuration = getFormuleTotalDuration(formula) || 2.5;
    const startTime = clampTimeToSchedule(formulaDate, defaultFormulaTime(formula, order), totalDuration);
    const price = formulaPrice(formuleId, pax);
    const pressure = [
      formuleId === 'f4' ? 'formula_bowling_laser_complex' : 'formula_mix',
      hasLaser(formula) ? 'laser_resource' : 'no_laser',
      formula.hasBowling ? 'bowling_resource' : 'no_bowling',
      pax >= 30 ? 'large_group' : 'normal_group',
    ].join('|');

    addBooking(`formula-${order}-${formuleId}-${formulaDate.replace(/-/g, '')}`, 22 + order * 4, order % 5 === 0 ? 'sim-staff' : 'sim-client', baseReservation(centerId, runId, formulaDate, index, {
      name: makeName('formule', order),
      startTime,
      pax,
      duration,
      totalDuration,
      price,
      basePrice: price,
      type: 'formule',
      formuleId,
      label: formula.name || formuleId.toUpperCase(),
      preference: buildFormulaPreference(formula, startTime, order),
    }), {
      pressure,
      persona: order % 5 === 0 ? 'staff-agent' : 'client-agent',
    });
  });

  const guardrailProbes = [
    { key: 'probe-bowling-oversize-70', minute: 57, type: 'bowling', startTime: '14:30', pax: 70, duration: 1, name: 'Probe Bowling 70 joueurs', pressure: 'expected_guardrail_bowling_oversize' },
    { key: 'probe-laser-oversize-58', minute: 61, type: 'laser', startTime: '14:30', pax: 58, games: 1, name: 'Probe Laser 58 joueurs', pressure: 'expected_guardrail_laser_split' },
    { key: 'probe-laser-oversize-76', minute: 69, type: 'laser', startTime: '18:00', pax: 76, games: 2, name: 'Probe Laser 76 joueurs', pressure: 'expected_guardrail_laser_multiple_waves' },
    { key: 'probe-formula-f4-52', minute: 74, type: 'formule', formuleId: 'f4', startTime: '16:30', pax: 52, name: 'Probe Formule 4 52 joueurs', pressure: 'expected_guardrail_formula_large_wave' },
    { key: 'probe-formula-too-small', minute: 82, type: 'formule', formuleId: 'f4', startTime: '15:30', pax: 3, name: 'Probe Formule trop petit', pressure: 'expected_guardrail_formula_minimum' },
    { key: 'probe-special-wrong-day', minute: 89, type: 'formule', formuleId: 'ffm', startTime: '15:00', pax: 8, name: 'Probe Friday Madness mauvais jour', pressure: 'expected_guardrail_special_day' },
  ];

  guardrailProbes.forEach((probe) => {
    const formula = formulaById(probe.formuleId);
    const price = probe.type === 'laser'
      ? laserPrice(probe.games || 1, probe.pax)
      : probe.type === 'formule'
        ? formulaPrice(probe.formuleId, probe.pax)
        : bowlingPrice(probe.duration, probe.pax);
    addBooking(probe.key, probe.minute, probe.type === 'bowling' ? 'sim-staff' : 'sim-client', baseReservation(centerId, runId, date, index, {
      name: probe.name,
      startTime: probe.startTime,
      pax: probe.pax,
      duration: probe.type === 'laser' ? (probe.games || 1) * 0.5 : probe.duration || Number(formula?.bowlingDur || 1),
      totalDuration: probe.type === 'formule' ? getFormuleTotalDuration(formula) || 3 : probe.type === 'laser' ? (probe.games || 1) * 0.5 : probe.duration || 1,
      type: probe.type,
      formuleId: probe.formuleId || '',
      label: formula?.name || (probe.type === 'laser' ? 'Laser Game test limite' : 'Bowling groupe limite'),
      price,
      basePrice: price,
      laserGames: probe.games || 0,
      preference: probe.type === 'formule'
        ? buildFormulaPreference(formula, probe.startTime, index)
        : { firstActivityId: probe.type === 'laser' ? 'laser_game' : 'bowling' },
    }), { pressure: probe.pressure });
  });

  bookingKeys.bowling.slice(0, 8).forEach((key, order) => {
    steps.push(statusStep(key, 35 + order * 13, rotatePick(['arrived', 'paid', 'completed'], order), {
      reason: rotatePick(['Arrivee comptoir', 'Paiement caisse', 'Partie terminee', 'Client relance par staff'], order),
    }));
  });
  bookingKeys.laser.slice(0, 8).forEach((key, order) => {
    steps.push(statusStep(key, 42 + order * 11, rotatePick(['arrived', 'confirmed', 'completed'], order), {
      reason: rotatePick(['Groupe laser complet', 'Briefing pret', 'Session lancee', 'Retour arene confirme'], order),
    }));
  });
  bookingKeys.formule.slice(0, 10).forEach((key, order) => {
    steps.push(statusStep(key, 48 + order * 10, rotatePick(['confirmed', 'arrived', 'paid'], order), {
      reason: rotatePick(['Confirmation automatique surveillee', 'Arrivee famille', 'Paiement formule', 'Staff verifie ordre activites'], order),
    }));
  });

  const delayTargets = [
    ...bookingKeys.formule.slice(1, 14),
    ...bookingKeys.laser.slice(2, 9),
    ...bookingKeys.bowling.slice(3, 10),
  ];
  delayTargets.slice(0, 22).forEach((key, order) => {
    steps.push(delayStep(key, 62 + order * 8, rotatePick([5, 7, 10, 12, 15, 18, 22, 25], order), rotatePick(delayReasons, order), {
      note: rotatePick(delayNotes, order),
    }));
  });

  [25, 45, 65, 85, 105, 125, 145, 170, 195, 225, 255, 285].forEach((minute, stepIndex) => {
    steps.push(orchestratorStep(minute, date, {
      key: `orchestrate-live-${stepIndex}`,
      reason: rotatePick([
        'Controle continu rush staff',
        'Analyse saturation bowling et laser',
        'Verification formules complexes',
        'Lecture retards et messages a envoyer',
      ], stepIndex),
    }));
  });

  for (let dayOffset = 1; dayOffset <= 21; dayOffset += 1) {
    const baseMinute = 310 + dayOffset * 5;
    const formulaId = rotatePick(formulaWave, dayOffset * 3);
    const formula = formulaById(formulaId);
    const pax = Math.max(Number(formula?.minPax || 1), 6 + ((dayOffset * 11) % 31));
    const futureDate = findFormulaDate(formulaId, dayOffset, pax, dayOffset);
    const startTime = clampTimeToSchedule(futureDate, defaultFormulaTime(formula, dayOffset), getFormuleTotalDuration(formula) || 2);
    const price = formulaPrice(formulaId, pax);
    addBooking(`future-proof-${dayOffset}-formula-${formulaId}`, baseMinute, 'sim-client', baseReservation(centerId, runId, futureDate, index, {
      name: `${makeName('formule', dayOffset + 40)} J+${dayOffset}`,
      startTime,
      pax,
      duration: Number(formula?.bowlingDur || (formula?.hasBowling ? 1 : 0.5)),
      totalDuration: getFormuleTotalDuration(formula) || 2.5,
      type: 'formule',
      formuleId: formulaId,
      label: formula?.name || formulaId.toUpperCase(),
      price,
      basePrice: price,
      preference: buildFormulaPreference(formula, startTime, dayOffset + 40),
    }), { pressure: 'multi_day_training_formula' });

    if (dayOffset % 2 === 0) {
      const futureBowlingDate = getSchedule(addDays(date, dayOffset)) ? addDays(date, dayOffset) : futureDate;
      const duration = rotatePick([0.5, 1, 1.5, 2], dayOffset);
      const paxBowling = 4 + ((dayOffset * 13) % 34);
      const bowlingTime = clampTimeToSchedule(futureBowlingDate, rotatePick(bowlingStarts, dayOffset), duration);
      const bowlingAmount = bowlingPrice(duration, paxBowling);
      addBooking(`future-proof-${dayOffset}-bowling`, baseMinute + 1, 'sim-staff', baseReservation(centerId, runId, futureBowlingDate, index, {
        name: `${makeName('bowling', dayOffset + 50)} J+${dayOffset}`,
        startTime: bowlingTime,
        pax: paxBowling,
        duration,
        totalDuration: duration,
        type: 'bowling',
        label: duration === 1 ? 'Bowling classique' : `Bowling ${String(duration).replace('.', ',')}h`,
        price: bowlingAmount,
        basePrice: bowlingAmount,
      }), { pressure: 'multi_day_training_bowling' });
    }

    if (dayOffset % 3 === 0) {
      const futureLaserDate = getSchedule(addDays(date, dayOffset)) ? addDays(date, dayOffset) : futureDate;
      const games = rotatePick([1, 2, 3], dayOffset);
      const paxLaser = 5 + ((dayOffset * 9) % 25);
      const laserTime = clampTimeToSchedule(futureLaserDate, rotatePick(laserStarts, dayOffset), games * 0.5);
      const laserAmount = laserPrice(games, paxLaser);
      addBooking(`future-proof-${dayOffset}-laser`, baseMinute + 2, 'sim-client', baseReservation(centerId, runId, futureLaserDate, index, {
        name: `${makeName('laser', dayOffset + 60)} J+${dayOffset}`,
        startTime: laserTime,
        pax: paxLaser,
        duration: games * 0.5,
        totalDuration: games * 0.5,
        type: 'laser',
        label: `${games} partie${games > 1 ? 's' : ''} Laser Game`,
        laserGames: games,
        price: laserAmount,
        basePrice: laserAmount,
        preference: { firstActivityId: 'laser_game', preferredLaserTime: laserTime },
      }), { pressure: 'multi_day_training_laser' });
    }
  }

  return steps.sort((left, right) => left.minute - right.minute);
}

function buildScenarioSteps({ centerId, date, runId, scenario }) {
  const profile = resolveSimulationProfile(scenario);
  const steps = buildRushSteps({ centerId, date, runId });
  if (profile.id === 'max') {
    return { profile, steps };
  }

  const allowedDates = new Set(
    Array.from({ length: profile.dayLimit }, (_, index) => addDays(date, index)),
  );
  const selectedKeys = new Set();
  const counters = {
    booking: 0,
    bowling: 0,
    laser: 0,
    formule: 0,
    status: 0,
    delay: 0,
    orchestrate: 0,
  };

  const filtered = [];
  for (const step of steps) {
    if (step.type === 'booking') {
      const stepDate = step.body?.date || date;
      const type = step.body?.type || 'booking';
      const typeLimit = profile.mix?.[type];
      if (!allowedDates.has(stepDate)) continue;
      if (counters.booking >= profile.bookingLimit) continue;
      if (Number.isFinite(typeLimit) && counters[type] >= typeLimit) continue;
      counters.booking += 1;
      counters[type] = Number(counters[type] || 0) + 1;
      selectedKeys.add(step.key);
      filtered.push(step);
      continue;
    }

    if (step.type === 'status') {
      if (!selectedKeys.has(step.key) || counters.status >= profile.statusLimit) continue;
      counters.status += 1;
      filtered.push(step);
      continue;
    }

    if (step.type === 'delay') {
      if (!selectedKeys.has(step.key) || counters.delay >= profile.delayLimit) continue;
      counters.delay += 1;
      filtered.push(step);
      continue;
    }

    if (step.type === 'orchestrate') {
      if (counters.orchestrate >= profile.orchestratorLimit) continue;
      counters.orchestrate += 1;
      filtered.push(step);
    }
  }

  return {
    profile,
    steps: filtered.sort((left, right) => left.minute - right.minute),
  };
}

function buildInitialStats(steps, date) {
  const days = new Set(steps.filter((step) => step.body?.date).map((step) => step.body.date));
  const bookingSteps = steps.filter((step) => step.type === 'booking');
  const names = new Set(bookingSteps.map((step) => step.body?.name).filter(Boolean));
  return {
    created: 0,
    refused: 0,
    clientCreated: 0,
    staffCreated: 0,
    mailsDrafted: 0,
    smsPlannedLater: 0,
    events: 0,
    delays: 0,
    statusUpdates: 0,
    orchestrations: 0,
    errors: 0,
    alternativesOffered: 0,
    rescuedRefusals: 0,
    hardRefusals: 0,
    staffReviewsCreated: 0,
    staffReviewsPending: 0,
    staffReviewsApproved: 0,
    staffReviewsRejected: 0,
    staffReviewsAlternativesSent: 0,
    daysCovered: days.size,
    plannedSteps: steps.length,
    plannedBookings: bookingSteps.length,
    plannedBowling: bookingSteps.filter((step) => step.body?.type === 'bowling').length,
    plannedLaser: bookingSteps.filter((step) => step.body?.type === 'laser').length,
    plannedFormulas: bookingSteps.filter((step) => step.body?.type === 'formule').length,
    plannedUniqueNames: names.size,
    trainingIntensity: bookingSteps.length >= 90 ? 'expert' : 'standard',
    focusDate: date,
    startedAt: new Date().toISOString(),
    lastActionAt: '',
  };
}

function appendTimeline(payload, item) {
  const timeline = Array.isArray(payload.timeline) ? payload.timeline : [];
  timeline.push({ at: new Date().toISOString(), ...item });
  payload.timeline = timeline.slice(-80);
}

function ensureSimulationRecoveryStats(stats = {}) {
  stats.refused = Number(stats.refused || 0);
  stats.errors = Number(stats.errors || 0);
  stats.alternativesOffered = Number(stats.alternativesOffered || 0);
  stats.rescuedRefusals = Number(stats.rescuedRefusals || 0);
  stats.hardRefusals = Number(stats.hardRefusals || 0);
  stats.staffReviewsCreated = Number(stats.staffReviewsCreated || 0);
  stats.staffReviewsPending = Number(stats.staffReviewsPending || 0);
  stats.staffReviewsApproved = Number(stats.staffReviewsApproved || 0);
  stats.staffReviewsRejected = Number(stats.staffReviewsRejected || 0);
  stats.staffReviewsAlternativesSent = Number(stats.staffReviewsAlternativesSent || 0);
  return stats;
}

function safeReviewId(prefix, value) {
  return `${prefix}:${String(value || Date.now()).replace(/[^a-z0-9_-]/gi, '_')}`;
}

function ensureSimulationReviews(payload) {
  if (!Array.isArray(payload.staffReviews)) payload.staffReviews = [];
  return payload.staffReviews;
}

function refreshSimulationReviewStats(payload) {
  const stats = ensureSimulationRecoveryStats(payload.stats || {});
  const reviews = ensureSimulationReviews(payload);
  stats.staffReviewsCreated = reviews.length;
  stats.staffReviewsPending = reviews.filter((review) => review.status === 'pending').length;
  stats.staffReviewsApproved = reviews.filter((review) => review.status === 'approved').length;
  stats.staffReviewsRejected = reviews.filter((review) => review.status === 'rejected').length;
  stats.staffReviewsAlternativesSent = reviews.filter((review) => review.status === 'alternatives_sent').length;
  payload.stats = stats;
  return stats;
}

function addSimulationReview(payload, review) {
  const reviews = ensureSimulationReviews(payload);
  if (reviews.some((item) => item.id === review.id)) {
    refreshSimulationReviewStats(payload);
    return null;
  }
  const item = {
    createdAt: new Date().toISOString(),
    status: 'pending',
    ...review,
  };
  reviews.push(item);
  payload.staffReviews = reviews.slice(-120);
  refreshSimulationReviewStats(payload);
  return item;
}

function getSimulationReview(payload, reviewId) {
  return ensureSimulationReviews(payload).find((review) => review.id === reviewId) || null;
}

function resolveSimulationDecisionRecipient(review = {}) {
  return process.env.SIMULATION_EMAIL_TO
    || process.env.STAFF_REVIEW_EMAIL
    || process.env.RESERVATION_STAFF_EMAIL
    || review.staffRecipient
    || '';
}

function summarizeAlternatives(alternatives = []) {
  if (!alternatives.length) return '';
  return alternatives
    .slice(0, 3)
    .map((alternative) => alternative.summary || `${alternative.date} ${alternative.startTime}`)
    .join(' | ');
}

async function recordSimulationRefusal({ run, payload, step, body, reason, expectedStressCase = false, severity = 'medium' }) {
  const stats = ensureSimulationRecoveryStats(payload.stats);
  const channel = step.channel || 'sim-client';
  const alternatives = await findReservationAlternatives(body, {
    channel: channel === 'sim-client' ? 'public' : 'staff',
    limit: 4,
    spanDays: 14,
    maxChecks: 96,
  }).catch(() => []);
  const hasAlternatives = alternatives.length > 0;

  stats.refused += 1;
  if (hasAlternatives) {
    stats.alternativesOffered += 1;
    stats.rescuedRefusals += 1;
  } else {
    stats.hardRefusals += 1;
    if (!expectedStressCase) stats.errors += 1;
  }

  await createDecisionLog({
    centerId: run.centerId,
    runId: run.id,
    agentId: step.persona || 'planning-agent',
    decisionType: hasAlternatives ? 'simulation_booking_alternatives' : 'simulation_booking_refused',
    severity: hasAlternatives ? 'info' : severity,
    payload: {
      simulation: true,
      key: step.key,
      body,
      pressure: step.pressure,
      error: reason || 'Reservation refusee.',
      expectedStressCase,
      alternatives,
      summary: hasAlternatives
        ? `${alternatives.length} alternative(s) compatible(s): ${summarizeAlternatives(alternatives)}`
        : reason || 'Aucune alternative automatique trouvee.',
    },
  });

  appendTimeline(payload, {
    kind: hasAlternatives ? 'alternative' : 'refused',
    key: step.key,
    minute: step.minute,
    label: body.name,
    detail: hasAlternatives
      ? `Alternatives proposees: ${summarizeAlternatives(alternatives)}`
      : reason || 'Reservation refusee.',
  });

  addSimulationReview(payload, {
    id: safeReviewId(hasAlternatives ? 'alternatives' : 'refusal', step.key),
    type: hasAlternatives ? 'alternative_offer' : 'hard_refusal',
    key: step.key,
    minute: step.minute,
    title: hasAlternatives
      ? `Alternatives a envoyer - ${body.name || 'client'}`
      : `Refus a valider - ${body.name || 'client'}`,
    summary: hasAlternatives
      ? `${alternatives.length} alternative(s) compatibles trouvees.`
      : 'Aucune alternative automatique fiable trouvee.',
    risk: hasAlternatives ? 'medium' : severity,
    recommendation: hasAlternatives ? 'send_alternatives' : 'reject',
    request: body,
    reason: reason || 'Reservation refusee.',
    alternatives,
    staffQuestion: hasAlternatives
      ? 'Envoyer ces alternatives au client simule ?'
      : 'Confirmer le refus propre ou demander une verification manuelle ?',
  });
}

function getReservationFromPayload(payload, key) {
  const map = payload.reservationMap || {};
  return map[key] || null;
}

function upsertReservationPayload(payload, key, reservation) {
  payload.reservationMap = payload.reservationMap || {};
  payload.reservationMap[key] = {
    id: reservation.id,
    key,
    name: reservation.name,
    phone: reservation.phone,
    email: reservation.email,
    type: reservation.type,
    formuleId: reservation.formuleId,
    label: reservation.label,
    date: reservation.date,
    startTime: reservation.startTime,
    duration: reservation.duration,
    totalDuration: reservation.totalDuration,
    pax: reservation.pax,
    lanes: reservation.lanes,
    status: reservation.status,
    basePrice: reservation.basePrice,
    price: reservation.price,
    paymentMethod: reservation.paymentMethod,
    extras: reservation.extras || [],
    notes: reservation.notes || '',
    validationStatus: reservation.validationStatus,
    riskLevel: reservation.riskLevel,
    riskScore: reservation.riskScore,
    opsPlan: reservation.opsPlan || null,
  };
}

function getMainResourceBlock(reservation) {
  const blocks = Array.isArray(reservation?.opsPlan?.resourceBlocks) ? reservation.opsPlan.resourceBlocks : [];
  return blocks.find((block) => block.resourceType === 'laser_arena')
    || blocks.find((block) => block.resourceType === 'bowling_lane')
    || blocks[0]
    || null;
}

async function createSimulatedMail({ runId, reservation, templateId, payload, recipient = '' }) {
  const message = buildMessage({ reservation, templateId, channel: 'email' });
  const communication = await createCommunication({
    centerId: reservation.centerId || DEFAULT_CENTER_ID,
    reservationId: reservation.id,
    channel: 'email',
    templateId,
    recipient: recipient || reservation.email || '',
    subject: `[SIM] ${message.subject}`,
    body: emailShell({
      title: message.title || message.subject,
      body: message.body,
      preheader: message.preheader,
      details: message.details,
      action: message.action,
      note: message.note,
      eyebrow: message.eyebrow,
      replyLine: message.replyLine,
    }),
    status: 'draft',
    idempotencyKey: `simulation:${runId}:${reservation.id}:${templateId}:${recipient || reservation.email || 'client'}`,
    payload: {
      simulation: true,
      simulationRunId: runId,
      textBody: message.body,
      wouldSendInProduction: true,
      ...payload,
    },
  });
  return communication;
}

async function createSmsPlaceholder({ runId, reservation }) {
  return createCommunication({
    centerId: reservation.centerId || DEFAULT_CENTER_ID,
    reservationId: reservation.id,
    channel: 'phone_note',
    templateId: 'sms_future_reminder',
    recipient: reservation.phone || '',
    subject: '[SIM] Canal mobile en attente',
    body: `SMS futur: rappel court pour ${reservation.name} le ${reservation.date} a ${reservation.startTime}.`,
    status: 'draft',
    idempotencyKey: `simulation:${runId}:${reservation.id}:sms_future`,
    payload: {
      simulation: true,
      simulationRunId: runId,
      smsDeferred: true,
      reason: 'Canal mobile masque tant que le fournisseur SMS nest pas choisi.',
    },
  });
}

async function createSimulationDecisionMail({ run, payload, review, decision, alternative = null }) {
  const recipient = resolveSimulationDecisionRecipient(review);
  const target = review.request?.email || review.reservation?.email || '';
  const decisionLabels = {
    approve: 'confirmation staff',
    reject: 'refus propre',
    send_alternatives: 'alternatives proposees',
  };
  const title = `Simulation - ${decisionLabels[decision] || 'decision staff'}`;
  const alternativeLines = alternative
    ? [
      `Alternative retenue: ${alternative.summary || `${alternative.date || ''} ${alternative.startTime || ''}`}`.trim(),
      alternative.recommendation ? `Note: ${alternative.recommendation}` : '',
    ].filter(Boolean)
    : [];
  const body = [
    `Decision staff simulee pour ${review.request?.name || review.reservation?.name || 'le client'}.`,
    decision === 'approve'
      ? 'La demande est confirmee apres verification terrain.'
      : decision === 'send_alternatives'
        ? 'Le client recevrait une proposition claire avec les meilleurs creneaux compatibles.'
        : 'Le client recevrait un refus humain, poli et utile, sans laisser une erreur brute.',
    review.reason ? `Contexte: ${review.reason}` : '',
    ...alternativeLines,
    target ? `Destinataire client simule: ${target}` : '',
  ].filter(Boolean).join('\n\n');

  const communication = await createCommunication({
    centerId: run.centerId,
    reservationId: review.reservationId || null,
    channel: 'email',
    templateId: `simulation_staff_${decision}`,
    recipient,
    subject: `[SIM] ${title}`,
    body: emailShell({
      title,
      body,
      preheader: 'Decision staff simulation',
      details: [
        { label: 'Run', value: run.id },
        { label: 'Decision', value: decisionLabels[decision] || decision },
        { label: 'Client simule', value: target || 'non defini' },
      ],
      note: 'Mail de simulation: brouillon uniquement, jamais envoye par le dispatcher reel.',
    }),
    status: 'draft',
    idempotencyKey: `simulation:${run.id}:${review.id}:${decision}:${alternative?.date || 'none'}:${alternative?.startTime || 'none'}`,
    payload: {
      simulation: true,
      simulationRunId: run.id,
      staffReviewId: review.id,
      decision,
      intendedRecipient: target,
      safeRecipient: recipient,
      wouldSendInProduction: true,
      selectedAlternative: alternative,
    },
  });
  payload.stats = payload.stats || {};
  payload.stats.mailsDrafted = Number(payload.stats.mailsDrafted || 0) + 1;
  return communication;
}

async function executeBookingStep({ run, payload, step }) {
  const stats = payload.stats;
  const channel = step.channel || 'sim-client';
  const body = {
    ...step.body,
    channel,
    notes: `[SIM:${run.id}] ${step.pressure || 'rush'} - ${step.persona || 'client-agent'}`,
  };

  try {
    const ops = await prepareReservationOps(body, channel === 'sim-client' ? 'public' : 'staff');
    if (ops.blockOnlineConfirmation) {
      await recordSimulationRefusal({
        run,
        payload,
        step,
        body,
        reason: ops.planWarning || 'Plan public bloque par le garde-fou.',
        expectedStressCase: true,
        severity: 'medium',
      });
      return;
    }
    const reservation = await createReservation({
      ...body,
      ...ops,
      channel,
    });

    upsertReservationPayload(payload, step.key, reservation);
    stats.created += 1;
    if (channel === 'sim-staff') stats.staffCreated += 1;
    else stats.clientCreated += 1;

    await createOpsEvent({
      centerId: reservation.centerId,
      reservationId: reservation.id,
      formulaId: reservation.formuleId || '',
      activityId: reservation.type === 'laser' ? 'laser_game' : reservation.type === 'bowling' ? 'bowling' : '',
      eventType: 'simulation_reservation_created',
      plannedMinutes: Number(reservation.totalDuration || reservation.duration || 0) * 60,
      payload: {
        simulation: true,
        simulationRunId: run.id,
        key: step.key,
        channel,
        pressure: step.pressure,
        validationStatus: reservation.validationStatus,
        riskLevel: reservation.riskLevel,
      },
    });

    const templateId = reservation.validationStatus === 'staff_review' ? 'request_received' : 'confirmation';
    await createSimulatedMail({ runId: run.id, reservation, templateId, payload: { channel } });
    await createSimulatedMail({ runId: run.id, reservation, templateId: 'reminder_48h', payload: { channel } });
    stats.mailsDrafted += 2;

    if (reservation.validationStatus === 'staff_review') {
      await createSimulatedMail({
        runId: run.id,
        reservation,
        templateId: 'staff_review_request',
        recipient: process.env.STAFF_REVIEW_EMAIL || process.env.RESERVATION_STAFF_EMAIL || 'staff@simulation.fungalaxy.invalid',
        payload: { channel, staffReview: true },
      });
      stats.mailsDrafted += 1;

      const alternatives = await findReservationAlternatives(body, {
        channel: channel === 'sim-client' ? 'public' : 'staff',
        limit: 3,
        spanDays: 7,
        maxChecks: 48,
      }).catch(() => []);
      addSimulationReview(payload, {
        id: safeReviewId('staff', reservation.id),
        type: 'staff_review',
        key: step.key,
        minute: step.minute,
        reservationId: reservation.id,
        title: `Validation staff - ${reservation.name}`,
        summary: `${reservation.label} ${reservation.date} ${reservation.startTime}, ${reservation.pax} joueur(s).`,
        risk: reservation.riskLevel || 'medium',
        recommendation: 'approve_or_reject',
        request: body,
        reservation: {
          id: reservation.id,
          name: reservation.name,
          email: reservation.email,
          phone: reservation.phone,
          label: reservation.label,
          date: reservation.date,
          startTime: reservation.startTime,
          pax: reservation.pax,
          type: reservation.type,
          lanes: reservation.lanes,
          price: reservation.price,
        },
        alternatives,
        staffQuestion: 'Confirmer automatiquement, refuser proprement ou proposer une alternative ?',
      });
    }

    await createDecisionLog({
      centerId: reservation.centerId,
      runId: run.id,
      reservationId: reservation.id,
      agentId: step.persona || (channel === 'sim-staff' ? 'staff-agent' : 'client-agent'),
      decisionType: 'simulation_booking_accepted',
      severity: reservation.riskLevel === 'critical' ? 'critical' : reservation.riskLevel === 'high' ? 'high' : 'info',
      payload: {
        simulation: true,
        key: step.key,
        pressure: step.pressure,
        autoDecision: ops.autoDecision,
        validationStatus: reservation.validationStatus,
        lanes: reservation.lanes,
        price: reservation.price,
        summary: `${reservation.label} ${reservation.startTime} ${reservation.pax}p`,
      },
    });

    appendTimeline(payload, {
      kind: 'created',
      key: step.key,
      minute: step.minute,
      reservationId: reservation.id,
      label: `${reservation.name} - ${reservation.label}`,
      detail: `${reservation.date} ${reservation.startTime}, ${reservation.pax} joueurs, ${reservation.validationStatus}`,
    });
  } catch (error) {
    const expectedStressCase = Boolean(
      step.pressure?.includes('expected')
      || step.pressure?.includes('guardrail')
      || step.pressure?.includes('probe')
    );
    await recordSimulationRefusal({
      run,
      payload,
      step,
      body,
      reason: error.message || 'Reservation refusee.',
      expectedStressCase,
      severity: expectedStressCase ? 'medium' : 'high',
    });
  }
}

async function executeStatusStep({ run, payload, step }) {
  const tracked = getReservationFromPayload(payload, step.key);
  if (!tracked?.id) {
    await createDecisionLog({
      centerId: run.centerId,
      runId: run.id,
      agentId: step.agentId || 'field-pilot-agent',
      decisionType: 'simulation_status_skipped',
      severity: 'medium',
      payload: { simulation: true, key: step.key, reason: 'Reservation cible introuvable.' },
    });
    return;
  }

  const reservation = await updateReservation({
    id: tracked.id,
    ...tracked,
    status: step.status,
  });
  upsertReservationPayload(payload, step.key, reservation);
  payload.stats.statusUpdates += 1;

  await createOpsEvent({
    centerId: reservation.centerId,
    reservationId: reservation.id,
    formulaId: reservation.formuleId || '',
    eventType: 'simulation_status_update',
    payload: {
      simulation: true,
      simulationRunId: run.id,
      key: step.key,
      status: step.status,
      reason: step.reason,
    },
  });

  await createDecisionLog({
    centerId: reservation.centerId,
    runId: run.id,
    reservationId: reservation.id,
    agentId: step.agentId || 'field-pilot-agent',
    decisionType: 'simulation_field_status',
    severity: 'info',
    payload: {
      simulation: true,
      key: step.key,
      status: step.status,
      reason: step.reason,
      staffInstruction: step.status === 'arrived' ? 'Verifier paiement et lancement ressource.' : 'Cloture terrain enregistree.',
    },
  });

  appendTimeline(payload, {
    kind: 'status',
    key: step.key,
    minute: step.minute,
    reservationId: reservation.id,
    label: `${reservation.name} -> ${step.status}`,
    detail: step.reason || 'Signal terrain',
  });
}

async function executeDelayStep({ run, payload, step }) {
  const tracked = getReservationFromPayload(payload, step.key);
  if (!tracked?.id) {
    await createDecisionLog({
      centerId: run.centerId,
      runId: run.id,
      agentId: step.agentId || 'delay-agent',
      decisionType: 'simulation_delay_skipped',
      severity: 'medium',
      payload: { simulation: true, key: step.key, reason: 'Reservation cible introuvable.' },
    });
    return;
  }

  const snapshot = await readStaffState(tracked.date, run.centerId);
  const reservation = snapshot.reservations.find((item) => Number(item.id) === Number(tracked.id));
  const block = getMainResourceBlock(reservation);
  let impact = null;

  try {
    if (reservation?.opsPlan) {
      impact = delayAgent(
        {
          centerId: run.centerId,
          reasonId: step.reasonId,
          delayMinutes: step.delayMinutes,
          plan: reservation.opsPlan,
        },
        {
          reservations: snapshot.reservations.filter((item) => Number(item.id) !== Number(tracked.id)),
          laneStatuses: snapshot.laneStatuses,
        },
      );
    }
  } catch (error) {
    impact = { ok: false, error: error.message || 'Analyse retard impossible.' };
  }

  const plannedStart = block?.startTime || reservation?.startTime || tracked.startTime || '10:00';
  const plannedMinutes = Number(block?.durationMinutes || Math.round(Number(reservation?.duration || tracked.duration || 1) * 60));
  const eventDate = reservation?.date || tracked.date || run.simDate;
  const plannedEnd = block?.endTime || addMinutes(plannedStart, plannedMinutes);
  const actualStart = addMinutes(plannedStart, step.delayMinutes);
  const actualEnd = addMinutes(plannedStart, plannedMinutes + step.delayMinutes);

  await createOpsEvent({
    centerId: run.centerId,
    reservationId: tracked.id,
    formulaId: reservation?.formuleId || tracked.formuleId || '',
    activityId: block?.activityId || (reservation?.type === 'laser' ? 'laser_game' : reservation?.type === 'bowling' ? 'bowling' : ''),
    eventType: 'simulation_delay',
    plannedStart: eventTimestamp(eventDate, plannedStart),
    plannedEnd: eventTimestamp(eventDate, plannedEnd),
    actualStart: eventTimestamp(eventDate, actualStart),
    actualEnd: eventTimestamp(eventDate, actualEnd),
    plannedMinutes,
    actualMinutes: plannedMinutes + Number(step.delayMinutes || 0),
    reasonId: step.reasonId,
    payload: {
      simulation: true,
      simulationRunId: run.id,
      key: step.key,
      delayMinutes: step.delayMinutes,
      note: step.note,
      impact: impact?.impact || impact || null,
    },
  });

  payload.stats.events += 1;
  payload.stats.delays += 1;

  await createDecisionLog({
    centerId: run.centerId,
    runId: run.id,
    reservationId: tracked.id,
    agentId: step.agentId || 'delay-agent',
    decisionType: impact?.ok === false || impact?.impact?.ok === false ? 'simulation_delay_conflict' : 'simulation_delay_absorbed',
    severity: impact?.ok === false || impact?.impact?.ok === false ? 'high' : 'medium',
    payload: {
      simulation: true,
      key: step.key,
      delayMinutes: step.delayMinutes,
      reasonId: step.reasonId,
      note: step.note,
      action: impact?.nextAction || impact?.impact?.actions?.[0] || 'Informer le staff et surveiller le prochain lancement.',
      conflicts: impact?.impact?.conflicts || impact?.conflicts || [],
    },
  });

  await createCommunication({
    centerId: run.centerId,
    reservationId: tracked.id,
    channel: 'email',
    templateId: 'staff_alert',
    recipient: process.env.STAFF_REVIEW_EMAIL || process.env.RESERVATION_STAFF_EMAIL || 'staff@simulation.fungalaxy.invalid',
    subject: `[SIM] Retard terrain - ${tracked.name}`,
    body: `Simulation: ${tracked.name} prend ${step.delayMinutes} min de retard (${step.reasonId}). Action: ${impact?.nextAction || impact?.impact?.actions?.[0] || 'surveillance staff'}.`,
    status: 'draft',
    idempotencyKey: `simulation:${run.id}:${tracked.id}:delay:${step.minute}`,
    payload: {
      simulation: true,
      simulationRunId: run.id,
      delayMinutes: step.delayMinutes,
      reasonId: step.reasonId,
    },
  });
  payload.stats.mailsDrafted += 1;

  appendTimeline(payload, {
    kind: 'delay',
    key: step.key,
    minute: step.minute,
    reservationId: tracked.id,
    label: `${tracked.name} +${step.delayMinutes} min`,
    detail: impact?.nextAction || impact?.impact?.actions?.[0] || step.note || 'Retard surveille',
  });
}

async function executeOrchestratorStep({ run, payload, step }) {
  const result = await runOrchestratorForCenter({
    centerId: run.centerId,
    startDate: step.date || run.simDate,
    endDate: step.date || run.simDate,
    persist: false,
  });
  payload.stats.orchestrations += 1;

  await createDecisionLog({
    centerId: run.centerId,
    runId: run.id,
    agentId: step.agentId || 'orchestrator-agent',
    decisionType: 'simulation_orchestrator_read',
    severity: result.orchestration?.continuousLearning?.actions?.some((item) => item.priority === 'P1') ? 'high' : 'info',
    payload: {
      simulation: true,
      key: step.key,
      reason: step.reason,
      savedSuggestions: result.savedSuggestions || 0,
      footprint: result.orchestration?.footprint || {},
      actions: (result.orchestration?.continuousLearning?.actions || []).slice(0, 5),
      dataFeeds: result.orchestration?.continuousLearning?.dataFeeds || [],
      learningSuggestions: (result.learning?.suggestions || []).slice(0, 5),
    },
  });

  appendTimeline(payload, {
    kind: 'orchestrator',
    key: step.key,
    minute: step.minute,
    label: 'Lecture orchestrateur',
    detail: `${result.orchestration?.activations?.length || 0} agent(s), ${result.learning?.suggestions?.length || 0} suggestion(s) apprentissage`,
  });
}

async function executeStep({ run, payload, step }) {
  if (step.type === 'booking') return executeBookingStep({ run, payload, step });
  if (step.type === 'status') return executeStatusStep({ run, payload, step });
  if (step.type === 'delay') return executeDelayStep({ run, payload, step });
  if (step.type === 'orchestrate') return executeOrchestratorStep({ run, payload, step });
  await createDecisionLog({
    centerId: run.centerId,
    runId: run.id,
    agentId: 'simulation-agent',
    decisionType: 'simulation_unknown_step',
    severity: 'medium',
    payload: { simulation: true, step },
  });
}

async function startSimulation(options = {}) {
  const centerId = normalizeCenterId(options.centerId || DEFAULT_CENTER_ID);
  const date = assertDate(options.date || options.simDate || todayStr());
  if (options.resetExisting === true) {
    await deleteSimulationData({ centerId });
  }
  const runId = makeRunId(centerId, date);
  const { profile, steps } = buildScenarioSteps({ centerId, date, runId, scenario: options.scenario || 'normal' });
  const payload = {
    version: 2,
    safety: 'isolated_simulation_no_real_dispatch',
    scenario: profile.id,
    profile,
    fieldPilot: {
      name: 'Pilote terrain simulation',
      mission: 'Suivre les arrivées, retards, conflits laser/bowling et messages staff pendant un rush accéléré.',
      rules: [
        'Ne jamais envoyer les mails de simulation aux vrais clients.',
        'Journaliser chaque refus, retard et arbitrage.',
        'Utiliser les données créées comme preuve de charge, pas comme production réelle.',
      ],
    },
    proofWindow: {
      focusDate: date,
      extraDays: 14,
      goal: 'Construire une base de comparaison 1 à 2 semaines pour prouver si l’algo aide le staff.',
    },
    steps,
    stats: buildInitialStats(steps, date),
    reservationMap: {},
    staffReviews: [],
    timeline: [],
  };

  const run = await createSimulationRun({
    id: runId,
    centerId,
    simDate: date,
    scenario: payload.scenario,
    status: 'running',
    stepIndex: 0,
    totalSteps: steps.length,
    speedFactor: options.speedFactor || DEFAULT_SPEED_FACTOR,
    payload,
  });

  await createDecisionLog({
    centerId,
    runId,
    agentId: 'simulation-director',
    decisionType: 'simulation_started',
    severity: 'info',
    payload: {
      simulation: true,
      steps: steps.length,
      focusDate: date,
      daysCovered: payload.stats.daysCovered,
      profile: profile.id,
      safety: payload.safety,
    },
  });

  return getSimulationStatus({ centerId, runId });
}

async function stepSimulation(options = {}) {
  const runId = options.runId || '';
  const centerId = normalizeCenterId(options.centerId || DEFAULT_CENTER_ID);
  let run = runId
    ? await getSimulationRun(runId)
    : await getLatestSimulationRun({ centerId, date: options.date || null });
  if (!run) {
    throw new Error('Aucune simulation active.');
  }
  assertSimulationCenter(run, centerId);
  if (run.status !== 'running') {
    return getSimulationStatus({ centerId: run.centerId, runId: run.id });
  }

  const payload = run.payload || {};
  const steps = Array.isArray(payload.steps) ? payload.steps : [];
  const batchSize = Math.min(Math.max(Number(options.batchSize || 6), 1), 100);
  const startIndex = Math.max(0, Number(run.stepIndex || 0));
  const endIndex = Math.min(steps.length, startIndex + batchSize);

  for (let index = startIndex; index < endIndex; index += 1) {
    const step = steps[index];
    payload.stats = payload.stats || buildInitialStats(steps, run.simDate);
    payload.stats.lastActionAt = new Date().toISOString();
    try {
      await executeStep({ run, payload, step });
    } catch (error) {
      payload.stats.errors += 1;
      await createDecisionLog({
        centerId: run.centerId,
        runId: run.id,
        agentId: step.agentId || step.persona || 'simulation-agent',
        decisionType: 'simulation_step_error',
        severity: 'high',
        payload: {
          simulation: true,
          stepIndex: index,
          step,
          error: error.message || 'Erreur simulation.',
        },
      });
      appendTimeline(payload, {
        kind: 'error',
        key: step.key,
        minute: step.minute,
        label: 'Erreur simulation',
        detail: error.message || 'Erreur inconnue',
      });
    }
  }

  const nextIndex = endIndex;
  const status = nextIndex >= steps.length ? 'finished' : 'running';
  if (status === 'finished') {
    payload.stats.finishedAt = new Date().toISOString();
    refreshSimulationReviewStats(payload);
    await createDecisionLog({
      centerId: run.centerId,
      runId: run.id,
      agentId: 'simulation-director',
      decisionType: 'simulation_finished',
      severity: payload.stats.errors ? 'medium' : 'info',
      payload: {
        simulation: true,
        stats: payload.stats,
        conclusion: payload.stats.errors
          ? 'La simulation a trouvé des cas à examiner.'
          : 'Simulation terminee sans erreur bloquante du moteur.',
      },
    });
  }

  run = await updateSimulationRun(run.id, {
    status,
    stepIndex: nextIndex,
    totalSteps: steps.length,
    payload,
  });
  return getSimulationStatus({ centerId: run.centerId, runId: run.id });
}

async function reviewSimulationDecision(options = {}) {
  const runId = options.runId || '';
  const centerId = normalizeCenterId(options.centerId || DEFAULT_CENTER_ID);
  let run = runId
    ? await getSimulationRun(runId)
    : await getLatestSimulationRun({ centerId, date: options.date || null });
  if (!run) throw new Error('Aucune simulation active.');
  assertSimulationCenter(run, centerId);

  const payload = run.payload || {};
  const review = getSimulationReview(payload, options.reviewId || '');
  if (!review) throw new Error('Validation simulation introuvable.');
  if (review.status !== 'pending') {
    return getSimulationStatus({ centerId: run.centerId, runId: run.id });
  }

  const decision = ['approve', 'reject', 'send_alternatives'].includes(options.decision)
    ? options.decision
    : 'send_alternatives';
  const selectedAlternative = Array.isArray(review.alternatives)
    ? review.alternatives[Math.max(0, Number(options.alternativeIndex || 0))] || null
    : null;
  let updatedReservation = null;

  if (decision === 'approve' && review.reservationId) {
    const tracked = getReservationFromPayload(payload, review.key) || review.reservation || {};
    updatedReservation = await updateReservation({
      ...tracked,
      id: review.reservationId,
      status: 'confirmed',
      validationStatus: 'confirmed',
      notes: `${tracked.notes || ''}\n[SIM:${run.id}] Validation staff approuvee depuis le banc d'essai.`,
    });
    upsertReservationPayload(payload, review.key, updatedReservation);
    await createSimulatedMail({
      runId: run.id,
      reservation: updatedReservation,
      templateId: 'confirmation',
      payload: { staffDecision: 'approved' },
    });
    payload.stats.mailsDrafted = Number(payload.stats.mailsDrafted || 0) + 1;
  }

  if (decision !== 'approve') {
    await createSimulationDecisionMail({
      run,
      payload,
      review,
      decision,
      alternative: decision === 'send_alternatives' ? selectedAlternative : null,
    });
  }

  review.status = decision === 'approve' ? 'approved' : decision === 'send_alternatives' ? 'alternatives_sent' : 'rejected';
  review.decidedAt = new Date().toISOString();
  review.decidedBy = options.decidedBy || 'staff-simulation-console';
  review.selectedAlternative = selectedAlternative;
  review.decision = decision;
  refreshSimulationReviewStats(payload);

  await createDecisionLog({
    centerId: run.centerId,
    runId: run.id,
    reservationId: review.reservationId || null,
    agentId: 'staff-validation-agent',
    decisionType: 'simulation_staff_review_decision',
    severity: decision === 'reject' ? 'medium' : 'info',
    payload: {
      simulation: true,
      reviewId: review.id,
      decision,
      selectedAlternative,
      summary: decision === 'approve'
        ? `Validation approuvee pour ${review.title}`
        : decision === 'send_alternatives'
          ? `Alternatives envoyees pour ${review.title}`
          : `Refus propre valide pour ${review.title}`,
    },
  });

  appendTimeline(payload, {
    kind: 'staff_decision',
    key: review.key,
    minute: review.minute,
    label: review.title,
    detail: decision === 'approve'
      ? 'Staff OK: reservation confirmee.'
      : decision === 'send_alternatives'
        ? 'Staff OK: alternatives envoyees.'
        : 'Staff NOK: refus propre envoye.',
  });

  run = await updateSimulationRun(run.id, {
    status: run.status,
    stepIndex: run.stepIndex,
    totalSteps: run.totalSteps,
    payload,
  });

  return getSimulationStatus({ centerId: run.centerId, runId: run.id });
}

function sanitizeRun(run) {
  if (!run) return null;
  const payload = run.payload || {};
  const steps = Array.isArray(payload.steps) ? payload.steps : [];
  return {
    ...run,
    payload: {
      version: payload.version,
      safety: payload.safety,
      scenario: payload.scenario,
      fieldPilot: payload.fieldPilot,
      proofWindow: payload.proofWindow,
      profile: payload.profile,
      stats: payload.stats || {},
      reservationMap: payload.reservationMap || {},
      staffReviews: payload.staffReviews || [],
      timeline: payload.timeline || [],
      stepsPreview: steps.slice(Math.max(0, Number(run.stepIndex || 0) - 4), Number(run.stepIndex || 0) + 8),
      totalGeneratedSteps: steps.length,
    },
  };
}

async function getSimulationStatus(options = {}) {
  const centerId = normalizeCenterId(options.centerId || DEFAULT_CENTER_ID);
  const run = options.runId
    ? await getSimulationRun(options.runId)
    : await getLatestSimulationRun({ centerId, date: options.date || null });
  assertSimulationCenter(run, centerId);
  const safeRun = sanitizeRun(run);
  const runCenterId = run?.centerId || centerId;
  const logs = await listDecisionLogs({ centerId: runCenterId, runId: run?.id || '', limit: 120 });
  const communications = run
    ? (await listCommunications({ centerId: runCenterId, limit: 500 })).filter((item) =>
      item.payload?.simulationRunId === run.id
      && item.templateId !== 'sms_future_reminder'
      && item.channel !== 'phone_note'
      && !item.payload?.smsDeferred
    )
    : [];
  let snapshot = null;
  if (run) {
    try {
      // OPT-IN explicite : readAdminRangeState exclut les lignes de simulation
      // par defaut (lib/simulation-filter.js). La console de simulation est le
      // SEUL consommateur qui doit voir les siennes : sans ce flag, le snapshot
      // ci-dessous filtrerait un ensemble deja vide et l'ecran serait blanc.
      snapshot = await readAdminRangeState(run.simDate, run.simDate, runCenterId, { includeSimulation: true });
      snapshot.reservations = (snapshot.reservations || []).filter((reservation) =>
        reservation.channel === 'sim-client'
        || reservation.channel === 'sim-staff'
        || String(reservation.notes || '').startsWith(`[SIM:${run.id}]`),
      );
    } catch (error) {
      snapshot = { error: error.message || 'Snapshot simulation indisponible.' };
    }
  }

  return {
    ok: true,
    centerId: runCenterId,
    profiles: getSimulationProfiles(),
    run: safeRun,
    stats: safeRun?.payload?.stats || null,
    logs,
    communications,
    snapshot,
  };
}

async function resetSimulation(options = {}) {
  const centerId = normalizeCenterId(options.centerId || DEFAULT_CENTER_ID);
  if (options.runId) {
    const run = await getSimulationRun(options.runId);
    assertSimulationCenter(run, centerId);
  } else if (options.confirmResetAll !== true) {
    throw new Error('Reset global simulation refuse sans confirmation explicite.');
  }
  const result = await deleteSimulationData({ centerId, runId: options.runId || '' });
  return {
    ok: true,
    reset: result.deleted,
    centerId,
    run: null,
    stats: null,
    logs: [],
    communications: [],
    snapshot: null,
    profiles: getSimulationProfiles(),
  };
}

function buildSimulationPlanPreview(options = {}) {
  const centerId = options.centerId || DEFAULT_CENTER_ID;
  const date = assertDate(options.date || todayStr());
  const runId = options.runId || `preview_${centerId}_${date}`;
  const { profile, steps } = buildScenarioSteps({ centerId, date, runId, scenario: options.scenario || 'max' });
  return {
    centerId,
    date,
    profile,
    profiles: getSimulationProfiles(),
    steps,
    stats: buildInitialStats(steps, date),
  };
}

module.exports = {
  buildSimulationPlanPreview,
  getSimulationProfiles,
  getSimulationStatus,
  reviewSimulationDecision,
  resetSimulation,
  startSimulation,
  stepSimulation,
};

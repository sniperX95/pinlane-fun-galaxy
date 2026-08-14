// Cerveau marketing : la couche de DÉCISION au-dessus du warehouse.
//
// Trois produits, tous dérivés des données réelles du centre (jamais de
// chiffre inventé) :
//   1. Prévision de fréquentation 14 jours : baseline jour-de-semaine ×
//      vacances apprise sur l'historique, ajustée par les effets météo QUE LE
//      CENTRE A DÉMONTRÉS (facts contrôlés de center-metrics : pas de
//      coefficient sorti d'un chapeau), niveaux creux → fort, et l'explication
//      des jours passés anormaux (« pourquoi c'était calme samedi »).
//   2. Plan marketing daté : chaque creux prévu devient une action concrète
//      (post J-3, email J-5, offre récurrente) avec justification chiffrée et
//      contenu prêt. « C'est fait » branche l'action sur la boucle de mesure
//      avant/après EXISTANTE (marketing_insights → measureAppliedInsights).
//   3. Post Instagram du jour : un seul brief priorisé (creux à combler >
//      météo > événement local > vacances > rythme éditorial), légende +
//      brief visuel + heure + hashtags.
//
// Tout le calcul est PUR (fonctions exportées testables sans DB) ;
// buildMarketingBrain fait uniquement l'I/O et l'assemblage.
const { getPool } = require('./database');
const {
  RAIN_THRESHOLD_MM,
  HEAT_THRESHOLD_C,
  STRONG_HEAT_THRESHOLD_C,
  computeFactsFromRows,
  isSchoolHolidayFWB,
  isPublicHolidayBE,
  nextSchoolHolidayFWB,
  upcomingLocalEvents,
  listMarketingPatterns,
} = require('./center-metrics');
const { FUN_GALAXY_BRAND, resolveOccasion, composeChannelDraft } = require('./fungalaxy-brand');
const { simulationSqlExclusion } = require('./simulation-filter');

const HORIZON_DAYS = 14;
const PAST_DAYS_EXPLAINED = 7;
const MIN_BASELINE_SAMPLE = 4;
const DAY_LABELS_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDaysIso(dateStr, days) {
  const date = new Date(`${dateStr}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function dayOfWeek(dateStr) {
  return new Date(`${dateStr}T12:00:00Z`).getUTCDay();
}

function frDayDate(dateStr) {
  return `${DAY_LABELS_FR[dayOfWeek(dateStr)]} ${dateStr.slice(8, 10)}/${dateStr.slice(5, 7)}`;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ── Baseline jour-de-semaine × vacances ──────────────────────────────────────

// Construit les moyennes de visiteurs par (jour de semaine, statut congé) sur
// l'historique. Trois niveaux de repli, du plus précis au plus grossier, la
// source est exposée pour que l'UI puisse dire d'où vient le chiffre.
function buildBaselines(history = []) {
  const byKey = new Map();
  const byDow = new Map();
  const all = [];
  for (const row of history) {
    const visitors = toNumber(row.visitors, 0);
    const dow = dayOfWeek(row.date);
    const holiday = Boolean(row.is_school_holiday) || Boolean(row.is_public_holiday);
    const key = `${dow}|${holiday ? 1 : 0}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(visitors);
    if (!byDow.has(dow)) byDow.set(dow, []);
    byDow.get(dow).push(visitors);
    all.push(visitors);
  }
  const avg = (list) => (list.length ? list.reduce((sum, v) => sum + v, 0) / list.length : 0);
  return {
    lookup(dow, holiday) {
      const exact = byKey.get(`${dow}|${holiday ? 1 : 0}`) || [];
      if (exact.length >= MIN_BASELINE_SAMPLE) {
        return { value: avg(exact), sample: exact.length, grounded: true, source: holiday ? 'jours comparables en congé' : 'jours comparables hors congé' };
      }
      const dowRows = byDow.get(dow) || [];
      if (dowRows.length >= MIN_BASELINE_SAMPLE) {
        return { value: avg(dowRows), sample: dowRows.length, grounded: true, source: `tes ${DAY_LABELS_FR[dow]}s` };
      }
      if (all.length) {
        return { value: avg(all), sample: all.length, grounded: false, source: 'moyenne globale (peu de données pour ce jour)' };
      }
      return { value: 0, sample: 0, grounded: false, source: 'aucune donnée' };
    },
    medianVisitors: median(all),
    dataDays: all.length,
  };
}

// Effet météo APPRIS : ne s'applique que si le fact existe et n'est plus
// exploratoire (>= 90 jours de données). Retourne { deltaPct, label } ou null.
function learnedWeatherEffect(facts = [], { precipMm = null, tmax = null } = {}) {
  const usable = (id) => facts.find((fact) => fact.id === id && fact.confidence !== 'exploratoire');
  if (precipMm !== null && precipMm >= RAIN_THRESHOLD_MM) {
    const fact = usable('rain_effect');
    if (fact) return { deltaPct: toNumber(fact.value, 0), label: `pluie prévue (${Math.round(precipMm)} mm) : ${fact.value >= 0 ? '+' : ''}${fact.value} % observé chez toi` };
  }
  if (tmax !== null && tmax >= STRONG_HEAT_THRESHOLD_C) {
    const fact = usable('strong_heat_effect');
    if (fact) return { deltaPct: toNumber(fact.value, 0), label: `${Math.round(tmax)} °C annoncés : ${fact.value >= 0 ? '+' : ''}${fact.value} % observé chez toi` };
  }
  if (tmax !== null && tmax >= HEAT_THRESHOLD_C) {
    const fact = usable('heat_effect');
    if (fact) return { deltaPct: toNumber(fact.value, 0), label: `${Math.round(tmax)} °C annoncés : ${fact.value >= 0 ? '+' : ''}${fact.value} % observé chez toi` };
  }
  return null;
}

function levelFor(expected, medianVisitors) {
  if (!medianVisitors) return 'normal';
  if (expected <= medianVisitors * 0.6) return 'creux';
  if (expected <= medianVisitors * 0.85) return 'calme';
  if (expected >= medianVisitors * 1.3) return 'fort';
  return 'normal';
}

// ── Prévision 14 jours (PUR) ─────────────────────────────────────────────────

// history : lignes daily_center_metrics (365 j). forecast : prévision météo
// {date, tmax, precipMm}. bookedByDate : Map date -> {reservations, pax,
// revenue} des résas futures actives. calendar(date) -> {holidayLabel,
// isSchoolHoliday, isPublicHoliday, events[]}, injectable pour les tests.
function computeAttendanceOutlook({
  today,
  history = [],
  forecast = [],
  bookedByDate = new Map(),
  facts = [],
  calendar = defaultCalendar,
  horizonDays = HORIZON_DAYS,
} = {}) {
  const baselines = buildBaselines(history);
  const forecastByDate = new Map(forecast.map((row) => [row.date, row]));

  const days = [];
  for (let offset = 0; offset < horizonDays; offset += 1) {
    const date = addDaysIso(today, offset);
    const dow = dayOfWeek(date);
    const cal = calendar(date);
    const holiday = Boolean(cal.isSchoolHoliday) || Boolean(cal.isPublicHoliday);
    const base = baselines.lookup(dow, holiday);
    const weather = forecastByDate.get(date) || {};
    const drivers = [];

    if (cal.holidayLabel) drivers.push(cal.holidayLabel);
    (cal.events || []).forEach((label) => drivers.push(`${label} (à 5 min)`));

    let expected = base.value;
    const effect = learnedWeatherEffect(facts, {
      precipMm: weather.precipMm === undefined ? null : weather.precipMm,
      tmax: weather.tmax === undefined ? null : weather.tmax,
    });
    if (effect) {
      expected *= 1 + effect.deltaPct / 100;
      drivers.push(effect.label);
    }
    expected = Math.max(0, Math.round(expected));

    const booked = bookedByDate.get(date) || null;
    if (booked && booked.pax > 0) {
      drivers.push(`déjà ${booked.pax} pers. réservées (${booked.reservations} résa${booked.reservations > 1 ? 's' : ''})`);
    }

    // Sans baseline ancrée sur le vrai jour de semaine (historique trop
    // jeune), pas de verdict : une bande entière de « FORT » sur 17 jours de
    // données ne dit rien (retour terrain 2026-07-16).
    let level = base.grounded ? levelFor(expected, baselines.medianVisitors) : 'normal';
    // La réalité bat le modèle : des résas fermes au-dessus de la prévision
    // remontent le niveau (jamais l'inverse : on ne masque pas un creux).
    if (booked && booked.pax > expected) {
      const bookedLevel = levelFor(booked.pax, baselines.medianVisitors);
      const order = ['creux', 'calme', 'normal', 'fort'];
      if (order.indexOf(bookedLevel) > order.indexOf(level)) level = bookedLevel;
    }

    days.push({
      date,
      label: frDayDate(date),
      dow,
      expected,
      level,
      baselineSource: base.source,
      baselineSample: base.sample,
      tmax: weather.tmax === undefined ? null : weather.tmax,
      precipMm: weather.precipMm === undefined ? null : weather.precipMm,
      holidayLabel: cal.holidayLabel || '',
      booked,
      drivers,
    });
  }

  return {
    days,
    medianVisitors: Math.round(baselines.medianVisitors),
    dataDays: baselines.dataDays,
  };
}

// Explication des jours passés notables : réel vs baseline comparable, avec la
// météo réellement observée. Seuls les écarts >= 25 % remontent (max 3).
function explainRecentDays({ today, history = [] } = {}) {
  const baselines = buildBaselines(history);
  if (!baselines.dataDays) return [];
  const from = addDaysIso(today, -PAST_DAYS_EXPLAINED);
  const recent = history.filter((row) => row.date >= from && row.date < today);
  const explained = [];
  for (const row of recent) {
    const dow = dayOfWeek(row.date);
    const holiday = Boolean(row.is_school_holiday) || Boolean(row.is_public_holiday);
    const base = baselines.lookup(dow, holiday);
    // La rétro exige une baseline ANCRÉE sur le vrai jour de semaine
    // (base.grounded) : comparer un samedi à la moyenne lundi→dimanche produit
    // des « +527 % » absurdes qui décrédibilisent tout (retour terrain
    // 2026-07-17 : « 234 visiteurs vs 37 attendus sur moyenne globale »).
    if (!base.grounded || base.sample < MIN_BASELINE_SAMPLE || base.value <= 0) continue;
    const actual = toNumber(row.visitors, 0);
    const deltaPct = Math.round(((actual - base.value) / base.value) * 100);
    if (Math.abs(deltaPct) < 25) continue;
    const causes = [];
    const tmax = row.weather_tmax === null || row.weather_tmax === undefined ? null : toNumber(row.weather_tmax, null);
    const precip = row.weather_precip_mm === null || row.weather_precip_mm === undefined ? null : toNumber(row.weather_precip_mm, null);
    if (precip !== null && precip >= RAIN_THRESHOLD_MM) causes.push(`${Math.round(precip)} mm de pluie ce jour-là`);
    else if (tmax !== null && tmax >= STRONG_HEAT_THRESHOLD_C) causes.push(`${Math.round(tmax)} °C ce jour-là`);
    if (row.holiday_label) causes.push(String(row.holiday_label));
    explained.push({
      date: row.date,
      label: frDayDate(row.date),
      actual,
      expected: Math.round(base.value),
      deltaPct,
      baselineSource: base.source,
      causes,
      summary: `${frDayDate(row.date)} : ${actual} visiteurs (${deltaPct >= 0 ? '+' : ''}${deltaPct} % vs ${Math.round(base.value)} attendus sur ${base.source})${causes.length ? `, ${causes.join(', ')}` : ''}.`,
    });
  }
  return explained
    .sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct))
    .slice(0, 3);
}

// ── Plan marketing daté (PUR) ────────────────────────────────────────────────

function fillCopyFor(day, centerFacts) {
  // Le driver météo du jour cible impose l'angle ; sinon angle « créneau calme ».
  const rain = day.precipMm !== null && day.precipMm >= RAIN_THRESHOLD_MM;
  const heat = day.tmax !== null && day.tmax >= STRONG_HEAT_THRESHOLD_C;
  if (rain) {
    return `Pluie annoncée ${day.label} (${Math.round(day.precipMm)} mm) ? Zéro goutte chez nous : bowling, laser game et arcades bien au sec. Réserve ta piste avant que tout le monde ait la même idée.`;
  }
  if (heat) {
    return `${Math.round(day.tmax)}° annoncés ${day.label} : chez nous il fait frais toute la journée. Bowling, laser game, arcades : le plan fraîcheur à 5 minutes.`;
  }
  return `${day.label.charAt(0).toUpperCase()}${day.label.slice(1)}, c'est LE moment de venir.

Pas de file aux pistes, pas d'attente au laser, les arcades pour toi.

Les habitués le savent : les jours calmes, c'est là qu'on joue le mieux.

Réserve ton créneau : 30 secondes.`;
}

// Transforme l'outlook en actions datées. Règles :
//   creux/calme à J+2..J+13 → post social exécuté 2-3 j avant + email ciblé
//   exécuté ~5 j avant (si la fenêtre le permet) ; jour creux RÉCURRENT
//   (dow_worst, >= 2 occurrences creuses) → offre structurelle ; meilleur jour
//   fort → récolter (avis Google, photos pour les réseaux). Max 4 actions.
function buildMarketingPlan({ today, outlook, facts = [], centerFacts = {}, patterns = [] } = {}) {
  const actions = [];
  const weak = (outlook.days || [])
    .filter((day, index) => index >= 2 && (day.level === 'creux' || day.level === 'calme'))
    .sort((a, b) => (a.level === b.level ? a.date.localeCompare(b.date) : a.level === 'creux' ? -1 : 1));

  const socialTarget = weak[0] || null;
  if (socialTarget) {
    const executeOn = addDaysIso(socialTarget.date, -3) >= today ? addDaysIso(socialTarget.date, -3) : today;
    actions.push({
      id: `social:${socialTarget.date}`,
      type: 'social_push',
      channel: 'instagram',
      executeOn,
      targetDate: socialTarget.date,
      title: `Post pour remplir ${socialTarget.label}`,
      why: `${socialTarget.label} s'annonce ${socialTarget.level} : ${socialTarget.expected} visiteurs attendus (ta médiane : ${outlook.medianVisitors}). ${socialTarget.drivers.join(' · ') || 'Aucun moteur particulier, jour structurellement faible.'} Poster 2-3 jours avant, pas le jour même.`,
      readyContent: fillCopyFor(socialTarget, centerFacts),
    });
  }

  const emailTarget = weak.find((day) => day.date >= addDaysIso(today, 4)) || null;
  if (emailTarget) {
    actions.push({
      id: `email:${emailTarget.date}`,
      type: 'email_push',
      channel: 'email',
      executeOn: addDaysIso(emailTarget.date, -5) >= today ? addDaysIso(emailTarget.date, -5) : today,
      targetDate: emailTarget.date,
      title: `Email ciblé pour ${emailTarget.label}`,
      why: `${emailTarget.label} : ${emailTarget.expected} visiteurs attendus (médiane ${outlook.medianVisitors}). Un email aux clients qui ne sont pas venus récemment se programme depuis la page Emails (envoi programmé), 5 jours d'avance pour laisser le temps de réserver.`,
      readyContent: `Objet : Une piste rien que pour vous ${emailTarget.label.split(' ')[0]} ?

Bonjour,

${emailTarget.label.charAt(0).toUpperCase()}${emailTarget.label.slice(1)}, le centre est au calme, c'est le moment idéal pour profiter des pistes sans attendre.

Si l'envie vous dit, répondez simplement avec l'heure qui vous arrange et on vous garde un créneau.

À très vite,
L'équipe ${String(centerFacts.centerName || '').trim() || 'du centre'}`,
    });
  }

  const worstFact = facts.find((fact) => fact.id === 'dow_worst');
  if (worstFact) {
    const recurring = weak.filter((day) => day.dow === worstFact.dow);
    if (recurring.length >= 2) {
      actions.push({
        id: `structural:${DAY_LABELS_FR[worstFact.dow]}`,
        type: 'structural_offer',
        channel: 'interne',
        executeOn: today,
        targetDate: recurring[0].date,
        title: `Offre récurrente du ${DAY_LABELS_FR[worstFact.dow]}`,
        why: `${worstFact.label} Le creux revient ${recurring.length} fois sur les 14 prochains jours : une offre fixe (écoles, seniors, afterwork) le comble durablement, décision gérant, l'offre exacte reste la tienne.`,
        readyContent: `Idée à cadrer : offre spéciale ${DAY_LABELS_FR[worstFact.dow]} hors vacances. Une fois décidée, l'annoncer via un post + la séquence email, les deux se mesurent ici.`,
      });
    }
  }

  const strong = (outlook.days || []).find((day) => day.level === 'fort' && day.booked && day.booked.pax > 0);
  if (strong) {
    actions.push({
      id: `harvest:${strong.date}`,
      type: 'harvest',
      channel: 'terrain',
      executeOn: strong.date,
      targetDate: strong.date,
      title: `${strong.label.charAt(0).toUpperCase()}${strong.label.slice(1)} sera plein : fais des photos et récolte les avis`,
      why: `${strong.label} s'annonce fort (${strong.booked.pax} pers. déjà réservées). Un jour plein, c'est la matière marketing la moins chère : photos et vidéos pour les réseaux, et les avis Google partent tout seuls via le mail post-visite.`,
      readyContent: 'Checklist du jour fort : 1) filmer 2-3 plans (arrivée, activité, sourire final) pour les posts de la semaine ; 2) vérifier que le lien avis Google est configuré (page Emails → Merci post-visite) ; 3) noter ce qui a rempli la journée pour le refaire.',
    });
  }

  // U-plan : réinjection par patterns au plan. À creux/calme égaux, plusieurs
  // canaux se disputent la fenêtre ; on surface d'abord celui que CE centre a
  // DÉMONTRÉ le plus efficace (effet net appris), au lieu de l'ordre de
  // construction fixe. Zéro coût (pur calcul sur marketing_patterns). Sans
  // historique (patterns vide) → tri stable = ordre inchangé (centre jeune).
  const channelScore = (channel) => {
    const social = ['instagram', 'facebook'];
    const rows = (patterns || []).filter((p) => (channel === 'email' ? p.channel === 'email' : social.includes(p.channel))
      && ['creux', 'quiet_day', 'calme'].includes(p.trigger)
      && !(p.netDeltaPct === null || p.netDeltaPct === undefined ? (p.rawDeltaPct === null || p.rawDeltaPct === undefined) : false));
    if (!rows.length) return null;
    return Math.max(...rows.map((p) => (p.netDeltaPct === null || p.netDeltaPct === undefined ? p.rawDeltaPct : p.netDeltaPct)));
  };
  const actionScore = (action) => {
    if (action.channel === 'email') return channelScore('email');
    if (['instagram', 'facebook'].includes(action.channel)) return channelScore('social');
    return null; // interne / terrain : pas de pattern social/email → repli d'ordre
  };
  const ordered = actions
    .map((action, index) => ({ action, index, score: actionScore(action) }))
    .sort((a, b) => {
      const as = a.score === null || a.score === undefined ? -Infinity : a.score;
      const bs = b.score === null || b.score === undefined ? -Infinity : b.score;
      return (bs - as) || (a.index - b.index);
    })
    .map((x) => x.action);

  return ordered.slice(0, 4);
}

// ── Post Instagram du jour (PUR) ─────────────────────────────────────────────

const INSTAGRAM_HASHTAGS_BASE = ['#bowling', '#lasergame', '#funGalaxy', '#ardenne', '#sortieenfamille'];

// Attribution honnête de l'angle du bandit au post du jour (zéro coût, pure
// comptabilité) : le template de chaque thème EST déjà écrit selon un angle des
// bras du bandit (marketing-bandit ANGLES). météo/événement/vacances = accroche
// « actualité » (le pourquoi maintenant) ; creux/éditorial = « situation » vécue.
// Attacher cet angle multiplie le volume d'entraînement du bandit : le post du
// jour est le canal principal, sa mesure J+14 récompensait un angle « null ».
const THEME_ANGLE = {
  rain: 'actualite', heat: 'actualite', local_event: 'actualite',
  school_holiday: 'actualite', fill_gap: 'situation', editorial: 'situation',
};
// Vocabulaire de déclencheur PERSISTÉ pour chaque thème (aligné sur
// propositionFromDailyPost) : sert à retrouver le pattern historique du thème.
const THEME_TRIGGER = {
  rain: 'pluie', heat: 'chaleur', fill_gap: 'creux',
  local_event: 'evenement', school_holiday: 'vacances', editorial: 'plan',
};

function bestPostTime(audience, dow) {
  // Heuristique assumée (affichée comme telle) : familles → fin d'après-midi en
  // semaine, fin de matinée le weekend ; public jeune → soirée.
  if (['ados', 'amis', 'jeunes'].some((word) => String(audience || '').includes(word))) return '18h-20h';
  return dow === 0 || dow === 6 ? '11h-12h' : '17h-19h';
}

function buildInstagramDaily({
  today,
  outlook,
  centerFacts = {},
  localEvents = [],
  nextHoliday = null,
  patterns = [],
} = {}) {
  const days = outlook.days || [];
  const dow = dayOfWeek(today);

  const nearWeak = days.find((day, index) => index >= 2 && index <= 4 && (day.level === 'creux' || day.level === 'calme'));
  const nearRain = days.find((day, index) => index >= 2 && index <= 3 && day.precipMm !== null && day.precipMm >= RAIN_THRESHOLD_MM);
  const nearHeat = days.find((day, index) => index >= 2 && index <= 3 && day.tmax !== null && day.tmax >= STRONG_HEAT_THRESHOLD_C);
  const event = localEvents.find((item) => item.from <= addDaysIso(today, 14));
  const holidaySoon = nextHoliday && nextHoliday.from >= today && nextHoliday.from <= addDaysIso(today, 14) ? nextHoliday : null;

  // U-plan : les thèmes ÉLIGIBLES aujourd'hui, en priorité de cascade (l'ordre
  // historique = le repli quand rien n'est appris). Le post du jour reste
  // Instagram : on compare les patterns Insta/FB de même déclencheur.
  const candidates = [];
  if (nearRain) {
    candidates.push({ order: 0, make: () => ({
      id: 'rain',
      reason: `Pluie annoncée ${nearRain.label} (${Math.round(nearRain.precipMm)} mm), les familles vont chercher un plan au sec, on poste 2-3 jours avant.`,
      caption: `Pluie annoncée ${nearRain.label} ? Zéro goutte chez nous : bowling, laser game et arcades bien au sec. Réserve ta piste avant que tout le monde ait la même idée.`,
      occasionId: 'sortie_amis',
    }) });
  }
  if (nearHeat) {
    candidates.push({ order: 1, make: () => ({
      id: 'heat',
      reason: `${Math.round(nearHeat.tmax)} °C annoncés ${nearHeat.label}, le plan fraîcheur se poste avant le jour J.`,
      caption: `${Math.round(nearHeat.tmax)}° annoncés ${nearHeat.label}, chez nous il fait frais toute la journée. Bowling, laser game, arcades : le plan fraîcheur à 5 minutes.`,
      occasionId: 'sortie_amis',
    }) });
  }
  if (nearWeak) {
    candidates.push({ order: 2, make: () => ({
      id: 'fill_gap',
      reason: `${nearWeak.label} s'annonce ${nearWeak.level} (${nearWeak.expected} visiteurs attendus, médiane ${outlook.medianVisitors}), le post du jour travaille ce creux.`,
      caption: null,
      occasionId: 'creneau_calme',
    }) });
  }
  if (event) {
    candidates.push({ order: 3, make: () => ({
      id: 'local_event',
      // Langage humain, pas de notation technique (la fleche « → » et les
      // parentheses de dates faisaient robot a l'ecran, retour Movsar 17/07).
      reason: `La ${event.label} est à 5 minutes du centre, du ${event.from.slice(8, 10)}/${event.from.slice(5, 7)} au ${event.to.slice(8, 10)}/${event.to.slice(5, 7)} : capte ce flux avant qu'il passe.`,
      caption: `${event.label} : on est à 5 minutes. Avant ou après votre visite, pause bowling, laser game ou arcades, au calme et au frais.`,
      occasionId: 'family_day',
    }) });
  }
  if (holidaySoon) {
    candidates.push({ order: 4, make: () => ({
      id: 'school_holiday',
      reason: `${holidaySoon.label} démarre le ${holidaySoon.from.slice(8, 10)}/${holidaySoon.from.slice(5, 7)} (calendrier FWB), les familles planifient maintenant.`,
      caption: `${holidaySoon.label} : ça commence le ${holidaySoon.from.slice(8, 10)}/${holidaySoon.from.slice(5, 7)}. Anniversaires, sorties en famille, après-midis entre amis, réserve ton créneau, les vacances partent vite.`,
      occasionId: 'anniversaire_enfant',
    }) });
  }

  let theme;
  if (candidates.length) {
    // Pattern historique (effet net appris) du thème : canal social (Insta/FB) +
    // déclencheur persisté du thème. Null si jamais mesuré → repli sur la cascade.
    const themeScore = (id) => {
      const rows = (patterns || []).filter((p) => ['instagram', 'facebook'].includes(p.channel) && p.trigger === THEME_TRIGGER[id]);
      if (!rows.length) return null;
      return Math.max(...rows.map((p) => (p.netDeltaPct === null || p.netDeltaPct === undefined
        ? (p.rawDeltaPct === null || p.rawDeltaPct === undefined ? -Infinity : p.rawDeltaPct)
        : p.netDeltaPct)));
    };
    // Le thème dont l'historique convertit le mieux gagne ; à égalité (ou sans
    // aucun historique), l'ordre de cascade tranche → comportement inchangé pour
    // un centre jeune.
    theme = candidates
      .map((c) => ({ c, id: c.make().id }))
      .map((x) => ({ ...x, score: themeScore(x.id) }))
      .sort((a, b) => {
        const as = a.score === null ? -Infinity : a.score;
        const bs = b.score === null ? -Infinity : b.score;
        return (bs - as) || (a.c.order - b.c.order);
      })[0].c.make();
  } else {
    // Rythme éditorial de la marque pour ce jour de semaine.
    const dayName = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'][dow];
    const rhythm = (FUN_GALAXY_BRAND.editorialRhythms || []).find((item) => item.day === dayName)
      || (FUN_GALAXY_BRAND.editorialRhythms || []).find((item) => item.day === 'Weekend' && (dow === 0 || dow === 6));
    theme = {
      id: 'editorial',
      reason: rhythm ? `Rythme éditorial du ${dayName.toLowerCase()} : ${rhythm.reason}.` : 'Aucun signal fort aujourd\'hui, on entretient la présence.',
      caption: null,
      occasionId: rhythm ? rhythm.occasion : 'formules_decouverte',
    };
  }

  const occasion = resolveOccasion(theme.occasionId);
  const composed = composeChannelDraft({ channel: 'instagram', facts: centerFacts, occasion, audience: occasion.audience });
  const caption = theme.caption || composed.body;
  const activity = (centerFacts.activities || [])[0] || 'bowling';
  const hashtags = [...new Set([
    ...INSTAGRAM_HASHTAGS_BASE,
    `#${String(centerFacts.city || '').toLowerCase().replace(/[^a-z0-9]/g, '')}`,
    `#${String(occasion.resonanceWord || '').toLowerCase().replace(/[^a-z0-9]/g, '')}`,
  ])].filter((tag) => tag.length > 1);

  return {
    date: today,
    themeId: theme.id,
    // Angle du bandit attribué au post du jour (attribution honnête du canal
    // principal) : mesuré à J+14, il entraîne le bras correspondant. Zéro coût.
    angle: THEME_ANGLE[theme.id] || 'situation',
    reason: theme.reason,
    caption,
    visualBrief: `À filmer aujourd'hui : arrivée d'un groupe, ${activity} en action, un vrai moment fort, sourire final. Format vertical, lumière naturelle, pas de mise en scène.`,
    bestTime: bestPostTime(occasion.audience, dow),
    bestTimeNote: 'Heuristique d\'audience (familles fin d\'après-midi, jeunes en soirée), à ajuster avec tes propres stats Instagram.',
    hashtags,
    occasionLabel: occasion.label || '',
  };
}

// Polish IA de la légende du post du jour : même doctrine que polishIdeaWithAi :
// grounding dur (aucun nombre hors entrée → rejet silencieux, template conservé),
// cache mémoire par (centre, jour, thème) pour que le GET de la page ne paie
// l'appel qu'une fois par jour et par lambda chaude.
const instaPolishCache = new Map();
async function polishInstagramCaption(instagram, centerFacts) {
  const { llmProvider, callLlmJson } = require('./llm-client');
  if (!llmProvider()) return null;
  const cacheKey = `${centerFacts.centerId || 'libramont'}|${instagram.date}|${instagram.themeId}`;
  if (instaPolishCache.has(cacheKey)) return instaPolishCache.get(cacheKey);
  const { COPY_SYSTEM_CORE, channelPlaybook, COPY_FINAL_REMINDER } = require('./copy-playbook');
  const result = await callLlmJson({
    stableSystem: [
      'Tu réécris la légende Instagram du jour d\'un centre de loisirs indoor belge (bowling, laser game, arcades).',
      'RÈGLE ABSOLUE : uniquement les faits fournis. INTERDIT d\'ajouter un chiffre, un prix, une promotion, une activité ou une disponibilité qui n\'y figure pas. Les chiffres des exemples canoniques sont un ADN d\'écriture, PAS des faits.',
      COPY_SYSTEM_CORE,
      channelPlaybook('instagram'),
      'Réponds uniquement en JSON conforme au schéma : champ texte : la légende seule, sans hashtags.',
    ].join('\n\n'),
    user: JSON.stringify({
      legendeActuelle: instagram.caption,
      contexte: instagram.reason,
      centre: { nom: centerFacts.centerName, ville: centerFacts.city, activites: (centerFacts.activities || []).slice(0, 5) },
      rappel: `${COPY_FINAL_REMINDER} Ta légende ne contient QUE des nombres déjà présents dans legendeActuelle ou contexte, AUCUN autre.`,
    }),
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: { texte: { type: 'string' } },
      required: ['texte'],
    },
    schemaName: 'insta_daily_caption',
    maxTokens: 400,
    timeoutMs: 10000,
  }).catch(() => null);
  const text = result && typeof result.texte === 'string' ? result.texte.trim() : '';
  if (!text || text.length < 30 || text.length > 900) return null;
  // Grounding : tout nombre de la sortie doit exister dans l'entrée.
  const allowed = new Set((`${instagram.caption} ${instagram.reason}`).match(/\d+(?:[.,]\d+)?/g) || []);
  const outNumbers = text.match(/\d+(?:[.,]\d+)?/g) || [];
  if (outNumbers.some((n) => !allowed.has(n))) return null;
  instaPolishCache.set(cacheKey, text);
  if (instaPolishCache.size > 50) instaPolishCache.delete(instaPolishCache.keys().next().value);
  return text;
}

// ── Assemblage (I/O) ─────────────────────────────────────────────────────────

function defaultCalendar(date) {
  const school = isSchoolHolidayFWB(date);
  const publicHoliday = isPublicHolidayBE(date);
  return {
    isSchoolHoliday: school.holiday,
    isPublicHoliday: publicHoliday.holiday,
    holidayLabel: publicHoliday.label || school.label || '',
    events: [],
  };
}

async function buildMarketingBrain(centerId = 'libramont', { today = null } = {}, deps = {}) {
  const query = deps.query || ((text, params) => getPool().query(text, params));
  const buildFacts = deps.buildCenterFacts || require('./marketing-agents').buildCenterFacts;
  const todayStr = today || isoDate(new Date());
  const horizonEnd = addDaysIso(todayStr, HORIZON_DAYS - 1);

  const [historyResult, forecastResult, bookedResult] = await Promise.all([
    query(
      `select date::text as date, visitors, revenue_total, weather_tmax, weather_precip_mm,
              is_school_holiday, is_public_holiday, holiday_label
       from daily_center_metrics
       where center_id = $1 and date >= ($2::date - 365) and date < $2::date
       order by date asc;`,
      [centerId, todayStr],
    ),
    query(
      `select date::text as date, tmax, precip_mm
       from weather_daily_forecast
       where center_id = $1 and date >= $2 and date <= $3;`,
      [centerId, todayStr, horizonEnd],
    ).catch(() => ({ rows: [] })),
    query(
      `select date::text as date, count(*)::int as reservations,
              coalesce(sum(pax), 0)::int as pax, coalesce(sum(price), 0)::numeric as revenue
       from reservations
       where center_id = $1 and status <> 'cancelled' and date >= $2 and date <= $3
         and ${simulationSqlExclusion()}
       group by date;`,
      [centerId, todayStr, horizonEnd],
    ).catch(() => ({ rows: [] })),
  ]);

  const history = historyResult.rows.map((row) => ({
    ...row,
    visitors: toNumber(row.visitors, 0),
    weather_tmax: row.weather_tmax === null ? null : toNumber(row.weather_tmax, null),
    weather_precip_mm: row.weather_precip_mm === null ? null : toNumber(row.weather_precip_mm, null),
  }));
  const forecast = forecastResult.rows.map((row) => ({
    date: row.date,
    tmax: row.tmax === null ? null : toNumber(row.tmax, null),
    precipMm: row.precip_mm === null ? null : toNumber(row.precip_mm, null),
  }));
  const bookedByDate = new Map(bookedResult.rows.map((row) => [row.date, {
    reservations: toNumber(row.reservations, 0),
    pax: toNumber(row.pax, 0),
    revenue: toNumber(row.revenue, 0),
  }]));

  const { facts } = computeFactsFromRows(history);
  const localEvents = upcomingLocalEvents(centerId, todayStr, 21);
  const localEventsByDate = (date) => localEvents
    .filter((item) => date >= item.from && date <= item.to)
    .map((item) => item.label);
  const calendar = (date) => ({ ...defaultCalendar(date), events: localEventsByDate(date) });
  const centerFacts = buildFacts(centerId);
  // Patterns appris (effet net mesuré par contexte) : réinjectés dans le plan
  // ET le post du jour (U-plan). Pur SQL, zéro token, fail-soft (jeune → []).
  const patterns = await (deps.listMarketingPatterns || listMarketingPatterns)(centerId, { limit: 20 }).catch(() => []);

  const outlook = computeAttendanceOutlook({ today: todayStr, history, forecast, bookedByDate, facts, calendar });
  const explainPast = explainRecentDays({ today: todayStr, history });
  const plan = buildMarketingPlan({ today: todayStr, outlook, facts, centerFacts, patterns });
  const instagram = buildInstagramDaily({
    today: todayStr,
    outlook,
    centerFacts,
    localEvents,
    nextHoliday: nextSchoolHolidayFWB(todayStr),
    patterns,
  });
  // La légende passe par le copywriter IA quand la clé est là (fail-soft : le
  // template reste si l'IA échoue ou invente un chiffre ; inerte sans clé).
  const polishedCaption = await polishInstagramCaption(instagram, centerFacts);
  if (polishedCaption) {
    instagram.caption = polishedCaption;
    instagram.aiPolished = true;
  }

  return {
    ok: true,
    centerId,
    today: todayStr,
    dataDays: outlook.dataDays,
    medianVisitors: outlook.medianVisitors,
    outlook: outlook.days,
    explainPast,
    plan,
    instagram,
    // Faits causaux (jour/météo/vacances/tendance) : alimentent la surface
    // « Ce qui marche ». Déjà calculés pour la prévision ; on les expose.
    facts,
  };
}

// « C'est fait » sur une action du plan : insertion dans marketing_insights en
// statut applied (dédupe 7 j par signature) : la mesure avant/après existante
// (measureAppliedInsights) prendra le relais à J+14.
async function markPlanActionDone(centerId, action = {}, deps = {}) {
  const query = deps.query || ((text, params) => getPool().query(text, params));
  const id = String(action.id || '').trim();
  if (!/^[a-z_]+:[0-9a-z-]+$/i.test(id)) {
    const error = new Error('Action de plan invalide.');
    error.statusCode = 400;
    error.expose = true;
    throw error;
  }
  const signature = `plan:${id}`;
  const existing = await query(
    `select 1 from marketing_insights
     where center_id = $1 and signature = $2 and proposed_at > now() - interval '7 days'
     limit 1;`,
    [centerId, signature],
  );
  if (existing.rows[0]) {
    const error = new Error('Cette action a déjà été marquée faite il y a moins de 7 jours.');
    error.statusCode = 409;
    error.expose = true;
    throw error;
  }
  const title = String(action.title || 'Action du plan marketing').slice(0, 200);
  const why = String(action.why || '').slice(0, 1000);
  const channel = ['instagram', 'facebook', 'email', 'interne', 'terrain'].includes(action.channel) ? action.channel : 'interne';
  const targetDate = /^\d{4}-\d{2}-\d{2}$/.test(String(action.targetDate || '')) ? action.targetDate : null;
  const result = await query(
    `insert into marketing_insights (center_id, kind, title, body, channel, ready_content, data_basis, signature, status, applied_at)
     values ($1, 'plan_action', $2, $3, $4, $5, $6, $7, 'applied', now())
     returning id;`,
    [
      centerId,
      title,
      why,
      channel,
      String(action.readyContent || '').slice(0, 4000),
      JSON.stringify(targetDate ? [{ source: 'marketing_brain_plan', targetDate }] : [{ source: 'marketing_brain_plan' }]),
      signature,
    ],
  );
  return { ok: true, id: Number(result.rows[0].id), signature, status: 'applied' };
}

module.exports = {
  // Purs (testables sans DB)
  buildBaselines,
  learnedWeatherEffect,
  levelFor,
  computeAttendanceOutlook,
  explainRecentDays,
  buildMarketingPlan,
  buildInstagramDaily,
  bestPostTime,
  // I/O
  buildMarketingBrain,
  markPlanActionDone,
  HORIZON_DAYS,
};

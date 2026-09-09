// « Demander » : l'agent marketing REPOND aux questions libres du gerant.
//
// Avant, ce mode etait une cascade de regex cote navigateur : « prix », « meteo »,
// « concurrent », « plan » rendaient chacun une reponse pre-ecrite, et TOUT le
// reste tombait sur « je ne sais pas encore analyser ca librement ». Aucun appel
// modele. Le produit vendait un employe marketing et livrait un routeur de
// mots-cles : deux questions differentes sur le meme sujet recevaient le meme
// paragraphe, mot pour mot.
//
// Ici un modele repond, mais il ne repond QUE depuis un DOSSIER de faits reels
// du centre : catalogue d'activites, formules et leurs prix effectifs, journees
// mesurees, radar 14 jours (meteo, evenements, reservations posees), panier
// moyen, impact mesure, veille concurrentielle. Trois gardes tiennent la loi
// produit (« l'agent n'invente jamais, et dit ce qu'il ne sait pas ») :
//
//   1. AVANT : le dossier est la seule matiere. Le prompt l'impose et le schema
//      force deux listes, `faits` (ce qu'il a utilise, chiffre a l'appui) et
//      `jeNeSaisPas` (ce qui manquait).
//   2. APRES : la reponse est relue. Une activite absente de CE centre, un prix
//      ou un pourcentage absent du dossier -> la reponse est REFUSEE, jamais
//      affichee. C'est la meme doctrine que le scorer des posts, reduite a ce
//      qui protege vraiment (l'invention), sans les criteres de style qui n'ont
//      aucun sens dans une conversation interne.
//   3. SANS MODELE : pas de cle, budget au plafond, panne, timeout ou reponse
//      refusee -> le serveur rend `grounded: false` et le navigateur reprend sa
//      reponse deterministe. Le gabarit redevient un filet ; il ne decide plus.
//
// Frontiere des donnees : `usage: 'sensitive'` (le defaut). La question est du
// texte LIBRE tape par le gerant : elle peut contenir le nom d'un client. Elle
// ne doit donc jamais sortir vers un modele « :free » d'OpenRouter, dont les
// fournisseurs peuvent exploiter les requetes (voir OPENROUTER_ALLOWED dans
// lib/llm-client.js). Kimi est contractuel : c'est lui qui repond.

const { getPool } = require('./database');
const { buildCenterFacts, collectFactPriceTokens, extractNumericTokens } = require('./marketing-agents');
const { buildMarketingBriefBundle } = require('./marketing-brief');
const { getMergedFormulas } = require('./catalog-overrides');
const { listCenterActivities } = require('./activity-catalog');
const { callLlmJson, llmProvider } = require('./llm-client');
const {
  peutAffirmer, sansAccentNiCasse, conseilDeRegleCommerciale, tiretsDeModele,
  nombresDUnObjet, nombresDe,
} = require('./center-guards');
const { NATURES_PROPOSABLES } = require('./center-advisor');
const { isBudgetExhausted } = require('./llm-budget');

const MAX_QUESTION_CHARS = 400;
const MAX_ANSWER_CHARS = 1200;
const MAX_FACTS = 5;
const MAX_UNKNOWNS = 3;
// Les seules suites d'ecran que le front sait ouvrir. Le modele CHOISIT dans
// cette liste fermee : une action libre serait une promesse d'ecran inexistant.
const ACTIONS = new Set(['creer_post', 'ouvrir_plan', 'ouvrir_impact', 'ouvrir_marche', 'aucune']);

function text(value, max = 400) {
  return String(value === null || value === undefined ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// Un chiffre du dossier s'ecrit TOUJOURS avec son unite (« 15.4 € », « +12 % »).
// Deux raisons, pas une : le modele sait ce que le nombre signifie, et le
// controle d'apres coup (collectFactPriceTokens) reconnait le montant ou le
// pourcentage comme prouve. Un « avgBasket: 15.4 » nu aurait fait bloquer une
// reponse pourtant exacte.
function euro(value) {
  const parsed = num(value);
  return parsed === null ? null : `${Math.round(parsed * 10) / 10} €`;
}

function percent(value) {
  const parsed = num(value);
  if (parsed === null) return null;
  const rounded = Math.round(parsed);
  return `${rounded > 0 ? '+' : ''}${rounded} %`;
}

const DAYS_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

function frDay(dateStr) {
  const date = new Date(`${dateStr}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return dateStr;
  return `${DAYS_FR[date.getUTCDay()]} ${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

// ── Le dossier de faits ─────────────────────────────────────────────────────
// Tout ce que l'agent a le droit de savoir sur CE centre, et rien d'autre. Il
// est assemble a chaque question : le gerant qui demande « et demain ? » lit la
// meteo d'aujourd'hui, pas celle du dernier cycle cron.
function buildAskDossier({ bundle = {}, centerFacts = {}, formulas = [], activities = [], registre = null } = {}) {
  const facts = bundle.facts || {};
  const pulse = bundle.pulse || {};
  const paie = bundle.paie || {};
  const weather = facts.weather || null;

  const formules = (formulas || []).slice(0, 20).map((formula) => {
    const price = formula && typeof formula.price === 'object' ? formula.price : null;
    const value = num(price ? price.value : formula.price);
    const type = text(price ? price.type : formula.type, 30);
    return {
      nom: text(formula.name, 80),
      prix: value === null ? 'non renseigne' : `${value} €${type === 'per_pax' ? ' par personne' : ''}`,
      minPersonnes: num(formula.minPax),
    };
  }).filter((formula) => formula.nom);

  const activites = (activities || []).slice(0, 20).map((activity) => ({
    nom: text(activity.name, 60),
    prix: activity.priceValue === null || activity.priceValue === undefined
      ? 'regle sur place'
      : `${activity.priceValue} €${activity.unitLabel ? ` ${text(activity.unitLabel, 24)}` : ''}`,
    note: text(activity.note, 80) || undefined,
  })).filter((activity) => activity.nom);

  return {
    aujourdhui: text(bundle.today, 10),
    centre: {
      nom: text(centerFacts.centerName, 60),
      ville: text(centerFacts.city, 40),
      // LA liste fermee. Le prompt interdit de citer quoi que ce soit d'autre,
      // et le controle d'apres coup verifie qu'aucune activite absente n'est
      // passee. Libramont n'a ni karting, ni realite virtuelle, ni escape game.
      activitesDisponibles: (centerFacts.activities || []).slice(0, 20),
      pistesBowling: num(centerFacts.laneCount),
      themesReels: centerFacts.themes || {},
      notePubliee: centerFacts.googleRating
        ? { note: centerFacts.googleRating, avis: centerFacts.googleReviews }
        : null,
    },
    formules,
    activitesEtPrix: activites,
    joursMesures: num(bundle.dataDays),
    pouls: {
      chiffreAffaires30j: euro(pulse.revenue30),
      visiteurs30j: num(pulse.visitors30),
      panierMoyen: euro(pulse.avgBasket),
      personnesDejaPosees14j: num(pulse.upcomingPax),
      reservationsPosees14j: num(pulse.upcomingResa),
      chiffreDejaReserve: euro(pulse.reservedRevenue),
      meilleureJournee30j: pulse.bestDay
        ? { date: pulse.bestDay.date, chiffre: euro(pulse.bestDay.revenue), visiteurs: num(pulse.bestDay.visitors) }
        : null,
    },
    faitsMesures: {
      meilleurJourSemaine: facts.bestDay
        ? `${facts.bestDay.label} : ${facts.bestDay.avgVisitors} visiteurs en moyenne (${percent(facts.bestDay.vsMedianPct)} vs la mediane, confiance ${facts.bestDay.confidence})`
        : null,
      pireJourSemaine: facts.worstDay
        ? `${facts.worstDay.label} : ${facts.worstDay.avgVisitors} visiteurs en moyenne (${percent(facts.worstDay.vsMedianPct)} vs la mediane, confiance ${facts.worstDay.confidence})`
        : null,
      effetPluie: weather && weather.rainEffectPct !== null && weather.rainEffectPct !== undefined
        ? `${percent(weather.rainEffectPct)} de frequentation les jours de pluie (${weather.sampleDays} jours de recul, confiance ${weather.confidence})`
        : null,
      effetChaleur: weather && weather.heatEffectPct !== null && weather.heatEffectPct !== undefined
        ? `${percent(weather.heatEffectPct)} de frequentation les jours chauds (${weather.sampleDays} jours de recul, confiance ${weather.confidence})`
        : null,
      effetCongesScolaires: facts.holidayEffectPct !== null && facts.holidayEffectPct !== undefined
        ? `${percent(facts.holidayEffectPct)} pendant les conges (confiance ${facts.holidayEffectConfidence || 'exploratoire'})`
        : null,
      tendance4Semaines: facts.trend4w ? `${percent(facts.trend4w.pct)} sur les 4 dernieres semaines` : null,
    },
    radar14j: (bundle.radar || []).slice(0, 14).map((day) => ({
      date: day.date,
      jour: frDay(day.date),
      niveau: text(day.level, 20),
      temperature: day.tmax === null || day.tmax === undefined ? null : `${Math.round(day.tmax)} °C`,
      pluie: day.precipMm === null || day.precipMm === undefined ? null : `${Math.round(day.precipMm)} mm`,
      evenement: text(day.event, 80) || null,
      personnesDejaPosees: num(day.resaCount),
      lecture: text(day.explanation, 200),
    })),
    // La fiche du REGISTRE : clients, taux de retour, dormants, catalogue qui
    // ne se vend pas, annulations, anticipation, trous de la donnee. Rien de
    // tout ca n etait calcule : le dossier savait parler de meteo et de
    // frequentation, jamais de qui reserve ni de ce qui dort au catalogue.
    // Chaque fait porte ce qu il autorise, pour que le modele ne batisse pas
    // un conseil sur une anecdote.
    registre: registre ? Object.values(registre).map((f) => ({
      id: f.id,
      libelle: f.libelle,
      valeur: f.valeur,
      observations: f.n,
      moisCouverts: (f.mois || []).length,
      calcul: f.source,
      peutPorter: NATURES_PROPOSABLES.filter((nature) => peutAffirmer(f, nature).autorise),
    })) : null,
    contextesMesures: (bundle.patterns || []).slice(0, 8).map((pattern) => ({
      contexte: text(pattern.context, 60),
      effetNet: percent(pattern.netDeltaPct),
      mesuresPrises: num(pattern.n),
      confiance: text(pattern.confidence, 20),
    })),
    impactMesure: {
      tropJeunePourUnVerdict: Boolean(paie.young),
      fenetreSansEnvoi: Boolean(paie.quietWindow),
      chiffreLieAuxMessages: euro(paie.euros),
      visitesHonorees: num(paie.venues),
      messagesEnvoyes: num(paie.sent),
      fenetreJours: num(paie.days),
      premierVerdictLe: text(paie.firstVerdictDate, 40),
    },
    veille: {
      concurrentsSurveilles: num((bundle.veille || {}).count),
      changementsRecents: ((bundle.veille || {}).changed || []).slice(0, 4).map((rival) => ({
        nom: text(rival.name, 60),
        changement: text(rival.diff, 200),
      })),
    },
    propositionsDejaPretes: (bundle.propositions || []).slice(0, 6).map((proposition) => ({
      pourquoi: text(proposition.whyShort || proposition.why, 160),
      canal: text(proposition.network || proposition.kind, 20),
      jourVise: text(proposition.targetDate || proposition.dueDate, 10) || null,
    })),
    recusRecents: (bundle.receipts || []).slice(0, 5).map((receipt) => ({
      quoi: text(receipt.label, 80),
      resultat: text(receipt.result, 80),
    })),
  };
}

// ── Le prompt ────────────────────────────────────────────────────────────────
// Bloc STABLE (identique d'une question a l'autre) : il porte la loi produit et
// le ton. Le dossier, lui, change a chaque appel et part cote user.
function askSystemPrompt() {
  return [
    'Tu es l\'employe marketing d\'un centre de loisirs indoor belge (bowling, laser game, arcades, anniversaires, groupes). Tu parles au gerant du centre, en francais, comme un collegue qui connait la maison par coeur.',
    'TA SEULE MATIERE est le dossier de faits fourni. Tu ne sais rien d\'autre sur ce centre, et tu n\'as pas le droit de completer avec ce que tu connais des centres de loisirs en general.',
    [
      'INTERDITS ABSOLUS :',
      '- ne cite JAMAIS une activite absente de centre.activitesDisponibles. Ce centre n\'a pas ce qu\'il n\'a pas.',
      '- n\'invente JAMAIS un prix, un pourcentage, une remise ni une promotion : seuls les montants et pourcentages ecrits dans le dossier existent.',
      '- ne promets JAMAIS une disponibilite, une place gardee ni une session privee.',
      '- ne parle JAMAIS de paiement en ligne, d\'acompte ni de reservation payante : le centre encaisse chez lui, le logiciel n\'encaisse rien.',
      '- ne dis JAMAIS qu\'une publication est partie ou partira toute seule : tu PREPARES, le gerant valide et publie lui-meme.',
      '- pas de tiret cadratin.',
    ].join('\n'),
    'CHIFFRES : chaque chiffre que tu avances est recopie du dossier avec son unite, jamais recalcule de tete. Si tu ne peux pas recopier un chiffre, n\'en donne pas.',
    'CE QUE TU NE SAIS PAS : dis-le, en une phrase, dans jeNeSaisPas, et reponds quand meme avec ce que tu as. Dire ce que tu ignores est ce qui rend credible tout le reste. Si la question sort completement du centre et de son marketing, dis simplement que ce n\'est pas ton sujet.',
    'TON : direct, court, concret. Le gerant a une quarantaine d\'annees, il n\'est pas technique, il veut savoir quoi faire. Pas de jargon, pas de liste a rallonge, pas de flatterie.',
    'SUITE : `action` est la seule suite d\'ecran que tu peux proposer, choisie dans la liste du schema. `jourVise` porte la date AAAA-MM-JJ quand la question vise UN jour du radar (et seulement une date qui y figure), chaine vide sinon.',
    'Reponds uniquement en JSON conforme au schema.',
  ].join('\n\n');
}

const ASK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    titre: { type: 'string' },
    reponse: { type: 'string' },
    faits: { type: 'array', items: { type: 'string' } },
    jeNeSaisPas: { type: 'array', items: { type: 'string' } },
    action: { type: 'string', enum: ['creer_post', 'ouvrir_plan', 'ouvrir_impact', 'ouvrir_marche', 'aucune'] },
    jourVise: { type: 'string' },
  },
  required: ['titre', 'reponse', 'faits', 'jeNeSaisPas', 'action', 'jourVise'],
};

// ── Le controle d'apres coup ────────────────────────────────────────────────
// Ce que le prompt demande n'est pas ce que le modele fait : on relit.
//
// Deux familles seulement, celles qui font mentir le produit :
//   - une activite que CE centre n'a pas (forbiddenClaims, deja calcule par
//     buildCenterFacts a partir de la vraie disponibilite du centre) ;
//   - un prix ou un pourcentage que le dossier ne porte pas.
//
// Volontairement PAS les mots d'offre (« promo », « gratuit ») que bloque
// ungroundedPriceClaims pour les POSTS : ici la reponse n'est pas publiee, elle
// est lue par le gerant. « Tu pourrais tester une promo sur ce creneau » est un
// conseil legitime ; l'interdit porte sur le CHIFFRE d'une promo inventee, pas
// sur le mot. Appliquer la regle des posts ici aurait bloque la moitie des
// reponses utiles.
function checkAnswerGrounding(answerText, { centerFacts = {}, dossier = {} } = {}) {
  const raw = String(answerText || '');
  // Le normaliseur PARTAGE (lib/center-guards.js) aplatit aussi la ponctuation.
  // L ancien, local, ne retirait qu accents et casse : la liste des interdits
  // contient « golf o'clock », donc « golf o clock » passait ici alors que la
  // porte « Idees » l attrapait. Une garde qu on contourne en retirant une
  // apostrophe n en est pas une, et elle ne peut pas exister en deux versions.
  const strip = sansAccentNiCasse;
  const normalized = strip(raw);
  const reasons = [];

  for (const claim of centerFacts.forbiddenClaims || []) {
    const needle = strip(claim);
    if (needle && normalized.includes(needle)) reasons.push(`activite ou promesse absente du centre : ${claim}`);
  }

  const { percents, euros } = collectFactPriceTokens(dossier);
  for (const match of raw.match(/\d+(?:[.,]\d+)?\s?%/g) || []) {
    const token = extractNumericTokens(match)[0] || '';
    if (!percents.has(token)) reasons.push(`pourcentage absent du dossier : ${match.trim()}`);
  }
  for (const match of raw.match(/\d+(?:[.,]\d+)?\s?(?:€|eur(?:os?)?\b)/gi) || []) {
    const token = extractNumericTokens(match)[0] || '';
    if (!euros.has(token)) reasons.push(`montant absent du dossier : ${match.trim()}`);
  }

  // TOUT nombre ecrit doit exister dans le dossier, pas seulement ceux qui
  // portent un signe % ou EUR. La porte « Idees » verifie chaque nombre contre
  // la fiche depuis le debut ; celle-ci laissait passer « le minimum de 8
  // personnes », « nos 3 pistes », « 500 m2 de laser ». C etait l asymetrie
  // entre les deux portes du meme agent qui faisait le trou, pas la faiblesse
  // de l une des deux regles.
  // Les deux controles typees plus haut RESTENT : ils comparent des jetons de
  // meme nature (un pourcentage a un pourcentage), donc ils attrapent un
  // « 35 % » invente meme si la valeur 35 traine ailleurs dans le dossier. Le
  // controle general ci-dessous ne les remplace pas, il les complete.
  const nombresDuDossier = nombresDUnObjet(dossier);
  const intrus = [...new Set(
    nombresDe(raw).filter((x) => !nombresDuDossier.has(x.valeur)).map((x) => x.brut),
  )];
  for (const brut of intrus) reasons.push(`nombre absent du dossier : ${brut}`);

  // Un changement de regle commerciale ne se conclut pas d un historique
  // produit sous l ancienne regle, et ca ne depend pas de la porte par
  // laquelle la phrase sort.
  const regle = conseilDeRegleCommerciale(raw);
  if (regle.detecte) {
    reasons.push(`conseil de changer une regle commerciale (${regle.extraits.join(', ')}) : l historique a ete produit sous la regle actuelle`);
  }

  if (tiretsDeModele(raw).length) {
    reasons.push('tiret cadratin ou demi-cadratin : signature de modele, interdite partout');
  }

  return { blocked: reasons.length > 0, reasons: [...new Set(reasons)].slice(0, 5) };
}

function normalizeAnswer(payload = {}) {
  const faits = Array.isArray(payload.faits) ? payload.faits : [];
  const unknowns = Array.isArray(payload.jeNeSaisPas) ? payload.jeNeSaisPas : [];
  const action = ACTIONS.has(String(payload.action || '')) ? String(payload.action) : 'aucune';
  const jourVise = /^\d{4}-\d{2}-\d{2}$/.test(String(payload.jourVise || '')) ? String(payload.jourVise) : '';
  return {
    titre: text(payload.titre, 90) || 'Ce que je vois',
    reponse: text(payload.reponse, MAX_ANSWER_CHARS),
    faits: faits.map((fait) => text(fait, 180)).filter(Boolean).slice(0, MAX_FACTS),
    jeNeSaisPas: unknowns.map((item) => text(item, 180)).filter(Boolean).slice(0, MAX_UNKNOWNS),
    action,
    jourVise,
  };
}

// ── L'appel ─────────────────────────────────────────────────────────────────

async function loadFormulas(centerId, deps = {}) {
  if (deps.getMergedFormulas) return deps.getMergedFormulas(centerId);
  return getMergedFormulas(getPool(), centerId).catch(() => []);
}

async function answerMarketingQuestion(centerId = 'libramont', { question = '' } = {}, deps = {}) {
  const cleanQuestion = text(question, MAX_QUESTION_CHARS);
  if (cleanQuestion.length < 4) {
    const error = new Error('Pose ta question en quelques mots.');
    error.statusCode = 400;
    error.expose = true;
    throw error;
  }

  const provider = (deps.llmProvider || llmProvider)('sensitive');
  const exhausted = (deps.isBudgetExhausted || isBudgetExhausted)();
  // On ne monte pas le dossier pour rien : sans modele, le navigateur reprend
  // sa reponse deterministe et cet appel ne doit coute ni requete SQL ni
  // latence supplementaire.
  if (!provider || exhausted) {
    return { ok: true, grounded: false, reason: exhausted ? 'budget' : 'sans_modele', question: cleanQuestion };
  }

  const bundle = await (deps.buildMarketingBriefBundle || buildMarketingBriefBundle)(
    centerId,
    { days: 30 },
    // Le polissage du texte du brief est un SECOND appel modele dont la reponse
    // n'a aucun usage ici : on l'evite, la question a deja paye le sien.
    { skipPolish: true },
  ).catch(() => ({}));
  const centerFacts = (deps.buildCenterFacts || buildCenterFacts)(centerId);
  const formulas = await loadFormulas(centerId, deps);
  const activities = (deps.listCenterActivities || listCenterActivities)(centerId);
  // La fiche du registre est chargee ICI et pas dans le bundle : elle exclut
  // les lignes fabriquees (fabricatedSqlPredicate) alors que le bundle du brief
  // n exclut que les channels de simulation. Fail-soft : une fiche absente
  // appauvrit la reponse, elle ne doit pas faire echouer la question.
  let registre = null;
  try {
    const { chargerFicheDuRegistre } = require('./center-facts');
    registre = deps.chargerFicheDuRegistre
      ? await deps.chargerFicheDuRegistre({ centerId, aujourdhui: bundle.today })
      : await chargerFicheDuRegistre({ centerId, aujourdhui: bundle.today });
  } catch (error) { registre = null; }
  const dossier = buildAskDossier({ bundle, centerFacts, formulas, activities, registre });

  const result = await (deps.callLlmJson || callLlmJson)({
    usage: 'sensitive',
    stableSystem: askSystemPrompt(),
    user: JSON.stringify({
      question: cleanQuestion,
      dossier,
      // La liste des interdits reste HORS du dossier : elle contient des
      // tournures chiffrees (« 100% disponible ») qui, melangees aux faits,
      // rendraient un « 100 % » invente soudain prouve par le controle.
      interdits: (centerFacts.forbiddenClaims || []).slice(0, 40),
    }),
    schema: ASK_SCHEMA,
    schemaName: 'reponse_marketing',
    maxTokens: 900,
    // Mesure du 2026-08-14 sur des questions reelles, dossier complet : 10,7 s
    // et 11,9 s. La fonction ops a 30 s ; il faut y loger le montage du dossier
    // (2 a 4 s), cet appel, et jusqu'a 6 s de reprise si le plafond de cadence
    // du fournisseur est atteint. 18 s laisse de la marge au modele sans faire
    // tomber la fonction : 4 + 6 + 18 = 28.
    timeoutMs: 18000,
  }).catch(() => null);

  if (!result || !result.reponse) {
    return { ok: true, grounded: false, reason: 'echec', question: cleanQuestion };
  }

  const answer = normalizeAnswer(result);
  if (!answer.reponse) return { ok: true, grounded: false, reason: 'echec', question: cleanQuestion };
  // Le jour vise est une DATE : elle ne se devine pas. Une date absente du radar
  // enverrait le gerant preparer un post pour un jour dont l'agent ne sait rien.
  // Elle tombe, la reponse reste.
  if (answer.jourVise && !dossier.radar14j.some((day) => day.date === answer.jourVise)) answer.jourVise = '';

  const control = checkAnswerGrounding(
    [answer.titre, answer.reponse, ...answer.faits].join('\n'),
    { centerFacts, dossier },
  );
  if (control.blocked) {
    // Une reponse qui invente ne s'affiche pas et ne se rattrape pas : le
    // navigateur reprend son chemin deterministe. Le motif est rendu pour que
    // le refus soit observable, jamais silencieux.
    return { ok: true, grounded: false, reason: 'bloque', blockers: control.reasons, question: cleanQuestion };
  }

  return {
    ok: true,
    grounded: true,
    question: cleanQuestion,
    answer,
    provider: result._provider || '',
    model: result._model || '',
    // Ce que la reponse a eu sous les yeux : le gerant voit d'ou ca sort.
    basis: {
      joursMesures: dossier.joursMesures,
      joursRadar: dossier.radar14j.length,
      formules: dossier.formules.length,
      activites: dossier.centre.activitesDisponibles.length,
      concurrents: dossier.veille.concurrentsSurveilles,
    },
  };
}

module.exports = {
  answerMarketingQuestion,
  // Purs / testables
  buildAskDossier,
  checkAnswerGrounding,
  normalizeAnswer,
  askSystemPrompt,
  ASK_SCHEMA,
};

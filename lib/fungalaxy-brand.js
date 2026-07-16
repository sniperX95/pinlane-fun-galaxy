'use strict';

// ADN de marque Fun Galaxy.
//
// Source: contenu réel du site fungalaxy.be (accueil, activités, formules,
// evenements) capturé le 2026-07. Cette base structure la "verite de marque"
// (ton, activités, occasions, audiences, preuves) pour que le moteur de
// campagnes produise du contenu vraiment à l'ADN plutôt que des templates
// génériques. Elle nourrit aussi bien le chemin déterministe que le chemin IA
// (même systeme de faits riches injecté dans le prompt OpenAI).
//
// Règle non-négociable: on ne promet jamais une activité absente du centre ni
// une disponibilité/session garantie. Le compositeur filtre toujours les
// activités par la disponibilité reelle du centre (activityAvailability).

const FUN_GALAXY_BRAND = {
  identity: {
    name: 'Fun Galaxy',
    tagline: "Du fun et une galaxie d'émotions",
    taglineDisplay: "Du fun et une galaxie d'émotions",
    mission:
      "Réunir familles, groupes et équipes autour d'une galaxie d'activités indoor, dans une ambiance néon et blacklight où tout le monde repart avec le sourire.",
    voice: {
      person: 'tutoiement chaleureux',
      energy: 'énergique, positif, complice',
      registers: ['accessible', 'concret', 'sans jargon', 'jamais corporate froid'],
      avoid: ['promesses floues', 'superlatifs vides', 'garanties de disponibilité', 'ton administratif'],
    },
    signatureWords: [
      'fun',
      'galaxie',
      'émotions',
      'ambiance néon',
      'blacklight',
      'ensemble',
      'sans prise de tête',
      'tout au même endroit',
    ],
    differentiators: [
      'Ambiances néon et blacklight fluorescentes',
      'Une galaxie d\'activités sous un même toit',
      'Réalité virtuelle et Karting VR immersifs',
      'Formules clé en main de l\'anniversaire au teambuilding',
    ],
  },

  proof: {
    rating: 4.8,
    ratingLabel: '4.8/5',
    ratingSentence: 'note moyenne de 4.8/5 côté clients',
    trustPoints: [
      'Activités réelles vérifiées, jamais inventees',
      'Formules clé en main, table et boissons comprises',
      'Une équipe qui gère le rythme du groupe',
    ],
  },

  // Nom marketing + accroche reelle + bénéfices par activité. Les ids
  // correspondent à ops-knowledge (activityAvailability).
  activities: {
    bowling: {
      name: 'Bowling',
      hook: "Plongez dans l'excitation du bowling",
      vibe: 'convivial et fédérateur',
      benefits: ["jusqu'à 6 joueurs par piste", 'idéal pour lancer un groupe', 'accessible à tout âge'],
    },
    laser_game: {
      name: 'Laser Game',
      hook: 'Serez-vous a la hauteur ?',
      vibe: 'adrenaline et cohesion',
      benefits: ['équipes qui se dépassent', 'briefing rapide', 'le grand favori des groupes'],
    },
    minigolf_blacklight: {
      name: 'Minigolf Blacklight',
      hook: '12 trous dans une ambiance blacklight fluorescente',
      vibe: 'immersif et photogénique',
      benefits: ['parcours 12 trous', 'ambiance fluo unique', 'rythme détendu'],
    },
    golf_oclock: {
      name: "Golf o'Clock",
      hook: '12 trous dans une ambiance néonisée',
      vibe: 'nouveauté néon',
      benefits: ['parcours 12 trous', 'ambiance néon', 'parfait en complement'],
      isNew: true,
    },
    arcade_time: {
      name: 'Arcades',
      hook: "Des jeux d'arcades pour petits et grands",
      vibe: 'nostalgie et fun libre',
      benefits: ['plaisir immédiat', 'entre deux activités', 'de 7 à 77 ans'],
    },
    playground: {
      name: 'Playground',
      hook: 'Un espace de jeu pour les plus jeunes',
      vibe: 'liberté pour les enfants',
      benefits: ['accès illimité en formule', 'les enfants se défoulent', 'parents tranquilles'],
    },
    duckpin_bowling: {
      name: 'Duckpin Bowling',
      hook: 'Un bowling en plus petit et plus fun',
      vibe: 'ludique et original',
      benefits: ['format court et rigolo', 'parfait pour les enfants', 'nouveauté qui surprend'],
    },
    billards: {
      name: 'Billards',
      hook: '6 billards pour une ambiance lounge',
      vibe: 'lounge et détente',
      benefits: ['6 tables', 'ambiance posee', 'entre amis ou collègues'],
    },
    fun_run: {
      name: 'Fun Run by PIXEL',
      hook: 'Redécouvrez le plaisir du jeu vidéo sous sa forme la plus authentique',
      vibe: 'retro-gaming immersif',
      benefits: ['expérience originale', 'nostalgie assumée', 'à tester au moins une fois'],
    },
    darts: {
      name: 'Lancer de fléchettes',
      hook: 'Maîtrisez cet art ancestral',
      vibe: 'précision et challenge',
      benefits: ['duel amical', 'format court', 'bonne ambiance'],
    },
    axe_throwing: {
      name: 'Lancer de hache',
      hook: 'Maîtrisez cet art ancestral',
      vibe: 'défoulement encadré',
      benefits: ['sensation forte encadrée', 'le hit des teambuildings', 'briefing sécurité'],
    },
    free_roaming_vr: {
      name: 'Free Roaming VR',
      hook: 'Des jeux ultra-immersifs',
      vibe: 'immersion totale',
      benefits: ['déplacement libre en VR', 'effet whaou immédiat', 'moderne'],
    },
    karting_vr: {
      name: 'Karting VR',
      hook: 'Mario Kart... mais en vrai !',
      vibe: 'course fun et adrenaline',
      benefits: ['course immersive', 'fun immédiat', 'compétition amicale'],
    },
  },

  audiences: {
    particulier: { id: 'particulier', label: 'Familles et particuliers', address: 'tu' },
    entreprise: { id: 'entreprise', label: 'Entreprises', address: 'vous' },
    ecole: { id: 'ecole', label: 'Écoles et clubs', address: 'vous' },
    public: { id: 'public', label: 'Grand public', address: 'tu' },
  },

  // Occasions = cœur stratégique. Chaque occasion porte son angle, ses
  // bénéfices, sa preuve, son CTA type, son urgence honnete, ses créneaux
  // reels et ses accroches saisonnieres. objectiveAliases relie les anciens
  // objectifs (formules, laser, groupes, calme...) a une occasion.
  occasions: {
    anniversaire_enfant: {
      id: 'anniversaire_enfant',
      label: 'Anniversaire enfant',
      audience: 'particulier',
      resonanceWord: 'anniversaire',
      angle: "L'anniversaire clé en main où les enfants repartent avec des étoiles plein les yeux et les parents zéro stress.",
      promise: 'Activités, table réservée, boissons, cadeau du fêté et pop-corn: tout est prévu.',
      benefits: [
        'Formule des 6 enfants avec table réservée',
        'Bowling, Laser Game et Arcades enchaînés sans temps mort',
        'Cadeau pour le fêté et cruches de boissons comprises',
        "L'équipe gère le rythme, les parents profitent",
      ],
      emotionalHook: 'des étoiles plein les yeux',
      cta: {
        particulier: 'Demandez votre date anniversaire, on bloque le meilleur creneau',
        default: 'Demandez votre date anniversaire',
      },
      urgency: 'Les créneaux du mercredi et du samedi partent vite',
      activitiesFocus: ['bowling', 'laser_game', 'arcade_time', 'playground'],
      objectiveAliases: ['anniversaires', 'anniversaire', 'fidelisation', 'fidel', 'fidele'],
      bestSlots: ['Mercredi 11h-16h', 'Samedi 10h-14h'],
    },
    anniversaire_ado: {
      id: 'anniversaire_ado',
      label: 'Anniversaire ado / 12+',
      audience: 'particulier',
      resonanceWord: 'anniversaire',
      angle: "L'anniversaire qui impressionne les ados: Laser Game, Karting VR et Free Roaming VR pour un max de sensations.",
      promise: 'Un enchainement d\'activités immersives, boissons et cadeaux inclus.',
      benefits: [
        'Formule des 12 ans, pensee pour les grands',
        'Laser Game, Karting VR et VR immersive',
        'Ambiance néon qui fait la difference',
        'Boissons, cadeaux et pop-corn compris',
      ],
      emotionalHook: 'le souvenir dont ils vont parler a toute la classe',
      cta: {
        particulier: 'Demandez une dispo pour l\'anniversaire de ton ado',
        default: 'Demandez votre disponibilité',
      },
      urgency: 'Les weekends se remplissent tot',
      activitiesFocus: ['laser_game', 'karting_vr', 'free_roaming_vr', 'arcade_time'],
      objectiveAliases: ['ados', 'ado', 'jeunes'],
      bestSlots: ['Vendredi soir', 'Samedi après-midi'],
    },
    evjf_evg: {
      id: 'evjf_evg',
      label: 'EVJF / EVG',
      audience: 'particulier',
      resonanceWord: 'groupe',
      angle: "L'enterrement de vie de celibataire qui met tout le groupe d'accord: du fun, des defis et une ambiance qui lance la soirée.",
      promise: 'Un programme d\'activités qui cree l\'ambiance avant la suite de la soirée.',
      benefits: [
        'Defis en équipe qui soudent le groupe',
        'Laser Game, Karting VR et lancer de hache',
        'Aucun temps mort, que du fun',
        'On adapte la formule a votre groupe',
      ],
      emotionalHook: 'le point de départ parfait de la soirée',
      cta: {
        particulier: 'Demandez une dispo pour votre EVJF ou EVG',
        default: 'Demandez votre disponibilité',
      },
      urgency: 'Les samedis de la saison mariages partent en premier',
      activitiesFocus: ['laser_game', 'karting_vr', 'axe_throwing', 'bowling'],
      objectiveAliases: ['evjf', 'evg', 'enterrement'],
      bestSlots: ['Vendredi soir', 'Samedi'],
    },
    teambuilding: {
      id: 'teambuilding',
      label: 'Teambuilding entreprise',
      audience: 'entreprise',
      resonanceWord: 'équipe',
      angle: "Un teambuilding qui ne devient pas un mini-projet interne: une équipe, un creneau, une galaxie d'activités au même endroit.",
      promise: 'Formule sur mesure pensee pour souder l\'équipe sans logistique compliquee.',
      benefits: [
        'Tout au même endroit, zéro dispersion',
        'Laser Game et lancer de hache, favoris des équipes',
        'Formats courts qui rythment la journée',
        'Une équipe Fun Galaxy qui cadre le planning',
      ],
      emotionalHook: 'une équipe qui rentre soudée',
      cta: {
        entreprise: 'Contactez-nous pour caler votre teambuilding',
        default: 'Demandez votre disponibilité teambuilding',
      },
      urgency: 'Le Q4 (octobre a decembre) se reserve tot côté entreprises',
      activitiesFocus: ['laser_game', 'axe_throwing', 'bowling', 'billards'],
      objectiveAliases: ['groupes', 'groupe', 'entreprise', 'teambuilding', 'corporate'],
      bestSlots: ['En semaine', 'Fin de journée'],
    },
    family_day: {
      id: 'family_day',
      label: 'Family Day',
      audience: 'entreprise',
      resonanceWord: 'famille',
      angle: "Le Family Day ou collègues et familles se retrouvent autour d'activités pour tous les ages, petits et grands.",
      promise: 'Une journée ou chacun trouve son activité, des enfants aux grands-parents.',
      benefits: [
        'Activités pour tous les ages au même endroit',
        'Bowling, Arcades, Playground et Minigolf blacklight',
        'Ambiance conviviale et securisante',
        'Organisation clé en main',
      ],
      emotionalHook: 'une journée ou tout le monde trouve sa place',
      cta: {
        entreprise: 'Contactez-nous pour organiser votre Family Day',
        default: 'Demandez votre disponibilité',
      },
      urgency: 'Les dimanches de printemps et d\'ete sont demandes',
      activitiesFocus: ['bowling', 'arcade_time', 'playground', 'minigolf_blacklight'],
      objectiveAliases: ['familydayfamille', 'familyday', 'family'],
      bestSlots: ['Dimanche', 'Jour ferie'],
    },
    journee_scolaire: {
      id: 'journee_scolaire',
      label: 'Journee scolaire',
      audience: 'ecole',
      resonanceWord: 'ecole',
      angle: "La sortie scolaire encadrée et simple a organiser: un cadre clair pour l'ecole ou le club, du fun pour les élèves.",
      promise: 'Un planning propre et un encadrement adapte aux groupes scolaires.',
      benefits: [
        'Cadre clair pour l\'ecole ou le club',
        'Activités variees qui occupent tout le groupe',
        'Bowling, Laser Game et Minigolf blacklight',
        'Formules groupe adaptees',
      ],
      emotionalHook: 'une sortie dont les élèves reparlent',
      cta: {
        ecole: 'Contactez-nous pour caler votre journée scolaire',
        default: 'Demandez votre disponibilité groupe',
      },
      urgency: 'La rentree et la fin d\'annee scolaire sont les periodes fortes',
      activitiesFocus: ['bowling', 'laser_game', 'minigolf_blacklight', 'arcade_time'],
      objectiveAliases: ['ecole', 'scolaire', 'club', 'journee_scolaire'],
      bestSlots: ['En semaine, journée'],
    },
    sortie_amis: {
      id: 'sortie_amis',
      label: 'Sortie entre amis',
      audience: 'public',
      resonanceWord: 'amis',
      angle: "La sortie entre amis sans se prendre la tete: on arrive, on enchaine les activités, on repart avec des fous rires.",
      promise: 'Des formules duo et trio pour tester plusieurs activités a bon prix.',
      benefits: [
        'Formules duo et trio pour varier les plaisirs',
        'Laser Game, Karting VR et Free Roaming VR',
        'Ambiance néon et blacklight',
        'Parfait pour une soirée improvisee',
      ],
      emotionalHook: 'des vrais fous rires, pas des promesses',
      cta: {
        public: 'Demande une dispo et ramene ta bande',
        default: 'Demandez votre disponibilité',
      },
      urgency: 'Le jeudi Happy Laser et le vendredi soir sont les moments forts',
      activitiesFocus: ['laser_game', 'karting_vr', 'free_roaming_vr', 'bowling'],
      objectiveAliases: ['laser', 'amis', 'sortie', 'sortie_amis'],
      bestSlots: ['Jeudi soir', 'Vendredi soir'],
    },
    creneau_calme: {
      id: 'creneau_calme',
      label: 'Creneau calme',
      audience: 'public',
      resonanceWord: 'famille',
      angle: "Les créneaux plus calmes de la semaine: plus d'espace, moins d'attente, l'idéal pour profiter tranquillement en famille.",
      promise: 'Un moment plus fluide pour decouvrir les activités a son rythme.',
      benefits: [
        'Moins de monde, plus d\'espace',
        'Ideal pour les familles et les jeunes enfants',
        'Activités accessibles a son rythme',
        'Formules jour malin avantageuses',
      ],
      emotionalHook: 'le plaisir sans la foule',
      cta: {
        public: 'Demande une dispo sur un creneau calme',
        default: 'Demandez votre disponibilité',
      },
      urgency: 'Les créneaux en journée de semaine sont les plus tranquilles',
      activitiesFocus: ['bowling', 'minigolf_blacklight', 'arcade_time', 'playground'],
      objectiveAliases: ['calme', 'creux', 'remplissage'],
      bestSlots: ['Mardi a jeudi en journée'],
    },
    formules_decouverte: {
      id: 'formules_decouverte',
      label: 'Formules a la une',
      audience: 'public',
      resonanceWord: 'groupe',
      angle: "Les formules Fun Galaxy qui combinent les activités qui comptent: plusieurs experiences en une seule sortie, a prix malin.",
      promise: 'Des combinaisons duo, trio et anniversaire pour vivre plusieurs activités d\'un coup.',
      benefits: [
        'Formules duo, trio et anniversaire',
        'Plusieurs activités combinees a prix malin',
        'De Duckpin a Laser Game et VR',
        'Une formule pour chaque envie et chaque budget',
      ],
      emotionalHook: 'le meilleur du centre en une sortie',
      cta: {
        public: 'Demande ta formule et on te trouve la dispo',
        default: 'Demandez la formule adaptee a votre groupe',
      },
      urgency: 'Les formules du weekend sont les plus demandees',
      activitiesFocus: ['bowling', 'laser_game', 'duckpin_bowling', 'arcade_time'],
      objectiveAliases: ['formules', 'formule', 'packages', 'offres'],
      bestSlots: ['Weekend', 'Vacances scolaires'],
    },
  },

  channels: {
    email: { id: 'email', label: 'Email', maxChars: 900, needsSubject: true, style: 'humain, direct, une personne du centre' },
    sms: { id: 'sms', label: 'SMS', maxChars: 160, needsSubject: false, style: 'court, une offre, une action' },
    facebook: { id: 'facebook', label: 'Facebook', maxChars: 500, needsSubject: false, style: 'local, chaleureux, partageable' },
    instagram: { id: 'instagram', label: 'Instagram', maxChars: 550, needsSubject: false, style: 'visuel, legende + brief tournage' },
    tiktok: { id: 'tiktok', label: 'TikTok', maxChars: 650, needsSubject: false, style: 'script scene par scene, hook rapide' },
    linkedin: { id: 'linkedin', label: 'LinkedIn', maxChars: 700, needsSubject: false, style: 'B2B credible, oriente équipe/ecole/entreprise' },
    promo: { id: 'promo', label: 'Promo', maxChars: 300, needsSubject: false, style: 'offre claire, urgence honnete' },
  },

  // Rythmes editoriaux réels (issus des formules et jours forts du site).
  editorialRhythms: [
    { day: 'Mercredi', occasion: 'anniversaire_enfant', channels: ['facebook', 'email'], reason: 'Fun Party 11h-16h et Kids Fun Day' },
    { day: 'Jeudi', occasion: 'sortie_amis', channels: ['instagram', 'sms', 'promo'], reason: 'Happy Laser and Game du jeudi' },
    { day: 'Vendredi', occasion: 'anniversaire_ado', channels: ['instagram', 'tiktok'], reason: 'Fun Friday Madness, public jeune' },
    { day: 'Samedi', occasion: 'anniversaire_enfant', channels: ['instagram', 'facebook'], reason: 'Fun Party 10h-14h, familles' },
    { day: 'Weekend', occasion: 'evjf_evg', channels: ['instagram', 'facebook'], reason: 'Saison EVJF/EVG et groupes' },
    { day: 'Dimanche', occasion: 'family_day', channels: ['facebook', 'email'], reason: 'Journee familiale' },
  ],

  // Accroches saisonnières (Belgique). months = mois 1-12.
  seasonal: [
    { key: 'hiver', months: [1, 2], hook: 'Apres les fetes, on se retrouve au chaud en indoor', focus: ['creneau_calme', 'sortie_amis'] },
    { key: 'paques', months: [3, 4], hook: 'Vacances de Paques: le moment des anniversaires et des familles', focus: ['anniversaire_enfant', 'family_day'] },
    { key: 'mariages', months: [5, 6], hook: 'Saison des mariages et des fins d\'annee scolaire', focus: ['evjf_evg', 'journee_scolaire'] },
    { key: 'ete', months: [7, 8], hook: 'Grandes vacances et jours de pluie: le repli indoor idéal', focus: ['family_day', 'anniversaire_enfant'] },
    { key: 'rentree', months: [9], hook: 'Rentree: Back to Work et sorties scolaires', focus: ['teambuilding', 'journee_scolaire'] },
    { key: 'halloween', months: [10], hook: 'Ambiance néon et blacklight parfaite pour la saison', focus: ['sortie_amis', 'teambuilding'] },
    { key: 'fetes', months: [11, 12], hook: 'Fetes de fin d\'annee: teambuildings et sorties entre amis', focus: ['teambuilding', 'sortie_amis'] },
  ],
};

const OCCASION_INDEX = buildOccasionIndex();

function buildOccasionIndex() {
  const index = new Map();
  for (const [id, occasion] of Object.entries(FUN_GALAXY_BRAND.occasions)) {
    index.set(id, occasion);
    for (const alias of occasion.objectiveAliases || []) {
      index.set(String(alias).toLowerCase(), occasion);
    }
  }
  return index;
}

function stripAccents(value) {
  return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function getBrand() {
  return FUN_GALAXY_BRAND;
}

function listOccasions() {
  return Object.values(FUN_GALAXY_BRAND.occasions);
}

function getActivityBrand(activityId) {
  return FUN_GALAXY_BRAND.activities[activityId] || null;
}

// Résout un objectif libre ("formules", "laser", "anniversaires"...) ou un id
// d'occasion vers une occasion structurée. Fallback: formules_decouverte.
function resolveOccasion(objectiveOrId = '') {
  const key = stripAccents(String(objectiveOrId)).toLowerCase().trim();
  if (OCCASION_INDEX.has(key)) return OCCASION_INDEX.get(key);
  for (const [alias, occasion] of OCCASION_INDEX.entries()) {
    if (key && (key.includes(alias) || alias.includes(key))) return occasion;
  }
  return FUN_GALAXY_BRAND.occasions.formules_decouverte;
}

function getChannelSpec(channel) {
  return FUN_GALAXY_BRAND.channels[channel] || FUN_GALAXY_BRAND.channels.facebook;
}

function pickSeasonalHook(date = new Date()) {
  const month = date.getMonth() + 1;
  return FUN_GALAXY_BRAND.seasonal.find((season) => season.months.includes(month)) || FUN_GALAXY_BRAND.seasonal[0];
}

// Liste les activités de l'occasion reellement disponibles dans le centre,
// avec leur nom marketing. Filtre par activityAvailability => jamais d'activité
// inventee. Fallback: activités déjà resolues dans les facts du centre.
function focusActivityNames(occasion, facts = {}) {
  const availability = facts.activityAvailability || {};
  const ids = (occasion.activitiesFocus || []).filter((id) => availability[id]);
  const names = ids
    .map((id) => (FUN_GALAXY_BRAND.activities[id] ? FUN_GALAXY_BRAND.activities[id].name : null))
    .filter(Boolean);
  if (names.length) return names;
  const fallback = Array.isArray(facts.activities) ? facts.activities : [];
  return fallback.slice(0, 4);
}

function proofLine(facts = {}, signals = {}) {
  const reservationCount = Number(signals.reservationCount) || 0;
  const players = Number(signals.players) || 0;
  const base = reservationCount > 0
    ? `${reservationCount} reservation(s) et ${players} joueur(s) sur la periode`
    : `${facts.laneCount || 8} pistes de bowling et ${facts.weaponCount || 30} équipements Laser Game`;
  return `${base}, et une ${FUN_GALAXY_BRAND.proof.ratingSentence}`;
}

function ctaFor(occasion, audience) {
  const map = occasion.cta || {};
  return map[audience] || map.default || 'Demandez votre disponibilité et on cale le meilleur creneau';
}

function laserNote(occasion, facts = {}) {
  if (!(occasion.activitiesFocus || []).includes('laser_game')) return '';
  if (!(facts.activityAvailability || {}).laser_game) return '';
  return facts.requiresCompleteLaserGroup
    ? 'Laser Game organisé selon l\'affluence: le groupe arrive complet pour garder le planning fluide.'
    : 'Laser Game organisé selon l\'affluence du moment.';
}

// Compositeur central: produit un contenu riche et structure par
// occasion x canal, à l'ADN Fun Galaxy, en gardant les marqueurs de qualité
// attendus par le scoring (ville, hook, brief tournage, CTA, preuve chiffree).
function composeChannelDraft({
  channel = 'facebook',
  facts = {},
  signals = {},
  occasion = FUN_GALAXY_BRAND.occasions.formules_decouverte,
  audience = occasion.audience || 'public',
  brief = '',
} = {}) {
  const city = facts.city || facts.centerName || 'Fun Galaxy';
  const centerName = facts.centerName || `Fun Galaxy ${city}`;
  const activityNames = focusActivityNames(occasion, facts);
  const activityLine = activityNames.slice(0, 4).join(', ');
  const proof = proofLine(facts, signals);
  const cta = ctaFor(occasion, audience);
  const laser = laserNote(occasion, facts);
  const briefLine = String(brief || '').trim() ? `Angle demande: ${String(brief).trim()}` : '';
  const tagline = FUN_GALAXY_BRAND.identity.tagline;
  const benefits = (occasion.benefits || []).slice(0, 4);
  const keywords = [
    occasion.resonanceWord,
    ...activityNames.slice(0, 3).map((name) => stripAccents(name).toLowerCase()),
    'fun galaxy',
    stripAccents(city).toLowerCase(),
  ].filter(Boolean);

  let title = `${occasion.label} - ${centerName}`;
  let bodyLines = [];

  if (channel === 'email') {
    title = `Email ${occasion.label} - ${centerName}`;
    bodyLines = [
      `Objet: ${occasion.label} chez Fun Galaxy ${city} - ${tagline}`,
      '',
      'Bonjour,',
      '',
      occasion.angle,
      '',
      `Sur place a ${city}: ${activityLine}.`,
      `Ce qui est prévu : ${occasion.promise}`,
      `Cote terrain: ${proof}.`,
      laser,
      briefLine,
      '',
      cta + '.',
      '',
      `A très vite,`,
      `L'équipe Fun Galaxy ${city}`,
    ];
  } else if (channel === 'sms') {
    title = `SMS ${occasion.label} - ${centerName}`;
    bodyLines = [
      `Fun Galaxy ${city}: ${occasion.emotionalHook}.`,
      `${activityNames.slice(0, 2).join(' + ')} - note 4.8/5.`,
      `${cta}.`,
    ];
  } else if (channel === 'promo') {
    title = `Promo ${occasion.label} - ${centerName}`;
    bodyLines = [
      `${occasion.label} a ${city} - ${tagline}.`,
      `${activityLine}.`,
      occasion.urgency ? `${occasion.urgency}.` : '',
      `Note 4.8/5. ${cta}.`,
    ];
  } else if (channel === 'instagram') {
    title = `Legende Instagram ${occasion.label} - ${centerName}`;
    bodyLines = [
      `${occasion.emotionalHook} a ${city}.`,
      '',
      `${occasion.angle}`,
      `Au programme: ${activityLine}.`,
      '',
      `A filmer: arrivee du groupe, ${activityNames[0] || 'activité'}, moment fort, sourire final.`,
      `Preuve: ${proof}.`,
      laser,
      briefLine,
      '',
      `${cta}.`,
    ];
  } else if (channel === 'tiktok') {
    title = `Script TikTok ${occasion.label} - ${centerName}`;
    bodyLines = [
      `Hook: "${occasion.angle}"`,
      `Plan 1: entree du centre + texte "${city}".`,
      `Plan 2: ${activityNames[0] || 'activité'} en action.`,
      `Plan 3: ${activityNames[1] || activityNames[0] || 'activité'}, énergie du groupe.`,
      `Plan 4: ${occasion.emotionalHook}, le groupe repart content.`,
      `Voix off: ${occasion.promise} Note 4.8/5.`,
      laser ? `Note staff: ${laser}` : 'Note staff: parler de disponibilité, jamais de garantie.',
      briefLine,
    ];
  } else if (channel === 'linkedin') {
    // Toujours cadre B2B: équipe / ecole / entreprise / club.
    const b2bWord = audience === 'ecole' ? 'ecole ou club' : 'équipe ou entreprise';
    title = `Post LinkedIn ${occasion.label} - ${centerName}`;
    bodyLines = [
      `Organiser une sortie d'équipe ne devrait pas devenir un mini-projet interne.`,
      '',
      `${occasion.angle}`,
      `Pour une ${b2bWord}, tout est au même endroit a ${city}: ${activityLine}.`,
      '',
      `Ce qui compte: ${occasion.promise}`,
      `Cote terrain: ${proof}.`,
      laser,
      briefLine,
      '',
      `${cta}.`,
    ];
  } else {
    // facebook (defaut)
    title = `Publication Facebook ${occasion.label} - ${centerName}`;
    bodyLines = [
      `${occasion.angle}`,
      '',
      `A ${city}, profite de: ${activityLine}.`,
      `Ce qui est prévu : ${occasion.promise}`,
      `Info pratique: ${proof}.`,
      laser,
      occasion.urgency ? `${occasion.urgency}.` : '',
      briefLine,
      '',
      `${cta}.`,
    ];
  }

  const body = bodyLines
    .map((line) => (line === undefined || line === null ? '' : String(line)))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return {
    channel,
    occasion: occasion.id,
    occasionLabel: occasion.label,
    audience,
    title,
    hook: occasion.emotionalHook,
    angle: occasion.angle,
    body,
    benefits,
    proof,
    cta,
    urgency: occasion.urgency || '',
    seasonalHook: pickSeasonalHook().hook,
    keywords: [...new Set(keywords)].slice(0, 8),
  };
}

module.exports = {
  FUN_GALAXY_BRAND,
  getBrand,
  listOccasions,
  getActivityBrand,
  resolveOccasion,
  getChannelSpec,
  pickSeasonalHook,
  focusActivityNames,
  composeChannelDraft,
};

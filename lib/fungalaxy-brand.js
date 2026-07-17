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
      // Vouvoiement par defaut : c'est le parent qui reserve. Le tutoiement est
      // reserve a l'audience ado (voir audiences.ado). Doit rester aligne sur
      // lib/copy-playbook.js, sinon gabarit et IA se contredisent.
      person: 'vouvoiement chaleureux, tutoiement uniquement pour les ados',
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
      'Des univers thématisés par centre (Laser Game et Minigolf blacklight)',
      'Formules clé en main de l\'anniversaire au teambuilding',
    ],
  },

  // PREUVE. La note Google 4,8/5 (418 avis) est celle de GEMBLOUX uniquement
  // (widget du site, alt « Fun Galaxy - Gembloux »). Libramont n'a AUCUNE note
  // publiée. Une note ne peut donc JAMAIS sortir d'ici : elle vient du centre
  // courant (ops-knowledge/centers.json, publicProof) ou elle ne sort pas.
  // Seules les preuves ci-dessous valent pour les deux centres.
  proof: {
    group: {
      team: 12,
      activitiesOrganised: 112817,
      clientsPerDay: 150,
      source: 'fungalaxy.be/contact, chiffres du groupe (les deux centres)',
    },
    trustPoints: [
      'Activités réelles vérifiées, jamais inventées',
      'Formules clé en main, cruches de boissons comprises',
      'Une équipe qui gère le rythme du groupe',
    ],
  },

  // Nom marketing + accroche reelle + bénéfices par activité. Les ids
  // correspondent à ops-knowledge (activityAvailability).
  activities: {
    bowling: {
      name: 'Bowling',
      // « Plongez dans » est une formule bannie par le playbook : un hook
      // concret et chiffre bat un superlatif.
      hook: '8 pistes, 6 joueurs par piste, zero temps mort',
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
    // ACTIVITES SUPPRIMEES le 2026-07-16 : darts, axe_throwing,
    // free_roaming_vr, karting_vr.
    // Fun Galaxy ne les propose dans AUCUN des deux centres (absentes des deux
    // formulaires de reservation et des pages du site). Elles vivaient ici avec
    // un nom, un hook et des benefices prets a l'emploi, et un post de prod du
    // 15/07 a fini par promettre « Laser Game, Karting VR, Free Roaming VR ».
    // Un catalogue qui decrit ce qu'on ne vend pas est un piege arme : la
    // disponibilite ne le desamorce que tant que personne ne se trompe de cle.
    // Si une de ces activites ouvre un jour, on la remet ici ET dans
    // ops-knowledge/centers.json.
  },

  // L'adresse doit etre IDENTIQUE a celle du playbook injecte dans les prompts
  // IA (lib/copy-playbook.js), sinon les deux chemins de generation (gabarit de
  // repli et modele) ne parlent pas la meme langue : c'est ce qui se voyait en
  // prod, ou le gabarit tutoyait pendant que le prompt imposait le vouvoiement.
  //
  // VOUS par defaut : le sample reel des posts FR du secteur qui performent
  // vouvoie, parce que c'est le parent qui reserve, pas l'enfant qui joue.
  // TU seulement quand l'audience est explicitement ado / jeune adulte.
  audiences: {
    particulier: { id: 'particulier', label: 'Familles et particuliers', address: 'vous' },
    entreprise: { id: 'entreprise', label: 'Entreprises', address: 'vous' },
    ecole: { id: 'ecole', label: 'Écoles et clubs', address: 'vous' },
    public: { id: 'public', label: 'Grand public', address: 'vous' },
    ado: { id: 'ado', label: 'Ados et jeunes adultes', address: 'tu' },
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
      promise: 'Les activités enchaînées et les cruches de boissons comprises : tout est prévu.',
      benefits: [
        'À partir de 6 personnes, hors vacances scolaires et jours fériés',
        'Bowling, Laser Game et Arcades enchaînés sans temps mort',
        'Cruches de boissons comprises dans chaque formule',
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
      bestSlots: ['Mercredi 12h-17h', 'Samedi 10h-14h'],
    },
    anniversaire_ado: {
      id: 'anniversaire_ado',
      label: 'Anniversaire ado / 12+',
      audience: 'particulier',
      resonanceWord: 'anniversaire',
      angle: "L'anniversaire qui impressionne les ados : Laser Game en équipes, minigolf blacklight et arcades, sans temps mort.",
      promise: 'Un enchaînement d\'activités, avec les cruches de boissons comprises.',
      benefits: [
        'À partir de 6 personnes, hors vacances scolaires',
        'Laser Game en équipes, 20 minutes par partie',
        'Ambiance néon et blacklight qui fait la différence',
        'Cruches de boissons comprises dans la formule',
      ],
      emotionalHook: 'le souvenir dont ils vont parler à toute la classe',
      cta: {
        particulier: 'Demandez une dispo pour l\'anniversaire de votre ado',
        default: 'Demandez votre disponibilité',
      },
      urgency: 'Les week-ends se remplissent tôt',
      activitiesFocus: ['laser_game', 'minigolf_blacklight', 'arcade_time', 'bowling'],
      objectiveAliases: ['ados', 'ado', 'jeunes'],
      bestSlots: ['Vendredi soir', 'Samedi après-midi'],
    },
    evjf_evg: {
      id: 'evjf_evg',
      label: 'EVJF / EVG',
      audience: 'particulier',
      resonanceWord: 'groupe',
      angle: "L'enterrement de vie de célibataire qui met tout le groupe d'accord : du fun, des défis et une ambiance qui lance la soirée.",
      promise: 'Un programme d\'activités qui crée l\'ambiance avant la suite de la soirée.',
      benefits: [
        'Défis en équipe qui soudent le groupe',
        'Laser Game en équipes, bowling et billards',
        'Aucun temps mort, que du fun',
        'On adapte la formule à votre groupe',
      ],
      emotionalHook: 'le point de départ parfait de la soirée',
      cta: {
        particulier: 'Demandez une dispo pour votre EVJF ou EVG',
        default: 'Demandez votre disponibilité',
      },
      urgency: 'Les samedis de la saison mariages partent en premier',
      activitiesFocus: ['laser_game', 'bowling', 'billards', 'arcade_time'],
      objectiveAliases: ['evjf', 'evg', 'enterrement'],
      bestSlots: ['Vendredi soir', 'Samedi'],
    },
    teambuilding: {
      id: 'teambuilding',
      label: 'Teambuilding entreprise',
      audience: 'entreprise',
      resonanceWord: 'équipe',
      angle: "Un teambuilding qui ne devient pas un mini-projet interne : une équipe, un créneau, une galaxie d'activités au même endroit.",
      promise: 'Formule sur mesure pensée pour souder l\'équipe sans logistique compliquée.',
      benefits: [
        'Tout au même endroit, zéro dispersion',
        'Laser Game en équipes, le favori des groupes',
        'Formats courts qui rythment la journée',
        'Une équipe Fun Galaxy qui cadre le planning',
      ],
      emotionalHook: 'une équipe qui rentre soudée',
      cta: {
        entreprise: 'Contactez-nous pour caler votre teambuilding',
        default: 'Demandez votre disponibilité teambuilding',
      },
      urgency: 'Le Q4 (octobre à décembre) se réserve tôt côté entreprises',
      activitiesFocus: ['laser_game', 'bowling', 'billards', 'arcade_time'],
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
        // Karting VR et Free Roaming VR etaient cites ici : Fun Galaxy ne les
        // possede dans AUCUN des deux centres. C'est cette ligne qui a mis
        // « Laser Game, Karting VR, Free Roaming VR » dans un post de prod.
        // On ne nomme plus que des activites reelles et communes aux deux.
        'Laser Game, bowling et billards',
        'Ambiance néon et blacklight',
        'Parfait pour une soirée improvisee',
      ],
      emotionalHook: 'des vrais fous rires, pas des promesses',
      cta: {
        public: 'Demandez une dispo et venez avec votre bande',
        default: 'Demandez votre disponibilité',
      },
      urgency: 'Le jeudi Happy Laser et le vendredi soir sont les moments forts',
      activitiesFocus: ['laser_game', 'bowling', 'billards', 'arcade_time'],
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
        public: 'Demandez une dispo sur un creneau calme',
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
        'Du bowling au Laser Game, en passant par le Minigolf blacklight',
        'Une formule pour chaque envie et chaque budget',
      ],
      emotionalHook: 'le meilleur du centre en une sortie',
      cta: {
        public: 'Demandez votre formule, on vous trouve la dispo',
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
    { day: 'Mercredi', occasion: 'anniversaire_enfant', channels: ['facebook', 'email'], reason: 'Kids Fun Day, 12h-17h, 5 a 12 ans, hors vacances et feries' },
    { day: 'Jeudi', occasion: 'sortie_amis', channels: ['instagram', 'sms', 'promo'], reason: 'Happy Laser and Game du jeudi' },
    { day: 'Vendredi', occasion: 'anniversaire_ado', channels: ['instagram', 'tiktok'], reason: 'Fun Friday Madness, public jeune' },
    { day: 'Samedi', occasion: 'anniversaire_enfant', channels: ['instagram', 'facebook'], reason: 'Samedi familles, ouverture 10h' },
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

// Preuve chiffrée, TOUJOURS ancrée sur le centre courant.
// Une note Google ne sort que si CE centre la publie (facts.googleRating, venu
// de centers.json). Sinon on retombe sur les chiffres du groupe, jamais sur la
// note d'un autre centre. Aucun fallback inventé sur les capacités.
function proofLine(facts = {}, signals = {}) {
  const reservationCount = Number(signals.reservationCount) || 0;
  const players = Number(signals.players) || 0;
  const capacity = [
    facts.laneCount ? `${facts.laneCount} pistes de bowling` : '',
    facts.weaponCount ? `${facts.weaponCount} équipements Laser Game` : '',
  ].filter(Boolean).join(' et ');
  const base = reservationCount > 0
    ? `${reservationCount} réservation(s) et ${players} joueur(s) sur la période`
    : capacity;
  const rating = Number(facts.googleRating) || 0;
  if (rating > 0) {
    const reviews = Number(facts.googleReviews) || 0;
    const note = `une note de ${String(rating).replace('.', ',')}/5${reviews ? ` sur ${reviews} avis` : ''}`;
    return base ? `${base}, et ${note}` : note;
  }
  const organised = Number((FUN_GALAXY_BRAND.proof.group || {}).activitiesOrganised) || 0;
  if (organised > 0) {
    const rounded = `${Math.floor(organised / 1000)}.000`;
    const groupLine = `plus de ${rounded} activités organisées par le groupe`;
    return base ? `${base}, et ${groupLine}` : groupLine;
  }
  return base;
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

function lowerFirst(str) {
  const s = String(str == null ? '' : str);
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

// Hash deterministe (djb2 + xor) -> index de variante. Meme graine (date du
// jour + occasion + canal + angle) => meme choix, a l'octet pres : ZERO appel
// IA. L'angle recommande par le bandit (passe par le cron deterministe) apporte
// l'entropie inter-cycle ; sans lui, les 4 passages du meme jour rendraient la
// meme phrase mot-pour-mot (exactement ce que U3 casse).
function variantFrom(list, seedParts) {
  const seed = seedParts
    .filter((part) => part !== undefined && part !== null && part !== '')
    .join('|');
  let hash = 5381;
  for (let i = 0; i < seed.length; i += 1) hash = (((hash << 5) + hash) ^ seed.charCodeAt(i)) >>> 0;
  return list[hash % list.length];
}

// Cadrages d'OUVERTURE et de CLOTURE : pur ton (voix Fun Galaxy : directe,
// humaine), AUCUN fait/prix/promesse ajoute. Ils rehabillent la meme accroche
// et le meme CTA pour casser la repetition sans toucher aux garde-fous ni aux
// chiffres. La variante 0 est l'identite (formulation d'origine intacte).
const OPENING_FRAMES = [
  (line) => line,
  (line) => `Soyons clairs : ${lowerFirst(line)}`,
  (line) => `Disons-le simplement : ${lowerFirst(line)}`,
];
const CLOSING_FRAMES = [
  (call) => `${call}.`,
  (call) => `Une date en tete ? ${call}.`,
  (call) => `Le plus simple : ${lowerFirst(call)}.`,
];

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
  angle = '',
  today = new Date().toISOString().slice(0, 10),
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

  // Variantes deterministes d'ouverture / cloture (U3) : casse la repetition
  // mot-pour-mot du cron. Graine = date + occasion + canal + angle (bandit).
  const openFrame = variantFrom(OPENING_FRAMES, [today, occasion.id, channel, angle, 'open']);
  const closeFrame = variantFrom(CLOSING_FRAMES, [today, occasion.id, channel, angle, 'close']);
  const ctaLine = closeFrame(cta);

  let title = `${occasion.label} - ${centerName}`;
  let bodyLines = [];

  if (channel === 'email') {
    title = `Email ${occasion.label} - ${centerName}`;
    bodyLines = [
      `Objet: ${occasion.label} chez Fun Galaxy ${city} - ${tagline}`,
      '',
      'Bonjour,',
      '',
      openFrame(occasion.angle),
      '',
      `Sur place a ${city}: ${activityLine}.`,
      `Ce qui est prévu : ${occasion.promise}`,
      `Cote terrain: ${proof}.`,
      laser,
      briefLine,
      '',
      ctaLine,
      '',
      `A très vite,`,
      `L'équipe Fun Galaxy ${city}`,
    ];
  } else if (channel === 'sms') {
    title = `SMS ${occasion.label} - ${centerName}`;
    bodyLines = [
      `Fun Galaxy ${city}: ${occasion.emotionalHook}.`,
      `${activityNames.slice(0, 2).join(' + ')}.`,
      ctaLine,
    ];
  } else if (channel === 'promo') {
    title = `Promo ${occasion.label} - ${centerName}`;
    bodyLines = [
      `${occasion.label} a ${city} - ${tagline}.`,
      `${activityLine}.`,
      occasion.urgency ? `${occasion.urgency}.` : '',
      `${proof ? `${proof}. ` : ''}${ctaLine}`,
    ];
  } else if (channel === 'instagram') {
    title = `Legende Instagram ${occasion.label} - ${centerName}`;
    bodyLines = [
      `${openFrame(`${occasion.emotionalHook} a ${city}`)}.`,
      '',
      `${occasion.angle}`,
      `Au programme: ${activityLine}.`,
      '',
      `A filmer: arrivee du groupe, ${activityNames[0] || 'activité'}, moment fort, sourire final.`,
      `Preuve: ${proof}.`,
      laser,
      briefLine,
      '',
      ctaLine,
    ];
  } else if (channel === 'tiktok') {
    title = `Script TikTok ${occasion.label} - ${centerName}`;
    bodyLines = [
      `Hook: "${openFrame(occasion.angle)}"`,
      `Plan 1: entree du centre + texte "${city}".`,
      `Plan 2: ${activityNames[0] || 'activité'} en action.`,
      `Plan 3: ${activityNames[1] || activityNames[0] || 'activité'}, énergie du groupe.`,
      `Plan 4: ${occasion.emotionalHook}, le groupe repart content.`,
      `Voix off: ${occasion.promise}`,
      laser ? `Note staff: ${laser}` : 'Note staff: parler de disponibilité, jamais de garantie.',
      briefLine,
    ];
  } else if (channel === 'linkedin') {
    // Toujours cadre B2B: équipe / ecole / entreprise / club.
    const b2bWord = audience === 'ecole' ? 'ecole ou club' : 'équipe ou entreprise';
    title = `Post LinkedIn ${occasion.label} - ${centerName}`;
    bodyLines = [
      `${openFrame(`Organiser une sortie d'équipe ne devrait pas devenir un mini-projet interne`)}.`,
      '',
      `${occasion.angle}`,
      `Pour une ${b2bWord}, tout est au même endroit a ${city}: ${activityLine}.`,
      '',
      `Ce qui compte: ${occasion.promise}`,
      `Cote terrain: ${proof}.`,
      laser,
      briefLine,
      '',
      ctaLine,
    ];
  } else {
    // facebook (defaut)
    title = `Publication Facebook ${occasion.label} - ${centerName}`;
    bodyLines = [
      openFrame(occasion.angle),
      '',
      `A ${city}, vous avez: ${activityLine}.`,
      `Ce qui est prévu : ${occasion.promise}`,
      `Info pratique: ${proof}.`,
      laser,
      occasion.urgency ? `${occasion.urgency}.` : '',
      briefLine,
      '',
      ctaLine,
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

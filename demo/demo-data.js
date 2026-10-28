/* ==========================================================================
   LA JOURNEE FABRIQUEE DE LA DEMONSTRATION.
   ==========================================================================
   Ce fichier ne contient QUE des donnees. Aucun appel reseau, aucune lecture
   de base, aucun import de l'application : la demonstration est un objet
   autonome depuis le 2026-08-13 (decision de Movsar : « il faut que ce soit
   vraiment decorrele du vrai SaaS, c'est une demo, un truc a part »).

   TROIS REGLES QUI GOUVERNENT CE FICHIER :

   1. AUCUNE ENSEIGNE, AUCUNE VILLE, AUCUNE ENTREPRISE REELLE. Le centre
      s'appelle « Bowling Central » et il n'existe pas. Les noms de clients
      sont des familles et des groupes inventes, les adresses sont en
      `@example.be`, les numeros sont derives d'une formule. Trois fuites de
      ce type ont deja ete trouvees et fermees : elles ne reviennent pas.

   2. TOUT CHIFFRE AFFICHE SE RECOMPOSE. Les indicateurs du haut de page ne
      sont pas ecrits a la main : ils sont CALCULES a partir des reservations
      ci-dessous. Un visiteur qui compte les blocs du planning retombe sur le
      total. Un total invente qui ne se recompose pas est la premiere chose
      qui trahit une maquette.

   3. LE CREUX DE L'APRES-MIDI EST VOLONTAIRE. Une grille pleine de 10 h a
      22 h est aussi fausse qu'une grille vide : un bowling de semaine se vide
      entre le service de midi et la sortie des bureaux. Ce trou est ce que le
      gerant CHERCHE quand il ouvre son planning, et c'est exactement le fait
      sur lequel s'appuie la proposition de l'agent marketing : les deux
      ecrans parlent de la meme journee, et un visiteur peut le verifier.

   VERITE DU PRODUIT, non negociable : Pinlane N'ENCAISSE PAS et ne modelise
   aucun acompte (statut binaire paye / non paye sur le montant entier), et
   l'agent PREPARE sans jamais publier. Rien ici ne doit laisser croire le
   contraire.
   ========================================================================== */
(function (racine) {
  'use strict';

  var CENTRE = 'Bowling Central';
  var PISTES = 8;
  var OUVERTURE = 10;
  var FERMETURE = 22;
  var CREUX = [14, 16];

  var NOMS = ['Famille Dubois', 'Anniversaire Lucas', 'Team building Nexo', 'Groupe amis', 'Sarah Lemaire',
    'Ecole du Tilleul', 'Famille Martin', 'EVJF Camille', 'Club des Quilles', 'Famille Rousseau',
    'Duo Verhaegen', 'Soiree ligue', 'Famille Nowak', 'Anniversaire Lea', 'Groupe Vandenberg',
    'CE Vermeulen', 'Famille Moreau', 'Anniversaire Noah', 'Team Korrida', 'Club Athena',
    'Anniversaire Jade', 'Famille Petit', 'Amis du jeudi', 'Anniversaire Tom', 'Famille Renard',
    'Scouts de la Vallee', 'Team Voltyx', 'Famille Collin', 'Anniversaire Ines', 'Groupe Bastin'];

  // Les libelles d'activite viennent du catalogue reel du produit : bowling,
  // laser game, et des formules qui occupent une piste. Ni padel, ni escape
  // game, ni karting : ils n'existent pas dans Pinlane.
  var ACTIVITES = ['Bowling Classique', 'Bowling Classique', 'Bowling Classique',
    'FORMULE ANNIVERSAIRE', 'Bowling Classique', 'FORMULE DUO', 'Bowling Classique',
    'BACK TO SCHOOL'];

  function identifiant(nom) {
    return String(nom).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');
  }
  function identite(nom, rang) {
    // `rang + 1` : au rang 0 le numero sortait « +32 410 00 00 00 », qui se lit
    // comme un champ non rempli plutot que comme un telephone.
    var n = 10000000 + (((rang + 1) * 618033) % 89999999);
    var s = String(n);
    return {
      email: identifiant(nom) + '@example.be',
      phone: '+32 4' + s.slice(0, 2) + ' ' + s.slice(2, 4) + ' ' + s.slice(4, 6) + ' ' + s.slice(6, 8),
    };
  }

  /* Le remplissage se fait PISTE PAR PISTE : chaque piste enchaine ses sessions
     sans chevauchement. C'est ce qui garantit que le taux d'occupation calcule
     plus bas ne peut pas depasser 100 %, et le gate `test:occupancy` le
     re-verifie sur cette fonction meme. */
  function reservations() {
    var libre = [];
    var i;
    for (i = 0; i < PISTES; i += 1) libre.push(OUVERTURE);
    var sortie = [];
    NOMS.forEach(function (nom, rang) {
      var pax = 4 + (rang % 9);
      var duree = (rang % 6 === 0) ? 2 : 1;
      var nbPistes = pax > 6 ? 2 : 1;
      var ordre = libre.map(function (h, k) { return { h: h, k: k }; })
        .sort(function (a, b) { return a.h - b.h || a.k - b.k; })
        .slice(0, nbPistes);
      var debut = Math.max.apply(null, ordre.map(function (o) { return o.h; }));
      if (debut >= CREUX[0] && debut < CREUX[1] && (rang % 7) !== 3) debut = CREUX[1];
      if (debut + duree > FERMETURE) return;
      ordre.forEach(function (o) { libre[o.k] = debut + duree; });
      var identifiants = identite(nom, rang);
      sortie.push({
        id: 'demo-' + (rang + 1),
        name: nom,
        email: identifiants.email,
        phone: identifiants.phone,
        activite: ACTIVITES[rang % ACTIVITES.length],
        pax: pax,
        duration: duree,
        start: debut,
        lanes: ordre.map(function (o) { return o.k + 1; }),
        // Statut binaire, comme le produit : ni acompte, ni paiement partiel.
        statut: rang % 5 === 0 ? 'arrived' : (rang % 9 === 4 ? 'paid' : 'pending'),
        prix: 9 * pax * duree + (rang % 4) * 6,
      });
    });
    return sortie;
  }

  var DEMO = reservations();

  function heures(v) {
    var h = Math.floor(v);
    return (h < 10 ? '0' : '') + h + ':' + ((v % 1) === 0 ? '00' : '30');
  }

  /* LES INDICATEURS SE RECOMPOSENT. Chacun est la somme de ce qui est dessine
     dans la grille juste en dessous : un visiteur qui compte retombe dessus. */
  var joueurs = DEMO.reduce(function (s, r) { return s + r.pax; }, 0);
  var heuresPistes = DEMO.reduce(function (s, r) { return s + r.duration * r.lanes.length; }, 0);
  var capacite = PISTES * (FERMETURE - OUVERTURE);
  var occupation = Math.round((heuresPistes / capacite) * 100);

  /* LE BANDEAU DU PRODUIT DEPUIS LE 2026-09-30 : l'occupation des pistes et
     les reservations bowling avec leurs joueurs, le perimetre dans le
     libelle. Le chiffre d'affaires en est sorti (il vit sur l'accueil du
     produit) et aucune case ne dit plus « aujourd'hui ». « Libres
     maintenant » n'est pas repris : il se lit a l'heure, et la journee de
     demonstration n'a pas d'heure. */
  var INDICATEURS = [
    { cle: 'occupation', libelle: 'Occupation des pistes', valeur: occupation + '%', unite: 'sur la journée', fort: true },
    { cle: 'reservations', libelle: 'Réservations bowling', valeur: String(DEMO.length), unite: joueurs + ' joueurs' },
  ];

  var ONGLETS = [
    { cle: 'bowling', titre: 'Planning Bowling', sous: PISTES + ' pistes', compte: DEMO.length, actif: true },
    { cle: 'laser', titre: 'Planning Laser Game', sous: '30 armes', compte: 12 },
    { cle: 'toutes', titre: 'Planning global', sous: 'Le jour au complet', compte: DEMO.length + 12 },
  ];

  /* Les puces de la liste du produit depuis le 2026-10-27 : « Tout »,
     « À venir », « Sur place », « À clôturer », « Terminées » (les dossiers
     encaissés, « Payées » avant). La démonstration n'a ni retard ni
     clôture : elle garde les trois états qu'elle montre, dans l'ordre du
     produit. */
  var FILTRES = [
    { cle: 'all', libelle: 'Tout' },
    { cle: 'pending', libelle: 'À venir' },
    { cle: 'arrived', libelle: 'Sur place' },
    { cle: 'paid', libelle: 'Terminées' },
  ];

  /* ---- L'AGENT MARKETING ---------------------------------------------------
     Il PREPARE et il attend la validation. Le mot « publie » n'apparait sur
     aucune proposition, et sa paie se compte en venues et en chiffre reserve,
     jamais en euros encaisses : le produit n'encaisse pas.

     La premiere proposition s'appuie sur le CREUX de 14 h a 16 h, qui est
     visible sur le planning de l'autre ecran. Les deux racontent la meme
     journee, et c'est verifiable. */
  var AGENT = {
    mot: 'Deux choses ce matin. Tes après-midis de semaine restent vides entre 14 h et 16 h, alors que le soir se remplit tout seul : j’ai préparé un post qui vise ce créneau. Et 9 anniversaires fêtés ici il y a un an n’ont jamais été recontactés, j’ai écrit l’email. Les deux attendent ta validation, je ne publie rien sans toi.',
    propositions: [
      {
        ton: 'danger', type: 'Valider un post',
        titre: 'Tes après-midis de semaine sont vides entre 14 h et 16 h',
        meta: 'avant ven 14/08', note: 'jour calme',
      },
      {
        ton: 'accent', type: 'Valider un email',
        titre: '9 anniversaires fêtés ici il y a un an, aucun recontacté',
        meta: 'avant lun 17/08', note: 'ta demande',
      },
    ],
    enCours: [{ titre: 'Post créneau du midi', meta: 'verdict le 23/08' }],
    veille: [
      { titre: 'Lun 17/08 s’annonce calme', valeur: '164 pers. posées' },
      { titre: 'Mar 18/08 s’annonce très calme', valeur: '97 pers. posées' },
      { titre: 'Mer 19/08 s’annonce calme', valeur: '138 pers. posées' },
      { titre: 'Le bowling à 12 min a bougé', valeur: 'voir Marché' },
    ],
  };

  // Les quatorze prochains jours, avec le nombre de personnes deja posees.
  // Le creux de debut de semaine est coherent avec la proposition de l'agent.
  var RADAR = (function () {
    var jours = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];
    var base = new Date();
    var sortie = [];
    for (var i = 0; i < 14; i += 1) {
      var d = new Date(base.getTime() + i * 86400000);
      var jour = (d.getDay() + 6) % 7;
      var poids = [164, 97, 138, 211, 253, 294, 197][jour];
      sortie.push({
        jour: i === 0 ? 'auj' : jours[jour],
        date: d.getDate(),
        valeur: poids + (i * 7) % 23,
        niveau: poids < 120 ? 'creux' : (poids > 240 ? 'plein' : 'moyen'),
      });
    }
    return sortie;
  }());

  racine.PL_DEMO = {
    CENTRE: CENTRE, PISTES: PISTES, OUVERTURE: OUVERTURE, FERMETURE: FERMETURE,
    RESERVATIONS: DEMO, INDICATEURS: INDICATEURS, ONGLETS: ONGLETS, FILTRES: FILTRES,
    AGENT: AGENT, RADAR: RADAR, heures: heures,
  };
}(typeof window !== 'undefined' ? window : globalThis));

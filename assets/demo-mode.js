/* ==========================================================================
   MODE DEMONSTRATION PUBLIC : la VRAIE application, avec de fausses donnees.
   ==========================================================================

   Demande de Movsar (2026-07-29) : la vitrine doit montrer « notre truc reel »,
   pas une maquette qui lui ressemble. Ce fichier fait tourner l'application
   telle quelle - meme code, meme planning, memes interactions - sur un jeu de
   donnees de demonstration.

   TROIS GARANTIES, non negociables puisque cette page est PUBLIQUE :

   1. AUCUNE DONNEE REELLE NE PEUT SORTIR. Le mode n'ajoute pas un filtre au
      dessus des appels : il coupe le reseau. `fetch` et `XMLHttpRequest` sont
      remplaces, et tout ce qui vise /api/ recoit une reponse fabriquee ici.
      Meme si un ecran demandait une donnee client, la requete ne partirait
      jamais. C'est la seule facon d'etre sur : une liste blanche d'endpoints
      finit toujours par oublier celui qu'on vient d'ajouter.
   2. AUCUNE ECRITURE. Les POST recoivent un accuse de reception fabrique. Rien
      ne remonte au serveur, donc rien ne peut abimer un centre.
   3. AUCUNE ENSEIGNE DE CLIENT. Le centre s'appelle « Bowling Central », et le
      remplacement se fait AVANT le premier rendu, jamais apres coup (sur la
      pub, un nettoyage tardif laissait l'enseigne visible les 2 premieres
      secondes).

   Le mode ne s'active QUE si l'URL porte `?demo=1`. Sans ce parametre, ce
   fichier ne fait strictement rien : il ne peut pas gener la production.
   ========================================================================== */

(function () {
  'use strict';

  // Deux portes d'entree : `/demo` (URL lisible, partageable) et `?demo=1`
  // (utilisable sur n'importe quel chemin). Sans l'une des deux, ce fichier ne
  // fait STRICTEMENT rien : il ne peut pas gener la production.
  var params;
  try { params = new URLSearchParams(window.location.search); } catch (error) { return; }
  var parLeChemin = /^\/demo\/?$/.test(window.location.pathname);
  if (params.get('demo') !== '1' && !parLeChemin) return;

  var CENTRE = 'Bowling Central';
  var PAGE = params.get('page') || 'planning';
  var AUJOURD_HUI = new Date().toISOString().slice(0, 10);

  /* ---- LE MODE FILM ------------------------------------------------------
     `?loop=1` etait pose par la vitrine quand la demonstration vivait dans un
     cadre de 640 px. Ce cadre n'existe plus (la vitrine envoie desormais vers
     `/demo` en pleine page), mais le mode reste utile pour FILMER : chrome
     retire, enchainement automatique des pages. Sans ce parametre, `/demo` est
     une console complete avec sa barre laterale. */
  var FILM = params.get('loop') === '1';

  /* ==========================================================================
     ACCES A DEUX NIVEAUX : la demonstration est un APPAT, pas un libre-service.
     ==========================================================================
     Decision produit de Movsar (2026-08-13), qui remplace celle du 2026-07-29
     (« on montre le PRODUIT, pas la navigation interne », prise quand la demo
     vivait dans un cadre de 640 px).

     Le probleme de l'ancienne version : la barre laterale etait ETEINTE, donc
     un prospect qui cliquait « Entrer dans l'outil » voyait UN ecran sur onze
     et repartait en croyant que le produit tenait sur un planning.

     Le probleme de l'inverse (tout ouvrir) : plus personne n'a de raison de
     demander l'appel, et un ecran de reglages rempli de donnees inventees ne
     prouve rien - un tarif fabrique ne ressemble jamais aux tarifs du visiteur.

     LA REGLE : deux ecrans OUVERTS, les neuf autres VISIBLES ET HORS DE
     PORTEE. L'entree de menu existe, elle se clique, elle mene a une
     INVITATION qui nomme precisement ce que la section contient et pourquoi
     elle s'ouvre pendant l'appel. Rien n'est cache, rien n'est floute, rien ne
     piege : le visiteur qui refuse l'appel revient jouer avec le planning.

     POURQUOI CES DEUX-LA, et pas d'autres :
       - PLANNING : c'est la preuve qu'il s'agit d'un vrai logiciel et pas d'une
         maquette. Il se lit en trois secondes, il ne demande aucun reglage du
         centre pour etre credible (huit pistes, une journee, des creneaux), et
         c'est le seul ecran ou une donnee fabriquee reste honnete : personne ne
         confond le planning d'un centre fictif avec le sien.
       - MARKETING : c'est ce que la concurrence n'a pas. Un agent qui PREPARE
         une publication et attend la validation du gerant. Il se raconte sans
         reglage prealable, et c'est l'argument qui declenche l'appel.
     Tout le reste (chiffres du centre, file de reservations, fiches clients,
     textes des emails, tarifs, roles, configuration) ne vaut que branche sur
     les donnees du visiteur : le montrer fabrique, c'est le devaluer. */
  var OUVERT = { planning: true, campaigns: true };

  /* Le texte de chaque porte fermee. `quoi` = ce qu'il y a derriere, avec les
     MOTS DU PRODUIT (releves dans la console, pas inventes ici) ; `pourquoi` =
     la raison honnete pour laquelle ca s'ouvre pendant l'appel. */
  var INVITATIONS = {
    dashboard: {
      titre: "Vue d'ensemble",
      quoi: ['Les reservations, les joueurs et le chiffre du jour, compares a la veille',
        'Le taux d’occupation des pistes, créneau par créneau',
        'La répartition entre bowling, laser et formules',
        'Ce qui vient du site et ce qui vient du comptoir'],
      pourquoi: 'Un tableau de bord ne prouve rien avec des chiffres inventés. Sur vos données, il se lit en dix secondes.',
    },
    reservations: {
      titre: 'Réservations',
      quoi: ['Le mois entier en carte de chaleur, un jour = une intensité',
        'Le flux d’une journée, trié par heure, avec la durée et les pistes',
        'Le détail d’une réservation, son statut et son reste à encaisser',
        'La création d’une réservation au comptoir'],
      pourquoi: 'C’est votre carnet. On l’ouvre avec vos vraies réservations, reprises de votre outil actuel.',
    },
    formules: {
      titre: 'Formules',
      quoi: ['Chaque formule du jour et ce qu’elle contient',
        'La liste à cocher au fur et à mesure du service',
        'Ce qui reste à préparer avant l’arrivée du groupe'],
      pourquoi: 'Vos formules ne ressemblent pas à celles d’un centre inventé. On les charge avant l’appel.',
    },
    arrivals: {
      titre: 'Terrain',
      quoi: ['Arrivées : la file de clients à accueillir, confirmer ou encaisser',
        'En cours : ce qui se joue en salle maintenant',
        'Événements : les dossiers qui demandent une attention avant le passage'],
      pourquoi: 'Trois écrans faits pour le comptoir un samedi. Ils se jugent sur une vraie journée, pas sur la nôtre.',
    },
    clients: {
      titre: 'Clients',
      quoi: ['Chaque client, ses visites, ce qu’il a dépensé, sa prochaine venue',
        'À relancer : ceux venus deux fois et plus vus depuis deux mois',
        'Les demandes sur mesure reçues par le site, à traiter',
        'Les anniversaires fêtés ici il y a un an, qui se re-réservent'],
      pourquoi: 'Ce sont des données personnelles. On ne les invente pas pour une page publique : on ouvre l’écran avec les vôtres.',
    },
    emails: {
      titre: 'Emails et relances',
      quoi: ['Les six séquences automatiques, chacune allumée ou éteinte par vous',
        'Le texte exact de chaque email, modifiable, avec vos variables',
        'La file d’envoi : ce qui est parti, ce qui attend, ce qui a échoué',
        'Les emails reçus, et la réponse que l’agent a préparée'],
      pourquoi: 'Les textes portent le nom, le ton et les horaires de votre centre. On les écrit ensemble pendant l’appel.',
    },
    prices: {
      titre: 'Activités et tarifs',
      quoi: ['Vos tarifs par activité, par durée et par formule',
        'L’état des pistes, la maintenance et l’occupation du jour',
        'Le laser : lancements, groupes partagés, capacité en armes'],
      pourquoi: 'Un tarif inventé ne ressemble jamais au vôtre. On reprend votre grille telle quelle, c’est compris dans l’installation.',
    },
    users: {
      titre: 'Équipe et accès',
      quoi: ['Un rôle par métier : direction, accueil, terrain',
        'Ce que chaque rôle peut voir et faire, permission par permission',
        'Un code d’accès par personne, révocable en un clic'],
      pourquoi: 'Les accès se décident avec vous, pas devant tout le monde sur une page publique.',
    },
    establishment: {
      titre: 'Établissement',
      quoi: ['Vos horaires, jour par jour, et vos fermetures',
        'Vos ressources : pistes, arènes laser, tables d’anniversaire',
        'Les activités que vous vendez, et celles que vous ne vendez pas',
        'Votre couleur de marque, reprise par votre tunnel de réservation'],
      pourquoi: 'C’est la fiche de VOTRE centre. On la remplit ensemble : c’est l’installation, et elle prend vingt minutes.',
    },
  };
  // Les enfants de menu partagent l'invitation de leur parent : les trois
  // ecrans de Terrain racontent la meme promesse, les trois d'Activites aussi.
  var INVITATION_PARENTE = {
    sessions: 'arrivals', events: 'arrivals',
    lanes: 'prices', laserGame: 'prices',
    groups: 'clients', contacts: 'clients', settings: 'establishment',
  };
  function invitationDe(page) {
    return INVITATIONS[page] || INVITATIONS[INVITATION_PARENTE[page]] || null;
  }
  function estFerme(page) {
    if (FILM) return false;                       // le film joue toutes les scenes
    return !OUVERT[page] && !!invitationDe(page);
  }
  var LIEN_APPEL = 'https://pinlane.be/#demo';

  // L'application route par l'URL : arrivee sur `/demo` sans fragment, elle
  // ouvrait le PARCOURS DE RESERVATION CLIENT au lieu du planning. On pose donc
  // le fragment que son routeur attend, avant qu'elle ne se lance - forcer la
  // vue apres coup se faisait ecraser par sa propre decision de demarrage.
  try {
    if (!window.location.hash || window.location.hash === '#') {
      window.location.hash = '#/staff/' + PAGE;
    }
  } catch (error) { /* fragment refuse : le forcage plus bas prendra le relais */ }

  /* ---- Les donnees de demonstration --------------------------------------
     Une journee coherente : le nombre de reservations, de joueurs et le
     chiffre s'accordent. Un ecran de demonstration ou les totaux ne tombent
     pas juste detruit la confiance plus surement qu'une page vide. */
  /* AUCUNE ENTREPRISE REELLE, AUCUNE ECOLE REELLE, AUCUNE VILLE DU CLIENT.
     La liste d'avant portait « CE Delhaize », « Team Proximus », « CE Carrefour »,
     « Team Engie », « Team Solvay », « Ecole des Roches » et « Scouts Libramont ».
     Sur une page PUBLIQUE, une enseigne reelle en face d'une reservation affirme
     une relation commerciale qui n'existe pas, et « Libramont » designe le vrai
     client. Tout ce qui suit est invente : les societes portent des noms qui
     n'appartiennent a personne, et aucune ville n'est nommee. */
  var NOMS = ['Famille Dubois', 'Anniversaire Lucas', 'Team building Nexo', 'Groupe amis', 'Sarah Lemaire',
    'Ecole du Tilleul', 'Famille Martin', 'EVJF Camille', 'Club des Quilles', 'Famille Rousseau',
    'Duo Verhaegen', 'Soiree ligue', 'Famille Nowak', 'Anniversaire Lea', 'Groupe Vandenberg',
    'CE Vermeulen', 'Famille Moreau', 'Anniversaire Noah', 'Team Korrida', 'Club Athena',
    'Anniversaire Jade', 'Famille Petit', 'Amis du jeudi', 'Anniversaire Tom', 'Famille Renard',
    'Scouts de la Vallee', 'Team Voltyx', 'Famille Collin', 'Anniversaire Ines', 'Groupe Bastin',
    'Famille Gerard', 'CE Almadis', 'Amis de la piste', 'Anniversaire Hugo', 'Famille Simon',
    'Club Orion', 'Famille Leroy', 'Anniversaire Manon'];

  /* UNE IDENTITE PAR RESERVATION, pas une seule pour toutes.
     Toutes les lignes portaient `contact@example.be` et `+32 470 00 00 00` : la
     console, qui regroupe les clients par telephone puis par email
     (`getStaffClientReservationKey`), n'y voyait QU'UN SEUL client. Et un
     visiteur qui ouvre le detail d'une reservation depuis le planning lisait le
     meme numero partout. `example.be` reste le domaine (RFC 2606, reserve a la
     documentation : il n'appartiendra jamais a personne), et le numero est un
     +32 dont les huit chiffres viennent du rang. */
  function identifiant(nom) {
    return nom.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');
  }
  function identite(nom, rang) {
    // `rang + 1` : au rang 0 le produit valait 0 et le numero sortait
    // « +32 410 00 00 00 », qui se lit comme un champ non rempli.
    var n = 10000000 + (((rang + 1) * 618033) % 89999999);
    var s = String(n);
    return {
      email: identifiant(nom) + '@example.be',
      phone: '+32 4' + s.slice(0, 2) + ' ' + s.slice(2, 4) + ' ' + s.slice(4, 6) + ' ' + s.slice(6, 8),
    };
  }

  /* PLUSIEURS ACTIVITES, PAS UNE SEULE.
     La journee ne servait que du bowling : les 38 creneaux du planning
     affichaient tous « Bowling Classique », la repartition par activite du
     tableau de bord tombait a « Bowling 100 % · Laser 0 % · Complet 0 % », et la
     carte des formules disait « Aucune formule vendue aujourd'hui ». Un centre
     qui vend cinq choses paraissait n'en vendre qu'une.

     Le libelle n'est pas ecrit a la main : le produit le DERIVE
     (`getReservationLabel`) : `type: 'laser'` donne « Laser Game », un
     `formuleId` donne le nom de la formule. On pose donc le bon type et la bonne
     formule, et l'affichage suit tout seul.

     Les contraintes des formules sont RESPECTEES : on est un jeudi, donc pas de
     formule reservee au mardi (`css`) ni au vendredi (`ffm`) ; « BACK TO
     SCHOOL/WORK » n'apparait qu'apres 18 h et « MATIN MALIN » qu'avant midi,
     comme leur catalogue le declare. Une formule affichee un jour ou elle
     n'existe pas est exactement le genre d'incoherence qu'un gerant repere. */
  var NOMS_SANS_PISTE = ['Anniversaire Zoe', 'Team Solaris', 'Amis du mercredi', 'Groupe Delvaux',
    'Anniversaire Malo', 'Ecole des Peupliers', 'EVG Thomas', 'Famille Bastin',
    'Club Meridien', 'Anniversaire Livia'];

  /* Formules qui OCCUPENT une piste : elles vivent dans le planning bowling, avec
     leur nom a la place de « Bowling Classique ». */
  var FORMULES_PISTE = ['f1', 'f3', 'f4'];
  var FORMULE_SOIR = 'bts';            // 18 h - 22 h seulement
  /* Formules SANS piste + laser : elles nourrissent les listes du jour, la
     repartition par activite et la carte des formules. */
  var SANS_PISTE = ['laser', 'f2', 'hlg', 'laser', 'f5', 'mm', 'laser', 'f6', 'laser', 'f7'];

  /* UN SAMEDI QUI TOURNE, PAS UNE MATINEE CALME.
     La vitrine montrait treize reservations groupees entre 10 h et 16 h : le
     planning restait a moitie vide et le chiffre du jour tombait a quelques
     centaines d'euros. Un prospect qui cherche un outil de PILOTAGE n'a rien
     a piloter sur cet ecran-la, et sur la publicite, « 4 reservations »
     decredibilisait le produit plus surement qu'une absence de chiffre.

     La journee couvre desormais l'amplitude complete (10 h - 22 h) et remplit
     les huit pistes. Le remplissage se fait PISTE PAR PISTE : chaque piste
     enchaine ses sessions sans chevauchement, donc les totaux du produit
     (occupation, joueurs, chiffre) restent exacts : c'est lui qui compte, on
     ne fait que lui donner une journee plausible. */
  /* LE CREUX DE L'APRES-MIDI, et il n'est pas decoratif.
     Une grille pleine de 10 h a 22 h est aussi fausse qu'une grille vide : un
     bowling de semaine se vide entre le service de midi et la sortie des
     bureaux. Ce trou est ce que le gerant CHERCHE quand il ouvre son planning,
     et c'est exactement le fait sur lequel l'agent marketing s'appuie (voir la
     proposition « creux » du brief) : un visiteur peut verifier d'un ecran a
     l'autre que les deux parlent de la meme journee. Il n'est pas TOTAL : deux
     ou trois lignes y restent, sinon le trou lui-meme sonne fabrique. */
  var CREUX = [14, 16];
  function reservations() {
    var libre = [10, 10, 10, 10, 10, 10, 10, 10];   // heure de liberation par piste
    var sortie = [];
    NOMS.forEach(function (nom, i) {
      var pax = 4 + (i % 9);                         // de 4 a 12 joueurs
      var duree = (i % 6 === 0) ? 2 : 1;             // une sur six joue deux heures
      var nbPistes = pax > 6 ? 2 : 1;
      // On prend les pistes disponibles le plus tot, pour serrer la grille.
      var ordre = libre.map(function (h, k) { return { h: h, k: k }; })
        .sort(function (a, b) { return a.h - b.h || a.k - b.k; })
        .slice(0, nbPistes);
      var debut = Math.max.apply(null, ordre.map(function (o) { return o.h; }));
      if (debut >= CREUX[0] && debut < CREUX[1] && (i % 7) !== 3) debut = CREUX[1];
      if (debut + duree > 22) return;                // le centre ferme a 22 h
      ordre.forEach(function (o) { libre[o.k] = debut + duree; });
      var pistes = ordre.map(function (o) { return o.k + 1; });
      var hh = Math.floor(debut);
      var mm = (debut % 1) === 0 ? '00' : '30';
      // Une reservation sur quatre passe par une formule : le planning affiche
      // alors son nom au lieu de « Bowling Classique ». La formule du soir n'est
      // posee que sur un creneau ou son catalogue l'autorise.
      var formule = null;
      if (i % 4 === 1) {
        formule = (hh >= 18 && hh + duree <= 22)
          ? FORMULE_SOIR
          : FORMULES_PISTE[(i / 4 | 0) % FORMULES_PISTE.length];
      }
      sortie.push({
        id: 90000 + i,
        name: nom,
        formuleId: formule,
        date: AUJOURD_HUI,
        startTime: (hh < 10 ? '0' : '') + hh + ':' + mm,
        // EN HEURES, comme partout dans le produit (`duration: 1`). Cette
        // fixture disait 60, en croyant parler minutes : le taux d'occupation
        // affichait alors 813 % (13 x 60 / (8 pistes x 12 h d'ouverture)) et
        // ce chiffre absurde a ete pris pour un bug du produit pendant deux
        // sessions. Le produit, lui, comptait juste.
        duration: duree,
        pax: pax,
        lane: pistes[0],
        lanes: pistes,
        type: 'bowling',
        activity: 'bowling',
        status: i % 4 === 0 ? 'arrived' : 'pending',
        validationStatus: 'confirmed',
        // Le prix suit le nombre de joueurs et la duree : un total qui ne
        // s'explique pas par ce qui est a l'ecran se remarque tout de suite.
        price: Math.round((9.5 * pax + 14 * pistes.length) * duree),
        phone: identite(nom, i).phone,
        email: identite(nom, i).email,
        source: i % 3 === 0 ? 'phone' : 'online',
      });
    });

    /* Les activites qui n'occupent PAS de piste : laser et formules sans
       bowling. Elles ne peuvent donc pas fausser le taux d'occupation des
       pistes : la propriete « les totaux du produit restent exacts » tient
       toujours. Deux zones laser : on les sequence comme les pistes. */
    var libreZone = [10, 10];
    NOMS_SANS_PISTE.forEach(function (nom, j) {
      var quoi = SANS_PISTE[j % SANS_PISTE.length];
      var laser = quoi === 'laser';
      var pax = 5 + (j % 8);
      var duree = laser ? 0.5 : 2;
      var z = libreZone[0] <= libreZone[1] ? 0 : 1;
      var debut = laser ? libreZone[z] : 11 + j;
      if (quoi === 'mm') debut = 10.5;                 // MATIN MALIN : avant midi
      if (debut + duree > 22) return;
      if (laser) libreZone[z] = debut + duree;
      var hh = Math.floor(debut);
      var mm = (debut % 1) === 0 ? '00' : '30';
      sortie.push({
        id: 95000 + j,
        name: nom,
        formuleId: laser ? null : quoi,
        date: AUJOURD_HUI,
        startTime: (hh < 10 ? '0' : '') + hh + ':' + mm,
        duration: duree,
        pax: pax,
        lane: null,
        lanes: [],
        type: laser ? 'laser' : 'complete',
        status: j % 3 === 0 ? 'arrived' : 'pending',
        validationStatus: 'confirmed',
        price: Math.round((laser ? 12 : 26) * pax),
        phone: identite(nom, 100 + j).phone,
        email: identite(nom, 100 + j).email,
        source: j % 2 === 0 ? 'online' : 'phone',
      });
    });
    return sortie;
  }

  var DEMO = reservations();

  var PERMISSIONS = ['dashboard.view', 'planning.view', 'planning.bowling', 'planning.laser',
    'reservations.view', 'reservations.create', 'reservations.edit', 'reservations.status',
    'reservations.quick', 'clients.view', 'direction.view', 'campaigns.manage', 'marketing.agents',
    // « Emails & relances » etait dans le menu mais sans ses droits : la page
    // s'ouvrait en lecture et ses actions restaient inertes.
    'emails.view', 'emails.send'];

  var SESSION = {
    token: 'demo',
    cookieBacked: false,
    centerId: 'demo',
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    member: { id: 'demo', name: 'Julie', roleId: 'direction' },
    role: { id: 'direction', name: 'Direction', locked: true },
    permissions: PERMISSIONS,
  };

  /* Toute enseigne de client qui traverserait ce mode est remplacee a la
     source, y compris au fond des objets de configuration.

     LES VILLES AUSSI, et ce n'est pas de la prudence theorique : l'application
     porte une liste de repli codee en dur (`FALLBACK_CENTERS` de staff-menu.js,
     `ADMIN_CENTER_FALLBACKS` de app-main.js) ou le centre s'appelle « Fun Galaxy
     Libramont ». Le remplacement de l'enseigne seule laissait « Bowling Central
     Libramont » a l'ecran - constate le 2026-08-13 dans l'en-tete de la page
     Marketing. Une ville nommee designe le vrai client aussi surement que son
     enseigne. On coupe donc les deux, et le suffixe disparait proprement. */
  var ENSEIGNE = /fun\s*galaxy/gi;
  var VILLES_CLIENT = /\s*\b(libramont|gembloux|ciney)\b/gi;
  // Une regex `g` utilisee avec `.test()` garde son `lastIndex` d'un appel a
  // l'autre et rend false une fois sur deux. Le detecteur est donc une COPIE
  // sans `g` : les deux au-dessus ne servent qu'a `.replace()`.
  var A_NETTOYER = /fun\s*galaxy|\b(libramont|gembloux|ciney)\b/i;
  function anonymiser(texte) {
    return texte.replace(ENSEIGNE, CENTRE).replace(VILLES_CLIENT, '');
  }
  function neutraliser(valeur) {
    if (typeof valeur === 'string') return anonymiser(valeur);
    if (Array.isArray(valeur)) return valeur.map(neutraliser);
    if (valeur && typeof valeur === 'object') {
      var sortie = {};
      Object.keys(valeur).forEach(function (cle) { sortie[cle] = neutraliser(valeur[cle]); });
      return sortie;
    }
    return valeur;
  }

  /* LE CENTRE DE LA DEMONSTRATION, a la forme que le produit attend.
     `normalizeStaffCenterId` (app-main.js) ne connait que trois identifiants et
     rabat tout le reste sur `libramont` : l'identifiant technique du centre de
     demonstration est donc celui-la, qu'on le veuille ou non. Il n'est JAMAIS
     affiche (le seul ecran qui le montre, Etablissement, est ferme), et le
     nettoyage de villes ci-dessus le couvre de toute facon.
     Sans cette reponse, `menuCenters` rendait une liste vide et la console
     retombait sur sa liste codee en dur : « Fun Galaxy Libramont » s'affichait
     dans l'en-tete de la page Marketing. */
  var CENTRE_ID = 'libramont';
  var CENTRE_FICHE = {
    id: CENTRE_ID,
    name: CENTRE,
    label: CENTRE,
    shortName: CENTRE,
    meta: '8 pistes · 2 arènes laser',
    status: 'active',
    timezone: 'Europe/Brussels',
    resources: {
      bowling: { laneCount: 8 },
      laser: { weaponCount: 30, parallelLaunches: 2, riskLevel: 'managed' },
      partyTables: { count: 3 },
    },
    defaultSchedule: null,
    activityAvailability: {},
    holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: ['public', 'school_short', 'manual'] },
    offerAvailability: {},
    classification: {},
    customActivities: [],
    branding: null,
    clientId: null,
    clientName: null,
  };
  var CONFIG = { ok: true, centers: [CENTRE_FICHE], activities: [] };

  /* ---- « Emails & relances » ---------------------------------------------
     Ajoute le 2026-08-03. Le mode demonstration repondait VIDE a tout ce qui
     n'etait pas le planning : un visiteur qui ouvrait « Emails & relances » sur
     /demo voyait « File vide », six sequences eteintes et zero partout, et
     concluait que la fonction n'existait pas. C'est celle qui se vend le mieux.

     MEME REGLE QUE POUR LA JOURNEE : les chiffres tombent juste. Les compteurs
     se DERIVENT du volume de la journee de demonstration au lieu d'etre ecrits
     a la main, sinon un visiteur qui compare deux ecrans trouve la
     contradiction avant nous. Et les destinataires sont les reservations du
     planning : le meme nom se retrouve des deux cotes. */

  // Le mois deduit de la journee : environ 4 samedis pleins comme celle-ci, et
  // 26 jours plus calmes autour de 40 % de son volume.
  var RESAS_MOIS = Math.round(DEMO.length * (4 + 26 * 0.4));
  var ilYA = function (heures) { return new Date(Date.now() - heures * 3600e3).toISOString(); };
  var dans = function (heures) { return new Date(Date.now() + heures * 3600e3).toISOString(); };
  // La MEME adresse que la reservation du planning : `identifiant()` est la
  // seule fabrique d'identite du fichier, les deux ecrans ne peuvent pas
  // diverger.
  var courriel = function (nom) { return identifiant(nom) + '@example.be'; };

  // Les six sequences du produit. `reactivation` est eteinte : c'est le defaut
  // reel du serveur (AUTOMATION_DEFAULTS), et le montrer dit que rien ne part
  // sans que le gerant l'ait allume.
  var AUTO_SETTINGS = {
    request_received: { enabled: true }, confirmation: { enabled: true },
    // RIEN D'AUTRE QUE `enabled` ICI. Un `offsetDays` ou un `cap` presents dans
    // les REGLAGES sont lus par l'ecran comme un ecart voulu par le gerant :
    // quatre cartes portaient une pilule « modifie » alors qu'elles etaient a
    // leur valeur d'usine. Les defauts vivent dans AUTO_DEFAULTS, pas ici.
    reminder_48h: { enabled: true }, post_visit: { enabled: true },
    birthday_j30: { enabled: true }, reactivation: { enabled: false },
  };
  var VARS = ['prenom', 'date', 'heure', 'formule', 'pax', 'centre'];
  var AUTO_DEFAULTS = {
    request_received: { enabled: true, variables: VARS, subject: 'On a bien reçu votre demande', body: 'Bonjour {{prenom}},\n\nVotre demande du {{date}} à {{heure}} est bien arrivée. On vous confirme très vite.\n\nL’équipe ' + CENTRE },
    confirmation: { enabled: true, variables: VARS, subject: 'Votre réservation est confirmée', body: 'Bonjour {{prenom}},\n\nC’est confirmé : {{formule}}, le {{date}} à {{heure}}, pour {{pax}} personnes.\n\nÀ très vite,\nL’équipe ' + CENTRE },
    reminder_48h: { enabled: true, offsetDays: 2, variables: VARS, subject: 'On vous attend {{date}}', body: 'Bonjour {{prenom}},\n\nPetit rappel : on vous attend le {{date}} à {{heure}}, pour {{pax}} personnes.\n\nL’équipe ' + CENTRE },
    post_visit: { enabled: true, offsetDays: 1, variables: VARS, subject: 'Merci de votre visite', body: 'Bonjour {{prenom}},\n\nMerci d’être passé. Si vous avez aimé, revenez quand vous voulez.\n\nL’équipe ' + CENTRE },
    birthday_j30: { enabled: true, offsetDays: 30, variables: VARS, subject: 'L’anniversaire approche', body: 'Bonjour {{prenom}},\n\nL’an dernier vous avez fêté l’anniversaire ici. On vous garde une date ?\n\nL’équipe ' + CENTRE },
    reactivation: { enabled: false, cap: 20, variables: VARS, subject: 'Ça fait un moment', body: 'Bonjour {{prenom}},\n\nÇa fait un moment. Les pistes et le laser vous attendent.\n\nL’équipe ' + CENTRE },
  };
  // Derives du mois, pas ecrits : une demande d'accuse pour les reservations en
  // ligne (2 sur 3), une confirmation par reservation, un rappel pour celles
  // qui ne sont pas du jour meme, un merci pour celles qui ont eu lieu.
  var AUTO_STATS = {
    request_received: { sent30d: Math.round(RESAS_MOIS * 0.66), failed30d: 0 },
    confirmation: { sent30d: RESAS_MOIS, failed30d: 1 },
    reminder_48h: { sent30d: Math.round(RESAS_MOIS * 0.88), failed30d: 0 },
    post_visit: { sent30d: Math.round(RESAS_MOIS * 0.94), failed30d: 2 },
    birthday_j30: { sent30d: Math.round(RESAS_MOIS * 0.04), failed30d: 0 },
    reactivation: { sent30d: 0, failed30d: 0 },
  };

  // Une date qu'un client lit, pas une date de base de donnees : « 2026-08-03 »
  // apparaissait tel quel dans les sujets.
  function dateLisible(iso) {
    try {
      return new Date(iso + 'T12:00:00').toLocaleDateString('fr-BE',
        { weekday: 'long', day: 'numeric', month: 'long' });
    } catch (error) { return iso; }
  }

  // « Bonjour Dubois » etait faux : le dernier mot de « Famille Dubois » est un
  // NOM DE FAMILLE, et une reservation collective n'a pas de prenom du tout.
  var COLLECTIFS = /^(famille|groupe|anniversaire|team|club|duo|soiree|ecole|evjf|comite)/i;
  function sansAccent(mot) {
    return mot.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  function prenomDe(nom) {
    if (COLLECTIFS.test(sansAccent(nom))) return '';
    return nom.split(' ')[0];
  }
  function formuleDe(r) {
    if (r.type === 'laser') return 'Laser Game';
    if (r.activity === 'bowling') return 'Bowling';
    return 'Formule complete';
  }

  // Remplit un gabarit avec les valeurs REELLES de la reservation, les memes
  // que le planning affiche. Les deux ecrans ne peuvent pas se contredire :
  // ils lisent la meme ligne.
  function remplir(gabarit, r) {
    return gabarit
      .replace(/\{\{prenom\}\}/g, prenomDe(r.name))
      .replace(/Bonjour ,/g, 'Bonjour,')
      .replace(/\{\{date\}\}/g, dateLisible(r.date))
      .replace(/\{\{heure\}\}/g, r.startTime)
      .replace(/\{\{formule\}\}/g, formuleDe(r))
      .replace(/\{\{pax\}\}/g, String(r.pax))
      .replace(/\{\{centre\}\}/g, CENTRE);
  }

  // La file : des envois pris sur les reservations du planning, pour que le nom
  // affiche ici soit celui d'une carte qu'on vient de voir.
  //
  // ATTENTION AU DOUBLE VOCABULAIRE : la sequence s'appelle `post_visit` dans
  // les reglages, mais le mail reellement envoye porte le modele
  // `post_visit_followup`. Avec la cle des reglages, la colonne « Modele »
  // affichait l'identifiant technique brut au lieu de « Merci post-visite ».
  var MODELE_ENVOYE = {
    confirmation: 'confirmation', reminder_48h: 'reminder_48h', post_visit: 'post_visit_followup',
  };
  var COMMS = DEMO.slice(0, 9).map(function (r, i) {
    var etat = i < 6 ? 'delivered' : (i < 8 ? 'queued' : 'failed');
    var cle = i % 3 === 0 ? 'confirmation' : (i % 3 === 1 ? 'reminder_48h' : 'post_visit');
    return {
      id: 4100 + i, centerId: 'demo', channel: 'email', direction: 'outbound',
      templateId: MODELE_ENVOYE[cle], recipient: courriel(r.name),
      subject: remplir(AUTO_DEFAULTS[cle].subject, r), status: etat,
      sentAt: etat === 'delivered' ? ilYA(1 + i * 2) : null,
      scheduledAt: etat === 'queued' ? dans(4 + i) : null,
      createdAt: ilYA(1 + i * 2),
      lastError: etat === 'failed' ? 'Adresse refus\u00e9e par le serveur du destinataire.' : null,
      attempts: etat === 'failed' ? 2 : 1,
      payload: { textBody: remplir(AUTO_DEFAULTS[cle].body, r) },
    };
  });

  // LES MAILS RECUS, ET CE QUE L'AGENT EN A COMPRIS. C'est le coeur de la
  // fonction : le gerant lit « ce qu'il veut » avant d'ouvrir le mail, et la
  // reponse est deja ecrite.
  var RECUS = [
    {
      id: 4201, centerId: 'demo', channel: 'email', direction: 'inbound', status: 'received',
      templateId: null, recipient: 'julie.moreau@example.be', subject: 'Anniversaire pour ma fille',
      createdAt: ilYA(2),
      payload: {
        from: 'julie.moreau@example.be',
        textBody: 'Bonjour,\n\nJe voudrais organiser l’anniversaire de ma fille, elle a 10 ans. On serait 12 enfants. Est-ce que vous avez de la place samedi après-midi ?\n\nMerci d’avance,\nJulie',
        analysis: {
          intent: 'anniversaire', intentLabel: 'Anniversaire',
          summary: 'Anniversaire pour 12 enfants de 10 ans, demande la disponibilité de samedi après-midi',
          urgency: 'normale',
          reply: { subject: 'Re: Anniversaire pour ma fille', body: 'Bonjour Julie,\n\nAvec plaisir. Pour 12 enfants de 10 ans, la formule anniversaire est la plus adaptée : elle comprend la piste, la boisson et le gâteau.\n\nDites-nous l’heure qui vous arrange samedi après-midi et on vous bloque la place.\n\nL’équipe ' + CENTRE },
          clientName: 'Julie Moreau', provider: 'anthropic',
        },
      },
    },
    {
      id: 4202, centerId: 'demo', channel: 'email', direction: 'inbound', status: 'received',
      templateId: null, recipient: 'thomas.b@example.be', subject: 'Annulation de demain',
      createdAt: ilYA(5),
      payload: {
        from: 'thomas.b@example.be',
        textBody: 'Bonjour, je dois annuler notre réservation de demain soir, un empêchement. Désolé pour le délai.',
        analysis: {
          intent: 'annulation', intentLabel: 'Annulation',
          summary: 'Annule sa réservation de demain soir',
          urgency: 'haute',
          reply: { subject: 'Re: Annulation de demain', body: 'Bonjour Thomas,\n\nC’est noté, votre réservation de demain soir est annulée, sans frais.\n\nQuand vous voulez revenir, écrivez-nous.\n\nL’équipe ' + CENTRE },
          clientName: 'Thomas Berger', provider: 'anthropic',
        },
      },
    },
    {
      id: 4203, centerId: 'demo', channel: 'email', direction: 'inbound', status: 'received',
      templateId: null, recipient: 'compta@nexo-group.example.be', subject: 'Team building 24 personnes',
      createdAt: ilYA(26),
      payload: {
        from: 'compta@nexo-group.example.be',
        textBody: 'Bonjour, nous cherchons une activité pour 24 personnes un jeudi soir en septembre. Bowling et laser possible sur la même soirée ?',
        // Repondu : la ligne porte le badge, et c'est ce mail qui a servi de
        // lecon a l'agent (le staff a corrige sa reponse).
        repliedAt: ilYA(25), replyCommunicationId: 4204,
        analysis: {
          intent: 'reservation', intentLabel: 'Réservation',
          summary: 'Team building de 24 personnes, un jeudi soir de septembre, bowling et laser',
          urgency: 'normale',
          reply: { subject: 'Re: Team building 24 personnes', body: 'Bonjour,\n\nOui, c’est possible sur la même soirée : on sépare le groupe en deux et on alterne.\n\nDonnez-nous la date et on vous confirme.\n\nL’équipe ' + CENTRE },
          clientName: 'Nexo Group', provider: 'anthropic',
        },
      },
    },
  ];
  var TOUS_MAILS = RECUS.concat(COMMS);

  /* ========================================================================
     LE CENTRE TRAVAILLE : les demandes en attente et l'agent marketing.
     ========================================================================
     Ces deux jeux existent pour une raison precise (Movsar, 2026-08-13) : sans
     eux, la demonstration montrait un produit MORT. Aucune publication
     preparee, aucune demande a traiter, rien qui attende une decision. Un
     prospect n'a alors rien a valider, donc rien a comprendre.

     DEUX GARDES DE VERITE, non negociables :
       1. Rien ne part tout seul. L'agent PREPARE, le gerant valide ou copie.
          Le mot « publie » n'apparait sur aucune proposition, et les etats
          possibles sont « a valider » puis « mesure en cours ».
       2. Aucun euro encaisse. Le produit n'encaisse pas et ne l'a jamais fait
          (encadre du README projet). La paie de l'agent se compte en VENUES et
          en chiffre RESERVE, jamais en paiement recu.

     Tous les nombres se DERIVENT de la journee affichee sur le planning : un
     visiteur qui additionne ce qu'il voit sur un ecran doit retomber sur ce
     que l'autre annonce. */
  var JOUEURS_JOUR = DEMO.reduce(function (s, r) { return s + r.pax; }, 0);
  var CHIFFRE_JOUR = DEMO.reduce(function (s, r) { return s + r.price; }, 0);
  var PANIER = Math.round((CHIFFRE_JOUR / JOUEURS_JOUR) * 10) / 10;

  function dateDecalee(iso, jours) {
    var d = new Date(iso + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + jours);
    return d.toISOString().slice(0, 10);
  }
  function jourSemaine(iso) { return new Date(iso + 'T12:00:00Z').getUTCDay(); }

  /* LE RADAR 14 JOURS. Le profil de semaine d'un bowling : le week-end porte,
     le milieu de semaine creuse. Le nombre affiche est un nombre de JOUEURS
     (c'est ce que le produit met dans `resaCount`), et la somme des quatorze
     jours est exactement ce que la carte « a venir » annonce plus bas. */
  var PROFIL = [0.78, 0.55, 0.42, 0.50, 0.66, 1.00, 0.92];   // dim -> sam
  var RADAR = [];
  for (var d14 = 0; d14 < 14; d14 += 1) {
    var jour = dateDecalee(AUJOURD_HUI, d14);
    var dow = jourSemaine(jour);
    var part = PROFIL[dow];
    var joueurs = d14 === 0 ? JOUEURS_JOUR : Math.round(JOUEURS_JOUR * part * (0.62 + ((d14 * 7) % 5) * 0.06));
    var niveau = part <= 0.45 ? 'creux' : (part <= 0.6 ? 'calme' : (part >= 0.92 ? 'fort' : 'normal'));
    RADAR.push({
      date: jour, dow: dow, level: d14 === 0 ? 'fort' : niveau,
      tmax: 19 + ((d14 * 3) % 9), precipMm: (d14 % 5 === 2) ? 4 : 0, event: '',
      resaCount: joueurs,
      explanation: niveau === 'creux'
        ? 'Mercredi est ton jour le plus bas depuis quatre semaines.'
        : (niveau === 'fort' ? 'Jour fort : le samedi porte ta semaine.' : 'Journée dans la moyenne.'),
      propositionKey: null,
    });
  }
  var PROCHAIN_CREUX = RADAR.slice(2).filter(function (j) { return j.level === 'creux'; })[0] || RADAR[3];
  var JOUEURS_14J = RADAR.reduce(function (s, j) { return s + j.resaCount; }, 0);
  // Le nombre de joueurs PAR reservation, mesure sur la journee affichee : la
  // conversion joueurs -> reservations du radar utilise le meme rapport que le
  // planning, sinon les deux ecrans se contredisent au premier calcul.
  var PAX_PAR_RESA = JOUEURS_JOUR / DEMO.length;

  /* LES PROPOSITIONS : ce que l'agent a PREPARE et qui attend une validation.
     La premiere s'appuie sur un fait que le visiteur peut verifier lui-meme sur
     le planning ouvert a cote : le trou de 14 h a 16 h. */
  var PROPOSITIONS = [
    {
      key: 'demo:creux', source: 'cron', id: 9001, trigger: 'creux',
      whyShort: 'Tes après-midis de semaine sont vides entre 14 h et 16 h',
      why: 'Tes après-midis de semaine sont vides entre 14 h et 16 h, et ' + PROCHAIN_CREUX.date.slice(8, 10) + ' s’annonce comme ton jour le plus bas des quatorze prochains.',
      dueDate: dateDecalee(AUJOURD_HUI, 1), targetDate: PROCHAIN_CREUX.date,
      kind: 'post', pinned: false, network: 'facebook',
      networks: {
        facebook: { text: 'Les après-midis sont à nous.\n\nDe 14 h à 16 h en semaine, les pistes sont libres et le centre est calme. C’est le bon moment pour apprendre à jouer, pour une partie à deux, ou pour venir avec les enfants sans la foule du samedi.\n\nRéservation en ligne, on garde la piste.' },
        instagram: { text: 'De 14 h à 16 h, les pistes sont à vous.\nCalme, place, et personne derrière vous.\nRéservation en ligne.' },
      },
      photoIdea: 'Une piste vide, lumière du jour, quilles en place. Pas de monde dans le cadre.',
      imagePrompt: '', bestSlot: 'mardi 11 h', angle: 'situation',
      status: 'proposed', signature: 'demo-creux-apresmidi',
    },
    {
      key: 'demo:anniv', source: 'persisted', id: 9002, trigger: 'demande',
      whyShort: '9 anniversaires fêtés ici il y a un an, aucun recontacté',
      why: '9 anniversaires fêtés ici il y a un an, aucun recontacté. La séquence anniversaire J-30 est allumée, mais ces neuf-là sont antérieurs.',
      dueDate: dateDecalee(AUJOURD_HUI, 4), targetDate: null,
      kind: 'email', pinned: false, network: 'email',
      networks: {
        email: { text: 'Objet : l’anniversaire approche\n\nBonjour,\n\nL’an dernier, l’anniversaire a été fêté chez nous. Si vous voulez remettre ça, dites-nous une date et on garde la piste et la table.\n\nL’équipe ' + CENTRE },
      },
      photoIdea: '', imagePrompt: '', bestSlot: 'jeudi 18 h', angle: 'offre',
      status: 'proposed', signature: 'demo-anniv-un-an',
    },
  ];
  RADAR.forEach(function (j) { if (j.date === PROCHAIN_CREUX.date) j.propositionKey = 'demo:creux'; });

  var MARKETING = {
    ok: true, centerId: CENTRE_ID, today: AUJOURD_HUI,
    generatedAt: new Date(Date.now() - 5 * 3600e3).toISOString(),
    networks: ['facebook', 'instagram', 'story'],
    /* LA PAIE : jamais un euro encaisse. `euros` est le chiffre RESERVE par
       les venues attribuees a un envoi, mesure a jours comparables. Le produit
       n'a aucun prestataire de paiement, donc annoncer « encaisse » serait la
       meme faute commerciale que l'acompte corrige le 2026-08-08. */
    paie: {
      euros: Math.round(PANIER * 46), venues: 46, sent: 312, reviewClicks: 18, days: 30,
      sources: [
        { source: 'post_visit', sent: 186, revenue: Math.round(PANIER * 26), conversions: 26 },
        { source: 'facebook', sent: 84, revenue: Math.round(PANIER * 13), conversions: 13 },
        { source: 'birthday_j30', sent: 42, revenue: Math.round(PANIER * 7), conversions: 7 },
      ],
      young: false, quietWindow: false,
      firstVerdictDate: dateDecalee(AUJOURD_HUI, 14),
    },
    brief: {
      text: 'Deux choses ce matin. Tes après-midis de semaine restent vides entre 14 h et 16 h, alors que le soir se remplit tout seul : j’ai préparé un post qui vise ce créneau. Et 9 anniversaires fêtés ici il y a un an n’ont jamais été recontactés, j’ai écrit l’email. Les deux attendent ta validation, je ne publie rien sans toi.',
      degraded: false,
    },
    pulse: {
      revenue30: Math.round(CHIFFRE_JOUR * 22), visitors30: Math.round(JOUEURS_JOUR * 22),
      avgBasket: PANIER,
      upcomingPax: JOUEURS_14J, upcomingResa: Math.round(JOUEURS_14J / PAX_PAR_RESA),
      reservedRevenue: Math.round(JOUEURS_14J * PANIER),
      bestDay: { date: dateDecalee(AUJOURD_HUI, -5), revenue: Math.round(CHIFFRE_JOUR * 1.18), visitors: Math.round(JOUEURS_JOUR * 1.18) },
    },
    radar: RADAR,
    dataDays: 214, medianVisitors: Math.round(JOUEURS_JOUR * 0.66),
    facts: {
      bestDay: { dow: 6, label: 'samedi', avgVisitors: Math.round(JOUEURS_JOUR * 0.95), vsMedianPct: 44, confidence: 'solide' },
      worstDay: { dow: 3, label: 'mercredi', avgVisitors: Math.round(JOUEURS_JOUR * 0.28), vsMedianPct: -57, confidence: 'solide' },
      weather: { rainEffectPct: 12, heatEffectPct: -9, confidence: 'signal', sampleDays: 61 },
      holidayEffectPct: 23, holidayEffectConfidence: 'solide',
      trend4w: { pct: 6 },
      bestMonth: null,
    },
    patterns: [
      { context: 'Post FB · jour calme', kind: 'post', channel: 'facebook', netDeltaPct: 14, basis: 'net', n: 7, confidence: 'signal' },
      { context: 'Email · vacances scolaires', kind: 'email', channel: 'email', netDeltaPct: 9, basis: 'net', n: 5, confidence: 'exploratoire' },
    ],
    propositions: PROPOSITIONS,
    /* LES RECUS : ce que les publications precedentes ont donne, verdict a
       J+14, en pourcentage de frequentation a jours comparables. Un « pas
       d'effet mesurable » assume vaut mieux qu'une reussite sur trois. */
    receipts: [
      { id: 8801, label: 'Post pluie du 28/07', tone: 'good', result: '+16 % de monde', redoable: true },
      { id: 8802, label: 'Email dormants du 21/07', tone: 'good', result: '+11 % de monde', redoable: true },
      { id: 8803, label: 'Story du 04/08', tone: 'neutral', result: 'pas d’effet mesurable', redoable: false },
      { id: 8804, label: 'Post créneau du midi du 09/08', tone: 'pending', result: 'verdict le ' + dateDecalee(AUJOURD_HUI, 10), redoable: false },
    ],
    veille: { count: 3, changed: [{ name: 'Le bowling à 12 min', diff: 'Nouvelle formule anniversaire affichée à 21 € par enfant.' }] },
  };

  /* LA VEILLE. Les concurrents sont DESIGNES, jamais nommes : aucune enseigne
     reelle sur une page publique, meme celle d'un concurrent, et surtout pas
     accompagnee d'un tarif ou d'une note qu'on aurait inventes. */
  var CONCURRENTS = [
    {
      id: 501, name: 'Le bowling à 12 min', websiteUrl: '', enabled: true,
      rating: 4.2, reviewsCount: 318, lastCheckedAt: AUJOURD_HUI,
      signals: [{ label: 'Anniversaire enfant', price: '21 €' }, { label: 'Partie adulte', price: '9,50 €' }],
      lastDiff: 'Nouvelle formule anniversaire affichée à 21 € par enfant.',
    },
    {
      id: 502, name: 'Le complexe de la zone commerciale', websiteUrl: '', enabled: true,
      rating: 3.9, reviewsCount: 141, lastCheckedAt: AUJOURD_HUI,
      signals: [{ label: 'Laser game', price: '12 €' }],
      lastDiff: '',
    },
    {
      id: 503, name: 'Le laser game du centre-ville', websiteUrl: '', enabled: true,
      rating: 4.5, reviewsCount: 87, lastCheckedAt: dateDecalee(AUJOURD_HUI, -1),
      signals: [{ label: 'Partie 20 min', price: '11 €' }],
      lastDiff: '',
    },
  ];

  /* LE PLAN DES 8 SEMAINES. Deux semaines portent une date certaine (rentree,
     jour ferie), les autres restent en « rien de date » : c'est l'etat honnete
     d'un plan qui n'invente pas d'evenement. */
  function lundiDe(decalage) {
    var base = new Date(AUJOURD_HUI + 'T12:00:00Z');
    var vers = (base.getUTCDay() + 6) % 7;
    base.setUTCDate(base.getUTCDate() - vers + decalage * 7);
    return base.toISOString().slice(0, 10);
  }
  var PLAN = {
    generatedAt: new Date(Date.now() - 30 * 3600e3).toISOString(),
    context: { hasMeasuredEvidence: true },
    weeks: [
      {
        index: 0, from: lundiDe(0), to: dateDecalee(lundiDe(0), 6),
        confiance: 'mesure', objectif: 'Remplir les après-midis de semaine',
        pourquoi: 'Le créneau 14 h - 16 h est le seul trou récurrent de tes journées, et un post « jour calme » t’a rapporté 14 % de monde en plus la dernière fois.',
        actions: ['Publier le post « les après-midis sont à nous »', 'Afficher le créneau au comptoir'],
      },
      {
        index: 1, from: lundiDe(1), to: dateDecalee(lundiDe(1), 6),
        confiance: 'calendrier', objectif: 'Préparer la rentrée des groupes',
        pourquoi: 'Les écoles et les comités d’entreprise réservent trois à quatre semaines avant. La fenêtre s’ouvre maintenant.',
        actions: ['Envoyer l’email aux 9 anniversaires d’il y a un an', 'Relancer les groupes de l’an dernier'],
      },
      {
        index: 2, from: lundiDe(2), to: dateDecalee(lundiDe(2), 6),
        confiance: 'routine', objectif: 'Tenir le rythme du week-end',
        pourquoi: 'Rien de daté cette semaine. Un post samedi matin suffit à tenir la présence.',
        actions: ['Un post samedi matin'],
      },
    ],
  };

  /* LES DEMANDES SUR MESURE : ce que le site a recu et que personne n'a encore
     traite. Deux sont neuves, donc le menu porte la pastille « 2 » sur
     Clients : la console a l'air VIVANTE meme depuis une porte fermee, et le
     chiffre annonce exactement ce que l'invitation promet d'ouvrir. */
  var DEMANDES = [
    {
      id: 7101, centerId: CENTRE_ID, status: 'new', createdAt: ilYA(3),
      name: 'Claire Wauters', email: 'claire.wauters@example.be', phone: identite('Claire Wauters', 7).phone,
      pax: 26, date: dateDecalee(AUJOURD_HUI, 23), message: 'Team building pour 26 personnes, un jeudi soir. Bowling et laser sur la même soirée, c’est possible ?',
      occasion: 'entreprise', source: 'site',
    },
    {
      id: 7102, centerId: CENTRE_ID, status: 'new', createdAt: ilYA(9),
      name: 'Julie Moreau', email: 'julie.moreau@example.be', phone: identite('Julie Moreau', 12).phone,
      pax: 12, date: dateDecalee(AUJOURD_HUI, 9), message: 'Anniversaire pour ma fille, 12 enfants de 10 ans, samedi après-midi.',
      occasion: 'anniversaire', source: 'site',
    },
    {
      id: 7103, centerId: CENTRE_ID, status: 'in_progress', createdAt: ilYA(31),
      name: 'Ecole du Tilleul', email: 'direction@example.be', phone: identite('Ecole du Tilleul', 21).phone,
      pax: 48, date: dateDecalee(AUJOURD_HUI, 16), message: 'Sortie de fin d’année, deux classes, 48 élèves. Devis demandé.',
      occasion: 'ecole', source: 'telephone',
    },
  ];

  /* Le pack de l'atelier, par reseau. Meme angle que la proposition en attente
     (le creux de 14 h - 16 h) : les deux surfaces de la page racontent la meme
     journee, celle que le planning montre a cote. */
  var MEILLEUR_MOMENT = { facebook: 'jeudi 18 h - 20 h', instagram: 'mercredi 12 h - 13 h', tiktok: 'jeudi 19 h - 21 h', linkedin: 'mardi-jeudi 8 h - 10 h' };
  function paquetAtelier(reseau) {
    return {
      generationMode: 'template',
      theme: 'le creux de 14 h - 16 h',
      bestTime: MEILLEUR_MOMENT[reseau] || MEILLEUR_MOMENT.facebook,
      quality: { status: 'review', score: 78 },
      long: 'Les après-midis sont à nous.\n\nDe 14 h à 16 h en semaine, les pistes sont libres et le centre est calme. C’est le bon moment pour apprendre à jouer, pour une partie à deux, ou pour venir avec les enfants sans la foule du samedi.\n\nRéservation en ligne, on garde la piste.',
      short: 'De 14 h à 16 h en semaine, les pistes sont à vous. Réservation en ligne.',
      story: 'Piste libre. 14 h - 16 h. Aucune file.\nRéserve en deux clics.',
      hashtags: ['#bowling', '#sortieenfamille', '#jourdepluie', '#apresmidi'],
      photoIdea: 'Une piste vide, lumière du jour, quilles en place. Personne dans le cadre.',
      aiImagePrompt: 'empty bowling lane, daylight from a side window, pins standing, warm wood, no people, wide shot',
    };
  }

  function reponse(charge) {
    return new Response(JSON.stringify(neutraliser(charge)), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }

  // La table des reponses. Tout ce qui n'y figure pas recoit une reponse VIDE
  // mais valide : un ecran inconnu affiche « rien a montrer », il ne plante
  // pas et il n'atteint pas le reseau.
  function repondre(chemin, action, corps) {
    if (chemin === '/api/staff-auth') {
      return reponse({
        ok: true, authenticated: true, session: SESSION,
        accessControl: {
          selectedRoleId: 'direction', selectedMemberId: 'demo',
          roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: '', updatedAt: new Date().toISOString(), locked: true, permissions: PERMISSIONS }],
          members: [{ id: 'demo', name: 'Julie', contact: '', roleId: 'direction', status: 'active', code: '', lastSeen: new Date().toISOString() }],
          events: [], permissions: PERMISSIONS,
        },
      });
    }
    if (chemin === '/api/staff-state') {
      return reponse({ ok: true, revision: 'demo', reservations: DEMO, laneStatuses: {}, centerId: 'demo' });
    }
    if (chemin === '/api/admin-range') {
      return reponse({ ok: true, reservations: DEMO, emails: TOUS_MAILS, agentEvents: [], centerId: 'demo' });
    }
    if (chemin === '/api/public-booking-meta') {
      return reponse({ ok: true, today: AUJOURD_HUI, durationOptions: [], formules: [], center: { id: 'demo', status: 'active' } });
    }
    if (chemin === '/api/ops' && action === 'centerConfig') return reponse(CONFIG);
    // Le SWITCHER de centre du menu. Sans cette reponse, la console retombait
    // sur sa liste de repli codee en dur et affichait l'enseigne du vrai
    // client dans l'en-tete de la page Marketing.
    if (chemin === '/api/ops' && action === 'menuCenters') {
      return reponse({ ok: true, owner: false, centers: [CENTRE_FICHE] });
    }
    if (chemin === '/api/ops' && action === 'customRequests') {
      return reponse({ ok: true, centerId: CENTRE_ID, customRequests: DEMANDES });
    }
    if (chemin === '/api/ops' && action === 'marketingBrief') return reponse(MARKETING);
    if (chemin === '/api/ops' && action === 'competitors') {
      return reponse({ ok: true, centerId: CENTRE_ID, competitors: CONCURRENTS });
    }
    if (chemin === '/api/ops' && action === 'marketingRoi') {
      var p = MARKETING.paie;
      return reponse({
        ok: true, centerId: CENTRE_ID, days: p.days, revenue: p.euros, conversions: p.venues,
        sent: p.sent, reviewClicks: p.reviewClicks, bySource: p.sources,
      });
    }

    /* Les routes de la page « Emails & relances ». `corps` est le corps d'un
       POST quand il y en a un : l'action d'un POST vit dans le corps et non
       dans l'URL, ce que ce mode ne lisait pas. Toute action non listee
       retombe sur l'accuse de reception generique plus bas : rien ne part au
       reseau, mais un bouton inconnu ne casse pas la page. */
    var cle = action || (corps && corps.action) || '';
    if (chemin === '/api/ops' && cle === 'automationSettings') {
      // Un interrupteur qui ne bouge pas se lit comme une panne. On enregistre
      // le changement EN MEMOIRE : il tient le temps de la visite, et rien ne
      // sort du navigateur.
      if (corps && AUTO_SETTINGS[corps.key]) {
        if (corps.reset) AUTO_SETTINGS[corps.key] = { enabled: AUTO_SETTINGS[corps.key].enabled };
        else {
          if ('enabled' in corps) AUTO_SETTINGS[corps.key].enabled = !!corps.enabled;
          if (corps.subject !== undefined) AUTO_SETTINGS[corps.key].subject = corps.subject;
          if (corps.body !== undefined) AUTO_SETTINGS[corps.key].body = corps.body;
          if (corps.offsetDays !== undefined) AUTO_SETTINGS[corps.key].offsetDays = Number(corps.offsetDays);
          if (corps.cap !== undefined) AUTO_SETTINGS[corps.key].cap = Number(corps.cap);
        }
      }
      return reponse({ ok: true, settings: AUTO_SETTINGS, defaults: AUTO_DEFAULTS, stats: AUTO_STATS });
    }
    if (chemin === '/api/ops' && cle === 'emailTemplates') {
      return reponse({
        ok: true,
        templates: [
          { id: 1, label: 'Devis groupe', subject: 'Votre devis pour {{pax}} personnes', body: 'Bonjour {{prenom}},\n\nVoici notre proposition pour {{pax}} personnes le {{date}}.' },
          { id: 2, label: 'Réponse à une demande de prix', subject: 'Nos tarifs', body: 'Bonjour {{prenom}},\n\nVoici le détail de nos formules.' },
        ],
        identities: [
          { id: 1, label: 'Accueil', email: 'contact@example.be', isDefault: true },
          { id: 2, label: 'Groupes et entreprises', email: 'groupes@example.be' },
        ],
        channel: { resendConfigured: true, aiConfigured: true },
      });
    }
    if (chemin === '/api/ops' && cle === 'emailBrain') {
      return reponse({
        ok: true,
        overrides: { faq: {}, signature: 'L’équipe ' + CENTRE, extra: '' },
        defaults: {
          intents: { reservation: 'Réservation', annulation: 'Annulation / report', anniversaire: 'Anniversaire', prix: 'Prix & tarifs', horaires: 'Horaires', reclamation: 'Réclamation', autre: 'Autre' },
          faq: {
            horaires: { subject: 'Nos horaires', body: 'Ouvert de 10 h à 23 h, sept jours sur sept.' },
            anniversaire: { subject: 'Les anniversaires', body: 'Formule anniversaire à partir de 8 enfants, piste réservée, boisson et gâteau compris.' },
          },
          signature: 'L’équipe ' + CENTRE,
        },
      });
    }
    if (chemin === '/api/ops' && cle === 'customSequences') {
      return reponse({
        ok: true, sequences: [],
        limits: {
          maxSequences: 10, cap: [1, 100],
          triggers: {
            after_visit: { label: 'X jours après une visite', days: [1, 90], variables: ['prenom', 'centre'] },
            before_visit: { label: 'X jours avant une venue prévue', days: [1, 60], variables: ['prenom', 'centre', 'date', 'heure', 'formule', 'pax'] },
            inactive: { label: 'Clients plus vus depuis X jours', days: [30, 365], variables: ['prenom', 'centre'] },
            weekly: { label: 'Chaque semaine, un jour fixe', variables: ['prenom', 'centre'] },
          },
          segments: { all: 'Tous les clients avec email', dormant: 'Dormants (+90 jours)', loyal: 'Fidèles', birthdays: 'Clients anniversaire' },
        },
      });
    }
    if (chemin === '/api/ops' && cle === 'communications') {
      return reponse({ ok: true, centerId: 'demo', communications: TOUS_MAILS });
    }
    if (chemin === '/api/ops' && cle === 'relanceStats') {
      // Le retour d'une relance : combien sont revenus, et ce que ca a rapporte.
      var revenus = Math.round(AUTO_STATS.post_visit.sent30d * 0.11);
      return reponse({
        ok: true, centerId: 'demo', days: 90,
        sent: AUTO_STATS.post_visit.sent30d * 3, returned: revenus * 3,
        revenue: revenus * 3 * 84, rate: 0.11,
      });
    }
    if (chemin === '/api/ops' && cle === 'suppressions') {
      return reponse({ ok: true, centerId: 'demo', suppressions: [], total: 0 });
    }
    // Le plan des 8 semaines (POST, l'action vit dans le corps). Sans lui,
    // l'onglet Plan de la page Marketing affichait « Pas encore de plan » et
    // son seul bouton lancait une construction qui ne pouvait pas aboutir.
    if (chemin === '/api/ops' && cle === 'marketingPlanGet') {
      return reponse({ ok: true, centerId: CENTRE_ID, plan: PLAN });
    }
    /* L'ATELIER : « Generer le pack » rend un pack ECRIT D'AVANCE, pose ici.
       Il n'y a aucun modele derriere une page publique, et c'est dit a
       l'ecran : `generationMode: 'template'` fait afficher « modele maison
       (filet) » au lieu de « ecrit par l'IA ». Sans cette reponse, le bouton
       tournait puis ne rendait rien : un clic mort au milieu du seul ecran
       ouvert avec le planning. */
    if (chemin === '/api/ops' && cle === 'studioGenerate') {
      var reseau = (corps && corps.platform) || 'facebook';
      return reponse({ ok: true, pack: paquetAtelier(reseau) });
    }
    if (chemin === '/api/ops' && cle === 'studioPacks') {
      return reponse({ ok: true, packs: {} });
    }

    return reponse({
      ok: true, centerId: 'demo', reservations: [], communications: [], samples: [], suggestions: [],
      events: [], agents: [], blocks: [], clients: [], centers: [], entries: [],
    });
  }

  // COUPURE DU RESEAU. On ne filtre pas : on remplace. Aucun appel /api/ ne
  // quitte le navigateur en mode demonstration.
  var fetchNatif = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (entree, options) {
    var brut = typeof entree === 'string' ? entree : (entree && entree.url) || '';
    var u;
    try { u = new URL(brut, window.location.origin); } catch (error) { u = null; }
    if (u && u.pathname.indexOf('/api/') === 0) {
      // L'action d'un POST vit dans son CORPS, pas dans l'URL. Sans cette
      // lecture, tout POST retombait sur la reponse generique : un interrupteur
      // de sequence se rearmait tout seul a l'ecran suivant.
      var corps = null;
      try { if (options && options.body) corps = JSON.parse(options.body); } catch (error) { corps = null; }
      return Promise.resolve(repondre(u.pathname, u.searchParams.get('action'), corps));
    }
    return fetchNatif ? fetchNatif(entree, options) : Promise.reject(new Error('reseau indisponible'));
  };

  // XMLHttpRequest aussi : un seul chemin oublie suffirait a faire sortir une
  // requete vers l'API depuis une page publique.
  var ouvrirNatif = window.XMLHttpRequest && window.XMLHttpRequest.prototype.open;
  if (ouvrirNatif) {
    window.XMLHttpRequest.prototype.open = function (methode, adresse) {
      if (String(adresse || '').indexOf('/api/') !== -1) {
        arguments[1] = 'data:application/json,' + encodeURIComponent('{"ok":true}');
      }
      return ouvrirNatif.apply(this, arguments);
    };
  }

  // LA TROISIEME PORTE, celle qu'on oublie. `navigator.sendBeacon` est un envoi
  // en tache de fond : il ne passe ni par `fetch` ni par `XMLHttpRequest`, donc
  // les deux coupures ci-dessus ne le voient pas. Aucun code du produit ne
  // l'utilise aujourd'hui - c'est justement pour ca qu'il faut le fermer
  // maintenant : le jour ou un module d'analytique l'ajoutera, personne ne se
  // souviendra que la page /demo est publique.
  var beaconNatif = window.navigator && window.navigator.sendBeacon
    ? window.navigator.sendBeacon.bind(window.navigator) : null;
  if (beaconNatif) {
    window.navigator.sendBeacon = function (adresse, donnees) {
      var u;
      try { u = new URL(String(adresse || ''), window.location.origin); } catch (error) { u = null; }
      if (u && u.pathname.indexOf('/api/') === 0) return true;  // accepte, n'envoie rien
      return beaconNatif(adresse, donnees);
    };
  }

  /* COUPURE DU STOCKAGE, pour la meme raison que la coupure du reseau.
     Trouve le 2026-08-08 en instrumentant le serveur de test : la
     demonstration ecrivait sa session bidon dans `funGalaxy_auth_v1`, la VRAIE
     cle du produit, sur le VRAI domaine. Deux consequences, aucune theorique :
       - un membre du staff du client qui ouvre /demo par curiosite voyait sa
         session remplacee par `token: 'demo'` : il etait DECONNECTE de sa
         console, et son poste repartait ensuite interroger l'API avec un
         jeton mort ;
       - la meme session survivait a la sortie de /demo : les pages reelles
         visitees ensuite (/, /reserver) emettaient des appels /api/staff-auth
         et /api/staff-state pour le compte d'un utilisateur qui n'existe pas.
     On ne nettoie donc pas apres coup, on ISOLE : sur /demo, le stockage local
     et de session sont remplaces par une memoire vive. La demonstration lit et
     ecrit ce qu'elle veut, personne d'autre n'en voit rien, et elle ne peut
     rien lire de ce qu'un utilisateur reel avait enregistre. */
  function memoireVive() {
    var boite = Object.create(null);
    var faux = {
      getItem: function (cle) {
        cle = String(cle);
        return Object.prototype.hasOwnProperty.call(boite, cle) ? boite[cle] : null;
      },
      setItem: function (cle, valeur) { boite[String(cle)] = String(valeur); },
      removeItem: function (cle) { delete boite[String(cle)]; },
      clear: function () { boite = Object.create(null); },
      key: function (i) { return Object.keys(boite)[i] || null; },
    };
    try {
      Object.defineProperty(faux, 'length', { get: function () { return Object.keys(boite).length; } });
    } catch (error) { faux.length = 0; }
    return faux;
  }
  function isoler(nom) {
    try {
      Object.defineProperty(window, nom, { configurable: true, value: memoireVive() });
      return true;
    } catch (error) {
      // Navigateur qui refuse la redefinition : on ne peut pas isoler, donc on
      // ne pollue pas non plus. La session vit alors en memoire seule (voir
      // plus bas) et l'application retombera sur le faux reseau.
      return false;
    }
  }
  var stockageIsole = isoler('localStorage');
  isoler('sessionStorage');

  try {
    // Le navigateur a refuse l'isolation : la demonstration doit quand meme
    // fonctionner, donc on ecrit dans le stockage reel comme avant - mais on
    // note ce qu'on ecrase et on le REND en quittant la page. Un membre du
    // staff ne peut plus perdre sa session en visitant la demonstration.
    if (!stockageIsole) {
      var avant = window.localStorage.getItem('funGalaxy_auth_v1');
      window.addEventListener('pagehide', function () {
        try {
          if (avant === null) window.localStorage.removeItem('funGalaxy_auth_v1');
          else window.localStorage.setItem('funGalaxy_auth_v1', avant);
        } catch (error) { /* rien de plus a tenter */ }
      });
    }
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(SESSION));
  } catch (error) { /* stockage refuse */ }

  /* ---- L'habillage --------------------------------------------------------
     LA BARRE LATERALE EST RENDUE (2026-08-13). Elle etait eteinte depuis le
     2026-07-29, quand la demonstration vivait dans un cadre de 640 px sur la
     vitrine. Ce cadre n'existe plus : la vitrine envoie vers `/demo` en pleine
     page, et un prospect a qui on promet « Entrer dans l'outil » doit voir
     l'outil, pas un ecran isole. Les onze entrees sont donc la, cliquables ;
     neuf d'entre elles menent a une invitation (voir INVITATIONS).

     Ce qui reste cache, et pourquoi :
       - l'en-tete du SITE (logo et liens du tunnel client) : il porte l'enseigne
         du vrai client et pointe vers son site. La barre laterale vit DANS cette
         balise `<header>`, on ne cache donc que les autres enfants ;
       - la deconnexion : il n'y a pas de session a quitter, le bouton ne
         pourrait que casser la demonstration. */
  var style = document.createElement('style');
  style.textContent = [
    'body.pinlane-demo header > *:not(.ops-sidebar) { display: none !important; }',
    'body.pinlane-demo #logoutBtn { display: none !important; }',
    /* LE MODE FILM garde l'habillage minimal d'avant : cadre etroit, chrome
       retire, on ne montre que la grille qui se remplit. */
    FILM ? 'body.pinlane-demo .ops-sidebar { display: none !important; }' : '',
    FILM ? 'body.pinlane-demo .staff-head, body.pinlane-demo .kpi-grid, body.pinlane-demo .staff-resource-tabs, body.pinlane-demo .pv2-bar { display: none !important; }' : '',
    FILM ? 'body.pinlane-demo .pv2-shell { padding-top: 0 !important; }' : '',
    FILM ? 'body.pinlane-demo .staff-wrap > *:first-child { margin-top: 0 !important; }' : '',
    FILM ? 'body.pinlane-demo { --fgx-sidebar-width: 0px !important; }' : '',
    FILM ? 'body.pinlane-demo .staff-wrap, body.pinlane-demo main { padding-left: 0 !important; margin-left: 0 !important; }' : '',
    /* Le bandeau fixe mange le bas de l'ecran : sans cette reserve, la derniere
       ligne d'un tableau finit dessous et on la croit coupee. */
    'body.pinlane-demo .staff-wrap { padding-bottom: 72px; }',
    'body.pinlane-demo { overflow-x: hidden; }',
    /* AUCUN CODE D'ACCES EN DEMONSTRATION. La session bidon est deja posee et
       le faux reseau repond « authentifie » : l'ecran de connexion ne devrait
       jamais s'armer. Mais `hasSavedAuth()` lit le stockage local, et un
       navigateur en navigation privee ou une iframe cloisonnee peuvent le
       refuser : la console s'ouvrirait alors sur une demande de code, dans une
       vitrine. Cette regle ferme le cas, elle ne remplace pas la session. */
    'body.pinlane-demo #authOverlay { display: none !important; }',
    'body.pinlane-demo.auth-locked { overflow: auto !important; }',

    /* ---- LE BANDEAU DE DEMONSTRATION -----------------------------------
       Le visiteur doit savoir, a chaque seconde et sans avoir a le deviner,
       que les chiffres sous ses yeux sont fabriques. Un bandeau qui defile
       hors de l'ecran ne dit rien a celui qui arrive au milieu de la page :
       il est donc FIXE, en bas, discret, et il porte le chemin du retour. */
    '.pl-demo-bandeau { position: fixed; z-index: 2147483000; left: 50%; bottom: 14px;',
    '  transform: translateX(-50%); display: flex; align-items: center; gap: 10px;',
    '  max-width: calc(100vw - 24px); padding: 7px 8px 7px 14px;',
    '  border: 1px solid var(--line-strong, #d9d9d9); border-radius: var(--radius-full, 9999px);',
    '  background: var(--surface, #fff); box-shadow: var(--shadow-overlay, 0 8px 30px rgba(0,0,0,.12));',
    '  font-family: var(--font-ui, system-ui, sans-serif); font-size: 12.5px; line-height: 1.35;',
    '  color: var(--text, #0a0a0a); }',
    '.pl-demo-bandeau b { font-weight: 600; }',
    '.pl-demo-bandeau .pl-demo-pt { width: 7px; height: 7px; flex: 0 0 7px; border-radius: 50%;',
    '  background: var(--warning, #a35200); }',
    '.pl-demo-bandeau .pl-demo-tx { min-width: 0; }',
    '.pl-demo-bandeau .pl-demo-tx span { color: var(--muted, #666); }',
    '.pl-demo-bandeau a { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap;',
    '  padding: 6px 12px; border-radius: var(--radius-full, 9999px); text-decoration: none;',
    '  background: var(--text, #0a0a0a); color: var(--page, #fafafa); font-weight: 600;',
    '  transition: opacity 150ms cubic-bezier(.4,0,.2,1); }',
    '.pl-demo-bandeau a:hover { opacity: .82; }',
    '.pl-demo-bandeau a:focus-visible { outline: 2px solid var(--accent, #0070f3); outline-offset: 2px; }',
    /* Sur telephone la pilule devient une barre pleine largeur : a 375 px, une
       pilule centree de contenu variable deborde. */
    '@media (max-width: 620px) { .pl-demo-bandeau { left: 8px; right: 8px; bottom: 8px;',
    '  transform: none; max-width: none; border-radius: var(--radius-lg, 12px); font-size: 12px; } }',

    /* ---- L'ECRAN D'INVITATION ------------------------------------------
       C'est l'ecran le PLUS VU de la demonstration : neuf entrees de menu sur
       onze y menent. Il est donc traite comme une page du produit, avec ses
       jetons, sa hierarchie et son silence, et non comme un panneau d'erreur.
       Aucune couleur en dur : toutes les valeurs sont des jetons du design
       system, avec un repli seulement pour le cas ou la feuille n'est pas
       encore chargee. */
    '.pl-invit { max-width: 720px; margin: 0 auto; padding: 56px 24px 40px;',
    '  font-family: var(--font-ui, system-ui, sans-serif); color: var(--text, #0a0a0a);',
    '  animation: pl-invit-in 320ms cubic-bezier(.16,1,.3,1) both; }',
    '@keyframes pl-invit-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }',
    '@media (prefers-reduced-motion: reduce) { .pl-invit { animation: none; } }',
    '.pl-invit-kicker { display: inline-flex; align-items: center; gap: 7px; margin: 0 0 14px;',
    '  font-size: 11px; font-weight: 600; letter-spacing: .09em; text-transform: uppercase;',
    '  color: var(--muted, #666); }',
    '.pl-invit-kicker i { width: 6px; height: 6px; border-radius: 50%; background: var(--accent, #0070f3);',
    '  display: inline-block; }',
    '.pl-invit h1 { margin: 0 0 12px; font-size: clamp(26px, 4vw, 34px); line-height: 1.15;',
    '  font-weight: 650; letter-spacing: -.02em; }',
    '.pl-invit-lede { margin: 0 0 30px; font-size: 16px; line-height: 1.55; color: var(--muted, #666);',
    '  max-width: 58ch; }',
    '.pl-invit-liste { list-style: none; margin: 0 0 30px; padding: 0;',
    '  border-top: 1px solid var(--line, #e6e6e6); }',
    '.pl-invit-liste li { display: flex; gap: 12px; align-items: baseline; padding: 13px 2px;',
    '  border-bottom: 1px solid var(--line, #e6e6e6); font-size: 14.5px; line-height: 1.5; }',
    '.pl-invit-liste li::before { content: ""; flex: 0 0 5px; width: 5px; height: 5px; margin-top: 8px;',
    '  border-radius: 50%; background: var(--line-strong, #c9c9c9); }',
    '.pl-invit-pourquoi { margin: 0 0 28px; padding: 16px 18px; font-size: 14px; line-height: 1.55;',
    '  border-radius: var(--radius-lg, 12px); background: var(--surface-2, #f6f6f6);',
    '  color: var(--text, #0a0a0a); max-width: 60ch; }',
    '.pl-invit-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 14px; }',
    '.pl-invit-cta { display: inline-flex; align-items: center; gap: 9px; padding: 12px 20px;',
    '  border-radius: var(--radius-full, 9999px); text-decoration: none; font-size: 14.5px;',
    '  font-weight: 600; background: var(--text, #0a0a0a); color: var(--page, #fafafa);',
    '  transition: opacity 150ms cubic-bezier(.4,0,.2,1); }',
    '.pl-invit-cta:hover { opacity: .84; }',
    '.pl-invit-cta:focus-visible { outline: 2px solid var(--accent, #0070f3); outline-offset: 3px; }',
    '.pl-invit-retour { background: none; border: 0; padding: 6px 2px; cursor: pointer;',
    '  font: inherit; font-size: 14px; color: var(--muted, #666); text-decoration: underline;',
    '  text-underline-offset: 3px; }',
    '.pl-invit-retour:hover { color: var(--text, #0a0a0a); }',
    '.pl-invit-retour:focus-visible { outline: 2px solid var(--accent, #0070f3); outline-offset: 3px;',
    '  border-radius: 4px; }',
    '@media (max-width: 620px) { .pl-invit { padding: 34px 18px 32px; } }',
  ].join('\n');
  // L'enseigne du client vit AUSSI dans le gabarit : le titre de l'onglet, le
  // logo, les liens de navigation du site public. Les masquer ne suffit pas -
  // le titre s'affiche dans l'onglet du navigateur, et le texte alternatif se
  // lit a la synthese vocale. On les remplace.
  // `state` est declare en const au niveau du script de l application : il est
  // global, mais PAS une propriete de window (aucun let/const de haut niveau ne
  // l'est). `window.state` valait donc undefined, et les injections partaient
  // dans le vide sans lever la moindre erreur. On le resout par son nom.
  function etatApp() {
    try { return (typeof state !== 'undefined' && state) ? state : null; } catch (error) { return null; }
  }
  function neutraliserPage() {
    document.title = 'Pinlane · démonstration';
    [].forEach.call(document.querySelectorAll('img[alt]'), function (img) {
      var alt = img.getAttribute('alt') || '';
      if (A_NETTOYER.test(alt)) img.setAttribute('alt', CENTRE);
    });
    var marcheur = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    var noeud = marcheur.nextNode();
    while (noeud) {
      var brut = noeud.nodeValue;
      if (A_NETTOYER.test(brut)) {
        var propre = anonymiser(brut);
        if (propre !== brut) noeud.nodeValue = propre;
      }
      noeud = marcheur.nextNode();
    }
  }

  /* ---- LE BANDEAU : « ce que vous voyez est fabrique » --------------------
     Le mode demonstration montre la VRAIE console : c'est sa force, et c'est
     exactement pourquoi il doit se declarer. Un prospect qui prend ces
     reservations pour de vraies donnees de client se croit devant une fuite ;
     un prospect qui les prend pour les siennes cherche ses chiffres. Le
     bandeau est FIXE (il ne defile pas hors de l'ecran), il tient sur une
     ligne, et il porte le seul lien de la page : le retour vers la vitrine.
     Il est repose a chaque mutation du corps : un rendu de l'application ne
     peut pas le faire disparaitre sans qu'il revienne. */
  var ID_BANDEAU = 'pinlaneDemoBadge';
  function poserBandeau() {
    if (!document.body || document.getElementById(ID_BANDEAU)) return;
    var barre = document.createElement('div');
    barre.id = ID_BANDEAU;
    barre.className = 'pl-demo-bandeau';
    // `status` et non `alert` : l'information est permanente et non urgente,
    // un lecteur d'ecran ne doit pas etre interrompu a chaque rendu.
    barre.setAttribute('role', 'status');
    var pastille = document.createElement('i');
    pastille.className = 'pl-demo-pt';
    pastille.setAttribute('aria-hidden', 'true');
    var texte = document.createElement('div');
    texte.className = 'pl-demo-tx';
    var fort = document.createElement('b');
    fort.textContent = 'Démonstration.';
    var suite = document.createElement('span');
    suite.textContent = ' Données fabriquées, ' + CENTRE + ' n’existe pas. Rien n’est enregistré.';
    texte.appendChild(fort);
    texte.appendChild(suite);
    var lien = document.createElement('a');
    lien.href = 'https://pinlane.be/';
    lien.textContent = 'Retour sur pinlane.be';
    // La demonstration peut etre embarquee dans un cadre : le retour doit
    // sortir du cadre, pas recharger la vitrine a l'interieur du produit.
    lien.target = '_top';
    lien.rel = 'noopener';
    barre.appendChild(pastille);
    barre.appendChild(texte);
    barre.appendChild(lien);
    document.body.appendChild(barre);
  }

  /* ========================================================================
     L'ECRAN D'INVITATION : la porte fermee qui donne envie d'entrer.
     ========================================================================
     Comment il s'installe, et pourquoi ainsi. La console range chaque page
     dans son propre conteneur (`#staffDashboardPage`, `#staffClientsPage`...)
     et `renderStaffShell` decide lequel est visible. On monte donc un DOUZIEME
     conteneur, frere des autres, et on intercepte `renderStaff` : sur une page
     fermee, la page produit n'est pas rendue DU TOUT.

     Ce choix est deliberement plus fort qu'un voile pose par-dessus :
       - aucune donnee de la page fermee n'est calculee, donc rien a deviner
         derriere un flou, et aucun chargement inutile ;
       - le menu, lui, reste exact : `state.staffMenuPage` porte bien la page
         demandee, donc l'entree cliquee s'allume comme dans le vrai produit.
     Rien ne piege le visiteur : pas de compte a rebours, pas de fenetre
     modale, et un lien de retour vers la partie ouverte. */
  var ID_INVITATION = 'pinlaneDemoInvite';
  var CONTENEURS_PAGE = ['staffDashboardPage', 'staffClientsPage', 'staffReservationsPage',
    'staffPricingPage', 'staffEmailsPage', 'staffCockpitPage', 'staffCampaignsPage', 'staffUtilityPage'];
  var CHROME_PLANNING = ['.staff-head', '.kpi-grid', '.staff-resource-tabs', '#planningBox',
    '#laserPlanningBox', '.table-box'];
  var invitationActive = '';

  function hoteInvitation() {
    var enveloppe = document.querySelector('#staffView .staff-wrap');
    if (!enveloppe) return null;
    var hote = document.getElementById(ID_INVITATION);
    if (!hote) {
      hote = document.createElement('div');
      hote.id = ID_INVITATION;
      hote.setAttribute('tabindex', '-1');
      enveloppe.insertBefore(hote, enveloppe.firstChild);
    }
    return hote;
  }

  function masquerPagesProduit(masquer) {
    CONTENEURS_PAGE.forEach(function (id) {
      var el = document.getElementById(id);
      if (!el || !masquer) return;
      if (!el.classList.contains('hidden')) el.classList.add('hidden');
      el.setAttribute('aria-hidden', 'true');
      el.setAttribute('inert', '');
    });
    CHROME_PLANNING.forEach(function (sel) {
      [].forEach.call(document.querySelectorAll('#staffView ' + sel), function (el) {
        if (masquer && !el.classList.contains('hidden')) el.classList.add('hidden');
      });
    });
  }

  function echapper(texte) {
    return String(texte).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function peindreInvitation(page) {
    var invit = invitationDe(page);
    var hote = hoteInvitation();
    if (!invit || !hote) return false;
    if (invitationActive !== page) {
      hote.innerHTML = '<section class="pl-invit" role="region" aria-label="Section ouverte pendant l’appel">'
        + '<p class="pl-invit-kicker"><i aria-hidden="true"></i>Sur rendez-vous</p>'
        + '<h1>' + echapper(invit.titre) + '</h1>'
        + '<p class="pl-invit-lede">Cette section existe et elle tourne. On l’ouvre avec vous, branchée sur les données de votre centre, pendant un appel de vingt minutes.</p>'
        + '<ul class="pl-invit-liste">'
        + invit.quoi.map(function (l) { return '<li>' + echapper(l) + '</li>'; }).join('')
        + '</ul>'
        + '<p class="pl-invit-pourquoi">' + echapper(invit.pourquoi) + '</p>'
        + '<div class="pl-invit-actions">'
        + '<a class="pl-invit-cta" href="' + LIEN_APPEL + '" target="_top" rel="noopener">Réserver l’appel de vingt minutes</a>'
        + '<button type="button" class="pl-invit-retour" data-pl-invit-retour>Continuer sur le planning</button>'
        + '</div>'
        + '</section>';
      var retour = hote.querySelector('[data-pl-invit-retour]');
      if (retour) {
        retour.addEventListener('click', function () {
          if (typeof window.openStaffMenuPage === 'function') window.openStaffMenuPage('planning');
        });
      }
      invitationActive = page;
    }
    hote.hidden = false;
    masquerPagesProduit(true);
    return true;
  }

  function retirerInvitation() {
    invitationActive = '';
    var hote = document.getElementById(ID_INVITATION);
    if (hote && !hote.hidden) { hote.hidden = true; hote.innerHTML = ''; }
  }

  /* L'INTERCEPTION. `renderStaff` est une declaration de fonction au niveau du
     script de l'application : sa liaison globale EST `window.renderStaff`, donc
     la remplacer ici detourne aussi les appels internes du produit. C'est le
     seul point de passage : toute ouverture de page finit par la
     (`openStaffMenuPage`, la route par fragment, le retour arriere). */
  var interceptionPosee = false;
  function poserInterception() {
    if (interceptionPosee || typeof window.renderStaff !== 'function') return;
    var natif = window.renderStaff;
    window.renderStaff = function () {
      var etat = etatApp();
      var page = etat ? etat.staffMenuPage : '';
      if (estFerme(page) && peindreInvitation(page)) {
        if (typeof window.renderStaffMenu === 'function') {
          try { window.renderStaffMenu(); } catch (error) { /* menu pas pret */ }
        }
        return undefined;
      }
      retirerInvitation();
      return natif.apply(this, arguments);
    };
    interceptionPosee = true;
  }

  // L'application decide elle-meme de sa vue au demarrage (hash, session,
  // detection du mode client). Poser la vue une seule fois au DOMContentLoaded
  // arrivait AVANT cette decision : la demonstration s'ouvrait sur le parcours
  // de reservation client au lieu du planning. On insiste donc jusqu'a ce que
  // la vue staff tienne, puis on arrete - au maximum deux secondes.
  function forcerVueStaff() {
    var essais = 0;
    var horloge = setInterval(function () {
      essais += 1;
      try {
        var etat = etatApp();
        if (etat) {
          etat.staffTheme = 'light';
          etat.staffMenuPage = PAGE;
          etat.view = 'staff';
          etat.currentDate = AUJOURD_HUI;
          // LES DONNEES SONT POSEES DANS L'ETAT, pas seulement servies par le
          // faux reseau. L'application vide `state.reservations` au chargement
          // (les reservations appartiennent au serveur depuis le 2026-07-28) et
          // les repeuple par un sondage : sur une page publique ou ce sondage
          // n'a pas de vraie source, le planning restait desesperement vide.
          if (!Array.isArray(etat.reservations) || etat.reservations.length !== DEMO.length) {
            etat.reservations = DEMO.slice();
          }
          if (etat.laneStatuses) {
            Object.keys(etat.laneStatuses).forEach(function (k) { etat.laneStatuses[k] = 'active'; });
          }
        }
        document.documentElement.setAttribute('data-theme', 'light');
        if (typeof window.setView === 'function') window.setView('staff');
        if (typeof window.renderStaff === 'function') window.renderStaff();
        neutraliserPage();
      } catch (error) { /* l application n est pas encore prete */ }
      var vueStaff = document.body.classList.contains('staff-mode');
      if ((vueStaff && essais > 2) || essais > 20) clearInterval(horloge);
    }, 100);
  }

  /* ---- LA MISE EN SCENE ---------------------------------------------------
     Le produit ne doit pas apparaitre DEJA REMPLI : un planning fige ne prouve
     pas qu'un planning vit. Les reservations se posent une par une, comme si la
     journee se remplissait sous les yeux du visiteur, puis la demonstration
     passe a la page suivante et recommence.

     Tout se joue dans l'APPLICATION REELLE : ce sont ses vrais composants, ses
     vraies couleurs, son vrai planning. Aucune maquette ne peut faire ca.

     `?loop=1` (pose par la vitrine) active l'enchainement. Sans lui, /demo
     reste une page normale qu'on peut explorer a la main. */
  var SUITE = ['planning', 'reservations', 'clients', 'campaigns'];
  var DUREE_PAGE = 9000;
  var minuteries = [];
  function plusTard(fn, delai) { minuteries.push(setTimeout(fn, delai)); }
  function stopScene() { minuteries.forEach(clearTimeout); minuteries = []; }

  function rendre() {
    try { if (typeof window.renderStaff === 'function') window.renderStaff(); } catch (error) { /* pas pret */ }
  }

  function remplirProgressivement(etat) {
    if (!etat) return;
    etat.reservations = [];
    rendre();
    DEMO.forEach(function (resa, i) {
      plusTard(function () {
        etat.reservations = DEMO.slice(0, i + 1);
        rendre();
      }, 260 + i * 230);
    });
  }

  function scene(index) {
    stopScene();
    var etat = etatApp();
    if (!etat) { plusTard(function () { scene(index); }, 300); return; }
    var page = SUITE[index % SUITE.length];
    etat.staffMenuPage = page;
    // Le planning est le seul ecran ou le remplissage progressif raconte
    // quelque chose : ailleurs, la donnee est posee et c'est la page qui parle.
    if (page === 'planning') remplirProgressivement(etat);
    else { etat.reservations = DEMO.slice(); rendre(); }
    plusTard(function () { scene(index + 1); }, DUREE_PAGE);
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.body.classList.add('pinlane-demo');
    document.head.appendChild(style);
    neutraliserPage();
    poserBandeau();
    // Le forcage attend `load` : les scripts DIFFERES (staff-pages-v2 et les
    // modules de page) ne sont pas encore executes au DOMContentLoaded, et
    // renderStaff() appelait alors une fonction inexistante - erreur reelle
    // constatee en ligne sur la page Reservations.
    if (document.readyState === 'complete') demarrer();
    else window.addEventListener('load', demarrer);

    function demarrer() {
      // L'interception AVANT le forcage : sans elle, un premier rendu d'une
      // page fermee passerait avant qu'on ne la couvre.
      poserInterception();
      forcerVueStaff();
      // La pastille « 2 » de l'entree Clients. Le compteur ne se charge que
      // depuis la page Clients, qui est fermee : sans ce coup de pouce, le
      // menu resterait muet alors que deux demandes attendent vraiment dans le
      // faux reseau, et l'invitation promettrait un chiffre invisible.
      setTimeout(function () {
        try { if (typeof window.loadStaffCustomRequests === 'function') window.loadStaffCustomRequests(true); }
        catch (error) { /* pas pret : la pastille restera vide, rien de casse */ }
      }, 1200);
      // La mise en scene attend que la vue staff tienne : lancee trop tot, elle
      // ecrivait dans un etat que le demarrage de l'application ecrasait juste
      // apres.
      if (FILM) setTimeout(function () { scene(0); }, 1400);
    }
    // Un rendu ulterieur peut reintroduire un libelle, ou remplacer un sous
    // arbre qui emporte le bandeau : on surveille les deux. `poserBandeau` ne
    // fait rien quand le bandeau est deja la, donc l'observateur ne peut pas
    // se declencher lui-meme en boucle.
    // L'invitation est reposee par le meme chemin : `renderStaffShell` peut
    // etre appele SANS passer par `renderStaff` (le menu, un rechargement de
    // donnees) et re-afficherait le conteneur de la page fermee dessous.
    new MutationObserver(function () {
      neutraliserPage();
      poserBandeau();
      poserInterception();
      if (invitationActive) masquerPagesProduit(true);
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
}());

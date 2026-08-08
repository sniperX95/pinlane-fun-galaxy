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
  var NOMS = ['Famille Dubois', 'Anniversaire Lucas', 'Team building Nexo', 'Groupe amis', 'Sarah Lemaire',
    'Ecole Saint-Joseph', 'Famille Martin', 'EVJF Camille', 'Club Padel', 'Famille Rousseau',
    'Duo Verhaegen', 'Soiree ligue', 'Famille Nowak', 'Anniversaire Lea', 'Groupe Vandenberg',
    'CE Delhaize', 'Famille Moreau', 'Anniversaire Noah', 'Team Proximus', 'Club Ath',
    'Anniversaire Jade', 'Famille Petit', 'Amis Charleroi', 'Anniversaire Tom', 'Famille Renard',
    'Scouts Libramont', 'Team Engie', 'Famille Collin', 'Anniversaire Ines', 'Groupe Bastogne',
    'Famille Gerard', 'CE Carrefour', 'Amis Marche', 'Anniversaire Hugo', 'Famille Simon',
    'Club Neufchateau', 'Famille Leroy', 'Anniversaire Manon'];

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
  var NOMS_SANS_PISTE = ['Anniversaire Zoe', 'Team Solvay', 'Amis Namur', 'Groupe Ciney',
    'Anniversaire Malo', 'Ecole des Roches', 'EVG Thomas', 'Famille Bastin',
    'Club Arlon', 'Anniversaire Livia'];

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
        phone: '+32 470 00 00 00',
        email: 'contact@example.be',
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
        phone: '+32 470 00 00 00',
        email: 'contact@example.be',
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

  // Toute enseigne de client qui traverserait ce mode est remplacee a la
  // source, y compris au fond des objets de configuration.
  function neutraliser(valeur) {
    if (typeof valeur === 'string') return valeur.replace(/fun\s*galaxy/gi, CENTRE);
    if (Array.isArray(valeur)) return valeur.map(neutraliser);
    if (valeur && typeof valeur === 'object') {
      var sortie = {};
      Object.keys(valeur).forEach(function (cle) { sortie[cle] = neutraliser(valeur[cle]); });
      return sortie;
    }
    return valeur;
  }

  var CONFIG = {
    ok: true,
    centerId: 'demo',
    config: {
      identity: { name: CENTRE, city: 'Libramont', phone: '+32 61 00 00 00', email: 'contact@example.be' },
      resources: { lanes: 8, laserZones: 2 },
      hours: { open: '10:00', close: '23:00' },
    },
  };

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
  var courriel = function (nom) {
    return nom.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '') + '@example.be';
  };

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

  /* ---- L'habillage : on montre le PRODUIT, pas la navigation interne ------ */
  var style = document.createElement('style');
  style.textContent = [
    /* La barre laterale et l'en-tete du site n'ont rien a faire dans une
       vitrine : le prospect regarde le planning, pas le menu du logiciel. */
    'body.pinlane-demo .ops-sidebar, body.pinlane-demo header, body.pinlane-demo #logoutBtn { display: none !important; }',
    /* JUSTE LE PLANNING (demande de Movsar, 2026-07-29). Le cadre de la vitrine
       fait 640 px : le titre de page, les quatre cartes de chiffres et les
       onglets de ressource mangeaient 480 px, et le prospect voyait deux lignes
       de grille. On ne garde que ce qu'on est venu montrer.
       Effet de bord assume et souhaitable : le « taux d'occupation » sort de la
       vitrine tant que son calcul n'est pas corrige (813 % affiches pour 13
       reservations sur 8 pistes). */
    'body.pinlane-demo .staff-head, body.pinlane-demo .kpi-grid, body.pinlane-demo .staff-resource-tabs { display: none !important; }',
    /* Les pages refondues (Reservations, Clients, Marketing) portent leur titre
       dans .pv2-bar : meme regle, on ne garde que le contenu utile. */
    'body.pinlane-demo .pv2-bar { display: none !important; }',
    'body.pinlane-demo .pv2-shell { padding-top: 0 !important; }',
    'body.pinlane-demo .staff-wrap > *:first-child { margin-top: 0 !important; }',
    'body.pinlane-demo { --fgx-sidebar-width: 0px !important; }',
    'body.pinlane-demo .staff-wrap, body.pinlane-demo main { padding-left: 0 !important; margin-left: 0 !important; }',
    /* Une demonstration ne se defile pas toute seule dans son cadre : la
       hauteur remonte au site hote (voir l emetteur de app-main.js). */
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
      if (/fun\s*galaxy/i.test(img.getAttribute('alt') || '')) img.setAttribute('alt', CENTRE);
    });
    var marcheur = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    var noeud = marcheur.nextNode();
    while (noeud) {
      if (/fun\s*galaxy/i.test(noeud.nodeValue)) noeud.nodeValue = noeud.nodeValue.replace(/fun\s*galaxy/gi, CENTRE);
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
      forcerVueStaff();
      // La mise en scene attend que la vue staff tienne : lancee trop tot, elle
      // ecrivait dans un etat que le demarrage de l'application ecrasait juste
      // apres.
      if (params.get('loop') === '1') setTimeout(function () { scene(0); }, 1400);
    }
    // Un rendu ulterieur peut reintroduire un libelle, ou remplacer un sous
    // arbre qui emporte le bandeau : on surveille les deux. `poserBandeau` ne
    // fait rien quand le bandeau est deja la, donc l'observateur ne peut pas
    // se declencher lui-meme en boucle.
    new MutationObserver(function () {
      neutraliserPage();
      poserBandeau();
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
}());

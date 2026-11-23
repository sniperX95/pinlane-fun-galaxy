// LE PLANNING COMPLET : LE GRAND TABLEAU DU JOUR (2026-11-02, v5 ; v6 le 2026-11-03).
//
// Movsar, 02/11, devant la file d action : « ah non je preferais large en mode
// planning mais en bcp mieux fait ». LA FEUILLE RESTE, EN GRAND ET BORD A BORD :
//   - les demi-heures deviennent des blocs, comme sur le papier : une grande case
//     d heure couvre toutes les lignes de sa demi-heure et dit ce qui arrive ;
//     il n y a plus de ligne d en-tete, une heure pas pile reste sur sa ligne ;
//   - toute la journee d un seul tenant, dans l ordre des heures : l ordre ne
//     change jamais, une ligne ne bouge pas quand un statut change ;
//   - la regle noire de l heure qu il est coupe le tableau.
// Movsar, 03/11 : « les cartes sont trop petite on comprend pas on a pas toute les
// infos visibile direct que ce soit note du client ou note staff [...] laisse plus de
// place pour mettre plus de chose ». CHAQUE LIGNE EST UNE CARTE QUI MONTRE TOUT :
//   - la colonne Groupe prend toute la largeur libre (les colonnes d activite vides
//     toute la journee sont retirees) ; sous le nom et son telephone, des rubriques
//     ecrites en toutes lettres : Client, Équipe, Fiche, Table, Sur mesure, Prix ;
//     une rubrique vide ne prend aucune place ;
//   - le montant a droite, toujours, puis le geste ;
//   - la barre commune aux trois plannings (assets/app-main.js, pbSyncBarre ; plus bas,
//     pbPoser) remplace le titre, les chiffres, les onglets et le bandeau.
//
// LA FEUILLE DU JOUR (2026-10-26, v4). La grille des heures v3 (2026-10-20, une
// colonne par activite, les heures a gauche) est partie avec son moteur.
//
// Movsar, 26/10, apres une semaine de v3 : « c'est pas tres lisible one shot.
// Il faut que, des qu'on regarde, on sache qui c'est et quelle activite il a
// direct » ; « on est plus lent avec la version qu'on a faite electroniquement
// que leur version papier » ; « t'as tout dans le truc de secours, c'est
// exactement celui-la qu'ils ont au centre, un truc comme ca, mais beaucoup
// plus ameliore, avec tous les details ». Puis : « savoir directement, sur une
// ligne quasi, le nom de la reza, a quelle heure ils doivent venir, combien de
// joueurs ils sont, a quelle heure ils jouent leurs activites [...] toutes les
// formules et tout ce qu'ils ont ».
//
// LE PAPIER, EN MIEUX. La feuille du centre (lib/feuille-secours.js) met UNE
// LIGNE PAR GROUPE, rangee dans la demi-heure de sa reservation, et une
// colonne par activite : le nom et tout le programme se lisent d un coup.
// C est ce qui la rendait plus rapide que la grille des heures, ou un groupe
// etait eparpille dans neuf colonnes a neuf hauteurs et ne se lisait qu en
// ouvrant son panneau. La feuille garde ce cadre, les colonnes du papier dans
// son ordre, et ecrit la ou le papier met une croix L HEURE de l activite et
// ce qu il faut pour la servir :
//   Heure | Groupe | Formule | Pers. | Bowling | Duckpin | Laser | Pixel |
//   Arcades | Minigolf | O'Clock | Plaine | Billard | État
//   14:00 | Anniversaire Noah (10 ans) | F4 | 10 | 14:00 P1-2 | | 16:00 16:30 |...
// L heure de la ligne est CELLE DE LA RESERVATION, comme sur le papier. Les
// 10 min d avance demandees au client ne sont qu un conseil (Movsar, 26/10 :
// « c un conseil on doit pas en faire un truc obligé ») : la feuille ne les
// affiche pas.
// Ce que le papier ne sait pas faire :
//   - l heure exacte de la reservation dans sa demi-heure (14:10 dans le bloc
//     de 14:00) ;
//   - l heure de chaque activite, les pistes, les parties, les enfants de la
//     plaine ; « ≈ » quand l activite n a pas d heure fixe (son heure probable,
//     la regle du moteur, getVisiteLibreApres) ;
//   - la journee rangee par demi-heure (Movsar : « met tout par 30 minute ») :
//     un filet franc a chaque bloc, une bande un bloc sur deux ;
//   - la couleur du STATUT (bleu confirme, ambre arrive, vert paye), la regle
//     des trois plannings, jamais une couleur par activite ; l activite en
//     cours pleine, finie grise, a lancer cerclee : on voit ou en est chaque
//     groupe ;
//   - la barre de l heure qu il est, et la feuille qui s ouvre dessus ;
//   - retard, a valider, a cloturer, pas venu, ecrits sur la ligne ;
//   - « Arrivé » d un geste sur la ligne (le toast « Annuler » suit) ; un clic
//     ailleurs sur la ligne ouvre la fiche ;
//   - (2026-10-27, Movsar : « regarde comment les pro font ») l etat du centre
//     a cette minute dans la tete de chaque colonne (pistes libres, prochain
//     depart laser, enfants a la plaine, groupes sur l activite), comme la vue
//     capacite de ROLLER ; sur le filet de chaque demi-heure, ce qui arrive et
//     la ressource pleine, rouge seulement la (le quart d heure plein de Resy) ;
//     « À encaisser » et le montant quand la visite d un groupe venu est finie.
//   - (2026-11-02, Movsar : « met toi dans la peau d un etudiant de 18 ans pas
//     tres tech, en plein rush avec plein de clients non stop ») la heure de la
//     ligne teintee de son statut, a cote du nom ; les heures de la demi-heure
//     qui vient en gras, le reste de la journee plus leger ; les filtres du
//     comptoir sur la feuille, en un toucher ; « Carte » et « Espèces » sur la
//     ligne d un groupe a encaisser ; la feuille qui suit l heure toute seule
//     tant qu on ne la fait pas defiler.
// Au telephone, chaque ligne devient une carte : les memes faits, l activite
// nommee devant ses heures.
//
// La console l appelle depuis renderGlobalPlanningSurface (app-main.js), a
// chaque rendu et a chaque minute : chaque rangee se compare a celle du dernier
// rendu et seule celle qui a change s ecrit (gfEcrire : le defilement, le focus
// et le reste de la table ne bougent pas).
(function () {
  'use strict';

  // LES COLONNES, DANS L ORDRE DU PAPIER (lib/feuille-secours.js, COLONNES) :
  // l equipe retrouve sa feuille. Une activite sans aucun groupe de la journee n a
  // pas de colonne : sa largeur va a Groupe (Movsar, 2026-11-03). La table
  // d anniversaire n en a pas (Movsar : « pas besoin de goûter »), elle a sa
  // rubrique sur la ligne ; les boissons non plus.
  var GP_COLONNES = [
    { cle: 'bowling', titre: 'Bowling', activites: ['bowling'], nature: 'bowling' },
    { cle: 'duckpin', titre: 'Duckpin', activites: ['duckpin_bowling'], nature: 'agenda' },
    { cle: 'laser', titre: 'Laser', activites: ['laser_game'], nature: 'laser' },
    { cle: 'funrun', titre: 'Pixel', activites: ['fun_run'], nature: 'agenda' },
    { cle: 'arcades', titre: 'Arcades', activites: ['arcade_time', 'arcade_credit'], nature: 'arcades' },
    { cle: 'minigolf', titre: 'Minigolf', activites: ['minigolf_blacklight'], nature: 'agenda' },
    { cle: 'oclock', titre: 'O’Clock', activites: ['golf_oclock'], nature: 'agenda' },
    // (la plaine se vit a la journee : le nombre d enfants compte)
    { cle: 'plaine', titre: 'Plaine', activites: ['playground'], nature: 'plaine' },
    { cle: 'billard', titre: 'Billard', activites: ['billards'], nature: 'agenda' },
  ];
  var GP_SANS_COLONNE = { party_table: true };
  // Ce qui se sert au comptoir ne prend pas de temps de visite : les boissons
  // vont aux infos, les credits d arcade a la colonne Arcades.
  var GP_SERVI = { service_drinks: true };
  var GP_SANS_DUREE = { service_drinks: true, arcade_credit: true };
  function gpTeinte(r) {
    if (r.absentAt && r.status !== 'paid') return 'absent';
    if (r.status === 'paid') return 'paid';
    if (r.status === 'arrived') return 'arr';
    return 'conf';
  }
  function gpHeure(h) { return formatClockDisplay(h); }
  function gpEsc(s) { return escapeHtml(String(s == null ? '' : s)); }
  // [1, 2, 6, 7, 8] se lit « 1-2, 6-8 ».
  function gpPistes(pistes) {
    var liste = Array.from(new Set((pistes || []).map(Number).filter(Number.isFinite))).sort(function (a, b) { return a - b; });
    var morceaux = [];
    liste.forEach(function (p) {
      var dernier = morceaux[morceaux.length - 1];
      if (dernier && p === dernier[1] + 1) dernier[1] = p; else morceaux.push([p, p]);
    });
    return morceaux.map(function (m) { return m[0] === m[1] ? String(m[0]) : m[0] + '-' + m[1]; }).join(', ');
  }
  function gpCatalogue(id) { return typeof getCenterActivity === 'function' ? getCenterActivity(id) : null; }
  // « escape_room » se lit « Escape room » : le nom du catalogue, sinon
  // l identifiant mis en phrase.
  function gpEnPhrase(id) { var t = String(id || 'Activité').replace(/_/g, ' ').trim(); return t.charAt(0).toUpperCase() + t.slice(1); }
  function gpNomActivite(id, repli) {
    var a = gpCatalogue(id);
    return (a && a.name) || repli || gpEnPhrase(id);
  }
  // Le nom d une activite au comptoir : le titre de sa colonne (Plaine,
  // Minigolf, Pixel), jamais « Playground » ni « Fun Run by PIXEL ».
  function gpTitreActivite(id) {
    var c = GP_COLONNES.find(function (x) { return x.activites.indexOf(id) >= 0; });
    return c ? c.titre : gpNomActivite(id);
  }
  // La duree d une activite sans heure : celle de la ligne, sinon celle du
  // catalogue (la meme chaine que le moteur), sinon 30 min.
  function gpMinutes(id, ligne) {
    var m = Math.round(Number(ligne && ligne.minutes) || 0);
    if (m > 0) return m;
    var a = gpCatalogue(id);
    var dm = (a && a.durationModel) || {};
    return Number(dm.defaultMinutes || dm.gameMinutes) || 30;
  }
  function gpMinutesDe(hhmm) {
    var m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || ''));
    return m ? Number(m[1]) + Number(m[2]) / 60 : null;
  }
  // « FORMULE 4 » se lit « F4 » (le mot du comptoir), « KIDS FUN DAY » « Kids
  // Fun Day ». Le nom entier reste dans la bulle de la case.
  function gpFormule(r) {
    // La formule du comptoir : le nom que l equipe lui a donne (lib/formule-comptoir.js).
    var comptoir = r.program && !Array.isArray(r.program) && r.program.formuleSurMesure;
    if (comptoir && comptoir.nom) return { court: 'Sur mesure', long: gfSansRedite('Formule sur mesure : ' + comptoir.nom), nom: comptoir.nom, comptoir: true, parJoueur: comptoir.prixParPersonne };
    if (!r.formuleId && r.type !== 'formule') return null;
    var f = r.formuleId && typeof resolveDisplayFormule === 'function' ? resolveDisplayFormule(r.formuleId) : null;
    var nom = String((f && f.name) || r.label || 'Formule').trim();
    var numero = /^formule\s*(\d+)$/i.exec(nom);
    if (nom === nom.toUpperCase()) nom = nom.toLowerCase().replace(/(^|[\s/])(\p{L})/gu, function (x, a, b) { return a + b.toUpperCase(); });
    return { court: numero ? 'F' + numero[1] : nom, long: nom, adaptee: /\(adapt[ée]e\)/i.test(String(r.label || '')) };
  }
  // « 8 crédits d'arcade (8€) par enfant » : 8 par enfant.
  // DES ARCADES EN ARGENT SE DISENT EN MONTANT (2026-11-22, Ansar : « 8 € en gros quand arcades c argent,
  // pour les cartes avec argent tu dois juste mettre le montant ») : le sur mesure en argent (gpArcadesSurMesure),
  // une carte chargee d un montant (gpCarteArgent), un texte qui dit un montant sans compter de credits. DES
  // CREDITS RESTENT DES CREDITS (2026-11-22, la decision du lot) : « 8 crédits d'arcade (8€) par enfant », la F6
  // et la F7, se dit « 8 crédits » et « par enfant », toujours sans heure ; le montant entre parentheses n est
  // que leur valeur.
  function gpCredits(label, enfants) {
    var m = /(\d+)\s*cr[ée]dits?/i.exec(String(label || ''));
    var n = m ? Number(m[1]) : 0;
    var parEnfant = /par\s+enfant/i.test(String(label || ''));
    var e = m ? null : new RegExp('(\\d+(?:[.,]\\d+)?)\\s*(?:' + motifSignesMonnaie() + ')').exec(String(label || ''));
    var euros = e ? Number(e[1].replace(',', '.')) : null;
    var total = parEnfant ? n * Math.max(1, Number(enfants) || 1) : n;
    return { n: n, parEnfant: parEnfant, total: total, euros: euros, detail: euros != null && parEnfant ? 'par enfant' : '', eurosTotal: euros != null ? (parEnfant ? euros * Math.max(1, Number(enfants) || 1) : euros) : null };
  }
  // Un montant d arcades : le chiffre que le bar charge, jamais masque comme un prix (c est une quantite de jeu).
  function gpMontant(v) {
    var x = Math.round((Number(v) || 0) * 100) / 100;
    return new Intl.NumberFormat('fr-BE', { minimumFractionDigits: Number.isInteger(x) ? 0 : 2, maximumFractionDigits: 2 }).format(x) + ' ' + signeMonnaie();
  }
  // Les arcades vendues en argent d un dossier : le sur mesure (une ligne « arcades-argent », son montant par
  // joueur) et les cartes de credit d une visite a la carte (le prix de l offre, par carte).
  function gpArcadesSurMesure(r) {
    var rep = [];
    (Array.isArray(r.extras) ? r.extras : []).forEach(function (x) {
      if (!x || String(x.id || '') !== 'arcades-argent') return;
      var nom = String(x.name || '');
      var joueurs = Math.max(1, Math.trunc(Number((/×\s*(\d+)\s*joueurs?$/.exec(nom) || [])[1])) || Math.trunc(Number(r.pax)) || 1);
      var total = Math.max(0, Number(x.offert ? x.valeur : x.price) || 0);
      if (!(total > 0)) return;
      var parJoueur = Math.round(total / joueurs * 100) / 100;
      rep.push({ n: 0, parEnfant: false, total: 0, euros: parJoueur, detail: 'par joueur', eurosTotal: total, nom: 'Arcades' });
    });
    return rep;
  }
  // « 2 cruches boissons » se lit « 2 cruches » : on sait ce que c est.
  function gpServi(label) { return String(label || '').replace(/^(\d+\s+cruches?)\s+boissons?$/i, '$1'); }
  // Les extras achetes, comptes : deux « Cruche Bière » font « 2 × Cruche Bière »,
  // « Pizza × 6 » reste six pizzas, et l heure se dit quand le dossier la porte.
  function gpExtras(r) {
    var compte = new Map();
    (Array.isArray(r.extras) ? r.extras : []).forEach(function (e) {
      var brut = e && String(e.name || e.label || '').trim();
      if (!brut) return;
      // (les arcades vendues en argent ont leur montant dans la colonne Arcades, 2026-11-22)
      if (e.id === 'arcades-argent') return;
      var fois = /^(.*\S)\s*×\s*(\d+)$/.exec(brut);
      var nom = fois ? fois[1] : brut;
      var heure = /^\d{1,2}:\d{2}/.test(String(e.heure || e.time || e.startTime || '')) ? String(e.heure || e.time || e.startTime).slice(0, 5) : '';
      // (une ligne a payer le dit, comme une offerte : son prix se regle au comptoir)
      var aPayer = !e.offert && e.aPayer === true;
      var cle = nom + '|' + heure + '|' + Boolean(e.offert) + '|' + aPayer;
      var l = compte.get(cle) || { nom: nom + (e.offert ? ' offert' : aPayer ? ' à payer' : ''), heure: heure, n: 0 };
      l.n += fois ? Number(fois[2]) : 1;
      compte.set(cle, l);
    });
    return Array.from(compte.values()).map(function (l) { return (l.n > 1 ? l.n + ' × ' : '') + l.nom + (l.heure ? ' à ' + l.heure : ''); });
  }

  // Une carte d arcades en credits choisie a la carte : son prix par carte, le nombre de cartes a cote.
  function gpCarteArgent(r, it) {
    if (!it || it.activityId !== 'arcade_time' || !it.arcadeMode || it.arcadeMode === 'time') return null;
    var q = typeof getArcadeOfferQuote === 'function' && typeof catalogueDeLigne === 'function'
      ? getArcadeOfferQuote(catalogueDeLigne(it), it, Number(it.participants) || Number(r.pax) || 1) : null;
    if (!q) return { n: 0, parEnfant: false, total: 0, euros: null, detail: '', eurosTotal: null };
    return { n: 0, parEnfant: false, total: 0, euros: q.price, detail: q.cards > 1 ? q.cards + ' cartes' : '', eurosTotal: q.price };
  }

  // LES ACTIVITES SANS HEURE D UN GROUPE, a leur heure probable, par la regle
  // du moteur (celle qui donne la fin de visite affichee partout,
  // getVisiteLibreApres) : leurs minutes remplissent d abord les trous entre
  // les blocs a heure du groupe, le reste se joue apres son plan. Ce qui se
  // sert (boissons, credits) ne prend pas de temps.
  function gpLibres(g) {
    var r = g.r;
    var items = r.program && Array.isArray(r.program.items) ? r.program.items : [];
    var lignes = [], avant = [];
    items.forEach(function (it) {
      if (!it || it.planned !== false || it.waitOffer) return;
      var posee = typeof getEtapeAvant === 'function' ? getEtapeAvant(r, it) : null;
      if (posee) { avant.push({ l: { id: it.activityId, nom: nomActivite(it), unites: Math.max(0, Math.trunc(Number(it.units) || 0)), enfants: Number(it.participants) || 0 }, start: timeToNum(posee.startTime), end: timeToNum(posee.endTime), fixe: true }); return; }
      lignes.push({ id: it.activityId, nom: nomActivite(it), minutes: gpMinutes(it.activityId, it), journee: ligneALaJournee(it), unites: Math.max(0, Math.trunc(Number(it.units) || 0)), enfants: Number(it.participants) || 0, argent: gpCarteArgent(r, it) });
    });
    // Une formule suivie : ses activites sans heure que le programme ne porte pas.
    if (typeof reservationHasFormulaActivities === 'function' && reservationHasFormulaActivities(r)) {
      getFormulaActivityProgressSummary(r).items.forEach(function (it) {
        if (it.startTime || it.activityId === 'bowling' || it.activityId === 'laser_game' || it.activityId === 'party_table') return;
        if (lignes.some(function (l) { return l.id === it.activityId; })) return;
        lignes.push({ id: it.activityId, nom: it.label || gpNomActivite(it.activityId), minutes: gpMinutes(it.activityId, null), journee: false, unites: 0, enfants: 0 });
      });
    }
    var servis = lignes.filter(function (l) { return GP_SANS_DUREE[l.id] || l.argent; });
    lignes = lignes.filter(function (l) { return !GP_SANS_DUREE[l.id] && !l.argent; });
    var blocs = getStaffResourceWindows(r, 'all').map(function (w) { return [Number(w.start), Number(w.end)]; })
      .filter(function (b) { return Number.isFinite(b[0]) && Number.isFinite(b[1]) && b[1] > b[0]; })
      .sort(function (a, b) { return a[0] - b[0]; });
    var segments = [];
    var finBlocs = null;
    // Un trou de moins d un quart d heure ne recoit rien : c est une pause.
    blocs.forEach(function (b) {
      if (finBlocs !== null && b[0] - finBlocs >= 0.25 - 1e-6) segments.push([finBlocs, b[0]]);
      finBlocs = finBlocs === null ? b[1] : Math.max(finBlocs, b[1]);
    });
    var aHeure = getStaffFormulaTimedItems(r).map(function (it) { return it.end; });
    var finPlan = Math.max.apply(null, [finBlocs === null ? -Infinity : finBlocs].concat(aHeure));
    if (!Number.isFinite(finPlan)) finPlan = g.span.start;
    segments.push([finPlan, Infinity]);
    var k = 0, curseur = segments[0][0];
    var places = [];
    lignes.forEach(function (l) {
      if (l.journee) { places.push({ l: l, start: g.span.start, end: g.span.end, journee: true }); return; }
      var reste = l.minutes / 60, debut = null, fin = null;
      while (reste > 1e-6 && k < segments.length) {
        var seg = segments[k];
        if (curseur < seg[0]) curseur = seg[0];
        var dispo = seg[1] - curseur;
        if (dispo <= 1e-6) { k += 1; continue; }
        var pris = Math.min(reste, dispo);
        if (debut === null) debut = curseur;
        curseur += pris; reste -= pris; fin = curseur;
      }
      if (debut !== null) places.push({ l: l, start: debut, end: fin });
    });
    return { places: avant.concat(places), servis: servis };
  }

  // APRES MINUIT, LA SOIREE CONTINUE : la console reste sur la veille jusqu a
  // 5 h (suivreLeJour, app-main.js) ; pour elle il est 24 h + l heure. Les
  // memes regles que la console (getStaffTerrainPhase, splitStaffTerrainOnsite,
  // le paye range par ses coches), lues a cette heure-la : sinon tout le soir
  // passait « fini » a minuit pile.
  function gpVeille(jour) {
    var d = new Date(String(jour) + 'T12:00:00');
    d.setDate(d.getDate() - 1);
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function gpNuit(jour, auj) {
    var bascule = typeof STAFF_JOUR_BASCULE_HEURE === 'number' ? STAFF_JOUR_BASCULE_HEURE : 5;
    return jour === gpVeille(auj) && currentTimeDecimal() < bascule;
  }
  function gpMomentsNuit(tout, maintenant) {
    if (typeof getStaffTerrainPhase !== 'function' || typeof splitStaffTerrainOnsite !== 'function') return getStaffReservationMoments(tout);
    var moments = new Map();
    var board = { now: maintenant, onsite: [] };
    tout.forEach(function (r) {
      var span = getStaffTerrainSpan(r);
      var phase = getStaffTerrainPhase(r, span, { when: 'today', now: maintenant });
      if (phase === 'onsite') board.onsite.push(Object.assign({ reservation: r }, span));
      else moments.set(String(r.id), { etat: phase, late: false });
    });
    var partage = splitStaffTerrainOnsite(board);
    partage.late.forEach(function (i) { moments.set(String(i.reservation.id), { etat: 'upcoming', late: true }); });
    partage.due.forEach(function (i) { moments.set(String(i.reservation.id), { etat: 'upcoming', late: false }); });
    partage.present.forEach(function (i) { moments.set(String(i.reservation.id), { etat: 'onsite', late: false }); });
    tout.forEach(function (r) {
      var mo = moments.get(String(r.id));
      if (r.status === 'paid' && mo && mo.etat !== 'absent') { mo.etat = typeof groupeToutFait === 'function' && groupeToutFait(r) ? 'done' : 'onsite'; mo.late = false; }
    });
    return moments;
  }

  // L HEURE DE LA LIGNE : celle de la reservation (startTime, l heure que le
  // client a reservee, celle du papier), jamais l accueil conseille 10 min
  // avant (opsPlan.arrivalTime). Sans heure, le debut de sa premiere activite.
  function gpHeureReservee(r, span) {
    var d = gpMinutesDe(r.startTime);
    return d == null ? span.start : d;
  }

  // L ETAT DU CENTRE, MAINTENANT (2026-10-27), dans la tete de chaque colonne :
  // ce que le comptoir repond a « vous avez une piste ? » sans changer
  // d onglet. Les pistes libres sont celles du planning bowling
  // (getStaffBowlingLanesFreeNow), le prochain depart celui du planning laser
  // (lpModele) : une seule source par fait. Ailleurs, ce qui se joue a cette
  // minute : les enfants a la plaine, les groupes pointes sur l activite.
  function gpEtatCentre(groupes, laser, maintenant) {
    var etat = {};
    var libres = typeof getStaffBowlingLanesFreeNow === 'function' ? getStaffBowlingLanesFreeNow() : null;
    if (libres) {
      var dit = describeStaffLanesFreeNow(libres);
      var n = libres.libres.length;
      etat.bowling = { texte: n ? n + (n > 1 ? ' libres' : ' libre') : 'complet', plein: !n, bulle: (n ? 'Libres maintenant : ' : 'Aucune piste libre, ') + dit.hint };
    }
    var p = laser && laser.prochain;
    if (p) {
      var places = Number(p.places) || 0;
      etat.laser = { t: p.t, places: places, texte: gpHeure(p.t) + (places > 0 ? ', ' + places + (places > 1 ? ' armes' : ' arme') : ', complet'), plein: places <= 0, bulle: 'Prochain départ laser à ' + gpHeure(p.t) + ' : ' + (places > 0 ? places + ' armes libres sur ' + laser.capacite : 'complet') };
    }
    var ici = {};
    groupes.forEach(function (g) {
      if (g.parti || !gfPresent(g)) return;
      g.cases.forEach(function (liste, cle) {
        liste.forEach(function (e) {
          if (e.aPlacer || e.credit) return;
          var debut = e.journee ? g.span.start : e.start;
          var fin = e.journee ? g.span.end : e.end;
          if (debut == null || debut > maintenant + 1e-6 || fin <= maintenant + 1e-6) return;
          var c = ici[cle] || (ici[cle] = { groupes: new Set(), enfants: 0 });
          if (!c.groupes.has(g.id)) c.enfants += Number(e.enfants) || Number(g.r.pax) || 0;
          c.groupes.add(g.id);
        });
      });
    });
    Object.keys(ici).forEach(function (cle) {
      if (etat[cle]) return;
      var c = ici[cle];
      etat[cle] = cle === 'plaine'
        ? { texte: c.enfants + ' enf.', bulle: c.enfants + (c.enfants > 1 ? ' enfants' : ' enfant') + ' à la plaine maintenant' }
        : { texte: gfPluriel(c.groupes.size, ['groupe', 'groupes']), bulle: gfPluriel(c.groupes.size, ['groupe pointé', 'groupes pointés']) + ' sur l’activité maintenant' };
    });
    return etat;
  }

  // LES HEURES PRIVATISEES (2026-11-20, Ansar : « pour privatisé faut que ça grisille aussi sur
  // le planning complet »). Les blocages « private » du jour, les memes que le bandeau et la grille
  // du bowling (getAvailabilityBlocksForDate). Une demi-heure qu une privatisation de tout le centre
  // touche se hachure, se dit « privatisé » et ne se reserve plus d un toucher ; celle d une
  // activite seule le dit sur la case de l heure (« Laser privatisé »), le reste du centre ouvert.
  function gfPrivees(jour) {
    var blocs = typeof getAvailabilityBlocksForDate === 'function' ? (getAvailabilityBlocksForDate(jour) || []) : [];
    var liste = blocs.filter(function (b) { return b && b.kind === 'private'; }).map(function (b) {
      var a = typeof availabilityBlockStartMin === 'function' ? availabilityBlockStartMin(b) : null;
      var z = typeof availabilityBlockEndMin === 'function' ? availabilityBlockEndMin(b) : null;
      return { debut: a == null ? 0 : a / 60, fin: z == null ? 24 : z / 60, nom: b.reason || '', centre: b.scopeType === 'center', ref: String(b.scopeRef || '') };
    });
    return function (b) {
      var touche = liste.filter(function (p) { return p.debut < b + 0.5 - 1e-6 && p.fin > b + 1e-6; });
      if (!touche.length) return null;
      var centre = touche.filter(function (p) { return p.centre; })[0];
      var p = centre || touche[0];
      return { centre: Boolean(centre), refs: centre ? [] : touche.map(function (x) { return x.ref; }), dit: 'Privatisé : ' + (p.nom || 'groupe privé') + ', de ' + gpHeure(p.debut) + ' à ' + gpHeure(p.fin) };
    };
  }

  // LA CHARGE D UNE DEMI-HEURE (2026-10-27), sur son filet : le bowling dont
  // toutes les pistes sont prises, le depart laser plein. Le reste du temps,
  // rien : la couleur ne sert qu a l exception (Resy rougit son quart d heure
  // plein, rien d autre). Les memes sources que l etat du centre.
  function gpCharge(laser) {
    var occupation = typeof getStaffBowlingLaneOccupation === 'function' ? getStaffBowlingLaneOccupation() : null;
    var departs = laser && Array.isArray(laser.departs) ? laser.departs : [];
    var charge = function (b, col) {
      if (col.nature === 'bowling' && occupation) {
        var l = getStaffBowlingLanesFreeBetween(b, b + 0.5, occupation);
        if (l && l.ouvertes && !l.libres) return { texte: 'complet', bulle: 'Les ' + l.ouvertes + ' pistes sont prises entre ' + gpHeure(b) + ' et ' + gpHeure(b + 0.5) };
      }
      if (col.nature === 'laser') {
        var pire = null;
        departs.forEach(function (d) { if (d.t >= b - 1e-6 && d.t < b + 0.5 - 1e-6 && d.occupe > 0 && (!pire || d.places < pire.places)) pire = d; });
        if (pire && pire.places <= 0) return { texte: pire.places < 0 ? -pire.places + ' de trop' : 'complet', bulle: 'Départ laser de ' + gpHeure(pire.t) + ' : ' + pire.occupe + ' armes sur ' + laser.capacite };
      }
      return null;
    };
    // CE QUI RESTE A UNE HEURE (2026-11-02) : le telephone sonne, « vous avez de la place a
    // 17:00 pour 8 ? ». Les pistes qui tiennent une partie d une heure, celle que Réserver
    // propose (une piste libre une demi-heure annonçait une place que Réserver refusait),
    // les places de son depart laser, les memes sources que la tete du tableau.
    var fermeture = typeof getPlanningWindow === 'function' ? Number(getPlanningWindow(state.currentDate).close) : Infinity;
    charge.place = function (b) {
      var l = occupation && b + 1 <= fermeture + 1e-6 ? getStaffBowlingLanesFreeBetween(b, b + 1, occupation) : null;
      var depart = departs.find(function (d) { return d.t >= b - 1e-6 && d.t < b + 0.5 - 1e-6 && !d.ferme && !d.hors; });
      return { pistes: l && l.ouvertes ? l.libres : 0, laser: depart ? Math.max(0, Number(depart.places) || 0) : 0 };
    };
    return charge;
  }

  // ---- LA JOURNEE EN LIGNES ---------------------------------------------------
  // Une ligne par groupe, dans l ordre des heures de reservation ; ses
  // activites rangees par colonne, chacune avec son heure.
  function gpModele() {
    var jour = state.currentDate;
    // UN GROUPE « PAS VENU » QUITTE LES PLANNINGS (2026-11-08, Ansar : « ça le supprime sur
    // les planning mais en backend ça doit etre montré noshow »). Son dossier reste en base
    // (absent_at) pour les chiffres et les IA ; le filtre « Pas venus » le montre encore,
    // pour revenir sur une erreur.
    var filtre = state.staffStatusFilter || 'all';
    var duJour = todaysReservations();
    var tout = filtre === 'absent' ? duJour : duJour.filter(tientSesPlaces);
    var auj = todayStr();
    var nuit = gpNuit(jour, auj);
    var moments = nuit ? gpMomentsNuit(tout, 24 + currentTimeDecimal()) : getStaffReservationMoments(tout);
    if (typeof releaseDeadNoteFilter === 'function') releaseDeadNoteFilter();
    var filtrees = typeof filterReservationsForStaff === 'function' && filtre !== 'all' ? filterReservationsForStaff(tout, filtre) : null;
    var aujourdHui = jour === auj || nuit;
    var maintenant = jour === auj ? currentTimeDecimal() : nuit ? 24 + currentTimeDecimal() : null;
    var colonnes = GP_COLONNES.map(function (c) { return Object.assign({}, c, { groupes: 0 }); });
    var inconnues = [];
    function colonneDe(id) {
      var c = colonnes.find(function (x) { return x.activites.indexOf(id) >= 0; });
      if (c) return c;
      c = inconnues.find(function (x) { return x.activites[0] === id; });
      if (!c) {
        // Une activite hors papier (escape room, VR...) : sa colonne, apres le billard.
        c = { cle: 'a-' + id, titre: gpNomActivite(id), activites: [id], groupes: 0, nature: 'agenda', inconnue: true };
        inconnues.push(c);
      }
      return c;
    }
    var groupes = tout.map(function (r) {
      var mo = moments.get(String(r.id)) || {};
      var span = getStaffTerrainSpan(r);
      // LA LIGNE DIT QUI EST LA. Un groupe paye dont la visite est finie a l heure est
      // parti, sa ligne se lit comme telle. Le compteur, lui, dit le chiffre de la liste,
      // qui le garde a suivre tant que son programme n est pas coche (l audit du
      // 2026-11-03 : 6 au-dessus, 7 dessous, pour un meme « Sur place »).
      var parti = r.status === 'paid' && mo.etat === 'onsite' && maintenant != null && span.end <= maintenant;
      return { r: r, id: String(r.id), etat: parti ? 'done' : mo.etat || 'upcoming', etatListe: mo.etat || 'upcoming', retard: Boolean(mo.late), rt: typeof retardDuGroupe === 'function' ? retardDuGroupe(r, mo) : null, nonPointe: !mo.late && groupeEnRetardAuPlanning(r, mo), teinte: gpTeinte(r), span: span, heure: gpHeureReservee(r, span), prog: getGroupeProgramme(r), cases: new Map(), infos: [], credits: [], table: null, boissons: null };
    });
    // L ORDRE DU PAPIER : l heure de la reservation, puis le nom.
    groupes.sort(function (a, b) { return a.heure - b.heure || String(a.r.name || '').localeCompare(String(b.r.name || ''), 'fr'); });
    groupes.forEach(function (g) {
      var r = g.r;
      var poser = function (id, e) {
        if (GP_SANS_COLONNE[id]) return;
        var c = colonneDe(id);
        e.activityId = id;
        if (!g.cases.has(c.cle)) { g.cases.set(c.cle, []); c.groupes += 1; }
        g.cases.get(c.cle).push(e);
      };
      // (le sous-groupe d un grand groupe, lib/grand-groupe.js : la case dit lequel joue a cette heure)
      getBowlingWindowsFromReservation(r).forEach(function (w) {
        // (aVolonte : des pistes gardees toute la visite d un acces illimite, lib/a-volonte.js)
        poser('bowling', { start: w.start, end: w.end, pistes: (w.lanes || []).filter(Number.isFinite), joueurs: Number(w.players) || Number(r.pax) || 0, aVolonte: Boolean(w.aVolonte), groupe: Number(w.sousGroupe) || 0 });
      });
      // Les vagues d une meme partie entrent ensemble : une seule heure.
      var parties = new Map();
      getLaserWindowsFromReservation(r).forEach(function (w) {
        var k = Math.round(w.start * 60);
        var j = Math.max(1, Number(w.joueursReels != null ? w.joueursReels : w.players) || Number(r.pax) || 1);
        var deja = parties.get(k);
        // (chaque vague garde sa cle, celle que le glisser deplace : l heure qui se touche les emporte)
        // (deux groupes d un grand groupe qui partent ensemble font une case : elle garde leurs numeros, « groupes 1 et 2 »)
        var sien = Number(w.sousGroupe) || 0;
        if (deja) { deja.joueurs += j; deja.end = Math.max(deja.end, w.end); if (sien && deja.groupes.indexOf(sien) < 0) deja.groupes.push(sien); if (deja.groupe !== sien) deja.groupe = 0; deja.unites.push(laserBlockUnitKey(w)); return; }
        var e = { start: w.start, end: w.end, joueurs: j, aVolonte: Boolean(w.aVolonte), groupe: sien, groupes: sien ? [sien] : [], rang: Number(w.countIndex) || 1, unites: [laserBlockUnitKey(w)] };
        parties.set(k, e);
        poser('laser_game', e);
      });
      // (un depart garde a volonte n est pas une partie de plus : il ne se compte pas)
      // (les departs d un grand groupe sont des sous-groupes, pas des parties : la partie est celle du plan)
      Array.from(parties.values()).filter(function (e) { return !e.aVolonte; }).sort(function (a, b) { return a.start - b.start; }).forEach(function (e, n, toutes) {
        var enGroupes = toutes.some(function (x) { return x.groupe || x.groupes.length; });
        e.partie = enGroupes ? e.rang : n + 1;
        e.parties = enGroupes ? Math.max.apply(null, toutes.map(function (x) { return x.rang; })) : toutes.length;
      });
      g.prog.filter(function (e) { return e.aPlacer; }).forEach(function () { poser('laser_game', { aPlacer: true }); });
      // Les activites a heure d une formule (hors bowling, laser, table). Ses
      // credits d arcade restent un compteur, meme quand la formule leur donne
      // une heure.
      // UN ACCES ILLIMITE NE DONNE PAS D HEURE A SES ACTIVITES LIBRES (2026-11-20, Ansar : « pour
      // les activités illimité on comprend rien ») : l heure que le moteur leur suggerait (« Minigolf
      // 17:45 ») se lisait comme un rendez-vous. Elles disent « à volonté », comme la phrase du
      // ticket ; le bowling et le laser gardent leurs pistes et leurs departs.
      var acces = typeof illimiteDeSaCarte === 'function' && illimiteDeSaCarte(r);
      getStaffFormulaTimedItems(r).forEach(function (it) {
        if (it.activityId === 'bowling' || it.activityId === 'laser_game') return;
        if (it.activityId === 'party_table') { g.table = g.table || it; return; }
        if (GP_SERVI[it.activityId]) { var servi = gpServi(it.label || gpNomActivite(it.activityId)); g.boissons = g.boissons || { nom: servi, start: it.start }; g.infos.push(servi); return; }
        if (it.activityId === 'arcade_credit') { var crf = gpCredits(it.label || gpNomActivite(it.activityId), r.pax); g.credits.push(crf); poser('arcade_credit', { credit: true, nom: it.label, credits: crf }); return; }
        // (des arcades vendues en argent, un contenu de formule ou une carte : le montant, jamais une heure)
        if (typeof arcadesEnArgentDuDossier === 'function' && arcadesEnArgentDuDossier(r, it)) { var cra = gpCredits(it.label || gpNomActivite(it.activityId), r.pax); g.credits.push(cra); poser('arcade_time', { credit: true, nom: it.label, credits: cra }); return; }
        poser(it.activityId, { start: it.start, end: Math.max(it.end, it.start + 0.25), illimite: acces, volonte: acces });
      });
      var libres = gpLibres(g);
      libres.places.forEach(function (p) {
        var volonte = acces && !p.fixe;
        poser(p.l.id, { start: p.start, end: p.end, libre: !p.fixe, journee: Boolean(p.journee), unites: p.l.unites, nom: p.l.nom, enfants: p.l.enfants, minutes: p.l.minutes, illimite: Number(p.l.minutes) >= 999 || volonte, volonte: volonte });
      });
      libres.servis.forEach(function (l) {
        if (l.id === 'arcade_credit') { var cr = gpCredits(l.nom, l.enfants || r.pax); g.credits.push(cr); poser('arcade_credit', { credit: true, nom: l.nom, credits: cr }); }
        else if (l.argent) { g.credits.push(l.argent); poser('arcade_time', { credit: true, nom: l.nom, credits: l.argent }); }
        else g.infos.push(gpServi(l.nom));
      });
      // Le sur mesure : « Arcades 8 € par joueur » de Modifier ou de Réserver (une ligne du dossier, sans heure).
      gpArcadesSurMesure(r).forEach(function (cs) { g.credits.push(cs); poser('arcade_time', { credit: true, nom: cs.nom, credits: cs }); });
      g.extras = gpExtras(r);
      g.formule = gpFormule(r);
      g.illimite = gfIllimite(r);
      g.rubriques = gfRubriques(g);
      // Une activite cochee « faite » (le suivi des formules) le dit dans sa case.
      g.prog.filter(function (e) { return e.fait; }).forEach(function (e) {
        // (une ligne d extra cochee n a pas de colonne : elle se lit dans les extras du groupe)
        if (GP_SANS_COLONNE[e.activityId] || e.extra) return;
        var c = colonneDe(e.activityId);
        var liste = g.cases.get(c.cle) || [];
        var cible = e.start != null
          ? liste.find(function (x) { return x.start != null && Math.abs(x.start - e.start) < 0.02; })
          : liste.find(function (x) { return x.activityId === e.activityId && !x.fait; });
        if (cible) cible.fait = true;
      });
      g.cases.forEach(function (liste) { liste.sort(function (a, b) { return (a.start == null ? 99 : a.start) - (b.start == null ? 99 : b.start); }); });
      g.parti = g.etat === 'done' || g.etat === 'absent';
    });
    // CE QUE LES CLIENTS RETIENNENT EN CE MOMENT (2026-11-05, Ansar : « ça montre si ya des
    // pistes ou des armes laser qui sont en cours de reservation par les clients »). Une ligne
    // a son heure, sans geste ; elle part seule quand la retenue finit ou devient une reservation.
    var retenues = (typeof getBlocagesEnLigne === 'function' ? getBlocagesEnLigne(jour) : []).map(function (r) {
      var g = { retenue: true, r: r, id: String(r.id), heure: timeToNum(r.startTime), cases: new Map(), infos: [], table: null, formule: gpFormule(r) };
      var poser = function (id, e) {
        var c = colonneDe(id);
        if (!g.cases.has(c.cle)) { g.cases.set(c.cle, []); c.groupes += 1; }
        g.cases.get(c.cle).push(e);
      };
      getBowlingWindowsFromReservation(r).forEach(function (w) {
        poser('bowling', { start: w.start, end: w.end, pistes: (w.lanes || []).filter(Number.isFinite) });
      });
      // (les vagues d une meme partie entrent ensemble : une seule heure, leurs armes ensemble)
      var parties = new Map();
      getLaserWindowsFromReservation(r).forEach(function (w) {
        var k = Math.round(w.start * 60);
        var deja = parties.get(k);
        if (deja) { deja.armes += Number(w.players) || 0; return; }
        var partie = { start: w.start, end: w.end, armes: Number(w.players) || 0 };
        parties.set(k, partie);
        poser('laser_game', partie);
      });
      return g;
    }).sort(function (a, b) { return a.heure - b.heure; });
    // (inconnues : dans l ordre de leur premiere seance, a egalite par titre)
    inconnues.sort(function (a, b) {
      var premiere = function (c) { return Math.min.apply(null, [99].concat(groupes.map(function (g) { return ((g.cases.get(c.cle) || [])[0] || {}).start; }).filter(function (x) { return x != null; }))); };
      return premiere(a) - premiere(b) || String(a.titre).localeCompare(String(b.titre), 'fr');
    });
    var utilisees = colonnes.filter(function (c) { return c.groupes > 0; }).concat(inconnues);
    var laser = typeof lpModele === 'function' ? lpModele() : null;
    return {
      jour: jour, aujourdHui: aujourdHui, passe: jour < auj && !nuit, maintenant: maintenant, groupes: groupes, colonnes: utilisees,
      absents: duJour.filter(function (r) { return !tientSesPlaces(r); }).length,
      retenues: retenues,
      visibles: filtrees ? new Set(filtrees.map(function (r) { return String(r.id); })) : null,
      fenetre: typeof getPlanningWindow === 'function' ? getPlanningWindow(jour) : { open: 10, close: 22, closed: false },
      etat: jour === auj ? gpEtatCentre(groupes, laser, maintenant) : null,
      charge: gpCharge(laser),
      prive: gfPrivees(jour),
    };
  }

  // ---- L ETAT D UNE ACTIVITE, A L HEURE QU IL EST ----------------------------
  // Le groupe est la : pointe arrive, paye, ou une activite deja cochee.
  function gfPresent(g) {
    var r = g.r;
    return r.status === 'arrived' || r.status === 'paid' || (typeof groupeAJoue === 'function' && groupeAJoue(r));
  }
  // fini (l heure est passee, l activite est cochee, le groupe est parti),
  // en cours, a lancer (le groupe est la, son heure arrive dans les 5 min),
  // en retard (l heure est la, le groupe n est pas pointe), a venir. Une
  // activite sans heure fixe n est jamais « en cours » : le groupe la joue a
  // son rythme ; une partie de laser sans heure est « à placer ».
  var GF_LANCER = 5 / 60;
  function gfEtat(g, e, m) {
    if (e.aPlacer && !g.illimite) return 'aplacer';
    // (jamais pointe, visite finie ou jour passe : en retard tant que personne n a tranche)
    if (g.nonPointe && !e.fait && !e.credit) return 'retard';
    if (m.passe || g.parti || g.etat === 'closing' || e.fait) return 'fini';
    if (e.credit) return 'avenir';
    // (une formule illimitee se joue toute la visite, pas a l heure de sa premiere partie)
    var entiere = e.journee || g.illimite || e.illimite;
    var debut = entiere ? g.span.start : e.start;
    var fin = entiere ? g.span.end : e.end;
    if (m.maintenant == null || debut == null) return 'avenir';
    var present = gfPresent(g);
    // (un groupe en retard n a rien fini : ses heures passees restent en retard)
    if (fin <= m.maintenant + 1e-6) return g.retard && !present ? 'retard' : 'fini';
    if (debut <= m.maintenant + 1e-6) {
      if (!present) return g.retard ? 'retard' : 'avenir';
      return e.libre && !entiere ? 'avenir' : 'encours';
    }
    if (present && !e.libre && debut - m.maintenant <= GF_LANCER + 1e-6) return 'lancer';
    return 'avenir';
  }
  var GF_ETATS = { fini: 'fini', encours: 'en cours', avenir: 'à venir', retard: 'groupe pas encore pointé', lancer: 'à lancer', aplacer: 'à placer' };
  // CE QUI VIENT DANS LA DEMI-HEURE SORT DU RESTE (2026-11-02). Toutes les heures
  // de la feuille etaient du meme gras : a 15:10, rien ne disait lesquelles
  // comptent. Une heure a venir dans les 30 min reste en gras, celles d apres
  // s allegent.
  var GF_BIENTOT = 0.5;
  function gfBientot(g, e, etat, m) {
    if (etat !== 'avenir' || m.maintenant == null || e.credit || e.libre) return false;
    var debut = e.journee ? g.span.start : e.start;
    return debut != null && debut > m.maintenant - 1e-6 && debut - m.maintenant <= GF_BIENTOT + 1e-6;
  }
  // (depuis l heure ecrite sur la ligne, pas depuis l accueil conseille : deux groupes
  // de 15:00 ont le meme retard)
  function gfMinutesDeRetard(g, m) { return Math.max(1, Math.round((m.maintenant - (g.heure <= m.maintenant ? g.heure : g.span.start)) * 60)); }
  // LA PISTE REPRISE APRES UN GROUPE EN RETARD (2026-11-06). Un groupe en retard qui joue
  // son temps entier des son arrivee deborde sur le groupe qui reprend sa piste ; rien ne
  // le disait avant d ouvrir « Ils arrivent dans ». La ligne le dit tant que sa partie
  // n est pas finie : la premiere heure ou une de ses pistes est reprise avant la fin de
  // sa partie, decalee du retard. Un groupe « Pas venu » est parti (g.parti) : il ne
  // reprend rien, il a rendu sa piste.
  function gfReprise(g, m) {
    if (!g.retard || m.maintenant == null) return null;
    var retard = m.maintenant - (g.heure <= m.maintenant ? g.heure : g.span.start);
    var parties = (g.cases.get('bowling') || []).filter(function (e) { return e.pistes && e.pistes.length && e.end > m.maintenant + 1e-6; });
    if (retard <= 0 || !parties.length) return null;
    var pris = null;
    m.groupes.concat(m.retenues || []).forEach(function (autre) {
      if (autre === g || autre.parti) return;
      (autre.cases.get('bowling') || []).forEach(function (o) {
        parties.forEach(function (e) {
          if (o.start < e.end - 1e-6 || o.start >= e.end + retard - 1e-6) return;
          var communes = (o.pistes || []).filter(function (p) { return e.pistes.indexOf(p) >= 0; });
          if (!communes.length) return;
          if (!pris || o.start < pris.start - 1e-6) pris = { start: o.start, pistes: communes, qui: autre, partie: e };
          else if (Math.abs(o.start - pris.start) < 1e-6) communes.forEach(function (p) { if (pris.pistes.indexOf(p) < 0) pris.pistes.push(p); });
        });
      });
    });
    if (!pris) return null;
    pris.pistes.sort(function (a, b) { return a - b; });
    var plusieurs = pris.pistes.length > 1;
    var nom = pris.qui.retenue ? 'Une réservation internet' : (pris.qui.r.name || 'Le groupe suivant');
    var duree = gfDuree(Math.round((pris.partie.end - pris.partie.start) * 60));
    return {
      texte: gfPistesEnMots(pris.pistes) + (plusieurs ? ' reprises à ' : ' reprise à ') + gpHeure(pris.start),
      bulle: nom + ' prend ' + (plusieurs ? 'les pistes ' : 'la piste ') + gpPistes(pris.pistes) + ' à ' + gpHeure(pris.start) + ' : si ' + (g.r.name || 'le groupe') + ' joue son ' + duree + ' dès son arrivée, ' + (pris.qui.retenue ? 'ce client' : nom) + ' attend. Toucher pour décaler.',
    };
  }
  // L HEURE OU UN GROUPE « PAS VENU » A RENDU SES PLACES, sur l horloge de son jour : une
  // case dit « libérée » seulement si l absence est notee avant sa fin.
  function gfRendueA(r, fin) {
    if (!r || !r.absentAt || r.status === 'arrived' || r.status === 'paid' || r.status === 'cancelled') return false;
    var a = new Date(r.absentAt);
    if (Number.isNaN(a.getTime())) return false;
    var jour = a.getFullYear() + '-' + String(a.getMonth() + 1).padStart(2, '0') + '-' + String(a.getDate()).padStart(2, '0');
    if (jour < String(r.date || '')) return true;
    var h = a.getHours() + a.getMinutes() / 60 + (jour > String(r.date || '') ? 24 : 0);
    return fin > h + 1e-6;
  }

  // ---- LES CASES ---------------------------------------------------------------
  // « Pistes 1-2 », « Piste 5 » : le mot entier, en 13 px et en noir (l audit du
  // 2026-11-03 : « P1-2 » en gris se devinait).
  function gfPistesEnMots(pistes) {
    var liste = Array.from(new Set((pistes || []).map(Number).filter(Number.isFinite)));
    return (liste.length > 1 ? 'Pistes ' : 'Piste ') + gpPistes(liste);
  }
  // (« Pistes 6-7 » peut passer a la ligne apres le mot, jamais dans son numero)
  function gfNumerosEntiers(texte) { return gpEsc(texte).replace(/\d+-\d+/g, '<span class="gf-x__n">$&</span>'); }
  // « 30 min », « 1h », « 1h30 » : l ecriture du papier.
  function gfDuree(minutes) {
    var m = Math.round(Number(minutes) || 0);
    if (m <= 0) return '';
    if (m < 60) return m + ' min';
    var h = Math.floor(m / 60), reste = m % 60;
    return reste ? h + 'h' + String(reste).padStart(2, '0') : h + 'h';
  }
  var GF_UNITES = { billards: ['table', 'tables'], duckpin_bowling: ['piste', 'pistes'] };
  function gfPluriel(n, mots) { return n + ' ' + (n > 1 ? mots[1] : mots[0]); }
  // « 1 et 2 », « 1, 2 et 3 » : les groupes d un grand groupe qui partent ensemble.
  function gfGroupesEnMots(groupes) {
    var l = groupes.slice().sort(function (a, b) { return a - b; });
    return l.length > 1 ? l.slice(0, -1).join(', ') + ' et ' + l[l.length - 1] : String(l[0] || '');
  }
  var GF_FAIT = '<svg class="gf-x__ok" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  var GF_PLIS_MIN = 3;
  var gfFinisOuverts = false;


  // UNE FORMULE ILLIMITEE N A PAS D HEURE (2026-11-08, Ansar : « quand ils ont des activités
  // en illimité l'ideal cest que dcp ça laffiche [...] on peut pas savoir lheure des
  // activités »). La regle du moteur : une fenetre ouverte (Matin Malin, Kids Fun Day) se
  // joue a volonte jusqu a la fin de sa periode (isOpenWindowFormula, lib/ops-engine.js).
  var GF_ILLIMITE = 'Illimité';
  // (le mot d un acces illimite, celui de son ticket : « Tout à volonté pendant 3 h »)
  var GF_VOLONTE = 'à volonté';
  function gfIllimite(r) {
    var f = r.formuleId && typeof resolveDisplayFormule === 'function' ? resolveDisplayFormule(r.formuleId) : null;
    return Boolean(f) && f.orderPolicy === 'open_window';
  }
  // « VERS 10:25 » NE VEUT RIEN DIRE (2026-11-08, Ansar : « les hures ou ça dit "vers tels
  // heures" c souvent wtf pas logiqu ») : l heure d une activite sans heure fixe etait une
  // estimation du moteur. La case dit « Libre ». Seule activite du groupe, son heure est
  // celle de la reservation : la case la dit.
  function gfSeuleActivite(g) {
    var n = 0;
    g.cases.forEach(function (liste) { n += liste.length; });
    return n === 1;
  }
  // CE QUI SORT DE L HABITUEL SE VOIT D UN COUP D OEIL (2026-11-08, Ansar : « quand cest une
  // autre heure que 1h reservé ça l'affiche et visiblement et pareil si ils ont un autre
  // nombre de joueur que de base [...] mais si ils ont au complet ça affiche pas »).
  // Ce qui se vend a la duree : le bowling, le duckpin, le billard, et hors formule Pixel
  // et les cartes d arcades (les 30 min d arcades d une formule sont dans sa recette).
  var GF_A_LA_DUREE = { bowling: true, duckpin_bowling: true, billards: true };
  var GF_A_LA_DUREE_HORS_FORMULE = { fun_run: true, arcade_time: true };
  function gfDureeHorsHabitude(r, e, minutes) {
    var m = Math.round(Number(minutes) || 0);
    if (m <= 0 || m === 60) return '';
    if (GF_A_LA_DUREE[e.activityId]) return gfDuree(m);
    return GF_A_LA_DUREE_HORS_FORMULE[e.activityId] && !r.formuleId && r.type !== 'formule' ? gfDuree(m) : '';
  }
  function gfJoueursHorsGroupe(r, n, mots) {
    var j = Math.round(Number(n) || 0);
    return j > 0 && j !== Number(r.pax) ? gfPluriel(j, mots || ['joueur', 'joueurs']) : '';
  }
  function gfHorsHtml(duree, joueurs) {
    if (!duree && !joueurs) return '';
    // (un seul mot : pas de cadre autour, chaque element de la ligne compte, [A] du grand tableau)
    if (!duree || !joueurs) return '<b class="gf-x__h">' + gpEsc(duree || joueurs) + '</b>';
    return '<span class="gf-x__hors"><b class="gf-x__h">' + gpEsc(duree) + '</b><b class="gf-x__h">' + gpEsc(joueurs) + '</b></span>';
  }

  // UNE ACTIVITE DANS SA CASE : son heure d abord (la croix du papier), puis
  // ce qu il faut pour la servir. Bowling : les pistes, et la duree si elle
  // n est pas d une heure (« XX (1h30) » sur le papier). Laser : une heure par
  // partie. Plaine : les enfants. Billard et duckpin : les tables ou pistes
  // quand il y en a plusieurs. Arcades d une formule : les credits.
  // (une coche dit « fait » : l heure passee d un groupe jamais pointe n en a pas,
  // elle reste en retard tant que personne n a tranche)
  function gfActivite(g, e, col, m) {
    var r = g.r;
    var etat = gfEtat(g, e, m);
    var t = '', d = '', d2 = '', d3 = '', bulle = '', panne = false, montant = false;
    if ((g.illimite || e.illimite) && !e.credit) {
      t = e.volonte ? GF_VOLONTE : GF_ILLIMITE;
      bulle = gpTitreActivite(e.activityId) + (e.volonte ? ' : à volonté pendant la visite, sans heure fixe' : ' : illimité pendant la visite, sans heure fixe');
    } else if (e.aPlacer) {
      t = 'à placer';
      bulle = 'Laser : une partie encore sans heure, à placer au planning laser';
    } else if (e.credit) {
      var cr = e.credits || { n: 0, total: 0, parEnfant: false };
      if (cr.euros != null) {
        // En argent : le montant, en gros, sans heure (2026-11-22).
        t = gpMontant(cr.euros); montant = true;
        d = cr.detail || '';
        bulle = 'Arcades en argent : ' + gpMontant(cr.euros) + (cr.detail ? ' ' + cr.detail : '') + (cr.eurosTotal != null && cr.eurosTotal !== cr.euros ? ', ' + gpMontant(cr.eurosTotal) + ' en tout' : '') + ', sans heure : ils jouent quand ils veulent';
      } else if (!cr.n && !cr.total) {
        t = 'Libre';
        bulle = 'Arcades en argent, sans heure : ils jouent quand ils veulent';
      } else {
        t = (cr.parEnfant ? cr.n : cr.total) + ' crédits';
        if (cr.parEnfant) d = 'par enfant';
        bulle = 'Arcades : ' + (cr.parEnfant ? cr.n + ' crédits par enfant, ' + cr.total + ' en tout' : cr.total + ' crédits');
      }
    } else {
      var debut = e.journee ? g.span.start : e.start;
      var fin = e.journee ? g.span.end : e.end;
      var minutes = Math.round((fin - debut) * 60);
      // (la plaine qui commence a l heure de la ligne ne la redit pas : la
      // case dit les enfants)
      var desLeDebut = col.nature === 'plaine' && (e.journee || Math.abs(debut - g.heure) <= 0.25 + 1e-6);
      // LE SOUS-GROUPE D UN GRAND GROUPE (2026-11-22, lib/grand-groupe.js) : « groupe 1 » dans la case,
      // a cote de ses joueurs ; la bulle le redit. Deux groupes que le comptoir fait partir ensemble au laser
      // (2026-11-23) : « groupes 1 et 2 », jamais une case sans numero.
      var groupe = e.groupe ? 'groupe ' + e.groupe : e.groupes && e.groupes.length > 1 ? 'groupes ' + gfGroupesEnMots(e.groupes) : '';
      t = desLeDebut ? '' : e.libre && !gfSeuleActivite(g) ? 'Libre' : gpHeure(debut);
      if (col.nature === 'bowling') {
        var n = e.pistes ? e.pistes.length : 0;
        d = n ? gfPistesEnMots(e.pistes) : 'pistes ?';
        d2 = [groupe, gfDureeHorsHabitude(r, e, minutes)].filter(Boolean).join(' · ');
        d3 = gfJoueursHorsGroupe(r, e.joueurs);
        // UNE PISTE FERMEE SE VOIT SUR LA LIGNE DU GROUPE (2026-11-02) : fermee au planning
        // bowling, le tableau ne changeait pas, et le groupe arrivait sur une piste en
        // panne. Un toucher mene a son bloc, pour le deplacer.
        var fermees = (e.pistes || []).filter(function (p) { return state.laneStatuses && state.laneStatuses[p] === 'maintenance'; });
        if (fermees.length && etat !== 'fini') { d = gfPistesEnMots(fermees) + (fermees.length > 1 ? ' fermées' : ' fermée'); d2 = ''; panne = true; }
        else if (n && gfRendueA(r, fin)) { d = gfPistesEnMots(e.pistes) + (n > 1 ? ' libérées' : ' libérée'); d2 = ''; }
        bulle = 'Bowling de ' + gpHeure(debut) + ' à ' + gpHeure(fin) + (groupe ? ' · ' + groupe : '') + ' · ' + (n ? (n > 1 ? 'pistes ' : 'piste ') + gpPistes(e.pistes) : 'pistes à attribuer') + ' · ' + (Number(e.joueurs) || Number(r.pax) || 0) + ' joueurs';
        if (e.aVolonte) { d2 = 'à volonté'; bulle = 'Bowling à volonté de ' + gpHeure(debut) + ' à ' + gpHeure(fin) + ' · ' + (n ? (n > 1 ? 'pistes ' : 'piste ') + gpPistes(e.pistes) + (n > 1 ? ' gardées' : ' gardée') + ' toute la visite' : 'pistes à attribuer') + ' · ' + (Number(e.joueurs) || Number(r.pax) || 0) + ' joueurs'; }
      } else if (col.nature === 'laser') {
        var armes = Number(e.joueurs) || 0;
        d2 = groupe;
        d3 = gfJoueursHorsGroupe(r, armes, ['arme', 'armes']);
        if (gfRendueA(r, fin)) d = gfPluriel(armes || Number(r.pax) || 0, ['arme libérée', 'armes libérées']);
        bulle = 'Laser à ' + gpHeure(debut) + (groupe ? ' · ' + groupe : '') + (e.parties > 1 ? ' · partie ' + e.partie + ' sur ' + e.parties : '') + ' · ' + (armes || Number(r.pax) || 0) + ' armes';
        if (e.aVolonte) {
          d2 = 'à volonté';
          if (e.departs > 1 && !d) d = e.departs + ' départs';
          bulle = 'Laser à volonté · ' + (e.departs > 1 ? e.departs + ' départs, de ' + gpHeure(debut) + ' à ' + gpHeure(e.dernier) : 'départ de ' + gpHeure(debut)) + ' · ' + (armes || Number(r.pax) || 0) + ' armes gardées';
        }
      } else if (col.nature === 'plaine') {
        var enfants = Number(e.enfants) || Number(r.pax) || 0;
        if (desLeDebut) t = enfants + ' enf.'; else d = enfants + ' enf.';
        bulle = 'Plaine ' + (e.journee ? 'dès ' + gpHeure(debut) + ', toute la visite' : 'de ' + gpHeure(debut) + ' à ' + gpHeure(fin)) + ' · ' + enfants + (enfants > 1 ? ' enfants' : ' enfant');
      } else {
        var mots = GF_UNITES[e.activityId];
        if (e.unites > 1) d = mots ? gfPluriel(e.unites, mots) : '×' + e.unites;
        var dureeDite = e.libre && e.minutes ? e.minutes : minutes;
        d2 = gfDureeHorsHabitude(r, e, dureeDite);
        d3 = gfJoueursHorsGroupe(r, e.enfants);
        bulle = gpTitreActivite(e.activityId) + (e.libre ? ', sans heure fixe' : ' à ' + gpHeure(debut)) + (dureeDite > 0 ? ' · ' + gfDuree(dureeDite) : '') + (d ? ' · ' + d : '');
      }
    }
    var classes = 'gf-x is-' + etat + (etat === 'fini' && gfVientDeFinir(g, e, col, m.jour) ? ' vient-de-finir' : '') + (e.libre && !e.journee ? ' is-libre' : '') + (e.credit ? ' is-credit' : '') + (gfBientot(g, e, etat, m) ? ' is-bientot' : '') + (panne ? ' is-panne' : '');
    return '<span class="' + classes + '" title="' + gpEsc(bulle + ' · ' + GF_ETATS[etat]) + '"' + (panne ? ' data-gf-voir="bowling"' : '') + '>' + (montant ? '<b class="gf-x__t is-nu gf-x__montant">' + gpEsc(t) + '</b>' : gfHeureHtml(t, etat === 'fini' && gfPresent(g), etat, gfActDe(g, e, m, t, panne))) + (d ? '<span class="gf-x__d">' + gfNumerosEntiers(d) + '</span>' : '') + gfHorsHtml(d2, d3) + '</span>';
  }
  // L HEURE SE TOUCHE (2026-11-22, gfOuvrirHeure plus bas) : une heure fixe, d une activite que ce role
  // deplace, se touche et se prend. Aucun element de plus : la pastille porte son geste. (une piste en
  // panne garde son toucher, il mene a son bloc du planning bowling ; ce qui n a pas d heure fixe, un
  // acces illimite, une plaine ou des credits n en ont pas)
  function gfActDe(g, e, m, t, panne) {
    var droits = m.droitsHeure;
    if (!droits || !droits.deplacer || panne || g.retenue || g.illimite || !/^\d{1,2}:\d{2}$/.test(t)) return '';
    if (e.libre || e.aPlacer || e.credit || e.journee || e.aVolonte || e.illimite || e.volonte) return '';
    var id = e.activityId;
    if (!id || GF_SANS_HEURE[id] || /^service_/.test(id) || (id === 'bowling' && !droits.bowling) || (id === 'laser_game' && !droits.laser)) return '';
    var cle = id === 'laser_game' ? (e.unites && e.unites.length ? 'laser_game:' + e.unites.join('+') : '') : id;
    if (!cle || (id !== 'bowling' && id !== 'laser_game' && !gfPointDe(g.r, cle))) return '';
    return ' data-gf-act="' + gpEsc(cle) + '" role="button" tabindex="0" aria-haspopup="dialog" aria-label="' + gpEsc('Changer l’heure : ' + gpTitreActivite(id) + ', ' + t) + '"';
  }
  // L HEURE SE REPERE DE LOIN (2026-11-03, Movsar : « les heures et tout on voit pas bien
  // [...] c trop monochrome ») : l heure fixe, une pastille de la teinte du statut de la
  // ligne. « Libre » reste du texte gris : sans heure fixe, rien ne se joue a la minute.
  // (la coche « fait » se pose devant l heure, dans le meme mot : dans la marge, elle
  // mordait le premier chiffre, « ‹10:00 »)
  // SEULE LA PASTILLE DIT OU EN EST L ACTIVITE, JAMAIS LA CASE (2026-11-07, Ansar : « des
  // fois c'est toute la case qui est surlignée et des fois juste l'heure, moi je veux que
  // ce soit que les heures »). En retard, en cours ou a lancer, « Libre » et
  // « 10 enf. » prennent donc aussi une pastille : sans elle, leur etat ne se lirait plus.
  // (« Illimité » a toujours la sienne, a la couleur de la formule)
  // « LIBRE » SE SURLIGNE AUSSI, LE FAIT SE BARRE (2026-11-19, Ansar : « sur le planning meme les
  // heures libre faut quils soient surligne et quand c fait dcp c plus surligne et quand c fait
  // montre plus visible avec une barre [...] super clean et pro »). « Libre » prend la pastille
  // des heures fixes ; une activite finie perd la sienne et son mot est barre d un trait (CSS).
  function gfHeureHtml(t, fait, etat, act) {
    var fixe = /^\d{1,2}:\d{2}$/.test(t);
    var signe = t !== '' && (etat === 'retard' || etat === 'encours' || etat === 'lancer');
    var libre = t === 'Libre';
    var fini = etat === 'fini' && t !== '';
    if (t === GF_ILLIMITE || t === GF_VOLONTE) return '<b class="gf-x__t is-illimite">' + (fait ? GF_FAIT : '') + gpEsc(t) + '</b>';
    if (!fixe && !signe && !fait && !fini && !libre) return gpEsc(t);
    return '<b class="gf-x__t' + (fixe || signe || libre && !fini ? '' : ' is-nu') + (libre ? ' is-libre' : '') + '"' + (fixe && act ? act : '') + '>' + (fait ? GF_FAIT : '') + gpEsc(t) + '</b>';
  }
  // LE TRAIT SE DESSINE QUAND L ACTIVITE VIENT DE FINIR, une fois : jamais au premier rendu
  // d un jour, jamais au rendu suivant (la ligne inchangee n est pas redessinee).
  var gfFinisVus = { jour: null, cles: null };
  var gfFinisCourant = new Set();
  // SOUS UNE FENETRE OUVERTE, LE TRAIT SE POSE SANS SE DESSINER (2026-11-19) : cocher dans la
  // fiche fait deja sauter la case, et une coche ne fait qu un seul mouvement (Ansar le
  // 2026-10-02 : « aucune animation » quand on coche ; refresh-invisible-check [3]). Le
  // planning est sous le voile : il retrouve son trait deja pose.
  var gfFenetreOuverte = false;
  function gfUneFenetreCouvre() {
    var ids = ['posOverlay', 'quickBookOverlay'];
    for (var i = 0; i < ids.length; i += 1) {
      var o = document.getElementById(ids[i]);
      if (o && !o.classList.contains('hidden')) return true;
    }
    return false;
  }
  function gfVientDeFinir(g, e, col, jour) {
    var cle = g.r.id + '|' + col.cle + '|' + e.activityId + '|' + (e.start == null ? e.partie || '' : e.start);
    gfFinisCourant.add(cle);
    return !gfFenetreOuverte && gfFinisVus.jour === jour && Boolean(gfFinisVus.cles) && !gfFinisVus.cles.has(cle);
  }
  // (deux parties de laser partagent la case, trois aussi : chacune son etat sur sa
  // pastille)
  function gfCase(g, col, m) {
    var liste = g.cases.get(col.cle) || [];
    if (!liste.length) return '<td class="gf-a is-vide"></td>';
    // (« Illimité » se dit une fois, pas une fois par partie de laser)
    if (g.illimite) liste = liste.filter(function (e) { return !e.credit; }).slice(0, 1).concat(liste.filter(function (e) { return e.credit; }));
    // (le laser garde a chaque depart d un acces illimite se dit une fois : son premier depart,
    // « à volonté », le nombre de departs ; six heures empilees ne se lisaient pas)
    else if (col.nature === 'laser' && liste.length > 1 && liste.every(function (e) { return e.aVolonte; })) {
      var dernier = liste[liste.length - 1];
      liste = [Object.assign({}, liste[0], { departs: liste.length, dernier: dernier.start, end: Math.max(liste[0].end, dernier.end) })];
    }
    return '<td class="gf-a' + (liste.length > 1 ? ' is-plusieurs' : '') + (liste.length > 2 ? ' is-trois' : '') + '" data-gf-titre="' + gpEsc(col.titre) + '">' + liste.map(function (e) { return gfActivite(g, e, col, m); }).join('') + '</td>';
  }

  // LE GROUPE : LA LIGNE QUI MONTRE TOUT (2026-11-03). Le nom et ce qui se fait sur lui
  // (le retard qui se touche, le telephone, « À valider », « À clôturer »), puis des
  // rubriques ecrites en toutes lettres. Une rubrique vide ne prend aucune place ; deux
  // lignes au plus par rubrique, le texte entier dans la bulle et la fiche.
  // Trois sources de note, trois rubriques : le mot du client (Client), les notes de
  // l equipe, leur auteur dans la bulle (Équipe), la note permanente du client (Fiche).
  var GF_NOTE_PRIX = /^(.+?) : (.+?) au lieu de (.+?)\. (.+)$/;
  // Deux ecritures de la raison d un prix. L ancienne, une phrase de la fenetre Réserver
  // dans une note d equipe (« Formule 4 (adaptée) : 252 € au lieu de 280 €. Geste
  // commercial »). Depuis le 2026-11-03, celle du serveur : type 'prix', prix { de, a,
  // raison }. `a` dit le prix que la note a pose, pour la faire taire une fois passee.
  function gfPrixDeNote(n) {
    if (n && n.type === 'prix' && n.prix) {
      return { prix: formatMoneyCentimes(n.prix.a), reference: formatMoneyCentimes(n.prix.de), raison: String(n.prix.raison || ''), a: Number(n.prix.a) };
    }
    var x = GF_NOTE_PRIX.exec(String((n && n.t) || ''));
    return x ? { prix: x[2], reference: x[3], raison: x[4] } : null;
  }
  // UNE ALLERGIE NE SE LIT PAS COMME UN MOT SUR LE GATEAU (l audit du 2026-11-03) : le mot
  // Allergie en rouge, en tete de sa rubrique, ou qu elle soit ecrite.
  var GF_ALLERGIE = /allerg|intoleran|coeliaque|celiaque|anaphyla|epipen|arachide|sans gluten|sans lactose/;
  function gfAllergie(texte) { return GF_ALLERGIE.test(gfCle(texte).replace(/œ/g, 'oe')); }
  function gfEnMinuscule(s) { var t = String(s || '').trim(); return t.charAt(0).toLowerCase() + t.slice(1); }
  // UNE ETIQUETTE NE SE REDIT PAS DANS SA VALEUR (2026-11-18, Ansar : « pourquoi deux fois
  // dire formule sur mesure »). « Formule sur mesure : Formule sur mesure » se dit
  // « Formule sur mesure » ; « Formule sur mesure : Formule sur mesure Family Day »,
  // « Formule sur mesure Family Day ». Pour les phrases deja ecrites en base (la raison
  // d un prix, la derniere modification) : le serveur ne les ecrit plus ainsi
  // (lib/historique-dossier.js, sansRedite, la meme regle).
  function gfSansRedite(texte) {
    return String(texte || '').replace(/(^|, | · )([^,·:]+?) : ([^,·]+?)(?=$|, | · )/g, function (tout, avant, etiquette, valeur) {
      var e = gfCle(etiquette);
      var v = gfCle(valeur);
      if (!e || (v !== e && v.indexOf(e + ' ') !== 0)) return tout;
      return avant + (v === e ? etiquette.trim() : valeur.trim());
    });
  }
  window.pgSansRedite = gfSansRedite;
  function gfUneLigne(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
  // UNE NOTE SE VOIT ET DIT QUI L A ECRITE (2026-11-06, Ansar : « on doit voir plus
  // visiblement [...] la note c un client avec couleur et mieux expliqué que c une note
  // client, pareil pour note équipe »). Le mot du client et les notes de l equipe portent
  // leur etiquette pleine, en toutes lettres, au debut du texte : la seconde ligne repart
  // sous l etiquette, la note tient dans ses deux lignes. Les autres rubriques gardent
  // leur libelle gris dans sa colonne.
  var GF_NOTES = { client: true, equipe: true };
  // `bulle` : ce que dit la bulle quand ce n est pas le texte seul (les notes de l equipe,
  // chacune suivie de qui l a ecrite et quand, gfBulleNotes).
  function gfRubrique(cle, mot, html, texte, allergie, bulle) {
    var a = allergie ? '<b class="gf-i__a">Allergie</b> ' : '';
    if (GF_NOTES[cle]) return { cle: cle, mot: mot, texte: texte, allergie: Boolean(allergie), html: '<div class="gf-i gf-i--note gf-i--' + cle + '"><p title="' + gpEsc(bulle || texte) + '"><span class="gf-i__mot">' + gpEsc(mot) + '</span> ' + a + html + '</p></div>' };
    return { cle: cle, mot: mot, texte: texte, allergie: Boolean(allergie), html: '<div class="gf-i gf-i--' + cle + '"><span>' + gpEsc(mot) + '</span><p title="' + gpEsc(texte) + '">' + a + html + '</p></div>' };
  }
  function gfPrixTexte(r, notePrix, sortie) {
    var etat = typeof getReservationPriceState === 'function' ? getReservationPriceState(r) : { ajuste: false };
    // Une note du serveur ne parle que du prix qu elle a pose : si le prix a bouge
    // depuis, ni son montant ni sa raison ne decrivent plus le dossier.
    if (notePrix && notePrix.a != null && Math.round(notePrix.a * 100) !== Math.round((Number(r.price) || 0) * 100)) notePrix = null;
    var morceaux = [];
    if (etat.ajuste) morceaux.push(formatMoneyCentimes(etat.price) + ' au lieu de ' + formatMoneyCentimes(etat.reference));
    else if (notePrix) morceaux.push(notePrix.prix + ' au lieu de ' + notePrix.reference);
    var encaisse = r.status === 'paid' && r.amountPaid != null && Math.round(Number(r.amountPaid) * 100) !== Math.round((Number(r.price) || 0) * 100);
    if (encaisse) morceaux.push(formatMoneyCentimes(r.amountPaid) + ' encaissés');
    if (!morceaux.length) return '';
    var raison = gfSansRedite((notePrix && notePrix.raison) || r.discountReason || '');
    if (raison) morceaux.push(gfEnMinuscule(gfUneLigne(raison)));
    if (sortie && raison) sortie.raison = gfEnMinuscule(gfUneLigne(raison));
    return morceaux.join(', ');
  }
  // LA TABLE D ANNIVERSAIRE (l audit du 2026-11-03 : le bar ne savait ni quand servir ni
  // quand la table se libere) : « 15:20 à 17:38, 2 cruches à 17:28 ». Elle se libere a la
  // fin de la visite.
  function gfTableTexte(g) {
    if (!g.table) return '';
    var fin = Math.max(Number(g.table.end) || 0, Number(g.span.end) || 0);
    var texte = gpHeure(g.table.start) + ' à ' + gpHeure(fin);
    // (les cruches n ont pas d heure : ils prennent quand ils veulent, 2026-11-22)
    return g.boissons ? texte + ', ' + g.boissons.nom : texte;
  }
  // LES NOTES DE L EQUIPE D UN DOSSIER, dans l ordre ou elles ont ete ecrites : la derniere
  // est la plus recente. La ligne du Complet les lit toutes, le Terrain la derniere. Chacune
  // garde qui l a ecrite et quand, pour sa bulle seulement (bulleAuteurNote, app-main.js).
  function gfNotesEquipe(r) {
    var notePrix = null;
    var equipe = [];
    (typeof getReservationNotesEquipe === 'function' ? getReservationNotesEquipe(r) : []).forEach(function (n) {
      if (!n || !n.t || n.compte) return;
      // Toute note de prix quitte la rubrique Équipe ; la derniere du serveur decrit le
      // prix du moment, l historique du dossier garde les autres.
      var p = gfPrixDeNote(n);
      if (p) { if (!notePrix || p.a != null) notePrix = p; return; }
      equipe.push({ t: gfUneLigne(n.t), par: gfUneLigne(n.par), le: n.le, modifieLe: n.modifieLe, modifiePar: gfUneLigne(n.modifiePar) });
    });
    return { notePrix: notePrix, equipe: equipe };
  }
  // LA BULLE DES NOTES DE L EQUIPE (2026-11-18, Marius, manager de Gembloux : « enlève le
  // truc juste après, staff bar gembloux [...] on ne voit pas bien ce qui est marqué en
  // plus »). Le texte d une note se lit seul ; la bulle redit chaque note, puis, a la ligne,
  // qui l a ecrite et quand. Une trace du moteur (retard, decalage) n a pas d auteur.
  function gfBulleNotes(notes) {
    return notes.map(function (n) {
      var auteur = !n.trace && typeof bulleAuteurNote === 'function' ? bulleAuteurNote(n) : '';
      return auteur ? n.t + '\n' + auteur : n.t;
    }).join('\n');
  }
  function gfRubriques(g) {
    var r = g.r;
    var liste = [];
    var parts = typeof getReservationNoteParts === 'function' ? getReservationNoteParts(r) : { mot: typeof getReservationNoteText === 'function' ? getReservationNoteText(r) : '', suivi: [] };
    var mot = gfUneLigne(parts.mot);
    if (mot) liste.push(gfRubrique('client', 'Note du client', gpEsc(mot), mot, gfAllergie(mot)));
    // (le compte a l arrivee se lit dans la colonne Joueurs, sa note dans la fiche ;
    // une note de prix va a la rubrique Prix)
    var lues = g.lues || gfNotesEquipe(r);
    var notePrix = lues.notePrix;
    var equipe = lues.equipe.slice();
    (parts.suivi || []).forEach(function (s) { equipe.push({ t: gfUneLigne(s), trace: true }); });
    if (equipe.length) {
      var texteEquipe = equipe.map(function (n) { return n.t; }).join(' · ');
      liste.push(gfRubrique('equipe', 'Note de l’équipe', gpEsc(texteEquipe), texteEquipe, gfAllergie(texteEquipe), gfBulleNotes(equipe)));
    }
    var fiche = gfUneLigne(window.PinlaneStaffNotes && typeof window.PinlaneStaffNotes.text === 'function' ? window.PinlaneStaffNotes.text(r) : '');
    if (fiche) liste.push(gfRubrique('fiche', 'Fiche', gpEsc(fiche), fiche, gfAllergie(fiche)));
    var table = gfTableTexte(g);
    if (table) liste.push(gfRubrique('table', 'Table', gpEsc(table), table));
    var comptoir = g.formule && g.formule.comptoir ? g.formule : null;
    if (comptoir) {
      var formuleDite = comptoir.nom + (comptoir.parJoueur != null && typeof formatMoneyCentimes === 'function' ? ', ' + formatMoneyCentimes(comptoir.parJoueur) + ' par joueur' : '');
      liste.push(gfRubrique('formule', 'Formule', gpEsc(formuleDite), formuleDite));
    }
    if (g.extras.length) { var mesure = g.extras.join(', '); liste.push(gfRubrique('mesure', 'Sur mesure', gpEsc(mesure), mesure)); }
    // (le nom de la formule vient de se lire : la raison du prix ne le redit pas, ecrite
    // « formule sur mesure : <nom> » ou, depuis le 2026-11-18, « formule sur mesure »
    // seule quand elle n a pas d autre nom ; une raison qui la suit reste)
    var prix = String(gfPrixTexte(r, notePrix, g.sortie) || '').replace(comptoir ? /,\s*formule sur mesure(?:\s*:[^·,]*)?(\s*·\s*)?/i : /$^/, function (x, suite) { return suite ? ', ' : ''; });
    if (prix) liste.push(gfRubrique('prix', 'Prix', gpEsc(prix), prix));
    // (la derniere modification ne s ecrit plus sur la ligne, 2026-11-06, Ansar : « quand
    // c modifié pas besoin d écrire sur la page ici que ça a été modifié, ça prend trop de
    // place ». Ce qui a change se lit deja sur la ligne, la duree, l activite, le prix ; le
    // quand et le qui restent dans la fiche.)
    return liste;
  }
  // CE QUI CHANGE LA MANIERE DE SERVIR, POUR LES CARTES ET LE TERRAIN (2026-11-03, Movsar :
  // « tout ce qui est sur mesure modifier ou prix ajuster tout bien visible sur le planning
  // complet et sur les cartes des reservations »). Les rubriques de cette ligne, lues une
  // fois et rendues en texte : les cartes Bowling et Laser en font des marqueurs
  // (renderCardFlags), le Terrain et la liste du jour des lignes (renderStaffTerrainNote,
  // renderLigneRubriquesDossier). Aucun ecran ne relit une note, un extra ou un prix a sa
  // maniere. `allergies` dit quelles rubriques en parlent ; `notes`, les seules notes
  // ecrites par l equipe (la rubrique Équipe y ajoute les traces du moteur, retard ou
  // decalage, que la carte dit deja par sa puce).
  window.pgEssentiel = function (r) {
    var e = { client: '', equipe: '', fiche: '', mesure: '', prix: '', raison: '', notes: '', derniere: null, adaptee: false, allergies: {} };
    if (!r) return e;
    var lues = gfNotesEquipe(r);
    var sortie = {};
    gfRubriques({ r: r, extras: gpExtras(r), table: null, lues: lues, sortie: sortie }).forEach(function (x) {
      e[x.cle] = x.texte;
      if (x.allergie) e.allergies[x.cle] = true;
    });
    e.notes = lues.equipe.map(function (n) { return n.t; }).join(' · ');
    e.notesBulle = gfBulleNotes(lues.equipe);
    if (e.notes && gfAllergie(e.notes)) e.allergies.notes = true;
    e.raison = e.prix ? sortie.raison || '' : '';
    var d = lues.equipe[lues.equipe.length - 1];
    if (d) e.derniere = { t: d.t, par: d.par, le: d.le, modifieLe: d.modifieLe, modifiePar: d.modifiePar, allergie: gfAllergie(d.t) };
    var f = gpFormule(r);
    e.adaptee = Boolean(f && f.adaptee);
    return e;
  };
  // CE QUI SORT DE L ORDINAIRE, EN UN MOT, PARTOUT LE MEME (2026-11-09, Ansar : « marqué en
  // evidence tout les choses que ce soit prix custom activité heure personne team building
  // groupe privé »). Le type de groupe et l heure hors des horaires habituels ; le prix et le
  // sur mesure ont deja leurs rubriques. Aucun ecran ne les relit a sa maniere.
  var GF_GROUPES = { teambuilding: 'Team building', prive: 'Groupe privé', entreprise: 'Entreprise', ecole: 'École', evg: 'EVG / EVJF' };
  function gfHorsHoraires(r) {
    if (!r || !r.startTime || !r.date || typeof ouvertureExceptionnelleDu !== 'function') return null;
    var exception = ouvertureExceptionnelleDu(r.date);
    if (!exception) return null;
    var normal = getSchedule(r.date, state.isHolidayMode, { normal: true });
    var debut = timeToNum(r.startTime);
    var plan = r.opsPlan && r.opsPlan.endTime ? timeToNum(r.opsPlan.endTime) : 0;
    var fin = Math.max(debut + (Number(r.duration) || 0), plan);
    if (normal && debut >= normal.open && fin <= normal.close + 0.25) return null;
    return numToTime(exception.open) + ' à ' + numToTime(exception.close >= 24 ? exception.close - 24 : exception.close);
  }
  window.pgMarques = function (r) {
    var sortie = [];
    if (!r) return sortie;
    var occasion = typeof getReservationOccasion === 'function' ? getReservationOccasion(r) : '';
    if (GF_GROUPES[occasion]) sortie.push({ cle: 'groupe', mot: GF_GROUPES[occasion] });
    var hors = gfHorsHoraires(r);
    if (hors) sortie.push({ cle: 'horaire', mot: 'Hors horaires', detail: 'ouverture exceptionnelle de ' + hors, bulle: 'Hors horaires, ouverture exceptionnelle de ' + hors });
    return sortie;
  };
  // Les seules notes ecrites par l equipe, sans lire le reste du dossier : la liste sous
  // le planning et la regle « Avec note » les comptent comme la ligne du Complet.
  window.pgNotesEquipe = function (r) { return gfNotesEquipe(r || {}).equipe; };
  // Sa ligne : le nom d abord, a la meme place sur chaque ligne ; a sa suite le telephone,
  // toujours, puis le retard, qui se touche (« Ils arrivent dans »), et l etiquette. Une
  // heure pas pile sur la demi-heure s ecrit devant le nom. (le retard ecrit en entier,
  // « En retard · 12 min » et l heure prevue, passe sous le nom quand la place manque :
  // le telephone reste a cote du nom, 2026-11-21)
  function gfPile(g) { return Math.abs(g.heure * 2 - Math.round(g.heure * 2)) * 30 < 0.5; }
  function gfGroupe(g, m) {
    var r = g.r;
    var tete = gfPile(g) ? '' : '<b class="gf-nom__h">' + gpEsc(gpHeure(g.heure)) + '</b>';
    tete += '<span class="gf-nom__t">' + gpEsc(r.name || 'Client') + '</span>';
    window.pgMarques(r).forEach(function (x) { tete += '<span class="gf-nom__m gf-nom__m--' + x.cle + '"' + (x.bulle ? ' title="' + gpEsc(x.bulle) + '"' : '') + '>' + gpEsc(x.mot) + '</span>'; });
    var tel = String(r.phone || '').trim();
    if (tel) tete += '<a class="gf-nom__tel" href="tel:' + gpEsc(tel.replace(/[^0-9+]/g, '')) + '">' + gpEsc(tel) + '</a>';
    // (sans le droit de gerer un retard, le retard se lit sans se toucher, 2026-11-07)
    // LE RETARD EN ROUGE, SES MINUTES ET L HEURE PREVUE (2026-11-21, retardDuGroupe) : « En retard
    // · 12 min » court a la minute (gfRemplir) ; « Arrivé avec 12 min de retard » reste apres
    // « Arrivé » et « Payé », plus sobre.
    if (g.rt && g.rt.etat === 'arrive') {
      tete += '<span class="gf-h__retard is-arrive" data-gf-rt-arrive="' + gpEsc(g.id) + '">' + gpEsc(texteDuRetard(g.rt, m.maintenant)) + '</span>';
    } else if ((g.retard || g.rt) && m.maintenant != null) {
      var dit = '<span data-gf-retard="' + gpEsc(g.id) + '"></span>' + (g.rt && Number.isFinite(g.rt.prevu) ? '<small class="gf-h__prevu">prévu ' + gpEsc(gpHeure(g.rt.prevu)) + '</small>' : '');
      tete += gfPeut('retard') && g.retard
        ? '<button type="button" class="gf-h__retard" data-gf-retarder="' + gpEsc(g.id) + '">' + dit + '</button>'
        : '<span class="gf-h__retard is-lecture">' + dit + '</span>';
    }
    if (typeof isReservationAwaitingReview === 'function' && isReservationAwaitingReview(r)) tete += '<span class="gf-nom__valide">À valider</span>';
    if (g.etat === 'closing') tete += gfPresent(g) ? '<span class="gf-nom__caisse">À encaisser</span>' : '<span class="gf-nom__caisse is-retard">En retard<span class="gf-nom__suite"> · jamais pointé</span></span>';
    // LA PISTE REPRISE APRES EUX, en dernier : le telephone reste sur la ligne du nom, elle
    // passe dessous quand la place manque. Le meme toucher que le retard (« Ils arrivent
    // dans »). Elle change rarement, une fois quand le retard atteint le groupe suivant :
    // elle entre dans le HTML compare, et seule la ligne qui la gagne se reecrit.
    var reprise = g.retard && m.maintenant != null ? gfReprise(g, m) : null;
    if (reprise) {
      tete += gfPeut('retard')
        ? '<button type="button" class="gf-h__reprise" data-gf-retarder="' + gpEsc(g.id) + '" data-gf-reprise="' + gpEsc(g.id) + '" title="' + gpEsc(reprise.bulle) + '">' + gpEsc(reprise.texte) + '</button>'
        : '<span class="gf-h__reprise is-lecture" data-gf-reprise="' + gpEsc(g.id) + '" title="' + gpEsc(reprise.bulle) + '">' + gpEsc(reprise.texte) + '</span>';
    }
    return '<td class="gf-nom"><div class="gf-nom__l">' + tete + '</div>' + g.rubriques.map(function (x) { return x.html; }).join('') + '</td>';
  }
  // UNE RETENUE, EN LIGNE DANS LE TABLEAU (2026-11-05). Les memes cases qu un groupe, hachurees
  // comme sur le planning bowling : ce qu elle tient, quand ca se libere, et aucun geste.
  var GF_CADENAS = '<svg class="gf-nom__cadenas" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
  function gfRetenueHtml(g, m, bloc, classes) {
    var r = g.r;
    var libre = typeof heureLiberationBlocage === 'function' ? heureLiberationBlocage(r) : '';
    var texte = typeof texteBlocageEnLigne === 'function' ? texteBlocageEnLigne(r) : 'Réservation internet en cours.';
    var dit = [];
    var cases = m.colonnes.map(function (col) {
      var liste = g.cases.get(col.cle) || [];
      if (!liste.length) return '<td class="gf-a is-vide"></td>';
      return '<td class="gf-a' + (liste.length > 1 ? ' is-plusieurs' : '') + (liste.length > 2 ? ' is-trois' : '') + '" data-gf-titre="' + gpEsc(col.titre) + '">' + liste.map(function (e) {
        var d = e.pistes ? (e.pistes.length ? gfPistesEnMots(e.pistes) : '') : e.armes ? gfPluriel(e.armes, ['arme', 'armes']) : '';
        dit.push(col.titre + ' à ' + gpHeure(e.start) + (d ? ', ' + d : ''));
        return '<span class="gf-x is-retenue"><b class="gf-x__t">' + gpEsc(gpHeure(e.start)) + '</b>' + (d ? '<span class="gf-x__d">' + gfNumerosEntiers(d) + '</span>' : '') + '</span>';
      }).join('') + '</td>';
    }).join('');
    var tete = gfPile(g) ? '' : '<b class="gf-nom__h">' + gpEsc(gpHeure(g.heure)) + '</b>';
    return '<tr class="gf-r gf-retenue ' + classes + '" title="' + gpEsc(texte) + '" aria-label="' + gpEsc(dit.join(', ') + '. ' + texte) + '">'
      + bloc
      + '<td class="gf-h' + (gfPile(g) ? ' is-pile' : '') + '" data-gf-heure="' + gpEsc(gpHeure(g.heure)) + '"></td>'
      + '<td class="gf-nom"><div class="gf-nom__l">' + tete + GF_CADENAS + '<span class="gf-nom__t">Réservation internet en cours</span></div></td>'
      + '<td class="gf-n"><b>' + (Number(r.pax) || 0) + '</b></td>'
      + gfFormuleCase(g)
      + cases
      + '<td class="gf-reste"></td>'
      + '<td class="gf-etat"><span class="gf-g"><span class="gf-gb gf-gb--etat">' + gpEsc(libre ? 'gardé jusqu’à ' + libre : 'en cours') + '</span></span></td></tr>';
  }
  // LE COMPTE A L ARRIVEE (2026-10-29) : un groupe recompte au comptoir dit
  // son nombre, et dessous celui de la reservation (« 13 », « 10 rés. »).
  function gfNombreReserve(r) {
    var pax = Number(r.pax) || 0;
    return typeof nombreReserve === 'function' ? nombreReserve(r) : pax;
  }
  function gfPersonnes(g) {
    var r = g.r;
    var pax = Number(r.pax) || 0;
    var avec = Math.max(0, Math.trunc(Number(r.companions) || 0));
    var reserve = gfNombreReserve(r);
    var bulle = gfPluriel(pax, ['joueur', 'joueurs']) + (avec ? ' + ' + avec + (avec > 1 ? ' accompagnants' : ' accompagnant') : '') + (reserve !== pax ? ', ' + reserve + ' à la réservation' : '');
    // UN GRAND GROUPE SE REMARQUE (2026-11-03) : les paliers du planning bowling
    // (getGroupSizeClass, app-main.js), une pastille des 15, inversee des 30, en gris.
    var taille = typeof getGroupSizeClass === 'function' ? ' ' + getGroupSizeClass(pax) : '';
    return '<td class="gf-n' + taille + '" title="' + gpEsc(bulle) + '"><b>' + pax + '</b>' + (avec ? '<span class="gf-n__plus">' + gpEsc('et ' + avec + ' accomp.') + '</span>' : '')
      + (reserve !== pax ? '<span class="gf-n__res">' + reserve + ' réservés</span>' : '') + '</td>';
  }
  // La formule, et sous elle « adaptée », puis les cruches quand la rubrique Table ne les
  // dit pas deja. Les extras ont leur rubrique.
  function gfFormuleCase(g) {
    var r = g.r;
    var sous = [];
    if (g.formule && g.formule.adaptee) sous.push('adaptée');
    if (!g.table) sous = sous.concat(g.infos.filter(Boolean));
    var infos = sous.join(' · ');
    var f = '';
    // (« Back To School/Work » peut passer a la ligne apres sa barre)
    if (g.formule) f = '<span class="gf-formule' + (g.formule.court.length > 4 ? ' is-long' : '') + (g.formule.comptoir ? ' is-mesure' : '') + '" title="' + gpEsc(g.formule.long) + '">' + gpEsc(g.formule.court).replace(/\//g, '/<wbr>') + '</span>';
    else if (r.type === 'custom' || r.surMesure === true) f = '<span class="gf-formule is-mesure">Sur mesure</span>';
    return '<td class="gf-f">' + f + (infos ? '<span class="gf-f__i" title="' + gpEsc(infos) + '">' + gpEsc(infos) + '</span>' : '') + '</td>';
  }

  // LE GESTE, AU BORD DROIT (2026-11-02) : toujours a la meme place et a la meme largeur,
  // le mot n y change rien ; une ligne qui change de statut ne bouge rien. Juste a sa
  // gauche, le montant.
  // Le montant d un groupe pas encore paye, quand son prix est connu (la regle de la
  // fiche, prixDossierConnu) : un groupe jamais pointe doit aussi le sien, il ne sort
  // pas sans issue.
  function gfMontantDu(r) {
    if (r.status === 'paid' || r.status === 'cancelled') return '';
    return typeof prixDossierConnu === 'function' && prixDossierConnu(r) ? formatMoneyCentimes(r.price) : '';
  }
  // UN GESTE SE MONTRE A QUI PEUT LE FAIRE (2026-11-07) : la regle du serveur pour
  // chaque geste vit dans la console (peutGeste, assets/app-main.js) ; hors console,
  // tout est permis, comme avant.
  function gfPeut(geste) { return typeof peutGeste !== 'function' || peutGeste(geste); }
  function gfPeutEncaisser() {
    if (typeof encaisserReservation !== 'function' || typeof GROUPE_MOYENS === 'undefined') return false;
    return gfPeut('encaisser');
  }
  // « Carte » et « Espèces », comme sur les cartes de la liste (encaisserReservation,
  // GROUPE_MOYENS) : ouvrir la fiche pour ca coutait trois gestes par groupe qui part.
  function gfPayer(g) {
    return GROUPE_MOYENS.map(function (moyen) {
      return '<button type="button" class="gf-gb gf-gb--payer" data-gf-payer="' + gpEsc(g.id) + '" data-gf-moyen="' + gpEsc(moyen.valeur) + '" aria-label="' + gpEsc((g.r.name || 'Le groupe') + ' : payé, ' + moyen.mot) + '">' + gpEsc(moyen.mot) + '</button>';
    }).join('');
  }
  function gfPeutArriver(g, m) {
    var r = g.r;
    if (!m.aujourdHui || g.etat !== 'upcoming' || r.status === 'paid' || r.status === 'arrived' || r.absentAt) return false;
    if (typeof setReservationStatusDirect !== 'function') return false;
    return gfPeut('etat');
  }
  // « PAS VENU » : discret, a l ecart du geste, sur un groupe en retard ou jamais
  // pointe a la fin de sa visite. La regle de la fiche, une seule source. Il s annule
  // depuis la fiche.
  // (a +10 min, le groupe se gare : le bouton trainait sur chaque ligne du rush. Et un
  // groupe qui a annonce son retard n est pas un groupe qui ne vient pas)
  var GF_PAS_VENU_MIN = 15;
  function gfPasVenu(g, m) {
    var tard = g.retard && m.maintenant != null && gfMinutesDeRetard(g, m) >= GF_PAS_VENU_MIN && !(typeof getReservationDelayFlag === 'function' && getReservationDelayFlag(g.r));
    if (!(tard || (g.etat === 'closing' && !gfPresent(g)))) return '';
    if (typeof renderGroupePasVenu !== 'function' || !renderGroupePasVenu(g.r)) return '';
    return '<button type="button" class="gf-pv" data-gf-absent="' + gpEsc(g.id) + '" aria-label="' + gpEsc((g.r.name || 'Le groupe') + ' : pas venu') + '">Pas venu</button>';
  }
  // « Ils sont 10 » : pointe, le groupe se recompte d un geste (ouvrirCompteArrivee,
  // app-main.js). Qui ne modifie pas voit le nombre.
  function gfArrive(r) {
    var n = Number(r.pax) || 0;
    if (typeof peutCompterArrivee === 'function' && peutCompterArrivee(r)) {
      return '<button type="button" class="gf-gb gf-gb--etat gf-compte" data-compte-id="' + gpEsc(r.id) + '" aria-haspopup="dialog" aria-label="' + gpEsc('Arrivé, ils sont ' + n + ' : changer le nombre') + '">Ils sont ' + n + '</button>';
    }
    return '<span class="gf-gb gf-gb--etat">Ils sont ' + n + '</span>';
  }
  // (a virgule ou a quatre chiffres, le montant se resserre a l etroit)
  function gfDu(du) {
    return '<b class="gf-du' + (du.length > 5 ? ' is-long' : '') + '">' + gpEsc(du) + '</b>';
  }
  // LE MONTANT, TOUJOURS A DROITE (l audit du 2026-11-03) : avant l arrivee et apres le
  // paiement, avec « payé » quand il l est. Sur un groupe sur place, il se touche : Carte et
  // Espèces. « Pas venu » attend dessous, loin de « Arrivé ».
  function gfResteCase(g, m, q) {
    var r = g.r;
    var h = '';
    if (r.status === 'paid') {
      var regle = typeof prixDossierConnu === 'function' && prixDossierConnu(r) ? formatMoneyCentimes(r.amountPaid != null ? r.amountPaid : r.price) : '';
      h = (regle ? gfDu(regle) : '') + '<span class="gf-du__paye">payé</span>';
    } else {
      var du = gfMontantDu(r);
      if (!du) h = g.etat === 'closing' ? '<span class="gf-du is-sans">Prix à voir</span>' : '';
      // UN GROUPE SUR PLACE PAIE D UN GESTE (2026-11-02) : le montant ouvre Carte et
      // Espèces. Payer passait par la fiche.
      else if (g.etat !== 'closing' && g.teinte === 'arr' && gfPeutEncaisser() && !q) h = '<button type="button" class="gf-du gf-du--b' + (du.length > 5 ? ' is-long' : '') + '" data-gf-encaisser="' + gpEsc(g.id) + '" aria-label="' + gpEsc((r.name || 'Le groupe') + ' : encaisser ' + du) + '">' + gpEsc(du) + '</button>';
      else h = gfDu(du);
    }
    return '<td class="gf-reste">' + h + gfPasVenu(g, m) + '</td>';
  }
  // Le moment du groupe decide du geste, le statut ne fait que le teinter.
  function gfEtatCase(g, m, q) {
    var r = g.r;
    var h = '';
    if (g.etat === 'closing') {
      var du = gfMontantDu(r);
      h = du && gfPeutEncaisser() ? gfPayer(g) : '<button type="button" class="gf-gb" data-gf-fiche="' + gpEsc(g.id) + '" aria-label="' + gpEsc('Clôturer ' + (r.name || 'le groupe')) + '">Clôturer</button>';
    } else if (gfPeutArriver(g, m)) {
      h = '<button type="button" class="gf-gb gf-gb--arrive" data-gf-arrive="' + gpEsc(g.id) + '" aria-label="' + gpEsc('Pointer ' + (r.name || 'le groupe') + ' arrivé') + '">Arrivé</button>';
    } else if (g.etat === 'absent' || g.teinte === 'absent') {
      h = '<span class="gf-gb gf-gb--etat">Pas venu</span>';
    } else if (g.teinte === 'paid') {
      h = '<span class="gf-gb gf-gb--etat">Payé</span>';
    } else if (g.teinte === 'arr') {
      var duIci = gfPeutEncaisser() ? gfMontantDu(r) : '';
      // (un nom tape : le client qui dit « on peut payer ? » trouve ses deux boutons, sa
      // ligne prend une seconde rangee)
      if (q && duIci) return '<td class="gf-etat is-double"><span class="gf-g">' + gfArrive(r) + '</span><span class="gf-g">' + gfPayer(g) + '</span></td>';
      h = gfArrive(r);
    } else if (!m.aujourdHui) {
      // UN AUTRE JOUR, IL N Y A RIEN A FAIRE SUR PLACE : le geste de ce jour-la, c est
      // d appeler (l audit du 2026-11-03 : la colonne restait vide).
      var tel = String(r.phone || '').trim();
      if (tel) h = '<a class="gf-gb gf-gb--tel" href="tel:' + gpEsc(tel.replace(/[^0-9+]/g, '')) + '">' + gpEsc(tel) + '</a>';
    }
    return '<td class="gf-etat"><span class="gf-g">' + gfStatutHtml(g, h) + '</span></td>';
  }
  // LE STATUT SE CHANGE SUR LA LIGNE (2026-11-03, Movsar : « on doit pouvoir appuyer et que
  // ça mette direct sur confirmé ou payé ou autre ») : le geste du moment garde son bouton,
  // et la fleche a sa droite ouvre tous les statuts. Sans geste, l etat lui-meme ouvre la
  // liste. La fleche est toujours a la meme place.
  var GF_STATUTS = { pending: 'Confirmé', arrived: 'Arrivé', paid: 'Payé' };
  function gfPeutStatuer(r) {
    if (r.status === 'cancelled' || typeof setReservationStatusDirect !== 'function') return false;
    return gfPeut('etat') || gfPeutEncaisser();
  }
  function gfMotDuStatut(g) {
    if (g.etat === 'absent' || g.teinte === 'absent') return 'Pas venu';
    return GF_STATUTS[g.r.status] || 'Confirmé';
  }
  function gfStatutHtml(g, h) {
    var r = g.r;
    if (!gfPeutStatuer(r)) return h;
    var dit = (r.name || 'Le groupe') + ' : changer le statut (' + gfMotDuStatut(g) + ')';
    // (la fleche est dessinee par la feuille de style : aucun element de plus par ligne)
    // (« Payé », « Pas venu », ou rien : c est l etat qui ouvre la liste. « Ils sont 8 » reste
    // ecrit pour qui ne recompte pas, la fleche a sa droite)
    if (!h || /^<span class="gf-gb gf-gb--etat">(Payé|Pas venu)<\/span>$/.test(h)) {
      return '<button type="button" class="gf-gb gf-gb--statut" data-gf-statut="' + gpEsc(g.id) + '" aria-haspopup="menu" aria-label="' + gpEsc(dit) + '"><span>' + gpEsc(gfMotDuStatut(g)) + '</span></button>';
    }
    return h + '<button type="button" class="gf-gb gf-gb--fleche" data-gf-statut="' + gpEsc(g.id) + '" aria-haspopup="menu" aria-label="' + gpEsc(dit) + '"></button>';
  }

  // Ce qu une ligne dit a un lecteur d ecran, d une traite.
  function gfAria(g, m) {
    var r = g.r;
    var reserve = gfNombreReserve(r);
    var parts = [gpHeure(g.heure), r.name || 'Client', gfPluriel(Number(r.pax) || 0, ['joueur', 'joueurs']) + (reserve !== (Number(r.pax) || 0) ? ', ' + reserve + ' à la réservation' : '')];
    if (g.formule) parts.push(g.formule.long);
    m.colonnes.forEach(function (c) {
      var liste = g.cases.get(c.cle) || [];
      if (!liste.length) return;
      parts.push(c.titre + ' ' + liste.map(function (e) {
        if ((g.illimite || e.illimite) && !e.credit) return e.volonte ? 'à volonté' : 'illimité';
        if (e.aPlacer) return 'à placer';
        if (e.credit) return e.credits && e.credits.euros != null ? gpMontant(e.credits.euros) + (e.credits.detail ? ' ' + e.credits.detail : '') : (e.credits ? e.credits.total : 0) + ' crédits';
        if (e.libre && !e.journee) return 'sans heure fixe ' + GF_ETATS[gfEtat(g, e, m)];
        return gpHeure(e.journee ? g.span.start : e.start) + ' ' + GF_ETATS[gfEtat(g, e, m)];
      }).join(', '));
    });
    parts.push(g.etat === 'absent' ? 'pas venu' : ({ conf: 'confirmé', arr: 'arrivé', paid: 'payé', absent: 'pas venu' })[g.teinte]);
    var du = gfMontantDu(r);
    if (du) parts.push((g.etat === 'closing' ? 'à encaisser ' : 'reste ') + du);
    g.rubriques.forEach(function (x) { parts.push(x.mot + ' : ' + (x.allergie ? 'allergie, ' : '') + x.texte); });
    // (les minutes de retard changent a chaque minute : elles sont dans la
    // bulle du retard, la ligne ne se reecrit pas pour elles)
    if (g.retard && m.maintenant != null) parts.push('en retard');
    return parts.join(', ');
  }

  // LA RECHERCHE : le nom, le telephone, l email, le libelle, sans accents.
  function gfCle(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }
  // ET CE QUI EST ECRIT SUR LA LIGNE (2026-11-02, audit joue sur la vraie console) :
  // l heure (« 15:00 », « 15h », celle de la ligne ou d une activite), la piste
  // (« P3 »), le nombre (« 10 pers »). Le comptoir cherche autant comme ca que par le nom.
  var GF_Q_HEURE = /^(\d{1,2})\s*[:h]\s*(\d{0,2})$/;
  var GF_Q_PISTE = /^(?:p|piste)\s*(\d{1,2})$/;
  var GF_Q_PERS = /^(\d{1,3})\s*(?:p|pers|personnes?|joueurs?|j)\.?$/;
  function gfHeuresDe(g) {
    var heures = [gpHeure(g.heure)];
    g.cases.forEach(function (liste) {
      liste.forEach(function (e) { if (e.start != null && !e.libre) heures.push(gpHeure(e.start)); });
    });
    return heures;
  }
  // (le nom, le numero : une heure, une piste, un nombre, une faute trouvent une ligne,
  // Entree ne pointe que ca : un Dupont sans reservation ne fait pas arriver un Dumont)
  function gfTrouveParNom(g, q) {
    return gfCle([g.r.name, g.r.phone, g.r.email].join(' ')).indexOf(q) >= 0;
  }
  function gfTrouve(g, q) {
    if (!q) return true;
    var r = g.r;
    // Le numero de la reservation (« 1734 », « n° 1734 ») : celui du dossier,
    // du mail du client et de Telegram (numeroReservationDe, app-main).
    var numero = typeof numeroReservationDe === 'function' ? numeroReservationDe(q) : '';
    if (numero && String(r.id) === numero) return true;
    if (gfCle([r.name, r.phone, r.email, r.label, g.formule && g.formule.long].concat(g.rubriques.map(function (x) { return x.texte; })).join(' ')).indexOf(q) >= 0) return true;
    var heure = GF_Q_HEURE.exec(q);
    if (heure) {
      var hh = heure[1].padStart(2, '0');
      return gfHeuresDe(g).some(function (h) { return h.slice(0, 2) === hh && h.slice(3).indexOf(heure[2]) === 0; });
    }
    var piste = GF_Q_PISTE.exec(q);
    if (piste) return (g.cases.get('bowling') || []).some(function (e) { return (e.pistes || []).indexOf(Number(piste[1])) >= 0; });
    var pers = GF_Q_PERS.exec(q);
    return Boolean(pers) && Number(r.pax) === Number(pers[1]);
  }
  // (une faute legere, « mason » pour Masson, ne joue que si rien d exact n existe :
  // elle ne change ni ce qu un nom juste montre, ni ce qu Entree pointe)
  function gfRecherche(m, q) {
    if (!q) return m.groupes;
    var justes = m.groupes.filter(function (g) { return gfTrouve(g, q); });
    if (justes.length || typeof nomRessemble !== 'function') return justes;
    return m.groupes.filter(function (g) { return nomRessemble(gfCle(g.r.name), q); });
  }

  // (la liste sous le tableau montre ce que le tableau a trouve : « 15:00 » y disait
  // « Aucun résultat » juste sous les groupes de 15:00)
  window.gfIdsTrouves = function () {
    var wrap = document.getElementById('globalPlanningGridWrap');
    var m = wrap && wrap._gfModele;
    if (!m) return null;
    return new Set(gfRecherche(m, gfCle(state.searchTerm || '')).map(function (g) { return g.r.id; }));
  };

  // ---- LE GRAND TABLEAU EN HTML ----------------------------------------------------
  // Les colonnes ont leur vraie largeur, posee une fois pour toutes (table-layout:
  // fixed, assets/pinlane-planning-global.css) : une ligne qui s ecrit ne remesure
  // pas la table. Une activite du centre sans groupe ce jour-la se resserre.
  function gfColonnes(m) {
    var c = '<col class="gf-c-bloc"><col class="gf-c-h"><col class="gf-c-nom"><col class="gf-c-n"><col class="gf-c-f">';
    m.colonnes.forEach(function () { c += '<col class="gf-c-a">'; });
    return '<colgroup>' + c + '<col class="gf-c-reste"><col class="gf-c-etat"></colgroup>';
  }
  function gfTete(m) {
    var html = '<th class="gf-th gf-th--h" scope="col" colspan="2" title="L’heure de la réservation">Heure</th><th class="gf-th gf-th--nom" scope="col">Groupe</th><th class="gf-th gf-th--n" scope="col">Joueurs</th><th class="gf-th gf-th--f" scope="col">Formule</th>';
    m.colonnes.forEach(function (c) {
      var et = m.etat && m.etat[c.cle];
      html += '<th class="gf-th gf-th--a' + (c.titre.length > 14 ? ' is-long' : '') + '" scope="col" data-gf-cle="' + gpEsc(c.cle) + '" title="' + gpEsc(c.titre + ' : ' + c.groupes + (c.groupes > 1 ? ' groupes' : ' groupe') + (et ? ' · ' + et.bulle : '')) + '">' + gpEsc(c.titre) + '</th>';
    });
    return html + '<th class="gf-th gf-th--reste" scope="col" title="Ce qui reste à payer, ou ce qui est payé">Reste</th><th class="gf-th gf-th--etat" scope="col">À faire</th>';
  }
  // L HEURE QU IL EST COUPE LE TABLEAU : une regle noire d un bord a l autre, qui
  // n est d aucune couleur de statut.
  // ELLE NE PREND AUCUNE PLACE ET TOMBE A SA MINUTE (2026-11-06, Ansar : « la barre qui
  // montre l heure actuelle [...] elle perturbe, place-la bien par temps »). Elle etait une
  // rangee de plus, 16 px qui poussaient la feuille, et a 20:38 elle se posait au bord de
  // 21:00, apres la demi-heure libre de 20:30. Elle se trace maintenant sur le bord entre
  // deux lignes, sans hauteur ; et quand la demi-heure en cours est libre, elle se trace
  // DANS cette demi-heure, a la hauteur de sa minute (20:38, au quart de 20:30). La rangee
  // reste dans le tableau, sans trait, comme ancre : la feuille qui suit l heure et le
  // bouton « Maintenant » la lisent.
  function gfMaintenant(nbCol, ancre) {
    return '<tr class="gf-now' + (ancre ? ' is-ancre' : '') + '" aria-hidden="true"><td colspan="' + nbCol + '"><span class="gf-now__h" data-gf-maintenant></span></td></tr>';
  }
  function gfMaintenantDansLibre(b) {
    return '<span class="gf-now__l" aria-hidden="true" data-gf-now-libre="' + b + '"><span data-gf-maintenant class="gf-now__h"></span></span>';
  }
  function gfBloc(heure) {
    var b = Math.floor(heure * 2 + 1e-6) / 2;
    return b;
  }
  // LA GRANDE CASE D UNE DEMI-HEURE, comme sur le papier : elle couvre toutes ses
  // lignes, dit l heure, ce qui reste (les pistes libres, les places au laser), ce qui
  // arrive, et la ressource pleine (2026-10-27 : rouge seulement la, le quart d heure
  // plein de Resy). Un toucher reserve a cette heure : la reponse au telephone est deja
  // sur le tableau. Une ligne seule n a pas la hauteur de tout dire, elle garde
  // l essentiel. Le filtre et la recherche comptent ce qu ils montrent ; la charge, elle,
  // compte tout le centre.
  function gfBlocCase(m, part, compte, bande) {
    var classes = 'gf-bloc' + (bande ? ' is-bande' : '') + (part.quand ? ' is-' + part.quand : '');
    var prive = m.prive ? m.prive(part.b) : null;
    if (prive && prive.centre) classes += ' is-prive';
    var attr = ' rowspan="' + Math.max(1, part.lignes.length) + '"';
    // (la barre de l heure tombe dans la demi-heure : ce qui suit reste dans son bloc)
    if (part.suite) return '<td class="' + classes + ' is-suite"' + attr + '></td>';
    var heure = gpHeure(part.b);
    // (ce qui est passe n a plus rien a offrir, un jour ferme non plus)
    var ouvert = part.quand !== 'passe' && !(m.fenetre && m.fenetre.closed) && !(m.maintenant == null && state.currentDate < todayStr()) && !(prive && prive.centre);
    var place = ouvert ? m.charge.place(part.b) : null;
    var seule = part.lignes.length < 2;
    var lignes = [];
    // (privatise : le mot remplace « complet », la ressource n est pas pleine, elle est prise)
    var privees = prive ? m.colonnes.filter(function (col) { return prive.centre || col.activites.some(function (a) { return prive.refs.indexOf(a) >= 0; }); }) : [];
    if (prive) lignes.push({ html: '<span class="gf-bloc__prive" title="' + gpEsc(prive.dit) + '">' + gpEsc(prive.centre || !privees.length ? 'privatisé' : privees.map(function (c) { return c.titre; }).join(', ') + ' privatisé') + '</span>', hauteur: 1 });
    m.colonnes.forEach(function (col) {
      if (privees.indexOf(col) >= 0) return;
      var plein = m.charge(part.b, col);
      if (plein) lignes.push({ html: '<span class="gf-bloc__plein" title="' + gpEsc(plein.bulle) + '">' + gpEsc(seule ? plein.texte : col.titre + ' ' + plein.texte) + '</span>', hauteur: seule ? 1 : 2 });
    });
    // (en toutes lettres, 2026-11-03, Movsar : « piste 7 laser 30 et tout c moche on capte
    // pas » : ce qui reste se dit « libre »)
    if (place && place.pistes) lignes.push({ html: '<span>' + gpEsc(gfPluriel(place.pistes, m.blocCourt ? ['piste', 'pistes'] : ['piste libre', 'pistes libres'])) + '</span>', hauteur: 1 });
    if (place && place.laser) lignes.push({ html: '<span>' + gpEsc(gfPluriel(place.laser, m.blocCourt ? ['arme', 'armes'] : ['arme libre', 'armes libres'])) + '</span>', hauteur: 1 });
    if (compte.pers) lignes.push({ html: '<span>' + gpEsc(gfPluriel(compte.pers, ['joueur', 'joueurs'])) + '</span>', hauteur: 1 });
    // (la case n a que la hauteur de ses lignes : une ligne, un mot sous l heure)
    var reste = seule ? 1 : part.lignes.length === 2 ? 3 : part.lignes.length * 2;
    var dessous = '';
    lignes.forEach(function (l) {
      if (l.hauteur > reste) return;
      reste -= l.hauteur;
      dessous += l.html;
    });
    var corps = '<b>' + gpEsc(heure) + '</b>' + dessous;
    // (une heure ne se reserve qu avec « Réserver au comptoir » : sinon elle se lit, 2026-11-07)
    if (!ouvert || !gfPeut('reserver')) return '<td class="' + classes + '"' + attr + ' data-gf-bloc="' + gpEsc(heure) + '"><span class="gf-bloc__in">' + corps + '</span></td>';
    var dit = 'Réserver à ' + heure + (place.pistes ? ', ' + gfPluriel(place.pistes, ['piste libre', 'pistes libres']) : '') + (place.laser ? ', ' + gfPluriel(place.laser, ['place', 'places']) + ' au laser' : '');
    return '<td class="' + classes + '"' + attr + ' data-gf-bloc="' + gpEsc(heure) + '" data-gf-reserver="' + gpEsc(heure) + '"><button type="button" class="gf-bloc__in" title="' + gpEsc(dit) + '" aria-label="' + gpEsc(dit) + '">' + corps + '</button></td>';
  }
  // LA BARRE DU STATUT, A GAUCHE DE LA LIGNE. L heure de la ligne est dans la grande case
  // de sa demi-heure, ou devant le nom si elle n est pas pile (14:10) ; au telephone, la
  // carte la dit par l attribut, sans un element de plus par ligne.
  function gfHeureCase(g) {
    return '<td class="gf-h' + (gfPile(g) ? ' is-pile' : '') + '" data-gf-heure="' + gpEsc(gpHeure(g.heure)) + '"></td>';
  }
  // PERSONNE A CE NOM CE JOUR-LA (2026-11-02, audit joue sur la vraie console). « Nom pas
  // trouvé » coutait 15 gestes : le tableau disait « Aucun groupe », sans un bouton, et
  // la recherche de toutes les dates vivait sur la page Réservations. Dessous, les
  // autres dates, une ligne par reservation, qui ouvre sa fiche sans quitter le jour ;
  // et « Réserver pour Dupont », avec le nom tape. La lecture est lourde (14 mois) :
  // une seule a la fois, gardee une minute, et si elle echoue, pas avant 30 s.
  var gfAilleursLe = -Infinity;
  function gfChercherAilleurs() {
    var etat = window.pv2ResSearchEtat();
    var t = Date.now();
    // (14 mois, par pages : pas a chaque client de passage. Une reservation prise ici
    // s y ajoute d elle-meme, pv2ResSearchAjouter)
    if (etat.frais || etat.charge || t - gfAilleursLe < (etat.erreur ? 30000 : 300000)) return;
    gfAilleursLe = t;
    window.pv2ResSearchEnsureData(false).then(function () {
      var wrap = document.getElementById('globalPlanningGridWrap');
      if (wrap && wrap._gfRacine && wrap._gfRacine.isConnected) renderGlobalPlanning(wrap);
    });
  }
  function gfAutresDatesHtml(m, terme) {
    if (typeof window.pv2ResSearchMatches !== 'function' || terme.length < 2) return '';
    gfChercherAilleurs();
    var etat = window.pv2ResSearchEtat();
    if (!etat.lu) return '<span class="gf-rien__etat">' + (etat.erreur ? 'Les autres dates ne répondent pas.' : 'Recherche dans les autres dates…') + '</span>';
    var lignes = window.pv2ResSearchMatches(terme).filter(function (r) { return r.date !== m.jour; });
    if (!lignes.length) return '<span class="gf-rien__etat">Rien non plus aux autres dates.</span>';
    return '<span class="gf-rien__titre" id="gfAutresDates">Autres dates</span><ul class="gf-rien__liste" aria-labelledby="gfAutresDates">' + lignes.map(function (r) {
      var quand = (typeof formatQuickBookDateLabel === 'function' ? formatQuickBookDateLabel(r.date) : r.date) + ' · ' + String(r.startTime || '').slice(0, 5);
      var n = Number(r.pax) || 0;
      return '<li><button type="button" class="gf-rien__l" data-id="' + gpEsc(r.id) + '" onclick="pv2ResSearchOpen(this.dataset.id, true)"><span class="gf-rien__q">' + gpEsc(quand) + '</span><span class="gf-rien__n">' + gpEsc(r.name || 'Client') + '</span><span class="gf-rien__p">' + gpEsc(gfPluriel(n, ['joueur', 'joueurs'])) + '</span></button></li>';
    }).join('') + '</ul>';
  }
  // (une heure, une piste, un nombre, un e-mail ne sont pas des noms de client)
  function gfNomTape(terme, q) {
    return /\p{L}{2}/u.test(terme) && terme.indexOf('@') < 0 && !GF_Q_HEURE.test(q) && !GF_Q_PISTE.test(q) && !GF_Q_PERS.test(q);
  }
  // UN GROUPE CACHE PAR UN FILTRE N EST PAS UN GROUPE ABSENT : sous « En retard »,
  // chercher Masson, attendu a 18:00, disait « aucun groupe » et proposait de le
  // reserver, un doublon pour un client deja dans la journee.
  function gfRienHtml(m, q) {
    var caches = m.visibles ? gfRecherche(m, q).length : 0;
    if (caches) {
      return '<div class="gf-rien__tete"><b>' + gpEsc(gfPluriel(caches, ['groupe trouvé, caché', 'groupes trouvés, cachés'])) + ' par ce filtre</b>'
        + '<button type="button" class="gf-rien__reserver" onclick="setStaffStatusFilter(\'all\')">Enlever le filtre</button></div>';
    }
    var terme = String(state.searchTerm || '').trim();
    var peut = gfPeut('reserver');
    var reserver = peut && gfNomTape(terme, q)
      ? '<button type="button" class="gf-rien__reserver" data-nom="' + gpEsc(terme) + '" onclick="reserverAuComptoir({ name: this.dataset.nom })">Réserver pour ' + gpEsc(terme) + '</button>'
      : '';
    return '<div class="gf-rien__tete"><b>Aucun groupe ne correspond à « ' + gpEsc(terme) + ' »' + (m.aujourdHui ? ' aujourd’hui' : '') + '</b>' + reserver + '</div>'
      + (reserver || !peut ? '' : '<span>Pour un client sans réservation, touchez « + Réservation » en haut à droite.</span>')
      + gfAutresDatesHtml(m, terme);
  }
  function gfParties(m, q, cartes) {
    gfFinisCourant = new Set();
    gfFenetreOuverte = gfUneFenetreCouvre();
    // (les droits du geste de l heure, lus une fois par rendu : chaque pastille les relit)
    m.droitsHeure = gfDroitsHeure(m.jour);
    var nbCol = 7 + m.colonnes.length;
    var lignes = gfRecherche(m, q).filter(function (g) { return !m.visibles || m.visibles.has(g.id); });
    // (au telephone, la page defile : les groupes finis se replient, une ligne les
    // rend. Une recherche ou un filtre montre tout ce qu il trouve.)
    var finis = cartes && m.aujourdHui && !q && !m.visibles ? lignes.filter(function (g) { return g.parti; }) : [];
    var plis = finis.length >= GF_PLIS_MIN;
    if (plis && !gfFinisOuverts) lignes = lignes.filter(function (g) { return !g.parti; });
    var parBloc = new Map();
    lignes.forEach(function (g) {
      var b = gfBloc(g.heure);
      var c = parBloc.get(b) || { groupes: 0, pers: 0 };
      c.groupes += 1;
      c.pers += Number(g.r.pax) || 0;
      parBloc.set(b, c);
    });
    // LA JOURNEE EN MORCEAUX : une demi-heure, coupee en deux si la barre de l heure
    // tombe dans ses lignes. Pas de barre sur un nom tape : ce sont des resultats.
    // LA JOURNEE ENTIERE (Movsar, 2026-11-03 : « laisse tout le planning complet avec heure
    // meme vide ») : chaque demi-heure d ouverture a sa case, meme sans groupe, et se touche
    // pour reserver. Un jour vide ou calme se lit comme un planning, pas comme une page
    // cassee. Pas sur un nom tape, un filtre ou au telephone : ce sont des resultats.
    var retenues = q || m.visibles ? [] : m.retenues;
    var suite = retenues.length ? lignes.concat(retenues).sort(function (a, b) { return a.heure - b.heure; }) : lignes;
    var fen = m.fenetre;
    if (!q && !m.visibles && !cartes && fen && !fen.closed && fen.close > fen.open) {
      var pris = new Set(suite.map(function (g) { return gfBloc(g.heure); }));
      suite = suite.slice();
      for (var b0 = Math.ceil(fen.open * 2 - 1e-6) / 2; b0 < fen.close - 1e-6; b0 += 0.5) if (!pris.has(b0)) suite.push({ libre: true, heure: b0 });
      suite.sort(function (a, b) { return a.heure - b.heure; });
    }
    var morceaux = [];
    var nowPose = m.maintenant == null || Boolean(q);
    var courant = null, dernier = null;
    suite.forEach(function (g) {
      var b = gfBloc(g.heure);
      if (!nowPose && g.heure > m.maintenant + 1e-6) { morceaux.push(null); nowPose = true; courant = null; }
      if (!courant || courant.b !== b) {
        var quand = m.maintenant == null ? '' : b + 0.5 <= m.maintenant + 1e-6 ? 'passe' : b - m.maintenant <= GF_BIENTOT + 1e-6 ? 'proche' : '';
        courant = { b: b, lignes: [], suite: dernier === b, quand: quand };
        morceaux.push(courant);
        dernier = b;
      }
      if (!g.libre) courant.lignes.push(g);
    });
    var rangees = [];
    // (la premiere rangee et celle qui suit la barre de l heure n ont pas de filet)
    var poser = function (cle, html) {
      // (l ancre sans trait laisse son filet a la ligne qui suit)
      var avant = rangees[rangees.length - 1];
      var nu = !avant || (avant.cle === 'maintenant' && avant.html.indexOf(' is-ancre') < 0);
      rangees.push({ cle: cle, html: nu ? html.replace('<tr class="', '<tr class="gf-sans-filet ') : html });
    };
    if (plis) {
      var mot = gfPluriel(finis.length, ['groupe fini', 'groupes finis']);
      poser('plis', '<tr class="gf-plis"><td colspan="' + nbCol + '"><button type="button" class="gf-plis__b" data-gf-plis aria-expanded="' + gfFinisOuverts + '">' + gpEsc(gfFinisOuverts ? 'Replier les ' + mot : mot + ' · Voir') + '</button></td></tr>');
    }
    if (q) {
      var terme = String(state.searchTerm || '').trim();
      var seul = lignes.length === 1 && gfPeutArriver(lignes[0], m) && gfTrouveParNom(lignes[0], q);
      if (lignes.length) poser('resultats', '<tr class="gf-resultats"><td colspan="' + nbCol + '"><b>' + gpEsc(gfPluriel(lignes.length, ['groupe', 'groupes'])) + '</b> pour « ' + gpEsc(terme) + ' »' + (seul ? ' · Entrée pour pointer Arrivé' : lignes.length === 1 && typeof numeroReservationDe === 'function' && numeroReservationDe(q) ? ' · Entrée pour ouvrir la réservation' : '') + '</td></tr>');
    }
    var bande = false, avantB = null;
    // (la demi-heure libre ou tombe l heure porte le trait ; la rangee de l heure, juste
    // apres elle, n est plus que l ancre)
    var dansLibre = false;
    morceaux.forEach(function (part) {
      if (!part) { poser('maintenant', gfMaintenant(nbCol, dansLibre)); return; }
      if (!part.lignes.length) {
        dansLibre = !q && m.maintenant != null && part.b <= m.maintenant + 1e-6 && m.maintenant < part.b + 0.5 - 1e-6;
        poser('libre:' + part.b, '<tr class="gf-libre is-bloc' + ((m.prive && m.prive(part.b) || {}).centre ? ' is-prive' : '') + '">' + gfBlocCase(m, part, { groupes: 0, pers: 0 }, false) + '<td class="gf-libre__l" colspan="' + (nbCol - 1) + '">' + (dansLibre ? gfMaintenantDansLibre(part.b) : '') + '</td></tr>');
        return;
      }
      dansLibre = false;
      if (avantB !== null && part.b !== avantB) bande = !bande;
      avantB = part.b;
      part.lignes.forEach(function (g, i) {
        var nouveau = i === 0;
        if (g.retenue) {
          poser('retenue:' + g.id, gfRetenueHtml(g, m, nouveau ? gfBlocCase(m, part, parBloc.get(part.b) || { groupes: 0, pers: 0 }, bande) : '', (bande ? 'is-bande' : '') + (nouveau && !part.suite ? ' is-bloc' : '')));
          return;
        }
        var proche = g.retard || (m.maintenant != null && g.etat === 'upcoming' && g.heure - m.maintenant <= GF_BIENTOT + 1e-6);
        var classes = 'gf-r t-' + g.teinte + (g.parti ? ' is-parti' : '') + (g.etat === 'absent' ? ' is-absent' : '') + (g.retard ? ' is-retard' : '') + (g.rt ? (g.rt.etat === 'arrive' ? ' is-rt-arrive' : ' is-rt') : '') + (proche ? ' is-proche' : '') + (g.etat === 'upcoming' && !proche ? ' is-loin' : '') + (g.etat === 'closing' ? ' is-caisse' : '') + (bande ? ' is-bande' : '') + (nouveau && !part.suite ? ' is-bloc' : '');
        poser('groupe:' + g.id, '<tr class="' + classes + '" tabindex="0" data-gf-id="' + gpEsc(g.id) + '" aria-label="' + gpEsc(gfAria(g, m)) + '">'
          + (nouveau ? gfBlocCase(m, part, parBloc.get(part.b), bande) : '')
          + gfHeureCase(g) + gfGroupe(g, m) + gfPersonnes(g) + gfFormuleCase(g)
          + m.colonnes.map(function (c) { return gfCase(g, c, m); }).join('')
          + gfResteCase(g, m, q) + gfEtatCase(g, m, q) + '</tr>');
      });
    });
    if (!nowPose && suite.length) poser('maintenant', gfMaintenant(nbCol, dansLibre));
    if (!lignes.length && (m.groupes.length || q)) {
      poser('rien', '<tr class="gf-rien"><td colspan="' + nbCol + '">' + (q ? gfRienHtml(m, q) : '<b>Aucun groupe dans ce filtre</b>') + '</td></tr>');
    }
    gfFinisVus = { jour: m.jour, cles: gfFinisCourant };
    return {
      table: '<table class="gf-t' + (m.colonnes.length > 8 ? ' is-serre' : m.colonnes.length > 6 ? ' is-dense' : '') + '" style="--gf-nb:' + m.colonnes.length + '" aria-label="' + gpEsc('Feuille du ' + m.jour + ' : un groupe par ligne, ses activités en colonnes') + '">',
      colonnes: m.colonnes.map(function (c) { return c.cle + (c.groupes ? '' : '-'); }).join('|'),
      entete: gfColonnes(m),
      tete: gfTete(m),
      rangees: rangees,
    };
  }

  // SEULE LA LIGNE QUI CHANGE S ECRIT (2026-11-02, Movsar : « met toi dans la
  // peau d un etudiant en plein rush [...] ça rame sur des PC moins puissants »).
  // Un « Arrivé » reconstruisait les 2 000 elements de la feuille : analyse du
  // HTML, style, mise en page, accessibilite et peinture de toute la table sur
  // un petit PC. Chaque rangee porte une cle (le groupe, la barre de l heure) et
  // le HTML de son dernier rendu : une rangee identique reste dans la page, une
  // rangee neuve se pose a sa place, une rangee partie s en va. La table entiere
  // ne se reecrit qu a l ouverture d un jour ou quand les colonnes changent.
  function gfRangeesDe(tbody, rangees) {
    var trs = Array.prototype.slice.call(tbody.children);
    var lignes = new Map();
    rangees.forEach(function (r, i) { lignes.set(r.cle, { html: r.html, tr: trs[i] }); });
    return lignes;
  }
  function gfEcrireTout(wrap, defile, p) {
    defile.innerHTML = p.table + p.entete + '<thead><tr>' + p.tete + '</tr></thead><tbody>' + p.rangees.map(function (r) { return r.html; }).join('') + '</tbody></table>';
    wrap._gfLignes = gfRangeesDe(defile.querySelector('tbody'), p.rangees);
    wrap._gfParties = p;
    gfStats.ecritures += 1;
  }
  function gfEcrire(wrap, defile, p, remplir) {
    var avant = wrap._gfParties;
    var tbody = defile.querySelector('tbody');
    if (!avant || !tbody || avant.table !== p.table || avant.colonnes !== p.colonnes) { gfEcrireTout(wrap, defile, p); return; }
    var ecrit = false;
    if (avant.tete !== p.tete) {
      defile.querySelector('thead tr').innerHTML = p.tete;
      ecrit = true;
    }
    var anciennes = wrap._gfLignes;
    var nouvelles = new Map();
    var neuves = [];
    // UNE LIGNE NE CHANGE JAMAIS DE PLACE QUAND UN STATUT CHANGE. « Arrivé » retire le
    // retard de la ligne du nom : sur un nom long il passait a la ligne, la rangee perdait
    // 20 px et toutes celles du dessous remontaient sous le doigt. Une rangee reecrite
    // garde sa hauteur, tant que la table n est pas reecrite entiere.
    var hauteurs = new Map();
    p.rangees.forEach(function (r) {
      var a = anciennes.get(r.cle);
      if (a && a.html === r.html) nouvelles.set(r.cle, a);
      else {
        neuves.push(r);
        if (a) hauteurs.set(r.cle, a.tr.getBoundingClientRect().height);
      }
    });
    if (neuves.length) {
      var gabarit = document.createElement('template');
      gabarit.innerHTML = '<table><tbody>' + neuves.map(function (r) { return r.html; }).join('') + '</tbody></table>';
      gfRangeesDe(gabarit.content.querySelector('tbody'), neuves).forEach(function (l, cle) { nouvelles.set(cle, l); });
    }
    anciennes.forEach(function (a, cle) {
      var n = nouvelles.get(cle);
      if (!n || n.tr !== a.tr) { a.tr.remove(); ecrit = true; }
    });
    var curseur = tbody.firstElementChild;
    p.rangees.forEach(function (r) {
      var tr = nouvelles.get(r.cle).tr;
      if (tr === curseur) { curseur = curseur.nextElementSibling; return; }
      tbody.insertBefore(tr, curseur);
      ecrit = true;
    });
    if (remplir && hauteurs.size) remplir();
    hauteurs.forEach(function (h, cle) {
      var tr = nouvelles.get(cle).tr;
      if (tr.getBoundingClientRect().height < h - 0.5) tr.style.height = h + 'px';
    });
    wrap._gfLignes = nouvelles;
    wrap._gfParties = p;
    if (ecrit) gfStats.ecritures += 1;
  }

  // ---- LA LIGNE 2 DE LA BARRE (2026-11-02, la barre commune le 2026-11-03) ---------
  // Sur une rangee : l heure, les quatre compteurs qui filtrent (un second toucher
  // revient), l etat du centre (« Pistes 4 libres », « Laser 15:30, 11 places ») qui
  // repond aux cris sans un clic. Les comptes sont ceux de la liste du dessous
  // (getStaffListeSection), lus sur les moments que le modele vient de calculer.
  var GF_FILTRES = ['late', 'upcoming', 'onsite', 'closing', 'absent'];
  // « Anniversaire Zoé (5 ans) » se dit « Zoé », « Famille Pirotte » se dit « Pirotte ».
  function gfCourt(r) {
    var entier = String(r.name || 'Client');
    return entier.replace(/^(Anniversaire|Famille|Amis d[e'’]|EVG|EVJF|Groupe|Équipe|Entreprise)\s*/i, '').replace(/\s*\([^)]*\)\s*$/, '').trim() || entier;
  }
  function gfComptes(m) {
    var moments = new Map(m.groupes.map(function (g) { return [g.id, { etat: g.etatListe, late: g.retard }]; }));
    var comptes = {};
    m.groupes.forEach(function (g) {
      var section = getStaffListeSection(moments, g.r);
      comptes[section] = (comptes[section] || 0) + 1;
    });
    // (ils ne sont plus sur la feuille : le compteur les retrouve au jour entier)
    comptes.absent = m.absents;
    return comptes;
  }
  // Les groupes du prochain depart laser, lus sur le modele (la regle de lpModele :
  // une partie va au depart le plus proche) : « Lina 11 · Manon 8 ».
  function gfListeDuDepart(m) {
    var t = m.etat.laser.t;
    var liste = [];
    m.groupes.forEach(function (g) {
      if (g.parti) return;
      (g.cases.get('laser') || []).some(function (e) {
        if (e.aPlacer || e.start == null || e.start <= t - 0.25 + 1e-6 || e.start > t + 0.25 + 1e-6) return false;
        // (« où sont-ils ? » : qui n est pas encore la se dit, un toucher ouvre sa fiche)
        var la = gfPresent(g);
        liste.push({ id: g.id, la: la, texte: gfCourt(g.r) + ' ' + (Number(e.joueurs) || Number(g.r.pax) || 0) + (la ? '' : ' pas là') });
        return true;
      });
    });
    return liste;
  }
  function gfGroupesDuDepart(m) {
    return gfListeDuDepart(m).map(function (x) {
      return '<button type="button" class="gf-e__g' + (x.la ? '' : ' is-attendu') + '" data-gf-fiche="' + gpEsc(x.id) + '">' + gpEsc(x.texte) + '</button>';
    }).join(' · ');
  }
  // (a l etroit, la ligne ne les montre plus : le menu « ⋯ » les garde a portee)
  window.gfDepartDuMenu = function () {
    var wrap = document.getElementById('globalPlanningGridWrap');
    var m = wrap && wrap._gfModele;
    if (!m || !m.etat || !m.etat.laser) return '';
    var liste = gfListeDuDepart(m);
    if (!liste.length) return '';
    return '<div class="staff-action-popover-title">' + gpEsc('Départ laser de ' + gpHeure(m.etat.laser.t)) + '</div>' + liste.map(function (x) {
      return '<button type="button" onclick="openPos(' + Number(x.id) + '); closeStaffFloatingMenus();">' + gpEsc(x.texte) + '</button>';
    }).join('');
  };
  // L ETAT DU CENTRE MENE A SON GESTE (2026-11-02) : « Pistes 4 libres » ouvre Réserver, sur
  // une heure qui tient ; complet, son planning dit quand ca se libere.
  // (le bandeau n est un bouton que si son geste est permis : ouvrir l onglet de
  // l activite complete, ou reserver, 2026-11-07)
  function gfBandeauAgit(cle, et) {
    if (et.plein) return typeof vueDuPlanningPermise !== 'function' || vueDuPlanningPermise(cle);
    return gfPeut('reserver');
  }
  function gfEtatBandeau(cle, libelle, et, dessous) {
    var contenu = '<span class="gf-e__l">' + gpEsc(libelle) + '</span><b class="gf-e__v">' + gpEsc(et.texte) + '</b>';
    if (!gfBandeauAgit(cle, et)) return '<div class="gf-e' + (et.plein ? ' is-plein' : '') + ' is-lecture"><span class="gf-e__h" title="' + gpEsc(et.bulle) + '">' + contenu + '</span><span class="gf-e__s">' + dessous + '</span></div>';
    return '<div class="gf-e' + (et.plein ? ' is-plein' : '') + '" data-gf-etat="' + cle + '"><button type="button" class="gf-e__h" title="' + gpEsc(et.bulle) + '">' + contenu + '</button><span class="gf-e__s">' + dessous + '</span></div>';
  }
  function gfDepuisBandeau(wrap, cle) {
    var et = wrap._gfModele && wrap._gfModele.etat && wrap._gfModele.etat[cle];
    if (!et || !gfBandeauAgit(cle, et)) return;
    if (et.plein) window.pbChanger(cle);
    else if (cle === 'laser') openQuickBookForLaserSession(et.t, et.places);
    else reserverAuComptoir({ type: 'bowling' });
  }
  // LES BULLES DU TABLEAU : la bulle des menus de la console, ancree sur ce qu on touche.
  function gfBulle(bouton, e, html, surChoix) {
    showStaffFloatingMenu({ currentTarget: bouton, stopPropagation: function () { e.stopPropagation(); } }, html);
    var bulle = document.querySelector('.staff-action-popover');
    if (!bulle) return;
    // (la feuille qui defile emporte la ligne : la bulle se ferme plutot que de rester en l air.
    // Un defilement qui arrive juste apres le toucher, sans deplacer la ligne, ne la ferme pas)
    var defile = bouton.closest('.gf-defile');
    var haut = bouton.getBoundingClientRect().top;
    var suivre = function () {
      if (!bulle.isConnected) { defile.removeEventListener('scroll', suivre); return; }
      if (Math.abs(bouton.getBoundingClientRect().top - haut) < 8) return;
      defile.removeEventListener('scroll', suivre);
      closeStaffFloatingMenus();
    };
    if (defile) defile.addEventListener('scroll', suivre, { passive: true });
    bulle.addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-gf-choix]');
      if (!b) return;
      closeStaffFloatingMenus();
      surChoix(b.getAttribute('data-gf-choix'), ev);
    });
    var premier = bulle.querySelector('button');
    if (premier) premier.focus({ preventScroll: true });
  }
  // « On arrive dans 20 minutes » : le retard annonce compte depuis l heure de la ligne. La fenetre
  // du retard (ouvrirRetardFiche, lib/retard-arrivee.js) juge chaque heure au serveur, gele les
  // activites commencees et n ecrit que ce dossier (2026-11-21 : l ancien plan en cascade avait
  // deplace un groupe en pleine partie). Le focus revient au retard touche.
  function gfBulleRetard(wrap, bouton, e) {
    var m = wrap._gfModele;
    var id = bouton.getAttribute('data-gf-retarder');
    var g = m && m.groupes.find(function (x) { return String(x.id) === id; });
    if (!g || m.maintenant == null) return;
    var deja = gfMinutesDeRetard(g, m);
    var choix = [10, 20, 30].map(function (n) { return '<button type="button" data-gf-choix="' + n + '">' + n + ' min</button>'; }).join('');
    gfBulle(bouton, e, '<div class="staff-action-popover-title">Ils arrivent dans</div>' + choix, function (n, ev) {
      if (bouton.isConnected) bouton.focus({ preventScroll: true });
      ouvrirRetardFiche(Number(id), Math.min(240, deja + Number(n)), ev);
    });
  }
  function gfApresEncaisser() {
    if (String(state.searchTerm || '').trim()) gfViderRecherche();
  }
  function gfBulleEncaisser(bouton, e) {
    var id = Number(bouton.getAttribute('data-gf-encaisser'));
    var choix = GROUPE_MOYENS.map(function (moyen) { return '<button type="button" data-gf-choix="' + gpEsc(moyen.valeur) + '">' + gpEsc(moyen.mot) + '</button>'; }).join('');
    gfBulle(bouton, e, '<div class="staff-action-popover-title">' + gpEsc(bouton.textContent) + ' à encaisser</div>' + choix, function (valeur, ev) { encaisserReservation(id, valeur, ev); gfApresEncaisser(); });
  }
  // Tous les statuts d un toucher : celui du dossier coche, chacun selon le droit du role
  // (le serveur juge de toute facon). « Pas venu » suit la regle de la fiche.
  function gfBulleStatut(wrap, bouton, e) {
    var id = bouton.getAttribute('data-gf-statut');
    var m = wrap._gfModele;
    var g = m && m.groupes.find(function (x) { return String(x.id) === id; });
    if (!g) return;
    var r = g.r;
    var absent = Boolean(r.absentAt) || g.etat === 'absent';
    var peut = function (p) { return typeof canUseStaffPermission !== 'function' || canUseStaffPermission(p); };
    var choix = [];
    var option = function (valeur, mot, actuel) {
      choix.push('<button type="button" data-gf-choix="' + gpEsc(valeur) + '"' + (actuel ? ' class="is-actuel" aria-current="true"' : '') + '>' + gpEsc(mot) + '</button>');
    };
    if (peut('reservations.status')) {
      option('pending', 'Confirmé', !absent && r.status !== 'arrived' && r.status !== 'paid');
      option('arrived', 'Arrivé', !absent && r.status === 'arrived');
    }
    if (gfPeutEncaisser()) GROUPE_MOYENS.forEach(function (moyen) { option('paid:' + moyen.valeur, 'Payé ' + moyen.mot.toLowerCase(), r.status === 'paid' && r.paymentMethod === moyen.valeur); });
    if (absent) option('present', 'Annuler « Pas venu »', false);
    else if (typeof renderGroupePasVenu === 'function' && renderGroupePasVenu(r)) option('absent', 'Pas venu', false);
    option('fiche', 'Ouvrir la fiche', false);
    gfBulle(bouton, e, '<div class="staff-action-popover-title">' + gpEsc(r.name || 'Le groupe') + '</div>' + choix.join(''), function (valeur, ev) {
      var n = Number(id);
      if (valeur === 'fiche') { openPos(n); return; }
      if (valeur === 'absent' || valeur === 'present') { basculerAbsence(n, valeur === 'absent', ev); return; }
      if (valeur.indexOf('paid:') === 0) { encaisserReservation(n, valeur.slice(5), ev); gfApresEncaisser(); return; }
      setReservationStatusDirect(n, valeur, ev);
    });
  }
  // L HEURE, ou le chemin qui y ramene : un autre jour, « Aujourd hui » prend sa place, a la
  // meme largeur, et rien ne bouge. Un moment se lit comme sur le tableau : apres minuit, la
  // console reste sur la veille.
  function pbMoment() {
    var jour = state.currentDate;
    var auj = todayStr();
    var nuit = gpNuit(jour, auj);
    return { aujourdHui: jour === auj || nuit, maintenant: jour === auj ? currentTimeDecimal() : nuit ? 24 + currentTimeDecimal() : null };
  }
  function pbDirectHtml(m) {
    if (m.aujourdHui && m.maintenant != null) return '<div class="pb-direct gf-horloge"><b data-gf-horloge></b><i aria-hidden="true"></i><span data-gf-direct></span></div>';
    return '<div class="pb-direct"><button type="button" class="staff-today-btn" onclick="setStaffToday()">Aujourd’hui</button></div>';
  }
  // LA LEGENDE, VISIBLE ET DE LA COULEUR DE CE QUI EST A L ECRAN : les barres du tableau
  // lisent les memes variables (.gf-leg, .gf-r), les cartes bowling et laser ont leurs
  // teintes, leurs selecteurs les posent aussi sur elle.
  function pbLegende(vue) {
    return '<div class="pb-leg' + (vue === 'all' ? '' : ' pb-leg--' + vue) + '" role="note" aria-label="Couleur du statut"><span><i class="gf-leg" aria-hidden="true"></i>Confirmé</span><span><i class="gf-leg t-arr" aria-hidden="true"></i>Arrivé</span><span><i class="gf-leg t-paid" aria-hidden="true"></i>Payé</span></div>';
  }
  // Un filtre que la ligne ne montre pas se dit, et s enleve d un toucher.
  function pbFiltreHtml(dejaVus) {
    var f = typeof normaliserFiltreListe === 'function' ? normaliserFiltreListe(state.staffStatusFilter) : 'all';
    if (f === 'all' || dejaVus.indexOf(f) >= 0) return '';
    return '<button type="button" class="pb-filtre" aria-label="Enlever le filtre" onclick="setStaffStatusFilter(\'all\')">Filtre : ' + gpEsc(STAFF_LISTE_MOTS[f] || 'Avec note') + ' ×</button>';
  }
  // UNE RECHERCHE SE DIT LA OU L OEIL VOIT LES CASES TRANSPARENTES (2026-11-07,
  // Ansar : « pourquoi y en a ils sont transparents »). Bowling et laser grisent
  // ce qui ne correspond pas : la ligne dit combien restent nets, et tout revient
  // d un toucher.
  function pbRechercheHtml() {
    var r = typeof rechercheDuPlanning === 'function' ? rechercheDuPlanning() : null;
    if (!r) return '';
    var nets = r.nets ? gfPluriel(r.nets, ['groupe', 'groupes']) : 'aucun groupe';
    return '<span class="pb-recherche" role="status">Recherche « ' + gpEsc(r.terme) + ' » : ' + gpEsc(nets + ' sur ' + r.total) + '</span>'
      + '<button type="button" class="pb-filtre" data-pb-tout onclick="toutAfficherPlanning()">Tout afficher</button>';
  }
  function gfBandeauHtml(m) {
    var h = pbDirectHtml(m);
    var comptes = gfComptes(m);
    var actif = typeof normaliserFiltreListe === 'function' ? normaliserFiltreListe(state.staffStatusFilter) : 'all';
    // TOUT SE CHOISIT (2026-11-03, Movsar : « ici on doit pouvoir choisir tout aussi ») :
    // « Tout » revient a la journee entiere, et un compteur a zero se touche aussi (il dit
    // qu il n y a personne). Le total reste celui de la bascule, un seul chiffre.
    h += '<button type="button" class="gf-c gf-c--tout' + (actif === 'all' ? ' is-on' : '') + '" data-gf-filtre="all" aria-pressed="' + (actif === 'all') + '"><span class="gf-c__l">Tout</span></button>';
    GF_FILTRES.forEach(function (f) {
      var n = comptes[f] || 0;
      var on = actif === f;
      // (« Pas venus » n a de compteur que s il y en a : personne, la place reste aux autres)
      if (f === 'absent' && !n && !on) return;
      var cls = 'gf-c' + (f === 'late' && n ? ' is-alerte' : '') + (n ? '' : ' is-zero') + (on ? ' is-on' : '');
      var corps = '<span class="gf-c__l">' + gpEsc(STAFF_LISTE_MOTS[f]) + '</span><b class="gf-c__v">' + n + '</b>';
      h += '<button type="button" class="' + cls + '" data-gf-filtre="' + f + '" aria-pressed="' + on + '">' + corps + '</button>';
    });
    // (un jour de fermeture, ni piste libre ni prochain depart ne veulent rien dire)
    var e = (m.fenetre && m.fenetre.closed ? null : m.etat) || {};
    if (e.bowling || e.laser) h += '<span class="pb-sep" aria-hidden="true"></span>';
    if (e.bowling) h += gfEtatBandeau('bowling', 'Pistes', e.bowling, gpEsc(String(e.bowling.bulle || '').replace(/^(Libres maintenant : |Aucune piste libre, )/, '').split(' · ')[0]));
    if (e.laser) h += gfEtatBandeau('laser', 'Laser', e.laser, gfGroupesDuDepart(m));
    var retenu = typeof retenuesDuJour === 'function' ? retenuesDuJour(m.jour) : { pistes: 0, armes: 0 };
    var motsRetenu = [retenu.pistes ? gfPluriel(retenu.pistes, ['piste', 'pistes']) : '', retenu.armes ? gfPluriel(retenu.armes, ['arme', 'armes']) : ''].filter(Boolean).join(', ');
    if (motsRetenu) h += '<div class="pb-k" data-kpi="enligne" title="Des clients sont en train de réserver sur internet. Ces places leur sont gardées 10 minutes au plus."><span class="gf-c__l">Internet</span><b class="gf-c__v">' + gpEsc(motsRetenu) + '</b></div>';
    if (!m.aujourdHui) {
      var joueurs = m.groupes.reduce(function (n, g) { return n + (Number(g.r.pax) || 0); }, 0);
      h += '<span class="pb-sep" aria-hidden="true"></span><span class="pb-info">' + gpEsc(gfPluriel(m.groupes.length, ['groupe', 'groupes']) + ', ' + gfPluriel(joueurs, ['joueur', 'joueurs'])) + '</span>';
    }
    return h + pbFiltreHtml(GF_FILTRES) + pbLegende('all');
  }
  // LA LIGNE 2 S ECRIT A UN SEUL ENDROIT, pour les trois plannings. Une ligne identique
  // ne se reecrit pas : l heure et l etat du direct s ecrivent en place.
  function pbPoser(html, m) {
    var hote = document.getElementById('planningBande');
    if (!hote) return;
    if (hote._gfHtml !== html) {
      var actif = document.activeElement;
      var filtre = actif && hote.contains(actif) ? actif.getAttribute('data-gf-filtre') : null;
      hote.innerHTML = html;
      hote._gfHtml = html;
      if (filtre) {
        var n = hote.querySelector('button[data-gf-filtre="' + filtre + '"]');
        if (n) n.focus({ preventScroll: true });
      }
    }
    var horloge = hote.querySelector('[data-gf-horloge]');
    if (horloge && m.maintenant != null) {
      var t = gpHeure(m.maintenant);
      if (horloge.textContent !== t) horloge.textContent = t;
    }
    gfMajDirect();
  }
  // Bowling et Laser : leurs chiffres (renderKpis), puis la legende.
  window.pbEcrireChiffres = function (chiffres) {
    var m = pbMoment();
    var h = pbDirectHtml(m);
    chiffres.forEach(function (c) {
      h += '<div class="pb-k" data-kpi="' + gpEsc(c.key) + '"' + (c.title ? ' title="' + gpEsc(c.title) + '"' : '') + '><span class="gf-c__l">' + gpEsc(c.label) + '</span><b class="gf-c__v" id="' + gpEsc(c.id) + '">' + gpEsc(c.value) + '</b>' + (c.hint ? '<span class="gf-e__s">' + gpEsc(c.hint) + '</span>' : '') + '</div>';
    });
    pbPoser(h + '<span class="pb-sep" aria-hidden="true"></span>' + pbRechercheHtml() + pbFiltreHtml([]) + pbLegende(getStaffResourceView()), m);
  };
  // SOUS L HEURE, CE QUE VAUT L ECRAN (2026-11-02) : « en direct », ou ce qui ne va pas.
  // Un ecran qui ne recoit plus rien ressemble a un ecran juste : c est ici qu il le dit,
  // en plein rush, avant qu on pointe un groupe deja parti. Ecrit hors du HTML compare :
  // la reconnexion ne reecrit pas le bandeau.
  function gfEtatDirect() {
    var panne = typeof getRemoteSyncIndicator === 'function' ? getRemoteSyncIndicator() : { tone: 'live' };
    if (panne.tone === 'stale') return { mot: 'hors ligne', classe: 'is-stale', bulle: panne.label };
    if (panne.tone === 'warning' || (typeof window.pinlanePoulsCoupe === 'function' && window.pinlanePoulsCoupe())) return { mot: 'reconnexion…', classe: 'is-warning', bulle: 'L’écran ne reçoit plus les changements des autres postes.' };
    return { mot: 'en direct', classe: '', bulle: 'Ce que font les autres postes arrive ici tout seul.' };
  }
  function gfMajDirect() {
    var n = document.querySelector('[data-gf-direct]');
    if (!n) return;
    var e = gfEtatDirect();
    if (n.textContent !== e.mot) { n.textContent = e.mot; n.className = e.classe; n.title = e.bulle; n.parentNode.classList.toggle('is-coupe', Boolean(e.classe)); }
  }
  // Un compteur montre ses groupes, par heure ; un second toucher revient. (il mene a
  // la journee : un nom tape s efface)
  function gfFiltrer(wrap, f) {
    var actuel = normaliserFiltreListe(state.staffStatusFilter);
    if (String(state.searchTerm || '').trim()) {
      var champ = document.getElementById('globalPlanningSearchInput');
      if (champ) champ.value = '';
      applyStaffSearch('', { immediate: true });
    }
    avecListeDifferable(function () { setStaffStatusFilter(actuel === f || f === 'all' ? 'all' : f); });
    gfAllerAMaintenant(wrap, false);
  }

  // LA CROIX DE LA RECHERCHE (2026-11-02) : le groupe trouve, la feuille revient
  // d un toucher ; le curseur reste dans le champ pour le nom suivant. (elle s affiche avec
  // le champ, sur les trois plannings : syncStaffSearchCroix, app-main.js)
  function gfViderRecherche() {
    var champ = document.getElementById('globalPlanningSearchInput');
    if (!champ) return;
    champ.value = '';
    applyStaffSearch('', { immediate: true });
    champ.focus();
  }
  // « On est les Masson » : le nom, puis Entrée. Entrée ne pointe que s il reste un
  // seul groupe, et attendu : aucun groupe n est preselectionne. Le champ se vide et
  // garde le curseur pour le client suivant ; « Arrivé » garde son toast « Annuler ».
  function gfPointerParEntree(champ) {
    applyStaffSearch(champ.value, { immediate: true });
    var wrap = document.getElementById('globalPlanningGridWrap');
    var boite = document.getElementById('globalPlanningBox');
    var q = gfCle(champ.value);
    // Le numero de la reservation, que le client lit dans son mail et donne au
    // telephone : Entree ouvre sa reservation, a son jour, sans la pointer (un
    // appel n est pas une arrivee). Le nom garde son geste : Entree pointe.
    var numero = typeof numeroReservationDe === 'function' ? numeroReservationDe(q) : '';
    if (numero && typeof ouvrirReservationNumero === 'function') { ouvrirReservationNumero(numero); return; }
    // (sur Bowling et Laser, Entree cherche : ce tableau-ci n est pas a l ecran)
    if (!boite || boite.classList.contains('hidden')) return;
    var m = wrap && wrap._gfModele;
    var trouves = m && q ? m.groupes.filter(function (g) { return gfTrouveParNom(g, q); }) : [];
    if (trouves.length !== 1 || !gfPeutArriver(trouves[0], m)) return;
    setReservationStatusDirect(trouves[0].id, 'arrived');
    gfViderRecherche();
  }

  // ---- L HEURE AU TOUCHER ET LE GLISSER (2026-11-22) -------------------------------------
  // Ansar, ses notes du comptoir : « possibilité de drag and drop dans planning complet », puis
  // « cliquer sur l'heure d'une activité genre pile l'heure et modifier l'heure dessus d'une traite
  // avec une petite pop up avec une jolie animation un peu comme un slime qui se transforme en bouton
  // [...] léger [...] et aussi pouvoir modifier facilement d'une traite dans la pop up quand on clique
  // sur une resa en appuyant sur l'heure de l'activité et ça doit bien tout calculer hein pour voir
  // possibilité et tout ».
  //   - L HEURE AU TOUCHER : la pastille d une heure (« 16:30 ») ouvre, posee contre elle, les heures
  //     libres de cette activite. Elles viennent du serveur, du controle du verdict de « Modifier »
  //     (deplacerABlanc, ses `essais`) : pistes et armes de la journee, la vraie duree, aucun
  //     chevauchement avec les autres activites du groupe, les horaires du jour et de la formule.
  //     Jamais de calcul a part. Un choix s enregistre tout de suite par le chemin du glisser des
  //     plannings (envoyerDeplacementActivite, PATCH activityMove) ; le toast « Annuler » le defait.
  //     La fiche fait le meme geste sur les heures de son Programme (pgOuvrirHeureFiche).
  //   - LA GOUTTE : la pop-up nait de la pastille touchee, une goutte qui s etire et devient un
  //     panneau (la feuille de style, .gf-hp) : transform et opacity, son arrondi passe de la pastille
  //     au panneau, 260 ms ; elle rentre en 150 ms ; rien en mouvement reduit. Aucune boucle JS, rien
  //     dans le tableau ne bouge ni ne se reecrit.
  //   - LE GLISSER : l heure d une activite, ou la ligne entiere d un groupe, se prend et se pose sur
  //     une autre demi-heure du tableau. A la souris des 6 px, au doigt apres un appui long (un doigt
  //     qui part tout de suite fait defiler, assets/pinlane-touch-drag.js). Un apercu suit, la
  //     demi-heure visee dit si ca passe, et sinon pourquoi. La ligne entiere change l heure du
  //     dossier par le chemin de « Modifier » (son calcul a blanc, puis son enregistrement) : toutes
  //     ses activites suivent, le planning les replace.
  //   - UN GROUPE QUI JOUE DEJA NE BOUGE PAS : la regle du retard (lib/retard-arrivee.js,
  //     groupeEnJeu), lue ici sur le meme dossier (gfEnJeuDuDossier), redite par le serveur.
  // Le tableau (au moins 640 px) seulement pour le glisser : au telephone, chaque ligne est une carte
  // et les demi-heures vides n y sont pas ; la pastille, elle, s y touche aussi.
  var GF_SANS_HEURE = { party_table: true, arcade_credit: true, playground: true };
  // (la demi-heure du bowling et des departs laser, le quart d heure pour le reste)
  var GF_PAS_HEURE = { bowling: 30, laser_game: 30 };
  var GF_PAS_AUTRE = 15;
  var GF_HEURES_MONTREES = 12;
  var GF_SEUIL_SOURIS = 6;
  var GF_MAINTIEN_DOIGT = 320;

  function gfDroitsHeure(jour) {
    var peut = function (p) { return typeof canUseStaffPermission !== 'function' || canUseStaffPermission(p); };
    return {
      deplacer: typeof peutGeste !== 'function' || peutGeste('deplacer', jour),
      modifier: typeof peutGeste !== 'function' || peutGeste('modifier', jour),
      bowling: peut('planning.bowling'),
      laser: peut('planning.laser'),
    };
  }
  function gfDossier(id) {
    var n = Number(id);
    var r = (state.reservations || []).find(function (x) { return Number(x.id) === n; });
    return r || (typeof findStaffReservationById === 'function' ? findStaffReservationById(n) : null);
  }
  function gfEchappe(v) { return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(String(v)) : String(v).replace(/[^\w:+.-]/g, ''); }
  // L ecart entre l heure touchee et le debut de l activite (son second bowling) ; apres minuit, l heure
  // touchee continue la journee (00:30 se lit 24:30).
  function gfOffset(point, heure) {
    var h = heure != null && heure + 12 < point.debut ? heure + 24 : heure;
    return h == null ? 0 : Math.max(0, h - point.debut);
  }
  function gfMinute(h) { return Math.round(Number(h) * 60); }
  function gfPartieDit(r, unite) {
    var partie = Number(String(unite || '1.1').split('.')[0]) || 1;
    var toutes = new Set(getLaserWindowsFromReservation(r).map(function (w) { return Number(w.countIndex) || 1; }));
    return toutes.size > 1 ? 'Laser, ' + (partie === 1 ? '1re' : partie + 'e') + ' partie' : 'Laser';
  }

  // CE QUE LA CLE D UNE HEURE DESIGNE DANS LE DOSSIER, tel que le serveur le deplacera
  // (buildActivityMove) : tout le bowling et ses pistes, une partie de laser (ses vagues de la meme
  // minute), ou les etapes a heure d une autre activite, du meme ecart.
  function gfPointDe(r, cle) {
    if (!r || !cle) return null;
    var debut, fin;
    if (cle === 'bowling') {
      var fb = getBowlingWindowsFromReservation(r);
      if (!fb.length || fb.some(function (w) { return w.aVolonte; })) return null;
      debut = Math.min.apply(null, fb.map(function (w) { return Number(w.start); }));
      fin = Math.max.apply(null, fb.map(function (w) { return Number(w.end); }));
      var pistes = Array.from(new Set(fb.reduce(function (t, w) { return t.concat(w.lanes || []); }, []).map(Number))).sort(function (a, b) { return a - b; });
      return { cle: cle, activityId: 'bowling', nom: 'Bowling', debut: debut, fin: fin, pistes: pistes };
    }
    if (cle.indexOf('laser_game:') === 0) {
      var unites = cle.slice(11).split('+');
      var fl = getLaserWindowsFromReservation(r).filter(function (w) { return unites.indexOf(laserBlockUnitKey(w)) >= 0; });
      if (!unites[0] || fl.length !== unites.length || fl.some(function (w) { return w.aVolonte; })) return null;
      var departs = {};
      fl.forEach(function (w) { departs[laserBlockUnitKey(w)] = Number(w.start); });
      debut = Math.min.apply(null, fl.map(function (w) { return Number(w.start); }));
      fin = Math.max.apply(null, fl.map(function (w) { return Number(w.end); }));
      return { cle: cle, activityId: 'laser_game', nom: gfPartieDit(r, unites[0]), debut: debut, fin: fin, unites: unites, departs: departs };
    }
    if (GF_SANS_HEURE[cle] || /^service_/.test(cle)) return null;
    var etapes = ((r.opsPlan && r.opsPlan.timeline) || []).filter(function (s) { return s && s.activityId === cle && s.type === 'activity' && s.flexible !== true && s.startTime && s.endTime; });
    if (!etapes.length) return null;
    debut = Math.min.apply(null, etapes.map(function (s) { return timeToNum(s.startTime); }));
    fin = Math.max.apply(null, etapes.map(function (s) { var a = timeToNum(s.startTime), b = timeToNum(s.endTime); return b < a ? b + 24 : b; }));
    return { cle: cle, activityId: cle, nom: gpTitreActivite(cle), debut: debut, fin: fin };
  }
  function gfPeutDeplacerHeure(r, activityId) {
    if (!r || !activityId || r.status === 'cancelled' || (r.absentAt && r.status !== 'arrived' && r.status !== 'paid')) return false;
    var d = gfDroitsHeure(r.date);
    return d.deplacer && (activityId !== 'bowling' || d.bowling) && (activityId !== 'laser_game' || d.laser);
  }

  // UN GROUPE QUI JOUE DEJA, la regle du serveur (groupeEnJeu, lib/retard-arrivee.js) : une activite a
  // heure cochee « fait », ou commencee quand le groupe est sur place, et l etait deja a cette heure-la
  // (un groupe arrive en retard n a pas commence ce qui devait se jouer avant son arrivee).
  function gfMaintenantDuJour(jour) {
    var auj = todayStr();
    if (jour === auj) return currentTimeDecimal();
    if (gpNuit(jour, auj)) return 24 + currentTimeDecimal();
    return jour < auj ? Infinity : -Infinity;
  }
  function gfArriveeEnRetard(r) {
    var f = (r.status === 'arrived' || r.status === 'paid') && r.opsPlan ? r.opsPlan.delayFlag : null;
    if (!f || f.cleared || (Number(f.sourceId) > 0 && Number(f.sourceId) !== Number(r.id))) return -Infinity;
    var de = gpMinutesDe(f.from);
    return de != null && Number(f.minutes) > 0 ? de + Number(f.minutes) / 60 : -Infinity;
  }
  function gfEnJeuDuDossier(r) {
    if (!r || r.status === 'cancelled') return null;
    var maintenant = gfMaintenantDuJour(r.date);
    var surPlace = r.status === 'arrived' || r.status === 'paid';
    var arrivee = gfArriveeEnRetard(r);
    var debuts = [];
    getGroupeProgramme(r).forEach(function (e) {
      if (e.start == null || e.libre || e.aPlacer || e.extra || !e.activityId || e.activityId === 'party_table' || e.activityId === 'playground' || /^service_/.test(e.activityId)) return;
      if (e.fait || (surPlace && e.start <= maintenant + 1e-6 && e.start >= arrivee - 1e-6)) debuts.push(e.start);
    });
    if (!debuts.length) return null;
    var depuis = gpHeure(Math.min.apply(null, debuts));
    return { depuis: depuis, phrase: (r.name || 'Ce groupe') + ' joue depuis ' + depuis + ' : ses heures ne bougent plus.' };
  }

  // LE PLUS TOT, la regle de Modifier (preparerDeplacementsEdition) : ni avant l arrivee du groupe (son
  // heure, ou sa premiere activite a heure quand elle commence plus tot), ni une heure deja passee le
  // jour meme. La ligne entiere deplace l arrivee avec elle : seule l heure qu il est compte.
  function gfAuPlusTot(r, ligne) {
    var maintenant = r.date === todayStr() ? Math.ceil(currentTimeDecimal() * 60 - 1e-6) / 60 : null;
    var arrivee = ligne ? null : Math.min.apply(null, [gpMinutesDe(r.startTime) == null ? Infinity : gpMinutesDe(r.startTime)].concat(getGroupeProgramme(r).filter(function (e) { return e.start != null && !e.libre && !e.aPlacer && e.activityId; }).map(function (e) { return e.start; })));
    if (!Number.isFinite(arrivee)) arrivee = null;
    return { h: Math.max(arrivee == null ? -Infinity : arrivee, maintenant == null ? -Infinity : maintenant), arrivee: arrivee, maintenant: maintenant };
  }
  function gfPhrasePlancher(plancher, h) {
    if (plancher.maintenant != null && h < plancher.maintenant - 1e-6) return gpHeure(h) + ' est déjà passé : il est ' + gpHeure(currentTimeDecimal()) + '.';
    if (plancher.arrivee != null && h < plancher.arrivee - 1e-6) return 'Avant l’arrivée du groupe à ' + gpHeure(plancher.arrivee) + '.';
    return '';
  }

  // LES PISTES A UNE AUTRE HEURE : les siennes si elles y sont libres, sinon celles que prend le glisser
  // du planning bowling (getTargetBowlingLanes, autant qu il en a). Posees a la main, elles restent.
  function gfPistesA(r, point, d) {
    var pistes = point.pistes.slice();
    if (!pistes.length || (typeof pistesALaMainDuDossier === 'function' && pistesALaMainDuDossier(r))) return pistes;
    var duree = point.fin - point.debut;
    var prises = typeof lanesConflict === 'function' && (lanesConflict(r.date, numToTime(d), duree, pistes, r.id).length > 0 || pistes.some(function (p) { return state.laneStatuses && state.laneStatuses[p] === 'maintenance'; }));
    if (!prises || typeof getTargetBowlingLanes !== 'function') return pistes;
    var autres = getTargetBowlingLanes(pistes.length, pistes[0], r.date, numToTime(d), duree, r.id, pistes, pistes[0]);
    return autres && autres.length === pistes.length ? autres.slice().sort(function (a, b) { return a - b; }) : pistes;
  }
  // Ce que le serveur recoit pour un debut `d` : le deplacement du glisser des plannings, tel quel.
  function gfMoves(r, point, d) {
    if (point.activityId === 'bowling') return [{ activityId: 'bowling', startTime: numToTime(d), lanes: gfPistesA(r, point, d) }];
    if (point.activityId === 'laser_game') return point.unites.map(function (u) { return { activityId: 'laser_game', unitKey: u, startTime: numToTime(d + point.departs[u] - point.debut) }; });
    return [{ activityId: point.activityId, startTime: numToTime(d) }];
  }
  function gfMovesRetour(point) {
    if (point.activityId === 'bowling') return [{ activityId: 'bowling', startTime: numToTime(point.debut), lanes: point.pistes.slice() }];
    if (point.activityId === 'laser_game') return point.unites.map(function (u) { return { activityId: 'laser_game', unitKey: u, startTime: numToTime(point.departs[u]) }; });
    return [{ activityId: point.activityId, startTime: numToTime(point.debut) }];
  }
  // Les debuts a essayer : la grille de l activite, de l ouverture a la fermeture, sauf le sien.
  function gfGrille(r, point) {
    var fen = typeof getPlanningWindow === 'function' ? getPlanningWindow(r.date) : null;
    if (!fen || fen.closed || !(fen.close > fen.open)) return [];
    var pas = (GF_PAS_HEURE[point.activityId] || GF_PAS_AUTRE) / 60;
    var duree = point.fin - point.debut;
    var liste = [];
    for (var h = Math.ceil(Number(fen.open) / pas - 1e-6) * pas; h + duree <= Number(fen.close) + 1e-6; h += pas) {
      var d = Math.round(h * 60) / 60;
      if (Math.abs(d - point.debut) > 1e-6) liste.push(d);
    }
    return liste;
  }

  // LE VERDICT DU SERVEUR pour une activite et des debuts : une requete (deplacerABlanc, `essais`), gardee
  // tant que le dossier ne change pas. Rend { verdicts: Map(minute -> { passe, raison, moves }), gele }.
  var gfMemoire = new Map();
  function gfJuger(r, point, debuts, plancher) {
    var cle = [r.id, r.updatedAt, point.cle].join('|');
    var memo = gfMemoire.get(cle);
    if (!memo) { memo = { verdicts: new Map(), gele: null }; gfMemoire.set(cle, memo); if (gfMemoire.size > 40) gfMemoire.delete(gfMemoire.keys().next().value); }
    var manque = debuts.filter(function (d) { return !memo.verdicts.has(gfMinute(d)); });
    if (memo.gele || !manque.length) return Promise.resolve(memo);
    var essais = manque.map(function (d) { return gfMoves(r, point, d); });
    var centre = r.centerId || r.center_id || (typeof getCurrentStaffCenterId === 'function' ? getCurrentStaffCenterId() : '');
    var paquets = [];
    for (var i = 0; i < essais.length; i += 60) paquets.push(i);
    return Promise.all(paquets.map(function (i) {
      var corps = { id: r.id, centerId: centre, baseUpdatedAt: r.updatedAt, essais: essais.slice(i, i + 60) };
      if (plancher && Number.isFinite(plancher.h)) corps.auPlusTot = gfMinute(plancher.h);
      return apiRequest(API_ENDPOINTS.staffReservations, { method: 'POST', body: JSON.stringify({ dryRun: true, centerId: centre, deplacement: corps }) }).then(function (rep) {
        if (rep && rep.gele) { memo.gele = String(rep.gele); return; }
        if (!rep || rep.deplacement !== true || !Array.isArray(rep.essais)) throw new Error((rep && rep.refus && rep.refus.message) || 'Le serveur ne propose pas encore d’heures libres.');
        rep.essais.forEach(function (v, k) {
          var d = manque[i + k];
          memo.verdicts.set(gfMinute(d), { passe: Boolean(v && v.passe), raison: String((v && v.raison) || ''), moves: essais[i + k] });
        });
      });
    })).then(function () { return memo; });
  }

  // ---- LA POP-UP DE L HEURE ----
  var gfPop = null;
  var gfJetonPop = 0;
  function gfAncreDuPop(p) {
    if (p.ancre && p.ancre.isConnected) return p.ancre;
    var trouvee = p.depuisFiche
      ? document.querySelector('#posOverlay [data-pg-res="' + gfEchappe(p.id) + '"][data-pg-heure="' + gfEchappe(p.cle) + '"]')
      : document.querySelector('#globalPlanningGridWrap tr[data-gf-id="' + gfEchappe(p.id) + '"] [data-gf-act="' + gfEchappe(p.cle) + '"]');
    if (trouvee) p.ancre = trouvee;
    return trouvee;
  }
  // La pop-up se pose contre la pastille, dessous (au-dessus s il n y a pas la place), dans l ecran.
  // Sa goutte part de la pastille : son echelle et son arrondi de pastille (--gf-hp-sx, -sy, -r0), sa
  // teinte (--gf-hp-fond0), son origine au centre de la pastille (--gf-hp-ox, -oy). Ce qui arrive ensuite
  // (les heures) ne la reforme pas : la goutte se joue une fois, avec la hauteur reservee aux heures.
  function gfPoserPop(seulementLaPlace) {
    var p = gfPop;
    var ancre = p && gfAncreDuPop(p);
    if (!p || !ancre) return;
    var a = ancre.getBoundingClientRect();
    var el = p.el;
    var l = el.offsetWidth, h = el.offsetHeight;
    var vw = document.documentElement.clientWidth, vh = window.innerHeight, marge = 8;
    var dessous = a.bottom + 6 + h <= vh - marge || a.top - 6 - h < marge;
    var top = Math.max(marge, dessous ? a.bottom + 6 : a.top - 6 - h);
    var left = Math.max(marge, Math.min(a.left - 10, vw - marge - l));
    el.style.left = Math.round(left) + 'px';
    el.style.top = Math.round(top) + 'px';
    el.classList.toggle('is-dessus', !dessous);
    p.haut = a.top;
    if (seulementLaPlace) return;
    var sx = Math.min(1, Math.max(0.05, a.width / Math.max(1, l)));
    var sy = Math.min(1, Math.max(0.05, a.height / Math.max(1, h)));
    el.style.setProperty('--gf-hp-ox', Math.round(a.left + a.width / 2 - left) + 'px');
    el.style.setProperty('--gf-hp-oy', Math.round(a.top + a.height / 2 - top) + 'px');
    el.style.setProperty('--gf-hp-sx', sx.toFixed(3));
    el.style.setProperty('--gf-hp-sy', sy.toFixed(3));
    // (une pastille a l ecran, une fois mise a l echelle : un rayon de la moitie de sa hauteur)
    el.style.setProperty('--gf-hp-r0', Math.round(a.height / 2 / sx) + 'px / ' + Math.round(a.height / 2 / sy) + 'px');
    var fond = getComputedStyle(ancre).backgroundColor;
    if (fond && fond !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(fond)) el.style.setProperty('--gf-hp-fond0', fond);
  }
  function gfPopHtml(r, point, offset, corps) {
    return '<div class="gf-hp__tete"><p class="gf-hp__titre" id="gfHeurePopTitre"><b>' + gpEsc(point.nom) + '</b> <span>' + gpEsc(r.name || 'Client') + '</span></p>'
      + '<button type="button" class="gf-hp__fermer" data-gf-hp-fermer aria-label="Fermer">×</button></div>'
      + '<p class="gf-hp__dit">Prévu à <b>' + gpEsc(gpHeure(point.debut + offset)) + '</b>' + (point.pistes && point.pistes.length ? ', ' + gpEsc(gfPistesEnMots(point.pistes).toLowerCase()) : '') + '</p>'
      + '<div class="gf-hp__corps" data-gf-hp-corps>' + corps + '</div>';
  }
  function gfOuvrirHeure(ancre, r, cle, heure, depuisFiche, parClavier) {
    if (!ancre || !r) return false;
    // (la meme heure touchee une seconde fois referme, meme si sa pastille a ete reecrite entre-temps)
    if (gfPop && gfPop.id === Number(r.id) && gfPop.cle === cle && gfPop.depuisFiche === Boolean(depuisFiche) && (gfPop.ancre === ancre || !gfPop.ancre.isConnected)) { gfFermerHeure(true); return true; }
    gfFermerHeure(false, true);
    var point = gfPointDe(r, cle);
    if (!point || !gfPeutDeplacerHeure(r, point.activityId)) return false;
    var offset = gfOffset(point, heure);
    var gele = gfEnJeuDuDossier(r);
    var el = document.createElement('div');
    // (un groupe qui joue n attend aucune heure : la pop-up ne leur garde pas de place)
    el.className = gele ? 'gf-hp is-rempli' : 'gf-hp';
    el.id = 'gfHeurePop';
    el.setAttribute('role', 'dialog');
    el.setAttribute('tabindex', '-1');
    el.setAttribute('aria-labelledby', 'gfHeurePopTitre');
    el.setAttribute('data-gf-hp-res', String(r.id));
    el.setAttribute('data-gf-hp-cle', cle);
    el.innerHTML = gfPopHtml(r, point, offset, gele ? gfPopGeleHtml(gele.phrase, depuisFiche) : '<p class="gf-hp__attente" role="status">Calcul des heures libres…</p>');
    document.body.appendChild(el);
    gfJetonPop += 1;
    gfPop = { el: el, ancre: ancre, id: Number(r.id), cle: cle, point: point, offset: offset, depuisFiche: Boolean(depuisFiche), clavier: Boolean(parClavier), jeton: gfJetonPop, verdicts: null };
    gfPoserPop();
    // (la goutte se joue une fois : un repositionnement ne la rejoue pas)
    el.classList.add('is-nait');
    el.addEventListener('animationend', function fin(ev) { if (ev.target === el) { el.classList.remove('is-nait'); el.removeEventListener('animationend', fin); } });
    el.addEventListener('click', gfClicDansPop);
    document.addEventListener('pointerdown', gfPopDehors, true);
    document.addEventListener('keydown', gfPopClavier, true);
    document.addEventListener('scroll', gfPopDefile, true);
    window.addEventListener('resize', gfPopFermerSansFocus);
    // (le focus entre dans la pop-up : Echap et Tab y vivent ; au clavier, il va a la premiere heure)
    var premier = parClavier ? el.querySelector('[data-gf-hp-choix], [data-gf-hp-fiche]') : null;
    (premier || el).focus({ preventScroll: true });
    if (!gele) gfRemplirPop(r, point, offset);
    return true;
  }
  function gfPopGeleHtml(phrase, depuisFiche) {
    return '<p class="gf-hp__gele" role="status">' + gpEsc(phrase) + '</p>' + (depuisFiche ? '' : '<div class="gf-hp__pied"><button type="button" class="gf-hp__second" data-gf-hp-fiche>Ouvrir la fiche</button></div>');
  }
  function gfRemplirPop(r, point, offset) {
    var p = gfPop;
    var jeton = p.jeton;
    var plancher = gfAuPlusTot(r, false);
    var debuts = gfGrille(r, point).filter(function (d) { return d >= plancher.h - 1e-6; });
    gfJuger(r, point, debuts, plancher).then(function (memo) {
      if (!gfPop || gfPop.jeton !== jeton) return;
      gfPop.verdicts = memo.verdicts;
      if (memo.gele) { gfCorpsPop(gfPopGeleHtml(memo.gele, gfPop.depuisFiche)); return; }
      var libres = debuts.filter(function (d) { var v = memo.verdicts.get(gfMinute(d)); return v && v.passe; });
      // (les plus proches de l heure prevue, dans l ordre de la journee)
      var montres = libres.slice().sort(function (a, b) { return Math.abs(a - point.debut) - Math.abs(b - point.debut) || a - b; }).slice(0, GF_HEURES_MONTREES).sort(function (a, b) { return a - b; });
      if (!montres.length) { gfCorpsPop('<p class="gf-hp__rien" role="status">Aucune autre heure libre ce jour-là.</p>'); return; }
      gfCorpsPop('<div class="gf-hp__heures" role="group" aria-label="Heures libres">' + montres.map(function (d) {
        var v = memo.verdicts.get(gfMinute(d));
        var pistes = gfPistesChangees(point, v.moves);
        var heure = gpHeure(d + offset);
        return '<button type="button" class="gf-hp__h" data-gf-hp-choix="' + gfMinute(d) + '" aria-label="' + gpEsc(point.nom + ' à ' + heure + (pistes ? ', ' + gfPistesEnMots(pistes).toLowerCase() : '')) + '">' + gpEsc(heure) + (pistes ? '<small>' + gpEsc(gfPistesEnMots(pistes)) + '</small>' : '') + '</button>';
      }).join('') + '</div>');
    }, function (erreur) {
      if (!gfPop || gfPop.jeton !== jeton) return;
      gfCorpsPop('<p class="gf-hp__rien" role="status">Les heures libres ne se lisent pas : ' + gpEsc(String((erreur && erreur.message) || 'le serveur ne répond pas.').replace(/\.$/, '')) + '.</p>');
    });
  }
  function gfCorpsPop(html) {
    var p = gfPop;
    var corps = p && p.el.querySelector('[data-gf-hp-corps]');
    if (!corps) return;
    var avaitFocus = p.el.contains(document.activeElement);
    corps.innerHTML = html;
    p.el.classList.add('is-rempli');
    gfPoserPop(true);
    var premier = p.el.querySelector('[data-gf-hp-choix], [data-gf-hp-fiche]');
    if (premier && p.clavier && (avaitFocus || document.activeElement === document.body)) premier.focus({ preventScroll: true });
    else if (!avaitFocus && document.activeElement === document.body) p.el.focus({ preventScroll: true });
  }
  function gfFermerHeure(rendreFocus, sansSortie) {
    var p = gfPop;
    if (!p) return;
    gfPop = null;
    document.removeEventListener('pointerdown', gfPopDehors, true);
    document.removeEventListener('keydown', gfPopClavier, true);
    document.removeEventListener('scroll', gfPopDefile, true);
    window.removeEventListener('resize', gfPopFermerSansFocus);
    var el = p.el;
    // (le focus sort d abord : vers la pastille, ou nulle part, jamais dans une pop-up qui s en va)
    var ancre = rendreFocus ? gfAncreDuPop(p) : null;
    if (ancre) ancre.focus({ preventScroll: true });
    else if (el.contains(document.activeElement) && document.activeElement.blur) document.activeElement.blur();
    el.removeAttribute('id');
    el.inert = true;
    el.style.pointerEvents = 'none';
    var reduit = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // (la goutte rentre dans sa pastille ; rien n attend sa sortie)
    if (sansSortie || reduit || !el.isConnected) el.remove();
    else {
      gfPoserPopSortie(p);
      el.classList.remove('is-nait');
      el.classList.add('is-part');
      var retirer = function () { if (el.isConnected) el.remove(); };
      el.addEventListener('animationend', retirer);
      setTimeout(retirer, 400);
    }
  }
  // (rentree vers la pastille la ou elle est maintenant)
  function gfPoserPopSortie(p) {
    var a = gfAncreDuPop(p);
    if (!a) return;
    var b = a.getBoundingClientRect();
    var r = p.el.getBoundingClientRect();
    p.el.style.setProperty('--gf-hp-ox', Math.round(b.left + b.width / 2 - r.left) + 'px');
    p.el.style.setProperty('--gf-hp-oy', Math.round(b.top + b.height / 2 - r.top) + 'px');
    // (la taille du panneau a pu changer depuis l ouverture : les heures sont arrivees)
    var sx = Math.min(1, Math.max(0.05, b.width / Math.max(1, r.width)));
    var sy = Math.min(1, Math.max(0.05, b.height / Math.max(1, r.height)));
    p.el.style.setProperty('--gf-hp-sx', sx.toFixed(3));
    p.el.style.setProperty('--gf-hp-sy', sy.toFixed(3));
    p.el.style.setProperty('--gf-hp-r0', Math.round(b.height / 2 / sx) + 'px / ' + Math.round(b.height / 2 / sy) + 'px');
  }
  function gfPopFermerSansFocus() { gfFermerHeure(false); }
  function gfPopDehors(ev) {
    var p = gfPop;
    if (!p || p.el.contains(ev.target)) return;
    // (la pastille elle-meme referme, son clic suit)
    var a = gfAncreDuPop(p);
    if (a && (a === ev.target || a.contains(ev.target))) return;
    gfFermerHeure(false);
  }
  function gfPopClavier(ev) {
    if (!gfPop) return;
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); gfFermerHeure(true); return; }
    if (ev.key !== 'Tab') return;
    // (le focus reste dans la pop-up tant qu elle est ouverte)
    var touchables = Array.prototype.slice.call(gfPop.el.querySelectorAll('button'));
    if (!touchables.length) return;
    var i = touchables.indexOf(document.activeElement);
    var suivant = ev.shiftKey ? (i <= 0 ? touchables.length - 1 : i - 1) : (i < 0 || i === touchables.length - 1 ? 0 : i + 1);
    ev.preventDefault();
    touchables[suivant].focus();
  }
  // Ce qui defile emporte la pastille : la pop-up se ferme plutot que de rester en l air.
  function gfPopDefile() {
    var p = gfPop;
    var a = p && gfAncreDuPop(p);
    if (!p || (a && Math.abs(a.getBoundingClientRect().top - p.haut) < 8)) return;
    gfFermerHeure(false);
  }
  function gfClicDansPop(ev) {
    var p = gfPop;
    if (!p || !ev.target.closest) return;
    if (ev.target.closest('[data-gf-hp-fermer]')) { gfFermerHeure(true); return; }
    if (ev.target.closest('[data-gf-hp-fiche]')) { var id = p.id; gfFermerHeure(false); if (typeof openPos === 'function') openPos(id); return; }
    var choix = ev.target.closest('[data-gf-hp-choix]');
    if (!choix) return;
    var minute = Number(choix.getAttribute('data-gf-hp-choix'));
    var v = p.verdicts && p.verdicts.get(minute);
    var r = gfDossier(p.id);
    var point = p.point;
    var offset = p.offset;
    gfFermerHeure(false);
    if (r && v && v.passe) gfEnregistrerHeure(r, point, minute / 60, offset, v.moves);
  }

  // ---- L ENREGISTREMENT ----
  // Une heure : le chemin du glisser des plannings, une etape apres l autre (envoyerDeplacementActivite,
  // PATCH activityMove), puis le toast « Annuler », qui la remet ou elle etait par le meme chemin.
  var gfEcritures = new Set();
  // La phrase du moteur, sans ce qui ne vaut que pour un autre ecran. (« Ce créneau vient de changer.
  // Merci de relancer la recherche » est celle du formulaire en ligne : le moteur la rend aussi quand
  // les pistes d un groupe deplace ne tiennent pas a la nouvelle heure, lib/database.js
  // ensureAssignableLanes ; au comptoir, elle se dit avec les pistes.)
  function gfPhraseErreur(erreur) {
    var phrase = String((erreur && erreur.message) || 'Le serveur n’a pas donné de motif.').replace(/\s*(Cet horaire reste inchangé|Les autres horaires restent inchangés)\.\s*$/, '').trim();
    return /^Ce créneau vient de changer\./.test(phrase) ? 'Pas de piste libre pour ce groupe à cette heure.' : phrase;
  }
  // Ce que le serveur a ecrit devient le dossier de l ecran, garde le temps que la relecture le rattrape.
  function gfAdopter(dossier, champs) {
    if (!dossier) return;
    if (typeof markReservationMutation === 'function') markReservationMutation(dossier.id, dossier, champs);
    var peint = typeof applyOptimisticReservation === 'function' ? applyOptimisticReservation(dossier) : null;
    // (la fiche ouverte sur ce dossier montre son Programme : une heure deplacee seule n en change pas
    // l empreinte, elle s y redessine ici)
    var fiche = document.getElementById('posOverlay');
    if (peint && !peint.fiche && fiche && !fiche.classList.contains('hidden') && state.selectedRes && Number(state.selectedRes.id) === Number(dossier.id) && typeof renderPos === 'function') renderPos();
  }
  // Un refus : rien n est ecrit (ou seulement les etapes deja passees, celles d un laser en deux vagues) ;
  // un collegue a change le dossier, sa version devient celle de l ecran.
  function gfApresRefus(erreur, champs) {
    if (erreur && erreur.derniere) gfAdopter(erreur.derniere, champs);
    else if (erreur && erreur.reservation && typeof applyOptimisticReservation === 'function') applyOptimisticReservation(erreur.reservation);
  }
  function gfDeplacerEtapes(r, moves) {
    var derniere = null;
    return moves.reduce(function (suite, move) {
      return suite.then(function () {
        return envoyerDeplacementActivite(derniere || r, move).then(function (payload) { derniere = payload && payload.reservation; });
      });
    }, Promise.resolve()).then(function () { return derniere; }, function (erreur) { if (erreur && typeof erreur === 'object') erreur.derniere = derniere; throw erreur; });
  }
  // (un groupe qui s est mis a jouer depuis l ouverture de la pop-up, ou pendant le glisser, ne bouge plus)
  function gfGeleAvantEcriture(r) {
    var gele = gfEnJeuDuDossier(r);
    if (gele && typeof showPlanningMoveNotice === 'function') showPlanningMoveNotice('Ne bouge pas', gele.phrase, 'warning');
    return Boolean(gele);
  }
  function gfEnregistrerHeure(r, point, d, offset, moves) {
    if (gfEcritures.has(Number(r.id)) || gfGeleAvantEcriture(r)) return Promise.resolve(null);
    gfEcritures.add(Number(r.id));
    var nom = r.name || 'Le groupe';
    var lanes = gfPistesChangees(point, moves);
    var dit = nom + ' : ' + point.nom + ' passe à ' + gpHeure(d + offset) + (lanes ? ', ' + gfPistesEnMots(lanes).toLowerCase() : '') + '.';
    var retour = gfMovesRetour(point);
    return gfDeplacerEtapes(r, moves).then(function (ecrit) {
      gfAdopter(ecrit, ['lanes', 'opsPlan']);
      if (typeof toastAnnulable === 'function') toastAnnulable(dit, function () { gfDefaireHeure(ecrit.id, point, offset, retour); });
      return ecrit;
    }, function (erreur) {
      gfApresRefus(erreur, ['lanes', 'opsPlan']);
      if (typeof showPlanningMoveNotice === 'function') showPlanningMoveNotice('Pas déplacé', point.nom + ' à ' + gpHeure(d + offset) + ' : ' + gfPhraseErreur(erreur), 'warning');
      return null;
    }).then(function (x) { gfEcritures.delete(Number(r.id)); return x; });
  }
  function gfDefaireHeure(id, point, offset, retour) {
    var r = gfDossier(id);
    if (!r || gfEcritures.has(Number(id))) return;
    gfEcritures.add(Number(id));
    gfDeplacerEtapes(r, retour).then(function (ecrit) {
      gfAdopter(ecrit, ['lanes', 'opsPlan']);
      if (typeof toast === 'function') toast((r.name || 'Le groupe') + ' : ' + point.nom + ' revient à ' + gpHeure(point.debut + offset) + '.');
    }, function (erreur) {
      gfApresRefus(erreur, ['lanes', 'opsPlan']);
      if (typeof showPlanningMoveNotice === 'function') showPlanningMoveNotice('Pas remis', point.nom + ' : ' + gfPhraseErreur(erreur), 'warning');
    }).then(function () { gfEcritures.delete(Number(id)); });
  }
  // LA LIGNE ENTIERE : l heure du dossier change par le chemin de « Modifier » (son enregistrement,
  // envoyerModificationReservation, et son calcul a blanc pour la cible) ; le planning replace chaque
  // activite du meme ecart. Le toast « Annuler » rend l heure d avant, et les pistes d avant, par le
  // meme chemin.
  function gfCorpsGroupe(r, heure, pistes) {
    var options = { requiresLanes: typeof reservationNeedsLanes === 'function' ? reservationNeedsLanes(r.type, r.formuleId) : undefined, allowPastStart: true };
    return {
      appliquer: function (b) { var x = Object.assign({}, b, { startTime: heure }); if (pistes) x.lanes = pistes.slice(); return x; },
      options: options,
    };
  }
  function gfDeplacerLeDossier(r, heure, pistes) {
    var c = gfCorpsGroupe(r, heure, pistes);
    return envoyerModificationReservation(r, c.appliquer, c.options);
  }
  function gfDeplacerGroupe(r, h) {
    if (gfEcritures.has(Number(r.id)) || gfGeleAvantEcriture(r)) return Promise.resolve(null);
    gfEcritures.add(Number(r.id));
    var avant = String(r.startTime || '').slice(0, 5);
    var pistesAvant = (r.lanes || []).map(Number);
    var heure = numToTime(h);
    var nom = r.name || 'Le groupe';
    var champs = ['startTime', 'lanes', 'opsPlan'];
    return gfDeplacerLeDossier(r, heure).then(function (payload) {
      var ecrit = payload && payload.reservation;
      gfAdopter(ecrit, champs);
      var pistes = ((ecrit && ecrit.lanes) || []).map(Number);
      var autres = pistes.length && pistes.join(',') !== pistesAvant.join(',');
      var suivi = payload && payload.planNonRefait ? ' Le planning n’a pas suivi : ' + String(payload.planNonRefait).replace(/\.$/, '') + '.'
        : ecrit && ecrit.validationStatus === 'staff_review' && r.validationStatus !== 'staff_review' ? ' Le planning n’a pas su la placer : elle passe en « à surveiller ».' : '';
      if (typeof toastAnnulable === 'function') toastAnnulable(nom + ' : réservation déplacée à ' + heure + (autres ? ', ' + gfPistesEnMots(pistes).toLowerCase() : '') + ', ses activités suivent.' + suivi, function () {
        var courant = gfDossier(ecrit.id) || ecrit;
        if (gfEcritures.has(Number(courant.id))) return;
        gfEcritures.add(Number(courant.id));
        gfDeplacerLeDossier(courant, avant, autres && pistesAvant.length ? pistesAvant : null).then(function (rendu) {
          gfAdopter(rendu && rendu.reservation, champs);
          if (typeof toast === 'function') toast(nom + ' : réservation remise à ' + avant + '.');
        }, function (erreur) {
          gfApresRefus(erreur, champs);
          if (typeof showPlanningMoveNotice === 'function') showPlanningMoveNotice('Pas remis', nom + ' : ' + gfPhraseErreur(erreur), 'warning');
        }).then(function () { gfEcritures.delete(Number(courant.id)); });
      });
      return ecrit;
    }, function (erreur) {
      gfApresRefus(erreur, champs);
      if (typeof showPlanningMoveNotice === 'function') showPlanningMoveNotice('Pas déplacé', nom + ' à ' + heure + ' : ' + gfPhraseErreur(erreur), 'warning');
      return null;
    }).then(function (x) { gfEcritures.delete(Number(r.id)); return x; });
  }
  // Le calcul a blanc de « Modifier » pour la ligne entiere a une heure (modifierABlanc) : ce qui serait
  // ecrit, ou le refus. Un plan que le moteur ne refait pas, ou qu il ne sait pas placer, ne passe pas :
  // le glisser ne pose jamais un groupe en « à surveiller ».
  var gfMemoireGroupe = new Map();
  function gfJugerGroupe(r, h) {
    var cle = [r.id, r.updatedAt, gfMinute(h)].join('|');
    if (gfMemoireGroupe.has(cle)) return gfMemoireGroupe.get(cle);
    if (typeof serveurSaitModifierABlanc === 'undefined' || !serveurSaitModifierABlanc) return Promise.resolve(null);
    var heure = numToTime(h);
    var c = gfCorpsGroupe(r, heure);
    var corps = Object.assign(buildReservationApiPayload(c.appliquer(r), c.options), { prixRaison: typeof RAISON_PRIX_PAR_DEFAUT === 'string' ? RAISON_PRIX_PAR_DEFAUT : '' }, r.updatedAt ? { baseUpdatedAt: r.updatedAt } : {});
    var promesse = apiRequest(API_ENDPOINTS.staffReservations, { method: 'POST', body: JSON.stringify({ dryRun: true, centerId: corps.centerId, modification: corps }) }).then(function (rep) {
      if (!rep || rep.modification !== true) return null;
      if (rep.refus) return rep.refus.code === 'reservation_modifiee' ? null : { passe: false, raison: gfPhraseErreur(rep.refus) };
      if (rep.planNonRefait) return { passe: false, raison: 'Le planning ne suit pas : ' + String(rep.planNonRefait).replace(/\.$/, '') + '.' };
      var ecrit = rep.reservation;
      if (!ecrit) return null;
      if (ecrit.validationStatus === 'staff_review' && r.validationStatus !== 'staff_review') return { passe: false, raison: 'Le planning ne sait pas placer ce créneau.' };
      var avant = (r.lanes || []).map(Number).join(',');
      var apres = (ecrit.lanes || []).map(Number).join(',');
      return { passe: true, raison: '', pistes: avant && apres && avant !== apres ? (ecrit.lanes || []).map(Number) : null };
    }, function () { return null; });
    gfMemoireGroupe.set(cle, promesse);
    if (gfMemoireGroupe.size > 60) gfMemoireGroupe.delete(gfMemoireGroupe.keys().next().value);
    return promesse;
  }

  // ---- LE GLISSER ----
  var gfGlisse = null;
  var gfClicMuetJusqua = 0;
  // (le temps qui passe, pas l heure du centre : une horloge reglee ou figee ne retient pas les clics)
  function gfInstant() { return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now(); }
  // Ce que le geste prend : la pastille d une heure, sinon la ligne (hors de ce qui se touche deja).
  function gfSourceDuGeste(cible, wrap) {
    if (!cible || !cible.closest || !wrap._gfRacine || wrap._gfRacine.getBoundingClientRect().width < 640) return null;
    var tr = cible.closest('tr.gf-r[data-gf-id]');
    if (!tr || !wrap.contains(tr)) return null;
    var act = cible.closest('[data-gf-act]');
    if (act) return { type: 'act', el: act, id: Number(tr.getAttribute('data-gf-id')), cle: act.getAttribute('data-gf-act'), heure: gpMinutesDe(act.textContent) };
    if (cible.closest('a, button, input, select, textarea, label, td.gf-bloc, [data-gf-voir], [role="button"]')) return null;
    return { type: 'ligne', el: tr, id: Number(tr.getAttribute('data-gf-id')) };
  }
  // Le haut du contenu du tableau qui defile, a l ecran : les demi-heures s y reperent.
  function gfOrigine(defile) { return defile.getBoundingClientRect().top + defile.clientTop - defile.scrollTop; }
  // Les demi-heures du tableau, dans le repere de son contenu : chacune de sa premiere a sa derniere
  // ligne (apres minuit, l heure continue : 00:30 se lit 24:30).
  function gfBlocsDuTableau(defile) {
    var blocs = [];
    var origine = gfOrigine(defile);
    var courant = null, avant = -Infinity;
    Array.prototype.forEach.call(defile.querySelectorAll('tbody > tr'), function (tr) {
      var td = tr.firstElementChild;
      if (td && td.classList.contains('gf-bloc') && td.hasAttribute('data-gf-bloc')) {
        var h = gpMinutesDe(td.getAttribute('data-gf-bloc'));
        if (h != null && h + 12 < avant) h += 24;
        if (h != null) avant = h;
        courant = { h: h, haut: Infinity, bas: -Infinity };
        blocs.push(courant);
      }
      if (!courant || tr.classList.contains('gf-now')) return;
      var b = tr.getBoundingClientRect();
      courant.haut = Math.min(courant.haut, b.top - origine);
      courant.bas = Math.max(courant.bas, b.bottom - origine);
    });
    return blocs.filter(function (b) { return b.h != null && b.bas > b.haut; });
  }
  // (l element du geste, retrouve si le tableau l a reecrit entre l appui et la levee)
  function gfElementDuGeste(g) {
    if (g.el && g.el.isConnected) return g.el;
    var tr = g.wrap.querySelector('tr.gf-r[data-gf-id="' + gfEchappe(g.id) + '"]');
    var el = tr && g.type === 'act' ? tr.querySelector('[data-gf-act="' + gfEchappe(g.cle) + '"]') : tr;
    g.el = el || null;
    return g.el;
  }
  function gfLancer(g, x, y) {
    var wrap = g.wrap;
    var defile = wrap._gfRacine && wrap._gfRacine.querySelector('.gf-defile');
    var r = gfDossier(g.id);
    if (!defile || !r) return false;
    if (g.type === 'ligne' && (!gfDroitsHeure(r.date).modifier || r.status === 'cancelled' || r.absentAt)) return false;
    if (g.type === 'act') {
      g.point = gfPointDe(r, g.cle);
      if (!g.point || !gfPeutDeplacerHeure(r, g.point.activityId)) return false;
      g.offset = gfOffset(g.point, g.heure);
    }
    gfFermerHeure(false, true);
    var gele = gfEnJeuDuDossier(r);
    if (gele) {
      if (typeof showPlanningMoveNotice === 'function') showPlanningMoveNotice('Ne bouge pas', g.type === 'ligne' ? (r.name || 'Ce groupe') + ' joue depuis ' + gele.depuis + ' : sa ligne ne bouge pas.' : gele.phrase, 'warning');
      return false;
    }
    g.r = r;
    g.defile = defile;
    g.blocs = gfBlocsDuTableau(defile);
    g.source = g.type === 'act' ? g.point.debut + g.offset : gpHeureReservee(r, getStaffTerrainSpan(r));
    // (le geste avance d une demi-heure a l autre et garde ses minutes : 14:10 posee sur 15:00 donne 15:10)
    g.decalage = Math.max(0, g.source - gfBloc(g.source));
    g.plancher = gfAuPlusTot(r, g.type === 'ligne');
    g.nom = g.type === 'act' ? g.point.nom : (r.name || 'Le groupe');
    g.verdicts = null;
    g.groupe = {};
    g.yLeve = y;
    g.armeHaut = false;
    g.armeBas = false;
    g.lance = true;
    // (le tableau ne se reecrit pas sous le geste : ses demi-heures restent ou le doigt les voit)
    wrap._gfGeste = true;
    var el = gfElementDuGeste(g);
    if (el) el.classList.add('is-glisse');
    // (le temps du geste, la surbrillance des lignes survolees s efface : seule la cible dit ou l heure
    // se pose)
    document.body.classList.add('gf-en-glisse');
    // L APERCU suit le pointeur ; LA CIBLE, une bande sur les lignes de la demi-heure visee, et LES
    // REPERES, un trait par demi-heure jugee, vivent dans le tableau qui defile.
    g.apercu = document.createElement('div');
    g.apercu.className = 'gf-apercu';
    g.apercu.setAttribute('aria-hidden', 'true');
    document.body.appendChild(g.apercu);
    g.reperes = document.createElement('div');
    g.reperes.className = 'gf-reperes';
    g.reperes.setAttribute('aria-hidden', 'true');
    defile.appendChild(g.reperes);
    g.cible = document.createElement('div');
    g.cible.className = 'gf-cible';
    g.cible.setAttribute('role', 'status');
    g.cible.innerHTML = '<span class="gf-cible__mot"></span>';
    g.cible.hidden = true;
    // (le mot de la cible se lit juste apres la colonne des heures, la ou l oeil suit le tableau)
    var colonne = defile.querySelector('td.gf-bloc');
    g.cible.style.paddingLeft = Math.round((colonne ? colonne.getBoundingClientRect().width : 0) + 8) + 'px';
    var tete = defile.querySelector('thead');
    g.cible.firstChild.style.top = Math.round((tete ? tete.getBoundingClientRect().height : 0) + 4) + 'px';
    defile.appendChild(g.cible);
    if (g.type === 'act') {
      var debuts = g.blocs.map(function (b) { return b.h + g.decalage - g.offset; }).filter(function (d) { return Math.abs(d - g.point.debut) > 1e-6 && d >= g.plancher.h - 1e-6; });
      g.attente = gfJuger(r, g.point, debuts, g.plancher).then(function (memo) {
        if (gfGlisse === g && g.lance) { g.verdicts = memo.verdicts; g.gele = memo.gele; gfPoserReperes(g); gfPeindreCible(g); }
        return memo;
      }, function () {
        if (gfGlisse === g && g.lance) { g.echec = true; gfPeindreCible(g); }
        return null;
      });
    }
    document.addEventListener('keydown', gfGlisseClavier, true);
    gfBouger(g, x, y);
    return true;
  }
  function gfGlisseClavier(ev) {
    if (ev.key !== 'Escape' || !gfGlisse || !gfGlisse.lance) return;
    ev.preventDefault();
    ev.stopPropagation();
    gfAnnulerGlisse();
  }
  // La demi-heure sous le pointeur, dans la partie visible du tableau seulement (sous sa tete collee) :
  // hors du tableau, rien n est vise et rien ne se pose.
  function gfBlocA(g, x, y) {
    var d = g.defile.getBoundingClientRect();
    var tete = g.defile.querySelector('thead');
    var haut = d.top + (tete ? tete.getBoundingClientRect().height : 0);
    if (x < d.left || x > d.right || y < haut || y >= d.bottom) return null;
    var yc = y - gfOrigine(g.defile);
    return g.blocs.find(function (b) { return yc >= b.haut && yc < b.bas; }) || null;
  }
  function gfPistesChangees(point, moves) {
    var lanes = point.activityId === 'bowling' && moves && moves[0] && moves[0].lanes;
    return lanes && lanes.join(',') !== point.pistes.join(',') ? lanes : null;
  }
  // Ce que dit une demi-heure : la sienne, trop tot, le verdict qui se calcule, celui du serveur.
  function gfVerdictCible(g, bloc) {
    if (!bloc) return null;
    var h = bloc.h + g.decalage;
    if (Math.abs(bloc.h - gfBloc(g.source)) < 1e-6) return { ton: 'meme', texte: gpHeure(g.source) + ' : son heure' };
    var debut = g.type === 'act' ? h - g.offset : h;
    var tot = gfPhrasePlancher(g.plancher, debut);
    if (tot) return { ton: 'non', texte: gpHeure(h) + ' : ' + tot };
    if (g.type === 'act') {
      if (g.gele) return { ton: 'non', texte: g.gele };
      if (g.echec) return { ton: 'calcul', texte: gpHeure(h) + ' : le serveur jugera au dépôt' };
      var v = g.verdicts && g.verdicts.get(gfMinute(debut));
      if (!v) return { ton: 'calcul', texte: gpHeure(h) + ' : vérification…' };
      var lanes = v.passe ? gfPistesChangees(g.point, v.moves) : null;
      return v.passe ? { ton: 'ok', texte: gpHeure(h) + ' : libre' + (lanes ? ', ' + gfPistesEnMots(lanes).toLowerCase() : '') } : { ton: 'non', texte: gpHeure(h) + ' : ' + v.raison };
    }
    var vg = g.groupe[gfMinute(h)];
    if (!vg || vg.attente) return { ton: 'calcul', texte: gpHeure(h) + ' : vérification…' };
    // (sans le calcul de « Modifier », la ligne ne se pose pas : le planning pourrait ne pas suivre)
    if (!vg.resultat) return { ton: 'non', texte: gpHeure(h) + ' : le calcul ne répond pas, passez par Modifier' };
    return vg.resultat.passe ? { ton: 'ok', texte: gpHeure(h) + ' : tout le groupe passe' + (vg.resultat.pistes ? ', ' + gfPistesEnMots(vg.resultat.pistes).toLowerCase() : '') } : { ton: 'non', texte: gpHeure(h) + ' : ' + vg.resultat.raison };
  }
  function gfDemanderGroupe(g, bloc) {
    if (!bloc || g.type !== 'ligne') return;
    var h = bloc.h + g.decalage;
    if (Math.abs(bloc.h - gfBloc(g.source)) < 1e-6 || gfPhrasePlancher(g.plancher, h)) return;
    var k = gfMinute(h);
    if (g.groupe[k]) return;
    var suivi = { attente: true, resultat: null };
    g.groupe[k] = suivi;
    suivi.promesse = gfJugerGroupe(g.r, h).then(function (res) {
      suivi.attente = false;
      suivi.resultat = res;
      if (gfGlisse === g && g.lance) { gfPoserReperes(g); gfPeindreCible(g); }
      return res;
    });
  }
  // OU CA PASSE, OU CA NE PASSE PAS : un trait vert ou rouge le long de chaque demi-heure jugee. Le
  // glisser d une heure les a toutes d un coup ; celui d une ligne, a mesure qu il les survole.
  function gfPoserReperes(g) {
    var html = '';
    g.blocs.forEach(function (b) {
      var v = gfVerdictCible(g, b);
      if (!v || (v.ton !== 'ok' && v.ton !== 'non')) return;
      html += '<i class="gf-repere is-' + v.ton + '" style="top:' + Math.round(b.haut) + 'px;height:' + Math.round(b.bas - b.haut) + 'px"></i>';
    });
    g.reperes.style.left = g.defile.scrollLeft + 'px';
    if (g.reperesHtml !== html) { g.reperesHtml = html; g.reperes.innerHTML = html; }
  }
  function gfPeindreCible(g) {
    var bloc = g.bloc;
    var v = gfVerdictCible(g, bloc);
    var dit = !bloc || !v ? g.nom + ' · ' + gpHeure(g.source) : g.nom + ' · ' + gpHeure(g.source) + ' → ' + gpHeure(bloc.h + g.decalage);
    if (g.apercu.textContent !== dit) { g.apercu.textContent = dit; g.taille = null; }
    var ton = 'gf-apercu' + (v ? ' is-' + v.ton : '');
    if (g.apercu.className !== ton) g.apercu.className = ton;
    g.verdict = v;
    if (!bloc || !v) { g.cible.hidden = true; return; }
    var d = g.defile;
    // (rien ne s ecrit quand rien ne change : le pointeur bouge a chaque image)
    var cle = [bloc.h, v.ton, v.texte, d.scrollLeft, d.clientWidth].join('|');
    g.cible.hidden = false;
    if (g.cibleCle === cle) return;
    g.cibleCle = cle;
    g.cible.className = 'gf-cible is-' + v.ton;
    g.cible.style.top = Math.round(bloc.haut) + 'px';
    g.cible.style.height = Math.round(bloc.bas - bloc.haut) + 'px';
    g.cible.style.left = d.scrollLeft + 'px';
    g.cible.style.width = d.clientWidth + 'px';
    g.cible.firstChild.textContent = v.texte;
  }
  function gfBouger(g, x, y) {
    g.x = x;
    g.y = y;
    // (au doigt, l apercu passe au-dessus : la main le cacherait ; sa taille se relit quand son texte change,
    // pas a chaque image)
    if (!g.taille) g.taille = [g.apercu.offsetWidth || 160, g.apercu.offsetHeight || 32];
    var l = g.taille[0], h = g.taille[1];
    var ax = g.tactile ? x - l / 2 : x + 16;
    var ay = g.tactile ? Math.max(4, y - h - 28) : y + 14;
    g.apercu.style.transform = 'translate3d(' + Math.round(ax) + 'px, ' + Math.round(ay) + 'px, 0)';
    var bloc = gfBlocA(g, x, y);
    gfArmerLesBords(g);
    if (bloc !== g.bloc) { g.bloc = bloc; gfDemanderGroupe(g, bloc); }
    gfPeindreCible(g);
    gfDefilerAuBord(g);
  }
  // LE BORD DU TABLEAU FAIT DEFILER : pres du haut ou du bas, la feuille avance sous l apercu.
  // Un bord ne s arme que si le pointeur va vers lui : sorti de sa bande de 44 px, ou 8 px plus pres de
  // ce bord que la ou l heure s est levee. Une heure levee pres du bord ne fait pas partir le tableau
  // sous un doigt immobile.
  function gfArmerLesBords(g) {
    var d = g.defile.getBoundingClientRect();
    var tete = g.defile.querySelector('thead');
    var b = { haut: d.top + (tete ? tete.getBoundingClientRect().height : 0) + 44, bas: d.bottom - 44 };
    if (g.y >= b.haut || g.y <= g.yLeve - 8) g.armeHaut = true;
    if (g.y <= b.bas || g.y >= g.yLeve + 8) g.armeBas = true;
    return b;
  }
  function gfDefilerAuBord(g) {
    if (g.bord) return;
    var tour = function () {
      g.bord = 0;
      if (gfGlisse !== g || !g.lance) return;
      var b = gfArmerLesBords(g);
      var pas = g.y < b.haut && g.armeHaut ? -Math.ceil((b.haut - g.y) / 3) : g.y > b.bas && g.armeBas ? Math.ceil((g.y - b.bas) / 3) : 0;
      if (!pas) return;
      var avant = g.defile.scrollTop;
      g.defile.scrollTop = avant + Math.max(-18, Math.min(18, pas));
      if (g.defile.scrollTop === avant) return;
      var bloc = gfBlocA(g, g.x, g.y);
      if (bloc !== g.bloc) { g.bloc = bloc; gfDemanderGroupe(g, bloc); }
      gfPeindreCible(g);
      g.bord = requestAnimationFrame(tour);
    };
    g.bord = requestAnimationFrame(tour);
  }
  function gfNettoyerGlisse(g) {
    if (g.bord) cancelAnimationFrame(g.bord);
    g.bord = 0;
    document.removeEventListener('keydown', gfGlisseClavier, true);
    // (Echap pendant un glisser a la souris : le bouton est encore tenu, ses ecouteurs s en vont aussi)
    if (!g.tactile) gfSourisFin();
    if (g.el) g.el.classList.remove('is-glisse');
    if (g.apercu) g.apercu.remove();
    if (g.reperes) g.reperes.remove();
    if (g.cible) g.cible.remove();
    document.body.classList.remove('gf-en-glisse');
    g.lance = false;
    if (gfGlisse === g) gfGlisse = null;
    gfGesteFini(g.wrap);
  }
  // (ce qui a change pendant le geste s ecrit maintenant)
  function gfGesteFini(wrap) {
    if (!wrap) return;
    wrap._gfGeste = false;
    if (wrap._gfARefaire) { wrap._gfARefaire = false; renderGlobalPlanning(wrap); }
  }
  function gfAnnulerGlisse() {
    var g = gfGlisse;
    if (!g) return;
    gfClicMuetJusqua = gfInstant() + 400;
    if (g.lance) gfNettoyerGlisse(g); else gfGlisse = null;
  }
  function gfDeposer(g, x, y) {
    var bloc = gfBlocA(g, x, y);
    var v = gfVerdictCible(g, bloc);
    var r = gfDossier(g.id) || g.r;
    gfNettoyerGlisse(g);
    if (!bloc || !v || v.ton === 'meme') return;
    var h = bloc.h + g.decalage;
    var refuser = function (texte) { if (typeof showPlanningMoveNotice === 'function') showPlanningMoveNotice('Pas déplacé', g.nom + ' · ' + texte, 'warning'); };
    if (v.ton === 'non') { refuser(v.texte); return; }
    if (g.type === 'act') {
      var debut = h - g.offset;
      // (le verdict pas encore la : il arrive, puis il decide ; sans lui, le serveur juge a l ecriture)
      Promise.resolve(g.attente).then(function (memo) {
        if (memo && memo.gele) { refuser(memo.gele); return; }
        var vv = memo && memo.verdicts.get(gfMinute(debut));
        if (vv && !vv.passe) { refuser(gpHeure(h) + ' : ' + vv.raison); return; }
        var dossier = gfDossier(g.id) || r;
        gfEnregistrerHeure(dossier, g.point, debut, g.offset, vv ? vv.moves : gfMoves(dossier, g.point, debut));
      });
      return;
    }
    var suivi = g.groupe[gfMinute(h)];
    Promise.resolve(suivi && suivi.promesse).then(function (res) {
      if (!res) { refuser(gpHeure(h) + ' : le calcul ne répond pas, passez par Modifier'); return; }
      if (!res.passe) { refuser(gpHeure(h) + ' : ' + res.raison); return; }
      gfDeplacerGroupe(gfDossier(g.id) || r, h);
    });
  }

  // LA SOURIS : la pastille ou la ligne se prend des qu elle a bouge de 6 px, bouton tenu.
  function gfSourisBas(wrap, e) {
    if (e.pointerType === 'touch' || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || gfGlisse) return;
    var src = gfSourceDuGeste(e.target, wrap);
    if (!src) return;
    // (une pastille ne se selectionne pas comme du texte : son clic, lui, suit)
    if (src.type === 'act') e.preventDefault();
    gfGlisse = Object.assign(src, { wrap: wrap, x0: e.clientX, y0: e.clientY, pointeur: e.pointerId, lance: false, tactile: false });
    document.addEventListener('pointermove', gfSourisBouge, true);
    document.addEventListener('pointerup', gfSourisHaut, true);
    document.addEventListener('pointercancel', gfSourisAnnule, true);
  }
  function gfSourisFin() {
    document.removeEventListener('pointermove', gfSourisBouge, true);
    document.removeEventListener('pointerup', gfSourisHaut, true);
    document.removeEventListener('pointercancel', gfSourisAnnule, true);
  }
  function gfSansSelection() {
    var selection = window.getSelection && window.getSelection();
    if (selection && !selection.isCollapsed && selection.removeAllRanges) selection.removeAllRanges();
  }
  function gfSourisBouge(e) {
    var g = gfGlisse;
    if (!g || g.tactile || e.pointerId !== g.pointeur) return;
    if (!g.lance) {
      if (Math.hypot(e.clientX - g.x0, e.clientY - g.y0) < GF_SEUIL_SOURIS) return;
      if (!gfLancer(g, e.clientX, e.clientY)) { gfSourisFin(); gfGlisse = null; gfClicMuetJusqua = gfInstant() + 400; return; }
    }
    e.preventDefault();
    gfSansSelection();
    gfBouger(g, e.clientX, e.clientY);
  }
  function gfSourisHaut(e) {
    var g = gfGlisse;
    if (!g || g.tactile || e.pointerId !== g.pointeur) return;
    gfSourisFin();
    if (!g.lance) { gfGlisse = null; return; }
    gfClicMuetJusqua = gfInstant() + 400;
    e.preventDefault();
    gfSansSelection();
    gfDeposer(g, e.clientX, e.clientY);
  }
  function gfSourisAnnule(e) {
    var g = gfGlisse;
    if (!g || g.tactile || e.pointerId !== g.pointeur) return;
    gfSourisFin();
    gfAnnulerGlisse();
  }
  // AU DOIGT : un appui long leve la pastille ou la ligne (assets/pinlane-touch-drag.js), le doigt la
  // promene, le relacher la pose. Un doigt qui part tout de suite fait defiler le tableau, un tap reste
  // un toucher. Le temps de l appui, le tableau ne se reecrit pas : le geste reste a son element.
  function gfDoigtDebut(wrap, e) {
    if (!window.PinlaneTouchDrag || (gfGlisse && gfGlisse.lance) || !e.touches || e.touches.length !== 1) return;
    var src = gfSourceDuGeste(e.target, wrap);
    if (!src) return;
    window.PinlaneTouchDrag.demarrer(e, {
      lever: function (p) {
        var g = Object.assign({}, src, { wrap: wrap, tactile: true, lance: false });
        gfGlisse = g;
        if (!gfLancer(g, p.clientX, p.clientY)) { gfGlisse = null; gfClicMuetJusqua = gfInstant() + 600; }
      },
      bouger: function (p) { var g = gfGlisse; if (g && g.tactile && g.lance) gfBouger(g, p.clientX, p.clientY); },
      deposer: function (p) {
        var g = gfGlisse;
        gfClicMuetJusqua = gfInstant() + 600;
        if (g && g.tactile && g.lance) gfDeposer(g, p.clientX, p.clientY); else gfGesteFini(wrap);
      },
      annuler: function (etaitLeve) {
        var g = gfGlisse;
        if (etaitLeve) gfClicMuetJusqua = gfInstant() + 600;
        if (g && g.tactile && g.lance) gfNettoyerGlisse(g);
        else { if (g && g.tactile) gfGlisse = null; gfGesteFini(wrap); }
      },
    }, { maintienMs: GF_MAINTIEN_DOIGT });
    // (pose apres le demarrage : un geste d avant, abandonne par celui-ci, a rendu le tableau libre)
    if (window.PinlaneTouchDrag.actif()) wrap._gfGeste = true;
  }

  // DEPUIS LA FICHE (le Programme de l onglet Infos, renderGroupeEtapes) : la cle d une heure qui se
  // touche, et la meme pop-up.
  window.pgCleHeure = function (r, etape) {
    if (!r || !etape || etape.start == null || etape.libre || etape.aPlacer || etape.extra || !etape.activityId) return '';
    var id = etape.activityId;
    if (GF_SANS_HEURE[id] || /^service_/.test(id) || !gfPeutDeplacerHeure(r, id)) return '';
    var cle = id === 'laser_game' ? (etape.unite ? 'laser_game:' + etape.unite : '') : id;
    return cle && gfPointDe(r, cle) ? cle : '';
  };
  window.pgOuvrirHeureFiche = function (bouton, ev) {
    if (ev) { ev.preventDefault(); ev.stopPropagation(); }
    if (!bouton) return;
    var r = gfDossier(bouton.getAttribute('data-pg-res'));
    if (!gfOuvrirHeure(bouton, r, bouton.getAttribute('data-pg-heure'), gpMinutesDe(bouton.textContent), true, Boolean(ev && ev.detail === 0)) && typeof toast === 'function') toast('Cette heure ne se change pas d’ici : passez par Modifier.');
  };
  window.__gfHeure = { ouverte: function () { return Boolean(gfPop); }, glisse: function () { return Boolean(gfGlisse && gfGlisse.lance); } };

  // ---- LE RENDU --------------------------------------------------------------
  var gfStats = window.__gfStats = { rendus: 0, ecritures: 0 };
  function renderGlobalPlanning(wrap) {
    if (!wrap) return;
    // UN GESTE EN COURS (le glisser d une heure ou d une ligne, l appui long qui le prepare) : le tableau
    // ne se reecrit pas sous le doigt, il s ecrit a la fin du geste (gfGesteFini). Un geste perdu (aucun
    // n est plus en cours) ne retient rien.
    if (wrap._gfGeste) {
      if ((gfGlisse && gfGlisse.lance && gfGlisse.wrap === wrap) || (window.PinlaneTouchDrag && window.PinlaneTouchDrag.actif())) { wrap._gfARefaire = true; return; }
      wrap._gfGeste = false;
    }
    // EPINGLE A UN JOUR (la fenetre « planning de ce jour » d une demande sur mesure) : le
    // modele lit le jour de la page. Le temps du rendu, ce jour-la, sans filtre ni recherche ;
    // le redessin au redimensionnement passe aussi par ici.
    var epingle = wrap.dataset && wrap.dataset.gfJour;
    if (epingle && (state.currentDate !== epingle || state.staffStatusFilter !== 'all' || state.searchTerm)) {
      var avant = { d: state.currentDate, f: state.staffStatusFilter, s: state.searchTerm };
      state.currentDate = epingle;
      state.staffStatusFilter = 'all';
      state.searchTerm = '';
      try { renderGlobalPlanning(wrap); } finally { state.currentDate = avant.d; state.staffStatusFilter = avant.f; state.searchTerm = avant.s; }
      return;
    }
    var m = gpModele();
    var q = gfCle(state.searchTerm || '');
    var racine = wrap._gfRacine && wrap._gfRacine.isConnected ? wrap._gfRacine : null;
    if (!racine) {
      wrap.innerHTML = '<div class="gf"><div class="gf-bandeau" role="status" hidden></div><div class="gf-defile" data-scroll-key="feuille-du-jour"></div><button type="button" class="gf-retour" hidden></button></div>';
      racine = wrap.firstChild;
      wrap._gfRacine = racine;
      gfBrancher(wrap);
      gfDecrocher(wrap);
    }
    gfStats.rendus += 1;
    var boite = wrap.closest('.planning-box');
    var plein = Boolean(boite && boite.classList.contains('expanded'));
    // (lu avant toute ecriture : le lire apres forcerait une mise en page de plus)
    var largeur = racine.getBoundingClientRect().width;
    var cartes = largeur < 640;
    // (sous 1060 px, la case d heure n a plus la largeur de « 2 pistes libres » : « 2 pistes »)
    m.blocCourt = largeur < 1060;
    wrap._gfCourt = m.blocCourt;
    if (!epingle) pbPoser(gfBandeauHtml(m), m);
    var bandeau = racine.querySelector('.gf-bandeau');
    var ferme = Boolean(m.fenetre && m.fenetre.closed);
    var texte = ferme ? 'Centre fermé ce jour-là' + (m.groupes.length ? ' · réservations existantes à contrôler' : '') : m.fenetre && m.fenetre.exceptionnelle ? 'Ouverture exceptionnelle, de ' + gpHeure(m.fenetre.open) + ' à ' + (m.fenetre.close >= 24 ? gpHeure(m.fenetre.close - 24) : gpHeure(m.fenetre.close)) + (m.fenetre.motif ? ', ' + m.fenetre.motif : '') : !m.groupes.length && !m.retenues.length ? 'Aucune réservation ce jour-là' : '';
    bandeau.hidden = !texte;
    bandeau.className = 'gf-bandeau' + (ferme ? ' is-ferme' : m.fenetre && m.fenetre.exceptionnelle ? ' is-ouverture' : '');
    if (bandeau.textContent !== texte) bandeau.textContent = texte;
    var defile = racine.querySelector('.gf-defile');
    wrap._gfModele = m;
    // (un jour vide cherche aussi : le client est peut-etre sur une autre date)
    var aEcrire = Boolean(m.groupes.length || m.retenues.length || q || (!ferme && !cartes));
    if (aEcrire) {
      var actif = document.activeElement;
      var focus = actif && defile.contains(actif) ? gfCleFocus(actif) : null;
      gfEcrire(wrap, defile, gfParties(m, q, cartes), function () { gfPoserRetards(defile, m); });
      if (focus && !actif.isConnected) gfRendreFocus(defile, focus);
    } else if (wrap._gfParties || defile.firstChild) {
      defile.textContent = '';
      wrap._gfParties = null;
      wrap._gfLignes = null;
      gfStats.ecritures += 1;
    }
    gfRemplir(wrap, defile, m, q);
    racine.classList.toggle('is-vide', !aEcrire);
    gfHauteur(wrap);
    // LE TABLEAU S OUVRE SUR CE QUI RESTE A FAIRE, une fois par jour affiche, et il y
    // revient quand un filtre ou un nom tape se retire : ensuite, le defilement de
    // l equipe ne bouge plus.
    var filtre = Boolean(q || m.visibles);
    if (wrap._gfJourOuvert !== m.jour || wrap._gfFiltre !== filtre || wrap._gfPlein !== plein) {
      wrap._gfJourOuvert = m.jour;
      wrap._gfFiltre = filtre;
      wrap._gfPlein = plein;
      wrap._gfSuit = true;
      wrap._gfRegle = null;
    }
    if (wrap._gfSuit) {
      gfAllerAMaintenant(wrap, false);
      // (repaintKeepingScroll rend le defilement d avant le rendu : la barre suit apres lui)
      if (!wrap._gfApres) wrap._gfApres = requestAnimationFrame(function () { wrap._gfApres = 0; if (wrap._gfSuit) gfAllerAMaintenant(wrap, false); });
    }
    gfSuivreMaintenant(wrap);
    // (la pop-up d une heure suit sa pastille : reecrite au meme endroit, elle reste ; partie ou
    // deplacee, la pop-up se ferme)
    if (gfPop && !gfPop.depuisFiche) gfPopDefile();
  }
  // CE QUI CHANGE A CHAQUE MINUTE s ecrit en place, ici seulement : la
  // pastille de l heure et les minutes de retard. Le HTML compare n en porte
  // rien : a la minute, la feuille ne se reecrit que si un etat a change, et un
  // clic qui tombe sur la minute n est jamais perdu.
  // LE SEUL BOUTON PLEIN DU TABLEAU se pose de meme, sur la ligne et hors du HTML compare :
  // un geste ne reecrit pas la ligne d a cote. Il va au groupe en retard LE PLUS RECENT,
  // celui qui est probablement devant le comptoir, pas au plus ancien (l audit du
  // 2026-11-03, +2h10) ; sans retard, au prochain attendu. (plus tard, le geste reste
  // discret : rien a faire ne pousse pas un bouton plein ; un nom tape qui ne laisse qu un
  // groupe attendu, si)
  function gfRemplir(wrap, defile, m, q) {
    var poser = function (n, texte) { if (n.textContent !== texte) n.textContent = texte; };
    defile.querySelectorAll('[data-gf-maintenant]').forEach(function (p) { poser(p, gpHeure(m.maintenant)); });
    // (dans une demi-heure libre, le trait descend d une minute a l autre : 20:38 au quart
    // de la case de 20:30 ; l heure s ecrit sous le trait tant qu il est dans le haut)
    var trait = defile.querySelector('[data-gf-now-libre]');
    if (trait && m.maintenant != null) {
      var frac = Math.min(1, Math.max(0, (m.maintenant - Number(trait.getAttribute('data-gf-now-libre'))) / 0.5));
      var haut = (frac * 100).toFixed(1) + '%';
      if (trait.style.top !== haut) trait.style.top = haut;
      trait.classList.toggle('is-dessous', frac < 0.5);
    }
    var enRetard = q ? [] : defile.querySelectorAll('.gf-r.is-retard [data-gf-arrive]');
    var bouton = enRetard.length ? enRetard[enRetard.length - 1] : defile.querySelector(q ? '.gf-r [data-gf-arrive]' : '.gf-r.is-proche [data-gf-arrive]');
    if (q && defile.querySelectorAll('[data-gf-id]').length !== 1) bouton = null;
    var ligne = bouton ? bouton.closest('.gf-r') : null;
    if (wrap._gfPremier !== ligne) {
      if (wrap._gfPremier) wrap._gfPremier.classList.remove('is-premier');
      if (ligne) ligne.classList.add('is-premier');
      wrap._gfPremier = ligne;
    }
    gfPoserRetards(defile, m);
  }
  // Les minutes du retard, en place. (gfEcrire les pose aussi avant de mesurer une rangee
  // reecrite : « En retard · 12 min » peut la faire passer sur deux lignes, et une pastille
  // encore vide la mesurait trop basse.)
  function gfPoserRetards(racine, m) {
    var retards = racine.querySelectorAll('[data-gf-retard]');
    if (!retards.length) return;
    var parId = new Map(m.groupes.map(function (g) { return [g.id, g]; }));
    retards.forEach(function (n) {
      var g = parId.get(n.getAttribute('data-gf-retard'));
      if (!g || m.maintenant == null) return;
      var min = g.rt && typeof minutesDuRetard === 'function' ? minutesDuRetard(g.rt, m.maintenant) : gfMinutesDeRetard(g, m);
      var texte = 'En retard · ' + (typeof dureeDuRetard === 'function' ? dureeDuRetard(min) : min + ' min');
      if (n.textContent !== texte) n.textContent = texte;
      var bulle = 'En retard de ' + min + ' min';
      if (n.getAttribute('title') !== bulle) n.setAttribute('title', bulle);
    });
  }
  // Le focus survit a la reecriture : la meme ligne, ou le meme bouton.
  function gfCleFocus(el) {
    var ligne = el.closest && el.closest('[data-gf-id]');
    if (!ligne) return null;
    return { id: ligne.getAttribute('data-gf-id'), arrive: Boolean(el.closest('[data-gf-arrive], [data-compte-id]')) };
  }
  // (« Arrivé » pointe puis devient « Ils sont 10 » : le focus passe de l un a
  // l autre, le second toucher est sous le doigt)
  function gfRendreFocus(defile, f) {
    var ligne = defile.querySelector('[data-gf-id="' + CSS.escape(f.id) + '"]');
    if (!ligne) return;
    var cible = f.arrive ? ligne.querySelector('[data-gf-arrive], [data-compte-id]') || ligne : ligne;
    cible.focus({ preventScroll: true });
  }

  // LA HAUTEUR : la feuille va jusqu au bas de l ecran et defile en elle-meme
  // (un panneau de liste se borne, il ne pousse pas la page : README Pinlane,
  // 2026-08-13). Une hauteur FIXE, pas un plafond : filtrer ou chercher ne la
  // change pas, et la liste du dessous ne saute pas sous le doigt (rush-status,
  // « Arrivé » sous un filtre qui revient a « Tout »). Agrandie, elle prend
  // l ecran. Au telephone, chaque ligne est une carte et la page defile.
  var GF_BAS = 7;
  var GF_MIN = 320;
  function gfHauteur(wrap) {
    var racine = wrap._gfRacine;
    var defile = racine && racine.querySelector('.gf-defile');
    if (!defile) return;
    var boite = wrap.closest('.planning-box');
    var plein = Boolean(boite && boite.classList.contains('expanded'));
    var cartes = racine.getBoundingClientRect().width < 640;
    var valeur = '';
    if (!plein && !cartes) {
      var haut = defile.getBoundingClientRect().top + window.scrollY;
      var dispo = Math.floor(window.innerHeight - haut - GF_BAS);
      // (la boite commence sous la moitie de l ecran : elle prend un ecran)
      valeur = Math.max(GF_MIN, dispo < GF_MIN ? window.innerHeight - 24 : dispo) + 'px';
    }
    if (defile.style.height !== valeur) defile.style.height = valeur;
  }

  // CE QUI S OUVRE : LA BARRE DE L HEURE AU TIERS HAUT DE L ECRAN (l audit du 2026-11-03 :
  // a 15:10, 13 groupes au-dessus d elle et 4 en dessous, quand l etudiant veut d abord
  // qui arrive). Les retards qui sortent par le haut, le compteur « En retard » les dit.
  function gfOuverture(defile, now) {
    var tete = defile.querySelector('thead');
    var hTete = tete ? tete.getBoundingClientRect().height : 0;
    var vue = defile.clientHeight - hTete;
    var y = now.offsetTop - hTete - vue / 3;
    // (jamais une ligne coupee en deux sous la tete : la plus proche passe entiere dessous,
    // parmi celles que le defilement peut y amener : au bas de la feuille, il s arrete avant)
    var lignes = defile.querySelectorAll('.gf-r, .gf-libre');
    var fond = defile.scrollHeight - defile.clientHeight;
    var meilleur = 0;
    for (var i = 0; i < lignes.length; i += 1) {
      var haut = lignes[i].offsetTop - hTete;
      if (haut <= fond && Math.abs(haut - y) < Math.abs(meilleur - y)) meilleur = haut;
    }
    return Math.max(0, Math.round(meilleur));
  }
  // LA FEUILLE SUIT L HEURE (2026-11-02) tant qu on ne la fait pas defiler : une
  // feuille laissee ouverte toute l apres-midi garde la barre a la meme hauteur, une
  // rangee qui change de hauteur ou l agrandissement ne la decalent plus. Un defilement
  // a la main la laisse ou elle est ; le bouton la raccroche. L ORDRE NE CHANGE JAMAIS :
  // pointer un groupe ne bouge pas le tableau, seule la barre le fait, et jamais sous
  // une main qui bouge.
  var GF_MAIN = 2500;
  function gfAllerAMaintenant(wrap, doux) {
    var racine = wrap._gfRacine;
    var defile = racine && racine.querySelector('.gf-defile');
    var now = defile && defile.querySelector('.gf-now');
    // (un filtre, un nom tape : ce qu ils montrent se lit depuis le haut)
    if (!now || wrap._gfFiltre) { if (defile && !doux) { defile.scrollTop = 0; wrap._gfPose = 0; } return; }
    if (racine.getBoundingClientRect().width < 640) {
      var l = now.previousElementSibling, n = 0;
      while (l && n < 2) { n += 1; l = l.previousElementSibling; }
      var cible = (l ? l.nextElementSibling : defile.querySelector('tbody tr')) || now;
      // (le gerant, au telephone : la liste s ouvre sur l heure, une fois ; ensuite, la page
      // est a lui)
      if (doux) cible.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else if (wrap._gfRegle == null) { wrap._gfRegle = 0; cible.scrollIntoView({ block: 'start' }); }
      return;
    }
    if (doux) wrap._gfRegle = null;
    var y;
    if (wrap._gfRegle == null) {
      y = gfOuverture(defile, now);
      wrap._gfRegle = now.offsetTop - y;
      gfRecalerOuverture(wrap);
    } else {
      y = Math.max(0, now.offsetTop - wrap._gfRegle);
      if (Math.abs(defile.scrollTop - y) > 1 && performance.now() - (wrap._gfMain || -GF_MAIN) < GF_MAIN) return;
    }
    if (doux && typeof defile.scrollTo === 'function') defile.scrollTo({ top: y, behavior: 'smooth' });
    else if (Math.abs(defile.scrollTop - y) > 1) defile.scrollTop = y;
    wrap._gfPose = doux ? null : defile.scrollTop;
  }
  // L OUVERTURE SE RECALE UNE FOIS, QUAND LE TABLEAU A SA HAUTEUR (2026-11-03, la suite
  // GitHub : [N1] rouge sur une machine lente). La premiere position se prend au premier
  // rendu ; si les lignes changent de hauteur ensuite (la police Geist qui arrive en
  // swap, une rubrique qui passe a la ligne, un contenu arrive tard), la regle gardee
  // (_gfRegle, la barre a la meme hauteur) laissait une ligne coupee sous la tete. Apres
  // document.fonts.ready, puis des que deux mesures du tableau se suivent egales,
  // l ouverture se recalcule une fois, seulement si la feuille suit encore l heure
  // (personne n a defile, aucun filtre).
  function gfRecalerOuverture(wrap) {
    var jeton = (wrap._gfRecale || 0) + 1;
    wrap._gfRecale = jeton;
    var pret = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    pret.then(function () {
      var avant = -1;
      var tours = 0;
      var mesurer = function () {
        if (wrap._gfRecale !== jeton || !wrap.isConnected || !wrap._gfRacine) return;
        var defile = wrap._gfRacine.querySelector('.gf-defile');
        var now = defile && defile.querySelector('.gf-now');
        if (!now) return;
        var h = defile.scrollHeight + '|' + now.offsetTop;
        if (h !== avant && tours < 60) { avant = h; tours += 1; requestAnimationFrame(mesurer); return; }
        if (!wrap._gfSuit || wrap._gfFiltre || wrap._gfRegle == null || wrap._gfRacine.getBoundingClientRect().width < 640) return;
        var y = gfOuverture(defile, now);
        wrap._gfRegle = now.offsetTop - y;
        if (Math.abs(defile.scrollTop - y) > 1) defile.scrollTop = y;
        wrap._gfPose = defile.scrollTop;
      };
      requestAnimationFrame(mesurer);
    });
  }
  // (un defilement qui ne vient pas d ici, ou un geste de defilement, decroche)
  function gfDecrocher(wrap) {
    var defile = wrap._gfRacine && wrap._gfRacine.querySelector('.gf-defile');
    if (!defile || defile._gfEcoute) return;
    defile._gfEcoute = true;
    var lacher = function () { wrap._gfSuit = false; };
    defile.addEventListener('wheel', lacher, { passive: true });
    defile.addEventListener('touchmove', lacher, { passive: true });
    defile.addEventListener('pointermove', function () { wrap._gfMain = performance.now(); }, { passive: true });
    defile.addEventListener('scroll', function () {
      if (wrap._gfApres || wrap._gfPose == null || Math.abs(defile.scrollTop - wrap._gfPose) <= 2) return;
      // (la boite qui grandit ou le tableau qui raccourcit : le navigateur ramene le
      // defilement au bout de la feuille, la ou elle etait n existe plus. Ce n est pas une
      // main : la feuille suit toujours l heure et se recale sur une ligne entiere)
      if (wrap._gfSuit && wrap._gfPose > defile.scrollHeight - defile.clientHeight + 1) { wrap._gfRegle = null; gfAllerAMaintenant(wrap, false); return; }
      lacher();
    }, { passive: true });
  }
  function gfSuivreMaintenant(wrap) {
    var racine = wrap._gfRacine;
    var bouton = racine.querySelector('.gf-retour');
    var defile = racine.querySelector('.gf-defile');
    var now = defile.querySelector('.gf-now');
    if (wrap._gfObservateur) { wrap._gfObservateur.disconnect(); wrap._gfObservateur = null; }
    if (!now || typeof IntersectionObserver !== 'function' || racine.getBoundingClientRect().width < 640) { bouton.hidden = true; return; }
    var texte = gpHeure(wrap._gfModele.maintenant);
    // (la barre passe sous la tete collee)
    var tete = defile.querySelector('thead');
    var hTete = tete ? Math.round(tete.getBoundingClientRect().height) : 36;
    var observateur = new IntersectionObserver(function (entrees) {
      var e = entrees[entrees.length - 1];
      var dessous = e.boundingClientRect.top > (e.rootBounds ? e.rootBounds.bottom : 0);
      bouton.hidden = e.isIntersecting;
      var libelle = (dessous ? '↓ ' : '↑ ') + 'Maintenant · ' + texte;
      if (bouton.textContent !== libelle) bouton.textContent = libelle;
      bouton.classList.toggle('is-haut', !dessous);
    }, { root: defile, threshold: 0, rootMargin: '-' + hTete + 'px 0px 0px 0px' });
    observateur.observe(now);
    wrap._gfObservateur = observateur;
  }

  // ---- LES GESTES ------------------------------------------------------------
  // « Arrivé » pointe le groupe (le chemin de la vue Terrain, avec son toast
  // « Annuler ») ; « Ils sont 10 » ouvre le compte ; un clic ou Entree ailleurs
  // sur la ligne ouvre la fiche.
  // L heure touchee ouvre sa pop-up ; une heure que ce dossier ne laisse plus changer d ici ouvre la fiche,
  // comme le reste de la ligne.
  function gfToucherHeure(act, parClavier) {
    var tr = act.closest('[data-gf-id]');
    var r = tr && gfDossier(tr.getAttribute('data-gf-id'));
    if (!r) return;
    if (!gfOuvrirHeure(act, r, act.getAttribute('data-gf-act'), gpMinutesDe(act.textContent), false, parClavier) && typeof openPos === 'function') openPos(Number(r.id));
  }
  function gfBrancher(wrap) {
    wrap.addEventListener('click', function (e) {
      if (!e.target.closest) return;
      // (le clic qui suit un glisser ne fait rien d autre : la ligne posee n ouvre pas sa fiche)
      if (gfInstant() < gfClicMuetJusqua) { gfClicMuetJusqua = 0; e.preventDefault(); e.stopPropagation(); return; }
      var heureAct = e.target.closest('[data-gf-act]');
      if (heureAct) { gfToucherHeure(heureAct); return; }
      var arrive = e.target.closest('[data-gf-arrive]');
      if (arrive) { setReservationStatusDirect(arrive.getAttribute('data-gf-arrive'), 'arrived', e); return; }
      var compte = e.target.closest('[data-compte-id]');
      // (le second clic d un double clic sur « Arrivé » tombe sur « Ils sont 10 » :
      // il n ouvre pas le compte)
      if (compte && typeof ouvrirCompteArrivee === 'function') { if (e.detail < 2) ouvrirCompteArrivee(Number(compte.getAttribute('data-compte-id')), compte, e); return; }
      if (e.target.closest('.gf-retour')) { wrap._gfSuit = true; gfAllerAMaintenant(wrap, true); return; }
      var payer = e.target.closest('[data-gf-payer]');
      if (payer) { encaisserReservation(Number(payer.getAttribute('data-gf-payer')), payer.getAttribute('data-gf-moyen'), e); gfApresEncaisser(); return; }
      var encaisser = e.target.closest('[data-gf-encaisser]');
      if (encaisser) { gfBulleEncaisser(encaisser, e); return; }
      var statut = e.target.closest('[data-gf-statut]');
      if (statut) { gfBulleStatut(wrap, statut, e); return; }
      var retarder = e.target.closest('[data-gf-retarder]');
      if (retarder) { gfBulleRetard(wrap, retarder, e); return; }
      var voir = e.target.closest('[data-gf-voir]');
      if (voir) { voirAuPlanning(Number(voir.closest('[data-gf-id]').getAttribute('data-gf-id')), voir.getAttribute('data-gf-voir'), e); return; }
      var absent = e.target.closest('[data-gf-absent]');
      if (absent) { basculerAbsence(Number(absent.getAttribute('data-gf-absent')), true, e); return; }
      var fiche = e.target.closest('[data-gf-fiche]');
      if (fiche) { openPos(Number(fiche.getAttribute('data-gf-fiche'))); return; }
      // (la case d heure reserve a son heure ; elle ouvrait la fiche du premier groupe)
      var reserver = e.target.closest('td[data-gf-reserver]');
      if (reserver) { reserverAuComptoir({ startTime: reserver.getAttribute('data-gf-reserver') }); return; }
      if (e.target.closest('td.gf-bloc')) return;
      if (e.target.closest('[data-gf-plis]')) { gfFinisOuverts = !gfFinisOuverts; renderGlobalPlanning(wrap); return; }
      if (e.target.closest('a, button, input')) return;
      var ligne = e.target.closest('[data-gf-id]');
      if (ligne && typeof openPos === 'function') openPos(Number(ligne.getAttribute('data-gf-id')));
    });
    wrap.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var heureAct = e.target.closest && e.target.closest('[data-gf-act]');
      if (heureAct && e.target === heureAct) { e.preventDefault(); gfToucherHeure(heureAct, true); return; }
      var ligne = e.target.closest && e.target.closest('[data-gf-id]');
      if (!ligne || e.target !== ligne) return;
      e.preventDefault();
      if (typeof openPos === 'function') openPos(Number(ligne.getAttribute('data-gf-id')));
    });
    // LE GLISSER DU PLANNING COMPLET (plus haut) : la souris par le pointeur, le doigt par l appui long.
    // (le toucher reste passif : un doigt qui defile n attend rien ; le mouvement, lui, doit pouvoir
    // retenir le defilement une fois la ligne levee)
    wrap.addEventListener('pointerdown', function (e) { gfSourisBas(wrap, e); });
    wrap.addEventListener('touchstart', function (e) { gfDoigtDebut(wrap, e); }, { passive: true });
    wrap.addEventListener('touchmove', function (e) { if (window.PinlaneTouchDrag) window.PinlaneTouchDrag.bouger(e); }, { passive: false });
    wrap.addEventListener('touchend', function (e) { if (window.PinlaneTouchDrag) window.PinlaneTouchDrag.finir(e); }, { passive: false });
    wrap.addEventListener('touchcancel', function (e) { if (window.PinlaneTouchDrag) window.PinlaneTouchDrag.interrompre(e); });
    wrap.addEventListener('contextmenu', function (e) { if (window.PinlaneTouchDrag) window.PinlaneTouchDrag.menu(e); });
    var attente = 0;
    var recalculer = function () {
      if (attente) return;
      attente = requestAnimationFrame(function () {
        attente = 0;
        if (!wrap.isConnected || !wrap._gfRacine) return;
        // (la feuille passe le palier de 1060 px : les cases d heure se reecrivent. Cachee, elle
        // mesure zero : elle ne reecrit rien, la barre est alors celle d un autre planning)
        var large = wrap._gfRacine.getBoundingClientRect().width;
        if (large > 0 && wrap._gfCourt != null && (large < 1060) !== wrap._gfCourt) { renderGlobalPlanning(wrap); return; }
        gfHauteur(wrap);
        wrap._gfRegle = null;
        if (wrap._gfSuit) gfAllerAMaintenant(wrap, false);
        gfSuivreMaintenant(wrap);
      });
    };
    window.addEventListener('resize', recalculer);
    if (typeof ResizeObserver === 'function') {
      var largeur = -1;
      new ResizeObserver(function (entrees) {
        var w = Math.round(entrees[0].contentRect.width);
        if (w === largeur) return;
        largeur = w;
        recalculer();
      }).observe(wrap);
    }
  }

  // LA LIGNE 2 DE LA BARRE : ses compteurs filtrent, son etat du centre mene a son geste,
  // les noms du prochain depart ouvrent leur fiche.
  (function () {
    var bande = document.getElementById('planningBande');
    var wrapDe = function () { return document.getElementById('globalPlanningGridWrap'); };
    if (bande) bande.addEventListener('click', function (e) {
      if (!e.target.closest) return;
      var filtre = e.target.closest('button[data-gf-filtre]');
      if (filtre) { gfFiltrer(wrapDe(), filtre.getAttribute('data-gf-filtre')); return; }
      var fiche = e.target.closest('[data-gf-fiche]');
      if (fiche) { openPos(Number(fiche.getAttribute('data-gf-fiche'))); return; }
      var etat = e.target.closest('[data-gf-etat]');
      if (etat) gfDepuisBandeau(wrapDe(), etat.getAttribute('data-gf-etat'));
    });
    // (la coupure se voit vite : un simple regard sur deux drapeaux, rien ne s ecrit
    // tant que le mot ne change pas)
    setInterval(gfMajDirect, 3000);
    // LA BASCULE AU CLAVIER : les fleches passent d un planning a l autre.
    var seg = document.querySelector('.pb-seg');
    if (seg) seg.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      var tous = Array.prototype.filter.call(seg.querySelectorAll('[data-pb-vue]'), function (b) { return !b.classList.contains('hidden'); });
      var i = tous.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      var cible = tous[(i + (e.key === 'ArrowRight' ? 1 : tous.length - 1)) % tous.length];
      window.pbChanger(cible.getAttribute('data-pb-vue'));
      cible.focus();
    });
    var efface = document.getElementById('gfEfface');
    if (efface) efface.addEventListener('click', gfViderRecherche);
    // LE BAS DE LA BARRE : la boite des plannings se regle dessus (au doigt et a l etroit,
    // la barre est plus haute). Ecrit seulement quand il change. Le planning bowling le
    // demande aussi avant de mesurer sa boite (renderPlanning) : son premier rendu tombe
    // avant la premiere mesure de l observateur.
    var barre = document.getElementById('planningBarre');
    if (barre) {
      var bas = -1;
      window.pbPoserBas = function () {
        var h = Math.round(barre.getBoundingClientRect().height);
        if (h === bas || !h) return;
        bas = h;
        document.documentElement.style.setProperty('--pb-bas', h + 'px');
      };
      if (typeof ResizeObserver === 'function') new ResizeObserver(function () { window.pbPoserBas(); }).observe(barre);
    }
    // LA CONSIGNE DU CHAMP SE LIT EN ENTIER : a l etroit, elle se raccourcit.
    var boite = document.getElementById('gfRecherche');
    var champ = document.getElementById('globalPlanningSearchInput');
    if (boite && champ && typeof ResizeObserver === 'function') {
      new ResizeObserver(function (entrees) {
        var mot = entrees[0].contentRect.width >= 272 ? 'Un client arrive ? Tapez son nom' : entrees[0].contentRect.width >= 150 ? 'Tapez son nom' : 'Nom';
        if (champ.placeholder !== mot) champ.placeholder = mot;
      }).observe(boite);
    }
  })();

  // TAPER UN NOM, DE N IMPORTE OU (2026-11-02) : le client dit son nom, on tape.
  // Une lettre tapee alors que rien n est en saisie part dans le champ (ce qui s y
  // trouvait est remplace) ; Entree pointe le seul groupe trouve ; Echap vide le champ.
  document.addEventListener('keydown', function (e) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    var champ = document.getElementById('globalPlanningSearchInput');
    if (!champ) return;
    if (e.target === champ && e.key === 'Enter' && !e.isComposing && champ.value.trim()) {
      e.preventDefault();
      gfPointerParEntree(champ);
      return;
    }
    if (e.key === 'Escape' && document.activeElement === champ && champ.value) {
      e.preventDefault();
      gfViderRecherche();
      return;
    }
    if (e.key.length !== 1 || e.key === ' ') return;
    if (!document.body.classList.contains('gf-large') || state.view !== 'staff') return;
    var actif = document.activeElement;
    if (actif && actif !== document.body) {
      if (actif.matches && actif.matches('input, textarea, select, [contenteditable="true"]')) return;
      if (!(actif.closest && actif.closest('.planning-box, #planningBarre'))) return;
    }
    if (document.querySelector('#quickBookOverlay:not(.hidden), #posOverlay:not(.hidden), .staff-confirm-overlay, .compte-pop, .staff-action-popover, #gfHeurePop')) return;
    champ.focus();
    champ.select();
  });

  window.renderGlobalPlanning = renderGlobalPlanning;
})();

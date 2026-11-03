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
//   Heure | Groupe | Formule | Pers. | Bowling | Duckpin | Laser | Fun Run |
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
    { cle: 'funrun', titre: 'Fun Run', activites: ['fun_run'], nature: 'agenda' },
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
  // Minigolf, Fun Run), jamais « Playground » ni « Fun Run by PIXEL ».
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
    if (!r.formuleId && r.type !== 'formule') return null;
    var f = r.formuleId && typeof resolveDisplayFormule === 'function' ? resolveDisplayFormule(r.formuleId) : null;
    var nom = String((f && f.name) || r.label || 'Formule').trim();
    var numero = /^formule\s*(\d+)$/i.exec(nom);
    if (nom === nom.toUpperCase()) nom = nom.toLowerCase().replace(/(^|[\s/])(\p{L})/gu, function (x, a, b) { return a + b.toUpperCase(); });
    return { court: numero ? 'F' + numero[1] : nom, long: nom, adaptee: /\(adapt[ée]e\)/i.test(String(r.label || '')) };
  }
  // « 8 crédits d'arcade (8€) par enfant » : 8 par enfant.
  function gpCredits(label, enfants) {
    var m = /(\d+)\s*cr[ée]dits?/i.exec(String(label || ''));
    var n = m ? Number(m[1]) : 0;
    var parEnfant = /par\s+enfant/i.test(String(label || ''));
    return { n: n, parEnfant: parEnfant, total: parEnfant ? n * Math.max(1, Number(enfants) || 1) : n };
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
      var fois = /^(.*\S)\s*×\s*(\d+)$/.exec(brut);
      var nom = fois ? fois[1] : brut;
      var heure = /^\d{1,2}:\d{2}/.test(String(e.heure || e.time || e.startTime || '')) ? String(e.heure || e.time || e.startTime).slice(0, 5) : '';
      var cle = nom + '|' + heure;
      var l = compte.get(cle) || { nom: nom, heure: heure, n: 0 };
      l.n += fois ? Number(fois[2]) : 1;
      compte.set(cle, l);
    });
    return Array.from(compte.values()).map(function (l) { return (l.n > 1 ? l.n + ' × ' : '') + l.nom + (l.heure ? ' à ' + l.heure : ''); });
  }

  // LES ACTIVITES SANS HEURE D UN GROUPE, a leur heure probable, par la regle
  // du moteur (celle qui donne la fin de visite affichee partout,
  // getVisiteLibreApres) : leurs minutes remplissent d abord les trous entre
  // les blocs a heure du groupe, le reste se joue apres son plan. Ce qui se
  // sert (boissons, credits) ne prend pas de temps.
  function gpLibres(g) {
    var r = g.r;
    var items = r.program && Array.isArray(r.program.items) ? r.program.items : [];
    var lignes = [];
    items.forEach(function (it) {
      if (!it || it.planned !== false || it.waitOffer) return;
      lignes.push({ id: it.activityId, nom: nomActivite(it), minutes: gpMinutes(it.activityId, it), journee: ligneALaJournee(it), unites: Math.max(0, Math.trunc(Number(it.units) || 0)), enfants: Number(it.participants) || 0 });
    });
    // Une formule suivie : ses activites sans heure que le programme ne porte pas.
    if (typeof reservationHasFormulaActivities === 'function' && reservationHasFormulaActivities(r)) {
      getFormulaActivityProgressSummary(r).items.forEach(function (it) {
        if (it.startTime || it.activityId === 'bowling' || it.activityId === 'laser_game' || it.activityId === 'party_table') return;
        if (lignes.some(function (l) { return l.id === it.activityId; })) return;
        lignes.push({ id: it.activityId, nom: it.label || gpNomActivite(it.activityId), minutes: gpMinutes(it.activityId, null), journee: false, unites: 0, enfants: 0 });
      });
    }
    var servis = lignes.filter(function (l) { return GP_SANS_DUREE[l.id]; });
    lignes = lignes.filter(function (l) { return !GP_SANS_DUREE[l.id]; });
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
    return { places: places, servis: servis };
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
      etat.laser = { t: p.t, places: places, texte: gpHeure(p.t) + (places > 0 ? ', ' + places + (places > 1 ? ' places' : ' place') : ', complet'), plein: places <= 0, bulle: 'Prochain départ laser à ' + gpHeure(p.t) + ' : ' + (places > 0 ? places + ' armes libres sur ' + laser.capacite : 'complet') };
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
    var tout = todaysReservations();
    var auj = todayStr();
    var nuit = gpNuit(jour, auj);
    var moments = nuit ? gpMomentsNuit(tout, 24 + currentTimeDecimal()) : getStaffReservationMoments(tout);
    if (typeof releaseDeadNoteFilter === 'function') releaseDeadNoteFilter();
    var filtre = state.staffStatusFilter || 'all';
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
      return { r: r, id: String(r.id), etat: parti ? 'done' : mo.etat || 'upcoming', etatListe: mo.etat || 'upcoming', retard: Boolean(mo.late), teinte: gpTeinte(r), span: span, heure: gpHeureReservee(r, span), prog: getGroupeProgramme(r), cases: new Map(), infos: [], credits: [], table: null, boissons: null };
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
      getBowlingWindowsFromReservation(r).forEach(function (w) {
        poser('bowling', { start: w.start, end: w.end, pistes: (w.lanes || []).filter(Number.isFinite), joueurs: Number(w.players) || Number(r.pax) || 0 });
      });
      // Les vagues d une meme partie entrent ensemble : une seule heure.
      var parties = new Map();
      getLaserWindowsFromReservation(r).forEach(function (w) {
        var k = Math.round(w.start * 60);
        var j = Math.max(1, Number(w.joueursReels != null ? w.joueursReels : w.players) || Number(r.pax) || 1);
        var deja = parties.get(k);
        if (deja) { deja.joueurs += j; deja.end = Math.max(deja.end, w.end); return; }
        var e = { start: w.start, end: w.end, joueurs: j };
        parties.set(k, e);
        poser('laser_game', e);
      });
      Array.from(parties.values()).sort(function (a, b) { return a.start - b.start; }).forEach(function (e, n, toutes) { e.partie = n + 1; e.parties = toutes.length; });
      g.prog.filter(function (e) { return e.aPlacer; }).forEach(function () { poser('laser_game', { aPlacer: true }); });
      // Les activites a heure d une formule (hors bowling, laser, table). Ses
      // credits d arcade restent un compteur, meme quand la formule leur donne
      // une heure.
      getStaffFormulaTimedItems(r).forEach(function (it) {
        if (it.activityId === 'bowling' || it.activityId === 'laser_game') return;
        if (it.activityId === 'party_table') { g.table = g.table || it; return; }
        if (GP_SERVI[it.activityId]) { var servi = gpServi(it.label || gpNomActivite(it.activityId)); g.boissons = g.boissons || { nom: servi, start: it.start }; g.infos.push(servi); return; }
        if (it.activityId === 'arcade_credit') { var crf = gpCredits(it.label || gpNomActivite(it.activityId), r.pax); g.credits.push(crf); poser('arcade_credit', { credit: true, nom: it.label, credits: crf }); return; }
        poser(it.activityId, { start: it.start, end: Math.max(it.end, it.start + 0.25) });
      });
      var libres = gpLibres(g);
      libres.places.forEach(function (p) {
        poser(p.l.id, { start: p.start, end: p.end, libre: true, journee: Boolean(p.journee), unites: p.l.unites, nom: p.l.nom, enfants: p.l.enfants });
      });
      libres.servis.forEach(function (l) {
        if (l.id === 'arcade_credit') { var cr = gpCredits(l.nom, l.enfants || r.pax); g.credits.push(cr); poser('arcade_credit', { credit: true, nom: l.nom, credits: cr }); }
        else g.infos.push(gpServi(l.nom));
      });
      g.extras = gpExtras(r);
      g.formule = gpFormule(r);
      g.rubriques = gfRubriques(g);
      // Une activite cochee « faite » (le suivi des formules) le dit dans sa case.
      g.prog.filter(function (e) { return e.fait; }).forEach(function (e) {
        if (GP_SANS_COLONNE[e.activityId]) return;
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
    // (inconnues : dans l ordre de leur premiere seance, a egalite par titre)
    inconnues.sort(function (a, b) {
      var premiere = function (c) { return Math.min.apply(null, [99].concat(groupes.map(function (g) { return ((g.cases.get(c.cle) || [])[0] || {}).start; }).filter(function (x) { return x != null; }))); };
      return premiere(a) - premiere(b) || String(a.titre).localeCompare(String(b.titre), 'fr');
    });
    var utilisees = colonnes.filter(function (c) { return c.groupes > 0; }).concat(inconnues);
    var laser = typeof lpModele === 'function' ? lpModele() : null;
    return {
      jour: jour, aujourdHui: aujourdHui, passe: jour < auj && !nuit, maintenant: maintenant, groupes: groupes, colonnes: utilisees,
      visibles: filtrees ? new Set(filtrees.map(function (r) { return String(r.id); })) : null,
      fenetre: typeof getPlanningWindow === 'function' ? getPlanningWindow(jour) : { open: 10, close: 22, closed: false },
      etat: jour === auj ? gpEtatCentre(groupes, laser, maintenant) : null,
      charge: gpCharge(laser),
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
    if (e.aPlacer) return 'aplacer';
    if (m.passe || g.parti || g.etat === 'closing' || e.fait) return 'fini';
    if (e.credit) return 'avenir';
    var debut = e.journee ? g.span.start : e.start;
    var fin = e.journee ? g.span.end : e.end;
    if (m.maintenant == null || debut == null) return 'avenir';
    if (fin <= m.maintenant + 1e-6) return 'fini';
    var present = gfPresent(g);
    if (debut <= m.maintenant + 1e-6) {
      if (!present) return g.retard ? 'retard' : 'avenir';
      return e.libre && !e.journee ? 'avenir' : 'encours';
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
  // « +40 min », puis « +2h10 » : le retard tient sous l heure.
  function gfRetardCourt(n) { return n < 60 ? '+' + n + ' min' : '+' + Math.floor(n / 60) + 'h' + String(n % 60).padStart(2, '0'); }

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
  var GF_FAIT = '<svg class="gf-x__ok" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  var GF_PLIS_MIN = 3;
  var gfFinisOuverts = false;


  // UNE ACTIVITE DANS SA CASE : son heure d abord (la croix du papier), puis
  // ce qu il faut pour la servir. Bowling : les pistes, et la duree si elle
  // n est pas d une heure (« XX (1h30) » sur le papier). Laser : une heure par
  // partie. Plaine : les enfants. Billard et duckpin : les tables ou pistes
  // quand il y en a plusieurs. Arcades d une formule : les credits.
  // (une coche dit « fait » : l heure passee d un groupe jamais pointe reste
  // grise, sans coche, il n est peut-etre pas venu)
  function gfActivite(g, e, col, m) {
    var r = g.r;
    var etat = gfEtat(g, e, m);
    var t = '', d = '', d2 = '', bulle = '', panne = false;
    if (e.aPlacer) {
      t = 'à placer';
      bulle = 'Laser : une partie encore sans heure, à placer au planning laser';
    } else if (e.credit) {
      var cr = e.credits || { n: 0, total: 0, parEnfant: false };
      t = (cr.parEnfant ? cr.n : cr.total) + ' crédits';
      if (cr.parEnfant) d = 'par enfant';
      bulle = 'Arcades : ' + (cr.parEnfant ? cr.n + ' crédits par enfant, ' + cr.total + ' en tout' : cr.total + ' crédits');
    } else {
      var debut = e.journee ? g.span.start : e.start;
      var fin = e.journee ? g.span.end : e.end;
      var minutes = Math.round((fin - debut) * 60);
      // (la plaine qui commence a l heure de la ligne ne la redit pas : la
      // case dit les enfants)
      var desLeDebut = col.nature === 'plaine' && (e.journee || Math.abs(debut - g.heure) <= 0.25 + 1e-6);
      t = desLeDebut ? '' : (e.libre ? 'vers ' : '') + gpHeure(debut);
      if (col.nature === 'bowling') {
        var n = e.pistes ? e.pistes.length : 0;
        d = n ? gfPistesEnMots(e.pistes) : 'pistes ?';
        if (minutes !== 60) d2 = gfDuree(minutes);
        // UNE PISTE FERMEE SE VOIT SUR LA LIGNE DU GROUPE (2026-11-02) : fermee au planning
        // bowling, le tableau ne changeait pas, et le groupe arrivait sur une piste en
        // panne. Un toucher mene a son bloc, pour le deplacer.
        var fermees = (e.pistes || []).filter(function (p) { return state.laneStatuses && state.laneStatuses[p] === 'maintenance'; });
        if (fermees.length && etat !== 'fini') { d = gfPistesEnMots(fermees) + (fermees.length > 1 ? ' fermées' : ' fermée'); d2 = ''; panne = true; }
        bulle = 'Bowling de ' + gpHeure(debut) + ' à ' + gpHeure(fin) + ' · ' + (n ? (n > 1 ? 'pistes ' : 'piste ') + gpPistes(e.pistes) : 'pistes à attribuer') + ' · ' + (Number(e.joueurs) || Number(r.pax) || 0) + ' joueurs';
      } else if (col.nature === 'laser') {
        var armes = Number(e.joueurs) || 0;
        if (armes && armes !== Number(r.pax)) d = armes + ' armes';
        bulle = 'Laser à ' + gpHeure(debut) + (e.parties > 1 ? ' · partie ' + e.partie + ' sur ' + e.parties : '') + ' · ' + (armes || Number(r.pax) || 0) + ' armes';
      } else if (col.nature === 'plaine') {
        var enfants = Number(e.enfants) || Number(r.pax) || 0;
        if (desLeDebut) t = enfants + ' enf.'; else d = enfants + ' enf.';
        bulle = 'Plaine ' + (e.journee ? 'dès ' + gpHeure(debut) + ', toute la visite' : 'de ' + gpHeure(debut) + ' à ' + gpHeure(fin)) + ' · ' + enfants + (enfants > 1 ? ' enfants' : ' enfant');
      } else {
        var mots = GF_UNITES[e.activityId];
        if (e.unites > 1) d = mots ? gfPluriel(e.unites, mots) : '×' + e.unites;
        bulle = gpTitreActivite(e.activityId) + (e.libre ? ' vers ' + gpHeure(debut) + ', sans heure fixe' : ' à ' + gpHeure(debut)) + (minutes > 0 ? ' · ' + gfDuree(minutes) : '') + (d ? ' · ' + d : '');
      }
    }
    var classes = 'gf-x is-' + etat + (e.libre && !e.journee ? ' is-libre' : '') + (e.credit ? ' is-credit' : '') + (gfBientot(g, e, etat, m) ? ' is-bientot' : '') + (panne ? ' is-panne' : '');
    return '<span class="' + classes + '" title="' + gpEsc(bulle + ' · ' + GF_ETATS[etat]) + '"' + (panne ? ' data-gf-voir="bowling"' : '') + '>' + (etat === 'fini' && gfPresent(g) ? GF_FAIT : '') + gpEsc(t) + (d ? '<span class="gf-x__d">' + gfNumerosEntiers(d) + '</span>' : '') + (d2 ? '<span class="gf-x__d">' + gpEsc(d2) + '</span>' : '') + '</span>';
  }
  function gfCase(g, col, m) {
    var liste = g.cases.get(col.cle) || [];
    if (!liste.length) return '<td class="gf-a is-vide"></td>';
    // (deux parties de laser partagent la case, trois aussi)
    return '<td class="gf-a' + (liste.length > 1 ? ' is-plusieurs' : '') + (liste.length > 2 ? ' is-trois' : '') + '" data-gf-titre="' + gpEsc(col.titre) + '">' + liste.map(function (e) { return gfActivite(g, e, col, m); }).join('') + '</td>';
  }

  // LE GROUPE : LA LIGNE QUI MONTRE TOUT (2026-11-03). Le nom et ce qui se fait sur lui
  // (le retard qui se touche, le telephone, « À valider », « À clôturer »), puis des
  // rubriques ecrites en toutes lettres. Une rubrique vide ne prend aucune place ; deux
  // lignes au plus par rubrique, le texte entier dans la bulle et la fiche.
  // Trois sources de note, trois rubriques : le mot du client (Client), les notes de
  // l equipe avec leur auteur (Équipe), la note permanente du client (Fiche).
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
  function gfUneLigne(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
  function gfRubrique(cle, mot, html, texte, allergie) {
    return { cle: cle, mot: mot, texte: texte, allergie: Boolean(allergie), html: '<div class="gf-i gf-i--' + cle + '"><span>' + gpEsc(mot) + '</span><p title="' + gpEsc(texte) + '">' + (allergie ? '<b class="gf-i__a">Allergie</b> ' : '') + html + '</p></div>' };
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
    var raison = (notePrix && notePrix.raison) || r.discountReason || '';
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
    return g.boissons ? texte + ', ' + g.boissons.nom + ' à ' + gpHeure(g.boissons.start) : texte;
  }
  // LES NOTES DE L EQUIPE D UN DOSSIER, dans l ordre ou elles ont ete ecrites : la derniere
  // est la plus recente. La ligne du Complet les lit toutes, le Terrain la derniere.
  function gfNotesEquipe(r) {
    var notePrix = null;
    var equipe = [];
    (typeof getReservationNotesEquipe === 'function' ? getReservationNotesEquipe(r) : []).forEach(function (n) {
      if (!n || !n.t || n.compte) return;
      // Toute note de prix quitte la rubrique Équipe ; la derniere du serveur decrit le
      // prix du moment, l historique du dossier garde les autres.
      var p = gfPrixDeNote(n);
      if (p) { if (!notePrix || p.a != null) notePrix = p; return; }
      equipe.push({ t: gfUneLigne(n.t), par: gfUneLigne(n.par) });
    });
    return { notePrix: notePrix, equipe: equipe };
  }
  function gfRubriques(g) {
    var r = g.r;
    var liste = [];
    var parts = typeof getReservationNoteParts === 'function' ? getReservationNoteParts(r) : { mot: typeof getReservationNoteText === 'function' ? getReservationNoteText(r) : '', suivi: [] };
    var mot = gfUneLigne(parts.mot);
    if (mot) liste.push(gfRubrique('client', 'Client', gpEsc(mot), mot, gfAllergie(mot)));
    // (le compte a l arrivee se lit dans la colonne Joueurs, sa note dans la fiche ;
    // une note de prix va a la rubrique Prix)
    var lues = g.lues || gfNotesEquipe(r);
    var notePrix = lues.notePrix;
    var equipe = lues.equipe.slice();
    (parts.suivi || []).forEach(function (s) { equipe.push({ t: gfUneLigne(s), par: '' }); });
    if (equipe.length) {
      var texteEquipe = equipe.map(function (n) { return n.t + (n.par ? ' ' + n.par : ''); }).join(' · ');
      liste.push(gfRubrique('equipe', 'Équipe', equipe.map(function (n) { return gpEsc(n.t) + (n.par ? ' <span class="gf-i__par">' + gpEsc(n.par) + '</span>' : ''); }).join(' · '), texteEquipe, gfAllergie(texteEquipe)));
    }
    var fiche = gfUneLigne(window.PinlaneStaffNotes && typeof window.PinlaneStaffNotes.text === 'function' ? window.PinlaneStaffNotes.text(r) : '');
    if (fiche) liste.push(gfRubrique('fiche', 'Fiche', gpEsc(fiche), fiche, gfAllergie(fiche)));
    var table = gfTableTexte(g);
    if (table) liste.push(gfRubrique('table', 'Table', gpEsc(table), table));
    if (g.extras.length) { var mesure = g.extras.join(', '); liste.push(gfRubrique('mesure', 'Sur mesure', gpEsc(mesure), mesure)); }
    var prix = gfPrixTexte(r, notePrix, g.sortie);
    if (prix) liste.push(gfRubrique('prix', 'Prix', gpEsc(prix), prix));
    // La derniere modification (texteDerniereModif, le texte de la fiche) : quand, qui, quoi.
    var modif = typeof texteDerniereModif === 'function' ? texteDerniereModif(r, { max: 4 }) : '';
    if (modif) liste.push(gfRubrique('modif', 'Modifié', gpEsc(modif.replace(/^Modifié\s*/, '')), modif));
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
    e.notes = lues.equipe.map(function (n) { return n.t + (n.par ? ' (' + n.par + ')' : ''); }).join(' · ');
    if (e.notes && gfAllergie(e.notes)) e.allergies.notes = true;
    e.raison = e.prix ? sortie.raison || '' : '';
    var d = lues.equipe[lues.equipe.length - 1];
    if (d) e.derniere = { t: d.t, par: d.par, allergie: gfAllergie(d.t) };
    var f = gpFormule(r);
    e.adaptee = Boolean(f && f.adaptee);
    return e;
  };
  // Sa ligne : le nom d abord, a la meme place sur chaque ligne ; a sa suite le retard,
  // qui se touche (« Ils arrivent dans »), le telephone, toujours, et l etiquette. Une
  // heure pas pile sur la demi-heure s ecrit devant le nom.
  function gfPile(g) { return Math.abs(g.heure * 2 - Math.round(g.heure * 2)) * 30 < 0.5; }
  function gfGroupe(g, m) {
    var r = g.r;
    var tete = gfPile(g) ? '' : '<b class="gf-nom__h">' + gpEsc(gpHeure(g.heure)) + '</b>';
    tete += '<span class="gf-nom__t">' + gpEsc(r.name || 'Client') + '</span>';
    if (g.retard && m.maintenant != null) tete += '<button type="button" class="gf-h__retard" data-gf-retarder="' + gpEsc(g.id) + '"><span data-gf-retard="' + gpEsc(g.id) + '"></span></button>';
    var tel = String(r.phone || '').trim();
    if (tel) tete += '<a class="gf-nom__tel" href="tel:' + gpEsc(tel.replace(/[^0-9+]/g, '')) + '">' + gpEsc(tel) + '</a>';
    if (typeof isReservationAwaitingReview === 'function' && isReservationAwaitingReview(r)) tete += '<span class="gf-nom__valide">À valider</span>';
    if (g.etat === 'closing') tete += gfPresent(g) ? '<span class="gf-nom__caisse">À encaisser</span>' : '<span class="gf-nom__caisse">À clôturer<span class="gf-nom__suite"> · jamais pointé</span></span>';
    return '<td class="gf-nom"><div class="gf-nom__l">' + tete + '</div>' + g.rubriques.map(function (x) { return x.html; }).join('') + '</td>';
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
    return '<td class="gf-n" title="' + gpEsc(bulle) + '"><b>' + pax + '</b>' + (avec ? '<span class="gf-n__plus">' + gpEsc('et ' + avec + ' accomp.') + '</span>' : '')
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
    if (g.formule) f = '<span class="gf-formule' + (g.formule.court.length > 4 ? ' is-long' : '') + '" title="' + gpEsc(g.formule.long) + '">' + gpEsc(g.formule.court).replace(/\//g, '/<wbr>') + '</span>';
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
  function gfPeutEncaisser() {
    if (typeof encaisserReservation !== 'function' || typeof GROUPE_MOYENS === 'undefined') return false;
    return typeof canUseStaffPermission !== 'function' || canUseStaffPermission('payments.markPaid');
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
    return typeof canUseStaffPermission !== 'function' || canUseStaffPermission('reservations.status');
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
    return '<td class="gf-etat"><span class="gf-g">' + h + '</span></td>';
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
        if (e.aPlacer) return 'à placer';
        if (e.credit) return (e.credits ? e.credits.total : 0) + ' crédits';
        return (e.libre && !e.journee ? 'vers ' : '') + gpHeure(e.journee ? g.span.start : e.start) + ' ' + GF_ETATS[gfEtat(g, e, m)];
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
  function gfMaintenant(nbCol) {
    return '<tr class="gf-now" aria-hidden="true"><td colspan="' + nbCol + '"><span class="gf-now__h" data-gf-maintenant></span></td></tr>';
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
    var attr = ' rowspan="' + part.lignes.length + '"';
    // (la barre de l heure tombe dans la demi-heure : ce qui suit reste dans son bloc)
    if (part.suite) return '<td class="' + classes + ' is-suite"' + attr + '></td>';
    var heure = gpHeure(part.b);
    // (ce qui est passe n a plus rien a offrir, un jour ferme non plus)
    var ouvert = part.quand !== 'passe' && !(m.fenetre && m.fenetre.closed) && !(m.maintenant == null && state.currentDate < todayStr());
    var place = ouvert ? m.charge.place(part.b) : null;
    var seule = part.lignes.length < 2;
    var lignes = [];
    m.colonnes.forEach(function (col) {
      var plein = m.charge(part.b, col);
      if (plein) lignes.push({ html: '<span class="gf-bloc__plein" title="' + gpEsc(plein.bulle) + '">' + gpEsc(seule ? plein.texte : col.titre + ' ' + plein.texte) + '</span>', hauteur: seule ? 1 : 2 });
    });
    if (place && place.pistes) lignes.push({ html: '<span>Pistes ' + place.pistes + '</span>', hauteur: 1 });
    if (place && place.laser) lignes.push({ html: '<span>Laser ' + place.laser + '</span>', hauteur: 1 });
    lignes.push({ html: '<span>' + gpEsc(gfPluriel(compte.pers, ['joueur', 'joueurs'])) + '</span>', hauteur: 1 });
    // (la case n a que la hauteur de ses lignes : une ligne, un mot sous l heure)
    var reste = seule ? 1 : part.lignes.length === 2 ? 3 : part.lignes.length * 2;
    var dessous = '';
    lignes.forEach(function (l) {
      if (l.hauteur > reste) return;
      reste -= l.hauteur;
      dessous += l.html;
    });
    var corps = '<b>' + gpEsc(heure) + '</b>' + dessous;
    if (!ouvert) return '<td class="' + classes + '"' + attr + ' data-gf-bloc="' + gpEsc(heure) + '"><span class="gf-bloc__in">' + corps + '</span></td>';
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
    var peut = typeof canUseStaffPermission !== 'function' || canUseStaffPermission('reservations.quick');
    var reserver = peut && gfNomTape(terme, q)
      ? '<button type="button" class="gf-rien__reserver" data-nom="' + gpEsc(terme) + '" onclick="reserverAuComptoir({ name: this.dataset.nom })">Réserver pour ' + gpEsc(terme) + '</button>'
      : '';
    return '<div class="gf-rien__tete"><b>Aucun groupe ne correspond à « ' + gpEsc(terme) + ' »' + (m.aujourdHui ? ' aujourd’hui' : '') + '</b>' + reserver + '</div>'
      + (reserver || !peut ? '' : '<span>Pour un client sans réservation, touchez « + Réservation » en haut à droite.</span>')
      + gfAutresDatesHtml(m, terme);
  }
  function gfParties(m, q, cartes) {
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
    var morceaux = [];
    var nowPose = m.maintenant == null || Boolean(q);
    var courant = null, dernier = null;
    lignes.forEach(function (g) {
      var b = gfBloc(g.heure);
      if (!nowPose && g.heure > m.maintenant + 1e-6) { morceaux.push(null); nowPose = true; courant = null; }
      if (!courant || courant.b !== b) {
        var quand = m.maintenant == null ? '' : b + 0.5 <= m.maintenant + 1e-6 ? 'passe' : b - m.maintenant <= GF_BIENTOT + 1e-6 ? 'proche' : '';
        courant = { b: b, lignes: [], suite: dernier === b, quand: quand };
        morceaux.push(courant);
        dernier = b;
      }
      courant.lignes.push(g);
    });
    var rangees = [];
    // (la premiere rangee et celle qui suit la barre de l heure n ont pas de filet)
    var poser = function (cle, html) {
      var nu = !rangees.length || rangees[rangees.length - 1].cle === 'maintenant';
      rangees.push({ cle: cle, html: nu ? html.replace('<tr class="', '<tr class="gf-sans-filet ') : html });
    };
    if (plis) {
      var mot = gfPluriel(finis.length, ['groupe fini', 'groupes finis']);
      poser('plis', '<tr class="gf-plis"><td colspan="' + nbCol + '"><button type="button" class="gf-plis__b" data-gf-plis aria-expanded="' + gfFinisOuverts + '">' + gpEsc(gfFinisOuverts ? 'Replier les ' + mot : mot + ' · Voir') + '</button></td></tr>');
    }
    if (q) {
      var terme = String(state.searchTerm || '').trim();
      var seul = lignes.length === 1 && gfPeutArriver(lignes[0], m) && gfTrouveParNom(lignes[0], q);
      if (lignes.length) poser('resultats', '<tr class="gf-resultats"><td colspan="' + nbCol + '"><b>' + gpEsc(gfPluriel(lignes.length, ['groupe', 'groupes'])) + '</b> pour « ' + gpEsc(terme) + ' »' + (seul ? ' · Entrée pour pointer Arrivé' : '') + '</td></tr>');
    }
    var bande = false, avantB = null;
    morceaux.forEach(function (part) {
      if (!part) { poser('maintenant', gfMaintenant(nbCol)); return; }
      if (avantB !== null && part.b !== avantB) bande = !bande;
      avantB = part.b;
      part.lignes.forEach(function (g, i) {
        var nouveau = i === 0;
        var proche = g.retard || (m.maintenant != null && g.etat === 'upcoming' && g.heure - m.maintenant <= GF_BIENTOT + 1e-6);
        var classes = 'gf-r t-' + g.teinte + (g.parti ? ' is-parti' : '') + (g.etat === 'absent' ? ' is-absent' : '') + (g.retard ? ' is-retard' : '') + (proche ? ' is-proche' : '') + (g.etat === 'upcoming' && !proche ? ' is-loin' : '') + (g.etat === 'closing' ? ' is-caisse' : '') + (bande ? ' is-bande' : '') + (nouveau && !part.suite ? ' is-bloc' : '');
        poser('groupe:' + g.id, '<tr class="' + classes + '" tabindex="0" data-gf-id="' + gpEsc(g.id) + '" aria-label="' + gpEsc(gfAria(g, m)) + '">'
          + (nouveau ? gfBlocCase(m, part, parBloc.get(part.b), bande) : '')
          + gfHeureCase(g) + gfGroupe(g, m) + gfPersonnes(g) + gfFormuleCase(g)
          + m.colonnes.map(function (c) { return gfCase(g, c, m); }).join('')
          + gfResteCase(g, m, q) + gfEtatCase(g, m, q) + '</tr>');
      });
    });
    if (!nowPose && lignes.length) poser('maintenant', gfMaintenant(nbCol));
    if (!lignes.length && (m.groupes.length || q)) {
      poser('rien', '<tr class="gf-rien"><td colspan="' + nbCol + '">' + (q ? gfRienHtml(m, q) : '<b>Aucun groupe dans ce filtre</b>') + '</td></tr>');
    }
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
  function gfEcrire(wrap, defile, p) {
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
  var GF_FILTRES = ['late', 'upcoming', 'onsite', 'closing'];
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
  function gfEtatBandeau(cle, libelle, et, dessous) {
    return '<div class="gf-e' + (et.plein ? ' is-plein' : '') + '" data-gf-etat="' + cle + '"><button type="button" class="gf-e__h" title="' + gpEsc(et.bulle) + '"><span class="gf-e__l">' + gpEsc(libelle) + '</span><b class="gf-e__v">' + gpEsc(et.texte) + '</b></button><span class="gf-e__s">' + dessous + '</span></div>';
  }
  function gfDepuisBandeau(wrap, cle) {
    var et = wrap._gfModele && wrap._gfModele.etat && wrap._gfModele.etat[cle];
    if (!et) return;
    if (et.plein) window.pbChanger(cle);
    else if (cle === 'laser') openQuickBookForLaserSession(et.t, et.places);
    else reserverAuComptoir({ type: 'bowling' });
  }
  // LES BULLES DU TABLEAU : la bulle des menus de la console, ancree sur ce qu on touche.
  function gfBulle(bouton, e, html, surChoix) {
    showStaffFloatingMenu({ currentTarget: bouton, stopPropagation: function () { e.stopPropagation(); } }, html);
    var bulle = document.querySelector('.staff-action-popover');
    if (!bulle) return;
    bulle.addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-gf-choix]');
      if (!b) return;
      closeStaffFloatingMenus();
      surChoix(b.getAttribute('data-gf-choix'), ev);
    });
    var premier = bulle.querySelector('button');
    if (premier) premier.focus({ preventScroll: true });
  }
  // « On arrive dans 20 minutes » : le retard annonce compte depuis l heure de la ligne,
  // le plan de retard de la console (openDelayImpact) dit ce que ca bouscule.
  function gfBulleRetard(wrap, bouton, e) {
    var m = wrap._gfModele;
    var id = bouton.getAttribute('data-gf-retarder');
    var g = m && m.groupes.find(function (x) { return String(x.id) === id; });
    if (!g || m.maintenant == null) return;
    var deja = gfMinutesDeRetard(g, m);
    var choix = [10, 20, 30].map(function (n) { return '<button type="button" data-gf-choix="' + n + '">' + n + ' min</button>'; }).join('');
    gfBulle(bouton, e, '<div class="staff-action-popover-title">Ils arrivent dans</div>' + choix, function (n, ev) { openDelayImpact(Number(id), Math.min(240, deja + Number(n)), ev); });
  }
  function gfApresEncaisser() {
    if (String(state.searchTerm || '').trim()) gfViderRecherche();
  }
  function gfBulleEncaisser(bouton, e) {
    var id = Number(bouton.getAttribute('data-gf-encaisser'));
    var choix = GROUPE_MOYENS.map(function (moyen) { return '<button type="button" data-gf-choix="' + gpEsc(moyen.valeur) + '">' + gpEsc(moyen.mot) + '</button>'; }).join('');
    gfBulle(bouton, e, '<div class="staff-action-popover-title">' + gpEsc(bouton.textContent) + ' à encaisser</div>' + choix, function (valeur, ev) { encaisserReservation(id, valeur, ev); gfApresEncaisser(); });
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
  function gfBandeauHtml(m) {
    var h = pbDirectHtml(m);
    var comptes = gfComptes(m);
    var actif = typeof normaliserFiltreListe === 'function' ? normaliserFiltreListe(state.staffStatusFilter) : 'all';
    GF_FILTRES.forEach(function (f) {
      var n = comptes[f] || 0;
      var on = actif === f;
      var cls = 'gf-c' + (f === 'late' && n ? ' is-alerte' : '') + (n ? '' : ' is-zero') + (on ? ' is-on' : '');
      var corps = '<span class="gf-c__l">' + gpEsc(STAFF_LISTE_MOTS[f]) + '</span><b class="gf-c__v">' + n + '</b>';
      // (a zero, rien a toucher)
      h += n || on ? '<button type="button" class="' + cls + '" data-gf-filtre="' + f + '" aria-pressed="' + on + '">' + corps + '</button>' : '<div class="' + cls + '" data-gf-filtre="' + f + '">' + corps + '</div>';
    });
    // (un jour de fermeture, ni piste libre ni prochain depart ne veulent rien dire)
    var e = (m.fenetre && m.fenetre.closed ? null : m.etat) || {};
    if (e.bowling || e.laser) h += '<span class="pb-sep" aria-hidden="true"></span>';
    if (e.bowling) h += gfEtatBandeau('bowling', 'Pistes', e.bowling, gpEsc(String(e.bowling.bulle || '').replace(/^(Libres maintenant : |Aucune piste libre, )/, '').split(' · ')[0]));
    if (e.laser) h += gfEtatBandeau('laser', 'Laser', e.laser, gfGroupesDuDepart(m));
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
    pbPoser(h + '<span class="pb-sep" aria-hidden="true"></span>' + pbFiltreHtml([]) + pbLegende(getStaffResourceView()), m);
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
    avecListeDifferable(function () { setStaffStatusFilter(actuel === f ? 'all' : f); });
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
    // (sur Bowling et Laser, Entree cherche : ce tableau-ci n est pas a l ecran)
    if (!boite || boite.classList.contains('hidden')) return;
    var m = wrap && wrap._gfModele;
    var q = gfCle(champ.value);
    var trouves = m && q ? m.groupes.filter(function (g) { return gfTrouveParNom(g, q); }) : [];
    if (trouves.length !== 1 || !gfPeutArriver(trouves[0], m)) return;
    setReservationStatusDirect(trouves[0].id, 'arrived');
    gfViderRecherche();
  }

  // ---- LE RENDU --------------------------------------------------------------
  var gfStats = window.__gfStats = { rendus: 0, ecritures: 0 };
  function renderGlobalPlanning(wrap) {
    if (!wrap) return;
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
    var cartes = racine.getBoundingClientRect().width < 640;
    pbPoser(gfBandeauHtml(m), m);
    var bandeau = racine.querySelector('.gf-bandeau');
    var ferme = Boolean(m.fenetre && m.fenetre.closed);
    var texte = ferme ? 'Centre fermé ce jour-là' + (m.groupes.length ? ' · réservations existantes à contrôler' : '') : !m.groupes.length ? 'Aucune réservation ce jour-là' : '';
    bandeau.hidden = !texte;
    bandeau.className = 'gf-bandeau' + (ferme ? ' is-ferme' : '');
    if (bandeau.textContent !== texte) bandeau.textContent = texte;
    var defile = racine.querySelector('.gf-defile');
    wrap._gfModele = m;
    // (un jour vide cherche aussi : le client est peut-etre sur une autre date)
    var aEcrire = Boolean(m.groupes.length || q);
    if (aEcrire) {
      var actif = document.activeElement;
      var focus = actif && defile.contains(actif) ? gfCleFocus(actif) : null;
      gfEcrire(wrap, defile, gfParties(m, q, cartes));
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
    var pastille = defile.querySelector('[data-gf-maintenant]');
    if (pastille) poser(pastille, gpHeure(m.maintenant));
    var enRetard = q ? [] : defile.querySelectorAll('.gf-r.is-retard [data-gf-arrive]');
    var bouton = enRetard.length ? enRetard[enRetard.length - 1] : defile.querySelector(q ? '.gf-r [data-gf-arrive]' : '.gf-r.is-proche [data-gf-arrive]');
    if (q && defile.querySelectorAll('[data-gf-id]').length !== 1) bouton = null;
    var ligne = bouton ? bouton.closest('.gf-r') : null;
    if (wrap._gfPremier !== ligne) {
      if (wrap._gfPremier) wrap._gfPremier.classList.remove('is-premier');
      if (ligne) ligne.classList.add('is-premier');
      wrap._gfPremier = ligne;
    }
    var retards = defile.querySelectorAll('[data-gf-retard]');
    if (!retards.length) return;
    var parId = new Map(m.groupes.map(function (g) { return [g.id, g]; }));
    retards.forEach(function (n) {
      var g = parId.get(n.getAttribute('data-gf-retard'));
      if (!g || m.maintenant == null) return;
      var min = gfMinutesDeRetard(g, m);
      poser(n, gfRetardCourt(min));
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
    var lignes = defile.querySelectorAll('.gf-r');
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
      if (!wrap._gfApres && wrap._gfPose != null && Math.abs(defile.scrollTop - wrap._gfPose) > 2) lacher();
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
  function gfBrancher(wrap) {
    wrap.addEventListener('click', function (e) {
      if (!e.target.closest) return;
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
      var ligne = e.target.closest && e.target.closest('[data-gf-id]');
      if (!ligne || e.target !== ligne) return;
      e.preventDefault();
      if (typeof openPos === 'function') openPos(Number(ligne.getAttribute('data-gf-id')));
    });
    var attente = 0;
    var recalculer = function () {
      if (attente) return;
      attente = requestAnimationFrame(function () {
        attente = 0;
        if (!wrap.isConnected || !wrap._gfRacine) return;
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
    // la barre est plus haute). Ecrit seulement quand il change.
    var barre = document.getElementById('planningBarre');
    if (barre && typeof ResizeObserver === 'function') {
      var bas = -1;
      new ResizeObserver(function () {
        var h = Math.round(barre.getBoundingClientRect().height);
        if (h === bas || !h) return;
        bas = h;
        document.documentElement.style.setProperty('--pb-bas', h + 'px');
      }).observe(barre);
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
    if (document.querySelector('#quickBookOverlay:not(.hidden), #posOverlay:not(.hidden), .staff-confirm-overlay, .compte-pop, .staff-action-popover')) return;
    champ.focus();
    champ.select();
  });

  window.renderGlobalPlanning = renderGlobalPlanning;
})();

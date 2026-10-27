// LE PLANNING GLOBAL : LA FEUILLE DU JOUR (2026-10-26, v4). La grille des
// heures v3 (2026-10-20, une colonne par activite, les heures a gauche) est
// partie avec son moteur.
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
// Au telephone, chaque ligne devient une carte : les memes faits, l activite
// nommee devant ses heures.
//
// La console l appelle depuis renderGlobalPlanningSurface (app-main.js), a
// chaque rendu et a chaque minute : le HTML se compare a celui du dernier rendu
// et ne s ecrit que s il a change (le defilement et le focus restent).
(function () {
  'use strict';

  // LES COLONNES, DANS L ORDRE DU PAPIER (lib/feuille-secours.js, COLONNES) :
  // l equipe retrouve sa feuille. Chaque activite que le centre propose a la
  // sienne, meme sans reservation (gpColonneDuCentre). La table d anniversaire
  // n en a pas (Movsar : « pas besoin de goûter »), les boissons non plus.
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
    return { court: numero ? 'F' + numero[1] : nom, long: nom };
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
  // Les extras achetes, comptes : deux « Cruche Bière » font « 2 × Cruche Bière ».
  function gpExtras(r) {
    var compte = new Map();
    (Array.isArray(r.extras) ? r.extras : []).forEach(function (e) {
      var nom = e && String(e.name || e.label || '').trim();
      if (nom) compte.set(nom, (compte.get(nom) || 0) + 1);
    });
    return Array.from(compte.entries()).map(function (e) { return (e[1] > 1 ? e[1] + ' × ' : '') + e[0]; });
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

  // LES ACTIVITES DU CENTRE : les colonnes du papier qu il propose (son
  // catalogue, et ce qu il a coche quand il l a dit), vides comprises. Sans
  // catalogue charge, tout le papier.
  function gpColonneDuCentre(c) {
    var catalogue = typeof getCenterActivities === 'function' ? getCenterActivities() : [];
    if (!catalogue.length) return true;
    var config = typeof getCenterScheduleConfig === 'function' ? getCenterScheduleConfig() : null;
    var carte = config && config.activityAvailability && typeof config.activityAvailability === 'object' ? config.activityAvailability : null;
    var coches = carte ? Object.keys(carte).filter(function (id) { return carte[id]; }) : [];
    return c.activites.some(function (id) { return Boolean(gpCatalogue(id)) && (!coches.length || coches.indexOf(id) >= 0); });
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
      etat.laser = { texte: gpHeure(p.t) + (places > 0 ? ' · ' + places + (places > 1 ? ' places' : ' place') : ' complet'), plein: places <= 0, bulle: 'Prochain départ laser à ' + gpHeure(p.t) + ' : ' + (places > 0 ? places + ' armes libres sur ' + laser.capacite : 'complet') };
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
    return function (b, col) {
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
      return { r: r, id: String(r.id), etat: mo.etat || 'upcoming', retard: Boolean(mo.late), teinte: gpTeinte(r), span: span, heure: gpHeureReservee(r, span), prog: getGroupeProgramme(r), cases: new Map(), infos: [], credits: [] };
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
        if (GP_SERVI[it.activityId]) { g.infos.push(gpServi(it.label || gpNomActivite(it.activityId))); return; }
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
      g.infos = g.infos.concat(gpExtras(r));
      g.formule = gpFormule(r);
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
    var utilisees = colonnes.filter(function (c) { return c.groupes > 0 || gpColonneDuCentre(c); }).concat(inconnues);
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
  function gfMinutesDeRetard(g, m) { return Math.max(1, Math.round((m.maintenant - g.span.start) * 60)); }
  // « +40 min », puis « +2h10 » : le retard tient sous l heure.
  function gfRetardCourt(n) { return n < 60 ? '+' + n + ' min' : '+' + Math.floor(n / 60) + 'h' + String(n % 60).padStart(2, '0'); }

  // ---- LES CASES ---------------------------------------------------------------
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
  // Les icones qui manquent a la console (duckpin, billard, Fun Run) : une
  // quille, une bille, un eclair ; les autres sont celles de la console.
  var GF_ICONES = {
    duckpin_bowling: '<path d="M12 2.8c1.5 0 2.3 1.3 2.3 2.8 0 1.2-.6 1.9-.8 2.8.6 1.5 2.1 3.5 2.1 6.1 0 3.4-1.6 6.7-3.6 6.7s-3.6-3.3-3.6-6.7c0-2.6 1.5-4.6 2.1-6.1-.2-.9-.8-1.6-.8-2.8 0-1.5.8-2.8 2.3-2.8z"/><path d="M9.9 9.6h4.2"/>',
    billards: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="10.2" r="3.4"/>',
    fun_run: '<path d="M13.5 2.8L5.5 13.2h6l-1.3 8 8.3-10.6h-6.1l1.1-7.8z"/>',
  };
  function gfIcone(id) {
    var chemins = GF_ICONES[id];
    if (!chemins) return typeof renderActivityIcon === 'function' ? renderActivityIcon(id) : '';
    return '<svg class="activity-check-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + chemins + '</svg>';
  }
  var GF_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  var GF_FAIT = '<svg class="gf-x__ok" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  var GF_ICONE_ARRIVE = GF_SVG + '<path d="M3 12h10"/><path d="M9 8l4 4-4 4"/><path d="M17 4v16"/></svg>';
  var GF_ICONE_NOTE = '<svg class="gf-nom__picto" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h16v12H8l-4 4z"/></svg>';

  // UNE ACTIVITE DANS SA CASE : son heure d abord (la croix du papier), puis
  // ce qu il faut pour la servir. Bowling : les pistes, et la duree si elle
  // n est pas d une heure (« XX (1h30) » sur le papier). Laser : une heure par
  // partie. Plaine : les enfants. Billard et duckpin : les tables ou pistes
  // quand il y en a plusieurs. Arcades d une formule : les credits.
  function gfActivite(g, e, col, m) {
    var r = g.r;
    var etat = gfEtat(g, e, m);
    var t = '', d = '', bulle = '';
    if (e.aPlacer) {
      t = 'à placer';
      bulle = 'Laser : une partie encore sans heure, à placer au planning laser';
    } else if (e.credit) {
      var cr = e.credits || { n: 0, total: 0, parEnfant: false };
      t = cr.parEnfant ? cr.n + ' cr./enf.' : cr.total + ' cr.';
      bulle = 'Arcades : ' + (cr.parEnfant ? cr.n + ' crédits par enfant, ' + cr.total + ' en tout' : cr.total + ' crédits');
    } else {
      var debut = e.journee ? g.span.start : e.start;
      var fin = e.journee ? g.span.end : e.end;
      var minutes = Math.round((fin - debut) * 60);
      // (la plaine qui commence a l heure de la ligne ne la redit pas : la
      // case dit les enfants)
      var desLeDebut = col.nature === 'plaine' && (e.journee || Math.abs(debut - g.heure) <= 0.25 + 1e-6);
      t = desLeDebut ? '' : (e.libre ? '≈ ' : '') + gpHeure(debut);
      if (col.nature === 'bowling') {
        var n = e.pistes ? e.pistes.length : 0;
        d = n ? 'P' + gpPistes(e.pistes) : 'pistes ?';
        if (minutes !== 60) d += ' ' + gfDuree(minutes);
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
    var classes = 'gf-x is-' + etat + (e.libre && !e.journee ? ' is-libre' : '') + (e.credit ? ' is-credit' : '');
    return '<span class="' + classes + '" title="' + gpEsc(bulle + ' · ' + GF_ETATS[etat]) + '"><span class="gf-x__t">' + (etat === 'fini' ? GF_FAIT : '') + '<b>' + gpEsc(t) + '</b></span>' + (d ? '<span class="gf-x__d">' + gpEsc(d) + '</span>' : '') + '</span>';
  }
  function gfCase(g, col, m) {
    var liste = g.cases.get(col.cle) || [];
    if (!liste.length) return '<td class="gf-a is-vide"></td>';
    // (deux parties de laser tiennent cote a cote ; la troisieme passe dessous)
    return '<td class="gf-a" data-gf-titre="' + gpEsc(col.titre) + '"><span class="gf-a__in' + (liste.length === 2 ? ' is-deux' : '') + '">' + liste.map(function (e) { return gfActivite(g, e, col, m); }).join('') + '</span></td>';
  }

  // LE GROUPE : son nom entier (jamais coupe), puis ce qui change la facon de
  // le servir : ce qu il a pris en plus (cruches, extras) et ses notes.
  function gfNotes(r) {
    var parts = [];
    var mot = typeof getReservationNoteText === 'function' ? getReservationNoteText(r) : '';
    if (mot) parts.push(mot);
    if (typeof getReservationNotesEquipe === 'function') getReservationNotesEquipe(r).forEach(function (n) { if (n && n.t) parts.push(n.t); });
    var client = window.PinlaneStaffNotes && typeof window.PinlaneStaffNotes.text === 'function' ? window.PinlaneStaffNotes.text(r) : '';
    if (client) parts.push(client);
    return parts.join(' · ').replace(/\s+/g, ' ').trim();
  }
  // En retard, son numero passe devant : c est le moment de l appeler.
  function gfGroupe(g, m) {
    var r = g.r;
    var infos = g.infos.filter(Boolean);
    var note = gfNotes(r);
    var sous = '';
    var tel = String(r.phone || '').trim();
    if (g.retard && m.maintenant != null && tel) sous += '<a class="gf-nom__tel" href="tel:' + gpEsc(tel.replace(/[^0-9+]/g, '')) + '">' + gpEsc(tel) + '</a>';
    if (infos.length) sous += '<span class="gf-nom__info">' + gpEsc(infos.join(' · ')) + '</span>';
    if (note) sous += '<span class="gf-nom__note">' + GF_ICONE_NOTE + gpEsc(note) + '</span>';
    // (au telephone, les colonnes Formule et Pers. passent sous le nom)
    var pax = Number(r.pax) || 0;
    var meta = [pax + ' pers.'].concat(g.formule ? [g.formule.long] : r.type === 'custom' || r.surMesure === true ? ['Sur mesure'] : []).join(' · ');
    return '<td class="gf-nom"><span class="gf-nom__t">' + gpEsc(r.name || 'Client') + '</span>'
      + (sous ? '<span class="gf-nom__sous" title="' + gpEsc(infos.concat(note ? [note] : []).join(' · ')) + '">' + sous + '</span>' : '')
      + '<span class="gf-nom__meta" aria-hidden="true">' + gpEsc(meta) + '</span></td>';
  }
  function gfFormuleCase(g) {
    var r = g.r;
    // (« Back To School/Work » peut passer a la ligne apres sa barre)
    if (g.formule) return '<td class="gf-f"><span class="gf-formule" title="' + gpEsc(g.formule.long) + '">' + gpEsc(g.formule.court).replace(/\//g, '/<wbr>') + '</span></td>';
    if (r.type === 'custom' || r.surMesure === true) return '<td class="gf-f"><span class="gf-formule is-mesure">Sur mesure</span></td>';
    return '<td class="gf-f"></td>';
  }
  function gfPersonnes(g) {
    var r = g.r;
    var pax = Number(r.pax) || 0;
    var avec = Math.max(0, Math.trunc(Number(r.companions) || 0));
    var bulle = pax + (pax > 1 ? ' personnes' : ' personne') + (avec ? ' + ' + avec + (avec > 1 ? ' accompagnants' : ' accompagnant') : '');
    return '<td class="gf-n" title="' + gpEsc(bulle) + '"><b>' + pax + '</b>' + (avec ? '<span class="gf-n__plus">+' + avec + '</span>' : '') + '</td>';
  }

  // L ETAT, au bout de la ligne : le statut (sa couleur est celle de la
  // ligne), ce qui attend l equipe, et « Arrivé » tant que le groupe est
  // attendu aujourd hui.
  // Le montant d un groupe venu (pointe arrive, ou une activite cochee) et pas
  // encore paye, quand son prix est connu (la regle de la fiche, prixDossierConnu).
  function gfMontantDu(r) {
    if (r.status === 'paid' || r.status === 'cancelled') return '';
    var venu = r.status === 'arrived' || (typeof groupeAJoue === 'function' && groupeAJoue(r));
    return venu && typeof prixDossierConnu === 'function' && prixDossierConnu(r) ? formatMoneyCentimes(r.price) : '';
  }
  function gfPeutArriver(g, m) {
    var r = g.r;
    if (!m.aujourdHui || g.etat !== 'upcoming' || r.status === 'paid' || r.status === 'arrived' || r.absentAt) return false;
    if (typeof setReservationStatusDirect !== 'function') return false;
    return typeof canUseStaffPermission !== 'function' || canUseStaffPermission('reservations.status');
  }
  function gfEtatCase(g, m) {
    var r = g.r;
    var h = '';
    if (g.etat === 'absent' || g.teinte === 'absent') h += '<span class="gf-b t-absent">Pas venu</span>';
    else if (g.teinte === 'paid') h += '<span class="gf-b t-paid">Payé</span>';
    else if (g.teinte === 'arr') h += '<span class="gf-b t-arr">Arrivé</span>';
    if (typeof isReservationAwaitingReview === 'function' && isReservationAwaitingReview(r)) h += '<span class="gf-b is-valider">À valider</span>';
    // L ARGENT AU BON MOMENT (2026-10-27) : la visite finie d un groupe venu,
    // son montant a encaisser ; personne ne part sans payer. Un groupe jamais
    // pointe ni joue reste « À clôturer » : venu ou pas, le comptoir tranche.
    if (g.etat === 'closing') {
      var du = gfMontantDu(r);
      // (le montant suit le badge sans y entrer : a l etroit, il passe dessous
      // au lieu d elargir la colonne)
      h += du
        ? '<span class="gf-b is-encaisser" title="' + gpEsc('Visite finie : ' + du + ' à encaisser') + '">À encaisser</span><b class="gf-du">' + gpEsc(du) + '</b>'
        : '<span class="gf-b is-cloturer"' + (r.status === 'arrived' ? '' : ' title="Fini sans avoir été pointé arrivé"') + '>À clôturer</span>';
    }
    if (gfPeutArriver(g, m)) h += '<button type="button" class="gf-arrive" data-gf-arrive="' + gpEsc(g.id) + '" aria-label="' + gpEsc('Pointer ' + (r.name || 'le groupe') + ' arrivé') + '">' + GF_ICONE_ARRIVE + 'Arrivé</button>';
    return '<td class="gf-etat"><span class="gf-etat__in">' + h + '</span></td>';
  }

  // Ce qu une ligne dit a un lecteur d ecran, d une traite.
  function gfAria(g, m) {
    var r = g.r;
    var parts = [gpHeure(g.heure), r.name || 'Client', (Number(r.pax) || 0) + ' personnes'];
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
    var du = g.etat === 'closing' ? gfMontantDu(r) : '';
    if (du) parts.push('à encaisser ' + du);
    // (les minutes de retard changent a chaque minute : elles sont dans la
    // bulle du retard, la ligne ne se reecrit pas pour elles)
    if (g.retard && m.maintenant != null) parts.push('en retard');
    return parts.join(', ');
  }

  // LA RECHERCHE : le nom, le telephone, l email, le libelle, sans accents.
  function gfCle(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }
  function gfTrouve(g, q) {
    if (!q) return true;
    var r = g.r;
    return gfCle([r.name, r.phone, r.email, r.label, g.formule && g.formule.long].join(' ')).indexOf(q) >= 0;
  }

  // ---- LA FEUILLE EN HTML ------------------------------------------------------
  // L heure de la reservation a gauche, et la journee rangee par demi-heure,
  // comme les blocs du papier : un filet franc a chaque bloc, une bande un bloc
  // sur deux. Une heure repetee (deux groupes a 14:00) s ecrit plus
  // discretement. La barre de l heure qu il est passe entre les heures passees
  // et les heures a venir.
  function gfTete(m) {
    var html = '<th class="gf-th gf-th--h" scope="col" title="L’heure de la réservation">Heure</th><th class="gf-th gf-th--nom" scope="col">Groupe</th><th class="gf-th gf-th--f" scope="col">Formule</th><th class="gf-th gf-th--n" scope="col" title="Personnes">Pers.</th>';
    m.colonnes.forEach(function (c) {
      // (sous le nom, l etat du centre a cette minute ; le jour meme seulement)
      var et = m.etat && m.etat[c.cle];
      html += '<th class="gf-th gf-th--a' + (c.groupes ? '' : ' is-vide') + (c.titre.length > 14 ? ' is-long' : '') + '" scope="col" data-gf-cle="' + gpEsc(c.cle) + '" title="' + gpEsc(c.titre + (c.groupes ? ' : ' + c.groupes + (c.groupes > 1 ? ' groupes' : ' groupe') : ' : aucun groupe ce jour-là') + (et ? ' · ' + et.bulle : '')) + '"><span class="gf-th__in">' + gfIcone(c.activites[0]) + '<span>' + gpEsc(c.titre) + '</span></span>'
        + (et ? '<span class="gf-th__etat' + (et.plein ? ' is-plein' : '') + '" data-gf-etat="' + gpEsc(c.cle) + '">' + gpEsc(et.texte) + '</span>' : '') + '</th>';
    });
    return html + '<th class="gf-th gf-th--etat" scope="col">État</th>';
  }
  function gfMaintenant(m, nbCol) {
    return '<tr class="gf-now" aria-hidden="true"><td class="gf-h"><span class="gf-now__h" data-gf-maintenant></span></td><td colspan="' + (nbCol - 1) + '"></td></tr>';
  }
  // LE FILET D UNE DEMI-HEURE (2026-10-27) : une ligne fine en tete du bloc,
  // ce qui arrive (les groupes et les personnes de ses lignes) et, sous la
  // colonne concernee, la ressource pleine. Le filtre et la recherche comptent
  // ce qu ils montrent ; la charge, elle, compte tout le centre.
  function gfDemi(m, b, compte, bande) {
    var cases = m.colonnes.map(function (col) {
      var plein = m.charge(b, col);
      return plein
        ? '<td class="gf-demi__a" data-gf-titre="' + gpEsc(col.titre) + '"><span class="gf-demi__plein" title="' + gpEsc(plein.bulle) + '">' + gpEsc(plein.texte) + '</span></td>'
        : '<td class="gf-demi__a is-vide"></td>';
    }).join('');
    return '<tr class="gf-demi' + (bande ? ' is-bande' : '') + '" data-gf-demi="' + gpEsc(gpHeure(b)) + '">'
      + '<td class="gf-h"></td>'
      + '<td class="gf-demi__t" colspan="3"><b>' + gpEsc(gfPluriel(compte.groupes, ['groupe', 'groupes'])) + '</b> · ' + compte.pers + ' pers.</td>'
      + cases + '<td class="gf-etat"></td></tr>';
  }
  function gfBloc(heure) {
    var b = Math.floor(heure * 2 + 1e-6) / 2;
    return b;
  }
  function gfHtml(m, q) {
    var nbCol = 5 + m.colonnes.length;
    var lignes = m.groupes.filter(function (g) { return (!m.visibles || m.visibles.has(g.id)) && gfTrouve(g, q); });
    var parBloc = new Map();
    lignes.forEach(function (g) {
      var b = gfBloc(g.heure);
      var c = parBloc.get(b) || { groupes: 0, pers: 0 };
      c.groupes += 1;
      c.pers += Number(g.r.pax) || 0;
      parBloc.set(b, c);
    });
    var corps = '';
    var avant = null, bande = false, bloc = null;
    var nowPose = m.maintenant == null;
    lignes.forEach(function (g) {
      if (!nowPose && g.heure > m.maintenant + 1e-6) { corps += gfMaintenant(m, nbCol); nowPose = true; }
      // (la demi-heure du papier, blocDe : 14:10 va dans le bloc de 14:00,
      // 14:40 dans celui de 14:30)
      var b = gfBloc(g.heure);
      var nouveauBloc = b !== bloc;
      if (nouveauBloc && bloc !== null) bande = !bande;
      bloc = b;
      if (nouveauBloc) corps += gfDemi(m, b, parBloc.get(b), bande);
      var repete = avant !== null && Math.abs(avant - g.heure) < 1 / 120;
      avant = g.heure;
      var classes = 'gf-r t-' + g.teinte + (g.parti ? ' is-parti' : '') + (g.etat === 'absent' ? ' is-absent' : '') + (g.retard ? ' is-retard' : '') + (bande ? ' is-bande' : '') + (nouveauBloc ? ' is-bloc' : '');
      // (le retard s ecrit sous l heure : c est elle qui est depassee ; ses
      // minutes, par gfRemplir)
      var retard = g.retard && m.maintenant != null ? '<span class="gf-h__retard" data-gf-retard="' + gpEsc(g.id) + '"></span>' : '';
      corps += '<tr class="' + classes + '" tabindex="0" data-gf-id="' + gpEsc(g.id) + '" aria-label="' + gpEsc(gfAria(g, m)) + '">'
        + '<td class="gf-h' + (repete && !retard ? ' is-repete' : '') + '"><b>' + gpEsc(gpHeure(g.heure)) + '</b>' + retard + '</td>'
        + gfGroupe(g, m) + gfFormuleCase(g) + gfPersonnes(g)
        + m.colonnes.map(function (c) { return gfCase(g, c, m); }).join('')
        + gfEtatCase(g, m) + '</tr>';
    });
    if (!nowPose && lignes.length) corps += gfMaintenant(m, nbCol);
    if (!lignes.length && m.groupes.length) {
      corps += '<tr class="gf-rien"><td colspan="' + nbCol + '">' + (q ? 'Aucun groupe ne correspond à cette recherche.' : 'Aucun groupe dans ce filtre.') + '</td></tr>';
    }
    // (au telephone, la tete des colonnes disparait : l etat du centre passe
    // en une ligne au-dessus des cartes)
    var etats = m.etat ? m.colonnes.filter(function (c) { return m.etat[c.cle]; }).map(function (c) {
      var et = m.etat[c.cle];
      return '<span' + (et.plein ? ' class="is-plein"' : '') + '><b>' + gpEsc(c.titre) + '</b> ' + gpEsc(et.texte) + '</span>';
    }) : [];
    return (etats.length ? '<p class="gf-maintenant">' + etats.join('') + '</p>' : '')
      + '<table class="gf-t" aria-label="' + gpEsc('Feuille du ' + m.jour + ' : un groupe par ligne, ses activités en colonnes') + '"><thead><tr>' + gfTete(m) + '</tr></thead><tbody>' + corps + '</tbody></table>';
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
    }
    gfStats.rendus += 1;
    var bandeau = racine.querySelector('.gf-bandeau');
    var ferme = Boolean(m.fenetre && m.fenetre.closed);
    var texte = ferme ? 'Centre fermé ce jour-là' + (m.groupes.length ? ' · réservations existantes à contrôler' : '') : !m.groupes.length ? 'Aucune réservation ce jour-là' : '';
    bandeau.hidden = !texte;
    bandeau.className = 'gf-bandeau' + (ferme ? ' is-ferme' : '');
    if (bandeau.textContent !== texte) bandeau.textContent = texte;
    var defile = racine.querySelector('.gf-defile');
    var html = m.groupes.length ? gfHtml(m, q) : '';
    wrap._gfModele = m;
    if (html !== wrap._gfHtml) {
      var actif = document.activeElement;
      var focus = actif && defile.contains(actif) ? gfCleFocus(actif) : null;
      defile.innerHTML = html;
      wrap._gfHtml = html;
      gfStats.ecritures += 1;
      if (focus) gfRendreFocus(defile, focus);
    }
    gfRemplir(defile, m);
    racine.classList.toggle('is-vide', !m.groupes.length);
    // (la tete prend une seconde ligne quand elle dit l etat du centre)
    racine.classList.toggle('has-etat', Boolean(m.etat && Object.keys(m.etat).length));
    gfHauteur(wrap);
    // LA FEUILLE S OUVRE SUR L HEURE QU IL EST, une fois par jour affiche :
    // ensuite, le defilement de l equipe ne bouge plus.
    if (wrap._gfJourOuvert !== m.jour) {
      wrap._gfJourOuvert = m.jour;
      gfAllerAMaintenant(wrap, false);
    }
    gfSuivreMaintenant(wrap);
  }
  // CE QUI CHANGE A CHAQUE MINUTE s ecrit en place, ici seulement : la
  // pastille de l heure et les minutes de retard. Le HTML compare n en porte
  // rien : a la minute, la feuille ne se reecrit que si un etat a change, et un
  // clic qui tombe sur la minute n est jamais perdu.
  function gfRemplir(defile, m) {
    var poser = function (n, texte) { if (n.textContent !== texte) n.textContent = texte; };
    var pastille = defile.querySelector('[data-gf-maintenant]');
    if (pastille) poser(pastille, gpHeure(m.maintenant));
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
    return { id: ligne.getAttribute('data-gf-id'), arrive: Boolean(el.closest('[data-gf-arrive]')) };
  }
  function gfRendreFocus(defile, f) {
    var ligne = defile.querySelector('[data-gf-id="' + CSS.escape(f.id) + '"]');
    if (!ligne) return;
    var cible = f.arrive ? ligne.querySelector('[data-gf-arrive]') || ligne : ligne;
    cible.focus({ preventScroll: true });
  }

  // LA HAUTEUR : la feuille va jusqu au bas de l ecran et defile en elle-meme
  // (un panneau de liste se borne, il ne pousse pas la page : README Pinlane,
  // 2026-08-13). Une hauteur FIXE, pas un plafond : filtrer ou chercher ne la
  // change pas, et la liste du dessous ne saute pas sous le doigt (rush-status,
  // « Arrivé » sous un filtre qui revient a « Tout »). Agrandie, elle prend
  // l ecran. Au telephone, chaque ligne est une carte et la page defile.
  var GF_BAS = 16;
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

  // L HEURE QU IL EST : la ligne de maintenant se pose sous la tete, avec deux
  // lignes d avant (les groupes qui viennent d arriver, les retards). Si elle
  // sort de la vue, un bouton y ramene.
  function gfAllerAMaintenant(wrap, doux) {
    var racine = wrap._gfRacine;
    var defile = racine && racine.querySelector('.gf-defile');
    var now = defile && defile.querySelector('.gf-now');
    if (!now) { if (defile && !doux) defile.scrollTop = 0; return; }
    var tete = defile.querySelector('thead');
    var avant = 0, n = 0, l = now.previousElementSibling;
    while (l && n < 2) { avant += l.getBoundingClientRect().height; n += 1; l = l.previousElementSibling; }
    var y = Math.max(0, now.offsetTop - (tete ? tete.getBoundingClientRect().height : 0) - avant);
    if (racine.getBoundingClientRect().width < 640) {
      var cible = (l ? l.nextElementSibling : defile.querySelector('tbody tr')) || now;
      if (doux) cible.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (doux && typeof defile.scrollTo === 'function') defile.scrollTo({ top: y, behavior: 'smooth' });
    else defile.scrollTop = y;
  }
  function gfSuivreMaintenant(wrap) {
    var racine = wrap._gfRacine;
    var bouton = racine.querySelector('.gf-retour');
    var defile = racine.querySelector('.gf-defile');
    var now = defile.querySelector('.gf-now');
    if (wrap._gfObservateur) { wrap._gfObservateur.disconnect(); wrap._gfObservateur = null; }
    if (!now || typeof IntersectionObserver !== 'function' || racine.getBoundingClientRect().width < 640) { bouton.hidden = true; return; }
    var texte = gpHeure(wrap._gfModele.maintenant);
    // (la barre passe sous la tete collee : sa hauteur, une ligne ou deux)
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
  // « Annuler ») ; un clic ou Entree ailleurs sur la ligne ouvre la fiche.
  function gfBrancher(wrap) {
    wrap.addEventListener('click', function (e) {
      if (!e.target.closest) return;
      var arrive = e.target.closest('[data-gf-arrive]');
      if (arrive) { setReservationStatusDirect(arrive.getAttribute('data-gf-arrive'), 'arrived', e); return; }
      if (e.target.closest('.gf-retour')) { gfAllerAMaintenant(wrap, true); return; }
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
      attente = requestAnimationFrame(function () { attente = 0; if (wrap.isConnected && wrap._gfRacine) { gfHauteur(wrap); gfSuivreMaintenant(wrap); } });
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

  window.renderGlobalPlanning = renderGlobalPlanning;
})();

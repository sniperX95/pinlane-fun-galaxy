// LE PLANNING GLOBAL (2026-10-12) : toutes les activites du jour dans la
// grille d heures du planning bowling, une colonne par activite.
//
// Ce que Movsar a demande et tranche, dans l ordre :
//   - « comme le planning bowling mais adapte pour toute activite », « tout
//     visible par heure, quelle activite, quel groupe », « tout voir d un
//     coup », « les noms complets », « qui est qui », boissons et notes
//     comprises, des aides qui ne prennent pas de place ;
//   - les heures A GAUCHE, de haut en bas (une frise a l heure en haut :
//     « completement debile ») ;
//   - la couleur d une carte est celle de l ETAT du groupe (bleu confirme,
//     ambre arrive, vert paye), jamais une couleur par activite (« trop de
//     couleurs, ca fait pas pro », planning laser, 2026-10-09) ;
//   - « des petites aides » : les pictos du bowling apres le nom (note,
//     anniversaire), la bulle d un groupe au survol (son programme, ses
//     notes, la fiche, « Arrivé », son numero s il est en retard).
//
// Chaque activite d un groupe est une carte posee a son heure, haute de sa
// duree : pleine pendant qu elle se joue, grise une fois finie, en
// pointilles quand elle n a pas d heure fixe (a son heure probable, la regle
// du moteur). Deux groupes au meme moment sur la meme activite se partagent
// la colonne. La largeur des colonnes se calcule sur les noms a ecrire, la
// hauteur des heures sur l ecran.
//
// LA JOURNEE ENTIERE, TOUJOURS (2026-10-19, Movsar : « toutes les heures et
// le planning complet et visibles même quand il n'y a rien ») : la grille va
// de l ouverture a la fermeture du centre, chaque activite du centre a sa
// colonne meme vide, un jour ferme ou sans reservation garde sa grille. Rien
// ne se replie : quand la journee ne tient pas, la grille defile en elle-meme
// (heures collees a gauche, tetes collees en haut) et s ouvre sur l heure
// qu il est. La minute qui passe deplace la barre de l heure sans redessiner.
// A la souris, la bulle au survol ; au doigt, toucher montre le programme,
// toucher encore ouvre la fiche. Une case vide du bowling ou du laser ouvre
// la reservation rapide a son heure (les chemins de ces deux plannings).
//
// La console l appelle depuis renderGlobalPlanningSurface (app-main.js),
// sous l onglet « Planning global ». Le module n ecrit rien : seul « Arrivé »,
// dans la bulle, passe par setReservationStatusDirect, comme la vue Terrain.
(function () {
  'use strict';

  // LES COLONNES, DANS L ORDRE DU PAPIER (lib/feuille-secours.js, COLONNES) :
  // l equipe retrouve sa feuille. Chaque activite que le centre propose a la
  // sienne, meme sans reservation (gpColonneDuCentre). La table d anniversaire n en a pas
  // (Movsar : « pas besoin de goûter »).
  var GP_COLONNES = [
    { cle: 'bowling', titre: 'Bowling', activites: ['bowling'] },
    { cle: 'duckpin', titre: 'Duckpin', activites: ['duckpin_bowling'] },
    { cle: 'laser', titre: 'Laser', activites: ['laser_game'] },
    { cle: 'funrun', titre: 'Fun Run', activites: ['fun_run'] },
    { cle: 'arcades', titre: 'Arcades', activites: ['arcade_time', 'arcade_credit'] },
    { cle: 'minigolf', titre: 'Minigolf', activites: ['minigolf_blacklight'] },
    { cle: 'oclock', titre: 'O’Clock', activites: ['golf_oclock'] },
    { cle: 'plaine', titre: 'Plaine', activites: ['playground'] },
    { cle: 'billard', titre: 'Billard', activites: ['billards'] },
  ];
  var GP_SANS_COLONNE = { party_table: true };
  // Ce qui se sert au comptoir ne prend pas de temps de visite : les boissons
  // vont aux infos, les credits d arcade dans la colonne Arcades.
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
  function gpNomActivite(id, repli) {
    var a = gpCatalogue(id);
    return (a && a.name) || repli || String(id || 'Activité').replace(/_/g, ' ');
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
  // Fun Day ». Le nom entier reste dans la bulle.
  function gpFormule(r) {
    if (!r.formuleId && r.type !== 'formule') return null;
    var f = r.formuleId && typeof resolveDisplayFormule === 'function' ? resolveDisplayFormule(r.formuleId) : null;
    var nom = String((f && f.name) || r.label || 'Formule').trim();
    var numero = /^formule\s*(\d+)$/i.exec(nom);
    if (nom === nom.toUpperCase()) nom = nom.toLowerCase().replace(/(^|[\s/])(\p{L})/gu, function (x, a, b) { return a + b.toUpperCase(); });
    return { court: numero ? 'F' + numero[1] : nom, long: nom };
  }
  // « 8 crédits d'arcade (8€) par enfant » se lit « 8 crédits ».
  function gpCredits(label) {
    var m = /(\d+)\s*cr[ée]dits?/i.exec(String(label || ''));
    return m ? m[1] + ' crédits' : 'crédits';
  }
  // « 2 cruches boissons » se lit « 2 cruches » : la colonne dit deja ce que c est.
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

  // LES ACTIVITES SANS HEURE D UN GROUPE. La case dit « ✓ » ; la bulle dit
  // vers quelle heure, par la regle du moteur, celle qui donne la fin de
  // visite affichee partout (getVisiteLibreApres) : leurs minutes remplissent
  // d abord les trous entre les blocs a heure du groupe, le reste se joue
  // apres son plan. Ce qui se sert (boissons, credits) ne prend pas de temps.
  function gpLibres(g) {
    var r = g.r;
    var items = r.program && Array.isArray(r.program.items) ? r.program.items : [];
    var lignes = [];
    items.forEach(function (it) {
      if (!it || it.planned !== false || it.waitOffer) return;
      lignes.push({ id: it.activityId, nom: nomActivite(it), minutes: gpMinutes(it.activityId, it), journee: ligneALaJournee(it), unites: Math.max(0, Math.trunc(Number(it.units) || 0)) });
    });
    // Une formule suivie : ses activites sans heure que le programme ne porte pas.
    if (typeof reservationHasFormulaActivities === 'function' && reservationHasFormulaActivities(r)) {
      getFormulaActivityProgressSummary(r).items.forEach(function (it) {
        if (it.startTime || it.activityId === 'bowling' || it.activityId === 'laser_game' || it.activityId === 'party_table') return;
        if (lignes.some(function (l) { return l.id === it.activityId; })) return;
        lignes.push({ id: it.activityId, nom: it.label || gpNomActivite(it.activityId), minutes: gpMinutes(it.activityId, null), journee: false, unites: 0 });
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

  // ---- LA JOURNEE EN LIGNES ---------------------------------------------------
  function gpModele() {
    var jour = state.currentDate;
    var tout = todaysReservations();
    var auj = todayStr();
    var nuit = gpNuit(jour, auj);
    var moments = nuit ? gpMomentsNuit(tout, 24 + currentTimeDecimal()) : getStaffReservationMoments(tout);
    // Le filtre d etat de la barre des plannings vaut ici comme au bowling ;
    // la recherche, elle, eteint les autres groupes sans les retirer (la
    // grille ne saute pas pendant qu on tape).
    if (typeof releaseDeadNoteFilter === 'function') releaseDeadNoteFilter();
    var res = typeof filterReservationsForStaff === 'function' ? filterReservationsForStaff(tout, state.staffStatusFilter || 'all') : tout;
    var aujourdHui = jour === auj || nuit;
    var maintenant = jour === auj ? currentTimeDecimal() : nuit ? 24 + currentTimeDecimal() : null;
    var colonnes = GP_COLONNES.map(function (c) { return Object.assign({}, c, { groupes: 0 }); });
    var inconnues = [];
    function colonneDe(id) {
      var c = colonnes.find(function (x) { return x.activites.indexOf(id) >= 0; });
      if (c) return c;
      c = inconnues.find(function (x) { return x.activites[0] === id; });
      if (!c) {
        // Une activite hors papier (lancer de hache, VR...) : sa colonne, apres le billard.
        c = { cle: 'a-' + id, titre: gpNomActivite(id), activites: [id], groupes: 0 };
        inconnues.push(c);
      }
      return c;
    }
    var groupes = res.map(function (r) {
      var mo = moments.get(String(r.id)) || {};
      var debut = gpMinutesDe(r.startTime);
      var span = getStaffTerrainSpan(r);
      return { r: r, id: String(r.id), etat: mo.etat || 'upcoming', retard: Boolean(mo.late), teinte: gpTeinte(r), span: span, debut: debut == null ? span.start : debut, prog: getGroupeProgramme(r), cases: new Map(), infos: [] };
    });
    // L ORDRE DU PAPIER : l heure d arrivee, puis le nom.
    groupes.sort(function (a, b) { return a.debut - b.debut || String(a.r.name || '').localeCompare(String(b.r.name || ''), 'fr'); });
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
      g.prog.filter(function (e) { return e.aPlacer; }).forEach(function () { poser('laser_game', { aPlacer: true }); });
      // Les activites a heure d une formule (hors bowling, laser, table).
      getStaffFormulaTimedItems(r).forEach(function (it) {
        if (it.activityId === 'bowling' || it.activityId === 'laser_game') return;
        if (GP_SERVI[it.activityId]) { g.infos.push(gpServi(it.label || gpNomActivite(it.activityId))); return; }
        poser(it.activityId, { start: it.start, end: Math.max(it.end, it.start + 0.25) });
      });
      var libres = gpLibres(g);
      libres.places.forEach(function (p) {
        poser(p.l.id, { start: p.start, end: p.end, libre: true, journee: Boolean(p.journee), unites: p.l.unites, nom: p.l.nom });
      });
      libres.servis.forEach(function (l) {
        if (l.id === 'arcade_credit') poser('arcade_credit', { credit: true, nom: l.nom });
        else g.infos.push(gpServi(l.nom));
      });
      g.infos = g.infos.concat(gpExtras(r));
      g.formule = gpFormule(r);
      g.note = String(r.notes || '').replace(/^\s*\[[eé]quipe\]\s*/gim, '').replace(/\s+/g, ' ').trim();
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
    var utilisees = colonnes.filter(function (c) { return c.groupes > 0 || gpColonneDuCentre(c); }).concat(inconnues);
    return { jour: jour, aujourdHui: aujourdHui, passe: jour < auj && !nuit, maintenant: maintenant, groupes: groupes, colonnes: utilisees, fenetre: typeof getPlanningWindow === 'function' ? getPlanningWindow(jour) : { open: 10, close: 22, closed: false } };
  }

  // ---- LE RENDU : LA GRILLE DES HEURES ---------------------------------------------
  // La tete des colonnes (celle du planning bowling), la bande du matin replie,
  // la colonne des heures, et les bornes de la hauteur d une heure.
  // (le nom des cartes a 13 px sur 15 : une demi-heure a 48 px l heure garde
  // sa ligne entiere ; quand la journee ne tient pas, 72 px, la grille defile
  // et une partie de laser y dit encore ses armes)
  var GH = { tete: 44, colHeures: 60, colHeuresGrand: 72, heureMin: 48, heureConfort: 72, heureMax: 112, ligne: 15, cadre: 4, bas: 14, colMin: 72 };
  // Les icones qui manquent a la console (duckpin, billard, Fun Run) : une
  // quille, une bille, un eclair ; les autres sont celles de la console.
  var GH_ICONES = {
    duckpin_bowling: '<path d="M12 2.8c1.5 0 2.3 1.3 2.3 2.8 0 1.2-.6 1.9-.8 2.8.6 1.5 2.1 3.5 2.1 6.1 0 3.4-1.6 6.7-3.6 6.7s-3.6-3.3-3.6-6.7c0-2.6 1.5-4.6 2.1-6.1-.2-.9-.8-1.6-.8-2.8 0-1.5.8-2.8 2.3-2.8z"/><path d="M9.9 9.6h4.2"/>',
    billards: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="10.2" r="3.4"/>',
    fun_run: '<path d="M13.5 2.8L5.5 13.2h6l-1.3 8 8.3-10.6h-6.1l1.1-7.8z"/>',
  };
  function ghIcone(id) {
    var chemins = GH_ICONES[id];
    if (!chemins) return renderActivityIcon(id);
    return '<svg class="activity-check-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + chemins + '</svg>';
  }

  // LES SEANCES : chaque activite d un groupe qui a une heure (vraie, ou
  // probable quand elle n a pas d heure fixe), dans la colonne de son activite.
  // Les credits d arcade et le laser encore a placer n en ont pas : ils
  // s ecrivent sur la carte du groupe.
  function ghSeances(m) {
    var seances = [];
    m.groupes.forEach(function (g) {
      g.cases.forEach(function (liste, cle) {
        liste.forEach(function (e) {
          if (e.credit || e.aPlacer) return;
          var debut = e.journee ? g.span.start : e.start;
          var fin = e.journee ? g.span.end : e.end;
          if (debut == null || !(fin > debut)) return;
          seances.push({ g: g, e: e, cle: cle, start: debut, end: fin });
        });
      });
    });
    return seances;
  }

  // DEUX GROUPES SUR LA MEME ACTIVITE AU MEME MOMENT SE PARTAGENT LA COLONNE,
  // comme deux rendez-vous dans un agenda : une grappe de seances qui se
  // chevauchent se coupe en voies, et chacune prend sa part de la largeur.
  // Une seance de moins d une demi-heure se dessine sur une demi-heure (une
  // carte lisible) : c est cette fin dessinee qui compte pour les voies.
  function ghVoies(liste, finDessinee) {
    liste.sort(function (a, b) { return a.start - b.start || finDessinee(b) - finDessinee(a); });
    var grappe = [], fins = [], finGrappe = -Infinity;
    var fermer = function () {
      var k = Math.max(1, fins.length);
      grappe.forEach(function (s) { s.k = k; });
      grappe = [];
      fins = [];
      finGrappe = -Infinity;
    };
    liste.forEach(function (s) {
      if (grappe.length && s.start >= finGrappe - 1e-6) fermer();
      var v = fins.findIndex(function (f) { return f <= s.start + 1e-6; });
      if (v < 0) { v = fins.length; fins.push(0); }
      fins[v] = finDessinee(s);
      s.voie = v;
      grappe.push(s);
      finGrappe = Math.max(finGrappe, finDessinee(s));
    });
    if (grappe.length) fermer();
  }

  // L ETAT D UNE CARTE A L HEURE QU IL EST : finie, en cours, plus tard ; un
  // groupe en retard n est pas « en cours » de ce qu il n a pas commence.
  function ghEtat(s, m) {
    var g = s.g, e = s.e;
    if (m.passe || g.parti || g.etat === 'closing' || e.fait) return 'fini';
    if (m.maintenant == null) return 'avenir';
    if (s.end <= m.maintenant + 1e-6) return 'fini';
    if (g.retard && s.start <= m.maintenant + 1e-6) return 'retard';
    if (e.libre) return 'avenir';
    if (s.start <= m.maintenant + 1e-6) return 'encours';
    return 'avenir';
  }
  var GH_ETATS = { fini: 'fini', encours: 'en cours', avenir: 'à venir', retard: 'en retard, pas encore arrivé' };

  // CE QUE LA CARTE DIT DE L ACTIVITE : les pistes au bowling, les armes au
  // laser (quand le groupe ne joue pas au complet), les tables, les pistes.
  function ghDetail(s) {
    var e = s.e, g = s.g;
    if (e.activityId === 'bowling') return e.pistes && e.pistes.length ? 'P' + gpPistes(e.pistes) : 'pistes à attribuer';
    if (e.activityId === 'laser_game') return (e.joueurs || g.r.pax) + ' armes';
    if (e.unites > 1) return '×' + e.unites + (e.activityId === 'billards' ? ' tables' : ' pistes');
    if (e.journee) return 'toute la visite';
    return '';
  }
  // CE QUE LA PREMIERE CARTE D UN GROUPE DIT DE LUI : sa formule, ses
  // credits, ses boissons et extras, sa note (son picto ; le texte entier est
  // dans la bulle et la fiche).
  function ghInfos(g) {
    var morceaux = [];
    if (g.formule) morceaux.push(g.formule.court);
    g.cases.forEach(function (liste) { liste.forEach(function (e) { if (e.credit) morceaux.push(gpCredits(e.nom)); }); });
    return morceaux.concat(g.infos);
  }
  function ghMinutesDeRetard(debut, maintenant) { return Math.max(1, Math.round((maintenant - debut) * 60)); }
  function ghTags(g, m) {
    var tags = '';
    // (les minutes de retard suivent l heure sans redessiner : ghHorloge)
    if (g.retard && m.maintenant != null) tags += '<span class="gp-tag is-retard" title="En retard" data-gh-depuis="' + g.span.start + '"><span class="gp-tag__long">retard </span><span class="gh-min">' + ghMinutesDeRetard(g.span.start, m.maintenant) + '</span> min</span>';
    if (typeof isReservationAwaitingReview === 'function' && isReservationAwaitingReview(g.r)) tags += '<span class="gp-tag is-valider">à valider</span>';
    if (g.etat === 'closing') tags += '<span class="gp-tag is-cloturer">à clôturer</span>';
    if (g.etat === 'absent') tags += '<span class="gp-tag is-absent">pas venu</span>';
    if ((g.cases.get('laser') || []).some(function (e) { return e.aPlacer; })) tags += '<span class="gp-tag is-valider">laser à placer</span>';
    return tags;
  }

  // LES NOTES D UN GROUPE, EN CLAIR : le mot du client (sans les traces du
  // moteur), les notes de l equipe, la note du client chez nous. Les memes
  // lectures que la fiche ; rien d autre ne s ecrit.
  function ghNotes(r) {
    var notes = [];
    var mot = typeof getReservationNoteText === 'function' ? getReservationNoteText(r) : '';
    if (mot) notes.push({ qui: typeof getReservationNoteTitre === 'function' ? getReservationNoteTitre(r) : 'Note', texte: mot });
    if (typeof getReservationNotesEquipe === 'function') getReservationNotesEquipe(r).forEach(function (n) { if (n && n.t) notes.push({ qui: 'Équipe', texte: n.t }); });
    var client = window.PinlaneStaffNotes && typeof window.PinlaneStaffNotes.text === 'function' ? window.PinlaneStaffNotes.text(r) : '';
    if (client) notes.push({ qui: 'Client', texte: client });
    return notes;
  }
  var GH_STATUTS = { conf: 'Confirmé', arr: 'Arrivé', paid: 'Payé', absent: 'Pas venu' };
  var GH_ETATS_COURTS = { fini: 'fini', encours: 'en cours', avenir: 'à venir', retard: 'en retard' };

  function ghCarte(s, m, plage) {
    var g = s.g, e = s.e, r = g.r;
    var etat = ghEtat(s, m);
    var debutVu = Math.max(s.start, plage.vDebut);
    var haut = debutVu - plage.vDebut;
    var duree = s.finDessinee - debutVu;
    var detail = ghDetail(s);
    var infos = s.premiere ? ghInfos(g) : [];
    var det = [detail].concat(infos).filter(Boolean).join(' · ');
    // Les pictos des cartes bowling (la note a lire, l anniversaire) suivent le
    // nom sur la carte qui porte les infos du groupe ; le laser a sa colonne.
    var pictos = s.premiere && typeof renderCardFlags === 'function' ? renderCardFlags(r, { partiesEcrites: true }) : '';
    s.pictos = pictos;
    var tags = s.premiere ? ghTags(g, m) : '';
    s.tags = tags;
    var heure = (s.start < plage.vDebut - 1e-6 ? 'depuis ' : e.libre ? '≈ ' : '') + gpHeure(s.start);
    var notes = s.premiere ? ghNotes(r).map(function (n) { return n.texte; }) : [];
    var titre = r.name + ' · ' + r.pax + ' pers. · ' + gpNomActivite(e.activityId) + ' · ' + (e.libre ? 'sans heure fixe, vers ' : '') + gpHeure(s.start) + ' à ' + gpHeure(s.end)
      + (detail ? ' · ' + detail : '') + ' · ' + GH_ETATS[etat] + (infos.length ? ' · ' + infos.join(' · ') : '') + (notes.length ? ' · ' + notes.join(' · ') : '');
    var classes = 'gh-c t-' + g.teinte + ' is-' + etat + (e.libre ? ' is-libre' : '') + (g.etat === 'absent' ? ' is-absent' : '') + (s.premiere ? ' is-premiere' : '');
    // (data-gh-k : la meme carte d un dessin a l autre, pour lui rendre le focus)
    return '<div class="' + classes + '" role="button" tabindex="0" data-gp-res="' + gpEsc(g.id) + '" data-gp-ouvre="' + Number(r.id) + '" data-gh-s="' + s.n + '" data-gh-k="' + gpEsc(g.id + '|' + s.cle + '|' + Math.round(s.start * 60)) + '"'
      + ' style="top:calc(var(--gh-h) * ' + haut + ' + 1px);height:calc(var(--gh-h) * ' + duree + ' - 2px);left:calc(100% * ' + s.voie + ' / ' + s.k + ' + var(--gh-jeu));width:calc(100% / ' + s.k + ' - var(--gh-jeu) * 2)"'
      + ' data-gh-duree="' + duree + '" data-gh-det="' + (det ? 1 : 0) + '">'
      + '<div class="gh-c__l1"><b class="gh-c__h">' + gpEsc(heure) + '</b> <span class="gh-c__nom">' + gpEsc(r.name) + '</span>' + (pictos ? ' <span class="gh-pictos">' + pictos + '</span>' : '') + (tags ? ' <span class="gp-tags">' + tags + '</span>' : '') + '</div>'
      + (det ? '<div class="gh-c__det"><span class="gh-c__det-t">' + gpEsc(det) + '</span></div>' : '')
      // Ce que la carte tait (la bulle le montre a la souris), pour un lecteur d ecran.
      + '<span class="gh-lu">' + gpEsc(titre) + '</span>'
      + '</div>';
  }

  // LA PLAGE DE LA JOURNEE : de l ouverture a la fermeture du centre, toujours
  // (2026-10-19, Movsar : « toutes les heures ... visibles même quand il n'y a
  // rien »), comme les plannings bowling et laser. Un jour ferme garde la grille
  // de getPlanningWindow (10 h - 22 h). Une seance hors des heures (un dossier
  // garde sur un jour ferme, une fin apres la fermeture) et l heure qu il est
  // l elargissent. Rien ne se replie : la grille defile en elle-meme et
  // s ouvre sur l heure qu il est.
  function ghPlage(m, seances) {
    var fenetre = m.fenetre || { open: 10, close: 22 };
    var ouvre = Number(fenetre.open), ferme = Number(fenetre.close);
    if (!Number.isFinite(ouvre)) ouvre = 10;
    if (!Number.isFinite(ferme) || ferme <= ouvre) ferme = ouvre + 12;
    var de = ouvre, a = ferme;
    seances.forEach(function (s) { de = Math.min(de, s.start); a = Math.max(a, s.finDessinee); });
    if (m.maintenant != null && m.maintenant >= de - 1 && m.maintenant <= a + 1) { de = Math.min(de, m.maintenant); a = Math.max(a, m.maintenant); }
    var debut = Math.floor(de * 2 + 1e-6) / 2;
    var fin = Math.max(debut + 0.5, Math.ceil(a * 2 - 1e-6) / 2);
    return { debut: debut, fin: fin, vDebut: debut, ferme: Boolean(fenetre.closed) };
  }

  // LES CASES VIDES QUI RESERVENT : le bowling et le laser, par les chemins de
  // leurs plannings (quickFromCell, lpReserver). Les autres activites n ont pas
  // de reservation rapide a leur nom. Un jour ferme, rien ne se reserve.
  var GH_RESERVE = { bowling: 'bowling', laser: 'laser' };
  function ghPeutReserver(m, cle) {
    if (!GH_RESERVE[cle] || (m.fenetre && m.fenetre.closed)) return false;
    if (typeof canUseStaffPermission === 'function' && !canUseStaffPermission('reservations.quick')) return false;
    return cle === 'bowling' ? typeof quickFromCell === 'function' : typeof lpReserver === 'function';
  }

  function renderGlobalPlanning(wrap) {
    if (!wrap) return;
    var bulleOuverte = wrap._ghB && wrap._ghB.vue ? { id: wrap._ghB.id, n: wrap._ghB.n } : null;
    var m = gpModele();
    var seances = ghSeances(m);
    // Le dessin : au moins une demi-heure par carte (une ligne lisible).
    seances.forEach(function (s, i) { s.finDessinee = Math.max(s.end, s.start + 0.5 - 1 / 120); s.n = i; s.premiere = false; });
    var plage = ghPlage(m, seances);
    // LES COLONNES : toutes les activites du centre, dans l ordre du papier,
    // vides comprises.
    var colonnes = m.colonnes.map(function (c) {
      var siennes = seances.filter(function (s) { return s.cle === c.cle; });
      return { c: c, seances: siennes, toutes: siennes };
    });
    colonnes.forEach(function (x) { ghVoies(x.seances, function (s) { return s.finDessinee; }); });
    // La carte qui porte les etiquettes et les infos d un groupe : une carte
    // qui vit encore (une carte finie ne les porte que si le groupe n a plus
    // que celles-la), puis celle qui a le plus de place (sa duree visible sur
    // sa part de colonne), la premiere a egalite.
    var meilleure = new Map();
    colonnes.forEach(function (x) {
      x.seances.forEach(function (s) {
        var place = (s.finDessinee - Math.max(s.start, plage.vDebut)) / Math.max(1, s.k);
        var vive = ghEtat(s, m) !== 'fini';
        var deja = meilleure.get(s.g);
        // (une demi-heure dessinee vaut une demi-heure : 1/120 h de tolerance)
        var mieux = !deja || (vive && !deja.vive) || (vive === deja.vive && (place > deja.place + 0.02 || (Math.abs(place - deja.place) <= 0.02 && s.start < deja.s.start)));
        if (mieux) meilleure.set(s.g, { s: s, place: place, vive: vive });
      });
    });
    meilleure.forEach(function (x) { x.s.premiere = true; });
    var heures = plage.fin - plage.vDebut;
    var grand = Boolean(wrap.closest && wrap.closest('.planning-box.expanded'));
    var colH = grand ? GH.colHeuresGrand : GH.colHeures;
    // LA COLONNE DES HEURES : chaque demi-heure son etiquette, centree dans sa
    // case comme au bowling ; l heure pleine en clair, la demi-heure discrete.
    var etiquettes = '';
    for (var t = plage.vDebut; t < plage.fin - 1e-6; t += 0.5) {
      var pleine = Math.abs(t - Math.round(t)) < 1e-6;
      etiquettes += '<div class="gh-h' + (pleine ? ' is-pleine' : '') + '" data-gh-t="' + t + '" style="top:calc(var(--gh-h) * ' + (t - plage.vDebut) + ')">' + gpHeure(t) + '</div>';
    }
    var tetes = '<div class="gh-entete gh-entete--h" role="columnheader">Heure</div>' + colonnes.map(function (x) {
      var groupes = new Set(x.toutes.map(function (s) { return s.g; })).size;
      return '<div class="gh-entete' + (groupes ? '' : ' is-vide') + '" role="columnheader" data-gh-cle="' + gpEsc(x.c.cle) + '" title="' + gpEsc(x.c.titre + ' : ' + (groupes ? groupes + ' groupe' + (groupes > 1 ? 's' : '') : 'aucun groupe') + ' ce jour-là') + '">' + ghIcone(x.c.activites[0]) + '<span class="gh-entete__t">' + gpEsc(x.c.titre) + '</span><span class="gh-entete__n">' + groupes + '</span></div>';
    }).join('');
    // L HEURE QU IL EST n est pas dans le dessin : ghHorloge la pose (et la
    // deplace chaque minute) sur la colonne des heures et la grille.
    var piles = '<div class="gh-pile gh-pile--h" aria-hidden="true">' + etiquettes + '<span class="gh-maintenant-h" hidden></span></div>'
      + colonnes.map(function (x) {
        var reserve = ghPeutReserver(m, x.c.cle);
        return '<div class="gh-pile' + (x.seances.length ? '' : ' is-vide') + (reserve ? ' is-reserve' : '') + '" role="cell" aria-label="' + gpEsc(x.c.titre + (x.seances.length ? '' : ', aucun groupe')) + '" data-gh-cle="' + gpEsc(x.c.cle) + '">' + x.seances.map(function (s) { return ghCarte(s, m, plage); }).join('') + '</div>';
      }).join('');
    // UN JOUR FERME OU SANS RESERVATION GARDE SA GRILLE : un bandeau le dit au-dessus.
    var bandeau = m.fenetre && m.fenetre.closed
      ? '<div class="gh-bandeau is-ferme" role="status">Centre fermé ce jour-là' + (seances.length ? ' · réservations existantes à contrôler' : '') + '</div>'
      : !seances.length ? '<div class="gh-bandeau" role="status">Aucune réservation ce jour-là</div>' : '';
    var html = '<div class="gp gh' + (plage.ferme ? ' is-ferme' : '') + '" style="--gh-h:48px;--gh-n:' + heures + ';--gh-col-h:' + colH + 'px;--gh-decal:' + (plage.vDebut % 1 ? 0.5 : 0) + ';--gh-now:0">'
      + bandeau
      + '<div class="gh-grille" role="table" aria-label="Planning de toutes les activités du ' + gpEsc(m.jour) + '" style="grid-template-columns:' + colH + 'px repeat(' + colonnes.length + ', minmax(0, 1fr))">'
      + tetes + piles
      + '<i class="gh-maintenant" aria-hidden="true" hidden></i>'
      + '</div></div>';
    wrap._ghPlage = plage;
    wrap._ghColonnes = colonnes;
    wrap._ghModele = m;
    wrap._ghSeances = seances;
    // UN DESSIN IDENTIQUE NE SE REFAIT PAS : la console redessine a chaque
    // sondage et a chaque minute ; la grille ne se reconstruit que si elle
    // change (une carte qui finit, un groupe qui arrive) ou si sa largeur
    // change. L heure qu il est et les minutes de retard ne sont pas dans le
    // dessin (ghHorloge les pose) : le survol, la bulle, la recherche, le
    // focus et le defilement restent.
    var cle = html.replace(/<span class="gh-min">(\d+)<\/span>/g, function (x, n) { return '<span class="gh-min">' + n.replace(/\d/g, '#') + '</span>'; });
    var largeur = wrap.clientWidth || 0;
    if (cle === wrap._ghHtml && wrap.querySelector('.gh') && Math.abs(largeur - (wrap._gpLargeur || 0)) <= 2) {
      ghHorloge(wrap);
      gpChercher(wrap, String(state.searchTerm || '').toLowerCase().trim());
      return;
    }
    // Ce qu on regardait se garde d un dessin a l autre : la position de la
    // grille (le meme jour) et la carte qui avait le focus.
    var ancienne = wrap.querySelector('.gh-grille');
    var memeJour = wrap._ghJourDessine === m.jour;
    var defilement = ancienne && memeJour ? { y: ancienne.scrollTop, x: ancienne.scrollLeft } : null;
    var actif = document.activeElement;
    var focus = actif && wrap.contains(actif) && actif.getAttribute ? actif.getAttribute('data-gh-k') : null;
    wrap._ghHtml = cle;
    wrap.innerHTML = html;
    wrap._gpLargeur = largeur;
    wrap._ghColH = colH;
    wrap._ghJourDessine = m.jour;
    var racine = wrap.querySelector('.gh');
    ghHauteur(wrap);
    ghLargeurs(wrap);
    ghAjusterCartes(racine);
    ghCorriger(wrap);
    ghHorloge(wrap);
    var nouvelle = racine.querySelector('.gh-grille');
    if (defilement && nouvelle && (defilement.y || defilement.x)) {
      wrap._ghRestaure = true;
      nouvelle.scrollTop = defilement.y;
      nouvelle.scrollLeft = defilement.x;
      setTimeout(function () { wrap._ghRestaure = false; }, 120);
    } else if (!defilement && nouvelle) {
      // (apres coup : la console rend ensuite a chaque boite qui defile la
      // position qu elle avait avant le dessin, celle de l autre jour)
      setTimeout(function () { if (nouvelle.isConnected) ghOuvrirSurMaintenant(wrap); }, 0);
    }
    if (focus) {
      var revient = Array.from(wrap.querySelectorAll('[data-gh-k]')).find(function (c) { return c.getAttribute('data-gh-k') === focus; });
      if (revient) revient.focus({ preventScroll: true });
    }
    if (document.fonts && document.fonts.status !== 'loaded') {
      document.fonts.ready.then(function () { if (racine.isConnected) { ghLargeurs(wrap); ghAjusterCartes(racine); ghCorriger(wrap); ghHorloge(wrap); } });
    }
    var q = String(state.searchTerm || '').toLowerCase().trim();
    if (q) gpChercher(wrap, q);
    ghBrancher(wrap);
    // Une bulle ouverte suit le nouveau dessin (la console redessine en
    // continu) : meme groupe, meme activite si elle existe encore.
    if (bulleOuverte) {
      var cartesB = Array.from(wrap.querySelectorAll('.gh-c')).filter(function (c) { return c.getAttribute('data-gp-res') === bulleOuverte.id; });
      var carteB = cartesB.find(function (c) { return c.getAttribute('data-gh-s') === String(bulleOuverte.n); }) || cartesB[0];
      if (carteB) ghMontrerBulle(wrap, carteB, true); else ghCacherBulle(wrap, true);
    }
  }

  // L HEURE QU IL EST, SANS REDESSINER : la barre et son etiquette se posent
  // par une variable (--gh-now), l etiquette d heure qu elle recouvre
  // s efface, les minutes de retard se recomptent. Rien d autre ne bouge.
  function ghHorloge(wrap) {
    var racine = wrap.querySelector('.gh');
    var m = wrap._ghModele, plage = wrap._ghPlage;
    if (!racine || !m || !plage) return;
    var maintenant = null;
    if (m.maintenant != null) {
      var jourNuit = m.jour !== todayStr();
      maintenant = jourNuit ? 24 + currentTimeDecimal() : currentTimeDecimal();
    }
    var vu = maintenant != null && maintenant >= plage.vDebut && maintenant <= plage.fin;
    var barre = racine.querySelector('.gh-maintenant');
    var etiquette = racine.querySelector('.gh-maintenant-h');
    if (barre) barre.hidden = !vu;
    if (etiquette) { etiquette.hidden = !vu; if (vu) etiquette.textContent = gpHeure(maintenant); }
    if (vu) racine.style.setProperty('--gh-now', String(maintenant - plage.vDebut));
    racine.querySelectorAll('.gh-h').forEach(function (h) {
      var t = Number(h.getAttribute('data-gh-t'));
      h.classList.toggle('is-sous', vu && Math.abs(t + 0.25 - maintenant) < 0.2);
    });
    if (maintenant != null) {
      racine.querySelectorAll('[data-gh-depuis] .gh-min').forEach(function (n) {
        var texte = String(ghMinutesDeRetard(Number(n.parentNode.getAttribute('data-gh-depuis')), maintenant));
        if (n.textContent !== texte) n.textContent = texte;
      });
    }
    wrap._ghMaintenant = maintenant;
  }

  // UN NOUVEAU JOUR S OUVRE SUR CE QUI COMPTE : l heure qu il est (une heure
  // de deja joue au-dessus), sinon la premiere activite, sinon l ouverture.
  function ghOuvrirSurMaintenant(wrap) {
    var racine = wrap.querySelector('.gh');
    var grille = racine && racine.querySelector('.gh-grille');
    var plage = wrap._ghPlage;
    if (!grille || !plage || grille.scrollHeight <= grille.clientHeight + 1) return;
    var hh = parseFloat(getComputedStyle(racine).getPropertyValue('--gh-h')) || 48;
    var seances = wrap._ghSeances || [];
    var cible = wrap._ghMaintenant != null ? wrap._ghMaintenant - 1
      : seances.length ? Math.min.apply(null, seances.map(function (s) { return s.start; })) - 0.5 : plage.vDebut;
    wrap._ghRestaure = true;
    grille.scrollTop = Math.max(0, Math.round((cible - plage.vDebut) * hh));
    setTimeout(function () { wrap._ghRestaure = false; }, 120);
  }

  // LA HAUTEUR D UNE HEURE se calcule sur l ecran : la journee entiere tient
  // de la tete des colonnes au bas de la page quand elle le peut. La grille
  // est toujours sa propre fenetre (les heures et les tetes y restent
  // collees) : trop courte meme au plancher, elle defile en elle-meme a une
  // hauteur confortable et « Agrandir » se met en avant.
  function ghHauteur(wrap) {
    var racine = wrap.querySelector('.gh');
    var grille = racine && racine.querySelector('.gh-grille');
    if (!grille) return;
    racine.classList.remove('is-defile');
    // (la fenetre de la grille n est pas retiree pendant la mesure : sans
    // elle, la grille revenait en haut a chaque changement de taille)
    var boite = wrap.closest('.planning-box') || wrap;
    var fixe = getComputedStyle(boite).position === 'fixed';
    var heures = Math.max(0.5, Number(getComputedStyle(racine).getPropertyValue('--gh-n')) || 1);
    var haut = grille.getBoundingClientRect().top + (fixe ? 0 : window.scrollY);
    var dispo = Math.floor(window.innerHeight - haut - (fixe ? 10 : GH.bas) - GH.tete - 2);
    var hh = Math.floor(dispo / heures);
    wrap._ghDispoH = dispo;
    grille.style.maxHeight = Math.max(GH.tete + GH.heureMin * 3, dispo + GH.tete) + 'px';
    if (hh < GH.heureMin) {
      hh = GH.heureConfort;
      racine.classList.add('is-defile');
    }
    racine.style.setProperty('--gh-h', Math.min(GH.heureMax, hh) + 'px');
  }

  // LA LARGEUR DES COLONNES SE CALCULE SUR LES NOMS A ECRIRE. Chaque carte a
  // ses lignes (sa hauteur) ; son nom entier, son heure et ses pistes y
  // tiennent a une largeur qu on mesure (le texte, pas la boite) ; une
  // colonne prend la largeur de sa carte la plus exigeante, multipliee par ses
  // voies. Le reste de l ecran se partage. Trop etroit pour tout : chacune a sa
  // part, et les cartes laissent tomber d abord leurs pistes, puis l heure.
  // LES MESURES D UNE CARTE, LUES SUR LA FEUILLE DE STYLE : la hauteur d une
  // ligne, ce que prennent ses bords et ses marges en haut et en bas (le
  // « cadre »), et sur les cotes (la « marge », l ecart a sa voie compris).
  function ghGabarit(carte) {
    var cs = getComputedStyle(carte);
    var l1 = carte.querySelector('.gh-c__l1');
    var px = function (v) { return parseFloat(v) || 0; };
    return {
      ligne: px(getComputedStyle(l1).lineHeight) || GH.ligne,
      cadre: px(cs.borderTopWidth) + px(cs.borderBottomWidth) + px(cs.paddingTop) + px(cs.paddingBottom),
      marge: px(cs.borderLeftWidth) + px(cs.borderRightWidth) + px(cs.paddingLeft) + px(cs.paddingRight) + 2 * px(cs.getPropertyValue('--gh-jeu')),
    };
  }
  // (un vingtieme de ligne de tolerance : a 1,997 ligne, la deuxieme tient)
  function ghLignes(duree, hh, gab) { return Math.max(1, Math.floor((duree * hh - 2 - gab.cadre) / gab.ligne + 0.05)); }

  // Les largeurs de textes, mesurees d un coup dans une carte cachee qui a
  // les classes d une carte vive (meme police, meme graisse).
  function ghMesurerTextes(grille, modele, textes) {
    var boite = document.createElement('div');
    boite.className = modele.className.replace(/\bis-(fini|groupe|terne)\b/g, '');
    boite.setAttribute('aria-hidden', 'true');
    boite.style.cssText = 'position:absolute;left:-10000px;top:0;width:auto;height:auto;visibility:hidden;';
    var l1 = document.createElement('div');
    l1.className = 'gh-c__l1';
    l1.style.cssText = 'display:block;-webkit-line-clamp:none;white-space:nowrap;';
    var spans = textes.map(function (x) {
      var s = document.createElement('span');
      if (x.genre === 'tags' || x.genre === 'pictos') { s.className = x.genre === 'tags' ? 'gp-tags' : 'gh-pictos'; s.innerHTML = x.texte; }
      else { s.className = x.genre === 'heure' ? 'gh-c__h' : 'gh-c__nom'; s.textContent = x.texte; }
      l1.appendChild(s);
      l1.appendChild(document.createElement('br'));
      return s;
    });
    boite.appendChild(l1);
    grille.appendChild(boite);
    var largeurs = new Map();
    spans.forEach(function (s, i) { largeurs.set(textes[i].genre + '|' + textes[i].texte, s.getBoundingClientRect().width); });
    grille.removeChild(boite);
    return largeurs;
  }

  // La plus petite largeur ou une suite de mots tient en `lignes` lignes
  // (decoupage dans l ordre, la plus longue ligne la plus courte possible).
  function ghLargeurEnLignes(mots, espace, lignes) {
    var n = mots.length;
    if (!n) return 0;
    if (lignes >= n) return Math.max.apply(null, mots);
    var ligne = function (i, j) { var s = 0; for (var k = i; k < j; k += 1) s += mots[k]; return s + espace * (j - i - 1); };
    // meilleur[l][i] : la plus longue ligne du meilleur decoupage des mots i.. en l lignes.
    var memo = {};
    var meilleur = function (l, i) {
      var cle = l + ':' + i;
      if (memo[cle] != null) return memo[cle];
      var r;
      if (l === 1) r = ligne(i, n);
      else {
        r = Infinity;
        for (var j = i + 1; j <= n - (l - 1); j += 1) r = Math.min(r, Math.max(ligne(i, j), meilleur(l - 1, j)));
        if (n - i <= l - 1) r = Math.min(r, meilleur(n - i, i));
      }
      memo[cle] = r;
      return r;
    };
    return meilleur(Math.min(lignes, n), 0);
  }

  function ghMesurerColonnes(wrap, grille, hh) {
    var colonnes = wrap._ghColonnes || [];
    // Le gabarit se lit sur une carte qui n est pas finie : une carte finie
    // ecrit son nom plus maigre, donc plus etroit que les autres.
    var vive = grille.querySelector('.gh-c:not(.is-fini)') || grille.querySelector('.gh-c');
    // Une journee sans carte : chaque colonne prend la largeur de sa tete.
    if (!vive) return colonnes.map(function (x, i) { var l = ghLargeurTete(grille, i); return { essentiel: l, confort: l }; });
    var gab = ghGabarit(vive);
    var vDebut = wrap._ghPlage.vDebut;
    var etiquette = function (s) { return (s.start < vDebut ? 'depuis ' : s.e.libre ? '≈ ' : '') + gpHeure(s.start); };
    var aMesurer = new Map();
    var ajouter = function (genre, texte) { aMesurer.set(genre + '|' + texte, { genre: genre, texte: texte }); };
    colonnes.forEach(function (x) {
      x.seances.forEach(function (s) {
        ajouter('nom', s.g.r.name);
        String(s.g.r.name).split(/\s+/).forEach(function (w) { ajouter('nom', w); });
        ajouter('heure', etiquette(s));
        if (s.pictos) ajouter('pictos', s.pictos);
        if (s.tags) ajouter('tags', s.tags);
      });
    });
    ajouter('nom', 'x x');
    ajouter('nom', 'xx');
    var mesures = ghMesurerTextes(grille, vive, Array.from(aMesurer.values()));
    var largeur = function (genre, texte) { return mesures.get(genre + '|' + texte) || 0; };
    var espace = Math.max(0, largeur('nom', 'x x') - largeur('nom', 'xx'));
    return colonnes.map(function (x, i) {
      var confort = 0, essentiel = 0;
      x.seances.forEach(function (s) {
        var lignes = ghLignes(s.finDessinee - Math.max(s.start, vDebut), hh, gab);
        var nom = largeur('nom', s.g.r.name) + 0.5;
        var heure = largeur('heure', etiquette(s)) + 5;
        var motLong = Math.max.apply(null, String(s.g.r.name).split(/\s+/).map(function (w) { return largeur('nom', w); })) + 0.5;
        var det = ghDetail(s) ? 1 : 0;
        var lignesNom = Math.max(1, Math.min(3, lignes - (lignes >= 2 && det ? 1 : 0)));
        // L essentiel : le nom entier tient dans les lignes de la carte, ses
        // etiquettes a sa suite, chacune d un bloc (les pistes et l heure
        // tombent d abord).
        var mots = String(s.g.r.name).split(/\s+/).filter(Boolean).map(function (w) { return largeur('nom', w); });
        var pictosL = s.pictos ? largeur('pictos', s.pictos) + 0.5 : 0;
        var tagsL = s.tags ? largeur('tags', s.tags) + 0.5 : 0;
        if (pictosL) mots.push(pictosL);
        if (tagsL) mots.push(tagsL);
        var suite = (pictosL ? espace + pictosL : 0) + (tagsL ? espace + tagsL : 0);
        var e = lignes === 1 ? nom + suite : ghLargeurEnLignes(mots, espace, lignes) + 0.5;
        // Le confort : l heure devant, le nom sur ses lignes.
        var b = lignesNom === 1 ? heure + nom + suite : Math.max((heure + nom + suite) / lignesNom * 1.18, motLong + heure, tagsL, pictosL);
        essentiel = Math.max(essentiel, (e + gab.marge) * s.k);
        confort = Math.max(confort, (b + gab.marge) * s.k);
      });
      essentiel = Math.ceil(Math.max(essentiel, ghLargeurTete(grille, i)));
      return { essentiel: essentiel, confort: Math.max(essentiel, Math.ceil(confort)) };
    });
  }

  // La largeur ou la tete d une colonne s ecrit entiere (picto, nom, compte).
  function ghLargeurTete(grille, i) {
    var tete = grille.querySelectorAll('.gh-entete')[i + 1];
    var visibles = tete ? Array.from(tete.children).filter(function (el) { return getComputedStyle(el).display !== 'none'; }) : [];
    var teteMin = tete ? visibles.reduce(function (s, el) { return s + Math.max(el.scrollWidth || 0, el.getBoundingClientRect().width); }, 0) + parseFloat(getComputedStyle(tete).columnGap || 6) * Math.max(0, visibles.length - 1) + parseFloat(getComputedStyle(tete).paddingLeft) * 2 + 2 : 0;
    return Math.ceil(Math.max(GH.colMin, teteMin));
  }

  function ghLargeurs(wrap) {
    var racine = wrap.querySelector('.gh');
    var grille = racine && racine.querySelector('.gh-grille');
    var colonnes = wrap._ghColonnes || [];
    if (!grille || !colonnes.length) return;
    var hh = parseFloat(getComputedStyle(racine).getPropertyValue('--gh-h')) || 48;
    var colH = wrap._ghColH || GH.colHeures;
    racine.style.setProperty('--gh-col-h', colH + 'px');
    var dispo = grille.clientWidth - colH;
    var somme = function (mesures, cle) { return mesures.reduce(function (a, x) { return a + x[cle]; }, 0); };
    // L ECRITURE SERREE, en deux crans, quand l essentiel ne tient pas.
    racine.classList.remove('is-compact', 'is-compact-2');
    var mesures = ghMesurerColonnes(wrap, grille, hh);
    ['is-compact', 'is-compact-2'].some(function (cran) {
      if (somme(mesures, 'essentiel') <= dispo) return true;
      racine.classList.add(cran);
      // Le second cran resserre aussi la colonne des heures.
      if (cran === 'is-compact-2') { colH = Math.min(colH, 46); racine.style.setProperty('--gh-col-h', colH + 'px'); }
      dispo = grille.clientWidth - colH;
      mesures = ghMesurerColonnes(wrap, grille, hh);
      return false;
    });
    // ENCORE TROP ETROIT : les cartes grandissent (plus de lignes, un nom qui
    // passe a la ligne entre ses mots) ; si la journee ne tient plus en
    // hauteur, la grille defile en elle-meme et « Agrandir » se met en avant.
    // Mieux vaut faire defiler que couper un nom.
    while (somme(mesures, 'essentiel') > dispo && hh < GH.heureMax) {
      var avant = somme(mesures, 'essentiel');
      var hhAvant = hh;
      hh = Math.min(GH.heureMax, hh + 8);
      racine.style.setProperty('--gh-h', hh + 'px');
      var essai = ghMesurerColonnes(wrap, grille, hh);
      if (somme(essai, 'essentiel') >= avant - 0.5) {
        // Plus de lignes ne fait plus de place : on revient au cran d avant.
        hh = hhAvant;
        racine.style.setProperty('--gh-h', hh + 'px');
        break;
      }
      mesures = essai;
    }
    var heures = Math.max(0.5, Number(getComputedStyle(racine).getPropertyValue('--gh-n')) || 1);
    if (wrap._ghDispoH && hh * heures > wrap._ghDispoH + 1 && !racine.classList.contains('is-defile')) {
      racine.classList.add('is-defile');
      grille.style.maxHeight = (wrap._ghDispoH + GH.tete) + 'px';
    }
    var sConfort = somme(mesures, 'confort'), sEssentiel = somme(mesures, 'essentiel');
    var largeurs;
    if (sConfort <= dispo) {
      largeurs = mesures.map(function (x) { return Math.floor(x.confort + (dispo - sConfort) / mesures.length); });
    } else if (sEssentiel <= dispo) {
      var marges = sConfort - sEssentiel;
      largeurs = mesures.map(function (x) { return Math.floor(x.essentiel + (dispo - sEssentiel) * (marges ? (x.confort - x.essentiel) / marges : 1 / mesures.length)); });
    } else {
      // Le dernier recours : chaque colonne a sa largeur essentielle et la
      // grille defile de cote. Un nom ne se coupe jamais.
      largeurs = mesures.map(function (x) { return x.essentiel; });
    }
    racine.classList.toggle('is-serre', sConfort > dispo);
    racine.classList.toggle('is-trop-serre', sEssentiel > dispo);
    grille.style.gridTemplateColumns = colH + 'px ' + largeurs.map(function (l) { return l + 'px'; }).join(' ');
    var boite = wrap.closest('.planning-box') || wrap;
    boite.classList.toggle('gp-a-agrandir', racine.classList.contains('is-defile') || racine.classList.contains('is-trop-serre'));
  }

  // CE QU UNE CARTE ECRIT, SELON SA HAUTEUR ET SA LARGEUR : ses lignes, le nom
  // d abord (jamais coupe tant qu il a la place), ses pistes et infos sur sa
  // derniere ligne si elle en a deux ; trop serre, les pistes tombent, puis
  // l heure. Une lecture de toutes les cartes, puis une ecriture, deux fois.
  function ghAjusterCartes(racine) {
    if (!racine) return;
    var hh = parseFloat(getComputedStyle(racine).getPropertyValue('--gh-h')) || 48;
    var cartes = Array.from(racine.querySelectorAll('.gh-c'));
    if (!cartes.length) return;
    var gab = ghGabarit(cartes[0]);
    cartes.forEach(function (c) {
      c.classList.remove('sans-det', 'sans-heure');
      var lignes = ghLignes(Number(c.getAttribute('data-gh-duree')), hh, gab);
      var aDet = c.getAttribute('data-gh-det') === '1' || Boolean(c.querySelector('.gh-c__note'));
      c.setAttribute('data-l', String(lignes));
      c.style.setProperty('--gh-nl', String(Math.max(1, lignes - (aDet && lignes >= 2 ? 1 : 0))));
      if (lignes < 2) c.classList.add('sans-det');
    });
    var deborde = function (c) { var t = c.querySelector('.gh-c__l1'); return t.scrollHeight > t.clientHeight + 1 || t.scrollWidth > t.clientWidth + 1; };
    var premiers = cartes.filter(deborde);
    premiers.forEach(function (c) {
      if (!c.classList.contains('sans-det') && c.querySelector('.gh-c__det')) {
        c.classList.add('sans-det');
        c.style.setProperty('--gh-nl', c.getAttribute('data-l'));
      } else {
        c.classList.add('sans-heure');
      }
    });
    premiers.filter(deborde).forEach(function (c) { c.classList.add('sans-heure'); });
  }

  // LE PLANNING TIENT DANS LE PREMIER ECRAN : si quelques pixels de sa boite
  // depassent encore (une marge de la console), l heure perd ce qu il faut.
  // C est la boite qui se mesure, en coordonnees de page, pas la page : la
  // liste du jour vit dessous (comme sous le planning bowling) et la page,
  // elle, defile.
  function ghCorriger(wrap) {
    var racine = wrap.querySelector('.gh');
    if (!racine) return;
    var boite = wrap.closest('.planning-box') || wrap;
    var fixe = getComputedStyle(boite).position === 'fixed';
    var grille = racine.querySelector('.gh-grille');
    if (!grille) return;
    var deborde = fixe
      ? Math.ceil(grille.getBoundingClientRect().bottom + 10 - window.innerHeight)
      : Math.ceil(boite.getBoundingClientRect().bottom + window.scrollY + GH.bas - window.innerHeight);
    if (deborde <= 0) return;
    if (racine.classList.contains('is-defile')) {
      // La grille defile deja : sa fenetre se raccourcit du depassement.
      var fenetre = parseFloat(grille.style.maxHeight) || grille.clientHeight;
      grille.style.maxHeight = Math.max(GH.tete + GH.heureMin * 3, Math.floor(fenetre - deborde)) + 'px';
      return;
    }
    var heures = Math.max(0.5, Number(getComputedStyle(racine).getPropertyValue('--gh-n')) || 1);
    var hh = parseFloat(getComputedStyle(racine).getPropertyValue('--gh-h')) || 48;
    var nouveau = Math.floor(hh - deborde / heures - 0.01);
    if (nouveau >= GH.heureMin) {
      // Les largeurs dependent des lignes de chaque carte : elles se refont.
      racine.style.setProperty('--gh-h', nouveau + 'px');
      ghLargeurs(wrap);
      ghAjusterCartes(racine);
    }
  }

  function gpChercher(wrap, q) {
    var racine = wrap.querySelector('.gp');
    if (!racine) return;
    var mots = String(q || '').toLowerCase().trim();
    racine.classList.toggle('is-recherche', Boolean(mots));
    racine.querySelectorAll('.gh-c').forEach(function (c) {
      var nom = c.querySelector('.gh-c__nom');
      var texte = (nom ? nom.textContent : '').toLowerCase();
      c.classList.toggle('is-terne', Boolean(mots) && texte.indexOf(mots) < 0);
    });
  }

  // SURVOLER UNE CARTE ALLUME LE PROGRAMME DU GROUPE : ses autres activites,
  // dans les autres colonnes. Sortir de la carte rend tout.
  function ghGroupe(wrap, id) {
    var racine = wrap.querySelector('.gh');
    if (!racine) return;
    racine.classList.toggle('a-groupe', Boolean(id));
    racine.querySelectorAll('.gh-c').forEach(function (c) { c.classList.toggle('is-groupe', Boolean(id) && c.getAttribute('data-gp-res') === id); });
  }

  // LA BULLE D UN GROUPE, AU SURVOL A LA SOURIS (2026-10-12, Movsar : « des
  // petites aides »). Tout le programme du groupe d un coup d oeil : chaque
  // activite dans l ordre (le matin replie compris), son heure, sa place,
  // ce qui est fini ; ce qu il a pris en plus ; ses notes en clair. Et les
  // gestes du comptoir : la fiche ; « Arrivé » quand il arrive (la regle de
  // la vue Terrain : le jour meme, jamais sur un dossier deja paye) ; son
  // numero quand il est en retard. Au doigt, toucher la carte ouvre la
  // fiche, qui dit tout cela. La bulle est un raccourci de souris : tout ce
  // qu elle montre et fait est dans la fiche (clavier, lecteur d ecran).
  function ghBulleHtml(wrap, id, ici) {
    var m = wrap._ghModele;
    var g = m && m.groupes.find(function (x) { return x.id === id; });
    if (!g) return '';
    var r = g.r;
    var sous = [typeof getReservationOccasionLabel === 'function' ? getReservationOccasionLabel(r) : '', (Number(r.pax) || 0) + ' pers.', g.formule ? g.formule.long : ''].filter(Boolean);
    var alertes = '';
    if (g.retard && m.maintenant != null) {
      var tel = String(r.phone || '').trim();
      alertes += '<div class="gh-b__alerte is-retard">En retard de ' + Math.max(1, Math.round((m.maintenant - g.span.start) * 60)) + ' min'
        + (tel ? '<a class="gh-b__tel" tabindex="-1" href="tel:' + gpEsc(tel.replace(/[^0-9+]/g, '')) + '">Appeler ' + gpEsc(tel) + '</a>' : '') + '</div>';
    }
    if (typeof isReservationAwaitingReview === 'function' && isReservationAwaitingReview(r)) alertes += '<div class="gh-b__alerte is-valider">À valider par l’équipe</div>';
    if (g.etat === 'closing') alertes += '<div class="gh-b__alerte is-cloturer">À clôturer</div>';
    if (g.etat === 'absent') alertes += '<div class="gh-b__alerte is-absent">Pas venu</div>';
    var lignes = (wrap._ghSeances || []).filter(function (s) { return s.g === g; }).sort(function (a, b) { return a.start - b.start; }).map(function (s) {
      var etat = ghEtat(s, m);
      var quand = s.e.journee ? 'toute la visite' : s.e.libre ? '≈ ' + gpHeure(s.start) + ', sans heure fixe' : gpHeure(s.start) + ' à ' + gpHeure(s.end);
      var dans = etat === 'avenir' && m.maintenant != null && !s.e.libre ? Math.round((s.start - m.maintenant) * 60) : null;
      var mot = dans != null && dans > 0 && dans <= 60 ? 'dans ' + dans + ' min' : GH_ETATS_COURTS[etat];
      var detail = ghDetail(s);
      return '<li class="is-' + etat + (s === ici ? ' is-ici' : '') + '">' + ghIcone(s.e.activityId) + '<span class="gh-b__act">' + gpEsc(gpNomActivite(s.e.activityId))
        + '<span class="gh-b__quand">' + gpEsc(quand + (detail ? ' · ' + detail : '')) + '</span></span><span class="gh-b__etat is-' + etat + '">' + gpEsc(mot) + '</span></li>';
    });
    // Ce qui n a pas d heure : les credits d arcade, la partie de laser a placer.
    g.cases.forEach(function (liste) {
      liste.forEach(function (e) {
        if (e.credit) lignes.push('<li class="is-avenir">' + ghIcone('arcade_time') + '<span class="gh-b__act">' + gpEsc(gpNomActivite(e.activityId)) + '<span class="gh-b__quand">' + gpEsc(gpCredits(e.nom)) + '</span></span><span class="gh-b__etat"></span></li>');
        if (e.aPlacer) lignes.push('<li class="is-avenir">' + ghIcone('laser_game') + '<span class="gh-b__act">' + gpEsc(gpNomActivite('laser_game')) + '<span class="gh-b__quand">partie pas encore placée</span></span><span class="gh-b__etat is-retard">à placer</span></li>');
      });
    });
    var infos = g.infos.filter(Boolean);
    var notes = ghNotes(r);
    var peutArriver = m.aujourdHui && g.etat === 'upcoming' && r.status !== 'paid' && r.status !== 'arrived' && typeof setReservationStatusDirect === 'function';
    return '<div class="gh-b__tete"><b class="gh-b__nom">' + gpEsc(r.name) + '</b><span class="gh-b__statut t-' + g.teinte + '">' + gpEsc(GH_STATUTS[g.teinte] || GH_STATUTS.conf) + '</span></div>'
      + (sous.length ? '<div class="gh-b__sous">' + gpEsc(sous.join(' · ')) + '</div>' : '')
      + alertes
      + (lignes.length ? '<ol class="gh-b__prog">' + lignes.join('') + '</ol>' : '')
      + (infos.length ? '<div class="gh-b__infos">' + gpEsc(infos.join(' · ')) + '</div>' : '')
      + notes.map(function (n) { return '<div class="gh-b__note"><b>' + gpEsc(n.qui) + '</b> ' + gpEsc(n.texte) + '</div>'; }).join('')
      + '<div class="gh-b__gestes"><button type="button" tabindex="-1" data-gh-fiche="' + Number(r.id) + '">Ouvrir la fiche</button>'
      + (peutArriver ? '<button type="button" tabindex="-1" class="is-premier" data-gh-arrive="' + gpEsc(String(r.id)) + '">Arrivé</button>' : '') + '</div>';
  }

  // Une seule bulle dans le document : au-dessus du plein ecran du planning,
  // jamais rognee par la grille qui defile.
  function ghBulleEl() {
    var b = document.getElementById('ghBulle');
    if (b) return b;
    b = document.createElement('div');
    b.id = 'ghBulle';
    b.className = 'gh-bulle';
    b.setAttribute('aria-hidden', 'true');
    // Entrer dans la bulle la garde (et annule un changement de carte en route).
    b.addEventListener('pointerenter', function () { var e = b._ghWrap && b._ghWrap._ghB; if (e) { clearTimeout(e.minuteur); e.attendue = null; } });
    b.addEventListener('pointerleave', function (e) {
      // (au doigt, lever le doigt « sort » de la bulle : elle reste)
      if (e.pointerType !== 'mouse') return;
      var vers = e.relatedTarget;
      if (b._ghWrap && !(vers && vers.closest && vers.closest('.gh-c'))) ghCacherBulle(b._ghWrap);
    });
    b.addEventListener('click', function (e) {
      var w = b._ghWrap;
      if (!w || !e.target.closest) return;
      var fiche = e.target.closest('[data-gh-fiche]');
      var arrive = e.target.closest('[data-gh-arrive]');
      if (fiche) { ghCacherBulle(w, true); if (typeof openPos === 'function') openPos(Number(fiche.getAttribute('data-gh-fiche'))); return; }
      if (arrive) { ghCacherBulle(w, true); if (typeof setReservationStatusDirect === 'function') setReservationStatusDirect(arrive.getAttribute('data-gh-arrive'), 'arrived', e); return; }
      if (e.target.closest('a')) ghCacherBulle(w, true);
    });
    document.body.appendChild(b);
    return b;
  }

  // A cote de la carte (a droite, sinon a gauche, sinon dessous), jamais
  // dessus, toujours dans l ecran.
  function ghPlacerBulle(b, carte) {
    var r = carte.getBoundingClientRect();
    var l = b.offsetWidth, h = b.offsetHeight, marge = 8;
    var x = r.right + marge, y = r.top;
    if (x + l > window.innerWidth - marge) x = r.left - marge - l;
    if (x < marge) {
      x = Math.max(marge, Math.min(window.innerWidth - l - marge, r.left));
      y = r.bottom + marge + h <= window.innerHeight - marge ? r.bottom + marge : r.top - marge - h;
    }
    y = Math.max(marge, Math.min(window.innerHeight - h - marge, y));
    b.style.left = Math.round(x) + 'px';
    b.style.top = Math.round(y) + 'px';
  }

  // La premiere bulle attend un instant (un passage de souris n en ouvre
  // pas) ; d une carte a l autre, elle suit presque tout de suite : le
  // court delai laisse traverser une carte voisine pour entrer dans la bulle.
  function ghMontrerBulle(wrap, carte, tout) {
    var etat = wrap._ghB || (wrap._ghB = {});
    if (etat.vue && etat.carte === carte && !tout) { clearTimeout(etat.minuteur); etat.attendue = null; return; }
    if (etat.attendue === carte && !tout) return;
    clearTimeout(etat.minuteur);
    var ouvrir = function () {
      etat.attendue = null;
      if (!carte.isConnected) return;
      var b = ghBulleEl();
      var seance = (wrap._ghSeances || [])[Number(carte.getAttribute('data-gh-s'))];
      var html = ghBulleHtml(wrap, carte.getAttribute('data-gp-res'), seance);
      if (!html) return;
      b._ghWrap = wrap;
      b.innerHTML = html;
      b.classList.toggle('is-instant', Boolean(etat.vue));
      ghPlacerBulle(b, carte);
      b.classList.add('is-vue');
      etat.vue = true;
      etat.carte = carte;
      etat.id = carte.getAttribute('data-gp-res');
      etat.n = carte.getAttribute('data-gh-s');
      ghGroupe(wrap, etat.id);
    };
    if (tout) ouvrir();
    else { etat.attendue = carte; etat.minuteur = setTimeout(ouvrir, etat.vue ? 90 : 380); }
  }
  function ghCacherBulle(wrap, tout) {
    var etat = wrap._ghB || (wrap._ghB = {});
    clearTimeout(etat.minuteur);
    etat.attendue = null;
    var fermer = function () {
      var b = document.getElementById('ghBulle');
      if (b) b.classList.remove('is-vue');
      var avait = etat.vue;
      etat.vue = false;
      etat.carte = null;
      if (avait) ghGroupe(wrap, null);
    };
    if (tout) fermer(); else etat.minuteur = setTimeout(fermer, 200);
  }

  // La demi-heure sous le pointeur dans une colonne, si elle est libre (aucune
  // carte n y est posee).
  function ghHeureSous(wrap, pile, y) {
    var racine = wrap.querySelector('.gh');
    var plage = wrap._ghPlage;
    if (!racine || !plage) return null;
    var hh = parseFloat(getComputedStyle(racine).getPropertyValue('--gh-h')) || 48;
    var t = plage.vDebut + Math.floor((y - pile.getBoundingClientRect().top) / hh * 2) / 2;
    if (t < plage.vDebut || t >= plage.fin - 1e-6) return null;
    var cle = pile.getAttribute('data-gh-cle');
    var prise = (wrap._ghSeances || []).some(function (s) { return s.cle === cle && s.start < t + 0.5 - 1e-6 && s.finDessinee > t + 1e-6; });
    return prise ? null : t;
  }
  // Toucher une case vide du bowling ou du laser : la reservation rapide a
  // cette heure, par le chemin de son planning (une piste a choisir au
  // bowling, le depart au laser). Rien ne s ecrit ici.
  function ghReserverIci(wrap, e) {
    var pile = e.target.closest('.gh-pile.is-reserve');
    if (!pile) return;
    var t = ghHeureSous(wrap, pile, e.clientY);
    if (t == null) return;
    ghCacherBulle(wrap, true);
    if (pile.getAttribute('data-gh-cle') === 'laser') lpReserver(t);
    else quickFromCell(0, t);
  }

  function ghBrancher(wrap) {
    if (wrap._gpBranche) return;
    wrap._gpBranche = true;
    var survol = null;
    // La bulle ne vit qu avec une souris : au doigt, toucher ouvre la fiche.
    var souris = typeof window.matchMedia === 'function' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    wrap.addEventListener('pointerover', function (e) {
      if (e.pointerType === 'touch') return;
      var c = e.target.closest && e.target.closest('.gh-c');
      if (c && souris && e.pointerType === 'mouse') ghMontrerBulle(wrap, c);
      var id = c ? c.getAttribute('data-gp-res') : null;
      if (id === survol) return;
      survol = id;
      // Bulle ouverte : le programme allume est celui de la bulle (il change
      // avec elle).
      if (!(wrap._ghB && wrap._ghB.vue)) ghGroupe(wrap, id);
    });
    // Sortir d une carte vers rien (ni une carte, ni la bulle) : la bulle part.
    wrap.addEventListener('pointerout', function (e) {
      if (e.pointerType === 'touch' || !(e.target.closest && e.target.closest('.gh-c'))) return;
      var vers = e.relatedTarget;
      if (vers && vers.closest && (vers.closest('.gh-c') || vers.closest('#ghBulle'))) return;
      ghCacherBulle(wrap);
    });
    wrap.addEventListener('pointerleave', function (e) {
      survol = null;
      var vers = e.relatedTarget;
      if (vers && vers.closest && vers.closest('#ghBulle')) return;
      if (!(wrap._ghB && wrap._ghB.vue)) ghGroupe(wrap, null);
    });
    // Elle part au defilement et a Echap (pas au defilement que le dessin
    // remet lui-meme en place).
    wrap.addEventListener('scroll', function () {
      if (wrap._ghRestaure) { wrap._ghRestaure = false; return; }
      if (wrap._ghB && (wrap._ghB.vue || wrap._ghB.attendue)) ghCacherBulle(wrap, true);
    }, true);
    window.addEventListener('scroll', function () { if (wrap._ghB && wrap._ghB.vue) ghCacherBulle(wrap, true); }, { passive: true });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && wrap._ghB && wrap._ghB.vue) ghCacherBulle(wrap, true); });
    // AU DOIGT, DEUX TEMPS (2026-10-19) : toucher une carte montre le
    // programme du groupe (la bulle, ses cartes allumees) ; toucher encore la
    // meme carte, ou « Ouvrir la fiche », ouvre la fiche. A la souris et au
    // clavier, la carte ouvre la fiche tout de suite (la bulle vient au survol).
    var pointeur = 'mouse';
    wrap.addEventListener('pointerdown', function (e) { pointeur = e.pointerType || 'mouse'; }, true);
    document.addEventListener('pointerdown', function (e) {
      var b = wrap._ghB;
      if (!b || !b.vue || !e.target.closest || e.target.closest('#ghBulle') || e.target.closest('.gh-c')) return;
      if (wrap.contains(e.target) || e.pointerType !== 'mouse') ghCacherBulle(wrap, true);
    }, true);
    wrap.addEventListener('click', function (e) {
      if (!e.target.closest) return;
      if (e.target.closest('a, button')) return;
      var c = e.target.closest('[data-gp-ouvre]');
      if (!c) { ghReserverIci(wrap, e); return; }
      if (pointeur !== 'mouse' && e.detail !== 0) {
        var b = wrap._ghB;
        if (!(b && b.vue && b.carte === c)) { ghMontrerBulle(wrap, c, true); return; }
      }
      ghCacherBulle(wrap, true);
      if (typeof openPos === 'function') openPos(Number(c.getAttribute('data-gp-ouvre')));
    });
    // UNE CASE VIDE DU BOWLING OU DU LASER : « + 16:30 » la suit a la souris.
    wrap.addEventListener('pointermove', function (e) {
      if (e.pointerType !== 'mouse') return;
      var pile = e.target.closest && e.target.closest('.gh-pile.is-reserve');
      var fantome = wrap.querySelector('.gh-ajout');
      if (!pile || e.target.closest('.gh-c')) { if (fantome) fantome.hidden = true; return; }
      var t = ghHeureSous(wrap, pile, e.clientY);
      if (t == null) { if (fantome) fantome.hidden = true; return; }
      if (!fantome || fantome.parentNode !== pile) {
        if (fantome) fantome.remove();
        fantome = document.createElement('div');
        fantome.className = 'gh-ajout';
        fantome.setAttribute('aria-hidden', 'true');
        pile.appendChild(fantome);
      }
      fantome.hidden = false;
      fantome.style.top = 'calc(var(--gh-h) * ' + (t - wrap._ghPlage.vDebut) + ' + 1px)';
      fantome.textContent = '+ ' + gpHeure(t);
    });
    wrap.addEventListener('pointerleave', function () { var f = wrap.querySelector('.gh-ajout'); if (f) f.hidden = true; });
    wrap.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var c = e.target.closest && e.target.closest('[data-gp-ouvre]');
      if (!c || typeof openPos !== 'function') return;
      e.preventDefault();
      openPos(Number(c.getAttribute('data-gp-ouvre')));
    });
    var attente = 0;
    var recalculer = function () {
      clearTimeout(attente);
      attente = setTimeout(function () {
        if (!wrap.isConnected || !wrap.querySelector('.gh')) return;
        if (Math.abs((wrap.clientWidth || 0) - (wrap._gpLargeur || 0)) > 2) { wrap._ghHtml = null; renderGlobalPlanning(wrap); return; }
        var racine = wrap.querySelector('.gh');
        var grille = racine.querySelector('.gh-grille');
        var y = grille ? grille.scrollTop : 0, x = grille ? grille.scrollLeft : 0;
        ghHauteur(wrap);
        ghLargeurs(wrap);
        ghAjusterCartes(racine);
        ghCorriger(wrap);
        ghHorloge(wrap);
        if (grille && (grille.scrollTop !== y || grille.scrollLeft !== x)) { wrap._ghRestaure = true; grille.scrollTop = y; grille.scrollLeft = x; setTimeout(function () { wrap._ghRestaure = false; }, 120); }
      }, 120);
    };
    window.addEventListener('resize', recalculer);
    if (typeof ResizeObserver === 'function') new ResizeObserver(recalculer).observe(wrap);
  }

  window.renderGlobalPlanning = renderGlobalPlanning;
})();

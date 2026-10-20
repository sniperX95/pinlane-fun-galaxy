// LE PLANNING GLOBAL (2026-10-12, v3 le 2026-10-20) : toutes les activites du
// jour dans la grille d heures du planning bowling, une colonne par activite.
//
// Ce que Movsar a demande et tranche, dans l ordre :
//   - « comme le planning bowling mais adapte pour toute activite », « tout
//     visible par heure, quelle activite, quel groupe », « tout voir d un
//     coup », « les noms complets », « qui est qui » ;
//   - les heures A GAUCHE, de haut en bas ;
//   - la couleur d une carte est celle de l ETAT du groupe (bleu confirme,
//     ambre arrive, vert paye), jamais une couleur par activite ;
//   - toute la journee d ouverture d un coup, sans monter ni descendre, a
//     toute taille d ecran (2026-10-20), sans bulle qui cache la grille ;
//   - (le samedi charge, 46 groupes, 2026-10-20) « regle-moi tout ca » : le
//     bowling en pistes lisibles, la place a qui en a besoin, la plaine
//     nommee, des noms jamais coupes, le panneau sans debordement.
//
// Le dessin est un plan pur (assets/pinlane-planning-moteur.js) : ce module
// lit la journee dans la console (gpModele), mesure les textes sur un canvas,
// lit la place disponible, demande le plan au moteur et l ecrit d un coup.
// La minute qui passe n ecrit que l etat des cartes (ghTic), avec les memes
// fonctions que le rendu. Survoler une carte allume son groupe ; la toucher
// ouvre son panneau, a cote de la grille ; la toucher encore ouvre la fiche.
// Une case vide du bowling ou du laser ouvre la reservation rapide a son heure
// (et sur sa piste au bowling).
//
// La console l appelle depuis renderGlobalPlanningSurface (app-main.js),
// sous l onglet « Planning global ». Le module n ecrit rien : seul « Arrivé »,
// dans le panneau, passe par setReservationStatusDirect, comme la vue Terrain.
(function () {
  'use strict';

  var MOTEUR = window.PinlanePlanningMoteur;

  // LES COLONNES, DANS L ORDRE DU PAPIER (lib/feuille-secours.js, COLONNES) :
  // l equipe retrouve sa feuille. Chaque activite que le centre propose a la
  // sienne, meme sans reservation (gpColonneDuCentre). La table d anniversaire
  // n en a pas (Movsar : « pas besoin de goûter »), les boissons non plus.
  var GP_COLONNES = [
    { cle: 'bowling', titre: 'Bowling', activites: ['bowling'], nature: 'bowling' },
    { cle: 'duckpin', titre: 'Duckpin', activites: ['duckpin_bowling'], nature: 'agenda', unite: 'duckpin_bowling' },
    { cle: 'laser', titre: 'Laser', activites: ['laser_game'], nature: 'laser' },
    { cle: 'funrun', titre: 'Fun Run', activites: ['fun_run'], nature: 'agenda', unite: 'fun_run' },
    { cle: 'arcades', titre: 'Arcades', activites: ['arcade_time', 'arcade_credit'], nature: 'arcades' },
    { cle: 'minigolf', titre: 'Minigolf', activites: ['minigolf_blacklight'], nature: 'agenda' },
    { cle: 'oclock', titre: 'O’Clock', activites: ['golf_oclock'], nature: 'agenda' },
    // (la plaine se vit a la journee : chaque groupe y est une presence nommee)
    { cle: 'plaine', titre: 'Plaine', activites: ['playground'], nature: 'plaine' },
    { cle: 'billard', titre: 'Billard', activites: ['billards'], nature: 'agenda', unite: 'billards' },
  ];
  var GP_SANS_COLONNE = { party_table: true };
  // Ce qui se sert au comptoir ne prend pas de temps de visite : les boissons
  // vont aux infos, les credits d arcade au compteur de la colonne Arcades.
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
  // Fun Day ». Le nom entier reste dans le panneau.
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

  // ---- LA JOURNEE EN LIGNES ---------------------------------------------------
  // Toute la journee, filtre ou pas : les colonnes, les voies et les largeurs
  // se calculent sur la journee entiere (la grille ne bouge pas quand on
  // filtre) ; le filtre d etat de la barre des plannings retire des cartes du
  // dessin, la recherche en eteint.
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
      var debut = gpMinutesDe(r.startTime);
      var span = getStaffTerrainSpan(r);
      return { r: r, id: String(r.id), etat: mo.etat || 'upcoming', retard: Boolean(mo.late), teinte: gpTeinte(r), span: span, debut: debut == null ? span.start : debut, prog: getGroupeProgramme(r), cases: new Map(), infos: [], credits: [] };
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
      Array.from(parties.values()).sort(function (a, b) { return a.start - b.start; }).forEach(function (e, n, toutes) { e.partie = n + 1; e.parties = toutes.length; });
      g.prog.filter(function (e) { return e.aPlacer; }).forEach(function () { poser('laser_game', { aPlacer: true }); });
      // Les activites a heure d une formule (hors bowling, laser, table). Ses
      // credits d arcade restent un compteur, meme quand la formule leur donne
      // une heure : jamais un bloc horaire (spec v3, 8).
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
    // (inconnues : dans l ordre de leur premiere seance, a egalite par titre)
    inconnues.sort(function (a, b) {
      var premiere = function (c) { return Math.min.apply(null, [99].concat(groupes.map(function (g) { return ((g.cases.get(c.cle) || [])[0] || {}).start; }).filter(function (x) { return x != null; }))); };
      return premiere(a) - premiere(b) || String(a.titre).localeCompare(String(b.titre), 'fr');
    });
    var utilisees = colonnes.filter(function (c) { return c.groupes > 0 || gpColonneDuCentre(c); }).concat(inconnues);
    return {
      jour: jour, aujourdHui: aujourdHui, passe: jour < auj && !nuit, maintenant: maintenant, groupes: groupes, colonnes: utilisees,
      visibles: filtrees ? new Set(filtrees.map(function (r) { return String(r.id); })) : null,
      fenetre: typeof getPlanningWindow === 'function' ? getPlanningWindow(jour) : { open: 10, close: 22, closed: false },
    };
  }

  // LES SEANCES : chaque activite d un groupe qui a une heure (vraie, ou
  // probable quand elle n a pas d heure fixe), dans la colonne de son
  // activite. Les credits d arcade et le laser encore a placer n en ont pas.
  function ghSeances(m) {
    var seances = [];
    m.groupes.forEach(function (g) {
      g.cases.forEach(function (liste, cle) {
        liste.forEach(function (e, i) {
          if (e.credit || e.aPlacer) return;
          var debut = e.journee ? g.span.start : e.start;
          var fin = e.journee ? g.span.end : e.end;
          if (debut == null || !(fin > debut)) return;
          seances.push({ g: g, e: e, cle: cle, start: debut, end: fin, id: g.id + '|' + cle + '|' + i });
        });
      });
    });
    return seances;
  }

  // L ETAT D UNE SEANCE A L HEURE QU IL EST (le panneau ; la grille lit le
  // meme etat au moteur).
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
  var GH_ETATS_COURTS = { fini: 'fini', encours: 'en cours', avenir: 'à venir', retard: 'en retard' };
  var GH_STATUTS = { conf: 'Confirmé', arr: 'Arrivé', paid: 'Payé', absent: 'Pas venu' };
  function ghMinutesDeRetard(debut, maintenant) { return Math.max(1, Math.round((maintenant - debut) * 60)); }

  // LA PLAGE DE LA JOURNEE : de l ouverture a la fermeture du centre, toujours
  // (2026-10-19, Movsar : « toutes les heures ... visibles même quand il n'y a
  // rien »). Un jour ferme garde la grille de getPlanningWindow (10 h - 22 h).
  // Une seance hors des heures et l heure qu il est l elargissent.
  function ghPlage(m, seances) {
    var fenetre = m.fenetre || { open: 10, close: 22 };
    var ouvre = Number(fenetre.open), ferme = Number(fenetre.close);
    if (!Number.isFinite(ouvre)) ouvre = 10;
    if (!Number.isFinite(ferme) || ferme <= ouvre) ferme = ouvre + 12;
    var de = ouvre, a = ferme;
    seances.forEach(function (s) { de = Math.min(de, s.start); a = Math.max(a, Math.max(s.end, s.start + 0.5)); });
    if (m.maintenant != null && m.maintenant >= de - 1 && m.maintenant <= a + 1) { de = Math.min(de, m.maintenant); a = Math.max(a, m.maintenant); }
    var debut = Math.floor(de * 2 + 1e-6) / 2;
    var fin = Math.max(debut + 0.5, Math.ceil(a * 2 - 1e-6) / 2);
    return { debut: debut, fin: fin, ouvre: ouvre, ferme: ferme };
  }

  // LES CASES VIDES QUI RESERVENT : le bowling et le laser, par les chemins de
  // leurs plannings (quickFromCell, lpReserver). Un jour ferme, rien.
  var GH_RESERVE = { bowling: 'bowling', laser: 'laser' };
  function ghPeutReserver(m, cle) {
    if (!GH_RESERVE[cle] || (m.fenetre && m.fenetre.closed)) return false;
    if (typeof canUseStaffPermission === 'function' && !canUseStaffPermission('reservations.quick')) return false;
    return cle === 'bowling' ? typeof quickFromCell === 'function' : typeof lpReserver === 'function';
  }

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

  // ---- L ENTREE DU MOTEUR -------------------------------------------------------
  // Des donnees simples : la journee, ses colonnes, ses groupes, ses seances,
  // les ressources du centre AFFICHE (les sources du planning bowling :
  // getAvailabilityLaneCount, getAvailabilityLaserCapacity, laneStatuses,
  // installationsActivite), l ecran. Les armes d une partie : ce que le serveur
  // compte (getLaserSessionArenaPlayers), reservations en ligne en cours comprises.
  function ghCentre() {
    return (typeof getAvailabilitySessionCenter === 'function' && getAvailabilitySessionCenter()) || (typeof getCenterScheduleConfig === 'function' && getCenterScheduleConfig()) || null;
  }
  function ghUnites(id) {
    if (!id || typeof installationsActivite !== 'function') return null;
    var inst = installationsActivite(gpCatalogue(id), ghCentre());
    return inst && inst.units > 0 ? { total: inst.units, mot: inst.mot === 'session' ? 'session' : inst.mot } : null;
  }
  function ghLaserFenetres(liste, enLigne) {
    var out = [];
    liste.forEach(function (r) {
      getLaserWindowsFromReservation(r).forEach(function (w) { out.push({ start: Number(w.start), end: Number(w.end), players: Math.max(0, Number(w.players || r.pax || 0)), enLigne: enLigne }); });
    });
    return out;
  }
  function ghEntree(m, seances, lu) {
    var plage = ghPlage(m, seances);
    var tout = m.groupes.map(function (g) { return g.r; });
    var blocages = typeof getBlocagesEnLigne === 'function' ? getBlocagesEnLigne(m.jour) : [];
    var fenetresLaser = ghLaserFenetres(tout, false).concat(ghLaserFenetres(blocages, true));
    var arene = function (debut, fin) {
      var session = { start: debut, end: fin, players: 0 };
      return typeof getLaserSessionArenaPlayers === 'function' ? getLaserSessionArenaPlayers(session, fenetresLaser) : fenetresLaser.filter(function (o) { return o.start < fin && o.end > debut; }).reduce(function (a, o) { return a + o.players; }, 0);
    };
    var colonnes = m.colonnes.map(function (c) {
      var credits = 0;
      if (c.cle === 'arcades') m.groupes.forEach(function (g) { g.credits.forEach(function (cr) { credits += cr.total; }); });
      return { cle: c.cle, titre: c.titre, nature: c.nature || 'agenda', icone: ghIcone(c.activites[0]), inconnue: Boolean(c.inconnue), unites: ghUnites(c.unite), credits: credits, reserve: ghPeutReserver(m, c.cle) };
    });
    var compteMinute = new Map();
    var sortie = seances.map(function (s) {
      var e = s.e;
      var minute = s.g.id + '|' + s.cle + '|' + Math.round(s.start * 60);
      var n = compteMinute.get(minute) || 0;
      compteMinute.set(minute, n + 1);
      var x = { id: s.id, groupe: s.g.id, colonne: s.cle, debut: s.start, fin: s.end, libre: Boolean(e.libre), journee: Boolean(e.journee), fait: Boolean(e.fait), activite: e.activityId, n: n };
      if (e.pistes) x.pistes = e.pistes.slice();
      if (s.cle === 'bowling' || s.cle === 'laser') x.joueurs = Number(e.joueurs) || Number(s.g.r.pax) || 0;
      if (s.cle === 'laser') { x.arene = arene(s.start, s.end); x.partie = e.partie || 1; x.parties = e.parties || 1; }
      if (s.cle === 'plaine') x.enfants = Number(e.enfants) || Number(s.g.r.pax) || 0;
      if (e.unites > 1) x.unites = e.unites;
      return x;
    });
    var groupes = m.groupes.map(function (g) {
      var r = g.r;
      var pictos = typeof renderCardFlags === 'function' ? renderCardFlags(r, { partiesEcrites: true }) : '';
      var premiere = seances.filter(function (s) { return s.g === g; }).reduce(function (a, s) { return Math.min(a, s.start); }, Infinity);
      var infos = [];
      if (g.formule) infos.push(g.formule.court);
      g.credits.forEach(function (cr) { if (cr.n) infos.push(cr.n + ' cr.'); });
      return {
        id: g.id, nom: String(r.name || 'Client'), statut: g.teinte, personnes: Number(r.pax) || 0, etat: g.etat, retard: g.retard, depuis: g.span.start,
        absent: g.teinte === 'absent', parti: g.parti, valider: typeof isReservationAwaitingReview === 'function' && isReservationAwaitingReview(r),
        aPlacer: (g.cases.get('laser') || []).some(function (e) { return e.aPlacer; }),
        pictos: (pictos.match(/class="bk-flag /g) || []).length, pictosHtml: pictos, infos: infos.concat(g.infos).filter(Boolean),
        heure: Number.isFinite(premiere) ? gpHeure(premiere) : '', debut: g.debut,
      };
    });
    var R = {
      pistes: {
        N: typeof getAvailabilityLaneCount === 'function' ? getAvailabilityLaneCount() : 8,
        maintenance: Object.keys(state.laneStatuses || {}).filter(function (k) { return state.laneStatuses[k] === 'maintenance'; }).map(Number),
        paires: typeof getAvailabilityLanePairs === 'function' ? getAvailabilityLanePairs() : [],
        blocages: [],
      },
      laser: { capacite: typeof getAvailabilityLaserCapacity === 'function' ? getAvailabilityLaserCapacity() : 30, enLigne: [] },
    };
    blocages.forEach(function (b) {
      var texte = typeof texteBlocageEnLigne === 'function' ? texteBlocageEnLigne(b) : 'Réservation en ligne en cours.';
      var libre = typeof heureLiberationBlocage === 'function' ? heureLiberationBlocage(b) : '';
      getBowlingWindowsFromReservation(b).forEach(function (w) { (w.lanes || []).forEach(function (p) { R.pistes.blocages.push({ piste: Number(p), debut: Number(w.start), fin: Number(w.end), texte: texte, libre: libre }); }); });
      getLaserWindowsFromReservation(b).forEach(function (w) { R.laser.enLigne.push({ debut: Number(w.start), fin: Number(w.end), joueurs: Math.max(0, Number(w.players || b.pax || 0)), arene: arene(Number(w.start), Number(w.end)) }); });
    });
    var entree = {
      jour: m.jour, aujourdhui: m.aujourdHui, passe: m.passe, maintenant: m.maintenant,
      plage: { debut: plage.debut, fin: plage.fin },
      fenetre: { open: plage.ouvre, close: plage.ferme, closed: Boolean(m.fenetre && m.fenetre.closed) },
      colonnes: colonnes, groupes: groupes, seances: sortie, ressources: R,
      visibles: m.visibles ? Array.from(m.visibles) : null,
    };
    entree.signature = ghSignature(entree);
    entree.ecran = lu ? ghEcran(lu, entree) : null;
    entree.mesure = ghMesure;
    return entree;
  }
  // LA SIGNATURE DES DONNEES : ce qui fait la geometrie (jamais l heure ni le
  // moment des groupes, qui ne changent que l etat des cartes).
  function ghSignature(e) {
    var groupes = e.groupes.map(function (g) { return [g.id, g.nom, g.statut, g.personnes, g.absent || g.etat === 'absent', g.valider, g.aPlacer, g.pictos, g.pictosHtml, g.infos, g.heure, g.debut]; });
    return ghHacher(JSON.stringify([e.jour, e.aujourdhui, e.passe, e.plage, e.fenetre, e.colonnes, groupes, e.seances, e.ressources]));
  }
  function ghHacher(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36) + '.' + s.length.toString(36);
  }

  // ---- LA MESURE DES TEXTES : un canvas, la police calculee de la grille ------
  var ghCache = { mesures: new Map() };
  var ghCtx = null;
  var ghPoliceCourante = '';
  var ghFamille = '';
  function ghMesure(police, texte) {
    if (!ghCtx) ghCtx = document.createElement('canvas').getContext('2d');
    var f = police + ' ' + (ghFamille || 'Geist, system-ui, sans-serif');
    if (f !== ghPoliceCourante) { ghCtx.font = f; ghPoliceCourante = f; }
    return ghCtx.measureText(String(texte)).width;
  }
  var ghM = null;
  function ghMesureur() { if (!ghM) ghM = MOTEUR.mesureur(ghMesure, ghCache.mesures); return ghM; }
  function ghViderMesures() { ghCache.mesures.clear(); ghCache.besoins = null; ghCache.cleBesoins = null; ghM = null; }

  // ---- LA LECTURE DE LA PAGE : la place, une fois par rendu (au plus 8
  // lectures de geometrie). La boite se mesure, la liste vit dessous et la
  // page, elle, defile.
  var GH = { tete: 44, bas: 14, basPlein: 10, bandeau: 32, heureEcran: 20 };
  var ghBarreLargeur = null;
  function ghLire(wrap) {
    var boite = wrap.closest('.planning-box') || wrap;
    var plein = boite.classList.contains('expanded');
    var r = wrap.getBoundingClientRect();
    var haut = plein ? 0 : boite.getBoundingClientRect().top;
    if (!ghFamille) ghFamille = getComputedStyle(wrap).fontFamily || 'Geist, system-ui, sans-serif';
    var fenetre = window.innerWidth;
    var toucher = Boolean(window.matchMedia && window.matchMedia('(hover: none)').matches);
    if (ghBarreLargeur == null) ghBarreLargeur = toucher ? 0 : Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    return { W: Math.floor(r.width), top: r.top, boiteTop: haut, plein: plein, fenetre: fenetre, hauteur: window.innerHeight, scrollY: plein ? 0 : window.scrollY, toucher: toucher, boite: boite };
  }
  // Le panneau : 320 px des 1 600 px de fenetre, 300 de 1 200 a 1 599, 280 de
  // 768 a 1 199 ; sous 768 px, sous la grille, 40 % de la hauteur de l ecran.
  function ghLargeurPanneau(fenetre) { return fenetre >= 1600 ? 320 : fenetre >= 1200 ? 300 : 280; }
  function ghHauteurPanneau(hauteur) { return Math.floor(hauteur * 0.4); }
  // LA HAUTEUR D UNE HEURE = LA PLACE DE LA BOITE / LES HEURES (2026-10-20,
  // Movsar : « on doit voir l'ensemble des heures d'une traite, on ne doit pas
  // descendre ou monter, peu importe la taille des écrans »).
  function ghEcran(lu, entree) {
    var heures = Math.max(0.5, entree.plage.fin - entree.plage.debut);
    var bandeau = (entree.fenetre.closed || !entree.seances.length) ? GH.bandeau : 0;
    var panneau = Boolean(lu.panneau);
    var dessous = panneau && lu.fenetre < 768 ? ghHauteurPanneau(lu.hauteur) + 1 : 0;
    var cote = panneau && lu.fenetre >= 768 ? ghLargeurPanneau(lu.fenetre) + 1 : 0;
    var barre = lu.fenetre < 768 ? ghBarreLargeur || 0 : 0;
    var haut = lu.top + lu.scrollY + bandeau;
    var bas = lu.plein ? GH.basPlein : GH.bas + 1;
    var dispo = Math.floor(lu.hauteur - haut - bas - GH.tete - 16 - barre - dessous - 2);
    // LE PREMIER ECRAN NE LA PORTE PAS (au telephone, sous la tete de la
    // console) : la boite prend la hauteur d un ecran depuis son propre haut.
    var ecran = !lu.plein && dispo / heures < GH.heureEcran;
    if (ecran) dispo = Math.floor(lu.hauteur - (lu.top - lu.boiteTop) - bandeau - GH.bas - GH.tete - 16 - barre - dessous - 2);
    return { W: Math.max(0, lu.W - cote), H: dispo, largeurFenetre: lu.fenetre, toucher: lu.toucher, plein: lu.plein, panneau: panneau, ecran: ecran };
  }

  // ---- LE RENDU ------------------------------------------------------------------
  // Un rendu = une lecture, un calcul pur, une ecriture. Un nouveau plan ne se
  // calcule que si les donnees, la place, le panneau ou les polices changent,
  // ou si la minute qui passe change une carte porteuse ; sinon la minute
  // n ecrit que l etat des cartes.
  var ghStats = window.__ghPlanStats = { plans: 0, ecritures: 0, tics: 0, corrections: 0, nommes: 0, cartes: 0, sansTexte: 0, essentielAtteint: true, provisoire: false };
  function renderGlobalPlanning(wrap) {
    if (!wrap) return;
    if (!MOTEUR) { wrap.textContent = 'Planning indisponible.'; return; }
    var m = gpModele();
    var seances = ghSeances(m);
    var lu = ghLire(wrap);
    lu.panneau = Boolean(wrap._ghP);
    var entree = ghEntree(m, seances, lu);
    wrap._ghModele = m;
    wrap._ghSeances = seances;
    var cleRendu = entree.signature + '|' + JSON.stringify(entree.ecran) + '|' + (entree.visibles || []).join(',') + '|' + (ghPolicesPretes() ? 1 : 0);
    var racine = wrap._ghRacine && wrap._ghRacine.isConnected ? wrap._ghRacine : null;
    var plan = wrap._ghPlan;
    if (racine && plan && cleRendu === wrap._ghCleRendu) {
      var etats = MOTEUR.ghEtats(entree, entree.maintenant, plan);
      if (etats.cle === plan.etatsCle) {
        wrap._ghEntree = entree;
        ghTic(wrap, plan, etats);
        if (wrap._ghP) ghPanneauRemplir(wrap);
        return;
      }
    }
    entree.corrections = wrap._ghCorrections && wrap._ghCorrections.cle === cleRendu ? wrap._ghCorrections.niveaux : null;
    plan = ghPlanifier(entree);
    wrap._ghEntree = entree;
    wrap._ghCleRendu = cleRendu;
    if (racine && wrap._ghPlan && plan.cle === wrap._ghPlan.cle) {
      wrap._ghPlan = plan;
      ghTic(wrap, plan, plan.etats);
      if (wrap._ghP) ghPanneauRemplir(wrap);
      return;
    }
    ghEcrire(wrap, plan, m);
  }
  function ghPlanifier(entree) {
    var plan = MOTEUR.ghPlan(entree, ghCache);
    ghStats.plans += 1;
    ghStats.nommes = plan.stats.nommes;
    ghStats.cartes = plan.stats.cartes;
    ghStats.sansTexte = plan.stats.sansTexte;
    ghStats.essentielAtteint = plan.stats.essentielAtteint;
    ghStats.provisoire = !ghPolicesPretes();
    return plan;
  }
  function ghPolicesPretes() { return !document.fonts || document.fonts.status === 'loaded'; }

  // ---- L ECRITURE : un seul innerHTML de la grille ---------------------------
  function ghTransitoire(wrap) {
    var q = String(state.searchTerm || '').trim();
    return { groupe: wrap._ghSurvol || null, choisi: wrap._ghP ? wrap._ghP.id : null, recherche: q ? MOTEUR.cleTexte(q) : '' };
  }
  function ghClassesRacine(wrap, plan, entree) {
    var t = ghTransitoire(wrap);
    return 'gp gh is-' + plan.typo.palier + (plan.typo.bord ? '' : ' is-bas') + (plan.axe.hh < 32 ? ' sans-demi' : '') + (entree.ecran && entree.ecran.ecran ? ' is-ecran' : '')
      + (entree.fenetre.closed ? ' is-ferme' : '') + (plan.defile ? ' is-defile' : '') + (wrap._ghP ? ' a-panneau' : '') + (t.groupe ? ' a-groupe' : '') + (t.recherche ? ' is-recherche' : '');
  }
  function ghStyleRacine(plan) {
    var ty = plan.typo;
    return '--gh-o:' + plan.axe.origine + 'px;--gh-lh:' + ty.ligne + 'px;--gh-fs:' + ty.tailleNom + 'px;--gh-fs2:' + ty.taillePetit + 'px;--gh-bord:' + ty.bord + 'px;--gh-marge:' + ty.marge + 'px;--gh-panneau:' + ghLargeurPanneau(window.innerWidth) + 'px;--gh-panneau-h:' + ghHauteurPanneau(window.innerHeight) + 'px';
  }
  function ghStyleGrille(plan, maintenant) {
    var now = MOTEUR.ghMaintenant(plan.axe, maintenant);
    return 'grid-template-columns:' + plan.colH + 'px ' + plan.colonnes.map(function (c) { return c.w + 'px'; }).join(' ') + ';grid-template-rows:' + GH.tete + 'px ' + plan.axe.corps + 'px;--gh-now-px:' + now.y + 'px';
  }
  function ghEcrire(wrap, plan, m) {
    var entree = wrap._ghEntree;
    var etats = plan.etats;
    var t = ghTransitoire(wrap);
    var actif = document.activeElement;
    var focus = actif && wrap.contains(actif) && actif.getAttribute ? actif.getAttribute('data-gh-k') : null;
    var racine = wrap._ghRacine && wrap._ghRacine.isConnected ? wrap._ghRacine : null;
    if (!racine) {
      wrap.innerHTML = '<div class="gp gh"><div class="gh-bandeau" role="status" hidden></div><div class="gh-corps"><div class="gh-grille" role="table"></div><aside class="gh-panneau" hidden aria-label="Le groupe choisi"><div class="gh-panneau__in"></div></aside></div></div>';
      racine = wrap.firstChild;
      wrap._ghRacine = racine;
    }
    racine.setAttribute('class', ghClassesRacine(wrap, plan, entree));
    racine.setAttribute('style', ghStyleRacine(plan));
    var bandeau = racine.querySelector('.gh-bandeau');
    var texteBandeau = entree.fenetre.closed ? 'Centre fermé ce jour-là' + (entree.seances.length ? ' · réservations existantes à contrôler' : '') : !entree.seances.length ? 'Aucune réservation ce jour-là' : '';
    bandeau.hidden = !texteBandeau;
    bandeau.className = 'gh-bandeau' + (entree.fenetre.closed ? ' is-ferme' : '');
    if (bandeau.textContent !== texteBandeau) bandeau.textContent = texteBandeau;
    var grille = racine.querySelector('.gh-grille');
    grille.setAttribute('aria-label', 'Planning de toutes les activités du ' + m.jour);
    grille.setAttribute('style', ghStyleGrille(plan, etats.maintenant));
    grille.innerHTML = ghHtmlGrille(plan, etats, t, entree);
    ghStats.ecritures += 1;
    wrap._ghPlan = plan;
    wrap._ghEtats = etats;
    wrap._ghJourDessine = m.jour;
    ghIndexer(wrap);
    if (wrap._ghP) ghPanneauRemplir(wrap); else ghPanneauVider(wrap);
    if (focus && wrap._ghNoeuds.has(focus)) wrap._ghNoeuds.get(focus).focus({ preventScroll: true });
    // (au telephone, la grille s ouvre sur sa premiere colonne)
    if (plan.defile && wrap._ghDefileJour !== m.jour) { grille.scrollLeft = 0; wrap._ghDefileJour = m.jour; }
    var boite = wrap.closest('.planning-box') || wrap;
    boite.classList.toggle('gp-a-agrandir', Boolean(plan.agrandir));
    ghBrancher(wrap);
    ghControler(wrap, plan);
    if (!ghPolicesPretes() && document.fonts && !wrap._ghAttentePolices) {
      wrap._ghAttentePolices = true;
      document.fonts.ready.then(function () { wrap._ghAttentePolices = false; ghViderMesures(); if (wrap.isConnected) renderGlobalPlanning(wrap); });
    }
  }
  function ghIndexer(wrap) {
    var noeuds = new Map();
    wrap._ghRacine.querySelectorAll('[data-gh-k]').forEach(function (n) { noeuds.set(n.getAttribute('data-gh-k'), n); });
    wrap._ghNoeuds = noeuds;
  }

  // LA GRILLE EN HTML : la tete des colonnes, la colonne des heures, une pile
  // par colonne, le calque des filets, l heure qu il est. Toutes les valeurs
  // en px.
  function ghHtmlGrille(plan, etats, t, entree) {
    var html = '<div class="gh-entete gh-entete--h" role="columnheader">Heure</div>';
    plan.colonnes.forEach(function (col, i) { html += ghHtmlTete(plan, col, i, etats); });
    html += ghHtmlHeures(plan, etats.maintenant);
    var parCol = plan.colonnes.map(function () { return []; });
    plan.elements.forEach(function (el) { if (el.k !== 'seg') parCol[el.colonne].push(el); });
    var segsDe = new Map();
    plan.elements.forEach(function (el) { if (el.k === 'seg') { if (!segsDe.has(el.partie)) segsDe.set(el.partie, []); segsDe.get(el.partie).push(el); } });
    plan.colonnes.forEach(function (col, i) {
      var corps = '';
      if (col.nature === 'bowling' && col.pistes) {
        col.pistes.forEach(function (p, n) {
          if (p.maintenance) corps += '<i class="gh-maint" style="left:' + p.x + 'px;width:' + p.w + 'px"></i>';
          if (n > 0) corps += '<i class="gh-fp' + (n % 2 === 0 ? ' is-paire' : '') + '" style="left:' + (p.x - 1) + 'px"></i>';
        });
      }
      parCol[i].forEach(function (el) {
        if (el.masque) return;
        if (el.k === 'carte') corps += ghHtmlCarte(el, etats, t, plan.typo, entree);
        else if (el.k === 'presence') corps += ghHtmlPresence(el, etats, t, plan.typo);
        else if (el.k === 'partie') corps += ghHtmlPartie(el, segsDe.get(el.cle) || [], etats, t);
        else if (el.k === 'enligne') corps += ghHtmlEnLigne(el);
      });
      html += '<div class="gh-pile' + (col.vide ? ' is-vide' : '') + (col.reserve ? ' is-reserve' : '') + (i === plan.colonnes.length - 1 ? ' is-dernier' : '') + '" role="cell" aria-label="' + gpEsc(col.titre + (col.vide ? ', aucun groupe' : '')) + '" data-gh-cle="' + gpEsc(col.cle) + '" data-gh-col="' + i + '" style="height:' + plan.axe.corps + 'px">' + corps + '</div>';
    });
    var lignes = '';
    plan.bandes.forEach(function (b) { lignes += '<i class="gh-hors is-' + b.type + '" style="top:' + b.y + 'px;height:' + b.h + 'px"></i>'; });
    plan.filets.forEach(function (f) { lignes += '<i class="gh-l is-' + f.type + '" style="top:' + f.y + 'px"></i>'; });
    if (plan.fermeture != null) lignes += '<i class="gh-fermeture" style="top:' + plan.fermeture + 'px"></i>';
    html += '<div class="gh-lignes" aria-hidden="true" style="height:' + plan.axe.corps + 'px">' + lignes + '</div>';
    var now = MOTEUR.ghMaintenant(plan.axe, etats.maintenant);
    html += '<i class="' + ghClasseMaintenant('gh-passe', now) + '" aria-hidden="true"></i><i class="' + ghClasseMaintenant('gh-maintenant', now) + '" aria-hidden="true"></i>';
    return html;
  }
  function ghClasseMaintenant(base, now) { return base + (base === 'gh-passe' ? (now.passe && now.vu ? ' is-vu' : '') : (now.vu ? ' is-vu' : '')); }
  function ghHtmlHeures(plan, maintenant) {
    var html = '<div class="gh-pile gh-pile--h" aria-hidden="true" style="height:' + plan.axe.corps + 'px">';
    plan.libelles.forEach(function (h) {
      html += '<div class="' + MOTEUR.ghClassesHeure(h, maintenant, plan.axe) + '" data-gh-t="' + h.t + '" style="top:' + (h.y - 7) + 'px"' + (h.titre ? ' title="' + gpEsc(h.titre) + '"' : '') + '>' + gpEsc(h.texte) + '</div>';
    });
    var now = MOTEUR.ghMaintenant(plan.axe, maintenant);
    html += '<span class="' + ghClasseMaintenant('gh-maintenant-h', now) + '">' + gpEsc(now.texte) + '</span></div>';
    return html;
  }
  // LA TETE D UNE COLONNE (44 px, deux rangees) : icone, titre et pastille,
  // puis la sous-ligne de ce qui se compte maintenant.
  function ghHtmlTete(plan, col, i, etats) {
    var tete = col.tete;
    var comp = etats.compteurs[col.cle];
    var texte = MOTEUR.ghTeteTexte(col, comp, tete.groupes, etats.maintenant);
    var sous = col.nature === 'bowling' ? '' : MOTEUR.ghSousLigne(col, comp, col.w, ghMesureur());
    var titre = tete.lignes.length ? '<span class="gh-entete__t">' + tete.lignes.map(gpEsc).join('<br>') + '</span>' : '';
    var r1 = (tete.icone ? col.icone : '') + titre + (tete.pastille ? '<span class="gh-entete__n">' + tete.pastille + '</span>' : '');
    var r2 = '';
    if (col.nature === 'bowling' && col.pistes) r2 = '<div class="gh-entete__pistes">' + ghHtmlNumeros(col, comp) + '</div>';
    else r2 = '<div class="gh-entete__sous"' + (sous ? '' : ' hidden') + '>' + gpEsc(sous) + '</div>';
    return '<div class="gh-entete f-' + tete.forme + (tete.vide ? ' is-vide' : '') + (tete.replie ? ' is-replie' : '') + (tete.petit ? ' is-petit' : '') + (col.inconnue ? ' is-inconnue' : '') + (i === plan.colonnes.length - 1 ? ' is-dernier' : '') + '" role="columnheader" data-gh-cle="' + gpEsc(col.cle) + '" title="' + gpEsc(texte) + '" aria-label="' + gpEsc(texte) + '"><div class="gh-entete__r1">' + r1 + '</div>' + r2 + '</div>';
  }
  function ghClassesNumero(p, comp) {
    var occ = comp && comp.maintenant != null && comp.occupees.indexOf(p.n) >= 0;
    return 'gh-num' + (p.n === '?' ? ' is-inconnue' : '') + (p.maintenance ? ' is-maint' : occ ? ' is-occupee' : '');
  }
  function ghHtmlNumeros(col, comp) {
    return col.pistes.map(function (p) { return '<span class="' + ghClassesNumero(p, comp) + '" style="left:' + p.x + 'px;width:' + p.w + 'px">' + p.n + '</span>'; }).join('');
  }
  function ghAttrsCarte(el, etats, t) {
    var etat = etats.elements[el.cle];
    return ' class="' + MOTEUR.ghClasses(el, etat, t) + '" role="button" tabindex="0" data-gp-res="' + gpEsc(el.gid) + '" data-gp-ouvre="' + gpEsc(el.gid) + '" data-gh-k="' + gpEsc(el.cle) + '"' + (el.porteuse ? ' data-gh-porteuse="1"' : '') + (el.arrivee ? ' data-gh-arrivee="1"' : '') + ' aria-label="' + gpEsc(MOTEUR.ghAria(el, etat, etats)) + '"';
  }
  function ghHtmlCarte(el, etats, t, ty, entree) {
    var style = 'left:' + el.x + 'px;top:' + el.y + 'px;width:' + el.w + 'px;height:' + el.h + 'px';
    if (el.suit && el.compo) {
      var cadre = ty.bord + ty.marge;
      style += ';--gh-top:' + (el.y + cadre) + 'px;--gh-ht:' + (el.h - 2 * cadre - (el.compo.bas ? ty.ligne : 0)) + 'px;--gh-bloc:' + (el.lignesTexte * ty.ligne) + 'px';
    }
    var html = '<div' + ghAttrsCarte(el, etats, t) + (el.compo ? ' data-gh-forme="' + el.compo.forme + '"' : '') + ' data-gh-l="' + el.L + '" data-gh-tw="' + el.tw + '" style="' + style + '">';
    if (el.compo) {
      html += '<div class="gh-c__t">' + ghHtmlLignes(el, etats, entree) + '</div>';
      if (el.compo.bas) html += '<div class="gh-c__b">' + gpEsc(el.compo.bas) + '</div>';
    }
    return html + '</div>';
  }
  // Les lignes d une carte, coupees par le moteur : un <br> a chaque coupure,
  // jamais une coupure du navigateur (le bloc ne passe pas a la ligne).
  function ghHtmlLignes(el, etats, entree) {
    var seq = [];
    el.compo.lignes.forEach(function (l, li) { l.forEach(function (u, ui) { seq.push({ u: u, br: li > 0 && ui === 0 }); }); });
    var out = '';
    var ouvert = false;
    seq.forEach(function (x, i) {
      var u = x.u;
      var nom = u.k === 'nom';
      var sep = i === 0 ? '' : nom && !u.mot ? '' : ' ';
      if (ouvert && !nom) { out += '</span>'; ouvert = false; }
      out += sep + (x.br ? '<br>' : '');
      if (nom && !ouvert) { out += '<span class="gh-c__nom">'; ouvert = true; }
      out += ghHtmlPiece(u, el, etats, entree);
    });
    if (ouvert) out += '</span>';
    return out;
  }
  function ghHtmlPiece(u, el, etats, entree) {
    if (u.k === 'nom') return gpEsc(u.t);
    if (u.k === 'h') return '<b class="gh-c__h">' + gpEsc(u.t) + '</b>';
    if (u.k === 'pictos') return '<span class="gh-pictos">' + ghPictos(entree, el.gid) + '</span>';
    if (u.k === 'bas') return '<span class="gh-c__d">' + gpEsc(u.t) + '</span>';
    if (u.k === 'tag') {
      var def = MOTEUR.TAGS[u.code];
      var corps;
      if (u.code === 'retard') {
        var n = etats.retard[el.gid] != null ? etats.retard[el.gid] : u.v;
        corps = u.forme === 'court' ? '+<span class="gh-min">' + n + '</span>' : 'retard <span class="gh-min">' + n + '</span> min';
      } else corps = gpEsc(u.t);
      return '<span class="gp-tag ' + def.cls + (u.forme === 'court' ? ' is-court' : '') + '">' + corps + '</span>';
    }
    return '';
  }
  function ghPictos(entree, gid) {
    var g = entree && entree.groupes.find(function (x) { return x.id === gid; });
    return g ? g.pictosHtml : '';
  }
  // UNE PRESENCE DE PLAINE : le nom a gauche, le nombre d enfants a droite.
  function ghHtmlPresence(el, etats, t, ty) {
    var style = 'left:' + el.x + 'px;top:' + el.y + 'px;width:' + el.w + 'px;height:' + el.h + 'px';
    if (el.suit && el.compo) style += ';--gh-top:' + (el.y + ty.bord + ty.marge) + 'px;--gh-ht:' + (el.h - 2 * (ty.bord + ty.marge)) + 'px;--gh-bloc:' + ((Math.max(1, el.compo.lignes.length) + (el.compo.sousCompte ? 1 : 0)) * ty.ligne) + 'px';
    var html = '<div' + ghAttrsCarte(el, etats, t) + (el.compo ? ' data-gh-forme="' + el.compo.forme + '"' : '') + ' data-gh-l="' + el.L + '" data-gh-tw="' + el.tw + '" style="' + style + '">';
    if (el.compo) {
      if (el.compo.lignes.length) html += '<div class="gh-c__t' + (el.compo.sousCompte ? ' is-sous-compte' : '') + '">' + ghHtmlLignes(el, etats, null) + '</div>';
      if (el.compo.compte) html += '<span class="gh-pr__n' + (el.compo.seul ? ' is-seul' : '') + '">' + gpEsc(el.compo.compte) + '</span>';
    }
    return html + '</div>';
  }
  // UNE PARTIE LASER : sa tete (l heure, les armes), sa barre de segments.
  function ghHtmlPartie(el, segs, etats, t) {
    var tete = el.tete;
    var html = '<div class="gh-partie' + (tete.danger ? ' is-danger' : '') + '" role="group" aria-label="' + gpEsc(tete.aria) + '" data-gh-partie="' + gpEsc(el.cle) + '" data-gh-l="' + el.L + '" style="left:' + el.x + 'px;top:' + el.y + 'px;width:' + el.w + 'px;height:' + el.h + 'px">';
    if (tete.t) html += '<div class="' + (tete.ligne ? 'gh-partie__t' : 'gh-partie__n') + '">' + gpEsc(tete.t) + '</div>';
    html += '<div class="gh-barre" style="left:' + (el.barre.x + 1) + 'px;top:' + (el.barre.y + 1) + 'px;width:' + el.barre.w + 'px;height:' + el.barre.h + 'px">';
    el.bouts.forEach(function (b) {
      if (b.seg >= 0) {
        var s = segs.find(function (x) { return x.cle === b.cle; });
        if (s && !s.masque) html += ghHtmlSegment(s, etats, t);
        return;
      }
      html += '<div class="' + (b.libre ? 'gh-seg-libre' : 'gh-seg-autres') + '" style="left:' + b.x + 'px;width:' + b.w + 'px">' + gpEsc(b.texte) + '</div>';
    });
    return html + '</div></div>';
  }
  function ghHtmlSegment(el, etats, t) {
    var c = el.compo;
    var html = '<div' + ghAttrsCarte(el, etats, t) + (c ? ' data-gh-forme="' + c.forme + '"' : '') + ' data-gh-l="' + el.L + '" data-gh-tw="' + el.tw + '" style="left:' + el.relX + 'px;width:' + el.w + 'px' + (el.w < 8 ? ';padding:0;border-left-width:' + Math.min(3, el.w) + 'px' : '') + '">';
    if (c) {
      html += '<div class="gh-c__t"><span class="gh-c__nom">' + gpEsc(c.nom) + '</span>';
      if (c.armes) html += (c.deuxLignes ? '<br>' : ' ') + '<span class="gh-seg__n">' + gpEsc(c.armes) + '</span>';
      html += '</div>';
    }
    return html + '</div>';
  }
  function ghHtmlEnLigne(el) {
    return '<div class="gh-enligne" role="note" data-gh-enligne="' + el.piste + '" aria-label="' + gpEsc('Piste ' + el.piste + ', ' + gpHeure(el.debut) + ' - ' + gpHeure(el.fin) + ' : ' + el.texte) + '" style="left:' + el.x + 'px;top:' + el.y + 'px;width:' + el.w + 'px;height:' + el.h + 'px">' + (el.vu ? '<span>' + gpEsc(el.vu) + '</span>' : '') + '</div>';
  }

  // ---- LA MINUTE QUI PASSE : l etat, jamais le texte ni la geometrie -----------
  // Les classes d etat des cartes et des segments, leurs aria-label, les
  // minutes de retard, la barre, la pastille et le voile, --gh-now-px, les
  // compteurs des tetes. Les memes fonctions que le rendu : apres le tic, la
  // grille est celle d un rendu frais a la meme heure.
  function ghTic(wrap, plan, etats) {
    var racine = wrap._ghRacine;
    if (!racine) return;
    var t = ghTransitoire(wrap);
    var noeuds = wrap._ghNoeuds || new Map();
    var poser = function (n, nom, v) { if (n.getAttribute(nom) !== v) n.setAttribute(nom, v); };
    plan.elements.forEach(function (el) {
      if (el.k !== 'carte' && el.k !== 'presence' && el.k !== 'seg') return;
      var n = noeuds.get(el.cle);
      if (!n) return;
      var etat = etats.elements[el.cle];
      poser(n, 'class', MOTEUR.ghClasses(el, etat, t));
      poser(n, 'aria-label', MOTEUR.ghAria(el, etat, etats));
      if (el.porteuse && etats.retard[el.gid] != null) {
        n.querySelectorAll('.gh-min').forEach(function (x) { var v = String(etats.retard[el.gid]); if (x.textContent !== v) x.textContent = v; });
      }
    });
    var grille = racine.querySelector('.gh-grille');
    poser(grille, 'style', ghStyleGrille(plan, etats.maintenant));
    racine.querySelectorAll('.gh-entete[data-gh-cle]').forEach(function (n) {
      var i = plan.colonnes.findIndex(function (c) { return c.cle === n.getAttribute('data-gh-cle'); });
      var col = plan.colonnes[i];
      if (!col) return;
      var comp = etats.compteurs[col.cle];
      var texte = MOTEUR.ghTeteTexte(col, comp, col.tete.groupes, etats.maintenant);
      poser(n, 'title', texte);
      poser(n, 'aria-label', texte);
      if (col.nature === 'bowling') {
        n.querySelectorAll('.gh-num').forEach(function (x, k) { poser(x, 'class', ghClassesNumero(col.pistes[k], comp)); });
      } else {
        var sous = n.querySelector('.gh-entete__sous');
        if (sous) {
          var v = MOTEUR.ghSousLigne(col, comp, col.w, ghMesureur());
          if (sous.textContent !== v) sous.textContent = v;
          if (sous.hidden !== !v) sous.hidden = !v;
        }
      }
    });
    racine.querySelectorAll('.gh-pile--h .gh-h').forEach(function (n, k) { poser(n, 'class', MOTEUR.ghClassesHeure(plan.libelles[k], etats.maintenant, plan.axe)); });
    var now = MOTEUR.ghMaintenant(plan.axe, etats.maintenant);
    var pastille = racine.querySelector('.gh-maintenant-h');
    if (pastille) { poser(pastille, 'class', ghClasseMaintenant('gh-maintenant-h', now)); if (pastille.textContent !== now.texte) pastille.textContent = now.texte; }
    var barre = racine.querySelector('.gh-maintenant');
    if (barre) poser(barre, 'class', ghClasseMaintenant('gh-maintenant', now));
    var voile = racine.querySelector('.gh-passe');
    if (voile) poser(voile, 'class', ghClasseMaintenant('gh-passe', now));
    poser(racine, 'class', ghClassesRacine(wrap, plan, wrap._ghEntree));
    wrap._ghEtats = etats;
    ghStats.tics += 1;
  }

  // ---- LE CONTROLE, SANS LECTURE : chaque bloc de texte est observe (sa
  // taille arrive apres la mise en page, sans la forcer) ; un bloc plus large
  // que ce que le plan lui donne fait descendre sa carte d un niveau, au plus
  // deux fois, par un nouveau plan.
  function ghControler(wrap, plan) {
    if (typeof ResizeObserver !== 'function') return;
    if (wrap._ghObservateur) wrap._ghObservateur.disconnect();
    var ligne = plan.typo.ligne;
    var fautifs = new Map();
    var observateur = new ResizeObserver(function (entrees) {
      entrees.forEach(function (e) {
        var bloc = e.target;
        var carte = bloc.closest('[data-gh-k]');
        if (!carte) return;
        var tw = Number(carte.getAttribute('data-gh-tw'));
        var L = Number(carte.getAttribute('data-gh-l'));
        var r = e.contentRect;
        if (r.width > tw + 0.5 || r.height > L * ligne + 0.5) fautifs.set(carte.getAttribute('data-gh-k'), true);
      });
      observateur.disconnect();
      if (!fautifs.size || !ghPolicesPretes()) return;
      var corr = wrap._ghCorrections && wrap._ghCorrections.cle === wrap._ghCleRendu ? wrap._ghCorrections : { cle: wrap._ghCleRendu, niveaux: {}, tours: 0 };
      if (corr.tours >= 2) return;
      corr.tours += 1;
      fautifs.forEach(function (x, cle) {
        var el = plan.elements.find(function (y) { return y.cle === cle; });
        corr.niveaux[cle] = Math.max(corr.niveaux[cle] || 1, ((el && el.compo && el.compo.niveau) || 1) + 1);
      });
      wrap._ghCorrections = corr;
      ghStats.corrections += fautifs.size;
      wrap._ghCleRendu = null;
      renderGlobalPlanning(wrap);
    });
    wrap._ghRacine.querySelectorAll('.gh-c__t, .gh-c__b').forEach(function (b) { observateur.observe(b); });
    wrap._ghObservateur = observateur;
  }

  // ---- LES GESTES ------------------------------------------------------------
  // SURVOLER UNE CARTE ALLUME LE GROUPE (2026-10-20, Movsar : la bulle au
  // survol « peut déranger de fou ») : ses cartes dans toutes les colonnes
  // prennent un contour de la couleur de leur statut, les autres s attenuent.
  function ghReposerClasses(wrap) {
    var plan = wrap._ghPlan, etats = wrap._ghEtats;
    if (!plan || !etats || !wrap._ghRacine) return;
    var t = ghTransitoire(wrap);
    var noeuds = wrap._ghNoeuds || new Map();
    plan.elements.forEach(function (el) {
      if (el.k !== 'carte' && el.k !== 'presence' && el.k !== 'seg') return;
      var n = noeuds.get(el.cle);
      if (!n) return;
      var v = MOTEUR.ghClasses(el, etats.elements[el.cle], t);
      if (n.getAttribute('class') !== v) n.setAttribute('class', v);
    });
    var r = ghClassesRacine(wrap, plan, wrap._ghEntree);
    if (wrap._ghRacine.getAttribute('class') !== r) wrap._ghRacine.setAttribute('class', r);
  }
  function ghGroupe(wrap, id) {
    if ((wrap._ghSurvol || null) === (id || null)) return;
    wrap._ghSurvol = id || null;
    ghReposerClasses(wrap);
  }
  function gpChercher(wrap) { ghReposerClasses(wrap); }

  // LE PANNEAU D UN GROUPE (2026-10-20) : au clic ou au toucher d une carte,
  // ancre a droite de la grille (sous elle au telephone), il ne cache aucune
  // heure : la grille se resserre a cote de lui. Son statut, ses personnes, sa
  // formule ; son programme en mini frise, puis en lignes (l heure, la duree,
  // les pistes ou les armes, ou il en est) ; ce qu il a pris en plus, ses
  // notes, son numero. Et les gestes du comptoir : « Arrivé » (la regle de la
  // vue Terrain) et la fiche. Echap, la croix ou un clic hors du panneau le
  // ferment.
  function ghDuree(h) {
    var min = Math.round(h * 60);
    if (min < 60) return min + ' min';
    return Math.floor(min / 60) + ' h' + (min % 60 ? ' ' + String(min % 60).padStart(2, '0') : '');
  }
  function ghNotes(r) {
    var notes = [];
    var mot = typeof getReservationNoteText === 'function' ? getReservationNoteText(r) : '';
    if (mot) notes.push({ qui: typeof getReservationNoteTitre === 'function' ? getReservationNoteTitre(r) : 'Note', texte: mot });
    if (typeof getReservationNotesEquipe === 'function') getReservationNotesEquipe(r).forEach(function (n) { if (n && n.t) notes.push({ qui: 'Équipe', texte: n.t }); });
    var client = window.PinlaneStaffNotes && typeof window.PinlaneStaffNotes.text === 'function' ? window.PinlaneStaffNotes.text(r) : '';
    if (client) notes.push({ qui: 'Client', texte: client });
    return notes;
  }
  // Ce que la ligne du programme dit de l activite (spec 11.2).
  function ghDetailPanneau(s, wrap) {
    var e = s.e;
    if (e.activityId === 'bowling') return (e.pistes && e.pistes.length ? 'Pistes ' + gpPistes(e.pistes) : 'pistes à attribuer') + ' · ' + ghDuree(s.end - s.start);
    if (e.activityId === 'laser_game') {
      var plan = wrap._ghPlan;
      var partie = plan && plan.laser ? plan.laser.parties.find(function (p) { return Math.abs(p.debut - s.start) <= 2 / 60 + 1e-6 || (p.debut <= s.start + 1e-6 && p.fin >= s.end - 1e-6); }) : null;
      var C = plan && plan.laser ? plan.laser.capacite : 0;
      return 'Partie de ' + gpHeure(partie ? partie.debut : s.start) + ' · ' + (e.joueurs || s.g.r.pax) + ' armes' + (partie ? ' sur ' + partie.armes + (C ? '/' + C : '') : '') + (e.parties > 1 ? ' · ' + (e.partie === 1 ? '1re' : e.partie + 'e') + ' partie' : '');
    }
    if (e.journee) return 'toute la visite · jusqu’à ' + gpHeure(s.end) + ' · ' + (Number(e.enfants) || Number(s.g.r.pax) || 0) + ' enf.';
    return [e.libre ? 'sans heure fixe' : ghDuree(s.end - s.start), e.unites > 1 ? '×' + e.unites + (e.activityId === 'billards' ? ' tables' : e.activityId === 'duckpin_bowling' ? ' pistes' : '') : ''].filter(Boolean).join(' · ');
  }
  function ghPanneauHtml(wrap, id, ici) {
    var m = wrap._ghModele;
    var g = m && m.groupes.find(function (x) { return x.id === id; });
    if (!g) return '';
    var r = g.r;
    var sous = [(Number(r.pax) || 0) + ' pers.', g.formule ? g.formule.long : '', typeof getReservationOccasionLabel === 'function' ? getReservationOccasionLabel(r) : ''].filter(Boolean);
    var alertes = '';
    var tel = String(r.phone || '').trim();
    if (g.retard && m.maintenant != null) alertes += '<div class="gh-p__alerte is-retard">En retard de ' + ghMinutesDeRetard(g.span.start, m.maintenant) + ' min</div>';
    if (typeof isReservationAwaitingReview === 'function' && isReservationAwaitingReview(r)) alertes += '<div class="gh-p__alerte is-valider">À valider par l’équipe</div>';
    if (g.etat === 'closing') alertes += '<div class="gh-p__alerte is-cloturer">À clôturer</div>';
    if (g.etat === 'absent') alertes += '<div class="gh-p__alerte is-absent">Pas venu</div>';
    var siennes = (wrap._ghSeances || []).filter(function (s) { return s.g === g; }).sort(function (a, b) { return a.start - b.start; });
    // LA MINI FRISE : de la premiere activite a la derniere, a l heure pleine.
    var frise = '';
    if (siennes.length) {
      var de = Math.floor(Math.min.apply(null, siennes.map(function (s) { return s.start; })));
      var a = Math.ceil(Math.max.apply(null, siennes.map(function (s) { return s.end; })));
      if (a <= de) a = de + 1;
      var pct = function (h) { return ((h - de) / (a - de) * 100).toFixed(3) + '%'; };
      var reperes = '';
      for (var h = de; h <= a + 1e-6; h += 1) reperes += '<span class="gh-p__repere" style="left:' + pct(h) + '">' + gpHeure(h).slice(0, 2) + '</span>';
      var bouts = siennes.map(function (s) {
        var etat = ghEtat(s, m);
        return '<i class="gh-p__bout gh-p__tok t-' + g.teinte + ' is-' + etat + (s.e.libre ? ' is-libre' : '') + (s === ici ? ' is-ici' : '') + '" style="left:' + pct(s.start) + ';width:calc(' + pct(s.end) + ' - ' + pct(s.start) + ')" title="' + gpEsc(gpTitreActivite(s.e.activityId) + ' ' + gpHeure(s.start)) + '"></i>';
      }).join('');
      var maintenant = m.maintenant != null && m.maintenant > de && m.maintenant < a ? '<i class="gh-p__now" style="left:' + pct(m.maintenant) + '"></i>' : '';
      frise = '<div class="gh-p__frise" aria-hidden="true"><div class="gh-p__piste">' + bouts + maintenant + '</div><div class="gh-p__reperes">' + reperes + '</div></div>';
    }
    // LE PROGRAMME EN LIGNES (defaut 5 regle) : la cellule d heure n ecrit
    // qu une heure, « 15:30 » ou « ≈ 15:30 » ; une activite a la journee y
    // ecrit son heure d arrivee, et « toute la visite » va dans son detail.
    var lignes = siennes.map(function (s) {
      var etat = ghEtat(s, m);
      var dans = etat === 'avenir' && m.maintenant != null && !s.e.libre ? Math.round((s.start - m.maintenant) * 60) : null;
      var mot = dans != null && dans > 0 && dans <= 60 ? 'dans ' + dans + ' min' : GH_ETATS_COURTS[etat];
      var quand = (s.e.libre && !s.e.journee ? '≈ ' : '') + gpHeure(s.start);
      return '<li class="is-' + etat + (s === ici ? ' is-ici' : '') + '"><span class="gh-p__h' + (s.e.journee ? ' is-arrivee' : '') + '">' + gpEsc(quand) + '</span>' + ghIcone(s.e.activityId)
        + '<span class="gh-p__act">' + gpEsc(gpTitreActivite(s.e.activityId)) + '<span class="gh-p__det">' + gpEsc(ghDetailPanneau(s, wrap)) + '</span></span><span class="gh-p__etat is-' + etat + '">' + gpEsc(mot) + '</span></li>';
    });
    // Ce qui n a pas d heure : les credits d arcade, la partie de laser a placer.
    g.cases.forEach(function (liste) {
      liste.forEach(function (e) {
        if (e.credit) lignes.push('<li class="is-avenir"><span class="gh-p__h">·</span>' + ghIcone('arcade_time') + '<span class="gh-p__act">Arcades<span class="gh-p__det">' + gpEsc(e.credits && e.credits.parEnfant ? e.credits.n + ' crédits par enfant · ' + e.credits.total + ' crédits' : (e.credits ? e.credits.total : 0) + ' crédits') + '</span></span><span class="gh-p__etat"></span></li>');
        if (e.aPlacer) lignes.push('<li class="is-avenir"><span class="gh-p__h">·</span>' + ghIcone('laser_game') + '<span class="gh-p__act">Laser<span class="gh-p__det">à placer</span></span><span class="gh-p__etat is-retard">à placer</span></li>');
      });
    });
    var infos = g.infos.filter(Boolean);
    var notes = ghNotes(r);
    var peutArriver = m.aujourdHui && g.etat === 'upcoming' && r.status !== 'paid' && r.status !== 'arrived' && typeof setReservationStatusDirect === 'function';
    return '<div class="gh-p__tete"><div class="gh-p__titre"><b class="gh-p__nom">' + gpEsc(r.name) + '</b><span class="gh-p__statut gh-p__tok t-' + g.teinte + '">' + gpEsc(GH_STATUTS[g.teinte] || GH_STATUTS.conf) + '</span></div>'
      + '<button type="button" class="gh-p__fermer" data-gh-fermer="1" aria-label="Fermer le panneau"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>'
      + (sous.length ? '<div class="gh-p__sous">' + gpEsc(sous.join(' · ')) + '</div>' : '')
      + alertes
      + frise
      + (lignes.length ? '<ol class="gh-p__prog">' + lignes.join('') + '</ol>' : '')
      + (infos.length ? '<div class="gh-p__bloc"><span class="gh-p__lib">En plus</span>' + gpEsc(infos.join(' · ')) + '</div>' : '')
      + notes.map(function (n) { return '<div class="gh-p__note"><span class="gh-p__lib">' + gpEsc(n.qui) + '</span>' + gpEsc(n.texte) + '</div>'; }).join('')
      + (tel ? '<a class="gh-p__tel" href="tel:' + gpEsc(tel.replace(/[^0-9+]/g, '')) + '">Appeler ' + gpEsc(tel) + '</a>' : '')
      + '<div class="gh-p__gestes">' + (peutArriver ? '<button type="button" class="is-premier" data-gh-arrive="' + gpEsc(String(r.id)) + '">Arrivé</button>' : '')
      + '<button type="button" data-gh-fiche="' + Number(r.id) + '">Ouvrir la fiche</button></div>';
  }
  // Le panneau suit le dessin : ouvert, il se remplit a chaque rendu (meme
  // groupe, meme activite si elle existe encore).
  function ghPanneauRemplir(wrap) {
    var p = wrap._ghP;
    var racine = wrap._ghRacine;
    var pan = racine && racine.querySelector('.gh-panneau');
    if (!pan) return false;
    var ici = p ? (wrap._ghSeances || []).find(function (s) { return s.g.id === p.id && ghCleSeance(wrap, s) === p.k; }) : null;
    var html = p ? ghPanneauHtml(wrap, p.id, ici) : '';
    if (!html) { if (p) wrap._ghP = null; ghPanneauVider(wrap); return false; }
    if (pan.firstChild.innerHTML !== html) pan.firstChild.innerHTML = html;
    pan.hidden = false;
    return true;
  }
  function ghPanneauVider(wrap) {
    var pan = wrap._ghRacine && wrap._ghRacine.querySelector('.gh-panneau');
    if (!pan) return;
    pan.hidden = true;
    if (pan.firstChild.innerHTML) pan.firstChild.innerHTML = '';
  }
  // La carte d une seance : sa cle dans le plan (le meme groupe, la meme
  // colonne, la meme minute).
  function ghCleSeance(wrap, s) {
    var plan = wrap._ghPlan;
    var el = plan && plan.elements.find(function (x) { return x.sid === s.id; });
    return el ? el.cle : '';
  }
  function ghOuvrirPanneau(wrap, carte) {
    var id = carte.getAttribute('data-gp-res');
    var k = carte.getAttribute('data-gh-k');
    var memeGroupe = wrap._ghP && wrap._ghP.id === id;
    wrap._ghP = { id: id, k: k };
    // (un clic sur une autre carte du meme groupe ne recalcule rien : seule
    // la ligne « ici » du programme change)
    if (memeGroupe) { ghPanneauRemplir(wrap); return; }
    wrap._ghCleRendu = null;
    renderGlobalPlanning(wrap);
  }
  function ghFermerPanneau(wrap) {
    if (!wrap._ghP) return;
    wrap._ghP = null;
    wrap._ghCleRendu = null;
    renderGlobalPlanning(wrap);
  }

  // La colonne et le point (en coordonnees de sa pile) sous un evenement.
  function ghPointDansPile(e) {
    var pile = e.target && e.target.closest ? e.target.closest('.gh-pile[data-gh-col]') : null;
    if (!pile || e.target !== pile) return null;
    return { pile: pile, colonne: Number(pile.getAttribute('data-gh-col')), x: e.offsetX, y: e.offsetY };
  }
  // Toucher une case vide du bowling ou du laser : la reservation rapide a
  // cette heure, par le chemin de son planning (sur sa piste au bowling, le
  // depart au laser). Rien ne s ecrit ici.
  function ghReserverIci(wrap, point) {
    var plan = wrap._ghPlan;
    if (!plan || !point) return false;
    var c = MOTEUR.ghCaseLibre(plan, point.colonne, point.x, point.y);
    if (!c) return false;
    var col = plan.colonnes[point.colonne];
    if (wrap._ghP) { wrap._ghP = null; wrap._ghCleRendu = null; renderGlobalPlanning(wrap); }
    if (col.nature === 'laser') lpReserver(c.t, c.libres != null ? c.libres : undefined);
    else quickFromCell(c.piste, c.t);
    return true;
  }
  function ghFantome(wrap, point) {
    var plan = wrap._ghPlan;
    var f = wrap._ghFantome;
    var c = plan && point ? MOTEUR.ghCaseLibre(plan, point.colonne, point.x, point.y) : null;
    if (!c) { if (f) f.hidden = true; return; }
    if (!f || f.parentNode !== point.pile) {
      if (f) f.remove();
      f = document.createElement('div');
      f.className = 'gh-ajout';
      f.setAttribute('aria-hidden', 'true');
      point.pile.appendChild(f);
      wrap._ghFantome = f;
    }
    var col = plan.colonnes[point.colonne];
    var y = MOTEUR.ghY(plan.axe, c.t);
    f.hidden = false;
    f.style.left = (c.x + 1) + 'px';
    f.style.width = Math.max(1, c.w - 2) + 'px';
    f.style.top = (y + 1) + 'px';
    f.style.height = Math.max(1, MOTEUR.ghY(plan.axe, c.t + 0.5) - y - 2) + 'px';
    var texte = '+ ' + gpHeure(c.t);
    if (col.nature === 'laser' && c.libres != null) {
      var formes = [texte + ' · ' + c.libres + ' armes libres', texte + ' · ' + c.libres, texte];
      texte = formes.find(function (t) { return ghMesure('650 12px', t) + 18 <= c.w; }) || texte;
    }
    f.textContent = texte;
  }

  function ghBrancher(wrap) {
    if (wrap._gpBranche) return;
    wrap._gpBranche = true;
    var dernierPointeur = 'mouse';
    // Le survol, a la souris : le groupe s allume, rien ne s ouvre.
    wrap.addEventListener('pointerover', function (e) {
      if (e.pointerType !== 'mouse') return;
      var c = e.target.closest && e.target.closest('.gh-c');
      ghGroupe(wrap, c ? c.getAttribute('data-gp-res') : null);
    });
    wrap.addEventListener('pointerleave', function () {
      ghGroupe(wrap, null);
      if (wrap._ghFantome) wrap._ghFantome.hidden = true;
    });
    wrap.addEventListener('pointerdown', function (e) { dernierPointeur = e.pointerType || 'mouse'; }, true);
    // Echap ferme le panneau ; un clic hors du panneau et hors des cartes aussi.
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && wrap._ghP) ghFermerPanneau(wrap); });
    document.addEventListener('pointerdown', function (e) {
      if (!wrap._ghP || !e.target.closest || e.target.closest('.gh-panneau') || e.target.closest('.gh-c')) return;
      if (e.target.closest('.staff-action-popover, #quickBookOverlay, .modal, [role="dialog"]')) return;
      if (wrap.contains(e.target) && e.target.closest('.gh-pile')) return;
      ghFermerPanneau(wrap);
    }, true);
    // UNE CARTE : le premier clic (ou toucher, ou Entree) ouvre son panneau ;
    // le suivant sur la meme carte ouvre la fiche.
    var toucher = function (c) {
      var p = wrap._ghP;
      if (p && p.k === c.getAttribute('data-gh-k')) {
        var id = c.getAttribute('data-gp-ouvre');
        ghFermerPanneau(wrap);
        if (typeof openPos === 'function') openPos(Number(id));
        return;
      }
      ghOuvrirPanneau(wrap, c);
    };
    wrap.addEventListener('click', function (e) {
      if (!e.target.closest) return;
      if (e.target.closest('[data-gh-fermer]')) { ghFermerPanneau(wrap); return; }
      var fiche = e.target.closest('[data-gh-fiche]');
      if (fiche) { ghFermerPanneau(wrap); if (typeof openPos === 'function') openPos(Number(fiche.getAttribute('data-gh-fiche'))); return; }
      var arrive = e.target.closest('[data-gh-arrive]');
      if (arrive) { if (typeof setReservationStatusDirect === 'function') setReservationStatusDirect(arrive.getAttribute('data-gh-arrive'), 'arrived', e); return; }
      if (e.target.closest('a, button, .gh-panneau')) return;
      var c = e.target.closest('[data-gp-ouvre]');
      if (c) { toucher(c); return; }
      var point = ghPointDansPile(e);
      if (!point) return;
      // AU DOIGT, UNE TOLERANCE DE 8 PX : un toucher a cote d une carte basse
      // la choisit ; une case vide ne reserve que loin de toute carte.
      if (dernierPointeur === 'touch' && wrap._ghPlan) {
        var proche = MOTEUR.ghCarteProche(wrap._ghPlan, point.colonne, point.x, point.y);
        if (proche.el) { var n = wrap._ghNoeuds && wrap._ghNoeuds.get(proche.el.cle); if (n) { toucher(n); return; } }
        if (proche.d <= MOTEUR.TOLERANCE_TOUCHER) return;
      }
      if (!ghReserverIci(wrap, point) && wrap._ghP) ghFermerPanneau(wrap);
    });
    wrap.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var c = e.target.closest && e.target.closest('[data-gp-ouvre]');
      if (!c) return;
      e.preventDefault();
      toucher(c);
    });
    // UNE CASE VIDE DU BOWLING OU DU LASER : « + 16:30 » la suit a la souris.
    wrap.addEventListener('pointermove', function (e) {
      if (e.pointerType !== 'mouse') return;
      ghFantome(wrap, ghPointDansPile(e));
    });
    // La place change : un nouveau plan, une fois par image au plus.
    var attente = 0;
    var recalculer = function () {
      if (attente) return;
      attente = requestAnimationFrame(function () {
        attente = 0;
        if (!wrap.isConnected || !wrap._ghRacine) return;
        var x = wrap._ghRacine.querySelector('.gh-grille');
        var gauche = x ? x.scrollLeft : 0;
        renderGlobalPlanning(wrap);
        var y = wrap._ghRacine.querySelector('.gh-grille');
        if (y && gauche && y.scrollLeft !== gauche) y.scrollLeft = gauche;
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
    if (document.fonts && document.fonts.addEventListener) {
      document.fonts.addEventListener('loadingdone', function () { ghViderMesures(); wrap._ghCleRendu = null; if (wrap.isConnected) renderGlobalPlanning(wrap); });
    }
  }

  window.renderGlobalPlanning = renderGlobalPlanning;
  window.__ghReinitialiser = function (wrap) { ghViderMesures(); if (wrap) { wrap._ghCleRendu = null; wrap._ghPlan = null; wrap._ghCorrections = null; } };
  window.__ghMesure = ghMesure;
})();

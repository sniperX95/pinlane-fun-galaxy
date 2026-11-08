/* ==========================================================================
   window.PinlanePilotage : les chiffres de la vue d ensemble (2026-11-08, Ansar :
   « des trucs vrm utile des stat utile et changeable des grapgiques vrm styler »).

   Sous « En ce moment », une seule question : comment ca marche, sur la periode
   que le gerant choisit (jour, 7 jours, 30 jours, ce mois).
   - Cinq tuiles au-dessus d un grand graphique : toucher une tuile choisit ce que
     le graphique montre. « Modifier » change les tuiles et les cartes du bas.
   - Chaque carte dit d abord en une phrase ce qu elle montre : un graphique qui ne
     decide rien n a pas sa place (NORTHSTAR, chaque donnee paie sa place).
   - Le jour se lit sur le poste, en direct (les memes chiffres que « En ce moment ») ;
     les periodes viennent du serveur (action dashboardAnalytics).
   - Les reglages restent sur le poste (state.dashPilotage, sauve avec le reste).

   Les trois morceaux (tete, panneau, cartes) sont des noeuds gardes d un rendu a
   l autre et replaces dans leurs emplacements : le dashboard se re-rend a chaque
   tick du direct, un menu ouvert ou un survol ne doivent pas en souffrir.
   Aucun <header> ici : body.staff-mode header est ecrase a hauteur 0.
   ========================================================================== */
(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const PERIODES = [
    { id: 'jour', label: 'Jour', titre: 'La journée' },
    { id: '7j', label: '7 jours', titre: 'Les 7 derniers jours', jours: 7, avant: 'les 7 jours d’avant', legende: 'comparés aux 7 jours d’avant' },
    { id: '30j', label: '30 jours', titre: 'Les 30 derniers jours', jours: 30, avant: 'les mêmes jours, 5 semaines plus tôt', legende: 'comparés aux mêmes jours, 5 semaines plus tôt' },
    { id: 'mois', label: 'Ce mois', titre: 'Ce mois-ci', avant: 'le mois d’avant', legende: 'comparé au mois d’avant, jour de semaine contre jour de semaine' },
  ];
  const NB_TUILES = 5;

  const div = (a, b, facteur = 1) => (b > 0 ? (a / b) * facteur : null);

  // Ce que la console sait compter. `jour` lit la journee du poste, `total` la reponse du
  // serveur, `serie` une ligne de chiffres : un jour de la periode, ou une heure de la journee.
  const STATS = {
    ca: { label: 'Chiffre d’affaires', court: 'chiffre d’affaires', format: 'euro', argent: true, detail: 'revenue', jour: (j) => j.ca, total: (a) => a.totals.revenue, serie: (d) => d.revenue },
    encaisse: { label: 'Encaissé', court: 'encaissé', format: 'euro', argent: true, jour: (j) => j.encaisse, total: (a) => a.totals.collected, serie: (d) => d.collected },
    aEncaisser: { label: 'Reste à encaisser', court: 'reste à encaisser', format: 'euro', argent: true, inverse: true, jour: (j) => j.aEncaisser, total: (a) => Math.max(0, a.totals.revenue - a.totals.collected), serie: (d) => Math.max(0, d.revenue - d.collected) },
    resa: { label: 'Réservations', court: 'réservations', format: 'int', detail: 'activity', jour: (j) => j.resa, total: (a) => a.totals.reservations, serie: (d) => d.count },
    joueurs: { label: 'Joueurs', court: 'joueurs', format: 'int', jour: (j) => j.joueurs, total: (a) => a.totals.pax, serie: (d) => d.pax },
    panier: { label: 'Panier par joueur', court: 'panier par joueur', format: 'euro2', argent: true, jour: (j) => j.panier, total: (a) => div(a.totals.revenue, a.totals.pax), serie: (d) => div(d.revenue, d.pax) },
    groupe: { label: 'Taille des groupes', court: 'joueurs par groupe', format: 'dec1', jour: (j) => j.groupe, total: (a) => div(a.totals.pax, a.totals.reservations), serie: (d) => div(d.pax, d.count) },
    occupation: { label: 'Pistes occupées', court: 'pistes occupées', format: 'percent', detail: 'occupation', jour: (j) => j.occupation, total: (a) => (a.occupancy ? a.occupancy.rate : null), serie: (d) => div(d.laneHours, d.capacity, 100) },
    enLigne: { label: 'Réservé en ligne', court: 'réservé en ligne', format: 'percent', jour: (j) => j.enLigne, total: (a) => a.totals.onlineRate, serie: (d) => div(d.online, d.count, 100) },
    annulations: { label: 'Annulations', court: 'annulations', format: 'percent', inverse: true, jour: (j) => j.annulations, total: (a) => a.totals.cancelRate, serie: (d) => div(d.cancelled, d.count + d.cancelled, 100) },
    absents: { label: 'Pas venus', court: 'pas venus', format: 'percent', inverse: true, jour: (j) => j.absents, total: (a) => a.totals.absentRate, serie: (d) => div(d.absents, d.count + d.absents, 100) },
  };
  const ORDRE_STATS = ['ca', 'encaisse', 'aEncaisser', 'resa', 'joueurs', 'panier', 'groupe', 'occupation', 'enLigne', 'annulations', 'absents'];
  const TUILES_PAR_DEFAUT = ['ca', 'resa', 'joueurs', 'absents', 'occupation'];

  const CARTES = {
    heures: { nom: 'Heures pleines et creuses', fixe: '8 dernières semaines' },
    rapporte: { nom: 'Ce qui rapporte' },
    reserve: { nom: 'Déjà réservé', fixe: '14 prochains jours' },
    // `fixe` vide : ce que la carte couvre depend de la periode, elle l ecrit elle-meme.
    pasvenus: { nom: 'Pas venus (no-show)', fixe: '' },
    enligne: { nom: 'En ligne ou au comptoir' },
    clients: { nom: 'Nouveaux et habitués' },
    formules: { nom: 'Formules les plus vendues' },
    occasions: { nom: 'Occasions' },
    paiements: { nom: 'Comment on vous paie', argent: true },
  };
  const ORDRE_CARTES = ['heures', 'rapporte', 'reserve', 'pasvenus', 'enligne', 'clients', 'formules', 'occasions', 'paiements'];
  const CARTES_PAR_DEFAUT = ['heures', 'rapporte', 'reserve', 'pasvenus'];

  const S = { ctx: null, tete: null, panneau: null, cartes: null, jeton: 0, edition: false, choix: null, peint: {}, faits: null, tirage: null, pasVenusAttendu: '' };

  // ---- Reglages du poste ------------------------------------------------------
  function voitLArgent() {
    return !S.ctx || S.ctx.seesMoney !== false;
  }

  function statsPermises() {
    return ORDRE_STATS.filter((id) => voitLArgent() || !STATS[id].argent);
  }

  function reglages() {
    const r = state.dashPilotage && typeof state.dashPilotage === 'object' ? state.dashPilotage : {};
    state.dashPilotage = r;
    if (!PERIODES.some((p) => p.id === r.periode)) r.periode = 'jour';
    const permises = statsPermises();
    const voulues = (Array.isArray(r.tuiles) && r.tuiles.length ? r.tuiles : TUILES_PAR_DEFAUT).filter((id, i, l) => STATS[id] && l.indexOf(id) === i);
    const tuiles = voulues.filter((id) => permises.includes(id)).slice(0, NB_TUILES);
    // Un role sans « Voir les montants » voit d autres chiffres a la place, jamais un trou.
    permises.forEach((id) => { if (tuiles.length < NB_TUILES && !tuiles.includes(id)) tuiles.push(id); });
    const cartes = (Array.isArray(r.cartes) ? r.cartes : CARTES_PAR_DEFAUT).filter((id, i, l) => CARTES[id] && l.indexOf(id) === i);
    // Le jour ouvre sur les arrivees, une periode sur le chiffre, tant que le gerant n a rien choisi.
    const defaut = r.periode === 'jour' ? 'joueurs' : (voitLArgent() ? 'ca' : 'resa');
    const active = tuiles.includes(r.active) ? r.active : (tuiles.includes(defaut) ? defaut : tuiles[0]);
    return { periode: r.periode, tuiles, cartes: cartes.filter((id) => voitLArgent() || !CARTES[id].argent), active };
  }

  function retenir(changement) {
    const r = state.dashPilotage && typeof state.dashPilotage === 'object' ? state.dashPilotage : {};
    Object.assign(r, changement);
    state.dashPilotage = r;
    if (typeof save === 'function') save();
  }

  // ---- Dates ------------------------------------------------------------------
  const ancre = () => (state.currentDate > todayStr() ? todayStr() : state.currentDate);
  const dateDe = (iso) => parseLocalDate(iso);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  function fenetre(id) {
    const p = PERIODES.find((x) => x.id === id);
    if (id === 'jour') return { ...p, debut: state.currentDate, fin: state.currentDate };
    const fin = ancre();
    const d = dateDe(fin);
    const debut = id === 'mois' ? iso(new Date(d.getFullYear(), d.getMonth(), 1)) : addDays(fin, 1 - p.jours);
    // UN CENTRE VIT A LA SEMAINE : un samedi se compare a un samedi. Le mois d avant a la meme
    // date ne contient pas autant de week-ends, et 30 jours decales de 30 mettent les deux
    // courbes a contretemps. La comparaison recule donc de semaines entieres, sans recouvrir
    // la periode (le serveur le refuserait).
    const nb = Math.round((d - dateDe(debut)) / 86400000) + 1;
    const recul = id === '7j' ? 7 : (id === 'mois' && nb <= 28 ? 28 : 35);
    // Une date passee choisie en haut de page : le titre dit ou la periode s arrete.
    const jolie = d.toLocaleDateString('fr-BE', { day: 'numeric', month: 'long' });
    const titre = fin === todayStr() ? p.titre : (id === 'mois' ? `Du 1er au ${jolie}` : `${p.jours} jours jusqu’au ${jolie}`);
    return { ...p, titre, debut, fin, compareDebut: addDays(debut, -recul), compareFin: addDays(fin, -recul) };
  }

  function dit(isoJour, n) {
    const d = dateDe(isoJour);
    const long = d.toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' });
    const label = n <= 14
      ? d.toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric' }).replace('.', '')
      : d.toLocaleDateString('fr-BE', { day: 'numeric', month: 'short' }).replace('.', '');
    return { label, long };
  }

  // ---- Ecrire un chiffre ------------------------------------------------------
  function ecrire(v, format) {
    if (v === null || v === undefined || !Number.isFinite(Number(v))) return '-';
    const n = Number(v);
    if (format === 'euro') return formatMoney(Math.round(n));
    if (format === 'euro2') return `${n.toFixed(2).replace('.', ',')} €`;
    if (format === 'dec1') return n.toFixed(1).replace('.', ',');
    if (format === 'percent') return `${Math.round(n)}%`;
    return new Intl.NumberFormat('fr-BE', { maximumFractionDigits: 0 }).format(Math.round(n));
  }

  const nomJour = (long) => long.charAt(0).toUpperCase() + long.slice(1);

  // Le petit ecart de la tuile : un pourcentage, ou des points pour un taux. Une annulation
  // qui baisse est une bonne nouvelle : la couleur suit le sens, pas le signe.
  function ecart(st, v, ref) {
    if (v === null || v === undefined || ref === null || ref === undefined) return null;
    let texte;
    let signe;
    if (st.format === 'percent') {
      const pts = Math.round(v) - Math.round(ref);
      signe = Math.sign(pts);
      texte = `${pts > 0 ? '+' : ''}${pts} pt${Math.abs(pts) > 1 ? 's' : ''}`;
    } else {
      if (!(ref > 0)) return null;
      const pct = Math.round(((v - ref) / ref) * 100);
      signe = Math.sign(pct);
      texte = `${pct > 0 ? '+' : ''}${pct}%`;
    }
    const bien = st.inverse ? signe < 0 : signe > 0;
    return { texte, ton: signe === 0 ? 'flat' : (bien ? 'up' : 'down') };
  }

  // ---- La journee, lue sur le poste --------------------------------------------
  function journee() {
    const m = S.ctx.metrics;
    const toutes = state.reservations.filter((r) => r.date === state.currentDate);
    const actives = m.activeReservations;
    const nb = actives.length;
    const annulees = toutes.filter((r) => r.status === 'cancelled').length;
    // Lus sur les dossiers du jour, comme les annulees : le taux ne depend pas de la liste active.
    const attendus = toutes.filter((r) => r.status !== 'cancelled');
    return {
      ca: m.revenue,
      encaisse: m.collected,
      aEncaisser: Math.max(0, m.revenue - m.collected),
      resa: nb,
      joueurs: m.players,
      panier: div(m.revenue, m.players),
      groupe: div(m.players, nb),
      occupation: m.planningWindow.closed ? null : m.occupancy,
      enLigne: div(actives.filter((r) => r.channel === 'public').length, nb, 100),
      annulations: div(annulees, toutes.length, 100),
      absents: div(attendus.filter((r) => r.absentAt).length, attendus.length, 100),
    };
  }

  function referenceDuJour() {
    const m = S.ctx.metrics;
    return {
      ca: m.referenceRevenue,
      resa: m.referenceReservations,
      joueurs: m.referencePlayers,
      occupation: m.referenceOccupancy,
      panier: m.referencePlayers > 0 && m.referenceRevenue !== null ? m.referenceRevenue / m.referencePlayers : null,
      groupe: m.referenceReservations > 0 && m.referencePlayers !== null ? m.referencePlayers / m.referenceReservations : null,
    };
  }

  // Ce que disent les dossiers de la journee, dans la forme des reponses du serveur.
  function faitsDuJour() {
    const m = S.ctx.metrics;
    const actives = m.activeReservations;
    const parNom = (cle) => {
      const groupes = new Map();
      actives.forEach((r) => {
        const nom = cle(r);
        if (!nom) return;
        const g = groupes.get(nom) || { label: nom, nb: 0, ca: 0 };
        g.nb += 1;
        g.ca += Number(r.price) || 0;
        groupes.set(nom, g);
      });
      return [...groupes.values()].sort((a, b) => b.nb - a.nb);
    };
    const moyens = new Map([['carte', { label: 'Carte', nb: 0, montant: 0 }], ['especes', { label: 'Espèces', nb: 0, montant: 0 }], ['autre', { label: 'Non précisé', nb: 0, montant: 0 }]]);
    actives.filter((r) => r.status === 'paid').forEach((r) => {
      const v = String(r.paymentMethod || '').trim().toLowerCase();
      const g = moyens.get(/^carte|^card/.test(v) ? 'carte' : (/^esp[eè]ces$|^cash$/.test(v) ? 'especes' : 'autre'));
      g.nb += 1;
      g.montant += r.amountPaid !== null && r.amountPaid !== undefined && Number.isFinite(Number(r.amountPaid)) ? Number(r.amountPaid) : (Number(r.price) || 0);
    });
    const enLigne = actives.filter((r) => r.channel === 'public').length;
    return {
      activites: m.activityMix.map((b) => ({ label: b.label, nb: b.count, ca: b.revenue })),
      canaux: { enLigne, comptoir: actives.length - enLigne, avant: null },
      clients: null,
      formules: parNom((r) => (r.type === 'formule' || r.formuleId ? (r.label || 'Formule') : '')),
      occasions: parNom((r) => libelleOccasion(r.occasion)),
      paiements: [...moyens.values()],
      pasVenus: null,
    };
  }

  function libelleOccasion(cle) {
    if (!cle) return '';
    return STAFF_OCCASION_LABELS[String(cle).toLowerCase()] || String(cle);
  }

  function faitsDePeriode(reponse) {
    const a = reponse.analytics;
    const activites = Object.values(a.byActivity || {}).map((b) => ({ label: b.label, nb: b.count, ca: b.revenue }));
    const canal = (nom, liste) => ((liste || []).find((c) => c.channel === nom) || { count: 0 }).count;
    const enLigne = canal('en ligne', a.byChannel);
    const comptoir = canal('staff', a.byChannel);
    const pAvant = reponse.previous && reponse.previous.byChannel;
    const totalAvant = canal('en ligne', pAvant) + canal('staff', pAvant);
    return {
      activites,
      canaux: { enLigne, comptoir, avant: totalAvant ? (canal('en ligne', pAvant) / totalAvant) * 100 : null },
      clients: a.clients || null,
      formules: (a.byFormule || []).map((f) => ({ label: f.label || f.id || 'Formule', nb: f.count, ca: f.revenue })),
      occasions: (a.byOccasion || []).map((o) => ({ label: libelleOccasion(o.occasion) || 'Autre', nb: o.count })),
      paiements: (a.byPaymentMethod || []).map((m) => ({ label: m.label, nb: m.count, montant: m.amount })),
      pasVenus: pasVenusDe(a, false),
    };
  }

  // Les pas venus d une reponse du serveur. Huit semaines se lisent par blocs de sept jours pleins
  // en partant de la fin : une semaine civile coupee ferait deux barres trop courtes.
  function pasVenusDe(a, parSemaine) {
    const jours = a.daily || [];
    const points = [];
    if (parSemaine) {
      for (let fin = jours.length; fin > 0; fin -= 7) {
        const bloc = jours.slice(Math.max(0, fin - 7), fin);
        points.unshift({ label: `Sem. du ${dit(bloc[0].date, 15).label}`, value: bloc.reduce((s, d) => s + (Number(d.absents) || 0), 0) });
      }
    } else {
      jours.forEach((d) => points.push({ label: dit(d.date, jours.length).label, value: Number(d.absents) || 0 }));
    }
    const t = a.totals || {};
    return { fenetre: `${a.startDate}|${a.endDate}`, groupes: Number(t.absents) || 0, joueurs: Number(t.absentPax) || 0, perdu: Number(t.absentRevenue) || 0, taux: Number(t.absentRate) || 0, points };
  }

  // ---- Lectures au serveur (une reponse sert 60 s) -------------------------------
  const lectures = new Map();
  function lire(url, cle, duree, valide) {
    const e = lectures.get(cle);
    if (e && e.reponse && Date.now() - e.le < duree) return Promise.resolve(e.reponse);
    if (e && e.enCours) return e.enCours;
    const enCours = apiRequest(url).then((reponse) => {
      // Une reponse sans chiffres est une panne, comme un refus : rien a garder.
      if (valide && !valide(reponse)) throw new Error('reponse sans chiffres');
      lectures.set(cle, { reponse, le: Date.now() });
      return reponse;
    }).catch((erreur) => {
      lectures.delete(cle);
      throw erreur;
    });
    lectures.set(cle, { ...(e || {}), enCours });
    return enCours;
  }

  const centre = () => getCurrentStaffCenterId();

  function analyse(f, duree = 60000) {
    const q = `startDate=${f.debut}&endDate=${f.fin}${f.compareDebut ? `&compareStart=${f.compareDebut}&compareEnd=${f.compareFin}` : ''}`;
    return lire(`${API_ENDPOINTS.ops}?action=dashboardAnalytics&centerId=${encodeURIComponent(centre())}&${q}`, `${centre()}|${q}`, duree, (reponse) => Boolean(reponse && reponse.analytics));
  }

  // ---- Construction ---------------------------------------------------------------
  function construire() {
    S.tete = document.createElement('div');
    S.tete.className = 'plt-tete dash-section-head';
    S.tete.innerHTML = `
      <div class="plt-titres"><h2 data-plt-titre></h2><span class="dash-card-meta" data-plt-legende></span></div>
      <div class="plt-commandes">
        <div class="pv2-seg plt-seg" role="group" aria-label="Période"><span class="pv2-seg-pill"></span>${PERIODES.map((p) => `<button type="button" data-plt-periode="${p.id}">${escapeHtml(p.label)}</button>`).join('')}</div>
        <button type="button" class="plt-modifier" data-plt-modifier aria-pressed="false">Modifier</button>
      </div>`;
    S.panneau = document.createElement('article');
    S.panneau.className = 'dash-card plt-panneau';
    S.panneau.innerHTML = `
      <div class="plt-tuiles dash-kpis" role="group" aria-label="Ce que montre le graphique" data-plt-tuiles></div>
      <div class="plt-graphe">
        <div class="plt-graphe-tete">
          <p class="plt-phrase" data-plt-phrase></p>
          <div class="plt-legende" data-plt-legende-courbe></div>
        </div>
        <div class="plt-courbe dash-range-chart" data-plt-courbe></div>
      </div>`;
    S.cartes = document.createElement('div');
    S.cartes.className = 'plt-cartes';
    S.tete.addEventListener('click', surClic);
    S.panneau.addEventListener('click', surClic);
    S.cartes.addEventListener('click', surClic);
    S.cartes.addEventListener('pointerdown', surAppuiPoignee);
    document.addEventListener('click', (ev) => {
      if (S.choix && !S.choix.contains(ev.target) && !(ev.target.closest && ev.target.closest('[data-plt-ouvre-choix]'))) fermerChoix();
    });
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && S.choix) fermerChoix(true); });
    const replacer = (ev) => { if (S.choix && !(ev.target && S.choix.contains && ev.target.nodeType === 1 && S.choix.contains(ev.target))) S.placerChoix(); };
    document.addEventListener('scroll', replacer, true);
    window.addEventListener('resize', replacer);
  }

  // ---- Affichage ----------------------------------------------------------------
  // ctx : { metrics, dayReservations, seesMoney, legendeDuJour, slots: { tete, panneau, cartes } }
  function afficher(ctx) {
    S.ctx = ctx;
    if (!S.tete) construire();
    // Le innerHTML de la page a deja retire ces noeuds : le focus d avant vient de la page.
    const focus = ctx.focusAvant;
    const dedans = focus && [S.tete, S.panneau, S.cartes].some((n) => n.contains(focus));
    ctx.slots.tete.appendChild(S.tete);
    ctx.slots.panneau.appendChild(S.panneau);
    ctx.slots.cartes.appendChild(S.cartes);
    if (dedans && focus.isConnected) focus.focus({ preventScroll: true });
    rafraichir();
  }

  function rafraichir() {
    if (!S.ctx) return;
    const r = reglages();
    const f = fenetre(r.periode);
    peindreTete(r, f);
    if (r.periode === 'jour') {
      S.jeton += 1;
      S.panneau.removeAttribute('data-charge');
      S.faits = faitsDuJour();
      peindreChiffres(r, f, null);
      peindreCartes(r, f);
      return;
    }
    const jeton = (S.jeton += 1);
    if (S.tirage !== `${f.id}|${f.debut}|${f.fin}`) S.panneau.setAttribute('data-charge', '1');
    analyse(f).then((reponse) => {
      if (jeton !== S.jeton) return;
      S.tirage = `${f.id}|${f.debut}|${f.fin}`;
      S.panneau.removeAttribute('data-charge');
      S.faits = faitsDePeriode(reponse);
      peindreChiffres(r, f, reponse);
      peindreCartes(r, f);
    }, () => {
      if (jeton !== S.jeton) return;
      S.panneau.removeAttribute('data-charge');
      peindreErreur();
    });
  }

  function poser(el, html, cle) {
    if (S.peint[cle] === html) return false;
    S.peint[cle] = html;
    el.innerHTML = html;
    return true;
  }

  function peindreTete(r, f) {
    S.tete.querySelector('[data-plt-titre]').textContent = f.titre;
    S.tete.querySelector('[data-plt-legende]').textContent = f.id === 'jour' ? (S.ctx.legendeDuJour || '') : f.legende;
    const seg = S.tete.querySelector('.plt-seg');
    seg.querySelectorAll('[data-plt-periode]').forEach((b) => {
      const on = b.dataset.pltPeriode === r.periode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    placerPilule();
    const bouton = S.tete.querySelector('[data-plt-modifier]');
    bouton.textContent = S.edition ? 'Terminé' : 'Modifier';
    bouton.setAttribute('aria-pressed', S.edition ? 'true' : 'false');
    bouton.classList.toggle('is-on', S.edition);
  }

  function placerPilule() {
    const seg = S.tete && S.tete.querySelector('.plt-seg');
    if (!seg) return;
    const actif = seg.querySelector('.active');
    if (!actif || !actif.offsetWidth) return;
    seg.style.setProperty('--pv2-pill-x', `${actif.offsetLeft}px`);
    seg.style.setProperty('--pv2-pill-w', `${actif.offsetWidth}px`);
  }

  function peindreErreur() {
    poser(S.panneau.querySelector('[data-plt-tuiles]'), '', 'tuiles');
    poser(S.panneau.querySelector('[data-plt-phrase]'), 'Ces chiffres ne sont pas disponibles pour le moment.', 'phrase');
    poser(S.panneau.querySelector('[data-plt-legende-courbe]'), '<button type="button" class="plt-reessayer" data-plt-reessayer>Réessayer</button>', 'legendeCourbe');
    delete S.peint.courbe;
    const hote = S.panneau.querySelector('[data-plt-courbe]');
    hote.innerHTML = '';
    hote.__plcTrend = null;
  }

  // ---- Tuiles et graphique --------------------------------------------------------
  function peindreChiffres(r, f, reponse) {
    const valeurs = {};
    const references = {};
    if (f.id === 'jour') {
      const j = journee();
      const ref = referenceDuJour();
      r.tuiles.forEach((id) => { valeurs[id] = STATS[id].jour(j); references[id] = ref[id] === undefined ? null : ref[id]; });
    } else {
      const a = reponse.analytics;
      const p = reponse.previous || {};
      const avant = { totals: p.totals || {}, occupancy: p.occupancy };
      r.tuiles.forEach((id) => {
        valeurs[id] = STATS[id].total(a);
        references[id] = p.totals ? STATS[id].total(avant) : null;
      });
    }
    const html = r.tuiles.map((id) => {
      const st = STATS[id];
      const on = id === r.active;
      const e = ecart(st, valeurs[id], references[id]);
      return `<button type="button" class="plt-tuile dash-kpi${on ? ' is-on' : ''}" aria-pressed="${on}" data-plt-tuile="${id}" data-kpi="${id}"${S.edition ? ' data-plt-ouvre-choix aria-haspopup="menu"' : ''}>
        <span class="dash-kpi-label">${escapeHtml(st.label)}</span>
        <strong class="dash-kpi-value"${f.id === 'jour' ? ` data-pl-num="dash.${id}"` : ''}>${escapeHtml(ecrire(valeurs[id], st.format))}</strong>
        <span class="plt-tuile-bas">${S.edition ? '<span class="plt-changer">Changer</span>' : (e ? `<span class="dash-kpi-delta ${e.ton}">${escapeHtml(e.texte)}</span>` : '')}</span>
      </button>`;
    }).join('');
    S.panneau.classList.toggle('is-edition', S.edition);
    poser(S.panneau.querySelector('[data-plt-tuiles]'), html, 'tuiles');
    if (f.id === 'jour') peindreHeures(r); else peindreCourbe(r, f, reponse, valeurs[r.active], references[r.active]);
  }

  // Le jour : par heure d arrivee (chaque groupe une fois, a l heure ou il arrive). Chaque
  // heure porte la meme ligne de chiffres qu un jour de la periode, les stats se dessinent
  // donc de la meme facon. Les pistes occupees se lisent heure par heure, sur les vrais blocs.
  function lignesParHeure(m) {
    const debut = Math.floor(m.planningWindow.open);
    const fin = Math.ceil(m.planningWindow.close);
    const seaux = new Map();
    for (let h = debut; h < fin; h += 1) seaux.set(h, { count: 0, pax: 0, revenue: 0, collected: 0, online: 0, cancelled: 0, absents: 0, laneHours: 0, capacity: m.laneCount });
    const seau = (res) => seaux.get(Math.min(Math.max(Math.floor(getStaffTerrainSpan(res).start), debut), fin - 1));
    m.activeReservations.forEach((res) => {
      // Un groupe pas venu se compte juste apres, dans `absents` et rien d autre : c est la ligne
      // d un jour du serveur, et le taux ne le divise pas deux fois.
      if (res.absentAt) return;
      const s = seau(res);
      if (!s) return;
      const prix = Number(res.price) || 0;
      s.count += 1;
      s.pax += Number(res.pax) || 0;
      s.revenue += prix;
      if (res.status === 'paid') s.collected += prix;
      if (res.channel === 'public') s.online += 1;
    });
    state.reservations.filter((res) => res.date === state.currentDate && (res.status === 'cancelled' || res.absentAt)).forEach((res) => {
      const s = seau(res);
      if (!s) return;
      if (res.status === 'cancelled') s.cancelled += 1; else s.absents += 1;
    });
    (m.bowlingWindows || []).forEach((w) => {
      const pistes = Math.max((w.lanes || []).length, 1);
      const finBloc = Number(w.start) + (Number(w.duration) || 0);
      seaux.forEach((s, h) => {
        const recouvre = Math.min(finBloc, h + 1) - Math.max(Number(w.start), h);
        if (recouvre > 0) s.laneHours += recouvre * pistes;
      });
    });
    return [...seaux.entries()];
  }

  function nomParHeure(id) {
    if (id === 'joueurs') return 'Arrivées par heure';
    if (id === 'occupation') return 'Pistes occupées par heure';
    return `${STATS[id].label} par heure d’arrivée`;
  }

  function phraseDuPic(id, st, pic) {
    const n = Math.round(pic.value);
    const valeur = id === 'joueurs' ? `${n} joueur${n > 1 ? 's' : ''}`
      : id === 'resa' ? `${n} réservation${n > 1 ? 's' : ''}`
        : ecrire(pic.value, st.format);
    return `${st.inverse ? 'Le plus haut est à' : 'Votre pic est à'} ${pic.label}, avec ${valeur}.`;
  }

  function peindreHeures(r) {
    const hote = S.panneau.querySelector('[data-plt-courbe]');
    const phrase = S.panneau.querySelector('[data-plt-phrase]');
    const legende = S.panneau.querySelector('[data-plt-legende-courbe]');
    const m = S.ctx.metrics;
    const id = r.active;
    const st = STATS[id];
    const detail = st.detail ? `<button type="button" class="plt-detail" onclick="openStaffDashboardDetail('${st.detail}')">Voir le détail</button>` : '';
    poser(legende, `<span class="plt-nom-courbe">${escapeHtml(nomParHeure(id))}</span>${detail}`, 'legendeCourbe');
    const vide = (texte) => {
      poser(phrase, '', 'phrase');
      if (S.peint.courbe !== texte) { hote.innerHTML = `<div class="dash-empty">${escapeHtml(texte)}</div>`; S.peint.courbe = texte; hote.__plcTrend = null; }
    };
    if (m.planningWindow.closed) { vide('Centre fermé ce jour-là.'); return; }
    if (!m.activeReservations.length) { vide('Aucune réservation sur cette date.'); return; }
    const series = lignesParHeure(m).map(([h, ligne]) => ({ label: formatClockDisplay(h), value: st.serie(ligne) || 0 }));
    if (series.every((p) => !p.value)) { vide(id === 'joueurs' ? 'Aucune arrivée sur les heures d’ouverture.' : 'Rien à montrer sur cette journée.'); return; }
    const pic = series.reduce((a, b) => (b.value > a.value ? b : a));
    poser(phrase, escapeHtml(phraseDuPic(id, st, pic)), 'phrase');
    const past = m.liveNow ? Math.floor(m.liveNow.now) - Math.floor(m.planningWindow.open) : -1;
    const cle = `jour|${id}|${state.currentDate}|${past}|${series.map((p) => p.value).join(',')}`;
    if (S.peint.courbe !== cle) {
      S.peint.courbe = cle;
      hote.__plcTrend = null;
      window.PinlaneCharts.barChart(hote, { series, format: st.format, height: 236, pastBefore: past, motionKey: `plt|jour|${id}|${state.currentDate}|${m.activeReservations.length}` });
    }
  }

  function peindreCourbe(r, f, reponse, total, ref) {
    const hote = S.panneau.querySelector('[data-plt-courbe]');
    const st = STATS[r.active];
    const a = reponse.analytics;
    const p = reponse.previous || {};
    const jours = a.daily || [];
    const n = jours.length;
    const series = jours.map((d) => ({ ...dit(d.date, n), value: st.serie(d) }));
    const compare = (p.daily || []).slice(0, n).map((d) => ({ ...dit(d.date, n), value: st.serie(d) }));
    poser(S.panneau.querySelector('[data-plt-legende-courbe]'), `<span class="plt-cle"><i class="plt-trait"></i>${escapeHtml(f.titre.replace(/^Les 7/, '7').replace(/^Les 30/, '30'))}</span><span class="plt-cle"><i class="plt-trait is-avant"></i>${escapeHtml(nomJour(f.avant))}</span>`, 'legendeCourbe');
    poser(S.panneau.querySelector('[data-plt-phrase]'), escapeHtml(phraseCourbe(st, series, total, ref, f)), 'phrase');
    const cle = `${f.id}|${r.active}|${f.debut}|${f.fin}|${series.map((x) => x.value).join(',')}|${compare.map((x) => x.value).join(',')}`;
    if (S.peint.courbe !== cle) {
      S.peint.courbe = cle;
      window.PinlaneCharts.trendChart(hote, { series, compare, format: st.format, relier: st.format !== 'euro' && st.format !== 'int', height: 260, motionKey: `plt|${f.id}|${f.debut}|${f.fin}`, ariaLabel: `${st.label} sur la période, comparé à ${f.avant}` });
    }
  }

  function phraseCourbe(st, series, total, ref, f) {
    const morceaux = [];
    if (total !== null && total !== undefined && ref !== null && ref !== undefined) {
      if (st.format === 'percent') {
        const pts = Math.round(total) - Math.round(ref);
        morceaux.push(pts ? `${Math.abs(pts)} point${Math.abs(pts) > 1 ? 's' : ''} de ${pts > 0 ? 'plus' : 'moins'} que ${f.avant}.` : `Autant que ${f.avant}.`);
      } else if (ref > 0) {
        const pct = Math.round(((total - ref) / ref) * 100);
        morceaux.push(pct ? `${Math.abs(pct)} % de ${pct > 0 ? 'plus' : 'moins'} que ${f.avant}.` : `Autant que ${f.avant}.`);
      }
    }
    const valides = series.filter((x) => x.value !== null && x.value !== undefined && x.value > 0);
    if (valides.length > 1) {
      const haut = valides.reduce((a, b) => (b.value > a.value ? b : a));
      morceaux.push(`${st.inverse ? 'Le jour le plus touché est' : 'Le meilleur jour est'} ${haut.long}, avec ${ecrire(haut.value, st.format)}.`);
    }
    return morceaux.join(' ');
  }

  // ---- Les cartes -----------------------------------------------------------------
  function peindreCartes(r) {
    const voulues = r.cartes;
    const presentes = [...S.cartes.querySelectorAll('.plt-carte')].map((c) => c.dataset.pltCarte);
    S.cartes.classList.toggle('is-edition', S.edition);
    if (presentes.join() !== voulues.join()) {
      const garde = new Map([...S.cartes.querySelectorAll('.plt-carte')].map((c) => [c.dataset.pltCarte, c]));
      S.cartes.textContent = '';
      voulues.forEach((id) => S.cartes.appendChild(garde.get(id) || creerCarte(id)));
    }
    let ajout = S.cartes.querySelector('.plt-ajout');
    const restantes = ORDRE_CARTES.filter((id) => !voulues.includes(id) && (voitLArgent() || !CARTES[id].argent));
    if (S.edition && restantes.length) {
      if (!ajout) {
        ajout = document.createElement('button');
        ajout.type = 'button';
        ajout.className = 'plt-ajout';
        ajout.setAttribute('data-plt-ajouter', '');
        ajout.setAttribute('data-plt-ouvre-choix', '');
        ajout.innerHTML = '<span aria-hidden="true">+</span>Ajouter une carte';
      }
      S.cartes.appendChild(ajout);
    } else if (ajout) ajout.remove();
    voulues.forEach((id) => peindreCarte(id, S.cartes.querySelector(`[data-plt-carte="${id}"]`)));
  }

  function creerCarte(id) {
    // Une carte neuve est vide : ce qui a ete peint sur la precedente ne vaut plus pour elle.
    delete S.peint[`carte-p-${id}`];
    delete S.peint[`carte-c-${id}`];
    const carte = document.createElement('article');
    carte.className = 'dash-card plt-carte';
    carte.dataset.pltCarte = id;
    carte.innerHTML = `
      <div class="plt-carte-tete">
        <button type="button" class="plt-poignee" data-plt-poignee aria-label="Déplacer ${escapeHtml(CARTES[id].nom)}"><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="4" cy="3.5" r="1.2"/><circle cx="10" cy="3.5" r="1.2"/><circle cx="4" cy="7" r="1.2"/><circle cx="10" cy="7" r="1.2"/><circle cx="4" cy="10.5" r="1.2"/><circle cx="10" cy="10.5" r="1.2"/></svg></button>
        <h3 class="plt-carte-nom">${escapeHtml(CARTES[id].nom)}</h3>
        ${CARTES[id].fixe !== undefined ? `<span class="dash-card-meta" data-plt-carte-meta>${escapeHtml(CARTES[id].fixe)}</span>` : ''}
        <button type="button" class="plt-retirer" data-plt-retirer="${id}" aria-label="Retirer ${escapeHtml(CARTES[id].nom)}"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3 L9 9 M9 3 L3 9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>
      </div>
      <p class="plt-phrase" data-plt-carte-phrase></p>
      <div class="plt-carte-corps" data-plt-carte-corps></div>`;
    return carte;
  }

  function peindreCarte(id, carte) {
    if (!carte) return;
    const phrase = carte.querySelector('[data-plt-carte-phrase]');
    const corps = carte.querySelector('[data-plt-carte-corps]');
    const dire = (texte, html, cle) => {
      poser(phrase, escapeHtml(texte), `carte-p-${id}`);
      if (html !== undefined) poser(corps, html, cle || `carte-c-${id}`);
    };
    const f = S.faits || {};
    const montants = voitLArgent();
    if (id === 'rapporte') {
      const lignes = [...(f.activites || [])].sort((a, b) => (montants ? b.ca - a.ca : b.nb - a.nb));
      const total = lignes.reduce((s, l) => s + (montants ? l.ca : l.nb), 0);
      if (!total) { dire('Aucune vente sur cette période.', ''); return; }
      const tete = lignes[0];
      const part = Math.round(((montants ? tete.ca : tete.nb) / total) * 100);
      dire(`${tete.label} fait ${part} % de ${montants ? 'votre chiffre' : 'vos réservations'}.`, rangHtml(pli(lignes, montants), total, montants));
    } else if (id === 'enligne') {
      const c = f.canaux || { enLigne: 0, comptoir: 0 };
      const total = c.enLigne + c.comptoir;
      if (!total) { dire('Aucune réservation sur cette période.', ''); return; }
      const part = Math.round((c.enLigne / total) * 100);
      const ecartPts = c.avant === null || c.avant === undefined ? null : part - Math.round(c.avant);
      dire(`Le site fait ${part} % de vos réservations${ecartPts ? `, ${Math.abs(ecartPts)} point${Math.abs(ecartPts) > 1 ? 's' : ''} de ${ecartPts > 0 ? 'plus' : 'moins'} qu’avant` : ''}.`, partsHtml([{ label: 'En ligne', v: c.enLigne }, { label: 'Au comptoir', v: c.comptoir }], (v) => `${v} réservation${v > 1 ? 's' : ''}`));
    } else if (id === 'clients') {
      const c = f.clients;
      if (!c || !c.unique) { dire('Cette carte se lit sur 7 jours ou plus.', ''); return; }
      const part = Math.round((c.new / c.unique) * 100);
      dire(`${part} % de vos clients viennent pour la première fois.`, partsHtml([{ label: 'Nouveaux', v: c.new }, { label: 'Déjà venus', v: c.returning }], (v) => `${v} client${v > 1 ? 's' : ''}`));
    } else if (id === 'formules') {
      const lignes = [...(f.formules || [])].sort((a, b) => b.nb - a.nb);
      if (!lignes.length) { dire('Aucune formule vendue sur cette période.', ''); return; }
      dire(`${lignes[0].label} est votre formule la plus vendue.`, rangHtml(pli(lignes, false), lignes.reduce((s, l) => s + l.nb, 0), false));
    } else if (id === 'occasions') {
      const lignes = [...(f.occasions || [])].sort((a, b) => b.nb - a.nb);
      if (!lignes.length) { dire('Aucune occasion renseignée sur cette période.', ''); return; }
      const total = lignes.reduce((s, l) => s + l.nb, 0);
      dire(`${lignes[0].label} revient dans ${Math.round((lignes[0].nb / total) * 100)} % des réservations qui disent leur occasion.`, rangHtml(pli(lignes, false), total, false));
    } else if (id === 'paiements') {
      const lignes = (f.paiements || []).filter((l) => l.montant > 0);
      const total = lignes.reduce((s, l) => s + l.montant, 0);
      if (!total) { dire('Rien d’encaissé sur cette période.', ''); return; }
      const tete = [...lignes].sort((a, b) => b.montant - a.montant)[0];
      dire(`${Math.round((tete.montant / total) * 100)} % de ce que vous encaissez passe par ${tete.label === 'Carte' ? 'la carte' : (tete.label === 'Espèces' ? 'les espèces' : 'un moyen non précisé')}.`, partsHtml(lignes.map((l) => ({ label: l.label, v: l.montant })), (v) => ecrire(v, 'euro')));
    } else if (id === 'heures') {
      peindreHeuresCreuses(carte, phrase, corps);
    } else if (id === 'reserve') {
      peindreReserve(carte, phrase, corps);
    } else if (id === 'pasvenus') {
      peindrePasVenus(carte, phrase, corps);
    }
  }

  // Au-dela de cinq lignes, le reste se replie en une seule : au-dessus de la lecture rapide.
  function pli(lignes, montants) {
    if (lignes.length <= 5) return lignes;
    const reste = lignes.slice(4);
    return [...lignes.slice(0, 4), { label: `Autres (${reste.length})`, nb: reste.reduce((s, l) => s + l.nb, 0), ca: montants ? reste.reduce((s, l) => s + l.ca, 0) : 0 }];
  }

  // Un « 0 % » devant 148 € se lit comme une erreur.
  function part(v, total) {
    const x = (v / total) * 100;
    return x > 0 && x < 1 ? '<1\u202F%' : `${Math.round(x)}\u202F%`;
  }

  function rangHtml(lignes, total, montants) {
    const haut = Math.max(...lignes.map((l) => (montants ? l.ca : l.nb)), 1);
    return `<ul class="plt-rang">${lignes.map((l) => {
      const v = montants ? l.ca : l.nb;
      return `<li><span class="plt-rang-nom" title="${escapeHtml(l.label)}">${escapeHtml(l.label)}</span><span class="plt-rang-barre"><i style="width:${Math.max(2, Math.round((v / haut) * 100))}%"></i></span><b>${escapeHtml(montants ? ecrire(v, 'euro') : String(v))}</b><small>${escapeHtml(part(v, total))}</small></li>`;
    }).join('')}</ul>`;
  }

  function partsHtml(parts, texte) {
    const total = parts.reduce((s, p) => s + p.v, 0);
    return `<div class="plt-parts" role="img" aria-label="${escapeHtml(parts.map((p) => `${p.label} ${Math.round((p.v / total) * 100)}%`).join(', '))}">${parts.map((p, i) => `<i class="ton-${i + 1}" style="flex:${p.v || 0.001} 1 0"></i>`).join('')}</div>
      <ul class="plt-parts-legende">${parts.map((p, i) => `<li><i class="ton-${i + 1}"></i><span>${escapeHtml(p.label)}</span><b>${escapeHtml(texte(p.v))}</b><small>${escapeHtml(part(p.v, total))}</small></li>`).join('')}</ul>`;
  }

  // Le creneau de la semaine : huit semaines, quelle que soit la periode choisie. Une semaine
  // seule ne dit pas ce qui se repete.
  const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
  const JOURS_COURTS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

  function peindreHeuresCreuses(carte, phrase, corps) {
    const fin = ancre();
    const f = { debut: addDays(fin, -55), fin };
    const jeton = `${centre()}|${f.debut}|${f.fin}`;
    analyse(f, 600000).then((reponse) => {
      if (!carte.isConnected) return;
      const heat = reponse.analytics.heatmap || [];
      // Les heures ouvertes de chaque jour de la semaine, lues sur la semaine qui finit.
      const ouvert = JOURS.map(() => null);
      for (let i = 0; i < 7; i += 1) {
        const d = addDays(fin, -i);
        const rang = (dateDe(d).getDay() + 6) % 7;
        const w = getPlanningWindow(d);
        if (!w.closed) ouvert[rang] = { de: Math.floor(w.open), a: Math.ceil(w.close) };
      }
      const ouverts = ouvert.filter(Boolean);
      if (!ouverts.length) { poser(phrase, 'Centre fermé sur cette période.', `carte-p-heures`); return; }
      const debut = Math.min(...ouverts.map((o) => o.de));
      const finH = Math.max(...ouverts.map((o) => o.a));
      const colonnes = [];
      for (let h = debut; h < finH; h += 1) colonnes.push(h);
      const matrice = JOURS.map((_, r) => colonnes.map((h) => (ouvert[r] && h >= ouvert[r].de && h < ouvert[r].a ? Number((heat[r] || {})[h]) || 0 : null)));
      const total = matrice.flat().reduce((s, v) => s + (v || 0), 0);
      const cle = `${jeton}|${matrice.flat().join(',')}`;
      if (total < 20) {
        poser(phrase, 'Pas encore assez de réservations pour dire vos heures creuses.', 'carte-p-heures');
      } else {
        let creux = null;
        let plein = null;
        matrice.forEach((ligne, r) => ligne.forEach((v, c) => {
          if (v === null) return;
          const h = colonnes[c];
          // La premiere et la derniere heure d un jour sont vides par nature.
          if (h > ouvert[r].de && h < ouvert[r].a - 1 && (!creux || v < creux.v)) creux = { v, r, h };
          if (!plein || v > plein.v) plein = { v, r, h };
        }));
        const dire = (x) => `${nomJour(JOURS[x.r])} à ${x.h} h`;
        poser(phrase, escapeHtml(`${creux ? `${dire(creux)} est votre créneau le plus vide. ` : ''}${dire(plein)} est le plus plein.`), 'carte-p-heures');
      }
      if (S.peint['carte-c-heures'] !== cle || !corps.querySelector('.plc-heatmap')) {
        S.peint['carte-c-heures'] = cle;
        window.PinlaneCharts.heatmapChart(corps, {
          matrix: matrice,
          rowLabels: JOURS_COURTS,
          colLabels: colonnes.map((h) => `${h}`),
          motionKey: `plt|heures|${jeton}`,
          tip: true,
          etiquette: (r, c) => `${nomJour(JOURS[r])} à ${colonnes[c]} h`,
          valeur: (v) => (v ? `${v} groupe${v > 1 ? 's' : ''} en 8 semaines` : 'aucun groupe en 8 semaines'),
        });
      }
    }, () => {
      if (carte.isConnected) poser(phrase, 'Ces chiffres ne sont pas disponibles pour le moment.', 'carte-p-heures');
    });
  }

  // Ce qui est deja dans le carnet, sur les 14 prochains jours : la serie du jour au serveur.
  function peindreReserve(carte, phrase, corps) {
    const debut = todayStr();
    const fin = addDays(debut, 13);
    const montants = voitLArgent();
    lire(`${API_ENDPOINTS.staffState}?date=${encodeURIComponent(fin)}&centerId=${encodeURIComponent(centre())}&days=14`, `${centre()}|reserve|${fin}`, 60000).then((reponse) => {
      if (!carte.isConnected) return;
      const jours = (Array.isArray(reponse.days) ? reponse.days : []).filter((d) => d.date >= debut && d.date <= fin);
      const champ = montants ? 'revenue' : 'players';
      const total = jours.reduce((s, d) => s + (Number(d[champ]) || 0), 0);
      if (!jours.length || !total) {
        poser(phrase, 'Rien de réservé sur les 14 prochains jours.', 'carte-p-reserve');
        if (S.peint['carte-c-reserve'] !== 'vide') { corps.innerHTML = ''; S.peint['carte-c-reserve'] = 'vide'; }
        return;
      }
      const series = jours.map((d) => ({ label: dit(d.date, 14).label, value: Number(d[champ]) || 0 }));
      const haut = jours.reduce((a, b) => ((Number(b[champ]) || 0) > (Number(a[champ]) || 0) ? b : a));
      const resume = montants ? `${ecrire(total, 'euro')} déjà réservés` : `${ecrire(total, 'int')} joueurs déjà réservés`;
      poser(phrase, escapeHtml(`${resume} sur les 14 prochains jours. Le plus chargé est ${dit(haut.date, 14).long}.`), 'carte-p-reserve');
      const cle = series.map((x) => x.value).join(',');
      if (S.peint['carte-c-reserve'] !== cle) {
        S.peint['carte-c-reserve'] = cle;
        window.PinlaneCharts.barChart(corps, { series, format: montants ? 'euro' : 'int', height: 170, motionKey: `plt|reserve|${fin}` });
      }
    }, () => {
      if (carte.isConnected) poser(phrase, 'Ces chiffres ne sont pas disponibles pour le moment.', 'carte-p-reserve');
    });
  }

  // Les groupes qui ne sont pas venus (Ansar, 2026-11-08 : « montrer ça cettre stat dans des
  // grapgiques et stat quon puisse voir les noshow »). Sur une periode, la periode. Une journee
  // seule ne fait pas une evolution : huit semaines, comme les heures creuses.
  function peindrePasVenus(carte, phrase, corps) {
    const meta = carte.querySelector('[data-plt-carte-meta]');
    const dePeriode = (S.faits || {}).pasVenus;
    if (dePeriode) {
      // Une lecture de huit semaines encore en route ne repeindra pas cette periode.
      S.pasVenusAttendu = '';
      meta.textContent = '';
      dessinerPasVenus(phrase, corps, dePeriode);
      return;
    }
    meta.textContent = CARTES.heures.fixe;
    const fin = ancre();
    const f = { debut: addDays(fin, -55), fin };
    const jeton = `${centre()}|${f.debut}|${f.fin}`;
    S.pasVenusAttendu = jeton;
    const attendue = () => carte.isConnected && S.pasVenusAttendu === jeton;
    analyse(f, 600000).then((reponse) => {
      if (attendue()) dessinerPasVenus(phrase, corps, pasVenusDe(reponse.analytics, true));
    }, () => {
      if (!attendue()) return;
      poser(phrase, 'Ces chiffres ne sont pas disponibles pour le moment.', 'carte-p-pasvenus');
      poser(corps, '', 'carte-c-pasvenus');
    });
  }

  function dessinerPasVenus(phrase, corps, pv) {
    const n = pv.groupes;
    if (!n) {
      poser(phrase, 'Aucun groupe pas venu sur cette période.', 'carte-p-pasvenus');
      poser(corps, '', 'carte-c-pasvenus');
      return;
    }
    const taux = pv.taux < 1 ? 'moins de 1 %' : `${Math.round(pv.taux)} %`;
    poser(phrase, escapeHtml(`${ecrire(n, 'int')} groupe${n > 1 ? 's ne sont pas venus' : ' n’est pas venu'}, soit ${taux} de vos réservations.`), 'carte-p-pasvenus');
    const montants = voitLArgent();
    const cle = `${centre()}|${pv.fenetre}|${montants}|${n}|${pv.joueurs}|${pv.perdu}|${pv.points.map((p) => p.value).join(',')}`;
    if (S.peint['carte-c-pasvenus'] === cle && corps.querySelector('.plc-chart')) return;
    S.peint['carte-c-pasvenus'] = cle;
    const chiffres = [
      [ecrire(n, 'int'), n > 1 ? 'Groupes' : 'Groupe'],
      [ecrire(pv.joueurs, 'int'), pv.joueurs > 1 ? 'Joueurs' : 'Joueur'],
      ...(montants ? [[ecrire(pv.perdu, 'euro'), n > 1 ? 'Réservations perdues' : 'Réservation perdue']] : []),
    ];
    corps.innerHTML = `<div></div><ul class="plt-pv-chiffres">${chiffres.map(([valeur, nom]) => `<li><b>${escapeHtml(valeur)}</b><span>${escapeHtml(nom)}</span></li>`).join('')}</ul>`;
    window.PinlaneCharts.barChart(corps.firstElementChild, { series: pv.points, format: 'int', height: 150, motionKey: `plt|pasvenus|${pv.fenetre}` });
  }

  // ---- Les gestes ----------------------------------------------------------------
  function surClic(ev) {
    const t = ev.target;
    const periode = t.closest('[data-plt-periode]');
    if (periode) { retenir({ periode: periode.dataset.pltPeriode }); rafraichir(); return; }
    if (t.closest('[data-plt-modifier]')) { S.edition = !S.edition; fermerChoix(); rafraichir(); return; }
    if (t.closest('[data-plt-reessayer]')) { rafraichir(); return; }
    const retirer = t.closest('[data-plt-retirer]');
    if (retirer) { retenir({ cartes: reglages().cartes.filter((id) => id !== retirer.dataset.pltRetirer) }); rafraichir(); return; }
    const ajouter = t.closest('[data-plt-ajouter]');
    if (ajouter) { basculerChoixCarte(ajouter); return; }
    const tuile = t.closest('[data-plt-tuile]');
    if (!tuile) return;
    const id = tuile.dataset.pltTuile;
    if (S.edition) { basculerChoixTuile(tuile, id); return; }
    retenir({ active: id });
    rafraichir();
  }

  function fermerChoix(rendreFocus) {
    if (!S.choix) return;
    const ouvreur = S.choixOuvreur;
    S.choix.remove();
    S.choix = null;
    S.choixOuvreur = null;
    if (rendreFocus && ouvreur && ouvreur.isConnected) ouvreur.focus({ preventScroll: true });
  }

  function ouvrirChoix(ouvreur, titre, lignes, surChoix) {
    fermerChoix();
    const menu = document.createElement('div');
    menu.className = 'plt-choix';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = `<div class="plt-choix-titre">${escapeHtml(titre)}</div>${lignes.map((l) => `<button type="button" role="menuitemradio" aria-checked="${l.on ? 'true' : 'false'}" data-plt-choix="${l.id}"><span>${escapeHtml(l.label)}</span>${l.on ? '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 7.5 L6 10.5 L11.5 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' : ''}</button>`).join('')}`;
    document.body.appendChild(menu);
    // Le menu suit son bouton : le geste qui l ouvre peut encore faire defiler la page.
    S.placerChoix = () => {
      const r = ouvreur.getBoundingClientRect();
      const large = Math.max(240, Math.min(r.width, 300));
      menu.style.width = `${large}px`;
      const haut = menu.offsetHeight;
      const dessous = r.bottom + 6 + haut <= window.innerHeight - 12;
      menu.style.left = `${Math.min(window.innerWidth - large - 12, Math.max(12, r.left))}px`;
      menu.style.top = `${dessous ? r.bottom + 6 : Math.max(12, r.top - haut - 6)}px`;
    };
    S.placerChoix();
    menu.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-plt-choix]');
      if (!b) return;
      surChoix(b.dataset.pltChoix);
      fermerChoix();
      rafraichir();
    });
    S.choix = menu;
    S.choixOuvreur = ouvreur;
    const premier = menu.querySelector('[aria-checked="true"]') || menu.querySelector('button');
    if (premier) premier.focus({ preventScroll: true });
  }

  function basculerChoixTuile(tuile, id) {
    if (S.choix && S.choixOuvreur && S.choixOuvreur.dataset.pltTuile === id) { fermerChoix(); return; }
    const r = reglages();
    ouvrirChoix(tuile, 'Afficher ici', statsPermises().map((s) => ({ id: s, label: STATS[s].label, on: s === id })), (choisi) => {
      if (choisi === id) return;
      // Deja a l ecran : les deux tuiles echangent leur place.
      const tuiles = r.tuiles.includes(choisi)
        ? r.tuiles.map((x) => (x === id ? choisi : x === choisi ? id : x))
        : r.tuiles.map((x) => (x === id ? choisi : x));
      retenir({ tuiles, active: r.active === id ? choisi : r.active });
    });
  }

  function basculerChoixCarte(bouton) {
    if (S.choix && S.choixOuvreur === bouton) { fermerChoix(); return; }
    const r = reglages();
    const restantes = ORDRE_CARTES.filter((id) => !r.cartes.includes(id) && (voitLArgent() || !CARTES[id].argent));
    ouvrirChoix(bouton, 'Ajouter une carte', restantes.map((id) => ({ id, label: CARTES[id].nom, on: false })), (choisi) => {
      retenir({ cartes: [...r.cartes, choisi] });
    });
  }

  // Deplacer une carte : la poignee suit le doigt ou la souris, l emplacement se lit sur les
  // voisines, l ordre s ecrit au lacher.
  function surAppuiPoignee(ev) {
    if (!S.edition) return;
    const poignee = ev.target.closest('[data-plt-poignee]');
    if (!poignee) return;
    const carte = poignee.closest('.plt-carte');
    if (!carte) return;
    ev.preventDefault();
    const rect = carte.getBoundingClientRect();
    const trou = document.createElement('div');
    trou.className = 'plt-trou';
    trou.style.height = `${rect.height}px`;
    trou.style.flex = getComputedStyle(carte).flex;
    carte.parentNode.insertBefore(trou, carte);
    const decalX = ev.clientX - rect.left;
    const decalY = ev.clientY - rect.top;
    carte.classList.add('is-deplacee');
    carte.style.width = `${rect.width}px`;
    carte.style.height = `${rect.height}px`;
    const placer = (x, y) => { carte.style.left = `${x - decalX}px`; carte.style.top = `${y - decalY}px`; };
    placer(ev.clientX, ev.clientY);
    const bouger = (e) => {
      placer(e.clientX, e.clientY);
      const voisines = [...S.cartes.querySelectorAll('.plt-carte:not(.is-deplacee)')];
      let meilleure = null;
      let d2 = Infinity;
      let apres = false;
      voisines.forEach((v) => {
        const r = v.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const d = (e.clientX - cx) ** 2 + (e.clientY - cy) ** 2;
        if (d < d2) { d2 = d; meilleure = v; apres = e.clientY > r.bottom ? true : (e.clientY < r.top ? false : e.clientX > cx); }
      });
      if (!meilleure) return;
      const ref = apres ? meilleure.nextSibling : meilleure;
      if (ref !== trou) S.cartes.insertBefore(trou, ref);
    };
    const lacher = () => {
      document.removeEventListener('pointermove', bouger);
      document.removeEventListener('pointerup', lacher);
      document.removeEventListener('pointercancel', lacher);
      S.cartes.insertBefore(carte, trou);
      trou.remove();
      carte.classList.remove('is-deplacee');
      ['width', 'height', 'left', 'top'].forEach((p) => { carte.style[p] = ''; });
      retenir({ cartes: [...S.cartes.querySelectorAll('.plt-carte')].map((c) => c.dataset.pltCarte) });
      rafraichir();
    };
    document.addEventListener('pointermove', bouger);
    document.addEventListener('pointerup', lacher);
    document.addEventListener('pointercancel', lacher);
  }

  window.PinlanePilotage = { afficher, rafraichir, STATS, CARTES };

  // Le module arrive apres le premier rendu : la page se redessine pour le prendre.
  if (typeof isStaffDashboardActive === 'function' && isStaffDashboardActive()) renderStaffDashboard();
})();

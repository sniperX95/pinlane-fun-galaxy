/* ============================================================================
   PINLANE V2 : rebuilt page renderers
   Overrides the legacy renderers for Réservations, Clients, Emails,
   Campagnes and Tarifs with from-scratch layouts, plus a global command
   palette (Ctrl/Cmd+K). Data, permissions and mutations keep flowing through
   the existing battle-tested collectors and actions from app-main.js : this
   module owns presentation and interaction only.
   ========================================================================== */
(function () {
  'use strict';

  if (typeof window === 'undefined') return;

  const esc = (value) => (typeof escapeHtml === 'function' ? escapeHtml(value ?? '') : String(value ?? ''));
  const escJs = (value) => (typeof escapeJsString === 'function' ? escapeJsString(String(value ?? '')) : String(value ?? '').replace(/['"\\]/g, ''));
  const money = (value) => (typeof formatMoney === 'function' ? formatMoney(value) : `${Math.round(Number(value) || 0)} €`);
  // Les notes d un dossier sans leurs marqueurs internes : le mot du client,
  // puis les notes de l equipe (app-main.js getReservationNotesEquipe).
  const crmNotesTexte = (r) => {
    if (typeof getReservationNoteText !== 'function') return String((r && r.notes) || '');
    const equipe = typeof getReservationNotesEquipe === 'function' ? getReservationNotesEquipe(r).map((n) => `Équipe : ${n.t}`) : [];
    return [getReservationNoteText(r), ...equipe].filter(Boolean).join(' · ');
  };

  const PV2 = window.PinlaneV2 = { animatedPages: new Set(), lastPage: '' };

  /* ---- Motion engine ------------------------------------------------------
     Entrances/count-ups fire once per page visit, never on the 1.2s data
     polls that re-render the same page. */

  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function mount(root, pageKey) {
    if (!root) return;
    const firstVisit = PV2.lastPage !== pageKey;
    PV2.lastPage = pageKey;
    const shell = root.querySelector('.pv2-shell');
    if (shell && firstVisit && !reducedMotion) shell.classList.add('pv2-enter');
    drawSparklines(root);
    slideSegPills(root);
    if (firstVisit && !reducedMotion) animateCounters(root);
  }

  function animateCounters(root) {
    root.querySelectorAll('[data-pv2-count]').forEach((node) => {
      const target = Number(node.getAttribute('data-pv2-count'));
      if (!Number.isFinite(target)) return;
      const suffix = node.getAttribute('data-pv2-suffix') || '';
      const start = performance.now();
      const duration = 620;
      // Le drapeau que PinlaneMotion respecte : pendant ce defile d'arrivee, le
      // module ne doit pas lire les valeurs intermediaires, sinon il memorise
      // une reference fausse et rejoue une seconde animation par-dessus.
      node.setAttribute('data-pl-anim', '1');
      const step = (now) => {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        node.textContent = Math.round(target * eased).toLocaleString('fr-BE') + suffix;
        if (t < 1) requestAnimationFrame(step);
        else node.removeAttribute('data-pl-anim');
      };
      requestAnimationFrame(step);
    });
  }

  function drawSparklines(root) {
    root.querySelectorAll('canvas[data-pv2-spark]').forEach((canvas) => {
      let series;
      try { series = JSON.parse(canvas.getAttribute('data-pv2-spark') || '[]'); } catch (e) { series = []; }
      if (!Array.isArray(series) || series.length < 2) return;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth || 220;
      const h = canvas.clientHeight || 38;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      const max = Math.max(...series, 1);
      const min = Math.min(...series, 0);
      const span = Math.max(max - min, 1);
      const px = (i) => (i / (series.length - 1)) * (w - 4) + 2;
      const py = (v) => h - 5 - ((v - min) / span) * (h - 12);
      const accent = (getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#0070f3').trim();
      const rgb = /^#([0-9a-f]{6})$/i.test(accent)
        ? [parseInt(accent.slice(1, 3), 16), parseInt(accent.slice(3, 5), 16), parseInt(accent.slice(5, 7), 16)]
        : [0, 112, 243];
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.28)`);
      grad.addColorStop(1, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0)`);
      ctx.beginPath();
      series.forEach((v, i) => (i ? ctx.lineTo(px(i), py(v)) : ctx.moveTo(px(i), py(v))));
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.6;
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.lineTo(px(series.length - 1), h);
      ctx.lineTo(px(0), h);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
    });
  }

  function slideSegPills(root) {
    // Positionnement INSTANTANÉ : chaque appel suit une reconstruction du DOM
    // (innerHTML), donc le pill partait de sa position CSS par défaut puis
    // GLISSAIT vers l'actif : un aller-retour visible à chaque fetch qui
    // atterrissait (bug vidéo). La transition est neutralisée le temps de
    // poser la position, puis rendue au CSS.
    root.querySelectorAll('.pv2-seg').forEach((seg) => {
      syncSegFade(seg);
      const active = seg.querySelector('button.active');
      const pill = seg.querySelector('.pv2-seg-pill');
      if (!active) return;
      if (pill) pill.style.transition = 'none';
      seg.style.setProperty('--pv2-pill-x', `${active.offsetLeft}px`);
      seg.style.setProperty('--pv2-pill-w', `${active.offsetWidth}px`);
      if (pill) {
        void pill.offsetWidth;
        pill.style.transition = '';
      }
    });
  }

  /* Le segmente defile chez lui sous 768 px, mais sa barre de defilement est
     masquee : a 390 px sur Tarifs, le contenu mesurait 558 px dans une bande
     de 366 px et « Speciales » finissait a 567 px, hors champ, sans que RIEN
     ne l annonce. `can-scroll-x` allume le fondu de bord, et seulement s il
     reste vraiment du contenu a droite : sinon il annoncerait un ailleurs qui
     n existe pas. Meme mecanique que le segmente de la page Emails.
     L ecouteur est pose SUR le noeud : il meurt avec lui a la reconstruction
     suivante, donc il ne s accumule pas. */
  function syncSegFade(seg) {
    if (!seg) return;
    seg.classList.toggle('can-scroll-x', seg.scrollWidth - seg.clientWidth - seg.scrollLeft > 4);
    if (seg.dataset.segFadeBound === '1') return;
    seg.dataset.segFadeBound = '1';
    seg.addEventListener('scroll', () => syncSegFade(seg), { passive: true });
  }

  /* ── MOUVEMENT DE LA PAGE EMAILS ────────────────────────────────────────────
     Contrainte centrale : cette page se reconstruit ENTIEREMENT
     (root.innerHTML) a chaque frappe dans la recherche, a chaque bascule
     d'interrupteur, a chaque arrivee de donnees. Deux consequences dures :
       - une animation d'ENTREE posee sur un noeud interieur REJOUE a chaque
         reconstruction. Ca clignote, et c'est pire que pas d'animation ;
       - une animation de SORTIE est impossible telle quelle : on n'anime pas
         un noeud deja detruit.
     D'ou deux familles, tenues separees dans tout ce fichier :
       FAMILLE A (le coeur du travail) : transitions CSS pilotees par un ETAT
         (:hover, :active, :focus-visible, .active, .is-on). Elles survivent
         aux reconstructions parce qu'elles ne dependent pas du montage. C'est
         la que se joue la sensation « l'interface me repond ».
       FAMILLE B (rare) : un element qui apparait VRAIMENT sur action de la
         gerante (panneau replie, editeur, inventaire). Une entree y est
         legitime, mais SEULEMENT derriere une garde de premiere apparition.
     Les memoires ci-dessous SONT cette garde : elles vivent hors du DOM, donc
     elles survivent a innerHTML.
     Ce qui est reellement anime sur cette page (releve exhaustif, pas une
     intention) : transform et opacity, plus trois proprietes de PEINTURE
     (background-color, border-color, color) sur les survols et les etats.
     Aucune transition ne porte sur height, width, margin, padding, top ou left :
     c'est ca qui compte, aucune ne declenche de reflow. Une version precedente
     de ce commentaire affirmait « transform et opacity UNIQUEMENT », ce que la
     mesure a dementi. ── */
  const PV2_EMAILS_MOTION = { open: {}, pipeRail: null, switches: {}, pipeScroll: 0, resizeBound: false, subnav: null, subnavResizeBound: false, section: '' };

  /* FAMILLE B : on ne pose la classe d'entree que si l'etat du panneau vient
     de passer de ferme a ouvert. Sur une simple reconstruction (frappe
     clavier, poll de donnees), l'etat n'a pas change : la classe n'est pas
     posee, rien ne rejoue. Verifiable, et verifie par le gate. */
  function markEmailsMounts(root, opened) {
    Object.keys(opened).forEach((key) => {
      const now = !!opened[key];
      const was = !!PV2_EMAILS_MOTION.open[key];
      PV2_EMAILS_MOTION.open[key] = now;
      if (!now || was || reducedMotion) return;
      const node = root.querySelector(`[data-pv2-mount="${key}"]`);
      if (node) node.classList.add('pv2-mount');
    });
  }

  /* L'indicateur qui GLISSE d'un segment de filtre a l'autre est la signature
     la plus reconnaissable de ce style. Pose naivement, il repartirait de la
     gauche a CHAQUE rendu, y compris quand la gerante tape une lettre dans la
     recherche. La position precedente est donc memorisee hors du DOM : on
     repose le rail dessus sans transition, on force un reflow, puis on le
     laisse glisser vers la nouvelle position. Si le filtre n'a pas change,
     ancienne == nouvelle et le rail ne bouge pas d'un pixel : c'est ce que
     `data-moved` expose au gate.
     Seul transform est anime (translateX + scaleX sur une base de 100 px) :
     animer left/width declencherait un layout a chaque frame. */
  /* `instant` : un changement de largeur de fenetre n'est pas une action de la
     gerante, le rail s'y RECALE sans glisser. Mesure faite a 390 px : sans ce
     recalage, le rail gardait la largeur du segment large et debordait de
     trois segments, et le fondu de bord restait eteint alors que la barre
     debordait vraiment.

     GARDE DE VIVACITE (correctif du defaut mesure D1/D2). Cette fonction lit
     offsetLeft/offsetWidth, qui valent ZERO sur un noeud detache du document.
     Un ResizeObserver cree a chaque rendu, jamais deconnecte, se declenchait
     ensuite sur la barre DETACHEE du rendu precedent, lisait cette geometrie
     nulle et ECRASAIT la memoire hors DOM : au clic suivant le rail repartait
     de scaleX(0) au bord gauche au lieu de glisser depuis le segment
     precedent. Mesure a t+30 ms : largeur de depart 4.62 px puis 0.98 px,
     contre 179 et 183 px attendus.
     On ne memorise donc QUE ce qu'on a pu vraiment mesurer. */
  function positionPipeRail(barEl, instant) {
    const rail = barEl.querySelector('.pv2-pipe-rail');
    const active = barEl.querySelector('.pv2-pipe.active');
    if (!rail || !active) return;
    const from = PV2_EMAILS_MOTION.pipeRail;
    const place = (p) => { rail.style.transform = `translateX(${p.x}px) scaleX(${p.w / 100})`; };
    // Noeud detache, ou page repliee : la geometrie lisible est du neant. On
    // repose la derniere geometrie CONNUE et on ne touche pas a la memoire.
    if (!document.contains(barEl) || !active.offsetWidth) {
      if (from) { rail.style.transition = 'none'; place(from); void rail.offsetWidth; rail.style.transition = ''; }
      rail.setAttribute('data-moved', '0');
      return;
    }
    const to = { key: active.getAttribute('data-pipe'), x: active.offsetLeft, w: active.offsetWidth };
    // La memoire est indexee sur le SEGMENT CHOISI, pas sur des pixels. Sur des
    // pixels, le rail glissait aussi quand la largeur de la barre bougeait
    // pour une raison etrangere au filtre : l'ouverture d'un panneau fait
    // apparaitre la barre de defilement de la page, la largeur change de
    // quelques pixels, et le rail se mettait a glisser sans que personne
    // n'ait rien demande (assertion instable au gate, une fois sur deux).
    // La regle voulue s'ecrit exactement ainsi : le rail glisse si et
    // seulement si le segment choisi a change. Tout le reste se repose sec.
    const moved = !instant && !!(from && from.key && from.key !== to.key) && !reducedMotion;
    rail.style.transition = 'none';
    place(moved ? from : to);
    void rail.offsetWidth;
    // La transition est TOUJOURS rendue au CSS apres le reflow, meme quand le
    // rail n'a pas bouge : sinon le `transition: none` pose ici restait colle
    // en style en ligne et le glissement suivant se faisait en un saut.
    rail.style.transition = '';
    if (moved) place(to);
    PV2_EMAILS_MOTION.pipeRail = to;
    rail.setAttribute('data-moved', moved ? '1' : '0');
  }

  /* Le defilement horizontal du segmente est lui aussi detruit a chaque
     rendu : sans cette restitution, le filtre choisi sur mobile ressortait du
     champ des qu'une donnee arrivait. `can-scroll-x` allume le fondu de bord
     qui dit qu'il reste des segments a droite (defaut releve a 390 px :
     « Echecs » etait coupe et RIEN ne l'annoncait). */
  function syncPipeFade(barEl) {
    PV2_EMAILS_MOTION.pipeScroll = barEl.scrollLeft;
    barEl.classList.toggle('can-scroll-x', barEl.scrollWidth - barEl.clientWidth - barEl.scrollLeft > 4);
  }

  function slidePipeRail(root) {
    const barEl = root.querySelector('.pv2-pipeline');
    if (!barEl) return;
    positionPipeRail(barEl, false);
    barEl.scrollLeft = PV2_EMAILS_MOTION.pipeScroll;
    syncPipeFade(barEl);
    // Cet ecouteur-la est pose SUR le noeud : il meurt avec lui, donc il ne
    // s'accumule pas d'un rendu au suivant.
    barEl.addEventListener('scroll', () => syncPipeFade(barEl), { passive: true });
    // UN SEUL ecouteur de redimensionnement pour toute la vie de la page, pose
    // une fois. C'est la solution la plus simple qui tienne : il n'a rien a
    // deconnecter, il ne peut pas s'accumuler, et il retrouve la barre VIVANTE
    // a chaque appel au lieu de retenir celle du rendu ou il a ete cree.
    // Mesure de la version precedente (un observateur par rendu) : 10 frappes
    // dans la recherche => 10 ResizeObserver crees, 0 deconnecte, 10 rappels
    // sur un noeud detache, 17 observateurs encore vivants.
    if (!PV2_EMAILS_MOTION.resizeBound) {
      PV2_EMAILS_MOTION.resizeBound = true;
      window.addEventListener('resize', () => {
        const live = document.querySelector('#staffEmailsPage .pv2-pipeline');
        if (!live) return;
        positionPipeRail(live, true);
        syncPipeFade(live);
      }, { passive: true });
    }
  }

  /* FAMILLE A rendue possible malgre la reconstruction. Le bouton d'un
     interrupteur est DETRUIT puis recree deja dans sa nouvelle position : la
     transition CSS du curseur n'avait donc jamais lieu, l'etat sautait. On
     repose la classe dans son ancien etat, on force un reflow pour que le
     navigateur commite ce style, puis on rend l'etat reel : la transition CSS
     joue alors normalement. Un interrupteur dont l'etat n'a pas bouge n'est
     pas touche du tout. */
  function replaySwitchKnobs(root) {
    if (reducedMotion) return;
    root.querySelectorAll('.mk-switch[data-switch-key]').forEach((sw) => {
      const key = sw.getAttribute('data-switch-key');
      const knob = sw.firstElementChild;
      const now = sw.classList.contains('is-on');
      const was = PV2_EMAILS_MOTION.switches[key];
      PV2_EMAILS_MOTION.switches[key] = now;
      if (!knob || was === undefined || was === now) return;
      // Le noeud est insere DEJA dans son etat final : reposer la classe
      // d'origine sans precaution declenchait une transition vers l'ancienne
      // position, aussitot inversee par le retour a la nouvelle. Mesure faite
      // via document.getAnimations() : la transition sortait a 65 ms au lieu de
      // 160 (facteur de raccourcissement d'inversion du spec CSS) et le curseur
      // partait a GAUCHE avant de revenir. Un aller-retour, pas une bascule.
      // Le remede est celui du rail : on neutralise la transition pendant qu'on
      // repose l'ancien etat, on force le reflow SUR LE CURSEUR (le transform
      // est une propriete de composition : lire offsetWidth du parent ne le
      // commite pas), puis on rend la transition au CSS avant de basculer.
      knob.style.transition = 'none';
      sw.style.transition = 'none';
      sw.classList.toggle('is-on', was);
      void knob.offsetWidth;
      knob.style.transition = '';
      sw.style.transition = '';
      sw.classList.toggle('is-on', now);
    });
  }

  /* ---- Shared building blocks ---------------------------------------------- */

  function bar({ crumb, title, sub, actions = '' }) {
    return `<section class="pv2-bar">
      <div>
        ${crumb ? `<div class="pv2-bar-crumb"><span class="pv2-live"></span>${esc(crumb)}</div>` : ''}
        <h1>${esc(title)}</h1>
        <div class="pv2-bar-sub">${sub}</div>
      </div>
      <div class="pv2-bar-actions">${actions}</div>
    </section>`;
  }

  // `empty` : la tuile n a pas de chiffre a donner (historique en chargement,
  // droit absent, rien a classer). Elle le dit en mots, dans un corps plus
  // petit, au lieu d un tiret seul qui se lisait comme un trou de maquette.
  function stat({ label, value, count, suffix = '', delta = '', deltaTone = 'flat', foot = '', series = null, empty = false, className = '' }) {
    // `data-pv2-count` ne defile QU'A L'ARRIVEE sur la page (voir
    // animateCounters). `data-pl-num` prend le relais ensuite : c'est lui qui
    // fait bouger le chiffre quand la valeur CHANGE - une recherche, un poll,
    // une reservation qui tombe. Sans ca les grands chiffres de tete restaient
    // figes pendant toute la session, ce que Movsar a vu tout de suite.
    // La cle vient du libelle : les stats sont posees par appels successifs,
    // aucun identifiant ecrit a la main n'aurait tenu.
    const cle = `stat.${String(label).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
    const valueHtml = count !== undefined
      ? `<span data-pv2-count="${Number(count) || 0}" data-pv2-suffix="${esc(suffix)}" data-pl-num="${cle}">${(Number(count) || 0).toLocaleString('fr-BE')}${esc(suffix)}</span>`
      : `<span data-pl-num="${cle}">${esc(value)}</span>`;
    return `<article class="pv2-stat${className ? ` ${className}` : ''}">
      <div class="pv2-stat-label"><span>${esc(label)}</span>${delta ? `<span class="pv2-delta ${deltaTone}">${esc(delta)}</span>` : ''}</div>
      <div class="pv2-stat-value${empty ? ' is-empty' : ''}">${valueHtml}</div>
      ${series ? `<canvas data-pv2-spark='${JSON.stringify(series.map((v) => Math.round(Number(v) || 0)))}'></canvas>` : ''}
      ${foot ? `<div class="pv2-stat-foot">${esc(foot)}</div>` : ''}
    </article>`;
  }

  function seg(items, onclickName) {
    return `<div class="pv2-seg"><span class="pv2-seg-pill"></span>${items
      .map((item) => `<button type="button" class="${item.active ? 'active' : ''}" onclick="${onclickName}('${escJs(item.key)}')">${esc(item.label)}${item.count !== undefined ? `<em>${Number(item.count) || 0}</em>` : ''}</button>`)
      .join('')}</div>`;
  }

  function trendTone(text) {
    const raw = String(text || '');
    if (raw.includes('+')) return 'up';
    if (raw.includes('-')) return 'down';
    return 'flat';
  }

  const STATUS_META = {
    pending: { label: 'Confirmé', tone: 'blue' },
    arrived: { label: 'Arrivé', tone: 'amber' },
    paid: { label: 'Payé', tone: 'green' },
    cancelled: { label: 'Annulé', tone: 'red' },
    // Une demande en ligne que l equipe doit encore valider : jamais
    // « Confirmé » (isReservationAwaitingReview, app-main).
    review: { label: 'À vérifier', tone: 'amber' },
  };

  function statusMeta(r) {
    if (typeof isReservationAwaitingReview === 'function' && isReservationAwaitingReview(r)) return STATUS_META.review;
    return STATUS_META[r && r.status] || STATUS_META.pending;
  }

  function statusChip(r) {
    const meta = statusMeta(r);
    // « Payé » dit comment (decision du 01/10 : Carte ou Espèces partout).
    const moyen = r && r.status === 'paid' && typeof getMoyenPaiementLabel === 'function' ? getMoyenPaiementLabel(r.paymentMethod) : '';
    return `<span class="pv2-chip ${meta.tone}"><span class="pv2-dot ${meta.tone}" style="margin:0"></span>${meta.label}${moyen ? ` · ${esc(moyen)}` : ''}</span>`;
  }

  // « pistes 1 à 4 », « piste 3 », « pistes 1, 2, 6 ».
  function pistesLabel(lanes) {
    const l = [...new Set((lanes || []).map(Number).filter((n) => n > 0))].sort((a, b) => a - b);
    if (!l.length) return '';
    if (l.length === 1) return `piste ${l[0]}`;
    const suite = l.every((n, i) => i === 0 || n === l[i - 1] + 1);
    return suite && l.length > 2 ? `pistes ${l[0]} à ${l[l.length - 1]}` : `pistes ${l.join(', ')}`;
  }

  // La duree REELLE de la venue (de la premiere a la derniere activite), pas
  // la fenetre du premier bowling : « 1h » pour un groupe la jusqu a 16:55
  // etait un faux fait (meme correction que la fiche le 01/10).
  function dureeVenueLabel(r) {
    const programme = typeof dureeProgrammeLabel === 'function' ? dureeProgrammeLabel(r) : '';
    if (programme === 'Journée') return programme;
    if (typeof getStaffTerrainSpan === 'function' && typeof formatDurationLabel === 'function') {
      const span = getStaffTerrainSpan(r);
      if (span && span.end > span.start) return formatDurationLabel(span.end - span.start);
    }
    return programme || (typeof formatDurationLabel === 'function' ? formatDurationLabel(Number(r.duration) || 1) : `${r.duration || 1}h`);
  }

  // Une formule dit SON nom (« FORMULE 7 »), pas « Formule ».
  function nomFormuleOuType(r) {
    if (r && (r.formuleId || r.type === 'formule')) {
      const f = r.formuleId && typeof resolveDisplayFormule === 'function' ? resolveDisplayFormule(r.formuleId) : null;
      if (f && f.name) return f.name;
    }
    return typeLabel(r);
  }

  function typeLabel(reservation) {
    if (reservation.type === 'laser') return 'Laser Game';
    if (reservation.type === 'formule') return reservation.label || 'Formule';
    return 'Bowling';
  }

  /* ==========================================================================
     RÉSERVATIONS : occupancy cockpit: heatmap month + day flow
     ======================================================================== */

  window.pv2SelectResDay = function (dateStr) {
    if (typeof selectStaffReservationsDate === 'function') selectStaffReservationsDate(dateStr);
  };

  /* Recherche GLOBALE par client (review manager 2026-08-25) : le staff
     n a que Planning / Reservations / Formules / Terrain, et un client au
     telephone ne sait pas toujours QUEL JOUR il a reserve. La barre
     cherche donc dans une fenetre large (-60 j / +365 j, admin-range),
     pas seulement dans le mois affiche. */
  const pv2ResSearch = { open: false, query: '', loading: false, loaded: false, error: '', rows: [], loadedAt: 0, center: '' };

  function pv2ResSearchNormalize(value) {
    return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  }

  async function pv2ResSearchEnsureData(force) {
    const center = getActiveOpsCenterId();
    // CHANGEMENT DE CENTRE = LES RESULTATS DE L AUTRE CENTRE MEURENT TOUT DE
    // SUITE. Sans cette purge, le cache restait servi pendant que le libelle
    // annoncait le nouveau centre : des noms et des telephones d un client
    // s affichaient chez un autre (isolation multi-tenant).
    if (pv2ResSearch.center && pv2ResSearch.center !== center) {
      pv2ResSearch.rows = [];
      pv2ResSearch.loaded = false;
      pv2ResSearch.loadedAt = 0;
      pv2ResSearch.error = '';
    }
    const fresh = pv2ResSearch.loaded && pv2ResSearch.center === center && (Date.now() - pv2ResSearch.loadedAt) < 60 * 1000;
    if (!force && (pv2ResSearch.loading || fresh)) return;
    pv2ResSearch.loading = true;
    pv2ResSearch.error = '';
    pv2ResSearch.center = center;
    try {
      const startDate = encodeURIComponent(addDays(todayStr(), -60));
      const endDate = encodeURIComponent(addDays(todayStr(), 365));
      const payload = await window.PinlaneApiClient.collectAdminRange(`${API_ENDPOINTS.adminRange}?startDate=${startDate}&endDate=${endDate}&centerId=${encodeURIComponent(center)}`, apiRequest);
      pv2ResSearch.rows = payload.reservations || [];
      pv2ResSearch.loaded = true;
      pv2ResSearch.loadedAt = Date.now();
    } catch (error) {
      pv2ResSearch.error = error.message || 'Recherche indisponible.';
    } finally {
      pv2ResSearch.loading = false;
      if (isStaffReservationsActive()) renderStaffReservationsPage();
    }
  }

  function pv2ResSearchMatches(terme = pv2ResSearch.query) {
    // (la meme regle que pv2ResSearchEnsureData : les resultats d un autre centre
    // ne se montrent pas, meme le temps d une lecture)
    if (pv2ResSearch.center && pv2ResSearch.center !== getActiveOpsCenterId()) return [];
    const q = pv2ResSearchNormalize(terme);
    if (q.length < 2) return [];
    // Le numero de la reservation (« 1734 », « n° 1734 ») la trouve, meme
    // annulee : le client qui appelle avec ce numero doit entendre ce qu elle est
    // devenue.
    const numero = typeof numeroReservationDe === 'function' ? numeroReservationDe(q) : '';
    const parNumero = numero ? (pv2ResSearch.rows || []).filter((r) => r && String(r.id) === numero) : [];
    if (parNumero.length) return parNumero;
    const digits = q.replace(/[^0-9]/g, '');
    const rows = (pv2ResSearch.rows || []).filter((r) => r && r.status !== 'cancelled');
    const justes = rows.filter((r) => {
      if (pv2ResSearchNormalize(r.name).includes(q)) return true;
      const phone = String(r.phone || '').replace(/[^0-9]/g, '');
      return digits.length >= 4 && phone.includes(digits);
    });
    // (une faute legere ne joue que si rien d exact n existe, comme au tableau)
    const hit = justes.length || typeof nomRessemble !== 'function' ? justes : rows.filter((r) => nomRessemble(pv2ResSearchNormalize(r.name), q));
    // Les venues A VENIR d abord (le cas du telephone), puis les passees,
    // les plus recentes en tete.
    const today = todayStr();
    const stamp = (r) => `${r.date || ''}T${String(r.startTime || '').slice(0, 5)}`;
    const future = hit.filter((r) => (r.date || '') >= today).sort((a, b) => stamp(a).localeCompare(stamp(b)));
    const past = hit.filter((r) => (r.date || '') < today).sort((a, b) => stamp(b).localeCompare(stamp(a)));
    return [...future, ...past].slice(0, 30);
  }

  function pv2ResSearchBody(dayFlowHtml) {
    if (!pv2ResSearch.open || pv2ResSearchNormalize(pv2ResSearch.query).length < 2) return dayFlowHtml;
    if (pv2ResSearch.loading && !pv2ResSearch.loaded) {
      return '<div class="pv2-empty"><strong>Recherche…</strong>Chargement des réservations de toutes les dates.</div>';
    }
    if (pv2ResSearch.error && !pv2ResSearch.loaded) {
      return `<div class="pv2-empty"><strong>Recherche indisponible</strong>${esc(pv2ResSearch.error)}</div>`;
    }
    const rows = pv2ResSearchMatches();
    if (!rows.length) {
      // Un numero de reservation hors de la fenetre (ou pas encore lu) : le
      // serveur sait ou elle est, quel que soit son jour.
      const numero = typeof numeroReservationDe === 'function' ? numeroReservationDe(pv2ResSearchNormalize(pv2ResSearch.query)) : '';
      if (numero) {
        return `<div class="pv2-empty"><strong>Réservation n°&nbsp;${esc(numero)}</strong><span>Elle n’est pas dans les dates chargées ici.</span><button type="button" class="pv2-btn" data-ouvrir-numero="${esc(numero)}" onclick="ouvrirReservationNumero('${escJs(numero)}')">Ouvrir la réservation n°&nbsp;${esc(numero)}</button></div>`;
      }
      return '<div class="pv2-empty"><strong>Aucun résultat</strong>Aucune réservation ne correspond à ce nom, ce téléphone ou ce numéro de réservation (fenêtre : 2 mois passés à 12 mois à venir).</div>';
    }
    return rows.map(pv2ResSearchResultRow).join('');
  }

  // Une reservation prise il y a dix secondes doit se trouver : apres toute
  // creation / modification, la fenetre est redemandee au prochain rendu.
  window.pv2ResSearchInvalidate = function () {
    pv2ResSearch.loadedAt = 0;
  };
  // (une creation au comptoir se trouve tout de suite, sans relire 14 mois)
  window.pv2ResSearchAjouter = function (reservations) {
    if (!pv2ResSearch.loaded) return;
    const ids = new Set(reservations.map((r) => String(r.id)));
    pv2ResSearch.rows = [...reservations, ...(pv2ResSearch.rows || []).filter((r) => !ids.has(String(r.id)))];
  };

  // LA RECHERCHE DE TOUTES LES DATES, OUVERTE AU GRAND TABLEAU (2026-11-02). Elle
  // vivait ici seule : un nom absent du jour coutait 15 gestes (changer de page,
  // ouvrir la loupe, retaper). Le tableau lit la meme liste, la meme regle, le meme
  // cache par centre (gfAutresDatesHtml, pinlane-planning-global.js).
  window.pv2ResSearchMatches = pv2ResSearchMatches;
  window.pv2ResSearchEnsureData = pv2ResSearchEnsureData;
  window.pv2ResSearchEtat = function () {
    const memeCentre = !pv2ResSearch.center || pv2ResSearch.center === getActiveOpsCenterId();
    return {
      charge: pv2ResSearch.loading,
      lu: pv2ResSearch.loaded && memeCentre,
      frais: pv2ResSearch.loaded && memeCentre && (Date.now() - pv2ResSearch.loadedAt) < 60 * 1000,
      erreur: pv2ResSearch.error,
    };
  };

  window.pv2ResSearchToggle = function () {
    pv2ResSearch.open = !pv2ResSearch.open;
    if (pv2ResSearch.open) pv2ResSearchEnsureData(false);
    else pv2ResSearch.query = '';
    // L animation d ouverture ne joue qu ICI : marquee pour un seul rendu,
    // elle ne peut pas rejouer a chaque lettre tapee.
    pv2ResSearch.animer = pv2ResSearch.open;
    renderStaffReservationsPage();
    pv2ResSearch.animer = false;
    if (pv2ResSearch.open) {
      const input = document.querySelector('[data-pl-focus="reservations.recherche"]');
      if (input) input.focus();
    }
  };

  // La frappe ne repeint pas la page a chaque touche : 120 ms de repos, comme
  // la recherche clients. Sans ce delai, taper « Dupont » reconstruisait six
  // fois un panneau qui porte un calendrier et quatre statistiques.
  let pv2ResSearchTimer = null;
  window.pv2ResSearchInput = function (value) {
    pv2ResSearch.query = String(value || '');
    clearTimeout(pv2ResSearchTimer);
    const run = () => { if (isStaffReservationsActive()) renderStaffReservationsPage(); };
    if (!pv2ResSearch.query.trim()) { run(); return; }
    pv2ResSearchTimer = setTimeout(run, 120);
  };

  // OUVRIR UN RESULTAT MARCHE MEME HORS DU MOIS AFFICHE. openStaffReservationDetail
  // resout l id dans les sources CHARGEES (etat du jour + cache du mois) : un
  // resultat trouve en mars alors qu on affiche aout n y etait pas, et le clic
  // repondait « Reservation introuvable ou non chargee » : la recherche
  // trouvait le client mais refusait de l ouvrir. On injecte donc la ligne
  // dans l etat avant d ouvrir.
  // (garderLeJour : le grand tableau ouvre la fiche par-dessus sa journee. En rush,
  // fermer la fiche doit rendre le tableau du jour, pas celui de la date trouvee.)
  window.pv2ResSearchOpen = function (id, garderLeJour) {
    const row = (pv2ResSearch.rows || []).find((r) => String(r.id) === String(id));
    if (row && typeof upsertReservationInState === 'function') upsertReservationInState(row);
    if (garderLeJour && typeof openPos === 'function') { openPos(id); return; }
    openStaffReservationDetail(id);
  };

  // LA CONSIGNE ET LE PRIX NEGOCIE SUR LA LIGNE DU JOUR.
  // La liste affichait « Bowling · 6 joueurs · piste 1 · 20 € » et rien
  // d autre : la consigne qui change la maniere de servir et le prix negocie
  // n existaient qu au fond de la fiche, dossier par dossier. Les deux aides
  // du produit sont appelees ici telles quelles, zero donnee nouvelle, zero
  // regle recopiee : une ligne sans note ni ecart ne gagne rien.
  // LA FORME SUIT CE QUE LA LIGNE PORTE DEJA. Les deux appels de cette aide ne
  // vivent pas dans le meme voisinage : la ligne du jour termine sa meta par
  // « · 40 € », la ligne de recherche non. En donnant « complet » aux deux, la
  // liste du jour ecrivait le meme nombre deux fois a deux lignes d intervalle
  // (« Bowling · 6 joueurs · piste 1 · 40 € » puis « Prix ajusté 40 € ») et la
  // seule information neuve, la reference de 60 €, restait dans l infobulle,
  // donc perdue au doigt sur la tablette du comptoir. Le contrat de la regle
  // partagee prevoit exactement ce cas : la forme « reference ».
  function pv2MarqueursDossier(r, options = {}) {
    const note = typeof renderReservationNoteLine === 'function' ? renderReservationNoteLine(r) : '';
    const forme = options.montantDeja ? 'reference' : 'complet';
    const prix = typeof renderReservationPriceMark === 'function' ? renderReservationPriceMark(r, { forme }) : '';
    // (le sur mesure, l equipe et le prix revu, comme la ligne du Complet)
    const rubriques = typeof renderLigneRubriquesDossier === 'function' ? renderLigneRubriquesDossier(r) : '';
    if (!note && !prix && !rubriques) return '';
    return `<span class="pv2-flow-marks">${prix}${note}${rubriques}</span>`;
  }

  function pv2ResSearchResultRow(r) {
    const when = typeof formatStaffClientDateText === 'function' ? formatStaffClientDateText(r.date) : (r.date || '');
    const time = String(r.startTime || '').slice(0, 5);
    const offer = typeof getStaffClientOfferLabel === 'function' ? getStaffClientOfferLabel(r) : typeLabel(r);
    const paxN = Number(r.pax) || 0;
    // (cherchee par son numero, la ligne le montre ; l etiquette dit deja si elle est annulee)
    const numero = typeof numeroReservationDe === 'function' ? numeroReservationDe(pv2ResSearchNormalize(pv2ResSearch.query)) : '';
    const parNumero = numero && String(r.id) === numero;
    return `<div class="pv2-flow-item ${statusMeta(r).tone}" onclick="pv2ResSearchOpen('${escJs(r.id)}')">
      <div class="pv2-flow-time"><strong>${esc(time || '--:--')}</strong><small>${esc(when)}</small></div>
      <div class="pv2-flow-rail"></div>
      <div class="pv2-flow-body">
        <strong>${esc(r.name || 'Sans nom')}${parNumero ? ` <span class="pv2-numero">n°&nbsp;${esc(String(r.id))}</span>` : ''}</strong>
        <span>${esc(offer)} · ${paxN} joueur${paxN > 1 ? 's' : ''}${r.phone ? ` · ${esc(r.phone)}` : ''}</span>
        ${pv2MarqueursDossier(r)}
      </div>
      ${statusChip(r)}
    </div>`;
  }

  window.renderStaffReservationsPage = function () {
    const root = document.getElementById('staffReservationsPage');
    if (!root) return;
    const metrics = getStaffReservationsMetrics();
    const range = metrics.range;
    const source = getStaffReservationsSourceReservations().filter((r) => r.status !== 'cancelled');
    const selectedDate = state.staffReservationsSelectedDate || todayStr();
    const monthLabel = parseLocalDate(range.monthStart).toLocaleDateString('fr-BE', { month: 'long', year: 'numeric' });
    const sync = staffReservationsDataCache.loading
      ? 'Synchronisation…'
      : staffReservationsDataCache.loaded
        ? `Synchronisé ${formatOpsTimestamp(staffReservationsDataCache.syncedAt)}`
        : 'En attente du serveur…';

    // Per-day aggregates for the heatmap.
    const byDay = new Map();
    source.forEach((r) => {
      if (!r.date || !String(r.date).startsWith(range.monthKey)) return;
      const agg = byDay.get(r.date) || { count: 0, pax: 0, revenue: 0, aCloturer: 0, aVerifier: 0 };
      agg.count += 1;
      agg.pax += Number(r.pax) || 0;
      agg.revenue += Number(r.price) || 0;
      // L URGENT SE VOIT DANS LE MOIS : un jour passe dont un groupe n a pas
      // ete encaisse (« À clôturer », l argent), une demande pas encore
      // validee (« À vérifier »).
      if (r.date < todayStr() && r.status !== 'paid') agg.aCloturer += 1;
      if (typeof isReservationAwaitingReview === 'function' && isReservationAwaitingReview(r)) agg.aVerifier += 1;
      byDay.set(r.date, agg);
    });
    const maxCount = Math.max(1, ...[...byDay.values()].map((a) => a.count));

    const monthStart = parseLocalDate(range.monthStart);
    const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
    const firstWeekday = (monthStart.getDay() + 6) % 7; // Monday first
    const today = todayStr();
    let cells = '';
    for (let i = 0; i < firstWeekday; i += 1) cells += '<div class="pv2-cal-cell empty"></div>';
    for (let day = 1; day <= daysInMonth; day += 1) {
      const dateStr = `${range.monthKey}-${String(day).padStart(2, '0')}`;
      const agg = byDay.get(dateStr);
      const heat = !agg ? 0 : Math.ceil((agg.count / maxCount) * 3);
      // De VRAIS boutons (audit UX 2026-08-25) : focusables, nommes, le
      // jour choisi porte aria-pressed, et les fleches naviguent (delegue
      // clavier global d app-main sur data-cal-date).
      const urgences = agg ? [
        agg.aCloturer ? { ton: 'red', mot: `${agg.aCloturer} à clôturer` } : null,
        agg.aVerifier ? { ton: 'amber', mot: `${agg.aVerifier} à vérifier` } : null,
      ].filter(Boolean) : [];
      const dit = agg
        ? [`${agg.count} réservation${agg.count > 1 ? 's' : ''}`, `${agg.pax} joueur${agg.pax > 1 ? 's' : ''}`, ...urgences.map((u) => u.mot)].join(', ')
        : 'aucune réservation';
      cells += `<button type="button" class="pv2-cal-cell heat-${heat} ${dateStr === today ? 'today' : ''} ${dateStr === selectedDate ? 'selected' : ''}${urgences.length ? ` has-${urgences[0].ton}` : ''}" data-cal-date="${dateStr}" aria-pressed="${dateStr === selectedDate ? 'true' : 'false'}" aria-label="${day} · ${dit}" onclick="pv2SelectResDay('${dateStr}')">
        <span class="pv2-cal-day">${day}${agg ? `<span class="pv2-cal-n" aria-hidden="true">${agg.count}<span class="pv2-cal-count-label">rés.</span></span>` : ''}</span>
        ${/* Un jour sans reservation n affiche RIEN : trente tirets sur un mois
              creux faisaient une grille de trous. Le compte s ecrit en mots
              sur desktop ; sur mobile, le compteur compact est accompagne
              de « rés. » et le libelle accessible reste complet. */''}
        ${agg ? `<span class="pv2-cal-meta"><strong>${agg.count}</strong> réservation${agg.count > 1 ? 's' : ''}<span class="pv2-cal-pax">${agg.pax} joueur${agg.pax > 1 ? 's' : ''}</span></span>` : ''}
        ${urgences.length ? `<span class="pv2-cal-flags" aria-hidden="true">${urgences.map((u) => `<span class="pv2-cal-flag ${u.ton}"><i></i><b>${esc(u.mot)}</b></span>`).join('')}</span>` : ''}
      </button>`;
    }

    const dayRows = source
      .filter((r) => r.date === selectedDate)
      .sort((a, b) => String(a.startTime || '').localeCompare(String(b.startTime || '')));
    const dayAgg = byDay.get(selectedDate) || { count: 0, pax: 0, revenue: 0 };
    const dayLabel = parseLocalDate(selectedDate).toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' });

    const flow = dayRows.length
      ? dayRows.map((r) => {
        const meta = statusMeta(r);
        const time = String(r.startTime || '').slice(0, 5);
        // Une visite a la carte dit ses activites et leur duree, pas « Bowling ·
        // 30 min » (audit du 2026-09-28). Avec des pistes, la duree reste celle
        // du dossier, comme la liste du jour.
        const programme = typeof resumeProgrammeReservation === 'function' ? resumeProgrammeReservation(r) : '';
        return `<div class="pv2-flow-item ${meta.tone}" onclick="openStaffReservationDetail('${escJs(r.id)}')">
          <div class="pv2-flow-time">${esc(time)}<small>${esc(dureeVenueLabel(r))}</small></div>
          <div class="pv2-flow-rail"></div>
          <div class="pv2-flow-body">
            <strong>${esc(r.name || 'Sans nom')}</strong>
            <span>${esc(programme || nomFormuleOuType(r))} · ${Number(r.pax) || 0} joueurs${pistesLabel(r.lanes) ? ` · ${pistesLabel(r.lanes)}` : ''} · ${Number(r.price) > 0 ? formatMontant(r.price) : 'prix au comptoir'}</span>
            ${/* La ligne au-dessus finit par le montant : la marque dit donc la
                 REFERENCE, pas une deuxieme fois le montant. */''}
            ${pv2MarqueursDossier(r, { montantDeja: true })}
          </div>
          ${statusChip(r)}
        </div>`;
      }).join('')
      : `<div class="pv2-empty"><strong>Journée libre</strong>Aucune réservation active sur cette date.</div>`;

    // UNE VARIATION SE COMPARE A QUELQUE CHOSE. Quand le mois de reference ne
    // contient AUCUNE reservation, getStaffReservationsTrend rend « +100% » sur
    // tout ce qui est non nul : trois tuiles sur quatre affichaient la meme
    // pastille verte, qui ne mesurait rien. Rien n est plus honnete qu une
    // absence de pastille : la regle porte sur la periode de reference, pas sur
    // la tuile, donc les quatre suivent la meme.
    const refPeriodeVide = !metrics.previousReservations.length;
    // UNE VARIATION COMPARE DEUX MOIS FINIS (02/10, defaut 1 du chantier
    // console : « +18 % » comparait octobre, dont les trois quarts sont a
    // venir, a tout septembre). Le mois en cours ou a venir n a pas de
    // pastille ; il dit plutot ce qui reste a venir.
    const moisFini = range.monthEnd < todayStr();
    const varia = (texte) => (refPeriodeVide || !moisFini ? '' : texte);
    const nomMoisPrecedent = parseLocalDate(range.previousMonthStart).toLocaleDateString('fr-BE', { month: 'long' });
    const aVenir = metrics.monthReservations.filter((r) => r.date > todayStr());
    const piedAVenir = !moisFini && aVenir.length
      ? `dont ${aVenir.length} à venir`
      : moisFini && !refPeriodeVide ? `vs ${nomMoisPrecedent}` : '';
    const piedJoueursAVenir = !moisFini && aVenir.length
      ? `dont ${aVenir.reduce((n, r) => n + (Number(r.pax) || 0), 0).toLocaleString('fr-BE')} à venir`
      : moisFini && !refPeriodeVide ? `vs ${nomMoisPrecedent}` : '';
    // L occupation d un mois en cours se mesure sur ses jours PASSES : les
    // jours a venir, encore vides, la tiraient vers le bas.
    const joursPasses = (range.monthDays || []).filter((d) => d <= todayStr());
    const moisEnCours = !moisFini && range.monthStart <= todayStr();
    const occupation = moisEnCours && typeof getStaffReservationsOccupancy === 'function' && joursPasses.length
      ? getStaffReservationsOccupancy(joursPasses, metrics.monthReservations.filter((r) => r.date <= todayStr()))
      : metrics.occupancy;
    const piedOccupation = moisFini ? 'pistes, mois entier' : moisEnCours ? 'pistes, jours passés du mois' : 'pistes, réservé à ce jour';

    // Une courbe de tendance a besoin d une TENDANCE. Sur une serie ou un seul
    // jour est rempli, le trace est un pic isole sur une ligne plate : il
    // occupe 38 px par tuile et ne dit rien. On ne le passe qu a partir de
    // trois points non nuls, ou une forme commence a exister.
    const courbe = (serie) => (Array.isArray(serie) && serie.filter((v) => Number(v) > 0).length >= 3 ? serie : null);

    // OCCUPATION : le denominateur n est PAS celui du planning. Le planning
    // rapporte les heures-pistes vendues aux heures-pistes ouvertes DU JOUR
    // (16% sur la journee chargee) ; cette tuile les rapporte a celles du MOIS
    // entier. Les deux sont justes, mais un « 0% » nu a cote d un « 16% » se
    // lit comme une contradiction. Deux corrections : le pied nomme le
    // denominateur, et un taux non nul arrondi a zero s ecrit « < 1% » au
    // lieu de « 0% », qui affirmait un centre vide.
    // Ce qui prouve l arrondi, c est le NUMERATEUR, pas le nombre de
    // reservations : un mois de laser seul ne vend aucune heure-piste, son 0%
    // est exact et « < 1% » y serait faux. La serie `occupancy` porte
    // justement les heures-pistes vendues jour par jour (getStaffReservations-
    // DailySeries, metrique laneHours) : leur somme est le numerateur du taux.
    // Non nulle avec un taux arrondi a 0 = le taux a ete rabote, et c est le
    // seul cas ou « < 1% » dit la verite.
    const heuresPistesVendues = (Array.isArray(metrics.series.occupancy) ? metrics.series.occupancy : [])
      .reduce((somme, valeur) => somme + (Number(valeur) || 0), 0);
    const occupationNulleMaisActive = occupation === 0 && heuresPistesVendues > 0;

    const paint = () => {
    root.innerHTML = `<div class="pv2-shell">
      ${bar({
        crumb: '',
        title: 'Réservations',
        sub: `${esc(sync)}${staffReservationsDataCache.error ? ' · <span style="color:var(--v2-amber)">API indisponible</span>' : ''}`,
        // Les trois boutons de mois forment UN controle : ils sont groupes pour
        // que la barre ait un bloc a poser sur sa propre ligne quand l ecran se
        // resserre. Sans ce groupe, « + Reservation » retombait seul a gauche
        // d un second rang (mesure a 390 px : x=12, y=214, barre a 96 px de
        // haut). Rien ne change au bureau : meme inline-flex, meme gouttiere.
        actions: `
          <div class="pv2-month-nav">
            <button type="button" class="pv2-btn" onclick="shiftStaffReservationsMonth(-1)" aria-label="Mois précédent">‹</button>
            <button type="button" class="pv2-btn" onclick="openStaffReservationsMonthPicker()">${esc(monthLabel)}</button>
            <input id="staffReservationsMonthPicker" type="month" value="${esc(range.monthKey)}" onchange="setStaffReservationsMonthFromPicker(this.value)" style="position:absolute;opacity:0;pointer-events:none" aria-label="Choisir un mois">
            <button type="button" class="pv2-btn" onclick="shiftStaffReservationsMonth(1)" aria-label="Mois suivant">›</button>
          </div>
          <button type="button" class="pv2-btn" onclick="refreshStaffReservations()">Actualiser</button>
          ${typeof peutGeste !== 'function' || peutGeste('reserver') ? '<button type="button" class="pv2-btn primary" onclick="openStaffReservationsQuick()">+ Réservation</button>' : ''}`,
      })}

      <section class="pv2-stats">
        ${/* Le libelle dit le mois affiche : « ce mois » restait ecrit en
             feuilletant septembre ou novembre. */''}
        ${stat({ label: 'Réservations', count: metrics.reservations, delta: varia(metrics.reservationTrend), deltaTone: trendTone(metrics.reservationTrend), foot: piedAVenir, series: courbe(metrics.series.reservations) })}
        ${stat({ label: 'Joueurs', count: metrics.players, delta: varia(metrics.playersTrend), deltaTone: trendTone(metrics.playersTrend), foot: piedJoueursAVenir, series: courbe(metrics.series.players) })}
        ${stat({ label: "Chiffre d'affaires", value: (typeof canUseStaffPermission === 'function' && !canUseStaffPermission('payments.view')) ? '···' : money(metrics.revenue), delta: varia(metrics.revenueTrend), deltaTone: trendTone(metrics.revenueTrend), foot: moisFini && !refPeriodeVide ? `vs ${nomMoisPrecedent}` : moisFini ? '' : 'réservé, à venir compris', series: courbe(metrics.series.revenue) })}
        ${occupationNulleMaisActive
          ? stat({ label: 'Occupation', value: '< 1%', delta: varia(metrics.occupancyTrend), deltaTone: trendTone(metrics.occupancyTrend), foot: piedOccupation, series: courbe(metrics.series.occupancy) })
          : stat({ label: 'Occupation', count: occupation, suffix: '%', delta: varia(metrics.occupancyTrend), deltaTone: trendTone(metrics.occupancyTrend), foot: piedOccupation, series: courbe(metrics.series.occupancy) })}
      </section>

      <section class="pv2-split">
        <article class="pv2-panel">
          <div class="pv2-panel-head">
            <h2>${esc(monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1))}</h2>
          </div>
          <div class="pv2-panel-body pv2-cal">
            <div class="pv2-cal-head"><span>Lun</span><span>Mar</span><span>Mer</span><span>Jeu</span><span>Ven</span><span>Sam</span><span>Dim</span></div>
            <div class="pv2-cal-grid">${cells}</div>
            ${/* Sur telephone la case n a la place que d un point : la legende
                 dit ce que veut dire chaque couleur (jamais la couleur seule). */''}
            ${(() => {
              const tons = new Set([...byDay.values()].flatMap((a) => [a.aCloturer ? 'red' : '', a.aVerifier ? 'amber' : '']).filter(Boolean));
              return tons.size ? `<p class="pv2-cal-legende">${tons.has('red') ? '<span><i class="red"></i>à clôturer</span>' : ''}${tons.has('amber') ? '<span><i class="amber"></i>à vérifier</span>' : ''}</p>` : '';
            })()}
          </div>
        </article>
        <article class="pv2-panel">
          <div class="pv2-panel-head pv2-day-head${pv2ResSearch.open ? ' is-searching' : ''}">
            ${pv2ResSearch.open ? `<div class="pv2-res-search${pv2ResSearch.animer ? ' is-opening' : ''}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="15" height="15" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg>
              <input data-pl-focus="reservations.recherche" value="${esc(pv2ResSearch.query)}" placeholder="Nom ou téléphone, toutes les dates…" aria-label="Rechercher une réservation par client, toutes dates confondues" oninput="pv2ResSearchInput(this.value)">
            </div>` : `<div><h2>${esc(dayLabel)}</h2>
            <small>${dayAgg.count ? `${formatStaffTerrainCount(dayAgg.count, 'réservation')} · ${formatStaffTerrainCount(dayAgg.pax, 'joueur')} · ${money(dayAgg.revenue)}` : 'Aucune réservation'}</small></div>`}
            <button type="button" class="pv2-search-toggle${pv2ResSearch.open ? ' is-open' : ''}" onclick="pv2ResSearchToggle()" aria-label="${pv2ResSearch.open ? 'Fermer la recherche' : 'Rechercher un client sur toutes les dates'}" title="${pv2ResSearch.open ? 'Fermer la recherche' : 'Rechercher un client, toutes dates confondues'}">
              ${pv2ResSearch.open
                ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="15" height="15" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`
                : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="15" height="15" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg>`}
            </button>
          </div>
          <div class="pv2-panel-body pv2-flow">${pv2ResSearchBody(flow)}</div>
        </article>
      </section>
    </div>`;
    };
    // La barre de recherche survit au re-rendu du poll : data-pl-focus.
    if (typeof PinlaneMotion !== 'undefined' && PinlaneMotion.garderFocus) PinlaneMotion.garderFocus(paint);
    else paint();
    mount(root, 'reservations');
    ensureStaffReservationsData();
    // Panneau de recherche ouvert : la fenetre se rafraichit toute seule au
    // poll (la garde de fraicheur limite a un appel par minute), donc une
    // reservation prise a l instant finit par apparaitre sans rouvrir la page.
    if (pv2ResSearch.open) pv2ResSearchEnsureData(false);
  };

  /* ==========================================================================
     CLIENTS : CRM: table + profile
     ======================================================================== */

  function pv2AvgBasket(rows) {
    const spent = rows.reduce((s, r) => s + (Number(r.spent) || 0), 0);
    const count = rows.reduce((s, r) => s + (Number(r.reservations) || 0), 0);
    return count ? spent / count : 0;
  }

  const CRM_STATUS_TONE = { loyal: 'accent', active: 'success', new: 'info', inactive: 'warn' };
  const crmPct = (value) => `${Math.round((Number(value) || 0) * 100)}%`;
  const crmNum = (value) => (Math.round((Number(value) || 0) * 10) / 10).toLocaleString('fr-BE');

  function crmStatusPill(row) {
    return `<span class="crm-pill tone-${CRM_STATUS_TONE[row.statusClass] || 'muted'}"><span class="crm-dot"></span>${esc(row.status || '-')}</span>`;
  }

  // 4 segments simples (fusion Clients+Groupes, KISS). Une seule vue active,
  // re-clic sur l'actif → retour « Tous ». Remplace facettes + tri custom.
  const CRM_SEGMENTS = [
    ['tous', 'Tous'],
    ['avenir', 'À venir'],
    ['relancer', 'À relancer'],
    ['vip', 'Clients clés'],
  ];

  function crmSegmentBar(filteredCount, totalCount) {
    const active = getStaffClientSegment();
    // Le badge est posé sur « À venir » QUEL QUE SOIT le segment actif : c'est
    // tout l'intérêt, le chiffre se voit sans être déjà dans le bon filtre.
    const leads = typeof getStaffNewCustomRequestCount === 'function' ? getStaffNewCustomRequestCount() : 0;
    const seg = CRM_SEGMENTS.map(([key, label]) => {
      const badge = key === 'avenir' && leads
        ? `<span class="crm-seg-badge">${leads} nouvelle${leads > 1 ? 's' : ''}</span>`
        : '';
      // data-crm-seg : identifiant STABLE du segment. Le libellé visible porte
      // maintenant un badge, il ne peut plus servir de clé (ni au code, ni aux
      // gates qui pilotent ces boutons).
      return `<button type="button" class="crm-seg${active === key ? ' is-active' : ''}" data-crm-seg="${key}" aria-pressed="${active === key}" onclick="setStaffClientSegment('${key}')"><span class="crm-seg-label">${esc(label)}</span>${badge}</button>`;
    }).join('');
    // Le compteur qui DESCEND pendant la frappe : c'est lui qui prouve a l'oeil
    // que la recherche est instantanee. Les deux nombres sont isoles pour etre
    // animes separement.
    const count = active === 'avenir' ? '' : `<span class="crm-seg-count"><strong>${filteredCount}</strong>${active === 'tous' ? ` / <span>${totalCount}</span>` : ''} client${filteredCount > 1 ? 's' : ''}</span>`;
    // LA RECHERCHE EST ICI, pas dans la barre de titre : c'est au-dessus de la
    // liste qu'on cherche, et elle etait a l'autre bout de l'ecran.
    // `data-pl-focus` la fait survivre au re-rendu declenche par sa propre
    // frappe - sans ca le focus partait a chaque lettre.
    const search = `<label class="crm-search">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="15" height="15" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg>
      <input type="search" data-pl-focus="clients.recherche" value="${esc(state.staffClientQuery || '')}"
        placeholder="Rechercher un client, un email, un téléphone…" aria-label="Rechercher un client"
        oninput="setStaffClientQuery(this.value)">
      ${state.staffClientQuery ? '<button type="button" class="crm-search-clear" aria-label="Effacer la recherche" onclick="setStaffClientQuery(\'\')">&times;</button>' : ''}
    </label>`;
    return `<section class="crm-segbar" role="tablist" aria-label="Vue clients">${seg}${search}${count}</section>`;
  }

  // Badge unique par ligne : le plus décisionnel gagne.
  function crmRowBadge(row, ctx) {
    const relance = getStaffClientRelance(row);
    // « A venir » se decide sur la PROCHAINE reservation seulement (formule
    // anniversaire ou occasion declaree). L'ancien test acceptait aussi
    // row.hasBirthday, qui est un fait HISTORIQUE : tout client ayant deja pris
    // une formule f1-f8 portait le badge, sur toutes les lignes.
    if (row.nextIsBirthday) {
      return '<span class="crm-pill tone-info">Anniv. à venir</span>';
    }
    if (ctx.vipThreshold > 0 && Number(row.spent || 0) >= ctx.vipThreshold) return `<span class="crm-pill tone-accent" title="Plus de ${Math.round(ctx.vipThreshold)} € cumulés (seuil réglable dans Établissement)">Client clé</span>`;
    if (relance.due) return '<span class="crm-pill tone-warn">À relancer</span>';
    if (row.statusClass === 'new') return '<span class="crm-pill tone-info">Nouveau</span>';
    return '';
  }

  // Table 5 colonnes max : Client / Venue / Visites / Dépensé / Badge (ou Pourquoi).
  function crmListRow(row, selected, ctx) {
    const next = row.nextBooking;
    const visite = next
      ? `<strong>${esc(formatStaffClientDateText(next.date))}</strong><small>prochaine venue${next.startTime ? ` · ${esc(String(next.startTime).slice(0, 5))}` : ''}</small>`
      : `<strong>${esc(row.lastVisitAgo || '-')}</strong><small>${esc(row.lastVisit || '')}</small>`;
    const lastCell = ctx.segment === 'relancer'
      ? `<td class="crm-cell-why">${esc(getStaffClientRelance(row).reason)}${row.email && (typeof peutGeste !== 'function' || peutGeste('ecrire')) ? `<button type="button" class="pv2-btn sm" onclick="event.stopPropagation();crmOpenRelance('${escJs(row.id)}')">Relancer</button>` : ''}</td>`
      : `<td class="crm-cell-badge">${crmRowBadge(row, ctx)}</td>`;
    return `
      <tr class="${selected && row.id === selected.id ? 'is-selected' : ''}" tabindex="0" role="button" onclick="selectStaffClient('${escJs(row.id)}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();selectStaffClient('${escJs(row.id)}');}">
        <td class="crm-cell-client">
          <span class="crm-avatar">${esc(row.initials || '-')}</span>
          <span class="crm-client-id"><strong>${esc(row.name || 'Sans nom')}</strong><small>${esc(row.email || row.phone || '')}</small></span>
        </td>
        <td class="crm-cell-visit${next ? ' is-upcoming' : ''}">${visite}</td>
        <td class="num">${Number(row.reservations) || 0}</td>
        <td class="num crm-ltv"><strong>${money(row.spent)}</strong></td>
        ${lastCell}
      </tr>`;
  }

  /* ── « À VENIR » : la MÊME liste que « Tous », adaptée à la question
     opérationnelle « qui vient, quand, combien, et qu'est-ce qui manque ».
     Même composant `.crm-table` : même densité (ligne de 38 px), même
     typographie (12,5 px / 10,5 px), mêmes en-têtes collants, même panneau
     borné à 720 px qui scrolle DANS lui-même, donc la page ne grandit plus
     avec le nombre de réservations.
     Ce qui a été retiré ici le 2026-08-13, et la raison, est écrit au-dessus
     de `getStaffVisitGap` (app-main.js) pour les pastilles de préparation.
     Le reste : les grandes cartes, le mètre « x/6 prêt », la ligne d'habitudes
     en italique, les six facettes d'occasion (déjà supprimées de cette page le
     2026-07-13, restées ici), le second champ de recherche (il y en avait DEUX
     à l'écran), les panneaux « À confirmer en priorité » (re-coupe de la même
     liste) et « Charge à venir · 7 jours » (il ne comptait que les dossiers
     groupe/anniversaire : il annonçait une charge fausse). ── */

  // Un seul jour par en-tête de section, avec ce qu'il porte VRAIMENT : le
  // nombre de réservations affichées et le total de joueurs, tous deux
  // recomposables en additionnant les lignes en dessous.
  function crmDayHeadRow(dateISO, list) {
    const pax = list.reduce((sum, visit) => sum + (Number(visit.pax) || 0), 0);
    // Majuscule sur la PREMIÈRE lettre seulement : `text-transform: capitalize`
    // écrivait « Jeudi 13 Août », le mois prend une minuscule en français.
    const brut = parseLocalDate(dateISO).toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' });
    const jour = brut.charAt(0).toUpperCase() + brut.slice(1);
    const countdown = typeof staffGroupCountdown === 'function' ? staffGroupCountdown(dateISO) : '';
    return `<tr class="crm-day"><th colspan="5" scope="colgroup">
      <span class="crm-day-label">${esc(jour)}</span>
      <span class="crm-day-meta">${list.length} réservation${list.length > 1 ? 's' : ''} · ${pax} joueur${pax > 1 ? 's' : ''}${countdown ? ` · ${esc(countdown)}` : ''}</span>
    </th></tr>`;
  }

  // UNE action par ligne, et c'est la ligne entière : elle ouvre la
  // réservation, là où tout se règle (piste, contact, statut, activités).
  // « Contacter » et « Fiche client » ne disparaissent nulle part : le client
  // se retrouve dans l'onglet « Tous » et le message part de sa fiche.
  function crmUpcomingRow(visit) {
    const gap = typeof getStaffVisitGap === 'function' ? getStaffVisitGap(visit) : null;
    const offre = typeof getStaffClientOfferLabel === 'function' ? getStaffClientOfferLabel(visit.reservation) : 'Réservation';
    const occasion = typeof getReservationOccasionLabel === 'function' ? getReservationOccasionLabel(visit.reservation) : '';
    const heure = visit.startTime ? String(visit.startTime).slice(0, 5) : '--:--';
    return `
      <tr tabindex="0" role="button" onclick="openStaffReservationDetail('${escJs(visit.reservation.id)}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openStaffReservationDetail('${escJs(visit.reservation.id)}');}">
        <td class="crm-cell-time"><strong>${esc(heure)}</strong></td>
        <td class="crm-cell-client">
          <span class="crm-avatar">${esc(visit.initials || '-')}</span>
          <span class="crm-client-id"><strong>${esc(visit.name)}</strong><small>${esc(visit.email || visit.phone || '')}</small></span>
        </td>
        <td class="crm-cell-offer"><strong>${esc(offre)}</strong>${occasion ? `<small>${esc(occasion)}</small>` : ''}</td>
        <td class="num">${Number(visit.pax) || 0}</td>
        <td class="crm-cell-badge">${gap ? `<span class="crm-pill tone-warn">${esc(gap.label)}</span>` : ''}</td>
      </tr>`;
  }

  function crmUpcomingBody() {
    const all = typeof buildStaffUpcomingVisits === 'function' ? buildStaffUpcomingVisits() : [];
    // LE champ de recherche de la page (celui de la barre de segments) pilote
    // aussi cette liste : il n'y en a plus qu'un.
    const query = String(state.staffClientQuery || '').trim().toLowerCase();
    const visits = query
      ? all.filter((visit) => `${visit.name} ${visit.email} ${visit.phone}`.toLowerCase().includes(query))
      : all;
    const limit = Number(state.staffClientListLimit) || 40;
    const shown = visits.slice(0, limit);

    let rows = '';
    let currentDay = '';
    shown.forEach((visit, index) => {
      if (visit.dateISO !== currentDay) {
        currentDay = visit.dateISO;
        rows += crmDayHeadRow(currentDay, shown.slice(index).filter((v) => v.dateISO === currentDay));
      }
      rows += crmUpcomingRow(visit);
    });

    const empty = `<tr><td colspan="5"><div class="crm-empty"><strong>Aucune venue à préparer</strong>${query ? 'Aucune réservation à venir ne correspond à cette recherche.' : 'Les réservations à venir apparaissent ici dès qu\'une date est prise.'}</div></td></tr>`;

    return `<section class="pv2-split crm-split">
      <article class="pv2-panel crm-list-panel">
        <div class="crm-table-wrap">
          <table class="crm-table crm-table-avenir">
            <thead><tr><th class="crm-th">Heure</th><th class="crm-th">Client</th><th class="crm-th">Réservation</th><th class="num crm-th">Joueurs</th><th class="crm-th"></th></tr></thead>
            <tbody>${rows || empty}</tbody>
          </table>
        </div>
        <div class="crm-list-foot">
          <span><b>${shown.length}</b> affichée${shown.length > 1 ? 's' : ''} sur <b>${visits.length}</b></span>
          ${visits.length > shown.length ? '<button type="button" class="pv2-btn" onclick="showMoreStaffClients()">Afficher plus</button>' : ''}
        </div>
      </article>
      <article class="pv2-panel crm-avenir-side">
        ${typeof renderStaffCustomRequestsPanel === 'function' ? renderStaffCustomRequestsPanel() : ''}
      </article>
    </section>`;
  }

  function crmHistoryItem(entry) {
    const r = entry.reservation || {};
    const cancelled = String(r.status) === 'cancelled';
    const cls = r.status === 'paid' ? 'paid' : r.status === 'arrived' ? 'arr' : cancelled ? 'cancel' : 'conf';
    const acts = [];
    if (typeof getBowlingWindowsFromReservation === 'function' && getBowlingWindowsFromReservation(r).length) acts.push('Bowling');
    if (typeof getLaserWindowsFromReservation === 'function' && getLaserWindowsFromReservation(r).length) acts.push('Laser');
    const lanesTxt = (r.lanes || []).length ? `Piste${r.lanes.length > 1 ? 's' : ''} ${r.lanes.join(', ')}` : '';
    const occ = r.occasion && typeof STAFF_OCCASION_LABELS !== 'undefined' ? STAFF_OCCASION_LABELS[String(r.occasion).toLowerCase()] : '';
    return `
      <details class="crm-hist status-${cls}">
        <summary>
          <span class="crm-hist-date">${esc(entry.date || '-')}</span>
          <span class="crm-hist-main"><strong>${esc(entry.label || 'Réservation')}</strong><small>${Number(r.pax) || 0} joueur${(Number(r.pax) || 0) > 1 ? 's' : ''}${acts.length ? ` · ${acts.join(' + ')}` : ''}</small></span>
          <span class="crm-hist-amount ${entry.amount < 0 ? 'is-neg' : ''}">${formatMontant(Math.abs(entry.amount))}</span>
          <span class="crm-pill tone-${r.status === 'paid' ? 'success' : cancelled ? 'warn' : 'muted'} crm-hist-status">${esc(entry.status)}</span>
        </summary>
        <div class="crm-hist-detail">
          <div><dt>Heure</dt><dd>${esc(r.startTime || '-')}${r.duration ? ` · ${crmNum(r.duration)}h` : ''}</dd></div>
          ${lanesTxt ? `<div><dt>Emplacement</dt><dd>${esc(lanesTxt)}</dd></div>` : ''}
          ${occ ? `<div><dt>Occasion</dt><dd>${esc(occ)}</dd></div>` : ''}
          ${r.paymentMethod ? `<div><dt>Paiement</dt><dd>${esc(r.paymentMethod)}</dd></div>` : ''}
          <div><dt>Canal</dt><dd>${r.channel === 'staff' ? 'Comptoir' : 'En ligne'}</dd></div>
          ${Array.isArray(r.extras) && r.extras.length ? `<div><dt>Extras</dt><dd>${esc(r.extras.map((e) => (e && (e.label || e.name)) || e).join(', '))}</dd></div>` : ''}
          ${crmNotesTexte(r) ? `<div class="crm-hist-notes"><dt>Notes</dt><dd>${esc(crmNotesTexte(r))}</dd></div>` : ''}
        </div>
      </details>`;
  }

  function crmCommsBlock(selected) {
    const comms = getStaffClientCommunications(selected);
    const ecrire = typeof peutGeste !== 'function' || peutGeste('ecrire');
    const compose = selected.email
      ? (ecrire ? `<button type="button" class="pv2-btn" onclick="pv2OpenComposer({to:'${escJs(selected.email)}',name:'${escJs(selected.name || '')}'})">${ci('mail')}Nouveau message</button>` : '')
      : '<span class="crm-muted">Aucune adresse email</span>';
    if (comms === null) {
      const loading = staffClientCommsCache.loading;
      const failed = !!staffClientCommsCache.error;
      return `<section class="crm-sec"><div class="crm-sec-head"><h3>Messages & relances</h3></div>
        <div class="crm-empty">${loading ? 'Chargement de l\'historique…' : failed ? 'Historique des messages indisponible pour ce rôle.' : 'Historique non chargé.'}${!loading ? ` ${compose}` : ''}</div></section>`;
    }
    if (!comms.length) {
      return `<section class="crm-sec"><div class="crm-sec-head"><h3>Messages & relances</h3></div>
        <div class="crm-empty"><strong>Jamais contacté.</strong> Aucun message envoyé à ce client. ${compose}</div></section>`;
    }
    const sent = comms.filter((c) => ['sent', 'delivered'].includes(c.status)).length;
    const delivered = comms.filter((c) => c.status === 'delivered').length;
    const failedCount = comms.filter((c) => c.status === 'failed').length;
    const last = comms[0];
    const CHAN = { email: 'mail', sms: 'message', whatsapp: 'message', note: 'note' };
    const TONE = { sent: 'info', delivered: 'success', failed: 'warn', queued: 'info', draft: 'muted' };
    // Statut en FRANÇAIS : « failed » / « delivered » bruts sur la fiche
    // étaient le seul anglais de l'écran (vu sur capture mobile 2026-08-05).
    const STATUS_FR = { sent: 'Envoyé', delivered: 'Délivré', failed: 'Échec', queued: 'En attente', draft: 'Brouillon', received: 'Reçu' };
    const items = comms.slice(0, 40).map((c) => `
      <div class="crm-comm dir-${esc(c.direction || 'outbound')}">
        <span class="crm-comm-icon">${ci(CHAN[c.channel] || 'mail')}</span>
        <span class="crm-comm-main"><strong>${esc(c.subject || c.templateId || 'Message')}</strong><small>${esc(c.recipient || '')} · ${esc((typeof formatOpsTimestamp === 'function' && (c.sentAt || c.createdAt)) ? formatOpsTimestamp(c.sentAt || c.createdAt) : (c.sentAt || c.createdAt || ''))}${c.direction === 'inbound' ? ' · reçu' : ''}</small></span>
        <span class="crm-pill tone-${TONE[c.status] || 'muted'}">${esc(STATUS_FR[c.status] || c.status || '')}</span>
        ${selected.email && ecrire ? `<button type="button" class="crm-icon-btn" title="Renvoyer" aria-label="Renvoyer" onclick="pv2OpenComposer({to:'${escJs(selected.email)}',name:'${escJs(selected.name || '')}'})">${ci('refresh')}</button>` : ''}
      </div>`).join('');
    return `<section class="crm-sec"><div class="crm-sec-head"><h3>Messages & relances <span class="crm-count">${comms.length}</span></h3>${compose}</div>
      <div class="crm-comm-stats">${sent} envoyé${sent > 1 ? 's' : ''} · ${delivered} délivré${delivered > 1 ? 's' : ''} · ${failedCount} échec${failedCount > 1 ? 's' : ''}${last ? ` · dernier ${esc((typeof formatOpsTimestamp === 'function' && (last.sentAt || last.createdAt)) ? formatOpsTimestamp(last.sentAt || last.createdAt) : '')}` : ''}</div>
      <div class="crm-comm-list">${items}</div></section>`;
  }

  /* ── Relance 1-clic : composer inline prérempli, envoi RÉEL via la queue
     communications (action sendClientRelance). Boucle fermée : le marqueur
     « relancé il y a X j » (comms) se met à jour après envoi. ── */
  // LES DEUX RELANCES DE FICHE CLIENT, SORTIES DE LEUR FONCTION. Elles vivaient
  // en dur au milieu de crmRelancePrefill, donc hors de portee du gate
  // d ecriture (scripts/ecriture-client-check.js), qui extrait et evalue les
  // tableaux de modeles. Ce sont pourtant des textes que le client lit.
  // Le DERNIER element sert de repli : la relance « dormant ».
  const PV2_RELANCES = [
    {
      kind: 'anniversaire',
      reason: 'birthday',
      subject: 'L’anniversaire approche 🎂',
      body: (v) => `Bonjour ${v.firstName},\n\nL'an dernier vous aviez fêté un anniversaire chez ${v.centreName}, et c'était un beau moment.\nLa date approche à nouveau. Les créneaux du week-end partent vite, alors réservez tôt si vous voulez remettre ça.\n\nRépondez à ce message ou réservez en ligne, l'équipe s'occupe du reste.\n\nBien à vous,\nL'équipe ${v.centreName}`,
    },
    {
      kind: 'dormant',
      reason: 'dormant',
      subject: 'Une piste vous attend 🎳',
      body: (v) => `Bonjour ${v.firstName},\n\nCela fait un moment sans vous voir au centre. Bowling, laser, arcades, tout est prêt.\nVenez en semaine, c'est plus calme, et plus tranquille pour jouer.\n\nRéservez en ligne quand vous voulez, ou répondez simplement à ce message.\n\nÀ bientôt,\nL'équipe ${v.centreName}`,
    },
  ];

  const crmRelance = { openFor: null, reason: 'dormant', subject: '', body: '', busy: false };
  const crmRelanceStats = { loaded: false, loading: false, sent: 0, converted: 0, revenue: 0 };
  const crmNotes = { key: '', body: '', loaded: false, loading: false, saving: false };

  function crmRelancePrefill(row) {
    const relance = getStaffClientRelance(row);
    const firstName = String(row.name || '').trim().split(/\s+/)[0] || '';
    // Signature = le NOM DU CENTRE courant, jamais un client ecrit en dur.
    const centreName = (typeof getCurrentStaffCenterName === 'function' && getCurrentStaffCenterName())
      || (typeof getCurrentStaffCenterId === 'function' && getCurrentStaffCenterId())
      || 'du centre';
    const modele = PV2_RELANCES.find((item) => item.kind === relance.kind) || PV2_RELANCES[PV2_RELANCES.length - 1];
    return {
      reason: modele.reason,
      subject: modele.subject,
      body: modele.body({ firstName, centreName }),
    };
  }

  window.crmOpenRelance = function (clientId) {
    if (typeof peutGeste === 'function' && !peutGeste('ecrire')) { toast('Votre rôle ne permet pas d’envoyer des mails.'); return; }
    const row = getStaffClientRows().find((r) => r.id === clientId);
    if (!row || !row.email) { toast('Pas d’adresse email pour ce client.'); return; }
    if (state.staffSelectedClientId !== clientId) state.staffSelectedClientId = clientId;
    const prefill = crmRelancePrefill(row);
    crmRelance.openFor = clientId;
    crmRelance.reason = prefill.reason;
    crmRelance.subject = prefill.subject;
    crmRelance.body = prefill.body;
    renderStaffClientsPage();
  };

  window.crmCloseRelance = function () {
    crmRelance.openFor = null;
    renderStaffClientsPage();
  };

  window.crmRelanceField = function (field, value) {
    crmRelance[field] = value;
  };

  window.crmSendRelance = async function (clientId) {
    if (crmRelance.busy) return;
    if (typeof peutGeste === 'function' && !peutGeste('ecrire')) { toast('Votre rôle ne permet pas d’envoyer des mails.'); return; }
    const row = getStaffClientRows().find((r) => r.id === clientId);
    if (!row || !row.email) return;
    // Filet du moteur de variables (défini plus bas dans ce module, dispo à
    // l'exécution) : une relance éditée à la main ne part jamais avec {{…}}.
    const relanceLeft = pv2FillVars(`${crmRelance.subject}\n${crmRelance.body}`, pv2VarContext({ name: row.name || '' })).unresolved;
    if (relanceLeft.length) { toast(`Complétez d'abord : ${relanceLeft.map((k) => `{{${k}}}`).join(' · ')}`); return; }
    crmRelance.busy = true;
    renderStaffClientsPage();
    try {
      await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({
          action: 'sendClientRelance',
          centerId: state.adminCenterId || 'libramont',
          email: row.email,
          name: row.name || '',
          phone: row.phone || '',
          reason: crmRelance.reason,
          subject: crmRelance.subject,
          body: crmRelance.body,
        }),
      });
      crmRelance.openFor = null;
      toast('Relance en file d’envoi ✓ : je mesure si le client revient.');
      ensureStaffClientComms(true);
      loadCrmRelanceStats(true);
    } catch (error) {
      toast(error.message || 'Envoi impossible.');
    } finally {
      crmRelance.busy = false;
      renderStaffClientsPage();
    }
  };

  async function loadCrmRelanceStats(force = false) {
    if (crmRelanceStats.loading || (crmRelanceStats.loaded && !force)) return;
    crmRelanceStats.loading = true;
    try {
      const payload = await apiRequest(`/api/ops?action=relanceStats&days=90&centerId=${encodeURIComponent(state.adminCenterId || 'libramont')}`);
      crmRelanceStats.sent = Number(payload.sent) || 0;
      crmRelanceStats.converted = Number(payload.converted) || 0;
      crmRelanceStats.revenue = Number(payload.revenue) || 0;
      crmRelanceStats.loaded = true;
    } catch (error) { /* silencieux : le bandeau affiche l'amorce */ } finally {
      crmRelanceStats.loading = false;
      renderStaffClientsPage();
    }
  }
  window.loadCrmRelanceStats = loadCrmRelanceStats;

  /* Notes client persistantes (allergies, prénom de l'enfant…), table client_notes. */
  function crmClientKey(row) {
    return String(row.phone || '').replace(/[^\d+]/g, '') || String(row.email || '').trim().toLowerCase();
  }
  function crmNoteContext(row) { return (state.adminCenterId || 'libramont') + ':' + crmClientKey(row); }

  async function loadCrmClientNote(row) {
    const key = crmClientKey(row);
    const context = crmNoteContext(row);
    if (!key || crmNotes.key === context) return;
    crmNotes.key = context;
    crmNotes.draft = null;
    crmNotes.body = '';
    crmNotes.loaded = false;
    crmNotes.error = '';
    crmNotes.loading = true;
    try {
      const payload = await apiRequest(`/api/ops?action=clientNotes&clientKey=${encodeURIComponent(key)}&centerId=${encodeURIComponent(state.adminCenterId || 'libramont')}`);
      if (crmNotes.key !== context || crmNoteContext(row) !== context) return;
      crmNotes.body = payload.note ? String(payload.note.body || '') : '';
      crmNotes.updatedAt = payload.note?.updatedAt || null;
      crmNotes.clientKey = payload.note?.clientKey || key;
      crmNotes.loaded = true;
    } catch (error) { if (crmNotes.key === context) crmNotes.error = error.message || 'Note client indisponible.'; } finally {
      if (crmNotes.key === context) { crmNotes.loading = false; renderStaffClientsPage(); }
    }
  }

  window.crmReloadClientNote = function (clientId) {
    const row = getStaffClientRows().find(r => r.id === clientId);
    if (!row || crmNotes.loading || crmNotes.saving) return;
    crmNotes.key = ''; return loadCrmClientNote(row);
  };

  window.crmSaveClientNote = async function (clientId, body) {
    if (typeof peutGeste === 'function' && !peutGeste('noterClient')) { toast('Votre rôle ne permet pas d’écrire une note client.'); return; }
    const row = getStaffClientRows().find((r) => r.id === clientId);
    if (!row) return;
    const key = crmClientKey(row);
    const context = crmNoteContext(row);
    // Garde anti-écrasement : jamais de save tant que la note du client n'est
    // pas CHARGÉE (sinon un blur sur textarea vide effacerait la vraie note).
    if (!key || crmNotes.key !== context || !crmNotes.loaded) return;
    crmNotes.draft = body;
    if (crmNotes.saving || (body === crmNotes.body && !crmNotes.error)) return;
    crmNotes.saving = true;
    try {
      const saved = await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'clientNotes', clientKey: crmNotes.clientKey || key, baseUpdatedAt: crmNotes.updatedAt || null, body, centerId: state.adminCenterId || 'libramont' }),
      });
      if (crmNotes.key !== context || crmNoteContext(row) !== context) return;
      crmNotes.body = body;
      crmNotes.error = '';
      crmNotes.updatedAt = saved.note?.updatedAt || crmNotes.updatedAt;
      crmNotes.clientKey = saved.clientKey || crmNotes.clientKey;
      window.PinlaneStaffNotes?.invalidate();
      toast('Note enregistrée.');
    } catch (error) {
      if (crmNotes.key !== context) return;
      crmNotes.error = error.message || 'Note non enregistrée. Votre texte est conservé.';
      toast(error.message || 'Note non enregistrée.');
    } finally {
      crmNotes.saving = false;
      if (crmNotes.key === context) { renderStaffClientsPage(); if (!crmNotes.error && crmNotes.draft !== crmNotes.body) window.crmSaveClientNote(clientId, crmNotes.draft); }
    }
  };
  window.crmClientNoteDraft = function (clientId, body) {
    const row = getStaffClientRows().find(r => r.id === clientId);
    if (row && crmNotes.key === crmNoteContext(row)) crmNotes.draft = body;
  };

  function crmRelanceComposer(selected) {
    const busy = crmRelance.busy;
    return `<div class="crm-composer" role="form" aria-label="Relancer ${esc(selected.name || 'ce client')}">
      <input class="crm-composer-subject" data-pl-focus="clients.relance.objet" value="${esc(crmRelance.subject)}" oninput="crmRelanceField('subject', this.value)" aria-label="Objet">
      <textarea class="crm-composer-body" data-pl-focus="clients.relance.message" rows="7" oninput="crmRelanceField('body', this.value)" aria-label="Message">${esc(crmRelance.body)}</textarea>
      <div class="crm-composer-actions">
        <span class="crm-muted">→ ${esc(selected.email)}</span>
        <button type="button" class="pv2-btn" onclick="crmCloseRelance()">Annuler</button>
        <button type="button" class="pv2-btn primary" onclick="crmSendRelance('${escJs(selected.id)}')" ${busy ? 'disabled' : ''}>${busy ? 'Envoi…' : 'Envoyer la relance'}</button>
      </div>
    </div>`;
  }

  // Fiche client KISS : qui c'est, ce qu'il vaut (3 chiffres), sa prochaine venue
  // (avec la checklist prépa du dossier), pourquoi le relancer, son historique et
  // les messages. Un tap = agir (tel/email cliquables).
  // Présentation : UNE surface continue, sections séparées par hairlines
  // (pas de sous-boîtes empilées), iconographie SVG monochrome.
  function crmFiche(selected, ctx = {}) {
    if (!selected) return '<div class="crm-empty crm-empty-lg"><strong>Sélectionnez un client</strong>Cliquez sur une ligne pour voir sa fiche.</div>';
    ensureStaffClientComms();
    const badges = [crmStatusPill(selected)];
    const estClientCle = ctx.vipThreshold > 0 && Number(selected.spent || 0) >= ctx.vipThreshold;
    // LA PHRASE DIT LA REGLE QUI EST APPLIQUEE. La condition est `>=`, donc un
    // client a EXACTEMENT 308 € porte le badge ; « Plus de 308 € » et « au-delà
    // de 308 € » enoncent une regle differente de celle qui decide. Puisque
    // cette explication devient visible sous les chiffres, elle doit etre juste
    // aux deux endroits.
    if (estClientCle) badges.push(`<span class="crm-pill tone-accent" title="À partir de ${Math.round(ctx.vipThreshold)} € cumulés (seuil réglable dans Établissement)">Client clé</span>`);
    if (selected.hasBirthday) badges.push('<span class="crm-pill tone-info">Anniversaire</span>');
    const kpi = (label, value) => `<div class="crm-kpi"><div class="crm-kpi-val">${value}</div><div class="crm-kpi-label">${esc(label)}</div></div>`;
    const next = selected.nextBooking;
    const relance = getStaffClientRelance(selected);
    let nextBlock = '';
    if (next) {
      // Même lecture que la colonne « manque » du segment « À venir » : le
      // même `getStaffVisitGap`, donc la fiche et la liste ne peuvent pas se
      // contredire. La checklist ne vit plus nulle part (audit 2026-08-13) : un
      // clic OUVRE la réservation, là où le manque se corrige vraiment.
      const visit = { id: `r-${next.id}`, reservation: next, row: selected, dateISO: next.date, startTime: next.startTime || '', pax: Number(next.pax || 0), email: next.email || selected.email || '', phone: next.phone || selected.phone || '' };
      const gap = typeof getStaffVisitGap === 'function' ? getStaffVisitGap(visit) : null;
      const paxN = Number(next.pax) || 0;
      nextBlock = `<section class="crm-sec crm-next">
        <div class="crm-sec-head"><h3>Prochaine venue</h3><span class="crm-pill tone-${gap ? 'warn' : 'success'}">${gap ? esc(gap.label) : 'Prêt'}</span></div>
        <button type="button" class="crm-next-open" onclick="openStaffReservationDetail('${escJs(next.id)}')">
          <span class="crm-next-body"><strong>${esc(formatStaffClientDateText(next.date))}${next.startTime ? ` · ${esc(String(next.startTime).slice(0, 5))}` : ''}</strong><span>${esc(getStaffClientOfferLabel(next))} · ${paxN} joueur${paxN > 1 ? 's' : ''}</span></span>
          <span class="crm-next-cta">Ouvrir la résa</span>
        </button>
      </section>`;
    }
    // Un geste que le role ne peut pas faire ne se montre pas (les regles du
    // serveur, lues dans peutGeste).
    const ecrire = typeof peutGeste !== 'function' || peutGeste('ecrire');
    const noter = typeof peutGeste !== 'function' || peutGeste('noterClient');
    const noteLue = crmNotes.key === crmNoteContext(selected) && crmNotes.loaded ? crmNotes.body : null;
    const actionsFiche = [
      selected.email && ecrire ? `<button type="button" class="pv2-btn" onclick="pv2OpenComposer({to:'${escJs(selected.email)}',name:'${escJs(selected.name || '')}'})">${ci('mail')}Message</button>` : '',
      typeof peutGeste !== 'function' || peutGeste('reserver') ? `<button type="button" class="pv2-btn primary" onclick="openStaffClientBooking('${escJs(selected.id)}')">+ Réservation</button>` : '',
    ].join('');
    return `
      <div class="crm-fiche">
        <section class="crm-sec crm-head">
          <span class="crm-avatar crm-avatar-lg">${esc(selected.initials || '-')}</span>
          <div class="crm-head-id">
            <div class="crm-head-row"><h2>${esc(selected.name || 'Sans nom')}</h2><span class="crm-head-badges">${badges.join('')}</span></div>
            <div class="crm-head-contact">
              ${selected.phone ? `<a href="tel:${esc(selected.phone)}" class="crm-contact-link">${ci('phone')}${esc(selected.phone)}</a>` : ''}
              ${selected.email ? `<a href="mailto:${esc(selected.email)}" class="crm-contact-link">${ci('mail')}${esc(selected.email)}</a>` : ''}
            </div>
          </div>
          ${actionsFiche ? `<div class="crm-head-actions">${actionsFiche}</div>` : ''}
        </section>

        <section class="crm-sec crm-kpis crm-kpis-3">
          ${kpi('Dépensé', money(selected.spent))}
          ${kpi('Visites', Number(selected.reservations) || 0)}
          ${kpi('Panier moyen', money(selected.avgBasket))}
        </section>
        ${/* LE SEUIL SE LIT, IL NE SE SURVOLE PAS. La seule explication du
             badge « Client clé » vivait dans un attribut `title` natif : une
             seconde de survol souris, et rien du tout au doigt sur la tablette
             du comptoir. Le badge le plus charge de sens de l ecran etait le
             seul qu on ne pouvait pas comprendre. La ligne s affiche sous les
             chiffres, la ou le montant depense est deja lu, et UNIQUEMENT
             quand le badge est porte. Le `title` reste, il devient un doublon
             inoffensif au lieu de l unique source. */''}
        ${estClientCle ? `<div class="crm-kpi-note">Client clé à partir de ${money(ctx.vipThreshold)} cumulés (seuil réglable dans Établissement)</div>` : ''}

        ${nextBlock}

        ${relance.due ? `<section class="crm-sec crm-relance">
          <div class="crm-relance-row">
            <span class="crm-relance-why">${esc(relance.reason)}</span>
            ${selected.email && ecrire && crmRelance.openFor !== selected.id ? `<button type="button" class="pv2-btn primary" onclick="crmOpenRelance('${escJs(selected.id)}')">${ci('send')}Relancer par email</button>` : ''}
          </div>
          ${crmRelance.openFor === selected.id ? crmRelanceComposer(selected) : ''}
        </section>` : ''}

        <section class="crm-sec">
          <div class="crm-sec-head"><h3>Réservations <span class="crm-count">${(selected.history || []).length}</span></h3></div>
          <div class="crm-history">${(selected.history || []).map(crmHistoryItem).join('') || '<div class="crm-muted">Aucune réservation.</div>'}</div>
        </section>

        ${crmCommsBlock(selected)}

        <section class="crm-sec crm-note-block">
          <div class="crm-sec-head"><h3>Notes</h3>${crmNotes.saving ? '<span class="crm-muted">Enregistrement…</span>' : ''}</div>
          ${crmNotes.error ? `<p class="staff-note-error" role="alert">${esc(crmNotes.error)}</p><button type="button" class="gc-note-retirer" onclick="crmReloadClientNote('${escJs(selected.id)}')">Réessayer</button>` : ''}
          ${noter ? `<textarea class="crm-note-input" data-pl-focus="clients.note" rows="3" maxlength="4000" placeholder="${crmNotes.loading ? 'Chargement…' : 'Allergies, prénom de l\'enfant, préférences… (enregistré automatiquement)'}"
              ${crmNotes.key === crmNoteContext(selected) && crmNotes.loaded ? '' : 'disabled'}
              oninput="crmClientNoteDraft('${escJs(selected.id)}', this.value)" onblur="crmSaveClientNote('${escJs(selected.id)}', this.value)">${esc(crmNotes.key === crmNoteContext(selected) && crmNotes.loaded ? (crmNotes.draft ?? crmNotes.body) : '')}</textarea>`
            : noteLue === null ? '' : noteLue ? `<p style="white-space:pre-wrap;overflow-wrap:anywhere;margin:0">${esc(noteLue)}</p>` : '<p class="crm-muted" style="margin:0">Aucune note.</p>'}
          ${selected.notesConcat ? `<div class="crm-muted crm-note-legacy">Notes des réservations : ${esc(selected.notesConcat)}</div>` : ''}
        </section>
      </div>`;
  }

  window.showMoreStaffClients = function () {
    state.staffClientListLimit = (Number(state.staffClientListLimit) || 40) + 40;
    renderStaffClientsPage();
  };

  window.renderStaffClientsPage = function () {
    const root = document.getElementById('staffClientsPage');
    if (!root) return;
    const segment = getStaffClientSegment();
    const allRows = getStaffClientRows();
    const rows = getFilteredStaffClientRows();
    const vipThreshold = getStaffClientVipThreshold(allRows);
    const ctx = { vipThreshold, segment };
    const sync = staffClientDataCache.loading ? 'Synchronisation…' : staffClientDataCache.loaded ? `Synchronisé ${formatOpsTimestamp(staffClientDataCache.syncedAt)}` : 'En attente du serveur…';

    // 4 chiffres qui déclenchent chacun UNE décision (cliquables → segment).
    const visits = typeof buildStaffUpcomingVisits === 'function' ? buildStaffUpcomingVisits() : [];
    const today = staffGroupToday();
    const within = (v, days) => v.dateISO && staffClientDaysBetween(v.dateISO, today) <= days;
    const upcoming7 = visits.filter((v) => within(v, 7));
    // Des JOUEURS, plus des euros : la somme précédente additionnait des prix
    // réels et des prix ESTIMÉS (panier moyen × joueurs) sous le mot
    // « attendus », sans jamais dire lesquels. Le nombre de joueurs, lui, est
    // porté par chaque réservation et se recompose en additionnant les lignes.
    const upcoming7Pax = upcoming7.reduce((sum, v) => sum + (Number(v.pax) || 0), 0);
    const newLeads = typeof getStaffNewCustomRequestCount === 'function' ? getStaffNewCustomRequestCount() : 0;
    // Le compte AFFICHE est celui des demandes qui attendent encore quelqu un,
    // le meme que le panneau : une demande « en cours » n est pas une demande
    // reglee. Voir `getStaffActiveCustomRequestCount`.
    const leadsActifs = typeof getStaffActiveCustomRequestCount === 'function' ? getStaffActiveCustomRequestCount() : newLeads;
    const relancer = allRows.filter((row) => getStaffClientRelance(row).due).length;
    const statBtn = (seg, html) => `<div class="crm-stat-link${segment === seg ? ' is-active' : ''}" role="button" tabindex="0" onclick="setStaffClientSegment('${seg}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();setStaffClientSegment('${seg}');}">${html}</div>`;
    // Une tuile mene a ce qu elle annonce : celle des demandes va au panneau des
    // demandes, pas au segment « À venir » des reservations.
    const statGo = (fn, html) => `<div class="crm-stat-link" role="button" tabindex="0" onclick="${fn}()" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();${fn}();}">${html}</div>`;

    const selected = rows.find((r) => r.id === state.staffSelectedClientId)
      || allRows.find((r) => r.id === state.staffSelectedClientId)
      || rows[0] || allRows[0] || null;
    if (selected && state.staffSelectedClientId !== selected.id) state.staffSelectedClientId = selected.id;

    let body = '';
    if (segment === 'avenir') {
      body = crmUpcomingBody();
    } else {
      const limit = Number(state.staffClientListLimit) || 40;
      const shown = rows.slice(0, limit);
      const sortState = state.staffClientSort || { key: 'lastDate', dir: 'desc' };
      const th = (key, label, num) => {
        const on = sortState.key === key;
        return `<th scope="col" class="${num ? 'num ' : ''}crm-th${on ? ' is-active' : ''}" aria-sort="${on ? (sortState.dir === 'asc' ? 'ascending' : 'descending') : 'none'}"><button type="button" class="crm-sort-button" data-crm-sort="${key}" onclick="setStaffClientSort('${key}')">${esc(label)} <span class="crm-sort" aria-hidden="true">${ci(on ? (sortState.dir === 'asc' ? 'chevronUp' : 'chevronDown') : 'chevrons')}</span></button></th>`;
      };
      const lastTh = segment === 'relancer'
        ? '<th class="crm-th">Pourquoi</th>'
        : '<th class="crm-th"></th>';
      const tableRows = shown.map((row) => crmListRow(row, selected, ctx)).join('');
      // ROI du CRM : relances envoyées → réservations liées → € (le CRM prouve
      // sa valeur). ATTENTION au vocabulaire : la source (getRelanceStats,
      // lib/ops-communications.js) ne filtre QUE les annulées, elle ne prouve
      // aucune venue réelle. Le libellé dit donc « réservation liée », jamais
      // « venue ». Le héros marketing, lui, est plus strict (visites honorées) :
      // les deux chiffres ne sont pas comparables et ne doivent pas le laisser
      // croire.
      const roi = ctx.segment !== 'relancer' ? '' : `<section class="crm-roi">
        ${crmRelanceStats.loaded && crmRelanceStats.sent > 0
          ? `<span class="crm-roi-figures"><strong>${crmRelanceStats.sent}</strong> relance${crmRelanceStats.sent > 1 ? 's' : ''} sur 90 j<span class="crm-roi-sep"></span><strong>${crmRelanceStats.converted}</strong> réservation${crmRelanceStats.converted > 1 ? 's' : ''} liée${crmRelanceStats.converted > 1 ? 's' : ''}<span class="crm-roi-sep"></span><strong>${money(crmRelanceStats.revenue)}</strong> de réservations liées</span>`
          : `<span class="crm-roi-figures">Relancez un premier client : je mesure ce que chaque relance rapporte.</span>`}
        ${typeof canUseStaffPermission !== 'function' || (canUseStaffPermission('campaigns.manage') && canUseStaffPermission('emails.view')) ? `<button type="button" class="pv2-btn" onclick="openStaffCampaignForRelance()">${ci('megaphone')}Campagne pour ce segment</button>` : ''}
      </section>`;
      body = `${roi}<section class="pv2-split crm-split">
        <article class="pv2-panel crm-list-panel">
          <div class="crm-table-wrap">
            <table class="crm-table">
              <thead><tr>${th('name', 'Client') + th('lastDate', 'Venue') + th('reservations', 'Visites', true) + th('spent', 'Dépensé', true)}${lastTh}</tr></thead>
              <tbody>${tableRows || `<tr><td colspan="5"><div class="crm-empty"><strong>Aucun client</strong>${segment === 'relancer' ? 'Personne à relancer pour le moment.' : 'Aucun résultat.'} <button type="button" class="pv2-btn" onclick="setStaffClientSegment('tous')">Voir tous les clients</button></div></td></tr>`}</tbody>
            </table>
          </div>
          <div class="crm-list-foot">
            <span><b>${shown.length}</b> affiché${shown.length > 1 ? 's' : ''} sur <b>${rows.length}</b></span>
            ${rows.length > shown.length ? `<button type="button" class="pv2-btn" onclick="showMoreStaffClients()">Afficher plus</button>` : ''}
          </div>
        </article>
        <article class="pv2-panel crm-fiche-panel">
          ${crmFiche(selected, ctx)}
        </article>
      </section>`;
    }

    root.innerHTML = `<div class="pv2-shell crm-shell">
      ${bar({
        crumb: 'Clients & marketing',
        title: 'Clients',
        sub: esc(sync),
        actions: `
          <button type="button" class="pv2-btn" onclick="refreshStaffClients()">Actualiser</button>
          ${typeof peutGeste !== 'function' || peutGeste('exporter') ? '<button type="button" class="pv2-btn" onclick="exportStaffClientsCsv()">Exporter</button>' : ''}
          ${typeof peutGeste !== 'function' || peutGeste('reserver') ? '<button type="button" class="pv2-btn primary" onclick="openStaffClientBooking()">+ Nouveau client</button>' : ''}`,
      })}

      <section class="pv2-stats crm-stats">
        ${statBtn('avenir', stat({ label: 'À venir 7 j', count: upcoming7.length, foot: upcoming7Pax ? `${upcoming7Pax} joueur${upcoming7Pax > 1 ? 's' : ''} attendus` : 'réservations à préparer' }))}
        ${statGo('focusStaffCustomRequests', stat({ label: 'Demandes sur mesure', count: leadsActifs, foot: leadsActifs ? (newLeads ? `dont ${newLeads} nouvelle${newLeads > 1 ? 's' : ''}` : 'à traiter') : 'aucune à traiter' }))}
        ${statBtn('relancer', stat({ label: 'À relancer', count: relancer, foot: 'clients à récupérer' }))}
        ${statBtn('vip', stat({ label: 'Panier moyen', value: money(pv2AvgBasket(allRows)), foot: 'par réservation' }))}
      </section>

      ${crmSegmentBar(rows.length, allRows.length)}

      ${body}
    </div>`;
    mount(root, 'clients');
    if (typeof ensureStaffClientData === 'function') ensureStaffClientData();
    // Inconditionnel : le badge de segment et la tuile « Demandes sur mesure »
    // sont visibles depuis TOUS les segments, ils resteraient à zéro tant qu'on
    // n'aurait pas déjà ouvert la vue « À venir ».
    if (typeof ensureStaffCustomRequests === 'function') ensureStaffCustomRequests();
    if (segment === 'relancer' && !crmRelanceStats.loaded && !crmRelanceStats.loading) setTimeout(() => loadCrmRelanceStats(), 0);
    if (selected && crmNotes.key !== crmClientKey(selected) && !crmNotes.loading) setTimeout(() => loadCrmClientNote(selected), 0);
  };

  // Pont Clients → Campagne : préouvre le formulaire campagne sur les dormants.
  // Le formulaire se peint dans Emails, section Campagnes (renderPv2RealCampaigns),
  // pas dans la page Marketing.
  window.openStaffCampaignForRelance = function () {
    if (typeof canUseStaffPermission === 'function' && !(canUseStaffPermission('campaigns.manage') && canUseStaffPermission('emails.view'))) { toast('Votre rôle ne permet pas de créer une campagne.'); return; }
    openStaffMenuPage('emails', 'campagnes');
    setTimeout(() => {
      if (typeof window.pv2CampOpenForm === 'function') {
        pv2Camp.form.segment = 'dormant'; // id serveur réel (lib/campaigns.js)
        pv2CampOpenForm();
        if (typeof window.pv2CampSegmentChanged === 'function') pv2CampSegmentChanged('dormant');
      }
    }, 60);
  };

  /* ==========================================================================
     EMAILS : communication pipeline
     ======================================================================== */

  /* La page vit en SECTIONS depuis le 2026-09-16 : les mails recus se lisent
     dans leur conversation (section Recus), la file des envoyes dans Envoyes.
     Les deux fonctions ci-dessous gardent leur nom (gates, fiche client) mais
     menent desormais a la bonne section. */
  window.pv2SelectEmail = function (uid) {
    const rows = typeof getStaffEmailRows === 'function' ? getStaffEmailRows() : [];
    const ligne = rows.find((r) => r.uid === uid);
    // Un mail RECU n a plus de detail a part : on ouvre la conversation qui le
    // contient. OUVRIR UN MAIL RECU, C EST S EN OCCUPER : la prise de main
    // part a l ouverture du fil (pv2ThreadApresOuverture), sans attendre le
    // premier caractere tape.
    if (ligne && pv2IsInbound(ligne)) {
      pv2ThreadOpenForCommunication(ligne);
      return;
    }
    state.staffEmailSelectedId = uid;
    save();
    if (state.staffEmailsSection !== 'envoyes') pv2EmailsGo('envoyes');
    else renderStaffEmailsPage();
  };

  window.pv2EmailFilter = function (key) {
    // « Recus » n est plus un filtre de la file : c est une section entiere.
    if (key === 'inbound') { pv2EmailsGo('recus'); return; }
    const allowed = ['all', 'queued', 'sent', 'delivered', 'opened', 'failed', 'review'];
    state.staffEmailFilter = allowed.includes(key) ? key : 'all';
    if (state.staffEmailOriginFilter === 'inbound') state.staffEmailOriginFilter = 'all';
    save();
    if (state.staffEmailsSection !== 'envoyes') pv2EmailsGo('envoyes');
    else renderStaffEmailsPage();
  };

  // Segmenté d'ORIGINE (demande du proprio : dissocier les mails partis tout
  // seuls des mails envoyés par l'équipe). Combinable avec les statuts : le
  // choix vit dans state.staffEmailOriginFilter ; depuis le 2026-09-16 les
  // envois de l equipe se lisent en trois familles (manuel, campagne, test).
  window.pv2EmailOriginFilter = function (key) {
    if (key === 'inbound') { pv2EmailsGo('recus'); return; }
    const allowed = ['all', 'auto', 'manual', 'campagne', 'test'];
    state.staffEmailOriginFilter = allowed.includes(key) ? key : 'all';
    state.staffEmailSelectedId = '';
    save();
    if (state.staffEmailsSection !== 'envoyes') pv2EmailsGo('envoyes');
    else renderStaffEmailsPage();
  };

  /* ── Composer universel + boîte de réception (Emails v3) ──────────────────
     Contrats : sendDirectEmail (C3), analyzeInboundEmail (C4), emailTemplates
     (identités + modèles), improveEmailWithAi. Le composer n'exige AUCUNE
     réservation ; la fiche client route ici via pv2OpenComposer. ── */

  /* ── LA BIBLIOTHÈQUE DE MODÈLES FOURNIS ──────────────────────────────────
     Douze moments commerciaux réels d'un centre de loisirs indoor, écrits à la
     main (zéro génération). Règles d'écriture :
       . {{prenom}} et {{centre}} se remplissent TOUT SEULS (destinataire +
         centre courant) : jamais de nom de centre en dur, le produit est
         multi-tenant ;
       . {{offre}}, {{geste}}, {{lien_avis}}… sont des TROUS À COMPLÉTER par le
         gérant : l'envoi est BLOQUÉ tant qu'il en reste un (moteur pv2FillVars),
         c'est ce qui empêche un « Cette semaine : {{offre}} » de partir chez un
         client (bug réel constaté le 2026-08-05) ;
       . aucun prix, aucune promo inventée : un modèle propose une structure,
         jamais un chiffre que le centre n'a pas donné ;
       . réécrits le 2026-11-13 (Ansar : « les mails sont trop faibles ») : un objet
         concret sans point d'exclamation, la raison du mail d'abord, une seule action,
         le centre nommé dans le texte, jamais « nous » ni « on » (lib/client-writing,
         le gate ecriture-client y veille). Pas de formule ni d'équipe en fin de mail : la
         signature du centre les ajoute. « Adapter à mon centre » de l'assistant y met
         ensuite les vraies activités et les vrais prix. */
  const PV2_STARTERS = [
    // Relancer
    { key: 'relance-client', cat: 'Relancer', name: 'On ne vous a plus vu', subject: 'Ça fait longtemps, {{prenom}}', body: 'Bonjour {{prenom}},\n\nVotre dernière visite chez {{centre}} remonte à un moment, et toute l\'équipe serait contente de vous revoir.\n\nUne partie après le travail, un samedi en famille ou une soirée entre amis, il y a toujours une bonne occasion de revenir. Choisissez votre jour et votre heure sur le site de {{centre}}, ou répondez à ce mail et l\'équipe vous propose un créneau.' },
    { key: 'relance-devis', cat: 'Relancer', name: 'Devis resté sans réponse', subject: 'Votre projet chez {{centre}} tient toujours ?', body: 'Bonjour {{prenom}},\n\nVous avez reçu une proposition de {{centre}} pour votre venue, et elle est restée sans réponse pour l\'instant.\n\nSi le projet tient toujours, répondez simplement à ce mail avec la date qui vous convient. L\'équipe vérifie le créneau et vous confirme tout par écrit.\n\nSi vos plans ont changé, une ligne suffit, et l\'équipe ne vous relancera plus.' },
    // Anniversaires & groupes
    { key: 'marketing-anniversaire', cat: 'Anniversaires & groupes', name: 'Pack anniversaire enfant', subject: 'L\'anniversaire de votre enfant, sans rien préparer', body: 'Bonjour {{prenom}},\n\nUn anniversaire à organiser ? Chez {{centre}}, les enfants jouent pendant que vous profitez de la fête, sans rien préparer de votre côté.\n\nRépondez à ce mail avec la date, l\'âge des enfants et leur nombre. L\'équipe vous propose la formule qui leur convient, avec son prix exact.' },
    { key: 'anniversaire-adulte', cat: 'Anniversaires & groupes', name: 'Anniversaire adulte / EVG-EVJF', subject: 'Un anniversaire entre amis qui change du resto', body: 'Bonjour {{prenom}},\n\nPour un anniversaire entre amis, un EVG ou un EVJF, {{centre}} réunit plusieurs activités au même endroit, sans aucune organisation de votre côté.\n\nRépondez à ce mail avec la date et le nombre de personnes. L\'équipe vous propose un programme pour la soirée, avec son prix par personne.' },
    { key: 'merci-groupe', cat: 'Anniversaires & groupes', name: 'Merci après un groupe', subject: 'Merci pour votre venue, {{prenom}}', body: 'Bonjour {{prenom}},\n\nMerci d\'être venus avec votre groupe chez {{centre}}. Toute l\'équipe espère que chacun a passé un bon moment.\n\nSi quelque chose peut être mieux la prochaine fois, répondez à ce mail. L\'équipe lit chaque message.' },
    // Entreprises & écoles
    { key: 'serieux-entreprise', cat: 'Entreprises & écoles', name: 'Proposition entreprise', subject: 'Votre événement d\'équipe chez {{centre}}', body: 'Bonjour {{prenom}},\n\nMerci pour votre demande. Pour votre événement d\'équipe, {{centre}} accueille votre groupe avec plusieurs activités au même endroit, sur un créneau dédié à votre groupe.\n\nRépondez à ce mail avec la date, le nombre de participants et votre budget par personne. L\'équipe vous envoie une proposition claire, avec le programme et le prix total.' },
    { key: 'devis-groupe-ecole', cat: 'Entreprises & écoles', name: 'Sortie école / mouvement de jeunesse', subject: 'Votre sortie de groupe chez {{centre}}', body: 'Bonjour {{prenom}},\n\nPour une sortie d\'école ou de mouvement de jeunesse, les jours de semaine sont les plus calmes chez {{centre}}, et le groupe a toute la place pour jouer.\n\nRépondez à ce mail avec la date envisagée, l\'âge des enfants et leur nombre. L\'équipe vous prépare un devis clair, avec le programme et le prix par enfant.' },
    // Offres & saisons
    { key: 'promo-semaine', cat: 'Offres & saisons', name: 'Offre de la semaine', subject: 'Cette semaine chez {{centre}}, {{offre}}', body: 'Bonjour {{prenom}},\n\nCette semaine chez {{centre}}, {{offre}}.\n\nL\'offre vaut du {{date_debut}} au {{date_fin}}. Choisissez votre jour et votre heure sur le site de {{centre}}, ou répondez à ce mail pour réserver.' },
    { key: 'creux-semaine', cat: 'Offres & saisons', name: 'Jour calme en semaine', subject: 'Une partie tranquille en semaine, {{prenom}} ?', body: 'Bonjour {{prenom}},\n\nEn semaine, {{centre}} est plus calme. Il n\'y a pas d\'attente, et vous avez tout le temps de jouer.\n\nC\'est le bon moment pour une partie après l\'école ou le travail. Choisissez votre créneau sur le site de {{centre}}, ou répondez à ce mail.' },
    { key: 'vacances-annonce', cat: 'Offres & saisons', name: 'Annonce vacances scolaires', subject: 'Les vacances arrivent, pensez à réserver', body: 'Bonjour {{prenom}},\n\nLes vacances scolaires approchent, et les après-midi se remplissent vite chez {{centre}}.\n\nPour venir au moment qui vous arrange, réservez à l\'avance sur le site de {{centre}}. Vous choisissez votre jour et votre heure, et c\'est réglé.' },
    // Service client
    { key: 'reponse-reclamation', cat: 'Service client', name: 'Réponse à une réclamation', subject: 'Réponse à votre message, {{prenom}}', body: 'Bonjour {{prenom}},\n\nMerci d\'avoir pris le temps d\'écrire à l\'équipe. Ce que vous décrivez n\'est pas ce que {{centre}} veut offrir à ses clients, et toute l\'équipe vous présente ses excuses.\n\nEn dédommagement, l\'équipe vous propose {{geste}}.\n\nL\'équipe espère vous revoir bientôt, dans de meilleures conditions.' },
    { key: 'avis-google', cat: 'Service client', name: 'Demande d\'avis Google', subject: 'Un mot sur votre visite chez {{centre}} ?', body: 'Bonjour {{prenom}},\n\nMerci pour votre visite chez {{centre}}. Si vous avez passé un bon moment, un avis Google aide beaucoup l\'équipe, et cela prend trente secondes.\n\n[[bouton: Laisser un avis | {{lien_avis}}]]\n\nMerci, et à bientôt.' },
  ];

  /* ── LE MOTEUR DE VARIABLES : une seule implémentation ───────────────────
     Tout texte qui part MAINTENANT vers un destinataire concret (composeur,
     réponse inbox, relance fiche client) passe par pv2FillVars : les variables
     connues se remplissent, et l'envoi est BLOQUÉ tant qu'il reste une
     accolade. Les séquences et automatiques, elles, GARDENT leurs {{…}} : le
     serveur les résout à l'envoi, client par client. */
  const PV2_VAR_LABELS = { prenom: 'Prénom', nom: 'Nom complet', centre: 'Nom du centre' };
  // Libellés pour TOUTES les variables que les éditeurs (séquences,
  // automatiques, modèles) peuvent proposer : les jetons portent des mots, les
  // accolades restent une écriture interne.
  const PV2_VAR_LABELS_ALL = { ...PV2_VAR_LABELS, date: 'Date', heure: 'Heure', formule: 'Formule', pax: 'Joueurs', offre: 'Offre', numero: 'N° de réservation' };

  /* ── L'ÉDITEUR À JETONS ──────────────────────────────────────────────────
     Demande explicite du propriétaire (2026-08-06) : ne JAMAIS montrer
     {{prenom}} dans une zone d'écriture. La surface d'édition est un
     contenteditable où chaque variable est un JETON bleu insécable (un
     Backspace le supprime d'un bloc) ; la valeur STOCKÉE reste le texte
     {{...}}, seule langue que le serveur parle. L'élément expose value,
     selectionStart et setSelectionRange comme un textarea : le code existant
     et les gates ne voient pas la différence. */
  function pv2TokChipHtml(key) {
    const k = String(key).toLowerCase();
    const known = Boolean(PV2_VAR_LABELS_ALL[k]);
    return `<span class="pl-tok${known ? '' : ' is-fill'}" data-var="${esc(k)}" contenteditable="false">${esc(known ? PV2_VAR_LABELS_ALL[k] : `${k} · à compléter`)}</span>`;
  }

  function pv2TokeditRender(text) {
    return String(text || '')
      .split(/(\{\{\s*[a-z_][a-z0-9_]*\s*\}\})/gi)
      .map((part) => {
        const m = part.match(/^\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}$/i);
        if (m) return pv2TokChipHtml(m[1]);
        return esc(part).replace(/\n/g, '<br>');
      }).join('');
  }

  function pv2TokeditSerialize(node) {
    let out = '';
    for (const child of node.childNodes) {
      if (child.nodeType === 3) { out += child.nodeValue; continue; }
      if (child.nodeType !== 1) continue;
      if (child.classList && child.classList.contains('pl-tok')) { out += `{{${child.dataset.var}}}`; continue; }
      if (child.tagName === 'BR') { out += '\n'; continue; }
      if (child.tagName === 'DIV' || child.tagName === 'P') {
        if (out && !out.endsWith('\n')) out += '\n';
        out += pv2TokeditSerialize(child);
        continue;
      }
      out += pv2TokeditSerialize(child);
    }
    return out;
  }

  // Position texte <-> position DOM. Un jeton pèse la longueur de son
  // {{...}} ; le curseur ne peut se poser qu'avant ou après lui.
  function pv2TokWeight(el) { return `{{${el.dataset.var}}}`.length; }
  function pv2TokeditOffsetOf(root, node, off) {
    let total = 0;
    const walk = (current) => {
      for (const child of current.childNodes) {
        if (child === node) {
          if (child.nodeType === 3) { total += off; return true; }
          for (let i = 0; i < off; i += 1) total += pv2TokeditLen(child.childNodes[i]);
          return true;
        }
        if (child.nodeType === 3) {
          total += child.nodeValue.length;
          continue;
        }
        if (child.nodeType !== 1) continue;
        if (child.classList && child.classList.contains('pl-tok')) { total += pv2TokWeight(child); continue; }
        if (child.tagName === 'BR') { total += 1; continue; }
        if (child.tagName === 'DIV' || child.tagName === 'P') { if (total && !String(total).endsWith) { /* noop */ } total += 0; }
        if (child.contains(node) || child === node) { if (walk(child)) return true; continue; }
        total += pv2TokeditLen(child);
      }
      return false;
    };
    walk(root);
    return total;
  }
  function pv2TokeditLen(node) {
    if (!node) return 0;
    if (node.nodeType === 3) return node.nodeValue.length;
    if (node.nodeType !== 1) return 0;
    if (node.classList && node.classList.contains('pl-tok')) return pv2TokWeight(node);
    if (node.tagName === 'BR') return 1;
    let n = 0;
    for (const child of node.childNodes) n += pv2TokeditLen(child);
    return n;
  }
  function pv2TokeditPoint(root, offset) {
    let remaining = Math.max(0, Number(offset) || 0);
    const walk = (current) => {
      for (const child of current.childNodes) {
        const len = pv2TokeditLen(child);
        if (remaining > len) { remaining -= len; continue; }
        if (child.nodeType === 3) return { node: child, off: remaining };
        if (child.nodeType === 1 && child.classList && child.classList.contains('pl-tok')) {
          const parent = child.parentNode;
          const idx = [...parent.childNodes].indexOf(child);
          return remaining === 0 ? { node: parent, off: idx } : { node: parent, off: idx + 1 };
        }
        if (child.nodeType === 1 && child.tagName === 'BR') {
          const parent = child.parentNode;
          const idx = [...parent.childNodes].indexOf(child);
          return remaining === 0 ? { node: parent, off: idx } : { node: parent, off: idx + 1 };
        }
        if (child.nodeType === 1) {
          const inner = walk(child);
          if (inner) return inner;
          continue;
        }
      }
      return null;
    };
    return walk(root) || { node: root, off: root.childNodes.length };
  }
  function pv2TokeditSel(el) {
    const sel = window.getSelection();
    if (!sel.rangeCount || !el.contains(sel.anchorNode)) { const end = pv2TokeditSerialize(el).length; return { start: end, end }; }
    const range = sel.getRangeAt(0);
    return {
      start: pv2TokeditOffsetOf(el, range.startContainer, range.startOffset),
      end: pv2TokeditOffsetOf(el, range.endContainer, range.endOffset),
    };
  }

  function pv2TokeditAttach(el) {
    if (el.__tokedit) return;
    el.__tokedit = true;
    Object.defineProperty(el, 'value', {
      get() { return pv2TokeditSerialize(el); },
      set(v) { el.innerHTML = pv2TokeditRender(v); },
    });
    Object.defineProperty(el, 'selectionStart', { get() { return pv2TokeditSel(el).start; } });
    Object.defineProperty(el, 'selectionEnd', { get() { return pv2TokeditSel(el).end; } });
    el.setSelectionRange = function (start) {
      const point = pv2TokeditPoint(el, start);
      const range = document.createRange();
      range.setStart(point.node, point.off);
      range.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    };
  }
  window.pv2TokeditAdoptAll = function (root) {
    (root || document).querySelectorAll('.pv2-tokedit').forEach(pv2TokeditAttach);
  };

  const PV2_TOKEDIT_SINKS = {
    composerBody: (v) => { pv2ComposerField('body', v); pv2ComposerSyncHints(); },
    composerSubject: (v) => { pv2ComposerField('subject', v); pv2ComposerSyncHints(); },
    autoSubject: (v) => pv2AutoEditField('subject', v),
    autoBody: (v) => pv2AutoEditField('body', v),
    seqSubject: (v) => pv2SeqField('subject', v),
    seqBody: (v) => pv2SeqField('body', v),
    tplSubject: (v) => pv2TplField('subject', v),
    tplBody: (v) => pv2TplField('body', v),
    threadReplyBody: (v) => pv2InboxReplyField(pv2Threads.selectedId, 'body', v),
    campSubject: (v) => { pv2Camp.form.subject = v; emCampApercuPeindre(); },
    campBody: (v) => { pv2Camp.form.body = v; emCampApercuPeindre(); },
  };
  window.pv2TokeditInput = function (el) {
    const sink = PV2_TOKEDIT_SINKS[el.dataset.sink];
    if (sink) sink(pv2TokeditSerialize(el));
  };
  window.pv2TokeditKey = function (event) {
    if (event.currentTarget.dataset.single === '1' && event.key === 'Enter') event.preventDefault();
  };
  // Collage en TEXTE BRUT, puis re-normalisation : un {{prenom}} collé devient
  // un jeton, jamais des accolades à l'écran.
  window.pv2TokeditPaste = function (event) {
    event.preventDefault();
    const el = event.currentTarget;
    const text = (event.clipboardData || window.clipboardData).getData('text/plain') || '';
    const { start, end } = pv2TokeditSel(el);
    const v = pv2TokeditSerialize(el);
    el.value = v.slice(0, start) + text + v.slice(end);
    el.setSelectionRange(start + text.length);
    pv2TokeditInput(el);
  };
  function pv2Humanize(text) {
    return String(text || '').replace(/\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/gi, (m, k) => PV2_VAR_LABELS_ALL[k.toLowerCase()] || k);
  }
  function pv2TokeditHtml({ id, sink, value, single = false, plFocus = '', placeholder = '', classe = '', labelledby = '' }) {
    return `<div class="pv2-tokedit${single ? ' is-single' : ''}${classe ? ` ${classe}` : ''}" id="${esc(id)}" data-sink="${esc(sink)}"${single ? ' data-single="1"' : ''}${plFocus ? ` data-pl-focus="${esc(plFocus)}"` : ''}${labelledby ? ` aria-labelledby="${esc(labelledby)}"` : ''} contenteditable="true" role="textbox" aria-multiline="${single ? 'false' : 'true'}" data-placeholder="${esc(pv2Humanize(placeholder))}" spellcheck="false" oninput="pv2TokeditInput(this)" onkeydown="pv2TokeditKey(event)" onpaste="pv2TokeditPaste(event)">${pv2TokeditRender(value)}</div>`;
  }

  // Insertion d'une variable au CURSEUR d'un éditeur identifié. Grâce aux
  // accesseurs value/setSelectionRange, le même chemin sert les jetons et un
  // textarea natif : aucun éditeur n'a de chemin spécial.
  window.pv2InsertVarAt = function (taId, key) {
    const ta = document.getElementById(taId);
    if (!ta) return;
    const start = ta.selectionStart || 0;
    const end = ta.selectionEnd || start;
    const token = `{{${key}}}`;
    const v = ta.value;
    ta.value = v.slice(0, start) + token + v.slice(end);
    ta.focus();
    ta.setSelectionRange(start + token.length, start + token.length);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  };

  // Rangée de jetons de variables cliquables pour un éditeur donné.
  function pv2VarBar(taId, keys) {
    const list = (keys || []).filter((k) => PV2_VAR_LABELS_ALL[k]);
    if (!list.length) return '';
    return `<div class="pv2-toolbar pv2-varbar" role="toolbar" aria-label="Variables disponibles">
      <span class="pv2-varbar-label">Variables</span>
      ${list.map((k) => `<button type="button" class="pv2-tool pv2-tool-var" title="Insérer ${esc(PV2_VAR_LABELS_ALL[k])}" onclick="pv2InsertVarAt('${escJs(taId)}','${escJs(k)}')">${esc(PV2_VAR_LABELS_ALL[k])}</button>`).join('')}
    </div>`;
  }

  function pv2CenterName() {
    if (typeof window.staffCenterDisplayName === 'function') {
      const name = window.staffCenterDisplayName();
      if (name && name !== 'Centre actuel') return name;
    }
    return '';
  }

  function pv2VarContext(draft) {
    const name = String(draft && draft.name || '').trim();
    return {
      prenom: name.split(/\s+/)[0] || '',
      nom: name,
      centre: pv2CenterName(),
    };
  }

  function pv2FillVars(text, ctx) {
    const unresolved = [];
    const out = String(text || '').replace(/\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/gi, (match, key) => {
      const value = ctx[key.toLowerCase()];
      if (value) return value;
      unresolved.push(key.toLowerCase());
      return match;
    });
    return { text: out, unresolved: [...new Set(unresolved)] };
  }

  function pv2DraftUnresolved(draft) {
    const ctx = pv2VarContext(draft);
    return pv2FillVars(`${draft.subject || ''}\n${draft.body || ''}`, ctx).unresolved;
  }

  const pv2Mail = {
    composerOpen: false, pickerOpen: false, busy: false, aiBusy: false, aiTips: [],
    draft: { to: '', name: '', subject: '', body: '', identityId: '', templateRef: '', replyTo: null },
    identities: [], templates: [], channel: {}, metaLoaded: false, metaLoading: false,
    analyzeOpen: false, analyzeBusy: false, analyzeDraft: { from: '', body: '' },
    replyDraft: {}, replyBusy: '', analysisOverride: {}, retryingId: '',
    // MA prise de main en cours : le mail sur lequel j ecris, et le battement
    // qui la maintient vivante. Une seule a la fois : on ne repond pas a deux
    // mails simultanement, et une prise oubliee sur un mail qu on a quitte
    // bloquerait un collegue pour rien.
    prise: { communicationId: 0, battement: 0 },
    // Les citations depliees, par mail. Repliees par defaut : c est tout
    // l interet, et celui qui veut relire le fil le demande.
    historiqueOuvert: {},
    // La section d apprentissage : les reponses en cours de frappe, et si la
    // memoire deja constituee est depliee.
    reponsesApprises: {},
    apprentissageBusy: '',
    memoireOuverte: true,
    // La question du moment, ce que le dernier apprentissage a change, la
    // recherche dans la memoire, le fait en cours de correction, le fait
    // appris d office.
    savoirCle: '',
    dernierApprentissage: null,
    memoireFiltre: '',
    faitEnEdition: '',
    nouveauFait: { question: '' },
    nouveauOuvert: false,
    listeOuverte: true,
  };
  window.pv2Mail = pv2Mail;

  async function loadPv2MailMeta(force = false) {
    if (pv2Mail.metaLoading || (pv2Mail.metaLoaded && !force)) return;
    pv2Mail.metaLoading = true;
    try {
      const payload = await apiRequest(`/api/ops?action=emailStudio&centerId=${encodeURIComponent(state.adminCenterId || 'libramont')}`);
      pv2Mail.identities = payload.identities || [];
      pv2Mail.templates = payload.templates || [];
      pv2Mail.channel = payload.channel || {};
      const def = pv2Mail.identities.find((i) => i.isDefault) || pv2Mail.identities[0];
      if (def && !pv2Mail.draft.identityId) pv2Mail.draft.identityId = String(def.id);
      pv2Mail.metaLoaded = true;
    } catch (error) {
      // Une erreur de métadonnées ne doit jamais déclencher un cycle
      // render → retry → render : le composeur reste utilisable avec ses
      // valeurs de repli jusqu'au prochain rafraîchissement explicite.
      pv2Mail.metaLoaded = true;
    } finally {
      pv2Mail.metaLoading = false;
      renderStaffEmailsPage();
      if (pv2Mail.composerOpen) pv2RenderComposer();
    }
  }

  /* ── LE COMPOSEUR VIT DANS UNE SURCOUCHE, PAS DANS LA PAGE ───────────────
     Bug prod du 2026-08-06 : la page se re-rend au poll, et tout menu OUVERT
     du composeur (le select natif « Modèle », la liste de clients) était
     détruit au bout d'une seconde : « ça m'affiche tout puis ça part ».
     Le composeur est donc monté dans document.body (même doctrine que la
     modale tarifs) : les reconstructions innerHTML de la page ne le touchent
     JAMAIS. Il n'est re-rendu que par ses propres actions. */
  function pv2OverlayHost() {
    let host = document.getElementById('pv2MailOverlay');
    if (!host) {
      host = document.createElement('div');
      host.id = 'pv2MailOverlay';
      host.className = 'pv2-mail-overlay hidden';
      document.body.appendChild(host);
      host.addEventListener('mousedown', (event) => { if (event.target === host) pv2CloseComposer(); });
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && pv2Mail.composerOpen) { pv2CloseComposer(); event.stopPropagation(); }
      }, true);
    }
    return host;
  }

  let pv2OverlayWasOpen = false;
  window.pv2RenderComposer = function () {
    const host = pv2OverlayHost();
    if (!pv2Mail.composerOpen) {
      host.classList.add('hidden');
      host.innerHTML = '';
      pv2OverlayWasOpen = false;
      document.documentElement.classList.remove('pv2-lock');
      return;
    }
    host.classList.remove('hidden');
    // La page derrière est VERROUILLÉE : dans la vidéo du proprio, la molette
    // faisait défiler la page sous la surcouche et tout semblait partir en
    // morceaux. Une surcouche ouverte fige le fond.
    document.documentElement.classList.add('pv2-lock');
    host.innerHTML = pv2ComposerPanel();
    pv2TokeditAdoptAll(host);
    emIaVerrouiller();
    // Entrée animée UNE fois, à l'ouverture réelle : un re-rendu interne
    // (choix de modèle, bascule d'envoi) ne rejoue rien.
    const card = host.firstElementChild;
    if (card && !pv2OverlayWasOpen && !reducedMotion) card.classList.add('pv2-mount');
    pv2OverlayWasOpen = true;
    pv2ComposerSyncHints();
    if (pv2Combo.open) pv2ComboPaint();
  };

  // API globale : la fiche client (et tout autre module) ouvre le composer
  // prérempli : remplace le détour console direction / mailto.
  window.pv2OpenComposer = function (prefill = {}) {
    delete EM_IA.message;
    if (typeof peutGeste === 'function' && !peutGeste('ecrire')) { toast('Votre rôle ne permet pas d’envoyer des mails.'); return; }
    pv2Mail.composerOpen = true;
    pv2Mail.pickerOpen = false;
    pv2Mail.aiTips = [];
    pv2Mail.draft = {
      to: String(prefill.to || ''),
      name: String(prefill.name || ''),
      subject: String(prefill.subject || ''),
      body: String(prefill.body || ''),
      identityId: pv2Mail.draft.identityId || '',
      templateRef: '',
      replyTo: prefill.replyTo || null,
      when: 'now',
      scheduledAt: '',
    };
    if (state.staffMenuPage !== 'emails' && typeof openStaffMenuPage === 'function') {
      openStaffMenuPage('emails');
    }
    if (!pv2Mail.metaLoaded && !pv2Mail.metaLoading) loadPv2MailMeta();
    pv2RenderComposer();
    setTimeout(() => { const el = document.getElementById('pv2ComposerTo'); if (el && !el.value) el.focus(); }, 60);
  };

  window.pv2CloseComposer = function () {
    pv2Mail.composerOpen = false;
    pv2Mail.pickerOpen = false;
    pv2Mail.aiTips = [];
    pv2RenderComposer();
  };

  window.pv2TogglePicker = function () {
    pv2Mail.pickerOpen = !pv2Mail.pickerOpen;
    pv2RenderComposer();
  };

  // Champs édités SANS re-render (pattern crmRelanceField : le render complet
  // détruirait le focus en pleine frappe).
  window.pv2ComposerField = function (field, value) {
    pv2Mail.draft[field] = value;
    if (field === 'to') {
      const rows = typeof getStaffClientRows === 'function' ? getStaffClientRows() : [];
      const match = rows.find((r) => String(r.email || '').toLowerCase() === String(value).trim().toLowerCase());
      // Pas de correspondance = pas de nom : garder celui du client PRÉCÉDENT
      // ferait écrire « Bonjour Marie » à quelqu'un d'autre.
      pv2Mail.draft.name = match ? (match.name || '') : '';
    }
  };

  /* ── SÉLECTEUR DE DESTINATAIRE MAISON ────────────────────────────────────
     Remplace la datalist native qui recevait jusqu'à 200 <option> : liste non
     stylable, mal cadrée, sans recherche par nom ni contexte (symptôme « ça
     bugue à la flèche » rapporté par le propriétaire). Ici : filtrage nom +
     adresse pendant la frappe, 8 lignes maximum affichées (tient à 5000
     clients), navigation clavier complète, et chaque ligne dit ce qui aide à
     choisir : visites et dernière venue. Le menu est géré EN DIRECT dans le
     DOM (jamais de re-rendu de page pendant la frappe : le focus survit). */
  // Tri au choix du gérant : pertinence de la frappe, dernière venue, ou plus
  // gros clients. La recherche couvre le nom, l'adresse ET le téléphone
  // (chiffres seuls : « 0470 » trouve « +32 470 … »).
  const pv2Combo = { open: false, index: -1, matches: [], sort: 'pertinence' };
  const PV2_COMBO_SORTS = [['pertinence', 'Pertinence'], ['recents', 'Récents'], ['valeur', 'Gros clients']];

  function pv2ComboMatches(query) {
    const rows = (typeof getStaffClientRows === 'function' ? getStaffClientRows() : []).filter((r) => r.email);
    const q = String(query || '').trim().toLowerCase();
    const qDigits = q.replace(/\D/g, '');
    let list;
    if (!q) {
      list = rows.slice();
    } else {
      const starts = [];
      const contains = [];
      for (const r of rows) {
        const name = String(r.name || '').toLowerCase();
        const email = String(r.email || '').toLowerCase();
        const phone = String(r.phone || '').replace(/\D/g, '');
        if (name.startsWith(q) || email.startsWith(q) || (qDigits.length >= 3 && phone.startsWith(qDigits))) starts.push(r);
        else if (name.includes(q) || email.includes(q) || (qDigits.length >= 3 && phone.includes(qDigits))) contains.push(r);
      }
      list = [...starts, ...contains];
    }
    if (pv2Combo.sort === 'recents') {
      list = list.slice().sort((a, b) => String(b.lastVisit || '').localeCompare(String(a.lastVisit || '')));
    } else if (pv2Combo.sort === 'valeur') {
      list = list.slice().sort((a, b) => (Number(b.spent) || 0) - (Number(a.spent) || 0));
    }
    return list.slice(0, 8);
  }

  window.pv2ComboSort = function (key) {
    pv2Combo.sort = PV2_COMBO_SORTS.some(([k]) => k === key) ? key : 'pertinence';
    const input = document.getElementById('pv2ComposerTo');
    pv2Combo.matches = pv2ComboMatches(input ? input.value : pv2Mail.draft.to);
    pv2Combo.index = -1;
    pv2ComboPaint();
    if (input) input.focus();
  };

  function pv2ComboList() { return document.getElementById('pv2ComboList'); }

  function pv2ComboPaint() {
    const list = pv2ComboList();
    const input = document.getElementById('pv2ComposerTo');
    if (!list || !input) return;
    if (!pv2Combo.open || !pv2Combo.matches.length) {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      return;
    }
    const sortRow = `<div class="pv2-combo-sort" role="group" aria-label="Trier les clients">
      ${PV2_COMBO_SORTS.map(([key, label]) => `<button type="button" class="pv2-combo-sort-btn${pv2Combo.sort === key ? ' is-active' : ''}" onmousedown="event.preventDefault(); pv2ComboSort('${key}');">${esc(label)}</button>`).join('')}
    </div>`;
    list.innerHTML = sortRow + pv2Combo.matches.map((r, i) => {
      const meta = [];
      const visits = Number(r.reservations) || 0;
      if (visits) meta.push(`${visits} visite${visits > 1 ? 's' : ''}`);
      if (Number(r.spent) > 0) meta.push(money(r.spent));
      if (r.lastVisitAgo) meta.push(r.lastVisitAgo);
      return `<button type="button" role="option" id="pv2ComboOpt${i}" class="pv2-combo-opt${i === pv2Combo.index ? ' is-active' : ''}" aria-selected="${i === pv2Combo.index}"
        onmousedown="event.preventDefault(); pv2ComboPick(${i});">
        <span class="pv2-combo-id"><strong>${esc(r.name || r.email)}</strong><small>${esc(r.email)}${r.phone ? ` · ${esc(r.phone)}` : ''}</small></span>
        ${meta.length ? `<span class="pv2-combo-meta">${esc(meta.join(' · '))}</span>` : ''}
      </button>`;
    }).join('');
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-activedescendant', pv2Combo.index >= 0 ? `pv2ComboOpt${pv2Combo.index}` : '');
  }

  window.pv2ComboInput = function (value) {
    pv2ComposerField('to', value);
    pv2Combo.open = true;
    pv2Combo.index = -1;
    pv2Combo.matches = pv2ComboMatches(value);
    pv2ComboPaint();
    pv2ComposerSyncHints();
  };

  window.pv2ComboFocus = function () {
    pv2Combo.open = true;
    pv2Combo.matches = pv2ComboMatches(pv2Mail.draft.to);
    pv2ComboPaint();
  };

  window.pv2ComboBlur = function () {
    // Le mousedown d'une option prévient le blur : ce délai ne sert que la
    // sortie réelle du champ (Tab, clic ailleurs). Et un blur peut venir de la
    // DESTRUCTION du champ par un re-rendu : si le focus a été restauré sur le
    // champ neuf entre-temps, on ne ferme pas : le gérant est toujours dedans.
    setTimeout(() => {
      const input = document.getElementById('pv2ComposerTo');
      if (input && document.activeElement === input) return;
      pv2Combo.open = false;
      pv2ComboPaint();
    }, 120);
  };

  window.pv2ComboKey = function (event) {
    if (!pv2Combo.open || !pv2Combo.matches.length) {
      if (event.key === 'ArrowDown') { pv2ComboFocus(); event.preventDefault(); }
      return;
    }
    if (event.key === 'ArrowDown') { pv2Combo.index = Math.min(pv2Combo.index + 1, pv2Combo.matches.length - 1); pv2ComboPaint(); event.preventDefault(); }
    else if (event.key === 'ArrowUp') { pv2Combo.index = Math.max(pv2Combo.index - 1, -1); pv2ComboPaint(); event.preventDefault(); }
    else if (event.key === 'Enter') { if (pv2Combo.index >= 0) { pv2ComboPick(pv2Combo.index); event.preventDefault(); } }
    else if (event.key === 'Escape') { pv2Combo.open = false; pv2ComboPaint(); }
  };

  window.pv2ComboPick = function (index) {
    const row = pv2Combo.matches[index];
    if (!row) return;
    pv2Mail.draft.to = row.email;
    pv2Mail.draft.name = row.name || '';
    pv2Combo.open = false;
    const input = document.getElementById('pv2ComposerTo');
    if (input) { input.value = row.email; input.focus(); }
    pv2ComboPaint();
    pv2ComposerSyncHints();
  };

  /* ── BARRE D'OUTILS + APERÇU EN DIRECT ───────────────────────────────────
     Le corps reste un textarea (fiabilité, sélection native, mobile) ; la mise
     en forme passe par quatre marqueurs que le SERVEUR convertit en HTML
     robuste (textToHtml, lib/ops-communications.js) : **gras**, _italique_,
     « - » en début de ligne pour une liste, [texte](https://lien), et
     [[bouton: Libellé | https://lien]] pour le bouton d'action. L'aperçu sous
     le champ rend la MÊME grammaire, variables résolues, et surligne ce qui
     reste à compléter. */
  function pv2ApplyMarker(kind) {
    const ta = document.getElementById('pv2ComposerBody');
    if (!ta) return;
    const start = ta.selectionStart || 0;
    const end = ta.selectionEnd || 0;
    const value = ta.value;
    const selected = value.slice(start, end);
    let insert = '';
    let cursorFrom = start;
    let cursorTo = end;
    if (kind === 'bold') { insert = `**${selected || 'texte en gras'}**`; cursorFrom = start + 2; cursorTo = cursorFrom + (selected || 'texte en gras').length; }
    else if (kind === 'italic') { insert = `_${selected || 'texte'}_`; cursorFrom = start + 1; cursorTo = cursorFrom + (selected || 'texte').length; }
    else if (kind === 'list') {
      const lines = (selected || 'premier point\ndeuxième point').split('\n');
      insert = lines.map((l) => (l.trim() ? `- ${l.replace(/^- /, '')}` : l)).join('\n');
      cursorFrom = start; cursorTo = start + insert.length;
    } else if (kind === 'link') { const label = selected || 'le lien'; insert = `[${label}](https://)`; cursorFrom = start + label.length + 3; cursorTo = cursorFrom + 8; }
    else if (kind === 'button') { insert = `${selected ? selected + '\n\n' : ''}[[bouton: Réserver en ligne | https://]]`; cursorFrom = start + insert.length - 11; cursorTo = start + insert.length - 2; }
    ta.value = value.slice(0, start) + insert + value.slice(end);
    pv2Mail.draft.body = ta.value;
    ta.focus();
    ta.setSelectionRange(cursorFrom, cursorTo);
    pv2ComposerSyncHints();
  }
  window.pv2ApplyMarker = pv2ApplyMarker;

  /* ── LES VARIABLES SONT DES JETONS, PLUS DES ACCOLADES ───────────────────
     Demande du propriétaire (2026-08-06) : « des trucs comme {{prenom}} on ne
     doit pas les voir, ça doit s'afficher de manière stylée ». Partout où un
     texte est RENDU, une variable devient un jeton :
       . résolue -> la vraie valeur, soulignée d'un liseré discret ;
       . connue mais pas encore résolue (pas de client choisi) -> jeton bleu
         nommé (« Prénom ») ;
       . trou à compléter ({{offre}}…) -> jeton ambre « à compléter », qui
         bloque toujours l'envoi.
     Dans la ZONE DE FRAPPE, le texte reste la source de vérité : un miroir
     colle un halo lumineux sous chaque variable, aux mêmes métriques. */
  function pv2VarToken(key, ctx) {
    const k = String(key).toLowerCase();
    const value = ctx ? ctx[k] : '';
    if (value) return `<span class="pl-var is-ok">${esc(value)}</span>`;
    if (PV2_VAR_LABELS[k]) return `<span class="pl-var">${esc(PV2_VAR_LABELS[k])}</span>`;
    return `<mark class="pv2-var-missing pl-var is-fill">${esc(k)} · à compléter</mark>`;
  }

  // Miroir CLIENT de la grammaire serveur, pour l'aperçu seulement. Tout est
  // échappé d'abord ; les variables deviennent des jetons.
  function pv2RenderEmailPreview(text, ctx) {
    const esc2 = esc;
    const lines = String(text || '').split('\n');
    const blocks = [];
    let bullets = [];
    const inline = (rawLine) => {
      let s = esc2(rawLine);
      s = s.replace(/\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/gi, (m, key) => pv2VarToken(key, ctx));
      s = s.replace(/\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]{0,500})\)/g, '<a>$1</a>');
      s = s.replace(/\*\*([^*\n]{1,300}?)\*\*/g, '<strong>$1</strong>');
      s = s.replace(/(^|[^\w&])_([^_\n]{1,300}?)_(?=$|[^\w])/g, '$1<em>$2</em>');
      return s;
    };
    const flush = () => {
      if (!bullets.length) return;
      blocks.push(`<ul>${bullets.map((b) => `<li>${b}</li>`).join('')}</ul>`);
      bullets = [];
    };
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) { flush(); continue; }
      const btn = line.match(/^\[\[bouton\s*:\s*([^|\]]{1,80})\|\s*(\S{0,500})\s*\]\]$/i);
      if (btn) { flush(); blocks.push(`<span class="pv2-preview-btn">${inline(btn[1].trim())}</span>`); continue; }
      if (/^- /.test(line)) { bullets.push(inline(line.slice(2))); continue; }
      flush();
      blocks.push(`<p>${inline(line)}</p>`);
    }
    flush();
    return blocks.join('');
  }

  // Rafraîchit aperçu + rappel de variables SANS re-rendre le panneau (le
  // rendu complet tuerait le focus en pleine frappe). La zone d'écriture,
  // elle, porte déjà ses jetons : c'est un éditeur à jetons, pas un textarea.
  function pv2ComposerSyncHints() {
    const d = pv2Mail.draft;
    const ctx = pv2VarContext(d);
    // L'aperçu est UN MAIL : objet en tête, expéditeur et destinataire, puis
    // le papier clair (les mails partent toujours sur fond clair).
    const subjectEl = document.getElementById('pv2PreviewSubject');
    if (subjectEl) subjectEl.innerHTML = pv2RenderEmailPreview(d.subject, ctx).replace(/^<p>|<\/p>$/g, '') || '<span class="pv2-preview-empty">Objet du message</span>';
    const metaEl = document.getElementById('pv2PreviewMeta');
    if (metaEl) {
      const identity = pv2Mail.identities.find((i) => String(i.id) === String(d.identityId)) || pv2Mail.identities[0] || null;
      const from = identity ? `${identity.label || identity.email} <${identity.email}>` : 'expéditeur par défaut';
      const to = d.to ? `${d.name ? `${d.name} ` : ''}<${d.to}>` : 'choisissez un client';
      metaEl.innerHTML = `<span><b>De</b> ${esc(from)}</span><span><b>À</b> ${esc(to)}</span>`;
    }
    const preview = document.getElementById('pv2ComposerPreview');
    if (preview) preview.innerHTML = pv2RenderEmailPreview(d.body, ctx) || '<p class="pv2-preview-empty">L\'aperçu du message s\'affiche ici pendant que vous écrivez.</p>';
    const hint = document.getElementById('pv2ComposerVarsHint');
    if (hint) {
      const unresolved = pv2DraftUnresolved(d);
      if (unresolved.length) {
        const missName = !d.name && unresolved.some((k) => k === 'prenom' || k === 'nom');
        hint.innerHTML = `À compléter avant l'envoi : ${unresolved.map((k) => `<code>{{${esc(k)}}}</code>`).join(' ')}${missName ? ' <span>(choisissez un client pour remplir le prénom)</span>' : ''}`;
        hint.hidden = false;
      } else {
        hint.hidden = true;
      }
    }
  }
  window.pv2ComposerSyncHints = pv2ComposerSyncHints;

  window.pv2ComposerServerPreview = async function () {
    const d = pv2Mail.draft;
    const ctx = pv2VarContext(d);
    try {
      const payload = await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({
          action: 'directEmailPreview',
          centerId: state.adminCenterId || 'libramont',
          subject: pv2FillVars(d.subject, ctx).text,
          body: pv2FillVars(d.body, ctx).text,
        }),
      });
      previewOpsEmailHtml(payload.html || '', payload.subject || 'Aperçu du mail');
    } catch (error) {
      toast(error.message || 'Aperçu indisponible.');
    }
  };

  // Le mail TEL QU'ENVOYÉ : la colonne body de la communication porte le HTML
  // exact parti chez le client (emailShell compris). Aucune reconstruction :
  // on montre ce qui est stocké, dans l'iframe sandboxée.
  window.pv2ViewStoredMail = function (uid) {
    const row = getStaffEmailRows().find((r) => r.uid === uid);
    if (!row || !row.body) { toast('Le contenu complet de ce mail n\'est pas disponible.'); return; }
    previewOpsEmailHtml(row.body, row.subject || 'Mail envoyé');
  };

  window.pv2ComposerTemplate = function (ref) {
    pv2Mail.draft.templateRef = ref;
    // Les variables RÉSOLUBLES (prénom, nom, centre) se remplissent dès le
    // choix du modèle : le gérant voit le vrai texte. Les trous volontaires
    // ({{offre}}, {{geste}}…) RESTENT visibles et bloquent l'envoi tant qu'ils
    // ne sont pas remplis : c'est le moteur unique pv2FillVars qui décide.
    const ctx = pv2VarContext(pv2Mail.draft);
    const fill = (text) => pv2FillVars(text, ctx).text;
    if (ref.startsWith('starter:')) {
      const starter = PV2_STARTERS.find((s) => s.key === ref.slice(8));
      if (starter) { pv2Mail.draft.subject = fill(starter.subject); pv2Mail.draft.body = fill(starter.body); }
    } else if (ref.startsWith('tpl:')) {
      const tpl = pv2Mail.templates.find((t) => String(t.id) === ref.slice(4));
      if (tpl) { pv2Mail.draft.subject = fill(tpl.subject || ''); pv2Mail.draft.body = fill(tpl.body || ''); }
    }
    pv2Mail.pickerOpen = false;
    pv2RenderComposer();
  };

  // Un modèle fourni qui plaît devient un modèle À SOI : préremplit l'éditeur
  // de la bibliothèque (Réglages → Modèles) avec le brouillon courant.
  window.pv2ComposerSaveAsTemplate = function () {
    if (typeof canUseStaffPermission === 'function' && !canUseStaffPermission('campaigns.manage')) { toast('Votre rôle ne permet pas de créer un modèle.'); return; }
    const d = pv2Mail.draft;
    if (!String(d.subject || '').trim() && !String(d.body || '').trim()) { toast('Rien à enregistrer, le message est vide.'); return; }
    pv2Settings.open = true;
    pv2Settings.view = 'templates';
    const ref = String(d.templateRef || '');
    const starter = ref.startsWith('starter:') ? PV2_STARTERS.find((s) => s.key === ref.slice(8)) : null;
    pv2Settings.tplEditing = { id: null, name: starter ? `${starter.name} (ma version)` : '', category: 'marketing', subject: d.subject, body: d.body };
    // La bibliothèque vit sur la page : la surcouche se range, l'éditeur de
    // modèle prérempli attend dans Réglages.
    pv2Mail.composerOpen = false;
    pv2RenderComposer();
    pv2ModeleAllerEditer();
    pv2ApercuModele(0);
    toast('Brouillon repris dans Modèles. Donnez-lui un nom et enregistrez.');
  };

  // Une tentative appartient au brouillon et à son contenu réellement envoyé.
  // Une réponse perdue garde la clé ; une édition ou un nouveau brouillon en
  // reçoit une autre. La clé n'est jamais régénérée dans le catch réseau.
  function pv2MessageAttempt(draft, payload, idField = 'attemptId') {
    return window.PinlaneApiClient.withMessageAttempt(draft, payload, idField);
  }

  window.pv2ComposerSend = async function () {
    if (pv2Mail.busy) return;
    if (typeof peutGeste === 'function' && !peutGeste('ecrire')) { toast('Votre rôle ne permet pas d’envoyer des mails.'); return; }
    const d = pv2Mail.draft;
    const to = String(d.to || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) { toast('Adresse email invalide.'); return; }
    if (!d.subject.trim() || !d.body.trim()) { toast('Objet et message obligatoires.'); return; }
    // LA GARDE DES VARIABLES : rien ne part avec une accolade. Les variables
    // résolubles se remplissent ici (dernière valeur du destinataire incluse),
    // le reste BLOQUE l'envoi et se montre sous le champ.
    const ctx = pv2VarContext(d);
    const filledSubject = pv2FillVars(d.subject, ctx);
    const filledBody = pv2FillVars(d.body, ctx);
    const unresolved = [...new Set([...filledSubject.unresolved, ...filledBody.unresolved])];
    if (unresolved.length) {
      pv2ComposerSyncHints();
      toast(`Complétez d'abord : ${unresolved.map((k) => `{{${k}}}`).join(' · ')}`);
      return;
    }
    let scheduledAt = null;
    if (d.when === 'later') {
      if (!d.scheduledAt) { toast('Choisissez la date et l\'heure d\'envoi.'); return; }
      const requested = new Date(d.scheduledAt);
      if (Number.isNaN(requested.getTime()) || requested.getTime() < Date.now() + 2 * 60000) {
        toast('La date d\'envoi doit être dans le futur.');
        return;
      }
      scheduledAt = requested.toISOString();
    }
    pv2Mail.busy = true;
    pv2RenderComposer();
    try {
      await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify(pv2MessageAttempt(d, {
          action: 'sendDirectEmail',
          centerId: state.adminCenterId || 'libramont',
          to,
          name: d.name || '',
          subject: filledSubject.text,
          body: filledBody.text,
          identityId: d.identityId || null,
          templateRef: d.templateRef || '',
          replyToCommunicationId: d.replyTo || null,
          scheduledAt,
        })),
      });
      pv2Mail.composerOpen = false;
      pv2Mail.draft = { to: '', name: '', subject: '', body: '', identityId: pv2Mail.draft.identityId, templateRef: '', replyTo: null, when: 'now', scheduledAt: '' };
      pv2Mail.aiTips = [];
      toast(scheduledAt ? 'Message programmé ✓ : il partira au moment choisi.' : 'Message en file d\'envoi ✓');
      if (typeof requestOpsAdminLoad === 'function') requestOpsAdminLoad(true);
    } catch (error) {
      toast(error.message || 'Envoi impossible.');
    } finally {
      pv2Mail.busy = false;
      pv2RenderComposer();
    }
  };

  /* ── « Analyser un reçu » : le staff colle un mail, l'agent le classe et
     propose la réponse : le chemin sans configuration MX. ── */
  window.pv2OpenAnalyze = function () {
    pv2Mail.analyzeOpen = !pv2Mail.analyzeOpen;
    renderStaffEmailsPage();
    setTimeout(() => { const el = document.getElementById('pv2AnalyzeFrom'); if (el) el.focus(); }, 60);
  };

  window.pv2AnalyzeField = function (field, value) {
    pv2Mail.analyzeDraft[field] = value;
  };

  window.pv2AnalyzeSubmit = async function () {
    if (pv2Mail.analyzeBusy) return;
    const from = String(pv2Mail.analyzeDraft.from || '').trim();
    const body = String(pv2Mail.analyzeDraft.body || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from)) { toast('Adresse de l\'expéditeur invalide.'); return; }
    if (!body) { toast('Collez le texte du mail reçu.'); return; }
    pv2Mail.analyzeBusy = true;
    renderStaffEmailsPage();
    try {
      await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify(pv2MessageAttempt(pv2Mail.analyzeDraft, { action: 'analyzeInboundEmail', centerId: state.adminCenterId || 'libramont', from, body, store: true }, 'requestId')),
      });
      pv2Mail.analyzeOpen = false;
      pv2Mail.analyzeDraft = { from: '', body: '' };
      state.staffEmailsSection = 'recus';
      save();
      if (typeof pv2ThreadsInvalider === 'function') pv2ThreadsInvalider();
      toast('Mail analysé : il est dans les Reçus avec sa réponse proposée.');
      if (typeof requestOpsAdminLoad === 'function') requestOpsAdminLoad(true);
    } catch (error) {
      toast(error.message || 'Analyse impossible.');
    } finally {
      pv2Mail.analyzeBusy = false;
      renderStaffEmailsPage();
    }
  };

  /* ── QUI EST EN TRAIN DE REPONDRE ────────────────────────────────────────
     Deux personnes peuvent ouvrir la meme boite. Sans ce signal, chacune ecrit
     sa reponse sans savoir que l autre ecrit la sienne, et le client en recoit
     deux. La synchronisation vivante ne suffit pas : elle montre une reponse
     une fois PARTIE, pas pendant qu on la redige.

     La prise se pose au PREMIER CARACTERE tape, pas a l ouverture du mail :
     lire un message n est pas y repondre, et prendre la main en lisant
     bloquerait des collegues pour rien. Elle se rafraichit tant qu on ecrit,
     et elle expire toute seule si l onglet se ferme. ─────────────────────── */
  const PV2_BATTEMENT_MS = 60000;

  function pv2MonIdentifiant() {
    return typeof getStaffSessionMemberId === 'function' ? String(getStaffSessionMemberId() || '') : '';
  }

  // La prise VIVANTE posee sur ce mail, quelle qu en soit la personne.
  function pv2PriseSur(row) {
    const id = Number(row && row.id);
    if (!Number.isInteger(id) || id <= 0) return null;
    const liste = (typeof opsAdminCache === 'object' && opsAdminCache && opsAdminCache.claims) || [];
    const trouvee = liste.find((c) => Number(c.communicationId) === id);
    if (!trouvee) return null;
    // Le serveur ne renvoie que les prises vivantes, mais la page peut afficher
    // une reponse vieille de plusieurs minutes : on revalide sur l heure locale
    // plutot que de montrer « Untel repond » a partir d une donnee perimee.
    if (trouvee.expiresAt && new Date(trouvee.expiresAt).getTime() < Date.now()) return null;
    return trouvee;
  }

  // La prise de QUELQU UN D AUTRE, la seule qui doit alerter.
  function pv2PriseDunAutre(row) {
    const prise = pv2PriseSur(row);
    if (!prise) return null;
    const moi = pv2MonIdentifiant();
    if (moi && String(prise.memberId) === moi) return null;
    return prise;
  }

  async function pv2PrendreLaMain(communicationId) {
    const id = Number(communicationId);
    if (!Number.isInteger(id) || id <= 0) return;
    if (pv2Mail.prise.communicationId === id) return; // deja la mienne
    await pv2RelacherLaMain();
    pv2Mail.prise.communicationId = id;
    const battre = async () => {
      if (pv2Mail.prise.communicationId !== id) return;
      try {
        await apiRequest('/api/ops', {
          method: 'POST',
          body: JSON.stringify({
            action: 'claimInboundEmail',
            centerId: state.adminCenterId || 'libramont',
            communicationId: id,
          }),
        });
      } catch (error) {
        // Une prise ratee ne bloque JAMAIS la redaction : elle est un confort
        // pour les collegues, pas une autorisation d ecrire.
      }
    };
    await battre();
    pv2Mail.prise.battement = setInterval(battre, PV2_BATTEMENT_MS);
  }

  async function pv2RelacherLaMain() {
    const id = pv2Mail.prise.communicationId;
    if (pv2Mail.prise.battement) { clearInterval(pv2Mail.prise.battement); pv2Mail.prise.battement = 0; }
    pv2Mail.prise.communicationId = 0;
    if (!id) return;
    try {
      await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({
          action: 'releaseInboundEmail',
          centerId: state.adminCenterId || 'libramont',
          communicationId: id,
        }),
      });
    } catch (error) {
      // Rien a faire : la prise expirera d elle-meme.
    }
  }

  /* ── LA REPONSE DANS LE FIL (2026-09-16) ─────────────────────────────────
     Le brouillon de reponse est indexe par CONVERSATION, plus par mail : une
     conversation n a qu une reponse en cours, et elle suit le fil quand un
     nouveau message du client arrive. Les noms pv2InboxReplyField /
     pv2InboxReply sont conserves (gates, fiche client) ; la reference acceptee
     est l id du fil, ou l id d un message de ce fil (les appels historiques
     passaient l identifiant du mail recu). ── */
  function pv2ThreadRefResoudre(ref) {
    const cle = String(ref || '');
    if (!cle) return String(pv2Threads.selectedId || '');
    if (cle === String(pv2Threads.selectedId)) return cle;
    const d = pv2Threads.detail;
    if (d.thread && (d.messages || []).some((m) => String(m.id) === cle)) return String(d.thread.id);
    const fil = pv2Threads.threads.find((t) => String(t.id) === cle || String(t.lastInboundId) === cle);
    return fil ? String(fil.id) : cle;
  }

  function pv2ThreadDernierEntrant(messages) {
    return [...(messages || [])].reverse().find((m) => m.direction === 'inbound') || null;
  }

  // Le brouillon d une conversation : objet « Re: », signature selon la portee
  // reglee dans Apparence, signataire = la personne connectee (modifiable :
  // c est elle qui signe, pas le role). LE TEXTE PART DE CE QUE L AGENT
  // PROPOSE (2026-11-11, lot S) : tant que le dernier message est celui du
  // client, la case contient deja sa reponse, a relire et a corriger.
  // iaBody retient ce texte : tant que la case n a pas bouge, une nouvelle
  // lecture de l agent le remplace ; des qu elle est touchee, plus rien ne
  // l ecrase.
  function pv2SignataireTechnique(membre) {
    const nom = String((membre && membre.name) || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
    return nom === 'proprietaire plateforme' || /platform-owner/.test(String((membre && membre.id) || '')) || Boolean(membre && membre.emergency);
  }

  function pv2ThreadPropositionDe(cle) {
    const d = pv2Threads.detail;
    if (!d.thread || String(d.thread.id) !== String(cle)) return '';
    const messages = d.messages || [];
    const dernier = messages[messages.length - 1];
    if (!dernier || dernier.direction !== 'inbound') return '';
    const reply = dernier.analysis && dernier.analysis.reply;
    return reply ? String(reply.body || '') : '';
  }

  function pv2ThreadReplyDraft(threadId) {
    const cle = String(threadId);
    const brouillon = pv2Threads.reply[cle];
    if (brouillon && brouillon.body === brouillon.iaBody) {
      const propose = pv2ThreadPropositionDe(cle);
      if (propose && propose !== brouillon.iaBody) { brouillon.body = propose; brouillon.iaBody = propose; }
    }
    if (!pv2Threads.reply[cle]) {
      const d = pv2Threads.detail;
      const fil = d.thread && String(d.thread.id) === cle ? d.thread : null;
      const entrant = fil ? pv2ThreadDernierEntrant(d.messages) : null;
      const analysis = entrant && entrant.analysis ? entrant.analysis : null;
      const propose = pv2ThreadPropositionDe(cle);
      // UNE REPONSE GARDE L OBJET DE LA CONVERSATION (2026-09-17). L objet
      // propose par l agent la sortait de la conversation chez le client : Gmail
      // regroupe aussi par objet. « Re: » + l objet, sans doubler le « Re: » ;
      // l objet de l agent ne sert que s il n y a aucun objet.
      const objetFil = String((fil && fil.subject) || (entrant && entrant.subject) || '').trim();
      const sujet = objetFil
        ? (/^re\s*:/i.test(objetFil) ? objetFil : `Re: ${objetFil}`)
        : String((analysis && analysis.reply && analysis.reply.subject) || '').trim();
      const session = state.staffAuthSession || {};
      const membre = session.member || {};
      const role = session.role || {};
      const design = pv2Design.design;
      const portee = design && design.signatureScope && typeof design.signatureScope.manual === 'boolean' ? design.signatureScope.manual : true;
      const identite = pv2Mail.identities.find((i) => i.isDefault) || pv2Mail.identities[0] || null;
      pv2Threads.reply[cle] = {
        subject: sujet,
        body: propose,
        iaBody: propose,
        identityId: pv2Mail.draft.identityId || (identite ? String(identite.id) : ''),
        signature: portee,
        // Le compte « Proprietaire plateforme » ne signe pas : champ vide,
        // l equipe du centre signe (meme regle cote serveur).
        signatoryName: pv2SignataireTechnique(membre) ? '' : String(membre.name || ''),
        signatoryRole: pv2SignataireTechnique(membre) ? '' : String(role.name || membre.roleId || ''),
      };
    }
    return pv2Threads.reply[cle];
  }

  window.pv2InboxReplyField = function (ref, field, value) {
    const threadId = pv2ThreadRefResoudre(ref);
    const draft = pv2ThreadReplyDraft(threadId);
    draft[field] = field === 'signature' ? Boolean(value) : value;
    // La case « signature » change l etat des champs signataire : un rendu
    // s impose. Le texte tape, lui, ne re-rend jamais (le focus survit).
    if (field === 'signature') { renderStaffEmailsPage(); return; }
    // Premier caractere tape sur cette conversation : je prends la main sur le
    // dernier message recu. L appel n est pas attendu, la frappe ne doit
    // jamais patienter apres le reseau.
    const entrant = pv2ThreadDernierEntrant(pv2Threads.detail.messages);
    if (entrant && entrant.id) pv2PrendreLaMain(entrant.id);
  };

  window.pv2ThreadUtiliserProposition = function (ref) {
    const threadId = pv2ThreadRefResoudre(ref);
    const entrant = pv2ThreadDernierEntrant(pv2Threads.detail.messages);
    const reply = entrant && entrant.analysis && entrant.analysis.reply;
    if (!reply) { toast('L\'agent n\'a pas de réponse proposée pour cette conversation.'); return; }
    const draft = pv2ThreadReplyDraft(threadId);
    // Seul le texte est repris : l objet reste celui de la conversation
    // (regle du 2026-09-17), celui de l agent ne sert que s il n y en a aucun.
    if (!String(draft.subject || '').trim()) draft.subject = String(reply.subject || '');
    draft.body = String(reply.body || '');
    draft.iaBody = draft.body;
    // Prendre la reponse de l agent, c est commencer a repondre : meme prise
    // de main que la premiere lettre tapee.
    if (entrant && entrant.id) pv2PrendreLaMain(entrant.id);
    renderStaffEmailsPage();
    const champ = document.getElementById('pv2ThreadReplyBody');
    if (champ) {
      champ.focus();
      if (typeof champ.scrollIntoView === 'function') champ.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
    }
  };

  // Le mail FINAL tel qu il partira : meme chemin serveur que l envoi
  // (directEmailPreview avec signature et signataire), dans l iframe sandbox.
  window.pv2ThreadReplyPreview = async function (ref) {
    const threadId = pv2ThreadRefResoudre(ref);
    const draft = pv2ThreadReplyDraft(threadId);
    const contact = pv2Threads.detail.contact || {};
    const ctx = pv2VarContext({ name: contact.name || '' });
    try {
      const payload = await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({
          action: 'directEmailPreview',
          centerId: state.adminCenterId || 'libramont',
          subject: pv2FillVars(draft.subject, ctx).text,
          body: pv2FillVars(draft.body, ctx).text,
          signature: Boolean(draft.signature),
          signatoryName: draft.signature ? draft.signatoryName : '',
          signatoryRole: draft.signature ? draft.signatoryRole : '',
        }),
      });
      previewOpsEmailHtml(payload.html || '', payload.subject || 'Aperçu de la réponse');
    } catch (error) {
      toast(error.message || 'Aperçu indisponible.');
    }
  };

  window.pv2InboxReply = async function (ref) {
    if (pv2Threads.replyBusy) return;
    if (typeof canUseStaffPermission === 'function' && !canUseStaffPermission('emails.send')) { toast('Votre rôle ne permet pas d’envoyer des mails.'); return; }
    const threadId = pv2ThreadRefResoudre(ref);
    const d = pv2Threads.detail;
    if (!d.thread || String(d.thread.id) !== threadId) { toast('Ouvrez d\'abord la conversation.'); return; }
    const contact = d.contact || {};
    const to = String(contact.email || d.thread.contactEmail || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) { toast('Adresse de l\'expéditeur introuvable.'); return; }
    const draft = pv2ThreadReplyDraft(threadId);
    if (!String(draft.subject || '').trim() || !String(draft.body || '').trim()) { toast('Objet et réponse obligatoires.'); return; }
    // Même garde que le composeur : une réponse ne part jamais avec {{…}}.
    const replyCtx = pv2VarContext({ name: contact.name || d.thread.contactName || '' });
    const replyLeft = pv2FillVars(`${draft.subject}\n${draft.body}`, replyCtx).unresolved;
    if (replyLeft.length) { toast(`Complétez d'abord : ${replyLeft.map((k) => `{{${k}}}`).join(' · ')}`); return; }
    const entrant = pv2ThreadDernierEntrant(d.messages);
    // DERNIER RAPPEL AVANT D ENVOYER. Le bandeau a pu apparaitre pendant la
    // redaction : c est ici, au moment ou le mail part, que l information
    // compte le plus. On demande, on n interdit pas.
    const autre = entrant ? pv2PriseDunAutre({ id: entrant.id }) : null;
    if (autre) {
      const nom = String(autre.memberName || autre.memberId || 'Un collègue');
      const roleAutre = String(autre.memberRole || '').trim();
      const passer = typeof confirm === 'function'
        ? confirm(`${nom}${roleAutre ? ` (${roleAutre})` : ''} s'occupe de ce message. Envoyer quand même ? Le client recevrait deux réponses.`)
        : true;
      if (!passer) return;
    }
    pv2Threads.replyBusy = threadId;
    renderStaffEmailsPage();
    try {
      await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify(pv2MessageAttempt(draft, {
          action: 'sendDirectEmail',
          centerId: state.adminCenterId || 'libramont',
          to,
          name: contact.name || d.thread.contactName || '',
          subject: pv2FillVars(draft.subject, replyCtx).text,
          body: pv2FillVars(draft.body, replyCtx).text,
          identityId: draft.identityId || pv2Mail.draft.identityId || null,
          replyToCommunicationId: entrant ? entrant.id : null,
          threadId: d.thread.id,
          signature: Boolean(draft.signature),
          signatoryName: draft.signature ? String(draft.signatoryName || '') : '',
          signatoryRole: draft.signature ? String(draft.signatoryRole || '') : '',
        })),
      });
      toast('Réponse en file d\'envoi ✓ La conversation passe dans Répondus.');
      delete pv2Threads.reply[threadId];
      // La reponse est partie : la prise n a plus de raison d etre, et la
      // garder ferait croire a un collegue que quelqu un ecrit encore.
      pv2RelacherLaMain();
      // LE SUIVI SUIT LA CONVERSATION (2026-09-17) : elle quitte « A repondre »
      // et s affiche dans « Repondus », toujours ouverte. « Tous » ne bouge pas.
      if (pv2Threads.filtre === 'a-repondre') pv2Threads.filtre = 'repondus';
      pv2Threads.selectedId = String(threadId);
      if (pv2Threads.detail.thread && String(pv2Threads.detail.thread.id) === String(threadId)) pv2Threads.detail.thread.status = 'answered';
      pv2Threads.apercu.loaded = false;
      loadPv2ThreadsApercu(true);
      loadPv2Overview(true);
      loadPv2ThreadDetail(threadId, true);
      loadPv2Threads(true);
      if (typeof requestOpsAdminLoad === 'function') requestOpsAdminLoad(true);
    } catch (error) {
      toast(error.message || 'Envoi impossible.');
    } finally {
      pv2Threads.replyBusy = '';
      renderStaffEmailsPage();
    }
  };

  // Re-analyser le dernier message recu de la conversation ouverte : l agent
  // relit le mail avec ce qu il a appris depuis.
  window.pv2InboxReanalyze = async function (ref) {
    if (pv2Threads.replyBusy) return;
    const threadId = pv2ThreadRefResoudre(ref);
    const d = pv2Threads.detail;
    if (!d.thread || String(d.thread.id) !== threadId) return;
    const entrant = pv2ThreadDernierEntrant(d.messages);
    if (!entrant) return;
    pv2Threads.replyBusy = threadId;
    renderStaffEmailsPage();
    try {
      const payload = await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({
          action: 'analyzeInboundEmail',
          centerId: state.adminCenterId || 'libramont',
          from: entrant.fromEmail || (d.contact && d.contact.email) || '',
          subject: entrant.subject || '',
          body: entrant.textBody || entrant.message || '',
        }),
      });
      if (payload.analysis) {
        // Ce que la gerante a deja ecrit reste. Une case encore telle que
        // l agent l avait remplie prend sa nouvelle reponse au rendu suivant
        // (pv2ThreadReplyDraft).
        entrant.analysis = payload.analysis;
        toast('Analyse actualisée.');
      }
    } catch (error) {
      toast(error.message || 'Ré-analyse impossible.');
    } finally {
      pv2Threads.replyBusy = '';
      renderStaffEmailsPage();
    }
  };

  const PV2_INTENT_LABELS = {
    reservation: 'Réservation', annulation: 'Annulation', anniversaire: 'Anniversaire',
    prix: 'Prix', horaires: 'Horaires', reclamation: 'Réclamation',
    hors_sujet: 'Pas une demande client', autre: 'Autre',
  };

  /* ── SÉQUENCES PERSONNALISÉES : le gérant crée SES automatisations
     (déclencheur + cible + message + plafond : contrat customSequences). ── */
  const pv2Seq = { loaded: false, loading: false, sequences: [], limits: null, editId: '', creating: false, draft: {}, busy: false };
  window.pv2Seq = pv2Seq;
  const PV2_WEEKDAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

  async function loadPv2Sequences(force = false) {
    if (pv2Seq.loading || (pv2Seq.loaded && !force)) return;
    pv2Seq.loading = true;
    try {
      const payload = await apiRequest(`/api/ops?action=customSequences&centerId=${encodeURIComponent(state.adminCenterId || 'libramont')}`);
      pv2Seq.sequences = payload.sequences || [];
      pv2Seq.limits = payload.limits || null;
      pv2Seq.loaded = true;
    } catch (error) { /* rôle sans accès : section masquée */ } finally {
      pv2Seq.loading = false;
      renderStaffEmailsPage();
    }
  }
  window.loadPv2Sequences = loadPv2Sequences;

  function pv2SeqTriggerLabel(sequence) {
    const t = sequence.trigger || {};
    if (t.type === 'after_visit') return `${t.days} jour${t.days > 1 ? 's' : ''} après une visite`;
    if (t.type === 'before_visit') return `${t.days} jour${t.days > 1 ? 's' : ''} avant une venue`;
    if (t.type === 'inactive') return `clients plus vus depuis ${t.days} jours`;
    const segments = (pv2Seq.limits && pv2Seq.limits.segments) || {};
    if (t.type === 'weekly') return `chaque ${PV2_WEEKDAYS[t.weekday] || ''} · ${segments[sequence.segment] || 'tous'}`;
    if (t.type === 'monthly') return `le ${Number(t.monthday) || 1} de chaque mois · ${segments[sequence.segment] || 'tous'}`;
    return '';
  }

  // L editeur vit dans la section Sequences : ouvrir une sequence depuis une
  // autre section y conduit d abord, sinon l editeur serait rendu nulle part.
  function pv2SeqAllerEditer() {
    if (state.staffEmailsSection !== 'sequences') pv2EmailsGo('sequences');
    else renderStaffEmailsPage();
  }

  window.pv2SeqNew = function () {
    delete EM_IA.seqperso;
    if (typeof canUseStaffPermission === 'function' && !canUseStaffPermission(['settings.manage', 'emails.send'])) { toast('Votre rôle ne permet pas de modifier les séquences.'); return; }
    pv2Seq.creating = true;
    pv2Seq.editId = '';
    pv2Seq.draft = { name: '', trigger: { type: 'after_visit', days: 7, weekday: 4 }, segment: 'all', subject: '', body: '', cap: 20, enabled: true };
    pv2SeqAllerEditer();
    pv2ApercuSequencePerso(0);
    setTimeout(() => { const el = document.getElementById('pv2SeqName'); if (el) el.focus(); }, 60);
  };

  window.pv2SeqEdit = function (id) {
    delete EM_IA.seqperso;
    if (typeof canUseStaffPermission === 'function' && !canUseStaffPermission(['settings.manage', 'emails.send'])) { toast('Votre rôle ne permet pas de modifier les séquences.'); return; }
    const sequence = pv2Seq.sequences.find((item) => item.id === id);
    if (!sequence) return;
    pv2Seq.creating = false;
    pv2Seq.editId = id;
    pv2Seq.draft = JSON.parse(JSON.stringify(sequence));
    pv2SeqAllerEditer();
    pv2ApercuSequencePerso(0);
  };

  window.pv2SeqCloseEditor = function () {
    pv2Seq.creating = false;
    pv2Seq.editId = '';
    pv2ApercuAnnuler('seq');
    renderStaffEmailsPage();
  };

  window.pv2SeqField = function (field, value) {
    if (field === 'trigger.type') {
      pv2Seq.draft.trigger = { type: value, days: value === 'inactive' ? 90 : 7, weekday: 4, monthday: 1 };
      renderStaffEmailsPage();
      pv2ApercuSequencePerso();
      return;
    }
    if (field === 'trigger.days') { pv2Seq.draft.trigger.days = Number(value); return; }
    if (field === 'trigger.weekday') { pv2Seq.draft.trigger.weekday = Number(value); return; }
    if (field === 'trigger.monthday') { pv2Seq.draft.trigger.monthday = Number(value); return; }
    if (field === 'cap') { pv2Seq.draft.cap = Number(value); return; }
    pv2Seq.draft[field] = value;
    if (field === 'subject' || field === 'body') pv2ApercuSequencePerso();
  };

  // L apercu vivant d une sequence personnalisee : le brouillon tel quel,
  // rendu par le serveur avec un client d exemple. 500 ms apres la derniere
  // frappe, la requete precedente annulee.
  function pv2ApercuSequencePerso(delai = 500) {
    if (!pv2Seq.creating && !pv2Seq.editId) return;
    pv2PlanifierApercu('seq', () => ({
      action: 'customSequencePreview',
      centerId: state.adminCenterId || 'libramont',
      sequence: { ...pv2Seq.draft },
    }), delai);
  }

  // « Voir le mail » sur une carte fermee : la sequence telle qu enregistree,
  // jamais le brouillon d une autre carte reste en memoire.
  window.pv2SeqPreview = async function (id) {
    if (pv2Seq.busy) return;
    const sequence = pv2Seq.editId === id ? pv2Seq.draft : pv2Seq.sequences.find((item) => item.id === id);
    if (!sequence) return;
    pv2Seq.busy = true;
    renderStaffEmailsPage();
    try {
      const payload = await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'customSequencePreview', centerId: state.adminCenterId || 'libramont', sequence }),
      });
      previewOpsEmailHtml(payload.html || '', payload.subject || sequence.subject || 'Aperçu du mail');
    } catch (error) {
      toast(error.message || 'Aperçu impossible.');
    } finally {
      pv2Seq.busy = false;
      renderStaffEmailsPage();
    }
  };

  window.pv2SeqSendTest = async function (id) {
    if (pv2Seq.busy) return;
    if (typeof canUseStaffPermission === 'function' && !canUseStaffPermission('emails.send')) { toast('Votre rôle ne permet pas d’envoyer des mails.'); return; }
    const sequence = pv2Seq.editId === id ? pv2Seq.draft : pv2Seq.sequences.find((item) => item.id === id);
    if (!sequence) return;
    pv2Seq.busy = true;
    renderStaffEmailsPage();
    try {
      // Aucune adresse n est envoyee : le serveur envoie au membre connecte.
      const payload = await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'sendCustomSequenceTest', centerId: state.adminCenterId || 'libramont', sequence }),
      });
      if (payload.status === 'sent') toast(`Test envoyé à ${payload.recipient}`);
      else toast(`Le test n'est pas parti (${payload.error || 'cause inconnue'}).`);
    } catch (error) {
      toast(error.message || 'Envoi de test impossible.');
    } finally {
      pv2Seq.busy = false;
      renderStaffEmailsPage();
    }
  };

  window.pv2SeqSave = async function () {
    if (pv2Seq.busy) return;
    if (typeof canUseStaffPermission === 'function' && !canUseStaffPermission(['settings.manage', 'emails.send'])) { toast('Votre rôle ne permet pas de modifier les séquences.'); return; }
    pv2Seq.busy = true;
    renderStaffEmailsPage();
    try {
      const sequence = { ...pv2Seq.draft };
      if (pv2Seq.editId) sequence.id = pv2Seq.editId;
      const payload = await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'customSequences', centerId: state.adminCenterId || 'libramont', sequence }),
      });
      pv2Seq.sequences = payload.sequences || pv2Seq.sequences;
      pv2Seq.creating = false;
      pv2Seq.editId = '';
      pv2ApercuAnnuler('seq');
      toast('Séquence enregistrée ✓ : elle tourne chaque matin avec les autres.');
    } catch (error) {
      toast(error.message || 'Enregistrement impossible.');
    } finally {
      pv2Seq.busy = false;
      renderStaffEmailsPage();
    }
  };

  window.pv2SeqToggle = async function (id, enabled) {
    if (pv2Seq.busy) return;
    if (typeof canUseStaffPermission === 'function' && !canUseStaffPermission(['settings.manage', 'emails.send'])) { toast('Votre rôle ne permet pas de modifier les séquences.'); return; }
    pv2Seq.busy = true;
    renderStaffEmailsPage();
    try {
      const payload = await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'customSequences', op: 'toggle', id, enabled, centerId: state.adminCenterId || 'libramont' }),
      });
      pv2Seq.sequences = payload.sequences || pv2Seq.sequences;
    } catch (error) {
      toast(error.message || 'Impossible.');
    } finally {
      pv2Seq.busy = false;
      renderStaffEmailsPage();
    }
  };

  window.pv2SeqDelete = async function (id) {
    if (pv2Seq.busy) return;
    if (typeof canUseStaffPermission === 'function' && !canUseStaffPermission(['settings.manage', 'emails.send'])) { toast('Votre rôle ne permet pas de modifier les séquences.'); return; }
    const sequence = pv2Seq.sequences.find((item) => item.id === id);
    if (!sequence) return;
    if (!window.confirm(`Supprimer la séquence « ${sequence.name} » ? Les envois déjà partis restent dans l'historique.`)) return;
    pv2Seq.busy = true;
    renderStaffEmailsPage();
    try {
      const payload = await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'customSequences', op: 'delete', id, centerId: state.adminCenterId || 'libramont' }),
      });
      pv2Seq.sequences = payload.sequences || [];
      pv2Seq.editId = '';
      toast('Séquence supprimée.');
    } catch (error) {
      toast(error.message || 'Suppression impossible.');
    } finally {
      pv2Seq.busy = false;
      renderStaffEmailsPage();
    }
  };

  // La premiere ligne non vide d un corps : ce que le client lira en premier.
  function pv2PremiereLigne(texte) {
    return String(texte || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
  }

  // Un texte de sequence ou de modele avec ses variables en jetons NEUTRES :
  // ici {{date}} n est pas un trou a remplir (le serveur le resout a l envoi,
  // client par client), il ne doit pas s afficher en ambre « a completer »
  // comme dans le composeur, ou la regle est inverse.
  function pv2TexteJetons(texte) {
    return String(texte || '').split(/(\{\{\s*[a-z_][a-z0-9_]*\s*\}\})/gi).map((part) => {
      const m = part.match(/^\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}$/i);
      if (!m) return esc(part);
      const k = m[1].toLowerCase();
      return `<span class="pl-var${PV2_VAR_LABELS_ALL[k] ? '' : ' is-fill'}">${esc(PV2_VAR_LABELS_ALL[k] || k)}</span>`;
    }).join('');
  }

  // Les stats 30 j d une sequence personnalisee viennent de la vue globale
  // (emailOverview.sequences, cle = id). Sans elles, on ne fabrique pas un 0 :
  // la carte dit que les envois ne sont pas encore comptes.
  function pv2SeqStats30j(sequence) {
    const liste = (pv2Overview.data && Array.isArray(pv2Overview.data.sequences)) ? pv2Overview.data.sequences : [];
    return liste.find((s) => s && s.custom && String(s.key) === String(sequence.id)) || null;
  }

  function pv2SeqCard(sequence, cascade) {
    const editing = pv2Seq.editId === sequence.id;
    // customSequences (ecriture) : settings.manage ou emails.send. Sans lui,
    // l etat se lit en texte a la place de l interrupteur.
    const regler = typeof canUseStaffPermission !== 'function' || canUseStaffPermission(['settings.manage', 'emails.send']);
    const stats = pv2SeqStats30j(sequence);
    const NB = '\u00a0';
    const sent30 = stats ? Number(stats.sent30d) || 0 : null;
    const failed30 = stats ? Number(stats.failed30d) || 0 : 0;
    const statsTxt = stats
      ? `${sent30}${NB}envoyé${sent30 > 1 ? 's' : ''}${failed30 ? ` · <span class="mk-auto-fail">${failed30}${NB}échec${failed30 > 1 ? 's' : ''}</span>` : ''} sur 30${NB}jours`
      : `Pas encore de chiffres sur 30${NB}jours`;
    return `<article class="mk-auto pv2-seq-card em-seqrow${sequence.enabled ? ' is-on' : ''}${editing ? ' is-editing' : ''}"${cascade ? emEntree(`sequences:perso:${sequence.id}`, cascade) : ''}>
      <div class="em-seqrow-ligne">
        <div class="mk-auto-head em-seqrow-nom">
          <strong>${esc(sequence.name)}</strong>
          <span class="mk-auto-desc">${esc(emSeqPersoPhrase(sequence))}</span>
        </div>
        <span class="mk-auto-stats">${statsTxt}</span>
        <div class="mk-auto-actions">
          <button type="button" class="em-lien mk-auto-preview" onclick="pv2SeqPreview('${escJs(sequence.id)}')" ${pv2Seq.busy ? 'disabled' : ''}>Voir le mail</button>
          ${regler ? `<button type="button" class="em-lien mk-auto-edit-btn" onclick="${editing ? 'pv2SeqCloseEditor()' : `pv2SeqEdit('${escJs(sequence.id)}')`}" aria-expanded="${editing}">${editing ? 'Fermer' : 'Modifier'}</button>
          ${emMenuPlusHtml(`emSeqPlus${sequence.id}`, `Plus d’actions pour ${sequence.name}`, [emGestePlus('Supprimer', `pv2SeqDelete('${escJs(sequence.id)}')`, { danger: true, inactif: pv2Seq.busy })])}` : ''}
        </div>
        ${regler
          ? `<button type="button" class="mk-switch${sequence.enabled ? ' is-on' : ''}" data-switch-key="seq:${esc(String(sequence.id))}" role="switch" aria-checked="${sequence.enabled}" aria-label="${esc(sequence.name)}" onclick="pv2SeqToggle('${escJs(sequence.id)}', ${sequence.enabled ? 'false' : 'true'})" ${pv2Seq.busy ? 'disabled' : ''}><span></span></button>`
          : `<span class="em-seq-etat">${sequence.enabled ? 'Activée' : 'Désactivée'}</span>`}
      </div>
      ${editing ? pv2SeqEditor() : ''}
    </article>`;
  }

  function pv2SeqEditor() {
    const d = pv2Seq.draft;
    const limits = pv2Seq.limits || { triggers: {}, segments: {} };
    const trigger = d.trigger || { type: 'after_visit' };
    const meta = (limits.triggers && limits.triggers[trigger.type]) || {};
    const triggerOptions = Object.entries(limits.triggers || {})
      .map(([key, t]) => `<option value="${key}"${trigger.type === key ? ' selected' : ''}>${esc(t.label)}</option>`).join('');
    const segmentOptions = Object.entries(limits.segments || {})
      .map(([key, label]) => `<option value="${key}"${d.segment === key ? ' selected' : ''}>${esc(label)}</option>`).join('');
    const daysBounds = meta.days || [1, 90];
    // Deux colonnes : les champs a gauche, le mail VIVANT a droite. La gerante
    // voit ce que la sequence ecrit reellement pendant qu elle l ecrit.
    return `<div class="pv2-seq-editor em-editeur" data-pv2-mount="seqEditor" aria-label="Éditeur de séquence" data-em-ia-editeur="seqperso">
      <div class="pv2-seq-editor-cols">
      <div class="pv2-composer-grid">
        <label class="pv2-composer-field"><span>Nom de la séquence</span>
          <input id="pv2SeqName" data-pl-focus="emails.sequence.nom" value="${esc(d.name || '')}" placeholder="Ex. Relance une semaine après la visite" oninput="pv2SeqField('name', this.value)">
        </label>
        <label class="pv2-composer-field"><span>Quand part-elle ?</span>
          <select onchange="pv2SeqField('trigger.type', this.value)">${triggerOptions}</select>
        </label>
        ${trigger.type === 'weekly' ? `
        <label class="pv2-composer-field"><span>Jour de la semaine</span>
          <select onchange="pv2SeqField('trigger.weekday', this.value)">${PV2_WEEKDAYS.map((label, index) => `<option value="${index}"${Number(trigger.weekday) === index ? ' selected' : ''}>${label}</option>`).join('')}</select>
        </label>
        <label class="pv2-composer-field"><span>À qui</span>
          <select onchange="pv2SeqField('segment', this.value)">${segmentOptions}</select>
        </label>` : trigger.type === 'monthly' ? `
        <label class="pv2-composer-field"><span>Jour du mois</span>
          <select onchange="pv2SeqField('trigger.monthday', this.value)">${Array.from({ length: 28 }, (_, i) => `<option value="${i + 1}"${(Number(trigger.monthday) || 1) === i + 1 ? ' selected' : ''}>le ${i + 1}</option>`).join('')}</select>
        </label>
        <label class="pv2-composer-field"><span>À qui</span>
          <select onchange="pv2SeqField('segment', this.value)">${segmentOptions}</select>
        </label>` : `
        <label class="pv2-composer-field"><span>Combien de jours ?</span>
          <input type="number" min="${daysBounds[0]}" max="${daysBounds[1]}" value="${Number(trigger.days) || daysBounds[0]}" oninput="pv2SeqField('trigger.days', this.value)">
        </label>`}
        <label class="pv2-composer-field"><span>Combien d’envois au plus ?</span>
          <input type="number" min="1" max="100" value="${Number(d.cap) || 20}" oninput="pv2SeqField('cap', this.value)">
        </label>
        <div class="pv2-composer-wide">${emIaBarHtml('seqperso')}</div>
        <div class="pv2-composer-field pv2-composer-wide"><span>L’objet du mail</span>
          ${pv2TokeditHtml({ id: 'pv2SeqSubject', sink: 'seqSubject', value: d.subject || '', single: true, plFocus: 'emails.sequence.objet', placeholder: 'Objet du message automatique' })}
        </div>
        <div class="pv2-composer-field pv2-composer-wide em-champ-message"><span>Le message que reçoit le client</span>
          ${pv2VarBar('pv2SeqBody', meta.variables || ['prenom', 'centre'])}
          ${pv2TokeditHtml({ id: 'pv2SeqBody', sink: 'seqBody', value: d.body || '', plFocus: 'emails.sequence.message', placeholder: 'Bonjour {{prenom}},…' })}
        </div>
      </div>
      ${pv2ApercuVivantHtml('seq', { titre: 'Aperçu avec un client d\'exemple', telephone: true })}
      </div>
      <div class="pv2-composer-actions em-actions">
        <button type="button" class="em-lien" onclick="pv2SeqCloseEditor()">Annuler</button>
        ${pv2Seq.editId ? `<button type="button" class="em-lien" onclick="pv2SeqPreview('${escJs(pv2Seq.editId)}')" ${pv2Seq.busy ? 'disabled' : ''}>Voir le mail en grand</button>
        ${typeof canUseStaffPermission !== 'function' || canUseStaffPermission('emails.send') ? `<button type="button" class="em-lien" onclick="pv2SeqSendTest('${escJs(pv2Seq.editId)}')" ${pv2Seq.busy ? 'disabled' : ''}>M'envoyer un test</button>` : ''}` : ''}
        <span class="pv2-composer-spacer"></span>
        <button type="button" class="pv2-btn primary em-principal" onclick="pv2SeqSave()" ${pv2Seq.busy ? 'disabled' : ''}>${pv2Seq.busy ? 'Enregistrement…' : 'Enregistrer la séquence'}</button>
      </div>
    </div>`;
  }

  /* ── LES ANCIENS « REGLAGES » SONT DEVENUS DES SECTIONS (2026-09-16) ────
     Modeles, Expediteurs et L agent ont chacun leur page. Les deux fonctions
     ci-dessous gardent leur nom : la fiche client et les gates les appellent
     encore avec les vues historiques (templates / identities / agent). ── */
  const pv2Settings = {
    open: false, view: 'templates', busy: false,
    tplEditing: null, idEditing: null,
    brain: { loaded: false, loading: false, overrides: null, defaults: null, draft: null },
  };
  window.pv2Settings = pv2Settings;
  const PV2_SETTINGS_SECTIONS = { templates: 'modeles', identities: 'expediteurs', agent: 'agent' };

  window.pv2OpenSettings = function (view) {
    pv2Settings.open = true;
    if (view && PV2_SETTINGS_SECTIONS[view]) pv2Settings.view = view;
    if (pv2Settings.view === 'agent') loadPv2Brain();
    loadPv2MailMeta();
    pv2EmailsGo(PV2_SETTINGS_SECTIONS[pv2Settings.view] || 'modeles');
  };

  window.pv2SettingsView = function (view) {
    pv2Settings.view = PV2_SETTINGS_SECTIONS[view] ? view : 'templates';
    pv2Settings.tplEditing = null;
    pv2Settings.idEditing = null;
    if (pv2Settings.view === 'agent') loadPv2Brain();
    pv2EmailsGo(PV2_SETTINGS_SECTIONS[pv2Settings.view]);
  };

  async function loadPv2Brain(force = false) {
    const brain = pv2Settings.brain;
    if (brain.loading || (brain.loaded && !force)) return;
    brain.loading = true;
    brain.error = '';
    try {
      const payload = await apiRequest(`/api/ops?action=emailBrain&centerId=${encodeURIComponent(state.adminCenterId || 'libramont')}`);
      brain.overrides = payload.overrides || { faq: {}, signature: '', extra: '' };
      brain.defaults = payload.defaults || { faq: {}, intents: PV2_INTENT_LABELS, signature: '' };
      brain.draft = {
        signature: brain.overrides.signature || '',
        extra: brain.overrides.extra || '',
        faq: Object.fromEntries(Object.keys(brain.defaults.intents || PV2_INTENT_LABELS).map((intent) => [intent, brain.overrides.faq[intent] ? String(brain.overrides.faq[intent].body || '') : ''])),
      };
      brain.loaded = true;
    } catch (error) {
      // UN ECHEC EST UNE REPONSE (2026-09-24). Avant, `loaded` restait faux :
      // le rendu d apres relancait la lecture, qui rechouait, qui relancait le
      // rendu, des centaines de requetes par seconde tant que l onglet restait
      // ouvert (mesure : 369 rendus en 3 s sur une reponse inattendue). Comme
      // l apparence (loadPv2Design) : l erreur se dit, et « Reessayer » relit.
      brain.error = error.message || 'Les textes de l’agent sont indisponibles.';
      brain.loaded = true;
    } finally {
      brain.loading = false;
      renderStaffEmailsPage();
    }
  }
  window.pv2BrainRelire = function () { loadPv2Brain(true); };

  window.pv2BrainField = function (field, intent, value) {
    const draft = pv2Settings.brain.draft;
    if (!draft) return;
    if (field === 'faq') draft.faq[intent] = value;
    else draft[field] = value;
  };

  window.pv2BrainSave = async function () {
    const brain = pv2Settings.brain;
    if (pv2Settings.busy || !brain.draft) return;
    if (typeof canUseStaffPermission === 'function' && !canUseStaffPermission(['settings.manage', 'emails.send'])) { toast('Votre rôle ne permet pas de modifier les textes de l’agent.'); return; }
    pv2Settings.busy = true;
    renderStaffEmailsPage();
    try {
      const faqPatch = {};
      for (const [intent, text] of Object.entries(brain.draft.faq)) {
        const trimmed = String(text || '').trim();
        const existing = brain.overrides.faq[intent];
        if (trimmed) {
          const defaultSubject = brain.defaults.faq[intent]?.subject || '';
          faqPatch[intent] = { subject: existing?.subject || defaultSubject, body: trimmed };
        } else if (existing) {
          faqPatch[intent] = null; // champ vidé = retour au modèle d'origine
        }
      }
      const payload = await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({
          action: 'emailBrain',
          centerId: state.adminCenterId || 'libramont',
          faq: faqPatch,
          signature: brain.draft.signature,
          extra: brain.draft.extra,
        }),
      });
      brain.overrides = payload.overrides || brain.overrides;
      toast('L\'agent a appris vos réglages ✓');
    } catch (error) {
      toast(error.message || 'Enregistrement impossible.');
    } finally {
      pv2Settings.busy = false;
      renderStaffEmailsPage();
    }
  };

  /* Modèles : créer / modifier / archiver (serveur email-studio existant).
     L editeur vit dans la section Modeles, avec un apercu serveur vivant. */
  // MODELES SUR UN ECRAN LARGE (2026-11-11) : la moitie droite n est jamais
  // vide a l arrivee. Le premier modele s ouvre comme si on le touchait (le
  // premier du centre, sinon une copie du premier de Pinlane) : l editeur,
  // l apercu et la barre d aide sont la. Une fois par visite de la section :
  // apres « Annuler », la droite reste vide. Sur un telephone (une colonne,
  // em-main de 900 px ou moins, la requete de conteneur), la liste reste.
  function pv2ModeleOuvrirPremier() {
    if (pv2Settings.tplVu || pv2SectionCourante() !== 'modeles') return;
    if (pv2Settings.tplEditing) { pv2Settings.tplVu = true; return; }
    if (!pv2Mail.metaLoaded) return;
    if (typeof canUseStaffPermission === 'function' && !canUseStaffPermission('campaigns.manage')) return;
    const main = document.querySelector('#staffEmailsPage .em-main');
    if (!main || main.clientWidth <= 900) return;
    pv2Settings.tplVu = true;
    const premier = pv2Mail.templates[0];
    if (premier) pv2TplEdit(premier.id);
    else if (PV2_STARTERS[0]) pv2ModeleCopier(PV2_STARTERS[0].key, { focus: false });
  }

  function pv2ModeleAllerEditer() {
    if (state.staffEmailsSection !== 'modeles') pv2EmailsGo('modeles');
    else renderStaffEmailsPage();
  }

  function pv2ApercuModele(delai = 500) {
    const tpl = pv2Settings.tplEditing;
    if (!tpl) return;
    pv2PlanifierApercu('modele', () => ({
      action: 'directEmailPreview',
      centerId: state.adminCenterId || 'libramont',
      subject: String(tpl.subject || ''),
      body: String(tpl.body || ''),
    }), delai);
  }

  window.pv2TplEdit = function (id) {
    delete EM_IA.modele;
    pv2Settings.tplVue = 'ecrire';
    if (typeof canUseStaffPermission === 'function' && !canUseStaffPermission('campaigns.manage')) { toast('Votre rôle ne permet pas de gérer les modèles.'); return; }
    if (id === null) { pv2Settings.tplEditing = { id: null, name: '', category: 'marketing', subject: '', body: '' }; }
    else {
      const tpl = pv2Mail.templates.find((t) => String(t.id) === String(id));
      if (!tpl) return;
      pv2Settings.tplEditing = { id: tpl.id, name: tpl.label || tpl.name || '', category: tpl.category || 'marketing', subject: tpl.subject || '', body: tpl.body || '' };
    }
    pv2ModeleAllerEditer();
    pv2ApercuModele(0);
  };

  window.pv2TplField = function (field, value) {
    if (!pv2Settings.tplEditing) return;
    pv2Settings.tplEditing[field] = value;
    if (field === 'subject' || field === 'body') pv2ApercuModele();
  };

  window.pv2TplCancel = function () {
    pv2Settings.tplEditing = null;
    pv2ApercuAnnuler('modele');
    renderStaffEmailsPage();
  };

  // Un modele fourni qui plait devient un modele A SOI : l editeur s ouvre
  // prerempli, il ne reste qu a le nommer.
  window.pv2ModeleCopier = function (key, { focus = true } = {}) {
    delete EM_IA.modele;
    pv2Settings.tplVue = 'ecrire';
    if (typeof canUseStaffPermission === 'function' && !canUseStaffPermission('campaigns.manage')) { toast('Votre rôle ne permet pas de gérer les modèles.'); return; }
    const starter = PV2_STARTERS.find((s) => s.key === key);
    if (!starter) return;
    pv2Settings.tplEditing = { id: null, name: `${starter.name} (ma version)`, category: 'marketing', subject: starter.subject, body: starter.body };
    pv2ModeleAllerEditer();
    pv2ApercuModele(0);
    if (focus) setTimeout(() => { const el = document.getElementById('pv2TplName'); if (el) el.focus(); }, 60);
  };

  // « Utiliser » : le composeur s ouvre avec ce texte, le client reste a
  // choisir. Le remplissage des variables est celui du composeur.
  window.pv2ModeleUtiliser = function (ref) {
    pv2OpenComposer({});
    pv2ComposerTemplate(String(ref || ''));
  };

  window.pv2TplSave = async function () {
    const tpl = pv2Settings.tplEditing;
    if (!tpl || pv2Settings.busy) return;
    if (typeof canUseStaffPermission === 'function' && !canUseStaffPermission('campaigns.manage')) { toast('Votre rôle ne permet pas de gérer les modèles.'); return; }
    if (!String(tpl.name || '').trim()) { toast('Donnez un nom au modèle.'); return; }
    pv2Settings.busy = true;
    renderStaffEmailsPage();
    try {
      await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'saveEmailTemplate', centerId: state.adminCenterId || 'libramont', id: tpl.id, name: tpl.name, category: tpl.category, subject: tpl.subject, body: tpl.body }),
      });
      pv2Settings.tplEditing = null;
      pv2ApercuAnnuler('modele');
      toast('Modèle enregistré ✓');
      await loadPv2MailMeta(true);
    } catch (error) {
      toast(error.message || 'Enregistrement impossible.');
    } finally {
      pv2Settings.busy = false;
      renderStaffEmailsPage();
    }
  };

  window.pv2TplArchive = async function (id) {
    if (pv2Settings.busy) return;
    if (typeof canUseStaffPermission === 'function' && !canUseStaffPermission('campaigns.manage')) { toast('Votre rôle ne permet pas de gérer les modèles.'); return; }
    if (!window.confirm('Archiver ce modèle ? Il n\'apparaîtra plus dans le composer.')) return;
    pv2Settings.busy = true;
    renderStaffEmailsPage();
    try {
      await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'archiveEmailTemplate', centerId: state.adminCenterId || 'libramont', id }),
      });
      toast('Modèle archivé.');
      await loadPv2MailMeta(true);
    } catch (error) {
      toast(error.message || 'Archivage impossible.');
    } finally {
      pv2Settings.busy = false;
      renderStaffEmailsPage();
    }
  };

  /* Adresses d'envoi : ajouter / définir par défaut / supprimer. */
  window.pv2IdEdit = function () {
    if (typeof canUseStaffPermission === 'function' && !canUseStaffPermission('settings.manage')) { toast('Votre rôle ne permet pas de gérer les adresses d’envoi.'); return; }
    pv2Settings.idEditing = { label: '', email: '', isDefault: !pv2Mail.identities.length };
    if (state.staffEmailsSection !== 'expediteurs') pv2EmailsGo('expediteurs');
    else renderStaffEmailsPage();
  };

  window.pv2IdField = function (field, value) {
    if (pv2Settings.idEditing) pv2Settings.idEditing[field] = field === 'isDefault' ? Boolean(value) : value;
  };

  window.pv2IdSave = async function () {
    const identity = pv2Settings.idEditing;
    if (!identity || pv2Settings.busy) return;
    if (typeof canUseStaffPermission === 'function' && !canUseStaffPermission('settings.manage')) { toast('Votre rôle ne permet pas de gérer les adresses d’envoi.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(identity.email || '').trim())) { toast('Adresse email invalide.'); return; }
    pv2Settings.busy = true;
    renderStaffEmailsPage();
    try {
      await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'saveEmailIdentity', centerId: state.adminCenterId || 'libramont', label: identity.label || identity.email, email: identity.email, isDefault: identity.isDefault }),
      });
      pv2Settings.idEditing = null;
      toast('Adresse ajoutée ✓');
      await loadPv2MailMeta(true);
    } catch (error) {
      toast(error.message || 'Enregistrement impossible.');
    } finally {
      pv2Settings.busy = false;
      renderStaffEmailsPage();
    }
  };

  window.pv2IdDefault = async function (id) {
    if (pv2Settings.busy) return;
    if (typeof canUseStaffPermission === 'function' && !canUseStaffPermission('settings.manage')) { toast('Votre rôle ne permet pas de gérer les adresses d’envoi.'); return; }
    const identity = pv2Mail.identities.find((i) => String(i.id) === String(id));
    if (!identity) return;
    pv2Settings.busy = true;
    renderStaffEmailsPage();
    try {
      await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'saveEmailIdentity', centerId: state.adminCenterId || 'libramont', id: identity.id, label: identity.label, email: identity.email, isDefault: true }),
      });
      await loadPv2MailMeta(true);
    } catch (error) {
      toast(error.message || 'Impossible.');
    } finally {
      pv2Settings.busy = false;
      renderStaffEmailsPage();
    }
  };

  window.pv2IdDelete = async function (id) {
    if (pv2Settings.busy) return;
    if (typeof canUseStaffPermission === 'function' && !canUseStaffPermission('settings.manage')) { toast('Votre rôle ne permet pas de gérer les adresses d’envoi.'); return; }
    if (!window.confirm('Supprimer cette adresse d\'envoi ?')) return;
    pv2Settings.busy = true;
    renderStaffEmailsPage();
    try {
      await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'deleteEmailIdentity', centerId: state.adminCenterId || 'libramont', id }),
      });
      toast('Adresse supprimée.');
      await loadPv2MailMeta(true);
    } catch (error) {
      toast(error.message || 'Suppression impossible.');
    } finally {
      pv2Settings.busy = false;
      renderStaffEmailsPage();
    }
  };

  const PV2_TPL_CATEGORIES = [['marketing', 'Marketing'], ['promotion', 'Promotion'], ['information', 'Information'], ['serieux', 'Sérieux'], ['relance', 'Relance']];
  const PV2_TPL_CATEGORY_LABELS = Object.fromEntries(PV2_TPL_CATEGORIES);

  /* ── SECTION MODELES : la galerie, puis l editeur avec son apercu ──────── */
  // UNE LIGNE PAR MODELE (2026-11-10) : son nom et son objet, variables en
  // jetons. La ligne ouvre l editeur a droite : le votre se modifie, celui de
  // Pinlane se copie d abord. Utiliser ouvre le nouveau message (emails.send) ;
  // modifier, archiver et copier finissent en saveEmailTemplate ou
  // archiveEmailTemplate (campaigns.manage).
  function pv2ModeleCarte({ ref, name, subject, own, id, key }, actif, cascade) {
    const ecrire = typeof peutGeste !== 'function' || peutGeste('ecrire');
    const gerer = typeof canUseStaffPermission !== 'function' || canUseStaffPermission('campaigns.manage');
    const ouvrir = !gerer ? '' : own ? `pv2TplEdit('${escJs(String(id))}')` : `pv2ModeleCopier('${escJs(key)}')`;
    return `<li class="em-tpl-row${actif ? ' is-selected' : ''}"${actif ? ' aria-current="true"' : ''}${cascade ? emEntree(`modeles:${ref}`, cascade) : ''}>
      <button type="button" class="em-tpl-ouvrir" ${ouvrir ? `onclick="${ouvrir}"` : 'disabled'}>
        <strong class="em-tpl-nom">${esc(name)}${own ? '' : '<span class="em-tpl-origine">Pinlane</span>'}</strong>
        <span class="em-tpl-sujet">${pv2TexteJetons(subject) || '<em>Sans objet</em>'}</span>
      </button>
      <div class="em-tpl-actions">
        ${ecrire ? `<button type="button" class="em-lien" onclick="pv2ModeleUtiliser('${escJs(ref)}')">Utiliser</button>` : ''}
        ${own && gerer ? emMenuPlusHtml(`emTplPlus${id}`, `Plus d’actions pour ${name}`, [emGestePlus('Archiver', `pv2TplArchive('${escJs(String(id))}')`, { danger: true })]) : ''}
      </div>
    </li>`;
  }

  // L ATELIER (2026-11-13, Ansar : « c'est pas très visuel, pas userfriendly du tout »). Le mail s ecrit sur une
  // feuille qui ressemble a ce que le client lit (l expediteur, l objet, le texte, la place de la signature), et
  // « Voir le mail envoyé » montre le vrai rendu du serveur, gabarit et signature compris. L assistant est a cote,
  // en conversation, pas dans une barre au-dessus du texte.
  function pv2ModeleEditeur() {
    const tpl = pv2Settings.tplEditing;
    const vue = pv2Settings.tplVue === 'apercu' ? 'apercu' : 'ecrire';
    const centre = (typeof pv2CenterName === 'function' ? pv2CenterName() : '') || 'Votre centre';
    const categorie = (PV2_TPL_CATEGORY_LABELS[tpl.category] || PV2_TPL_CATEGORIES[0][1]).toLowerCase();
    const feuille = vue === 'apercu'
      ? pv2ApercuVivantHtml('modele', { titre: 'Le mail tel que vos clients le reçoivent, variables laissées en clair', classe: 'em-papier-apercu' })
      : `<div class="em-papier-feuille">
          <p class="em-papier-de"><span>De</span><strong>${esc(centre)}</strong></p>
          <div class="em-papier-objet"><span class="em-papier-etiquette" id="emTplObjetTitre">Objet</span>${pv2TokeditHtml({ id: 'pv2TplSubject', sink: 'tplSubject', value: tpl.subject, single: true, plFocus: 'emails.modele.objet', placeholder: 'L’objet du mail', labelledby: 'emTplObjetTitre' })}</div>
          <div class="em-papier-texte em-champ-message">
            ${pv2VarBar('pv2TplBody', ['prenom', 'nom', 'centre'])}
            ${pv2TokeditHtml({ id: 'pv2TplBody', sink: 'tplBody', value: tpl.body, plFocus: 'emails.modele.message', placeholder: 'Bonjour {{prenom}},…' })}
          </div>
          <p class="em-papier-signature">La signature de ${esc(centre)} s’ajoute ici toute seule, avec la formule de fin et les coordonnées.</p>
        </div>`;
    return `<div class="em-atelier" data-pv2-mount="tplEditor" data-em-ia-editeur="modele">
      <div class="em-atelier-tete">
        <label class="em-atelier-nom"><span class="em-atelier-nom-titre">${tpl.id ? 'Modèle' : 'Nouveau modèle'}</span><input id="pv2TplName" data-pl-focus="emails.modele.nom" value="${esc(tpl.name)}" placeholder="Son nom, par exemple Offre rentrée" aria-label="Le nom du modèle" oninput="pv2TplField('name', this.value)"></label>
        <div class="em-atelier-actions em-actions">
          <button type="button" class="pv2-btn" onclick="pv2TplCancel()">Fermer</button>
          <button type="button" class="pv2-btn primary em-principal" onclick="pv2TplSave()" ${pv2Settings.busy ? 'disabled' : ''}>${tpl.id ? 'Enregistrer le modèle' : 'Créer le modèle'}</button>
        </div>
      </div>
      <div class="em-atelier-corps">
        <div class="em-papier">
          <div class="em-papier-vues">${seg([{ key: 'ecrire', label: 'Écrire', active: vue === 'ecrire' }, { key: 'apercu', label: 'Voir le mail envoyé', active: vue === 'apercu' }], 'pv2TplVue')}</div>
          ${feuille}
          ${emOptionsHtml('modele', `catégorie ${categorie}`, `<label class="pv2-composer-field em-options-champ"><span>Dans quelle catégorie le ranger ?</span><select onchange="pv2TplField('category', this.value)">${PV2_TPL_CATEGORIES.map(([key, label]) => `<option value="${key}"${tpl.category === key ? ' selected' : ''}>${label}</option>`).join('')}</select></label>`)}
        </div>
        ${emIaBarHtml('modele', { colonne: true })}
      </div>
    </div>`;
  }
  window.pv2TplVue = function (vue) {
    pv2Settings.tplVue = vue === 'apercu' ? 'apercu' : 'ecrire';
    renderStaffEmailsPage();
    if (pv2Settings.tplVue === 'apercu') pv2ApercuModele(0);
  };

  // LA LISTE A GAUCHE, L EDITEUR A DROITE (2026-11-10). L editeur garde ses
  // jetons de variables a inserer, son apercu vivant et la barre d aide.
  function pv2EmailsSectionModeles() {
    const tpl = pv2Settings.tplEditing;
    const gerer = typeof canUseStaffPermission !== 'function' || canUseStaffPermission('campaigns.manage');
    const cascade = { n: 0 };
    const groupes = [];
    for (const s of PV2_STARTERS) {
      let g = groupes.find((x) => x.label === s.cat);
      if (!g) { g = { label: s.cat, rows: [] }; groupes.push(g); }
      g.rows.push(pv2ModeleCarte({ ref: `starter:${s.key}`, name: s.name, subject: s.subject, own: false, key: s.key }, false, cascade));
    }
    const vos = pv2Mail.templates.map((t) => pv2ModeleCarte({
      ref: `tpl:${t.id}`, name: t.label || t.name || `Modèle ${t.id}`, subject: t.subject || '', own: true, id: t.id,
    }, Boolean(tpl && tpl.id && String(tpl.id) === String(t.id)), cascade));
    const liste = `<div class="em-tpl-liste">
        <div class="em-tpl-groupe"><p class="em-label">Vos modèles${vos.length ? ` <span class="em-label-n">${vos.length}</span>` : ''}</p>${vos.length ? `<ul class="em-tpl-rows">${vos.join('')}</ul>` : `<p class="em-calme">Aucun modèle à vous pour l’instant.${gerer ? ' Copiez un modèle de Pinlane ou partez d’une page blanche.' : ''}</p>`}</div>
        ${groupes.map((g) => `<div class="em-tpl-groupe"><p class="em-label">${esc(g.label)}</p><ul class="em-tpl-rows">${g.rows.join('')}</ul></div>`).join('')}
      </div>`;
    const droite = tpl
      ? pv2ModeleEditeur()
      : `<div class="em-tpl-vide"><p class="em-calme">Choisissez un modèle dans la liste pour le relire et le modifier. Un modèle de Pinlane se copie d’abord, le vôtre se garde.</p></div>`;
    return `<section class="pv2-settings em-tpl${tpl ? ' is-ouvert' : ''}" data-pv2-mount="settings" aria-label="Modèles">
      <div class="em-block em-tpl-gauche">
        <div class="em-block-head"><div><h2 class="em-h2">Modèles</h2><p class="em-sub">Des textes prêts à envoyer. Les vôtres apparaissent aussi dans le nouveau message.</p></div>
          ${gerer ? `<button type="button" class="pv2-btn sm${tpl ? '' : ' primary'}" onclick="pv2TplEdit(null)">Nouveau modèle</button>` : ''}
        </div>
        ${liste}
      </div>
      <div class="em-block em-tpl-droite${tpl ? '' : ' is-vide'}">${droite}</div>
    </section>`;
  }

  /* ── SECTION EXPEDITEURS : les identites, et l adresse de reponse ───────── */
  /* ── SECTION EXPEDITEURS (2026-11-10) : une ligne par adresse d envoi, l etat
     de son domaine dit en une phrase, puis la prochaine etape. Ensuite
     l adresse de reponse et ce que Pinlane sait du fournisseur. ── */
  function pv2EmailsSectionExpediteurs() {
    const identity = pv2Settings.idEditing;
    // saveEmailIdentity et deleteEmailIdentity : settings.manage (api/ops.js).
    const regler = typeof canUseStaffPermission !== 'function' || canUseStaffPermission('settings.manage');
    const channel = pv2Mail.channel || {};
    const centre = pv2Design.center || null;
    // La meme regle que le bandeau d echec de l Apercu : les causes reelles
    // des mails sortants de la file, jamais la seule presence de la cle.
    const domaineNonVerifie = getStaffEmailFailureGroups(getStaffEmailRows().filter((r) => !pv2IsInbound(r)))
      .find((g) => g.label === 'Domaine d\'envoi pas encore vérifié') || null;
    // L adresse que les mails donnent VRAIMENT en Reply-To, dite par le serveur
    // (2026-09-17). L adresse publique de la fiche n est qu un repli.
    const reponseServeur = pv2Design.reponse && typeof pv2Design.reponse === 'object' ? pv2Design.reponse : null;
    const reponse = reponseServeur ? String(reponseServeur.adresse || '').trim() : (centre && centre.publicInfo ? String(centre.publicInfo.email || '').trim() : '');
    const reponseVersPinlane = Boolean(reponseServeur && reponseServeur.versPinlane);
    // L ETAT DE L ENVOI, DIT UNE FOIS (2026-11-11) : sa phrase et ce qu il
    // reste a faire vivent en haut de la section. Chaque adresse n en garde
    // que le mot court, et la carte du fournisseur ne la repete pas.
    const domaines = [...new Set(pv2Mail.identities.map((i) => String(i.email || '').split('@')[1]).filter(Boolean))];
    const envoi = !pv2Mail.metaLoaded ? { ton: '', court: 'Lecture de l’état…' }
      : !channel.resendConfigured ? { ton: 'is-off', court: 'Envoi non relié', phrase: 'Aucun service d’envoi n’est relié.', etape: 'Les mails restent en file sans partir. Il reste à relier le service d’envoi.' }
      : domaineNonVerifie ? { ton: 'is-attente', court: 'Domaine pas encore vérifié', phrase: `${domaines.length === 1 ? `Le domaine ${domaines[0]}` : 'Le domaine d’envoi du centre'} n’est pas encore vérifié chez le service d’envoi.`, etape: `${domaineNonVerifie.count > 1 ? `${domaineNonVerifie.count} mails ne sont pas partis` : 'Un mail n’est pas parti'} pour cette raison. Il reste à faire vérifier ce domaine. Tant que ce n’est pas fait, aucun mail ne part vers un client.` }
      : { ton: 'is-ok', court: 'Envoi normal' };
    const alerte = envoi.phrase ? `<div class="em-todo ${envoi.ton === 'is-off' ? 'is-red' : 'is-amber'} em-exp-alerte" role="status">
          <span class="em-todo-dot" aria-hidden="true"></span>
          <span class="em-todo-text"><strong>${esc(envoi.phrase)}</strong><small>${esc(envoi.etape)}</small></span>
        </div>` : '';
    const cascade = { n: 0 };
    const liste = identity ? `<div class="pv2-composer-grid em-exp-form">
        <label class="pv2-composer-field"><span>Le nom que voient vos clients</span><input data-pl-focus="emails.identite.nom" value="${esc(identity.label)}" placeholder="Ex. le nom de votre centre" oninput="pv2IdField('label', this.value)"></label>
        <label class="pv2-composer-field"><span>L’adresse d’où partent les mails</span><input data-pl-focus="emails.identite.email" value="${esc(identity.email)}" placeholder="contact@votre-centre.be" oninput="pv2IdField('email', this.value)"></label>
        <label class="pv2-composer-field pv2-settings-check"><span>&nbsp;</span><label class="pv2-check"><input type="checkbox" ${identity.isDefault ? 'checked' : ''} onchange="pv2IdField('isDefault', this.checked)"> Adresse par défaut</label></label>
        <div class="pv2-composer-actions pv2-composer-wide em-actions">
          <button type="button" class="em-lien" onclick="pv2Settings.idEditing = null; renderStaffEmailsPage();">Annuler</button>
          <span class="pv2-composer-spacer"></span>
          <button type="button" class="pv2-btn primary em-principal" onclick="pv2IdSave()" ${pv2Settings.busy ? 'disabled' : ''}>Ajouter l'adresse</button>
        </div>
      </div>`
      : pv2Mail.identities.length
        ? `<ul class="em-exp-rows">${pv2Mail.identities.map((i) => {
          return `<li class="em-exp-row"${emEntree(`expediteurs:${i.id}`, cascade)}>
            <div class="em-exp-qui"><strong>${esc(i.label || i.email)}</strong><span>${esc(i.email)}</span></div>
            <div class="em-exp-etat ${envoi.ton}"><p>${esc(envoi.court)}</p></div>
            <div class="em-exp-actions">
              ${i.isDefault ? '<span class="pv2-chip blue">Par défaut</span>' : regler ? `<button type="button" class="em-lien" onclick="pv2IdDefault('${escJs(String(i.id))}')">Mettre par défaut</button>` : ''}
              ${regler ? emMenuPlusHtml(`emExpPlus${i.id}`, `Plus d’actions pour ${i.label || i.email}`, [emGestePlus('Supprimer cette adresse', `pv2IdDelete('${escJs(String(i.id))}')`, { danger: true })]) : ''}
            </div>
          </li>`;
        }).join('')}</ul>`
        : `<p class="em-calme">Aucune adresse d’envoi pour l’instant.${regler ? ' Ajoutez l’adresse avec laquelle vos mails partent.' : ''}</p>`;
    return `<div class="em-exp">
      <section class="em-block pv2-settings" data-pv2-mount="settings" aria-label="Expéditeurs">
        <div class="em-block-head"><div><h2 class="em-h2">Adresses d’envoi</h2><p class="em-sub">Le nom et l’adresse que vos clients voient en tête du mail. Une adresse par défaut, les autres au choix dans le nouveau message.</p></div>
          ${identity || !regler ? '' : '<button type="button" class="pv2-btn sm primary" onclick="pv2IdEdit()">Nouvelle adresse</button>'}
        </div>
        ${alerte}
        ${liste}
      </section>
      <div class="em-exp-bas">
        <section class="em-block" aria-label="Adresse de réponse">
          <div class="em-block-head"><div><h2 class="em-h2">Adresse de réponse</h2><p class="em-sub">Quand un client répond à un mail du centre, sa réponse arrive ici.</p></div></div>
          <div class="pv2-reply-address">
            ${pv2Design.loaded
              ? (reponse ? `<strong>${esc(reponse)}</strong><p class="pv2-note">${reponseVersPinlane ? 'Les réponses des clients arrivent directement dans Reçus. Elles n\'arrivent pas dans la boîte mail du centre.' : 'Les réponses des clients arrivent dans cette boîte mail. Elles arrivent aussi dans Reçus quand la boîte les redirige vers Pinlane.'}</p>` : '<strong>Non renseignée pour ce centre</strong><p class="pv2-note">La fiche du centre n\'a pas d\'adresse publique. Les réponses des clients suivent alors l\'adresse d\'envoi.</p>')
              : `<span class="pv2-live-state" aria-live="polite">${pv2Design.error ? esc(pv2Design.error) : 'Lecture de la fiche du centre…'}</span>`}
          </div>
        </section>
        <section class="em-block" aria-label="Fournisseur d'envoi">
          <div class="em-block-head"><div><h2 class="em-h2">Fournisseur d’envoi</h2><p class="em-sub">Ce que Pinlane sait de la chaîne d’envoi.</p></div></div>
          <div class="pv2-reply-address">
            ${pv2Mail.metaLoaded
              ? (!channel.resendConfigured
                ? '<strong data-pv2-envoi="absent">Envoi non configuré</strong>'
                : domaineNonVerifie
                  ? '<strong data-pv2-envoi="domaine">Domaine d\'envoi pas encore vérifié</strong><p class="pv2-note">Le service d\'envoi est relié à Pinlane.</p>'
                  : '<strong data-pv2-envoi="ok">Envoi configuré</strong><p class="pv2-note">Les mails partent par le service d\'envoi relié à Pinlane.</p>')
              : '<span class="pv2-live-state" aria-live="polite">Chargement…</span>'}
          </div>
        </section>
      </div>
    </div>`;
  }

  /* ── SECTION L AGENT : ses textes, et ce qu il ne sait pas ───────────────── */
  /* ── SECTION L AGENT (2026-11-10) : ses questions d abord, chacune avec sa
     case de reponse ; puis ce qu il sait du centre, en lignes a corriger ;
     enfin ce qu il ecrit (signature, consignes, reponse type par sujet). ── */
  // LES REPONSES TYPES EN LIGNES (2026-11-11) : six grandes cases a la suite
  // faisaient un formulaire sans fin. Chaque sujet est une ligne (son nom,
  // puis la premiere phrase de sa reponse) qui s ouvre pour se modifier, une
  // a la fois. La ligne ouverte survit aux rendus (pv2Settings.brainOuvert).
  // Les cases fermees restent dans la page : ce qui est tape se garde, et
  // l enregistrement envoie tout, comme avant.
  function emBrainPremiere(texte) {
    const lignes = String(texte || '').split('\n').map((l) => l.trim()).filter(Boolean);
    return lignes.find((l) => !/^(bonjour|bonsoir|madame|monsieur)\b/i.test(l)) || lignes[0] || '';
  }
  function pv2BrainTypesHtml(brain, { lecture = false } = {}) {
    const ouvert = pv2Settings.brainOuvert || '';
    return `<div class="pv2-composer-wide em-brain-types">
      <p class="em-brain-titre">Ses réponses types</p>
      ${Object.entries(brain.defaults.intents || PV2_INTENT_LABELS).map(([intent, label]) => {
        const brouillon = brain.draft.faq[intent] || '';
        const origine = (brain.defaults.faq[intent] && brain.defaults.faq[intent].body) || '';
        const ligne = emBrainPremiere(brouillon || origine) || 'Réponse type d’origine';
        const corps = lecture
          ? `<p class="em-texte-lu">${esc(brouillon || origine || 'Aucune')}</p>`
          : `<div class="pv2-composer-field em-brain-champ"><textarea rows="6" aria-label="Réponse « ${esc(label)} »" data-pl-focus="emails.agent.faq.${esc(intent)}" placeholder="${esc(origine || 'Réponse type…')}" oninput="pv2BrainField('faq', '${escJs(intent)}', this.value); emBrainLigne(this)">${esc(brouillon)}</textarea></div>`;
        return `<details class="em-brain-type" name="em-brain-types"${ouvert === intent ? ' open' : ''} ontoggle="pv2BrainOuvrir('${escJs(intent)}', this.open)">
        <summary><span class="em-brain-nom">Réponse « ${esc(label)} »${brain.overrides.faq[intent] ? ' <em class="pv2-seq-pill">modifiée</em>' : ''}</span><span class="em-brain-ligne">${esc(ligne)}</span></summary>
        ${corps}
      </details>`;
      }).join('')}
    </div>`;
  }
  window.pv2BrainOuvrir = function (intent, ouvert) {
    if (ouvert) pv2Settings.brainOuvert = intent;
    else if (pv2Settings.brainOuvert === intent) pv2Settings.brainOuvert = '';
  };
  window.emBrainLigne = function (champ) {
    const boite = champ.closest('.em-brain-type');
    const ligne = boite && boite.querySelector('.em-brain-ligne');
    if (ligne) ligne.textContent = emBrainPremiere(champ.value || champ.placeholder) || 'Réponse type d’origine';
  };
  function pv2EmailsSectionAgent() {
    const brain = pv2Settings.brain;
    // emailBrain (ecriture) : settings.manage ou emails.send. Sans lui, les
    // textes se lisent, sans champ a remplir.
    const regler = typeof canUseStaffPermission !== 'function' || canUseStaffPermission(['settings.manage', 'emails.send']);
    // Une question en attente porte le bouton plein de l ecran (Apprendre) :
    // l enregistrement des textes reste alors un bouton simple (lot S).
    const apprendreEnVue = pv2PeutApprendre() && pv2SavoirDonnees().questions.length > 0;
    const form = !brain.loaded
      ? `<div class="em-attente" aria-live="polite" aria-busy="true">${typeof renderThinking === 'function' ? renderThinking('searching') : '<strong>Chargement…</strong>'}</div>`
      : brain.error || !brain.draft
        ? `<div class="em-vide" role="status"><p><strong>Textes indisponibles.</strong> ${esc(brain.error || 'Réponse incomplète du serveur.')}</p><button type="button" class="pv2-btn sm" onclick="pv2BrainRelire()">Réessayer</button></div>`
      : !regler
        ? `<div class="pv2-composer-grid">
        <p class="em-sub pv2-composer-wide">L’agent répond aux mails reçus avec ces textes. Votre rôle les lit, il ne les modifie pas.</p>
        ${[['Signature', brain.draft.signature || brain.defaults.signature], ['Consignes libres', brain.draft.extra]]
          .map(([label, texte]) => `<div class="pv2-composer-field pv2-composer-wide"><span>${esc(label)}</span><p class="em-texte-lu">${esc(texte || 'Aucune')}</p></div>`).join('')}
        ${pv2BrainTypesHtml(brain, { lecture: true })}
      </div>`
      : `<div class="pv2-composer-grid">
        <label class="pv2-composer-field"><span>Signature</span>
          <input data-pl-focus="emails.agent.signature" value="${esc(brain.draft.signature)}" placeholder="${esc(brain.defaults.signature || '')}" oninput="pv2BrainField('signature', null, this.value)">
        </label>
        <label class="pv2-composer-field pv2-composer-wide"><span>Ce que l’agent doit toujours savoir</span>
          <textarea rows="3" data-pl-focus="emails.agent.consignes" placeholder="Ex. Le parking est gratuit derrière le bâtiment. On ne prend pas de réservation le lundi." oninput="pv2BrainField('extra', null, this.value)">${esc(brain.draft.extra)}</textarea>
        </label>
        ${pv2BrainTypesHtml(brain)}
        <div class="pv2-composer-actions pv2-composer-wide em-actions">
          <button type="button" class="pv2-btn${apprendreEnVue ? '' : ' primary em-principal'}" onclick="pv2BrainSave()" ${pv2Settings.busy ? 'disabled' : ''}>${pv2Settings.busy ? 'Enregistrement…' : 'Enregistrer, l\'agent apprend'}</button>
        </div>
      </div>`;
    return `<div class="em-agent pv2-agent-grid">
      ${pv2SectionApprentissage({ toujours: true })}
      <section class="pv2-panel pv2-settings em-block em-agent-reglages" data-pv2-mount="settings" aria-label="Réglages de l'agent">
        <div class="pv2-panel-head has-sub">
          <div><h2>Ce que l'agent écrit</h2><p class="pv2-panel-sub">Sa signature, ses consignes, et sa réponse type par sujet. Ce que vous écrivez ici gagne toujours sur le modèle d’origine, et un champ vidé le reprend. ${pv2Mail.channel && pv2Mail.channel.aiConfigured ? 'Il lit les mails reçus avec un modèle de langage.' : 'Sans modèle de langage relié, il lit les mails reçus avec ses règles internes.'}</p></div>
        </div>
        <div class="pv2-panel-body">${form}</div>
      </section>
    </div>`;
  }

  /* ── Séquences automatiques : les emails qui partent tout seuls, pilotés
     ON/OFF depuis ici (contrat automationSettings). Le levier n°1 du secteur
     (anniversaire J-30) vit ici. ── */
  // timing : bornes du contrat C2, libellés FR compréhensibles en one-shot.
  const AUTOMATION_META = [
    { key: 'request_received', label: 'Demande reçue', desc: 'Accuse réception au client quand sa demande part en validation.' },
    { key: 'confirmation', label: 'Confirmation', desc: 'Confirme la réservation au client dès qu’elle est validée.' },
    // « no-show » etait le dernier anglicisme d'un ecran par ailleurs
    // entierement traduit, sur la carte lue le plus souvent.
    { key: 'reminder_48h', label: 'Rappel avant la venue', desc: 'Rappelle la venue quelques jours avant, pour moins d’absences le jour J.', timing: { options: [1, 2, 3, 4], label: (n) => `${n} jour${n > 1 ? 's' : ''} avant la venue` } },
    { key: 'post_visit', label: 'Merci post-visite', desc: 'Remercie après la visite et invite à revenir.', timing: { options: [0, 1, 2, 3], label: (n) => (n === 0 ? 'Le jour même' : `${n} jour${n > 1 ? 's' : ''} après la visite`) } },
    // « Anniversaire J-30 » et « Réactivation dormants » étaient du jargon de
    // marketeur sur un écran lu par une gérante de centre de loisirs : « J-30 »
    // ne se lit pas, « dormants » est un mot de CRM. Le libellé dit maintenant
    // ce que fait la séquence, en français.
    { key: 'birthday_j30', label: '30 jours avant l’anniversaire', desc: 'L’anniversaire fêté ici revient chaque année, relance toute seule au bon moment.', timing: { options: [15, 21, 30, 45, 60], label: (n) => `${n} jours avant la date anniversaire` } },
    { key: 'reactivation', label: 'Réactiver les clients dormants', desc: 'Un rappel doux aux clients fidèles plus vus depuis 2 ou 3 mois, plafonné par semaine.', cap: { options: [5, 10, 20, 30, 50], label: (n) => `${n} envois max / semaine` } },
  ];
  const mkAuto = { loaded: false, loading: false, error: '', settings: null, defaults: {}, stats: {}, busyKey: '', editKey: '', editDraft: {} };

  async function loadStaffAutomations(force = false) {
    if (mkAuto.loading || (mkAuto.loaded && !force)) return;
    mkAuto.loading = true;
    mkAuto.error = '';
    try {
      const payload = await apiRequest(`/api/ops?action=automationSettings&centerId=${encodeURIComponent(state.adminCenterId || 'libramont')}`);
      mkAuto.settings = payload.settings || {};
      mkAuto.defaults = payload.defaults || {};
      mkAuto.stats = payload.stats || {};
      mkAuto.loaded = true;
    } catch (error) {
      mkAuto.error = error.message || 'Séquences indisponibles.';
    } finally {
      mkAuto.loading = false;
      renderStaffEmailsPage();
    }
  }
  window.loadStaffAutomations = loadStaffAutomations;

  /* ── LISTE DE SUPPRESSION MARKETING ────────────────────────────────────────
     Qui ne veut plus recevoir de marketing pour ce centre. Section discrète :
     ce n'est pas le sujet principal de l'écran, mais elle n'est pas cachée.
     Style Vercel neutre, cohérent avec le reste de la page (aucune couleur de
     marque). La suppression ne touche QUE le marketing : les transactionnels
     (confirmation, rappel) continuent de partir, c'est écrit dans le panneau. */
  const pv2Suppress = { loaded: false, loading: false, error: '', entries: [], total: 0, busy: '', addEmail: '', addReason: '', q: '' };
  window.pv2Suppress = pv2Suppress;
  const PV2_SUPPRESS_SOURCE = { link: 'Lien de retrait', staff: 'Ajout manuel', complaint: 'Plainte', form: 'Refus à la réservation' };

  async function loadPv2Suppressions(force = false) {
    if (pv2Suppress.loading || (pv2Suppress.loaded && !force)) return;
    pv2Suppress.loading = true;
    pv2Suppress.error = '';
    try {
      const payload = await apiRequest(`/api/ops?action=suppressions&centerId=${encodeURIComponent(state.adminCenterId || 'libramont')}`);
      pv2Suppress.entries = payload.entries || [];
      pv2Suppress.total = payload.total || pv2Suppress.entries.length;
      pv2Suppress.loaded = true;
    } catch (error) {
      pv2Suppress.error = error.message || 'Liste indisponible.';
    } finally {
      pv2Suppress.loading = false;
      renderStaffEmailsPage();
    }
  }
  window.loadPv2Suppressions = loadPv2Suppressions;

  window.pv2SuppressSetAdd = function (field, value) {
    if (field === 'email') pv2Suppress.addEmail = value;
    if (field === 'reason') pv2Suppress.addReason = value;
  };

  window.pv2SuppressAdd = async function () {
    if (typeof canUseStaffPermission === 'function' && !canUseStaffPermission(['campaigns.manage', 'emails.send'])) { toast('Votre rôle ne permet pas de changer cette liste.'); return; }
    const email = String(pv2Suppress.addEmail || '').trim();
    if (!email.includes('@')) { toast('Entrez une adresse email valide.'); return; }
    if (pv2Suppress.busy) return;
    pv2Suppress.busy = 'add';
    renderStaffEmailsPage();
    try {
      await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'suppressionAdd', email, reason: pv2Suppress.addReason || '', centerId: state.adminCenterId || 'libramont' }),
      });
      pv2Suppress.addEmail = '';
      pv2Suppress.addReason = '';
      toast('Adresse retirée du marketing ✓');
      await loadPv2Suppressions(true);
    } catch (error) {
      toast(error.message || 'Ajout impossible.');
    } finally {
      pv2Suppress.busy = '';
      renderStaffEmailsPage();
    }
  };

  window.pv2SuppressRemove = async function (email) {
    if (pv2Suppress.busy) return;
    if (typeof canUseStaffPermission === 'function' && !canUseStaffPermission(['campaigns.manage', 'emails.send'])) { toast('Votre rôle ne permet pas de changer cette liste.'); return; }
    pv2Suppress.busy = `rm:${email}`;
    renderStaffEmailsPage();
    try {
      await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'suppressionRemove', email, centerId: state.adminCenterId || 'libramont' }),
      });
      toast('Adresse remise dans le marketing ✓');
      await loadPv2Suppressions(true);
    } catch (error) {
      toast(error.message || 'Retrait impossible.');
    } finally {
      pv2Suppress.busy = '';
      renderStaffEmailsPage();
    }
  };

  function pv2SuppressionPanel(options = {}) {
    const open = !!options.toujoursOuvert || !!state.staffSuppressOpen;
    const count = pv2Suppress.loaded ? pv2Suppress.total : (pv2Suppress.entries.length || 0);
    // suppressionAdd et suppressionRemove : campaigns.manage ou emails.send (api/ops.js).
    const exclure = typeof canUseStaffPermission !== 'function' || canUseStaffPermission(['campaigns.manage', 'emails.send']);
    const rows = pv2Suppress.entries.map((entry) => {
      const when = formatOpsTimestamp(entry.createdAt) || '-';
      const src = PV2_SUPPRESS_SOURCE[entry.source] || entry.source || '-';
      const busy = pv2Suppress.busy === `rm:${entry.email}`;
      return `<tr>
        <td><strong>${esc(entry.email)}</strong>${entry.reason ? `<small class="pv2-cell-sub">${esc(entry.reason)}</small>` : ''}</td>
        <td><span class="pv2-chip">${esc(src)}</span></td>
        <td class="num">${esc(when)}</td>
        ${exclure ? `<td><button type="button" class="pv2-btn sm ghost" onclick="pv2SuppressRemove('${escJs(entry.email)}')" ${busy ? 'disabled' : ''}>${busy ? 'Retrait…' : 'Réinscrire'}</button></td>` : ''}
      </tr>`;
    }).join('');
    return `<section class="pv2-panel mk-auto-panel">
      <div class="pv2-panel-head has-sub">
        <div>
          <h2>Ne plus recevoir de marketing</h2>
          <p class="pv2-panel-sub">${pv2Suppress.loaded
            ? `${count} adresse${count > 1 ? 's' : ''} exclue${count > 1 ? 's' : ''} des envois marketing (campagnes, anniversaire, réactivation).`
            : 'Les adresses qui se sont retirées des envois marketing (campagnes, anniversaire, réactivation).'} Elles continuent de recevoir les confirmations et rappels de leurs réservations.</p>
        </div>
        ${options.toujoursOuvert ? '' : `<button type="button" class="pv2-btn sm" onclick="pv2ToggleSuppress()" aria-expanded="${open}">${open ? 'Masquer' : 'Voir la liste'}</button>`}
      </div>
      ${open ? `<div class="pv2-panel-body" data-pv2-mount="suppress">
        ${exclure ? `<div class="pv2-suppress-add" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;align-items:center;">
          <input type="email" value="${esc(pv2Suppress.addEmail)}" placeholder="adresse@exemple.be" oninput="pv2SuppressSetAdd('email', this.value)" style="flex:1 1 220px;min-width:180px;padding:8px 10px;border:1px solid var(--v2-border,#e2e2e2);border-radius:6px;">
          <input type="text" value="${esc(pv2Suppress.addReason)}" placeholder="Motif (facultatif)" oninput="pv2SuppressSetAdd('reason', this.value)" style="flex:1 1 160px;min-width:140px;padding:8px 10px;border:1px solid var(--v2-border,#e2e2e2);border-radius:6px;">
          <button type="button" class="pv2-btn sm" onclick="pv2SuppressAdd()" ${pv2Suppress.busy === 'add' ? 'disabled' : ''}>${pv2Suppress.busy === 'add' ? 'Ajout…' : 'Ajouter à la liste'}</button>
        </div>` : ''}
        ${pv2Suppress.error
          ? `<div class="pv2-empty"><strong>${esc(pv2Suppress.error)}</strong></div>`
          : !pv2Suppress.loaded
            ? `<div class="pv2-empty">${typeof renderThinking === 'function' ? renderThinking('searching') : '<strong>Chargement…</strong>'}</div>`
            : pv2Suppress.entries.length
              ? `<table class="pv2-table">
                  <thead><tr><th>Adresse</th><th>Origine</th><th class="num">Depuis</th>${exclure ? '<th></th>' : ''}</tr></thead>
                  <tbody>${rows}</tbody>
                </table>`
              : '<div class="pv2-empty"><strong>Personne pour l\'instant</strong>Aucune adresse ne s\'est retirée du marketing.</div>'}
      </div>` : ''}
    </section>`;
  }
  window.pv2SuppressionPanel = pv2SuppressionPanel;

  window.pv2ToggleSuppress = function () {
    state.staffSuppressOpen = !state.staffSuppressOpen;
    save();
    if (state.staffSuppressOpen && !pv2Suppress.loaded && !pv2Suppress.loading) loadPv2Suppressions();
    renderStaffEmailsPage();
  };

  /* ── JOURNAL DES MODIFICATIONS ───────────────────────────────────────────
     Surface d'AUDIT de la Direction : qui a modifie quoi dans ce centre,
     quand, et qu'est-ce qui a change exactement. Depuis 2026-07-22 le panneau
     n'a plus qu'UN hote, l'onglet Journal de la console Direction
     (renderAdminJournalTab, admin-console.js) : il n'apparait plus sur la
     page Emails, ou il n'avait rien a faire (demande du proprio).

     Scope : le serveur decide. La page envoie le centre courant, mais
     api/ops.js re-resout le centre depuis la SESSION avant de lire
     (resolveEffectiveCenterId), donc une directrice qui bricolerait le
     parametre ne verrait toujours que son centre. Le filtre affiche ici n'est
     pas une securite, c'est du confort de lecture.

     Style Vercel neutre : monochrome sauf le sens (un refus est rouge parce
     qu'un refus EST un signal), filets 1px, rayons 6-8px, aucun bouton primaire
     dans ce panneau qui est une surface de lecture. Aucune couleur de marque. */
  const pv2Audit = {
    loaded: false, loading: false, error: '', entries: [],
    filterKind: '', filterOutcome: '', filterSince: '', expanded: '',
    // Vue « Parcours des equipes » (2026-08-25) : les lots action='parcours'
    // deplies en chronologie par personne. Le proprietaire n'y figure
    // jamais : le serveur ne trace pas ses sessions.
    view: 'modifs', trailEntries: [], trailLoading: false, trailLoaded: false,
  };
  window.pv2Audit = pv2Audit;

  /* L'hote (Direction) s'inscrit via window.pv2AuditRerender a chaque rendu de
     son onglet Journal. Sans hote inscrit, une interaction ne re-rend RIEN :
     le panneau ne vit plus sur la page Emails, il n'y a pas de defaut. */
  window.pv2AuditRerender = null;
  function pv2AuditRerenderHost() {
    if (typeof window.pv2AuditRerender === 'function') window.pv2AuditRerender();
  }

  const PV2_AUDIT_ACTOR = {
    staff: 'Humain', public: 'Client', cron: 'Cron', worker: 'Worker', system: 'Système',
  };
  const PV2_AUDIT_DENIED = {
    '401_no_session': 'Sans session',
    '403_center_scope': 'Autre centre',
    // Motif distinct de « Autre centre » a dessein : viser le centre d'un AUTRE
    // CLIENT est la ligne la plus grave que ce journal puisse porter.
    '403_cross_client': 'Autre client',
    '403_permission': 'Droits insuffisants',
  };

  async function loadPv2Audit(force = false) {
    if (pv2Audit.loading || (pv2Audit.loaded && !force)) return;
    pv2Audit.loading = true;
    pv2Audit.error = '';
    try {
      const params = new URLSearchParams({
        action: 'auditLog',
        centerId: state.adminCenterId || 'libramont',
        limit: '80',
      });
      if (pv2Audit.filterKind) params.set('actorKind', pv2Audit.filterKind);
      if (pv2Audit.filterOutcome) params.set('outcome', pv2Audit.filterOutcome);
      // Fenetre temporelle : jours -> borne ISO, portee par le parametre
      // `since` que l'action auditLog lit deja cote serveur (api/ops.js).
      const sinceDays = Number(pv2Audit.filterSince);
      if (Number.isFinite(sinceDays) && sinceDays > 0) {
        params.set('since', new Date(Date.now() - sinceDays * 86400000).toISOString());
      }
      const payload = await apiRequest(`/api/ops?${params.toString()}`);
      pv2Audit.entries = payload.entries || [];
      pv2Audit.loaded = true;
    } catch (error) {
      pv2Audit.error = error.message || 'Journal indisponible.';
    } finally {
      pv2Audit.loading = false;
      pv2AuditRerenderHost();
    }
  }
  window.loadPv2Audit = loadPv2Audit;

  async function loadPv2AuditTrail(force = false) {
    if (pv2Audit.trailLoading || (pv2Audit.trailLoaded && !force)) return;
    pv2Audit.trailLoading = true;
    try {
      const params = new URLSearchParams({
        action: 'auditLog',
        centerId: state.adminCenterId || 'libramont',
        auditAction: 'parcours',
        limit: '150',
      });
      const payload = await apiRequest(`/api/ops?${params.toString()}`);
      pv2Audit.trailEntries = payload.entries || [];
      pv2Audit.trailLoaded = true;
    } catch (error) {
      toast(error.message || 'Parcours indisponible.');
    } finally {
      pv2Audit.trailLoading = false;
      pv2AuditRerenderHost();
    }
  }

  window.pv2AuditSetView = function (view) {
    pv2Audit.view = view === 'parcours' ? 'parcours' : 'modifs';
    if (pv2Audit.view === 'parcours' && !pv2Audit.trailLoaded && !pv2Audit.trailLoading) loadPv2AuditTrail();
    pv2AuditRerenderHost();
  };

  function pv2AuditViewBar() {
    return `<div class="pv2-audit-views">
      <button type="button" class="pv2-btn sm ${pv2Audit.view !== 'parcours' ? 'primary' : ''}" onclick="pv2AuditSetView('modifs')">Modifications</button>
      <button type="button" class="pv2-btn sm ${pv2Audit.view === 'parcours' ? 'primary' : ''}" onclick="pv2AuditSetView('parcours')">Parcours des équipes</button>
    </div>`;
  }

  function pv2AuditTrailPanel() {
    let body;
    if (pv2Audit.trailLoading) {
      body = '<p class="pv2-panel-sub">Chargement du parcours…</p>';
    } else {
      const entries = pv2Audit.trailEntries || [];
      if (!entries.length) {
        body = '<div class="pv2-empty"><strong>Aucun parcours enregistré</strong>Les pages ouvertes et les boutons touchés par l\'équipe apparaîtront ici. Le propriétaire n\'est jamais tracé.</div>';
      } else {
        const groups = new Map();
        entries.forEach((entry) => {
          const day = String(entry.occurredAt || '').slice(0, 10);
          const key = `${entry.actorLabel || entry.actorMemberId || '?'}|${day}`;
          const group = groups.get(key) || { actor: entry.actorLabel || entry.actorMemberId || '?', role: entry.actorRoleId || '', day, events: [] };
          const list = entry.context && Array.isArray(entry.context.events) ? entry.context.events : [];
          group.events.push(...list);
          groups.set(key, group);
        });
        const heure = (t) => { const d = new Date(Number(t)); return Number.isFinite(d.getTime()) ? d.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }) : '--:--'; };
        body = [...groups.values()].map((group) => {
          const events = group.events.slice().sort((a, b) => Number(a.t) - Number(b.t));
          const lines = events.map((ev) => `<div class="pv2-trail-line">
            <span class="pv2-trail-time">${esc(heure(ev.t))}</span>
            <span class="pv2-trail-kind${ev.k === 'page' ? ' is-page' : ''}">${ev.k === 'page' ? 'Page' : 'Clic'}</span>
            <span class="pv2-trail-label">${esc(ev.v)}</span>
          </div>`).join('');
          return `<section class="pv2-trail-group">
            <div class="pv2-trail-head"><strong>${esc(group.actor)}</strong>${group.role ? `<span>${esc(group.role)}</span>` : ''}<span>${esc(group.day)}</span><span>${events.length} action${events.length > 1 ? 's' : ''}</span></div>
            ${lines}
          </section>`;
        }).join('');
      }
    }
    return `<section class="pv2-panel pv2-audit-panel">
      <div class="pv2-panel-head has-sub">
        <div>
          <h2>Journal des modifications</h2>
          <p class="pv2-panel-sub">Le parcours de chaque personne : les pages ouvertes et les boutons touchés, dans l\'ordre. Les modifications elles-mêmes vivent dans l\'autre vue.</p>
        </div>
      </div>
      <div class="pv2-panel-body" data-pv2-mount="audit">
        ${pv2AuditViewBar()}
        ${body}
      </div>
    </section>`;
  }

  window.pv2AuditFilter = function (field, value) {
    if (field === 'kind') pv2Audit.filterKind = value;
    if (field === 'outcome') pv2Audit.filterOutcome = value;
    if (field === 'since') pv2Audit.filterSince = value;
    loadPv2Audit(true);
  };

  window.pv2AuditToggleRow = function (id) {
    pv2Audit.expanded = pv2Audit.expanded === String(id) ? '' : String(id);
    pv2AuditRerenderHost();
  };

  /* Rend une valeur de diff lisible. Les objets sont serialises courts : le
     detail complet est dans le depliage, pas dans la cellule. */
  function pv2AuditValue(value) {
    if (value === null || value === undefined || value === '') return '(vide)';
    if (Array.isArray(value)) return value.length ? value.join(', ') : '(aucun)';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  function pv2AuditChangesTable(changes) {
    const keys = Object.keys(changes || {});
    if (!keys.length) return '<p class="pv2-panel-sub">Aucun détail de modification enregistré pour cette action.</p>';
    const rows = keys.map((key) => `<tr>
      <td><strong>${esc(key)}</strong></td>
      <td>${esc(pv2AuditValue(changes[key] && changes[key].before))}</td>
      <td>${esc(pv2AuditValue(changes[key] && changes[key].after))}</td>
    </tr>`).join('');
    return `<table class="pv2-table">
      <thead><tr><th>Champ</th><th>Avant</th><th>Après</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  // CE QUE L ACTION A TOUCHE, EN MOTS (2026-11-06, Ansar : « chaque numero
  // affiche mene quelque part, les autres disparaissent »). Une reservation
  // garde son numero, qui l ouvre ; une demande de groupe s ouvre sans numero
  // (son compteur ne se voit nulle part ailleurs) ; une piste garde le sien,
  // c est celui de la salle. Les autres identifiants internes (campagne, job,
  // modele...) ne menaient nulle part : seul le genre de l objet reste.
  const PV2_AUDIT_OBJETS = {
    reservation: 'Réservation', custom_request: 'Demande de groupe', client: 'Client', center: 'Centre',
    formula: 'Formule', activity: 'Activité', campaign: 'Campagne', lane: 'Piste', email_template: 'Modèle de mail',
    email_identity: 'Adresse d’envoi', permission: 'Droits', delay_incident: 'Retard', ops_job: 'Tâche',
  };
  function pv2AuditObjet(entry) {
    const type = String(entry.entityType || '');
    const mot = PV2_AUDIT_OBJETS[type] || type;
    const id = String(entry.entityId == null ? '' : entry.entityId).trim();
    if (type === 'reservation' && /^\d{1,12}$/.test(id)) {
      return `<button type="button" class="pv2-lien-numero" onclick="event.stopPropagation(); ouvrirReservationNumero('${id}')">Réservation n°&nbsp;${id}</button>`;
    }
    if (type === 'custom_request' && /^\d{1,12}$/.test(id) && typeof openStaffRequestsPage === 'function') {
      return `<button type="button" class="pv2-lien-numero" onclick="event.stopPropagation(); openStaffRequestsPage('${id}')">${esc(mot)}</button>`;
    }
    if (type === 'lane' && /^\d{1,3}$/.test(id)) return `${esc(mot)} ${esc(id)}`;
    return esc(mot);
  }

  function pv2AuditPanel() {
    if (pv2Audit.view === 'parcours') return pv2AuditTrailPanel();
    const entries = pv2Audit.entries || [];
    const deniedCount = entries.filter((entry) => entry.outcome === 'denied').length;
    const errorCount = entries.filter((entry) => entry.outcome === 'error').length;
    const rows = entries.map((entry) => {
      const when = formatOpsTimestamp(entry.occurredAt) || '-';
      const actor = entry.actorLabel || PV2_AUDIT_ACTOR[entry.actorKind] || entry.actorKind || '-';
      const kind = PV2_AUDIT_ACTOR[entry.actorKind] || entry.actorKind || '';
      const isDenied = entry.outcome === 'denied';
      const isError = entry.outcome === 'error';
      const changeCount = Object.keys(entry.changes || {}).length;
      const expanded = pv2Audit.expanded === String(entry.id);
      /* Le refus porte la seule couleur du tableau. C'est deliberé : c'est le
         signal le plus interessant en securite, et il doit sauter aux yeux dans
         une liste ou tout le reste est du gris. */
      const outcomeChip = isDenied
        ? `<span class="pv2-chip red">Refusé${entry.deniedReason ? ` · ${esc(PV2_AUDIT_DENIED[entry.deniedReason] || entry.deniedReason)}` : ''}</span>`
        : isError
          ? '<span class="pv2-chip">Échec</span>'
          : '<span class="pv2-chip">Fait</span>';
      const detail = expanded
        ? `<tr class="pv2-audit-detail"><td colspan="6">
             ${pv2AuditChangesTable(entry.changes)}
             <p class="pv2-panel-sub" style="margin-top:10px;">
               Surface ${esc(entry.surface || '-')} · methode ${esc(entry.method || '-')}
               ${entry.entityType ? ` · ${pv2AuditObjet(entry)}` : ''}
             </p>
           </td></tr>`
        : '';
      return `<tr${isDenied ? ' class="is-denied"' : ''}>
        <td class="num">${esc(when)}</td>
        <td><strong>${esc(actor)}</strong><small class="pv2-cell-sub">${esc(kind)}${entry.actorRoleId ? ` · ${esc(entry.actorRoleId)}` : ''}</small></td>
        <td><strong>${esc(entry.action || '-')}</strong>${entry.entityType ? `<small class="pv2-cell-sub">${pv2AuditObjet(entry)}</small>` : ''}</td>
        <td>${outcomeChip}</td>
        <td class="num">${changeCount || ''}</td>
        <td><button type="button" class="pv2-btn sm ghost" onclick="pv2AuditToggleRow('${escJs(String(entry.id))}')" aria-expanded="${expanded}">${expanded ? 'Masquer' : 'Detail'}</button></td>
      </tr>${detail}`;
    }).join('');

    /* Meta honnete : on ne compte que ce qui est CHARGÉ (80 dernieres entrees
       max, filtres compris), et on le dit. Aucun total inventé. */
    const metaLine = pv2Audit.loaded
      ? `${entries.length} ${entries.length > 1 ? 'entrées affichées' : 'entrée affichée'}${deniedCount ? ` · ${deniedCount} refus` : ''}${errorCount ? ` · ${errorCount} ${errorCount > 1 ? 'échecs' : 'échec'}` : ''}`
      : '';

    return `<section class="pv2-panel pv2-audit-panel">
      <div class="pv2-panel-head has-sub">
        <div>
          <h2>Journal des modifications</h2>
          <p class="pv2-panel-sub">Qui a changé quoi dans ce centre, quand, et ce qui a changé exactement. Les tentatives refusées y figurent aussi. Ce journal ne s'efface pas.</p>
        </div>
        ${metaLine ? `<span class="pv2-audit-meta">${esc(metaLine)}</span>` : ''}
      </div>
      <div class="pv2-panel-body" data-pv2-mount="audit">
        ${pv2AuditViewBar()}
        <div class="pv2-audit-filters">
          <label class="pv2-panel-sub" for="pv2AuditKind">Auteur</label>
          <select id="pv2AuditKind" class="pv2-audit-select" onchange="pv2AuditFilter('kind', this.value)">
            <option value="" ${pv2Audit.filterKind === '' ? 'selected' : ''}>Tous</option>
            <option value="staff" ${pv2Audit.filterKind === 'staff' ? 'selected' : ''}>Humain</option>
            <option value="cron" ${pv2Audit.filterKind === 'cron' ? 'selected' : ''}>Cron</option>
            <option value="worker" ${pv2Audit.filterKind === 'worker' ? 'selected' : ''}>Worker</option>
            <option value="public" ${pv2Audit.filterKind === 'public' ? 'selected' : ''}>Client</option>
          </select>
          <label class="pv2-panel-sub" for="pv2AuditOutcome">Résultat</label>
          <select id="pv2AuditOutcome" class="pv2-audit-select" onchange="pv2AuditFilter('outcome', this.value)">
            <option value="" ${pv2Audit.filterOutcome === '' ? 'selected' : ''}>Tout</option>
            <option value="success" ${pv2Audit.filterOutcome === 'success' ? 'selected' : ''}>Fait</option>
            <option value="denied" ${pv2Audit.filterOutcome === 'denied' ? 'selected' : ''}>Refusé</option>
            <option value="error" ${pv2Audit.filterOutcome === 'error' ? 'selected' : ''}>Échec</option>
          </select>
          <label class="pv2-panel-sub" for="pv2AuditSince">Période</label>
          <select id="pv2AuditSince" class="pv2-audit-select" onchange="pv2AuditFilter('since', this.value)">
            <option value="" ${pv2Audit.filterSince === '' ? 'selected' : ''}>Tout l'historique</option>
            <option value="1" ${pv2Audit.filterSince === '1' ? 'selected' : ''}>Dernières 24 h</option>
            <option value="7" ${pv2Audit.filterSince === '7' ? 'selected' : ''}>7 derniers jours</option>
            <option value="30" ${pv2Audit.filterSince === '30' ? 'selected' : ''}>30 derniers jours</option>
          </select>
          <button type="button" class="pv2-btn sm ghost" onclick="loadPv2Audit(true)">Actualiser</button>
        </div>
        ${pv2Audit.error
          ? `<div class="pv2-empty"><strong>${esc(pv2Audit.error)}</strong></div>`
          : !pv2Audit.loaded
            ? '<div class="pv2-empty"><strong>Chargement du journal…</strong></div>'
            : entries.length
              ? `<table class="pv2-table">
                  <thead><tr><th class="num">Quand</th><th>Qui</th><th>Action</th><th>Résultat</th><th class="num">Champs</th><th></th></tr></thead>
                  <tbody>${rows}</tbody>
                </table>`
              : '<div class="pv2-empty"><strong>Rien pour l\'instant</strong>Aucune modification enregistrée pour ce centre avec ces filtres.</div>'}
      </div>
    </section>`;
  }
  window.pv2AuditPanel = pv2AuditPanel;

  /* ── Édition d'une séquence : sujet, message, timing, cap, tout modifiable
     (contrat C2), défauts visibles en placeholder, reset 1-clic. ── */
  /* ── Édition d'une séquence : sujet, message, timing, cap, tout modifiable
     (contrat C2), défauts visibles en placeholder, reset 1-clic. Depuis le
     2026-09-16 l editeur montre a droite le mail VIVANT rendu par le serveur
     avec le brouillon en cours : la gerante voit ce que la sequence ecrit. ── */
  window.pv2AutoEdit = function (key) {
    delete EM_IA.sequence;
    if (typeof canUseStaffPermission === 'function' && !canUseStaffPermission(['settings.manage', 'emails.send'])) { toast('Votre rôle ne permet pas de modifier les séquences.'); return; }
    if (mkAuto.editKey === key) { mkAuto.editKey = ''; pv2ApercuAnnuler('auto'); renderStaffEmailsPage(); return; }
    const setting = (mkAuto.settings && mkAuto.settings[key]) || {};
    const def = mkAuto.defaults[key] || {};
    mkAuto.editKey = key;
    mkAuto.editDraft = {
      subject: setting.subject || '',
      body: setting.body || '',
      offsetDays: setting.offsetDays !== undefined ? Number(setting.offsetDays) : (def.offsetDays !== undefined ? Number(def.offsetDays) : undefined),
      cap: setting.cap !== undefined ? Number(setting.cap) : (def.cap !== undefined ? Number(def.cap) : undefined),
      reviewUrl: setting.reviewUrl || '',
    };
    if (state.staffEmailsSection !== 'sequences') pv2EmailsGo('sequences');
    else renderStaffEmailsPage();
    pv2ApercuAuto(0);
  };

  // Le texte de depart d une sequence tel que le logiciel l envoie a CE centre
  // (serveur : texteDeDepartDeLaSequence) : le merci post-visite demande un avis
  // des que la fiche Google est donnee.
  function pv2AutoDepart(key, reviewUrl) {
    const def = mkAuto.defaults[key] || {};
    return key === 'post_visit' && String(reviewUrl || '').trim() && def.bodyAvecAvis ? String(def.bodyAvecAvis) : String(def.body || '');
  }

  window.pv2AutoEditField = function (field, value) {
    mkAuto.editDraft[field] = field === 'offsetDays' || field === 'cap' ? Number(value) : value;
    if (field === 'reviewUrl') {
      const champ = document.getElementById('mkAutoBody');
      if (champ) champ.setAttribute('data-placeholder', pv2Humanize(pv2AutoDepart(mkAuto.editKey, value)));
    }
    if (field === 'subject' || field === 'body' || field === 'reviewUrl') pv2ApercuAuto();
  };

  // L apercu vivant d une sequence Pinlane : le brouillon de l editeur OUVERT,
  // jamais sans editeur (« Voir le mail » d une carte fermee reste un rendu du
  // texte en vigueur, et le gate compte ses appels).
  function pv2ApercuAuto(delai = 500) {
    const key = mkAuto.editKey;
    if (!key) return;
    pv2PlanifierApercu('auto', () => (mkAuto.editKey === key ? { ...pv2AutoDraftBody(key), action: 'automationPreview' } : null), delai);
  }

  window.pv2AutoEditSave = async function (key) {
    if (mkAuto.busyKey) return;
    if (typeof canUseStaffPermission === 'function' && !canUseStaffPermission(['settings.manage', 'emails.send'])) { toast('Votre rôle ne permet pas de modifier les séquences.'); return; }
    const def = mkAuto.defaults[key] || {};
    const d = mkAuto.editDraft;
    const body = { action: 'automationSettings', key, centerId: state.adminCenterId || 'libramont' };
    if (String(d.subject || '').trim() && d.subject !== def.subject) body.subject = d.subject;
    if (String(d.body || '').trim() && d.body !== def.body && d.body !== def.bodyAvecAvis) body.body = d.body;
    if (d.offsetDays !== undefined && Number(d.offsetDays) !== Number(def.offsetDays)) body.offsetDays = Number(d.offsetDays);
    if (d.cap !== undefined && Number(d.cap) !== Number(def.cap)) body.cap = Number(d.cap);
    const currentReviewUrl = (mkAuto.settings && mkAuto.settings[key] && mkAuto.settings[key].reviewUrl) || '';
    if (key === 'post_visit' && String(d.reviewUrl || '').trim() !== currentReviewUrl) body.reviewUrl = String(d.reviewUrl || '').trim();
    if (Object.keys(body).length === 3) { toast('Rien à enregistrer, tout est déjà au réglage par défaut.'); return; }
    mkAuto.busyKey = key;
    renderStaffEmailsPage();
    try {
      const payload = await apiRequest('/api/ops', { method: 'POST', body: JSON.stringify(body) });
      mkAuto.settings = payload.settings || mkAuto.settings;
      if (payload.defaults) mkAuto.defaults = payload.defaults;
      mkAuto.editKey = '';
      pv2ApercuAnnuler('auto');
      toast('Séquence personnalisée ✓');
    } catch (error) {
      toast(error.message || 'Enregistrement impossible.');
    } finally {
      mkAuto.busyKey = '';
      renderStaffEmailsPage();
    }
  };

  window.pv2AutoEditReset = async function (key) {
    if (mkAuto.busyKey) return;
    if (typeof canUseStaffPermission === 'function' && !canUseStaffPermission(['settings.manage', 'emails.send'])) { toast('Votre rôle ne permet pas de modifier les séquences.'); return; }
    mkAuto.busyKey = key;
    renderStaffEmailsPage();
    try {
      const payload = await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'automationSettings', key, reset: true, centerId: state.adminCenterId || 'libramont' }),
      });
      mkAuto.settings = payload.settings || mkAuto.settings;
      if (payload.defaults) mkAuto.defaults = payload.defaults;
      mkAuto.editKey = '';
      pv2ApercuAnnuler('auto');
      toast('Séquence remise au modèle d\'origine.');
    } catch (error) {
      toast(error.message || 'Réinitialisation impossible.');
    } finally {
      mkAuto.busyKey = '';
      renderStaffEmailsPage();
    }
  };

  /* ── Aperçu et test : le brouillon EN COURS, rendu par le serveur ────────
     Le corps de l'éditeur part tel quel, non enregistré : la directrice voit
     ce qu'elle est en train d'écrire. Le serveur le valide avec les mêmes
     règles que la sauvegarde, donc un aperçu qui s'affiche est un texte qui
     s'enregistrera. ── */
  function pv2AutoDraftBody(key) {
    // Le brouillon n'est joint QUE si l'éditeur de CETTE séquence est ouvert :
    // « Voir le mail » depuis une carte fermée rend les textes réellement en
    // vigueur, jamais le brouillon d'une autre carte resté en mémoire.
    const d = mkAuto.editKey === key ? mkAuto.editDraft : {};
    const body = { action: '', key, centerId: state.adminCenterId || 'libramont' };
    if (String(d.subject || '').trim()) body.subject = d.subject;
    if (String(d.body || '').trim()) body.body = d.body;
    if (key === 'post_visit' && String(d.reviewUrl || '').trim()) body.reviewUrl = String(d.reviewUrl).trim();
    return body;
  }

  window.pv2AutoPreview = async function (key) {
    if (mkAuto.busyKey) return;
    mkAuto.busyKey = key;
    renderStaffEmailsPage();
    try {
      const payload = await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ ...pv2AutoDraftBody(key), action: 'automationPreview' }),
      });
      // L'overlay iframe sandboxée de la console est réutilisé tel quel : le
      // HTML du mail n'est jamais injecté dans le document de la page.
      previewOpsEmailHtml(payload.html || '', payload.subject || 'Aperçu du mail');
    } catch (error) {
      toast(error.message || 'Aperçu impossible.');
    } finally {
      mkAuto.busyKey = '';
      renderStaffEmailsPage();
    }
  };

  window.pv2AutoSendTest = async function (key) {
    if (mkAuto.busyKey) return;
    if (typeof canUseStaffPermission === 'function' && !canUseStaffPermission('emails.send')) { toast('Votre rôle ne permet pas d’envoyer des mails.'); return; }
    mkAuto.busyKey = key;
    renderStaffEmailsPage();
    try {
      // Aucune adresse n'est envoyée : le serveur envoie au membre connecté.
      const payload = await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ ...pv2AutoDraftBody(key), action: 'sendAutomationTest' }),
      });
      if (payload.status === 'sent') toast(`Test envoyé à ${payload.recipient}`);
      else toast(`Le test n'est pas parti (${payload.error || 'cause inconnue'}).`);
      requestOpsAdminLoad(true);
    } catch (error) {
      toast(error.message || 'Envoi de test impossible.');
    } finally {
      mkAuto.busyKey = '';
      renderStaffEmailsPage();
    }
  };

  // Renvoi d'un mail en échec. Le serveur re-vérifie que la ligne appartient
  // bien au centre courant et qu'elle est bien en échec.
  window.pv2RetryEmail = async function (id) {
    if (!id || pv2Mail.retryingId) return;
    if (typeof canUseStaffPermission === 'function' && !canUseStaffPermission('emails.send')) { toast('Votre rôle ne permet pas d’envoyer des mails.'); return; }
    pv2Mail.retryingId = String(id);
    renderStaffEmailsPage();
    try {
      const payload = await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'retryCommunication', id: Number(id), centerId: state.adminCenterId || 'libramont' }),
      });
      if (payload.status === 'sent') toast('Mail renvoyé ✓');
      else toast(`Toujours pas parti (${payload.error || 'même cause'}).`);
      requestOpsAdminLoad(true);
    } catch (error) {
      toast(error.message || 'Renvoi impossible.');
    } finally {
      pv2Mail.retryingId = '';
      renderStaffEmailsPage();
    }
  };

  function pv2AutoHasOverride(key) {
    const s = mkAuto.settings && mkAuto.settings[key];
    return !!(s && (s.subject || s.body || s.offsetDays !== undefined || s.cap !== undefined || s.reviewUrl));
  }

  window.toggleStaffAutomation = async function (key) {
    if (mkAuto.busyKey || !mkAuto.settings) return;
    if (typeof canUseStaffPermission === 'function' && !canUseStaffPermission(['settings.manage', 'emails.send'])) { toast('Votre rôle ne permet pas de modifier les séquences.'); return; }
    const current = !!(mkAuto.settings[key] && mkAuto.settings[key].enabled);
    mkAuto.busyKey = key;
    renderStaffEmailsPage();
    try {
      const payload = await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'automationSettings', key, enabled: !current, centerId: state.adminCenterId || 'libramont' }),
      });
      mkAuto.settings = payload.settings || mkAuto.settings;
      toast(!current ? 'Séquence activée : elle tourne toute seule.' : 'Séquence désactivée.');
    } catch (error) {
      toast(error.message || 'Impossible de changer la séquence.');
    } finally {
      mkAuto.busyKey = '';
      renderStaffEmailsPage();
    }
  };

  function mkAutoEditor(meta) {
    const def = mkAuto.defaults[meta.key] || {};
    const d = mkAuto.editDraft;
    const busy = mkAuto.busyKey === meta.key;
    const timingSelect = meta.timing ? `
      <label class="mk-auto-edit-field">
        <span>Quand part-il ?</span>
        <select onchange="pv2AutoEditField('offsetDays', this.value)" aria-label="Timing">
          ${meta.timing.options.map((n) => `<option value="${n}"${Number(d.offsetDays) === n ? ' selected' : ''}>${esc(meta.timing.label(n))}</option>`).join('')}
        </select>
      </label>` : '';
    const capSelect = meta.cap ? `
      <label class="mk-auto-edit-field">
        <span>Combien d’envois au plus ?</span>
        <select onchange="pv2AutoEditField('cap', this.value)" aria-label="Plafond hebdomadaire">
          ${meta.cap.options.map((n) => `<option value="${n}"${Number(d.cap) === n ? ' selected' : ''}>${esc(meta.cap.label(n))}</option>`).join('')}
        </select>
      </label>` : '';
    const variables = Array.isArray(def.variables) && def.variables.length
      ? pv2VarBar('mkAutoBody', def.variables)
      : '';
    // Merci post-visite : le mail peut pousser vers la fiche Google du centre
    // (bouton tracké : les clics remontent dans le retour marketing).
    const reviewField = meta.key === 'post_visit' ? `
      <label class="mk-auto-edit-field">
        <span>Lien avis Google <small class="mk-auto-edit-hint">le mail ajoute un bouton « Laissez-nous un avis », et les clics sont comptés</small></span>
        <input value="${esc(d.reviewUrl || '')}" placeholder="https://g.page/r/…" oninput="pv2AutoEditField('reviewUrl', this.value)" aria-label="Lien de la fiche Google">
      </label>` : '';
    // Un corps personnalisé REMPLACE tout le message : le tableau récapitulatif
    // (date, heure, formule, participants) disparaît. C'est le comportement
    // voulu (le texte du gérant EST le message), mais il est contre-intuitif et
    // se paie en appels clients. On le dit avant, plutôt que de le corriger en
    // douce ou de laisser la découverte se faire en production.
    const hasDetails = ['request_received', 'confirmation', 'reminder_48h'].includes(meta.key);
    const warning = hasDetails && String(d.body || '').trim()
      ? `<p class="mk-auto-edit-warn">Votre texte remplace le message entier. Le récapitulatif (date, heure, formule, participants) ne sera plus affiché. Pensez à y remettre les infos utiles, avec les variables ci-dessus.</p>`
      : '';
    // Deux colonnes : les champs, et le mail vivant rendu par le serveur.
    return `<div class="mk-auto-edit em-editeur" data-pv2-mount="autoEditor" data-em-ia-editeur="sequence">
      <div class="mk-auto-edit-fields">
        ${emIaBarHtml('sequence')}
        <div class="mk-auto-edit-field"><span>L’objet du mail</span>
          ${pv2TokeditHtml({ id: 'mkAutoSubject', sink: 'autoSubject', value: d.subject, single: true, plFocus: 'emails.auto.objet', placeholder: def.subject || 'Objet par défaut' })}
        </div>
        <div class="mk-auto-edit-field mk-auto-edit-message"><span>Le message que reçoit le client</span>
          ${variables}
          ${pv2TokeditHtml({ id: 'mkAutoBody', sink: 'autoBody', value: d.body, plFocus: 'emails.auto.message', placeholder: pv2AutoDepart(meta.key, d.reviewUrl) || 'Message par défaut' })}
        </div>
        ${timingSelect}
        ${capSelect}
        ${reviewField}
        ${warning}
      </div>
      ${pv2ApercuVivantHtml('auto', { titre: 'Aperçu avec une réservation d\'exemple', telephone: true })}
      <div class="mk-auto-edit-actions em-actions">
        <button type="button" class="em-lien" onclick="pv2AutoEdit('${meta.key}')">Annuler</button>
        <button type="button" class="em-lien" onclick="pv2AutoPreview('${meta.key}')" ${busy ? 'disabled' : ''}>Voir le mail en grand</button>
        ${typeof canUseStaffPermission !== 'function' || canUseStaffPermission('emails.send') ? `<button type="button" class="em-lien" onclick="pv2AutoSendTest('${meta.key}')" ${busy ? 'disabled' : ''}>M'envoyer un test</button>` : ''}
        ${emMenuPlusHtml(`emAutoPlus${meta.key}`, `Plus d’actions pour ${meta.label}`, [emGestePlus('Revenir aux réglages de Pinlane', `pv2AutoEditReset('${meta.key}')`, { danger: true, inactif: busy })])}
        <span class="pv2-composer-spacer"></span>
        <button type="button" class="pv2-btn primary em-principal" onclick="pv2AutoEditSave('${meta.key}')" ${busy ? 'disabled' : ''}>${busy ? 'Enregistrement…' : 'Enregistrer'}</button>
      </div>
    </div>`;
  }

  // Le texte EFFECTIF d une sequence Pinlane : celui du gerant s il en a ecrit
  // un, sinon le texte d usine servi par le serveur. Jamais un blurb code en
  // dur : c est ce que le client recoit.
  function mkAutoTexteEffectif(key) {
    const setting = (mkAuto.settings && mkAuto.settings[key]) || {};
    const def = mkAuto.defaults[key] || {};
    return {
      subject: String(setting.subject || def.subject || ''),
      body: String(setting.body || def.body || ''),
      connu: Boolean(setting.subject || setting.body || def.subject || def.body),
    };
  }

  // La phrase de declenchement telle qu elle s applique VRAIMENT (timing du
  // reglage, sinon celui d usine), pas la description generique.
  function mkAutoPhraseDeclenchement(meta) {
    const setting = (mkAuto.settings && mkAuto.settings[meta.key]) || {};
    const def = mkAuto.defaults[meta.key] || {};
    if (meta.timing) {
      const n = setting.offsetDays !== undefined ? Number(setting.offsetDays) : (def.offsetDays !== undefined ? Number(def.offsetDays) : undefined);
      if (Number.isFinite(n)) { const phrase = meta.timing.label(n); return phrase.charAt(0).toUpperCase() + phrase.slice(1); }
    }
    if (meta.cap) {
      const n = setting.cap !== undefined ? Number(setting.cap) : (def.cap !== undefined ? Number(def.cap) : undefined);
      if (Number.isFinite(n)) return `${meta.desc} ${meta.cap.label(n)}.`;
    }
    return meta.desc;
  }

  // UNE LIGNE PAR SEQUENCE (2026-11-10) : son nom, quand elle part dite en une
  // phrase, ses chiffres des 30 derniers jours (les echecs en rouge) et son
  // interrupteur. « Modifier » ouvre l editeur sous la ligne.
  function mkAutoCard(meta, cascade) {
    const setting = mkAuto.settings ? mkAuto.settings[meta.key] : null;
    const enabled = !!(setting && setting.enabled);
    const stats = mkAuto.stats[meta.key] || {};
    const busy = mkAuto.busyKey === meta.key;
    const editing = mkAuto.editKey === meta.key;
    const modified = pv2AutoHasOverride(meta.key);
    // automationSettings (ecriture) : settings.manage ou emails.send. Sans
    // droit d ecrire, l etat se lit en texte a la place de l interrupteur.
    const regler = typeof canUseStaffPermission !== 'function' || canUseStaffPermission(['settings.manage', 'emails.send']);
    // NBSP entre un nombre et son unite : un nombre ne se lit pas sans elle.
    const sent30 = Number(stats.sent30d) || 0;
    const failed30 = Number(stats.failed30d) || 0;
    const NB = '\u00a0';
    const statsTxt = `${sent30}${NB}envoyé${sent30 > 1 ? 's' : ''}${failed30 ? ` · <span class="mk-auto-fail">${failed30}${NB}échec${failed30 > 1 ? 's' : ''}</span>` : ''} sur 30${NB}jours`;
    return `<article class="mk-auto em-seqrow${enabled ? ' is-on' : ''}${editing ? ' is-editing' : ''}"${cascade ? emEntree(`sequences:${meta.key}`, cascade) : ''}>
      <div class="em-seqrow-ligne">
        <div class="mk-auto-head em-seqrow-nom">
          <strong>${esc(meta.label)}${modified ? '<span class="mk-auto-mod">modifié</span>' : ''}</strong>
          <span class="mk-auto-desc">${esc(emSeqPhrase(meta))}</span>
        </div>
        <span class="mk-auto-stats">${statsTxt}</span>
        <div class="mk-auto-actions">
          <button type="button" class="em-lien mk-auto-preview" onclick="pv2AutoPreview('${meta.key}')" ${busy ? 'disabled' : ''}>Voir le mail</button>
          ${regler ? `<button type="button" class="em-lien mk-auto-edit-btn" onclick="pv2AutoEdit('${meta.key}')" aria-expanded="${editing}">${editing ? 'Fermer' : 'Modifier'}</button>` : ''}
        </div>
        ${regler
          ? `<button type="button" class="mk-switch${enabled ? ' is-on' : ''}" data-switch-key="auto:${esc(meta.key)}" role="switch" aria-checked="${enabled}" aria-label="${esc(meta.label)}" onclick="toggleStaffAutomation('${meta.key}')" ${busy || !mkAuto.settings ? 'disabled' : ''}><span></span></button>`
          : `<span class="em-seq-etat">${enabled ? 'Activée' : 'Désactivée'}</span>`}
      </div>
      ${editing ? mkAutoEditor(meta) : ''}
    </article>`;
  }

  // Quand part une sequence Pinlane, avec le reglage du centre, en une phrase.
  function emSeqPhrase(meta) {
    const setting = (mkAuto.settings && mkAuto.settings[meta.key]) || {};
    const def = mkAuto.defaults[meta.key] || {};
    const valeur = (k) => (setting[k] !== undefined ? Number(setting[k]) : (def[k] !== undefined ? Number(def[k]) : NaN));
    const n = valeur('offsetDays');
    const cap = valeur('cap');
    const jours = (x) => `${x}\u00a0jour${x > 1 ? 's' : ''}`;
    if (meta.key === 'request_received') return 'Part dès qu’une demande arrive en validation.';
    if (meta.key === 'confirmation') return 'Part dès que la réservation est validée.';
    if (meta.key === 'reminder_48h') return Number.isFinite(n) ? `Part ${jours(n)} avant la venue.` : 'Part quelques jours avant la venue.';
    if (meta.key === 'post_visit') return Number.isFinite(n) ? (n === 0 ? 'Part le jour même, après la visite.' : `Part ${jours(n)} après la visite.`) : 'Part après la visite.';
    if (meta.key === 'birthday_j30') return Number.isFinite(n) ? `Part ${jours(n)} avant la date anniversaire.` : 'Part avant la date anniversaire.';
    if (meta.key === 'reactivation') return `Part aux clients fidèles plus vus depuis 2 à 3 mois${Number.isFinite(cap) ? `, ${cap} envois au plus par semaine` : ''}.`;
    return mkAutoPhraseDeclenchement(meta);
  }

  // Quand part une sequence du centre, en une phrase.
  function emSeqPersoPhrase(sequence) {
    const t = sequence.trigger || {};
    const segments = (pv2Seq.limits && pv2Seq.limits.segments) || {};
    const qui = String(segments[sequence.segment] || 'tous les clients').toLowerCase();
    const cap = Number(sequence.cap) || 0;
    const fin = cap ? `, ${cap} envois au plus` : '';
    const jours = (x) => `${Number(x) || 0}\u00a0jour${Number(x) > 1 ? 's' : ''}`;
    if (t.type === 'after_visit') return `Part ${jours(t.days)} après une visite${fin}.`;
    if (t.type === 'before_visit') return `Part ${jours(t.days)} avant une venue${fin}.`;
    if (t.type === 'inactive') return `Part aux clients plus vus depuis ${jours(t.days)}${fin}.`;
    if (t.type === 'weekly') return `Part chaque ${PV2_WEEKDAYS[t.weekday] || 'semaine'}, à ${qui}${fin}.`;
    if (t.type === 'monthly') return `Part le ${Number(t.monthday) || 1} de chaque mois, à ${qui}${fin}.`;
    return 'Part selon son déclencheur.';
  }

  function pv2IsInbound(row) {
    return row.direction === 'inbound' || row.status === 'received';
  }

  // La GALERIE de modèles : des cartes lisibles groupées par moment commercial
  // (fini le select natif que chaque re-rendu refermait). Chaque carte montre
  // l'objet et le début du texte, variables en jetons.
  function pv2TplPickerPanel(d, ctx) {
    const card = (ref, name, subject, body, origin) => `
      <button type="button" class="pv2-tpl-card${d.templateRef === ref ? ' is-active' : ''}" onclick="pv2ComposerTemplate('${escJs(ref)}')">
        <span class="pv2-tpl-name">${esc(name)}${origin ? `<em class="pv2-tpl-origin">${esc(origin)}</em>` : ''}</span>
        <span class="pv2-tpl-subject">${pv2RenderEmailPreview(subject, ctx).replace(/^<p>|<\/p>$/g, '')}</span>
        <span class="pv2-tpl-body">${pv2RenderEmailPreview(String(body || '').split('\n').filter(Boolean).slice(0, 2).join(' '), ctx).replace(/^<p>|<\/p>$/g, '')}</span>
      </button>`;
    const groups = [];
    for (const s of PV2_STARTERS) {
      let g = groups.find((x) => x.label === s.cat);
      if (!g) { g = { label: s.cat, cards: [] }; groups.push(g); }
      g.cards.push(card(`starter:${s.key}`, s.name, s.subject, s.body, ''));
    }
    if (pv2Mail.templates.length) {
      groups.push({ label: 'Vos modèles', cards: pv2Mail.templates.map((t) => card(`tpl:${t.id}`, t.label || t.name || `Modèle ${t.id}`, t.subject || '', t.body || '', 'maison')) });
    }
    return `<div class="pv2-tpl-picker" id="pv2TplPicker">
      ${groups.map((g) => `<div class="pv2-tpl-group"><h4>${esc(g.label)}</h4><div class="pv2-tpl-grid">${g.cards.join('')}</div></div>`).join('')}
      <div class="pv2-tpl-foot"><button type="button" class="mkw-link" onclick="pv2ComposerTemplate('')">Partir de zéro</button></div>
    </div>`;
  }

  function pv2ComposerPanel() {
    const d = pv2Mail.draft;
    if (!pv2Mail.metaLoaded && !pv2Mail.metaLoading) setTimeout(() => loadPv2MailMeta(), 0);
    const identityOptions = pv2Mail.identities.length
      ? pv2Mail.identities.map((i) => `<option value="${esc(String(i.id))}"${String(i.id) === String(d.identityId) ? ' selected' : ''}>${esc(i.label || i.email)}, ${esc(i.email)}</option>`).join('')
      : `<option value="">${pv2Mail.metaLoading ? 'Chargement des adresses…' : 'Expéditeur par défaut'}</option>`;
    const currentTpl = (() => {
      const ref = String(d.templateRef || '');
      if (ref.startsWith('starter:')) { const s = PV2_STARTERS.find((x) => `starter:${x.key}` === ref); return s ? s.name : ''; }
      if (ref.startsWith('tpl:')) { const t = pv2Mail.templates.find((x) => `tpl:${x.id}` === ref); return t ? (t.label || t.name || '') : ''; }
      return '';
    })();
    const unresolved = pv2DraftUnresolved(d);
    const missName = !d.name && unresolved.some((k) => k === 'prenom' || k === 'nom');
    const ctx = pv2VarContext(d);
    const identity = pv2Mail.identities.find((i) => String(i.id) === String(d.identityId)) || pv2Mail.identities[0] || null;
    const fromLine = identity ? `${identity.label || identity.email} <${identity.email}>` : 'expéditeur par défaut';
    const toLine = d.to ? `${d.name ? `${d.name} ` : ''}<${d.to}>` : 'choisissez un client';
    // TROIS CHAMPS, UNE CASE OU ECRIRE, UN BOUTON (2026-11-11, lot S) : a qui,
    // l objet, puis le message en grand avec l aide juste dessous. L expediteur,
    // l envoi programme et l apercu en direct ont un bon defaut : ils attendent
    // dans « Plus d options ». Un modele se choisit depuis le titre du message.
    return `<section class="pv2-panel pv2-composer" role="dialog" aria-modal="true" aria-label="Nouveau message" data-em-ia-editeur="message">
      <div class="pv2-panel-head">
        <div><h2>${d.replyTo ? 'Répondre' : 'Nouveau message'}</h2></div>
        <button type="button" class="em-lien" onclick="pv2CloseComposer()">Fermer</button>
      </div>
      <div class="pv2-panel-body pv2-composer-grid">
        <div class="pv2-composer-field pv2-composer-to pv2-composer-wide"><span id="pv2ComboLabel">À qui écrivez-vous ?</span>
          <div class="pv2-combo">
            <input id="pv2ComposerTo" role="combobox" aria-expanded="false" aria-autocomplete="list" aria-controls="pv2ComboList" aria-labelledby="pv2ComboLabel"
              data-pl-focus="emails.composer.to" value="${esc(d.to)}" placeholder="Nom, téléphone ou début d'adresse…"
              autocomplete="one-time-code" name="pv2-recherche-client" spellcheck="false"
              oninput="pv2ComboInput(this.value)" onfocus="pv2ComboFocus()" onblur="pv2ComboBlur()" onkeydown="pv2ComboKey(event)">
            <div class="pv2-combo-list" id="pv2ComboList" role="listbox" aria-label="Clients correspondants" hidden></div>
          </div>
        </div>
        <div class="pv2-composer-field pv2-composer-wide"><span>Objet</span>
          ${pv2TokeditHtml({ id: 'pv2ComposerSubject', sink: 'composerSubject', value: d.subject, single: true, plFocus: 'emails.composer.objet', placeholder: 'Ce que le client lit en premier' })}
        </div>
        <div class="pv2-composer-field pv2-composer-wide em-message">
          <div class="em-message-tete">
            <span id="pv2ComposerMessageTitre">${d.name ? `Votre message à ${esc(d.name)}` : 'Votre message'}</span>
            <button type="button" class="pv2-tpl-toggle em-lien${pv2Mail.pickerOpen ? ' is-open' : ''}" aria-expanded="${pv2Mail.pickerOpen}" aria-controls="pv2TplPicker" onclick="pv2TogglePicker()">
              <span>${currentTpl ? `Modèle ${esc(currentTpl)}` : 'Partir d’un modèle'}</span>${ci('chevronDown')}
            </button>
          </div>
          ${pv2Mail.pickerOpen ? pv2TplPickerPanel(d, ctx) : ''}
          <div class="pv2-toolbar" role="toolbar" aria-label="Mise en forme">
            <button type="button" class="pv2-tool" title="Gras" aria-label="Gras" onclick="pv2ApplyMarker('bold')"><strong>G</strong></button>
            <button type="button" class="pv2-tool" title="Italique" aria-label="Italique" onclick="pv2ApplyMarker('italic')"><em>I</em></button>
            <button type="button" class="pv2-tool" title="Liste à puces" aria-label="Liste à puces" onclick="pv2ApplyMarker('list')">•&#8201;•</button>
            <button type="button" class="pv2-tool" title="Lien" aria-label="Insérer un lien" onclick="pv2ApplyMarker('link')">Lien</button>
            <button type="button" class="pv2-tool" title="Bouton d'action dans le mail" aria-label="Insérer un bouton" onclick="pv2ApplyMarker('button')">Bouton</button>
            <span class="pv2-toolbar-sep" aria-hidden="true"></span>
            ${Object.entries(PV2_VAR_LABELS).map(([key, label]) => `<button type="button" class="pv2-tool pv2-tool-var" title="Insérer ${esc(label)}" onclick="pv2InsertVarAt('pv2ComposerBody', '${key}')">${esc(label)}</button>`).join('')}
          </div>
          ${pv2TokeditHtml({ id: 'pv2ComposerBody', sink: 'composerBody', value: d.body, plFocus: 'emails.composer.message', placeholder: 'Écrivez votre message ici, ou dites à l’assistant juste dessous ce qu’il doit écrire.', labelledby: 'pv2ComposerMessageTitre' })}
          <p class="pv2-vars-hint" id="pv2ComposerVarsHint" ${unresolved.length ? '' : 'hidden'}>${unresolved.length ? `À compléter avant l'envoi : ${unresolved.map((k) => `<code>{{${esc(k)}}}</code>`).join(' ')}${missName ? ' <span>(choisissez un client pour remplir le prénom)</span>' : ''}` : ''}</p>
        </div>
        <div class="pv2-composer-wide">${emIaBarHtml('message')}</div>
        <details class="em-options pv2-composer-wide"${pv2Mail.optionsOuvertes ? ' open' : ''} ontoggle="pv2Mail.optionsOuvertes = this.open">
          <summary>Plus d’options<span>expéditeur, envoi programmé, aperçu</span></summary>
          <div class="em-options-corps pv2-composer-grid">
            <label class="pv2-composer-field"><span>Expéditeur</span>
              <select onchange="pv2ComposerField('identityId', this.value); pv2ComposerSyncHints();" aria-label="Adresse d'envoi">${identityOptions}</select>
            </label>
            <div class="pv2-composer-field pv2-composer-when"><span>Envoi</span>
              <div class="pv2-composer-when-row">
                <select onchange="pv2ComposerField('when', this.value); pv2RenderComposer();" aria-label="Moment d'envoi">
                  <option value="now"${d.when !== 'later' ? ' selected' : ''}>Maintenant</option>
                  <option value="later"${d.when === 'later' ? ' selected' : ''}>Programmer</option>
                </select>
                ${d.when === 'later' ? `<input type="datetime-local" value="${esc(d.scheduledAt)}" aria-label="Date et heure d'envoi" onchange="pv2ComposerField('scheduledAt', this.value)">` : ''}
              </div>
            </div>
            <div class="pv2-composer-wide">
              <p class="em-options-titre">Aperçu en direct</p>
              <div class="pv2-mail-paper">
                <div class="pv2-mail-paper-subject" id="pv2PreviewSubject">${pv2RenderEmailPreview(d.subject, ctx).replace(/^<p>|<\/p>$/g, '') || '<span class="pv2-preview-empty">Objet du message</span>'}</div>
                <div class="pv2-mail-paper-meta" id="pv2PreviewMeta"><span><b>De</b> ${esc(fromLine)}</span><span><b>À</b> ${esc(toLine)}</span></div>
                <div class="pv2-mail-render" id="pv2ComposerPreview" aria-label="Aperçu du message">${pv2RenderEmailPreview(d.body, ctx) || '<p class="pv2-preview-empty">L\'aperçu du message s\'affiche ici pendant que vous écrivez.</p>'}</div>
              </div>
            </div>
          </div>
        </details>
        <div class="pv2-composer-actions pv2-composer-wide em-actions">
          <button type="button" class="em-lien" onclick="pv2ComposerServerPreview()">Voir le mail final</button>
          ${typeof canUseStaffPermission !== 'function' || canUseStaffPermission('campaigns.manage') ? '<button type="button" class="em-lien" onclick="pv2ComposerSaveAsTemplate()">Garder en modèle</button>' : ''}
          <span class="pv2-composer-spacer"></span>
          <button type="button" class="em-lien" onclick="pv2CloseComposer()">Annuler</button>
          <button type="button" class="pv2-btn primary em-principal" onclick="pv2ComposerSend()" ${pv2Mail.busy ? 'disabled' : ''}>${ci('send')}${pv2Mail.busy ? 'Envoi…' : 'Envoyer'}</button>
        </div>
      </div>
    </section>`;
  }

  function pv2AnalyzePanel() {
    return `<section class="pv2-panel pv2-analyze" data-pv2-mount="analyze" aria-label="Coller un mail reçu">
      <div class="pv2-panel-head has-sub">
        <div><h2>Coller un mail reçu</h2><p class="pv2-panel-sub">Collez un mail reçu dans votre boîte. L'agent dit ce que veut le client et prépare la réponse.</p></div>
        <button type="button" class="em-lien" onclick="pv2OpenAnalyze()">Fermer</button>
      </div>
      <div class="pv2-panel-body pv2-composer-grid">
        <label class="pv2-composer-field pv2-composer-wide"><span>L’adresse du client</span>
          <input id="pv2AnalyzeFrom" data-pl-focus="emails.analyse.de" value="${esc(pv2Mail.analyzeDraft.from)}" placeholder="client@exemple.be" oninput="pv2AnalyzeField('from', this.value)">
        </label>
        <label class="pv2-composer-field pv2-composer-wide"><span>Le mail que le client vous a envoyé</span>
          <textarea class="pv2-analyze-texte" rows="8" data-pl-focus="emails.analyse.texte" placeholder="Collez ici le mail tel que vous l’avez reçu." oninput="pv2AnalyzeField('body', this.value)">${esc(pv2Mail.analyzeDraft.body)}</textarea>
        </label>
        <div class="pv2-composer-actions pv2-composer-wide em-actions">
          <button type="button" class="pv2-btn primary em-principal" onclick="pv2AnalyzeSubmit()" ${pv2Mail.analyzeBusy ? 'disabled' : ''}>${ci('sparkles')}${pv2Mail.analyzeBusy ? 'Analyse…' : 'Analyser'}</button>
        </div>
      </div>
    </section>`;
  }

  /* ── LE MAIL RECU, LU COMME UN MAIL ──────────────────────────────────────
     Avant : le texte brut du mail etait jete dans un cadre a defilement, avec
     ses chevrons de citation. Sur un « Ok », ca donnait trois ecrans de fil
     recopie pour deux lettres de contenu, et le message se perdait dedans.

     Maintenant : qui ecrit et quand, en tete ; le message seul, en grand ; et
     la citation repliee derriere un bouton, comme dans une vraie messagerie.
     Ce n est pas une preference de style : la question du client etait
     INTROUVABLE dans l ecran precedent. ─────────────────────────────────── */
  function pv2InitialeDe(nom, adresse) {
    const source = String(nom || adresse || '?').trim();
    const lettre = source.replace(/^[^\p{L}\p{N}]+/u, '').charAt(0);
    return (lettre || '?').toUpperCase();
  }

  function pv2SeparerLeMail(texte) {
    const outil = typeof window !== 'undefined' && window.PinlaneEmailThread;
    if (!outil || typeof outil.separerCitation !== 'function') {
      // Sans la regle chargee, on montre TOUT plutot que rien : un mail
      // illisible reste preferable a un mail absent.
      return { message: String(texte || ''), historique: '' };
    }
    return outil.separerCitation(texte);
  }

  // LES LIENS D UN MAIL SE CLIQUENT (2026-11-12) : une adresse web du texte
  // devient un lien qui s ouvre dans un autre onglet, sans rien transmettre de
  // la console. Seuls http et https passent ; le reste reste du texte.
  const PV2_LIEN_WEB = /https?:\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?)\]}]/g;
  function pv2TexteAvecLiens(texte) {
    const brut = String(texte || '');
    let out = '';
    let dernier = 0;
    PV2_LIEN_WEB.lastIndex = 0;
    let trouve = PV2_LIEN_WEB.exec(brut);
    while (trouve) {
      out += esc(brut.slice(dernier, trouve.index));
      out += `<a href="${esc(trouve[0])}" target="_blank" rel="noopener noreferrer">${esc(trouve[0])}</a>`;
      dernier = trouve.index + trouve[0].length;
      trouve = PV2_LIEN_WEB.exec(brut);
    }
    return out + esc(brut.slice(dernier));
  }

  function pv2Paragraphes(texte) {
    const propre = String(texte || '').replace(/\r\n/g, '\n').trim();
    if (!propre) return '<p class="pv2-mail-vide">Ce message n a pas de contenu.</p>';
    return propre
      .split(/\n{2,}/)
      .map((bloc) => `<p>${bloc.split('\n').map(pv2TexteAvecLiens).join('<br>')}</p>`)
      .join('');
  }

  // Un mail du formulaire du site : chaque question et sa reponse sur sa ligne
  // (assets/email-thread.js champsDuFormulaire), au lieu d un bloc de mots.
  function pv2ChampsDuFormulaire(texte) {
    const outil = typeof window !== 'undefined' && window.PinlaneEmailThread;
    if (!outil || typeof outil.champsDuFormulaire !== 'function') return null;
    return outil.champsDuFormulaire(texte);
  }
  function pv2ChampsHtml(form) {
    return `${form.intro ? pv2Paragraphes(form.intro) : ''}
      <dl class="pv2-mail-champs">${form.champs.map((c) => `<div class="pv2-mail-champ"><dt>${esc(c.question)}</dt><dd>${String(c.valeur).split('\n').map(pv2TexteAvecLiens).join('<br>')}</dd></div>`).join('')}</dl>
      ${form.fin ? pv2Paragraphes(form.fin) : ''}`;
  }

  function pv2EnteteMail(row) {
    const adresse = String(row.payload?.from || row.recipient || '').trim();
    const nom = String(row.payload?.fromName || '').trim();
    const quand = formatOpsTimestamp(row.receivedAt || row.payload?.receivedAt || row.createdAt || row.scheduledAt) || '';
    const repondu = Boolean(row.payload && (row.payload.replyCommunicationId || row.payload.repliedAt));
    return `
      <div class="pv2-mail-entete">
        <div class="pv2-mail-pastille" aria-hidden="true">${esc(pv2InitialeDe(nom, adresse))}</div>
        <div class="pv2-mail-identite">
          <div class="pv2-mail-ligne">
            <strong>${esc(nom || adresse || 'Expéditeur inconnu')}</strong>
            ${repondu ? '<span class="pv2-mail-repondu">Répondu</span>' : ''}
            <span class="pv2-mail-quand">${esc(quand)}</span>
          </div>
          ${nom && adresse ? `<div class="pv2-mail-adresse">${esc(adresse)}</div>` : ''}
        </div>
      </div>`;
  }

  function pv2CorpsMail(row) {
    const brut = String(row.payload?.textBody || row.body || row.subject || '');
    const { message, historique } = pv2SeparerLeMail(brut);
    const ouvert = Boolean(pv2Mail.historiqueOuvert[row.uid]);
    const outil = typeof window !== 'undefined' && window.PinlaneEmailThread;
    const historiqueLu = historique && outil && typeof outil.historiqueLisible === 'function'
      ? outil.historiqueLisible(historique)
      : historique;
    const form = pv2ChampsDuFormulaire(message);
    return `
      <div class="pv2-mail-corps${form ? ' est-formulaire' : ''}">
        ${form ? pv2ChampsHtml(form) : pv2Paragraphes(message)}
        ${historique ? `
          <button type="button" class="pv2-mail-plus${ouvert ? ' est-ouvert' : ''}"
            onclick="pv2BasculerHistorique('${escJs(row.uid)}')"
            aria-expanded="${ouvert}"
            title="${ouvert ? 'Masquer' : 'Afficher'} le reste de la conversation">•••</button>
          ${ouvert ? `<div class="pv2-mail-historique">${pv2Paragraphes(historiqueLu)}</div>` : ''}
        ` : ''}
      </div>`;
  }

  window.pv2BasculerHistorique = function (uid) {
    pv2Mail.historiqueOuvert[uid] = !pv2Mail.historiqueOuvert[uid];
    renderStaffEmailsPage();
  };

  /* ── L APPRENTISSAGE DE L AGENT ─────────────────────────────────────────────
     « L IA ne sait pas, donc il doit y avoir une section apprentissage : quand
     elle ne sait pas, elle pose la question, on y repond, et l agent le sait
     pour toutes les prochaines fois. »

     Le declencheur est un aveu, pas une erreur : quand un message ne rentre
     dans aucun sujet connu, la reponse proposee devient une pirouette du genre
     « appelez-nous ». Mesure du 2026-09-06 sur un vrai mail : « est-ce que je
     peux amener mon propre gateau ? » a produit exactement ca.

     REFAIT LE 2026-09-24 (Movsar : « une meilleure interface, question
     reponse, on voit un suivi, on voit vraiment qu il apprend, et il change
     direct la reponse client qu il avait proposee »). Une question a la fois,
     avec le message du client sous les yeux ; apprendre montre la reponse
     proposee AVANT et APRES, puis l agent relit les questions proches que ce
     fait peut resoudre ; le suivi compte ce qu il sait et ce qu il a resolu ;
     sa memoire se relit, se cherche, se corrige et s oublie ; et on peut lui
     apprendre quelque chose sans attendre qu un client le demande. ────────── */
  // La longueur qu un fait appris peut avoir : celle que le serveur accepte
  // (APPRIS_LIMITS.reponse, lib/email-agent.js). Au-dela il refuse ; l ecran
  // le dit AVANT l envoi, en comptant.
  const PV2_SAVOIR_MAX = 2000;
  function pv2CompteSavoir(texte) {
    const n = String(texte || '').trim().length;
    return n > PV2_SAVOIR_MAX ? `${n} / ${PV2_SAVOIR_MAX} : trop long, gardez l’essentiel` : `${n} / ${PV2_SAVOIR_MAX}`;
  }
  function pv2SavoirDonnees() {
    const c = (typeof opsAdminCache === 'object' && opsAdminCache) || {};
    const questions = c.questions || [];
    const appris = c.appris || [];
    const suivi = c.suivi || { faits: appris.length, questions: questions.length, resolues: 0, semaine: 0 };
    return { questions, appris, suivi };
  }
  // Le suivi suit l ecran sans attendre la relecture complete : recompte sur la
  // memoire que le serveur vient de renvoyer (meme calcul que lui, api/ops.js
  // agentQuestions), les questions resolues en moins.
  function pv2SavoirRecompte(appris, resoluesIci) {
    if (typeof opsAdminCache !== 'object' || !opsAdminCache) return;
    const s = opsAdminCache.suivi || {};
    const depuis = Date.now() - 7 * 86400000;
    opsAdminCache.appris = appris;
    opsAdminCache.suivi = {
      faits: appris.length,
      questions: Math.max(0, (Number(s.questions) || (opsAdminCache.questions || []).length) - resoluesIci),
      resolues: appris.reduce((n, f) => n + (Number(f.resolues) || 0), 0),
      semaine: appris.filter((f) => Date.parse(f.le || '') >= depuis).length,
      corrections: Number(s.corrections) || 0,
    };
  }
  function pv2DateCourte(iso) {
    const d = iso ? new Date(iso) : null;
    return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('fr-BE', { day: 'numeric', month: 'long' }) : '';
  }
  const pv2Pluriel = (n, mot, mots) => `${n} ${n > 1 ? mots : mot}`;
  // Le droit d apprendre est celui que le serveur exige (api/ops.js,
  // emails.send) : sans lui, les cases et les boutons n existent pas
  // (DESIGN.md regle 9), la memoire reste lisible.
  const pv2PeutApprendre = () => typeof canUseStaffPermission !== 'function' || canUseStaffPermission('emails.send');
  // CE QU IL A APPRIS, EN UNE PHRASE (2026-11-11) : la rangee de tuiles
  // (faits appris, en attente, resolues, cette semaine) repetait la phrase du
  // dessus et le compte de l en-tete. « En attente » reste dans l en-tete, les
  // questions resolues sous la jauge ; les faits et la semaine passent ici.
  function pv2SavoirAppris(suivi) {
    const faits = Number(suivi.faits) || 0;
    const semaine = Math.min(Number(suivi.semaine) || 0, faits);
    if (!faits) return 'Il n’a encore rien appris.';
    const total = pv2Pluriel(faits, 'fait', 'faits');
    if (!semaine) return `Il a appris ${total}.`;
    return semaine === faits ? `Il a appris ${total} cette semaine.` : `Il a appris ${total}, dont ${semaine} cette semaine.`;
  }
  // LE SUIVI : les questions de clients resolues sur toutes celles posees (la
  // jauge et sa phrase), puis, dans L agent, ce qu il a appris et les
  // corrections qu il retient, en phrases.
  // apercu : la jauge et sa phrase seulement (2026-11-10).
  function pv2SavoirSuivi(suivi, { apercu = false } = {}) {
    const resolues = Number(suivi.resolues) || 0;
    const total = resolues + (Number(suivi.questions) || 0);
    const part = total ? Math.round((resolues / total) * 100) : 100;
    const libelle = total
      ? `${pv2Pluriel(resolues, 'question résolue', 'questions résolues')} sur ${total} posées par des clients`
      : 'Aucune question de client pour l’instant';
    return `<div class="pv2-savoir-suivi">
        <div class="pv2-savoir-jauge" role="img" aria-label="${esc(libelle)}"><span style="width:${part}%"></span></div>
        <p class="pv2-savoir-jauge-texte">${esc(libelle)}</p>
        ${apercu ? '' : `<p class="pv2-savoir-jauge-texte pv2-savoir-faits">${esc(pv2SavoirAppris(suivi))}</p>${Number(suivi.corrections) > 0 ? `<p class="pv2-savoir-jauge-texte pv2-savoir-corrections">Il retient aussi vos corrections, ${pv2Pluriel(Number(suivi.corrections), 'réponse corrigée avant envoi', 'réponses corrigées avant envoi')}.</p>` : ''}`}
      </div>`;
  }
  // LA CASE OU L ON REPOND, son compteur et son bouton. `libelle` : Apprendre
  // (une question, un fait nouveau) ou Enregistrer (une correction).
  function pv2SavoirChamp(cle, brouillon, etiquette, placeholder, libelle = 'Apprendre') {
    const texte = String(brouillon || '').trim();
    const trop = texte.length > PV2_SAVOIR_MAX;
    const sujetManquant = cle === 'nouveau' && !String((pv2Mail.nouveauFait || {}).question || '').trim();
    const occupe = pv2Mail.apprentissageBusy === cle;
    // La case dit en une phrase ce qu on y ecrit (lot S). Une correction n en
    // a pas besoin : le fait corrige est ecrit juste au-dessus.
    return `${cle.startsWith('fait-') ? '' : `<p class="pv2-savoir-libelle">${esc(etiquette)}</p>`}<textarea class="pv2-savoir-reponse" rows="3" placeholder="${esc(placeholder)}"
            aria-label="${esc(etiquette)}" aria-describedby="pv2-savoir-compte-${esc(cle)}" data-pl-focus="emails.savoir.${esc(cle)}"
            oninput="pv2SavoirBrouillon('${escJs(cle)}', this.value, this)" onkeydown="pv2SavoirClavier(event)">${esc(brouillon)}</textarea>
          <div class="pv2-savoir-actions">
            <span class="pv2-savoir-compteur${trop ? ' is-trop' : ''}" id="pv2-savoir-compte-${esc(cle)}">${esc(pv2CompteSavoir(brouillon))}</span>
            <span class="pv2-savoir-astuce" aria-hidden="true">Ctrl + Entrée</span>
            <button type="button" class="pv2-btn sm primary pv2-savoir-apprendre" aria-keyshortcuts="Control+Enter" ${occupe || !texte || trop || sujetManquant ? 'disabled' : ''}
              onclick="pv2ApprendreLaReponse('${escJs(cle)}')">${occupe ? (libelle === 'Enregistrer' ? 'Enregistrement…' : 'Apprentissage…') : libelle}</button>
          </div>`;
  }
  // UNE QUESTION A LA FOIS : la question, qui l a posee et a propos de quoi,
  // le debut du message du client (on repond mieux en le lisant), la case.
  function pv2SavoirCarte(q, rang, total) {
    const cle = String(q.communicationId);
    const quand = pv2DateCourte(q.recuLe);
    const extrait = String(q.extrait || '').trim();
    return `
      <article class="pv2-savoir-carte" data-savoir="${esc(cle)}">
        <div class="pv2-savoir-rang"><span>Question ${rang} sur ${total}</span>
          ${total > 1 ? '<button type="button" class="pv2-link-btn pv2-savoir-passer" onclick="pv2SavoirPasser()">Passer</button>' : ''}
        </div>
        <p class="pv2-savoir-question">${esc(q.question)}</p>
        <p class="pv2-savoir-origine">Demandé par ${esc(q.mailDe || 'un client')}${q.mailSujet ? `, à propos de « ${esc(String(q.mailSujet).slice(0, 70))} »` : ''}${quand ? `, le ${esc(quand)}` : ''}</p>
        ${extrait ? `<blockquote class="pv2-savoir-extrait">${esc(extrait)}${extrait.length >= 300 ? '…' : ''}</blockquote>` : ''}
        ${pv2PeutApprendre()
          ? pv2SavoirChamp(cle, pv2Mail.reponsesApprises[cle] || '', 'Ce que l’agent doit retenir', 'Répondez une fois, et l’agent le saura pour tous les prochains messages.')
          : '<p class="pv2-savoir-vide">Lui répondre engage tous les messages suivants. C’est réservé à qui envoie les e-mails ou à la direction.</p>'}
        ${pv2Mail.apprentissageBusy === cle ? '<p class="pv2-savoir-relit" role="status">L’agent retient votre réponse et refait la sienne…</p>' : ''}
      </article>`;
  }
  // CE QUE L APPRENTISSAGE A CHANGE : le fait retenu, la reponse proposee au
  // client avant et apres, puis les questions proches que l agent relit avec
  // ce fait. Chaque ligne dit ce qui s est reellement passe. `is-neuf` ne se
  // pose qu au premier rendu : le bloc est redessine a chaque etape, son
  // entree ne se rejoue pas.
  function pv2SavoirResultat(r) {
    const neuf = !r.vu;
    r.vu = true;
    let avantApres = '';
    if (r.question) {
      const apres = r.apres
        ? `<div class="pv2-savoir-apres"><span class="pv2-savoir-etiquette">Après</span><p>${esc(r.apres.body)}</p></div>`
        : '<div class="pv2-savoir-apres is-attente"><span class="pv2-savoir-etiquette">Après</span><p>L’agent n’a pas pu refaire sa réponse cette fois. Celle d’avant reste proposée. Le fait, lui, est appris et sert dès le prochain message.</p></div>';
      avantApres = `
        <p class="pv2-savoir-sous">La réponse proposée à ${esc(r.mailDe || 'ce client')}</p>
        <div class="pv2-savoir-avap">
          ${r.avant ? `<div class="pv2-savoir-avant"><span class="pv2-savoir-etiquette">Avant</span><p>${esc(r.avant.body)}</p></div>` : ''}
          ${apres}
        </div>`;
    }
    let proches = '';
    const a = r.application;
    if (a && a.enCours) {
      proches = `<p class="pv2-savoir-relit" role="status">L’agent relit ${pv2Pluriel(r.proches.length, 'question proche', 'questions proches')} avec ce fait…</p>`;
    } else if (a && a.resultats) {
      const lus = a.resultats.filter((x) => x.relu);
      const nouveaux = !a.vu;
      a.vu = true;
      proches = `<div class="pv2-savoir-proches${nouveaux ? ' is-neuf' : ''}" role="status">
          <p class="pv2-savoir-sous">${lus.length ? `${pv2Pluriel(a.resolues, 'question proche résolue', 'questions proches résolues')} avec ce fait, sur ${pv2Pluriel(lus.length, 'relue', 'relues')}.` : 'Les questions proches n’ont pas pu être relues cette fois. Elles restent en attente.'}</p>
          ${lus.length ? `<ul>${lus.map((x) => `<li class="${x.resolue ? 'is-resolue' : ''}"><b>${x.resolue ? 'Résolue' : 'Encore ouverte'}</b><span>${esc(x.resolue ? x.question : (x.encore || x.question))}</span></li>`).join('')}</ul>` : ''}
        </div>`;
    }
    return `
      <article class="pv2-savoir-resultat${neuf ? ' is-neuf' : ''}">
        <p class="pv2-savoir-appris"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>Appris</p>
        <div class="pv2-savoir-fait-retenu"><strong>${esc(r.fait ? r.fait.question : '')}</strong><span>${esc(r.fait ? r.fait.reponse : '')}</span></div>
        ${avantApres}
        ${r.question && r.apres && r.utilise === true ? '<p class="pv2-savoir-utilise is-oui">Réponse refaite avec ce fait.</p>' : ''}
        ${r.question && r.apres && r.utilise === false ? '<p class="pv2-savoir-utilise is-non" role="status">L’agent n’a pas repris ce fait dans cette réponse. Relisez-la avant de l’envoyer.</p>' : ''}
        ${proches}
        <div class="pv2-savoir-actions pv2-savoir-fin">
          <button type="button" class="pv2-btn sm primary" onclick="pv2SavoirSuivante()" ${a && a.enCours ? 'disabled' : ''}>${pv2SavoirDonnees().questions.length ? 'Question suivante' : 'Terminer'}</button>
        </div>
      </article>`;
  }
  // SA MEMOIRE : chaque fait, qui l a appris et quand, ce qu il a resolu ; il
  // se cherche, se corrige (l ancienne reponse reste dans son historique) et
  // s oublie.
  function pv2SavoirMemoire(appris) {
    if (!appris.length) return '<p class="pv2-savoir-vide">Rien encore. Chaque réponse apprise vient s’ajouter ici.</p>';
    const busy = pv2Mail.apprentissageBusy;
    const cherche = String(pv2Mail.memoireFiltre || '').trim().toLowerCase();
    return `<input type="search" class="pv2-savoir-recherche" placeholder="Chercher dans sa mémoire" aria-label="Chercher dans sa mémoire"
        data-pl-focus="emails.savoir.recherche" value="${esc(pv2Mail.memoireFiltre || '')}" oninput="pv2SavoirFiltre(this.value)">
      <ul class="pv2-savoir-memoire">${appris.map((f, rang) => {
        const id = String(f.id || '');
        const edition = id && pv2Mail.faitEnEdition === id;
        const texte = `${f.question || ''} ${f.reponse || ''}`.toLowerCase();
        const infos = [f.par ? `appris par ${f.par}` : '', pv2DateCourte(f.le) ? `le ${pv2DateCourte(f.le)}` : '',
          Number(f.resolues) > 0 ? pv2Pluriel(Number(f.resolues), 'question résolue', 'questions résolues') : '',
          Number(f.versions) > 0 ? `corrigé ${Number(f.versions)} fois` : ''].filter(Boolean).join(' · ');
        return `
        <li class="pv2-savoir-fait" data-texte="${esc(texte)}" ${cherche && texte.indexOf(cherche) < 0 ? 'hidden' : ''}>
          <div>
            <strong>${esc(f.question || '')}</strong>
            ${edition ? pv2SavoirChamp(`fait-${id}`, pv2Mail.reponsesApprises[`fait-${id}`] ?? String(f.reponse || ''), 'Corriger ce fait', '', 'Enregistrer') : `<span>${esc(f.reponse || '')}</span>`}
            ${infos ? `<small>${esc(infos)}</small>` : ''}
          </div>
          ${pv2PeutApprendre() ? `<div class="pv2-savoir-fait-actions">
            ${edition
              ? '<button type="button" class="pv2-btn sm ghost" onclick="pv2SavoirAnnulerCorrection()">Annuler</button>'
              : `${id ? `<button type="button" class="pv2-btn sm ghost" ${busy ? 'disabled' : ''} onclick="pv2SavoirCorriger('${escJs(id)}')">Corriger</button>` : ''}
                 ${emMenuPlusHtml(`emFaitPlus${id || `r${rang}`}`,`Plus d’actions pour ${f.question || 'ce fait'}`, [emGestePlus('Oublier', `pv2OublierLeFait('${escJs(id)}', '${escJs(String(f.question || ''))}')`, { danger: true, inactif: Boolean(busy) })])}`}
          </div>` : ''}
        </li>`;
      }).join('')}</ul>
      <p class="pv2-savoir-vide pv2-savoir-aucun" ${cherche && !appris.some((f) => `${f.question || ''} ${f.reponse || ''}`.toLowerCase().indexOf(cherche) >= 0) ? '' : 'hidden'}>Aucun fait ne contient « ${esc(pv2Mail.memoireFiltre || '')} ».</p>`;
  }
  function pv2SavoirNouveau() {
    const n = pv2Mail.nouveauFait || { question: '' };
    return `<details class="pv2-savoir-bloc pv2-savoir-nouveau" ${pv2Mail.nouveauOuvert ? 'open' : ''} ontoggle="pv2Mail.nouveauOuvert = this.open">
        <summary>Lui apprendre autre chose</summary>
        <p class="pv2-savoir-sous">Sans attendre qu’un client le demande, donnez un sujet et ce qu’il doit savoir.</p>
        <label class="pv2-savoir-sujet"><span>Sujet</span>
          <input maxlength="300" data-pl-focus="emails.savoir.nouveau.sujet" placeholder="Ex. Tarifs des arcades" value="${esc(n.question || '')}" oninput="pv2SavoirNouveauSujet(this.value, this)">
        </label>
        ${pv2SavoirChamp('nouveau', pv2Mail.reponsesApprises.nouveau || '', 'Ce que l’agent doit savoir', 'Ex. Une carte par personne : 15 € les 30 minutes, 25 € l’heure.')}
      </details>`;
  }
  // `options.apercu` : l Apercu ne montre que le suivi et la question du
  // moment, et renvoie vers L agent ; `options.toujours` : L agent affiche la
  // section meme quand il n y a rien, pour dire que l agent a su repondre a
  // tout (un bloc absent y serait une page trouee).
  function pv2SectionApprentissage(options = {}) {
    const { questions, appris, suivi } = pv2SavoirDonnees();
    if (!questions.length && !appris.length && !options.toujours) return '';
    const total = Math.max(Number(suivi.questions) || 0, questions.length);
    const rang = Math.max(0, questions.findIndex((q) => String(q.communicationId) === String(pv2Mail.savoirCle)));
    const q = questions[rang];
    const attente = total ? `${pv2Pluriel(total, 'question', 'questions')} en attente` : 'Aucune question en attente';
    if (options.apercu) {
      return `<section class="pv2-panel pv2-savoir is-apercu" aria-label="Ce que l’agent ne sait pas">
        <div class="pv2-panel-head pv2-list-head">
          <h2>Ce que l’agent ne sait pas</h2>
        </div>
        <div class="pv2-panel-body">
          ${pv2SavoirSuivi(suivi, { apercu: true })}
          ${q ? `<p class="pv2-savoir-question">${esc(q.question)}</p>` : ''}
          <div class="em-savoir-suite"><span class="pv2-savoir-origine">${esc(attente)}</span><button type="button" class="pv2-btn sm" onclick="pv2EmailsGo('agent')">${q && pv2PeutApprendre() ? 'Lui répondre' : 'Voir dans L’agent'}</button></div>
        </div>
      </section>`;
    }
    const resultat = pv2Mail.dernierApprentissage;
    const liste = !resultat && questions.length > 1 ? `
        <details class="pv2-savoir-bloc" ${pv2Mail.listeOuverte ? 'open' : ''} ontoggle="pv2Mail.listeOuverte = this.open">
          <summary>Toutes les questions (${total})</summary>
          <ol class="pv2-savoir-toutes">${questions.map((x) => `<li><button type="button" class="pv2-link-btn${x === q ? ' is-courante' : ''}" ${x === q ? 'aria-current="true"' : ''} onclick="pv2SavoirChoisir('${escJs(String(x.communicationId))}')">${esc(x.question)}</button></li>`).join('')}</ol>
        </details>` : '';
    return `
      <section class="pv2-panel pv2-savoir em-savoir" aria-label="Apprentissage de l’agent">${emIaAnneau()}
        <div class="pv2-panel-head has-sub">
          <div><h2>Ses questions</h2><p class="pv2-panel-sub">Ce qu’il ne sait pas, il le demande. Ce que vous répondez, il le retient pour tous les messages suivants.</p></div>
          <span class="pv2-savoir-compte">${esc(attente)}</span>
        </div>
        <div class="pv2-panel-body pv2-savoir-corps">
          ${resultat ? pv2SavoirResultat(resultat) : (q ? pv2SavoirCarte(q, rang + 1, total) : '<p class="pv2-savoir-vide pv2-savoir-tout-su">L’agent a su répondre à tous les messages reçus.</p>')}
          ${liste}
          ${pv2SavoirSuivi(suivi)}
          <div class="em-savoir-sait">
            <h3 class="em-h3">Ce qu’il sait de votre centre</h3>
            <details class="pv2-savoir-bloc" ${pv2Mail.memoireOuverte ? 'open' : ''} ontoggle="pv2Mail.memoireOuverte = this.open">
              <summary>Sa mémoire (${pv2Pluriel(appris.length, 'fait', 'faits')})</summary>
              ${pv2SavoirMemoire(appris)}
            </details>
            ${pv2PeutApprendre() ? pv2SavoirNouveau() : ''}
          </div>
        </div>
      </section>`;
  }

  window.pv2SavoirBrouillon = function (cle, valeur, champ) {
    pv2Mail.reponsesApprises[cle] = valeur;
    // Pas de re-rendu a chaque touche (il ferait perdre le curseur) : le bouton
    // et le compteur de SA case se mettent a jour sur place. Avant (jusqu au
    // 2026-09-24), le bouton ne se debloquait qu au rendu suivant : Movsar
    // tapait sa reponse, touchait « Apprendre », et rien ne partait.
    const bloc = champ && champ.parentElement ? champ.parentElement : null;
    if (!bloc) return;
    const texte = String(valeur || '').trim();
    const trop = texte.length > PV2_SAVOIR_MAX;
    const sujetManquant = cle === 'nouveau' && !String((pv2Mail.nouveauFait || {}).question || '').trim();
    const bouton = bloc.querySelector('.pv2-savoir-apprendre');
    if (bouton && pv2Mail.apprentissageBusy !== cle) bouton.disabled = !texte || trop || sujetManquant;
    const compteur = bloc.querySelector('.pv2-savoir-compteur');
    if (compteur) { compteur.textContent = pv2CompteSavoir(valeur); compteur.classList.toggle('is-trop', trop); }
  };
  // Ctrl + Entree (Cmd + Entree sur Mac) fait ce que fait le bouton de la case,
  // et rien quand il est inactif.
  window.pv2SavoirClavier = function (event) {
    if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey) || event.isComposing) return;
    event.preventDefault();
    const bouton = event.target.parentElement && event.target.parentElement.querySelector('.pv2-savoir-apprendre');
    if (bouton && !bouton.disabled) bouton.click();
  };
  window.pv2SavoirNouveauSujet = function (valeur, champ) {
    pv2Mail.nouveauFait = { question: valeur };
    const details = champ && champ.closest ? champ.closest('.pv2-savoir-nouveau') : null;
    const zone = details ? details.querySelector('.pv2-savoir-reponse') : null;
    if (zone) window.pv2SavoirBrouillon('nouveau', zone.value, zone);
  };
  window.pv2SavoirPasser = function () {
    const { questions } = pv2SavoirDonnees();
    if (!questions.length) return;
    const i = Math.max(0, questions.findIndex((q) => String(q.communicationId) === String(pv2Mail.savoirCle)));
    pv2Mail.savoirCle = String(questions[(i + 1) % questions.length].communicationId);
    renderStaffEmailsPage();
  };
  window.pv2SavoirChoisir = function (cle) {
    pv2Mail.savoirCle = String(cle);
    pv2Mail.dernierApprentissage = null;
    renderStaffEmailsPage();
  };
  window.pv2SavoirSuivante = function () {
    pv2Mail.dernierApprentissage = null;
    renderStaffEmailsPage();
    const zone = document.querySelector('#staffEmailsPage .pv2-savoir-carte .pv2-savoir-reponse');
    if (zone) zone.focus();
  };
  // La recherche filtre sur place : un re-rendu a chaque lettre ferait perdre
  // la saisie en cours ailleurs, et le curseur.
  window.pv2SavoirFiltre = function (valeur) {
    pv2Mail.memoireFiltre = valeur;
    const cherche = String(valeur || '').trim().toLowerCase();
    let visibles = 0;
    document.querySelectorAll('#staffEmailsPage .pv2-savoir-memoire .pv2-savoir-fait').forEach((li) => {
      li.hidden = Boolean(cherche) && String(li.dataset.texte || '').indexOf(cherche) < 0;
      if (!li.hidden) visibles += 1;
    });
    const aucun = document.querySelector('#staffEmailsPage .pv2-savoir-aucun');
    if (aucun) { aucun.hidden = !cherche || visibles > 0; aucun.textContent = `Aucun fait ne contient « ${String(valeur || '').trim()} ».`; }
  };
  window.pv2SavoirCorriger = function (id) {
    pv2Mail.faitEnEdition = String(id);
    renderStaffEmailsPage();
    const zone = document.querySelector(`#staffEmailsPage [data-pl-focus="emails.savoir.fait-${String(id)}"]`);
    if (zone) zone.focus();
  };
  window.pv2SavoirAnnulerCorrection = function () {
    delete pv2Mail.reponsesApprises[`fait-${pv2Mail.faitEnEdition}`];
    pv2Mail.faitEnEdition = '';
    renderStaffEmailsPage();
  };

  // L AGENT RELIT LES QUESTIONS PROCHES avec le fait qu il vient d apprendre :
  // une seconde requete, pour que la premiere reste courte et que l ecran
  // montre la relecture pendant qu elle se fait.
  async function pv2SavoirAppliquer(r) {
    if (!r || !r.fait || !Array.isArray(r.proches) || !r.proches.length) return;
    r.application = { enCours: true };
    renderStaffEmailsPage();
    try {
      const payload = await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({
          action: 'agentApplyFact',
          centerId: state.adminCenterId || 'libramont',
          factId: r.fait.id,
          communicationIds: r.proches.map((x) => x.communicationId),
        }),
      });
      const resultats = (payload && payload.resultats) || [];
      const resolues = Number(payload && payload.resolues) || 0;
      r.application = { enCours: false, resultats, resolues };
      if (resolues && typeof opsAdminCache === 'object' && opsAdminCache) {
        const faites = new Set(resultats.filter((x) => x.resolue).map((x) => String(x.communicationId)));
        pv2SavoirRecompte((opsAdminCache.appris || []).map((f) => (Number(f.id) === Number(r.fait.id) ? Object.assign({}, f, { resolues: (Number(f.resolues) || 0) + resolues }) : f)), resolues);
        opsAdminCache.questions = (opsAdminCache.questions || []).filter((x) => !faites.has(String(x.communicationId)));
      }
    } catch (error) {
      r.application = { enCours: false, resultats: [], resolues: 0 };
    }
    if (typeof requestOpsAdminLoad === 'function') requestOpsAdminLoad(true);
    renderStaffEmailsPage();
  }

  window.pv2ApprendreLaReponse = async function (cle) {
    if (pv2Mail.apprentissageBusy) return;
    if (typeof canUseStaffPermission === 'function' && !canUseStaffPermission('emails.send')) { toast('Votre rôle ne permet pas d’apprendre à l’agent.'); return; }
    const reponse = String(pv2Mail.reponsesApprises[cle] || '').trim();
    if (!reponse) { toast('Écrivez d\'abord la réponse à retenir.'); return; }
    if (reponse.length > PV2_SAVOIR_MAX) { toast(`Trop long, ${PV2_SAVOIR_MAX} caractères au plus.`); return; }
    const { questions } = pv2SavoirDonnees();
    const correction = cle.indexOf('fait-') === 0;
    const nouveau = cle === 'nouveau';
    const i = questions.findIndex((q) => String(q.communicationId) === cle);
    const question = i >= 0 ? questions[i] : null;
    // La question d apres, pour y revenir une fois celle-ci apprise.
    const suivante = question && questions.length > 1 ? questions[(i + 1) % questions.length] : null;
    const corps = correction
      ? { action: 'editAgentFact', id: Number(cle.slice(5)), reponse }
      : nouveau
        ? { action: 'teachAgentFact', question: String((pv2Mail.nouveauFait || {}).question || '').trim(), reponse }
        : { action: 'answerAgentQuestion', communicationId: Number(cle), reponse };
    pv2Mail.apprentissageBusy = cle;
    renderStaffEmailsPage();
    try {
      const payload = await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify(Object.assign({ centerId: state.adminCenterId || 'libramont' }, corps)),
      });
      delete pv2Mail.reponsesApprises[cle];
      if (payload && Array.isArray(payload.appris)) pv2SavoirRecompte(payload.appris, question ? 1 : 0);
      if (question && typeof opsAdminCache === 'object' && opsAdminCache) opsAdminCache.questions = questions.filter((x) => x !== question);
      if (correction) {
        pv2Mail.faitEnEdition = '';
        toast('Corrigé. L’agent utilise la nouvelle réponse dès le prochain message.');
      } else {
        if (nouveau) { pv2Mail.nouveauFait = { question: '' }; pv2Mail.nouveauOuvert = false; }
        if (suivante) pv2Mail.savoirCle = String(suivante.communicationId);
        // L ecran montre ce qui s est REELLEMENT passe : le fait, l avant et
        // l apres de la reponse proposee (ou qu elle n a pas pu etre refaite),
        // puis les questions proches relues.
        pv2Mail.dernierApprentissage = {
          fait: (payload && payload.fait) || { question: nouveau ? corps.question : (question ? question.question : ''), reponse },
          question: question ? question.question : '',
          mailDe: question ? question.mailDe : '',
          avant: question ? ((payload && payload.avant) || null) : null,
          apres: question ? ((payload && payload.apres) || null) : null,
          // La reponse refaite se sert-elle du fait ? Le serveur le dit (null :
          // il ne le sait pas, rien ne s affiche).
          utilise: question && payload && typeof payload.utilise === 'boolean' ? payload.utilise : null,
          proches: (payload && Array.isArray(payload.proches)) ? payload.proches : [],
          application: null,
        };
      }
    } catch (error) {
      toast(error.message || 'Apprentissage impossible.');
    } finally {
      pv2Mail.apprentissageBusy = '';
      renderStaffEmailsPage();
    }
    const r = pv2Mail.dernierApprentissage;
    if (r && r.proches.length && !r.application) await pv2SavoirAppliquer(r);
    else if (typeof requestOpsAdminLoad === 'function') requestOpsAdminLoad(true);
  };

  window.pv2OublierLeFait = async function (id, question) {
    if (pv2Mail.apprentissageBusy) return;
    if (typeof canUseStaffPermission === 'function' && !canUseStaffPermission('emails.send')) { toast('Votre rôle ne permet pas d’apprendre à l’agent.'); return; }
    const sur = typeof confirm !== 'function' || confirm('L\'agent oubliera ce fait. Continuer ?');
    if (!sur) return;
    pv2Mail.apprentissageBusy = 'oubli';
    renderStaffEmailsPage();
    try {
      const payload = await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify(Object.assign({ action: 'forgetAgentFact', centerId: state.adminCenterId || 'libramont' }, Number(id) > 0 ? { id: Number(id) } : { question })),
      });
      if (payload && Array.isArray(payload.appris)) pv2SavoirRecompte(payload.appris, 0);
      toast('Oublié. L’agent ne s’en servira plus.');
      if (typeof requestOpsAdminLoad === 'function') requestOpsAdminLoad(true);
    } catch (error) {
      toast(error.message || 'Oubli impossible.');
    } finally {
      pv2Mail.apprentissageBusy = '';
      renderStaffEmailsPage();
    }
  };

  // Accord singulier/pluriel des compteurs. « 1 prêt(s) à partir » et
  // « 2 tentative(s) » traînaient sur un écran lu tous les jours par la
  // direction : le français se décide ici une fois, plus dans chaque template.
  function plural(n, one, many) {
    const count = Number(n) || 0;
    return `${count} ${count > 1 ? many : one}`;
  }

  /* ── INVENTAIRE DES MAILS ────────────────────────────────────────────────
     « Tout doit être gérable et pilotable depuis la catégorie. » Encore
     faut-il savoir ce qui existe : jusqu'ici la page ne montrait que les six
     séquences pilotables, et les cinq autres mails que le centre envoie
     vraiment (changement d'horaire client, SMS du jour, trois alertes staff)
     n'apparaissaient NULLE PART. Un mail invisible est un mail qu'on découvre
     par un appel client.

     Cette table est le miroir des branches réelles de buildMessage()
     (lib/ops-communications.js) : rien n'est inventé ici, et rien n'y est
     modifiable, c'est une carte. Chaque ligne dit qui le reçoit, quand il
     part, et où il se pilote. Quand il ne se pilote pas, elle dit POURQUOI
     à l'écran plutôt que de laisser la question ouverte. ── */
  const MAIL_INVENTORY = [
    { group: 'client', key: 'request_received', label: 'Accusé de réception', when: 'Quand la demande part en validation' },
    { group: 'client', key: 'confirmation', label: 'Confirmation de réservation', when: 'Dès que la réservation est validée' },
    { group: 'client', key: 'reminder_48h', label: 'Rappel avant la venue', when: 'Quelques jours avant la date' },
    { group: 'client', key: 'post_visit', label: 'Merci post-visite', when: 'Après la visite' },
    { group: 'client', key: 'birthday_j30', label: '30 jours avant l’anniversaire', when: 'Avant la date anniversaire fêtée ici' },
    { group: 'client', key: 'reactivation', label: 'Réactiver les clients dormants', when: 'Client fidèle plus vu depuis 2-3 mois' },
    {
      group: 'auto', label: 'Changement d\'horaire', to: 'Client', channel: 'Email',
      when: 'Quand un retard décale l\'heure d\'arrivée du groupe',
      why: 'Ce message porte le nouvel horaire du client. Un texte libre pourrait effacer l\'heure : il reste écrit par le système, mot pour mot, et part à chaque décalage validé.',
    },
    {
      group: 'auto', label: 'Rappel SMS le jour même', to: 'Client', channel: 'SMS',
      when: 'Le matin de la venue, si un numéro est enregistré',
      why: 'Un SMS se facture à l\'envoi et ne tient qu\'en deux lignes. Il se coupe en retirant le numéro d\'expéditeur dans Réglages, pas depuis cette page.',
    },
    {
      group: 'staff', label: 'Réservation à valider', to: 'Équipe', channel: 'Email',
      when: 'Quand aucun créneau automatique n\'est assez sûr',
    },
    {
      group: 'staff', label: 'Info retard terrain', to: 'Équipe', channel: 'Email',
      when: 'Retard constaté pendant le service, le plan tient',
    },
    {
      group: 'staff', label: 'Retard : décision à prendre', to: 'Équipe', channel: 'Email',
      when: 'Retard que le planning n\'a pas pu absorber',
    },
  ];

  function mailInventoryRow(entry) {
    const isSeq = entry.group === 'client';
    const setting = isSeq && mkAuto.settings ? mkAuto.settings[entry.key] : null;
    const meta = isSeq ? AUTOMATION_META.find((m) => m.key === entry.key) : null;
    const label = isSeq && meta ? meta.label : entry.label;
    // Même règle que les interrupteurs : ACTIF n'est pas un statut de réussite.
    // Ces badges étaient verts, c'est-à-dire de la couleur de « Envoyé ». Une
    // séquence active peut très bien échouer à chaque envoi : peindre son état
    // en vert répond à la mauvaise question, et à force de vert partout, le
    // vert de « Envoyé » ne se voit plus dans la file juste au-dessus.
    // HIÉRARCHIE REMISE À L'ENDROIT. Les onze « Active » sortaient en blanc gras
    // et l'unique « Coupée » en gris effacé : l'écran criait la normalité et
    // chuchotait l'exception. C'est l'inverse qu'il faut. « Active » est l'état
    // attendu de onze lignes sur douze, il redevient discret ; « Coupée » est la
    // seule ligne qui demande une décision, elle prend le contraste et le point
    // plein. Ni vert ni rouge : ce n'est pas un statut d'envoi.
    const enabled = isSeq ? !!(setting && setting.enabled) : true;
    const state_ = enabled
      ? '<span class="pv2-chip is-live">Active</span>'
      : '<span class="pv2-chip is-off">Coupée</span>';
    const control = isSeq
      ? '<span class="mail-inv-pilot">Modifiable ci-dessus</span>'
      : '<span class="mail-inv-pilot is-fixed">Texte fixe</span>';
    return `<tr${enabled ? '' : ' class="is-exception"'}>
      <td><strong>${esc(label)}</strong>${entry.why ? `<small class="pv2-cell-sub">${esc(entry.why)}</small>` : ''}</td>
      <td><span class="pv2-chip" data-audience="${entry.group === 'staff' ? 'equipe' : 'client'}">${esc(isSeq ? 'Client' : entry.to)}</span></td>
      <td class="mail-inv-when">${esc(entry.when)}</td>
      <td>${state_}</td>
      <td>${control}</td>
    </tr>`;
  }

  function mailInventoryPanel() {
    const open = !!state.staffEmailInventoryOpen;
    const total = MAIL_INVENTORY.length;
    const staffCount = MAIL_INVENTORY.filter((e) => e.group === 'staff').length;
    return `<section class="pv2-panel mail-inv">
      <div class="pv2-panel-head has-sub">
        <div>
          <h2>Tous les mails du centre</h2>
          <p class="pv2-panel-sub">${total} messages partent d'ici, ${total - staffCount} au client et ${staffCount} à l'équipe. Aucun autre.</p>
        </div>
        <button type="button" class="em-lien" onclick="pv2ToggleMailInventory()" aria-expanded="${open}">${open ? 'Masquer la liste' : 'Voir la liste'}</button>
      </div>
      ${open ? `<div class="pv2-panel-body" data-pv2-mount="inventory">
        <table class="mail-inv-table">
          <thead><tr><th>Message</th><th>Pour qui</th><th>Quand il part</th><th>État</th><th>Pilotage</th></tr></thead>
          <tbody>${MAIL_INVENTORY.map(mailInventoryRow).join('')}</tbody>
        </table>
        <p class="mail-inv-note">Les trois mails à l'équipe ne se coupent pas depuis cette page, et c'est voulu. Ils ne partent jamais à un client, et couper l'alerte d'un retard reviendrait à laisser un groupe sur le terrain sans personne pour trancher. Leur texte est écrit par le système pour tenir en trois lignes lues debout entre deux groupes.</p>
      </div>` : ''}
    </section>`;
  }

  window.pv2ToggleMailInventory = function () {
    state.staffEmailInventoryOpen = !state.staffEmailInventoryOpen;
    save();
    renderStaffEmailsPage();
  };

  window.renderStaffEmailsPage = function (errorMessage = '') {
    const root = document.getElementById('staffEmailsPage');
    if (!root) return;
    // LE FOCUS SURVIT AU RENDU (bug prod 2026-08-05 : « on ne peut plus
    // écrire »). Cette page se reconstruit par innerHTML quand une donnée
    // arrive (poll, file, séquences) : sans cette garde, le champ en cours de
    // frappe est détruit, le focus part sur <body> et les lettres suivantes ne
    // s'écrivent nulle part. garderFocus mémorise la clé data-pl-focus du champ
    // actif ET la position du curseur, re-rend, puis restaure les deux.
    // LE SCROLL SURVIT AUSSI (retour Movsar 2026-08-07, deux fois : d'abord
    // le scroll de PAGE, puis : « je clique et boum tout en haut » : c'etait
    // le scroll INTERNE de la file (.pv2-mail-list defile dans son propre
    // cadre, max-height). Le rebuild innerHTML recree le cadre : son
    // scrollTop repartait a zero. On memorise LES DEUX (page + cadres
    // defilants internes) et on les repose apres le paint.
    const scrollY = window.scrollY;
    // Les cadres de l espace de travail (liste des fils, fil ouvert, assistant,
    // file des envoyes) portent une CLE (`data-em-scroll`) : la premiere classe
    // ne suffit plus a les retrouver, et la cle du fil ouvert change avec lui,
    // si bien qu un autre fil s ouvre en haut au lieu d heriter du defilement.
    const innerScrolls = [...root.querySelectorAll('[data-em-scroll], .pv2-mail-list, .pv2-mail-detail, .pv2-thread-list')]
      .map((el) => ({ cle: el.getAttribute('data-em-scroll'), cls: String(el.className), top: el.scrollTop }))
      .filter((s) => s.top > 0);
    const paint = () => renderStaffEmailsPaint(root, errorMessage);
    if (typeof PinlaneMotion !== 'undefined' && PinlaneMotion.garderFocus) PinlaneMotion.garderFocus(paint);
    else paint();
    if (window.scrollY !== scrollY) window.scrollTo(0, scrollY);
    for (const saved of innerScrolls) {
      const fresh = saved.cle
        ? root.querySelector(`[data-em-scroll="${saved.cle}"]`)
        : root.querySelector(`.${saved.cls.split(' ')[0]}`);
      if (fresh) fresh.scrollTop = saved.top;
    }
    // La selection glisse APRES la restitution du defilement : sa position se
    // lit dans le cadre tel que la gerante le voit.
    emPoserSelections(root);
    // La liste ouverte du sélecteur de destinataire est repeinte après le
    // rendu : le DOM neuf naît avec une liste vide et cachée, l'état, lui, vit
    // hors DOM (pv2Combo) et survit.
    if (pv2Mail.composerOpen && pv2Combo.open) pv2ComboPaint();
    pv2ModeleOuvrirPremier();
  };

  /* ==========================================================================
     EMAILS v4 (2026-09-16) : LA PAGE EN SECTIONS
     Une vue globale (Apercu) puis neuf sections, chacune sa page. Les mails
     recus se lisent en CONVERSATIONS (un fil par echange, la reponse du client
     reste dedans), les envoyes portent leur suivi (remis, ouvert, clique), les
     sequences montrent le texte qui part vraiment, et le design des mails
     (gabarit + signature) se regle avec un apercu vivant.
     Contrats serveur : spec §3.7 (emailOverview, emailThreads, emailThread,
     emailDesign, emailDesignPreview, markCommunicationRead, setThreadStatus,
     customSequencePreview, sendCustomSequenceTest).
     ======================================================================== */

  // L ESPACE DE TRAVAIL (2026-11-10) : une navigation verticale en quatre
  // groupes, dans l ordre ou l on s en sert. La boite d abord (ce qui arrive,
  // ce qui part), puis ce qui part tout seul, puis le contenu, puis les
  // reglages qu on ouvre rarement.
  const PV2_EMAILS_GROUPS = [
    { key: 'boite', label: 'Boîte' },
    { key: 'auto', label: 'Automatique' },
    { key: 'contenu', label: 'Contenu' },
    { key: 'reglages', label: 'Réglages' },
  ];
  const PV2_EMAILS_TABS = [
    { key: 'apercu', label: 'Aperçu', group: 'boite' },
    { key: 'recus', label: 'Reçus', group: 'boite' },
    { key: 'envoyes', label: 'Envoyés', group: 'boite' },
    { key: 'sequences', label: 'Séquences', group: 'auto' },
    // Les campagnes exigent leur permission : sans elle, l onglet n existe pas
    // (regle DESIGN.md 9 : un bouton mene a une action reelle, ou il n existe pas).
    { key: 'campagnes', label: 'Campagnes', group: 'auto', permission: 'campaigns.manage' },
    { key: 'modeles', label: 'Modèles', group: 'contenu' },
    { key: 'apparence', label: 'Apparence', group: 'contenu' },
    { key: 'expediteurs', label: 'Expéditeurs', group: 'reglages' },
    { key: 'agent', label: 'L’agent', group: 'reglages' },
    { key: 'exclusions', label: 'Exclusions', group: 'reglages' },
  ];

  function pv2PeutVoirSection(key) {
    const tab = PV2_EMAILS_TABS.find((t) => t.key === key);
    if (!tab) return false;
    if (!tab.permission) return true;
    return typeof canUseStaffPermission !== 'function' || canUseStaffPermission(tab.permission);
  }

  // La section courante, toujours une section que ce role peut voir : un
  // hash « campagnes » chez un manager retombe sur l apercu, sans message.
  function pv2SectionCourante() {
    const brute = typeof normalizeStaffEmailsSection === 'function'
      ? normalizeStaffEmailsSection(state.staffEmailsSection)
      : (PV2_EMAILS_TABS.some((t) => t.key === state.staffEmailsSection) ? state.staffEmailsSection : 'apercu');
    if (pv2PeutVoirSection(brute)) return brute;
    state.staffEmailsSection = 'apercu';
    return 'apercu';
  }

  window.pv2EmailsGo = function (section) {
    const cible = pv2PeutVoirSection(section) ? section : 'apercu';
    const avant = state.staffEmailsSection;
    state.staffEmailsSection = cible;
    if (cible !== 'modeles') pv2Settings.tplVu = false;
    save();
    // Quitter les conversations, c est lacher le message qu on lisait : un
    // collegue ne doit pas voir « Marie repond » alors que Marie est partie
    // regler les sequences.
    if (avant === 'recus' && cible !== 'recus' && pv2Mail.prise.communicationId) pv2RelacherLaMain();
    if (typeof setStaffRouteHash === 'function') setStaffRouteHash('emails', cible);
    renderStaffEmailsPage();
    if (typeof syncStaffMenuState === 'function') syncStaffMenuState();
  };

  // Clavier sur la sous-navigation (motif tablist) : fleches, Home, End
  // deplacent ET activent. `event.currentTarget` est le bouton porteur de
  // l attribut onkeydown, jamais un enfant. La navigation est verticale sur un
  // ecran large et horizontale sur un telephone : les quatre fleches marchent
  // dans les deux cas.
  window.pv2EmailsTabKey = function (event) {
    const touches = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -1, ArrowDown: 1, Home: 'home', End: 'end' };
    const mouvement = touches[event.key];
    if (mouvement === undefined) return;
    const tabs = [...document.querySelectorAll('#staffEmailsPage .pl-subnav-item')];
    const courant = tabs.indexOf(event.currentTarget);
    if (courant < 0 || !tabs.length) return;
    event.preventDefault();
    let index = courant;
    if (mouvement === 'home') index = 0;
    else if (mouvement === 'end') index = tabs.length - 1;
    else index = (courant + mouvement + tabs.length) % tabs.length;
    const section = tabs[index].getAttribute('data-section');
    pv2EmailsGo(section);
    const frais = document.querySelector(`#staffEmailsPage .pl-subnav-item[data-section="${section}"]`);
    if (frais) frais.focus();
  };

  // « Actualiser » : les donnees de la page ET celles de la section ouverte.
  window.pv2EmailsActualiser = function () {
    if (typeof requestOpsAdminLoad === 'function') requestOpsAdminLoad(true);
    const section = pv2SectionCourante();
    if (section === 'apercu') { loadPv2Overview(true); loadPv2ThreadsApercu(true); }
    if (section === 'recus') { loadPv2Threads(true); loadPv2Overview(true); if (pv2Threads.selectedId) loadPv2ThreadDetail(pv2Threads.selectedId, true); }
    if (section === 'envoyes') loadPv2Overview(true);
    if (section === 'sequences') { loadStaffAutomations(true); loadPv2Sequences(true); loadPv2Overview(true); }
    if (section === 'apparence' || section === 'expediteurs') { loadPv2Design(true); loadPv2MailMeta(true); }
    if (section === 'modeles') loadPv2MailMeta(true);
    if (section === 'agent') loadPv2Brain(true);
    if (section === 'exclusions') loadPv2Suppressions(true);
    if (section === 'campagnes' && typeof loadPv2Campaigns === 'function') loadPv2Campaigns(true);
  };

  // Un rendu ne se fait que si la page est celle a l ecran : un chargement qui
  // finit pendant qu on est ailleurs ne doit pas reconstruire la page cachee.
  function pv2RenderSiActive() {
    if (typeof isStaffEmailsActive === 'function' && !isStaffEmailsActive()) return;
    renderStaffEmailsPage();
  }

  /* ── LES CADRES DE MAIL : iframe sandbox, srcdoc pose en PROPRIETE ───────
     Le HTML d un mail (celui du serveur, ou celui stocke tel qu envoye) n est
     jamais injecte dans le document de la console : il vit dans une iframe
     `sandbox=""`, et son contenu est pose en propriete apres la peinture,
     jamais serialise dans l attribut. ── */
  const PV2_FRAMES = {};
  // CLAIR OU SOMBRE (2026-09-17) : sur telephone, la plupart des messageries
  // passent le mail en sombre. L apercu sombre est une APPROXIMATION (couleurs
  // inversees, images intactes, comme Gmail ou Outlook) : chaque messagerie
  // adapte a sa facon. Le HTML du serveur n est jamais modifie : seul l apercu.
  let pv2ApercuTheme = 'clair';
  try { if (window.localStorage.getItem('pinlane_apercu_mail_theme') === 'sombre') pv2ApercuTheme = 'sombre'; } catch (e) { /* stockage indisponible */ }
  const PV2_STYLE_SOMBRE = '<style data-pv2-sombre>html{background:#121212!important}body{background:#ffffff!important;filter:invert(1) hue-rotate(180deg)}img{filter:invert(1) hue-rotate(180deg)}</style>';
  function pv2HtmlSelonTheme(html) {
    const brut = String(html || '');
    if (pv2ApercuTheme !== 'sombre' || !brut) return brut;
    return /<\/head>/i.test(brut) ? brut.replace(/<\/head>/i, `${PV2_STYLE_SOMBRE}</head>`) : `${PV2_STYLE_SOMBRE}${brut}`;
  }
  function pv2ThemeChoixHtml() {
    const bouton = (id, libelle) => `<button type="button" class="pv2-theme-btn${pv2ApercuTheme === id ? ' is-active' : ''}" data-pv2-theme-choix="${id}" aria-pressed="${pv2ApercuTheme === id}" onclick="pv2ApercuThemeChoisir('${id}')">${libelle}</button>`;
    return `<span class="pv2-theme-choix" role="group" aria-label="Aperçu du mail en clair ou en sombre">${bouton('clair', 'Clair')}${bouton('sombre', 'Sombre')}</span>`;
  }
  window.pv2ApercuThemeChoisir = function (theme) {
    pv2ApercuTheme = theme === 'sombre' ? 'sombre' : 'clair';
    try { window.localStorage.setItem('pinlane_apercu_mail_theme', pv2ApercuTheme); } catch (e) { /* stockage indisponible */ }
    document.querySelectorAll('#staffEmailsPage iframe[data-pv2-frame]').forEach((frame) => pv2ReposerCadre(frame, frame.__pv2Html || ''));
    document.querySelectorAll('#staffEmailsPage [data-pv2-theme-choix]').forEach((b) => {
      const actif = b.getAttribute('data-pv2-theme-choix') === pv2ApercuTheme;
      b.classList.toggle('is-active', actif);
      b.setAttribute('aria-pressed', String(actif));
    });
  };
  function pv2FrameHtml(cle, html, classe, titre) {
    PV2_FRAMES[cle] = String(html || '');
    return `<iframe class="${esc(classe)}" sandbox="" title="${esc(titre || 'Aperçu du mail')}" data-pv2-frame="${esc(cle)}"></iframe>`;
  }
  // UN APERCU QUI CHANGE NE S EMPILE PAS DANS L HISTORIQUE (2026-11-11).
  // Re-poser le srcdoc d un cadre deja charge est une navigation de plus dans
  // l historique de l onglet : le bouton Retour du navigateur remontait les
  // versions de l apercu avant de revenir a la section d avant (vu des que
  // Modeles a ouvert son apercu a l arrivee). Un cadre neuf qui nait avec son
  // srcdoc remplace son document vierge sans entree d historique : on
  // remplace donc le cadre au lieu de le renaviguer. Le premier remplissage,
  // juste apres le rendu, part du document vierge : il ne laisse rien.
  function pv2ReposerCadre(frame, html) {
    const neuf = frame.cloneNode(false);
    neuf.__pv2Html = html;
    neuf.setAttribute('srcdoc', pv2HtmlSelonTheme(html));
    frame.replaceWith(neuf);
  }
  function pv2FillFrames(root) {
    root.querySelectorAll('iframe[data-pv2-frame]').forEach((frame) => {
      const html = PV2_FRAMES[frame.getAttribute('data-pv2-frame')] || '';
      if (frame.hasAttribute('srcdoc')) { if (frame.__pv2Html !== html) pv2ReposerCadre(frame, html); return; }
      frame.__pv2Html = html;
      frame.srcdoc = pv2HtmlSelonTheme(html);
    });
  }

  /* ── L APERCU VIVANT : un seul mecanisme pour sequences, modeles, design ──
     500 ms apres la derniere frappe, une requete part ; la precedente est
     annulee ; et une reponse en retard ne peut jamais ecraser une reponse plus
     recente (numero de serie). Le resultat est peint SUR PLACE, sans rendu de
     page : le focus de la gerante reste dans son champ. ── */
  const PV2_APERCUS = {};
  const PV2_APERCU_ETAT = {};
  function pv2ApercuMemoire(cle) {
    if (!PV2_APERCUS[cle]) PV2_APERCUS[cle] = { timer: 0, ctrl: null, serie: 0 };
    return PV2_APERCUS[cle];
  }
  function pv2PlanifierApercu(cle, construire, delai = 500) {
    const a = pv2ApercuMemoire(cle);
    clearTimeout(a.timer);
    if (delai <= 0) { pv2LancerApercu(cle, construire); return; }
    a.timer = setTimeout(() => pv2LancerApercu(cle, construire), delai);
  }
  async function pv2LancerApercu(cle, construire) {
    const a = pv2ApercuMemoire(cle);
    clearTimeout(a.timer);
    a.timer = 0;
    if (a.ctrl) a.ctrl.abort();
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    a.ctrl = ctrl;
    const serie = ++a.serie;
    const corps = construire();
    if (!corps) return;
    PV2_APERCU_ETAT[cle] = { ...(PV2_APERCU_ETAT[cle] || {}), etat: 'chargement' };
    pv2PeindreApercu(cle);
    try {
      const payload = await apiRequest('/api/ops', { method: 'POST', body: JSON.stringify(corps), signal: ctrl ? ctrl.signal : undefined });
      if (serie !== a.serie) return;
      PV2_APERCU_ETAT[cle] = { etat: 'pret', html: String(payload.html || ''), subject: String(payload.subject || '') };
    } catch (error) {
      // Une requete annulee par la suivante n est pas une erreur a montrer.
      if (serie !== a.serie) return;
      PV2_APERCU_ETAT[cle] = { ...(PV2_APERCU_ETAT[cle] || {}), etat: 'erreur', message: (error && error.message) || 'Aperçu indisponible.' };
    }
    pv2PeindreApercu(cle);
  }
  function pv2ApercuAnnuler(cle) {
    const a = PV2_APERCUS[cle];
    if (a) { clearTimeout(a.timer); a.timer = 0; if (a.ctrl) a.ctrl.abort(); a.serie += 1; }
    delete PV2_APERCU_ETAT[cle];
  }
  function pv2ApercuEtatTexte(etat) {
    if (!etat || etat.etat === 'vide') return 'Écrivez pour voir le mail';
    if (etat.etat === 'chargement') return 'Mise à jour…';
    if (etat.etat === 'erreur') return etat.message || 'Aperçu indisponible.';
    return 'Aperçu à jour';
  }
  // LA LARGEUR DE L APERCU (2026-11-10) : le mail tel qu il s ouvre sur un
  // ordinateur ou sur un telephone. Une sequence se lit d abord au telephone,
  // la ou la plupart des clients l ouvrent. Le choix reste en memoire par apercu
  // et se pose sur place, sans rendu de page.
  const PV2_APERCU_LARGEUR = {};
  function emLargeurChoixHtml(cle, largeur) {
    const bouton = (id, libelle) => `<button type="button" class="pv2-theme-btn${largeur === id ? ' is-active' : ''}" data-em-largeur="${id}" aria-pressed="${largeur === id}" onclick="emApercuLargeur('${escJs(cle)}', '${id}')">${libelle}</button>`;
    return `<span class="pv2-theme-choix em-largeur" role="group" aria-label="Largeur de l’aperçu">${bouton('ordi', 'Ordinateur')}${bouton('tel', 'Téléphone')}</span>`;
  }
  window.emApercuLargeur = function (cle, largeur) {
    const v = largeur === 'tel' ? 'tel' : 'ordi';
    PV2_APERCU_LARGEUR[cle] = v;
    document.querySelectorAll(`[data-pv2-apercu="${cle}"]`).forEach((box) => {
      box.classList.toggle('is-tel', v === 'tel');
      box.querySelectorAll('[data-em-largeur]').forEach((b) => {
        const actif = b.getAttribute('data-em-largeur') === v;
        b.classList.toggle('is-active', actif);
        b.setAttribute('aria-pressed', String(actif));
      });
    });
  };
  function pv2ApercuVivantHtml(cle, { titre = 'Aperçu', tete = '', cadre = 'pv2-seq-preview-frame', classe = '', telephone = false } = {}) {
    const etat = PV2_APERCU_ETAT[cle] || { etat: 'vide' };
    const largeur = PV2_APERCU_LARGEUR[cle] || (telephone ? 'tel' : 'ordi');
    return `<div class="pv2-seq-preview${classe ? ` ${classe}` : ''}${largeur === 'tel' ? ' is-tel' : ''}" data-pv2-apercu="${esc(cle)}">
      <div class="pv2-seq-preview-head">${tete || `<span>${esc(titre)}</span>`}<span class="pv2-live-state${etat.etat === 'erreur' ? ' is-error' : ''}" aria-live="polite" data-pv2-apercu-etat>${esc(pv2ApercuEtatTexte(etat))}</span>${emLargeurChoixHtml(cle, largeur)}${pv2ThemeChoixHtml()}</div>
      <div class="pv2-seq-preview-subject" data-pv2-apercu-sujet>${esc(etat.subject || '')}</div>
      ${pv2FrameHtml(cle, etat.html || '', cadre, titre)}
    </div>`;
  }
  function pv2PeindreApercu(cle) {
    const etat = PV2_APERCU_ETAT[cle] || { etat: 'vide' };
    PV2_FRAMES[cle] = etat.html || '';
    document.querySelectorAll(`#staffEmailsPage [data-pv2-apercu="${cle}"]`).forEach((box) => {
      const s = box.querySelector('[data-pv2-apercu-etat]');
      if (s) { s.textContent = pv2ApercuEtatTexte(etat); s.classList.toggle('is-error', etat.etat === 'erreur'); }
      const sujet = box.querySelector('[data-pv2-apercu-sujet]');
      if (sujet) sujet.textContent = etat.subject || '';
      const frame = box.querySelector('iframe[data-pv2-frame]');
      if (frame && frame.__pv2Html !== (etat.html || '')) pv2ReposerCadre(frame, etat.html || '');
    });
  }

  /* ── LE MOUVEMENT DE L ESPACE DE TRAVAIL (2026-11-10) ────────────────────
     La page se reconstruit par innerHTML a chaque donnee qui arrive. Une
     entree posee naivement rejouerait a chaque poll, ou serait coupee net par
     le rendu suivant. Chaque entree garde donc son HEURE DE DEPART hors du
     DOM : un rendu pendant l entree la reprend la ou elle en etait (delai
     negatif), un rendu apres elle ne pose plus rien. Une section qui s ouvre
     efface cette memoire : ses listes arrivent alors en cascade, huit rangs au
     plus, 20 ms d ecart. Seuls transform et opacity bougent, et rien ne bouge
     sous prefers-reduced-motion. */
  const EM_MOTION = { departs: {}, sel: {}, fil: '', envoi: '' };
  const EM_DUREE = 160;
  const EM_CASCADE_MAX = 8;
  const EM_CASCADE_PAS = 20;

  // `cascade` est partage par une liste : seules ses lignes NOUVELLES prennent
  // un rang, si bien qu une ligne arrivee par un poll entre seule, sans delai.
  function emEntree(cle, cascade) {
    if (reducedMotion) return '';
    const maintenant = performance.now();
    let e = EM_MOTION.departs[cle];
    if (!e) {
      const rang = cascade ? cascade.n++ : 0;
      e = { t0: maintenant, delai: Math.min(rang, EM_CASCADE_MAX - 1) * EM_CASCADE_PAS };
      EM_MOTION.departs[cle] = e;
    }
    const ecoule = maintenant - e.t0;
    if (ecoule >= e.delai + EM_DUREE) return '';
    return ` data-em-in style="--em-d:${Math.round(e.delai - ecoule)}ms"`;
  }
  // Ce qui est deja a l ecran a la premiere peinture n a pas a entrer une
  // seconde fois au rendu suivant.
  function emDejaLa(cle) {
    EM_MOTION.departs[cle] = { t0: -Infinity, delai: 0 };
  }

  // LA SELECTION GLISSE d une ligne a l autre : un seul marqueur par liste,
  // repose sur l ancienne ligne sans transition, puis lache vers la nouvelle
  // (translateY + scaleY sur une base de 100 px, rien qui declenche un
  // layout par image). Un rendu qui ne change pas la selection le repose au
  // meme pixel. La position se lit en offsetTop : la geometrie de mise en
  // page, que l entree en cours (translateY de 4 px) ne fausse pas.
  function emHautDans(el, cadre) {
    let y = 0;
    let n = el;
    while (n && n !== cadre) { y += n.offsetTop; n = n.offsetParent; }
    return n === cadre ? y : null;
  }
  function emPoserSelections(root) {
    root.querySelectorAll('[data-em-sel]').forEach((cadre) => {
      const cle = cadre.getAttribute('data-em-sel');
      const marque = cadre.querySelector(':scope > .em-sel');
      if (!marque) return;
      const choisi = cadre.querySelector('[data-em-cur]');
      const y = choisi && document.contains(cadre) && choisi.offsetHeight ? emHautDans(choisi, cadre) : null;
      if (y === null) {
        marque.classList.remove('is-on');
        // Une ligne choisie sortie de la liste (filtre, recherche) : la
        // prochaine selection se pose sans glisser depuis une ligne absente.
        if (!choisi) EM_MOTION.sel[cle] = null;
        return;
      }
      const place = (p) => { marque.style.transform = `translateY(${p.y}px) scaleY(${p.h / 100})`; };
      const to = { id: choisi.getAttribute('data-em-id'), y, h: choisi.offsetHeight };
      const from = EM_MOTION.sel[cle];
      const glisse = !reducedMotion && !!(from && from.id !== to.id);
      marque.style.transition = 'none';
      place(glisse ? from : to);
      marque.classList.add('is-on');
      void marque.offsetWidth;
      marque.style.transition = '';
      if (glisse) place(to);
      EM_MOTION.sel[cle] = to;
    });
  }

  // LA PHRASE D ETAT DE L EN-TETE : ce qui attend, en une phrase, depuis les
  // memes chiffres que la navigation et l apercu.
  function emListeFr(morceaux) {
    if (morceaux.length < 2) return morceaux.join('');
    return `${morceaux.slice(0, -1).join(', ')} et ${morceaux[morceaux.length - 1]}`;
  }
  function emStatutDuJour() {
    const o = pv2Overview.data;
    if (!o) return pv2Overview.error ? 'Le résumé de vos mails est indisponible pour le moment.' : 'Lecture de vos mails…';
    const aRepondre = pv2Nombre(o.aRepondre) || 0;
    const echecs = getStaffEmailRows().filter((r) => !pv2IsInbound(r) && r.statusKind === 'failed').length;
    const prevus = pv2Nombre(o.programmes24h) || 0;
    const morceaux = [aRepondre ? `${aRepondre} conversation${aRepondre > 1 ? 's' : ''} à répondre` : 'aucune conversation à répondre'];
    if (echecs) morceaux.push(`${echecs} envoi${echecs > 1 ? 's' : ''} en échec`);
    if (prevus) morceaux.push(`${prevus} mail${prevus > 1 ? 's' : ''} prévu${prevus > 1 ? 's' : ''} dans les 24 h`);
    const phrase = emListeFr(morceaux);
    return `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)}.`;
  }
  // UN SEUL BOUTON PLEIN PAR ECRAN (2026-11-11, lot S) : quand la section a
  // le sien, « Nouveau message » de l en-tete passe en bouton simple. Recus :
  // Envoyer dans une conversation ouverte. Sequences, Campagnes, Modeles,
  // Expediteurs : le bouton qui cree, ou Enregistrer dans l editeur ouvert.
  // Apparence et L agent : Enregistrer, Apprendre. Exclusions : Exclure.
  function emSectionAUnPrincipal(section) {
    const peut = (droit) => typeof canUseStaffPermission !== 'function' || canUseStaffPermission(droit);
    // Le panneau « Coller un mail reçu » ouvert porte Analyser.
    if (pv2Mail.analyzeOpen) return true;
    if (section === 'recus') return Boolean(pv2Threads.selectedId);
    if (section === 'sequences' || section === 'apparence' || section === 'agent') return peut(['settings.manage', 'emails.send']);
    if (section === 'campagnes' || section === 'modeles') return peut('campaigns.manage');
    if (section === 'expediteurs') return peut('settings.manage');
    if (section === 'exclusions') return peut(['campaigns.manage', 'emails.send']);
    return false;
  }

  // « PLUS D OPTIONS » (2026-11-11, lot S) : ce qui a un bon defaut attend sous
  // une ligne calme qui s ouvre. Son etat survit aux rendus de la page ; tant
  // que la gerante n y a pas touche, il suit `ouvertParDefaut` (un filtre
  // actif, par exemple, se montre).
  const EM_OPTIONS = {};
  window.emOptionsBascule = function (cle, ouvert) { EM_OPTIONS[cle] = Boolean(ouvert); };
  function emOptionsHtml(cle, indice, corps, ouvertParDefaut = false) {
    const ouvert = Object.prototype.hasOwnProperty.call(EM_OPTIONS, cle) ? EM_OPTIONS[cle] : ouvertParDefaut;
    return `<details class="em-options" data-em-options="${esc(cle)}"${ouvert ? ' open' : ''} ontoggle="emOptionsBascule('${escJs(cle)}', this.open)"><summary>Plus d’options${indice ? `<span>${esc(indice)}</span>` : ''}</summary><div class="em-options-corps">${corps}</div></details>`;
  }

  // LE MENU « PLUS » D UNE LIGNE, partout pareil (2026-11-11, lot S) : un
  // geste calme qui ouvre un popover natif (emPlusPlacer le pose), avec les
  // gestes rares ou destructeurs. Sans geste permis, rien ne s affiche.
  function emMenuPlusHtml(id, etiquette, gestes) {
    const items = gestes.filter(Boolean);
    if (!items.length) return '';
    return `<button type="button" class="em-lien em-plus" popovertarget="${esc(id)}" aria-label="${esc(etiquette)}">Plus</button><div class="em-plus-menu" id="${esc(id)}" popover onbeforetoggle="emPlusPlacer(event)" ontoggle="emPlusPlacer(event)">${items.join('')}</div>`;
  }
  function emGestePlus(libelle, appel, { danger = false, inactif = false } = {}) {
    return `<button type="button"${danger ? ' class="is-danger"' : ''} onclick="emPlusFermer(this); ${appel}"${inactif ? ' disabled' : ''}>${esc(libelle)}</button>`;
  }
  function emHeureDeMaj() {
    const v = opsAdminCache.lastLoadedAt;
    const d = v ? new Date(v) : null;
    if (!d || Number.isNaN(d.getTime())) return 'Pas encore chargé';
    const heure = d.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
    return d.toDateString() === new Date().toDateString()
      ? `À jour à ${heure}`
      : `À jour le ${d.toLocaleDateString('fr-BE', { day: 'numeric', month: 'long' })} à ${heure}`;
  }

  /* ── L ASSISTANT D ECRITURE (em-ia, 2026-11-10, en conversation depuis le 2026-11-13) ──────────
     Le meme assistant dans les cinq editeurs : le nouveau message, la reponse dans Recus, le modele, la
     sequence et la campagne. Ansar, 2026-11-12 : « tu vois pas le message de l'IA, tu sais pas corriger
     direct depuis la conv ». C est donc une CONVERSATION : la demande de l equipe s affiche, la reponse de
     l assistant aussi (une phrase qui dit ce qu il a fait et avec quels faits), et une correction se tape
     en dessous, comme une reponse. Chaque reponse garde sa version du mail : « Revenir a cette version »
     la remet, « Revenir a mon texte » remet le texte d avant le premier changement. Une seule porte
     serveur, emailAssist, qui recoit la conversation (historique) et le mail actuel. Un refus (variable
     perdue, chiffre absent des faits, IA muette) s ecrit dans la conversation et ne touche a rien. Pendant
     l appel, les champs sont verrouilles et le point bleu dit ce qui se fait. */
  const EM_IA_GESTES = [
    ['adapter', 'Adapter à mon centre'], ['raccourcir', 'Plus court'], ['chaleureux', 'Plus chaleureux'], ['formel', 'Plus pro'],
    ['ameliorer', 'Améliorer'], ['nl', 'En néerlandais'], ['en', 'En anglais'], ['objets', '3 objets'],
  ];
  const EM_IA_TRAVAIL = {
    ecrire: 'J’écris votre mail…', corriger: 'Je fais le changement…', adapter: 'J’adapte le mail à votre centre…', ameliorer: 'J’améliore le mail…',
    raccourcir: 'Je raccourcis le mail…', chaleureux: 'Je rends le ton plus chaleureux…', formel: 'Je rends le ton plus professionnel…',
    nl: 'Je traduis le mail en néerlandais…', en: 'Je traduis le mail en anglais…', objets: 'Je cherche trois objets…',
  };
  const EM_IA_TRANSFORME = new Set(['ameliorer', 'raccourcir', 'chaleureux', 'formel', 'nl', 'en', 'adapter']);
  // Les idees d un mail vide, par editeur : un toucher, et l assistant ecrit.
  const EM_IA_IDEES = {
    message: ['Inviter ce client à revenir', 'Proposer une date pour son anniversaire', 'Remercier pour sa visite'],
    modele: ['Relancer les clients qui ne sont pas revenus', 'Proposer l’anniversaire d’un enfant', 'Proposer une sortie d’équipe en entreprise'],
    campagne: ['Annoncer les vacances scolaires', 'Remplir un jour calme en semaine', 'Proposer les anniversaires d’enfants'],
    sequence: ['Remercier après la visite', 'Rappeler la venue la veille'],
    seqperso: ['Relancer les clients qui ne sont pas revenus', 'Souhaiter un bon anniversaire'],
  };
  // Ou vivent l objet et le texte de chaque editeur, et ce qui le repeint.
  // `ident` dit QUEL brouillon est ouvert : un autre fil, un autre modele, une
  // autre sequence repartent d une barre vierge.
  const EM_IA_CIBLES = {
    message: {
      contexte: 'message',
      ident: () => 'composer',
      lire: () => ({ subject: String(pv2Mail.draft.subject || ''), body: String(pv2Mail.draft.body || '') }),
      poser: (v) => { pv2Mail.draft.subject = v.subject; pv2Mail.draft.body = v.body; },
      peindre: () => window.pv2RenderComposer(),
    },
    reponse: {
      contexte: 'reponse',
      // UNE REPONSE GARDE L OBJET DE LA CONVERSATION (2026-09-17) : Gmail
      // regroupe aussi par objet, un objet change sortirait la reponse du fil
      // chez le client. L aide ne touche qu au texte, et « 3 objets » n a pas
      // sa place ici. Un brouillon sans objet prend celui qu elle propose.
      garderObjet: true,
      ident: () => String((pv2Threads.detail.thread && pv2Threads.detail.thread.id) || pv2Threads.selectedId || ''),
      lire() { const r = pv2Threads.reply[this.ident()] || {}; return { subject: String(r.subject || ''), body: String(r.body || '') }; },
      poser(v) { const r = pv2Threads.reply[this.ident()]; if (r) { r.subject = v.subject; r.body = v.body; } },
      // Le texte du dernier mail du client : l aide repond a CE mail.
      recu: () => {
        const m = pv2ThreadDernierEntrant(pv2Threads.detail.messages);
        if (!m) return '';
        const brut = String((m.payload && m.payload.textBody) || m.textBody || m.body || '');
        return brut.replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ').trim().slice(0, 6000);
      },
      peindre: () => renderStaffEmailsPage(),
    },
    modele: {
      contexte: 'modele',
      ident: () => (pv2Settings.tplEditing ? String(pv2Settings.tplEditing.id || 'nouveau') : ''),
      lire: () => ({ subject: String((pv2Settings.tplEditing || {}).subject || ''), body: String((pv2Settings.tplEditing || {}).body || '') }),
      poser: (v) => { if (pv2Settings.tplEditing) { pv2Settings.tplEditing.subject = v.subject; pv2Settings.tplEditing.body = v.body; } },
      peindre: () => { renderStaffEmailsPage(); pv2ApercuModele(0); },
    },
    sequence: {
      contexte: 'sequence',
      ident: () => String(mkAuto.editKey || ''),
      lire: () => ({ subject: String(mkAuto.editDraft.subject || ''), body: String(mkAuto.editDraft.body || '') }),
      poser: (v) => { mkAuto.editDraft.subject = v.subject; mkAuto.editDraft.body = v.body; },
      peindre: () => { renderStaffEmailsPage(); pv2ApercuAuto(0); },
    },
    seqperso: {
      contexte: 'sequence',
      ident: () => String(pv2Seq.editId || (pv2Seq.creating ? 'nouvelle' : '')),
      lire: () => ({ subject: String((pv2Seq.draft || {}).subject || ''), body: String((pv2Seq.draft || {}).body || '') }),
      poser: (v) => { if (pv2Seq.draft) { pv2Seq.draft.subject = v.subject; pv2Seq.draft.body = v.body; } },
      peindre: () => { renderStaffEmailsPage(); pv2ApercuSequencePerso(0); },
    },
    campagne: {
      contexte: 'campagne',
      ident: () => String(pv2Camp.editingId || 'nouvelle'),
      lire: () => ({ subject: String(pv2Camp.form.subject || ''), body: String(pv2Camp.form.body || '') }),
      poser: (v) => { pv2Camp.form.subject = v.subject; pv2Camp.form.body = v.body; },
      peindre: () => renderStaffEmailsPage(),
    },
  };
  const EM_IA = {};
  function emIaEtat(cle) {
    const cible = EM_IA_CIBLES[cle];
    const ident = cible ? cible.ident() : '';
    if (!EM_IA[cle] || EM_IA[cle].ident !== ident) {
      // fil : la conversation, dans l ordre. Un tour est { qui: 'equipe' | 'aide' | 'refus' | 'note', texte,
      // version?, objets?, conseils? }. depart : le mail d avant le premier changement de l assistant.
      EM_IA[cle] = { ident, brief: '', busy: '', fil: [], depart: null, menu: '', fondu: 0, saisie: '', tout: false };
    }
    return EM_IA[cle];
  }
  function emIaPermise() {
    return typeof canUseStaffPermission !== 'function' || canUseStaffPermission(['emails.view', 'direction.view', 'campaigns.manage']);
  }
  function emIaVariables(texte) {
    return new Set((String(texte || '').match(/\{\{\s*[a-z_][a-z0-9_]*\s*\}\}/gi) || []).map((v) => v.replace(/\s+/g, '').toLowerCase()));
  }

  // L ANNEAU DE L ASSISTANT (lot 2) : un trait bleu qui tourne autour de ce
  // que l IA ecrit. Sa phase suit l horloge, pas le rendu : un repeint ne le
  // relance pas du debut.
  // La rotation est une animation Web posee juste apres l insertion, calee sur
  // le zero de l horloge du document (startTime = 0) : chaque anneau, neuf ou
  // repeint, visible tout de suite ou seulement en defilant, en est au meme
  // angle. Une animation CSS partait de l instant ou l anneau etait peint, et
  // un repeint le faisait sauter. Sous prefers-reduced-motion, rien ne tourne :
  // la feuille pose le trait immobile.
  let emIaCalagePrevu = false;
  const emIaMouvementReduit = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  function emIaCaler() {
    emIaCalagePrevu = false;
    const reduit = Boolean(emIaMouvementReduit && emIaMouvementReduit.matches);
    document.querySelectorAll('.em-ia-anneau:not([data-em-ia-cale])').forEach((anneau) => {
      anneau.setAttribute('data-em-ia-cale', '');
      if (reduit || typeof anneau.animate !== 'function') return;
      const tour = anneau.animate([{ transform: 'rotate(0turn)' }, { transform: 'rotate(1turn)' }], { duration: 6000, iterations: Infinity, pseudoElement: '::before' });
      tour.startTime = 0;
    });
  }
  if (emIaMouvementReduit && typeof emIaMouvementReduit.addEventListener === 'function') {
    emIaMouvementReduit.addEventListener('change', () => {
      document.querySelectorAll('.em-ia-anneau').forEach((anneau) => {
        anneau.getAnimations({ subtree: true }).forEach((a) => a.cancel());
        anneau.removeAttribute('data-em-ia-cale');
      });
      emIaCaler();
    });
  }
  function emIaAnneau() {
    if (!emIaCalagePrevu) {
      emIaCalagePrevu = true;
      requestAnimationFrame(emIaCaler);
    }
    return '<span class="em-ia-anneau" aria-hidden="true"></span>';
  }
  // L IA est-elle branchee pour ce centre ? (emailStudio : channel.aiConfigured). Sans elle, les gestes font ce
  // qu une regle sait faire, et l en-tete le dit.
  function emIaBranchee() {
    return Boolean(pv2Mail.channel && pv2Mail.channel.aiConfigured);
  }
  function emIaMemeTexte(a, b) {
    return Boolean(a && b) && String(a.subject || '') === String(b.subject || '') && String(a.body || '') === String(b.body || '');
  }
  function emIaTourHtml(cle, t, i, actuel) {
    if (t.qui === 'equipe') return `<li class="em-ia-tour is-equipe"><p>${esc(t.texte)}</p></li>`;
    if (t.qui === 'refus') return `<li class="em-ia-tour is-refus" role="alert"><p>${esc(t.texte)}</p></li>`;
    if (t.qui === 'note') return `<li class="em-ia-tour is-note"><p>${esc(t.texte)}</p></li>`;
    const objets = Array.isArray(t.objets) && t.objets.length
      ? `<div class="em-ia-objets" role="group" aria-label="Objets proposés">${t.objets.map((o, r) => `<button type="button" class="em-ia-objet${t.choisi === r ? ' is-choisi' : ''}" data-em-ia-objet="${r}" onclick="emIaChoisirObjet('${cle}', ${i}, ${r})">${esc(o)}</button>`).join('')}</div>`
      : '';
    const conseils = Array.isArray(t.conseils) && t.conseils.length ? `<ul class="em-ia-conseils">${t.conseils.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : '';
    // La version de ce tour : celle qui est dans l editeur se dit, les autres se remettent d un toucher.
    const pied = t.version
      ? (emIaMemeTexte(t.version, actuel)
        ? '<p class="em-ia-tour-etat">Version dans l’éditeur</p>'
        : `<button type="button" class="em-ia-tour-geste" onclick="emIaVersion('${cle}', ${i})">Revenir à cette version</button>`)
      : '';
    return `<li class="em-ia-tour is-aide"><p class="em-ia-dit">${esc(t.texte)}</p>${objets}${conseils}${pied}</li>`;
  }
  function emIaBarHtml(cle, { colonne = false } = {}) {
    const cible = EM_IA_CIBLES[cle];
    if (!cible || !emIaPermise()) return '';
    const e = emIaEtat(cle);
    const occupe = Boolean(e.busy);
    const verrou = occupe ? ' disabled' : '';
    const actuel = cible.lire();
    const ecrit = Boolean(actuel.body.trim());
    const ia = emIaBranchee();
    const centre = (typeof pv2CenterName === 'function' ? pv2CenterName() : '') || 'votre centre';
    // L EN-TETE dit qui est la et ce qu il sait faire, sans jamais se presenter comme une IA quand il n y en a pas.
    const sait = ia
      ? `Il écrit avec les vraies activités, formules et prix de ${centre}. Demandez-lui un mail, puis corrigez-le en lui répondant.`
      : 'L’IA n’est pas branchée pour ce centre. Les gestes font ce qu’une règle sait faire, sans rien inventer.';
    const depart = e.depart && !emIaMemeTexte(e.depart, actuel)
      ? `<button type="button" class="pv2-btn sm em-ia-depart" onclick="emIaDepart('${cle}')"${verrou}>Revenir à mon texte</button>`
      : '';
    // LA CONVERSATION. Vide : une phrase d accueil et, sur un mail vide, des idees d un toucher.
    const idees = !ecrit && !e.fil.length ? (EM_IA_IDEES[cle] || []) : [];
    const accueil = !e.fil.length
      ? `<li class="em-ia-tour is-aide is-accueil"><p class="em-ia-dit">${ecrit
        ? (ia ? `Je peux adapter ce texte à ${esc(centre)} avec ses vraies activités et ses prix, le raccourcir ou changer le ton. Écrivez-moi par exemple « plus court » ou « ajoutez le prix du laser game ».` : 'Touchez un geste sous ce message, ou modifiez le texte directement.')
        : (cle === 'reponse' ? 'Je lis le mail du client et j’écris la réponse. Dites-moi ce qu’elle doit dire, ou touchez « Écrire la réponse ».' : 'Dites-moi ce que le mail doit dire, je l’écris.')}</p>${idees.length || (cle === 'reponse' && !ecrit)
          ? `<div class="em-ia-idees" role="group" aria-label="Idées de mail">${(cle === 'reponse' ? ['Écrire la réponse'] : idees).map((idee) => `<button type="button" class="em-ia-idee" onclick="emIaIdee('${cle}', '${escJs(idee)}')"${verrou}>${esc(idee)}</button>`).join('')}</div>`
          : ''}</li>`
      : '';
    const tours = e.fil.map((t, i) => emIaTourHtml(cle, t, i, actuel));
    // EN BANDE (les editeurs etroits), les deux derniers tours, et le reste sur demande.
    const caches = !colonne && !e.tout && tours.length > 2 ? tours.length - 2 : 0;
    const voirTout = caches ? `<li class="em-ia-tour is-plus"><button type="button" class="em-ia-tour-geste" onclick="emIaToutVoir('${cle}')">Voir les ${caches} échange${caches > 1 ? 's' : ''} d’avant</button></li>` : '';
    const travail = occupe ? `<li class="em-ia-tour is-aide is-travail" role="status"><span class="em-ia-point" aria-hidden="true"></span><span>${esc(EM_IA_TRAVAIL[e.busy] || 'Je travaille sur votre mail…')}</span></li>` : '';
    const fil = `<ol class="em-ia-fil" aria-live="polite" aria-label="Conversation avec l’assistant">${accueil}${voirTout}${tours.slice(caches).join('')}${travail}</ol>`;
    // LES GESTES d un toucher, sur un mail deja ecrit. Les rares attendent dans « Plus ».
    const libelle = (k) => (EM_IA_GESTES.find(([x]) => x === k) || [k, k])[1];
    const geste = (k) => `<button type="button" class="em-ia-geste${e.busy === k ? ' is-busy' : ''}" data-em-ia-intention="${k}" onclick="emIaLancer('${cle}', '${k}')"${verrou}>${esc(libelle(k))}</button>`;
    const menu = (nom, titre, cles) => `<details class="em-ia-menu" name="em-ia-${cle}" data-em-ia-menu="${nom}"${e.menu === nom && !occupe ? ' open' : ''} ontoggle="emIaMenu('${cle}', '${nom}', this.open)"><summary class="em-ia-geste"${occupe ? ' aria-disabled="true"' : ''}>${esc(titre)}${ci('chevronDown')}</summary><div class="em-ia-menu-liste" role="group" aria-label="${esc(titre)}">${cles.map(geste).join('')}</div></details>`;
    const autres = ['formel', 'ameliorer', ...(cible.garderObjet ? [] : ['objets'])];
    const gestes = ecrit
      ? `<div class="em-ia-gestes" role="group" aria-label="Gestes de l’assistant">${ia ? geste('adapter') : ''}${geste('raccourcir')}${geste('chaleureux')}${menu('traduire', 'Traduire', ['nl', 'en'])}${menu('plus', 'Plus', autres)}</div>`
      : '';
    const placeholder = ecrit ? 'Dites ce qu’il faut changer…' : 'Dites ce que le mail doit dire…';
    const saisie = `<div class="em-ia-saisie">${emIaAnneau()}
        <textarea class="em-ia-brief" rows="2" placeholder="${esc(placeholder)}" aria-label="${ecrit ? 'Ce qu’il faut changer dans le mail' : 'Ce que le mail doit dire'}" data-pl-focus="emails.ia.${cle}" oninput="emIaBrief('${cle}', this.value)" onkeydown="emIaTouche(event, '${cle}')"${verrou}>${esc(e.brief)}</textarea>
        <button type="button" class="pv2-btn em-ia-envoyer" onclick="emIaEnvoyer('${cle}')"${verrou} aria-label="Demander à l’assistant">Demander</button>
      </div>${e.saisie ? `<p class="em-ia-saisie-aide" role="alert">${esc(e.saisie)}</p>` : ''}`;
    emIaDefiler();
    // La phrase d accueil sert avant le premier echange ; « l IA n est pas branchee » se lit tout le temps.
    const saitVu = !e.fil.length || !ia;
    return `<section class="em-ia${colonne ? ' em-ia--colonne' : ' em-ia--bande'}${saitVu ? '' : ' em-ia--suite'}" data-em-ia="${cle}"${occupe ? ' aria-busy="true"' : ''} aria-label="Assistant d’écriture">
      <div class="em-ia-tete"><strong>Assistant</strong>${depart}</div>${saitVu ? `<p class="em-ia-sait">${esc(sait)}</p>` : ''}
      ${fil}${gestes}${saisie}
    </section>`;
  }
  // Le dernier echange reste en vue : la conversation descend a chaque rendu.
  let emIaDefilerPrevu = false;
  function emIaDefiler() {
    if (emIaDefilerPrevu) return;
    emIaDefilerPrevu = true;
    requestAnimationFrame(() => {
      emIaDefilerPrevu = false;
      document.querySelectorAll('.em-ia-fil').forEach((f) => { f.scrollTop = f.scrollHeight; });
    });
  }
  // Ce qui part avec la demande : les derniers echanges, l equipe et l assistant, sans les notes ni les refus.
  function emIaHistorique(e) {
    return e.fil
      .filter((t) => t.qui === 'equipe' || t.qui === 'aide')
      .slice(-10)
      .map((t) => ({ qui: t.qui, texte: String(t.texte || '').slice(0, 600) }));
  }

  window.emIaBrief = function (cle, valeur) { emIaEtat(cle).brief = String(valeur || ''); };
  window.emIaMenu = function (cle, nom, ouvert) {
    const e = emIaEtat(cle);
    if (ouvert) e.menu = nom;
    else if (e.menu === nom) e.menu = '';
  };
  // Un menu de la barre se referme quand on clique ailleurs ou sur Echap.
  document.addEventListener('click', (ev) => {
    document.querySelectorAll('.em-ia-menu[open]').forEach((m) => { if (!m.contains(ev.target)) m.open = false; });
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    document.querySelectorAll('.em-ia-menu[open]').forEach((m) => {
      const dedans = m.contains(document.activeElement);
      m.open = false;
      if (dedans) { const s = m.querySelector('summary'); if (s) s.focus(); }
    });
  });

  // Pendant l appel, les champs de l editeur ne se touchent plus : un rendu
  // qui arrive entre-temps (donnees qui se rafraichissent) reverrouille aussi.
  function emIaVerrouiller() {
    Object.keys(EM_IA).forEach((cle) => {
      const e = EM_IA[cle];
      document.querySelectorAll(`[data-em-ia-editeur="${cle}"]`).forEach((racine) => {
        racine.classList.toggle('is-ia-verrou', Boolean(e.busy));
        racine.querySelectorAll('.pv2-tokedit').forEach((el) => {
          if (e.busy) el.setAttribute('contenteditable', 'false'); else if (el.getAttribute('contenteditable') === 'false') el.setAttribute('contenteditable', 'true');
          el.toggleAttribute('aria-disabled', Boolean(e.busy));
        });
        racine.querySelectorAll('input, textarea, select').forEach((el) => {
          if (el.closest('.em-ia')) return;
          if (e.busy) { if (!el.disabled) { el.disabled = true; el.dataset.emIaBloque = '1'; } } else if (el.dataset.emIaBloque === '1') { el.disabled = false; delete el.dataset.emIaBloque; }
        });
        // Le texte remplace se pose avec un fondu, juste apres le geste : un
        // rendu plus tard ne le rejoue pas.
        if (e.fondu && Date.now() - e.fondu < 300) racine.querySelectorAll('.pv2-tokedit, .pv2-inbox-reply-subject, .em-camp-apercu').forEach((el) => el.classList.add('em-ia-fondu'));
      });
    });
  }
  window.emIaVerrouiller = emIaVerrouiller;

  // Une demande tapee : ecrire un mail vide, ou corriger celui qui est la.
  window.emIaEnvoyer = function (cle) {
    const cible = EM_IA_CIBLES[cle];
    if (!cible) return;
    const e = emIaEtat(cle);
    const brief = String(e.brief || '').trim();
    if (!brief) { e.saisie = cible.lire().body.trim() ? 'Dites en quelques mots ce qu’il faut changer.' : 'Dites en quelques mots ce que le mail doit dire.'; cible.peindre(); return; }
    emIaAppeler(cle, cible.lire().body.trim() ? 'corriger' : 'ecrire', brief);
  };
  // Entree envoie, Maj + Entree va a la ligne.
  window.emIaTouche = function (event, cle) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); window.emIaEnvoyer(cle); }
  };
  window.emIaLancer = function (cle, intention) { emIaAppeler(cle, intention, ''); };
  window.emIaIdee = function (cle, idee) {
    const texte = cle === 'reponse' && idee === 'Écrire la réponse' ? 'Écrivez la réponse au mail du client.' : String(idee || '');
    emIaAppeler(cle, 'ecrire', texte, idee);
  };
  window.emIaToutVoir = function (cle) {
    const cible = EM_IA_CIBLES[cle];
    if (!cible) return;
    emIaEtat(cle).tout = true;
    cible.peindre();
  };

  async function emIaAppeler(cle, intention, brief, vu = '') {
    const cible = EM_IA_CIBLES[cle];
    if (!cible || !emIaPermise()) return;
    const e = emIaEtat(cle);
    if (e.busy) return;
    const actuel = cible.lire();
    e.saisie = '';
    e.menu = '';
    if (intention !== 'ecrire' && intention !== 'corriger' && !actuel.body.trim() && !(intention === 'objets' && actuel.subject.trim())) {
      e.saisie = 'Écrivez d’abord un texte, ou demandez-le à l’assistant.';
      cible.peindre();
      return;
    }
    const historique = emIaHistorique(e);
    const libelle = vu || brief || (EM_IA_GESTES.find(([k]) => k === intention) || [intention, intention])[1];
    e.fil.push({ qui: 'equipe', texte: libelle });
    e.busy = intention;
    if (brief) e.brief = '';
    cible.peindre();
    emIaVerrouiller();
    const corps = { action: 'emailAssist', centerId: state.adminCenterId || 'libramont', intention, contexte: cible.contexte, subject: actuel.subject, body: actuel.body, brief, historique };
    if (cible.recu) corps.recu = cible.recu();
    let payload = null;
    let erreur = '';
    try {
      payload = await apiRequest('/api/ops', { method: 'POST', body: JSON.stringify(corps) });
    } catch (err) {
      // apiRequest leve sur ok:false, en 200 comme en 400 : sa reponse suit.
      payload = (err && err.payload) || null;
      erreur = (err && err.message) || '';
    }
    // Le brouillon a pu changer de main pendant l appel (autre fil, autre modele) : sa conversation est ailleurs.
    if (emIaEtat(cle) !== e) return;
    e.busy = '';
    // UN REFUS NE TOUCHE A RIEN : il s ecrit dans la conversation, et la demande revient dans la saisie.
    const refuser = (texte) => {
      e.fil.push({ qui: 'refus', texte });
      if (brief && !e.brief) e.brief = brief;
      cible.peindre();
      emIaVerrouiller();
    };
    if (!payload || payload.ok === false || erreur) { refuser((payload && payload.message) || erreur || 'L’assistant ne répond pas pour le moment. Votre texte n’a pas changé.'); return; }
    const nouveau = {
      subject: typeof payload.subject === 'string' && !(cible.garderObjet && actuel.subject.trim()) ? payload.subject : actuel.subject,
      body: typeof payload.body === 'string' ? payload.body : actuel.body,
    };
    if (EM_IA_TRANSFORME.has(intention)) {
      // Chaque champ garde SES variables : un objet qui garde {{prenom}} ne couvre pas un texte qui l a perdu
      // (meme regle que le serveur).
      const perdues = [...new Set(['subject', 'body'].flatMap((k) => {
        const apres = emIaVariables(nouveau[k]);
        return [...emIaVariables(actuel[k])].filter((v) => v !== '{{centre}}' && !apres.has(v));
      }))];
      if (perdues.length) { refuser(`L’assistant a perdu ${perdues.join(', ')}. Votre texte n’a pas changé.`); return; }
    }
    const dit = String(payload.message || payload.note || '').trim();
    const conseils = payload.mode === 'regles' ? (Array.isArray(payload.conseils) ? payload.conseils : []).map((c) => String(c || '').trim()).filter(Boolean).slice(0, 4) : [];
    if (intention === 'objets') {
      const objets = (Array.isArray(payload.objets) ? payload.objets : []).map((o) => String(o || '').trim()).filter(Boolean).slice(0, 3);
      e.fil.push({ qui: 'aide', texte: objets.length ? (dit || 'Voici trois objets.') + ' Touchez celui que vous voulez.' : (dit || 'Aucun objet cette fois. Réessayez dans un instant.'), objets });
    } else if (nouveau.subject !== actuel.subject || nouveau.body !== actuel.body) {
      if (!e.depart) e.depart = { ...actuel };
      cible.poser(nouveau);
      e.fil.push({ qui: 'aide', texte: dit || 'C’est fait.', version: { ...nouveau }, conseils });
      e.fondu = Date.now();
    } else {
      e.fil.push({ qui: 'aide', texte: dit || 'Je n’ai rien changé à ce texte.', conseils });
    }
    cible.peindre();
    emIaVerrouiller();
  }

  window.emIaChoisirObjet = function (cle, tour, rang) {
    const cible = EM_IA_CIBLES[cle];
    const e = emIaEtat(cle);
    const t = e.fil[Number(tour)];
    const objet = t && Array.isArray(t.objets) ? t.objets[Number(rang)] : '';
    if (!cible || !objet || e.busy) return;
    const actuel = cible.lire();
    if (!e.depart) e.depart = { ...actuel };
    t.choisi = Number(rang);
    const nouveau = { subject: objet, body: actuel.body };
    cible.poser(nouveau);
    e.fil.push({ qui: 'aide', texte: `Objet remplacé par « ${objet} ».`, version: { ...nouveau } });
    e.fondu = Date.now();
    cible.peindre();
    emIaVerrouiller();
  };
  // Une version de la conversation, remise dans l editeur.
  window.emIaVersion = function (cle, tour) {
    const cible = EM_IA_CIBLES[cle];
    const e = emIaEtat(cle);
    const t = e.fil[Number(tour)];
    if (!cible || !t || !t.version || e.busy) return;
    cible.poser({ subject: t.version.subject, body: t.version.body });
    e.fil.push({ qui: 'note', texte: 'Cette version est revenue dans l’éditeur.' });
    e.fondu = Date.now();
    cible.peindre();
    emIaVerrouiller();
  };
  // Le texte d avant le premier changement de l assistant.
  window.emIaDepart = function (cle) {
    const cible = EM_IA_CIBLES[cle];
    const e = emIaEtat(cle);
    if (!cible || !e.depart || e.busy) return;
    cible.poser({ subject: e.depart.subject, body: e.depart.body });
    e.fil.push({ qui: 'note', texte: 'Votre texte de départ est revenu.' });
    e.fondu = Date.now();
    cible.peindre();
    emIaVerrouiller();
  };

  /* ── LA NAVIGATION : quatre groupes, une colonne qui reste a l ecran ──────
     Meme discipline que le rail du segmente : la position precedente de
     l indicateur vit hors du DOM, on le repose dessus sans transition, reflow,
     puis il glisse. Un simple re-rendu (poll) ne le fait pas bouger d un
     pixel. Un compteur ne s affiche que s il y a quelque chose a traiter : des
     conversations a repondre, des envois en echec, des questions de l agent. */
  function pv2NavCompte(key) {
    if (key === 'recus') {
      const o = pv2Overview.data;
      const n = o && Number.isFinite(Number(o.aRepondre)) ? Number(o.aRepondre) : 0;
      return n > 0 ? { n, ton: 'is-blue', dit: `${n} à répondre` } : null;
    }
    if (key === 'envoyes') {
      const n = getStaffEmailRows().filter((r) => !pv2IsInbound(r) && r.statusKind === 'failed').length;
      return n > 0 ? { n, ton: 'is-red', dit: `${n} en échec` } : null;
    }
    if (key === 'agent') {
      const n = ((typeof opsAdminCache === 'object' && opsAdminCache && opsAdminCache.questions) || []).length;
      return n > 0 ? { n, ton: 'is-blue', dit: `${n} question${n > 1 ? 's' : ''} en attente` } : null;
    }
    return null;
  }

  function pv2SubnavHtml(section) {
    const visibles = PV2_EMAILS_TABS.filter((t) => pv2PeutVoirSection(t.key));
    const groupes = PV2_EMAILS_GROUPS.map((g) => {
      const tabs = visibles.filter((t) => t.group === g.key);
      if (!tabs.length) return '';
      return `<div class="em-nav-group" role="none">
          <span class="em-nav-label" aria-hidden="true">${esc(g.label)}</span>
          ${tabs.map((t) => {
            const active = t.key === section;
            const compte = pv2NavCompte(t.key);
            const badge = compte ? `<span class="em-nav-count pl-subnav-badge ${compte.ton}" aria-label="${esc(compte.dit)}">${compte.n}</span>` : '';
            return `<button type="button" class="em-nav-item pl-subnav-item${active ? ' is-active' : ''}" role="tab" id="pv2EmailsTab-${t.key}" aria-selected="${active}" aria-controls="pv2EmailsPanel" tabindex="${active ? '0' : '-1'}" data-section="${t.key}" data-pl-focus="emails.subnav.${t.key}" onclick="pv2EmailsGo('${t.key}')" onkeydown="pv2EmailsTabKey(event)"><span class="em-nav-text">${esc(t.label)}</span>${badge}</button>`;
          }).join('')}
        </div>`;
    }).join('');
    return `<nav class="em-nav pv2-emails-nav" aria-label="Sections de la page Emails">
      <div class="em-nav-list pl-subnav" role="tablist" aria-label="Sections" aria-orientation="vertical">
        <span class="em-nav-ind pl-subnav-indicator" aria-hidden="true"></span>
        ${groupes}
      </div>
    </nav>`;
  }

  function pv2PoserIndicateurSousNav(root, instant) {
    const nav = root.querySelector('.pl-subnav');
    if (!nav) return;
    const ind = nav.querySelector('.pl-subnav-indicator');
    const active = nav.querySelector('.pl-subnav-item.is-active');
    if (!ind || !active) return;
    const from = PV2_EMAILS_MOTION.subnav;
    // `k` est l echelle sur l axe de la navigation : la hauteur de l onglet en
    // colonne, sa largeur en rangee (base 100 px dans les deux cas).
    const place = (p) => {
      nav.style.setProperty('--pl-subnav-x', `${p.x}px`);
      nav.style.setProperty('--pl-subnav-y', `${p.y}px`);
      nav.style.setProperty('--pl-subnav-k', String((p.axe === 'y' ? p.h : p.w) / 100));
      nav.setAttribute('data-axis', p.axe);
    };
    // Noeud detache ou page cachee : aucune geometrie lisible, on repose la
    // derniere connue et on ne touche pas a la memoire.
    if (!document.contains(nav) || !active.offsetWidth) {
      if (from) { ind.style.transition = 'none'; place(from); void ind.offsetWidth; ind.style.transition = ''; }
      ind.setAttribute('data-moved', '0');
      return;
    }
    // L AXE SE LIT SUR LA PAGE : une colonne sur un ecran large, une rangee qui
    // defile sur un telephone. Le dernier onglet plus bas que le premier, c est
    // une colonne.
    const tabs = nav.querySelectorAll('.pl-subnav-item');
    const axe = tabs.length > 1 && tabs[tabs.length - 1].offsetTop > tabs[0].offsetTop + 2 ? 'y' : 'x';
    nav.setAttribute('aria-orientation', axe === 'y' ? 'vertical' : 'horizontal');
    const to = { key: active.getAttribute('data-section'), x: active.offsetLeft, y: active.offsetTop, w: active.offsetWidth, h: active.offsetHeight, axe };
    // Changer d axe (rotation de tablette) n est pas un geste : on repose sec.
    const moved = !instant && !!(from && from.key && from.key !== to.key && from.axe === to.axe) && !reducedMotion;
    ind.style.transition = 'none';
    place(moved ? from : to);
    void ind.offsetWidth;
    ind.style.transition = '';
    if (moved) place(to);
    PV2_EMAILS_MOTION.subnav = to;
    ind.setAttribute('data-moved', moved ? '1' : '0');
    // En rangee la barre defile : l onglet actif se centre dans la fenetre.
    if (axe === 'x' && nav.scrollWidth > nav.clientWidth + 2) {
      nav.scrollLeft = Math.max(0, active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2);
    }
    if (!PV2_EMAILS_MOTION.subnavResizeBound) {
      PV2_EMAILS_MOTION.subnavResizeBound = true;
      window.addEventListener('resize', () => {
        const live = document.getElementById('staffEmailsPage');
        if (live) pv2PoserIndicateurSousNav(live, true);
      }, { passive: true });
    }
  }

  /* ── ETATS ET CHARGEMENTS ───────────────────────────────────────────────── */
  const pv2Threads = {
    loaded: false, loading: false, error: '', centre: '', serie: 0,
    filtre: 'a-repondre', q: '', qTimer: 0,
    threads: [], total: 0, selectedId: '',
    detail: { id: '', loaded: false, loading: false, error: '', thread: null, messages: [], contact: null, serie: 0 },
    // Les fils deja marques lus dans cette session : une fois par fil, pas a
    // chaque poll ni a chaque re-rendu.
    marquesLus: new Set(),
    reply: {}, replyBusy: '', statusBusy: '',
    // Les cinq conversations de l apercu, chargees a part : le filtre de la
    // section Recus ne doit pas changer ce que la vue globale montre.
    apercu: { loaded: false, loading: false, threads: [] },
  };
  window.pv2Threads = pv2Threads;

  const pv2Overview = { loaded: false, loading: false, error: '', data: null, centre: '' };
  window.pv2Overview = pv2Overview;

  const pv2Design = {
    loaded: false, loading: false, error: '', centre: '',
    design: null, stored: null, defaults: null, presets: [], center: null, logos: [],
    photos: [], formules: [], couleurs: [],
    sample: 'confirmation', dirty: false, busy: '', erreurServeur: '',
  };
  window.pv2Design = pv2Design;

  function pv2CentreCourant() { return state.adminCenterId || 'libramont'; }

  // Changer de centre = les donnees de l autre centre meurent tout de suite
  // (isolation multi-tenant : jamais un fil d un centre affiche chez l autre).
  function pv2PurgerSiCentreChange(cache) {
    const centre = pv2CentreCourant();
    if (cache.centre && cache.centre !== centre) {
      cache.loaded = false;
      if ('data' in cache) cache.data = null;
      if ('threads' in cache) { cache.threads = []; cache.total = 0; cache.selectedId = ''; cache.detail = { id: '', loaded: false, loading: false, error: '', thread: null, messages: [], contact: null, serie: 0 }; cache.reply = {}; cache.apercu = { loaded: false, loading: false, threads: [] }; }
      if ('design' in cache) { cache.design = null; cache.stored = null; cache.dirty = false; }
    }
    cache.centre = centre;
  }

  async function loadPv2Overview(force = false) {
    pv2PurgerSiCentreChange(pv2Overview);
    if (pv2Overview.loading || (pv2Overview.loaded && !force)) return;
    pv2Overview.loading = true;
    pv2Overview.error = '';
    try {
      const payload = await apiRequest(`/api/ops?action=emailOverview&centerId=${encodeURIComponent(pv2CentreCourant())}`);
      pv2Overview.data = payload && typeof payload === 'object' ? payload : {};
    } catch (error) {
      pv2Overview.error = error.message || 'Vue globale indisponible.';
    } finally {
      pv2Overview.loaded = true;
      pv2Overview.loading = false;
      pv2RenderSiActive();
    }
  }
  window.loadPv2Overview = loadPv2Overview;

  async function loadPv2Threads(force = false) {
    pv2PurgerSiCentreChange(pv2Threads);
    if (pv2Threads.loaded && !force) return;
    if (pv2Threads.loading && !force) return;
    pv2Threads.loading = true;
    pv2Threads.error = '';
    const serie = ++pv2Threads.serie;
    try {
      const params = new URLSearchParams({ action: 'emailThreads', centerId: pv2CentreCourant(), filtre: pv2Threads.filtre, limit: '50' });
      if (String(pv2Threads.q || '').trim()) params.set('q', String(pv2Threads.q).trim());
      const payload = await apiRequest(`/api/ops?${params.toString()}`);
      if (serie !== pv2Threads.serie) return;
      pv2Threads.threads = Array.isArray(payload.threads) ? payload.threads : [];
      pv2Threads.total = Number.isFinite(Number(payload.total)) ? Number(payload.total) : pv2Threads.threads.length;
      pv2Threads.loaded = true;
    } catch (error) {
      if (serie !== pv2Threads.serie) return;
      pv2Threads.error = error.message || 'Conversations indisponibles.';
      pv2Threads.loaded = true;
    } finally {
      if (serie === pv2Threads.serie) pv2Threads.loading = false;
      pv2RenderSiActive();
    }
  }
  window.loadPv2Threads = loadPv2Threads;

  async function loadPv2ThreadsApercu(force = false) {
    const a = pv2Threads.apercu;
    if (a.loading || (a.loaded && !force)) return;
    a.loading = true;
    try {
      const params = new URLSearchParams({ action: 'emailThreads', centerId: pv2CentreCourant(), filtre: 'a-repondre', limit: '5' });
      const payload = await apiRequest(`/api/ops?${params.toString()}`);
      a.threads = Array.isArray(payload.threads) ? payload.threads : [];
    } catch (error) {
      a.threads = [];
    } finally {
      a.loaded = true;
      a.loading = false;
      pv2RenderSiActive();
    }
  }

  async function loadPv2ThreadDetail(id, force = false) {
    const d = pv2Threads.detail;
    const cle = String(id || '');
    if (!cle) return;
    const meme = String(d.id) === cle;
    if (meme && (d.loading || (d.loaded && !force))) return;
    if (!meme) { d.loaded = false; d.thread = null; d.messages = []; d.contact = null; }
    d.id = cle;
    d.loading = true;
    d.error = '';
    const serie = ++d.serie;
    try {
      const payload = await apiRequest(`/api/ops?action=emailThread&centerId=${encodeURIComponent(pv2CentreCourant())}&id=${encodeURIComponent(cle)}`);
      if (serie !== d.serie) return;
      d.thread = payload && payload.thread && typeof payload.thread === 'object' ? payload.thread : null;
      d.messages = Array.isArray(payload && payload.messages) ? payload.messages : [];
      d.contact = payload && payload.contact && typeof payload.contact === 'object' ? payload.contact : null;
      d.loaded = true;
      if (!d.thread) d.error = 'Conversation introuvable.';
      else pv2ThreadApresOuverture(d);
    } catch (error) {
      if (serie !== d.serie) return;
      d.error = error.message || 'Conversation indisponible.';
      d.loaded = true;
    } finally {
      if (serie === d.serie) d.loading = false;
      pv2RenderSiActive();
    }
  }
  window.loadPv2ThreadDetail = loadPv2ThreadDetail;

  // A l ouverture d un fil : les messages recus que JE n ai pas encore lus sont
  // marques lus (une fois par fil et par session), et je prends la main sur le
  // dernier message recu tant que la conversation attend une reponse.
  // LE FONDATEUR NE LIT POUR PERSONNE (2026-11-13) : il ouvre sans rien marquer,
  // ni au serveur ni dans « Ouvert par » de son ecran ; le mail reste nouveau
  // pour l equipe.
  function pv2ThreadApresOuverture(d) {
    const fil = d.thread;
    if (!fil) return;
    const moi = pv2MonIdentifiant();
    const cle = String(fil.id);
    const fondateur = typeof canUseStaffPermission === 'function' && canUseStaffPermission('platform.admin');
    const nonLus = d.messages.filter((m) => m.direction === 'inbound' && m.id && !(Array.isArray(m.lectures) && moi && m.lectures.some((l) => String(l.memberId) === moi)));
    if (!fondateur && nonLus.length && !pv2Threads.marquesLus.has(cle)) {
      pv2Threads.marquesLus.add(cle);
      const session = state.staffAuthSession || {};
      const membre = session.member || {};
      const role = session.role || {};
      apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'markCommunicationRead', centerId: pv2CentreCourant(), communicationIds: nonLus.map((m) => Number(m.id)) }),
      }).then(() => {
        // Ce que le serveur vient d enregistrer se lit tout de suite dans la
        // trace, sans recharger le fil.
        const maintenant = new Date().toISOString();
        nonLus.forEach((m) => {
          if (!Array.isArray(m.lectures)) m.lectures = [];
          if (moi && !m.lectures.some((l) => String(l.memberId) === moi)) {
            m.lectures.push({ memberId: moi, memberName: String(membre.name || ''), memberRole: String(role.name || ''), firstReadAt: maintenant, lastReadAt: maintenant, readCount: 1 });
          }
        });
        const ligne = pv2Threads.threads.find((t) => String(t.id) === cle);
        const moiLecteur = { memberId: moi, memberName: String(membre.name || ''), memberRole: String(role.name || ''), lastReadAt: maintenant };
        if (ligne) { ligne.luParMoi = true; ligne.lecteurs = [...(ligne.lecteurs || []).filter((l) => String(l.memberId) !== moi), moiLecteur]; }
        const apercu = pv2Threads.apercu.threads.find((t) => String(t.id) === cle);
        if (apercu) { apercu.luParMoi = true; apercu.lecteurs = [...(apercu.lecteurs || []).filter((l) => String(l.memberId) !== moi), moiLecteur]; }
        pv2RenderSiActive();
      }).catch(() => {
        // Une lecture non enregistree ne bloque rien : on la retentera a la
        // prochaine ouverture de ce fil dans une autre session.
        pv2Threads.marquesLus.delete(cle);
      });
    }
    const entrant = pv2ThreadDernierEntrant(d.messages);
    if (entrant && entrant.id && fil.status === 'open') pv2PrendreLaMain(entrant.id);
  }

  window.pv2ThreadOpen = function (id) {
    const cle = String(id || '');
    if (!cle) return;
    pv2Threads.selectedId = cle;
    // Un fil ouvert depuis ailleurs (apercu, envoyes) peut ne pas etre dans
    // le filtre courant : on elargit a « Tous » pour que la liste le montre.
    if (pv2Threads.loaded && !pv2Threads.threads.some((t) => String(t.id) === cle) && pv2Threads.filtre !== 'tous') {
      pv2Threads.filtre = 'tous';
      loadPv2Threads(true);
    }
    loadPv2ThreadDetail(cle);
    if (state.staffEmailsSection !== 'recus') pv2EmailsGo('recus');
    else renderStaffEmailsPage();
    setTimeout(() => {
      const ligne = document.querySelector(`#staffEmailsPage .pv2-thread-row[data-thread-id="${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(cle) : cle}"]`);
      if (ligne && ligne.scrollIntoView) ligne.scrollIntoView({ block: 'nearest' });
    }, 0);
  };

  // Depuis une ligne de communication (mail recu de la file historique) : le
  // fil qu elle porte, sinon celui dont elle est le dernier message recu.
  function pv2ThreadOpenForCommunication(row) {
    const fil = row.threadId || (pv2Threads.threads.find((t) => Number(t.lastInboundId) === Number(row.id)) || {}).id;
    if (fil) { pv2ThreadOpen(fil); return; }
    // Sans fil connu (message anterieur a la migration) : la section Recus
    // s ouvre, la recherche vise l expediteur.
    pv2Threads.q = String((row.payload && row.payload.from) || row.recipient || '');
    pv2Threads.filtre = 'tous';
    pv2Threads.loaded = false;
    pv2EmailsGo('recus');
  }

  window.pv2ThreadsFilter = function (key) {
    const allowed = ['a-repondre', 'repondus', 'termines', 'tous'];
    pv2Threads.filtre = allowed.includes(key) ? key : 'a-repondre';
    loadPv2Threads(true);
    renderStaffEmailsPage();
  };

  // La recherche part 300 ms apres la derniere frappe ; aucun rendu pendant
  // la frappe (le champ garderait son focus grace a garderFocus, mais un rendu
  // par lettre reste du travail inutile).
  window.pv2ThreadsSearch = function (value) {
    pv2Threads.q = String(value || '');
    clearTimeout(pv2Threads.qTimer);
    pv2Threads.qTimer = setTimeout(() => loadPv2Threads(true), 300);
  };

  // Apres un mail colle (analyse) : les listes de fils sont a recharger.
  window.pv2ThreadsInvalider = function () {
    pv2Threads.loaded = false;
    pv2Threads.apercu.loaded = false;
  };

  // LA SYNCHRONISATION EN DIRECT (assets/ops-live.js) appelle ceci quand le
  // pouls annonce du neuf. Les conversations, la vue globale et le fil ouvert
  // sont relus comme les communications : sans cela, un mail arrive restait
  // invisible dans Recus et dans l Apercu jusqu a un rechargement a la main.
  // Les brouillons de reponse et la selection ne bougent pas.
  // LE DIRECT, POUR LES CACHES DE CE FICHIER (appele par app-main :
  // invalidateLiveSyncCaches puis rechargerLaPagePourLeDirect). `familles` : les
  // domaines qui ont bouge sur un autre poste ; `relire` : vrai quand la page
  // affichee les montre et que personne n ecrit. Un cache que la page ne montre
  // pas est oublie : il se relira quand sa page s ouvrira, rien n est demande au
  // serveur pour un ecran que personne ne regarde.
  window.pv2Direct = function (familles, page, relire) {
    const a = (nom) => Boolean(familles && typeof familles.has === 'function' && familles.has(nom));
    const affiche = (...pages) => pages.includes(page);
    const section = typeof state !== 'undefined' ? state.staffEmailsSection : '';
    // Le catalogue tarifaire : page Tarifs, onglet Offres d Etablissement.
    if (a('catalogue') || a('config')) {
      if (affiche('prices', 'establishment')) { if (relire) pevReload(); }
      else window.pevResetCatalogCache();
    }
    // La note du client ouvert : sa cle oubliee, le rendu la relit.
    if (a('notes')) {
      if (affiche('clients', 'groups')) {
        if (relire && !crmNotes.loading && !crmNotes.saving) { crmNotes.key = ''; renderStaffClientsPage(); }
      } else crmNotes.key = '';
    }
    // Les sequences automatiques (Emails, section Sequences).
    if (a('config')) {
      if (affiche('emails') && section === 'sequences') { if (relire) loadStaffAutomations(true); }
      else mkAuto.loaded = false;
    }
    // Les campagnes (Emails, section Campagnes, et la page Campagnes).
    if (a('courrier')) {
      if (affiche('campaigns') || (affiche('emails') && section === 'campagnes')) { if (relire) loadPv2Campaigns(true); }
      else pv2Camp.loaded = false;
    }
  };

  window.pv2EmailsSurSynchro = function () {
    const section = typeof state !== 'undefined' ? state.staffEmailsSection : '';
    pv2Overview.loaded = false;
    pv2Threads.loaded = false;
    pv2Threads.apercu.loaded = false;
    if (['apercu', 'recus', 'envoyes', 'sequences'].includes(section)) loadPv2Overview(true);
    if (section === 'apercu') loadPv2ThreadsApercu(true);
    if (section === 'recus') {
      loadPv2Threads(true);
      if (pv2Threads.detail && pv2Threads.detail.id) loadPv2ThreadDetail(pv2Threads.detail.id, true);
    }
  };

  window.pv2ThreadSetStatus = async function (id, status) {
    if (pv2Threads.statusBusy) return;
    const cle = String(id || '');
    if (!cle || !['open', 'answered', 'closed'].includes(status)) return;
    pv2Threads.statusBusy = cle;
    renderStaffEmailsPage();
    try {
      const payload = await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'setThreadStatus', centerId: pv2CentreCourant(), threadId: Number(cle) || cle, status }),
      });
      const fil = payload && payload.thread;
      if (fil && pv2Threads.detail.thread && String(pv2Threads.detail.thread.id) === cle) pv2Threads.detail.thread = { ...pv2Threads.detail.thread, ...fil };
      const ligne = pv2Threads.threads.find((t) => String(t.id) === cle);
      if (ligne && fil) Object.assign(ligne, fil);
      toast(status === 'closed' ? 'Conversation terminée : elle passe dans Terminés.' : 'Conversation rouverte : elle revient dans À répondre.');
      // Le suivi suit la conversation : l onglet de son nouveau statut, fil ouvert.
      if (pv2Threads.filtre !== 'tous') pv2Threads.filtre = status === 'closed' ? 'termines' : status === 'open' ? 'a-repondre' : 'repondus';
      pv2Threads.selectedId = cle;
      pv2Threads.apercu.loaded = false;
      loadPv2ThreadsApercu(true);
      loadPv2Threads(true);
      loadPv2Overview(true);
    } catch (error) {
      toast(error.message || 'Impossible de changer le statut.');
    } finally {
      pv2Threads.statusBusy = '';
      renderStaffEmailsPage();
    }
  };

  // La fiche client : la page Clients s ouvre filtree sur cette adresse.
  window.pv2ThreadVoirClient = function (email) {
    state.staffClientQuery = String(email || '');
    state.staffClientSegment = 'tous';
    save();
    if (typeof openStaffMenuPage === 'function') openStaffMenuPage('clients');
  };

  // Le mail sortant TEL QU ENVOYE (HTML stocke), en grand, dans l iframe
  // sandbox de la console.
  window.pv2ThreadVoirMail = function (messageId) {
    const m = (pv2Threads.detail.messages || []).find((x) => String(x.id) === String(messageId));
    if (!m || !m.body) { toast('Le contenu complet de ce mail n\'est pas disponible.'); return; }
    previewOpsEmailHtml(m.body, m.subject || 'Mail envoyé');
  };

  async function loadPv2Design(force = false) {
    pv2PurgerSiCentreChange(pv2Design);
    if (pv2Design.loading || (pv2Design.loaded && !force)) return;
    pv2Design.loading = true;
    pv2Design.error = '';
    try {
      const payload = await apiRequest(`/api/ops?action=emailDesign&centerId=${encodeURIComponent(pv2CentreCourant())}`);
      const design = payload && payload.design && typeof payload.design === 'object' ? payload.design : null;
      // Le brouillon en cours n est pas ecrase par un rechargement de fond :
      // ce que la gerante a tape sans enregistrer reste devant elle.
      if (!pv2Design.dirty || !pv2Design.design) pv2Design.design = pv2DesignNormaliser(design);
      pv2Design.stored = payload && payload.stored && typeof payload.stored === 'object' ? payload.stored : null;
      pv2Design.defaults = pv2DesignNormaliser(payload && payload.defaults);
      pv2Design.presets = Array.isArray(payload && payload.presets) && payload.presets.length ? payload.presets : PV2_DESIGN_PRESETS;
      pv2Design.familles = Array.isArray(payload && payload.familles) ? payload.familles : [];
      pv2Design.center = payload && payload.center && typeof payload.center === 'object' ? payload.center : null;
      pv2Design.logos = Array.isArray(payload && payload.logos) ? payload.logos : [];
      pv2Design.photos = Array.isArray(payload && payload.photos) ? payload.photos : [];
      pv2Design.formules = Array.isArray(payload && payload.formules) ? payload.formules : [];
      pv2Design.couleurs = Array.isArray(payload && payload.couleurs) ? payload.couleurs : [];
      pv2Design.reponse = payload && payload.reponse && typeof payload.reponse === 'object' ? payload.reponse : null;
      pv2Design.loaded = true;
      pv2ApercuDesign(0);
    } catch (error) {
      pv2Design.error = error.message || 'Apparence indisponible.';
      pv2Design.loaded = true;
    } finally {
      pv2Design.loading = false;
      pv2RenderSiActive();
    }
  }
  window.loadPv2Design = loadPv2Design;

  const PV2_DESIGN_PRESETS = [
    { id: 'simple', label: 'Mail simple', description: 'Comme un mail écrit à la main, sans titre ni cadre. Le texte, puis la signature.' },
    { id: 'classique', label: 'Classique', description: 'Carte blanche à filet fin sur fond gris, nom du centre en tête.' },
    { id: 'epure', label: 'Épuré', description: 'Sans carte, sur fond blanc, avec de grandes marges et un filet fin sous le titre.' },
    { id: 'carte', label: 'Carte', description: 'La carte classique avec une barre de couleur en haut.' },
    { id: 'contraste', label: 'Contraste', description: 'Bandeau d\'en-tête sombre avec le nom ou le logo blanc du centre.' },
  ];
  // Les formules de fin quand le serveur n en envoie pas (meme liste que
  // lib/email-design.js). Jamais « À très bientôt » : la plus plate.
  const PV2_FORMULES = ['Funement vôtre,', 'À très vite pour une nouvelle partie !', 'On vous garde une piste !', 'Rendez-vous sur les pistes !', 'Au plaisir de vous revoir,'];
  // Le nom et la phrase d un gabarit sont ceux de la console quand elle le
  // connait : le catalogue du serveur (lib/email-design.js) les ecrit sans
  // accents. Un gabarit qu elle ne connait pas garde ceux du serveur.
  function pv2DesignGabarits() {
    const liste = pv2Design.presets.length ? pv2Design.presets : PV2_DESIGN_PRESETS;
    return liste.map((p) => ({ ...p, ...(PV2_DESIGN_PRESETS.find((x) => x.id === p.id) || {}) }));
  }

  // Le modele §4.1 complet : un design venu du serveur peut etre partiel
  // (ancien enregistrement), un formulaire n a pas le droit de lire undefined.
  function pv2DesignVide() {
    return {
      preset: 'classique',
      accent: { mode: 'encre', hex: '' },
      header: { mode: 'nom', logoUrl: '', logoWidth: 140 },
      footer: { adresse: true, telephone: true, email: true, mention: '' },
      signature: {
        enabled: true, closing: PV2_FORMULES[PV2_FORMULES.length - 1], accroche: '', teamLabel: '', role: '', phone: '', email: '', website: '', address: '',
        logoUrl: '', logoWidth: 120, socials: { facebook: '', instagram: '', tiktok: '', linkedin: '' }, layout: 'carte',
        photo: { enabled: false, url: '' }, afficher: { telephone: true, email: true, site: true, adresse: true, reseaux: true },
      },
      signatureScope: { manual: true, sequences: true, campaigns: false },
      updatedAt: null, updatedBy: '',
    };
  }
  function pv2DesignNormaliser(source) {
    const base = pv2DesignVide();
    const s = source && typeof source === 'object' ? source : {};
    const objet = (a, b) => ({ ...a, ...(b && typeof b === 'object' ? b : {}) });
    return {
      ...base,
      ...s,
      accent: objet(base.accent, s.accent),
      header: objet(base.header, s.header),
      footer: objet(base.footer, s.footer),
      signature: {
        ...objet(base.signature, s.signature),
        socials: objet(base.signature.socials, s.signature && s.signature.socials),
        photo: objet(base.signature.photo, s.signature && s.signature.photo),
        afficher: objet(base.signature.afficher, s.signature && s.signature.afficher),
      },
      signatureScope: objet(base.signatureScope, s.signatureScope),
    };
  }

  function pv2DesignPoser(path, value) {
    if (!pv2Design.design) pv2Design.design = pv2DesignVide();
    const parts = String(path).split('.');
    let o = pv2Design.design;
    for (let i = 0; i < parts.length - 1; i += 1) {
      if (!o[parts[i]] || typeof o[parts[i]] !== 'object') o[parts[i]] = {};
      o = o[parts[i]];
    }
    o[parts[parts.length - 1]] = value;
    pv2Design.dirty = true;
    pv2Design.erreurServeur = '';
  }

  function pv2ApercuDesign(delai = 500) {
    if (!pv2Design.design) return;
    pv2PlanifierApercu('design', () => ({
      action: 'emailDesignPreview',
      centerId: pv2CentreCourant(),
      design: JSON.parse(JSON.stringify(pv2Design.design)),
      sample: pv2Design.sample,
    }), delai);
    pv2GalerieCharger(Math.max(700, delai));
  }

  /* ── LA GALERIE DES GABARITS (2026-11-12) ────────────────────────────────
     Chaque gabarit en vignette : le vrai mail du centre, rendu par le serveur
     avec le brouillon (sa couleur, sa signature), en une requete. Elle suit le
     grand apercu, un peu plus tard. Les vignettes d un autre centre ne se
     montrent jamais : elles portent le centre pour lequel elles ont ete faites. */
  const PV2_GALERIE = { timer: 0, ctrl: null, serie: 0, centre: '', vignettes: {} };
  function pv2GalerieCharger(delai = 700) {
    clearTimeout(PV2_GALERIE.timer);
    PV2_GALERIE.timer = setTimeout(async () => {
      if (!pv2Design.design) return;
      if (PV2_GALERIE.ctrl) PV2_GALERIE.ctrl.abort();
      const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      PV2_GALERIE.ctrl = ctrl;
      const serie = ++PV2_GALERIE.serie;
      const centre = pv2CentreCourant();
      try {
        const payload = await apiRequest('/api/ops', { method: 'POST', body: JSON.stringify({ action: 'emailDesignGallery', centerId: centre, design: JSON.parse(JSON.stringify(pv2Design.design)) }), signal: ctrl ? ctrl.signal : undefined });
        if (serie !== PV2_GALERIE.serie || centre !== pv2CentreCourant()) return;
        const vignettes = {};
        (Array.isArray(payload && payload.vignettes) ? payload.vignettes : []).forEach((v) => { if (v && v.id) vignettes[String(v.id)] = String(v.html || ''); });
        PV2_GALERIE.centre = centre;
        PV2_GALERIE.vignettes = vignettes;
        pv2GaleriePeindre();
      } catch (error) {
        // Une galerie indisponible garde ses vignettes d avant ; les noms restent cliquables.
      }
    }, delai);
  }
  function pv2GalerieVignette(id) {
    return PV2_GALERIE.centre === pv2CentreCourant() ? (PV2_GALERIE.vignettes[id] || '') : '';
  }
  function pv2GaleriePeindre() {
    document.querySelectorAll('#staffEmailsPage iframe[data-pv2-frame^="galerie-"]').forEach((frame) => {
      const cle = frame.getAttribute('data-pv2-frame');
      const html = pv2GalerieVignette(cle.slice('galerie-'.length));
      PV2_FRAMES[cle] = html;
      if (frame.__pv2Html !== html) pv2ReposerCadre(frame, html);
    });
  }
  // Les familles dans l ordre du serveur ; un gabarit sans famille (serveur plus
  // ancien que la console) tombe dans la premiere, une liste sans familles reste d un bloc.
  function pv2DesignFamillesDe(presets) {
    const connues = Array.isArray(pv2Design.familles) ? pv2Design.familles.filter((f) => f && f.id) : [];
    if (!connues.length) return [{ id: 'tous', label: '', aide: '', gabarits: presets }];
    const groupes = connues.map((f) => ({ id: String(f.id), label: String(f.label || ''), aide: String(f.aide || ''), gabarits: [] }));
    presets.forEach((p) => { (groupes.find((g) => g.id === p.famille) || groupes[0]).gabarits.push(p); });
    return groupes.filter((g) => g.gabarits.length);
  }

  // Un champ texte : pas de rendu (le focus reste), apercu 500 ms apres.
  window.pv2DesignField = function (path, value) {
    const nombre = /logoWidth$/.test(path);
    pv2DesignPoser(path, nombre ? Number(value) : value);
    pv2ApercuDesign();
  };
  // Un choix (gabarit, mode, interrupteur) : le formulaire change de forme,
  // donc rendu, et apercu tout de suite.
  window.pv2DesignChoix = function (path, value) {
    pv2DesignPoser(path, value);
    renderStaffEmailsPage();
    pv2ApercuDesign(120);
  };
  window.pv2DesignBascule = function (path) {
    const parts = String(path).split('.');
    let o = pv2Design.design || pv2DesignVide();
    for (let i = 0; i < parts.length - 1; i += 1) o = o[parts[i]] || {};
    pv2DesignChoix(path, !o[parts[parts.length - 1]]);
  };
  window.pv2DesignFormule = function (texte) {
    pv2DesignChoix('signature.closing', String(texte || ''));
  };
  // Allumer la photo choisit la premiere du centre si aucune ne l est encore :
  // jamais une signature qui attend une photo.
  window.pv2DesignPhotoBascule = function () {
    const s = (pv2Design.design || pv2DesignVide()).signature;
    const allumee = Boolean(s.photo && s.photo.enabled);
    const premiere = (pv2Design.photos || [])[0];
    if (!allumee && !(s.photo && s.photo.url) && premiere) pv2DesignPoser('signature.photo.url', premiere.url);
    pv2DesignChoix('signature.photo.enabled', !allumee);
  };
  window.pv2DesignPhoto = function (url) {
    pv2DesignPoser('signature.photo.enabled', true);
    pv2DesignChoix('signature.photo.url', String(url || ''));
  };
  // La couleur du mail : l encre, une couleur du centre (la premiere est « la
  // couleur du centre », les autres deviennent une couleur personnalisee), ou
  // une couleur a soi.
  window.pv2DesignTeinte = function (valeur) {
    const v = String(valeur || '');
    if (v === 'encre' || v === 'centre') {
      pv2DesignPoser('accent.hex', '');
      pv2DesignChoix('accent.mode', v);
      return;
    }
    if (/^#[0-9a-f]{6}$/i.test(v)) {
      pv2DesignPoser('accent.hex', v.toLowerCase());
      pv2DesignChoix('accent.mode', 'perso');
      return;
    }
    const d = pv2Design.design || pv2DesignVide();
    if (!/^#[0-9a-f]{6}$/i.test(String(d.accent.hex || ''))) pv2DesignPoser('accent.hex', '#0a0a0a');
    pv2DesignChoix('accent.mode', 'perso');
  };
  const PV2_DESIGN_EXEMPLES = { confirmation: 'Confirmation', reponse: 'Réponse à un client', campagne: 'Campagne' };
  window.pv2DesignSample = function (key) {
    pv2Design.exempleCourt = false;
    pv2Design.sample = ['confirmation', 'reponse', 'campagne'].includes(key) ? key : 'confirmation';
    renderStaffEmailsPage();
    pv2ApercuDesign(0);
  };
  window.pv2DesignReset = function () {
    if (!pv2Design.defaults) return;
    pv2Design.design = pv2DesignNormaliser(pv2Design.defaults);
    pv2Design.dirty = true;
    pv2Design.erreurServeur = '';
    renderStaffEmailsPage();
    pv2ApercuDesign(0);
    toast('Défauts rétablis. Enregistrez pour les appliquer.');
  };
  window.pv2DesignSave = async function () {
    if (pv2Design.busy || !pv2Design.design) return;
    if (typeof canUseStaffPermission === 'function' && !canUseStaffPermission(['settings.manage', 'emails.send'])) { toast('Votre rôle ne permet pas de modifier l’apparence des mails.'); return; }
    pv2Design.busy = 'save';
    pv2Design.erreurServeur = '';
    renderStaffEmailsPage();
    try {
      const payload = await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'emailDesign', centerId: pv2CentreCourant(), design: pv2Design.design }),
      });
      if (payload && payload.design) {
        pv2Design.design = pv2DesignNormaliser(payload.design);
        pv2Design.stored = payload.design;
      }
      pv2Design.dirty = false;
      toast('Apparence enregistrée ✓ : elle s\'applique aux prochains mails.');
      pv2ApercuDesign(0);
    } catch (error) {
      // L erreur de validation du serveur (en francais, exposable) se lit sous
      // les actions, pas seulement dans un toast qui disparait.
      pv2Design.erreurServeur = error.message || 'Enregistrement impossible.';
    } finally {
      pv2Design.busy = '';
      renderStaffEmailsPage();
    }
  };
  window.pv2DesignTest = async function () {
    if (pv2Design.busy || !pv2Design.design) return;
    if (typeof canUseStaffPermission === 'function' && !canUseStaffPermission('emails.send')) { toast('Votre rôle ne permet pas d’envoyer des mails.'); return; }
    pv2Design.busy = 'test';
    renderStaffEmailsPage();
    try {
      // Aucune adresse n est envoyee : le serveur envoie au membre connecte.
      const payload = await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'sendDesignTest', centerId: pv2CentreCourant(), design: pv2Design.design, sample: pv2Design.sample }),
      });
      if (payload.status === 'sent') toast(`Test envoyé à ${payload.recipient}`);
      else toast(`Le test n'est pas parti (${payload.error || 'cause inconnue'}).`);
    } catch (error) {
      toast(error.message || 'Envoi de test impossible.');
    } finally {
      pv2Design.busy = '';
      renderStaffEmailsPage();
    }
  };

  /* ── QUI ECRIT : le bandeau, a partir d une prise ───────────────────────── */
  function pv2BandeauPriseHtml(prise) {
    if (!prise) return '';
    const nom = String(prise.memberName || prise.memberId || 'Quelqu\'un');
    // Le ROLE, quand il est connu : dans un centre ou plusieurs personnes se
    // relaient, savoir que c est la direction qui repond, et pas un equipier du
    // bar, change ce qu on fait ensuite.
    const role = String(prise.memberRole || '').trim();
    const depuis = prise.claimedAt ? Math.max(0, Math.round((Date.now() - new Date(prise.claimedAt).getTime()) / 60000)) : 0;
    const quand = depuis >= 1 ? ` depuis ${depuis} min` : ' à l\'instant';
    return `<div class="pv2-prise-alerte" role="status">${ci('alert')}<span><strong>${esc(nom)}</strong>${role ? ` <span class="pv2-prise-role">${esc(role)}</span>` : ''} s'occupe de ce message${esc(quand)}. Écrivez aussi si vous voulez, mais le client recevrait deux réponses.</span></div>`;
  }

  // Le bandeau se veut factuel : QUI, et DEPUIS QUAND. Pas d interdiction, pas
  // de bouton grise : la personne devant l ecran sait des choses que le produit
  // ignore (le collegue vient de partir, il a demande de reprendre). Elle
  // decide, informee.
  function pv2BandeauPrise(row) {
    return pv2BandeauPriseHtml(pv2PriseDunAutre(row));
  }

  // La prise d un autre sur un message du fil : la liste vivante des prises
  // (opsAdminCache.claims, rafraichie par le poll) fait foi ; a defaut, la
  // prise que le serveur a jointe au fil.
  function pv2PriseDunAutreSurLeFil(entrant, fil) {
    if (!entrant) return null;
    const cache = typeof opsAdminCache === 'object' && opsAdminCache && Array.isArray(opsAdminCache.claims) && opsAdminCache.loaded;
    if (cache) return pv2PriseDunAutre({ id: entrant.id });
    const prise = entrant.prise || (fil && fil.prise) || null;
    if (!prise) return null;
    const moi = pv2MonIdentifiant();
    if (moi && String(prise.memberId) === moi) return null;
    if (prise.expiresAt && new Date(prise.expiresAt).getTime() < Date.now()) return null;
    return prise;
  }

  /* ── PETITS OUTILS DE LECTURE ───────────────────────────────────────────── */
  function pv2Quand(value) {
    const t = formatOpsTimestamp(value);
    return t && t !== 'Non planifié' ? t : '';
  }
  function pv2Depuis(value) {
    const t = value ? new Date(value).getTime() : NaN;
    if (!Number.isFinite(t)) return '';
    const min = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (min < 60) return `${min} min`;
    const h = Math.round(min / 60);
    if (h < 48) return `${h} h`;
    return `${Math.round(h / 24)} jours`;
  }
  function pv2Relatif(value) {
    return typeof staffRequestMoment === 'function' ? staffRequestMoment(value) : pv2Quand(value);
  }
  function pv2Nombre(value) {
    return Number.isFinite(Number(value)) ? Number(value) : null;
  }
  // Le suivi d ouverture est une CAPACITE du domaine d envoi, pas un fait sur
  // chaque mail : null = on ne sait pas encore (vue globale non chargee).
  function pv2OuverturesObservees() {
    const o = pv2Overview.data;
    if (!o || !o.suivi || typeof o.suivi !== 'object') return null;
    return Boolean(o.suivi.ouverturesObservees);
  }
  const PV2_THREAD_STATUS = { open: ['À répondre', 'amber'], answered: ['Répondu', 'green'], closed: ['Terminé', ''] };
  // `manual` est la cle historique de la console (getStaffEmailOrigin), `manuel`
  // celle du serveur (origineDuMessage) : les deux se lisent pareil.
  const PV2_ORIGINE_LABELS = { auto: 'Automatique', manuel: 'Manuel', manual: 'Manuel', campagne: 'Campagne', test: 'Test', inbound: 'Reçu' };
  const PV2_EVENT_LABELS = { sent: 'Envoyé', delivered: 'Remis', delivery_delayed: 'Remise retardée', opened: 'Ouvert', clicked: 'Cliqué', bounced: 'Rebond', complained: 'Signalé comme indésirable', failed: 'Échec' };

  /* ── APERCU ───────────────────────────────────────────────────────────── */
  // UNE BANDE DE QUATRE CHIFFRES (2026-11-10) : le nombre tel quel, sans
  // compteur qui defile ni grand chiffre decoratif. Chaque chiffre mene a la
  // liste qu il resume.
  function pv2TuileHtml({ label, value, foot, go, danger = false }) {
    const n = pv2Nombre(value);
    return `<button type="button" class="em-kpi pv2-stat${danger && n > 0 ? ' is-danger' : ''}" onclick="${go}">
      <span class="em-kpi-label pv2-stat-label">${esc(label)}</span>
      <span class="em-kpi-value pv2-stat-value${n === null ? ' is-empty' : ''}">${n === null ? 'indisponible' : esc(n.toLocaleString('fr-BE'))}</span>
      <span class="em-kpi-foot pv2-stat-foot">${esc(foot || '')}</span>
    </button>`;
  }

  function pv2SuiviHtml(o) {
    if (!o) {
      return `<div class="pv2-suivi"><div class="pv2-suivi-ligne"><strong>Suivi des envois</strong><span class="pv2-suivi-etat">${pv2Overview.error ? 'indisponible' : 'chargement…'}</span></div></div>`;
    }
    const suivi = o.suivi && typeof o.suivi === 'object' ? o.suivi : null;
    const evenements = suivi ? Boolean(suivi.evenementsRecus30j) : null;
    const ouvertures = suivi ? Boolean(suivi.ouverturesObservees) : null;
    const remis7 = pv2Nombre(o.remis7j);
    const ouverts7 = pv2Nombre(o.ouverts7j);
    return `<div class="pv2-suivi">
      <div class="pv2-suivi-ligne">
        <strong>Remise confirmée</strong>
        <span class="pv2-suivi-etat${evenements ? ' is-on' : ''}">${evenements === null ? 'indisponible' : evenements ? (remis7 !== null ? `${remis7} sur 7 j` : 'suivie') : 'aucune sur 30 j'}</span>
        ${evenements === false ? '<small>Le service d\'envoi n\'a confirmé aucune remise pour ce centre depuis 30 jours.</small>' : ''}
      </div>
      <div class="pv2-suivi-ligne">
        <strong>Ouvertures par le client</strong>
        <span class="pv2-suivi-etat${ouvertures ? ' is-on' : ''}">${ouvertures === null ? 'indisponible' : ouvertures ? (ouverts7 !== null ? `${ouverts7} sur 7 j` : 'suivies') : 'pas suivies'}</span>
        ${ouvertures === false ? '<small>Le suivi des ouvertures s\'active sur le domaine d\'envoi du centre. Tant qu\'il est inactif, aucune ouverture ne remonte.</small>' : ''}
      </div>
      <div class="pv2-suivi-ligne">
        <strong>Lecture par l'équipe</strong>
        <span class="pv2-suivi-etat is-on">suivie</span>
        <small>Pinlane note qui a ouvert chaque mail reçu, et quand.</small>
      </div>
    </div>`;
  }

  // Une ligne par sequence : son nom, ce qu elle a envoye sur 30 jours, son
  // interrupteur. Les interrupteurs ecrivent (automationSettings,
  // customSequences : settings.manage ou emails.send) ; sans ce droit, l etat
  // se lit en texte.
  function pv2SeqMiniHtml() {
    if (!mkAuto.loaded && !mkAuto.error) return `<div class="em-attente" aria-live="polite" aria-busy="true">${typeof renderThinking === 'function' ? renderThinking('searching') : '<strong>Chargement…</strong>'}</div>`;
    if (mkAuto.error) return `<p class="em-calme">${esc(mkAuto.error)}</p>`;
    const regler = typeof canUseStaffPermission !== 'function' || canUseStaffPermission(['settings.manage', 'emails.send']);
    const NB = ' ';
    const ligne = (nom, detail, on, interrupteur) => `<li class="em-seq${on ? ' is-on' : ''}">
        <span class="em-seq-main"><strong>${esc(nom)}</strong><small>${detail}</small></span>
        ${regler ? interrupteur : `<span class="em-seq-etat">${on ? 'Activée' : 'Désactivée'}</span>`}
      </li>`;
    const items = AUTOMATION_META.map((meta) => {
      const setting = mkAuto.settings ? mkAuto.settings[meta.key] : null;
      const enabled = !!(setting && setting.enabled);
      const stats = mkAuto.stats[meta.key] || {};
      const sent30 = Number(stats.sent30d) || 0;
      const failed30 = Number(stats.failed30d) || 0;
      const detail = `${sent30}${NB}envoyé${sent30 > 1 ? 's' : ''}${failed30 ? ` · <span class="em-seq-echec">${failed30}${NB}échec${failed30 > 1 ? 's' : ''}</span>` : ''} · 30${NB}j`;
      return ligne(meta.label, detail, enabled, `<button type="button" class="mk-switch${enabled ? ' is-on' : ''}" data-switch-key="auto:${esc(meta.key)}" role="switch" aria-checked="${enabled}" aria-label="${esc(meta.label)}" onclick="toggleStaffAutomation('${meta.key}')" ${mkAuto.busyKey === meta.key || !mkAuto.settings ? 'disabled' : ''}><span></span></button>`);
    });
    pv2Seq.sequences.forEach((sequence) => {
      const stats = pv2SeqStats30j(sequence);
      const sent30 = stats ? Number(stats.sent30d) || 0 : null;
      const detail = sent30 === null ? 'Votre séquence · pas encore de chiffres' : `${sent30}${NB}envoyé${sent30 > 1 ? 's' : ''} · 30${NB}j · votre séquence`;
      items.push(ligne(sequence.name, detail, sequence.enabled, `<button type="button" class="mk-switch${sequence.enabled ? ' is-on' : ''}" data-switch-key="seq:${esc(String(sequence.id))}" role="switch" aria-checked="${sequence.enabled}" aria-label="${esc(sequence.name)}" onclick="pv2SeqToggle('${escJs(sequence.id)}', ${sequence.enabled ? 'false' : 'true'})" ${pv2Seq.busy ? 'disabled' : ''}><span></span></button>`));
    });
    return `<ul class="em-seq-list pv2-seq-mini">${items.join('')}</ul>`;
  }

  // CE QUI ATTEND LA GERANTE (2026-11-10), en faits : un nombre, sa cause, le
  // bouton qui mene au geste. Une ligne n existe que si la donnee qui la porte
  // existe : rien ne s affiche « par defaut ».
  function emAFaire() {
    const o = pv2Overview.data;
    const rows = getStaffEmailRows().filter((r) => !pv2IsInbound(r));
    const metrics = getStaffEmailMetrics(rows);
    const items = [];
    if (metrics.failed > 0) {
      const causes = getStaffEmailFailureGroups(rows);
      const top = causes[0];
      const autres = causes.length - 1;
      items.push({
        cle: 'echecs', ton: 'red',
        titre: `${metrics.failed} mail${metrics.failed > 1 ? 's ne sont jamais partis' : ' n’est jamais parti'}`,
        detail: top ? `${top.label}${autres > 0 ? `, et ${autres} autre${autres > 1 ? 's' : ''} cause${autres > 1 ? 's' : ''}` : ''}.` : '',
        bouton: metrics.failed > 1 ? 'Voir les échecs' : 'Voir l’échec',
        go: "pv2EmailFilter('failed')",
      });
    }
    const canal = pv2Mail.channel;
    if (canal && canal.resendConfigured === false) {
      items.push({ cle: 'canal', ton: 'red', titre: 'L’envoi des mails n’est pas configuré', detail: 'Aucun mail ne part tant que l’adresse d’envoi n’est pas reliée.', bouton: 'Voir les expéditeurs', go: "pv2EmailsGo('expediteurs')" });
    }
    const aRepondre = o ? pv2Nombre(o.aRepondre) : null;
    if (aRepondre > 0) {
      const depuis = o.plusAncienneAttenteAt ? pv2Depuis(o.plusAncienneAttenteAt) : '';
      items.push({ cle: 'repondre', ton: 'blue', titre: `${aRepondre} conversation${aRepondre > 1 ? 's attendent' : ' attend'} une réponse`, detail: depuis ? `La plus ancienne attend depuis ${depuis}.` : '', bouton: 'Répondre', go: "pv2ThreadsFilter('a-repondre'); pv2EmailsGo('recus')" });
    }
    const questions = pv2SavoirDonnees().questions;
    if (questions.length) {
      items.push({ cle: 'agent', ton: 'blue', titre: questions.length > 1 ? `L’agent a ${questions.length} questions sur votre centre` : 'L’agent a une question sur votre centre', detail: 'Ce que vous lui répondez, il le retient pour les mails suivants.', bouton: 'Voir les questions', go: "pv2EmailsGo('agent')" });
    }
    if (metrics.due > 0) {
      items.push({ cle: 'file', ton: 'amber', titre: `${metrics.due} mail${metrics.due > 1 ? 's prêts à partir sont' : ' prêt à partir est'} encore dans la file`, detail: '', bouton: 'Voir la file', go: "pv2EmailFilter('queued')" });
    }
    return items;
  }

  function emAFaireHtml() {
    const o = pv2Overview.data;
    const items = emAFaire();
    const cascade = { n: 0 };
    let corps;
    if (items.length) {
      corps = `<ul class="em-todo-list">${items.map((it) => `<li class="em-todo is-${it.ton}" data-em-todo="${it.cle}"${emEntree(`apercu:todo:${it.cle}`, cascade)}>
          <span class="em-todo-dot" aria-hidden="true"></span>
          <span class="em-todo-text"><strong>${esc(it.titre)}</strong>${it.detail ? `<small>${esc(it.detail)}</small>` : ''}</span>
          <button type="button" class="em-lien em-todo-geste" onclick="${it.go}">${esc(it.bouton)}</button>
        </li>`).join('')}</ul>`;
    } else if (!o) {
      corps = `<p class="em-calme">${pv2Overview.error ? 'Le résumé de vos mails est indisponible pour le moment.' : 'Lecture de vos mails…'}</p>`;
    } else {
      const sansEchec = Number(o.echecs7j) === 0 ? ' Aucun envoi n’a échoué sur 7 jours.' : '';
      corps = `<p class="em-calme"><strong>Rien à faire pour l’instant.</strong> Aucune conversation n’attend de réponse.${sansEchec}</p>`;
    }
    return `<section class="em-block em-todo-block" aria-labelledby="emTodoTitre">
        <h2 class="em-h2" id="emTodoTitre">À faire maintenant</h2>
        ${corps}
      </section>`;
  }

  // La phrase de l agent sur le dernier message de chaque fil, quand il l a
  // lu. Elle vient de la file des communications (l analyse y est stockee) :
  // la liste des fils ne la porte pas. Lue une fois par rendu.
  function emResumes() {
    const out = new Map();
    getStaffEmailRows().forEach((r) => {
      if (!pv2IsInbound(r)) return;
      const p = r.payload && typeof r.payload === 'object' ? r.payload : null;
      const a = p && p.analysis && typeof p.analysis === 'object' ? p.analysis : null;
      const resume = a ? String(a.summary || '').trim() : '';
      if (resume) out.set(Number(r.id), resume);
    });
    return out;
  }

  function pv2EmailsSectionApercu() {
    const o = pv2Overview.data;
    const plusAncienne = o && o.plusAncienneAttenteAt ? pv2Depuis(o.plusAncienneAttenteAt) : '';
    const evenements = o && o.suivi ? Boolean(o.suivi.evenementsRecus30j) : false;
    const remis7 = o ? pv2Nombre(o.remis7j) : null;
    const enAttente = o ? pv2Nombre(o.enAttente) : null;
    const apercu = pv2Threads.apercu;
    const convos = apercu.threads.slice(0, 5);
    const resumes = emResumes();
    const cascade = { n: 0 };
    return `<div class="em-apercu">
      ${emAFaireHtml()}
      <section class="em-kpis" aria-label="Les chiffres du jour">
        ${pv2TuileHtml({ label: 'À répondre', value: o ? o.aRepondre : null, foot: plusAncienne ? `la plus ancienne depuis ${plusAncienne}` : (o && Number(o.aRepondre) === 0 ? 'rien en attente' : ''), go: "pv2ThreadsFilter('a-repondre'); pv2EmailsGo('recus')" })}
        ${pv2TuileHtml({ label: 'Envoyés sur 7 jours', value: o ? o.envoyes7j : null, foot: evenements && remis7 !== null ? `${remis7} remis au client` : 'remise non confirmée', go: "pv2EmailFilter('sent')" })}
        ${pv2TuileHtml({ label: 'Échecs sur 7 jours', value: o ? o.echecs7j : null, foot: o && Number(o.echecs7j) > 0 ? 'à corriger dans Envoyés' : 'aucun échec récent', go: "pv2EmailFilter('failed')", danger: true })}
        ${pv2TuileHtml({ label: 'Programmés sur 24 h', value: o ? o.programmes24h : null, foot: enAttente !== null ? `${enAttente} en attente au total` : '', go: "pv2EmailFilter('queued')" })}
      </section>
      <div class="em-cols">
        <div class="em-col">
          <section class="em-block em-convos" aria-labelledby="emConvTitre">
            <div class="em-block-head">
              <h2 class="em-h2" id="emConvTitre">Conversations à répondre</h2>
              <button type="button" class="em-lien" onclick="pv2EmailsGo('recus')">Toutes les conversations</button>
            </div>
            ${!apercu.loaded
              ? `<div class="em-attente" aria-live="polite" aria-busy="true">${typeof renderThinking === 'function' ? renderThinking('searching') : '<strong>Chargement…</strong>'}</div>`
              : convos.length
                ? `<div class="em-rows pv2-convo-mini">${convos.map((t) => pv2ThreadRowHtml(t, { compact: true, cascade, cle: `apercu:fil:${t.id}`, resume: resumes.get(Number(t.lastInboundId)) || '' })).join('')}</div>`
                : '<p class="em-calme"><strong>Rien à répondre.</strong> Chaque conversation reçue a sa réponse.</p>'}
          </section>
          <section class="em-block" aria-labelledby="emSuiviTitre">
            <h2 class="em-h2" id="emSuiviTitre">Suivi des envois</h2>
            ${pv2SuiviHtml(o)}
          </section>
        </div>
        <div class="em-col">
          <section class="em-block" aria-labelledby="emSeqTitre">
            <div class="em-block-head">
              <h2 class="em-h2" id="emSeqTitre">Séquences</h2>
              <button type="button" class="em-lien" onclick="pv2EmailsGo('sequences')">Gérer</button>
            </div>
            ${pv2SeqMiniHtml()}
          </section>
          ${pv2SectionApprentissage({ apercu: true })}
        </div>
      </div>
    </div>`;
  }

  /* Un mail qui ne part pas ne se voyait NULLE PART : le pipe « Échecs »
     existait, mais il fallait déjà savoir qu'il y avait un problème pour
     aller cliquer dessus. Ce bandeau est la réponse : il s'impose en tête de
     page, nomme la cause dominante en français et dit quoi faire. */
  function pv2AlerteEchecsHtml(allRows, metrics) {
    if (!(metrics.failed > 0)) return '';
    const failureGroups = getStaffEmailFailureGroups(allRows);
    const topFailure = failureGroups[0];
    return `<section class="pv2-alert" role="alert">
        <div class="pv2-alert-main">
          <strong>${metrics.failed} mail${metrics.failed > 1 ? 's ne sont jamais partis' : ' n\'est jamais parti'} <span class="pv2-alert-scope">sur les ${allRows.length} messages de la file</span></strong>
          ${topFailure ? `<p class="pv2-alert-cause"><b>${esc(topFailure.label)}</b>${failureGroups.length > 1 ? `, pour ${topFailure.count} mail${topFailure.count > 1 ? 's' : ''} sur ${metrics.failed}` : ''}. ${esc(topFailure.fix)}</p>` : ''}
          ${failureGroups.length > 1 ? `<p class="pv2-alert-other">${failureGroups.length > 2 ? 'Les autres échecs viennent de' : 'L’autre échec vient de'} ${failureGroups.slice(1).map((g) => `« ${esc(g.label)} »${g.count > 1 ? ` (${g.count} mails)` : ''}`).join(', ')}.</p>` : ''}
        </div>
        <button type="button" class="pv2-btn" onclick="pv2EmailFilter('failed')">${metrics.failed > 1 ? `Voir les ${metrics.failed} échecs` : 'Voir cet échec'}</button>
      </section>`;
  }

  /* ── RECUS : la liste des fils ──────────────────────────────────────────── */
  // QUI A OUVERT le dernier message du client : la liste du serveur, plus moi
  // si je viens de l ouvrir dans cette session.
  function pv2LecteursDuFil(t) {
    const moi = pv2MonIdentifiant();
    const liste = (Array.isArray(t.lecteurs) ? t.lecteurs : []).filter((l) => l && (l.memberId || l.memberName));
    if (t.luParMoi && moi && !liste.some((l) => String(l.memberId) === moi)) liste.push({ memberId: moi, memberName: '' });
    return liste;
  }
  function pv2NomsLecteurs(lecteurs) {
    const moi = pv2MonIdentifiant();
    const noms = [];
    for (const l of lecteurs) {
      const nom = moi && String(l.memberId) === moi ? 'vous' : String(l.memberName || 'un collègue');
      if (!noms.includes(nom)) noms.push(nom);
    }
    return noms.length > 2 ? `${noms.slice(0, 2).join(', ')} +${noms.length - 2}` : noms.join(' et ');
  }

  // UNE LIGNE DENSE (2026-11-10) : qui, quand, l objet, une ligne de texte,
  // puis les etats. Pas d avatar ni de filet entre les lignes : la selection
  // est un fond qui glisse (emPoserSelections), le non lu est en gras.
  // `compact` (Apercu) : la phrase de l agent remplace l extrait, et l age se
  // lit en duree (« 3 h »).
  function pv2ThreadRowHtml(t, { compact = false, cascade = null, cle = '', resume = '' } = {}) {
    const selected = String(t.id) === String(pv2Threads.selectedId) && !compact;
    // NOUVEAU = PERSONNE n a ouvert le dernier message du client (2026-09-17).
    // Des qu un membre l ouvre, la pastille disparait pour tout le monde et la
    // ligne dit qui l a ouvert. Un nouveau message du client la remet.
    const lecteurs = pv2LecteursDuFil(t);
    const unread = lecteurs.length === 0;
    const nom = String(t.contactName || t.contactEmail || 'Expéditeur inconnu');
    const [statusLabel, statusTone] = PV2_THREAD_STATUS[t.status] || PV2_THREAD_STATUS.open;
    const priseAutre = pv2PriseDunAutreSurLeFil({ id: t.lastInboundId, prise: t.prise }, t);
    const chips = [];
    if (unread) chips.push('<span class="pv2-chip blue is-new">Nouveau</span>');
    else if (t.status === 'open') chips.push(`<span class="pv2-chip is-opened">Ouvert par ${esc(pv2NomsLecteurs(lecteurs))}</span>`);
    if (priseAutre) chips.push(`<span class="pv2-chip amber">${esc(String(priseAutre.memberName || 'Un collègue'))} répond…</span>`);
    if (!compact && pv2Threads.filtre !== 'a-repondre') chips.push(`<span class="pv2-chip ${statusTone}">${statusLabel}${t.status === 'answered' && t.reponduPar && t.reponduPar.memberName ? ` par ${esc(t.reponduPar.memberName)}` : ''}</span>`);
    else if (t.status === 'answered' && t.reponduPar && t.reponduPar.memberName) chips.push(`<span class="pv2-chip green">Répondu par ${esc(t.reponduPar.memberName)}</span>`);
    if (!compact && Number(t.messageCount) > 1) chips.push(`<span class="pv2-chip is-count">${Number(t.messageCount)} messages</span>`);
    if (t.intention) chips.push(`<span class="pv2-chip pv2-inbox-intent">${esc(PV2_INTENT_LABELS[t.intention] || t.intention)}</span>`);
    if (t.question) chips.push('<span class="pv2-chip amber pv2-inbox-urgent">Question</span>');
    const texte = compact ? resume : String(t.snippet || '');
    return `<button type="button" class="em-row pv2-thread-row${selected ? ' is-selected' : ''}${unread ? ' is-unread' : ''}${compact ? ' is-compact' : ''}" data-thread-id="${esc(String(t.id))}" data-em-id="${esc(String(t.id))}"${selected ? ' data-em-cur' : ''} aria-current="${selected ? 'true' : 'false'}" onclick="pv2ThreadOpen('${escJs(String(t.id))}')"${cle ? emEntree(cle, cascade) : ''}>
      <span class="em-row-top"><strong class="em-row-name">${esc(nom)}</strong><span class="em-row-when">${esc(compact ? pv2Depuis(t.lastMessageAt) : pv2Relatif(t.lastMessageAt))}</span></span>
      <span class="em-row-subject">${esc(t.subject || '(sans objet)')}</span>
      ${texte ? `<span class="em-row-snippet">${esc(texte)}</span>` : ''}
      ${chips.length ? `<span class="em-row-chips">${chips.join('')}</span>` : ''}
    </button>`;
  }

  function pv2TraceEntrantHtml(m, messages, fil) {
    const items = [`<span class="is-done">Reçu <time>${esc(pv2Quand(m.receivedAt || m.createdAt))}</time></span>`];
    const moi = pv2MonIdentifiant();
    const lectures = Array.isArray(m.lectures) ? m.lectures : [];
    if (lectures.length) {
      items.push(`<span class="is-done">Lu par ${lectures.map((l) => `${esc(moi && String(l.memberId) === moi ? 'vous' : (l.memberName || l.memberId || 'un membre'))}${l.memberRole ? ` (${esc(l.memberRole)})` : ''} <time>${esc(pv2Quand(l.firstReadAt || l.lastReadAt))}</time>`).join(', ')}</span>`);
    } else {
      items.push('<span class="is-off">Pas encore lu</span>');
    }
    const index = messages.indexOf(m);
    const reponse = messages.slice(index + 1).find((x) => x.direction !== 'inbound');
    if (reponse) {
      const par = reponse.sentBy && reponse.sentBy.memberName ? reponse.sentBy.memberName : (reponse.origine === 'auto' ? 'la séquence' : 'l\'équipe');
      items.push(`<span class="is-done">${reponse.origine === 'boite' ? 'Répondu depuis votre boîte mail' : `Répondu par ${esc(par)}`} <time>${esc(pv2Quand(reponse.sentAt || reponse.createdAt))}</time></span>`);
    } else if (fil && fil.status === 'closed') {
      items.push('<span class="is-off">Terminé sans réponse</span>');
    } else {
      const depuis = pv2Depuis(m.receivedAt || m.createdAt);
      items.push(`<span class="is-off">Sans réponse${depuis ? ` depuis ${esc(depuis)}` : ''}</span>`);
    }
    return items;
  }

  // Le parcours d un mail sortant, en etapes { cls, label, when } : la meme
  // verite se lit en ligne sous un message du fil et en colonne dans le
  // detail d un envoye. « Pas d evenement » se dit comme tel, jamais en vert.
  function pv2TraceSortantItems(m) {
    const s = m.suivi && typeof m.suivi === 'object' ? m.suivi : {};
    const items = [];
    const statut = String(m.status || '').toLowerCase();
    if (statut === 'failed' || statut === 'error') {
      const raison = getStaffEmailFailureReason({ lastError: m.errorReason || s.lastError || '' });
      items.push({ cls: 'is-fail', label: `Échec : ${raison && raison.label ? raison.label : (m.errorReason || 'cause inconnue')}`, when: '' });
      return items;
    }
    if (statut === 'queued' || statut === 'pending' || statut === 'processing') {
      items.push({ cls: 'is-off', label: 'En attente d\'envoi', when: m.scheduledAt ? pv2Quand(m.scheduledAt) : '' });
      return items;
    }
    items.push({ cls: 'is-done', label: 'Envoyé', when: pv2Quand(m.sentAt || m.createdAt) });
    if (s.bouncedAt) items.push({ cls: 'is-fail', label: 'Rebond', when: pv2Quand(s.bouncedAt) });
    else if (s.deliveredAt || statut === 'delivered') items.push({ cls: 'is-done', label: 'Remis', when: s.deliveredAt ? pv2Quand(s.deliveredAt) : '' });
    else items.push({ cls: 'is-off', label: 'Remise pas encore confirmée', when: '' });
    const ouvertures = pv2OuverturesObservees();
    if (s.openedAt || Number(s.openCount) > 0) items.push({ cls: 'is-done', label: `Ouvert${Number(s.openCount) > 1 ? ` (${Number(s.openCount)}×)` : ''}`, when: s.openedAt ? pv2Quand(s.openedAt) : '' });
    else if (ouvertures === false) items.push({ cls: 'is-off', label: 'Ouverture non suivie sur ce domaine', when: '' });
    else items.push({ cls: 'is-off', label: 'Pas encore ouvert', when: '' });
    if (s.clickedAt || Number(s.clickCount) > 0) items.push({ cls: 'is-done', label: `Cliqué${Number(s.clickCount) > 1 ? ` (${Number(s.clickCount)}×)` : ''}`, when: s.clickedAt ? pv2Quand(s.clickedAt) : '' });
    if (s.complainedAt) items.push({ cls: 'is-fail', label: 'Signalé comme indésirable', when: pv2Quand(s.complainedAt) });
    return items;
  }
  function pv2TraceSortantHtml(m) {
    return pv2TraceSortantItems(m).map((it) => `<span class="${it.cls}">${esc(it.label)}${it.when ? ` <time>${esc(it.when)}</time>` : ''}</span>`);
  }
  function pv2TraceSortantVerticalHtml(m) {
    return pv2TraceSortantItems(m).map((it) => `<div class="${it.cls}"><span>${esc(it.label.split(' : ')[0])}</span><span>${it.label.includes(' : ') ? esc(it.label.split(' : ').slice(1).join(' : ')) : ''}${it.when ? ` <time>${esc(it.when)}</time>` : ''}</span></div>`).join('');
  }

  function pv2EvenementsHtml(m) {
    const liste = Array.isArray(m.evenements) ? m.evenements : [];
    if (!liste.length) return '';
    const ligne = (e) => {
      const data = e.data && typeof e.data === 'object' ? e.data : {};
      const detail = [data.link ? `lien : ${data.link}` : '', data.userAgent ? String(data.userAgent).slice(0, 80) : '', data.message ? String(data.message).slice(0, 120) : ''].filter(Boolean).join(' · ');
      return `<li><time>${esc(pv2Quand(e.occurredAt))}</time><span>${esc(PV2_EVENT_LABELS[e.type] || e.type)}</span>${detail ? `<small>${esc(detail)}</small>` : ''}</li>`;
    };
    return `<details class="pv2-thread-events"><summary>${liste.length} événement${liste.length > 1 ? 's' : ''} du fournisseur</summary><ul>${liste.map(ligne).join('')}</ul></details>`;
  }

  /* ── UN MAIL DE LA CONVERSATION, COMME DANS GMAIL (2026-11-12) ────────────
     Ansar : « les mails on distingue pas, faut un petit truc stylé qui
     ressemble à Gmail », puis « on doit pouvoir tout voir, les images, les
     liens ». Chaque mail est une feuille : la pastille de couleur de qui ecrit
     (la meme couleur pour la meme adresse, le bleu de la console pour le
     centre), son nom en gras et son adresse, la date a droite, puis le mail
     lui-meme. Un mail recu se montre EN ENTIER : sa version HTML (images,
     liens, mise en forme) dans un cadre isole, ses pieces jointes dessous. Un
     formulaire du site se lit question par question. Une reponse partie de la
     boite du centre, que Pinlane n a pas envoyee, a sa feuille quand le client
     la cite. Ce que l agent en a compris vit dans l Assistant. */
  const PV2_TEINTES_PASTILLE = 7;
  function pv2TeinteDe(cle) {
    const texte = String(cle || '').trim().toLowerCase();
    let somme = 0;
    for (let i = 0; i < texte.length; i += 1) somme = (somme * 31 + texte.charCodeAt(i)) >>> 0;
    return somme % PV2_TEINTES_PASTILLE;
  }
  // « 12 nov., 19:39 » et, la premiere semaine, « il y a 40 min ».
  function pv2QuandDuMail(value) {
    const d = value ? new Date(value) : null;
    if (!d || Number.isNaN(d.getTime())) return null;
    const memeAnnee = d.getFullYear() === new Date().getFullYear();
    const jour = d.toLocaleDateString('fr-BE', memeAnnee ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
    const heure = d.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
    const ecart = Date.now() - d.getTime();
    const depuis = ecart >= 0 && ecart < 7 * 86400000 ? pv2Depuis(value) : '';
    return { texte: `${jour}, ${heure}`, depuis: depuis ? `il y a ${depuis}` : '', iso: d.toISOString() };
  }
  function pv2TailleLisible(octets) {
    const n = Number(octets) || 0;
    if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toLocaleString('fr-BE', { maximumFractionDigits: 1 })} Mo`;
    if (n >= 1024) return `${Math.round(n / 1024)} Ko`;
    return n ? `${n} octets` : '';
  }
  function pv2NomDuCentre() {
    return typeof window.staffCenterDisplayName === 'function' ? String(window.staffCenterDisplayName() || '') : '';
  }

  // LE MAIL RECU EN ENTIER, lu une fois par mail (lib/mail-recu-complet.js).
  // Les liens des pieces jointes ne valent qu une heure : relus apres 50 min.
  const pv2MailsComplets = {};
  function pv2MailComplet(id) {
    const cle = String(id);
    const connu = pv2MailsComplets[cle];
    if (connu && (connu.etat === 'attente' || Date.now() - connu.lu < 50 * 60000)) return connu;
    pv2MailsComplets[cle] = { etat: 'attente', lu: Date.now(), html: connu ? connu.html : '', pieces: connu ? connu.pieces : [] };
    apiRequest(`/api/ops?action=mailRecuComplet&centerId=${encodeURIComponent(pv2CentreCourant())}&id=${encodeURIComponent(cle)}`)
      .then((payload) => {
        pv2MailsComplets[cle] = { etat: 'pret', lu: Date.now(), html: String((payload && payload.html) || ''), pieces: Array.isArray(payload && payload.piecesJointes) ? payload.piecesJointes : [] };
      })
      .catch(() => {
        pv2MailsComplets[cle] = { etat: 'erreur', lu: Date.now(), html: '', pieces: [] };
      })
      .finally(() => pv2RenderSiActive());
    return pv2MailsComplets[cle];
  }

  // LE HTML D UN MAIL RECU N EST PAS DE CONFIANCE. Trois barrieres : le cadre
  // est isole (sandbox sans allow-scripts : aucun script ne tourne, aucun
  // formulaire ne part), une politique de contenu ne laisse entrer que des
  // images et du style, et le HTML est nettoye avant (scripts, cadres,
  // formulaires, attributs on*, liens autres que web, mail et telephone). Les
  // liens s ouvrent dans un autre onglet, sans rien dire de la console ; les
  // pixels espions (1 x 1) et les images jointes introuvables tombent.
  const PV2_CITATIONS_HTML = '.gmail_quote, blockquote[type="cite"], .yahoo_quoted, .protonmail_quote, div[id^="mail-editor-reference-message"], [data-marker="__QUOTED_TEXT__"]';
  const PV2_CITATIONS_SUITE = '#appendonsend, #divRplyFwdMsg, .moz-cite-prefix';
  const PV2_MAIL_RECU_STYLE = 'html{color-scheme:light}html,body{margin:0;padding:0;background:#fff;color:#1f1f1f;font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;overflow-wrap:anywhere}body{overflow-x:auto}img{max-width:100%;height:auto}table{max-width:100%}a[href]{color:#0b57d0}pre{white-space:pre-wrap}blockquote{margin:0 0 0 .8ex;padding-left:1ex;border-left:2px solid #c6c6c6;color:#5e5e5e}';
  const PV2_MAILS_SURS = {};
  function pv2MailHtmlSur(html, pieces, avecHistorique) {
    if (typeof DOMParser === 'undefined') return null;
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    if (!doc || !doc.body) return null;
    doc.querySelectorAll('script, iframe, frame, frameset, object, embed, applet, meta, base, link, input, button, select, textarea, audio, video, portal').forEach((n) => n.remove());
    doc.querySelectorAll('form').forEach((n) => n.replaceWith(...n.childNodes));
    doc.querySelectorAll('*').forEach((el) => {
      [...el.attributes].forEach((attribut) => {
        const nom = attribut.name.toLowerCase();
        const valeur = String(attribut.value || '').trim().toLowerCase();
        if (nom.startsWith('on') || ['srcdoc', 'formaction', 'ping', 'srcset'].includes(nom)) { el.removeAttribute(attribut.name); return; }
        if (['href', 'src', 'background', 'poster', 'xlink:href', 'action', 'lowsrc', 'dynsrc', 'data'].includes(nom)) {
          const permis = /^(https?:|mailto:|tel:|cid:|#)/.test(valeur) || (nom === 'src' && /^data:image\/(png|jpe?g|gif|webp);/.test(valeur));
          if (!permis) el.removeAttribute(attribut.name);
        }
      });
    });
    doc.querySelectorAll('a[href]').forEach((a) => { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer'); });
    const parCid = new Map((pieces || []).filter((p) => p && p.contentId && p.url).map((p) => [String(p.contentId).toLowerCase(), p.url]));
    const cidsUtilises = new Set();
    doc.querySelectorAll('img').forEach((img) => {
      const src = String(img.getAttribute('src') || '');
      if (/^cid:/i.test(src)) {
        const cid = src.slice(4).replace(/^<|>$/g, '').toLowerCase();
        const url = parCid.get(cid);
        if (url) { img.setAttribute('src', url); cidsUtilises.add(cid); } else img.remove();
        return;
      }
      const largeur = Number(img.getAttribute('width'));
      const hauteur = Number(img.getAttribute('height'));
      if ((largeur && largeur <= 2) || (hauteur && hauteur <= 2) || !src) img.remove();
    });
    let aDeLHistorique = Boolean(doc.body.querySelector(`${PV2_CITATIONS_HTML}, ${PV2_CITATIONS_SUITE}`));
    if (aDeLHistorique && !avecHistorique) {
      const avant = doc.body.innerHTML;
      const enlever = [];
      doc.body.querySelectorAll(PV2_CITATIONS_HTML).forEach((n) => { if (!enlever.some((x) => x.contains(n))) enlever.push(n); });
      doc.body.querySelectorAll(PV2_CITATIONS_SUITE).forEach((marque) => {
        for (let n = marque; n; n = n.nextElementSibling) if (!enlever.includes(n)) enlever.push(n);
      });
      enlever.forEach((n) => n.remove());
      // PRUDENCE, comme la citation en texte : un mail qui ne garderait rien
      // se montre en entier.
      if (!(doc.body.textContent || '').trim() && !doc.body.querySelector('img')) { doc.body.innerHTML = avant; aDeLHistorique = false; }
    }
    const styles = [...doc.querySelectorAll('head style')].map((s) => s.outerHTML).join('');
    const fond = String(doc.body.getAttribute('style') || '');
    const srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data: blob:; style-src 'unsafe-inline'; font-src data:"><meta name="referrer" content="no-referrer"><base target="_blank"><style>${PV2_MAIL_RECU_STYLE}</style>${styles}</head><body><div style="${esc(fond)}">${doc.body.innerHTML}</div></body></html>`;
    return { srcdoc, riche: Boolean(doc.body.querySelector('img, table, a[href^="http"]')), aDeLHistorique, cidsUtilises };
  }
  function pv2MailSurDe(id, complet, avecHistorique) {
    const cle = `${id}:${avecHistorique ? 'tout' : 'message'}:${complet.lu}`;
    if (!(cle in PV2_MAILS_SURS)) PV2_MAILS_SURS[cle] = pv2MailHtmlSur(complet.html, complet.pieces, avecHistorique);
    return PV2_MAILS_SURS[cle];
  }

  // Le cadre d un mail recu prend la hauteur de son contenu : il est lisible
  // depuis la console (meme origine) mais ne peut rien y faire, faute de
  // scripts. Sa derniere hauteur se garde : un nouveau rendu ne le fait pas
  // sauter.
  const PV2_MAILS_RECUS_DOCS = {};
  const PV2_HAUTEURS_MAIL = {};
  function pv2CadreMailRecuHtml(cle, srcdoc, titre) {
    PV2_MAILS_RECUS_DOCS[cle] = srcdoc;
    const hauteur = Number(PV2_HAUTEURS_MAIL[cle]) || 0;
    return `<div class="pv2-mail-papier"><iframe class="pv2-mail-recu-cadre" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" title="${esc(titre)}" data-pv2-cadre-mail="${esc(cle)}"${hauteur ? ` style="height:${hauteur}px"` : ''}></iframe></div>`;
  }
  function pv2AjusterCadreMail(frame) {
    try {
      const d = frame.contentDocument;
      if (!d || !d.body) return;
      const hauteur = Math.max(32, Math.ceil(Math.max(d.body.getBoundingClientRect().height, d.documentElement.offsetHeight)));
      PV2_HAUTEURS_MAIL[frame.getAttribute('data-pv2-cadre-mail')] = hauteur;
      frame.style.height = `${hauteur}px`;
    } catch (error) {
      // Cadre illisible : il garde sa hauteur.
    }
  }
  function pv2RemplirMailsRecus(root) {
    root.querySelectorAll('iframe[data-pv2-cadre-mail]').forEach((frame) => {
      const doc = PV2_MAILS_RECUS_DOCS[frame.getAttribute('data-pv2-cadre-mail')];
      if (!doc || frame.__pv2Doc === doc) return;
      frame.__pv2Doc = doc;
      frame.addEventListener('load', () => pv2AjusterCadreMail(frame));
      frame.srcdoc = doc;
    });
  }
  let pv2AjustementMails = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(pv2AjustementMails);
    pv2AjustementMails = requestAnimationFrame(() => document.querySelectorAll('#staffEmailsPage iframe[data-pv2-cadre-mail]').forEach(pv2AjusterCadreMail));
  });

  // Les pieces jointes, comme dans Gmail : la vignette d une image, le type et
  // le nom d un autre fichier. Une image deja montree dans le mail n y est pas.
  function pv2PiecesJointesHtml(m, complet, sur) {
    const dejaDansLeMail = sur ? sur.cidsUtilises : new Set();
    const liste = (complet.pieces || []).filter((p) => !(p.contentId && dejaDansLeMail.has(String(p.contentId).toLowerCase())));
    if (!liste.length) return '';
    return `<div class="pv2-mail-pieces">
      <p class="pv2-mail-pieces-titre">${liste.length === 1 ? '1 pièce jointe' : `${liste.length} pièces jointes`}</p>
      <div class="pv2-mail-pieces-liste">${liste.map((p) => {
        const image = /^image\/(png|jpe?g|gif|webp)$/.test(String(p.type || '')) && p.url;
        const extension = (String(p.nom || '').includes('.') ? String(p.nom).split('.').pop() : 'fichier').slice(0, 4).toUpperCase();
        return `<a class="pv2-mail-piece${image ? ' est-image' : ''}" href="${esc(p.url || '#')}" target="_blank" rel="noopener noreferrer" onclick="return pv2OuvrirPieceJointe(event, '${escJs(String(m.id))}', '${escJs(String(p.id))}')">
          ${image ? `<img src="${esc(p.url)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="pv2-mail-piece-type" aria-hidden="true">${esc(extension)}</span>`}
          <span class="pv2-mail-piece-nom">${esc(p.nom || 'Pièce jointe')}</span>
          <span class="pv2-mail-piece-taille">${esc(pv2TailleLisible(p.taille))}</span>
        </a>`;
      }).join('')}</div>
    </div>`;
  }
  // Un lien de piece jointe perime (plus d une heure) se redemande avant de
  // s ouvrir.
  window.pv2OuvrirPieceJointe = function (event, id, pieceId) {
    const connu = pv2MailsComplets[String(id)];
    const piece = connu && (connu.pieces || []).find((x) => String(x.id) === String(pieceId));
    if (piece && piece.url && (!piece.expiresAt || new Date(piece.expiresAt).getTime() - Date.now() > 60000)) return true;
    if (event && event.preventDefault) event.preventDefault();
    apiRequest(`/api/ops?action=mailRecuComplet&centerId=${encodeURIComponent(pv2CentreCourant())}&id=${encodeURIComponent(String(id))}`)
      .then((payload) => {
        const pieces = Array.isArray(payload && payload.piecesJointes) ? payload.piecesJointes : [];
        pv2MailsComplets[String(id)] = { etat: 'pret', lu: Date.now(), html: String((payload && payload.html) || ''), pieces };
        const fraiche = pieces.find((x) => String(x.id) === String(pieceId));
        if (fraiche && fraiche.url) window.open(fraiche.url, '_blank', 'noopener');
        else if (typeof toast === 'function') toast('Cette pièce jointe n’est plus disponible.');
        pv2RenderSiActive();
      })
      .catch(() => { if (typeof toast === 'function') toast('Pièce jointe indisponible pour le moment.'); });
    return false;
  };

  // Les reponses parties de la boite du centre, retrouvees par le serveur
  // dans la citation du client (lib/email-threads.js reponsesCiteesHorsPinlane),
  // prennent leur place juste avant le mail qui les cite.
  function pv2AvecReponsesDeLaBoite(messages, contact, fil) {
    const client = String((contact && contact.name) || (fil && fil.contactName) || (contact && contact.email) || (fil && fil.contactEmail) || '');
    const out = [];
    (messages || []).forEach((m) => {
      const cite = m && m.direction === 'inbound' && m.reponseCitee && typeof m.reponseCitee === 'object' ? m.reponseCitee : null;
      if (cite && String(cite.texte || '').trim()) {
        out.push({
          id: `boite-${m.id}`, direction: 'outbound', origine: 'boite', citePar: client,
          fromLabel: String(cite.auteur || ''), fromEmail: String(cite.adresse || ''),
          textBody: String(cite.texte), message: String(cite.texte),
          sentAt: cite.date || null, createdAt: cite.date || m.receivedAt || m.createdAt,
          recipient: '', evenements: [], lectures: [], suivi: {},
        });
      }
      out.push(m);
    });
    return out;
  }

  function pv2ThreadMessageHtml(m, messages, fil, contact) {
    const inbound = m.direction === 'inbound';
    const boite = m.origine === 'boite';
    const uid = `msg:${m.id}`;
    const contactEmail = String((contact && contact.email) || (fil && fil.contactEmail) || '');
    const nomContact = String((contact && contact.name) || (fil && fil.contactName) || contactEmail);
    const centre = pv2NomDuCentre();
    const nom = inbound
      ? String(m.fromLabel || (contact && contact.name) || m.fromEmail || contactEmail || 'Expéditeur inconnu')
      : String((m.sentBy && m.sentBy.memberName) || (boite ? (m.fromLabel || centre) : (m.origine === 'auto' ? (centre || m.sequenceLabel) : (m.fromLabel || centre))) || 'Le centre');
    const adresse = inbound ? String(m.fromEmail || contactEmail || '') : (boite ? String(m.fromEmail || '') : '');
    const quand = pv2QuandDuMail(inbound ? (m.receivedAt || m.createdAt) : (m.sentAt || m.createdAt));
    const voie = inbound
      ? 'Reçu'
      : (boite ? 'Envoyé depuis votre boîte mail' : (m.origine === 'auto' ? `Envoyé · ${m.sequenceLabel || 'automatique'}` : `Envoyé · ${PV2_ORIGINE_LABELS[m.origine] || 'manuel'}`));
    // Un mail du formulaire du site montre le client (2026-09-17) ; l adresse
    // technique du site reste au survol.
    const destinataire = !inbound ? String(m.recipient && m.recipient !== contactEmail ? m.recipient : nomContact) : '';
    const dest = inbound ? (m.via ? 'via le formulaire du site' : '') : (destinataire ? `à ${destinataire}` : '');
    const questions = (typeof opsAdminCache === 'object' && opsAdminCache && opsAdminCache.questions) || [];
    const question = inbound ? questions.find((q) => Number(q.communicationId) === Number(m.id)) : null;
    const trace = inbound ? pv2TraceEntrantHtml(m, messages, fil) : (boite ? [] : pv2TraceSortantHtml(m));
    let corps;
    let pieces = '';
    if (inbound && m.contenuComplet) {
      const complet = pv2MailComplet(m.id);
      const ouvert = Boolean(pv2Mail.historiqueOuvert[uid]);
      const sur = complet.etat === 'pret' && complet.html ? pv2MailSurDe(m.id, complet, ouvert) : null;
      if (sur && sur.riche) {
        corps = `<div class="pv2-mail-corps est-html">
          ${pv2CadreMailRecuHtml(`${m.id}:${ouvert ? 'tout' : 'message'}`, sur.srcdoc, `Mail de ${nom}`)}
          ${sur.aDeLHistorique ? `<button type="button" class="pv2-mail-plus${ouvert ? ' est-ouvert' : ''}" onclick="pv2BasculerHistorique('${escJs(uid)}')" aria-expanded="${ouvert}" title="${ouvert ? 'Masquer' : 'Afficher'} le reste de la conversation">•••</button>` : ''}
        </div>`;
      } else {
        corps = pv2CorpsMail({ uid, payload: { textBody: String(m.textBody || m.message || '') }, body: '', subject: m.subject || '' });
      }
      if (complet.etat === 'pret') pieces = pv2PiecesJointesHtml(m, complet, sur);
    } else if (inbound || m.textBody || m.message) {
      corps = pv2CorpsMail({ uid, payload: { textBody: String(m.textBody || m.message || '') }, body: '', subject: m.subject || '' });
    } else if (m.body) {
      corps = `<div class="pv2-thread-outbound-html">${pv2FrameHtml(uid, m.body, 'pv2-mail-frame', 'Mail tel qu\'envoyé')}</div>`;
    } else {
      corps = '<div class="pv2-mail-corps"><p class="pv2-mail-vide">Ce message n’a pas de contenu.</p></div>';
    }
    const lettre = pv2InitialeDe(nom, adresse);
    const pastille = inbound
      ? `<div class="pv2-mail-pastille" data-teinte="${pv2TeinteDe(adresse || nom)}" aria-hidden="true">${esc(lettre)}</div>`
      : `<div class="pv2-mail-pastille is-nous" aria-hidden="true">${esc(lettre)}</div>`;
    return `<article class="em-msg pl-timeline-msg${inbound ? ' is-inbound' : ' is-outbound'}${boite ? ' is-boite' : ''}" data-message-id="${esc(String(m.id))}">
      <div class="pv2-mail-entete">
        ${pastille}
        <div class="pv2-mail-identite">
          <div class="pv2-mail-ligne">
            <strong>${esc(nom)}</strong>
            ${adresse && adresse !== nom ? `<span class="pv2-mail-adresse">&lt;${esc(adresse)}&gt;</span>` : ''}
            ${quand ? `<span class="pv2-mail-quand"><time datetime="${esc(quand.iso)}">${esc(quand.texte)}</time>${quand.depuis ? `<span class="pv2-mail-depuis"> (${esc(quand.depuis)})</span>` : ''}</span>` : ''}
          </div>
          <div class="pv2-mail-dest">
            <span class="pv2-mail-voie">${esc(voie)}</span>
            ${dest ? `<span class="pv2-mail-a"${m.via ? ` title="${esc(m.via)}"` : ''}>${esc(dest)}</span>` : ''}
          </div>
        </div>
      </div>
      ${corps}
      ${pieces}
      ${!inbound && !boite && m.body && (m.textBody || m.message) ? `<button type="button" class="pv2-link-btn" onclick="pv2ThreadVoirMail('${escJs(String(m.id))}')">Voir le mail tel qu'envoyé</button>` : ''}
      <div class="pl-timeline-trace" aria-label="Parcours du message">
        ${trace.join('')}
        ${boite ? `<span class="is-off">Envoyé hors de Pinlane, retrouvé dans la réponse de ${esc(m.citePar || 'votre client')}</span>` : ''}
        ${question ? `<p class="pv2-thread-question"><b>L'agent ne sait pas.</b> <span>${esc(question.question)}</span> <button type="button" class="pv2-btn sm" onclick="pv2EmailsGo('agent')">${typeof canUseStaffPermission !== 'function' || canUseStaffPermission('emails.send') ? 'Lui répondre' : 'Voir dans L’agent'}</button></p>` : ''}
        ${pv2EvenementsHtml(m)}
      </div>
    </article>`;
  }

  function pv2ThreadReplyHtml(fil, contact, messages) {
    const cle = String(fil.id);
    const r = pv2ThreadReplyDraft(cle);
    const maySend = typeof canUseStaffPermission !== 'function' || canUseStaffPermission('emails.send');
    // Sans emails.send, aucun champ de reponse : une phrase a la place.
    if (!maySend) return '<p class="pv2-thread-reply-locked">Votre rôle lit les mails, il n’y répond pas.</p>';
    const busy = pv2Threads.replyBusy === cle;
    const entrant = pv2ThreadDernierEntrant(messages);
    const identityOptions = pv2Mail.identities.length
      ? pv2Mail.identities.map((i) => `<option value="${esc(String(i.id))}"${String(i.id) === String(r.identityId) ? ' selected' : ''}>${esc(i.label || i.email)}, ${esc(i.email)}</option>`).join('')
      : `<option value="">${pv2Mail.metaLoading ? 'Chargement des adresses…' : 'Expéditeur par défaut'}</option>`;
    const nom = String((contact && contact.name) || fil.contactName || (contact && contact.email) || fil.contactEmail || 'ce client');
    // UNE SEULE CASE OU ECRIRE, UN SEUL BOUTON (2026-11-11, lot S) : la case
    // porte deja la reponse de l agent, l aide dessous la corrige en une
    // phrase, et Envoyer est le seul bouton plein. L expediteur, l objet et
    // la signature ont un bon defaut : ils attendent dans « Plus d options ».
    const propose = pv2ThreadPropositionDe(cle);
    const deLAgent = Boolean(r.body) && r.body === r.iaBody;
    return `<section class="em-reply pv2-thread-reply" data-pv2-mount="threadReply" aria-label="Répondre" data-em-ia-editeur="reponse">
      <h3 class="em-reply-titre" id="pv2ReplyTitre">Votre réponse à ${esc(nom)}</h3>
      ${pv2BandeauPriseHtml(pv2PriseDunAutreSurLeFil(entrant, fil))}
      ${pv2TokeditHtml({ id: 'pv2ThreadReplyBody', sink: 'threadReplyBody', value: r.body, plFocus: 'emails.reponse.message', placeholder: 'Écrivez ici votre réponse au client.', classe: 'pv2-inbox-reply-body', labelledby: 'pv2ReplyTitre' })}
      ${deLAgent ? '<p class="em-reply-note">Réponse préparée par l’assistant. Relisez-la, corrigez ce qui ne va pas, puis envoyez.</p>' : ''}
      ${emIaBarHtml('reponse')}
      <details class="em-options"${pv2Threads.optionsOuvertes ? ' open' : ''} ontoggle="pv2Threads.optionsOuvertes = this.open">
        <summary>Plus d’options<span>expéditeur, objet, signature</span></summary>
        <div class="em-options-corps">
          <div class="pv2-thread-reply-grid">
            <label class="pv2-composer-field"><span>Expéditeur</span>
              <select onchange="pv2InboxReplyField('${escJs(cle)}', 'identityId', this.value)" aria-label="Adresse d'envoi">${identityOptions}</select>
            </label>
            <label class="pv2-composer-field"><span>Objet</span>
              <input class="pv2-inbox-reply-subject" data-pl-focus="emails.reponse.objet" value="${esc(r.subject)}" aria-label="Objet de la réponse" oninput="pv2InboxReplyField('${escJs(cle)}', 'subject', this.value)">
            </label>
          </div>
          <div class="pv2-thread-reply-sign${r.signature ? '' : ' is-off'}">
            <label class="pv2-check"><input type="checkbox" ${r.signature ? 'checked' : ''} onchange="pv2InboxReplyField('${escJs(cle)}', 'signature', this.checked)"> Ajouter la signature du centre</label>
            <input value="${esc(r.signatoryName)}" placeholder="Votre nom" aria-label="Nom du signataire" data-pl-focus="emails.reponse.signataire" oninput="pv2InboxReplyField('${escJs(cle)}', 'signatoryName', this.value)" ${r.signature ? '' : 'disabled'}>
            <input value="${esc(r.signatoryRole)}" placeholder="Votre rôle" aria-label="Rôle du signataire" data-pl-focus="emails.reponse.role" oninput="pv2InboxReplyField('${escJs(cle)}', 'signatoryRole', this.value)" ${r.signature ? '' : 'disabled'}>
          </div>
        </div>
      </details>
      <div class="pv2-composer-actions em-actions">
        <button type="button" class="em-lien" onclick="pv2ThreadReplyPreview('${escJs(cle)}')">Voir le mail final</button>
        ${propose && !deLAgent ? `<button type="button" class="em-lien" onclick="pv2ThreadUtiliserProposition('${escJs(cle)}')">Reprendre la réponse de l’assistant</button>` : ''}
        <span class="pv2-composer-spacer"></span>
        <button type="button" class="pv2-btn primary em-principal" onclick="pv2InboxReply('${escJs(cle)}')" ${busy ? 'disabled' : ''}>${ci('send')}${busy ? 'Envoi…' : 'Envoyer'}</button>
      </div>
    </section>`;
  }

  // avant : ce qui se lit juste avant la reponse (l Assistant, quand la boite
  // tient sur une colonne).
  function pv2ThreadDetailHtml(avant = '') {
    const d = pv2Threads.detail;
    if (!pv2Threads.selectedId) {
      return '<div class="pv2-thread-empty"><strong>Choisissez une conversation</strong><span>Elle s\'ouvre ici, avec la réponse que l\'assistant a préparée. Vous la relisez, puis vous l\'envoyez.</span></div>';
    }
    if (!d.loaded) {
      return `<div class="pv2-thread-empty" aria-live="polite" aria-busy="true">${typeof renderThinking === 'function' ? renderThinking('searching') : '<strong>Chargement…</strong>'}</div>`;
    }
    if (d.error || !d.thread) {
      return `<div class="pv2-thread-empty"><strong>${esc(d.error || 'Conversation introuvable.')}</strong><button type="button" class="pv2-btn sm" onclick="loadPv2ThreadDetail('${escJs(String(pv2Threads.selectedId))}', true)">Réessayer</button></div>`;
    }
    const fil = d.thread;
    const contact = d.contact || {};
    const messages = d.messages;
    const affiches = pv2AvecReponsesDeLaBoite(messages, contact, fil);
    const [statusLabel, statusTone] = PV2_THREAD_STATUS[fil.status] || PV2_THREAD_STATUS.open;
    const maySend = typeof canUseStaffPermission !== 'function' || canUseStaffPermission('emails.send');
    const busyStatut = pv2Threads.statusBusy === String(fil.id);
    const autres = Array.isArray(contact.autresFils) ? contact.autresFils : [];
    const nom = String(contact.name || fil.contactName || contact.email || fil.contactEmail || 'Expéditeur inconnu');
    const email = String(contact.email || fil.contactEmail || '');
    // L EN-TETE EST CELUI DE LA CONVERSATION, pas d un message (2026-09-17) :
    // l objet en titre, avec qui on parle, et qui a ecrit le premier. L avatar
    // et le nom du client en tete faisaient lire un mail du client, meme quand
    // le centre avait ecrit le premier.
    const premier = messages.length ? messages[0] : null;
    const premierEntrant = Boolean(premier) && premier.direction === 'inbound';
    const quandPremier = premier ? pv2Quand(premierEntrant ? (premier.receivedAt || premier.createdAt) : (premier.sentAt || premier.createdAt)) : '';
    const origineTete = premier ? `${premierEntrant ? 'Commencée par le client' : 'Commencée par le centre'}${quandPremier ? ` · ${quandPremier}` : ''}` : '';
    return `<div class="em-conv pv2-thread-detail pv2-mail-detail">
      <div class="pv2-thread-head">
        <div class="pv2-thread-title">
          <strong class="pv2-thread-subject">${esc(fil.subject || '(sans objet)')}</strong>
          <small class="pv2-thread-with">Conversation avec <b>${esc(nom)}</b>${email && email !== nom ? ` · ${esc(email)}` : ''}</small>
          ${origineTete ? `<small class="pv2-thread-origine">${esc(origineTete)}</small>` : ''}
        </div>
        <div class="pv2-thread-actions">
          <span class="pv2-chip ${statusTone}">${statusLabel}</span>
          ${maySend ? (fil.status === 'closed'
            ? `<button type="button" class="em-lien" onclick="pv2ThreadSetStatus('${escJs(String(fil.id))}', 'open')" ${busyStatut ? 'disabled' : ''}>Rouvrir</button>`
            : `<button type="button" class="em-lien" onclick="pv2ThreadSetStatus('${escJs(String(fil.id))}', 'closed')" ${busyStatut ? 'disabled' : ''}>Terminer</button>`) : ''}
          ${email ? `<button type="button" class="em-lien" onclick="pv2ThreadVoirClient('${escJs(email)}')">Fiche client</button>` : ''}
        </div>
        ${autres.length ? `<details class="pv2-thread-others">
          <summary>${ci('chevronDown')}Autres conversations (${autres.length})</summary>
          <div class="pv2-thread-others-list">${autres.map((a) => `<button type="button" onclick="pv2ThreadOpen('${escJs(String(a.id))}')"><span>${esc(a.subject || '(sans objet)')}</span><small>${esc((PV2_THREAD_STATUS[a.status] || PV2_THREAD_STATUS.open)[0])}</small><small>${esc(pv2Relatif(a.lastMessageAt))}</small></button>`).join('')}</div>
        </details>` : ''}
      </div>
      <div class="pl-timeline">
        ${messages.length ? affiches.map((m) => pv2ThreadMessageHtml(m, affiches, fil, contact)).join('') : '<div class="pv2-thread-empty"><strong>Aucun message</strong></div>'}
      </div>
      ${avant}${pv2ThreadReplyHtml(fil, contact, messages)}
    </div>`;
  }

  /* ── L ASSISTANT (2026-11-10) ─────────────────────────────────────────────
     A cote de la conversation, ce que l agent a lu dans le DERNIER message du
     client : la demande, son urgence, en une phrase ; ce qui lui a servi (les
     faits appris, les places verifiees par le moteur, les reservations
     trouvees) ; la reponse qu il propose, qui passe dans la reponse d un clic.
     Il ne montre que ce que l analyse contient. Sans analyse, une phrase, et
     le bouton qui la lance (le meme appel que la relecture). */
  const EM_REPLI = {
    'modele-muet': 'l’agent n’a pas répondu à temps',
    'reponse-invalide': 'la réponse de l’agent était incomplète',
    'nombres-non-sources': 'un chiffre de sa réponse ne figurait dans aucun fait',
  };
  function emHeureDite(h) {
    const [hh, mm] = String(h || '').split(':');
    if (!hh) return '';
    return !mm || mm === '00' ? `${Number(hh)} h` : `${Number(hh)} h ${mm}`;
  }
  function emJourDit(date) {
    const d = new Date(`${String(date || '').slice(0, 10)}T12:00:00`);
    return Number.isNaN(d.getTime()) ? String(date || '') : d.toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' });
  }
  function emCeQuiAServi(a) {
    const out = [];
    const appris = (typeof opsAdminCache === 'object' && opsAdminCache && opsAdminCache.appris) || [];
    (Array.isArray(a.faitsUtilises) ? a.faitsUtilises : []).forEach((ref) => {
      const f = appris.find((x) => `F${Number(x.id)}` === String(ref).toUpperCase());
      if (f) out.push({ titre: String(f.question || ''), texte: String(f.reponse || '') });
    });
    const v = a.verifications && typeof a.verifications === 'object' ? a.verifications : {};
    (Array.isArray(v.disponibilites) ? v.disponibilites : []).forEach((d) => {
      const heures = (Array.isArray(d.heures) ? d.heures : []).map(emHeureDite).filter(Boolean);
      const quoi = String(d.quoi || '').trim();
      const prix = d.prix !== null && d.prix !== undefined && Number.isFinite(Number(d.prix)) ? ` · ${Number(d.prix).toLocaleString('fr-BE')} € pour le groupe` : '';
      const texte = d.possible && heures.length
        ? `${quoi ? `${quoi}, ` : ''}départs libres à ${heures.join(', ')}${prix}`
        : `${quoi ? `${quoi}, ` : ''}aucun départ libre vérifié`;
      out.push({ titre: `Places du ${emJourDit(d.date)}`, texte });
    });
    (Array.isArray(v.reservations) ? v.reservations : []).forEach((n) => {
      out.push({ titre: `Réservation n° ${n}`, texte: 'trouvée à l’adresse de ce client' });
    });
    return out;
  }

  // LOT S (2026-11-11) : l Assistant n est plus un volet. Sa lecture se pose
  // juste au-dessus de la reponse, sa reponse est deja dans la case, et ce
  // qui lui a servi tient sur une ligne qui s ouvre.
  function pv2AssistantHtml() {
    const d = pv2Threads.detail;
    const tete = (etat) => `<div class="em-assist-head"><h2 class="em-h2">Ce que l’assistant a compris</h2>${etat ? `<span class="em-assist-etat">${esc(etat)}</span>` : ''}</div>`;
    if (!pv2Threads.selectedId) return `${tete('')}<p class="em-assist-vide">Ouvrez une conversation. L’assistant résume la demande du client et prépare une réponse.</p>`;
    if (!d.loaded || !d.thread) return `${tete('')}<p class="em-assist-vide">${d.error ? 'Conversation indisponible.' : 'Lecture de la conversation…'}</p>`;
    const cle = String(d.thread.id);
    const maySend = typeof canUseStaffPermission !== 'function' || canUseStaffPermission('emails.send');
    const busy = pv2Threads.replyBusy === cle;
    const entrant = pv2ThreadDernierEntrant(d.messages);
    if (!entrant) return `${tete('')}<p class="em-assist-vide">Le client n’a pas encore écrit dans cette conversation.</p>`;
    const a = entrant.analysis && typeof entrant.analysis === 'object' ? entrant.analysis : null;
    if (!a) {
      return `${tete('')}<p class="em-assist-vide">L’assistant n’a pas encore lu ce message.</p>
        ${maySend ? `<button type="button" class="pv2-btn sm" onclick="pv2InboxReanalyze('${escJs(cle)}')" ${busy ? 'disabled' : ''}>${ci('sparkles')}${busy ? 'Lecture…' : 'Analyser avec l’IA'}</button>` : ''}`;
    }
    const intentLabel = a.intentLabel || PV2_INTENT_LABELS[a.intent] || a.intent || '';
    const lu = a.analyzedAt ? pv2Quand(a.analyzedAt) : '';
    const faits = emCeQuiAServi(a);
    return `${tete(lu ? `Lu le ${lu}` : '')}
      <div class="pv2-inbox-analysis em-assist-lu">
        ${intentLabel || a.urgency === 'haute' ? `<div class="em-assist-tags">${intentLabel ? `<span class="pv2-chip pv2-inbox-intent">${esc(intentLabel)}</span>` : ''}${a.urgency === 'haute' ? '<span class="pv2-chip amber pv2-inbox-urgent">Urgent</span>' : ''}</div>` : ''}
        <div class="pv2-inbox-summary"><p>${esc(a.summary || 'Pas de résumé pour ce message.')}</p></div>
      </div>
      ${a.alerte ? `<div class="em-assist-alerte" role="note"><strong>À vérifier avant d’envoyer</strong><p>${esc(a.alerte)}</p></div>` : ''}
      ${a.repli ? `<p class="em-assist-repli">Réponse type de secours, ${esc(EM_REPLI[a.repli] || 'l’agent n’a pas pu écrire')}. Relisez-la avant d’envoyer.</p>` : ''}
      ${faits.length ? `<details class="em-assist-servi"${pv2Threads.serviOuvert ? ' open' : ''} ontoggle="pv2Threads.serviOuvert = this.open">
        <summary>Il s’est appuyé sur ${faits.length} info${faits.length > 1 ? 's' : ''} du centre</summary>
        <ul class="em-assist-faits">${faits.map((f) => `<li><strong>${esc(f.titre)}</strong><span>${esc(f.texte)}</span></li>`).join('')}</ul>
      </details>` : ''}
      ${maySend ? `<button type="button" class="em-lien em-assist-relire" onclick="pv2InboxReanalyze('${escJs(cle)}')" ${busy ? 'disabled' : ''}>${busy ? 'Lecture…' : 'Relire ce message avec l’IA'}</button>` : ''}`;
  }

  // LA REPONSE PRETE, HORS DE VUE (2026-11-11, lot S) : a l ouverture d une
  // conversation, la reponse et Envoyer tombent sous le bord. Tant que la case
  // n est pas en vue, une barre fine le dit et y mene, curseur dans la case.
  // Elle n envoie jamais rien : la reponse se relit avant de partir. Son etat
  // survit aux rendus de la meme conversation (pas de clignement) ; une autre
  // conversation repart cachee, et l observateur la montre s il le faut.
  const EM_REPONSE = { fil: '', vue: true, obs: null };
  function emReponsePreteHtml() {
    const d = pv2Threads.detail;
    if (!d.loaded || !d.thread) return '';
    if (typeof canUseStaffPermission === 'function' && !canUseStaffPermission('emails.send')) return '';
    const cle = String(d.thread.id);
    const r = pv2Threads.reply[cle];
    if (!r || !r.body || r.body !== r.iaBody) return '';
    const cachee = EM_REPONSE.fil === cle ? EM_REPONSE.vue : true;
    return `<div class="em-reponse-ancre"><div class="em-reponse-prete" data-em-reponse-prete${cachee ? ' hidden' : ''}><span>La réponse de l’assistant est prête.</span><button type="button" class="pv2-btn primary" onclick="emVoirLaReponse()">Voir la réponse</button></div></div>`;
  }
  function emSuivreLaReponse() {
    if (EM_REPONSE.obs) { EM_REPONSE.obs.disconnect(); EM_REPONSE.obs = null; }
    const fil = String(pv2Threads.selectedId || '');
    if (EM_REPONSE.fil !== fil) { EM_REPONSE.fil = fil; EM_REPONSE.vue = true; }
    const barre = document.querySelector('#staffEmailsPage [data-em-reponse-prete]');
    const champ = document.getElementById('pv2ThreadReplyBody');
    if (!barre || !champ || typeof IntersectionObserver !== 'function') return;
    // En vue : la moitie de la case, ou au moins 160 px d une longue reponse.
    EM_REPONSE.obs = new IntersectionObserver((entrees) => {
      const e = entrees[entrees.length - 1];
      EM_REPONSE.vue = e.isIntersecting && (e.intersectionRatio >= 0.5 || e.intersectionRect.height >= 160);
      barre.hidden = EM_REPONSE.vue;
    }, { threshold: [0, 0.25, 0.5, 0.75, 1] });
    EM_REPONSE.obs.observe(champ);
  }
  window.emVoirLaReponse = function () {
    const section = document.querySelector('#staffEmailsPage .em-reply');
    const champ = document.getElementById('pv2ThreadReplyBody');
    if (!section || !champ) return;
    section.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
    champ.focus({ preventScroll: true });
    const sel = window.getSelection();
    if (sel) {
      const debut = document.createRange();
      debut.selectNodeContents(champ);
      debut.collapse(true);
      sel.removeAllRanges();
      sel.addRange(debut);
    }
  };

  /* ── RECUS : deux volets (lot S, 2026-11-11) ─────────────────────────────
     La liste des conversations, puis la conversation ouverte : ses messages,
     ce que l assistant a compris, et la reponse deja ecrite. Chaque volet
     defile dans son cadre, et son defilement survit au rendu (cle
     data-em-scroll : celle de la conversation change avec elle, si bien qu un
     autre fil s ouvre en haut). */
  function pv2EmailsSectionRecus() {
    const o = pv2Overview.data;
    const aRepondre = o && Number.isFinite(Number(o.aRepondre)) ? Number(o.aRepondre) : undefined;
    const filtres = [
      { key: 'a-repondre', label: 'À répondre', count: aRepondre },
      { key: 'repondus', label: 'Répondus' },
      { key: 'termines', label: 'Terminés' },
      { key: 'tous', label: 'Tous' },
    ].map((f) => ({ ...f, active: pv2Threads.filtre === f.key }));
    const cascade = { n: 0 };
    const liste = pv2Threads.error
      ? `<div class="pv2-thread-empty"><strong>${esc(pv2Threads.error)}</strong><button type="button" class="pv2-btn sm" onclick="loadPv2Threads(true)">Réessayer</button></div>`
      : !pv2Threads.loaded
        ? `<div class="pv2-thread-empty" aria-live="polite" aria-busy="true">${typeof renderThinking === 'function' ? renderThinking('searching') : '<strong>Chargement…</strong>'}</div>`
        : pv2Threads.threads.length
          ? pv2Threads.threads.map((t) => pv2ThreadRowHtml(t, { cascade, cle: `recus:fil:${t.id}` })).join('')
          : `<div class="pv2-thread-empty"><strong>${pv2Threads.q ? 'Aucune conversation ne correspond' : { 'a-repondre': 'Rien à répondre', repondus: 'Aucune conversation répondue', termines: 'Aucune conversation terminée', tous: 'Aucune conversation' }[pv2Threads.filtre]}</strong><span>${pv2Threads.q ? 'Essayez un autre nom ou une autre adresse.' : 'Collez un mail avec « Coller un mail reçu », l\'agent prépare la réponse.'}</span></div>`;
    const reste = pv2Threads.loaded && pv2Threads.total > pv2Threads.threads.length ? pv2Threads.total - pv2Threads.threads.length : 0;
    const id = String(pv2Threads.selectedId || '');
    // Changer de conversation rejoue l entree du volet de droite, meme vers
    // un fil deja ouvert plus tot dans la visite.
    if (EM_MOTION.fil !== id) {
      delete EM_MOTION.departs[`recus:conv:${id}`];
      EM_MOTION.fil = id;
    }
    return `<section class="em-inbox${id ? ' has-fil' : ''}" aria-label="Conversations">
      <div class="em-pane em-pane-list">
        <div class="em-pane-tools pv2-thread-tools">
          ${seg(filtres, 'pv2ThreadsFilter')}
          <label class="pv2-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="14" height="14" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg><input data-pl-focus="emails.recus.recherche" value="${esc(pv2Threads.q || '')}" placeholder="Client, adresse, objet…" aria-label="Rechercher une conversation" oninput="pv2ThreadsSearch(this.value)"></label>
        </div>
        <div class="em-list pv2-thread-list" data-em-scroll="fils" data-em-sel="fils" aria-live="polite" aria-busy="${pv2Threads.loading ? 'true' : 'false'}">
          <span class="em-sel" aria-hidden="true"></span>
          ${liste}
        </div>
        ${reste ? `<p class="em-pane-foot">${reste} autre${reste > 1 ? 's' : ''} conversation${reste > 1 ? 's ne sont pas affichées' : ' n’est pas affichée'}. Affinez la recherche pour ${reste > 1 ? 'les' : 'la'} voir.</p>` : ''}
      </div>
      <div class="em-pane em-pane-conv" data-em-scroll="conv:${esc(id)}"${id ? emEntree(`recus:conv:${id}`) : ''}>${pv2ThreadDetailHtml(id ? `<aside class="em-assistant em-assistant-fil" aria-label="Assistant">${pv2AssistantHtml()}</aside>` : '')}${id ? emReponsePreteHtml() : ''}</div>
    </section>`;
  }

  /* ── ENVOYES : la file, son suivi, le detail ────────────────────────────── */
  const PV2_SENT_ORIGINS = [['all', 'Toutes'], ['auto', 'Automatiques'], ['manual', 'Envois manuels'], ['campagne', 'Campagnes'], ['test', 'Tests']];
  function pv2SentOrigin(row) {
    const p = row.payload && typeof row.payload === 'object' ? row.payload : {};
    const flag = (v) => v === true || v === 'true';
    if (flag(p.test)) return 'test';
    if (p.campaignId) return 'campagne';
    return getStaffEmailOrigin(row) === 'manual' ? 'manual' : 'auto';
  }
  function pv2SentRemis(row) {
    return Boolean(row.deliveredAt) || String(row.status || '').toLowerCase() === 'delivered';
  }
  function pv2SentOuvert(row) {
    return Boolean(row.openedAt) || Number(row.openCount) > 0;
  }
  function pv2SentClique(row) {
    return Boolean(row.clickedAt) || Number(row.clickCount) > 0;
  }
  function pv2SentRows() {
    const every = getStaffEmailRows().filter((r) => !pv2IsInbound(r));
    const origin = ['auto', 'manual', 'campagne', 'test'].includes(state.staffEmailOriginFilter) ? state.staffEmailOriginFilter : 'all';
    const filter = ['all', 'queued', 'sent', 'delivered', 'opened', 'failed', 'review'].includes(state.staffEmailFilter) ? state.staffEmailFilter : 'all';
    const query = String(state.staffEmailQuery || '').trim().toLowerCase();
    const scoped = origin === 'all' ? every : every.filter((r) => pv2SentOrigin(r) === origin);
    const rows = scoped.filter((r) => {
      if (filter === 'review') return r.templateId === 'staff_review_request';
      if (filter === 'delivered') return pv2SentRemis(r);
      if (filter === 'opened') return pv2SentOuvert(r);
      if (filter !== 'all' && r.statusKind !== filter) return false;
      return true;
    }).filter((r) => !query || getStaffEmailText(r).includes(query));
    return { every, scoped, rows, origin, filter, query };
  }

  // L ETAT LE PLUS AVANCE D UN ENVOI, en une etiquette (2026-11-10) : la
  // colonne Statut dit ou le mail en est vraiment (remis, ouvert, clique), pas
  // seulement qu il est parti. Le rouge est reserve a ce qui a echoue ;
  // « En attente » reste ambre, l etat d attente de toute la console. Le
  // parcours complet, etape par etape, se lit dans le detail.
  function emEtatEnvoi(row) {
    if (row.statusKind === 'failed') return { label: 'Échec', tone: 'red' };
    if (row.bouncedAt) return { label: 'Rebond', tone: 'red' };
    if (row.complainedAt) return { label: 'Signalé', tone: 'red' };
    if (row.statusKind === 'queued') return { label: 'En attente', tone: 'amber' };
    if (row.statusKind === 'draft') return { label: 'Brouillon', tone: '' };
    if (row.statusKind === 'cancelled') return { label: 'Annulé', tone: '' };
    if (pv2SentClique(row)) return { label: 'Cliqué', tone: 'blue' };
    if (pv2SentOuvert(row)) return { label: 'Ouvert', tone: 'blue' };
    if (pv2SentRemis(row)) return { label: 'Remis', tone: 'green' };
    if (row.statusKind === 'sent') return { label: 'Envoyé', tone: '' };
    return { label: String(row.status || 'Inconnu'), tone: '' };
  }

  function pv2SentDetailHtml(selected) {
    if (!selected) return '<p class="em-calme">Choisissez un envoi dans la liste. Son parcours et le mail s’affichent ici.</p>';
    const payload = selected.payload || {};
    const origine = pv2SentOrigin(selected);
    const sentBy = payload.sentBy && typeof payload.sentBy === 'object' ? payload.sentBy : null;
    const origineTxt = origine === 'auto'
      ? `Automatique · ${selected.templateLabel || selected.templateId || 'séquence'}`
      : `${PV2_ORIGINE_LABELS[origine]}${sentBy && sentBy.memberName ? ` · ${sentBy.memberName}` : (payload.staffMember ? ` · ${payload.staffMember}` : '')}`;
    // Le modele ne se montre que pour un envoi automatique (2026-11-11). Un
    // mail ecrit a la main n en a pas : son identifiant (studio_..., ou
    // direct_reply sur le banc) ne dit rien a la gerante, et l origine dit
    // deja qui l a ecrit.
    const modele = origine === 'auto' ? (selected.templateLabel || selected.templateId || '') : '';
    // « Voir la conversation » : seulement si le client a repondu apres cet
    // envoi. Un fil qui n a que ce mail n apporterait rien de plus.
    const reponse = selected.threadId
      ? getStaffEmailRows().find((r) => pv2IsInbound(r) && Number(r.threadId) === Number(selected.threadId) && new Date(r.createdAt || r.receivedAt || 0).getTime() > new Date(selected.sentAt || selected.createdAt || 0).getTime())
      : null;
    const traceVertical = pv2TraceSortantVerticalHtml({
      status: selected.status, sentAt: selected.sentAt, createdAt: selected.createdAt, scheduledAt: selected.scheduledAt, errorReason: selected.lastError,
      suivi: { deliveredAt: selected.deliveredAt, openedAt: selected.openedAt, openCount: selected.openCount, clickedAt: selected.clickedAt, clickCount: selected.clickCount, bouncedAt: selected.bouncedAt, complainedAt: selected.complainedAt, lastError: selected.lastError },
    });
    return `<div class="em-sent-body pv2-mail-detail pv2-sent-detail">
        ${selected.statusKind === 'failed' ? (() => {
          const failure = getStaffEmailFailureReason(selected);
          // Le renvoi n'est proposé que si le mail garde un sens aujourd'hui :
          // remettre en file la confirmation d'une réservation passée enverrait
          // au client un message absurde. Au-delà de 7 jours, on explique
          // pourquoi le bouton n'est pas là plutôt que de le griser sans mot.
          const ageDays = (Date.now() - new Date(selected.createdAt || selected.scheduledAt || Date.now()).getTime()) / 86400000;
          const retryable = ageDays <= 7;
          // retryCommunication : emails.send. Sans lui, ni bouton ni phrase sur le renvoi.
          const envoyer = typeof canUseStaffPermission !== 'function' || canUseStaffPermission('emails.send');
          return `<div class="pv2-mail-error">
            <strong>${esc(failure.label)}</strong>
            <p>${esc(failure.fix)}</p>
            ${failure.raw ? `<details class="pv2-mail-error-raw"><summary>Message technique</summary><code>${esc(failure.raw)}</code></details>` : ''}
            ${envoyer ? `<div class="pv2-mail-error-actions">
              ${retryable
                ? `<button type="button" class="pv2-btn sm" onclick="pv2RetryEmail('${escJs(String(selected.id || ''))}')" ${pv2Mail.retryingId === String(selected.id) ? 'disabled' : ''}>${pv2Mail.retryingId === String(selected.id) ? 'Renvoi…' : 'Renvoyer ce mail'}</button>`
                : `<small>Ce message date de plus de 7 jours. Le renvoyer maintenant n\'aurait plus de sens pour le client.</small>`}
            </div>` : ''}
          </div>`;
        })() : ''}
        <dl class="em-kv pv2-kv">
          <div><dt>Destinataire</dt><dd>${esc(selected.recipient || '-')}</dd></div>
          <div><dt>Origine</dt><dd>${esc(origineTxt)}</dd></div>
          ${modele ? `<div><dt>Modèle</dt><dd>${esc(modele)}</dd></div>` : ''}
          <div><dt>Canal</dt><dd>${esc({ email: 'Email', sms: 'SMS', whatsapp: 'WhatsApp' }[selected.channel] || selected.channel || 'Email')}</dd></div>
          ${selected.scheduledAt ? `<div><dt>Programmé</dt><dd>${esc(formatOpsTimestamp(selected.scheduledAt))}</dd></div>` : ''}
          ${selected.sentAt ? `<div><dt>Envoyé</dt><dd>${esc(formatOpsTimestamp(selected.sentAt))}</dd></div>` : ''}
          ${selected.attempts ? `<div><dt>Tentatives</dt><dd>${Number(selected.attempts)}</dd></div>` : ''}
        </dl>
        <div class="em-detail-part">
          <h3 class="em-h3">Parcours</h3>
          <div class="pv2-sent-trace">${traceVertical}</div>
        </div>
        ${reponse ? `<div class="pv2-sent-actions"><button type="button" class="pv2-btn sm" onclick="pv2ThreadOpen('${escJs(String(selected.threadId))}')">${ci('message')}Voir la conversation, le client a répondu</button></div>` : ''}
        <div class="em-detail-part">
          <div class="em-detail-part-head">
            <h3 class="em-h3">Le mail</h3>
            ${selected.body ? `<button type="button" class="pv2-btn sm ghost" onclick="pv2ViewStoredMail('${escJs(selected.uid)}')">Plein écran</button>` : ''}
          </div>
          ${selected.body
            ? pv2FrameHtml(`sent:${selected.uid}`, selected.body, 'pv2-mail-frame', 'Mail tel qu\'envoyé')
            : `<div class="pv2-mail-render pv2-mail-render-detail">${pv2RenderEmailPreview(String(payload.textBody || selected.subject || 'Pas de contenu texte.'), null) || '<p class="pv2-preview-empty">Pas de contenu texte.</p>'}</div>`}
        </div>
      </div>`;
  }

  /* ── ENVOYES : un tableau et son detail (2026-11-10, lot S le 2026-11-11) ──
     Une ligne par mail : a qui et l objet, l etat, la date. L etat de la file
     se filtre en controle segmente ; l origine, l export et l envoi force
     attendent sous « Plus d options ». Le detail de la ligne choisie se lit
     a droite. */
  function pv2EmailsSectionEnvoyes() {
    const { every, scoped, rows, origin, filter } = pv2SentRows();
    const inboundCount = getStaffEmailRows().filter(pv2IsInbound).length;
    const selected = getSelectedStaffEmailRow(rows);
    if (selected && state.staffEmailSelectedId !== selected.uid) state.staffEmailSelectedId = selected.uid;
    const metrics = getStaffEmailMetrics(scoped);
    const remisCount = scoped.filter(pv2SentRemis).length;
    const ouvertsCount = scoped.filter(pv2SentOuvert).length;
    const ouvertures = pv2OuverturesObservees();
    const originCounts = { auto: 0, manual: 0, campagne: 0, test: 0 };
    every.forEach((row) => { originCounts[pv2SentOrigin(row)] += 1; });

    /* Les segments sont des FILTRES, <button> pour le clavier. Un seul format
       partout (2026-11-10) : le libellé, puis son compte en gris, comme les
       badges de la navigation (« En attente 7 », « Tout 21 »). Le libellé
       s'accorde au compteur. Ce que le segment ne dit pas en un mot (taux de
       réussite, suivi inactif) passe dans son infobulle. */
    const pipe = (key, one, many, value, hint) => {
      const n = Number(value) || 0;
      const label = esc(n > 1 ? many : one);
      return `<button type="button" class="pv2-pipe ${filter === key ? 'active' : ''}" data-pipe="${key}" onclick="pv2EmailFilter('${key}')" aria-pressed="${filter === key}"${hint ? ` title="${esc(hint)}"` : ''}><span class="pv2-pipe-label">${label}</span><span class="pv2-pipe-value">${n}</span></button>`;
    };

    const cascade = { n: 0 };
    const tableRows = rows.slice(0, 80).map((row) => {
      const etat = emEtatEnvoi(row);
      // La cause de l'échec se lit dans la LISTE, pas seulement après avoir
      // sélectionné la ligne : c'est ce qui rend un échec impossible à rater.
      const failure = row.statusKind === 'failed' ? getStaffEmailFailureReason(row) : null;
      const rowOrigin = pv2SentOrigin(row);
      const p = row.payload && typeof row.payload === 'object' ? row.payload : {};
      const sentBy = p.sentBy && typeof p.sentBy === 'object' ? p.sentBy : null;
      const origineTxt = rowOrigin === 'auto'
        ? (row.templateLabel || row.templateId || 'Automatique')
        : `${PV2_ORIGINE_LABELS[rowOrigin]}${sentBy && sentBy.memberName ? ` · ${sentBy.memberName}` : ''}`;
      const selectedRow = selected && row.uid === selected.uid;
      const sujet = row.subject || row.templateLabel || 'Message';
      // TROIS COLONNES (2026-11-11, lot S) : a qui et l objet l un sous
      // l autre, l etat, la date. L origine se lit dans l infobulle de la
      // ligne et dans le detail.
      return `<tr class="${selectedRow ? 'selected' : ''}${failure ? ' is-failed' : ''}" data-em-id="${esc(row.uid)}" data-origin="${rowOrigin}" title="${esc(origineTxt)}"${selectedRow ? ' data-em-cur' : ''} onclick="pv2SelectEmail('${escJs(row.uid)}')" aria-selected="${selectedRow ? 'true' : 'false'}"${emEntree(`envoyes:${row.uid}`, cascade)}>
        <td data-col="destinataire"><button type="button" class="pv2-row-btn em-cell-main" onclick="event.stopPropagation(); pv2SelectEmail('${escJs(row.uid)}')"><strong>${esc(row.recipient || '-')}</strong><small class="em-cell-sub">${esc(sujet)}</small></button></td>
        <td data-col="statut"><span class="pv2-chip ${etat.tone}">${esc(etat.label)}</span>${failure ? `<small class="pv2-cell-sub pv2-cell-fail">${esc(failure.label)}</small>` : ''}</td>
        <td data-col="date" class="num">${esc(formatOpsTimestamp(row.sentAt || row.scheduledAt || row.createdAt) || '-')}</td>
      </tr>`;
    }).join('');
    const vide = origin === 'auto' ? 'Aucun mail automatique ne correspond à ce filtre.' : origin === 'manual' ? 'Aucun envoi manuel ne correspond à ce filtre.' : origin === 'campagne' ? 'Aucun mail de campagne ne correspond à ce filtre.' : origin === 'test' ? 'Aucun mail de test ne correspond à ce filtre.' : 'Aucune communication pour ce filtre.';
    const uid = selected ? String(selected.uid) : '';
    // Choisir une autre ligne rejoue l entree du detail, meme vers une ligne
    // deja ouverte plus tot dans la visite.
    if (EM_MOTION.envoi !== uid) {
      delete EM_MOTION.departs[`envoyes:detail:${uid}`];
      EM_MOTION.envoi = uid;
    }
    const etatChoisi = selected ? emEtatEnvoi(selected) : null;
    const ORIGIN_HINTS = { auto: 'Partis tout seuls, séquences et rappels', manual: 'Écrits par vous ou l’équipe', campagne: 'Envoyés à un groupe de clients', test: 'Les mails d’essai' };
    // L origine, l export et l envoi force de la file attendent sous « Plus
    // d options » (lot S) : un filtre d origine actif l ouvre et se lit dans
    // la ligne fermee.
    const origineActive = origin !== 'all' ? ((PV2_SENT_ORIGINS.find(([k]) => k === origin) || [])[1] || '') : '';
    const exporter = typeof peutGeste !== 'function' || peutGeste('exporter');
    const envoyerFile = typeof canUseStaffPermission !== 'function' || canUseStaffPermission('emails.send');
    const options = emOptionsHtml('envoyes', origineActive ? `${origineActive} seulement` : `d’où viennent les mails${exporter ? ', export' : ''}`, `
          <div><p class="em-options-titre">D’où viennent les mails</p>
            <section class="em-origins pv2-origins" role="group" aria-label="Origine des messages">
              ${PV2_SENT_ORIGINS.map(([key, label]) => `<button type="button" class="em-origin pv2-origin-seg${origin === key ? ' active' : ''}" onclick="pv2EmailOriginFilter('${key}')" aria-pressed="${origin === key}"${ORIGIN_HINTS[key] ? ` title="${esc(ORIGIN_HINTS[key])}"` : ''}>${esc(label)}${key === 'all' ? '' : `<span class="em-origin-n">${originCounts[key]}</span>`}</button>`).join('')}
            </section>
          </div>
          ${exporter || envoyerFile ? `<div class="em-actions">
            ${exporter ? '<button type="button" class="em-lien" onclick="pv2ExporterEnvoyes()">Exporter cette liste</button>' : ''}
            ${envoyerFile ? '<button type="button" class="em-lien" onclick="requestOpsDispatch()">Envoyer la file maintenant</button>' : ''}
          </div>` : ''}`, origin !== 'all');

    return `${pv2AlerteEchecsHtml(scoped, metrics)}
      <div class="em-sent-filters">
        <section class="pv2-pipeline" role="group" aria-label="Filtrer la file">
          <span class="pv2-pipe-rail" aria-hidden="true"></span>
          ${pipe('all', 'Tout', 'Tout', scoped.length, '')}
          ${pipe('queued', 'En attente', 'En attente', metrics.queued, plural(metrics.due || 0, 'prêt à partir', 'prêts à partir'))}
          ${pipe('sent', 'Envoyé', 'Envoyés', metrics.sent, metrics.deliveryRate == null ? '' : `${metrics.deliveryRate} % de réussite`)}
          ${pipe('delivered', 'Remis', 'Remis', remisCount, remisCount ? '' : 'aucune remise confirmée')}
          ${pipe('opened', 'Ouvert', 'Ouverts', ouvertsCount, ouvertsCount ? '' : ouvertures === false ? 'suivi des ouvertures inactif' : 'aucune ouverture')}
          ${pipe('failed', 'Échec', 'Échecs', metrics.failed, plural(metrics.attempted || 0, 'tentative d’envoi', 'tentatives d’envoi'))}
          ${pipe('review', 'À valider', 'À valider', metrics.review, '')}
        </section>
      </div>
      <section class="em-sent">
        <div class="em-sent-main">
          <div class="em-sent-tools pv2-sent-tools">
            <label class="pv2-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg><input data-pl-focus="emails.recherche" value="${esc(state.staffEmailQuery || '')}" placeholder="Chercher un client, un objet ou une erreur" aria-label="Rechercher dans la file" oninput="setStaffEmailQuery(this.value)"></label>
            ${options}
          </div>
          <div class="em-sent-list pv2-mail-list" data-em-scroll="envoyes" data-em-sel="envoyes">
            <span class="em-sel" aria-hidden="true"></span>
            <table class="em-table pv2-table">
              <thead><tr><th>Destinataire</th><th>Statut</th><th class="num">Date</th></tr></thead>
              <tbody>${tableRows || `<tr class="pv2-vide"><td colspan="5"><div class="pv2-empty"><strong>File vide</strong>${vide}</div></td></tr>`}</tbody>
            </table>
          </div>
          <p class="pv2-pipeline-scope">Tout, En attente, Envoyés, Remis, Ouverts, Échecs et À valider portent sur les ${scoped.length} messages de la file ci-dessus. Les ${inboundCount} mails reçus se lisent dans <button type="button" class="pv2-link-btn" onclick="pv2EmailsGo('recus')">Reçus</button>.</p>
        </div>
        <aside class="em-sent-detail" aria-label="Détail de l’envoi"${uid ? emEntree(`envoyes:detail:${uid}`) : ''}>
          <div class="em-detail-head">
            <h2 class="em-h2">${esc(selected ? (selected.subject || 'Détail') : 'Détail')}</h2>
            ${etatChoisi ? `<span class="pv2-chip ${etatChoisi.tone}">${esc(etatChoisi.label)}</span>` : ''}
          </div>
          ${pv2SentDetailHtml(selected)}
        </aside>
      </section>`;
  }

  // L export porte exactement la file affichee (filtres Remis/Ouverts compris).
  window.pv2ExporterEnvoyes = function () {
    if (typeof exportStaffEmailsCsv !== 'function') return;
    exportStaffEmailsCsv(pv2SentRows().rows);
  };

  /* ── SEQUENCES ─────────────────────────────────────────────────────────── */
  function pv2EmailsSectionSequences() {
    const regler = typeof canUseStaffPermission !== 'function' || canUseStaffPermission(['settings.manage', 'emails.send']);
    // Un editeur ouvert a son Enregistrer plein : « Créer une séquence »
    // repasse alors en bouton simple (un seul bouton plein par ecran).
    const editeurOuvert = Boolean(mkAuto.editKey || pv2Seq.editId || pv2Seq.creating);
    const cascade = { n: 0 };
    const pinlane = mkAuto.error
      ? `<div class="em-vide"><p>${esc(mkAuto.error)}</p><button type="button" class="pv2-btn sm" onclick="loadStaffAutomations(true)">Réessayer</button></div>`
      : mkAuto.loaded
        ? `<div class="em-seqrows">${AUTOMATION_META.map((m) => mkAutoCard(m, cascade)).join('')}</div>`
        : `<div class="em-attente" aria-live="polite" aria-busy="true">${typeof renderThinking === 'function' ? renderThinking('searching') : '<strong>Chargement des séquences…</strong>'}</div>`;
    const creation = pv2Seq.creating
      ? `<article class="mk-auto pv2-seq-card em-seqrow is-editing"><div class="em-seqrow-ligne"><div class="mk-auto-head em-seqrow-nom"><strong>Nouvelle séquence</strong><span class="mk-auto-desc">Choisissez quand elle part, à qui, et ce qu’elle dit.</span></div></div>${pv2SeqEditor()}</article>`
      : '';
    const perso = pv2Seq.sequences.length || creation
      ? `<div class="em-seqrows">${creation}${pv2Seq.sequences.map((s) => pv2SeqCard(s, cascade)).join('')}</div>`
      : `<p class="em-calme">Aucune séquence à vous pour l’instant.${regler ? ' Créez la première, elle partira chaque matin avec celles de Pinlane.' : ''}</p>`;
    return `<div class="em-seqs pv2-seq-groups">
      <section class="em-block mk-auto-panel" aria-label="Séquences Pinlane">
        <div class="em-block-head"><div><h2 class="em-h2">Les séquences Pinlane</h2><p class="em-sub">Les mails qui partent tout seuls, au bon moment. Les chiffres portent sur les 30 derniers jours.</p></div></div>
        ${pinlane}
      </section>
      <section class="em-block mk-auto-panel" aria-label="Vos séquences">
        <div class="em-block-head"><div><h2 class="em-h2">Vos séquences</h2><p class="em-sub">Vos propres envois automatiques, avec un déclencheur, une cible, un message et un plafond.</p></div>
          ${regler ? `<button type="button" class="pv2-btn sm${editeurOuvert ? '' : ' primary'}" onclick="pv2SeqNew()" ${pv2Seq.creating ? 'disabled' : ''}>Créer une séquence</button>` : ''}
        </div>
        ${perso}
      </section>
      ${mailInventoryPanel()}
    </div>`;
  }

  /* ── APPARENCE & SIGNATURE ─────────────────────────────────────────────── */
  // Une adresse d image du domaine Pinlane se montre dans la console par son
  // chemin : la console tourne aussi en local et en preproduction, ou l adresse
  // absolue pointerait vers la production.
  function pv2CheminLocal(url) {
    try { return new URL(String(url || '')).pathname; } catch (error) { return String(url || ''); }
  }
  // Les couleurs du centre : celles que le serveur envoie, sinon celles de sa
  // fiche, dans le meme ordre (lib/email-design.js, couleursDuCentre).
  function pv2CouleursDuCentre() {
    if (Array.isArray(pv2Design.couleurs) && pv2Design.couleurs.length) return pv2Design.couleurs;
    const b = (pv2Design.center && pv2Design.center.branding) || {};
    const vues = new Set();
    return [['accent', 'La couleur du centre'], ['glow', 'Sa deuxième couleur'], ['accentStrong', 'Sa couleur foncée']]
      .map(([cle, label]) => ({ cle, label, hex: String(b[cle] || '').trim().toLowerCase() }))
      .filter((c) => /^#[0-9a-f]{6}$/.test(c.hex) && !vues.has(c.hex) && vues.add(c.hex));
  }
  const PV2_RESEAUX = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', linkedin: 'LinkedIn' };
  const PV2_DISPOSITIONS = { affiche: 'Affiche', arene: 'Arène', enseigne: 'Enseigne', carte: 'Carte', bandeau: 'Bandeau', ligne: 'Une ligne' };
  // Les formes qui portent la ligne d activites du centre (signature.accroche).
  const PV2_AVEC_ACCROCHE = ['affiche', 'arene', 'enseigne'];
  // Un STYLE COMPLET (Natif, Maison, Arcade, 2026-11-13) signe a sa facon : la forme
  // choisie ne compte plus, sa ligne d activites, si.
  const pv2EstStyleComplet = (presetId) => (pv2DesignGabarits().find((p) => p.id === presetId) || {}).famille === 'styles';

  function pv2DesignFormHtml(d, mayEdit) {
    const dis = mayEdit ? '' : ' disabled';
    const presets = pv2DesignGabarits();
    const centre = pv2Design.center || {};
    const info = centre.publicInfo && typeof centre.publicInfo === 'object' ? centre.publicInfo : {};
    const logos = pv2Design.logos || [];
    const photos = Array.isArray(pv2Design.photos) ? pv2Design.photos : [];
    const formules = Array.isArray(pv2Design.formules) && pv2Design.formules.length ? pv2Design.formules : PV2_FORMULES;
    const couleurs = pv2CouleursDuCentre();
    const logoOptions = (valeur) => `<option value="">Aucun logo</option>${logos.map((l) => `<option value="${esc(l.url)}"${l.url === valeur ? ' selected' : ''}>${esc(l.label)}</option>`).join('')}${valeur && !logos.some((l) => l.url === valeur) ? `<option value="${esc(valeur)}" selected>Adresse personnalisée</option>` : ''}`;
    const champ = (path, label, valeur, { type = 'text', placeholder = '', hint = '', wide = false } = {}) => `<label class="pv2-composer-field${wide ? ' pv2-composer-wide' : ''}"><span>${esc(label)}${hint ? ` <small class="mk-auto-edit-hint">${esc(hint)}</small>` : ''}</span><input type="${type}" value="${esc(valeur === undefined || valeur === null ? '' : valeur)}" placeholder="${esc(placeholder)}" data-pl-focus="emails.design.${esc(path)}" oninput="pv2DesignField('${escJs(path)}', this.value)"${dis}></label>`;
    const interrupteur = (path, on, label, geste = '') => `<button type="button" class="mk-switch${on ? ' is-on' : ''}" data-switch-key="design:${esc(path)}" role="switch" aria-checked="${on}" aria-label="${esc(label)}" onclick="${geste || `pv2DesignBascule('${escJs(path)}')`}"${dis}><span></span></button>`;
    const headerLogo = d.header.mode === 'logo' || d.header.mode === 'logo-nom';
    const nomCentre = String(centre.name || (typeof pv2CenterName === 'function' ? pv2CenterName() : '') || 'votre centre');
    const s = d.signature;
    const afficher = { telephone: true, email: true, site: true, adresse: true, reseaux: true, ...(s.afficher || {}) };
    const photoAllumee = Boolean(s.photo && s.photo.enabled);

    // La couleur du mail : l encre, les couleurs du centre, ou une a soi.
    const couleurPerso = d.accent.mode === 'perso' && !couleurs.some((c) => c.hex === String(d.accent.hex || '').toLowerCase());
    const teinte = (valeur, label, hex, actif, classe = '') => `<button type="button" class="em-teinte${actif ? ' is-active' : ''}" role="radio" aria-checked="${actif}" onclick="pv2DesignTeinte('${escJs(valeur)}')"${dis}><span class="em-teinte-point${classe}"${hex ? ` style="background:${esc(hex)}"` : ''} aria-hidden="true"></span>${esc(label)}</button>`;
    const teintes = [
      teinte('encre', 'Encre, sobre', '', d.accent.mode === 'encre', ' is-encre'),
      ...couleurs.map((c, i) => (i === 0
        ? teinte('centre', c.label, c.hex, d.accent.mode === 'centre')
        : teinte(c.hex, c.label, c.hex, d.accent.mode === 'perso' && String(d.accent.hex || '').toLowerCase() === c.hex))),
      teinte('perso', 'Personnalisée', '', couleurPerso, ' is-perso'),
    ].join('');

    // La signature a vue : sa forme, sa photo, sa formule, ce qu elle affiche.
    const dispositions = [
      ['affiche', 'Affiche', 'Le logo du centre à côté d’une vraie photo, puis vos coordonnées en deux colonnes.'],
      ['arene', 'Arène', 'Un bloc sombre avec le logo blanc, la formule et vos activités.'],
      ['enseigne', 'Enseigne', 'Vos activités sur une bande de la couleur du centre, le logo et les coordonnées dessous.'],
      ['carte', 'Carte', photos.length ? 'Une photo du centre en tête, ou son logo à gauche du texte.' : 'Le logo du centre à gauche, le texte à droite.'],
      ['bandeau', 'Bandeau', 'Un aplat de la couleur du mail, avec le nom du centre en grand.'],
      ['ligne', 'Une ligne', 'La plus discrète, la formule puis une ligne de texte.'],
    ].map(([v, l, t]) => `<button type="button" class="em-disposition em-choix${s.layout === v ? ' is-active' : ''}" role="radio" aria-checked="${s.layout === v}" onclick="pv2DesignChoix('signature.layout', '${v}')"${dis}><span class="em-choix-point" aria-hidden="true"></span><span class="em-choix-texte"><strong>${esc(l)}</strong><small>${esc(t)}</small></span></button>`).join('');
    let blocPhoto = '';
    if (s.layout === 'carte') {
      blocPhoto = photos.length
        ? `<div class="em-design-ligne">
          <div class="pv2-design-scope"><div class="pv2-design-scope-row"><strong>Mettre une photo du centre</strong><small>En tête de la signature, à la place du logo.</small>${interrupteur('signature.photo.enabled', photoAllumee, 'Mettre une photo du centre', 'pv2DesignPhotoBascule()')}</div></div>
          ${photoAllumee ? `<div class="em-photos" role="radiogroup" aria-label="La photo de la signature">${photos.map((p) => `<button type="button" class="em-photo${s.photo.url === p.url ? ' is-active' : ''}" role="radio" aria-checked="${s.photo.url === p.url}" onclick="pv2DesignPhoto('${escJs(p.url)}')"${dis}><img src="${esc(pv2CheminLocal(p.url))}" alt="" loading="lazy" decoding="async"><span>${esc(p.label)}</span></button>`).join('')}</div>` : ''}
        </div>`
        : '<p class="pv2-design-hint">Aucune photo déclarée pour ce centre. La signature porte son logo.</p>';
    } else if (s.layout === 'affiche') {
      // Comme au rendu : la photo choisie si elle a sa bannière, sinon la première.
      const bannieres = photos.filter((p) => p.banniere);
      const choisie = photoAllumee && bannieres.some((p) => p.url === s.photo.url) ? s.photo.url : (bannieres[0] || {}).url;
      blocPhoto = bannieres.length
        ? `<div class="em-design-ligne">
          <p class="em-design-question" id="emBanniereTitre">La photo de l’affiche</p>
          <div class="em-photos" role="radiogroup" aria-labelledby="emBanniereTitre">${bannieres.map((p) => `<button type="button" class="em-photo${choisie === p.url ? ' is-active' : ''}" role="radio" aria-checked="${choisie === p.url}" onclick="pv2DesignPhoto('${escJs(p.url)}')"${dis}><img src="${esc(pv2CheminLocal(p.banniere))}" alt="" loading="lazy" decoding="async"><span>${esc(p.label)}</span></button>`).join('')}</div>
        </div>`
        : '<p class="pv2-design-hint">Aucune bannière déclarée pour ce centre. L’affiche prend sa photo, sinon elle s’en passe.</p>';
    }
    const styleComplet = pv2EstStyleComplet(d.preset);
    if (styleComplet) blocPhoto = '';
    const blocAccroche = PV2_AVEC_ACCROCHE.includes(s.layout) || styleComplet ? `<div class="em-design-ligne">
        <label class="pv2-composer-field"><span>Vos activités en une ligne <small class="mk-auto-edit-hint">vide = pas de ligne d’activités</small></span><input type="text" value="${esc(s.accroche || '')}" maxlength="90" placeholder="Bowling · Laser game · Minigolf · Arcades" data-pl-focus="emails.design.signature.accroche" oninput="pv2DesignField('signature.accroche', this.value)"${dis}></label>
      </div>` : '';
    const blocFormule = `<div class="em-design-ligne">
        <p class="em-design-question" id="emFormuleTitre">La formule de fin</p>
        <div class="em-formules" role="group" aria-labelledby="emFormuleTitre">${formules.map((f) => `<button type="button" class="em-formule${s.closing === f ? ' is-active' : ''}" aria-pressed="${s.closing === f}" onclick="pv2DesignFormule('${escJs(f)}')"${dis}>${esc(f)}</button>`).join('')}</div>
        <label class="pv2-composer-field"><span>Ou écrivez la vôtre <small class="mk-auto-edit-hint">vide = pas de formule</small></span><input type="text" value="${esc(s.closing || '')}" maxlength="80" placeholder="${esc(formules[0] || '')}" data-pl-focus="emails.design.signature.closing" oninput="pv2DesignField('signature.closing', this.value)"${dis}></label>
      </div>`;
    const reseauxNommes = Object.entries(PV2_RESEAUX).filter(([k]) => String((s.socials || {})[k] || '').trim()).map(([, l]) => l).join(' · ');
    const contacts = [
      ['telephone', 'Téléphone', s.phone],
      ['email', 'Adresse mail', s.email],
      ['site', 'Site internet', s.website],
      ['adresse', 'Adresse', s.address],
      ['reseaux', 'Réseaux', reseauxNommes],
    ];
    const blocContacts = `<div class="em-design-ligne">
        <p class="em-design-question">Ce que la signature affiche</p>
        <div class="pv2-design-scope">${contacts.map(([k, l, v]) => `<div class="pv2-design-scope-row"><strong>${esc(l)}</strong><small>${v ? esc(String(v)) : 'pas encore écrit, à compléter dans Plus d’options'}</small>${interrupteur(`signature.afficher.${k}`, afficher[k] !== false, `${l} dans la signature`)}</div>`).join('')}</div>
      </div>`;

    // LE STYLE (2026-11-12, en liste depuis le 2026-11-13) : chaque gabarit en vignette, le vrai mail du centre
    // avec ce brouillon, range par famille (sa regle de boite de reception). Ansar, 2026-11-12, devant la grille
    // de petites vignettes : « je comprends juste rien ». Une ligne par style, la vignette, son nom, ce qu il
    // fait, et « Choisi » sur le sien ; le grand apercu d a cote montre le mail en vrai.
    const carteGabarit = (p) => {
      const actif = d.preset === p.id;
      const cle = `galerie-${p.id}`;
      PV2_FRAMES[cle] = pv2GalerieVignette(p.id);
      return `<div class="em-galerie-carte em-ap-style${actif ? ' is-active' : ''}" data-em-gabarit="${esc(p.id)}">
          <div class="em-galerie-vignette em-ap-style-vignette" aria-hidden="true"><iframe class="em-galerie-cadre" sandbox="" tabindex="-1" title="" data-pv2-frame="${esc(cle)}"></iframe></div>
          <button type="button" class="pv2-design-preset em-galerie-choix${actif ? ' is-active' : ''}" role="radio" aria-checked="${actif}" onclick="pv2DesignChoix('preset', '${escJs(p.id)}')"${dis}><strong>${esc(p.label)}</strong><small>${esc(p.description || '')}</small>${actif ? '<span class="em-ap-choisi">Choisi</span>' : ''}</button>
        </div>`;
    };
    const blocStyle = `<p class="em-ap-question">À quoi ressemblent vos mails ?</p>${pv2DesignFamillesDe(presets).map((f) => {
      const [titre, aide] = PV2_FAMILLES_DITES[f.id] || [f.label, f.aide];
      const grille = `<div class="em-galerie-grille em-ap-styles" role="radiogroup" aria-label="${esc(titre || 'Style du mail')}">${f.gabarits.map(carteGabarit).join('')}</div>`;
      if (f.id === 'avant') {
        return `<details class="em-galerie-famille em-ap-famille is-avant" data-em-famille="avant"${f.gabarits.some((p) => p.id === d.preset) ? ' open' : ''}><summary>${esc(titre)}<span>${f.gabarits.length}</span></summary>${grille}</details>`;
      }
      return `<div class="em-galerie-famille em-ap-famille" data-em-famille="${esc(f.id)}">${titre ? `<p class="em-galerie-titre"><strong>${esc(titre)}</strong>${aide ? `<small>${esc(aide)}</small>` : ''}</p>` : ''}${grille}</div>`;
    }).join('')}`;
    const blocCouleur = `<p class="em-ap-question">La couleur de vos mails</p>
      <p class="pv2-design-hint">Elle colore les boutons, le bloc du jour et la signature. Le texte reste en noir.${couleurs.length ? '' : ' Aucune couleur dans la fiche du centre.'}</p>
      <div class="em-teintes" role="radiogroup" aria-label="Couleur du mail">${teintes}</div>
      ${couleurPerso ? `<span class="pv2-design-inline"><input type="color" value="${/^#[0-9a-f]{6}$/i.test(String(d.accent.hex || '')) ? esc(d.accent.hex) : '#0a0a0a'}" aria-label="Choisir la couleur" oninput="pv2DesignField('accent.hex', this.value)"${dis}><input type="text" value="${esc(d.accent.hex || '')}" placeholder="#0a0a0a" maxlength="7" aria-label="Code couleur" data-pl-focus="emails.design.accent.hex" oninput="pv2DesignField('accent.hex', this.value)"${dis}></span>` : ''}`;
    const blocSignature = `<p class="em-ap-question">La signature en bas de vos mails</p>${pv2Design.exempleCourt && pv2Design.sample === 'reponse' ? '<p class="pv2-design-hint">L’aperçu montre une réponse courte, la signature est juste sous le texte.</p>' : ''}
      <div class="pv2-design-scope">
        <div class="pv2-design-scope-row"><strong>Signer les mails</strong><small>La formule de fin, l’équipe ou la personne qui écrit, les coordonnées et les réseaux du centre.</small>${interrupteur('signature.enabled', Boolean(s.enabled), 'Signer les mails')}</div>
      </div>
      ${s.enabled ? `<div class="em-design-ligne">
        <p class="em-design-question" id="emDispositionTitre">Sa forme</p>
        ${styleComplet
          ? '<p class="pv2-design-hint">Ce style signe vos mails à sa façon : la formule, qui écrit, vos activités et vos coordonnées, avec le vrai logo du centre quand le haut du mail ne le montre pas déjà.</p>'
          : `<div class="em-dispositions" role="radiogroup" aria-labelledby="emDispositionTitre">${dispositions}</div>`}
      </div>
      ${blocPhoto}${blocAccroche}${blocFormule}${blocContacts}
      ${emOptionsHtml('apparence-signature', 'nom d’équipe, coordonnées, réseaux', `<div class="pv2-design-fields">
          ${champ('signature.teamLabel', 'Nom d\'équipe', s.teamLabel, { placeholder: `L'équipe ${nomCentre}`, hint: 'vide = « L\'équipe » + nom du centre' })}
          ${champ('signature.role', 'Rôle affiché', s.role, { placeholder: 'Ex. Direction', hint: 'sur les mails manuels, le rôle de la personne prime' })}
          ${champ('signature.phone', 'Téléphone', s.phone, { type: 'tel', placeholder: 'vide = absent du mail' })}
          ${champ('signature.email', 'Email', s.email, { type: 'email', placeholder: 'vide = absent du mail' })}
          ${champ('signature.website', 'Site web (https)', s.website, { type: 'url', placeholder: 'vide = absent du mail' })}
          ${champ('signature.address', 'Adresse', s.address, { placeholder: 'vide = absente du mail', wide: true })}
          <label class="pv2-composer-field"><span>Logo de signature</span><select onchange="pv2DesignChoix('signature.logoUrl', this.value)"${dis}>${logoOptions(s.logoUrl)}</select></label>
          ${champ('signature.logoWidth', 'Largeur du logo (px, 60 à 300)', s.logoWidth, { type: 'number' })}
          ${champ('signature.logoUrl', 'Adresse de l\'image (https)', s.logoUrl, { type: 'url', placeholder: 'https://…/logo.png', wide: true })}
          ${champ('signature.socials.facebook', 'Facebook', s.socials.facebook, { type: 'url', placeholder: 'https://facebook.com/…' })}
          ${champ('signature.socials.instagram', 'Instagram', s.socials.instagram, { type: 'url', placeholder: 'https://instagram.com/…' })}
          ${champ('signature.socials.tiktok', 'TikTok', s.socials.tiktok, { type: 'url', placeholder: 'https://tiktok.com/@…' })}
          ${champ('signature.socials.linkedin', 'LinkedIn', s.socials.linkedin, { type: 'url', placeholder: 'https://linkedin.com/company/…' })}
        </div>
        <p class="pv2-design-hint">Les réseaux s'écrivent en toutes lettres dans la signature, jamais en icônes d'une autre marque. Un mail automatique garde deux liens au plus.</p>`)}
      <div class="em-design-ligne">
        <p class="em-design-question">Sur quels mails</p>
        <div class="pv2-design-scope">
          <div class="pv2-design-scope-row"><strong>Messages écrits à la main</strong><small>Vos réponses et messages libres, signés par la personne qui écrit.</small>${interrupteur('signatureScope.manual', Boolean(d.signatureScope.manual), 'Messages écrits à la main')}</div>
          <div class="pv2-design-scope-row"><strong>Mails automatiques</strong><small>Confirmations, rappels et relances, signés par l'équipe.</small>${interrupteur('signatureScope.sequences', Boolean(d.signatureScope.sequences), 'Mails automatiques')}</div>
          <div class="pv2-design-scope-row"><strong>Campagnes</strong><small>Les envois groupés gardent leur ligne de désinscription quoi qu'il arrive.</small>${interrupteur('signatureScope.campaigns', Boolean(d.signatureScope.campaigns), 'Campagnes')}</div>
        </div>
      </div>` : ''}`;
    const blocPlus = `<p class="em-ap-question">Le haut et le bas de vos mails</p>
      <div class="em-design-groupe" role="group" aria-label="En-tête">
        <p class="em-design-question">En haut du mail</p>
        <div class="pv2-design-fields">
          <label class="pv2-composer-field"><span>Afficher</span>
            <select onchange="pv2DesignChoix('header.mode', this.value)"${dis}>
              ${[['nom', 'Le nom du centre'], ['logo', 'Le logo'], ['logo-nom', 'Le logo et le nom'], ['aucun', 'Rien']].map(([v, l]) => `<option value="${v}"${d.header.mode === v ? ' selected' : ''}>${l}</option>`).join('')}
            </select>
          </label>
          ${headerLogo ? `<label class="pv2-composer-field"><span>Logo</span><select onchange="pv2DesignChoix('header.logoUrl', this.value)"${dis}>${logoOptions(d.header.logoUrl)}</select></label>
          ${champ('header.logoUrl', 'Adresse de l\'image (https)', d.header.logoUrl, { type: 'url', placeholder: 'https://…/logo.png', wide: true })}
          ${champ('header.logoWidth', 'Largeur du logo (px, 60 à 300)', d.header.logoWidth, { type: 'number' })}` : ''}
        </div>
        ${headerLogo && !logos.length ? '<p class="pv2-design-hint">Aucun logo déclaré pour ce centre. Collez l\'adresse https d\'une image, ou laissez le nom du centre.</p>' : ''}
      </div>
      <div class="em-design-groupe" role="group" aria-label="Pied de page">
        <p class="em-design-question">En bas du mail</p>
        <p class="pv2-design-hint">Les coordonnées viennent de la fiche du centre. Ce qui n'y est pas renseigné reste absent du mail.</p>
        <div class="pv2-design-scope">
          ${[['adresse', 'Adresse', info.address], ['telephone', 'Téléphone', info.phone], ['email', 'Adresse email', info.email]].map(([k, l, v]) => `<div class="pv2-design-scope-row"><strong>${l}</strong><small>${v ? esc(String(v)) : 'non renseigné dans la fiche du centre'}</small>${interrupteur(`footer.${k}`, Boolean(d.footer[k]), l)}</div>`).join('')}
        </div>
        <label class="pv2-composer-field"><span>Une phrase en plus <small class="mk-auto-edit-hint">vide = rien de plus</small></span><textarea rows="2" maxlength="300" placeholder="Par exemple : fermé le lundi hors vacances scolaires." data-pl-focus="emails.design.footer.mention" oninput="pv2DesignField('footer.mention', this.value)"${dis}>${esc(d.footer.mention || '')}</textarea></label>
      </div>`;
    const rubrique = PV2_DESIGN_RUBRIQUES.some(([k]) => k === pv2Design.rubrique) ? pv2Design.rubrique : 'style';
    const resume = pv2DesignResume(d);
    const panneau = { style: blocStyle, couleur: blocCouleur, signature: blocSignature, plus: blocPlus }[rubrique];
    return `<div class="pv2-design-form em-ap-reglages">
      <div class="em-ap-rubriques" role="tablist" aria-label="Réglages de l’apparence">${PV2_DESIGN_RUBRIQUES.map(([k, l]) => `<button type="button" role="tab" id="emAp-${k}" aria-controls="emApPanneau" aria-selected="${rubrique === k}" class="em-ap-rubrique${rubrique === k ? ' is-active' : ''}" onclick="pv2DesignRubrique('${k}')"><strong>${esc(l)}</strong><small>${esc(resume[k] || '')}</small></button>`).join('')}</div>
      <section class="em-ap-panneau" id="emApPanneau" role="tabpanel" aria-labelledby="emAp-${rubrique}">${panneau}</section>
    </div>`;
  }

  // LES RUBRIQUES DE L APPARENCE (2026-11-13) : ce qu un gerant se demande, dans l ordre, et ce qui est choisi
  // dessous. Une seule ouverte : la page tient sur un ecran de PC, le mail reste en vue a cote.
  const PV2_DESIGN_RUBRIQUES = [['style', 'Style'], ['couleur', 'Couleur'], ['signature', 'Signature'], ['plus', 'Haut et bas']];
  // Les familles dites comme un gerant les comprend : le serveur les nomme pour sa regle de boite de reception.
  const PV2_FAMILLES_DITES = {
    principale: ['Pour tous vos mails', 'Peu d’images et de liens, pour que vos confirmations, rappels et réponses arrivent dans la boîte principale de Gmail.'],
    centre: ['Avec la photo de l’activité', 'Le mail montre la photo de l’activité réservée, pour les centres qui ont leurs photos.'],
    campagne: ['Pour les campagnes seulement', 'Une grande image pour vos envois groupés. Les confirmations et les rappels gardent un style simple.'],
    avant: ['Les styles d’avant', ''],
  };
  // Ce qui est choisi dans chaque rubrique, en mots.
  function pv2DesignResume(d) {
    const preset = pv2DesignGabarits().find((p) => p.id === d.preset);
    const couleur = pv2CouleursDuCentre().find((c) => c.hex === String(d.accent.hex || '').toLowerCase());
    const accent = d.accent.mode === 'perso' ? (couleur ? couleur.label : 'À vous') : d.accent.mode === 'centre' ? 'Du centre' : 'Noir';
    const entete = { nom: 'Le nom', logo: 'Le logo', 'logo-nom': 'Logo et nom', aucun: 'Rien' }[d.header.mode] || '';
    return {
      style: preset ? preset.label : String(d.preset || ''),
      couleur: accent,
      signature: d.signature && d.signature.enabled ? (PV2_DISPOSITIONS[d.signature.layout] || 'Carte') : 'Aucune',
      plus: entete,
    };
  }
  window.pv2DesignRubrique = function (rubrique) {
    pv2Design.rubrique = PV2_DESIGN_RUBRIQUES.some(([k]) => k === rubrique) ? rubrique : 'style';
    renderStaffEmailsPage();
    if (pv2Design.rubrique === 'style') pv2GalerieCharger(0);
    // LA SIGNATURE SE VOIT EN REGLANT LA SIGNATURE : une confirmation la pose sous le billet et l agenda, une
    // reponse juste sous trois lignes. L exemple passe sur la reponse quand elle est signee, et le panneau le dit.
    const d = pv2Design.design || pv2DesignVide();
    if (pv2Design.rubrique === 'signature' && pv2Design.sample === 'confirmation' && d.signatureScope && d.signatureScope.manual) {
      pv2Design.sample = 'reponse';
      pv2Design.exempleCourt = true;
      renderStaffEmailsPage();
      pv2ApercuDesign(0);
    }
  };

  // Sans le droit de modifier, le reglage se lit en texte, sans champ grise.
  // L apercu d a cote montre le mail tel qu il part.
  function pv2DesignLectureHtml(d) {
    const presets = pv2DesignGabarits();
    const preset = presets.find((p) => p.id === d.preset);
    const couleur = pv2CouleursDuCentre().find((c) => c.hex === String(d.accent.hex || '').toLowerCase());
    const accent = d.accent.mode === 'perso' ? (couleur ? couleur.label : `Personnalisée ${d.accent.hex || ''}`) : d.accent.mode === 'centre' ? 'La couleur du centre' : 'Encre';
    const entete = { nom: 'Le nom du centre', logo: 'Le logo', 'logo-nom': 'Le logo et le nom', aucun: 'Rien' }[d.header.mode] || '';
    const liste = (paires) => paires.filter(([, on]) => on).map(([label]) => label).join(', ');
    const s = d.signature;
    const photo = (s.layout === 'carte' || s.layout === 'affiche') && s.photo && s.photo.enabled ? ((pv2Design.photos || []).find((p) => p.url === s.photo.url) || {}).label || 'une photo du centre' : '';
    const signature = s.enabled
      ? [pv2EstStyleComplet(d.preset) ? 'Celle du style' : (PV2_DISPOSITIONS[s.layout] || 'Carte'), photo && !pv2EstStyleComplet(d.preset) ? `avec ${photo}` : '', s.closing, PV2_AVEC_ACCROCHE.includes(s.layout) || pv2EstStyleComplet(d.preset) ? s.accroche : '', s.teamLabel, s.role, s.phone, s.email, s.website, s.address, ...Object.values(s.socials || {})].filter(Boolean).join(' · ')
      : 'Non';
    const ligne = (label, valeur) => `<div class="pv2-design-scope-row"><strong>${esc(label)}</strong><small>${esc(valeur)}</small></div>`;
    return `<div class="pv2-design-form">
      <section class="pv2-design-block" aria-label="Réglages">
        <h3>Réglages</h3>
        <div class="pv2-design-scope">
          ${ligne('Gabarit', preset ? preset.label : d.preset)}
          ${ligne('Couleur', accent)}
          ${ligne('En-tête', entete)}
          ${ligne('Pied de page', liste([['Adresse', d.footer.adresse], ['Téléphone', d.footer.telephone], ['Adresse email', d.footer.email]]) || 'Rien')}
          ${ligne('Mention libre', d.footer.mention || 'Aucune')}
          ${ligne('Signature', signature)}
          ${ligne('Signature sur', liste([['Messages manuels', d.signatureScope.manual], ['Séquences', d.signatureScope.sequences], ['Campagnes', d.signatureScope.campaigns]]) || 'Aucun mail')}
        </div>
      </section>
    </div>`;
  }

  function pv2EmailsSectionApparence() {
    if (!pv2Design.loaded) {
      return `<section class="pv2-panel"><div class="pv2-panel-body"><div class="pv2-empty" aria-live="polite" aria-busy="true">${typeof renderThinking === 'function' ? renderThinking('searching') : '<strong>Chargement…</strong>'}</div></div></section>`;
    }
    if (pv2Design.error && !pv2Design.design) {
      return `<section class="pv2-panel"><div class="pv2-panel-body"><div class="pv2-empty"><strong>${esc(pv2Design.error)}</strong><button type="button" class="pv2-btn sm" onclick="loadPv2Design(true)">Réessayer</button></div></div></section>`;
    }
    const d = pv2Design.design || pv2DesignVide();
    // emailDesign (ecriture) : settings.manage ou emails.send ; sendDesignTest : emails.send.
    const mayEdit = typeof canUseStaffPermission !== 'function' || canUseStaffPermission(['settings.manage', 'emails.send']);
    const mayTest = typeof canUseStaffPermission !== 'function' || canUseStaffPermission('emails.send');
    const samples = [['confirmation', 'Confirmation'], ['reponse', 'Réponse'], ['campagne', 'Campagne']].map(([key, label]) => ({ key, label, active: pv2Design.sample === key }));
    const busy = pv2Design.busy;
    // L EXEMPLE MONTRE se choisit dans une liste qui dit ce que c est : trois boutons a cote de « Ordinateur » et
    // « Clair » se lisaient comme des reglages du mail (Ansar, 2026-11-12 : « je comprends juste rien »).
    const exemple = `<label class="em-ap-exemple"><span>Exemple</span><select onchange="pv2DesignSample(this.value)" aria-label="Le mail montré en exemple">${samples.map((x) => `<option value="${x.key}"${x.active ? ' selected' : ''}>${esc(PV2_DESIGN_EXEMPLES[x.key] || x.label)}</option>`).join('')}</select></label>`;
    const etat = pv2Design.dirty ? 'Pas encore enregistré.' : d.updatedAt ? `Enregistré ${esc(formatOpsTimestamp(d.updatedAt))}${d.updatedBy ? ` par ${esc(d.updatedBy)}` : ''}.` : 'Apparence par défaut, rien n’est encore enregistré pour ce centre.';
    return `<div class="pv2-design-layout em-ap">
      ${mayEdit ? pv2DesignFormHtml(d, mayEdit) : pv2DesignLectureHtml(d)}
      <div class="pv2-design-preview em-ap-apercu">
        <div class="em-ap-barre">
          <div class="em-ap-barre-texte"><p class="em-ap-titre">Ce que reçoit votre client</p><p class="pv2-note em-ap-etat${pv2Design.dirty ? ' is-dirty' : ''}">${etat}</p></div>
          ${mayEdit ? `<div class="pv2-design-actions em-actions">
            ${mayTest ? `<button type="button" class="pv2-btn em-second" onclick="pv2DesignTest()" ${busy ? 'disabled' : ''}>${busy === 'test' ? 'Envoi…' : 'M’envoyer un test'}</button>` : ''}
            <button type="button" class="pv2-btn primary em-principal" onclick="pv2DesignSave()" ${busy || !pv2Design.dirty ? 'disabled' : ''}>${busy === 'save' ? 'Enregistrement…' : 'Enregistrer'}</button>
            ${emMenuPlusHtml('emDesignPlus', 'Plus d’actions sur l’apparence', [emGestePlus('Rétablir les défauts', 'pv2DesignReset()', { danger: true, inactif: Boolean(busy) })])}
          </div>` : ''}
        </div>
        ${mayEdit ? '' : '<p class="pv2-note">Votre rôle ne permet pas de modifier l\'apparence des mails. Vous pouvez la consulter.</p>'}
        ${pv2Design.erreurServeur ? `<p class="pv2-design-error" role="alert">${esc(pv2Design.erreurServeur)}</p>` : ''}
        ${pv2ApercuVivantHtml('design', { titre: 'Le mail', tete: exemple, cadre: 'pv2-design-frame' })}
      </div>
    </div>`;
  }

  /* ── EXCLUSIONS, CAMPAGNES ─────────────────────────────────────────────── */
  /* ── EXCLUSIONS (2026-11-10) : la liste qui se cherche, l ajout et le
     retrait, et pour chaque adresse la raison quand elle est connue. La
     recherche filtre sur place : un rendu a chaque lettre ferait perdre le
     curseur. ── */
  const EM_EXCLU_ORIGINE = {
    link: 'S’est retiré avec le lien en bas d’un mail',
    staff: 'Ajouté à la main par l’équipe',
    complaint: 'A signalé un mail comme indésirable',
    form: 'A refusé le marketing en réservant',
  };
  function pv2EmailsSectionExclusions() {
    // suppressionAdd et suppressionRemove : campaigns.manage ou emails.send (api/ops.js).
    const exclure = typeof canUseStaffPermission !== 'function' || canUseStaffPermission(['campaigns.manage', 'emails.send']);
    const count = pv2Suppress.loaded ? pv2Suppress.total : (pv2Suppress.entries.length || 0);
    const q = String(pv2Suppress.q || '').trim().toLowerCase();
    const cascade = { n: 0 };
    const lignes = pv2Suppress.entries.map((entry) => {
      const cherche = `${entry.email} ${entry.reason || ''}`.toLowerCase();
      const when = formatOpsTimestamp(entry.createdAt) || '';
      const src = PV2_SUPPRESS_SOURCE[entry.source] || entry.source || '';
      const busy = pv2Suppress.busy === `rm:${entry.email}`;
      const pourquoi = String(entry.reason || '').trim() || EM_EXCLU_ORIGINE[entry.source] || 'Aucune raison notée.';
      return `<li class="em-exclu-row" data-em-cherche="${esc(cherche)}"${q && !cherche.includes(q) ? ' hidden' : ''}${emEntree(`exclusions:${entry.email}`, cascade)}>
        <div class="em-exclu-qui"><strong>${esc(entry.email)}</strong><span>${esc(pourquoi)}</span></div>
        <span class="em-exclu-meta">${esc(src)}${when ? ` · ${esc(when)}` : ''}</span>
        ${exclure ? `<button type="button" class="em-lien" onclick="pv2SuppressRemove('${escJs(entry.email)}')" ${busy ? 'disabled' : ''}>${busy ? 'Retrait…' : 'Réinscrire'}</button>` : ''}
      </li>`;
    }).join('');
    const visibles = q ? pv2Suppress.entries.filter((e) => `${e.email} ${e.reason || ''}`.toLowerCase().includes(q)).length : pv2Suppress.entries.length;
    const corps = pv2Suppress.error
      ? `<div class="em-vide"><p>${esc(pv2Suppress.error)}</p><button type="button" class="pv2-btn sm" onclick="loadPv2Suppressions(true)">Réessayer</button></div>`
      : !pv2Suppress.loaded
        ? `<div class="em-attente" aria-live="polite" aria-busy="true">${typeof renderThinking === 'function' ? renderThinking('searching') : '<strong>Chargement…</strong>'}</div>`
        : pv2Suppress.entries.length
          ? `<ul class="em-exclu-rows">${lignes}</ul><p class="em-calme em-exclu-aucune"${visibles || !q ? ' hidden' : ''}>Aucune adresse ne contient « ${esc(String(pv2Suppress.q || '').trim())} ».</p>`
          : '<p class="em-calme">Personne ne s’est retiré du marketing pour l’instant.</p>';
    return `<section class="em-block em-exclu" aria-label="Exclusions">
      <div class="em-block-head"><div><h2 class="em-h2">Exclusions</h2><p class="em-sub">${pv2Suppress.loaded
        ? `${count} adresse${count > 1 ? 's ne reçoivent' : ' ne reçoit'} plus de marketing (campagnes, anniversaire, réactivation).`
        : 'Les adresses qui ne reçoivent plus de marketing (campagnes, anniversaire, réactivation).'} Elles reçoivent toujours les confirmations et les rappels de leurs réservations.</p></div></div>
      ${exclure ? `<div class="em-exclu-ajout" role="group" aria-labelledby="emExcluAjoutTitre">
        <p class="em-exclu-titre" id="emExcluAjoutTitre">Retirer une adresse du marketing</p>
        <div class="em-exclu-champs">
          <input type="email" value="${esc(pv2Suppress.addEmail)}" placeholder="L’adresse du client, par exemple marie@exemple.be" aria-label="Adresse à exclure" data-pl-focus="emails.exclusions.email" oninput="pv2SuppressSetAdd('email', this.value)">
          <input type="text" value="${esc(pv2Suppress.addReason)}" placeholder="La raison, si vous voulez" aria-label="Raison de l’exclusion" data-pl-focus="emails.exclusions.raison" oninput="pv2SuppressSetAdd('reason', this.value)">
          <button type="button" class="pv2-btn primary em-principal" onclick="pv2SuppressAdd()" ${pv2Suppress.busy === 'add' ? 'disabled' : ''}>${pv2Suppress.busy === 'add' ? 'Ajout…' : 'Exclure cette adresse'}</button>
        </div>
      </div>` : ''}
      <div class="em-exclu-outils">
        <label class="pv2-search em-exclu-recherche">${ci('search')}<input type="search" value="${esc(pv2Suppress.q || '')}" placeholder="Chercher une adresse ou une raison" aria-label="Chercher une adresse exclue" data-pl-focus="emails.exclusions.recherche" oninput="emExcluFiltre(this.value)"></label>
      </div>
      ${corps}
    </section>`;
  }
  window.emExcluFiltre = function (valeur) {
    pv2Suppress.q = String(valeur || '');
    const q = pv2Suppress.q.trim().toLowerCase();
    let visibles = 0;
    document.querySelectorAll('#staffEmailsPage .em-exclu-row').forEach((li) => {
      li.hidden = Boolean(q) && String(li.dataset.emCherche || '').indexOf(q) < 0;
      if (!li.hidden) visibles += 1;
    });
    const aucune = document.querySelector('#staffEmailsPage .em-exclu-aucune');
    if (aucune) { aucune.hidden = !q || visibles > 0; aucune.textContent = `Aucune adresse ne contient « ${pv2Suppress.q.trim()} ».`; }
  };

  function pv2EmailsSectionCampagnes() {
    const bloc = typeof renderPv2RealCampaigns === 'function' ? renderPv2RealCampaigns() : '';
    return bloc || '<section class="em-block"><p class="em-calme">Votre rôle ne permet pas de gérer les campagnes.</p></section>';
  }

  /* ── LE ROUTEUR ─────────────────────────────────────────────────────────── */
  function renderStaffEmailsPaint(root, errorMessage = '') {
    // Chargements communs a toutes les sections. Chacun se garde lui-meme
    // contre un double appel.
    if (!mkAuto.loaded && !mkAuto.loading) setTimeout(() => loadStaffAutomations(), 0);
    if (!pv2Seq.loaded && !pv2Seq.loading) setTimeout(() => loadPv2Sequences(), 0);
    if (!pv2Suppress.loaded && !pv2Suppress.loading) setTimeout(() => loadPv2Suppressions(), 0);
    // C14 : ops-console.js est injecté à la demande, requestOpsAdminLoad
    // (app-main) charge le script puis déclenche loadOpsAdmin.
    if (!opsAdminCache.loaded && !opsAdminCache.loading) setTimeout(() => requestOpsAdminLoad(false), 0);
    if (!pv2Mail.metaLoaded && !pv2Mail.metaLoading) setTimeout(() => loadPv2MailMeta(), 0);
    const section = pv2SectionCourante();
    // Chargements propres a la section ouverte.
    if (section === 'apercu' || section === 'recus' || section === 'envoyes' || section === 'sequences') { if (!pv2Overview.loaded && !pv2Overview.loading) setTimeout(() => loadPv2Overview(), 0); }
    if (section === 'apercu' && !pv2Threads.apercu.loaded && !pv2Threads.apercu.loading) setTimeout(() => loadPv2ThreadsApercu(), 0);
    if (section === 'recus' && !pv2Threads.loaded && !pv2Threads.loading) setTimeout(() => loadPv2Threads(), 0);
    if ((section === 'apparence' || section === 'expediteurs' || section === 'recus') && !pv2Design.loaded && !pv2Design.loading) setTimeout(() => loadPv2Design(), 0);
    if (section === 'agent' && !pv2Settings.brain.loaded && !pv2Settings.brain.loading) setTimeout(() => loadPv2Brain(), 0);
    const mayCampaigns = pv2PeutVoirSection('campagnes');
    if (section === 'campagnes' && mayCampaigns && typeof pv2Camp !== 'undefined' && !pv2Camp.loaded && !pv2Camp.loading) setTimeout(() => loadPv2Campaigns(), 0);

    const renderers = {
      apercu: pv2EmailsSectionApercu,
      recus: pv2EmailsSectionRecus,
      envoyes: pv2EmailsSectionEnvoyes,
      sequences: pv2EmailsSectionSequences,
      modeles: pv2EmailsSectionModeles,
      apparence: pv2EmailsSectionApparence,
      expediteurs: pv2EmailsSectionExpediteurs,
      agent: pv2EmailsSectionAgent,
      exclusions: pv2EmailsSectionExclusions,
      campagnes: pv2EmailsSectionCampagnes,
    };
    const sectionChanged = PV2_EMAILS_MOTION.section !== section;
    const premierePeinture = !PV2_EMAILS_MOTION.section;
    PV2_EMAILS_MOTION.section = section;
    // UNE SECTION QUI S OUVRE REJOUE SES ENTREES : le panneau monte de 4 px,
    // ses listes arrivent en cascade. Un simple rendu (poll, frappe) ne rejoue
    // rien. A la premiere peinture, la page entiere entre deja (mount) : le
    // panneau ne double pas ce mouvement.
    if (sectionChanged) EM_MOTION.departs = {};
    if (premierePeinture) emDejaLa(`panneau:${section}`);
    const entreePanneau = emEntree(`panneau:${section}`);
    const sectionHtml = (renderers[section] || renderers.apercu)();

    /* L EN-TETE (2026-11-10) : le titre, une phrase qui dit ce qui attend, et
       deux actions. Nouveau message est la primaire, sauf quand la section
       porte la sienne (emSectionAUnPrincipal, lot S) ; Coller un mail reçu
       est secondaire ; l actualisation est un bouton discret a cote de
       l heure des donnees. Un <div> et pas un <header> : en console, la regle
       globale « body.staff-mode header » replie tout <header> a zero (c est
       celui de l application qu elle vise). */
    root.innerHTML = `<div class="pv2-shell em-shell">
      <div class="em-head">
        <div class="em-head-main">
          <p class="em-centre"><span class="em-centre-point" aria-hidden="true"></span><span data-centre-nom>${esc(typeof window.staffCenterShortName === 'function' ? window.staffCenterShortName() : '')}</span></p>
          <h1 class="em-title">Emails &amp; relances</h1>
          <p class="em-status">${esc(emStatutDuJour())}${errorMessage ? ` <span class="em-status-err">${esc(errorMessage)}</span>` : ''}</p>
        </div>
        <div class="em-head-actions pv2-bar-actions">
          <span class="em-stamp">${esc(emHeureDeMaj())}</span>
          <button type="button" class="pv2-btn sm ghost em-icon-btn" onclick="pv2EmailsActualiser()" title="Recharger les données" aria-label="Actualiser">${ci('refresh')}</button>
          <button type="button" class="pv2-btn" onclick="pv2OpenAnalyze()">${ci('inbox')}Coller un mail reçu</button>
          ${typeof peutGeste !== 'function' || peutGeste('ecrire') ? `<button type="button" class="pv2-btn${emSectionAUnPrincipal(section) ? '' : ' primary'}" onclick="pv2OpenComposer()">${ci('send')}Nouveau message</button>` : ''}
        </div>
      </div>
      ${pv2Mail.analyzeOpen ? pv2AnalyzePanel() : ''}
      <div class="em-body">
        ${pv2SubnavHtml(section)}
        <section class="em-main pv2-emails-section" id="pv2EmailsPanel" role="tabpanel" aria-labelledby="pv2EmailsTab-${section}" data-section="${section}"${entreePanneau}>
          ${sectionHtml}
        </section>
      </div>
    </div>`;
    mount(root, 'emails');
    // Le mouvement se recale APRES la reconstruction, jamais pendant : ces
    // appels lisent une memoire hors DOM, comparent, et ne bougent que ce qui
    // a reellement change d'etat.
    pv2PoserIndicateurSousNav(root, false);
    slidePipeRail(root);
    replaySwitchKnobs(root);
    pv2TokeditAdoptAll(root);
    emIaVerrouiller();
    markEmailsMounts(root, {
      analyze: pv2Mail.analyzeOpen,
      settings: section === 'modeles' || section === 'expediteurs' || section === 'agent',
      seqEditor: pv2Seq.creating || pv2Seq.editId,
      autoEditor: mkAuto.editKey,
      tplEditor: pv2Settings.tplEditing,
      inventory: state.staffEmailInventoryOpen,
      threadReply: pv2Threads.selectedId && pv2Threads.detail.loaded && pv2Threads.detail.thread,
    });
    pv2FillFrames(root);
    pv2RemplirMailsRecus(root);
    emSuivreLaReponse();
  }

  /* ==========================================================================
     ICONES DU MODULE MARKETING. L ancienne page Campagnes « gamifiee »
     (paliers, jauges, presse-papiers) est partie avec ses constantes : la
     page Campagnes est un tableau sobre, le Marketing un fil de travail.
     ======================================================================== */

  function ci(name) {
    const paths = {
      check: '<path d="M20 6 9 17l-5-5"/>',
      bolt: '<path d="M13 2 3 14h7l-1 8 10-12h-7z"/>',
      alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
      lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
      copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
      flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
      star: '<path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/>',
      refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>',
      channel: '<path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/>',
      calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
      target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
      wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.8-.7-.7-2.8z"/>',
      flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
      phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.9.5 2.8.7a2 2 0 0 1 1.7 2z"/>',
      mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
      send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
      message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
      note: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
      droplet: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
      bulb: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/>',
      megaphone: '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
      chevrons: '<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>',
      chevronUp: '<path d="m18 15-6-6-6 6"/>',
      chevronDown: '<path d="m6 9 6 6 6-6"/>',
      search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/>',
      inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
      sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"/>',
      pencil: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/><path d="m15 5 4 4"/>',
    };
    return `<svg class="pv2-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`;
  }

  /* ==========================================================================
     MARKETING : le conseiller data (insight-only : il propose, tu appliques,
     il mesure). Les idées viennent du serveur (marketing_insights, générées
     chaque matin par le cron sur les chiffres réels + météo + calendrier).
     ======================================================================== */

  /* ==========================================================================
     MARKETING : « LE BRIEF » (refonte 2026-07-17)
     Le mémo quotidien de l'employé marketing : la paie (euros liés aux
     publications), le brief signé, le radar 14 jours, la file unique de
     Propositions, les reçus (mesures J+14), la veille en footer.
     UN objet (la Proposition), UNE voix (la première personne), UN fetch
     (action=marketingBrief).
     LOI DE DESIGN (silence hiérarchique) : une seule action --accent visible
     par composant ; le secondaire en liens texte --muted/--faint ; zéro carte
     dans une carte ; hairlines --line uniquement ; tout chiffre en --font-data
     tabular-nums ; zéro couleur en dur ; light/dark auto.
     ======================================================================== */

  const pv2Camp = {
    loaded: false, loading: false, error: '', campaigns: [], segments: [], channel: {},
    formOpen: false, editingId: null, busy: false, audience: {}, audienceLoading: '',
    form: { name: '', objective: '', segment: 'all', subject: '', body: '', mode: 'now', scheduledAt: '' },
  };
  window.pv2Camp = pv2Camp;

  async function loadPv2Campaigns(force = false) {
    if (pv2Camp.loading || (pv2Camp.loaded && !force)) return;
    pv2Camp.loading = true;
    pv2Camp.error = '';
    try {
      const payload = await apiRequest(`/api/ops?action=listCampaigns&centerId=${encodeURIComponent(state.adminCenterId || 'libramont')}`);
      pv2Camp.campaigns = payload.campaigns || [];
      pv2Camp.segments = payload.segments || [];
      pv2Camp.channel = payload.channel || {};
      pv2Camp.loaded = true;
    } catch (error) {
      pv2Camp.error = error.message || 'Campagnes indisponibles.';
    } finally {
      pv2Camp.loading = false;
      renderStaffEmailsPage();
    }
  }
  window.loadPv2Campaigns = loadPv2Campaigns;

  window.pv2CampSegmentChanged = async function (segment) {
    pv2Camp.form.segment = segment;
    if (pv2Camp.audience[segment] === undefined && pv2Camp.audienceLoading !== segment) {
      pv2Camp.audienceLoading = segment;
      renderStaffEmailsPage();
      try {
        const payload = await apiRequest(`/api/ops?action=campaignAudience&segment=${encodeURIComponent(segment)}&centerId=${encodeURIComponent(state.adminCenterId || 'libramont')}`);
        pv2Camp.audience[segment] = { count: payload.count, sample: payload.sample || [] };
      } catch (error) {
        pv2Camp.audience[segment] = { count: null, sample: [] };
      }
      pv2Camp.audienceLoading = '';
    }
    renderStaffEmailsPage();
  };

  window.pv2CampOpenForm = function () {
    delete EM_IA.campagne;
    pv2Camp.editingId = null;
    pv2Camp.form = { name: '', objective: '', segment: pv2Camp.form.segment || 'all', subject: '', body: '', mode: 'now', scheduledAt: '' };
    pv2Camp.formOpen = true;
    renderStaffEmailsPage();
    window.pv2CampSegmentChanged(pv2Camp.form.segment);
  };

  window.pv2CampCloseForm = function () {
    pv2Camp.formOpen = false;
    pv2Camp.editingId = null;
    renderStaffEmailsPage();
  };

  // Ouvre un brouillon existant dans le formulaire pour édition.
  window.pv2CampEditDraft = function (id) {
    delete EM_IA.campagne;
    const campaign = pv2Camp.campaigns.find((c) => c.id === id);
    if (!campaign) return;
    pv2Camp.editingId = id;
    pv2Camp.form = { name: campaign.name, objective: campaign.objective, segment: campaign.segment, subject: campaign.subject, body: campaign.body, mode: 'now', scheduledAt: '' };
    pv2Camp.formOpen = true;
    renderStaffEmailsPage();
    window.pv2CampSegmentChanged(campaign.segment);
  };

  // Envoie un brouillon directement depuis la liste (confirme le volume réel).
  window.pv2CampSendDraft = async function (id) {
    const campaign = pv2Camp.campaigns.find((c) => c.id === id);
    if (!campaign) return;
    const centerId = state.adminCenterId || 'libramont';
    let count = pv2Camp.audience[campaign.segment]?.count;
    if (!Number.isInteger(count)) {
      try {
        const payload = await apiRequest(`/api/ops?action=campaignAudience&segment=${encodeURIComponent(campaign.segment)}&centerId=${encodeURIComponent(centerId)}`);
        count = payload.count;
        pv2Camp.audience[campaign.segment] = { count: payload.count, sample: payload.sample || [] };
      } catch (error) {
        if (typeof toast === 'function') toast(error.message || 'Audience indisponible.');
        return;
      }
    }
    if (!Number.isInteger(count) || count < 1) { if (typeof toast === 'function') toast('Ce segment ne contient aucun destinataire.'); return; }
    if (!window.confirm(`Envoyer le brouillon « ${campaign.name} » maintenant à ${plural(count, 'destinataire', 'destinataires')} ?`)) return;
    try {
      await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'sendCampaign', centerId, id, mode: 'now', expectedRecipients: count }),
      });
      if (typeof toast === 'function') toast('Campagne lancée · mails en file (départ en continu).');
      await loadPv2Campaigns(true);
    } catch (error) {
      if (typeof toast === 'function') toast(error.message || 'Envoi impossible.');
    }
  };

  window.pv2CampSubmit = async function (mode, button) {
    const form = pv2Camp.form;
    if (!form.name.trim()) { if (typeof toast === 'function') toast('Nom de campagne requis.'); return; }
    if (mode !== 'draft' && (!form.subject.trim() || !form.body.trim())) {
      if (typeof toast === 'function') toast('Objet et message requis pour envoyer.');
      return;
    }
    const count = pv2Camp.audience[form.segment]?.count;
    // Jamais d'envoi sans volume connu : le serveur revalide ce nombre (409 si décalage).
    if (mode !== 'draft' && !Number.isInteger(count)) {
      if (typeof toast === 'function') toast("Audience en cours de calcul. Attendez le nombre de destinataires avant d'envoyer.");
      return;
    }
    if (mode === 'now' && !window.confirm(`Envoyer maintenant à ${plural(count, 'destinataire', 'destinataires')} du segment sélectionné ?`)) return;
    if (mode === 'schedule' && !form.scheduledAt) { if (typeof toast === 'function') toast('Choisissez la date et l\'heure d\'envoi.'); return; }
    pv2Camp.busy = true;
    if (button) button.disabled = true;
    renderStaffEmailsPage();
    try {
      const centerId = state.adminCenterId || 'libramont';
      const editingId = pv2Camp.editingId;
      const scheduledAt = mode === 'schedule' ? new Date(form.scheduledAt).toISOString() : null;
      let queued = 0;
      let resendConfigured = pv2Camp.channel?.resendConfigured;
      if (editingId) {
        // Brouillon existant : on sauve les modifs, puis on envoie si demandé.
        await apiRequest('/api/ops', {
          method: 'POST',
          body: JSON.stringify({ action: 'updateCampaign', centerId, id: editingId, name: form.name, objective: form.objective, segment: form.segment, subject: form.subject, body: form.body }),
        });
        if (mode !== 'draft') {
          const payload = await apiRequest('/api/ops', {
            method: 'POST',
            body: JSON.stringify({ action: 'sendCampaign', centerId, id: editingId, mode, expectedRecipients: count, scheduledAt }),
          });
          queued = payload.queued; resendConfigured = payload.resendConfigured;
        }
      } else {
        const payload = await apiRequest('/api/ops', {
          method: 'POST',
          body: JSON.stringify({
            action: 'createCampaign', centerId,
            name: form.name, objective: form.objective, segment: form.segment,
            subject: form.subject, body: form.body, mode,
            expectedRecipients: mode === 'draft' ? null : count,
            scheduledAt,
          }),
        });
        queued = payload.queued; resendConfigured = payload.resendConfigured;
      }
      pv2Camp.formOpen = false;
      pv2Camp.editingId = null;
      pv2Camp.form = { name: '', objective: '', segment: form.segment, subject: '', body: '', mode: 'now', scheduledAt: '' };
      if (typeof toast === 'function') {
        const inFile = `${queued} mail(s) en file`;
        toast(mode === 'draft' ? (editingId ? 'Brouillon mis à jour.' : 'Brouillon enregistré.')
          : mode === 'schedule' ? `Campagne programmée · ${inFile} (départ à l'heure dite).`
          : resendConfigured === false ? `Campagne lancée · ${inFile} (canal d'envoi à configurer).`
          : `Campagne lancée · ${inFile} (départ en continu).`);
      }
      await loadPv2Campaigns(true);
    } catch (error) {
      if (typeof toast === 'function') toast(error.message || 'Opération impossible.');
      pv2Camp.busy = false;
      if (button) button.disabled = false;
      renderStaffEmailsPage();
      return;
    }
    pv2Camp.busy = false;
  };

  window.pv2CampCancel = async function (id) {
    if (!window.confirm('Annuler cette campagne ? Les envois encore en file seront stoppés.')) return;
    try {
      const payload = await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'cancelCampaign', centerId: state.adminCenterId || 'libramont', id }),
      });
      if (typeof toast === 'function') toast(`Campagne annulée · ${payload.cancelledCommunications} envoi(s) stoppé(s).`);
      await loadPv2Campaigns(true);
    } catch (error) {
      if (typeof toast === 'function') toast(error.message || 'Annulation impossible.');
    }
  };

  function pv2CampDownload(filename, content, mime) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([content], { type: mime }));
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
  }

  window.pv2CampExportRecipients = async function (segment) {
    // campaignAudience&full=1 : campaigns.manage et exports.download (api/ops.js).
    if (typeof peutGeste === 'function' && !peutGeste('exporter')) { toast('Votre rôle ne permet pas de télécharger les exports.'); return; }
    try {
      const payload = await apiRequest(`/api/ops?action=campaignAudience&segment=${encodeURIComponent(segment)}&full=1&centerId=${encodeURIComponent(state.adminCenterId || 'libramont')}`);
      const rows = [['Nom', 'Email', 'Visites', 'Chiffre (EUR)', 'Dernière visite']];
      for (const r of payload.recipients || []) rows.push([r.name, r.email, r.visits, String(r.revenue).replace('.', ','), r.lastDate]);
      const csv = '﻿' + rows.map((row) => row.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
      pv2CampDownload(`destinataires-${segment}.csv`, csv, 'text/csv;charset=utf-8');
      const exported = (payload.recipients || []).length;
      if (typeof toast === 'function') toast(exported > 1 ? `${exported} destinataires exportés.` : `${exported} destinataire exporté.`);
    } catch (error) {
      if (typeof toast === 'function') toast(error.message || 'Export impossible.');
    }
  };

  window.pv2CampExportContent = function (id) {
    const campaign = pv2Camp.campaigns.find((c) => c.id === id);
    if (!campaign) return;
    pv2CampDownload(`campagne-${id}.txt`, `Campagne : ${campaign.name}\nSegment : ${campaign.segment}\nObjet : ${campaign.subject}\n\n${campaign.body}`, 'text/plain;charset=utf-8');
  };

  const PV2_CAMP_STATUS = {
    draft: ['Brouillon', ''],
    scheduled: ['Programmée', 'blue'],
    sending: ['En envoi', 'green'],
    sent: ['Envoyée', 'green'],
    sent_partial: ['Envoyée · échecs partiels', 'amber'],
    failed: ['Échec d\'envoi', 'red'],
    cancelled: ['Annulée', ''],
  };

  // LE MENU « PLUS » D UNE LIGNE (2026-11-11) : un popover natif. Il vit dans
  // la couche du dessus : ni sa ligne ni la suivante ne le coupent. Echap et un
  // clic dehors le ferment, le focus revient au bouton. Avant de s ouvrir, il
  // se pose sous son bouton, aligne a droite ; ouvert, il remonte au-dessus si
  // le bas de l ecran le coupe. Un defilement le ferme.
  window.emPlusPlacer = function (event) {
    const menu = event.currentTarget;
    if (!menu || event.newState !== 'open') return;
    const bouton = document.querySelector(`[popovertarget="${menu.id}"]`);
    if (!bouton) return;
    const r = bouton.getBoundingClientRect();
    if (event.type === 'beforetoggle') {
      menu.style.top = `${Math.round(r.bottom + 4)}px`;
      menu.style.right = `${Math.max(8, Math.round(document.documentElement.clientWidth - r.right))}px`;
      return;
    }
    const h = menu.offsetHeight;
    if (r.bottom + 4 + h > window.innerHeight - 8) menu.style.top = `${Math.max(8, Math.round(r.top - 4 - h))}px`;
    const fermer = () => { if (menu.isConnected && menu.matches(':popover-open')) menu.hidePopover(); };
    window.addEventListener('scroll', fermer, { once: true, capture: true, passive: true });
  };
  window.emPlusFermer = function (el) {
    const menu = el && el.closest('[popover]');
    if (menu && menu.matches(':popover-open')) menu.hidePopover();
  };

  // LES CAMPAGNES (2026-11-10) : une ligne par campagne, son etat, son
  // audience, ses envois et ses ouvertures ; l editeur a l audience, l objet,
  // le texte, l apercu et la barre d aide.
  function renderPv2RealCampaigns() {
    // UN BLOC QU ON N A PAS LE DROIT DE CHARGER NE S AFFICHE PAS (2026-08-19).
    // La page Emails est ouverte a « emails.view », que le role Manager a ;
    // les campagnes exigent « campaigns.manage », qu il n a pas. Regle
    // DESIGN.md 9 : un bouton mene a une action reelle, ou il n existe pas.
    // Ici le serveur reste la seule autorite : il refuse toujours.
    if (typeof canUseStaffPermission === 'function' && !canUseStaffPermission('campaigns.manage')) return '';
    if (!pv2Camp.loaded && !pv2Camp.loading && !pv2Camp.error) setTimeout(() => loadPv2Campaigns(), 0);
    const segLabel = (id) => (pv2Camp.segments.find((s) => s.id === id) || {}).label || id;
    const ouvertures = pv2OuverturesObservees();
    const sortants = getStaffEmailRows().filter((r) => !pv2IsInbound(r));
    const ouvertsDe = (id) => sortants.filter((r) => r.payload && String(r.payload.campaignId) === String(id) && pv2SentOuvert(r)).length;
    const busy = pv2Camp.busy ? 'disabled' : '';
    const cascade = { n: 0 };
    // Le resultat d une campagne en une case (lot S) : combien sont partis,
    // combien ont ete ouverts. Avant l envoi, rien ne s invente.
    const resultat = (c, partie) => {
      if (!partie) return '<span class="em-cell-muted">pas encore</span>';
      const envoyes = plural(Number(c.sent) || 0, 'envoyé', 'envoyés');
      if (ouvertures === false) return `${envoyes}<small class="em-cell-sub" title="Le suivi des ouvertures n’est pas actif.">ouvertures non suivies</small>`;
      return `${envoyes}<small class="em-cell-sub">${plural(ouvertsDe(c.id), 'ouvert', 'ouverts')}</small>`;
    };
    const liste = pv2Camp.campaigns.length ? `<table class="em-table em-camp-table pv2-table">
      <thead><tr><th>Campagne</th><th>Statut</th><th class="num">Audience</th><th class="num">Résultat</th><th><span class="em-cache">Gestes</span></th></tr></thead>
      <tbody>${pv2Camp.campaigns.map((c) => {
        const [label, tone] = PV2_CAMP_STATUS[c.status] || [c.status, ''];
        const brouillon = c.status === 'draft';
        const audienceConnue = pv2Camp.audience[c.segment] && Number.isInteger(pv2Camp.audience[c.segment].count) ? pv2Camp.audience[c.segment].count : null;
        const audience = brouillon ? audienceConnue : (Number(c.recipientCount) || 0);
        const partie = ['sent', 'sent_partial', 'sending'].includes(c.status);
        const quand = c.status === 'scheduled' && c.scheduledAt ? `Part le ${new Date(c.scheduledAt).toLocaleString('fr-BE', { dateStyle: 'short', timeStyle: 'short' })}.` : '';
        return `<tr${emEntree(`campagnes:${c.id}`, cascade)}>
          <td data-col="campagne"><strong class="em-cell-main">${esc(c.name)}</strong><small class="em-cell-sub">${esc(segLabel(c.segment))}${c.objective ? ` · ${esc(c.objective)}` : ''}</small>${quand ? `<small class="em-cell-sub">${esc(quand)}</small>` : ''}</td>
          <td data-col="statut"><span class="pv2-chip ${tone}">${label}</span>${Number(c.failed) > 0 ? `<small class="pv2-cell-sub pv2-cell-fail">${plural(Number(c.failed), 'échec', 'échecs')}</small>` : ''}</td>
          <td class="num" data-label="Audience">${audience === null ? '<span class="em-cell-muted">à compter</span>' : audience}</td>
          <td class="num" data-label="Résultat">${resultat(c, partie)}</td>
          <td class="em-camp-gestes"><div class="em-camp-actions">
            ${brouillon ? `<button type="button" class="em-lien" onclick="pv2CampEditDraft(${c.id})">Modifier</button><button type="button" class="em-lien" onclick="pv2CampSendDraft(${c.id})">Envoyer</button>` : ''}
            ${['scheduled', 'sending'].includes(c.status) && c.queued > 0 ? `<button type="button" class="em-lien" onclick="pv2CampCancel(${c.id})">Annuler l’envoi</button>` : ''}
            ${emMenuPlusHtml(`emCampPlus${c.id}`, `Plus d’actions pour ${c.name}`, [
              emGestePlus('Exporter le texte', `pv2CampExportContent(${c.id})`),
              brouillon ? emGestePlus('Supprimer', `pv2CampCancel(${c.id})`, { danger: true }) : '',
            ])}
          </div></td>
        </tr>`;
      }).join('')}</tbody>
    </table>` : `<p class="em-calme">${pv2Camp.loading ? 'Lecture des campagnes…' : 'Aucune campagne pour l’instant. Le ciblage se fait sur votre base clients réelle.'}</p>`;

    const form = pv2Camp.formOpen ? (() => {
      const f = pv2Camp.form;
      const audience = pv2Camp.audience[f.segment];
      const audienceTxt = pv2Camp.audienceLoading === f.segment
        ? 'Je compte les destinataires…'
        : audience && Number.isInteger(audience.count)
          ? `${plural(audience.count, 'destinataire', 'destinataires')}${audience.sample && audience.sample.length ? `, par exemple ${audience.sample.slice(0, 3).join(', ')}` : ''}.`
          : 'Le nombre de destinataires n’est pas encore connu.';
      return `<div class="em-camp-editeur em-editeur" data-em-ia-editeur="campagne">
        <div class="em-camp-champs">
          ${pv2Camp.editingId ? '<p class="em-note">Vous modifiez un brouillon. Enregistrez vos modifications, ou envoyez-le directement.</p>' : ''}
          <div class="em-grid-2">
            <label class="pv2-composer-field"><span>Nom de la campagne</span><input type="text" value="${esc(f.name)}" data-pl-focus="emails.campagne.nom" oninput="pv2Camp.form.name = this.value"></label>
            <label class="pv2-composer-field"><span>Objectif</span><input type="text" placeholder="Ex. remplir les mardis soirs" value="${esc(f.objective)}" data-pl-focus="emails.campagne.objectif" oninput="pv2Camp.form.objective = this.value"></label>
          </div>
          <div class="em-grid-2">
            <label class="pv2-composer-field"><span>À qui l’envoyer ?</span><select onchange="pv2CampSegmentChanged(this.value)">${pv2Camp.segments.map((s) => `<option value="${esc(s.id)}" ${f.segment === s.id ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select></label>
            <div class="pv2-composer-field"><span>Combien de clients le recevront</span><p class="em-camp-audience">${esc(audienceTxt)}</p></div>
          </div>
          ${emIaBarHtml('campagne')}
          <div class="pv2-composer-field"><span>L’objet du mail</span>${pv2TokeditHtml({ id: 'pv2CampSubject', sink: 'campSubject', value: f.subject, single: true, plFocus: 'emails.campagne.objet', placeholder: 'Ce que vos clients lisent en premier' })}</div>
          <div class="pv2-composer-field em-champ-message"><span>Le message</span>${pv2VarBar('pv2CampBody', ['prenom', 'nom'])}${pv2TokeditHtml({ id: 'pv2CampBody', sink: 'campBody', value: f.body, plFocus: 'emails.campagne.message', placeholder: 'Bonjour {{prenom}},…' })}</div>
          <label class="pv2-composer-field em-camp-quand"><span>Programmer l’envoi, si vous voulez</span><input type="datetime-local" value="${esc(f.scheduledAt)}" onchange="pv2Camp.form.scheduledAt = this.value"></label>
          <div class="pv2-composer-actions em-actions">
            <button type="button" class="em-lien" onclick="pv2CampCloseForm()">Fermer</button>
            ${typeof peutGeste !== 'function' || peutGeste('exporter') ? `<button type="button" class="em-lien" onclick="pv2CampExportRecipients('${escJs(f.segment)}')">Exporter la liste</button>` : ''}
            <button type="button" class="em-lien" onclick="pv2CampSubmit('draft', this)" ${busy}>${pv2Camp.editingId ? 'Enregistrer les modifications' : 'Enregistrer le brouillon'}</button>
            <button type="button" class="em-lien" onclick="pv2CampSubmit('schedule', this)" ${busy}>Programmer</button>
            <span class="pv2-composer-spacer"></span>
            <button type="button" class="pv2-btn primary em-principal" onclick="pv2CampSubmit('now', this)" ${busy}>Envoyer maintenant</button>
          </div>
        </div>
        <div class="em-camp-apercu-col">
          <p class="em-camp-apercu-titre">Aperçu avec un client de la liste</p>
          <div class="pv2-mail-paper em-camp-apercu" data-em-camp-apercu>${emCampApercuHtml()}</div>
        </div>
      </div>`;
    })() : '';

    return `<section class="em-block em-camps" aria-label="Campagnes">
      <div class="em-block-head"><div><h2 class="em-h2">Campagnes</h2><p class="em-sub">Un mail envoyé à une liste de vos clients, maintenant ou à la date que vous choisissez.</p></div>
        ${pv2Camp.formOpen ? '' : '<button type="button" class="pv2-btn sm primary" onclick="pv2CampOpenForm()">Nouvelle campagne</button>'}
      </div>
      ${pv2Camp.channel && pv2Camp.channel.resendConfigured === false ? '<p class="em-note is-attente">L’envoi des mails n’est pas encore relié. Les campagnes restent en file tant qu’il ne l’est pas.</p>' : ''}
      ${pv2Camp.error
        ? `<div class="em-vide"><p>${esc(pv2Camp.error)}</p><button type="button" class="pv2-btn sm" onclick="loadPv2Campaigns(true)">Réessayer</button></div>`
        : `${form}${liste}`}
    </section>`;
  }

  // L apercu d une campagne, avec le premier client de la liste (ou un client
  // d exemple tant que la liste n est pas comptee). Repeint sur place a la frappe.
  function emCampApercuHtml() {
    const f = pv2Camp.form;
    const audience = pv2Camp.audience[f.segment];
    const ctx = pv2VarContext({ name: (audience && audience.sample && audience.sample[0]) || 'Camille Dumont' });
    const sujet = pv2RenderEmailPreview(f.subject, ctx).replace(/^<p>|<\/p>$/g, '');
    const corps = pv2RenderEmailPreview(f.body, ctx);
    return `<div class="pv2-mail-paper-subject">${sujet || '<span class="pv2-preview-empty">Objet de la campagne</span>'}</div>
      <div class="pv2-mail-render">${corps || '<p class="pv2-preview-empty">L’aperçu du mail s’affiche ici pendant que vous écrivez.</p>'}</div>`;
  }
  function emCampApercuPeindre() {
    const box = document.querySelector('#staffEmailsPage [data-em-camp-apercu]');
    if (box) box.innerHTML = emCampApercuHtml();
  }

  /* ══════════════════════════════════════════════════════════════════════
     MARKETING : 5 surfaces (refonte 2026-07-16 « machine de guerre »)
     Aujourd'hui · Ce qui marche · Studio · Concurrents · Résultats.
     Même contrat de données (marketingBrief), mêmes handlers d'action ;
     on recatégorise et on élève le craft. Les nouvelles surfaces
     dégradent proprement si le champ n'existe pas encore (honnêteté :
     l'analyse causale profonde arrive en Phase 1 backend).
     ══════════════════════════════════════════════════════════════════════ */

  function cap(s) { return `${String(s || '').charAt(0).toUpperCase()}${String(s || '').slice(1)}`; }

  /* ==========================================================================
     TARIFS : editeur client (override par centre, permission pricing.manage)
     Branche sur GET clientCatalog (prefill) + POST saveClientFormuleOverride /
     resetClientFormuleOverride. Chaque ecriture est SIGNEE du centre AFFICHE
     (pevBody ajoute centerId) : le serveur VALIDE ce centre (centers.switch +
     barriere inter-clients) puis il fait foi ; la session n'est qu'un repli.
     Correctif du 2026-08-21 : sans cette signature, l'edition d'un fondateur
     multi-centres partait sur le centre de sa SESSION, pas celui de l'ecran.
     Etat hors DOM (pricingEditor), encapsule dans cet IIFE, pas de variable
     globale sauvage. La page qui le montre et l edite est plus bas
     (TARIFS & FORMULES : LA PAGE).
     ======================================================================== */

  const PEV_PRICE_MIN = 0;
  const PEV_PRICE_MAX = 1000;
  const PEV_NAME_MAX = 120;

  const pricingEditor = {
    loaded: false,
    loading: false,
    error: '',
    byId: new Map(),      // formuleId -> entree clientCatalog
    activities: [],       // liste [{id, name, resourceType}] pour l'editeur de steps
  };

  function pevToast(message) {
    if (typeof toast === 'function') toast(message);
  }
  function pevEntry(formuleId) {
    return formuleId ? (pricingEditor.byId.get(String(formuleId)) || null) : null;
  }

  // ---- LE CENTRE AFFICHE VOYAGE AVEC CHAQUE REQUETE ----------------------
  //
  // api/ops resout le centre ainsi (resolveEffectiveCenterId) : le PARAMETRE
  // de la requete d'abord, et seulement a defaut celui de la SESSION. Or
  // aucune requete de cet editeur n'en envoyait : le serveur retombait donc
  // sur le centre du CODE de connexion, quel que soit le centre choisi dans
  // le switcher.
  //
  // Mesure du 2026-08-21 (capture Movsar) : connecte avec le code N4, ecran
  // sur Fun Galaxy Libramont, la page « Tarifs & formules » servait les
  // formules de N4. Et le meme defaut portait sur les ECRITURES : un tarif
  // « du centre » modifie depuis l'ecran de Libramont partait s'ecrire sur
  // N4. C'est le cote grave, parce qu'il touche la donnee d'un autre client.
  //
  // Le serveur reste la seule autorite : requireStaffPermission valide l'acces
  // au centre demande AVANT resolveEffectiveCenterId, et refuse (403) un
  // centre hors perimetre. On ne fait ici que dire de QUEL centre on parle.
  function pevCenterId() {
    if (typeof getCurrentStaffCenterId === 'function') return getCurrentStaffCenterId();
    return (typeof state !== 'undefined' && state.adminCenterId) ? state.adminCenterId : '';
  }

  // Le corps d'une ecriture catalogue, toujours signe du centre affiche.
  function pevBody(payload) {
    const centerId = pevCenterId();
    return JSON.stringify(centerId ? { ...payload, centerId } : payload);
  }

  async function pevLoad(force) {
    if (pricingEditor.loading || (pricingEditor.loaded && !force)) return;
    pricingEditor.loading = true;
    pricingEditor.error = '';
    try {
      const payload = await apiRequest(`${API_ENDPOINTS.ops || '/api/ops'}?action=clientCatalog&centerId=${encodeURIComponent(pevCenterId())}`, { method: 'GET' });
      const list = payload && Array.isArray(payload.formulas) ? payload.formulas : [];
      pricingEditor.byId = new Map(list.map((f) => [String(f.id), f]));
      pricingEditor.activities = payload && Array.isArray(payload.activities) ? payload.activities : [];
      pricingEditor.centerActivityIds = payload && Array.isArray(payload.centerActivityIds) ? payload.centerActivityIds : [];
      pricingEditor.centerOpenDays = payload && payload.centerOpenDays ? payload.centerOpenDays : null;
      pricingEditor.loaded = true;
    } catch (error) {
      pricingEditor.error = (error && error.message) || 'Catalogue indisponible.';
    } finally {
      pricingEditor.loading = false;
      if (typeof isStaffPricingActive === 'function' && isStaffPricingActive()) renderStaffPricingPage();
      // L'Etablissement consomme aussi la liste vive : une fois chargee, la
      // page ouverte se repeint pour quitter le fallback statique. JAMAIS en
      // mode edition : reconstruire le formulaire perdrait les cases cochees.
      if (typeof getStaffMenuPage === 'function' && getStaffMenuPage() === 'establishment'
        && !(typeof state !== 'undefined' && state && state.establishmentEditing)
        && typeof renderStaffUtilityPage === 'function') renderStaffUtilityPage();
    }
  }

  // Re-fetch + re-render : apres chaque ecriture, la ligne montre immediatement
  // la nouvelle valeur. TOUTES les ecritures catalogue (override tarif, creation,
  // edition, suppression) passent ici : c'est LE point de propagation. Le
  // catalogue du tunnel (public-booking-meta -> __pinlaneDisplayFormules) se
  // rafraichit dans le meme geste : creer une formule la rend reservable sans
  // recharger la page, la retirer la fait disparaitre des cartes.
  function pevReload() {
    pricingEditor.loaded = false;
    pevLoad(true);
    if (typeof loadCenterScheduleConfig === 'function') loadCenterScheduleConfig();
    // La page Tarifs relit aussi ce que lit le formulaire client.
    tfAuRechargement();
  }
  function pevEnsureLoaded() {
    if (!pricingEditor.loaded && !pricingEditor.loading && !pricingEditor.error) pevLoad(false);
  }

  // LA LISTE VIVE DES FORMULES pour toutes les surfaces de la console (grille
  // Tarifs, Etablissement > Offres). Rendue au format booking (le format que
  // ces ecrans consomment deja via la constante FORMULES) depuis clientCatalog :
  // customs comprises, editions de structure refletees, nom/prix effectifs du
  // centre appliques. Rend null tant que le catalogue n'est pas charge : les
  // appelants retombent sur la constante FORMULES, jamais sur un ecran vide.
  function pevFormulesVives() {
    return [...pricingEditor.byId.values()].map((entry) => {
      const eff = entry.effective || {};
      const timeLimit = (entry.timeLimitMinMinutes != null || entry.timeLimitMaxMinutes != null)
        ? {
          ...(entry.timeLimitMinMinutes != null ? { min: entry.timeLimitMinMinutes / 60 } : {}),
          ...(entry.timeLimitMaxMinutes != null ? { max: entry.timeLimitMaxMinutes / 60 } : {}),
        }
        : null;
      return {
        id: entry.id,
        name: eff.name != null ? eff.name : entry.name,
        // La famille BOOKING (« Formules anniversaires ») : c'est elle qui
        // groupe les ecrans. doc.family (« Anniversaire ») classait tout en
        // speciales (compteur Anniversaires a zero, vu a l'ecran).
        family: entry.bookingFamily || entry.family || 'Formules',
        desc: Array.isArray(entry.desc) ? entry.desc : [],
        notes: Array.isArray(entry.notes) ? entry.notes : [],
        price: eff.priceValue != null ? eff.priceValue : (entry.base ? entry.base.priceValue : null),
        oldPrice: eff.priceOld != null ? eff.priceOld : (entry.base ? entry.base.priceOld : null),
        type: entry.priceType || 'per_pax',
        minPax: Number(entry.minPax) || 1,
        validDays: Array.isArray(entry.validDays) && entry.validDays.length ? entry.validDays : null,
        ...(timeLimit ? { timeLimit } : {}),
        noHolidays: entry.noHolidays === true,
        best: entry.best === true,
        hasBowling: entry.hasBowling === true,
        ...(entry.bowlingDur != null ? { bowlingDur: entry.bowlingDur } : {}),
        ...(entry.estimatedTotalDuration != null ? { estimatedTotalDuration: entry.estimatedTotalDuration } : {}),
        removed: Boolean(eff.removed),
        enabled: eff.enabled !== false,
        source: entry.source || 'seed',
      };
    });
  }
  window.pevLiveFormules = function () {
    return pricingEditor.loaded ? pevFormulesVives() : null;
  };
  // Les autres pages (Etablissement) declenchent le chargement sans dependre
  // du rendu de la page Tarifs.
  window.pevEnsureCatalogLoaded = pevEnsureLoaded;
  // Un echec de chargement ne doit jamais etre un cul-de-sac : le bandeau
  // d'erreur de la page Tarifs propose ce retry (l'ancien code retombait sur
  // la constante SANS RIEN DIRE et ne reessayait qu'au rechargement complet).
  window.pevRetryCatalog = pevReload;

  // ---- LE CATALOGUE TARIFAIRE APPARTIENT AU CENTRE, PAS A L ONGLET --------
  //
  // Ce cache n'avait AUCUNE cle de centre et ne figurait pas dans
  // resetCenterScopedCaches : il survivait donc a la bascule. Mesure du
  // 2026-08-21 (capture Movsar) : apres etre passe sur N4 puis revenu sur Fun
  // Galaxy Libramont, la page « Tarifs & formules » affichait les QUATRE
  // formules de N4 sous le nom de Fun Galaxy, et Fun Galaxy ne voyait plus les
  // siennes. La base, elle, etait intacte : c'etait l'ecran qui mentait.
  //
  // Vider suffit : le prochain rendu appelle pevEnsureLoaded, qui relance un
  // vrai chargement pour le nouveau centre.
  window.pevResetCatalogCache = function () {
    pricingEditor.loaded = false;
    pricingEditor.loading = false;
    pricingEditor.error = '';
    pricingEditor.byId = new Map();
    pricingEditor.activities = [];
    pricingEditor.centerActivityIds = [];
    pricingEditor.centerOpenDays = null;
    // Le brouillon de la page Tarifs appartient a son centre.
    tfOublierAutresCentres();
  };

  /* ==========================================================================
     CATALOGUE DE L ENTREPRISE : editeur de STRUCTURE (permission settings.manage)
     Distinct des reglages du centre (la planche de Tarifs, prix, vente, validation) :
     ici on edite le CATALOGUE lui-meme (formules, activites d'une formule),
     partage par tous les centres de LA MEME ENTREPRISE. Branche sur le CRUD
     backend (createFormula / updateFormula / setFormulaSteps / deleteFormula).
     Aucune ecriture n'envoie de centerId : le serveur force le centre de
     session et en deduit l'entreprise proprietaire (migration 0042). Depuis
     cette migration, aucune de ces actions n'a le moindre effet chez un autre
     client : les textes ci-dessous le disent, parce qu'ils disaient l'inverse
     et que c'etait faux. Mecanique modale : etat hors DOM
     (catalogEditor), modale montee dans document.body pour survivre aux
     reconstructions innerHTML de la page. Lit clientCatalog via pricingEditor
     (meme source), re-fetch via pevReload apres chaque ecriture.
     ======================================================================== */

  const CEV_DAY_LABELS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

  const catalogEditor = {
    modal: null,   // null | { mode: 'create'|'steps'|'fields', formuleId }
    fields: null,  // brouillon des champs de structure (create/fields)
    steps: null,   // brouillon de la liste ordonnee des steps (create/steps)
    saving: false,
    error: '',
  };

  function cevCanManage() {
    return typeof canUseStaffPermission === 'function' ? canUseStaffPermission('settings.manage') : true;
  }

  function cevMinutesToHhmm(min) {
    if (min == null || min === '') return '';
    const total = Math.max(0, Math.trunc(Number(min)));
    if (!Number.isFinite(total)) return '';
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }
  function cevHhmmToMinutes(value) {
    if (!value) return null;
    const [h, m] = String(value).split(':');
    const total = (Number(h) || 0) * 60 + (Number(m) || 0);
    return Number.isFinite(total) ? total : null;
  }

  // ── Editeur de STEPS (liste ordonnee d'activites) ─────────────────────────
  // Ce que le CLIENT lira si aucun libelle n'est ecrit : meme regle que le
  // serveur (catalog-store describeStepForCard). Affiche en placeholder, donc
  // le gerant voit la phrase exacte avant de decider de la remplacer.
  function cevStepAutoLabel(step, activities) {
    if (!step.activityId) return 'Choisir une activité d abord';
    const act = (activities || []).find((a) => a.id === step.activityId);
    const name = act ? act.name : step.activityId;
    const count = Math.max(1, Number(step.count) || 1);
    const min = Number(step.durationMinutes);
    let duration = '';
    if (Number.isFinite(min) && min > 0) {
      duration = min < 60 ? `${min} min` : (min % 60 === 0 ? `${min / 60}h` : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`);
    }
    if (duration) return count > 1 ? `${count}x ${duration} de ${name}` : `${duration} de ${name}`;
    return count > 1 ? `${count}x ${name}` : name;
  }

  function cevStepRowHtml(step, index, activities, total) {
    const known = activities.some((a) => a.id === step.activityId);
    // Le catalogue propose toutes les activites de la SOCIETE, y compris celles
    // qu'un autre centre possede (Karting VR, Lancer de hache, Golf o'Clock).
    // On ne les cache pas, le catalogue est partage, mais on dit lesquelles ce
    // centre n'a pas : composer avec un ingredient absent rend la formule
    // invendable, en silence, jusqu au client qui ne voit aucun creneau.
    const ownedHere = Array.isArray(pricingEditor.centerActivityIds) ? pricingEditor.centerActivityIds : [];
    const options = activities.map((a) => {
      const absent = ownedHere.length && !ownedHere.includes(String(a.id));
      const label = absent ? `${a.name} (absent de ce centre)` : a.name;
      return `<option value="${esc(a.id)}"${a.id === step.activityId ? ' selected' : ''}>${esc(label)}</option>`;
    }).join('');
    // Activite absente de la liste (pseudo-activite typee a la main, ou activite
    // retiree) : on l'ajoute pour NE PAS perdre la valeur courante a l'enregistrement.
    const extra = (!known && step.activityId)
      ? `<option value="${esc(step.activityId)}" selected>${esc(step.activityId)} (hors catalogue)</option>`
      : '';
    return `<div class="cev-step" data-cev-step="${index}">
      <div class="cev-step-order">
        <span class="cev-step-num" aria-hidden="true">${index + 1}</span>
        <button type="button" class="cev-step-move" data-cev-move-up="${index}" aria-label="Monter l’activité" ${index === 0 ? 'disabled' : ''} onclick="cevStepMove(${index}, -1)">&uarr;</button>
        <button type="button" class="cev-step-move" data-cev-move-down="${index}" aria-label="Descendre l’activité" ${index === total - 1 ? 'disabled' : ''} onclick="cevStepMove(${index}, 1)">&darr;</button>
      </div>
      <div class="cev-step-grid">
        <label class="cev-step-field cev-step-activity"><span>Activité</span>
          <select data-cev-field="activityId" data-cev-idx="${index}" onchange="cevStepSetActivity(${index}, this.value)">
            <option value="">Choisir une activité</option>
            ${options}${extra}
          </select>
        </label>
        <label class="cev-step-field cev-step-count"><span>Nombre</span>
          <input type="number" min="1" max="99" step="1" data-cev-field="count" data-cev-idx="${index}" value="${step.count == null ? 1 : esc(step.count)}" oninput="cevStepSetCount(${index}, this.value)">
        </label>
        <label class="cev-step-field cev-step-duration"><span>Durée (min)</span>
          <input type="number" min="0" max="1440" step="5" data-cev-field="duration" data-cev-idx="${index}" value="${step.durationMinutes == null ? '' : esc(step.durationMinutes)}" placeholder="auto" oninput="cevStepSetDuration(${index}, this.value)">
        </label>
        <label class="cev-step-crit"><input type="checkbox" data-cev-field="critical" data-cev-idx="${index}" ${step.critical ? 'checked' : ''} onchange="cevStepToggleCritical(${index}, this.checked)"><span>Critique</span></label>
        <label class="cev-step-field cev-step-label"><span>Ce que lit le client</span>
          <input type="text" maxlength="80" data-cev-field="label" data-cev-idx="${index}" value="${step.label == null ? '' : esc(step.label)}" placeholder="${esc(cevStepAutoLabel(step, activities))}" oninput="cevStepSetLabel(${index}, this.value)">
        </label>
      </div>
      <button type="button" class="cev-step-remove" data-cev-remove="${index}" aria-label="Retirer l’activité" onclick="cevStepRemove(${index})">&times;</button>
    </div>`;
  }

  function cevStepsListHtml() {
    const steps = catalogEditor.steps || [];
    const activities = pricingEditor.activities || [];
    return steps.length
      ? steps.map((step, index) => cevStepRowHtml(step, index, activities, steps.length)).join('')
      : '<p class="cev-steps-empty">Aucune activité. Ajoutez-en une.</p>';
  }

  function cevStepsEditorHtml() {
    return `<div class="cev-steps">
      <div class="cev-steps-head"><span>Activités de la formule</span><small>L’ordre suit le déroulé réel. Au moins une activité.</small></div>
      <div class="cev-steps-list" id="cevStepsList">${cevStepsListHtml()}</div>
      <button type="button" class="btn btn-secondary btn-sm" id="cevAddStep" onclick="cevStepAdd()">+ Ajouter une activité</button>
    </div>`;
  }

  function cevRefreshSteps() {
    const list = document.getElementById('cevStepsList');
    if (list) list.innerHTML = cevStepsListHtml();
  }

  window.cevStepAdd = function () {
    if (!catalogEditor.steps) catalogEditor.steps = [];
    catalogEditor.steps.push({ activityId: '', count: 1, durationMinutes: null, label: null, critical: false, resourceType: null });
    cevRefreshSteps();
  };
  window.cevStepRemove = function (index) {
    if (!catalogEditor.steps) return;
    catalogEditor.steps.splice(index, 1);
    cevRefreshSteps();
  };
  window.cevStepMove = function (index, dir) {
    const steps = catalogEditor.steps;
    if (!steps) return;
    const target = index + dir;
    if (target < 0 || target >= steps.length) return;
    const moved = steps[index];
    steps[index] = steps[target];
    steps[target] = moved;
    cevRefreshSteps();
  };
  window.cevStepSetActivity = function (index, value) {
    const step = catalogEditor.steps && catalogEditor.steps[index];
    if (!step) return;
    step.activityId = String(value || '');
    // Une activite REELLE du catalogue porte son propre resourceType : on efface
    // le resourceType herite d'une pseudo-activite pour ne pas le renvoyer a tort.
    if ((pricingEditor.activities || []).some((a) => a.id === step.activityId)) step.resourceType = null;
  };
  window.cevStepSetCount = function (index, raw) {
    const step = catalogEditor.steps && catalogEditor.steps[index];
    if (!step) return;
    const n = Math.trunc(Number(raw));
    step.count = Number.isFinite(n) && n >= 1 ? n : 1;
  };
  window.cevStepSetDuration = function (index, raw) {
    const step = catalogEditor.steps && catalogEditor.steps[index];
    if (!step) return;
    if (raw === '' || raw == null) { step.durationMinutes = null; return; }
    const n = Math.trunc(Number(raw));
    step.durationMinutes = Number.isFinite(n) && n >= 0 ? n : null;
  };
  window.cevStepToggleCritical = function (index, checked) {
    const step = catalogEditor.steps && catalogEditor.steps[index];
    if (step) step.critical = Boolean(checked);
  };
  // Le libelle est LA phrase que le client lit sur la carte (« 2 cruches
  // boissons »). Vide = la phrase automatique du placeholder fait foi.
  window.cevStepSetLabel = function (index, raw) {
    const step = catalogEditor.steps && catalogEditor.steps[index];
    if (!step) return;
    const value = String(raw == null ? '' : raw).trim();
    step.label = value ? value.slice(0, 80) : null;
  };

  // Liste au format API : chaque step designe une activite ; on ignore les lignes
  // sans activite (l'utilisateur a ajoute une ligne vide).
  function cevCollectSteps() {
    const steps = catalogEditor.steps || [];
    const out = [];
    for (const step of steps) {
      const activityId = String(step.activityId || '').trim();
      if (!activityId) continue;
      const item = { activityId, count: Number(step.count) || 1 };
      if (step.durationMinutes != null) item.durationMinutes = Number(step.durationMinutes);
      if (step.label) item.label = String(step.label);
      if (step.critical) item.critical = true;
      if (step.resourceType) item.resourceType = String(step.resourceType);
      out.push(item);
    }
    return out;
  }

  // ── Formulaire de STRUCTURE (create/fields) ───────────────────────────────
  function cevFieldsHtml() {
    const f = catalogEditor.fields || {};
    const validDays = Array.isArray(f.validDays) ? f.validDays : [];
    const dayBoxes = CEV_DAY_LABELS.map((label, day) => `<label class="cev-day"><input type="checkbox" id="cevDay${day}" ${validDays.indexOf(day) !== -1 ? 'checked' : ''} onchange="cevFieldDay(${day}, this.checked)"><span>${label}</span></label>`).join('');
    return `<p class="cev-form-legend">Informations</p>
      <div class="field">
        <label for="cevName">Nom de la formule</label>
        <input id="cevName" type="text" maxlength="120" value="${f.name == null ? '' : esc(f.name)}" data-autofocus oninput="cevFieldSet('name', this.value)">
      </div>
      <div class="pev-grid2">
        <div class="field">
          <label for="cevFamily">Famille</label>
          <input id="cevFamily" type="text" maxlength="120" value="${f.family == null ? '' : esc(f.family)}" placeholder="Anniversaire, Speciale..." oninput="cevFieldSet('family', this.value)">
        </div>
        <div class="field">
          <label for="cevPriceType">Type de prix</label>
          <select id="cevPriceType" onchange="cevFieldSet('priceType', this.value)">
            <option value="per_pax"${f.priceType === 'per_lane' ? '' : ' selected'}>Par personne</option>
            <option value="per_lane"${f.priceType === 'per_lane' ? ' selected' : ''}>Par piste</option>
          </select>
        </div>
      </div>
      <p class="cev-form-legend">Tarif</p>
      <div class="pev-grid2">
        <div class="field">
          <label for="cevPrice">Prix (€)</label>
          <input id="cevPrice" type="number" min="0" max="1000" step="1" value="${f.priceValue == null ? '' : esc(f.priceValue)}" oninput="cevFieldNum('priceValue', this.value)">
        </div>
        <div class="field">
          <label for="cevOldPrice">Ancien prix barré (€)</label>
          <input id="cevOldPrice" type="number" min="0" max="1000" step="1" value="${f.priceOld == null ? '' : esc(f.priceOld)}" placeholder="aucun" oninput="cevFieldNum('priceOld', this.value)">
        </div>
      </div>
      <p class="cev-form-legend">Conditions</p>
      <div class="pev-grid2">
        <div class="field">
          <label for="cevMinPax">Personnes minimum</label>
          <input id="cevMinPax" type="number" min="1" max="999" step="1" value="${f.minPax == null ? '' : esc(f.minPax)}" oninput="cevFieldNum('minPax', this.value)">
        </div>
        <div class="field">
          <label>Formule anniversaire</label>
          <label class="cev-inline-check"><input id="cevBirthday" type="checkbox" ${f.isBirthdayFormula ? 'checked' : ''} onchange="cevFieldSet('isBirthdayFormula', this.checked)"><span>Oui</span></label>
        </div>
      </div>
      <div class="field">
        <label>Jours valides <span class="cev-hint-inline">(aucun jour coché = tous les jours)</span></label>
        <div class="cev-days">${dayBoxes}</div>
      </div>
      <div class="pev-grid2">
        <div class="field">
          <label for="cevTimeMin">Heure min (optionnel)</label>
          <input id="cevTimeMin" type="time" value="${esc(cevMinutesToHhmm(f.timeLimitMin))}" onchange="cevFieldTime('timeLimitMin', this.value)">
        </div>
        <div class="field">
          <label for="cevTimeMax">Heure max (optionnel)</label>
          <input id="cevTimeMax" type="time" value="${esc(cevMinutesToHhmm(f.timeLimitMax))}" onchange="cevFieldTime('timeLimitMax', this.value)">
        </div>
      </div>`;
  }

  window.cevFieldSet = function (key, value) {
    if (!catalogEditor.fields) return;
    if (key === 'isBirthdayFormula') catalogEditor.fields[key] = Boolean(value);
    else catalogEditor.fields[key] = value == null ? '' : String(value);
  };
  window.cevFieldNum = function (key, raw) {
    if (!catalogEditor.fields) return;
    if (raw === '' || raw == null) { catalogEditor.fields[key] = null; return; }
    const n = Number(raw);
    catalogEditor.fields[key] = Number.isFinite(n) ? n : null;
  };
  window.cevFieldTime = function (key, value) {
    if (!catalogEditor.fields) return;
    catalogEditor.fields[key] = cevHhmmToMinutes(value);
  };
  window.cevFieldDay = function (day, checked) {
    if (!catalogEditor.fields) return;
    const set = new Set(catalogEditor.fields.validDays || []);
    if (checked) set.add(Number(day)); else set.delete(Number(day));
    catalogEditor.fields.validDays = Array.from(set).sort((a, b) => a - b);
  };

  function cevFieldsToApi() {
    const f = catalogEditor.fields || {};
    const out = {
      name: String(f.name == null ? '' : f.name).trim(),
      family: String(f.family == null ? '' : f.family).trim(),
      priceType: f.priceType === 'per_lane' ? 'per_lane' : 'per_pax',
      priceValue: f.priceValue,
      minPax: f.minPax,
      isBirthdayFormula: Boolean(f.isBirthdayFormula),
    };
    return out;
  }

  // ── Ouverture des modales ─────────────────────────────────────────────────
  // La CATEGORIE peut arriver pre-remplie : le bouton « + Formule » d'une
  // section cree dans CETTE section, sans avoir a retaper son nom. Appele sans
  // argument (bouton « + Categorie »), le champ reste vide et prend le focus :
  // taper un nom qui n'existe pas encore CREE la categorie, il n'y a pas de
  // liste fermee a maintenir quelque part.
  window.cevOpenCreate = function (family) {
    if (!cevCanManage()) { pevToast('Édition du catalogue réservée à la direction.'); return; }
    catalogEditor.fields = { name: '', family: String(family || ''), priceType: 'per_pax', priceValue: null, priceOld: null, minPax: 6, isBirthdayFormula: /anniversaire/i.test(String(family || '')), validDays: [], timeLimitMin: null, timeLimitMax: null };
    catalogEditor.steps = [{ activityId: '', count: 1, durationMinutes: null, label: null, critical: false, resourceType: null }];
    catalogEditor.error = '';
    catalogEditor.saving = false;
    catalogEditor.modal = { mode: 'create', formuleId: null };
    cevSyncModal();
    // Categorie vide = le geste est « je cree une categorie » : c'est ce champ
    // qu'on veut sous le curseur, pas le nom de la formule.
    if (!String(family || '')) {
      setTimeout(() => { const el = document.getElementById('cevFamily'); if (el) el.focus(); }, 60);
    }
  };
  window.cevOpenSteps = function (formuleId) {
    if (!cevCanManage()) { pevToast('Édition du catalogue réservée à la direction.'); return; }
    const entry = pevEntry(formuleId);
    if (!entry) { pevToast('Catalogue en cours de chargement, réessayez dans un instant.'); pevEnsureLoaded(); return; }
    catalogEditor.fields = null;
    catalogEditor.steps = (entry.steps || []).map((s) => ({
      activityId: s.activityId != null ? String(s.activityId) : '',
      count: Number(s.count) || 1,
      durationMinutes: s.durationMinutes != null ? Number(s.durationMinutes) : null,
      label: s.label != null ? String(s.label) : null,
      critical: s.critical === true,
      resourceType: s.resourceType != null ? String(s.resourceType) : null,
    }));
    if (!catalogEditor.steps.length) catalogEditor.steps.push({ activityId: '', count: 1, durationMinutes: null, label: null, critical: false, resourceType: null });
    catalogEditor.error = '';
    catalogEditor.saving = false;
    catalogEditor.modal = { mode: 'steps', formuleId: String(formuleId) };
    cevSyncModal();
  };
  window.cevOpenFields = function (formuleId) {
    if (!cevCanManage()) { pevToast('Édition du catalogue réservée à la direction.'); return; }
    const entry = pevEntry(formuleId);
    if (!entry) { pevToast('Catalogue en cours de chargement, réessayez dans un instant.'); pevEnsureLoaded(); return; }
    catalogEditor.fields = {
      name: entry.name != null ? String(entry.name) : '',
      family: entry.family != null ? String(entry.family) : '',
      priceType: entry.priceType === 'per_lane' ? 'per_lane' : 'per_pax',
      priceValue: entry.base && entry.base.priceValue != null ? Number(entry.base.priceValue) : null,
      priceOld: entry.base && entry.base.priceOld != null ? Number(entry.base.priceOld) : null,
      minPax: entry.minPax != null ? Number(entry.minPax) : null,
      isBirthdayFormula: Boolean(entry.isBirthdayFormula),
      validDays: Array.isArray(entry.validDays) ? entry.validDays.slice() : [],
      timeLimitMin: entry.timeLimitMinMinutes != null ? Number(entry.timeLimitMinMinutes) : null,
      timeLimitMax: entry.timeLimitMaxMinutes != null ? Number(entry.timeLimitMaxMinutes) : null,
    };
    catalogEditor.steps = null;
    catalogEditor.error = '';
    catalogEditor.saving = false;
    catalogEditor.modal = { mode: 'fields', formuleId: String(formuleId) };
    cevSyncModal();
  };

  // ── Enregistrement ────────────────────────────────────────────────────────
  window.cevSave = function () {
    if (catalogEditor.saving || !catalogEditor.modal) return;
    const mode = catalogEditor.modal.mode;
    if (mode === 'create') { cevSaveCreate(); return; }
    if (mode === 'steps') { cevSaveSteps(); return; }
    cevSaveFields();
  };

  function cevSaveCreate() {
    const f = catalogEditor.fields || {};
    if (!String(f.name || '').trim()) { cevFail('Donnez un nom à la formule.'); return; }
    if (f.priceValue == null || !Number.isFinite(Number(f.priceValue))) { cevFail('Indiquez un prix entre 0 et 1000 €.'); return; }
    const createSteps = cevCollectSteps();
    if (!createSteps.length) { cevFail('Ajoutez au moins une activité (choisissez-la dans la liste).'); return; }
    const formula = cevFieldsToApi();
    formula.steps = createSteps;
    if (f.priceOld != null) formula.priceOld = f.priceOld;
    if (Array.isArray(f.validDays) && f.validDays.length) formula.validDays = f.validDays.slice();
    if (f.timeLimitMin != null) formula.timeLimitMinMinutes = f.timeLimitMin;
    if (f.timeLimitMax != null) formula.timeLimitMaxMinutes = f.timeLimitMax;
    cevSubmit({ action: 'createFormula', formula }, 'Formule ajoutee au catalogue.');
  }

  function cevSaveSteps() {
    const id = catalogEditor.modal && catalogEditor.modal.formuleId;
    if (!id) return;
    const stepList = cevCollectSteps();
    if (!stepList.length) { cevFail('Ajoutez au moins une activité (choisissez-la dans la liste).'); return; }
    cevSubmit({ action: 'setFormulaSteps', id, steps: stepList }, 'Activités de la formule mises à jour.');
  }

  function cevSaveFields() {
    const id = catalogEditor.modal && catalogEditor.modal.formuleId;
    if (!id) return;
    const f = catalogEditor.fields || {};
    if (!String(f.name || '').trim()) { cevFail('Le nom ne peut pas être vide.'); return; }
    if (f.priceValue == null || !Number.isFinite(Number(f.priceValue))) { cevFail('Indiquez un prix entre 0 et 1000 €.'); return; }
    const api = cevFieldsToApi();
    const patch = {
      name: api.name,
      family: api.family,
      priceType: api.priceType,
      priceValue: api.priceValue,
      minPax: api.minPax,
      isBirthdayFormula: api.isBirthdayFormula,
      priceOld: f.priceOld != null ? f.priceOld : null,
      validDays: (Array.isArray(f.validDays) && f.validDays.length) ? f.validDays.slice() : null,
      timeLimitMinMinutes: f.timeLimitMin != null ? f.timeLimitMin : null,
      timeLimitMaxMinutes: f.timeLimitMax != null ? f.timeLimitMax : null,
    };
    cevSubmit({ action: 'updateFormula', id, patch }, 'Structure de la formule mise à jour.');
  }

  // LE POINT DE PASSAGE UNIQUE des ecritures catalogue (createFormula,
  // updateFormula, setFormulaSteps). Elles portent le centre AFFICHE, et ce
  // n'est pas contradictoire avec leur portee : une edition de catalogue vaut
  // pour toute l'ENTREPRISE, et le serveur deduit justement l'entreprise du
  // centre (requireOwnerClientId lit centers.client_id). Sans centre dans la
  // requete, il prend celui de la SESSION : creer une formule depuis l'ecran
  // d'un centre l'ecrivait alors dans le catalogue d'une AUTRE entreprise.
  // Ne rien envoyer ne rendait donc pas l'action globale, ca la rattachait en
  // silence au mauvais proprietaire.
  function cevSubmit(body, successMessage) {
    catalogEditor.saving = true;
    catalogEditor.error = '';
    cevRefreshFoot();
    apiRequest(`${API_ENDPOINTS.ops || '/api/ops'}`, {
      method: 'POST',
      body: pevBody(body),
    }).then(() => {
      pevToast(successMessage);
      cevDismiss();
      pevReload();
    }).catch((error) => {
      catalogEditor.saving = false;
      catalogEditor.error = (error && error.message) || 'Enregistrement refusé. Réessayez.';
      cevRefreshBody();
      cevRefreshFoot();
    });
  }

  function cevFail(message) {
    catalogEditor.error = message;
    cevRefreshBody();
    cevRefreshFoot();
  }

  window.cevDelete = function (formuleId) {
    if (!cevCanManage()) { pevToast('Édition du catalogue réservée à la direction.'); return; }
    const entry = pevEntry(formuleId);
    const name = entry && entry.name ? entry.name : formuleId;
    if (!window.confirm(`Supprimer la formule « ${name} » de votre catalogue ? Elle disparaît de tous vos centres. Les autres clients ne sont pas concernés.`)) return;
    apiRequest(`${API_ENDPOINTS.ops || '/api/ops'}`, {
      method: 'POST',
      body: pevBody({ action: 'deleteFormula', id: String(formuleId) }),
    }).then(() => {
      pevToast('Formule retiree du catalogue.');
      pevReload();
    }).catch((error) => {
      pevToast((error && error.message) || 'Suppression refusée. Réessayez.');
    });
  };

  // ── Modale (montee dans document.body, comme pev) ─────────────────────────
  function cevModalTitle() {
    const mode = catalogEditor.modal && catalogEditor.modal.mode;
    if (mode === 'create') return 'Ajouter une formule';
    const entry = pevEntry(catalogEditor.modal && catalogEditor.modal.formuleId);
    const name = entry && entry.name ? entry.name : 'Formule';
    return mode === 'steps' ? `Activités : ${name}` : `Structure : ${name}`;
  }
  function cevModalSub() {
    return 'Cette modification change l\'offre de TOUS VOS centres, pas seulement celui-ci. Aucun autre client ne la voit.';
  }
  function cevModalBodyHtml() {
    if (!catalogEditor.modal) return '';
    const mode = catalogEditor.modal.mode;
    const err = catalogEditor.error ? `<div class="pev-modal-error" role="alert">${esc(catalogEditor.error)}</div>` : '';
    if (mode === 'steps') return `${err}${cevStepsEditorHtml()}`;
    if (mode === 'fields') return `${err}${cevFieldsHtml()}`;
    return `${err}${cevFieldsHtml()}<div class="cev-sep"></div>${cevStepsEditorHtml()}`;
  }
  function cevModalFootHtml() {
    const busy = catalogEditor.saving;
    return `<span class="pev-foot-note">Catalogue de votre entreprise. Chaque enregistrement est tracé au journal.</span>
      <button type="button" class="btn btn-ghost" ${busy ? 'disabled' : ''} onclick="cevCloseModal()">Annuler</button>
      <button type="button" class="btn btn-primary" ${busy ? 'disabled' : ''} onclick="cevSave()">${busy ? 'Enregistrement...' : 'Enregistrer'}</button>`;
  }

  function cevSyncModal() {
    const existing = document.getElementById('cevOverlay');
    if (!catalogEditor.modal) { if (existing) existing.remove(); return; }
    if (existing) return;
    const overlay = document.createElement('div');
    overlay.id = 'cevOverlay';
    overlay.className = 'overlay-backdrop pev-overlay';
    overlay.innerHTML = `<div class="modal-surface pev-modal cev-modal" role="dialog" aria-modal="true" aria-labelledby="cevModalTitle">
      <div class="pev-modal-head">
        <div><h3 id="cevModalTitle">${esc(cevModalTitle())}</h3><p>${esc(cevModalSub())}</p></div>
        <button type="button" class="pev-close" aria-label="Fermer" ${catalogEditor.saving ? 'disabled' : ''} onclick="cevCloseModal()">&times;</button>
      </div>
      <div class="pev-modal-body">${cevModalBodyHtml()}</div>
      <div class="pev-modal-foot">${cevModalFootHtml()}</div>
    </div>`;
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay && !catalogEditor.saving) window.cevCloseModal();
    });
    document.body.appendChild(overlay);
    requestAnimationFrame(() => {
      const f = overlay.querySelector('[data-autofocus]');
      if (f) { try { f.focus(); } catch (_) { /* focus best effort */ } }
    });
  }
  function cevRefreshBody() {
    const body = document.querySelector('#cevOverlay .pev-modal-body');
    if (body) body.innerHTML = cevModalBodyHtml();
  }
  function cevRefreshFoot() {
    const foot = document.querySelector('#cevOverlay .pev-modal-foot');
    if (foot) foot.innerHTML = cevModalFootHtml();
    const close = document.querySelector('#cevOverlay .pev-close');
    if (close) close.disabled = catalogEditor.saving;
  }
  function cevDismiss() {
    catalogEditor.modal = null;
    catalogEditor.fields = null;
    catalogEditor.steps = null;
    catalogEditor.saving = false;
    catalogEditor.error = '';
    const overlay = document.getElementById('cevOverlay');
    if (overlay) overlay.remove();
  }
  window.cevCloseModal = function () {
    if (catalogEditor.saving) return;
    cevDismiss();
  };

  if (!window.__cevKeydownBound) {
    window.__cevKeydownBound = true;
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && catalogEditor.modal && !catalogEditor.saving) {
        e.preventDefault();
        window.cevCloseModal();
      }
    });
  }

  // ---- LES ALERTES D UNE LIGNE DE FORMULE (page Tarifs & formules) --------
  // Les ingredients qu une formule exige et que CE centre ne possede pas.
  // Meme regle que le tunnel client (getFormulaActivityIds lit la description
  // de l offre) : les deux ecrans doivent dire la meme chose, sinon le gerant
  // voit « reservable » la ou le client voit « indisponible ».
  // Liste vide quand la dotation du centre est inconnue : dans le doute, on ne
  // signale rien.
  function missingIngredientsFor(row) {
    const owned = Array.isArray(pricingEditor.centerActivityIds) ? pricingEditor.centerActivityIds : [];
    if (!owned.length) return [];
    if (typeof getFormulaActivityIds !== 'function') return [];
    const needed = getFormulaActivityIds({ desc: Array.isArray(row && row.desc) ? row.desc : [] }) || [];
    if (!needed.length) return [];
    const names = new Map((pricingEditor.activities || []).map((a) => [String(a.id), a.name || a.id]));
    return needed
      .filter((id) => !owned.includes(String(id)))
      .map((id) => names.get(String(id)) || String(id));
  }

  const DAY_NAMES_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

  // UNE OFFRE PUBLIEE SUR UN JOUR DE FERMETURE NE SE VEND JAMAIS.
  // Rien ne le disait : la promo « Vendredi malin » de N4 rendait 0 creneau
  // sur 360 combinaisons (60 jours x 6 tailles de groupe), parce que le centre
  // est ferme le vendredi hors vacances et que la formule, « hors vacances »,
  // se bloque elle-meme le reste du temps. Rien n avertissait le gerant.
  // Retourne le libelle du probleme, ou une chaine vide.
  function closedDayWarningFor(row) {
    const open = pricingEditor.centerOpenDays;
    if (!open || !Array.isArray(open.regular)) return '';
    const days = row && Array.isArray(row.validDays) ? row.validDays.map(Number) : null;
    if (!days || !days.length) return '';
    // « Hors vacances » ne peut compter que sur les horaires reguliers.
    const usable = row && row.notDuringHolidays === true
      ? open.regular
      : open.regular.concat(Array.isArray(open.holiday) ? open.holiday : []);
    if (!usable.length) return '';
    if (days.some((day) => usable.includes(day))) return '';
    const named = days.map((day) => DAY_NAMES_FR[day] || `jour ${day}`).join(', ');
    return row && row.notDuringHolidays === true
      ? `Jamais vendable : le centre est fermé le ${named} hors vacances`
      : `Jamais vendable : le centre est fermé le ${named}`;
  }

  /* ==========================================================================
     ACTIVITES DU CATALOGUE (aev) : creer / editer / retirer une activite.
     Le CRUD serveur existait (createActivity / updateActivity / deleteActivity,
     permission settings.manage) sans aucune porte d'entree : impossible
     d'ajouter « boissons soft » ou de renommer une activite, et l'editeur de
     formule affichait « service_drinks (hors catalogue) » a la place d'un nom.
     Meme mecanique que cev : etat hors DOM, modale montee dans document.body.
     ======================================================================== */

  const AEV_PRICE_TYPES = [
    ['per_pax', 'Par personne'],
    ['per_unit_hour', 'Par unité et par heure'],
    ['on_site', 'Réglé sur place'],
    ['grid_bowling', 'Grille bowling (par piste)'],
    ['grid_laser', 'Grille laser (par partie)'],
  ];

  const activityEditor = { modal: null, fields: null, saving: false, error: '' };

  function aevEntry(id) {
    return (pricingEditor.activities || []).find((a) => a.id === String(id)) || null;
  }

  window.aevOpenCreate = function () {
    if (!cevCanManage()) { pevToast('Édition du catalogue réservée à la direction.'); return; }
    activityEditor.fields = { id: '', name: '', bookable: true, priceType: 'per_pax', priceValue: null, priceUnit: 'par personne' };
    activityEditor.modal = { mode: 'create', id: null };
    activityEditor.error = '';
    activityEditor.saving = false;
    aevSyncModal();
  };
  window.aevOpenEdit = function (id) {
    if (!cevCanManage()) { pevToast('Édition du catalogue réservée à la direction.'); return; }
    const entry = aevEntry(id);
    if (!entry) { pevToast('Catalogue en cours de chargement, réessaie dans un instant.'); pevEnsureLoaded(); return; }
    activityEditor.fields = {
      id: entry.id,
      name: entry.name || '',
      bookable: entry.bookable === true,
      priceType: entry.priceType || 'per_pax',
      priceValue: entry.priceValue == null ? null : Number(entry.priceValue),
      priceUnit: entry.priceUnit || '',
    };
    activityEditor.modal = { mode: 'edit', id: entry.id };
    activityEditor.error = '';
    activityEditor.saving = false;
    aevSyncModal();
  };
  window.aevSet = function (key, value) {
    if (!activityEditor.fields) return;
    activityEditor.fields[key] = key === 'bookable' ? Boolean(value) : String(value == null ? '' : value);
  };
  window.aevSetPrice = function (raw) {
    if (!activityEditor.fields) return;
    if (raw === '' || raw == null) { activityEditor.fields.priceValue = null; return; }
    const n = Number(raw);
    activityEditor.fields.priceValue = Number.isFinite(n) ? Math.min(1000, Math.max(0, n)) : null;
  };
  window.aevCloseModal = function () {
    if (activityEditor.saving) return;
    activityEditor.modal = null;
    activityEditor.fields = null;
    activityEditor.error = '';
    const overlay = document.getElementById('aevOverlay');
    if (overlay) overlay.remove();
  };
  window.aevSave = function () {
    if (activityEditor.saving || !activityEditor.modal) return;
    const f = activityEditor.fields || {};
    if (!String(f.name || '').trim()) { activityEditor.error = 'Donnez un nom à l’activité.'; aevRefresh(); return; }
    // « Réglé sur place » est le seul type qui s'assume SANS montant : partout
    // ailleurs un prix vide afficherait « réglé sur place » au client sans que
    // personne ne l'ait décidé.
    const activity = {
      name: String(f.name).trim(),
      bookable: Boolean(f.bookable),
      priceType: f.priceType || 'per_pax',
      priceValue: f.priceType === 'on_site' ? null : f.priceValue,
      priceUnit: String(f.priceUnit || '').trim() || null,
    };
    activityEditor.saving = true;
    activityEditor.error = '';
    aevRefresh();
    const body = activityEditor.modal.mode === 'create'
      ? { action: 'createActivity', activity }
      : { action: 'updateActivity', id: activityEditor.modal.id, patch: activity };
    apiRequest(`${API_ENDPOINTS.ops || '/api/ops'}`, { method: 'POST', body: pevBody(body) })
      .then(() => {
        pevToast(activityEditor.modal.mode === 'create' ? 'Activité ajoutée au catalogue.' : 'Activité mise à jour.');
        window.aevCloseModal();
        pevReload();
      })
      .catch((error) => {
        activityEditor.saving = false;
        activityEditor.error = (error && error.message) || 'Enregistrement refusé. Réessayez.';
        aevRefresh();
      });
  };
  window.aevDelete = function (id) {
    if (!cevCanManage()) { pevToast('Édition du catalogue réservée à la direction.'); return; }
    const entry = aevEntry(id);
    const name = entry && entry.name ? entry.name : id;
    if (!window.confirm(`Retirer « ${name} » du catalogue ? Les formules qui l utilisent garderont leur étape.`)) return;
    apiRequest(`${API_ENDPOINTS.ops || '/api/ops'}`, { method: 'POST', body: pevBody({ action: 'deleteActivity', id: String(id) }) })
      .then(() => { pevToast('Activité retirée du catalogue.'); pevReload(); })
      .catch((error) => pevToast((error && error.message) || 'Suppression refusée. Réessayez.'));
  };

  function aevModalBodyHtml() {
    const f = activityEditor.fields || {};
    const onSite = f.priceType === 'on_site';
    const grid = f.priceType === 'grid_bowling' || f.priceType === 'grid_laser';
    return `${activityEditor.error ? `<div class="pev-modal-error" role="alert">${esc(activityEditor.error)}</div>` : ''}
      <div class="field pev-field">
        <label for="aevName">Nom de l’activité</label>
        <input id="aevName" type="text" maxlength="60" value="${esc(f.name || '')}" data-autofocus placeholder="Ex : Boissons soft" oninput="aevSet('name', this.value)">
        <span class="field-hint">C’est ce nom que le client lit sur le formulaire et dans les formules.</span>
      </div>
      <div class="field pev-field">
        <label for="aevPriceType">Comment ça se facture</label>
        <select id="aevPriceType" onchange="aevSet('priceType', this.value); aevRefresh();">
          ${AEV_PRICE_TYPES.map(([key, label]) => `<option value="${key}"${f.priceType === key ? ' selected' : ''}>${esc(label)}</option>`).join('')}
        </select>
      </div>
      ${grid ? '<p class="cev-form-hint">Les paliers de cette grille (durées ou nombre de parties) restent ceux du moteur.</p>' : ''}
      <div class="pev-grid2">
        <div class="field pev-field">
          <label for="aevPrice">Prix (EUR)</label>
          <input id="aevPrice" type="number" min="0" max="1000" step="1" value="${f.priceValue == null ? '' : esc(f.priceValue)}" ${onSite ? 'disabled' : ''} placeholder="${onSite ? 'au comptoir' : 'vide = réglé sur place'}" oninput="aevSetPrice(this.value)">
        </div>
        <div class="field pev-field">
          <label for="aevUnit">Unité affichée</label>
          <input id="aevUnit" type="text" maxlength="60" value="${esc(f.priceUnit || '')}" placeholder="par personne" oninput="aevSet('priceUnit', this.value)">
        </div>
      </div>
      <label class="pev-toggle-row">
        <span class="pev-toggle-label">Réservable seule sur le formulaire<small>Décochée, l’activité ne sert qu’à composer les formules (comme la table d’anniversaire).</small></span>
        <button type="button" class="mk-switch ${f.bookable ? 'is-on' : ''}" role="switch" aria-checked="${f.bookable ? 'true' : 'false'}" aria-label="Réservable seule" onclick="aevSet('bookable', !${Boolean(f.bookable)}); aevRefresh();"><span></span></button>
      </label>`;
  }

  function aevModalFootHtml() {
    const mode = activityEditor.modal && activityEditor.modal.mode;
    return `<span class="pev-foot-note">Cette activité existe pour tous vos centres, et pour eux seuls.</span>
      <button type="button" class="pv2-btn" ${activityEditor.saving ? 'disabled' : ''} onclick="aevCloseModal()">Annuler</button>
      <button type="button" class="pv2-btn primary" id="aevSaveBtn" ${activityEditor.saving ? 'disabled' : ''} onclick="aevSave()">${activityEditor.saving ? 'Enregistrement…' : (mode === 'create' ? 'Ajouter' : 'Enregistrer')}</button>`;
  }

  window.aevRefresh = function () {
    const body = document.querySelector('#aevOverlay .pev-modal-body');
    if (body) body.innerHTML = aevModalBodyHtml();
    const foot = document.querySelector('#aevOverlay .pev-modal-foot');
    if (foot) foot.innerHTML = aevModalFootHtml();
  };

  function aevSyncModal() {
    const existing = document.getElementById('aevOverlay');
    if (!activityEditor.modal) { if (existing) existing.remove(); return; }
    if (existing) return;
    const overlay = document.createElement('div');
    overlay.id = 'aevOverlay';
    overlay.className = 'overlay-backdrop pev-overlay';
    overlay.innerHTML = `<div class="modal-surface pev-modal" role="dialog" aria-modal="true" aria-labelledby="aevModalTitle">
      <div class="pev-modal-head">
        <div><h3 id="aevModalTitle">${activityEditor.modal.mode === 'create' ? 'Nouvelle activité' : `Activité : ${esc((aevEntry(activityEditor.modal.id) || {}).name || '')}`}</h3><p>Ce que vos formules peuvent contenir, et ce que le client peut réserver.</p></div>
        <button type="button" class="pev-close" aria-label="Fermer" onclick="aevCloseModal()">&times;</button>
      </div>
      <div class="pev-modal-body">${aevModalBodyHtml()}</div>
      <div class="pev-modal-foot">${aevModalFootHtml()}</div>
    </div>`;
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) window.aevCloseModal(); });
    document.body.appendChild(overlay);
    requestAnimationFrame(() => {
      const f = overlay.querySelector('[data-autofocus]');
      if (f) { try { f.focus(); } catch (_) { /* focus best effort */ } }
    });
  }

  if (!window.__aevKeydownBound) {
    window.__aevKeydownBound = true;
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && activityEditor.modal && !activityEditor.saving) { e.preventDefault(); window.aevCloseModal(); }
    });
  }

  /* ==========================================================================
     TARIFS & FORMULES : LA PAGE (refonte du 2026-11-03, « les fils »)
     Movsar : « on comprend rien, qu est-ce qu on peut modifier et ca modifie
     quoi, comment, pourquoi... des belles motion design qui montrent ce que ca
     change et ou ». Son choix : la liste repliable de la vision B et ses fils,
     avec trois idees de la vision C (le prix se change depuis sa ligne, un
     seul « Publier » et son recapitulatif, le sur mesure en carte de menu).

     Une LIGNE par formule. Ouverte, elle deplie sa PLANCHE : a gauche ce que
     le gerant regle, a droite les endroits ou ca se voit, dessines en petit
     avec les vraies regles (formulaire client, fin de reservation, mails,
     comptoir, planning). Le champ en main tire un fil vers chaque endroit
     qu il change ; les autres disent « Pas concerné ». Les changements
     s accumulent dans un BROUILLON par centre et ne partent qu a « Publier ».

     Aucun chiffre n est invente : les totaux suivent getBasePrice (serveur),
     les durees viennent de /api/public-availability (type=durees), les regles
     sont celles du formulaire client, portees plus bas a l identique. Aucun
     gestionnaire en ligne : un seul ecouteur delegue sur la page, qui lit
     des attributs data-tf-*.
     ======================================================================== */

  const TF_ONGLETS = ['formules', 'activites', 'surmesure'];
  const TF_CHAMPS = ['prix', 'ancien', 'nom', 'vente', 'validation'];
  const TF_GROUPE_MIN = 1;
  const TF_GROUPE_MAX = 60;
  // Les durees du mouvement : le fil se trace en 280 ms, le point le parcourt
  // en 400 ms, la valeur roule en 220 ms, le lieu s eclaire 600 ms. Plus long
  // que les 120-200 ms de DESIGN.md parce que ce mouvement EXPLIQUE ou va le
  // changement (feuille de style, section tf-, meme justification).
  const TF_FRAPPE_MS = 200;
  const TF_TRACE_MS = 280;
  const TF_GOUTTE_MS = 400;
  const TF_ROULE_MS = 220;
  const TF_ECLAT_MS = 600;

  // Les trois modes du serveur (lib/validation-policy.js), avec les phrases de
  // l ancienne modale de tarif : elles disent ce qui se passe pour le client,
  // elles restent mot pour mot.
  const TF_VALIDATIONS = [
    { mode: 'recommended', mot: 'Si impossible', liste: 'Confirmée tout de suite', dit: 'Confirmée tout de suite au client. L’équipe n’est prévenue que si le planning ne trouve aucune place sûre.' },
    { mode: 'required_when_laser_busy', mot: 'Si laser partagé', liste: 'Validée si laser partagé', dit: 'Confirmée tout de suite, sauf si le groupe devait partager l’arène laser avec un autre : l’équipe valide d’abord et reçoit un mail.' },
    { mode: 'required', mot: 'Toujours', liste: 'Validée par l’équipe', dit: 'Jamais confirmée tout de suite : chaque réservation attend votre validation, vous recevez un mail et le client un « demande reçue ».' },
  ];
  const tfValidation = (mode) => TF_VALIDATIONS.find((x) => x.mode === mode) || TF_VALIDATIONS[0];

  const TF_LIEUX_NOMS = {
    formulaire: 'Formulaire de vos clients',
    fin: 'Fin de la réservation',
    mails: 'Mails aux clients',
    comptoir: 'Comptoir (Réserver)',
    planning: 'Planning et fiches',
  };
  const TF_MOTS_CHAMP = {
    prix: 'le prix',
    ancien: 'le prix barré',
    nom: 'le nom',
    vente: 'la mise en vente',
    validation: 'la validation',
    structure: 'le contenu, les jours et le minimum',
  };
  const TF_QUAND = 'Tout de suite : un formulaire déjà ouvert le reprend dans les 30 secondes, le comptoir en quelques secondes.';
  const TF_DROITS = {
    'pricing.manage': { mot: 'droit Tarifs', defaut: 'Direction et Manager' },
    'settings.manage': { mot: 'droit Réglages', defaut: 'Direction et Technique' },
  };
  const TF_ICO = {
    chevron: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m4 6 4 4 4-4"/></svg>',
    moins: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M3.5 8h9"/></svg>',
    plus: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M8 3.5v9M3.5 8h9"/></svg>',
    fermer: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="m4 4 8 8M12 4l-8 8"/></svg>',
    cherche: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg>',
    boule: '<span class="tf-m-ico" aria-hidden="true"><svg viewBox="0 0 16 16" width="12" height="12" focusable="false"><circle cx="8" cy="8" r="6.2"/><circle class="tf-m-ico-trou" cx="6.3" cy="5.6" r="1"/><circle class="tf-m-ico-trou" cx="9" cy="5" r="1"/><circle class="tf-m-ico-trou" cx="8.3" cy="7.6" r="1"/></svg></span>',
  };

  // ---- LE FORMULAIRE CLIENT, PORTE A L IDENTIQUE ----------------------------
  // COPIES de assets/fungalaxy-booking.js : euros (317), insecable (325),
  // dureeExacte (404), joursLisibles (2298), heureRonde (2305), plageLisible
  // (2306), reglesFormule (2345), texteDuree (2384). La console doit ecrire
  // ce que le client lit, au mot pres : en changer une ici sans changer
  // l autre fait mentir la page. window.tarifsRegles les expose au gate qui
  // compare les deux fichiers.
  const TF_JOURS_SEM = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const TF_MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  function tfEuros(n) { n = Math.round(Number(n) * 100) / 100; if (!isFinite(n)) return ''; return `${n.toLocaleString('fr-BE', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })} €`; }
  function insecable(s) { return String(s == null ? '' : s).replace(/ /g, ' '); }
  function dureeExacte(m) {
    m = Math.max(0, Math.round(Number(m) || 0));
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    const r = m % 60;
    return `${h} h${r ? ` ${String(r).padStart(2, '0')}` : ''}`;
  }
  function joursLisibles(liste) {
    const noms = (liste || []).slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
      .map((d) => TF_JOURS_SEM[d] || '').filter(Boolean);
    if (!noms.length) return '';
    if (noms.length === 1) return `le ${noms[0]}`;
    return `les ${noms.slice(0, -1).join(', ')} et ${noms[noms.length - 1]}`;
  }
  function heureRonde(v) { const h = Math.floor(Number(v)); const m = Math.round((Number(v) - h) * 60); return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`; }
  function plageLisible(limite) {
    if (!limite) return '';
    if (limite.min && limite.max) return `de ${heureRonde(limite.min)} à ${heureRonde(limite.max)}`;
    if (limite.max) return `avant ${heureRonde(limite.max)}`;
    if (limite.min) return `à partir de ${heureRonde(limite.min)}`;
    return '';
  }
  function reglesFormule(f) {
    const out = [];
    if (f.minPax > 1) out.push(`dès ${f.minPax} personnes`);
    if (f.validDays && f.validDays.length && f.validDays.length < 7) out.push(joursLisibles(f.validDays));
    if (plageLisible(f.timeLimit)) out.push(plageLisible(f.timeLimit));
    if (f.noHolidays) out.push('hors vacances et fériés');
    return out;
  }
  function texteDuree(d) {
    const a = Math.round(Number(d && d.min) / 5) * 5;
    const b = Math.round(Number(d && d.max) / 5) * 5;
    if (!(a > 0) || !(b > 0)) return '';
    return a === b ? `Environ ${insecable(dureeExacte(a))} sur place` : `${insecable(dureeExacte(a))} à ${insecable(dureeExacte(b))} sur place selon l’heure`;
  }
  window.tarifsRegles = { euros: tfEuros, insecable, dureeExacte, joursLisibles, heureRonde, plageLisible, reglesFormule, texteDuree };

  // ---- L ETAT DE LA PAGE (hors du DOM : un rendu complet ne perd rien) ------
  const tarifs = {
    ouvert: { formules: '', activites: '' },
    groupe: 10,
    // { [centre]: { formules: { [id]: { champ: valeur } }, activites: { [id]: { prix } }, grilles: { 'bowling:1': prix } } }
    brouillons: {},
    // Ce que le gerant a TAPE, meme illisible (« 28, »), par centre et champ :
    // un rendu complet le lui rend tel quel au lieu de reformater sous ses doigts.
    saisies: {},
    focus: '',
    // La case de grille dont les endroits montrent l exemple : la derniere en main.
    caseExemple: '',
    trace: '',
    arrivees: {},
    signature: '',
    geo: null,
    tiroir: false,
    publication: false,
    erreur: '',
    dernierRendu: '',
    rendant: false,
    usages: null,
    gouttes: [],
    observateur: null,
    minuteurs: { frappe: 0, cherche: 0, groupe: 0 },
  };

  const tfPluriel = (n, mot, pluriel = `${mot}s`) => `${n} ${n > 1 ? pluriel : mot}`;
  const tfEt = (liste) => (liste.length < 2 ? liste.join('') : `${liste.slice(0, -1).join(', ')} et ${liste[liste.length - 1]}`);
  const tfPlie = (texte) => String(texte == null ? '' : texte).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const tfMajuscule = (texte) => (texte ? texte.charAt(0).toUpperCase() + texte.slice(1) : '');
  const tfReduit = () => Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const tfOps = () => (typeof API_ENDPOINTS !== 'undefined' && API_ENDPOINTS.ops) || '/api/ops';
  // Un montant de Reserver (rsEuros) : au centime, entier quand il l est.
  const tfEurosConsole = (n) => (typeof formatMoneyCentimes === 'function' ? formatMoneyCentimes(n) : tfEuros(n));
  // Le montant d un mail (lib/ops-communications.js formatEuro).
  function tfEurosMail(n) {
    const v = Math.round(Number(n) * 100) / 100;
    if (!Number.isFinite(v)) return '';
    return `${Number.isInteger(v) ? String(v) : v.toFixed(2).replace('.', ',')} €`;
  }
  function tfEasing() {
    try { return getComputedStyle(document.documentElement).getPropertyValue('--ease-out-strong').trim() || 'ease-out'; } catch (e) { return 'ease-out'; }
  }
  function tfAvecFocus(peindre) {
    if (window.PinlaneMotion && typeof window.PinlaneMotion.garderFocus === 'function') window.PinlaneMotion.garderFocus(peindre);
    else peindre();
  }
  function tfRendre() { window.renderStaffPricingPage(); }
  function tfRepeindre() {
    if (typeof isStaffPricingActive === 'function' && !isStaffPricingActive()) return;
    tfRendre();
  }

  // ---- LE CENTRE, SON ENTREPRISE, LES DROITS --------------------------------
  const tfCentre = () => pevCenterId();
  // Les centres de la MEME entreprise (getAdminCenters, champ clientId), le
  // centre affiche en premier. Un centre sans entreprise connue est seul.
  function tfCentres() {
    const id = tfCentre();
    const tous = typeof getAdminCenters === 'function' ? (getAdminCenters() || []).filter(Boolean) : [];
    const ici = tous.find((c) => c.id === id) || (typeof getAdminCenter === 'function' ? getAdminCenter(id) : null) || { id };
    const client = ici && ici.clientId ? String(ici.clientId) : '';
    const freres = client ? tous.filter((c) => c.id !== id && String(c.clientId || '') === client) : [];
    const liste = [ici, ...freres];
    const noms = tfNomsCourts(liste);
    return liste.map((c, i) => ({ id: c.id, nom: noms[i] }));
  }
  // « Fun Galaxy Libramont » se dit « Libramont » : le nom de l entreprise,
  // ou a defaut le debut commun des noms de ses centres, ne distingue rien.
  function tfNomsCourts(centres) {
    const noms = centres.map((c) => String((c && (c.shortName || c.name)) || (c && c.id) || '').trim());
    let commun = 0;
    if (noms.length > 1) {
      const mots = noms.map((n) => n.split(/\s+/));
      const court = Math.min(...mots.map((m) => m.length));
      while (commun < court - 1 && mots.every((m) => m[commun] === mots[0][commun])) commun += 1;
    }
    const meta = tfMetaCentre();
    return centres.map((c, i) => {
      if (c && c.shortName) return String(c.shortName);
      const client = String((c && c.clientName) || '').trim();
      let nom = noms[i];
      if (client && tfPlie(nom).startsWith(`${tfPlie(client)} `)) nom = nom.slice(client.length + 1).trim();
      else if (commun) nom = nom.split(/\s+/).slice(commun).join(' ');
      else if (i === 0 && meta && meta.city && tfPlie(nom).endsWith(tfPlie(meta.city))) nom = String(meta.city);
      return nom || noms[i] || String((c && c.id) || '');
    });
  }
  const tfNomCentre = () => tfCentres()[0].nom;
  const tfAutresCentres = () => tfCentres().slice(1).map((c) => c.nom);
  const tfPorteeCentre = () => `Pour ${tfNomCentre()}`;
  function tfPorteeEntreprise() {
    const noms = tfCentres().map((c) => c.nom);
    if (noms.length === 1) return 'Pour tous vos centres';
    if (noms.length === 2) return `Pour ${noms[0]} et ${noms[1]}`;
    return `Pour vos ${noms.length} centres`;
  }
  // Les roles de l entreprise ne sont envoyes qu a qui gere l equipe
  // (api/staff-auth.js) : sans eux, on nomme le droit et ses roles par defaut
  // (lib/staff-auth.js STAFF_ROLE_PRESETS), jamais une liste devinee.
  function tfRolesAvec(droit) {
    const acces = typeof state !== 'undefined' && state ? state.staffAccessControl : null;
    const roles = acces && Array.isArray(acces.roles)
      ? acces.roles.filter((r) => r && r.id && !(typeof isPlatformStaffRole === 'function' && isPlatformStaffRole(r)))
      : [];
    if (!roles.length) return null;
    return roles.filter((r) => r.locked === true || (Array.isArray(r.permissions) && r.permissions.includes(droit))).map((r) => String(r.name || r.id));
  }
  function tfQui(droit) {
    const d = TF_DROITS[droit];
    const roles = tfRolesAvec(droit);
    return roles && roles.length ? `${tfEt(roles)} (${d.mot})` : `les rôles qui ont le ${d.mot}, par défaut ${d.defaut}`;
  }
  const tfPeutTarifs = () => typeof canUseStaffPermission !== 'function' || canUseStaffPermission('pricing.manage');

  // ---- LE CATALOGUE PUBLIC DU CENTRE (ce que lit le formulaire client) ------
  // public-booking-meta porte ce que clientCatalog n a pas : le minimum releve
  // par le laser, les offres enfants, les cartes Arcades, les grilles, la
  // capacite des pistes, la case de l offre dans Etablissement.
  const tfMeta = { centre: '', etat: 'vide', donnees: null, ticket: 0 };
  function tfChargerMeta(force) {
    const centre = tfCentre();
    if (!centre || centre === 'all' || typeof apiRequest !== 'function') return;
    if (!force && tfMeta.centre === centre && tfMeta.etat !== 'vide') return;
    const ticket = (tfMeta.ticket += 1);
    if (tfMeta.centre !== centre) tfMeta.donnees = null;
    tfMeta.centre = centre;
    tfMeta.etat = 'charge';
    const url = `${(typeof API_ENDPOINTS !== 'undefined' && API_ENDPOINTS.publicBookingMeta) || '/api/public-booking-meta'}?centerId=${encodeURIComponent(centre)}`;
    apiRequest(url, { method: 'GET' })
      .then((payload) => {
        if (ticket !== tfMeta.ticket) return;
        tfMeta.donnees = payload && typeof payload === 'object' ? payload : null;
        tfMeta.etat = tfMeta.donnees ? 'ok' : 'erreur';
      })
      .catch(() => { if (ticket === tfMeta.ticket) tfMeta.etat = 'erreur'; })
      .finally(() => { if (ticket === tfMeta.ticket) tfRepeindre(); });
  }
  const tfMetaDonnees = () => (tfMeta.centre === tfCentre() ? tfMeta.donnees : null);
  function tfMetaCentre() { const d = tfMetaDonnees(); return d && d.center ? d.center : null; }
  function tfMetaFormules() { const d = tfMetaDonnees(); return d && Array.isArray(d.formules) ? d.formules : null; }
  const tfMetaFormule = (id) => (tfMetaFormules() || []).find((f) => f && f.id === id) || null;
  function tfMetaActivites() { const d = tfMetaDonnees(); return d && Array.isArray(d.activities) ? d.activities : []; }
  const tfMetaActivite = (id) => tfMetaActivites().find((a) => a && a.id === id) || null;
  function tfOffreSuspendue(id) {
    const centre = tfMetaCentre();
    const admin = typeof getAdminCenter === 'function' ? getAdminCenter(tfCentre()) : null;
    const dispo = (centre && centre.offerAvailability) || (admin && admin.offerAvailability) || {};
    return dispo[id] === false;
  }

  // ---- LA DATE DES EXEMPLES ET LES DUREES -----------------------------------
  // Le prochain samedi ou le centre ouvre, sinon son prochain jour d ouverture.
  // Les durees et la touche « Formules » du comptoir se lisent ce jour-la, et
  // la planche le dit (« pour 10 personnes, samedi 7 novembre »).
  function tfDateReference() {
    const aujourdhui = typeof todayStr === 'function' ? todayStr() : new Date().toISOString().slice(0, 10);
    const [a, m, j] = String(aujourdhui).split('-').map(Number);
    const regulier = pricingEditor.centerOpenDays && Array.isArray(pricingEditor.centerOpenDays.regular) ? pricingEditor.centerOpenDays.regular.map(Number) : [];
    const ouvre = (d) => !regulier.length || regulier.includes(d.getUTCDay());
    const jour = (k) => new Date(Date.UTC(a, m - 1, j + k));
    for (let k = 1; k <= 7; k += 1) { const d = jour(k); if (d.getUTCDay() === 6 && ouvre(d)) return d.toISOString().slice(0, 10); }
    for (let k = 1; k <= 7; k += 1) { const d = jour(k); if (ouvre(d)) return d.toISOString().slice(0, 10); }
    return jour(1).toISOString().slice(0, 10);
  }
  function tfDateLisible(iso) {
    const [a, m, j] = String(iso).split('-').map(Number);
    const d = new Date(Date.UTC(a, m - 1, j));
    return `${TF_JOURS_SEM[d.getUTCDay()]} ${j} ${TF_MOIS[m - 1]}`;
  }
  // La duree sur place de chaque formule : la mesure du SERVEUR pour ce jour
  // et ce groupe (api/public-availability.js, type=durees), comme la carte du
  // formulaire. Sans reponse, la ligne s efface : rien n est devine.
  // `perime` : un rechargement du catalogue demande une relecture, mais les
  // durees deja lues restent a l ecran jusqu a la reponse.
  const tfDurees = { cle: '', etat: 'vide', valeurs: {}, ticket: 0, perime: false };
  const tfCleDurees = () => `${tfCentre()}|${tfDateReference()}|${tarifs.groupe}`;
  function tfChargerDurees() {
    const centre = tfCentre();
    if (!centre || centre === 'all' || typeof apiRequest !== 'function') return;
    const cle = tfCleDurees();
    if (tfDurees.cle === cle && !tfDurees.perime) return;
    const ticket = (tfDurees.ticket += 1);
    if (tfDurees.cle !== cle) { tfDurees.valeurs = {}; tfDurees.etat = 'charge'; }
    tfDurees.cle = cle;
    tfDurees.perime = false;
    const base = (typeof API_ENDPOINTS !== 'undefined' && API_ENDPOINTS.publicAvailability) || '/api/public-availability';
    apiRequest(`${base}?centerId=${encodeURIComponent(centre)}&date=${encodeURIComponent(tfDateReference())}&pax=${encodeURIComponent(tarifs.groupe)}&type=durees`, { method: 'GET' })
      .then((payload) => {
        if (ticket !== tfDurees.ticket) return;
        tfDurees.valeurs = payload && payload.durees && typeof payload.durees === 'object' ? payload.durees : {};
        tfDurees.etat = 'ok';
      })
      .catch(() => { if (ticket !== tfDurees.ticket) return; tfDurees.valeurs = {}; tfDurees.etat = 'erreur'; })
      .finally(() => { if (ticket === tfDurees.ticket) tfPoserDurees(); });
  }
  function tfDureeDe(id) {
    if (tfDurees.cle !== tfCleDurees() || tfDurees.etat !== 'ok') return '';
    return tfDurees.valeurs[id] ? texteDuree(tfDurees.valeurs[id]) : '';
  }
  function tfPoserDurees() {
    const valeurs = tfValeursCourantes();
    const planche = tfPlanche();
    if (!valeurs || !planche) return;
    planche.querySelectorAll('[data-tf-lieu="formulaire"]').forEach((el) => tfAppliquer(el, valeurs, false));
    tfDessiner();
  }

  // ---- LE BROUILLON, PAR CENTRE ----------------------------------------------
  function tfLot(creer) {
    const centre = tfCentre();
    if (!tarifs.brouillons[centre] && creer) tarifs.brouillons[centre] = { formules: {}, activites: {}, grilles: {} };
    return tarifs.brouillons[centre] || null;
  }
  const tfBrouillonFormule = (id) => { const lot = tfLot(false); return (lot && lot.formules[id]) || null; };
  const tfBrouillonActivite = (id) => { const lot = tfLot(false); return (lot && lot.activites[id]) || null; };
  function tfNbChangements(lot = tfLot(false)) {
    if (!lot) return 0;
    const compter = (groupe) => Object.values(groupe).reduce((n, b) => n + Object.keys(b).length, 0);
    return compter(lot.formules) + compter(lot.activites) + Object.keys(lot.grilles).length;
  }
  const tfCleSaisie = (type, id, champ) => `${tfCentre()}|${type}|${id}|${champ}`;
  function tfOublierSaisies(type, id) {
    const debut = `${tfCentre()}|${type}|${id}|`;
    Object.keys(tarifs.saisies).forEach((cle) => { if (cle.startsWith(debut)) delete tarifs.saisies[cle]; });
  }
  // « 28 », « 28,50 », « 28.5 € » : la saisie a la belge. null = vide,
  // NaN = illisible ou hors des bornes du serveur (0 a 1000 €).
  function tfLireNombre(brut) {
    if (typeof brut === 'number') return Number.isFinite(brut) && brut >= PEV_PRICE_MIN && brut <= PEV_PRICE_MAX ? Math.round(brut * 100) / 100 : NaN;
    const t = String(brut == null ? '' : brut).replace(/[\s  €]/g, '').replace(',', '.');
    if (t === '') return null;
    if (!/^\d+(\.\d{0,2})?$/.test(t)) return NaN;
    const n = Number(t);
    return n >= PEV_PRICE_MIN && n <= PEV_PRICE_MAX ? Math.round(n * 100) / 100 : NaN;
  }
  const tfSaisieNombre = (v) => (v == null || v === '' ? '' : Number.isInteger(Number(v)) ? String(v) : Number(v).toFixed(2).replace('.', ','));
  function tfSaisieValide(type, champ, brut) {
    if (champ === 'nom') return String(brut == null ? '' : brut).replace(/\s+/g, ' ').trim().length > 0;
    const n = tfLireNombre(brut);
    if (Number.isNaN(n)) return false;
    // Une case de grille n est jamais vide ni a zero : le serveur la refuserait
    // (lib/booking-config prixDeGrille).
    if (type === 'grille') return n != null && n > 0;
    return !(type === 'formule' && champ === 'prix' && n == null);
  }
  function tfSaisie(type, id, champ, propre) {
    const cle = tfCleSaisie(type, id, champ);
    if (!Object.prototype.hasOwnProperty.call(tarifs.saisies, cle)) return { texte: propre == null ? '' : String(propre), invalide: false };
    const texte = tarifs.saisies[cle];
    return { texte, invalide: !tfSaisieValide(type, champ, texte) };
  }
  // Ce qui est publie pour CE centre (clientCatalog, entry.effective). Un prix
  // barre a 0 n existe pas : c est ce que la publication envoie pour l enlever.
  function tfPublieFormule(entry) {
    const eff = (entry && entry.effective) || {};
    return {
      prix: eff.priceValue != null && Number.isFinite(Number(eff.priceValue)) ? Number(eff.priceValue) : null,
      ancien: Number(eff.priceOld) > 0 ? Number(eff.priceOld) : null,
      nom: eff.name != null ? String(eff.name) : String((entry && (entry.name || entry.id)) || ''),
      vente: eff.enabled !== false && !eff.removed,
      validation: TF_VALIDATIONS.some((x) => x.mode === eff.humanValidation) ? eff.humanValidation : 'recommended',
    };
  }
  function tfMeme(champ, a, b) {
    if (champ === 'nom') return String(a == null ? '' : a).trim() === String(b == null ? '' : b).trim();
    return (a == null ? null : a) === (b == null ? null : b);
  }
  function tfPoserFormule(id, champ, valeur) {
    const entry = pevEntry(id);
    if (!entry) return false;
    let v = valeur;
    if (champ === 'ancien') v = Number(v) > 0 ? Number(v) : null;
    const publie = tfPublieFormule(entry);
    const lot = tfLot(true);
    const b = { ...(lot.formules[id] || {}) };
    if (tfMeme(champ, v, publie[champ])) delete b[champ]; else b[champ] = v;
    if (Object.keys(b).length) lot.formules[id] = b; else delete lot.formules[id];
    tarifs.erreur = '';
    return true;
  }
  const tfActiviteEntree = (id) => (pricingEditor.activities || []).find((a) => a && String(a.id) === String(id)) || null;
  function tfPublieActivite(entry) {
    return entry && entry.priceValue != null && Number.isFinite(Number(entry.priceValue)) ? Number(entry.priceValue) : null;
  }
  function tfPoserActivite(id, valeur) {
    const entry = tfActiviteEntree(id);
    if (!entry) return false;
    const lot = tfLot(true);
    const b = { ...(lot.activites[id] || {}) };
    if (tfMeme('prix', valeur, tfPublieActivite(entry))) delete b.prix; else b.prix = valeur;
    if (Object.keys(b).length) lot.activites[id] = b; else delete lot.activites[id];
    tarifs.erreur = '';
    return true;
  }

  // ---- UNE FORMULE TELLE QUE LA PAGE LA MONTRE --------------------------------
  function tfPlageHeures(entry) {
    const min = entry && entry.timeLimitMinMinutes != null ? Number(entry.timeLimitMinMinutes) / 60 : null;
    const max = entry && entry.timeLimitMaxMinutes != null ? Number(entry.timeLimitMaxMinutes) / 60 : null;
    if (min == null && max == null) return null;
    return { ...(min != null ? { min } : {}), ...(max != null ? { max } : {}) };
  }
  // `sans` : la meme vue SANS l un des champs du brouillon (l « avant » d un
  // changement, pour le recapitulatif).
  function tfVueFormule(entry, sans = '') {
    const id = String(entry.id);
    const meta = tfMetaFormule(id);
    const publie = tfPublieFormule(entry);
    const brouillon = tfBrouillonFormule(id) || {};
    const b = { ...brouillon };
    if (sans) delete b[sans];
    const famille = String(entry.bookingFamily || entry.family || 'Formules');
    // L objet que lit le formulaire client (public-booking-meta) ; a defaut
    // (formule pas en vente, donc absente du catalogue public), le catalogue
    // de la console au meme format, sans le minimum releve par le laser.
    const client = meta || {
      id,
      minPax: Math.max(1, Number(entry.minPax) || 1),
      validDays: Array.isArray(entry.validDays) && entry.validDays.length ? entry.validDays.map(Number) : null,
      timeLimit: tfPlageHeures(entry),
      noHolidays: entry.noHolidays === true,
    };
    return {
      id,
      entry,
      meta,
      client,
      // Hors des 14 ids du socle, le serveur refuse tout reglage de centre
      // (catalog-overrides.js assertFormuleId) : clientCatalog le dit par
      // source 'custom', calcule sur la meme liste (catalog-overrides.js:589).
      custom: entry.source === 'custom',
      // Gardee au comptoir (lib/formule-comptoir.js) : elle n existe que pour ce centre, et
      // seuls les clients d une formule affichee la voient.
      comptoir: /^sm-.+--/.test(id),
      comptoirSeul: /^sm-.+--/.test(id) && entry.effective && entry.effective.humanValidation === 'comptoir',
      famille,
      anniversaire: /anniv/i.test(famille),
      parPiste: entry.priceType === 'per_lane',
      enfants: meta && meta.kidsOnly && typeof meta.kidsOnly === 'object' ? meta.kidsOnly : null,
      minPax: Math.max(1, Number(client.minPax) || 1),
      desc: Array.isArray(entry.desc) ? entry.desc.map(String) : [],
      regles: reglesFormule(client),
      best: entry.best === true,
      hasBowling: entry.hasBowling === true,
      suspendue: tfOffreSuspendue(id),
      publie,
      valeur: { ...publie, ...b },
      modifie: Object.keys(brouillon).length > 0,
    };
  }
  // Les pistes d une formule a la piste : la regle du serveur
  // (lib/booking-config.js getRequiredLaneCount), sur la capacite du centre.
  function tfPistes(pax, f) {
    if (!f.hasBowling) return 0;
    const centre = tfMetaCentre();
    const reglage = (centre && centre.booking) || {};
    const lu = (cle, repli) => { const v = Number(reglage[cle]); return Number.isFinite(v) && v > 0 ? v : repli; };
    const parc = lu('laneCount', typeof getTotalLanes === 'function' ? getTotalLanes() : NaN);
    const confort = lu('normalCapacityPerLane', typeof getMaxPerLane === 'function' ? getMaxPerLane() : NaN);
    const secours = lu('emergencyCapacityPerLane', typeof getEmergencyMaxPerLane === 'function' ? getEmergencyMaxPerLane() : NaN);
    if (!(parc > 0) || !(confort > 0) || !(secours > 0)) return null;
    const joueurs = Number(pax) || 1;
    const normal = Math.ceil(joueurs / confort);
    return normal > parc && joueurs <= parc * secours ? parc : normal;
  }
  // Le nom du comptoir (app-main.js rvNomFormule) et du planning (gpFormule).
  function tfNomComptoir(nom) {
    const n = String(nom || 'Formule');
    return n === n.toUpperCase() && /[A-ZÀ-Ý]{3}/.test(n) ? n.charAt(0) + n.slice(1).toLowerCase() : n;
  }
  function tfNomPlanning(nom) {
    let n = String(nom || 'Formule').trim();
    const numero = /^formule\s*(\d+)$/i.exec(n);
    if (n === n.toUpperCase()) n = n.toLowerCase().replace(/(^|[\s/])(\p{L})/gu, (x, a, b) => a + b.toUpperCase());
    return numero ? `F${numero[1]}` : n;
  }
  // La touche « Formules » de Reserver (app-main.js rsPortesConstruire et
  // rsFormulesDuJour) : les formules valables ce jour pour ce groupe, et leur
  // fourchette. Le brouillon du centre s y applique.
  function tfPorteFormules() {
    const lot = tfLot(false);
    const brouillons = (lot && lot.formules) || {};
    const servies = tfMetaFormules();
    const vives = pevFormulesVives();
    const liste = servies ? servies.map((f) => ({ ...f })) : vives.filter((f) => f.enabled !== false && !f.removed).map((f) => ({ ...f }));
    Object.entries(brouillons).forEach(([id, b]) => {
      const i = liste.findIndex((f) => f.id === id);
      if ('vente' in b && !b.vente) { if (i >= 0) liste.splice(i, 1); return; }
      if ('vente' in b && b.vente && i < 0) { const vive = vives.find((f) => f.id === id); if (vive) liste.push({ ...vive }); }
      const f = liste.find((x) => x.id === id);
      if (f && 'prix' in b) f.price = b.prix;
    });
    const date = tfDateReference();
    const n = tarifs.groupe;
    const valables = liste.filter((f) => {
      let ok = true;
      if (typeof getFormuleAvailability === 'function') {
        try { ok = Boolean(getFormuleAvailability(f, date, n, '').ok); } catch (e) { ok = true; }
      }
      return ok || n < (Number(f.minPax) || 1);
    });
    if (!valables.length) return 'Aucune ce jour-là';
    const prix = valables.map((f) => Number(f.price)).filter(Number.isFinite);
    const parJoueur = valables.every((f) => f.type !== 'per_lane');
    return `${tfPluriel(valables.length, 'formule')}${prix.length ? `, de ${tfEurosConsole(Math.min(...prix))} à ${tfEurosConsole(Math.max(...prix))}` : ''}${parJoueur ? ' par joueur' : ''}`;
  }
  // Ce que chaque endroit montre de la formule, pour le groupe d exemple.
  function tfValeursFormule(f) {
    const n = tarifs.groupe;
    const v = f.valeur;
    const prix = v.prix == null ? null : Number(v.prix);
    const enfants = f.enfants;
    const remise = !f.anniversaire && Number(prix) > 0 && Number(v.ancien) > Number(prix) ? Math.round((1 - Number(prix) / Number(v.ancien)) * 100) : 0;
    // La bande du bas de la carte (htmlInfoFormule, fungalaxy-booking.js:718) :
    // le montant du groupe, sinon ce qui ne se lit nulle part avant les heures.
    const totalGroupe = !f.parPiste && !enfants && Number(prix) > 0 && n >= Math.max(1, f.minPax) ? Math.round(Number(prix) * n * 100) / 100 : null;
    const jours = f.client.validDays && f.client.validDays.length && f.client.validDays.length < 7 ? joursLisibles(f.client.validDays) : '';
    let bref = f.minPax > 1 ? `Dès ${f.minPax}${enfants ? ' enfants' : ' personnes'}`
      : enfants ? `${enfants.ageMin} à ${enfants.ageMax} ans`
        : ([jours, plageLisible(f.client.timeLimit)].filter(Boolean).join(' · ') || 'Voir les conditions');
    const illimite = f.desc.find((d) => /^toutes les activit[eé]s illimit[eé]es$/i.test(String(d).trim())) || '';
    if (illimite) bref = `${illimite} · ${bref}`;
    // Le prix que le SERVEUR retient (getBasePrice) : par personne, ou par
    // piste ; le prix public et celui des mails est arrondi a l euro
    // (lib/reservation-request.js estimatePublicPrice).
    const pistes = f.parPiste ? tfPistes(n, f) : 0;
    const base = prix == null || pistes == null ? null : (f.parPiste ? prix * pistes : prix * n);
    const publicArrondi = base == null ? null : Math.max(0, Math.round(base));
    const confirme = v.validation !== 'required';
    return {
      nom: v.nom,
      prix: prix == null ? 'Prix à l’accueil' : tfEuros(prix),
      unite: f.parPiste ? 'la piste' : enfants ? 'par enfant' : 'par personne',
      ancien: v.ancien ? tfEuros(v.ancien) : '',
      remise: remise >= 5 ? `-${remise} %` : '',
      duree: tfDureeDe(f.id),
      bandeTotale: totalGroupe != null,
      bandeAvant: illimite ? `${illimite} · ` : '',
      bandeTotal: totalGroupe != null ? tfEuros(totalGroupe) : '',
      bandePour: `pour ${tfPluriel(n, 'personne')}`,
      bref,
      vente: Boolean(v.vente),
      retiree: !v.vente || Boolean(f.comptoirSeul),
      confirme,
      demande: !confirme,
      laser: v.validation === 'required_when_laser_busy',
      finTitre: confirme ? 'Réservation confirmée' : 'Demande envoyée',
      finTexte: confirme ? 'C’est réservé : on vous attend !' : 'L’équipe vérifie votre demande et vous répond sous 24 heures ouvrables.',
      finMontant: publicArrondi > 0 ? `Montant indicatif ${tfEuros(publicArrondi)}` : 'Tout se règle sur place',
      mailObjet: confirme ? 'Réservation confirmée' : 'Demande reçue',
      mailMontant: publicArrondi != null ? tfEurosMail(publicArrondi) : 'Sur place',
      plage: tfPorteFormules(),
      ticketNom: tfNomComptoir(v.nom),
      joueurs: tfPluriel(n, 'joueur'),
      ticketTotal: base != null ? tfEurosConsole(base) : 'sur place',
      dossier: v.validation === 'required' ? 'À vérifier' : 'Confirmé',
      badge: v.validation === 'required' ? 'À vérifier' : 'Confirmée',
      aVerifier: v.validation === 'required',
      court: tfNomPlanning(v.nom),
    };
  }

  // ---- OU VA CHAQUE REGLAGE ---------------------------------------------------
  // Un fil = un effet verifie dans le code (carte des effets du 03/11). Le prix
  // n arrive aux mails que si la reservation est confirmee : le mail « demande
  // reçue » ne porte pas de montant (lib/ops-communications.js).
  function tfLieuxFormule() {
    return ['formulaire', 'fin', 'mails', 'comptoir', 'planning', ...(tfAutresCentres().length ? ['autres'] : [])];
  }
  function tfLieuxDe(champ, f) {
    const v = f.valeur;
    switch (champ) {
      case 'prix': return ['formulaire', 'fin', v.validation !== 'required' ? 'mails' : '', 'comptoir'].filter(Boolean);
      case 'ancien': return ['formulaire'];
      case 'nom': return ['formulaire', 'fin', 'mails', 'comptoir', 'planning'];
      case 'vente': return ['formulaire', 'comptoir'];
      case 'validation': return ['fin', 'mails', 'comptoir', 'planning'];
      case 'structure': return ['formulaire', 'comptoir', 'planning', ...(tfAutresCentres().length ? ['autres'] : [])];
      default: return [];
    }
  }
  function tfPhrase(champ, lieu, f) {
    const autres = tfEt(tfAutresCentres());
    const regles = f && f.regles && f.regles.length ? ` et les pastilles ${f.regles.map((r) => `« ${r} »`).join(', ')}` : '';
    const textes = {
      prix: {
        formulaire: 'Le prix sur la carte, le total pour le groupe, et l’écart proposé dans « Envie d’un peu plus ? ».',
        fin: 'Le montant indicatif de l’écran de fin.',
        mails: 'Le montant estimé du mail « réservation confirmée ».',
        comptoir: 'Le prix de la formule et le total du ticket dans Réserver.',
      },
      ancien: { formulaire: 'Barré à côté du prix. Sur une offre spéciale, le client lit aussi la remise « -N % », dès 5 %.' },
      nom: {
        formulaire: 'Le titre de la carte et le récapitulatif.',
        fin: 'La ligne « Au programme » de l’écran de fin.',
        mails: 'La ligne « Offre » des mails des prochaines réservations.',
        comptoir: 'La carte de la formule et le ticket dans Réserver.',
        planning: 'Les cartes du planning, la liste et la fiche, y compris les réservations déjà prises.',
      },
      vente: {
        formulaire: `Coupée, la formule disparaît du formulaire de ${tfNomCentre()}. Un client qui l’avait choisie la perd au rafraîchissement.`,
        comptoir: 'Elle n’est plus proposée dans Réserver.',
      },
      validation: {
        fin: '« Réservation confirmée » ou « Demande envoyée, l’équipe vérifie sous 24 heures ouvrables ».',
        mails: 'Mail « réservation confirmée » (avec rappel 48 h) ou « demande reçue », et un mail à l’équipe.',
        comptoir: 'Au comptoir, seul « Toujours » fait partir le dossier « à vérifier ».',
        planning: 'Le dossier arrive « À vérifier » sur le planning, la liste et la fiche, avec le bouton Valider.',
      },
      structure: {
        formulaire: `La durée sur place, les heures d’arrivée proposées${regles}.`,
        comptoir: 'La formule grisée avec sa raison. « Créer quand même » reste possible selon le rôle.',
        planning: 'Ce que le planning réserve : pistes, arène, table.',
        autres: `${autres} aussi : le contenu appartient à l’entreprise.`,
      },
    };
    return (textes[champ] && textes[champ][lieu]) || '';
  }
  function tfPasConcerneAutres() {
    const autres = tfAutresCentres();
    return autres.length > 1
      ? `Pas concerné : ${tfEt(autres)} gardent leurs propres prix, noms et mises en vente.`
      : `Pas concerné : ${autres[0]} garde ses propres prix, nom et mise en vente.`;
  }
  // Le pied de planche du champ en main : ce qu il ne touche pas, le piege,
  // qui peut le changer, quand ca arrive chez le client.
  function tfPied(champ, f) {
    const autres = tfAutresCentres();
    const duCentre = TF_CHAMPS.includes(champ);
    const pas = {
      prix: 'Les réservations déjà prises gardent leur prix. Si l’équipe change ensuite leur contenu (joueurs, activités), elles passent au nouveau prix.',
      ancien: 'Le total, le comptoir et les mails ne le montrent pas.',
      nom: 'Les mails déjà envoyés. Le Terrain garde le nom du jour de la réservation.',
      vente: `Les réservations déjà prises restent.${autres.length ? ` ${tfEt(autres)} ${autres.length > 1 ? 'gardent la leur' : 'garde la sienne'}.` : ''}`,
      validation: 'Le prix et ce que voit le client avant de valider.',
      structure: f && f.comptoir ? 'Les réservations déjà prises gardent leur prix.' : 'Le prix, le prix barré, le nom et la mise en vente de chaque centre.',
    }[champ] || '';
    let savoir = '';
    if (champ === 'prix') savoir = 'À 0 €, la formule ne se réserve plus en ligne.';
    if (champ === 'ancien') savoir = 'La remise « -N % » ne s’affiche que sur les offres spéciales, à partir de 5 %.';
    if (champ === 'vente') {
      savoir = f && f.suspendue
        ? 'Suspendue dans Établissement : vos clients voient la carte grisée « momentanément suspendue ».'
        : 'La case de l’offre dans Établissement, elle, laisse la carte visible mais grisée « momentanément suspendue ».';
    }
    if (champ === 'structure' && f) {
      const pieges = [];
      if (!f.custom) pieges.push('Pour une formule d’origine, la liste lue par le client ne suit pas le contenu : c’est sa description qui s’affiche.');
      if (f.meta && f.meta.minPaxLaser === true) pieges.push(`Avec son laser, elle se réserve à ${Number(f.meta.minPax)} au moins, même réglée plus bas.`);
      savoir = pieges.join(' ');
    }
    return {
      pas,
      savoir,
      qui: f && f.comptoir && !duCentre ? `${tfMajuscule(tfQui('pricing.manage'))} ; le contenu : ${tfQui('settings.manage')}.` : `${tfMajuscule(tfQui(duCentre ? 'pricing.manage' : 'settings.manage'))}.`,
      quand: duCentre ? TF_QUAND : `Dès l’enregistrement de la fenêtre, pour ${f && f.comptoir ? 'ce centre' : 'tous vos centres'}.`,
    };
  }

  // ---- LES GRILLES DU CENTRE : BOWLING, LASER, FUN RUN ---------------------------
  // Chaque prix est une CASE. Elle se regle dans la planche de l activite, pour CE
  // centre (droit Tarifs), et part a « Publier » avec le reste du brouillon, en une
  // seule ecriture (saveGrillesTarif). Son champ se lit `grille:<nom>:<cle>`. Le prix
  // publie est celui du catalogue public du centre : ce que lit le formulaire et ce
  // que le serveur facture (lib/booking-config grillesDuCentre).
  const tfEstCase = (champ) => String(champ || '').startsWith('grille:');
  const tfLireCase = (champ) => { const [, nom, cle] = String(champ).split(':'); return { nom, cle }; };
  // Le tarif A LA PARTIE d un centre qui vend ainsi (N4) : ses paliers par jours,
  // jamais la grille par piste (meme lecture que getPricingRows et
  // lib/booking-config.resolveBowlingPricing).
  function tfTarifParties() {
    const valide = (p) => (p && p.mode === 'per_game_per_person' && Array.isArray(p.tiers) && p.tiers.length ? p : null);
    const centre = tfMetaCentre();
    const ressource = typeof getAdminCenter === 'function' ? ((getAdminCenter() || {}).resources || {}).bowling : null;
    return valide(centre && centre.booking && centre.booking.bowlingPricing)
      || valide(ressource && ressource.pricing)
      || (typeof getBowlingPricing === 'function' ? getBowlingPricing() : null);
  }
  // Le mode aux parties ne vaut que pour le bowling du centre : son duckpin reste a
  // la piste, comme le serveur le chiffre (lib/visit-program, bowlingConfig null).
  function tfNomGrille(priceType, id, entry) {
    if (priceType === 'grid_laser') return 'laser';
    if (priceType === 'grid_fun_run') return 'funRun';
    if (priceType !== 'grid_bowling' && id !== 'bowling' && !(entry && entry.resourceType === 'bowling')) return '';
    return id === 'bowling' && tfTarifParties() ? 'parties' : 'bowling';
  }
  function tfCasesDeGrille(nom) {
    const d = tfMetaDonnees() || {};
    const lot = tfLot(false);
    const poses = (lot && lot.grilles) || {};
    const kase = (cle, label, publie, unite, plus = {}) => {
      const pose = poses[`${nom}:${cle}`];
      const p = Number(publie) || 0;
      return { grille: nom, cle, champ: `grille:${nom}:${cle}`, label, long: label, publie: p, prix: pose === undefined ? p : pose, modifie: pose !== undefined, unite, ...plus };
    };
    if (nom === 'parties') {
      const tarif = tfTarifParties();
      const cases = [];
      ((tarif && tarif.tiers) || []).forEach((tier, t) => {
        const jours = typeof describePricingDays === 'function' ? describePricingDays(tier.days) : '';
        (tier.prices || []).forEach((prix, i) => {
          const label = `${i + 1} partie${i ? 's' : ''}`;
          cases.push(kase(`${t}-${i}`, label, prix, '/ personne', { groupe: jours, long: `${label}${jours ? ` (${jours})` : ''}` }));
        });
      });
      return cases;
    }
    if (nom === 'bowling') return (d.durationOptions || []).map((o) => kase(String(Number(o.value)), o.label, o.price, '/ piste'));
    if (nom === 'laser') return (d.laserOptions || []).map((o) => kase(String(Number(o.games)), o.label, o.price, '/ personne'));
    if (nom === 'funRun') return (d.funRunOptions || []).map((o) => kase(String(Number(o.minutes)), o.label, o.price, '/ session'));
    return [];
  }
  const tfOptionsGrille = (a) => (a.nomGrille ? tfCasesDeGrille(a.nomGrille) : []);
  const tfUniteCase = (kase) => ({ '/ piste': 'la piste', '/ session': 'la session' }[kase.unite] || 'par personne');
  function tfPoserCase(champ, valeur) {
    const { nom, cle } = tfLireCase(champ);
    const kase = tfCasesDeGrille(nom).find((c) => c.cle === cle);
    if (!kase) return false;
    const lot = tfLot(true);
    if (tfMeme('prix', valeur, kase.publie)) delete lot.grilles[`${nom}:${cle}`]; else lot.grilles[`${nom}:${cle}`] = valeur;
    tarifs.erreur = '';
    return true;
  }
  // Ce que le groupe d exemple paie pour une case : la regle du serveur
  // (lib/visit-program normalizeProgram), par les fonctions du comptoir.
  function tfMontantCase(a, kase, prix) {
    const n = tarifs.groupe;
    let quantite = n;
    let mot = 'joueur';
    if (a.nomGrille === 'bowling') {
      mot = 'piste';
      quantite = a.id === 'bowling'
        ? splitGroupIntoBowlingServices(n).reduce((total, joueurs) => total + Math.max(1, getRequiredLaneCount('bowling', joueurs, '')), 0)
        : getActivityUnitPlan(a.meta || a.entry, n).units;
    } else if (a.nomGrille === 'funRun') {
      mot = 'session';
      quantite = getActivitySessionCount(a.meta || a.entry, n);
    }
    return { quantite: tfPluriel(quantite, mot), total: Math.round(Number(prix) * quantite * 100) / 100 };
  }
  // La ligne « Offre » du mail (lib/visit-program describeProgram), la ligne du
  // ticket de Reserver (app-main.js estimerPrixProgramme).
  function tfOffreCase(a, kase) {
    if (a.id === 'bowling' && a.nomGrille === 'bowling') return `Bowling ${typeof formatDurationLabel === 'function' ? formatDurationLabel(Number(kase.cle)) : kase.label}`;
    if (a.nomGrille === 'laser') return `Laser ${kase.label}`;
    return a.nomGrille === 'parties' ? `${a.nom} ${kase.label}` : a.nom;
  }
  // Le prix de la meme case chez les autres centres de l entreprise : ils gardent
  // le leur, et la planche le montre.
  function tfPrixChezAutres(kase) {
    const tous = typeof getAdminCenters === 'function' ? (getAdminCenters() || []).filter(Boolean) : [];
    const depart = { bowling: DURATION_OPTIONS.find((o) => String(o.value) === kase.cle), laser: LASER_GAME_OPTIONS.find((o) => String(o.games) === kase.cle), funRun: FUN_RUN_OPTIONS.find((o) => String(o.minutes) === kase.cle) }[kase.grille];
    return tfCentres().slice(1).map((c) => {
      const centre = tous.find((x) => x.id === c.id) || {};
      const pose = Number(centre.grillesTarif && centre.grillesTarif[kase.grille] && centre.grillesTarif[kase.grille][kase.cle]);
      const prix = pose > 0 ? pose : depart ? depart.price : null;
      return prix == null ? `ses prix à ${c.nom}` : `${tfEuros(prix)} à ${c.nom}`;
    }).join(', ');
  }
  // Les prix publies sur la ligne. Un tarif par palier de jours (N4) se lit palier par
  // palier : repeter les jours a chaque partie coupait la ligne avant la fin.
  function tfDetailCases(cases) {
    if (!cases.some((c) => c.groupe)) return cases.map((c) => `${c.long} ${tfEuros(c.publie)}`).join(' · ');
    return [...new Set(cases.map((c) => c.groupe))].map((jours) => `${jours} : ${cases.filter((c) => c.groupe === jours).map((c) => `${c.label} ${tfEuros(c.publie)}`).join(', ')}`).join(' · ');
  }
  const tfDesCases = (cases) => (cases.length ? `Dès ${tfEuros(Math.min(...cases.map((c) => c.prix)))} ${cases[0].unite}` : '…');
  // `remplace` : la meme grille avec un autre prix sur une case (l avant d un
  // changement, pour le recapitulatif).
  function tfValeursGrille(a, remplace = null) {
    const cases = tfOptionsGrille(a).map((c) => (remplace && remplace.champ === c.champ ? { ...c, prix: remplace.prix } : c));
    const n = tarifs.groupe;
    const base = { des: tfDesCases(cases), tuileNom: tfNomTuile(a.nom), pour: tfPluriel(n, 'joueur') };
    const kase = cases.find((c) => c.champ === (remplace ? remplace.champ : tarifs.caseExemple))
      || cases.find((c) => c.grille === 'bowling' && c.cle === '1') || cases[0];
    if (!kase) return base;
    const m = tfMontantCase(a, kase, kase.prix);
    cases.forEach((c) => { base[`opt:${c.champ}`] = tfEuros(c.prix); });
    return {
      ...base,
      exempleQuoi: `${kase.long} · ${m.quantite} × ${tfEuros(kase.prix)}`,
      exempleTotal: tfEuros(m.total),
      finMontant: `Montant indicatif ${tfEuros(m.total)}`,
      offre: tfOffreCase(a, kase),
      mailMontant: tfEurosMail(m.total),
      ticketDetail: m.quantite,
      ticketTotal: tfEurosConsole(m.total),
      autres: tfAutresCentres().length ? `${kase.long} : ${tfPrixChezAutres(kase)}` : '',
    };
  }
  const tfLieuxGrille = () => ['formulaire', 'fin', 'mails', 'comptoir'];
  function tfPhraseGrille(lieu) {
    if (lieu === 'formulaire') return 'Le prix sur la carte de l’activité, le « Dès … » s’il devient le plus bas, et le total du groupe.';
    if (lieu === 'fin') return 'Le montant indicatif de l’écran de fin.';
    if (lieu === 'mails') return 'Le montant estimé du mail « réservation confirmée ».';
    return 'Le montant de la ligne et le total du ticket dans Réserver.';
  }
  function tfPasConcerneGrille() {
    const autres = tfAutresCentres();
    return autres.length > 1 ? `Pas concerné : ${tfEt(autres)} gardent leurs propres prix.` : `Pas concerné : ${autres[0]} garde son propre prix.`;
  }
  // Dans chaque endroit, ce que la case en main change vraiment.
  function tfVisesCase(champ, a) {
    const cases = tfOptionsGrille(a);
    const kase = cases.find((c) => c.champ === champ);
    const leMoinsCher = kase && kase.prix === Math.min(...cases.map((c) => c.prix));
    return [`opt:${champ}`, 'exempleQuoi', 'exempleTotal', 'finMontant', 'mailMontant', 'ticketTotal', ...(leMoinsCher ? ['des'] : [])];
  }
  function tfPiedGrille(a) {
    const savoir = {
      bowling: a.id === 'bowling' ? 'Au comptoir, au-delà de 2 heures, le prix part de cette grille : les 2 heures, puis l’heure et la demi-heure en plus.' : '',
      laser: 'Au comptoir, au-delà de 3 parties, le prix part de cette grille : les 3 parties, puis une partie par partie en plus.',
      funRun: 'Un groupe plus grand que l’installation joue et paie plusieurs sessions.',
    }[a.nomGrille] || '';
    return {
      pas: 'Les réservations déjà prises gardent leur prix. Si l’équipe change ensuite leur contenu, elles passent au nouveau prix. Les formules gardent leur propre prix.',
      savoir,
      qui: `${tfMajuscule(tfQui('pricing.manage'))}.`,
      quand: TF_QUAND,
    };
  }
  // Une publication : une seule ecriture pour toutes les cases, le serveur relit
  // et reecrit la ligne du centre d un bloc. Les prix a la partie partent en
  // paliers entiers, chaque palier reste reconnu par ses jours.
  function tfDemandeGrilles(poses) {
    const demande = {};
    const parties = {};
    Object.entries(poses).forEach(([brut, prix]) => {
      const i = brut.indexOf(':');
      const nom = brut.slice(0, i);
      const cle = brut.slice(i + 1);
      if (nom === 'parties') parties[cle] = prix;
      else demande[nom] = { ...(demande[nom] || {}), [cle]: prix };
    });
    if (Object.keys(parties).length) {
      const tarif = tfTarifParties();
      // Seules les cases touchees voyagent : les autres (null) gardent le prix du serveur.
      demande.parties = ((tarif && tarif.tiers) || []).map((tier, t) => ({
        days: tier.days,
        prices: (tier.prices || []).map((prix, i) => (`${t}-${i}` in parties ? parties[`${t}-${i}`] : null)),
      })).filter((palier) => palier.prices.some((prix) => prix !== null));
    }
    return demande;
  }
  // La valeur publiee se pose tout de suite, le rechargement la confirme.
  function tfPoserGrillesPubliees(demande) {
    const d = tfMetaDonnees();
    if (!d) return;
    const poser = (liste, nom, cle) => (liste || []).forEach((o) => {
      const prix = (demande[nom] || {})[String(Number(o[cle]))];
      if (prix !== undefined) o.price = prix;
    });
    poser(d.durationOptions, 'bowling', 'value');
    poser(d.laserOptions, 'laser', 'games');
    poser(d.funRunOptions, 'funRun', 'minutes');
    const tarif = d.center && d.center.booking && d.center.booking.bowlingPricing;
    if (demande.parties && tarif) {
      tarif.tiers = tarif.tiers.map((tier) => {
        const recu = demande.parties.find((palier) => JSON.stringify(palier.days) === JSON.stringify(tier.days));
        return recu ? { ...tier, prices: tier.prices.map((prix, i) => (recu.prices[i] === null ? prix : recu.prices[i])) } : tier;
      });
    }
  }

  // ---- UNE ACTIVITE TELLE QUE LA PAGE LA MONTRE ------------------------------
  function tfVueActivite(entry) {
    const id = String(entry.id);
    const meta = tfMetaActivite(id);
    const b = tfBrouillonActivite(id) || {};
    const publie = tfPublieActivite(entry);
    const priceType = String((meta && meta.priceType) || entry.priceType || '');
    const offres = (meta && meta.arcadeOffers) || entry.arcadeOffers || null;
    const arcades = id === 'arcade_time' && Boolean(offres) && offres.enabled !== false;
    const nomGrille = tfNomGrille(priceType, id, entry);
    const grille = Boolean(nomGrille);
    const seule = entry.bookable === true;
    return {
      id,
      entry,
      meta,
      nom: String(entry.name || (meta && meta.name) || id),
      seule,
      priceType,
      grille,
      nomGrille,
      arcades,
      simple: seule && !arcades && !grille && (priceType === 'per_pax' || priceType === 'per_unit_hour'),
      offres,
      unitLabel: String((meta && meta.unitLabel) || entry.priceUnit || ''),
      note: String((meta && meta.note) || ''),
      ages: meta && typeof meta.ageRange === 'string' ? meta.ageRange : '',
      minPax: Number(meta && meta.minPax) || 0,
      paliers: Boolean(meta && meta.pricing && Array.isArray(meta.pricing.tiers) && meta.pricing.tiers.length),
      publie,
      prix: 'prix' in b ? b.prix : publie,
      modifie: 'prix' in b || (grille && tfCasesDeGrille(nomGrille).some((c) => c.modifie)),
    };
  }
  // Une grille se regle avec le droit Tarifs, pour le centre ; un prix simple avec
  // le droit Reglages, pour l entreprise.
  const tfActiviteReglable = (a) => (a.grille ? a.seule && tfPeutTarifs() && tfOptionsGrille(a).length > 0 : a.simple && cevCanManage());
  function tfActivites() {
    const possedees = Array.isArray(pricingEditor.centerActivityIds) ? pricingEditor.centerActivityIds.map(String) : [];
    const publiques = tfMetaActivites();
    const ordre = new Map(publiques.map((a, i) => [a.id, Number.isFinite(Number(a.order)) ? Number(a.order) : i]));
    return (pricingEditor.activities || [])
      .filter((a) => a && a.id && (possedees.length ? possedees.includes(String(a.id)) : ordre.has(a.id)))
      .map(tfVueActivite)
      .sort((x, y) => (x.seule === y.seule
        ? ((ordre.has(x.id) ? ordre.get(x.id) : 999) - (ordre.has(y.id) ? ordre.get(y.id) : 999)) || x.nom.localeCompare(y.nom, 'fr')
        : x.seule ? -1 : 1));
  }
  function tfCartesArcades(a) {
    const c = a.offres;
    if (!a.arcades || !c) return null;
    const valide = (o) => o && o.enabled !== false && /^[a-z0-9][a-z0-9-]{0,59}$/.test(String(o.id)) && o.price != null && isFinite(Number(o.price)) && Number(o.price) >= 0;
    const temps = (c.timeOffers || []).filter((o) => valide(o) && Number(o.minutes) > 0);
    const credits = (c.creditOffers || []).filter((o) => valide(o) && Number(o.credits) >= 0 && Number(o.bonusCredits || 0) >= 0);
    return temps.length || credits.length ? { temps, credits } : null;
  }
  // Le « Dès … » de la carte d une activite dans le formulaire client, a
  // l identique de prixCarte (fungalaxy-booking.js:1021, carte pas encore
  // choisie), de reglageArcade (839) et d optionsPour (528). `publie` : la ligne
  // garde la valeur publiee, la planche montre le brouillon.
  function tfPrixCarte(a, prix = a.prix, { publie = false } = {}) {
    const cartes = tfCartesArcades(a);
    if (cartes) return `Dès ${tfEuros(Math.min(...cartes.temps.concat(cartes.credits).map((o) => Number(o.price))))} / carte`;
    if (a.grille) return tfDesCases(tfOptionsGrille(a).map((c) => (publie ? { ...c, prix: c.publie } : c)));
    const connu = prix != null && isFinite(Number(prix)) && Number(prix) >= 0;
    const unite = a.unitLabel ? ` ${a.unitLabel.replace(/^par /, '/ ')}` : '';
    if (a.priceType === 'per_pax' || a.priceType === 'per_unit_hour') return connu ? `Dès ${tfEuros(prix)}${unite}` : 'Prix à l’accueil';
    return connu ? `${tfEuros(prix)}${unite}` : 'Prix à l’accueil';
  }
  // Le nom de la touche de Reserver (app-main.js rsNomTuile).
  function tfNomTuile(nom) {
    const mots = String(nom || '').trim().split(/\s+/);
    if (mots.length > 2) return mots.slice(0, 2).join(' ');
    return mots.length === 2 && mots[0].length >= 6 ? mots[0] : mots.join(' ');
  }
  function tfValeursActivite(a) {
    if (a.grille) return tfValeursGrille(a);
    const n = tarifs.groupe;
    const enfant = a.priceType === 'per_pax' && /enfant/i.test(a.unitLabel);
    // La touche de Reserver : le calcul du comptoir (booking-core.js
    // getFreeActivityPrice), le brouillon applique, pour le groupe d exemple.
    let tuile = null;
    if (typeof getFreeActivityPrice === 'function' && (a.simple || a.arcades)) {
      const objet = { ...(a.meta || {}), id: a.id, priceType: a.priceType, priceValue: a.prix, arcadeOffers: a.offres };
      const options = a.arcades && typeof defaultArcadeOptions === 'function' ? defaultArcadeOptions(objet) : {};
      try { tuile = getFreeActivityPrice(objet, { pax: n, dateStr: tfDateReference(), ...options }); } catch (e) { tuile = null; }
    }
    return {
      des: tfPrixCarte(a),
      total: a.priceType === 'per_pax' && a.simple && a.prix != null ? tfEuros(Math.round(Number(a.prix) * n * 100) / 100) : '',
      pour: tfPluriel(n, enfant ? 'enfant' : 'joueur'),
      tuileNom: tfNomTuile(a.nom),
      tuile: tuile != null ? tfEurosConsole(tuile) : 'sur place',
    };
  }
  function tfLieuxActivite(a) {
    if (!a.seule) return [];
    if (a.grille) return [...tfLieuxGrille(), ...(tfAutresCentres().length ? ['autres'] : [])];
    return ['formulaire', 'comptoir', ...(a.simple && tfAutresCentres().length ? ['autres'] : [])];
  }
  function tfPhraseActivite(lieu) {
    if (lieu === 'formulaire') return '« Dès … » sur la carte de l’activité, et le total du groupe. Vide : « Prix à l’accueil ».';
    if (lieu === 'comptoir') return 'La touche de l’activité et le total du ticket dans Réserver.';
    return `${tfEt(tfAutresCentres())} aussi : le prix d’une activité vaut pour toute l’entreprise.`;
  }

  // ---- LE CONTEXTE OUVERT -------------------------------------------------------
  const tfPlanche = () => document.querySelector('#staffPricingPage [data-tf-planche]');
  function tfContexte() {
    const planche = tfPlanche();
    if (!planche) return null;
    const id = planche.getAttribute('data-tf-planche');
    if (planche.getAttribute('data-tf-type') === 'activite') {
      const entree = tfActiviteEntree(id);
      return entree ? { type: 'activite', id, vue: () => tfVueActivite(tfActiviteEntree(id) || entree) } : null;
    }
    const entry = pevEntry(id);
    return entry ? { type: 'formule', id, vue: () => tfVueFormule(pevEntry(id) || entry) } : null;
  }
  function tfValeursCourantes() {
    const ctx = tfContexte();
    if (!ctx) return null;
    const vue = ctx.vue();
    return ctx.type === 'formule' ? tfValeursFormule(vue) : tfValeursActivite(vue);
  }
  function tfLieuxActifs(ctx, champ, vue) {
    if (!ctx || !champ) return [];
    if (ctx.type === 'formule') return tfLieuxDe(champ, vue);
    if (tfEstCase(champ)) return tfLieuxGrille();
    return champ === 'prix' ? tfLieuxActivite(vue) : [];
  }

  // ---- L HISTORIQUE DE 30 JOURS ----------------------------------------------
  // TANT QUE L HISTORIQUE N EST PAS ARRIVE, IL N Y A PAS DE CHIFFRE (gate
  // journee-vraie) ; sans le droit, aucun appel a /api/admin-range.
  function tfHistoriqueLisible() {
    if (typeof canReadStaffReservationHistory === 'function' && !canReadStaffReservationHistory()) return false;
    const h = typeof staffClientDataCache === 'undefined' ? { loaded: true } : staffClientDataCache;
    return Boolean(h.loaded);
  }
  function tfLireUsages() {
    if (!tfHistoriqueLisible() || typeof getPricingUsageMap !== 'function') return null;
    try { return getPricingUsageMap(); } catch (e) { return null; }
  }
  function tfUsage(cles) {
    const carte = tarifs.usages;
    if (!carte) return '';
    const n = [].concat(cles).reduce((s, c) => s + (Number((carte.get(c) || {}).count) || 0), 0);
    return n ? `${tfPluriel(n, 'réservation')} / 30 j` : '';
  }
  function tfResumeTexte() {
    if (typeof canReadStaffReservationHistory === 'function' && !canReadStaffReservationHistory()) return '30 derniers jours : non accessible avec votre rôle';
    const h = typeof staffClientDataCache === 'undefined' ? { loaded: true } : staffClientDataCache;
    if (!h.loaded) return h.error ? 'Historique indisponible' : 'Les 30 derniers jours arrivent du serveur…';
    const m = getPricingMetrics(getPricingRows());
    if (!Number(m.reservations)) return '30 derniers jours : aucune réservation';
    const montant = typeof canUseStaffPermission === 'function' && !canUseStaffPermission('payments.view') ? '···' : money(m.revenue);
    const top = m.topRow && Number(m.topRow.count) > 0 ? m.topRow : null;
    return `30 derniers jours : ${tfPluriel(Number(m.reservations), 'réservation')} · ${montant} réservés${top ? ` · la plus demandée : ${top.title}` : ''}`;
  }

  // ---- LE RENDU ---------------------------------------------------------------
  const tfOnglet = () => (TF_ONGLETS.includes(state.staffPricingTab) ? state.staffPricingTab : 'formules');
  // Un rechargement (publication, direct) garde l ancien catalogue a l ecran
  // jusqu a la reponse : la planche ouverte et le focus ne sautent pas. Seule
  // la bascule de centre le vide (pevResetCatalogCache).
  const tfPret = () => pricingEditor.loaded || pricingEditor.byId.size > 0;
  const tfCherche = () => tfPlie(String(state.staffPricingQuery || '').trim());
  const tfTrouve = (...textes) => { const q = tfCherche(); return !q || textes.some((t) => tfPlie(t).includes(q)); };
  const tfV = (cle, vals, balise = 'span', classe = '') => `<${balise}${classe ? ` class="${classe}"` : ''} data-tf-val="${cle}"${vals[cle] === '' ? ' hidden' : ''}>${esc(vals[cle])}</${balise}>`;
  const tfSi = (cle, vals) => `data-tf-si="${cle}"${vals[cle] ? '' : ' hidden'}`;
  const tfSinon = (cle, vals) => `data-tf-sinon="${cle}"${vals[cle] ? ' hidden' : ''}`;
  // La famille telle que le client la lit (fungalaxy-booking.js libelleFamille).
  function tfLibelleFamille(famille) {
    const cle = tfPlie(famille).trim();
    if (cle === 'formules anniversaires') return 'Anniversaires';
    if (cle === 'formules speciales') return 'Offres spéciales';
    return famille;
  }

  function tfPageHtml() {
    const onglet = tfOnglet();
    const reglages = cevCanManage();
    const sm = window.PinlaneSurMesureSettings || null;
    const articles = sm && typeof sm.compte === 'function' ? sm.compte() : undefined;
    const onglets = [
      { cle: 'formules', mot: 'Formules', n: tfPret() ? pricingEditor.byId.size : undefined },
      { cle: 'activites', mot: 'Activités', n: tfPret() ? tfActivites().length : undefined },
      { cle: 'surmesure', mot: 'Sur mesure', n: articles, note: 'vu par l’équipe seulement' },
    ];
    const zone = onglet === 'activites' ? tfActivitesHtml() : onglet === 'surmesure' ? tfSurMesureHtml() : tfFormulesHtml();
    return `<div class="pv2-shell tf-page" data-tf-page data-pl-libre>
      ${bar({
        crumb: 'Activités & tarifs',
        title: 'Tarifs & formules',
        sub: '',
        actions: `<label class="pv2-search tf-cherche">${TF_ICO.cherche}<input type="search" value="${esc(state.staffPricingQuery || '')}" placeholder="Nom, contenu, condition…" aria-label="Chercher une formule ou une activité" data-tf-cherche data-pl-focus="tf:cherche"></label>
          <button type="button" class="pv2-btn" data-tf-action="copier" data-pl-focus="tf:copier">Copier</button>
          ${typeof peutGeste !== 'function' || peutGeste('exporter') ? '<button type="button" class="pv2-btn" data-tf-action="exporter" data-pl-focus="tf:exporter">Exporter</button>' : ''}
          ${reglages ? '<button type="button" class="pv2-btn" id="cevAddCategory" data-tf-action="categorie" data-pl-focus="tf:categorie" title="Créer une catégorie : donnez-lui un nom, elle apparaît partout">+ Catégorie</button>' : ''}`,
      })}
      <div class="tf-outils">
        <div class="pv2-seg tf-onglets" role="tablist" aria-label="Ce que vous vendez"><span class="pv2-seg-pill"></span>${onglets.map((o) => {
          const actif = o.cle === onglet;
          return `<button type="button" role="tab" id="tfOnglet-${o.cle}" class="${actif ? 'active' : ''}" aria-selected="${actif}" aria-controls="tfZone" tabindex="${actif ? 0 : -1}" data-tf-onglet="${o.cle}" data-pl-focus="tf:onglet:${o.cle}">${esc(o.mot)}${o.n !== undefined ? `<em>${Number(o.n) || 0}</em>` : ''}${o.note ? `<span class="tf-onglet-note">${esc(o.note)}</span>` : ''}</button>`;
        }).join('')}</div>
        ${onglet === 'surmesure' ? '' : tfGroupeHtml()}
      </div>
      ${onglet === 'surmesure' ? '' : `<p class="tf-resume" data-tf-resume>${esc(tfResumeTexte())}</p>`}
      <div class="tf-zone" id="tfZone" role="tabpanel" aria-labelledby="tfOnglet-${onglet}">${zone}</div>
      <div class="tf-barre-place" data-tf-barre-place>${tfBarreHtml()}</div>
    </div>
    <aside class="tf-tiroir" data-tf-tiroir role="dialog" aria-modal="false" aria-labelledby="tfTiroirTitre"${tarifs.tiroir ? '' : ' hidden'}>${tarifs.tiroir ? tfTiroirHtml() : ''}</aside>`;
  }

  function tfGroupeHtml() {
    return `<div class="tf-groupe" role="group" aria-labelledby="tfGroupeMot">
      <span id="tfGroupeMot">Pour un groupe de</span>
      <span class="tf-groupe-ctl">
        <button type="button" data-tf-action="groupe-moins" data-pl-focus="tf:groupe-moins" aria-label="Une personne de moins">${TF_ICO.moins}</button>
        <input type="number" min="${TF_GROUPE_MIN}" max="${TF_GROUPE_MAX}" step="1" inputmode="numeric" value="${tarifs.groupe}" aria-label="Nombre de personnes du groupe" data-tf-groupe data-pl-focus="tf:groupe">
        <button type="button" data-tf-action="groupe-plus" data-pl-focus="tf:groupe-plus" aria-label="Une personne de plus">${TF_ICO.plus}</button>
      </span>
    </div>`;
  }

  function tfPanneHtml() {
    return `<div class="tf-panne" role="alert"><p><strong>Catalogue indisponible.</strong> ${esc(pricingEditor.error)}</p><button type="button" class="pv2-btn" data-tf-action="reessayer" data-pl-focus="tf:reessayer">Réessayer</button></div>`;
  }
  const tfAttenteHtml = () => '<p class="tf-attente" role="status">Chargement du catalogue…</p>';

  // ---- ONGLET FORMULES ----------------------------------------------------------
  function tfFormulesHtml() {
    if (!tfPret()) return pricingEditor.error ? tfPanneHtml() : tfAttenteHtml();
    const reglages = cevCanManage();
    const vues = [...pricingEditor.byId.values()].map((entry) => tfVueFormule(entry));
    const familles = [];
    vues.forEach((f) => { if (!familles.includes(f.famille)) familles.push(f.famille); });
    // Anniversaires, offres speciales, puis les familles creees, dans leur
    // ordre d apparition au catalogue.
    const rang = (famille) => { const cle = tfPlie(famille).trim(); return cle === 'formules anniversaires' ? 0 : cle === 'formules speciales' ? 1 : 2; };
    familles.sort((a, b) => rang(a) - rang(b));
    const sections = familles.map((famille, i) => {
      const toutes = vues.filter((f) => f.famille === famille);
      const montrees = toutes.filter((f) => tfTrouve(f.valeur.nom, f.publie.nom, f.desc.join(' '), f.regles.join(' ')));
      if (!montrees.length) return '';
      return `<section class="tf-famille" data-tf-famille="${esc(famille)}" aria-labelledby="tfFam-${i}">
        <div class="tf-table">
          <div class="tf-entete">
            <span class="tf-entete-titre"><h2 id="tfFam-${i}">${esc(tfLibelleFamille(famille))}</h2><span class="tf-compte">${toutes.length}</span></span>
            <span class="tf-entete-col" aria-hidden="true">Contenu</span><span class="tf-entete-col" aria-hidden="true">Conditions</span><span class="tf-entete-col" aria-hidden="true">Confirmation</span><span class="tf-entete-col tf-entete-prix" aria-hidden="true">Prix</span>
          </div>
          ${montrees.map(tfLigneFormuleHtml).join('')}
          ${reglages && !toutes.every((f) => f.comptoir) ? `<div class="tf-ajout"><button type="button" class="pv2-btn sm" data-add-formula="${esc(famille)}" data-pl-focus="tf:ajout:${esc(famille)}">+ Formule</button><span>${esc(tfPorteeEntreprise())}</span></div>` : ''}
        </div>
      </section>`;
    }).join('');
    const rien = `<p class="tf-rien">Aucune formule ne correspond à « ${esc(state.staffPricingQuery || '')} ».</p>`;
    return `${pricingEditor.error ? tfPanneHtml() : ''}<div class="tf-formules" id="cevCatalogBlock">${sections || (tfCherche() ? rien : '<p class="tf-rien">Aucune formule dans ce catalogue.</p>')}</div>`;
  }

  function tfLigneFormuleHtml(f) {
    const ouvert = tarifs.ouvert.formules === f.id;
    const p = f.publie;
    const usage = tfUsage(`formula-${f.id}`);
    const manque = missingIngredientsFor(f.entry);
    const ferme = closedDayWarningFor(f.entry);
    const alertes = [
      manque.length ? `Pas réalisable ici : il manque ${manque.join(', ')}` : '',
      ferme,
      f.suspendue ? 'Suspendue dans Établissement' : '',
      p.vente ? '' : 'Pas en vente',
    ].filter(Boolean);
    const unite = f.parPiste ? 'la piste' : f.enfants ? '/enfant' : '/pers';
    const changeable = !f.custom && tfPeutTarifs();
    const libelle = `Prix de ${p.nom} : ${p.prix == null ? 'à l’accueil' : `${tfEuros(p.prix)} ${f.parPiste ? 'la piste' : f.enfants ? 'par enfant' : 'par personne'}`}${changeable ? ', le changer' : ''}`;
    const id = esc(f.id);
    return `<div class="tf-ligne${ouvert ? ' is-ouverte' : ''}${p.vente ? '' : ' is-coupee'}${f.modifie ? ' is-modifiee' : ''}" data-tf-ligne="${id}" data-cev-formula="${id}">
      <button type="button" class="tf-ligne-btn" data-tf-ouvrir="${id}" data-pl-focus="tf:ouvrir:${id}" aria-expanded="${ouvert}" aria-controls="tfPlanche-${id}">
        <span class="tf-c-nom"><i class="tf-point" data-tf-point aria-hidden="true"${f.modifie ? '' : ' hidden'}></i><b>${esc(p.nom)}</b>${f.best ? '<span class="tf-bon">Bon plan</span>' : ''}<span class="tf-modifie" data-tf-modifie${f.modifie ? '' : ' hidden'}>à publier</span>${usage ? `<small class="tf-usage">${esc(usage)}</small>` : ''}</span>
        <span class="tf-c-contenu">${esc(f.desc.join(' · '))}</span>
        <span class="tf-c-regles">${esc(f.regles.join(', ') || 'Sans condition')}</span>
        <span class="tf-c-valid${p.validation === 'recommended' ? '' : ' is-equipe'}">${esc(f.comptoirSeul ? 'Au comptoir seulement' : tfValidation(p.validation).liste)}</span>
      </button>
      <button type="button" class="tf-c-prix" data-tf-prix="${id}" data-pl-focus="tf:prixligne:${id}" aria-label="${esc(libelle)}"><span class="tf-montant" data-tf-montant><b>${esc(p.prix == null ? 'à l’accueil' : tfEuros(p.prix))}</b> <small>${esc(unite)}</small></span>${p.ancien ? `<s data-tf-barre-prix>${esc(tfEuros(p.ancien))}</s>` : ''}</button>
      <span class="tf-c-chev" data-tf-ouvrir="${id}" aria-hidden="true">${TF_ICO.chevron}</span>
      ${alertes.length ? `<div class="tf-alertes">${alertes.map((a) => `<span class="tf-alerte" data-tf-alerte>${esc(a)}</span>`).join('')}</div>` : ''}
    </div>${ouvert ? tfPlancheFormuleHtml(f) : ''}`;
  }

  function tfRangee(cle, libelle, controle, { pour = '', apres = '', haut = false, desc = '' } = {}) {
    const titre = pour
      ? `<label class="tf-r-nom" for="${pour}" id="tfT-${cle}">${esc(libelle)}</label>`
      : `<span class="tf-r-nom" id="tfT-${cle}">${esc(libelle)}</span>`;
    return `<div class="tf-r${haut ? ' is-haut' : ''}" data-tf-r="${cle}">${titre}<div class="tf-r-saisie" data-tf-port>${controle}</div>${apres}<span class="tf-sr" id="tfD-${cle}">${esc(desc)}</span></div>`;
  }
  const tfSeVoit = (lieux) => `Se voit dans : ${tfEt(lieux.map((l) => (l === 'autres' ? tfEt(tfAutresCentres()) : TF_LIEUX_NOMS[l].toLowerCase())))}.`;
  function tfTexteAide(type, champ, brut, valide) {
    if (type === 'grille') return valide ? '' : 'Indiquez un prix de plus de 0 €, 1000 € au plus.';
    if (type === 'activite') return valide ? 'Vide : vos clients lisent « Prix à l’accueil ».' : 'Indiquez un prix entre 0 et 1000 €, ou laissez vide.';
    if (champ === 'prix') { if (!valide) return 'Indiquez un prix entre 0 et 1000 €.'; return tfLireNombre(brut) === 0 ? 'À 0 €, la formule ne se réserve plus en ligne.' : ''; }
    if (champ === 'ancien') return valide ? 'vide : pas de prix barré' : 'Indiquez un prix entre 0 et 1000 €, ou laissez vide.';
    if (champ === 'nom') return valide ? '' : 'Le nom ne peut pas rester vide.';
    return '';
  }
  function tfAideHtml(type, champ, s) {
    const texte = tfTexteAide(type, champ, s.texte, !s.invalide);
    return `<p class="tf-r-aide${s.invalide ? ' is-erreur' : ''}" id="tfA-${champ}" data-tf-aide="${champ}"${texte ? '' : ' hidden'}>${esc(texte)}</p>`;
  }
  function tfChampNombre(type, id, champ, s, placeholder = '') {
    return `<input id="tfChamp-${champ}" class="tf-champ tf-champ-nombre" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" maxlength="9" value="${esc(s.texte)}"${placeholder ? ` placeholder="${esc(placeholder)}"` : ''} data-tf-champ="${champ}" data-pl-focus="tf:${champ}" aria-describedby="tfD-${champ} tfA-${champ}"${s.invalide ? ' aria-invalid="true"' : ''}>`;
  }

  function tfChampsFormuleHtml(f) {
    const v = f.valeur;
    const unite = f.parPiste ? '€ la piste' : f.enfants ? '€ par enfant' : '€ par personne';
    const sPrix = tfSaisie('formule', f.id, 'prix', tfSaisieNombre(v.prix));
    const sAncien = tfSaisie('formule', f.id, 'ancien', tfSaisieNombre(v.ancien));
    const sNom = tfSaisie('formule', f.id, 'nom', v.nom);
    const validation = tfValidation(v.validation);
    const rouvrir = cevCanManage() ? ' <button type="button" class="tf-lien" data-tf-action="etablissement" data-pl-focus="tf:etablissement">Rouvrir dans Établissement</button>' : '';
    const MOTS = { name: 'le nom', priceValue: 'le prix', priceOld: 'le prix barré', enabled: 'la mise en vente', removed: 'la mise en vente', humanValidation: 'la validation' };
    const repris = f.entry.centerOverride ? [...new Set(Object.keys(f.entry.centerOverride).map((k) => MOTS[k]).filter(Boolean))] : [];
    return [
      tfRangee('prix', 'Prix', `${tfChampNombre('formule', f.id, 'prix', sPrix)}<span class="tf-unite">${esc(unite)}</span>`, {
        pour: 'tfChamp-prix', desc: tfSeVoit(tfLieuxDe('prix', f)), apres: tfAideHtml('formule', 'prix', sPrix),
      }),
      tfRangee('ancien', 'Prix barré', `${tfChampNombre('formule', f.id, 'ancien', sAncien, 'aucun')}<span class="tf-unite">€</span>`, {
        pour: 'tfChamp-ancien', desc: tfSeVoit(tfLieuxDe('ancien', f)), apres: tfAideHtml('formule', 'ancien', sAncien),
      }),
      tfRangee('nom', 'Nom', `<input id="tfChamp-nom" class="tf-champ tf-champ-nom" type="text" maxlength="${PEV_NAME_MAX}" autocomplete="off" value="${esc(sNom.texte)}" data-tf-champ="nom" data-pl-focus="tf:nom" aria-describedby="tfD-nom tfA-nom"${sNom.invalide ? ' aria-invalid="true"' : ''}>`, {
        pour: 'tfChamp-nom', desc: tfSeVoit(tfLieuxDe('nom', f)), apres: tfAideHtml('formule', 'nom', sNom),
      }),
      tfRangee('vente', 'En vente', `<button type="button" class="tf-bascule${v.vente ? ' is-on' : ''}" role="switch" aria-checked="${v.vente}" aria-labelledby="tfT-vente" aria-describedby="tfDit-vente tfD-vente" data-tf-champ="vente" data-pl-focus="tf:vente"><span></span></button><span class="tf-unite" id="tfDit-vente" data-tf-dit-vente>${v.vente ? 'Proposée à vos clients' : 'Retirée de la vente'}</span>`, {
        desc: tfSeVoit(tfLieuxDe('vente', f)),
        apres: f.suspendue ? `<p class="tf-r-aide is-alerte">Suspendue dans Établissement : vos clients voient la carte grisée « momentanément suspendue ».${rouvrir}</p>` : '',
      }),
      tfRangee('validation', 'Validation par l’équipe', `<div class="tf-seg" role="radiogroup" aria-labelledby="tfT-validation" aria-describedby="tfDit-valid tfD-validation">${TF_VALIDATIONS.map((x) => `<button type="button" role="radio" aria-checked="${x.mode === validation.mode}" tabindex="${x.mode === validation.mode ? 0 : -1}" class="${x.mode === validation.mode ? 'is-on' : ''}" data-tf-valid="${x.mode}" data-pl-focus="tf:valid:${x.mode}">${esc(x.mot)}</button>`).join('')}</div>`, {
        haut: true, desc: tfSeVoit(tfLieuxDe('validation', f)), apres: `<p class="tf-r-dit" id="tfDit-valid" data-tf-dit-valid>${esc(validation.dit)}</p>`,
      }),
      repris.length ? `<div class="tf-catalogue"><button type="button" class="pv2-btn sm" data-tf-action="catalogue" data-tf-id="${esc(f.id)}" data-pl-focus="tf:catalogue">Revenir au catalogue</button><span>${esc(tfMajuscule(tfEt(repris)))} de ${esc(tfNomCentre())} ${repris.length > 1 ? 'reprendraient leur' : 'reprendrait sa'} valeur du catalogue.</span></div>` : '',
    ].join('');
  }
  // Les reglages du centre en lecture : une formule creee par l entreprise
  // (le serveur refuse tout reglage de centre) ou un role sans le droit Tarifs.
  function tfLectureFormuleHtml(f) {
    const v = f.valeur;
    const ligne = (libelle, texte) => `<div class="tf-r tf-r-lu"><span class="tf-r-nom">${esc(libelle)}</span><span class="tf-r-valeur">${esc(texte)}</span></div>`;
    const unite = f.parPiste ? 'la piste' : f.enfants ? 'par enfant' : 'par personne';
    const lignes = [
      ligne('Prix', v.prix == null ? 'à l’accueil' : `${tfEuros(v.prix)} ${unite}`),
      ligne('Prix barré', v.ancien ? tfEuros(v.ancien) : 'aucun'),
      ligne('Nom', v.nom),
      ligne('En vente', v.vente ? 'Proposée à vos clients' : 'Retirée de la vente'),
      ligne('Validation', tfValidation(v.validation).liste),
    ].join('');
    if (f.comptoir) {
      const voit = (clients, mot, code) => `<button type="button" class="tf-seg-b${Boolean(f.comptoirSeul) !== clients ? ' is-on' : ''}" aria-pressed="${Boolean(f.comptoirSeul) !== clients}" id="tfSm-${code}" data-tf-action="sm-${code}" data-tf-id="${esc(f.id)}" data-pl-focus="tf:sm-${code}">${mot}</button>`;
      const champs = tfPeutTarifs()
        ? `<div class="tf-r"><label class="tf-r-nom" for="tfSmNom">Nom</label><div class="tf-r-saisie"><input id="tfSmNom" class="tf-champ tf-champ-nom" type="text" maxlength="80" autocomplete="off" value="${esc(v.nom)}" data-pl-focus="tf:sm-nom"></div></div>
          <div class="tf-r"><label class="tf-r-nom" for="tfSmPrix">Prix</label><div class="tf-r-saisie"><input id="tfSmPrix" class="tf-champ tf-champ-nombre" type="text" inputmode="decimal" autocomplete="off" maxlength="9" value="${esc(tfSaisieNombre(v.prix))}" data-pl-focus="tf:sm-prix"><span class="tf-unite">€ par personne</span></div></div>
          <div class="tf-r"><label class="tf-r-nom" for="tfSmMin">Dès</label><div class="tf-r-saisie"><input id="tfSmMin" class="tf-champ tf-champ-nombre" type="number" min="1" max="240" inputmode="numeric" value="${esc(String(f.minPax))}" data-pl-focus="tf:sm-min"><span class="tf-unite">joueurs</span></div></div>
          <div class="tf-catalogue"><button type="button" class="pv2-btn sm" id="tfSmEnregistrer" data-tf-action="sm-enregistrer" data-tf-id="${esc(f.id)}" data-pl-focus="tf:sm-enregistrer">Enregistrer</button></div>`
        : `${ligne('Prix', v.prix == null ? 'à l’accueil' : `${tfEuros(v.prix)} ${unite}`)}${ligne('Nom', v.nom)}`;
      const gestes = tfPeutTarifs()
        ? `<div class="tf-r"><span class="tf-r-nom">Qui la voit</span><div class="tf-r-saisie"><div class="tf-seg" role="group" aria-label="Qui voit cette formule">${voit(false, 'Au comptoir', 'comptoir')}${voit(true, 'Aussi aux clients', 'clients')}</div></div></div><div class="tf-catalogue"><button type="button" class="pv2-btn sm cev-danger" id="tfSmRetirer" data-tf-action="sm-retirer" data-tf-id="${esc(f.id)}" data-pl-focus="tf:sm-retirer">Retirer cette formule</button></div>`
        : ligne('Qui la voit', f.comptoirSeul ? 'Au comptoir seulement' : 'Aussi les clients, sur le formulaire');
      return `${champs}${gestes}<p class="tf-r-dit">Formule gardée au comptoir : elle n’existe que pour ce centre.</p>`;
    }
    if (f.custom) {
      return `${lignes}<p class="tf-r-dit">Formule créée par votre entreprise : ses réglages valent pour tous vos centres.</p>${cevCanManage() ? `<div class="tf-catalogue"><button type="button" class="pv2-btn sm" data-cev-fields="${esc(f.id)}" data-pl-focus="tf:modifier">Modifier</button></div>` : ''}`;
    }
    return `${lignes}<p class="tf-r-dit">Réglé par ${esc(tfQui('pricing.manage'))}.</p>`;
  }
  function tfCadreHtml(f) {
    const e = f.entry;
    const reglages = cevCanManage();
    const etapes = Array.isArray(e.steps) && e.steps.length ? e.steps.length : f.desc.length;
    const jours = Array.isArray(e.validDays) ? [...new Set(e.validDays.map(Number))] : [];
    const morceaux = [
      etapes ? tfPluriel(etapes, 'activité') : '',
      Number(e.minPax) > 1 ? `dès ${Number(e.minPax)} personnes` : 'sans minimum',
      jours.length && jours.length < 7 ? joursLisibles(jours) : 'tous les jours',
      plageLisible(tfPlageHeures(e)),
      e.noHolidays ? 'hors vacances et fériés' : '',
    ].filter(Boolean);
    const gestes = reglages
      ? `<div class="tf-cadre-gestes">
          <button type="button" class="pv2-btn sm" data-cev-steps="${esc(f.id)}" data-pl-focus="tf:steps" aria-describedby="tfT-structure tfD-structure">Modifier le contenu</button>
          ${f.custom ? '' : `<button type="button" class="pv2-btn sm" data-cev-fields="${esc(f.id)}" data-pl-focus="tf:fields" aria-describedby="tfT-structure tfD-structure">Jours et minimum</button>`}
          ${f.custom && !f.comptoir ? `<button type="button" class="pv2-btn sm cev-danger" data-cev-delete="${esc(f.id)}" data-pl-focus="tf:supprimer" aria-label="Supprimer ${esc(f.publie.nom)} du catalogue">Supprimer</button>` : ''}
        </div>`
      : `<p class="tf-r-dit">Réglé par ${esc(tfQui('settings.manage'))}, pour tous vos centres.</p>`;
    return `<div class="tf-cadre" data-tf-r="structure">
      <div class="tf-cadre-tete"><span class="tf-r-nom" id="tfT-structure">Contenu, jours, heures, minimum</span><span class="tf-portee is-entreprise">${esc(f.comptoir ? 'Ce centre seulement' : tfPorteeEntreprise())}</span></div>
      <p class="tf-cadre-resume">${esc(tfMajuscule(morceaux.join(' · ')))}</p>
      ${gestes}
      <span class="tf-sr" id="tfD-structure">${esc(tfSeVoit(tfLieuxDe('structure', f)))}</span>
    </div>`;
  }

  function tfPlancheFormuleHtml(f) {
    const vals = tfValeursFormule(f);
    const editable = !f.custom && tfPeutTarifs();
    const champs = [...(editable ? TF_CHAMPS : []), 'structure'];
    const lieux = tfLieuxFormule();
    const reference = `pour ${tfPluriel(tarifs.groupe, 'personne')}, ${tfDateLisible(tfDateReference())}`;
    const id = esc(f.id);
    return `<div class="tf-planche" id="tfPlanche-${id}" data-tf-planche="${id}" data-tf-type="formule" role="region" aria-label="${esc(f.valeur.nom)} : ce que vous réglez et où ça se voit">
      <div class="tf-cablage" data-tf-cablage>
        <div class="tf-col tf-col-r">
          <div class="tf-col-tete"><span class="tf-etape">Ce que vous réglez</span><span class="tf-portee">${esc(tfPorteeCentre())}</span></div>
          ${editable ? tfChampsFormuleHtml(f) : tfLectureFormuleHtml(f)}
          ${tfCadreHtml(f)}
        </div>
        <div class="tf-gouttiere" aria-hidden="true"></div>
        <div class="tf-col tf-col-l">
          <div class="tf-col-tete"><span class="tf-etape">Où ça se voit</span><span class="tf-ref" data-tf-ref>${esc(reference)}</span></div>
          ${lieux.map((lieu) => tfLieuHtml(lieu, tfMiniFormule(lieu, f, vals), tfReposFormule(lieu, f, champs))).join('')}
        </div>
        <svg class="tf-fils" data-tf-fils aria-hidden="true" focusable="false"></svg>
      </div>
      ${tfPiedHtml(tfPied(tarifs.focus || champs[0], f))}
    </div>`;
  }
  function tfReposFormule(lieu, f, champs) {
    const mots = champs.filter((c) => tfLieuxDe(c, f).includes(lieu)).map((c) => TF_MOTS_CHAMP[c]);
    return mots.length ? `Change avec ${tfEt(mots)}.` : 'Rien de ce que vous réglez ici.';
  }
  // Ce qui se lit mene a son geste : chaque endroit ouvre la vraie page, quand
  // le role y a acces. Le brouillon reste, il est garde par centre.
  const TF_LIEUX_GESTES = {
    formulaire: { mot: 'Ouvrir le formulaire', permis: () => Boolean(tfCentre()) && tfCentre() !== 'all', ouvrir: () => {
      // Les deux centres de Fun Galaxy vendent par leur propre formulaire : /reserver/gembloux montrait l ancien tunnel.
      const c = tfCentre();
      window.open(c === 'libramont' || c === 'gembloux' ? `/fungalaxy/${c}` : `/reserver/${encodeURIComponent(c)}`, '_blank', 'noopener');
    } },
    mails: { mot: 'Ouvrir les mails', permis: () => typeof canUseStaffPage === 'function' && canUseStaffPage('emails'), ouvrir: () => openStaffMenuPage('emails') },
    comptoir: { mot: 'Ouvrir Réserver', permis: () => typeof openQuickBook === 'function' && typeof canUseStaffPage === 'function' && canUseStaffPage('planning') && (typeof peutGeste !== 'function' || peutGeste('reserver')), ouvrir: () => openQuickBook({ date: state.currentDate }) },
    planning: { mot: 'Ouvrir le planning', permis: () => typeof canUseStaffPage === 'function' && canUseStaffPage('planning'), ouvrir: () => openStaffMenuPage('planning') },
  };
  function tfGesteLieuHtml(lieu) {
    const geste = TF_LIEUX_GESTES[lieu];
    if (!geste || !geste.permis()) return '';
    return `<button type="button" class="tf-lien" data-tf-action="ouvrir-lieu" data-tf-lieu-cible="${lieu}" data-pl-focus="tf:ouvrir-lieu:${lieu}">${esc(geste.mot)}</button>`;
  }
  function tfLieuHtml(lieu, mini, repos) {
    const nom = lieu === 'autres' ? tfEt(tfAutresCentres()) : TF_LIEUX_NOMS[lieu];
    return `<div class="tf-lieu" data-tf-lieu="${lieu}" data-tf-etat="repos" role="group" aria-labelledby="tfLieuNom-${lieu}">
      <div class="tf-mini">${mini}</div>
      <div class="tf-lieu-dit"><span class="tf-lieu-nom" id="tfLieuNom-${lieu}">${esc(nom)}</span><p class="tf-lieu-phrase" data-tf-phrase data-tf-repos="${esc(repos)}">${esc(repos)}</p>${tfGesteLieuHtml(lieu)}</div>
    </div>`;
  }
  // Les endroits en petit, avec les vrais mots de chacun (formulaire client,
  // ecran de fin, mails, Reserver, planning). Rien n y est invente : l heure
  // 16:00 du planning est un exemple neutre, sans client.
  function tfMiniFormule(lieu, f, vals) {
    if (lieu === 'formulaire') {
      return `<div class="tf-m-carte${vals.retiree ? ' is-retiree' : ''}" data-tf-classe="is-retiree:retiree">
        <div class="tf-m-tete">${tfV('nom', vals, 'b', 'tf-m-nom')}${f.best ? '<span class="tf-m-bon">Bon plan</span>' : ''}</div>
        <div class="tf-m-prix">${tfV('prix', vals, 'b')}${tfV('unite', vals, 'span', 'tf-m-unite')}${tfV('ancien', vals, 's')}${tfV('remise', vals, 'span', 'tf-m-remise')}</div>
        ${tfV('duree', vals, 'p', 'tf-m-duree')}
        ${f.desc.length ? `<ul class="tf-m-liste" data-tf-lie="structure">${f.desc.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}
        ${f.regles.length ? `<p class="tf-m-regles" data-tf-lie="structure">${f.regles.map((r) => `<span>${esc(r)}</span>`).join('')}</p>` : ''}
        <p class="tf-m-bande"><span ${tfSi('bandeTotale', vals)}>${tfV('bandeAvant', vals)}${tfV('bandeTotal', vals, 'b')} ${tfV('bandePour', vals)}</span><span ${tfSinon('bandeTotale', vals)} data-tf-val="bref">${esc(vals.bref)}</span></p>
        ${f.suspendue ? '<p class="tf-m-note">Cette offre est momentanément suspendue.</p>' : ''}
        <p class="tf-m-voile" ${tfSi('retiree', vals)}>Retirée du formulaire de ${esc(tfNomCentre())}</p>
      </div>`;
    }
    if (lieu === 'fin') {
      return `<div class="tf-m-fin">
        ${tfV('finTitre', vals, 'b', 'tf-m-fin-titre')}
        ${tfV('finTexte', vals, 'span', 'tf-m-fin-texte')}
        <span class="tf-m-petit" ${tfSi('laser', vals)}>« Demande envoyée » si le laser est déjà pris par un autre groupe.</span>
        <span class="tf-m-kv"><i>Au programme</i>${tfV('nom', vals, 'b')}</span>
        ${tfV('finMontant', vals, 'span', 'tf-m-kv tf-m-montant')}
      </div>`;
    }
    if (lieu === 'mails') {
      return `<div class="tf-m-mail">
        <div class="tf-m-mail-tete">${tfV('mailObjet', vals, 'b')}<span class="tf-m-tag" ${tfSi('confirme', vals)}>rappel 48 h</span></div>
        <div class="tf-m-kv"><i>Offre</i>${tfV('nom', vals, 'b')}</div>
        <div class="tf-m-kv" ${tfSi('confirme', vals)}><i>Montant estimé</i>${tfV('mailMontant', vals, 'b')}</div>
        <div class="tf-m-kv" ${tfSi('demande', vals)}><i>À l’équipe</i><b>« Réservation à valider »</b></div>
        <span class="tf-m-petit" ${tfSi('laser', vals)}>« Demande reçue » si le laser est déjà pris.</span>
      </div>`;
    }
    if (lieu === 'comptoir') {
      return `<div class="tf-m-ct">
        <div class="tf-m-porte">${TF_ICO.boule}<b>Formules</b>${tfV('plage', vals, 'span', 'tf-m-plage')}<span class="tf-m-chev" aria-hidden="true">›</span></div>
        <div class="tf-m-ticket" ${tfSi('vente', vals)}>${tfV('ticketNom', vals, 'span', 'tf-m-ticket-nom')}${tfV('joueurs', vals, 'span', 'tf-m-qte')}${tfV('ticketTotal', vals, 'b')}</div>
        <p class="tf-m-petit" ${tfSinon('vente', vals)}>Plus proposée dans Réserver.</p>
        <div class="tf-m-kv" ${tfSi('vente', vals)}><i>Dossier créé ici</i><span class="tf-m-pastille${vals.aVerifier ? ' is-avt' : ''}" data-tf-classe="is-avt:aVerifier" data-tf-val="dossier">${esc(vals.dossier)}</span></div>
      </div>`;
    }
    if (lieu === 'planning') {
      return `<div class="tf-m-pl">
        <b class="tf-m-pl-h">16:00</b>
        ${f.anniversaire ? '<span class="tf-m-pl-type">Anniversaire</span>' : ''}
        ${tfV('joueurs', vals, 'span', 'tf-m-pl-pax')}
        ${tfV('court', vals, 'b', 'tf-m-pl-nom')}
        <span class="tf-m-pastille${vals.aVerifier ? ' is-avt' : ''}" data-tf-classe="is-avt:aVerifier" data-tf-val="badge">${esc(vals.badge)}</span>
        <span class="tf-m-btn" ${tfSi('aVerifier', vals)}>Valider</span>
      </div>`;
    }
    const autres = tfAutresCentres();
    return `<div class="tf-m-autres">
      <div class="tf-m-kv"><i>Contenu, jours, minimum</i><b>les mêmes qu’à ${esc(tfNomCentre())}</b></div>
      <div class="tf-m-kv"><i>Prix, nom, mise en vente</i><b class="is-sien">${esc(autres.length > 1 ? 'ceux de chaque centre' : `ceux de ${autres[0]}`)}</b></div>
    </div>`;
  }
  function tfPiedHtml(pied) {
    return `<div class="tf-pied" data-tf-pied>
      <p class="tf-pied-l" data-tf-pied-l="pas"${pied.pas ? '' : ' hidden'}><span class="tf-pied-mot">Pas touché</span><span data-tf-pied-v="pas">${esc(pied.pas)}</span></p>
      <p class="tf-pied-l is-savoir" data-tf-pied-l="savoir"${pied.savoir ? '' : ' hidden'}><span class="tf-pied-mot">À savoir</span><span data-tf-pied-v="savoir">${esc(pied.savoir)}</span></p>
      <p class="tf-pied-l is-qui" data-tf-pied-l="qui"><span class="tf-pied-mot">Qui le change</span><span data-tf-pied-v="qui">${esc(pied.qui)}</span></p>
      <p class="tf-pied-l is-qui" data-tf-pied-l="quand"><span class="tf-pied-mot">Quand</span><span data-tf-pied-v="quand">${esc(pied.quand)}</span></p>
    </div>`;
  }

  // ---- ONGLET ACTIVITES -----------------------------------------------------------
  function tfActivitesHtml() {
    if (!tfPret()) return pricingEditor.error ? tfPanneHtml() : tfAttenteHtml();
    const montrees = tfActivites().filter((a) => tfTrouve(a.nom, a.note));
    const groupes = [['À la carte', montrees.filter((a) => a.seule)], ['Dans vos formules seulement', montrees.filter((a) => !a.seule)]].filter(([, liste]) => liste.length);
    if (!groupes.length) {
      return `<p class="tf-rien">${tfCherche() ? `Aucune activité ne correspond à « ${esc(state.staffPricingQuery || '')} ».` : 'Aucune activité dans ce centre.'}</p>`;
    }
    return groupes.map(([titre, liste], i) => `<section class="tf-famille tf-famille-act" aria-labelledby="tfAct-${i}">
      <div class="tf-table">
        <div class="tf-entete">
          <span class="tf-entete-titre"><h2 id="tfAct-${i}">${esc(titre)}</h2><span class="tf-compte">${liste.length}</span></span>
          <span class="tf-entete-col" aria-hidden="true">Prix détaillés</span><span class="tf-entete-col" aria-hidden="true">À savoir</span><span class="tf-entete-col" aria-hidden="true">Qui fixe le prix</span><span class="tf-entete-col tf-entete-prix" aria-hidden="true">Prix</span>
        </div>
        ${liste.map(tfLigneActiviteHtml).join('')}
      </div>
    </section>`).join('');
  }
  // Le montant fort, l unite en petit : « / table et par heure » passe a la
  // ligne sans jamais couper le prix.
  function tfPrixLigneHtml(prix) {
    const i = prix.indexOf(' / ');
    return i < 0 ? `<b>${esc(prix)}</b>` : `<b>${esc(prix.slice(0, i))}</b> <small>${esc(prix.slice(i + 1))}</small>`;
  }
  function tfLigneActiviteHtml(a) {
    const ouvert = tarifs.ouvert.activites === a.id;
    const editable = tfActiviteReglable(a);
    const options = tfOptionsGrille(a);
    const cartes = tfCartesArcades(a);
    const fourchette = (liste) => { const p = liste.map((o) => Number(o.price)); return `${tfPluriel(p.length, 'carte')}, de ${tfEuros(Math.min(...p))} à ${tfEuros(Math.max(...p))}`; };
    const detail = options.length ? tfDetailCases(options)
      : cartes ? [cartes.temps.length ? `${fourchette(cartes.temps)} au temps` : '', cartes.credits.length ? `${fourchette(cartes.credits)} en crédits` : ''].filter(Boolean).join(' · ')
        : !a.seule ? 'Comprise dans vos formules'
          : a.publie != null ? `${tfEuros(a.publie)} ${a.unitLabel}`.trim() : 'Prix à l’accueil';
    const d = tfMetaDonnees() || {};
    const usage = a.id === 'bowling' ? tfUsage((d.durationOptions || []).map((o) => `bowling-${Number(o.value)}`))
      : a.id === 'laser_game' ? tfUsage((d.laserOptions || []).map((o) => `laser-${o.games}`)) : '';
    const savoir = [usage, a.note, a.ages, a.minPax > 1 ? `dès ${a.minPax} joueurs` : ''].filter(Boolean).join(' · ');
    const qui = !a.seule ? 'Pas de prix seul' : a.grille ? `Votre centre, ${tfNomCentre()}` : a.arcades ? `Établissement, pour ${tfNomCentre()}` : 'Votre entreprise';
    const prix = a.seule ? tfPrixCarte(a, a.publie, { publie: true }) : 'Dans vos formules';
    const prixHtml = a.seule ? tfPrixLigneHtml(prix) : `<small>${esc(prix)}</small>`;
    const id = esc(a.id);
    return `<div class="tf-ligne tf-ligne-act${ouvert ? ' is-ouverte' : ''}${a.modifie ? ' is-modifiee' : ''}" data-tf-act="${id}">
      <button type="button" class="tf-ligne-btn" data-tf-ouvrir-act="${id}" data-pl-focus="tf:ouvrir-act:${id}" aria-expanded="${ouvert}" aria-controls="tfPlanche-${id}">
        <span class="tf-c-nom"><i class="tf-point" data-tf-point aria-hidden="true"${a.modifie ? '' : ' hidden'}></i><b>${esc(a.nom)}</b><span class="tf-modifie" data-tf-modifie${a.modifie ? '' : ' hidden'}>à publier</span></span>
        <span class="tf-c-contenu">${esc(detail)}</span>
        <span class="tf-c-regles">${esc(savoir)}</span>
        <span class="tf-c-valid">${esc(qui)}</span>
      </button>
      ${editable
        ? `<button type="button" class="tf-c-prix" data-tf-prix-act="${id}" data-pl-focus="tf:prixact:${id}" aria-label="${esc(`Prix de ${a.nom} : ${prix}, le changer`)}"><span class="tf-montant" data-tf-montant>${prixHtml}</span></button>`
        : `<span class="tf-c-prix is-lu"><span class="tf-montant" data-tf-montant>${prixHtml}</span></span>`}
      <span class="tf-c-chev" data-tf-ouvrir-act="${id}" aria-hidden="true">${TF_ICO.chevron}</span>
    </div>${ouvert ? tfPlancheActiviteHtml(a) : ''}`;
  }
  function tfReglageActiviteHtml(a, editable) {
    if (a.grille) {
      const cases = tfOptionsGrille(a);
      if (!cases.length) return `<p class="tf-r-dit">${tfMeta.etat === 'erreur' ? 'Prix indisponibles pour le moment. Rechargez la page.' : 'Chargement des prix…'}</p>`;
      const memes = a.nomGrille === 'bowling' ? tfActivites().filter((x) => x.nomGrille === 'bowling' && x.seule).map((x) => x.nom) : [];
      const note = memes.length > 1 ? `<p class="tf-r-dit">La même grille sert au ${esc(tfEt(memes))}.</p>` : '';
      if (!editable) {
        const dit = a.seule ? `Réglé par ${esc(tfQui('pricing.manage'))}, pour ${esc(tfNomCentre())}.` : 'Elle compose vos formules : son prix ne se lit nulle part seul.';
        return `<ul class="tf-grille">${cases.map((c) => `<li><span>${esc(c.long)}</span><b>${esc(tfEuros(c.prix))}</b><small>${esc(tfUniteCase(c))}</small></li>`).join('')}</ul>
          <p class="tf-r-dit">${dit}</p>${note}`;
      }
      let jours = '';
      return `${cases.map((c) => {
        const s = tfSaisie('grille', c.grille, c.cle, tfSaisieNombre(c.prix));
        const titre = c.groupe && c.groupe !== jours ? `<p class="tf-grille-titre">${esc(c.groupe)}</p>` : '';
        jours = c.groupe || '';
        return titre + tfRangee(c.champ, c.label, `${tfChampNombre('grille', a.id, c.champ, s)}<span class="tf-unite">€ ${esc(tfUniteCase(c))}</span>`, {
          pour: `tfChamp-${c.champ}`, desc: tfSeVoit(tfLieuxGrille()), apres: tfAideHtml('grille', c.champ, s),
        });
      }).join('')}${note}`;
    }
    if (a.arcades) {
      const cartes = tfCartesArcades(a) || { temps: [], credits: [] };
      const ligne = (o, temps) => `<li><span>${esc(temps ? `${o.minutes} min` : `${o.credits}${Number(o.bonusCredits) ? ` + ${o.bonusCredits}` : ''} crédits`)}</span><b>${esc(tfEuros(o.price))}</b><small>par carte</small></li>`;
      return `${cartes.temps.length ? `<p class="tf-grille-titre">Au temps</p><ul class="tf-grille">${cartes.temps.map((o) => ligne(o, true)).join('')}</ul>` : ''}
        ${cartes.credits.length ? `<p class="tf-grille-titre">En crédits</p><ul class="tf-grille">${cartes.credits.map((o) => ligne(o, false)).join('')}</ul>` : ''}
        <p class="tf-r-dit">Les cartes se règlent dans Établissement.${cevCanManage() ? ' <button type="button" class="tf-lien" data-tf-action="etablissement" data-pl-focus="tf:etablissement">Ouvrir Établissement</button>' : ''}</p>`;
    }
    if (!a.seule) return '<p class="tf-r-dit">Elle compose vos formules : son prix ne se lit nulle part seul.</p>';
    if (!editable) {
      return `<div class="tf-r tf-r-lu"><span class="tf-r-nom">Prix</span><span class="tf-r-valeur">${esc(a.prix == null ? 'à l’accueil' : `${tfEuros(a.prix)} ${a.unitLabel}`.trim())}</span></div>
        <p class="tf-r-dit">Réglé par ${esc(tfQui('settings.manage'))}, pour tous vos centres.</p>`;
    }
    const s = tfSaisie('activite', a.id, 'prix', tfSaisieNombre(a.prix));
    return tfRangee('prix', 'Prix', `${tfChampNombre('activite', a.id, 'prix', s, 'à l’accueil')}<span class="tf-unite">${esc(a.unitLabel ? `€ ${a.unitLabel}` : '€')}</span>`, {
      pour: 'tfChamp-prix',
      desc: tfSeVoit(tfLieuxActivite(a)),
      apres: `${tfAideHtml('activite', 'prix', s)}${a.paliers ? '<p class="tf-r-dit">C’est le prix de base : des prix par jour ou par heure le remplacent sur certains créneaux.</p>' : ''}`,
    });
  }
  // Une grille, avec les vrais mots de chaque endroit : la carte et ses options
  // (fungalaxy-booking.js:630), l ecran de fin, le mail, la ligne du ticket.
  function tfMiniGrille(lieu, a, vals) {
    if (lieu === 'formulaire') {
      return `<div class="tf-m-act">
        <b class="tf-m-nom">${esc(a.nom)}</b>
        ${tfV('des', vals, 'span', 'tf-m-des')}
        ${a.note ? `<small class="tf-m-petit">${esc(a.note)}</small>` : ''}
        <div class="tf-m-options">${tfOptionsGrille(a).map((c) => `<span class="tf-m-option"><i>${esc(c.long)}</i>${tfV(`opt:${c.champ}`, vals, 'b')}</span>`).join('')}</div>
        <span class="tf-m-kv">${tfV('exempleQuoi', vals, 'i')}${tfV('exempleTotal', vals, 'b')}</span>
      </div>`;
    }
    if (lieu === 'fin') {
      return `<div class="tf-m-fin">
        <b class="tf-m-fin-titre">Réservation confirmée</b>
        <span class="tf-m-fin-texte">C’est réservé : on vous attend !</span>
        <span class="tf-m-kv"><i>Au programme</i>${tfV('offre', vals, 'b')}</span>
        ${tfV('finMontant', vals, 'span', 'tf-m-kv tf-m-montant')}
      </div>`;
    }
    if (lieu === 'mails') {
      return `<div class="tf-m-mail">
        <div class="tf-m-mail-tete"><b>Réservation confirmée</b><span class="tf-m-tag">rappel 48 h</span></div>
        <div class="tf-m-kv"><i>Offre</i>${tfV('offre', vals, 'b')}</div>
        <div class="tf-m-kv"><i>Montant estimé</i>${tfV('mailMontant', vals, 'b')}</div>
      </div>`;
    }
    if (lieu === 'comptoir') {
      return `<div class="tf-m-ct">
        <span class="tf-m-tuile"><b>${esc(vals.tuileNom)}</b></span>
        <div class="tf-m-ticket">${tfV('offre', vals, 'span', 'tf-m-ticket-nom')}${tfV('ticketDetail', vals, 'span', 'tf-m-qte')}${tfV('ticketTotal', vals, 'b')}</div>
      </div>`;
    }
    return `<div class="tf-m-autres">${tfV('autres', vals, 'p', 'tf-m-petit')}</div>`;
  }
  function tfMiniActivite(lieu, a, vals) {
    if (a.grille) return tfMiniGrille(lieu, a, vals);
    if (lieu === 'formulaire') {
      return `<div class="tf-m-act">
        <b class="tf-m-nom">${esc(a.nom)}</b>
        ${tfV('des', vals, 'span', 'tf-m-des')}
        ${a.note ? `<small class="tf-m-petit">${esc(a.note)}</small>` : ''}
        ${a.simple && a.priceType === 'per_pax' ? `<span class="tf-m-kv" ${tfSi('total', vals)}><i>Choisie, pour ${esc(vals.pour)}</i>${tfV('total', vals, 'b')}</span>` : ''}
      </div>`;
    }
    if (lieu === 'comptoir') {
      return `<div class="tf-m-ct"><span class="tf-m-tuile"><b>${esc(vals.tuileNom)}</b>${tfV('tuile', vals)}</span><p class="tf-m-petit">Pour ${esc(vals.pour)}</p></div>`;
    }
    return `<div class="tf-m-autres"><div class="tf-m-kv"><i>Prix</i><b>le même qu’à ${esc(tfNomCentre())}</b></div></div>`;
  }
  function tfPlancheActiviteHtml(a) {
    const vals = tfValeursActivite(a);
    const editable = tfActiviteReglable(a);
    const lieux = tfLieuxActivite(a);
    const duCentre = a.grille || a.arcades;
    const portee = duCentre ? tfPorteeCentre() : tfPorteeEntreprise();
    const repos = (lieu) => {
      if (a.grille && lieu === 'autres') return tfAutresCentres().length > 1 ? 'Gardent leurs propres prix.' : 'Garde son propre prix.';
      if (editable) return 'Change avec le prix.';
      return lieu === 'formulaire' ? 'Ce que lit le client.' : 'Ce que lit l’équipe.';
    };
    const id = esc(a.id);
    return `<div class="tf-planche" id="tfPlanche-${id}" data-tf-planche="${id}" data-tf-type="activite" role="region" aria-label="${esc(a.nom)} : son prix et où il se voit">
      <div class="tf-cablage" data-tf-cablage>
        <div class="tf-col tf-col-r">
          <div class="tf-col-tete"><span class="tf-etape">${editable ? 'Ce que vous réglez' : 'Comment son prix se fixe'}</span><span class="tf-portee${duCentre ? '' : ' is-entreprise'}">${esc(portee)}</span></div>
          ${tfReglageActiviteHtml(a, editable)}
          <p class="tf-seule">Se réserve seule : <b>${a.seule ? 'oui' : 'non'}</b></p>
        </div>
        <div class="tf-gouttiere" aria-hidden="true"></div>
        <div class="tf-col tf-col-l">
          <div class="tf-col-tete"><span class="tf-etape">Où ça se voit</span>${lieux.length ? `<span class="tf-ref" data-tf-ref>${esc(`pour ${tfPluriel(tarifs.groupe, 'personne')}`)}</span>` : ''}</div>
          ${lieux.length
            ? lieux.map((lieu) => tfLieuHtml(lieu, tfMiniActivite(lieu, a, vals), repos(lieu))).join('')
            : '<p class="tf-r-dit">Ni carte dans le formulaire ni touche au comptoir : elle n’existe que dans vos formules.</p>'}
        </div>
        <svg class="tf-fils" data-tf-fils aria-hidden="true" focusable="false"></svg>
      </div>
      ${editable ? tfPiedHtml(a.grille ? tfPiedGrille(a) : { pas: 'Le prix des formules qui la contiennent.', savoir: '', qui: `${tfMajuscule(tfQui('settings.manage'))}.`, quand: TF_QUAND }) : ''}
    </div>`;
  }

  // ---- ONGLET SUR MESURE ----------------------------------------------------------
  function tfSurMesureHtml() {
    const sm = window.PinlaneSurMesureSettings;
    if (!sm || typeof sm.renderSection !== 'function') return '<p class="tf-rien">Le catalogue sur mesure n’est pas disponible sur ce poste.</p>';
    return sm.renderSection({ cherche: state.staffPricingQuery || '' });
  }

  // ---- LA BARRE ET LE TIROIR « CE QUI CHANGE » ------------------------------------
  function tfBarreHtml() {
    const n = tfNbChangements();
    if (!n || tarifs.tiroir) return '';
    const centre = tfNomCentre();
    return `<div class="tf-barre${tarifs.erreur ? ' is-erreur' : ''}" data-tf-barre role="region" aria-label="Changements à publier">
      <span class="tf-barre-point" aria-hidden="true"></span>
      <span class="tf-barre-texte" aria-live="polite"><b data-tf-barre-n>${n}</b> <span data-tf-barre-mot>${n > 1 ? 'changements' : 'changement'} pour ${esc(centre)}</span></span>
      <button type="button" class="tf-lien" data-tf-action="voir" data-pl-focus="tf:voir">Voir ce qui change</button>
      <span class="tf-barre-gestes">
        <button type="button" class="pv2-btn" data-tf-action="annuler-tout" data-pl-focus="tf:annuler-tout"${tarifs.publication ? ' disabled' : ''}>Annuler</button>
        <button type="button" class="pv2-btn primary" data-tf-action="publier" data-pl-focus="tf:publier"${tarifs.publication ? ' disabled aria-busy="true"' : ''}>${tarifs.publication ? 'Publication…' : 'Publier'}</button>
      </span>
      ${tarifs.erreur ? `<p class="tf-barre-erreur" role="alert">${esc(tarifs.erreur)}</p>` : ''}
    </div>`;
  }
  const tfSignatureBarre = () => `${tfNbChangements() > 0}|${tarifs.erreur}|${tarifs.publication}|${tarifs.tiroir}|${tfNomCentre()}`;
  function tfMajBarre() {
    const place = document.querySelector('#staffPricingPage [data-tf-barre-place]');
    if (!place) return;
    const n = tfNbChangements();
    const barre = place.querySelector('[data-tf-barre]');
    const signature = tfSignatureBarre();
    if (barre && place.dataset.tfSignature === signature) {
      const nombre = barre.querySelector('[data-tf-barre-n]');
      if (nombre && tfTexteVise(nombre) !== String(n)) tfRouler(nombre, String(n));
      const mot = barre.querySelector('[data-tf-barre-mot]');
      const texte = `${n > 1 ? 'changements' : 'changement'} pour ${tfNomCentre()}`;
      if (mot && mot.textContent !== texte) mot.textContent = texte;
      return;
    }
    place.dataset.tfSignature = signature;
    tfAvecFocus(() => { place.innerHTML = tfBarreHtml(); });
    const neuve = barre ? null : place.querySelector('[data-tf-barre]');
    if (neuve && neuve.animate && !tfReduit()) neuve.animate([{ transform: 'translateY(14px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 240, easing: tfEasing() });
  }

  function tfChangements() {
    const lot = tfLot(false);
    if (!lot) return [];
    const out = [];
    Object.entries(lot.formules).forEach(([id, b]) => Object.keys(b).forEach((champ) => out.push({ type: 'formule', id, champ })));
    Object.entries(lot.activites).forEach(([id, b]) => Object.keys(b).forEach((champ) => out.push({ type: 'activite', id, champ })));
    Object.keys(lot.grilles).forEach((brut) => { const i = brut.indexOf(':'); out.push({ type: 'grille', id: brut.slice(0, i), champ: brut.slice(i + 1) }); });
    return out;
  }
  // Ce que chaque endroit montre, en une ligne, pour l avant et l apres.
  const TF_APERCU = {
    formulaire: {
      prix: (v) => `${v.prix} ${v.unite}${v.bandeTotale ? ` · ${v.bandeTotal} ${v.bandePour}` : ''}`,
      ancien: (v) => (v.ancien ? `${v.prix} ${v.unite}, barré ${v.ancien}${v.remise ? ` · ${v.remise}` : ''}` : `${v.prix} ${v.unite}, sans prix barré`),
      nom: (v) => v.nom,
      vente: (v) => (v.vente ? 'Carte proposée' : 'Carte retirée'),
    },
    fin: { prix: (v) => v.finMontant, nom: (v) => `Au programme : ${v.nom}`, validation: (v) => v.finTitre },
    mails: {
      prix: (v) => `Montant estimé ${v.mailMontant}`,
      nom: (v) => `Offre ${v.nom}`,
      validation: (v) => (v.confirme ? 'Au client : « Réservation confirmée »' : 'Au client : « Demande reçue » · à l’équipe : « Réservation à valider »'),
    },
    comptoir: {
      prix: (v) => `${v.ticketNom}, ${v.joueurs} : ${v.ticketTotal}`,
      nom: (v) => v.ticketNom,
      vente: (v) => `Formules : ${v.plage}`,
      validation: (v) => `Dossier créé ici : ${v.dossier}`,
    },
    planning: { nom: (v) => v.court, validation: (v) => v.badge },
  };
  function tfApercuHtml(texteAvant, texteApres) {
    if (!texteApres) return '';
    if (texteAvant === texteApres) return `<p class="tf-ap">${esc(texteApres)}</p>`;
    return `<p class="tf-ap"><span class="tf-ap-avant">${esc(texteAvant)}</span><span aria-hidden="true"> → </span><span class="tf-sr">, devient </span><b>${esc(texteApres)}</b></p>`;
  }
  function tfChangementHtml(c) {
    const annuler = `<button type="button" class="tf-lien" data-tf-action="annuler-changement" data-tf-type="${c.type}" data-tf-id="${esc(c.id)}" data-tf-cible="${esc(c.champ)}" data-pl-focus="tf:annuler:${esc(c.id)}:${esc(c.champ)}">Annuler</button>`;
    if (c.type === 'grille') {
      const kase = tfCasesDeGrille(c.id).find((x) => x.cle === c.champ);
      const liees = tfActivites().filter((x) => x.nomGrille === c.id && x.seule);
      if (!kase || !liees.length) return '';
      const a = liees[0];
      const vA = tfValeursGrille(a, { champ: kase.champ, prix: kase.publie });
      const vN = tfValeursGrille(a, { champ: kase.champ, prix: kase.prix });
      const apercu = {
        formulaire: (v) => `${v.exempleQuoi} = ${v.exempleTotal}`,
        fin: (v) => v.finMontant,
        mails: (v) => `Montant estimé ${v.mailMontant}`,
        comptoir: (v) => `${v.offre}, ${v.ticketDetail} : ${v.ticketTotal}`,
      };
      const pied = tfPiedGrille(a);
      return `<section class="tf-chg" data-tf-changement="${esc(c.id)}|${esc(c.champ)}">
        <div class="tf-chg-tete"><h3>${esc(`${tfEt(liees.map((x) => x.nom))} · ${kase.long} : ${tfEuros(kase.publie)} → ${tfEuros(kase.prix)} ${tfUniteCase(kase)}`)}</h3>${annuler}</div>
        <dl class="tf-chg-lieux">
          ${tfLieuxGrille().map((lieu) => `<div><dt>${esc(TF_LIEUX_NOMS[lieu])}</dt><dd><p>${esc(tfPhraseGrille(lieu))}</p>${tfApercuHtml(apercu[lieu](vA), apercu[lieu](vN))}</dd></div>`).join('')}
          ${tfAutresCentres().length ? `<div><dt>${esc(tfEt(tfAutresCentres()))}</dt><dd><p>${esc(tfPasConcerneGrille())}</p>${vN.autres ? `<p class="tf-ap">${esc(vN.autres)}</p>` : ''}</dd></div>` : ''}
          <div class="is-note"><dt>Quand</dt><dd><p>${esc(pied.quand)}</p></dd></div>
          <div class="is-note"><dt>Pas touché</dt><dd><p>${esc(pied.pas)}</p></dd></div>
          ${pied.savoir ? `<div class="is-note is-savoir"><dt>À savoir</dt><dd><p>${esc(pied.savoir)}</p></dd></div>` : ''}
        </dl>
      </section>`;
    }
    if (c.type === 'activite') {
      const entree = tfActiviteEntree(c.id);
      if (!entree) return '';
      const apres = tfVueActivite(entree);
      const avant = { ...apres, prix: apres.publie };
      const titre = `${apres.nom} · Prix : ${avant.prix == null ? 'à l’accueil' : tfEuros(avant.prix)} → ${apres.prix == null ? 'à l’accueil' : tfEuros(apres.prix)}${apres.unitLabel ? ` ${apres.unitLabel}` : ''}`;
      const vA = tfValeursActivite(avant);
      const vN = tfValeursActivite(apres);
      const lieux = tfLieuxActivite(apres);
      return `<section class="tf-chg" data-tf-changement="${esc(c.id)}|${esc(c.champ)}">
        <div class="tf-chg-tete"><h3>${esc(titre)}</h3>${annuler}</div>
        <dl class="tf-chg-lieux">
          ${lieux.map((lieu) => `<div><dt>${esc(lieu === 'autres' ? tfEt(tfAutresCentres()) : TF_LIEUX_NOMS[lieu])}</dt><dd><p>${esc(tfPhraseActivite(lieu))}</p>${lieu === 'formulaire' ? tfApercuHtml(vA.des, vN.des) : lieu === 'comptoir' ? tfApercuHtml(`${vA.tuileNom} : ${vA.tuile}`, `${vN.tuileNom} : ${vN.tuile}`) : ''}</dd></div>`).join('')}
          <div class="is-note"><dt>Quand</dt><dd><p>${esc(TF_QUAND)}</p></dd></div>
          <div class="is-note"><dt>Pas touché</dt><dd><p>Le prix des formules qui la contiennent.</p></dd></div>
        </dl>
      </section>`;
    }
    const entry = pevEntry(c.id);
    if (!entry) return '';
    const apres = tfVueFormule(entry);
    const avant = tfVueFormule(entry, c.champ);
    const vA = tfValeursFormule(avant);
    const vN = tfValeursFormule(apres);
    const prix = (p) => (p == null ? 'aucun' : tfEuros(p));
    const nom = avant.valeur.nom;
    const unite = apres.parPiste ? 'la piste' : apres.enfants ? 'par enfant' : 'par personne';
    const titre = {
      prix: `${nom} · Prix : ${prix(avant.valeur.prix)} → ${prix(apres.valeur.prix)} ${unite}`,
      ancien: `${nom} · Prix barré : ${prix(avant.valeur.ancien)} → ${prix(apres.valeur.ancien)}`,
      nom: `${nom} · Nom : ${avant.valeur.nom} → ${apres.valeur.nom}`,
      vente: `${nom} · En vente : ${avant.valeur.vente ? 'proposée' : 'retirée'} → ${apres.valeur.vente ? 'proposée' : 'retirée'}`,
      validation: `${nom} · Validation par l’équipe : ${tfValidation(avant.valeur.validation).mot} → ${tfValidation(apres.valeur.validation).mot}`,
    }[c.champ] || nom;
    const pied = tfPied(c.champ, apres);
    const lieux = tfLieuxDe(c.champ, apres);
    return `<section class="tf-chg" data-tf-changement="${esc(c.id)}|${esc(c.champ)}">
      <div class="tf-chg-tete"><h3>${esc(titre)}</h3>${annuler}</div>
      <dl class="tf-chg-lieux">
        ${lieux.map((lieu) => {
          const apercu = TF_APERCU[lieu] && TF_APERCU[lieu][c.champ];
          return `<div><dt>${esc(TF_LIEUX_NOMS[lieu] || lieu)}</dt><dd><p>${esc(tfPhrase(c.champ, lieu, apres))}</p>${apercu ? tfApercuHtml(apercu(vA), apercu(vN)) : ''}</dd></div>`;
        }).join('')}
        <div class="is-note"><dt>Quand</dt><dd><p>${esc(pied.quand)}</p></dd></div>
        ${pied.pas ? `<div class="is-note"><dt>Pas touché</dt><dd><p>${esc(pied.pas)}</p></dd></div>` : ''}
        ${pied.savoir ? `<div class="is-note is-savoir"><dt>À savoir</dt><dd><p>${esc(pied.savoir)}</p></dd></div>` : ''}
      </dl>
    </section>`;
  }
  function tfTiroirHtml() {
    const changements = tfChangements();
    const n = changements.length;
    return `<div class="tf-t-tete">
        <div><h2 id="tfTiroirTitre">Ce qui change</h2><p>${n} ${n > 1 ? 'changements' : 'changement'} pour ${esc(tfNomCentre())}. Rien ne change pour vos clients avant « Publier ».</p></div>
        <button type="button" class="tf-t-fermer" data-tf-action="fermer-tiroir" data-pl-focus="tf:tiroir-fermer" aria-label="Fermer">${TF_ICO.fermer}</button>
      </div>
      <div class="tf-t-corps" data-tf-t-corps>${changements.map(tfChangementHtml).join('')}</div>
      <div class="tf-t-pied">
        ${tarifs.erreur ? `<p class="tf-barre-erreur" role="alert">${esc(tarifs.erreur)}</p>` : ''}
        <button type="button" class="pv2-btn" data-tf-action="annuler-tout" data-pl-focus="tf:t-annuler"${n && !tarifs.publication ? '' : ' disabled'}>Tout annuler</button>
        <button type="button" class="pv2-btn primary" data-tf-action="publier" data-pl-focus="tf:t-publier"${n && !tarifs.publication ? '' : ' disabled'}>${tarifs.publication ? 'Publication…' : 'Publier'}</button>
      </div>`;
  }
  function tfMajTiroir() {
    const tiroir = document.querySelector('#staffPricingPage [data-tf-tiroir]');
    if (!tiroir) return;
    if (!tarifs.tiroir) { tiroir.hidden = true; tiroir.innerHTML = ''; return; }
    const corps = tiroir.querySelector('[data-tf-t-corps]');
    const haut = corps ? corps.scrollTop : 0;
    tfAvecFocus(() => { tiroir.innerHTML = tfTiroirHtml(); tiroir.hidden = false; });
    const neuf = tiroir.querySelector('[data-tf-t-corps]');
    if (neuf) neuf.scrollTop = haut;
  }
  function tfOuvrirTiroir() {
    if (!tfNbChangements()) return;
    tarifs.tiroir = true;
    tfMajTiroir();
    tfMajBarre();
    const tiroir = document.querySelector('#staffPricingPage [data-tf-tiroir]');
    if (tiroir && tiroir.animate && !tfReduit()) tiroir.animate([{ transform: 'translateX(100%)' }, { transform: 'none' }], { duration: 260, easing: tfEasing() });
    const fermer = document.querySelector('#staffPricingPage [data-tf-tiroir] .tf-t-fermer');
    if (fermer) fermer.focus({ preventScroll: true });
  }
  function tfFermerTiroir() {
    if (!tarifs.tiroir) return;
    tarifs.tiroir = false;
    tfMajTiroir();
    tfMajBarre();
    const voir = document.querySelector('#staffPricingPage [data-tf-action="voir"]');
    if (voir) voir.focus({ preventScroll: true });
  }

  // ---- LE MOUVEMENT : LES FILS, LE POINT, LA VALEUR QUI ROULE --------------------
  function tfChemin(x0, y0, lx, y1, x1, rayon) {
    if (Math.abs(y1 - y0) < 1) return `M${x0} ${y0}H${x1}`;
    const s = y1 > y0 ? 1 : -1;
    const r = Math.min(rayon, Math.abs(y1 - y0) / 2);
    return `M${x0} ${y0}H${lx - r}Q${lx} ${y0} ${lx} ${y0 + s * r}V${y1 - s * r}Q${lx} ${y1} ${lx + r} ${y1}H${x1}`;
  }
  // LA GEOMETRIE : ou partent les fils (le bout du controle de chaque
  // reglage), ou ils entrent (le bord gauche de chaque endroit, a hauteur de
  // sa premiere ligne), le tronc au milieu de la gouttiere. En mise en page
  // empilee (pas de gouttiere), il n y a pas de fil : les etats suffisent.
  function tfDessiner() {
    const planche = tfPlanche();
    const cab = planche && planche.querySelector('[data-tf-cablage]');
    const svg = cab && cab.querySelector('svg[data-tf-fils]');
    if (!svg) { tarifs.geo = null; return; }
    const rc = cab.getBoundingClientRect();
    const gouttiere = cab.querySelector('.tf-gouttiere').getBoundingClientRect();
    if (!rc.width || gouttiere.width < 24) { tarifs.geo = null; svg.innerHTML = ''; tarifs.signature = ''; return; }
    const geo = { r: {}, l: {}, x: Math.round((gouttiere.left + gouttiere.right) / 2 - rc.left) + 0.5 };
    planche.querySelectorAll('[data-tf-r]').forEach((row) => {
      const port = row.querySelector('[data-tf-port]') || row;
      const b = port.getBoundingClientRect();
      if (b.width) geo.r[row.getAttribute('data-tf-r')] = { x: Math.round(b.right - rc.left) + 12, y: Math.round(b.top + b.height / 2 - rc.top) + 0.5 };
    });
    planche.querySelectorAll('[data-tf-lieu]').forEach((el) => {
      const m = el.querySelector('.tf-mini').getBoundingClientRect();
      if (m.width) geo.l[el.getAttribute('data-tf-lieu')] = { x: Math.round(m.left - rc.left), y: Math.round(m.top - rc.top) + 15.5 };
    });
    svg.setAttribute('width', String(Math.round(rc.width)));
    svg.setAttribute('height', String(Math.round(rc.height)));
    svg.setAttribute('viewBox', `0 0 ${Math.round(rc.width)} ${Math.round(rc.height)}`);
    const signature = JSON.stringify(geo);
    tarifs.geo = geo;
    if (signature === tarifs.signature && svg.querySelector('.tf-trace')) return;
    tarifs.signature = signature;
    // Le trace en cours se recale sans repartir : ses animations continuent.
    const trace = svg.querySelector('.tf-trace');
    if (trace && trace.getAttribute('data-tf-champ') === tarifs.trace) { tfRecaler(trace); return; }
    tfTracer(tarifs.trace, false);
  }
  function tfTraits(champ) {
    const geo = tarifs.geo;
    const ctx = tfContexte();
    if (!geo || !ctx || !champ || !geo.r[champ]) return [];
    const a = geo.r[champ];
    const lx = geo.x;
    return tfLieuxActifs(ctx, champ, ctx.vue()).filter((l) => geo.l[l]).map((lieu) => {
      const b = geo.l[lieu];
      const tronc = Math.abs(lx - a.x) + Math.abs(b.y - a.y);
      return { lieu, a, b, lx, d: tfChemin(a.x, a.y, lx, b.y, b.x - 4, 5), longueur: tronc + Math.abs(b.x - 4 - lx), tronc };
    });
  }
  function tfRecaler(trace) {
    tfTraits(trace.getAttribute('data-tf-champ')).forEach((t) => {
      const fil = trace.querySelector(`[data-tf-fil="${t.lieu}"]`);
      if (fil) fil.setAttribute('d', t.d);
      const noeud = trace.querySelector(`[data-tf-fil-noeud="${t.lieu}"]`);
      if (noeud) { noeud.setAttribute('cx', String(t.lx)); noeud.setAttribute('cy', String(t.b.y)); }
      const port = trace.querySelector(`[data-tf-fil-port="${t.lieu}"]`);
      if (port) { port.setAttribute('cx', String(t.b.x - 1)); port.setAttribute('cy', String(t.b.y)); }
      const depart = trace.querySelector('[data-tf-fil-depart]');
      if (depart) { depart.setAttribute('cx', String(t.a.x - 3)); depart.setAttribute('cy', String(t.a.y)); }
    });
  }
  // LE TRACE d un seul reglage : ses fils se dessinent de la saisie vers
  // chaque endroit touche, a vitesse constante, 280 ms pour le plus long ;
  // chaque endroit s allume quand son fil l atteint (--tf-arrivee).
  function tfTracer(champ, anime) {
    tarifs.trace = champ || '';
    tarifs.arrivees = {};
    const planche = tfPlanche();
    const svg = planche && planche.querySelector('svg[data-tf-fils]');
    if (!svg) return;
    const traits = tfTraits(champ);
    const ancien = svg.querySelector('.tf-trace');
    if (!traits.length) {
      if (ancien && anime && !tfReduit() && ancien.animate) {
        ancien.removeAttribute('data-tf-champ');
        ancien.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: 'forwards' }).finished.then(() => ancien.remove()).catch(() => ancien.remove());
      } else if (ancien) ancien.remove();
      return;
    }
    const mouvement = anime && !tfReduit();
    const max = Math.max(...traits.map((t) => t.longueur));
    traits.forEach((t) => { tarifs.arrivees[t.lieu] = mouvement ? Math.round((TF_TRACE_MS * t.longueur) / max) : 0; });
    svg.querySelectorAll('.tf-trace').forEach((g) => g.remove());
    const a = traits[0].a;
    svg.insertAdjacentHTML('beforeend', `<g class="tf-trace" data-tf-champ="${champ}">
      ${traits.map((t) => `<path class="tf-fil" pathLength="1" data-tf-fil="${t.lieu}" d="${t.d}"/>`).join('')}
      ${traits.map((t) => `<circle class="tf-noeud" data-tf-fil-noeud="${t.lieu}" cx="${t.lx}" cy="${t.b.y}" r="2.25"/>`).join('')}
      ${traits.map((t) => `<circle class="tf-port is-lieu" data-tf-fil-port="${t.lieu}" cx="${t.b.x - 1}" cy="${t.b.y}" r="3"/>`).join('')}
      <circle class="tf-port" data-tf-fil-depart cx="${a.x - 3}" cy="${a.y}" r="3"/>
    </g>`);
    if (!mouvement) return;
    const g = svg.querySelector('.tf-trace');
    const ease = tfEasing();
    traits.forEach((t) => {
      const duree = (TF_TRACE_MS * t.longueur) / max;
      const fil = g.querySelector(`[data-tf-fil="${t.lieu}"]`);
      if (fil && fil.animate) fil.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: duree, easing: ease, fill: 'backwards' });
      const montrer = (el, quand) => { if (el && el.animate) el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, delay: quand, fill: 'backwards' }); };
      montrer(g.querySelector(`[data-tf-fil-noeud="${t.lieu}"]`), (duree * t.tronc) / t.longueur);
      montrer(g.querySelector(`[data-tf-fil-port="${t.lieu}"]`), Math.max(0, duree - 40));
    });
  }
  // LA VALEUR VISEE : dans chaque endroit, ce que le reglage en main change
  // vraiment prend la couleur d accent (B-fils-1-prix.png). Le reste du mini
  // ne bouge pas : on voit d un coup quel chiffre est concerne.
  const TF_VISE = {
    prix: ['prix', 'remise', 'bandeTotal', 'finMontant', 'mailMontant', 'ticketTotal', 'des', 'total', 'tuile'],
    ancien: ['ancien', 'remise'],
    nom: ['nom', 'ticketNom', 'court'],
    vente: ['plage'],
    validation: ['finTitre', 'finTexte', 'mailObjet', 'dossier', 'badge'],
    structure: ['duree'],
  };
  // L ETAT DES ENDROITS pour le champ en main : « concerne » (bord accent) ou
  // « pas-concerne » (attenue, avec sa legende). Ce sont des informations,
  // pas du mouvement : elles restent avec prefers-reduced-motion.
  function tfAllumer({ anime = true } = {}) {
    const planche = tfPlanche();
    const ctx = tfContexte();
    if (!planche || !ctx) return;
    const champ = tarifs.focus;
    const vue = ctx.vue();
    const lieux = tfLieuxActifs(ctx, champ, vue);
    const svg = planche.querySelector('svg[data-tf-fils]');
    if (champ !== tarifs.trace || (champ && svg && !svg.querySelector('.tf-trace'))) tfTracer(champ, anime);
    planche.querySelectorAll('[data-tf-r]').forEach((row) => row.classList.toggle('is-actif', Boolean(champ) && row.getAttribute('data-tf-r') === champ));
    const vises = tfEstCase(champ) ? tfVisesCase(champ, vue) : (champ && TF_VISE[champ]) || [];
    planche.querySelectorAll('[data-tf-val]').forEach((el) => el.classList.toggle('is-vise', vises.includes(el.getAttribute('data-tf-val'))));
    planche.querySelectorAll('[data-tf-lie]').forEach((el) => el.classList.toggle('is-vise', el.getAttribute('data-tf-lie') === champ));
    planche.querySelectorAll('[data-tf-lieu]').forEach((el) => {
      const lieu = el.getAttribute('data-tf-lieu');
      const touche = lieux.includes(lieu);
      el.style.setProperty('--tf-arrivee', `${touche ? (tarifs.arrivees[lieu] || 0) : 0}ms`);
      el.setAttribute('data-tf-etat', !champ ? 'repos' : touche ? 'concerne' : 'pas-concerne');
      const phrase = el.querySelector('[data-tf-phrase]');
      if (!phrase) return;
      let texte = phrase.getAttribute('data-tf-repos') || '';
      if (champ && touche) texte = ctx.type === 'formule' ? tfPhrase(champ, lieu, vue) : tfEstCase(champ) ? tfPhraseGrille(lieu) : tfPhraseActivite(lieu);
      else if (champ && lieu === 'autres' && tfEstCase(champ)) texte = tfPasConcerneGrille();
      else if (champ) texte = lieu === 'autres' && ctx.type === 'formule' && champ !== 'structure' ? tfPasConcerneAutres() : 'Pas concerné';
      if (phrase.textContent !== texte) phrase.textContent = texte;
    });
    if (ctx.type === 'formule') {
      const editable = !vue.custom && tfPeutTarifs();
      tfMajPied(tfPied(champ || (editable ? 'prix' : 'structure'), vue));
    }
  }
  function tfMajPied(pied) {
    const zone = document.querySelector('#staffPricingPage [data-tf-planche] [data-tf-pied]');
    if (!zone) return;
    ['pas', 'savoir', 'qui', 'quand'].forEach((cle) => {
      const ligne = zone.querySelector(`[data-tf-pied-l="${cle}"]`);
      const valeur = zone.querySelector(`[data-tf-pied-v="${cle}"]`);
      if (!ligne || !valeur) return;
      if (valeur.textContent !== pied[cle]) valeur.textContent = pied[cle];
      ligne.hidden = !pied[cle];
    });
  }
  function tfAnnulerGouttes() {
    tarifs.gouttes.forEach((a) => { try { a.cancel(); } catch (e) { /* deja finie */ } });
    tarifs.gouttes = [];
    document.querySelectorAll('#staffPricingPage .tf-goutte').forEach((g) => g.remove());
  }
  // LE POINT parcourt le fil (400 ms) ; la promesse dit s il est arrive.
  function tfGoutte(champ, lieu, delai) {
    const geo = tarifs.geo;
    const cab = document.querySelector('#staffPricingPage [data-tf-planche] [data-tf-cablage]');
    if (!geo || !cab || !geo.r[champ] || !geo.l[lieu] || !document.body.animate) return Promise.resolve(false);
    const a = geo.r[champ];
    const b = geo.l[lieu];
    const points = [[a.x - 3, a.y], [geo.x, a.y], [geo.x, b.y], [b.x - 1, b.y]];
    const longueurs = points.slice(1).map((p, i) => Math.abs(p[0] - points[i][0]) + Math.abs(p[1] - points[i][1]));
    const total = longueurs.reduce((s, x) => s + x, 0) || 1;
    let cumul = 0;
    const images = points.map((p, i) => {
      if (i) cumul += longueurs[i - 1];
      return { transform: `translate(${p[0]}px, ${p[1]}px)`, offset: cumul / total };
    });
    const point = document.createElement('span');
    point.className = 'tf-goutte';
    point.setAttribute('aria-hidden', 'true');
    cab.appendChild(point);
    const trajet = point.animate(images, { duration: TF_GOUTTE_MS, delay: delai, easing: tfEasing(), fill: 'both' });
    const fondu = point.animate([{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 1, offset: 0.86 }, { opacity: 0 }], { duration: TF_GOUTTE_MS, delay: delai, fill: 'both' });
    tarifs.gouttes.push(trajet, fondu);
    return trajet.finished.then(() => { point.remove(); return true; }).catch(() => { point.remove(); return false; });
  }
  // LA VALEUR ROULE : l ancienne monte et s efface, la nouvelle entre par le
  // bas (220 ms, transform et opacity). Une frappe pendant le roulement
  // repart du texte vise, jamais d un melange des deux.
  const tfTexteVise = (el) => (el.dataset.tfVise != null ? el.dataset.tfVise : el.textContent);
  function tfPoserTexte(el, texte) {
    if (el.dataset.tfVise != null) { el.getAnimations({ subtree: true }).forEach((a) => a.cancel()); delete el.dataset.tfVise; el.classList.remove('tf-roule'); }
    el.textContent = texte;
  }
  function tfRouler(el, texte) {
    const avant = tfTexteVise(el);
    if (avant === texte) return;
    if (tfReduit() || !el.animate) { tfPoserTexte(el, texte); return; }
    if (el.dataset.tfVise != null) el.getAnimations({ subtree: true }).forEach((a) => a.cancel());
    el.dataset.tfVise = texte;
    el.classList.add('tf-roule');
    const vieux = document.createElement('span');
    vieux.className = 'tf-roule-vieux';
    vieux.setAttribute('aria-hidden', 'true');
    vieux.textContent = avant;
    const neuf = document.createElement('span');
    neuf.className = 'tf-roule-neuf';
    neuf.textContent = texte;
    el.replaceChildren(neuf, vieux);
    const ease = tfEasing();
    vieux.animate([{ transform: 'translateY(0)', opacity: 1 }, { transform: 'translateY(-70%)', opacity: 0 }], { duration: TF_ROULE_MS, easing: ease, fill: 'forwards' });
    neuf.animate([{ transform: 'translateY(70%)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }], { duration: TF_ROULE_MS, easing: ease, fill: 'backwards' })
      .finished.then(() => { if (el.dataset.tfVise === texte) { delete el.dataset.tfVise; el.classList.remove('tf-roule'); el.textContent = texte; } }).catch(() => {});
  }
  // L ENDROIT S ECLAIRE : un anneau accent qui apparait puis s efface (600 ms,
  // opacity seulement).
  function tfEclat(el) {
    if (!el || tfReduit() || !el.animate) return;
    const anneau = document.createElement('span');
    anneau.className = 'tf-eclat';
    anneau.setAttribute('aria-hidden', 'true');
    el.appendChild(anneau);
    anneau.animate([{ opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 0 }], { duration: TF_ECLAT_MS, easing: 'linear' })
      .finished.then(() => anneau.remove()).catch(() => anneau.remove());
  }
  // Pose les valeurs d un endroit : textes (qui roulent si demande),
  // presences, classes. Rend vrai si quelque chose a change.
  function tfAppliquer(lieuEl, vals, rouler) {
    let change = false;
    lieuEl.querySelectorAll('[data-tf-val]').forEach((el) => {
      const cle = el.getAttribute('data-tf-val');
      if (!(cle in vals)) return;
      const texte = vals[cle] == null ? '' : String(vals[cle]);
      if (!el.hasAttribute('data-tf-si') && !el.hasAttribute('data-tf-sinon') && el.hidden !== (texte === '')) { el.hidden = texte === ''; change = true; }
      if (texte === '' || tfTexteVise(el) === texte) return;
      change = true;
      if (rouler && !el.hidden) tfRouler(el, texte); else tfPoserTexte(el, texte);
    });
    lieuEl.querySelectorAll('[data-tf-si]').forEach((el) => { const cache = !vals[el.getAttribute('data-tf-si')]; if (el.hidden !== cache) { el.hidden = cache; change = true; } });
    lieuEl.querySelectorAll('[data-tf-sinon]').forEach((el) => { const cache = Boolean(vals[el.getAttribute('data-tf-sinon')]); if (el.hidden !== cache) { el.hidden = cache; change = true; } });
    lieuEl.querySelectorAll('[data-tf-classe]').forEach((el) => {
      const [classe, cle] = el.getAttribute('data-tf-classe').split(':');
      const on = Boolean(vals[cle]);
      if (el.classList.contains(classe) !== on) { el.classList.toggle(classe, on); change = true; }
    });
    return change;
  }
  // UN REGLAGE A CHANGE : un point parcourt chaque fil allume, et chaque
  // endroit touche fait rouler sa valeur a l arrivee puis s eclaire. Sans fil
  // (reglage pose sans focus, mise en page empilee, mouvement reduit), tout
  // se pose tout de suite.
  function tfPropager(champ, { direct = false } = {}) {
    const planche = tfPlanche();
    const ctx = tfContexte();
    if (!planche || !ctx) return;
    const vue = ctx.vue();
    const vals = ctx.type === 'formule' ? tfValeursFormule(vue) : tfValeursActivite(vue);
    tfMajControles(planche, ctx, vue);
    tfAnnulerGouttes();
    const enMouvement = !direct && !tfReduit() && tarifs.geo && tarifs.trace === champ;
    const touches = enMouvement ? tfLieuxActifs(ctx, champ, vue).filter((l) => tarifs.geo.l[l]) : [];
    planche.querySelectorAll('[data-tf-lieu]').forEach((el) => {
      if (!touches.includes(el.getAttribute('data-tf-lieu'))) tfAppliquer(el, vals, false);
    });
    touches.forEach((lieu, i) => {
      const el = planche.querySelector(`[data-tf-lieu="${lieu}"]`);
      if (!el) return;
      tfGoutte(champ, lieu, i * 90).then((arrive) => {
        if (!el.isConnected) return;
        const valeurs = tfValeursCourantes();
        if (!valeurs) return;
        if (tfAppliquer(el, valeurs, arrive) && arrive) tfEclat(el.querySelector('.tf-mini'));
      });
    });
    if (ctx.type === 'formule') tfMajPied(tfPied(tarifs.focus || 'prix', vue));
  }
  // Les controles qu un clic change (interrupteur, validation, aide du prix).
  function tfMajControles(planche, ctx, vue) {
    if (ctx.type !== 'formule' || !vue.valeur) return;
    const v = vue.valeur;
    const bascule = planche.querySelector('[data-tf-champ="vente"]');
    if (bascule) { bascule.classList.toggle('is-on', Boolean(v.vente)); bascule.setAttribute('aria-checked', String(Boolean(v.vente))); }
    const dit = planche.querySelector('[data-tf-dit-vente]');
    if (dit) dit.textContent = v.vente ? 'Proposée à vos clients' : 'Retirée de la vente';
    planche.querySelectorAll('[data-tf-valid]').forEach((b) => {
      const on = b.getAttribute('data-tf-valid') === v.validation;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    const ditValid = planche.querySelector('[data-tf-dit-valid]');
    if (ditValid) ditValid.textContent = tfValidation(v.validation).dit;
  }
  function tfMajAide(type, champ, brut, valide) {
    const aide = document.querySelector(`#staffPricingPage [data-tf-planche] [data-tf-aide="${champ}"]`);
    if (!aide) return;
    const texte = tfTexteAide(type, champ, brut, valide);
    aide.textContent = texte;
    aide.hidden = !texte;
    aide.classList.toggle('is-erreur', !valide);
  }
  function tfMajLigne(type, id) {
    const ligne = document.querySelector(`#staffPricingPage ${type === 'activite' ? `[data-tf-act="${CSS.escape(id)}"]` : `[data-tf-ligne="${CSS.escape(id)}"]`}`);
    if (!ligne) return;
    const entree = type === 'activite' ? tfActiviteEntree(id) : null;
    const b = type === 'activite' ? null : tfBrouillonFormule(id);
    const modifie = type === 'activite' ? Boolean(entree && tfVueActivite(entree).modifie) : Boolean(b && Object.keys(b).length);
    ligne.classList.toggle('is-modifiee', modifie);
    ligne.querySelectorAll('[data-tf-point],[data-tf-modifie]').forEach((el) => { el.hidden = !modifie; });
  }
  function tfApresPose(type, id, champ, { attendre = false } = {}) {
    tfMajLigne(type, id);
    tfMajBarre();
    tfMajTiroir();
    clearTimeout(tarifs.minuteurs.frappe);
    if (attendre && !tfReduit()) tarifs.minuteurs.frappe = setTimeout(() => tfPropager(champ), TF_FRAPPE_MS);
    else tfPropager(champ);
  }

  // ---- PUBLIER --------------------------------------------------------------------
  // Un POST par formule, signe du centre AFFICHE (pevBody), avec les seuls
  // champs changes (le contrat de l ancienne modale, pevComputePatch). Un prix
  // barre vide part a 0 : null retombait sur le catalogue (booking-config.js:888)
  // et le prix barre ne s enlevait jamais.
  function tfPatchFormule(entry, b) {
    const eff = entry.effective || {};
    const patch = {};
    if ('nom' in b) patch.name = String(b.nom).replace(/\s+/g, ' ').trim().slice(0, PEV_NAME_MAX);
    if ('prix' in b) patch.priceValue = b.prix;
    if ('ancien' in b) patch.priceOld = b.ancien == null ? 0 : b.ancien;
    if ('vente' in b) {
      patch.enabled = Boolean(b.vente);
      // Une formule « retirée » (l ancien interrupteur) revient en vente entiere.
      if (b.vente && eff.removed) patch.removed = false;
    }
    if ('validation' in b) patch.humanValidation = b.validation;
    return patch;
  }
  // La valeur publiee se pose tout de suite (pas de retour en arriere le temps
  // du rechargement), pevReload confirme ensuite depuis le serveur.
  function tfPoserPublie(type, id, patch) {
    if (type === 'grilles') { tfPoserGrillesPubliees(patch); return; }
    if (type === 'activite') {
      const a = tfActiviteEntree(id);
      if (a && 'priceValue' in patch) a.priceValue = patch.priceValue;
      return;
    }
    const entry = pevEntry(id);
    if (!entry) return;
    const eff = entry.effective || (entry.effective = {});
    const CLES = { name: 'name', priceValue: 'priceValue', priceOld: 'priceOld', enabled: 'enabled', removed: 'removed', humanValidation: 'humanValidation' };
    Object.keys(patch).forEach((k) => { if (CLES[k]) eff[CLES[k]] = patch[k]; });
    entry.centerOverride = { ...(entry.centerOverride || {}), ...patch };
  }
  async function tfPublier() {
    const resultat = { publies: 0, refuses: [] };
    if (tarifs.publication) return resultat;
    const lot = tfLot(false);
    if (!tfNbChangements(lot)) return resultat;
    const centre = tfNomCentre();
    const envois = [];
    Object.entries(lot.formules).forEach(([id, b]) => {
      const entry = pevEntry(id);
      if (!entry || entry.source === 'custom') { resultat.refuses.push({ type: 'formule', id, champs: Object.keys(b), message: 'Formule inconnue pour ce centre.' }); return; }
      const patch = tfPatchFormule(entry, b);
      if ('name' in patch && !patch.name) { resultat.refuses.push({ type: 'formule', id, champs: Object.keys(b), message: 'Le nom ne peut pas rester vide.' }); return; }
      envois.push({ type: 'formule', id, nom: tfPublieFormule(entry).nom, champs: Object.keys(b), patch, corps: { action: 'saveClientFormuleOverride', formuleId: id, patch } });
    });
    Object.entries(lot.activites).forEach(([id, b]) => {
      const entree = tfActiviteEntree(id);
      if (!entree || !('prix' in b)) return;
      const patch = { priceValue: b.prix };
      envois.push({ type: 'activite', id, nom: String(entree.name || id), champs: ['prix'], patch, corps: { action: 'updateActivity', id, patch } });
    });
    const cases = Object.keys(lot.grilles);
    if (cases.length) {
      const demande = tfDemandeGrilles(lot.grilles);
      envois.push({ type: 'grilles', id: 'grilles', nom: 'ces prix', champs: cases, patch: demande, corps: { action: 'saveGrillesTarif', grilles: demande } });
    }
    tarifs.publication = true;
    tarifs.erreur = '';
    tfMajBarre();
    tfMajTiroir();
    // Une valeur tapee pendant l envoi se perdrait a la reponse, sans un mot : les champs
    // attendent. Le rendu par zones ne les recree pas toujours, ils se rouvrent ici.
    const champsFiges = (figes) => document.querySelectorAll('#staffPricingPage input[data-tf-champ]').forEach((champ) => { champ.readOnly = figes; });
    champsFiges(true);
    const reponses = await Promise.allSettled(envois.map((e) => apiRequest(tfOps(), { method: 'POST', body: pevBody(e.corps) })));
    reponses.forEach((r, i) => {
      const e = envois[i];
      if (r.status === 'fulfilled') {
        tfPoserPublie(e.type, e.id, e.patch);
        if (e.type === 'grilles') {
          e.champs.forEach((brut) => {
            const { nom, cle } = tfLireCase(`grille:${brut}`);
            delete lot.grilles[brut];
            delete tarifs.saisies[tfCleSaisie('grille', nom, cle)];
          });
        } else {
          const groupe = e.type === 'formule' ? lot.formules : lot.activites;
          delete groupe[e.id];
          tfOublierSaisies(e.type, e.id);
        }
        resultat.publies += e.champs.length;
      } else {
        resultat.refuses.push({ type: e.type, id: e.id, nom: e.nom, champs: e.champs, message: (r.reason && r.reason.message) || 'Refusé par le serveur.' });
      }
    });
    tarifs.publication = false;
    champsFiges(false);
    if (resultat.refuses.length) {
      const premier = resultat.refuses[0];
      tarifs.erreur = `Refusé pour ${premier.nom || premier.id} : ${premier.message}${resultat.publies ? ' Le reste est publié.' : ' Rien n’a changé pour vos clients.'}`;
    } else tarifs.erreur = '';
    if (!tfNbChangements()) tarifs.tiroir = false;
    if (resultat.publies) {
      pevToast(`${tfPluriel(resultat.publies, 'changement')} ${resultat.publies > 1 ? 'publiés' : 'publié'} pour ${centre}`);
      pevReload();
    }
    tfRepeindre();
    return resultat;
  }

  function tfAnnulerTout() {
    const centre = tfCentre();
    delete tarifs.brouillons[centre];
    Object.keys(tarifs.saisies).forEach((cle) => { if (cle.startsWith(`${centre}|`)) delete tarifs.saisies[cle]; });
    tarifs.erreur = '';
    tarifs.tiroir = false;
    tfRendre();
  }
  function tfAnnulerChangement(type, id, champ) {
    const lot = tfLot(false);
    if (lot && type === 'grille') {
      delete lot.grilles[`${id}:${champ}`];
    } else {
      const groupe = lot && (type === 'activite' ? lot.activites : lot.formules);
      if (!groupe || !groupe[id]) return;
      delete groupe[id][champ];
      if (!Object.keys(groupe[id]).length) delete groupe[id];
    }
    delete tarifs.saisies[tfCleSaisie(type, id, champ)];
    if (!tfNbChangements()) tarifs.tiroir = false;
    tarifs.erreur = '';
    tfRendre();
    const suite = document.querySelector('#staffPricingPage [data-tf-tiroir] [data-tf-action="annuler-changement"]')
      || document.querySelector('#staffPricingPage [data-tf-tiroir] .tf-t-fermer')
      || document.getElementById(`tfOnglet-${tfOnglet()}`);
    if (suite) suite.focus({ preventScroll: true });
  }
  // « Revenir au catalogue » : le centre abandonne SES valeurs (prix, nom,
  // mise en vente, validation) pour celles du catalogue de l entreprise.
  function tfRevenirAuCatalogue(id) {
    const entry = pevEntry(id);
    if (!entry || !entry.centerOverride) return;
    const MOTS = { name: 'le nom', priceValue: 'le prix', priceOld: 'le prix barré', enabled: 'la mise en vente', removed: 'la mise en vente', humanValidation: 'la validation par l’équipe' };
    const quoi = [...new Set(Object.keys(entry.centerOverride).map((k) => MOTS[k]).filter(Boolean))];
    const nom = tfPublieFormule(entry).nom;
    if (!window.confirm(`Revenir au catalogue pour ${nom} ? À ${tfNomCentre()}, ${tfEt(quoi)} ${quoi.length > 1 ? 'reprennent leur' : 'reprend sa'} valeur du catalogue de l’entreprise.`)) return;
    apiRequest(tfOps(), { method: 'POST', body: pevBody({ action: 'resetClientFormuleOverride', formuleId: id }) })
      .then(() => {
        const lot = tfLot(false);
        if (lot) delete lot.formules[id];
        tfOublierSaisies('formule', id);
        pevToast(`${nom} reprend les valeurs du catalogue.`);
        pevReload();
      })
      .catch((error) => pevToast((error && error.message) || 'Retour au catalogue refusé. Réessayez.'));
  }
  function tfVersEtablissement() {
    if (typeof state !== 'undefined' && state) state.establishmentTab = 'offres';
    if (typeof openStaffMenuPage === 'function') openStaffMenuPage('establishment');
  }

  // ---- LES GESTES (un ecouteur par type d evenement, pose une fois) ----------------
  function tfDefileur(el) {
    let n = el && el.parentElement;
    while (n && n !== document.body) {
      const s = getComputedStyle(n);
      if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight) return n;
      n = n.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }
  function tfOuvrir(type, id, { prix = false } = {}) {
    const cle = type === 'activite' ? 'activites' : 'formules';
    const attribut = type === 'activite' ? 'data-tf-ouvrir-act' : 'data-tf-ouvrir';
    const selecteur = `#staffPricingPage .tf-ligne-btn[${attribut}="${CSS.escape(id)}"]`;
    const avant = document.querySelector(selecteur);
    const haut = avant ? avant.getBoundingClientRect().top : null;
    tarifs.ouvert[cle] = tarifs.ouvert[cle] === id && !prix ? '' : id;
    tarifs.focus = '';
    tfRendre();
    const apres = document.querySelector(selecteur);
    // La ligne reste sous le doigt : fermer la planche du dessus ne la fait
    // pas sauter.
    if (apres && haut != null) {
      const decalage = apres.getBoundingClientRect().top - haut;
      if (decalage) tfDefileur(apres).scrollTop += decalage;
    }
    const planche = tarifs.ouvert[cle] === id ? tfPlanche() : null;
    if (planche && planche.animate && !tfReduit()) planche.animate([{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: tfEasing() });
    if (prix && tarifs.ouvert[cle] === id) {
      const champ = document.querySelector('#staffPricingPage [data-tf-planche] input[data-tf-champ="prix"], #staffPricingPage [data-tf-planche] input[data-tf-champ^="grille:"]');
      if (champ) {
        champ.focus({ preventScroll: true });
        champ.select();
        champ.scrollIntoView({ block: 'nearest' });
        return;
      }
    }
    if (apres) apres.focus({ preventScroll: true });
  }
  function tfChoisirOnglet(cle) {
    if (!TF_ONGLETS.includes(cle)) return;
    state.staffPricingTab = cle;
    if (typeof save === 'function') save();
    tarifs.focus = '';
    tfRendre();
    const onglet = document.getElementById(`tfOnglet-${cle}`);
    if (onglet) onglet.focus({ preventScroll: true });
  }
  function tfChangerGroupe(valeur) {
    const n = Math.min(TF_GROUPE_MAX, Math.max(TF_GROUPE_MIN, Math.round(Number(valeur)) || TF_GROUPE_MIN));
    const champ = document.querySelector('#staffPricingPage [data-tf-groupe]');
    if (champ && document.activeElement !== champ && champ.value !== String(n)) champ.value = String(n);
    if (n === tarifs.groupe) return;
    tarifs.groupe = n;
    const planche = tfPlanche();
    const valeurs = tfValeursCourantes();
    if (planche && valeurs) {
      // Le groupe n est pas un reglage : les totaux roulent, sans fil.
      planche.querySelectorAll('[data-tf-lieu]').forEach((el) => tfAppliquer(el, valeurs, true));
      const reference = planche.querySelector('[data-tf-ref]');
      if (reference) reference.textContent = planche.getAttribute('data-tf-type') === 'activite' ? `pour ${tfPluriel(n, 'personne')}` : `pour ${tfPluriel(n, 'personne')}, ${tfDateLisible(tfDateReference())}`;
      if (planche.getAttribute('data-tf-type') === 'formule') tfChargerDurees();
    }
    tfMajTiroir();
  }
  function tfSurClic(e) {
    const cible = e.target instanceof Element ? e.target : null;
    if (!cible || cible.closest('#smSection')) return;
    const el = cible.closest('[data-tf-onglet],[data-tf-ouvrir],[data-tf-prix],[data-tf-ouvrir-act],[data-tf-prix-act],button[data-tf-champ="vente"],[data-tf-valid],[data-tf-action],[data-add-formula],[data-cev-steps],[data-cev-fields],[data-cev-delete]');
    if (!el || el.disabled) return;
    if (el.hasAttribute('data-tf-onglet')) { tfChoisirOnglet(el.getAttribute('data-tf-onglet')); return; }
    if (el.hasAttribute('data-tf-prix')) { tfOuvrir('formule', el.getAttribute('data-tf-prix'), { prix: true }); return; }
    if (el.hasAttribute('data-tf-ouvrir')) { tfOuvrir('formule', el.getAttribute('data-tf-ouvrir')); return; }
    if (el.hasAttribute('data-tf-prix-act')) { tfOuvrir('activite', el.getAttribute('data-tf-prix-act'), { prix: true }); return; }
    if (el.hasAttribute('data-tf-ouvrir-act')) { tfOuvrir('activite', el.getAttribute('data-tf-ouvrir-act')); return; }
    if (el.hasAttribute('data-add-formula')) { cevOpenCreate(el.getAttribute('data-add-formula')); return; }
    if (el.hasAttribute('data-cev-steps')) { cevOpenSteps(el.getAttribute('data-cev-steps')); return; }
    if (el.hasAttribute('data-cev-fields')) { cevOpenFields(el.getAttribute('data-cev-fields')); return; }
    if (el.hasAttribute('data-cev-delete')) { cevDelete(el.getAttribute('data-cev-delete')); return; }
    const ctx = tfContexte();
    if (el.matches('[data-tf-champ="vente"]') && ctx && ctx.type === 'formule') {
      const vue = ctx.vue();
      tfPoserFormule(ctx.id, 'vente', !vue.valeur.vente);
      tarifs.focus = 'vente';
      tfAllumer({ anime: true });
      tfApresPose('formule', ctx.id, 'vente');
      return;
    }
    if (el.hasAttribute('data-tf-valid') && ctx && ctx.type === 'formule') {
      tfPoserFormule(ctx.id, 'validation', el.getAttribute('data-tf-valid'));
      el.focus({ preventScroll: true });
      tarifs.focus = 'validation';
      tfAllumer({ anime: true });
      tfApresPose('formule', ctx.id, 'validation');
      return;
    }
    const action = el.getAttribute('data-tf-action');
    if (action === 'copier') { if (typeof copyStaffPricingSummary === 'function') copyStaffPricingSummary(); return; }
    if (action === 'exporter') { if (typeof exportStaffPricingCsv === 'function') exportStaffPricingCsv(); return; }
    if (action === 'categorie') { cevOpenCreate(); return; }
    if (action === 'reessayer') { pevRetryCatalog(); return; }
    if (action === 'groupe-moins' || action === 'groupe-plus') { tfChangerGroupe(tarifs.groupe + (action === 'groupe-plus' ? 1 : -1)); return; }
    if (action === 'voir') { tfOuvrirTiroir(); return; }
    if (action === 'fermer-tiroir') { tfFermerTiroir(); return; }
    if (action === 'annuler-tout') { tfAnnulerTout(); return; }
    if (action === 'annuler-changement') { tfAnnulerChangement(el.getAttribute('data-tf-type'), el.getAttribute('data-tf-id'), el.getAttribute('data-tf-cible')); return; }
    if (action === 'publier') { tfPublier(); return; }
    if (action === 'catalogue') { tfRevenirAuCatalogue(el.getAttribute('data-tf-id')); return; }
    if (action === 'ouvrir-lieu') { const geste = TF_LIEUX_GESTES[el.getAttribute('data-tf-lieu-cible')]; if (geste && geste.permis()) geste.ouvrir(); return; }
    if (action === 'sm-comptoir' || action === 'sm-clients') { tfFormuleGardee('afficherFormuleSurMesure', el.getAttribute('data-tf-id'), { clients: action === 'sm-clients' }, action === 'sm-clients' ? 'Elle est sur le formulaire des clients.' : 'Elle ne se voit plus qu’au comptoir.'); return; }
    if (action === 'sm-enregistrer') {
      const lu = (id) => (document.getElementById(id) || {}).value;
      const prix = tfLireNombre(lu('tfSmPrix'));
      if (!String(lu('tfSmNom') || '').trim()) { pevToast('Le nom ne peut pas rester vide.'); return; }
      if (prix == null || Number.isNaN(prix)) { pevToast('Indiquez un prix entre 0 et 1000 €.'); return; }
      tfFormuleGardee('modifierFormuleSurMesure', el.getAttribute('data-tf-id'), { nom: lu('tfSmNom'), prixParPersonne: prix, minPax: Number(lu('tfSmMin')) }, 'Formule enregistrée.');
      return;
    }
    if (action === 'sm-retirer') {
      if (window.confirm('Retirer cette formule ? Les réservations déjà faites gardent leur prix.')) tfFormuleGardee('retirerFormuleSurMesure', el.getAttribute('data-tf-id'), {}, 'Formule retirée.');
      return;
    }
    if (action === 'etablissement') tfVersEtablissement();
  }
  // Le droit Tarifs suffit : ces formules n existent que pour ce centre (api/ops.js).
  function tfFormuleGardee(action, id, corps, message) {
    apiRequest(`${API_ENDPOINTS.ops || '/api/ops'}`, { method: 'POST', body: pevBody({ action, id: String(id), ...corps }) }).then(() => {
      pevToast(message);
      if (typeof oublierCatalogueSurMesure === 'function') oublierCatalogueSurMesure();
      if (typeof chargerCatalogueSurMesure === 'function') chargerCatalogueSurMesure();
      pevReload();
    }).catch((error) => { pevToast((error && error.message) || 'Le changement n’a pas pu se faire. Réessayez.'); });
  }
  function tfSurSaisie(e) {
    const el = e.target;
    if (!(el instanceof HTMLInputElement)) return;
    if (el.hasAttribute('data-tf-cherche')) {
      state.staffPricingQuery = el.value || '';
      clearTimeout(tarifs.minuteurs.cherche);
      tarifs.minuteurs.cherche = setTimeout(tfRendre, 120);
      return;
    }
    if (el.hasAttribute('data-tf-groupe')) {
      const n = Math.round(Number(el.value));
      clearTimeout(tarifs.minuteurs.groupe);
      if (!Number.isFinite(n) || n < TF_GROUPE_MIN || n > TF_GROUPE_MAX) return;
      tarifs.minuteurs.groupe = setTimeout(() => tfChangerGroupe(n), TF_FRAPPE_MS);
      return;
    }
    const champ = el.getAttribute('data-tf-champ');
    const ctx = tfContexte();
    if (ctx && tfEstCase(champ)) {
      const { nom, cle } = tfLireCase(champ);
      tarifs.saisies[tfCleSaisie('grille', nom, cle)] = el.value;
      const valable = tfSaisieValide('grille', champ, el.value);
      if (valable) el.removeAttribute('aria-invalid'); else el.setAttribute('aria-invalid', 'true');
      tfMajAide('grille', champ, el.value, valable);
      if (valable) tfPoserCase(champ, tfLireNombre(el.value));
      tfApresPose(ctx.type, ctx.id, champ, { attendre: true });
      // La meme grille vit sur deux lignes : le Bowling et le Duckpin.
      tfActivites().filter((x) => x.nomGrille === nom).forEach((x) => tfMajLigne('activite', x.id));
      return;
    }
    if (!ctx || !['prix', 'ancien', 'nom'].includes(champ)) return;
    tarifs.saisies[tfCleSaisie(ctx.type, ctx.id, champ)] = el.value;
    const valide = tfSaisieValide(ctx.type, champ, el.value);
    if (valide) el.removeAttribute('aria-invalid'); else el.setAttribute('aria-invalid', 'true');
    tfMajAide(ctx.type, champ, el.value, valide);
    if (valide) {
      const valeur = champ === 'nom' ? el.value.replace(/\s+/g, ' ').trim() : tfLireNombre(el.value);
      if (ctx.type === 'formule') tfPoserFormule(ctx.id, champ, valeur); else tfPoserActivite(ctx.id, valeur);
    }
    tfApresPose(ctx.type, ctx.id, champ, { attendre: true });
  }
  function tfSurChangement(e) {
    const el = e.target;
    if (el instanceof HTMLInputElement && el.hasAttribute('data-tf-groupe')) {
      clearTimeout(tarifs.minuteurs.groupe);
      tfChangerGroupe(el.value);
      el.value = String(tarifs.groupe);
    }
  }
  function tfSurFocus(e) {
    const el = e.target instanceof Element ? e.target : null;
    const row = el && el.closest('[data-tf-planche] [data-tf-r]');
    if (!row) return;
    const champ = row.getAttribute('data-tf-r');
    if (tarifs.focus === champ) return;
    tarifs.focus = champ;
    // Les endroits montrent l exemple de la case en main.
    if (tfEstCase(champ)) {
      tarifs.caseExemple = champ;
      const valeurs = tfValeursCourantes();
      const planche = tfPlanche();
      if (valeurs && planche) planche.querySelectorAll('[data-tf-lieu]').forEach((lieu) => tfAppliquer(lieu, valeurs, false));
    }
    tfAllumer({ anime: true });
  }
  function tfSurSortie(e) {
    if (tarifs.rendant) return;
    const el = e.target instanceof Element ? e.target : null;
    if (!el) return;
    // Un champ illisible reprend, en sortant, la derniere valeur valable.
    if (el instanceof HTMLInputElement && el.hasAttribute('data-tf-champ')) {
      const ctx = tfContexte();
      const champ = el.getAttribute('data-tf-champ');
      if (ctx && tfEstCase(champ)) {
        if (!tfSaisieValide('grille', champ, el.value)) {
          const { nom, cle } = tfLireCase(champ);
          delete tarifs.saisies[tfCleSaisie('grille', nom, cle)];
          const kase = tfCasesDeGrille(nom).find((c) => c.cle === cle);
          const propre = kase ? tfSaisieNombre(kase.prix) : '';
          el.value = propre;
          el.removeAttribute('aria-invalid');
          tfMajAide('grille', champ, propre, true);
        }
      } else if (ctx && !tfSaisieValide(ctx.type, champ, el.value)) {
        delete tarifs.saisies[tfCleSaisie(ctx.type, ctx.id, champ)];
        const vue = ctx.vue();
        const propre = ctx.type === 'activite' ? tfSaisieNombre(vue.prix) : champ === 'nom' ? vue.valeur.nom : tfSaisieNombre(vue.valeur[champ]);
        el.value = propre;
        el.removeAttribute('aria-invalid');
        tfMajAide(ctx.type, champ, propre, true);
      }
    }
    const colonne = el.closest('[data-tf-planche] .tf-col-r');
    if (!colonne) return;
    if (e.relatedTarget instanceof Element && colonne.contains(e.relatedTarget)) return;
    tarifs.focus = '';
    tfAllumer({ anime: true });
  }
  function tfSurTouche(e) {
    const el = e.target instanceof Element ? e.target : null;
    if (!el) return;
    const fleche = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (el.matches('[data-tf-onglet]') && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault();
      const i = TF_ONGLETS.indexOf(el.getAttribute('data-tf-onglet'));
      tfChoisirOnglet(TF_ONGLETS[(i + fleche + TF_ONGLETS.length) % TF_ONGLETS.length]);
      return;
    }
    if (el.matches('[data-tf-valid]') && fleche) {
      e.preventDefault();
      const modes = TF_VALIDATIONS.map((x) => x.mode);
      const i = modes.indexOf(el.getAttribute('data-tf-valid'));
      const suivant = document.querySelector(`#staffPricingPage [data-tf-valid="${modes[(i + fleche + modes.length) % modes.length]}"]`);
      if (suivant) suivant.click();
      return;
    }
    if (el.matches('input[data-tf-champ]') && e.key === 'Enter') { e.preventDefault(); el.select(); }
  }
  function tfBrancher(root) {
    if (root.dataset.tfBranche === '1') return;
    root.dataset.tfBranche = '1';
    root.addEventListener('click', tfSurClic);
    root.addEventListener('input', tfSurSaisie);
    root.addEventListener('change', tfSurChangement);
    root.addEventListener('focusin', tfSurFocus);
    root.addEventListener('focusout', tfSurSortie);
    root.addEventListener('keydown', tfSurTouche);
  }
  if (!window.__tfEchapBranche) {
    window.__tfEchapBranche = true;
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !tarifs.tiroir) return;
      if (typeof isStaffPricingActive === 'function' && !isStaffPricingActive()) return;
      e.preventDefault();
      tfFermerTiroir();
    });
  }
  function tfObserver() {
    if (tarifs.observateur) { tarifs.observateur.disconnect(); tarifs.observateur = null; }
    const planche = tfPlanche();
    if (!planche || typeof ResizeObserver !== 'function') return;
    let image = 0;
    tarifs.observateur = new ResizeObserver(() => {
      cancelAnimationFrame(image);
      image = requestAnimationFrame(() => { tfDessiner(); tfAllumer({ anime: false }); });
    });
    tarifs.observateur.observe(planche.querySelector('[data-tf-cablage]'));
  }

  // ---- LE BROUILLON APPARTIENT A SON CENTRE ---------------------------------------
  // Appele par pevResetCatalogCache : a la bascule de centre, le brouillon d un
  // autre centre est abandonne (jamais publie vers celui-ci), et le gerant le
  // sait. Le meme appel arrive aussi sur un pouls catalogue page cachee : le
  // centre n a pas change, rien ne se perd.
  // La bascule recharge la page (staff-menu.js pinlaneRechargerPourCentre) :
  // le message passe par sessionStorage pour etre dit APRES le rechargement,
  // et une seule fois.
  const TF_CLE_ABANDON = 'pinlane.tarifs.abandon';
  function tfDireAbandon(message, delai) {
    setTimeout(() => {
      try {
        if (sessionStorage.getItem(TF_CLE_ABANDON) !== message) return;
        sessionStorage.removeItem(TF_CLE_ABANDON);
      } catch (e) { /* stockage indisponible : le message se dit quand meme */ }
      pevToast(message);
    }, delai);
  }
  function tfOublierAutresCentres() {
    const centre = tfCentre();
    const perdus = Object.keys(tarifs.brouillons).filter((c) => c !== centre && tfNbChangements(tarifs.brouillons[c]) > 0);
    Object.keys(tarifs.brouillons).forEach((c) => { if (c !== centre) delete tarifs.brouillons[c]; });
    Object.keys(tarifs.saisies).forEach((cle) => { if (!cle.startsWith(`${centre}|`)) delete tarifs.saisies[cle]; });
    if (tfMeta.centre && tfMeta.centre !== centre) Object.assign(tfMeta, { centre: '', etat: 'vide', donnees: null, ticket: tfMeta.ticket + 1 });
    if (tfDurees.cle && !tfDurees.cle.startsWith(`${centre}|`)) Object.assign(tfDurees, { cle: '', etat: 'vide', valeurs: {}, ticket: tfDurees.ticket + 1 });
    if (!perdus.length) return;
    tarifs.tiroir = false;
    tarifs.erreur = '';
    const tous = typeof getAdminCenters === 'function' ? (getAdminCenters() || []) : [];
    const noms = perdus.map((id) => { const c = tous.find((x) => x && x.id === id); return c ? tfNomsCourts([c])[0] : id; });
    const message = `Changements pas publiés pour ${tfEt(noms)} : abandonnés au changement de centre.`;
    try { sessionStorage.setItem(TF_CLE_ABANDON, message); } catch (e) { /* dit tout de suite plus bas */ }
    // Apres le toast « Chargement de … » de la bascule, qui le remplacerait.
    tfDireAbandon(message, 1200);
  }
  try {
    const abandon = sessionStorage.getItem(TF_CLE_ABANDON);
    if (abandon) tfDireAbandon(abandon, 1500);
  } catch (e) { /* stockage indisponible */ }
  // Appele par pevReload : le catalogue public et les durees se relisent avec
  // le catalogue de la console. Page cachee, ils sont seulement marques
  // perimes : la page les relira a son prochain rendu.
  function tfAuRechargement() {
    tfDurees.perime = true;
    if (typeof isStaffPricingActive === 'function' && !isStaffPricingActive()) {
      if (tfMeta.etat === 'ok') tfMeta.etat = 'vide';
      return;
    }
    tfChargerMeta(true);
  }

  window.renderStaffPricingPage = function () {
    const root = document.getElementById('staffPricingPage');
    if (!root) return;
    pevEnsureLoaded();
    tfChargerMeta(false);
    // La fenetre de 30 jours vient de /api/admin-range (direction.view,
    // reservations.view ou clients.view) : sans ce droit, on ne l appelle pas.
    if ((typeof canReadStaffReservationHistory !== 'function' || canReadStaffReservationHistory()) && typeof ensureStaffClientData === 'function') ensureStaffClientData();
    const sm = window.PinlaneSurMesureSettings || null;
    if (sm && typeof sm.charger === 'function') sm.charger();
    tfBrancher(root);
    tarifs.usages = tfLireUsages();
    const html = tfPageHtml();
    const intact = html === tarifs.dernierRendu && Boolean(root.querySelector('[data-tf-page]'));
    if (!intact) {
      tarifs.dernierRendu = html;
      tarifs.rendant = true;
      tfAnnulerGouttes();
      try { tfAvecFocus(() => { root.innerHTML = html; }); } finally { tarifs.rendant = false; }
      tarifs.trace = '';
      tarifs.signature = '';
      const place = root.querySelector('[data-tf-barre-place]');
      if (place) place.dataset.tfSignature = tfSignatureBarre();
    }
    mount(root, 'pricing');
    cevSyncModal();
    aevSyncModal();
    if (sm && typeof sm.monter === 'function') sm.monter();
    if (intact) return;
    tfObserver();
    if (tfPlanche()) {
      if (tfContexte() && tfContexte().type === 'formule') tfChargerDurees();
      tfDessiner();
      tfAllumer({ anime: false });
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { tfDessiner(); tfAllumer({ anime: false }); });
    }
  };

  // ---- L API DE LA PAGE (gates, outils) ---------------------------------------------
  // window.tarifsPoser(formuleId, champ, valeur) : pose un changement dans le
  // brouillon du centre affiche, comme le ferait la planche. champ : 'prix' ou
  // 'ancien' (nombre ou texte « 28,50 », '' ou null = pas de prix barre),
  // 'nom' (texte non vide), 'vente' (booleen), 'validation' ('recommended',
  // 'required_when_laser_busy' ou 'required'). Rend true si c est pose,
  // false si la valeur ou la formule est refusee (formule creee par
  // l entreprise, droit Tarifs absent).
  window.tarifsPoser = function (formuleId, champ, valeur) {
    const id = String(formuleId || '');
    const entry = pevEntry(id);
    if (!entry || entry.source === 'custom' || !tfPeutTarifs() || !TF_CHAMPS.includes(champ)) return false;
    let v = valeur;
    if (champ === 'prix' || champ === 'ancien') {
      v = tfLireNombre(valeur);
      if (Number.isNaN(v) || (champ === 'prix' && v == null)) return false;
    } else if (champ === 'nom') {
      v = String(valeur == null ? '' : valeur).replace(/\s+/g, ' ').trim().slice(0, PEV_NAME_MAX);
      if (!v) return false;
    } else if (champ === 'vente') {
      v = Boolean(valeur);
    } else if (!TF_VALIDATIONS.some((x) => x.mode === valeur)) {
      return false;
    }
    tfPoserFormule(id, champ, v);
    delete tarifs.saisies[tfCleSaisie('formule', id, champ)];
    tfRendre();
    return true;
  };
  // window.tarifsPublier() : publie le brouillon du centre affiche, exactement
  // comme le bouton « Publier ». Rend une promesse { publies, refuses } :
  // publies = nombre de champs publies, refuses = [{ type, id, champs, message }].
  window.tarifsPublier = function () { return tfPublier(); };
  // La page Etablissement (10/11) montre les prix et renvoie ici pour les changer : la planche de
  // l activite ou de la formule s ouvre, le prix pret a taper. Un seul editeur ecrit les prix.
  window.tarifsOuvrirPrix = function (type, id) {
    const cle = type === 'activite' ? 'activites' : 'formules';
    tarifs.ouvert[cle] = '';
    if (typeof openStaffMenuPage === 'function') openStaffMenuPage('prices');
    setTimeout(() => tfOuvrir(type === 'activite' ? 'activite' : 'formule', String(id || ''), { prix: true }), 0);
  };
  // Ce que l entreprise a ajoute au catalogue (activite, boisson, service), lu par la page Etablissement.
  window.catalogueActivitesAjoutees = function () {
    if (pricingEditor.error) return { etat: 'erreur', liste: [] };
    if (!pricingEditor.loaded) return { etat: 'charge', liste: [] };
    return { etat: 'ok', liste: (pricingEditor.activities || []).filter((a) => a && a.source === 'custom') };
  };

  /* ==========================================================================
     GROUPES & ANNIVERSAIRES : la page n'existe plus (fusion du 2026-07-13).
     Tout accès historique (hash, état sauvegardé, alerte du tableau de bord)
     retombe sur Clients / segment « À venir ». Les autres pages utilitaires
     (sessions, arrivées, users…) restent servies par le renderer legacy.
     ======================================================================== */

  const legacyRenderStaffUtilityPage = window.renderStaffUtilityPage;

  window.renderStaffUtilityPage = function (...args) {
    const page = typeof getStaffMenuPage === 'function' ? getStaffMenuPage() : '';
    if (page !== 'groups') {
      if (typeof legacyRenderStaffUtilityPage === 'function') legacyRenderStaffUtilityPage.apply(this, args);
      return;
    }
    // Fusion Clients+Groupes : « groups » n'est plus une page, accès historique
    // (hash, état sauvegardé) → on bascule vers Clients, segment « À venir ».
    state.staffMenuPage = 'clients';
    state.staffClientSegment = 'avenir';
    save();
    renderStaff();
  };

  /* ==========================================================================
     COMMAND PALETTE : Ctrl/Cmd+K
     ======================================================================== */

  const PALETTE_PAGES = [
    ['dashboard', "Vue d'ensemble", '◫'],
    ['planning', 'Planning du jour', '▤'],
    ['reservations', 'Réservations', '☰'],
    ['clients', 'Clients', '◉'],
    ['emails', 'Emails & relances', '✉'],
    ['campaigns', 'Campagnes', '◍'],
    ['prices', 'Activités & tarifs', '€'],
    ['users', 'Équipe & accès', '⚿'],
    ['establishment', 'Établissement', '⌂'],
  ];

  let paletteState = null;

  function paletteItems(query) {
    const q = String(query || '').trim().toLowerCase();
    const items = [];
    PALETTE_PAGES.forEach(([key, label, icon]) => {
      if (typeof canUseStaffPage === 'function' && !canUseStaffPage(key)) return;
      if (q && !label.toLowerCase().includes(q)) return;
      items.push({ section: 'Navigation', icon, label, hint: 'Aller à', run: () => openStaffMenuPage(key) });
    });
    const actions = [
      typeof peutGeste !== 'function' || peutGeste('reserver') ? ['＋', 'Nouvelle réservation', () => openQuickBook({})] : null,
      ['⟳', 'Actualiser les données', () => (typeof loadStaffReservationsData === 'function' ? loadStaffReservationsData(true) : null)],
      ['◐', 'Basculer le thème', () => (typeof setStaffTheme === 'function' ? setStaffTheme(document.body.classList.contains('staff-light') ? 'dark' : 'light') : null)],
    ].filter(Boolean);
    actions.forEach(([icon, label, run]) => {
      if (q && !label.toLowerCase().includes(q)) return;
      items.push({ section: 'Actions', icon, label, hint: 'Exécuter', run });
    });
    if (q.length >= 2 && typeof getStaffClientRows === 'function') {
      try {
        getStaffClientRows()
          .filter((row) => `${row.name} ${row.email} ${row.phone}`.toLowerCase().includes(q))
          .slice(0, 5)
          .forEach((row) => items.push({
            section: 'Clients',
            icon: (row.initials || '-').slice(0, 2),
            label: row.name || 'Client',
            hint: row.phone || row.email || '',
            run: () => { openStaffMenuPage('clients'); if (typeof selectStaffClient === 'function') selectStaffClient(row.id); },
          }));
      } catch (error) { /* clients unavailable: palette stays useful without them */ }
    }
    return items.slice(0, 14);
  }

  function renderPalette() {
    if (!paletteState) return;
    const items = paletteItems(paletteState.query);
    paletteState.items = items;
    if (paletteState.index >= items.length) paletteState.index = Math.max(0, items.length - 1);
    const list = paletteState.node.querySelector('.pv2-palette-list');
    let lastSection = '';
    list.innerHTML = items.map((item, i) => {
      const head = item.section !== lastSection ? `<div class="pv2-palette-section">${esc(item.section)}</div>` : '';
      lastSection = item.section;
      return `${head}<button type="button" class="pv2-palette-item ${i === paletteState.index ? 'active' : ''}" data-pv2-idx="${i}">
        <span class="pv2-palette-ico">${esc(item.icon)}</span>${esc(item.label)}<small>${esc(item.hint)}</small>
      </button>`;
    }).join('') || '<div class="pv2-empty"><strong>Aucun résultat</strong></div>';
    list.querySelectorAll('[data-pv2-idx]').forEach((node) => {
      node.addEventListener('click', () => runPaletteItem(Number(node.getAttribute('data-pv2-idx'))));
    });
  }

  function runPaletteItem(index) {
    const item = paletteState?.items?.[index];
    closePalette();
    if (item && typeof item.run === 'function') item.run();
  }

  function closePalette() {
    if (paletteState?.node) paletteState.node.remove();
    paletteState = null;
  }

  function openPalette() {
    if (paletteState) { closePalette(); return; }
    if (!document.body.classList.contains('staff-mode') && !document.body.classList.contains('admin-mode')) return;
    const node = document.createElement('div');
    node.className = 'pv2-palette-overlay';
    node.innerHTML = `<div class="pv2-palette" role="dialog" aria-label="Palette de commandes" data-pl-libre>
      <div class="pv2-palette-input">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg>
        <input type="text" placeholder="Page, action ou client…" aria-label="Rechercher">
        <kbd>ESC</kbd>
      </div>
      <div class="pv2-palette-list"></div>
      <div class="pv2-palette-foot"><span><kbd>↑↓</kbd>naviguer</span><span><kbd>⏎</kbd>ouvrir</span><span><kbd>ESC</kbd>fermer</span></div>
    </div>`;
    node.addEventListener('mousedown', (event) => { if (event.target === node) closePalette(); });
    document.body.appendChild(node);
    const input = node.querySelector('input');
    paletteState = { node, query: '', index: 0, items: [] };
    input.addEventListener('input', () => { paletteState.query = input.value; paletteState.index = 0; renderPalette(); });
    input.focus();
    renderPalette();
  }

  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === 'k') {
      event.preventDefault();
      openPalette();
      return;
    }
    if (!paletteState) return;
    if (event.key === 'Escape') { closePalette(); return; }
    if (event.key === 'ArrowDown') { event.preventDefault(); paletteState.index = Math.min(paletteState.index + 1, paletteState.items.length - 1); renderPalette(); }
    if (event.key === 'ArrowUp') { event.preventDefault(); paletteState.index = Math.max(paletteState.index - 1, 0); renderPalette(); }
    if (event.key === 'Enter') { event.preventDefault(); runPaletteItem(paletteState.index); }
  });

  window.addEventListener('resize', () => {
    document.querySelectorAll('.pv2-seg').forEach(() => slideSegPills(document));
  });
})();

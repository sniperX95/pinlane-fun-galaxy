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
        <div class="pv2-bar-crumb"><span class="pv2-live"></span>${esc(crumb)}</div>
        <h1>${esc(title)}</h1>
        <div class="pv2-bar-sub">${sub}</div>
      </div>
      <div class="pv2-bar-actions">${actions}</div>
    </section>`;
  }

  function stat({ label, value, count, suffix = '', delta = '', deltaTone = 'flat', foot = '', series = null }) {
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
    return `<article class="pv2-stat">
      <div class="pv2-stat-label"><span>${esc(label)}</span>${delta ? `<span class="pv2-delta ${deltaTone}">${esc(delta)}</span>` : ''}</div>
      <div class="pv2-stat-value">${valueHtml}</div>
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
  };

  function statusChip(status) {
    const meta = STATUS_META[status] || STATUS_META.pending;
    return `<span class="pv2-chip ${meta.tone}"><span class="pv2-dot ${meta.tone}" style="margin:0"></span>${meta.label}</span>`;
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

  function pv2ResSearchMatches() {
    const q = pv2ResSearchNormalize(pv2ResSearch.query);
    if (q.length < 2) return [];
    const digits = q.replace(/[^0-9]/g, '');
    const rows = (pv2ResSearch.rows || []).filter((r) => r && r.status !== 'cancelled');
    const hit = rows.filter((r) => {
      if (pv2ResSearchNormalize(r.name).includes(q)) return true;
      const phone = String(r.phone || '').replace(/[^0-9]/g, '');
      return digits.length >= 4 && phone.includes(digits);
    });
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
      return '<div class="pv2-empty"><strong>Aucun résultat</strong>Aucune réservation ne correspond à ce nom ou ce numéro (fenêtre : 2 mois passés à 12 mois à venir).</div>';
    }
    return rows.map(pv2ResSearchResultRow).join('');
  }

  // Une reservation prise il y a dix secondes doit se trouver : apres toute
  // creation / modification, la fenetre est redemandee au prochain rendu.
  window.pv2ResSearchInvalidate = function () {
    pv2ResSearch.loadedAt = 0;
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
  window.pv2ResSearchOpen = function (id) {
    const row = (pv2ResSearch.rows || []).find((r) => String(r.id) === String(id));
    if (row && typeof upsertReservationInState === 'function') upsertReservationInState(row);
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
    if (!note && !prix) return '';
    return `<span class="pv2-flow-marks">${prix}${note}</span>`;
  }

  function pv2ResSearchResultRow(r) {
    const when = typeof formatStaffClientDateText === 'function' ? formatStaffClientDateText(r.date) : (r.date || '');
    const time = String(r.startTime || '').slice(0, 5);
    const offer = typeof getStaffClientOfferLabel === 'function' ? getStaffClientOfferLabel(r) : typeLabel(r);
    const paxN = Number(r.pax) || 0;
    return `<div class="pv2-flow-item ${(STATUS_META[r.status] || STATUS_META.pending).tone}" onclick="pv2ResSearchOpen('${escJs(r.id)}')">
      <div class="pv2-flow-time"><strong>${esc(time || '--:--')}</strong><small>${esc(when)}</small></div>
      <div class="pv2-flow-rail"></div>
      <div class="pv2-flow-body">
        <strong>${esc(r.name || 'Sans nom')}</strong>
        <span>${esc(offer)} · ${paxN} joueur${paxN > 1 ? 's' : ''}${r.phone ? ` · ${esc(r.phone)}` : ''}</span>
        ${pv2MarqueursDossier(r)}
      </div>
      ${statusChip(r.status)}
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
      const agg = byDay.get(r.date) || { count: 0, pax: 0, revenue: 0 };
      agg.count += 1;
      agg.pax += Number(r.pax) || 0;
      agg.revenue += Number(r.price) || 0;
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
      cells += `<button type="button" class="pv2-cal-cell heat-${heat} ${dateStr === today ? 'today' : ''} ${dateStr === selectedDate ? 'selected' : ''}" data-cal-date="${dateStr}" aria-pressed="${dateStr === selectedDate ? 'true' : 'false'}" aria-label="${day} · ${agg ? `${agg.count} résa, ${agg.pax} joueurs` : 'aucune résa'}" onclick="pv2SelectResDay('${dateStr}')">
        <span class="pv2-cal-day">${day}</span>
        <span class="pv2-cal-meta">${agg ? `<strong>${agg.count}</strong> résa · ${agg.pax}p` : '-'}</span>
      </button>`;
    }

    const dayRows = source
      .filter((r) => r.date === selectedDate)
      .sort((a, b) => String(a.startTime || '').localeCompare(String(b.startTime || '')));
    const dayAgg = byDay.get(selectedDate) || { count: 0, pax: 0, revenue: 0 };
    const dayLabel = parseLocalDate(selectedDate).toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' });

    const flow = dayRows.length
      ? dayRows.map((r) => {
        const meta = STATUS_META[r.status] || STATUS_META.pending;
        const time = String(r.startTime || '').slice(0, 5);
        return `<div class="pv2-flow-item ${meta.tone}" onclick="openStaffReservationDetail('${escJs(r.id)}')">
          <div class="pv2-flow-time">${esc(time)}<small>${esc(String(r.duration || 1))}h</small></div>
          <div class="pv2-flow-rail"></div>
          <div class="pv2-flow-body">
            <strong>${esc(r.name || 'Sans nom')}</strong>
            <span>${esc(typeLabel(r))} · ${Number(r.pax) || 0} joueurs${(r.lanes || []).length ? ` · piste ${(r.lanes || []).join(', ')}` : ''} · ${money(r.price)}</span>
            ${/* La ligne au-dessus finit par le montant : la marque dit donc la
                 REFERENCE, pas une deuxieme fois le montant. */''}
            ${pv2MarqueursDossier(r, { montantDeja: true })}
          </div>
          ${statusChip(r.status)}
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
    const varia = (texte) => (refPeriodeVide ? '' : texte);

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
    const occupationNulleMaisActive = metrics.occupancy === 0 && heuresPistesVendues > 0;

    const paint = () => {
    root.innerHTML = `<div class="pv2-shell">
      ${bar({
        crumb: 'Journée',
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
          <button type="button" class="pv2-btn primary" onclick="openStaffReservationsQuick()">+ Réservation</button>`,
      })}

      <section class="pv2-stats">
        ${stat({ label: 'Réservations ce mois', count: metrics.reservations, delta: varia(metrics.reservationTrend), deltaTone: trendTone(metrics.reservationTrend), series: courbe(metrics.series.reservations) })}
        ${stat({ label: 'Joueurs ce mois', count: metrics.players, delta: varia(metrics.playersTrend), deltaTone: trendTone(metrics.playersTrend), series: courbe(metrics.series.players) })}
        ${stat({ label: "Chiffre d'affaires", value: (typeof canUseStaffPermission === 'function' && !canUseStaffPermission('payments.view')) ? '···' : money(metrics.revenue), delta: varia(metrics.revenueTrend), deltaTone: trendTone(metrics.revenueTrend), series: courbe(metrics.series.revenue) })}
        ${occupationNulleMaisActive
          ? stat({ label: 'Occupation moyenne', value: '< 1%', delta: varia(metrics.occupancyTrend), deltaTone: trendTone(metrics.occupancyTrend), foot: 'capacité pistes du mois', series: courbe(metrics.series.occupancy) })
          : stat({ label: 'Occupation moyenne', count: metrics.occupancy, suffix: '%', delta: varia(metrics.occupancyTrend), deltaTone: trendTone(metrics.occupancyTrend), foot: 'capacité pistes du mois', series: courbe(metrics.series.occupancy) })}
      </section>

      <section class="pv2-split">
        <article class="pv2-panel">
          <div class="pv2-panel-head">
            <h2>${esc(monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1))}</h2>
            <small>Intensité = réservations réelles par jour</small>
          </div>
          <div class="pv2-panel-body pv2-cal">
            <div class="pv2-cal-head"><span>Lun</span><span>Mar</span><span>Mer</span><span>Jeu</span><span>Ven</span><span>Sam</span><span>Dim</span></div>
            <div class="pv2-cal-grid">${cells}</div>
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
      ? `<td class="crm-cell-why">${esc(getStaffClientRelance(row).reason)}${row.email ? `<button type="button" class="pv2-btn sm" onclick="event.stopPropagation();crmOpenRelance('${escJs(row.id)}')">Relancer</button>` : ''}</td>`
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
          <span class="crm-hist-amount ${entry.amount < 0 ? 'is-neg' : ''}">${money(Math.abs(entry.amount))}</span>
          <span class="crm-pill tone-${r.status === 'paid' ? 'success' : cancelled ? 'warn' : 'muted'} crm-hist-status">${esc(entry.status)}</span>
        </summary>
        <div class="crm-hist-detail">
          <div><dt>Heure</dt><dd>${esc(r.startTime || '-')}${r.duration ? ` · ${crmNum(r.duration)}h` : ''}</dd></div>
          ${lanesTxt ? `<div><dt>Emplacement</dt><dd>${esc(lanesTxt)}</dd></div>` : ''}
          ${occ ? `<div><dt>Occasion</dt><dd>${esc(occ)}</dd></div>` : ''}
          ${r.paymentMethod ? `<div><dt>Paiement</dt><dd>${esc(r.paymentMethod)}</dd></div>` : ''}
          <div><dt>Canal</dt><dd>${r.channel === 'staff' ? 'Comptoir' : 'En ligne'}</dd></div>
          ${Array.isArray(r.extras) && r.extras.length ? `<div><dt>Extras</dt><dd>${esc(r.extras.map((e) => (e && (e.label || e.name)) || e).join(', '))}</dd></div>` : ''}
          ${r.notes ? `<div class="crm-hist-notes"><dt>Notes</dt><dd>${esc(r.notes)}</dd></div>` : ''}
        </div>
      </details>`;
  }

  function crmCommsBlock(selected) {
    const comms = getStaffClientCommunications(selected);
    const compose = selected.email
      ? `<button type="button" class="pv2-btn" onclick="pv2OpenComposer({to:'${escJs(selected.email)}',name:'${escJs(selected.name || '')}'})">${ci('mail')}Nouveau message</button>`
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
        ${selected.email ? `<button type="button" class="crm-icon-btn" title="Renvoyer" aria-label="Renvoyer" onclick="pv2OpenComposer({to:'${escJs(selected.email)}',name:'${escJs(selected.name || '')}'})">${ci('refresh')}</button>` : ''}
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
    return String(row.phone || row.email || '').trim().toLowerCase();
  }

  async function loadCrmClientNote(row) {
    const key = crmClientKey(row);
    if (!key || crmNotes.key === key) return;
    crmNotes.key = key;
    crmNotes.body = '';
    crmNotes.loaded = false;
    crmNotes.loading = true;
    try {
      const payload = await apiRequest(`/api/ops?action=clientNotes&clientKey=${encodeURIComponent(key)}&centerId=${encodeURIComponent(state.adminCenterId || 'libramont')}`);
      if (crmNotes.key !== key) return; // sélection changée entre-temps
      crmNotes.body = payload.note ? String(payload.note.body || '') : '';
      crmNotes.loaded = true;
    } catch (error) { /* rôle sans accès : zone masquée */ } finally {
      if (crmNotes.key === key) { crmNotes.loading = false; renderStaffClientsPage(); }
    }
  }

  window.crmSaveClientNote = async function (clientId, body) {
    const row = getStaffClientRows().find((r) => r.id === clientId);
    if (!row) return;
    const key = crmClientKey(row);
    // Garde anti-écrasement : jamais de save tant que la note du client n'est
    // pas CHARGÉE (sinon un blur sur textarea vide effacerait la vraie note).
    if (!key || crmNotes.saving || crmNotes.key !== key || !crmNotes.loaded || body === crmNotes.body) return;
    crmNotes.saving = true;
    try {
      await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'clientNotes', clientKey: key, body, centerId: state.adminCenterId || 'libramont' }),
      });
      crmNotes.body = body;
      toast('Note enregistrée.');
    } catch (error) {
      toast(error.message || 'Note non enregistrée.');
    } finally {
      crmNotes.saving = false;
    }
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
          <div class="crm-head-actions">
            ${selected.email ? `<button type="button" class="pv2-btn" onclick="pv2OpenComposer({to:'${escJs(selected.email)}',name:'${escJs(selected.name || '')}'})">${ci('mail')}Message</button>` : ''}
            <button type="button" class="pv2-btn primary" onclick="openStaffClientBooking('${escJs(selected.id)}')">+ Réservation</button>
          </div>
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
            ${selected.email && crmRelance.openFor !== selected.id ? `<button type="button" class="pv2-btn primary" onclick="crmOpenRelance('${escJs(selected.id)}')">${ci('send')}Relancer par email</button>` : ''}
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
          <textarea class="crm-note-input" data-pl-focus="clients.note" rows="3" placeholder="${crmNotes.loading ? 'Chargement…' : 'Allergies, prénom de l\'enfant, préférences… (enregistré automatiquement)'}"
            ${crmNotes.key === crmClientKey(selected) && crmNotes.loaded ? '' : 'disabled'}
            onblur="crmSaveClientNote('${escJs(selected.id)}', this.value)">${esc(crmNotes.key === crmClientKey(selected) && crmNotes.loaded ? crmNotes.body : '')}</textarea>
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
        <button type="button" class="pv2-btn" onclick="openStaffCampaignForRelance()">${ci('megaphone')}Campagne pour ce segment</button>
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
          <button type="button" class="pv2-btn" onclick="exportStaffClientsCsv()">Exporter</button>
          <button type="button" class="pv2-btn primary" onclick="openStaffClientBooking()">+ Nouveau client</button>`,
      })}

      <section class="pv2-stats crm-stats">
        ${statBtn('avenir', stat({ label: 'À venir 7 j', count: upcoming7.length, foot: upcoming7Pax ? `${upcoming7Pax} joueur${upcoming7Pax > 1 ? 's' : ''} attendus` : 'réservations à préparer' }))}
        ${statGo('focusStaffCustomRequests', stat({ label: 'Demandes sur mesure', count: leadsActifs, foot: leadsActifs ? (newLeads ? `dont ${newLeads} nouvelle${newLeads > 1 ? 's' : ''}` : 'en cours de traitement') : 'aucune en attente' }))}
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
  window.openStaffCampaignForRelance = function () {
    openStaffMenuPage('campaigns');
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
         jamais un chiffre que le centre n'a pas donné. */
  const PV2_STARTERS = [
    // Relancer
    { key: 'relance-client', cat: 'Relancer', name: 'On ne vous a plus vu', subject: 'Ça fait longtemps, {{prenom}} !', body: 'Bonjour {{prenom}},\n\nCela fait un moment sans vous voir au centre, les pistes vous attendent.\n\nRéservez en ligne quand vous voulez, ça prend une minute.\n\nÀ bientôt,\nL\'équipe {{centre}}' },
    { key: 'relance-devis', cat: 'Relancer', name: 'Devis resté sans réponse', subject: 'Votre projet chez {{centre}} tient toujours ?', body: 'Bonjour {{prenom}},\n\nUne proposition vous avait été préparée, et elle est restée sans réponse. Si le projet tient toujours, répondez simplement à ce message et la date sera gardée.\n\nEt si vos plans ont changé, dites-le en une ligne, il n\'y aura plus de relance.\n\nL\'équipe {{centre}}' },
    // Anniversaires & groupes
    { key: 'marketing-anniversaire', cat: 'Anniversaires & groupes', name: 'Pack anniversaire enfant', subject: 'Un anniversaire inoubliable, sans stress pour vous', body: 'Bonjour {{prenom}},\n\nUn anniversaire à organiser ? Bowling, laser game, table décorée et boissons, l\'équipe s\'occupe de tout pendant que vous profitez.\n\nIndiquez la date et le nombre d\'enfants, et la formule adaptée vous sera proposée.\n\nL\'équipe {{centre}}' },
    { key: 'anniversaire-adulte', cat: 'Anniversaires & groupes', name: 'Anniversaire adulte / EVG-EVJF', subject: 'Un anniversaire qui change des restos', body: 'Bonjour {{prenom}},\n\nPour un anniversaire adulte, un EVG ou un EVJF, bowling, laser game et arcades sont au même endroit, sans organisation de votre côté.\n\nDonnez la date et la taille du groupe, et l\'équipe monte la soirée.\n\nL\'équipe {{centre}}' },
    { key: 'merci-groupe', cat: 'Anniversaires & groupes', name: 'Merci après un groupe', subject: 'Merci pour votre venue, {{prenom}} !', body: 'Bonjour {{prenom}},\n\nMerci pour votre venue avec votre groupe. L\'équipe espère que tout le monde est reparti avec le sourire.\n\nSi quelque chose peut être amélioré pour la prochaine fois, répondez à ce message, tout est lu.\n\nÀ bientôt,\nL\'équipe {{centre}}' },
    // Entreprises & écoles
    { key: 'serieux-entreprise', cat: 'Entreprises & écoles', name: 'Proposition entreprise', subject: 'Votre événement d\'équipe chez {{centre}}, proposition', body: 'Bonjour {{prenom}},\n\nSuite à votre demande, voici la proposition de {{centre}} pour votre événement d\'équipe, avec un créneau réservé, les activités au choix (bowling, laser game) et un espace repas.\n\nL\'équipe reste disponible pour ajuster la formule à votre budget et vos horaires.\n\nCordialement,\nLa direction {{centre}}' },
    { key: 'devis-groupe-ecole', cat: 'Entreprises & écoles', name: 'Sortie école / mouvement de jeunesse', subject: 'Votre sortie de groupe chez {{centre}}', body: 'Bonjour {{prenom}},\n\nPour une sortie d\'école ou de mouvement de jeunesse, les créneaux en semaine sont les plus calmes, le groupe a de la place et l\'équipe est disponible pour encadrer.\n\nIndiquez la date envisagée, l\'âge et le nombre d\'enfants, et un devis clair vous sera préparé.\n\nLa direction {{centre}}' },
    // Offres & saisons
    { key: 'promo-semaine', cat: 'Offres & saisons', name: 'Offre de la semaine', subject: 'Cette semaine chez {{centre}}, {{offre}}', body: 'Bonjour {{prenom}},\n\nCette semaine chez {{centre}}, {{offre}}.\n\nValable du {{date_debut}} au {{date_fin}}, réservez votre créneau en ligne en une minute.\n\nBien à vous,\nL\'équipe {{centre}}' },
    { key: 'creux-semaine', cat: 'Offres & saisons', name: 'Jour calme en semaine', subject: 'Envie d\'une piste tranquille cette semaine ?', body: 'Bonjour {{prenom}},\n\nEn semaine, le centre est plus calme, sans attente, avec tout le temps de jouer.\n\nRéservez votre créneau en ligne, ça prend une minute.\n\nÀ bientôt,\nL\'équipe {{centre}}' },
    { key: 'vacances-annonce', cat: 'Offres & saisons', name: 'Annonce vacances scolaires', subject: 'Les vacances arrivent, {{prenom}}', body: 'Bonjour {{prenom}},\n\nLes vacances scolaires approchent et les créneaux partent vite, surtout l\'après-midi.\n\nPensez à réserver à l\'avance en ligne, vous choisissez votre heure et c\'est réglé en une minute.\n\nL\'équipe {{centre}}' },
    // Service client
    { key: 'reponse-reclamation', cat: 'Service client', name: 'Réponse à une réclamation', subject: 'Réponse à votre message, {{prenom}}', body: 'Bonjour {{prenom}},\n\nMerci d\'avoir pris le temps d\'écrire. Ce que vous décrivez n\'est pas l\'expérience que {{centre}} veut offrir, et l\'équipe vous présente ses excuses.\n\nVoici ce qui vous est proposé, {{geste}}.\n\nL\'équipe espère vous revoir dans de meilleures conditions.\n\nLa direction {{centre}}' },
    { key: 'avis-google', cat: 'Service client', name: 'Demande d\'avis Google', subject: 'Un mot sur votre visite ?', body: 'Bonjour {{prenom}},\n\nSi vous avez passé un bon moment chez {{centre}}, un avis aide énormément, et ça prend trente secondes.\n\n[[bouton: Laisser un avis | {{lien_avis}}]]\n\nMerci, et à bientôt,\nL\'équipe {{centre}}' },
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
  const PV2_VAR_LABELS_ALL = { ...PV2_VAR_LABELS, date: 'Date', heure: 'Heure', formule: 'Formule', pax: 'Joueurs', offre: 'Offre' };

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
  function pv2TokeditHtml({ id, sink, value, single = false, plFocus = '', placeholder = '', classe = '' }) {
    return `<div class="pv2-tokedit${single ? ' is-single' : ''}${classe ? ` ${classe}` : ''}" id="${esc(id)}" data-sink="${esc(sink)}"${single ? ' data-single="1"' : ''}${plFocus ? ` data-pl-focus="${esc(plFocus)}"` : ''} contenteditable="true" role="textbox" aria-multiline="${single ? 'false' : 'true'}" data-placeholder="${esc(pv2Humanize(placeholder))}" spellcheck="false" oninput="pv2TokeditInput(this)" onkeydown="pv2TokeditKey(event)" onpaste="pv2TokeditPaste(event)">${pv2TokeditRender(value)}</div>`;
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
    memoireOuverte: false,
    // La question du moment, ce que le dernier apprentissage a change, la
    // recherche dans la memoire, le fait en cours de correction, le fait
    // appris d office.
    savoirCle: '',
    dernierApprentissage: null,
    memoireFiltre: '',
    faitEnEdition: '',
    nouveauFait: { question: '' },
    nouveauOuvert: false,
    listeOuverte: false,
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
    const d = pv2Mail.draft;
    if (!String(d.subject || '').trim() && !String(d.body || '').trim()) { toast('Rien à enregistrer : le message est vide.'); return; }
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
    toast('Brouillon repris dans Modèles : donnez-lui un nom et enregistrez.');
  };

  window.pv2ComposerImprove = async function () {
    if (pv2Mail.aiBusy) return;
    const d = pv2Mail.draft;
    if (!d.subject.trim() && !d.body.trim()) { toast('Écrivez d\'abord un brouillon à améliorer.'); return; }
    pv2Mail.aiBusy = true;
    pv2RenderComposer();
    try {
      const payload = await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'improveEmailWithAi', centerId: state.adminCenterId || 'libramont', subject: d.subject, body: d.body, category: 'relance' }),
      });
      pv2Mail.aiTips = payload.tips || [];
      if (payload.mode === 'ia' && payload.subject && payload.body) {
        pv2Mail.draft.subject = payload.subject;
        pv2Mail.draft.body = payload.body;
        toast('Brouillon amélioré par l\'IA : relis avant d\'envoyer.');
      } else if (pv2Mail.aiTips.length) {
        toast('Conseils affichés sous le message.');
      }
    } catch (error) {
      toast(error.message || 'Amélioration indisponible.');
    } finally {
      pv2Mail.aiBusy = false;
      pv2RenderComposer();
    }
  };

  // Une tentative appartient au brouillon et à son contenu réellement envoyé.
  // Une réponse perdue garde la clé ; une édition ou un nouveau brouillon en
  // reçoit une autre. La clé n'est jamais régénérée dans le catch réseau.
  function pv2MessageAttempt(draft, payload, idField = 'attemptId') {
    return window.PinlaneApiClient.withMessageAttempt(draft, payload, idField);
  }

  window.pv2ComposerSend = async function () {
    if (pv2Mail.busy) return;
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

  // Le brouillon d une conversation : objet « Re: », corps propose par l agent
  // s il en a un, signature selon la portee reglee dans Apparence, signataire
  // = la personne connectee (modifiable : c est elle qui signe, pas le role).
  function pv2SignataireTechnique(membre) {
    const nom = String((membre && membre.name) || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
    return nom === 'proprietaire plateforme' || /platform-owner/.test(String((membre && membre.id) || '')) || Boolean(membre && membre.emergency);
  }

  function pv2ThreadReplyDraft(threadId) {
    const cle = String(threadId);
    if (!pv2Threads.reply[cle]) {
      const d = pv2Threads.detail;
      const fil = d.thread && String(d.thread.id) === cle ? d.thread : null;
      const entrant = fil ? pv2ThreadDernierEntrant(d.messages) : null;
      const analysis = entrant && entrant.analysis ? entrant.analysis : null;
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
        body: String((analysis && analysis.reply && analysis.reply.body) || ''),
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
    draft.subject = String(reply.subject || draft.subject || '');
    draft.body = String(reply.body || '');
    renderStaffEmailsPage();
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
        entrant.analysis = payload.analysis;
        pv2Threads.reply[threadId] = undefined;
        delete pv2Threads.reply[threadId];
        const draft = pv2ThreadReplyDraft(threadId);
        draft.subject = String((payload.analysis.reply && payload.analysis.reply.subject) || draft.subject || '');
        draft.body = String((payload.analysis.reply && payload.analysis.reply.body) || '');
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
    pv2Seq.creating = true;
    pv2Seq.editId = '';
    pv2Seq.draft = { name: '', trigger: { type: 'after_visit', days: 7, weekday: 4 }, segment: 'all', subject: '', body: '', cap: 20, enabled: true };
    pv2SeqAllerEditer();
    pv2ApercuSequencePerso(0);
    setTimeout(() => { const el = document.getElementById('pv2SeqName'); if (el) el.focus(); }, 60);
  };

  window.pv2SeqEdit = function (id) {
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
      else toast(`Le test n'est pas parti : ${payload.error || 'cause inconnue'}`);
    } catch (error) {
      toast(error.message || 'Envoi de test impossible.');
    } finally {
      pv2Seq.busy = false;
      renderStaffEmailsPage();
    }
  };

  window.pv2SeqSave = async function () {
    if (pv2Seq.busy) return;
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

  function pv2SeqCard(sequence) {
    const editing = pv2Seq.editId === sequence.id;
    const stats = pv2SeqStats30j(sequence);
    const NB = ' ';
    const sent30 = stats ? Number(stats.sent30d) || 0 : null;
    const failed30 = stats ? Number(stats.failed30d) || 0 : 0;
    const statsTxt = stats
      ? `${sent30}${NB}envoyé${sent30 > 1 ? 's' : ''}${failed30 ? ` · <span class="mk-auto-fail">${failed30}${NB}échec${failed30 > 1 ? 's' : ''}</span>` : ''} sur 30${NB}jours`
      : 'Envois des 30 derniers jours : pas encore comptés';
    return `<article class="mk-auto pv2-seq-card${sequence.enabled ? ' is-on' : ''}${editing ? ' is-editing' : ''}">
      <div class="mk-auto-head">
        <strong>${esc(sequence.name)}<span class="pv2-seq-pill">perso</span></strong>
        <button type="button" class="mk-switch${sequence.enabled ? ' is-on' : ''}" data-switch-key="seq:${esc(String(sequence.id))}" role="switch" aria-checked="${sequence.enabled}" aria-label="${esc(sequence.name)}" onclick="pv2SeqToggle('${escJs(sequence.id)}', ${sequence.enabled ? 'false' : 'true'})" ${pv2Seq.busy ? 'disabled' : ''}><span></span></button>
      </div>
      <p class="mk-auto-desc">${esc(pv2SeqTriggerLabel(sequence))} · max ${Number(sequence.cap) || 0} envois</p>
      <div class="mk-auto-effectif">
        <span class="mk-auto-effectif-label">Ce qui part</span>
        <span class="mk-auto-subject">${pv2TexteJetons(sequence.subject) || '<em>Sans objet</em>'}</span>
        <span class="mk-auto-line">${pv2TexteJetons(pv2PremiereLigne(sequence.body)) || '<em>Message vide</em>'}</span>
      </div>
      <div class="mk-auto-foot">
        <span class="mk-auto-stats">${statsTxt}</span>
        <div class="mk-auto-actions">
          <button type="button" class="mkw-link mk-auto-preview" onclick="pv2SeqPreview('${escJs(sequence.id)}')" ${pv2Seq.busy ? 'disabled' : ''}>Voir le mail</button>
          <button type="button" class="pv2-btn sm mk-auto-edit-btn" onclick="${editing ? 'pv2SeqCloseEditor()' : `pv2SeqEdit('${escJs(sequence.id)}')`}">${ci('pencil')}${editing ? 'Fermer' : 'Modifier'}</button>
          <button type="button" class="pv2-btn sm ghost" onclick="pv2SeqDelete('${escJs(sequence.id)}')" ${pv2Seq.busy ? 'disabled' : ''}>Supprimer</button>
        </div>
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
    return `<div class="pv2-seq-editor" data-pv2-mount="seqEditor" aria-label="Éditeur de séquence">
      <div class="pv2-seq-editor-cols">
      <div class="pv2-composer-grid">
        <label class="pv2-composer-field"><span>Nom de la séquence</span>
          <input id="pv2SeqName" data-pl-focus="emails.sequence.nom" value="${esc(d.name || '')}" placeholder="Ex. Relance une semaine après la visite" oninput="pv2SeqField('name', this.value)">
        </label>
        <label class="pv2-composer-field"><span>Déclencheur</span>
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
        <label class="pv2-composer-field"><span>Délai (jours)</span>
          <input type="number" min="${daysBounds[0]}" max="${daysBounds[1]}" value="${Number(trigger.days) || daysBounds[0]}" oninput="pv2SeqField('trigger.days', this.value)">
        </label>`}
        <label class="pv2-composer-field"><span>Plafond d'envois</span>
          <input type="number" min="1" max="100" value="${Number(d.cap) || 20}" oninput="pv2SeqField('cap', this.value)">
        </label>
        <div class="pv2-composer-field pv2-composer-wide"><span>Objet</span>
          ${pv2TokeditHtml({ id: 'pv2SeqSubject', sink: 'seqSubject', value: d.subject || '', single: true, plFocus: 'emails.sequence.objet', placeholder: 'Objet du message automatique' })}
        </div>
        <div class="pv2-composer-field pv2-composer-wide"><span>Message</span>
          ${pv2VarBar('pv2SeqBody', meta.variables || ['prenom', 'centre'])}
          ${pv2TokeditHtml({ id: 'pv2SeqBody', sink: 'seqBody', value: d.body || '', plFocus: 'emails.sequence.message', placeholder: 'Bonjour {{prenom}},…' })}
        </div>
      </div>
      ${pv2ApercuVivantHtml('seq', { titre: 'Aperçu avec un client d\'exemple' })}
      </div>
      <div class="pv2-composer-actions">
        <button type="button" class="pv2-btn" onclick="pv2SeqCloseEditor()">Annuler</button>
        ${pv2Seq.editId ? `<button type="button" class="pv2-btn" onclick="pv2SeqPreview('${escJs(pv2Seq.editId)}')" ${pv2Seq.busy ? 'disabled' : ''}>Voir en grand</button>
        <button type="button" class="pv2-btn" onclick="pv2SeqSendTest('${escJs(pv2Seq.editId)}')" ${pv2Seq.busy ? 'disabled' : ''}>M'envoyer un test</button>` : ''}
        <span class="pv2-composer-spacer"></span>
        <button type="button" class="pv2-btn primary" onclick="pv2SeqSave()" ${pv2Seq.busy ? 'disabled' : ''}>${pv2Seq.busy ? 'Enregistrement…' : 'Enregistrer la séquence'}</button>
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
  window.pv2ModeleCopier = function (key) {
    const starter = PV2_STARTERS.find((s) => s.key === key);
    if (!starter) return;
    pv2Settings.tplEditing = { id: null, name: `${starter.name} (ma version)`, category: 'marketing', subject: starter.subject, body: starter.body };
    pv2ModeleAllerEditer();
    pv2ApercuModele(0);
    setTimeout(() => { const el = document.getElementById('pv2TplName'); if (el) el.focus(); }, 60);
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
  function pv2ModeleCarte({ ref, name, cat, subject, body, own, id, key }) {
    const excerpt = String(body || '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 2).join(' ');
    return `<article class="pv2-model-card">
      <div class="pv2-model-name"><span>${esc(name)}</span>${own ? '<em class="pv2-tpl-origin">maison</em>' : ''}</div>
      <span class="pv2-model-cat">${esc(cat)}</span>
      <div class="pv2-model-subject">${pv2TexteJetons(subject) || '<em>Sans objet</em>'}</div>
      <div class="pv2-model-excerpt">${pv2TexteJetons(excerpt)}</div>
      <div class="pv2-model-actions">
        <button type="button" class="pv2-btn sm" onclick="pv2ModeleUtiliser('${escJs(ref)}')">${ci('send')}Utiliser</button>
        ${own
          ? `<button type="button" class="pv2-btn sm" onclick="pv2TplEdit('${escJs(String(id))}')">${ci('pencil')}Modifier</button>
             <button type="button" class="pv2-btn sm ghost" onclick="pv2TplArchive('${escJs(String(id))}')">Archiver</button>`
          : `<button type="button" class="pv2-btn sm ghost" onclick="pv2ModeleCopier('${escJs(key)}')">${ci('copy')}Copier en modèle</button>`}
      </div>
    </article>`;
  }

  function pv2ModeleEditeur() {
    const tpl = pv2Settings.tplEditing;
    return `<div class="pv2-seq-editor-cols" data-pv2-mount="tplEditor">
      <div class="pv2-composer-grid">
        <label class="pv2-composer-field"><span>Nom</span><input id="pv2TplName" data-pl-focus="emails.modele.nom" value="${esc(tpl.name)}" placeholder="Ex. Offre rentrée" oninput="pv2TplField('name', this.value)"></label>
        <label class="pv2-composer-field"><span>Catégorie</span><select onchange="pv2TplField('category', this.value)">${PV2_TPL_CATEGORIES.map(([key, label]) => `<option value="${key}"${tpl.category === key ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
        <div class="pv2-composer-field pv2-composer-wide"><span>Objet</span>
          ${pv2TokeditHtml({ id: 'pv2TplSubject', sink: 'tplSubject', value: tpl.subject, single: true, plFocus: 'emails.modele.objet', placeholder: 'Objet du modèle' })}
        </div>
        <div class="pv2-composer-field pv2-composer-wide"><span>Message</span>
          ${pv2VarBar('pv2TplBody', ['prenom', 'nom', 'centre'])}
          ${pv2TokeditHtml({ id: 'pv2TplBody', sink: 'tplBody', value: tpl.body, plFocus: 'emails.modele.message', placeholder: 'Bonjour {{prenom}},…' })}
        </div>
        <div class="pv2-composer-actions pv2-composer-wide">
          <button type="button" class="pv2-btn" onclick="pv2TplCancel()">Annuler</button>
          <span class="pv2-composer-spacer"></span>
          <button type="button" class="pv2-btn primary" onclick="pv2TplSave()" ${pv2Settings.busy ? 'disabled' : ''}>${tpl.id ? 'Enregistrer le modèle' : 'Créer le modèle'}</button>
        </div>
      </div>
      ${pv2ApercuVivantHtml('modele', { titre: 'Aperçu du mail (variables non remplies)' })}
    </div>`;
  }

  function pv2EmailsSectionModeles() {
    const tpl = pv2Settings.tplEditing;
    const groups = [];
    for (const s of PV2_STARTERS) {
      let g = groups.find((x) => x.label === s.cat);
      if (!g) { g = { label: s.cat, cards: [] }; groups.push(g); }
      g.cards.push(pv2ModeleCarte({ ref: `starter:${s.key}`, name: s.name, cat: s.cat, subject: s.subject, body: s.body, own: false, key: s.key }));
    }
    const owned = pv2Mail.templates.map((t) => pv2ModeleCarte({
      ref: `tpl:${t.id}`, name: t.label || t.name || `Modèle ${t.id}`, cat: PV2_TPL_CATEGORY_LABELS[t.category] || t.category || 'Modèle',
      subject: t.subject || '', body: t.body || '', own: true, id: t.id,
    }));
    return `<section class="pv2-panel pv2-settings" data-pv2-mount="settings" aria-label="Modèles">
      <div class="pv2-panel-head has-sub">
        <div><h2>Modèles</h2><p class="pv2-panel-sub">Des textes prêts à envoyer. Les nôtres servent de départ ; les vôtres apparaissent aussi dans le composeur.</p></div>
        ${tpl ? '' : `<button type="button" class="pv2-btn sm primary" onclick="pv2TplEdit(null)">+ Nouveau modèle</button>`}
      </div>
      <div class="pv2-panel-body">
        ${tpl ? pv2ModeleEditeur() : `
        <div class="pv2-model-group">
          <h3>Vos modèles${owned.length ? ` (${owned.length})` : ''}</h3>
          ${owned.length ? `<div class="pv2-model-grid">${owned.join('')}</div>` : '<div class="pv2-empty"><strong>Aucun modèle personnalisé</strong>Copiez un modèle fourni ou partez d\'une page blanche : il apparaîtra dans le composeur.</div>'}
        </div>
        ${groups.map((g) => `<div class="pv2-model-group"><h3>${esc(g.label)}</h3><div class="pv2-model-grid">${g.cards.join('')}</div></div>`).join('')}`}
      </div>
    </section>`;
  }

  /* ── SECTION EXPEDITEURS : les identites, et l adresse de reponse ───────── */
  function pv2EmailsSectionExpediteurs() {
    const identity = pv2Settings.idEditing;
    const channel = pv2Mail.channel || {};
    const centre = pv2Design.center || null;
    // L adresse que les mails donnent VRAIMENT en Reply-To, dite par le serveur
    // (2026-09-17). L adresse publique de la fiche n est qu un repli.
    const reponseServeur = pv2Design.reponse && typeof pv2Design.reponse === 'object' ? pv2Design.reponse : null;
    const reponse = reponseServeur ? String(reponseServeur.adresse || '').trim() : (centre && centre.publicInfo ? String(centre.publicInfo.email || '').trim() : '');
    const reponseVersPinlane = Boolean(reponseServeur && reponseServeur.versPinlane);
    const liste = identity ? `<div class="pv2-composer-grid">
        <label class="pv2-composer-field"><span>Nom affiché</span><input data-pl-focus="emails.identite.nom" value="${esc(identity.label)}" placeholder="Ex. le nom de votre centre" oninput="pv2IdField('label', this.value)"></label>
        <label class="pv2-composer-field"><span>Adresse email</span><input data-pl-focus="emails.identite.email" value="${esc(identity.email)}" placeholder="contact@votre-centre.be" oninput="pv2IdField('email', this.value)"></label>
        <label class="pv2-composer-field pv2-settings-check"><span>&nbsp;</span><label class="pv2-check"><input type="checkbox" ${identity.isDefault ? 'checked' : ''} onchange="pv2IdField('isDefault', this.checked)"> Adresse par défaut</label></label>
        <div class="pv2-composer-actions pv2-composer-wide">
          <button type="button" class="pv2-btn" onclick="pv2Settings.idEditing = null; renderStaffEmailsPage();">Annuler</button>
          <span class="pv2-composer-spacer"></span>
          <button type="button" class="pv2-btn primary" onclick="pv2IdSave()" ${pv2Settings.busy ? 'disabled' : ''}>Ajouter l'adresse</button>
        </div>
      </div>`
      : `<div class="pv2-settings-list">
        ${pv2Mail.identities.length ? pv2Mail.identities.map((i) => `
          <div class="pv2-settings-row">
            <div><strong>${esc(i.label || i.email)}</strong><small>${esc(i.email)}${i.isDefault ? ' · par défaut' : ''}</small></div>
            ${i.isDefault ? '<span class="pv2-chip">Par défaut</span>' : `<button type="button" class="pv2-btn sm" onclick="pv2IdDefault('${escJs(String(i.id))}')">Par défaut</button>`}
            <button type="button" class="pv2-btn sm ghost" onclick="pv2IdDelete('${escJs(String(i.id))}')">Supprimer</button>
          </div>`).join('') : '<div class="pv2-empty"><strong>Aucune adresse configurée</strong>Ajoutez l\'adresse (ou les adresses) avec lesquelles vos emails partent.</div>'}
      </div>`;
    return `<div class="pv2-overview-grid">
      <section class="pv2-panel pv2-settings" data-pv2-mount="settings" aria-label="Expéditeurs">
        <div class="pv2-panel-head has-sub">
          <div><h2>Adresses d'envoi</h2><p class="pv2-panel-sub">Le nom et l'adresse que vos clients voient en tête de mail. Une adresse par défaut, les autres au choix dans le composeur.</p></div>
          ${identity ? '' : `<button type="button" class="pv2-btn sm primary" onclick="pv2IdEdit()">+ Nouvelle adresse</button>`}
        </div>
        <div class="pv2-panel-body">${liste}</div>
      </section>
      <div class="pv2-overview-col">
        <section class="pv2-panel" aria-label="Adresse de réponse">
          <div class="pv2-panel-head has-sub"><div><h2>Adresse de réponse</h2><p class="pv2-panel-sub">Quand un client répond à un mail du centre, sa réponse arrive ici.</p></div></div>
          <div class="pv2-panel-body pv2-reply-address">
            ${pv2Design.loaded
              ? (reponse ? `<strong>${esc(reponse)}</strong><p class="pv2-note">${reponseVersPinlane ? 'Les réponses des clients arrivent directement dans Reçus. Elles n\'arrivent pas dans la boîte mail du centre.' : 'Les réponses des clients arrivent dans cette boîte mail. Elles arrivent aussi dans Reçus quand la boîte les redirige vers Pinlane.'}</p>` : '<strong>Non renseignée pour ce centre</strong><p class="pv2-note">La fiche du centre n\'a pas d\'adresse publique : les réponses des clients suivent l\'adresse d\'envoi.</p>')
              : `<span class="pv2-live-state" aria-live="polite">${pv2Design.error ? esc(pv2Design.error) : 'Lecture de la fiche du centre…'}</span>`}
          </div>
        </section>
        <section class="pv2-panel" aria-label="Fournisseur d'envoi">
          <div class="pv2-panel-head has-sub"><div><h2>Fournisseur d'envoi</h2><p class="pv2-panel-sub">Ce que Pinlane sait de la chaîne d'envoi.</p></div></div>
          <div class="pv2-panel-body pv2-reply-address">
            ${pv2Mail.metaLoaded
              ? `<strong>${channel.resendConfigured ? 'Envoi configuré' : 'Envoi non configuré'}</strong><p class="pv2-note">${channel.resendConfigured ? 'Les mails partent par le fournisseur relié à Pinlane.' : 'Aucun fournisseur relié : les mails restent en file sans partir.'}${channel.aiConfigured ? ' L\'agent utilise un modèle de langage pour lire les mails reçus.' : ' L\'agent lit les mails reçus avec ses règles internes.'}</p>`
              : '<span class="pv2-live-state" aria-live="polite">Chargement…</span>'}
          </div>
        </section>
      </div>
    </div>`;
  }

  /* ── SECTION L AGENT : ses textes, et ce qu il ne sait pas ───────────────── */
  function pv2EmailsSectionAgent() {
    const brain = pv2Settings.brain;
    const form = !brain.loaded
      ? `<div class="pv2-empty" aria-live="polite" aria-busy="true">${typeof renderThinking === 'function' ? renderThinking('searching') : '<strong>Chargement…</strong>'}</div>`
      : brain.error || !brain.draft
        ? `<div class="pv2-empty" role="status"><strong>Textes indisponibles</strong>${esc(brain.error || 'Réponse incomplète du serveur.')}<button type="button" class="pv2-btn sm" onclick="pv2BrainRelire()">Réessayer</button></div>`
      : `<div class="pv2-composer-grid">
        <p class="pv2-panel-sub pv2-composer-wide">L'agent répond aux mails reçus avec CES textes. Modifiez-les librement : ce que vous écrivez ici gagne toujours sur le modèle d'origine. Champ vidé = retour au modèle.</p>
        <label class="pv2-composer-field"><span>Signature</span>
          <input data-pl-focus="emails.agent.signature" value="${esc(brain.draft.signature)}" placeholder="${esc(brain.defaults.signature || '')}" oninput="pv2BrainField('signature', null, this.value)">
        </label>
        <label class="pv2-composer-field pv2-composer-wide"><span>Consignes libres (ce que l'agent doit toujours savoir)</span>
          <textarea rows="3" data-pl-focus="emails.agent.consignes" placeholder="Ex. Le parking est gratuit derrière le bâtiment. On ne prend pas de réservation le lundi." oninput="pv2BrainField('extra', null, this.value)">${esc(brain.draft.extra)}</textarea>
        </label>
        ${Object.entries(brain.defaults.intents || PV2_INTENT_LABELS).map(([intent, label]) => `
        <label class="pv2-composer-field pv2-composer-wide"><span>Réponse « ${esc(label)} »${brain.overrides.faq[intent] ? ' <em class="pv2-seq-pill">modifiée</em>' : ''}</span>
          <textarea rows="4" data-pl-focus="emails.agent.faq.${esc(intent)}" placeholder="${esc(brain.defaults.faq[intent]?.body || 'Réponse type…')}" oninput="pv2BrainField('faq', '${escJs(intent)}', this.value)">${esc(brain.draft.faq[intent] || '')}</textarea>
        </label>`).join('')}
        <div class="pv2-composer-actions pv2-composer-wide">
          <button type="button" class="pv2-btn primary" onclick="pv2BrainSave()" ${pv2Settings.busy ? 'disabled' : ''}>${pv2Settings.busy ? 'Enregistrement…' : 'Enregistrer, l\'agent apprend'}</button>
        </div>
      </div>`;
    return `<div class="pv2-agent-grid">
      <section class="pv2-panel pv2-settings" data-pv2-mount="settings" aria-label="Réglages de l'agent">
        <div class="pv2-panel-head has-sub">
          <div><h2>Ce que l'agent écrit</h2><p class="pv2-panel-sub">Sa signature, ses consignes, et sa réponse type par sujet.</p></div>
        </div>
        <div class="pv2-panel-body">${form}</div>
      </section>
      ${pv2SectionApprentissage({ toujours: true })}
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
    { key: 'reminder_48h', label: 'Rappel avant la venue', desc: 'Rappelle la venue quelques jours avant : moins d’absences le jour J.', timing: { options: [1, 2, 3, 4], label: (n) => `${n} jour${n > 1 ? 's' : ''} avant la venue` } },
    { key: 'post_visit', label: 'Merci post-visite', desc: 'Remercie après la visite et invite à revenir.', timing: { options: [0, 1, 2, 3], label: (n) => (n === 0 ? 'Le jour même' : `${n} jour${n > 1 ? 's' : ''} après la visite`) } },
    // « Anniversaire J-30 » et « Réactivation dormants » étaient du jargon de
    // marketeur sur un écran lu par une gérante de centre de loisirs : « J-30 »
    // ne se lit pas, « dormants » est un mot de CRM. Le libellé dit maintenant
    // ce que fait la séquence, en français.
    { key: 'birthday_j30', label: '30 jours avant l’anniversaire', desc: 'L’anniversaire fêté ici revient chaque année, relance toute seule au bon moment.', timing: { options: [15, 21, 30, 45, 60], label: (n) => `${n} jours avant la date anniversaire` } },
    { key: 'reactivation', label: 'Réactiver les clients dormants', desc: 'Clients fidèles plus vus depuis 2-3 mois : un rappel doux, plafonné par semaine.', cap: { options: [5, 10, 20, 30, 50], label: (n) => `${n} envois max / semaine` } },
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
  const pv2Suppress = { loaded: false, loading: false, error: '', entries: [], total: 0, busy: '', addEmail: '', addReason: '' };
  window.pv2Suppress = pv2Suppress;
  const PV2_SUPPRESS_SOURCE = { link: 'Lien de retrait', staff: 'Ajout manuel', complaint: 'Plainte' };

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
    const rows = pv2Suppress.entries.map((entry) => {
      const when = formatOpsTimestamp(entry.createdAt) || '-';
      const src = PV2_SUPPRESS_SOURCE[entry.source] || entry.source || '-';
      const busy = pv2Suppress.busy === `rm:${entry.email}`;
      return `<tr>
        <td><strong>${esc(entry.email)}</strong>${entry.reason ? `<small class="pv2-cell-sub">${esc(entry.reason)}</small>` : ''}</td>
        <td><span class="pv2-chip">${esc(src)}</span></td>
        <td class="num">${esc(when)}</td>
        <td><button type="button" class="pv2-btn sm ghost" onclick="pv2SuppressRemove('${escJs(entry.email)}')" ${busy ? 'disabled' : ''}>${busy ? 'Retrait…' : 'Réinscrire'}</button></td>
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
        <div class="pv2-suppress-add" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;align-items:center;">
          <input type="email" value="${esc(pv2Suppress.addEmail)}" placeholder="adresse@exemple.be" oninput="pv2SuppressSetAdd('email', this.value)" style="flex:1 1 220px;min-width:180px;padding:8px 10px;border:1px solid var(--v2-border,#e2e2e2);border-radius:6px;">
          <input type="text" value="${esc(pv2Suppress.addReason)}" placeholder="Motif (facultatif)" oninput="pv2SuppressSetAdd('reason', this.value)" style="flex:1 1 160px;min-width:140px;padding:8px 10px;border:1px solid var(--v2-border,#e2e2e2);border-radius:6px;">
          <button type="button" class="pv2-btn sm" onclick="pv2SuppressAdd()" ${pv2Suppress.busy === 'add' ? 'disabled' : ''}>${pv2Suppress.busy === 'add' ? 'Ajout…' : 'Ajouter à la liste'}</button>
        </div>
        ${pv2Suppress.error
          ? `<div class="pv2-empty"><strong>${esc(pv2Suppress.error)}</strong></div>`
          : !pv2Suppress.loaded
            ? `<div class="pv2-empty">${typeof renderThinking === 'function' ? renderThinking('searching') : '<strong>Chargement…</strong>'}</div>`
            : pv2Suppress.entries.length
              ? `<table class="pv2-table">
                  <thead><tr><th>Adresse</th><th>Origine</th><th class="num">Depuis</th><th></th></tr></thead>
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
    if (!keys.length) return '<p class="pv2-panel-sub">Aucun detail de modification enregistre pour cette action.</p>';
    const rows = keys.map((key) => `<tr>
      <td><strong>${esc(key)}</strong></td>
      <td>${esc(pv2AuditValue(changes[key] && changes[key].before))}</td>
      <td>${esc(pv2AuditValue(changes[key] && changes[key].after))}</td>
    </tr>`).join('');
    return `<table class="pv2-table">
      <thead><tr><th>Champ</th><th>Avant</th><th>Apres</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
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
        ? `<span class="pv2-chip red">Refuse${entry.deniedReason ? ` · ${esc(PV2_AUDIT_DENIED[entry.deniedReason] || entry.deniedReason)}` : ''}</span>`
        : isError
          ? '<span class="pv2-chip">Échec</span>'
          : '<span class="pv2-chip">Fait</span>';
      const detail = expanded
        ? `<tr class="pv2-audit-detail"><td colspan="6">
             ${pv2AuditChangesTable(entry.changes)}
             <p class="pv2-panel-sub" style="margin-top:10px;">
               Surface ${esc(entry.surface || '-')} · methode ${esc(entry.method || '-')}
               ${entry.entityType ? ` · objet ${esc(entry.entityType)}${entry.entityId ? ` #${esc(entry.entityId)}` : ''}` : ''}
               ${entry.requestId ? ` · requete ${esc(entry.requestId)}` : ''}
             </p>
           </td></tr>`
        : '';
      return `<tr${isDenied ? ' class="is-denied"' : ''}>
        <td class="num">${esc(when)}</td>
        <td><strong>${esc(actor)}</strong><small class="pv2-cell-sub">${esc(kind)}${entry.actorRoleId ? ` · ${esc(entry.actorRoleId)}` : ''}</small></td>
        <td><strong>${esc(entry.action || '-')}</strong>${entry.entityType ? `<small class="pv2-cell-sub">${esc(entry.entityType)}${entry.entityId ? ` #${esc(entry.entityId)}` : ''}</small>` : ''}</td>
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

  window.pv2AutoEditField = function (field, value) {
    mkAuto.editDraft[field] = field === 'offsetDays' || field === 'cap' ? Number(value) : value;
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
    const def = mkAuto.defaults[key] || {};
    const d = mkAuto.editDraft;
    const body = { action: 'automationSettings', key, centerId: state.adminCenterId || 'libramont' };
    if (String(d.subject || '').trim() && d.subject !== def.subject) body.subject = d.subject;
    if (String(d.body || '').trim() && d.body !== def.body) body.body = d.body;
    if (d.offsetDays !== undefined && Number(d.offsetDays) !== Number(def.offsetDays)) body.offsetDays = Number(d.offsetDays);
    if (d.cap !== undefined && Number(d.cap) !== Number(def.cap)) body.cap = Number(d.cap);
    const currentReviewUrl = (mkAuto.settings && mkAuto.settings[key] && mkAuto.settings[key].reviewUrl) || '';
    if (key === 'post_visit' && String(d.reviewUrl || '').trim() !== currentReviewUrl) body.reviewUrl = String(d.reviewUrl || '').trim();
    if (Object.keys(body).length === 3) { toast('Rien à enregistrer : tout est déjà au réglage par défaut.'); return; }
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
    mkAuto.busyKey = key;
    renderStaffEmailsPage();
    try {
      // Aucune adresse n'est envoyée : le serveur envoie au membre connecté.
      const payload = await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ ...pv2AutoDraftBody(key), action: 'sendAutomationTest' }),
      });
      if (payload.status === 'sent') toast(`Test envoyé à ${payload.recipient}`);
      else toast(`Le test n'est pas parti : ${payload.error || 'cause inconnue'}`);
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
    pv2Mail.retryingId = String(id);
    renderStaffEmailsPage();
    try {
      const payload = await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'retryCommunication', id: Number(id), centerId: state.adminCenterId || 'libramont' }),
      });
      if (payload.status === 'sent') toast('Mail renvoyé ✓');
      else toast(`Toujours pas parti : ${payload.error || 'même cause'}`);
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
        <span>Quand ?</span>
        <select onchange="pv2AutoEditField('offsetDays', this.value)" aria-label="Timing">
          ${meta.timing.options.map((n) => `<option value="${n}"${Number(d.offsetDays) === n ? ' selected' : ''}>${esc(meta.timing.label(n))}</option>`).join('')}
        </select>
      </label>` : '';
    const capSelect = meta.cap ? `
      <label class="mk-auto-edit-field">
        <span>Plafond</span>
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
        <span>Lien avis Google <small class="mk-auto-edit-hint">le mail ajoute un bouton « Laissez-nous un avis » : les clics sont comptés</small></span>
        <input value="${esc(d.reviewUrl || '')}" placeholder="https://g.page/r/…" oninput="pv2AutoEditField('reviewUrl', this.value)" aria-label="Lien de la fiche Google">
      </label>` : '';
    // Un corps personnalisé REMPLACE tout le message : le tableau récapitulatif
    // (date, heure, formule, participants) disparaît. C'est le comportement
    // voulu (le texte du gérant EST le message), mais il est contre-intuitif et
    // se paie en appels clients. On le dit avant, plutôt que de le corriger en
    // douce ou de laisser la découverte se faire en production.
    const hasDetails = ['request_received', 'confirmation', 'reminder_48h'].includes(meta.key);
    const warning = hasDetails && String(d.body || '').trim()
      ? `<p class="mk-auto-edit-warn">Votre texte remplace le message entier : le récapitulatif (date, heure, formule, participants) ne sera plus affiché. Pensez à y remettre les infos utiles, avec les variables ci-dessus.</p>`
      : '';
    // Deux colonnes : les champs, et le mail vivant rendu par le serveur.
    return `<div class="mk-auto-edit" data-pv2-mount="autoEditor">
      <div class="mk-auto-edit-fields">
        <div class="mk-auto-edit-field"><span>Objet</span>
          ${pv2TokeditHtml({ id: 'mkAutoSubject', sink: 'autoSubject', value: d.subject, single: true, plFocus: 'emails.auto.objet', placeholder: def.subject || 'Objet par défaut' })}
        </div>
        <div class="mk-auto-edit-field"><span>Message</span>
          ${pv2TokeditHtml({ id: 'mkAutoBody', sink: 'autoBody', value: d.body, plFocus: 'emails.auto.message', placeholder: def.body || 'Message par défaut' })}
        </div>
        ${variables}
        ${timingSelect}
        ${capSelect}
        ${reviewField}
        ${warning}
      </div>
      ${pv2ApercuVivantHtml('auto', { titre: 'Aperçu avec une réservation d\'exemple' })}
      <div class="mk-auto-edit-actions">
        <button type="button" class="pv2-btn sm primary" onclick="pv2AutoEditSave('${meta.key}')" ${busy ? 'disabled' : ''}>${busy ? 'Enregistrement…' : 'Enregistrer'}</button>
        <button type="button" class="pv2-btn sm" onclick="pv2AutoEditReset('${meta.key}')" ${busy ? 'disabled' : ''}>Réinitialiser</button>
        <button type="button" class="pv2-btn sm" onclick="pv2AutoPreview('${meta.key}')" ${busy ? 'disabled' : ''}>Voir le mail en grand</button>
        <button type="button" class="pv2-btn sm" onclick="pv2AutoSendTest('${meta.key}')" ${busy ? 'disabled' : ''}>M'envoyer un test</button>
        <button type="button" class="pv2-btn sm ghost" onclick="pv2AutoEdit('${meta.key}')">Fermer</button>
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

  function mkAutoCard(meta) {
    const setting = mkAuto.settings ? mkAuto.settings[meta.key] : null;
    const enabled = !!(setting && setting.enabled);
    const stats = mkAuto.stats[meta.key] || {};
    const busy = mkAuto.busyKey === meta.key;
    const editing = mkAuto.editKey === meta.key;
    const modified = pv2AutoHasOverride(meta.key);
    const effectif = mkAutoTexteEffectif(meta.key);
    // ÉTOILE AMBRE SUPPRIMÉE : elle ne portait aucune information lisible (son
    // seul sens vivait dans un title=, invisible), et elle dépensait l'ambre
    // que cet écran réserve à l'ATTENTE. Couleur = sens, sinon rien.
    // NBSP entre un nombre et son unité : « 37 envoyés · 20 / échecs (30 j) »
    // laissait le nombre seul en fin de ligne dans 3 cartes sur 6, séparé de
    // ce qu'il compte. Un nombre ne se lit pas sans son unité.
    const sent30 = Number(stats.sent30d) || 0;
    const failed30 = Number(stats.failed30d) || 0;
    const NB = ' ';
    const statsTxt = `${sent30}${NB}envoyé${sent30 > 1 ? 's' : ''}${failed30 ? ` · <span class="mk-auto-fail">${failed30}${NB}échec${failed30 > 1 ? 's' : ''}</span>` : ''} sur 30${NB}jours`;
    return `<article class="mk-auto${enabled ? ' is-on' : ''}${editing ? ' is-editing' : ''}">
      <div class="mk-auto-head">
        <strong>${esc(meta.label)}${modified ? '<span class="mk-auto-mod">modifié</span>' : ''}</strong>
        <button type="button" class="mk-switch${enabled ? ' is-on' : ''}" data-switch-key="auto:${esc(meta.key)}" role="switch" aria-checked="${enabled}" aria-label="${esc(meta.label)}" onclick="toggleStaffAutomation('${meta.key}')" ${busy || !mkAuto.settings ? 'disabled' : ''}><span></span></button>
      </div>
      <p class="mk-auto-desc">${esc(mkAutoPhraseDeclenchement(meta))}</p>
      <div class="mk-auto-effectif">
        <span class="mk-auto-effectif-label">Ce qui part</span>
        ${effectif.connu
          ? `<span class="mk-auto-subject">${pv2TexteJetons(effectif.subject) || '<em>Sans objet</em>'}</span>
             <span class="mk-auto-line">${pv2TexteJetons(pv2PremiereLigne(effectif.body)) || '<em>Message vide</em>'}</span>`
          : '<span class="mk-auto-line">Texte d\'usine non chargé</span>'}
      </div>
      <div class="mk-auto-foot">
        <span class="mk-auto-stats">${statsTxt}</span>
        <div class="mk-auto-actions">
          <button type="button" class="mkw-link mk-auto-preview" onclick="pv2AutoPreview('${meta.key}')" ${mkAuto.busyKey === meta.key ? 'disabled' : ''}>Voir le mail</button>
          <button type="button" class="pv2-btn sm mk-auto-edit-btn" onclick="pv2AutoEdit('${meta.key}')">${ci('pencil')}${editing ? 'Fermer' : 'Modifier'}</button>
          <button type="button" class="pv2-btn sm ghost mk-auto-test" onclick="pv2AutoSendTest('${meta.key}')" ${busy ? 'disabled' : ''}>M'envoyer un test</button>
        </div>
      </div>
      ${editing ? mkAutoEditor(meta) : ''}
    </article>`;
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
    const aiOn = !!(pv2Mail.channel && pv2Mail.channel.aiConfigured);
    const ctx = pv2VarContext(d);
    const identity = pv2Mail.identities.find((i) => String(i.id) === String(d.identityId)) || pv2Mail.identities[0] || null;
    const fromLine = identity ? `${identity.label || identity.email} <${identity.email}>` : 'expéditeur par défaut';
    const toLine = d.to ? `${d.name ? `${d.name} ` : ''}<${d.to}>` : 'choisissez un client';
    return `<section class="pv2-panel pv2-composer" role="dialog" aria-modal="true" aria-label="Nouveau message">
      <div class="pv2-panel-head has-sub">
        <div><h2>${d.replyTo ? 'Répondre' : 'Nouveau message'}</h2><p class="pv2-panel-sub">Choisissez le client, un modèle si vous voulez, écrivez : l'aperçu montre le mail que le client recevra.</p></div>
        <button type="button" class="pv2-btn sm" onclick="pv2CloseComposer()">Fermer</button>
      </div>
      <div class="pv2-panel-body pv2-composer-grid">
        <div class="pv2-composer-field pv2-composer-to"><span id="pv2ComboLabel">À</span>
          <div class="pv2-combo">
            <input id="pv2ComposerTo" role="combobox" aria-expanded="false" aria-autocomplete="list" aria-controls="pv2ComboList" aria-labelledby="pv2ComboLabel"
              data-pl-focus="emails.composer.to" value="${esc(d.to)}" placeholder="Nom, téléphone ou début d'adresse…"
              autocomplete="one-time-code" name="pv2-recherche-client" spellcheck="false"
              oninput="pv2ComboInput(this.value)" onfocus="pv2ComboFocus()" onblur="pv2ComboBlur()" onkeydown="pv2ComboKey(event)">
            <div class="pv2-combo-list" id="pv2ComboList" role="listbox" aria-label="Clients correspondants" hidden></div>
          </div>
        </div>
        <label class="pv2-composer-field"><span>Expéditeur</span>
          <select onchange="pv2ComposerField('identityId', this.value); pv2ComposerSyncHints();" aria-label="Adresse d'envoi">${identityOptions}</select>
        </label>
        <div class="pv2-composer-field"><span>Modèle</span>
          <button type="button" class="pv2-tpl-toggle${pv2Mail.pickerOpen ? ' is-open' : ''}" aria-expanded="${pv2Mail.pickerOpen}" aria-controls="pv2TplPicker" onclick="pv2TogglePicker()">
            <span>${currentTpl ? esc(currentTpl) : 'Choisir un modèle…'}</span>${ci('chevronDown')}
          </button>
        </div>
        <div class="pv2-composer-field pv2-composer-when"><span>Envoi</span>
          <div class="pv2-composer-when-row">
            <select onchange="pv2ComposerField('when', this.value); pv2RenderComposer();" aria-label="Moment d'envoi">
              <option value="now"${d.when !== 'later' ? ' selected' : ''}>Maintenant</option>
              <option value="later"${d.when === 'later' ? ' selected' : ''}>Programmer</option>
            </select>
            ${d.when === 'later' ? `<input type="datetime-local" value="${esc(d.scheduledAt)}" aria-label="Date et heure d'envoi" onchange="pv2ComposerField('scheduledAt', this.value)">` : ''}
          </div>
        </div>
        ${pv2Mail.pickerOpen ? `<div class="pv2-composer-wide">${pv2TplPickerPanel(d, ctx)}</div>` : ''}
        <div class="pv2-composer-field pv2-composer-wide"><span>Objet</span>
          ${pv2TokeditHtml({ id: 'pv2ComposerSubject', sink: 'composerSubject', value: d.subject, single: true, plFocus: 'emails.composer.objet', placeholder: 'Objet du message' })}
        </div>
        <div class="pv2-composer-field pv2-composer-wide">
          <span>Message</span>
          <div class="pv2-toolbar" role="toolbar" aria-label="Mise en forme">
            <button type="button" class="pv2-tool" title="Gras" aria-label="Gras" onclick="pv2ApplyMarker('bold')"><strong>G</strong></button>
            <button type="button" class="pv2-tool" title="Italique" aria-label="Italique" onclick="pv2ApplyMarker('italic')"><em>I</em></button>
            <button type="button" class="pv2-tool" title="Liste à puces" aria-label="Liste à puces" onclick="pv2ApplyMarker('list')">•&#8201;•</button>
            <button type="button" class="pv2-tool" title="Lien" aria-label="Insérer un lien" onclick="pv2ApplyMarker('link')">Lien</button>
            <button type="button" class="pv2-tool" title="Bouton d'action dans le mail" aria-label="Insérer un bouton" onclick="pv2ApplyMarker('button')">Bouton</button>
            <span class="pv2-toolbar-sep" aria-hidden="true"></span>
            ${Object.entries(PV2_VAR_LABELS).map(([key, label]) => `<button type="button" class="pv2-tool pv2-tool-var" title="Insérer ${esc(label)}" onclick="pv2InsertVarAt('pv2ComposerBody', '${key}')">${esc(label)}</button>`).join('')}
          </div>
          ${pv2TokeditHtml({ id: 'pv2ComposerBody', sink: 'composerBody', value: d.body, plFocus: 'emails.composer.message', placeholder: 'Bonjour…' })}
          <p class="pv2-vars-hint" id="pv2ComposerVarsHint" ${unresolved.length ? '' : 'hidden'}>${unresolved.length ? `À compléter avant l'envoi : ${unresolved.map((k) => `<code>{{${esc(k)}}}</code>`).join(' ')}${missName ? ' <span>(choisissez un client pour remplir le prénom)</span>' : ''}` : ''}</p>
          <div class="pv2-mail-paper">
            <div class="pv2-mail-paper-subject" id="pv2PreviewSubject">${pv2RenderEmailPreview(d.subject, ctx).replace(/^<p>|<\/p>$/g, '') || '<span class="pv2-preview-empty">Objet du message</span>'}</div>
            <div class="pv2-mail-paper-meta" id="pv2PreviewMeta"><span><b>De</b> ${esc(fromLine)}</span><span><b>À</b> ${esc(toLine)}</span></div>
            <div class="pv2-mail-render" id="pv2ComposerPreview" aria-label="Aperçu du message">${pv2RenderEmailPreview(d.body, ctx) || '<p class="pv2-preview-empty">L\'aperçu du message s\'affiche ici pendant que vous écrivez.</p>'}</div>
          </div>
        </div>
        ${pv2Mail.aiTips.length ? `<ul class="pv2-composer-tips">${pv2Mail.aiTips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
        <div class="pv2-composer-actions pv2-composer-wide">
          <button type="button" class="pv2-btn" onclick="pv2ComposerServerPreview()">Voir le mail final</button>
          <button type="button" class="pv2-btn" onclick="pv2ComposerSaveAsTemplate()">Garder en modèle</button>
          <button type="button" class="pv2-btn" onclick="pv2ComposerImprove()" ${pv2Mail.aiBusy ? 'disabled' : ''}>${ci('sparkles')}${pv2Mail.aiBusy ? 'Analyse…' : (aiOn ? 'Améliorer par IA' : 'Conseils d\'écriture')}</button>
          <span class="pv2-composer-spacer"></span>
          <button type="button" class="pv2-btn" onclick="pv2CloseComposer()">Annuler</button>
          <button type="button" class="pv2-btn primary" onclick="pv2ComposerSend()" ${pv2Mail.busy ? 'disabled' : ''}>${ci('send')}${pv2Mail.busy ? 'Envoi…' : 'Envoyer'}</button>
        </div>
      </div>
    </section>`;
  }

  function pv2AnalyzePanel() {
    return `<section class="pv2-panel pv2-analyze" data-pv2-mount="analyze" aria-label="Coller un mail reçu">
      <div class="pv2-panel-head has-sub">
        <div><h2>Coller un mail reçu</h2><p class="pv2-panel-sub">Collez un mail reçu dans votre boîte : l'agent dit ce que veut le client et prépare la réponse.</p></div>
        <button type="button" class="pv2-btn sm" onclick="pv2OpenAnalyze()">Fermer</button>
      </div>
      <div class="pv2-panel-body pv2-composer-grid">
        <label class="pv2-composer-field"><span>De (adresse du client)</span>
          <input id="pv2AnalyzeFrom" data-pl-focus="emails.analyse.de" value="${esc(pv2Mail.analyzeDraft.from)}" placeholder="client@exemple.be" oninput="pv2AnalyzeField('from', this.value)">
        </label>
        <label class="pv2-composer-field pv2-composer-wide"><span>Texte du mail reçu</span>
          <textarea rows="6" data-pl-focus="emails.analyse.texte" placeholder="Collez ici le contenu du mail…" oninput="pv2AnalyzeField('body', this.value)">${esc(pv2Mail.analyzeDraft.body)}</textarea>
        </label>
        <div class="pv2-composer-actions pv2-composer-wide">
          <button type="button" class="pv2-btn primary" onclick="pv2AnalyzeSubmit()" ${pv2Mail.analyzeBusy ? 'disabled' : ''}>${ci('sparkles')}${pv2Mail.analyzeBusy ? 'Analyse…' : 'Analyser'}</button>
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

  function pv2Paragraphes(texte) {
    const propre = String(texte || '').replace(/\r\n/g, '\n').trim();
    if (!propre) return '<p class="pv2-mail-vide">Ce message n a pas de contenu.</p>';
    return propre
      .split(/\n{2,}/)
      .map((bloc) => `<p>${esc(bloc).split('\n').join('<br>')}</p>`)
      .join('');
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
    return `
      <div class="pv2-mail-corps">
        ${pv2Paragraphes(message)}
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
  // Le droit d apprendre est celui que le serveur exige (api/ops.js, l une ou
  // l autre permission) : sans lui, les cases et les boutons n existent pas
  // (DESIGN.md regle 9), la memoire reste lisible.
  const pv2PeutApprendre = () => typeof canUseStaffPermission !== 'function' || canUseStaffPermission(['emails.send', 'direction.view']);
  // LE SUIVI : les questions de clients resolues sur toutes celles posees (la
  // jauge), et les quatre chiffres qui disent que l agent apprend.
  function pv2SavoirSuivi(suivi) {
    const resolues = Number(suivi.resolues) || 0;
    const total = resolues + (Number(suivi.questions) || 0);
    const part = total ? Math.round((resolues / total) * 100) : 100;
    const libelle = total
      ? `${pv2Pluriel(resolues, 'question résolue', 'questions résolues')} sur ${total} posées par des clients`
      : 'Aucune question de client pour l’instant';
    return `<div class="pv2-savoir-suivi">
        <div class="pv2-savoir-jauge" role="img" aria-label="${esc(libelle)}"><span style="width:${part}%"></span></div>
        <p class="pv2-savoir-jauge-texte">${esc(libelle)}</p>
        ${Number(suivi.corrections) > 0 ? `<p class="pv2-savoir-jauge-texte pv2-savoir-corrections">Il retient aussi vos corrections : ${pv2Pluriel(Number(suivi.corrections), 'réponse corrigée avant envoi', 'réponses corrigées avant envoi')}.</p>` : ''}
        <dl class="pv2-savoir-chiffres">
          <div><dt>Faits appris</dt><dd>${Number(suivi.faits) || 0}</dd></div>
          <div><dt>En attente</dt><dd>${Number(suivi.questions) || 0}</dd></div>
          <div><dt>Résolues</dt><dd>${resolues}</dd></div>
          <div><dt>Cette semaine</dt><dd>+${Number(suivi.semaine) || 0}</dd></div>
        </dl>
      </div>`;
  }
  // LA CASE OU L ON REPOND, son compteur et son bouton. `libelle` : Apprendre
  // (une question, un fait nouveau) ou Enregistrer (une correction).
  function pv2SavoirChamp(cle, brouillon, etiquette, placeholder, libelle = 'Apprendre') {
    const texte = String(brouillon || '').trim();
    const trop = texte.length > PV2_SAVOIR_MAX;
    const sujetManquant = cle === 'nouveau' && !String((pv2Mail.nouveauFait || {}).question || '').trim();
    const occupe = pv2Mail.apprentissageBusy === cle;
    return `<textarea class="pv2-savoir-reponse" rows="3" placeholder="${esc(placeholder)}"
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
          ? pv2SavoirChamp(cle, pv2Mail.reponsesApprises[cle] || '', 'Ce que l’agent doit retenir', 'Répondez une fois : l’agent le saura pour tous les prochains messages.')
          : '<p class="pv2-savoir-vide">Lui répondre engage tous les messages suivants : c’est réservé à qui envoie les e-mails ou à la direction.</p>'}
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
        : '<div class="pv2-savoir-apres is-attente"><span class="pv2-savoir-etiquette">Après</span><p>L’agent n’a pas pu refaire sa réponse cette fois : celle d’avant reste proposée. Le fait, lui, est appris et sert dès le prochain message.</p></div>';
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
          <p class="pv2-savoir-sous">${lus.length ? `Questions proches relues avec ce fait : ${pv2Pluriel(a.resolues, 'résolue', 'résolues')} sur ${lus.length}` : 'Les questions proches n’ont pas pu être relues cette fois : elles restent en attente.'}</p>
          ${lus.length ? `<ul>${lus.map((x) => `<li class="${x.resolue ? 'is-resolue' : ''}"><b>${x.resolue ? 'Résolue' : 'Encore ouverte'}</b><span>${esc(x.resolue ? x.question : (x.encore || x.question))}</span></li>`).join('')}</ul>` : ''}
        </div>`;
    }
    return `
      <article class="pv2-savoir-resultat${neuf ? ' is-neuf' : ''}">
        <p class="pv2-savoir-appris"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>Appris</p>
        <div class="pv2-savoir-fait-retenu"><strong>${esc(r.fait ? r.fait.question : '')}</strong><span>${esc(r.fait ? r.fait.reponse : '')}</span></div>
        ${avantApres}
        ${r.question && r.apres && r.utilise === true ? '<p class="pv2-savoir-utilise is-oui">Réponse refaite avec ce fait.</p>' : ''}
        ${r.question && r.apres && r.utilise === false ? '<p class="pv2-savoir-utilise is-non" role="status">L’agent n’a pas repris ce fait dans cette réponse : relisez-la avant de l’envoyer.</p>' : ''}
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
    if (!appris.length) return '<p class="pv2-savoir-vide">Rien encore : chaque réponse apprise vient s’ajouter ici.</p>';
    const busy = pv2Mail.apprentissageBusy;
    const cherche = String(pv2Mail.memoireFiltre || '').trim().toLowerCase();
    return `<input type="search" class="pv2-savoir-recherche" placeholder="Chercher dans sa mémoire" aria-label="Chercher dans sa mémoire"
        data-pl-focus="emails.savoir.recherche" value="${esc(pv2Mail.memoireFiltre || '')}" oninput="pv2SavoirFiltre(this.value)">
      <ul class="pv2-savoir-memoire">${appris.map((f) => {
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
                 <button type="button" class="pv2-btn sm ghost" title="L’agent oublie ce fait" ${busy ? 'disabled' : ''} onclick="pv2OublierLeFait('${escJs(id)}', '${escJs(String(f.question || ''))}')">Oublier</button>`}
          </div>` : ''}
        </li>`;
      }).join('')}</ul>
      <p class="pv2-savoir-vide pv2-savoir-aucun" ${cherche && !appris.some((f) => `${f.question || ''} ${f.reponse || ''}`.toLowerCase().indexOf(cherche) >= 0) ? '' : 'hidden'}>Aucun fait ne contient « ${esc(pv2Mail.memoireFiltre || '')} ».</p>`;
  }
  function pv2SavoirNouveau() {
    const n = pv2Mail.nouveauFait || { question: '' };
    return `<details class="pv2-savoir-bloc pv2-savoir-nouveau" ${pv2Mail.nouveauOuvert ? 'open' : ''} ontoggle="pv2Mail.nouveauOuvert = this.open">
        <summary>Lui apprendre autre chose</summary>
        <p class="pv2-savoir-sous">Sans attendre qu’un client le demande : un sujet, et ce qu’il doit savoir.</p>
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
          <button type="button" class="pv2-btn sm ghost" onclick="pv2EmailsGo('agent')">${q && pv2PeutApprendre() ? 'Lui répondre' : 'Voir dans L’agent'}</button>
        </div>
        <div class="pv2-panel-body">
          ${pv2SavoirSuivi(suivi)}
          ${q ? `<p class="pv2-savoir-question">${esc(q.question)}</p><p class="pv2-savoir-origine">${esc(attente)}</p>` : ''}
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
      <section class="pv2-panel pv2-savoir" aria-label="Apprentissage de l’agent">
        <div class="pv2-panel-head has-sub">
          <div><h2>Apprentissage de l’agent</h2><p class="pv2-panel-sub">Ce qu’il ne sait pas, il le demande. Ce que vous répondez, il le retient pour tous les messages suivants.</p></div>
          <span class="pv2-savoir-compte">${esc(attente)}</span>
        </div>
        <div class="pv2-panel-body pv2-savoir-corps">
          ${pv2SavoirSuivi(suivi)}
          ${resultat ? pv2SavoirResultat(resultat) : (q ? pv2SavoirCarte(q, rang + 1, total) : '<p class="pv2-savoir-vide pv2-savoir-tout-su">L’agent a su répondre à tous les messages reçus.</p>')}
          ${liste}
          ${pv2PeutApprendre() ? pv2SavoirNouveau() : ''}
          <details class="pv2-savoir-bloc" ${pv2Mail.memoireOuverte ? 'open' : ''} ontoggle="pv2Mail.memoireOuverte = this.open">
            <summary>Sa mémoire (${pv2Pluriel(appris.length, 'fait', 'faits')})</summary>
            ${pv2SavoirMemoire(appris)}
          </details>
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
    const reponse = String(pv2Mail.reponsesApprises[cle] || '').trim();
    if (!reponse) { toast('Écrivez d\'abord la réponse à retenir.'); return; }
    if (reponse.length > PV2_SAVOIR_MAX) { toast(`Trop long : ${PV2_SAVOIR_MAX} caractères au plus.`); return; }
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
          <p class="pv2-panel-sub">${total} messages partent d'ici : ${total - staffCount} au client, ${staffCount} à l'équipe. Aucun autre.</p>
        </div>
        <button type="button" class="pv2-btn sm" onclick="pv2ToggleMailInventory()" aria-expanded="${open}">${open ? 'Masquer la liste' : 'Voir la liste'}</button>
      </div>
      ${open ? `<div class="pv2-panel-body" data-pv2-mount="inventory">
        <table class="mail-inv-table">
          <thead><tr><th>Message</th><th>Pour qui</th><th>Quand il part</th><th>État</th><th>Pilotage</th></tr></thead>
          <tbody>${MAIL_INVENTORY.map(mailInventoryRow).join('')}</tbody>
        </table>
        <p class="mail-inv-note">Les trois mails à l'équipe ne se coupent pas depuis cette page, et c'est voulu : ils ne partent jamais à un client, et couper l'alerte d'un retard reviendrait à laisser un groupe sur le terrain sans personne pour trancher. Leur texte est écrit par le système pour tenir en trois lignes lues debout entre deux groupes.</p>
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
    const innerScrolls = [...root.querySelectorAll('.pv2-mail-list, .pv2-mail-detail, .pv2-thread-list')]
      .map((el) => ({ cls: el.className, top: el.scrollTop }))
      .filter((s) => s.top > 0);
    const paint = () => renderStaffEmailsPaint(root, errorMessage);
    if (typeof PinlaneMotion !== 'undefined' && PinlaneMotion.garderFocus) PinlaneMotion.garderFocus(paint);
    else paint();
    if (window.scrollY !== scrollY) window.scrollTo(0, scrollY);
    for (const saved of innerScrolls) {
      const fresh = root.querySelector(`.${saved.cls.split(' ')[0]}`);
      if (fresh) fresh.scrollTop = saved.top;
    }
    // La liste ouverte du sélecteur de destinataire est repeinte après le
    // rendu : le DOM neuf naît avec une liste vide et cachée, l'état, lui, vit
    // hors DOM (pv2Combo) et survit.
    if (pv2Mail.composerOpen && pv2Combo.open) pv2ComboPaint();
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

  const PV2_EMAILS_TABS = [
    { key: 'apercu', label: 'Aperçu' },
    { key: 'recus', label: 'Reçus' },
    { key: 'envoyes', label: 'Envoyés' },
    { key: 'sequences', label: 'Séquences' },
    { key: 'modeles', label: 'Modèles' },
    { key: 'apparence', label: 'Apparence' },
    { key: 'expediteurs', label: 'Expéditeurs' },
    { key: 'agent', label: 'L’agent' },
    { key: 'exclusions', label: 'Exclusions' },
    // Les campagnes exigent leur permission : sans elle, l onglet n existe pas
    // (regle DESIGN.md 9 : un bouton mene a une action reelle, ou il n existe pas).
    { key: 'campagnes', label: 'Campagnes', permission: 'campaigns.manage' },
  ];
  const PV2_SECTION_SUB = {
    apercu: 'Ce qui arrive, ce qui part, ce qui n\'est pas parti',
    recus: 'Les conversations avec vos clients, message par message',
    envoyes: 'Chaque mail parti du centre, avec son suivi',
    sequences: 'Les mails qui partent tout seuls, au bon moment',
    modeles: 'Des textes prêts à envoyer, les nôtres et les vôtres',
    apparence: 'Le gabarit et la signature de tous vos mails',
    expediteurs: 'Les adresses avec lesquelles vos mails partent',
    agent: 'Ce que l\'agent sait, et ce qu\'il vous demande',
    exclusions: 'Qui ne veut plus recevoir de marketing',
    campagnes: 'Un mail à un groupe de clients, ciblé depuis votre base',
  };

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
  // l attribut onkeydown, jamais un enfant.
  window.pv2EmailsTabKey = function (event) {
    const touches = { ArrowLeft: -1, ArrowRight: 1, Home: 'home', End: 'end' };
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
    document.querySelectorAll('#staffEmailsPage iframe[data-pv2-frame]').forEach((frame) => { frame.srcdoc = pv2HtmlSelonTheme(frame.__pv2Html || ''); });
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
  function pv2FillFrames(root) {
    root.querySelectorAll('iframe[data-pv2-frame]').forEach((frame) => {
      const html = PV2_FRAMES[frame.getAttribute('data-pv2-frame')] || '';
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
    return 'À jour';
  }
  function pv2ApercuVivantHtml(cle, { titre = 'Aperçu', tete = '', cadre = 'pv2-seq-preview-frame', classe = '' } = {}) {
    const etat = PV2_APERCU_ETAT[cle] || { etat: 'vide' };
    return `<div class="pv2-seq-preview${classe ? ` ${classe}` : ''}" data-pv2-apercu="${esc(cle)}">
      <div class="pv2-seq-preview-head">${tete || `<span>${esc(titre)}</span>`}<span class="pv2-live-state${etat.etat === 'erreur' ? ' is-error' : ''}" aria-live="polite" data-pv2-apercu-etat>${esc(pv2ApercuEtatTexte(etat))}</span>${pv2ThemeChoixHtml()}</div>
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
      if (frame && frame.__pv2Html !== (etat.html || '')) { frame.__pv2Html = etat.html || ''; frame.srcdoc = pv2HtmlSelonTheme(frame.__pv2Html); }
    });
  }

  /* ── SOUS-NAVIGATION : l indicateur glisse entre deux sections ──────────
     Meme discipline que le rail du segmente : la position precedente vit hors
     du DOM, on repose l indicateur dessus sans transition, reflow, puis il
     glisse. Un simple re-rendu (poll) ne le fait pas bouger d un pixel. ── */
  function pv2SubnavHtml(section) {
    const o = pv2Overview.data;
    const aRepondre = o && Number.isFinite(Number(o.aRepondre)) ? Number(o.aRepondre) : null;
    return `<nav class="pv2-emails-nav" aria-label="Sections de la page Emails">
      <div class="pl-subnav" role="tablist" aria-label="Sections">
        <span class="pl-subnav-indicator" aria-hidden="true"></span>
        ${PV2_EMAILS_TABS.filter((t) => pv2PeutVoirSection(t.key)).map((t) => {
          const active = t.key === section;
          const badge = t.key === 'recus' && aRepondre ? `<span class="pl-subnav-badge" aria-label="${aRepondre} à répondre">${aRepondre}</span>` : '';
          return `<button type="button" class="pl-subnav-item${active ? ' is-active' : ''}" role="tab" id="pv2EmailsTab-${t.key}" aria-selected="${active}" aria-controls="pv2EmailsPanel" tabindex="${active ? '0' : '-1'}" data-section="${t.key}" data-pl-focus="emails.subnav.${t.key}" onclick="pv2EmailsGo('${t.key}')" onkeydown="pv2EmailsTabKey(event)">${esc(t.label)}${badge}</button>`;
        }).join('')}
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
    const place = (p) => { nav.style.setProperty('--pl-subnav-x', `${p.x}px`); nav.style.setProperty('--pl-subnav-k', String(p.w / 100)); };
    // Noeud detache ou page cachee : aucune geometrie lisible, on repose la
    // derniere connue et on ne touche pas a la memoire.
    if (!document.contains(nav) || !active.offsetWidth) {
      if (from) { ind.style.transition = 'none'; place(from); void ind.offsetWidth; ind.style.transition = ''; }
      ind.setAttribute('data-moved', '0');
      return;
    }
    const to = { key: active.getAttribute('data-section'), x: active.offsetLeft, w: active.offsetWidth };
    const moved = !instant && !!(from && from.key && from.key !== to.key) && !reducedMotion;
    ind.style.transition = 'none';
    place(moved ? from : to);
    void ind.offsetWidth;
    ind.style.transition = '';
    if (moved) place(to);
    PV2_EMAILS_MOTION.subnav = to;
    ind.setAttribute('data-moved', moved ? '1' : '0');
    // Sous 768 px la barre defile : l onglet actif se centre dans la fenetre.
    if (nav.scrollWidth > nav.clientWidth + 2) {
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
  function pv2ThreadApresOuverture(d) {
    const fil = d.thread;
    if (!fil) return;
    const moi = pv2MonIdentifiant();
    const cle = String(fil.id);
    const nonLus = d.messages.filter((m) => m.direction === 'inbound' && m.id && !(Array.isArray(m.lectures) && moi && m.lectures.some((l) => String(l.memberId) === moi)));
    if (nonLus.length && !pv2Threads.marquesLus.has(cle)) {
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
      pv2Design.center = payload && payload.center && typeof payload.center === 'object' ? payload.center : null;
      pv2Design.logos = Array.isArray(payload && payload.logos) ? payload.logos : [];
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
    { id: 'simple', label: 'Mail simple', description: 'Comme un mail écrit à la main : pas de titre ni de cadre, le texte puis la signature.' },
    { id: 'classique', label: 'Classique', description: 'Carte blanche à filet fin sur fond gris, nom du centre en tête.' },
    { id: 'epure', label: 'Épuré', description: 'Pas de carte : fond blanc, grandes marges, un filet fin sous le titre.' },
    { id: 'carte', label: 'Carte', description: 'La carte classique avec une barre de couleur en haut.' },
    { id: 'contraste', label: 'Contraste', description: 'Bandeau d\'en-tête sombre avec le nom ou le logo blanc du centre.' },
  ];

  // Le modele §4.1 complet : un design venu du serveur peut etre partiel
  // (ancien enregistrement), un formulaire n a pas le droit de lire undefined.
  function pv2DesignVide() {
    return {
      preset: 'classique',
      accent: { mode: 'encre', hex: '' },
      header: { mode: 'nom', logoUrl: '', logoWidth: 140 },
      footer: { adresse: true, telephone: true, email: true, mention: '' },
      signature: {
        enabled: true, closing: 'À très bientôt,', teamLabel: '', role: '', phone: '', email: '', website: '', address: '',
        logoUrl: '', logoWidth: 120, socials: { facebook: '', instagram: '', tiktok: '', linkedin: '' }, layout: 'carte',
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
      signature: { ...objet(base.signature, s.signature), socials: objet(base.signature.socials, s.signature && s.signature.socials) },
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
  window.pv2DesignSample = function (key) {
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
    toast('Défauts rétablis : enregistrez pour les appliquer.');
  };
  window.pv2DesignSave = async function () {
    if (pv2Design.busy || !pv2Design.design) return;
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
    pv2Design.busy = 'test';
    renderStaffEmailsPage();
    try {
      // Aucune adresse n est envoyee : le serveur envoie au membre connecte.
      const payload = await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'sendDesignTest', centerId: pv2CentreCourant(), design: pv2Design.design, sample: pv2Design.sample }),
      });
      if (payload.status === 'sent') toast(`Test envoyé à ${payload.recipient}`);
      else toast(`Le test n'est pas parti : ${payload.error || 'cause inconnue'}`);
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
  function pv2TuileHtml({ label, value, foot, go, danger = false }) {
    const n = pv2Nombre(value);
    const cle = `stat.${String(label).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
    return `<button type="button" class="pv2-stat${danger && n > 0 ? ' is-danger' : ''}" onclick="${go}">
      <div class="pv2-stat-label"><span>${esc(label)}</span></div>
      <div class="pv2-stat-value">${n === null
        ? '<span class="pv2-stat-value is-empty">indisponible</span>'
        : `<span ${PV2.lastPage !== 'emails' ? `data-pv2-count="${n}"` : ''} data-pl-num="${cle}">${n.toLocaleString('fr-BE')}</span>`}</div>
      <div class="pv2-stat-foot">${esc(foot || '')}</div>
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
        <strong>Remise (accusés du fournisseur)</strong>
        <span class="pv2-suivi-etat${evenements ? ' is-on' : ''}">${evenements === null ? 'indisponible' : evenements ? `actif${remis7 !== null ? ` · ${remis7} remis sur 7 j` : ''}` : 'aucun événement reçu sur 30 j'}</span>
        ${evenements === false ? '<small>Le fournisseur n\'a envoyé aucun accusé de remise pour ce centre : les mails se lisent « en attente d\'événement ».</small>' : ''}
      </div>
      <div class="pv2-suivi-ligne">
        <strong>Ouvertures par le client</strong>
        <span class="pv2-suivi-etat${ouvertures ? ' is-on' : ''}">${ouvertures === null ? 'indisponible' : ouvertures ? `observées${ouverts7 !== null ? ` · ${ouverts7} sur 7 j` : ''}` : 'jamais observées'}</span>
        ${ouvertures === false ? '<small>Le suivi d\'ouverture se règle sur le domaine d\'envoi chez le fournisseur (ligne DNS chez l\'hébergeur du client). Tant qu\'il est inactif, aucune ouverture ne remonte.</small>' : ''}
      </div>
      <div class="pv2-suivi-ligne">
        <strong>Lu par l'équipe</strong>
        <span class="pv2-suivi-etat is-on">toujours actif</span>
        <small>Suivi dans Pinlane : qui a ouvert chaque mail reçu, et quand.</small>
      </div>
    </div>`;
  }

  function pv2SeqMiniHtml() {
    if (!mkAuto.loaded && !mkAuto.error) return `<div class="pv2-empty" aria-live="polite" aria-busy="true">${typeof renderThinking === 'function' ? renderThinking('searching') : '<strong>Chargement…</strong>'}</div>`;
    if (mkAuto.error) return `<div class="pv2-empty"><strong>${esc(mkAuto.error)}</strong></div>`;
    const NB = ' ';
    const items = AUTOMATION_META.map((meta) => {
      const setting = mkAuto.settings ? mkAuto.settings[meta.key] : null;
      const enabled = !!(setting && setting.enabled);
      const stats = mkAuto.stats[meta.key] || {};
      const sent30 = Number(stats.sent30d) || 0;
      const failed30 = Number(stats.failed30d) || 0;
      return `<div class="pv2-seq-mini-item${enabled ? ' is-on' : ''}">
        <strong>${esc(meta.label)}</strong>
        <span>${sent30}${NB}envoyé${sent30 > 1 ? 's' : ''}${failed30 ? ` · ${failed30}${NB}échec${failed30 > 1 ? 's' : ''}` : ''} · 30${NB}j</span>
        <button type="button" class="mk-switch${enabled ? ' is-on' : ''}" data-switch-key="auto:${esc(meta.key)}" role="switch" aria-checked="${enabled}" aria-label="${esc(meta.label)}" onclick="toggleStaffAutomation('${meta.key}')" ${mkAuto.busyKey === meta.key || !mkAuto.settings ? 'disabled' : ''}><span></span></button>
      </div>`;
    });
    pv2Seq.sequences.forEach((sequence) => {
      const stats = pv2SeqStats30j(sequence);
      const sent30 = stats ? Number(stats.sent30d) || 0 : null;
      items.push(`<div class="pv2-seq-mini-item${sequence.enabled ? ' is-on' : ''}">
        <strong>${esc(sequence.name)}</strong>
        <span>${sent30 === null ? 'perso · envois non comptés' : `${sent30}${NB}envoyé${sent30 > 1 ? 's' : ''} · 30${NB}j · perso`}</span>
        <button type="button" class="mk-switch${sequence.enabled ? ' is-on' : ''}" data-switch-key="seq:${esc(String(sequence.id))}" role="switch" aria-checked="${sequence.enabled}" aria-label="${esc(sequence.name)}" onclick="pv2SeqToggle('${escJs(sequence.id)}', ${sequence.enabled ? 'false' : 'true'})" ${pv2Seq.busy ? 'disabled' : ''}><span></span></button>
      </div>`);
    });
    return `<div class="pv2-seq-mini">${items.join('')}</div>`;
  }

  function pv2EmailsSectionApercu() {
    const o = pv2Overview.data;
    const rows = getStaffEmailRows().filter((r) => !pv2IsInbound(r));
    const metrics = getStaffEmailMetrics(rows);
    const plusAncienne = o && o.plusAncienneAttenteAt ? pv2Depuis(o.plusAncienneAttenteAt) : '';
    const evenements = o && o.suivi ? Boolean(o.suivi.evenementsRecus30j) : false;
    const remis7 = o ? pv2Nombre(o.remis7j) : null;
    const enAttente = o ? pv2Nombre(o.enAttente) : null;
    const apercu = pv2Threads.apercu;
    const convos = apercu.threads.slice(0, 5);
    return `${pv2AlerteEchecsHtml(rows, metrics)}
      <section class="pv2-stats" aria-label="Les chiffres du jour">
        ${pv2TuileHtml({ label: 'À répondre', value: o ? o.aRepondre : null, foot: plusAncienne ? `la plus ancienne attend depuis ${plusAncienne}` : (o && Number(o.aRepondre) === 0 ? 'aucune conversation en attente' : ''), go: "pv2ThreadsFilter('a-repondre'); pv2EmailsGo('recus')" })}
        ${pv2TuileHtml({ label: 'Envoyés sur 7 jours', value: o ? o.envoyes7j : null, foot: evenements && remis7 !== null ? `remis : ${remis7}` : 'remise : aucun événement reçu', go: "pv2EmailFilter('sent')" })}
        ${pv2TuileHtml({ label: 'Échecs sur 7 jours', value: o ? o.echecs7j : null, foot: o && Number(o.echecs7j) > 0 ? 'à corriger dans Envoyés' : 'aucun échec récent', go: "pv2EmailFilter('failed')", danger: true })}
        ${pv2TuileHtml({ label: 'Programmés sur 24 h', value: o ? o.programmes24h : null, foot: enAttente !== null ? `${enAttente} en attente au total` : '', go: "pv2EmailFilter('queued')" })}
      </section>
      <div class="pv2-overview-grid">
        <div class="pv2-overview-col">
          <section class="pv2-panel" aria-label="Conversations à répondre">
            <div class="pv2-panel-head pv2-list-head">
              <h2>Conversations à répondre</h2>
              <button type="button" class="pv2-btn sm ghost" onclick="pv2EmailsGo('recus')">Toutes les conversations</button>
            </div>
            <div class="pv2-panel-body is-flush">
              ${!apercu.loaded
                ? `<div class="pv2-empty" aria-live="polite" aria-busy="true">${typeof renderThinking === 'function' ? renderThinking('searching') : '<strong>Chargement…</strong>'}</div>`
                : convos.length
                  ? `<div class="pv2-convo-mini">${convos.map((t) => pv2ThreadRowHtml(t, { compact: true })).join('')}</div>`
                  : '<div class="pv2-empty"><strong>Rien à répondre</strong>Chaque conversation reçue a sa réponse.</div>'}
            </div>
          </section>
          ${pv2SectionApprentissage({ apercu: true })}
        </div>
        <div class="pv2-overview-col">
          <section class="pv2-panel" aria-label="Suivi des envois">
            <div class="pv2-panel-head"><h2>Suivi des envois</h2></div>
            <div class="pv2-panel-body">${pv2SuiviHtml(o)}</div>
          </section>
          <section class="pv2-panel" aria-label="Séquences">
            <div class="pv2-panel-head pv2-list-head">
              <h2>Séquences</h2>
              <button type="button" class="pv2-btn sm ghost" onclick="pv2EmailsGo('sequences')">Gérer</button>
            </div>
            <div class="pv2-panel-body">${pv2SeqMiniHtml()}</div>
          </section>
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
          ${topFailure ? `<p class="pv2-alert-cause"><b>${esc(topFailure.label)}</b>${failureGroups.length > 1 ? ` (${topFailure.count} sur ${metrics.failed})` : ''} : ${esc(topFailure.fix)}</p>` : ''}
          ${failureGroups.length > 1 ? `<p class="pv2-alert-other">Autres causes : ${failureGroups.slice(1).map((g) => `${esc(g.label)} (${g.count})`).join(' · ')}</p>` : ''}
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

  function pv2ThreadRowHtml(t, { compact = false } = {}) {
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
    if (unread) chips.push('<span class="pv2-chip is-new">Nouveau</span>');
    else if (t.status === 'open') chips.push(`<span class="pv2-chip is-opened">Ouvert par ${esc(pv2NomsLecteurs(lecteurs))}</span>`);
    if (priseAutre) chips.push(`<span class="pv2-chip amber">${esc(String(priseAutre.memberName || 'Un collègue'))} répond…</span>`);
    if (!compact && pv2Threads.filtre !== 'a-repondre') chips.push(`<span class="pv2-chip ${statusTone}">${statusLabel}${t.status === 'answered' && t.reponduPar && t.reponduPar.memberName ? ` par ${esc(t.reponduPar.memberName)}` : ''}</span>`);
    else if (t.status === 'answered' && t.reponduPar && t.reponduPar.memberName) chips.push(`<span class="pv2-chip green">Répondu par ${esc(t.reponduPar.memberName)}</span>`);
    if (Number(t.messageCount) > 1) chips.push(`<span class="pv2-chip is-count">${Number(t.messageCount)} messages</span>`);
    if (t.intention) chips.push(`<span class="pv2-inbox-intent">${esc(PV2_INTENT_LABELS[t.intention] || t.intention)}</span>`);
    if (t.question) chips.push('<span class="pv2-inbox-urgent">Question</span>');
    return `<button type="button" class="pv2-thread-row${selected ? ' is-selected' : ''}${unread ? ' is-unread' : ''}" data-thread-id="${esc(String(t.id))}" aria-current="${selected ? 'true' : 'false'}" onclick="pv2ThreadOpen('${escJs(String(t.id))}')">
      <span class="pv2-thread-avatar" aria-hidden="true">${esc(pv2InitialeDe(t.contactName, t.contactEmail))}</span>
      <span class="pv2-thread-main">
        <span class="pv2-thread-line"><strong>${esc(nom)}</strong><span class="pv2-thread-when">${esc(pv2Relatif(t.lastMessageAt))}</span></span>
        <span class="pv2-thread-subject">${esc(t.subject || '(sans objet)')}</span>
        ${compact ? '' : `<span class="pv2-thread-snippet">${esc(t.snippet || '')}</span>`}
        ${chips.length ? `<span class="pv2-thread-chips">${chips.join('')}</span>` : ''}
      </span>
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
      items.push(`<span class="is-done">Répondu par ${esc(par)} <time>${esc(pv2Quand(reponse.sentAt || reponse.createdAt))}</time></span>`);
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
    else items.push({ cls: 'is-off', label: 'Remise : en attente d\'événement', when: '' });
    const ouvertures = pv2OuverturesObservees();
    if (s.openedAt || Number(s.openCount) > 0) items.push({ cls: 'is-done', label: `Ouvert${Number(s.openCount) > 1 ? ` (${Number(s.openCount)}×)` : ''}`, when: s.openedAt ? pv2Quand(s.openedAt) : '' });
    else if (ouvertures === false) items.push({ cls: 'is-off', label: 'Ouverture : suivi inactif sur ce domaine', when: '' });
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

  function pv2ThreadMessageHtml(m, messages, fil, contact) {
    const inbound = m.direction === 'inbound';
    const uid = `msg:${m.id}`;
    const nom = inbound
      ? String(m.fromLabel || (contact && contact.name) || m.fromEmail || (contact && contact.email) || 'Expéditeur inconnu')
      : String((m.sentBy && m.sentBy.memberName) || (m.origine === 'auto' ? (m.sequenceLabel || 'Séquence') : m.fromLabel || 'Le centre'));
    // Un mail du formulaire du site montre le client, puis par quelle adresse
    // il est arrive (2026-09-17).
    const adresse = inbound
      ? `${String(m.fromEmail || (contact && contact.email) || '')}${m.via ? ` · via le formulaire (${m.via})` : ''}`
      : (m.recipient ? `à ${m.recipient}` : '');
    const voie = inbound ? 'Reçu' : (m.origine === 'auto' ? `Envoyé · ${m.sequenceLabel || 'automatique'}` : `Envoyé · ${PV2_ORIGINE_LABELS[m.origine] || 'manuel'}`);
    const quand = pv2Quand(inbound ? (m.receivedAt || m.createdAt) : (m.sentAt || m.createdAt));
    const analysis = inbound && m.analysis && typeof m.analysis === 'object' ? m.analysis : null;
    const intentLabel = analysis ? (analysis.intentLabel || PV2_INTENT_LABELS[analysis.intent] || analysis.intent) : '';
    const questions = (typeof opsAdminCache === 'object' && opsAdminCache && opsAdminCache.questions) || [];
    const question = inbound ? questions.find((q) => Number(q.communicationId) === Number(m.id)) : null;
    const trace = inbound ? pv2TraceEntrantHtml(m, messages, fil) : pv2TraceSortantHtml(m);
    let corps;
    if (inbound || m.textBody || m.message) {
      corps = pv2CorpsMail({ uid, payload: { textBody: String(m.textBody || m.message || '') }, body: '', subject: m.subject || '' });
    } else if (m.body) {
      corps = `<div class="pv2-thread-outbound-html">${pv2FrameHtml(uid, m.body, 'pv2-mail-frame', 'Mail tel qu\'envoyé')}</div>`;
    } else {
      corps = '<div class="pv2-mail-corps"><p class="pv2-mail-vide">Ce message n a pas de contenu.</p></div>';
    }
    return `<article class="pl-timeline-msg${inbound ? ' is-inbound' : ' is-outbound'}" data-message-id="${esc(String(m.id))}">
      <div class="pv2-mail-entete">
        <div class="pv2-mail-pastille${inbound ? '' : ' is-nous'}" aria-hidden="true">${esc(pv2InitialeDe(nom, adresse))}</div>
        <div class="pv2-mail-identite">
          <div class="pv2-mail-ligne">
            <strong>${esc(nom)}</strong>
            <span class="pv2-mail-voie">${esc(voie)}</span>
            <span class="pv2-mail-quand">${esc(quand)}</span>
          </div>
          ${adresse ? `<div class="pv2-mail-adresse">${esc(adresse)}</div>` : ''}
        </div>
      </div>
      ${corps}
      ${!inbound && m.body && (m.textBody || m.message) ? `<button type="button" class="pv2-link-btn" onclick="pv2ThreadVoirMail('${escJs(String(m.id))}')">Voir le mail tel qu'envoyé</button>` : ''}
      ${analysis ? `
      <div class="pv2-inbox-analysis pv2-thread-analyse">
        <div class="pv2-mail-preview-title">Ce que l'agent a compris</div>
        <div class="pv2-inbox-summary">
          <span class="pv2-inbox-intent">${esc(intentLabel)}</span>
          ${analysis.urgency === 'haute' ? '<span class="pv2-inbox-urgent">Urgent</span>' : ''}
          <p>${esc(analysis.summary || '')}</p>
        </div>
      </div>` : ''}
      <div class="pl-timeline-trace" aria-label="Parcours du message">
        ${trace.join('')}
        ${question ? `<p class="pv2-thread-question"><b>L'agent ne sait pas :</b> ${esc(question.question)} <button type="button" class="pv2-link-btn" onclick="pv2EmailsGo('agent')">Lui répondre</button></p>` : ''}
        ${pv2EvenementsHtml(m)}
      </div>
    </article>`;
  }

  function pv2ThreadReplyHtml(fil, contact, messages) {
    const cle = String(fil.id);
    const r = pv2ThreadReplyDraft(cle);
    const maySend = typeof canUseStaffPermission !== 'function' || canUseStaffPermission('emails.send');
    const busy = pv2Threads.replyBusy === cle;
    const entrant = pv2ThreadDernierEntrant(messages);
    const proposition = entrant && entrant.analysis && entrant.analysis.reply && (entrant.analysis.reply.body || entrant.analysis.reply.subject);
    const identityOptions = pv2Mail.identities.length
      ? pv2Mail.identities.map((i) => `<option value="${esc(String(i.id))}"${String(i.id) === String(r.identityId) ? ' selected' : ''}>${esc(i.label || i.email)}, ${esc(i.email)}</option>`).join('')
      : `<option value="">${pv2Mail.metaLoading ? 'Chargement des adresses…' : 'Expéditeur par défaut'}</option>`;
    const nom = String((contact && contact.name) || fil.contactName || (contact && contact.email) || fil.contactEmail || 'ce client');
    return `<section class="pv2-thread-reply" data-pv2-mount="threadReply" aria-label="Répondre">
      <div class="pv2-thread-reply-head">
        <h3>Répondre à ${esc(nom)}</h3>
        <div class="pv2-thread-actions">
          ${proposition ? `<button type="button" class="pv2-btn sm" onclick="pv2ThreadUtiliserProposition('${escJs(cle)}')">${ci('sparkles')}Utiliser la réponse proposée</button>` : ''}
          ${entrant ? `<button type="button" class="pv2-btn sm ghost" onclick="pv2InboxReanalyze('${escJs(cle)}')" ${busy ? 'disabled' : ''}>${ci('refresh')}Ré-analyser</button>` : ''}
        </div>
      </div>
      ${pv2BandeauPriseHtml(pv2PriseDunAutreSurLeFil(entrant, fil))}
      <div class="pv2-thread-reply-grid">
        <label class="pv2-composer-field"><span>Expéditeur</span>
          <select onchange="pv2InboxReplyField('${escJs(cle)}', 'identityId', this.value)" aria-label="Adresse d'envoi">${identityOptions}</select>
        </label>
        <label class="pv2-composer-field"><span>Objet</span>
          <input class="pv2-inbox-reply-subject" data-pl-focus="emails.reponse.objet" value="${esc(r.subject)}" aria-label="Objet de la réponse" oninput="pv2InboxReplyField('${escJs(cle)}', 'subject', this.value)">
        </label>
      </div>
      <div class="pv2-composer-field"><span>Réponse</span>
        ${pv2TokeditHtml({ id: 'pv2ThreadReplyBody', sink: 'threadReplyBody', value: r.body, plFocus: 'emails.reponse.message', placeholder: 'Bonjour…', classe: 'pv2-inbox-reply-body' })}
      </div>
      <div class="pv2-thread-reply-sign${r.signature ? '' : ' is-off'}">
        <label class="pv2-check"><input type="checkbox" ${r.signature ? 'checked' : ''} onchange="pv2InboxReplyField('${escJs(cle)}', 'signature', this.checked)"> Ajouter la signature du centre</label>
        <input value="${esc(r.signatoryName)}" placeholder="Votre nom" aria-label="Nom du signataire" data-pl-focus="emails.reponse.signataire" oninput="pv2InboxReplyField('${escJs(cle)}', 'signatoryName', this.value)" ${r.signature ? '' : 'disabled'}>
        <input value="${esc(r.signatoryRole)}" placeholder="Votre rôle" aria-label="Rôle du signataire" data-pl-focus="emails.reponse.role" oninput="pv2InboxReplyField('${escJs(cle)}', 'signatoryRole', this.value)" ${r.signature ? '' : 'disabled'}>
      </div>
      <div class="pv2-composer-actions">
        <button type="button" class="pv2-btn" onclick="pv2ThreadReplyPreview('${escJs(cle)}')">Voir le mail final</button>
        <span class="pv2-composer-spacer"></span>
        ${maySend
          ? `<button type="button" class="pv2-btn primary" onclick="pv2InboxReply('${escJs(cle)}')" ${busy ? 'disabled' : ''}>${ci('send')}${busy ? 'Envoi…' : 'Envoyer'}</button>`
          : '<p class="pv2-thread-reply-locked">Votre rôle ne permet pas d\'envoyer des mails.</p>'}
      </div>
    </section>`;
  }

  function pv2ThreadDetailHtml() {
    const d = pv2Threads.detail;
    if (!pv2Threads.selectedId) {
      return '<div class="pv2-thread-empty"><strong>Choisissez une conversation</strong><span>Elle s\'affiche ici, message par message, avec qui l\'a lue et qui a répondu.</span></div>';
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
    return `<div class="pv2-thread-detail pv2-mail-detail">
      <div class="pv2-thread-head">
        <div class="pv2-thread-title">
          <strong class="pv2-thread-subject">${esc(fil.subject || '(sans objet)')}</strong>
          <small class="pv2-thread-with">Conversation avec <b>${esc(nom)}</b>${email && email !== nom ? ` · ${esc(email)}` : ''}</small>
          ${origineTete ? `<small class="pv2-thread-origine">${esc(origineTete)}</small>` : ''}
        </div>
        <div class="pv2-thread-actions">
          <span class="pv2-chip ${statusTone}">${statusLabel}</span>
          ${maySend ? (fil.status === 'closed'
            ? `<button type="button" class="pv2-btn sm" onclick="pv2ThreadSetStatus('${escJs(String(fil.id))}', 'open')" ${busyStatut ? 'disabled' : ''}>Rouvrir</button>`
            : `<button type="button" class="pv2-btn sm" onclick="pv2ThreadSetStatus('${escJs(String(fil.id))}', 'closed')" ${busyStatut ? 'disabled' : ''}>Terminer</button>`) : ''}
          ${email ? `<button type="button" class="pv2-btn sm ghost" onclick="pv2ThreadVoirClient('${escJs(email)}')">Client</button>` : ''}
        </div>
        ${autres.length ? `<details class="pv2-thread-others">
          <summary>${ci('chevronDown')}Autres conversations (${autres.length})</summary>
          <div class="pv2-thread-others-list">${autres.map((a) => `<button type="button" onclick="pv2ThreadOpen('${escJs(String(a.id))}')"><span>${esc(a.subject || '(sans objet)')}</span><small>${esc((PV2_THREAD_STATUS[a.status] || PV2_THREAD_STATUS.open)[0])}</small><small>${esc(pv2Relatif(a.lastMessageAt))}</small></button>`).join('')}</div>
        </details>` : ''}
      </div>
      <div class="pl-timeline">
        ${messages.length ? messages.map((m) => pv2ThreadMessageHtml(m, messages, fil, contact)).join('') : '<div class="pv2-thread-empty"><strong>Aucun message</strong></div>'}
      </div>
      ${pv2ThreadReplyHtml(fil, contact, messages)}
    </div>`;
  }

  function pv2EmailsSectionRecus() {
    const o = pv2Overview.data;
    const aRepondre = o && Number.isFinite(Number(o.aRepondre)) ? Number(o.aRepondre) : undefined;
    const filtres = [
      { key: 'a-repondre', label: 'À répondre', count: aRepondre },
      { key: 'repondus', label: 'Répondus' },
      { key: 'termines', label: 'Terminés' },
      { key: 'tous', label: 'Tous' },
    ].map((f) => ({ ...f, active: pv2Threads.filtre === f.key }));
    const liste = pv2Threads.error
      ? `<div class="pv2-thread-empty"><strong>${esc(pv2Threads.error)}</strong><button type="button" class="pv2-btn sm" onclick="loadPv2Threads(true)">Réessayer</button></div>`
      : !pv2Threads.loaded
        ? `<div class="pv2-thread-empty" aria-live="polite" aria-busy="true">${typeof renderThinking === 'function' ? renderThinking('searching') : '<strong>Chargement…</strong>'}</div>`
        : pv2Threads.threads.length
          ? pv2Threads.threads.map((t) => pv2ThreadRowHtml(t)).join('')
          : `<div class="pv2-thread-empty"><strong>${pv2Threads.q ? 'Aucune conversation ne correspond' : { 'a-repondre': 'Rien à répondre', repondus: 'Aucune conversation répondue', termines: 'Aucune conversation terminée', tous: 'Aucune conversation' }[pv2Threads.filtre]}</strong><span>${pv2Threads.q ? 'Essayez un autre nom ou une autre adresse.' : 'Collez un mail avec « Coller un mail reçu » : l\'agent prépare la réponse.'}</span></div>`;
    const reste = pv2Threads.loaded && pv2Threads.total > pv2Threads.threads.length ? pv2Threads.total - pv2Threads.threads.length : 0;
    return `<section class="pv2-thread-split">
      <article class="pv2-panel pv2-thread-panel">
        <div class="pv2-thread-tools">
          ${seg(filtres, 'pv2ThreadsFilter')}
          <label class="pv2-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="14" height="14"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg><input data-pl-focus="emails.recus.recherche" value="${esc(pv2Threads.q || '')}" placeholder="Client, adresse, objet…" aria-label="Rechercher une conversation" oninput="pv2ThreadsSearch(this.value)"></label>
        </div>
        <div class="pv2-thread-list" aria-live="polite" aria-busy="${pv2Threads.loading ? 'true' : 'false'}">${liste}</div>
        ${reste ? `<p class="pv2-note" style="padding:10px 14px;border-top:1px solid var(--line)">${reste} autre${reste > 1 ? 's' : ''} conversation${reste > 1 ? 's' : ''} : affinez la recherche pour les voir.</p>` : ''}
      </article>
      <article class="pv2-panel">${pv2ThreadDetailHtml()}</article>
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

  // Le mini-parcours a quatre points : plein = fait, vide = pas encore,
  // tiret = suivi inactif, rouge = echec.
  function pv2JourneyHtml(row) {
    const echec = row.statusKind === 'failed';
    const envoye = row.statusKind === 'sent' || pv2SentRemis(row) || pv2SentOuvert(row);
    const remis = pv2SentRemis(row);
    const ouvert = pv2SentOuvert(row);
    const clique = pv2SentClique(row);
    const ouvertures = pv2OuverturesObservees();
    const dot = (etat) => `<span class="pl-journey-dot ${etat}" aria-hidden="true"></span>`;
    const titre = [
      echec ? 'Échec' : envoye ? 'Envoyé' : 'Pas encore envoyé',
      remis ? 'Remis' : 'Remise : aucun événement',
      ouvert ? 'Ouvert' : ouvertures === false ? 'Ouverture : suivi inactif' : 'Pas encore ouvert',
      clique ? 'Cliqué' : 'Pas de clic',
    ].join(' · ');
    return `<span class="pl-journey" role="img" aria-label="${esc(titre)}" title="${esc(titre)}">
      ${dot(echec ? 'is-fail' : envoye ? 'is-done' : '')}${dot(remis ? 'is-done' : '')}${dot(ouvert ? 'is-done' : ouvertures === false ? 'is-off' : '')}${dot(clique ? 'is-done' : '')}
    </span>`;
  }

  function pv2SentDetailHtml(selected, KIND_META) {
    if (!selected) return '<div class="pv2-empty"><strong>Aucun message</strong>Sélectionnez une communication.</div>';
    const payload = selected.payload || {};
    const origine = pv2SentOrigin(selected);
    const sentBy = payload.sentBy && typeof payload.sentBy === 'object' ? payload.sentBy : null;
    const origineTxt = origine === 'auto'
      ? `Automatique · ${selected.templateLabel || selected.templateId || 'séquence'}`
      : `${PV2_ORIGINE_LABELS[origine]}${sentBy && sentBy.memberName ? ` · ${sentBy.memberName}` : (payload.staffMember ? ` · ${payload.staffMember}` : '')}`;
    // « Voir la conversation » : seulement si le client a repondu apres cet
    // envoi. Un fil qui n a que ce mail n apporterait rien de plus.
    const reponse = selected.threadId
      ? getStaffEmailRows().find((r) => pv2IsInbound(r) && Number(r.threadId) === Number(selected.threadId) && new Date(r.createdAt || r.receivedAt || 0).getTime() > new Date(selected.sentAt || selected.createdAt || 0).getTime())
      : null;
    const traceVertical = pv2TraceSortantVerticalHtml({
      status: selected.status, sentAt: selected.sentAt, createdAt: selected.createdAt, scheduledAt: selected.scheduledAt, errorReason: selected.lastError,
      suivi: { deliveredAt: selected.deliveredAt, openedAt: selected.openedAt, openCount: selected.openCount, clickedAt: selected.clickedAt, clickCount: selected.clickCount, bouncedAt: selected.bouncedAt, complainedAt: selected.complainedAt, lastError: selected.lastError },
    });
    return `<div class="pv2-panel-body pv2-mail-detail pv2-sent-detail">
        <div class="pv2-kv">
          <div><dt>Destinataire</dt><dd>${esc(selected.recipient || '-')}</dd></div>
          <div><dt>Origine</dt><dd>${esc(origineTxt)}</dd></div>
          <div><dt>Modèle</dt><dd>${esc(selected.templateLabel || selected.templateId || '-')}</dd></div>
          <div><dt>Canal</dt><dd>${esc({ email: 'Email', sms: 'SMS', whatsapp: 'WhatsApp' }[selected.channel] || selected.channel || 'Email')}</dd></div>
          <div><dt>Statut</dt><dd>${esc((KIND_META[selected.statusKind] || {}).label || selected.status || '-')}</dd></div>
          <div><dt>Programmé</dt><dd>${esc(formatOpsTimestamp(selected.scheduledAt) || '-')}</dd></div>
          ${selected.sentAt ? `<div><dt>Envoyé</dt><dd>${esc(formatOpsTimestamp(selected.sentAt))}</dd></div>` : ''}
          ${selected.attempts ? `<div><dt>Tentatives</dt><dd>${Number(selected.attempts)}</dd></div>` : ''}
        </div>
        <div>
          <div class="pv2-mail-preview-title">Parcours</div>
          <div class="pv2-sent-trace">${traceVertical}</div>
        </div>
        ${reponse ? `<div class="pv2-sent-actions"><button type="button" class="pv2-btn sm" onclick="pv2ThreadOpen('${escJs(String(selected.threadId))}')">${ci('message')}Voir la conversation : le client a répondu</button></div>` : ''}
        ${selected.statusKind === 'failed' ? (() => {
          const failure = getStaffEmailFailureReason(selected);
          // Le renvoi n'est proposé que si le mail garde un sens aujourd'hui :
          // remettre en file la confirmation d'une réservation passée enverrait
          // au client un message absurde. Au-delà de 7 jours, on explique
          // pourquoi le bouton n'est pas là plutôt que de le griser sans mot.
          const ageDays = (Date.now() - new Date(selected.createdAt || selected.scheduledAt || Date.now()).getTime()) / 86400000;
          const retryable = ageDays <= 7;
          return `<div class="pv2-mail-error">
            <strong>${esc(failure.label)}</strong>
            <p>${esc(failure.fix)}</p>
            ${failure.raw ? `<details class="pv2-mail-error-raw"><summary>Message technique</summary><code>${esc(failure.raw)}</code></details>` : ''}
            <div class="pv2-mail-error-actions">
              ${retryable
                ? `<button type="button" class="pv2-btn sm" onclick="pv2RetryEmail('${escJs(String(selected.id || ''))}')" ${pv2Mail.retryingId === String(selected.id) ? 'disabled' : ''}>${pv2Mail.retryingId === String(selected.id) ? 'Renvoi…' : 'Renvoyer ce mail'}</button>`
                : `<small>Ce message date de plus de 7 jours : le renvoyer maintenant n\'aurait plus de sens pour le client.</small>`}
            </div>
          </div>`;
        })() : ''}
        <div>
          <div class="pv2-mail-preview-head">
            <span class="pv2-mail-preview-title">Le mail</span>
            ${selected.body ? `<button type="button" class="pv2-btn sm ghost" onclick="pv2ViewStoredMail('${escJs(selected.uid)}')">Plein écran</button>` : ''}
          </div>
          ${selected.body
            ? pv2FrameHtml(`sent:${selected.uid}`, selected.body, 'pv2-mail-frame', 'Mail tel qu\'envoyé')
            : `<div class="pv2-mail-render pv2-mail-render-detail">${pv2RenderEmailPreview(String(payload.textBody || selected.subject || 'Pas de contenu texte.'), null) || '<p class="pv2-preview-empty">Pas de contenu texte.</p>'}</div>`}
        </div>
      </div>`;
  }

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

    /* « En file » était BLEU, c'est-à-dire de la couleur réservée à
       l'information, alors qu'un mail programmé pas encore parti est un état
       d'ATTENTE : sa couleur est l'ambre. */
    const KIND_META = {
      queued: { label: 'En attente', tone: 'amber' },
      sent: { label: 'Envoyé', tone: 'green' },
      failed: { label: 'Échec', tone: 'red' },
      draft: { label: 'Brouillon', tone: '' },
      cancelled: { label: 'Annulé', tone: '' },
    };

    /* Les segments sont des FILTRES : chiffre puis libellé sur une ligne,
       <button> pour le clavier. ACCORDS : le libellé s'accorde au compteur, et
       « Tout », invariable, s'écrit « Tout (3) ». */
    const pipe = (key, one, many, value, hint, opts = {}) => {
      const n = Number(value) || 0;
      const label = esc(n > 1 ? many : one);
      const valueHtml = opts.paren
        ? `<span class="pv2-pipe-value">(${n})</span>`
        : `<span class="pv2-pipe-value" ${PV2.lastPage !== 'emails' ? `data-pv2-count="${n}"` : ''}>${n}</span>`;
      return `<button type="button" class="pv2-pipe ${filter === key ? 'active' : ''}" data-pipe="${key}" onclick="pv2EmailFilter('${key}')" aria-pressed="${filter === key}">
      ${opts.paren ? `<span class="pv2-pipe-label">${label}</span>${valueHtml}` : `${valueHtml}<span class="pv2-pipe-label">${label}</span>`}
      ${hint ? `<span class="pv2-pipe-hint">${esc(hint)}</span>` : ''}
    </button>`;
    };

    const tableRows = rows.slice(0, 80).map((row) => {
      const meta = KIND_META[row.statusKind] || KIND_META.draft;
      // La cause de l'échec se lit dans la LISTE, pas seulement après avoir
      // sélectionné la ligne : c'est ce qui rend un échec impossible à rater.
      const failure = row.statusKind === 'failed' ? getStaffEmailFailureReason(row) : null;
      const rowOrigin = pv2SentOrigin(row);
      const p = row.payload && typeof row.payload === 'object' ? row.payload : {};
      const sentBy = p.sentBy && typeof p.sentBy === 'object' ? p.sentBy : null;
      const origineTxt = rowOrigin === 'auto'
        ? (row.templateLabel || row.templateId || 'Auto')
        : `${PV2_ORIGINE_LABELS[rowOrigin]}${sentBy && sentBy.memberName ? ` · ${sentBy.memberName}` : ''}`;
      const selectedRow = selected && row.uid === selected.uid;
      return `<tr class="${selectedRow ? 'selected' : ''}${failure ? ' is-failed' : ''}" onclick="pv2SelectEmail('${escJs(row.uid)}')" aria-selected="${selectedRow ? 'true' : 'false'}">
        <td data-col="message"><button type="button" class="pv2-row-btn" onclick="event.stopPropagation(); pv2SelectEmail('${escJs(row.uid)}')"><strong>${esc(row.subject || row.templateLabel || 'Message')}</strong><small class="pv2-cell-sub">${esc(row.recipient || '-')}</small></button></td>
        <td data-col="origine"><span class="pv2-chip pv2-origin-badge pv2-origin-chip" data-origin="${rowOrigin}">${esc(origineTxt)}</span></td>
        <td data-col="statut"><span class="pv2-chip ${meta.tone}">${meta.label}</span>${failure ? `<small class="pv2-cell-sub pv2-cell-fail">${esc(failure.label)}</small>` : ''}</td>
        <td data-col="parcours" class="pv2-col-parcours">${pv2JourneyHtml(row)}</td>
        <td data-col="date" class="num">${esc(formatOpsTimestamp(row.sentAt || row.scheduledAt || row.createdAt) || '-')}</td>
      </tr>`;
    }).join('');

    return `${pv2AlerteEchecsHtml(scoped, metrics)}
      <section class="pv2-origins" role="group" aria-label="Origine des messages">
        <span class="pv2-origins-label">Origine</span>
        ${PV2_SENT_ORIGINS.map(([key, label]) => `<button type="button" class="pv2-chip-btn pv2-origin-seg${origin === key ? ' active' : ''}" onclick="pv2EmailOriginFilter('${key}')" aria-pressed="${origin === key}">${esc(label)}${key === 'all' ? '' : `<span class="pv2-origin-count">(${originCounts[key]})</span>`}</button>`).join('')}
        <span class="pv2-origins-hint">Automatiques : partis tout seuls (séquences, rappels). Envois manuels : écrits par vous ou l'équipe. Campagnes et tests : à part.</span>
      </section>

      <section class="pv2-pipeline" role="group" aria-label="Filtrer la file">
        <span class="pv2-pipe-rail" aria-hidden="true"></span>
        ${pipe('all', 'Tout', 'Tout', scoped.length, '', { paren: true })}
        ${pipe('queued', 'En attente', 'En attente', metrics.queued, plural(metrics.due || 0, 'prêt à partir', 'prêts à partir'))}
        ${pipe('sent', 'Envoyé', 'Envoyés', metrics.sent, metrics.deliveryRate == null ? '' : `${metrics.deliveryRate} % de réussite`)}
        ${pipe('delivered', 'Remis', 'Remis', remisCount, remisCount ? '' : 'aucun accusé de remise')}
        ${pipe('opened', 'Ouvert', 'Ouverts', ouvertsCount, ouvertsCount ? '' : ouvertures === false ? 'suivi inactif' : 'aucune ouverture')}
        ${pipe('failed', 'Échec', 'Échecs', metrics.failed, plural(metrics.attempted || 0, 'tentative d’envoi', 'tentatives d’envoi'))}
        ${pipe('review', 'À valider', 'À valider', metrics.review, '')}
      </section>
      <p class="pv2-pipeline-scope">Tout, En attente, Envoyés, Remis, Ouverts, Échecs et À valider portent sur les ${scoped.length} messages de la file ci-dessous. Les ${inboundCount} mails reçus se lisent dans <button type="button" class="pv2-link-btn" onclick="pv2EmailsGo('recus')">Reçus</button>.</p>

      <section class="pv2-split">
        <article class="pv2-panel pv2-mail-list">
          <div class="pv2-panel-head pv2-list-head">
            <h2>La file</h2>
            <div class="pv2-panel-head-actions pv2-sent-tools">
              <label class="pv2-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="14" height="14"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg><input data-pl-focus="emails.recherche" value="${esc(state.staffEmailQuery || '')}" placeholder="Client, sujet, erreur…" aria-label="Rechercher dans la file" oninput="setStaffEmailQuery(this.value)"></label>
              <button type="button" class="pv2-btn sm ghost" onclick="pv2ExporterEnvoyes()">Exporter</button>
              <button type="button" class="pv2-btn sm" onclick="requestOpsDispatch()">Envoyer la file</button>
            </div>
          </div>
          <table class="pv2-table">
            <thead><tr><th>Message</th><th>Origine</th><th>Statut</th><th>Parcours</th><th class="num">Date</th></tr></thead>
            <tbody data-pl-stagger="comms.file">${tableRows || `<tr><td colspan="5"><div class="pv2-empty"><strong>File vide</strong>${origin === 'auto' ? 'Aucun mail automatique ne correspond à ce filtre.' : origin === 'manual' ? 'Aucun envoi manuel ne correspond à ce filtre.' : origin === 'campagne' ? 'Aucun mail de campagne ne correspond à ce filtre.' : origin === 'test' ? 'Aucun mail de test ne correspond à ce filtre.' : 'Aucune communication pour ce filtre.'}</div></td></tr>`}</tbody>
          </table>
        </article>
        <article class="pv2-panel">
          <div class="pv2-panel-head"><h2>${esc(selected ? (selected.subject || 'Détail') : 'Détail')}</h2></div>
          ${pv2SentDetailHtml(selected, KIND_META)}
        </article>
      </section>`;
  }

  // L export porte exactement la file affichee (filtres Remis/Ouverts compris).
  window.pv2ExporterEnvoyes = function () {
    if (typeof exportStaffEmailsCsv !== 'function') return;
    exportStaffEmailsCsv(pv2SentRows().rows);
  };

  /* ── SEQUENCES ─────────────────────────────────────────────────────────── */
  function pv2EmailsSectionSequences() {
    return `<div class="pv2-seq-groups">
      <section class="pv2-panel mk-auto-panel" aria-label="Séquences Pinlane">
        <div class="pv2-panel-head has-sub">
          <div><h2>Les séquences Pinlane</h2><p class="pv2-panel-sub">Les mails qui partent tout seuls, au bon moment. Chaque carte montre le texte qui part vraiment. Les compteurs portent sur les 30 derniers jours.</p></div>
          <div class="pv2-panel-head-actions">
            ${mkAuto.error ? `<button type="button" class="pv2-btn sm" onclick="loadStaffAutomations(true)">Réessayer</button>` : ''}
          </div>
        </div>
        <div class="pv2-panel-body">
          ${mkAuto.error
            ? `<div class="pv2-empty"><strong>${esc(mkAuto.error)}</strong></div>`
            : mkAuto.loaded
              ? `<div class="mk-auto-grid">${AUTOMATION_META.map(mkAutoCard).join('')}</div>`
              : `<div class="pv2-empty" aria-live="polite" aria-busy="true">${typeof renderThinking === 'function' ? renderThinking('searching') : '<strong>Chargement des séquences…</strong>'}</div>`}
        </div>
      </section>
      <section class="pv2-panel mk-auto-panel" aria-label="Vos séquences">
        <div class="pv2-panel-head has-sub">
          <div><h2>Vos séquences</h2><p class="pv2-panel-sub">Vos propres automatisations : un déclencheur, une cible, un message, un plafond.</p></div>
          <div class="pv2-panel-head-actions">
            <button type="button" class="pv2-btn sm primary" onclick="pv2SeqNew()" ${pv2Seq.creating ? 'disabled' : ''}>+ Créer une séquence</button>
          </div>
        </div>
        <div class="pv2-panel-body">
          ${pv2Seq.creating ? `<div class="mk-auto-grid" style="margin-bottom:var(--space-4)"><article class="mk-auto pv2-seq-card is-editing"><div class="mk-auto-head"><strong>Nouvelle séquence<span class="pv2-seq-pill">perso</span></strong></div>${pv2SeqEditor()}</article></div>` : ''}
          ${pv2Seq.sequences.length
            ? `<div class="mk-auto-grid">${pv2Seq.sequences.map(pv2SeqCard).join('')}</div>`
            : (pv2Seq.creating ? '' : '<div class="pv2-empty"><strong>Aucune séquence à vous</strong>Créez la première : elle tourne chaque matin avec celles de Pinlane.</div>')}
        </div>
      </section>
      ${mailInventoryPanel()}
    </div>`;
  }

  /* ── APPARENCE & SIGNATURE ─────────────────────────────────────────────── */
  function pv2DesignFormHtml(d, mayEdit) {
    const dis = mayEdit ? '' : ' disabled';
    const presets = pv2Design.presets.length ? pv2Design.presets : PV2_DESIGN_PRESETS;
    const centre = pv2Design.center || {};
    const branding = centre.branding && typeof centre.branding === 'object' ? centre.branding : {};
    const info = centre.publicInfo && typeof centre.publicInfo === 'object' ? centre.publicInfo : {};
    const accentCentre = /^#[0-9a-f]{6}$/i.test(String(branding.accent || '')) ? String(branding.accent) : '';
    const logos = pv2Design.logos || [];
    const logoOptions = (valeur) => `<option value="">Aucun logo</option>${logos.map((l) => `<option value="${esc(l.url)}"${l.url === valeur ? ' selected' : ''}>${esc(l.label)}</option>`).join('')}${valeur && !logos.some((l) => l.url === valeur) ? `<option value="${esc(valeur)}" selected>Adresse personnalisée</option>` : ''}`;
    const champ = (path, label, valeur, { type = 'text', placeholder = '', hint = '', wide = false } = {}) => `<label class="pv2-composer-field${wide ? ' pv2-composer-wide' : ''}"><span>${esc(label)}${hint ? ` <small class="mk-auto-edit-hint">${esc(hint)}</small>` : ''}</span><input type="${type}" value="${esc(valeur === undefined || valeur === null ? '' : valeur)}" placeholder="${esc(placeholder)}" data-pl-focus="emails.design.${esc(path)}" oninput="pv2DesignField('${escJs(path)}', this.value)"${dis}></label>`;
    const interrupteur = (path, on, label) => `<button type="button" class="mk-switch${on ? ' is-on' : ''}" data-switch-key="design:${esc(path)}" role="switch" aria-checked="${on}" aria-label="${esc(label)}" onclick="pv2DesignBascule('${escJs(path)}')"${dis}><span></span></button>`;
    const radio = (name, path, valeur, courant, label, extra = '') => `<label class="pv2-check"><input type="radio" name="${name}" value="${esc(valeur)}" ${courant === valeur ? 'checked' : ''} onchange="pv2DesignChoix('${escJs(path)}', '${escJs(valeur)}')"${dis}${extra}> ${label}</label>`;
    const headerLogo = d.header.mode === 'logo' || d.header.mode === 'logo-nom';
    const nomCentre = String(centre.name || (typeof pv2CenterName === 'function' ? pv2CenterName() : '') || 'votre centre');
    return `<div class="pv2-design-form">
      <section class="pv2-design-block" aria-label="Gabarit">
        <h3>Gabarit</h3>
        <p class="pv2-design-hint">La structure du mail : une carte, du papier, une barre de couleur ou un bandeau.</p>
        <div class="pv2-design-presets" role="radiogroup" aria-label="Gabarit">
          ${presets.map((p) => `<button type="button" class="pv2-design-preset${d.preset === p.id ? ' is-active' : ''}" role="radio" aria-checked="${d.preset === p.id}" onclick="pv2DesignChoix('preset', '${escJs(p.id)}')"${dis}><span class="pv2-design-schema is-${esc(p.id)}" aria-hidden="true"></span><strong>${esc(p.label)}</strong><small>${esc(p.description || '')}</small></button>`).join('')}
        </div>
      </section>
      <section class="pv2-design-block" aria-label="Couleur d'accent">
        <h3>Couleur d'accent</h3>
        <p class="pv2-design-hint">Les titres, les boutons et la barre du gabarit Carte. Le texte courant reste en encre.</p>
        <div class="pv2-design-radios">
          ${radio('pv2DesignAccent', 'accent.mode', 'encre', d.accent.mode, 'Encre <small>(sobre)</small>')}
          ${accentCentre
            ? radio('pv2DesignAccent', 'accent.mode', 'centre', d.accent.mode, `<span class="pv2-design-swatch" style="background:${accentCentre}"></span> Couleurs du centre`)
            : radio('pv2DesignAccent', 'accent.mode', 'centre', d.accent.mode, 'Couleurs du centre <small>(aucune couleur dans la fiche du centre)</small>', ' disabled')}
          ${radio('pv2DesignAccent', 'accent.mode', 'perso', d.accent.mode, 'Personnalisée')}
          ${d.accent.mode === 'perso' ? `<span class="pv2-design-inline"><input type="color" value="${/^#[0-9a-f]{6}$/i.test(String(d.accent.hex || '')) ? esc(d.accent.hex) : '#0a0a0a'}" aria-label="Choisir la couleur" oninput="pv2DesignField('accent.hex', this.value)"${dis}><input type="text" value="${esc(d.accent.hex || '')}" placeholder="#0a0a0a" maxlength="7" aria-label="Code couleur" data-pl-focus="emails.design.accent.hex" oninput="pv2DesignField('accent.hex', this.value)"${dis}></span>` : ''}
        </div>
      </section>
      <section class="pv2-design-block" aria-label="En-tête">
        <h3>En-tête</h3>
        <div class="pv2-design-fields">
          <label class="pv2-composer-field"><span>Affiche</span>
            <select onchange="pv2DesignChoix('header.mode', this.value)"${dis}>
              ${[['nom', 'Le nom du centre'], ['logo', 'Le logo'], ['logo-nom', 'Le logo et le nom'], ['aucun', 'Rien']].map(([v, l]) => `<option value="${v}"${d.header.mode === v ? ' selected' : ''}>${l}</option>`).join('')}
            </select>
          </label>
          ${headerLogo ? `<label class="pv2-composer-field"><span>Logo</span><select onchange="pv2DesignChoix('header.logoUrl', this.value)"${dis}>${logoOptions(d.header.logoUrl)}</select></label>
          ${champ('header.logoUrl', 'Adresse de l\'image (https)', d.header.logoUrl, { type: 'url', placeholder: 'https://…/logo.png', wide: true })}
          ${champ('header.logoWidth', 'Largeur du logo (px, 60 à 300)', d.header.logoWidth, { type: 'number' })}` : ''}
        </div>
        ${headerLogo && !logos.length ? '<p class="pv2-design-hint">Aucun logo déclaré pour ce centre : collez l\'adresse https d\'une image, ou laissez l\'en-tête en texte.</p>' : ''}
      </section>
      <section class="pv2-design-block" aria-label="Pied de page">
        <h3>Pied de page</h3>
        <p class="pv2-design-hint">Les coordonnées viennent de la fiche du centre. Ce qui n'y est pas renseigné reste absent du mail.</p>
        <div class="pv2-design-scope">
          ${[['adresse', 'Adresse', info.address], ['telephone', 'Téléphone', info.phone], ['email', 'Adresse email', info.email]].map(([k, l, v]) => `<div class="pv2-design-scope-row"><strong>${l}</strong><small>${v ? esc(String(v)) : 'non renseigné dans la fiche du centre'}</small>${interrupteur(`footer.${k}`, Boolean(d.footer[k]), l)}</div>`).join('')}
        </div>
        <label class="pv2-composer-field"><span>Mention libre <small class="mk-auto-edit-hint">laissée vide = absente du mail</small></span><textarea rows="2" maxlength="300" placeholder="Ex. Fermé le lundi hors vacances scolaires." data-pl-focus="emails.design.footer.mention" oninput="pv2DesignField('footer.mention', this.value)"${dis}>${esc(d.footer.mention || '')}</textarea></label>
      </section>
      <section class="pv2-design-block" aria-label="Signature">
        <h3>Signature</h3>
        <div class="pv2-design-scope">
          <div class="pv2-design-scope-row"><strong>Signer les mails</strong><small>Une signature pro en fin de mail : formule, équipe ou personne, coordonnées, réseaux.</small>${interrupteur('signature.enabled', Boolean(d.signature.enabled), 'Signer les mails')}</div>
        </div>
        ${d.signature.enabled ? `
        <div class="pv2-design-radios">
          <span class="pv2-note">Disposition</span>
          ${radio('pv2DesignLayout', 'signature.layout', 'carte', d.signature.layout, 'Carte <small>(logo à gauche, texte à droite)</small>')}
          ${radio('pv2DesignLayout', 'signature.layout', 'ligne', d.signature.layout, 'Une ligne')}
        </div>
        <div class="pv2-design-fields">
          ${champ('signature.closing', 'Formule de fin', d.signature.closing, { placeholder: 'À très bientôt,', hint: 'vide = absente' })}
          ${champ('signature.teamLabel', 'Nom d\'équipe', d.signature.teamLabel, { placeholder: `L'équipe ${nomCentre}`, hint: 'vide = « L\'équipe » + nom du centre' })}
          ${champ('signature.role', 'Rôle affiché', d.signature.role, { placeholder: 'Ex. Direction', hint: 'sur les mails manuels, le rôle de la personne prime' })}
          ${champ('signature.phone', 'Téléphone', d.signature.phone, { type: 'tel', placeholder: 'vide = absent du mail' })}
          ${champ('signature.email', 'Email', d.signature.email, { type: 'email', placeholder: 'vide = absent du mail' })}
          ${champ('signature.website', 'Site web (https)', d.signature.website, { type: 'url', placeholder: 'vide = absent du mail' })}
          ${champ('signature.address', 'Adresse', d.signature.address, { placeholder: 'vide = absente du mail', wide: true })}
          <label class="pv2-composer-field"><span>Logo de signature</span><select onchange="pv2DesignChoix('signature.logoUrl', this.value)"${dis}>${logoOptions(d.signature.logoUrl)}</select></label>
          ${champ('signature.logoWidth', 'Largeur du logo (px, 60 à 300)', d.signature.logoWidth, { type: 'number' })}
          ${champ('signature.logoUrl', 'Adresse de l\'image (https)', d.signature.logoUrl, { type: 'url', placeholder: 'https://…/logo.png', wide: true })}
          ${champ('signature.socials.facebook', 'Facebook', d.signature.socials.facebook, { type: 'url', placeholder: 'https://facebook.com/…' })}
          ${champ('signature.socials.instagram', 'Instagram', d.signature.socials.instagram, { type: 'url', placeholder: 'https://instagram.com/…' })}
          ${champ('signature.socials.tiktok', 'TikTok', d.signature.socials.tiktok, { type: 'url', placeholder: 'https://tiktok.com/@…' })}
          ${champ('signature.socials.linkedin', 'LinkedIn', d.signature.socials.linkedin, { type: 'url', placeholder: 'https://linkedin.com/company/…' })}
        </div>
        ${!logos.length ? '<p class="pv2-design-hint">Aucun logo déclaré pour ce centre. Les réseaux s\'affichent en liens texte, jamais en icônes inventées.</p>' : ''}` : ''}
      </section>
      <section class="pv2-design-block" aria-label="Où l'appliquer">
        <h3>Où appliquer la signature</h3>
        <div class="pv2-design-scope">
          <div class="pv2-design-scope-row"><strong>Messages manuels</strong><small>Vos réponses et messages libres : signés par la personne qui écrit.</small>${interrupteur('signatureScope.manual', Boolean(d.signatureScope.manual), 'Messages manuels')}</div>
          <div class="pv2-design-scope-row"><strong>Séquences</strong><small>Confirmations, rappels, relances automatiques : signés par l'équipe.</small>${interrupteur('signatureScope.sequences', Boolean(d.signatureScope.sequences), 'Séquences')}</div>
          <div class="pv2-design-scope-row"><strong>Campagnes</strong><small>Les envois groupés gardent leur ligne de retrait quoi qu'il arrive.</small>${interrupteur('signatureScope.campaigns', Boolean(d.signatureScope.campaigns), 'Campagnes')}</div>
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
    const mayEdit = typeof canUseStaffPermission !== 'function' || ['settings.manage', 'emails.send', 'direction.view'].some((p) => canUseStaffPermission(p));
    const samples = [['confirmation', 'Confirmation'], ['reponse', 'Réponse'], ['campagne', 'Campagne']].map(([key, label]) => ({ key, label, active: pv2Design.sample === key }));
    const busy = pv2Design.busy;
    return `<div class="pv2-design-layout">
      ${pv2DesignFormHtml(d, mayEdit)}
      <div class="pv2-design-preview">
        ${pv2ApercuVivantHtml('design', { titre: 'Le mail tel qu\'il partira', tete: seg(samples, 'pv2DesignSample'), cadre: 'pv2-design-frame' })}
        ${mayEdit ? `<div class="pv2-design-actions">
          <button type="button" class="pv2-btn primary" onclick="pv2DesignSave()" ${busy || !pv2Design.dirty ? 'disabled' : ''}>${busy === 'save' ? 'Enregistrement…' : 'Enregistrer'}</button>
          <button type="button" class="pv2-btn" onclick="pv2DesignTest()" ${busy ? 'disabled' : ''}>${busy === 'test' ? 'Envoi…' : 'M\'envoyer un test'}</button>
          <button type="button" class="pv2-btn ghost" onclick="pv2DesignReset()" ${busy ? 'disabled' : ''}>Rétablir les défauts</button>
        </div>` : '<p class="pv2-note">Votre rôle ne permet pas de modifier l\'apparence des mails : vous la consultez.</p>'}
        ${pv2Design.erreurServeur ? `<p class="pv2-design-error" role="alert">${esc(pv2Design.erreurServeur)}</p>` : ''}
        <p class="pv2-note">${pv2Design.dirty ? 'Modifications non enregistrées.' : d.updatedAt ? `Dernière modification ${esc(formatOpsTimestamp(d.updatedAt))}${d.updatedBy ? ` par ${esc(d.updatedBy)}` : ''}.` : 'Apparence par défaut : rien n\'a encore été enregistré pour ce centre.'}</p>
      </div>
    </div>`;
  }

  /* ── EXCLUSIONS, CAMPAGNES ─────────────────────────────────────────────── */
  function pv2EmailsSectionExclusions() {
    return pv2SuppressionPanel({ toujoursOuvert: true });
  }

  function pv2EmailsSectionCampagnes() {
    const bloc = typeof renderPv2RealCampaigns === 'function' ? renderPv2RealCampaigns() : '';
    return bloc || '<section class="pv2-panel"><div class="pv2-panel-body"><div class="pv2-empty"><strong>Campagnes indisponibles</strong>Votre rôle ne permet pas de les gérer.</div></div></section>';
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

    const updatedAt = opsAdminCache.lastLoadedAt ? formatOpsTimestamp(opsAdminCache.lastLoadedAt) : 'non chargé';
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
    const sectionHtml = (renderers[section] || renderers.apercu)();
    const sectionChanged = PV2_EMAILS_MOTION.section !== section;
    const premierePeinture = !PV2_EMAILS_MOTION.section;
    PV2_EMAILS_MOTION.section = section;

    root.innerHTML = `<div class="pv2-shell">
      ${bar({
        crumb: 'Clients & marketing',
        title: 'Emails & relances',
        sub: `${esc(PV2_SECTION_SUB[section] || '')} <span class="pv2-bar-stamp">· à jour à ${esc(updatedAt)}</span>${errorMessage ? ` · <span style="color:var(--danger)">${esc(errorMessage)}</span>` : ''}`,
        /* Trois niveaux : une seule action primaire (Nouveau message), une
           secondaire (Coller un mail reçu), le reste en discret. */
        actions: `
          <button type="button" class="pv2-btn sm ghost" onclick="pv2EmailsActualiser()" title="Recharger les données">${ci('refresh')}Actualiser</button>
          <button type="button" class="pv2-btn" onclick="pv2OpenAnalyze()">${ci('inbox')}Coller un mail reçu</button>
          <button type="button" class="pv2-btn primary" onclick="pv2OpenComposer()">${ci('send')}Nouveau message</button>`,
      })}
      ${pv2Mail.analyzeOpen ? pv2AnalyzePanel() : ''}
      ${pv2SubnavHtml(section)}
      <section class="pv2-emails-section${sectionChanged && !premierePeinture && !reducedMotion ? ' pv2-mount' : ''}" id="pv2EmailsPanel" role="tabpanel" aria-labelledby="pv2EmailsTab-${section}" data-section="${section}">
        ${sectionHtml}
      </section>
    </div>`;
    mount(root, 'emails');
    // Le mouvement se recale APRES la reconstruction, jamais pendant : ces
    // appels lisent une memoire hors DOM, comparent, et ne bougent que ce qui
    // a reellement change d'etat.
    pv2PoserIndicateurSousNav(root, false);
    slidePipeRail(root);
    replaySwitchKnobs(root);
    pv2TokeditAdoptAll(root);
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

  const mkBrief = {
    data: null, loading: false, error: '', period: 30, tab: 'feed',
    payOpen: false, openCard: null, cardNetwork: {},
    angleOpen: null, publishedAsk: null, receiptsAll: false,
    busy: '', published: {}, dismissed: {},
    studioChannel: 'facebook', studioPacks: {}, studioBusy: false,
  };
  window.mkBrief = mkBrief;

  // L'etat de SESSION du bureau (refonte 2026-08-06 « console d'agent ») :
  //  : mode du composer (« demander » pose une question, « creer » prepare un
  //    livrable ; ce sont deux CONTRATS differents, pas deux skins) ;
  //  : thread = les tours ephemeres du mode Demander (reponses assemblees en
  //    local depuis le bundle deja charge : au rechargement, le fil se
  //    reconstruit depuis les objets serveur, qui sont la verite) ;
  //  : knownKeys = les propositions deja vues, pour n'animer QUE l'arrivee
  //    d'une action neuve dans le tableau (jamais le chargement initial) ;
  //  : loadedCenter = le centre dont les donnees a l'ecran proviennent. S'il
  //    diverge du centre selectionne, TOUT l'etat marketing est remis a zero :
  //    un gerant sur Gembloux ne voit jamais une seconde de data Libramont.
  // panelOpen : le panneau lateral (taches + radar) se ferme et s'ouvre d'un
  // geste, anime. Le chat, lui, ne bouge jamais : c'est la piece principale.
  // painted : combien de tours ont DEJA joue leur entree. Un repaint innerHTML
  // recree tout le DOM : sans ce compteur, chaque frappe rejouerait
  // l'animation de TOUT le fil. Seuls les tours au-dela de `painted`
  // s'animent, et le compteur les absorbe une fois leur entree jouee.
  const mkw = { mode: 'creer', thread: [], knownKeys: null, loadedCenter: '', focusRival: '', panelOpen: true, painted: 0, stateWord: null };
  window.mkw = mkw;

  // Motion à un coup : la toile ne se refade qu'en ARRIVANT sur une vue (ou à
  // la première donnée), jamais sur chaque clic in-view (ouvrir une carte,
  // toggler un jour). Sinon tout le fil clignote à chaque interaction.
  let mkwPrevTab = null;

  let mkRenderQueued = false;
  function scheduleCampaignsRender() {
    if (mkRenderQueued) return;
    mkRenderQueued = true;
    requestAnimationFrame(() => {
      mkRenderQueued = false;
      renderStaffCampaignsPage();
    });
  }

  async function loadMarketingBrief(force = false) {
    if (mkBrief.loading || (mkBrief.data && !force)) return;
    mkBrief.loading = true;
    mkBrief.error = '';
    try {
      mkBrief.data = await apiRequest(`/api/ops?action=marketingBrief&days=${encodeURIComponent(mkBrief.period)}&centerId=${encodeURIComponent(state.adminCenterId || 'libramont')}`);
    } catch (error) {
      mkBrief.error = error.message || 'Je n\'arrive pas à charger le brief.';
    } finally {
      mkBrief.loading = false;
      scheduleCampaignsRender();
    }
  }
  window.loadMarketingBrief = loadMarketingBrief;

  const BR_DOW = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];
  function brFrDay(dateStr) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ''))) return String(dateStr || '');
    return `${BR_DOW[new Date(`${dateStr}T12:00:00Z`).getUTCDay()]} ${dateStr.slice(8, 10)}/${dateStr.slice(5, 7)}`;
  }
  function brFrDates(text) {
    return String(text || '').replace(/\b\d{4}-(\d{2})-(\d{2})\b/g, '$2/$1');
  }

  // Motif prose-preuve : les nombres (et leurs unités) passent en mono dans
  // toute phrase de l'employé. Les nombres sont MARQUÉS (sentinelles
  // \uE000/\uE001, zone privée Unicode) AVANT l'échappement, sinon la regex
  // matchait les chiffres des entités HTML produites par esc()
  // (« &#39; » devenait « &#<strong>39</strong>; », bug du premier rendu).
  function brProse(text) {
    const marked = brFrDates(text).replace(/([+-]?\d[\d\u00a0\u202f.,\/]*(?:\s?(?:€|%|°C|mm|résas?\b|pers\.|personnes|visiteurs|venues?\b|j\b|h(?:\d{2})?\b))?)/g, '\uE000$1\uE001');
    return esc(marked).replace(/\uE000/g, '<strong class="br-num">').replace(/\uE001/g, '</strong>');
  }

  const BR_TRIGGER_LABELS = { pluie: 'pluie', chaleur: 'chaleur', creux: 'jour calme', jour_fort: 'jour fort', evenement: 'événement', vacances: 'vacances', concurrent: 'concurrence', demande: 'votre demande', plan: 'mon plan' };
  const BR_TRIGGER_TONE = { creux: 'danger', jour_fort: 'success' };
  const BR_NETWORK_LABELS = { facebook: 'Facebook', instagram: 'Instagram', story: 'Story', email: 'Email' };

  // NB : la paie vit dans Impact (mkwHero) ; mkBrPeriod/mkBrPayDetail servent
  // cette surface. Le brief et la file vivent dans le fil du bureau.

  window.mkBrPeriod = async function (days) {
    mkBrief.period = Number(days) || 30;
    renderStaffCampaignsPage();
    // Refetch de la paie seule (léger) : le reste du brief ne dépend pas de la période.
    try {
      const roi = await apiRequest(`/api/ops?action=marketingRoi&days=${encodeURIComponent(mkBrief.period)}&centerId=${encodeURIComponent(state.adminCenterId || 'libramont')}`);
      if (mkBrief.data) {
        const measuredCount = (mkBrief.data.receipts || []).length;
        mkBrief.data.paie = {
          ...mkBrief.data.paie,
          euros: roi.revenue, venues: roi.conversions, sent: roi.sent, reviewClicks: roi.reviewClicks, days: roi.days,
          available: roi.available !== false,
          unavailableReason: roi.unavailableReason || null,
          excludedMissingSentAt: roi.available === false ? null : (roi.excludedMissingSentAt ?? 0),
          sources: roi.available === false ? (roi.bySource || []) : (roi.bySource || []).filter((s) => s.sent > 0).sort((a, b) => b.revenue - a.revenue),
          // Même doctrine que le serveur : jeune = rien envoyé ET rien jamais
          // mesuré ; fenêtre calme = un historique existe, cette période est vide.
          young: roi.available !== false && roi.sent === 0 && measuredCount === 0,
          quietWindow: roi.available !== false && roi.sent === 0 && measuredCount > 0,
        };
      }
    } catch (error) {
      // Une période qui n'a pas pu être chargée n'hérite pas du chiffre de la précédente.
      if (mkBrief.data) mkBrief.data.paie = {
        ...mkBrief.data.paie, available: false, unavailableReason: 'network_error', days: mkBrief.period,
        euros: null, venues: null, sent: null, reviewClicks: null, excludedMissingSentAt: null,
        young: false, quietWindow: false,
        sources: (mkBrief.data.paie?.sources || []).map(s => ({ ...s, sent: null, conversions: null, revenue: null })),
      };
    } finally {
      scheduleCampaignsRender();
    }
  };
  window.mkBrPayDetail = function () {
    mkBrief.payOpen = !mkBrief.payOpen;
    renderStaffCampaignsPage();
  };

  /* ── Z2 · Le radar 14 jours ── */

  const BR_WEATHER = {
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    cloud: '<path d="M17.5 19a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.5 2A4 4 0 0 0 7 19z"/>',
    rain: '<path d="M17.5 15a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.5 2A4 4 0 0 0 7 15z"/><path d="M8 19v2M12 18v3M16 19v2"/>',
  };
  function brWeatherIcon(day) {
    const kind = day.precipMm !== null && day.precipMm >= 1 ? 'rain' : (day.tmax !== null && day.tmax >= 22 ? 'sun' : 'cloud');
    return `<svg class="br-wx" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${BR_WEATHER[kind]}</svg>`;
  }

  // (le radar plein cadre est mort le 2026-08-06 : le mini-radar du panneau
  // pose la question au chat, la reponse porte l'explication du jour.)
  window.mkBrGoCard = function (key) {
    if (typeof window.mkwShowProp === 'function') window.mkwShowProp(key, '');
  };
  window.mkBrRadarFill = async function (date) {
    if (mkBrief.busy) return;
    mkBrief.busy = `fill:${date}`;
    renderStaffCampaignsPage();
    try {
      await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'propositionCreate', centerId: state.adminCenterId || 'libramont', targetDate: date, trigger: 'creux', brief: '' }),
      });
      await loadMarketingBrief(true);
      toast('C\'est prêt : la carte est dans le panneau.');
      mkwPanelReveal();
    } catch (error) {
      toast(error.message || 'Je n\'ai pas réussi : réessaie.');
    } finally {
      mkBrief.busy = '';
      scheduleCampaignsRender();
    }
  };

  /* ── Z3 · Prêt pour toi (la file de Propositions) ── */

  function brVisiblePropositions() {
    const b = mkBrief.data;
    if (!b) return [];
    // Filet d'hygiene, meme doctrine que le serveur (bug prod 17/07) : une
    // consigne datee perimee ne s'affiche jamais (« a publier avant mer
    // 15/07 » un 17/07 est un reproche, pas un conseil), et le meme conseil
    // mot pour mot ne s'affiche qu'une fois.
    const today = b.today || '';
    const seen = new Set();
    return (b.propositions || []).filter((p) => {
      if (mkBrief.dismissed[p.key]) return false;
      if (p.dueDate && today && p.dueDate < today) return false;
      if (p.targetDate && today && p.targetDate < today) return false;
      const key = String(p.whyShort || p.why || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 90);
      if (key && seen.has(key)) return false;
      if (key) seen.add(key);
      return true;
    });
  }

  // ── L'ATELIER d'une proposition ─────────────────────────────────────────
  // Le corps déployé (onglets réseau, papier, copier, autre angle, publié ?),
  // rendu par la carte mkwPropCard. Le câblage serveur est inchangé.
  // LES FAITS DERRIERE une proposition. Chaque ligne porte la valeur exacte,
  // le nombre d observations qui la soutient et la derivation : le gerant doit
  // pouvoir refaire le calcul a la main et prendre l agent en defaut. Sans ca,
  // « Voir les faits » etait un mot sur une carte, et la tracabilite dormait en
  // base sans que personne puisse la lire.
  function mkwPropFacts(p) {
    const faits = (p.faits || []).filter((f) => f.id || f.valeur || f.autres);
    if (!faits.length) return '';
    const lignes = faits.map((f) => {
      const detail = [
        f.observations ? `${f.observations} observation${f.observations > 1 ? 's' : ''}` : '',
        f.calcul,
        f.calcul ? '' : f.autres,
      ].filter(Boolean).join(' · ');
      return `<li class="mkw-fact">
        <span class="mkw-fact-val">${esc(f.valeur || f.id)}</span>
        ${detail ? `<span class="mkw-fact-how">${esc(detail)}</span>` : ''}
      </li>`;
    }).join('');
    return `<details class="mkw-facts"><summary>Les faits derrière (${faits.length})</summary>
      <ul class="mkw-fact-list">${lignes}</ul>
      <p class="mkw-fact-note">Chaque chiffre se refait à la main depuis sa dérivation.</p>
    </details>`;
  }

  function mkwPropOpenBody(p) {
    if (p.kind === 'offre') {
      const note = (p.networks && (p.networks.interne || p.networks.facebook) || {}).text || p.why || '';
      return `<div class="mkw-prop-body"><div class="mkw-paper">${esc(note)}</div>
        <div class="mkw-prop-actions">
          <button type="button" class="pv2-btn primary" onclick="mkBrDismiss('${escJs(p.key)}')">${ci('check')}C'est noté</button>
          <button type="button" class="mkw-link mkw-link-faint" onclick="mkBrOpenCard('${escJs(p.key)}')">Réduire</button>
        </div></div>`;
    }
    const networks = (mkBrief.data.networks || []).filter(() => p.kind !== 'email');
    const current = mkBrief.cardNetwork[p.key] || p.network || (networks[0] || 'facebook');
    const entry = (p.networks || {})[current] || null;
    const generating = mkBrief.busy === `net:${p.key}:${current}`;
    const netTabs = p.kind === 'email' ? '' : `<div class="mkw-nets" role="tablist">${networks.map((network) => `<button type="button" role="tab" aria-selected="${current === network}" class="mkw-net ${current === network ? 'active' : ''}" onclick="mkBrNetwork('${escJs(p.key)}', '${escJs(network)}')">${BR_NETWORK_LABELS[network] || network}</button>`).join('')}</div>`;
    const paper = generating
      ? `<div class="mkw-paper mkw-shimmer"><p class="mkw-quiet">adaptation pour ${BR_NETWORK_LABELS[current] || current}…</p></div>`
      : (entry && entry.text
        ? `<div class="mkw-paper">${esc(entry.text)}</div>`
        : `<div class="mkw-paper"><p class="mkw-quiet">Le texte n’est pas venu. <button type="button" class="mkw-link" onclick="mkBrNetwork('${escJs(p.key)}', '${escJs(current)}', true)">Réessayer</button></p></div>`);
    const photoIdea = (entry && entry.photoIdea) || p.photoIdea;
    const bestSlot = (entry && entry.bestSlot) || p.bestSlot;
    const imagePrompt = (entry && entry.imagePrompt) || p.imagePrompt;
    const under = [
      photoIdea ? `<p class="mkw-under">Idée photo : ${esc(photoIdea)}</p>` : '',
      bestSlot ? `<p class="mkw-under mkw-under-mono">Meilleur moment : ${esc(bestSlot)}</p>` : '',
      imagePrompt ? `<details class="mkw-prompt"><summary>prompt pour une image IA</summary><div class="mkw-prompt-text">${esc(imagePrompt)}</div><button type="button" class="mkw-link" onclick="mkBrCopyPrompt('${escJs(p.key)}')">Copier</button></details>` : '',
      mkwPropFacts(p),
    ].join('');
    const angleOpen = mkBrief.angleOpen === p.key;
    const askPublished = mkBrief.publishedAsk === p.key;
    const footer = p.kind === 'email'
      ? `<div class="mkw-prop-actions"><button type="button" class="pv2-btn primary" onclick="state.staffMenuPage = 'emails'; save(); renderStaff();">Ouvrir dans Emails</button><button type="button" class="mkw-link mkw-link-faint" onclick="mkBrDismiss('${escJs(p.key)}')">Pas maintenant</button><button type="button" class="mkw-link mkw-link-faint" onclick="mkBrOpenCard('${escJs(p.key)}')">Réduire</button></div>`
      : `<div class="mkw-prop-actions">
          <button type="button" class="pv2-btn primary" onclick="mkBrCopy('${escJs(p.key)}')" ${generating || !(entry && entry.text) ? 'disabled' : ''}>${ci('copy')}Copier le post</button>
          <button type="button" class="mkw-link" onclick="mkBrAngle('${escJs(p.key)}')">Autre angle</button>
          <button type="button" class="mkw-link mkw-link-faint" onclick="mkBrDismiss('${escJs(p.key)}')">Pas maintenant</button>
          <button type="button" class="mkw-link mkw-link-faint" onclick="mkBrOpenCard('${escJs(p.key)}')">Réduire</button>
        </div>
        ${angleOpen ? `<div class="mkw-angle"><input id="brAngle-${esc(p.key)}" class="mkw-input" placeholder="précise l'angle (optionnel) : « spécial ados », « plus court »…"><button type="button" class="mkw-link" onclick="mkBrRegen('${escJs(p.key)}')" ${mkBrief.busy === `regen:${p.key}` ? 'disabled' : ''}>${mkBrief.busy === `regen:${p.key}` ? 'réécriture…' : 'Refaire'}</button></div>` : ''}
        ${askPublished ? `<div class="mkw-published-ask" role="status">Publié ? <button type="button" class="mkw-link" onclick="mkBrPublished('${escJs(p.key)}', true)">Oui</button><button type="button" class="mkw-link mkw-link-faint" onclick="mkBrPublished('${escJs(p.key)}', false)">Pas encore</button></div>` : ''}`;
    return `<div class="mkw-prop-body">${netTabs}${paper}${under}${footer}</div>`;
  }

  // La proposition est une CARTE : le déclencheur, le pourquoi chiffré,
  // l'aperçu du texte et UNE action. L'atelier déployé (réseaux, papier,
  // copier, autre angle, publié ?) est inchangé : mêmes handlers, mêmes ids
  // (mkwPropOpenBody). Le théâtre (avatar, bulle) est mort le 2026-08-05.
  function mkwPropCard(p) {
    const published = mkBrief.published[p.key];
    if (published) {
      return `<article class="mkw-prop is-published" data-br-card="${esc(p.key)}">
        <p class="mkw-prop-published">${ci('check')}C'est publié : la mesure court 14 jours, le reçu arrive dans Résultats.</p>
      </article>`;
    }
    const open = mkBrief.openCard === p.key;
    const tone = BR_TRIGGER_TONE[p.trigger] || 'accent';
    const dueLabel = p.dueDate ? (p.dueDate === (mkBrief.data && mkBrief.data.today) ? 'aujourd\'hui' : `avant ${brFrDay(p.dueDate)}`) : '';
    const isOffre = p.kind === 'offre';
    const when = p.pinned ? 'le post du jour' : (dueLabel ? `${isOffre ? 'à faire' : 'à publier'} ${dueLabel}` : '');
    const reason = BR_TRIGGER_LABELS[p.trigger] || '';
    const verb = p.kind === 'email' ? 'Voir l\'email' : (isOffre ? 'Voir la checklist' : (p.trigger === 'concurrent' ? 'Voir la riposte' : 'Voir le post'));
    const previewNets = p.networks || {};
    const previewKey = p.network && previewNets[p.network] ? p.network : Object.keys(previewNets)[0];
    const previewEntry = previewKey ? previewNets[previewKey] : null;
    const previewText = String((previewEntry && previewEntry.text) || p.text || '').trim();
    const preview = !open && previewText
      ? `<p class="mkw-prop-preview">${previewKey ? `<span class="mkw-prop-net">${esc(BR_NETWORK_LABELS[previewKey] || previewKey)}</span>` : ''}${esc(previewText)}</p>`
      : '';
    const chips = [
      when ? `<span class="mkw-chip-inline">${esc(when)}</span>` : '',
      reason ? `<span class="mkw-chip-inline mkw-chip-reason">${esc(reason)}</span>` : '',
    ].join('');
    return `<article class="mkw-prop tone-${tone} ${open ? 'is-open' : ''}" data-br-card="${esc(p.key)}">
      <p class="mkw-prop-why">${brProse(p.whyShort || p.why)}</p>
      ${preview}
      ${chips ? `<p class="mkw-prop-meta">${chips}</p>` : ''}
      ${open ? '' : `<div class="mkw-cta">
        <button type="button" class="pv2-btn primary" onclick="mkBrOpenCard('${escJs(p.key)}')">${verb}</button>
        <button type="button" class="mkw-link mkw-link-faint" onclick="mkBrDismiss('${escJs(p.key)}')">Ignorer</button>
      </div>`}
      ${open ? mkwPropOpenBody(p) : ''}
    </article>`;
  }

  // NB : une proposition se montre dans le CHAT (mkwShowProp -> mkwPropCard) ;
  // la demande vit dans le composer du chat (mkwComposer, #brAskInput).

  window.mkBrOpenCard = function (key) {
    mkBrief.openCard = mkBrief.openCard === key ? null : key;
    mkBrief.publishedAsk = null;
    mkBrief.angleOpen = null;
    renderStaffCampaignsPage();
    if (mkBrief.openCard === key) {
      const p = brVisiblePropositions().find((item) => item.key === key);
      const network = p ? (mkBrief.cardNetwork[key] || p.network) : null;
      if (p && network && p.kind !== 'email' && !(p.networks || {})[network]) window.mkBrNetwork(key, network, true);
    }
  };
  // Trouve la proposition (persistée ou volatile) et son payload de POST.
  function brPropPayload(p) {
    return p.id ? { id: p.id } : { proposition: p };
  }

  window.mkBrNetwork = async function (key, network, force = false) {
    const p = brVisiblePropositions().find((item) => item.key === key);
    if (!p) return;
    mkBrief.cardNetwork[key] = network;
    const has = (p.networks || {})[network] && (p.networks || {})[network].text;
    renderStaffCampaignsPage();
    if (has && !force) return;
    if (mkBrief.busy) return;
    mkBrief.busy = `net:${key}:${network}`;
    renderStaffCampaignsPage();
    try {
      const payload = await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'propositionAction', propAction: 'variante', network, centerId: state.adminCenterId || 'libramont', ...brPropPayload(p) }),
      });
      p.id = payload.result.id;
      p.networks = { ...(p.networks || {}), [network]: payload.result.entry };
    } catch (error) {
      toast(error.message || 'Le texte n\'est pas venu : réessaie.');
    } finally {
      mkBrief.busy = '';
      scheduleCampaignsRender();
    }
  };

  window.mkBrCopy = async function (key) {
    const p = brVisiblePropositions().find((item) => item.key === key);
    if (!p) return;
    const network = mkBrief.cardNetwork[key] || p.network;
    const entry = (p.networks || {})[network];
    if (!entry || !entry.text) return;
    try {
      await navigator.clipboard.writeText(entry.text);
    } catch (error) {
      toast('Copie automatique impossible : sélectionnez le texte à la main.');
      return;
    }
    mkBrief.publishedAsk = key;
    renderStaffCampaignsPage();
  };

  window.mkBrCopyPrompt = async function (key) {
    const p = brVisiblePropositions().find((item) => item.key === key);
    if (!p) return;
    const network = mkBrief.cardNetwork[key] || p.network;
    const entry = (p.networks || {})[network] || {};
    const prompt = entry.imagePrompt || p.imagePrompt;
    if (!prompt) return;
    try { await navigator.clipboard.writeText(prompt); toast('Prompt copié.'); } catch (error) { toast('Copie impossible.'); }
  };

  window.mkBrPublished = async function (key, yes) {
    mkBrief.publishedAsk = null;
    if (!yes) {
      renderStaffCampaignsPage();
      return;
    }
    // Garde anti-double-clic : une seule requête de publication par carte, même
    // si le gérant tape « Oui » deux fois (le serveur a sa garde status, mais on
    // évite d'insérer deux lignes via ensurePersisted : mitigation finding 5).
    if (mkBrief.published[key] || mkBrief.busy === `pub:${key}`) { renderStaffCampaignsPage(); return; }
    const p = brVisiblePropositions().find((item) => item.key === key);
    if (!p) return;
    mkBrief.busy = `pub:${key}`;
    mkBrief.published[key] = true; // optimiste : la carte se compacte tout de suite
    renderStaffCampaignsPage();
    try {
      await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'propositionAction', propAction: 'publiee', centerId: state.adminCenterId || 'libramont', ...brPropPayload(p) }),
      });
      toast('Noté : verdict dans 14 jours.');
    } catch (error) {
      // 409 = déjà traitée (double-clic gagné par la 1re requête) → la carte
      // reste publiée. Toute autre erreur → on rétablit pour réessayer.
      if (!/409|plus publiable/i.test(error.message || '')) {
        mkBrief.published[key] = false;
        toast(error.message || 'Je n\'ai pas pu le noter.');
      }
    } finally {
      mkBrief.busy = '';
      scheduleCampaignsRender();
    }
  };

  window.mkBrDismiss = async function (key) {
    const p = brVisiblePropositions().find((item) => item.key === key);
    if (!p) return;
    mkBrief.dismissed[key] = true;
    if (mkBrief.openCard === key) mkBrief.openCard = null;
    renderStaffCampaignsPage();
    try {
      await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'propositionAction', propAction: 'refusee', centerId: state.adminCenterId || 'libramont', ...brPropPayload(p) }),
      });
    } catch (error) { /* déjà masquée côté UI */ }
  };

  window.mkBrAngle = function (key) {
    mkBrief.angleOpen = mkBrief.angleOpen === key ? null : key;
    renderStaffCampaignsPage();
  };

  window.mkBrRegen = async function (key) {
    if (mkBrief.busy) return;
    const p = brVisiblePropositions().find((item) => item.key === key);
    if (!p) return;
    const angle = (document.getElementById(`brAngle-${key}`) || {}).value || '';
    const network = mkBrief.cardNetwork[key] || p.network;
    mkBrief.busy = `regen:${key}`;
    renderStaffCampaignsPage();
    try {
      const payload = await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'propositionAction', propAction: 'autre_angle', network, angle, centerId: state.adminCenterId || 'libramont', ...brPropPayload(p) }),
      });
      p.id = payload.result.id;
      p.networks = { ...(p.networks || {}), [payload.result.network]: payload.result.entry };
      mkBrief.angleOpen = null;
    } catch (error) {
      toast(error.message || 'Je n\'ai pas réussi à réécrire.');
    } finally {
      mkBrief.busy = '';
      scheduleCampaignsRender();
    }
  };

  // LA DEMANDE : une ligne, pas un chat. Le POST est le même
  // (propositionCreate, moteur ADN déterministe côté serveur, aucune clé IA
  // requise) ; la réponse arrive dans la liste des propositions du jour, pas
  // dans une fausse conversation (théâtre retiré le 2026-08-05).
  window.mkBrAskSimple = async function () {
    const brief = String(mkBrief.askDraft || '').trim();
    if (brief.length < 4) { toast('Dites en quelques mots ce qu\'il faut préparer.'); return; }
    if (mkBrief.busy === 'ask') return;
    mkBrief.busy = 'ask';
    renderStaffCampaignsPage();
    try {
      await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'propositionCreate', centerId: state.adminCenterId || 'libramont', trigger: 'demande', brief: brief.slice(0, 300) }),
      });
      const asked = brief.slice(0, 300);
      mkBrief.askDraft = '';
      await loadMarketingBrief(true);
      // La proposition nee de CETTE demande (le serveur cite la phrase) entre
      // dans le chat, ouverte : pas besoin d'aller la chercher dans le panneau.
      const made = brVisiblePropositions().find((p) => p.trigger === 'demande' && String(p.why || '').includes(asked.slice(0, 40)));
      if (made) window.mkwShowProp(made.key, 'C\'est prêt : vous validez, rien ne part tout seul.');
      else toast('C\'est prêt : la carte arrive dans « À valider ».');
      mkwPanelReveal();
    } catch (error) {
      toast(error.message || 'La préparation a échoué : réessayez.');
    } finally {
      mkBrief.busy = '';
      scheduleCampaignsRender();
    }
  };

  /* ── Le Studio : l'atelier. Un pack complet par réseau, et la matière qui
     se fabrique est MONTRÉE (audit 4.4) : le serveur persiste chaque
     itération (quality.iterations) et le pack du jour (studioPacks) : on
     affiche les deux au lieu de les jeter. ── */
  const BR_STUDIO_CHANNELS = [{ key: 'facebook', label: 'Facebook' }, { key: 'instagram', label: 'Instagram' }, { key: 'tiktok', label: 'TikTok' }, { key: 'linkedin', label: 'LinkedIn' }];

  // Le pack du jour se recharge depuis le serveur : régénérer un pack déjà en
  // base ne repaie plus un appel IA après un simple reload (audit 4.4).
  async function loadStudioPacks(force = false) {
    if (mkBrief.studioPacksLoaded && !force) return;
    mkBrief.studioPacksLoaded = true;
    try {
      const payload = await apiRequest(`/api/ops?action=studioPacks&centerId=${encodeURIComponent(state.adminCenterId || 'libramont')}`);
      const packs = payload.packs || {};
      for (const key of Object.keys(packs)) {
        if (packs[key] && !mkBrief.studioPacks[key]) mkBrief.studioPacks[key] = packs[key];
      }
      scheduleCampaignsRender();
    } catch (error) { /* pas de pack en base : l'atelier reste vide, honnête */ }
  }

  // L'atelier : la timeline REELLE des itérations (v1 notée X, corrections,
  // v2 notée Y). La matière existe côté serveur, on l'affiche, on n'invente rien.
  function mkwStudioCraft(pack) {
    const q = pack.quality || {};
    const iterations = q.iterations || [];
    if (iterations.length < 1) return '';
    // Langage humain, pas de codes internes (verdict sceptique : « filet »,
    // « ai_1 » etaient cryptiques). Le processus reste montre : c'est la
    // demande produit (« un atelier ou l'on voit la matiere se fabriquer »).
    const label = (mode) => (mode === 'rules' ? 'modèle maison' : (String(mode) === 'ai_1' ? 'l’IA écrit' : 'l’IA réécrit'));
    const kept = (it) => (pack.generationMode === 'ai'
      ? String(it.mode).indexOf('ai') === 0 && Number(it.score) === Number(q.score)
      : it.mode === 'rules');
    const rows = iterations.map((it) => `<span class="mkw-craft-step ${kept(it) ? 'is-kept' : ''}">
      <em>${esc(label(it.mode))}</em><b>${Number(it.score) || 0}/100</b>${it.blocked ? '<i>refusée</i>' : (kept(it) ? '<i class="is-ok">retenue</i>' : '')}
    </span>`).join('<span class="mkw-craft-arrow" aria-hidden="true">&rsaquo;</span>');
    return `<div class="mkw-craft"><span class="mkw-craft-label">comment il s’est fait</span>${rows}</div>`;
  }

  function mkwStudio() {
    if (!mkBrief.studioPacksLoaded) setTimeout(() => loadStudioPacks(), 0);
    const pack = mkBrief.studioPacks[mkBrief.studioChannel] || null;
    const busy = mkBrief.studioBusy;
    const tabs = BR_STUDIO_CHANNELS.map((c) => `<button type="button" role="tab" aria-selected="${mkBrief.studioChannel === c.key}" class="mkw-net ${mkBrief.studioChannel === c.key ? 'active' : ''}" onclick="mkBrStudioChannel('${escJs(c.key)}')" ${busy ? 'disabled' : ''}>${c.label}</button>`).join('');
    const block = (label, field, text, opts) => {
      if (!text) return '';
      const o = opts || {};
      return `<div class="mkw-st-block"><div class="mkw-st-head"><span class="mkw-st-label">${esc(label)}</span>${o.note ? `<small>${esc(o.note)}</small>` : ''}<button type="button" class="mkw-link mkw-st-copy" onclick="mkBrStudioCopy('${escJs(field)}')">Copier</button></div><div class="mkw-paper ${o.mono ? 'mkw-st-mono' : ''}">${esc(text)}</div></div>`;
    };
    let body;
    if (busy) {
      // Attente honnête : UNE phrase vraie (un appel serveur unique, 10-20 s),
      // zéro étape inventée : le vrai déroulé s'affiche APRÈS, depuis les
      // itérations que le serveur a réellement faites.
      body = '<div class="mkw-paper mkw-shimmer"><p class="mkw-quiet">j’écris le pack complet, ça prend 10 à 20 secondes…</p></div>';
    } else if (!pack) {
      body = `<div class="empty-state">
        <div class="empty-state-title">L’atelier est prêt</div>
        <div class="empty-state-text">Choisissez un réseau et je fabrique le pack complet : version longue, version courte, story, idée photo, prompt d’image IA et hashtags, écrits sur l’angle du jour.</div>
      </div>`;
    } else {
      const q = pack.quality || {};
      const mode = pack.generationMode === 'ai' ? 'écrit par l’IA' : 'modèle maison (filet)';
      const badge = q.score
        ? `<p class="mkw-st-badge ${q.status === 'ready' ? 'is-ready' : 'is-review'}">${q.status === 'ready' ? 'Prêt à publier' : 'À relire avant de publier'} · note ${Number(q.score)}/100 · ${esc(mode)}${pack.theme ? ` · angle : ${esc(pack.theme)}` : ''}</p>`
        : '';
      body = `${badge}
        ${mkwStudioCraft(pack)}
        ${block('Version longue', 'long', pack.long)}
        ${block('Version courte', 'short', pack.short)}
        ${block(mkBrief.studioChannel === 'linkedin' ? 'Variante' : 'Story', 'story', pack.story)}
        ${block('Hashtags', 'hashtags', (pack.hashtags || []).join(' '))}
        ${block('Idée photo (à shooter sur place)', 'photoIdea', pack.photoIdea)}
        ${block('Prompt d’image IA', 'aiImagePrompt', pack.aiImagePrompt, { mono: true, note: 'en anglais, pour votre générateur d’images' })}
        <p class="mkw-method">Meilleur moment : ${esc(pack.bestTime || '-')}. Chaque version est notée par le contrôle qualité du centre ; la fabrication ci-dessus montre ce qui s’est réellement passé.</p>`;
    }
    return `<section class="mkw-card">
      <div class="mkw-block-head"><h3>L’atelier : écris pour chaque réseau</h3><span class="mkw-block-sub">un pack complet par réseau, sur l’angle du jour</span></div>
      <div class="mkw-st-bar">
        <div class="mkw-nets" role="tablist">${tabs}</div>
        <div class="mkw-st-gen">
          <input id="brStudioBrief" class="mkw-input" value="${esc(mkBrief.studioBrief || '')}"
            placeholder="Angle (optionnel) : « anniversaires ados », « soirée fluo »…"
            aria-label="Angle du pack à écrire" oninput="mkBrief.studioBrief = this.value">
          <button type="button" class="pv2-btn primary" onclick="mkBrStudioGen()" ${busy ? 'disabled' : ''}>${busy ? 'j’écris…' : (pack ? 'Régénérer' : 'Générer le pack')}</button>
        </div>
      </div>
      ${body}
    </section>`;
  }

  window.mkBrStudioChannel = function (key) {
    // Verrou pendant la génération (audit 4.4) : changer de canal en cours de
    // route rangeait le résultat sous le mauvais onglet.
    if (mkBrief.studioBusy) return;
    mkBrief.studioChannel = BR_STUDIO_CHANNELS.some((c) => c.key === key) ? key : 'facebook';
    renderStaffCampaignsPage();
  };
  window.mkBrStudioGen = async function () {
    if (mkBrief.studioBusy) return;
    const brief = (document.getElementById('brStudioBrief') || {}).value || mkBrief.studioBrief || '';
    // Le canal est CAPTURÉ au clic : le résultat est rangé sous le canal
    // demandé, quoi qu'il arrive pendant l'attente (audit 4.4).
    const channel = mkBrief.studioChannel;
    mkBrief.studioBrief = brief;
    mkBrief.studioBusy = true;
    renderStaffCampaignsPage();
    try {
      const payload = await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'studioGenerate', centerId: state.adminCenterId || 'libramont', platform: channel, brief }),
      });
      mkBrief.studioPacks = { ...mkBrief.studioPacks, [channel]: payload.pack };
    } catch (error) {
      toast(error.message || 'Je n’ai pas réussi à écrire le pack.');
    } finally {
      mkBrief.studioBusy = false;
      scheduleCampaignsRender();
    }
  };
  window.mkBrStudioCopy = async function (field) {
    const pack = mkBrief.studioPacks[mkBrief.studioChannel];
    if (!pack) return;
    const text = field === 'hashtags' ? (pack.hashtags || []).join(' ') : String(pack[field] || '');
    if (!text) return;
    try { await navigator.clipboard.writeText(text); toast('Copié.'); } catch (error) { toast('Copie impossible.'); }
  };

  /* ── Résultats · les reçus (mesures J+14 réelles) ── */

  function mkwReceipts() {
    const b = mkBrief.data;
    if (!b) return `<section class="mkw-card">${typeof renderThinking === 'function' ? renderThinking('searching', { label: 'Lecture des données du centre' }) : '<div class="mkw-skel"></div>'}</section>`;
    const receipts = b.receipts || [];
    const visible = mkBrief.receiptsAll ? receipts : receipts.slice(0, 5);
    const rows = visible.map((receipt) => `<div class="mkw-receipt tone-${esc(receipt.tone)}">
      <span class="mkw-receipt-label">${esc(brFrDates(receipt.label))}</span>
      <span class="mkw-receipt-fill"></span>
      <span class="mkw-receipt-val">${esc(receipt.result)}</span>
      ${receipt.redoable ? `<button type="button" class="mkw-link" onclick="mkBrRedo(${Number(receipt.id)})">On le refait ?</button>` : ''}
    </div>`).join('');
    return `<section class="mkw-card">
      <div class="mkw-block-head"><h3>Ce que ça a donné</h3><span class="mkw-block-sub">chaque publication mesurée pendant 14 jours</span></div>
      ${rows || '<p class="mkw-quiet">Je mesure chaque publication pendant 14 jours : les premiers verdicts arrivent ici.</p>'}
      ${receipts.length > 5 && !mkBrief.receiptsAll ? `<button type="button" class="mkw-link" onclick="mkBrReceiptsAll()">Tout voir (${receipts.length})</button>` : ''}
    </section>`;
  }

  window.mkBrReceiptsAll = function () {
    mkBrief.receiptsAll = true;
    renderStaffCampaignsPage();
  };
  window.mkBrRedo = async function (id) {
    try {
      await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'insightRedo', id: Number(id), centerId: state.adminCenterId || 'libramont' }),
      });
      await loadMarketingBrief(true);
      // Le clone porte due_date = aujourd'hui (serveur) : il est dans la file
      // du jour. On ne promet pas une position qu'on ne controle pas.
      toast('Je l\'ai remis dans la file d\'aujourd\'hui.');
    } catch (error) {
      toast(error.message || 'Impossible de le relancer.');
    }
  };

  /* ── Footer · Ce que je surveille (la veille) ── */

  const mkComp = { data: null, loading: false, busy: false, error: '', postBusy: false, postResult: null, postDraft: '' };
  window.mkComp = mkComp;

  // LE PLAN (Phase 4). Chargé à la demande : c'est un onglet, pas la page
  // d'accueil, donc on ne paie rien tant que le gérant ne l'ouvre pas.
  const mkPlan = { data: null, loaded: false, loading: false, busy: false, error: '', jobId: null, watcher: null, done: {} };
  window.mkPlan = mkPlan;

  async function loadMarketingPlan(force = false) {
    if (mkPlan.loading || (mkPlan.loaded && !force)) return;
    // `loaded` = une tentative a eu lieu, quel que soit son resultat. Sans ce
    // flag, un serveur qui rend un plan vide faisait boucler render -> load ->
    // render a l'infini (l'animation d'entree repartait a chaque frame et la
    // surface restait figee a opacite 0 : vu au harnais, pas en theorie).
    mkPlan.loading = true;
    mkPlan.error = '';
    try {
      const result = await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'marketingPlanGet', centerId: state.adminCenterId || 'libramont' }),
      });
      mkPlan.data = result && result.plan ? result.plan : null;
    } catch (error) {
      mkPlan.error = error.message || 'Chargement impossible.';
    } finally {
      mkPlan.loaded = true;
      mkPlan.loading = false;
      renderStaffCampaignsPage();
    }
  }

  // Construction LIVE (RUN B) : le serveur enfile le job, répond tout de
  // suite avec son id, et le composant partagé (assets/ops-progress.js)
  // affiche chaque étape que le Stratège franchit RÉELLEMENT : « je pose le
  // calendrier », « je fais rédiger le modèle », « je vérifie qu'il n'a rien
  // inventé »… Zéro étape inventée : c'est le contraire du chargement Monty.
  window.mkPlanBuild = async function () {
    if (mkPlan.busy) return;
    mkPlan.busy = true;
    mkPlan.jobId = null;
    renderStaffCampaignsPage();
    const centerId = state.adminCenterId || 'libramont';
    const finish = () => {
      if (mkPlan.watcher) { try { mkPlan.watcher.stop(); } catch (e) { /* déjà arrêté */ } mkPlan.watcher = null; }
      mkPlan.busy = false;
      mkPlan.jobId = null;
      loadMarketingPlan(true);
    };
    try {
      const result = await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'marketingPlanBuild', centerId, live: true }),
      });
      if (result && result.live && result.jobId && window.PinlaneOpsProgress) {
        mkPlan.jobId = result.jobId;
        renderStaffCampaignsPage();
        const mount = document.getElementById('mkPlanProgress');
        mkPlan.watcher = window.PinlaneOpsProgress.watchJobProgress({
          jobId: result.jobId,
          centerId,
          mount,
          onDone: () => { toast('Plan reconstruit.'); finish(); },
          onFail: () => { toast('La construction a échoué : réessaie.'); finish(); },
        });
        return;
      }
      // Repli (vieux serveur pendant la fenêtre de déploiement) : réponse
      // synchrone classique, le plan est déjà dans la réponse.
      mkPlan.data = result && result.plan ? result.plan : mkPlan.data;
      toast('Plan reconstruit.');
      mkPlan.busy = false;
      renderStaffCampaignsPage();
    } catch (error) {
      toast(error.message || 'Je n’ai pas réussi à construire le plan : réessaie.');
      mkPlan.busy = false;
      renderStaffCampaignsPage();
    }
  };
  async function loadCompetitors(force = false) {
    if (mkComp.loading || (mkComp.data && !force)) return;
    mkComp.loading = true;
    mkComp.error = '';
    try {
      const payload = await apiRequest(`/api/ops?action=competitors&centerId=${encodeURIComponent(state.adminCenterId || 'libramont')}`);
      mkComp.data = payload.competitors || [];
    } catch (error) {
      // Audit §2 : l'erreur était avalée (data = []) et COLLANTE : un échec
      // réseau s'affichait « aucun concurrent » pour toute la session. Une
      // erreur réseau se dit, et data reste null pour permettre le retry.
      mkComp.data = null;
      mkComp.error = error.message || 'Je n\'arrive pas à charger la veille.';
    } finally {
      mkComp.loading = false;
      scheduleCampaignsRender();
    }
  }
  window.loadCompetitors = loadCompetitors;

  window.mkCompSave = async function () {
    if (mkComp.busy) return;
    const name = (document.getElementById('brCompName') || {}).value || '';
    const websiteUrl = (document.getElementById('brCompSite') || {}).value || '';
    if (!name.trim()) { toast('Indiquez au moins le nom du concurrent.'); return; }
    mkComp.busy = true;
    renderStaffCampaignsPage();
    try {
      await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'competitorSave', centerId: state.adminCenterId || 'libramont', competitor: { name, websiteUrl } }),
      });
      toast('Je le surveille : première inspection cette nuit.');
      mkComp.data = null;
    } catch (error) {
      toast(error.message || 'Ajout impossible.');
    } finally {
      mkComp.busy = false;
      loadCompetitors(true);
    }
  };
  window.mkCompDelete = async function (id) {
    if (mkComp.busy) return;
    mkComp.busy = true;
    try {
      await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'competitorDelete', centerId: state.adminCenterId || 'libramont', id: Number(id) }),
      });
      mkComp.data = (mkComp.data || []).filter((competitor) => Number(competitor.id) !== Number(id));
    } catch (error) {
      toast(error.message || 'Suppression impossible.');
    } finally {
      mkComp.busy = false;
      scheduleCampaignsRender();
    }
  };

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

  window.pv2CampImprove = async function (button) {
    if (!pv2Camp.form.subject.trim() && !pv2Camp.form.body.trim()) {
      if (typeof toast === 'function') toast('Écrivez d\'abord un objet ou un message.');
      return;
    }
    if (button) button.disabled = true;
    try {
      const payload = await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'improveEmailWithAi', centerId: state.adminCenterId || 'libramont', subject: pv2Camp.form.subject, body: pv2Camp.form.body, category: 'marketing' }),
      });
      if (payload.mode === 'ia' && payload.subject && payload.body) {
        pv2Camp.form.subject = payload.subject;
        pv2Camp.form.body = payload.body;
        if (typeof toast === 'function') toast('Contenu réécrit par l\'IA : relis avant envoi.');
      } else if (typeof toast === 'function') {
        toast(`Conseils : ${(payload.tips || []).slice(0, 2).join(' · ')}`);
      }
    } catch (error) {
      if (typeof toast === 'function') toast(error.message || 'Analyse impossible.');
    } finally {
      if (button) button.disabled = false;
      renderStaffEmailsPage();
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
      if (typeof toast === 'function') toast("Audience en cours de calcul : attends le nombre de destinataires avant d'envoyer.");
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

  function renderPv2RealCampaigns() {
    // UN BLOC QU ON N A PAS LE DROIT DE CHARGER NE S AFFICHE PAS (2026-08-19).
    // La page Emails est ouverte a « emails.view », que le role Manager a ;
    // les campagnes exigent « campaigns.manage », qu il n a pas. Le bloc
    // partait donc chercher ses donnees, prenait un 403 et affichait
    // « Permission insuffisante » PAR-DESSUS une liste vide (capture Movsar).
    // Regle DESIGN.md 9 : un bouton mene a une action reelle, ou il n existe
    // pas. Ici le serveur reste la seule autorite : il refuse toujours.
    if (typeof canUseStaffPermission === 'function' && !canUseStaffPermission('campaigns.manage')) return '';
    if (!pv2Camp.loaded && !pv2Camp.loading && !pv2Camp.error) setTimeout(() => loadPv2Campaigns(), 0);
    const segLabel = (id) => (pv2Camp.segments.find((s) => s.id === id) || {}).label || id;

    const list = pv2Camp.campaigns.length ? `<table class="pv2-table">
      <thead><tr><th>Campagne</th><th>Segment</th><th>Statut</th><th class="num">Cibles</th><th class="num">Envoyés</th><th class="num">Échecs</th><th class="num">En attente</th><th>Suivi</th><th></th></tr></thead>
      <tbody>${pv2Camp.campaigns.map((c) => {
        const [label, tone] = PV2_CAMP_STATUS[c.status] || [c.status, ''];
        return `<tr>
          <td><strong>${esc(c.name)}</strong>${c.scheduledAt && c.status === 'scheduled' ? `<small style="display:block;color:var(--v2-text-3)">le ${new Date(c.scheduledAt).toLocaleString('fr-BE', { dateStyle: 'short', timeStyle: 'short' })}</small>` : ''}</td>
          <td>${esc(segLabel(c.segment))}</td>
          <td><span class="pv2-chip ${tone}">${label}</span></td>
          <td class="num">${c.recipientCount}</td>
          <td class="num">${c.sent}</td>
          <td class="num">${c.failed}</td>
          <td class="num">${c.queued}</td>
          <td><small style="color:var(--v2-text-3)">ouvertures/clics : non suivis</small></td>
          <td style="white-space:nowrap">
            <button type="button" class="pv2-btn" onclick="pv2CampExportContent(${c.id})">Contenu</button>
            ${c.status === 'draft' ? `<button type="button" class="pv2-btn" onclick="pv2CampEditDraft(${c.id})">Éditer</button><button type="button" class="pv2-btn primary" onclick="pv2CampSendDraft(${c.id})">Envoyer</button>` : ''}
            ${['scheduled', 'sending'].includes(c.status) && c.queued > 0 ? `<button type="button" class="pv2-btn" onclick="pv2CampCancel(${c.id})">Annuler</button>` : ''}
            ${c.status === 'draft' ? `<button type="button" class="pv2-btn" onclick="pv2CampCancel(${c.id})">Supprimer</button>` : ''}
          </td>
        </tr>`;
      }).join('')}</tbody>
    </table>` : `<div class="pv2-empty"><strong>${pv2Camp.loading ? 'Chargement…' : 'Aucune campagne'}</strong>${pv2Camp.loading ? '' : 'Créez la première : ciblage réel depuis votre base clients.'}</div>`;

    const form = pv2Camp.formOpen ? (() => {
      const f = pv2Camp.form;
      const audience = pv2Camp.audience[f.segment];
      const audienceLabel = pv2Camp.audienceLoading === f.segment
        ? 'calcul…'
        : audience ? `${plural(audience.count, 'destinataire', 'destinataires')}${audience.sample?.length ? ` · ex : ${audience.sample.slice(0, 3).join(', ')}` : ''}` : '-';
      return `<div class="ms-viewer"><div class="ms-form">
        ${pv2Camp.editingId ? '<div class="ms-form-note">Édition du brouillon : enregistrez vos modifications, ou envoyez-le directement.</div>' : ''}
        <div class="ms-grid-2">
          <label class="ms-field"><span>Nom de la campagne *</span><input type="text" class="ms-input" value="${esc(f.name)}" oninput="pv2Camp.form.name = this.value"></label>
          <label class="ms-field"><span>Objectif</span><input type="text" class="ms-input" placeholder="Ex : remplir les mardis soirs" value="${esc(f.objective)}" oninput="pv2Camp.form.objective = this.value"></label>
        </div>
        <div class="ms-grid-2">
          <label class="ms-field"><span>Segment (base clients réelle)</span>
            <select class="ms-input" onchange="pv2CampSegmentChanged(this.value)">${pv2Camp.segments.map((s) => `<option value="${s.id}" ${f.segment === s.id ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select>
          </label>
          <div class="ms-field"><span>Audience</span>
            <div class="ms-input" style="display:flex;align-items:center;justify-content:space-between;gap:8px"><span>${esc(audienceLabel)}</span>
              <button type="button" class="pv2-btn" onclick="pv2CampExportRecipients('${f.segment}')">Exporter la liste</button></div>
          </div>
        </div>
        <label class="ms-field"><span>Objet *</span><input type="text" class="ms-input" maxlength="150" value="${esc(f.subject)}" oninput="pv2Camp.form.subject = this.value"></label>
        <label class="ms-field"><span>Message * <em>({{prenom}} et {{nom}} remplacés par les vraies valeurs à l'envoi)</em></span>
          <textarea class="ms-input ms-body" rows="8" oninput="pv2Camp.form.body = this.value">${esc(f.body)}</textarea></label>
        <div class="ms-grid-2">
          <label class="ms-field"><span>Programmer (optionnel)</span><input type="datetime-local" class="ms-input" value="${esc(f.scheduledAt)}" onchange="pv2Camp.form.scheduledAt = this.value"></label>
          <div></div>
        </div>
        <div class="ms-actions">
          <button type="button" class="pv2-btn" onclick="pv2CampImprove(this)">Améliorer avec l'IA</button>
          <button type="button" class="pv2-btn" onclick="pv2CampSubmit('draft', this)" ${pv2Camp.busy ? 'disabled' : ''}>${pv2Camp.editingId ? 'Enregistrer les modifications' : 'Enregistrer brouillon'}</button>
          <span class="ms-actions-spacer"></span>
          <button type="button" class="pv2-btn" onclick="pv2CampSubmit('schedule', this)" ${pv2Camp.busy ? 'disabled' : ''}>Programmer</button>
          <button type="button" class="pv2-btn primary" onclick="pv2CampSubmit('now', this)" ${pv2Camp.busy ? 'disabled' : ''}>Envoyer maintenant</button>
          <button type="button" class="pv2-btn" onclick="pv2CampCloseForm()">Fermer</button>
        </div>
      </div></div>`;
    })() : '';

    /* Zéro campagne occupait un bloc plein (titre, deux boutons, grand vide
       centré) : autant de hauteur qu'une section pleine, pour dire « il n'y a
       rien ». Tant qu'il n'y a rien à montrer et rien d'ouvert, la section se
       replie sur une seule ligne qui garde l'entrée en main. Dès qu'une
       campagne existe, ou que le formulaire est ouvert, elle reprend sa
       taille normale. */
    const isIdleEmpty = !pv2Camp.error && !form && !pv2Camp.loading && !(pv2Camp.campaigns || []).length;
    if (isIdleEmpty) {
      return `<section class="pv2-panel pv2-camp-slim">
        <div class="pv2-camp-slim-row">
          <div>
            <strong>Campagnes email</strong>
            <span>Aucune campagne. Le ciblage se fait sur votre base clients réelle.</span>
          </div>
          <button type="button" class="pv2-btn sm" onclick="pv2CampOpenForm()">Créer la première</button>
        </div>
      </section>`;
    }
    return `<section class="pv2-panel">
      <div class="pv2-panel-head">
        <h2>Campagnes email : ciblage réel</h2>
        <div style="display:flex;gap:8px;align-items:center">
          ${pv2Camp.channel && pv2Camp.channel.resendConfigured === false ? '<small style="color:var(--warning)">canal d\'envoi à configurer, les envois restent en file</small>' : ''}
          <button type="button" class="pv2-btn sm ghost" onclick="loadPv2Campaigns(true)">Actualiser</button>
          <button type="button" class="pv2-btn primary" onclick="pv2CampOpenForm()">+ Nouvelle campagne</button>
        </div>
      </div>
      <div class="pv2-panel-body">
        ${pv2Camp.error
    ? `<div class="pv2-empty"><strong>${esc(pv2Camp.error)}</strong><button type="button" class="pv2-btn" onclick="loadPv2Campaigns(true)">Réessayer</button></div>`
    : `${form}${list}`}
      </div>
    </section>`;
  }

  /* ══════════════════════════════════════════════════════════════════════
     MARKETING : 5 surfaces (refonte 2026-07-16 « machine de guerre »)
     Aujourd'hui · Ce qui marche · Studio · Concurrents · Résultats.
     Même contrat de données (marketingBrief), mêmes handlers d'action ;
     on recatégorise et on élève le craft. Les nouvelles surfaces
     dégradent proprement si le champ n'existe pas encore (honnêteté :
     l'analyse causale profonde arrive en Phase 1 backend).
     ══════════════════════════════════════════════════════════════════════ */

  // LE BUREAU (refonte 2026-08-06) : la maison est le bureau de l'agent
  // (fil + tableau d'actions), PAS un onglet. Les 4 profondeurs répondent
  // chacune à UNE question : Plan (que prévoir), Créations (fabriquer),
  // Marché (qui me prend des clients), Impact (qu'est-ce que ça a rapporté).
  // Les CLÉS internes ne bougent pas (handlers, deep-links, tests) : seuls
  // les libellés portent la nouvelle lecture.
  const MKW_TABS = [
    { key: 'feed', label: 'Bureau' },
    { key: 'plan', label: 'Plan' },
    { key: 'studio', label: 'Créations' },
    { key: 'rivals', label: 'Marché' },
    { key: 'results', label: 'Impact' },
  ];
  // Les entrées de profondeur du rail (tout sauf la maison bureau).
  const MKW_DEPTH = MKW_TABS.filter((t) => t.key !== 'feed');

  window.mkwTab = function (key) {
    if (!MKW_TABS.some((t) => t.key === key)) return;
    if (mkBrief.tab === key) return;
    mkBrief.tab = key;
    if (key === 'rivals' && typeof loadCompetitors === 'function') loadCompetitors();
    // L'entrée en scène de la vue est gérée une-fois-par-navigation par le
    // render (classe mkw-in calculée sur le changement d'onglet) : plus de
    // toggle manuel qui rejouait le fade à chaque clic in-view.
    renderStaffCampaignsPage();
  };

  // Le mark de l'agent : une identité, pas juste du texte gris (SVG inline,
  // couleur accent, respire « présent »).
  function mkwAgentMark() {
    return `<span class="mkw-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.2L19 10l-5.1 1.8L12 17l-1.9-5.2L5 10l5.1-1.8z"/></svg></span>`;
  }

  // L'en-tête d'accueil (langage Vercel « Agent ») : fil d'Ariane discret,
  // grande identité de l'agent + pastille d'état vivant, une phrase mutée qui
  // dit ce qu'il fait, et un « En savoir plus » qui déplie (vraie révélation,
  // jamais un lien mort : Product Rule §9). La texture de points vit derrière.
  // Le path de la marque (meme dessin que mkwAgentMark) : reutilise tel quel
  // par le champ de particules pour que la texture PORTE l'identite de la page
  // au lieu d'etre un decor generique.
  const MKW_MARK_PATH = 'M12 3l1.9 5.2L19 10l-5.1 1.8L12 17l-1.9-5.2L5 10l5.1-1.8z';

  // <section> et JAMAIS <header> : en mode console, la regle
  // `body.staff-mode header { width: 0; height: 0 }` (elle masque l'en-tete du
  // site public) ecrasait TOUT ce bloc a hauteur zero. Le titre, la pastille
  // d'etat et la description etaient donc invisibles en production depuis la
  // refonte du 2026-07-18 : la page Marketing s'ouvrait sur des onglets nus.
  // Mesure : getBoundingClientRect().height === 0 sur .mkw-head. Le piege est
  // documente dans 6 autres fichiers du bundle ; un gate le verrouille
  // maintenant pour tout le monde (scripts/no-header-tag-check.js).
  // L'en-tete est UNE ligne : identite a gauche, les 4 profondeurs et le
  // bouton du panneau a droite. Le rail « Profondeur » d'hier etait une rangee
  // de plus entre le gerant et le chat : mort (retour Movsar du 2026-08-06,
  // « c'est moche quand c'est place comme ca »).
  function mkwHead() {
    const centre = typeof window.staffCenterDisplayName === 'function' ? window.staffCenterDisplayName() : '';
    const depth = MKW_DEPTH.map((t) => `<button type="button" class="mkw-head-link ${mkBrief.tab === t.key ? 'active' : ''}" aria-current="${mkBrief.tab === t.key ? 'page' : 'false'}" onclick="mkwTab('${t.key}')">${esc(t.label)}</button>`).join('');
    return `<section class="mkw-head">
      <div class="mkw-head-id">
        <span class="mkw-head-mark"><canvas id="mkwMarkFx" class="mkw-mark-fx" aria-hidden="true"></canvas></span>
        <div class="mkw-head-main">
          <div class="mkw-head-titlerow">
            <h1 class="mkw-head-title">Marketing</h1>
            <span class="mkw-head-badge"><span class="mkw-live" aria-hidden="true"></span>analyse chaque matin</span>
          </div>
          <p class="mkw-head-desc">${centre ? `L'employé marketing de <strong>${esc(centre)}</strong>. ` : ''}Vous validez, rien ne part tout seul.</p>
        </div>
        <nav class="mkw-head-nav" aria-label="Vues de profondeur Marketing">
          <span class="mkw-head-links">${depth}</span>
          <span class="mkw-head-navsep" aria-hidden="true"></span>
          <button type="button" class="mkw-panel-toggle ${mkw.panelOpen ? 'is-open' : ''}" aria-expanded="${mkw.panelOpen}" aria-label="${mkw.panelOpen ? 'Fermer le panneau des tâches' : 'Ouvrir le panneau des tâches'}" onclick="mkwPanelToggle()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/></svg>
          </button>
        </nav>
      </div>
    </section>`;
  }
  // (mkwPanelToggle vit plus bas, avec la feuille mobile : la sortie animee
  // doit jouer AVANT le retrait.)

  /* ══════════════════════════════════════════════════════════════════════
     LE CHAT (v2 chat-first, retour Movsar 2026-08-06 : « comme un chat type
     ChatGPT ou Claude, clean, épuré ») : le centre est une CONVERSATION
     LIBRE. Vide, elle s'ouvre comme Claude : grand bonjour + composer
     centre. Ensuite : bulles du gerant a droite, reponses de l'agent en
     texte nu a gauche. TOUT l'operationnel (taches, radar, veille) vit dans
     le panneau lateral fermable. Chaque contenu reste un OBJET REEL ou une
     reponse assemblee du bundle : zero theatre, zero chiffre invente.
     ══════════════════════════════════════════════════════════════════════ */

  // Ouvrir Marche AVEC l'intention : le concurrent nomme arrive surligne.
  window.mkwGoRival = function (name) {
    mkw.focusRival = String(name || '');
    if (typeof loadCompetitors === 'function') loadCompetitors();
    mkwSheetAutoClose();
    mkBrief.tab = 'rivals';
    renderStaffCampaignsPage();
  };

  // ── L'historique du chat est PERSONNEL (demande Movsar 2026-08-06) ────────
  // Chaque code d'acces a SA conversation : la cle de stockage porte le centre
  // ET le membre connecte. Un directeur ne voit jamais le fil d'un employe.
  // Limite honnete : stockage local du poste (aucun endpoint de conversation
  // n'existe cote serveur) : l'historique suit le compte sur CE navigateur ;
  // la synchro entre appareils demandera une table serveur, a valider.
  const MKW_CHAT_KINDS = new Set(['qa', 'prop']);
  function mkwChatKey() {
    const member = (typeof getStaffSessionMemberId === 'function' && getStaffSessionMemberId()) || 'poste';
    return `pinlane-mkchat:${state.adminCenterId || 'libramont'}:${member}`;
  }
  function mkwChatSave() {
    // Les drapeaux d'animation (answerFresh, pendingAnswer) sont un etat de
    // SEANCE : jamais persistes, sinon un historique restaure rejouerait des
    // entrees ou garderait une question sans reponse.
    const clean = mkw.thread.slice(-30).map((t) => {
      const { answerFresh, pendingAnswer, ...rest } = t;
      return rest;
    }).filter((t) => !t.pendingAnswer);
    try { localStorage.setItem(mkwChatKey(), JSON.stringify(clean)); } catch (error) { /* stockage plein ou prive : le chat reste en memoire */ }
  }
  function mkwChatLoad() {
    let stored = [];
    try { stored = JSON.parse(localStorage.getItem(mkwChatKey()) || '[]'); } catch (error) { stored = []; }
    mkw.thread = Array.isArray(stored) ? stored.filter((t) => t && MKW_CHAT_KINDS.has(t.kind)) : [];
    // Un historique RESTAURE ne rejoue pas trente entrees : seuls les tours
    // qui naitront apres ce chargement s'animeront.
    mkw.painted = mkw.thread.length;
  }
  window.mkwChatClear = function () {
    mkw.thread = [];
    mkw.painted = 0;
    mkwChatSave();
    // L'accueil se REDEPLOIE (mkw-in rejoue) : repartir de zero se voit.
    mkwPrevTab = null;
    renderStaffCampaignsPage();
  };

  // Le message d'ouverture : le brief du matin, en TEXTE de chat (pas une
  // carte-dashboard). Les chemins (Impact, Marche) sont des liens de fin de
  // message, comme un agent qui pointe du doigt.
  function mkwChatBriefTurn() {
    const b = mkBrief.data;
    if (!b || !b.brief) return '';
    const date = esc(new Date(b.generatedAt).toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' }));
    const changed = (b.veille && b.veille.changed) || [];
    const links = [
      changed.length ? `<button type="button" class="mkw-link" onclick="mkwGoRival('${escJs(changed[0].name)}')">Voir ${esc(changed[0].name)} dans Marché</button>` : '',
      `<button type="button" class="mkw-link" onclick="mkwTab('results')">Voir Impact</button>`,
    ].filter(Boolean).join('');
    return `<article class="mkw-msg is-agent">
      <div class="mkw-msg-head">${mkwAgentMark()}<b>Le brief du ${date}</b></div>
      ${b.brief.degraded ? '<p class="mkw-degraded">Mode simple ce matin : les chiffres sont exacts, les phrases moins polies.</p>' : ''}
      <p class="mkw-msg-text">${brProse(b.brief.text)}</p>
      <div class="mkw-msg-links">${links}</div>
    </article>`;
  }

  // Les tours de session, TYPES :
  //  : 'qa'   -> question du gerant + reponse assemblee (source dite) ;
  //  : 'prop' -> une proposition invitee DANS le chat (clic panneau ou
  //              creation) : la carte-atelier complete, memes handlers ;
  //  : le pending honnete pendant un Creer (une requete reelle en vol).
  function mkwChatTurns() {
    // L'entree n'est jouee QUE par les tours nes depuis le dernier paint
    // absorbe (index >= painted) : la bulle du gerant part la premiere, la
    // reponse suit en cascade (retard par position dans la fournee).
    let freshRank = 0;
    const inCls = (index) => {
      if (index < mkw.painted) return { cls: '', style: '' };
      const delay = Math.min(freshRank, 3) * 110;
      freshRank += 1;
      return { cls: ' is-in', style: delay ? ` style="animation-delay:${delay}ms"` : '' };
    };
    const turns = mkw.thread.map((t, index) => {
      if (t.kind === 'prop') {
        const p = brVisiblePropositions().find((item) => item.key === t.key);
        if (!p) return '';
        const introIn = inCls(index);
        const cardIn = t.intro ? inCls(index) : introIn;
        return `${t.intro ? `<article class="mkw-msg is-agent${introIn.cls}"${introIn.style}><div class="mkw-msg-head">${mkwAgentMark()}<b>${esc(t.intro)}</b></div></article>` : ''}
          <div class="mkw-msg is-agent mkw-msg-prop${cardIn.cls}"${cardIn.style}>${mkwPropCard(p)}</div>`;
      }
      const userIn = t.answerFresh ? { cls: '', style: '' } : inCls(index);
      // Pendant l'assemblage, seul le tour du gerant existe : la reponse
      // arrive au tour suivant, avec sa propre entree.
      if (t.pendingAnswer) {
        // `is-sent` : la bulle du gerant monte et s'installe. Appuyer sur Entree
        // ne produisait aucun signal, donc rien ne disait que la touche avait
        // ete prise en compte.
        return `<article class="mkw-msg is-user mkw-turn-q is-sent${userIn.cls}"${userIn.style}><div class="mkw-msg-user">${esc(t.q)}</div></article>`;
      }
      const agentIn = t.answerFresh ? { cls: ' is-in', style: '' } : inCls(index);
      const facts = (t.facts || []).map((f) => `<span class="mkw-ans-fact">${brProse(f)}</span>`).join('');
      const acts = (t.actions || []).map((a, i) => `<button type="button" class="${i === 0 ? 'pv2-btn primary' : 'mkw-link'}" onclick="${a.js}">${esc(a.label)}</button>`).join('');
      return `<article class="mkw-msg is-user${userIn.cls}"${userIn.style}><div class="mkw-msg-user">${esc(t.q)}</div></article>
      <article class="mkw-msg is-agent mkw-turn-answer${agentIn.cls}"${agentIn.style}>
        <div class="mkw-msg-head">${mkwAgentMark()}<b>${esc(t.title)}</b></div>
        ${t.reco ? `<p class="mkw-ans-reco">${brProse(t.reco)}</p>` : ''}
        ${t.why ? `<p class="mkw-ans-why">${brProse(t.why)}</p>` : ''}
        ${facts ? `<div class="mkw-ans-facts">${facts}</div>` : ''}
        ${acts ? `<div class="mkw-prop-actions">${acts}</div>` : ''}
        <p class="mkw-ans-src">${esc(t.source || 'assemblé depuis le brief du matin, sans invention')}</p>
      </article>`;
    }).join('');
    // L'ETAT DE TRAVAIL (demande Movsar : « voir l'IA reflechir », facon
    // Claude : la marque qui pulse + le verbe qui shimmer). Le verbe est
    // toujours VRAI : « J'écris le post » pendant la requete reelle du mode
    // Creer ; « J'assemble depuis le brief » pendant l'assemblage local d'une
    // reponse. Il disparait DES que le resultat entre : jamais un spinner qui
    // tourne pour rien.
    // LES ETAPES DU TRAVAIL REEL, PAS UN VERBE FIGE. Le mot d'etat disait
    // « J'écris le post » pendant toute l'attente, du premier au dernier
    // milliseconde : vrai a la fin, faux au debut, ou l'agent lit encore les
    // donnees. Les etapes suivent l'ordre du cycle, et elles different selon le
    // mode : « Créer » produit un livrable, « Demander » assemble une reponse.
    // Rien n'est invente : chaque libelle nomme une phase que le code execute.
    const stateWord = mkBrief.busy === 'ask' ? 'J\'écris le post' : mkw.stateWord;
    const pending = stateWord
      ? `<article class="mkw-msg is-agent is-state is-in" role="status" aria-busy="true">${
        typeof renderThinkingSteps === 'function'
          ? renderThinkingSteps(mkwEtapesPour(mkwDerniereDemande(), mkBrief.busy === 'ask' ? 'creer' : 'demander'))
          : `<div class="mkw-msg-head">${mkwAgentMark()}<b class="mkw-state-word">${esc(stateWord)}</b></div>`
      }</article>`
      : '';
    return turns + pending;
  }

  // Inviter une proposition DANS le chat (depuis le panneau, une reponse, ou
  // apres une creation) : c'est l'agent qui « montre son travail », ouvert.
  window.mkwShowProp = function (key, intro) {
    const p = brVisiblePropositions().find((item) => item.key === key);
    if (!p) return;
    const last = mkw.thread[mkw.thread.length - 1];
    if (!(last && last.kind === 'prop' && last.key === key)) {
      mkw.thread.push({ kind: 'prop', key, intro: intro || '' });
      if (mkw.thread.length > 14) mkw.thread.shift();
      mkwChatSave();
    }
    mkBrief.openCard = key;
    mkBrief.publishedAsk = null;
    mkBrief.angleOpen = null;
    mkBrief.tab = 'feed';
    mkwSheetAutoClose();
    renderStaffCampaignsPage();
    mkwScrollChatEnd();
    const network = mkBrief.cardNetwork[key] || p.network;
    if (network && p.kind !== 'email' && !(p.networks || {})[network]) window.mkBrNetwork(key, network, true);
  };

  function mkwScrollChatEnd() {
    setTimeout(() => {
      const msgs = document.querySelectorAll('#staffCampaignsPage .mkw-chat-thread .mkw-msg');
      const last = msgs[msgs.length - 1];
      if (last) last.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'nearest' });
    }, 80);
  }

  // ── Le moteur de reponse (deterministe, borne, honnete) ──────────────────
  const MKW_DAY_WORDS = { lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6, dimanche: 0 };
  function mkwFindRadarDay(question) {
    const b = mkBrief.data;
    if (!b || !b.radar) return null;
    const q = question.toLowerCase();
    const m = q.match(/(\d{1,2})\/(\d{1,2})/);
    if (m) {
      const dd = m[1].padStart(2, '0');
      const mm = m[2].padStart(2, '0');
      return b.radar.find((d) => d.date.slice(5) === `${mm}-${dd}`) || null;
    }
    if (/demain/.test(q)) return b.radar[1] || null;
    if (/week[- ]?end/.test(q)) return b.radar.find((d, i) => i > 0 && (d.dow === 6 || d.dow === 0)) || null;
    for (const [word, dow] of Object.entries(MKW_DAY_WORDS)) {
      if (q.includes(word)) return b.radar.find((d, i) => i > 0 && d.dow === dow) || null;
    }
    return null;
  }

  function mkwAnswer(question) {
    const b = mkBrief.data;
    const q = question.toLowerCase();
    if (!b) {
      return { q: question, title: 'Le brief n\'est pas chargé', reco: 'Rechargez la page : sans le brief du matin, je n\'ai rien de fiable à vous répondre.', facts: [], actions: [], source: 'aucune donnée chargée' };
    }
    const day = mkwFindRadarDay(question);
    if (day) {
      const basket = b.pulse && b.pulse.avgBasket > 0 ? b.pulse.avgBasket : 0;
      const isQuiet = day.level === 'creux' || day.level === 'calme';
      const facts = [
        day.resaCount ? `${day.resaCount} personnes déjà posées ce jour-là` : 'aucune réservation posée pour l\'instant',
        day.tmax !== null && day.tmax !== undefined ? `${Math.round(day.tmax)}° annoncés` : '',
        day.event ? day.event : '',
        isQuiet && basket ? `panier moyen mesuré : ${money(basket)} par visiteur` : '',
      ].filter(Boolean).slice(0, 4);
      const linked = day.propositionKey && brVisiblePropositions().some((p) => p.key === day.propositionKey);
      const actions = [];
      if (linked) actions.push({ label: 'Voir la proposition prête', js: `mkBrGoCard('${escJs(day.propositionKey)}')` });
      else if (isQuiet) actions.push({ label: 'Préparer un post pour ce jour', js: `mkBrRadarFill('${escJs(day.date)}')` });
      return {
        q: question,
        title: `${cap(brFrDay(day.date))} : ce que je vois`,
        reco: day.explanation,
        why: isQuiet && basket ? `Chaque visiteur récupéré ce jour-là vaut environ ${money(basket)} (votre panier moyen mesuré sur 30 jours).` : '',
        facts,
        actions,
        source: 'assemblé depuis le radar du matin (météo, réservations posées, calendrier)',
      };
    }
    // La veille se reconnait aussi par le NOM d'un concurrent qui a bouge
    // (« Que fait Bowling Arlon ? ») : le mot-cle seul ratait la question la
    // plus naturelle du gerant.
    const changedNames = ((b.veille && b.veille.changed) || []).map((c) => String(c.name || '').toLowerCase()).filter(Boolean);
    if (/(concurrent|march[eé]|rival|en face)/.test(q) || changedNames.some((n) => q.includes(n))) {
      const v = b.veille || {};
      const changed = v.changed || [];
      return {
        q: question,
        title: changed.length ? 'Du mouvement chez vos concurrents' : 'Rien de neuf chez vos concurrents',
        reco: changed.length ? `${changed[0].name} : ${changed[0].diff}` : `${Number(v.count) || 0} concurrent${(Number(v.count) || 0) > 1 ? 's' : ''} sous surveillance, aucun changement détecté ce matin.`,
        facts: changed.slice(1, 4).map((c) => `${c.name} : ${c.diff}`),
        actions: [{ label: 'Ouvrir Marché', js: changed.length ? `mkwGoRival('${escJs(changed[0].name)}')` : "mkwTab('rivals')" }],
        source: 'assemblé depuis la veille de ce matin (sites inspectés + note Google)',
      };
    }
    if (/(rapport[eé]|r[eé]sultat|impact|combien|euros?|chiffre)/.test(q)) {
      const p = b.paie || {};
      const reco = p.available === false ? 'Mesure indisponible. Réessayez depuis Impact.' : p.young ? `Encore trop tôt pour un chiffre honnête : premier bilan le ${p.firstVerdictDate || ''}.`
        : (p.euros > 0 ? `${money(p.euros)} de visites honorées liées à vos messages sur ${p.days} jours.` : `${p.sent || 0} messages partis sur ${p.days} jours : aucune visite honorée ne leur est encore liée.`);
      return {
        q: question,
        title: 'Ce que le marketing a rapporté',
        reco,
        facts: p.available === false || p.young ? [] : [`${p.venues || 0} visites honorées`, `${p.sent || 0} messages envoyés`],
        actions: [{ label: 'Ouvrir Impact (le détail et les reçus)', js: "mkwTab('results')" }],
        source: 'assemblé depuis la mesure réelle (visites honorées, jamais les annulées ni les à-venir)',
      };
    }
    if (/(plan|semaines?|prochain(s|es)? mois)/.test(q)) {
      const weeks = (mkPlan.data && mkPlan.data.weeks) || [];
      const dated = weeks.filter((w) => w.confiance !== 'routine').length;
      return {
        q: question,
        title: 'L\'horizon des prochaines semaines',
        reco: weeks.length ? `${weeks.length} semaines posées, dont ${dated} avec une date certaine à jouer (congés, fériés, événements).` : 'Le plan se construit chaque lundi : ouvrez-le, il se génère à la demande si besoin.',
        facts: weeks.slice(0, 3).map((w) => `S${w.index} : ${w.objectif}`),
        actions: [{ label: 'Ouvrir Plan', js: "mkwTab('plan')" }],
        source: weeks.length ? 'assemblé depuis le plan réel (calendrier vérifié, rien d\'inventé)' : 'le plan n\'est pas encore chargé',
      };
    }
    if (/(pluie|m[eé]t[eé]o|chaud|chaleur|soleil)/.test(q)) {
      const rain = (b.radar || []).filter((d) => d.precipMm !== null && d.precipMm >= 8).slice(0, 2);
      const heat = (b.radar || []).filter((d) => d.tmax !== null && d.tmax >= 25).slice(0, 2);
      const w = b.facts && b.facts.weather;
      const facts = [
        ...rain.map((d) => `pluie ${brFrDay(d.date)} (${Math.round(d.precipMm)} mm)`),
        ...heat.map((d) => `chaleur ${brFrDay(d.date)} (${Math.round(d.tmax)}°)`),
      ].slice(0, 4);
      return {
        q: question,
        title: 'La météo des 14 prochains jours',
        reco: facts.length ? 'Voilà les jours à jouer côté météo.' : 'Rien de marquant côté météo sur les 14 prochains jours.',
        why: w && w.rainEffectPct !== null ? `Chez vous, la pluie a un effet mesuré de ${mkwSignedPct(w.rainEffectPct)} sur la fréquentation (${w.sampleDays} jours de recul, confiance ${(MKW_CONF[w.confidence] || MKW_CONF.exploratoire).label}).` : 'Je n\'ai pas encore assez de recul pour chiffrer l\'effet météo chez vous.',
        facts,
        actions: [],
        source: 'assemblé depuis le radar du matin et les effets mesurés du centre',
      };
    }
    if (/(formule|anniversaire|prix|offre|promo|tarif)/.test(q)) {
      const f = b.facts || {};
      const facts = [
        f.bestDay ? `votre meilleur jour : ${f.bestDay.label} (${f.bestDay.avgVisitors} visiteurs en moyenne)` : '',
        f.worstDay ? `votre jour le plus creux : ${f.worstDay.label}` : '',
        (b.patterns || []).length ? `${b.patterns.length} contexte${b.patterns.length > 1 ? 's' : ''} déjà mesuré${b.patterns.length > 1 ? 's' : ''} (dans Impact)` : '',
      ].filter(Boolean);
      return {
        q: question,
        title: 'Changer une formule : ce que je sais, ce que je ne sais pas',
        reco: 'Je ne devine jamais un prix ni une formule : c\'est votre décision. Ce que je sais faire, c\'est la plus petite expérience pour la tester.',
        why: `Le chemin honnête : vous décidez l'offre, je prépare le post, vous le publiez, et je mesure l'effet réel pendant 14 jours (le reçu arrive dans Impact).${(b.dataDays || 0) < 90 ? ` Il me faut environ 90 jours de données pour attribuer un effet avec certitude ; j'en ai ${b.dataDays || 0}.` : ''}`,
        facts,
        actions: [{ label: 'Me faire préparer le post de test', js: 'mkwPrefillCreate()' }],
        source: 'assemblé depuis vos journées mesurées, sans rien promettre',
      };
    }
    return {
      q: question,
      title: 'Je ne sais pas encore analyser ça librement',
      reco: 'Je réponds sur : un jour précis, la météo, les concurrents, le plan, ce que ça rapporte, ou une formule à tester. Pour un livrable (post, email, offre), passe en mode Créer : je le prépare pour de vrai.',
      facts: [],
      actions: [{ label: 'Passer en mode Créer', js: 'mkwPrefillCreate()' }],
      source: 'aucune invention : je préfère vous dire ce que je ne sais pas',
    };
  }

  // Bascule douce Demander -> Creer en gardant la phrase tapee.
  window.mkwPrefillCreate = function () {
    mkw.mode = 'creer';
    renderStaffCampaignsPage();
    setTimeout(() => { const el = document.getElementById('brAskInput'); if (el) el.focus(); }, 60);
  };

  // Les seules suites d'ecran que l'agent peut proposer. Liste FERMEE : le
  // serveur ne rend qu'une cle, jamais du JS. Un modele qui inventerait une
  // action inconnue n'en obtient aucune, il ne fait pas apparaitre un bouton
  // vers un ecran qui n'existe pas.
  const MKW_ASK_ACTIONS = {
    creer_post: { label: 'Me faire préparer le post', js: 'mkwPrefillCreate()' },
    ouvrir_plan: { label: 'Ouvrir Plan', js: "mkwTab('plan')" },
    ouvrir_impact: { label: 'Ouvrir Impact', js: "mkwTab('results')" },
    ouvrir_marche: { label: 'Ouvrir Marché', js: "mkwTab('rivals')" },
  };

  // Un post pour UN jour precis n'est pas la meme suite qu'un post en general :
  // il part avec sa date (trigger « creux »), donc la carte nait deja rattachee
  // au jour a remplir. Le serveur ne laisse passer `jourVise` que s'il figure
  // dans le radar : la date est verifiee avant d'arriver ici.
  function mkwAskAction(answer) {
    const jour = String((answer && answer.jourVise) || '');
    if (answer && answer.action === 'creer_post' && /^\d{4}-\d{2}-\d{2}$/.test(jour)) {
      return { label: `Préparer un post pour ${brFrDay(jour)}`, js: `mkBrRadarFill('${escJs(jour)}')` };
    }
    return MKW_ASK_ACTIONS[answer && answer.action] || null;
  }

  // Pourquoi la reponse n'a PAS ete ecrite par le modele. Dit a l'ecran, jamais
  // masque : c'est la difference entre « il a repondu court » et « il n'a pas
  // repondu du tout ». Le cas `bloque` est le plus important : le modele a
  // repondu, sa reponse citait une donnee que le centre n'a pas, le serveur l'a
  // jetee. Le gerant a le droit de le savoir.
  const MKW_ASK_DEGRADED = {
    sans_modele: 'mode simple : aucun modèle branché',
    budget: 'mode simple : le budget du mois est atteint',
    echec: 'mode simple : le modèle n\'a pas répondu',
    bloque: 'mode simple : la réponse du modèle citait une donnée que vous n\'avez pas, je l\'ai écartée',
  };

  // La reponse ECRITE PAR LE MODELE, ramenee a la forme d'un tour de chat. Les
  // faits cites et ce qu'il ne sait pas viennent de lui ; la source, elle, dit
  // ce qu'il avait REELLEMENT sous les yeux (compte des jours mesures, du radar,
  // des formules), pas une formule de politesse.
  function mkwAnswerFromServer(question, payload) {
    const a = (payload && payload.answer) || {};
    const basis = (payload && payload.basis) || {};
    const action = mkwAskAction(a);
    const unknowns = Array.isArray(a.jeNeSaisPas) ? a.jeNeSaisPas.filter(Boolean) : [];
    return {
      q: question,
      title: a.titre || 'Ce que je vois',
      reco: a.reponse || '',
      why: unknowns.length ? `Ce que je ne sais pas : ${unknowns.join(' ')}` : '',
      facts: Array.isArray(a.faits) ? a.faits.filter(Boolean) : [],
      actions: action ? [action] : [],
      source: `lu dans vos données : ${Number(basis.joursMesures) || 0} jours mesurés, ${Number(basis.joursRadar) || 0} jours à venir, ${Number(basis.formules) || 0} formules et leurs prix`,
    };
  }

  // L'assemblage d'une reponse : la bulle du gerant entre TOUT DE SUITE, puis
  // les etapes de travail vivent le temps de la VRAIE requete, puis la reponse
  // entre. Le mot d'etat decrit un travail qui a REELLEMENT lieu et meurt avec
  // lui.
  //
  // Le chemin normal passe par le serveur : le modele repond depuis le dossier
  // de faits du centre (api/ops action marketingAsk). Le routeur local
  // (mkwAnswer) reste le FILET : il reprend la main quand le serveur rend
  // `grounded: false` (pas de cle, budget au plafond, panne) ou quand la
  // requete elle-meme echoue. Il ne decide plus rien, il rattrape.
  async function mkwAskFlow(question) {
    if (mkw.stateWord) return;
    const pendingUser = { kind: 'qa', q: question, title: '', pendingAnswer: true };
    mkw.thread.push(pendingUser);
    mkw.stateWord = 'Je regarde vos données';
    mkBrief.tab = 'feed';
    renderStaffCampaignsPage();
    mkwScrollChatEnd();
    let answer = null;
    try {
      const payload = await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'marketingAsk', centerId: state.adminCenterId || 'libramont', question: String(question).slice(0, 400) }),
      });
      if (payload && payload.grounded && payload.answer && payload.answer.reponse) {
        answer = mkwAnswerFromServer(question, payload);
      } else {
        answer = mkwAnswer(question);
        const why = MKW_ASK_DEGRADED[(payload && payload.reason) || ''] || 'mode simple';
        answer.source = `${answer.source} · ${why}`;
      }
    } catch (error) {
      answer = mkwAnswer(question);
      answer.source = `${answer.source} · mode simple : la requête n'est pas passée`;
    }
    const idx = mkw.thread.indexOf(pendingUser);
    // answerFresh : SEULE la reponse joue son entree a l'arrivee ; la bulle
    // du gerant, deja entree pendant l'assemblage, ne rejoue jamais.
    if (idx >= 0) mkw.thread[idx] = { kind: 'qa', ...answer, answerFresh: true };
    if (mkw.thread.length > 14) mkw.thread.shift();
    mkw.stateWord = null;
    mkwChatSave();
    renderStaffCampaignsPage();
    mkwScrollChatEnd();
  }

  window.mkwAsk = function () {
    const q = String(mkBrief.askDraft || '').trim();
    if (q.length < 4) { toast('Posez votre question en quelques mots.'); return; }
    mkBrief.askDraft = '';
    mkwAskFlow(q);
  };

  // Question sur UN jour (mini-radar du panneau, rangee « a surveiller ») :
  // la reponse arrive dans le chat, comme si le gerant avait demande.
  window.mkwAskDay = function (date) {
    const b = mkBrief.data;
    const day = b && (b.radar || []).find((d) => d.date === date);
    if (!day) return;
    mkwSheetAutoClose();
    mkwAskFlow(`Que dit ${brFrDay(date)} ?`);
  };

  // ── Le composer : DEUX contrats, pas deux skins ──────────────────────────
  function mkwSuggestions() {
    const b = mkBrief.data;
    if (!b) return [];
    const out = [];
    const today = b.today || '';
    const quiet = (b.radar || []).find((d) => (d.level === 'creux' || d.level === 'calme') && d.date >= today);
    if (quiet) out.push({ label: `Remplir ${brFrDay(quiet.date)}`, mode: 'demander', text: `Comment remplir ${brFrDay(quiet.date)} ?` });
    const changed = (b.veille && b.veille.changed) || [];
    if (changed.length) out.push({ label: `Que fait ${changed[0].name} ?`, mode: 'demander', text: `Que fait ${changed[0].name} ?` });
    out.push({ label: 'Un post pour le week-end', mode: 'creer', text: 'Un post pour le week-end' });
    return out.slice(0, 3);
  }
  window.mkwSuggest = function (index) {
    const s = mkwSuggestions()[index];
    if (!s) return;
    mkw.mode = s.mode;
    mkBrief.askDraft = s.text;
    renderStaffCampaignsPage();
    setTimeout(() => {
      const el = document.getElementById('brAskInput');
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    }, 60);
  };
  window.mkwMode = function (mode) {
    mkw.mode = mode === 'demander' ? 'demander' : 'creer';
    renderStaffCampaignsPage();
    setTimeout(() => { const el = document.getElementById('brAskInput'); if (el) el.focus(); }, 60);
  };
  window.mkwSend = function () {
    // Le champ s'allume une fois au depart : c'est l'accuse de reception de la
    // touche Entree, avant meme que la bulle n'apparaisse plus haut.
    const boite = document.querySelector('.mkw-composer-box');
    if (boite) {
      boite.classList.remove('is-flushed');
      void boite.offsetWidth;
      boite.classList.add('is-flushed');
      window.setTimeout(() => boite.classList.remove('is-flushed'), 500);
    }
    if (mkw.mode === 'demander') window.mkwAsk();
    else window.mkBrAskSimple();
  };

  // LA DERNIERE DEMANDE, celle dont l'agent est en train de s'occuper. C'est
  // elle qui dicte les etapes affichees : sans elle, on retomberait sur une
  // liste generique, c'est-a-dire sur du theatre.
  // Le fil vit dans `mkw.thread` : `mkBrief.turns` n'a jamais existe, donc le
  // tour en cours n'etait jamais trouve et les etapes retombaient sur la liste
  // generique. Exactement le theatre que ce code voulait eviter. La ligne
  // tapee (askDraft) est videe par mkwAsk avant l'envoi : c'est bien le tour en
  // attente, pas le champ, qui porte la question.
  function mkwDerniereDemande() {
    const tours = (mkw.thread || []);
    const enCours = tours.find((t) => t && t.pendingAnswer);
    return String((enCours && enCours.q) || mkBrief.askDraft || '');
  }

  // DES ETAPES QUI SORTENT DE LA DEMANDE, PAS D'UNE LISTE ECRITE D'AVANCE.
  // Movsar : « ce n'est pas comme ca que je voulais dire, c'est plus genre je
  // reflechis, hmm voyons voir, je regarde un tel, je verifie, plein de trucs
  // comme ca logiques, envoie pas betement, ca doit etre reel et ca doit
  // dependre de la demande ».
  // Quatre libelles fixes, c'est du decor : ils disent la meme chose qu'on
  // demande un post pour samedi ou ce que fait un concurrent. Ici chaque etape
  // est DERIVEE de ce qui a ete tape et de ce que le brief contient vraiment :
  // un jour cite devient « je regarde samedi 16/08 », un concurrent nomme
  // devient « je relis ce que fait Bowling Arlon », et rien n'est affiche sur
  // une donnee que le centre n'a pas. Une etape qui ment sur ce qu'elle fait
  // est pire qu'une barre anonyme.
  function mkwEtapesPour(demande, mode) {
    const q = String(demande || '').toLowerCase();
    const b = mkBrief.data || {};
    const etapes = [{ state: 'breathing', label: 'Hmm, voyons voir' }];

    // Un jour cite dans la demande : on le NOMME, avec la date que le radar
    // porte deja. C'est le repere que le gerant reconnait dans sa propre phrase.
    const jour = (b.radar || []).find((d) => d && d.date && q.includes(String(brFrDay(d.date)).toLowerCase()));
    if (jour) etapes.push({ state: 'searching', label: `Je regarde ${brFrDay(jour.date)}` });
    else etapes.push({ state: 'searching', label: 'Je relis vos journées mesurées' });

    // Un concurrent nomme : on ne cite QUE ceux que la veille connait vraiment.
    const veille = ((b.veille && b.veille.changed) || []).concat((b.veille && b.veille.all) || []);
    const concurrent = veille.find((c) => c && c.name && q.includes(String(c.name).toLowerCase().split(' ')[0]));
    if (concurrent) etapes.push({ state: 'connecting', label: `Je relis ce que fait ${concurrent.name}` });

    if (/(météo|meteo|pluie|soleil|temps|chaud|froid)/.test(q)) {
      etapes.push({ state: 'listening', label: 'Je vérifie la météo annoncée' });
    }
    if (/(formule|prix|tarif|offre|promo|anniversaire)/.test(q)) {
      etapes.push({ state: 'weaving', label: 'Je relis vos formules et leurs prix' });
    }
    if (/(remplir|creux|calme|vide|monde|affluence)/.test(q)) {
      etapes.push({ state: 'solving', label: 'Je compare aux journées qui se sont remplies' });
    }

    etapes.push(mode === 'creer'
      ? { state: 'composing', label: 'J’écris le post' }
      : { state: 'composing', label: 'Je formule la réponse' });
    etapes.push({ state: 'solving', label: 'Je vérifie ce que j’avance' });

    // Deux etapes ne valent pas une progression : sous ce seuil, le gerant voit
    // une barre sauter de 50 a 100 sans rien apprendre. On garde alors la forme
    // simple, qui ne promet rien.
    return etapes.length >= 4 ? etapes : etapes.slice(0, 3);
  }

  function mkwComposer() {
    const demander = mkw.mode === 'demander';
    const busyAsk = mkBrief.busy === 'ask';
    const suggestions = mkwSuggestions();
    const chips = suggestions.length ? `<div class="mkw-composer-chips">${suggestions.map((s, i) => `<button type="button" class="mkw-chip-suggest" onclick="mkwSuggest(${i})">${esc(s.label)}</button>`).join('')}</div>` : '';
    return `<div class="mkw-composer">
      <div class="mkw-composer-box">
        <div class="mkw-modes" role="group" aria-label="Mode du message">
          <button type="button" class="mkw-mode ${demander ? 'active' : ''}" aria-pressed="${demander}" onclick="mkwMode('demander')">Demander</button>
          <button type="button" class="mkw-mode ${demander ? '' : 'active'}" aria-pressed="${!demander}" onclick="mkwMode('creer')">Créer</button>
        </div>
        <input id="brAskInput" class="mkw-composer-input" data-pl-focus="marketing.demande" value="${esc(mkBrief.askDraft || '')}"
          placeholder="${demander ? 'Posez votre question : « comment remplir mardi ? »' : 'Décrivez le livrable : « un post pour la soirée fluo »'}"
          aria-label="${demander ? 'Poser une question à l\'agent' : 'Demander une création à l\'agent'}"
          oninput="mkBrief.askDraft = this.value" onkeydown="if (event.key === 'Enter') mkwSend()">
        <button type="button" class="pv2-btn primary mkw-composer-send" onclick="mkwSend()" ${busyAsk ? 'disabled' : ''}>${busyAsk ? 'Préparation…' : (demander ? 'Demander' : 'Préparer')}</button>
      </div>
      ${chips}
    </div>`;
  }

  // Le mini-radar du panneau : les 14 jours en une bande discrete. Cliquer un
  // jour POSE LA QUESTION dans le chat (reponse assemblee, avec l'action
  // « Prepare-moi un post » si le jour est calme) : l'operationnel vit ici,
  // la conversation reste la piece principale.
  function mkwPanelRadar() {
    const b = mkBrief.data;
    if (!b || !b.radar || !b.radar.length) return '';
    const cells = b.radar.map((day) => {
      const isToday = day.date === b.today;
      return `<button type="button" class="mkw-mini lv-${esc(day.level)} ${isToday ? 'is-today' : ''}" onclick="mkwAskDay('${escJs(day.date)}')" title="${esc(day.explanation)}" aria-label="${esc(brFrDay(day.date))} : ${esc(day.explanation)}">
        <span>${isToday ? 'auj' : BR_DOW[day.dow]}</span><b>${day.date.slice(8, 10)}</b>
        ${day.resaCount ? `<i>${day.resaCount}</i>` : ''}
      </button>`;
    }).join('');
    return `<div class="mkw-bgroup mkw-panel-radar">
      <div class="mkw-bgroup-head"><h3>Les 14 prochains jours</h3></div>
      <div class="mkw-minis">${cells}</div>
      <p class="mkw-bempty">un clic pose la question dans le chat</p>
    </div>`;
  }

  // ── Le tableau d'actions (colonne droite) ────────────────────────────────
  // Trois groupes a nombre volontairement limite. CALME quand il n'y a rien :
  // une ligne honnete, jamais une liste gonflee pour faire vivant.
  function mkwBoardCards() {
    const props = brVisiblePropositions().filter((p) => !mkBrief.published[p.key]);
    const fresh = mkw.knownKeys ? props.filter((p) => !mkw.knownKeys.has(p.key)) : [];
    return props.map((p) => {
      const tone = BR_TRIGGER_TONE[p.trigger] || 'accent';
      const due = p.dueDate ? (p.dueDate === (mkBrief.data && mkBrief.data.today) ? 'aujourd\'hui' : `avant ${brFrDay(p.dueDate)}`) : 'quand vous voulez';
      const verb = p.kind === 'email' ? 'Valider un email' : (p.kind === 'offre' ? 'Une action sur place' : 'Valider un post');
      const isNew = fresh.some((f) => f.key === p.key);
      return `<button type="button" class="mkw-bcard tone-${tone} ${isNew ? 'is-new' : ''}" onclick="mkBrGoCard('${escJs(p.key)}')">
        <span class="mkw-bcard-verb">${esc(verb)}</span>
        <span class="mkw-bcard-why">${esc(String(p.whyShort || p.why || '').slice(0, 90))}</span>
        <span class="mkw-bcard-meta"><em>${esc(due)}</em><i>${esc(BR_TRIGGER_LABELS[p.trigger] || '')}</i><u>Voir les faits</u></span>
      </button>`;
    }).join('');
  }

  // ── LES QUESTIONS QUE L AGENT NE TRANCHE PAS ─────────────────────────────
  // Une piste nait d un refus : le conseiller a vu quelque chose qui ressemble
  // a un changement de regle (prix, minimum de personnes, horaire) et il
  // s interdit de le conclure, parce que tout l historique a ete produit SOUS
  // la regle actuelle. Ce qu il peut faire, c est poser la question avec ce qui
  // est mesurable autour : combien de monde est concerne, combien d argent est
  // en jeu, et si la comparaison existe deja au catalogue.
  //
  // Volontairement SANS bouton. Publier n a pas de sens (ce n est pas un
  // texte), et « appliquer » encore moins : le cockpit fondateur ecrirait
  // status = 'applied' et lancerait une mesure a 14 jours sur une action que
  // personne n a faite (lib/founder-cockpit.js). Ca se tranche dans le
  // catalogue, a la main, par quelqu un qui connait son affaire.
  // Forme propre, PAS une ligne .mkw-brow : celles-ci sont a une ligne, et leur
  // <em> est en `flex: none`, donc un pourquoi de cent caracteres pousserait le
  // panneau plus large que lui-meme au lieu de revenir a la ligne. Ici le sujet
  // et son pourquoi s empilent dans une grille a deux colonnes.
  function mkwPisteRows() {
    const b = mkBrief.data;
    return ((b && b.pistes) || []).slice(0, 5).map((piste) => {
      const pourquoi = String(piste.pourquoi || '').trim();
      return `<div class="mkw-piste">
        <span class="mkw-brow-dot is-warn"></span>
        <span class="mkw-piste-sujet">${esc(cap(String(piste.sujet || '')))}</span>
        ${pourquoi ? `<span class="mkw-piste-why">${esc(pourquoi)}</span>` : ''}
      </div>`;
    }).join('');
  }

  function mkwBoard() {
    const b = mkBrief.data;
    if (!b) {
      return `<div class="mkw-bgroup">${typeof renderThinking === 'function' ? renderThinking('shaping', { label: 'Mise en forme' }) : '<div class="mkw-skel"></div>'}</div>`;
    }
    const validateCards = mkwBoardCards();
    const validateCount = brVisiblePropositions().filter((p) => !mkBrief.published[p.key]).length;

    // EN COURS : uniquement ce qui existe VRAIMENT cote serveur.
    const running = [];
    (b.receipts || []).filter((r) => r.tone === 'pending').slice(0, 4).forEach((r) => {
      running.push(`<div class="mkw-brow"><span class="mkw-brow-dot is-run"></span><span>${esc(brFrDates(r.label))}</span><em>${esc(r.result)}</em></div>`);
    });
    Object.keys(mkBrief.published).filter((k) => mkBrief.published[k]).forEach(() => {
      running.push(`<div class="mkw-brow"><span class="mkw-brow-dot is-run"></span><span>Publication notée à l'instant</span><em>la mesure court 14 jours</em></div>`);
    });
    if (mkPlan.jobId) running.push(`<div class="mkw-brow"><span class="mkw-brow-dot is-run"></span><span>Le plan se construit</span><em><button type="button" class="mkw-link" onclick="mkwTab('plan')">voir les étapes réelles</button></em></div>`);
    if (mkBrief.studioBusy) running.push(`<div class="mkw-brow"><span class="mkw-brow-dot is-run"></span><span>Un pack s'écrit dans Créations</span><em>10 à 20 secondes</em></div>`);
    if (mkBrief.busy === 'ask') running.push(`<div class="mkw-brow"><span class="mkw-brow-dot is-run"></span><span>Votre demande se prépare</span><em>quelques secondes</em></div>`);

    // A SURVEILLER : signaux reels, sans action urgente.
    const watch = [];
    const today = b.today || '';
    (b.radar || []).filter((d) => (d.level === 'creux' || d.level === 'calme') && d.date >= today).slice(0, 3).forEach((d) => {
      watch.push(`<button type="button" class="mkw-brow is-link" onclick="mkwAskDay('${escJs(d.date)}')"><span class="mkw-brow-dot is-warn"></span><span>${esc(cap(brFrDay(d.date)))} s'annonce ${d.level === 'creux' ? 'très calme' : 'calme'}</span><em>${d.resaCount ? `${d.resaCount} pers. posées` : 'rien de posé'}</em></button>`);
    });
    ((b.veille && b.veille.changed) || []).slice(0, 2).forEach((c) => {
      watch.push(`<button type="button" class="mkw-brow is-link" onclick="mkwGoRival('${escJs(c.name)}')"><span class="mkw-brow-dot is-warn"></span><span>${esc(c.name)} a bougé</span><em>voir Marché</em></button>`);
    });
    const eventDay = (b.radar || []).find((d) => d.event);
    if (eventDay) watch.push(`<div class="mkw-brow"><span class="mkw-brow-dot"></span><span>${esc(eventDay.event.replace(' (à 5 min)', ''))}</span><em>${esc(brFrDay(eventDay.date))} · à 5 min</em></div>`);
    if ((b.dataDays || 0) < 90) watch.push(`<div class="mkw-brow"><span class="mkw-brow-dot"></span><span>J'apprends encore</span><em title="Il faut environ 90 jours de données pour attribuer un effet avec certitude.">${b.dataDays || 0} j sur 90</em></div>`);

    const group = (title, count, rows, empty) => `<div class="mkw-bgroup">
      <div class="mkw-bgroup-head"><h3>${title}</h3>${count ? `<span class="mkw-bcount">${count}</span>` : ''}</div>
      ${rows || `<p class="mkw-bempty">${empty}</p>`}
    </div>`;
    const pisteRows = mkwPisteRows();
    const pisteCount = ((b.pistes || []).slice(0, 5)).length;
    // « Rien a valider » disait la meme chose quand tout allait bien et quand
    // la cle du modele manquait. Le serveur calcule maintenant la cause (sans
    // appeler le modele, sans rien depenser) : on la montre telle quelle.
    const vide = (b.silence && b.silence.phrase)
      || 'Rien à valider : la surveillance continue.';
    return `${group('À valider', validateCount, validateCards, vide)}
      ${group('À trancher', pisteCount, pisteRows, 'Aucune question ouverte de mon côté.')}
      ${group('En cours', running.length, running.join(''), 'Rien ne tourne en ce moment.')}
      ${group('À surveiller', 0, watch.join(''), 'Rien à surveiller de particulier.')}
      ${mkwPanelRadar()}`;
  }

  // Le PANNEAU : les taches de l'agent, fermable d'un geste (anime en CSS via
  // la grille du bureau). Son etat vit en session : le chat ne bouge jamais.
  function mkwPanel() {
    return `<aside class="mkw-panel" aria-label="Le travail de l'agent" ${mkw.panelOpen ? '' : 'aria-hidden="true"'}>
      <div class="mkw-panel-head">
        <span class="mkw-panel-title">Le travail</span>
        <button type="button" class="mkw-panel-close" aria-label="Fermer le panneau" onclick="mkwPanelToggle()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
        </button>
      </div>
      ${mkwBoard()}
    </aside>`;
  }

  // ── LA FEUILLE MOBILE ────────────────────────────────────────────────────
  // Sur petit ecran, le panneau devient une feuille montee dans document.body
  // (meme doctrine que la surcouche du composeur emails) : un `position:
  // fixed` a l'interieur de la page se faisait pieger par les ancetres
  // animes en transform (containing block) et la feuille flottait n'importe
  // ou. Le body, lui, n'a pas d'ancetre. Entree : glissement depuis la
  // droite + voile fondu ; sortie : le meme chemin, joue AVANT le retrait.
  const MKW_SHEET_BP = 900;
  function mkwIsMobile() { return window.innerWidth <= MKW_SHEET_BP; }
  function mkwSheetHost() {
    let host = document.getElementById('mkwSheet');
    if (!host) {
      host = document.createElement('div');
      host.id = 'mkwSheet';
      host.addEventListener('mousedown', (event) => {
        if (event.target.classList && event.target.classList.contains('mkw-sheet-back')) window.mkwPanelToggle();
      });
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && host.classList.contains('is-on') && !host.classList.contains('is-closing')) window.mkwPanelToggle();
      }, true);
      document.body.appendChild(host);
    }
    return host;
  }
  let mkwSheetWasOpen = false;
  function mkwSheetRender() {
    const host = mkwSheetHost();
    const on = mkw.panelOpen && mkBrief.tab === 'feed'
      && state.view === 'staff' && state.staffMenuPage === 'campaigns';
    if (!on) {
      host.className = '';
      host.innerHTML = '';
      mkwSheetWasOpen = false;
      return;
    }
    // Le voile n'existe qu'en mobile (le tiroir recouvre le chat) ; sur grand
    // ecran le chat se RECENTRE a cote du tiroir, rien a voiler.
    host.innerHTML = `${mkwIsMobile() ? '<div class="mkw-sheet-back" aria-hidden="true"></div>' : ''}${mkwPanel()}`;
    host.className = 'is-on';
    if (!mkwSheetWasOpen && !reducedMotion) {
      // L'entree joue au frame suivant : le tiroir SORT du bord droit, le
      // voile fond. Un simple re-render (contenu qui change) ne rejoue rien.
      requestAnimationFrame(() => requestAnimationFrame(() => host.classList.add('is-in')));
    } else {
      host.classList.add('is-in');
    }
    if (!mkwSheetWasOpen) requestAnimationFrame(mkwSheetWatch);
    mkwSheetWasOpen = true;
  }

  // La feuille vit sur body : si le gerant quitte la page Marketing pendant
  // qu'elle est ouverte (sidebar, navigation), AUCUN paint marketing ne
  // viendra la retirer. Ce garde par frame la tue des que la page n'est plus
  // a l'ecran. Il ne tourne QUE feuille ouverte : cout nul au repos.
  function mkwSheetWatch() {
    const host = document.getElementById('mkwSheet');
    if (!host || !host.classList.contains('is-on')) return;
    const page = document.getElementById('staffCampaignsPage');
    if (!page || page.offsetParent === null || !document.getElementById('mkwFeed')) {
      host.className = '';
      host.innerHTML = '';
      mkwSheetWasOpen = false;
      return;
    }
    requestAnimationFrame(mkwSheetWatch);
  }

  window.mkwPanelToggle = function () {
    const host = document.getElementById('mkwSheet');
    if (mkw.panelOpen && host && host.classList.contains('is-on')) {
      // SORTIE animee (toutes tailles) : le tiroir RENTRE dans le bord, PUIS
      // meurt. Le chat reprend sa place en meme temps (padding anime).
      if (host.classList.contains('is-closing')) return;
      host.classList.add('is-closing');
      host.classList.remove('is-in');
      const page = document.getElementById('staffCampaignsPage');
      if (page) page.classList.remove('mkw-has-panel');
      setTimeout(() => {
        host.classList.remove('is-closing');
        mkw.panelOpen = false;
        renderStaffCampaignsPage();
      }, reducedMotion ? 0 : 280);
      return;
    }
    mkw.panelOpen = !mkw.panelOpen;
    renderStaffCampaignsPage();
  };

  // Une action lancee DEPUIS la feuille rend la main au chat : la feuille se
  // retire pour laisser voir la reponse arriver.
  function mkwSheetAutoClose() {
    if (mkwIsMobile() && mkw.panelOpen) mkw.panelOpen = false;
  }

  // Une NOUVELLE tache vient de naitre (creation IA aboutie) : le tiroir se
  // REVELE tout seul sur grand ecran (s'il etait ferme, il s'ouvre) et defile
  // jusqu'a la carte neuve, qui joue son entree (.is-new). Sur petit ecran on
  // ne recouvre jamais le chat : la carte y arrive de toute facon.
  function mkwPanelReveal() {
    if (mkwIsMobile()) return;
    if (!mkw.panelOpen) mkw.panelOpen = true;
    setTimeout(() => {
      const fresh = document.querySelector('#mkwSheet .mkw-bcard.is-new');
      if (fresh) fresh.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'nearest' });
    }, 420);
  }

  // ── Résultats · le héros euros : SEUL exemplaire (audit §6.2). Libellés
  // exacts : des MESSAGES (relances, anniversaires, campagnes), pas des
  // publications ; des visites réellement honorées, pas de simples réservations
  // enregistrées ; reçu, pas vu. ──
  function mkwHero() {
    const b = mkBrief.data;
    // Meme garde que sur b : un brief sans bloc `paie` faisait planter p.young,
    // et l exception cassait la page Marketing entiere.
    // UN SQUELETTE GRIS NE DIT PAS QU IL SE PASSE QUELQUE CHOSE. Movsar, en
    // regardant la page Marketing bloquee sur ses barres grises : « c'est normal
    // que ca prenne beaucoup trop de temps a se charger », puis « ou sont les
    // animations ». Les orbes etaient posees sur des libelles « Chargement… »
    // qui ne s affichent presque jamais, pendant que les vraies attentes de la
    // console, elles, montraient des rectangles immobiles. Un rectangle qui ne
    // bouge pas ressemble a une page cassee ; une orbe qui tourne dit que la
    // machine travaille encore. L etat choisi nomme CE QUE la page attend.
    if (!b || !b.paie) return `<section class="mkw-hero">${typeof renderThinking === 'function' ? renderThinking('breathing', { size: 64, label: 'L’agent analyse le centre' }) : '<div class="mkw-skel mkw-skel-hero"></div>'}</section>`;
    const p = b.paie;
    const unavailable = p.available === false;
    const periods = [7, 30, 90].map((d) => `<button type="button" class="mkw-seg-btn ${mkBrief.period === d ? 'active' : ''}" onclick="mkBrPeriod(${d})">${d} j</button>`).join('');
    let fig;
    if (unavailable) {
      fig = '<div class="mkw-hero-fig"><span class="mkw-hero-cap" role="status"><strong>Mesure indisponible</strong></span></div>';
    } else if (p.young) {
      fig = `<div class="mkw-hero-fig"><span class="mkw-hero-num is-quiet">-</span><span class="mkw-hero-cap">Encore trop tôt pour un chiffre honnête. Premier bilan le <strong>${esc(p.firstVerdictDate)}</strong>.</span></div>`;
    } else if (p.quietWindow) {
      fig = `<div class="mkw-hero-fig"><span class="mkw-hero-num is-quiet">0</span><span class="mkw-hero-cap">message envoyé sur les <strong>${p.days} derniers jours</strong>. Vos mesures passées restent plus bas.</span></div>`;
    } else if (p.euros > 0) {
      fig = `<div class="mkw-hero-fig"><span class="mkw-hero-num is-good">${money(p.euros)}</span><span class="mkw-hero-cap">de visites honorées liées à vos messages · <strong>${p.days} derniers jours</strong></span></div>`;
    } else {
      fig = `<div class="mkw-hero-fig"><span class="mkw-hero-num">${p.sent}</span><span class="mkw-hero-cap">messages partis : aucune visite honorée ne leur est encore liée sur ${p.days} j</span></div>`;
    }
    const chips = !unavailable && !p.young && !p.quietWindow ? `<div class="mkw-hero-chips">
      <span class="mkw-hchip"><b>${p.venues}</b> visites honorées</span>
      <span class="mkw-hchip-dot"></span>
      <span class="mkw-hchip"><b>${p.sent}</b> messages envoyés</span>
    </div>` : '';
    const detail = unavailable || (mkBrief.payOpen && !p.young) ? mkwSources(p) : '';
    return `<section class="mkw-hero">
      <div class="mkw-hero-top">
        <span class="mkw-eyebrow">Ce que le marketing a rapporté</span>
        <div class="mkw-seg">${periods}</div>
      </div>
      ${fig}
      ${chips}
      ${Number(p.excludedMissingSentAt) > 0 ? `<p class="mkw-quiet">${Number(p.excludedMissingSentAt)} message(s) exclu(s) de la mesure : date d'envoi manquante.</p>` : ''}
      ${unavailable ? `<button type="button" class="mkw-link" onclick="mkBrPeriod(${mkBrief.period})">Réessayer</button>` : !p.young ? `<button type="button" class="mkw-link" onclick="mkBrPayDetail()">${mkBrief.payOpen ? 'Masquer le détail' : 'D’où vient ce chiffre'}</button>` : ''}
      ${detail}
    </section>`;
  }

  function mkwSources(p) {
    const rows = (p.sources || []).map((s) => {
      if (p.available === false) return `<div class="mkw-src"><span class="mkw-src-name">${esc(s.label)}</span><span class="mkw-src-bar"></span><span class="mkw-src-val" aria-label="Mesure indisponible">-</span></div>`;
      const share = p.euros > 0 ? Math.round((s.revenue / p.euros) * 100) : 0;
      return `<div class="mkw-src"><span class="mkw-src-name">${esc(s.label)}</span><span class="mkw-src-bar"><span style="width:${Math.max(2, share)}%"></span></span><span class="mkw-src-val">${money(s.revenue)}<em>${share}%</em></span></div>`;
    }).join('');
    // Les clics avis Google viennent des emails post-visite (transactionnels,
    // hors sources marketing) : ils s'affichent avec leur vraie origine, pas
    // en chip du héros comme s'ils étaient du ROI de publication (audit 4.6).
    return `<div class="mkw-src-panel">
      ${rows || (p.available === false ? '' : '<p class="mkw-quiet">Pas encore de visite honorée attribuée sur la période.</p>')}
      ${p.reviewClicks ? `<p class="mkw-src-extra"><b>${p.reviewClicks}</b> clics vers votre fiche Google (emails de suivi post-visite, hors chiffre ci-dessus)</p>` : ''}
      <p class="mkw-method">Ne comptent que les visites <strong>déjà passées et réellement honorées</strong> (client marqué arrivé ou payé) : les réservations annulées, les demandes en attente de validation, les clients qui ne sont jamais venus et les réservations à venir sont tous exclus. Chaque visite est créditée au dernier message reçu dans les 60 jours : c’est un lien, pas une preuve absolue.</p>
    </div>`;
  }

  // Vocabulaire de confiance : UNIQUEMENT les niveaux que le backend émet
  // (exploratoire / signal / solide, lib/center-metrics.js).
  const MKW_CONF = { solide: { label: 'solide', tone: 'ok' }, signal: { label: 'signal', tone: 'mid' }, exploratoire: { label: 'à confirmer', tone: 'low' } };
  function mkwConfBadge(conf) {
    const c = MKW_CONF[conf] || MKW_CONF.exploratoire;
    return `<span class="mkw-conf t-${c.tone}">${c.label}</span>`;
  }

  // Format signé honnête : -12 % rend « -12% », jamais « +-12% » (audit 4.3).
  function mkwSignedPct(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return `${n > 0 ? '+' : ''}${n}%`;
  }

  // ── Résultats · les verdicts causaux (ex « Ce qui marche », audit §6.1 :
  // la même question à deux granularités vit dans UNE maison). ──
  function mkwVerdictsBlock() {
    const b = mkBrief.data;
    if (!b) return '';
    const f = b.facts;
    const verdicts = [];
    if (f && f.bestDay) {
      const vs = f.bestDay.vsMedianPct === null ? '' : `${mkwSignedPct(f.bestDay.vsMedianPct)} de monde qu’un jour normal · `;
      verdicts.push(mkwVerdict('Votre meilleur jour', `${cap(f.bestDay.label)}`, `${vs}${f.bestDay.avgVisitors} visiteurs en moyenne`, f.bestDay.confidence, 'calendar'));
    }
    if (f && f.worstDay) {
      const vs = f.worstDay.vsMedianPct === null ? 'la cible n°1 à remplir' : `${Math.abs(f.worstDay.vsMedianPct)}% de monde en moins qu’un jour normal, la cible n°1 à remplir`;
      verdicts.push(mkwVerdict('Votre jour le plus creux', `${cap(f.worstDay.label)}`, vs, f.worstDay.confidence, 'target', 'danger'));
    }
    if (f && f.bestMonth) {
      const why = (f.bestMonth.whyDrivers || []).join(', ');
      verdicts.push(mkwVerdict('Votre meilleur mois', cap(f.bestMonth.label), `${mkwSignedPct(f.bestMonth.vsAvgPct)} vs la moyenne${why ? `, pourquoi : ${why}` : ''}`, f.bestMonth.confidence || 'signal', 'flame'));
    }
    if (f && f.weather) {
      const w = f.weather;
      verdicts.push(mkwVerdict('Effet de la pluie', mkwSignedPct(w.rainEffectPct) || '-', `sur votre fréquentation, à jours comparables · ${w.sampleDays} j de recul`, w.confidence, 'droplet'));
    }
    if (f && typeof f.holidayEffectPct === 'number') {
      // Signe honnête + la confiance CALCULÉE (plus jamais « solide » en dur).
      verdicts.push(mkwVerdict('Effet des vacances scolaires', mkwSignedPct(f.holidayEffectPct), 'de fréquentation pendant les congés FWB', f.holidayEffectConfidence || 'exploratoire', 'star'));
    }
    if (!verdicts.length) {
      // Pas un onglet entier de promesses : UNE ligne honnête (audit §7).
      return '<p class="mkw-note">J’apprends encore : mes verdicts « quel jour, quel mois, quelle météo » arrivent dès que j’ai 90 jours de recul.</p>';
    }
    return `<div class="mkw-card">
      <div class="mkw-block-head"><h3>Ce que je sais de votre centre</h3><span class="mkw-block-sub">calculé sur vos propres journées, météo et congés déduits</span></div>
      <div class="mkw-verdicts">${verdicts.join('')}</div>
    </div>`;
  }

  // ── Résultats · la mémoire par contexte (patterns mesurés) ──
  function mkwPatternsBlock() {
    const b = mkBrief.data;
    if (!b) return '';
    // Tri honnête : 0 % est une mesure, pas une absence (audit 4.3 : le
    // « || -999 » traitait un effet net nul comme un trou).
    const patterns = (b.patterns || []).slice().sort((a, c) => {
      const av = a.netDeltaPct === null || a.netDeltaPct === undefined ? -Infinity : a.netDeltaPct;
      const cv = c.netDeltaPct === null || c.netDeltaPct === undefined ? -Infinity : c.netDeltaPct;
      return cv - av;
    });
    if (!patterns.length) {
      return `<div class="mkw-card mkw-patterns">
        <div class="mkw-block-head"><h3>Ce qui convertit chez vous</h3><span class="mkw-block-sub">appris sur vos propres mesures</span></div>
        <p class="mkw-quiet">Publiez et laissez-moi mesurer : les patterns gagnants s’afficheront ici, avec leur effet net.</p>
      </div>`;
    }
    const hasBrut = patterns.some((p) => p.basis === 'brut');
    const rows = patterns.map((p) => {
      const d = p.netDeltaPct === null || p.netDeltaPct === undefined
        ? '<span class="mkw-pat-val is-pending">je mesure</span>'
        : `<span class="mkw-pat-val ${p.netDeltaPct > 0 ? 'is-good' : 'is-flat'}">${mkwSignedPct(p.netDeltaPct)}</span>`;
      // La base est AFFICHÉE par ligne : « effet net » ne couvre jamais un
      // delta brut en silence (audit 4.3, champ basis du serveur).
      const basis = p.basis === 'brut' ? '<span class="mkw-pat-basis">brut</span>' : '';
      // « 3 mesures », pas « n=3 » : le gérant n'est pas data scientist
      // (verdict sceptique tour 2).
      return `<div class="mkw-pat">
        <span class="mkw-pat-ctx">${esc(p.context)}${basis}</span>
        <span class="mkw-pat-meta">${Number(p.n) || 0} mesure${Number(p.n) > 1 ? 's' : ''} · ${mkwConfBadge(p.confidence)}</span>
        ${d}
      </div>`;
    }).join('');
    // La note « brut » ne s'affiche que si une ligne brut EXISTE : un
    // avertissement sur un cas absent est du bruit (verdict sceptique tour 2).
    const sub = hasBrut
      ? 'effet net mesuré vs. journée comparable · une ligne « brut » n’a pas encore sa journée de comparaison'
      : 'effet net mesuré vs. journée comparable';
    return `<div class="mkw-card mkw-patterns">
      <div class="mkw-block-head"><h3>Ce qui convertit chez vous</h3><span class="mkw-block-sub">${sub}</span></div>
      <div class="mkw-thead mkw-thead-pat" aria-hidden="true"><span>Action · déclencheur</span><span>Preuve</span><span>Effet</span></div>
      ${rows}
      <p class="mkw-method">Effet net = fréquentation réelle moins ce que j’attendais ce jour-là (météo, jour, vacances déduits). Pas encore un test avec groupe témoin.</p>
    </div>`;
  }

  function mkwVerdict(label, value, sub, conf, icon, tone) {
    return `<article class="mkw-verdict ${tone ? `t-${tone}` : ''}">
      <span class="mkw-verdict-ico">${ci(icon)}</span>
      <div class="mkw-verdict-body">
        <span class="mkw-verdict-label">${esc(label)}</span>
        <span class="mkw-verdict-val">${esc(value)}</span>
        <span class="mkw-verdict-sub">${brProse(sub)}</span>
      </div>
      ${conf ? mkwConfBadge(conf) : ''}
    </article>`;
  }

  function cap(s) { return `${String(s || '').charAt(0).toUpperCase()}${String(s || '').slice(1)}`; }

  // ── « Résultats » : la maison UNIQUE de la preuve (audit §6) : le héros
  // euros, ses sources, les reçus J+14, les verdicts causaux et la mémoire
  // par contexte. La même question (« qu'est-ce que ça rapporte ? ») à toutes
  // ses granularités, à UN seul endroit. ──
  function mkwResults() {
    return `<section class="mkw-results">
      ${mkwHero()}
      ${mkwReceipts()}
      ${mkwVerdictsBlock()}
      ${mkwPatternsBlock()}
    </section>`;
  }

  // Deep-link public vers la Meta Ad Library : les pubs ACTIVES de l'annonceur
  // (outil de transparence, consulté par un humain qui clique ; aucun scraping).
  function mkwAdLibraryUrl(name) {
    const q = encodeURIComponent(String(name || '').trim());
    return `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=BE&q=${q}&search_type=keyword_unordered&media_type=all`;
  }

  // ── « Concurrents » : la veille honnête (site structuré + note Google + Ad Library + colle-un-post) ──
  function mkwRivals() {
    const rows = (mkComp.data || []).map((c) => {
      let host = '';
      try { host = c.websiteUrl ? new URL(c.websiteUrl).hostname.replace(/^www\./, '') : ''; } catch (e) { host = ''; }
      const rating = typeof c.rating === 'number' ? `<span class="mkw-riv-stat" title="note Google">${ci('star')}${c.rating.toFixed(1)}${c.reviewsCount ? ` <em>${c.reviewsCount} avis</em>` : ''}</span>` : '';
      const checked = c.lastCheckedAt ? `site inspecté le ${String(c.lastCheckedAt).slice(8, 10)}/${String(c.lastCheckedAt).slice(5, 7)}` : 'première inspection demain matin';
      const signals = (c.signals || []).slice(0, 4).map((s) => `<span class="mkw-riv-sig">${esc(s.label)}${s.price ? ` <b>${esc(s.price)}</b>` : ''}</span>`).join('');
      // data-riv-name : la cible du deep-link avec intention (mkwGoRival) : un
      // clic veille arrive ICI, sur LE concurrent qui a bougé, mis en évidence.
      return `<article class="mkw-riv ${mkw.focusRival && mkw.focusRival === c.name ? 'is-focus' : ''}" data-riv-name="${esc(c.name)}">
        <div class="mkw-riv-top">
          <div><span class="mkw-riv-name">${esc(c.name)}</span>${host ? `<span class="mkw-riv-host">${esc(host)}</span>` : ''}</div>
          <button type="button" class="mkw-link mkw-link-faint" onclick="mkCompDelete(${Number(c.id)})">Retirer</button>
        </div>
        <div class="mkw-riv-stats">${rating}<span class="mkw-riv-check">${esc(checked)}</span></div>
        ${signals ? `<div class="mkw-riv-sigs">${signals}</div>` : ''}
        ${c.lastDiff ? `<p class="mkw-riv-diff">${ci('bolt')}${esc(c.lastDiff)}</p>` : ''}
        <a class="mkw-riv-adlink" href="${esc(mkwAdLibraryUrl(c.name))}" target="_blank" rel="noopener noreferrer">${ci('megaphone')}Chercher leurs pubs (Meta Ad Library)</a>
      </article>`;
    }).join('');
    // L'état de la liste : erreur DITE avec retry (plus jamais un échec réseau
    // déguisé en « aucun concurrent », audit §2), chargement, vide honnête.
    let listState;
    if (rows) listState = `<div class="mkw-riv-grid">${rows}</div>`;
    else if (mkComp.loading) listState = typeof renderThinking === 'function' ? renderThinking('weaving', { label: 'Analyse de la concurrence' }) : '<div class="mkw-skel"></div>';
    else if (mkComp.error) listState = `<p class="mkw-quiet mkw-inline-error">${esc(mkComp.error)} <button type="button" class="mkw-link" onclick="loadCompetitors(true)">Réessayer</button></p>`;
    else listState = '<p class="mkw-quiet">Ajoutez les centres qui vous prennent des clients : j’inspecte leurs sites, leurs offres et leur note Google.</p>';
    return `<section class="mkw-rivals">
      <div class="mkw-card">
        <div class="mkw-block-head"><h3>Les centres que je surveille</h3><span class="mkw-block-sub">j’inspecte leurs sites chaque matin</span></div>
        ${listState}
        <div class="mkw-riv-add">
          <div class="mkw-field"><label class="mkw-label" for="brCompName">Nom du concurrent</label><input id="brCompName" class="mkw-input" placeholder="Bowling de Bastogne" maxlength="80"></div>
          <div class="mkw-field"><label class="mkw-label" for="brCompSite">Son site</label><input id="brCompSite" class="mkw-input" placeholder="https://…" maxlength="300"></div>
          <button type="button" class="pv2-btn primary" onclick="mkCompSave()" ${mkComp.busy ? 'disabled' : ''}>${mkComp.busy ? '…' : 'Suivre'}</button>
        </div>
      </div>
      <div class="mkw-card">
        <div class="mkw-block-head"><h3>Collez-moi un post concurrent</h3><span class="mkw-block-sub">je l’analyse, je vous prépare la riposte et je retiens leurs techniques</span></div>
        <label class="mkw-label" for="brCompPost">Le texte du post ou de l’offre</label>
        <textarea id="brCompPost" class="mkw-textarea" placeholder="Collez ici le texte d’un post ou d’une offre d’un concurrent (Facebook, Instagram, son site…)" oninput="mkComp.postDraft = this.value">${esc(mkComp.postDraft || '')}</textarea>
        <div class="mkw-riv-analyze">
          <button type="button" class="pv2-btn primary" onclick="mkCompAnalyze()" ${mkComp.postBusy ? 'disabled' : ''}>${mkComp.postBusy ? 'j’analyse…' : 'Analyser'}</button>
          <span class="mkw-quiet-inline">Vous collez ce que vous regardez déjà : je le transforme en angle.</span>
        </div>
        ${mkCompPostResult()}
        <p class="mkw-method">En automatique aussi : j’extrais leurs offres et prix de leur site chaque matin, et j’affiche leur note Google dès qu’elle est disponible.</p>
      </div>
    </section>`;
  }

  function mkCompPostResult() {
    const r = mkComp.postResult;
    if (!r) return '';
    if (r.degraded) return `<p class="mkw-analy-degraded">${esc(r.note || 'Analyse indisponible pour l’instant.')}</p>`;
    const row = (label, value) => (value ? `<div class="mkw-analy-row"><span class="mkw-analy-label">${esc(label)}</span><span class="mkw-analy-val">${esc(value)}</span></div>` : '');
    // L'apprentissage est MONTRÉ (audit 4.5) : le geste le plus rentable de
    // l'onglet nourrit le cerveau : le gérant doit voir ce que j'ai retenu.
    const learned = r.dnaLearned > 0
      ? `<div class="mkw-analy-learned">${ci('sparkles')}<div>
          <span class="mkw-analy-label">J’ai retenu ${r.dnaLearned} technique${r.dnaLearned > 1 ? 's' : ''} de ce post</span>
          ${(r.adn || []).slice(0, 3).map((a) => `<span class="mkw-analy-val">${esc(a.regle)}</span>`).join('')}
          <span class="mkw-analy-foot">Elles nourrissent mes prochains posts pour vous.</span>
        </div></div>`
      : '';
    // La riposte n'est plus un cul-de-sac : elle part au Studio en un clic.
    const counter = r.riposte
      ? `<div class="mkw-analy-counter">${ci('bolt')}<div>
          <span class="mkw-analy-label">Votre riposte</span><span class="mkw-analy-val">${esc(r.riposte)}</span>
          <button type="button" class="mkw-link" onclick="mkwGoStudio('${escJs(String(r.riposte || '').slice(0, 280))}')">En faire un post</button>
        </div></div>`
      : '';
    return `<div class="mkw-analy">
      ${r.resume ? `<p class="mkw-analy-sum">${esc(r.resume)}</p>` : ''}
      ${row('Leur offre', r.offre)}
      ${row('Prix affiché', r.prix)}
      ${row('Ton', r.ton)}
      ${counter}
      ${learned}
    </div>`;
  }

  window.mkCompAnalyze = async function () {
    if (mkComp.postBusy) return;
    const text = (document.getElementById('brCompPost') || {}).value || mkComp.postDraft || '';
    if (text.trim().length < 15) { toast('Collez le texte du post : au moins une phrase.'); return; }
    mkComp.postDraft = text;
    mkComp.postBusy = true;
    mkComp.postResult = null;
    renderStaffCampaignsPage();
    try {
      const result = await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'competitorAnalyzePost', centerId: state.adminCenterId || 'libramont', text }),
      });
      mkComp.postResult = result;
      // Analyse réussie : le texte a fait son travail, on libère la zone.
      mkComp.postDraft = '';
    } catch (error) {
      // Le texte collé RESTE (audit 4.5 : le re-render l'effaçait sur échec).
      toast(error.message || 'Je n’ai pas réussi à analyser : réessaie.');
    } finally {
      mkComp.postBusy = false;
      scheduleCampaignsRender();
    }
  };

  /* ── LE PLAN : les 8 prochaines semaines ─────────────────────────────────
     Le gérant doit voir en un coup d'oeil : quelle semaine porte quelque chose
     de daté, et laquelle est une semaine de fond de commerce. La confiance est
     AFFICHÉE, pas masquée : une semaine « routine » se dit, sinon on vend du
     vent avec l'assurance d'un plan. */

  const MKW_PLAN_CONF = {
    mesure: { label: 'Mesuré chez nous', tone: 'good' },
    calendrier: { label: 'Date confirmée', tone: 'info' },
    routine: { label: 'Rien de daté', tone: 'muted' },
  };

  // L'id d'action pour markPlanActionDone (contrat serveur : kind:slug,
  // /^[a-z_]+:[0-9a-z-]+$/i). Il porte le lundi de la semaine : le plan de la
  // semaine suivante repart avec des signatures fraîches.
  function mkwPlanActionId(week, actionIndex) {
    return `strategist:w${Number(week.index) || 0}-a${actionIndex}-${String(week.from || '').replace(/-/g, '')}`;
  }

  function mkwPlanWeek(week) {
    const conf = MKW_PLAN_CONF[week.confiance] || MKW_PLAN_CONF.routine;
    const today = (mkBrief.data && mkBrief.data.today) || todayStr();
    // L'état temporel de la semaine, calculé sur ses vraies dates : passée /
    // cette semaine / à venir (audit §7 : « un etat visible par semaine »).
    const state_ = week.to < today ? 'past' : (week.from <= today ? 'current' : 'coming');
    const stateLabel = state_ === 'past' ? 'passée' : (state_ === 'current' ? 'cette semaine' : '');
    const from = String(week.from || '');
    const jour = `${from.slice(8, 10)}/${from.slice(5, 7)}`;
    const actions = (week.actions || []).map((a, i) => {
      const actionId = mkwPlanActionId(week, i);
      const done = mkPlan.done[actionId];
      if (state_ === 'past') return `<li class="is-inert">${esc(a)}</li>`;
      return `<li class="${done ? 'is-done' : ''}">
        <button type="button" class="mkw-plan-check ${done ? 'is-done' : ''}" ${done ? 'disabled' : ''} aria-label="Marquer faite : ${esc(a)}"
          onclick="mkPlanActionDone('${escJs(actionId)}', ${Number(week.index) || 0}, ${i})">${done ? ci('check') : ''}</button>
        <span>${esc(a)}</span>
        ${done ? '<em class="mkw-plan-done-note">noté, je mesure</em>' : ''}
      </li>`;
    }).join('');
    return `<article class="mkw-plan-week tone-${conf.tone} ${state_ === 'past' ? 'is-past' : ''} ${state_ === 'current' ? 'is-current' : ''}">
      <div class="mkw-plan-week-head">
        <span class="mkw-plan-when"><strong>S${Number(week.index) || 0}</strong><small>dès le ${esc(jour)}</small>${stateLabel ? `<span class="mkw-plan-state">${stateLabel}</span>` : ''}</span>
        <span class="mkw-plan-conf">${esc(conf.label)}</span>
      </div>
      <h4 class="mkw-plan-goal">${esc(week.objectif || '')}</h4>
      <p class="mkw-plan-why">${esc(week.pourquoi || '')}</p>
      ${actions ? `<ul class="mkw-plan-actions">${actions}</ul>` : ''}
      ${state_ !== 'past' ? `<button type="button" class="mkw-link mkw-plan-studio" onclick="mkwGoStudio('${escJs(String(week.objectif || '').slice(0, 280))}')">Préparer ce post au Studio</button>` : ''}
    </article>`;
  }

  // « C'est fait » : la poignée qui ferme la boucle (audit 4.2 : planActionDone
  // existait côté serveur et AUCUN écran ne l'appelait : la mémoire
  // marketing_patterns ne pouvait jamais se remplir depuis le plan).
  window.mkPlanActionDone = async function (actionId, weekIndex, actionIndex) {
    if (mkPlan.done[actionId]) return;
    const week = ((mkPlan.data || {}).weeks || []).find((w) => Number(w.index) === Number(weekIndex));
    if (!week) return;
    mkPlan.done[actionId] = true;
    renderStaffCampaignsPage();
    try {
      await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({
          action: 'planActionDone',
          centerId: state.adminCenterId || 'libramont',
          planAction: {
            id: actionId,
            title: String((week.actions || [])[actionIndex] || 'Action du plan'),
            why: String(week.pourquoi || ''),
            channel: 'interne',
            targetDate: week.from,
          },
        }),
      });
      toast('Noté : je mesure l\'effet pendant 14 jours, le reçu arrive dans Résultats.');
    } catch (error) {
      // 409 = déjà notée côté serveur (il garde 7 jours de mémoire) : l'état
      // coché est donc VRAI. Toute autre erreur rétablit la case.
      if (!/409|deja|déjà/i.test(error.message || '')) {
        mkPlan.done[actionId] = false;
        toast(error.message || 'Je n\'ai pas pu le noter.');
      }
    } finally {
      scheduleCampaignsRender();
    }
  };

  function mkwPlan() {
    if (!mkPlan.loaded && !mkPlan.loading) setTimeout(() => loadMarketingPlan(), 0);
    // Construction live en cours : la timeline REELLE du Stratège (RUN B).
    if (mkPlan.jobId) {
      return `<section class="mkw-card">
        <div class="mkw-block-head"><h3>Je construis le plan</h3><span class="mkw-block-sub">chaque étape ci-dessous a réellement eu lieu</span></div>
        <div id="mkPlanProgress" class="mkw-plan-progress"></div>
      </section>`;
    }
    if (mkPlan.loading) {
      return `<section class="mkw-card">
        <div class="mkw-block-head"><h3>Les 8 prochaines semaines</h3></div>
        ${typeof renderThinking === 'function' ? renderThinking('working', { label: 'Traitement en cours' }) : '<div class="mkw-skel"></div>'}
      </section>`;
    }
    if (mkPlan.error) {
      return mkwErrorPanel(mkPlan.error, 'loadMarketingPlan(true)');
    }
    const plan = mkPlan.data;
    const weeks = (plan && plan.weeks) || [];
    if (!weeks.length) {
      return `<section class="mkw-card"><div class="empty-state">
        <div class="empty-state-title">Pas encore de plan</div>
        <div class="empty-state-text">Il se construit tout seul chaque lundi. Vous pouvez aussi le lancer maintenant et suivre chaque étape.</div>
        <button type="button" class="pv2-btn primary" onclick="mkPlanBuild()">Construire le plan</button>
      </div></section>`;
    }
    const dated = weeks.filter((w) => w.confiance !== 'routine').length;
    // L'honnêteté en tête de surface : tant qu'on n'a rien mesuré, on le dit.
    // C'est ce qui empêche le gérant de croire que le plan sait ce qui marche.
    const evidence = plan.context && plan.context.hasMeasuredEvidence
      ? `Le plan s’appuie sur ce qui a été mesuré chez vous.`
      : `Je n’ai pas encore assez de recul pour dire ce qui marche <strong>chez vous</strong>. Ce plan s’appuie sur les dates certaines : congés scolaires, jours fériés, événements près du centre.`;
    // La fraîcheur est AFFICHÉE (audit 4.2 : generatedAt existait, jamais rendu).
    const freshness = plan.generatedAt
      ? `construit le ${new Date(plan.generatedAt).toLocaleDateString('fr-BE', { day: 'numeric', month: 'long' })} à ${new Date(plan.generatedAt).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}`
      : '';
    return `<section class="mkw-card">
      <div class="mkw-block-head">
        <h3>Les 8 prochaines semaines</h3>
        <span class="mkw-block-sub">${dated} semaine${dated > 1 ? 's' : ''} avec une date à jouer${freshness ? ` · ${freshness}` : ''}</span>
      </div>
      <p class="mkw-quiet">${evidence}</p>
      <div class="mkw-plan-grid">${weeks.map(mkwPlanWeek).join('')}</div>
      <div class="mkw-riv-analyze">
        <button type="button" class="pv2-btn" onclick="mkPlanBuild()" ${mkPlan.busy ? 'disabled' : ''}>${mkPlan.busy ? 'Je reconstruis…' : 'Reconstruire le plan'}</button>
        <span class="mkw-quiet-inline">Il se refait tout seul chaque lundi.</span>
      </div>
    </section>`;
  }

  // Panneau d'erreur PARTAGÉ (audit §2 : l'état d'erreur était mort sur toute
  // la zone : squelettes à vie, aucun retry). Une erreur réseau dit qu'il y a
  // une erreur réseau, partout, avec un vrai bouton.
  function mkwErrorPanel(message, retryJs) {
    return `<section class="mkw-card mkw-error" role="alert">
      <div class="mkw-error-body">
        <span class="mkw-error-ico">${ci('inbox')}</span>
        <div>
          <p class="mkw-error-title">Je n’arrive pas à charger.</p>
          <p class="mkw-error-text">${esc(message || 'Le serveur n’a pas répondu.')}</p>
        </div>
      </div>
      <button type="button" class="pv2-btn primary" onclick="${retryJs}">Réessayer</button>
    </section>`;
  }

  // Pont universel vers le Studio (plan « Préparer ce post », riposte
  // concurrent « En faire un post ») : pré-remplit le brief et ouvre l'atelier.
  window.mkwGoStudio = function (brief) {
    mkBrief.studioBrief = String(brief || '').slice(0, 300);
    mkBrief.tab = 'studio';
    renderStaffCampaignsPage();
    setTimeout(() => { const el = document.getElementById('brStudioBrief'); if (el) el.focus(); }, 60);
  };

  /* ── LE BUREAU : fil + composer + tableau (refonte 2026-08-06) ───────────
     Le fil raconte le travail reel de l'agent (brief, propositions, demandes
     du gerant, reponses assemblees) ; le composer est fixe en bas du fil ;
     le tableau d'actions vit en colonne droite, sticky sur desktop. Tout le
     cablage d'action (ouvrir, copier, publier, ignorer, variante, remplir un
     jour calme) est inchange. ── */
  // LE CHAT. Vide : l'accueil facon Claude (grand bonjour, composer au
  // centre, suggestions dessous), le brief du matin en sous-titre reel.
  // Habite : le fil de messages (brief d'abord), composer ancre en bas.
  function mkwChat() {
    const b = mkBrief.data;
    if (!b && mkBrief.error) {
      return `<div class="mkw-chat">${mkwErrorPanel(mkBrief.error, 'loadMarketingBrief(true)')}</div>`;
    }
    if (!b) {
      return `<div class="mkw-chat"><section class="mkw-card">${typeof renderThinking === 'function' ? renderThinking('composing', { size: 64, label: 'L’agent prépare sa proposition' }) : '<div class="mkw-skel"></div>'}</section></div>`;
    }
    const empty = !mkw.thread.length && mkBrief.busy !== 'ask';
    if (empty) {
      // Le bonjour porte l'etat REEL du matin : pas une phrase decorative.
      const props = brVisiblePropositions().filter((p) => !mkBrief.published[p.key]).length;
      const sub = props
        ? `${props} proposition${props > 1 ? 's' : ''} vous attend${props > 1 ? 'ent' : ''} dans le panneau. Posez une question, ou décrivez ce que je dois préparer.`
        : `Rien d'urgent dans le panneau. Posez une question, ou décrivez ce que je dois préparer.`;
      return `<div class="mkw-chat is-hero" id="mkwChat">
        <div class="mkw-chat-hero">
          <h2 class="mkw-hello">${mkwAgentMark()}Bonjour.</h2>
          <p class="mkw-hello-brief">${brProse(b.brief ? b.brief.text : '')}</p>
          <p class="mkw-hello-sub">${esc(sub)}</p>
          ${mkwComposer()}
        </div>
      </div>`;
    }
    return `<div class="mkw-chat" id="mkwChat">
      <div class="mkw-chat-thread">
        <div class="mkw-chat-tools"><button type="button" class="mkw-link mkw-link-faint" onclick="mkwChatClear()">Nouvelle conversation</button></div>
        ${mkwChatBriefTurn()}
        ${mkwChatTurns()}
      </div>
      ${mkwComposer()}
    </div>`;
  }

  function mkwDesk() {
    // Le panneau ne vit JAMAIS dans la page : c'est un TIROIR monte dans
    // document.body (mkwSheetRender), colle au bord droit de l'ecran a toutes
    // les tailles : il sort du bord et y rentre (retour Movsar 2026-08-06).
    // Ici, seulement le chat ; le shell prend un padding anime quand le
    // tiroir est ouvert (classe mkw-has-panel posee au paint).
    return `<div class="mkw-desk" id="mkwFeed">${mkwChat()}</div>`;
  }

  // Une vue de PROFONDEUR (plan, studio, concurrents, résultats) : subordonnée
  // au fil, ouverte DEPUIS la conversation, avec un retour explicite.
  function mkwDepth(html) {
    return `<div class="mkw-depth">
      <button type="button" class="mkw-back" onclick="mkwTab('feed')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>Retour au bureau</button>
      ${html}
    </div>`;
  }

  function mkwSurface() {
    // Impact et le bureau dépendent du brief central : s'il a échoué et que rien
    // n'est affichable, une erreur franche avec retry (jamais des squelettes à vie).
    const briefDown = !mkBrief.data && mkBrief.error;
    switch (mkBrief.tab) {
      case 'plan': return mkwDepth(mkwPlan());
      case 'studio': return mkwDepth(mkwStudio());
      case 'rivals': return mkwDepth(mkwRivals());
      case 'results': return mkwDepth(briefDown ? mkwErrorPanel(mkBrief.error, 'loadMarketingBrief(true)') : mkwResults());
      case 'feed':
      case 'today':
      default: return mkwDesk();
    }
  }

  /* ── LE CHAMP DE POINTS VIVANT (fond de la toile, look "agent IA vivant") ──
     Un champ clairseme de points repartis sur TOUTE la toile (#mkwDots en
     position absolute inset:0 dans .mkw-shell, derriere le contenu). Trois
     comportements, tous tres discrets :
       (a) DERIVE : chaque point respire en continu (petite oscillation lente,
           amplitude de 1 a 3 px), le champ n'est jamais fige.
       (b) CURSEUR : les points proches du pointeur s'illuminent, grossissent
           un peu et sont doucement attires vers lui (fondu d'entree/sortie).
       (c) SCINTILLEMENT : ~1 point sur 6 voit son opacite osciller lentement.
     Regles dures (contrainte proprietaire : clairseme, jamais envahissant) :
       : couleur = valeur CALCULEE de var(--text) portee par le canvas (CSS
         `color: var(--text)`) : zero couleur en dur, parite light/dark auto ;
         seules les intensites (alpha) sont calibrees par theme, et TRES basses.
       : opacite plafonnee : le champ ne concurrence JAMAIS la lisibilite.
       : prefers-reduced-motion : AUCUNE boucle, aucun suivi curseur, un champ
         statique propre dessine une fois.
       : onglet cache (visibilitychange) : rAF coupe + listeners retires, repris
         au retour. Canvas hors DOM ou masque : la boucle s'arrete d'elle-meme.
         Zero fuite, zero rAF a vide, zero listener orphelin.
       : ~30 fps plafonnes, DPR-aware, culling vertical (on ne peint que la
         bande visible meme si la toile est plus haute que le viewport). */
  const mkwDots = {
    raf: 0, canvas: null, ctx: null, dots: [], t0: 0, last: 0, sizedAt: 0,
    w: 0, h: 0, genW: 0, genRows: 0, regen: false, color: '', base: 0.055, twk: 0.1, boost: 0.24, cap: 0.52,
    px: null, py: null, infl: 0, lpx: 0, lpy: 0, rect: null, onMove: null, onLeave: null,
  };
  const MKW_R = 130;              // rayon d'influence du curseur (px)
  const MKW_R2 = MKW_R * MKW_R;

  function mkwDotsStop() {
    if (mkwDots.raf) cancelAnimationFrame(mkwDots.raf);
    mkwDots.raf = 0;
    // Listeners curseur retires : zero fuite, jamais de doublon au remontage.
    if (mkwDots.onMove) { window.removeEventListener('pointermove', mkwDots.onMove); mkwDots.onMove = null; }
    if (mkwDots.onLeave) { document.removeEventListener('mouseleave', mkwDots.onLeave); window.removeEventListener('blur', mkwDots.onLeave); mkwDots.onLeave = null; }
    mkwDots.px = null; mkwDots.py = null; mkwDots.infl = 0;
  }

  const MKW_GAP = 46;            // maille du champ (px)
  const MKW_JIT = 7;             // jitter de position (px)
  // Champ CLAIRSEME : maille large + trous aleatoires + jitter = un scatter
  // regulier mais jamais rigide, jamais dense. Grille ANCREE EN HAUT (y = f(r)
  // seul, jamais de la hauteur totale) : quand la toile grandit (un fold qui
  // s'ouvre), on APPEND juste des rangees en bas, les points existants ne
  // bougent pas. Chaque point porte sa derive propre (phase/vitesse) et, pour
  // ~1 sur 6, un scintillement lent. `tw.m` = multiplicateur : l'amplitude
  // finale (twk du theme x m) est calculee a la peinture (theme sans rebuild).
  function mkwDotsAddRows(w, r0, r1, out) {
    const cols = Math.max(2, Math.round(w / MKW_GAP));
    const ox = (w - (cols - 1) * MKW_GAP) / 2;
    const oy = MKW_GAP / 2;
    for (let r = r0; r < r1; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        if (Math.random() < 0.14) continue;
        out.push({
          x: ox + c * MKW_GAP + (Math.random() * 2 - 1) * MKW_JIT,
          y: oy + r * MKW_GAP + (Math.random() * 2 - 1) * MKW_JIT,
          dpx: Math.random() * 6.283, dpy: Math.random() * 6.283,
          dsx: 0.10 + Math.random() * 0.16, dsy: 0.10 + Math.random() * 0.16,
          damp: 1.3 + Math.random() * 1.8,
          tw: Math.random() < 0.16 ? { m: 0.6 + Math.random() * 0.7, spd: 0.45 + Math.random() * 0.7, ph: Math.random() * 6.283 } : null,
        });
      }
    }
  }

  function mkwDotsSetup() {
    const canvas = mkwDots.canvas;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return false;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    mkwDots.ctx = ctx;
    // Couleur des points = valeur calculee du token --text (CSS du canvas). La
    // luminance dit le theme : texte clair = fond sombre. Recalcule a chaque
    // (re)montage : un changement de theme met a jour les intensites.
    const color = getComputedStyle(canvas).color || 'rgb(128,128,128)';
    mkwDots.color = color;
    const rgb = (color.match(/[\d.]+/g) || []).map(Number);
    const lum = rgb.length >= 3 ? (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000 : 200;
    const dark = lum > 140;
    // Intensites TRES basses (le champ ne doit jamais gener la lecture). Le
    // dark porte un peu plus car le contraste sur fond noir est plus doux.
    mkwDots.base = dark ? 0.06 : 0.05;
    mkwDots.twk = dark ? 0.10 : 0.075;
    mkwDots.boost = dark ? 0.26 : 0.18;
    mkwDots.cap = dark ? 0.54 : 0.42;
    mkwDots.w = w;
    mkwDots.h = h;
    // Positions STABLES entre deux rendus : un clic re-rend la page et recree le
    // canvas, mais le champ ne doit JAMAIS se reshuffler (ca clignoterait).
    //  : largeur changee (rare : sidebar, resize) -> champ neuf (regen).
    //  : hauteur qui grandit (un fold s'ouvre) -> on ajoute juste des rangees en
    //    bas, les points existants restent en place, l'horloge continue.
    //  : hauteur qui retrecit -> on garde les points (peints hors canvas, sans
    //    frais visible), l'horloge continue.
    const rowsNeeded = Math.max(2, Math.ceil((h - MKW_GAP / 2) / MKW_GAP) + 1);
    if (mkwDots.genW !== w || !mkwDots.dots.length) {
      mkwDots.dots = [];
      mkwDotsAddRows(w, 0, rowsNeeded, mkwDots.dots);
      mkwDots.genW = w;
      mkwDots.genRows = rowsNeeded;
      mkwDots.regen = true;
    } else {
      if (rowsNeeded > mkwDots.genRows) {
        mkwDotsAddRows(w, mkwDots.genRows, rowsNeeded, mkwDots.dots);
        mkwDots.genRows = rowsNeeded;
      }
      mkwDots.regen = false;
    }
    return true;
  }

  function mkwDotsPaint(t, animated) {
    const d = mkwDots;
    const ctx = d.ctx;
    ctx.clearRect(0, 0, d.w, d.h);
    ctx.fillStyle = d.color;
    const infl = d.infl;
    const hasPt = animated && infl > 0.002;
    const px = d.lpx;
    const py = d.lpy;
    // Culling vertical : la toile peut etre plus haute que le viewport. On ne
    // peint que la bande visible (+ marge pour la derive), l'horloge continue.
    let top = -24;
    let bot = d.h + 24;
    if (animated && d.rect) {
      const vis = -d.rect.top;
      top = vis - 48;
      bot = vis + window.innerHeight + 48;
    }
    for (const dot of d.dots) {
      let x = dot.x;
      let y = dot.y;
      if (animated) {
        x += Math.sin(t * dot.dsx + dot.dpx) * dot.damp;
        y += Math.cos(t * dot.dsy + dot.dpy) * dot.damp;
      }
      if (y < top || y > bot) continue;
      let a = d.base;
      let r = 1.05;
      if (animated && dot.tw) {
        const s = 0.5 + 0.5 * Math.sin(t * dot.tw.spd + dot.tw.ph);
        a += d.twk * dot.tw.m * s * s;
      }
      if (hasPt) {
        const dx = px - x;
        const dy = py - y;
        const dd = dx * dx + dy * dy;
        if (dd < MKW_R2) {
          const ff = (1 - dd / MKW_R2) * infl;   // 0..1, fondu par la presence
          a += d.boost * ff;
          r += 1.35 * ff;
          x += dx * 0.16 * ff;                    // attraction douce
          y += dy * 0.16 * ff;
        }
      }
      if (a <= 0.012) continue;
      ctx.globalAlpha = a < d.cap ? a : d.cap;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 6.2832);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function mkwDotsFrame(now) {
    const d = mkwDots;
    const canvas = d.canvas;
    // Canvas hors DOM (navigation) ou masque (autre page staff) : arret net.
    if (!canvas || !canvas.isConnected || canvas.offsetParent === null) { mkwDotsStop(); return; }
    d.raf = requestAnimationFrame(mkwDotsFrame);
    if (now - d.last < 32) return; // ~30 fps : fluide, sobre en CPU
    d.last = now;
    if (now - d.sizedAt > 500) {
      d.sizedAt = now;
      if (Math.abs(canvas.clientWidth - d.w) > 1 || Math.abs(canvas.clientHeight - d.h) > 1) mkwDotsSetup();
    }
    const rect = canvas.getBoundingClientRect();
    d.rect = rect;
    // Toile hors viewport : on saute la peinture, pas l'horloge.
    if (rect.bottom <= 0 || rect.top >= window.innerHeight) return;
    // Influence du curseur : fondu doux vers present (1) / absent (0). On garde
    // la derniere position locale pour que la sortie s'eteigne en douceur.
    const target = d.px !== null ? 1 : 0;
    d.infl += (target - d.infl) * 0.09;
    if (d.px !== null) { d.lpx = d.px - rect.left; d.lpy = d.py - rect.top; }
    mkwDotsPaint((now - d.t0) / 1000, true);
  }

  // La texture de fond a DEUX implementations, dans cet ordre :
  //   1. le halftone WebGL2 (pinlane-fx.js) : la trame de points pilotee par du
  //      bruit simplex, demandee par Movsar le 2026-07-28 ;
  //   2. a defaut (pas de WebGL2, contexte refuse, shader qui ne compile pas),
  //      le champ de points canvas 2D historique, inchange.
  // La bascule est silencieuse : la page a toujours une texture, jamais un trou.
  let mkwFxStop = null;

  function mkwDotsInit() {
    mkwDotsStop();
    if (mkwFxStop) { mkwFxStop(); mkwFxStop = null; }
    let canvas = document.getElementById('mkwDots');
    if (!canvas) return;
    if (typeof window.plFxHalftone === 'function') {
      mkwFxStop = window.plFxHalftone(canvas, { cell: 10, frequency: 5, speed: 0.5, gamma: 2, bias: 0, drift: 0.5, mouseRadius: 170, alpha: 0.42 });
      if (mkwFxStop) { mkwDots.canvas = null; return; }
      // Echec APRES la prise du contexte (shader refuse) : ce noeud est marque
      // « webgl » a vie, getContext('2d') y rendrait null et la page perdrait
      // toute texture. On lui substitue un canvas neuf pour que le champ 2D
      // puisse reprendre la main.
      const fresh = canvas.cloneNode(false);
      if (canvas.parentNode) canvas.parentNode.replaceChild(fresh, canvas);
      canvas = fresh;
    }
    mkwDots.canvas = canvas;
    if (!mkwDotsSetup()) return;
    if (reducedMotion) { mkwDots.rect = null; mkwDotsPaint(0, false); return; }
    // Horloge PRESERVEE tant que le champ vit : un re-render (clic) ne remet pas
    // la derive a zero, sinon les points sauteraient. On repart de t0 seulement
    // pour un champ fraichement genere (premier montage ou changement de taille).
    const now = performance.now();
    if (mkwDots.regen || !mkwDots.t0) mkwDots.t0 = now;
    mkwDots.last = 0;
    mkwDots.sizedAt = now;
    mkwDots.px = null; mkwDots.py = null; mkwDots.infl = 0;
    mkwDots.rect = canvas.getBoundingClientRect();
    // Suivi du curseur : listeners GLOBAUX (le canvas est pointer-events:none),
    // retires proprement dans mkwDotsStop (zero fuite, jamais de doublon).
    mkwDots.onMove = (e) => { mkwDots.px = e.clientX; mkwDots.py = e.clientY; };
    mkwDots.onLeave = () => { mkwDots.px = null; mkwDots.py = null; };
    window.addEventListener('pointermove', mkwDots.onMove, { passive: true });
    document.addEventListener('mouseleave', mkwDots.onLeave, { passive: true });
    window.addEventListener('blur', mkwDots.onLeave, { passive: true });
    mkwDotsPaint(0, true);
    mkwDots.raf = requestAnimationFrame(mkwDotsFrame);
  }

  // La marque de l'agent en particules (pinlane-fx.js) : les points arrivent
  // disperses, s'assemblent en la marque, et fuient le curseur avant de se
  // reformer. La forme echantillonnee est le PATH de mkwAgentMark : la texture
  // porte l'identite de la page, elle n'est pas un decor interchangeable.
  // Sans le module (fichier absent, Path2D indisponible), la vignette reste
  // vide et l'en-tete tient tout seul : aucune dependance dure.
  let mkwMarkStop = null;
  function mkwMarkInit() {
    if (mkwMarkStop) { mkwMarkStop(); mkwMarkStop = null; }
    const canvas = document.getElementById('mkwMarkFx');
    if (!canvas || typeof window.plFxMark !== 'function') return;
    mkwMarkStop = window.plFxMark(canvas, { path: MKW_MARK_PATH, viewBox: 24, gap: 2, radius: 46 });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { mkwDotsStop(); return; }
    const canvas = mkwDots.canvas;
    // Retour d'onglet : on re-initialise tout (setup + listeners + boucle),
    // jamais un simple redemarrage de rAF qui laisserait les listeners morts.
    if (!mkwDots.raf && canvas && canvas.isConnected && !reducedMotion) mkwDotsInit();
  });

  window.renderStaffCampaignsPage = function () {
    const root = document.getElementById('staffCampaignsPage');
    if (!root) return;
    // Meme garde que la page Emails : le focus et le curseur du champ actif
    // survivent au re-rendu (bug « on ne peut plus ecrire », 2026-08-05).
    // FILET ANTI-NOIR : une exception de rendu ne laisse JAMAIS une zone
    // vide silencieuse : l'erreur s'affiche avec un vrai bouton, et un
    // re-essai automatique unique couvre les courses passageres.
    const paint = () => {
      try {
        renderStaffCampaignsPaint(root);
      } catch (error) {
        console.error('Marketing paint:', error);
        root.innerHTML = `<div class="pv2-shell mkw-shell"><section class="mkw-card mkw-error" role="alert">
          <div class="mkw-error-body"><div>
            <p class="mkw-error-title">L'affichage a buté.</p>
            <p class="mkw-error-text">Je réessaie tout seul ; si rien ne vient, ce bouton relance.</p>
          </div></div>
          <button type="button" class="pv2-btn primary" onclick="renderStaffCampaignsPage()">Réessayer</button>
        </section></div>`;
        if (!window.__mkwPaintRetry) {
          window.__mkwPaintRetry = true;
          setTimeout(() => { window.renderStaffCampaignsPage(); }, 450);
        }
      }
    };
    if (typeof PinlaneMotion !== 'undefined' && PinlaneMotion.garderFocus) PinlaneMotion.garderFocus(paint);
    else paint();
  };

  function renderStaffCampaignsPaint(root) {
    // LE CENTRE GOUVERNE : si le centre sélectionné a changé, TOUT l'état
    // marketing est remis à zéro avant de peindre. Sans ça, un gérant qui
    // bascule sur Gembloux voyait le brief, la veille et le plan de Libramont
    // (les gardes `data && !force` bloquaient tout rechargement).
    // La PORTEE = centre + compte connecte : changer l'un ou l'autre remet
    // l'etat a zero ET charge l'historique de chat PERSONNEL de ce compte
    // (chaque code d'acces a sa conversation, demande Movsar 2026-08-06).
    const scopeNow = mkwChatKey();
    if (mkw.loadedCenter && mkw.loadedCenter !== scopeNow) {
      Object.assign(mkBrief, {
        data: null, loading: false, error: '', payOpen: false,
        openCard: null, cardNetwork: {}, angleOpen: null, publishedAsk: null,
        receiptsAll: false, busy: '', published: {}, dismissed: {}, askDraft: '',
        studioPacks: {}, studioPacksLoaded: false, studioBusy: false, _seenData: false,
      });
      Object.assign(mkComp, { data: null, loading: false, error: '', postResult: null, postDraft: '' });
      Object.assign(mkPlan, { data: null, loaded: false, loading: false, error: '', jobId: null, done: {} });
      mkw.knownKeys = null;
      mkw.focusRival = '';
      mkwChatLoad();
    }
    if (!mkw.loadedCenter) {
      mkwChatLoad();
      // Sur petit ecran, la conversation passe d'abord : le panneau (feuille
      // plein bord) demarre FERME et s'ouvre par le bouton de l'en-tete.
      if (window.innerWidth <= 900) mkw.panelOpen = false;
    }
    mkw.loadedCenter = scopeNow;
    if (!mkBrief.data && !mkBrief.loading && !mkBrief.error) setTimeout(() => loadMarketingBrief(), 0);
    // L'arrivee d'une action NEUVE s'anime ; le chargement initial, jamais :
    // au premier paint avec donnees, toutes les cartes sont « connues ».
    if (mkBrief.data && !mkw.knownKeys) mkw.knownKeys = new Set(brVisiblePropositions().map((p) => p.key));
    // Entrée en scène UNE fois : en changeant de vue, ou à l'arrivée de la
    // première donnée. Jamais sur un clic in-view (sinon tout le fil clignote).
    const gotFirstData = mkBrief.data && !mkBrief._seenData;
    if (mkBrief.data) mkBrief._seenData = true;
    const enter = !reducedMotion && (mkwPrevTab !== mkBrief.tab || gotFirstData);
    mkwPrevTab = mkBrief.tab;
    // La toile de fond vit HORS du shell : elle est en position fixe et couvre
    // tout l'ecran (demande de Movsar du 2026-07-28 : « ca doit prendre tout le
    // fond de la page, vraiment tout »). Elle reste enfant de la page Marketing
    // pour mourir avec elle : aucune texture ne survit quand on change de page.
    root.innerHTML = `<canvas class="mkw-dots" id="mkwDots" aria-hidden="true"></canvas>
    <div class="pv2-shell mkw-shell">
      ${mkwHead()}
      <div class="mkw-surface ${enter ? 'mkw-in' : ''}">${mkwSurface()}</div>
    </div>`;
    // Les cartes neuves gardent leur entree (.is-new) le temps de l'animation
    // (240 ms) MEME si un repaint immediat suit (mkwShowProp re-rend juste
    // apres une creation) : la cle n'est marquee connue qu'apres 420 ms.
    if (mkBrief.data && mkw.knownKeys) {
      const freshKeys = brVisiblePropositions().map((p) => p.key).filter((k) => !mkw.knownKeys.has(k));
      if (freshKeys.length) setTimeout(() => { freshKeys.forEach((k) => mkw.knownKeys.add(k)); }, 420);
    }
    // Meme fenetre pour l'entree des tours du chat : les tours frais gardent
    // leur animation a travers un repaint immediat, puis sont absorbes (le
    // flag answerFresh d'une reponse fraichement arrivee meurt avec elle).
    if (mkw.thread.length > mkw.painted || mkw.thread.some((t) => t.answerFresh)) {
      const target = mkw.thread.length;
      setTimeout(() => {
        if (mkw.painted < target) mkw.painted = target;
        mkw.thread.forEach((t) => { if (t.answerFresh) delete t.answerFresh; });
      }, 520);
    }
    // Deep-link avec intention : le concurrent cible arrive en evidence, puis
    // la mise en avant s'eteint (etat consomme, pas un marquage a vie).
    if (mkw.focusRival && mkBrief.tab === 'rivals') {
      const target = root.querySelector(`[data-riv-name="${CSS.escape(mkw.focusRival)}"]`);
      if (target) {
        setTimeout(() => {
          target.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });
          setTimeout(() => { target.classList.remove('is-focus'); mkw.focusRival = ''; }, 1600);
        }, 60);
      } else if (mkComp.data) { mkw.focusRival = ''; }
    }
    // La texture vivante : (re)démarrée sur le canvas fraîchement rendu
    // (l'ancienne boucle est coupée dans l'init : zéro doublon, zéro fuite).
    // La classe de poussee : quand le tiroir est ouvert sur grand ecran, le
    // shell reserve sa place (padding-right anime) et le chat se recentre.
    root.classList.toggle('mkw-has-panel', Boolean(mkw.panelOpen && mkBrief.tab === 'feed' && !mkwIsMobile()));
    mkwSheetRender();
    mkwDotsInit();
    mkwMarkInit();
    mount(root, 'campaigns');
  };

  /* ==========================================================================
     TARIFS : catalog grid
     ======================================================================== */

  window.pv2SelectPricing = function (id) {
    state.staffPricingSelectedId = id;
    save();
    renderStaffPricingPage();
  };

  window.pv2PricingFilter = function (key) {
    state.staffPricingFilter = key;
    save();
    renderStaffPricingPage();
  };

  /* ==========================================================================
     TARIFS : editeur client (override par centre, permission pricing.manage)
     Branche sur GET clientCatalog (prefill) + POST saveClientFormuleOverride /
     resetClientFormuleOverride. Chaque ecriture est SIGNEE du centre AFFICHE
     (pevBody ajoute centerId) : le serveur VALIDE ce centre (centers.switch +
     barriere inter-clients) puis il fait foi ; la session n'est qu'un repli.
     Correctif du 2026-08-21 : sans cette signature, l'edition d'un fondateur
     multi-centres partait sur le centre de sa SESSION, pas celui de l'ecran.
     La modale vit dans document.body pour survivre
     aux reconstructions innerHTML de la page. Etat hors DOM (pricingEditor),
     encapsule dans cet IIFE, pas de variable globale sauvage.
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
    modal: null,          // null | { formuleId }
    original: null,       // snapshot effectif a l'ouverture (pour le diff)
    draft: null,          // valeurs en cours d'edition
    saving: false,
    resetting: false,
    modalError: '',
  };

  function pevEq(a, b) {
    return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
  }
  function pevClampPrice(raw) {
    const v = Number(raw);
    if (!Number.isFinite(v)) return null;
    return Math.min(PEV_PRICE_MAX, Math.max(PEV_PRICE_MIN, v));
  }
  function pevToast(message) {
    if (typeof toast === 'function') toast(message);
  }
  function pevEntry(formuleId) {
    return formuleId ? (pricingEditor.byId.get(String(formuleId)) || null) : null;
  }

  // Vue d'une ligne du catalogue analytics enrichie de l'etat editable courant
  // (nom/prix effectifs + badges), sans jamais casser l'analytics existante :
  // sans entree chargee, on retombe sur les valeurs statiques de la ligne.
  function pevRowView(row) {
    const sourceId = row && row.sourceId ? String(row.sourceId) : '';
    const entry = pevEntry(sourceId);
    if (!entry || !entry.effective) {
      return { editable: Boolean(sourceId), sourceId, title: row.title, price: row.price, personnalise: false, removed: false };
    }
    const eff = entry.effective;
    return {
      editable: true,
      sourceId,
      title: eff.name != null ? eff.name : row.title,
      price: eff.priceValue != null ? eff.priceValue : row.price,
      personnalise: Boolean(entry.centerOverride),
      removed: Boolean(eff.removed),
    };
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
  window.pevLiveFormules = function () {
    if (!pricingEditor.loaded) return null;
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
    // Une modale ouverte sur une formule du centre QUITTE editerait une entree
    // qui n'existe plus ici : on la ferme avec son brouillon.
    pricingEditor.modal = null;
    pricingEditor.original = null;
    pricingEditor.draft = null;
    pricingEditor.modalError = '';
  };

  function pevModalBody() {
    if (!pricingEditor.modal || !pricingEditor.draft) return '';
    const d = pricingEditor.draft;
    return `${pricingEditor.modalError ? `<div class="pev-modal-error" role="alert">${esc(pricingEditor.modalError)}</div>` : ''}
      <div class="field pev-field">
        <label for="pevName">Nom affiché</label>
        <input id="pevName" type="text" maxlength="${PEV_NAME_MAX}" value="${d.name == null ? '' : esc(d.name)}" data-autofocus oninput="pevSet('name', this.value)">
        <span class="field-hint">Laissez le nom du catalogue pour ne pas le changer.</span>
      </div>
      <div class="pev-grid2">
        <div class="field pev-field">
          <label for="pevPrice">Prix par personne (EUR)</label>
          <input id="pevPrice" type="number" step="1" min="${PEV_PRICE_MIN}" max="${PEV_PRICE_MAX}" value="${d.priceValue == null ? '' : esc(d.priceValue)}" oninput="pevSetNum('priceValue', this.value)">
        </div>
        <div class="field pev-field">
          <label for="pevOld">Ancien prix barré (EUR)</label>
          <input id="pevOld" type="number" step="1" min="${PEV_PRICE_MIN}" max="${PEV_PRICE_MAX}" value="${d.priceOld == null ? '' : esc(d.priceOld)}" oninput="pevSetNum('priceOld', this.value)">
          <span class="field-hint">Affiché barré à côté du prix. Vide = aucun.</span>
        </div>
      </div>
      <div class="pev-toggle-row">
        <span class="pev-toggle-label">Disponible à la réservation<small>Décochée, l'offre n'est plus réservable dans ce centre mais reste au catalogue.</small></span>
        <button type="button" class="mk-switch ${d.enabled ? 'is-on' : ''}" role="switch" aria-checked="${d.enabled ? 'true' : 'false'}" aria-label="Disponible à la réservation" onclick="pevToggle('enabled', this)"><span></span></button>
      </div>
      <div class="pev-toggle-row">
        <span class="pev-toggle-label">Retirer du catalogue<small>La formule disparaît du tunnel de réservation de ce centre.</small></span>
        <button type="button" class="mk-switch ${d.removed ? 'is-on' : ''}" role="switch" aria-checked="${d.removed ? 'true' : 'false'}" aria-label="Retirer du catalogue" onclick="pevToggle('removed', this)"><span></span></button>
      </div>`;
  }

  function pevModalFoot() {
    if (!pricingEditor.modal) return '';
    const entry = pevEntry(pricingEditor.modal.formuleId);
    const hasOverride = Boolean(entry && entry.centerOverride);
    const busy = pricingEditor.saving || pricingEditor.resetting;
    return `<span class="pev-foot-note">Chaque enregistrement est tracé au journal.</span>
      ${hasOverride ? `<button type="button" class="btn btn-ghost" ${busy ? 'disabled' : ''} onclick="pevReset()">${pricingEditor.resetting ? 'Réinitialisation...' : 'Réinitialiser'}</button>` : ''}
      <button type="button" class="btn btn-ghost" ${busy ? 'disabled' : ''} onclick="pevCloseModal()">Annuler</button>
      <button type="button" class="btn btn-primary" ${busy ? 'disabled' : ''} onclick="pevSave()">${pricingEditor.saving ? 'Enregistrement...' : 'Enregistrer'}</button>`;
  }

  function pevModalTitle() {
    const entry = pevEntry(pricingEditor.modal && pricingEditor.modal.formuleId);
    const draftName = pricingEditor.draft && pricingEditor.draft.name;
    return draftName || (entry && entry.name) || 'Formule';
  }

  function pevSyncModal() {
    const existing = document.getElementById('pevOverlay');
    if (!pricingEditor.modal) { if (existing) existing.remove(); return; }
    if (existing) return; // deja monte : corps/pied rafraichis en place
    const overlay = document.createElement('div');
    overlay.id = 'pevOverlay';
    overlay.className = 'overlay-backdrop pev-overlay';
    overlay.innerHTML = `<div class="modal-surface pev-modal" role="dialog" aria-modal="true" aria-labelledby="pevModalTitle">
      <div class="pev-modal-head">
        <div><h3 id="pevModalTitle">${esc(pevModalTitle())}</h3><p>Ajustez le tarif de cette formule pour ce centre. Le prix par personne va de 0 à 1000 €.</p></div>
        <button type="button" class="pev-close" aria-label="Fermer" ${pricingEditor.saving || pricingEditor.resetting ? 'disabled' : ''} onclick="pevCloseModal()">&times;</button>
      </div>
      <div class="pev-modal-body">${pevModalBody()}</div>
      <div class="pev-modal-foot">${pevModalFoot()}</div>
    </div>`;
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay && !pricingEditor.saving && !pricingEditor.resetting) window.pevCloseModal();
    });
    document.body.appendChild(overlay);
    requestAnimationFrame(() => {
      const f = overlay.querySelector('[data-autofocus]');
      if (f) { try { f.focus(); } catch (_) { /* focus best effort */ } }
    });
  }

  function pevRefreshBody() {
    const body = document.querySelector('#pevOverlay .pev-modal-body');
    if (body) body.innerHTML = pevModalBody();
  }
  function pevRefreshFoot() {
    const foot = document.querySelector('#pevOverlay .pev-modal-foot');
    if (foot) foot.innerHTML = pevModalFoot();
    const close = document.querySelector('#pevOverlay .pev-close');
    if (close) close.disabled = pricingEditor.saving || pricingEditor.resetting;
  }

  // Ferme sans garde (apres une ecriture reussie : les flags busy sont remis).
  function pevDismissModal() {
    pricingEditor.modal = null;
    pricingEditor.original = null;
    pricingEditor.draft = null;
    pricingEditor.saving = false;
    pricingEditor.resetting = false;
    pricingEditor.modalError = '';
    const overlay = document.getElementById('pevOverlay');
    if (overlay) overlay.remove();
  }

  window.pevOpenEdit = function (formuleId) {
    const entry = pevEntry(formuleId);
    if (!entry || !entry.effective) {
      pevToast('Catalogue en cours de chargement, réessaie dans un instant.');
      pevEnsureLoaded();
      return;
    }
    const eff = entry.effective;
    const snapshot = {
      name: eff.name != null ? String(eff.name) : '',
      priceValue: eff.priceValue != null ? Number(eff.priceValue) : null,
      priceOld: eff.priceOld != null ? Number(eff.priceOld) : null,
      enabled: eff.enabled !== false,
      removed: Boolean(eff.removed),
    };
    pricingEditor.original = { ...snapshot };
    pricingEditor.draft = { ...snapshot };
    pricingEditor.modalError = '';
    pricingEditor.saving = false;
    pricingEditor.resetting = false;
    pricingEditor.modal = { formuleId: String(formuleId) };
    pevSyncModal();
  };

  window.pevSet = function (path, value) {
    if (!pricingEditor.draft) return;
    if (path === 'name') pricingEditor.draft.name = String(value == null ? '' : value);
  };
  window.pevSetNum = function (path, raw) {
    if (!pricingEditor.draft) return;
    if (path !== 'priceValue' && path !== 'priceOld') return;
    if (raw === '' || raw == null) { pricingEditor.draft[path] = null; return; }
    pricingEditor.draft[path] = pevClampPrice(raw);
  };
  window.pevToggle = function (path, btn) {
    if (!pricingEditor.draft) return;
    if (path !== 'enabled' && path !== 'removed') return;
    const next = !pricingEditor.draft[path];
    pricingEditor.draft[path] = next;
    if (btn && btn.classList) {
      btn.classList.toggle('is-on', next);
      btn.setAttribute('aria-checked', String(next));
    }
  };
  window.pevCloseModal = function () {
    if (pricingEditor.saving || pricingEditor.resetting) return;
    pevDismissModal();
  };

  // Patch PARTIEL : seuls les champs reellement changes voyagent. Les cles
  // suivent le contrat serveur (name, priceValue, priceOld, enabled, removed).
  // JAMAIS de centerId : le serveur force le centre de session.
  function pevComputePatch() {
    const o = pricingEditor.original || {};
    const d = pricingEditor.draft || {};
    const patch = {};
    if (!pevEq(d.name, o.name)) patch.name = String(d.name == null ? '' : d.name).trim().slice(0, PEV_NAME_MAX);
    if (!pevEq(d.priceValue, o.priceValue)) patch.priceValue = d.priceValue;
    if (!pevEq(d.priceOld, o.priceOld)) patch.priceOld = d.priceOld;
    if (!pevEq(d.enabled, o.enabled)) patch.enabled = Boolean(d.enabled);
    if (!pevEq(d.removed, o.removed)) patch.removed = Boolean(d.removed);
    return patch;
  }

  window.pevSave = function () {
    if (pricingEditor.saving || pricingEditor.resetting || !pricingEditor.modal) return;
    const patch = pevComputePatch();
    if (!Object.keys(patch).length) { pevToast('Aucun changement à enregistrer.'); return; }
    if ('priceValue' in patch && (patch.priceValue == null || !Number.isFinite(patch.priceValue))) {
      pricingEditor.modalError = 'Indiquez un prix par personne entre 0 et 1000 €.';
      pevRefreshBody(); pevRefreshFoot();
      return;
    }
    if ('name' in patch && !patch.name) {
      pricingEditor.modalError = 'Le nom ne peut pas être vide. Réinitialise pour revenir au nom du catalogue.';
      pevRefreshBody(); pevRefreshFoot();
      return;
    }
    pricingEditor.saving = true;
    pricingEditor.modalError = '';
    pevRefreshFoot();
    const formuleId = pricingEditor.modal.formuleId;
    apiRequest(`${API_ENDPOINTS.ops || '/api/ops'}`, {
      method: 'POST',
      body: pevBody({ action: 'saveClientFormuleOverride', formuleId, patch }),
    }).then(() => {
      pevToast('Tarif mis à jour.');
      pevDismissModal();
      pevReload();
    }).catch((error) => {
      pricingEditor.saving = false;
      pricingEditor.modalError = (error && error.message) || 'Enregistrement refusé. Réessayez.';
      pevRefreshBody(); pevRefreshFoot();
    });
  };

  window.pevReset = function () {
    if (pricingEditor.saving || pricingEditor.resetting || !pricingEditor.modal) return;
    pricingEditor.resetting = true;
    pricingEditor.modalError = '';
    pevRefreshFoot();
    const formuleId = pricingEditor.modal.formuleId;
    apiRequest(`${API_ENDPOINTS.ops || '/api/ops'}`, {
      method: 'POST',
      body: pevBody({ action: 'resetClientFormuleOverride', formuleId }),
    }).then(() => {
      pevToast('Tarif réinitialisé.');
      pevDismissModal();
      pevReload();
    }).catch((error) => {
      pricingEditor.resetting = false;
      pricingEditor.modalError = (error && error.message) || 'Réinitialisation refusée. Réessayez.';
      pevRefreshBody(); pevRefreshFoot();
    });
  };

  if (!window.__pevKeydownBound) {
    window.__pevKeydownBound = true;
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && pricingEditor.modal && !pricingEditor.saving && !pricingEditor.resetting) {
        e.preventDefault();
        window.pevCloseModal();
      }
    });
  }

  /* ==========================================================================
     CATALOGUE DE L ENTREPRISE : editeur de STRUCTURE (permission settings.manage)
     Distinct de l'editeur "mon centre" (pev, prix/dispo/retrait par centre) :
     ici on edite le CATALOGUE lui-meme (formules, activites d'une formule),
     partage par tous les centres de LA MEME ENTREPRISE. Branche sur le CRUD
     backend (createFormula / updateFormula / setFormulaSteps / deleteFormula).
     Aucune ecriture n'envoie de centerId : le serveur force le centre de
     session et en deduit l'entreprise proprietaire (migration 0042). Depuis
     cette migration, aucune de ces actions n'a le moindre effet chez un autre
     client : les textes ci-dessous le disent, parce qu'ils disaient l'inverse
     et que c'etait faux. Meme mecanique modale que pev : etat hors DOM
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
      return `<option value="${escJs(a.id)}"${a.id === step.activityId ? ' selected' : ''}>${esc(label)}</option>`;
    }).join('');
    // Activite absente de la liste (pseudo-activite typee a la main, ou activite
    // retiree) : on l'ajoute pour NE PAS perdre la valeur courante a l'enregistrement.
    const extra = (!known && step.activityId)
      ? `<option value="${escJs(step.activityId)}" selected>${esc(step.activityId)} (hors catalogue)</option>`
      : '';
    return `<div class="cev-step" data-cev-step="${index}">
      <div class="cev-step-order">
        <span class="cev-step-num" aria-hidden="true">${index + 1}</span>
        <button type="button" class="cev-step-move" data-cev-move-up="${index}" aria-label="Monter l activite" ${index === 0 ? 'disabled' : ''} onclick="cevStepMove(${index}, -1)">&uarr;</button>
        <button type="button" class="cev-step-move" data-cev-move-down="${index}" aria-label="Descendre l activite" ${index === total - 1 ? 'disabled' : ''} onclick="cevStepMove(${index}, 1)">&darr;</button>
      </div>
      <div class="cev-step-grid">
        <label class="cev-step-field cev-step-activity"><span>Activite</span>
          <select data-cev-field="activityId" data-cev-idx="${index}" onchange="cevStepSetActivity(${index}, this.value)">
            <option value="">Choisir une activite</option>
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
      <button type="button" class="cev-step-remove" data-cev-remove="${index}" aria-label="Retirer l activite" onclick="cevStepRemove(${index})">&times;</button>
    </div>`;
  }

  function cevStepsListHtml() {
    const steps = catalogEditor.steps || [];
    const activities = pricingEditor.activities || [];
    return steps.length
      ? steps.map((step, index) => cevStepRowHtml(step, index, activities, steps.length)).join('')
      : '<p class="cev-steps-empty">Aucune activite. Ajoutez-en une.</p>';
  }

  function cevStepsEditorHtml() {
    return `<div class="cev-steps">
      <div class="cev-steps-head"><span>Activites de la formule</span><small>L'ordre est le deroule reel. Au moins une activite.</small></div>
      <div class="cev-steps-list" id="cevStepsList">${cevStepsListHtml()}</div>
      <button type="button" class="btn btn-secondary btn-sm" id="cevAddStep" onclick="cevStepAdd()">+ Ajouter une activite</button>
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
          <label for="cevPrice">Prix (EUR)</label>
          <input id="cevPrice" type="number" min="0" max="1000" step="1" value="${f.priceValue == null ? '' : esc(f.priceValue)}" oninput="cevFieldNum('priceValue', this.value)">
        </div>
        <div class="field">
          <label for="cevOldPrice">Ancien prix barre (EUR)</label>
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
        <label>Jours valides <span class="cev-hint-inline">(aucun coche = tous les jours)</span></label>
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
    if (!cevCanManage()) { pevToast('Edition du catalogue reservee a la direction.'); return; }
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
    if (!cevCanManage()) { pevToast('Edition du catalogue reservee a la direction.'); return; }
    const entry = pevEntry(formuleId);
    if (!entry) { pevToast('Catalogue en cours de chargement, reessaie dans un instant.'); pevEnsureLoaded(); return; }
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
    if (!cevCanManage()) { pevToast('Edition du catalogue reservee a la direction.'); return; }
    const entry = pevEntry(formuleId);
    if (!entry) { pevToast('Catalogue en cours de chargement, reessaie dans un instant.'); pevEnsureLoaded(); return; }
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
    cevSubmit({ action: 'setFormulaSteps', id, steps: stepList }, 'Activites de la formule mises a jour.');
  }

  function cevSaveFields() {
    const id = catalogEditor.modal && catalogEditor.modal.formuleId;
    if (!id) return;
    const f = catalogEditor.fields || {};
    if (!String(f.name || '').trim()) { cevFail('Le nom ne peut pas etre vide.'); return; }
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
    cevSubmit({ action: 'updateFormula', id, patch }, 'Structure de la formule mise a jour.');
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
    if (!cevCanManage()) { pevToast('Edition du catalogue reservee a la direction.'); return; }
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
    return mode === 'steps' ? `Activites : ${name}` : `Structure : ${name}`;
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

  // ── UNE carte par offre ───────────────────────────────────────────────────
  // La page montrait la MEME formule deux fois : une carte (grille, figee sur
  // la constante) ET une ligne « Catalogue partage » (vive). Une seule carte
  // porte desormais tout : nom/prix effectifs du centre, contenu, usage, et
  // ses DEUX niveaux d'action (tarif du centre / structure partagee).
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

  function pricingCardHtml(row, view, { selected, ranking, index, canManage }) {
    const isFormula = Boolean(view.sourceId);
    const catalogRow = isFormula && pricingEditor.byId ? pricingEditor.byId.get(String(view.sourceId)) : null;
    const missingHere = isFormula ? missingIngredientsFor(catalogRow) : [];
    const closedDayWarning = isFormula ? closedDayWarningFor(catalogRow) : '';
    const badges = [
      row.source === 'custom' ? '<span class="pv2-chip amber">Ajoutée</span>' : '',
      view.removed ? '<span class="pv2-chip red">Retirée de ce centre</span>' : '',
      view.personnalise && !view.removed ? '<span class="pv2-chip amber">Tarif personnalisé</span>' : '',
      row.best ? '<span class="pv2-chip accent">Best deal</span>' : '',
      missingHere.length
        ? `<span class="pv2-chip red">Pas réalisable ici : il manque ${missingHere.map((name) => esc(name)).join(', ')}</span>`
        : '',
      closedDayWarning ? `<span class="pv2-chip red">${esc(closedDayWarning)}</span>` : '',
    ].filter(Boolean).join('');
    // Une carte sans reservation sur 30 jours n affiche rien : « Aucune
    // réservation liée » se repetait sur chaque carte de la page.
    const usage = Number(row.count)
      ? `<div class="pv2-price-stats" title="Sur les 30 derniers jours, hors annulations">
          <span><strong>${Number(row.count)}</strong> ${Number(row.count) > 1 ? 'réservations' : 'réservation'}</span>
          <span><strong>${Number(row.players) || 0}</strong> ${Number(row.players) > 1 ? 'joueurs' : 'joueur'}</span>
          <span><strong>${money(row.revenue)}</strong></span>
          <span><strong>${money(Number(row.revenue || 0) / Number(row.count))}</strong> panier moyen</span>
        </div>`
      : '';
    // Pied de carte : l'action du CENTRE en premier (celle de tous les jours),
    // les deux actions de catalogue ensuite, la suppression reduite a une icone.
    // Les trois actions d'edition vivent dans .pev-foot-main : c'est ce groupe
    // qui se replie, dans la colonne souple de la grille, pendant que la
    // corbeille garde SA colonne. Sans lui, le flex-wrap posait la corbeille
    // seule a l'extreme droite d'un troisieme rang (mesure : pied 239x77,
    // enfants a y=11/13/49, corbeille a x=209 y=49).
    const actions = isFormula ? `<div class="pev-card-foot">
        <div class="pev-foot-main">
        <button type="button" class="pv2-btn sm" data-pev-edit="${escJs(view.sourceId)}" onclick="event.stopPropagation();pevOpenEdit('${escJs(view.sourceId)}')">Tarif du centre</button>
        ${canManage ? `
        <button type="button" class="pv2-btn sm" data-cev-steps="${escJs(view.sourceId)}" onclick="event.stopPropagation();cevOpenSteps('${escJs(view.sourceId)}')">Activités</button>
        <button type="button" class="pv2-btn sm" data-cev-fields="${escJs(view.sourceId)}" onclick="event.stopPropagation();cevOpenFields('${escJs(view.sourceId)}')">Structure</button>` : ''}
        </div>
        ${canManage ? `<button type="button" class="pv2-btn sm cev-danger pev-foot-danger" data-cev-delete="${escJs(view.sourceId)}" title="Supprimer du catalogue" aria-label="Supprimer ${esc(view.title || 'cette formule')} du catalogue" onclick="event.stopPropagation();cevDelete('${escJs(view.sourceId)}')"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg></button>` : ''}
      </div>` : '';
    return `<article class="pv2-price-card ${selected ? 'selected' : ''}${view.removed ? ' pev-removed' : ''}"
      ${isFormula ? `data-cev-formula="${escJs(view.sourceId)}"` : ''} onclick="pv2SelectPricing('${escJs(row.id)}')">
      <div class="pv2-price-head">
        <div>${ranking !== 'default' && index < 3 && (Number(row.count) || Number(row.revenue)) ? `<span class="pv2-rank">#${index + 1}</span>` : ''}<strong>${esc(view.title || 'Offre')}</strong><small>${esc(row.subtitle || '')}</small></div>
        <div class="pv2-price-amount">${money(view.price)}<small> ${esc(row.priceUnit || (row.type === 'bowling' ? '/piste' : row.priceType === 'per_lane' ? '/piste' : isFormula ? '/pers' : ''))}</small></div>
      </div>
      ${badges ? `<div class="pev-badges">${badges}</div>` : ''}
      <p class="pv2-price-desc">${esc(row.description || '')}</p>
      ${(row.tags || []).length ? `<div class="pv2-price-tags">${row.tags.slice(0, 4).map((tag) => `<span class="pv2-chip">${esc(tag)}</span>`).join('')}</div>` : ''}
      ${usage}
      ${actions}
    </article>`;
  }

  // ---- UNE SEULE PAGE, UNE SECTION PAR CATEGORIE -------------------------
  //
  // Movsar, 2026-08-22 : « j'aime pas cette section, ca vaut pas la peine de
  // faire une toute autre section alors que tu peux directement le faire dans
  // les cartes en haut ; chaque categorie met un ajout de formule ».
  //
  // Avant : les offres vendues en haut, puis un bloc de 15 cartes « Activites
  // du catalogue » en bas, qui redisait le bowling et le laser deja affiches
  // plus haut. Un seul bouton d'ajout dans toute la page, tout en bas.
  //
  // Maintenant : chaque activite rejoint la section qui la concerne, et CHAQUE
  // section porte son bouton d'ajout, pre-remplie de sa categorie. Rien n'est
  // perdu : les activites qui ne se vendent pas seules (boissons, table
  // anniversaire) ont leur propre section au lieu d'etre noyees dans la liste.
  const ACTIVITY_SECTION_LANES = 'Location de pistes';
  const ACTIVITY_SECTION_LASER = 'Laser Game';
  const ACTIVITY_SECTION_CARTE = 'Activités à la carte';
  const ACTIVITY_SECTION_PARTS = 'Ingrédients de formules';
  const ACTIVITY_SECTIONS = [
    ACTIVITY_SECTION_LANES,
    ACTIVITY_SECTION_LASER,
    ACTIVITY_SECTION_CARTE,
    ACTIVITY_SECTION_PARTS,
  ];

  // Ou tombe une activite du catalogue. Le type de RESSOURCE decide en premier
  // (une piste est une piste, quel que soit son nom), puis le fait qu'elle se
  // reserve seule ou non.
  function activitySectionName(activity) {
    const resource = String((activity && activity.resourceType) || '').toLowerCase();
    if (resource === 'bowling_lane' || resource === 'duckpin_lane') return ACTIVITY_SECTION_LANES;
    if (resource === 'laser_arena') return ACTIVITY_SECTION_LASER;
    return activity && activity.bookable ? ACTIVITY_SECTION_CARTE : ACTIVITY_SECTION_PARTS;
  }

  // L'ordre de lecture de la page. Les categories de FORMULES creees par le
  // gerant n'y figurent pas : elles se rangent apres, dans leur ordre
  // d'apparition. Aucune liste a tenir a jour quelque part quand il en cree une.
  const SECTION_ORDER = [
    ACTIVITY_SECTION_LANES,
    ACTIVITY_SECTION_LASER,
    ACTIVITY_SECTION_CARTE,
    'Formules anniversaires',
    'Formules speciales',
    'Formules spéciales',
  ];

  function pricingSectionsHtml(rows, { selected, ranking, canManage }) {
    const card = (row, index) => pricingCardHtml(row, pevRowView(row), { selected: selected && row.id === selected.id, ranking, index, canManage });
    if (ranking !== 'default') {
      return `<section class="pv2-catalog-section" id="cevCatalogBlock">
        <div class="pv2-section-head"><h3>Classement</h3><span>${rows.length} offre${rows.length > 1 ? 's' : ''}, les plus fortes d'abord</span></div>
        <div class="pv2-catalog">${rows.map(card).join('') || '<div class="pv2-empty"><strong>Aucune offre</strong>Modifiez le filtre ou la recherche.</div>'}</div>
      </section>`;
    }
    const groups = [];
    const groupFor = (name) => {
      let group = groups.find((g) => g.name === name);
      if (!group) { group = { name, offers: [], activities: [] }; groups.push(group); }
      return group;
    };
    const groupOf = (row) => {
      if (row.type === 'bowling') return ACTIVITY_SECTION_LANES;
      if (row.type === 'laser') return ACTIVITY_SECTION_LASER;
      return row.family || (row.type === 'formula' ? 'Formules anniversaires' : 'Formules spéciales');
    };
    rows.forEach((row) => { groupFor(groupOf(row)).offers.push(row); });
    // Les activites du catalogue rejoignent le MEME flux. Quand un filtre ou une
    // recherche est actif, il porte sur les offres vendues : reafficher le
    // catalogue entier par-dessus reviendrait a ne plus filtrer du tout.
    const filtreActif = (state.staffPricingFilter || 'all') !== 'all'
      || Boolean(String(state.staffPricingSearch || '').trim());
    if (!filtreActif) {
      (pricingEditor.activities || []).forEach((activity) => {
        groupFor(activitySectionName(activity)).activities.push(activity);
      });
    }
    const rank = (name) => { const i = SECTION_ORDER.indexOf(name); return i === -1 ? SECTION_ORDER.length : i; };
    groups.sort((a, b) => rank(a.name) - rank(b.name));
    const firstFormulaGroup = groups.find((g) => g.offers.some((row) => row.sourceId));
    const sections = groups.map((group) => {
      const estActivite = ACTIVITY_SECTIONS.includes(group.name);
      const hostId = group === firstFormulaGroup ? ' id="cevCatalogBlock"' : '';
      const legend = group === firstFormulaGroup
        ? `<span class="pv2-section-legend">« Tarif du centre » n'engage que ce centre &middot; Activités, Structure et Supprimer changent le catalogue de TOUS VOS centres.</span>`
        : (group.name === ACTIVITY_SECTION_PARTS
          ? `<span class="pv2-section-legend">Ce que vos formules peuvent contenir. Ces activités ne se réservent pas seules.</span>`
          : '');
      // LE BOUTON D'AJOUT DE CETTE SECTION-CI. Sur une section d'activités il
      // ajoute une activité ; sur une catégorie de formules il ouvre la création
      // DÉJÀ rangée dans cette catégorie, sans avoir à retaper son nom.
      const addBtn = !canManage
        ? ''
        : estActivite
          ? `<button type="button" class="pv2-btn sm" data-add-activity="${escJs(group.name)}" onclick="aevOpenCreate()">+ Activité</button>`
          : `<button type="button" class="pv2-btn sm" data-add-formula="${escJs(group.name)}" onclick="cevOpenCreate('${escJs(group.name)}')">+ Formule</button>`;
      const compte = group.offers.length + group.activities.length;
      const cartes = group.offers.map(card).join('')
        + group.activities.map((activity) => aevCardHtml(activity, canManage)).join('');
      return `<section class="pv2-catalog-section"${hostId}>
        <div class="pv2-section-head"><h3>${esc(group.name)}</h3><span>${compte} offre${compte > 1 ? 's' : ''}</span>${addBtn}${legend}</div>
        <div class="pv2-catalog">${cartes}</div>
      </section>`;
    }).join('');
    return sections || '<div class="pv2-empty" id="cevCatalogBlock"><strong>Aucune offre</strong>Modifiez le filtre ou la recherche.</div>';
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
        <label for="aevName">Nom de l activité</label>
        <input id="aevName" type="text" maxlength="60" value="${esc(f.name || '')}" data-autofocus placeholder="Ex : Boissons soft" oninput="aevSet('name', this.value)">
        <span class="field-hint">C est ce nom que le client lit dans le tunnel et dans les formules.</span>
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
        <span class="pev-toggle-label">Réservable seule dans le tunnel<small>Décochée, l activité ne sert qu à composer les formules (comme la table anniversaire).</small></span>
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

  // UNE carte d'activité du catalogue. Elle vivait dans un bloc à part, tout en
  // bas de la page ; elle est maintenant posée dans la section qui la concerne
  // (activitySectionName), au milieu des offres vendues.
  function aevCardHtml(activity, canManage) {
    // Le prix ne MENT pas : une grille (bowling, laser) annonce son point de
    // depart, un tarif saisi son montant, et l'absence de tarif se dit en gris.
    // « sur place » en accent sur du bowling a grille etait faux ET criait plus
    // fort que les vrais prix.
    const gridStart = activity.priceType === 'grid_bowling'
      ? (typeof DURATION_OPTIONS !== 'undefined' ? Math.min(...DURATION_OPTIONS.map((o) => Number(o.price) || Infinity)) : null)
      : activity.priceType === 'grid_laser'
        ? (typeof LASER_GAME_OPTIONS !== 'undefined' ? Math.min(...LASER_GAME_OPTIONS.map((o) => Number(o.price) || Infinity)) : null)
        : null;
    const price = Number.isFinite(gridStart)
      ? `<span class="pv2-price-amount"><small>dès </small>${money(gridStart)}</span>`
      : activity.priceValue != null
        ? `<span class="pv2-price-amount">${money(activity.priceValue)}</span>`
        : '<span class="pv2-price-onsite">réglé sur place</span>';
    const badges = [
      activity.source === 'custom' ? '<span class="pv2-chip amber">Ajoutée</span>' : '',
      activity.bookable ? '<span class="pv2-chip">Réservable seule</span>' : '<span class="pv2-chip">Dans les formules</span>',
    ].filter(Boolean).join('');
    return `<article class="pv2-price-card pv2-activity-card" data-aev-activity="${escJs(activity.id)}">
      <div class="pv2-price-head">
        <div><strong>${esc(activity.name)}</strong><small>${esc(activity.priceUnit || '')}</small></div>
        ${price}
      </div>
      <div class="pev-badges">${badges}</div>
      ${canManage ? `<div class="pev-card-foot">
        <div class="pev-foot-main"><button type="button" class="pv2-btn sm" data-aev-edit="${escJs(activity.id)}" onclick="aevOpenEdit('${escJs(activity.id)}')">Modifier</button></div>
        <button type="button" class="pv2-btn sm cev-danger pev-foot-danger" data-aev-delete="${escJs(activity.id)}" title="Retirer du catalogue" aria-label="Retirer ${esc(activity.name)} du catalogue" onclick="aevDelete('${escJs(activity.id)}')"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg></button>
      </div>` : ''}
    </article>`;
  }

  window.renderStaffPricingPage = function () {
    const root = document.getElementById('staffPricingPage');
    if (!root) return;
    pevEnsureLoaded();
    // La fenetre de 30 jours vient de /api/admin-range (direction.view,
    // reservations.view ou clients.view) : sans ce droit, on ne l appelle
    // pas, et les tuiles le disent au lieu d afficher des zeros.
    const voitHistorique = typeof canReadStaffReservationHistory !== 'function' || canReadStaffReservationHistory();
    if (voitHistorique && typeof ensureStaffClientData === 'function') ensureStaffClientData();
    const allRows = getPricingRows();
    const rows = getPricingRowsFiltered();
    const selected = getSelectedPricingRow(rows);
    if (selected && state.staffPricingSelectedId !== selected.id) state.staffPricingSelectedId = selected.id;
    const metrics = getPricingMetrics(allRows);
    // « Plus demandé » ne designe une offre que si elle a ete demandee.
    const top = metrics.topRow && Number(metrics.topRow.count) > 0 ? metrics.topRow : null;
    const filter = state.staffPricingFilter || 'all';
    const countByType = (type) => allRows.filter((row) => row.type === type).length;
    // « Speciales » ne compte QUE la categorie speciale du socle : les autres
    // ont leur propre onglet, et la somme des onglets retombe juste.
    const customFamilies = getPricingCustomFamilies(allRows);
    const customKeys = new Set(customFamilies.map((family) => family.key));
    const countSpecial = allRows.filter((row) => row.type === 'special'
      && !customKeys.has(normalizePricingFamilyKey(row.family))).length;

    const ranking = state.staffPricingSort || 'default';
    const canManage = cevCanManage();
    const sections = pricingSectionsHtml(rows, { selected, ranking, canManage });
    // Catalogue vivant en panne = on le DIT (la page montre alors le socle
    // fige) et on offre le retry, jamais un fallback silencieux.
    const catalogAlert = pricingEditor.error
      ? `<div class="pv2-empty pv2-catalog-alert" role="alert"><strong>Catalogue vivant indisponible</strong>${esc(pricingEditor.error)} La page montre le socle : formules ajoutées ou retirées peuvent manquer. <button type="button" class="pv2-btn" onclick="pevRetryCatalog()">Réessayer</button></div>`
      : '';

    root.innerHTML = `<div class="pv2-shell">
      ${bar({
        crumb: 'Activités & tarifs',
        title: 'Tarifs & formules',
        sub: '',
        actions: `
          <label class="pv2-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="14" height="14"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg><input value="${esc(state.staffPricingQuery || '')}" placeholder="Formule, activité, condition…" oninput="setStaffPricingQuery(this.value)"></label>
          <button type="button" class="pv2-btn" onclick="copyStaffPricingSummary()">Copier</button>
          <button type="button" class="pv2-btn" onclick="exportStaffPricingCsv()">Exporter</button>
          ${canManage ? '<button type="button" class="pv2-btn" id="cevAddCategory" title="Créer une catégorie : donnez-lui un nom, elle apparaît partout" onclick="cevOpenCreate()">+ Catégorie</button>' : ''}
          <button type="button" class="pv2-btn primary" onclick="openStaffPricingBooking('${escJs(selected?.id || '')}')">+ Réservation</button>`,
      })}

      <section class="pv2-stats">
        ${stat({ label: 'Offres actives', count: metrics.activeOffers, foot: `dont ${metrics.formulaRows} formules` })}
        ${voitHistorique ? `
        ${stat({ label: 'Réservations', count: metrics.reservations, foot: 'sur 30 jours, hors annulations' })}
        ${stat({ label: 'Chiffre réservé', value: money(metrics.revenue), foot: 'sur 30 jours' })}
        ${stat({ label: 'Plus demandé', value: top ? top.title : '-', foot: top ? `${formatStaffTerrainCount(Number(top.count), 'réservation')} sur 30 jours` : 'aucune réservation sur 30 jours' })}` : `
        ${stat({ label: 'Réservations', value: '-', foot: 'historique non accessible avec votre rôle' })}
        ${stat({ label: 'Chiffre réservé', value: '-' })}
        ${stat({ label: 'Plus demandé', value: '-' })}`}
      </section>

      ${seg([
        { key: 'all', label: 'Tout', count: allRows.length, active: filter === 'all' },
        { key: 'bowling', label: 'Bowling', count: countByType('bowling'), active: filter === 'bowling' },
        { key: 'laser', label: 'Laser Game', count: countByType('laser'), active: filter === 'laser' },
        { key: 'formula', label: 'Anniversaires', count: countByType('formula'), active: filter === 'formula' },
        // Les formules speciales (Kids Fun Day, Matin Malin...) etaient les
        // SEULES offres sans onglet : 6 cartes sur 22 injoignables au filtre,
        // et la somme des onglets ne tombait pas juste (Movsar 2026-08-17).
        { key: 'special', label: 'Spéciales', count: countSpecial, active: filter === 'special' },
        // Une categorie creee par le gerant a SON onglet. Sans lui, ses
        // formules etaient comptees avec les speciales et rien ne permettait
        // de les isoler (mesure du 2026-08-22 : « Speciales » passait de 6 a 7
        // apres la creation d'une categorie inedite).
        ...customFamilies.map((family) => ({
          key: `family:${family.key}`,
          label: family.label,
          count: family.count,
          active: filter === `family:${family.key}`,
        })),
      ], 'pv2PricingFilter')}

      <div class="pv2-quicksorts">
        <span>Classement</span>
        ${[['demand', 'Plus demandées'], ['revenue', 'Top chiffre'], ['players', 'Top joueurs'], ['basket', 'Panier moyen']]
          .map(([key, label]) => `<button type="button" class="pv2-chip-btn${ranking === key ? ' active' : ''}" onclick="setStaffPricingSort('${key}')">${label}</button>`).join('')}
        ${ranking !== 'default' ? '<button type="button" class="pv2-chip-btn" onclick="setStaffPricingSort(state.staffPricingSort)">Ordre catalogue</button>' : ''}
      </div>

      ${catalogAlert}
      ${sections}
    </div>`;
    mount(root, 'pricing');
    pevSyncModal();
    cevSyncModal();
    aevSyncModal();
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
      ['＋', 'Nouvelle réservation', () => openQuickBook({})],
      ['⟳', 'Actualiser les données', () => (typeof loadStaffReservationsData === 'function' ? loadStaffReservationsData(true) : null)],
      ['◐', 'Basculer le thème', () => (typeof setStaffTheme === 'function' ? setStaffTheme(document.body.classList.contains('staff-light') ? 'dark' : 'light') : null)],
    ];
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
    node.innerHTML = `<div class="pv2-palette" role="dialog" aria-label="Palette de commandes">
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

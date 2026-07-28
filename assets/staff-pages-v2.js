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
      const step = (now) => {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        node.textContent = Math.round(target * eased).toLocaleString('fr-BE') + suffix;
        if (t < 1) requestAnimationFrame(step);
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
  const PV2_EMAILS_MOTION = { open: {}, pipeRail: null, switches: {}, pipeScroll: 0, resizeBound: false };

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
    const valueHtml = count !== undefined
      ? `<span data-pv2-count="${Number(count) || 0}" data-pv2-suffix="${esc(suffix)}">${(Number(count) || 0).toLocaleString('fr-BE')}${esc(suffix)}</span>`
      : esc(value);
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
        : 'Données locales';

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
      cells += `<div class="pv2-cal-cell heat-${heat} ${dateStr === today ? 'today' : ''} ${dateStr === selectedDate ? 'selected' : ''}" onclick="pv2SelectResDay('${dateStr}')">
        <span class="pv2-cal-day">${day}</span>
        <span class="pv2-cal-meta">${agg ? `<strong>${agg.count}</strong> résa · ${agg.pax}p` : '-'}</span>
      </div>`;
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
          </div>
          ${statusChip(r.status)}
        </div>`;
      }).join('')
      : `<div class="pv2-empty"><strong>Journée libre</strong>Aucune réservation active sur cette date.</div>`;

    root.innerHTML = `<div class="pv2-shell">
      ${bar({
        crumb: 'Opérations / Réservations',
        title: 'Réservations',
        sub: `${esc(sync)}${staffReservationsDataCache.error ? ' · <span style="color:var(--v2-amber)">API indisponible</span>' : ''}`,
        actions: `
          <button type="button" class="pv2-btn" onclick="shiftStaffReservationsMonth(-1)" aria-label="Mois précédent">‹</button>
          <button type="button" class="pv2-btn" onclick="openStaffReservationsMonthPicker()">${esc(monthLabel)}</button>
          <input id="staffReservationsMonthPicker" type="month" value="${esc(range.monthKey)}" onchange="setStaffReservationsMonthFromPicker(this.value)" style="position:absolute;opacity:0;pointer-events:none" aria-label="Choisir un mois">
          <button type="button" class="pv2-btn" onclick="shiftStaffReservationsMonth(1)" aria-label="Mois suivant">›</button>
          <button type="button" class="pv2-btn" onclick="refreshStaffReservations()">Actualiser</button>
          <button type="button" class="pv2-btn primary" onclick="openStaffReservationsQuick()">+ Réservation</button>`,
      })}

      <section class="pv2-stats">
        ${stat({ label: 'Réservations ce mois', count: metrics.reservations, delta: metrics.reservationTrend, deltaTone: trendTone(metrics.reservationTrend), series: metrics.series.reservations })}
        ${stat({ label: 'Joueurs ce mois', count: metrics.players, delta: metrics.playersTrend, deltaTone: trendTone(metrics.playersTrend), series: metrics.series.players })}
        ${stat({ label: "Chiffre d'affaires", value: money(metrics.revenue), delta: metrics.revenueTrend, deltaTone: trendTone(metrics.revenueTrend), series: metrics.series.revenue })}
        ${stat({ label: 'Occupation moyenne', count: metrics.occupancy, suffix: '%', delta: metrics.occupancyTrend, deltaTone: trendTone(metrics.occupancyTrend), series: metrics.series.occupancy })}
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
          <div class="pv2-panel-head">
            <h2>${esc(dayLabel)}</h2>
            <small>${dayAgg.count} résa · ${dayAgg.pax} joueurs · ${money(dayAgg.revenue)}</small>
          </div>
          <div class="pv2-panel-body pv2-flow">${flow}</div>
        </article>
      </section>
    </div>`;
    mount(root, 'reservations');
    ensureStaffReservationsData();
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
    const count = active === 'avenir' ? '' : `<span class="crm-seg-count"><strong>${filteredCount}</strong>${active === 'tous' ? ` / ${totalCount}` : ''} client${filteredCount > 1 ? 's' : ''}</span>`;
    return `<section class="crm-segbar" role="tablist" aria-label="Vue clients">${seg}${count}</section>`;
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
    const items = comms.slice(0, 40).map((c) => `
      <div class="crm-comm dir-${esc(c.direction || 'outbound')}">
        <span class="crm-comm-icon">${ci(CHAN[c.channel] || 'mail')}</span>
        <span class="crm-comm-main"><strong>${esc(c.subject || c.templateId || 'Message')}</strong><small>${esc(c.recipient || '')} · ${esc((typeof formatOpsTimestamp === 'function' && (c.sentAt || c.createdAt)) ? formatOpsTimestamp(c.sentAt || c.createdAt) : (c.sentAt || c.createdAt || ''))}${c.direction === 'inbound' ? ' · reçu' : ''}</small></span>
        <span class="crm-pill tone-${TONE[c.status] || 'muted'}">${esc(c.status || '')}</span>
        ${selected.email ? `<button type="button" class="crm-icon-btn" title="Renvoyer" aria-label="Renvoyer" onclick="pv2OpenComposer({to:'${escJs(selected.email)}',name:'${escJs(selected.name || '')}'})">${ci('refresh')}</button>` : ''}
      </div>`).join('');
    return `<section class="crm-sec"><div class="crm-sec-head"><h3>Messages & relances <span class="crm-count">${comms.length}</span></h3>${compose}</div>
      <div class="crm-comm-stats">${sent} envoyé${sent > 1 ? 's' : ''} · ${delivered} délivré${delivered > 1 ? 's' : ''} · ${failedCount} échec${failedCount > 1 ? 's' : ''}${last ? ` · dernier ${esc((typeof formatOpsTimestamp === 'function' && (last.sentAt || last.createdAt)) ? formatOpsTimestamp(last.sentAt || last.createdAt) : '')}` : ''}</div>
      <div class="crm-comm-list">${items}</div></section>`;
  }

  /* ── Relance 1-clic : composer inline prérempli, envoi RÉEL via la queue
     communications (action sendClientRelance). Boucle fermée : le marqueur
     « relancé il y a X j » (comms) se met à jour après envoi. ── */
  const crmRelance = { openFor: null, reason: 'dormant', subject: '', body: '', busy: false };
  const crmRelanceStats = { loaded: false, loading: false, sent: 0, converted: 0, revenue: 0 };
  const crmNotes = { key: '', body: '', loaded: false, loading: false, saving: false };

  function crmRelancePrefill(row) {
    const relance = getStaffClientRelance(row);
    const firstName = String(row.name || '').trim().split(/\s+/)[0] || '';
    if (relance.kind === 'anniversaire') {
      return {
        reason: 'birthday',
        subject: `L'anniversaire approche, on vous re-réserve la fête ? 🎂`,
        body: `Bonjour ${firstName},\n\nL'an dernier vous aviez fêté un anniversaire chez nous, et c'était un super moment !\nLa date approche : on vous re-réserve la formule ? Les créneaux du week-end partent vite.\n\nRépondez à ce message ou réservez en ligne, on s'occupe du reste.\n\nÀ très vite,\nL'équipe Fun Galaxy`,
      };
    }
    return {
      reason: 'dormant',
      subject: 'Ça fait un moment, on vous a gardé une piste 🎳',
      body: `Bonjour ${firstName},\n\nÇa fait un moment qu'on ne vous a pas vus au centre, bowling, laser, arcades… tout est prêt.\nVenez en semaine, c'est plus calme (et plus tranquille pour jouer).\n\nRéservez en ligne quand vous voulez, ou répondez simplement à ce message.\n\nÀ bientôt,\nL'équipe Fun Galaxy`,
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
      <input class="crm-composer-subject" value="${esc(crmRelance.subject)}" oninput="crmRelanceField('subject', this.value)" aria-label="Objet">
      <textarea class="crm-composer-body" rows="7" oninput="crmRelanceField('body', this.value)" aria-label="Message">${esc(crmRelance.body)}</textarea>
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
    if (ctx.vipThreshold > 0 && Number(selected.spent || 0) >= ctx.vipThreshold) badges.push(`<span class="crm-pill tone-accent" title="Plus de ${Math.round(ctx.vipThreshold)} € cumulés (seuil réglable dans Établissement)">Client clé</span>`);
    if (selected.hasBirthday) badges.push('<span class="crm-pill tone-info">Anniversaire</span>');
    const kpi = (label, value) => `<div class="crm-kpi"><div class="crm-kpi-val">${value}</div><div class="crm-kpi-label">${esc(label)}</div></div>`;
    const next = selected.nextBooking;
    const relance = getStaffClientRelance(selected);
    let nextBlock = '';
    if (next) {
      // Même dossier (même id) que le segment « À venir » → les coches de prépa
      // sont partagées entre la carte dossier et la fiche.
      const dossier = { id: `r-${next.id}`, kind: 'reservation', reservation: next, row: selected, dateISO: next.date, startTime: next.startTime || '', pax: Number(next.pax || 0) };
      const readiness = computeStaffGroupReadiness(dossier);
      const checks = readiness.items.filter((i) => i.state !== 'na').map((i) =>
        `<button type="button" class="groups-check-toggle${i.state === 'done' ? ' is-done' : ''}" onclick="toggleStaffGroupPrep('${escJs(dossier.id)}','${escJs(i.key)}')" aria-pressed="${i.state === 'done'}">${i.state === 'done' ? '✓' : '○'} ${esc(i.label)}</button>`
      ).join('');
      nextBlock = `<section class="crm-sec crm-next">
        <div class="crm-sec-head"><h3>Prochaine venue</h3><span class="crm-pill tone-${readiness.ready ? 'success' : 'warn'}">${readiness.ready ? 'Prêt' : `${readiness.todo} à préparer`}</span></div>
        <div class="crm-next-body"><strong>${esc(formatStaffClientDateText(next.date))}${next.startTime ? ` · ${esc(String(next.startTime).slice(0, 5))}` : ''}</strong><span>${esc(getStaffClientOfferLabel(next))} · ${Number(next.pax) || 0} joueurs</span></div>
        <div class="groups-check-toggles">${checks}</div>
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
          <textarea class="crm-note-input" rows="3" placeholder="${crmNotes.loading ? 'Chargement…' : 'Allergies, prénom de l\'enfant, préférences… (enregistré automatiquement)'}"
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
    const sync = staffClientDataCache.loading ? 'Synchronisation…' : staffClientDataCache.loaded ? `Synchronisé ${formatOpsTimestamp(staffClientDataCache.syncedAt)}` : 'Données locales';

    // 4 chiffres qui déclenchent chacun UNE décision (cliquables → segment).
    const dossiers = (typeof buildStaffGroupDossiers === 'function' ? buildStaffGroupDossiers() : []).filter((d) => d.kind === 'reservation');
    const today = staffGroupToday();
    const within = (d, days) => d.dateISO && staffClientDaysBetween(d.dateISO, today) <= days;
    const upcoming7 = dossiers.filter((d) => within(d, 7));
    const upcoming7Value = upcoming7.reduce((sum, d) => { const v = getStaffGroupDossierValue(d); return sum + (v.value || 0); }, 0);
    const newLeads = typeof getStaffNewCustomRequestCount === 'function' ? getStaffNewCustomRequestCount() : 0;
    const relancer = allRows.filter((row) => getStaffClientRelance(row).due).length;
    const statBtn = (seg, html) => `<div class="crm-stat-link${segment === seg ? ' is-active' : ''}" role="button" tabindex="0" onclick="setStaffClientSegment('${seg}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();setStaffClientSegment('${seg}');}">${html}</div>`;

    const selected = rows.find((r) => r.id === state.staffSelectedClientId)
      || allRows.find((r) => r.id === state.staffSelectedClientId)
      || rows[0] || allRows[0] || null;
    if (selected && state.staffSelectedClientId !== selected.id) state.staffSelectedClientId = selected.id;

    let body = '';
    if (segment === 'avenir') {
      // L'ancienne page « Groupes & anniversaires » vit ici : dossiers datés,
      // checklist prépa, leads sur mesure, priorités, charge à venir.
      body = renderStaffGroupWorkspaceV2();
    } else {
      const limit = Number(state.staffClientListLimit) || 40;
      const shown = rows.slice(0, limit);
      const sortState = state.staffClientSort || { key: 'lastDate', dir: 'desc' };
      const th = (key, label, num) => {
        const on = sortState.key === key;
        return `<th class="${num ? 'num ' : ''}crm-th${on ? ' is-active' : ''}" aria-sort="${on ? (sortState.dir === 'asc' ? 'ascending' : 'descending') : 'none'}" onclick="setStaffClientSort('${key}')">${esc(label)} <span class="crm-sort">${ci(on ? (sortState.dir === 'asc' ? 'chevronUp' : 'chevronDown') : 'chevrons')}</span></th>`;
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
          : `<span class="crm-roi-figures">Relance ton premier client, je mesure ce que chaque relance rapporte.</span>`}
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
            <span>${shown.length} affiché${shown.length > 1 ? 's' : ''} sur ${rows.length}</span>
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
        crumb: 'Clients & Marketing',
        title: 'Clients',
        sub: esc(sync),
        actions: `
          <label class="pv2-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="14" height="14"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg><input value="${esc(state.staffClientQuery || '')}" placeholder="Rechercher un client…" oninput="setStaffClientQuery(this.value)"><kbd>Ctrl K</kbd></label>
          <button type="button" class="pv2-btn" onclick="refreshStaffClients()">Actualiser</button>
          <button type="button" class="pv2-btn" onclick="exportStaffClientsCsv()">Exporter</button>
          <button type="button" class="pv2-btn primary" onclick="openStaffClientBooking()">+ Nouveau client</button>`,
      })}

      <section class="pv2-stats crm-stats">
        ${statBtn('avenir', stat({ label: 'À venir 7 j', count: upcoming7.length, foot: upcoming7Value ? `${money(upcoming7Value)} attendus` : 'dossiers à préparer' }))}
        ${statBtn('avenir', stat({ label: 'Demandes sur mesure', count: newLeads, foot: newLeads ? 'à répondre aujourd’hui' : 'aucune en attente' }))}
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

  window.pv2SelectEmail = function (uid) {
    state.staffEmailSelectedId = uid;
    save();
    renderStaffEmailsPage();
  };

  window.pv2EmailFilter = function (key) {
    state.staffEmailFilter = key;
    // Les deux segmentés (statut + origine) restent d'accord entre eux :
    // « Reçus » est la même vue des deux côtés, et revenir sur un statut
    // d'envoi quitte la vue Reçus du segmenté d'origine.
    if (key === 'inbound') state.staffEmailOriginFilter = 'inbound';
    else if (state.staffEmailOriginFilter === 'inbound') state.staffEmailOriginFilter = 'all';
    save();
    renderStaffEmailsPage();
  };

  // Segmenté d'ORIGINE (demande du proprio : dissocier les mails partis tout
  // seuls des mails envoyés par l'équipe). Combinable avec les statuts : le
  // choix vit dans state.staffEmailOriginFilter et getStaffEmailRowsFiltered
  // (app-main.js) le cumule avec le filtre de statut.
  window.pv2EmailOriginFilter = function (key) {
    const allowed = ['all', 'auto', 'manual', 'inbound'];
    state.staffEmailOriginFilter = allowed.includes(key) ? key : 'all';
    if (state.staffEmailOriginFilter === 'inbound') state.staffEmailFilter = 'inbound';
    else if (state.staffEmailFilter === 'inbound') state.staffEmailFilter = 'all';
    state.staffEmailSelectedId = '';
    save();
    renderStaffEmailsPage();
  };

  /* ── Composer universel + boîte de réception (Emails v3) ──────────────────
     Contrats : sendDirectEmail (C3), analyzeInboundEmail (C4), emailTemplates
     (identités + modèles), improveEmailWithAi. Le composer n'exige AUCUNE
     réservation ; la fiche client route ici via pv2OpenComposer. ── */

  // Modèles de départ (mêmes contenus que le studio direction : dupliqués
  // volontairement : admin-mail.js n'est pas chargé côté staff).
  const PV2_STARTERS = [
    { key: 'relance-client', name: 'On ne vous a plus vu', subject: 'Ça fait longtemps, {{prenom}} !', body: 'Bonjour {{prenom}},\n\nÇa fait un moment qu\'on ne vous a plus vu au centre, les pistes vous attendent.\n\nRéservez en ligne quand vous voulez, ça prend une minute.\n\nÀ bientôt,\nL\'équipe Fun Galaxy' },
    { key: 'marketing-anniversaire', name: 'Pack anniversaire', subject: 'Un anniversaire inoubliable, sans stress pour vous', body: 'Bonjour {{prenom}},\n\nUn anniversaire à organiser ? Bowling, laser game, table décorée et cruches de boissons : on s\'occupe de tout, vous profitez.\n\nDites-nous la date et le nombre d\'enfants, on vous propose la formule adaptée.\n\nL\'équipe Fun Galaxy' },
    { key: 'promo-semaine', name: 'Offre de la semaine', subject: 'Cette semaine chez Fun Galaxy : {{offre}}', body: 'Bonjour {{prenom}},\n\nCette semaine, on vous a préparé quelque chose : {{offre}}.\n\nValable du {{date_debut}} au {{date_fin}}, réservez votre créneau en ligne en 1 minute.\n\nÀ très vite,\nL\'équipe Fun Galaxy' },
    { key: 'serieux-entreprise', name: 'Proposition entreprise', subject: 'Votre événement d\'équipe chez Fun Galaxy, proposition', body: 'Bonjour {{prenom}},\n\nSuite à votre demande, voici notre proposition pour votre événement d\'équipe : créneau privatisé, activités au choix (bowling, laser game) et espace repas.\n\nNous restons disponibles pour ajuster la formule à votre budget et vos horaires.\n\nCordialement,\nLa direction Fun Galaxy' },
  ];

  const pv2Mail = {
    composerOpen: false, busy: false, aiBusy: false, aiTips: [],
    draft: { to: '', name: '', subject: '', body: '', identityId: '', templateRef: '', replyTo: null },
    identities: [], templates: [], metaLoaded: false, metaLoading: false,
    analyzeOpen: false, analyzeBusy: false, analyzeDraft: { from: '', body: '' },
    replyDraft: {}, replyBusy: '', analysisOverride: {}, retryingId: '',
  };
  window.pv2Mail = pv2Mail;

  async function loadPv2MailMeta(force = false) {
    if (pv2Mail.metaLoading || (pv2Mail.metaLoaded && !force)) return;
    pv2Mail.metaLoading = true;
    try {
      const payload = await apiRequest(`/api/ops?action=emailTemplates&centerId=${encodeURIComponent(state.adminCenterId || 'libramont')}`);
      pv2Mail.identities = payload.identities || [];
      pv2Mail.templates = payload.templates || [];
      const def = pv2Mail.identities.find((i) => i.isDefault) || pv2Mail.identities[0];
      if (def && !pv2Mail.draft.identityId) pv2Mail.draft.identityId = String(def.id);
      pv2Mail.metaLoaded = true;
    } catch (error) { /* rôle sans accès : selects vides, envoi possible quand même */ } finally {
      pv2Mail.metaLoading = false;
      renderStaffEmailsPage();
    }
  }

  // API globale : la fiche client (et tout autre module) ouvre le composer
  // prérempli : remplace le détour console direction / mailto.
  window.pv2OpenComposer = function (prefill = {}) {
    pv2Mail.composerOpen = true;
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
    renderStaffEmailsPage();
    setTimeout(() => { const el = document.getElementById('pv2ComposerTo'); if (el && !el.value) el.focus(); }, 60);
  };

  window.pv2CloseComposer = function () {
    pv2Mail.composerOpen = false;
    pv2Mail.aiTips = [];
    renderStaffEmailsPage();
  };

  // Champs édités SANS re-render (pattern crmRelanceField : le render complet
  // détruirait le focus en pleine frappe).
  window.pv2ComposerField = function (field, value) {
    pv2Mail.draft[field] = value;
    if (field === 'to') {
      const rows = typeof getStaffClientRows === 'function' ? getStaffClientRows() : [];
      const match = rows.find((r) => String(r.email || '').toLowerCase() === String(value).trim().toLowerCase());
      if (match) pv2Mail.draft.name = match.name || '';
    }
  };

  // Suggestions destinataire : datalist native (clavier + zéro perte de focus).
  function pv2ComposerSuggestions() {
    const rows = typeof getStaffClientRows === 'function' ? getStaffClientRows() : [];
    return rows
      .filter((r) => r.email)
      .slice(0, 200)
      .map((r) => `<option value="${esc(r.email)}">${esc(r.name || r.email)}</option>`)
      .join('');
  }

  window.pv2ComposerTemplate = function (ref) {
    pv2Mail.draft.templateRef = ref;
    const firstName = String(pv2Mail.draft.name || '').trim().split(/\s+/)[0] || '';
    const fill = (text) => String(text || '').replace(/\{\{\s*prenom\s*\}\}/gi, firstName || 'vous');
    if (ref.startsWith('starter:')) {
      const starter = PV2_STARTERS.find((s) => s.key === ref.slice(8));
      if (starter) { pv2Mail.draft.subject = fill(starter.subject); pv2Mail.draft.body = fill(starter.body); }
    } else if (ref.startsWith('tpl:')) {
      const tpl = pv2Mail.templates.find((t) => String(t.id) === ref.slice(4));
      if (tpl) { pv2Mail.draft.subject = fill(tpl.subject || ''); pv2Mail.draft.body = fill(tpl.body || ''); }
    }
    renderStaffEmailsPage();
  };

  window.pv2ComposerImprove = async function () {
    if (pv2Mail.aiBusy) return;
    const d = pv2Mail.draft;
    if (!d.subject.trim() && !d.body.trim()) { toast('Écris d\'abord un brouillon à améliorer.'); return; }
    pv2Mail.aiBusy = true;
    renderStaffEmailsPage();
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
      renderStaffEmailsPage();
    }
  };

  window.pv2ComposerSend = async function () {
    if (pv2Mail.busy) return;
    const d = pv2Mail.draft;
    const to = String(d.to || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) { toast('Adresse email invalide.'); return; }
    if (!d.subject.trim() || !d.body.trim()) { toast('Objet et message obligatoires.'); return; }
    let scheduledAt = null;
    if (d.when === 'later') {
      if (!d.scheduledAt) { toast('Choisis la date et l\'heure d\'envoi.'); return; }
      const requested = new Date(d.scheduledAt);
      if (Number.isNaN(requested.getTime()) || requested.getTime() < Date.now() + 2 * 60000) {
        toast('La date d\'envoi doit être dans le futur.');
        return;
      }
      scheduledAt = requested.toISOString();
    }
    pv2Mail.busy = true;
    renderStaffEmailsPage();
    try {
      await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({
          action: 'sendDirectEmail',
          centerId: state.adminCenterId || 'libramont',
          to,
          name: d.name || '',
          subject: d.subject,
          body: d.body,
          identityId: d.identityId || null,
          templateRef: d.templateRef || '',
          replyToCommunicationId: d.replyTo || null,
          scheduledAt,
        }),
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
      renderStaffEmailsPage();
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
    if (!body) { toast('Colle le texte du mail reçu.'); return; }
    pv2Mail.analyzeBusy = true;
    renderStaffEmailsPage();
    try {
      await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'analyzeInboundEmail', centerId: state.adminCenterId || 'libramont', from, body, store: true }),
      });
      pv2Mail.analyzeOpen = false;
      pv2Mail.analyzeDraft = { from: '', body: '' };
      state.staffEmailFilter = 'inbound';
      save();
      toast('Mail analysé : il est dans les Reçus avec sa réponse proposée.');
      if (typeof requestOpsAdminLoad === 'function') requestOpsAdminLoad(true);
    } catch (error) {
      toast(error.message || 'Analyse impossible.');
    } finally {
      pv2Mail.analyzeBusy = false;
      renderStaffEmailsPage();
    }
  };

  /* ── Détail d'un reçu : réponse proposée éditable, envoi 1-clic, ré-analyse. ── */
  function pv2InboxAnalysis(row) {
    return pv2Mail.analysisOverride[row.uid] || (row.payload && row.payload.analysis) || null;
  }

  function pv2InboxReplyDraft(row) {
    if (!pv2Mail.replyDraft[row.uid]) {
      const analysis = pv2InboxAnalysis(row);
      pv2Mail.replyDraft[row.uid] = {
        subject: analysis?.reply?.subject || `Re: ${row.subject || ''}`.trim(),
        body: analysis?.reply?.body || '',
      };
    }
    return pv2Mail.replyDraft[row.uid];
  }

  window.pv2InboxReplyField = function (uid, field, value) {
    if (!pv2Mail.replyDraft[uid]) pv2Mail.replyDraft[uid] = { subject: '', body: '' };
    pv2Mail.replyDraft[uid][field] = value;
  };

  window.pv2InboxReply = async function (uid) {
    if (pv2Mail.replyBusy) return;
    const row = getStaffEmailRows().find((r) => r.uid === uid);
    if (!row) return;
    const to = String(row.payload?.from || row.recipient || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) { toast('Adresse de l\'expéditeur introuvable.'); return; }
    const draft = pv2InboxReplyDraft(row);
    if (!String(draft.subject || '').trim() || !String(draft.body || '').trim()) { toast('Objet et réponse obligatoires.'); return; }
    pv2Mail.replyBusy = uid;
    renderStaffEmailsPage();
    try {
      await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({
          action: 'sendDirectEmail',
          centerId: state.adminCenterId || 'libramont',
          to,
          name: pv2InboxAnalysis(row)?.clientName || '',
          subject: draft.subject,
          body: draft.body,
          identityId: pv2Mail.draft.identityId || null,
          replyToCommunicationId: row.id || null,
        }),
      });
      toast('Réponse en file d\'envoi ✓');
      delete pv2Mail.replyDraft[uid];
      if (typeof requestOpsAdminLoad === 'function') requestOpsAdminLoad(true);
    } catch (error) {
      toast(error.message || 'Envoi impossible.');
    } finally {
      pv2Mail.replyBusy = '';
      renderStaffEmailsPage();
    }
  };

  window.pv2InboxReanalyze = async function (uid) {
    if (pv2Mail.replyBusy) return;
    const row = getStaffEmailRows().find((r) => r.uid === uid);
    if (!row) return;
    pv2Mail.replyBusy = uid;
    renderStaffEmailsPage();
    try {
      const payload = await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({
          action: 'analyzeInboundEmail',
          centerId: state.adminCenterId || 'libramont',
          from: row.payload?.from || row.recipient || '',
          subject: row.subject || '',
          body: row.payload?.textBody || '',
        }),
      });
      if (payload.analysis) {
        pv2Mail.analysisOverride[uid] = payload.analysis;
        pv2Mail.replyDraft[uid] = {
          subject: payload.analysis.reply?.subject || '',
          body: payload.analysis.reply?.body || '',
        };
        toast('Analyse actualisée.');
      }
    } catch (error) {
      toast(error.message || 'Ré-analyse impossible.');
    } finally {
      pv2Mail.replyBusy = '';
      renderStaffEmailsPage();
    }
  };

  const PV2_INTENT_LABELS = {
    reservation: 'Réservation', annulation: 'Annulation', anniversaire: 'Anniversaire',
    prix: 'Prix', horaires: 'Horaires', reclamation: 'Réclamation', autre: 'Autre',
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
    if (t.type === 'weekly') {
      const segments = (pv2Seq.limits && pv2Seq.limits.segments) || {};
      return `chaque ${PV2_WEEKDAYS[t.weekday] || ''} · ${segments[sequence.segment] || 'tous'}`;
    }
    return '';
  }

  window.pv2SeqNew = function () {
    pv2Seq.creating = true;
    pv2Seq.editId = '';
    pv2Seq.draft = { name: '', trigger: { type: 'after_visit', days: 7, weekday: 4 }, segment: 'all', subject: '', body: '', cap: 20, enabled: true };
    renderStaffEmailsPage();
    setTimeout(() => { const el = document.getElementById('pv2SeqName'); if (el) el.focus(); }, 60);
  };

  window.pv2SeqEdit = function (id) {
    const sequence = pv2Seq.sequences.find((item) => item.id === id);
    if (!sequence) return;
    pv2Seq.creating = false;
    pv2Seq.editId = id;
    pv2Seq.draft = JSON.parse(JSON.stringify(sequence));
    renderStaffEmailsPage();
  };

  window.pv2SeqCloseEditor = function () {
    pv2Seq.creating = false;
    pv2Seq.editId = '';
    renderStaffEmailsPage();
  };

  window.pv2SeqField = function (field, value) {
    if (field === 'trigger.type') {
      pv2Seq.draft.trigger = { type: value, days: value === 'inactive' ? 90 : 7, weekday: 4 };
      renderStaffEmailsPage();
      return;
    }
    if (field === 'trigger.days') { pv2Seq.draft.trigger.days = Number(value); return; }
    if (field === 'trigger.weekday') { pv2Seq.draft.trigger.weekday = Number(value); return; }
    if (field === 'cap') { pv2Seq.draft.cap = Number(value); return; }
    pv2Seq.draft[field] = value;
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

  function pv2SeqCard(sequence) {
    const editing = pv2Seq.editId === sequence.id;
    return `<article class="mk-auto pv2-seq-card${sequence.enabled ? ' is-on' : ''}${editing ? ' is-editing' : ''}">
      <div class="mk-auto-head">
        <strong>${esc(sequence.name)}<span class="pv2-seq-pill">perso</span></strong>
        <button type="button" class="mk-switch${sequence.enabled ? ' is-on' : ''}" data-switch-key="seq:${esc(String(sequence.id))}" role="switch" aria-checked="${sequence.enabled}" aria-label="${esc(sequence.name)}" onclick="pv2SeqToggle('${escJs(sequence.id)}', ${sequence.enabled ? 'false' : 'true'})" ${pv2Seq.busy ? 'disabled' : ''}><span></span></button>
      </div>
      <p class="mk-auto-desc">${esc(pv2SeqTriggerLabel(sequence))} · max ${Number(sequence.cap) || 0} envois</p>
      <details class="mk-auto-preview"><summary><span class="pv2-caret" aria-hidden="true"></span>Aperçu du message</summary><p>${esc(sequence.body || '')}</p></details>
      <div class="mk-auto-stats">
        <button type="button" class="pv2-btn sm" onclick="pv2SeqEdit('${escJs(sequence.id)}')">${ci('pencil')}Modifier</button>
        <button type="button" class="pv2-btn sm" onclick="pv2SeqDelete('${escJs(sequence.id)}')">Supprimer</button>
      </div>
    </article>`;
  }

  function pv2SeqEditor() {
    const d = pv2Seq.draft;
    const limits = pv2Seq.limits || { triggers: {}, segments: {} };
    const trigger = d.trigger || { type: 'after_visit' };
    const meta = (limits.triggers && limits.triggers[trigger.type]) || {};
    const variables = (meta.variables || ['prenom', 'centre']).map((v) => `{{${v}}}`).join(' · ');
    const triggerOptions = Object.entries(limits.triggers || {})
      .map(([key, t]) => `<option value="${key}"${trigger.type === key ? ' selected' : ''}>${esc(t.label)}</option>`).join('');
    const segmentOptions = Object.entries(limits.segments || {})
      .map(([key, label]) => `<option value="${key}"${d.segment === key ? ' selected' : ''}>${esc(label)}</option>`).join('');
    const daysBounds = meta.days || [1, 90];
    return `<div class="pv2-seq-editor" data-pv2-mount="seqEditor" aria-label="Éditeur de séquence">
      <div class="pv2-composer-grid">
        <label class="pv2-composer-field"><span>Nom de la séquence</span>
          <input id="pv2SeqName" value="${esc(d.name || '')}" placeholder="Ex. Relance une semaine après la visite" oninput="pv2SeqField('name', this.value)">
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
        </label>` : `
        <label class="pv2-composer-field"><span>Délai (jours)</span>
          <input type="number" min="${daysBounds[0]}" max="${daysBounds[1]}" value="${Number(trigger.days) || daysBounds[0]}" oninput="pv2SeqField('trigger.days', this.value)">
        </label>`}
        <label class="pv2-composer-field"><span>Plafond d'envois</span>
          <input type="number" min="1" max="100" value="${Number(d.cap) || 20}" oninput="pv2SeqField('cap', this.value)">
        </label>
        <label class="pv2-composer-field pv2-composer-wide"><span>Objet</span>
          <input value="${esc(d.subject || '')}" placeholder="Objet du message automatique" oninput="pv2SeqField('subject', this.value)">
        </label>
        <label class="pv2-composer-field pv2-composer-wide"><span>Message <small class="pv2-seq-vars">Variables : ${esc(variables)}</small></span>
          <textarea rows="7" placeholder="Bonjour {{prenom}},…" oninput="pv2SeqField('body', this.value)">${esc(d.body || '')}</textarea>
        </label>
        <div class="pv2-composer-actions pv2-composer-wide">
          <button type="button" class="pv2-btn" onclick="pv2SeqCloseEditor()">Annuler</button>
          <span class="pv2-composer-spacer"></span>
          <button type="button" class="pv2-btn primary" onclick="pv2SeqSave()" ${pv2Seq.busy ? 'disabled' : ''}>${pv2Seq.busy ? 'Enregistrement…' : 'Enregistrer la séquence'}</button>
        </div>
      </div>
    </div>`;
  }

  /* ── RÉGLAGES EMAILS : modèles, adresses d'envoi, cerveau de l'agent 
     un panneau, trois vues. Tout ce que le gérant peut posséder. ── */
  const pv2Settings = {
    open: false, view: 'templates', busy: false,
    tplEditing: null, idEditing: null,
    brain: { loaded: false, loading: false, overrides: null, defaults: null, draft: null },
  };
  window.pv2Settings = pv2Settings;

  window.pv2OpenSettings = function (view) {
    pv2Settings.open = !pv2Settings.open || (view && pv2Settings.view !== view);
    if (view) pv2Settings.view = view;
    if (pv2Settings.open) {
      loadPv2MailMeta();
      if (pv2Settings.view === 'agent') loadPv2Brain();
    }
    renderStaffEmailsPage();
  };

  window.pv2SettingsView = function (view) {
    pv2Settings.view = view;
    pv2Settings.tplEditing = null;
    pv2Settings.idEditing = null;
    if (view === 'agent') loadPv2Brain();
    renderStaffEmailsPage();
  };

  async function loadPv2Brain(force = false) {
    const brain = pv2Settings.brain;
    if (brain.loading || (brain.loaded && !force)) return;
    brain.loading = true;
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
    } catch (error) { /* rôle sans accès */ } finally {
      brain.loading = false;
      renderStaffEmailsPage();
    }
  }

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
      toast('L\'agent a appris tes réglages ✓');
    } catch (error) {
      toast(error.message || 'Enregistrement impossible.');
    } finally {
      pv2Settings.busy = false;
      renderStaffEmailsPage();
    }
  };

  /* Modèles : créer / modifier / archiver (serveur email-studio existant). */
  window.pv2TplEdit = function (id) {
    if (id === null) { pv2Settings.tplEditing = { id: null, name: '', category: 'marketing', subject: '', body: '' }; }
    else {
      const tpl = pv2Mail.templates.find((t) => String(t.id) === String(id));
      if (!tpl) return;
      pv2Settings.tplEditing = { id: tpl.id, name: tpl.label || tpl.name || '', category: tpl.category || 'marketing', subject: tpl.subject || '', body: tpl.body || '' };
    }
    renderStaffEmailsPage();
  };

  window.pv2TplField = function (field, value) {
    if (pv2Settings.tplEditing) pv2Settings.tplEditing[field] = value;
  };

  window.pv2TplSave = async function () {
    const tpl = pv2Settings.tplEditing;
    if (!tpl || pv2Settings.busy) return;
    if (!String(tpl.name || '').trim()) { toast('Donne un nom au modèle.'); return; }
    pv2Settings.busy = true;
    renderStaffEmailsPage();
    try {
      await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'saveEmailTemplate', centerId: state.adminCenterId || 'libramont', id: tpl.id, name: tpl.name, category: tpl.category, subject: tpl.subject, body: tpl.body }),
      });
      pv2Settings.tplEditing = null;
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
    renderStaffEmailsPage();
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

  function pv2SettingsPanel() {
    const seg = [['templates', 'Modèles'], ['identities', 'Adresses d\'envoi'], ['agent', 'L\'agent']]
      .map(([key, label]) => `<button type="button" class="crm-seg${pv2Settings.view === key ? ' is-active' : ''}" onclick="pv2SettingsView('${key}')">${esc(label)}</button>`).join('');
    let content = '';
    if (pv2Settings.view === 'templates') {
      const tpl = pv2Settings.tplEditing;
      content = tpl ? `<div class="pv2-composer-grid">
          <label class="pv2-composer-field"><span>Nom</span><input value="${esc(tpl.name)}" placeholder="Ex. Offre rentrée" oninput="pv2TplField('name', this.value)"></label>
          <label class="pv2-composer-field"><span>Catégorie</span><select onchange="pv2TplField('category', this.value)">${PV2_TPL_CATEGORIES.map(([key, label]) => `<option value="${key}"${tpl.category === key ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
          <label class="pv2-composer-field pv2-composer-wide"><span>Objet</span><input value="${esc(tpl.subject)}" oninput="pv2TplField('subject', this.value)"></label>
          <label class="pv2-composer-field pv2-composer-wide"><span>Message <small class="pv2-seq-vars">Variables : {{prenom}} · {{nom}}</small></span><textarea rows="7" oninput="pv2TplField('body', this.value)">${esc(tpl.body)}</textarea></label>
          <div class="pv2-composer-actions pv2-composer-wide">
            <button type="button" class="pv2-btn" onclick="pv2Settings.tplEditing = null; renderStaffEmailsPage();">Annuler</button>
            <span class="pv2-composer-spacer"></span>
            <button type="button" class="pv2-btn primary" onclick="pv2TplSave()" ${pv2Settings.busy ? 'disabled' : ''}>Enregistrer le modèle</button>
          </div>
        </div>`
        : `<div class="pv2-settings-list">
          ${pv2Mail.templates.length ? pv2Mail.templates.map((t) => `
            <div class="pv2-settings-row">
              <div><strong>${esc(t.label || t.name || `Modèle ${t.id}`)}</strong><small>${esc(t.category || '')} · ${esc(t.subject || '')}</small></div>
              <button type="button" class="pv2-btn sm" onclick="pv2TplEdit('${escJs(String(t.id))}')">${ci('pencil')}Modifier</button>
              <button type="button" class="pv2-btn sm" onclick="pv2TplArchive('${escJs(String(t.id))}')">Archiver</button>
            </div>`).join('') : '<div class="pv2-empty"><strong>Aucun modèle personnalisé</strong>Crée tes propres modèles : ils apparaissent dans le composer.</div>'}
          <div class="pv2-composer-actions"><button type="button" class="pv2-btn primary" onclick="pv2TplEdit(null)">+ Nouveau modèle</button></div>
        </div>`;
    } else if (pv2Settings.view === 'identities') {
      const identity = pv2Settings.idEditing;
      content = identity ? `<div class="pv2-composer-grid">
          <label class="pv2-composer-field"><span>Nom affiché</span><input value="${esc(identity.label)}" placeholder="Ex. Fun Galaxy Libramont" oninput="pv2IdField('label', this.value)"></label>
          <label class="pv2-composer-field"><span>Adresse email</span><input value="${esc(identity.email)}" placeholder="contact@fungalaxy.be" oninput="pv2IdField('email', this.value)"></label>
          <label class="pv2-composer-field pv2-settings-check"><span>&nbsp;</span><label><input type="checkbox" ${identity.isDefault ? 'checked' : ''} onchange="pv2IdField('isDefault', this.checked)"> Adresse par défaut</label></label>
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
              ${i.isDefault ? '' : `<button type="button" class="pv2-btn sm" onclick="pv2IdDefault('${escJs(String(i.id))}')">Par défaut</button>`}
              <button type="button" class="pv2-btn sm" onclick="pv2IdDelete('${escJs(String(i.id))}')">Supprimer</button>
            </div>`).join('') : '<div class="pv2-empty"><strong>Aucune adresse configurée</strong>Ajoute l\'adresse (ou les adresses) avec lesquelles tes emails partent.</div>'}
          <div class="pv2-composer-actions"><button type="button" class="pv2-btn primary" onclick="pv2IdEdit()">+ Nouvelle adresse</button></div>
        </div>`;
    } else {
      const brain = pv2Settings.brain;
      content = !brain.loaded
        ? '<div class="pv2-empty"><strong>Chargement…</strong></div>'
        : `<div class="pv2-composer-grid">
          <p class="pv2-panel-sub pv2-composer-wide">L'agent répond aux mails reçus avec CES textes. Modifie-les librement : ce que tu écris ici gagne toujours sur le modèle d'origine. Champ vidé = retour au modèle.</p>
          <label class="pv2-composer-field"><span>Signature</span>
            <input value="${esc(brain.draft.signature)}" placeholder="${esc(brain.defaults.signature || '')}" oninput="pv2BrainField('signature', null, this.value)">
          </label>
          <label class="pv2-composer-field pv2-composer-wide"><span>Consignes libres (ce que l'agent doit toujours savoir)</span>
            <textarea rows="3" placeholder="Ex. Le parking est gratuit derrière le bâtiment. On ne prend pas de réservation le lundi." oninput="pv2BrainField('extra', null, this.value)">${esc(brain.draft.extra)}</textarea>
          </label>
          ${Object.entries(brain.defaults.intents || PV2_INTENT_LABELS).map(([intent, label]) => `
          <label class="pv2-composer-field pv2-composer-wide"><span>Réponse « ${esc(label)} »${brain.overrides.faq[intent] ? ' <em class="pv2-seq-pill">modifiée</em>' : ''}</span>
            <textarea rows="4" placeholder="${esc(brain.defaults.faq[intent]?.body || 'Réponse type…')}" oninput="pv2BrainField('faq', '${escJs(intent)}', this.value)">${esc(brain.draft.faq[intent] || '')}</textarea>
          </label>`).join('')}
          <div class="pv2-composer-actions pv2-composer-wide">
            <button type="button" class="pv2-btn primary" onclick="pv2BrainSave()" ${pv2Settings.busy ? 'disabled' : ''}>${pv2Settings.busy ? 'Enregistrement…' : 'Enregistrer, l\'agent apprend'}</button>
          </div>
        </div>`;
    }
    return `<section class="pv2-panel pv2-settings" data-pv2-mount="settings" aria-label="Réglages emails">
      <div class="pv2-panel-head has-sub">
        <div><h2>Réglages emails</h2><p class="pv2-panel-sub">Modèles, adresses d'envoi et cerveau de l'agent : tout vous appartient.</p></div>
        <button type="button" class="pv2-btn sm" onclick="pv2OpenSettings()">Fermer</button>
      </div>
      <div class="pv2-panel-body">
        <div class="crm-segbar pv2-settings-seg" role="tablist">${seg}</div>
        ${content}
      </div>
    </section>`;
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

  function pv2SuppressionPanel() {
    const open = !!state.staffSuppressOpen;
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
        <button type="button" class="pv2-btn sm" onclick="pv2ToggleSuppress()" aria-expanded="${open}">${open ? 'Masquer' : 'Voir la liste'}</button>
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
            ? '<div class="pv2-empty"><strong>Chargement…</strong></div>'
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
  window.pv2AutoEdit = function (key) {
    if (mkAuto.editKey === key) { mkAuto.editKey = ''; renderStaffEmailsPage(); return; }
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
    renderStaffEmailsPage();
  };

  window.pv2AutoEditField = function (field, value) {
    mkAuto.editDraft[field] = field === 'offsetDays' || field === 'cap' ? Number(value) : value;
  };

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
    const d = mkAuto.editDraft;
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
      ? `<p class="mk-auto-edit-vars">Variables : ${def.variables.map((v) => `<code>{{${esc(v)}}}</code>`).join(' ')}</p>`
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
    return `<div class="mk-auto-edit" data-pv2-mount="autoEditor">
      <label class="mk-auto-edit-field"><span>Objet</span>
        <input value="${esc(d.subject)}" placeholder="${esc(def.subject || 'Objet par défaut')}" oninput="pv2AutoEditField('subject', this.value)" aria-label="Objet du message">
      </label>
      <label class="mk-auto-edit-field"><span>Message</span>
        <textarea rows="5" placeholder="${esc(def.body || 'Message par défaut')}" oninput="pv2AutoEditField('body', this.value)" aria-label="Corps du message">${esc(d.body)}</textarea>
      </label>
      ${variables}
      ${timingSelect}
      ${capSelect}
      ${reviewField}
      ${warning}
      <div class="mk-auto-edit-actions">
        <button type="button" class="pv2-btn sm" onclick="pv2AutoEditReset('${meta.key}')" ${busy ? 'disabled' : ''}>Réinitialiser</button>
        <button type="button" class="pv2-btn sm" onclick="pv2AutoPreview('${meta.key}')" ${busy ? 'disabled' : ''}>Voir le mail</button>
        <button type="button" class="pv2-btn sm" onclick="pv2AutoSendTest('${meta.key}')" ${busy ? 'disabled' : ''}>M'envoyer un test</button>
        <button type="button" class="pv2-btn sm" onclick="pv2AutoEdit('${meta.key}')">Fermer</button>
        <button type="button" class="pv2-btn sm primary" onclick="pv2AutoEditSave('${meta.key}')" ${busy ? 'disabled' : ''}>${busy ? 'Enregistrement…' : 'Enregistrer'}</button>
      </div>
    </div>`;
  }

  function mkAutoCard(meta) {
    const setting = mkAuto.settings ? mkAuto.settings[meta.key] : null;
    const enabled = !!(setting && setting.enabled);
    const stats = mkAuto.stats[meta.key] || {};
    const busy = mkAuto.busyKey === meta.key;
    const editing = mkAuto.editKey === meta.key;
    const modified = pv2AutoHasOverride(meta.key);
    // L'aperçu de la carte montrait une phrase CODÉE EN DUR qui ne
    // correspondait à aucun texte réellement envoyé. On affiche maintenant le
    // vrai texte : celui du gérant s'il en a écrit un, sinon le texte d'usine
    // servi par le serveur. Le rendu HTML complet est derrière « Voir le mail ».
    const def = mkAuto.defaults[meta.key] || {};
    const previewText = (setting && setting.body) || def.body || '';
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
      <p class="mk-auto-desc">${esc(meta.desc)}</p>
      <details class="mk-auto-preview"><summary><span class="pv2-caret" aria-hidden="true"></span>Aperçu du message</summary><p>${esc(previewText)}</p></details>
      <div class="mk-auto-foot">
        <span class="mk-auto-stats">${statsTxt}</span>
        <button type="button" class="pv2-btn sm mk-auto-edit-btn" onclick="pv2AutoEdit('${meta.key}')">${ci('pencil')}${editing ? 'Fermer' : 'Modifier'}</button>
      </div>
      ${editing ? mkAutoEditor(meta) : ''}
    </article>`;
  }

  function pv2IsInbound(row) {
    return row.direction === 'inbound' || row.status === 'received';
  }

  function pv2ComposerPanel() {
    const d = pv2Mail.draft;
    if (!pv2Mail.metaLoaded && !pv2Mail.metaLoading) setTimeout(() => loadPv2MailMeta(), 0);
    const identityOptions = pv2Mail.identities.length
      ? pv2Mail.identities.map((i) => `<option value="${esc(String(i.id))}"${String(i.id) === String(d.identityId) ? ' selected' : ''}>${esc(i.label || i.email)}, ${esc(i.email)}</option>`).join('')
      : '<option value="">Expéditeur par défaut</option>';
    const templateOptions = [
      '<option value="">Partir de zéro…</option>',
      ...PV2_STARTERS.map((s) => `<option value="starter:${s.key}"${d.templateRef === `starter:${s.key}` ? ' selected' : ''}>${esc(s.name)}</option>`),
      ...pv2Mail.templates.map((t) => `<option value="tpl:${t.id}"${d.templateRef === `tpl:${t.id}` ? ' selected' : ''}>${esc(t.label || t.name || `Modèle ${t.id}`)}</option>`),
    ].join('');
    return `<section class="pv2-panel pv2-composer" data-pv2-mount="composer" aria-label="Nouveau message">
      <div class="pv2-panel-head has-sub">
        <div><h2>${d.replyTo ? 'Répondre' : 'Nouveau message'}</h2><p class="pv2-panel-sub">Choisissez le client (ou tapez une adresse), l'expéditeur, un modèle si vous voulez, et envoyez.</p></div>
        <button type="button" class="pv2-btn sm" onclick="pv2CloseComposer()">Fermer</button>
      </div>
      <div class="pv2-panel-body pv2-composer-grid">
        <label class="pv2-composer-field pv2-composer-to"><span>À</span>
          <input id="pv2ComposerTo" list="pv2ClientsList" value="${esc(d.to)}" placeholder="Nom ou adresse email du client…" oninput="pv2ComposerField('to', this.value)" autocomplete="off">
          <datalist id="pv2ClientsList">${pv2ComposerSuggestions()}</datalist>
        </label>
        <label class="pv2-composer-field"><span>Expéditeur</span>
          <select onchange="pv2ComposerField('identityId', this.value)" aria-label="Adresse d'envoi">${identityOptions}</select>
        </label>
        <label class="pv2-composer-field"><span>Modèle</span>
          <select onchange="pv2ComposerTemplate(this.value)" aria-label="Modèle de message">${templateOptions}</select>
        </label>
        <div class="pv2-composer-field pv2-composer-when"><span>Envoi</span>
          <div class="pv2-composer-when-row">
            <select onchange="pv2ComposerField('when', this.value); renderStaffEmailsPage();" aria-label="Moment d'envoi">
              <option value="now"${d.when !== 'later' ? ' selected' : ''}>Maintenant</option>
              <option value="later"${d.when === 'later' ? ' selected' : ''}>Programmer</option>
            </select>
            ${d.when === 'later' ? `<input type="datetime-local" value="${esc(d.scheduledAt)}" aria-label="Date et heure d'envoi" onchange="pv2ComposerField('scheduledAt', this.value)">` : ''}
          </div>
        </div>
        <label class="pv2-composer-field pv2-composer-wide"><span>Objet</span>
          <input id="pv2ComposerSubject" value="${esc(d.subject)}" placeholder="Objet du message" oninput="pv2ComposerField('subject', this.value)">
        </label>
        <label class="pv2-composer-field pv2-composer-wide"><span>Message</span>
          <textarea id="pv2ComposerBody" rows="8" placeholder="Bonjour…" oninput="pv2ComposerField('body', this.value)">${esc(d.body)}</textarea>
        </label>
        ${pv2Mail.aiTips.length ? `<ul class="pv2-composer-tips">${pv2Mail.aiTips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
        <div class="pv2-composer-actions pv2-composer-wide">
          <button type="button" class="pv2-btn" onclick="pv2ComposerImprove()" ${pv2Mail.aiBusy ? 'disabled' : ''}>${ci('sparkles')}${pv2Mail.aiBusy ? 'Analyse…' : 'Améliorer par IA'}</button>
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
          <input id="pv2AnalyzeFrom" value="${esc(pv2Mail.analyzeDraft.from)}" placeholder="client@exemple.be" oninput="pv2AnalyzeField('from', this.value)">
        </label>
        <label class="pv2-composer-field pv2-composer-wide"><span>Texte du mail reçu</span>
          <textarea rows="6" placeholder="Collez ici le contenu du mail…" oninput="pv2AnalyzeField('body', this.value)">${esc(pv2Mail.analyzeDraft.body)}</textarea>
        </label>
        <div class="pv2-composer-actions pv2-composer-wide">
          <button type="button" class="pv2-btn primary" onclick="pv2AnalyzeSubmit()" ${pv2Mail.analyzeBusy ? 'disabled' : ''}>${ci('sparkles')}${pv2Mail.analyzeBusy ? 'Analyse…' : 'Analyser'}</button>
        </div>
      </div>
    </section>`;
  }

  function pv2InboundDetail(row) {
    const analysis = pv2InboxAnalysis(row);
    const draft = pv2InboxReplyDraft(row);
    const busy = pv2Mail.replyBusy === row.uid;
    const replied = !!(row.payload && (row.payload.replyCommunicationId || row.payload.repliedAt));
    const intentLabel = analysis ? (analysis.intentLabel || PV2_INTENT_LABELS[analysis.intent] || analysis.intent) : '';
    return `
      <div class="pv2-panel-body pv2-mail-detail">
        <div class="pv2-kv">
          <div><dt>De</dt><dd>${esc(row.payload?.from || row.recipient || '-')}</dd></div>
          <div><dt>Reçu</dt><dd>${esc(formatOpsTimestamp(row.receivedAt || row.createdAt || row.scheduledAt) || '-')}</dd></div>
          ${replied ? '<div><dt>Statut</dt><dd>Répondu</dd></div>' : ''}
        </div>
        <div>
          <div class="pv2-mail-preview-title">Mail reçu</div>
          <div class="pv2-mail-preview">${esc(String(row.payload?.textBody || row.subject || ''))}</div>
        </div>
        ${analysis ? `
        <div class="pv2-inbox-analysis">
          <div class="pv2-mail-preview-title">Ce qu'il veut</div>
          <div class="pv2-inbox-summary">
            <span class="pv2-inbox-intent">${esc(intentLabel)}</span>
            ${analysis.urgency === 'haute' ? '<span class="pv2-inbox-urgent">Urgent</span>' : ''}
            <p>${esc(analysis.summary || '')}</p>
          </div>
        </div>
        <div class="pv2-inbox-reply">
          <div class="pv2-mail-preview-title">Réponse proposée${analysis.provider && analysis.provider !== 'rules' ? ' (IA)' : ''}</div>
          <input class="pv2-inbox-reply-subject" value="${esc(draft.subject)}" aria-label="Objet de la réponse" oninput="pv2InboxReplyField('${escJs(row.uid)}', 'subject', this.value)">
          <textarea class="pv2-inbox-reply-body" rows="7" aria-label="Réponse" oninput="pv2InboxReplyField('${escJs(row.uid)}', 'body', this.value)">${esc(draft.body)}</textarea>
          <div class="pv2-composer-actions">
            <button type="button" class="pv2-btn" onclick="pv2InboxReanalyze('${escJs(row.uid)}')" ${busy ? 'disabled' : ''}>${ci('refresh')}Ré-analyser</button>
            <span class="pv2-composer-spacer"></span>
            <button type="button" class="pv2-btn primary" onclick="pv2InboxReply('${escJs(row.uid)}')" ${busy ? 'disabled' : ''}>${ci('send')}${busy ? 'Envoi…' : 'Envoyer la réponse'}</button>
          </div>
        </div>` : `
        <div class="pv2-inbox-analysis">
          <div class="pv2-mail-preview-title">Pas encore analysé</div>
          <div class="pv2-composer-actions">
            <button type="button" class="pv2-btn" onclick="pv2InboxReanalyze('${escJs(row.uid)}')" ${busy ? 'disabled' : ''}>${ci('sparkles')}${busy ? 'Analyse…' : 'Analyser ce mail'}</button>
          </div>
        </div>`}
      </div>`;
  }

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
    if (!mkAuto.loaded && !mkAuto.loading) setTimeout(() => loadStaffAutomations(), 0);
    if (!pv2Seq.loaded && !pv2Seq.loading) setTimeout(() => loadPv2Sequences(), 0);
    // Chargé à l'ouverture de la page, pas seulement à l'ouverture du panneau :
    // le compteur est le seul signal utile quand la section est repliée, et
    // afficher « 0 » sans avoir demandé serait un chiffre inventé.
    if (!pv2Suppress.loaded && !pv2Suppress.loading) setTimeout(() => loadPv2Suppressions(), 0);
    // C14 : ops-console.js est injecté à la demande, requestOpsAdminLoad
    // (app-main) charge le script puis déclenche loadOpsAdmin.
    if (!opsAdminCache.loaded && !opsAdminCache.loading) setTimeout(() => requestOpsAdminLoad(false), 0);
    const everyRow = getStaffEmailRows();
    const inboundRows = everyRow.filter(pv2IsInbound);
    /* ORIGINE (demande du proprio) : dissocier les mails partis TOUT SEULS
       (séquences, rappels, worker) des mails envoyés PAR L'ÉQUIPE (messages,
       relances, campagnes, tests). Le classifieur est getStaffEmailOrigin
       (app-main.js), ancré sur les champs payload posés par le serveur.
       Compteurs : le VRAI nombre par catégorie, sur toutes les communications
       chargées, indépendamment des filtres de statut. */
    const originFilter = ['all', 'auto', 'manual', 'inbound'].includes(state.staffEmailOriginFilter)
      ? state.staffEmailOriginFilter
      : 'all';
    const originCounts = { auto: 0, manual: 0, inbound: 0 };
    everyRow.forEach((row) => { originCounts[getStaffEmailOrigin(row)] += 1; });
    // La file (et ses compteurs de statut) se restreint à l'origine choisie :
    // les chiffres des segments de statut collent toujours à la liste affichée.
    const scopedRows = originFilter === 'auto' || originFilter === 'manual'
      ? everyRow.filter((row) => getStaffEmailOrigin(row) === originFilter)
      : everyRow;
    const allRows = scopedRows.filter((row) => !pv2IsInbound(row));
    const filter = state.staffEmailFilter || 'all';
    const query = String(state.staffEmailQuery || '').trim().toLowerCase();
    // Le filtre « Reçus » vit ici (app-main ne connaît que les statuts d'envoi).
    const rows = filter === 'inbound'
      ? inboundRows.filter((row) => !query || getStaffEmailText(row).includes(query))
      : getStaffEmailRowsFiltered().filter((row) => !pv2IsInbound(row));
    const selected = getSelectedStaffEmailRow(rows);
    if (selected && state.staffEmailSelectedId !== selected.uid) state.staffEmailSelectedId = selected.uid;
    const metrics = getStaffEmailMetrics(allRows);
    const inboundWaiting = inboundRows.filter((row) => !(row.payload && (row.payload.replyCommunicationId || row.payload.repliedAt))).length;
    const updatedAt = opsAdminCache.lastLoadedAt ? formatOpsTimestamp(opsAdminCache.lastLoadedAt) : 'non chargé';

    /* « En file » était BLEU, c'est-à-dire de la couleur réservée à
       l'information, alors qu'un mail programmé pas encore parti est un état
       d'ATTENTE : sa couleur est l'ambre. Et « en file » est du vocabulaire de
       serveur de mails ; pour une gérante c'est « en attente ». */
    const KIND_META = {
      queued: { label: 'En attente', tone: 'amber' },
      sent: { label: 'Envoyé', tone: 'green' },
      failed: { label: 'Échec', tone: 'red' },
      draft: { label: 'Brouillon', tone: '' },
      cancelled: { label: 'Annulé', tone: '' },
    };

    /* Les six tuiles occupaient une bande pleine largeur et pesaient autant que
       la file elle-même, alors que ce sont des FILTRES : on clique dessus pour
       restreindre la liste. Rendues comme telles (bande de chips, chiffre puis
       libellé sur une ligne), elles descendent de ~120 px à ~52 px et la file
       remonte d'autant. Aucune n'est supprimée : chacune est le seul chemin
       vers son filtre, « Tout » compris (c'est le retour à la vue complète).
       <button> plutôt que <div> : le filtre devient atteignable au clavier. */
    /* ACCORDS. « 1 Échecs », « 1 Envoyés », « 3 Tout » traînaient sur un écran
       relu tous les jours. Le libellé s'accorde donc au compteur, et « Tout »,
       qui est invariable, ne se met plus DERRIÈRE un nombre (« 3 Tout » ne veut
       rien dire) : il s'écrit « Tout (3) ». */
    const pipe = (key, one, many, value, hint, opts = {}) => {
      const n = Number(value) || 0;
      const label = esc(n > 1 ? many : one);
      // Le compte-à-rebours animé écrase le textContent : il ne peut pas porter
      // les parenthèses. Le total ne s'anime donc pas, et c'est sans importance,
      // il ne change quasiment jamais.
      const valueHtml = opts.paren
        ? `<span class="pv2-pipe-value">(${n})</span>`
        : `<span class="pv2-pipe-value" ${PV2.lastPage !== 'emails' ? `data-pv2-count="${n}"` : ''}>${n}</span>`;
      return `<button type="button" class="pv2-pipe ${filter === key ? 'active' : ''}" data-pipe="${key}" onclick="pv2EmailFilter('${key}')" aria-pressed="${filter === key}">
      ${opts.paren ? `<span class="pv2-pipe-label">${label}</span>${valueHtml}` : `${valueHtml}<span class="pv2-pipe-label">${label}</span>`}
      ${hint ? `<span class="pv2-pipe-hint">${esc(hint)}</span>` : ''}
    </button>`;
    };

    /* Un mail qui ne part pas ne se voyait NULLE PART : le pipe « Échecs »
       existait, mais il fallait déjà savoir qu'il y avait un problème pour
       aller cliquer dessus. Personne ne le faisait, et 51 mails sont restés
       invisibles. Ce bandeau est la réponse : il s'impose en tête de page,
       nomme la cause dominante en français et dit quoi faire. */
    const failureGroups = getStaffEmailFailureGroups(allRows);
    const topFailure = failureGroups[0];
    const failureBanner = metrics.failed > 0 ? `
      <section class="pv2-alert" role="alert">
        <div class="pv2-alert-main">
          <strong>${metrics.failed} mail${metrics.failed > 1 ? 's ne sont jamais partis' : ' n\'est jamais parti'} <span class="pv2-alert-scope">sur les ${allRows.length} messages de la file</span></strong>
          ${topFailure ? `<p class="pv2-alert-cause"><b>${esc(topFailure.label)}</b>${failureGroups.length > 1 ? ` (${topFailure.count} sur ${metrics.failed})` : ''} : ${esc(topFailure.fix)}</p>` : ''}
          ${failureGroups.length > 1 ? `<p class="pv2-alert-other">Autres causes : ${failureGroups.slice(1).map((g) => `${esc(g.label)} (${g.count})`).join(' · ')}</p>` : ''}
        </div>
        <button type="button" class="pv2-btn" onclick="pv2EmailFilter('failed')">${metrics.failed > 1 ? `Voir les ${metrics.failed} échecs` : 'Voir cet échec'}</button>
      </section>` : '';

    const tableHead = filter === 'inbound'
      ? '<thead><tr><th>De</th><th>Demande</th><th>Statut</th><th class="num">Reçu</th></tr></thead>'
      : '<thead><tr><th>Message</th><th>Modèle</th><th>Statut</th><th class="num">Date</th></tr></thead>';

    const tableRows = rows.slice(0, 80).map((row) => {
      if (filter === 'inbound') {
        const analysis = pv2InboxAnalysis(row);
        const replied = !!(row.payload && (row.payload.replyCommunicationId || row.payload.repliedAt));
        const intentLabel = analysis ? (analysis.intentLabel || PV2_INTENT_LABELS[analysis.intent] || analysis.intent) : '';
        return `<tr class="${selected && row.uid === selected.uid ? 'selected' : ''}" onclick="pv2SelectEmail('${escJs(row.uid)}')">
          <td><strong>${esc(analysis?.clientName || row.payload?.from || row.recipient || '-')}</strong><small class="pv2-cell-sub">${esc(row.subject || '')}</small></td>
          <td>${analysis ? `<span class="pv2-inbox-intent">${esc(intentLabel)}</span>${analysis.urgency === 'haute' ? ' <span class="pv2-inbox-urgent">Urgent</span>' : ''}<small class="pv2-cell-sub">${esc(analysis.summary || '')}</small>` : '<span class="pv2-chip">À analyser</span>'}</td>
          <td>${replied ? '<span class="pv2-chip green">Répondu</span>' : '<span class="pv2-chip blue">À répondre</span>'}</td>
          <td class="num">${esc(formatOpsTimestamp(row.receivedAt || row.createdAt || row.scheduledAt) || '-')}</td>
        </tr>`;
      }
      const meta = KIND_META[row.statusKind] || KIND_META.draft;
      // La cause de l'échec se lit dans la LISTE, pas seulement après avoir
      // sélectionné la ligne : c'est ce qui rend un échec impossible à rater.
      const failure = row.statusKind === 'failed' ? getStaffEmailFailureReason(row) : null;
      // Badge d'origine discret sur chaque ligne : Auto (parti tout seul) ou
      // Manuel (envoyé par l'équipe). Étiquette, pas statut : chip neutre.
      const rowOrigin = getStaffEmailOrigin(row);
      return `<tr class="${selected && row.uid === selected.uid ? 'selected' : ''}${failure ? ' is-failed' : ''}" onclick="pv2SelectEmail('${escJs(row.uid)}')">
        <td><strong>${esc(row.subject || row.templateLabel || 'Message')}</strong><small class="pv2-cell-sub">${esc(row.recipient || '-')}</small></td>
        <td><span class="pv2-chip">${esc(row.templateLabel || row.templateId || '-')}</span><span class="pv2-chip pv2-origin-badge" data-origin="${rowOrigin}">${rowOrigin === 'manual' ? 'Manuel' : 'Auto'}</span></td>
        <td><span class="pv2-chip ${meta.tone}">${meta.label}</span>${failure ? `<small class="pv2-cell-sub pv2-cell-fail">${esc(failure.label)}</small>` : ''}</td>
        <td class="num">${esc(formatOpsTimestamp(row.sentAt || row.scheduledAt || row.createdAt) || '-')}</td>
      </tr>`;
    }).join('');

    const payload = selected?.payload || {};
    const detail = !selected
      ? '<div class="pv2-empty"><strong>Aucun message</strong>Sélectionnez une communication.</div>'
      : pv2IsInbound(selected)
        ? pv2InboundDetail(selected)
        : `
      <div class="pv2-panel-body pv2-mail-detail">
        <div class="pv2-kv">
          <div><dt>Destinataire</dt><dd>${esc(selected.recipient || '-')}</dd></div>
          <div><dt>Modèle</dt><dd>${esc(selected.templateLabel || selected.templateId || '-')}</dd></div>
          <div><dt>Origine</dt><dd>${esc(getStaffEmailOrigin(selected) === 'manual'
            ? `Envoi manuel${payload.staffMember ? ` · ${payload.staffMember}` : ''}`
            : 'Automatique · parti tout seul')}</dd></div>
          <div><dt>Canal</dt><dd>${esc(selected.channel || 'email')}</dd></div>
          <div><dt>Statut</dt><dd>${esc((KIND_META[selected.statusKind] || {}).label || selected.status || '-')}</dd></div>
          <div><dt>Programmé</dt><dd>${esc(formatOpsTimestamp(selected.scheduledAt) || '-')}</dd></div>
          ${selected.sentAt ? `<div><dt>Envoyé</dt><dd>${esc(formatOpsTimestamp(selected.sentAt))}</dd></div>` : ''}
          ${selected.attempts ? `<div><dt>Tentatives</dt><dd>${Number(selected.attempts)}</dd></div>` : ''}
        </div>
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
          <div class="pv2-mail-preview-title">Aperçu</div>
          <div class="pv2-mail-preview">${esc(String(payload.textBody || selected.subject || 'Pas de contenu texte.'))}</div>
        </div>
      </div>`;

    root.innerHTML = `<div class="pv2-shell">
      ${bar({
        crumb: 'Clients & Marketing / Communications',
        title: 'Emails & relances',
        /* « File opérationnelle · actualisé 20/07 01:06 » : deux termes de
           jargon interne pour une gérante de centre. Le sous-titre dit
           maintenant ce que la page contient, en français, et l'heure de
           fraîcheur passe en fin de ligne où elle ne bloque plus la lecture. */
        sub: `Ce qui part, ce qui arrive, ce qui n'est pas parti <span class="pv2-bar-stamp">· à jour à ${esc(updatedAt)}</span>${errorMessage ? ` · <span style="color:var(--v2-red)">${esc(errorMessage)}</span>` : ''}`,
        /* Six boutons de poids identique = aucune hiérarchie : l'œil ne sait
           pas par où commencer, et « Analyser un reçu » se lisait comme un
           reçu de caisse alors que le panneau sert à COLLER un mail reçu d'un
           client. Trois niveaux désormais : une seule action primaire
           (Nouveau message), une secondaire (Coller un mail reçu), le reste en
           discret. « Exporter » et « Envoyer la file » quittent la tête pour
           se poser sur la file, l'objet sur lequel ils agissent. */
        actions: `
          <label class="pv2-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="14" height="14"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg><input value="${esc(state.staffEmailQuery || '')}" placeholder="Client, sujet, erreur…" oninput="setStaffEmailQuery(this.value)"></label>
          <button type="button" class="pv2-btn sm ghost" onclick="requestOpsAdminLoad(true)" title="Recharger les données">${ci('refresh')}Actualiser</button>
          <button type="button" class="pv2-btn sm ghost" onclick="pv2OpenSettings()">${ci('wrench')}Réglages</button>
          <button type="button" class="pv2-btn" onclick="pv2OpenAnalyze()">${ci('inbox')}Coller un mail reçu</button>
          <button type="button" class="pv2-btn primary" onclick="pv2OpenComposer()">${ci('send')}Nouveau message</button>`,
      })}

      ${failureBanner}

      <!-- FAMILLE B. Ces trois panneaux apparaissent VRAIMENT sur une action de
           la gerante, mais ils sont aussi re-rendus a chaque frappe dans la
           recherche : sans la garde de markEmailsMounts(), leur entree
           rejouerait a chaque lettre tapee. -->
      ${pv2Mail.composerOpen ? pv2ComposerPanel() : ''}
      ${pv2Mail.analyzeOpen ? pv2AnalyzePanel() : ''}
      ${pv2Settings.open ? pv2SettingsPanel() : ''}

      <!-- ORIGINE (demande du proprio) : dissocier ce qui part TOUT SEUL de ce
           que l'equipe envoie ELLE-MEME. Segmente a part du segmente de statut :
           les deux se COMBINENT (ex. Envois manuels + Echecs). Compteurs reels
           par categorie, calcules sur toutes les communications chargees. -->
      <section class="pv2-origins" role="group" aria-label="Origine des messages">
        <span class="pv2-origins-label">Origine</span>
        ${[
          { key: 'all', label: 'Tous', count: null },
          { key: 'auto', label: 'Automatiques', count: originCounts.auto },
          { key: 'manual', label: 'Envois manuels', count: originCounts.manual },
          { key: 'inbound', label: 'Reçus', count: originCounts.inbound },
        ].map((seg) => `<button type="button" class="pv2-chip-btn pv2-origin-seg${originFilter === seg.key ? ' active' : ''}" onclick="pv2EmailOriginFilter('${seg.key}')" aria-pressed="${originFilter === seg.key}">${esc(seg.label)}${seg.count === null ? '' : `<span class="pv2-origin-count">(${seg.count})</span>`}</button>`).join('')}
        <span class="pv2-origins-hint">Automatiques : partis tout seuls (séquences, rappels). Envois manuels : envoyés par vous ou l'équipe (messages, relances, campagnes, tests).</span>
      </section>

      <!-- Le rail est le SEUL element stable du segmente : il ne porte aucun
           texte, donc aucune donnee ne le detruit. slidePipeRail() le
           repositionne apres chaque reconstruction depuis une memoire hors
           DOM : il GLISSE quand la gerante change de filtre, et il ne bouge
           pas d'un pixel quand seules les donnees ont change. -->
      <section class="pv2-pipeline" role="group" aria-label="Filtrer la file">
        <span class="pv2-pipe-rail" aria-hidden="true"></span>
        ${pipe('all', 'Tout', 'Tout', allRows.length, '', { paren: true })}
        ${pipe('inbound', 'Reçu', 'Reçus', inboundRows.length, inboundWaiting ? plural(inboundWaiting, 'sans réponse', 'sans réponse') : '')}
        ${pipe('queued', 'En attente', 'En attente', metrics.queued, plural(metrics.due || 0, 'prêt à partir', 'prêts à partir'))}
        ${pipe('sent', 'Envoyé', 'Envoyés', metrics.sent, `${metrics.deliveryRate || 0} % de réussite`)}
        ${pipe('failed', 'Échec', 'Échecs', metrics.failed, plural(metrics.attempted || 0, 'tentative d’envoi', 'tentatives d’envoi'))}
        ${pipe('review', 'À valider', 'À valider', metrics.review, '')}
      </section>
      <!-- TROIS CHIFFRES DIFFERENTS POUR LA MEME CHOSE sur le meme ecran : le
           bandeau comptait les echecs de la file, le segmente comptait des
           tentatives, les cartes de sequences comptent sur 30 jours. Aucun des
           trois perimetres n'etait annonce. Une gerante qui voit trois chiffres
           pour une seule question cesse de faire confiance a l'ecran : chaque
           perimetre est desormais ecrit a cote de son chiffre. -->
      <!-- LA LEGENDE MENTAIT SUR SON PROPRE PERIMETRE : « ces compteurs portent
           sur les N messages de la file » englobait « Reçus », qui est
           precisement ce qui n'est PAS dans la file sortante. Une legende
           censee lever une confusion en creait une autre. Les deux perimetres
           sont donc annonces separement, chacun avec son chiffre, et les deux
           chiffres sont ceux affiches sur les segments (verifie au gate). -->
      <p class="pv2-pipeline-scope">Tout, En attente, Envoyés, Échecs et À valider portent sur les ${allRows.length} messages de la file ci-dessous. Reçus compte à part les ${inboundRows.length} mails arrivés dans la boîte du centre. Les cartes de séquences, plus bas, comptent sur les 30 derniers jours.</p>

      <section class="pv2-split">
        <article class="pv2-panel pv2-mail-list">
          <div class="pv2-panel-head pv2-list-head">
            <h2>${filter === 'inbound' ? 'Mails reçus' : 'La file'}</h2>
            <div class="pv2-panel-head-actions">
              <button type="button" class="pv2-btn sm ghost" onclick="exportStaffEmailsCsv()">Exporter</button>
              <button type="button" class="pv2-btn sm" onclick="requestOpsDispatch()">Envoyer la file</button>
            </div>
          </div>
          <table class="pv2-table">
            ${tableHead}
            <tbody>${tableRows || `<tr><td colspan="4"><div class="pv2-empty"><strong>${filter === 'inbound' ? 'Aucun mail reçu' : 'File vide'}</strong>${filter === 'inbound' ? 'Collez un mail avec « Coller un mail reçu » : l\'agent prépare la réponse.' : originFilter === 'auto' ? 'Aucun mail automatique ne correspond à ce filtre.' : originFilter === 'manual' ? 'Aucun envoi manuel ne correspond à ce filtre.' : 'Aucune communication pour ce filtre.'}</div></td></tr>`}</tbody>
          </table>
        </article>
        <article class="pv2-panel">
          <div class="pv2-panel-head"><h2>${esc(selected?.subject || 'Détail')}</h2></div>
          ${detail}
        </article>
      </section>

      <!-- ORDRE DE LECTURE (défaut n°7 de la capture : « trop de défilement »).
           L'ancien ordre était séquences → inventaire → filtres → file :
           il fallait passer deux sections de RÉGLAGE avant de voir ce qui se
           passe AUJOURD'HUI. Or la page se consulte tous les jours pour deux
           questions (« qu'est-ce qui n'est pas parti ? », « qu'est-ce qui part
           maintenant ? ») et se règle trois fois par an. Ce qui se consulte
           passe donc devant ce qui se règle : échecs, filtres, file, détail
           tiennent haut ; les séquences, l'inventaire et les campagnes suivent
           pour qui descend les chercher. -->
      <section class="pv2-panel mk-auto-panel">
        <div class="pv2-panel-head has-sub">
          <!-- Le reste de la page vouvoie la directrice, cette phrase la
               tutoyait (« Active, coupe, personnalise, ou crée les tiennes »).
               Un seul registre sur tout l'écran. -->
          <div><h2>Séquences automatiques</h2><p class="pv2-panel-sub">Les emails qui partent tout seuls, au bon moment. Activez, coupez, personnalisez, ou créez les vôtres. Les compteurs de chaque carte portent sur les 30 derniers jours.</p></div>
          <div class="pv2-panel-head-actions">
            ${mkAuto.error ? `<button type="button" class="pv2-btn sm" onclick="loadStaffAutomations(true)">Réessayer</button>` : ''}
            <button type="button" class="pv2-btn sm" onclick="pv2SeqNew()">+ Créer une séquence</button>
          </div>
        </div>
        <div class="pv2-panel-body">
          ${mkAuto.error
            ? `<div class="pv2-empty"><strong>${esc(mkAuto.error)}</strong></div>`
            : mkAuto.loaded
              ? `<div class="mk-auto-grid">${AUTOMATION_META.map(mkAutoCard).join('')}${pv2Seq.sequences.map(pv2SeqCard).join('')}</div>`
              : `<div class="pv2-empty"><strong>Chargement des séquences…</strong></div>`}
          ${(pv2Seq.creating || pv2Seq.editId) ? pv2SeqEditor() : ''}
        </div>
      </section>

      <!-- Le Journal des modifications ne vit PLUS ici : il n'a rien a faire
           dans Mail marketing. Il vit dans la console Direction, onglet
           Journal (renderAdminJournalTab, admin-console.js). -->
      ${pv2SuppressionPanel()}
      ${mailInventoryPanel()}
      ${typeof renderPv2RealCampaigns === 'function' ? renderPv2RealCampaigns() : ''}
    </div>`;
    mount(root, 'emails');
    // Le mouvement se recale APRES la reconstruction, jamais pendant : les trois
    // appels lisent une memoire hors DOM, comparent, et ne bougent que ce qui a
    // reellement change d'etat. C'est ce qui rend la page animee sans qu'aucune
    // animation ne rejoue quand seules les donnees ont bouge.
    slidePipeRail(root);
    replaySwitchKnobs(root);
    markEmailsMounts(root, {
      composer: pv2Mail.composerOpen,
      analyze: pv2Mail.analyzeOpen,
      settings: pv2Settings.open,
      seqEditor: pv2Seq.creating || pv2Seq.editId,
      autoEditor: mkAuto.editKey,
      inventory: state.staffEmailInventoryOpen,
    });
    if (typeof pv2Camp !== 'undefined' && !pv2Camp.loaded && !pv2Camp.loading) setTimeout(() => loadPv2Campaigns(), 0);
  };

  /* ==========================================================================
     CAMPAGNES : parcours gamifié « agence marketing » (style Duolingo)
     Consomme le moteur marketing-agents (brand / strategy / missions / drafts /
     summary / agents) exposé PAR CENTRE via staffMarketingAgentsCache.status.
     Aucune donnée inventée : tout vient du collecteur backend.
     ======================================================================== */

  const CAMPAIGN_TIERS = ['Découverte', 'Éveil', 'En rythme', 'Maîtrise', 'Expert', 'Virtuose', 'Légende'];
  const CHANNEL_LABELS = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', linkedin: 'LinkedIn', email: 'Email' };
  const GAP_META = {
    couvert: { label: 'Couvert', tone: 'green' },
    'a-renforcer': { label: 'À renforcer', tone: 'amber' },
    opportunite: { label: 'Opportunité', tone: 'blue' },
  };
  const AUDIENCE_LABELS = {
    particulier: 'Familles & particuliers',
    entreprise: 'Entreprises',
    ecole: 'Écoles & clubs',
    public: 'Grand public',
  };
  const campaignClipboard = new Map();

  // La voix de marque est un objet {person, energy, ...} : on en tire une chaîne
  // lisible (jamais « [object Object] »).

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

  const channelLabel = (p) => CHANNEL_LABELS[p] || (p ? p.charAt(0).toUpperCase() + p.slice(1) : 'Canal');

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
    payOpen: false, radarOpen: null, openCard: null, cardNetwork: {},
    angleOpen: null, publishedAsk: null, moreOpen: false, receiptsAll: false,
    askFocus: false, busy: '', published: {}, dismissed: {},
    studioChannel: 'facebook', studioPacks: {}, studioBusy: false,
    // Le chat de demande (fix client 2026-07-18) : chaque envoi du composer
    // devient un ECHANGE du fil (bulle utilisateur -> je prépare -> réponse).
    chat: [],
    // Les tours d'ambiance (radar, veille, résultats) sont repliés par défaut
    // en une ligne-résumé : le fil s'ouvre calme, le détail reste à un tap.
    folds: { radar: false, veille: false, results: false },
  };
  window.mkBrief = mkBrief;

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

  const BR_TRIGGER_LABELS = { pluie: 'pluie', chaleur: 'chaleur', creux: 'jour calme', jour_fort: 'jour fort', evenement: 'événement', vacances: 'vacances', concurrent: 'concurrence', demande: 'ta demande', plan: 'mon plan' };
  const BR_TRIGGER_TONE = { creux: 'danger', jour_fort: 'success' };
  const BR_NETWORK_LABELS = { facebook: 'Facebook', instagram: 'Instagram', story: 'Story', email: 'Email' };

  // NB (refonte agent-natif 2026-07-18) : la ligne de voix (ex-mkwVoice) et les
  // 4 stat-cards « dashboard » (ex-mkwStatCards) ont disparu comme composants
  // plats. Leur substance vit désormais dans le FIL : la voix devient le tour
  // d'accueil (mkwGreeting), et les 4 chiffres sont distribués dans les tours
  // (résultat = euros, radar = jour à remplir, veille = concurrents), un fait à
  // la fois, dans la conversation. mkBrPeriod/mkBrPayDetail restent (Résultats).

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
          sources: (roi.bySource || []).filter((s) => s.sent > 0).sort((a, b) => b.revenue - a.revenue),
          // Même doctrine que le serveur : jeune = rien envoyé ET rien jamais
          // mesuré ; fenêtre calme = un historique existe, cette période est vide.
          young: roi.sent === 0 && measuredCount === 0,
          quietWindow: roi.sent === 0 && measuredCount > 0,
        };
      }
    } catch (error) { /* la paie précédente reste */ } finally {
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

  // Le radar 14 jours : builder NU (sans titre de section : dans le fil
  // agent-natif, la phrase de l'agent porte le contexte, la grille est la carte
  // inline). Réutilisé tel quel par mkwRadarTurn().
  function mkwRadar() {
    const b = mkBrief.data;
    if (!b) return `<div class="mkw-radar">${'<span class="mkw-cell mkw-cell-skel"></span>'.repeat(14)}</div>`;
    if (!b.radar || !b.radar.length) {
      return `<p class="mkw-quiet">Je n'ai pas de prévision fiable aujourd'hui : je réessaie cette nuit.</p>`;
    }
    const cells = b.radar.map((day) => {
      const isToday = day.date === b.today;
      const open = mkBrief.radarOpen === day.date;
      const temp = day.tmax !== null && day.tmax !== undefined ? `${Math.round(day.tmax)}°` : '';
      return `<button type="button" class="mkw-cell lv-${esc(day.level)} ${isToday ? 'is-today' : ''} ${open ? 'is-open' : ''}" aria-expanded="${open}" onclick="mkBrRadar('${escJs(day.date)}')" title="${esc(day.explanation)}">
        <span class="mkw-cell-day">${isToday ? 'auj.' : `${BR_DOW[day.dow]} ${day.date.slice(8, 10)}`}</span>
        ${brWeatherIcon(day)}
        <span class="mkw-cell-temp">${temp}</span>
        <span class="mkw-cell-resa">${day.resaCount ? `${day.resaCount} <em>rés.</em>` : ''}</span>
        ${day.event ? '<span class="mkw-cell-event" aria-hidden="true"></span>' : ''}
      </button>`;
    }).join('');
    // Ligne de synthèse : le total des réservations à venir + le prochain événement.
    const upcoming = b.pulse ? b.pulse.upcomingPax : b.radar.reduce((s, d) => s + (d.resaCount || 0), 0);
    const eventDay = b.radar.find((d) => d.event);
    // Texte brut : brProse met le nombre en gras (pas de HTML manuel, il serait échappé).
    const summary = [
      upcoming ? `${upcoming} personnes déjà attendues` : '',
      eventDay ? `${eventDay.event.replace(' (à 5 min)', '')} arrive` : '',
    ].filter(Boolean).join(' · ');
    const openDay = b.radar.find((day) => day.date === mkBrief.radarOpen);
    let explain = '';
    if (openDay) {
      // La liste FILTREE fait foi : un lien vers une carte perimee ou
      // dedoublonnee pointerait dans le vide.
      const linked = openDay.propositionKey && brVisiblePropositions().some((p) => p.key === openDay.propositionKey);
      const canFill = (openDay.level === 'creux' || openDay.level === 'calme') && !linked;
      // La valeur du creux, en euros, là où la décision se prend (audit §7) :
      // le panier moyen est MESURÉ (30 j), on ne projette rien, on rappelle un fait.
      const basket = b.pulse && b.pulse.avgBasket > 0 ? b.pulse.avgBasket : 0;
      const worth = (openDay.level === 'creux' || openDay.level === 'calme') && basket
        ? ` Chaque visiteur récupéré ce jour-là vaut environ ${money(basket)} (ton panier moyen mesuré).`
        : '';
      explain = `<div class="mkw-radar-explain">
        <span>${brProse(openDay.explanation + worth)}</span>
        ${linked ? `<button type="button" class="mkw-link" onclick="mkBrGoCard('${escJs(openDay.propositionKey)}')">Voir la proposition</button>` : ''}
        ${canFill ? `<button type="button" class="mkw-link" onclick="mkBrRadarFill('${escJs(openDay.date)}')" ${mkBrief.busy === `fill:${openDay.date}` ? 'disabled' : ''}>${mkBrief.busy === `fill:${openDay.date}` ? 'je prépare…' : 'Prépare-moi un post pour remplir ce jour'}</button>` : ''}
      </div>`;
    }
    return `<div class="mkw-radar">${cells}</div>
      ${summary ? `<p class="mkw-radar-sum">${brProse(summary)}</p>` : ''}
      ${explain}`;
  }

  window.mkBrRadar = function (date) {
    mkBrief.radarOpen = mkBrief.radarOpen === date ? null : date;
    renderStaffCampaignsPage();
  };
  window.mkBrGoCard = function (key) {
    mkBrief.openCard = key;
    // Fix audit 4.1 : si la cible est au-delà des 3 cartes visibles, le
    // querySelector ne trouvait rien et le clic était silencieusement inopérant.
    const index = brVisiblePropositions().findIndex((p) => p.key === key);
    if (index >= 3) mkBrief.moreOpen = true;
    renderStaffCampaignsPage();
    setTimeout(() => {
      const el = document.querySelector(`[data-br-card="${CSS.escape(key)}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('mkw-flash');
        setTimeout(() => el.classList.remove('mkw-flash'), 1100);
      }
    }, 50);
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
      toast('C\'est prêt : regarde plus bas.');
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

  // ── Le TOUR de proposition (fil agent-natif) ────────────────────────────
  // Le corps déployé d'une proposition (l'atelier : onglets réseau, papier,
  // copier, autre angle, publié ?). Extrait pour être PARTAGÉ entre la carte de
  // tour (mkwPropCard) et la pastille de suggestion en tête de fil
  // (mkwHeroSuggest). Tout le câblage d'origine est identique (handlers, ids).
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
      ? `<div class="mkw-paper mkw-shimmer"><p class="mkw-quiet">je l'adapte pour ${BR_NETWORK_LABELS[current] || current}…</p></div>`
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
        ${angleOpen ? `<div class="mkw-angle"><input id="brAngle-${esc(p.key)}" class="mkw-input" placeholder="précise l'angle (optionnel) : « spécial ados », « plus court »…"><button type="button" class="mkw-link" onclick="mkBrRegen('${escJs(p.key)}')" ${mkBrief.busy === `regen:${p.key}` ? 'disabled' : ''}>${mkBrief.busy === `regen:${p.key}` ? 'je réécris…' : 'Refaire'}</button></div>` : ''}
        ${askPublished ? `<div class="mkw-published-ask" role="status">Publié ? <button type="button" class="mkw-link" onclick="mkBrPublished('${escJs(p.key)}', true)">Oui</button><button type="button" class="mkw-link mkw-link-faint" onclick="mkBrPublished('${escJs(p.key)}', false)">Pas encore</button></div>` : ''}`;
    return `<div class="mkw-prop-body">${netTabs}${paper}${under}${footer}</div>`;
  }

  // La proposition NAÎT comme un message de l'agent : avatar + bulle (sa voix,
  // première personne) + sa base honnête (le déclencheur : jour calme,
  // événement, chaleur…) + actions inline [Voir] [Ignorer]. Ouverte, elle
  // déploie l'atelier (onglets réseau, papier, copier, autre angle, publié ?).
  // Tout le câblage d'origine est PRÉSERVÉ à l'identique (handlers, ids, état).
  function mkwPropCard(p) {
    const published = mkBrief.published[p.key];
    if (published) {
      return `<article class="mkw-turn mkw-turn-prop is-published" data-br-card="${esc(p.key)}">
        <span class="mkw-turn-avatar" aria-hidden="true">${mkwAgentMark()}</span>
        <div class="mkw-turn-body"><p class="mkw-prop-published">${ci('check')}C'est publié : je mesure pendant 14 jours, le reçu arrive dans Résultats.</p></div>
      </article>`;
    }
    const open = mkBrief.openCard === p.key;
    const tone = BR_TRIGGER_TONE[p.trigger] || 'accent';
    const dueLabel = p.dueDate ? (p.dueDate === (mkBrief.data && mkBrief.data.today) ? 'aujourd\'hui' : `avant ${brFrDay(p.dueDate)}`) : '';
    // Une « offre »/récolte est un rappel terrain (checklist), pas une
    // publication : ni « à publier », ni onglets réseau, ni mesure J+14.
    const isOffre = p.kind === 'offre';
    // La carte quotidienne se nomme : « le post du jour » est SA nature (il se
    // renouvelle chaque matin), pas une urgence qui crie tous les jours.
    const when = p.pinned ? 'le post du jour' : (dueLabel ? `${isOffre ? 'à faire' : 'à publier'} ${dueLabel}` : '');
    // La base honnête du message = le déclencheur réel (le backend n'émet pas
    // de niveau de confiance par proposition : on montre le POURQUOI, pas un
    // score inventé). C'est l'indice de confiance de l'agent : sa raison.
    const reason = BR_TRIGGER_LABELS[p.trigger] || '';
    const verb = p.kind === 'email' ? 'Voir l\'email' : (isOffre ? 'Voir la checklist' : (p.trigger === 'concurrent' ? 'Voir la riposte' : 'Voir le post'));
    const body = open ? mkwPropOpenBody(p) : '';
    const chips = [
      when ? `<span class="mkw-chip-inline">${esc(when)}</span>` : '',
      reason ? `<span class="mkw-chip-inline mkw-chip-reason">${esc(reason)}</span>` : '',
    ].join('');
    return `<article class="mkw-turn mkw-turn-prop tone-${tone} ${open ? 'is-open' : ''}" data-br-card="${esc(p.key)}">
      <span class="mkw-turn-avatar" aria-hidden="true">${mkwAgentMark()}</span>
      <div class="mkw-turn-body">
        <div class="mkw-bubble">
          <p class="mkw-prop-why">${brProse(p.whyShort || p.why)}</p>
          ${chips ? `<p class="mkw-prop-meta">${chips}</p>` : ''}
        </div>
        ${open ? '' : `<div class="mkw-cta">
          <button type="button" class="pv2-btn primary" onclick="mkBrOpenCard('${escJs(p.key)}')">${verb}</button>
          <button type="button" class="mkw-link mkw-link-faint" onclick="mkBrDismiss('${escJs(p.key)}')">Ignorer</button>
        </div>`}
        ${body}
      </div>
    </article>`;
  }

  // NB (refonte agent-natif) : ex-mkwQueue (la file « Prêt pour toi » + la
  // command bar) est dissoute. Les propositions sont désormais des tours du fil
  // (mkwPropCard, appelé par mkwFeed) et la command bar est le composer sticky
  // (mkwComposer). Mêmes chips, mêmes ids (#mkwAsk/#brAskInput), mêmes handlers.

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
  window.mkBrMore = function () {
    mkBrief.moreOpen = true;
    renderStaffCampaignsPage();
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
      toast('Copie auto impossible : sélectionne le texte à la main.');
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

  // Le focus n'appelle JAMAIS le render (audit 4.1 : la boucle focus →
  // innerHTML → input détruit → refocus rendait la barre inutilisable). Il ne
  // fait qu'une chose : poser le ring accent sur la command bar.
  window.mkBrAskFocus = function (on) {
    mkBrief.askFocus = Boolean(on);
    const wrap = document.getElementById('mkwAsk');
    if (wrap) wrap.classList.toggle('is-focused', mkBrief.askFocus);
  };
  window.mkBrChip = function (text) {
    mkBrief.askDraft = text;
    const input = document.getElementById('brAskInput');
    if (input) { input.value = text; input.focus(); }
  };
  // ── LE CHAT DE DEMANDE (fix client 2026-07-18) ────────────────────────────
  // « Demander » n'était qu'un rechargement silencieux : zéro animation, la
  // réponse perdue dans le fil. Désormais c'est un vrai échange : la question
  // devient une BULLE UTILISATEUR (à droite), un indicateur « je prépare ça… »
  // pulse dessous, la vue descend dessus, et la réponse (la proposition créée
  // par propositionCreate) remplace l'indicateur, animée. La logique métier
  // (POST propositionCreate + reload du brief) est INCHANGÉE : tout ceci est
  // un état d'UI autour.
  let mkwChatSeq = 0;
  // Délai UI minimal : le mock/serveur rapide répond en <100 ms, l'indicateur
  // doit rester perceptible (jamais prolongé sous reduced-motion).
  const MKW_THINK_MIN_MS = 900;

  function mkwChatScrollTo(id) {
    setTimeout(() => {
      const el = document.querySelector(`[data-chat-id="${CSS.escape(id)}"]`);
      if (el) el.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });
    }, 60);
  }

  // Le plancher d'attente s'applique AVANT de basculer le statut : un render
  // intermédiaire (le reload du brief) repeint le fil pendant l'attente, et
  // l'indicateur doit y survivre jusqu'au bout du plancher.
  async function mkwThinkFloor(started) {
    const remaining = MKW_THINK_MIN_MS - (Date.now() - started);
    if (remaining > 0 && !reducedMotion) await new Promise((resolve) => setTimeout(resolve, remaining));
  }

  // Rejouer une demande échouée : l'échange raté disparaît, la question
  // repart telle quelle (même chemin que l'envoi normal).
  window.mkBrAskRetry = function (id) {
    const index = mkBrief.chat.findIndex((entry) => entry.id === id);
    if (index === -1 || mkBrief.busy) return;
    const q = mkBrief.chat[index].q;
    mkBrief.chat.splice(index, 1);
    mkBrief.askDraft = q;
    const input = document.getElementById('brAskInput');
    if (input) input.value = q;
    window.mkBrAsk();
  };

  window.mkBrAsk = async function () {
    if (mkBrief.busy) return;
    const brief = ((document.getElementById('brAskInput') || {}).value || mkBrief.askDraft || '').trim();
    if (!brief) { toast('Dis-moi ce que tu veux, même en trois mots.'); return; }
    mkwChatSeq += 1;
    const entry = { id: `chat-${mkwChatSeq}`, q: brief, status: 'pending', error: '', propKey: '', fresh: true };
    mkBrief.chat.push(entry);
    mkBrief.busy = 'ask';
    mkBrief.askFocus = false;
    mkBrief.askDraft = '';
    renderStaffCampaignsPage();
    mkwChatScrollTo(entry.id);
    setTimeout(() => { entry.fresh = false; }, 900);
    const started = Date.now();
    const before = new Set(brVisiblePropositions().map((p) => p.key));
    try {
      await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'propositionCreate', brief, centerId: state.adminCenterId || 'libramont' }),
      });
      await loadMarketingBrief(true);
      // La réponse de l'agent = la proposition qui n'existait pas avant.
      const created = brVisiblePropositions().find((p) => !before.has(p.key));
      await mkwThinkFloor(started);
      entry.propKey = created ? created.key : '';
      entry.status = 'done';
    } catch (error) {
      await mkwThinkFloor(started);
      entry.status = 'error';
      entry.error = error.message || 'Je n\'ai pas réussi à préparer ta proposition : réessaie.';
      // Le texte tapé revient dans la barre : l'échec ne coûte pas la saisie.
      mkBrief.askDraft = entry.q;
    } finally {
      entry.fresh = true;
      setTimeout(() => { entry.fresh = false; }, 900);
      mkBrief.busy = '';
      scheduleCampaignsRender();
      // La réponse (ou l'erreur) reste dans la vue : on garde l'échange centré.
      mkwChatScrollTo(entry.id);
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
        <div class="empty-state-text">Choisis un réseau et je fabrique le pack complet : version longue, version courte, story, idée photo, prompt d’image IA et hashtags, écrits sur l’angle du jour.</div>
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
        ${block('Prompt d’image IA', 'aiImagePrompt', pack.aiImagePrompt, { mono: true, note: 'en anglais, pour ton générateur d’images' })}
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
    if (!b) return `<section class="mkw-card"><div class="mkw-skel"></div><div class="mkw-skel"></div></section>`;
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
    if (!name.trim()) { toast('Donne au moins le nom du concurrent.'); return; }
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
      if (typeof toast === 'function') toast('Écris d\'abord un objet ou un message.');
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
    if (mode === 'schedule' && !form.scheduledAt) { if (typeof toast === 'function') toast('Choisis la date et l\'heure d\'envoi.'); return; }
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
        ${pv2Camp.editingId ? '<div class="ms-form-note">Édition du brouillon : enregistre tes modifications, ou envoie-le directement.</div>' : ''}
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
        ${pv2Camp.error ? `<div class="pv2-empty"><strong>${esc(pv2Camp.error)}</strong><button type="button" class="pv2-btn" onclick="loadPv2Campaigns(true)">Réessayer</button></div>` : ''}
        ${form}
        ${list}
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

  // AGENT-NATIF (refonte 2026-07-18) : la landing n'est plus une grille de 5
  // onglets co-égaux, c'est la CONVERSATION de l'agent (feed). La profondeur
  // (plan, studio, concurrents, résultats) reste accessible mais SUBORDONNÉE :
  // un rail discret + des liens depuis le fil. `feed` est la maison.
  const MKW_TABS = [
    { key: 'feed', label: 'Conversation' },
    { key: 'plan', label: 'Le plan' },
    { key: 'studio', label: 'Studio' },
    { key: 'rivals', label: 'Concurrents' },
    { key: 'results', label: 'Résultats' },
  ];
  // Les entrées de profondeur du rail (tout sauf la maison conversation).
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
  function mkwHeader() {
    const b = mkBrief.data;
    const fresh = b ? `Brief du ${esc(new Date(b.generatedAt).toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' }))}.` : '';
    return `<header class="mkw-head">
      <p class="mkw-crumb">Marketing</p>
      <div class="mkw-head-id">
        <span class="mkw-head-mark">${mkwAgentMark()}</span>
        <div class="mkw-head-main">
          <div class="mkw-head-titlerow">
            <h1 class="mkw-head-title">Ton agent marketing</h1>
            <span class="mkw-head-badge"><span class="mkw-live" aria-hidden="true"></span>en veille</span>
          </div>
          <p class="mkw-head-desc">Je surveille ta météo, tes réservations et tes concurrents chaque matin, et je te prépare des posts prêts à publier. ${fresh} <button type="button" class="mkw-more-link" onclick="mkwAbout()" aria-expanded="${mkBrief.aboutOpen ? 'true' : 'false'}">En savoir plus</button></p>
          ${mkBrief.aboutOpen ? '<p class="mkw-head-about">Je travaille la nuit sur tes chiffres réels : je te propose, tu valides, rien ne part jamais tout seul. Chaque publication est ensuite mesurée pendant 14 jours, et le résultat arrive dans Résultats.</p>' : ''}
        </div>
      </div>
    </header>`;
  }
  window.mkwAbout = function () {
    mkBrief.aboutOpen = !mkBrief.aboutOpen;
    renderStaffCampaignsPage();
  };

  // Le RAIL secondaire : discret, subordonné à la conversation. À gauche, la
  // maison (« Conversation ») ; à droite, les 4 profondeurs en liens sobres.
  // Ce n'est plus une grille d'onglets co-égaux : la voix par défaut est le fil.
  function mkwRail() {
    const onFeed = mkBrief.tab === 'feed';
    return `<nav class="mkw-rail" aria-label="Marketing">
      <button type="button" class="mkw-rail-home ${onFeed ? 'active' : ''}" aria-current="${onFeed ? 'page' : 'false'}" onclick="mkwTab('feed')">
        ${mkwAgentMark()}<span>Conversation</span>
      </button>
      <span class="mkw-rail-sep" aria-hidden="true"></span>
      <div class="mkw-rail-depth">
        ${MKW_DEPTH.map((t) => `<button type="button" class="mkw-rail-link ${mkBrief.tab === t.key ? 'active' : ''}" aria-current="${mkBrief.tab === t.key ? 'page' : 'false'}" onclick="mkwTab('${t.key}')">${esc(t.label)}</button>`).join('')}
      </div>
    </nav>`;
  }

  // ── Résultats · le héros euros : SEUL exemplaire (audit §6.2). Libellés
  // exacts : des MESSAGES (relances, anniversaires, campagnes), pas des
  // publications ; des visites réellement honorées, pas de simples réservations
  // enregistrées ; reçu, pas vu. ──
  function mkwHero() {
    const b = mkBrief.data;
    // Meme garde que sur b : un brief sans bloc `paie` faisait planter p.young,
    // et l exception cassait la page Marketing entiere.
    if (!b || !b.paie) return `<section class="mkw-hero"><div class="mkw-skel mkw-skel-hero"></div><div class="mkw-skel mkw-skel-short"></div></section>`;
    const p = b.paie;
    const periods = [7, 30, 90].map((d) => `<button type="button" class="mkw-seg-btn ${mkBrief.period === d ? 'active' : ''}" onclick="mkBrPeriod(${d})">${d} j</button>`).join('');
    let fig;
    if (p.young) {
      fig = `<div class="mkw-hero-fig"><span class="mkw-hero-num is-quiet">-</span><span class="mkw-hero-cap">Encore trop tôt pour un chiffre honnête. Premier bilan le <strong>${esc(p.firstVerdictDate)}</strong>.</span></div>`;
    } else if (p.quietWindow) {
      fig = `<div class="mkw-hero-fig"><span class="mkw-hero-num is-quiet">0</span><span class="mkw-hero-cap">message envoyé sur les <strong>${p.days} derniers jours</strong>. Tes mesures passées restent plus bas.</span></div>`;
    } else if (p.euros > 0) {
      fig = `<div class="mkw-hero-fig"><span class="mkw-hero-num is-good">${money(p.euros)}</span><span class="mkw-hero-cap">de visites honorées liées à tes messages · <strong>${p.days} derniers jours</strong></span></div>`;
    } else {
      fig = `<div class="mkw-hero-fig"><span class="mkw-hero-num">${p.sent}</span><span class="mkw-hero-cap">messages partis : aucune visite honorée ne leur est encore liée sur ${p.days} j</span></div>`;
    }
    const chips = !p.young && !p.quietWindow ? `<div class="mkw-hero-chips">
      <span class="mkw-hchip"><b>${p.venues}</b> visites honorées</span>
      <span class="mkw-hchip-dot"></span>
      <span class="mkw-hchip"><b>${p.sent}</b> messages envoyés</span>
    </div>` : '';
    const detail = mkBrief.payOpen && !p.young ? mkwSources(p) : '';
    return `<section class="mkw-hero">
      <div class="mkw-hero-top">
        <span class="mkw-eyebrow">Ce que le marketing a rapporté</span>
        <div class="mkw-seg">${periods}</div>
      </div>
      ${fig}
      ${chips}
      ${!p.young ? `<button type="button" class="mkw-link" onclick="mkBrPayDetail()">${mkBrief.payOpen ? 'Masquer le détail' : 'D’où vient ce chiffre'}</button>` : ''}
      ${detail}
    </section>`;
  }

  function mkwSources(p) {
    const rows = (p.sources || []).map((s) => {
      const share = p.euros > 0 ? Math.round((s.revenue / p.euros) * 100) : 0;
      return `<div class="mkw-src"><span class="mkw-src-name">${esc(s.label)}</span><span class="mkw-src-bar"><span style="width:${Math.max(2, share)}%"></span></span><span class="mkw-src-val">${money(s.revenue)}<em>${share}%</em></span></div>`;
    }).join('');
    // Les clics avis Google viennent des emails post-visite (transactionnels,
    // hors sources marketing) : ils s'affichent avec leur vraie origine, pas
    // en chip du héros comme s'ils étaient du ROI de publication (audit 4.6).
    return `<div class="mkw-src-panel">
      ${rows || '<p class="mkw-quiet">Pas encore de visite honorée attribuée sur la période.</p>'}
      ${p.reviewClicks ? `<p class="mkw-src-extra"><b>${p.reviewClicks}</b> clics vers ta fiche Google (emails de suivi post-visite, hors chiffre ci-dessus)</p>` : ''}
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
      verdicts.push(mkwVerdict('Ton meilleur jour', `${cap(f.bestDay.label)}`, `${vs}${f.bestDay.avgVisitors} visiteurs en moyenne`, f.bestDay.confidence, 'calendar'));
    }
    if (f && f.worstDay) {
      const vs = f.worstDay.vsMedianPct === null ? 'la cible n°1 à remplir' : `${Math.abs(f.worstDay.vsMedianPct)}% de monde en moins qu’un jour normal, la cible n°1 à remplir`;
      verdicts.push(mkwVerdict('Ton jour le plus creux', `${cap(f.worstDay.label)}`, vs, f.worstDay.confidence, 'target', 'danger'));
    }
    if (f && f.bestMonth) {
      const why = (f.bestMonth.whyDrivers || []).join(', ');
      verdicts.push(mkwVerdict('Ton meilleur mois', cap(f.bestMonth.label), `${mkwSignedPct(f.bestMonth.vsAvgPct)} vs la moyenne${why ? `, pourquoi : ${why}` : ''}`, f.bestMonth.confidence || 'signal', 'flame'));
    }
    if (f && f.weather) {
      const w = f.weather;
      verdicts.push(mkwVerdict('Effet de la pluie', mkwSignedPct(w.rainEffectPct) || '-', `sur ta fréquentation, à jours comparables · ${w.sampleDays} j de recul`, w.confidence, 'droplet'));
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
      <div class="mkw-block-head"><h3>Ce que je sais de ton centre</h3><span class="mkw-block-sub">calculé sur tes propres journées, météo et congés déduits</span></div>
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
        <div class="mkw-block-head"><h3>Ce qui convertit chez toi</h3><span class="mkw-block-sub">appris sur tes propres mesures</span></div>
        <p class="mkw-quiet">Publie et laisse-moi mesurer : les patterns gagnants s’afficheront ici, avec leur effet net.</p>
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
      <div class="mkw-block-head"><h3>Ce qui convertit chez toi</h3><span class="mkw-block-sub">${sub}</span></div>
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
      return `<article class="mkw-riv">
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
    else if (mkComp.loading) listState = '<div class="mkw-skel"></div><div class="mkw-skel mkw-skel-short"></div>';
    else if (mkComp.error) listState = `<p class="mkw-quiet mkw-inline-error">${esc(mkComp.error)} <button type="button" class="mkw-link" onclick="loadCompetitors(true)">Réessayer</button></p>`;
    else listState = '<p class="mkw-quiet">Ajoute les centres qui te prennent des clients : j’inspecte leurs sites, leurs offres et leur note Google.</p>';
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
        <div class="mkw-block-head"><h3>Colle-moi un post concurrent</h3><span class="mkw-block-sub">je l’analyse, je te prépare la riposte, et je retiens leurs techniques</span></div>
        <label class="mkw-label" for="brCompPost">Le texte du post ou de l’offre</label>
        <textarea id="brCompPost" class="mkw-textarea" placeholder="Colle ici le texte d’un post ou d’une offre d’un concurrent que tu as vu (Facebook, Instagram, leur site…)" oninput="mkComp.postDraft = this.value">${esc(mkComp.postDraft || '')}</textarea>
        <div class="mkw-riv-analyze">
          <button type="button" class="pv2-btn primary" onclick="mkCompAnalyze()" ${mkComp.postBusy ? 'disabled' : ''}>${mkComp.postBusy ? 'j’analyse…' : 'Analyser'}</button>
          <span class="mkw-quiet-inline">Tu colles ce que tu regardes déjà : je le transforme en angle.</span>
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
          <span class="mkw-analy-foot">Elles nourrissent mes prochains posts pour toi.</span>
        </div></div>`
      : '';
    // La riposte n'est plus un cul-de-sac : elle part au Studio en un clic.
    const counter = r.riposte
      ? `<div class="mkw-analy-counter">${ci('bolt')}<div>
          <span class="mkw-analy-label">Ta riposte</span><span class="mkw-analy-val">${esc(r.riposte)}</span>
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
    if (text.trim().length < 15) { toast('Colle le texte du post : au moins une phrase.'); return; }
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
    const today = (mkBrief.data && mkBrief.data.today) || new Date().toISOString().slice(0, 10);
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
      <header class="mkw-plan-week-head">
        <span class="mkw-plan-when"><strong>S${Number(week.index) || 0}</strong><small>dès le ${esc(jour)}</small>${stateLabel ? `<span class="mkw-plan-state">${stateLabel}</span>` : ''}</span>
        <span class="mkw-plan-conf">${esc(conf.label)}</span>
      </header>
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
        <div class="mkw-skel"></div><div class="mkw-skel"></div><div class="mkw-skel mkw-skel-short"></div>
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
        <div class="empty-state-text">Il se construit tout seul chaque lundi. Tu peux aussi le lancer maintenant et me regarder travailler.</div>
        <button type="button" class="pv2-btn primary" onclick="mkPlanBuild()">Construire le plan</button>
      </div></section>`;
    }
    const dated = weeks.filter((w) => w.confiance !== 'routine').length;
    // L'honnêteté en tête de surface : tant qu'on n'a rien mesuré, on le dit.
    // C'est ce qui empêche le gérant de croire que le plan sait ce qui marche.
    const evidence = plan.context && plan.context.hasMeasuredEvidence
      ? `Le plan s’appuie sur ce qu’on a mesuré chez toi.`
      : `Je n’ai pas encore assez de recul pour dire ce qui marche <strong>chez toi</strong>. Ce plan s’appuie sur les dates certaines : congés scolaires, jours fériés, événements près du centre.`;
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

  /* ── LE FIL DE L'AGENT (surface primaire, refonte agent-natif 2026-07-18) ──
     L'IA est le cœur de l'écran : elle parle, en première personne, et fait
     remonter ce qui compte AUJOURD'HUI sous forme de tours de conversation, le
     plus important d'abord. Les cartes (proposition, radar, veille, résultat)
     NAISSENT dans le fil : plus d'onglets plats co-égaux. Le composer
     « Demande-moi » est toujours au bas de la toile. Tout le câblage
     (mkBrief/mkComp, handlers valider/ignorer/variante/publier/analyser/
     demander) est PRÉSERVÉ : c'est une ré-architecture de PRÉSENTATION. */

  // Un tour générique de l'agent : avatar + bulle (sa voix) + carte inline
  // optionnelle. `text` est du HTML DÉJÀ SÛR (le caller échappe via esc/brProse).
  function mkwTurn(opts) {
    const o = opts || {};
    return `<article class="mkw-turn ${o.cls || ''}">
      <span class="mkw-turn-avatar" aria-hidden="true">${mkwAgentMark()}</span>
      <div class="mkw-turn-body">
        <div class="mkw-bubble"><p class="mkw-turn-text">${o.text || ''}</p></div>
        ${o.card || ''}
      </div>
    </article>`;
  }

  // Le tour d'accueil : la voix signée du matin (ex-mémo), + le compteur
  // honnête de propositions prêtes plus bas.
  function mkwGreeting() {
    const b = mkBrief.data;
    // `!b.brief` autant que `!b` : une reponse presente mais sans brief (agent
    // degrade, payload partiel) faisait planter le rendu sur b.brief.degraded,
    // et une exception ici casse TOUTE la page Marketing, pas juste ce bloc.
    if (!b || !b.brief) {
      return `<article class="mkw-turn mkw-turn-greeting">
        <span class="mkw-turn-avatar" aria-hidden="true">${mkwAgentMark()}</span>
        <div class="mkw-turn-body"><div class="mkw-bubble"><div class="mkw-skel"></div><div class="mkw-skel mkw-skel-short"></div></div></div>
      </article>`;
    }
    const date = esc(new Date(b.generatedAt).toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' }));
    const ready = brVisiblePropositions().length;
    return `<article class="mkw-turn mkw-turn-greeting">
      <span class="mkw-turn-avatar" aria-hidden="true">${mkwAgentMark()}</span>
      <div class="mkw-turn-body">
        <div class="mkw-bubble">
          ${b.brief.degraded ? '<p class="mkw-degraded">Je tourne en mode simple ce matin : les chiffres sont exacts, les phrases moins polies.</p>' : ''}
          <p class="mkw-voice-text">${brProse(b.brief.text)}</p>
        </div>
        <p class="mkw-turn-time">brief du ${date}${ready ? ` · <span class="mkw-turn-tag">${ready} prêt${ready > 1 ? 's' : ''} pour toi, plus bas</span>` : ''}</p>
      </div>
    </article>`;
  }

  // ── LES TOURS D'AMBIANCE REPLIÉS (fix client 2026-07-18 : « trop d'info
  // d'un coup ») : radar, veille et résultats ne sont plus des blocs ouverts à
  // poids égal avec les propositions. Chacun devient une LIGNE-RÉSUMÉ compacte
  // et mutée, repliée par défaut, qui se déploie au tap. Toute l'info reste
  // accessible, elle n'est juste plus déversée. ──────────────────────────────

  window.mkwFoldToggle = function (key) {
    if (!(key in mkBrief.folds)) return;
    mkBrief.folds[key] = !mkBrief.folds[key];
    // L'entrée du corps ne s'anime qu'au VRAI dépliage : un re-render in-view
    // (clic sur une cellule du radar ouvert) ne rejoue rien.
    mkBrief._foldAnim = mkBrief.folds[key] ? key : '';
    if (mkBrief.folds[key]) setTimeout(() => { if (mkBrief._foldAnim === key) mkBrief._foldAnim = ''; }, 450);
    renderStaffCampaignsPage();
  };

  // `sum` est du HTML DÉJÀ SÛR (le caller échappe via esc/brProse).
  function mkwFoldTurn(key, cls, ico, label, sum, body) {
    const open = mkBrief.folds[key];
    return `<section class="mkw-ambient ${cls} ${open ? 'is-open' : ''}">
      <button type="button" class="mkw-fold" aria-expanded="${open}" onclick="mkwFoldToggle('${key}')">
        <span class="mkw-fold-ico" aria-hidden="true">${ci(ico)}</span>
        <span class="mkw-fold-label">${esc(label)}</span>
        <span class="mkw-fold-sum">${sum}</span>
        <span class="mkw-fold-chev" aria-hidden="true">${ci('chevronDown')}</span>
      </button>
      ${open ? `<div class="mkw-fold-body ${mkBrief._foldAnim === key ? 'is-entering' : ''}">${body}</div>` : ''}
    </section>`;
  }

  // Le radar 14 jours : replié en « prochain jour calme : ven 17/07 » ;
  // déplié, la grille complète (mêmes cellules, mêmes handlers).
  function mkwRadarTurn() {
    const b = mkBrief.data;
    if (!b || !b.radar || !b.radar.length) return '';
    const creux = b.radar.find((d) => (d.level === 'creux' || d.level === 'calme') && d.date >= (b.today || ''));
    const sum = creux
      ? brProse(`prochain jour calme : ${brFrDay(creux.date)}`)
      : 'rien d\'urgent à remplir sur 14 jours';
    return mkwFoldTurn('radar', 'mkw-turn-radar', 'calendar', 'Radar 14 jours', sum,
      `<div class="mkw-inline-card mkw-inline-radar">${mkwRadar()}</div>`);
  }

  // La veille : repliée en « du mouvement chez X » ; dépliée, le détail + tous.
  function mkwVeilleTurn() {
    const b = mkBrief.data;
    if (!b || !b.veille || !b.veille.changed || !b.veille.changed.length) return '';
    const first = b.veille.changed[0];
    const others = b.veille.changed.length - 1;
    const sum = `du mouvement chez <strong>${esc(first.name)}</strong>${others > 0 ? ` et ${others} autre${others > 1 ? 's' : ''}` : ''}`;
    return mkwFoldTurn('veille', 'mkw-turn-veille', 'bolt', 'Veille concurrents', sum,
      `<div class="mkw-inline-card">
        <p class="mkw-inline-lead">${ci('bolt')}<span>${esc(first.name)}</span></p>
        <p class="mkw-inline-sub">${esc(first.diff)}</p>
        <div class="mkw-cta"><button type="button" class="mkw-link" onclick="mkwTab('rivals')">Voir tous les concurrents</button></div>
      </div>`);
  }

  // Les résultats : repliés en un chiffre honnête ; dépliés, la figure + le
  // pont vers la maison de la preuve (Résultats).
  function mkwResultsTurn() {
    const b = mkBrief.data;
    if (!b || !b.paie) return '';
    const p = b.paie;
    let sum;
    let fig = '';
    if (p.young) {
      sum = `premier bilan le <strong>${esc(p.firstVerdictDate)}</strong>`;
    } else if (p.quietWindow) {
      sum = brProse(`rien envoyé sur les ${p.days} derniers jours`);
    } else if (p.euros > 0) {
      sum = brProse(`${money(p.euros)} de visites honorées · ${p.days} j`);
      fig = `<div class="mkw-inline-fig">
        <span class="mkw-inline-num">${money(p.euros)}</span>
        <div class="mkw-inline-chips"><span><b>${p.venues}</b> visites honorées</span><span class="mkw-hchip-dot"></span><span><b>${p.sent}</b> messages envoyés</span></div>
      </div>`;
    } else {
      sum = brProse(`${p.sent} messages partis, rien d'encore lié sur ${p.days} j`);
    }
    return mkwFoldTurn('results', 'mkw-turn-results', 'target', 'Résultats', sum,
      `<div class="mkw-inline-card">${fig}
        <div class="mkw-cta"><button type="button" class="mkw-link" onclick="mkwTab('results')">Voir le détail des résultats</button></div>
      </div>`);
  }

  // ── LES TOURS DU CHAT : l'échange né du composer (bulle utilisateur à
  // droite, réponse de l'agent dessous). La réponse « done » est la VRAIE
  // carte proposition (mkwPropCard : mêmes handlers, même atelier). ──────────
  function mkwChatAnswer(entry) {
    if (entry.status === 'pending') {
      return `<article class="mkw-turn mkw-turn-thinking" role="status">
        <span class="mkw-turn-avatar" aria-hidden="true">${mkwAgentMark()}</span>
        <div class="mkw-turn-body"><div class="mkw-bubble">
          <p class="mkw-thinking"><span class="mkw-think-dots" aria-hidden="true"><i></i><i></i><i></i></span><span>je prépare ça…</span></p>
        </div></div>
      </article>`;
    }
    if (entry.status === 'error') {
      return `<article class="mkw-turn mkw-turn-chat-error" role="alert">
        <span class="mkw-turn-avatar" aria-hidden="true">${mkwAgentMark()}</span>
        <div class="mkw-turn-body"><div class="mkw-bubble">
          <p class="mkw-turn-text mkw-chat-error-text">${esc(entry.error)}</p>
          <p class="mkw-turn-text mkw-chat-error-sub">Ta demande est revenue dans la barre, elle n'est pas perdue.</p>
          <div class="mkw-cta"><button type="button" class="mkw-link" onclick="mkBrAskRetry('${escJs(entry.id)}')">Réessayer</button></div>
        </div></div>
      </article>`;
    }
    const p = entry.propKey ? brVisiblePropositions().find((item) => item.key === entry.propKey) : null;
    if (p) return mkwPropCard(p);
    if (entry.propKey && mkBrief.dismissed[entry.propKey]) {
      return mkwTurn({ cls: 'mkw-turn-quiet', text: 'Tu as écarté cette proposition : je n\'insiste pas.' });
    }
    return mkwTurn({ text: 'C\'est prêt : ta proposition est dans le fil, avec les autres du jour.' });
  }

  function mkwChatTurns() {
    return mkBrief.chat.map((entry) => `<div class="mkw-exchange ${entry.fresh ? 'is-fresh' : ''}" data-chat-id="${esc(entry.id)}">
      <article class="mkw-turn mkw-turn-user">
        <div class="mkw-turn-body">
          <div class="mkw-bubble mkw-bubble-user"><p class="mkw-turn-text">${esc(entry.q)}</p></div>
          <p class="mkw-turn-time mkw-turn-time-user">toi</p>
        </div>
      </article>
      <div class="mkw-chat-reply">${mkwChatAnswer(entry)}</div>
    </div>`).join('');
  }

  // Le COMPOSER « Demande-moi quelque chose » : signature du produit, toujours
  // au bas de la toile (sticky). Input XL, flèche circulaire, halo au focus,
  // chips toujours visibles, Enter pour envoyer. Ids/handlers d'origine intacts
  // (mkBrChip/mkBrAskFocus/mkBrAsk) : le focus ne re-rend JAMAIS la page.
  function mkwComposer() {
    const b = mkBrief.data;
    const creating = mkBrief.busy === 'ask';
    const chips = [];
    for (const day of ((b && b.radar) || [])) {
      if (chips.length >= 2) break;
      if ((day.level === 'creux' || day.level === 'calme') && !day.propositionKey) chips.push({ label: `Remplir ${brFrDay(day.date).split(' ')[0]} ${day.date.slice(8, 10)}`, text: `un post pour remplir ${brFrDay(day.date)}` });
      else if (day.precipMm !== null && day.precipMm >= 10) chips.push({ label: `Profiter de la pluie de ${brFrDay(day.date).split(' ')[0]}`, text: `un post sur la pluie annoncée ${brFrDay(day.date)}` });
    }
    chips.push({ label: 'Idée libre', text: '' });
    return `<div class="mkw-composer">
      <div class="mkw-cmd ${mkBrief.askFocus ? 'is-focused' : ''}" id="mkwAsk">
        <div class="mkw-chips">${chips.map((chip, index) => `<button type="button" class="mkw-chip ${index === 0 ? 'mkw-chip-primary' : ''}" onclick="mkBrChip('${escJs(chip.text)}')">${esc(chip.label)}</button>`).join('')}</div>
        <div class="mkw-cmd-bar">
          <input id="brAskInput" class="mkw-cmd-input" value="${esc(mkBrief.askDraft || '')}"
            placeholder="Demande-moi quelque chose : « un post pour la soirée fluo de samedi »"
            aria-label="Demander une proposition à l'employé marketing"
            oninput="mkBrief.askDraft = this.value" onfocus="mkBrAskFocus(true)" onblur="mkBrAskFocus(false)"
            onkeydown="if (event.key === 'Enter') mkBrAsk()">
          <button type="button" class="mkw-cmd-send" onclick="mkBrAsk()" ${creating ? 'disabled' : ''} aria-label="${creating ? 'Je prépare ta proposition' : 'Demander'}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>
          </button>
        </div>
        <p class="mkw-cmd-note">Il propose, tu valides : rien ne part jamais tout seul.</p>
      </div>
    </div>`;
  }

  // Petit chevron dans un cercle (signature « suggestion » du look Agent Vercel).
  const MKW_GO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>`;

  // LA PASTILLE DE SUGGESTION (élément-clé du look) : barre pleine largeur,
  // arrondie, LISERÉ ANIMÉ (sheen qui balaye le bord), texte à gauche, chevron
  // dans un cercle à droite. Elle met en avant LA chose la plus importante du
  // jour (la proposition en tête). Ouverte, elle déploie le même atelier que la
  // carte de tour (mkwPropOpenBody) : câblage identique.
  function mkwHeroSuggest(p) {
    // La proposition en tête peut être publiée depuis sa propre pastille : on
    // montre alors l'état compact « c'est publié » (la mesure J+14 démarre),
    // comme la carte de tour (mkwPropCard).
    if (mkBrief.published[p.key]) {
      return `<div class="mkw-suggest-wrap is-published" data-br-card="${esc(p.key)}">
        <p class="mkw-prop-published">${ci('check')}C'est publié : je mesure pendant 14 jours, le reçu arrive dans Résultats.</p>
      </div>`;
    }
    const open = mkBrief.openCard === p.key;
    const tone = BR_TRIGGER_TONE[p.trigger] || 'accent';
    return `<div class="mkw-suggest-wrap tone-${tone} ${open ? 'is-open' : ''}" data-br-card="${esc(p.key)}">
      <button type="button" class="mkw-suggest" onclick="mkBrOpenCard('${escJs(p.key)}')" aria-expanded="${open}">
        <span class="mkw-suggest-mark">${mkwAgentMark()}</span>
        <span class="mkw-suggest-text">${brProse(p.whyShort || p.why)}</span>
        <span class="mkw-suggest-go" aria-hidden="true">${MKW_GO}</span>
      </button>
      ${open ? mkwPropOpenBody(p) : ''}
    </div>`;
  }

  // Repli quand aucune proposition n'est prête mais qu'un jour calme réclame un
  // post : la pastille propose de le préparer (action réelle, mkBrRadarFill).
  function mkwFillSuggest(day) {
    const busy = mkBrief.busy === `fill:${day.date}`;
    return `<div class="mkw-suggest-wrap tone-danger">
      <button type="button" class="mkw-suggest" onclick="mkBrRadarFill('${escJs(day.date)}')" ${busy ? 'disabled' : ''} aria-label="Préparer un post pour remplir ce jour">
        <span class="mkw-suggest-mark">${mkwAgentMark()}</span>
        <span class="mkw-suggest-text">${brProse(`${cap(brFrDay(day.date))} est ton prochain jour calme. Je peux te préparer un post pour le remplir.`)}</span>
        <span class="mkw-suggest-go" aria-hidden="true">${busy ? '' : MKW_GO}</span>
      </button>
    </div>`;
  }

  // La toile conversationnelle : la landing par défaut du marketing.
  function mkwFeed() {
    const b = mkBrief.data;
    if (!b && mkBrief.error) {
      return `<div class="mkw-feed" id="mkwFeed">${mkwErrorPanel(mkBrief.error, 'loadMarketingBrief(true)')}</div>`;
    }
    const turns = [mkwGreeting()];
    if (!b) {
      // Chargement : des tours squelette, jamais l'état vide (honnêteté).
      turns.push(`<div class="mkw-suggest-wrap"><div class="mkw-suggest"><span class="mkw-suggest-mark">${mkwAgentMark()}</span><span class="mkw-suggest-text"><span class="mkw-skel mkw-skel-short"></span></span></div></div>`);
      turns.push(`<article class="mkw-turn"><span class="mkw-turn-avatar" aria-hidden="true">${mkwAgentMark()}</span><div class="mkw-turn-body"><div class="mkw-bubble"><div class="mkw-skel"></div></div></div></article>`);
      return `<div class="mkw-feed" id="mkwFeed">${turns.join('')}</div>${mkwComposer()}`;
    }
    const props = brVisiblePropositions();
    // Une proposition déjà « réponse » d'un échange du chat vit DANS son
    // échange (plus bas) : on ne la redouble pas dans les tours du jour.
    const claimed = new Set(mkBrief.chat.filter((entry) => entry.propKey).map((entry) => entry.propKey));
    const dayProps = props.filter((p) => !claimed.has(p.key));
    // La chose la plus importante en TÊTE, en pastille de suggestion : la
    // proposition de tête, sinon un jour calme à remplir. Elle n'est PAS
    // redoublée en tour plus bas (une seule chose importante à la fois).
    const lead = dayProps.length ? dayProps[0] : null;
    const restProps = lead ? dayProps.slice(1) : dayProps;
    let suggest = '';
    if (lead) suggest = mkwHeroSuggest(lead);
    else {
      const fillDay = (b.radar || []).find((d) => (d.level === 'creux' || d.level === 'calme') && d.date >= (b.today || '') && !(d.propositionKey && props.some((p) => p.key === d.propositionKey)));
      if (fillDay) suggest = mkwFillSuggest(fillDay);
    }
    if (suggest) turns.push(suggest);
    // Le fil s'ouvre CALME : 2 tours de proposition au plus, le reste derrière
    // « + N de plus » (fix client 2026-07-18 : « trop d'info d'un coup »).
    const visible = mkBrief.moreOpen ? restProps : restProps.slice(0, 2);
    const rest = restProps.length - visible.length;
    if (visible.length) {
      for (const p of visible) turns.push(mkwPropCard(p));
      if (rest > 0) turns.push(`<div class="mkw-feed-more"><button type="button" class="mkw-link" onclick="mkBrMore()">+ ${rest} proposition${rest > 1 ? 's' : ''} de plus</button></div>`);
    } else if (!suggest && !mkBrief.chat.length) {
      turns.push(mkwTurn({ cls: 'mkw-turn-quiet', text: 'Rien d\'urgent à publier aujourd\'hui. Je surveille ta météo, tes réservations et tes concurrents : dès que je vois une occasion, elle apparaît ici.' }));
    }
    const radar = mkwRadarTurn(); if (radar) turns.push(radar);
    const veille = mkwVeilleTurn(); if (veille) turns.push(veille);
    turns.push(mkwResultsTurn());
    // Les échanges du chat vivent en BAS du fil, juste au-dessus du composer :
    // la question tombe là où l'utilisateur regarde, la réponse arrive dessous.
    const chat = mkwChatTurns();
    if (chat) turns.push(chat);
    return `<div class="mkw-feed" id="mkwFeed">${turns.join('')}</div>${mkwComposer()}`;
  }

  // Une vue de PROFONDEUR (plan, studio, concurrents, résultats) : subordonnée
  // au fil, ouverte DEPUIS la conversation, avec un retour explicite.
  function mkwDepth(html) {
    return `<div class="mkw-depth">
      <button type="button" class="mkw-back" onclick="mkwTab('feed')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>Retour à la conversation</button>
      ${html}
    </div>`;
  }

  function mkwSurface() {
    // Résultats et fil dépendent du brief central : s'il a échoué et que rien
    // n'est affichable, une erreur franche avec retry (jamais des squelettes à vie).
    const briefDown = !mkBrief.data && mkBrief.error;
    switch (mkBrief.tab) {
      case 'plan': return mkwDepth(mkwPlan());
      case 'studio': return mkwDepth(mkwStudio());
      case 'rivals': return mkwDepth(mkwRivals());
      case 'results': return mkwDepth(briefDown ? mkwErrorPanel(mkBrief.error, 'loadMarketingBrief(true)') : mkwResults());
      case 'feed':
      case 'today':
      default: return mkwFeed();
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

  function mkwDotsInit() {
    mkwDotsStop();
    const canvas = document.getElementById('mkwDots');
    mkwDots.canvas = canvas;
    if (!canvas || !mkwDotsSetup()) return;
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
    if (!mkBrief.data && !mkBrief.loading && !mkBrief.error) setTimeout(() => loadMarketingBrief(), 0);
    // Entrée en scène UNE fois : en changeant de vue, ou à l'arrivée de la
    // première donnée. Jamais sur un clic in-view (sinon tout le fil clignote).
    const gotFirstData = mkBrief.data && !mkBrief._seenData;
    if (mkBrief.data) mkBrief._seenData = true;
    const enter = !reducedMotion && (mkwPrevTab !== mkBrief.tab || gotFirstData);
    mkwPrevTab = mkBrief.tab;
    root.innerHTML = `<div class="pv2-shell mkw-shell">
      <canvas class="mkw-dots" id="mkwDots" aria-hidden="true"></canvas>
      ${mkwHeader()}
      ${mkwRail()}
      <div class="mkw-surface ${enter ? 'mkw-in' : ''}">${mkwSurface()}</div>
    </div>`;
    // La texture vivante : (re)démarrée sur le canvas fraîchement rendu
    // (l'ancienne boucle est coupée dans l'init : zéro doublon, zéro fuite).
    mkwDotsInit();
    // Mobile : le rail des profondeurs défile ; l'entrée active reste visible.
    const nav = root.querySelector('.mkw-rail-depth');
    const active = nav && nav.querySelector('.mkw-rail-link.active');
    if (nav && active && nav.scrollWidth > nav.clientWidth) {
      nav.scrollLeft = Math.max(0, active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2);
    }
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
     resetClientFormuleOverride. Le serveur force le centre de session : l'UI
     n'envoie JAMAIS de centerId. La modale vit dans document.body pour survivre
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

  async function pevLoad(force) {
    if (pricingEditor.loading || (pricingEditor.loaded && !force)) return;
    pricingEditor.loading = true;
    pricingEditor.error = '';
    try {
      const payload = await apiRequest(`${API_ENDPOINTS.ops || '/api/ops'}?action=clientCatalog`, { method: 'GET' });
      const list = payload && Array.isArray(payload.formulas) ? payload.formulas : [];
      pricingEditor.byId = new Map(list.map((f) => [String(f.id), f]));
      pricingEditor.activities = payload && Array.isArray(payload.activities) ? payload.activities : [];
      pricingEditor.loaded = true;
    } catch (error) {
      pricingEditor.error = (error && error.message) || 'Catalogue indisponible.';
    } finally {
      pricingEditor.loading = false;
      if (typeof isStaffPricingActive === 'function' && isStaffPricingActive()) renderStaffPricingPage();
    }
  }

  // Re-fetch + re-render : apres chaque ecriture, la ligne montre immediatement
  // la nouvelle valeur.
  function pevReload() {
    pricingEditor.loaded = false;
    pevLoad(true);
  }
  function pevEnsureLoaded() {
    if (!pricingEditor.loaded && !pricingEditor.loading && !pricingEditor.error) pevLoad(false);
  }

  function pevModalBody() {
    if (!pricingEditor.modal || !pricingEditor.draft) return '';
    const d = pricingEditor.draft;
    return `${pricingEditor.modalError ? `<div class="pev-modal-error" role="alert">${esc(pricingEditor.modalError)}</div>` : ''}
      <div class="field pev-field">
        <label for="pevName">Nom affiché</label>
        <input id="pevName" type="text" maxlength="${PEV_NAME_MAX}" value="${d.name == null ? '' : esc(d.name)}" data-autofocus oninput="pevSet('name', this.value)">
        <span class="field-hint">Laisse le nom du catalogue si tu ne veux pas le changer.</span>
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
        <span class="pev-toggle-label">Disponible à la réservation<small>Coupe l'offre pour ton centre sans la retirer du catalogue.</small></span>
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
        <div><h3 id="pevModalTitle">${esc(pevModalTitle())}</h3><p>Ajuste le tarif de cette formule pour ton centre. Le prix par personne va de 0 à 1000 EUR.</p></div>
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
      pricingEditor.modalError = 'Indique un prix par personne entre 0 et 1000 EUR.';
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
      body: JSON.stringify({ action: 'saveClientFormuleOverride', formuleId, patch }),
    }).then(() => {
      pevToast('Tarif mis à jour.');
      pevDismissModal();
      pevReload();
    }).catch((error) => {
      pricingEditor.saving = false;
      pricingEditor.modalError = (error && error.message) || 'Enregistrement refusé. Réessaie.';
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
      body: JSON.stringify({ action: 'resetClientFormuleOverride', formuleId }),
    }).then(() => {
      pevToast('Tarif réinitialisé.');
      pevDismissModal();
      pevReload();
    }).catch((error) => {
      pricingEditor.resetting = false;
      pricingEditor.modalError = (error && error.message) || 'Réinitialisation refusée. Réessaie.';
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
     CATALOGUE PARTAGE : editeur de STRUCTURE (permission settings.manage)
     Distinct de l'editeur "mon centre" (pev, prix/dispo/retrait par centre) :
     ici on edite le CATALOGUE lui-meme (formules, activites d'une formule),
     partage par TOUS les centres. Branche sur le CRUD backend deja deploye
     (createFormula / updateFormula / setFormulaSteps / deleteFormula). Aucune
     ecriture n'envoie de centerId : le serveur force le centre de session, et le
     catalogue est global. Meme mecanique modale que pev : etat hors DOM
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
  function cevStepRowHtml(step, index, activities, total) {
    const known = activities.some((a) => a.id === step.activityId);
    const options = activities.map((a) => `<option value="${escJs(a.id)}"${a.id === step.activityId ? ' selected' : ''}>${esc(a.name)}</option>`).join('');
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
        <label class="cev-step-field cev-step-duration"><span>Duree (min)</span>
          <input type="number" min="0" max="1440" step="5" data-cev-field="duration" data-cev-idx="${index}" value="${step.durationMinutes == null ? '' : esc(step.durationMinutes)}" placeholder="auto" oninput="cevStepSetDuration(${index}, this.value)">
        </label>
        <label class="cev-step-crit"><input type="checkbox" data-cev-field="critical" data-cev-idx="${index}" ${step.critical ? 'checked' : ''} onchange="cevStepToggleCritical(${index}, this.checked)"><span>Critique</span></label>
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
  window.cevOpenCreate = function () {
    if (!cevCanManage()) { pevToast('Edition du catalogue reservee a la direction.'); return; }
    catalogEditor.fields = { name: '', family: '', priceType: 'per_pax', priceValue: null, priceOld: null, minPax: 6, isBirthdayFormula: false, validDays: [], timeLimitMin: null, timeLimitMax: null };
    catalogEditor.steps = [{ activityId: '', count: 1, durationMinutes: null, label: null, critical: false, resourceType: null }];
    catalogEditor.error = '';
    catalogEditor.saving = false;
    catalogEditor.modal = { mode: 'create', formuleId: null };
    cevSyncModal();
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
    if (!String(f.name || '').trim()) { cevFail('Donne un nom a la formule.'); return; }
    if (f.priceValue == null || !Number.isFinite(Number(f.priceValue))) { cevFail('Indique un prix entre 0 et 1000 EUR.'); return; }
    const createSteps = cevCollectSteps();
    if (!createSteps.length) { cevFail('Ajoute au moins une activite (selectionne une activite dans la liste).'); return; }
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
    if (!stepList.length) { cevFail('Ajoute au moins une activite (selectionne une activite dans la liste).'); return; }
    cevSubmit({ action: 'setFormulaSteps', id, steps: stepList }, 'Activites de la formule mises a jour.');
  }

  function cevSaveFields() {
    const id = catalogEditor.modal && catalogEditor.modal.formuleId;
    if (!id) return;
    const f = catalogEditor.fields || {};
    if (!String(f.name || '').trim()) { cevFail('Le nom ne peut pas etre vide.'); return; }
    if (f.priceValue == null || !Number.isFinite(Number(f.priceValue))) { cevFail('Indique un prix entre 0 et 1000 EUR.'); return; }
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

  function cevSubmit(body, successMessage) {
    catalogEditor.saving = true;
    catalogEditor.error = '';
    cevRefreshFoot();
    apiRequest(`${API_ENDPOINTS.ops || '/api/ops'}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }).then(() => {
      pevToast(successMessage);
      cevDismiss();
      pevReload();
    }).catch((error) => {
      catalogEditor.saving = false;
      catalogEditor.error = (error && error.message) || 'Enregistrement refuse. Reessaie.';
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
    if (!window.confirm(`Supprimer la formule "${name}" du catalogue partage ? Elle disparait pour tous les centres.`)) return;
    apiRequest(`${API_ENDPOINTS.ops || '/api/ops'}`, {
      method: 'POST',
      body: JSON.stringify({ action: 'deleteFormula', id: String(formuleId) }),
    }).then(() => {
      pevToast('Formule retiree du catalogue.');
      pevReload();
    }).catch((error) => {
      pevToast((error && error.message) || 'Suppression refusee. Reessaie.');
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
    return 'Catalogue partage : cette modification change l\'offre pour TOUS les centres, pas seulement le tien.';
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
    return `<span class="pev-foot-note">Catalogue partage. Chaque enregistrement est trace au journal.</span>
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

  // ── Section "Catalogue partage" (rendue dans la page prices) ──────────────
  function cevCatalogSectionHtml() {
    const canManage = cevCanManage();
    const formulas = Array.from(pricingEditor.byId.values());
    const rows = formulas.map((entry) => {
      const source = entry.source === 'custom' ? '<span class="pv2-chip amber">Ajoutee</span>' : '<span class="pv2-chip">Socle</span>';
      const stepCount = Array.isArray(entry.steps) ? entry.steps.length : 0;
      const priceLabel = entry.priceType === 'per_lane' ? '/piste' : '/pers';
      const priceValue = entry.base && entry.base.priceValue != null ? entry.base.priceValue : null;
      const meta = `${esc(entry.family || 'Formule')} &middot; ${entry.minPax || 1}+ pers &middot; ${stepCount} activite${stepCount > 1 ? 's' : ''}`;
      const actNames = (Array.isArray(entry.steps) ? entry.steps : []).map((step) => {
        const act = (pricingEditor.activities || []).find((a) => a.id === step.activityId);
        return act ? act.name : step.activityId;
      }).filter(Boolean);
      const actSummary = actNames.length
        ? `${actNames.slice(0, 3).map((n) => esc(n)).join(', ')}${actNames.length > 3 ? '...' : ''}`
        : 'Aucune activite';
      const priceHtml = priceValue != null
        ? `<div class="cev-row-price">${money(priceValue)}<small>${esc(priceLabel)}</small></div>`
        : '';
      const actions = canManage ? `<div class="cev-row-actions">
          <button type="button" class="pv2-btn sm" data-cev-fields="${escJs(entry.id)}" onclick="cevOpenFields('${escJs(entry.id)}')">Structure</button>
          <button type="button" class="pv2-btn sm" data-cev-steps="${escJs(entry.id)}" onclick="cevOpenSteps('${escJs(entry.id)}')">Modifier les activites</button>
          <button type="button" class="pv2-btn sm cev-danger" data-cev-delete="${escJs(entry.id)}" onclick="cevDelete('${escJs(entry.id)}')">Supprimer</button>
        </div>` : '';
      return `<article class="cev-row" data-cev-formula="${escJs(entry.id)}">
        <div class="cev-row-main">
          <div class="cev-row-title"><strong>${esc(entry.name || 'Formule')}</strong>${source}</div>
          <span class="cev-row-meta">${meta}</span>
          <span class="cev-row-acts">${actSummary}</span>
        </div>
        ${priceHtml}
        ${actions}
      </article>`;
    }).join('');
    return `<section class="cev-catalog-block" id="cevCatalogBlock">
      <div class="cev-block-head">
        <div class="cev-block-copy">
          <div class="cev-block-title"><h2>Catalogue partage</h2><span class="pv2-chip amber">Tous les centres</span></div>
          <p>${canManage ? 'Structure des formules et de leurs activites, partagee par tous les centres du reseau. Modifier ici change l\'offre partout.' : 'Structure des formules, partagee par tous les centres. Lecture seule (edition reservee a la direction).'}</p>
        </div>
        ${canManage ? '<button type="button" class="pv2-btn primary" id="cevAddFormula" onclick="cevOpenCreate()">+ Ajouter une formule</button>' : ''}
      </div>
      <div class="cev-rows">${rows || '<div class="pv2-empty"><strong>Catalogue vide</strong>Ajoutez une premiere formule.</div>'}</div>
    </section>`;
  }

  window.renderStaffPricingPage = function () {
    const root = document.getElementById('staffPricingPage');
    if (!root) return;
    pevEnsureLoaded();
    const allRows = getPricingRows();
    const rows = getPricingRowsFiltered();
    const selected = getSelectedPricingRow(rows);
    if (selected && state.staffPricingSelectedId !== selected.id) state.staffPricingSelectedId = selected.id;
    const metrics = getPricingMetrics(allRows);
    const filter = state.staffPricingFilter || 'all';
    const countByType = (type) => allRows.filter((row) => row.type === type).length;

    const ranking = state.staffPricingSort || 'default';
    const cards = rows.map((row, index) => {
      const view = pevRowView(row);
      const badges = `${view.removed ? '<span class="pv2-chip red">retirée</span>' : ''}${view.personnalise ? '<span class="pv2-chip amber">personnalisé</span>' : ''}`;
      return `<article class="pv2-price-card ${selected && row.id === selected.id ? 'selected' : ''}${view.removed ? ' pev-removed' : ''}" onclick="pv2SelectPricing('${escJs(row.id)}')">
      <div class="pv2-price-head">
        <div>${ranking !== 'default' && index < 3 && (Number(row.count) || Number(row.revenue)) ? `<span class="pv2-rank">#${index + 1}</span>` : ''}<strong>${esc(view.title || 'Offre')}</strong><small>${esc(row.subtitle || '')}</small></div>
        <div class="pv2-price-amount">${money(view.price)}<small> ${esc(row.type === 'formula' ? '/pers' : row.type === 'bowling' ? '/piste' : '')}</small></div>
      </div>
      ${badges ? `<div class="pev-badges">${badges}</div>` : ''}
      <p class="pv2-price-desc">${esc(row.description || '')}</p>
      <div class="pv2-price-tags">${(row.tags || []).slice(0, 4).map((tag) => `<span class="pv2-chip">${esc(tag)}</span>`).join('')}</div>
      <div class="pv2-price-stats">
        <span><strong>${Number(row.count) || 0}</strong> résa</span>
        <span><strong>${Number(row.players) || 0}</strong> joueurs</span>
        <span><strong>${money(row.revenue)}</strong></span>
        <span><strong>${Number(row.count) ? money(Number(row.revenue || 0) / Number(row.count)) : '-'}</strong> panier</span>
      </div>
      ${view.editable ? `<div class="pev-card-foot"><button type="button" class="pv2-btn" data-pev-edit="${escJs(view.sourceId)}" onclick="event.stopPropagation();pevOpenEdit('${escJs(view.sourceId)}')">Modifier</button></div>` : ''}
    </article>`;
    }).join('');

    root.innerHTML = `<div class="pv2-shell">
      ${bar({
        crumb: 'Administration / Catalogue',
        title: 'Activités & tarifs',
        sub: 'Catalogue opérationnel, prix publics et contraintes réelles de réservation.',
        actions: `
          <label class="pv2-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="14" height="14"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg><input value="${esc(state.staffPricingQuery || '')}" placeholder="Formule, activité, condition…" oninput="setStaffPricingQuery(this.value)"></label>
          <button type="button" class="pv2-btn" onclick="copyStaffPricingSummary()">Copier</button>
          <button type="button" class="pv2-btn" onclick="exportStaffPricingCsv()">Exporter</button>
          <button type="button" class="pv2-btn primary" onclick="openStaffPricingBooking('${escJs(selected?.id || '')}')">+ Réservation</button>`,
      })}

      <section class="pv2-stats">
        ${stat({ label: 'Offres actives', count: metrics.activeOffers, foot: `${metrics.formulaRows} formules au catalogue` })}
        ${stat({ label: 'Réservations liées', count: metrics.reservations, foot: 'sur les données locales' })}
        ${stat({ label: 'Chiffre associé', value: money(metrics.revenue), foot: 'réservations non annulées' })}
        ${stat({ label: 'Plus demandé', value: metrics.topRow?.title || 'Aucun', foot: `${metrics.topRow?.count || 0} réservation(s)` })}
      </section>

      ${seg([
        { key: 'all', label: 'Tout', count: allRows.length, active: filter === 'all' },
        { key: 'bowling', label: 'Bowling', count: countByType('bowling'), active: filter === 'bowling' },
        { key: 'laser', label: 'Laser Game', count: countByType('laser'), active: filter === 'laser' },
        { key: 'formula', label: 'Anniversaires', count: countByType('formula'), active: filter === 'formula' },
      ], 'pv2PricingFilter')}

      <div class="pv2-quicksorts">
        <span>Classement</span>
        ${[['demand', 'Plus demandées'], ['revenue', 'Top chiffre'], ['players', 'Top joueurs'], ['basket', 'Panier moyen']]
          .map(([key, label]) => `<button type="button" class="pv2-chip-btn${ranking === key ? ' active' : ''}" onclick="setStaffPricingSort('${key}')">${label}</button>`).join('')}
        ${ranking !== 'default' ? '<button type="button" class="pv2-chip-btn" onclick="setStaffPricingSort(state.staffPricingSort)">Ordre catalogue</button>' : ''}
      </div>

      <div class="cev-scope-note">
        <span class="cev-scope-badge">Mon centre</span>
        <div class="cev-scope-copy">
          <strong>Reglages de mon centre</strong>
          <span>Prix, disponibilite et retrait pour CE centre uniquement. Cliquez sur Modifier sur une offre pour l ajuster.</span>
        </div>
      </div>

      <section class="pv2-catalog">${cards || '<div class="pv2-empty"><strong>Aucune offre</strong>Modifiez le filtre ou la recherche.</div>'}</section>

      ${cevCatalogSectionHtml()}
    </div>`;
    mount(root, 'pricing');
    pevSyncModal();
    cevSyncModal();
  };

  /* ==========================================================================
     GROUPES & ANNIVERSAIRES : chrome V2 (P1-6)
     Dernière page « Clients & marketing » restée en chrome V1 : on remplace le
     header utilitaire 4 lignes par la barre pv2 + stats, en gardant TOUT le
     moteur data existant (renderStaffGroupWorkspaceV2 d'app-main.js : demandes
     sur mesure, toolbar, table « Profils exploitables », agenda, relances).
     Les autres pages utilitaires (sessions, arrivées, users…) restent servies
     par le renderer legacy, qu'on délègue.
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

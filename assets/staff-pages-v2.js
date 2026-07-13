/* ============================================================================
   PINLANE V2 — rebuilt page renderers
   Overrides the legacy renderers for Réservations, Clients, Emails,
   Campagnes and Tarifs with from-scratch layouts, plus a global command
   palette (Ctrl/Cmd+K). Data, permissions and mutations keep flowing through
   the existing battle-tested collectors and actions from app-main.js — this
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
    root.querySelectorAll('.pv2-seg').forEach((seg) => {
      const active = seg.querySelector('button.active');
      if (!active) return;
      seg.style.setProperty('--pv2-pill-x', `${active.offsetLeft}px`);
      seg.style.setProperty('--pv2-pill-w', `${active.offsetWidth}px`);
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
     RÉSERVATIONS — occupancy cockpit: heatmap month + day flow
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
        <span class="pv2-cal-meta">${agg ? `<strong>${agg.count}</strong> résa · ${agg.pax}p` : '—'}</span>
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
     CLIENTS — CRM: table + profile
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
    return `<span class="crm-pill tone-${CRM_STATUS_TONE[row.statusClass] || 'muted'}"><span class="crm-dot"></span>${esc(row.status || '—')}</span>`;
  }

  // Barre de facettes multi-sélection DÉSÉLECTIONNABLES (remplace segments + tris
  // rapides collants). OR intra-famille, AND inter-familles. Défaut = rien = tout.
  function crmFacetBar(filteredCount, totalCount) {
    const filters = getStaffClientFilterState();
    const occasionChips = [...new Set(Object.values(typeof STAFF_OCCASION_LABELS !== 'undefined' ? STAFF_OCCASION_LABELS : {}))];
    const families = [
      { family: 'statut', label: 'Statut', chips: ['Fidèle', 'Actif', 'Nouveau', 'Inactif'] },
      { family: 'type', label: 'Type', chips: ['Groupe', 'Particulier', 'Entreprise', 'École'] },
      { family: 'occasion', label: 'Occasion', chips: occasionChips.length ? occasionChips : ['Anniversaire'] },
      { family: 'canal', label: 'Canal', chips: ['En ligne', 'Comptoir'] },
      { family: 'valeur', label: 'Valeur', chips: ['VIP', 'Gros paniers', 'Multi-visites'] },
      { family: 'relation', label: 'Relation', chips: ['Dormant', 'À relancer', 'Résa à venir', 'Nouveau ce mois', 'Annulations', 'Jamais contacté'] },
    ];
    const active = getStaffClientActiveFilterCount();
    const open = !!state.staffClientFiltersOpen;
    const groups = families.map((group) => `
      <div class="crm-facet-group">
        <span class="crm-facet-label">${esc(group.label)}</span>
        <div class="crm-facet-chips">${group.chips.map((chip) => {
          const on = (filters[group.family] || []).includes(chip);
          return `<button type="button" class="crm-chip${on ? ' is-on' : ''}" aria-pressed="${on}" onclick="toggleStaffClientFilter('${group.family}','${escJs(chip)}')">${esc(chip)}</button>`;
        }).join('')}</div>
      </div>`).join('');
    // Filtres actifs = chips retirables, visibles même panneau replié.
    const activeChips = families.flatMap((group) => (filters[group.family] || []).map((chip) =>
      `<button type="button" class="crm-active-chip" onclick="toggleStaffClientFilter('${group.family}','${escJs(chip)}')" title="Retirer ce filtre">${esc(chip)} <span aria-hidden="true">✕</span></button>`
    )).join('');
    const sortKeys = [
      ['lastDate', 'Récence'], ['spent', 'Dépense totale'], ['avgBasket', 'Panier moyen'], ['reservations', 'Visites'], ['players', 'Joueurs'],
      ['firstDate', 'Ancienneté'], ['frequencyPerMonth', 'Fréquence'], ['engagementScore', 'Engagement'], ['name', 'Nom'],
    ];
    const sortState = state.staffClientSort || { key: 'lastDate', dir: 'desc' };
    const sortOptions = sortKeys.map(([key, label]) => `<option value="${key}"${sortState.key === key ? ' selected' : ''}>${esc(label)}</option>`).join('');
    return `
      <section class="crm-controls">
        <div class="crm-controls-head">
          <div class="crm-counter"><strong>${filteredCount}</strong> / ${totalCount} clients</div>
          <div class="crm-controls-tools">
            <button type="button" class="crm-filter-toggle${open ? ' is-open' : ''}${active ? ' has-active' : ''}" onclick="toggleStaffClientFiltersPanel()" aria-expanded="${open}">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16M7 12h10M10 19h4"/></svg>
              Filtres${active ? ` <span class="crm-badge">${active}</span>` : ''}<span class="crm-chevron" aria-hidden="true">${open ? '▲' : '▾'}</span>
            </button>
            <div class="crm-sort-select">
              <span>Trier</span>
              <select onchange="setStaffClientSort(this.value)" aria-label="Trier par">${sortOptions}</select>
              <button type="button" class="crm-sort-dir" onclick="setStaffClientSort('${sortState.key}')" title="Croissant / décroissant" aria-label="Inverser l'ordre">${sortState.dir === 'asc' ? '↑' : '↓'}</button>
            </div>
            ${active ? `<button type="button" class="crm-clear" onclick="clearStaffClientFilters()">✕ Effacer</button>` : ''}
          </div>
        </div>
        ${active ? `<div class="crm-active-chips">${activeChips}</div>` : ''}
        ${open ? `<div class="crm-facets">${groups}</div>` : ''}
      </section>`;
  }

  function crmListRow(row, selected) {
    const tagsHtml = (row.tags || []).slice(1, 4).map((t) => `<span class="crm-tag">${esc(t)}</span>`).join('');
    const dormant = Number(row.daysSinceLast || 0) > 90;
    return `
      <tr class="${selected && row.id === selected.id ? 'is-selected' : ''}" tabindex="0" role="button" onclick="selectStaffClient('${escJs(row.id)}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();selectStaffClient('${escJs(row.id)}');}">
        <td class="crm-cell-client">
          <span class="crm-avatar tone-${esc(row.avatarTone || 'a')}">${esc(row.initials || '–')}</span>
          <span class="crm-client-id"><strong>${esc(row.name || 'Sans nom')}</strong><small>${esc(row.email || row.phone || '')}</small>${tagsHtml ? `<span class="crm-tags">${tagsHtml}</span>` : ''}</span>
        </td>
        <td>${crmStatusPill(row)}</td>
        <td class="num">${Number(row.reservations) || 0}</td>
        <td class="num col-secondary">${Number(row.players) || 0}</td>
        <td class="num crm-ltv"><strong>${money(row.spent)}</strong></td>
        <td class="num">${money(row.avgBasket)}</td>
        <td class="crm-cell-visit"><strong>${esc(row.lastVisitAgo || '—')}</strong><small>${esc(row.lastVisit || '')}</small>${dormant ? '<span class="crm-dot-warn" title="Sans visite depuis +90 j"></span>' : ''}</td>
      </tr>`;
  }

  function crmInsightLines(row, comms) {
    const lines = [];
    if (row.favoriteLabel) lines.push(['🎯', `Aime surtout : <strong>${esc(row.favoriteLabel)}</strong>`, 'accent']);
    if (row.avgPlayers) lines.push(['👥', `Vient en général à <strong>${Math.round(row.avgPlayers)}</strong> personne${Math.round(row.avgPlayers) > 1 ? 's' : ''}`, 'muted']);
    if ((row.occasions || []).length) lines.push(['📅', `Occasions : ${esc(row.occasions.map((o) => (typeof STAFF_OCCASION_LABELS !== 'undefined' && STAFF_OCCASION_LABELS[o]) || o).join(' · '))}`, 'muted']);
    if (row.preferredChannel) lines.push(['💻', `Réserve surtout <strong>${row.preferredChannel === 'Comptoir' ? 'au comptoir' : 'en ligne'}</strong>`, 'muted']);
    if (Number(row.daysSinceLast || 0) > 90) lines.push(['⚠️', `Sans visite depuis <strong>${row.daysSinceLast} j</strong> — à relancer`, 'warn']);
    if (row.hasBirthday) lines.push(['🎂', 'Client anniversaire', 'info']);
    if (Number(row.engagementScore || 0) >= 75) lines.push(['⭐', 'Parmi vos meilleurs clients', 'success']);
    if (comms && comms.length === 0) lines.push(['✉️', 'Jamais contacté — une relance à tenter', 'warn']);
    return lines.map(([icon, text, tone]) => `<div class="crm-insight tone-${tone}"><span>${icon}</span><span>${text}</span></div>`).join('');
  }

  function crmBar(label, value, tone) {
    return `<div class="crm-bar"><span class="crm-bar-label">${esc(label)}</span><span class="crm-bar-track"><span class="crm-bar-fill tone-${tone}" style="width:${Math.round(value)}%"></span></span><span class="crm-bar-val">${Math.round(value)}%</span></div>`;
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
          <span class="crm-hist-date">${esc(entry.date || '—')}</span>
          <span class="crm-hist-main"><strong>${esc(entry.label || 'Réservation')}</strong><small>${Number(r.pax) || 0} joueur${(Number(r.pax) || 0) > 1 ? 's' : ''}${acts.length ? ` · ${acts.join(' + ')}` : ''}</small></span>
          <span class="crm-hist-amount ${entry.amount < 0 ? 'is-neg' : ''}">${money(Math.abs(entry.amount))}</span>
          <span class="crm-pill tone-${r.status === 'paid' ? 'success' : cancelled ? 'warn' : 'muted'} crm-hist-status">${esc(entry.status)}</span>
        </summary>
        <div class="crm-hist-detail">
          <div><dt>Heure</dt><dd>${esc(r.startTime || '—')}${r.duration ? ` · ${crmNum(r.duration)}h` : ''}</dd></div>
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
      ? `<button type="button" class="crm-btn" onclick="composeStaffClientEmail('${escJs(selected.email)}','${escJs(selected.name || '')}')">✉️ Nouveau message</button>`
      : '<span class="crm-muted">Aucune adresse email</span>';
    if (comms === null) {
      const loading = staffClientCommsCache.loading;
      const failed = !!staffClientCommsCache.error;
      return `<div class="info-block crm-block"><div class="crm-block-head"><h3>Messages & relances</h3></div>
        <div class="crm-empty">${loading ? 'Chargement de l\'historique…' : failed ? 'Historique des messages indisponible pour ce rôle.' : 'Historique non chargé.'}${!loading ? ` ${compose}` : ''}</div></div>`;
    }
    if (!comms.length) {
      return `<div class="info-block crm-block"><div class="crm-block-head"><h3>Messages & relances</h3></div>
        <div class="crm-empty"><strong>Jamais contacté.</strong> Aucun message envoyé à ce client. ${compose}</div></div>`;
    }
    const sent = comms.filter((c) => ['sent', 'delivered'].includes(c.status)).length;
    const delivered = comms.filter((c) => c.status === 'delivered').length;
    const failedCount = comms.filter((c) => c.status === 'failed').length;
    const last = comms[0];
    const CHAN = { email: '✉️', sms: '💬', whatsapp: '📲', note: '📝' };
    const TONE = { sent: 'info', delivered: 'success', failed: 'warn', queued: 'info', draft: 'muted' };
    const items = comms.slice(0, 40).map((c) => `
      <div class="crm-comm dir-${esc(c.direction || 'outbound')}">
        <span class="crm-comm-icon">${CHAN[c.channel] || '✉️'}</span>
        <span class="crm-comm-main"><strong>${esc(c.subject || c.templateId || 'Message')}</strong><small>${esc(c.recipient || '')} · ${esc((typeof formatOpsTimestamp === 'function' && (c.sentAt || c.createdAt)) ? formatOpsTimestamp(c.sentAt || c.createdAt) : (c.sentAt || c.createdAt || ''))}${c.direction === 'inbound' ? ' · reçu' : ''}</small></span>
        <span class="crm-pill tone-${TONE[c.status] || 'muted'}">${esc(c.status || '')}</span>
        ${selected.email ? `<button type="button" class="crm-icon-btn" title="Renvoyer" onclick="composeStaffClientEmail('${escJs(selected.email)}','${escJs(selected.name || '')}')">↻</button>` : ''}
      </div>`).join('');
    return `<div class="info-block crm-block"><div class="crm-block-head"><h3>Messages & relances <span class="crm-count">${comms.length}</span></h3>${compose}</div>
      <div class="crm-comm-stats">${sent} envoyé${sent > 1 ? 's' : ''} · ${delivered} délivré${delivered > 1 ? 's' : ''} · ${failedCount} échec${failedCount > 1 ? 's' : ''}${last ? ` · dernier ${esc((typeof formatOpsTimestamp === 'function' && (last.sentAt || last.createdAt)) ? formatOpsTimestamp(last.sentAt || last.createdAt) : '')}` : ''}</div>
      <div class="crm-comm-list">${items}</div></div>`;
  }

  function crmFiche(selected) {
    if (!selected) return '<div class="crm-empty crm-empty-lg"><strong>Sélectionnez un client</strong>Cliquez sur une ligne pour voir sa fiche complète.</div>';
    ensureStaffClientComms();
    const comms = getStaffClientCommunications(selected);
    const badges = [];
    badges.push(crmStatusPill(selected));
    if (Number(selected.engagementScore || 0) >= 80) badges.push('<span class="crm-pill tone-accent">VIP</span>');
    if (selected.isGroup) badges.push('<span class="crm-pill tone-info">Groupe</span>');
    (selected.occasions || []).slice(0, 1).forEach((o) => badges.push(`<span class="crm-pill tone-muted">${esc((typeof STAFF_OCCASION_LABELS !== 'undefined' && STAFF_OCCASION_LABELS[o]) || o)}</span>`));
    const tenure = selected.tenureDays >= 365 ? `${Math.floor(selected.tenureDays / 365)} an${Math.floor(selected.tenureDays / 365) > 1 ? 's' : ''}` : `${selected.tenureDays} j`;
    const kpi = (label, value, sub) => `<div class="crm-kpi"><div class="crm-kpi-val">${value}</div><div class="crm-kpi-label">${esc(label)}</div>${sub ? `<div class="crm-kpi-sub">${esc(sub)}</div>` : ''}</div>`;
    const tb = selected.typeBreakdown || { bowling: 0, laser: 0, formule: 0 };
    const tbTotal = (tb.bowling + tb.laser + tb.formule) || 1;
    const next = selected.nextBooking;
    return `
      <div class="crm-fiche">
        <div class="info-block crm-block crm-head">
          <span class="crm-avatar crm-avatar-lg tone-${esc(selected.avatarTone || 'a')}">${esc(selected.initials || '–')}</span>
          <div class="crm-head-id">
            <h2>${esc(selected.name || 'Sans nom')}</h2>
            <div class="crm-head-contact">${selected.phone ? `📞 ${esc(selected.phone)}` : ''}${selected.phone && selected.email ? ' · ' : ''}${selected.email ? `✉️ ${esc(selected.email)}` : ''}</div>
            <div class="crm-head-badges">${badges.join('')}</div>
            <div class="crm-head-since">Client depuis ${esc(formatStaffClientDateText(selected.firstDate))} · ${esc(tenure)}</div>
          </div>
          <div class="crm-head-actions">
            <button type="button" class="crm-btn crm-btn-primary" onclick="openStaffClientBooking('${escJs(selected.id)}')">+ Réservation</button>
            ${selected.email ? `<button type="button" class="crm-btn" onclick="composeStaffClientEmail('${escJs(selected.email)}','${escJs(selected.name || '')}')">✉️ Message</button>` : ''}
          </div>
        </div>

        <div class="info-block crm-block">
          <div class="crm-block-head"><h3>Ce que vaut ce client</h3></div>
          <div class="crm-kpis">
            ${kpi('Dépensé (total)', money(selected.spent), selected.reservations ? `${crmNum(selected.avgBasket)} € / visite` : '')}
            ${kpi('Visites', Number(selected.reservations) || 0, `${crmNum(selected.frequencyPerMonth)} / mois`)}
            ${kpi('Joueurs accueillis', Number(selected.players) || 0, `ø ${Math.round(selected.avgPlayers || 0)} / résa`)}
            ${kpi('Engagement', `${selected.engagementScore || 0}/100`, selected.engagementScore >= 70 ? 'à choyer' : selected.engagementScore >= 40 ? 'à suivre' : 'à réveiller')}
            ${kpi('Annulations', Number(selected.cancellations) || 0, `${crmPct(selected.cancelRate)} des résas`)}
            ${kpi('Intervalle', selected.avgIntervalDays ? `${selected.avgIntervalDays} j` : '—', 'entre visites')}
          </div>
        </div>

        <div class="info-block crm-block">
          <div class="crm-block-head"><h3>En un coup d'œil</h3></div>
          <div class="crm-insights">${crmInsightLines(selected, comms) || '<div class="crm-muted">Pas encore assez d\'historique.</div>'}</div>
        </div>

        ${next ? `<div class="info-block crm-block crm-next">
          <div class="crm-block-head"><h3>Prochaine réservation</h3></div>
          <div class="crm-next-body"><strong>${esc(formatStaffClientDateText(next.date))} · ${esc(next.startTime || '')}</strong><span>${esc(getStaffClientOfferLabel(next))} · ${Number(next.pax) || 0} joueurs</span></div>
        </div>` : ''}

        <div class="info-block crm-block">
          <div class="crm-block-head"><h3>Profil comportemental</h3></div>
          <div class="crm-bars">
            ${crmBar('Bowling', (tb.bowling / tbTotal) * 100, 'chart1')}
            ${crmBar('Laser', (tb.laser / tbTotal) * 100, 'chart2')}
            ${crmBar('Formule', (tb.formule / tbTotal) * 100, 'chart3')}
          </div>
          <div class="crm-kv-grid">
            ${selected.favoriteLabel ? `<div><dt>Activité préférée</dt><dd>${esc(selected.favoriteLabel)}</dd></div>` : ''}
            ${selected.preferredChannel ? `<div><dt>Canal préféré</dt><dd>${esc(selected.preferredChannel)}</dd></div>` : ''}
            ${selected.laserGamesTotal ? `<div><dt>Parties laser</dt><dd>${selected.laserGamesTotal}</dd></div>` : ''}
            ${selected.bowlingHoursTotal ? `<div><dt>Heures bowling</dt><dd>${crmNum(selected.bowlingHoursTotal)} h</dd></div>` : ''}
            ${selected.totalDurationBooked ? `<div><dt>Durée réservée</dt><dd>${crmNum(selected.totalDurationBooked)} h</dd></div>` : ''}
            ${selected.maxPax ? `<div><dt>Plus gros groupe</dt><dd>${selected.maxPax} joueurs</dd></div>` : ''}
            ${selected.paymentMethodDominant ? `<div><dt>Paiement habituel</dt><dd>${esc(selected.paymentMethodDominant)}</dd></div>` : ''}
            <div><dt>Part payée</dt><dd>${crmPct(selected.paidShare)}</dd></div>
            ${(selected.occasions || []).length ? `<div class="crm-kv-wide"><dt>Occasions</dt><dd>${selected.occasions.map((o) => `<span class="crm-chip-static">${esc((typeof STAFF_OCCASION_LABELS !== 'undefined' && STAFF_OCCASION_LABELS[o]) || o)}</span>`).join('')}</dd></div>` : ''}
          </div>
        </div>

        <div class="info-block crm-block">
          <div class="crm-block-head"><h3>Toutes ses réservations <span class="crm-count">${(selected.history || []).length}</span></h3></div>
          <div class="crm-block-sub">${Number(selected.players) || 0} joueurs cumulés · ${money(selected.spent)}</div>
          <div class="crm-history">${(selected.history || []).map(crmHistoryItem).join('') || '<div class="crm-muted">Aucune réservation.</div>'}</div>
        </div>

        ${crmCommsBlock(selected)}

        <div class="info-block crm-block crm-meta">
          ${selected.leadTimeAvgDays ? `<div><dt>Délai de réservation moyen</dt><dd>${selected.leadTimeAvgDays} j à l'avance</dd></div>` : ''}
          ${(selected.centers || []).length ? `<div><dt>Centre(s)</dt><dd>${esc(selected.centers.join(', '))}</dd></div>` : ''}
          ${selected.formulas ? `<div><dt>Formules réservées</dt><dd>${selected.formulas}</dd></div>` : ''}
          ${selected.notesConcat ? `<div class="crm-kv-wide"><dt>Notes staff</dt><dd>${esc(selected.notesConcat)}</dd></div>` : ''}
        </div>
      </div>`;
  }

  window.showMoreStaffClients = function () {
    state.staffClientListLimit = (Number(state.staffClientListLimit) || 40) + 40;
    renderStaffClientsPage();
  };

  window.renderStaffClientsPage = function () {
    const root = document.getElementById('staffClientsPage');
    if (!root) return;
    const allRows = getStaffClientRows();
    const rows = getFilteredStaffClientRows();
    const metrics = getStaffClientMetrics(allRows, getStaffClientSourceReservations());
    const selected = rows.find((r) => r.id === state.staffSelectedClientId)
      || allRows.find((r) => r.id === state.staffSelectedClientId)
      || rows[0] || allRows[0] || null;
    if (selected && state.staffSelectedClientId !== selected.id) state.staffSelectedClientId = selected.id;
    const sync = staffClientDataCache.loading ? 'Synchronisation…' : staffClientDataCache.loaded ? `Synchronisé ${formatOpsTimestamp(staffClientDataCache.syncedAt)}` : 'Données locales';
    const limit = Number(state.staffClientListLimit) || 40;
    const shown = rows.slice(0, limit);
    const sortState = state.staffClientSort || { key: 'lastDate', dir: 'desc' };
    const th = (key, label, num, secondary) => {
      const on = sortState.key === key;
      return `<th class="${num ? 'num ' : ''}${secondary ? 'col-secondary ' : ''}crm-th${on ? ' is-active' : ''}" aria-sort="${on ? (sortState.dir === 'asc' ? 'ascending' : 'descending') : 'none'}" onclick="setStaffClientSort('${key}')">${esc(label)} <span class="crm-sort">${on ? (sortState.dir === 'asc' ? '↑' : '↓') : '↕'}</span></th>`;
    };
    const tableRows = shown.map((row) => crmListRow(row, selected)).join('');

    root.innerHTML = `<div class="pv2-shell crm-shell">
      ${bar({
        crumb: 'Clients & Marketing / CRM',
        title: 'Clients',
        sub: esc(sync),
        actions: `
          <label class="pv2-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="14" height="14"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg><input value="${esc(state.staffClientQuery || '')}" placeholder="Rechercher un client…" oninput="setStaffClientQuery(this.value)"><kbd>Ctrl K</kbd></label>
          <button type="button" class="pv2-btn" onclick="refreshStaffClients()">Actualiser</button>
          <button type="button" class="pv2-btn" onclick="exportStaffClientsCsv()">Exporter</button>
          <button type="button" class="pv2-btn primary" onclick="openStaffClientBooking()">+ Nouveau client</button>`,
      })}

      <section class="pv2-stats">
        ${stat({ label: 'Total clients', count: metrics.totalClients, foot: `${metrics.reservations} réservations réelles`, series: metrics.series.clients })}
        ${stat({ label: 'Clients actifs', count: metrics.activeClients, foot: `${metrics.activeShare}% du total`, series: metrics.series.players })}
        ${stat({ label: 'Nouveaux ce mois', count: metrics.newThisMonth, foot: `${metrics.previousNew} le mois précédent` })}
        ${stat({ label: 'Panier moyen', value: money(pv2AvgBasket(allRows)), foot: 'par réservation' })}
      </section>

      ${crmFacetBar(rows.length, allRows.length)}

      <section class="pv2-split crm-split">
        <article class="pv2-panel crm-list-panel">
          <div class="crm-table-wrap">
            <table class="crm-table">
              <thead><tr>${th('name', 'Client') + th('status', 'Statut') + th('reservations', 'Visites', true) + th('players', 'Joueurs', true, true) + th('spent', 'Dépensé', true) + th('avgBasket', 'Panier moy.', true) + th('lastDate', 'Dernière visite')}</tr></thead>
              <tbody>${tableRows || `<tr><td colspan="7"><div class="crm-empty"><strong>Aucun client</strong>Aucun résultat pour ces filtres. <button type="button" class="crm-clear" onclick="clearStaffClientFilters()">Réinitialiser</button></div></td></tr>`}</tbody>
            </table>
          </div>
          <div class="crm-list-foot">
            <span>${shown.length} affiché${shown.length > 1 ? 's' : ''} sur ${rows.length}</span>
            ${rows.length > shown.length ? `<button type="button" class="crm-btn" onclick="showMoreStaffClients()">Afficher plus</button>` : ''}
          </div>
        </article>
        <article class="pv2-panel crm-fiche-panel">
          ${crmFiche(selected)}
        </article>
      </section>
    </div>`;
    mount(root, 'clients');
  };

  /* ==========================================================================
     EMAILS — communication pipeline
     ======================================================================== */

  window.pv2SelectEmail = function (uid) {
    state.staffEmailSelectedId = uid;
    save();
    renderStaffEmailsPage();
  };

  window.pv2EmailFilter = function (key) {
    state.staffEmailFilter = key;
    save();
    renderStaffEmailsPage();
  };

  window.renderStaffEmailsPage = function (errorMessage = '') {
    const root = document.getElementById('staffEmailsPage');
    if (!root) return;
    // C14 : ops-console.js est injecté à la demande — requestOpsAdminLoad
    // (app-main) charge le script puis déclenche loadOpsAdmin.
    if (!opsAdminCache.loaded && !opsAdminCache.loading) setTimeout(() => requestOpsAdminLoad(false), 0);
    const allRows = getStaffEmailRows();
    const rows = getStaffEmailRowsFiltered();
    const selected = getSelectedStaffEmailRow(rows);
    if (selected && state.staffEmailSelectedId !== selected.uid) state.staffEmailSelectedId = selected.uid;
    const metrics = getStaffEmailMetrics(allRows);
    const filter = state.staffEmailFilter || 'all';
    const updatedAt = opsAdminCache.lastLoadedAt ? formatOpsTimestamp(opsAdminCache.lastLoadedAt) : 'non chargé';

    const KIND_META = {
      queued: { label: 'En file', tone: 'blue' },
      sent: { label: 'Envoyé', tone: 'green' },
      failed: { label: 'Échec', tone: 'red' },
      draft: { label: 'Brouillon', tone: '' },
      cancelled: { label: 'Annulé', tone: '' },
    };

    const pipe = (key, label, value, hint) => `<div class="pv2-pipe ${filter === key ? 'active' : ''}" onclick="pv2EmailFilter('${key}')">
      <div class="pv2-pipe-label">${esc(label)}</div>
      <div class="pv2-pipe-value" ${PV2.lastPage !== 'emails' ? `data-pv2-count="${Number(value) || 0}"` : ''}>${Number(value) || 0}</div>
      <div class="pv2-pipe-hint">${esc(hint)}</div>
    </div>`;

    const tableRows = rows.slice(0, 80).map((row) => {
      const meta = KIND_META[row.statusKind] || KIND_META.draft;
      return `<tr class="${selected && row.uid === selected.uid ? 'selected' : ''}" onclick="pv2SelectEmail('${escJs(row.uid)}')">
        <td><strong>${esc(row.subject || row.templateLabel || 'Message')}</strong><small style="display:block;color:var(--v2-text-3);margin-top:1px">${esc(row.recipient || '—')}</small></td>
        <td><span class="pv2-chip">${esc(row.templateLabel || row.templateId || '—')}</span></td>
        <td><span class="pv2-chip ${meta.tone}">${meta.label}</span></td>
        <td class="num">${esc(formatOpsTimestamp(row.sentAt || row.scheduledAt || row.createdAt) || '—')}</td>
      </tr>`;
    }).join('');

    const payload = selected?.payload || {};
    const detail = selected ? `
      <div class="pv2-panel-body" style="display:grid;gap:13px">
        <div class="pv2-kv">
          <div><dt>Destinataire</dt><dd>${esc(selected.recipient || '—')}</dd></div>
          <div><dt>Modèle</dt><dd>${esc(selected.templateLabel || selected.templateId || '—')}</dd></div>
          <div><dt>Canal</dt><dd>${esc(selected.channel || 'email')}</dd></div>
          <div><dt>Statut</dt><dd>${esc((KIND_META[selected.statusKind] || {}).label || selected.status || '—')}</dd></div>
          <div><dt>Programmé</dt><dd>${esc(formatOpsTimestamp(selected.scheduledAt) || '—')}</dd></div>
          ${selected.sentAt ? `<div><dt>Envoyé</dt><dd>${esc(formatOpsTimestamp(selected.sentAt))}</dd></div>` : ''}
          ${selected.attempts ? `<div><dt>Tentatives</dt><dd>${Number(selected.attempts)}</dd></div>` : ''}
        </div>
        ${selected.lastError ? `<div class="pv2-chip red" style="justify-content:flex-start;white-space:normal;line-height:1.4">${esc(selected.lastError)}</div>` : ''}
        <div>
          <div class="pv2-panel-head" style="border:0;padding:0 0 8px"><h2 style="font-size:13px">Aperçu</h2></div>
          <div class="pv2-mail-preview">${esc(String(payload.textBody || selected.subject || 'Pas de contenu texte.'))}</div>
        </div>
      </div>` : '<div class="pv2-empty"><strong>Aucun message</strong>Sélectionnez une communication.</div>';

    root.innerHTML = `<div class="pv2-shell">
      ${bar({
        crumb: 'Clients & Marketing / Communications',
        title: 'Emails & relances',
        sub: `File opérationnelle · actualisé ${esc(updatedAt)}${errorMessage ? ` · <span style="color:var(--v2-red)">${esc(errorMessage)}</span>` : ''}`,
        actions: `
          <label class="pv2-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="14" height="14"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg><input value="${esc(state.staffEmailQuery || '')}" placeholder="Client, sujet, erreur…" oninput="setStaffEmailQuery(this.value)"></label>
          <button type="button" class="pv2-btn" onclick="requestOpsAdminLoad(true)">Actualiser</button>
          <button type="button" class="pv2-btn" onclick="exportStaffEmailsCsv()">Exporter</button>
          <button type="button" class="pv2-btn primary" onclick="requestOpsDispatch()">Envoyer la file</button>`,
      })}

      <section class="pv2-pipeline">
        ${pipe('all', 'Total', allRows.length, 'toutes communications')}
        ${pipe('queued', 'En file', metrics.queued, `${metrics.due || 0} prêt(s) à partir`)}
        ${pipe('sent', 'Envoyés', metrics.sent, `${metrics.deliveryRate || 0}% de réussite`)}
        ${pipe('failed', 'Échecs', metrics.failed, `${metrics.attempted || 0} tentative(s)`)}
        ${pipe('review', 'Validations', metrics.review, 'demandes staff')}
      </section>

      <section class="pv2-split">
        <article class="pv2-panel" style="max-height:560px;overflow:auto">
          <table class="pv2-table">
            <thead><tr><th>Message</th><th>Modèle</th><th>Statut</th><th class="num">Date</th></tr></thead>
            <tbody>${tableRows || `<tr><td colspan="4"><div class="pv2-empty"><strong>File vide</strong>Aucune communication pour ce filtre.</div></td></tr>`}</tbody>
          </table>
        </article>
        <article class="pv2-panel">
          <div class="pv2-panel-head"><h2>${esc(selected?.subject || 'Détail')}</h2></div>
          ${detail}
        </article>
      </section>
    </div>`;
    mount(root, 'emails');
  };

  /* ==========================================================================
     CAMPAGNES — parcours gamifié « agence marketing » (style Duolingo)
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
  function voiceText(voice) {
    if (!voice) return '';
    if (typeof voice === 'string') return voice;
    return [voice.person, voice.energy].filter(Boolean).join(', ');
  }

  // Détail du score qualité pour l'infobulle : rappelle les critères réels de
  // scoreDraft et, si disponible, la note obtenue par critère.
  function scoreTitle(evaluation) {
    const checks = Array.isArray(evaluation && evaluation.checks) ? evaluation.checks : [];
    const header = 'Score qualité du texte, noté sur : accroche, CTA, preuve, longueur, ton.';
    if (!checks.length) return header;
    const lines = checks.map((c) => `• ${c.label} : ${Math.round(Number(c.score) || 0)}/100`);
    return `${header}\n${lines.join('\n')}`;
  }

  // Signaux réels de la période (réservations/joueurs), reconstitués depuis le
  // dernier run persisté qui les porte. Sert à labelliser « c'est TA data ».
  function centerSignals(center) {
    const runs = (center && center.runs) || [];
    return runs.map((r) => r && r.payload && r.payload.signals).find(Boolean) || null;
  }

  function dataProvenanceLabel(signals) {
    if (signals && Number(signals.reservationCount) > 0) {
      return `Basé sur tes ${Number(signals.reservationCount)} réservation(s) et ${Number(signals.players) || 0} joueur(s) réels sur la période.`;
    }
    return 'Aucune réservation sur la période : ces pistes s’appuient sur l’ADN de marque et le calendrier type (exemples honnêtes, pas de fausse data).';
  }

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
    };
    return `<svg class="pv2-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`;
  }

  const channelLabel = (p) => CHANNEL_LABELS[p] || (p ? p.charAt(0).toUpperCase() + p.slice(1) : 'Canal');
  const scoreTone = (score) => (Number(score) >= 85 ? 'green' : Number(score) >= 70 ? 'amber' : 'red');
  const missionStateLabel = (st) => (st === 'done' ? 'Fait' : st === 'active' ? 'En cours' : st === 'attention' ? 'À surveiller' : 'À faire');

  function marketingCenters() {
    const status = typeof staffMarketingAgentsCache !== 'undefined' ? staffMarketingAgentsCache.status : null;
    return Array.isArray(status && status.centers) ? status.centers : [];
  }

  function activeMarketingCenter(centers) {
    const wanted = state.staffCampaignCenterId || state.adminCenterId || 'libramont';
    return centers.find((c) => c.centerId === wanted) || centers[0] || null;
  }

  function centerName(center) {
    const fromDraft = (center && center.runs || []).map((r) => r.payload && r.payload.centerName).find(Boolean);
    if (fromDraft) return fromDraft;
    const id = (center && center.centerId) || '';
    return id ? id.charAt(0).toUpperCase() + id.slice(1) : 'Centre';
  }

  // Reconstitue les drafts prêts à afficher depuis les runs persistés (le dernier
  // run par plateforme), le status ne les expose pas à plat.
  function centerDrafts(center) {
    const seen = new Set();
    const out = [];
    ((center && center.runs) || []).forEach((run) => {
      const d = run && run.payload;
      if (!d || !d.platform || seen.has(d.platform)) return;
      seen.add(d.platform);
      out.push(d);
    });
    return out;
  }

  function centerSummary(drafts) {
    const sc = (d) => Number(d && d.evaluation && d.evaluation.score) || 0;
    const scores = drafts.map(sc).filter(Boolean);
    return {
      averageScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
      ready: drafts.filter((d) => sc(d) >= 85).length,
      review: drafts.filter((d) => sc(d) >= 70 && sc(d) < 85).length,
      blocked: drafts.filter((d) => d.evaluation && d.evaluation.blocked).length,
    };
  }

  function campaignProgress(missions, summary) {
    const list = Array.isArray(missions) ? missions : [];
    const total = list.length || 1;
    const done = list.filter((m) => m.status === 'done').length;
    const pct = Math.round((done / total) * 100);
    let streak = 0;
    for (const m of list) { if (m.status === 'done') streak += 1; else break; }
    const ready = Number(summary.ready) || 0;
    const review = Number(summary.review) || 0;
    // Tout est dérivé de données réelles : jalons validés du parcours +
    // contenus prêts/à relire (issus des scores qualité réels).
    const level = done;
    const tier = CAMPAIGN_TIERS[Math.min(level, CAMPAIGN_TIERS.length - 1)];
    const xp = done * 100 + ready * 20 + review * 8;
    const next = list.find((m) => m.status !== 'done') || null;
    return {
      total: list.length,
      done,
      pct,
      streak,
      level,
      tier,
      xp,
      next,
      levelExplain: `Niveau = jalons du parcours validés (${done} sur ${list.length}).`,
      xpExplain: `XP = 100 par jalon validé + 20 par contenu prêt + 8 par contenu à relire (${done}×100 + ${ready}×20 + ${review}×8).`,
      streakExplain: 'Jalons = étapes validées d’affilée depuis le début du parcours.',
    };
  }

  function renderMissionPath(missions, progress) {
    const list = Array.isArray(missions) ? missions : [];
    const nodes = list.map((m, i) => {
      const st = ['done', 'active', 'attention', 'todo'].includes(m.status) ? m.status : 'todo';
      const icon = st === 'done' ? ci('check') : st === 'active' ? ci('bolt') : st === 'attention' ? ci('alert') : ci('lock');
      const last = i === list.length - 1;
      return `<li class="pv2-mission ${st}" ${st === 'active' ? 'aria-current="step"' : ''}>
        <span class="pv2-mission-node" aria-hidden="true">${icon}</span>
        ${last ? '' : '<span class="pv2-mission-link" aria-hidden="true"></span>'}
        <div class="pv2-mission-body">
          <div class="pv2-mission-top"><strong>${esc(m.label)}</strong><span class="pv2-mission-state">${esc(missionStateLabel(st))}</span></div>
          <p>${esc(m.detail || '')}</p>
        </div>
      </li>`;
    }).join('');
    return `<ol class="pv2-mission-path">${nodes}</ol>`;
  }

  function renderDraftCard(draft) {
    const c = draft.content || {};
    const body = c.body || draft.body || '';
    const evaluation = draft.evaluation || {};
    const score = Number(evaluation.score) || 0;
    const occLabel = draft.occasionLabel || draft.occasion || 'Général';
    const audienceLabel = AUDIENCE_LABELS[draft.audience] || draft.audience || 'Grand public';
    const clipKey = `${draft.centerId || ''}:${draft.platform || ''}:${draft.occasion || ''}`;
    campaignClipboard.set(clipKey, [c.hook, '', body, '', c.cta].filter((x) => x != null && x !== '').join('\n').trim());
    const benefits = (c.benefits || []).slice(0, 5);
    return `<article class="pv2-camp-draft">
      <div class="pv2-camp-draft-occ">
        <strong>${esc(occLabel)}</strong>
        <span>${esc(audienceLabel)}</span>
      </div>
      <header class="pv2-camp-draft-head">
        <div class="pv2-camp-badges">
          <span class="pv2-chip accent">${ci('channel')}${esc(channelLabel(draft.platform))}</span>
        </div>
        <span class="pv2-camp-score ${scoreTone(score)}" title="${esc(scoreTitle(evaluation))}"><em>${score}</em><small>/100</small></span>
      </header>
      ${c.hook ? `<p class="pv2-camp-hook">${esc(c.hook)}</p>` : ''}
      ${body ? `<div class="pv2-camp-text">${esc(body)}</div>` : ''}
      ${benefits.length ? `<ul class="pv2-camp-benefits">${benefits.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
      ${c.proof ? `<p class="pv2-camp-proof">${ci('star')}<span>${esc(c.proof)}</span></p>` : ''}
      ${c.urgency ? `<p class="pv2-camp-urgency">${ci('alert')}<span>${esc(c.urgency)}</span></p>` : ''}
      <div class="pv2-camp-draft-foot">
        ${c.cta ? `<span class="pv2-camp-cta">${esc(c.cta)}</span>` : '<span></span>'}
        <button type="button" class="pv2-btn" onclick="pv2CopyDraft('${escJs(clipKey)}')">${ci('copy')}Copier</button>
      </div>
    </article>`;
  }

  function renderStrategyBoard(strategy, dataLabel) {
    const gaps = (strategy.gapAnalysis || []).slice().sort((a, b) => (a.priority || 9) - (b.priority || 9)).slice(0, 4);
    const cal = (strategy.editorialCalendar || []).slice(0, 6);
    const improvements = (strategy.contentImprovements || []).slice(0, 4);
    const priorities = (strategy.priorities || []).slice(0, 4);

    const gapCard = `<article class="pv2-camp-card">
      <div class="pv2-camp-card-head">${ci('target')}<h3>Ce qu'il manque</h3></div>
      <p class="pv2-camp-card-sub">Occasions pas encore travaillées vs. ta demande réelle.</p>
      <ul class="pv2-camp-list">${gaps.map((g) => {
        const meta = GAP_META[g.status] || { label: g.status, tone: 'blue' };
        return `<li>
          <div class="pv2-camp-list-top"><strong>${esc(g.label)}</strong><span class="pv2-chip ${meta.tone}">${esc(meta.label)}</span></div>
          <p>${esc(g.insight || '')}</p>
          <small>${esc(g.recommendation || '')}</small>
        </li>`;
      }).join('')}</ul>
    </article>`;

    const calCard = `<article class="pv2-camp-card">
      <div class="pv2-camp-card-head">${ci('calendar')}<h3>Calendrier éditorial</h3></div>
      <p class="pv2-camp-card-sub">Quoi publier, quel jour, sur quel canal.</p>
      <ul class="pv2-camp-cal">${cal.map((c) => `<li>
        <span class="pv2-camp-cal-slot">${esc(c.slot)}</span>
        <div class="pv2-camp-cal-body">
          <strong>${esc(c.occasionLabel || '')}</strong>
          ${c.angle ? `<p>${esc(c.angle)}</p>` : ''}
          <div class="pv2-camp-cal-ch">${(c.channels || []).map((ch) => `<span class="pv2-chip">${esc(channelLabel(ch))}</span>`).join('')}</div>
        </div>
      </li>`).join('')}</ul>
    </article>`;

    const impCard = `<article class="pv2-camp-card">
      <div class="pv2-camp-card-head">${ci('wrench')}<h3>Améliorations concrètes</h3></div>
      <p class="pv2-camp-card-sub">Points faibles détectés sur les scripts générés.</p>
      ${improvements.length
        ? `<ul class="pv2-camp-list">${improvements.map((im) => `<li>
            <div class="pv2-camp-list-top"><strong>${esc(im.area || '')}</strong><span class="pv2-camp-score ${scoreTone(im.score)}"><em>${Number(im.score) || 0}</em></span></div>
            <p>${esc(im.issue || '')}</p>
            <small>${esc(im.fix || '')}</small>
            <span class="pv2-chip accent">${esc(channelLabel(im.platform))}</span>
          </li>`).join('')}</ul>`
        : '<div class="pv2-empty"><strong>Rien à corriger</strong>Tous les scripts passent le contrôle qualité.</div>'}
    </article>`;

    const prioCard = `<article class="pv2-camp-card">
      <div class="pv2-camp-card-head">${ci('flag')}<h3>Priorités</h3></div>
      <p class="pv2-camp-card-sub">Par quoi commencer cette semaine.</p>
      ${priorities.length
        ? `<ol class="pv2-camp-prio">${priorities.map((p) => `<li>
            <span class="pv2-camp-rank">${Number(p.rank) || 0}</span>
            <div><strong>${esc(p.action || '')}</strong><p>${esc(p.impact || '')}</p></div>
          </li>`).join('')}</ol>`
        : '<div class="pv2-empty"><strong>Aucune priorité</strong>Lancez une analyse pour établir le plan.</div>'}
    </article>`;

    return `<section class="pv2-panel pv2-camp-strategy">
      <div class="pv2-panel-head has-sub">
        <div><h2>Conseil d'agence</h2><p class="pv2-panel-sub">Ce qu'il faut travailler en priorité, déduit de tes réservations. ${esc(dataLabel || '')}</p></div>
        <small>stratégie actionnable</small>
      </div>
      <div class="pv2-panel-body"><div class="pv2-camp-board">${gapCard}${calCard}${impCard}${prioCard}</div></div>
    </section>`;
  }

  function renderCampAgents(agents) {
    const list = Array.isArray(agents) ? agents : [];
    if (!list.length) return '';
    return `<section class="pv2-panel">
      <div class="pv2-panel-head has-sub">
        <div><h2>Comment chaque canal est rédigé</h2><p class="pv2-panel-sub">Un rédacteur spécialisé par réseau : il écrit le texte puis l'auto-évalue sur les mêmes critères qualité. C'est ce qui produit le score de chaque carte ci-dessus.</p></div>
        <small>${list.length} canal(aux)</small>
      </div>
      <div class="pv2-panel-body"><div class="pv2-camp-agents">${list.map((a) => {
        const known = a.score != null;
        const score = known ? Math.round(Number(a.score) || 0) : '--';
        const criteria = Number(a.criteriaChecked || 0);
        const mode = a.generationMode === 'openai' ? 'IA + contrôle' : 'règles + contrôle';
        return `<article class="pv2-camp-agent">
          <div class="pv2-camp-agent-top">
            <span class="pv2-camp-agent-dot ${a.connected ? 'on' : ''}" aria-hidden="true" title="${a.connected ? 'Canal officiel connecté (publication possible)' : 'Brouillon interne (pas encore connecté)'}"></span>
            <strong>${esc(channelLabel(a.platform))}</strong>
            <span class="pv2-camp-score ${known ? scoreTone(a.score) : ''}" title="Score qualité du dernier script rédigé pour ce canal."><em>${esc(String(score))}</em>${known ? '<small>/100</small>' : ''}</span>
          </div>
          <p>${esc(a.currentWork || a.mission || 'Analyse des données du centre.')}</p>
          <small>${esc(mode)} · ${criteria} critère(s) vérifié(s) · ${a.connected ? 'canal connecté' : 'brouillon interne'}</small>
        </article>`;
      }).join('')}</div></div>
    </section>`;
  }

  window.pv2SelectCampaignIdea = function (id) {
    state.staffCampaignSelectedId = id;
    state.staffCampaignDraft = null;
    save();
    renderStaffCampaignsPage();
  };

  window.pv2SetCampaignChannel = function (channel) {
    state.staffCampaignChannel = channel;
    save();
    renderStaffCampaignsPage();
  };

  window.pv2SetCampaignCenter = function (centerId) {
    state.staffCampaignCenterId = centerId;
    save();
    renderStaffCampaignsPage();
  };

  window.pv2CopyDraft = function (key) {
    const text = campaignClipboard.get(key);
    if (!text) { if (typeof toast === 'function') toast('Contenu indisponible.'); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => (typeof toast === 'function' ? toast('Contenu copié.') : null))
        .catch(() => (typeof toast === 'function' ? toast('Copie indisponible.') : null));
    } else if (typeof toast === 'function') {
      toast('Copie indisponible.');
    }
  };

  /* ==========================================================================
     CAMPAGNES EMAIL RÉELLES — segments CRM calculés serveur, envoi via la
     pipeline communications (stats relues en direct, jamais stockées).
     Ouvertures/clics : non suivis tant qu'aucun pixel/lien tracké — affiché
     honnêtement, jamais de faux chiffres.
     ========================================================================== */
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
      const payload = await apiRequest(`/api/ops?action=listCampaigns&centerId=${encodeURIComponent(state.currentCenterId || 'libramont')}`);
      pv2Camp.campaigns = payload.campaigns || [];
      pv2Camp.segments = payload.segments || [];
      pv2Camp.channel = payload.channel || {};
      pv2Camp.loaded = true;
    } catch (error) {
      pv2Camp.error = error.message || 'Campagnes indisponibles.';
    } finally {
      pv2Camp.loading = false;
      renderStaffCampaignsPage();
    }
  }
  window.loadPv2Campaigns = loadPv2Campaigns;

  window.pv2CampSegmentChanged = async function (segment) {
    pv2Camp.form.segment = segment;
    if (pv2Camp.audience[segment] === undefined && pv2Camp.audienceLoading !== segment) {
      pv2Camp.audienceLoading = segment;
      renderStaffCampaignsPage();
      try {
        const payload = await apiRequest(`/api/ops?action=campaignAudience&segment=${encodeURIComponent(segment)}&centerId=${encodeURIComponent(state.currentCenterId || 'libramont')}`);
        pv2Camp.audience[segment] = { count: payload.count, sample: payload.sample || [] };
      } catch (error) {
        pv2Camp.audience[segment] = { count: null, sample: [] };
      }
      pv2Camp.audienceLoading = '';
    }
    renderStaffCampaignsPage();
  };

  window.pv2CampOpenForm = function () {
    pv2Camp.editingId = null;
    pv2Camp.form = { name: '', objective: '', segment: pv2Camp.form.segment || 'all', subject: '', body: '', mode: 'now', scheduledAt: '' };
    pv2Camp.formOpen = true;
    renderStaffCampaignsPage();
    window.pv2CampSegmentChanged(pv2Camp.form.segment);
  };

  window.pv2CampCloseForm = function () {
    pv2Camp.formOpen = false;
    pv2Camp.editingId = null;
    renderStaffCampaignsPage();
  };

  // Ouvre un brouillon existant dans le formulaire pour édition.
  window.pv2CampEditDraft = function (id) {
    const campaign = pv2Camp.campaigns.find((c) => c.id === id);
    if (!campaign) return;
    pv2Camp.editingId = id;
    pv2Camp.form = { name: campaign.name, objective: campaign.objective, segment: campaign.segment, subject: campaign.subject, body: campaign.body, mode: 'now', scheduledAt: '' };
    pv2Camp.formOpen = true;
    renderStaffCampaignsPage();
    window.pv2CampSegmentChanged(campaign.segment);
  };

  // Envoie un brouillon directement depuis la liste (confirme le volume réel).
  window.pv2CampSendDraft = async function (id) {
    const campaign = pv2Camp.campaigns.find((c) => c.id === id);
    if (!campaign) return;
    const centerId = state.currentCenterId || 'libramont';
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
    if (!window.confirm(`Envoyer le brouillon « ${campaign.name} » maintenant à ${count} destinataire(s) ?`)) return;
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
        body: JSON.stringify({ action: 'improveEmailWithAi', centerId: state.currentCenterId || 'libramont', subject: pv2Camp.form.subject, body: pv2Camp.form.body, category: 'marketing' }),
      });
      if (payload.mode === 'ia' && payload.subject && payload.body) {
        pv2Camp.form.subject = payload.subject;
        pv2Camp.form.body = payload.body;
        if (typeof toast === 'function') toast('Contenu réécrit par l\'IA — relis avant envoi.');
      } else if (typeof toast === 'function') {
        toast(`Conseils : ${(payload.tips || []).slice(0, 2).join(' · ')}`);
      }
    } catch (error) {
      if (typeof toast === 'function') toast(error.message || 'Analyse impossible.');
    } finally {
      if (button) button.disabled = false;
      renderStaffCampaignsPage();
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
      if (typeof toast === 'function') toast("Audience en cours de calcul — attends le nombre de destinataires avant d'envoyer.");
      return;
    }
    if (mode === 'now' && !window.confirm(`Envoyer maintenant à ${count} destinataire(s) du segment sélectionné ?`)) return;
    if (mode === 'schedule' && !form.scheduledAt) { if (typeof toast === 'function') toast('Choisis la date et l\'heure d\'envoi.'); return; }
    pv2Camp.busy = true;
    if (button) button.disabled = true;
    renderStaffCampaignsPage();
    try {
      const centerId = state.currentCenterId || 'libramont';
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
      renderStaffCampaignsPage();
      return;
    }
    pv2Camp.busy = false;
  };

  window.pv2CampCancel = async function (id) {
    if (!window.confirm('Annuler cette campagne ? Les envois encore en file seront stoppés.')) return;
    try {
      const payload = await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'cancelCampaign', centerId: state.currentCenterId || 'libramont', id }),
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
      const payload = await apiRequest(`/api/ops?action=campaignAudience&segment=${encodeURIComponent(segment)}&full=1&centerId=${encodeURIComponent(state.currentCenterId || 'libramont')}`);
      const rows = [['Nom', 'Email', 'Visites', 'Chiffre (EUR)', 'Dernière visite']];
      for (const r of payload.recipients || []) rows.push([r.name, r.email, r.visits, String(r.revenue).replace('.', ','), r.lastDate]);
      const csv = '﻿' + rows.map((row) => row.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
      pv2CampDownload(`destinataires-${segment}.csv`, csv, 'text/csv;charset=utf-8');
      if (typeof toast === 'function') toast(`${(payload.recipients || []).length} destinataire(s) exporté(s).`);
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
      <thead><tr><th>Campagne</th><th>Segment</th><th>Statut</th><th class="num">Cibles</th><th class="num">Envoyés</th><th class="num">Échecs</th><th class="num">En file</th><th>Suivi</th><th></th></tr></thead>
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
        : audience ? `${audience.count} destinataire(s)${audience.sample?.length ? ` · ex : ${audience.sample.slice(0, 3).join(', ')}` : ''}` : '—';
      return `<div class="ms-viewer"><div class="ms-form">
        ${pv2Camp.editingId ? '<div class="ms-form-note">Édition du brouillon — enregistre tes modifications, ou envoie-le directement.</div>' : ''}
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

    return `<section class="pv2-panel">
      <div class="pv2-panel-head">
        <h2>Campagnes email — ciblage réel</h2>
        <div style="display:flex;gap:8px;align-items:center">
          ${pv2Camp.channel && pv2Camp.channel.resendConfigured === false ? '<small style="color:var(--warning)">canal d\'envoi à configurer — les envois restent en file</small>' : ''}
          <button type="button" class="pv2-btn" onclick="loadPv2Campaigns(true)">Actualiser</button>
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

  window.renderStaffCampaignsPage = function () {
    const root = document.getElementById('staffCampaignsPage');
    if (!root) return;

    // Charge le moteur marketing au premier affichage (idempotent, cache 45 s).
    if (typeof loadStaffMarketingAgents === 'function' && typeof staffMarketingAgentsCache !== 'undefined'
        && !staffMarketingAgentsCache.loaded && !staffMarketingAgentsCache.loading) {
      setTimeout(() => loadStaffMarketingAgents(), 0);
    }

    const cache = typeof staffMarketingAgentsCache !== 'undefined' ? staffMarketingAgentsCache : {};
    const loading = Boolean(cache.loading);
    const running = Boolean(cache.running);
    const error = cache.error || '';
    const updatedAt = cache.lastLoadedAt && typeof formatOpsTimestamp === 'function'
      ? formatOpsTimestamp(cache.lastLoadedAt)
      : (cache.lastLoadedAt || 'jamais');

    const centers = marketingCenters();
    const center = activeMarketingCenter(centers);

    const actions = `
      <button type="button" class="pv2-btn" onclick="loadStaffMarketingAgents(true)">${ci('refresh')}Actualiser</button>
      <button type="button" class="pv2-btn" onclick="exportStaffCampaignsCsv()">Exporter</button>
      <button type="button" class="pv2-btn primary" onclick="runStaffMarketingAgents()" ${running ? 'disabled' : ''}>${ci('bolt')}${running ? 'Analyse…' : 'Analyser'}</button>`;

    if (!center) {
      root.innerHTML = `<div class="pv2-shell">
        ${bar({
          crumb: 'Clients & Marketing / Studio',
          title: 'Campagnes',
          sub: `Parcours marketing factuel · maj ${esc(updatedAt)}${error ? ` · <span class="pv2-camp-err">${esc(error)}</span>` : ''}`,
          actions,
        })}
        ${renderPv2RealCampaigns()}
        <section class="pv2-panel"><div class="pv2-panel-body">
          <div class="pv2-empty"><strong>${loading ? 'Chargement du moteur marketing…' : 'Aucune donnée marketing'}</strong>${loading ? 'Lecture des données réelles du centre.' : 'Lancez une analyse pour générer le parcours et les contenus prêts à publier.'}</div>
        </div></section>
      </div>`;
      mount(root, 'campaigns');
      return;
    }

    const brand = center.brand || {};
    const strategy = center.strategy || {};
    const missions = center.missions || [];
    const agents = center.agents || [];
    const drafts = centerDrafts(center);
    const summary = centerSummary(drafts);
    const progress = campaignProgress(missions, summary);
    const signals = centerSignals(center);
    const dataLabel = dataProvenanceLabel(signals);
    const occasionsCount = new Set(drafts.map((d) => d.occasion || d.occasionLabel).filter(Boolean)).size;

    const rating = brand.proof && brand.proof.rating != null ? brand.proof.rating : '';
    const diff = (brand.differentiators || []).slice(0, 3);

    const centerSeg = centers.length > 1
      ? seg(centers.map((c) => ({ key: c.centerId, label: centerName(c), active: c.centerId === center.centerId })), 'pv2SetCampaignCenter')
      : '';

    const hero = `<section class="pv2-camp-hero">
      <div class="pv2-camp-brand">
        <div class="pv2-camp-brand-top">
          <h2>${esc(brand.name || centerName(center))}</h2>
          ${rating !== '' ? `<span class="pv2-camp-rating" title="Note Google réelle de Fun Galaxy (avis clients).">${ci('star')}<b>${esc(String(rating))}</b><small>note Google réelle</small></span>` : ''}
        </div>
        ${brand.tagline ? `<p class="pv2-camp-tagline">${esc(brand.tagline)}</p>` : ''}
        ${strategy.positioning ? `<p class="pv2-camp-positioning">${esc(strategy.positioning)}</p>` : ''}
        ${diff.length ? `<div class="pv2-camp-diff">${diff.map((d) => `<span class="pv2-chip">${esc(d)}</span>`).join('')}</div>` : ''}
      </div>
      <div class="pv2-camp-level">
        <div class="pv2-level-head">
          <span class="pv2-level-ring" style="--p:${progress.pct}" title="${esc(progress.levelExplain)}"><b>${progress.level}</b><small>/ ${progress.total}</small></span>
          <div class="pv2-level-meta">
            <strong>Niveau ${progress.level} · ${esc(progress.tier)}</strong>
            <span title="${esc(progress.xpExplain)}">${progress.xp} XP</span>
            <span class="pv2-streak" title="${esc(progress.streakExplain)}">${ci('flame')}<b>${progress.streak}</b> jalon(s) d'affilée</span>
            <span class="pv2-level-note">${esc(progress.levelExplain)}</span>
          </div>
        </div>
        <div class="pv2-xpbar" role="progressbar" aria-valuenow="${progress.pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Progression du parcours marketing">
          <span class="pv2-xpbar-fill" style="transform:scaleX(${progress.pct / 100})"></span>
        </div>
        <div class="pv2-camp-counters">
          <span class="pv2-camp-count" title="Moyenne des scores qualité des ${drafts.length} contenu(s) généré(s)."><b>${summary.averageScore}</b><small>score moyen</small></span>
          <span class="pv2-camp-count green" title="Contenu prêt = score ≥ 85 (utilisable après relecture rapide)."><b>${summary.ready}</b><small>prêt(s)</small></span>
          <span class="pv2-camp-count amber" title="À relire = score 70 à 84 (bon, mais à peaufiner avant publication)."><b>${summary.review}</b><small>à relire</small></span>
          <span class="pv2-camp-count red" title="Bloqué = contient une promesse interdite (dispo ou session garantie) à corriger."><b>${summary.blocked}</b><small>bloqué(s)</small></span>
        </div>
        <p class="pv2-camp-counters-note">Compteurs calculés sur les ${drafts.length} contenu(s) · score = accroche, CTA, preuve, longueur, ton.</p>
        ${progress.next
          ? `<div class="pv2-camp-next"><span class="pv2-camp-next-ico">${ci('bolt')}</span><div><small>Pour monter de niveau</small><strong>${esc(progress.next.label)}</strong><p>${esc(progress.next.detail || '')}</p></div></div>`
          : `<div class="pv2-camp-next done"><span class="pv2-camp-next-ico">${ci('check')}</span><div><strong>Parcours complet</strong><p>Tous les jalons sont validés sur ce centre.</p></div></div>`}
      </div>
    </section>`;

    const contents = `<article class="pv2-panel">
      <div class="pv2-panel-head has-sub">
        <div><h2>Contenus prêts à publier</h2><p class="pv2-panel-sub">Un script par canal et par occasion, écrit sur les vraies activités du centre et prêt à copier-coller.</p></div>
        <small>${drafts.length} script(s) · ${occasionsCount} occasion(s)</small>
      </div>
      <div class="pv2-panel-body">
        ${drafts.length
          ? `<div class="pv2-camp-draft-grid">${drafts.map((d) => renderDraftCard(d)).join('')}</div>`
          : '<div class="pv2-empty"><strong>Pas encore de contenu</strong>Cliquez sur Analyser pour générer les scripts prêts à l’emploi.</div>'}
      </div>
    </article>`;

    const rail = `<aside class="pv2-panel pv2-camp-rail">
      <div class="pv2-panel-head has-sub">
        <div><h2>Parcours de missions</h2><p class="pv2-panel-sub">Les étapes pour passer d'une analyse à des contenus publiables.</p></div>
        <small>${progress.done}/${progress.total}</small>
      </div>
      <div class="pv2-panel-body">${renderMissionPath(missions, progress)}</div>
    </aside>`;

    root.innerHTML = `<div class="pv2-shell">
      ${bar({
        crumb: 'Clients & Marketing / Studio',
        title: 'Campagnes',
        sub: `Parcours marketing factuel · ${esc(centerName(center))}${voiceText(brand.voice) ? ` · voix ${esc(voiceText(brand.voice))}` : ''} · maj ${esc(updatedAt)}${error ? ` · <span class="pv2-camp-err">${esc(error)}</span>` : ''}`,
        actions,
      })}
      ${renderPv2RealCampaigns()}
      ${centerSeg}
      ${hero}
      <section class="pv2-split pv2-camp-split">
        ${contents}
        ${rail}
      </section>
      ${renderStrategyBoard(strategy, dataLabel)}
      ${renderCampAgents(agents)}
    </div>`;
    mount(root, 'campaigns');
  };

  /* ==========================================================================
     TARIFS — catalog grid
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

  window.renderStaffPricingPage = function () {
    const root = document.getElementById('staffPricingPage');
    if (!root) return;
    const allRows = getPricingRows();
    const rows = getPricingRowsFiltered();
    const selected = getSelectedPricingRow(rows);
    if (selected && state.staffPricingSelectedId !== selected.id) state.staffPricingSelectedId = selected.id;
    const metrics = getPricingMetrics(allRows);
    const filter = state.staffPricingFilter || 'all';
    const countByType = (type) => allRows.filter((row) => row.type === type).length;

    const ranking = state.staffPricingSort || 'default';
    const cards = rows.map((row, index) => `<article class="pv2-price-card ${selected && row.id === selected.id ? 'selected' : ''}" onclick="pv2SelectPricing('${escJs(row.id)}')">
      <div class="pv2-price-head">
        <div>${ranking !== 'default' && index < 3 && (Number(row.count) || Number(row.revenue)) ? `<span class="pv2-rank">#${index + 1}</span>` : ''}<strong>${esc(row.title || 'Offre')}</strong><small>${esc(row.subtitle || '')}</small></div>
        <div class="pv2-price-amount">${money(row.price)}<small> ${esc(row.type === 'formula' ? '/pers' : row.type === 'bowling' ? '/piste' : '')}</small></div>
      </div>
      <p class="pv2-price-desc">${esc(row.description || '')}</p>
      <div class="pv2-price-tags">${(row.tags || []).slice(0, 4).map((tag) => `<span class="pv2-chip">${esc(tag)}</span>`).join('')}</div>
      <div class="pv2-price-stats">
        <span><strong>${Number(row.count) || 0}</strong> résa</span>
        <span><strong>${Number(row.players) || 0}</strong> joueurs</span>
        <span><strong>${money(row.revenue)}</strong></span>
        <span><strong>${Number(row.count) ? money(Number(row.revenue || 0) / Number(row.count)) : '—'}</strong> panier</span>
      </div>
    </article>`).join('');

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

      <section class="pv2-catalog">${cards || '<div class="pv2-empty"><strong>Aucune offre</strong>Modifiez le filtre ou la recherche.</div>'}</section>
    </div>`;
    mount(root, 'pricing');
  };

  /* ==========================================================================
     GROUPES & ANNIVERSAIRES — chrome V2 (P1-6)
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
    renderStaffGroupsPageV2();
  };

  function renderStaffGroupsPageV2() {
    const root = document.getElementById('staffUtilityPage');
    if (!root) return;
    const clientRows = typeof getStaffClientRows === 'function' ? getStaffClientRows() : [];
    const rows = clientRows.filter((row) => row.isGroup || row.hasBirthday);
    const players = rows.reduce((sum, row) => sum + (Number(row.players) || 0), 0);
    const formulas = rows.reduce((sum, row) => sum + (Number(row.formulas) || 0), 0);
    const revenue = rows.reduce((sum, row) => sum + (Number(row.spent) || 0), 0);
    const sync = staffClientDataCache.loading
      ? 'Synchronisation…'
      : staffClientDataCache.loaded
        ? `Synchronisé ${formatOpsTimestamp(staffClientDataCache.syncedAt)}`
        : 'Données locales';

    root.className = 'staff-utility-page utility-page-groups';
    root.innerHTML = `<div class="pv2-shell">
      ${bar({
        crumb: 'Clients & Marketing / Groupes',
        title: 'Groupes & anniversaires',
        sub: `${esc(sync)}${staffClientDataCache.error ? ' · <span style="color:var(--warning)">API indisponible</span>' : ''}`,
        actions: `
          <button type="button" class="pv2-btn" onclick="loadStaffClientData(true)">Actualiser</button>
          <button type="button" class="pv2-btn primary" onclick="openQuickBook({ date: state.currentDate, type: 'formule' })">+ Réservation groupe</button>`,
      })}

      <section class="pv2-stats">
        ${stat({ label: 'Groupes actifs', count: rows.length, foot: 'profils consolidés' })}
        ${stat({ label: 'Joueurs cumulés', count: players, foot: 'historique réel' })}
        ${stat({ label: 'Formules réservées', count: formulas, foot: 'anniversaires & packs' })}
        ${stat({ label: 'CA groupe', value: money(revenue), foot: 'réservations non annulées' })}
      </section>

      ${renderStaffGroupWorkspaceV2(rows)}
    </div>`;
    mount(root, 'groups');
    if (typeof ensureStaffClientData === 'function') ensureStaffClientData();
    if (typeof ensureStaffCustomRequests === 'function') ensureStaffCustomRequests();
  }

  /* ==========================================================================
     COMMAND PALETTE — Ctrl/Cmd+K
     ======================================================================== */

  const PALETTE_PAGES = [
    ['dashboard', "Vue d'ensemble", '◫'],
    ['planning', 'Planning du jour', '▤'],
    ['reservations', 'Réservations', '☰'],
    ['clients', 'Clients', '◉'],
    ['groups', 'Groupes & anniversaires', '❋'],
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
            icon: (row.initials || '–').slice(0, 2),
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

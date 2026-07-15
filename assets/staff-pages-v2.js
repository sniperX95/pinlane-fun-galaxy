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
    // Positionnement INSTANTANÉ : chaque appel suit une reconstruction du DOM
    // (innerHTML), donc le pill partait de sa position CSS par défaut puis
    // GLISSAIT vers l'actif — un aller-retour visible à chaque fetch qui
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

  // 4 segments simples (fusion Clients+Groupes, KISS). Une seule vue active,
  // re-clic sur l'actif → retour « Tous ». Remplace facettes + tri custom.
  const CRM_SEGMENTS = [
    ['tous', 'Tous'],
    ['avenir', 'À venir'],
    ['relancer', 'À relancer'],
    ['vip', 'VIP'],
  ];

  function crmSegmentBar(filteredCount, totalCount) {
    const active = getStaffClientSegment();
    const seg = CRM_SEGMENTS.map(([key, label]) =>
      `<button type="button" class="crm-seg${active === key ? ' is-active' : ''}" aria-pressed="${active === key}" onclick="setStaffClientSegment('${key}')">${esc(label)}</button>`
    ).join('');
    const count = active === 'avenir' ? '' : `<span class="crm-seg-count"><strong>${filteredCount}</strong>${active === 'tous' ? ` / ${totalCount}` : ''} client${filteredCount > 1 ? 's' : ''}</span>`;
    return `<section class="crm-segbar" role="tablist" aria-label="Vue clients">${seg}${count}</section>`;
  }

  // Badge unique par ligne — le plus décisionnel gagne.
  function crmRowBadge(row, ctx) {
    const relance = getStaffClientRelance(row);
    if (row.nextBooking && (String(row.nextBooking.occasion || '').toLowerCase() === 'anniversaire' || row.hasBirthday)) {
      return '<span class="crm-pill tone-info">Anniv. à venir</span>';
    }
    if (ctx.vipThreshold > 0 && Number(row.spent || 0) >= ctx.vipThreshold) return '<span class="crm-pill tone-accent">VIP</span>';
    if (relance.due) return '<span class="crm-pill tone-warn">À relancer</span>';
    if (row.statusClass === 'new') return '<span class="crm-pill tone-info">Nouveau</span>';
    return '';
  }

  // Table 5 colonnes max : Client / Venue / Visites / Dépensé / Badge (ou Pourquoi).
  function crmListRow(row, selected, ctx) {
    const next = row.nextBooking;
    const visite = next
      ? `<strong>${esc(formatStaffClientDateText(next.date))}</strong><small>prochaine venue${next.startTime ? ` · ${esc(String(next.startTime).slice(0, 5))}` : ''}</small>`
      : `<strong>${esc(row.lastVisitAgo || '—')}</strong><small>${esc(row.lastVisit || '')}</small>`;
    const lastCell = ctx.segment === 'relancer'
      ? `<td class="crm-cell-why">${esc(getStaffClientRelance(row).reason)}${row.email ? `<button type="button" class="pv2-btn sm" onclick="event.stopPropagation();crmOpenRelance('${escJs(row.id)}')">Relancer</button>` : ''}</td>`
      : `<td class="crm-cell-badge">${crmRowBadge(row, ctx)}</td>`;
    return `
      <tr class="${selected && row.id === selected.id ? 'is-selected' : ''}" tabindex="0" role="button" onclick="selectStaffClient('${escJs(row.id)}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();selectStaffClient('${escJs(row.id)}');}">
        <td class="crm-cell-client">
          <span class="crm-avatar">${esc(row.initials || '–')}</span>
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
        subject: `L'anniversaire approche — on vous re-réserve la fête ? 🎂`,
        body: `Bonjour ${firstName},\n\nL'an dernier vous aviez fêté un anniversaire chez nous — et c'était un super moment !\nLa date approche : on vous re-réserve la formule ? Les créneaux du week-end partent vite.\n\nRépondez à ce message ou réservez en ligne, on s'occupe du reste.\n\nÀ très vite,\nL'équipe Fun Galaxy`,
      };
    }
    return {
      reason: 'dormant',
      subject: 'Ça fait un moment — on vous a gardé une piste 🎳',
      body: `Bonjour ${firstName},\n\nÇa fait un moment qu'on ne vous a pas vus au centre — bowling, laser, arcades… tout est prêt.\nVenez en semaine, c'est plus calme (et plus tranquille pour jouer).\n\nRéservez en ligne quand vous voulez, ou répondez simplement à ce message.\n\nÀ bientôt,\nL'équipe Fun Galaxy`,
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
          centerId: state.currentCenterId || 'libramont',
          email: row.email,
          name: row.name || '',
          phone: row.phone || '',
          reason: crmRelance.reason,
          subject: crmRelance.subject,
          body: crmRelance.body,
        }),
      });
      crmRelance.openFor = null;
      toast('Relance en file d’envoi ✓ — je mesure si le client revient.');
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
      const payload = await apiRequest(`/api/ops?action=relanceStats&days=90&centerId=${encodeURIComponent(state.currentCenterId || 'libramont')}`);
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

  /* Notes client persistantes (allergies, prénom de l'enfant…) — table client_notes. */
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
      const payload = await apiRequest(`/api/ops?action=clientNotes&clientKey=${encodeURIComponent(key)}&centerId=${encodeURIComponent(state.currentCenterId || 'libramont')}`);
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
        body: JSON.stringify({ action: 'clientNotes', clientKey: key, body, centerId: state.currentCenterId || 'libramont' }),
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
    if (ctx.vipThreshold > 0 && Number(selected.spent || 0) >= ctx.vipThreshold) badges.push('<span class="crm-pill tone-accent">VIP</span>');
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
          <span class="crm-avatar crm-avatar-lg">${esc(selected.initials || '–')}</span>
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
    const birthdays30 = dossiers.filter((d) => within(d, 30) && getStaffGroupDossierOccasion(d) === 'anniversaire').length;
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
      // ROI du CRM : les relances envoyées → venues → € (le CRM prouve sa valeur).
      const roi = ctx.segment !== 'relancer' ? '' : `<section class="crm-roi">
        ${crmRelanceStats.loaded && crmRelanceStats.sent > 0
          ? `<span class="crm-roi-figures"><strong>${crmRelanceStats.sent}</strong> relance${crmRelanceStats.sent > 1 ? 's' : ''} sur 90 j<span class="crm-roi-sep"></span><strong>${crmRelanceStats.converted}</strong> venue${crmRelanceStats.converted > 1 ? 's' : ''}<span class="crm-roi-sep"></span><strong>${money(crmRelanceStats.revenue)}</strong> générés</span>`
          : `<span class="crm-roi-figures">Relance ton premier client — je mesure ce que chaque relance rapporte.</span>`}
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
        ${statBtn('avenir', stat({ label: 'Anniversaires 30 j', count: birthdays30, foot: 'fêtes à préparer' }))}
        ${statBtn('relancer', stat({ label: 'À relancer', count: relancer, foot: 'clients à récupérer' }))}
        ${statBtn('vip', stat({ label: 'Panier moyen', value: money(pv2AvgBasket(allRows)), foot: 'par réservation' }))}
      </section>

      ${crmSegmentBar(rows.length, allRows.length)}

      ${body}
    </div>`;
    mount(root, 'clients');
    if (typeof ensureStaffClientData === 'function') ensureStaffClientData();
    if (segment === 'avenir' && typeof ensureStaffCustomRequests === 'function') ensureStaffCustomRequests();
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

  /* ── Composer universel + boîte de réception (Emails v3) ──────────────────
     Contrats : sendDirectEmail (C3), analyzeInboundEmail (C4), emailTemplates
     (identités + modèles), improveEmailWithAi. Le composer n'exige AUCUNE
     réservation ; la fiche client route ici via pv2OpenComposer. ── */

  // Modèles de départ (mêmes contenus que le studio direction — dupliqués
  // volontairement : admin-mail.js n'est pas chargé côté staff).
  const PV2_STARTERS = [
    { key: 'relance-client', name: 'On ne vous a plus vu', subject: 'Ça fait longtemps, {{prenom}} !', body: 'Bonjour {{prenom}},\n\nÇa fait un moment qu\'on ne vous a plus vu au centre — les pistes vous attendent.\n\nRéservez en ligne quand vous voulez, ça prend une minute.\n\nÀ bientôt,\nL\'équipe Fun Galaxy' },
    { key: 'marketing-anniversaire', name: 'Pack anniversaire', subject: 'Un anniversaire inoubliable, sans stress pour vous', body: 'Bonjour {{prenom}},\n\nUn anniversaire à organiser ? Bowling, laser game, table décorée et cruches de boissons : on s\'occupe de tout, vous profitez.\n\nDites-nous la date et le nombre d\'enfants, on vous propose la formule adaptée.\n\nL\'équipe Fun Galaxy' },
    { key: 'promo-semaine', name: 'Offre de la semaine', subject: 'Cette semaine chez Fun Galaxy : {{offre}}', body: 'Bonjour {{prenom}},\n\nCette semaine, on vous a préparé quelque chose : {{offre}}.\n\nValable du {{date_debut}} au {{date_fin}} — réservez votre créneau en ligne en 1 minute.\n\nÀ très vite,\nL\'équipe Fun Galaxy' },
    { key: 'serieux-entreprise', name: 'Proposition entreprise', subject: 'Votre événement d\'équipe chez Fun Galaxy — proposition', body: 'Bonjour {{prenom}},\n\nSuite à votre demande, voici notre proposition pour votre événement d\'équipe : créneau privatisé, activités au choix (bowling, laser game) et espace repas.\n\nNous restons disponibles pour ajuster la formule à votre budget et vos horaires.\n\nCordialement,\nLa direction Fun Galaxy' },
  ];

  const pv2Mail = {
    composerOpen: false, busy: false, aiBusy: false, aiTips: [],
    draft: { to: '', name: '', subject: '', body: '', identityId: '', templateRef: '', replyTo: null },
    identities: [], templates: [], metaLoaded: false, metaLoading: false,
    analyzeOpen: false, analyzeBusy: false, analyzeDraft: { from: '', body: '' },
    replyDraft: {}, replyBusy: '', analysisOverride: {},
  };
  window.pv2Mail = pv2Mail;

  async function loadPv2MailMeta(force = false) {
    if (pv2Mail.metaLoading || (pv2Mail.metaLoaded && !force)) return;
    pv2Mail.metaLoading = true;
    try {
      const payload = await apiRequest(`/api/ops?action=emailTemplates&centerId=${encodeURIComponent(state.currentCenterId || 'libramont')}`);
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
  // prérempli — remplace le détour console direction / mailto.
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
        body: JSON.stringify({ action: 'improveEmailWithAi', centerId: state.currentCenterId || 'libramont', subject: d.subject, body: d.body, category: 'relance' }),
      });
      pv2Mail.aiTips = payload.tips || [];
      if (payload.mode === 'ia' && payload.subject && payload.body) {
        pv2Mail.draft.subject = payload.subject;
        pv2Mail.draft.body = payload.body;
        toast('Brouillon amélioré par l\'IA — relis avant d\'envoyer.');
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
          centerId: state.currentCenterId || 'libramont',
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
      toast(scheduledAt ? 'Message programmé ✓ — il partira au moment choisi.' : 'Message en file d\'envoi ✓');
      if (typeof requestOpsAdminLoad === 'function') requestOpsAdminLoad(true);
    } catch (error) {
      toast(error.message || 'Envoi impossible.');
    } finally {
      pv2Mail.busy = false;
      renderStaffEmailsPage();
    }
  };

  /* ── « Analyser un reçu » : le staff colle un mail, l'agent le classe et
     propose la réponse — le chemin sans configuration MX. ── */
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
        body: JSON.stringify({ action: 'analyzeInboundEmail', centerId: state.currentCenterId || 'libramont', from, body, store: true }),
      });
      pv2Mail.analyzeOpen = false;
      pv2Mail.analyzeDraft = { from: '', body: '' };
      state.staffEmailFilter = 'inbound';
      save();
      toast('Mail analysé — il est dans les Reçus avec sa réponse proposée.');
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
          centerId: state.currentCenterId || 'libramont',
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
          centerId: state.currentCenterId || 'libramont',
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
     (déclencheur + cible + message + plafond — contrat customSequences). ── */
  const pv2Seq = { loaded: false, loading: false, sequences: [], limits: null, editId: '', creating: false, draft: {}, busy: false };
  window.pv2Seq = pv2Seq;
  const PV2_WEEKDAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

  async function loadPv2Sequences(force = false) {
    if (pv2Seq.loading || (pv2Seq.loaded && !force)) return;
    pv2Seq.loading = true;
    try {
      const payload = await apiRequest(`/api/ops?action=customSequences&centerId=${encodeURIComponent(state.currentCenterId || 'libramont')}`);
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
        body: JSON.stringify({ action: 'customSequences', centerId: state.currentCenterId || 'libramont', sequence }),
      });
      pv2Seq.sequences = payload.sequences || pv2Seq.sequences;
      pv2Seq.creating = false;
      pv2Seq.editId = '';
      toast('Séquence enregistrée ✓ — elle tourne chaque matin avec les autres.');
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
        body: JSON.stringify({ action: 'customSequences', op: 'toggle', id, enabled, centerId: state.currentCenterId || 'libramont' }),
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
        body: JSON.stringify({ action: 'customSequences', op: 'delete', id, centerId: state.currentCenterId || 'libramont' }),
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
        <button type="button" class="mk-switch${sequence.enabled ? ' is-on' : ''}" role="switch" aria-checked="${sequence.enabled}" aria-label="${esc(sequence.name)}" onclick="pv2SeqToggle('${escJs(sequence.id)}', ${sequence.enabled ? 'false' : 'true'})" ${pv2Seq.busy ? 'disabled' : ''}><span></span></button>
      </div>
      <p class="mk-auto-desc">${esc(pv2SeqTriggerLabel(sequence))} · max ${Number(sequence.cap) || 0} envois</p>
      <details class="mk-auto-preview"><summary>Aperçu du message</summary><p>${esc(sequence.body || '')}</p></details>
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
    return `<div class="pv2-seq-editor" aria-label="Éditeur de séquence">
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

  /* ── RÉGLAGES EMAILS : modèles, adresses d'envoi, cerveau de l'agent —
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
      const payload = await apiRequest(`/api/ops?action=emailBrain&centerId=${encodeURIComponent(state.currentCenterId || 'libramont')}`);
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
          centerId: state.currentCenterId || 'libramont',
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
        body: JSON.stringify({ action: 'saveEmailTemplate', centerId: state.currentCenterId || 'libramont', id: tpl.id, name: tpl.name, category: tpl.category, subject: tpl.subject, body: tpl.body }),
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
        body: JSON.stringify({ action: 'archiveEmailTemplate', centerId: state.currentCenterId || 'libramont', id }),
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
        body: JSON.stringify({ action: 'saveEmailIdentity', centerId: state.currentCenterId || 'libramont', label: identity.label || identity.email, email: identity.email, isDefault: identity.isDefault }),
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
        body: JSON.stringify({ action: 'saveEmailIdentity', centerId: state.currentCenterId || 'libramont', id: identity.id, label: identity.label, email: identity.email, isDefault: true }),
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
        body: JSON.stringify({ action: 'deleteEmailIdentity', centerId: state.currentCenterId || 'libramont', id }),
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
            <button type="button" class="pv2-btn primary" onclick="pv2BrainSave()" ${pv2Settings.busy ? 'disabled' : ''}>${pv2Settings.busy ? 'Enregistrement…' : 'Enregistrer — l\'agent apprend'}</button>
          </div>
        </div>`;
    }
    return `<section class="pv2-panel pv2-settings" aria-label="Réglages emails">
      <div class="pv2-panel-head has-sub">
        <div><h2>Réglages emails</h2><p class="pv2-panel-sub">Modèles, adresses d'envoi et cerveau de l'agent — tout t'appartient.</p></div>
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
  // timing : bornes du contrat C2 — libellés FR compréhensibles en one-shot.
  const AUTOMATION_META = [
    { key: 'confirmation', label: 'Confirmation', desc: 'Confirme la réservation au client dès qu’elle est validée.', preview: 'Votre réservation est confirmée — date, heure, formule et infos pratiques.' },
    { key: 'reminder_48h', label: 'Rappel avant la venue', desc: 'Rappelle la venue quelques jours avant — moins de no-show.', preview: 'Rappel de votre venue après-demain, avec l’heure d’arrivée conseillée.', timing: { options: [1, 2, 3, 4], label: (n) => `${n} jour${n > 1 ? 's' : ''} avant la venue` } },
    { key: 'post_visit', label: 'Merci post-visite', desc: 'Remercie après la visite et invite à revenir.', preview: 'Merci de votre visite ! Une prochaine fois ? Les créneaux de la semaine sont plus calmes.', timing: { options: [0, 1, 2, 3], label: (n) => (n === 0 ? 'Le jour même' : `${n} jour${n > 1 ? 's' : ''} après la visite`) } },
    { key: 'birthday_j30', label: 'Anniversaire J-30', desc: 'L’anniversaire fêté ici revient chaque année — relance toute seule au bon moment.', preview: 'L’anniversaire approche — on vous re-réserve la fête ? Gâteau et formule prêts.', star: true, timing: { options: [15, 21, 30, 45, 60], label: (n) => `${n} jours avant la date anniversaire` } },
    { key: 'reactivation', label: 'Réactivation dormants', desc: 'Clients fidèles plus vus depuis 2-3 mois : un rappel doux, plafonné par semaine.', preview: 'Ça fait un moment — bowling, laser et arcades vous attendent. Venez en semaine, c’est plus calme.', star: true, cap: { options: [5, 10, 20, 30, 50], label: (n) => `${n} envois max / semaine` } },
  ];
  const mkAuto = { loaded: false, loading: false, error: '', settings: null, defaults: {}, stats: {}, busyKey: '', editKey: '', editDraft: {} };

  async function loadStaffAutomations(force = false) {
    if (mkAuto.loading || (mkAuto.loaded && !force)) return;
    mkAuto.loading = true;
    mkAuto.error = '';
    try {
      const payload = await apiRequest(`/api/ops?action=automationSettings&centerId=${encodeURIComponent(state.currentCenterId || 'libramont')}`);
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

  /* ── Édition d'une séquence : sujet, message, timing, cap — tout modifiable
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
    const body = { action: 'automationSettings', key, centerId: state.currentCenterId || 'libramont' };
    if (String(d.subject || '').trim() && d.subject !== def.subject) body.subject = d.subject;
    if (String(d.body || '').trim() && d.body !== def.body) body.body = d.body;
    if (d.offsetDays !== undefined && Number(d.offsetDays) !== Number(def.offsetDays)) body.offsetDays = Number(d.offsetDays);
    if (d.cap !== undefined && Number(d.cap) !== Number(def.cap)) body.cap = Number(d.cap);
    const currentReviewUrl = (mkAuto.settings && mkAuto.settings[key] && mkAuto.settings[key].reviewUrl) || '';
    if (key === 'post_visit' && String(d.reviewUrl || '').trim() !== currentReviewUrl) body.reviewUrl = String(d.reviewUrl || '').trim();
    if (Object.keys(body).length === 3) { toast('Rien à enregistrer — tout est déjà au réglage par défaut.'); return; }
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
        body: JSON.stringify({ action: 'automationSettings', key, reset: true, centerId: state.currentCenterId || 'libramont' }),
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
        body: JSON.stringify({ action: 'automationSettings', key, enabled: !current, centerId: state.currentCenterId || 'libramont' }),
      });
      mkAuto.settings = payload.settings || mkAuto.settings;
      toast(!current ? 'Séquence activée — elle tourne toute seule.' : 'Séquence désactivée.');
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
    // (bouton tracké — les clics remontent dans le retour marketing).
    const reviewField = meta.key === 'post_visit' ? `
      <label class="mk-auto-edit-field">
        <span>Lien avis Google <small class="mk-auto-edit-hint">le mail ajoute un bouton « Laissez-nous un avis » — les clics sont comptés</small></span>
        <input value="${esc(d.reviewUrl || '')}" placeholder="https://g.page/r/…" oninput="pv2AutoEditField('reviewUrl', this.value)" aria-label="Lien de la fiche Google">
      </label>` : '';
    return `<div class="mk-auto-edit">
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
      <div class="mk-auto-edit-actions">
        <button type="button" class="pv2-btn sm" onclick="pv2AutoEditReset('${meta.key}')" ${busy ? 'disabled' : ''}>Réinitialiser</button>
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
    const previewText = (setting && setting.body) || meta.preview;
    return `<article class="mk-auto${enabled ? ' is-on' : ''}${editing ? ' is-editing' : ''}">
      <div class="mk-auto-head">
        <strong>${meta.star ? `<span class="mk-auto-star" title="Levier n°1 du secteur">${ci('star')}</span>` : ''}${esc(meta.label)}${modified ? '<span class="mk-auto-mod">modifié</span>' : ''}</strong>
        <button type="button" class="mk-switch${enabled ? ' is-on' : ''}" role="switch" aria-checked="${enabled}" aria-label="${esc(meta.label)}" onclick="toggleStaffAutomation('${meta.key}')" ${busy || !mkAuto.settings ? 'disabled' : ''}><span></span></button>
      </div>
      <p class="mk-auto-desc">${esc(meta.desc)}</p>
      <details class="mk-auto-preview"><summary>Aperçu du message</summary><p>${esc(previewText)}</p></details>
      <div class="mk-auto-foot">
        <span class="mk-auto-stats">${Number(stats.sent30d) || 0} envoyé${(Number(stats.sent30d) || 0) > 1 ? 's' : ''}${Number(stats.failed30d) ? ` · <span class="mk-auto-fail">${Number(stats.failed30d)} échec${Number(stats.failed30d) > 1 ? 's' : ''}</span>` : ''} (30 j)</span>
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
      ? pv2Mail.identities.map((i) => `<option value="${esc(String(i.id))}"${String(i.id) === String(d.identityId) ? ' selected' : ''}>${esc(i.label || i.email)} — ${esc(i.email)}</option>`).join('')
      : '<option value="">Expéditeur par défaut</option>';
    const templateOptions = [
      '<option value="">Partir de zéro…</option>',
      ...PV2_STARTERS.map((s) => `<option value="starter:${s.key}"${d.templateRef === `starter:${s.key}` ? ' selected' : ''}>${esc(s.name)}</option>`),
      ...pv2Mail.templates.map((t) => `<option value="tpl:${t.id}"${d.templateRef === `tpl:${t.id}` ? ' selected' : ''}>${esc(t.label || t.name || `Modèle ${t.id}`)}</option>`),
    ].join('');
    return `<section class="pv2-panel pv2-composer" aria-label="Nouveau message">
      <div class="pv2-panel-head has-sub">
        <div><h2>${d.replyTo ? 'Répondre' : 'Nouveau message'}</h2><p class="pv2-panel-sub">Choisis le client (ou tape une adresse), l'expéditeur, un modèle si tu veux — et envoie.</p></div>
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
    return `<section class="pv2-panel pv2-analyze" aria-label="Analyser un email reçu">
      <div class="pv2-panel-head has-sub">
        <div><h2>Analyser un email reçu</h2><p class="pv2-panel-sub">Colle un mail de ta boîte : l'agent dit ce que veut le client et prépare la réponse.</p></div>
        <button type="button" class="pv2-btn sm" onclick="pv2OpenAnalyze()">Fermer</button>
      </div>
      <div class="pv2-panel-body pv2-composer-grid">
        <label class="pv2-composer-field"><span>De (adresse du client)</span>
          <input id="pv2AnalyzeFrom" value="${esc(pv2Mail.analyzeDraft.from)}" placeholder="client@exemple.be" oninput="pv2AnalyzeField('from', this.value)">
        </label>
        <label class="pv2-composer-field pv2-composer-wide"><span>Texte du mail reçu</span>
          <textarea rows="6" placeholder="Colle ici le contenu du mail…" oninput="pv2AnalyzeField('body', this.value)">${esc(pv2Mail.analyzeDraft.body)}</textarea>
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
          <div><dt>De</dt><dd>${esc(row.payload?.from || row.recipient || '—')}</dd></div>
          <div><dt>Reçu</dt><dd>${esc(formatOpsTimestamp(row.receivedAt || row.createdAt || row.scheduledAt) || '—')}</dd></div>
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

  window.renderStaffEmailsPage = function (errorMessage = '') {
    const root = document.getElementById('staffEmailsPage');
    if (!root) return;
    if (!mkAuto.loaded && !mkAuto.loading) setTimeout(() => loadStaffAutomations(), 0);
    if (!pv2Seq.loaded && !pv2Seq.loading) setTimeout(() => loadPv2Sequences(), 0);
    // C14 : ops-console.js est injecté à la demande — requestOpsAdminLoad
    // (app-main) charge le script puis déclenche loadOpsAdmin.
    if (!opsAdminCache.loaded && !opsAdminCache.loading) setTimeout(() => requestOpsAdminLoad(false), 0);
    const everyRow = getStaffEmailRows();
    const inboundRows = everyRow.filter(pv2IsInbound);
    const allRows = everyRow.filter((row) => !pv2IsInbound(row));
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

    const tableHead = filter === 'inbound'
      ? '<thead><tr><th>De</th><th>Demande</th><th>Statut</th><th class="num">Reçu</th></tr></thead>'
      : '<thead><tr><th>Message</th><th>Modèle</th><th>Statut</th><th class="num">Date</th></tr></thead>';

    const tableRows = rows.slice(0, 80).map((row) => {
      if (filter === 'inbound') {
        const analysis = pv2InboxAnalysis(row);
        const replied = !!(row.payload && (row.payload.replyCommunicationId || row.payload.repliedAt));
        const intentLabel = analysis ? (analysis.intentLabel || PV2_INTENT_LABELS[analysis.intent] || analysis.intent) : '';
        return `<tr class="${selected && row.uid === selected.uid ? 'selected' : ''}" onclick="pv2SelectEmail('${escJs(row.uid)}')">
          <td><strong>${esc(analysis?.clientName || row.payload?.from || row.recipient || '—')}</strong><small class="pv2-cell-sub">${esc(row.subject || '')}</small></td>
          <td>${analysis ? `<span class="pv2-inbox-intent">${esc(intentLabel)}</span>${analysis.urgency === 'haute' ? ' <span class="pv2-inbox-urgent">Urgent</span>' : ''}<small class="pv2-cell-sub">${esc(analysis.summary || '')}</small>` : '<span class="pv2-chip">À analyser</span>'}</td>
          <td>${replied ? '<span class="pv2-chip green">Répondu</span>' : '<span class="pv2-chip blue">À répondre</span>'}</td>
          <td class="num">${esc(formatOpsTimestamp(row.receivedAt || row.createdAt || row.scheduledAt) || '—')}</td>
        </tr>`;
      }
      const meta = KIND_META[row.statusKind] || KIND_META.draft;
      return `<tr class="${selected && row.uid === selected.uid ? 'selected' : ''}" onclick="pv2SelectEmail('${escJs(row.uid)}')">
        <td><strong>${esc(row.subject || row.templateLabel || 'Message')}</strong><small class="pv2-cell-sub">${esc(row.recipient || '—')}</small></td>
        <td><span class="pv2-chip">${esc(row.templateLabel || row.templateId || '—')}</span></td>
        <td><span class="pv2-chip ${meta.tone}">${meta.label}</span></td>
        <td class="num">${esc(formatOpsTimestamp(row.sentAt || row.scheduledAt || row.createdAt) || '—')}</td>
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
          <div><dt>Destinataire</dt><dd>${esc(selected.recipient || '—')}</dd></div>
          <div><dt>Modèle</dt><dd>${esc(selected.templateLabel || selected.templateId || '—')}</dd></div>
          <div><dt>Canal</dt><dd>${esc(selected.channel || 'email')}</dd></div>
          <div><dt>Statut</dt><dd>${esc((KIND_META[selected.statusKind] || {}).label || selected.status || '—')}</dd></div>
          <div><dt>Programmé</dt><dd>${esc(formatOpsTimestamp(selected.scheduledAt) || '—')}</dd></div>
          ${selected.sentAt ? `<div><dt>Envoyé</dt><dd>${esc(formatOpsTimestamp(selected.sentAt))}</dd></div>` : ''}
          ${selected.attempts ? `<div><dt>Tentatives</dt><dd>${Number(selected.attempts)}</dd></div>` : ''}
        </div>
        ${selected.lastError ? `<div class="pv2-mail-error">${esc(selected.lastError)}</div>` : ''}
        <div>
          <div class="pv2-mail-preview-title">Aperçu</div>
          <div class="pv2-mail-preview">${esc(String(payload.textBody || selected.subject || 'Pas de contenu texte.'))}</div>
        </div>
      </div>`;

    root.innerHTML = `<div class="pv2-shell">
      ${bar({
        crumb: 'Clients & Marketing / Communications',
        title: 'Emails & relances',
        sub: `File opérationnelle · actualisé ${esc(updatedAt)}${errorMessage ? ` · <span style="color:var(--v2-red)">${esc(errorMessage)}</span>` : ''}`,
        actions: `
          <label class="pv2-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="14" height="14"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg><input value="${esc(state.staffEmailQuery || '')}" placeholder="Client, sujet, erreur…" oninput="setStaffEmailQuery(this.value)"></label>
          <button type="button" class="pv2-btn" onclick="requestOpsAdminLoad(true)">Actualiser</button>
          <button type="button" class="pv2-btn" onclick="exportStaffEmailsCsv()">Exporter</button>
          <button type="button" class="pv2-btn" onclick="pv2OpenSettings()">${ci('wrench')}Réglages</button>
          <button type="button" class="pv2-btn" onclick="pv2OpenAnalyze()">${ci('inbox')}Analyser un reçu</button>
          <button type="button" class="pv2-btn" onclick="requestOpsDispatch()">Envoyer la file</button>
          <button type="button" class="pv2-btn primary" onclick="pv2OpenComposer()">${ci('send')}Nouveau message</button>`,
      })}

      ${pv2Mail.composerOpen ? pv2ComposerPanel() : ''}
      ${pv2Mail.analyzeOpen ? pv2AnalyzePanel() : ''}
      ${pv2Settings.open ? pv2SettingsPanel() : ''}

      <section class="pv2-panel mk-auto-panel">
        <div class="pv2-panel-head has-sub">
          <div><h2>Séquences automatiques</h2><p class="pv2-panel-sub">Les emails qui partent tout seuls, au bon moment. Active, coupe, personnalise — ou crée les tiennes de A à Z.</p></div>
          <div class="pv2-panel-head-actions">
            ${mkAuto.error ? `<button type="button" class="pv2-btn" onclick="loadStaffAutomations(true)">Réessayer</button>` : ''}
            <button type="button" class="pv2-btn" onclick="pv2SeqNew()">+ Créer une séquence</button>
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

      <section class="pv2-pipeline">
        ${pipe('all', 'Total', allRows.length, 'toutes communications')}
        ${pipe('inbound', 'Reçus', inboundRows.length, inboundWaiting ? `${inboundWaiting} sans réponse` : 'boîte de réception')}
        ${pipe('queued', 'En file', metrics.queued, `${metrics.due || 0} prêt(s) à partir`)}
        ${pipe('sent', 'Envoyés', metrics.sent, `${metrics.deliveryRate || 0}% de réussite`)}
        ${pipe('failed', 'Échecs', metrics.failed, `${metrics.attempted || 0} tentative(s)`)}
        ${pipe('review', 'Validations', metrics.review, 'demandes staff')}
      </section>

      <section class="pv2-split">
        <article class="pv2-panel pv2-mail-list">
          <table class="pv2-table">
            ${tableHead}
            <tbody>${tableRows || `<tr><td colspan="4"><div class="pv2-empty"><strong>${filter === 'inbound' ? 'Aucun mail reçu' : 'File vide'}</strong>${filter === 'inbound' ? 'Colle un mail via « Analyser un reçu » — l\'agent prépare la réponse.' : 'Aucune communication pour ce filtre.'}</div></td></tr>`}</tbody>
          </table>
        </article>
        <article class="pv2-panel">
          <div class="pv2-panel-head"><h2>${esc(selected?.subject || 'Détail')}</h2></div>
          ${detail}
        </article>
      </section>
      ${typeof renderPv2RealCampaigns === 'function' ? renderPv2RealCampaigns() : ''}
    </div>`;
    mount(root, 'emails');
    if (typeof pv2Camp !== 'undefined' && !pv2Camp.loaded && !pv2Camp.loading) setTimeout(() => loadPv2Campaigns(), 0);
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
     MARKETING — le conseiller data (insight-only : il propose, tu appliques,
     il mesure). Les idées viennent du serveur (marketing_insights, générées
     chaque matin par le cron sur les chiffres réels + météo + calendrier).
     ======================================================================== */

  /* ==========================================================================
     MARKETING — « LE BRIEF » (refonte 2026-07-17)
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
    data: null, loading: false, error: '', period: 30,
    payOpen: false, radarOpen: null, openCard: null, cardNetwork: {},
    angleOpen: null, publishedAsk: null, moreOpen: false, receiptsAll: false,
    askFocus: false, busy: '', published: {}, dismissed: {},
    studioChannel: 'facebook', studioPacks: {}, studioBusy: false,
  };
  window.mkBrief = mkBrief;

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
      mkBrief.data = await apiRequest(`/api/ops?action=marketingBrief&days=${encodeURIComponent(mkBrief.period)}&centerId=${encodeURIComponent(state.currentCenterId || 'libramont')}`);
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
  // \uE000/\uE001, zone privée Unicode) AVANT l'échappement — sinon la regex
  // matchait les chiffres des entités HTML produites par esc()
  // (« &#39; » devenait « &#<strong>39</strong>; », bug du premier rendu).
  function brProse(text) {
    const marked = brFrDates(text).replace(/([+-]?\d[\d\u00a0\u202f.,\/]*(?:\s?(?:€|%|°C|mm|résas?\b|pers\.|personnes|visiteurs|venues?\b|j\b|h(?:\d{2})?\b))?)/g, '\uE000$1\uE001');
    return esc(marked).replace(/\uE000/g, '<strong class="br-num">').replace(/\uE001/g, '</strong>');
  }

  const BR_TRIGGER_LABELS = { pluie: 'pluie', chaleur: 'chaleur', creux: 'jour calme', jour_fort: 'jour fort', evenement: 'événement', vacances: 'vacances', concurrent: 'concurrence', demande: 'ta demande', plan: 'mon plan' };
  const BR_TRIGGER_TONE = { creux: 'danger', jour_fort: 'success' };
  const BR_NETWORK_LABELS = { facebook: 'Facebook', instagram: 'Instagram', story: 'Story', email: 'Email' };

  /* ── Z1 · La paie + le brief signé ── */

  function brZ1() {
    const b = mkBrief.data;
    if (!b) {
      return `<section class="br-z br-z1">
        ${mkBrief.error
          ? `<p class="br-error">${esc(mkBrief.error)} <button type="button" class="br-link" onclick="loadMarketingBrief(true)">Réessayer</button></p>`
          : '<div class="br-skel br-skel-pay"></div><div class="br-skel"></div><div class="br-skel"></div><div class="br-skel br-skel-short"></div>'}
      </section>`;
    }
    const p = b.paie;
    let payHtml;
    if (p.young) {
      payHtml = `<p class="br-pay">Encore trop tôt pour un chiffre honnête — premier bilan le ${esc(p.firstVerdictDate)}.</p>`;
    } else if (p.euros > 0) {
      payHtml = `<p class="br-pay">Tes publications sont liées à <span class="br-pay-num is-good">+${money(p.euros)}</span> de réservations ces ${p.days} derniers jours.</p>`;
    } else {
      payHtml = `<p class="br-pay">Tes <span class="br-pay-num">${p.sent}</span> messages sont partis — aucune réservation ne leur est encore liée sur ${p.days} jours.</p>`;
    }
    const periods = [7, 30, 90].map((days) => `<button type="button" class="br-toggle ${mkBrief.period === days ? 'active' : ''}" onclick="mkBrPeriod(${days})">${days} j</button>`).join('<span class="br-dot">·</span>');
    const sources = (p.sources || []).map((source) => {
      const share = p.euros > 0 ? Math.round((source.revenue / p.euros) * 100) : 0;
      return `<div class="br-ticket"><span class="br-ticket-label">${esc(source.label)}</span><span class="br-ticket-fill"></span><span class="br-ticket-val">${share} % · ${money(source.revenue)}</span></div>`;
    }).join('');
    const detail = mkBrief.payOpen && !p.young ? `<div class="br-pay-detail">
      ${sources || '<p class="br-quiet">Pas encore de venue attribuée sur la période.</p>'}
      <div class="br-ticket br-ticket-sub"><span class="br-ticket-label">venues liées</span><span class="br-ticket-fill"></span><span class="br-ticket-val">${p.venues}</span></div>
      <div class="br-ticket br-ticket-sub"><span class="br-ticket-label">clics vers ta fiche Google</span><span class="br-ticket-fill"></span><span class="br-ticket-val">${p.reviewClicks}</span></div>
      <p class="br-method">Une venue compte pour le dernier message qu'elle a vu dans les 60 jours.</p>
    </div>` : '';
    return `<section class="br-z br-z1">
      ${payHtml}
      <div class="br-pay-controls">${periods}${p.young ? '' : `<button type="button" class="br-link" onclick="mkBrPayDetail()">${mkBrief.payOpen ? 'Masquer le détail' : 'Voir le détail'}</button>`}</div>
      ${detail}
      <div class="br-memo">
        ${b.brief.degraded ? '<p class="br-degraded">Je tourne en mode simple ce matin — les chiffres sont exacts, les phrases moins polies.</p>' : ''}
        <p class="br-memo-text">${brProse(b.brief.text)}</p>
        <p class="br-sign">— ton employé marketing · ${esc(new Date(b.generatedAt).toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' }))}, ${esc(new Date(b.generatedAt).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }))}</p>
      </div>
    </section>`;
  }

  /* ── Le pouls business (KPIs réels du centre) — la page n'est jamais vide,
     elle montre l'activité concrète : CA, visiteurs, réservations à venir. ── */
  function brPulse() {
    const b = mkBrief.data;
    if (!b || !b.pulse) return '';
    const pl = b.pulse;
    const tile = (value, label, foot) => `<div class="br-kpi"><span class="br-kpi-val">${value}</span><span class="br-kpi-label">${esc(label)}</span>${foot ? `<span class="br-kpi-foot">${esc(foot)}</span>` : ''}</div>`;
    const bestFoot = pl.bestDay ? `record : ${money(pl.bestDay.revenue)} le ${brFrDay(pl.bestDay.date)}` : '';
    return `<section class="br-z br-pulse-z">
      <h2 class="br-zt">Ton activité</h2>
      <div class="br-pulse">
        ${tile(money(pl.revenue30), 'chiffre d’affaires', '30 derniers jours')}
        ${tile(`${pl.visitors30}`, 'visiteurs', '30 derniers jours')}
        ${tile(money(pl.avgBasket), 'panier moyen', 'par visiteur')}
        ${tile(`${pl.upcomingPax}`, 'déjà attendus', `sur les 14 prochains jours${pl.reservedRevenue ? ` · ${money(pl.reservedRevenue)}` : ''}`)}
        ${pl.bestDay ? tile(`${pl.bestDay.visitors}`, 'meilleure journée', bestFoot) : ''}
      </div>
    </section>`;
  }

  window.mkBrPeriod = async function (days) {
    mkBrief.period = Number(days) || 30;
    renderStaffCampaignsPage();
    // Refetch de la paie seule (léger) — le reste du mémo ne dépend pas de la période.
    try {
      const roi = await apiRequest(`/api/ops?action=marketingRoi&days=${encodeURIComponent(mkBrief.period)}&centerId=${encodeURIComponent(state.currentCenterId || 'libramont')}`);
      if (mkBrief.data) {
        mkBrief.data.paie = {
          ...mkBrief.data.paie,
          euros: roi.revenue, venues: roi.conversions, sent: roi.sent, reviewClicks: roi.reviewClicks, days: roi.days,
          sources: (roi.bySource || []).filter((s) => s.sent > 0).sort((a, b) => b.revenue - a.revenue),
          young: roi.sent === 0,
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

  function brZ2() {
    const b = mkBrief.data;
    if (!b) return `<section class="br-z"><h2 class="br-zt">Les 14 prochains jours</h2><div class="br-radar br-radar-skel">${'<span class="br-cell br-cell-skel"></span>'.repeat(14)}</div></section>`;
    if (!b.radar || !b.radar.length) {
      return `<section class="br-z"><h2 class="br-zt">Les 14 prochains jours</h2><p class="br-quiet">Je n'ai pas de prévision fiable aujourd'hui — je réessaie cette nuit.</p></section>`;
    }
    const cells = b.radar.map((day) => {
      const isToday = day.date === b.today;
      const open = mkBrief.radarOpen === day.date;
      const temp = day.tmax !== null && day.tmax !== undefined ? `${Math.round(day.tmax)}°` : '';
      return `<button type="button" class="br-cell lv-${esc(day.level)} ${isToday ? 'is-today' : ''} ${open ? 'is-open' : ''}" aria-expanded="${open}" onclick="mkBrRadar('${escJs(day.date)}')" title="${esc(day.explanation)}">
        <span class="br-cell-day">${isToday ? 'auj.' : `${BR_DOW[day.dow]} ${day.date.slice(8, 10)}`}</span>
        ${brWeatherIcon(day)}
        <span class="br-cell-temp">${temp}</span>
        <span class="br-cell-resa">${day.resaCount ? `${day.resaCount} <em>rés.</em>` : ''}</span>
        ${day.event ? '<span class="br-cell-event" aria-hidden="true"></span>' : ''}
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
      const linked = openDay.propositionKey && (b.propositions || []).some((p) => p.key === openDay.propositionKey && !mkBrief.dismissed[p.key]);
      const canFill = (openDay.level === 'creux' || openDay.level === 'calme') && !linked;
      explain = `<div class="br-radar-explain">
        <span>${brProse(openDay.explanation)}</span>
        ${linked ? `<button type="button" class="br-link" onclick="mkBrGoCard('${escJs(openDay.propositionKey)}')">Voir la proposition →</button>` : ''}
        ${canFill ? `<button type="button" class="br-link br-link-accent" onclick="mkBrRadarFill('${escJs(openDay.date)}')" ${mkBrief.busy === `fill:${openDay.date}` ? 'disabled' : ''}>${mkBrief.busy === `fill:${openDay.date}` ? 'je prépare…' : 'Prépare-moi un post pour remplir ce jour'}</button>` : ''}
      </div>`;
    }
    return `<section class="br-z">
      <h2 class="br-zt">Les 14 prochains jours</h2>
      <div class="br-radar">${cells}</div>
      ${summary ? `<p class="br-radar-sum">${brProse(summary)}</p>` : ''}
      ${explain}
    </section>`;
  }

  window.mkBrRadar = function (date) {
    mkBrief.radarOpen = mkBrief.radarOpen === date ? null : date;
    renderStaffCampaignsPage();
  };
  window.mkBrGoCard = function (key) {
    mkBrief.openCard = key;
    renderStaffCampaignsPage();
    setTimeout(() => {
      const el = document.querySelector(`[data-br-card="${CSS.escape(key)}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('br-flash');
        setTimeout(() => el.classList.remove('br-flash'), 1100);
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
        body: JSON.stringify({ action: 'propositionCreate', centerId: state.currentCenterId || 'libramont', targetDate: date, trigger: 'creux', brief: '' }),
      });
      await loadMarketingBrief(true);
      toast('C\'est prêt — regarde plus bas.');
    } catch (error) {
      toast(error.message || 'Je n\'ai pas réussi — réessaie.');
    } finally {
      mkBrief.busy = '';
      scheduleCampaignsRender();
    }
  };

  /* ── Z3 · Prêt pour toi (la file de Propositions) ── */

  function brVisiblePropositions() {
    const b = mkBrief.data;
    if (!b) return [];
    return (b.propositions || []).filter((p) => !mkBrief.dismissed[p.key]);
  }

  function brCard(p) {
    const published = mkBrief.published[p.key];
    if (published) {
      return `<article class="br-card is-published" data-br-card="${esc(p.key)}"><p class="br-published-line">Publié ✓ — je mesure pendant 14 jours.</p></article>`;
    }
    const open = mkBrief.openCard === p.key;
    const tone = BR_TRIGGER_TONE[p.trigger] || 'accent';
    const dueLabel = p.dueDate ? (p.dueDate === (mkBrief.data && mkBrief.data.today) ? 'aujourd\'hui' : `avant ${brFrDay(p.dueDate)}`) : '';
    // Une « offre »/récolte est un rappel terrain (checklist), pas une
    // publication : ni « à publier », ni onglets réseau, ni mesure J+14.
    const isOffre = p.kind === 'offre';
    const meta = [dueLabel ? `${isOffre ? 'à faire' : 'à publier'} ${dueLabel}` : '', BR_TRIGGER_LABELS[p.trigger] || ''].filter(Boolean).join(' · ');
    const verb = p.kind === 'email' ? 'Voir l\'email' : (isOffre ? 'Voir la checklist' : (p.trigger === 'concurrent' ? 'Voir la riposte' : 'Voir le post'));
    let body = '';
    if (open && isOffre) {
      const note = (p.networks && (p.networks.interne || p.networks.facebook) || {}).text || p.why || '';
      body = `<div class="br-paper">${esc(note)}</div>
        <div class="br-card-actions">
          <button type="button" class="pv2-btn primary" onclick="mkBrDismiss('${escJs(p.key)}')">${ci('check')}C’est noté</button>
        </div>`;
    } else if (open) {
      const networks = (mkBrief.data.networks || []).filter(() => p.kind !== 'email');
      const current = mkBrief.cardNetwork[p.key] || p.network || (networks[0] || 'facebook');
      const entry = (p.networks || {})[current] || null;
      const generating = mkBrief.busy === `net:${p.key}:${current}`;
      const netTabs = p.kind === 'email' ? '' : `<div class="br-nets">${networks.map((network) => `<button type="button" class="br-net ${current === network ? 'active' : ''}" onclick="mkBrNetwork('${escJs(p.key)}', '${escJs(network)}')">${BR_NETWORK_LABELS[network] || network}</button>`).join('')}</div>`;
      const paper = generating
        ? `<div class="br-paper br-paper-shimmer"><p class="br-quiet">je l'adapte pour ${BR_NETWORK_LABELS[current] || current}…</p></div>`
        : (entry && entry.text
          ? `<div class="br-paper">${esc(entry.text)}</div>`
          : `<div class="br-paper"><p class="br-quiet">Le texte arrive — réessaie dans un instant. <button type="button" class="br-link" onclick="mkBrNetwork('${escJs(p.key)}', '${escJs(current)}', true)">Réessayer</button></p></div>`);
      const photoIdea = (entry && entry.photoIdea) || p.photoIdea;
      const bestSlot = (entry && entry.bestSlot) || p.bestSlot;
      const imagePrompt = (entry && entry.imagePrompt) || p.imagePrompt;
      const under = [
        photoIdea ? `<p class="br-under">Idée photo : ${esc(photoIdea)}</p>` : '',
        bestSlot ? `<p class="br-under br-under-mono">Meilleur moment : ${esc(bestSlot)}</p>` : '',
        imagePrompt ? `<details class="br-prompt"><summary>prompt pour une image IA</summary><div class="br-prompt-text">${esc(imagePrompt)}</div><button type="button" class="br-link" onclick="mkBrCopyPrompt('${escJs(p.key)}')">Copier</button></details>` : '',
      ].join('');
      const angleOpen = mkBrief.angleOpen === p.key;
      const askPublished = mkBrief.publishedAsk === p.key;
      const footer = p.kind === 'email'
        ? `<div class="br-card-actions"><button type="button" class="pv2-btn primary" onclick="state.staffMenuPage = 'emails'; save(); renderStaff();">Ouvrir dans Emails</button><button type="button" class="br-link br-link-faint" onclick="mkBrDismiss('${escJs(p.key)}')">Pas maintenant</button></div>`
        : `<div class="br-card-actions">
            <button type="button" class="pv2-btn primary" onclick="mkBrCopy('${escJs(p.key)}')" ${generating || !(entry && entry.text) ? 'disabled' : ''}>${ci('copy')}Copier le post</button>
            <button type="button" class="br-link" onclick="mkBrAngle('${escJs(p.key)}')">Autre angle</button>
            <button type="button" class="br-link br-link-faint" onclick="mkBrDismiss('${escJs(p.key)}')">Pas maintenant</button>
          </div>
          ${angleOpen ? `<div class="br-angle"><input id="brAngle-${esc(p.key)}" class="br-angle-input" placeholder="précise l'angle (optionnel) : « spécial ados », « plus court »…"><button type="button" class="br-link br-link-accent" onclick="mkBrRegen('${escJs(p.key)}')" ${mkBrief.busy === `regen:${p.key}` ? 'disabled' : ''}>${mkBrief.busy === `regen:${p.key}` ? 'je réécris…' : 'Refaire'}</button></div>` : ''}
          ${askPublished ? `<div class="br-published-ask" role="status">Publié ? <button type="button" class="br-link br-link-accent" onclick="mkBrPublished('${escJs(p.key)}', true)">Oui</button><button type="button" class="br-link" onclick="mkBrPublished('${escJs(p.key)}', false)">Pas encore</button></div>` : ''}`;
      body = `${netTabs}${paper}${under}${footer}<div class="br-cycle" aria-hidden="true"><span class="on"></span><span></span><span></span></div>`;
    }
    return `<article class="br-card tone-${tone} ${open ? 'is-open' : ''}" data-br-card="${esc(p.key)}">
      <p class="br-card-why">${brProse(p.whyShort || p.why)}</p>
      <p class="br-card-meta">${esc(meta)}${open ? '' : ` — <button type="button" class="br-link" onclick="mkBrOpenCard('${escJs(p.key)}')">${verb}</button>`}</p>
      ${body}
    </article>`;
  }

  function brZ3() {
    const b = mkBrief.data;
    if (!b) return `<section class="br-z"><h2 class="br-zt">Prêt pour toi</h2><div class="br-skel br-skel-card"></div><div class="br-skel br-skel-card"></div></section>`;
    const all = brVisiblePropositions();
    const visible = mkBrief.moreOpen ? all : all.slice(0, 3);
    const rest = all.length - visible.length;
    const creating = mkBrief.busy === 'ask';
    const chips = [];
    for (const day of (b.radar || [])) {
      if (chips.length >= 2) break;
      if ((day.level === 'creux' || day.level === 'calme') && !day.propositionKey) chips.push({ label: `Remplir ${brFrDay(day.date).split(' ')[0]} ${day.date.slice(8, 10)}`, text: `un post pour remplir ${brFrDay(day.date)}` });
      else if (day.precipMm !== null && day.precipMm >= 10) chips.push({ label: `Profiter de la pluie de ${brFrDay(day.date).split(' ')[0]}`, text: `un post sur la pluie annoncée ${brFrDay(day.date)}` });
    }
    chips.push({ label: 'Idée libre', text: '' });
    return `<section class="br-z">
      <h2 class="br-zt">Prêt pour toi</h2>
      ${creating ? '<article class="br-card br-card-skel"><div class="br-skel"></div><div class="br-skel br-skel-short"></div></article>' : ''}
      ${visible.length || creating ? visible.map(brCard).join('') : `<p class="br-quiet">Rien d'urgent aujourd'hui. Je surveille la météo et tes réservations — je te préviens dès que je vois un creux.</p>`}
      ${rest > 0 ? `<button type="button" class="br-link" onclick="mkBrMore()">+ ${rest} autre${rest > 1 ? 's' : ''} pour plus tard</button>` : ''}
      <div class="br-ask">
        <input id="brAskInput" class="br-ask-input" placeholder="Demande-moi quelque chose — « un post pour la soirée fluo de samedi »" onfocus="mkBrAskFocus(true)">
        <button type="button" class="pv2-btn primary" onclick="mkBrAsk()" ${creating ? 'disabled' : ''}>${creating ? 'je prépare…' : 'Demander'}</button>
      </div>
      ${mkBrief.askFocus ? `<div class="br-chips">${chips.map((chip) => `<button type="button" class="br-chip" onclick="mkBrChip('${escJs(chip.text)}')">${esc(chip.label)}</button>`).join('')}</div>` : ''}
    </section>`;
  }

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
        body: JSON.stringify({ action: 'propositionAction', propAction: 'variante', network, centerId: state.currentCenterId || 'libramont', ...brPropPayload(p) }),
      });
      p.id = payload.result.id;
      p.networks = { ...(p.networks || {}), [network]: payload.result.entry };
    } catch (error) {
      toast(error.message || 'Le texte n\'est pas venu — réessaie.');
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
      toast('Copie auto impossible — sélectionne le texte à la main.');
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
    // évite d'insérer deux lignes via ensurePersisted — mitigation finding 5).
    if (mkBrief.published[key] || mkBrief.busy === `pub:${key}`) { renderStaffCampaignsPage(); return; }
    const p = brVisiblePropositions().find((item) => item.key === key);
    if (!p) return;
    mkBrief.busy = `pub:${key}`;
    mkBrief.published[key] = true; // optimiste : la carte se compacte tout de suite
    renderStaffCampaignsPage();
    try {
      await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'propositionAction', propAction: 'publiee', centerId: state.currentCenterId || 'libramont', ...brPropPayload(p) }),
      });
      toast('Noté — verdict dans 14 jours.');
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
        body: JSON.stringify({ action: 'propositionAction', propAction: 'refusee', centerId: state.currentCenterId || 'libramont', ...brPropPayload(p) }),
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
        body: JSON.stringify({ action: 'propositionAction', propAction: 'autre_angle', network, angle, centerId: state.currentCenterId || 'libramont', ...brPropPayload(p) }),
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

  window.mkBrAskFocus = function (on) {
    mkBrief.askFocus = Boolean(on);
    renderStaffCampaignsPage();
    if (on) setTimeout(() => { const el = document.getElementById('brAskInput'); if (el) el.focus(); }, 30);
  };
  window.mkBrChip = function (text) {
    const input = document.getElementById('brAskInput');
    if (input) { input.value = text; input.focus(); }
  };
  window.mkBrAsk = async function () {
    if (mkBrief.busy) return;
    const brief = (document.getElementById('brAskInput') || {}).value || '';
    if (!brief.trim()) { toast('Dis-moi ce que tu veux, même en trois mots.'); return; }
    mkBrief.busy = 'ask';
    mkBrief.askFocus = false;
    renderStaffCampaignsPage();
    try {
      await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'propositionCreate', brief, centerId: state.currentCenterId || 'libramont' }),
      });
      await loadMarketingBrief(true);
      toast('C\'est prêt — première carte de la file.');
    } catch (error) {
      toast(error.message || 'Je n\'ai pas réussi — réessaie.');
    } finally {
      mkBrief.busy = '';
      scheduleCampaignsRender();
    }
  };

  /* ── Le studio : un pack de contenu complet par réseau, à la demande ── */
  const BR_STUDIO_CHANNELS = [{ key: 'facebook', label: 'Facebook' }, { key: 'instagram', label: 'Instagram' }, { key: 'tiktok', label: 'TikTok' }, { key: 'linkedin', label: 'LinkedIn' }];

  function brStudio() {
    const pack = mkBrief.studioPacks[mkBrief.studioChannel] || null;
    const tabs = BR_STUDIO_CHANNELS.map((c) => `<button type="button" class="br-net ${mkBrief.studioChannel === c.key ? 'active' : ''}" onclick="mkBrStudioChannel('${escJs(c.key)}')">${c.label}</button>`).join('');
    const block = (label, field, text, opts) => {
      if (!text) return '';
      const o = opts || {};
      return `<div class="br-st-block"><div class="br-st-head"><span class="br-st-label">${esc(label)}</span>${o.note ? `<small>${esc(o.note)}</small>` : ''}<button type="button" class="br-link br-st-copy" onclick="mkBrStudioCopy('${escJs(field)}')">Copier</button></div><div class="br-paper ${o.mono ? 'br-st-mono' : ''}">${esc(text)}</div></div>`;
    };
    let body;
    if (mkBrief.studioBusy) {
      body = '<div class="br-paper br-paper-shimmer"><p class="br-quiet">j’écris tout le pack — version longue, courte, story, idée photo…</p></div>';
    } else if (!pack) {
      body = '<p class="br-quiet">Choisis un réseau et je te prépare un pack complet : version longue, version courte, story, idée photo, prompt d’image IA et hashtags — écrit sur l’angle du jour.</p>';
    } else {
      const q = pack.quality || {};
      body = `${q.score ? `<p class="br-st-badge">${q.status === 'ready' ? 'Prêt à publier' : 'À relire'} · angle : ${esc(pack.theme || '')}</p>` : ''}
        ${block('Version longue', 'long', pack.long)}
        ${block('Version courte', 'short', pack.short)}
        ${block(mkBrief.studioChannel === 'linkedin' ? 'Variante' : 'Story', 'story', pack.story)}
        ${block('Hashtags', 'hashtags', (pack.hashtags || []).join(' '))}
        ${block('Idée photo (à shooter sur place)', 'photoIdea', pack.photoIdea)}
        ${block('Prompt d’image IA', 'aiImagePrompt', pack.aiImagePrompt, { mono: true, note: 'en anglais — pour ton générateur d’images' })}
        <p class="br-method">Meilleur moment : ${esc(pack.bestTime || '—')}. Chaque version est notée par le contrôle qualité du centre — je réécris jusqu’à ce que ça passe.</p>`;
    }
    return `<section class="br-z">
      <h2 class="br-zt">Le studio — écris pour chaque réseau</h2>
      <div class="br-st-bar">
        <div class="br-nets">${tabs}</div>
        <div class="br-st-gen">
          <input id="brStudioBrief" class="br-ask-input" placeholder="Angle (optionnel) : « anniversaires ados », « soirée fluo »…">
          <button type="button" class="pv2-btn primary" onclick="mkBrStudioGen()" ${mkBrief.studioBusy ? 'disabled' : ''}>${mkBrief.studioBusy ? 'j’écris…' : (pack ? 'Régénérer' : 'Générer le pack')}</button>
        </div>
      </div>
      ${body}
    </section>`;
  }

  window.mkBrStudioChannel = function (key) {
    mkBrief.studioChannel = BR_STUDIO_CHANNELS.some((c) => c.key === key) ? key : 'facebook';
    renderStaffCampaignsPage();
  };
  window.mkBrStudioGen = async function () {
    if (mkBrief.studioBusy) return;
    const brief = (document.getElementById('brStudioBrief') || {}).value || '';
    mkBrief.studioBusy = true;
    renderStaffCampaignsPage();
    try {
      const payload = await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'studioGenerate', centerId: state.currentCenterId || 'libramont', platform: mkBrief.studioChannel, brief }),
      });
      mkBrief.studioPacks = { ...mkBrief.studioPacks, [mkBrief.studioChannel]: payload.pack };
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

  /* ── Z4 · Ce que ça a donné (les reçus) ── */

  function brZ4() {
    const b = mkBrief.data;
    if (!b) return `<section class="br-z"><h2 class="br-zt">Ce que ça a donné</h2><div class="br-skel"></div><div class="br-skel"></div></section>`;
    const receipts = b.receipts || [];
    const visible = mkBrief.receiptsAll ? receipts : receipts.slice(0, 5);
    const rows = visible.map((receipt) => `<div class="br-ticket br-receipt tone-${esc(receipt.tone)}">
      <span class="br-ticket-label">${esc(brFrDates(receipt.label))}</span>
      <span class="br-ticket-fill"></span>
      <span class="br-ticket-val">${esc(receipt.result)}</span>
      ${receipt.redoable ? `<button type="button" class="br-link" onclick="mkBrRedo(${Number(receipt.id)})">On le refait ?</button>` : ''}
    </div>`).join('');
    return `<section class="br-z">
      <h2 class="br-zt">Ce que ça a donné</h2>
      ${rows || '<p class="br-quiet">Je mesure chaque publication pendant 14 jours — les premiers verdicts arrivent ici.</p>'}
      ${receipts.length > 5 && !mkBrief.receiptsAll ? `<button type="button" class="br-link" onclick="mkBrReceiptsAll()">Tout voir (${receipts.length})</button>` : ''}
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
        body: JSON.stringify({ action: 'insightRedo', id: Number(id), centerId: state.currentCenterId || 'libramont' }),
      });
      await loadMarketingBrief(true);
      toast('Je l\'ai remis dans la file — première position.');
    } catch (error) {
      toast(error.message || 'Impossible de le relancer.');
    }
  };

  /* ── Footer · Ce que je surveille (la veille) ── */

  const mkComp = { data: null, loading: false, busy: false };
  window.mkComp = mkComp;
  async function loadCompetitors(force = false) {
    if (mkComp.loading || (mkComp.data && !force)) return;
    mkComp.loading = true;
    try {
      const payload = await apiRequest(`/api/ops?action=competitors&centerId=${encodeURIComponent(state.currentCenterId || 'libramont')}`);
      mkComp.data = payload.competitors || [];
    } catch (error) { mkComp.data = []; } finally {
      mkComp.loading = false;
      scheduleCampaignsRender();
    }
  }
  window.loadCompetitors = loadCompetitors;

  function brFooter() {
    const b = mkBrief.data;
    const count = b ? b.veille.count : 0;
    const hasNews = b && b.veille.changed.length > 0;
    const rows = (mkComp.data || []).map((competitor) => {
      let host = '';
      try { host = competitor.websiteUrl ? new URL(competitor.websiteUrl).hostname.replace(/^www\./, '') : ''; } catch (error) { host = ''; }
      return `<div class="br-veille-row">
        <span class="br-veille-name">${esc(competitor.name)}${host ? ` <em>${esc(host)}</em>` : ''}</span>
        <span class="br-veille-status">${competitor.lastCheckedAt ? `inspecté le ${esc(String(competitor.lastCheckedAt).slice(0, 10)).slice(8, 10)}/${esc(String(competitor.lastCheckedAt).slice(5, 7))}${competitor.lastDiff ? ` — ${esc(competitor.lastDiff)}` : ''}` : 'première inspection cette nuit'}</span>
        <button type="button" class="br-link br-link-faint" onclick="mkCompDelete(${Number(competitor.id)})">Retirer</button>
      </div>`;
    }).join('');
    return `<details class="br-veille" data-mk-open="veille" ${hasNews ? 'open' : ''} ontoggle="if (this.open && typeof loadCompetitors === 'function') loadCompetitors()">
      <summary>Je surveille ${count} concurrent${count > 1 ? 's' : ''}${hasNews ? '<span class="br-veille-dot" aria-hidden="true"></span>' : ''}</summary>
      <div class="br-veille-body">
        ${rows || (mkComp.loading ? '<p class="br-quiet">un instant…</p>' : '<p class="br-quiet">Ajoute les centres qui te prennent des clients — j\'inspecte leurs sites chaque nuit.</p>')}
        <div class="br-veille-add">
          <input id="brCompName" class="br-ask-input" placeholder="Nom (ex. Bowling de Bastogne)" maxlength="80">
          <input id="brCompSite" class="br-ask-input" placeholder="Site — https://…" maxlength="300">
          <button type="button" class="br-link br-link-accent" onclick="mkCompSave()" ${mkComp.busy ? 'disabled' : ''}>Suivre</button>
        </div>
      </div>
    </details>`;
  }

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
        body: JSON.stringify({ action: 'competitorSave', centerId: state.currentCenterId || 'libramont', competitor: { name, websiteUrl } }),
      });
      toast('Je le surveille — première inspection cette nuit.');
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
        body: JSON.stringify({ action: 'competitorDelete', centerId: state.currentCenterId || 'libramont', id: Number(id) }),
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
      const payload = await apiRequest(`/api/ops?action=listCampaigns&centerId=${encodeURIComponent(state.currentCenterId || 'libramont')}`);
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
        const payload = await apiRequest(`/api/ops?action=campaignAudience&segment=${encodeURIComponent(segment)}&centerId=${encodeURIComponent(state.currentCenterId || 'libramont')}`);
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
      if (typeof toast === 'function') toast("Audience en cours de calcul — attends le nombre de destinataires avant d'envoyer.");
      return;
    }
    if (mode === 'now' && !window.confirm(`Envoyer maintenant à ${count} destinataire(s) du segment sélectionné ?`)) return;
    if (mode === 'schedule' && !form.scheduledAt) { if (typeof toast === 'function') toast('Choisis la date et l\'heure d\'envoi.'); return; }
    pv2Camp.busy = true;
    if (button) button.disabled = true;
    renderStaffEmailsPage();
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
    if (!mkBrief.data && !mkBrief.loading && !mkBrief.error) setTimeout(() => loadMarketingBrief(), 0);
    const b = mkBrief.data;
    const lastPass = b
      ? `dernier passage ${new Date(b.generatedAt).toLocaleDateString('fr-BE', { weekday: 'long' })} à ${new Date(b.generatedAt).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}`
      : 'je prépare ton brief…';

    root.innerHTML = `<div class="pv2-shell br-shell">
      <section class="br-head">
        <h1>Marketing</h1>
        <p class="br-head-sub">Ton employé marketing · ${esc(lastPass)}</p>
      </section>
      ${brZ1()}
      ${brPulse()}
      ${brZ2()}
      ${brZ3()}
      ${brStudio()}
      ${brZ4()}
      ${brFooter()}
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
    // Fusion Clients+Groupes : « groups » n'est plus une page — accès historique
    // (hash, état sauvegardé) → on bascule vers Clients, segment « À venir ».
    state.staffMenuPage = 'clients';
    state.staffClientSegment = 'avenir';
    save();
    renderStaff();
  };

  /* ==========================================================================
     COMMAND PALETTE — Ctrl/Cmd+K
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

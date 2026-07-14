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
      ? `<button type="button" class="pv2-btn" onclick="composeStaffClientEmail('${escJs(selected.email)}','${escJs(selected.name || '')}')">${ci('mail')}Nouveau message</button>`
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
        ${selected.email ? `<button type="button" class="crm-icon-btn" title="Renvoyer" aria-label="Renvoyer" onclick="composeStaffClientEmail('${escJs(selected.email)}','${escJs(selected.name || '')}')">${ci('refresh')}</button>` : ''}
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
            ${selected.email ? `<button type="button" class="pv2-btn" onclick="composeStaffClientEmail('${escJs(selected.email)}','${escJs(selected.name || '')}')">${ci('mail')}Message</button>` : ''}
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

  /* ── Séquences automatiques : les emails qui partent tout seuls, pilotés
     ON/OFF depuis ici (contrat automationSettings). Le levier n°1 du secteur
     (anniversaire J-30) vit ici. ── */
  const AUTOMATION_META = [
    { key: 'confirmation', label: 'Confirmation', desc: 'Confirme la réservation au client dès qu’elle est validée.', preview: 'Votre réservation est confirmée — date, heure, formule et infos pratiques.' },
    { key: 'reminder_48h', label: 'Rappel 48 h', desc: 'Rappelle la venue 2 jours avant — moins de no-show.', preview: 'Rappel de votre venue après-demain, avec l’heure d’arrivée conseillée.' },
    { key: 'post_visit', label: 'Merci post-visite', desc: 'Remercie après la visite et invite à revenir.', preview: 'Merci de votre visite ! Une prochaine fois ? Les créneaux de la semaine sont plus calmes.' },
    { key: 'birthday_j30', label: 'Anniversaire J-30', desc: 'L’anniversaire fêté ici revient chaque année — relance toute seule au bon moment, 30 jours avant.', preview: 'L’anniversaire approche — on vous re-réserve la fête ? Gâteau et formule prêts.', star: true },
    { key: 'reactivation', label: 'Réactivation dormants', desc: 'Clients fidèles plus vus depuis 2-3 mois : un rappel doux, max 20/semaine.', preview: 'Ça fait un moment — bowling, laser et arcades vous attendent. Venez en semaine, c’est plus calme.', star: true },
  ];
  const mkAuto = { loaded: false, loading: false, error: '', settings: null, stats: {}, busyKey: '' };

  async function loadStaffAutomations(force = false) {
    if (mkAuto.loading || (mkAuto.loaded && !force)) return;
    mkAuto.loading = true;
    mkAuto.error = '';
    try {
      const payload = await apiRequest(`/api/ops?action=automationSettings&centerId=${encodeURIComponent(state.currentCenterId || 'libramont')}`);
      mkAuto.settings = payload.settings || {};
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

  function mkAutoCard(meta) {
    const setting = mkAuto.settings ? mkAuto.settings[meta.key] : null;
    const enabled = !!(setting && setting.enabled);
    const stats = mkAuto.stats[meta.key] || {};
    const busy = mkAuto.busyKey === meta.key;
    return `<article class="mk-auto${enabled ? ' is-on' : ''}">
      <div class="mk-auto-head">
        <strong>${meta.star ? `<span class="mk-auto-star" title="Levier n°1 du secteur">${ci('star')}</span>` : ''}${esc(meta.label)}</strong>
        <button type="button" class="mk-switch${enabled ? ' is-on' : ''}" role="switch" aria-checked="${enabled}" aria-label="${esc(meta.label)}" onclick="toggleStaffAutomation('${meta.key}')" ${busy || !mkAuto.settings ? 'disabled' : ''}><span></span></button>
      </div>
      <p class="mk-auto-desc">${esc(meta.desc)}</p>
      <details class="mk-auto-preview"><summary>Aperçu du message</summary><p>${esc(meta.preview)}</p></details>
      <div class="mk-auto-stats">${Number(stats.sent30d) || 0} envoyé${(Number(stats.sent30d) || 0) > 1 ? 's' : ''}${Number(stats.failed30d) ? ` · <span class="mk-auto-fail">${Number(stats.failed30d)} échec${Number(stats.failed30d) > 1 ? 's' : ''}</span>` : ''} (30 j)</div>
    </article>`;
  }

  window.renderStaffEmailsPage = function (errorMessage = '') {
    const root = document.getElementById('staffEmailsPage');
    if (!root) return;
    if (!mkAuto.loaded && !mkAuto.loading) setTimeout(() => loadStaffAutomations(), 0);
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
        <td><strong>${esc(row.subject || row.templateLabel || 'Message')}</strong><small class="pv2-cell-sub">${esc(row.recipient || '—')}</small></td>
        <td><span class="pv2-chip">${esc(row.templateLabel || row.templateId || '—')}</span></td>
        <td><span class="pv2-chip ${meta.tone}">${meta.label}</span></td>
        <td class="num">${esc(formatOpsTimestamp(row.sentAt || row.scheduledAt || row.createdAt) || '—')}</td>
      </tr>`;
    }).join('');

    const payload = selected?.payload || {};
    const detail = selected ? `
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

      <section class="pv2-panel mk-auto-panel">
        <div class="pv2-panel-head has-sub">
          <div><h2>Séquences automatiques</h2><p class="pv2-panel-sub">Les emails qui partent tout seuls, au bon moment. Active ou coupe chaque séquence — le reste est géré.</p></div>
          ${mkAuto.error ? `<button type="button" class="pv2-btn" onclick="loadStaffAutomations(true)">Réessayer</button>` : ''}
        </div>
        <div class="pv2-panel-body">
          ${mkAuto.error
            ? `<div class="pv2-empty"><strong>${esc(mkAuto.error)}</strong></div>`
            : mkAuto.loaded
              ? `<div class="mk-auto-grid">${AUTOMATION_META.map(mkAutoCard).join('')}</div>`
              : `<div class="pv2-empty"><strong>Chargement des séquences…</strong></div>`}
        </div>
      </section>

      <section class="pv2-pipeline">
        ${pipe('all', 'Total', allRows.length, 'toutes communications')}
        ${pipe('queued', 'En file', metrics.queued, `${metrics.due || 0} prêt(s) à partir`)}
        ${pipe('sent', 'Envoyés', metrics.sent, `${metrics.deliveryRate || 0}% de réussite`)}
        ${pipe('failed', 'Échecs', metrics.failed, `${metrics.attempted || 0} tentative(s)`)}
        ${pipe('review', 'Validations', metrics.review, 'demandes staff')}
      </section>

      <section class="pv2-split">
        <article class="pv2-panel pv2-mail-list">
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
    };
    return `<svg class="pv2-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`;
  }

  const channelLabel = (p) => CHANNEL_LABELS[p] || (p ? p.charAt(0).toUpperCase() + p.slice(1) : 'Canal');

  /* ==========================================================================
     MARKETING — le conseiller data (insight-only : il propose, tu appliques,
     il mesure). Les idées viennent du serveur (marketing_insights, générées
     chaque matin par le cron sur les chiffres réels + météo + calendrier).
     ======================================================================== */

  const mkIa = {
    loaded: false, loading: false, error: '',
    insights: [], metrics: null, period: 30, metricsLoading: false, busyId: null,
  };
  window.mkIa = mkIa;

  async function loadMarketingIa(force = false) {
    if (mkIa.loading || (mkIa.loaded && !force)) return;
    mkIa.loading = true;
    mkIa.error = '';
    try {
      const centerId = encodeURIComponent(state.currentCenterId || 'libramont');
      const payload = await apiRequest(`/api/ops?action=marketingInsights&centerId=${centerId}`);
      mkIa.insights = payload.insights || [];
      mkIa.loaded = true;
    } catch (error) {
      mkIa.error = error.message || 'Conseiller marketing indisponible.';
    } finally {
      mkIa.loading = false;
      renderStaffCampaignsPage();
    }
    loadMarketingMetrics(true);
  }
  window.loadMarketingIa = loadMarketingIa;

  async function loadMarketingMetrics(force = false) {
    if (mkIa.metricsLoading || (mkIa.metrics && !force)) return;
    mkIa.metricsLoading = true;
    try {
      const centerId = encodeURIComponent(state.currentCenterId || 'libramont');
      const to = typeof todayStr === 'function' ? todayStr() : new Date().toISOString().slice(0, 10);
      const fromDate = new Date(`${to}T12:00:00Z`);
      fromDate.setUTCDate(fromDate.getUTCDate() - (mkIa.period - 1));
      const from = fromDate.toISOString().slice(0, 10);
      mkIa.metrics = await apiRequest(`/api/ops?action=dailyMetrics&centerId=${centerId}&from=${from}&to=${to}`);
    } catch (error) {
      mkIa.metrics = null;
    } finally {
      mkIa.metricsLoading = false;
      renderStaffCampaignsPage();
    }
  }

  window.mkIaSetPeriod = function (days) {
    mkIa.period = Number(days) || 30;
    mkIa.metrics = null;
    renderStaffCampaignsPage();
    loadMarketingMetrics(true);
  };

  window.mkIaCopy = async function (id) {
    const insight = mkIa.insights.find((item) => Number(item.id) === Number(id));
    if (!insight) return;
    const text = insight.ready_content || insight.body || '';
    try {
      await navigator.clipboard.writeText(text);
      toast('Copié — colle-le sur ton réseau.');
    } catch (error) {
      toast('Copie auto impossible — sélectionne le texte à la main.');
    }
  };

  window.mkIaStatus = async function (id, status) {
    if (mkIa.busyId) return;
    mkIa.busyId = Number(id);
    renderStaffCampaignsPage();
    try {
      await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'insightStatus', id: Number(id), status, centerId: state.currentCenterId || 'libramont' }),
      });
      const insight = mkIa.insights.find((item) => Number(item.id) === Number(id));
      if (insight) {
        insight.status = status;
        if (status === 'applied') insight.applied_at = new Date().toISOString();
      }
      toast(status === 'applied' ? 'Noté ! Je mesure l’effet réel dans 14 jours.' : 'OK — je ne re-proposerai plus cette idée.');
    } catch (error) {
      toast(error.message || 'Action impossible.');
    } finally {
      mkIa.busyId = null;
      renderStaffCampaignsPage();
    }
  };

  /* « À venir » : météo prévue + congés/événements + idées posées sur leur jour.
     Plage de dates LIBRE (demande Movsar) : défaut aujourd'hui → +6 j, cap serveur 31 j. */
  const mkWeek = { loaded: false, loading: false, days: [], from: '', to: '' };

  function mkWeekDefaults() {
    const today = typeof todayStr === 'function' ? todayStr() : new Date().toISOString().slice(0, 10);
    const end = new Date(`${today}T12:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 6);
    return { from: today, to: end.toISOString().slice(0, 10) };
  }

  async function loadMarketingWeek(force = false) {
    if (mkWeek.loading || (mkWeek.loaded && !force)) return;
    if (!mkWeek.from || !mkWeek.to) Object.assign(mkWeek, mkWeekDefaults());
    mkWeek.loading = true;
    try {
      const centerId = encodeURIComponent(state.currentCenterId || 'libramont');
      const payload = await apiRequest(`/api/ops?action=marketingWeek&centerId=${centerId}&from=${mkWeek.from}&to=${mkWeek.to}`);
      mkWeek.days = Array.isArray(payload.days) ? payload.days : [];
      mkWeek.loaded = true;
    } catch (error) { /* silencieux : la section s'efface */ } finally {
      mkWeek.loading = false;
      renderStaffCampaignsPage();
    }
  }
  window.loadMarketingWeek = loadMarketingWeek;

  window.mkWeekSetRange = function (which, value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return;
    if (which === 'from') mkWeek.from = value; else mkWeek.to = value;
    if (mkWeek.to < mkWeek.from) mkWeek.to = mkWeek.from;
    loadMarketingWeek(true);
  };

  window.mkWeekPreset = function (days) {
    const today = typeof todayStr === 'function' ? todayStr() : new Date().toISOString().slice(0, 10);
    const end = new Date(`${today}T12:00:00Z`);
    end.setUTCDate(end.getUTCDate() + (Number(days) - 1));
    mkWeek.from = today;
    mkWeek.to = end.toISOString().slice(0, 10);
    loadMarketingWeek(true);
  };

  // « Demande une idée » : objectif + brief → cycle du moteur → nouvelles idées.
  const MK_OBJECTIVES = [
    ['anniversaires', 'Anniversaires'],
    ['heures-creuses', 'Heures creuses'],
    ['meteo', 'Météo'],
    ['evenement', 'Événement local'],
    ['libre', 'Libre'],
  ];

  window.mkIaAsk = function () {
    const select = document.getElementById('mkAskObjective');
    const brief = document.getElementById('mkAskBrief');
    state.staffCampaignObjective = select ? select.value : 'anniversaires';
    state.staffCampaignBrief = brief ? brief.value.trim() : '';
    save();
    if (typeof runStaffMarketingAgents === 'function') runStaffMarketingAgents();
  };

  window.mkIaRedo = async function (id) {
    if (mkIa.busyId) return;
    mkIa.busyId = Number(id);
    renderStaffCampaignsPage();
    try {
      await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'insightRedo', id: Number(id), centerId: state.currentCenterId || 'libramont' }),
      });
      toast('Idée relancée — elle revient dans « À faire » adaptée à maintenant.');
      await loadMarketingIa(true);
    } catch (error) {
      toast(error.message || 'Impossible de relancer cette idée.');
    } finally {
      mkIa.busyId = null;
      renderStaffCampaignsPage();
    }
  };

  const MK_STATUS_LABELS = {
    proposed: 'proposée', applied: 'appliquée', ignored: 'ignorée',
    validated: 'validée ✓', refuted: 'sans effet', inconclusive: 'pas net',
  };

  function mkWeekStrip() {
    if (!mkWeek.loaded || !mkWeek.days.length) return '';
    const dayCards = mkWeek.days.map((day) => {
      const d = new Date(`${day.date}T12:00:00Z`);
      const dow = d.toLocaleDateString('fr-BE', { weekday: 'short' });
      const rain = Number(day.precipMm) >= 10;
      const badge = day.holidayLabel || (day.isSchoolHoliday ? 'Congé scolaire' : '') || (Array.isArray(day.events) && day.events.length ? day.events[0] : '');
      const ideas = (day.ideas || []).slice(0, 2).map((idea) => `<span class="mk-week-idea" title="${esc(idea.title || '')}"></span>`).join('');
      return `<div class="mk-week-day${badge ? ' has-badge' : ''}">
        <span class="mk-week-dow">${esc(dow)} ${d.getUTCDate()}</span>
        <span class="mk-week-temp">${day.tmax === null || day.tmax === undefined ? '—' : Math.round(Number(day.tmax)) + '°'}${rain ? `<span class="mk-week-rain" title="Pluie annoncée">${ci('droplet')}</span>` : ''}</span>
        ${badge ? `<span class="mk-week-badge" title="${esc(badge)}">${esc(String(badge).length > 14 ? String(badge).slice(0, 13) + '…' : badge)}</span>` : ''}
        ${ideas}
      </div>`;
    }).join('');
    return `<section class="pv2-panel">
      <div class="pv2-panel-head has-sub">
        <div><h2>À venir</h2><p class="pv2-panel-sub">Météo prévue, congés et événements — les points bleus sont les idées posées sur leur jour.</p></div>
        <div class="mk-week-range">
          <div class="mk-week-presets" role="group" aria-label="Période rapide">
            <button type="button" class="pv2-btn" onclick="mkWeekPreset(7)">7 j</button>
            <button type="button" class="pv2-btn" onclick="mkWeekPreset(14)">14 j</button>
            <button type="button" class="pv2-btn" onclick="mkWeekPreset(31)">31 j</button>
          </div>
          <input type="date" value="${esc(mkWeek.from)}" aria-label="Du" onchange="mkWeekSetRange('from', this.value)">
          <span class="mk-week-arrow" aria-hidden="true">→</span>
          <input type="date" value="${esc(mkWeek.to)}" aria-label="Au" onchange="mkWeekSetRange('to', this.value)">
        </div>
      </div>
      <div class="pv2-panel-body"><div class="mk-week">${dayCards}</div></div>
    </section>`;
  }

  function mkIdeaCard(insight) {
    const busy = mkIa.busyId === Number(insight.id);
    const channel = CHANNEL_LABELS[insight.channel] || (insight.channel ? insight.channel.charAt(0).toUpperCase() + insight.channel.slice(1) : 'Idée');
    const basis = Array.isArray(insight.data_basis) ? insight.data_basis : [];
    return `<article class="mk-idea">
      <div class="mk-idea-head">
        <span class="mk-idea-channel">${esc(channel)}</span>
        <strong>${esc(insight.title || 'Idée')}</strong>
      </div>
      ${insight.body ? `<p class="mk-idea-why">${esc(insight.body)}</p>` : ''}
      ${insight.ready_content ? `<div class="mk-idea-content">${esc(insight.ready_content)}</div>` : ''}
      ${basis.length ? `<details class="mk-idea-basis"><summary>Les chiffres derrière cette idée</summary><ul>${basis.slice(0, 5).map((fact) => `<li>${esc(fact.label || fact.id || '')}${fact.sampleSize ? ` <small>(${esc(String(fact.sampleSize))} j)</small>` : ''}</li>`).join('')}</ul></details>` : ''}
      <div class="mk-idea-actions">
        ${insight.ready_content ? `<button type="button" class="pv2-btn" onclick="mkIaCopy(${Number(insight.id)})">${ci('copy')}Copier</button>` : ''}
        <button type="button" class="pv2-btn primary" onclick="mkIaStatus(${Number(insight.id)}, 'applied')" ${busy ? 'disabled' : ''}>${ci('check')}C’est fait</button>
        <button type="button" class="pv2-btn" onclick="mkIaStatus(${Number(insight.id)}, 'ignored')" ${busy ? 'disabled' : ''}>Ignorer</button>
      </div>
    </article>`;
  }

  const MK_VERDICTS = {
    validated: { label: 'Ça a marché', tone: 'good' },
    refuted: { label: 'Pas d’effet mesuré', tone: 'bad' },
    inconclusive: { label: 'Pas assez net', tone: 'mid' },
  };

  function mkMeasuredLine(insight) {
    const verdict = MK_VERDICTS[insight.status] || MK_VERDICTS.inconclusive;
    const r = insight.result || {};
    const delta = r.deltaPct === null || r.deltaPct === undefined ? null : Math.round(Number(r.deltaPct));
    const detail = delta === null
      ? 'pas assez de jours comparables pour trancher'
      : `${delta > 0 ? '+' : ''}${delta} % de visiteurs (avant ~${esc(String(r.before ?? '?'))}/j, après ~${esc(String(r.after ?? '?'))}/j, sur ${esc(String(r.sampleDays ?? '?'))} j comparables)`;
    const redo = insight.status === 'validated'
      ? `<button type="button" class="pv2-btn mk-redo" onclick="mkIaRedo(${Number(insight.id)})" ${mkIa.busyId ? 'disabled' : ''}>${ci('refresh')}Refaire</button>`
      : '';
    return `<li class="mk-learned ${verdict.tone}">
      <span class="mk-learned-badge">${esc(verdict.label)}</span>
      <div><strong>${esc(insight.title || 'Idée')}</strong><small>${detail}</small></div>
      ${redo}
    </li>`;
  }


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
    if (!mkIa.loaded && !mkIa.loading) setTimeout(() => loadMarketingIa(), 0);

    const proposed = mkIa.insights.filter((item) => item.status === 'proposed').slice(0, 3);
    const waiting = mkIa.insights.filter((item) => item.status === 'applied');
    const measured = mkIa.insights.filter((item) => ['validated', 'refuted', 'inconclusive'].includes(item.status)).slice(0, 6);
    const running = typeof staffMarketingAgentsCache !== 'undefined' && Boolean(staffMarketingAgentsCache.running);

    const actions = `
      <button type="button" class="pv2-btn" onclick="loadMarketingIa(true)">${ci('refresh')}Actualiser</button>
      <button type="button" class="pv2-btn primary" onclick="runStaffMarketingAgents()" ${running ? 'disabled' : ''}>${ci('bolt')}${running ? 'Analyse…' : 'Analyser maintenant'}</button>`;

    const todo = `<section class="pv2-panel">
      <div class="pv2-panel-head has-sub">
        <div><h2>À faire cette semaine</h2><p class="pv2-panel-sub">Des idées appuyées sur tes chiffres réels, la météo et le calendrier. Copie, publie, marque « fait » — je mesure l’effet.</p></div>
        <small>${proposed.length} idée${proposed.length > 1 ? 's' : ''}</small>
      </div>
      <div class="pv2-panel-body">
        ${mkIa.error
          ? `<div class="pv2-empty"><strong>${esc(mkIa.error)}</strong><button type="button" class="pv2-btn" onclick="loadMarketingIa(true)">Réessayer</button></div>`
          : proposed.length
            ? `<div class="mk-idea-grid">${proposed.map(mkIdeaCard).join('')}</div>`
            : `<div class="pv2-empty"><strong>${mkIa.loading ? 'Analyse en cours…' : 'Rien d’urgent pour l’instant'}</strong>${mkIa.loading ? '' : 'J’analyse chaque matin à 8h15. Dès qu’une occasion se présente (météo, vacances, creux, événement local), l’idée apparaît ici, prête à publier.'}</div>`}
      </div>
    </section>`;

    const m = mkIa.metrics;
    const totals = m && m.totals ? m.totals : null;
    const dataDays = totals ? Number(totals.days) || 0 : 0;
    const spendPerHead = totals && Number(totals.visitors) > 0 ? Math.round((Number(totals.revenue) / Number(totals.visitors)) * 10) / 10 : null;
    const fmtDay = (row) => {
      if (!row) return '';
      const d = new Date(`${row.date}T12:00:00Z`);
      return `${d.toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'short' })} · ${Number(row.visitors) || 0} visiteurs`;
    };
    const periodSeg = seg([
      { key: '7', label: '7 jours', active: mkIa.period === 7 },
      { key: '30', label: '30 jours', active: mkIa.period === 30 },
      { key: '90', label: '90 jours', active: mkIa.period === 90 },
    ], 'mkIaSetPeriod');

    const stats = `<section class="pv2-panel">
      <div class="pv2-panel-head has-sub">
        <div><h2>Tes chiffres</h2><p class="pv2-panel-sub">${dataDays && dataDays < 90 ? `Données encore jeunes (${dataDays} j) — tendances indicatives.` : 'La réalité du terrain sur la période choisie.'}</p></div>
        ${periodSeg}
      </div>
      <div class="pv2-panel-body">
        ${totals && dataDays
          ? `<div class="pv2-stats mk-stats">
              ${stat({ label: 'Visiteurs', count: Number(totals.visitors) || 0 })}
              ${stat({ label: 'Chiffre d’affaires', value: money(totals.revenue) })}
              ${stat({ label: 'Dépense / visiteur', value: spendPerHead === null ? '—' : money(spendPerHead) })}
              ${stat({ label: 'Meilleur jour', value: m.bestDay ? money(m.bestDay.revenue_total) : '—', foot: fmtDay(m.bestDay) })}
            </div>`
          : `<div class="pv2-empty"><strong>${mkIa.metricsLoading ? 'Chargement…' : 'Pas encore de chiffres sur cette période'}</strong>${mkIa.metricsLoading ? '' : 'La collecte tourne automatiquement chaque nuit.'}</div>`}
      </div>
    </section>`;

    const learned = `<section class="pv2-panel">
      <div class="pv2-panel-head has-sub">
        <div><h2>Ce qu’on a appris</h2><p class="pv2-panel-sub">Chaque idée « faite » est mesurée 14 jours après, à jours comparables (même jour de semaine, hors biais vacances).</p></div>
        ${waiting.length ? `<small>${waiting.length} en cours de mesure</small>` : ''}
      </div>
      <div class="pv2-panel-body">
        ${measured.length ? `<ul class="mk-learned-list">${measured.map(mkMeasuredLine).join('')}</ul>` : ''}
        ${waiting.length ? `<p class="mk-waiting">${waiting.map((item) => esc(item.title || 'Idée')).join(' · ')} — verdict automatique à J+14.</p>` : ''}
        ${!measured.length && !waiting.length ? `<div class="pv2-empty"><strong>Rien de mesuré pour l’instant</strong>Marque une idée « C’est fait » et je te dirai si elle a vraiment ramené du monde.</div>` : ''}
        ${mkIa.insights.length > 3 ? `<details class="mk-archive"><summary>Toutes les idées (${mkIa.insights.length})</summary>
          <ul class="mk-archive-list">${mkIa.insights.map((item) => `<li><span class="mk-archive-status st-${esc(item.status)}">${esc(MK_STATUS_LABELS[item.status] || item.status)}</span><strong>${esc(item.title || 'Idée')}</strong><small>${esc(item.proposed_at ? String(item.proposed_at).slice(0, 10) : '')}${item.channel ? ` · ${esc(item.channel)}` : ''}</small></li>`).join('')}</ul>
        </details>` : ''}
      </div>
    </section>`;

    // « Demande une idée » : le gérant choisit l'angle, le moteur fait le reste.
    const ask = `<section class="pv2-panel mk-ask">
      <div class="pv2-panel-body mk-ask-row">
        <label class="mk-ask-label" for="mkAskObjective">Demande une idée :</label>
        <select id="mkAskObjective" class="mk-ask-select" aria-label="Objectif">${MK_OBJECTIVES.map(([value, label]) => `<option value="${value}"${(state.staffCampaignObjective || 'anniversaires') === value ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select>
        <input id="mkAskBrief" class="mk-ask-brief" placeholder="Précision (optionnel) : « pour le week-end du 15 », « spécial ados »…" value="${esc(state.staffCampaignBrief || '')}">
        <button type="button" class="pv2-btn primary" onclick="mkIaAsk()" ${running ? 'disabled' : ''}>${running ? 'Analyse…' : `${ci('bulb')}Propose-moi une idée`}</button>
      </div>
    </section>`;

    root.innerHTML = `<div class="pv2-shell">
      ${bar({
        crumb: 'Clients & Marketing',
        title: 'Marketing',
        sub: 'Ton conseiller data : il analyse chaque matin tes chiffres, la météo de Libramont et le calendrier scolaire.',
        actions,
      })}
      ${todo}
      ${ask}
      ${mkWeekStrip()}
      ${stats}
      ${learned}
      ${renderPv2RealCampaigns()}
    </div>`;
    mount(root, 'campaigns');
    if (!mkWeek.loaded && !mkWeek.loading) setTimeout(() => loadMarketingWeek(), 0);
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

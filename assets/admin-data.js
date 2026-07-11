// Onglet « Données » de la console direction — hub analytics complet.
// Toutes les agrégations viennent du serveur (action directionAnalytics,
// source de vérité unique) : ce module ne fait que rendre, exporter, et
// piloter les bilans périodiques. Chargé en lazy avec les autres consoles.
/* global apiRequest, escapeHtml, state, save, toast, renderAdminDashboard */

const DH_RANGES = {
  '7j': { days: 7, label: '7 jours', bucket: 'daily' },
  '30j': { days: 30, label: '30 jours', bucket: 'daily' },
  '90j': { days: 90, label: '90 jours', bucket: 'weekly' },
  '12m': { days: 365, label: '12 mois', bucket: 'monthly' },
};

const dhState = {
  rangeKey: '30j',
  loadedKey: '',
  loading: false,
  error: '',
  analytics: null,
  previous: null,
  reports: [],
  reportsLoaded: false,
  reportBusy: false,
  openReportId: null,
  editingReportId: null,
};

function dhCenterId() {
  return (typeof state !== 'undefined' && state.adminCenterId) || 'libramont';
}

function dhToday() {
  return new Date().toISOString().slice(0, 10);
}

function dhAddDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dhEsc(value) {
  return typeof escapeHtml === 'function' ? escapeHtml(String(value ?? '')) : String(value ?? '');
}

function dhEuro(n) {
  return `${Number(n || 0).toLocaleString('fr-BE', { maximumFractionDigits: 0 })} €`;
}

function dhEuroFull(n) {
  return `${Number(n || 0).toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

function dhNum(n) {
  return Number(n || 0).toLocaleString('fr-BE');
}

function dhDateFr(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
}

function dhDateShort(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
}

// ---------------------------------------------------------------------------
// Chargement
// ---------------------------------------------------------------------------

function dhCacheKey() {
  return `${dhCenterId()}|${dhState.rangeKey}|${dhToday()}`;
}

async function loadAdminDataHub(force = false) {
  const key = dhCacheKey();
  if (dhState.loading) return;
  if (!force && dhState.loadedKey === key && dhState.analytics) return;
  dhState.loading = true;
  dhState.error = '';
  dhRefresh();
  try {
    const endDate = dhToday();
    const startDate = dhAddDays(endDate, -(DH_RANGES[dhState.rangeKey].days - 1));
    const payload = await apiRequest(
      `/api/ops?action=directionAnalytics&centerId=${encodeURIComponent(dhCenterId())}&startDate=${startDate}&endDate=${endDate}`,
    );
    dhState.analytics = payload.analytics;
    dhState.previous = payload.previous;
    dhState.loadedKey = key;
  } catch (error) {
    dhState.error = error.message || 'Données momentanément indisponibles.';
  } finally {
    dhState.loading = false;
    dhRefresh();
  }
  if (!dhState.reportsLoaded) loadDirectionReportsList();
}

async function loadDirectionReportsList() {
  try {
    const payload = await apiRequest(`/api/ops?action=directionReports&centerId=${encodeURIComponent(dhCenterId())}`);
    dhState.reports = payload.reports || [];
    dhState.reportsLoaded = true;
    dhRefresh();
  } catch (error) {
    // Section bilans non bloquante : le hub reste utilisable sans elle.
    dhState.reportsLoaded = true;
  }
}

function dhSetRange(key) {
  if (!DH_RANGES[key]) return;
  dhState.rangeKey = key;
  loadAdminDataHub();
  dhRefresh();
}

function dhRefresh() {
  if (typeof state !== 'undefined' && state.view === 'admin' && state.adminTab === 'data'
    && typeof renderAdminDashboard === 'function') {
    renderAdminDashboard();
  }
}

// ---------------------------------------------------------------------------
// Briques visuelles (divs + tokens — palette validée, cf. --chart-1/2/3)
// ---------------------------------------------------------------------------

function dhDelta(current, previous, { invert = false } = {}) {
  if (!previous) return '<span class="dh-delta neutral">—</span>';
  const delta = Math.round(((current - previous) / previous) * 1000) / 10;
  if (delta === 0) return '<span class="dh-delta neutral">= stable</span>';
  const positive = invert ? delta < 0 : delta > 0;
  const arrow = delta > 0 ? '▲' : '▼';
  return `<span class="dh-delta ${positive ? 'up' : 'down'}">${arrow} ${Math.abs(delta).toLocaleString('fr-BE')} %</span>`;
}

function dhTile({ label, value, sub = '', delta = '' }) {
  return `<div class="dh-tile">
    <div class="dh-tile-label">${dhEsc(label)}</div>
    <div class="dh-tile-value">${value}</div>
    <div class="dh-tile-foot">${delta}${sub ? `<span class="dh-tile-sub">${sub}</span>` : ''}</div>
  </div>`;
}

// Histogramme vertical : colonnes flex, barres fines arrondies en tête,
// tooltip par barre, ticks x clairsemés (jamais une étiquette par point).
function dhColumnChart({ points, color, valueFmt, emptyLabel }) {
  if (!points.length || points.every((p) => !p.value)) {
    return `<div class="dh-chart-empty">${dhEsc(emptyLabel || 'Aucune donnée sur la période.')}</div>`;
  }
  const max = Math.max(...points.map((p) => p.value), 1);
  const tickEvery = Math.max(1, Math.ceil(points.length / 6));
  const cols = points.map((p, i) => {
    const h = Math.round((p.value / max) * 100);
    const tick = i % tickEvery === 0 || i === points.length - 1;
    return `<div class="dh-col" data-tip="${dhEsc(`${p.hint} — ${valueFmt(p.value)}`)}">
      <div class="dh-col-bar" style="height:${Math.max(h, p.value ? 3 : 0)}%;background:${color};"></div>
      <div class="dh-col-tick">${tick ? dhEsc(p.label) : ''}</div>
    </div>`;
  }).join('');
  return `<div class="dh-chart">
    <div class="dh-chart-max">${valueFmt(max)}</div>
    <div class="dh-cols">${cols}</div>
  </div>`;
}

// Barres horizontales : identité portée par le libellé de ligne + point de
// couleur ; valeur en libellé direct (texte = tokens texte, jamais la couleur).
function dhRowBars({ rows, total, valueFmt }) {
  if (!rows.length) return '<div class="dh-chart-empty">Aucune donnée sur la période.</div>';
  const max = Math.max(...rows.map((r) => r.value), 1);
  return `<div class="dh-rows">${rows.map((r) => `
    <div class="dh-row" data-tip="${dhEsc(`${r.label} — ${valueFmt(r.value)}${total ? ` (${Math.round((r.value / total) * 100)} %)` : ''}`)}">
      <div class="dh-row-label"><span class="dh-dot" style="background:${r.color}"></span>${dhEsc(r.label)}</div>
      <div class="dh-row-track"><div class="dh-row-bar" style="width:${Math.max((r.value / max) * 100, 2)}%;background:${r.color}"></div></div>
      <div class="dh-row-value">${valueFmt(r.value)}${r.extra ? ` <span class="dh-row-extra">${dhEsc(r.extra)}</span>` : ''}</div>
    </div>`).join('')}</div>`;
}

const DH_WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

// Affluence jour × heure : séquentiel mono-teinte (mélange accent→surface).
function dhHeatmap(heatmap) {
  let minHour = 24;
  let maxHour = 0;
  let maxVal = 0;
  heatmap.forEach((row) => Object.entries(row).forEach(([h, v]) => {
    minHour = Math.min(minHour, Number(h));
    maxHour = Math.max(maxHour, Number(h));
    maxVal = Math.max(maxVal, v);
  }));
  if (!maxVal) return '<div class="dh-chart-empty">Aucune réservation horodatée sur la période.</div>';
  minHour = Math.min(minHour, 12);
  maxHour = Math.max(maxHour, 21);
  const hours = [];
  for (let h = minHour; h <= maxHour; h += 1) hours.push(h);
  const head = `<div class="dh-hm-corner"></div>${hours.map((h) => `<div class="dh-hm-h">${h}h</div>`).join('')}`;
  const body = heatmap.map((row, wd) => {
    const cells = hours.map((h) => {
      const v = row[h] || 0;
      const strength = v ? Math.round(18 + (v / maxVal) * 72) : 0;
      return `<div class="dh-hm-cell" data-tip="${dhEsc(`${DH_WEEKDAYS[wd]} ${h}h — ${v} réservation${v > 1 ? 's' : ''}`)}"
        style="background:color-mix(in srgb, var(--accent) ${strength}%, var(--surface))"></div>`;
    }).join('');
    return `<div class="dh-hm-d">${DH_WEEKDAYS[wd]}</div>${cells}`;
  }).join('');
  return `<div class="dh-hm" style="grid-template-columns:44px repeat(${hours.length}, minmax(18px, 44px))">${head}${body}</div>`;
}

// ---------------------------------------------------------------------------
// Séries selon la granularité de la période
// ---------------------------------------------------------------------------

function dhSeries(analytics) {
  const bucket = DH_RANGES[dhState.rangeKey].bucket;
  if (bucket === 'daily') {
    return analytics.daily.map((d) => ({
      label: dhDateShort(d.date), hint: dhDateFr(d.date), count: d.count, revenue: d.revenue,
    }));
  }
  if (bucket === 'weekly') {
    return analytics.weekly.map((w) => ({
      label: dhDateShort(w.weekStart), hint: `Semaine du ${dhDateFr(w.weekStart)}`, count: w.count, revenue: w.revenue,
    }));
  }
  return analytics.monthly.map((m) => ({
    label: m.month.slice(5), hint: m.month, count: m.count, revenue: m.revenue,
  }));
}

const DH_TYPE_META = {
  bowling: { label: 'Bowling', color: 'var(--chart-1)' },
  laser: { label: 'Laser Game', color: 'var(--chart-2)' },
  formule: { label: 'Formules', color: 'var(--chart-3)' },
};

// ---------------------------------------------------------------------------
// Rendu principal de l'onglet
// ---------------------------------------------------------------------------

function renderAdminDataTab() {
  const a = dhState.analytics;
  const header = `
    <div class="dh-head">
      <div>
        <h2 class="dh-title">Données du centre</h2>
        <p class="dh-sub">${a ? `Du ${dhDateFr(a.startDate)} au ${dhDateFr(a.endDate)} · comparé à la période précédente de même durée.` : 'Réservations, clients, formules et affluence — comparés à la période précédente.'}</p>
      </div>
      <div class="dh-controls">
        <div class="dh-range">${Object.entries(DH_RANGES).map(([key, r]) => `
          <button type="button" class="${dhState.rangeKey === key ? 'active' : ''}" onclick="dhSetRange('${key}')">${r.label}</button>`).join('')}
        </div>
        <button type="button" class="admin-btn" onclick="dhExportMenuToggle(event)">Exporter ▾</button>
        <div class="dh-export-menu hidden" id="dhExportMenu">
          <button type="button" onclick="dhExportCsv('serie')">CSV — série ${DH_RANGES[dhState.rangeKey].bucket === 'daily' ? 'quotidienne' : DH_RANGES[dhState.rangeKey].bucket === 'weekly' ? 'hebdomadaire' : 'mensuelle'}</button>
          <button type="button" onclick="dhExportCsv('clients')">CSV — clients</button>
          <button type="button" onclick="dhExportCsv('formules')">CSV — formules & activités</button>
          <button type="button" onclick="dhExportCsv('reservations-brutes')">CSV — réservations de la période</button>
          <button type="button" onclick="dhPrintReport()">Rapport imprimable (PDF)</button>
        </div>
      </div>
    </div>`;

  if (dhState.loading && !a) {
    return `<div class="dh-wrap">${header}<div class="dh-chart-empty">Chargement des données…</div></div>`;
  }
  if (dhState.error && !a) {
    return `<div class="dh-wrap">${header}
      <div class="dh-error" role="alert">${dhEsc(dhState.error)}
        <button type="button" class="admin-btn" onclick="loadAdminDataHub(true)">Réessayer</button>
      </div></div>`;
  }
  if (!a) return `<div class="dh-wrap">${header}</div>`;

  const p = dhState.previous;
  const t = a.totals;
  const series = dhSeries(a);
  const online = a.byChannel.find((c) => c.channel === 'en ligne')?.count || 0;

  const tiles = [
    dhTile({ label: 'Réservations', value: dhNum(t.reservations), delta: dhDelta(t.reservations, p?.totals?.reservations), sub: t.cancelled ? `${t.cancelled} annulée${t.cancelled > 1 ? 's' : ''}` : '' }),
    dhTile({ label: 'Chiffre associé', value: dhEuro(t.revenue), delta: dhDelta(t.revenue, p?.totals?.revenue), sub: `panier moyen ${dhEuroFull(t.avgBasket)}` }),
    dhTile({ label: 'Joueurs', value: dhNum(t.pax), delta: dhDelta(t.pax, p?.totals?.pax) }),
    dhTile({ label: 'Clients uniques', value: dhNum(a.clients.unique), delta: dhDelta(a.clients.unique, p?.clients?.unique), sub: `${a.clients.new} nouveaux · ${a.clients.multi} multi-visites` }),
    dhTile({ label: 'Réservations en ligne', value: `${t.reservations ? Math.round((online / t.reservations) * 100) : 0} %`, sub: `${online} sur ${t.reservations}` }),
    dhTile({ label: 'Occupation bowling', value: a.occupancy.rate === null ? '—' : `${a.occupancy.rate.toLocaleString('fr-BE')} %`, sub: `${a.occupancy.bookedLaneHours} h réservées / ${a.occupancy.capacityLaneHours} h ouvertes` }),
  ].join('');

  const typeRows = Object.entries(a.byType).map(([type, v]) => ({
    label: DH_TYPE_META[type]?.label || type,
    color: DH_TYPE_META[type]?.color || 'var(--chart-1)',
    value: v.count,
    extra: dhEuro(v.revenue),
  })).sort((x, y) => y.value - x.value);

  const formuleRows = a.byFormule.slice(0, 8).map((f) => ({
    label: f.label, color: 'var(--chart-3)', value: f.count, extra: dhEuro(f.revenue),
  }));

  const occasionRows = a.byOccasion.slice(0, 6).map((o) => ({
    label: o.occasion, color: 'var(--chart-1)', value: o.count,
  }));

  const clientsTable = a.clients.top.length ? `
    <table class="dh-table">
      <thead><tr><th>Client</th><th>Visites</th><th>Chiffre</th><th>Dernière visite</th><th>Préférence</th><th>Contact</th></tr></thead>
      <tbody>${a.clients.top.map((c) => `
        <tr>
          <td>${dhEsc(c.name)}${c.firstVisit >= a.startDate ? ' <span class="dh-badge-new">nouveau</span>' : ''}</td>
          <td class="dh-mono">${c.visits}</td>
          <td class="dh-mono">${dhEuro(c.revenue)}</td>
          <td class="dh-mono">${dhDateFr(c.lastVisit)}</td>
          <td>${dhEsc(DH_TYPE_META[c.favorite]?.label || c.favorite)}</td>
          <td class="dh-contact">${dhEsc(c.phone || c.email || '—')}</td>
        </tr>`).join('')}
      </tbody>
    </table>` : '<div class="dh-chart-empty">Aucun client identifié sur la période.</div>';

  return `<div class="dh-wrap">
    ${header}
    <div class="dh-tiles">${tiles}</div>
    <div class="dh-grid-2">
      <section class="dh-card">
        <h3>Réservations par ${DH_RANGES[dhState.rangeKey].bucket === 'daily' ? 'jour' : DH_RANGES[dhState.rangeKey].bucket === 'weekly' ? 'semaine' : 'mois'}</h3>
        ${dhColumnChart({ points: series.map((s) => ({ label: s.label, hint: s.hint, value: s.count })), color: 'var(--chart-1)', valueFmt: (v) => `${dhNum(v)} résa${v > 1 ? 's' : ''}` })}
      </section>
      <section class="dh-card">
        <h3>Chiffre d'affaires associé</h3>
        ${dhColumnChart({ points: series.map((s) => ({ label: s.label, hint: s.hint, value: s.revenue })), color: 'var(--chart-2)', valueFmt: dhEuro })}
      </section>
    </div>
    <div class="dh-grid-2">
      <section class="dh-card">
        <h3>Répartition par activité</h3>
        ${dhRowBars({ rows: typeRows, total: t.reservations, valueFmt: dhNum })}
        <h3 class="dh-h-follow">Canal de réservation</h3>
        ${dhRowBars({
          rows: a.byChannel.map((c, i) => ({ label: c.channel === 'en ligne' ? 'En ligne (site)' : 'Staff (sur place / tél.)', color: i === 0 ? 'var(--chart-1)' : 'var(--chart-2)', value: c.count })),
          total: t.reservations,
          valueFmt: dhNum,
        })}
        ${occasionRows.length ? `<h3 class="dh-h-follow">Occasions déclarées</h3>${dhRowBars({ rows: occasionRows, total: null, valueFmt: dhNum })}` : ''}
      </section>
      <section class="dh-card">
        <h3>Formules les plus demandées</h3>
        ${dhRowBars({ rows: formuleRows, total: null, valueFmt: (v) => `${dhNum(v)} résa${v > 1 ? 's' : ''}` })}
      </section>
    </div>
    <section class="dh-card">
      <h3>Affluence par jour et heure</h3>
      ${dhHeatmap(a.heatmap)}
    </section>
    <section class="dh-card">
      <h3>Clients fidèles &amp; récurrents</h3>
      <p class="dh-sub">${dhNum(a.clients.unique)} clients uniques — ${a.clients.new} nouveaux, ${a.clients.returning} déjà venus avant la période, ${a.clients.multi} revenus plusieurs fois pendant la période.</p>
      ${clientsTable}
    </section>
    ${renderDhReportsSection()}
  </div>`;
}

// ---------------------------------------------------------------------------
// Bilans périodiques (générés côté serveur, éditables ici)
// ---------------------------------------------------------------------------

function renderDhReportsSection() {
  const open = dhState.reports.find((r) => r.id === dhState.openReportId) || null;
  const list = dhState.reports.length ? `
    <div class="dh-report-list">${dhState.reports.map((r) => `
      <button type="button" class="dh-report-item ${open && open.id === r.id ? 'active' : ''}" onclick="dhOpenReport(${r.id})">
        <span class="dh-report-kind">${r.periodType === 'week' ? 'Semaine' : 'Mois'}</span>
        <span>${dhDateFr(r.periodStart)} → ${dhDateFr(r.periodEnd)}</span>
        <span class="dh-report-meta">${r.editedAt ? `édité par ${dhEsc(r.editedBy || 'direction')}` : (r.generatedBy === 'ia' ? 'généré par IA' : 'généré automatiquement')}</span>
      </button>`).join('')}
    </div>` : '<div class="dh-chart-empty">Aucun bilan encore généré. Lancez le premier ci-dessus — chaque chiffre vient des données réelles.</div>';

  let viewer = '';
  if (open) {
    if (dhState.editingReportId === open.id) {
      viewer = `<div class="dh-report-viewer">
        <textarea id="dhReportEditor" class="dh-report-editor" rows="18">${dhEsc(open.bodyMd)}</textarea>
        <div class="dh-report-actions">
          <button type="button" class="admin-btn primary" onclick="dhSaveReport(${open.id}, this)">Enregistrer</button>
          <button type="button" class="admin-btn" onclick="dhCancelEditReport()">Annuler</button>
        </div>
      </div>`;
    } else {
      viewer = `<div class="dh-report-viewer">
        <article class="dh-report-body">${dhMdToHtml(open.bodyMd)}</article>
        <div class="dh-report-actions">
          <button type="button" class="admin-btn" onclick="dhEditReport(${open.id})">Modifier</button>
          <button type="button" class="admin-btn" onclick="dhPrintReport(${open.id})">Imprimer</button>
          <button type="button" class="admin-btn" onclick="dhCloseReport()">Fermer</button>
        </div>
      </div>`;
    }
  }

  return `<section class="dh-card" id="dhReports">
    <div class="dh-report-head">
      <h3>Bilan périodique</h3>
      <div class="dh-report-gen">
        <button type="button" class="admin-btn" ${dhState.reportBusy ? 'disabled' : ''} onclick="dhGenerateReport('week', this)">Générer le bilan de la semaine passée</button>
        <button type="button" class="admin-btn" ${dhState.reportBusy ? 'disabled' : ''} onclick="dhGenerateReport('month', this)">Générer le bilan du mois passé</button>
      </div>
    </div>
    <p class="dh-sub">Généré automatiquement à partir des données réelles, puis modifiable avant diffusion. Régénérer une même période remplace la version générée.</p>
    ${list}
    ${viewer}
  </section>`;
}

async function dhGenerateReport(periodType, button) {
  if (dhState.reportBusy) return;
  dhState.reportBusy = true;
  if (button) button.disabled = true;
  try {
    const payload = await apiRequest('/api/ops', {
      method: 'POST',
      body: JSON.stringify({ action: 'generateDirectionReport', centerId: dhCenterId(), periodType }),
    });
    const report = payload.report;
    dhState.reports = [report, ...dhState.reports.filter((r) => r.id !== report.id)]
      .sort((x, y) => (x.periodStart < y.periodStart ? 1 : -1));
    dhState.openReportId = report.id;
    dhState.editingReportId = null;
    if (typeof toast === 'function') toast('Bilan généré à partir des données réelles.');
  } catch (error) {
    if (typeof toast === 'function') toast(error.message || 'Génération impossible pour le moment.');
  } finally {
    dhState.reportBusy = false;
    dhRefresh();
  }
}

function dhOpenReport(id) {
  dhState.openReportId = dhState.openReportId === id ? null : id;
  dhState.editingReportId = null;
  dhRefresh();
}

function dhCloseReport() {
  dhState.openReportId = null;
  dhState.editingReportId = null;
  dhRefresh();
}

function dhEditReport(id) {
  dhState.editingReportId = id;
  dhRefresh();
}

function dhCancelEditReport() {
  dhState.editingReportId = null;
  dhRefresh();
}

async function dhSaveReport(id, button) {
  const editor = document.getElementById('dhReportEditor');
  if (!editor || !editor.value.trim()) {
    if (typeof toast === 'function') toast('Le bilan ne peut pas être vide.');
    return;
  }
  if (button) button.disabled = true;
  try {
    const payload = await apiRequest('/api/ops', {
      method: 'POST',
      body: JSON.stringify({ action: 'saveDirectionReport', centerId: dhCenterId(), id, bodyMd: editor.value }),
    });
    dhState.reports = dhState.reports.map((r) => (r.id === payload.report.id ? payload.report : r));
    dhState.editingReportId = null;
    if (typeof toast === 'function') toast('Bilan enregistré.');
  } catch (error) {
    if (typeof toast === 'function') toast(error.message || 'Enregistrement impossible.');
    if (button) button.disabled = false;
    return;
  }
  dhRefresh();
}

// Rendu markdown minimal et sûr : tout est échappé AVANT transformation.
function dhMdToHtml(md) {
  const lines = String(md || '').split('\n');
  const html = [];
  let inList = false;
  const closeList = () => { if (inList) { html.push('</ul>'); inList = false; } };
  for (const raw of lines) {
    const line = dhEsc(raw);
    const inline = (s) => s
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/_([^_]+)_/g, '<em>$1</em>');
    if (/^## /.test(line)) { closeList(); html.push(`<h4>${inline(line.slice(3))}</h4>`); continue; }
    if (/^# /.test(line)) { closeList(); html.push(`<h3>${inline(line.slice(2))}</h3>`); continue; }
    if (/^- /.test(line)) {
      if (!inList) { html.push('<ul>'); inList = true; }
      html.push(`<li>${inline(line.slice(2))}</li>`);
      continue;
    }
    closeList();
    if (line.trim()) html.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return html.join('');
}

// ---------------------------------------------------------------------------
// Exports — CSV « Excel belge » (séparateur ; virgule décimale, BOM UTF-8)
// ---------------------------------------------------------------------------

function dhCsvCell(value) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function dhCsvNumber(n) {
  return dhCsvCell(String(Number(n || 0)).replace('.', ','));
}

function dhDownload(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 2000);
}

function dhExportMenuToggle(event) {
  event.stopPropagation();
  const menu = document.getElementById('dhExportMenu');
  if (menu) menu.classList.toggle('hidden');
}

async function dhExportCsv(kind) {
  const a = dhState.analytics;
  if (!a) return;
  const menu = document.getElementById('dhExportMenu');
  if (menu) menu.classList.add('hidden');
  const sep = ';';
  const rows = [];
  const period = `${a.startDate}_${a.endDate}`;

  if (kind === 'serie') {
    const bucket = DH_RANGES[dhState.rangeKey].bucket;
    if (bucket === 'daily') {
      rows.push(['Date', 'Réservations', 'Joueurs', 'Chiffre (EUR)', 'Annulations']);
      for (const d of a.daily) rows.push([d.date, d.count, d.pax, d.revenue, d.cancelled]);
    } else if (bucket === 'weekly') {
      rows.push(['Semaine du', 'Réservations', 'Joueurs', 'Chiffre (EUR)', 'Annulations']);
      for (const w of a.weekly) rows.push([w.weekStart, w.count, w.pax, w.revenue, w.cancelled]);
    } else {
      rows.push(['Mois', 'Réservations', 'Joueurs', 'Chiffre (EUR)', 'Annulations']);
      for (const m of a.monthly) rows.push([m.month, m.count, m.pax, m.revenue, m.cancelled]);
    }
  } else if (kind === 'clients') {
    rows.push(['Client', 'Visites', 'Chiffre (EUR)', 'Première visite', 'Dernière visite', 'Activité préférée', 'Téléphone', 'Email', 'Nouveau sur la période']);
    for (const c of dhState.analytics.clients.top) {
      rows.push([c.name, c.visits, c.revenue, c.firstVisit, c.lastVisit, DH_TYPE_META[c.favorite]?.label || c.favorite, c.phone, c.email, c.firstVisit >= a.startDate ? 'oui' : 'non']);
    }
  } else if (kind === 'formules') {
    rows.push(['Type', 'Libellé', 'Réservations', 'Joueurs', 'Chiffre (EUR)']);
    for (const [type, v] of Object.entries(a.byType)) rows.push(['Activité', DH_TYPE_META[type]?.label || type, v.count, v.pax, v.revenue]);
    for (const f of a.byFormule) rows.push(['Formule', f.label, f.count, f.pax, f.revenue]);
  } else if (kind === 'reservations-brutes') {
    try {
      const payload = await apiRequest(`/api/admin-range?startDate=${a.startDate}&endDate=${a.endDate}&centerId=${encodeURIComponent(dhCenterId())}`);
      rows.push(['Date', 'Heure', 'Client', 'Téléphone', 'Email', 'Type', 'Formule', 'Joueurs', 'Pistes', 'Durée (h)', 'Prix (EUR)', 'Statut', 'Canal', 'Occasion']);
      for (const r of payload.reservations || []) {
        rows.push([r.date, r.startTime, r.name, r.phone, r.email, r.type, r.label, r.pax, (r.lanes || []).join(' '), r.totalDuration || r.duration, r.price, r.status, r.channel, r.occasion]);
      }
    } catch (error) {
      if (typeof toast === 'function') toast(error.message || 'Export impossible pour le moment.');
      return;
    }
  }

  const csv = '﻿' + rows.map((row) => row.map((cell) => (typeof cell === 'number' ? dhCsvNumber(cell) : dhCsvCell(cell))).join(sep)).join('\r\n');
  dhDownload(`pinlane-${kind}-${period}.csv`, csv, 'text/csv;charset=utf-8');
  if (typeof toast === 'function') toast('Export CSV téléchargé.');
}

// Rapport imprimable — mise en page sobre A4, prêt pour PDF (Ctrl+P).
function dhPrintReport(reportId = null) {
  const a = dhState.analytics;
  if (!a) return;
  const menu = document.getElementById('dhExportMenu');
  if (menu) menu.classList.add('hidden');
  const report = reportId ? dhState.reports.find((r) => r.id === reportId) : null;
  const t = a.totals;
  const online = a.byChannel.find((c) => c.channel === 'en ligne')?.count || 0;
  const centerName = (typeof getAdminCenter === 'function' && getAdminCenter()?.name) || dhCenterId();

  const kpis = [
    ['Réservations', dhNum(t.reservations)],
    ['Chiffre associé', dhEuroFull(t.revenue)],
    ['Joueurs', dhNum(t.pax)],
    ['Clients uniques', `${a.clients.unique} (${a.clients.new} nouveaux)`],
    ['Panier moyen', dhEuroFull(t.avgBasket)],
    ['Réservations en ligne', `${t.reservations ? Math.round((online / t.reservations) * 100) : 0} %`],
    ['Annulations', `${t.cancelled} (${t.cancelRate} %)`],
    ['Occupation bowling', a.occupancy.rate === null ? '—' : `${a.occupancy.rate} %`],
  ];

  const tableRows = (rows) => rows.map((r) => `<tr>${r.map((c) => `<td>${dhEsc(c)}</td>`).join('')}</tr>`).join('');
  const win = window.open('', '_blank');
  if (!win) { if (typeof toast === 'function') toast('Autorisez les pop-ups pour imprimer le rapport.'); return; }
  win.document.write(`<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
    <title>Rapport direction — ${dhEsc(centerName)}</title>
    <style>
      body { font: 13px/1.55 'Segoe UI', system-ui, sans-serif; color: #0a0a0a; margin: 32px 40px; }
      h1 { font-size: 21px; margin: 0 0 2px; } h2 { font-size: 15px; margin: 26px 0 8px; border-bottom: 1px solid #d9d9d9; padding-bottom: 4px; }
      .meta { color: #666; margin-bottom: 20px; }
      .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
      .kpi { border: 1px solid #e5e5e5; border-radius: 8px; padding: 10px 12px; }
      .kpi b { display: block; font-size: 17px; } .kpi span { color: #666; font-size: 11.5px; }
      table { width: 100%; border-collapse: collapse; margin-top: 6px; }
      th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid #ececec; font-size: 12px; }
      th { color: #666; font-weight: 600; background: #fafafa; }
      .report { border: 1px solid #e5e5e5; border-radius: 8px; padding: 14px 18px; margin-top: 6px; }
      .report h3 { font-size: 14px; margin: 0 0 8px; } .report h4 { font-size: 12.5px; margin: 12px 0 4px; }
      .report ul { margin: 4px 0; padding-left: 18px; }
      footer { margin-top: 28px; color: #8a8a8a; font-size: 11px; border-top: 1px solid #ececec; padding-top: 8px; }
      @media print { body { margin: 12mm; } }
    </style></head><body>
    <h1>Rapport direction — ${dhEsc(centerName)}</h1>
    <div class="meta">Période : ${dhDateFr(a.startDate)} → ${dhDateFr(a.endDate)} · généré le ${dhDateFr(dhToday())} · Pinlane</div>
    <div class="kpis">${kpis.map(([k, v]) => `<div class="kpi"><span>${dhEsc(k)}</span><b>${dhEsc(v)}</b></div>`).join('')}</div>
    <h2>Activités &amp; formules</h2>
    <table><thead><tr><th>Type</th><th>Libellé</th><th>Réservations</th><th>Joueurs</th><th>Chiffre</th></tr></thead><tbody>
      ${tableRows(Object.entries(a.byType).map(([type, v]) => ['Activité', DH_TYPE_META[type]?.label || type, dhNum(v.count), dhNum(v.pax), dhEuroFull(v.revenue)]))}
      ${tableRows(a.byFormule.map((f) => ['Formule', f.label, dhNum(f.count), dhNum(f.pax), dhEuroFull(f.revenue)]))}
    </tbody></table>
    <h2>Clients fidèles</h2>
    <table><thead><tr><th>Client</th><th>Visites</th><th>Chiffre</th><th>Dernière visite</th><th>Contact</th></tr></thead><tbody>
      ${tableRows(a.clients.top.slice(0, 10).map((c) => [c.name, c.visits, dhEuroFull(c.revenue), dhDateFr(c.lastVisit), c.phone || c.email || '—']))}
    </tbody></table>
    ${report ? `<h2>Bilan ${report.periodType === 'week' ? 'hebdomadaire' : 'mensuel'}</h2><div class="report">${dhMdToHtml(report.bodyMd)}</div>` : ''}
    <footer>Document généré par Pinlane à partir des données réelles de réservation. Diffusion interne.</footer>
    <script>window.onload = () => window.print();</script>
    </body></html>`);
  win.document.close();
}

// ---------------------------------------------------------------------------
// Tooltip partagé + init
// ---------------------------------------------------------------------------

function dhEnsureTooltip() {
  let tip = document.getElementById('dhTooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'dhTooltip';
    tip.className = 'dh-tooltip hidden';
    document.body.appendChild(tip);
  }
  return tip;
}

function initAdminDataTab() {
  const root = document.getElementById('adminContent');
  if (!root || root.dataset.dhBound === '1') { loadAdminDataHub(); return; }
  root.dataset.dhBound = '1';
  const tip = dhEnsureTooltip();
  root.addEventListener('mouseover', (event) => {
    const target = event.target.closest('[data-tip]');
    if (!target) { tip.classList.add('hidden'); return; }
    tip.textContent = target.dataset.tip;
    tip.classList.remove('hidden');
    const rect = target.getBoundingClientRect();
    tip.style.left = `${Math.min(rect.left + rect.width / 2, window.innerWidth - 130)}px`;
    tip.style.top = `${rect.top - 8}px`;
  });
  root.addEventListener('mouseleave', () => tip.classList.add('hidden'));
  document.addEventListener('click', (event) => {
    const menu = document.getElementById('dhExportMenu');
    if (menu && !menu.classList.contains('hidden') && !event.target.closest('.dh-controls')) {
      menu.classList.add('hidden');
    }
  });
  loadAdminDataHub();
}

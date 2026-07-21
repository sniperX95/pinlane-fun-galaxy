function getAdminPeriodRangeFor(period = state.adminPeriod || 'day', anchor = state.adminDate || todayStr()) {
  if (period === 'week') {
    const startDate = startOfWeek(anchor);
    const endDate = addDays(startDate, 6);
    return { period, startDate, endDate, days: getDateRangeDays(startDate, endDate), label: 'Semaine' };
  }
  if (period === 'month') {
    const startDate = startOfMonth(anchor);
    const endDate = endOfMonth(anchor);
    return { period, startDate, endDate, days: getDateRangeDays(startDate, endDate), label: parseLocalDate(anchor).toLocaleDateString('fr-BE', { month: 'long', year: 'numeric' }) };
  }
  if (period === 'year') {
    const startDate = startOfYear(anchor);
    const endDate = endOfYear(anchor);
    return { period, startDate, endDate, days: getDateRangeDays(startDate, endDate), label: String(parseLocalDate(anchor).getFullYear()) };
  }
  return { period: 'day', startDate: anchor, endDate: anchor, days: [anchor], label: parseLocalDate(anchor).toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) };
}

function getAdminPeriodRange() {
  return getAdminPeriodRangeFor(state.adminPeriod || 'day', state.adminDate || todayStr());
}

function formatAdminPeriodLabel(range = getAdminPeriodRange()) {
  if (range.startDate === range.endDate) return range.label;
  return `${parseLocalDate(range.startDate).toLocaleDateString('fr-BE', { day: '2-digit', month: 'short', year: 'numeric' })} - ${parseLocalDate(range.endDate).toLocaleDateString('fr-BE', { day: '2-digit', month: 'short', year: 'numeric' })}`;
}

function getAdminRangeCacheKey(centerId = state.adminCenterId || 'libramont', range = getAdminPeriodRange()) {
  return `${centerId || 'libramont'}|${range.startDate}|${range.endDate}`;
}

function getAdminOpsCacheKey(centerId = state.adminCenterId || 'libramont', range = null) {
  const resolvedRange = range || (state.view === 'admin'
    ? getAdminPeriodRange()
    : { startDate: state.currentDate || todayStr(), endDate: state.currentDate || todayStr() });
  return `${centerId || 'libramont'}|${resolvedRange.startDate}|${resolvedRange.endDate}`;
}

function isAdminDashboardCacheCurrent(cache = adminDashboardCache) {
  const range = getAdminPeriodRange();
  return Boolean(
    cache?.loaded &&
    cache.centerId === (state.adminCenterId || 'libramont') &&
    cache.startDate === range.startDate &&
    cache.endDate === range.endDate
  );
}

function mergeAdminOpsIntoDashboard(base, opsCache = null) {
  const ops = opsCache || {};
  return {
    ...base,
    communications: ops.communications || base.communications || [],
    suggestions: ops.suggestions || base.suggestions || [],
    events: ops.events || base.events || [],
    samples: ops.samples || base.samples || [],
    agentStack: ops.agentStack || base.agentStack || null,
    opsHealth: ops.opsHealth || base.opsHealth || null,
    simulation: ops.simulation || base.simulation || null,
    // Honnêteté : le serveur dit si les chiffres viennent des essais internes
    // (même doctrine que bundle.testData du cockpit fondateur). Tant que le
    // flag n'est pas arrivé, on n'affirme rien (undefined = pas de bandeau).
    testData: ops.testData !== undefined ? ops.testData : base.testData,
    lastLoadedAt: ops.lastLoadedAt || base.lastLoadedAt || ''
  };
}

function getAdminStatusLabel(status = '') {
  return {
    pending: 'Confirmé',
    confirmed: 'Confirmé',
    arrived: 'Arrivé',
    paid: 'Payé',
    cancelled: 'Annulé',
  }[status] || status || 'Inconnu';
}

function getAdminResourceText(reservation) {
  const bowlingWindows = getBowlingWindowsFromReservation(reservation);
  const laserWindows = getLaserWindowsFromReservation(reservation);
  const parts = [];
  if (bowlingWindows.length) {
    const lanes = [...new Set(bowlingWindows.flatMap(window => window.lanes || []))].sort((a, b) => a - b);
    const first = bowlingWindows[0];
    parts.push(`Bowling ${formatClockDisplay(first.start)}-${formatClockDisplay(first.end)}${lanes.length ? ` • pistes ${lanes.join(', ')}` : ''}`);
  }
  if (laserWindows.length) {
    const launches = laserWindows.map(window => `${formatClockDisplay(window.start)}-${formatClockDisplay(window.end)}`).join(', ');
    parts.push(`Laser ${launches}`);
  }
  return parts.join(' | ') || 'Hors ressource critique';
}

async function copyAdminSummary() {
  const text = JSON.stringify(getAdminExportPayload().metrics, null, 2);
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand('copy');
      textarea.remove();
      if (!copied) throw new Error('Clipboard indisponible.');
    }
    toast('Résumé copié.');
  } catch (error) {
    toast("Copie impossible. Réessaie depuis un navigateur autorisé.");
  }
}

window.copyAdminSummary = copyAdminSummary;

function getAdminResourceHtml(reservation) {
  const plan = reservation?.opsPlan;
  const resourceText = getAdminResourceText(reservation);
  if (!plan) return escapeHtml(resourceText);
  const fixed = getOpsPlanFixedCommitments(plan).slice(0, 3).map(formatOpsCommitment).filter(Boolean);
  const flexible = [...new Set(getOpsPlanFlexibleEntitlements(plan).map(item => item.label || item.type).filter(Boolean))].slice(0, 3);
  const quality = Number(plan.marketIntelligence?.qualityScore);
  const sub = [
    fixed.length ? `Fixe: ${fixed.join(' · ')}` : '',
    flexible.length ? `Libre: ${flexible.join(' · ')}` : '',
    Number.isFinite(quality) ? `Qualité ${Math.round(quality)}/100` : '',
  ].filter(Boolean);
  return `<div class="admin-plan-cell">
    <div class="admin-plan-main">${escapeHtml(resourceText)}</div>
    ${sub.length ? `<div class="admin-plan-sub">${escapeHtml(sub.join(' | '))}</div>` : ''}
  </div>`;
}

function buildAdminMarketMetrics(reservations = []) {
  const active = reservations.filter(reservation => reservation.status !== 'cancelled');
  const withPlan = active.filter(reservation => reservation.opsPlan);
  const fixed = withPlan.reduce((sum, reservation) => sum + getOpsPlanFixedCommitments(reservation.opsPlan).length, 0);
  const flexible = withPlan.reduce((sum, reservation) => sum + getOpsPlanFlexibleEntitlements(reservation.opsPlan).length, 0);
  const guestTracked = active.filter(reservation => getGuestOpsChips(reservation).length > 0).length;
  const waiversOpen = active.filter(reservation => {
    const guest = getReservationGuestOps(reservation);
    return guest.waiverRequired && !guest.waiverDone;
  }).length;
  const qualityScores = withPlan
    .map(reservation => Number(reservation.opsPlan?.marketIntelligence?.qualityScore))
    .filter(Number.isFinite);
  const avgQuality = qualityScores.length
    ? Math.round(qualityScores.reduce((sum, value) => sum + value, 0) / qualityScores.length)
    : null;
  const warningCount = withPlan.reduce((sum, reservation) => sum + (reservation.opsPlan?.marketIntelligence?.warnings?.length || 0), 0);
  const checklistCount = withPlan.reduce((sum, reservation) => sum + (reservation.opsPlan?.operationsChecklist?.length || 0), 0);
  return { withPlan: withPlan.length, fixed, flexible, avgQuality, warningCount, checklistCount, guestTracked, waiversOpen };
}

function getClientProfileKey(reservation) {
  const phone = String(reservation.phone || '').replace(/\D/g, '');
  if (phone) return `tel:${phone}`;
  const email = String(reservation.email || '').trim().toLowerCase();
  if (email) return `mail:${email}`;
  return `name:${String(reservation.name || 'client').trim().toLowerCase()}`;
}

function buildAdminClientProfiles(reservations = []) {
  const groups = new Map();
  reservations
    .filter(reservation => reservation.status !== 'cancelled')
    .forEach(reservation => {
      const key = getClientProfileKey(reservation);
      const profile = groups.get(key) || {
        key,
        name: reservation.name || 'Client',
        phone: reservation.phone || '',
        email: reservation.email || '',
        visits: 0,
        players: 0,
        revenue: 0,
        formulas: 0,
        bowling: 0,
        laser: 0,
        waiversOpen: 0,
        lastDate: reservation.date || '',
        nextDate: reservation.date || '',
      };
      profile.name = profile.name || reservation.name || 'Client';
      profile.phone = profile.phone || reservation.phone || '';
      profile.email = profile.email || reservation.email || '';
      profile.visits += 1;
      profile.players += Number(reservation.pax || 0);
      profile.revenue += Number(reservation.price || 0);
      if (reservation.type === 'formule' || reservation.formuleId) profile.formulas += 1;
      if (getBowlingWindowsFromReservation(reservation).length) profile.bowling += 1;
      if (getLaserWindowsFromReservation(reservation).length || getLaserGameCountForReservation(reservation) > 0) profile.laser += 1;
      const guest = getReservationGuestOps(reservation);
      if (guest.waiverRequired && !guest.waiverDone) profile.waiversOpen += 1;
      if (!profile.lastDate || reservation.date > profile.lastDate) profile.lastDate = reservation.date;
      if (!profile.nextDate || reservation.date < profile.nextDate) profile.nextDate = reservation.date;
      groups.set(key, profile);
    });
  return [...groups.values()].map(profile => {
    const segment = profile.revenue >= 500 || profile.visits >= 4
      ? 'VIP'
      : profile.formulas >= 2 || profile.players >= 18
        ? 'Groupe'
        : profile.visits >= 2
          ? 'Récurrent'
          : 'Nouveau';
    const action = profile.waiversOpen
      ? 'Valider consignes laser'
      : profile.formulas
          ? 'Proposer anniversaire / formule'
          : profile.laser
            ? 'Proposer pack Laser'
            : 'Relance simple';
    return { ...profile, segment, action };
  }).sort((left, right) => right.revenue - left.revenue || right.visits - left.visits || left.name.localeCompare(right.name));
}

function getAdminExportPayload() {
  const center = getAdminCenter();
  const range = getAdminPeriodRange();
  const cached = adminSnapshotCache[getAdminRangeCacheKey(center.id, range)];
  const opsCache = adminOpsCacheByCenter[getAdminOpsCacheKey(center.id)];
  const snapshot = (isAdminDashboardCacheCurrent() ? adminDashboardCache.snapshot : cached?.snapshot) || { reservations: [], laneStatuses: {} };
  return {
    exportedAt: new Date().toISOString(),
    center,
    date: state.adminDate,
    period: range,
    metrics: buildAdminMetrics(snapshot.reservations || [], center),
    reservations: snapshot.reservations || [],
    laneStatuses: snapshot.laneStatuses || {},
    communications: opsCache?.communications || adminDashboardCache.communications || [],
    suggestions: opsCache?.suggestions || adminDashboardCache.suggestions || [],
    events: opsCache?.events || adminDashboardCache.events || [],
    agentStack: opsCache?.agentStack || adminDashboardCache.agentStack || null,
    simulation: opsCache?.simulation || adminDashboardCache.simulation || null,
    knowledge: adminDashboardCache.knowledge || cached?.knowledge || null,
  };
}

// downloadTextFile vit dans app-main.js (C14) : les exports CSV staff en ont
// besoin sans que la console admin soit chargée.

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// csvCell vit dans app-main.js (C14) : partagé avec les exports CSV staff.

function exportAdminCsv() {
  exportAdminExcel();
}

function exportAdminJson() {
  const payload = getAdminExportPayload();
  downloadTextFile(`fungalaxy-${payload.center.id}-${payload.period.startDate}-${payload.period.endDate}-direction.json`, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
}

function escapeXml(value = '') {
  return String(value ?? '').replace(/[<>&'"]/g, char => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    "'": '&apos;',
    '"': '&quot;',
  }[char]));
}

function excelCell(value, styleId = '') {
  const isNumber = typeof value === 'number' && Number.isFinite(value);
  const style = styleId ? ` ss:StyleID="${styleId}"` : '';
  return `<Cell${style}><Data ss:Type="${isNumber ? 'Number' : 'String'}">${escapeXml(isNumber ? value : value ?? '')}</Data></Cell>`;
}

function excelRow(values = [], styleId = '') {
  return `<Row>${values.map(value => excelCell(value, styleId)).join('')}</Row>`;
}

function excelSheet(name, rows, widths = []) {
  const cols = widths.map(width => `<Column ss:Width="${Number(width) || 110}"/>`).join('');
  return `<Worksheet ss:Name="${escapeXml(name.slice(0, 31))}"><Table>${cols}${rows.join('')}</Table></Worksheet>`;
}

function groupSum(list, keyFn, valueFn = () => 1) {
  return list.reduce((acc, item) => {
    const key = keyFn(item);
    acc[key] = (acc[key] || 0) + (Number(valueFn(item)) || 0);
    return acc;
  }, {});
}

function objectRows(object, headers = ['Clé', 'Valeur']) {
  return [headers, ...Object.entries(object).map(([key, value]) => [key, value])];
}

function buildAdminExcelXml(payload) {
  const reservations = (payload.reservations || []).filter(reservation => reservation.status !== 'cancelled');
  const metrics = payload.metrics;
  const center = payload.center;
  const periodLabel = formatAdminPeriodLabel(payload.period);
  const byDateRevenue = groupSum(reservations, reservation => reservation.date || 'sans date', reservation => reservation.price || 0);
  const byDatePlayers = groupSum(reservations, reservation => reservation.date || 'sans date', reservation => reservation.pax || 0);
  const byStatusRevenue = groupSum(reservations, reservation => getAdminStatusLabel(reservation.status), reservation => reservation.price || 0);
  const byPaymentRevenue = groupSum(reservations, reservation => reservation.paymentMethod || (reservation.status === 'paid' ? 'Comptoir' : 'Sur place'), reservation => reservation.price || 0);
  const byOfferRevenue = groupSum(reservations, reservation => getReservationLabel(reservation), reservation => reservation.price || 0);
  const bowlingRows = reservations.flatMap(reservation => getBowlingWindowsFromReservation(reservation).map(window => [
    reservation.date,
    reservation.name,
    formatClockDisplay(window.start),
    formatClockDisplay(window.end),
    (window.lanes || []).join(', '),
    reservation.pax || 0,
    getReservationLabel(reservation),
    getAdminStatusLabel(reservation.status),
  ]));
  const laserRows = reservations.flatMap(reservation => getLaserWindowsFromReservation(reservation).map(window => [
    reservation.date,
    reservation.name,
    formatClockDisplay(window.start),
    formatClockDisplay(window.end),
    Number(window.players || reservation.pax || 0),
    getReservationLabel(reservation),
    getAdminStatusLabel(reservation.status),
  ]));
  const summaryRows = [
    excelRow(['FUN GALAXY - RAPPORT DIRECTION'], 'Title'),
    excelRow([center.name, periodLabel, `Export ${new Date(payload.exportedAt).toLocaleString('fr-BE')}`], 'Subtle'),
    excelRow([]),
    excelRow(['Indicateur', 'Valeur', 'Lecture'], 'Header'),
    excelRow(['Réservations', metrics.reservations, `${metrics.pendingCount} à venir / ${metrics.arrivedCount} sur place / ${metrics.paidCount} payées`]),
    excelRow(['Joueurs', metrics.players, `${metrics.formulaCount} réservation(s) formule`]),
    excelRow(['Chiffre prévu', metrics.revenue, 'Montant total estimé sur la période'], 'Money'),
    excelRow(['Encaissé', metrics.collected, 'Réservations marquées payées'], 'Money'),
    excelRow(['Ticket moyen', metrics.avgTicket, 'CA / réservations actives'], 'Money'),
    excelRow(['Occupation bowling', Math.round(metrics.bowlingOccupancy), `${Math.round(metrics.laneHours)}h piste / ${Math.round(metrics.bowlingCapacity)}h capacité`]),
    excelRow(['Occupation laser', Math.round(metrics.laserOccupancy), `${metrics.laserLaunches} lancement(s) / ${metrics.laserPlayers} passages`]),
    excelRow(['Mails envoyés', metrics.sentMails, `${metrics.queuedMails} en file / ${metrics.failedMails} en échec`]),
    excelRow(['Signaux agents', metrics.suggestions, `${metrics.events} événement(s) terrain`]),
  ];
  const reservationRows = [
    excelRow(['Date', 'Heure', 'Client', 'Téléphone', 'Email', 'Offre', 'Type', 'Joueurs', 'Statut', 'Paiement', 'Montant', 'Ressources', 'Consignes', 'Check-in', 'Risque', 'Validation'], 'Header'),
    ...reservations.map(reservation => {
      const guest = getReservationGuestOps(reservation);
      return excelRow([
      reservation.date,
      reservation.startTime,
      reservation.name,
      reservation.phone || '',
      reservation.email || '',
      getReservationLabel(reservation),
      reservation.type || '',
      Number(reservation.pax || 0),
      getAdminStatusLabel(reservation.status),
      reservation.paymentMethod || '',
      Number(reservation.price || 0),
      getAdminResourceText(reservation),
      guest.waiverRequired ? (guest.waiverDone ? 'OK' : 'A valider') : 'Non requis',
      guest.checkInDone ? 'OK' : guest.checkInCode,
      reservation.riskLevel || 'normal',
      reservation.validationStatus || '',
    ]);
    })
  ];
  const clientProfiles = buildAdminClientProfiles(reservations);
  const clientRows = [
    excelRow(['Client', 'Téléphone', 'Email', 'Segment', 'Visites', 'Joueurs', 'CA', 'Formules', 'Bowling', 'Laser', 'Consignes ouvertes', 'Action suivante'], 'Header'),
    ...(clientProfiles.length ? clientProfiles.map(profile => excelRow([
      profile.name,
      profile.phone,
      profile.email,
      profile.segment,
      profile.visits,
      profile.players,
      profile.revenue,
      profile.formulas,
      profile.bowling,
      profile.laser,
      profile.waiversOpen,
      profile.action,
    ])) : [excelRow(['Aucun profil client sur la période'])])
  ];
  const accountingRows = [
    excelRow(['Compta - synthèses exploitables'], 'Title'),
    excelRow(['Période', periodLabel, center.name], 'Subtle'),
    excelRow([]),
    excelRow(['CA par date', '', ''], 'Section'),
    ...objectRows(byDateRevenue, ['Date', 'CA prévu']).map((row, index) => excelRow(row, index === 0 ? 'Header' : '')),
    excelRow([]),
    excelRow(['Joueurs par date', '', ''], 'Section'),
    ...objectRows(byDatePlayers, ['Date', 'Joueurs']).map((row, index) => excelRow(row, index === 0 ? 'Header' : '')),
    excelRow([]),
    excelRow(['CA par statut', '', ''], 'Section'),
    ...objectRows(byStatusRevenue, ['Statut', 'CA']).map((row, index) => excelRow(row, index === 0 ? 'Header' : '')),
    excelRow([]),
    excelRow(['CA par moyen de paiement', '', ''], 'Section'),
    ...objectRows(byPaymentRevenue, ['Paiement', 'CA']).map((row, index) => excelRow(row, index === 0 ? 'Header' : '')),
    excelRow([]),
    excelRow(['CA par offre', '', ''], 'Section'),
    ...objectRows(byOfferRevenue, ['Offre', 'CA']).map((row, index) => excelRow(row, index === 0 ? 'Header' : '')),
  ];
  const bowlingSheetRows = [
    excelRow(['Date', 'Client', 'Début', 'Fin', 'Pistes', 'Joueurs', 'Offre', 'Statut'], 'Header'),
    ...(bowlingRows.length ? bowlingRows.map(row => excelRow(row)) : [excelRow(['Aucun bloc bowling sur la période'])])
  ];
  const laserSheetRows = [
    excelRow(['Date', 'Client', 'Début', 'Fin', 'Joueurs laser', 'Offre', 'Statut'], 'Header'),
    ...(laserRows.length ? laserRows.map(row => excelRow(row)) : [excelRow(['Aucun lancement laser sur la période'])])
  ];
  const visibleCommunications = getVisibleOpsCommunications(payload.communications || []);
  const communicationsRows = [
    excelRow(['Statut', 'Planifié', 'Envoyé', 'Destinataire', 'Sujet', 'Modèle', 'Tentatives', 'Erreur'], 'Header'),
    ...visibleCommunications.map(item => excelRow([
      item.status || '',
      formatOpsTimestamp(item.scheduledAt || item.createdAt),
      formatOpsTimestamp(item.sentAt),
      item.recipient || '',
      item.subject || '',
      getOpsTemplateLabel(item.templateId),
      Number(item.attempts || 0),
      item.lastError || '',
    ]))
  ];
  const agentsRows = [
    excelRow(['Sévérité', 'Confiance', 'Agent', 'Statut', 'Type', 'Message'], 'Header'),
    ...(payload.suggestions || []).map(item => excelRow([
      item.severity || '',
      Math.round(Number(item.confidence || 0) * 100),
      item.agentId || '',
      item.status || '',
      item.suggestionType || '',
      item.payload?.recommendation || item.payload?.message || item.payload?.reason || '',
    ]))
  ];
  // A7 : couleurs alignées sur les tokens light de DESIGN.md (texte #0a0a0a,
  // muted #666666, page #fafafa, subtle #f2f2f2, accent-soft #e8f1fd +
  // accent-strong #0761d1). Police Excel (Aptos) tolérée : Geist n'existe pas
  // dans les postes Office, seules les COULEURS portent le système.
  const styles = `
    <Styles>
      <Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Center"/><Font ss:FontName="Aptos" ss:Size="10" ss:Color="#0A0A0A"/></Style>
      <Style ss:ID="Title"><Font ss:FontName="Aptos Display" ss:Size="18" ss:Bold="1" ss:Color="#0A0A0A"/><Interior ss:Color="#F2F2F2" ss:Pattern="Solid"/></Style>
      <Style ss:ID="Subtle"><Font ss:FontName="Aptos" ss:Size="10" ss:Color="#666666"/><Interior ss:Color="#FAFAFA" ss:Pattern="Solid"/></Style>
      <Style ss:ID="Header"><Font ss:FontName="Aptos" ss:Size="10" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#0A0A0A" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/></Style>
      <Style ss:ID="Section"><Font ss:FontName="Aptos" ss:Size="11" ss:Bold="1" ss:Color="#0761D1"/><Interior ss:Color="#E8F1FD" ss:Pattern="Solid"/></Style>
      <Style ss:ID="Money"><NumberFormat ss:Format="#,##0&quot; €&quot;"/></Style>
    </Styles>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 ${styles}
 ${excelSheet('Synthese', summaryRows, [220, 130, 360])}
 ${excelSheet('Reservations', reservationRows, [80, 70, 150, 120, 190, 150, 90, 70, 90, 110, 80, 280, 120, 100, 120, 95, 110])}
 ${excelSheet('Clients CRM', clientRows, [150, 120, 190, 90, 70, 70, 90, 70, 70, 70, 100, 100, 220])}
 ${excelSheet('Compta', accountingRows, [220, 120, 220])}
 ${excelSheet('Bowling', bowlingSheetRows, [80, 150, 70, 70, 90, 70, 150, 90])}
 ${excelSheet('Laser', laserSheetRows, [80, 150, 70, 70, 90, 150, 90])}
 ${excelSheet('Mails', communicationsRows, [90, 120, 120, 190, 260, 150, 80, 260])}
 ${excelSheet('Agents', agentsRows, [90, 80, 120, 90, 150, 420])}
</Workbook>`;
}

function exportAdminExcel() {
  if (!adminDashboardCache.loaded) { toast('Direction en cours de chargement : patientez avant d\'exporter.'); return; }
  const payload = getAdminExportPayload();
  const xml = buildAdminExcelXml(payload);
  const blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8' });
  downloadBlob(`FunGalaxy_${payload.center.id}_${payload.period.startDate}_${payload.period.endDate}_direction_compta.xls`, blob);
}

function buildFunGalaxyReportHtml(payload) {
  const metrics = payload.metrics;
  const periodLabel = formatAdminPeriodLabel(payload.period);
  const reservations = (payload.reservations || []).filter(reservation => reservation.status !== 'cancelled');
  const insights = buildAdminInsights(metrics, payload.center);
  const topReservations = reservations.slice(0, 24);
  const marketMetrics = buildAdminMarketMetrics(reservations);
  const clientProfiles = buildAdminClientProfiles(reservations);
  const generatedAt = new Date(payload.exportedAt).toLocaleString('fr-BE');
  const logoMarkup = `<span class="logo-box"><img src="${FUN_GALAXY_LOGO_URL}" alt="Fun Galaxy"></span>`;
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>Rapport Direction - ${escapeHtml(payload.center.name)} - ${escapeHtml(periodLabel)}</title>
  <style>
    /* A7 : palette = tokens light DESIGN.md (page #fafafa, texte #0a0a0a,
       muted #666, line #ebebeb, accent #0070f3), stack Geist + fallbacks
       système (document autonome : pas de webfont embarquée). */
    @page { size: A4; margin: 18mm; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #fafafa; color: #0a0a0a; font-family: Geist, system-ui, -apple-system, 'Segoe UI', sans-serif; }
    .page { width: 210mm; min-height: 297mm; margin: 0 auto; padding: 18mm; background: #fff; border-left: 1px solid #ebebeb; border-right: 1px solid #ebebeb; }
    .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 28px; border-bottom: 2px solid #0a0a0a; padding-bottom: 18px; }
    .logo-box { display: inline-flex; align-items: center; justify-content: center; width: 160px; height: 92px; padding: 14px 18px; background: #0a0a0a; border: 1.5px solid #0a0a0a; border-radius: 8px; }
    .logo-box img { display: block; max-width: 100%; max-height: 100%; object-fit: contain; opacity: 1; filter: none; }
    .report-title { margin-top: 16px; }
    .eyebrow { font-size: 10px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: #666; }
    h1 { margin: 6px 0 0; font-size: 30px; letter-spacing: -.02em; line-height: 1; font-weight: 600; }
    h2 { margin: 0 0 10px; font-size: 15px; letter-spacing: -.02em; font-weight: 600; }
    .meta { text-align: right; font-size: 11px; line-height: 1.6; color: #666; font-weight: 500; }
    .company { margin-top: 12px; padding: 12px; border: 1px solid #ebebeb; background: #fafafa; font-size: 11px; line-height: 1.55; color: #666; }
    .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 9px; margin: 18px 0; }
    .kpi { border: 1px solid #ebebeb; padding: 12px; background: #fafafa; min-height: 74px; }
    .kpi .k { font-size: 9px; letter-spacing: .05em; text-transform: uppercase; color: #666; font-weight: 700; }
    .kpi .v { margin-top: 7px; font-size: 22px; font-weight: 700; letter-spacing: -.02em; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 14px; }
    .box { border: 1px solid #ebebeb; padding: 14px; break-inside: avoid; }
    .signal { display: grid; grid-template-columns: 10px 1fr; gap: 9px; padding: 9px 0; border-bottom: 1px solid #ebebeb; }
    .signal:last-child { border-bottom: 0; }
    .dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 4px; background: #0070f3; }
    .signal.high .dot { background: #cb2a2f; }
    .signal.good .dot { background: #0f7b3c; }
    .signal strong { display: block; font-size: 12px; }
    .signal span { display: block; font-size: 11px; color: #666; line-height: 1.45; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 10px; }
    th { background: #0a0a0a; color: #fff; text-align: left; padding: 7px; font-size: 8px; letter-spacing: .05em; text-transform: uppercase; }
    td { border-bottom: 1px solid #ebebeb; padding: 7px; vertical-align: top; color: #0a0a0a; line-height: 1.35; }
    td strong { color: #0a0a0a; }
    .footer { margin-top: 18px; padding-top: 12px; border-top: 1px solid #ebebeb; font-size: 10px; color: #666; display: flex; justify-content: space-between; gap: 20px; }
    .print { position: fixed; right: 18px; bottom: 18px; padding: 10px 14px; border-radius: 6px; border: 0; background: #0a0a0a; color: #fff; font-weight: 600; cursor: pointer; font-family: inherit; }
    @media print { body { background: #fff; } .page { width: auto; min-height: auto; margin: 0; padding: 0; } .print { display: none; } }
  </style>
</head>
<body>
  <button class="print" onclick="window.print()">Imprimer / PDF</button>
  <main class="page">
    <section class="top">
      <div>
        ${logoMarkup}
        <div class="report-title">
          <div class="eyebrow">Rapport direction</div>
          <h1>${escapeHtml(payload.center.name)}</h1>
        </div>
      </div>
      <div class="meta">
        Période<br><strong>${escapeHtml(periodLabel)}</strong><br><br>
        Généré le<br><strong>${escapeHtml(generatedAt)}</strong><br><br>
        Centre<br><strong>${escapeHtml(payload.center.status || 'active')}</strong>
      </div>
    </section>
    <div class="company">
      <strong>Fun Galaxy - document interne direction.</strong><br>
      Centres suivis: Libramont, Gembloux. Site: fungalaxy.be.
    </div>
    <section class="kpis">
      <div class="kpi"><div class="k">Réservations</div><div class="v">${metrics.reservations}</div></div>
      <div class="kpi"><div class="k">Joueurs</div><div class="v">${metrics.players}</div></div>
      <div class="kpi"><div class="k">CA prévu</div><div class="v">${formatMoney(metrics.revenue)}</div></div>
      <div class="kpi"><div class="k">Encaissé</div><div class="v">${formatMoney(metrics.collected)}</div></div>
      <div class="kpi"><div class="k">Ticket moyen</div><div class="v">${formatMoney(metrics.avgTicket)}</div></div>
      <div class="kpi"><div class="k">Bowling</div><div class="v">${formatAdminPercent(metrics.bowlingOccupancy)}</div></div>
      <div class="kpi"><div class="k">Laser</div><div class="v">${formatAdminPercent(metrics.laserOccupancy)}</div></div>
      <div class="kpi"><div class="k">Engagement</div><div class="v">${marketMetrics.guestTracked}</div></div>
    </section>
    <section class="grid">
      <div class="box">
        <h2>Lecture opérationnelle</h2>
        ${insights.map(item => `<div class="signal ${escapeHtml(item.level)}"><span class="dot"></span><div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.text)}</span></div></div>`).join('')}
      </div>
      <div class="box">
        <h2>Répartition</h2>
        <table>
          <tr><th>Bloc</th><th>Valeur</th></tr>
          <tr><td>Formules</td><td><strong>${metrics.formulaCount}</strong></td></tr>
          <tr><td>Bowling direct</td><td><strong>${metrics.directBowling}</strong></td></tr>
          <tr><td>Laser direct</td><td><strong>${metrics.directLaser}</strong></td></tr>
          <tr><td>Clients uniques</td><td><strong>${clientProfiles.length}</strong></td></tr>
          <tr><td>Consignes ouvertes</td><td><strong>${marketMetrics.waiversOpen}</strong></td></tr>
          <tr><td>Signaux agents</td><td><strong>${metrics.suggestions}</strong></td></tr>
          <tr><td>Mails en échec</td><td><strong>${metrics.failedMails}</strong></td></tr>
        </table>
      </div>
    </section>
    <section class="box" style="margin-top:14px;">
      <h2>Réservations principales</h2>
      <table>
        <thead><tr><th>Date</th><th>Heure</th><th>Client</th><th>Offre</th><th>Ressources</th><th>Engagement</th><th>Statut</th><th>Montant</th></tr></thead>
        <tbody>
          ${topReservations.map(reservation => {
            const guest = getReservationGuestOps(reservation);
            const engagement = [
              guest.waiverRequired ? (guest.waiverDone ? 'Consignes OK' : 'Consignes a valider') : '',
              guest.checkInDone ? 'Check-in OK' : guest.checkInCode,
            ].filter(Boolean).join(' / ');
            return `<tr>
            <td>${escapeHtml(reservation.date || '')}</td>
            <td><strong>${escapeHtml(reservation.startTime || '')}</strong></td>
            <td><strong>${escapeHtml(reservation.name || '')}</strong><br>${escapeHtml(reservation.phone || '')}</td>
            <td>${escapeHtml(getReservationLabel(reservation))}<br>${Number(reservation.pax || 0)} joueur(s)</td>
            <td>${escapeHtml(getAdminResourceText(reservation))}</td>
            <td>${escapeHtml(engagement)}</td>
            <td>${escapeHtml(getAdminStatusLabel(reservation.status))}</td>
            <td><strong>${formatMoney(reservation.price)}</strong></td>
          </tr>`;
          }).join('')}
        </tbody>
      </table>
    </section>
    <div class="footer">
      <span>Rapport généré par le cockpit direction Fun Galaxy.</span>
      <span>Export complet disponible dans le classeur Excel compta.</span>
    </div>
  </main>
</body>
</html>`;
}

function exportAdminReport() {
  if (!adminDashboardCache.loaded) { toast('Direction en cours de chargement : patientez avant d\'exporter.'); return; }
  const payload = getAdminExportPayload();
  const html = buildFunGalaxyReportHtml(payload);
  downloadTextFile(`FunGalaxy_${payload.center.id}_${payload.period.startDate}_${payload.period.endDate}_rapport_direction.html`, html, 'text/html;charset=utf-8');
}

function buildAdminMetrics(reservations = [], center = getAdminCenter()) {
  const activeReservations = reservations.filter(reservation => reservation.status !== 'cancelled');
  const range = getAdminPeriodRange();
  const openHours = range.days.reduce((sum, date) => {
    const windowCfg = getPlanningWindow(date);
    return sum + (windowCfg.closed ? 0 : Math.max(windowCfg.close - windowCfg.open, 0));
  }, 0);
  const bowling = center.resources?.bowling || {};
  const laser = center.resources?.laser || {};
  const laneCount = Number(bowling.laneCount || TOTAL_LANES || 0);
  const weaponCount = Number(laser.weaponCount || LASER_GAME_MAX_PLAYERS || 0);
  const parallelLaunches = Number(laser.parallelLaunches || 1);
  const bowlingWindows = activeReservations.flatMap(reservation => getBowlingWindowsFromReservation(reservation).map(window => ({ ...window, reservation })));
  const laserWindows = activeReservations.flatMap(reservation => getLaserWindowsFromReservation(reservation).map(window => ({ ...window, reservation })));
  const laneHours = bowlingWindows.reduce((sum, window) => sum + ((Number(window.duration) || 0) * Math.max((window.lanes || []).length, 1)), 0);
  const bowlingCapacity = laneCount && openHours ? laneCount * openHours : 0;
  const laserPlayers = laserWindows.reduce((sum, window) => sum + (Number(window.players || window.reservation?.pax) || 0), 0);
  const laserCapacity = weaponCount && openHours ? weaponCount * parallelLaunches * openHours * 2 : 0;
  const revenue = activeReservations.reduce((sum, reservation) => sum + (Number(reservation.price) || 0), 0);
  const collected = activeReservations.filter(reservation => reservation.status === 'paid').reduce((sum, reservation) => sum + (Number(reservation.price) || 0), 0);
  const players = activeReservations.reduce((sum, reservation) => sum + (Number(reservation.pax) || 0), 0);
  const formulaCount = activeReservations.filter(reservation => reservation.type === 'formule' || reservation.formuleId).length;
  const paidCount = activeReservations.filter(reservation => reservation.status === 'paid').length;
  const arrivedCount = activeReservations.filter(reservation => reservation.status === 'arrived').length;
  const pendingCount = activeReservations.filter(reservation => reservation.status === 'pending').length;
  const reviewCount = activeReservations.filter(reservation => reservation.validationStatus === 'staff_review' || reservation.riskLevel === 'high' || reservation.riskLevel === 'critical').length;
  const communications = getVisibleOpsCommunications(adminDashboardCache.communications || []);
  const failedMails = communications.filter(item => item.status === 'failed').length;
  const queuedMails = communications.filter(item => item.status === 'queued').length;
  const sentMails = communications.filter(item => item.status === 'sent' || item.status === 'delivered').length;
  return {
    reservations: activeReservations.length,
    players,
    revenue,
    collected,
    pendingCount,
    arrivedCount,
    paidCount,
    formulaCount,
    directBowling: activeReservations.filter(reservation => reservation.type === 'bowling').length,
    directLaser: activeReservations.filter(reservation => reservation.type === 'laser').length,
    avgTicket: activeReservations.length ? Math.round(revenue / activeReservations.length) : 0,
    bowlingWindows: bowlingWindows.length,
    laserLaunches: laserWindows.length,
    laserPlayers,
    bowlingOccupancy: bowlingCapacity ? (laneHours / bowlingCapacity) * 100 : 0,
    laserOccupancy: laserCapacity ? (laserPlayers / laserCapacity) * 100 : 0,
    laneHours,
    bowlingCapacity,
    laserCapacity,
    reviewCount,
    failedMails,
    queuedMails,
    sentMails,
    suggestions: (adminDashboardCache.suggestions || []).length,
    events: (adminDashboardCache.events || []).length,
    openLabel: `${formatAdminPeriodLabel(range)} • ${range.days.length} jour${range.days.length > 1 ? 's' : ''}`,
  };
}

function buildAdminInsights(metrics, center) {
  const insights = [];
  if (center.status !== 'active') {
    insights.push({ level: 'high', title: 'Centre pas encore actif', text: 'Les réservations peuvent être consultées, mais les ressources opérationnelles doivent être confirmées avant ouverture.' });
  }
  if (metrics.reviewCount > 0) {
    insights.push({ level: 'high', title: 'Réservations à surveiller', text: `${metrics.reviewCount} réservation(s) avec risque élevé ou validation staff. À traiter avant le rush.` });
  }
  if (metrics.failedMails > 0) {
    insights.push({ level: 'high', title: 'Communication à corriger', text: `${metrics.failedMails} mail(s) en échec. La direction doit relancer ou corriger le destinataire.` });
  }
  if (metrics.bowlingOccupancy >= 75) {
    insights.push({ level: 'medium', title: 'Bowling chargé', text: `Occupation piste estimée à ${formatAdminPercent(metrics.bowlingOccupancy)}. Les retards doivent être absorbés vite.` });
  }
  if (metrics.laserLaunches && center.resources?.laser?.requiresCompleteGroupBeforeLaunch) {
    insights.push({ level: 'medium', title: 'Laser sensible', text: 'Ce centre demande un groupe complet avant lancement. Les arrivées tardives peuvent impacter les formules.' });
  }
  if (!insights.length) {
    insights.push({ level: 'good', title: 'Journée lisible', text: 'Aucun signal critique détecté dans les données disponibles pour ce centre et cette date.' });
  }
  return insights;
}

function countAdminHealthStatus(source = {}, names = []) {
  if (!source || typeof source !== 'object') return 0;
  return names.reduce((sum, name) => sum + Number(source[name] || 0), 0);
}

function getAdminHealthCommunications() {
  const health = adminDashboardCache.opsHealth || opsAdminCache.opsHealth || {};
  const visible = getVisibleOpsCommunications(adminDashboardCache.communications || []);
  const statusCounts = health.communications || {};
  return {
    sent: countAdminHealthStatus(statusCounts, ['sent', 'delivered']) || visible.filter(item => item.status === 'sent' || item.status === 'delivered').length,
    queued: countAdminHealthStatus(statusCounts, ['queued', 'pending', 'draft', 'retry']) || visible.filter(item => ['queued', 'pending', 'draft', 'retry'].includes(item.status)).length,
    failed: countAdminHealthStatus(statusCounts, ['failed', 'error']) || visible.filter(item => item.status === 'failed' || item.status === 'error').length,
    total: visible.length || Object.values(statusCounts).reduce((sum, value) => sum + Number(value || 0), 0)
  };
}

function findAdminBowlingConflicts(reservations = []) {
  const byLane = new Map();
  reservations
    .filter(reservation => reservation.status !== 'cancelled')
    .forEach(reservation => {
      getBowlingWindowsFromReservation(reservation).forEach(window => {
        const lanes = (window.lanes || reservation.lanes || []).map(Number).filter(Boolean);
        lanes.forEach(lane => {
          if (!byLane.has(lane)) byLane.set(lane, []);
          byLane.get(lane).push({
            lane,
            start: Number(window.start),
            end: Number(window.end),
            name: reservation.name || 'Client'
          });
        });
      });
    });

  const conflicts = [];
  byLane.forEach(items => {
    items
      .filter(item => Number.isFinite(item.start) && Number.isFinite(item.end))
      .sort((left, right) => left.start - right.start || left.end - right.end)
      .forEach((item, index, sorted) => {
        const previous = sorted[index - 1];
        if (previous && item.start < previous.end) {
          conflicts.push({ lane: item.lane, current: item, previous });
        }
      });
  });
  return conflicts;
}

function findAdminLaserIssues(reservations = [], center = getAdminCenter()) {
  const laser = center.resources?.laser || {};
  const weaponCount = Number(laser.weaponCount || LASER_GAME_MAX_PLAYERS || 30);
  const parallelLaunches = Number(laser.parallelLaunches || 1);
  const capacity = Math.max(1, weaponCount * Math.max(1, parallelLaunches));
  const buckets = new Map();
  const missing = [];
  reservations
    .filter(reservation => reservation.status !== 'cancelled')
    .forEach(reservation => {
      const windows = getLaserWindowsFromReservation(reservation);
      const expectedLaser = reservation.type === 'laser' || getLaserGameCountForReservation(reservation) > 0;
      if (expectedLaser && !windows.length) missing.push(reservation);
      windows.forEach(window => {
        const key = `${formatClockDisplay(window.start)}-${formatClockDisplay(window.end)}`;
        if (!buckets.has(key)) buckets.set(key, { key, players: 0, groups: 0 });
        const bucket = buckets.get(key);
        bucket.players += Number(window.players || reservation.pax || 0);
        bucket.groups += 1;
      });
    });
  const overCapacity = [...buckets.values()].filter(bucket => bucket.players > capacity);
  return { missing, overCapacity, buckets: [...buckets.values()], capacity };
}

function findAdminReservationIssues(reservations = []) {
  const active = reservations.filter(reservation => reservation.status !== 'cancelled');
  const missingContact = active.filter(reservation => !String(reservation.phone || '').trim() && !String(reservation.email || '').trim());
  const missingResource = active.filter(reservation => {
    const needsBowling = reservation.type === 'bowling' || reservation.type === 'formule' || reservation.formuleId;
    const needsLaser = reservation.type === 'laser' || getLaserGameCountForReservation(reservation) > 0;
    const hasBowling = !needsBowling || getBowlingWindowsFromReservation(reservation).length > 0;
    const hasLaser = !needsLaser || getLaserWindowsFromReservation(reservation).length > 0;
    return !hasBowling || !hasLaser;
  });
  const staffReview = active.filter(reservation => (
    reservation.validationStatus === 'staff_review'
    || reservation.riskLevel === 'high'
    || reservation.riskLevel === 'critical'
  ));
  return { missingContact, missingResource, staffReview };
}

function getAdminDelayHealth() {
  const health = adminDashboardCache.opsHealth || opsAdminCache.opsHealth || {};
  const incidents = Array.isArray(health.delayIncidents) ? health.delayIncidents : [];
  const open = incidents.filter(item => !['applied', 'resolved', 'closed', 'cancelled'].includes(item.status));
  const applied = incidents.filter(item => item.status === 'applied' || item.appliedAt);
  const withoutCommunication = incidents.filter(item => {
    const communications = item.communications;
    if (Array.isArray(communications)) return communications.length === 0;
    if (communications && typeof communications === 'object') return !Object.keys(communications).length;
    return false;
  });
  return { incidents, open, applied, withoutCommunication };
}

function getAdminHealthLevel(status) {
  return {
    ok: 'OK',
    warn: 'À surveiller',
    danger: 'Action',
    unknown: 'Lecture'
  }[status] || 'Lecture';
}

function buildAdminOperationalChecks(snapshot = { reservations: [] }, metrics = {}, center = getAdminCenter()) {
  const reservations = snapshot.reservations || [];
  const mails = getAdminHealthCommunications();
  const bowlingConflicts = findAdminBowlingConflicts(reservations);
  const laserIssues = findAdminLaserIssues(reservations, center);
  const reservationIssues = findAdminReservationIssues(reservations);
  const delayHealth = getAdminDelayHealth();
  const opsHealth = adminDashboardCache.opsHealth || opsAdminCache.opsHealth;

  return [
    {
      key: 'mails',
      title: 'Mails et relances',
      status: !opsHealth && !mails.total ? 'unknown' : mails.failed ? 'danger' : mails.queued ? 'warn' : 'ok',
      value: mails.total ? `${mails.sent}/${mails.total}` : '0',
      detail: mails.failed
        ? `${mails.failed} échec(s) à corriger avant le rush.`
        : mails.queued
          ? `${mails.queued} communication(s) en file ou brouillon.`
          : 'Confirmations et relances sans erreur active.',
    },
    {
      key: 'bowling',
      title: 'Planning bowling',
      status: bowlingConflicts.length ? 'danger' : metrics.bowlingWindows ? 'ok' : 'unknown',
      value: `${metrics.bowlingWindows || 0} bloc(s)`,
      detail: bowlingConflicts.length
        ? `${bowlingConflicts.length} conflit(s) piste détecté(s).`
        : 'Pistes et horaires sans chevauchement détecté.',
    },
    {
      key: 'laser',
      title: 'Planning Laser Game',
      status: laserIssues.overCapacity.length ? 'danger' : laserIssues.missing.length ? 'warn' : metrics.laserLaunches ? 'ok' : 'unknown',
      value: `${metrics.laserLaunches || 0} lancement(s)`,
      detail: laserIssues.overCapacity.length
        ? `${laserIssues.overCapacity.length} session(s) au-dessus de ${laserIssues.capacity} joueurs.`
        : laserIssues.missing.length
          ? `${laserIssues.missing.length} réservation(s) laser sans horaire critique.`
          : 'Sessions laser et capacité cohérentes.',
    },
    {
      key: 'reservations',
      title: 'Réservations',
      status: reservationIssues.missingResource.length ? 'danger' : (reservationIssues.staffReview.length || reservationIssues.missingContact.length) ? 'warn' : 'ok',
      value: `${metrics.reservations || 0} active(s)`,
      detail: reservationIssues.missingResource.length
        ? `${reservationIssues.missingResource.length} réservation(s) sans ressource complète.`
        : reservationIssues.staffReview.length
          ? `${reservationIssues.staffReview.length} réservation(s) à vérifier par le staff.`
          : reservationIssues.missingContact.length
            ? `${reservationIssues.missingContact.length} fiche(s) client à compléter.`
            : 'Données client, ressources et statuts exploitables.',
    },
    {
      key: 'delays',
      title: 'Retards et messages',
      status: delayHealth.open.length ? 'warn' : delayHealth.withoutCommunication.length ? 'warn' : 'ok',
      value: `${delayHealth.applied.length}/${delayHealth.incidents.length}`,
      detail: delayHealth.open.length
        ? `${delayHealth.open.length} retard(s) à arbitrer avant envoi.`
        : delayHealth.withoutCommunication.length
          ? `${delayHealth.withoutCommunication.length} retard(s) sans trace de message.`
          : 'Décalages appliqués sans incident ouvert.',
    }
  ];
}

function renderAdminOperationalHealth(snapshot, metrics, center) {
  const checks = buildAdminOperationalChecks(snapshot, metrics, center);
  const generatedAt = adminDashboardCache.opsHealth?.generatedAt || opsAdminCache.opsHealth?.generatedAt || adminDashboardCache.lastLoadedAt;
  // Trois niveaux, pas deux : un danger ne se resume pas en « A surveiller »
  // ambre. Le resume porte le PIRE etat present, sinon il ment par litote.
  const hasDanger = checks.some(item => item.status === 'danger');
  const hasWarn = checks.some(item => item.status === 'warn');
  const summaryTone = hasDanger ? 'danger' : (hasWarn ? 'warn' : 'ok');
  const summaryLabel = hasDanger ? 'Action requise' : (hasWarn ? 'À surveiller' : 'Tout est stable');
  return `<div class="admin-panel admin-health-panel">
    <div class="admin-section-title admin-health-head">
      <div>
        <h2>Vérifications continues</h2>
        <p>Mails, bowling, laser, réservations et retards contrôlés sur les données actives.</p>
      </div>
      <span class="admin-health-summary ${summaryTone}">
        <span class="admin-health-dot ${summaryTone}"></span>
        ${summaryLabel}
      </span>
    </div>
    ${(hasDanger || hasWarn) ? `<div class="admin-health-grid">
      ${checks.map(item => `<article class="admin-health-card ${escapeHtml(item.status)}">
        <div class="admin-health-card-top">
          <span class="admin-health-dot ${escapeHtml(item.status)}"></span>
          <strong>${escapeHtml(item.title)}</strong>
          <em>${escapeHtml(getAdminHealthLevel(item.status))}</em>
        </div>
        <div class="admin-health-value">${escapeHtml(item.value)}</div>
        <p>${escapeHtml(item.detail)}</p>
      </article>`).join('')}
    </div>` : `<p class="admin-health-clear">Mails, plannings bowling/laser, réservations et retards passent tous les contrôles. Le détail réapparaît dès qu'un point mérite une lecture.</p>`}
    <div class="admin-health-foot">Dernière vérification: ${escapeHtml(formatOpsTimestamp(generatedAt))}. Actualisation automatique quand Direction reste ouverte.</div>
  </div>`;
}

function buildAdminCockpitItems(reservations = []) {
  const active = reservations
    .filter(reservation => reservation.status !== 'cancelled')
    .filter(reservation => !state.adminDate || reservation.date === state.adminDate);
  const items = [];
  active.forEach(reservation => {
    const isFormula = reservation.type === 'formule' || reservation.formuleId;
    const label = getReservationLabel(reservation);
    getBowlingWindowsFromReservation(reservation).forEach(window => {
      const lanes = (window.lanes || reservation.lanes || []).map(Number).filter(Boolean);
      items.push({
        reservation,
        resource: 'bowling',
        kind: isFormula ? 'formula' : 'bowling',
        start: Number(window.start),
        end: Number(window.end),
        title: reservation.name || 'Client',
        line: isFormula ? `${label} · bowling` : `Bowling ${formatDurationLabel(window.duration || reservation.duration || 0)}`,
        meta: lanes.length ? `pistes ${lanes.join(', ')}` : `${Number(reservation.pax || 0)} joueurs`,
      });
    });
    getLaserWindowsFromReservation(reservation).forEach((window, index) => {
      const totalGames = getLaserGameCountForReservation(reservation);
      const passIndex = Number(window.countIndex || index + 1);
      items.push({
        reservation,
        resource: 'laser',
        kind: isFormula ? 'formula laser' : 'laser',
        start: Number(window.start),
        end: Number(window.end),
        title: isFormula ? reservation.name || 'Formule' : reservation.name || 'Laser Game',
        line: isFormula ? `${label} · Laser ${totalGames > 1 ? `${passIndex}/${totalGames}` : ''}`.trim() : `Laser ${totalGames > 1 ? `${passIndex}/${totalGames}` : 'direct'}`,
        meta: `${Number(window.players || reservation.pax || 0)} joueurs`,
      });
    });
  });
  return items
    .filter(item => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start)
    .sort((left, right) => left.start - right.start || left.end - right.end || Number(left.reservation?.id || 0) - Number(right.reservation?.id || 0));
}

function getAdminCockpitMode() {
  return ['today', 'bowling', 'laser', 'direction'].includes(state.adminCockpitMode) ? state.adminCockpitMode : 'today';
}

function setAdminCockpitMode(mode) {
  state.adminCockpitMode = ['today', 'bowling', 'laser', 'direction'].includes(mode) ? mode : 'today';
  save();
  renderAdminDashboard();
}

function filterAdminCockpitItems(items = [], mode = getAdminCockpitMode()) {
  if (mode === 'bowling') return items.filter(item => item.resource === 'bowling');
  if (mode === 'laser') return items.filter(item => item.resource === 'laser');
  if (mode === 'direction') {
    return items.filter(item => (
      item.reservation?.type === 'formule'
      || item.reservation?.formuleId
      || item.reservation?.riskLevel === 'high'
      || item.reservation?.riskLevel === 'critical'
      || item.reservation?.validationStatus === 'staff_review'
    ));
  }
  return items;
}

function buildAdminCockpitRows(items = []) {
  if (!items.length) return [];
  const buckets = new Map();
  items.forEach(item => {
    const bucket = Math.floor(Number(item.start || 0) * 2) / 2;
    const key = bucket.toFixed(2);
    if (!buckets.has(key)) buckets.set(key, { start: bucket, items: [] });
    buckets.get(key).items.push(item);
  });
  return [...buckets.values()]
    .sort((left, right) => left.start - right.start)
    .slice(0, 7);
}

function buildAdminCockpitDecision(metrics, center, marketMetrics) {
  if (!metrics.reservations) {
    return {
      title: 'Journée calme',
      text: 'Aucune réservation active sur cette date. Le moteur reste en surveillance sur les mails, événements et données du centre.',
    };
  }
  if (metrics.failedMails > 0) {
    return {
      title: 'Communication à corriger',
      text: `${metrics.failedMails} mail(s) en échec. Priorité: corriger les destinataires avant de laisser le staff compter sur ces confirmations.`,
    };
  }
  if (metrics.reviewCount > 0) {
    return {
      title: 'Décision staff requise',
      text: `${metrics.reviewCount} réservation(s) à risque ou en validation. Le moteur conseille une lecture humaine avant le rush.`,
    };
  }
  if (marketMetrics.warningCount > 0) {
    return {
      title: 'Plan sous surveillance',
      text: `${marketMetrics.warningCount} alerte(s) opérationnelle(s) détectée(s). Les engagements fixes tiennent, mais le terrain doit surveiller les enchaînements.`,
    };
  }
  if (metrics.laserLaunches && center.resources?.laser?.requiresCompleteGroupBeforeLaunch) {
    return {
      title: 'Laser sensible',
      text: 'Le planning est tenable, mais le Laser Game dépend des groupes complets. Les arrivées tardives peuvent créer du décalage.',
    };
  }
  if (metrics.bowlingOccupancy >= 75 || metrics.laserOccupancy >= 65) {
    return {
      title: 'Rush tenable',
      text: 'Capacité chargée mais exploitable. Les formules et ressources fixes sont lisibles, à condition de tenir les arrivées.',
    };
  }
  return {
    title: 'Plan tenable',
    text: 'Engagements fixes réservés, activités libres gardées comme amortisseur de retard. Aucun signal critique actif.',
  };
}

function buildAdminCockpitActions(reservations = [], metrics = {}) {
  const actions = [];
  if (metrics.failedMails > 0) actions.push(`${metrics.failedMails} mail(s) à corriger avant de rappeler le client.`);
  if (metrics.reviewCount > 0) actions.push(`${metrics.reviewCount} réservation(s) à lire avant validation terrain.`);
  const active = reservations
    .filter(reservation => reservation.status !== 'cancelled')
    .filter(reservation => !state.adminDate || reservation.date === state.adminDate);
  active.forEach(reservation => {
    const guest = getReservationGuestOps(reservation);
    if (guest.waiverRequired && !guest.waiverDone && actions.length < 5) {
      actions.push(`Valider consignes Laser Game pour ${reservation.name}.`);
    }
    const checklist = reservation.opsPlan?.operationsChecklist || [];
    checklist.slice(0, 2).forEach(item => {
      if (actions.length < 5) actions.push(item.title || item.label || item.message || item);
    });
    const warnings = reservation.opsPlan?.marketIntelligence?.warnings || [];
    warnings.slice(0, 1).forEach(item => {
      if (actions.length < 5) actions.push(item.message || item.title || item);
    });
  });
  if (!actions.length && metrics.reservations) {
    actions.push('Surveiller les arrivées, garder le laser groupé et encaisser les réservations terminées.');
  }
  if (!actions.length) {
    actions.push('Aucune action terrain urgente sur la date sélectionnée.');
  }
  return [...new Set(actions.map(item => String(item || '').trim()).filter(Boolean))].slice(0, 4);
}

function getAdminCockpitAgentSnapshot() {
  const payload = adminDashboardCache.agentStack || opsAdminCache.agentStack || {};
  const orchestration = payload.orchestration || {};
  const activations = orchestration.activations || [];
  const runtimeAgents = activations.filter(item => item.mode === 'active' || item.mode === 'monitor' || item.mode === 'collect');
  const footprint = orchestration.footprint || {};
  const dataRead = Number(footprint.reservations || 0)
    + Number(footprint.communications || 0)
    + Number(footprint.events || 0)
    + Number(footprint.suggestions || 0);
  const labels = runtimeAgents
    .slice(0, 3)
    .map(item => item.agentId || item.label || item.mode)
    .filter(Boolean);
  return {
    activeCount: runtimeAgents.length,
    dataRead,
    label: labels.length ? labels.join(' · ') : 'architecture-agent',
    ok: payload.audit?.ok !== false,
    hasStack: Boolean(payload.stack || payload.orchestration),
  };
}

function renderAdminCockpitMetricBar(label, value, className = '') {
  const percent = Math.max(0, Math.min(100, Math.round(Number(value || 0))));
  return `<div class="ops-cockpit-meter-row ${escapeHtml(className)}">
    <span>${escapeHtml(label)}</span>
    <span class="ops-cockpit-bar" style="--value:${percent}%"><span></span></span>
    <strong>${percent}%</strong>
  </div>`;
}

function renderAdminCockpit(metrics, center, reservations = [], marketMetrics = buildAdminMarketMetrics(reservations)) {
  const mode = getAdminCockpitMode();
  const allItems = buildAdminCockpitItems(reservations);
  const items = filterAdminCockpitItems(allItems, mode);
  const rows = buildAdminCockpitRows(items);
  const decision = buildAdminCockpitDecision(metrics, center, marketMetrics);
  const actions = buildAdminCockpitActions(reservations, metrics);
  const mailTotal = metrics.sentMails + metrics.queuedMails + metrics.failedMails;
  const mailHealth = mailTotal ? ((metrics.sentMails / mailTotal) * 100) : 100;
  const tabLabels = [
    ['today', 'Aujourd’hui'],
    ['bowling', 'Bowling'],
    ['laser', 'Laser'],
    ['direction', 'Direction'],
  ];
  return `<section class="ops-cockpit">
    <div class="ops-cockpit-head">
      <div class="ops-cockpit-title">
        <h2>Cockpit opérationnel</h2>
        <p>${escapeHtml(center.name)} · ${escapeHtml(formatAdminPeriodLabel(getAdminPeriodRange()))} · données réelles du planning, des mails et des agents.</p>
      </div>
      <div class="ops-cockpit-tabs" aria-label="Lecture cockpit">
        ${tabLabels.map(([key, label]) => `<button type="button" class="ops-cockpit-tab ${mode === key ? 'active' : ''}" onclick="setAdminCockpitMode('${key}')">${escapeHtml(label)}</button>`).join('')}
      </div>
    </div>
    <div class="ops-cockpit-body">
      <div class="ops-cockpit-board">
        <div class="ops-cockpit-board-head">
          <strong>Planning opérationnel</strong>
          <span>${metrics.formulaCount} formule(s), ${metrics.bowlingWindows} bloc(s) bowling, ${metrics.laserLaunches} session(s) laser</span>
        </div>
        ${rows.length ? `<div class="ops-cockpit-timeline">
          ${rows.map(row => `<div class="ops-cockpit-row">
            <div class="ops-cockpit-hour">${escapeHtml(formatClockDisplay(row.start))}</div>
            <div class="ops-cockpit-slots">
              ${row.items.slice(0, 4).map(item => `<article class="ops-cockpit-event ${escapeHtml(item.kind)}">
                <strong>${escapeHtml(item.title)}</strong>
                <span>${escapeHtml(item.line)}</span>
                <small>${escapeHtml(`${formatClockDisplay(item.start)}-${formatClockDisplay(item.end)} · ${item.meta}`)}</small>
              </article>`).join('')}
            </div>
          </div>`).join('')}
        </div>` : `<div class="ops-cockpit-empty">Aucune ressource critique bloquée sur la date sélectionnée.</div>`}
      </div>
      <aside class="ops-cockpit-side">
        <div class="ops-cockpit-card">
          <span class="label">Décision moteur</span>
          <span class="value">${escapeHtml(decision.title)}</span>
          <p>${escapeHtml(decision.text)}</p>
        </div>
        <div class="ops-cockpit-card">
          <span class="label">Capacité live</span>
          <span class="value">${escapeHtml(formatAdminPercent(Math.max(metrics.bowlingOccupancy, metrics.laserOccupancy)))}</span>
          <p>${metrics.players} joueur(s), ${metrics.reservations} réservation(s), ${formatMoney(metrics.revenue)} prévu.</p>
          <div class="ops-cockpit-meter">
            ${renderAdminCockpitMetricBar('Bowling', metrics.bowlingOccupancy, 'bowling')}
            ${renderAdminCockpitMetricBar('Laser', metrics.laserOccupancy, 'laser')}
          </div>
          ${mailTotal
            /* Le taux d'envoi n'est PAS de la capacite : sorti de la jauge, dit
               en toutes lettres avec son perimetre. « Mails 50% » sans fenetre
               ne repondait pas a « 50 % de quoi, sur quand ? ». */
            ? `<p class="ops-cockpit-mail-note">Mails de la période (${escapeHtml(formatAdminPeriodLabel())}) : ${metrics.sentMails} parti(s) sur ${mailTotal}${metrics.failedMails ? `, dont ${metrics.failedMails} en échec` : ''}.</p>`
            : ''}
        </div>
        <div class="ops-cockpit-card">
          <span class="label">Staff</span>
          <span class="value">${actions.length} action${actions.length > 1 ? 's' : ''}</span>
          <ul>${actions.map(action => `<li>${escapeHtml(action)}</li>`).join('')}</ul>
        </div>
      </aside>
    </div>
  </section>`;
}

async function runAdminOrchestratorNow() {
  try {
    const centerId = state.adminCenterId || 'libramont';
    const range = getAdminPeriodRange();
    const payload = await apiRequest(API_ENDPOINTS.ops, {
      method: 'POST',
      body: JSON.stringify({
        action: 'orchestrate',
        centerId,
        startDate: range.startDate,
        endDate: range.endDate,
        persist: true,
      })
    });
    const key = getAdminOpsCacheKey(centerId, range);
    const nextOps = {
      ...(adminOpsCacheByCenter[key] || opsAdminCache || {}),
      agentStack: {
        ...(adminDashboardCache.agentStack || opsAdminCache.agentStack || {}),
        orchestration: payload.orchestration || null,
        audit: payload.orchestration?.audit || (adminDashboardCache.agentStack || opsAdminCache.agentStack || {}).audit || null,
      },
      suggestions: payload.savedSuggestions ? adminDashboardCache.suggestions : (adminDashboardCache.suggestions || []),
      loaded: true,
      loading: false,
      lastLoadedAt: new Date().toISOString(),
    };
    adminOpsCacheByCenter[key] = nextOps;
    opsAdminCache = nextOps;
    adminDashboardCache = mergeAdminOpsIntoDashboard(adminDashboardCache, nextOps);
    renderAdminDashboard();
    loadAdminOpsForCenter(centerId, true, adminLoadRequestId);
    toast(`Orchestrateur lancé: ${payload.orchestration?.activations?.length || 0} agent(s) activé(s).`);
  } catch (error) {
    toast(error.message || 'Orchestrateur indisponible.');
  }
}

function renderAdminCenterGrid() {
  const grid = document.getElementById('adminCenterGrid');
  if (!grid) return;
  // Même règle que le menu staff (centers.switch) : une directrice mono-centre
  // n'a aucun autre centre à choisir, la grille ne montre donc rien d'interdit.
  const canSwitch = typeof canUseStaffPermission !== 'function' || canUseStaffPermission('centers.switch');
  grid.classList.toggle('hidden', !canSwitch);
  if (!canSwitch) { grid.innerHTML = ''; return; }
  const centers = getAdminCenters();
  grid.innerHTML = centers.map(center => {
    const bowling = center.resources?.bowling;
    const laser = center.resources?.laser;
    const status = center.status || 'active';
    const statusLabel = status === 'planned' ? 'Prévu' : status === 'active' ? 'Actif' : status;
    const meta = [
      bowling ? `${bowling.laneCount || 0} pistes` : 'bowling à confirmer',
      laser ? `${laser.weaponCount || 0} armes laser • ${laser.parallelLaunches || 1} lancement(s)` : 'laser à confirmer',
    ].join(' · ');
    return `<button class="admin-center-card ${state.adminCenterId === center.id ? 'active' : ''}" onclick="setAdminCenter('${escapeHtml(center.id)}')">
      <span class="top">
        <span class="name">${escapeHtml(center.name)}</span>
        <span class="admin-status ${escapeHtml(status)}">${escapeHtml(statusLabel)}</span>
      </span>
      <span class="meta">${escapeHtml(meta)}</span>
    </button>`;
  }).join('');
}

// Le bandeau d'honnêteté ne s'affiche que si le serveur a DIT que les données
// sont des essais internes (flag testData de l'action health, doctrine du
// cockpit fondateur). Pas de flag reçu = pas d'affirmation, dans un sens
// comme dans l'autre.
function renderAdminHonestyNote() {
  const note = document.getElementById('adminHonestyNote');
  if (!note) return;
  const flag = adminDashboardCache.testData !== undefined
    ? adminDashboardCache.testData
    : opsAdminCache?.testData;
  const show = flag === true && state.staffMenuPage !== 'establishment';
  note.innerHTML = show
    ? `<aside class="admin-testdata" role="note">Données de TEST : le SaaS n'est pas lancé, les chiffres de ce cockpit viennent des essais internes, pas de vrais clients.</aside>`
    : '';
}

function renderAdminHeader() {
  const input = document.getElementById('adminDateInput');
  if (input) input.value = state.adminDate;
  renderAdminCenterGrid();
  renderAdminHonestyNote();
  const center = getAdminCenter();
  const range = getAdminPeriodRange();
  // Le cockpit porte le nom du centre : c'est SA console, pas celle du SaaS.
  // La variante Établissement partage ce shell et garde son propre titre.
  const heroTitle = document.getElementById('adminHeroTitle');
  if (heroTitle) heroTitle.textContent = state.staffMenuPage === 'establishment' ? 'Établissement client' : center.name;
  const heroSub = document.getElementById('adminHeroSub');
  if (heroSub) {
    heroSub.textContent = state.staffMenuPage === 'establishment'
      ? `${center.name} • configuration, ressources et données opérationnelles du centre.`
      : `Cockpit du centre • ${formatAdminPeriodLabel(range)} • réservations, mails, activité et exports.`;
  }
  ['Day', 'Week', 'Month', 'Year'].forEach(name => {
    const button = document.getElementById(`adminPeriod${name}`);
    if (button) button.classList.toggle('active', state.adminPeriod === name.toLowerCase());
  });
  ['Overview', 'Data', 'Mail', 'Reservations', 'Journal', 'Ops', 'Exports'].forEach(name => {
    const button = document.getElementById(`adminTab${name}`);
    if (button) button.classList.toggle('active', state.adminTab === name.toLowerCase());
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Tendances Direction : graphiques animés via window.PinlaneCharts
// (assets/pinlane-charts.js, chargé AVANT ce fichier). Le front ne recalcule
// AUCUNE agrégation : le serveur envoie directionAnalytics (daily/monthly,
// totals + previous de même durée), ce bloc ne fait que mettre en forme.
// Dégradé calme si la librairie ou la donnée manque.
//
// RÈGLE de fenêtre honnête :
//   - période Jour  -> série des 14 jours finissant au jour choisi, LABELLISÉE
//                      « 14 derniers jours » (un point unique ne fait pas une
//                      tendance) ;
//   - Semaine/Mois  -> daily de la fenêtre affichée ;
//   - Année         -> monthly de l'année affichée.
// Le label de fenêtre est TOUJOURS affiché à côté des graphiques.
const adminTrendCache = {};
const adminTrendLoadingKeys = {};
const ADMIN_TREND_TYPE_LABELS = { bowling: 'Bowling', laser: 'Laser Game', formule: 'Formules' };
const ADMIN_TREND_CHANNEL_LABELS = { 'en ligne': 'En ligne (site)', staff: 'Staff (sur place / tél.)' };

function formatAdminTrendDate(dateStr, withYear = false) {
  const options = withYear
    ? { day: '2-digit', month: 'short', year: 'numeric' }
    : { day: '2-digit', month: 'short' };
  return parseLocalDate(dateStr).toLocaleDateString('fr-BE', options);
}

function getAdminTrendWindow(range = getAdminPeriodRange()) {
  if (range.period === 'day') {
    const startDate = addDays(range.endDate, -13);
    return {
      startDate,
      endDate: range.endDate,
      granularity: 'daily',
      label: `14 derniers jours (du ${formatAdminTrendDate(startDate)} au ${formatAdminTrendDate(range.endDate)})`,
    };
  }
  if (range.period === 'year') {
    return {
      startDate: range.startDate,
      endDate: range.endDate,
      granularity: 'monthly',
      label: `Année ${range.label} · mois par mois`,
    };
  }
  const prefix = range.period === 'week' ? 'Semaine' : range.label;
  return {
    startDate: range.startDate,
    endDate: range.endDate,
    granularity: 'daily',
    label: `${prefix} · du ${formatAdminTrendDate(range.startDate)} au ${formatAdminTrendDate(range.endDate)} · jour par jour`,
  };
}

function getAdminTrendKey(centerId = state.adminCenterId || 'libramont', win = getAdminTrendWindow()) {
  return `${centerId}|${win.startDate}|${win.endDate}`;
}

async function loadAdminTrends() {
  const centerId = state.adminCenterId || 'libramont';
  const win = getAdminTrendWindow();
  const key = getAdminTrendKey(centerId, win);
  if (adminTrendLoadingKeys[key]) return;
  if (adminTrendCache[key]?.loaded) return;
  // UN seul fetch par fenêtre : si l'onglet Données (dhState) a déjà chargé
  // EXACTEMENT cette fenêtre pour ce centre, on réutilise son état au lieu de
  // redemander la même chose au serveur.
  if (typeof dhState !== 'undefined' && dhState.analytics
    && String(dhState.loadedKey || '').split('|')[0] === centerId
    && dhState.analytics.startDate === win.startDate
    && dhState.analytics.endDate === win.endDate) {
    adminTrendCache[key] = { loaded: true, error: '', analytics: dhState.analytics, previous: dhState.previous };
    if (state.view === 'admin' && normalizeAdminTab(state.adminTab) === 'overview') renderAdminDashboard();
    return;
  }
  adminTrendLoadingKeys[key] = true;
  try {
    const payload = await apiRequest(`${API_ENDPOINTS.ops}?action=directionAnalytics&centerId=${encodeURIComponent(centerId)}&startDate=${encodeURIComponent(win.startDate)}&endDate=${encodeURIComponent(win.endDate)}`);
    adminTrendCache[key] = { loaded: true, error: '', analytics: payload.analytics || null, previous: payload.previous || null };
  } catch (error) {
    adminTrendCache[key] = { loaded: false, error: error.message || 'Tendances indisponibles.', analytics: null, previous: null };
  } finally {
    adminTrendLoadingKeys[key] = false;
  }
  if (state.view === 'admin' && normalizeAdminTab(state.adminTab) === 'overview') renderAdminDashboard();
}

// Chip honnête : flèche + valeur exacte (différence des totals serveur) +
// « vs période précédente ». Pas de pourcentage quand la base est 0 : on écrit
// « nouvelle activité » au lieu d'inventer un ratio.
function buildAdminTrendDeltaChip(current, previous, format = 'int') {
  const cur = Number(current) || 0;
  const prev = Number(previous) || 0;
  const diff = cur - prev;
  const magnitude = (value) => (format === 'euro' ? formatMoney(Math.abs(value)) : String(Math.abs(Math.round(value))));
  if (prev === 0 && cur > 0) {
    return `<span class="adm-trend-chip new">▲ +${magnitude(diff)} · nouvelle activité</span>`;
  }
  if (prev === 0 && cur === 0) {
    return '<span class="adm-trend-chip flat">= aucune activité sur les deux périodes</span>';
  }
  if (diff === 0) {
    return '<span class="adm-trend-chip flat">= stable vs période précédente</span>';
  }
  const arrow = diff > 0 ? '▲' : '▼';
  const sign = diff > 0 ? '+' : '-';
  const percent = Math.round((Math.abs(diff) / prev) * 100);
  return `<span class="adm-trend-chip ${diff > 0 ? 'up' : 'down'}">${arrow} ${sign}${magnitude(diff)} (${sign}${percent}%) vs période précédente</span>`;
}

// asLabels : le contrat barChart n'accepte que des items { label, value } (la
// forme { date, value } est réservée à lineChart) : les séries quotidiennes
// destinées aux barres sont donc étiquetées ici.
function buildAdminTrendSeries(analytics, granularity, pick, asLabels = false) {
  if (!analytics) return [];
  if (granularity === 'monthly') {
    return (analytics.monthly || []).map(row => ({ label: String(row.month || ''), value: Number(pick(row)) || 0 }));
  }
  return (analytics.daily || []).map(row => (asLabels
    ? { label: formatAdminTrendDate(row.date), value: Number(pick(row)) || 0 }
    : { date: row.date, value: Number(pick(row)) || 0 }));
}

function renderAdminTrendsPanel() {
  const win = getAdminTrendWindow();
  const entry = adminTrendCache[getAdminTrendKey()] || null;
  const head = `<div class="admin-section-title">
    <div>
      <h2>Tendances</h2>
      <p>${escapeHtml(win.label)} · comparé à la période précédente de même durée (chiffres serveur).</p>
    </div>
  </div>`;
  let body = '';
  if (!entry) {
    body = '<p class="adm-trend-note">Chargement des tendances…</p>';
  } else if (entry.error) {
    body = '<p class="adm-trend-note">Tendances momentanément indisponibles. Elles reviendront au prochain rafraîchissement.</p>';
  } else if (!entry.analytics) {
    body = '<p class="adm-trend-note">Pas encore de données sur la période.</p>';
  } else {
    const totals = entry.analytics.totals || {};
    const prevTotals = (entry.previous && entry.previous.totals) || {};
    const unit = win.granularity === 'monthly' ? 'par mois' : 'par jour';
    const cards = [
      { id: 'admTrendRevenue', title: 'Chiffre d\'affaires', sub: `CA ${unit}`, chip: buildAdminTrendDeltaChip(totals.revenue, prevTotals.revenue, 'euro') },
      { id: 'admTrendCount', title: 'Réservations', sub: `réservations ${unit}`, chip: buildAdminTrendDeltaChip(totals.reservations, prevTotals.reservations, 'int') },
      { id: 'admTrendPax', title: 'Joueurs', sub: `joueurs ${unit}`, chip: buildAdminTrendDeltaChip(totals.pax, prevTotals.pax, 'int') },
    ];
    // Occupation bowling : le serveur n'envoie qu'un taux AGRÉGÉ de période
    // (occupancy.rate), pas de série par jour. Pas de ligne % honnête possible
    // sans recalcul métier côté front : la courbe est donc omise.
    body = `<div class="adm-trend-grid">
      ${cards.map(card => `<article class="adm-trend-card">
        <div class="adm-trend-head">
          <h3>${escapeHtml(card.title)}</h3>
          ${card.chip}
        </div>
        <div class="adm-trend-sub">${escapeHtml(card.sub)}</div>
        <div class="adm-trend-chart" id="${card.id}"></div>
      </article>`).join('')}
    </div>`;
  }
  return `<div class="admin-panel adm-trend-panel" id="admTrendPanel">${head}${body}</div>`;
}

// Montage des graphiques : appelé APRÈS l'écriture innerHTML (les hosts doivent
// exister). motionKey = onglet + centre + fenêtre : l'animation rejoue quand la
// fenêtre change, jamais sur un re-rendu identique (garde interne de la lib).
function mountAdminTrendCharts() {
  const panel = document.getElementById('admTrendPanel');
  if (!panel) return;
  const key = getAdminTrendKey();
  const entry = adminTrendCache[key] || null;
  if (!entry && !adminTrendLoadingKeys[key]) loadAdminTrends();
  if (!entry || !entry.analytics) return;
  const hosts = ['admTrendRevenue', 'admTrendCount', 'admTrendPax']
    .map(id => document.getElementById(id))
    .filter(Boolean);
  if (!hosts.length) return;
  const charts = typeof window !== 'undefined' ? window.PinlaneCharts : null;
  if (!charts) {
    hosts.forEach(host => { host.textContent = 'Graphiques indisponibles pour le moment.'; });
    return;
  }
  const win = getAdminTrendWindow();
  const motionBase = `direction|overview|${state.adminCenterId || 'libramont'}|${win.startDate}|${win.endDate}`;
  const analytics = entry.analytics;
  if (typeof charts.lineChart === 'function') {
    charts.lineChart(document.getElementById('admTrendRevenue'), {
      series: buildAdminTrendSeries(analytics, win.granularity, row => row.revenue),
      format: 'euro',
      motionKey: `${motionBase}|revenue`,
    });
    charts.lineChart(document.getElementById('admTrendPax'), {
      series: buildAdminTrendSeries(analytics, win.granularity, row => row.pax),
      format: 'int',
      motionKey: `${motionBase}|pax`,
    });
  }
  if (typeof charts.barChart === 'function') {
    charts.barChart(document.getElementById('admTrendCount'), {
      series: buildAdminTrendSeries(analytics, win.granularity, row => row.count, true),
      format: 'int',
      motionKey: `${motionBase}|count`,
    });
  }
}

// Onglet Données : lecture visuelle servie par le MÊME état que le hub
// (dhState, un seul fetch directionAnalytics par période, admin-data.js).
// Rendu ici car cette section appartient à la console Direction : donut du
// chiffre par activité, canaux, affluence jour x heure.
function renderAdminDataChartsSection() {
  if (typeof dhState === 'undefined' || !dhState.analytics) return '';
  const analytics = dhState.analytics;
  return `<div class="admin-panel adm-trend-panel adm-trend-data" id="admDataChartsPanel">
    <div class="admin-section-title">
      <div>
        <h2>Lecture visuelle de la période</h2>
        <p>Du ${escapeHtml(formatAdminTrendDate(analytics.startDate, true))} au ${escapeHtml(formatAdminTrendDate(analytics.endDate, true))} · répartition du chiffre, canaux et affluence (chiffres serveur).</p>
      </div>
    </div>
    <div class="adm-trend-grid">
      <article class="adm-trend-card">
        <div class="adm-trend-head"><h3>Chiffre par activité</h3></div>
        <div class="adm-trend-chart" id="admDataTypes"></div>
      </article>
      <article class="adm-trend-card">
        <div class="adm-trend-head"><h3>Canaux de réservation</h3></div>
        <div class="adm-trend-chart" id="admDataChannels"></div>
      </article>
      <article class="adm-trend-card adm-trend-wide">
        <div class="adm-trend-head"><h3>Affluence par jour et heure</h3></div>
        <div class="adm-trend-chart" id="admDataHeatmap"></div>
      </article>
    </div>
  </div>`;
}

// Mise en forme du heatmap serveur (7 lignes lun-dim x heures) vers le contrat
// heatmapChart : bornes horaires mesurées puis élargies au créneau 12h-21h,
// même lecture que l'affluence de l'onglet Données. Aucune agrégation ici.
function buildAdminHeatmapModel(heatmap) {
  const rows = Array.isArray(heatmap) ? heatmap : [];
  let minHour = 24;
  let maxHour = 0;
  let maxVal = 0;
  rows.forEach(row => Object.entries(row || {}).forEach(([hour, value]) => {
    const h = Number(hour);
    const v = Number(value) || 0;
    if (!v || !Number.isFinite(h)) return;
    minHour = Math.min(minHour, h);
    maxHour = Math.max(maxHour, h);
    maxVal = Math.max(maxVal, v);
  }));
  if (!maxVal) return { matrix: [], rowLabels: [], colLabels: [] };
  minHour = Math.min(minHour, 12);
  maxHour = Math.max(maxHour, 21);
  const hours = [];
  for (let h = minHour; h <= maxHour; h += 1) hours.push(h);
  return {
    matrix: rows.map(row => hours.map(h => Number((row || {})[h]) || 0)),
    rowLabels: ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'],
    colLabels: hours.map(h => `${h}h`),
  };
}

function mountAdminDataCharts() {
  const panel = document.getElementById('admDataChartsPanel');
  if (!panel || typeof dhState === 'undefined' || !dhState.analytics) return;
  const hosts = ['admDataTypes', 'admDataChannels', 'admDataHeatmap']
    .map(id => document.getElementById(id))
    .filter(Boolean);
  if (!hosts.length) return;
  const charts = typeof window !== 'undefined' ? window.PinlaneCharts : null;
  if (!charts) {
    hosts.forEach(host => { host.textContent = 'Graphiques indisponibles pour le moment.'; });
    return;
  }
  const analytics = dhState.analytics;
  const motionBase = `direction|data|${state.adminCenterId || 'libramont'}|${analytics.startDate}|${analytics.endDate}`;
  if (typeof charts.donutChart === 'function') {
    const parts = Object.entries(analytics.byType || {}).map(([type, row]) => ({
      label: ADMIN_TREND_TYPE_LABELS[type] || type,
      value: Number(row?.revenue) || 0,
    }));
    charts.donutChart(document.getElementById('admDataTypes'), { parts, format: 'euro', motionKey: `${motionBase}|types` });
  }
  if (typeof charts.barChart === 'function') {
    const series = (analytics.byChannel || []).map(row => ({
      label: ADMIN_TREND_CHANNEL_LABELS[row.channel] || String(row.channel || 'autre'),
      value: Number(row.count) || 0,
    }));
    charts.barChart(document.getElementById('admDataChannels'), { series, format: 'int', motionKey: `${motionBase}|channels` });
  }
  if (typeof charts.heatmapChart === 'function') {
    const model = buildAdminHeatmapModel(analytics.heatmap);
    charts.heatmapChart(document.getElementById('admDataHeatmap'), {
      matrix: model.matrix,
      rowLabels: model.rowLabels,
      colLabels: model.colLabels,
      motionKey: `${motionBase}|heatmap`,
    });
  }
}

function renderAdminOverview() {
  const snapshot = adminDashboardCache.snapshot || { reservations: [] };
  const center = getAdminCenter();
  const metrics = buildAdminMetrics(snapshot.reservations || [], center);
  const marketMetrics = buildAdminMarketMetrics(snapshot.reservations || []);
  const insights = buildAdminInsights(metrics, center);
  return `
    <div class="admin-panel">
      <div class="admin-section-title">
        <div>
          <h2>Synthèse exécutive</h2>
          <p>${escapeHtml(metrics.openLabel)} • ${escapeHtml(center.name)} • actualisé ${escapeHtml(formatOpsTimestamp(adminDashboardCache.lastLoadedAt))}</p>
        </div>
      </div>
      <div class="admin-kpi-grid">
        ${/* Les sous-lignes doivent BOUCLER : une directrice va compter.
             « 3 dont 1 a venir · 1 sur place » laissait la payee invisible et la
             somme ne faisait pas le total ; « Joueurs 22, 1 formule(s) » annotait
             une autre unite que le chiffre. */''}
        <div class="admin-kpi"><div class="k">Réservations</div><div class="v">${metrics.reservations}</div><div class="s">${metrics.pendingCount} à venir · ${metrics.arrivedCount} sur place · ${metrics.paidCount} payée${metrics.paidCount > 1 ? 's' : ''}</div></div>
        <div class="admin-kpi"><div class="k">Joueurs</div><div class="v">${metrics.players}</div><div class="s">sur ${metrics.reservations} réservation${metrics.reservations > 1 ? 's' : ''}</div></div>
        <div class="admin-kpi"><div class="k">Chiffre ${state.adminPeriod === 'day' ? 'du jour' : 'de la période'}</div><div class="v">${formatMoney(metrics.revenue)}</div><div class="s">${formatMoney(metrics.collected)} encaissé</div></div>
        <div class="admin-kpi"><div class="k">Ticket moyen</div><div class="v">${formatMoney(metrics.avgTicket)}</div><div class="s">sur réservations actives</div></div>
        <div class="admin-kpi"><div class="k">Bowling</div><div class="v">${formatAdminPercent(metrics.bowlingOccupancy)}</div><div class="s">${Math.round(metrics.laneHours)}h piste / ${Math.round(metrics.bowlingCapacity)}h capacité</div></div>
        <div class="admin-kpi"><div class="k">Laser</div><div class="v">${formatAdminPercent(metrics.laserOccupancy)}</div><div class="s">${metrics.laserLaunches} lancement(s) · ${metrics.laserPlayers} passages</div></div>
      </div>
    </div>
    ${renderAdminTrendsPanel()}
    <div class="admin-dashboard-grid">
      <div class="admin-panel">
        <div class="admin-section-title">
          <div>
            <h2>Signaux direction</h2>
            <p>Décisions utiles avant le terrain ou le rush.</p>
          </div>
        </div>
        <div class="admin-insight-list">
          ${insights.map(item => `<div class="admin-insight ${escapeHtml(item.level)}"><span class="dot"></span><div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.text)}</span></div></div>`).join('')}
        </div>
      </div>
      ${renderAdminOperationalHealth(snapshot, metrics, center)}
    </div>
    ${renderAdminCockpit(metrics, center, snapshot.reservations || [], marketMetrics)}
    ${renderAdminReservationsTable((snapshot.reservations || []).slice(0, 10), 'Réservations clés', 'Les premières lignes exploitables pour la direction.')}
  `;
}

function renderAdminReservationsTable(reservations = [], title = 'Réservations du jour', subtitle = 'Toutes les lignes exploitables par la direction.') {
  const rows = reservations
    .filter(reservation => reservation.status !== 'cancelled')
    .slice()
    .sort((left, right) => `${left.date || ''} ${left.startTime || ''}`.localeCompare(`${right.date || ''} ${right.startTime || ''}`));
  return `<div class="admin-panel">
    <div class="admin-section-title">
      <div>
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(subtitle)}</p>
      </div>
    </div>
    ${rows.length ? `<div class="admin-table-wrap"><table class="admin-table">
      <thead><tr><th>Heure</th><th>Client</th><th>Offre</th><th>Ressources</th><th>Engagement</th><th>Statut</th><th>Montant</th><th>Risque</th></tr></thead>
      <tbody>
        ${rows.map(reservation => {
          const isFormula = reservation.type === 'formule' || reservation.formuleId;
          const isLaser = reservation.type === 'laser';
          const risk = String(reservation.riskLevel || '').toLowerCase();
          const needsReview = reservation.validationStatus === 'staff_review';
          const riskTone = risk === 'critical' ? 'danger' : (risk === 'high' || risk === 'warning' || needsReview) ? 'warn' : '';
          const riskLabel = risk === 'critical'
            ? 'Critique'
            : risk === 'high'
              ? 'Élevé'
              : risk === 'warning'
                ? 'À surveiller'
                : needsReview
                  ? 'Validation staff'
                  : 'Normal';
          return `<tr>
            <td><strong>${escapeHtml(reservation.startTime || '--:--')}</strong><br>${escapeHtml(formatDurationLabel(reservation.totalDuration || reservation.duration || 0))}</td>
            <td><strong>${escapeHtml(reservation.name || 'Client')}</strong><br>${escapeHtml(reservation.phone || '')}</td>
            <td><span class="admin-pill ${isFormula ? 'formule' : isLaser ? 'laser' : ''}">${escapeHtml(getReservationLabel(reservation))}</span><br>${Number(reservation.pax || 0)} joueur(s)</td>
            <td>${getAdminResourceHtml(reservation)}</td>
            <td>${renderAdminGuestOpsCell(reservation)}</td>
            <td><span class="admin-pill ${escapeHtml(reservation.status || 'pending')}">${escapeHtml(getAdminStatusLabel(reservation.status))}</span></td>
            <td><strong>${formatMoney(reservation.price)}</strong><br>${escapeHtml(reservation.paymentMethod || 'Sur place')}</td>
            <td><span class="admin-pill ${riskTone}">${escapeHtml(riskLabel)}</span></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table></div>` : `<div class="empty-state"><div class="e-title">Aucune réservation sur cette date</div><div class="e-sub">Le centre reste consultable, mais aucune donnée opérationnelle n’est enregistrée pour ce jour.</div></div>`}
  </div>`;
}

// L'onglet Clients de Direction a ete retire : c'etait un doublon appauvri du
// CRM v2 (page Clients du menu staff, renderStaffClientsPage). Les profils
// clients restent calcules par buildAdminClientProfiles pour la feuille Excel
// « Clients CRM » et le rapport direction.

// L'onglet Activité est scope CENTRE : signaux agents + journal terrain, en un
// seul écran. L'outillage plateforme (Stack IA, Simulation rush) n'apparaît
// que pour platform.admin : c'est l'outillage de test du fondateur, pas un
// outil de directrice. Les sous-onglets Mails/Modèles ont été retirés :
// doublons de l'onglet Mails (un seul endroit pour les mails).
function isAdminPlatformOwner() {
  return typeof canUseStaffPermission === 'function' && canUseStaffPermission('platform.admin');
}

function renderAdminOpsPanel() {
  const platformTabs = isAdminPlatformOwner()
    ? `<div class="ops-admin-tabs">
      <button class="ops-tab" id="opsTabActivity" onclick="setOpsTab('activity')">Activité du centre</button>
      <button class="ops-tab" id="opsTabStack" onclick="setOpsTab('stack')">Stack IA</button>
      <button class="ops-tab" id="opsTabSimulation" onclick="setOpsTab('simulation')">Simulation rush</button>
    </div>`
    : '';
  return `<div class="admin-panel">
    <div class="ops-admin-head">
      <div>
        <div class="ops-eyebrow">Ce qui s'est passé chez vous</div>
        <h2>Activité du centre</h2>
        <p>Signaux remontés par les agents et événements terrain du centre sélectionné, sur la période ouverte.</p>
      </div>
    </div>
    ${platformTabs}
    <div class="ops-admin-content" id="opsAdminContent"></div>
  </div>`;
}

function renderAdminExports() {
  const payload = getAdminExportPayload();
  const metrics = payload.metrics;
  return `<div class="admin-panel">
    <div class="admin-section-title">
      <div>
        <h2>Exports direction</h2>
        <p>Données prêtes à envoyer, archiver ou analyser dans Excel/Sheets.</p>
      </div>
    </div>
    <div class="admin-export-grid">
      <div class="admin-export-card">
        <div><h3>Excel compta multi-feuilles</h3><p>Synthèse, réservations, compta, bowling, laser, mails et agents dans un classeur Excel propre.</p></div>
        <button class="admin-btn" onclick="exportAdminExcel()">Télécharger</button>
      </div>
      <div class="admin-export-card">
        ${/* « blanc » etait du jargon interne ; et le bouton primaire de la barre
             (« Rapport executif ») appelait la MEME fonction sous un autre nom.
             Un seul nom par action : « Rapport direction », decline web/A4. */''}
        <div><h3>Rapport direction</h3><p>Document HTML professionnel avec logo, KPIs, signaux et aperçu des réservations. Imprimable en PDF.</p></div>
        <button class="admin-btn" onclick="exportAdminReport()">Télécharger</button>
      </div>
      <div class="admin-export-card">
        <div><h3>Résumé du jour</h3><p>${metrics.reservations} réservation(s), ${metrics.players} joueurs, ${formatMoney(metrics.revenue)} prévu, ${metrics.failedMails} mail(s) en échec.</p></div>
        <button class="admin-btn" onclick="copyAdminSummary()">Copier le résumé</button>
      </div>
    </div>
    <div class="admin-section-title" style="margin-top: var(--space-6);">
      <div>
        <h2>Exports de la période analysée</h2>
        <p>Basés sur la période sélectionnée dans l'onglet Données (${typeof dhState !== 'undefined' && dhState.analytics ? `du ${dhState.analytics.startDate} au ${dhState.analytics.endDate}` : 'ouvrez l’onglet Données pour choisir la période'}). Format CSV compatible Excel belge.</p>
      </div>
    </div>
    <div class="admin-export-grid">
      <div class="admin-export-card">
        <div><h3>Rapport direction A4</h3><p>KPIs, activités, formules, clients fidèles et bilan, mise en page sobre, imprimable en PDF.</p></div>
        <button class="admin-btn" onclick="dhPrintReport()">Imprimer</button>
      </div>
      <div class="admin-export-card">
        <div><h3>Série temporelle</h3><p>Réservations, joueurs, chiffre et annulations par jour/semaine/mois sur la période.</p></div>
        <button class="admin-btn" onclick="dhExportCsv('serie')">CSV</button>
      </div>
      <div class="admin-export-card">
        <div><h3>Clients de la période</h3><p>Visites, chiffre, première/dernière venue, activité préférée, contact.</p></div>
        <button class="admin-btn" onclick="dhExportCsv('clients')">CSV</button>
      </div>
      <div class="admin-export-card">
        <div><h3>Réservations brutes</h3><p>Le détail ligne par ligne de toutes les réservations de la période.</p></div>
        <button class="admin-btn" onclick="dhExportCsv('reservations-brutes')">CSV</button>
      </div>
    </div>
  </div>`;
}

// FAMILLE B (patron PV2_EMAILS_MOTION) : le contenu se reconstruit par
// innerHTML à chaque rendu (poll 45 s compris). L'animation d'entrée ne se
// pose que quand l'ONGLET vient de changer, jamais sur une simple
// reconstruction : sinon la page « respirerait » toute seule à chaque poll.
const ADMIN_TAB_MOTION = { lastTab: null };

function markAdminTabMount(content) {
  const tab = `${state.staffMenuPage === 'establishment' ? 'establishment' : 'admin'}:${state.adminTab || 'overview'}`;
  const changed = ADMIN_TAB_MOTION.lastTab !== null && ADMIN_TAB_MOTION.lastTab !== tab;
  ADMIN_TAB_MOTION.lastTab = tab;
  content.classList.remove('admin-mount');
  if (!changed) return;
  if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  // Reflow forcé pour que le retrait de classe soit commité avant la repose :
  // sans lui, reposer la même classe ne rejoue pas l'animation.
  void content.offsetWidth;
  content.classList.add('admin-mount');
}

// Onglets retirés de Direction : « clients » (doublon du CRM v2, la vraie page
// Clients vit dans le menu staff). Un état persisté sur un onglet disparu
// retombe sur la vue période au lieu d'un écran vide.
function normalizeAdminTab(tab) {
  const allowed = ['overview', 'data', 'mail', 'reservations', 'journal', 'ops', 'exports'];
  return allowed.includes(tab) ? tab : 'overview';
}

// Montage Direction du Journal des modifications : RÉUTILISE le panneau de la
// page Emails (pv2AuditPanel, staff-pages-v2.js), zéro copie. Le hook
// pv2AuditRerender fait revenir les interactions du panneau (ouvrir, filtrer,
// déplier) vers CE rendu tant que Direction est la page hôte.
function renderAdminJournalTab() {
  window.pv2AuditRerender = function () {
    if (state.view === 'admin' && state.adminTab === 'journal') renderAdminDashboard();
  };
  if (typeof pv2AuditPanel !== 'function') {
    return '<div class="admin-panel"><div class="empty-state"><div class="e-title">Journal indisponible</div><div class="e-sub">Rechargez la page.</div></div></div>';
  }
  return `<div class="pv2-shell admin-journal-shell">${pv2AuditPanel()}</div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// POSTE D'OBSERVATION Direction (refonte 2026-07-21, namespace dir-*).
//
// Rupture nette avec l'ancienne page (onglets, cockpit, signaux, verifications
// continues) : rejetee par Movsar. La nouvelle page est un tableau de lecture
// facon Vercel Analytics : une barre de plage de dates (window.PinlaneDateRange),
// une rangee de tuiles KPI interactives, un grand graphique focus pilote par la
// tuile choisie, une grille de graphiques, puis deux tables (formules, clients).
//
// SOURCE UNIQUE : GET /api/ops?action=directionAnalytics (le front ne recalcule
// AUCUNE agregation). La comparaison suit adminRange.compare :
//   - 'previous' : bloc previous.totals deja renvoye ;
//   - 'year'     : second fetch decale de -1 an, ses totals servent de reference ;
//   - 'none'     : pas de reference.
// Degrade calme partout : librairie absente, host absent, serie vide.
// ─────────────────────────────────────────────────────────────────────────────

const directionInsightCache = {};
const directionInsightLoading = {};
// Caches des SECTIONS DE DECISION (Comparer mes centres + Retention et clients),
// SEPARES du cache analytique : leur cycle est independant (chargement parallele,
// panne isolee), ils ne conditionnent JAMAIS le court-circuit du cache principal.
// Meme cle que dirInsightKey (centre + fenetre, sans le mode de comparaison).
const directionDecisionCache = {};
const directionDecisionLoading = {};
let dirRangeHandle = null;
let DIR_ENTRANCE_SEEN = false;
// Vue Analyse : tableau d'analyse PERSONNALISABLE (window.PinlaneAnalyticsBoard),
// hote PERSISTANT + handle gardes en variables de module. Le board est monte UNE
// seule fois ; changer de vue puis revenir DEPLACE le meme noeud (appendChild)
// sans le detruire ni le re-monter -> config, edition et graphes survivent (motif
// de l'app-main dashboard). storageKey DISTINCT du dashboard : config independante.
let dirAnalyseHandle = null;
let dirAnalyseContainer = null;

// Metrique du grand graphique focus : chaque tuile pointe vers UN champ de serie
// reellement servi par le serveur (jamais un ratio recalcule cote front). Les
// tuiles "taux" empruntent la serie de volume qui les porte, le titre le dit.
const DIR_FOCUS = {
  reservations: { field: 'count', format: 'int', label: 'Reservations sur la periode' },
  pax: { field: 'pax', format: 'int', label: 'Joueurs sur la periode' },
  revenue: { field: 'revenue', format: 'euro', label: "Chiffre d'affaires sur la periode" },
  avgBasket: { field: 'revenue', format: 'euro', label: "Ticket moyen (base: chiffre d'affaires)" },
  occupancy: { field: 'count', format: 'int', label: 'Taux de remplissage (base: reservations)' },
  cancelRate: { field: 'cancelled', format: 'int', label: 'Annulations sur la periode' },
};

function dirOccupancyRate(analytics) {
  const rate = analytics && analytics.occupancy ? analytics.occupancy.rate : null;
  return rate == null ? null : Number(rate);
}

function dirOccupancyRef(entry) {
  // La reference n'existe que pour 'annee precedente' (le bloc previous du
  // serveur ne porte pas d'occupation). Sinon : pas de delta, chip neutre.
  const year = entry && entry.yearAnalytics ? entry.yearAnalytics : null;
  return year && year.occupancy ? (year.occupancy.rate == null ? null : Number(year.occupancy.rate)) : null;
}

// Les six tuiles KPI. cur(totals, analytics) = valeur courante ; ref(refTotals,
// entry) = valeur de reference (null si aucune) ; spark = champ de serie de la
// mini-courbe ; invert = un sens croissant est un ECHEC (taux d'annulation).
const DIR_KPIS = [
  { key: 'reservations', label: 'Reservations', format: 'int', cur: (t) => t.reservations, ref: (r) => (r ? r.reservations : null), spark: 'count' },
  { key: 'pax', label: 'Joueurs', format: 'int', cur: (t) => t.pax, ref: (r) => (r ? r.pax : null), spark: 'pax' },
  { key: 'revenue', label: "Chiffre d'affaires", format: 'euro', cur: (t) => t.revenue, ref: (r) => (r ? r.revenue : null), spark: 'revenue' },
  { key: 'avgBasket', label: 'Ticket moyen', format: 'euro', cur: (t) => t.avgBasket, ref: (r) => (r ? r.avgBasket : null), spark: 'revenue' },
  { key: 'occupancy', label: 'Taux de remplissage', format: 'percent', cur: (t, a) => dirOccupancyRate(a), ref: (r, entry) => dirOccupancyRef(entry), spark: 'count' },
  { key: 'cancelRate', label: "Taux d'annulation", format: 'percent', cur: (t) => t.cancelRate, ref: (r) => (r ? r.cancelRate : null), spark: 'cancelled', invert: true },
];

// VUES du poste d'observation (refonte 2026-07-21) : la page ne s'empile plus en
// un seul long scroll aux tailles disparates. On classe le contenu en 4 vues
// nettes, choisies par un segmented nav (pilules facon Linear) sous la barre de
// plage. La plage de dates reste GLOBALE (elle change la fenetre pour toutes les
// vues) ; seule la vue active est rendue + montee (motionKey inclut la vue, donc
// la premiere apparition d'une vue anime ses graphes). L'ordre = la lecture.
const DIR_VIEW_META = [
  { key: 'synthese', label: 'Synthese' },
  { key: 'activite', label: 'Activite' },
  { key: 'clients', label: 'Clients' },
  { key: 'centres', label: 'Mes centres' },
  { key: 'provenance', label: 'Provenance' },
  { key: 'analyse', label: 'Analyse' },
];
const DIR_VIEWS = DIR_VIEW_META.map((v) => v.key);

// Vue active persistee (state.adminView), defaut 'synthese'. Valeur inconnue
// (donnee corrompue, ancienne session) -> repli calme sur la synthese.
function getDirView() {
  return DIR_VIEWS.includes(state.adminView) ? state.adminView : 'synthese';
}

function getDirDefaultRange() {
  const end = todayStr();
  return { start: addDays(end, -29), end, granularity: 'day', compare: 'previous' };
}

function getDirRange() {
  const r = state.adminRange;
  if (r && r.start && r.end) {
    return {
      start: r.start,
      end: r.end,
      granularity: ['day', 'week', 'month'].includes(r.granularity) ? r.granularity : 'day',
      compare: ['none', 'previous', 'year'].includes(r.compare) ? r.compare : 'previous',
    };
  }
  return getDirDefaultRange();
}

function getDirFocusMetric() {
  return DIR_FOCUS[state.adminFocusMetric] ? state.adminFocusMetric : 'revenue';
}

function dirShiftYear(dateStr) {
  const d = parseLocalDate(dateStr);
  d.setFullYear(d.getFullYear() - 1);
  return toLocalDateStr(d);
}

function dirFormatValue(value, format) {
  const n = Math.round(Number(value) || 0);
  if (format === 'euro') return formatMoney(n);
  if (format === 'percent') return formatAdminPercent(n);
  return new Intl.NumberFormat('fr-BE', { maximumFractionDigits: 0 }).format(n);
}

function dirRangeText(range = getDirRange()) {
  const fmt = (value) => parseLocalDate(value).toLocaleDateString('fr-BE', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${fmt(range.start)} → ${fmt(range.end)}`;
}

function dirGranularityLabel(granularity) {
  return { day: 'Par jour', week: 'Par semaine', month: 'Par mois' }[granularity] || 'Par jour';
}

function dirUnitWord(granularity) {
  return { day: 'jour', week: 'semaine', month: 'mois' }[granularity] || 'jour';
}

function dirCompareLabel(compare) {
  return { none: 'sans comparaison', previous: 'vs periode precedente', year: 'vs annee precedente' }[compare] || 'sans comparaison';
}

function getDirReferenceTotals(entry, compare) {
  if (!entry) return null;
  if (compare === 'previous') return (entry.previous && entry.previous.totals) || null;
  if (compare === 'year') return (entry.yearAnalytics && entry.yearAnalytics.totals) || null;
  return null;
}

// Chip de delta honnete : difference EXACTE des totals serveur (jamais un
// pourcentage sur base 0 : "nouvelle activite" a la place). Le sens porte la
// couleur (vert = reussite, rouge = echec) : pour un taux d'annulation (invert),
// une baisse est une reussite.
function buildDirDeltaChip(curVal, refVal, format, compare, invert) {
  if (compare === 'none' || refVal === null || refVal === undefined) {
    return '<span class="dir-chip dir-chip-mute">sur la periode</span>';
  }
  const cur = Number(curVal) || 0;
  const ref = Number(refVal) || 0;
  const dirDiff = cur - ref;
  const refLabel = compare === 'year' ? 'vs annee precedente' : 'vs periode precedente';
  const mag = (value) => {
    const av = Math.abs(value);
    if (format === 'euro') return formatMoney(av);
    if (format === 'percent') return formatAdminPercent(av);
    return new Intl.NumberFormat('fr-BE', { maximumFractionDigits: 0 }).format(Math.round(av));
  };
  if (ref === 0 && cur > 0) {
    return `<span class="dir-chip ${invert ? 'dir-chip-down' : 'dir-chip-up'}">▲ +${mag(dirDiff)} : nouvelle activite</span>`;
  }
  if (ref === 0 && cur === 0) {
    return '<span class="dir-chip dir-chip-flat">= aucune activite</span>';
  }
  if (Math.round(dirDiff * 100) / 100 === 0) {
    return `<span class="dir-chip dir-chip-flat">= stable ${refLabel}</span>`;
  }
  const up = dirDiff > 0;
  const arrow = up ? '▲' : '▼';
  const sign = up ? '+' : '-';
  const good = invert ? !up : up;
  const pct = Math.round((Math.abs(dirDiff) / Math.abs(ref)) * 100);
  return `<span class="dir-chip ${good ? 'dir-chip-up' : 'dir-chip-down'}">${arrow} ${sign}${mag(dirDiff)} (${sign}${pct}%) ${refLabel}</span>`;
}

// Serie de metrique suivant la granularite : day -> daily, week -> weekly,
// month -> monthly. Forme { date, value } pour lineChart, { label, value } pour
// barChart (asLabels). Aucune agregation : lecture directe du champ serveur.
function dirMetricSeries(analytics, granularity, field, asLabels) {
  if (!analytics) return [];
  if (granularity === 'month') {
    return (analytics.monthly || []).map((row) => ({ label: String(row.month || ''), value: Number(row[field]) || 0 }));
  }
  if (granularity === 'week') {
    return (analytics.weekly || []).map((row) => ({ label: String(row.label || row.weekStart || ''), value: Number(row[field]) || 0 }));
  }
  const dirDays = analytics.daily || [];
  return dirDays.map((row) => (asLabels
    ? { label: dirDayLabel(row.date), value: Number(row[field]) || 0 }
    : { date: row.date, value: Number(row[field]) || 0 }));
}

function dirDayLabel(dateStr) {
  return parseLocalDate(dateStr).toLocaleDateString('fr-BE', { day: '2-digit', month: 'short' });
}

function dirLoadingHtml() {
  return '<div class="dir-note dir-note-loading">Chargement de l\'analytique de la periode...</div>';
}

function dirNoteHtml(text) {
  return `<div class="dir-note">${escapeHtml(text)}</div>`;
}

function dirKpisHtml(entry) {
  const analytics = entry.analytics;
  const totals = analytics.totals || {};
  const compare = getDirRange().compare;
  const ref = getDirReferenceTotals(entry, compare);
  const activeFocus = getDirFocusMetric();
  const tiles = DIR_KPIS.map((kpi) => {
    const cur = kpi.cur(totals, analytics);
    const refVal = kpi.ref ? kpi.ref(ref, entry) : null;
    const chip = buildDirDeltaChip(cur, refVal, kpi.format, compare, kpi.invert);
    const active = kpi.key === activeFocus;
    return `<button type="button" class="dir-kpi${active ? ' is-active' : ''}" data-metric="${kpi.key}" data-focus="${kpi.key}" aria-pressed="${active ? 'true' : 'false'}" onclick="setDirFocusMetric('${kpi.key}')">
      <span class="dir-kpi-label">${escapeHtml(kpi.label)}</span>
      <span class="dir-kpi-value" id="dirKpiVal-${kpi.key}">${escapeHtml(dirFormatValue(cur == null ? 0 : cur, kpi.format))}</span>
      <span class="dir-kpi-delta">${chip}</span>
      <span class="dir-kpi-spark" id="dirKpiSpark-${kpi.key}" aria-hidden="true"></span>
    </button>`;
  }).join('');
  return `<div class="dir-kpis" id="dirKpis" role="group" aria-label="Indicateurs cles de la periode">${tiles}</div>`;
}

function dirFocusHtml() {
  const focus = getDirFocusMetric();
  const cfg = DIR_FOCUS[focus];
  const range = getDirRange();
  const sub = `${dirRangeText(range)} · ${dirGranularityLabel(range.granularity).toLowerCase()}`;
  return `<section class="dir-focus" aria-label="Graphique principal">
    <div class="dir-focus-head">
      <h2 class="dir-focus-title">${escapeHtml(cfg.label)}</h2>
      <p class="dir-focus-sub" id="dirFocusSub">${escapeHtml(sub)}</p>
    </div>
    <div class="dir-focus-chart" id="dirFocusChart"></div>
  </section>`;
}

function dirGridHtml(range = getDirRange()) {
  const unit = dirUnitWord(range.granularity);
  return `<div class="dir-grid">
    <article class="dir-card"><h3 class="dir-card-title">Reservations par ${escapeHtml(unit)}</h3><div class="dir-chart" id="dirChartResas"></div></article>
    <article class="dir-card"><h3 class="dir-card-title">Joueurs par ${escapeHtml(unit)}</h3><div class="dir-chart" id="dirChartPax"></div></article>
    <article class="dir-card"><h3 class="dir-card-title">Repartition par activite</h3><div class="dir-chart" id="dirChartTypes"></div></article>
    <article class="dir-card"><h3 class="dir-card-title">Canaux de reservation</h3><div class="dir-chart" id="dirChartChannels"></div></article>
    <article class="dir-card dir-card-wide"><h3 class="dir-card-title">Affluence par jour et heure</h3><div class="dir-chart dir-chart-heat" id="dirChartHeatmap"></div></article>
  </div>`;
}

function dirTablesHtml(entry) {
  const analytics = entry.analytics;
  const formules = (analytics.byFormule || []).slice().sort((a, b) => (Number(b.revenue) || 0) - (Number(a.revenue) || 0));
  const totalFormuleRevenue = formules.reduce((sum, row) => sum + (Number(row.revenue) || 0), 0);
  const clients = ((analytics.clients && analytics.clients.top) || analytics.topClients || []).slice().sort((a, b) => (Number(b.revenue) || 0) - (Number(a.revenue) || 0)).slice(0, 10);

  const formuleRows = formules.length
    ? formules.slice(0, 10).map((row) => {
        const share = totalFormuleRevenue ? Math.round(((Number(row.revenue) || 0) / totalFormuleRevenue) * 100) : 0;
        return `<tr>
          <td>${escapeHtml(row.label || row.id || 'Formule')}</td>
          <td class="dir-num">${Number(row.count) || 0}</td>
          <td class="dir-num">${escapeHtml(formatMoney(row.revenue))}</td>
          <td class="dir-num">${share}%</td>
        </tr>`;
      }).join('')
    : '';

  const clientRows = clients.length
    ? clients.map((row) => {
        const favorite = ADMIN_TREND_TYPE_LABELS[row.favorite] || row.favorite || '';
        const contact = row.phone || row.email || '';
        return `<tr>
          <td><span class="dir-client-name">${escapeHtml(row.name || 'Client')}</span>${contact ? `<span class="dir-client-contact">${escapeHtml(contact)}</span>` : ''}</td>
          <td class="dir-num">${Number(row.visits) || 0}</td>
          <td class="dir-num">${escapeHtml(formatMoney(row.revenue))}</td>
          <td>${escapeHtml(favorite)}</td>
        </tr>`;
      }).join('')
    : '';

  return `<div class="dir-tables">
    <section class="dir-table-card" aria-label="Top formules">
      <h3 class="dir-card-title">Top formules</h3>
      ${formuleRows
        ? `<table class="dir-table"><thead><tr><th>Formule</th><th class="dir-num">Resas</th><th class="dir-num">CA</th><th class="dir-num">Part</th></tr></thead><tbody>${formuleRows}</tbody></table>`
        : '<div class="dir-note">Aucune formule reservee sur cette periode.</div>'}
    </section>
    <section class="dir-table-card" aria-label="Top clients">
      <h3 class="dir-card-title">Top clients</h3>
      ${clientRows
        ? `<table class="dir-table"><thead><tr><th>Client</th><th class="dir-num">Visites</th><th class="dir-num">CA</th><th>Activite favorite</th></tr></thead><tbody>${clientRows}</tbody></table>`
        : '<div class="dir-note">Aucun client identifie sur cette periode.</div>'}
    </section>
  </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTIONS DE DECISION (2026-07-21) : deux capacites AJOUTEES au poste
// d'observation, DISTINCTES de la config Etablissement.
//   1) Comparer mes centres  -> GET action=directionComparison
//   2) Retention et clients  -> GET action=directionRetention
// Discipline identique au reste : ZERO recalcul metier cote front (tout vient du
// serveur), degrade calme PAR SECTION (une panne isole sa section, jamais le
// rendu principal). Rendues a la FIN de renderDirectionBody, dans le meme style
// dir-*. Elles lisent directionDecisionCache (charge en parallele du directionAnalytics).
// ─────────────────────────────────────────────────────────────────────────────

// « Il y a X » a partir d'une date de dernier passage (jours entiers, calme).
function dirDaysAgoLabel(dateStr) {
  if (!dateStr) return 'date inconnue';
  const then = parseLocalDate(dateStr);
  const now = new Date();
  then.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);
  const days = Math.max(0, Math.round((now.getTime() - then.getTime()) / 86400000));
  if (days === 0) return "aujourd'hui";
  if (days === 1) return 'il y a 1 jour';
  if (days < 30) return `il y a ${days} jours`;
  if (days < 365) { const mo = Math.round(days / 30); return `il y a ${mo} mois`; }
  const yr = Math.round(days / 365);
  return yr <= 1 ? 'il y a 1 an' : `il y a ${yr} ans`;
}

// Valeur de cellule de comparaison : jamais un recalcul, juste un formatage
// honnete du champ serveur. Champ absent/nul -> « n/d » calme (ex : occupation
// non calculable pour un centre sans capacite declaree).
function dirCmpValue(value, format) {
  if (value == null || value === '' || Number.isNaN(Number(value))) return 'n/d';
  return dirFormatValue(value, format);
}

// Colonnes comparees (l'ordre = la lecture) : CA d'abord, occupation en fin.
const DIR_CMP_COLS = [
  { key: 'revenue', label: 'CA', format: 'euro' },
  { key: 'reservations', label: 'Resas', format: 'int' },
  { key: 'pax', label: 'Joueurs', format: 'int' },
  { key: 'avgBasket', label: 'Ticket moyen', format: 'euro' },
  { key: 'occupancy', label: 'Occupation', format: 'percent' },
];

// Meilleure valeur PAR colonne (max des champs finis). Sert a marquer le leader
// de chaque colonne discretement. null si aucune valeur exploitable.
function dirCmpBest(centers) {
  const best = {};
  DIR_CMP_COLS.forEach((col) => {
    let max = null;
    centers.forEach((center) => {
      if (center.error) return;
      const v = Number(center[col.key]);
      if (Number.isFinite(v) && (max === null || v > max)) max = v;
    });
    best[col.key] = max;
  });
  return best;
}

function dirCmpRowHtml(center, best, currentId) {
  const isCurrent = center.isCurrent === true || (currentId != null && center.id === currentId);
  const cells = DIR_CMP_COLS.map((col) => {
    const v = Number(center[col.key]);
    const isBest = !center.error
      && Number.isFinite(v)
      && best[col.key] != null
      && best[col.key] > 0
      && v === best[col.key];
    const text = center.error ? 'n/d' : dirCmpValue(center[col.key], col.format);
    const inner = isBest
      ? `<span class="dir-cmp-best-mark" title="Meilleur sur cette colonne">${escapeHtml(text)}</span>`
      : escapeHtml(text);
    return `<td class="dir-num${isBest ? ' dir-cmp-best' : ''}">${inner}</td>`;
  }).join('');
  return `<tr class="dir-cmp-row${isCurrent ? ' is-current' : ''}">
    <th scope="row" class="dir-cmp-name">
      <span class="dir-cmp-center">${escapeHtml(center.name || center.id || 'Centre')}</span>
      ${isCurrent ? '<span class="dir-cmp-badge">Votre centre</span>' : ''}
      ${center.error ? '<span class="dir-cmp-warn">Donnees indisponibles</span>' : ''}
    </th>
    ${cells}
  </tr>`;
}

function dirComparisonInner() {
  const cmp = (directionDecisionCache[dirInsightKey()] || {}).comparison;
  if (!cmp || !cmp.loaded) return '<div class="dir-note dir-note-loading">Chargement de la comparaison des centres...</div>';
  if (cmp.error) return dirNoteHtml('Comparaison momentanement indisponible. Elle reviendra au prochain rafraichissement.');
  const data = cmp.data || {};
  const centers = Array.isArray(data.centers) ? data.centers.slice() : [];
  if (!centers.length) return dirNoteHtml('Aucune donnee de centre a comparer sur cette periode.');
  const currentId = data.currentCenterId == null ? null : data.currentCenterId;
  const best = dirCmpBest(centers);
  const head = DIR_CMP_COLS.map((col) => `<th scope="col" class="dir-num">${escapeHtml(col.label)}</th>`).join('');
  const rows = centers.map((center) => dirCmpRowHtml(center, best, currentId)).join('');
  const single = centers.length < 2
    ? '<p class="dir-cmp-single">La comparaison prend tout son sens avec plusieurs centres.</p>'
    : '';
  const chart = centers.length >= 2
    ? '<div class="dir-cmp-chart" id="dirCmpChart" aria-hidden="true"></div>'
    : '';
  return `${single}<div class="dir-cmp-scroll">
      <table class="dir-table dir-cmp-table">
        <thead><tr><th scope="col">Centre</th>${head}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>${chart}`;
}

function dirComparisonHtml() {
  return `<section class="dir-cmp" aria-label="Comparer mes centres">
    <div class="dir-cmp-head">
      <h2 class="dir-cmp-title">Comparer mes centres</h2>
      <p class="dir-cmp-sub">Vos centres cote a cote sur la periode active.</p>
    </div>
    <div class="dir-cmp-body" id="dirCmpBody">${dirComparisonInner()}</div>
  </section>`;
}

function dirRetLapsedRowHtml(client) {
  const contact = client.phone || client.email || '';
  return `<tr class="dir-ret-lapsed-row">
    <th scope="row"><span class="dir-client-name">${escapeHtml(client.name || 'Client')}</span>${contact ? `<span class="dir-client-contact">${escapeHtml(contact)}</span>` : ''}</th>
    <td class="dir-num">${Number(client.visits) || 0}</td>
    <td class="dir-num">${escapeHtml(formatMoney(client.revenue))}</td>
    <td class="dir-ret-last">${escapeHtml(dirDaysAgoLabel(client.lastVisit))}</td>
  </tr>`;
}

function dirRetentionInner() {
  const ret = (directionDecisionCache[dirInsightKey()] || {}).retention;
  if (!ret || !ret.loaded) return '<div class="dir-note dir-note-loading">Chargement des donnees clients...</div>';
  if (ret.error) return dirNoteHtml('Donnees clients momentanement indisponibles. Elles reviendront au prochain rafraichissement.');
  const data = ret.data || {};
  const seg = data.segment || {};
  const newCount = Number(seg.new) || 0;
  const returning = Number(seg.returning) || 0;
  const unique = Number(seg.unique) || 0;
  const returningRate = seg.returningRate == null ? null : Number(seg.returningRate);
  const segStats = [
    { label: 'Clients uniques', value: dirFormatValue(unique, 'int') },
    { label: 'Nouveaux', value: dirFormatValue(newCount, 'int') },
    { label: 'Deja venus', value: dirFormatValue(returning, 'int') },
    { label: 'Taux de fidelite', value: returningRate == null ? 'n/d' : formatAdminPercent(returningRate) },
    { label: 'Panier moyen nouveaux', value: seg.avgBasketNew == null ? 'n/d' : formatMoney(seg.avgBasketNew) },
    { label: 'Panier moyen recurrents', value: seg.avgBasketReturning == null ? 'n/d' : formatMoney(seg.avgBasketReturning) },
  ].map((stat) => `<div class="dir-ret-stat"><span class="dir-ret-stat-label">${escapeHtml(stat.label)}</span><span class="dir-ret-stat-value">${escapeHtml(stat.value)}</span></div>`).join('');
  const hasSegment = (newCount + returning) > 0;
  const segBlock = `<div class="dir-ret-seg">
    <h3 class="dir-card-title">Nouveaux vs recurrents</h3>
    ${hasSegment ? '<div class="dir-ret-seg-chart" id="dirRetChart" aria-hidden="true"></div>' : dirNoteHtml('Pas encore de repartition clients sur cette periode.')}
    <div class="dir-ret-stats">${segStats}</div>
  </div>`;

  const lapsed = Array.isArray(data.lapsed) ? data.lapsed.slice() : [];
  const since = Number(data.lapsedSinceDays) || 0;
  let lapsedBlock;
  if (!lapsed.length) {
    lapsedBlock = `<div class="dir-ret-lapsed">
      <h3 class="dir-card-title">Clients a relancer</h3>
      ${dirNoteHtml('Aucun habitue dormant a relancer sur cette periode. Vos reguliers reviennent.')}
    </div>`;
  } else {
    const count = lapsed.length;
    const headline = count > 1
      ? `${count} habitues ne sont pas revenus depuis plus de ${since} jours.`
      : `1 habitue n'est pas revenu depuis plus de ${since} jours.`;
    const rows = lapsed.map((client) => dirRetLapsedRowHtml(client)).join('');
    lapsedBlock = `<div class="dir-ret-lapsed">
      <h3 class="dir-card-title">Clients a relancer</h3>
      <p class="dir-ret-lapsed-head">${escapeHtml(headline)}</p>
      <div class="dir-ret-lapsed-scroll">
        <table class="dir-table dir-ret-lapsed-table">
          <thead><tr><th scope="col">Client</th><th scope="col" class="dir-num">Visites</th><th scope="col" class="dir-num">CA cumule</th><th scope="col">Dernier passage</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
  }
  return `<div class="dir-ret-grid">${segBlock}${lapsedBlock}</div>`;
}

function dirRetentionHtml() {
  return `<section class="dir-ret" aria-label="Retention et clients">
    <div class="dir-ret-head">
      <h2 class="dir-ret-title">Retention et clients</h2>
      <p class="dir-ret-sub">Qui revient, qui s'eloigne, sur la periode active.</p>
    </div>
    <div class="dir-ret-body" id="dirRetBody">${dirRetentionInner()}</div>
  </section>`;
}

// Graphiques des sections de decision : degrade calme sans librairie, jamais
// bloquants. Le barChart du CA par centre n'a de sens qu'a partir de 2 centres.
function mountDirCmpChart() {
  const host = document.getElementById('dirCmpChart');
  if (!host) return;
  const cmp = (directionDecisionCache[dirInsightKey()] || {}).comparison;
  const centers = cmp && cmp.data && Array.isArray(cmp.data.centers) ? cmp.data.centers : [];
  const charts = dirCharts();
  if (!charts || typeof charts.barChart !== 'function' || centers.length < 2) return;
  const range = getDirRange();
  charts.barChart(host, {
    series: centers.map((center) => ({ label: center.name || center.id || 'Centre', value: Number(center.revenue) || 0 })),
    format: 'euro',
    motionKey: `dir|cmp|${state.adminCenterId || 'libramont'}|${range.start}|${range.end}|ca`,
  });
}

function mountDirRetChart() {
  const host = document.getElementById('dirRetChart');
  if (!host) return;
  const ret = (directionDecisionCache[dirInsightKey()] || {}).retention;
  const seg = ret && ret.data && ret.data.segment ? ret.data.segment : null;
  const charts = dirCharts();
  if (!charts || typeof charts.donutChart !== 'function' || !seg) return;
  const range = getDirRange();
  charts.donutChart(host, {
    parts: [
      { label: 'Nouveaux', value: Number(seg.new) || 0 },
      { label: 'Deja venus', value: Number(seg.returning) || 0 },
    ],
    format: 'int',
    motionKey: `dir|ret|${state.adminCenterId || 'libramont'}|${range.start}|${range.end}|seg`,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// VUE PROVENANCE (2026-07-21) : POURQUOI les gens viennent (occasion declaree)
// et D'OU vient la reservation (canal, source marketing). Donnee REELLE et
// calculable, servie par GET action=directionAudience (chargee en parallele des
// autres sections de decision, meme cache par centre+fenetre, panne isolee).
// La demographie (age, sexe, zone) N'EST PAS collectee par Pinlane : elle
// viendra de Google Analytics -> carte HONNETE « a connecter », AUCUN faux
// chiffre. Zero recalcul metier cote front : les chiffres du serveur atterrissent
// tels quels dans le DOM.
// ─────────────────────────────────────────────────────────────────────────────

// Part servie par le serveur, formatee en pourcentage entier. Jamais un recalcul :
// une part absente rend une cellule calme « n/d ».
function dirProvSharePct(share) {
  if (share == null || share === '' || Number.isNaN(Number(share))) return 'n/d';
  return `${Math.round(Number(share))}%`;
}

// Occasions declarees sur le formulaire de reservation : barChart par nombre de
// resas + table (occasion, resas, CA, part). Etat calme si rien n'est declare.
function dirProvOccasionsBlock(data) {
  const occasions = Array.isArray(data.occasions) ? data.occasions.slice() : [];
  const has = data.hasDeclaredOccasion === true && occasions.length > 0;
  const rows = occasions.map((row) => `<tr>
      <td>${escapeHtml(row.label || row.key || 'Occasion')}</td>
      <td class="dir-num">${Number(row.count) || 0}</td>
      <td class="dir-num">${escapeHtml(formatMoney(row.revenue))}</td>
      <td class="dir-num">${escapeHtml(dirProvSharePct(row.share))}</td>
    </tr>`).join('');
  return `<article class="dir-card dir-prov-card dir-prov-card-wide" aria-label="Pourquoi ils viennent">
    <h3 class="dir-card-title">Pourquoi ils viennent</h3>
    ${has
      ? `<div class="dir-chart dir-prov-occ" id="dirProvOccChart"></div>
         <table class="dir-table dir-prov-table"><thead><tr><th>Occasion</th><th class="dir-num">Resas</th><th class="dir-num">CA</th><th class="dir-num">Part</th></tr></thead><tbody>${rows}</tbody></table>`
      : dirNoteHtml('Aucune occasion declaree sur la periode.')}
  </article>`;
}

// Canaux de reservation (En ligne vs Staff) : donutChart + valeurs chiffrees.
function dirProvChannelsBlock(data) {
  const channels = Array.isArray(data.channels) ? data.channels.slice() : [];
  const has = channels.length > 0;
  const values = channels.map((row) => `<li class="dir-prov-chan">
      <span class="dir-prov-chan-label">${escapeHtml(row.label || row.key || 'Canal')}</span>
      <span class="dir-prov-chan-value">${Number(row.count) || 0} resas · ${escapeHtml(formatMoney(row.revenue))} · ${escapeHtml(dirProvSharePct(row.share))}</span>
    </li>`).join('');
  return `<article class="dir-card dir-prov-card" aria-label="Canaux de reservation">
    <h3 class="dir-card-title">Canaux de reservation</h3>
    ${has
      ? `<div class="dir-chart" id="dirProvChanChart"></div>
         <ul class="dir-prov-chan-list">${values}</ul>`
      : dirNoteHtml('Aucun canal de reservation sur la periode.')}
  </article>`;
}

// Sources marketing (utm / referrer) : table resas + CA. Etat calme si aucune
// source captee, avec la promesse honnete que les campagnes UTM y apparaitront.
function dirProvSourcesBlock(data) {
  const sources = Array.isArray(data.sources) ? data.sources.slice() : [];
  const has = data.hasSource === true && sources.length > 0;
  const rows = sources.map((row) => `<tr>
      <td>${escapeHtml(row.label || row.key || 'Source')}</td>
      <td class="dir-num">${Number(row.count) || 0}</td>
      <td class="dir-num">${escapeHtml(formatMoney(row.revenue))}</td>
      <td class="dir-num">${escapeHtml(dirProvSharePct(row.share))}</td>
    </tr>`).join('');
  return `<article class="dir-card dir-prov-card" aria-label="Sources marketing">
    <h3 class="dir-card-title">Sources marketing</h3>
    ${has
      ? `<table class="dir-table dir-prov-table"><thead><tr><th>Source</th><th class="dir-num">Resas</th><th class="dir-num">CA</th><th class="dir-num">Part</th></tr></thead><tbody>${rows}</tbody></table>`
      : dirNoteHtml('Aucune source marketing captee sur la periode (les campagnes UTM apparaitront ici).')}
  </article>`;
}

// Carte HONNETE : la demographie n'est pas collectee par Pinlane. Tant que
// demographicsConnected est faux, on affiche un bloc « a connecter » (source
// Google Analytics) et une pilule INERTE, jamais un chiffre d'age/sexe/zone.
function dirProvAudienceBlock(data) {
  const connected = data.demographicsConnected === true;
  if (connected) {
    return `<article class="dir-card dir-prov-card dir-prov-card-wide dir-prov-audience" aria-label="Audience">
      <h3 class="dir-card-title">Audience</h3>
      ${dirNoteHtml('Source demographique connectee. La repartition age, sexe et zone apparaitra ici.')}
    </article>`;
  }
  return `<article class="dir-card dir-prov-card dir-prov-card-wide dir-prov-audience" aria-label="Audience">
    <h3 class="dir-card-title">Audience</h3>
    <p class="dir-prov-audience-text">L'age, le sexe et la zone geographique de vos visiteurs viendront de Google Analytics. Cette source n'est pas encore connectee.</p>
    <span class="dir-prov-audience-pill" role="note" aria-disabled="true">Connecter Google Analytics (a venir)</span>
  </article>`;
}

function dirProvenanceInner() {
  const aud = (directionDecisionCache[dirInsightKey()] || {}).audience;
  if (!aud || !aud.loaded) return '<div class="dir-note dir-note-loading">Chargement de la provenance...</div>';
  if (aud.error) return dirNoteHtml('Provenance momentanement indisponible. Elle reviendra au prochain rafraichissement.');
  const data = aud.data || {};
  return `<div class="dir-prov-grid">
    ${dirProvOccasionsBlock(data)}
    ${dirProvChannelsBlock(data)}
    ${dirProvSourcesBlock(data)}
    ${dirProvAudienceBlock(data)}
  </div>`;
}

function dirProvenanceHtml() {
  return `<section class="dir-prov" aria-label="Provenance des reservations">
    <div class="dir-prov-head">
      <h2 class="dir-prov-title">Provenance</h2>
      <p class="dir-prov-sub">Pourquoi vos clients viennent et d'ou arrive la reservation, sur la periode active.</p>
    </div>
    <div class="dir-prov-body" id="dirProvBody">${dirProvenanceInner()}</div>
  </section>`;
}

// Graphiques de la vue Provenance : degrade calme sans librairie, jamais
// bloquants. barChart des occasions (par nombre de resas) + donutChart des
// canaux (En ligne vs Staff). Les hotes n'existent que quand la vue est active
// et que la donnee porte de quoi tracer (has* vrai) : sinon montage no-op.
function mountDirProvCharts() {
  const aud = (directionDecisionCache[dirInsightKey()] || {}).audience;
  const data = aud && aud.data ? aud.data : null;
  if (!data) return;
  const charts = dirCharts();
  if (!charts) return;
  const range = getDirRange();
  const motionBase = `dir|prov|${state.adminCenterId || 'libramont'}|${range.start}|${range.end}`;
  const occHost = document.getElementById('dirProvOccChart');
  if (occHost && typeof charts.barChart === 'function') {
    const occasions = Array.isArray(data.occasions) ? data.occasions : [];
    charts.barChart(occHost, {
      series: occasions.map((row) => ({ label: row.label || row.key || 'Occasion', value: Number(row.count) || 0 })),
      format: 'int',
      motionKey: `${motionBase}|occasions`,
    });
  }
  const chanHost = document.getElementById('dirProvChanChart');
  if (chanHost && typeof charts.donutChart === 'function') {
    const channels = Array.isArray(data.channels) ? data.channels : [];
    charts.donutChart(chanHost, {
      parts: channels.map((row) => ({ label: row.label || row.key || 'Canal', value: Number(row.count) || 0 })),
      format: 'int',
      motionKey: `${motionBase}|channels`,
    });
  }
}

// Mise a jour CIBLEE des deux sections de decision (sans re-rendre tout le corps :
// on ne perturbe ni les KPI ni le graphique focus). No-op si le corps n'est pas
// encore monte (donnee de decision arrivee avant l'analytique principale).
function renderDirectionDecision() {
  const cmpBody = document.getElementById('dirCmpBody');
  if (cmpBody) cmpBody.innerHTML = dirComparisonInner();
  const retBody = document.getElementById('dirRetBody');
  if (retBody) retBody.innerHTML = dirRetentionInner();
  const provBody = document.getElementById('dirProvBody');
  if (provBody) provBody.innerHTML = dirProvenanceInner();
  mountDirCmpChart();
  mountDirRetChart();
  mountDirProvCharts();
}

// Chargement PARALLELE des deux endpoints de decision (Promise.all), cache par
// centre+fenetre. Panne isolee : chaque section garde son propre etat (calme).
// Ne rejette jamais : chaque appel est neutralise en resultat { status } pour que
// l'echec de l'un n'emporte pas l'autre.
async function loadDirectionDecision(centerId, range, key, force) {
  const existing = directionDecisionCache[key];
  const haveCmp = Boolean(existing && existing.comparison && existing.comparison.loaded);
  const haveRet = Boolean(existing && existing.retention && existing.retention.loaded);
  const haveAud = Boolean(existing && existing.audience && existing.audience.loaded);
  if (!force && haveCmp && haveRet && haveAud) return;
  if (directionDecisionLoading[key]) return;
  directionDecisionLoading[key] = true;
  const cid = encodeURIComponent(centerId);
  const s = encodeURIComponent(range.start);
  const e = encodeURIComponent(range.end);
  const guard = (promise) => promise.then(
    (value) => ({ status: 'fulfilled', value }),
    (reason) => ({ status: 'rejected', reason }),
  );
  const settle = (result, fallbackMessage) => (result.status === 'fulfilled'
    ? { loaded: true, error: '', data: result.value || null }
    : { loaded: true, error: (result.reason && result.reason.message) || fallbackMessage, data: null });
  try {
    const [cmpRes, retRes, audRes] = await Promise.all([
      guard(apiRequest(`${API_ENDPOINTS.ops}?action=directionComparison&centerId=${cid}&startDate=${s}&endDate=${e}`)),
      guard(apiRequest(`${API_ENDPOINTS.ops}?action=directionRetention&centerId=${cid}&startDate=${s}&endDate=${e}`)),
      guard(apiRequest(`${API_ENDPOINTS.ops}?action=directionAudience&centerId=${cid}&startDate=${s}&endDate=${e}`)),
    ]);
    directionDecisionCache[key] = {
      comparison: settle(cmpRes, 'Comparaison indisponible.'),
      retention: settle(retRes, 'Donnees clients indisponibles.'),
      audience: settle(audRes, 'Provenance indisponible.'),
    };
  } finally {
    directionDecisionLoading[key] = false;
  }
  if (state.view === 'admin' && dirInsightKey() === key) {
    renderDirectionDecision();
  }
}

function renderDirectionShell() {
  const range = getDirRange();
  return `<section class="dir-root" id="dirRoot">
    <div class="dir-controls" id="dirControls">
      <div class="dir-range-mount" id="dirRangeHost"></div>
      <div class="dir-window" id="dirWindowLabel">
        <span class="dir-window-range">${escapeHtml(dirRangeText(range))}</span>
        <span class="dir-window-meta">${escapeHtml(`${dirGranularityLabel(range.granularity)} · ${dirCompareLabel(range.compare)}`)}</span>
      </div>
    </div>
    <div class="dir-body" id="dirBody">${dirLoadingHtml()}</div>
  </section>`;
}

function updateDirWindowLabel() {
  const range = getDirRange();
  const host = document.getElementById('dirWindowLabel');
  if (!host) return;
  const rangeEl = host.querySelector('.dir-window-range');
  const metaEl = host.querySelector('.dir-window-meta');
  if (rangeEl) rangeEl.textContent = dirRangeText(range);
  if (metaEl) metaEl.textContent = `${dirGranularityLabel(range.granularity)} · ${dirCompareLabel(range.compare)}`;
}

function onDirRangeChange(next) {
  if (!next || !next.start || !next.end) return;
  // start <= end <= maxDate est garanti par le composant : on ne re-normalise
  // que le vocabulaire (granularite/compare) pour rester dans le contrat.
  state.adminRange = {
    start: next.start,
    end: next.end,
    granularity: ['day', 'week', 'month'].includes(next.granularity) ? next.granularity : 'day',
    compare: ['none', 'previous', 'year'].includes(next.compare) ? next.compare : 'none',
  };
  save();
  updateDirWindowLabel();
  loadDirectionInsights(false);
}

function mountDirRangeControl() {
  const host = document.getElementById('dirRangeHost');
  if (!host) return;
  if (dirRangeHandle && typeof dirRangeHandle.destroy === 'function') {
    try { dirRangeHandle.destroy(); } catch (error) { /* handle deja detache */ }
  }
  dirRangeHandle = null;
  const range = getDirRange();
  const daterange = typeof window !== 'undefined' ? window.PinlaneDateRange : null;
  if (!daterange || typeof daterange.mount !== 'function') {
    // Degrade calme : la periode reste lisible dans le libelle de fenetre.
    host.innerHTML = '<div class="dir-range-fallback">Selecteur de periode indisponible pour le moment. La periode active reste affichee a droite.</div>';
    return;
  }
  dirRangeHandle = daterange.mount(host, {
    value: { start: range.start, end: range.end, granularity: range.granularity, compare: range.compare },
    maxDate: todayStr(),
    onChange: onDirRangeChange,
  });
}

function dirPlayEntrance() {
  const root = document.getElementById('dirRoot');
  if (!root || DIR_ENTRANCE_SEEN) return;
  DIR_ENTRANCE_SEEN = true;
  if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') return;
  root.classList.add('dir-enter-init');
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
    root.classList.remove('dir-enter-init');
    root.classList.add('dir-enter-active');
  }));
}

function mountDirection() {
  if (!state.adminRange || !state.adminRange.start) {
    state.adminRange = getDirDefaultRange();
    save();
  }
  updateDirWindowLabel();
  mountDirRangeControl();
  dirPlayEntrance();
  loadDirectionInsights(false);
}

// Cle par (centre, fenetre), SANS le mode de comparaison : le bloc previous est
// toujours servi avec l'analytique, donc basculer none/precedente ne coute AUCUN
// fetch. Seule 'annee precedente' demande un second appel (fenetre decalee),
// mis en cache sur la meme entree. Changer la fenetre (dates) = un fetch.
function dirInsightKey(centerId, range) {
  const cid = centerId || state.adminCenterId || 'libramont';
  const win = range || getDirRange();
  return `${cid}|${win.start}|${win.end}`;
}

async function loadDirectionInsights(force) {
  const centerId = state.adminCenterId || 'libramont';
  const range = getDirRange();
  const key = dirInsightKey(centerId, range);
  const existing = directionInsightCache[key];
  const needYear = range.compare === 'year';
  const haveBase = Boolean(existing && existing.loaded && existing.analytics);
  const haveYear = !needYear || Boolean(existing && existing.yearAnalytics);
  // Les sections de decision suivent leur PROPRE cycle (fetch parallele, panne
  // isolee) : lancees sans await, elles ne bloquent ni ne conditionnent le rendu
  // principal. Elles gerent leur cache/court-circuit en interne.
  loadDirectionDecision(centerId, range, key, force);
  if (!force && haveBase && haveYear) {
    renderDirectionBody();
    mountDirectionCharts();
    return;
  }
  if (directionInsightLoading[key]) return;
  directionInsightLoading[key] = true;
  // Squelette de chargement seulement quand rien n'est encore a l'ecran : un
  // rafraichissement garde la donnee precedente jusqu'a l'arrivee de la neuve.
  if (!existing) renderDirectionBody();
  try {
    let analytics = existing && !force ? existing.analytics : null;
    let previous = existing && !force ? existing.previous : null;
    if (!analytics || force) {
      const payload = await apiRequest(`${API_ENDPOINTS.ops}?action=directionAnalytics&centerId=${encodeURIComponent(centerId)}&startDate=${encodeURIComponent(range.start)}&endDate=${encodeURIComponent(range.end)}`);
      analytics = payload.analytics || null;
      previous = payload.previous || null;
    }
    let yearAnalytics = existing && !force ? existing.yearAnalytics : null;
    if (needYear && !yearAnalytics) {
      const ys = dirShiftYear(range.start);
      const ye = dirShiftYear(range.end);
      const yearPayload = await apiRequest(`${API_ENDPOINTS.ops}?action=directionAnalytics&centerId=${encodeURIComponent(centerId)}&startDate=${encodeURIComponent(ys)}&endDate=${encodeURIComponent(ye)}`);
      yearAnalytics = yearPayload.analytics || null;
    }
    directionInsightCache[key] = { loaded: true, error: '', analytics, previous, yearAnalytics };
  } catch (error) {
    directionInsightCache[key] = { loaded: false, error: error.message || 'Analytique indisponible.', analytics: null, previous: null, yearAnalytics: null };
  } finally {
    directionInsightLoading[key] = false;
  }
  if (state.view === 'admin' && dirInsightKey() === key) {
    renderDirectionBody();
    mountDirectionCharts();
  }
}

// Segmented nav (pilules facon Linear) : une pilule par vue, indicateur actif
// coulissant. L'indicateur lit --dir-nav-index / --dir-nav-count sur le conteneur
// (transform pilote par CSS) : sur un changement de vue on ne re-rend PAS le nav,
// on deplace juste la variable -> l'indicateur glisse (transform/opacity, ease-out,
// prefers-reduced-motion neutralise dans le CSS). aria : role tablist/tab.
function dirNavHtml(activeView) {
  const view = DIR_VIEWS.includes(activeView) ? activeView : 'synthese';
  const index = DIR_VIEWS.indexOf(view);
  const pills = DIR_VIEW_META.map((meta) => {
    const on = meta.key === view;
    return `<button type="button" role="tab" class="dir-nav-pill${on ? ' is-active' : ''}" data-view="${meta.key}" aria-selected="${on ? 'true' : 'false'}" onclick="setDirView('${meta.key}')">${escapeHtml(meta.label)}</button>`;
  }).join('');
  return `<div class="dir-nav" id="dirNav" role="tablist" aria-label="Vues du poste d'observation" style="--dir-nav-count:${DIR_VIEW_META.length};--dir-nav-index:${index}">
    <span class="dir-nav-indicator" aria-hidden="true"></span>
    ${pills}
  </div>`;
}

// Le contenu de la SEULE vue active. Chaque vue reste calme par section (chaque
// bloc gere son propre vide/erreur) et ne recalcule aucune metrique cote front.
function dirViewHtml(view, entry) {
  if (view === 'activite') return dirGridHtml();
  if (view === 'clients') return dirTablesHtml(entry) + dirRetentionHtml();
  if (view === 'centres') return dirComparisonHtml();
  if (view === 'provenance') return dirProvenanceHtml();
  if (view === 'analyse') return dirAnalyseHtml();
  // synthese (defaut) : la rangee de KPI cliquables + le grand graphe focus.
  return dirKpisHtml(entry) + dirFocusHtml();
}

// Vue Analyse : un SLOT vide. Le contenu (window.PinlaneAnalyticsBoard) vit dans
// un hote PERSISTANT deplace ici par mountDirAnalyseBoard a chaque rendu, jamais
// re-cree. Pas de <header> (piege body.admin-mode header{height:0}) : section/div.
function dirAnalyseHtml() {
  return `<section class="dir-analyse" aria-label="Analyse personnalisee">
    <div class="dir-analyse-slot" id="dirAnalyseSlot"></div>
  </section>`;
}

// Le board fetch SA PROPRE plage : getAnalytics(startISO, endISO) frappe
// directionAnalytics du centre courant et renvoie payload.analytics (zero
// recalcul cote front, meme contrat que loadDirectionInsights).
async function dirBoardGetAnalytics(start, end) {
  const centerId = state.adminCenterId || 'libramont';
  const payload = await apiRequest(`${API_ENDPOINTS.ops}?action=directionAnalytics&centerId=${encodeURIComponent(centerId)}&startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}`);
  return (payload && payload.analytics) || null;
}

// Montage ROBUSTE aux re-rendus (mirroir de mountDashAnalyticsBoard) : l'hote
// PERSISTANT est cree UNE fois (data-board-instance stable = preuve d'identite
// du noeud), DEPLACE dans le slot de la vue active par appendChild, et le board
// n'est monte QU'UNE fois. Revenir sur Analyse re-utilise le meme noeud : aucun
// re-fetch, aucun scintillement, config du board preservee.
function mountDirAnalyseBoard() {
  const slot = document.getElementById('dirAnalyseSlot');
  if (!slot) return;
  if (!dirAnalyseContainer) {
    dirAnalyseContainer = document.createElement('div');
    dirAnalyseContainer.className = 'dir-analyse-host';
    dirAnalyseContainer.setAttribute('data-board-instance', 'dir-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
  }
  if (dirAnalyseContainer.parentNode !== slot) slot.appendChild(dirAnalyseContainer);
  if (!dirAnalyseHandle && typeof window !== 'undefined' && window.PinlaneAnalyticsBoard && typeof window.PinlaneAnalyticsBoard.mount === 'function') {
    dirAnalyseHandle = window.PinlaneAnalyticsBoard.mount(dirAnalyseContainer, {
      storageKey: 'pinlane-direction-board',
      getAnalytics: dirBoardGetAnalytics,
      defaultWidgets: [
        { metric: 'revenue', viz: 'line' },
        { metric: 'reservations', viz: 'bars' },
        { metric: 'byType', viz: 'donut' },
        { metric: 'occupancy', viz: 'tile' },
      ],
      maxDate: todayStr(),
    });
  }
}

// La vue Analyse apporte SA PROPRE barre de plage libre (le board est un outil
// d'analyse personnalise) : on masque la barre de plage GLOBALE de Direction pour
// ne pas presenter deux selecteurs de periode aux semantiques differentes. Les
// autres vues la gardent (fenetre globale commune, hors #dirBody, jamais re-rendue).
function syncDirControlsForView() {
  const controls = document.getElementById('dirControls');
  if (!controls) return;
  controls.hidden = getDirView() === 'analyse';
}

function renderDirectionBody() {
  const body = document.getElementById('dirBody');
  if (!body) return;
  const entry = directionInsightCache[dirInsightKey()];
  if (!entry) { body.innerHTML = dirLoadingHtml(); return; }
  if (entry.error) { body.innerHTML = dirNoteHtml('Analytique momentanement indisponible. Elle reviendra au prochain rafraichissement.'); return; }
  if (!entry.analytics) { body.innerHTML = dirNoteHtml('Pas encore de donnees sur cette periode.'); return; }
  const view = getDirView();
  body.innerHTML = `${dirNavHtml(view)}<div class="dir-view" id="dirViewContent">${dirViewHtml(view, entry)}</div>`;
  syncDirControlsForView();
}

// Changer de vue : etat persiste (save), l'indicateur glisse (variable CSS mise a
// jour sur le nav EXISTANT, sans re-rendre le nav), et SEUL le contenu de la vue
// est reconstruit puis remonte (graphes de la vue active). No-op si la vue ne
// change pas (on ne rejoue pas l'animation ni un fetch). La barre de plage reste
// intacte (elle vit hors du #dirBody, dans #dirControls).
function setDirView(view) {
  if (!DIR_VIEWS.includes(view) || getDirView() === view) return;
  state.adminView = view;
  save();
  syncDirControlsForView();
  const nav = document.getElementById('dirNav');
  if (nav) {
    nav.style.setProperty('--dir-nav-index', String(DIR_VIEWS.indexOf(view)));
    nav.querySelectorAll('.dir-nav-pill').forEach((pill) => {
      const on = pill.getAttribute('data-view') === view;
      pill.classList.toggle('is-active', on);
      pill.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }
  const content = document.getElementById('dirViewContent');
  const entry = directionInsightCache[dirInsightKey()];
  if (!content || !entry || !entry.analytics) return;
  content.innerHTML = dirViewHtml(view, entry);
  mountDirectionCharts();
}

function dirCharts() {
  return typeof window !== 'undefined' ? window.PinlaneCharts : null;
}

function mountDirFocusChart(entry) {
  const host = document.getElementById('dirFocusChart');
  if (!host) return;
  const charts = dirCharts();
  if (!charts || typeof charts.lineChart !== 'function') { host.textContent = 'Graphique indisponible pour le moment.'; return; }
  const range = getDirRange();
  const focus = getDirFocusMetric();
  const cfg = DIR_FOCUS[focus];
  // Le grand graphe focus est SEUL dans la vue Synthese : viewBox large et plat
  // (hauteur ~320px a la largeur bureau typique) au lieu de l'ancien 300 qui, en
  // pleine largeur, produisait un graphe demesure. Le CSS (.dir-focus-chart) le
  // cadre ; la vue entre dans le motionKey pour animer a la premiere apparition.
  charts.lineChart(host, {
    series: dirMetricSeries(entry.analytics, range.granularity, cfg.field),
    format: cfg.format,
    height: 170,
    motionKey: `dir|focus|${state.adminCenterId || 'libramont'}|${range.start}|${range.end}|${range.granularity}|${getDirView()}|${focus}`,
  });
}

function mountDirectionCharts() {
  const entry = directionInsightCache[dirInsightKey()];
  if (!entry || !entry.analytics) return;
  const analytics = entry.analytics;
  const range = getDirRange();
  const charts = dirCharts();
  // La vue entre dans le motionKey : la premiere apparition d'une vue anime ses
  // graphes ; y revenir ne les rejoue pas (garde SEEN de PinlaneCharts). Les
  // hotes des vues inactives ne sont pas dans le DOM : leur montage est un no-op
  // silencieux (resolveHost renvoie null), donc appeler tous les montages ici
  // reste sur (seule la vue active a des hotes reels a peindre).
  const motionBase = `dir|${state.adminCenterId || 'libramont'}|${range.start}|${range.end}|${range.granularity}|${getDirView()}`;

  // Valeurs KPI (countUp) + mini-sparklines : degrade calme sans librairie.
  DIR_KPIS.forEach((kpi) => {
    const valueEl = document.getElementById(`dirKpiVal-${kpi.key}`);
    const cur = kpi.cur(analytics.totals || {}, analytics);
    if (valueEl) {
      if (charts && typeof charts.countUp === 'function') charts.countUp(valueEl, cur == null ? 0 : cur, { format: kpi.format });
      else valueEl.textContent = dirFormatValue(cur == null ? 0 : cur, kpi.format);
    }
    const sparkEl = document.getElementById(`dirKpiSpark-${kpi.key}`);
    if (sparkEl && charts && typeof charts.lineChart === 'function') {
      charts.lineChart(sparkEl, {
        series: dirMetricSeries(analytics, range.granularity, kpi.spark),
        format: kpi.format === 'euro' ? 'euro' : 'int',
        height: 120,
        motionKey: `${motionBase}|spark|${kpi.key}`,
      });
    }
  });

  mountDirFocusChart(entry);

  if (charts && typeof charts.barChart === 'function') {
    charts.barChart(document.getElementById('dirChartResas'), {
      series: dirMetricSeries(analytics, range.granularity, 'count', true),
      format: 'int',
      motionKey: `${motionBase}|resas`,
    });
    charts.barChart(document.getElementById('dirChartChannels'), {
      series: (analytics.byChannel || []).map((row) => ({ label: ADMIN_TREND_CHANNEL_LABELS[row.channel] || String(row.channel || 'autre'), value: Number(row.count) || 0 })),
      format: 'int',
      motionKey: `${motionBase}|channels`,
    });
  }
  if (charts && typeof charts.lineChart === 'function') {
    charts.lineChart(document.getElementById('dirChartPax'), {
      series: dirMetricSeries(analytics, range.granularity, 'pax'),
      format: 'int',
      motionKey: `${motionBase}|pax`,
    });
  }
  if (charts && typeof charts.donutChart === 'function') {
    charts.donutChart(document.getElementById('dirChartTypes'), {
      parts: Object.entries(analytics.byType || {}).map(([type, row]) => ({ label: ADMIN_TREND_TYPE_LABELS[type] || type, value: Number(row && row.revenue) || 0 })),
      format: 'euro',
      motionKey: `${motionBase}|types`,
    });
  }
  if (charts && typeof charts.heatmapChart === 'function') {
    const model = buildAdminHeatmapModel(analytics.heatmap);
    charts.heatmapChart(document.getElementById('dirChartHeatmap'), {
      matrix: model.matrix,
      rowLabels: model.rowLabels,
      colLabels: model.colLabels,
      motionKey: `${motionBase}|heatmap`,
    });
  }

  // Graphiques des sections de decision (montes si leur donnee est deja la ;
  // sinon renderDirectionDecision les montera a l'arrivee du fetch parallele).
  mountDirCmpChart();
  mountDirRetChart();
  mountDirProvCharts();

  // Vue Analyse : deplace l'hote persistant du board dans son slot (no-op si le
  // slot n'est pas dans le DOM, c.-a-d. une autre vue est active). Monte le board
  // une seule fois ; ne le detruit jamais au changement de vue.
  mountDirAnalyseBoard();
}

// Interaction coeur : cliquer une tuile choisit la metrique du grand graphique.
// On ne re-anime pas toute la page (les KPI restent) : mise a jour ciblee des
// tuiles actives, du titre focus, et remontage du seul graphique focus.
function setDirFocusMetric(metric) {
  if (!DIR_FOCUS[metric]) return;
  state.adminFocusMetric = metric;
  save();
  const tiles = document.querySelectorAll('#dirKpis .dir-kpi');
  tiles.forEach((tile) => {
    const on = tile.getAttribute('data-focus') === metric;
    tile.classList.toggle('is-active', on);
    tile.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  const entry = directionInsightCache[dirInsightKey()];
  if (!entry || !entry.analytics) return;
  const cfg = DIR_FOCUS[metric];
  const titleEl = document.querySelector('.dir-focus-title');
  if (titleEl) titleEl.textContent = cfg.label;
  mountDirFocusChart(entry);
}

function renderAdminDashboard() {
  state.adminTab = normalizeAdminTab(state.adminTab);
  renderAdminHeader();
  const content = document.getElementById('adminContent');
  if (!content) return;
  markAdminTabMount(content);
  // POSTE D'OBSERVATION (refonte dir-*) : route par defaut, montee AVANT les
  // gardes de chargement du cache periode. Sa donnee vient de directionAnalytics
  // (loadDirectionInsights), independante de adminDashboardCache : la page
  // s'affiche tout de suite et charge son analytique en propre. Les anciens
  // panneaux (Synthese/Signaux/Verifications/Cockpit/Tendances) ne sont plus
  // rendus. Les routes ci-dessous restent pour les acces hors barre d'onglets
  // (relance -> Mails, deep-link) tant que l'integrateur n'a pas retire la barre.
  if (state.adminTab === 'overview') {
    content.innerHTML = renderDirectionShell();
    mountDirection();
    return;
  }
  // Le Journal ne dépend pas du snapshot période : il se rend même pendant un
  // chargement, comme Données et Mails.
  if (state.adminTab === 'journal') {
    content.innerHTML = renderAdminJournalTab();
    return;
  }
  const cacheIsCurrent = isAdminDashboardCacheCurrent();
  if (adminDashboardCache.loading && (!adminDashboardCache.loaded || !cacheIsCurrent)) {
    content.innerHTML = `<div class="admin-panel"><div class="empty-state"><div class="e-title">Chargement direction</div><div class="e-sub">Récupération du centre, des réservations, des mails et des signaux agents.</div></div></div>`;
    return;
  }
  // « Données » gère son propre chargement long-range : jamais bloqué par le
  // cache ni les erreurs du dashboard période.
  if (state.adminTab === 'data') {
    if (typeof renderAdminDataTab === 'function') {
      content.innerHTML = renderAdminDataTab();
      // Lecture visuelle : section Direction insérée dans le hub Données à
      // partir du MÊME état dhState (zéro fetch supplémentaire), avant les
      // bilans pour rester dans le flux de lecture chiffres -> visuel -> bilan.
      const dataWrap = content.querySelector('.dh-wrap');
      const dataChartsSection = renderAdminDataChartsSection();
      if (dataWrap && dataChartsSection) {
        const reportsSection = dataWrap.querySelector('#dhReports');
        if (reportsSection) reportsSection.insertAdjacentHTML('beforebegin', dataChartsSection);
        else dataWrap.insertAdjacentHTML('beforeend', dataChartsSection);
      }
      if (typeof initAdminDataTab === 'function') initAdminDataTab();
      mountAdminDataCharts();
    } else {
      content.innerHTML = '<div class="admin-panel"><div class="empty-state"><div class="e-title">Module Données indisponible</div><div class="e-sub">Rechargez la page.</div></div></div>';
    }
    return;
  }
  if (state.adminTab === 'mail') {
    if (typeof renderAdminMailTab === 'function') {
      content.innerHTML = renderAdminMailTab();
      if (typeof initAdminMailTab === 'function') initAdminMailTab();
    } else {
      content.innerHTML = '<div class="admin-panel"><div class="empty-state"><div class="e-title">Module Mails indisponible</div><div class="e-sub">Rechargez la page.</div></div></div>';
    }
    return;
  }
  if (adminDashboardCache.error && (!adminDashboardCache.loaded || !cacheIsCurrent)) {
    content.innerHTML = `<div class="admin-panel"><div class="empty-state"><div class="e-title">Données indisponibles</div><div class="e-sub">${escapeHtml(adminDashboardCache.error)}</div></div></div>`;
    return;
  }
  if (!adminDashboardCache.loaded || !cacheIsCurrent) {
    content.innerHTML = `<div class="admin-panel"><div class="empty-state"><div class="e-title">Chargement période</div><div class="e-sub">La console prépare les données demandées. Les périodes déjà ouvertes restent en cache.</div></div></div>`;
    return;
  }
  if (state.adminTab === 'reservations') {
    content.innerHTML = renderAdminReservationsTable(adminDashboardCache.snapshot?.reservations || []);
    return;
  }
  if (state.adminTab === 'ops') {
    content.innerHTML = renderAdminOpsPanel();
    renderOpsAdmin();
    return;
  }
  if (state.adminTab === 'exports') {
    content.innerHTML = renderAdminExports();
    return;
  }
  content.innerHTML = renderAdminOverview();
  // Montage APRES l'écriture innerHTML : les hôtes des graphiques existent.
  // Déclenche aussi le premier fetch directionAnalytics de la fenêtre.
  mountAdminTrendCharts();
}

async function refreshAdminKnowledge(force = false, requestId = adminLoadRequestId) {
  if (adminKnowledgeLoading && !force) return;
  if (!force && adminDashboardCache.knowledge) return;
  adminKnowledgeLoading = true;
  try {
    const knowledgePayload = await apiRequest(`${API_ENDPOINTS.ops}?action=knowledge`);
    if (requestId !== adminLoadRequestId && state.view === 'admin') return;
    adminDashboardCache.knowledge = knowledgePayload;
    Object.keys(adminSnapshotCache).forEach(key => {
      adminSnapshotCache[key] = { ...adminSnapshotCache[key], knowledge: knowledgePayload };
    });
    if (state.view === 'admin') renderAdminDashboard();
  } catch (error) {
    console.warn('Admin knowledge refresh failed', error);
  } finally {
    adminKnowledgeLoading = false;
  }
}

async function loadAdminOpsForCenter(centerId = state.adminCenterId || 'libramont', force = false, requestId = adminLoadRequestId) {
  const range = getAdminPeriodRange();
  const key = getAdminOpsCacheKey(centerId, range);
  if (adminOpsLoadingByCenter[key] && !force) return;
  if (!force && adminOpsCacheByCenter[key]?.loaded) {
    if (state.view === 'admin' && (state.adminCenterId || 'libramont') === centerId) {
      opsAdminCache = { ...adminOpsCacheByCenter[key], loading: false };
      adminDashboardCache = mergeAdminOpsIntoDashboard(adminDashboardCache, adminOpsCacheByCenter[key]);
      renderAdminDashboard();
    }
    return;
  }
  adminOpsLoadingByCenter[key] = true;
  try {
    const centerQuery = encodeURIComponent(centerId);
    const startDate = encodeURIComponent(range.startDate);
    const endDate = encodeURIComponent(range.endDate);
    const simDate = encodeURIComponent(state.adminDate || range.startDate);
    // DEUX CORRECTIONS D'UNE REVUE ADVERSE, a ne pas defaire :
    // 1. L'outillage FONDATEUR (stack IA, simulation) n'est plus fetche que par
    //    un porteur de platform.admin. Avant, TOUTE directrice le telechargait a
    //    chaque chargement : masque a l'ecran mais present dans opsAdminCache,
    //    lisible en devtools. Masquer n'est pas cloisonner.
    // 2. allSettled et non all : un 403 sur UNE lecture (role sans ai.ops, ou
    //    outillage fondateur refuse) ne doit pas tuer l'onglet Activite et le
    //    bandeau d'honnetete avec lui. Chaque panneau degrade seul.
    const isPlatformAdmin = typeof canUseStaffPermission === 'function' && canUseStaffPermission('platform.admin');
    const settled = await Promise.allSettled([
      apiRequest(`${API_ENDPOINTS.ops}?action=communications&centerId=${centerQuery}&limit=180`),
      apiRequest(`${API_ENDPOINTS.ops}?action=emailSamples`),
      apiRequest(`${API_ENDPOINTS.ops}?action=suggestions&centerId=${centerQuery}&limit=120`),
      apiRequest(`${API_ENDPOINTS.ops}?action=events&centerId=${centerQuery}&limit=160`),
      isPlatformAdmin
        ? apiRequest(`${API_ENDPOINTS.ops}?action=agentStack&centerId=${centerQuery}&startDate=${startDate}&endDate=${endDate}`)
        : Promise.resolve(null),
      apiRequest(`${API_ENDPOINTS.ops}?action=health&centerId=${centerQuery}&limit=40`),
      isPlatformAdmin
        ? apiRequest(`${API_ENDPOINTS.simulation}?action=status&centerId=${centerQuery}&date=${simDate}`)
        : Promise.resolve(null),
    ]);
    const settledValue = (index) => (settled[index] && settled[index].status === 'fulfilled' ? settled[index].value : null);
    const communicationsPayload = settledValue(0) || {};
    const samplesPayload = settledValue(1) || {};
    const suggestionsPayload = settledValue(2) || {};
    const eventsPayload = settledValue(3) || {};
    const agentStackPayload = settledValue(4);
    const healthPayload = settledValue(5) || {};
    const simulationPayload = settledValue(6);
    const ops = {
      communications: communicationsPayload.communications || [],
      samples: samplesPayload.samples || [],
      suggestions: suggestionsPayload.suggestions || [],
      events: eventsPayload.events || [],
      agentStack: agentStackPayload || null,
      opsHealth: healthPayload.health || null,
      // Flag serveur « données de test » (health, scope centre) : source du
      // bandeau d'honnêteté du cockpit, jamais inventé côté client.
      testData: healthPayload.testData === true,
      simulation: simulationPayload || null,
      loaded: true,
      loading: false,
      lastLoadedAt: new Date().toISOString()
    };
    adminOpsCacheByCenter[key] = ops;
    if (requestId === adminLoadRequestId && state.view === 'admin' && (state.adminCenterId || 'libramont') === centerId) {
      opsAdminCache = ops;
      adminDashboardCache = mergeAdminOpsIntoDashboard(adminDashboardCache, ops);
      renderAdminDashboard();
    }
  } catch (error) {
    console.warn('Admin ops refresh failed', error);
  } finally {
    adminOpsLoadingByCenter[key] = false;
  }
}

function prefetchAdminPeriodSnapshots(centerId = state.adminCenterId || 'libramont', anchor = state.adminDate || todayStr()) {
  ['day', 'week', 'month', 'year'].forEach(period => {
    const range = getAdminPeriodRangeFor(period, anchor);
    const key = getAdminRangeCacheKey(centerId, range);
    if (adminSnapshotCache[key] || adminSnapshotLoadingKeys[key]) return;
    adminSnapshotLoadingKeys[key] = true;
    const centerQuery = encodeURIComponent(centerId);
    const startDate = encodeURIComponent(range.startDate);
    const endDate = encodeURIComponent(range.endDate);
    apiRequest(`${API_ENDPOINTS.adminRange}?startDate=${startDate}&endDate=${endDate}&centerId=${centerQuery}`)
      .then(snapshotPayload => {
        adminSnapshotCache[key] = {
          loading: false,
          loaded: true,
          error: '',
          centerId,
          date: anchor,
          startDate: range.startDate,
          endDate: range.endDate,
          snapshot: snapshotPayload,
          knowledge: adminDashboardCache.knowledge,
          communications: [],
          suggestions: [],
          events: [],
          samples: [],
          opsHealth: snapshotPayload.opsHealth || null,
          lastLoadedAt: new Date().toISOString()
        };
      })
      .catch(error => console.warn('Admin period prefetch failed', error))
      .finally(() => {
        adminSnapshotLoadingKeys[key] = false;
      });
  });
}

async function loadAdminDashboard(force = false) {
  const requestId = ++adminLoadRequestId;
  const centerId = state.adminCenterId || 'libramont';
  const range = getAdminPeriodRange();
  // Tendances en échec : purge de l'entrée pour que le prochain montage
  // refetche (c'est CE chemin qui rend vraie la promesse « elles reviendront
  // au prochain rafraîchissement » ; jamais de retry depuis le montage, sinon
  // boucle infinie fetch raté -> re-rendu -> fetch).
  const failedTrendKey = getAdminTrendKey(centerId, getAdminTrendWindow(range));
  if (adminTrendCache[failedTrendKey] && adminTrendCache[failedTrendKey].error) {
    delete adminTrendCache[failedTrendKey];
  }
  const cacheKey = getAdminRangeCacheKey(centerId, range);
  const opsKey = getAdminOpsCacheKey(centerId);
  const cachedSnapshot = adminSnapshotCache[cacheKey];
  const cachedOps = adminOpsCacheByCenter[opsKey];

  if (cachedOps) {
    opsAdminCache = { ...cachedOps, loading: false };
  }

  if (!force && cachedSnapshot) {
    adminDashboardCache = mergeAdminOpsIntoDashboard({
      ...cachedSnapshot,
      loading: false,
      loaded: true,
      error: '',
      date: state.adminDate,
      knowledge: cachedSnapshot.knowledge || adminDashboardCache.knowledge
    }, cachedOps);
    renderAdminDashboard();
    refreshAdminKnowledge(false, requestId);
    loadAdminOpsForCenter(centerId, false, requestId);
    prefetchAdminPeriodSnapshots(centerId, state.adminDate);
    return;
  }

  const keepCurrentData = isAdminDashboardCacheCurrent();
  adminDashboardCache = mergeAdminOpsIntoDashboard({
    loading: true,
    loaded: keepCurrentData && adminDashboardCache.loaded,
    error: '',
    centerId,
    date: state.adminDate,
    startDate: range.startDate,
    endDate: range.endDate,
    snapshot: keepCurrentData ? adminDashboardCache.snapshot : null,
    knowledge: adminDashboardCache.knowledge || cachedSnapshot?.knowledge || null,
    communications: keepCurrentData ? adminDashboardCache.communications : [],
    suggestions: keepCurrentData ? adminDashboardCache.suggestions : [],
    events: keepCurrentData ? adminDashboardCache.events : [],
    samples: keepCurrentData ? adminDashboardCache.samples : [],
    agentStack: keepCurrentData ? adminDashboardCache.agentStack : null,
    opsHealth: keepCurrentData ? adminDashboardCache.opsHealth : null,
    simulation: keepCurrentData ? adminDashboardCache.simulation : null,
    lastLoadedAt: keepCurrentData ? adminDashboardCache.lastLoadedAt : ''
  }, cachedOps);
  renderAdminDashboard();
  refreshAdminKnowledge(force, requestId);
  loadAdminOpsForCenter(centerId, force, requestId);

  try {
    const centerQuery = encodeURIComponent(centerId);
    const startDate = encodeURIComponent(range.startDate);
    const endDate = encodeURIComponent(range.endDate);
    const snapshotPayload = await apiRequest(`${API_ENDPOINTS.adminRange}?startDate=${startDate}&endDate=${endDate}&centerId=${centerQuery}`);
    if (requestId !== adminLoadRequestId) return;
    const entry = {
      loading: false,
      loaded: true,
      error: '',
      centerId,
      date: state.adminDate,
      startDate: range.startDate,
      endDate: range.endDate,
      snapshot: snapshotPayload,
      knowledge: adminDashboardCache.knowledge,
      communications: [],
      suggestions: [],
      events: [],
      samples: [],
      opsHealth: snapshotPayload.opsHealth || adminDashboardCache.opsHealth || null,
      simulation: adminDashboardCache.simulation || null,
      lastLoadedAt: new Date().toISOString()
    };
    adminSnapshotCache[cacheKey] = entry;
    adminDashboardCache = mergeAdminOpsIntoDashboard(entry, adminOpsCacheByCenter[opsKey]);
    markRemoteSyncSuccess();
    renderAdminDashboard();
    prefetchAdminPeriodSnapshots(centerId, state.adminDate);
  } catch (error) {
    if (requestId !== adminLoadRequestId) return;
    markRemoteSyncFailure(error);
    if (adminDashboardCache.loaded && isAdminDashboardCacheCurrent()) {
      adminDashboardCache.loading = false;
      adminDashboardCache.error = '';
      toast('Actualisation direction impossible, affichage du cache.');
    } else {
      adminDashboardCache.loading = false;
      adminDashboardCache.loaded = false;
      adminDashboardCache.error = error.message || 'Chargement direction impossible.';
    }
    renderAdminDashboard();
  }
}

function setAdminCenter(centerId) {
  state.adminCenterId = centerId || 'libramont';
  save();
  loadAdminDashboard(false);
}

function setAdminDate(value) {
  if (!value) return;
  state.adminDate = value;
  save();
  loadAdminDashboard(false);
}

function shiftAdminDate(delta) {
  const d = parseLocalDate(state.adminDate || todayStr());
  if (state.adminPeriod === 'month') d.setMonth(d.getMonth() + delta);
  else if (state.adminPeriod === 'year') d.setFullYear(d.getFullYear() + delta);
  else d.setDate(d.getDate() + (state.adminPeriod === 'week' ? delta * 7 : delta));
  state.adminDate = toLocalDateStr(d);
  save();
  loadAdminDashboard(false);
}

function setAdminPeriod(period) {
  state.adminPeriod = ['day', 'week', 'month', 'year'].includes(period) ? period : 'day';
  save();
  loadAdminDashboard(false);
}

function setAdminTab(tab) {
  state.adminTab = tab || 'overview';
  save();
  renderAdminDashboard();
  // Mobile : la barre d'onglets defile horizontalement et le re-rendu repart du
  // scroll residuel. Mesure a 390px : apres navigation, l'onglet ACTIF pouvait
  // etre entierement hors champ (scrollLeft=218, activeTabVisible=false), et
  // rien n'indiquait ou l'on etait. On ramene le bouton actif en vue, sans
  // animation (le defilement d'ancrage n'est pas une animation d'interface).
  const activeTab = document.querySelector('.admin-tabs .active');
  if (activeTab && typeof activeTab.scrollIntoView === 'function') {
    activeTab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

function setOpsTab(tab) {
  // Sous-onglets plateforme (Stack IA, Simulation rush) : refusés hors
  // platform.admin, même par appel direct. Toute autre clé, anciennes valeurs
  // persistées comprises (communications, samples...), retombe sur l'activité.
  const platformTabs = ['stack', 'simulation'];
  state.opsPanelTab = platformTabs.includes(tab) && isAdminPlatformOwner() ? tab : 'activity';
  save();
  renderOpsAdmin();
  if (state.opsPanelTab === 'simulation') loadOpsSimulationStatus();
}

function startAdminHealthAutoRefresh() {
  if (typeof window === 'undefined' || window.__pinlaneAdminHealthTimer) return;
  const intervalFn = typeof window.setInterval === 'function'
    ? window.setInterval.bind(window)
    : (typeof setInterval === 'function' ? setInterval : null);
  if (!intervalFn) return;
  window.__pinlaneAdminHealthTimer = intervalFn(() => {
    if (state.view !== 'admin') return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    loadAdminOpsForCenter(state.adminCenterId || 'libramont', true, adminLoadRequestId);
  }, 45000);
}

(function exposeAdminConsole(global) {
  if (!global) return;
  global.PinlaneAdminConsole = {
    getAdminPeriodRangeFor,
    getAdminPeriodRange,
    formatAdminPeriodLabel,
    getAdminRangeCacheKey,
    getAdminOpsCacheKey,
    isAdminDashboardCacheCurrent,
    mergeAdminOpsIntoDashboard,
    getAdminStatusLabel,
    getAdminResourceText,
    getAdminResourceHtml,
    buildAdminMarketMetrics,
    getClientProfileKey,
    buildAdminClientProfiles,
    getAdminExportPayload,
    // C14 : downloadTextFile/csvCell vivent dans app-main.js (globals au
    // runtime) : référence défensive pour les harnais qui isolent ce module.
    downloadTextFile: typeof downloadTextFile === 'function' ? downloadTextFile : undefined,
    downloadBlob,
    csvCell: typeof csvCell === 'function' ? csvCell : undefined,
    exportAdminCsv,
    exportAdminJson,
    escapeXml,
    excelCell,
    excelRow,
    excelSheet,
    groupSum,
    objectRows,
    buildAdminExcelXml,
    exportAdminExcel,
    buildFunGalaxyReportHtml,
    exportAdminReport,
    buildAdminMetrics,
    buildAdminInsights,
    countAdminHealthStatus,
    getAdminHealthCommunications,
    findAdminBowlingConflicts,
    findAdminLaserIssues,
    findAdminReservationIssues,
    getAdminDelayHealth,
    buildAdminOperationalChecks,
    renderAdminOperationalHealth,
    buildAdminCockpitItems,
    getAdminCockpitMode,
    setAdminCockpitMode,
    filterAdminCockpitItems,
    buildAdminCockpitRows,
    buildAdminCockpitDecision,
    buildAdminCockpitActions,
    getAdminCockpitAgentSnapshot,
    renderAdminCockpitMetricBar,
    renderAdminCockpit,
    runAdminOrchestratorNow,
    renderAdminCenterGrid,
    renderAdminHeader,
    renderAdminHonestyNote,
    getAdminTrendWindow,
    getAdminTrendKey,
    loadAdminTrends,
    buildAdminTrendDeltaChip,
    buildAdminTrendSeries,
    renderAdminTrendsPanel,
    mountAdminTrendCharts,
    renderAdminDataChartsSection,
    buildAdminHeatmapModel,
    mountAdminDataCharts,
    renderAdminOverview,
    // POSTE D'OBSERVATION Direction (dir-*)
    getDirDefaultRange,
    getDirRange,
    getDirFocusMetric,
    getDirView,
    dirNavHtml,
    dirViewHtml,
    setDirView,
    dirShiftYear,
    dirFormatValue,
    dirRangeText,
    getDirReferenceTotals,
    buildDirDeltaChip,
    dirMetricSeries,
    dirKpisHtml,
    dirFocusHtml,
    dirGridHtml,
    dirTablesHtml,
    // Vue Analyse (tableau personnalisable window.PinlaneAnalyticsBoard)
    dirAnalyseHtml,
    dirBoardGetAnalytics,
    mountDirAnalyseBoard,
    syncDirControlsForView,
    // Sections de decision (Comparer mes centres + Retention et clients)
    dirDaysAgoLabel,
    dirCmpValue,
    dirCmpBest,
    dirCmpRowHtml,
    dirComparisonInner,
    dirComparisonHtml,
    dirRetLapsedRowHtml,
    dirRetentionInner,
    dirRetentionHtml,
    mountDirCmpChart,
    mountDirRetChart,
    // Vue Provenance (occasions, canaux, sources, audience a connecter)
    dirProvSharePct,
    dirProvOccasionsBlock,
    dirProvChannelsBlock,
    dirProvSourcesBlock,
    dirProvAudienceBlock,
    dirProvenanceInner,
    dirProvenanceHtml,
    mountDirProvCharts,
    renderDirectionDecision,
    loadDirectionDecision,
    renderDirectionShell,
    updateDirWindowLabel,
    onDirRangeChange,
    mountDirRangeControl,
    mountDirection,
    dirInsightKey,
    loadDirectionInsights,
    renderDirectionBody,
    mountDirFocusChart,
    mountDirectionCharts,
    setDirFocusMetric,
    renderAdminReservationsTable,
    isAdminPlatformOwner,
    normalizeAdminTab,
    renderAdminJournalTab,
    renderAdminOpsPanel,
    renderAdminExports,
    renderAdminDashboard,
    refreshAdminKnowledge,
    loadAdminOpsForCenter,
    prefetchAdminPeriodSnapshots,
    loadAdminDashboard,
    setAdminCenter,
    setAdminDate,
    shiftAdminDate,
    setAdminPeriod,
    setAdminTab,
    setOpsTab,
  };
  // Surface de debug/test du poste d'observation : lecture de l'etat courant et
  // rejeu deterministe du chemin onChange (utile aux harnais, quel que soit le
  // composant de plage monte).
  global.PinlaneDirection = {
    getRange: getDirRange,
    getFocusMetric: getDirFocusMetric,
    getView: getDirView,
    setView: setDirView,
    getInsightKey: dirInsightKey,
    loadInsights: loadDirectionInsights,
    applyRange: onDirRangeChange,
    setFocusMetric: setDirFocusMetric,
    cache: directionInsightCache,
    decisionCache: directionDecisionCache,
    loadDecision: loadDirectionDecision,
    renderDecision: renderDirectionDecision,
  };
  startAdminHealthAutoRefresh();
})(typeof window !== 'undefined' ? window : globalThis);

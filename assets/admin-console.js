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
    simulation: ops.simulation || base.simulation || null,
    lastLoadedAt: ops.lastLoadedAt || base.lastLoadedAt || ''
  };
}

function getAdminStatusLabel(status = '') {
  return {
    pending: 'Confirmé',
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
    Number.isFinite(quality) ? `Qualite ${Math.round(quality)}/100` : '',
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
  const depositsOpen = active.filter(reservation => {
    const guest = getReservationGuestOps(reservation);
    return guest.depositRequired && !guest.depositPaid;
  }).length;
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
  return { withPlan: withPlan.length, fixed, flexible, avgQuality, warningCount, checklistCount, guestTracked, depositsOpen, waiversOpen };
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
        depositsOpen: 0,
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
      if (guest.depositRequired && !guest.depositPaid) profile.depositsOpen += 1;
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
    const action = profile.depositsOpen
      ? 'Sécuriser acompte'
      : profile.waiversOpen
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

function downloadTextFile(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

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

function csvCell(value) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

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
    excelRow(['Logo officiel', FUN_GALAXY_LOGO_URL, 'Source: fungalaxy.be']),
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
    excelRow(['Date', 'Heure', 'Client', 'Téléphone', 'Email', 'Offre', 'Type', 'Joueurs', 'Statut', 'Paiement', 'Montant', 'Ressources', 'Acompte', 'Consignes', 'Check-in', 'Risque', 'Validation'], 'Header'),
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
      guest.depositRequired ? (guest.depositPaid ? `OK (${guest.depositAmount} EUR)` : `A recevoir ${guest.depositAmount} EUR`) : 'Non requis',
      guest.waiverRequired ? (guest.waiverDone ? 'OK' : 'A valider') : 'Non requis',
      guest.checkInDone ? 'OK' : guest.checkInCode,
      reservation.riskLevel || 'normal',
      reservation.validationStatus || '',
    ]);
    })
  ];
  const clientProfiles = buildAdminClientProfiles(reservations);
  const clientRows = [
    excelRow(['Client', 'Téléphone', 'Email', 'Segment', 'Visites', 'Joueurs', 'CA', 'Formules', 'Bowling', 'Laser', 'Acomptes ouverts', 'Consignes ouvertes', 'Action suivante'], 'Header'),
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
      profile.depositsOpen,
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
  const styles = `
    <Styles>
      <Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Center"/><Font ss:FontName="Aptos" ss:Size="10" ss:Color="#222222"/></Style>
      <Style ss:ID="Title"><Font ss:FontName="Aptos Display" ss:Size="18" ss:Bold="1" ss:Color="#111111"/><Interior ss:Color="#F2F2F2" ss:Pattern="Solid"/></Style>
      <Style ss:ID="Subtle"><Font ss:FontName="Aptos" ss:Size="10" ss:Color="#666666"/><Interior ss:Color="#FAFAFA" ss:Pattern="Solid"/></Style>
      <Style ss:ID="Header"><Font ss:FontName="Aptos" ss:Size="10" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#111111" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/></Style>
      <Style ss:ID="Section"><Font ss:FontName="Aptos" ss:Size="11" ss:Bold="1" ss:Color="#111111"/><Interior ss:Color="#E8DFC9" ss:Pattern="Solid"/></Style>
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
    @page { size: A4; margin: 18mm; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #f2f1ee; color: #111; font-family: Arial, Helvetica, sans-serif; }
    .page { width: 210mm; min-height: 297mm; margin: 0 auto; padding: 18mm; background: #fff; border-left: 1px solid #d8d8d2; border-right: 1px solid #d8d8d2; }
    .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 28px; border-bottom: 2px solid #111; padding-bottom: 18px; }
    .logo-box { display: inline-flex; align-items: center; justify-content: center; width: 160px; height: 92px; padding: 14px 18px; background: #111; border: 1.5px solid #111; border-radius: 7px; }
    .logo-box img { display: block; max-width: 100%; max-height: 100%; object-fit: contain; opacity: 1; filter: none; }
    .report-title { margin-top: 16px; }
    .eyebrow { font-size: 10px; font-weight: 900; letter-spacing: .16em; text-transform: uppercase; color: #777; }
    h1 { margin: 6px 0 0; font-size: 30px; letter-spacing: -.04em; line-height: 1; }
    h2 { margin: 0 0 10px; font-size: 15px; letter-spacing: -.02em; }
    .meta { text-align: right; font-size: 11px; line-height: 1.6; color: #555; font-weight: 700; }
    .company { margin-top: 12px; padding: 12px; border: 1px solid #d8d8d2; background: #fbfbfa; font-size: 11px; line-height: 1.55; color: #333; }
    .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 9px; margin: 18px 0; }
    .kpi { border: 1px solid #d8d8d2; padding: 12px; background: #fbfbfa; min-height: 74px; }
    .kpi .k { font-size: 9px; letter-spacing: .12em; text-transform: uppercase; color: #777; font-weight: 900; }
    .kpi .v { margin-top: 7px; font-size: 22px; font-weight: 900; letter-spacing: -.03em; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 14px; }
    .box { border: 1px solid #d8d8d2; padding: 14px; break-inside: avoid; }
    .signal { display: grid; grid-template-columns: 10px 1fr; gap: 9px; padding: 9px 0; border-bottom: 1px solid #eee; }
    .signal:last-child { border-bottom: 0; }
    .dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 4px; background: #111; }
    .signal.high .dot { background: #9b2f29; }
    .signal.good .dot { background: #2d7d4b; }
    .signal strong { display: block; font-size: 12px; }
    .signal span { display: block; font-size: 11px; color: #555; line-height: 1.45; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 10px; }
    th { background: #111; color: #fff; text-align: left; padding: 7px; font-size: 8px; letter-spacing: .08em; text-transform: uppercase; }
    td { border-bottom: 1px solid #e5e5e0; padding: 7px; vertical-align: top; color: #333; line-height: 1.35; }
    td strong { color: #111; }
    .footer { margin-top: 18px; padding-top: 12px; border-top: 1px solid #d8d8d2; font-size: 10px; color: #777; display: flex; justify-content: space-between; gap: 20px; }
    .print { position: fixed; right: 18px; bottom: 18px; padding: 10px 14px; border-radius: 8px; border: 0; background: #111; color: #fff; font-weight: 800; }
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
      Centres suivis: Libramont, Gembloux, Ciney. Site: fungalaxy.be. Siège administratif et informations légales: à compléter dans les paramètres société avant envoi externe.
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
          <tr><td>Acomptes ouverts</td><td><strong>${marketMetrics.depositsOpen}</strong></td></tr>
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
              guest.depositRequired ? (guest.depositPaid ? 'Acompte OK' : `Acompte ${guest.depositAmount} EUR`) : '',
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
    if (guest.depositRequired && !guest.depositPaid && actions.length < 5) {
      actions.push(`Sécuriser acompte ${guest.depositAmount}€ pour ${reservation.name}.`);
    }
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
  const agent = getAdminCockpitAgentSnapshot();
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
            ${renderAdminCockpitMetricBar('Mails', mailHealth, 'mail')}
          </div>
        </div>
        <div class="ops-cockpit-card">
          <span class="label">Staff</span>
          <span class="value">${actions.length} action${actions.length > 1 ? 's' : ''}</span>
          <ul>${actions.map(action => `<li>${escapeHtml(action)}</li>`).join('')}</ul>
        </div>
        <div class="ops-cockpit-card">
          <span class="label">Agent IA</span>
          <div class="ops-cockpit-agent">
            <div class="agent-meta">
              <strong>${agent.hasStack ? `${agent.activeCount} agent(s) actifs` : 'Chargement agent'}</strong>
              <span>${escapeHtml(agent.hasStack ? `${agent.label} · ${agent.dataRead} données lues` : 'Architecture ops en attente d’actualisation')}</span>
            </div>
            <button class="ops-cockpit-run" onclick="runAdminOrchestratorNow()">Relancer</button>
          </div>
        </div>
      </aside>
    </div>
  </section>`;
}

function renderAdminCompetitiveBenchmark(metrics = {}, marketMetrics = {}) {
  const mailTotal = Number(metrics.sentMails || 0) + Number(metrics.queuedMails || 0) + Number(metrics.failedMails || 0);
  const activeStandards = [
    metrics.reservations >= 0,
    Number(metrics.bowlingCapacity || 0) > 0,
    Number(metrics.laserCapacity || 0) > 0,
    Number(marketMetrics.withPlan || 0) >= 0,
    mailTotal >= 0,
    Number(marketMetrics.guestTracked || 0) >= 0,
    true,
  ].filter(Boolean).length;
  const items = [
    {
      title: 'Inventaire temps réel',
      status: 'Actif',
      text: 'Client, staff et direction lisent les mêmes capacités bowling, laser, formules et centres.',
    },
    {
      title: 'Sessions laser partagées',
      status: Number(metrics.laserCapacity || 0) > 0 ? 'Actif' : 'Prêt',
      text: 'Le planning suit les passages, les places restantes et les groupes pouvant partager une session.',
    },
    {
      title: 'Formules multi-ressources',
      status: Number(metrics.formulaCount || 0) ? 'Actif' : 'Prêt',
      text: 'Les formules sont séparées en engagements fixes et avantages flexibles pour absorber les pauses.',
    },
    {
      title: 'Communication contextualisée',
      status: mailTotal ? 'Actif' : 'Prêt',
      text: 'Confirmation, rappels et alertes utilisent le contexte réel de la réservation et du centre.',
    },
    {
      title: 'CRM & engagement client',
      status: 'Actif',
      text: 'Acompte, consignes laser, check-in, upsells et historique client sont suivis par réservation.',
    },
    {
      title: 'Direction & exports BI',
      status: 'Actif',
      text: 'Lecture jour, semaine, mois, année, exports propres et comparaison entre centres.',
    },
    {
      title: 'Caisse, acomptes et consignes',
      status: 'Terrain',
      text: 'Suivi interne opérationnel: acompte, check-in, consignes Laser Game et actions comptoir sans dépendre d’un prestataire externe.',
    },
  ];
  return `<div class="admin-panel admin-benchmark-panel">
    <div class="admin-section-title">
      <div>
        <h2>Maturité marché</h2>
        <p>Lecture inspirée des standards ROLLER, Clubspeed, VenueSumo, RocketRez et QubicaAMF.</p>
      </div>
      <div class="admin-benchmark-score">
        <strong>${activeStandards}/7</strong>
        <span>standards déjà couverts</span>
      </div>
    </div>
    <div class="admin-benchmark-grid">
      ${items.map(item => `<article class="admin-benchmark-card ${escapeHtml(item.status.toLowerCase())}">
        <span class="admin-benchmark-status">${escapeHtml(item.status)}</span>
        <strong>${escapeHtml(item.title)}</strong>
        <p>${escapeHtml(item.text)}</p>
      </article>`).join('')}
    </div>
  </div>`;
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

function renderAdminHeader() {
  const input = document.getElementById('adminDateInput');
  if (input) input.value = state.adminDate;
  renderAdminCenterGrid();
  const center = getAdminCenter();
  const range = getAdminPeriodRange();
  const heroTitle = document.getElementById('adminHeroTitle');
  if (heroTitle) heroTitle.textContent = state.staffMenuPage === 'establishment' ? 'Établissement client' : 'Console CEO';
  const heroSub = document.getElementById('adminHeroSub');
  if (heroSub) {
    heroSub.textContent = state.staffMenuPage === 'establishment'
      ? `Client Fun Galaxy • ${center.name} • configuration, ressources, données opérationnelles et cockpit du centre.`
      : `Client Fun Galaxy • ${center.name} • ${formatAdminPeriodLabel(range)} • pilotage réservations, communications, agents et exports.`;
  }
  ['Day', 'Week', 'Month', 'Year'].forEach(name => {
    const button = document.getElementById(`adminPeriod${name}`);
    if (button) button.classList.toggle('active', state.adminPeriod === name.toLowerCase());
  });
  ['Overview', 'Reservations', 'Clients', 'Ops', 'Exports'].forEach(name => {
    const button = document.getElementById(`adminTab${name}`);
    if (button) button.classList.toggle('active', state.adminTab === name.toLowerCase());
  });
}

function renderAdminPlatformSummary(snapshot = { reservations: [] }, metrics = {}) {
  const centers = getAdminCenters();
  const activeCenters = centers.filter(center => (center.status || 'active') === 'active').length;
  const totalReservations = Number(metrics.reservations || 0);
  const totalMails = Number(metrics.sentMails || 0) + Number(metrics.queuedMails || 0) + Number(metrics.failedMails || 0);
  const agent = getAdminCockpitAgentSnapshot();
  const tenantCount = 1;
  return `<div class="admin-platform-strip" aria-label="Vue propriétaire plateforme">
    <div class="admin-platform-card">
      <div class="k">Clients SaaS</div>
      <div class="v">${tenantCount}</div>
      <div class="s">Fun Galaxy est le client actif de la plateforme Pinlane.</div>
    </div>
    <div class="admin-platform-card">
      <div class="k">Centres gérés</div>
      <div class="v">${activeCenters}/${centers.length}</div>
      <div class="s">Centres actifs et prévus disponibles dans le sélecteur.</div>
    </div>
    <div class="admin-platform-card">
      <div class="k">Volume période</div>
      <div class="v">${totalReservations}</div>
      <div class="s">Réservations réelles chargées sur la période ouverte.</div>
    </div>
    <div class="admin-platform-card">
      <div class="k">Ops connectées</div>
      <div class="v">${agent.activeCount || 0}</div>
      <div class="s">${totalMails} communication(s) et signaux agents disponibles.</div>
    </div>
  </div>`;
}

function renderAdminOverview() {
  const snapshot = adminDashboardCache.snapshot || { reservations: [] };
  const center = getAdminCenter();
  const metrics = buildAdminMetrics(snapshot.reservations || [], center);
  const marketMetrics = buildAdminMarketMetrics(snapshot.reservations || []);
  const insights = buildAdminInsights(metrics, center);
  return `
    <div class="admin-client-context">Pinlane Platform · Client actif: Fun Galaxy</div>
    ${renderAdminPlatformSummary(snapshot, metrics)}
    <div class="admin-panel">
      <div class="admin-section-title">
        <div>
          <h2>Synthèse exécutive</h2>
          <p>${escapeHtml(metrics.openLabel)} • ${escapeHtml(center.name)} • actualisé ${escapeHtml(formatOpsTimestamp(adminDashboardCache.lastLoadedAt))}</p>
        </div>
      </div>
      <div class="admin-kpi-grid">
        <div class="admin-kpi"><div class="k">Réservations</div><div class="v">${metrics.reservations}</div><div class="s">${metrics.pendingCount} à venir · ${metrics.arrivedCount} sur place</div></div>
        <div class="admin-kpi"><div class="k">Joueurs</div><div class="v">${metrics.players}</div><div class="s">${metrics.formulaCount} formule(s)</div></div>
        <div class="admin-kpi"><div class="k">Chiffre jour</div><div class="v">${formatMoney(metrics.revenue)}</div><div class="s">${formatMoney(metrics.collected)} encaissé</div></div>
        <div class="admin-kpi"><div class="k">Ticket moyen</div><div class="v">${formatMoney(metrics.avgTicket)}</div><div class="s">sur réservations actives</div></div>
        <div class="admin-kpi"><div class="k">Bowling</div><div class="v">${formatAdminPercent(metrics.bowlingOccupancy)}</div><div class="s">${Math.round(metrics.laneHours)}h piste / ${Math.round(metrics.bowlingCapacity)}h capacité</div></div>
        <div class="admin-kpi"><div class="k">Laser</div><div class="v">${formatAdminPercent(metrics.laserOccupancy)}</div><div class="s">${metrics.laserLaunches} lancement(s) · ${metrics.laserPlayers} passages</div></div>
      </div>
    </div>
    ${renderAdminCockpit(metrics, center, snapshot.reservations || [], marketMetrics)}
    ${renderAdminCompetitiveBenchmark(metrics, marketMetrics)}
    <div class="admin-dashboard-grid">
      <div class="admin-panel">
        <div class="admin-section-title">
          <div>
            <h2>Ressources critiques</h2>
            <p>Capacité bowling, laser, formules et communications à surveiller.</p>
          </div>
        </div>
        <div class="admin-resource-grid">
          <div class="admin-resource-card"><div class="k">Bowling classique</div><div class="v">${metrics.directBowling} direct(s)</div><div class="s">${metrics.bowlingWindows} bloc(s) piste, formules incluses.</div></div>
          <div class="admin-resource-card"><div class="k">Laser Game</div><div class="v">${metrics.directLaser} direct(s)</div><div class="s">${metrics.laserLaunches} bloc(s), capacité ${center.resources?.laser?.weaponCount || 0} armes.</div></div>
          <div class="admin-resource-card"><div class="k">Formules</div><div class="v">${metrics.formulaCount}</div><div class="s">Réservations combinant plusieurs activités ou contraintes.</div></div>
          <div class="admin-resource-card"><div class="k">Mails</div><div class="v">${metrics.sentMails}/${metrics.queuedMails + metrics.sentMails + metrics.failedMails}</div><div class="s">${metrics.queuedMails} en file · ${metrics.failedMails} à corriger.</div></div>
        </div>
      </div>
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
    </div>
    <div class="admin-panel">
      <div class="admin-section-title">
        <div>
          <h2>Engagements opérationnels</h2>
          <p>Ce que le moteur a verrouillé: ressources fixes, marges libres et points de vigilance.</p>
        </div>
      </div>
      <div class="admin-market-grid">
        <div class="admin-market-card"><div class="k">Plans enrichis</div><div class="v">${marketMetrics.withPlan}</div><div class="s">Réservations avec engagements détaillés.</div></div>
        <div class="admin-market-card"><div class="k">Engagements fixes</div><div class="v">${marketMetrics.fixed}</div><div class="s">Bowling, Laser ou tables réellement bloqués.</div></div>
        <div class="admin-market-card"><div class="k">Activités libres</div><div class="v">${marketMetrics.flexible}</div><div class="s">Éléments utilisables comme marge terrain.</div></div>
        <div class="admin-market-card"><div class="k">Suivi client</div><div class="v">${marketMetrics.guestTracked}</div><div class="s">${marketMetrics.depositsOpen} acompte(s) · ${marketMetrics.waiversOpen} consigne(s) à terminer.</div></div>
        <div class="admin-market-card"><div class="k">Qualité moyenne</div><div class="v">${marketMetrics.avgQuality === null ? '--' : `${marketMetrics.avgQuality}/100`}</div><div class="s">${marketMetrics.warningCount} alerte(s) · ${marketMetrics.checklistCount} point(s) staff.</div></div>
      </div>
    </div>
    ${renderAdminReservationsTable((snapshot.reservations || []).slice(0, 10), 'Réservations clés', 'Les premières lignes exploitables pour la direction.')}
  `;
}

function renderAdminReservationsTable(reservations = [], title = 'Réservations du jour', subtitle = 'Toutes les lignes exploitables par la direction.') {
  const rows = reservations.filter(reservation => reservation.status !== 'cancelled');
  return `<div class="admin-panel">
    <div class="admin-section-title">
      <div>
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(subtitle)}</p>
      </div>
      <button class="admin-btn" onclick="exportAdminExcel()">Télécharger Excel</button>
    </div>
    ${rows.length ? `<div class="admin-table-wrap"><table class="admin-table">
      <thead><tr><th>Heure</th><th>Client</th><th>Offre</th><th>Ressources</th><th>Engagement</th><th>Statut</th><th>Montant</th><th>Risque</th></tr></thead>
      <tbody>
        ${rows.map(reservation => {
          const isFormula = reservation.type === 'formule' || reservation.formuleId;
          const isLaser = reservation.type === 'laser';
          return `<tr>
            <td><strong>${escapeHtml(reservation.startTime || '--:--')}</strong><br>${escapeHtml(formatDurationLabel(reservation.totalDuration || reservation.duration || 0))}</td>
            <td><strong>${escapeHtml(reservation.name || 'Client')}</strong><br>${escapeHtml(reservation.phone || '')}</td>
            <td><span class="admin-pill ${isFormula ? 'formule' : isLaser ? 'laser' : ''}">${escapeHtml(getReservationLabel(reservation))}</span><br>${Number(reservation.pax || 0)} joueur(s)</td>
            <td>${getAdminResourceHtml(reservation)}</td>
            <td>${renderAdminGuestOpsCell(reservation)}</td>
            <td><span class="admin-pill ${escapeHtml(reservation.status || 'pending')}">${escapeHtml(getAdminStatusLabel(reservation.status))}</span></td>
            <td><strong>${formatMoney(reservation.price)}</strong><br>${escapeHtml(reservation.paymentMethod || 'Sur place')}</td>
            <td>${escapeHtml(reservation.riskLevel || reservation.validationStatus || 'normal')}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table></div>` : `<div class="empty-state"><div class="e-title">Aucune réservation sur cette date</div><div class="e-sub">Le centre reste consultable, mais aucune donnée opérationnelle n’est enregistrée pour ce jour.</div></div>`}
  </div>`;
}

function renderAdminClients() {
  const snapshot = adminDashboardCache.snapshot || { reservations: [] };
  const reservations = snapshot.reservations || [];
  const profiles = buildAdminClientProfiles(reservations);
  const totalRevenue = profiles.reduce((sum, profile) => sum + Number(profile.revenue || 0), 0);
  const vipCount = profiles.filter(profile => profile.segment === 'VIP').length;
  const groupCount = profiles.filter(profile => profile.segment === 'Groupe').length;
  const openActions = profiles.filter(profile => profile.depositsOpen || profile.waiversOpen).length;
  const featureCards = [
    ['CRM opérationnel', 'Historique par téléphone/email, segment automatique et action suivante.'],
    ['Acompte terrain', 'Suivi manuel fiable pour groupes, formules et réservations à risque.'],
    ['Consignes Laser', 'Les groupes laser ressortent avant lancement pour éviter l’oubli comptoir.'],
    ['Upsells staff', 'Ajout rapide de cruches, jetons et tapas depuis la fiche réservation.'],
    ['Check-in code', 'Référence courte par réservation pour accélérer l’arrivée client.'],
    ['Exports enrichis', 'Les statuts client partent aussi dans Excel, rapport et archive JSON.'],
  ];
  return `<div class="admin-panel">
    <div class="admin-section-title">
      <div>
        <h2>Clientèle & engagement</h2>
        <p>CRM léger, suivi acompte, consignes laser, check-in et prochaines actions commerciales.</p>
      </div>
      <button class="admin-btn" onclick="exportAdminExcel()">Exporter CRM</button>
    </div>
    <div class="admin-client-grid">
      <div class="admin-client-kpi"><div class="k">Clients uniques</div><div class="v">${profiles.length}</div><div class="s">sur la période sélectionnée</div></div>
      <div class="admin-client-kpi"><div class="k">Valeur suivie</div><div class="v">${formatMoney(totalRevenue)}</div><div class="s">CA rattaché aux profils</div></div>
      <div class="admin-client-kpi"><div class="k">Profils forts</div><div class="v">${vipCount + groupCount}</div><div class="s">${vipCount} VIP · ${groupCount} groupes</div></div>
      <div class="admin-client-kpi"><div class="k">Actions ouvertes</div><div class="v">${openActions}</div><div class="s">acompte ou consignes à terminer</div></div>
    </div>
    <div class="admin-feature-grid">
      ${featureCards.map(([title, text]) => `<div class="admin-feature-card"><div class="k">Standard marché</div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(text)}</p></div>`).join('')}
    </div>
    ${profiles.length ? `<div class="admin-table-wrap"><table class="admin-table">
      <thead><tr><th>Client</th><th>Segment</th><th>Historique</th><th>Valeur</th><th>Engagement</th><th>Action suivante</th></tr></thead>
      <tbody>
        ${profiles.slice(0, 80).map(profile => `<tr>
          <td><strong>${escapeHtml(profile.name)}</strong><br>${escapeHtml(profile.phone || profile.email || 'Contact incomplet')}</td>
          <td><span class="admin-pill">${escapeHtml(profile.segment)}</span></td>
          <td>${profile.visits} visite(s)<br>${profile.players} joueur(s) · ${profile.formulas} formule(s)</td>
          <td><strong>${formatMoney(profile.revenue)}</strong><br>Dernière: ${escapeHtml(profile.lastDate || '--')}</td>
          <td><div class="engagement-cell">
            <span class="guest-chip ${profile.depositsOpen ? 'warn' : 'ok'}">${profile.depositsOpen ? `${profile.depositsOpen} acompte` : 'Acompte OK'}</span>
            <span class="guest-chip ${profile.waiversOpen ? 'warn' : 'ok'}">${profile.waiversOpen ? `${profile.waiversOpen} consigne` : 'Consignes OK'}</span>
          </div></td>
          <td>${escapeHtml(profile.action)}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>` : `<div class="empty-state"><div class="e-title">Aucun profil client</div><div class="e-sub">Les profils apparaissent dès que la période contient des réservations.</div></div>`}
  </div>`;
}

function renderAdminOpsPanel() {
  return `<div class="admin-panel">
    <div class="ops-admin-head">
      <div>
        <div class="ops-eyebrow">Messages, agents et suivi</div>
        <h2>Communication opérationnelle</h2>
        <p>File des mails, modèles, suggestions agents et journal terrain pour le centre sélectionné.</p>
      </div>
      <div class="ops-admin-actions">
        <button class="ops-admin-btn" onclick="loadAdminDashboard(true)">Actualiser</button>
        <button class="ops-admin-btn primary" onclick="dispatchOpsEmails()">Envoyer la file</button>
      </div>
    </div>
    <div class="ops-admin-tabs">
      <button class="ops-tab" id="opsTabCommunications" onclick="setOpsTab('communications')">Mails</button>
      <button class="ops-tab" id="opsTabSamples" onclick="setOpsTab('samples')">Modèles</button>
      <button class="ops-tab" id="opsTabSuggestions" onclick="setOpsTab('suggestions')">Agents</button>
      <button class="ops-tab" id="opsTabStack" onclick="setOpsTab('stack')">Stack IA</button>
      <button class="ops-tab" id="opsTabEvents" onclick="setOpsTab('events')">Journal</button>
      <button class="ops-tab" id="opsTabSimulation" onclick="setOpsTab('simulation')">Simulation rush</button>
    </div>
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
        <button class="admin-btn primary" onclick="exportAdminExcel()">Télécharger</button>
      </div>
      <div class="admin-export-card">
        <div><h3>Rapport direction blanc</h3><p>Document HTML professionnel avec logo, KPIs, signaux et aperçu des réservations. Imprimable en PDF.</p></div>
        <button class="admin-btn primary" onclick="exportAdminReport()">Télécharger</button>
      </div>
      <div class="admin-export-card">
        <div><h3>Archive JSON complète</h3><p>Snapshot technique complet: métriques, réservations, mails, agents, événements et connaissance centre.</p></div>
        <button class="admin-btn" onclick="exportAdminJson()">Télécharger</button>
      </div>
      <div class="admin-export-card">
        <div><h3>Résumé du jour</h3><p>${metrics.reservations} réservation(s), ${metrics.players} joueurs, ${formatMoney(metrics.revenue)} prévu, ${metrics.failedMails} mail(s) en échec.</p></div>
        <button class="admin-btn" onclick="navigator.clipboard?.writeText(JSON.stringify(getAdminExportPayload().metrics, null, 2)); toast('Résumé copié.')">Copier le résumé</button>
      </div>
    </div>
  </div>`;
}

function renderAdminDashboard() {
  renderAdminHeader();
  const content = document.getElementById('adminContent');
  if (!content) return;
  const cacheIsCurrent = isAdminDashboardCacheCurrent();
  if (adminDashboardCache.loading && (!adminDashboardCache.loaded || !cacheIsCurrent)) {
    content.innerHTML = `<div class="admin-panel"><div class="empty-state"><div class="e-title">Chargement direction</div><div class="e-sub">Récupération du centre, des réservations, des mails et des signaux agents.</div></div></div>`;
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
  if (state.adminTab === 'clients') {
    content.innerHTML = renderAdminClients();
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
    const [communicationsPayload, samplesPayload, suggestionsPayload, eventsPayload, agentStackPayload, simulationPayload] = await Promise.all([
      apiRequest(`${API_ENDPOINTS.ops}?action=communications&centerId=${centerQuery}&limit=180`),
      apiRequest(`${API_ENDPOINTS.ops}?action=emailSamples`),
      apiRequest(`${API_ENDPOINTS.ops}?action=suggestions&centerId=${centerQuery}&limit=120`),
      apiRequest(`${API_ENDPOINTS.ops}?action=events&centerId=${centerQuery}&limit=160`),
      apiRequest(`${API_ENDPOINTS.ops}?action=agentStack&centerId=${centerQuery}&startDate=${startDate}&endDate=${endDate}`),
      apiRequest(`${API_ENDPOINTS.simulation}?action=status&centerId=${centerQuery}&date=${simDate}`)
    ]);
    const ops = {
      communications: communicationsPayload.communications || [],
      samples: samplesPayload.samples || [],
      suggestions: suggestionsPayload.suggestions || [],
      events: eventsPayload.events || [],
      agentStack: agentStackPayload || null,
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
}

function setOpsTab(tab) {
  state.opsPanelTab = tab || 'communications';
  save();
  renderOpsAdmin();
  if (state.opsPanelTab === 'simulation') loadOpsSimulationStatus();
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
    downloadTextFile,
    downloadBlob,
    csvCell,
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
    renderAdminCompetitiveBenchmark,
    runAdminOrchestratorNow,
    renderAdminCenterGrid,
    renderAdminHeader,
    renderAdminPlatformSummary,
    renderAdminOverview,
    renderAdminReservationsTable,
    renderAdminClients,
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
})(typeof window !== 'undefined' ? window : globalThis);

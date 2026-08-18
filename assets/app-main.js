// Booking domain constants and planning helpers live in ./assets/booking-core.js.
let laserDragActive = false;
let laserDragScrollRaf = null;
let laserDragLastY = 0;
let laserPointerDrag = null;
let laserDragDropTarget = null;
let laserUnplaceDropTarget = null;
let laserDragSuppressClickUntil = 0;
let bowlingPointerDrag = null;
let bowlingDragDropTarget = null;
let bowlingDragPreviewEls = [];
let bowlingDragSuppressClickUntil = 0;
let bowlingDragSaveSeq = 0;
const bowlingDragLatestSeqByReservation = {};
let statusSaveSeq = 0;
const statusSaveLatestSeqByReservation = {};
let activitySaveSeq = 0;
const activitySaveLatestSeqByReservation = {};
const pendingReservationWriteIds = new Set();
let planningMoveNoticeTimer = null;

function showPlanningMoveNotice(title, message = '', tone = 'warning') {
  if (typeof document === 'undefined') return;
  let notice = document.getElementById('planningMoveNotice');
  if (!notice) {
    notice = document.createElement('div');
    notice.id = 'planningMoveNotice';
    notice.setAttribute('role', 'status');
    notice.setAttribute('aria-live', 'polite');
    document.body.appendChild(notice);
  }

  notice.className = `planning-move-notice ${tone || 'warning'}`;
  notice.innerHTML = `
    <span class="planning-move-notice-dot" aria-hidden="true"></span>
    <span class="planning-move-notice-copy">
      <strong>${escapeHtml(title || 'Planning')}</strong>
      ${message ? `<small>${escapeHtml(message)}</small>` : ''}
    </span>
  `;
  notice.classList.remove('is-visible');
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => notice.classList.add('is-visible'));
  } else {
    notice.classList.add('is-visible');
  }
  clearTimeout(planningMoveNoticeTimer);
  planningMoveNoticeTimer = setTimeout(() => {
    notice.classList.remove('is-visible');
  }, tone === 'success' ? 1900 : 3600);
}

window.showPlanningMoveNotice = showPlanningMoveNotice;

function getReservationWriteKey(id) {
  return String(Number(id));
}

// Registre des mutations optimistes en attente : id -> { fields, expected,
// signatures, deadline }. Il protège UNIQUEMENT les champs modifiés localement
// (statut, ou géométrie drag-drop lanes/startTime/opsPlan) contre l'écrasement
// par un snapshot serveur en retard (cohérence éventuelle de /api/staff-state).
// La protection tombe dès que le serveur reflète la valeur attendue, ou après un
// délai de grâce (garde-fou anti-blocage si le serveur diverge réellement).
const PENDING_MUTATION_GRACE_MS = 9000;
const pendingReservationMutations = new Map();
// Mutations réellement en vol (requête PATCH non résolue) : id -> Map<field, sig>.
// Sert à éviter le double-envoi pour un même couple (réservation, champ).
const reservationInFlightMutations = new Map();

function reservationFieldSignature(reservation, field) {
  if (!reservation) return undefined;
  switch (field) {
    case 'status':
      return String(reservation.status || '');
    case 'paymentMethod':
      return String(reservation.paymentMethod || '');
    case 'startTime':
      return String(reservation.startTime || '');
    case 'lanes':
      return (reservation.lanes || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b).join(',');
    case 'opsPlan':
      return JSON.stringify((reservation.opsPlan?.resourceBlocks || []).map(block => [
        block.resourceType,
        block.startTime,
        block.endTime,
        (block.lanes || []).map(Number),
        block.players
      ]));
    default:
      return JSON.stringify(reservation[field] ?? null);
  }
}

function cloneReservationField(reservation, field) {
  const value = reservation ? reservation[field] : undefined;
  if (Array.isArray(value)) return value.slice();
  return value;
}

function markReservationMutation(id, reservation, fields) {
  const key = getReservationWriteKey(id);
  const expected = {};
  const signatures = {};
  fields.forEach(field => {
    expected[field] = cloneReservationField(reservation, field);
    signatures[field] = reservationFieldSignature(reservation, field);
  });
  pendingReservationMutations.set(key, {
    fields: fields.slice(),
    expected,
    signatures,
    deadline: Date.now() + PENDING_MUTATION_GRACE_MS
  });
  pendingReservationWriteIds.add(key);
}

function clearReservationMutation(id) {
  const key = getReservationWriteKey(id);
  pendingReservationMutations.delete(key);
  pendingReservationWriteIds.delete(key);
}

function reservationMatchesMutation(reservation, entry) {
  return entry.fields.every(field => reservationFieldSignature(reservation, field) === entry.signatures[field]);
}

function applyExpectedMutationFields(serverReservation, entry) {
  const merged = { ...serverReservation };
  entry.fields.forEach(field => {
    merged[field] = Array.isArray(entry.expected[field]) ? entry.expected[field].slice() : entry.expected[field];
  });
  return merged;
}

function isReservationMutationInFlight(id, field, signature) {
  const fields = reservationInFlightMutations.get(getReservationWriteKey(id));
  return !!fields && fields.get(field) === signature;
}

function setReservationMutationInFlight(id, field, signature) {
  const key = getReservationWriteKey(id);
  let fields = reservationInFlightMutations.get(key);
  if (!fields) {
    fields = new Map();
    reservationInFlightMutations.set(key, fields);
  }
  fields.set(field, signature);
}

function clearReservationMutationInFlight(id, field) {
  const key = getReservationWriteKey(id);
  const fields = reservationInFlightMutations.get(key);
  if (!fields) return;
  fields.delete(field);
  if (!fields.size) reservationInFlightMutations.delete(key);
}

// Compat : anciennes API basées sur un simple Set d'ids. Le registre riche
// ci-dessus reste la source de vérité pour la fusion de snapshot.
function markReservationWritePending(id) {
  pendingReservationWriteIds.add(getReservationWriteKey(id));
}

function clearReservationWritePending(id) {
  clearReservationMutation(id);
}

function isReservationWritePending(id) {
  return pendingReservationWriteIds.has(getReservationWriteKey(id));
}

function scrollLaserDragBy(deltaY) {
  const activeWrap = bowlingPointerDrag
    ? document.getElementById('planningGridWrap')
    : laserPointerDrag
      ? document.getElementById('laserPlanningGridWrap')
      : null;
  // L'auto-scroll de bord ne pilote QUE la grille quand elle défile en interne
  // (mode plein écran comptoir : le wrap a une hauteur bornée + overflow:auto).
  // En mode normal, le défilement vertical du planning EST celui de la PAGE :
  // y retomber (ancien comportement) happait toute la page vers le haut dès que
  // le curseur passait dans la zone de bord pendant un glisser : « ça me remet
  // tout en haut ». On ne touche donc jamais au scroll de page pendant le drag :
  // la vue reste là où Movsar l'a laissée. (Cf. journal 2026-07-12.)
  if (activeWrap && activeWrap.scrollHeight > activeWrap.clientHeight) {
    activeWrap.scrollTop += deltaY;
  }
}

function stopLaserDragAutoScroll() {
  if (laserDragScrollRaf) cancelAnimationFrame(laserDragScrollRaf);
  laserDragScrollRaf = null;
}

function runLaserDragAutoScroll() {
  if (!laserDragActive) {
    stopLaserDragAutoScroll();
    return;
  }
  const edge = 96;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  let delta = 0;
  if (laserDragLastY > 0 && laserDragLastY < edge) {
    delta = -Math.ceil(((edge - laserDragLastY) / edge) * 24);
  } else if (viewportHeight && laserDragLastY > viewportHeight - edge) {
    delta = Math.ceil(((laserDragLastY - (viewportHeight - edge)) / edge) * 24);
  }
  if (delta) scrollLaserDragBy(delta);
  laserDragScrollRaf = requestAnimationFrame(runLaserDragAutoScroll);
}

function startLaserDragAutoScroll(clientY) {
  laserDragLastY = clientY || laserDragLastY;
  if (!laserDragScrollRaf) laserDragScrollRaf = requestAnimationFrame(runLaserDragAutoScroll);
}

function getLaserDropTargetFromPoint(clientX, clientY) {
  const element = document.elementFromPoint(clientX, clientY);
  return element?.closest?.('.laser-session-slot[data-laser-drop-start]') || null;
}

// La colonne « Parties à placer » devient une cible de dépôt : glisser une carte
// déjà placée dessus dé-planifie la partie (elle repart dans la file « à placer »).
function getLaserUnplaceDropFromPoint(clientX, clientY) {
  const element = document.elementFromPoint(clientX, clientY);
  return element?.closest?.('.laser-pass-queue') || null;
}

function setLaserDragDropTarget(target) {
  if (laserDragDropTarget && laserDragDropTarget !== target) {
    laserDragDropTarget.classList.remove('is-drop-target');
  }
  laserDragDropTarget = target;
  if (laserDragDropTarget) laserDragDropTarget.classList.add('is-drop-target');
}

function clearLaserDragDropTarget() {
  if (laserDragDropTarget) laserDragDropTarget.classList.remove('is-drop-target');
  laserDragDropTarget = null;
}

function setLaserUnplaceDropTarget(target) {
  if (laserUnplaceDropTarget && laserUnplaceDropTarget !== target) {
    laserUnplaceDropTarget.classList.remove('is-unplace-target');
  }
  laserUnplaceDropTarget = target;
  if (laserUnplaceDropTarget) laserUnplaceDropTarget.classList.add('is-unplace-target');
}

function clearLaserUnplaceDropTarget() {
  if (laserUnplaceDropTarget) laserUnplaceDropTarget.classList.remove('is-unplace-target');
  laserUnplaceDropTarget = null;
}

function onLaserDocumentDragOver(event) {
  if (!laserDragActive) return;
  startLaserDragAutoScroll(event.clientY);
}

function onLaserDragWheel(event) {
  if (!laserDragActive) return;
  event.preventDefault();
  scrollLaserDragBy(event.deltaY);
}

function createLaserDragGhost(sourceEl, event) {
  const rect = sourceEl.getBoundingClientRect();
  const ghost = sourceEl.cloneNode(true);
  ghost.classList.add('laser-drag-ghost');
  ghost.style.width = `${rect.width}px`;
  ghost.style.left = '0px';
  ghost.style.top = '0px';
  ghost.style.transform = `translate3d(${event.clientX + 14}px, ${event.clientY + 14}px, 0)`;
  document.body.appendChild(ghost);
  return ghost;
}

function updateLaserPointerGhost(event) {
  if (!laserPointerDrag?.ghost) return;
  laserPointerDrag.ghost.style.transform = `translate3d(${event.clientX + 14}px, ${event.clientY + 14}px, 0)`;
}

function startLaserPointerDragMode(event) {
  if (!laserPointerDrag || laserPointerDrag.dragging) return;
  laserPointerDrag.dragging = true;
  laserPointerDrag.sourceEl.classList.add('is-dragging');
  laserPointerDrag.ghost = createLaserDragGhost(laserPointerDrag.sourceEl, event);
  laserDragActive = true;
  laserDragLastY = event.clientY || 0;
  document.body.classList.add('laser-dragging');
  document.addEventListener('wheel', onLaserDragWheel, { passive: false });
  startLaserDragAutoScroll(laserDragLastY);
}

function onLaserPointerMove(event) {
  if (!laserPointerDrag) return;
  const distance = Math.hypot(event.clientX - laserPointerDrag.startX, event.clientY - laserPointerDrag.startY);
  if (!laserPointerDrag.dragging && distance >= 5) startLaserPointerDragMode(event);
  if (!laserPointerDrag.dragging) return;
  event.preventDefault();
  event.stopPropagation();
  laserPointerDrag.lastX = event.clientX;
  laserPointerDrag.lastY = event.clientY;
  updateLaserPointerGhost(event);
  startLaserDragAutoScroll(event.clientY);
  const slotTarget = getLaserDropTargetFromPoint(event.clientX, event.clientY);
  setLaserDragDropTarget(slotTarget);
  // Sinon, survole-t-on la file « Parties à placer » ? (dépôt = dé-planifier)
  setLaserUnplaceDropTarget(slotTarget ? null : getLaserUnplaceDropFromPoint(event.clientX, event.clientY));
}

function onLaserPointerUp(event) {
  if (!laserPointerDrag) return;
  const drag = laserPointerDrag;
  const wasDragging = drag.dragging;
  laserPointerDrag = null;
  document.removeEventListener('mousemove', onLaserPointerMove, true);
  document.removeEventListener('mouseup', onLaserPointerUp, true);
  if (!wasDragging) return;
  event.preventDefault();
  event.stopPropagation();
  laserDragSuppressClickUntil = Date.now() + 350;
  laserDragActive = false;
  stopLaserDragAutoScroll();
  document.body.classList.remove('laser-dragging');
  document.removeEventListener('wheel', onLaserDragWheel);
  drag.sourceEl.classList.remove('is-dragging');
  if (drag.ghost) drag.ghost.remove();
  const unplaceZone = getLaserUnplaceDropFromPoint(event.clientX, event.clientY);
  const target = getLaserDropTargetFromPoint(event.clientX, event.clientY) || laserDragDropTarget;
  clearLaserDragDropTarget();
  clearLaserUnplaceDropTarget();
  // Dépôt sur la file « Parties à placer » → on retire la partie du planning.
  if (unplaceZone) {
    unscheduleLaserPass(drag.reservationId, drag.unitKey);
    return;
  }
  if (!target) {
    showPlanningMoveNotice('Aucun lancement choisi', 'Déposez la carte sur une ligne Laser Game disponible, ou sur « Parties à placer » pour la retirer du planning.', 'warning');
    return;
  }
  const targetStart = Number(target.dataset.laserDropStart);
  const targetEnd = target.dataset.laserDropEnd ? Number(target.dataset.laserDropEnd) : null;
  scheduleLaserPass(drag.reservationId, drag.unitKey, targetStart, targetEnd);
}

function startLaserPassPointerDrag(event, reservationId, unitKey) {
  if (event.button !== 0) return;
  event.stopPropagation();
  laserPointerDrag = {
    reservationId,
    unitKey,
    sourceEl: event.currentTarget,
    startX: event.clientX,
    startY: event.clientY,
    lastX: event.clientX,
    lastY: event.clientY,
    dragging: false,
    ghost: null
  };
  document.addEventListener('mousemove', onLaserPointerMove, true);
  document.addEventListener('mouseup', onLaserPointerUp, true);
}

function shouldIgnoreLaserPassClick(event) {
  if (Date.now() > laserDragSuppressClickUntil) return false;
  event.preventDefault();
  event.stopPropagation();
  return true;
}

function getBowlingBlockMinutes(block, key) {
  const raw = Number(block?.[key]);
  if (Number.isFinite(raw)) return raw;
  const timeKey = key === 'start' ? 'startTime' : 'endTime';
  return hourToMinuteInt(timeToNum(block?.[timeKey] || '00:00'));
}

function getBowlingDropTargetFromPoint(clientX, clientY) {
  const laneCols = [...document.querySelectorAll('#planningGridWrap .lane-col')];
  for (const laneCol of laneCols) {
    const laneRect = laneCol.getBoundingClientRect();
    if (clientX < laneRect.left || clientX > laneRect.right) continue;
    const cells = [...laneCol.querySelectorAll('.slot-cell.clickable[data-bowling-drop-lane]')];
    const cell = cells.find(item => {
      const rect = item.getBoundingClientRect();
      return clientY >= rect.top && clientY <= rect.bottom;
    });
    if (cell) return cell;
  }
  return null;
}

function setBowlingDragDropTarget(target) {
  if (bowlingDragDropTarget && bowlingDragDropTarget !== target) {
    bowlingDragDropTarget.classList.remove('is-drop-target');
    bowlingDragDropTarget.classList.remove('invalid');
  }
  bowlingDragDropTarget = target;
  if (bowlingDragDropTarget) bowlingDragDropTarget.classList.add('is-drop-target');
  renderBowlingDragPreview(target);
}

function clearBowlingDragDropTarget() {
  if (bowlingDragDropTarget) {
    bowlingDragDropTarget.classList.remove('is-drop-target');
    bowlingDragDropTarget.classList.remove('invalid');
  }
  bowlingDragDropTarget = null;
  clearBowlingDragPreview();
}

function clearBowlingDragPreview() {
  bowlingDragPreviewEls.forEach(el => el.remove());
  bowlingDragPreviewEls = [];
}

function getBowlingDragSourceWindow(reservation, sourceLaneValue, sourceStartValue) {
  const sourceLane = Number(sourceLaneValue);
  const sourceStart = Number(sourceStartValue);
  const windows = getBowlingWindowsFromReservation(reservation);
  return windows.find(window =>
    window.lanes.includes(sourceLane) &&
    (!Number.isFinite(sourceStart) || Math.abs(Number(window.start) - sourceStart) < 0.01)
  ) || windows.find(window => window.lanes.includes(sourceLane)) || windows[0] || null;
}

function getBowlingDragTargetPlan(target) {
  if (!target || !bowlingPointerDrag) return null;
  const reservation = state.reservations.find(item => Number(item.id) === Number(bowlingPointerDrag.reservationId));
  if (!reservation) return null;
  const targetLane = Number(target.dataset.bowlingDropLane);
  const targetStart = Number(target.dataset.bowlingDropStart);
  const duration = getBowlingDurationForReservation(reservation) || Number(reservation.duration || 1);
  const startTime = numToTime(targetStart);
  const requiredCount = Math.max(1, getRequiredLaneCount(reservation.type, reservation.pax, reservation.formuleId));
  const sourceWindow = getBowlingDragSourceWindow(reservation, bowlingPointerDrag.sourceLane, bowlingPointerDrag.sourceStart);
  const currentLanes = sourceWindow?.lanes?.length ? sourceWindow.lanes : (reservation.lanes || []);
  const slotCheck = validateSlotWindow(reservation.date, startTime, duration, { allowPastStart: true });
  if (!slotCheck.ok) {
    return { reservation, targetLane, targetStart, duration, lanes: [targetLane], valid: false, message: slotCheck.message };
  }
  const lanes = getTargetBowlingLanes(
    requiredCount,
    targetLane,
    reservation.date,
    startTime,
    duration,
    reservation.id,
    currentLanes,
    bowlingPointerDrag.sourceLane,
    Boolean(bowlingPointerDrag.splitLane)
  );
  if (!lanes || lanes.length < requiredCount) {
    return { reservation, targetLane, targetStart, duration, lanes: [targetLane], valid: false, message: `${requiredCount} piste${requiredCount > 1 ? 's' : ''} indisponible${requiredCount > 1 ? 's' : ''}` };
  }
  const movedOpsPlan = moveBowlingOpsPlan(reservation, targetStart, lanes, duration);
  const conflicts = lanesConflict(reservation.date, startTime, duration, lanes, reservation.id, movedOpsPlan);
  return {
    reservation,
    targetLane,
    targetStart,
    duration,
    lanes,
    valid: conflicts.length === 0,
    message: conflicts.length ? 'Conflit avec une réservation' : `Pistes ${lanes.join(', ')}`
  };
}

function renderBowlingDragPreview(target) {
  clearBowlingDragPreview();
  if (!target) return;
  const plan = getBowlingDragTargetPlan(target);
  if (!plan) return;
  target.classList.toggle('invalid', !plan.valid);
  const config = getPlanningWindow(plan.reservation.date);
  if (!config || config.closed) return;
  const planningBox = document.getElementById('planningBox');
  const computed = planningBox ? getComputedStyle(planningBox) : null;
  const hourHeight = parseFloat(computed?.getPropertyValue('--planning-hour-h')) || 48;
  const headerHeight = parseFloat(computed?.getPropertyValue('--planning-header-h')) || 38;
  const top = (plan.targetStart - config.open) * hourHeight + headerHeight + 3;
  const height = Math.max(28, (Number(plan.duration) * hourHeight) - 6);
  const previewLanes = plan.lanes?.length ? plan.lanes : [plan.targetLane];
  previewLanes.forEach(lane => {
    const laneCol = document.querySelector(`#planningGridWrap .lane-col[data-lane="${Number(lane)}"]`);
    if (!laneCol) return;
    const preview = document.createElement('div');
    preview.className = `bowling-drop-preview${plan.valid ? '' : ' invalid'}`;
    preview.style.top = `${top}px`;
    preview.style.height = `${height}px`;
    preview.innerHTML = `
      <strong>${formatClockDisplay(plan.targetStart)}</strong>
      <span>${escapeHtml(plan.valid ? `Piste ${lane}` : plan.message)}</span>
    `;
    laneCol.appendChild(preview);
    bowlingDragPreviewEls.push(preview);
  });
}

function getTargetBowlingLanes(requiredCount, targetLane, date, startTime, duration, ignoreId, currentLanes = [], sourceLane = null, splitLane = false) {
  const occupied = getOccupiedLanes(date, startTime, duration, ignoreId);
  const isAvailable = lane => lane >= 1 && lane <= TOTAL_LANES && state.laneStatuses[lane] !== 'maintenance' && !occupied.has(lane);
  const target = Number(targetLane);
  const count = Math.max(1, Number(requiredCount || 1));
  if (count === 1) return isAvailable(target) ? [target] : null;

  const current = [...new Set((currentLanes || []).map(Number).filter(lane => lane >= 1 && lane <= TOTAL_LANES))].sort((a, b) => a - b);
  const source = Number(sourceLane);
  if (current.length >= count && Number.isFinite(source) && current.includes(source)) {
    if (splitLane) {
      const replaced = current.map(lane => lane === source ? target : lane);
      const candidate = [...new Set(replaced)].sort((a, b) => a - b);
      if (candidate.length === count && candidate.every(isAvailable)) return candidate;
    } else {
      const preservedOffsets = current.slice(0, count).map(lane => lane - source);
      const candidate = [...new Set(preservedOffsets.map(offset => target + offset))].sort((a, b) => a - b);
      if (candidate.length === count && candidate.every(isAvailable)) return candidate;

      const sourceIndex = Math.max(0, current.slice(0, count).indexOf(source));
      const firstLane = Math.max(1, Math.min(TOTAL_LANES - count + 1, target - sourceIndex));
      const compactCandidate = Array.from({ length: count }, (_, idx) => firstLane + idx);
      if (compactCandidate.includes(target) && compactCandidate.every(isAvailable)) return compactCandidate;
    }
  }

  const available = [];
  for (let lane = 1; lane <= TOTAL_LANES; lane += 1) {
    if (isAvailable(lane)) available.push(lane);
  }
  if (available.length < count) return null;
  const byDistance = lane => Math.abs(lane - target);
  if (isAvailable(target)) {
    const others = available
      .filter(lane => lane !== target)
      .sort((left, right) => byDistance(left) - byDistance(right) || left - right);
    return [target, ...others.slice(0, count - 1)].sort((a, b) => a - b);
  }
  return available
    .sort((left, right) => byDistance(left) - byDistance(right) || left - right)
    .slice(0, count)
    .sort((a, b) => a - b);
}

function summarizePlanTimes(resourceBlocks = []) {
  const timed = resourceBlocks
    .map(block => ({
      block,
      start: getBowlingBlockMinutes(block, 'start'),
      end: getBowlingBlockMinutes(block, 'end')
    }))
    .filter(item => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start);
  if (!timed.length) return {};
  const start = Math.min(...timed.map(item => item.start));
  const end = Math.max(...timed.map(item => item.end));
  const bowling = timed.find(item => item.block.resourceType === 'bowling_lane');
  const laser = timed.find(item => item.block.resourceType === 'laser_arena');
  return {
    startTime: minuteIntToTime(start),
    endTime: minuteIntToTime(end),
    totalMinutes: end - start,
    firstBowlingTime: bowling?.block?.startTime || (bowling ? minuteIntToTime(bowling.start) : ''),
    firstLaserTime: laser?.block?.startTime || (laser ? minuteIntToTime(laser.start) : '')
  };
}

function moveBowlingOpsPlan(reservation, targetStart, targetLanes, duration) {
  if (!Array.isArray(reservation.opsPlan?.resourceBlocks)) return reservation.opsPlan || null;
  const targetStartMinutes = hourToMinuteInt(targetStart);
  const bowlingBlocks = reservation.opsPlan.resourceBlocks.filter(block => block.resourceType === 'bowling_lane');
  if (!bowlingBlocks.length) return reservation.opsPlan;
  const firstStart = Math.min(...bowlingBlocks.map(block => getBowlingBlockMinutes(block, 'start')));
  const delta = targetStartMinutes - firstStart;
  const moveStep = step => {
    if (step.resourceType !== 'bowling_lane' && step.activityId !== 'bowling') return step;
    const start = getBowlingBlockMinutes(step, 'start') + delta;
    const oldStart = getBowlingBlockMinutes(step, 'start');
    const oldEnd = getBowlingBlockMinutes(step, 'end');
    const minutes = Math.max(1, oldEnd - oldStart || Math.round(Number(duration || reservation.duration || 1) * 60));
    const end = start + minutes;
    return {
      ...step,
      start,
      end,
      startTime: minuteIntToTime(start),
      endTime: minuteIntToTime(end),
      durationMinutes: minutes,
      lanes: step.resourceType === 'bowling_lane' ? targetLanes : step.lanes,
    };
  };
  const timeline = Array.isArray(reservation.opsPlan.timeline) ? reservation.opsPlan.timeline.map(moveStep) : reservation.opsPlan.timeline;
  const resourceBlocks = reservation.opsPlan.resourceBlocks.map(moveStep);
  const planTimes = summarizePlanTimes(resourceBlocks);
  return {
    ...reservation.opsPlan,
    ...planTimes,
    assignedLanes: targetLanes,
    timeline,
    resourceBlocks,
  };
}

async function scheduleBowlingDrag(reservationId, targetLane, targetStart, sourceLaneValue = null, sourceStartValue = null, splitLane = false) {
  const reservation = state.reservations.find(item => Number(item.id) === Number(reservationId));
  if (!reservation) return;
  const duration = getBowlingDurationForReservation(reservation) || Number(reservation.duration || 1);
  const startTime = numToTime(Number(targetStart));
  const requiredCount = Math.max(1, getRequiredLaneCount(reservation.type, reservation.pax, reservation.formuleId));
  const sourceLane = Number(sourceLaneValue);
  const sourceWindow = getBowlingDragSourceWindow(reservation, sourceLaneValue, sourceStartValue);
  const currentLanes = sourceWindow?.lanes?.length ? sourceWindow.lanes : (reservation.lanes || []);
  const slotCheck = validateSlotWindow(reservation.date, startTime, duration, { allowPastStart: true });
  if (!slotCheck.ok) {
    showPlanningMoveNotice('Déplacement impossible', slotCheck.message || 'Ce créneau ne peut pas être utilisé.', 'warning');
    return;
  }
  const lanes = getTargetBowlingLanes(requiredCount, targetLane, reservation.date, startTime, duration, reservation.id, currentLanes, sourceLane, splitLane);
  if (!lanes || lanes.length < requiredCount) {
    showPlanningMoveNotice(
      'Conflit de pistes',
      `Il faut ${requiredCount} piste${requiredCount > 1 ? 's' : ''} libre${requiredCount > 1 ? 's' : ''} sur ce créneau.`,
      'warning'
    );
    return;
  }
  const movedOpsPlan = moveBowlingOpsPlan(reservation, targetStart, lanes, duration);
  if (lanesConflict(reservation.date, startTime, duration, lanes, reservation.id, movedOpsPlan).length) {
    showPlanningMoveNotice('Conflit détecté', 'Une autre réservation occupe déjà cette piste ou cet horaire.', 'warning');
    return;
  }
  // On déplace la résa ENTIÈRE du même delta que le bloc bowling attrapé, pour
  // que le bowling atterrisse au créneau déposé. Indispensable pour les FORMULES :
  // le serveur RE-PLANIFIE toujours une formule (isFormulaPatch) depuis startTime.
  // L'ancien comportement gardait startTime inchangé → la formule était
  // re-planifiée à l'ancienne heure et « revenait en place » malgré le toast.
  const reservationStartMin = hourToMinuteInt(timeToNum(reservation.startTime));
  const bowlingBlocksNow = Array.isArray(reservation.opsPlan?.resourceBlocks)
    ? reservation.opsPlan.resourceBlocks.filter(block => block.resourceType === 'bowling_lane')
    : [];
  const firstBowlingStartMin = bowlingBlocksNow.length
    ? Math.min(...bowlingBlocksNow.map(block => getBowlingBlockMinutes(block, 'start')))
    : reservationStartMin;
  const dragDeltaMin = hourToMinuteInt(Number(targetStart)) - firstBowlingStartMin;
  const movedReservationStartTime = minuteIntToTime(reservationStartMin + dragDeltaMin);
  const updated = {
    ...reservation,
    startTime: movedReservationStartTime,
    lanes,
    allowPastStart: true,
    opsPlan: movedOpsPlan
  };
  const previous = { ...reservation, opsPlan: reservation.opsPlan ? { ...reservation.opsPlan } : null };
  const requestKey = Number(reservation.id);
  const requestSeq = ++bowlingDragSaveSeq;
  bowlingDragLatestSeqByReservation[requestKey] = requestSeq;
  const isLatestRequest = () => bowlingDragLatestSeqByReservation[requestKey] === requestSeq;
  const clearLatestRequest = () => {
    if (isLatestRequest()) delete bowlingDragLatestSeqByReservation[requestKey];
  };
  const moveFields = ['startTime', 'lanes', 'opsPlan'];
  markReservationMutation(requestKey, updated, moveFields);
  applyOptimisticReservation(updated, { preserveEditState: true });
  try {
    const payload = await apiRequest(API_ENDPOINTS.staffReservations, {
      method: 'PATCH',
      body: JSON.stringify(buildReservationApiPayload(updated, {
        skipReplan: updated.type !== 'formule' && !updated.formuleId && !updated.formulaId,
        laneCount: requiredCount,
        requiresLanes: true,
        allowPastStart: true
      }))
    });
    if (!isLatestRequest()) return;
    if (!payload?.reservation) throw new Error('Sauvegarde non confirmee par le serveur.');
    upsertReservationInState(payload.reservation);
    // Protection maintenue sur la position confirmée : le poll staff-state peut
    // encore renvoyer l'ancienne position (cohérence éventuelle) → pas de flicker.
    markReservationMutation(requestKey, payload.reservation, moveFields);
    save();
    renderStaffData();
    // Toast HONNÊTE : on vérifie où le serveur a RÉELLEMENT placé le bowling
    // (une formule peut être re-planifiée / ajustée). Plus de faux « déplacé ».
    const savedBowlingBlocks = Array.isArray(payload.reservation.opsPlan?.resourceBlocks)
      ? payload.reservation.opsPlan.resourceBlocks.filter(block => block.resourceType === 'bowling_lane')
      : [];
    const savedStartMin = savedBowlingBlocks.length
      ? Math.min(...savedBowlingBlocks.map(block => getBowlingBlockMinutes(block, 'start')))
      : hourToMinuteInt(timeToNum(payload.reservation.startTime));
    const targetMin = hourToMinuteInt(Number(targetStart));
    if (Math.abs(savedStartMin - targetMin) <= 1) {
      toast(`Bowling déplacé à ${formatClockDisplay(Number(targetStart))} piste${lanes.length > 1 ? 's' : ''} ${lanes.join(', ')}`);
    } else {
      showPlanningMoveNotice('Replanifié', `La réservation a été placée à ${formatClockDisplay(savedStartMin / 60)} (ajustement serveur).`, 'info');
    }
  } catch (error) {
    if (!isLatestRequest()) return;
    applyOptimisticReservation(previous, { preserveEditState: true });
    clearReservationMutation(requestKey);
    showPlanningMoveNotice('Déplacement annulé', error.message || 'Le serveur a refusé ce placement.', 'warning');
    return;
  } finally {
    clearLatestRequest();
  }
}

function setBowlingSourceDragging(reservationId, active) {
  document.querySelectorAll(`.booking[data-booking-res-id="${Number(reservationId)}"]`).forEach(el => {
    el.classList.toggle('is-dragging', active);
  });
}

function createBowlingDragGhost(sourceEl, event) {
  const reservation = state.reservations.find(item => Number(item.id) === Number(bowlingPointerDrag?.reservationId));
  const rect = sourceEl.getBoundingClientRect();
  const ghost = document.createElement('div');
  ghost.className = `bowling-drag-ghost-card ${reservation ? getReservationHighlightClasses(reservation) : ''}`;
  ghost.style.width = `${Math.max(220, Math.min(360, rect.width))}px`;
  ghost.style.transform = `translate3d(${event.clientX + 14}px, ${event.clientY + 14}px, 0)`;
  const label = reservation ? getReservationLabel(reservation) : 'Bowling';
  const lanes = reservation?.lanes?.length ? `Pistes ${reservation.lanes.join(', ')}` : 'Affectation libre';
  const sourceWindow = reservation ? getBowlingDragSourceWindow(reservation, bowlingPointerDrag?.sourceLane, bowlingPointerDrag?.sourceStart) : null;
  const isMultiLane = (sourceWindow?.lanes?.length || reservation?.lanes?.length || 0) > 1;
  const dragMode = isMultiLane ? (bowlingPointerDrag?.splitLane ? 'Piste seule' : 'Groupe de pistes') : lanes;
  ghost.innerHTML = `
    <strong>${escapeHtml(reservation?.name || 'Réservation')}</strong>
    <span>${escapeHtml(label)}</span>
    <small>${escapeHtml(dragMode)}</small>
    ${isMultiLane ? '<small>Shift/Ctrl : piste seule</small>' : ''}
  `;
  document.body.appendChild(ghost);
  return ghost;
}

function updateBowlingPointerGhost(event) {
  if (!bowlingPointerDrag?.ghost) return;
  bowlingPointerDrag.ghost.style.transform = `translate3d(${event.clientX + 14}px, ${event.clientY + 14}px, 0)`;
}

function startBowlingPointerDragMode(event) {
  if (!bowlingPointerDrag || bowlingPointerDrag.dragging) return;
  bowlingPointerDrag.dragging = true;
  setBowlingSourceDragging(bowlingPointerDrag.reservationId, true);
  bowlingPointerDrag.ghost = createBowlingDragGhost(bowlingPointerDrag.sourceEl, event);
  laserDragActive = true;
  laserDragLastY = event.clientY || 0;
  document.body.classList.add('bowling-dragging');
  document.addEventListener('wheel', onLaserDragWheel, { passive: false });
  startLaserDragAutoScroll(laserDragLastY);
}

function onBowlingPointerMove(event) {
  if (!bowlingPointerDrag) return;
  const distance = Math.hypot(event.clientX - bowlingPointerDrag.startX, event.clientY - bowlingPointerDrag.startY);
  if (!bowlingPointerDrag.dragging && distance >= 5) startBowlingPointerDragMode(event);
  if (!bowlingPointerDrag.dragging) return;
  event.preventDefault();
  event.stopPropagation();
  bowlingPointerDrag.lastX = event.clientX;
  bowlingPointerDrag.lastY = event.clientY;
  updateBowlingPointerGhost(event);
  startLaserDragAutoScroll(event.clientY);
  setBowlingDragDropTarget(getBowlingDropTargetFromPoint(event.clientX, event.clientY));
}

function onBowlingPointerUp(event) {
  if (!bowlingPointerDrag) return;
  const drag = bowlingPointerDrag;
  const wasDragging = drag.dragging;
  bowlingPointerDrag = null;
  document.removeEventListener('mousemove', onBowlingPointerMove, true);
  document.removeEventListener('mouseup', onBowlingPointerUp, true);
  if (!wasDragging) return;
  event.preventDefault();
  event.stopPropagation();
  bowlingDragSuppressClickUntil = Date.now() + 350;
  laserDragActive = false;
  stopLaserDragAutoScroll();
  document.body.classList.remove('bowling-dragging');
  document.removeEventListener('wheel', onLaserDragWheel);
  setBowlingSourceDragging(drag.reservationId, false);
  if (drag.ghost) drag.ghost.remove();
  const target = getBowlingDropTargetFromPoint(event.clientX, event.clientY) || bowlingDragDropTarget;
  clearBowlingDragDropTarget();
  if (!target) {
    showPlanningMoveNotice('Aucun créneau choisi', 'Déposez la carte sur une cellule piste/heure disponible.', 'warning');
    return;
  }
  scheduleBowlingDrag(
    drag.reservationId,
    Number(target.dataset.bowlingDropLane),
    Number(target.dataset.bowlingDropStart),
    drag.sourceLane,
    drag.sourceStart,
    Boolean(drag.splitLane)
  );
}

function startBowlingBookingPointerDrag(event, reservationId, sourceLane = null, sourceStart = null) {
  if (event.button !== 0) return;
  event.stopPropagation();
  bowlingPointerDrag = {
    reservationId,
    sourceLane,
    sourceStart,
    splitLane: event.shiftKey || event.altKey || event.ctrlKey || event.metaKey,
    sourceEl: event.currentTarget,
    startX: event.clientX,
    startY: event.clientY,
    lastX: event.clientX,
    lastY: event.clientY,
    dragging: false,
    ghost: null
  };
  document.addEventListener('mousemove', onBowlingPointerMove, true);
  document.addEventListener('mouseup', onBowlingPointerUp, true);
}

function shouldIgnoreBowlingDragClick(event) {
  if (Date.now() > bowlingDragSuppressClickUntil) return false;
  event.preventDefault();
  event.stopPropagation();
  return true;
}

function onLaserPassDragStart(event, reservationId, unitKey) {
  event.stopPropagation();
  event.dataTransfer.setData('text/plain', JSON.stringify({ type: 'laser-pass', reservationId, unitKey }));
  event.dataTransfer.effectAllowed = 'move';
  laserDragActive = true;
  laserDragLastY = event.clientY || 0;
  document.body.classList.add('laser-dragging');
  event.currentTarget.classList.add('is-dragging');
  document.addEventListener('dragover', onLaserDocumentDragOver);
  document.addEventListener('wheel', onLaserDragWheel, { passive: false });
  startLaserDragAutoScroll(laserDragLastY);
}

function onLaserPassDragEnd(event) {
  laserDragActive = false;
  stopLaserDragAutoScroll();
  document.body.classList.remove('laser-dragging');
  event.currentTarget.classList.remove('is-dragging');
  clearLaserDragDropTarget();
  document.querySelectorAll('.laser-session-slot.is-drop-target').forEach(el => el.classList.remove('is-drop-target'));
  document.removeEventListener('dragover', onLaserDocumentDragOver);
  document.removeEventListener('wheel', onLaserDragWheel);
}

function onLaserPassDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  startLaserDragAutoScroll(event.clientY);
}

function onLaserPassDragEnter(event) {
  event.preventDefault();
  setLaserDragDropTarget(event.currentTarget);
}

function onLaserPassDragLeave(event) {
  if (laserDragDropTarget === event.currentTarget) clearLaserDragDropTarget();
}

function onLaserPassDrop(event, targetStart, targetEnd = null) {
  event.preventDefault();
  clearLaserDragDropTarget();
  const raw = event.dataTransfer.getData('text/plain');
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    if (data.type !== 'laser-pass') return;
    scheduleLaserPass(data.reservationId, data.unitKey ?? data.passIndex, Number(targetStart), targetEnd === null ? null : Number(targetEnd));
  } catch (error) {
    toast('Déplacement Laser Game impossible.');
  }
}

function getOccupiedLanes(date, startTime, duration, ignoreId) {
  const reqStart = typeof startTime === 'string' ? timeToNum(startTime) : startTime;
  const occupied = new Set();
  state.reservations.forEach(r => {
    if (r.id === ignoreId) return;
    if (r.date === date && r.status !== 'cancelled' && (r.lanes || []).length > 0) {
      getBowlingWindowsFromReservation(r).forEach(window => {
        if (overlap(reqStart, Number(duration), window.start, window.duration)) {
          window.lanes.forEach(l => occupied.add(l));
        }
      });
    }
  });
  return occupied;
}

function getFreeCount(date, startTime, duration) {
  const occ = getOccupiedLanes(date, startTime, duration);
  let count = 0;
  for (let i = 1; i <= TOTAL_LANES; i++) if (!occ.has(i) && state.laneStatuses[i] !== 'maintenance') count++;
  return count;
}

function allocateLanes(n, date, startTime, duration, ignoreId) {
  if (n === 0) return [];
  const occ = getOccupiedLanes(date, startTime, duration, ignoreId);
  const avail = [];
  for (let i = 1; i <= TOTAL_LANES; i++) if (!occ.has(i) && state.laneStatuses[i] !== 'maintenance') avail.push(i);
  if (avail.length < n) return null;
  if (n === 1) {
    for (const pair of PAIRS) {
      if (avail.includes(pair[0]) && !avail.includes(pair[1])) return [pair[0]];
      if (!avail.includes(pair[0]) && avail.includes(pair[1])) return [pair[1]];
    }
    return [avail[0]];
  }
  if (n === 2) {
    for (const pair of PAIRS) if (avail.includes(pair[0]) && avail.includes(pair[1])) return pair;
  }
  avail.sort((a, b) => a - b);
  for (let i = 0; i <= avail.length - n; i++) {
    const group = [avail[i]];
    let ok = true;
    for (let j = 1; j < n; j++) {
      if (avail[i + j] === group[group.length - 1] + 1) group.push(avail[i + j]);
      else { ok = false; break; }
    }
    if (ok) return group;
  }
  return avail.slice(0, n);
}

// Alloue N pistes libres en GARDANT les pistes déjà choisies (« graines »),
// puis complète avec les pistes libres restantes. Sert quand un groupe déborde
// de la piste pré-remplie depuis une case du planning : l'extension inclut
// toujours la piste cliquée.
function allocateLanesIncludingSeed(n, seedLanes, date, startTime, duration, ignoreId) {
  if (n <= 0) return [];
  const occ = getOccupiedLanes(date, startTime, duration, ignoreId);
  const isFree = (l) => l >= 1 && l <= TOTAL_LANES && !occ.has(l) && state.laneStatuses[l] !== 'maintenance';
  const avail = [];
  for (let i = 1; i <= TOTAL_LANES; i++) if (isFree(i)) avail.push(i);
  if (avail.length < n) return null;
  const result = [...new Set((seedLanes || []).map(Number))].filter(isFree).slice(0, n);
  const chosen = new Set(result);
  for (const lane of avail) {
    if (result.length >= n) break;
    if (!chosen.has(lane)) { result.push(lane); chosen.add(lane); }
  }
  return result.length >= n ? result.sort((a, b) => a - b) : null;
}

function getBowlingCandidateWindows(startTime, duration, lanes, opsPlan = null) {
  const fallbackStart = typeof startTime === 'string' ? timeToNum(startTime) : Number(startTime || 0);
  const fallbackDuration = Number(duration || 0);
  const fallbackLanes = (lanes || []).map(Number).filter(Number.isFinite);
  const blocks = Array.isArray(opsPlan?.resourceBlocks)
    ? opsPlan.resourceBlocks.filter(block => block.resourceType === 'bowling_lane')
    : [];
  if (blocks.length) {
    return blocks.map(block => {
      const start = readBlockHour(block, 'start', fallbackStart);
      const end = readBlockHour(block, 'end', start + ((Number(block.durationMinutes) || (fallbackDuration * 60)) / 60));
      const blockLanes = (block.lanes?.length ? block.lanes : fallbackLanes).map(Number).filter(Number.isFinite);
      return {
        start,
        end,
        duration: Math.max(0, end - start),
        lanes: blockLanes,
      };
    }).filter(window => window.duration > 0 && window.lanes.length > 0);
  }
  return [{
    start: fallbackStart,
    end: fallbackStart + fallbackDuration,
    duration: fallbackDuration,
    lanes: fallbackLanes,
  }];
}

function lanesConflict(date, startTime, duration, lanes, ignoreId, candidateOpsPlan = null) {
  if (!Array.isArray(lanes) || !lanes.length) return [];
  const candidateWindows = getBowlingCandidateWindows(startTime, duration, lanes, candidateOpsPlan);
  return state.reservations.filter(r =>
    r.id !== ignoreId &&
    r.date === date &&
    r.status !== 'cancelled' &&
    candidateWindows.some(candidate =>
      getBowlingWindowsFromReservation(r).some(window =>
        overlap(candidate.start, candidate.duration, window.start, window.duration) &&
        window.lanes.some(l => candidate.lanes.includes(l))
      )
    )
  );
}

function getLaserAvailability(date, startTime, duration, pax, ignoreId) {
  const players = Number(pax || 0);
  const candidateWindows = getLaserCandidateWindows(
    typeof startTime === 'string' ? startTime : numToTime(startTime),
    duration,
    players
  );
  const waveCount = Math.max(...candidateWindows.map(window => Number(window.groupWaveCount || 1)), 1);
  let tightestRemaining = LASER_GAME_MAX_PLAYERS;
  let maxPlayersTotal = 0;
  let sharedNow = false;
  let ok = true;
  let message = '';

  const normalizeKey = value => Math.round(Number(value) * 60);
  const laserWindowsForDate = () => state.reservations
    .filter(r => r.id !== ignoreId && r.date === date && r.status !== 'cancelled')
    .flatMap(getLaserWindowsFromReservation);

  for (const candidate of candidateWindows) {
    const overlappingWindows = laserWindowsForDate()
      .filter(window => overlap(candidate.start, candidate.duration, window.start, window.duration));

    // Le serveur (ops-engine.findJoinableLaserSession) fusionne une nouvelle
    // demande avec une session laser existante compatible : capacité libre et
    // depart/fin a +/-15 min. On reproduit cette logique cote modale, sinon une
    // session partageable (ex. 18/30 joueurs) etait comptee comme un 2e
    // lancement parallele et affichee « complet » alors qu'il reste des places.
    const candidateStartMin = normalizeKey(candidate.start);
    const candidateEndMin = normalizeKey(candidate.end);
    const sessions = new Map();
    overlappingWindows.forEach(window => {
      const key = `${normalizeKey(window.start)}-${normalizeKey(window.end)}`;
      const entry = sessions.get(key) || { start: window.start, end: window.end, players: 0 };
      entry.players += Number(window.players || window.reservation?.pax || 0);
      sessions.set(key, entry);
    });
    const joinable = [...sessions.values()]
      .filter(session =>
        session.players + Number(candidate.players || 0) <= LASER_GAME_MAX_PLAYERS
        && Math.abs(normalizeKey(session.start) - candidateStartMin) <= 15
        && Math.abs(normalizeKey(session.end) - candidateEndMin) <= 15)
      .sort((a, b) => Math.abs(normalizeKey(a.start) - candidateStartMin) - Math.abs(normalizeKey(b.start) - candidateStartMin))[0] || null;

    const effStart = joinable ? joinable.start : candidate.start;
    const effEnd = joinable ? joinable.end : candidate.end;
    const effDuration = joinable ? Math.max(0, effEnd - effStart) : candidate.duration;
    const overlapping = joinable
      ? laserWindowsForDate().filter(window => overlap(effStart, effDuration, window.start, window.duration))
      : overlappingWindows;

    const sessionKey = `${normalizeKey(effStart)}-${normalizeKey(effEnd)}`;
    const sessionKeys = new Set(overlapping.map(window => `${normalizeKey(window.start)}-${normalizeKey(window.end)}`));
    const joinsExistingSession = sessionKeys.has(sessionKey);
    const launchCount = sessionKeys.size + (joinsExistingSession ? 0 : 1);
    const playersBefore = overlapping.reduce((sum, window) => sum + Number(window.players || window.reservation?.pax || 0), 0);
    const playersTotal = playersBefore + Number(candidate.players || 0);
    maxPlayersTotal = Math.max(maxPlayersTotal, playersTotal);
    tightestRemaining = Math.min(tightestRemaining, Math.max(0, LASER_GAME_MAX_PLAYERS - playersTotal));
    sharedNow = sharedNow || (playersBefore > 0 && joinsExistingSession);
    if (launchCount > LASER_GAME_PARALLEL_LAUNCHES || playersTotal > LASER_GAME_MAX_PLAYERS) {
      ok = false;
      message = `Laser complet (${playersTotal}/${LASER_GAME_MAX_PLAYERS} joueurs).`;
      break;
    }
  }

  return {
    ok,
    playersBefore: 0,
    playersTotal: maxPlayersTotal,
    groupPlayers: players,
    waveCount,
    splitGroup: waveCount > 1,
    remainingPlaces: Math.max(0, tightestRemaining),
    sharedNow,
    mayShare: maxPlayersTotal < LASER_GAME_MAX_PLAYERS,
    message: ok ? '' : message
  };
}

function parseLaneInput(value = '') {
  return [...new Set(String(value).split(',').map(s => Number(s.trim())).filter(n => n > 0 && n <= TOTAL_LANES))].sort((a, b) => a - b);
}

function formatLaneInput(lanes = []) {
  return lanes.length ? lanes.join(',') : '';
}

function getSuggestedEditLanes(requiredCount, date, startTime, duration, ignoreId, currentValue = '') {
  if (!requiredCount) return [];
  const occupied = getOccupiedLanes(date, startTime, duration, ignoreId);
  const available = new Set();
  for (let i = 1; i <= TOTAL_LANES; i++) {
    if (!occupied.has(i) && state.laneStatuses[i] !== 'maintenance') available.add(i);
  }

  const kept = parseLaneInput(currentValue).filter(l => available.has(l));
  if (kept.length >= requiredCount) return kept.slice(0, requiredCount);

  if (requiredCount === 2 && kept.length === 1) {
    const pair = PAIRS.find(group => group.includes(kept[0]));
    const mate = pair ? pair.find(l => l !== kept[0]) : null;
    if (mate && available.has(mate)) return [kept[0], mate].sort((a, b) => a - b);
  }

  const allocated = allocateLanes(requiredCount, date, startTime, duration, ignoreId);
  return allocated ? [...allocated].sort((a, b) => a - b) : null;
}

function refreshEditPreview() {
  if (!state.selectedRes || !state.editState) return;
  const e = state.editState;
  const meta = `${getReservationLabel(state.selectedRes)} • ${e.startTime || '--:--'} • ${e.lanesStr ? `pistes ${e.lanesStr}` : 'hors piste'}`;
  const nameEl = document.getElementById('editSummaryName');
  const metaEl = document.getElementById('editSummaryMeta');
  const paxEl = document.getElementById('editSummaryPax');
  const durationEl = document.getElementById('editSummaryDuration');
  const assignEl = document.getElementById('editAssignmentValue');
  const laneInput = document.getElementById('editLanesInput');
  if (nameEl) nameEl.textContent = e.name || 'Réservation';
  if (metaEl) metaEl.textContent = meta;
  if (paxEl) paxEl.textContent = e.pax || 0;
  if (durationEl) durationEl.textContent = formatDurationLabel(e.duration || 0);
  if (assignEl) assignEl.textContent = e.lanesStr || 'Hors piste';
  if (laneInput && document.activeElement !== laneInput) laneInput.value = e.lanesStr || '';
}

function syncEditLaneAssignment() {
  if (!state.selectedRes || !state.editState) return null;
  const requiresLanes = reservationNeedsLanes(state.selectedRes.type, state.selectedRes.formuleId);
  if (!requiresLanes) {
    state.editState.lanesStr = '';
    refreshEditPreview();
    return [];
  }
  const requiredCount = getRequiredLaneCount(state.selectedRes.type, state.editState.pax, state.selectedRes.formuleId);
  const duration = Number(state.editState.duration || state.selectedRes.duration || 0);
  const suggested = getSuggestedEditLanes(requiredCount, state.selectedRes.date, state.editState.startTime, duration, state.selectedRes.id, state.editState.lanesStr);
  if (suggested) state.editState.lanesStr = formatLaneInput(suggested);
  refreshEditPreview();
  return suggested;
}

function setEditField(field, value, syncLanes = false) {
  if (!state.editState) return;
  state.editState[field] = value;
  if (syncLanes) syncEditLaneAssignment();
  else refreshEditPreview();
}

function setEditLanes(value) {
  if (!state.editState) return;
  state.editState.lanesStr = value;
  refreshEditPreview();
}

// Bascule d'une piste depuis le selecteur. La source de verite reste
// `lanesStr`, le format que le reste du formulaire lit deja : on ne cree pas un
// second etat pour les memes pistes, sinon les deux divergent au premier oubli.
function getEditLaneNumbers() {
  return String(state.editState?.lanesStr || '')
    .split(',')
    .map(part => Number(String(part).trim()))
    .filter(lane => Number.isFinite(lane) && lane >= 1);
}

function toggleEditLane(lane) {
  if (!state.editState) return;
  const choisies = new Set(getEditLaneNumbers());
  if (choisies.has(lane)) choisies.delete(lane);
  else choisies.add(lane);
  state.editState.lanesStr = [...choisies].sort((a, b) => a - b).join(',');
  const bouton = document.querySelector(`.lane-picker .lane-chip[onclick="toggleEditLane(${lane})"]`);
  if (bouton) {
    const actif = choisies.has(lane);
    bouton.classList.toggle('is-on', actif);
    bouton.setAttribute('aria-pressed', actif ? 'true' : 'false');
  }
  refreshEditPreview();
}
window.toggleEditLane = toggleEditLane;

const STORAGE_KEY = 'funGalaxy_v4';
const AUTH_KEY = 'funGalaxy_auth_v1';
const API_ENDPOINTS = window.PinlaneApiClient?.endpoints || {
  publicReservations: '/api/public-reservations',
  publicBookingMeta: '/api/public-booking-meta',
  staffReservations: '/api/staff-reservations',
  staffState: '/api/staff-state',
  publicAvailability: '/api/public-availability',
  staffLanes: '/api/staff-lanes',
  adminRange: '/api/admin-range',
  ops: '/api/ops',
  simulation: '/api/simulation',
  marketingAgents: '/api/marketing-agents',
  staffAuth: '/api/staff-auth'
};
let remoteSyncTimer = null;
let remoteSyncBusy = false;
let remoteSyncFailureCount = 0;
let remoteSyncPausedUntil = 0;
let remoteSyncLastFailure = '';
let remoteSyncDownSince = 0;
let staffRevisionByDate = {};
// Horodatage du dernier sync serveur réussi par (centre, date) : évite de
// re-payer un aller-retour staff-state quand la donnée vient d'être polléé.
let staffSyncAtByDate = {};

function isDateSyncFresh(dateStr, maxAgeMs = 10000) {
  const key = `${encodeURIComponent(getCurrentStaffCenterId())}:${dateStr}`;
  const at = staffSyncAtByDate[key] || 0;
  return at > 0 && (Date.now() - at) <= maxAgeMs;
}
let opsAdminCache = {
  communications: [],
  samples: [],
  suggestions: [],
  events: [],
  agentStack: null,
  opsHealth: null,
  simulation: null,
  loaded: false,
  loading: false,
  lastLoadedAt: ''
};
let selectedOpsAgentId = '';
let opsAdminLastAutoLoadAt = 0;
let opsSimulationAutoTimer = null;
let opsSimulationAutoRunning = false;
let opsSimulationLastDashboardRefreshAt = 0;
let adminDashboardCache = {
  loading: false,
  loaded: false,
  error: '',
  snapshot: null,
  knowledge: null,
  communications: [],
  suggestions: [],
  events: [],
  samples: [],
  agentStack: null,
  opsHealth: null,
  simulation: null,
  lastLoadedAt: ''
};
let adminSnapshotCache = {};
let adminSnapshotLoadingKeys = {};
let adminOpsCacheByCenter = {};
let adminOpsLoadingByCenter = {};
let adminKnowledgeLoading = false;
let adminLoadRequestId = 0;
let staffClientDataCache = {
  key: '',
  loading: false,
  loaded: false,
  error: '',
  reservations: [],
  syncedAt: '',
  loadedAt: 0
};
let staffReservationsDataCache = {
  key: '',
  loading: false,
  loaded: false,
  error: '',
  reservations: [],
  syncedAt: '',
  loadedAt: 0
};

function sortReservations(list = []) {
  return [...list].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    const timeDelta = timeToNum(a.startTime) - timeToNum(b.startTime);
    if (timeDelta !== 0) return timeDelta;
    return Number(a.id) - Number(b.id);
  });
}

// Reconcilie le cache mensuel (source des compteurs du calendrier Reservations)
// avec le snapshot serveur d'un jour poll : sans ca, une resa supprimee ou
// deplacee cote serveur restait dans le cache (fusion par union d'id) et gonflait
// le compteur de la case ("15 resa" affiche alors que le clic charge le reel).
// On remplace les entrees du cache pour CETTE date par la liste serveur du jour.
function reconcileMonthCacheForDate(dateStr, reservations) {
  if (!staffReservationsDataCache.loaded) return;
  const others = (staffReservationsDataCache.reservations || []).filter(r => r.date !== dateStr);
  staffReservationsDataCache = {
    ...staffReservationsDataCache,
    reservations: [...others, ...(reservations || [])]
  };
}

function replaceReservationsForDate(dateStr, reservations) {
  const others = state.reservations.filter(r => r.date !== dateStr);
  const serverList = reservations || [];
  reconcileMonthCacheForDate(dateStr, serverList);
  if (!pendingReservationMutations.size) {
    state.reservations = sortReservations([...others, ...serverList]);
    return;
  }
  const now = Date.now();
  const serverKeys = new Set(serverList.map(r => getReservationWriteKey(r.id)));
  // 1) Fusion champ par champ : pour chaque résa du snapshot serveur qui a une
  //    mutation en attente, on protège UNIQUEMENT les champs mutés localement
  //    tant que le serveur n'a pas confirmé la valeur attendue (ou tant que le
  //    délai de grâce n'est pas dépassé). Les autres champs (donc les
  //    changements faits par un autre poste) passent normalement.
  const merged = serverList.map(serverReservation => {
    const key = getReservationWriteKey(serverReservation.id);
    const entry = pendingReservationMutations.get(key);
    if (!entry) return serverReservation;
    if (reservationMatchesMutation(serverReservation, entry) || now >= entry.deadline) {
      pendingReservationMutations.delete(key);
      pendingReservationWriteIds.delete(key);
      return serverReservation;
    }
    return applyExpectedMutationFields(serverReservation, entry);
  });
  // 2) Résas absentes du snapshot serveur (création/déplacement pas encore visible)
  //    mais avec une mutation en attente : on conserve la version locale.
  const pendingMissing = state.reservations.filter(r => {
    if (r.date !== dateStr) return false;
    const key = getReservationWriteKey(r.id);
    if (serverKeys.has(key)) return false;
    const entry = pendingReservationMutations.get(key);
    if (!entry) return false;
    if (now >= entry.deadline) {
      pendingReservationMutations.delete(key);
      pendingReservationWriteIds.delete(key);
      return false;
    }
    return true;
  });
  state.reservations = sortReservations([...others, ...merged, ...pendingMissing]);
}

function upsertReservationInState(reservation) {
  const next = state.reservations.filter(r => r.id !== reservation.id);
  next.push(reservation);
  state.reservations = sortReservations(next);
  syncReservationIntoMonthCache(reservation);
}

function removeReservationFromState(id) {
  state.reservations = state.reservations.filter(r => r.id !== id);
  removeReservationFromMonthCache(id);
}

// Store partagé : les pages qui lisent le cache mensuel (Réservations v2,
// Utilitaires, Clients) reflètent IMMÉDIATEMENT chaque mutation locale au lieu
// d'attendre le bouton « Actualiser » : indispensable pour les suppressions,
// que le merge par id ne peut pas faire disparaître du cache.
function syncReservationIntoMonthCache(reservation) {
  if (!staffReservationsDataCache.loaded || !reservation) return;
  const rows = (staffReservationsDataCache.reservations || []).filter(r => String(r.id) !== String(reservation.id));
  rows.push(reservation);
  staffReservationsDataCache = { ...staffReservationsDataCache, reservations: rows };
}

function removeReservationFromMonthCache(id) {
  if (!staffReservationsDataCache.loaded) return;
  staffReservationsDataCache = {
    ...staffReservationsDataCache,
    reservations: (staffReservationsDataCache.reservations || []).filter(r => String(r.id) !== String(id))
  };
}

function hydrateSelectedReservation() {
  if (!state.selectedRes) return;
  const fresh = state.reservations.find(r => r.id === state.selectedRes.id);
  if (!fresh) {
    closePos();
    return;
  }
  state.selectedRes = fresh;
  state.editState = { ...fresh, lanesStr: (fresh.lanes || []).join(', ') };
}

function buildReservationApiPayload(reservation, overrides = {}) {
  const requiresLanes = overrides.requiresLanes ?? reservationNeedsLanes(reservation.type, reservation.formuleId);
  const laneCount = overrides.laneCount ?? (requiresLanes ? Math.max((reservation.lanes || []).length, getRequiredLaneCount(reservation.type, reservation.pax, reservation.formuleId)) : 0);
  const channel = overrides.channel || reservation.channel || 'staff';
  return {
    ...reservation,
    ...overrides,
    // Canal public : le centre vient de la ligne d'installation (?center=),
    // jamais du centre de la session staff, qui n'existe pas chez le visiteur.
    centerId: overrides.centerId || reservation.centerId || reservation.center_id
      || (channel === 'public' ? getTunnelCenterId() : getCurrentStaffCenterId()),
    laneCount,
    requiresLanes,
    channel,
    allowPastStart: channel === 'staff' && Boolean(overrides.allowPastStart ?? reservation.allowPastStart)
  };
}

// CE QUI DECIDE D'UN RE-RENDU, C'EST CE QUI SE DESSINE, PAS L'HORODATAGE.
//
// Cette projection portait `updatedAt`, un champ que la console n'affiche
// NULLE PART : il ne servait que de fourre-tout « quelque chose a bouge cote
// serveur ». Consequence visible au comptoir : un clic sur Arrive / Paye /
// Confirme appliquait l'etat optimiste (1er rendu), puis l'echo serveur
// revenait ~300 ms plus tard avec un `updatedAt` neuf, la signature changeait
// alors que le PIXEL etait identique, et la liste entiere se redessinait une
// deuxieme fois. Movsar voyait un double clic la ou il y en avait un seul.
//
// On compare donc ce qui compte : les champs REELLEMENT dessines par
// renderReservationRow / les cartes du planning (identite, horaire, ressource,
// tags). `updatedAt` sort ; `name`, `phone`, `notes`, `occasion` et `label`
// entrent, parce qu'ils se dessinent et qu'ils n'etaient couverts que par
// ricochet, via `updatedAt`.
function reservationRenderSignature(r) {
  return {
    id: Number(r.id),
    status: r.status,
    startTime: r.startTime,
    duration: Number(r.duration) || 0,
    pax: Number(r.pax) || 0,
    price: Number(r.price) || 0,
    type: r.type || 'bowling',
    formuleId: r.formuleId || '',
    opsPlanKey: JSON.stringify((r.opsPlan?.resourceBlocks || []).map(block => [block.resourceType, block.startTime, block.endTime, block.lanes, block.players])),
    guestOpsKey: JSON.stringify(r.opsPlan?.guestOps || {}),
    lanes: (r.lanes || []).map(Number),
    paymentMethod: r.paymentMethod || '',
    name: r.name || '',
    phone: r.phone || '',
    label: r.label || '',
    occasion: r.occasion || '',
    notes: r.notes || ''
  };
}

function getCurrentStaffReservationsForUi() {
  return todaysReservations().map(reservationRenderSignature);
}

function getStaffDataSignature(dateStr = state.currentDate) {
  const reservations = dateStr === state.currentDate
    ? getCurrentStaffReservationsForUi()
    : state.reservations
        .filter(r => r.date === dateStr && r.status !== 'cancelled')
        .map(reservationRenderSignature);
  return JSON.stringify({
    date: dateStr,
    staffResourceView: state.staffResourceView || 'all',
    reservations,
    laneStatuses: state.laneStatuses,
    searchTerm: state.searchTerm || '',
    staffStatusFilter: state.staffStatusFilter || 'all',
    planningExpanded: !!state.staffPlanningExpanded
  });
}

function getSelectedReservationSignature() {
  if (!state.selectedRes) return '';
  return JSON.stringify({
    id: state.selectedRes.id,
    status: state.selectedRes.status,
    startTime: state.selectedRes.startTime,
    duration: state.selectedRes.duration,
    pax: state.selectedRes.pax,
    price: state.selectedRes.price,
    lanes: state.selectedRes.lanes || [],
    paymentMethod: state.selectedRes.paymentMethod || '',
    activeTab: state.activeTab,
    editState: state.editState ? {
      name: state.editState.name,
      phone: state.editState.phone,
      startTime: state.editState.startTime,
      duration: state.editState.duration,
      pax: state.editState.pax,
      lanesStr: state.editState.lanesStr,
      status: state.editState.status
    } : null
  });
}

function renderStaffData() {
  // Fusion Clients+Groupes : « groups » n'est plus une page, tout état legacy
  // (onglet sauvegardé, hash) retombe sur Clients, segment « À venir ».
  if (getStaffMenuPage() === 'groups') {
    state.staffMenuPage = 'clients';
    state.staffClientSegment = 'avenir';
    save();
  }
  const dayReservations = todaysReservations();
  renderStaffShell(dayReservations);
  if (isStaffDashboardActive()) {
    renderStaffDashboard(dayReservations);
    return;
  }
  if (isStaffReservationsActive()) {
    renderStaffReservationsPage();
    return;
  }
  if (isStaffClientsActive()) {
    renderStaffClientsPage();
    return;
  }
  if (isStaffPricingActive()) {
    renderStaffPricingPage();
    return;
  }
  if (isStaffEmailsActive()) {
    renderStaffEmailsPage();
    return;
  }
  if (isStaffCampaignsActive()) {
    renderStaffCampaignsPage();
    return;
  }
  if (isStaffUtilityActive()) {
    renderStaffUtilityPage();
    return;
  }
  renderKpis();
  const view = getStaffResourceView();
  syncStaffResourceTabs(dayReservations, view);
  renderPlanning();
  renderLaserPlanning();
  renderTable();
}

function applyOptimisticReservation(reservation, options = {}) {
  if (!reservation) return;
  const beforeData = state.view === 'staff' ? getStaffDataSignature() : '';
  const beforeSelected = getSelectedReservationSignature();
  upsertReservationInState(reservation);
  if (state.selectedRes && state.selectedRes.id === reservation.id) {
    state.selectedRes = reservation;
    if (options.preserveEditState) {
      state.editState = { ...reservation, lanesStr: (reservation.lanes || []).join(', ') };
    }
  }
  save();
  if (state.view === 'staff' && beforeData !== getStaffDataSignature()) renderStaffData();
  if (state.selectedRes && state.selectedRes.id === reservation.id && beforeSelected !== getSelectedReservationSignature()) renderPos();
}

function removeOptimisticReservation(id) {
  const beforeData = state.view === 'staff' ? getStaffDataSignature() : '';
  removeReservationFromState(id);
  if (state.selectedRes && state.selectedRes.id === id) {
    closePos();
  }
  save();
  if (state.view === 'staff' && beforeData !== getStaffDataSignature()) renderStaffData();
}

function normalizeStaffCenterId(value, fallback = 'libramont') {
  const raw = String(value || fallback).trim();
  const clean = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!clean) return fallback;
  if (['libramont', 'gembloux', 'ciney'].includes(clean)) return clean;
  if (clean.includes('gembloux')) return 'gembloux';
  if (clean.includes('ciney')) return 'ciney';
  if (
    clean.includes('libramont')
    || clean === 'fun galaxy centre'
    || clean === 'fun galaxy center'
    || clean === 'fungalaxy centre'
    || clean === 'fungalaxy center'
    || clean === 'fun galaxy'
    || clean === 'fungalaxy'
    || clean === 'admin'
    || clean === 'pinlane'
  ) {
    return 'libramont';
  }
  // Tout autre slug bien forme est un centre LEGITIME (deuxieme client et
  // suivants) : il passe tel quel, comme cote serveur (lib/staff-auth.js).
  // Rabattre l'inconnu sur 'libramont' faisait signer les exports et les
  // lectures du staff d'un autre client avec le centre du premier.
  const slug = raw.toLowerCase();
  if (PUBLIC_CENTER_ID_PATTERN.test(slug)) return slug;
  return fallback;
}

// LE CENTRE QUE SERT LE TUNNEL PUBLIC.
//
// embed.js pose `?center=<slug>` sur l'iframe qu'il installe chez le client.
// Personne ne lisait ce parametre : tout retombait sur normalizeStaffCenterId,
// qui ne connait que les trois centres Fun Galaxy et rabat tout le reste sur
// 'libramont'. Un deuxieme client colle la ligne d'installation et reserve chez
// Fun Galaxy.
//
// On lit donc le slug de l'URL, borne exactement comme le serveur
// (CENTER_ID_PATTERN, lib/center-config.js). Aucune liste blanche ici : le
// serveur reste seul juge de l'existence du centre, sinon on recree le meme
// mur pour le troisieme client. Slug absent ou mal forme = comportement
// historique (le centre de la session staff).
const PUBLIC_CENTER_ID_PATTERN = /^[a-z][a-z0-9-]{1,40}$/;
let publicCenterIdFromUrl;
function getUrlCenterId() {
  if (publicCenterIdFromUrl !== undefined) return publicCenterIdFromUrl;
  publicCenterIdFromUrl = '';
  try {
    // L'ADRESSE PAR CENTRE d'abord (2026-08-18) : « /reserver/libramont »
    // est la page personnelle du centre, generee par le seul fait que le
    // centre existe (le slug EST la cle : catalogue, marque, horaires
    // suivent tout seuls via public-booking-meta). La query ?center= reste
    // acceptee : c'est le contrat historique d'embed.js.
    const path = String(window.location.pathname || '').toLowerCase();
    const pathMatch = path.match(/^\/reserver\/([a-z][a-z0-9-]{1,40})\/?$/);
    if (pathMatch && PUBLIC_CENTER_ID_PATTERN.test(pathMatch[1])) {
      publicCenterIdFromUrl = pathMatch[1];
      return publicCenterIdFromUrl;
    }
    const params = new URLSearchParams(window.location.search || '');
    const raw = String(params.get('center') || params.get('centerId') || '').trim().toLowerCase();
    if (PUBLIC_CENTER_ID_PATTERN.test(raw)) publicCenterIdFromUrl = raw;
  } catch (error) {
    publicCenterIdFromUrl = '';
  }
  return publicCenterIdFromUrl;
}

// Le centre du TUNNEL (catalogue, horaires, creneaux, POST de reservation).
// L'URL fait autorite quand elle porte un centre ; sinon on garde le centre de
// la session staff, qui est ce que le tunnel interne utilise.
function getTunnelCenterId() {
  return getUrlCenterId() || getCurrentStaffCenterId();
}

function getCurrentStaffCenterId() {
  const normalized = normalizeStaffCenterId(state?.adminCenterId);
  if (state?.adminCenterId && state.adminCenterId !== normalized) {
    state.adminCenterId = normalized;
    save();
  }
  return normalized;
}

function getStaffSessionToken() {
  if (window.PinlaneStaffAuthSession?.getToken) {
    const token = window.PinlaneStaffAuthSession.getToken(state?.staffAuthSession);
    if (token) return token;
  }
  const session = state?.staffAuthSession;
  if (session?.cookieBacked) return '';
  if (session?.token && (!session.expiresAt || new Date(session.expiresAt).getTime() > Date.now())) {
    return session.token;
  }
  try {
    const parsed = window.PinlaneStorage?.getJson
      ? window.PinlaneStorage.getJson(AUTH_KEY, null)
      : JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
    if (!parsed?.token) return '';
    if (parsed.expiresAt && new Date(parsed.expiresAt).getTime() <= Date.now()) return '';
    return parsed.token;
  } catch (error) {
    return '';
  }
}

function isProtectedStaffApi(url = '') {
  if (window.PinlaneApiClient?.isProtectedStaffApi) {
    return window.PinlaneApiClient.isProtectedStaffApi(url);
  }
  const value = String(url || '');
  return [
    API_ENDPOINTS.staffAuth,
    API_ENDPOINTS.staffReservations,
    API_ENDPOINTS.staffState,
    API_ENDPOINTS.staffLanes,
    API_ENDPOINTS.adminRange,
    API_ENDPOINTS.ops,
    API_ENDPOINTS.simulation,
    API_ENDPOINTS.marketingAgents
  ].some(endpoint => endpoint && value.includes(endpoint));
}

function staffAuthHeaders(headers = {}) {
  const token = getStaffSessionToken();
  if (window.PinlaneApiClient?.staffAuthHeaders) {
    return window.PinlaneApiClient.staffAuthHeaders(headers, token);
  }
  return token ? { ...headers, 'X-Staff-Session': token } : headers;
}

async function apiRequest(url, options = {}) {
  if (window.PinlaneApiClient?.request) {
    return window.PinlaneApiClient.request(url, options, {
      getSessionToken: getStaffSessionToken,
      onUnauthorized: () => {
        if (typeof clearStaffAuthSession === 'function') clearStaffAuthSession();
        if (typeof applyAuthState === 'function') applyAuthState();
      },
      origin: window.location.origin
    });
  }
  const requestUrl = typeof url === 'string' && url.startsWith('/')
    ? `${window.location.origin}${url}`
    : url;
  const baseHeaders = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  const headers = isProtectedStaffApi(url) ? staffAuthHeaders(baseHeaders) : baseHeaders;
  const response = await fetch(requestUrl, {
    ...options,
    cache: 'no-store',
    credentials: 'same-origin',
    headers
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    if (response.status === 401 && isProtectedStaffApi(url) && typeof clearStaffAuthSession === 'function') {
      clearStaffAuthSession();
      if (typeof applyAuthState === 'function') applyAuthState();
    }
    const error = new Error(payload.message || 'Erreur serveur.');
    error.payload = payload;
    error.status = response.status;
    error.url = requestUrl;
    throw error;
  }
  return payload;
}

// ── Telemetrie d'erreurs console (staff uniquement) ─────────────────────────
// Quand une erreur JS non rattrapee frappe la console d'un membre du staff,
// elle part vers logClientError : le fondateur la voit dans Plateforme >
// Incidents AVANT qu'on la lui signale. Contraintes non negociables :
// jamais de reentrance (une erreur du rapporteur ne se rapporte pas), dedupe
// locale, plafond par session d'onglet, et echec toujours silencieux.
const CLIENT_ERROR_REPORT = { seen: new Set(), sent: 0, max: 10, busy: false };
function reportClientError(payload) {
  if (CLIENT_ERROR_REPORT.busy || CLIENT_ERROR_REPORT.sent >= CLIENT_ERROR_REPORT.max) return;
  if (typeof getStaffSessionToken !== 'function' || !getStaffSessionToken()) return;
  const message = String(payload.message || '').slice(0, 500);
  if (!message) return;
  const key = `${message}|${payload.source || ''}|${payload.lineno || 0}`;
  if (CLIENT_ERROR_REPORT.seen.has(key)) return;
  CLIENT_ERROR_REPORT.seen.add(key);
  CLIENT_ERROR_REPORT.sent += 1;
  CLIENT_ERROR_REPORT.busy = true;
  try {
    apiRequest('/api/ops?action=logClientError', {
      method: 'POST',
      body: JSON.stringify({
        action: 'logClientError',
        page: typeof getStaffMenuPage === 'function' ? getStaffMenuPage() : '',
        message,
        source: String(payload.source || '').slice(0, 300),
        lineno: Number(payload.lineno) || 0,
        colno: Number(payload.colno) || 0,
        stack: String(payload.stack || '').slice(0, 2000),
      }),
    }).catch(() => {}).finally(() => { CLIENT_ERROR_REPORT.busy = false; });
  } catch (error) {
    CLIENT_ERROR_REPORT.busy = false;
  }
}
window.addEventListener('error', (event) => {
  reportClientError({
    message: event.message,
    source: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    stack: event.error && event.error.stack,
  });
});
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  reportClientError({
    message: (reason && reason.message) || String(reason || 'promesse rejetee'),
    source: 'unhandledrejection',
    stack: reason && reason.stack,
  });
});

function getRemoteSyncBaseDelay() {
  // Cadence de synchro serveur. Volontairement modérée : chaque tick interroge
  // la base (staff-state). À 1,2 s on générait ~72k requêtes/jour/onglet et on
  // saturait le quota de transfert Neon. 4 s reste largement temps réel pour un
  // planning (les requêtes conditionnelles renvoient 304 quasi vide si rien n'a
  // changé), tout en divisant la charge par ~3.
  if (state.view === 'staff') return 4000;
  if (state.view === 'admin') return 20000;
  return 20000;
}

function getRemoteSyncDelay() {
  const baseDelay = getRemoteSyncBaseDelay();
  const pauseRemaining = Math.max(0, remoteSyncPausedUntil - Date.now());
  if (pauseRemaining) return Math.max(baseDelay, pauseRemaining);
  if (!remoteSyncFailureCount) return baseDelay;
  return Math.min(60000, baseDelay * Math.pow(2, Math.min(remoteSyncFailureCount, 5)));
}

function getRemoteSyncErrorMessage(error) {
  return String(error?.message || error?.status || 'remote-sync-error');
}

function isStaticApiFailure(error) {
  const message = getRemoteSyncErrorMessage(error).toLowerCase();
  return Number(error?.status) === 404 || message.includes('file not found') || message.includes('not found');
}

function markRemoteSyncSuccess() {
  remoteSyncFailureCount = 0;
  remoteSyncPausedUntil = 0;
  remoteSyncLastFailure = '';
  remoteSyncDownSince = 0;
  updateRemoteSyncIndicator();
}

function markRemoteSyncFailure(error) {
  remoteSyncFailureCount += 1;
  remoteSyncLastFailure = getRemoteSyncErrorMessage(error);
  if (!remoteSyncDownSince) remoteSyncDownSince = Date.now();
  updateRemoteSyncIndicator();
  if (isStaticApiFailure(error)) {
    remoteSyncPausedUntil = Date.now() + 5 * 60 * 1000;
    return;
  }
  if (remoteSyncFailureCount >= 3) {
    remoteSyncPausedUntil = Date.now() + Math.min(2 * 60 * 1000, 15000 * remoteSyncFailureCount);
  }
}

// Signal de panne du poll temps réel (pill du dashboard staff) : dégradé
// discret dès 2 échecs consécutifs, données déclarées périmées dès 6 échecs
// (le backoff espace alors les tentatives), retour auto au vert au succès.
function getRemoteSyncIndicator() {
  if (remoteSyncFailureCount >= 6) {
    const since = new Date(remoteSyncDownSince || Date.now()).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
    return { tone: 'stale', label: `Données périmées depuis ${since}` };
  }
  if (remoteSyncFailureCount >= 2) return { tone: 'warning', label: 'Reconnexion…' };
  return { tone: 'live', label: 'Données en temps réel' };
}

function updateRemoteSyncIndicator() {
  const dot = document.querySelector('.dash-live-dot');
  if (!dot) return;
  const indicator = getRemoteSyncIndicator();
  dot.classList.toggle('warning', indicator.tone === 'warning');
  dot.classList.toggle('stale', indicator.tone === 'stale');
  const label = dot.nextElementSibling;
  if (label) label.textContent = indicator.label;
}

function escapeHtml(value = '') {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function escapeJsString(value = '') {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r?\n/g, ' ');
}

function formatOpsTimestamp(value) {
  if (!value) return 'Non planifié';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Non planifié';
  return date.toLocaleString('fr-BE', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function getOpsTemplateLabel(templateId = '') {
  const id = String(templateId || '');
  // Les 13 modèles réellement envoyés en prod. Sans entrée ici, la colonne
  // « Modèle » affichait l'identifiant technique brut (`delay_staff_attention`)
  // à la directrice.
  const labels = {
    request_received: 'Demande reçue',
    confirmation: 'Confirmation client',
    reminder_48h: 'Rappel avant la venue',
    reminder_day_sms: 'Rappel SMS du jour',
    post_visit_followup: 'Merci post-visite',
    // « J-30 » est du jargon de marketeur : illisible pour une gerante, et il
    // s'affiche dans la colonne « Modele » de la file, sur l'ecran Emails.
    birthday_j30: 'Rappel anniversaire',
    reactivation: 'Réactivation dormants',
    relance_dormant: 'Relance client',
    staff_review_request: 'Validation staff',
    staff_alert: 'Alerte staff',
    delay_staff_attention: 'Retard : décision staff',
    delay_update: 'Ajustement horaire client',
    delay_change: 'Changement annoncé au client',
    client_thanks: 'Remerciement client',
    campaign_1: 'Campagne',
    studio_direct: 'Message direct',
    inbound_email: 'Mail reçu'
  };
  if (labels[id]) return labels[id];
  // Envois de test du staff : `test_<séquence>`.
  if (id.startsWith('test_')) return `Test : ${labels[id.slice(5)] || id.slice(5)}`;
  // Familles à suffixe variable : sans ces retombées, la colonne « Modèle »
  // montrait l'identifiant technique brut (`campaign_3`, `client_confirmation`)
  // à la directrice, surtout visible depuis la vue « Envois manuels ».
  if (id.startsWith('campaign_')) return 'Campagne';
  if (id.startsWith('studio_')) return 'Message direct';
  if (id.startsWith('relance_')) return 'Relance client';
  if (id.startsWith('client_')) return 'Message client';
  if (id.startsWith('custom_')) return 'Séquence personnalisée';
  return id || 'Message';
}

/* ── Pourquoi un mail n'est pas parti, en français ─────────────────────────
   `last_error` est le message brut du fournisseur, en anglais et écrit pour un
   développeur. Tel quel, il ne dit pas à la directrice ce qu'elle doit FAIRE.
   Chaque entrée traduit la cause ET donne le geste de réparation. Le message
   brut reste affiché en dessous : on traduit, on ne cache pas.
   ─────────────────────────────────────────────────────────────────────── */
const STAFF_EMAIL_FAILURE_RULES = [
  {
    match: /only send testing emails to your own email address|verify a domain/i,
    label: 'Domaine d\'envoi pas encore vérifié',
    fix: 'Le compte d\'envoi est en mode test : il n\'accepte que l\'adresse du propriétaire du compte. Tant que le domaine du centre n\'est pas vérifié chez le fournisseur, aucun mail ne peut partir vers un client.'
  },
  {
    match: /invalid `?to`? field|invalid recipient|no recipients|destinataire manquant/i,
    label: 'Adresse email du client invalide',
    fix: 'L\'adresse enregistrée sur la réservation n\'est pas une adresse valide (faute de frappe, champ vide). Corrigez-la sur la fiche client, puis renvoyez.'
  },
  {
    match: /rate limit|too many requests|429/i,
    label: 'Trop d\'envois d\'un coup',
    fix: 'Le fournisseur a bridé le rythme d\'envoi. Les mails repartent d\'eux-mêmes un peu plus tard ; vous pouvez aussi renvoyer manuellement.'
  },
  {
    match: /api[_ ]?key|unauthorized|401|403|forbidden/i,
    label: 'Clé d\'envoi refusée',
    fix: 'La clé du service d\'envoi est absente, expirée ou révoquée. C\'est un réglage technique : rien ne partira tant qu\'elle n\'est pas remise en place.'
  },
  {
    match: /bounce|mailbox (not found|unavailable)|does not exist|550/i,
    label: 'Boîte du client inexistante',
    fix: 'Le serveur du client a refusé le message : l\'adresse n\'existe plus. Demandez la bonne adresse avant de renvoyer.'
  },
  {
    match: /timeout|ETIMEDOUT|ECONNRESET|ENOTFOUND|network|fetch failed/i,
    label: 'Le service d\'envoi n\'a pas répondu',
    fix: 'Incident réseau passager côté fournisseur. Un renvoi suffit en général.'
  },
  {
    match: /configuration|manquant|non configur/i,
    label: 'Canal pas configuré',
    fix: 'Le canal (email ou SMS) n\'a pas de configuration valide sur ce centre.'
  }
];

function getStaffEmailFailureReason(row = {}) {
  const raw = String(row.lastError || '').trim();
  if (!raw) {
    return { label: 'Cause inconnue', fix: 'Le fournisseur n\'a pas donné de raison. Renvoyez le message : si l\'échec se répète, la cause sera enregistrée.', raw: '' };
  }
  const rule = STAFF_EMAIL_FAILURE_RULES.find(entry => entry.match.test(raw));
  if (rule) return { label: rule.label, fix: rule.fix, raw };
  return { label: 'Échec d\'envoi', fix: 'Message renvoyé par le service d\'envoi, texte d\'origine ci-dessous.', raw };
}

// Échecs regroupés par cause, la plus fréquente d'abord. Agrégé côté client sur
// les lignes déjà chargées : aucune requête ni permission supplémentaire.
function getStaffEmailFailureGroups(rows = []) {
  const groups = new Map();
  rows.filter(row => row.statusKind === 'failed').forEach(row => {
    const reason = getStaffEmailFailureReason(row);
    const entry = groups.get(reason.label) || { label: reason.label, fix: reason.fix, count: 0, raw: reason.raw };
    entry.count += 1;
    groups.set(reason.label, entry);
  });
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

// Liste des centres SCOPEE au tenant (action ops=menuCenters, filtree serveur).
// C'est la SOURCE de verite du switcher de centre et des cartes centre : un
// client n'y voit que ses centres, le proprietaire (owner=true) tous les
// centres avec clientId/clientName pour les grouper. Tant qu'elle n'est pas
// chargee, on retombe sur knowledge.centers (deja scope serveur) puis sur les
// replis statiques : aucune de ces sources ne provient d'un autre tenant.
let scopedCentersCache = { loaded: false, loading: false, error: '', centers: [], owner: false };

async function loadMenuCenters(force = false) {
  if (scopedCentersCache.loading) return;
  if (scopedCentersCache.loaded && !force) return;
  if (!hasSavedAuth()) return;
  scopedCentersCache.loading = true;
  try {
    const response = await apiRequest(`${API_ENDPOINTS.ops}?action=menuCenters`);
    scopedCentersCache = {
      loaded: true,
      loading: false,
      error: '',
      centers: Array.isArray(response.centers) ? response.centers : [],
      owner: !!response.owner
    };
    if (typeof window.renderStaffMenu === 'function') window.renderStaffMenu();
  } catch (error) {
    scopedCentersCache.loading = false;
    scopedCentersCache.error = error?.message || 'Lecture des centres impossible.';
  }
}
if (typeof window !== 'undefined') window.loadMenuCenters = loadMenuCenters;

function getScopedCenters() {
  return scopedCentersCache.loaded && scopedCentersCache.centers.length ? scopedCentersCache.centers : null;
}

function isCenterScopeOwner() {
  return !!scopedCentersCache.owner;
}

function getAdminCenters() {
  // Repli statique = SEULEMENT le centre courant de la session (jamais la liste
  // codee en dur des 3 centres Fun Galaxy). Fun Galaxy y retrouve son centre
  // avec ses ressources ; un autre tenant obtient une liste vide plutot que les
  // noms Fun Galaxy en flash avant que la liste scopee serveur reponde.
  return getScopedCenters()
    || (adminDashboardCache.knowledge?.centers?.length
      ? adminDashboardCache.knowledge.centers
      : ADMIN_CENTER_FALLBACKS.filter(center => center.id === state.adminCenterId));
}

function getAdminCenter(centerId = state.adminCenterId) {
  // Repli NEUTRE pour un centre inconnu de toute liste : jamais la fiche du
  // premier client (un centre X recevait le nom et les ressources de Fun
  // Galaxy Libramont le temps que sa liste scopee reponde).
  return getAdminCenters().find(center => center.id === centerId)
    || ADMIN_CENTER_FALLBACKS.find(center => center.id === centerId)
    || { id: centerId || '', name: '', status: 'active', resources: {} };
}

// Le NOM du centre courant pour les surfaces staff (objets d'email, exports).
// Vide tant qu'aucune liste ne l'a donne : un libelle neutre vaut mieux que
// le nom d'un autre client.
function getCurrentStaffCenterName() {
  const center = getAdminCenter();
  return String((center && center.name) || '').trim();
}

function getActiveOpsCenterId() {
  return state.adminCenterId || 'libramont';
}

function formatMoney(value) {
  const amount = Math.round(Number(value) || 0);
  return `${new Intl.NumberFormat('fr-BE', { maximumFractionDigits: 0 }).format(amount)} €`;
}

function formatAdminPercent(value) {
  const safe = Number.isFinite(Number(value)) ? Number(value) : 0;
  return `${Math.max(0, Math.round(safe))}%`;
}

function startOfWeek(dateStr) {
  const d = parseLocalDate(dateStr);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return toLocalDateStr(d);
}

function startOfMonth(dateStr) {
  const d = parseLocalDate(dateStr);
  d.setDate(1);
  return toLocalDateStr(d);
}

function endOfMonth(dateStr) {
  const d = parseLocalDate(dateStr);
  d.setMonth(d.getMonth() + 1, 0);
  return toLocalDateStr(d);
}

function startOfYear(dateStr) {
  const d = parseLocalDate(dateStr);
  d.setMonth(0, 1);
  return toLocalDateStr(d);
}

function endOfYear(dateStr) {
  const d = parseLocalDate(dateStr);
  d.setMonth(11, 31);
  return toLocalDateStr(d);
}

function getDateRangeDays(startDate, endDate) {
  const days = [];
  let cursor = startDate;
  while (cursor <= endDate && days.length < 370) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

// Direction/admin console renderers live in ./assets/admin-console.js.
// Ops communications, agent stack and simulation renderers live in ./assets/ops-console.js.
async function syncDateReservations(dateStr, opts = {}) {
  if (!dateStr || remoteSyncBusy) return false;
  // Le parcours public n'a pas de session staff : staff-state repondrait 401
  // (vu en prod au changement de date du tunnel). Meme regle que la boucle de
  // sync (plus bas) : en vue client sans session, on ne demande rien.
  if (state.view === 'client' && !hasSavedAuth()) return false;
  remoteSyncBusy = true;
  try {
    const beforeData = state.view === 'staff' && state.currentDate === dateStr ? getStaffDataSignature(dateStr) : '';
    const centerId = encodeURIComponent(getCurrentStaffCenterId());
    const revisionKey = `${centerId}:${dateStr}`;
    const knownRevision = staffRevisionByDate[revisionKey];
    const syncHeaders = staffAuthHeaders(knownRevision ? { 'If-None-Match': knownRevision } : {});
    const response = await fetch(`${API_ENDPOINTS.staffState}?date=${encodeURIComponent(dateStr)}&centerId=${centerId}`, {
      cache: 'no-store',
      headers: syncHeaders
    });
    if (response.status === 304) {
      staffSyncAtByDate[revisionKey] = Date.now();
      markRemoteSyncSuccess();
      return false;
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      const error = new Error(payload.message || 'Erreur serveur.');
      error.status = response.status;
      throw error;
    }
    const nextRevision = response.headers.get('ETag') || payload.revision || '';
    const changed = nextRevision !== knownRevision;
    // Baseline connu (pas le 1er sync) + IDs déjà en mémoire AVANT remplacement :
    // sert à repérer les résas réellement nouvelles venues du serveur.
    const hadBaseline = Boolean(knownRevision);
    const beforeResIds = new Set(state.reservations.filter(r => r.date === dateStr).map(r => r.id));
    staffRevisionByDate[revisionKey] = nextRevision;
    staffSyncAtByDate[revisionKey] = Date.now();
    replaceReservationsForDate(dateStr, payload.reservations || []);
    if (payload.laneStatuses) state.laneStatuses = payload.laneStatuses;
    if (payload.laneMaintenance) state.laneMaintenance = payload.laneMaintenance;
    // Classification client/groupe du centre (seuils groupe + formules annif),
    // servie par le poll : pilote isGroup/hasBirthday/tiers côté Clients & Groupes.
    if (payload.classification) state.staffClassification = payload.classification;
    hydrateSelectedReservation();
    save();
    if (!opts.skipRender && changed && state.view === 'staff' && state.currentDate === dateStr) {
      const afterData = getStaffDataSignature(dateStr);
      if (beforeData !== afterData) renderStaffData();
    }
    // Notif + son pour toute NOUVELLE réservation du jour même reçue du serveur
    // (site public / autre poste). Les créations locales sont déjà dans l'état
    // avant le poll → jamais notifiées ici. Skip au 1er sync (baseline).
    if (changed && hadBaseline && state.view === 'staff' && dateStr === todayStr()) {
      const arrivees = (payload.reservations || [])
        .filter(r => r && !beforeResIds.has(r.id) && r.status !== 'cancelled' && r.status !== 'rejected');
      // On MARQUE avant de re-rendre : sinon la ligne et le bloc du planning se
      // dessinent sans leur signal et l'arrivee passe inapercue jusqu'au poll
      // suivant.
      if (arrivees.length && typeof PinlaneMotion !== 'undefined') {
        PinlaneMotion.marquerNeuves(arrivees.map(r => r.id));
        if (state.currentDate === dateStr && !opts.skipRender) renderStaffData();
      }
      arrivees.forEach(r => notifyNewReservation(r));
    }
    markRemoteSyncSuccess();
    return changed;
  } catch (error) {
    markRemoteSyncFailure(error);
    if (!opts.silent) toast(error.message || 'Synchronisation impossible.');
    return false;
  } finally {
    remoteSyncBusy = false;
  }
}

function scheduleRemoteSync() {
  clearTimeout(remoteSyncTimer);
  const delay = getRemoteSyncDelay();
  remoteSyncTimer = setTimeout(async () => {
    if (remoteSyncPausedUntil && Date.now() < remoteSyncPausedUntil) {
      scheduleRemoteSync();
      return;
    }
    // Onglet caché : on ne consomme AUCUN data transfer Neon (le timer reste armé
    // mais ne fait pas d'aller-retour). Au retour, le handler visibilitychange
    // déclenche un fetch différentiel immédiat (If-None-Match => 304 vide si RAS).
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      scheduleRemoteSync();
      return;
    }
    // Le mode client (parcours public) n'a pas de session staff : il ne doit
    // PAS interroger les endpoints protégés (staff-state → 401). Ses créneaux
    // sont chargés à la demande via public-availability. On arrête donc la
    // boucle de sync ; setView() la relance quand on passe en staff/admin.
    if (state.view === 'client') return;
    if ((state.view === 'staff' || state.view === 'admin') && !hasSavedAuth()) {
      scheduleRemoteSync();
      return;
    }
    // C14 : la console peut être en cours d'injection au premier tick admin.
    if (state.view === 'admin') { if (typeof loadAdminDashboard === 'function') await loadAdminDashboard(true); }
    else await syncDateReservations(state.currentDate, { silent: true });
    scheduleRemoteSync();
  }, delay);
}

function loadState() {
  try {
    const storedState = window.PinlaneStorage?.getJson
      ? window.PinlaneStorage.getJson(STORAGE_KEY, null)
      : JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (storedState) {
      // Les collections du serveur repartent VIDES a chaque chargement, meme si
      // une ancienne version les avait ecrites dans ce navigateur : c'est la
      // migration des postes deja ouverts. Le premier poll (immediat) les
      // remplit avec ce que le serveur confirme, et rien d'autre.
      return {
        ...storedState,
        reservations: [],
        laneStatuses: Array.from({ length: TOTAL_LANES }).reduce((acc, unused, index) => ({ ...acc, [index + 1]: 'active' }), {}),
      };
    }
  } catch (error) {}
  const today = todayStr();
  return {
    view: 'client',
    // AUCUNE reservation par defaut. Quatre lignes de demonstration etaient
    // ecrites en dur ici (« Sophie Renard », « Marc Dubois »…) : sur un poste
    // neuf, ou apres un vidage du navigateur, le planning affichait des clients
    // qui n'existent pas - et ils restaient a l'ecran si le serveur ne repondait
    // pas. Une console de gestion ne montre que ce que le serveur a confirme.
    reservations: [],
    laneStatuses: Array.from({ length: TOTAL_LANES }).reduce((acc, _, i) => ({ ...acc, [i + 1]: 'active' }), {}),
    isHolidayMode: false,
    currentDate: today,
    searchTerm: '',
    step: 1,
    booking: {
      name:'', phone:'', email:'', pax:4,
      date: today,
      type:'bowling', formuleId:'', duration:1, totalDuration:1, laneCount:1, startTime:'',
      // Mode de composition + activites cochees. Le bowling coche par defaut :
      // le formulaire s'ouvre exactement comme avant, sur un bowling d'une heure.
      mode: 'carte',
      activities: { bowling: { duration: 1 } },
      allocatedLanes: [],
      // Programme normalise par public-availability. Il porte le prix serveur
      // affiche au recap final ; le POST sera malgre tout recalcule a nouveau.
      serverProgram: null,
      preference: createDefaultFormulaPreference(),
      pauseMinutes: 0,
      opsPlan: null
    },
    selectedRes: null,
    activeTab: 'details',
    editState: null,
    availableSlots: [],
    staffPlanningExpanded: false,
    staffLaserPlanningExpanded: false,
    staffResourceView: 'bowling',
    staffStatusFilter: 'all',
    staffTheme: 'dark',
    opsPanelTab: 'activity',
    adminCenterId: 'libramont',
    adminDate: today,
    adminPeriod: 'day',
    adminTab: 'overview',
    adminCockpitMode: 'today',
    staffPricingFilter: 'all',
    staffPricingQuery: '',
    staffPricingSelectedId: '',
    staffEmailFilter: 'all',
    staffEmailOriginFilter: 'all',
    staffEmailQuery: '',
    staffEmailTemplateFilter: 'all',
    staffEmailSelectedId: '',
    staffMenuCollapsed: false,
    staffMenuPage: 'planning',
    staffGroupQuery: '',
    staffGroupType: 'all',
    staffGroupStatus: 'all',
    staffGroupDate: 'upcoming',
    staffGroupSize: 'all',
    staffGroupTab: 'all'
  };
}

let state = loadState();
let quickBookState = null;
let isAuthenticated = false;
let slotFetchRequestId = 0;
let slotLoading = false;
// P3-9 : distingue « panne serveur » (message + Réessayer) de « aucun créneau »
// (suggestion de changer de date). Posé par fetchSlots, lu par renderSlots.
let slotLoadFailed = false;
let slotLoadFailedMessage = '';
let bookingSubmitBusy = false;
const STAFF_MENU_PAGES = [
  'dashboard',
  'planning',
  'reservations',
  'formules',
  'sessions',
  'arrivals',
  'events',
  'clients',
  'groups',
  'contacts',
  'lanes',
  'prices',
  'laserGame',
  'emails',
  'campaigns',
  'establishment',
  'users',
  'settings',
  'cockpit',
  'cockpit-clients-platform',
  'cockpit-centres',
  'cockpit-agents',
  'cockpit-incidents',
  'cockpit-journal',
  'cockpit-ia',
  'cockpit-clients'
];
function normalizeStaffMenuPage(page) {
  const key = String(page || 'planning').trim();
  return STAFF_MENU_PAGES.includes(key) ? key : 'planning';
}
state.staffPlanningExpanded = !!state.staffPlanningExpanded;
state.staffLaserPlanningExpanded = !!state.staffLaserPlanningExpanded;
state.staffResourceView = ['all', 'bowling', 'laser'].includes(state.staffResourceView) ? state.staffResourceView : 'bowling';
try {
  const staffViewMigrationKey = `${STORAGE_KEY}:staff-resource-view-bowling-v4`;
  if (window.PinlaneStorage?.ensureMarker) {
    window.PinlaneStorage.ensureMarker(staffViewMigrationKey, () => {
      state.staffResourceView = 'bowling';
      save();
    });
  } else if (!localStorage.getItem(staffViewMigrationKey)) {
    state.staffResourceView = 'bowling';
    save();
    localStorage.setItem(staffViewMigrationKey, '1');
  }
} catch (error) {}
state.staffStatusFilter = state.staffStatusFilter || 'all';
state.staffTheme = state.staffTheme === 'light' ? 'light' : 'dark';
state.opsPanelTab = state.opsPanelTab || 'activity';
state.adminCenterId = state.adminCenterId || 'libramont';
state.adminDate = state.adminDate || todayStr();
state.adminPeriod = ['day', 'week', 'month', 'year'].includes(state.adminPeriod) ? state.adminPeriod : 'day';
state.adminTab = state.adminTab || 'overview';
state.adminCockpitMode = ['today', 'bowling', 'laser', 'direction'].includes(state.adminCockpitMode) ? state.adminCockpitMode : 'today';
state.staffMenuPage = normalizeStaffMenuPage(state.staffMenuPage);
// CRM v4 (fusion Clients + Groupes, KISS) : 4 segments simples remplacent les
// familles de facettes et le tri custom. Anciennes clés nettoyées.
state.staffClientSegment = ['tous', 'avenir', 'relancer', 'vip'].includes(state.staffClientSegment) ? state.staffClientSegment : 'tous';
delete state.staffClientFilters;
delete state.staffClientFiltersOpen;
delete state.staffClientSortOpen;
delete state.staffClientStatusFilter;
delete state.staffClientQuickSort;
if (!state.staffClientSort || typeof state.staffClientSort !== 'object' || !state.staffClientSort.key) {
  state.staffClientSort = { key: 'lastDate', dir: 'desc' };
}
state.staffClientQuery = state.staffClientQuery || '';
state.staffSelectedClientId = state.staffSelectedClientId || '';
state.staffClientCompact = !!state.staffClientCompact;
state.staffGroupQuery = state.staffGroupQuery || '';
state.staffGroupType = ['all', 'bowling', 'laser', 'complete', 'formule'].includes(state.staffGroupType) ? state.staffGroupType : 'all';
state.staffGroupStatus = ['all', 'pending', 'confirmed', 'arrived', 'paid'].includes(state.staffGroupStatus) ? state.staffGroupStatus : 'all';
state.staffGroupDate = ['upcoming', 'today', 'week', 'all'].includes(state.staffGroupDate) ? state.staffGroupDate : 'upcoming';
state.staffGroupSize = ['all', 'small', 'medium', 'large', 'xl'].includes(state.staffGroupSize) ? state.staffGroupSize : 'all';
state.staffGroupTab = ['all', 'birthdays', 'regular', 'business', 'followup'].includes(state.staffGroupTab) ? state.staffGroupTab : 'all';
state.staffReservationsMonth = /^\d{4}-\d{2}$/.test(state.staffReservationsMonth || '') ? state.staffReservationsMonth : getMonthKey(state.currentDate || todayStr());
state.staffReservationActivityFilter = ['all', 'bowling', 'laser', 'complete', 'event'].includes(state.staffReservationActivityFilter) ? state.staffReservationActivityFilter : 'all';
state.staffReservationsSelectedDate = state.staffReservationsSelectedDate || state.currentDate || todayStr();
state.staffReservationsPreset = ['today', 'month'].includes(state.staffReservationsPreset) ? state.staffReservationsPreset : 'month';
state.staffPricingFilter = ['all', 'bowling', 'laser', 'formula', 'special'].includes(state.staffPricingFilter) ? state.staffPricingFilter : 'all';
state.staffPricingQuery = state.staffPricingQuery || '';
state.staffPricingSelectedId = state.staffPricingSelectedId || '';
state.staffEmailFilter = ['all', 'queued', 'sent', 'failed', 'review'].includes(state.staffEmailFilter) ? state.staffEmailFilter : 'all';
// 'inbound' suit la meme regle que staffEmailFilter (qui retombe sur 'all' au
// boot) : les deux etats voyagent ensemble a l'ecran, ils retombent ensemble.
state.staffEmailOriginFilter = ['all', 'auto', 'manual'].includes(state.staffEmailOriginFilter) ? state.staffEmailOriginFilter : 'all';
state.staffEmailQuery = state.staffEmailQuery || '';
state.staffEmailTemplateFilter = state.staffEmailTemplateFilter || 'all';
state.staffEmailSelectedId = state.staffEmailSelectedId || '';
// L'ancien panneau « campagnes » d'app-main (brouillons par centre codes en
// dur sur l'identite du premier client) a ete supprime avec ses etats
// staffCampaign* : la page Marketing vivante est renderStaffCampaignsPage
// (staff-pages-v2.js), qui lit le moteur marketing-agents par l'API.
state.staffMenuCollapsed = !!state.staffMenuCollapsed;
state.booking = state.booking || {};
state.booking.preference = createDefaultFormulaPreference(state.booking.preference || {});
state.booking.pauseMinutes = Number(state.booking.pauseMinutes || 0);
state.booking.opsPlan = state.booking.opsPlan || null;
// Ce que le SERVEUR possede ne s'ecrit plus dans le navigateur. Le stockage
// local ne garde que des preferences d'affichage (theme, date affichee, filtres,
// brouillon de reservation du client).
//
// Pourquoi : une copie locale des reservations ne sait pas RETIRER une ligne.
// Elle a deja ressuscite des reservations supprimees (journal 2026-07-27,
// entrees 23 et 32 : 24 resas fantomes et 4 956 EUR affiches sur une base vide).
// Tant qu'elle existe, la classe de bug revient. Le poll re-demande la journee
// toutes les 4 s et au retour sur l'onglet : la reprise apres un rechargement se
// compte en centaines de millisecondes.
const SERVER_OWNED_STATE_KEYS = ['reservations', 'laneStatuses'];

function statePersistablePayload() {
  const payload = { ...state };
  SERVER_OWNED_STATE_KEYS.forEach((key) => { delete payload[key]; });
  return payload;
}

function save() {
  const payload = statePersistablePayload();
  if (window.PinlaneStorage?.setJson) {
    window.PinlaneStorage.setJson(STORAGE_KEY, payload);
    return;
  }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(payload)); } catch (error) {}
}
function applyStaffTheme() {
  const isLight = state.staffTheme === 'light';
  document.body.classList.toggle('staff-light', isLight);
  if (state.view === 'staff' || state.view === 'admin') {
    document.documentElement.setAttribute('data-theme', isLight ? 'light' : 'dark');
    try { localStorage.setItem('pinlane-theme', isLight ? 'light' : 'dark'); } catch (error) {}
  }
}
function setStaffTheme(theme) {
  state.staffTheme = theme === 'light' ? 'light' : 'dark';
  applyStaffTheme();
  save();
  if (state.view === 'staff') renderStaff();
}
const STAFF_PAGE_PERMISSION_MAP = {
  dashboard: ['dashboard.view'],
  planning: ['planning.view'],
  reservations: ['reservations.view'],
  formules: ['reservations.view'],
  sessions: ['reservations.view'],
  arrivals: ['reservations.status', 'reservations.view'],
  events: ['reservations.view'],
  clients: ['clients.view'],
  groups: ['clients.view'],
  contacts: ['clients.view'],
  lanes: ['planning.bowling', 'settings.manage'],
  prices: ['pricing.manage'],
  laserGame: ['planning.laser', 'settings.manage'],
  emails: ['emails.view'],
  campaigns: ['campaigns.manage', 'marketing.agents'],
  establishment: ['settings.manage', 'direction.view'],
  users: ['users.manage'],
  settings: ['settings.manage'],
  cockpit: ['platform.admin'],
  'cockpit-clients-platform': ['platform.admin'],
  'cockpit-centres': ['platform.admin'],
  'cockpit-agents': ['platform.admin'],
  'cockpit-incidents': ['platform.admin'],
  // Journal des modifications : outil PLATEFORME (retire de la Direction client
  // le 2026-07-28). Le serveur exige aussi platform.admin sur l'action auditLog.
  'cockpit-journal': ['platform.admin'],
  // Apprentissage de l'IA marketing : meme niveau. L'action serveur
  // aiLearning exige aussi platform.admin, l'UI n'est pas la seule barriere.
  'cockpit-ia': ['platform.admin'],
  'cockpit-clients': ['platform.admin']
};

// Permissions de niveau PLATEFORME : jamais conférées par un rôle verrouillé
// (Direction = tous les droits DU CENTRE, pas ceux de la plateforme). Miroir
// exact de la règle serveur (sessionHasPermission, lib/staff-auth.js) : le
// serveur reste l'autorité, ce Set ne fait que cacher l'entrée de menu aux
// non-porteurs.
const PLATFORM_STAFF_PERMISSIONS = new Set(['platform.admin']);

function normalizeStaffSession(rawSession) {
  if (window.PinlaneStaffAuthSession?.normalize) {
    return window.PinlaneStaffAuthSession.normalize(rawSession, getCurrentStaffCenterId());
  }
  if (!rawSession || typeof rawSession !== 'object') return null;
  const token = rawSession.token || '';
  const cookieBacked = Boolean(rawSession.cookieBacked || !token);
  if (!token && !cookieBacked) return null;
  const expiresAt = rawSession.expiresAt || '';
  if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) return null;
  return {
    token,
    cookieBacked,
    centerId: rawSession.centerId || getCurrentStaffCenterId(),
    expiresAt,
    member: rawSession.member || null,
    role: rawSession.role || null,
    permissions: Array.isArray(rawSession.permissions) ? rawSession.permissions : []
  };
}

function readStoredStaffSession() {
  try {
    const parsed = window.PinlaneStorage?.getJson
      ? window.PinlaneStorage.getJson(AUTH_KEY, null)
      : JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
    return normalizeStaffSession(parsed);
  } catch (error) {
    return null;
  }
}

function storeStaffAuthSession(session) {
  const normalized = normalizeStaffSession(session);
  if (!normalized) return false;
  state.staffAuthSession = normalized;
  state.adminCenterId = normalized.centerId || state.adminCenterId || 'libramont';
  if (window.PinlaneStorage?.setJson) window.PinlaneStorage.setJson(AUTH_KEY, normalized);
  else {
    try { localStorage.setItem(AUTH_KEY, JSON.stringify(normalized)); } catch (error) {}
  }
  isAuthenticated = true;
  return true;
}

function clearStaffAuthSession() {
  state.staffAuthSession = null;
  state.staffAccessControl = null;
  isAuthenticated = false;
  if (window.PinlaneStorage?.remove) window.PinlaneStorage.remove(AUTH_KEY);
  else {
    try { localStorage.removeItem(AUTH_KEY); } catch (error) {}
  }
}

function hasSavedAuth() {
  const session = normalizeStaffSession(state.staffAuthSession) || readStoredStaffSession();
  if (!session) {
    clearStaffAuthSession();
    return false;
  }
  state.staffAuthSession = session;
  isAuthenticated = true;
  return true;
}

function canUseStaffPermission(permission) {
  const session = normalizeStaffSession(state.staffAuthSession) || readStoredStaffSession();
  if (!session) return false;
  const permissions = new Set(session.permissions || []);
  const has = item => {
    if (PLATFORM_STAFF_PERMISSIONS.has(item)) return permissions.has(item);
    if (session.role?.locked) return true;
    return permissions.has(item);
  };
  if (Array.isArray(permission)) return permission.some(has);
  return has(permission);
}

function canUseStaffPage(page) {
  if (!hasSavedAuth()) return false;
  const rawPage = String(page || 'planning').trim();
  const cleanPage = normalizeStaffMenuPage(rawPage);
  if (cleanPage !== rawPage) return false;
  const required = STAFF_PAGE_PERMISSION_MAP[cleanPage];
  if (!required) return false;
  return canUseStaffPermission(required);
}

function getFirstAllowedStaffPage() {
  const candidates = ['dashboard', 'planning', 'reservations', 'arrivals', 'clients', 'emails', 'campaigns', 'users', 'settings'];
  return candidates.find(page => canUseStaffPage(page)) || 'dashboard';
}

function guardStaffPage() {
  if (state.view !== 'staff') return true;
  if (!hasSavedAuth()) return false;
  const page = getStaffMenuPage();
  if (canUseStaffPage(page)) return true;
  const fallback = getFirstAllowedStaffPage();
  state.staffMenuPage = fallback;
  save();
  toast('Accès non autorisé pour ce rôle.');
  return false;
}

async function loadStaffAuthSession(options = {}) {
  try {
    const centerId = encodeURIComponent(getCurrentStaffCenterId());
    const payload = await apiRequest(`${API_ENDPOINTS.staffAuth}?centerId=${centerId}`, {
      method: 'GET',
      headers: staffAuthHeaders()
    });
    if (!payload.authenticated || !payload.session) {
      clearStaffAuthSession();
      return false;
    }
    storeStaffAuthSession(payload.session);
    if (payload.accessControl) state.staffAccessControl = payload.accessControl;
    save();
    // Charge la liste des centres SCOPEE au tenant des que la session est prete,
    // pour que le switcher n'affiche jamais un centre d'un autre client (meme
    // avant l'ouverture de la Direction). Non bloquant.
    loadMenuCenters(true);
    return true;
  } catch (error) {
    if (!options.silent) toast(error.message || 'Session staff invalide.');
    clearStaffAuthSession();
    return false;
  }
}

function applyAuthState() {
  const locked = (state.view === 'staff' || state.view === 'admin') && !hasSavedAuth();
  document.body.classList.toggle('auth-locked', locked);
  const overlay = document.getElementById('authOverlay');
  const logoutBtn = document.getElementById('logoutBtn');
  if (overlay) overlay.classList.toggle('hidden', !locked);
  if (logoutBtn) logoutBtn.classList.toggle('hidden', !hasSavedAuth());
  // A1 : bouton header « Direction » masqué pour un rôle sans direction.view
  // (visible hors session : il mène au login, re-vérifié après connexion).
  const adminBtn = document.getElementById('btnAdmin');
  if (adminBtn) adminBtn.classList.toggle('hidden', !canOpenAdminView());
  // Le menu latéral n'est reconstruit qu'au chargement de page : sans ça, un
  // changement de rôle (directrice → manager) garde les catégories de l'ancien
  // rôle jusqu'à un refresh manuel. On le rebâtit à chaque transition d'auth
  // (login/logout) : reconstruction DOM pure, aucune requête serveur.
  if (typeof window.renderStaffMenu === 'function') window.renderStaffMenu();
  if (!locked) document.body.style.overflow = state.view === 'staff' && (state.staffPlanningExpanded || state.staffLaserPlanningExpanded) ? 'hidden' : '';
}

function openSaasAccess(target = 'staff') {
  if (!getStaffSessionToken() && !state.staffAuthSession?.cookieBacked) clearStaffAuthSession();
  setView(target);
}

function initAuthMotion() {
  const overlay = document.getElementById('authOverlay');
  const card = overlay?.querySelector('.auth-card.auth-card-single');
  if (!overlay || !card || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  let frame = 0;
  let nextEvent = null;
  const resetMotion = () => {
    card.classList.remove('auth-motion-active');
    card.style.setProperty('--auth-tilt-x', '0deg');
    card.style.setProperty('--auth-tilt-y', '0deg');
    card.style.setProperty('--auth-logo-x', '0px');
    card.style.setProperty('--auth-logo-y', '0px');
  };

  overlay.addEventListener('pointermove', event => {
    nextEvent = event;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const rect = card.getBoundingClientRect();
      const px = Math.min(Math.max((nextEvent.clientX - rect.left) / rect.width, 0), 1);
      const py = Math.min(Math.max((nextEvent.clientY - rect.top) / rect.height, 0), 1);
      overlay.style.setProperty('--auth-overlay-x', `${nextEvent.clientX}px`);
      overlay.style.setProperty('--auth-overlay-y', `${nextEvent.clientY}px`);
      card.style.setProperty('--auth-x', `${Math.round(px * 100)}%`);
      card.style.setProperty('--auth-y', `${Math.round(py * 100)}%`);
      card.style.setProperty('--auth-tilt-x', `${((px - .5) * 3.2).toFixed(2)}deg`);
      card.style.setProperty('--auth-tilt-y', `${((.5 - py) * 2.4).toFixed(2)}deg`);
      card.style.setProperty('--auth-logo-x', `${((px - .5) * 5).toFixed(1)}px`);
      card.style.setProperty('--auth-logo-y', `${((py - .5) * 4).toFixed(1)}px`);
      card.classList.add('auth-motion-active');
    });
  });
  overlay.addEventListener('pointerleave', resetMotion);
  overlay.addEventListener('blur', resetMotion, true);
}

initAuthMotion();

function getFriendlyLoginErrorMessage(loginError) {
  const message = String(loginError?.message || '').toLowerCase();
  if (message.includes('data transfer quota') || (message.includes('quota') && message.includes('exceeded'))) {
    return 'Base de donnees temporairement limitee. Reessayez avec le code proprietaire ou relancez apres migration/upgrade.';
  }
  return loginError?.message || 'Code incorrect.';
}

async function submitLogin(ev) {
  ev.preventDefault();
  const error = document.getElementById('authError');
  const submitBtn = ev.target?.querySelector('button[type="submit"]');
  const code = String(document.getElementById('loginPass')?.value || document.getElementById('loginUser')?.value || '').trim();
  if (!code) {
    if (error) error.textContent = 'Entre le code staff.';
    return;
  }
  if (error) error.textContent = '';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Connexion...';
  }
  try {
    const payload = await apiRequest(API_ENDPOINTS.staffAuth, {
      method: 'POST',
      body: JSON.stringify({
        action: 'login',
        centerId: getCurrentStaffCenterId(),
        code
      })
    });
    storeStaffAuthSession(payload.session);
    if (payload.accessControl) state.staffAccessControl = payload.accessControl;
    save();
    applyAuthState();
    if (state.view === 'staff') {
      guardStaffPage();
      await syncDateReservations(state.currentDate, { silent: true, skipRender: true });
      renderStaff();
    } else if (state.view === 'admin') {
      // A1 : le rôle fraîchement connecté doit avoir direction.view pour
      // rester sur la console Direction : sinon retour vue staff.
      if (!canOpenAdminView()) {
        setView('staff');
      } else {
        // C14 : les consoles ne sont pas chargées quand la vue admin n'a
        // affiché que l'écran de login : injection avant le premier rendu.
        await ensureAdminConsolesLoaded();
        await loadAdminDashboard(true);
        renderAdminDashboard();
      }
    }
    toast('Connexion Pinlane active.');
  } catch (loginError) {
    clearStaffAuthSession();
    if (error) error.textContent = getFriendlyLoginErrorMessage(loginError);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Se connecter';
    }
  }
}

async function logout() {
  try {
    await apiRequest(API_ENDPOINTS.staffAuth, {
      method: 'POST',
      headers: staffAuthHeaders(),
      body: JSON.stringify({ action: 'logout', centerId: getCurrentStaffCenterId() })
    });
  } catch (error) {}
  clearStaffAuthSession();
  closePos();
  setView('client');
  applyAuthState();
}

function syncOpsSidebar() {
  if (typeof window.syncStaffMenuState === 'function') {
    window.syncStaffMenuState();
  }
  const resource = typeof getStaffResourceView === 'function'
    ? getStaffResourceView()
    : (state.staffResourceView || 'bowling');
  const planningMenuActive = state.view === 'staff' && getStaffMenuPage() === 'planning';
  document.querySelectorAll('[data-ops-view]').forEach(item => {
    item.classList.toggle('active', item.dataset.opsView === state.view);
  });
  document.querySelectorAll('[data-ops-resource]').forEach(item => {
    item.classList.toggle('active', planningMenuActive && item.dataset.opsResource === resource);
  });
}

// A1 : la console Direction exige `direction.view` (même mécanique que
// guardStaffPage). Un rôle connecté sans cette permission est renvoyé sur la
// vue staff ; non connecté, la vue admin reste atteignable pour afficher le
// login (le refus est re-vérifié après connexion dans submitLogin).
function canOpenAdminView() {
  return !hasSavedAuth() || canUseStaffPermission('direction.view');
}

// C14 : admin-console.js (~92 Ko) et ops-console.js (~75 Ko) ne sont plus
// chargés au boot pour tous les profils. Injection dynamique à la première
// ouverture de la vue admin (après le garde canOpenAdminView) et, pour
// ops-console seul, au premier besoin Ops côté staff (page Emails, dashboard,
// réglages). Promesse partagée : une seule balise <script> par fichier.
const ADMIN_CONSOLE_SRC = './assets/admin-console.js?v=20260728c';
const OPS_CONSOLE_SRC = './assets/ops-console.js?v=20260720b';
const ADMIN_DATA_SRC = './assets/admin-data.js?v=20260711m';
const ADMIN_MAIL_SRC = './assets/admin-mail.js?v=20260717f';
const dynamicConsoleScripts = {};

function loadConsoleScriptOnce(src) {
  if (!dynamicConsoleScripts[src]) {
    dynamicConsoleScripts[src] = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => resolve();
      script.onerror = () => {
        delete dynamicConsoleScripts[src];
        script.remove();
        reject(new Error(`Script indisponible : ${src}`));
      };
      document.head.appendChild(script);
    });
  }
  return dynamicConsoleScripts[src];
}

function ensureAdminConsolesLoaded() {
  return Promise.all([
    loadConsoleScriptOnce(ADMIN_CONSOLE_SRC),
    loadConsoleScriptOnce(OPS_CONSOLE_SRC),
    loadConsoleScriptOnce(ADMIN_DATA_SRC),
    loadConsoleScriptOnce(ADMIN_MAIL_SRC)
  ]);
}

function ensureOpsConsoleLoaded() {
  return loadConsoleScriptOnce(OPS_CONSOLE_SRC);
}

// C14 : si l'injection échoue, l'UI statique de #adminView (onclick vers des
// fonctions du bundle absent) serait un piège à ReferenceError : on la laisse
// neutralisée (pointer-events) et on pose un panneau d'erreur avec retry ;
// la promesse rejetée étant purgée du cache, setView('admin') relance une
// vraie injection.
function clearAdminConsoleLoadError() {
  const panel = document.getElementById('adminConsoleLoadError');
  if (panel) panel.remove();
}

function renderAdminConsoleLoadError(adminRoot) {
  if (!adminRoot) {
    toast('Console direction indisponible (script non chargé).');
    return;
  }
  adminRoot.style.pointerEvents = 'none';
  clearAdminConsoleLoadError();
  const panel = document.createElement('div');
  panel.id = 'adminConsoleLoadError';
  panel.className = 'admin-load-error';
  panel.setAttribute('role', 'alert');
  panel.innerHTML = `
    <div>
      <strong>Console direction indisponible</strong>
      <p>Le module n'a pas pu être chargé (connexion instable ?). Vos données ne sont pas affectées.</p>
    </div>
    <button type="button" class="admin-btn" onclick="setView('admin')">Réessayer</button>`;
  adminRoot.prepend(panel);
}

// Point d'entrée unique du besoin Ops côté staff : charge ops-console.js au
// premier appel puis délègue à loadOpsAdmin (définie par le script injecté).
function requestOpsAdminLoad(force = false) {
  ensureOpsConsoleLoaded()
    .then(() => loadOpsAdmin(force))
    .catch(() => toast('Console Ops indisponible (script non chargé).'));
}

// « Envoyer la file » depuis la page Emails staff : même garantie de chargement.
function requestOpsDispatch() {
  ensureOpsConsoleLoaded()
    .then(() => dispatchOpsEmails())
    .catch(() => toast('Console Ops indisponible (script non chargé).'));
}

function setView(v) {
  // Le voile de demarrage (index.html) meurt ici : des qu'une vue est
  // reellement appliquee, il n'a plus de raison d'etre. Premiere ligne, avant
  // tout retour anticipe, sinon un refus d'acces le laisserait colle.
  document.documentElement.removeAttribute('data-boot');
  if (v === 'admin' && !canOpenAdminView()) {
    toast('Accès non autorisé pour ce rôle.');
    v = 'staff';
  }
  const viewChanged = state.view !== v;
  state.view = v;
  // L'URL suit la vue. push seulement quand on CHANGE de vue : le bouton Retour
  // ramene alors a la vue precedente, sans empiler une entree par re-rendu.
  syncViewUrl(v, { push: viewChanged });
  document.body.classList.toggle('client-mode', v === 'client');
  document.body.classList.toggle('staff-mode', v === 'staff' || v === 'admin');
  document.body.classList.toggle('admin-mode', v === 'admin');
  // Les notifs « nouvelle réservation » sont réservées au poste staff : on purge
  // dès qu'on quitte cette vue (jamais rien qui traîne sur le parcours client).
  if (v !== 'staff') clearNewResNotifs();
  document.getElementById('clientView').classList.toggle('hidden', v !== 'client');
  document.getElementById('staffView').classList.toggle('hidden', v !== 'staff');
  document.getElementById('adminView').classList.toggle('hidden', v !== 'admin');
  document.getElementById('btnClient').classList.toggle('active', v === 'client');
  document.getElementById('btnStaff').classList.toggle('active', v === 'staff');
  document.getElementById('btnAdmin').classList.toggle('active', v === 'admin');
  document.getElementById('nav').style.display = v === 'client' ? 'flex' : 'none';
  document.getElementById('clientDemoAccess').classList.toggle('hidden', v !== 'client');
  syncOpsSidebar();
  applyStaffTheme();
  if ((v === 'staff' || v === 'admin') && !hasSavedAuth()) {
    if (v === 'staff') renderStaffShell(todaysReservations());
    applyAuthState();
    scheduleRemoteSync();
    save();
    return;
  }
  if (v === 'staff') {
    guardStaffPage();
    renderStaff();
    syncDateReservations(state.currentDate, { silent: true });
  }
  else if (v === 'admin') {
    if (!state.adminDate) state.adminDate = todayStr();
    document.body.style.overflow = '';
    // C14 : le rendu admin ne démarre qu'une fois les deux consoles injectées
    // (couvre aussi le deep-link #admin/... au boot, qui passe par setView).
    const adminRoot = document.getElementById('adminView');
    clearAdminConsoleLoadError();
    if (adminRoot) adminRoot.style.pointerEvents = 'none';
    ensureAdminConsolesLoaded()
      .then(() => {
        if (adminRoot) adminRoot.style.pointerEvents = '';
        if (state.view !== 'admin') return;
        renderAdminDashboard();
        loadAdminDashboard(false);
      })
      .catch(() => {
        if (state.view !== 'admin') {
          if (adminRoot) adminRoot.style.pointerEvents = '';
          return;
        }
        renderAdminConsoleLoadError(adminRoot);
      });
  }
  else document.body.style.overflow = '';
  scheduleRemoteSync();
  save();
}

function syncRouteFromHash() {
  const before = [
    state.view,
    state.staffMenuPage,
    state.staffResourceView,
    state.adminTab
  ].join('|');
  applyInitialRouteFromHash();
  const after = [
    state.view,
    state.staffMenuPage,
    state.staffResourceView,
    state.adminTab
  ].join('|');
  if (before === after) return;
  closePos();
  closeQuickBook();
  setView(state.view);
  applyAuthState();
}

function initClient() {
  if (isPastBusinessDate(state.booking.date)) state.booking.date = todayStr();
  state.booking.type = normalizeBookingType(state.booking.type);
  if (state.booking.type !== 'formule') state.booking.formuleId = '';
  if (state.booking.type === 'bowling' && !DURATION_OPTIONS.some(option => Number(option.value) === Number(state.booking.duration))) {
    state.booking.duration = 1;
  }
  if (state.booking.type === 'bowling') {
    state.booking.totalDuration = Number(state.booking.duration || 1);
    state.booking.laneCount = getRequiredLaneCount('bowling', state.booking.pax, '');
    state.booking.preference = createDefaultFormulaPreference();
  }
  if (state.booking.type === 'laser' && !LASER_GAME_OPTIONS.some(option => Number(option.value) === Number(state.booking.duration))) {
    state.booking.duration = LASER_GAME_OPTIONS[0].value;
  }
  if (state.booking.type === 'laser') {
    state.booking.totalDuration = Number(state.booking.duration) * getLaserWaveCount(state.booking.pax);
    state.booking.laneCount = 0;
    state.booking.preference = createDefaultFormulaPreference();
  }
  syncBookingTypeUi();
  document.getElementById('fDate').value = state.booking.date;
  document.getElementById('fDate').min = todayStr();
  document.getElementById('fPax').value = state.booking.pax;
  document.getElementById('fDate').addEventListener('change', e => {
    const nextDate = e.target.value;
    if (isPastBusinessDate(nextDate)) {
      state.booking.date = todayStr();
      e.target.value = state.booking.date;
      showAlert('Cette date est déjà passée. Choisissez aujourd’hui ou une date future.');
    } else {
      state.booking.date = nextDate;
    }
    // Le verdict de l'ancienne date ne dit plus rien de la nouvelle : on l'efface
    // AVANT de peindre, sinon un "Fermé" (ou un "Ouvert") de la veille survit.
    if (typeof setCenterDayStatus === 'function') setCenterDayStatus(null);
    clearBookingAlternatives();
    state.booking.formuleId = '';
    state.booking.startTime = '';
    state.booking.totalDuration = state.booking.type === 'laser'
      ? Number(state.booking.duration) * getLaserWaveCount(state.booking.pax)
      : state.booking.duration;
    state.booking.preference = createDefaultFormulaPreference();
    state.booking.pauseMinutes = 0;
    state.booking.opsPlan = null;
    // Verdict du jour demande au serveur AVANT de peindre : updateSchedHint
    // affichera "Vérification des horaires..." tant qu'il n'a pas repondu,
    // jamais un "Ouvert" que la reponse va contredire.
    loadCenterScheduleConfig(state.booking.date);
    updateSchedHint();
    syncBookingTypeUi();
    renderFormules();
    renderFormulaPreferences();
    updatePaxAlert();
    save();
    syncDateReservations(state.booking.date, { silent: true, skipRender: true });
  });
  document.getElementById('fPax').addEventListener('input', e => {
    state.booking.pax = Number(e.target.value) || 1;
    clearBookingAlternatives();
    state.booking.formuleId = '';
    state.booking.startTime = '';
    state.booking.totalDuration = state.booking.type === 'laser'
      ? Number(state.booking.duration) * getLaserWaveCount(state.booking.pax)
      : state.booking.duration;
    state.booking.preference = createDefaultFormulaPreference();
    state.booking.pauseMinutes = 0;
    state.booking.opsPlan = null;
    updatePaxAlert();
    // Le nombre de joueurs entre dans le prix de presque tout : les activites
    // facturees par personne (minigolf, playground), et le bowling dont le
    // nombre de PISTES s'en deduit. Sans ce rafraichissement, le total restait
    // celui du nombre de joueurs precedent, le client voyait un montant qui
    // ne bougeait pas en ajoutant du monde. Le champ « date » appelait deja
    // cette chaine ; le champ « joueurs » ne l'appelait pas.
    syncBookingTypeUi();
    renderFormules();
    renderFormulaPreferences();
    save();
  });
  renderDurations();
  renderLaserOptions();
  updateSchedHint();
  updatePaxAlert();
  renderFormules();
  renderFormulaPreferences();
  bindCardTilt();
  // Demarre TOUJOURS a l'etape 1 (et synchronise le DOM avec state.step) : sinon
  // un state.step persiste (ex. 4) affichait l'etape 4 dans la barre de progression
  // alors que le contenu montrait l'etape 1 -> desynchro visible sur le formulaire.
  // Synchronisation d'ouverture : ni mouvement ni vol de focus, personne n'a
  // encore rien demandé.
  goStep(1, { animate: false, focus: false });
}

// Stepper tactile du nombre de joueurs (boutons +/- mobile). On reste sur le
// champ #fPax comme source de vérité : on modifie sa valeur puis on rejoue son
// listener 'input' existant (pas de duplication de logique de recalcul).
function stepPax(delta) {
  const input = document.getElementById('fPax');
  if (!input) return;
  const min = Number(input.min) || 1;
  const max = Number(input.max) || 120;
  const next = Math.min(max, Math.max(min, (Number(input.value) || min) + delta));
  input.value = String(next);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function renderDurations() {
  const g = document.getElementById('durGrid');
  g.innerHTML = DURATION_OPTIONS.map(o => `
    <button type="button" class="dur-pill ${state.booking.duration === o.value ? 'active' : ''}" onclick="setDuration(${o.value})">
      ${o.label}
      <span class="price">${o.price}€ / piste</span>
    </button>
  `).join('');
}

function setDuration(v) { state.booking.duration = v; state.booking.totalDuration = v; renderDurations(); save(); }

function renderLaserOptions() {
  const grid = document.getElementById('laserGrid');
  if (!grid) return;
  grid.innerHTML = LASER_GAME_OPTIONS.map(option => `
    <button type="button" class="dur-pill laser-pill ${Number(state.booking.duration) === Number(option.value) ? 'active' : ''}" onclick="setLaserDuration(${option.value})">
      ${option.label}
      <span class="price">${option.price}€ / pers</span>
      <small>${option.games * 20} min de jeu + briefing</small>
    </button>
  `).join('');
}

function setLaserDuration(v) {
  state.booking.duration = Number(v);
  state.booking.totalDuration = Number(v) * getLaserWaveCount(state.booking.pax);
  state.booking.startTime = '';
  state.booking.opsPlan = null;
  renderLaserOptions();
  save();
}

// Bloc d'etat du jour. Asymetrie VOULUE : ouvert = une ligne (aucune decision a
// prendre), tout ce qui empeche ou limite une reservation = un bloc borde. C'est
// la forme, pas la nuance de couleur, qui porte l'info a deux metres.
function renderDayStatusBlock(variant, title, copy) {
  const icon = variant === 'is-closed'
    ? '<circle cx="12" cy="12" r="10"/><line x1="8" y1="8" x2="16" y2="16"/><line x1="16" y1="8" x2="8" y2="16"/>'
    : '<circle cx="12" cy="12" r="10"/><path d="M12 8v5"/><path d="M12 16h.01"/>';
  return `<div class="day-status ${variant}">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg>
    <span class="day-status-copy"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(copy)}</span></span>
  </div>`;
}

function formatBookingDateLong(dateStr) {
  try {
    return parseLocalDate(dateStr).toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' });
  } catch (error) { return dateStr; }
}

// '16:00' -> '16h', '16:30' -> '16h30'
function formatClockShort(hhmm) {
  const parts = String(hhmm || '').split(':');
  const h = Number(parts[0]);
  const m = parts[1] || '';
  return Number(m) ? `${h}h${m}` : `${h}h`;
}

function updateSchedHint() {
  // La revelation du programme suit le meme verdict que le badge d'horaires :
  // meme lecture d'etat, au meme moment, quel que soit le chemin de sortie.
  if (typeof syncProgressiveReveal === 'function') syncProgressiveReveal();
  const el = document.getElementById('schedHint');
  if (!el) return;
  const dayStatus = typeof getCenterDayStatusFor === 'function' ? getCenterDayStatusFor(state.booking.date) : null;
  // day.schedule fait foi quand il est la (calcul serveur) : cela supprime la
  // dependance a la grille en dur pour les centres dont defaultSchedule n'est
  // pas encore renseigne.
  const sch = getSchedule(state.booking.date, state.isHolidayMode);
  const context = getSpecialOpeningContext(state.booking.date, state.isHolidayMode);

  if (isPastBusinessDate(state.booking.date)) {
    el.innerHTML = '<span class="closed">Date passée - réservations terminées</span>';
    return;
  }
  if (dayStatus && dayStatus.open === false) {
    const jour = formatBookingDateLong(state.booking.date);
    const titre = dayStatus.closedLabel === 'Fermé exceptionnellement ce jour'
      ? `Fermé exceptionnellement le ${jour}`
      : `Fermé le ${jour}`;
    el.innerHTML = renderDayStatusBlock('is-closed', titre, 'Le centre n’ouvre pas ce jour. Choisissez une autre date.');
    return;
  }
  if (!sch) {
    el.innerHTML = '<span class="closed">Fermé ce jour</span>';
    return;
  }
  // Verdict serveur en vol pour cette date : on ne promet rien tant qu'il n'a
  // pas repondu. Annoncer "Ouvert" puis se dedire une demi-seconde plus tard,
  // c'est exactement le faux "Ouvert" qu'on corrige.
  if (typeof isCenterDayPending === 'function' && isCenterDayPending(state.booking.date)) {
    el.innerHTML = '<span class="sched-checking">Vérification des horaires...</span>';
    return;
  }
  const holiday = context.active && context.label ? `<span class="sched-holiday">${escapeHtml(context.label)}</span>` : '';
  const windows = dayStatus && Array.isArray(dayStatus.closedWindows) ? dayStatus.closedWindows : [];
  if (windows.length) {
    const coupure = windows.map(w => `de ${formatClockShort(w.start)} à ${formatClockShort(w.end)}`).join(' et ');
    el.innerHTML = renderDayStatusBlock(
      'is-partial',
      `Ouvert ${sch.label}, fermé ${coupure}`,
      `Aucune réservation possible ${coupure} ce jour.`
    );
    return;
  }
  // L'HEURE QU'IL EST COMPTE. Le badge lisait l'horaire du jour sans regarder
  // la pendule : a 22h30, un centre ferme depuis 30 min affichait encore
  // « Ouvert 10h - 22h » (Movsar, capture). Sur AUJOURD'HUI, il dit donc ce
  // qui est vrai maintenant ; sur une date future, la plage reste la bonne
  // reponse (« quand est-ce ouvert ce jour-la ? »).
  // UN SEUL cas change la reponse : la journee est FINIE. Avant l'ouverture,
  // la journee est encore devant (on reserve pour 14h a 8h du matin), donc le
  // badge garde sa plage ; c'est APRES l'heure de fermeture qu'annoncer
  // « Ouvert » devient un mensonge (Movsar, capture a 22h passees).
  const isToday = typeof todayStr === 'function' && state.booking.date === todayStr();
  const now = isToday && typeof currentTimeDecimal === 'function' ? currentTimeDecimal() : null;
  if (now != null && Number.isFinite(Number(sch.close)) && now >= Number(sch.close)) {
    el.innerHTML = `<span class="closed">Fermé pour aujourd’hui</span><span class="sched-note">ouvrait ${escapeHtml(sch.label)}</span>${holiday}`;
    return;
  }
  el.innerHTML = `<span class="open">Ouvert ${sch.label}</span>${holiday}`;
}

// --- REVELATION PROGRESSIVE DE L'ETAPE 1 (2026-08-18, demande Movsar) -------
// D'abord la venue seule ; le PROGRAMME s'ouvre quand la date tient (jour
// ouvert) ; le RESUME (total) s'ouvre des qu'un choix existe. Chaque
// ouverture joue la revelation liquide (CSS lq-reveal). Le verdict en vol
// (verification serveur) ne replie JAMAIS un bloc deja ouvert : un ecran qui
// bat au rythme du reseau est pire qu'un ecran patient.
function setRevealState(element, shouldShow) {
  if (!element) return;
  element.classList.add('lq-revealable');
  // L'etat se lit sur is-folded SEUL : un bloc jamais synchronise (aucune
  // classe) est un bloc AFFICHE, et le premier repli doit le plier vraiment.
  // Corollaire voulu : un bloc affiche des le boot ne rejoue pas d'ouverture
  // (la cascade d'arrivee de l'etape suffit, pas de theatre au chargement).
  const isShown = !element.classList.contains('is-folded');
  if (shouldShow === isShown) return;
  if (shouldShow) {
    element.classList.remove('is-folded');
    // Reflow volontaire : l'animation d'ouverture rejoue a CHAQUE ouverture.
    void element.offsetWidth;
    element.classList.add('is-revealed');
  } else {
    element.classList.remove('is-revealed');
    element.classList.add('is-folded');
  }
}

// Le GESTE d'ouverture : la venue se valide d'un bouton, et c'est ce clic qui
// deploie le programme (animation VECUE a chaque parcours, meme quand la date
// par defaut est valide). Le choix survit au rechargement (state.booking).
// Retour a la page venue (ligne de rappel du telephone) : le programme se
// replie, la venue redevient la page courante. Les choix d'activites du
// client restent en memoire, rien ne se perd.
function reopenVenue() {
  state.booking.venueConfirmed = false;
  save();
  syncProgressiveReveal();
}

function confirmVenue() {
  const date = state.booking.date;
  const dayStatus = typeof getCenterDayStatusFor === 'function' ? getCenterDayStatusFor(date) : null;
  const dayOpen = !isPastBusinessDate(date)
    && Boolean(getSchedule(date, state.isHolidayMode))
    && !(dayStatus && dayStatus.open === false);
  if (!dayOpen) {
    showAlert('Choisissez une date d’ouverture : le centre est fermé ce jour.');
    return;
  }
  state.booking.venueConfirmed = true;
  save();
  syncProgressiveReveal();
}

// Premier passage du boot : la position se POSE, elle ne s'anime pas (le FLIP
// jouerait le repli de la venue au chargement, du theatre que personne n'a
// demande).
let revealBooted = false;

function syncProgressiveReveal() {
  const what = document.getElementById('s1What');
  if (!what) return;
  const date = state.booking.date;
  const dayStatus = typeof getCenterDayStatusFor === 'function' ? getCenterDayStatusFor(date) : null;
  const pending = typeof isCenterDayPending === 'function' && isCenterDayPending(date);
  const dayOpen = !isPastBusinessDate(date)
    && Boolean(getSchedule(date, state.isHolidayMode))
    && !(dayStatus && dayStatus.open === false)
    && state.booking.venueConfirmed === true;
  // En vol : on garde l'etat courant (ni ouverture ni repli sur une promesse).
  if (!pending) {
    // SEQUENCE CENTREE : la venue vit seule au milieu tant que la date ne
    // tient pas (.is-solo sur le corps d'etape). Quand elle se met a tenir,
    // le liquide la DECALE vers sa colonne : FLIP (position mesuree avant et
    // apres, trajet rejoue en transform avec le ressort), pendant que le
    // programme se deploie a la place liberee (lq-reveal).
    const body = document.querySelector('#clientView .step1-body');
    const when = document.querySelector('#clientView .s1-when');
    const wasSolo = Boolean(body && body.classList.contains('is-solo'));
    const willBeSolo = !dayOpen;
    // L'etat solo se lit aussi sur l'etape entiere : le pied d'ecran masque
    // son CTA global tant que le programme n'existe pas.
    const stepRoot = document.getElementById('step1');
    if (stepRoot) stepRoot.classList.toggle('is-solo', willBeSolo);
    if (body && when && wasSolo !== willBeSolo && revealBooted && !prefersReducedMotion() && Number(state.step) === 1) {
      const before = when.getBoundingClientRect();
      setRevealState(what, dayOpen);
      body.classList.toggle('is-solo', willBeSolo);
      const after = when.getBoundingClientRect();
      const dx = before.left - after.left;
      const dy = before.top - after.top;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        when.style.transition = 'none';
        when.style.transform = `translate(${dx}px, ${dy}px)`;
        void when.offsetWidth;
        when.style.transition = 'transform 0.95s var(--lq-spring)';
        when.style.transform = '';
        setTimeout(() => {
          when.style.removeProperty('transition');
          when.style.removeProperty('transform');
        }, 1050);
      }
    } else {
      setRevealState(what, dayOpen);
      if (body) body.classList.toggle('is-solo', willBeSolo);
    }
  }
  revealBooted = true;
  // L'etat d'attente : une ligne fine sous la venue dit POURQUOI le programme
  // n'est pas la et ce qui l'ouvrira. Elle vit exactement quand il est plie.
  const placeholder = document.getElementById('s1WhatPlaceholder');
  if (placeholder) placeholder.hidden = !what.classList.contains('is-folded');
  // PAGE PAR PAGE telephone (2026-08-18) : programme ouvert, la venue se
  // resume en une ligne tapable (le panneau complet est masque par le CSS
  // <= 640, l'ecran entier revient aux activites). Le contenu se remplit ici
  // pour suivre CHAQUE changement de date ou de groupe.
  const venueLine = document.getElementById('s1VenueLine');
  if (venueLine) {
    const lineText = document.getElementById('s1VenueLineText');
    if (lineText) {
      const pax = Number(state.booking.pax) || 0;
      let dateLabel = state.booking.date || '';
      try {
        dateLabel = parseLocalDate(state.booking.date).toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric', month: 'short' });
      } catch (error) { /* la date brute reste lisible */ }
      lineText.textContent = `${dateLabel} · ${pax} joueur${pax > 1 ? 's' : ''}`;
    }
    venueLine.hidden = what.classList.contains('is-folded');
  }
  // Le resume : des qu'un choix existe dans le mode courant.
  const mode = normalizeBookingMode(state.booking.mode);
  const hasChoice = mode === 'carte'
    ? (typeof getChosenActivities === 'function' && getChosenActivities().length > 0)
    : Boolean(state.booking.formuleId);
  setRevealState(document.getElementById('programSummary'), mode === 'carte' && hasChoice);
  // Le dock telephone depend du repli du programme : il se resynchronise ICI,
  // quel que soit l'ordre des rendus qui ont mene a ce verdict (un dock qui
  // parle d'allocation devant un programme plie a ete observe au navigateur).
  if (typeof syncStatusDock === 'function') syncStatusDock();
}

// --- DOCK D'ETAT TELEPHONE ---------------------------------------------------
// Miroir flottant des messages d'allocation (paxAlert) et d'activite fermee
// (typeAlert) : sur telephone ils quittent le flux (CSS) et vivent ici,
// au-dessus du pied d'ecran, toujours visibles. Le dock ne s'exprime qu'a
// l'etape 1 : ces messages n'existent que la.
function syncStatusDock() {
  const dock = document.getElementById('stepStatusDock');
  if (!dock) return;
  const onStepOne = Number(state.step) === 1;
  // Programme replie (jour ferme, date passee) : l'allocation de pistes ne
  // decrit rien que le client puisse composer, le dock se tait.
  const what = document.getElementById('s1What');
  const programOpen = Boolean(what && !what.classList.contains('is-folded'));
  const pax = document.getElementById('paxAlert');
  const type = document.getElementById('typeAlert');
  const source = (type && type.innerHTML.trim()) ? type : ((pax && pax.innerHTML.trim()) ? pax : null);
  const html = onStepOne && programOpen && source ? source.innerHTML : '';
  if (dock.innerHTML !== html) dock.innerHTML = html;
  dock.classList.toggle('is-live', Boolean(html));
  // Le dock se pose au-dessus du pied MESURE, pas d'un pied suppose : la
  // sous-barre varie d'un tenant a l'autre (contacts du centre en prod) et un
  // decalage fixe mordait le haut du CTA « Verifier les disponibilites »
  // (vu en prod le 2026-08-18 a 390x844). Mesure au moment ou il parle.
  if (html) {
    const foot = document.querySelector('#step1 .step-foot');
    const footTop = foot ? foot.getBoundingClientRect().top : 0;
    if (footTop > 0 && footTop < window.innerHeight) {
      dock.style.bottom = `${Math.round(window.innerHeight - footTop + 8)}px`;
    } else {
      dock.style.removeProperty('bottom');
    }
  }
}

// --- TILT 3D DES CARTES ------------------------------------------------------
// La carte s'incline sous le curseur (max 5 degres), revient a plat au
// depart. Souris uniquement (jamais au toucher), rien en mouvement reduit,
// une seule ecoute deleguee, calee sur la frequence d'affichage.
function bindCardTilt() {
  const host = document.getElementById('clientView');
  if (!host || host.dataset.tiltBound === '1') return;
  host.dataset.tiltBound = '1';
  const MAX_DEG = 7;
  let queued = null;
  const clearTilt = (card) => {
    if (!card) return;
    card.style.removeProperty('--tiltX');
    card.style.removeProperty('--tiltY');
    card.style.removeProperty('--tiltScale');
    card.classList.remove('is-tilting');
  };
  host.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse' || prefersReducedMotion()) return;
    const card = event.target && event.target.closest ? event.target.closest('.activity-card, .formule-card') : null;
    if (queued) queued.card !== card && clearTilt(queued.card);
    queued = { card, x: event.clientX, y: event.clientY, pending: queued ? queued.pending : false };
    if (queued.pending) return;
    queued.pending = true;
    requestAnimationFrame(() => {
      const current = queued;
      if (!current) return;
      current.pending = false;
      if (!current.card) return;
      const rect = current.card.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const rx = ((current.y - rect.top) / rect.height - 0.5) * -2 * MAX_DEG;
      const ry = ((current.x - rect.left) / rect.width - 0.5) * 2 * MAX_DEG;
      current.card.style.setProperty('--tiltX', `${rx.toFixed(2)}deg`);
      current.card.style.setProperty('--tiltScale', '1.02');
      current.card.style.setProperty('--tiltY', `${ry.toFixed(2)}deg`);
      current.card.classList.add('is-tilting');
    });
  }, { passive: true });
  host.addEventListener('pointerout', (event) => {
    const card = event.target && event.target.closest ? event.target.closest('.activity-card, .formule-card') : null;
    if (!card) return;
    const next = event.relatedTarget && event.relatedTarget.closest ? event.relatedTarget.closest('.activity-card, .formule-card') : null;
    if (next !== card) clearTilt(card);
  }, { passive: true });
}

// La note du nombre de joueurs REPOND au geste : elle se pose quand elle
// change, et reste strictement immobile quand elle dit la meme chose (elle est
// recalculee a chaque frappe dans le champ).
function updatePaxAlert() {
  const host = document.getElementById('paxAlert');
  const before = host ? host.innerHTML : '';
  renderPaxAlertContent();
  if (host && host.innerHTML !== before && host.firstElementChild) {
    host.firstElementChild.classList.add('is-appearing');
  }
  syncStatusDock();
}

function renderPaxAlertContent() {
  const pax = Number(state.booking.pax) || 0;
  const needed = getRequiredLaneCount(state.booking.type || 'bowling', pax, state.booking.formuleId);
  // Capacite LIVE du centre (config, pas les constantes) : ainsi changer le nombre
  // de pistes ou les joueurs/piste dans Etablissement se reflete ici.
  const maxPerLane = getMaxPerLane();
  const totalLanes = getTotalLanes();
  const impossibleBowlingGroup = state.booking.type !== 'laser' && needed > totalLanes;
  const el = document.getElementById('paxAlert');
  if (pax <= 0) { el.innerHTML = ''; return; }
  if (state.booking.type === 'laser') {
    const waveCount = getLaserWaveCount(pax);
    const waveSize = getBalancedLaserWaveSize(pax);
    const remainingIfEmpty = Math.max(0, LASER_GAME_MAX_PLAYERS - (waveCount > 1 ? waveSize : pax));
    el.innerHTML = `
      <div class="pax-alert ${waveCount > 1 ? 'warning' : ''}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${waveCount > 1 ? '2.5' : '2'}" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:1px;"><circle cx="12" cy="12" r="10"/><path d="M12 7v5l3 2"/></svg>
        <span>${waveCount > 1 ? `Groupe de <b>${pax} joueurs</b> : nous préparons <b>${waveCount} sessions Laser</b> d'environ ${waveSize} joueurs.` : `Vous réservez <b>${pax} place${pax > 1 ? 's' : ''}</b>. Dans une session vide, il restera <b>${remainingIfEmpty}</b> place${remainingIfEmpty > 1 ? 's' : ''}.`}</span>
      </div>`;
    return;
  }
  // Formule : le nombre de pistes depend de la formule (et de son bowling). Tant
  // qu aucune formule n est choisie (ou qu elle n utilise pas de piste), on
  // n affiche PAS de compte de pistes (evite un absurde "0 pistes cote a cote").
  if (state.booking.type === 'formule' && (!state.booking.formuleId || needed <= 0)) {
    el.innerHTML = `
      <div class="pax-alert">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:1px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        <span>Vous serez <b>${pax} personne${pax > 1 ? 's' : ''}</b>. Choisissez une formule ci-dessous : elle s'adapte à votre groupe.</span>
      </div>`;
    return;
  }
  // VISITE : plusieurs activites dans la meme reservation. Le message ne
  // connaissait que le bowling seul, le laser seul et les formules : une
  // visite retombait donc sur le texte du bowling (« nous reservons 2
  // pistes ») sans dire un mot des autres activites cochees. On annonce ici
  // ce que le GROUPE implique, activite par activite, et rien pour celles
  // qui n'imposent aucune contrainte.
  if (normalizeBookingMode(state.booking.mode) === 'carte' && typeof getChosenActivities === 'function') {
    const choisies = getChosenActivities();
    if (choisies.length > 1) {
      const consequences = [];
      const aBowling = choisies.find((a) => a.priceType === 'grid_bowling');
      if (aBowling && needed > 0) {
        consequences.push(`<b>${needed} piste${needed > 1 ? 's' : ''}</b> de ${escapeHtml(aBowling.name.toLowerCase())}`);
      }
      const aLaser = choisies.find((a) => a.priceType === 'grid_laser');
      if (aLaser) {
        const vagues = getLaserWaveCount(pax);
        if (vagues > 1) consequences.push(`<b>${vagues} sessions</b> de laser game`);
      }
      // Une installation avec un plafond de joueurs impose ses passages.
      choisies.forEach((activite) => {
        const plafond = Number(activite.maxPax) || 0;
        if (plafond > 0 && pax > plafond) {
          consequences.push(`<b>${Math.ceil(pax / plafond)} passages</b> au ${escapeHtml(activite.name)} (${plafond} joueurs max)`);
        }
      });
      const impossible = aBowling && needed > totalLanes;
      // Seules les activites PLANIFIEES ont une heure a choisir. Promettre ce
      // choix pour un billard ou une plaine de jeu serait faux : elles se
      // vivent a l'arrivee.
      const aCreneau = choisies.some((a) => a.planned);
      el.innerHTML = `
        <div class="pax-alert ${impossible || consequences.length ? 'warning' : ''}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${consequences.length ? '2.5' : '2'}" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:1px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          <span>${impossible
            ? `Groupe de <b>${pax} joueurs</b> : impossible sur ${totalLanes} pistes en même temps. Le staff proposera deux vagues ou un autre horaire.`
            : consequences.length
              ? `Pour <b>${pax} personne${pax > 1 ? 's' : ''}</b>, nous réservons ${consequences.join(', ')}.${aCreneau ? " Vous choisirez l'heure de chaque activité à l'étape suivante." : ''}`
              : `<b>${pax} personne${pax > 1 ? 's' : ''}</b> et <b>${choisies.length} activités</b> : tout tient en une seule visite. ${aCreneau
                ? "Vous choisirez l'heure de chaque activité à l'étape suivante."
                : "Aucune de ces activités ne se réserve à heure fixe : choisissez simplement votre heure d'arrivée."}`}</span>
        </div>`;
      return;
    }
  }
  if (impossibleBowlingGroup) {
    el.innerHTML = `
      <div class="pax-alert warning">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:1px;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        <span>Groupe de <b>${pax} joueurs</b> : impossible sur ${totalLanes} pistes en même temps. Le staff devra proposer deux vagues ou un autre horaire.</span>
      </div>`;
  } else if (pax > maxPerLane) {
    el.innerHTML = `
      <div class="pax-alert warning">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:1px;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        <span>Maximum conseillé : <b>${maxPerLane} joueurs par piste</b>. Avec ${pax} joueurs, nous réservons <b>${needed} pistes</b>${pax > totalLanes * maxPerLane ? ' avec répartition serrée validée staff' : ' côte à côte'}.</span>
      </div>`;
  } else {
    el.innerHTML = `
      <div class="pax-alert">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:1px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        <span>Allocation : <b>${needed} piste${needed > 1 ? 's' : ''}</b> (max ${maxPerLane}/piste)</span>
      </div>`;
  }
}

function normalizeBookingType(type) {
  return ['bowling', 'laser', 'formule', 'visite'].includes(type) ? type : 'bowling';
}

// Deux modes seulement : composer sa visite « à la carte », ou prendre une
// formule tout compris. Les anciens types restent acceptes (vieux lien, etat
// sauvegarde) et retombent sur la carte avec la bonne activite cochee.
function normalizeBookingMode(mode) {
  if (mode === 'formule') return 'formule';
  return 'carte';
}

// LE TYPE ENVOYE AU SERVEUR SE DEDUIT de ce qui est coche. Une visite qui ne
// contient qu'une activite planifiee garde son type historique ('bowling' ou
// 'laser') et donc son chemin de disponibilite d'origine : on ne fait passer par
// le chemin 'visite' que ce qui n'existait pas avant.
function deriveBookingType() {
  if (normalizeBookingMode(state.booking.mode) === 'formule') return 'formule';
  const chosen = getChosenActivities();
  if (!chosen.length) return 'bowling';
  const planned = chosen.filter(item => item.planned);
  if (planned.length === 1 && chosen.length === 1) return planned[0].id === 'laser_game' ? 'laser' : 'bowling';
  return 'visite';
}

// Les activites cochees, dans l'ordre du catalogue du centre.
function getChosenActivities() {
  const selection = state.booking.activities && typeof state.booking.activities === 'object' ? state.booking.activities : {};
  const catalog = typeof getCenterActivities === 'function' ? getCenterActivities() : [];
  const list = catalog.length ? catalog : [
    { id: 'bowling', name: 'Bowling', planned: true, priceType: 'grid_bowling' },
    { id: 'laser_game', name: 'Laser Game', planned: true, priceType: 'grid_laser' },
  ];
  return list.filter(activity => selection[activity.id]).map(activity => ({ ...activity, options: selection[activity.id] || {} }));
}

function syncBookingTypeUi() {
  const dayStatus = typeof getCenterDayStatusFor === 'function' ? getCenterDayStatusFor(state.booking.date) : null;
  const off = dayStatus && Array.isArray(dayStatus.unavailableActivityIds) ? dayStatus.unavailableActivityIds : [];
  const mode = normalizeBookingMode(state.booking.mode);
  // Une activite fermee ce jour est DECOCHEE : l'ecran ne garde jamais un choix
  // mort, et le client n'arrive pas a l'etape des creneaux avec un programme
  // qui ne peut pas exister.
  if (state.booking.activities && off.length) {
    off.forEach(id => { delete state.booking.activities[id]; });
  }
  state.booking.mode = mode;
  state.booking.type = deriveBookingType();
  document.getElementById('segCarte').classList.toggle('active', mode === 'carte');
  document.getElementById('segFormule').classList.toggle('active', mode === 'formule');
  // La pastille du selecteur GLISSE jusqu'au choix (recette 3) : la classe du
  // conteneur pilote sa position, le CSS fait le mouvement.
  document.getElementById('segCarte').closest('.segmented')?.classList.toggle('is-formule', mode === 'formule');
  const picker = document.getElementById('activityPicker');
  if (picker) picker.classList.toggle('hidden', mode !== 'carte');
  document.getElementById('bowlingBlock').classList.add('hidden');
  document.getElementById('laserBlock').classList.add('hidden');
  document.getElementById('formuleBlock').classList.toggle('hidden', mode !== 'formule');
  renderActivityPicker(off);
  renderTypeAlert(off, dayStatus);
  syncProgressiveReveal();
  syncStatusDock();
}

// La grille d'activites se construit UNE fois, puis ne change que par des
// classes. Les tuiles restent compactes et les reglages des activites cochees
// vivent dans un bloc commun sous la grille. Aucune carte ne peut ainsi imposer
// sa hauteur aux voisines ni creer de trou dans la composition.
function renderActivityPicker(off = []) {
  const host = document.getElementById('activityPicker');
  if (!host) return;
  const catalog = typeof getCenterActivities === 'function' ? getCenterActivities() : [];
  if (!catalog.length) { host.innerHTML = ''; activityPickerSignature = ''; return; }
  // Le PAX fait partie de la signature : le plafond des pastilles d'enfants
  // (plaine de jeux) suit le groupe. Sans lui, un groupe passe de 4 a 6 et le
  // compteur reste borne a 4. Reconstruire au changement de groupe est sans
  // danger : aucun press n'est en cours dans le picker a ce moment-la.
  const paxCeiling = Math.min(12, Math.max(1, Number(state.booking.pax) || 1));
  const signature = `${catalog.map(activity => activity.id).join(',')}|pax:${paxCeiling}`;
  if (signature !== activityPickerSignature) {
    buildActivityPicker(host, catalog);
    activityPickerSignature = signature;
  }
  syncActivityPickerState(off);
  renderProgramSummary();
  // Le choix vient peut-etre de naitre ou de mourir : la revelation du resume
  // et le dock telephone suivent le meme battement que le programme.
  syncProgressiveReveal();
  syncStatusDock();
}

let activityPickerSignature = '';

// Icones en trait, un dessin par activite. Une grille de huit rectangles de
// texte se lit comme un formulaire administratif ; la meme grille avec un objet
// reconnaissable par carte se lit d'un coup d'oeil.
const ACTIVITY_ICONS = {
  // Boule de bowling : les trois trous en negatif, pas trois points poses.
  bowling: '<path d="M12 2.6a9.4 9.4 0 1 0 0 18.8 9.4 9.4 0 0 0 0-18.8Zm-2.7 5.1a1.35 1.35 0 1 1 0 2.7 1.35 1.35 0 0 1 0-2.7Zm3.9-1.1a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6Zm-2.2 5.2a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6Z"/>',
  // Pistolet laser vu de profil, avec sa visee.
  laser_game: '<path d="M3.4 8.2h9.1l1.7-1.9h4.4a1.4 1.4 0 0 1 1.4 1.4v2.5a1.4 1.4 0 0 1-1.4 1.4h-2.2l-1 2.2a2.2 2.2 0 0 1-2 1.3h-1.2l-.9 3.6a1 1 0 0 1-1 .8H8.2a1 1 0 0 1-1-1.2l.7-3.2H5.6A2.2 2.2 0 0 1 3.4 14Z"/><circle cx="17.3" cy="9" r="1"/>',
  // Club, balle et trou : les trois signes du minigolf.
  minigolf_blacklight: '<path d="M9.6 2.6a.95.95 0 0 1 1.9 0v13.6a.95.95 0 0 1-1.9 0Z"/><path d="M11.9 3.1 18.6 5.4a.6.6 0 0 1 0 1.1l-6.7 2.3Z"/><ellipse cx="11.2" cy="18.4" rx="6.4" ry="2.4" opacity=".3"/><circle cx="17.9" cy="16.9" r="2"/>',
  golf_oclock: '<path d="M6.6 2.6a.95.95 0 0 1 1.9 0v14.2a.95.95 0 0 1-1.9 0Z"/><path d="M8.9 3.1 15.2 5.3a.6.6 0 0 1 0 1.1L8.9 8.6Z"/><path d="M16.6 12.4a4.7 4.7 0 1 0 0 9.4 4.7 4.7 0 0 0 0-9.4Zm.5 2.3v2.2l1.5 1a.8.8 0 0 1-.9 1.3l-1.9-1.3a.8.8 0 0 1-.4-.7v-2.5a.85.85 0 0 1 1.7 0Z"/>',
  // Queue et triangle de boules, vus de dessus.
  billards: '<path d="M20.3 2.5a1.3 1.3 0 0 1 1.8 1.8l-1 1-1.8-1.8ZM18.1 4.7l1.8 1.8-7.4 7.4a4.9 4.9 0 0 0-1.8-1.8Z"/><circle cx="7.4" cy="16.6" r="4.9"/><path d="M5 14.2a3.4 3.4 0 0 0 4.8 4.8" fill="none" stroke="currentColor" stroke-width="1.4" opacity=".45"/>',
  // Borne d'arcade : ecran, joystick, deux boutons.
  arcade_time: '<path d="M6.2 2.6h11.6a2.4 2.4 0 0 1 2.4 2.4v11a2.4 2.4 0 0 1-2.4 2.4h-3.1l.5 2.1h1.4a.85.85 0 0 1 0 1.7H7.4a.85.85 0 0 1 0-1.7h1.4l.5-2.1H6.2a2.4 2.4 0 0 1-2.4-2.4V5a2.4 2.4 0 0 1 2.4-2.4Zm.4 2.6v5.9h10.8V5.2Zm2.3 8.2a1.15 1.15 0 1 0 0 2.3 1.15 1.15 0 0 0 0-2.3Zm4 0a1.15 1.15 0 1 0 0 2.3 1.15 1.15 0 0 0 0-2.3Zm3.4 0a1.15 1.15 0 1 0 0 2.3 1.15 1.15 0 0 0 0-2.3Z"/>',
  // Toboggan avec son echelle : la plaine de jeu, pas une abstraction.
  playground: '<path d="M16.4 3.2h1.9v15.9h-1.9Zm4.4 0h1.9v15.9h-1.9Z"/><path d="M17.4 6.4h4.9v1.7h-4.9Zm0 4.1h4.9v1.7h-4.9Zm0 4.1h4.9v1.7h-4.9Z" opacity=".75"/><path d="M16 4.6v2.1c-2.8 1.3-4.6 3.4-5.5 6.4-.6 2-2 3.6-4.2 4.9a.95.95 0 0 1-1-1.6c1.8-1.1 2.9-2.3 3.4-3.9 1.1-3.7 3.5-6.3 7.3-7.9Z"/><path d="M2 20.9h13.4a.95.95 0 0 0 0-1.9H2a.95.95 0 0 0 0 1.9Z"/>',
  // Quilles courtes du duckpin : deux quilles trapues, sa signature.
  duckpin_bowling: '<path d="M8.5 2.4c1.5 0 2.5 1.3 2.5 2.7 0 1.2-.8 2.2-.8 3.2 0 1.6 1.6 2.7 1.6 5.1 0 2.1-1.4 3.4-3.3 3.4S5.2 15.5 5.2 13.4c0-2.4 1.6-3.5 1.6-5.1 0-1-.8-2-.8-3.2 0-1.4 1-2.7 2.5-2.7Z"/><path d="M16.4 5.6c1.3 0 2.1 1.1 2.1 2.3 0 1-.7 1.9-.7 2.7 0 1.4 1.4 2.3 1.4 4.4 0 1.8-1.2 2.9-2.8 2.9s-2.8-1.1-2.8-2.9c0-2.1 1.4-3 1.4-4.4 0-.8-.7-1.7-.7-2.7 0-1.2.8-2.3 2.1-2.3Z" opacity=".8"/><path d="M3.4 20.8h17.2a.9.9 0 0 0 0-1.8H3.4a.9.9 0 0 0 0 1.8Z"/>',
  // Coureur : le Fun Run se vend a la session, l'icone dit le mouvement.
  fun_run: '<path d="M14.6 2.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z"/><path d="M12.4 7.6c.9-.5 2-.3 2.7.4l1.9 2 2.5.9a1 1 0 0 1-.7 1.9l-2.9-1.1a1 1 0 0 1-.4-.3l-.7-.7-.8 3 2 2.1a1 1 0 0 1 .3.6l.4 3.6a1 1 0 0 1-2 .2l-.3-3.2-2.8-2.9a1 1 0 0 1-.3-.9l.5-2.7-1.3 1.4-2 3a1 1 0 0 1-1.7-1.1l2.1-3.2a1 1 0 0 1 .2-.2Z"/><path d="M2.6 9.4h4.2a.9.9 0 0 1 0 1.8H2.6a.9.9 0 0 1 0-1.8Zm.6 3.4h3a.9.9 0 0 1 0 1.8h-3a.9.9 0 0 1 0-1.8Z" opacity=".5"/>',
  party_table: '<path d="M11.2 2.2c.6.7 1 1.3 1 1.9a1.2 1.2 0 0 1-2.4 0c0-.6.4-1.2 1-1.9a.3.3 0 0 1 .4 0Z"/><path d="M10.1 5.6h1.8v3.1h-1.8Z"/><path d="M6.6 8.7h8.8a2.4 2.4 0 0 1 2.4 2.4v1.6c-1 0-1.4.9-2.4.9s-1.4-.9-2.4-.9-1.4.9-2.4.9-1.4-.9-2.4-.9-1.4.9-2.4.9v-2.5a2.4 2.4 0 0 1 2.4-2.4Z"/><path d="M4.2 15.1c1 0 1.4-.9 2.4-.9s1.4.9 2.4.9 1.4-.9 2.4-.9 1.4.9 2.4.9 1.4-.9 2.4-.9 1.4.9 2.4.9v3.3a2.4 2.4 0 0 1-2.4 2.4H6.6a2.4 2.4 0 0 1-2.4-2.4Z" opacity=".75"/>',
};

function activityIconMarkup(activityId) {
  const paths = ACTIVITY_ICONS[activityId]
    || '<path d="M12 2.6a9.4 9.4 0 1 0 0 18.8 9.4 9.4 0 0 0 0-18.8Zm.9 4.6v3.9h3.9a.9.9 0 0 1 0 1.8h-3.9v3.9a.9.9 0 0 1-1.8 0v-3.9H7.2a.9.9 0 0 1 0-1.8h3.9V7.2a.9.9 0 0 1 1.8 0Z"/>';
  return `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${paths}</svg>`;
}

// Tous les blocs de reglages existent des le premier rendu. Cocher une activite
// ne reconstruit ni la grille ni les boutons, ce qui preserve le focus.
// Une activite payee PAR ENFANT (plaine de jeux) se regle en nombre d'enfants :
// 4 adultes + 2 enfants ne paient pas 6 entrees. La detection passe par la
// DONNEE (unitLabel du catalogue), jamais par un id de centre.
function activityCountsChildren(activity) {
  return Boolean(activity && activity.priceType === 'per_pax' && /enfant/i.test(activity.unitLabel || ''));
}

function activityHasConfigurableOptions(activity) {
  if (activityCountsChildren(activity)) return true;
  return Boolean(activity && [
    'grid_bowling',
    'grid_laser',
    'grid_fun_run',
    'per_unit_hour',
  ].includes(activity.priceType));
}

function activityConfigHint(activity) {
  if (!activity) return '';
  if (activityCountsChildren(activity)) return 'Nombre d’enfants';
  if (activity.priceType === 'grid_laser') return 'Nombre de parties';
  if (activity.priceType === 'per_unit_hour') return 'Tables et durée';
  return 'Durée';
}

// Le nom accessible d'une carte d'activite est EXPLICITE (aria-label), jamais
// deduit de la concatenation des spans visuels : un arbre d'accessibilite qui
// rend « button » sans texte interdit de reserver au lecteur d'ecran. Le nom
// porte l'activite et son prix, l'etat coche vit dans aria-pressed.
function activityToggleLabel(activity, { closed = false, pax = 1 } = {}) {
  if (!activity) return '';
  if (closed) return `${activity.name}, fermé ce jour`;
  const hint = activityPriceHint(activity, pax);
  return hint ? `${activity.name}, ${hint}` : activity.name;
}

function buildActivityPicker(host, catalog) {
  const pax = Math.max(1, Number(state.booking.pax) || 1);
  const cards = catalog.map((activity, index) => `
      <div class="activity-card" data-activity="${escapeHtml(activity.id)}" style="--i:${index}">
        <button type="button" class="activity-toggle" aria-pressed="false" aria-label="${escapeHtml(activityToggleLabel(activity, { pax }))}" onclick="toggleBookingActivity('${escapeHtml(activity.id)}')">
          <span class="activity-icon">${activityIconMarkup(activity.id)}</span>
          <span class="activity-text">
            <span class="activity-name">${escapeHtml(activity.name)}</span>
            <span class="activity-price" data-role="price">${escapeHtml(activityPriceHint(activity, pax))}</span>
            <span class="activity-note"${activity.note ? ` title="${escapeHtml(activity.note)}"` : ''}>${activity.note ? escapeHtml(activity.note) : ''}</span>
          </span>
          <span class="activity-check" aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
          </span>
        </button>
      </div>`).join('');
  const settings = catalog.filter(activityHasConfigurableOptions).map(activity => `
      <section class="activity-config-row" data-activity-options="${escapeHtml(activity.id)}" aria-label="Réglages ${escapeHtml(activity.name)}" aria-hidden="true">
        <div class="activity-config-row-inner">
          <div class="activity-config-label">
            <span class="activity-config-name">${escapeHtml(activity.name)}</span>
            <span class="activity-config-hint">${escapeHtml(activityConfigHint(activity))}</span>
          </div>
          <div class="activity-config-controls" data-role="options">${renderActivityOptions(activity, state.booking.activities?.[activity.id] || {}, pax)}</div>
        </div>
      </section>`).join('');
  host.innerHTML = `
    <div class="activity-grid" data-role="activity-grid">${cards}</div>
    <div class="activity-configurator" data-role="activity-configurator" aria-hidden="true">
      <div class="activity-configurator-head">
        <span class="activity-configurator-title">Choisissez vos options</span>
        <span class="activity-configurator-count" data-role="config-count"></span>
      </div>
      <div class="activity-config-list">${settings}</div>
    </div>`;
}

// L'etat, et rien que l'etat : classes, aria, libelles. Aucun noeud n'est
// remplace, donc les transitions CSS partent de la valeur courante au lieu de
// repartir de zero (elles restent interruptibles : on peut cocher/decocher vite
// sans saccade).
function syncActivityPickerState(off = []) {
  const host = document.getElementById('activityPicker');
  if (!host) return;
  const selection = state.booking.activities || (state.booking.activities = {});
  const pax = Math.max(1, Number(state.booking.pax) || 1);
  const optionsRows = new Map([...host.querySelectorAll('[data-activity-options]')]
    .map(row => [row.getAttribute('data-activity-options'), row]));
  let visibleConfigCount = 0;
  host.querySelectorAll('.activity-card').forEach(card => {
    const activityId = card.getAttribute('data-activity');
    const activity = typeof getCenterActivity === 'function' ? getCenterActivity(activityId) : null;
    const chosen = Boolean(selection[activityId]);
    const closed = off.includes(activityId);
    card.classList.toggle('is-on', chosen && !closed);
    card.classList.toggle('is-off', closed);
    const toggle = card.querySelector('.activity-toggle');
    if (toggle) {
      toggle.setAttribute('aria-pressed', chosen && !closed ? 'true' : 'false');
      toggle.disabled = closed;
      toggle.setAttribute('aria-disabled', closed ? 'true' : 'false');
      // Le nom accessible suit l'etat reel : prix du jour, fermeture du jour.
      const label = activityToggleLabel(activity, { closed, pax });
      if (label && toggle.getAttribute('aria-label') !== label) toggle.setAttribute('aria-label', label);
    }
    const price = card.querySelector('[data-role="price"]');
    if (price && activity) price.textContent = closed ? 'Fermé ce jour' : activityPriceHint(activity, pax);
    const optionsRow = optionsRows.get(activityId);
    if (!optionsRow) return;
    const showOptions = chosen && !closed;
    optionsRow.classList.toggle('is-visible', showOptions);
    optionsRow.setAttribute('aria-hidden', showOptions ? 'false' : 'true');
    if (showOptions) visibleConfigCount += 1;
    if (!showOptions && optionsRow.contains(document.activeElement) && toggle) toggle.focus();
    optionsRow.querySelectorAll('button').forEach(button => { button.tabIndex = showOptions ? 0 : -1; });
    // Les options ne sont PAS reecrites : on bascule seulement la pastille
    // active. Les reconstruire a chaque clic detruirait le retour visuel du
    // press en cours et ferait perdre le focus.
    const chosenOptions = selection[activityId] || {};
    // Le defaut depend de la CLE : « 1 » vaut pour une duree de bowling ou un
    // nombre de tables, jamais pour une session de 15 minutes ni pour une
    // activite dont la duree minimale est d'une heure. Un defaut faux
    // n'allume aucune pastille et la carte parait vide. Et le compte d'enfants
    // vaut le GROUPE ENTIER (meme regle que le serveur et que le premier
    // rendu) : avec « 1 », la pastille 1 s'allumait alors que le champ libre
    // affichait 8, deux etats actifs en meme temps.
    const activityDefaut = (key) => {
      if (key === 'minutes') return FUN_RUN_OPTIONS[0].minutes;
      if (key === 'hours') return activityHourChoices(activity || {})[0].hours;
      if (key === 'participants') return Math.min(30, Math.max(1, pax));
      return 1;
    };
    optionsRow.querySelectorAll('[data-opt]').forEach(pill => {
      const key = pill.getAttribute('data-opt');
      const value = Number(pill.getAttribute('data-val'));
      const courant = chosenOptions[key] == null ? activityDefaut(key) : Number(chosenOptions[key]);
      pill.classList.toggle('active', courant === value);
    });
    // Le stepper d'enfants suit la valeur (sans voler une frappe en cours),
    // les boutons -/+ se desactivent aux bornes, la note de prix recalcule.
    if (activityCountsChildren(activity)) {
      const ceiling = Math.min(30, Math.max(1, pax));
      const current = Math.min(ceiling, Math.max(1, Number(chosenOptions.participants) || ceiling));
      const field = optionsRow.querySelector('[data-role="participants-input"]');
      if (field) {
        field.max = String(ceiling);
        if (document.activeElement !== field) field.value = String(current);
      }
      const minus = optionsRow.querySelector('[data-role="participants-minus"]');
      const plus = optionsRow.querySelector('[data-role="participants-plus"]');
      if (minus) minus.disabled = current <= 1;
      if (plus) plus.disabled = current >= ceiling;
      const note = optionsRow.querySelector('[data-role="participants-note"]');
      const price = Number(activity && activity.priceValue);
      if (note && Number.isFinite(price) && price > 0) {
        note.textContent = `${price}€ ${(activity.unitLabel || 'par enfant')} · ${current} enfant${current > 1 ? 's' : ''} = ${Math.round(price * current * 100) / 100}€.`;
      }
    }
  });
  const configurator = host.querySelector('[data-role="activity-configurator"]');
  if (configurator) {
    configurator.classList.toggle('is-visible', visibleConfigCount > 0);
    configurator.setAttribute('aria-hidden', visibleConfigCount > 0 ? 'false' : 'true');
  }
  const count = host.querySelector('[data-role="config-count"]');
  if (count) count.textContent = `${visibleConfigCount} réglage${visibleConfigCount > 1 ? 's' : ''} actif${visibleConfigCount > 1 ? 's' : ''}`;
}

// Ce qu'on annonce sous le nom : un prix quand le centre l'a saisi, la mention
// honnete "réglé sur place" sinon. Jamais 0 EUR pour "on ne sait pas".
function activityPriceHint(activity, pax) {
  if (!activity) return '';
  if (activity.priceType === 'grid_bowling') return `dès ${DURATION_OPTIONS[0].price}€ la piste`;
  if (activity.priceType === 'grid_laser') return `dès ${LASER_GAME_OPTIONS[0].price}€ par joueur`;
  if (activity.priceType === 'grid_fun_run') return `dès ${FUN_RUN_OPTIONS[0].price}€ la session`;
  if (activity.priceValue == null) return 'réglé sur place';
  return `${activity.priceValue}€ ${activity.unitLabel || ''}`.trim();
}

// Les durees vendables d'une activite au temps. Elles se DERIVENT des bornes
// du catalogue au lieu d'etre une liste en dur : c'est ce qui fait qu'un
// billard sans demi-heure (borne basse a 60 min) n'en propose plus, sans
// toucher au tunnel.
function activityHourChoices(activity) {
  const min = Math.max(15, Number(activity.minMinutes) || 60);
  const max = Math.max(min, Number(activity.maxMinutes) || min);
  // Le PAS vient de l'activite : le billard se vend a l'heure pleine, donc ni
  // demi-heure ni 1h30. Une liste en dur ici obligerait a la corriger a
  // chaque activite qui ne se vend pas comme les autres.
  const pas = Math.max(15, Number(activity.stepMinutes) || 30);
  const minutes = [];
  for (let m = min; m <= max; m += pas) minutes.push(m);
  if (!minutes.length) minutes.push(min);
  return minutes.sort((a, b) => a - b).map(m => ({
    hours: m / 60,
    label: m < 60 ? `${m} min` : (m % 60 === 0 ? `${m / 60}h` : `${Math.floor(m / 60)}h${m % 60}`),
  }));
}

// Les options d'une activite. data-opt / data-val servent a
// syncActivityPickerState : il bascule la pastille active SANS reconstruire le
// bloc, donc sans casser le retour au press ni le focus d'un select ouvert.
function renderActivityOptions(activity, options, pax) {
  if (!activity) return '';
  const id = escapeHtml(activity.id);
  // Grille de pistes : le duckpin la partage avec le bowling (meme tarif, meme
  // regle de joueurs). Piloter par le TYPE et non par l'id, c'est ce qui rend
  // ce partage gratuit.
  if (activity.priceType === 'grid_bowling') {
    const current = Number(options.duration) || 1;
    return `<div class="activity-option-row">${DURATION_OPTIONS.map(option => `
      <button type="button" class="dur-pill sm ${current === Number(option.value) ? 'active' : ''}" data-opt="duration" data-val="${option.value}"
        onclick="setBookingActivityOption('${id}','duration',${option.value})">
        ${option.label}<span class="price">${option.price}€ / piste</span>
      </button>`).join('')}</div>`;
  }
  if (activity.priceType === 'grid_laser') {
    const current = Number(options.games) || 1;
    return `<div class="activity-option-row">${LASER_GAME_OPTIONS.map(option => `
      <button type="button" class="dur-pill sm ${current === Number(option.games) ? 'active' : ''}" data-opt="games" data-val="${option.games}"
        onclick="setBookingActivityOption('${id}','games',${option.games})">
        ${option.label}<span class="price">${option.price}€ / pers</span>
      </button>`).join('')}</div>`;
  }
  if (activity.priceType === 'grid_fun_run') {
    const current = Number(options.minutes) || FUN_RUN_OPTIONS[0].minutes;
    return `<div class="activity-option-row">${FUN_RUN_OPTIONS.map(option => `
      <button type="button" class="dur-pill sm ${current === Number(option.minutes) ? 'active' : ''}" data-opt="minutes" data-val="${option.minutes}"
        onclick="setBookingActivityOption('${id}','minutes',${option.minutes})">
        ${option.label}<span class="price">${option.price}€ / session</span>
      </button>`).join('')}</div>`;
  }
  if (activityCountsChildren(activity)) {
    // Le compte d'enfants se regle au MEME stepper -/+ que le compte de
    // joueurs de la venue : un seul vocabulaire de reglage dans le tunnel.
    // (Les pastilles 1-5 + champ « 6+ » faisaient deux composants pour un
    // seul chiffre : refusees par Movsar le 2026-08-17.)
    const ceiling = Math.min(30, Math.max(1, pax));
    const current = Math.min(ceiling, Math.max(1, Number(options.participants) || ceiling));
    const price = Number(activity.priceValue);
    const detail = Number.isFinite(price) && price > 0
      ? `<div class="activity-option-note" data-role="participants-note">${price}€ ${escapeHtml(activity.unitLabel || 'par enfant')} · ${current} enfant${current > 1 ? 's' : ''} = ${Math.round(price * current * 100) / 100}€.</div>`
      : '';
    return `<div class="activity-option-stack"><div class="activity-option-group"><span class="activity-option-legend">Enfants</span>
      <div class="child-stepper">
        <button type="button" class="child-step-btn" data-role="participants-minus" aria-label="Retirer un enfant" ${current <= 1 ? 'disabled' : ''}
          onclick="stepBookingChildren('${id}',-1)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/></svg></button>
        <input type="number" class="input participants-input" data-role="participants-input"
          min="1" max="${ceiling}" inputmode="numeric" value="${current}" aria-label="Nombre d'enfants"
          oninput="setBookingActivityOption('${id}','participants', Math.min(${ceiling}, Math.max(1, Number(this.value) || 1)))">
        <button type="button" class="child-step-btn" data-role="participants-plus" aria-label="Ajouter un enfant" ${current >= ceiling ? 'disabled' : ''}
          onclick="stepBookingChildren('${id}',1)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>
      </div></div>${detail}</div>`;
  }
  if (activity.priceType === 'per_unit_hour') {
    const choix = activityHourChoices(activity);
    const hours = Number(options.hours) || choix[0].hours;
    const units = Math.max(1, Number(options.units) || 1);
    const prixHeure = activity.priceValue;
    // Les listes deroulantes natives sont remplacees par les memes pastilles
    // que le bowling : un seul vocabulaire de choix dans tout l'ecran.
    const duree = `<div class="activity-option-group"><span class="activity-option-legend">Durée</span>
      <div class="activity-option-pills">${choix.map(option => `
        <button type="button" class="dur-pill xs ${Number(hours) === option.hours ? 'active' : ''}" data-opt="hours" data-val="${option.hours}"
          onclick="setBookingActivityOption('${id}','hours',${option.hours})">${option.label}</button>`).join('')}</div></div>`;
    const nombre = `<div class="activity-option-group"><span class="activity-option-legend">Tables</span>
      <div class="activity-option-pills">${[1, 2, 3, 4].map(value => `
        <button type="button" class="dur-pill xs ${units === value ? 'active' : ''}" data-opt="units" data-val="${value}"
          onclick="setBookingActivityOption('${id}','units',${value})">${value}</button>`).join('')}</div></div>`;
    const detail = prixHeure == null ? '' :
      `<div class="activity-option-note">${prixHeure}€ ${escapeHtml(activity.unitLabel || '')}.</div>`;
    return `<div class="activity-option-stack">${nombre}${duree}${detail}</div>`;
  }
  return `<div class="activity-option-note">Accès à votre arrivée, ${activity.priceValue == null ? 'réglé sur place' : 'compris dans le total'}.</div>`;
}

// Le programme est une vraie synthese, pas une phrase concatenee. Le client peut
// comparer les activites et leur reglage sans relire toute une ligne. Le montant
// reste separe, et "A partir de" apparait des qu'un tarif sera regle sur place.
function renderProgramSummary() {
  const host = document.getElementById('programSummary');
  if (!host) return;
  const chosen = getChosenActivities();
  if (!chosen.length || normalizeBookingMode(state.booking.mode) === 'formule') { host.innerHTML = ''; return; }
  const pax = Math.max(1, Number(state.booking.pax) || 1);
  let total = 0;
  let complete = true;
  const items = chosen.map(activity => {
    const options = activity.options || {};
    if (activity.priceType === 'grid_bowling') {
      const duration = Number(options.duration) || 1;
      const lanes = getRequiredLaneCount('bowling', pax, '');
      const option = DURATION_OPTIONS.find(item => Number(item.value) === duration);
      total += (option?.price || 0) * lanes;
      // Le nombre de pistes se DEDUIT du nombre de joueurs : sans l'ecrire,
      // le total double sans que rien n'explique pourquoi.
      return {
        id: activity.id,
        name: activity.name,
        detail: `${option?.label || ''} · ${lanes} piste${lanes > 1 ? 's' : ''}`,
      };
    }
    if (activity.priceType === 'grid_laser') {
      const games = Number(options.games) || 1;
      total += (LASER_GAME_OPTIONS.find(option => Number(option.games) === games)?.price || 0) * pax;
      return { id: activity.id, name: activity.name, detail: `${games} partie${games > 1 ? 's' : ''}` };
    }
    if (activity.priceType === 'grid_fun_run') {
      const minutes = Number(options.minutes) || FUN_RUN_OPTIONS[0].minutes;
      const option = FUN_RUN_OPTIONS.find(item => item.minutes === minutes) || FUN_RUN_OPTIONS[0];
      total += option.price;
      return { id: activity.id, name: activity.name, detail: option.label };
    }
    // Le compte d'enfants declare remplace le groupe entier dans le calcul
    // (meme regle que le serveur : borne au groupe, absent = tout le monde).
    const linePax = activityCountsChildren(activity)
      ? Math.min(pax, Math.max(1, Number(options.participants) || pax))
      : pax;
    const price = typeof getFreeActivityPrice === 'function'
      ? getFreeActivityPrice(activity, { pax: linePax, units: options.units, hours: options.hours, minutes: options.minutes })
      : null;
    if (price == null) complete = false; else total += price;
    if (activity.priceType === 'per_unit_hour') {
      const units = Math.max(1, Number(options.units) || 1);
      const hourChoices = activityHourChoices(activity);
      const hours = Number(options.hours) || hourChoices[0].hours;
      const durationLabel = hourChoices.find(option => option.hours === hours)?.label || `${hours}h`;
      return {
        id: activity.id,
        name: activity.name,
        detail: `${units} table${units > 1 ? 's' : ''} · ${durationLabel}`,
      };
    }
    if (activityCountsChildren(activity)) {
      return {
        id: activity.id,
        name: activity.name,
        detail: `${linePax} enfant${linePax > 1 ? 's' : ''}`,
      };
    }
    return {
      id: activity.id,
      name: activity.name,
      detail: price == null ? 'À régler sur place' : 'Compris dans le total',
    };
  });
  // La structure n'est ecrite qu'une fois. Ensuite la liste et les valeurs sont
  // actualisees sans rejouer une animation de conteneur a chaque clic.
  let box = host.querySelector('.program-summary');
  if (!box) {
    host.innerHTML = `<div class="program-summary">
      <div class="program-overview">
        <div class="program-summary-head">
          <span class="program-title">Votre programme</span>
          <span class="program-count"></span>
        </div>
        <ul class="program-list"></ul>
      </div>
      <div class="program-price-block">
        <span class="program-total-label"></span>
        <strong class="program-total"></strong>
        <small class="program-total-note"></small>
      </div>
    </div>`;
    box = host.querySelector('.program-summary');
  }
  const list = box.querySelector('.program-list');
  const count = box.querySelector('.program-count');
  const totalLabel = box.querySelector('.program-total-label');
  const totalEl = box.querySelector('.program-total');
  const totalNote = box.querySelector('.program-total-note');
  const roundedTotal = Math.round(total);
  const nextTotal = complete || roundedTotal > 0 ? `${roundedTotal}€` : 'Sur place';
  const nextValue = `${complete ? '' : 'à partir de '}${nextTotal}`;
  // Cocher une activite doit se VOIR dans le programme : la ligne qui arrive se
  // pose, celles deja la ne bougent pas d'un pixel. Sans ce filtre, chaque clic
  // rejouerait l'animation de toute la liste (meme piege que le motion
  // d'exploitation de la console : ce qui ne change pas reste immobile).
  const previousIds = String(list.dataset.ids || '').split(',').filter(Boolean);
  list.innerHTML = items.map(item => `<li class="program-item${previousIds.includes(item.id) ? '' : ' is-appearing'}" data-activity="${escapeHtml(item.id)}">
    <span class="program-item-name">${escapeHtml(item.name)}</span>
    <span class="program-item-detail">${escapeHtml(item.detail)}</span>
  </li>`).join('');
  list.dataset.ids = items.map(item => item.id).join(',');
  count.textContent = `${items.length} activité${items.length > 1 ? 's' : ''}`;
  totalLabel.textContent = complete ? 'Total' : (roundedTotal > 0 ? 'À partir de' : 'Tarif');
  // « à régler sur place » est TOUJOURS dit (2026-08-18) : rien ne s'encaisse
  // en ligne, et un total nu laissait croire le contraire.
  totalNote.textContent = complete
    ? 'pour cette sélection · à régler sur place'
    : (roundedTotal > 0 ? 'Certaines activités se règlent sur place' : 'Montant confirmé à votre arrivée');
  if (totalEl.getAttribute('data-value') !== nextValue) {
    const previousTotal = totalEl.getAttribute('data-amount') || '';
    totalEl.setAttribute('data-value', nextValue);
    totalEl.setAttribute('data-amount', nextTotal);
    // Le montant ROULE vers sa nouvelle valeur (recette 8, adaptee en
    // transform) : chiffre qui monte quand le prix monte, qui descend quand il
    // baisse. C'est le seul endroit de l'ecran qui repond a « ca me coute
    // combien ? » : il montre la CONSEQUENCE du geste, sans clignoter.
    rollNumberTo(totalEl, previousTotal, nextTotal);
  }
}

// COMPTEUR A ROULEAUX (recette Transitions.dev fournie par Movsar, adaptee) :
// une colonne par CHIFFRE, chaque rouleau porte une piste de chiffres, prend
// un tour d'elan puis se pose sur le sien, en cascade de gauche a droite.
// L'ancien odometre a deux cellules sautait d'un bloc des que la longueur
// changeait (96 vers 108) : c'etait le « bug et moche ». Ce qui n'est pas un
// chiffre (le €) ne bouge pas ; une longueur qui change fait partir les
// colonnes neuves de 0. Mouvement reduit ou valeur non numerique
// (« Sur place ») : la valeur se pose, point.
const REEL_DUR_MS = 900;
const REEL_STAGGER_MS = 90;
const REEL_BLUR_FILTERS = 5;
let reelBlurReady = false;

// Le flou de file est STRICTEMENT vertical : un blur() CSS baverait sur les
// cotes (c'est ecrit dans la recette). Seul feGaussianBlur accepte "0 Y".
// Un filtre par colonne pour que chaque rouleau perde son flou en se posant.
function ensureReelBlurFilters() {
  if (reelBlurReady || typeof document === 'undefined' || !document.body) return;
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  host.innerHTML = `<svg width="0" height="0">${Array.from({ length: REEL_BLUR_FILTERS }, (_, i) =>
    `<filter id="pl-reel-blur-${i}"><feGaussianBlur stdDeviation="0 0"/></filter>`).join('')}</svg>`;
  document.body.appendChild(host);
  reelBlurReady = true;
}

// Monte vite pendant la phase rapide de la course, retombe a zero pile a
// l'atterrissage. Le rouleau au repos est NET, jamais baveux. Pilote au
// TIMER (30 fps, largement assez pour un flou) et pas en rAF : un onglet
// occulte affame le rAF et le flou resterait fige en pleine valeur.
function decayReelBlur(strip, col, delayMs) {
  const filter = document.querySelector(`#pl-reel-blur-${Math.min(col, REEL_BLUR_FILTERS - 1)} feGaussianBlur`);
  if (!filter || typeof performance === 'undefined') return;
  const start = performance.now() + delayMs;
  const timer = setInterval(() => {
    if (!strip.isConnected) { filter.setAttribute('stdDeviation', '0 0'); clearInterval(timer); return; }
    const t = (performance.now() - start) / REEL_DUR_MS;
    if (t < 0) return;
    const v = t >= 1 ? 0 : 3 * (1 - t) * Math.min(1, t * 5);
    filter.setAttribute('stdDeviation', `0 ${v.toFixed(2)}`);
    if (t >= 1) clearInterval(timer);
  }, 33);
}

function rollNumberTo(el, previousText, nextText) {
  const prevDigits = String(previousText || '').replace(/\D/g, '');
  const nextDigits = String(nextText || '').replace(/\D/g, '');
  if (!previousText || !prevDigits || !nextDigits || prefersReducedMotion()) {
    el.textContent = nextText;
    return;
  }
  const up = (Number(nextDigits) || 0) >= (Number(prevDigits) || 0);
  // Colonne a colonne, alignees par la droite : 96 -> 108 compare 096 a 108.
  const prevPadded = prevDigits.padStart(nextDigits.length, '0').slice(-nextDigits.length);
  ensureReelBlurFilters();
  let digitIndex = 0;
  let html = '';
  for (const ch of String(nextText)) {
    if (!/\d/.test(ch)) { html += `<span>${escapeHtml(ch)}</span>`; continue; }
    const from = Number(prevPadded[digitIndex]);
    const to = Number(ch);
    // Un tour d'elan (10 cellules) + la distance jusqu'au chiffre cible.
    const travel = 10 + ((up ? to - from : from - to) + 10) % 10;
    const cells = [];
    // La piste liste les chiffres DANS L'ORDRE ou la fenetre les traverse.
    // Vers le bas, la meme course se joue a l'envers : la piste part deja
    // deroulee et redescend (les chiffres defilent visuellement vers le bas).
    for (let s = 0; s <= travel; s += 1) cells.push(`<span class="t-reel-digit">${up ? (from + s) % 10 : (to + s) % 10}</span>`);
    html += `<span class="t-reel-col"><span class="t-reel-strip${up ? '' : ' is-down'}" data-col="${digitIndex}" data-travel="${travel}">${cells.join('')}</span></span>`;
    digitIndex += 1;
  }
  // La VRAIE valeur reste lisible pendant tout le spin : la synthese vocale
  // et tout lecteur de texte recoivent le montant pose, jamais la piste de
  // chiffres de l'echafaudage (qui est purement decoratif, donc aria-hidden).
  el.innerHTML = `<span class="visually-hidden">${escapeHtml(nextText)}</span><span class="t-reel" aria-hidden="true">${html}</span>`;
  const strips = [...el.querySelectorAll('.t-reel-strip')];
  strips.forEach((strip) => {
    const col = Number(strip.dataset.col);
    const travel = Number(strip.dataset.travel);
    const down = strip.classList.contains('is-down');
    strip.style.transform = down ? `translateY(calc(${-travel} * var(--reel-cell)))` : 'translateY(0)';
    strip.style.filter = `url(#pl-reel-blur-${Math.min(col, REEL_BLUR_FILTERS - 1)})`;
    // Double rAF : la position de depart doit etre PEINTE avant que la
    // transition ne parte, sinon le rouleau se teleporte.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      strip.style.transition = `transform ${REEL_DUR_MS}ms cubic-bezier(0.16, 1, 0.3, 1) ${col * REEL_STAGGER_MS}ms`;
      strip.style.transform = down ? 'translateY(0)' : `translateY(calc(${-travel} * var(--reel-cell)))`;
    }));
    decayReelBlur(strip, col, col * REEL_STAGGER_MS);
  });
  // La structure de roulement est un echafaudage : une fois tous les rouleaux
  // poses, la valeur redevient du texte simple (rien a nettoyer ensuite).
  const guard = el.getAttribute('data-amount');
  const settleMs = REEL_DUR_MS + REEL_STAGGER_MS * Math.max(0, strips.length - 1) + 80;
  setTimeout(() => {
    if (el.getAttribute('data-amount') === guard) el.textContent = guard;
  }, settleMs);
}

function toggleBookingActivity(activityId) {
  const selection = state.booking.activities || (state.booking.activities = {});
  if (selection[activityId]) {
    delete selection[activityId];
  } else {
    // Le defaut suit le TYPE de tarif, pas l'identifiant : sinon le duckpin,
    // qui vend des pistes comme le bowling, demarrait sans duree.
    const type = (typeof getCenterActivity === 'function' && getCenterActivity(activityId) || {}).priceType || '';
    selection[activityId] = type === 'grid_bowling' ? { duration: 1 }
      : type === 'grid_laser' ? { games: 1 }
      : type === 'grid_fun_run' ? { minutes: FUN_RUN_OPTIONS[0].minutes }
      : {};
  }
  state.booking.mode = 'carte';
  state.booking.formuleId = '';
  clearCurrentBookingChoice();
  clearBookingAlternatives();
  applyChosenActivitiesToBooking();
  syncBookingTypeUi();
  updatePaxAlert();
  save();
}

function setBookingActivityOption(activityId, key, value) {
  const selection = state.booking.activities || (state.booking.activities = {});
  if (!selection[activityId]) selection[activityId] = {};
  selection[activityId][key] = Number(value);
  clearCurrentBookingChoice();
  applyChosenActivitiesToBooking();
  syncBookingTypeUi();
  save();
}

// Le stepper -/+ du compte d'enfants. Il lit l'etat (defaut = groupe entier,
// meme regle que le serveur), applique le pas et borne au groupe : le bouton
// n'a pas a connaitre la valeur courante au moment du rendu.
function stepBookingChildren(activityId, delta) {
  const selection = state.booking.activities || {};
  const options = selection[activityId] || {};
  const pax = Math.max(1, Number(state.booking.pax) || 1);
  const ceiling = Math.min(30, pax);
  const current = Math.min(ceiling, Math.max(1, Number(options.participants) || ceiling));
  setBookingActivityOption(activityId, 'participants', Math.min(ceiling, Math.max(1, current + Number(delta))));
}

// Les champs historiques (duration, laneCount, totalDuration) restent remplis :
// tout le reste du tunnel les lit encore, et une visite mono-activite doit
// produire exactement la meme requete qu'avant.
function applyChosenActivitiesToBooking() {
  const chosen = getChosenActivities();
  const pax = Math.max(1, Number(state.booking.pax) || 1);
  const bowling = chosen.find(activity => activity.id === 'bowling');
  const laser = chosen.find(activity => activity.id === 'laser_game');
  if (bowling) {
    state.booking.duration = Number(bowling.options.duration) || 1;
    state.booking.laneCount = getRequiredLaneCount('bowling', pax, '');
  } else if (laser) {
    state.booking.duration = Number(LASER_GAME_OPTIONS.find(option => Number(option.games) === (Number(laser.options.games) || 1))?.value) || 0.5;
    state.booking.laneCount = 0;
    state.booking.allocatedLanes = [];
  }
  state.booking.totalDuration = state.booking.duration;
  state.booking.preference = createDefaultFormulaPreference();
  state.booking.pauseMinutes = 0;
}

// Le panier envoye au serveur. Il ne porte que des identifiants et des options :
// AUCUN prix. Le montant est recalcule cote serveur, toujours.
function buildBookingProgramPayload() {
  return getChosenActivities().map(activity => {
    const options = activity.options || {};
    if (activity.id === 'bowling') return { activityId: 'bowling', duration: Number(options.duration) || 1 };
    if (activity.id === 'laser_game') return { activityId: 'laser_game', games: Number(options.games) || 1 };
    const item = { activityId: activity.id };
    if (options.units) item.units = Number(options.units);
    if (options.hours) item.hours = Number(options.hours);
    // Le compte d'enfants declare part au serveur, qui le borne au groupe et
    // recalcule le prix (le navigateur n'est jamais cru sur un montant).
    if (options.participants) item.participants = Number(options.participants);
    return item;
  });
}

// Un segment ferme est DESACTIVE (disabled natif : le onclick inline ne part
// pas) ET porte le mot "Fermé". Jamais l'un sans l'autre.
function applySegmentOffState(id, isOff) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.classList.toggle('is-off', !!isOff);
  btn.disabled = !!isOff;
  btn.setAttribute('aria-disabled', isOff ? 'true' : 'false');
  let pill = btn.querySelector('.seg-btn-off');
  if (isOff && !pill) {
    pill = document.createElement('span');
    pill.className = 'seg-btn-off';
    pill.textContent = 'Fermé';
    btn.appendChild(pill);
  }
  if (pill) pill.hidden = !isOff;
}

function renderTypeAlert(off, dayStatus) {
  const el = document.getElementById('typeAlert');
  if (!el) return;
  if (!dayStatus || !off.length) { el.innerHTML = ''; return; }
  const labels = { bowling: 'Bowling', laser_game: 'Laser Game' };
  const named = (id) => labels[id]
    || (typeof getCenterActivity === 'function' ? getCenterActivity(id)?.name : '')
    || id;
  const noms = off.map(named).join(' et ');
  const reste = off.length >= 2
    ? 'Les formules sans ces activités restent réservables ce jour.'
    : 'Le reste du centre et les formules restent réservables ce jour.';
  el.innerHTML = renderDayStatusBlock('is-partial', `${noms} fermé${off.length > 1 ? 's' : ''} le ${formatBookingDateLong(dayStatus.date)}`, reste);
}

function clearCurrentBookingChoice() {
  state.availableSlots = [];
  state.booking.startTime = '';
  state.booking.allocatedLanes = [];
  state.booking.opsPlan = null;
}

// setType garde son nom (appele par le HTML et par d'anciens etats sauvegardes)
// mais bascule desormais un MODE : 'carte' (composer sa visite) ou 'formule'.
// Les anciennes valeurs 'bowling' / 'laser' cochent l'activite correspondante.
function setType(t) {
  clearCurrentBookingChoice();
  clearBookingAlternatives();
  if (t === 'formule') {
    state.booking.mode = 'formule';
    state.booking.activities = {};
  } else {
    state.booking.mode = 'carte';
    state.booking.formuleId = '';
    if (!state.booking.activities || !Object.keys(state.booking.activities).length) {
      state.booking.activities = t === 'laser' ? { laser_game: { games: 1 } } : { bowling: { duration: 1 } };
    } else if (t === 'bowling' || t === 'laser') {
      state.booking.activities = t === 'laser' ? { laser_game: { games: 1 } } : { bowling: { duration: 1 } };
    }
    applyChosenActivitiesToBooking();
  }
  syncBookingTypeUi();
  renderFormules();
  renderFormulaPreferences();
  updatePaxAlert();
  save();
}

const ACTIVITY_LABELS = {
  bowling: 'Bowling',
  laser_game: 'Laser Game',
  minigolf_blacklight: 'Mini Golf',
  arcade_time: 'Arcades',
  playground: 'Plaine de jeux',
  party_table: 'Table',
};

// Modèle « Ancres + Liberté » : le client choisit une heure PAR ANCRE
// (bowling, laser), plus d'ordre imposé ni de mode « Fun Galaxy organise /
// Je choisis ». Les activités libres restent un pass sans aucune heure.
function createDefaultFormulaPreference(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const preferred = source.preferredTimes && typeof source.preferredTimes === 'object' ? source.preferredTimes : {};
  return {
    arrivalConfidence: source.arrivalConfidence === 'uncertain' ? 'uncertain' : 'normal',
    laserPlacement: source.laserPlacement === 'onsite' ? 'onsite' : 'scheduled',
    preferredTimes: {
      bowling: typeof preferred.bowling === 'string' ? preferred.bowling : '',
      laser_game: typeof preferred.laser_game === 'string' ? preferred.laser_game : '',
    },
  };
}

function formulaActivityToken(text = '') {
  return String(text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function getFormulaActivityIds(formule) {
  if (!formule) return [];
  const detected = [];
  const addDetected = (id) => {
    if (!detected.includes(id)) detected.push(id);
  };
  (formule.desc || []).forEach((line) => {
    const normalized = formulaActivityToken(line);
    if (normalized.includes('cruche') || normalized.includes('boisson') || normalized.includes('biere')) return;
    if (normalized.includes('table privee') || normalized.includes('table anniversaire')) addDetected('party_table');
    if (normalized.includes('plaine')) addDetected('playground');
    if (normalized.includes('minigolf') || normalized.includes('mini golf')) addDetected('minigolf_blacklight');
    if (normalized.includes('bowling')) addDetected('bowling');
    if (normalized.includes('laser')) addDetected('laser_game');
    if (normalized.includes('arcade')) addDetected('arcade_time');
  });
  return detected;
}

function getFormulaActivityCounts(formule) {
  const counts = {};
  const lines = (formule?.desc || []).map(line => formulaActivityToken(line));
  const setCount = (id, count = 1) => {
    counts[id] = Math.max(counts[id] || 0, count);
  };
  lines.forEach((line) => {
    const numberMatch = line.match(/(\d+)\s+(?:partie|parties|entree|entrees|heure|heures|h)\b/);
    const count = numberMatch ? Math.max(1, Number(numberMatch[1])) : 1;
    if (line.includes('bowling')) setCount('bowling', 1);
    if (line.includes('laser')) setCount('laser_game', line.includes('illimite') ? 1 : count);
    if (line.includes('minigolf') || line.includes('mini golf')) setCount('minigolf_blacklight', count);
    if (line.includes('arcade')) setCount('arcade_time', 1);
    if (line.includes('plaine')) setCount('playground', count);
    if (line.includes('table privee') || line.includes('table anniversaire')) setCount('party_table', 1);
  });
  return counts;
}

function getFormulaActivityLabel(formule, activityId) {
  const counts = getFormulaActivityCounts(formule);
  const count = Number(counts[activityId] || 1);
  const label = ACTIVITY_LABELS[activityId] || activityId;
  if (activityId === 'bowling') return `${label} ${formatDurationLabel(getFormuleLaneDuration(formule))}`;
  if (activityId === 'laser_game' && count > 1) return `${label} x${count}`;
  return label;
}

// Classification client d'une formule (miroir du serveur) :
// - ANCRES : bowling et laser uniquement (vraies ressources à créneau).
// - TABLE : au groupe dès l'arrivée, jamais choisie.
// - PASS LIBERTÉ : tout le reste, sans aucune heure.
function getFormulaAnchorIds(formule) {
  return getFormulaActivityIds(formule).filter((id) => ['bowling', 'laser_game'].includes(id));
}

function getFormulaFreePassIds(formule) {
  return getFormulaActivityIds(formule).filter((id) => !['bowling', 'laser_game', 'party_table'].includes(id));
}

function formulaHasPartyTable(formule) {
  return getFormulaActivityIds(formule).includes('party_table');
}

function ensureFormulaPreferences(formule) {
  const preference = createDefaultFormulaPreference(state.booking.preference || {});
  const anchorIds = getFormulaAnchorIds(formule);
  if (!anchorIds.includes('bowling')) preference.preferredTimes.bowling = '';
  if (!anchorIds.includes('laser_game')) preference.preferredTimes.laser_game = '';
  if (!anchorIds.includes('laser_game') || anchorIds.length < 2) preference.laserPlacement = 'scheduled';
  state.booking.preference = preference;
  state.booking.pauseMinutes = 0;
}

// Étape 1 : simple annonce du modèle, le vrai choix (une heure par ancre)
// vit à l'étape Créneau. Plus de mode « Fun Galaxy organise / Je choisis ».
function renderFormulaPreferences() {
  const box = document.getElementById('formulaPrefs');
  const orderEl = document.getElementById('formulaOrderOptions');
  const noteEl = document.getElementById('formulaPreferenceNote');
  if (!box || !orderEl || !noteEl) return;
  const formule = state.booking.type === 'formule' ? FORMULES.find(x => x.id === state.booking.formuleId) : null;
  if (!formule) {
    box.classList.add('hidden');
    orderEl.innerHTML = '';
    noteEl.textContent = '';
    return;
  }
  ensureFormulaPreferences(formule);
  const anchorIds = getFormulaAnchorIds(formule);
  const freeIds = getFormulaFreePassIds(formule);
  const hasTable = formulaHasPartyTable(formule);
  box.classList.remove('hidden');
  noteEl.textContent = anchorIds.length
    ? 'À l’étape suivante, choisissez une heure pour chaque activité à créneau, le reste se vit librement sur place.'
    : 'À l’étape suivante, choisissez simplement votre heure d’arrivée, tout le reste se vit librement sur place.';
  orderEl.innerHTML = `
    <div class="formula-model-preview">
      ${anchorIds.length ? `
      <div class="formula-model-line">
        <span class="formula-model-tag reserved">Heure à choisir</span>
        <span>${anchorIds.map(id => escapeHtml(getFormulaActivityLabel(formule, id))).join(' · ')}</span>
      </div>` : ''}
      ${hasTable ? `
      <div class="formula-model-line">
        <span class="formula-model-tag table">Table</span>
        <span>Votre table vous attend dès votre arrivée, pendant toute la visite</span>
      </div>` : ''}
      ${freeIds.length ? `
      <div class="formula-model-line">
        <span class="formula-model-tag free">Pass liberté</span>
        <span>${freeIds.map(id => escapeHtml(getFormulaActivityLabel(formule, id))).join(' · ')}, à votre rythme, quand vous voulez</span>
      </div>` : ''}
    </div>`;
}

function selectFormule(id) {
  state.booking.formuleId = id;
  clearBookingAlternatives();
  state.booking.startTime = '';
  state.booking.preference = createDefaultFormulaPreference();
  state.booking.opsPlan = null;
  const formule = FORMULES.find(x => x.id === id);
  if (formule) {
    state.booking.duration = getFormuleLaneDuration(formule);
    state.booking.totalDuration = getFormuleTotalDuration(formule);
    ensureFormulaPreferences(formule);
  }
  renderFormules();
  renderFormulaPreferences();
  updatePaxAlert();
  save();
}

function updateProgress() {
  for (let i = 1; i <= 5; i++) {
    const el = document.getElementById('pd' + i);
    el.classList.remove('active', 'done');
    if (i < state.step) el.classList.add('done');
    if (i === state.step) el.classList.add('active');
  }
  // Le FLUIDE avance jusqu'à la pastille courante : --p vaut 0 à l'étape 1 et
  // 1 à la dernière. Sous filtre gooey, la tête s'étire depuis le remplissage
  // comme une goutte (transition de width, calque .lq-fluid).
  const progress = document.querySelector('#clientView .progress');
  if (progress) progress.style.setProperty('--p', String(((Number(state.step) || 1) - 1) / 4));
}

function showAlert(msg) {
  const el = document.getElementById('alertBox');
  el.innerHTML = `<div class="alert shake"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> ${escapeHtml(msg)}</div>`;
  setTimeout(() => { el.innerHTML = ''; }, 4500);
}

// Erreur au champ (P2-1, DESIGN.md §6) : aria-invalid → bordure --danger
// (pinlane.css) + message 12px role="alert" injecté juste sous le champ.
function clearFieldError(inputId) {
  const input = document.getElementById(inputId);
  if (!input || !input.parentElement) return;
  input.removeAttribute('aria-invalid');
  const message = input.parentElement.querySelector('.field-error-message');
  if (message) message.remove();
}

function setFieldError(inputId, text) {
  const input = document.getElementById(inputId);
  if (!input || !input.parentElement) return;
  input.setAttribute('aria-invalid', 'true');
  let message = input.parentElement.querySelector('.field-error-message');
  if (!message) {
    message = document.createElement('div');
    message.className = 'field-error-message';
    message.setAttribute('role', 'alert');
    input.insertAdjacentElement('afterend', message);
  }
  message.textContent = text;
}

// Purge la proposition d'horaires alternatifs (état + DOM). Appelée dès que le
// contexte de réservation change : nouvelle recherche, reset, changement de
// date/joueurs/activité/formule, réservation confirmée. Sans ça, la carte
// d'alternatives restait affichée indéfiniment dans #alertBox.
function clearBookingAlternatives() {
  if (state.booking) state.booking.alternatives = [];
  const el = document.getElementById('alertBox');
  if (el && el.querySelector('.booking-alternatives')) el.innerHTML = '';
}

function showBookingAlternatives(message, alternatives = []) {
  const el = document.getElementById('alertBox');
  if (!el) return;
  const safeAlternatives = alternatives.slice(0, 5);
  state.booking.alternatives = safeAlternatives;
  el.innerHTML = `
    <div class="alert booking-alternatives">
      <div class="booking-alt-head">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <strong>${escapeHtml(message || 'Ce créneau ne tient plus.')}</strong>
      </div>
      <div class="booking-alt-list">
        ${safeAlternatives.map((alternative, index) => `
          <button type="button" class="booking-alt-option" onclick="applyBookingAlternative(${index})">
            <span>${escapeHtml(alternative.summary || `${alternative.date} ${alternative.startTime}`)}</span>
            <small>${escapeHtml(alternative.date || '')} · ${escapeHtml(alternative.validationStatus === 'staff_review' ? 'à vérifier staff' : 'confirmable')}</small>
          </button>
        `).join('')}
      </div>
    </div>`;
}

function applyBookingAlternative(index) {
  const alternative = (state.booking.alternatives || [])[index];
  if (!alternative) return;
  state.booking.date = alternative.date || state.booking.date;
  state.booking.startTime = alternative.startTime || state.booking.startTime;
  state.booking.opsPlan = alternative.opsPlan || null;
  state.booking.allocatedLanes = alternative.lanes || alternative.opsPlan?.assignedLanes || [];
  if (state.booking.type === 'formule' && alternative.opsPlan) {
    // Aligne les ancres choisies sur l'alternative retenue : le serveur
    // revalidera exactement cette combinaison à la confirmation.
    state.booking.preference = createDefaultFormulaPreference({
      ...(state.booking.preference || {}),
      preferredTimes: {
        bowling: alternative.opsPlan.firstBowlingTime || '',
        laser_game: alternative.opsPlan.firstLaserTime || '',
      },
      laserPlacement: alternative.opsPlan.firstLaserTime ? 'scheduled' : (state.booking.preference?.laserPlacement || 'scheduled'),
    });
  }
  save();
  renderRecap();
  goStep(4);
  showAlert('Alternative appliquée. Vérifiez le récapitulatif avant confirmation.');
}

// --- Changement d'étape : la PISTE GLISSE (scène horizontale) ----------------
// Les cinq étapes vivent côte à côte dans `.tunnel-track` ; changer d'étape,
// c'est déplacer la piste (translateX + ressort, variable --tstep). Le sens du
// parcours est raconté par le glissement lui-même, la cascade pose ensuite les
// blocs de l'étape arrivée.
//
// Trois propriétés non négociables :
//  1. l'état (`state.step`) et le DOM de l'étape qui arrive sont corrects DÈS
//     l'appel : rien dans le produit ni dans un gate n'attend une animation ;
//  2. seule la piste bouge (`transform`), aucune hauteur ne s'anime, la page
//     ne défile JAMAIS (elle n'a pas de défilement : une étape = un écran) ;
//  3. les étapes non courantes sont INERTES (`inert` + aria-hidden) : le
//     clavier et le lecteur d'écran ne voient que l'écran affiché.
const STEP_LABELS = { 1: 'Activité', 2: 'Créneau', 3: 'Contact', 4: 'Valider', 5: 'Confirmé' };
let stepArrivalTimer = null;

function prefersReducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// La scene ne defile JAMAIS elle-meme. Sa boite est overflow:hidden, mais un
// scrollIntoView ou le focus d'un champ (clavier de telephone) peut quand meme
// pousser son scrollLeft : toutes les etapes se desaxent alors d'un coup sans
// que l'etat change (mesure 2026-08-18 a 390x844 : step1 rejete a x=-188).
// Le verrou remet zero a chaque tentative, et goStep repart toujours de zero.
let stageScrollLockArmed = false;
function lockStageScroll() {
  const stage = document.querySelector('#clientView .tunnel-stage');
  if (!stage) return;
  stage.scrollLeft = 0;
  stage.scrollTop = 0;
  if (stageScrollLockArmed) return;
  stageScrollLockArmed = true;
  stage.addEventListener('scroll', () => {
    if (stage.scrollLeft) stage.scrollLeft = 0;
    if (stage.scrollTop) stage.scrollTop = 0;
  }, { passive: true });
}

function goStep(n, options = {}) {
  const previous = Number(state.step) || 1;
  const target = document.getElementById('step' + n);
  if (!target) return;
  lockStageScroll();
  const reduce = prefersReducedMotion();
  const animate = !reduce && options.animate !== false && previous !== n;

  if (stepArrivalTimer) { clearTimeout(stepArrivalTimer); stepArrivalTimer = null; }
  ['step1', 'step2', 'step3', 'step4', 'step5'].forEach((id) => {
    const element = document.getElementById(id);
    if (!element) return;
    const current = element === target;
    element.classList.toggle('is-current', current);
    // `inert` coupe clic, focus et lecture d'écran d'un seul attribut : une
    // étape hors champ n'existe pour personne. La courante redevient vivante.
    if (current) {
      element.removeAttribute('inert');
      element.removeAttribute('aria-hidden');
    } else {
      element.setAttribute('inert', '');
      element.setAttribute('aria-hidden', 'true');
      delete element.dataset.arrived;
    }
  });

  // La piste glisse jusqu'à l'étape. Sans animation (reduced motion, boot),
  // la transition est coupée le temps de poser la position. Pendant le voyage,
  // is-travelling rend les étapes voisines visibles en profondeur (CSS).
  const track = document.getElementById('tunnelTrack');
  if (track) {
    if (!animate) track.style.transition = 'none';
    else track.classList.add('is-travelling');
    track.style.setProperty('--tstep', String(n));
    if (!animate) {
      // Reflow volontaire : la position se pose AVANT que la transition revive.
      void track.offsetWidth;
      track.style.removeProperty('transition');
    }
  }

  if (animate) {
    // Signal de cascade : les blocs `.cascade` de l'étape arrivée se posent en
    // ressort. Le signal vit le temps des animations (délai max 135 ms +
    // 500 ms de course), puis s'éteint pour ne jamais rejouer sur un rendu.
    // is-travelling s'éteint au même moment : les voisines redisparaissent.
    target.dataset.arrived = '1';
    stepArrivalTimer = setTimeout(() => {
      stepArrivalTimer = null;
      delete target.dataset.arrived;
      if (track) track.classList.remove('is-travelling');
    }, 700);
  }

  state.step = n;
  const clientView = document.getElementById('clientView');
  if (clientView) clientView.dataset.step = String(n);
  updateProgress();
  // Le focus suit l'étape qui arrive : sans ça, le clavier retombe sur <body>
  // et le parcours est cassé pour qui ne se sert pas d'une souris.
  const heading = document.getElementById('stepHeading');
  if (heading) {
    heading.textContent = `Étape ${n} sur 5 : ${STEP_LABELS[n] || ''}`;
    if (options.focus !== false) heading.focus({ preventScroll: true });
  }
  // Le dock telephone n'a voix qu'a l'etape 1 : il se tait des qu'on la quitte.
  if (typeof syncStatusDock === 'function') syncStatusDock();
  save();
}

function setStep1Busy(isBusy) {
  const btn = document.getElementById('btnStep1');
  if (!btn) return;
  btn.disabled = !!isBusy;
  btn.innerHTML = isBusy
    ? 'Recherche des cr\u00e9neaux...'
    : `V\u00e9rifier les disponibilit\u00e9s
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>`;
}

// LE SCEAU. Le clic a plus fort enjeu du tunnel accuse reception, travaille,
// puis scelle : le libelle s'efface, un disque se pose, il respire le temps de
// l'appel reseau, et la coche se dessine trait par trait. Le bouton garde sa
// boite : aucune largeur ni hauteur n'est animee, seul son contenu change
// d'etat (recette 4 du catalogue, adaptee exactement comme il le prescrit).
const SEAL_MARKUP = [
  '<span class="btn-label">Confirmer la réservation',
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>',
  // Le disque : c'est LUI qui reste quand la pilule se dissout (morph assume).
  '<span class="btn-seal" aria-hidden="true"><span class="btn-seal-disc"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">',
  '<circle class="btn-seal-ring" cx="12" cy="12" r="10" opacity="0.35"/>',
  '<path class="btn-seal-check" d="M19 7.5 10 17l-5-5"/></svg></span></span>',
].join('');

function ensureSealMarkup(button) {
  if (!button || button.querySelector('.btn-seal')) return;
  button.innerHTML = SEAL_MARKUP;
}

function setBookingSubmitBusy(isBusy) {
  const confirmBtn = document.getElementById('btnConfirmBooking');
  const backBtn = document.getElementById('btnStep4Back');
  if (confirmBtn) {
    ensureSealMarkup(confirmBtn);
    confirmBtn.disabled = !!isBusy;
    // Le libelle reste dans le DOM (il porte le nom accessible du bouton) :
    // c'est son opacite qui s'efface, jamais son texte qui disparait.
    confirmBtn.setAttribute('aria-busy', isBusy ? 'true' : 'false');
    confirmBtn.classList.toggle('is-sealing', !!isBusy);
    if (!isBusy) confirmBtn.classList.remove('is-sealed');
  }
  if (backBtn) backBtn.disabled = !!isBusy;
}

// Succes : le disque cesse de respirer, la coche se dessine, puis on quitte.
function sealBookingSubmit() {
  const confirmBtn = document.getElementById('btnConfirmBooking');
  if (!confirmBtn) return Promise.resolve();
  ensureSealMarkup(confirmBtn);
  confirmBtn.classList.remove('is-sealing');
  confirmBtn.classList.add('is-sealed');
  confirmBtn.setAttribute('aria-busy', 'false');
  if (prefersReducedMotion()) return Promise.resolve();
  // 50 ms d'attente + 220 ms de trace : on laisse la coche se finir avant de
  // quitter l'ecran, sinon le sceau ne se voit jamais.
  return new Promise((resolve) => setTimeout(resolve, 320));
}

async function goStep2() {
  if (isPastBusinessDate(state.booking.date)) {
    showAlert('Cette date est déjà passée. Vous ne pouvez plus réserver pour ce jour.');
    return;
  }
  // getSchedule integre desormais le verdict serveur du jour : une fermeture
  // ponctuelle posee depuis le cockpit rend null ici, exactement comme un lundi.
  const schedule = getSchedule(state.booking.date, state.isHolidayMode);
  if (!schedule) { showAlert('Le centre est fermé à cette date. Choisissez une autre date.'); return; }
  const pax = Number(state.booking.pax) || 0;
  if (pax < 1) { showAlert('Nombre de joueurs invalide.'); return; }
  if (normalizeBookingMode(state.booking.mode) === 'carte' && !getChosenActivities().length) {
    showAlert('Choisissez au moins une activité.');
    return;
  }
  if (state.booking.type === 'formule') {
    const formule = FORMULES.find(x => x.id === state.booking.formuleId);
    if (!formule) { showAlert('Sélectionnez une formule.'); return; }
    const availability = getFormuleAvailability(formule, state.booking.date, pax);
    if (!availability.ok) { showAlert(availability.message); return; }
  }
  goStep(2);
  await fetchSlots({ showLoading: true });
}

async function fetchSlots(options = {}) {
  const requestId = ++slotFetchRequestId;
  // Un ancien prix ne doit jamais survivre a une nouvelle recherche. La reponse
  // courante remettra le programme normalise si le type est bien une visite.
  state.booking.serverProgram = null;
  if (!options.keepAlternatives) clearBookingAlternatives();
  const formule = state.booking.type === 'formule' ? FORMULES.find(x => x.id === state.booking.formuleId) : null;
  if (options.showLoading !== false) {
    slotLoading = true;
    state.availableSlots = [];
    // Nouvelle recherche assumée (arrivée sur l'étape, autre date) : les pistes
    // repartiront centrées sur l'heure proposée, pas sur un vieux défilement.
    anchorTrackScrollMemory.clear();
    renderSlots(formule);
  }
  setStep1Busy(true);

  try {
    const params = new URLSearchParams({
      date: state.booking.date,
      type: state.booking.type,
      pax: String(Number(state.booking.pax) || 1),
      // Le centre part avec CHAQUE demande de disponibilite : sans lui, l'API
      // retombe sur 'libramont' et affiche les creneaux de Fun Galaxy sur le
      // site d'un autre client.
      centerId: String(typeof getTunnelCenterId === 'function' ? getTunnelCenterId() : 'libramont')
    });
    if (state.booking.type === 'formule') {
      const preference = createDefaultFormulaPreference(state.booking.preference || {});
      params.set('formuleId', state.booking.formuleId || '');
      const chosenTimes = {};
      if (preference.preferredTimes.bowling) chosenTimes.bowling = preference.preferredTimes.bowling;
      if (preference.preferredTimes.laser_game && preference.laserPlacement !== 'onsite') {
        chosenTimes.laser_game = preference.preferredTimes.laser_game;
      }
      if (Object.keys(chosenTimes).length) params.set('preferredTimes', JSON.stringify(chosenTimes));
      if (preference.laserPlacement === 'onsite') params.set('laserPlacement', 'onsite');
    } else if (state.booking.type === 'visite') {
      // Le panier part tel quel : le serveur le renormalise et recalcule tout
      // (activites reellement vendues par ce centre, options, prix).
      params.set('program', JSON.stringify(buildBookingProgramPayload()));
      const preference = createDefaultFormulaPreference(state.booking.preference || {});
      const chosenTimes = {};
      if (preference.preferredTimes.bowling) chosenTimes.bowling = preference.preferredTimes.bowling;
      if (preference.preferredTimes.laser_game) chosenTimes.laser_game = preference.preferredTimes.laser_game;
      if (Object.keys(chosenTimes).length) params.set('preferredTimes', JSON.stringify(chosenTimes));
    } else {
      params.set('duration', String(state.booking.duration));
      if (state.booking.type === 'laser') params.set('laserGames', String(getLaserGameCount(state.booking.duration)));
    }

    const payload = await apiRequest(`${API_ENDPOINTS.publicAvailability || '/api/public-availability'}?${params.toString()}`, {
      method: 'GET'
    });
    if (requestId !== slotFetchRequestId) return;

    slotLoadFailed = false;
    state.availableSlots = filterPastSlotsForDate(payload.slots || [], state.booking.date);
    formulaAnchorData = payload.anchors || null;
    formulaAnchorMessage = state.availableSlots.length ? '' : (payload.message || '');
    formulaAnchorSuggestions = Array.isArray(payload.suggestions) ? payload.suggestions : [];
    resetFormulaProgramChoice();
    adoptDefaultFormulaAnchors();
    state.booking.laneCount = Number(payload.laneCount || 0);
    state.booking.duration = Number(payload.duration || state.booking.duration || 0);
    state.booking.totalDuration = state.booking.type === 'laser'
      ? Number(state.booking.duration || 0.5) * getLaserWaveCount(state.booking.pax)
      : Number(payload.totalDuration || payload.duration || state.booking.totalDuration || 0);
    state.booking.serverProgram = state.booking.type === 'visite'
      && payload.program && Array.isArray(payload.program.items)
      ? payload.program
      : null;
    state.booking.opsPlan = null;
  } catch (error) {
    if (requestId !== slotFetchRequestId) return;
    state.availableSlots = [];
    formulaAnchorData = null;
    formulaAnchorMessage = '';
    formulaAnchorSuggestions = [];
    // Panne serveur ≠ zéro créneau : renderSlots affiche l'état d'erreur
    // dédié (role="alert" + bouton Réessayer), pas l'état vide.
    slotLoadFailed = true;
    slotLoadFailedMessage = error.message || '';
  }

  if (requestId !== slotFetchRequestId) return;
  slotLoading = false;
  // `render: false` : l'appelant (revalidation en place) décide lui-même de la
  // mise à jour du DOM : deux rendus complets dos à dos faisaient clignoter.
  if (options.render !== false) renderSlots(formule);
  setStep1Busy(false);
}

function describeSlotPlan(plan) {
  if (!plan) return '';
  const bits = [];
  if (plan.firstBowlingTime) bits.push(`Bowling ${plan.firstBowlingTime}`);
  if (plan.firstLaserTime) bits.push(`Laser ${plan.firstLaserTime}`);
  if (plan.endTime) bits.push(`fin ${plan.endTime}`);
  if (!bits.length && plan.staffSummary) return plan.staffSummary.split('|').slice(0, 2).join(' • ');
  return bits.join(' • ');
}

// Heure d'une ancre dans un créneau : jamais les étapes « flexible » (pass
// liberté), qui n'ont pas d'horaire propre.
function getFormulaSlotActivityTime(slot, activityId) {
  const plan = slot?.opsPlan || {};
  if (activityId === 'bowling' && plan.firstBowlingTime) return plan.firstBowlingTime;
  if (activityId === 'laser_game' && plan.firstLaserTime) return plan.firstLaserTime;
  const item = (plan.timeline || []).find(step => step.activityId === activityId && !step.flexible);
  return item?.startTime || '';
}

// --- Picker formule « Ancres + Liberté » -------------------------------------
// Une ligne par ANCRE (Bowling, Laser) avec ses chips d'heures :00/:30. Le
// serveur pré-sélectionne une combinaison valide (zéro friction) ; chaque
// ancre reste modifiable indépendamment, avec revalidation serveur en direct.
// La table suit l'arrivée (jamais choisie) et le pass liberté n'affiche
// JAMAIS d'heure : ni ici, ni au récap, ni dans le mail.
let formulaArrivalChoice = '';      // formules sans ancre : heure d'arrivée
let formulaAnchorData = null;       // bloc `anchors` renvoyé par le serveur
let formulaAnchorMessage = '';      // message de refus de combinaison
let formulaAnchorSuggestions = [];  // combinaisons proches proposées
let formulaAnchorBusy = false;      // revalidation en cours
let formulaAdviceSignature = '';    // avis de confort deja entre en scene
let formulaAdviceDismissed = '';    // avis que le client a choisi d ecarter
let formulaJustPicked = null;       // heure qui vient d'etre retenue (capsule)

function resetFormulaProgramChoice() {
  formulaArrivalChoice = '';
}

function formulaHasAnchorUi() {
  return Boolean(formulaAnchorData && Array.isArray(formulaAnchorData.activities) && formulaAnchorData.activities.length);
}

// Défaut zéro friction : à l'arrivée sur l'étape, la combinaison valide
// proposée par le serveur est pré-sélectionnée : chaque ancre reste modifiable.
function adoptDefaultFormulaAnchors() {
  // Une VISITE composée à la carte a exactement les mêmes ancres qu'une
  // formule : elle mérite la même proposition d'ouverture. Tant que cette
  // condition exigeait « formule », le client arrivait sur l'écran sans
  // aucune heure retenue.
  if (!['formule', 'visite'].includes(state.booking.type) || !formulaHasAnchorUi()) return;
  const preference = createDefaultFormulaPreference(state.booking.preference || {});
  let changed = false;
  formulaAnchorData.activities.forEach((activity) => {
    if (activity.activityId === 'laser_game' && preference.laserPlacement === 'onsite') return;
    const fallback = formulaAnchorData.defaultTimes?.[activity.activityId] || '';
    if (!preference.preferredTimes[activity.activityId] && fallback) {
      preference.preferredTimes[activity.activityId] = fallback;
      changed = true;
    }
  });
  if (changed) {
    state.booking.preference = preference;
    save();
  }
}

function getCurrentFormulaAnchorSelection() {
  const preference = createDefaultFormulaPreference(state.booking.preference || {});
  const times = {};
  (formulaAnchorData?.activities || []).forEach((activity) => {
    if (activity.activityId === 'laser_game' && preference.laserPlacement === 'onsite') return;
    times[activity.activityId] = preference.preferredTimes[activity.activityId] || '';
  });
  return { preference, times };
}

function formulaSlotMatchesTimes(slot, times) {
  return Object.entries(times || {}).every(([activityId, time]) => {
    if (!time) return false;
    const planTimes = slot?.opsPlan?.anchorPlan?.times;
    if (planTimes && planTimes[activityId]) return planTimes[activityId] === time;
    return getFormulaSlotActivityTime(slot, activityId) === time;
  });
}

function getCurrentFormulaAnchorSlotIndex() {
  const { times } = getCurrentFormulaAnchorSelection();
  return (state.availableSlots || []).findIndex((slot) => formulaSlotMatchesTimes(slot, times));
}

// Un clic = UNE réponse par phase, jamais une reconstruction. Phase 1 (tout de
// suite) : l'état choisi se pose en place et la zone de statut passe en
// vérification. Phase 2 (réponse serveur) : seuls les éléments qui ont changé
// sont réécrits. Le rendu complet ne reste que pour un VRAI changement de
// structure (ordre des activités, liste d'heures, panne).
async function revalidateFormulaAnchors() {
  const formule = state.booking.type === 'formule' ? FORMULES.find(x => x.id === state.booking.formuleId) : null;
  formulaAnchorBusy = true;
  if (!syncFormulaAnchorUi(formule, { busy: true })) renderSlots(formule);
  await fetchSlots({ showLoading: false, render: false });
  formulaAnchorBusy = false;
  if (!syncFormulaAnchorUi(formule, { busy: false })) renderSlots(formule);
}

async function setFormulaAnchorTime(activityId, time) {
  const preference = createDefaultFormulaPreference(state.booking.preference || {});
  if (preference.preferredTimes[activityId] === time && preference.laserPlacement !== 'onsite') return;
  // La pastille qui vient d'etre choisie ressort UNE fois, DES le clic : le
  // client voit ou son clic a atterri sans attendre le reseau (recette 6).
  formulaJustPicked = { activityId, time };
  preference.preferredTimes[activityId] = time;
  if (activityId === 'laser_game') preference.laserPlacement = 'scheduled';
  state.booking.preference = preference;
  state.booking.startTime = '';
  state.booking.opsPlan = null;
  save();
  await revalidateFormulaAnchors();
}

function getDefaultLaserTimeAfterBowling(preference) {
  const laser = (formulaAnchorData?.activities || []).find((activity) => activity.activityId === 'laser_game');
  if (!laser) return '';
  const fallback = formulaAnchorData?.defaultTimes?.laser_game || laser.times[0]?.time || '';
  const bowlingTime = preference.preferredTimes.bowling;
  const bowling = (formulaAnchorData?.activities || []).find((activity) => activity.activityId === 'bowling');
  if (!bowlingTime || !bowling) return fallback;
  const bowlingEnd = timeToNum(bowlingTime) * 60 + Number(bowling.durationMinutes || 60);
  const next = laser.times.find((item) => timeToNum(item.time) * 60 >= bowlingEnd + 5);
  return next?.time || fallback;
}

async function setFormulaLaserPlacement(placement) {
  const preference = createDefaultFormulaPreference(state.booking.preference || {});
  const next = placement === 'onsite' ? 'onsite' : 'scheduled';
  if (preference.laserPlacement === next) return;
  preference.laserPlacement = next;
  preference.preferredTimes.laser_game = next === 'onsite' ? '' : getDefaultLaserTimeAfterBowling(preference);
  state.booking.preference = preference;
  state.booking.startTime = '';
  state.booking.opsPlan = null;
  save();
  await revalidateFormulaAnchors();
}

async function applyFormulaAnchorSuggestion(index) {
  const suggestion = (formulaAnchorSuggestions || [])[index];
  if (!suggestion || !suggestion.times) return;
  const preference = createDefaultFormulaPreference(state.booking.preference || {});
  Object.entries(suggestion.times).forEach(([activityId, time]) => {
    if (Object.prototype.hasOwnProperty.call(preference.preferredTimes, activityId)) {
      preference.preferredTimes[activityId] = time;
    }
  });
  if (suggestion.times.laser_game) preference.laserPlacement = 'scheduled';
  state.booking.preference = preference;
  save();
  await revalidateFormulaAnchors();
}

async function resetFormulaAnchorChoices() {
  state.booking.preference = createDefaultFormulaPreference();
  state.booking.startTime = '';
  state.booking.opsPlan = null;
  save();
  await revalidateFormulaAnchors();
}

// Carte « votre visite » : les rendez-vous (ancres), la table dès l'arrivée et
// le pass liberté : sans aucune heure pour les activités libres.
function renderFormulaVisitSummary(slot, formule) {
  const plan = slot?.opsPlan;
  if (!plan) return '';
  const blocks = Array.isArray(plan.resourceBlocks) ? plan.resourceBlocks : [];
  const bowlingBlock = blocks.find(block => block.resourceType === 'bowling_lane');
  const laserBlock = blocks.find(block => block.resourceType === 'laser_arena');
  const tableBlock = blocks.find(block => block.resourceType === 'party_table');
  const appointments = [];
  if (bowlingBlock?.startTime) appointments.push(`Bowling ${bowlingBlock.startTime}`);
  if (laserBlock?.startTime) appointments.push(`Laser Game ${laserBlock.startTime}`);
  const arrivalTime = plan.arrivalTime || '';
  const arrivalMinutes = Number(plan.arrivalMinutes || 10);
  const passLabels = (formulaAnchorData?.freePass || []).map(item => item.label);
  if (!passLabels.length && formule) {
    passLabels.push(...getFormulaFreePassIds(formule).map(id => ACTIVITY_LABELS[id] || id));
  }
  const remainingLaser = Number(plan.laserPassPlan?.remainingGames || 0);
  const rows = [];
  if (appointments.length) {
    rows.push(`<div class="visit-line"><span class="visit-tag reserved">Vos rendez-vous</span><strong>${appointments.map(escapeHtml).join(' · ')}</strong></div>`);
  }
  if (arrivalTime) {
    rows.push(`<div class="visit-line"><span class="visit-tag arrival">Arrivée</span><span>Présentez-vous ${arrivalMinutes} min avant : accueil à <strong>${escapeHtml(arrivalTime)}</strong></span></div>`);
  }
  if (tableBlock || formulaAnchorData?.hasTable || (formule && formulaHasPartyTable(formule))) {
    rows.push(`<div class="visit-line"><span class="visit-tag table">Table</span><span>Votre table vous attend dès votre arrivée${arrivalTime ? ` (${escapeHtml(arrivalTime)})` : ''}</span></div>`);
  }
  if (passLabels.length) {
    rows.push(`<div class="visit-line"><span class="visit-tag free">À votre rythme</span><span>${passLabels.map(escapeHtml).join(' · ')} : quand vous voulez</span></div>`);
  }
  if (remainingLaser > 0) {
    rows.push(`<div class="visit-line"><span class="visit-tag laser">Laser</span><span>${remainingLaser} partie${remainingLaser > 1 ? 's' : ''} à placer sur place avec l'équipe, selon l'affluence</span></div>`);
  }
  if (plan.laserSharing?.mayShare) {
    rows.push(`<div class="visit-line visit-line-note"><span>Le Laser Game peut être complété par d'autres joueurs selon l'affluence</span></div>`);
  }
  return `<div class="formula-visit-summary">${rows.join('')}</div>`;
}

// --- Hiérarchie des heures ---------------------------------------------------
// 26 à 27 pastilles par activité, toutes identiques : rien ne distinguait une
// heure d'une autre et la page faisait 1732 px sur un téléphone (mesure du
// 2026-08-15). Les heures se rangent donc en trois moments de journée, et un
// seul moment est déplié : celui qui contient l'heure retenue. Aucune heure
// n'est retirée, chaque moment annonce sa plage ET son nombre d'heures.
const ANCHOR_PERIODS = [
  { key: 'matin', label: 'Matin', maxHour: 12 },
  { key: 'apresmidi', label: 'Après-midi', maxHour: 18 },
  { key: 'soir', label: 'Soir', maxHour: 24 },
];

function getAnchorPeriodKey(time) {
  const hour = Math.floor(timeToNum(time));
  return (ANCHOR_PERIODS.find(period => hour < period.maxHour) || ANCHOR_PERIODS[ANCHOR_PERIODS.length - 1]).key;
}

function groupAnchorTimes(items) {
  return ANCHOR_PERIODS
    .map(period => ({ ...period, items: items.filter(item => getAnchorPeriodKey(item.time) === period.key) }))
    .filter(period => period.items.length);
}

// L'heure qui ENCHAÎNE cette activité juste après l'autre : c'est la
// proposition que le moteur calcule tout seul. On la marque au lieu de laisser
// 27 pastilles se valoir. Rien n'est imposé : le reste reste cliquable.
function getChainedAnchorTime(activityId) {
  const activities = formulaAnchorData?.activities || [];
  const self = activities.find(activity => activity.activityId === activityId);
  if (!self) return '';
  const { times } = getCurrentFormulaAnchorSelection();
  let earliest = null;
  activities.forEach((other) => {
    if (other.activityId === activityId) return;
    const start = times[other.activityId];
    if (!start) return;
    const end = timeToNum(start) * 60 + Number(other.durationMinutes || 60) + 5;
    if (earliest === null || end > earliest) earliest = end;
  });
  if (earliest === null) return '';
  const next = self.times.find(item => timeToNum(item.time) * 60 >= earliest);
  return next?.time || '';
}

// Ordre RÉEL de la visite : les activités se suivent dans l'ordre des heures
// choisies, pas dans l'ordre du catalogue. C'est ce qui fait qu'un client lit
// une visite et non deux réservations posées l'une sous l'autre.
function getVisitRailSteps() {
  const { times } = getCurrentFormulaAnchorSelection();
  return (formulaAnchorData?.activities || [])
    .map((activity, index) => ({
      activity,
      index,
      startMinutes: times[activity.activityId] ? timeToNum(times[activity.activityId]) * 60 : null,
    }))
    .sort((left, right) => {
      if (left.startMinutes === null && right.startMinutes === null) return left.index - right.index;
      if (left.startMinutes === null) return 1;
      if (right.startMinutes === null) return -1;
      return left.startMinutes - right.startMinutes;
    });
}

function getSlotComfortNotices() {
  const slotIndex = getCurrentFormulaAnchorSlotIndex();
  const slot = slotIndex >= 0 ? state.availableSlots[slotIndex] : null;
  return Array.isArray(slot?.opsPlan?.comfortNotices) ? slot.opsPlan.comfortNotices : [];
}

// « Enchaîner à 16:30 » : le geste que propose l'avis. Il déplace UNE ancre,
// jamais toute la visite, et passe par le chemin normal (revalidation serveur).
// L'avis SORT avant le re-rendu, vers l'activité qu'il vient de recoller :
// le mouvement dit ce qui vient de se passer au lieu de faire disparaître un
// encadré d'une image à l'autre.
async function tightenFormulaAnchorGap(activityId, time) {
  if (!activityId || !time) return;
  const advice = document.querySelector('.visit-rail-advice');
  if (advice && !prefersReducedMotion()) {
    advice.classList.add('is-leaving');
    await new Promise((resolve) => setTimeout(resolve, 150)); // = --dur-exit
  }
  await setFormulaAnchorTime(activityId, time);
}

// Le moment n'est plus un FILTRE mais un SAUT : la piste porte toute la
// journée, on se déplace dedans. Défilement natif, jamais un défilement maison.
function setFormulaAnchorPeriod(activityId, periodKey) {
  const track = document.querySelector(`.anchor-track[data-anchor="${activityId}"]`);
  const mark = track ? track.querySelector(`[data-period-start="${periodKey}"]`) : null;
  if (track && mark) {
    track.scrollTo({
      left: Math.max(0, mark.offsetLeft - track.offsetLeft - 4),
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
    syncAnchorTrackState(track);
  }
}

// Fait défiler la piste d'une « page » : c'est ce qui rend le hors-champ
// atteignable à la souris et au clavier sans geste tactile.
function nudgeAnchorTrack(activityId, direction) {
  const track = document.querySelector(`.anchor-track[data-anchor="${activityId}"]`);
  if (!track) return;
  track.scrollBy({
    left: direction * Math.max(120, track.clientWidth - 72),
    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
  });
}

// État visible de la piste : ce qui dépasse à gauche, ce qui dépasse à droite,
// et le moment de journée où l'on se trouve. Un défilement horizontal sans
// indicateur est un piège : on ne sait pas qu'il reste des heures.
function syncAnchorTrackState(track) {
  if (!track) return;
  const max = track.scrollWidth - track.clientWidth;
  const left = track.scrollLeft;
  const state_ = max <= 1 ? 'none' : (left <= 1 ? 'end' : (left >= max - 1 ? 'start' : 'both'));
  if (track.dataset.overflow !== state_) track.dataset.overflow = state_;
  const shell = track.closest('.anchor-periods');
  if (!shell) return;
  // « Le apres-midi soir sert a rien si plus rien ne va » (Movsar). Sauter dans
  // la journee n'a de sens que s'il y a quelque chose hors du champ : quand la
  // piste tient entiere, les onglets occupent une ligne pour ne rien apporter.
  shell.classList.toggle('has-jumps', state_ !== 'none');
  shell.querySelectorAll('.anchor-track-nudge').forEach((button) => {
    const disabled = button.dataset.direction === '-1'
      ? (state_ === 'none' || state_ === 'end')
      : (state_ === 'none' || state_ === 'start');
    if (button.disabled !== disabled) button.disabled = disabled;
  });
  // Onglet actif = le moment réellement sous les yeux (bord gauche de la piste).
  const marks = [...track.querySelectorAll('[data-period-start]')];
  let current = marks[0]?.dataset.periodStart || '';
  marks.forEach((mark) => { if (mark.offsetLeft - track.offsetLeft <= left + 8) current = mark.dataset.periodStart; });
  shell.querySelectorAll('.anchor-period-tab').forEach((tab) => {
    const active = tab.dataset.period === current;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

// La position de lecture de chaque piste survit aux rendus complets : un
// client qui regardait le soir ne doit pas être ramené de force sur l'heure
// active parce qu'un rendu est passé par là. La mémoire se vide à l'arrivée
// sur l'étape (fetch avec chargement visible) : là, recentrer est un service.
const anchorTrackScrollMemory = new Map();

function snapshotAnchorTrackScroll() {
  document.querySelectorAll('.anchor-track[data-anchor]').forEach((track) => {
    anchorTrackScrollMemory.set(track.dataset.anchor, track.scrollLeft);
  });
}

// Un seul écouteur passif par piste, calé sur la fréquence d'affichage : on ne
// touche au DOM que lorsque l'état CHANGE (voir syncAnchorTrackState).
function bindAnchorTracks() {
  document.querySelectorAll('.anchor-track').forEach((track) => {
    if (track.dataset.bound === '1') return;
    track.dataset.bound = '1';
    let queued = false;
    track.addEventListener('scroll', () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; syncAnchorTrackState(track); });
    }, { passive: true });
    syncAnchorTrackState(track);
    const remembered = anchorTrackScrollMemory.get(track.dataset.anchor);
    if (remembered != null) {
      // Rendu complet en cours de parcours : la piste reprend sa position, elle
      // ne saute pas.
      if (Math.abs(track.scrollLeft - remembered) > 1) track.scrollLeft = remembered;
      syncAnchorTrackState(track);
      return;
    }
    // L'heure retenue doit être sous les yeux à l'ouverture, pas trois écrans
    // plus loin dans la piste.
    const active = track.querySelector('.anchor-chip.active');
    if (active) {
      track.scrollLeft = Math.max(0, active.offsetLeft - track.offsetLeft - track.clientWidth / 2 + active.offsetWidth / 2);
      syncAnchorTrackState(track);
    }
  });
}

// LE CRENEAU EST UNE CARTE, PARTOUT.
// Movsar (2026-08-15), en comparant les deux ecrans du tunnel : « pour les
// heures regardes les cartes de la deuxieme image qui affiche comme ca cest
// bcp plus pro et beau ». La pastille ronde ne portait que l heure de debut :
// elle laissait ouvertes les deux questions qui decident (quand est-ce que ca
// finit, ce creneau vaut-il mieux qu un autre). La carte les REPOND, sur trois
// niveaux : l heure en chiffres tabulaires, la fin calculee sur la duree
// REELLE de l activite, et une qualification quand le moteur en fournit une.
// Une seule famille de composant sert les deux modes du tunnel : ce qui change
// d un contexte a l autre, c est la DONNEE portee, jamais la forme.
// AUCUNE LIGNE N EST INVENTEE : sans donnee, la ligne n existe pas.
function slotCardMarkup({ time, endTime, tag, tagTone, meta }) {
  // Trois niveaux de lecture, chacun sur sa ligne : l heure, la qualification,
  // le secondaire. La carte reste ETROITE (une ligne longue la ferait grossir
  // en largeur et chasserait les creneaux voisins hors du champ).
  return [
    `<span class="slot-card-time">${escapeHtml(time)}</span>`,
    tag ? `<span class="slot-card-tag${tagTone ? ` is-${tagTone}` : ''}">${escapeHtml(tag)}</span>` : '',
    endTime ? `<span class="slot-card-end">→ ${escapeHtml(endTime)}</span>` : '',
    meta ? `<span class="slot-card-meta">${escapeHtml(meta)}</span>` : '',
  ].join('');
}

// Le modele d une carte d heure dans le composeur de visite. Tout vient de la
// reponse du moteur : `durationMinutes` de l activite, `lanes` allouees pour
// le bowling, `remainingPlaces` / `sharedSession` pour le laser.
function anchorSlotCardModel(activity, item, { isChained } = {}) {
  const duration = Number(activity.durationMinutes || 0);
  const endTime = duration > 0 ? numToTime(timeToNum(item.time) + duration / 60) : '';
  let tag = '';
  let tagTone = '';
  if (isChained) { tag = 'Enchaîné'; tagTone = 'accent'; }
  const bits = [];
  if (Array.isArray(item.lanes) && item.lanes.length) {
    bits.push(`${item.lanes.length} piste${item.lanes.length > 1 ? 's' : ''}`);
  }
  if (Number.isFinite(Number(item.remainingPlaces)) && Number(item.remainingPlaces) > 0) {
    bits.push(`${Number(item.remainingPlaces)} place${Number(item.remainingPlaces) > 1 ? 's' : ''}`);
  }
  if (item.sharedSession) bits.push('session partagée');
  const meta = bits.join(' · ');
  const label = [
    item.time,
    endTime ? `fin ${endTime}` : '',
    isChained ? "enchaîné avec l'activité précédente" : '',
    meta,
  ].filter(Boolean).join(', ');
  return { time: item.time, endTime, tag, tagTone, meta, label };
}

function renderAnchorChipGroups(activity, { selected, disabled, chained }) {
  const groups = groupAnchorTimes(activity.times);
  if (!groups.length) return '';
  // HORIZONTAL : une seule piste par activité qui porte TOUTE la journée. Les
  // onglets de moment cessent d'être un filtre (26 heures sur 27 masquées) et
  // deviennent des points de saut dans la piste : rien n'est plus caché.
  const tabs = groups.length > 1 ? `
      <div class="anchor-period-tabs" role="group" aria-label="Moment de la journée pour ${escapeHtml(activity.label)}">
        ${groups.map((group) => {
    const first = group.items[0].time;
    const last = group.items[group.items.length - 1].time;
    const holdsSelection = Boolean(selected) && group.items.some(item => item.time === selected);
    return `<button type="button" class="anchor-period-tab ${holdsSelection ? 'has-pick' : ''}" data-period="${escapeHtml(group.key)}" aria-pressed="false" aria-label="${escapeHtml(`${group.label}, ${group.items.length} heures de ${first} à ${last}`)}" ${disabled ? 'disabled' : ''} onclick="setFormulaAnchorPeriod('${escapeHtml(activity.activityId)}','${escapeHtml(group.key)}')"><span class="anchor-period-name">${escapeHtml(group.label)}</span><span class="anchor-period-count">${group.items.length}</span></button>`;
  }).join('')}
      </div>` : '';
  const chips = groups.map(group => group.items.map((item, index) => {
    const isActive = item.time === selected;
    const isChained = !isActive && item.time === chained;
    const marker = index === 0 ? ` data-period-start="${escapeHtml(group.key)}"` : '';
    const justPicked = !formulaAnchorBusy && isActive && formulaJustPicked
      && formulaJustPicked.activityId === activity.activityId && formulaJustPicked.time === item.time;
    if (justPicked) formulaJustPicked = null;
    const model = anchorSlotCardModel(activity, item, { isChained });
    return `<button type="button" class="anchor-chip slot-card ${isActive ? 'active' : ''} ${isChained ? 'is-chained' : ''} ${justPicked ? 'is-just-picked' : ''}"${marker} data-time="${escapeHtml(item.time)}" aria-pressed="${isActive ? 'true' : 'false'}" aria-label="${escapeHtml(model.label)}" ${disabled ? 'disabled' : ''} onclick="setFormulaAnchorTime('${escapeHtml(activity.activityId)}','${escapeHtml(item.time)}')">${slotCardMarkup(model)}</button>`;
  }).join('')).join('');
  const nudge = (direction, glyph, text) => `<button type="button" class="anchor-track-nudge" data-direction="${direction}" aria-label="${escapeHtml(text)}" onclick="nudgeAnchorTrack('${escapeHtml(activity.activityId)}',${direction})">${glyph}</button>`;
  return `
    <div class="anchor-periods">
      ${tabs}
      <div class="anchor-track-shell">
        ${nudge(-1, '&lsaquo;', `Heures précédentes pour ${activity.label}`)}
        <div class="anchor-track" data-anchor="${escapeHtml(activity.activityId)}" data-overflow="none">
          <div class="anchor-chip-grid">${chips}</div>
        </div>
        ${nudge(1, '&rsaquo;', `Heures suivantes pour ${activity.label}`)}
      </div>
    </div>`;
}

// Un ÉTAPE de la visite : son rang, son heure retenue, et ses heures possibles.
function renderVisitRailStep(step, position) {
  const activity = step.activity;
  const { preference, times } = getCurrentFormulaAnchorSelection();
  const isLaser = activity.activityId === 'laser_game';
  const laserOnSite = preference.laserPlacement === 'onsite';
  const disabled = isLaser && laserOnSite;
  const selected = disabled ? '' : (times[activity.activityId] || '');
  const chained = disabled ? '' : getChainedAnchorTime(activity.activityId);
  const detail = isLaser
    ? (activity.count > 1
      ? `${activity.count} parties incluses : choisissez la 1re, le reste se place sur place`
      : `Session de ${activity.durationMinutes} min`)
    : `${formatDurationLabel(Number(activity.durationMinutes || 60) / 60)} de piste réservée`;
  // Le choix « sur place » est une DÉCISION sur cette activité : il vit en tête
  // de son étape, pas perdu sous 27 pastilles (plainte du 2026-08-15).
  const onSiteToggle = isLaser && formulaAnchorData.laserOnSiteAvailable ? `
      <label class="anchor-onsite ${laserOnSite ? 'active' : ''}">
        <input type="checkbox" ${laserOnSite ? 'checked' : ''} onchange="setFormulaLaserPlacement(this.checked ? 'onsite' : 'scheduled')">
        <span>Je place mes parties laser sur place, selon l'affluence</span>
      </label>` : '';
  const picked = disabled
    ? '<span class="anchor-row-pick anchor-row-pick-free">avec l’équipe</span>'
    : (selected ? `<span class="anchor-row-pick">${escapeHtml(selected)}</span>` : '');
  return `
    <li class="visit-rail-step">
      <span class="visit-rail-mark" aria-hidden="true">${position}</span>
      <div class="anchor-row ${disabled ? 'anchor-row-onsite' : ''}" data-anchor="${escapeHtml(activity.activityId)}">
        <div class="anchor-row-head">
          <strong>${escapeHtml(activity.label)}</strong>
          ${picked}
          <small>${escapeHtml(detail)}</small>
        </div>
        ${onSiteToggle}
        ${renderAnchorChipGroups(activity, { selected, disabled, chained })}
      </div>
    </li>`;
}

// LE LIEN entre deux étapes : c'est tout le sujet de l'écran (une VISITE, pas
// deux réservations). Il porte toujours l'écart réel. Quand cet écart dépasse
// ce que la visite absorbe, le serveur envoie un avis : le lien passe en état
// « avis » et propose d'enchaîner. Il n'interdit jamais rien.
function renderVisitRailLink(previousStep, nextStep, notices) {
  const { times } = getCurrentFormulaAnchorSelection();
  const previousStart = times[previousStep.activity.activityId];
  const nextStart = times[nextStep.activity.activityId];
  if (!previousStart || !nextStart) return '';
  const gap = Math.round(timeToNum(nextStart) * 60
    - (timeToNum(previousStart) * 60 + Number(previousStep.activity.durationMinutes || 60)));
  if (gap < 0) return '';
  const notice = notices.find(item => item.toActivityId === nextStep.activity.activityId
    && item.fromActivityId === previousStep.activity.activityId);
  if (!notice) {
    if (!formulaAnchorBusy) formulaAdviceSignature = '';
    return `
      <li class="visit-rail-link">
        <span class="visit-rail-line" aria-hidden="true"></span>
        <span class="visit-rail-gap">${gap === 0 ? 'enchaîné' : `${escapeHtml(formatGapText(gap))} entre les deux`}</span>
      </li>`;
  }
  const passLabels = (formulaAnchorData?.freePass || []).map(item => item.label);
  const note = passLabels.length
    ? `Ce temps se passe sur place : ${passLabels.join(', ')} restent accessibles.`
    : 'Ce temps se passe sur place, entre les deux activités.';
  const canTighten = Boolean(notice.tightenTime)
    && (nextStep.activity.times || []).some(item => item.time === notice.tightenTime);
  // L'avis n'entre QU'UNE FOIS, et seulement quand il est neuf : le picker se
  // re-rend à chaque choix, rejouer l'animation à chaque rendu ferait clignoter
  // l'écran (même règle que le motion d'exploitation de la console).
  const signature = `${notice.fromActivityId}>${notice.toActivityId}:${notice.gapMinutes}`;
  // « Garder cet horaire » est une DECISION : l'avis écarté ne revient pas
  // tant que l'attente n'a pas changé ; le maillon continue de dire l'écart
  // réel (l'information ne disparaît jamais, seul le conseil se tait).
  if (signature === formulaAdviceDismissed) {
    if (!formulaAnchorBusy) formulaAdviceSignature = '';
    return `
      <li class="visit-rail-link">
        <span class="visit-rail-line" aria-hidden="true"></span>
        <span class="visit-rail-gap">${escapeHtml(formatGapText(gap))} entre les deux</span>
      </li>`;
  }
  const isNew = !formulaAnchorBusy && signature !== formulaAdviceSignature;
  if (!formulaAnchorBusy) formulaAdviceSignature = signature;
  return `
    <li class="visit-rail-link is-advice">
      <span class="visit-rail-line" aria-hidden="true"></span>
      <div class="visit-rail-advice ${isNew ? 'is-appearing' : ''}" role="status">
        <strong>${escapeHtml(notice.gapLabel || formatGapText(gap))} d’attente entre ${escapeHtml(notice.fromLabel || previousStep.activity.label)} et ${escapeHtml(notice.toLabel || nextStep.activity.label)}</strong>
        <span>${escapeHtml(note)}</span>
        <div class="visit-rail-advice-actions">
          ${canTighten ? `<button type="button" class="visit-rail-advice-action" onclick="tightenFormulaAnchorGap('${escapeHtml(nextStep.activity.activityId)}','${escapeHtml(notice.tightenTime)}')">Enchaîner à ${escapeHtml(notice.tightenTime)}</button>` : ''}
          <button type="button" class="visit-rail-advice-ghost" onclick="dismissFormulaAdvice('${escapeHtml(signature)}')">Garder cet horaire</button>
        </div>
      </div>
    </li>`;
}

// Écarter l'avis de confort : le client a vu, il assume son horaire. La carte
// sort par le geste de sortie de la grammaire, puis les maillons se réécrivent
// en place (aucune reconstruction du fil).
async function dismissFormulaAdvice(signature) {
  formulaAdviceDismissed = signature;
  const advice = document.querySelector('.visit-rail-advice');
  if (advice && !prefersReducedMotion()) {
    advice.classList.add('is-leaving');
    await new Promise((resolve) => setTimeout(resolve, 150)); // = --dur-exit
  }
  const formule = state.booking.type === 'formule' ? FORMULES.find(x => x.id === state.booking.formuleId) : null;
  if (!syncFormulaAnchorUi(formule, { busy: false })) renderSlots(formule);
}

// « 2 h 30 », « 45 min » : même lecture que côté moteur (lib/ops-engine.js).
function formatGapText(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${String(rest).padStart(2, '0')}` : `${hours} h`;
}

// Formules AVEC ancres : la visite se lit comme un fil, dans l'ordre réel.
function renderFormulaAnchorRows(formule) {
  const steps = getVisitRailSteps();
  const notices = getSlotComfortNotices();
  const parts = [];
  steps.forEach((step, index) => {
    if (index > 0) parts.push(renderVisitRailLink(steps[index - 1], step, notices));
    parts.push(renderVisitRailStep(step, index + 1));
  });
  const freePass = renderFormulaFreePassBlock(formule);
  if (freePass) {
    parts.push(`
      <li class="visit-rail-step visit-rail-step-free">
        <span class="visit-rail-mark visit-rail-mark-free" aria-hidden="true"></span>
        ${freePass}
      </li>`);
  }
  // Le nombre de rendez-vous à placer décide si les repères numérotés servent
  // à quelque chose : à une seule activité, « 1 » ne numérote rien.
  return `<ol class="visit-rail" data-anchors="${steps.length}">${parts.join('')}</ol>`;
}

// Le dernier maillon du fil : tout ce que le client a réservé SANS horaire.
// Pour une formule ce sont les avantages inclus ; pour une visite composée à la
// carte ce sont ses propres activités (minigolf, arcades, billards...), qui
// n'apparaissaient nulle part et donnaient un écran qui amputait sa visite.
function renderFormulaFreePassBlock(formule) {
  const entries = (formulaAnchorData?.freePass || []).map(item => ({
    label: item.label,
    detail: item.detail || '',
    onSitePayment: item.onSitePayment === true,
  }));
  if (!entries.length && formule) {
    entries.push(...getFormulaFreePassIds(formule).map(id => ({ label: ACTIVITY_LABELS[id] || id, detail: '', onSitePayment: false })));
  }
  const drinks = formulaAnchorData?.drinks || [];
  if (!entries.length && !drinks.length) return '';
  const included = Boolean(formule);
  const badge = included ? 'Pass liberté' : 'Sans horaire';
  const headline = included
    ? '<strong><span class="only-desktop">Inclus, à votre rythme sur place, quand vous voulez</span><span class="only-mobile">Inclus, quand vous voulez</span></strong>'
    : '<strong><span class="only-desktop">Le reste de votre visite, à votre rythme sur place</span><span class="only-mobile">À votre rythme sur place</span></strong>';
  const note = included
    ? '<span class="only-desktop">Aucune heure à choisir : ces avantages se vivent librement pendant toute votre visite.</span><span class="only-mobile">Sans horaire : à vivre librement.</span>'
    : '<span class="only-desktop">Aucune heure à choisir : vous en profitez quand vous voulez pendant votre visite.</span><span class="only-mobile">Sans horaire : quand vous voulez.</span>';
  return `
    <div class="anchor-free-pass">
      <div class="anchor-free-head">
        <span class="anchor-free-badge">${escapeHtml(badge)}</span>
        ${headline}
      </div>
      <div class="anchor-free-items">
        ${entries.map(entry => `<span class="anchor-free-item">${escapeHtml(entry.label)}${entry.detail ? `<small>${escapeHtml(entry.detail)}</small>` : ''}${entry.onSitePayment ? '<em>réglé sur place</em>' : ''}</span>`).join('')}
        ${drinks.map(label => `<span class="anchor-free-item anchor-free-drink">${escapeHtml(label)}</span>`).join('')}
      </div>
      <small>${note}</small>
    </div>`;
}

// La zone de statut du picker : panneau de validation quand la combinaison
// tient, refus expliqué avec les combinaisons voisines sinon. UN SEUL endroit
// écrit ce HTML : le rendu complet et la mise à jour en place s'en servent.
function renderFormulaAnchorStatus(formule) {
  const slotIndex = getCurrentFormulaAnchorSlotIndex();
  const slot = slotIndex >= 0 ? state.availableSlots[slotIndex] : null;
  if (slot) {
    return `
      <div class="formula-program-panel">
        ${renderFormulaVisitSummary(slot, formule)}
        <button type="button" class="btn-primary formula-plan-confirm" onclick="selectSlot(${slotIndex})">Valider ces horaires</button>
      </div>`;
  }
  // UN REFUS EXPLIQUE, PAS UN MUR. L'encadré disait « Cette combinaison n'est
  // pas possible » sans dire POURQUOI ni QUOI FAIRE d'autre que tout annuler
  // (Movsar, 2026-08-15 : « le rouge comme ça, c'est pas fou »). Il nomme
  // maintenant la contrainte, propose les combinaisons voisines qui marchent,
  // et ne garde le retour à la proposition automatique qu'en dernier recours.
  const suggestions = (formulaAnchorSuggestions || []).map((suggestion, index) => `
      <button type="button" class="anchor-suggestion" onclick="applyFormulaAnchorSuggestion(${index})">${escapeHtml(suggestion.label || Object.values(suggestion.times || {}).join(' · '))}</button>`).join('');
  return `
      <div class="anchor-status anchor-status-error" role="alert">
        <div class="anchor-status-copy">
          <strong>${escapeHtml(formulaAnchorMessage || 'Ces deux heures ne peuvent pas aller ensemble.')}</strong>
          <span>Vos autres choix sont conservés : il suffit de déplacer une heure.</span>
        </div>
        ${suggestions ? `<div class="anchor-suggestions"><span>Ces horaires fonctionnent :</span>${suggestions}</div>` : ''}
        <button type="button" class="formula-order-fallback-btn" onclick="resetFormulaAnchorChoices()">Repartir de la proposition automatique</button>
      </div>`;
}

function renderFormulaAnchorPicker(formule) {
  if (!formulaHasAnchorUi()) return renderFormulaArrivalPicker(formule);
  let statusHtml = '';
  if (formulaAnchorBusy) {
    statusHtml = `
      <div class="anchor-status anchor-status-busy" role="status" aria-live="polite">
        <span class="slot-spinner" aria-hidden="true"></span>
        <span>Vérification de votre combinaison…</span>
      </div>`;
  } else {
    statusHtml = renderFormulaAnchorStatus(formule);
  }
  // Le pass liberté est le dernier maillon du fil (renderFormulaAnchorRows) :
  // il ne se rajoute plus après le panneau, sinon la visite se lit en deux
  // morceaux alors que c'est UNE visite.
  // Plus d'en-tête interne : le titre de la carte le porte déjà, et la consigne
  // que ce paragraphe donnait ("présentez-vous 10 min avant") est dite par le
  // résumé, à l'heure près.
  // La zone de statut est un conteneur STABLE : la revalidation d'un choix la
  // met à jour en place (syncFormulaAnchorUi), elle ne reconstruit pas le fil.
  return `
    <div class="formula-anchor-picker">
      ${renderFormulaAnchorRows(formule)}
      <div class="formula-anchor-status-zone" data-role="anchor-status-zone">${statusHtml}</div>
    </div>`;
}

// LA REVALIDATION NE RECONSTRUIT PLUS L'ECRAN. Un clic sur une heure changeait
// trois fois tout le DOM du fil (rendu « occupé », rendu post-réseau, rendu
// final) : chaque reconstruction rejouait les pistes, remettait leur défilement
// à zéro et faisait clignoter le panneau. C'est le « plusieurs
// rafraîchissements » que Movsar voyait. Ici, seuls les éléments dont l'état a
// réellement changé sont touchés : pastilles (classes), badge d'heure retenue,
// maillons d'attente, zone de statut. Le fil, les pistes et leur défilement ne
// bougent pas. Retourne false quand la structure a changé (ordre des activités,
// liste d'heures, état d'erreur) : l'appelant repasse alors par un rendu
// complet, qui est cette fois un VRAI changement d'écran.
function syncFormulaAnchorUi(formule, { busy }) {
  const list = document.getElementById('slotList');
  const picker = list ? list.querySelector('.formula-anchor-picker') : null;
  if (!picker || !formulaHasAnchorUi()) return false;
  if (!busy && slotLoadFailed) return false;
  const steps = getVisitRailSteps();
  const rows = [...picker.querySelectorAll('.anchor-row[data-anchor]')];
  if (rows.length !== steps.length) return false;
  if (steps.some((step, index) => rows[index].dataset.anchor !== step.activity.activityId)) return false;

  const { preference, times } = getCurrentFormulaAnchorSelection();
  for (const step of steps) {
    const activity = step.activity;
    const row = picker.querySelector(`.anchor-row[data-anchor="${activity.activityId}"]`);
    if (!row) return false;
    const isLaser = activity.activityId === 'laser_game';
    const laserOnSite = preference.laserPlacement === 'onsite';
    const disabled = isLaser && laserOnSite;
    const selected = disabled ? '' : (times[activity.activityId] || '');
    const chained = disabled ? '' : getChainedAnchorTime(activity.activityId);
    const chips = [...row.querySelectorAll('.anchor-chip')];
    if (chips.length !== (activity.times || []).length) return false;
    chips.forEach((chip, index) => {
      const time = chip.dataset.time || '';
      const isActive = time === selected;
      const isChained = !isActive && time === chained;
      chip.classList.toggle('active', isActive);
      chip.classList.toggle('is-chained', isChained);
      chip.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      // La qualification « Enchaîné » se pose et se retire avec l etat, sans
      // reconstruire la carte : seule la ligne concernee change.
      const item = (activity.times || [])[index];
      if (item && item.time === time) {
        const model = anchorSlotCardModel(activity, item, { isChained });
        chip.setAttribute('aria-label', model.label);
        const tag = chip.querySelector('.slot-card-tag');
        if (model.tag && !tag) {
          chip.querySelector('.slot-card-time')?.insertAdjacentHTML('afterend',
            `<span class="slot-card-tag${model.tagTone ? ` is-${model.tagTone}` : ''}">${escapeHtml(model.tag)}</span>`);
        } else if (!model.tag && tag) tag.remove();
        else if (model.tag && tag && tag.textContent !== model.tag) tag.textContent = model.tag;
      }
      if (chip.disabled !== disabled) chip.disabled = disabled;
      // La capsule ne ressort que sur l'heure qui VIENT d'être choisie. La
      // classe reste posée tant que l'heure est active (l'animation est finie,
      // elle ne rejoue pas) : la retirer en cours de course couperait le pop
      // quand le réseau répond plus vite que les 160 ms du geste.
      const justPicked = Boolean(formulaJustPicked && isActive
        && formulaJustPicked.activityId === activity.activityId && formulaJustPicked.time === time);
      if (justPicked) formulaJustPicked = null;
      if (justPicked) chip.classList.add('is-just-picked');
      else if (!isActive) chip.classList.remove('is-just-picked');
    });
    // L'heure retenue se lit dans le titre de l'étape, sans reconstruire la tête.
    const head = row.querySelector('.anchor-row-head');
    if (head) {
      let pick = head.querySelector('.anchor-row-pick');
      const wanted = disabled ? 'avec l’équipe' : selected;
      if (wanted) {
        if (!pick) {
          pick = document.createElement('span');
          head.querySelector('strong')?.insertAdjacentElement('afterend', pick);
        }
        pick.className = `anchor-row-pick${disabled ? ' anchor-row-pick-free' : ''}`;
        if (pick.textContent !== wanted) pick.textContent = wanted;
      } else if (pick) pick.remove();
    }
    row.classList.toggle('anchor-row-onsite', disabled);
    const onsite = row.querySelector('.anchor-onsite');
    if (onsite) {
      onsite.classList.toggle('active', laserOnSite && isLaser);
      const box = onsite.querySelector('input[type="checkbox"]');
      if (box && box.checked !== (laserOnSite && isLaser)) box.checked = laserOnSite && isLaser;
    }
    // Le point du moment qui porte l'heure retenue.
    const periodKey = selected ? getAnchorPeriodKey(selected) : '';
    row.querySelectorAll('.anchor-period-tab').forEach((tab) => {
      tab.classList.toggle('has-pick', Boolean(periodKey) && tab.dataset.period === periodKey);
      if (tab.disabled !== disabled) tab.disabled = disabled;
    });
    row.querySelectorAll('.anchor-track-nudge').forEach((button) => {
      if (disabled && !button.disabled) button.disabled = true;
    });
    if (!disabled) {
      const track = row.querySelector('.anchor-track');
      if (track) syncAnchorTrackState(track);
    }
  }

  const zone = picker.querySelector('[data-role="anchor-status-zone"]');
  if (!zone) return false;
  if (busy) {
    // Pendant la vérification, RIEN n'est remplacé : la zone se met en retrait
    // et le bouton de validation se désarme. Aucun aplat ne disparaît.
    zone.classList.add('is-checking');
    zone.setAttribute('aria-busy', 'true');
    zone.querySelectorAll('button').forEach((button) => { button.disabled = true; });
    return true;
  }
  // Réponse arrivée : les maillons du fil disent le nouvel écart réel.
  const notices = getSlotComfortNotices();
  picker.querySelectorAll('.visit-rail-link').forEach((link) => link.remove());
  const stepLis = [...picker.querySelectorAll('.visit-rail-step:not(.visit-rail-step-free)')];
  for (let index = steps.length - 1; index >= 1; index -= 1) {
    const html = renderVisitRailLink(steps[index - 1], steps[index], notices);
    if (html) stepLis[index].insertAdjacentHTML('beforebegin', html);
  }
  zone.classList.remove('is-checking');
  zone.setAttribute('aria-busy', 'false');
  zone.innerHTML = renderFormulaAnchorStatus(formule);
  return true;
}

// Formules SANS ancre (table anniversaire + pass liberté) : le seul choix est
// l'heure d'arrivée : la table suit automatiquement.
function renderFormulaArrivalPicker(formule) {
  const slots = state.availableSlots || [];
  if (!slots.length) return '';
  if (!slots.some(slot => slot.time === formulaArrivalChoice)) formulaArrivalChoice = '';
  const activeIndex = slots.findIndex(slot => slot.time === formulaArrivalChoice);
  const activeSlot = activeIndex >= 0 ? slots[activeIndex] : null;
  const chips = slots.map(slot => `
    <button type="button" class="formula-arrival-chip ${activeSlot && slot.time === formulaArrivalChoice ? 'active' : ''}" onclick="setFormulaArrivalChoice('${escapeHtml(slot.time)}')">
      ${escapeHtml(slot.time)}
    </button>`).join('');
  return `
    <div class="formula-arrival-picker">
      <div class="formula-arrival-head">
        <strong>Choisissez votre heure d'arrivée</strong>
        <span><span class="only-desktop">Votre table vous attend dès votre arrivée et les activités incluses se vivent à votre rythme : présentez-vous 10 minutes avant l'heure choisie pour l'accueil.</span><span class="only-mobile">Table prête dès l'arrivée, activités à votre rythme. Présentez-vous 10 min avant.</span></span>
      </div>
      <div class="formula-arrival-grid">${chips}</div>
      ${activeSlot ? `
        <div class="formula-program-panel">
          ${renderFormulaVisitSummary(activeSlot, formule)}
          <button type="button" class="btn-primary formula-plan-confirm" onclick="selectSlot(${activeIndex})">Choisir cette arrivée</button>
        </div>` : `
        <p class="formula-arrival-hint">Touchez une heure pour voir le résumé de votre visite.</p>`}
      ${renderFormulaFreePassBlock(formule)}
    </div>`;
}

function setFormulaArrivalChoice(time) {
  formulaArrivalChoice = time;
  renderSlots(state.booking.type === 'formule' ? FORMULES.find(x => x.id === state.booking.formuleId) : null);
}

function renderFormulaEmptySlots(formule) {
  return `
    <div class="slot-state slot-state-empty" role="status">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      <div>
        <strong>Aucun créneau disponible</strong>
        <span>${escapeHtml(formulaAnchorMessage || 'Essayez une autre date, un autre horaire ou un groupe plus petit.')}</span>
      </div>
    </div>`;
}

// Panne serveur (P3-9) : état distinct du « zéro créneau », la disponibilité
// n'a pas pu être chargée, on propose de réessayer sans perdre les choix.
function renderSlotLoadError() {
  return `
    <div class="slot-state slot-state-error" role="alert">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      <div>
        <strong>Impossible de charger les créneaux</strong>
        <span>${escapeHtml(slotLoadFailedMessage || 'Le service ne répond pas pour le moment. Vos choix sont conservés.')}</span>
        <button type="button" class="slot-retry-btn" onclick="retryFetchSlots()">Réessayer</button>
      </div>
    </div>`;
}

function retryFetchSlots() {
  fetchSlots({ showLoading: true });
}

function renderSlots(formule) {
  const isLaser = state.booking.type === 'laser';
  const ds = parseLocalDate(state.booking.date).toLocaleDateString('fr-BE', { weekday:'long', day:'2-digit', month:'short' });
  const slotTitle = document.getElementById('slotTitle');
  // UN SEUL titre pour cet écran. « HORAIRE DISPONIBLE » en capitales suivi de
  // « Composez votre visite » deux lignes plus bas disait deux fois la même
  // chose (Movsar, 2026-08-15). Le titre de la carte porte l'intention, le
  // sous-titre porte la date, et le bloc interne n'a plus d'en-tête.
  if (slotTitle) slotTitle.textContent = formulaHasAnchorUi() ? 'Composez votre visite' : (formule ? 'Votre programme' : 'Horaire disponible');
  document.getElementById('slotDate').textContent = ds;
  const tl = document.getElementById('formTimeLimit');
  if (formule) {
    // La durée estimée et le compteur brut de programmes vivent désormais dans
    // l'en-tête du picker « heure d'arrivée » : pas de double bandeau.
    tl.innerHTML = formule.timeLimit
      ? `<div class="info-box"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg><div>Créneaux limités aux horaires de la formule ${formule.name}</div></div>`
      : '';
  } else if (isLaser) {
    const option = getLaserOption(state.booking.duration);
    const waveCount = getLaserWaveCount(state.booking.pax);
    const splitText = waveCount > 1 ? ` • groupe réparti sur ${waveCount} sessions` : '';
    tl.innerHTML = `<div class="info-box"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><circle cx="12" cy="12" r="10"/><path d="M12 7v5l3 2"/></svg><div><b>${option.label} Laser Game</b> • ${option.price}€ / personne${splitText} • session possible avec d'autres joueurs selon l'affluence</div></div>`;
  } else tl.innerHTML = '';

  const list = document.getElementById('slotList');
  if (slotLoading) {
    // \u00c9tat de chargement stable : bandeau discret + grille squelette de la
    // m\u00eame taille que les futurs cr\u00e9neaux (pas de saut de layout, pas de
    // grosse horloge flottante).
    list.innerHTML = `
      <div class="slot-state slot-state-loading" role="status" aria-live="polite">
        <span class="slot-spinner" aria-hidden="true"></span>
        <span>Recherche des cr\u00e9neaux disponibles\u2026</span>
      </div>
      <div class="slot-grid slot-grid-skeleton" aria-hidden="true">
        ${Array.from({ length: 8 }, () => '<div class="slot slot-skeleton"><span class="slot-skeleton-line"></span><span class="slot-skeleton-line short"></span></div>').join('')}
      </div>`;
    return;
  }
  if (slotLoadFailed) {
    list.innerHTML = renderSlotLoadError();
    return;
  }
  if (formulaHasAnchorUi()) {
    // Choix de l'heure PAR ACTIVITE : le picker reste affiché même sans
    // créneau composé (combinaison refusée → message + suggestions proches).
    // Il ne dépend PAS d'une formule : une visite à la carte avec plusieurs
    // activités à créneau (bowling + laser) reçoit exactement les mêmes
    // ancres du serveur. Tant que cette condition exigeait une formule, le
    // client jetait des ancres valides et affichait « Aucun créneau
    // disponible » alors que le serveur en proposait neuf.
    snapshotAnchorTrackScroll();
    list.innerHTML = renderFormulaAnchorPicker(formule);
    bindAnchorTracks();
    return;
  }
  if (!state.availableSlots.length) {
    list.innerHTML = renderFormulaEmptySlots(formule);
    return;
  }
  if (formule) {
    const picker = renderFormulaArrivalPicker(formule);
    list.innerHTML = picker || renderFormulaEmptySlots(formule);
    return;
  }
  // MEME FAMILLE DE COMPOSANT que le composeur de visite : `slot-card` porte
  // la forme (heure, fin, qualification, secondaire), la donnee change.
  const showLanes = reservationNeedsLanes(state.booking.type, state.booking.formuleId);
  list.innerHTML = `<div class="slot-grid stagger">${state.availableSlots.map((s, i) => `
    <button class="slot slot-card" onclick="selectSlot(${i})">
      <span class="slot-card-time slot-time">${s.time}</span>
      ${s.opsPlan?.endTime ? `<span class="slot-card-end">→ ${escapeHtml(s.opsPlan.endTime)}</span>` : ''}
      ${!isLaser && s.opsPlan ? '<span class="slot-card-tag is-accent">Plan conseillé</span>' : ''}
      ${isLaser ? `<span class="slot-card-tag is-accent">${s.sharedSession ? 'Session partagée' : s.splitGroup ? 'Groupe découpé' : 'Session ouverte'}</span>` : ''}
      ${showLanes ? `<span class="slot-card-meta slot-free">${s.freeCount} pistes libres</span>` : isLaser ? `<span class="slot-card-meta slot-free">${getLaserSlotCapacityText(s)}</span>` : ''}
      ${isLaser ? `<span class="slot-card-meta slot-plan">${getLaserSlotAfterText(s)}</span>` : ''}
      ${!isLaser && s.opsPlan ? `<span class="slot-card-meta slot-plan">${describeSlotPlan(s.opsPlan)}</span>` : ''}
    </button>
  `).join('')}</div>`;
}

function selectSlot(i) {
  const slot = state.availableSlots[i];
  if (!slot) return;
  state.booking.startTime = slot.time;
  state.booking.allocatedLanes = slot.lanes;
  state.booking.opsPlan = slot.opsPlan || null;
  const formule = state.booking.type === 'formule' ? FORMULES.find(x => x.id === state.booking.formuleId) : null;
  if (formule && slot.opsPlan && formulaHasAnchorUi()) {
    // Fige les ancres du créneau retenu : le serveur revalide exactement
    // cette combinaison à la confirmation (POST refusé sinon).
    const preference = createDefaultFormulaPreference(state.booking.preference || {});
    const anchorTimes = slot.opsPlan.anchorPlan?.times || {};
    ['bowling', 'laser_game'].forEach((activityId) => {
      preference.preferredTimes[activityId] = anchorTimes[activityId]
        || getFormulaSlotActivityTime(slot, activityId)
        || '';
    });
    if (slot.opsPlan.anchorPlan?.laserPlacement === 'onsite') {
      preference.laserPlacement = 'onsite';
      preference.preferredTimes.laser_game = '';
    }
    state.booking.preference = preference;
  }
  if (state.booking.type === 'laser' && slot.opsPlan?.totalMinutes) {
    state.booking.totalDuration = Math.max(Number(state.booking.duration) || 0.5, Math.ceil(Number(slot.opsPlan.totalMinutes) / 30) / 2);
  }
  goStep(3);
}

function goStep4() {
  const name = document.getElementById('fName').value.trim();
  const phone = document.getElementById('fPhone').value.trim();
  const email = document.getElementById('fEmail').value.trim();
  ['fName', 'fPhone', 'fEmail'].forEach(clearFieldError);
  const fieldErrors = [];
  if (!name) fieldErrors.push(['fName', 'Indiquez votre prénom et nom.']);
  else if (name.length < 2) fieldErrors.push(['fName', 'Merci d\'indiquer votre nom complet.']);
  const phoneDigits = phone.replace(/[^0-9]/g, '');
  if (!phone) fieldErrors.push(['fPhone', 'Indiquez un numéro de téléphone.']);
  else if (phoneDigits.length < 8 || phoneDigits.length > 15) fieldErrors.push(['fPhone', 'Numéro de téléphone invalide.']);
  if (!email) fieldErrors.push(['fEmail', 'Indiquez votre email pour recevoir la confirmation.']);
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fieldErrors.push(['fEmail', 'Adresse email invalide, vérifiez-la pour recevoir votre confirmation.']);
  if (fieldErrors.length) {
    fieldErrors.forEach(([inputId, text]) => setFieldError(inputId, text));
    showAlert('Vérifiez les champs signalés avant de continuer.');
    const firstInvalid = document.getElementById(fieldErrors[0][0]);
    if (firstInvalid) firstInvalid.focus();
    return;
  }
  state.booking.name = name;
  state.booking.phone = phone;
  state.booking.email = email;
  const specialRequestInput = document.getElementById('fSpecialRequest');
  state.booking.specialRequest = specialRequestInput ? specialRequestInput.value.trim().slice(0, 500) : '';
  const occasionOtherInput = document.getElementById('fOccasionOther');
  state.booking.occasionOther = (occasionOtherInput && state.booking.occasion === 'autre')
    ? occasionOtherInput.value.trim().slice(0, 160)
    : '';
  renderRecap();
  goStep(4);
}

// Occasion DÉCLARÉE par le client. Les six clés sont alignées sur l'enum
// serveur (OCCASION_VALUES, lib/reservation-request.js), 'evg' compris :
// chaque chip du tunnel est stockée telle quelle en base.
// '' = non précisé. Propagée au serveur → catégorisation staff déclarée.
const BOOKING_OCCASIONS = ['anniversaire', 'amis', 'entreprise', 'ecole', 'evg', 'autre'];
function setBookingOccasion(value) {
  const next = BOOKING_OCCASIONS.includes(value)
    ? (state.booking.occasion === value ? '' : value)
    : '';
  state.booking.occasion = next;
  document.querySelectorAll('#occasionChips .occasion-chip').forEach(chip => {
    const active = chip.dataset.occasion === next;
    chip.classList.toggle('active', active);
    chip.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  // « Autre » ouvre un champ de précision libre (stocké et joint aux notes de la
  // réservation pour l'analyse direction). Toute autre valeur le referme/efface.
  const otherWrap = document.getElementById('occasionOtherWrap');
  const otherInput = document.getElementById('fOccasionOther');
  const showOther = next === 'autre';
  if (otherWrap) otherWrap.classList.toggle('hidden', !showOther);
  if (!showOther) {
    state.booking.occasionOther = '';
    if (otherInput) otherInput.value = '';
  } else if (otherInput) {
    setTimeout(() => { try { otherInput.focus(); } catch (e) {} }, 30);
  }
  save();
}

// Texte libre de l'occasion « Autre » (max 160). Conservé sur le booking et
// injecté dans les notes de la réservation à la confirmation.
function setBookingOccasionOther(value) {
  state.booking.occasionOther = String(value || '').slice(0, 160);
  save();
}

// ── Demande SUR MESURE (lead entreprise / besoin spécial) ──────────────────
// ── Champ « Demande particuliere » ─────────────────────────────────────────
// Une zone de texte vide ne dit pas quoi ecrire, et sa poignee de
// redimensionnement est le seul indice que le texte peut etre long. Ici : le
// champ grandit tout seul a la frappe (aucune poignee) et le compteur ne
// s affiche qu en approche de la limite (un compteur permanent met la pression
// pour rien). L exemple du placeholder porte le reste du travail : il montre
// une demande que le centre peut REELLEMENT traiter (deposer un gateau au
// frais), pas un service qu il ne rend pas.
const SPECIAL_REQUEST_MAX = 500;

function autoGrowSpecialRequest(field) {
  if (!field) return;
  field.style.height = 'auto';
  // Plafond : au-dela, le champ defile au lieu de pousser le bouton hors ecran.
  field.style.height = Math.min(field.scrollHeight, 220) + 'px';
}

function handleSpecialRequestInput(field) {
  autoGrowSpecialRequest(field);
  const counter = document.getElementById('specialRequestCount');
  if (!counter) return;
  const used = String(field.value || "").length;
  const showFrom = SPECIAL_REQUEST_MAX - 120;
  counter.textContent = used >= showFrom ? `${used} / ${SPECIAL_REQUEST_MAX}` : "";
  counter.classList.toggle('is-close', used >= SPECIAL_REQUEST_MAX - 20);
}

// Crée un LEAD (hors planning), pas une réservation. POST /api/custom-request.
const customRequestState = { occasion: '' };

function setCustomRequestOccasion(value) {
  const next = BOOKING_OCCASIONS.includes(value)
    ? (customRequestState.occasion === value ? '' : value)
    : '';
  customRequestState.occasion = next;
  document.querySelectorAll('#crOccasionChips .occasion-chip').forEach(chip => {
    const active = chip.dataset.occasion === next;
    chip.classList.toggle('active', active);
    chip.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function openCustomRequestModal() {
  const modal = document.getElementById('customRequestModal');
  if (!modal) return;
  // Pré-remplit avec ce que le client a déjà saisi à l'étape 1 (contexte utile).
  const b = state.booking || {};
  const dateInput = document.getElementById('crDate');
  const paxInput = document.getElementById('crPax');
  if (dateInput && !dateInput.value && b.date) dateInput.value = b.date;
  if (paxInput && !paxInput.value && Number(b.pax) > 0) paxInput.value = b.pax;
  setCustomRequestOccasion(b.occasion || '');
  const success = document.getElementById('bespokeSuccess');
  const form = document.getElementById('bespokeForm');
  if (success) { success.classList.add('hidden'); success.textContent = ''; }
  if (form) form.classList.remove('hidden');
  const errorBox = document.getElementById('bespokeError');
  if (errorBox) errorBox.classList.add('hidden');
  modal.classList.remove('hidden');
  document.body.classList.add('modal-open');
  const nameInput = document.getElementById('crName');
  if (nameInput) setTimeout(() => nameInput.focus(), 30);
}

function closeCustomRequestModal() {
  const modal = document.getElementById('customRequestModal');
  if (!modal) return;
  modal.classList.add('hidden');
  document.body.classList.remove('modal-open');
}

function showCustomRequestError(message) {
  const errorBox = document.getElementById('bespokeError');
  if (!errorBox) return;
  errorBox.textContent = message;
  errorBox.classList.remove('hidden');
}

async function submitCustomRequest() {
  const val = id => (document.getElementById(id)?.value || '').trim();
  const name = val('crName');
  const email = val('crEmail');
  const message = val('crMessage');
  const errorBox = document.getElementById('bespokeError');
  if (errorBox) errorBox.classList.add('hidden');

  if (!name) { showCustomRequestError('Merci d\'indiquer le nom du contact.'); return; }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showCustomRequestError('Un email valide est requis pour vous recontacter.'); return; }
  if (!message) { showCustomRequestError('Décrivez votre besoin en quelques mots.'); return; }

  const submitBtn = document.getElementById('crSubmit');
  const payload = {
    kind: 'custom-request',
    centerId: (typeof getCurrentStaffCenterId === 'function' ? getCurrentStaffCenterId() : 'libramont') || 'libramont',
    contactName: name,
    company: val('crCompany'),
    email,
    phone: val('crPhone'),
    requestedDate: val('crDate'),
    pax: Number(document.getElementById('crPax')?.value || 0) || 0,
    occasion: customRequestState.occasion || '',
    message,
  };

  try {
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Envoi en cours…'; }
    await apiRequest('/api/custom-request', { method: 'POST', body: JSON.stringify(payload) });
    const form = document.getElementById('bespokeForm');
    const success = document.getElementById('bespokeSuccess');
    if (form) form.classList.add('hidden');
    if (success) {
      success.innerHTML = 'Demande bien envoyée ! Vous recevez un accusé par email et notre équipe vous recontacte rapidement.';
      success.classList.remove('hidden');
    }
    ['crName', 'crCompany', 'crEmail', 'crPhone', 'crDate', 'crPax', 'crMessage'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    setCustomRequestOccasion('');
  } catch (error) {
    showCustomRequestError(error.message || 'Impossible d\'envoyer la demande. Réessayez.');
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Envoyer ma demande'; }
  }
}

// Récap « Ancres + Liberté » d'une réservation formule.
function getFormulaRecapModel(booking) {
  const plan = booking.opsPlan || {};
  const blocks = Array.isArray(plan.resourceBlocks) ? plan.resourceBlocks : [];
  const preference = createDefaultFormulaPreference(booking.preference || {});
  const formule = FORMULES.find(x => x.id === booking.formuleId) || null;
  const appointments = [];
  const bowlingTime = blocks.find(block => block.resourceType === 'bowling_lane')?.startTime
    || preference.preferredTimes.bowling;
  const laserTime = blocks.find(block => block.resourceType === 'laser_arena')?.startTime
    || (preference.laserPlacement === 'onsite' ? '' : preference.preferredTimes.laser_game);
  if (bowlingTime) appointments.push(`Bowling ${bowlingTime}`);
  if (laserTime) appointments.push(`Laser Game ${laserTime}`);
  const freeLabels = (formulaAnchorData?.freePass || []).map(item => item.label);
  if (!freeLabels.length && formule) {
    freeLabels.push(...getFormulaFreePassIds(formule).map(id => ACTIVITY_LABELS[id] || id));
  }
  return {
    appointments,
    laserOnSite: preference.laserPlacement === 'onsite',
    remainingLaser: Number(plan.laserPassPlan?.remainingGames || 0),
    hasTable: blocks.some(block => block.resourceType === 'party_table') || (formule && formulaHasPartyTable(formule)),
    arrivalTime: plan.arrivalTime || '',
    freeLabels,
  };
}

function renderRecap() {
  const b = state.booking;
  const formule = b.type === 'formule' ? FORMULES.find(x => x.id === b.formuleId) : null;
  const isLaser = b.type === 'laser';
  const isVisit = b.type === 'visite';
  const visitProgram = isVisit && b.serverProgram && Array.isArray(b.serverProgram.items)
    ? b.serverProgram
    : null;
  const showLanes = reservationNeedsLanes(b.type, b.formuleId);
  // Pour une visite, la source de verite d'affichage est le programme normalise
  // par public-availability. getBasePrice ne connait que les types historiques
  // et renverrait donc 0 pour "visite".
  const total = visitProgram
    ? Math.max(0, Number(visitProgram.price) || 0)
    : getBasePrice(b.type, Number(b.duration), b.laneCount, Number(b.pax), b.formuleId);
  const totalDuration = getBookingTotalDuration(b);
  const formulaRecap = formule ? getFormulaRecapModel(b) : null;
  const planLine = b.opsPlan ? describeSlotPlan(b.opsPlan) : '';
  const laserOption = isLaser ? getLaserOption(b.duration) : null;
  const laserWaveCount = isLaser ? Number(b.opsPlan?.laserSharing?.waveCount || getLaserWaveCount(b.pax)) : 1;
  const totalLabel = document.getElementById('recapTotalLabel');
  const totalNote = document.getElementById('recapTotalNote');
  const totalAmount = document.getElementById('recapTotal');
  if (isVisit && visitProgram) {
    const complete = visitProgram.priceComplete === true;
    if (totalLabel) totalLabel.textContent = complete ? 'Total' : (total > 0 ? 'À partir de' : 'Tarif');
    if (totalNote) totalNote.textContent = complete
      ? 'Pour cette sélection'
      : (total > 0 ? 'Certaines activités se règlent sur place' : 'Montant confirmé à votre arrivée');
    if (totalAmount) totalAmount.textContent = total > 0 ? `${Math.round(total)}€` : 'Sur place';
  } else {
    if (totalLabel) totalLabel.textContent = 'Total estimé';
    if (totalNote) totalNote.textContent = 'À régler sur place';
    if (totalAmount) totalAmount.textContent = `${total}€`;
  }
  const dateLabel = parseLocalDate(b.date).toLocaleDateString('fr-BE', { weekday:'long', day:'numeric', month:'long' });
  const visitProgramHtml = visitProgram ? `
    <div class="recap-item recap-program-row">
      <span class="recap-label">Activités</span>
      <div class="recap-value recap-program-value">
        ${visitProgram.items.map(renderVisitRecapItem).join('')}
      </div>
    </div>` : '';
  document.getElementById('recapList').innerHTML = `
    <div class="recap-item"><span class="recap-label">Client</span><span class="recap-value">${escapeHtml(b.name)}</span></div>
    <div class="recap-item"><span class="recap-label">Téléphone</span><span class="recap-value">${escapeHtml(b.phone)}</span></div>
    <div class="recap-item"><span class="recap-label">Date</span><span class="recap-value">${dateLabel}</span></div>
    <div class="recap-item"><span class="recap-label">${formule ? 'Première activité' : 'Horaire'}</span><span class="recap-value accent">${b.startTime} <small style="font-size:13px;color:var(--text-3);font-weight:500;">• ${b.duration}h</small></span></div>
    ${formule && b.opsPlan?.arrivalTime ? `<div class="recap-item"><span class="recap-label">Arrivée conseillée</span><span class="recap-value">${escapeHtml(b.opsPlan.arrivalTime)} <small style="font-size:13px;color:var(--text-3);font-weight:500;">• accueil ${Number(b.opsPlan.arrivalMinutes || 10)} min avant</small></span></div>` : ''}
    <div class="recap-item"><span class="recap-label">Joueurs</span><span class="recap-value">${b.pax} personne${b.pax > 1 ? 's' : ''}</span></div>
    ${showLanes ? `<div class="recap-item"><span class="recap-label">Piste${b.allocatedLanes.length > 1 ? 's' : ''} assignée${b.allocatedLanes.length > 1 ? 's' : ''}</span><span class="recap-value teal">${b.allocatedLanes.join(' & ')}</span></div>` : ''}
    ${visitProgramHtml}
    ${isLaser ? `<div class="recap-item"><span class="recap-label">Activité</span><span class="recap-value">Laser Game • ${laserOption.label}</span></div>` : ''}
    ${formule ? `<div class="recap-item"><span class="recap-label">Formule</span><span class="recap-value">${formule.name}</span></div>` : ''}
    ${formulaRecap && formulaRecap.appointments.length ? `<div class="recap-item"><span class="recap-label">Vos rendez-vous</span><span class="recap-value">${formulaRecap.appointments.map(escapeHtml).join(' · ')}</span></div>` : ''}
    ${formulaRecap && formulaRecap.hasTable ? `<div class="recap-item"><span class="recap-label">Votre table</span><span class="recap-value">Dès l'arrivée${formulaRecap.arrivalTime ? ` (${escapeHtml(formulaRecap.arrivalTime)})` : ''}</span></div>` : ''}
    ${formulaRecap && formulaRecap.freeLabels.length ? `<div class="recap-item"><span class="recap-label">À votre rythme</span><span class="recap-value">${formulaRecap.freeLabels.map(escapeHtml).join(' · ')}</span></div>` : ''}
    ${formule ? `<div class="recap-item"><span class="recap-label">Temps total estimé</span><span class="recap-value">${formatDurationLabel(totalDuration)}</span></div>` : ''}
    ${isLaser ? `<div class="recap-note"><b>Laser Game :</b> ${laserWaveCount > 1 ? `votre groupe est réparti sur ${laserWaveCount} sessions successives. ` : ''}Votre session peut être complétée avec d'autres joueurs selon l'affluence. ${planLine ? `Plan retenu : ${planLine}.` : ''}</div>` : ''}
    ${formulaRecap && (formulaRecap.remainingLaser > 0 || formulaRecap.laserOnSite) ? `<div class="recap-note"><b>Laser Game :</b> ${formulaRecap.remainingLaser > 0 ? `${formulaRecap.remainingLaser} partie${formulaRecap.remainingLaser > 1 ? 's' : ''} à placer sur place avec l'équipe, selon l'affluence.` : ''} ${formulaRecap.laserOnSite ? 'Vous placez vos parties laser librement pendant la visite.' : ''}</div>` : ''}
    ${formule ? `<div class="recap-note"><b>Le reste, à votre rythme :</b> aucune heure imposée pour les activités du pass liberté, vous les vivez quand vous voulez pendant votre visite.</div>` : ''}
  `;
}

// Une ligne du programme SERVEUR dans le recap final : nom, choix effectif et
// prix de cette ligne. Les options affichent ce qui sera reserve, jamais une
// valeur reconstruite depuis le libelle global de la reservation.
function renderVisitRecapItem(item) {
  const activityId = String(item?.activityId || '');
  let detail = '';
  if (activityId === 'bowling') {
    const option = DURATION_OPTIONS.find(entry => Number(entry.value) === Number(item.duration));
    const lanes = Math.max(1, Number(item.laneCount) || 1);
    detail = `${option?.label || `${Number(item.duration) || 1}h`} · ${lanes} piste${lanes > 1 ? 's' : ''}`;
  } else if (activityId === 'laser_game') {
    const games = Math.max(1, Number(item.games) || 1);
    detail = `${games} partie${games > 1 ? 's' : ''}`;
  } else if (item.units != null || item.hours != null) {
    const units = Math.max(1, Number(item.units) || 1);
    const hours = Math.max(0.5, Number(item.hours) || 1);
    detail = `${units} table${units > 1 ? 's' : ''} · ${formatDurationLabel(hours)}`;
  } else if (item.minutes) {
    detail = formatDurationLabel(Number(item.minutes) / 60);
  } else {
    detail = item.priceKnown === true ? 'Compris dans le total' : 'À régler sur place';
  }
  const price = item.priceKnown === true && Number.isFinite(Number(item.price))
    ? `${Math.round(Number(item.price))}€`
    : 'Sur place';
  return `<div class="recap-program-item">
    <span class="recap-program-copy">
      <strong class="recap-program-name">${escapeHtml(item.name || activityId)}</strong>
      <small class="recap-program-detail">${escapeHtml(detail)}</small>
    </span>
    <span class="recap-program-price">${escapeHtml(price)}</span>
  </div>`;
}

async function confirmBooking() {
  if (bookingSubmitBusy) return;
  bookingSubmitBusy = true;
  setBookingSubmitBusy(true);

  const b = state.booking;
  const formule = b.type === 'formule' ? FORMULES.find(x => x.id === b.formuleId) : null;
  const duration = Number(b.duration);
  const totalDuration = getBookingTotalDuration(b);
  const needsLanes = reservationNeedsLanes(b.type, b.formuleId);
  const laneCount = getRequiredLaneCount(b.type, b.pax, b.formuleId);

  const releaseBookingSubmit = () => {
    bookingSubmitBusy = false;
    setBookingSubmitBusy(false);
  };

  const slotCheck = validateSlotWindow(b.date, b.startTime, totalDuration);
  if (!slotCheck.ok) {
    showAlert(slotCheck.message);
    goStep(2);
    await fetchSlots({ showLoading: true });
    releaseBookingSubmit();
    return;
  }

  if (formule) {
    const availability = getFormuleAvailability(formule, b.date, Number(b.pax), b.startTime);
    if (!availability.ok) {
      showAlert(availability.message);
      goStep(2);
      await fetchSlots({ showLoading: true });
      releaseBookingSubmit();
      return;
    }
  }

  let allocated = Array.isArray(b.allocatedLanes) ? [...b.allocatedLanes] : [];
  if (needsLanes) {
    const stillFree =
      b.opsPlan ||
      allocated.length === laneCount &&
      !lanesConflict(b.date, b.startTime, duration, allocated).length &&
      allocated.every(l => state.laneStatuses[l] !== 'maintenance');
    if (!stillFree) allocated = allocateLanes(laneCount, b.date, b.startTime, duration);
    if (!allocated) {
      showAlert("Le créneau vient d'être pris. Merci de choisir un autre horaire.");
      goStep(2);
      await fetchSlots({ showLoading: true });
      releaseBookingSubmit();
      return;
    }
  } else {
    allocated = [];
  }

  const isVisit = b.type === 'visite';
  // Le prix affiche reste indicatif : le serveur recalcule TOUT (grilles bowling
  // et laser, tarifs de centre des activites libres) et c'est son montant qui
  // est enregistre. On envoie le notre pour ne pas casser le payload historique.
  const basePrice = isVisit
    ? 0
    : getBasePrice(b.type, duration, needsLanes ? allocated.length : 0, Number(b.pax), b.formuleId);
  const reservation = {
    name: b.name,
    phone: b.phone,
    email: b.email,
    date: b.date,
    startTime: b.startTime,
    duration,
    totalDuration,
    lanes: allocated,
    pax: Number(b.pax),
    status: 'pending',
    basePrice,
    price: basePrice,
    type: b.type,
    formuleId: b.formuleId,
    label: formule ? formule.name : b.type === 'laser' ? 'Laser Game' : 'Bowling Classique',
    laserGames: b.type === 'laser' ? getLaserGameCount(b.duration) : 0,
    // Programme de la visite. Absent pour une reservation mono-activite : le
    // payload est alors strictement celui d'avant.
    ...(isVisit ? { program: buildBookingProgramPayload() } : {}),
    preference: b.preference || {},
    pauseMinutes: 0,
    opsPlan: b.opsPlan || null,
    // Champs ADDITIFS optionnels : occasion déclarée + demande particulière. Le
    // texte libre de l'occasion « Autre » est joint aux notes (l'enum serveur ne
    // stocke que la clé) pour rester lisible côté direction.
    occasion: b.occasion || '',
    notes: [
      (b.occasion === 'autre' && b.occasionOther) ? `Occasion : ${b.occasionOther}` : '',
      b.specialRequest || ''
    ].filter(Boolean).join('. '),
    extras: []
  };

  try {
    const payload = await apiRequest(API_ENDPOINTS.publicReservations, {
      method: 'POST',
      body: JSON.stringify(buildReservationApiPayload(reservation, {
        channel: 'public',
        laneCount,
        requiresLanes: needsLanes
      }))
    });
    upsertReservationInState(payload.reservation);
    save();
    allocated = payload.reservation.lanes || allocated;
    state.booking.opsResult = payload.ops || null;
    clearBookingAlternatives();
  } catch (error) {
    goStep(2);
    await fetchSlots({ showLoading: true });
    if (error.payload?.alternatives?.length) {
      showBookingAlternatives(error.message || 'Ce créneau ne tient plus.', error.payload.alternatives);
    } else {
      showAlert(error.message || 'Impossible d enregistrer la reservation.');
    }
    releaseBookingSubmit();
    return;
  }

  document.getElementById('successName').textContent = b.name.split(' ')[0];
  const showLanes = reservationNeedsLanes(b.type, b.formuleId);
  const isLaser = b.type === 'laser';
  document.getElementById('successHint').style.display = 'block';
  const confirmationText = state.booking.opsResult?.validationStatus === 'staff_review'
    ? 'Votre demande est reçue. On revient vers vous après vérification du scénario.'
    : 'Votre réservation est enregistrée. Le mail de confirmation arrive dans quelques minutes.';
  const laserWaveCount = isLaser ? Number(b.opsPlan?.laserSharing?.waveCount || getLaserWaveCount(b.pax)) : 1;
  const laserLine = isLaser ? ` ${laserWaveCount > 1 ? `Votre groupe est réparti sur ${laserWaveCount} sessions Laser. ` : ''}La session Laser Game peut être complétée avec d’autres joueurs selon l’affluence.` : '';
  const arrivalLine = b.type === 'formule' && b.opsPlan?.arrivalTime
    ? ` Présentez-vous <b>${Number(b.opsPlan.arrivalMinutes || 10)} minutes avant</b> pour l'accueil (arrivée conseillée <b>${escapeHtml(b.opsPlan.arrivalTime)}</b>).`
    : '';
  const successRecap = b.type === 'formule' ? getFormulaRecapModel(b) : null;
  const appointmentsLine = successRecap && successRecap.appointments.length
    ? ` Vos rendez-vous : <b>${successRecap.appointments.map(escapeHtml).join(' · ')}</b>.`
    : '';
  const tableLine = successRecap && successRecap.hasTable
    ? ` Votre table vous attend dès votre arrivée${successRecap.arrivalTime ? ` (<b>${escapeHtml(successRecap.arrivalTime)}</b>)` : ''}.`
    : '';
  const freeLine = successRecap && successRecap.freeLabels.length
    ? ` À votre rythme sur place : ${successRecap.freeLabels.map(escapeHtml).join(', ')}, quand vous voulez.`
    : '';
  document.getElementById('successDetails').innerHTML = `${confirmationText} ${b.type === 'formule' ? 'Première activité' : 'Départ prévu'} à <b>${b.startTime}</b>${showLanes && allocated.length ? ` sur la/les piste(s) <b>${allocated.join(' & ')}</b>` : ''}.${appointmentsLine}${tableLine}${arrivalLine}${freeLine} Temps total estimé : <b>${formatDurationLabel(totalDuration)}</b>.${laserLine}`;
  releaseBookingSubmit();
  await sealBookingSubmit();
  goStep(5);
}

function resetBooking() {
  clearBookingAlternatives();
  state.booking = {
    name:'', phone:'', email:'', pax:4,
    date: todayStr(),
    type:'bowling', formuleId:'', duration:1, totalDuration:1, laneCount:1, startTime:'', allocatedLanes:[],
    serverProgram: null,
    preference: createDefaultFormulaPreference(),
    pauseMinutes: 0,
    occasion: '',
    occasionOther: '',
    specialRequest: '',
    opsPlan: null,
    opsResult: null
  };
  document.getElementById('fName').value = '';
  document.getElementById('fPhone').value = '';
  document.getElementById('fEmail').value = '';
  document.getElementById('fPax').value = 4;
  document.getElementById('fDate').value = todayStr();
  const specialRequestInput = document.getElementById('fSpecialRequest');
  if (specialRequestInput) specialRequestInput.value = '';
  setBookingOccasion('');
  setType('bowling');
  renderDurations();
  updatePaxAlert();
  updateSchedHint();
  renderFormulaPreferences();
  goStep(1);
  save();
}

function getStaffMenuPage() {
  return normalizeStaffMenuPage(state.staffMenuPage);
}

function isStaffDashboardActive() {
  return state.view === 'staff' && getStaffMenuPage() === 'dashboard';
}

function isStaffReservationsActive() {
  return state.view === 'staff' && getStaffMenuPage() === 'reservations';
}

function isStaffPricingActive() {
  return state.view === 'staff' && getStaffMenuPage() === 'prices';
}

function isStaffEmailsActive() {
  return state.view === 'staff' && getStaffMenuPage() === 'emails';
}

function isStaffCampaignsActive() {
  return state.view === 'staff' && getStaffMenuPage() === 'campaigns';
}

const STAFF_COCKPIT_MENU_PAGES = ['cockpit', 'cockpit-clients-platform', 'cockpit-centres', 'cockpit-agents', 'cockpit-incidents', 'cockpit-clients', 'cockpit-journal', 'cockpit-ia'];
function isStaffCockpitActive() {
  return state.view === 'staff' && STAFF_COCKPIT_MENU_PAGES.includes(getStaffMenuPage());
}

const STAFF_UTILITY_MENU_PAGES = [
  'formules',
  'sessions',
  'arrivals',
  'events',
  'contacts',
  'lanes',
  'laserGame',
  'establishment',
  'users',
  'settings'
];

function isStaffUtilityActive() {
  return state.view === 'staff' && STAFF_UTILITY_MENU_PAGES.includes(getStaffMenuPage());
}

function setStaffToday() {
  state.currentDate = todayStr();
  save();
  renderStaff();
  syncDateReservations(state.currentDate, { silent: true });
}

function renderDashboardSpark(values = [], className = '') {
  const clean = values.map(value => Number(value) || 0);
  const max = Math.max(...clean, 1);
  const points = clean.map((value, index) => {
    const x = clean.length <= 1 ? 100 : (index / (clean.length - 1)) * 100;
    const y = 38 - ((value / max) * 30);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg class="dash-spark ${escapeHtml(className)}" viewBox="0 0 100 42" preserveAspectRatio="none" aria-hidden="true">
    <polyline points="${points}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"></polyline>
  </svg>`;
}

function renderDashboardIcon(name) {
  const icons = {
    calendar: '<rect x="5" y="6" width="14" height="13" rx="2"></rect><path d="M8 4v4M16 4v4M5 10h14"></path>',
    users: '<path d="M8.5 11.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"></path><path d="M3.5 19c.7-3.4 2.6-5.2 5-5.2s4.3 1.8 5 5.2"></path><path d="M16 11a2.5 2.5 0 1 0 0-5"></path><path d="M17 14c1.9.5 3.1 2 3.5 5"></path>',
    euro: '<path d="M17.5 6.5A6 6 0 1 0 18 17"></path><path d="M5 10h8M5 14h8"></path>',
    activity: '<path d="M9 5h6v4H9zM6 14h12v5H6z"></path><path d="M12 9v5M8 14v-2h8v2"></path>',
    date: '<rect x="5" y="5" width="14" height="14" rx="2"></rect><path d="M8 3v4M16 3v4M5 10h14"></path>',
    lanes: '<path d="M7 4h3l1 16H6L7 4Z"></path><path d="M14 4h3l1 16h-5l1-16Z"></path>',
    prep: '<path d="M5 17h14"></path><path d="M8 17V8a4 4 0 0 1 8 0v9"></path><path d="M10 11h4"></path>',
    play: '<path d="M8 5v14l11-7-11-7Z"></path>',
    check: '<path d="M20 6 9 17l-5-5"></path>',
    laser: '<path d="M12 5v14"></path><path d="M5 12h14"></path><path d="m7 7 10 10M17 7 7 17"></path>',
    wrench: '<path d="M14.5 5.5a4 4 0 0 0 4 4L9 19l-4-4 9.5-9.5Z"></path>'
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.calendar}</svg>`;
}

// COMPOSITION D'UNE RESERVATION EN ACTIVITES. La fiche programme du serveur
// (program.items : id + nom du catalogue vivant) fait foi ; sans elle, le type
// et les fenetres de ressources disent bowling / laser ; un type inconnu reste
// nomme plutot qu'avale par une categorie fourre-tout.
function getReservationActivityEntries(reservation) {
  const items = reservation && reservation.program && Array.isArray(reservation.program.items)
    ? reservation.program.items
    : [];
  if (items.length) {
    const seen = new Map();
    items.forEach(item => {
      const id = String(item.activityId || 'autre');
      if (!seen.has(id)) seen.set(id, { id, name: item.name || ACTIVITY_LABELS[id] || id });
    });
    return [...seen.values()];
  }
  const entries = [];
  if (getBowlingWindowsFromReservation(reservation).length) entries.push({ id: 'bowling', name: ACTIVITY_LABELS.bowling });
  if (getLaserWindowsFromReservation(reservation).length) entries.push({ id: 'laser_game', name: ACTIVITY_LABELS.laser_game });
  if (!entries.length) {
    const id = String(reservation.type || 'autre');
    entries.push({ id, name: ACTIVITY_LABELS[id] || 'Autre activité' });
  }
  return entries;
}

// UNE RESERVATION = UNE PART du donut, classee par sa composition : une seule
// activite -> cette activite ; une formule -> Formules ; un panier libre de
// plusieurs activites -> Multi-activites. Les parts somment donc toujours au
// nombre de reservations, et chaque pourcentage vient de SON compte (jamais
// d'un reste).
function buildStaffActivityMix(activeReservations = []) {
  const buckets = new Map();
  activeReservations.forEach(reservation => {
    const entries = getReservationActivityEntries(reservation);
    const isFormule = reservation.type === 'formule' || reservation.formuleId;
    const key = isFormule ? 'formule' : (entries.length > 1 ? 'multi' : entries[0].id);
    const label = isFormule ? 'Formules' : (entries.length > 1 ? 'Multi-activités' : entries[0].name);
    const bucket = buckets.get(key) || { key, label, count: 0, revenue: 0, players: 0 };
    bucket.count += 1;
    bucket.revenue += Number(reservation.price) || 0;
    bucket.players += Number(reservation.pax) || 0;
    buckets.set(key, bucket);
  });
  return [...buckets.values()].sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

// OCCURRENCES PAR ACTIVITE : combien de dossiers contiennent chaque activite
// du catalogue (une visite bowling + billards compte dans les deux). C'est la
// lecture « qu'est-ce qui tourne aujourd'hui », servie par le detail.
function buildStaffActivityOccurrences(activeReservations = []) {
  const buckets = new Map();
  activeReservations.forEach(reservation => {
    getReservationActivityEntries(reservation).forEach(entry => {
      const bucket = buckets.get(entry.id) || { id: entry.id, name: entry.name, count: 0, revenue: 0, rows: [] };
      bucket.count += 1;
      bucket.rows.push(reservation);
      buckets.set(entry.id, bucket);
    });
  });
  return [...buckets.values()].sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}

// SERIE QUOTIDIENNE SERVIE PAR LE SERVEUR. Le cache local (state.reservations)
// ne contient QUE les dates deja visitees sur CE poste : la carte Revenus
// affichait 0 sur les jours jamais ouverts (« des fois ca montre des fois
// non », capture Movsar 2026-08-18). Le serveur agrege la vraie plage ; le
// calcul local reste le repli tant que la reponse n'est pas la.
let staffDaySeriesCache = { key: '', days: [], at: 0, loading: false };

function getStaffDaySeries() {
  const key = `${getCurrentStaffCenterId()}|${state.currentDate}`;
  return staffDaySeriesCache.key === key ? staffDaySeriesCache.days : [];
}

async function ensureStaffDaySeries() {
  const key = `${getCurrentStaffCenterId()}|${state.currentDate}`;
  const fresh = staffDaySeriesCache.key === key && (Date.now() - staffDaySeriesCache.at) < 60000;
  if (staffDaySeriesCache.loading || (fresh && staffDaySeriesCache.days.length)) return;
  staffDaySeriesCache = { key, days: staffDaySeriesCache.key === key ? staffDaySeriesCache.days : [], at: staffDaySeriesCache.at, loading: true };
  try {
    const centerQuery = encodeURIComponent(getCurrentStaffCenterId());
    const payload = await apiRequest(`${API_ENDPOINTS.staffState}?date=${encodeURIComponent(state.currentDate)}&centerId=${centerQuery}&days=7`);
    staffDaySeriesCache = { key, days: Array.isArray(payload.days) ? payload.days : [], at: Date.now(), loading: false };
    if (state.view === 'staff' && state.staffMenuPage === 'dashboard') renderStaffDashboard();
  } catch (error) {
    // Repli silencieux sur la serie locale : la carte reste honnete, juste
    // limitee aux dates connues du poste.
    staffDaySeriesCache = { key, days: [], at: Date.now(), loading: false };
  }
}

function getStaffDashboardMetrics(dayReservations = todaysReservations()) {
  const activeReservations = dayReservations.filter(reservation => reservation.status !== 'cancelled');
  const now = currentTimeDecimal();
  const planningWindow = getPlanningWindow(state.currentDate);
  const openHours = planningWindow.closed ? 0 : Math.max(planningWindow.close - planningWindow.open, 0);
  const bowlingWindows = activeReservations.flatMap(reservation => getBowlingWindowsFromReservation(reservation).map(window => ({ ...window, reservation })));
  const laserWindows = activeReservations.flatMap(reservation => getLaserWindowsFromReservation(reservation).map(window => ({ ...window, reservation })));
  const revenue = activeReservations.reduce((sum, reservation) => sum + (Number(reservation.price) || 0), 0);
  const collected = activeReservations.filter(reservation => reservation.status === 'paid').reduce((sum, reservation) => sum + (Number(reservation.price) || 0), 0);
  const players = activeReservations.reduce((sum, reservation) => sum + (Number(reservation.pax) || 0), 0);
  const laneHours = bowlingWindows.reduce((sum, window) => sum + ((Number(window.duration) || 0) * Math.max((window.lanes || []).length, 1)), 0);
  const bowlingCapacity = TOTAL_LANES * openHours;
  const occupancy = bowlingCapacity ? Math.round((laneHours / bowlingCapacity) * 100) : 0;
  const upcoming = activeReservations
    .filter(reservation => getReservationFirstResourceStart(reservation, 'all') >= (state.currentDate === todayStr() ? now : 0))
    .sort((left, right) => getReservationFirstResourceStart(left, 'all') - getReservationFirstResourceStart(right, 'all'));
  const activeNow = activeReservations.filter(reservation => {
    return getStaffResourceWindows(reservation, 'all').some(window => window.start <= now && now < window.end);
  });
  // REPARTITION PAR ACTIVITE tiree de la COMPOSITION REELLE de chaque
  // reservation (program.items du serveur, sinon type et fenetres), plus
  // jamais du seul couple bowling/laser : 7 resas dont 2 golf/arcades
  // donnaient « Complet 43 % » avec 1 dossier (2026-08-18, capture Movsar),
  // parce que le pourcentage etait un RESTE (100 - bowling - laser) et que
  // toute activite hors bowling/laser tombait dedans en silence.
  const activityMix = buildStaffActivityMix(activeReservations);
  const activityOccurrences = buildStaffActivityOccurrences(activeReservations);
  // SEANCE FINIE, DOSSIER OUVERT : la fin est passee, rien n'est encaisse.
  const overdueRows = state.currentDate === todayStr()
    ? activeReservations.filter(reservation => {
      if (reservation.status === 'paid') return false;
      const windows = getStaffResourceWindows(reservation, 'all');
      return windows.length > 0 && windows.every(window => window.end <= now);
    })
    : [];
  // DEBUT PASSE, PERSONNE N'EST POINTE : arrivee a pointer ou client a rappeler.
  const noshowRows = state.currentDate === todayStr()
    ? activeReservations.filter(reservation => {
      if (reservation.status === 'paid' || reservation.status === 'arrived') return false;
      const start = getReservationFirstResourceStart(reservation, 'all');
      if (!Number.isFinite(start)) return false;
      const windows = getStaffResourceWindows(reservation, 'all');
      return start + 0.25 <= now && windows.some(window => window.end > now);
    })
    : [];
  const laneUsage = Array.from({ length: TOTAL_LANES }, (_, index) => ({
    lane: index + 1,
    value: bowlingWindows.reduce((sum, window) => sum + ((window.lanes || []).includes(index + 1) ? Number(window.duration || 0) : 0), 0)
  })).sort((left, right) => right.value - left.value);
  // Mini-séries 7 jours HONNÊTES : chaque point vient des réservations réelles
  // du jour (state.reservations), jamais d'une interpolation fabriquée.
  const days = Array.from({ length: 7 }, (_, index) => addDays(state.currentDate, index - 6));
  const dayRows = days.map(date => state.reservations.filter(reservation => reservation.date === date && reservation.status !== 'cancelled'));
  const revenueSeries = dayRows.map(rows => rows.reduce((sum, reservation) => sum + (Number(reservation.price) || 0), 0));
  const reservationSeries = dayRows.map(rows => rows.length);
  const playerSeries = dayRows.map(rows => rows.reduce((sum, reservation) => sum + (Number(reservation.pax) || 0), 0));
  const collectedSeries = dayRows.map(rows => rows.filter(reservation => reservation.status === 'paid').reduce((sum, reservation) => sum + (Number(reservation.price) || 0), 0));
  const occupancySeries = days.map((date, index) => {
    const window = getPlanningWindow(date);
    const open = window.closed ? 0 : Math.max(window.close - window.open, 0);
    const capacity = TOTAL_LANES * open;
    if (!capacity) return 0;
    const usedLaneHours = dayRows[index]
      .flatMap(reservation => getBowlingWindowsFromReservation(reservation))
      .reduce((sum, win) => sum + ((Number(win.duration) || 0) * Math.max((win.lanes || []).length, 1)), 0);
    return Math.min(100, Math.round((usedLaneHours / capacity) * 100));
  });
  // La serie SERVEUR remplace la lecture du cache local pour les jours passes
  // (voir staffDaySeriesCache). Le jour affiche garde la donnee locale : elle
  // est temps reel (poll + mises a jour optimistes), le serveur a 60 s de
  // retard dessus.
  const serverDays = typeof getStaffDaySeries === 'function' ? getStaffDaySeries() : [];
  if (serverDays.length === days.length) {
    serverDays.forEach((day, index) => {
      if (index === days.length - 1 || !day || day.date !== days[index]) return;
      revenueSeries[index] = Number(day.revenue) || 0;
      reservationSeries[index] = Number(day.reservations) || 0;
      playerSeries[index] = Number(day.players) || 0;
      collectedSeries[index] = Number(day.collected) || 0;
      const window = getPlanningWindow(days[index]);
      const open = window.closed ? 0 : Math.max(window.close - window.open, 0);
      const capacity = TOTAL_LANES * open;
      occupancySeries[index] = capacity ? Math.min(100, Math.round(((Number(day.laneHours) || 0) / capacity) * 100)) : 0;
    });
  }
  const currentIndex = days.length - 1;
  const previousRevenue = revenueSeries.slice(0, currentIndex).reduce((sum, value) => sum + value, 0);
  const revenueTrend = previousRevenue ? Math.round(((revenue - (previousRevenue / Math.max(currentIndex, 1))) / (previousRevenue / Math.max(currentIndex, 1))) * 100) : 0;
  const previousDate = addDays(state.currentDate, -1);
  const previousActiveReservations = state.reservations.filter(reservation => reservation.date === previousDate && reservation.status !== 'cancelled');
  const previousPlanningWindow = getPlanningWindow(previousDate);
  const previousOpenHours = previousPlanningWindow.closed ? 0 : Math.max(previousPlanningWindow.close - previousPlanningWindow.open, 0);
  const previousBowlingWindows = previousActiveReservations.flatMap(reservation => getBowlingWindowsFromReservation(reservation).map(window => ({ ...window, reservation })));
  const previousRevenueToday = previousActiveReservations.reduce((sum, reservation) => sum + (Number(reservation.price) || 0), 0);
  const previousPlayers = previousActiveReservations.reduce((sum, reservation) => sum + (Number(reservation.pax) || 0), 0);
  const previousLaneHours = previousBowlingWindows.reduce((sum, window) => sum + ((Number(window.duration) || 0) * Math.max((window.lanes || []).length, 1)), 0);
  const previousOccupancy = (TOTAL_LANES * previousOpenHours) ? Math.round((previousLaneHours / (TOTAL_LANES * previousOpenHours)) * 100) : 0;
  return {
    activeReservations,
    bowlingWindows,
    laserWindows,
    revenue,
    collected,
    players,
    occupancy,
    upcoming,
    activeNow,
    activityMix,
    activityOccurrences,
    overdueRows,
    noshowRows,
    laneUsage,
    revenueSeries,
    reservationSeries,
    playerSeries,
    collectedSeries,
    occupancySeries,
    revenueTrend,
    previousReservationsCount: previousActiveReservations.length,
    previousRevenueToday,
    previousPlayers,
    previousOccupancy,
    planningWindow
  };
}

function formatDashboardTrend(current, previous) {
  const currentValue = Number(current) || 0;
  const previousValue = Number(previous) || 0;
  if (!previousValue) return currentValue ? '+100%' : '0%';
  const delta = Math.round(((currentValue - previousValue) / previousValue) * 100);
  return `${delta > 0 ? '+' : ''}${delta}%`;
}


/* ============================================================================
   CARTES PERMUTABLES du dashboard (Vue d'ensemble). Deux emplacements, tous les
   deux scopés à la JOURNÉE courante (state.currentDate) :
   - carte large (state.dashMainChart) : affluence par heure / réservations par
     heure / charge par piste, du jour ;
   - carte latérale (state.dashSideChart) : formules / canal / occasions du jour.
   Données : getStaffDashboardMetrics (réservations actives d'aujourd'hui, côté
   client). Aucune valeur fabriquée : journée calme = message vide honnête, jamais
   une forme inventée. Graphes délégués à window.PinlaneCharts.
   ========================================================================== */
const DASH_MAIN_CHART_OPTIONS = [
  { id: 'affluence', label: 'Affluence par heure' },
  { id: 'sessions', label: 'Réservations par heure' },
  { id: 'lanes', label: 'Charge par piste' },
];
const DASH_SIDE_CHART_OPTIONS = [
  { id: 'formules', label: 'Formules du jour' },
  { id: 'channel', label: 'Canal de réservation' },
  { id: 'occasions', label: 'Occasions du jour' },
];
// Etat d'ouverture du menu ('main' | 'side' | null) : variable de module, pas
// un noeud : il survit aux re-rendus innerHTML du dashboard (poll de synchro).
let dashChartMenuOpen = null;

function getDashChartSelection(which) {
  const options = which === 'side' ? DASH_SIDE_CHART_OPTIONS : DASH_MAIN_CHART_OPTIONS;
  const stored = which === 'side' ? state.dashSideChart : state.dashMainChart;
  return options.some(option => option.id === stored) ? stored : options[0].id;
}

function setDashChart(which, id) {
  if (which === 'side') state.dashSideChart = id;
  else state.dashMainChart = id;
  dashChartMenuOpen = null;
  save();
  renderStaffDashboard();
  document.querySelector(`[data-dash-picker="${which}"] .dash-chart-picker-btn`)?.focus();
}

function toggleDashChartMenu(which, ev) {
  if (ev) ev.stopPropagation();
  dashChartMenuOpen = dashChartMenuOpen === which ? null : which;
  renderStaffDashboard();
  if (dashChartMenuOpen === which) {
    const menu = document.querySelector(`[data-dash-picker="${which}"] .dash-chart-menu`);
    (menu?.querySelector('button[aria-checked="true"]') || menu?.querySelector('button'))?.focus();
  }
}

function closeDashChartMenu(refocus) {
  if (!dashChartMenuOpen) return;
  const which = dashChartMenuOpen;
  dashChartMenuOpen = null;
  renderStaffDashboard();
  if (refocus) document.querySelector(`[data-dash-picker="${which}"] .dash-chart-picker-btn`)?.focus();
}

function dashChartPickerKeydown(ev, which) {
  if (ev.key === 'Escape') {
    if (dashChartMenuOpen === which) { ev.stopPropagation(); closeDashChartMenu(true); }
    return;
  }
  const menu = ev.currentTarget.querySelector('.dash-chart-menu');
  if (!menu) return;
  const items = Array.from(menu.querySelectorAll('button[role="menuitemradio"]'));
  if (!items.length) return;
  const index = items.indexOf(document.activeElement);
  if (ev.key === 'ArrowDown') { ev.preventDefault(); items[(index + 1) % items.length].focus(); }
  else if (ev.key === 'ArrowUp') { ev.preventDefault(); items[(index - 1 + items.length) % items.length].focus(); }
  else if (ev.key === 'Home') { ev.preventDefault(); items[0].focus(); }
  else if (ev.key === 'End') { ev.preventDefault(); items[items.length - 1].focus(); }
}

// Fermeture au clic hors du sélecteur.
document.addEventListener('click', ev => {
  if (dashChartMenuOpen && !(ev.target && ev.target.closest && ev.target.closest('.dash-chart-picker'))) closeDashChartMenu(false);
});

function renderDashChartPicker(which, currentId) {
  const options = which === 'side' ? DASH_SIDE_CHART_OPTIONS : DASH_MAIN_CHART_OPTIONS;
  const open = dashChartMenuOpen === which;
  const check = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5 6.5 11.5 12.5 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
  return `<div class="dash-chart-picker" data-dash-picker="${which}" onkeydown="dashChartPickerKeydown(event, '${which}')">
    <button type="button" class="dash-chart-picker-btn" aria-haspopup="menu" aria-expanded="${open ? 'true' : 'false'}" onclick="toggleDashChartMenu('${which}', event)">
      Graphique
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6.5 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path></svg>
    </button>
    ${open ? `<div class="dash-chart-menu" role="menu" aria-label="Choisir le graphique">
      ${options.map(option => `<button type="button" role="menuitemradio" aria-checked="${option.id === currentId ? 'true' : 'false'}" onclick="setDashChart('${which}', '${option.id}')">
        <span>${escapeHtml(option.label)}</span><span class="dash-menu-check" aria-hidden="true">${check}</span>
      </button>`).join('')}
    </div>` : ''}
  </div>`;
}

// Corps de la carte large : lecture du JOUR courant (state.currentDate). Les
// trois options (affluence par heure, réservations par heure, charge par piste)
// sont calculées depuis getStaffDashboardMetrics : aucune donnée de période.
// host rempli APRÈS le innerHTML du dashboard : PinlaneCharts monte ses SVG dans
// un noeud vivant. Journée calme = message vide honnête, jamais une forme feinte.
function renderDashMainChartBody(host, metrics) {
  if (!host) return;
  const current = getDashChartSelection('main');
  const charts = window.PinlaneCharts;
  if (!charts) { host.innerHTML = '<div class="dash-empty">Moteur de graphiques indisponible.</div>'; return; }
  const { planningWindow, activeReservations, laneUsage } = metrics;
  const motion = `dash|main|${current}|${state.currentDate}|${activeReservations.length}`;
  if (current === 'lanes') {
    const openHours = planningWindow.closed ? 0 : Math.max(planningWindow.close - planningWindow.open, 0);
    const booked = laneUsage.filter(row => (Number(row.value) || 0) > 0);
    if (!openHours || !booked.length) { host.innerHTML = '<div class="dash-empty">Aucune piste réservée aujourd\'hui.</div>'; return; }
    const series = [...laneUsage]
      .sort((left, right) => left.lane - right.lane)
      .map(row => ({ label: `P${row.lane}`, value: Math.min(100, Math.round(((Number(row.value) || 0) / openHours) * 100)) }));
    charts.barChart(host, { series, format: 'percent', motionKey: motion, height: 230 });
    return;
  }
  if (planningWindow.closed) { host.innerHTML = '<div class="dash-empty">Centre fermé aujourd\'hui.</div>'; return; }
  if (!activeReservations.length) { host.innerHTML = '<div class="dash-empty">Aucune réservation aujourd\'hui.</div>'; return; }
  const open = planningWindow.open;
  const close = planningWindow.close;
  // Chaque reservation compte UNE fois, a son heure d'ARRIVEE (debut du premier
  // creneau, tous types confondus). Sans ca, un groupe qui enchaine bowling puis
  // laser a deux heures differentes apparaissait a CHAQUE heure occupee (un seul
  // groupe de 16 compte a 18h ET 20h). L'arrivee = une entree par groupe.
  const buckets = new Map();
  for (let hour = open; hour < close; hour += 1) buckets.set(hour, { players: 0, sessions: 0 });
  activeReservations.forEach(reservation => {
    const windows = getStaffResourceWindows(reservation, 'all');
    if (!windows.length) return;
    const startHour = Math.floor(Math.min(...windows.map(win => Number(win.start))));
    const hour = Math.min(Math.max(startHour, open), close - 1);
    const bucket = buckets.get(hour);
    if (bucket) { bucket.players += Number(reservation.pax) || 0; bucket.sessions += 1; }
  });
  const series = [];
  for (let hour = open; hour < close; hour += 1) {
    const bucket = buckets.get(hour);
    series.push({ label: formatClockDisplay(hour), value: current === 'sessions' ? bucket.sessions : bucket.players });
  }
  if (series.every(point => !point.value)) { host.innerHTML = '<div class="dash-empty">Aucune activité planifiée sur les heures d\'ouverture d\'aujourd\'hui.</div>'; return; }
  charts.lineChart(host, { series, format: 'int', motionKey: motion, height: 230 });
}

function dashSplitRowsHtml(rows) {
  const max = Math.max(...rows.map(row => Number(row.value) || 0), 1);
  return `<div class="dash-split-rows">${rows.map(row => `
    <div class="dash-split-row">
      <strong>${escapeHtml(row.label)}</strong>
      <span class="dash-split-value">${escapeHtml(row.valueText)}</span>
      <span class="dash-split-track"><i style="width:${Math.max(4, Math.round(((Number(row.value) || 0) / max) * 100))}%"></i></span>
    </div>`).join('')}</div>`;
}

// Corps de la carte latérale : répartition du JOUR courant. Chaque valeur vient
// des réservations actives d'aujourd'hui (formule / canal / occasion déclarée),
// jamais d'un agrégat de période.
function renderDashSideChartBody(host, metrics) {
  if (!host) return;
  const current = getDashChartSelection('side');
  const rows = metrics.activeReservations;
  if (current === 'channel') {
    const charts = window.PinlaneCharts;
    if (!charts) { host.innerHTML = '<div class="dash-empty">Moteur de graphiques indisponible.</div>'; return; }
    let staff = 0;
    let online = 0;
    rows.forEach(reservation => { if (reservation.channel === 'staff') staff += 1; else online += 1; });
    if (!staff && !online) { host.innerHTML = '<div class="dash-empty">Aucune réservation aujourd\'hui.</div>'; return; }
    const parts = [];
    if (online) parts.push({ label: 'En ligne', value: online });
    if (staff) parts.push({ label: 'Staff', value: staff });
    charts.donutChart(host, { parts, format: 'int', motionKey: `dash|side|channel|${state.currentDate}|${rows.length}` });
    return;
  }
  if (current === 'occasions') {
    const counts = new Map();
    rows.forEach(reservation => {
      const occasion = getReservationOccasion(reservation);
      if (!occasion) return;
      counts.set(occasion, (counts.get(occasion) || 0) + 1);
    });
    const list = [...counts.entries()]
      .map(([occasion, count]) => ({ label: STAFF_OCCASION_LABELS[occasion] || occasion, value: count, valueText: `${count}` }))
      .sort((left, right) => right.value - left.value);
    host.innerHTML = list.length ? dashSplitRowsHtml(list) : '<div class="dash-empty">Aucune occasion déclarée aujourd\'hui.</div>';
    return;
  }
  const counts = new Map();
  rows.forEach(reservation => {
    const isFormule = reservation.type === 'formule' || reservation.formuleId;
    if (!isFormule || !reservation.formuleId) return;
    const entry = counts.get(reservation.formuleId) || { count: 0, revenue: 0 };
    entry.count += 1;
    entry.revenue += Number(reservation.price) || 0;
    counts.set(reservation.formuleId, entry);
  });
  const list = [...counts.entries()]
    .map(([id, entry]) => {
      const formule = FORMULES.find(item => item.id === id);
      return {
        label: formule ? formule.name : id,
        value: entry.count,
        valueText: `${entry.count} résa${entry.count > 1 ? 's' : ''} · ${formatMoney(entry.revenue)}`,
      };
    })
    .sort((left, right) => right.value - left.value)
    .slice(0, 6);
  host.innerHTML = list.length ? dashSplitRowsHtml(list) : '<div class="dash-empty">Aucune formule vendue aujourd\'hui.</div>';
}

// LE MIX D'ACTIVITES passe par le composant donut partage (PinlaneCharts) :
// une part par bucket REEL (chaque activite du catalogue vendue aujourd'hui,
// Formules, Multi-activites), pourcentages calcules par le composant depuis
// les comptes. L'ancien anneau CSS a trois tranches codees en dur affichait
// « Complet 43 % » pour 1 dossier : son pourcentage etait le reste des deux
// autres, et golf / arcades / billards n'existaient pour lui pas.
function renderStaffDashboardActivity(metrics) {
  const totalCount = metrics.activeReservations.length;
  return `<div class="dash-activity-mix">
    <div class="dash-activity-mix-total"><strong>${totalCount}</strong><span>réservation${totalCount > 1 ? 's' : ''} aujourd'hui</span></div>
    <div class="dash-range-chart dash-activity-chart" id="dashActivityBody"></div>
  </div>`;
}

function renderDashActivityBody(host, metrics) {
  if (!host) return;
  const charts = window.PinlaneCharts;
  if (!charts) { host.innerHTML = '<div class="dash-empty">Moteur de graphiques indisponible.</div>'; return; }
  const parts = metrics.activityMix.map(bucket => ({ label: bucket.label, value: bucket.count }));
  if (!parts.length) { host.innerHTML = '<div class="dash-empty">Aucune réservation aujourd\'hui.</div>'; return; }
  charts.donutChart(host, {
    parts,
    format: 'int',
    motionKey: `dash|activity|${state.currentDate}|${metrics.activeReservations.length}|${parts.length}`,
  });
}


// La carte du dashboard GROUPE par gravite (Prioritaire / A traiter / A
// suivre) : le comptoir lit l'ordre d'attaque d'un coup d'oeil au lieu d'une
// liste plate. Chaque ligne s'ouvre sur SA surface de resolution (le detail
// pre-filtre, ou tout se repare sur place).
function renderStaffDashboardAlerts(metrics) {
  const alerts = getStaffDashboardAlertDefinitions(metrics);
  if (!alerts.length) {
    return `<div class="dash-alert-row info">
      <span class="dash-alert-dot info" aria-hidden="true"></span>
      <div class="dash-alert-copy"><strong>Tout est à jour</strong><p>Aucune alerte : paiements, séances, demandes et pistes sont sous contrôle.</p></div>
    </div>`;
  }
  const ordered = [...alerts].sort((left, right) => getStaffAlertPriorityMeta(left).rank - getStaffAlertPriorityMeta(right).rank);
  const groups = [];
  ordered.forEach(alert => {
    const meta = getStaffAlertPriorityMeta(alert);
    let group = groups.find(entry => entry.meta.tone === meta.tone);
    if (!group) { group = { meta, items: [] }; groups.push(group); }
    group.items.push(alert);
  });
  const shown = { count: 0 };
  const MAX_ROWS = 6;
  const rendered = groups.map(group => {
    const items = group.items.filter(() => (shown.count += 1) <= MAX_ROWS);
    if (!items.length) return '';
    return `<div class="dash-alert-group">
      <div class="dash-alert-group-head pr-${escapeHtml(group.meta.tone)}"><span class="priority-dot" aria-hidden="true"></span>${escapeHtml(group.meta.label)}<em>${group.items.length}</em></div>
      ${items.map(alert => `<div class="dash-alert-row ${escapeHtml(alert.kind)}">
        <span class="dash-alert-dot ${escapeHtml(alert.kind)}" aria-hidden="true"></span>
        <div class="dash-alert-copy"><strong>${escapeHtml(alert.title)}</strong><p>${escapeHtml(alert.text)}</p></div>
        <div class="dash-alert-actions">
          <button type="button" class="dash-alert-cta" onclick="openStaffDashboardDetail('alerts', '${escapeJsString(alert.kind)}')">${escapeHtml(getStaffAlertCtaLabel(alert.kind))}</button>
        </div>
      </div>`).join('')}
    </div>`;
  }).join('');
  const hidden = ordered.length - Math.min(ordered.length, MAX_ROWS);
  return rendered + (hidden > 0
    ? `<button type="button" class="dash-alert-more" onclick="openStaffDashboardAlerts()">+ ${hidden} autre${hidden > 1 ? 's' : ''} signal${hidden > 1 ? 'aux' : ''} · Voir toutes</button>`
    : '');
}

// Libellé du bouton d'action rapide inline selon le type d'alerte : mène
// directement à la surface de résolution (détail « Voir toutes ») pré-filtrée.
function getStaffAlertCtaLabel(kind) {
  return {
    payment: 'Encaisser',
    overdue: 'Clôturer',
    noshow: 'Pointer',
    review: 'Vérifier',
    warning: 'Traiter',
    maintenance: 'Libérer',
    formula: 'Cadencer',
    lead: 'Traiter les demandes'
  }[kind] || 'Résoudre';
}

function niceRevenueScale(rawMax) {
  const value = Math.max(Number(rawMax) || 0, 100);
  const target = 4;
  const rough = value / target;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const candidates = [1, 2, 2.5, 5, 10];
  let step = 10 * pow;
  for (const candidate of candidates) {
    if (candidate * pow >= rough) { step = candidate * pow; break; }
  }
  const max = Math.max(step, Math.ceil(value / step) * step);
  return { max, step };
}

function formatMoneyShort(value) {
  const amount = Math.round(Number(value) || 0);
  if (Math.abs(amount) >= 1000) {
    const k = amount / 1000;
    const text = Number.isInteger(k) ? String(k) : k.toFixed(1).replace('.', ',');
    return `${text}k €`;
  }
  return `${amount} €`;
}

function renderStaffDashboardRevenue(metrics) {
  const rawMax = Math.max(...metrics.revenueSeries, 0);
  const { max: axisMax, step } = niceRevenueScale(rawMax);
  const days = Array.from({ length: 7 }, (_, index) => addDays(state.currentDate, index - 6));
  const ticks = [];
  for (let value = axisMax; value > -step / 2; value -= step) ticks.push(Math.max(0, Math.round(value)));
  const bars = metrics.revenueSeries.map((value, index) => {
    const date = parseLocalDate(days[index]);
    return {
      amount: Math.round(Number(value) || 0),
      short: date.toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric' }).replace('.', ''),
      full: date.toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' }).replace('.', '')
    };
  });
  const barsData = JSON.stringify(bars.map(bar => ({ f: bar.full, a: bar.amount })));
  return `<div class="dash-revenue-bars" aria-label="Revenus des sept derniers jours" data-revenue-bars="${escapeHtml(barsData)}">
    <div class="dash-revenue-scale">${ticks.map(tick => `<span>${escapeHtml(formatMoneyShort(tick))}</span>`).join('')}</div>
    <div class="dash-revenue-bar-grid">
      ${bars.map((bar, index) => {
        const height = bar.amount > 0 ? Math.max(3, Math.round((bar.amount / axisMax) * 100)) : 0;
        return `<button type="button" class="dash-revenue-bar" data-index="${index}" aria-label="${escapeHtml(`${bar.full} : ${formatMoney(bar.amount)}`)}">
          <span style="height:${height}%"></span>
          <small>${escapeHtml(bar.short)}</small>
        </button>`;
      }).join('')}
    </div>
  </div>`;
}

function openStaffDashboardSection(section) {
  if (section === 'planning') {
    state.staffMenuPage = 'planning';
    save();
    renderStaff();
    syncOpsSidebar();
    return;
  }
  if (section === 'clients') {
    state.staffMenuPage = 'clients';
    save();
    renderStaff();
    syncOpsSidebar();
    return;
  }
  if (section === 'reservations') {
    state.staffMenuPage = 'reservations';
    state.staffStatusFilter = 'all';
    save();
    renderStaff();
    syncOpsSidebar();
    return;
  }
  if (section === 'direction') {
    setView('admin');
    openAdminTab('overview');
  }
}

function getStaffDashboardAlertDefinitions(metrics) {
  const alerts = [];
  const unpaidRows = metrics.activeReservations.filter(reservation => reservation.status !== 'paid');
  if (unpaidRows.length) {
    const outstanding = unpaidRows.reduce((sum, reservation) => sum + (Number(reservation.price) || 0), 0);
    const onSite = unpaidRows.filter(reservation => reservation.status === 'arrived').length;
    alerts.push({
      kind: 'payment',
      priority: onSite ? 'critical' : 'important',
      title: 'Paiement à encaisser',
      text: `${unpaidRows.length} réservation${unpaidRows.length > 1 ? 's' : ''} non payée${unpaidRows.length > 1 ? 's' : ''} · ${formatMoney(outstanding)}${onSite ? ` · ${onSite} déjà sur place` : ''}`,
      rows: unpaidRows,
      action: onSite
        ? `Encaisser en priorité les ${onSite} client${onSite > 1 ? 's' : ''} déjà sur place, puis clôturer les réservations restantes.`
        : 'Encaisser ou clôturer les réservations restées ouvertes.'
    });
  }
  // SEANCE FINIE, DOSSIER OUVERT : plus urgent que le simple « non paye »,
  // ces clients sont peut-etre deja partis. A purger avant la fermeture.
  if (metrics.overdueRows.length) {
    const overdueAmount = sumStaffRowsAmount(metrics.overdueRows);
    alerts.push({
      kind: 'overdue',
      priority: 'critical',
      title: 'Séances terminées non encaissées',
      text: `${metrics.overdueRows.length} séance${metrics.overdueRows.length > 1 ? 's' : ''} finie${metrics.overdueRows.length > 1 ? 's' : ''} sans encaissement · ${formatMoney(overdueAmount)}`,
      rows: metrics.overdueRows,
      action: 'Encaisser chaque dossier avant que le groupe ne quitte le centre, ou clôturer si c\'est déjà réglé.'
    });
  }
  // DEBUT PASSE, PERSONNE N'EST POINTE : soit le groupe est la sans pointage,
  // soit c'est un no-show a rappeler avant de liberer la ressource.
  if (metrics.noshowRows.length) {
    alerts.push({
      kind: 'noshow',
      priority: 'important',
      title: 'Arrivées à pointer',
      text: `${metrics.noshowRows.length} réservation${metrics.noshowRows.length > 1 ? 's' : ''} commencée${metrics.noshowRows.length > 1 ? 's' : ''} sans pointage d'arrivée`,
      rows: metrics.noshowRows,
      action: 'Pointer « Arrivé » si le groupe est là ; sinon appeler le client avant de libérer la piste.'
    });
  }
  const reviewRows = metrics.activeReservations.filter(reservation =>
    reservation.status !== 'cancelled'
    && reservation.validationStatus !== 'confirmed'
    && (reservation.validationStatus === 'staff_review'
      || reservation.riskLevel === 'high'
      || reservation.riskLevel === 'critical'));
  if (reviewRows.length) {
    alerts.push({
      kind: 'review',
      priority: 'important',
      title: 'Réservations à vérifier',
      text: `${reviewRows.length} réservation${reviewRows.length > 1 ? 's' : ''} en attente de validation staff`,
      rows: reviewRows,
      action: 'Valider, ouvrir la fiche ou contacter le client pour lever le doute sur chaque réservation.'
    });
  }
  const lateLaserWindows = metrics.laserWindows.filter(window => window.end > metrics.planningWindow.close);
  if (lateLaserWindows.length) {
    const rows = [...new Map(lateLaserWindows.map(window => [window.reservation.id, window.reservation])).values()];
    const closeLabel = formatClockDisplay(metrics.planningWindow.close);
    alerts.push({
      kind: 'warning',
      priority: 'critical',
      title: 'Laser après fermeture',
      text: `${rows.length} réservation${rows.length > 1 ? 's' : ''} laser se termine${rows.length > 1 ? 'nt' : ''} après ${closeLabel}`,
      rows,
      windows: lateLaserWindows,
      action: `Ces sessions dépassent l'heure de fermeture (${closeLabel}) : vérifier le lancement laser ou décaler le créneau.`
    });
  }
  const maintenanceLanes = Object.entries(state.laneStatuses || {})
    .filter(([, status]) => status === 'maintenance')
    .map(([lane]) => Number(lane))
    .sort((a, b) => a - b);
  if (maintenanceLanes.length) {
    alerts.push({
      kind: 'maintenance',
      priority: 'info',
      title: 'Pistes en maintenance',
      text: `Piste${maintenanceLanes.length > 1 ? 's' : ''} ${maintenanceLanes.map(lane => {
        const window = state.laneMaintenance?.[lane];
        return window && window.until ? `${lane} (jusqu'au ${window.until})` : String(lane);
      }).join(', ')} bloquée${maintenanceLanes.length > 1 ? 's' : ''}`,
      lanes: maintenanceLanes,
      rows: [],
      action: 'Libérer chaque piste dès que le responsable terrain confirme qu\'elle est de nouveau exploitable.'
    });
  }
  const comboRows = metrics.activeReservations.filter(reservation =>
    (reservation.type === 'formule' || reservation.formuleId)
    && reservation.status !== 'paid'
    && getBowlingWindowsFromReservation(reservation).length
    && getLaserWindowsFromReservation(reservation).length);
  if (comboRows.length) {
    alerts.push({
      kind: 'formula',
      priority: 'important',
      title: 'Formules à enchaîner',
      text: `${comboRows.length} formule${comboRows.length > 1 ? 's' : ''} bowling + laser à cadencer aujourd'hui`,
      rows: comboRows,
      action: 'Surveiller le passage bowling → laser pour éviter les retards de groupe.'
    });
  }
  // Un lead sur mesure est de l'argent qui attend une réponse : il passe EN
  // TÊTE. Le compte est celui des demandes ACTIVES (ni traitées ni archivées,
  // regle du 2026-08-14), et il se TRAITE ICI : le panneau d'alertes liste les
  // demandes avec leurs actions (répondre, prendre en charge, marquer traitée)
  // au lieu d'expédier vers la page Clients (« nous emmener dans toutes les
  // categories », Movsar 2026-08-18).
  const activeLeads = typeof getStaffActiveCustomRequestCount === 'function' ? getStaffActiveCustomRequestCount() : 0;
  if (activeLeads > 0) {
    alerts.unshift({
      kind: 'lead',
      priority: 'critical',
      title: `${activeLeads} demande${activeLeads > 1 ? 's' : ''} sur mesure en attente`,
      text: 'Anniversaires, groupes et entreprises qui attendent une réponse.',
      rows: [],
      action: 'Répondre, prendre en charge ou marquer traitée, directement ici.'
    });
  }
  return alerts;
}

function closeStaffDashboardDetail() {
  const overlay = document.getElementById('staffDashboardDetailOverlay');
  if (overlay) overlay.remove();
  document.body.classList.remove('dashboard-detail-open');
}

function dashboardDetailSetStatus(id, status, ev) {
  if (ev) ev.stopPropagation();
  setReservationStatusDirect(id, status, ev);
  refreshStaffDashboardDetailSoon();
}

// Recalcule les metrics + alertes et re-render : le panneau dashboard en
// arrière-plan ET la modale « Voir toutes » ouverte décrémentent tout seuls
// après une résolution (paiement, validation, libération de piste…).
function refreshStaffDashboardDetailSoon(delay = 160) {
  const type = state.dashboardDetailType || 'alerts';
  const kind = state.dashboardDetailKind || '';
  window.setTimeout(() => {
    if (typeof renderStaffData === 'function' && state.view === 'staff' && state.staffMenuPage === 'dashboard') {
      try { renderStaffData(); } catch (error) { /* le dashboard peut ne plus être monté */ }
    }
    if (document.getElementById('staffDashboardDetailOverlay')) openStaffDashboardDetail(type, kind);
  }, delay);
}

// Ouvre la fiche réservation pré-sélectionnée depuis une alerte.
function dashboardDetailOpenReservation(id) {
  closeStaffDashboardDetail();
  openPos(id);
}

// Ouvre le centre de communication (mail + SMS) pour contacter le client
// concerné par l'alerte, en réutilisant le module existant.
function dashboardDetailContact(id) {
  closeStaffDashboardDetail();
  openCommCenter(id);
}

// Valide une réservation en attente (staff_review / risque élevé) puis
// re-render : l'item quitte la file de validation.
function dashboardDetailValidate(id, ev) {
  if (ev) ev.stopPropagation();
  validateReservationDirect(id, ev);
  refreshStaffDashboardDetailSoon(200);
}

// PATCH minimal (validationStatus='confirmed', skipReplan) : confirme la résa
// sans re-planifier. Optimiste + rollback, cohérent avec setReservationStatusDirect.
function validateReservationDirect(id, ev) {
  if (ev) ev.stopPropagation();
  if (!canUseStaffPermission('reservations.edit')) {
    toast('Validation réservée à un rôle autorisé.');
    return;
  }
  const key = String(id);
  const current = state.reservations.find(r => String(r.id) === key) || findStaffReservationById(id);
  if (!current) {
    toast('Réservation introuvable.');
    return;
  }
  if (current.validationStatus === 'confirmed') {
    toast('Réservation déjà validée.');
    return;
  }
  const nextReservation = { ...current, validationStatus: 'confirmed' };
  markReservationMutation(id, nextReservation, ['validationStatus']);
  applyOptimisticReservation(nextReservation, { preserveEditState: true });
  apiRequest(API_ENDPOINTS.staffReservations, {
    method: 'PATCH',
    body: JSON.stringify({
      id: Number(id),
      centerId: current.centerId || current.center_id || getCurrentStaffCenterId(),
      validationStatus: 'confirmed',
      skipReplan: true
    })
  }).then(payload => {
    applyOptimisticReservation(payload.reservation, { preserveEditState: true });
    markReservationMutation(id, payload.reservation, ['validationStatus']);
    toast('Réservation validée');
  }).catch(error => {
    applyOptimisticReservation(current, { preserveEditState: true });
    clearReservationMutation(id);
    toast(error.message || 'Impossible de valider la réservation.');
  });
}

// Libère une piste en maintenance (retour à 'active') via l'endpoint pistes
// existant, avec mise à jour optimiste + rollback.
async function releaseMaintenanceLane(lane, ev) {
  if (ev) ev.stopPropagation();
  const i = Number(lane);
  if (state.laneStatuses[i] !== 'maintenance') return;
  const previousStatus = state.laneStatuses[i];
  state.laneStatuses[i] = 'active';
  save();
  try {
    const payload = await apiRequest(API_ENDPOINTS.staffLanes, {
      method: 'PATCH',
      body: JSON.stringify({ lane: i, status: 'active', centerId: getCurrentStaffCenterId() })
    });
    state.laneStatuses[i] = payload.lane?.status || 'active';
    save();
    toast(`Piste ${i} réactivée`);
  } catch (error) {
    state.laneStatuses[i] = previousStatus;
    save();
    toast(error.message || 'Impossible de libérer la piste.');
  }
}

function dashboardDetailReleaseLane(lane, ev) {
  if (ev) ev.stopPropagation();
  releaseMaintenanceLane(lane, ev);
  refreshStaffDashboardDetailSoon(220);
}

// Actions groupées (footer détail) : encaisse ou libère en un clic.
function dashboardDetailPayAllUnpaid(ev) {
  if (ev) ev.stopPropagation();
  const metrics = getStaffDashboardMetrics(todaysReservations());
  const rows = metrics.activeReservations.filter(r => r.status !== 'paid');
  if (!rows.length) { toast('Aucune réservation à encaisser.'); return; }
  if (!confirm(`Marquer ${rows.length} réservation${rows.length > 1 ? 's' : ''} comme payée${rows.length > 1 ? 's' : ''} ?`)) return;
  rows.forEach(r => setReservationStatusDirect(r.id, 'paid'));
  refreshStaffDashboardDetailSoon(240);
}

function dashboardDetailReleaseAllLanes(ev) {
  if (ev) ev.stopPropagation();
  const lanes = Object.entries(state.laneStatuses || {})
    .filter(([, status]) => status === 'maintenance')
    .map(([l]) => Number(l));
  if (!lanes.length) { toast('Aucune piste en maintenance.'); return; }
  if (!confirm(`Réactiver ${lanes.length} piste${lanes.length > 1 ? 's' : ''} ?`)) return;
  lanes.forEach(lane => releaseMaintenanceLane(lane));
  refreshStaffDashboardDetailSoon(260);
}

function openStaffDashboardDetail(type = 'alerts', kind = '') {
  const metrics = getStaffDashboardMetrics(todaysReservations());
  state.dashboardDetailType = type;
  state.dashboardDetailKind = kind || '';
  let overlay = document.getElementById('staffDashboardDetailOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'staffDashboardDetailOverlay';
    document.body.appendChild(overlay);
  }
  const d = parseLocalDate(state.currentDate);
  const dateLong = d.toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const config = getStaffDashboardDetailConfig(type, kind, metrics);
  overlay.className = 'staff-dashboard-detail-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.onclick = event => {
    if (event.target === overlay) closeStaffDashboardDetail();
  };
  overlay.innerHTML = `
    <section class="dashboard-detail-modal" aria-labelledby="dashboardDetailTitle">
      <div class="dashboard-detail-head">
        <div>
          <span>${escapeHtml(config.eyebrow)}</span>
          <h2 id="dashboardDetailTitle">${escapeHtml(config.title)}</h2>
          <p>${escapeHtml(dateLong)} · ${escapeHtml(config.subtitle)}</p>
        </div>
        <button type="button" class="dashboard-detail-close" onclick="closeStaffDashboardDetail()" aria-label="Fermer">×</button>
      </div>
      <div class="dashboard-detail-summary">
        ${config.stats.map(stat => `<article><span>${escapeHtml(stat.label)}</span><strong>${escapeHtml(stat.value)}</strong><small>${escapeHtml(stat.note || '')}</small></article>`).join('')}
      </div>
      <div class="dashboard-detail-body">
        ${config.body}
      </div>
      <footer class="dashboard-detail-actions">
        ${config.actions.map(action => `<button type="button" class="${escapeHtml(action.className || 'secondary')}" onclick="${action.onclick}">${escapeHtml(action.label)}</button>`).join('')}
      </footer>
    </section>
  `;
  document.body.classList.add('dashboard-detail-open');
  overlay.querySelector('.dashboard-detail-close')?.focus({ preventScroll: true });
}

function getStaffDashboardDetailConfig(type, kind, metrics) {
  const unpaidCount = metrics.activeReservations.filter(reservation => reservation.status !== 'paid').length;
  const baseStats = [
    { label: 'Réservations', value: String(metrics.activeReservations.length), note: `${metrics.players} joueurs` },
    { label: 'À encaisser', value: formatMoney(metrics.revenue - metrics.collected), note: `${unpaidCount} ouvertes` },
    { label: 'Occupation', value: `${metrics.occupancy}%`, note: `${TOTAL_LANES} pistes` }
  ];
  const openPlanning = "closeStaffDashboardDetail(); openStaffDashboardSection('planning');";
  const openReservations = "closeStaffDashboardDetail(); openStaffDashboardSection('reservations');";
  const openDirection = "closeStaffDashboardDetail(); setView('admin'); openAdminTab('overview');";
  if (type === 'alerts') {
    const alerts = getStaffDashboardAlertDefinitions(metrics);
    const visibleAlerts = kind ? alerts.filter(alert => alert.kind === kind) : alerts;
    const outstanding = Math.max(0, metrics.revenue - metrics.collected);
    const onSiteUnpaid = metrics.activeReservations.filter(r => r.status === 'arrived').length;
    return {
      eyebrow: 'Pilotage terrain',
      title: kind ? (visibleAlerts[0]?.title || 'Signal dashboard') : 'Alertes et notifications',
      subtitle: visibleAlerts.length
        ? `${visibleAlerts.length} signal${visibleAlerts.length > 1 ? 'aux' : ''} à traiter`
        : 'Tout est à jour, rien à traiter',
      stats: [
        { label: 'Alertes actives', value: String(alerts.length), note: alerts.length ? 'à traiter maintenant' : 'rien à signaler' },
        { label: 'À encaisser', value: formatMoney(outstanding), note: `${unpaidCount} réservation${unpaidCount > 1 ? 's' : ''} ouverte${unpaidCount > 1 ? 's' : ''}` },
        { label: 'Sur place', value: String(onSiteUnpaid), note: 'clients à servir' }
      ],
      body: renderStaffDashboardAlertsDetail(visibleAlerts),
      actions: getStaffDashboardAlertActions(kind, visibleAlerts, { openReservations, openPlanning })
    };
  }
  if (type === 'revenue') {
    return {
      eyebrow: 'Caisse',
      title: 'Revenus des 7 derniers jours',
      subtitle: `${formatMoney(metrics.revenue)} prévu sur la date affichée`,
      stats: [
        { label: 'Total période', value: formatMoney(metrics.revenueSeries.reduce((sum, value) => sum + value, 0)), note: '7 jours' },
        { label: 'Validé ce jour', value: formatMoney(metrics.collected), note: 'marqué payé' },
        { label: 'Reste à encaisser', value: formatMoney(Math.max(0, metrics.revenue - metrics.collected)), note: `${unpaidCount} réservation(s)` }
      ],
      body: renderStaffDashboardRevenueDetail(metrics),
      actions: [
        { label: 'Copier le résumé', onclick: "copyStaffDashboardSummary()" },
        { label: 'Ouvrir direction', onclick: openDirection, className: 'secondary' }
      ]
    };
  }
  if (type === 'occupation') {
    return {
      eyebrow: 'Capacité pistes',
      title: 'Occupation par heure',
      subtitle: 'lecture détaillée des créneaux piste',
      stats: baseStats,
      body: renderStaffDashboardOccupationDetail(metrics),
      actions: [
        { label: 'Ouvrir le planning', onclick: openPlanning },
        { label: 'Nouvelle réservation', onclick: "closeStaffDashboardDetail(); openQuickBook({ date: state.currentDate, type: 'bowling' });", className: 'secondary' }
      ]
    };
  }
  if (type === 'activity') {
    // Les trois compteurs de tete suivent le mix REEL du jour (les trois plus
    // gros buckets), plus jamais un triptyque bowling / laser / complet fige.
    const topBuckets = metrics.activityMix.slice(0, 3);
    return {
      eyebrow: 'Mix activité',
      title: 'Réservations par activité',
      subtitle: 'toutes les activités du catalogue vendues sur la date affichée',
      stats: topBuckets.length
        ? topBuckets.map(bucket => ({ label: bucket.label, value: String(bucket.count), note: formatMoney(bucket.revenue) }))
        : [{ label: 'Réservations', value: '0', note: 'aucune sur cette date' }],
      body: renderStaffDashboardActivityDetail(metrics),
      actions: [
        { label: 'Voir réservations', onclick: openReservations },
        { label: 'Voir toutes les réservations', onclick: "closeStaffDashboardDetail(); setStaffResourceView('all');", className: 'secondary' }
      ]
    };
  }
  // Le panneau par defaut etait « Prochaines arrivees », ouvert par la carte du
  // meme nom. La carte partie, plus rien n'ouvrait ce panneau : le defaut
  // devient donc les alertes, la seule surface du dashboard qui appelle une
  // action. Un type inconnu (etat sauvegarde d'une ancienne session, par
  // exemple) retombe ici, donc sur un ecran qui existe.
  return getStaffDashboardDetailConfig('alerts', kind, metrics);
}

function getStaffDashboardStatusMeta(reservation) {
  if (reservation.status === 'paid') return { label: 'Payé', className: 'paid' };
  if (reservation.status === 'arrived') return { label: 'Arrivé', className: 'arrived' };
  if (reservation.status === 'cancelled') return { label: 'Annulé', className: 'cancelled' };
  return { label: 'Confirmé', className: 'pending' };
}

function getStaffDashboardReservationOffer(reservation) {
  if (reservation.type === 'formule' || reservation.formuleId) return reservation.formuleName || `Formule ${String(reservation.formuleId || '').replace(/\D/g, '') || ''}`.trim();
  if (getLaserWindowsFromReservation(reservation).length && !getBowlingWindowsFromReservation(reservation).length) return `${getLaserGameCountForReservation(reservation)} partie${getLaserGameCountForReservation(reservation) > 1 ? 's' : ''} Laser Game`;
  const duration = Number(reservation.duration || 1);
  return `Bowling ${duration === 1 ? '1h' : `${String(duration).replace('.', 'h')}`}`;
}

function getStaffDashboardReservationResources(reservation) {
  const bowling = getBowlingWindowsFromReservation(reservation).map(window => {
    const lanes = (window.lanes || []).length ? `piste${window.lanes.length > 1 ? 's' : ''} ${window.lanes.join(', ')}` : 'piste à confirmer';
    return `Bowling ${formatClockDisplay(window.start)}-${formatClockDisplay(window.end)} · ${lanes}`;
  });
  const laser = getLaserWindowsFromReservation(reservation).map(window => {
    const part = window.countIndex ? ` partie ${window.countIndex}/${getLaserGameCountForReservation(reservation)}` : '';
    return `Laser ${formatClockDisplay(window.start)}-${formatClockDisplay(window.end)}${part}`;
  });
  return [...bowling, ...laser].join(' · ') || 'Hors piste';
}

function renderStaffDashboardReservationRows(rows = [], emptyText = 'Aucune donnée à afficher.', kind = '') {
  if (!rows.length) return `<div class="dashboard-detail-empty">${escapeHtml(emptyText)}</div>`;
  return rows.map(reservation => {
    const status = getStaffDashboardStatusMeta(reservation);
    const start = getReservationFirstResourceStart(reservation, 'all');
    return `<article class="dashboard-detail-row ${escapeHtml(status.className)} ${getReservationHighlightClasses(reservation)}">
      <div class="dashboard-detail-time"><strong>${escapeHtml(formatClockDisplay(start))}</strong><span>${escapeHtml(status.label)}</span></div>
      <div class="dashboard-detail-main">
        <strong>${escapeHtml(reservation.name || 'Client')}</strong>
        <span>${escapeHtml(getStaffDashboardReservationOffer(reservation))} · ${Number(reservation.pax || 0)} joueur${Number(reservation.pax || 0) > 1 ? 's' : ''}</span>
        <small>${escapeHtml(getStaffDashboardReservationResources(reservation))}</small>
      </div>
      <div class="dashboard-detail-amount">
        <strong>${formatMoney(reservation.price || 0)}</strong>
        <span>${escapeHtml(reservation.paymentMethod || (reservation.status === 'paid' ? 'Comptoir' : 'Sur place'))}</span>
      </div>
      <div class="dashboard-detail-row-actions">
        ${renderDashboardRowActions(reservation, kind)}
      </div>
    </article>`;
  }).join('');
}

// Boutons d'action réels par type d'alerte : chacun EXÉCUTE la résolution
// (statut, validation) ou mène à l'endroit exact pré-sélectionné (fiche, comm).
// Chaque bouton est masqué si le rôle courant n'a pas la permission requise.
function renderDashboardRowActions(reservation, kind) {
  const id = Number(reservation.id);
  const canStatus = canUseStaffPermission(['reservations.status', 'reservations.edit', 'payments.markPaid']);
  const canEdit = canUseStaffPermission('reservations.edit');
  const canContact = canUseStaffPermission(['emails.send', 'emails.view', 'reservations.edit']);
  const fiche = `<button type="button" onclick="dashboardDetailOpenReservation(${id})">Fiche</button>`;
  const open = `<button type="button" class="primary" onclick="dashboardDetailOpenReservation(${id})">Ouvrir la réservation</button>`;
  const contact = canContact ? `<button type="button" onclick="dashboardDetailContact(${id})">Contacter</button>` : '';
  const encaisser = (canStatus && reservation.status !== 'paid')
    ? `<button type="button" class="primary" onclick="dashboardDetailSetStatus(${id}, 'paid', event)">Encaisser</button>` : '';
  const arrived = (canStatus && reservation.status !== 'arrived' && reservation.status !== 'paid')
    ? `<button type="button" onclick="dashboardDetailSetStatus(${id}, 'arrived', event)">Arrivé</button>` : '';
  const arrivedPrimary = (canStatus && reservation.status !== 'arrived' && reservation.status !== 'paid')
    ? `<button type="button" class="primary" onclick="dashboardDetailSetStatus(${id}, 'arrived', event)">Arrivé</button>` : '';
  const valider = canEdit
    ? `<button type="button" class="primary" onclick="dashboardDetailValidate(${id}, event)">Valider</button>` : '';
  if (kind === 'review') return `${valider}${fiche}${contact}`;
  if (kind === 'payment') return `${encaisser}${arrived}${fiche}`;
  if (kind === 'overdue') return `${encaisser}${fiche}${contact}`;
  if (kind === 'noshow') return `${arrivedPrimary}${contact}${fiche}`;
  if (kind === 'warning') return `${open}${contact}`;
  if (kind === 'formula') return `${open}${arrived}${encaisser}`;
  // Vue par défaut (arrivées, activité…)
  return `${fiche}${arrived}${(canStatus && reservation.status !== 'paid') ? `<button type="button" onclick="dashboardDetailSetStatus(${id}, 'paid', event)">Payé</button>` : ''}`;
}

// Actions du footer de la modale détail, spécialisées par type d'alerte.
function getStaffDashboardAlertActions(kind, visibleAlerts, nav) {
  const actions = [];
  if (kind === 'payment' && canUseStaffPermission(['reservations.status', 'reservations.edit', 'payments.markPaid'])) {
    actions.push({ label: 'Tout encaisser', onclick: 'dashboardDetailPayAllUnpaid(event)', className: 'primary' });
  }
  if (kind === 'maintenance' && canUseStaffPermission(['planning.drag', 'settings.manage'])) {
    actions.push({ label: 'Libérer toutes les pistes', onclick: 'dashboardDetailReleaseAllLanes(event)', className: 'primary' });
  }
  if (kind === 'overdue' && canUseStaffPermission(['reservations.status', 'reservations.edit', 'payments.markPaid'])) {
    actions.push({ label: 'Tout encaisser', onclick: 'dashboardDetailPayAllUnpaid(event)', className: 'primary' });
  }
  if (kind === 'lead') {
    actions.push({ label: 'Toutes les demandes (page Clients)', onclick: "closeStaffDashboardDetail(); openStaffMenuPage('groups')", className: 'secondary' });
  }
  actions.push({ label: 'Voir toutes les réservations', onclick: nav.openReservations, className: actions.length ? 'secondary' : '' });
  actions.push({ label: 'Ouvrir le planning', onclick: nav.openPlanning, className: 'secondary' });
  return actions;
}

// Niveaux d'importance des alertes : repère visuel + ordre de tri (rank).
// critical = Prioritaire (rouge) · important = À traiter (orange) · info = À suivre (bleu).
const STAFF_ALERT_PRIORITY = {
  critical: { rank: 0, tone: 'critical', label: 'Prioritaire' },
  important: { rank: 1, tone: 'important', label: 'À traiter' },
  info: { rank: 2, tone: 'info', label: 'À suivre' }
};

// Priorité par défaut si l'alerte n'en porte pas (robustesse).
const STAFF_ALERT_PRIORITY_FALLBACK = {
  payment: 'important', overdue: 'critical', noshow: 'important', review: 'important', warning: 'critical', maintenance: 'info', formula: 'important'
};

function getStaffAlertPriorityMeta(alert) {
  const level = alert.priority || STAFF_ALERT_PRIORITY_FALLBACK[alert.kind] || 'info';
  return STAFF_ALERT_PRIORITY[level] || STAFF_ALERT_PRIORITY.info;
}

// Tri lecture rapide : plus tôt en premier, puis plus gros montant en premier.
function sortStaffAlertRows(rows = []) {
  return [...rows].sort((left, right) =>
    (getReservationFirstResourceStart(left, 'all') - getReservationFirstResourceStart(right, 'all'))
    || ((Number(right.price) || 0) - (Number(left.price) || 0)));
}

function sumStaffRowsAmount(rows = []) {
  return rows.reduce((sum, reservation) => sum + (Number(reservation.price) || 0), 0);
}

// Découpe une alerte en sous-blocs titrés triés par importance.
// Paiement : clients SUR PLACE (arrivé) d'abord, puis les confirmés à venir.
function getStaffAlertSubsections(alert) {
  const rows = alert.rows || [];
  if (alert.kind === 'payment') {
    const onSite = sortStaffAlertRows(rows.filter(reservation => reservation.status === 'arrived'));
    const upcoming = sortStaffAlertRows(rows.filter(reservation => reservation.status !== 'arrived'));
    const subs = [];
    if (onSite.length) {
      subs.push({ key: 'onsite', tone: 'critical', icon: '⚡', showTotal: true,
        label: 'Sur place, à encaisser maintenant', rows: onSite });
    }
    if (upcoming.length) {
      subs.push({ key: 'upcoming', tone: 'info', showTotal: false,
        label: 'À venir, confirmés', rows: upcoming });
    }
    return subs;
  }
  if (!rows.length) return [];
  return [{ key: 'all', tone: '', showTotal: false, label: '', rows: sortStaffAlertRows(rows) }];
}

// LES DEMANDES SUR MESURE SE TRAITENT DANS LE PANNEAU D'ALERTES : chaque
// demande active (nouvelle ou en cours) est listee avec ses actions reelles
// (repondre par email, appeler, prendre en charge, marquer traitee, ouvrir la
// fiche complete). Avant, ce signal expediait vers la page Clients sans
// contexte : la classe d'ecart que Movsar a nommee le 2026-08-18.
function renderStaffAlertLeadRows() {
  const items = getStaffCustomRequestItems().filter(item => item.status === 'new' || item.status === 'in_progress');
  if (!items.length) {
    return '<div class="dashboard-detail-empty">Aucune demande en attente : tout est traité ou archivé.</div>';
  }
  return items.map(item => {
    const jid = staffClientJs(item.id);
    const occKey = String(item.occasion || '').toLowerCase();
    const metaParts = [
      STAFF_OCCASION_LABELS[occKey] || '',
      item.company || '',
      item.requestedDate ? `Souhait : ${item.requestedDate}` : '',
      Number(item.pax) > 0 ? `${item.pax} pers.` : ''
    ].filter(Boolean).join(' · ');
    return `<article class="dashboard-detail-row lead">
      <div class="dashboard-detail-main">
        <strong>${escapeHtml(item.contactName || 'Contact')} ${renderStaffCustomRequestBadge(item.status)}</strong>
        ${metaParts ? `<span>${escapeHtml(metaParts)}</span>` : ''}
        <small>${escapeHtml(String(item.message || '').slice(0, 220))}</small>
      </div>
      <div class="dashboard-detail-row-actions">
        ${item.email ? `<button type="button" class="primary" onclick="closeStaffDashboardDetail(); composeStaffClientEmail(${staffClientJs(item.email)}, ${staffClientJs(item.contactName || '')})">Répondre</button>` : ''}
        ${item.status === 'new' ? `<button type="button" onclick="dashboardDetailLeadStatus(${jid}, 'in_progress', event)">Prendre en charge</button>` : ''}
        <button type="button" onclick="dashboardDetailLeadStatus(${jid}, 'handled', event)">Marquer traitée</button>
        <button type="button" onclick="closeStaffDashboardDetail(); openStaffMenuPage('groups'); window.setTimeout(() => openStaffCustomRequest(${jid}), 250)">Fiche</button>
      </div>
    </article>`;
  }).join('');
}

// Change le statut d'une demande depuis le panneau d'alertes, puis re-rend :
// le compteur et la liste se mettent a jour sans quitter la surface.
function dashboardDetailLeadStatus(id, status, ev) {
  if (ev) ev.stopPropagation();
  setStaffCustomRequestStatus(id, status);
  refreshStaffDashboardDetailSoon(350);
}

function renderStaffAlertSubsection(sub, kind) {
  const total = sumStaffRowsAmount(sub.rows);
  const metaText = `${sub.rows.length} résa${sub.rows.length > 1 ? 's' : ''}${sub.showTotal && total > 0 ? ` · ${formatMoney(total)}` : ''}`;
  const head = sub.label
    ? `<div class="alert-subsection-head tone-${escapeHtml(sub.tone || 'neutral')}">
        <span class="alert-subsection-title">${sub.icon ? `<span class="alert-subsection-icon" aria-hidden="true">${escapeHtml(sub.icon)}</span>` : ''}${escapeHtml(sub.label)}</span>
        <span class="alert-subsection-meta">${escapeHtml(metaText)}</span>
      </div>`
    : '';
  return `<div class="alert-subsection tone-${escapeHtml(sub.tone || 'neutral')}">
    ${head}
    ${renderStaffDashboardReservationRows(sub.rows, 'Aucun élément à traiter.', kind)}
  </div>`;
}

function renderStaffDashboardAlertsDetail(alerts = []) {
  if (!alerts.length) {
    return `<div class="dashboard-detail-empty">Aucune alerte active. Les réservations restent surveillées en temps réel.</div>`;
  }
  const canRelease = canUseStaffPermission(['planning.drag', 'settings.manage']);
  // Ordonne du plus urgent (Prioritaire) au moins urgent (À suivre). Tri stable :
  // à rang égal, l'ordre métier d'origine (paiement > vérif > laser > …) est conservé.
  const ordered = [...alerts].sort((left, right) => getStaffAlertPriorityMeta(left).rank - getStaffAlertPriorityMeta(right).rank);
  return ordered.map(alert => {
    const meta = getStaffAlertPriorityMeta(alert);
    const rows = alert.rows || [];
    const total = sumStaffRowsAmount(rows);
    // Une demande sur mesure n'est PAS une réservation : elle n'occupe aucun
    // créneau. Le compteur du détail doit dire « demande », jamais « résa »,
    // et compter les ACTIVES (ni traitées ni archivées, règle du 2026-08-14).
    const leadCount = typeof getStaffActiveCustomRequestCount === 'function' ? getStaffActiveCustomRequestCount() : 0;
    const count = alert.kind === 'maintenance' ? (alert.lanes || []).length
      : alert.kind === 'lead' ? leadCount
        : rows.length;
    const countLabel = alert.kind === 'maintenance'
      ? `${count} piste${count > 1 ? 's' : ''}`
      : alert.kind === 'lead'
        ? `${count} demande${count > 1 ? 's' : ''}`
        : `${count} résa${count > 1 ? 's' : ''}`;
    const laneChips = alert.lanes?.length
      ? `<div class="dashboard-detail-lane-chips">${alert.lanes.map(lane => `<span class="lane-chip">Piste ${Number(lane)}${canRelease ? `<button type="button" class="lane-release" onclick="dashboardDetailReleaseLane(${Number(lane)}, event)">Libérer</button>` : ''}</span>`).join('')}</div>`
      : '';
    const subsections = getStaffAlertSubsections(alert);
    const body = alert.kind === 'lead'
      ? renderStaffAlertLeadRows()
      : subsections.length
        ? subsections.map(sub => renderStaffAlertSubsection(sub, alert.kind)).join('')
        : (laneChips ? '' : `<div class="dashboard-detail-empty">Pas de réservation liée à ce signal.</div>`);
    return `<section class="dashboard-detail-section alert-section pr-${meta.tone} alert-${escapeHtml(alert.kind)}">
      <div class="alert-section-head">
        <div class="alert-section-heading">
          <span class="priority-badge pr-${meta.tone}"><span class="priority-dot" aria-hidden="true"></span>${escapeHtml(meta.label)}</span>
          <h3>${escapeHtml(alert.title)}</h3>
        </div>
        <div class="alert-section-meta">
          <span class="alert-count">${escapeHtml(countLabel)}</span>
          ${total > 0 ? `<span class="alert-total">${formatMoney(total)}</span>` : ''}
        </div>
      </div>
      <p class="alert-section-note">${escapeHtml(alert.action || alert.text)}</p>
      ${laneChips}
      ${body}
    </section>`;
  }).join('');
}

function renderStaffDashboardRevenueDetail(metrics) {
  // Chaque colonne vient des series de metrics : elles portent la verite
  // SERVEUR pour les jours passes (voir staffDaySeriesCache), plus jamais le
  // cache local qui ne connaissait que les dates visitees sur ce poste.
  const days = Array.from({ length: 7 }, (_, index) => addDays(state.currentDate, index - 6));
  const rows = days.map((date, index) => ({
    date,
    count: metrics.reservationSeries[index] || 0,
    revenue: metrics.revenueSeries[index] || 0,
    collected: metrics.collectedSeries[index] || 0
  }));
  const max = Math.max(...rows.map(row => row.revenue), 1);
  return `<div class="dashboard-detail-section">
    <div class="dashboard-detail-section-head"><h3>Détail caisse</h3><p>Prévu, encaissé et reste à suivre sur les 7 derniers jours.</p></div>
    <div class="dashboard-detail-revenue-list">
      ${rows.map(row => `<div class="dashboard-detail-revenue-row">
        <time>${escapeHtml(parseLocalDate(row.date).toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric', month: 'short' }).replace('.', ''))}</time>
        <span><i style="width:${Math.max(4, Math.round((row.revenue / max) * 100))}%"></i></span>
        <strong>${formatMoney(row.revenue)}</strong>
        <small>${row.count} rés. · ${formatMoney(row.collected)} validés</small>
      </div>`).join('')}
    </div>
  </div>`;
}

function renderStaffDashboardOccupationDetail(metrics) {
  const rows = [];
  const { planningWindow, bowlingWindows } = metrics;
  if (!planningWindow.closed) {
    for (let hour = planningWindow.open; hour < planningWindow.close; hour++) {
      const windows = bowlingWindows.filter(window => Math.max(0, Math.min(hour + 1, window.end) - Math.max(hour, window.start)) > 0);
      const laneLoad = windows.reduce((sum, window) => sum + Math.max((window.lanes || []).length, 1), 0);
      rows.push({ hour, windows, laneLoad });
    }
  }
  return `<div class="dashboard-detail-section">
    <div class="dashboard-detail-section-head"><h3>Lecture horaire</h3><p>Charge piste approximative par heure, utile avant de déplacer une réservation.</p></div>
    <div class="dashboard-detail-hour-grid">
      ${rows.map(row => `<article>
        <time>${escapeHtml(formatClockDisplay(row.hour))}</time>
        <strong>${row.laneLoad}/${TOTAL_LANES}</strong>
        <span>${row.windows.length} bloc${row.windows.length > 1 ? 's' : ''}</span>
        <small>${row.windows.slice(0, 3).map(window => escapeHtml(window.reservation.name || 'Client')).join(', ') || 'Disponible'}</small>
      </article>`).join('') || `<div class="dashboard-detail-empty">Centre fermé sur cette date.</div>`}
    </div>
  </div>`;
}

// UNE SECTION PAR ACTIVITE DU CATALOGUE presente aujourd'hui (occurrences :
// une visite bowling + billards apparait dans les deux sections, c'est la
// question du comptoir « qu'est-ce qui tourne »). Fini le triptyque fige.
function renderStaffDashboardActivityDetail(metrics) {
  const groups = metrics.activityOccurrences;
  if (!groups.length) {
    return '<div class="dashboard-detail-empty">Aucune réservation sur cette date.</div>';
  }
  return groups.map(group => `<section class="dashboard-detail-section">
    <div class="dashboard-detail-section-head"><h3>${escapeHtml(group.name)}</h3><p>${group.count} réservation${group.count > 1 ? 's' : ''} contien${group.count > 1 ? 'nent' : 't'} cette activité</p></div>
    ${renderStaffDashboardReservationRows(sortStaffAlertRows(group.rows).slice(0, 12), 'Aucune réservation dans cette activité.')}
  </section>`).join('');
}

function copyStaffDashboardSummary() {
  const metrics = getStaffDashboardMetrics(todaysReservations());
  const text = [
    `Dashboard Pinlane - ${state.currentDate}`,
    `Réservations: ${metrics.activeReservations.length}`,
    `Joueurs: ${metrics.players}`,
    `CA prévu: ${formatMoney(metrics.revenue)}`,
    `Validé: ${formatMoney(metrics.collected)}`,
    `Occupation bowling: ${metrics.occupancy}%`,
    `À suivre: ${metrics.activeReservations.filter(reservation => reservation.status !== 'paid').length}`
  ].join('\n');
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(() => toast('Résumé copié.')).catch(() => toast(text));
  } else {
    toast(text);
  }
}

function openStaffDashboardAlert(kind = 'info') {
  openStaffDashboardDetail('alerts', kind);
}

function openStaffDashboardAlerts() {
  openStaffDashboardDetail('alerts');
}

function openStaffDashboardRevenue() {
  openStaffDashboardDetail('revenue');
}



function renderStaffDashboard(dayReservations = todaysReservations()) {
  const root = document.getElementById('staffDashboardPage');
  if (!root) return;
  // La file des demandes sur mesure n'était chargée QUE depuis la page Clients :
  // sans cet appel, l'alerte « demandes sur mesure » resterait invisible pour
  // quelqu'un qui n'ouvre jamais le bon filtre. Sans effet de bord de rendu
  // ici : loadStaffCustomRequests repasse par renderStaffGroupHost.
  if (typeof ensureStaffCustomRequests === 'function') ensureStaffCustomRequests();
  // La serie 7 jours vient du serveur (voir staffDaySeriesCache) : declenchee
  // ici, elle re-rend le dashboard a l'arrivee de la reponse.
  ensureStaffDaySeries();
  const metrics = getStaffDashboardMetrics(dayReservations);
  const d = parseLocalDate(state.currentDate);
  const revenueTrendText = metrics.revenueTrend > 0 ? `+${metrics.revenueTrend}%` : `${metrics.revenueTrend}%`;
  const reservationTrendText = formatDashboardTrend(metrics.activeReservations.length, metrics.previousReservationsCount);
  const playerTrendText = formatDashboardTrend(metrics.players, metrics.previousPlayers);
  const occupancyTrendText = formatDashboardTrend(metrics.occupancy, metrics.previousOccupancy);
  const availableLanes = TOTAL_LANES - Object.values(state.laneStatuses || {}).filter(status => status === 'maintenance').length;
  const totalPeriodRevenue = metrics.revenueSeries.reduce((sum, value) => sum + value, 0);
  const syncIndicator = getRemoteSyncIndicator();
  root.innerHTML = `
    <section class="dash-hero">
      <div>
        <h1>Dashboard</h1>
        <p>Vue d'ensemble de votre activité <span class="dash-live-dot${syncIndicator.tone === 'live' ? '' : ` ${syncIndicator.tone}`}"></span><span>${escapeHtml(syncIndicator.label)}</span></p>
      </div>
      <div class="dash-actions">
        ${staffDateNavHtml()}
        <button type="button" class="dash-new-btn" onclick="openQuickBook()">+ Réservation rapide</button>
      </div>
    </section>

    <section class="dash-kpis">
      <article class="dash-kpi purple">
        <div class="dash-icon">${renderDashboardIcon('calendar')}</div>
        <div class="dash-kpi-copy"><span>Réservations aujourd'hui</span><strong data-pl-num="dash.resa">${metrics.activeReservations.length}</strong><small>sessions piste</small></div>
        <div class="dash-kpi-trend"><strong>${escapeHtml(reservationTrendText)}</strong><span>vs hier</span></div>
        ${renderDashboardSpark(metrics.reservationSeries, 'purple')}
      </article>
      <article class="dash-kpi blue">
        <div class="dash-icon">${renderDashboardIcon('users')}</div>
        <div class="dash-kpi-copy"><span>Joueurs aujourd'hui</span><strong data-pl-num="dash.joueurs">${metrics.players}</strong><small>personnes</small></div>
        <div class="dash-kpi-trend"><strong>${escapeHtml(playerTrendText)}</strong><span>vs hier</span></div>
        ${renderDashboardSpark(metrics.playerSeries, 'blue')}
      </article>
      <article class="dash-kpi green">
        <div class="dash-icon">${renderDashboardIcon('euro')}</div>
        <div class="dash-kpi-copy"><span>Chiffre d'affaires</span><strong data-pl-num="dash.ca">${formatMoney(metrics.revenue)}</strong><small>${formatMoney(metrics.collected)} validés aujourd'hui</small></div>
        <div class="dash-kpi-trend"><strong>${escapeHtml(revenueTrendText)}</strong><span>vs hier</span></div>
        ${renderDashboardSpark(metrics.revenueSeries, 'green')}
      </article>
      <article class="dash-kpi orange">
        <div class="dash-icon">${renderDashboardIcon('activity')}</div>
        <div class="dash-kpi-copy"><span>Taux d'occupation</span><strong data-pl-num="dash.occupation">${metrics.occupancy}%</strong><small>${availableLanes} pistes disponibles</small></div>
        <div class="dash-kpi-trend"><strong>${escapeHtml(occupancyTrendText)}</strong><span>vs hier</span></div>
        ${renderDashboardSpark(metrics.occupancySeries, 'orange')}
      </article>
    </section>

    <section class="dash-grid-main">
      <article class="dash-card dash-card-wide dash-card-pickable">
        <div class="dash-card-head">
          <div class="dash-card-titles"><h2>${escapeHtml((DASH_MAIN_CHART_OPTIONS.find(option => option.id === getDashChartSelection('main')) || DASH_MAIN_CHART_OPTIONS[0]).label)}</h2><span class="dash-card-meta">Aujourd'hui</span></div>
          ${renderDashChartPicker('main', getDashChartSelection('main'))}
        </div>
        <div class="dash-range-chart dash-range-chart-main" id="dashMainChartBody"></div>
      </article>
      <article class="dash-card">
        <div class="dash-card-head"><h2>Réservations par activité</h2><button type="button" onclick="openStaffDashboardDetail('activity')">Détails</button></div>
        ${renderStaffDashboardActivity(metrics)}
      </article>
      <article class="dash-card dash-card-pickable">
        <div class="dash-card-head">
          <div class="dash-card-titles"><h2>${escapeHtml((DASH_SIDE_CHART_OPTIONS.find(option => option.id === getDashChartSelection('side')) || DASH_SIDE_CHART_OPTIONS[0]).label)}</h2><span class="dash-card-meta">Aujourd'hui</span></div>
          ${renderDashChartPicker('side', getDashChartSelection('side'))}
        </div>
        <div class="dash-range-chart dash-range-chart-side" id="dashSideChartBody"></div>
      </article>
    </section>

    <!-- « PROCHAINES ARRIVEES » A ETE RETIREE D ICI (2026-08-14). Verbatim
         Movsar : « tu as rajoute ca dans dashboard et c'est bugge a mort et ca
         sert a rien en plus ici ». Elle ne venait d'aucun agent : elle est dans
         le tout premier commit de la console. Deux raisons de la retirer, et
         la seconde est la vraie.
         (1) Elle etait FAUSSE : « metrics.upcoming » retient toute reservation
             dont l'heure de depart est encore devant, QUEL QUE SOIT son etat.
             Une carte intitulee « Prochaines arrivees » listait donc des
             clients deja marques « Arrive » et des dossiers deja « Paye », et
             sa pastille melangeait l'etat et le TYPE (« Formule » a la place
             d'un statut) : la meme classe d'erreur que les onglets qui
             melangeaient trois questions.
         (2) Elle REJOUAIT une liste qui a sa propre page. Le dashboard repond
             a « comment va ma journee » : des indicateurs, des courbes, des
             alertes, un etat des ressources. Une liste de dossiers se lit ou
             on peut agir dessus, c'est-a-dire dans Planning et Reservations.
         « metrics.upcoming » reste : la bande du bas s'en sert pour compter les
         sessions en preparation. -->
    <section class="dash-grid-bottom">
      <article class="dash-card">
        <div class="dash-card-head"><h2>Alertes & notifications</h2><button type="button" onclick="openStaffDashboardAlerts()">Voir toutes</button></div>
        <div class="dash-alerts">${renderStaffDashboardAlerts(metrics)}</div>
      </article>
      <article class="dash-card dash-revenue-card">
        <div class="dash-card-head"><h2>Revenus</h2><button type="button" onclick="openStaffDashboardRevenue()">7 derniers jours</button></div>
        <div class="dash-revenue-head"><strong>${formatMoney(totalPeriodRevenue)}</strong><span>Total</span><small>${escapeHtml(revenueTrendText)} vs période précédente</small></div>
        ${renderStaffDashboardRevenue(metrics)}
      </article>
    </section>

    <section class="dash-status-strip">
      <div><span>${renderDashboardIcon('lanes')}</span><small>Pistes disponibles</small><strong>${availableLanes} / ${TOTAL_LANES}</strong><em>${TOTAL_LANES ? Math.round((availableLanes / TOTAL_LANES) * 100) : 0}%</em></div>
      <div><span>${renderDashboardIcon('prep')}</span><small>En préparation</small><strong>${metrics.upcoming.length} session${metrics.upcoming.length > 1 ? 's' : ''}</strong></div>
      <div><span>${renderDashboardIcon('play')}</span><small>En cours</small><strong>${metrics.activeNow.length} session${metrics.activeNow.length > 1 ? 's' : ''}</strong></div>
      <div><span>${renderDashboardIcon('check')}</span><small>Terminées</small><strong>${metrics.activeReservations.filter(r => r.status === 'paid').length} sessions</strong></div>
      <div><span>${renderDashboardIcon('laser')}</span><small>Lasers disponibles</small><strong>${LASER_GAME_PARALLEL_LAUNCHES} / ${LASER_GAME_PARALLEL_LAUNCHES}</strong></div>
      <div><span>${renderDashboardIcon('wrench')}</span><small>Maintenance</small><strong>${Object.values(state.laneStatuses || {}).filter(status => status === 'maintenance').length}</strong></div>
    </section>
  `;
  setupStaffDashboardCharts(metrics);
}

function setupStaffDashboardCharts(metrics) {
  const root = document.getElementById('staffDashboardPage');
  if (!root) return;
  renderDashMainChartBody(document.getElementById('dashMainChartBody'), metrics);
  renderDashSideChartBody(document.getElementById('dashSideChartBody'), metrics);
  renderDashActivityBody(document.getElementById('dashActivityBody'), metrics);
  const revenue = root.querySelector('.dash-revenue-bars[data-revenue-bars]');
  if (revenue) setupRevenueChartInteraction(revenue);
}


function setupRevenueChartInteraction(container) {
  let bars;
  try { bars = JSON.parse(container.dataset.revenueBars || '[]'); } catch (_) { return; }
  const barEls = Array.from(container.querySelectorAll('.dash-revenue-bar'));
  if (!bars.length || !barEls.length) return;
  const tip = document.createElement('div');
  tip.className = 'dash-chart-tip dash-chart-tip-bar';
  tip.setAttribute('role', 'status');
  tip.hidden = true;
  container.appendChild(tip);
  const hide = () => { tip.hidden = true; barEls.forEach(el => el.classList.remove('is-active')); };
  const show = index => {
    const info = bars[index];
    const el = barEls[index];
    if (!info || !el) return;
    barEls.forEach(other => other.classList.toggle('is-active', other === el));
    tip.innerHTML = `<strong>${escapeHtml(info.f)}</strong><b>${escapeHtml(formatMoney(info.a))}</b>`;
    tip.hidden = false;
    const contRect = container.getBoundingClientRect();
    const barRect = el.getBoundingClientRect();
    const centerX = barRect.left - contRect.left + barRect.width / 2;
    const left = Math.max(4, Math.min(centerX - tip.offsetWidth / 2, contRect.width - tip.offsetWidth - 4));
    tip.style.left = `${left}px`;
    tip.style.top = `${Math.max(0, (barRect.top - contRect.top) - tip.offsetHeight - 6)}px`;
  };
  barEls.forEach((el, index) => {
    el.addEventListener('pointerenter', () => show(index));
    el.addEventListener('focus', () => show(index));
    el.addEventListener('blur', hide);
  });
  container.addEventListener('pointerleave', hide);
}

function openStaffMenuPage(page, resource = '') {
  const requestedPage = String(page || 'dashboard').trim();
  // Fusion Clients+Groupes : l'ancienne page « groups » vit dans Clients,
  // segment « À venir ». L'alias est résolu AVANT la normalisation, sinon la
  // comparaison de fin (cleanPage !== requestedPage) prend le remap pour une
  // page inconnue et affiche « Page indisponible » sur un lien parfaitement
  // valide - c'est exactement le chemin qu'emprunte l'alerte « demandes ».
  const aliasedPage = requestedPage === 'groups' ? 'clients' : requestedPage;
  const cleanPage = normalizeStaffMenuPage(aliasedPage);
  if (requestedPage === 'groups' && cleanPage === 'clients') {
    state.staffClientSegment = 'avenir';
    if (typeof ensureStaffCustomRequests === 'function') ensureStaffCustomRequests();
  }
  if (cleanPage !== aliasedPage) {
    if (typeof showPlanningMoveNotice === 'function') {
      showPlanningMoveNotice('Page indisponible', 'Cette section n existe pas encore dans le back-office. Ouverture du planning.', 'warning');
    } else {
      toast('Section indisponible.');
    }
  }
  if (!canUseStaffPage(cleanPage)) {
    toast('Accès non autorisé pour ce rôle.');
    return;
  }
  state.staffMenuPage = cleanPage;
  if (resource) state.staffResourceView = resource;
  setStaffRouteHash(state.staffMenuPage, resource || state.staffResourceView);
  save();
  renderStaff();
  syncOpsSidebar();
}

function openStaffPlanningResource(resource = 'bowling') {
  if (!canUseStaffPage('planning')) {
    toast('Accès planning non autorisé.');
    return;
  }
  state.staffMenuPage = 'planning';
  state.staffResourceView = ['all', 'bowling', 'laser'].includes(resource) ? resource : 'bowling';
  setStaffRouteHash('planning', state.staffResourceView);
  save();
  renderStaff();
  syncOpsSidebar();
}

function setStaffRouteHash(page = getStaffMenuPage(), resource = '') {
  if (typeof window === 'undefined') return;
  const cleanPage = String(page || 'dashboard').trim();
  const cleanResource = String(resource || '').trim();
  const route = cleanPage === 'planning' && ['all', 'bowling', 'laser'].includes(cleanResource)
    ? `#/staff/planning/${cleanResource}`
    : `#/staff/${cleanPage}`;
  writeAppUrl(APP_ROUTE_PATH, route);
}

// ── URL <-> vue ────────────────────────────────────────────────────────────
// Avant, SEULE la partie staff ecrivait dans l'URL. Consequence visible : on
// lisait « mngfunglxy.com/#/staff/users » au-dessus du parcours de reservation
// CLIENT, et le parcours client n'avait aucune adresse a lui. Desormais chaque
// vue a son adresse :
//   client    -> /reserver          (page publique, deja dans le sitemap)
//   staff     -> /#/staff/<page>    (inchange : le hash n'est pas envoye au
//                                    serveur, donc aucun impact sur le Basic
//                                    Auth du middleware)
//   direction -> /#/admin/<onglet>
const CLIENT_ROUTE_PATH = '/reserver';
const APP_ROUTE_PATH = '/';

// LA DEMONSTRATION PUBLIQUE A SON CHEMIN, ET IL DOIT SURVIVRE (2026-08-08).
// `/demo` fait tourner cette meme application sur des donnees fabriquees
// (assets/demo-mode.js). Or les deux chemins canoniques ci-dessus etaient
// ecrits dans l'URL a CHAQUE changement de vue : des le premier rendu,
// `history.replaceState` remplacait `/demo` par `/`. Consequences en chaine,
// toutes constatees : l'adresse n'etait plus partageable, un rechargement
// servait la console REELLE (le faux reseau ne se posait plus), la session de
// demonstration etait rejetee par le vrai serveur, et le prospect tombait sur
// l'ecran de code d'acces. C'est pour ca que la vitrine ne liait pas la demo.
// La regle est donc : sur `/demo`, l'application ecrit `/demo` - le fragment
// continue de porter la page, la query string reste preservee. Sur tout autre
// chemin, comportement STRICTEMENT inchange.
const DEMO_ROUTE_PATH = '/demo';
function isDemoRoute() {
  try { return /^\/demo\/?$/i.test(window.location.pathname || ''); } catch (error) { return false; }
}

function getCurrentPathname() {
  try { return String(window.location.pathname || '/').replace(/\/+$/, '') || '/'; } catch (error) { return '/'; }
}

function writeAppUrl(pathname, hash = '', { push = false } = {}) {
  if (typeof window === 'undefined' || !window.history) return;
  if (isDemoRoute()) pathname = DEMO_ROUTE_PATH;
  // La query string est PRESERVEE : elle peut porter un parametre de campagne ou
  // de centre, et la perdre en changeant d'onglet casserait le suivi.
  let search = '';
  try { search = String(window.location.search || ''); } catch (error) { search = ''; }
  const target = `${pathname}${search}${hash || ''}`;
  const current = `${getCurrentPathname()}${search}${window.location.hash || ''}`;
  if (current === target) return;
  try {
    if (push) window.history.pushState(null, '', target);
    else window.history.replaceState(null, '', target);
  } catch (error) {
    // Un contexte sans History API (fichier local, bac a sable) ne doit jamais
    // empecher la bascule de vue.
  }
}

function syncViewUrl(view = state.view, { push = false } = {}) {
  if (view === 'client') {
    writeAppUrl(CLIENT_ROUTE_PATH, '', { push });
    return;
  }
  if (view === 'admin') {
    const tab = String(state.adminTab || 'overview').trim() || 'overview';
    writeAppUrl(APP_ROUTE_PATH, `#/admin/${tab}`, { push });
    return;
  }
  const page = String(getStaffMenuPage() || 'dashboard').trim();
  const resource = page === 'planning' && ['all', 'bowling', 'laser'].includes(state.staffResourceView)
    ? `/${state.staffResourceView}`
    : '';
  writeAppUrl(APP_ROUTE_PATH, `#/staff/${page}${resource}`, { push });
}

function getStaffUtilityReservations() {
  return todaysReservations()
    .filter(reservation => reservation.status !== 'cancelled')
    .sort((left, right) => getReservationFirstResourceStart(left, 'all') - getReservationFirstResourceStart(right, 'all'));
}

function isStaffUtilityEventReservation(reservation) {
  const text = `${reservation.name || ''} ${reservation.label || ''} ${reservation.notes || ''} ${getReservationLabel(reservation)}`.toLowerCase();
  return reservation.type === 'formule'
    || reservation.formuleId
    || Number(reservation.pax || 0) >= 10
    || /anniversaire|birthday|groupe|ecole|école|team|entreprise|event|evenement|événement/.test(text);
}

// Sous-titre des pages staff. Il annoncait la PLOMBERIE : « Données API +
// locales · 12 réservations visibles · lecture locale ». Personne n'a besoin
// de savoir d'ou sortent les octets - et « lecture locale » laissait croire
// que le poste travaillait sur une copie perimee alors que le serveur fait
// autorite des qu'il a repondu.
// Regle : SILENCE quand tout va bien ; on ne parle que si la connexion au
// serveur est perdue, parce que la, ca change ce que le staff doit croire de
// ce qu'il voit.
function getStaffUtilitySyncLabel() {
  const indicator = getRemoteSyncIndicator();
  if (indicator.tone === 'live') return '';
  return indicator.label;
}

function renderStaffUtilityKpi(label, value, detail = '', tone = '') {
  return `<article class="utility-kpi ${escapeHtml(tone)}">
    <span>${escapeHtml(label)}</span>
    <strong>${escapeHtml(String(value))}</strong>
    <small>${escapeHtml(detail)}</small>
  </article>`;
}

function getStaffUtilityOverviewTitle(model) {
  const titles = {
    sessions: 'File terrain',
    arrivals: 'Accueil du jour',
    events: 'Dossiers sensibles',
    groups: 'Portefeuille groupes',
    contacts: 'Carnet exploitable',
    lanes: 'Etat des pistes',
    laserGame: 'Lecture Laser Game',
    establishment: 'Centre connecte',
    users: 'Controle des acces',
    settings: 'Poste staff'
  };
  return titles[model.page] || model.title || 'Lecture';
}

function getStaffUtilityOverviewText(model, kpis) {
  const first = kpis[0] || [];
  const second = kpis[1] || [];
  const third = kpis[2] || [];
  const fourth = kpis[3] || [];
  const texts = {
    sessions: `Priorité aux lignes ouvertes : ${first[1] || 0} en cours, ${second[1] || 0} non clôturées.`,
    arrivals: `Le staff voit directement qui arrive, qui est déjà sur place et ce qu'il reste à encaisser.`,
    events: `Anniversaires, écoles, entreprises et formules restent visibles sans transformer la page en mur de cartes.`,
    groups: `${first[1] || 0} profils actifs, ${second[1] || 0} joueurs cumulés et ${fourth[1] || '0€'} d'historique groupe.`,
    contacts: `Une lecture propre pour retrouver les fiches, compléter les coordonnées et relancer sans bruit.`,
    lanes: `Les pistes, la maintenance et les réservations bowling sont regroupées autour de l'action terrain.`,
    laserGame: `Les lancements, passages et capacités restent séparés du bowling pour éviter les mauvaises lectures.`,
    establishment: `Configuration centre, ressources et horaires dans une lecture courte pour la direction.`,
    users: `Rôles, membres et codes d'accès restent contrôlés sans mélanger les permissions avec le planning.`,
    settings: `Préférences locales, exports et outils de maintenance du poste staff.`,
  };
  return texts[model.page] || `${first[0] || 'Signal'}: ${first[1] || 0}. ${third[0] || 'Suivi'}: ${third[1] || 0}.`;
}

function renderStaffUtilityOverview(model) {
  const kpis = Array.isArray(model.kpis) ? model.kpis.filter(Boolean) : [];
  if (!kpis.length) return '';
  const [primary, ...rest] = kpis;
  const secondary = rest.slice(0, 3);
  const headline = getStaffUtilityOverviewTitle(model);
  const narrative = getStaffUtilityOverviewText(model, kpis);
  const statusLabel = model.page === 'groups' ? 'Suivi groupe'
    : model.page === 'laserGame' ? 'Laser'
      : model.page === 'users' ? 'Accès'
        : model.eyebrow || 'Lecture';

  return `<section class="utility-overview utility-overview-${escapeHtml(model.page || 'default')}">
    <div class="utility-overview-main">
      <div class="utility-overview-kicker">${escapeHtml(statusLabel)}</div>
      <div class="utility-overview-value-row">
        <strong>${escapeHtml(String(primary[1] ?? 0))}</strong>
        <span>${escapeHtml(primary[0] || headline)}</span>
      </div>
      <p>${escapeHtml(narrative)}</p>
    </div>
    <div class="utility-overview-signals">
      ${secondary.map(item => `<div class="utility-overview-signal">
        <span>${escapeHtml(item[0] || '')}</span>
        <strong>${escapeHtml(String(item[1] ?? ''))}</strong>
        <small>${escapeHtml(item[2] || '')}</small>
      </div>`).join('')}
    </div>
  </section>`;
}

function renderStaffUtilityAction(label, action, variant = '') {
  if (!action) return '';
  return `<button type="button" class="utility-action ${escapeHtml(variant)}" onclick="${action}">${escapeHtml(label)}</button>`;
}

function getStaffUtilityStartLabel(reservation) {
  const start = getReservationFirstResourceStart(reservation, 'all');
  return start ? formatClockDisplay(start) : formatClockDisplay(timeToNum(reservation.startTime || '00:00'));
}

function getStaffUtilityRiskLabel(reservation) {
  const pax = Number(reservation.pax || 0);
  const laserCount = getLaserWindowsFromReservation(reservation).length;
  const bowlingCount = getBowlingWindowsFromReservation(reservation).length;
  if (reservation.type === 'formule' || reservation.formuleId) return 'Formule à suivre';
  if (laserCount > 1) return `${laserCount} passages laser`;
  if (pax >= 16) return 'Grand groupe';
  if (bowlingCount > 1) return 'Multi-pistes';
  return getStaffReservationStatusLabel(reservation.status);
}

function getStaffUtilityTypeLabel(reservation) {
  const type = getStaffReservationActivityType(reservation);
  if (type === 'laser') return 'Laser Game';
  if (type === 'complete') return 'Complet';
  if (reservation.type === 'formule' || reservation.formuleId) return 'Formule';
  return 'Bowling';
}

function renderStaffUtilityReservationCard(reservation, options = {}) {
  const id = staffClientJs(reservation.id);
  const type = getStaffReservationActivityType(reservation);
  const status = reservation.status || 'pending';
  const windows = getStaffResourceWindows(reservation, 'all');
  const firstWindow = windows[0] || null;
  const windowLabel = firstWindow ? `${formatClockDisplay(firstWindow.start)}-${formatClockDisplay(firstWindow.end)}` : getStaffUtilityStartLabel(reservation);
  const actionSet = options.actions || ['detail', 'arrived', 'paid'];
  const actions = actionSet.map(action => {
    if (action === 'detail') return renderStaffUtilityAction('Détail', `openStaffReservationDetail(${id})`);
    if (action === 'arrived') return renderStaffUtilityAction('Arrivé', `setReservationStatusDirect(${id}, 'arrived', event)`, status === 'arrived' ? 'is-active' : '');
    if (action === 'paid') return renderStaffUtilityAction('Payé', `setReservationStatusDirect(${id}, 'paid', event)`, status === 'paid' ? 'is-active success' : '');
    if (action === 'cancel') return renderStaffUtilityAction('Annuler', `cancelRes(${id}, event)`, 'danger');
    return '';
  }).join('');
  const compact = options.compact ? 'compact' : '';

  return `<article class="utility-res-card ${escapeHtml(type)} ${escapeHtml(status)} ${compact}">
    <div class="utility-res-time">
      <strong>${escapeHtml(getStaffUtilityStartLabel(reservation))}</strong>
      <span>${escapeHtml(getStaffUtilityTypeLabel(reservation))}</span>
    </div>
    <div class="utility-res-main">
      <div class="utility-res-title">
        <strong>${escapeHtml(reservation.name || 'Client')}</strong>
        ${getReservationOccasion(reservation) ? `<span class="res-occasion-tag res-occasion-${escapeHtml(getReservationOccasion(reservation))}">${escapeHtml(getReservationOccasionLabel(reservation))}</span>` : ''}
        <span>${escapeHtml(getStaffUtilityRiskLabel(reservation))}</span>
      </div>
      <p>${escapeHtml(getReservationLabel(reservation))}</p>
      <small>${escapeHtml(getStaffUtilityResourceSummary(reservation))}</small>
      ${hasReservationNote(reservation) ? `<small class="res-special-request"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3v5h5"/><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M9 13h6M9 17h4"/></svg>${escapeHtml(getReservationNoteText(reservation))}</small>` : ''}
    </div>
    <div class="utility-res-meta">
      <span>${Number(reservation.pax || 0)} pers.</span>
      <span>${escapeHtml(windowLabel)}</span>
      <b class="${escapeHtml(status)}">${escapeHtml(getStaffReservationStatusLabel(status))}</b>
    </div>
    <div class="utility-res-actions">${actions}</div>
  </article>`;
}

function getStaffUtilityResourceSummary(reservation) {
  const windows = getStaffResourceWindows(reservation, 'all');
  if (!windows.length) return getReservationLabel(reservation);
  return windows.map(window => {
    if (window.resourceType === 'laser_arena') {
      return `Laser ${formatClockDisplay(window.start)}-${formatClockDisplay(window.end)}`;
    }
    const lanes = (window.lanes || reservation.lanes || []).length ? `piste ${(window.lanes || reservation.lanes || []).join(', ')}` : 'piste auto';
    return `${lanes} ${formatClockDisplay(window.start)}-${formatClockDisplay(window.end)}`;
  }).join(' · ');
}

function renderStaffUtilityReservationList(rows = [], emptyTitle = 'Aucune donnée', emptyDetail = 'Cette catégorie ne contient aucune ligne sur la date affichée.', options = {}) {
  if (!rows.length) {
    return `<div class="utility-empty">
      <strong>${escapeHtml(emptyTitle)}</strong>
      <span>${escapeHtml(emptyDetail)}</span>
    </div>`;
  }
  return `<div class="utility-res-stack ${escapeHtml(options.variant || '')}">
    ${rows.map(reservation => renderStaffUtilityReservationCard(reservation, options.card || {})).join('')}
  </div>`;
}

function renderStaffUtilityClientList(rows = [], emptyTitle = 'Aucun client', emptyDetail = 'Aucun profil réel ne correspond à cette catégorie.') {
  if (!rows.length) {
    return `<div class="utility-empty"><strong>${escapeHtml(emptyTitle)}</strong><span>${escapeHtml(emptyDetail)}</span></div>`;
  }
  return `<div class="utility-contact-ledger">
    ${rows.slice(0, 18).map(row => `<article class="utility-contact-row">
      <span class="utility-avatar">${escapeHtml(row.initials || 'CL')}</span>
      <div class="utility-main"><strong>${escapeHtml(row.name)}</strong><em>${escapeHtml(row.email || row.phone || 'Contact incomplet')}</em></div>
      <div class="utility-resource">${escapeHtml(row.tags.join(' · ') || 'Client')}</div>
      <div class="utility-contact-stats"><span>${Number(row.reservations || 0)} rés.</span><strong>${formatMoney(row.spent || 0)}</strong></div>
      <div class="utility-res-actions">
        ${renderStaffUtilityAction('Fiche', `openStaffMenuPage('clients'); selectStaffClient('${escapeJsString(row.id)}')`)}
        ${renderStaffUtilityAction('Réserver', `openStaffClientBooking('${escapeJsString(row.id)}')`, 'success')}
      </div>
    </article>`).join('')}
  </div>`;
}

function renderStaffUtilityRushBoard({ activeRows = [], nextRows = [], closingRows = [] }) {
  const column = (title, detail, rows, empty) => `<section class="utility-rush-column">
    <div class="utility-section-head"><strong>${escapeHtml(title)}</strong> <span>${escapeHtml(detail)}</span></div>
    ${rows.length ? rows.map(reservation => renderStaffUtilityReservationCard(reservation, { compact: true })).join('') : `<div class="utility-mini-empty">${escapeHtml(empty)}</div>`}
  </section>`;
  return `<div class="utility-rush-board">
    ${column('Maintenant', 'Ce qui se joue en salle', activeRows, 'Aucune session active.')}
    ${column('Prochain départ', 'À préparer avant l’arrivée', nextRows, 'Rien à préparer.')}
    ${column('À clôturer', 'Paiement, statut ou suivi', closingRows, 'Aucune clôture en attente.')}
  </div>`;
}

function renderStaffUtilityArrivalDesk(rows = []) {
  const now = currentTimeDecimal();
  const sorted = [...rows].sort((left, right) => getReservationFirstResourceStart(left, 'all') - getReservationFirstResourceStart(right, 'all'));
  const urgent = sorted.filter(row => getReservationFirstResourceStart(row, 'all') <= now + 0.5 && row.status !== 'paid');
  return `<div class="utility-arrival-desk">
    <section class="utility-arrival-main">
      <div class="utility-section-head"><strong>File d’accueil</strong> <span>${sorted.length} réservation${sorted.length > 1 ? 's' : ''} à suivre</span></div>
      ${sorted.length ? sorted.map(reservation => renderStaffUtilityReservationCard(reservation)).join('') : `<div class="utility-mini-empty">Toutes les arrivées sont traitées.</div>`}
    </section>
    <aside class="utility-arrival-side">
      <strong>Priorité terrain</strong>
      <span>${urgent.length ? `${urgent.length} groupe${urgent.length > 1 ? 's' : ''} proche${urgent.length > 1 ? 's' : ''} de l’heure` : 'Aucun groupe en urgence'}</span>
      <ul>
        <li>Confirmer présence et nombre de joueurs.</li>
        <li>Prévenir si Laser Game peut être partagé.</li>
        <li>Encaisser ou marquer payé dès que c’est fait.</li>
      </ul>
      ${renderStaffUtilityAction('Créer une arrivée', "openQuickBook({ date: state.currentDate, type: 'bowling' })", 'success')}
    </aside>
  </div>`;
}

function getStaffGroupReservations(row = {}) {
  return (row?.history || [])
    .map(item => item?.reservation)
    .filter(Boolean)
    .sort((left, right) => {
      const leftKey = `${left.date || ''} ${left.startTime || '00:00'}`;
      const rightKey = `${right.date || ''} ${right.startTime || '00:00'}`;
      return leftKey.localeCompare(rightKey);
    });
}

// « Aujourd'hui RÉEL » : la page Groupes est ancrée à la date réelle, jamais à la
// date affichée (state.currentDate). Naviguer dans le calendrier ne change PAS
// l'à-venir des groupes (distinction nette avec Terrain, qui est le jour affiché).
function staffGroupToday() {
  return todayStr();
}

function getStaffGroupNextReservation(row = {}) {
  const reservations = getStaffGroupReservations(row).filter(reservation => reservation.status !== 'cancelled');
  const today = staffGroupToday();
  // Prochaine visite = la 1re résa FUTURE (>= aujourd'hui réel). Plus de repli sur
  // la dernière résa passée (bug « prochaine visite » affichant du passé).
  return reservations.find(reservation => String(reservation.date || '') >= today) || null;
}

// Libellés d'occasion DÉCLARÉE (source de vérité de la catégorisation staff).
const STAFF_OCCASION_LABELS = {
  anniversaire: 'Anniversaire',
  entreprise: 'Entreprise / team building',
  groupe: 'Sortie groupe',
  ecole: 'École / jeunesse',
  evg: 'EVG / EVJF',
  // Anciennes valeurs conservées pour l'affichage des réservations historiques.
  amis: 'Entre amis',
  famille: 'Sortie famille',
  autre: 'Autre',
};

function getReservationOccasion(reservation = {}) {
  const raw = String(reservation.occasion || '').toLowerCase();
  return STAFF_OCCASION_LABELS[raw] ? raw : '';
}

function getReservationOccasionLabel(reservation = {}) {
  const occ = getReservationOccasion(reservation);
  return occ ? STAFF_OCCASION_LABELS[occ] : '';
}

// Catégorie staff d'un profil groupe à partir de l'occasion DÉCLARÉE. Renvoie
// '' si aucune occasion n'a été déclarée → on retombe alors sur l'heuristique.
function getStaffGroupDeclaredCategory(row = {}) {
  const occ = String(row.declaredOccasion || '').toLowerCase();
  if (occ === 'anniversaire') return 'birthday';
  if (occ === 'entreprise') return 'business';
  if (occ === 'ecole') return 'school';
  if (occ === 'amis') return 'regular';
  if (occ === 'autre') return 'other';
  return '';
}

function getStaffGroupKind(row = {}) {
  // 1) Occasion DÉCLARÉE par le client (prioritaire, plus d'heuristique devinée).
  const declared = String(row.declaredOccasion || '').toLowerCase();
  if (declared === 'anniversaire') return 'Anniversaire';
  if (declared === 'entreprise') return 'Entreprise';
  if (declared === 'ecole') return 'École / association';
  if (declared === 'amis') return 'Groupe';
  // 2) Repli heuristique (anciennes résas sans occasion déclarée).
  if (row.hasBirthday) return 'Anniversaire';
  if (Number(row.formulas || 0) > 0) return 'Formule';
  if (Number(row.players || 0) >= 30 || Number(row.reservations || 0) >= 3) return 'Groupe regulier';
  return 'Groupe';
}

function formatStaffGroupReservationDate(reservation) {
  if (!reservation?.date) return 'Date inconnue';
  return parseLocalDate(reservation.date)
    .toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric', month: 'short' })
    .replace('.', '');
}

function getStaffGroupAgenda(rows = []) {
  const today = staffGroupToday();
  return rows
    .flatMap(row => getStaffGroupReservations(row).map(reservation => ({ row, reservation })))
    .filter(item => item.reservation.status !== 'cancelled' && String(item.reservation.date || '') >= today)
    .sort((left, right) => {
      const leftKey = `${left.reservation.date || ''} ${left.reservation.startTime || '00:00'}`;
      const rightKey = `${right.reservation.date || ''} ${right.reservation.startTime || '00:00'}`;
      return leftKey.localeCompare(rightKey);
    });
}

function setStaffGroupFilter(key, value) {
  const allowed = {
    type: ['all', 'bowling', 'laser', 'complete', 'formule'],
    status: ['all', 'pending', 'confirmed', 'arrived', 'paid'],
    date: ['upcoming', 'today', 'week', 'all'],
    size: ['all', 'small', 'medium', 'large', 'xl'],
    tab: ['all', 'birthdays', 'regular', 'business', 'followup']
  };
  if (key === 'query') {
    state.staffGroupQuery = value || '';
  } else if (allowed[key]) {
    state[`staffGroup${key.charAt(0).toUpperCase()}${key.slice(1)}`] = allowed[key].includes(value) ? value : 'all';
  }
  save();
  renderStaffUtilityPage();
}

let staffGroupQueryTimer = null;
function setStaffGroupQuery(value) {
  state.staffGroupQuery = value || '';
  clearTimeout(staffGroupQueryTimer);
  staffGroupQueryTimer = setTimeout(() => {
    save();
    renderStaffGroupHost();
  }, 90);
}

function resetStaffGroupFilters() {
  state.staffGroupQuery = '';
  state.staffGroupType = 'all';
  state.staffGroupStatus = 'all';
  state.staffGroupDate = 'upcoming';
  state.staffGroupSize = 'all';
  state.staffGroupTab = 'all';
  save();
  renderStaffUtilityPage();
}

function getStaffGroupActivityKey(row = {}, reservation = null) {
  const current = reservation || getStaffGroupNextReservation(row) || row.lastBooking || {};
  const activity = getStaffReservationActivityType(current);
  if (current.type === 'formule' || current.formuleId || Number(row.formulas || 0) > 0) return 'formule';
  if (activity === 'complete') return 'complete';
  if (activity === 'laser' || current.type === 'laser') return 'laser';
  return 'bowling';
}

function getStaffGroupActivityLabel(key = 'bowling', reservation = null) {
  if (key === 'laser') return 'Laser Game';
  if (key === 'complete') return 'Complet';
  if (key === 'formule') return reservation?.formuleId || reservation?.type === 'formule' ? getReservationLabel(reservation) : 'Formule';
  return 'Bowling';
}

function getStaffGroupStatusKey(reservation = {}) {
  return ['pending', 'confirmed', 'arrived', 'paid'].includes(reservation.status) ? reservation.status : 'confirmed';
}

// Classification client/groupe SERVIE PAR LE CENTRE (staff-state) : seuils
// groupe + formules anniversaire éditables côté Établissement. Défauts alignés
// sur le serveur (lib/center-config.js DEFAULT_CLASSIFICATION) tant que le poll
// n'a rien renvoyé.
const DEFAULT_STAFF_CLASSIFICATION = {
  groupMinPax: 10,
  groupMinCumulative: 18,
  countFormulaAsGroup: true,
  sizeTiers: { medium: 12, large: 30, xl: 60 },
  birthdayFromFormula: true,
  birthdayFormulaIds: ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8'],
  // 0 = seuil automatique (top 20 % des depensiers). Reglable depuis
  // Etablissement > Clients & groupes.
  keyClientMinSpend: 0,
};

function getStaffClassification() {
  const c = state.staffClassification;
  if (!c || typeof c !== 'object') return DEFAULT_STAFF_CLASSIFICATION;
  const tiers = (c.sizeTiers && typeof c.sizeTiers === 'object') ? c.sizeTiers : DEFAULT_STAFF_CLASSIFICATION.sizeTiers;
  return {
    groupMinPax: Number(c.groupMinPax) || DEFAULT_STAFF_CLASSIFICATION.groupMinPax,
    groupMinCumulative: Number(c.groupMinCumulative) || DEFAULT_STAFF_CLASSIFICATION.groupMinCumulative,
    countFormulaAsGroup: c.countFormulaAsGroup !== false,
    sizeTiers: {
      medium: Number(tiers.medium) || DEFAULT_STAFF_CLASSIFICATION.sizeTiers.medium,
      large: Number(tiers.large) || DEFAULT_STAFF_CLASSIFICATION.sizeTiers.large,
      xl: Number(tiers.xl) || DEFAULT_STAFF_CLASSIFICATION.sizeTiers.xl,
    },
    birthdayFromFormula: c.birthdayFromFormula !== false,
    birthdayFormulaIds: Array.isArray(c.birthdayFormulaIds) ? c.birthdayFormulaIds : DEFAULT_STAFF_CLASSIFICATION.birthdayFormulaIds,
    keyClientMinSpend: Math.max(0, Number(c.keyClientMinSpend) || 0),
  };
}

// Une réservation compte-t-elle comme « anniversaire » via sa formule ?
function isStaffBirthdayFormulaReservation(reservation, classification = getStaffClassification()) {
  if (!classification.birthdayFromFormula) return false;
  const formulaId = reservation && (reservation.formuleId || reservation.formulaId);
  return Boolean(formulaId) && classification.birthdayFormulaIds.includes(formulaId);
}

function getStaffGroupSizeKey(row = {}, reservation = null) {
  const pax = Number(reservation?.pax || row.maxPax || row.players || 0);
  const tiers = getStaffClassification().sizeTiers;
  if (pax >= tiers.xl) return 'xl';
  if (pax >= tiers.large) return 'large';
  if (pax >= tiers.medium) return 'medium';
  return 'small';
}

function isStaffGroupBusiness(row = {}) {
  // Occasion DÉCLARÉE prioritaire : si le client a déclaré quelque chose, on ne
  // devine plus. Sinon (ancienne résa), repli sur l'heuristique de mots-clés.
  const declared = getStaffGroupDeclaredCategory(row);
  if (declared) return declared === 'business';
  const text = formulaActivityToken(`${row.name || ''} ${(row.tags || []).join(' ')}`);
  return /entreprise|team|garage|sa|ecole|college|association|club|comite|bureau/.test(text);
}

function needsStaffGroupFollowup(row = {}, reservation = null) {
  const current = reservation || getStaffGroupNextReservation(row) || {};
  if (!row.phone || !row.email) return true;
  if (row.hasBirthday) return true;
  if (Number(row.formulas || 0) > 0) return true;
  if (!current.id || current.status === 'pending') return true;
  return false;
}

function getStaffGroupFollowupReason(row = {}, reservation = null) {
  const current = reservation || getStaffGroupNextReservation(row) || {};
  if (!row.phone || !row.email) return { label: 'Coordonnees incompletes', action: 'Completer' };
  if (row.hasBirthday) return { label: 'Anniversaire a confirmer', action: 'Relancer' };
  if (Number(row.formulas || 0) > 0) return { label: 'Formule a preparer', action: 'Preparer' };
  if (!current.id) return { label: 'Aucune prochaine visite', action: 'Planifier' };
  return { label: 'Suivi commercial', action: 'Relancer' };
}

function getFilteredStaffGroupRows(rows = []) {
  const query = String(state.staffGroupQuery || '').trim().toLowerCase();
  const type = state.staffGroupType || 'all';
  const status = state.staffGroupStatus || 'all';
  const dateFilter = state.staffGroupDate || 'upcoming';
  const size = state.staffGroupSize || 'all';
  const tab = state.staffGroupTab || 'all';
  const today = todayStr();
  const weekEnd = addDays(today, 7);
  return rows.filter(row => {
    const reservation = getStaffGroupNextReservation(row) || {};
    const activity = getStaffGroupActivityKey(row, reservation);
    const text = `${row.name || ''} ${row.email || ''} ${row.phone || ''} ${(row.tags || []).join(' ')} ${getStaffGroupKind(row)} ${getReservationLabel(reservation) || ''}`.toLowerCase();
    if (query && !text.includes(query)) return false;
    if (type !== 'all' && activity !== type) return false;
    if (status !== 'all' && getStaffGroupStatusKey(reservation) !== status) return false;
    if (size !== 'all' && getStaffGroupSizeKey(row, reservation) !== size) return false;
    if (dateFilter === 'upcoming' && reservation.date && String(reservation.date) < today) return false;
    if (dateFilter === 'today' && reservation.date !== today) return false;
    if (dateFilter === 'week' && (!reservation.date || String(reservation.date) < today || String(reservation.date) > weekEnd)) return false;
    if (tab === 'birthdays' && !row.hasBirthday) return false;
    if (tab === 'regular' && getStaffGroupDeclaredCategory(row) !== 'regular' && Number(row.reservations || 0) < 2) return false;
    if (tab === 'business' && !isStaffGroupBusiness(row)) return false;
    if (tab === 'followup' && (!needsStaffGroupFollowup(row, reservation) || isStaffGroupActionDismissed(row, reservation))) return false;
    return true;
  });
}

function renderStaffGroupStatusBadge(reservation = {}) {
  const status = getStaffGroupStatusKey(reservation);
  const labels = {
    pending: 'En attente',
    confirmed: 'Reservation confirmee',
    arrived: 'Arrive',
    paid: 'Paye'
  };
  return `<span class="groups-status groups-status-${escapeHtml(status)}">${escapeHtml(labels[status] || 'Confirme')}</span>`;
}

function renderStaffGroupTypeBadge(key = 'bowling', label = '') {
  const cleanKey = ['bowling', 'laser', 'complete', 'formule'].includes(key) ? key : 'bowling';
  return `<span class="groups-type groups-type-${escapeHtml(cleanKey)}">${escapeHtml(label || getStaffGroupActivityLabel(cleanKey))}</span>`;
}

function getStaffGroupProfileAction(row = {}, action = 'client') {
  if (!row.id) return 'toast("Profil indisponible.")';
  if (action === 'book') return `openStaffClientBooking(${staffClientJs(row.id)})`;
  return `openStaffMenuPage('clients'); selectStaffClient(${staffClientJs(row.id)})`;
}

function getStaffGroupContactAction(row = {}) {
  if (row.email) return `composeStaffClientEmail(${staffClientJs(row.email)}, ${staffClientJs(row.name || '')})`;
  if (row.phone) return `window.location.href=${staffClientJs(`tel:${row.phone}`)}`;
  return getStaffGroupProfileAction(row, 'client');
}

function getStaffGroupReservationAction(reservation = {}, row = {}) {
  if (reservation.id) return `openStaffReservationDetail(${staffClientJs(reservation.id)})`;
  return getStaffGroupProfileAction(row, 'client');
}

function renderStaffGroupActionButton(label, action, variant = '') {
  return `<button type="button" class="groups-action ${escapeHtml(variant)}" onclick="${action}">${escapeHtml(label)}</button>`;
}

function renderStaffGroupToolbar(allRows = [], filteredRows = [], agenda = [], followUps = []) {
  const query = escapeHtml(state.staffGroupQuery || '');
  const select = (key, label, options) => `<label class="groups-select"><span>${escapeHtml(label)}</span><select onchange="setStaffGroupFilter('${escapeHtml(key)}', this.value)">
    ${options.map(option => `<option value="${escapeHtml(option.value)}" ${state[`staffGroup${key.charAt(0).toUpperCase()}${key.slice(1)}`] === option.value ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
  </select></label>`;
  const tab = (id, label, count) => `<button type="button" class="${state.staffGroupTab === id ? 'active' : ''}" onclick="setStaffGroupFilter('tab', '${escapeHtml(id)}')">${escapeHtml(label)}<span>${Number(count || 0)}</span></button>`;
  const birthdays = allRows.filter(row => row.hasBirthday).length;
  const regular = allRows.filter(row => getStaffGroupDeclaredCategory(row) === 'regular' || Number(row.reservations || 0) >= 2).length;
  const business = allRows.filter(isStaffGroupBusiness).length;
  return `<section class="groups-toolbar-card">
    <div class="groups-toolbar-main">
      <label class="groups-search">${renderStaffClientIcon('search')}<input value="${query}" placeholder="Rechercher un groupe, contact, entreprise..." oninput="setStaffGroupQuery(this.value)"></label>
      ${select('type', 'Type', [
        { value: 'all', label: 'Tous types' },
        { value: 'bowling', label: 'Bowling' },
        { value: 'laser', label: 'Laser Game' },
        { value: 'complete', label: 'Complet' },
        { value: 'formule', label: 'Formules' }
      ])}
      ${select('status', 'Statut', [
        { value: 'all', label: 'Tous statuts' },
        { value: 'confirmed', label: 'Confirmes' },
        { value: 'arrived', label: 'Arrives' },
        { value: 'paid', label: 'Payes' },
        { value: 'pending', label: 'En attente' }
      ])}
      ${select('date', 'Date', [
        { value: 'upcoming', label: 'A venir' },
        { value: 'today', label: 'Aujourd hui' },
        { value: 'week', label: '7 jours' },
        { value: 'all', label: 'Tout' }
      ])}
      ${select('size', 'Taille', [
        { value: 'all', label: 'Toutes tailles' },
        { value: 'small', label: '1-11 pers.' },
        { value: 'medium', label: '12-29 pers.' },
        { value: 'large', label: '30-59 pers.' },
        { value: 'xl', label: '60+ pers.' }
      ])}
    </div>
    <div class="groups-tabs">
      ${tab('all', 'Tous', allRows.length)}
      ${tab('birthdays', 'Anniversaires', birthdays)}
      ${tab('regular', 'Groupes reguliers', regular)}
      ${tab('business', 'Entreprises', business)}
      ${tab('followup', 'A relancer', followUps.length)}
    </div>
    <div class="groups-metrics-strip">
      <span>${renderStaffClientIcon('users')}<strong>${filteredRows.length}</strong> profils</span>
      <span>${renderStaffClientIcon('user')}<strong>${filteredRows.reduce((sum, row) => sum + Number(row.players || 0), 0)}</strong> joueurs cumules</span>
      <span>${renderStaffClientIcon('clock')}<strong>${agenda.length}</strong> passages a venir</span>
      <span>${renderStaffClientIcon('refresh')}<strong>${followUps.length}</strong> relances utiles</span>
    </div>
  </section>`;
}

function renderStaffGroupSelected(item = {}) {
  const row = item.row || {};
  const reservation = item.reservation || getStaffGroupNextReservation(row) || {};
  const activityKey = getStaffGroupActivityKey(row, reservation);
  const hasReservation = !!reservation.id;
  const reservationDate = reservation.date ? `${formatStaffGroupReservationDate(reservation)} · ${getStaffUtilityStartLabel(reservation)}` : 'À planifier';
  const pax = Number(reservation.pax || row.maxPax || row.players || 0);
  const players = Number(row.players || pax || 0);
  const value = Number(row.spent || reservation.price || 0);
  const phone = row.phone || '';
  const email = row.email || '';
  const contactChips = [
    phone ? `<a class="groups-contact-chip" href="tel:${escapeHtml(phone)}">${renderStaffClientIcon('phone')}<span>${escapeHtml(phone)}</span></a>` : '',
    email ? `<a class="groups-contact-chip" href="mailto:${escapeHtml(email)}" title="${escapeHtml(email)}">${renderStaffClientIcon('mail')}<span class="groups-contact-email">${escapeHtml(email)}</span></a>` : ''
  ].filter(Boolean).join('');
  return `<section class="groups-selected-card">
    <div class="groups-selected-header">
      <span class="groups-avatar">${escapeHtml(row.initials || getStaffClientInitials(row.name || 'Groupe'))}</span>
      <div class="groups-selected-ident">
        <div class="groups-selected-title">
          <h2>${escapeHtml(row.name || reservation.name || 'Groupe')}</h2>
          ${renderStaffGroupStatusBadge(reservation)}
          ${renderStaffGroupTypeBadge(activityKey, getStaffGroupActivityLabel(activityKey, reservation))}
        </div>
        <p>${escapeHtml(getStaffGroupKind(row))} · ${players} joueur(s) cumulés</p>
      </div>
    </div>
    <div class="groups-selected-grid">
      <div><span>Prochaine visite</span><strong>${escapeHtml(reservationDate)}</strong></div>
      <div><span>Taille du groupe</span><strong class="num">${escapeHtml(pax ? `${pax} pers.` : `${players} cumulés`)}</strong></div>
      <div><span>Valeur ${hasReservation ? 'réservation' : 'potentielle'}</span><strong class="num">${formatMoney(value)}</strong></div>
    </div>
    <div class="groups-selected-contact">
      ${contactChips || `<span class="groups-contact-empty">Coordonnées à compléter</span>`}
    </div>
    <div class="groups-selected-actions">
      ${hasReservation
        ? renderStaffGroupActionButton('Voir la réservation', `openStaffReservationDetail(${staffClientJs(reservation.id)})`, 'primary')
        : renderStaffGroupActionButton('Planifier une visite', getStaffGroupProfileAction(row, 'book'), 'primary')}
      ${renderStaffGroupActionButton('Fiche client', getStaffGroupProfileAction(row, 'client'))}
    </div>
  </section>`;
}

function renderStaffGroupAgendaPanel(agenda = []) {
  const rows = agenda.slice(0, 5);
  return `<section class="groups-side-card">
    <div class="groups-side-head"><h3>Agenda groupes</h3><button type="button" onclick="setStaffGroupFilter('date', 'all')">Voir tout</button></div>
    <div class="groups-agenda-list">
      ${rows.length ? rows.map(({ row, reservation }) => {
        const activity = getStaffGroupActivityKey(row, reservation);
        return `<button type="button" class="groups-agenda-item" onclick="${getStaffGroupReservationAction(reservation, row)}">
          <span>${escapeHtml(reservation.date ? formatStaffGroupReservationDate(reservation) : '--')}</span>
          <strong>${escapeHtml(getStaffUtilityStartLabel(reservation))}</strong>
          <em>${escapeHtml(row.name || reservation.name || 'Groupe')}</em>
          ${renderStaffGroupTypeBadge(activity, getStaffGroupActivityLabel(activity, reservation))}
          <small>${Number(reservation.pax || row.maxPax || 0)} pers.</small>
        </button>`;
      }).join('') : `<div class="groups-empty-note">Aucun passage groupe a venir.</div>`}
    </div>
  </section>`;
}

// Une action « traitée » disparaît (persisté) : elle réapparaît uniquement si
// la donnée régénère une raison différente pour le même profil.
// Clé d'action groupe SCOPÉE PAR CENTRE : traiter l'action d'un client à
// Libramont ne doit pas la masquer pour le même client (même tél) à Gembloux.
function staffGroupCenterScope() {
  return (typeof getCurrentStaffCenterId === 'function' && getCurrentStaffCenterId())
    || state.adminCenterId || 'libramont';
}

function getStaffGroupActionKey(row, reason) {
  return `${staffGroupCenterScope()}|${row.key || row.id || row.name}|${reason.label}`;
}

// Une action traitée disparaît PARTOUT (panneau, compteurs, onglet « A relancer »).
function isStaffGroupActionDismissed(row, reservation) {
  const dismissed = state.dismissedGroupActions || [];
  if (!dismissed.length) return false;
  const reason = getStaffGroupFollowupReason(row, reservation);
  return dismissed.includes(getStaffGroupActionKey(row, reason));
}

function dismissStaffGroupAction(key, ev) {
  if (ev) ev.stopPropagation();
  state.dismissedGroupActions = state.dismissedGroupActions || [];
  if (!state.dismissedGroupActions.includes(key)) state.dismissedGroupActions.push(key);
  if (state.dismissedGroupActions.length > 200) state.dismissedGroupActions = state.dismissedGroupActions.slice(-100);
  save();
  renderStaff();
  toast('Action marquée comme traitée.');
}

function renderStaffGroupActionsPanel(followUps = []) {
  const dismissed = state.dismissedGroupActions || [];
  const rows = followUps
    .filter(({ row, reservation }) => !dismissed.includes(getStaffGroupActionKey(row, getStaffGroupFollowupReason(row, reservation))))
    .slice(0, 4);
  return `<section class="groups-side-card">
    <div class="groups-side-head"><h3>Actions recommandees</h3><button type="button" onclick="setStaffGroupFilter('tab', 'followup')">Voir tout</button></div>
    <div class="groups-action-list">
      ${rows.length ? rows.map(({ row, reservation }) => {
        const reason = getStaffGroupFollowupReason(row, reservation);
        const activity = getStaffGroupActivityKey(row, reservation);
        // Chaque action ouvre le bon outil : Relancer = email prérempli,
        // Préparer = la réservation, Compléter = la fiche, Planifier = résa.
        const actionCall = reason.action === 'Relancer'
          ? getStaffGroupContactAction(row)
          : reason.action === 'Preparer' && reservation?.id
            ? `openStaffReservationDetail(${staffClientJs(reservation.id)})`
            : getStaffGroupProfileAction(row, reason.action === 'Planifier' ? 'book' : 'client');
        return `<article class="groups-action-item">
          <span class="groups-action-icon groups-action-${escapeHtml(activity)}">${renderStaffClientIcon(activity === 'laser' ? 'clock' : activity === 'formule' ? 'star' : 'users')}</span>
          <div><strong>${escapeHtml(reason.label)}</strong><small>${escapeHtml(row.name || 'Groupe')} · ${escapeHtml(reservation?.date ? formatStaffGroupReservationDate(reservation) : 'sans date')}</small></div>
          <button type="button" onclick="${actionCall}">${escapeHtml(reason.action)}</button>
          <button type="button" class="groups-action-dismiss" title="Marquer comme traité" aria-label="Marquer ${escapeHtml(reason.label)} comme traité" onclick="dismissStaffGroupAction(${staffClientJs(getStaffGroupActionKey(row, reason))}, event)">✕</button>
        </article>`;
      }).join('') : `<div class="groups-empty-note">Aucune relance prioritaire.</div>`}
    </div>
  </section>`;
}

function renderStaffGroupTable(rows = []) {
  return `<section class="groups-ledger-card">
    <div class="groups-ledger-head">
      <div><h3>Profils exploitables</h3><p>${rows.length} resultat${rows.length > 1 ? 's' : ''}</p></div>
      <button type="button" onclick="resetStaffGroupFilters()">Réinitialiser</button>
    </div>
    <div class="groups-ledger">
      <div class="groups-ledger-row groups-ledger-row-head"><span>Profil</span><span>Prochaine visite</span><span>Activite</span><span>Taille</span><span>Statut</span><span>Valeur</span><span>Actions</span></div>
      ${rows.length ? rows.slice(0, 12).map(row => {
        const reservation = getStaffGroupNextReservation(row) || {};
        const activity = getStaffGroupActivityKey(row, reservation);
        const date = reservation.date ? `${formatStaffGroupReservationDate(reservation)} ${getStaffUtilityStartLabel(reservation)}` : 'A planifier';
        return `<article class="groups-ledger-row">
          <div class="groups-profile-cell"><span class="groups-avatar small">${escapeHtml(row.initials || getStaffClientInitials(row.name || 'Groupe'))}</span><div><strong>${escapeHtml(row.name || 'Groupe')}</strong><small>${escapeHtml(row.phone || row.email || 'Coordonnees a completer')}</small></div></div>
          <span class="groups-date-cell">${escapeHtml(date)}</span>
          <span>${renderStaffGroupTypeBadge(activity, getStaffGroupActivityLabel(activity, reservation))}</span>
          <span>${Number(reservation.pax || row.maxPax || row.players || 0)} pers.</span>
          <span>${renderStaffGroupStatusBadge(reservation)}</span>
          <strong>${formatMoney(row.spent || reservation.price || 0)}</strong>
          <span class="groups-row-actions">
            <button type="button" onclick="${getStaffGroupProfileAction(row, 'client')}" aria-label="Voir ${escapeHtml(row.name || 'groupe')}">${renderStaffClientIcon('user')}</button>
            <button type="button" onclick="${getStaffGroupContactAction(row)}" aria-label="Contacter ${escapeHtml(row.name || 'groupe')}">${renderStaffClientIcon('mail')}</button>
            <button type="button" onclick="${getStaffGroupReservationAction(reservation, row)}" aria-label="Ouvrir reservation">${renderStaffClientIcon('columns')}</button>
          </span>
        </article>`;
      }).join('') : `<div class="groups-empty-note">Aucun groupe ne correspond aux filtres.</div>`}
    </div>
    ${rows.length > 12 ? `<button type="button" class="groups-show-more" onclick="setStaffGroupFilter('date', 'all')">Voir tous les profils</button>` : ''}
  </section>`;
}

// ════════════════════════════════════════════════════════════════════════════
//  GROUPES & ANNIVERSAIRES : RADAR DE PRÉPARATION (futur proche, ancré aujourd'hui
//  réel). Unité = LE DOSSIER (événement daté), pas le client. 3 horizons : CRM=passé,
//  Terrain=présent, ici=FUTUR PROCHE « qu'est-ce qui me tombe dessus, est-ce prêt ? ».
// ════════════════════════════════════════════════════════════════════════════

// État filtres/prépa (défauts inline, persistés dans save()).
// Le workspace groupes vit dans la page Clients (segment « À venir ») depuis la
// fusion : ses actions re-rendent la page hôte, quelle qu'elle soit.
function renderStaffGroupHost() {
  if (getStaffMenuPage() === 'clients') { renderStaffClientsPage(); return; }
  // Le dashboard affiche désormais l'alerte « demandes sur mesure » : il doit
  // être re-peint quand la file arrive, sinon l'alerte n'apparaît qu'au
  // prochain rendu fortuit. Pas de boucle : ensureStaffCustomRequests sort
  // immédiatement sur `loading` ou sur le TTL.
  if (state.view === 'staff' && getStaffMenuPage() === 'dashboard') { renderStaffDashboard(); return; }
  if (isStaffUtilityActive()) renderStaffUtilityPage();
}

// « À venir » = TOUTES les réservations futures du centre actif, pas seulement
// celles des profils classés « groupe » ou « anniversaire ». Ce filtre était le
// dernier reste de la page « Groupes & anniversaires » supprimée le 2026-07-13 :
// il faisait disparaître de la vue une venue de 4 personnes un mardi soir, qui
// est pourtant une venue à préparer comme les autres. La question à laquelle
// cette vue répond est « qui vient, quand, combien », pas « quels groupes ».
function buildStaffUpcomingVisits() {
  const today = staffGroupToday();
  const rowsByKey = new Map();
  getStaffClientRows().forEach(row => { if (row && row.key) rowsByKey.set(row.key, row); });
  return getStaffClientSourceReservations()
    .filter(reservation => reservation
      && reservation.name
      && reservation.status !== 'cancelled'
      && String(reservation.date || '') >= today)
    .map(reservation => {
      const row = rowsByKey.get(getStaffClientReservationKey(reservation)) || null;
      return {
        id: `r-${reservation.id}`,
        reservation,
        row,
        dateISO: String(reservation.date || ''),
        startTime: String(reservation.startTime || ''),
        pax: Number(reservation.pax || 0),
        name: reservation.name || (row && row.name) || 'Client',
        email: reservation.email || (row && row.email) || '',
        phone: reservation.phone || (row && row.phone) || '',
        initials: (row && row.initials) || getStaffClientInitials(reservation.name || ''),
        clientId: (row && row.id) || '',
      };
    })
    .sort((left, right) => `${left.dateISO} ${left.startTime || '99:99'}`
      .localeCompare(`${right.dateISO} ${right.startTime || '99:99'}`));
}

// CE QUI MANQUE VRAIMENT avant la venue : deux faits, lus dans la donnée, le
// plus urgent gagne (même règle que le badge unique de la liste « Tous »).
// Renvoie null quand rien ne manque : une colonne vide est un signal, une
// rangée de six pastilles à moitié allumées n'en est pas un.
//
// LES QUATRE ITEMS RETIRÉS ET POURQUOI (audit du 2026-08-13) :
// - « Formule » : disait seulement que la réservation n'était PAS une formule
//   alors que le client en avait déjà pris une. Aucune action derrière.
// - « Joueurs » : une réservation porte toujours un nombre de joueurs, l'item
//   était coché sur la totalité des lignes.
// - « Paiement » (clé historique « acompte ») : Pinlane n'encaisse pas et le
//   centre encaisse SUR PLACE. « Pas encore payé » est l'état NORMAL avant une
//   venue, pas un manque : même classe d'erreur que l'acompte de la vitrine.
// - « Activités » : c'est la checklist du JOUR J, elle se coche pendant la
//   visite depuis la réservation, pas trois semaines avant.
// La coche manuelle qui les accompagnait n'était écrite que dans le
// localStorage du navigateur (state.staffGroupPrep → save()) : un « prêt »
// coché au comptoir restait invisible du gérant sur un autre poste.
function getStaffVisitGap(visit) {
  const reservation = (visit && visit.reservation) || {};
  const isFormula = reservation.type === 'formule' || !!reservation.formuleId;
  const needsLanes = reservation.type === 'bowling' || isFormula;
  const hasResource = (Array.isArray(reservation.lanes) && reservation.lanes.length)
    || reservation.type === 'laser'
    || (reservation.opsPlan && Array.isArray(reservation.opsPlan.resourceBlocks) && reservation.opsPlan.resourceBlocks.length);
  if (needsLanes && !hasResource) return { key: 'ressource', label: 'Piste à placer' };
  if (!visit.email || !visit.phone) return { key: 'contact', label: 'Contact incomplet' };
  return null;
}

// Compte à rebours ancré aujourd'hui réel.
function staffGroupCountdown(dateISO) {
  if (!dateISO) return '';
  const days = staffClientDaysBetween(dateISO, staffGroupToday());
  if (days <= 0) return "Aujourd'hui";
  if (days === 1) return 'Demain';
  return `J-${days}`;
}

function renderStaffUtilityContactLedger(rows = []) {
  if (!rows.length) {
    return `<div class="utility-empty"><strong>Aucun contact</strong><span>Les contacts sont construits depuis les réservations réelles.</span></div>`;
  }
  return `<div class="utility-contact-table">
    <div class="utility-contact-table-head"><span>Contact</span><span>Dernière visite</span><span>Statut</span><span>Valeur</span><span>Actions</span></div>
    ${rows.slice(0, 24).map(row => `<article class="utility-contact-line">
      <div class="utility-contact-id"><span class="utility-avatar">${escapeHtml(row.initials || 'CL')}</span><div><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(row.email || row.phone || 'Coordonnées manquantes')}</small></div></div>
      <span>${escapeHtml(row.lastDate || 'Jamais')}</span>
      <span class="utility-contact-status ${escapeHtml(row.statusClass || '')}">${escapeHtml(row.status || 'Client')}</span>
      <span>${formatMoney(row.spent || 0)}<small>${Number(row.reservations || 0)} rés.</small></span>
      <span class="utility-res-actions">
        ${renderStaffUtilityAction('Fiche', `openStaffMenuPage('clients'); selectStaffClient('${escapeJsString(row.id)}')`)}
        ${renderStaffUtilityAction('Réserver', `openStaffClientBooking('${escapeJsString(row.id)}')`, 'success')}
      </span>
    </article>`).join('')}
  </div>`;
}

function getStaffEventKind(reservation) {
  const text = formulaActivityToken(`${reservation.name || ''} ${getReservationLabel(reservation) || ''}`);
  if (reservation.type === 'formule' || reservation.formuleId) return 'Formule';
  if (text.includes('anniversaire')) return 'Anniversaire';
  if (text.includes('ecole') || text.includes('college') || text.includes('saint')) return 'École';
  if (text.includes('entreprise') || text.includes('team') || text.includes('afterwork') || text.includes('garage')) return 'Entreprise';
  if (Number(reservation.pax || 0) >= 16) return 'Grand groupe';
  return 'Groupe';
}

function getStaffEventSignal(reservation) {
  const status = reservation.status || 'confirmed';
  const pax = Number(reservation.pax || 0);
  const laserCount = getLaserWindowsFromReservation(reservation).length;
  const bowlingCount = getBowlingWindowsFromReservation(reservation).length;
  if (status === 'arrived') return { label: 'Sur place', tone: 'success' };
  if (status === 'paid') return { label: 'Payé', tone: 'success' };
  if (pax >= 16 || bowlingCount > 2) return { label: 'À surveiller', tone: 'warning' };
  if (reservation.type === 'formule' || reservation.formuleId) return { label: 'Timing formule', tone: 'info' };
  if (laserCount > 1) return { label: 'Multi laser', tone: 'info' };
  return { label: 'Prévu', tone: 'neutral' };
}

function getStaffEventResources(reservation) {
  const windows = getStaffResourceWindows(reservation, 'all');
  if (!windows.length) return getReservationLabel(reservation);
  return windows.map(window => {
    if (window.resourceType === 'laser_arena') {
      const players = Number(window.players || reservation.pax || 0);
      return `Laser ${formatClockDisplay(window.start)}-${formatClockDisplay(window.end)} (${players}j)`;
    }
    const lanes = window.lanes || reservation.lanes || [];
    const laneLabel = lanes.length > 1 ? `pistes ${lanes.join(', ')}` : lanes.length ? `piste ${lanes[0]}` : 'piste auto';
    return `Bowling ${formatClockDisplay(window.start)}-${formatClockDisplay(window.end)} (${laneLabel})`;
  }).join(' | ');
}

function renderFormuleTrackingCard(reservation) {
  const summary = getFormulaActivityProgressSummary(reservation);
  const checklist = renderFormulaActivityChecklist(reservation, { bare: true });
  return `<article class="formules-card${summary.allDone ? ' all-done' : ''}">
    <div class="formules-card-head">
      <div class="formules-card-time">
        <strong>${escapeHtml(getStaffUtilityStartLabel(reservation))}</strong>
        <span>${Number(reservation.pax || 0)} joueurs</span>
      </div>
      <div class="formules-card-id">
        <strong>${escapeHtml(reservation.name || 'Groupe')}</strong>
        <span>${escapeHtml(getReservationLabel(reservation))} · ${escapeHtml(getStaffReservationStatusLabel(reservation.status))}</span>
      </div>
      ${summary.total ? `<span class="activity-check-count${summary.allDone ? ' done' : ''}">${summary.done}/${summary.total}${summary.allDone ? ' ✓' : ''}</span>` : ''}
      <button type="button" class="formules-card-open" onclick="openStaffReservationDetail(${staffClientJs(reservation.id)})">Ouvrir</button>
    </div>
    ${checklist || '<div class="formules-card-empty">Pas de plan d\'activités détaillé pour cette formule.</div>'}
  </article>`;
}

function renderStaffFormulesBoard(rows = []) {
  const formuleRows = [...rows].sort((left, right) => getReservationFirstResourceStart(left, 'all') - getReservationFirstResourceStart(right, 'all'));
  if (!formuleRows.length) {
    return `<div class="events-empty-state">
      <strong>Aucune formule sur cette date.</strong>
      <span>Les réservations de type formule apparaissent ici avec leur checklist d'activités (bowling, laser, arcades, minigolf, boissons…) à cocher au fur et à mesure.</span>
      <button type="button" onclick="openQuickBook({ date: state.currentDate, type: 'formule' })">Créer une formule</button>
    </div>`;
  }
  // Regroupement par CATÉGORIE de formule (anniversaires / spéciales / autres),
  // dans un ordre stable. Chaque formule ne montre QUE ses propres activités.
  const groups = new Map();
  formuleRows.forEach(reservation => {
    const family = getFormulaFamilyLabel(reservation.formuleId);
    if (!groups.has(family)) groups.set(family, []);
    groups.get(family).push(reservation);
  });
  const familyOrder = ['Formules anniversaires', 'Formules spéciales'];
  const rank = (name) => { const i = familyOrder.indexOf(name); return i === -1 ? familyOrder.length : i; };
  const families = [...groups.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return families.map(family => {
    const cards = groups.get(family);
    const done = cards.reduce((sum, reservation) => sum + getFormulaActivityProgressSummary(reservation).done, 0);
    const total = cards.reduce((sum, reservation) => sum + getFormulaActivityProgressSummary(reservation).total, 0);
    return `<section class="formules-group">
      <div class="formules-group-head">
        <h3>${escapeHtml(family)}</h3>
        <span>${cards.length} formule${cards.length > 1 ? 's' : ''}${total ? ` · ${done}/${total} activité${total > 1 ? 's' : ''}` : ''}</span>
      </div>
      <div class="formules-board">${cards.map(renderFormuleTrackingCard).join('')}</div>
    </section>`;
  }).join('');
}

function renderStaffUtilityEventsBoard(rows = []) {
  if (!rows.length) {
    return `<div class="events-empty-state">
      <strong>Aucun dossier sensible sur cette date.</strong>
      <span>Les anniversaires, formules, grands groupes, ecoles et entreprises apparaitront ici avec les actions terrain utiles.</span>
      <button type="button" onclick="openQuickBook({ date: state.currentDate, type: 'formule' })">Creer une formule</button>
    </div>`;
  }

  const sortedRows = [...rows].sort((left, right) => getReservationFirstResourceStart(left, 'all') - getReservationFirstResourceStart(right, 'all'));
  const nextReservation = sortedRows[0];
  const formulaCount = sortedRows.filter(reservation => reservation.type === 'formule' || reservation.formuleId).length;
  const totalPlayers = sortedRows.reduce((sum, reservation) => sum + Number(reservation.pax || 0), 0);
  const watchRows = sortedRows
    .filter(reservation => {
      const signal = getStaffEventSignal(reservation);
      return signal.tone === 'warning' || signal.tone === 'info' || Number(reservation.pax || 0) >= 16;
    })
    .slice(0, 5);

  return `<div class="events-workspace">
    <section class="events-command-bar">
      <article class="events-now-card">
        <span class="events-kicker">Prochaine action</span>
        <div>
          <strong>${escapeHtml(getStaffUtilityStartLabel(nextReservation))} - ${escapeHtml(nextReservation.name || 'Groupe')}</strong>
          <p>${escapeHtml(getStaffEventKind(nextReservation))} - ${Number(nextReservation.pax || 0)} joueurs - ${escapeHtml(getReservationLabel(nextReservation))}</p>
        </div>
        <div class="events-now-actions">
          ${renderStaffUtilityAction('Ouvrir dossier', `openStaffReservationDetail(${staffClientJs(nextReservation.id)})`)}
          ${nextReservation.status === 'arrived'
            ? renderStaffUtilityAction('Encaisser', `setReservationStatusDirect(${staffClientJs(nextReservation.id)}, 'paid', event)`, 'success')
            : renderStaffUtilityAction('Marquer arrive', `setReservationStatusDirect(${staffClientJs(nextReservation.id)}, 'arrived', event)`, 'success')}
        </div>
      </article>
      <div class="events-day-digest" aria-label="Resume evenements">
        <span><b>${sortedRows.length}</b> dossiers</span>
        <span><b>${formulaCount}</b> formules</span>
        <span><b>${totalPlayers}</b> joueurs</span>
        <span><b>${watchRows.length}</b> a surveiller</span>
      </div>
    </section>

    <div class="events-layout">
      <section class="events-agenda">
        <div class="events-section-head">
          <div>
            <h3>File du jour</h3>
            <p>Traiter les dossiers dans cet ordre, avec les ressources deja reservees.</p>
          </div>
          <button type="button" onclick="openQuickBook({ date: state.currentDate, type: 'formule' })">Ajouter</button>
        </div>
        <div class="events-timeline">
          ${sortedRows.map(reservation => {
            const id = staffClientJs(reservation.id);
            const signal = getStaffEventSignal(reservation);
            const kind = getStaffEventKind(reservation);
            const activity = getStaffReservationActivityType(reservation);
            const resources = getStaffEventResources(reservation);
            const resourceParts = String(resources || '').split(' | ').filter(Boolean);
            return `<article class="event-row event-${escapeHtml(activity)} tone-${escapeHtml(signal.tone)}">
              <div class="event-time">
                <strong>${escapeHtml(getStaffUtilityStartLabel(reservation))}</strong>
                <span>${escapeHtml(kind)}</span>
              </div>
              <div class="event-main">
                <div class="event-title-line">
                  <strong>${escapeHtml(reservation.name || 'Groupe')}</strong>
                  <span>${escapeHtml(signal.label)}</span>
                </div>
                <p>${escapeHtml(getReservationLabel(reservation))}</p>
                <div class="event-meta">
                  <span>${Number(reservation.pax || 0)} joueurs</span>
                  <span>${escapeHtml(getStaffReservationStatusLabel(reservation.status))}</span>
                  <span>${formatMoney(Number(reservation.price || 0))}</span>
                  ${renderActivityProgressPill(reservation)}
                </div>
              </div>
              <div class="event-resource" title="${escapeHtml(resources)}">
                ${resourceParts.slice(0, 2).map(part => `<span>${escapeHtml(part)}</span>`).join('')}
                ${resourceParts.length > 2 ? `<em>+${resourceParts.length - 2}</em>` : ''}
              </div>
              <div class="event-actions">
                ${renderStaffUtilityAction('Ouvrir', `openStaffReservationDetail(${id})`)}
                ${reservation.status === 'arrived'
                  ? renderStaffUtilityAction('Encaisser', `setReservationStatusDirect(${id}, 'paid', event)`, 'success')
                  : renderStaffUtilityAction('Arrive', `setReservationStatusDirect(${id}, 'arrived', event)`, 'success')}
              </div>
            </article>`;
          }).join('')}
        </div>
      </section>

      <aside class="events-side">
        <section>
          <h3>A surveiller</h3>
          ${watchRows.length ? watchRows.map(reservation => {
            const signal = getStaffEventSignal(reservation);
            return `<button type="button" class="event-watch-line tone-${escapeHtml(signal.tone)}" onclick="openStaffReservationDetail(${staffClientJs(reservation.id)})">
              <strong>${escapeHtml(reservation.name || 'Groupe')}</strong>
              <span>${escapeHtml(getStaffUtilityStartLabel(reservation))} - ${escapeHtml(signal.label)}</span>
            </button>`;
          }).join('') : '<p>Aucun point critique detecte.</p>'}
        </section>
        <section>
          <h3>Actions terrain</h3>
          <button type="button" onclick="openStaffMenuPage('arrivals')">Ouvrir les arrivees</button>
          <button type="button" onclick="openStaffPlanningResource('all')">Voir toutes les réservations</button>
          <button type="button" onclick="openQuickBook({ date: state.currentDate, type: 'formule' })">Nouvelle formule</button>
        </section>
      </aside>
    </div>
  </div>`;
}
function renderStaffUtilityLaneGrid(reservations = getStaffUtilityReservations()) {
  const bowlingWindows = reservations.flatMap(reservation => getBowlingWindowsFromReservation(reservation).map(window => ({ ...window, reservation })));
  return `<div class="utility-lane-console">
    ${Array.from({ length: TOTAL_LANES }, (_, index) => {
      const lane = index + 1;
      const status = state.laneStatuses?.[lane] === 'maintenance' ? 'maintenance' : 'active';
      const windows = bowlingWindows.filter(window => (window.lanes || []).includes(lane));
      const hours = windows.reduce((sum, window) => sum + Number(window.duration || 0), 0);
      const next = windows.sort((left, right) => Number(left.start) - Number(right.start))[0];
      const fill = Math.min(100, Math.round((hours / Math.max(1, getPlanningWindow(state.currentDate).close - getPlanningWindow(state.currentDate).open)) * 100));
      return `<article class="utility-lane ${escapeHtml(status)}">
        <div class="utility-lane-head">
          <span>Piste ${lane}</span>
          <strong>${status === 'maintenance' ? 'Maintenance' : `${windows.length} réservation${windows.length > 1 ? 's' : ''}`}</strong>
          <small>${hours ? `${formatDurationLabel(hours)} occupées` : 'Libre sur la date'}${next ? ` · ${formatClockDisplay(next.start)}` : ''}</small>
        </div>
        <div class="utility-lane-meter"><i style="width:${fill}%"></i></div>
        <div class="utility-lane-next">${next ? `<b>${escapeHtml(next.reservation.name || 'Client')}</b><span>${escapeHtml(getReservationLabel(next.reservation))}</span>` : '<span>Aucun bloc planifié</span>'}</div>
        <div class="utility-lane-actions">
          <button type="button" onclick="toggleMaint(${lane}, event)">${status === 'maintenance' ? 'Réactiver' : 'Maintenance'}</button>
          ${status !== 'maintenance' ? `<button type="button" onclick="toggleMaintDated(${lane}, event)">Maintenance datée…</button>` : ''}
        </div>
        ${status === 'maintenance' && state.laneMaintenance?.[lane] && (state.laneMaintenance[lane].from || state.laneMaintenance[lane].until)
          ? `<small class="utility-state-note">Du ${state.laneMaintenance[lane].from || '…'} au ${state.laneMaintenance[lane].until || '…'}${state.laneMaintenance[lane].note ? ` · ${escapeHtml(state.laneMaintenance[lane].note)}` : ''}</small>`
          : ''}
      </article>`;
    }).join('')}
  </div>`;
}

function getStaffUtilityLaserSessions(reservations = getStaffUtilityReservations()) {
  const groups = new Map();
  reservations.forEach(reservation => {
    getLaserWindowsFromReservation(reservation).forEach(window => {
      const key = `${Number(window.start).toFixed(3)}-${Number(window.end).toFixed(3)}`;
      const group = groups.get(key) || {
        start: Number(window.start),
        end: Number(window.end),
        reservations: [],
        players: 0
      };
      group.reservations.push({ reservation, window });
      group.players += Number(window.players || reservation.pax || 0);
      groups.set(key, group);
    });
  });
  return [...groups.values()].sort((left, right) => left.start - right.start);
}

function renderStaffUtilityLaserSessions(reservations = getStaffUtilityReservations()) {
  const sessions = getStaffUtilityLaserSessions(reservations);
  if (!sessions.length) {
    return `<div class="utility-empty"><strong>Aucun lancement Laser Game</strong><span>Créez une réservation laser ou ouvrez le planning Laser Game.</span></div>`;
  }
  return `<div class="utility-laser-control">
    ${sessions.map(session => {
      const remaining = Math.max(0, LASER_GAME_MAX_PLAYERS - session.players);
      return `<article class="utility-session">
        <div class="utility-session-head">
          <div><strong>${escapeHtml(formatClockDisplay(session.start))} - ${escapeHtml(formatClockDisplay(session.end))}</strong><span>${session.reservations.length} groupe${session.reservations.length > 1 ? 's' : ''}</span></div>
          <b>${session.players}/${LASER_GAME_MAX_PLAYERS}</b>
        </div>
        <div class="utility-session-bar"><i style="width:${Math.min(100, Math.round((session.players / LASER_GAME_MAX_PLAYERS) * 100))}%"></i></div>
        <div class="utility-session-groups">
          ${session.reservations.map(item => `<button type="button" onclick="openStaffReservationDetail(${staffClientJs(item.reservation.id)})">
            <span>${escapeHtml(item.reservation.name || 'Client')}</span>
            <em>${Number(item.window.players || item.reservation.pax || 0)} joueurs</em>
          </button>`).join('')}
        </div>
        ${remaining > 0
          ? `<button type="button" class="utility-inline-action" onclick="openQuickBookForLaserSession(${Number(session.start)}, ${remaining})">Ajouter un groupe · ${remaining} places</button>`
          : `<span class="utility-state-note">Session complète, aucun ajout possible.</span>`}
      </article>`;
    }).join('')}
  </div>`;
}

let staffCenterConfigCache = { loaded: false, loading: false, error: '', centers: [], activities: [] };

const ESTABLISHMENT_DAYS = [
  ['1', 'Lundi'], ['2', 'Mardi'], ['3', 'Mercredi'], ['4', 'Jeudi'],
  ['5', 'Vendredi'], ['6', 'Samedi'], ['0', 'Dimanche']
];

async function loadStaffCenterConfig(force = false) {
  if (staffCenterConfigCache.loading) return;
  if (staffCenterConfigCache.loaded && !force) return;
  if (!canUseStaffPermission('settings.manage') && !canUseStaffPermission('direction.view')) return;
  staffCenterConfigCache.loading = true;
  if (force) staffCenterConfigCache.error = '';
  try {
    const response = await apiRequest(`${API_ENDPOINTS.ops}?action=centerConfig&centerId=${encodeURIComponent(getCurrentStaffCenterId())}`);
    staffCenterConfigCache = {
      loaded: true,
      loading: false,
      error: '',
      centers: Array.isArray(response.centers) ? response.centers : [],
      activities: Array.isArray(response.activities) ? response.activities : []
    };
    // Pousse la config fraîche (horaires, vacances/fériés, offres) dans
    // booking-core : planning staff et espace client la reflètent sans délai.
    const currentCenter = staffCenterConfigCache.centers.find(center => center.id === getCurrentStaffCenterId());
    if (currentCenter && typeof setCenterScheduleConfig === 'function') {
      setCenterScheduleConfig(currentCenter);
      if (state.view === 'client') {
        updateSchedHint();
        renderFormules();
      }
    }
  } catch (error) {
    staffCenterConfigCache.loading = false;
    staffCenterConfigCache.loaded = true;
    staffCenterConfigCache.error = error?.message || 'Lecture configuration impossible.';
  }
  if (state.view === 'staff' && getStaffMenuPage() === 'establishment') renderStaffUtilityPage();
}

// Page Etablissement : 5 categories au lieu d'un mur. Chaque onglet repond a UNE
// question ("qu'est-ce que ce centre ?", "quand est-il ouvert ?"...). Tous les
// panneaux restent dans le DOM (masques par [hidden]) : submitCenterConfig lit
// les champs par ID, donc on enregistre depuis n'importe quel onglet sans perdre
// ce qui est saisi ailleurs.
const ESTABLISHMENT_TABS = [
  ['centre', 'Le centre'],
  ['horaires', 'Horaires & fermetures'],
  ['offres', 'Offres & activités'],
  ['clients', 'Clients & groupes'],
  ['regles', 'Règles & comptoir'],
];

function getEstablishmentTab() {
  return ESTABLISHMENT_TABS.some(([key]) => key === state.establishmentTab) ? state.establishmentTab : 'centre';
}

// Bascule d'onglet SANS re-render : en edition, reconstruire le HTML relirait la
// config serveur et effacerait ce qui vient d'etre tape dans les autres onglets.
function setEstablishmentTab(key) {
  const next = ESTABLISHMENT_TABS.some(([item]) => item === key) ? key : 'centre';
  state.establishmentTab = next;
  save();
  const panels = document.querySelectorAll('.estab-panel');
  if (!panels.length) { renderStaffUtilityPage(); return; }
  panels.forEach(panel => { panel.hidden = panel.id !== `estabPanel-${next}`; });
  document.querySelectorAll('.estab-tabs button').forEach(button => {
    const on = button.id === `estabTab-${next}`;
    button.classList.toggle('active', on);
    button.setAttribute('aria-selected', on ? 'true' : 'false');
  });
}

function establishmentTabsHtml(active) {
  return `<div class="admin-tabs estab-tabs" role="tablist" aria-label="Sections de configuration du centre">
    ${ESTABLISHMENT_TABS.map(([key, label]) => `<button type="button" role="tab" id="estabTab-${key}" aria-selected="${key === active ? 'true' : 'false'}" aria-controls="estabPanel-${key}" class="${key === active ? 'active' : ''}" onclick="setEstablishmentTab('${key}')">${escapeHtml(label)}</button>`).join('')}
  </div>`;
}

function establishmentPanel(key, active, body) {
  return `<div class="estab-panel" id="estabPanel-${key}" role="tabpanel" aria-labelledby="estabTab-${key}"${key === active ? '' : ' hidden'}>${body}</div>`;
}

// Un champ invalide peut se trouver sous un onglet ferme : sans ca, le toast
// "corrigez les champs" pointerait vers un champ que personne ne voit.
function focusEstablishmentField(input) {
  if (!input) return;
  const panel = input.closest('.estab-panel');
  const key = panel ? String(panel.id || '').replace('estabPanel-', '') : '';
  if (key && key !== getEstablishmentTab()) {
    setEstablishmentTab(key);
    const again = document.getElementById(input.id);
    if (again) { again.focus(); return; }
  }
  input.focus();
}

function toggleEstablishmentAddCenter() {
  state.establishmentAdding = !state.establishmentAdding;
  save();
  // Meme raison que les onglets : on ne remplace QUE la carte d'ajout, jamais la
  // page (une edition en cours survivrait mal a un re-render).
  const slot = document.getElementById('estabAddSlot');
  if (slot) slot.innerHTML = renderEstablishmentAddCard();
  else renderStaffUtilityPage();
  if (state.establishmentAdding) setTimeout(() => document.getElementById('estab-new-id')?.focus(), 0);
}

function getEstablishmentCenter() {
  const centers = staffCenterConfigCache.centers || [];
  if (!centers.length) return null;
  return centers.find(center => center.id === state.establishmentCenterId) || centers[0];
}

function selectEstablishmentCenter(id) {
  state.establishmentCenterId = id;
  state.establishmentEditing = false;
  save();
  renderStaffUtilityPage();
}

// Groupe une liste de centres par client. Sert au groupement de la vue
// PROPRIETAIRE (plusieurs clients) ; pour un client (un seul groupe) le rendu
// reste une liste plate. Trie : clients par nom, orphelins (sans client) en fin.
function groupCentersByClient(centers = []) {
  const groups = new Map();
  centers.forEach(c => {
    const key = c.clientId || '';
    if (!groups.has(key)) groups.set(key, { clientId: c.clientId || null, clientName: c.clientName || null, centers: [] });
    groups.get(key).centers.push(c);
  });
  return [...groups.values()].sort((a, b) => {
    if (!a.clientName && b.clientName) return 1;
    if (a.clientName && !b.clientName) return -1;
    return String(a.clientName || '').localeCompare(String(b.clientName || ''), 'fr');
  });
}

function establishmentCenterChip(c, activeId, statusLabels) {
  return `<button type="button" class="establishment-center-chip ${c.id === activeId ? 'active' : ''}" onclick="selectEstablishmentCenter('${escapeJsString(c.id)}')">
          <span class="establishment-chip-top">
            <strong>${escapeHtml(c.name)}</strong>
            <span class="establishment-status establishment-status-${escapeHtml(c.status)}">${escapeHtml(statusLabels[c.status] || c.status)}</span>
          </span>
          <small>${Number(c.resources?.bowling?.laneCount || 0)} pistes · ${Number(c.resources?.laser?.weaponCount || 0)} armes laser</small>
        </button>`;
}

// En-tete de groupe client : element pleine largeur (flex-basis 100%) insere
// dans le conteneur flex existant (aucune modif CSS requise), qui force un
// retour a la ligne avant les centres du client.
function establishmentClientHeader(label) {
  return `<span class="establishment-center-group-head" style="flex:0 0 100%;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;opacity:.55;margin:6px 2px 0">${escapeHtml(label)}</span>`;
}

// Rendu des chips de centre : plat pour un client, groupe par client pour le
// proprietaire (des que la liste couvre plusieurs clients).
function renderEstablishmentCenterChips(centers, activeId, statusLabels) {
  const groups = groupCentersByClient(centers);
  if (groups.length <= 1) {
    return centers.map(c => establishmentCenterChip(c, activeId, statusLabels)).join('');
  }
  return groups.map(group =>
    establishmentClientHeader(group.clientName || 'Sans client')
    + group.centers.map(c => establishmentCenterChip(c, activeId, statusLabels)).join('')
  ).join('');
}

// Brouillon des overrides ponctuels (jour forcé vacances/normal) pendant
// l'édition : manipulé en direct dans le DOM pour ne pas perdre les autres
// champs non sauvegardés à chaque ajout/retrait.
let establishmentHolidayOverridesDraft = [];
let establishmentCustomActivitiesDraft = [];
// Ressources DECLAREES du centre (padel, paintball, salle...) : le moteur les
// compte comme les pistes. Brouillon manipulé en direct, même doctrine que les
// activités personnalisées.
let establishmentDeclaredResourcesDraft = [];

function startEstablishmentEdit() {
  if (!canUseStaffPermission('settings.manage')) { toast('Édition réservée à la direction.'); return; }
  const center = getEstablishmentCenter();
  establishmentHolidayOverridesDraft = (center?.holidaySettings?.overrides || [])
    .filter(item => item && item.date && (item.mode === 'holiday' || item.mode === 'normal'))
    .map(item => ({ date: item.date, mode: item.mode }));
  establishmentCustomActivitiesDraft = (Array.isArray(center?.customActivities) ? center.customActivities : [])
    .filter(item => item && item.id && item.label)
    .map(item => ({ id: item.id, label: item.label }));
  establishmentDeclaredResourcesDraft = (Array.isArray(center?.resources?.declared) ? center.resources.declared : [])
    .filter(item => item && item.id && item.name)
    .map(item => ({
      id: item.id,
      name: item.name,
      units: Math.max(1, Number(item.units) || 1),
      capacityPerUnit: Math.max(1, Number(item.capacityPerUnit) || 1),
      cleanupMinutes: Math.max(0, Number(item.cleanupMinutes) || 0),
      allowGroupMixing: item.allowGroupMixing === true
    }));
  state.establishmentEditing = true;
  renderStaffUtilityPage();
}

function cancelEstablishmentEdit() {
  state.establishmentEditing = false;
  establishmentHolidayOverridesDraft = [];
  establishmentCustomActivitiesDraft = [];
  establishmentDeclaredResourcesDraft = [];
  renderStaffUtilityPage();
}

function establishmentSlugify(value) {
  return String(value || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

function renderEstablishmentCustomActivities() {
  if (!establishmentCustomActivitiesDraft.length) {
    return '<p class="estab-overrides-empty">Aucune activité personnalisée. Ajoute-en une (ex : Réalité Virtuelle, Karaoké, Escape Game).</p>';
  }
  return establishmentCustomActivitiesDraft.map(item => `<div class="estab-custom-activity">
    <span>${escapeHtml(item.label)}</span>
    <button type="button" class="estab-override-remove" aria-label="Retirer l'activité ${escapeHtml(item.label)}" onclick="removeEstablishmentCustomActivity('${escapeJsString(item.id)}')">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  </div>`).join('');
}

function refreshEstablishmentCustomActivitiesList() {
  const list = document.getElementById('estabCustomActivitiesList');
  if (list) list.innerHTML = renderEstablishmentCustomActivities();
}

function addEstablishmentCustomActivity() {
  const input = document.getElementById('estab-new-activity');
  const label = String(input?.value || '').trim().slice(0, 60);
  if (!label) { toast('Donne un nom à l\'activité.'); return; }
  const id = establishmentSlugify(label);
  if (!id) { toast('Nom d\'activité invalide.'); return; }
  if (establishmentCustomActivitiesDraft.some(item => item.id === id)) { toast('Cette activité existe déjà.'); return; }
  if (establishmentCustomActivitiesDraft.length >= 40) { toast('Maximum 40 activités personnalisées.'); return; }
  establishmentCustomActivitiesDraft.push({ id, label });
  if (input) input.value = '';
  refreshEstablishmentCustomActivitiesList();
}

function removeEstablishmentCustomActivity(id) {
  establishmentCustomActivitiesDraft = establishmentCustomActivitiesDraft.filter(item => item.id !== id);
  refreshEstablishmentCustomActivitiesList();
}

// Ids que la donnée ne peut pas revendiquer (familles historiques et
// pseudo-types du moteur) : mêmes réservations que lib/declared-resources.js.
const ESTABLISHMENT_RESERVED_RESOURCE_IDS = ['bowling_lane', 'laser_arena', 'party_table', 'bar_service', 'bar_service_then_autonomous', 'soft_capacity', 'free_activity', 'transition', 'service'];

function renderEstablishmentDeclaredResources() {
  if (!establishmentDeclaredResourcesDraft.length) {
    return '<p class="estab-overrides-empty">Aucune installation déclarée. Ajoute ce que le moteur doit compter (ex : Court de padel, Terrain paintball, Salle).</p>';
  }
  return establishmentDeclaredResourcesDraft.map(item => `<div class="estab-custom-activity">
    <span>${escapeHtml(item.name)} · ${Number(item.units)} instal. × ${Number(item.capacityPerUnit)} pers. · remise ${Number(item.cleanupMinutes)} min · ${item.allowGroupMixing ? 'mixage groupes' : 'sans mixage'}</span>
    <button type="button" class="estab-override-remove" aria-label="Retirer l'installation ${escapeHtml(item.name)}" onclick="removeEstablishmentDeclaredResource('${escapeJsString(item.id)}')">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  </div>`).join('');
}

function refreshEstablishmentDeclaredResourcesList() {
  const list = document.getElementById('estabDeclaredResourcesList');
  if (list) list.innerHTML = renderEstablishmentDeclaredResources();
}

function addEstablishmentDeclaredResource() {
  const nameInput = document.getElementById('estab-res-name');
  const name = String(nameInput?.value || '').trim().slice(0, 60);
  if (!name) { toast('Donne un nom à l\'installation.'); return; }
  const id = establishmentSlugify(name).replace(/-/g, '_');
  if (!id) { toast('Nom d\'installation invalide.'); return; }
  if (ESTABLISHMENT_RESERVED_RESOURCE_IDS.includes(id)) { toast('Ce nom est réservé au moteur, choisis-en un autre.'); return; }
  if (establishmentDeclaredResourcesDraft.some(item => item.id === id)) { toast('Cette installation existe déjà.'); return; }
  if (establishmentDeclaredResourcesDraft.length >= 20) { toast('Maximum 20 installations déclarées.'); return; }
  const units = Number(document.getElementById('estab-res-units')?.value);
  const capacityPerUnit = Number(document.getElementById('estab-res-capacity')?.value);
  const cleanupMinutes = Number(document.getElementById('estab-res-cleanup')?.value || 0);
  if (!Number.isInteger(units) || units < 1 || units > 50) { toast('Installations : entier entre 1 et 50.'); return; }
  if (!Number.isInteger(capacityPerUnit) || capacityPerUnit < 1 || capacityPerUnit > 500) { toast('Joueurs par installation : entier entre 1 et 500.'); return; }
  if (!Number.isInteger(cleanupMinutes) || cleanupMinutes < 0 || cleanupMinutes > 240) { toast('Remise en état : entier entre 0 et 240 minutes.'); return; }
  establishmentDeclaredResourcesDraft.push({
    id,
    name,
    units,
    capacityPerUnit,
    cleanupMinutes,
    allowGroupMixing: !!document.getElementById('estab-res-mixing')?.checked
  });
  if (nameInput) nameInput.value = '';
  refreshEstablishmentDeclaredResourcesList();
}

function removeEstablishmentDeclaredResource(id) {
  establishmentDeclaredResourcesDraft = establishmentDeclaredResourcesDraft.filter(item => item.id !== id);
  refreshEstablishmentDeclaredResourcesList();
}

function renderEstablishmentOverridesList() {
  if (!establishmentHolidayOverridesDraft.length) {
    return '<p class="estab-overrides-empty">Aucun jour forcé. Le calendrier belge (fériés + congés FWB) s’applique automatiquement.</p>';
  }
  return establishmentHolidayOverridesDraft
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map(item => `<div class="estab-override-chip ${item.mode === 'holiday' ? 'is-holiday' : 'is-normal'}">
      <span class="num">${escapeHtml(item.date)}</span>
      <span>${item.mode === 'holiday' ? 'Forcé vacances/férié' : 'Forcé horaires normaux'}</span>
      <button type="button" class="estab-override-remove" aria-label="Retirer l'exception du ${escapeHtml(item.date)}" onclick="removeEstablishmentHolidayOverride('${escapeJsString(item.date)}')">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>`)
    .join('');
}

function refreshEstablishmentOverridesList() {
  const list = document.getElementById('estabHolidayOverridesList');
  if (list) list.innerHTML = renderEstablishmentOverridesList();
}

function addEstablishmentHolidayOverride() {
  const dateInput = document.getElementById('estab-override-date');
  const modeInput = document.getElementById('estab-override-mode');
  const date = String(dateInput?.value || '').trim();
  const mode = modeInput?.value === 'normal' ? 'normal' : 'holiday';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast('Choisissez une date valide.'); return; }
  establishmentHolidayOverridesDraft = establishmentHolidayOverridesDraft.filter(item => item.date !== date);
  establishmentHolidayOverridesDraft.push({ date, mode });
  if (dateInput) dateInput.value = '';
  refreshEstablishmentOverridesList();
}

function removeEstablishmentHolidayOverride(date) {
  establishmentHolidayOverridesDraft = establishmentHolidayOverridesDraft.filter(item => item.date !== date);
  refreshEstablishmentOverridesList();
}

function establishmentInputValue(id, fallback = '') {
  const el = document.getElementById(id);
  return el ? el.value : fallback;
}

function collectEstablishmentScheduleBlock(prefix) {
  const block = {};
  ESTABLISHMENT_DAYS.forEach(([key]) => {
    const open = establishmentInputValue(`${prefix}-${key}-open`);
    let close = establishmentInputValue(`${prefix}-${key}-close`);
    // 00:00 saisi comme heure de fermeture = minuit → stocké 24:00 (format moteur).
    if (close === '00:00') close = '24:00';
    const closed = document.getElementById(`${prefix}-${key}-closed`)?.checked;
    block[key] = closed || !open || !close ? null : { open, close };
  });
  return block;
}

// A3 : bornes alignées sur la validation serveur (lib/center-config.js,
// clampInt) : le front refuse AVANT envoi ce que le serveur re-clamperait en
// silence. Pattern DESIGN.md §6 : bordure danger (aria-invalid) + message
// 12px role="alert" sous le champ.
const ESTABLISHMENT_NUMBER_RULES = [
  ['estab-laneCount', 1, 40, 'Nombre de pistes : entier entre 1 et 40.'],
  ['estab-normalCap', 1, 12, 'Joueurs confort : entier entre 1 et 12 par piste.'],
  ['estab-emergencyCap', 1, 15, 'Joueurs max (secours) : entier entre 1 et 15 par piste.'],
  ['estab-weaponCount', 0, 200, "Nombre d'armes : entier entre 0 et 200."],
  ['estab-launches', 1, 20, 'Lancements parallèles : entier entre 1 et 20.']
];

function clearEstablishmentFieldErrors() {
  document.querySelectorAll('.establishment-editor .field-error-message').forEach(el => el.remove());
  document.querySelectorAll('.establishment-editor [aria-invalid="true"]').forEach(el => el.removeAttribute('aria-invalid'));
}

function markEstablishmentFieldError(input, message) {
  if (!input) return;
  input.setAttribute('aria-invalid', 'true');
  const note = document.createElement('div');
  note.className = 'field-error-message';
  note.setAttribute('role', 'alert');
  note.textContent = message;
  const host = input.closest('.field') || input.closest('.estab-day-row');
  if (host) host.appendChild(note);
  else input.insertAdjacentElement('afterend', note);
}

function validateEstablishmentForm() {
  clearEstablishmentFieldErrors();
  const invalid = [];
  ESTABLISHMENT_NUMBER_RULES.forEach(([id, min, max, message]) => {
    const input = document.getElementById(id);
    if (!input) return;
    const value = Number(input.value);
    if (!Number.isInteger(value) || value < min || value > max) {
      markEstablishmentFieldError(input, message);
      invalid.push(input);
    }
  });
  // Couleur du tunnel : facultative, mais une saisie qui n'est PAS une couleur
  // ne doit pas partir en silence (le serveur la jetterait sans rien dire, et
  // le gérant croirait sa marque enregistrée). Un contraste faible, lui, ne
  // bloque jamais : c'est un avertissement, affiché sous le champ.
  const accentInput = document.getElementById('estab-accent');
  const accentRaw = accentInput ? String(accentInput.value || '').trim() : '';
  const brandApi = establishmentBrandApi();
  if (accentInput && accentRaw && (!brandApi || !brandApi.isValidHex(accentRaw))) {
    markEstablishmentFieldError(accentInput, 'Couleur du tunnel : un code hexadécimal comme #1f6f43, ou vide pour aucune marque.');
    invalid.push(accentInput);
  }
  // Cohérence : la capacité de secours ne peut pas être sous la capacité
  // confort (le serveur la relèverait en silence).
  const normalCap = Number(document.getElementById('estab-normalCap')?.value);
  const emergencyInput = document.getElementById('estab-emergencyCap');
  if (emergencyInput && !emergencyInput.hasAttribute('aria-invalid')
    && Number.isInteger(normalCap) && Number(emergencyInput.value) < normalCap) {
    markEstablishmentFieldError(emergencyInput, 'Joueurs max (secours) doit être au moins égal aux joueurs confort.');
    invalid.push(emergencyInput);
  }
  // Horaires : fermeture strictement après ouverture pour chaque jour ouvert
  // (00:00 saisi en fermeture = minuit, stocké 24:00).
  const toMinutes = (value) => {
    const [h, m] = String(value).split(':').map(Number);
    return h * 60 + m;
  };
  [['estab-day', 'Horaires normaux'], ['estab-hday', 'Horaires vacances/fériés']].forEach(([prefix, blockLabel]) => {
    ESTABLISHMENT_DAYS.forEach(([key, dayLabel]) => {
      if (document.getElementById(`${prefix}-${key}-closed`)?.checked) return;
      const closeInput = document.getElementById(`${prefix}-${key}-close`);
      const open = establishmentInputValue(`${prefix}-${key}-open`);
      let close = establishmentInputValue(`${prefix}-${key}-close`);
      if (!open || !close) return; // champ vide = jour stocké fermé (comportement existant)
      if (close === '00:00') close = '24:00';
      if (toMinutes(close) <= toMinutes(open)) {
        markEstablishmentFieldError(closeInput, `${blockLabel}, ${dayLabel} : la fermeture doit être après l'ouverture (00:00 = minuit).`);
        invalid.push(closeInput);
      }
    });
  });
  return invalid;
}

// A4 : garde de ré-entrance, un double-clic sur « Enregistrer » ne doit
// produire qu'UN seul POST, bouton désactivé pendant l'async.
let submitCenterConfigInFlight = false;

async function submitCenterConfig(centerId) {
  if (!canUseStaffPermission('settings.manage')) { toast('Édition réservée à la direction.'); return; }
  if (submitCenterConfigInFlight) return;
  const invalidFields = validateEstablishmentForm();
  if (invalidFields.length) {
    focusEstablishmentField(invalidFields[0]);
    toast('Corrigez les champs en erreur avant d’enregistrer.');
    return;
  }
  const regular = collectEstablishmentScheduleBlock('estab-day');
  const holiday = collectEstablishmentScheduleBlock('estab-hday');
  const activityAvailability = {};
  (staffCenterConfigCache.activities || []).forEach(activity => {
    activityAvailability[activity.id] = !!document.getElementById(`estab-act-${activity.id}`)?.checked;
  });
  // Panneau « Offres & formules » : map générique offerId -> booléen,
  // appliquée aussi côté serveur (une formule décochée n'est plus réservable).
  // Collecte depuis le DOM : ce qui a été RENDU (liste vive du catalogue,
  // customs comprises) est exactement ce qui s'enregistre. Itérer une
  // constante ici perdait le réglage de toute formule qu'elle ignorait.
  const offerAvailability = {};
  document.querySelectorAll('input[data-estab-offer]').forEach(input => {
    offerAvailability[input.getAttribute('data-estab-offer')] = !!input.checked;
  });
  const formulaBlockedPeriods = ['manual'];
  if (document.getElementById('estab-fbp-public')?.checked) formulaBlockedPeriods.push('public');
  if (document.getElementById('estab-fbp-short')?.checked) formulaBlockedPeriods.push('school_short');
  if (document.getElementById('estab-fbp-summer')?.checked) formulaBlockedPeriods.push('school_summer');
  // Classification client/groupe éditée par le staff (seuils + formules annif).
  // Meme collecte DOM que les offres : ce qui a ete rendu est ce qui s'enregistre.
  const birthdayFormulaIds = [...document.querySelectorAll('input[data-estab-bday]')]
    .filter(input => input.checked)
    .map(input => input.getAttribute('data-estab-bday'));
  const classification = {
    groupMinPax: Number(establishmentInputValue('estab-groupMinPax', 10)),
    groupMinCumulative: Number(establishmentInputValue('estab-groupMinCumulative', 18)),
    countFormulaAsGroup: !!document.getElementById('estab-countFormulaAsGroup')?.checked,
    sizeTiers: {
      medium: Number(establishmentInputValue('estab-tier-medium', 12)),
      large: Number(establishmentInputValue('estab-tier-large', 30)),
      xl: Number(establishmentInputValue('estab-tier-xl', 60)),
    },
    birthdayFromFormula: !!document.getElementById('estab-birthdayFromFormula')?.checked,
    birthdayFormulaIds,
    keyClientMinSpend: Number(establishmentInputValue('estab-keyClientMinSpend', 0)) || 0,
  };
  const chk = (id) => !!document.getElementById(id)?.checked;
  const config = {
    status: establishmentInputValue('estab-status', 'active'),
    timezone: establishmentInputValue('estab-timezone', 'Europe/Brussels'),
    resources: {
      bowling: {
        laneCount: Number(establishmentInputValue('estab-laneCount', 8)),
        normalCapacityPerLane: Number(establishmentInputValue('estab-normalCap', 6)),
        emergencyCapacityPerLane: Number(establishmentInputValue('estab-emergencyCap', 7)),
        preferAdjacentLanes: chk('estab-preferAdjacent')
      },
      laser: {
        weaponCount: Number(establishmentInputValue('estab-weaponCount', 30)),
        parallelLaunches: Number(establishmentInputValue('estab-launches', 1)),
        riskLevel: establishmentInputValue('estab-laserRisk', 'managed'),
        requiresCompleteGroupBeforeLaunch: chk('estab-requiresComplete'),
        canSplitGroupsCleanly: chk('estab-canSplit')
      },
      partyTables: {
        softCapacity: Number(establishmentInputValue('estab-tableSoft', 6)),
        hardCapacity: Number(establishmentInputValue('estab-tableHard', 8))
      },
      declared: establishmentDeclaredResourcesDraft.map(item => ({
        id: item.id,
        name: item.name,
        units: item.units,
        capacityPerUnit: item.capacityPerUnit,
        cleanupMinutes: item.cleanupMinutes,
        allowGroupMixing: item.allowGroupMixing
      })),
      barDesk: {
        handlesBooking: chk('estab-bar-booking'),
        handlesBriefing: chk('estab-bar-briefing'),
        handlesFoodAndDrink: chk('estab-bar-food'),
        activityEscort: chk('estab-bar-escort')
      }
    },
    defaultSchedule: { regular, holiday },
    holidaySettings: {
      enabled: !!document.getElementById('estab-holiday-enabled')?.checked,
      overrides: establishmentHolidayOverridesDraft.map(item => ({ date: item.date, mode: item.mode })),
      formulaBlockedPeriods
    },
    offerAvailability,
    activityAvailability,
    classification,
    customActivities: establishmentCustomActivitiesDraft.map(item => ({ id: item.id, label: item.label }))
  };
  // La marque du centre voyage avec le reste de sa config. `undefined` = champ
  // absent ou saisie refusée : on ne l'ajoute pas au payload, donc le serveur
  // conserve la couleur existante au lieu de l'effacer.
  const branding = collectEstablishmentBranding();
  if (branding !== undefined) config.branding = branding;
  const payment = collectEstablishmentPayment();
  if (payment !== undefined) config.payment = payment;
  const name = establishmentInputValue('estab-name').trim();
  submitCenterConfigInFlight = true;
  const saveBtn = document.getElementById('estabSaveBtn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Enregistrement…'; }
  try {
    if (name) {
      await apiRequest(API_ENDPOINTS.ops, { method: 'POST', body: JSON.stringify({ action: 'saveCenter', center: { id: centerId, name, status: config.status } }) });
    }
    await apiRequest(API_ENDPOINTS.ops, { method: 'POST', body: JSON.stringify({ action: 'saveCenterConfig', centerId, config }) });
    toast('Configuration du centre enregistrée.');
    state.establishmentEditing = false;
    establishmentHolidayOverridesDraft = [];
    await loadStaffCenterConfig(true);
  } catch (error) {
    toast(error?.message || 'Enregistrement impossible.');
  } finally {
    submitCenterConfigInFlight = false;
    // Re-query : la page a pu être re-rendue (succès) ou pas (échec réseau).
    const btn = document.getElementById('estabSaveBtn');
    if (btn) { btn.disabled = false; btn.textContent = 'Enregistrer'; }
  }
}

async function submitNewCenter() {
  if (!canUseStaffPermission('settings.manage')) { toast('Ajout réservé à la direction.'); return; }
  const id = establishmentInputValue('estab-new-id').trim().toLowerCase();
  const name = establishmentInputValue('estab-new-name').trim();
  if (!id || !name) { toast('Identifiant et nom requis.'); return; }
  try {
    await apiRequest(API_ENDPOINTS.ops, { method: 'POST', body: JSON.stringify({ action: 'saveCenter', center: { id, name, status: 'planned' } }) });
    toast(`Centre « ${name} » ajouté.`);
    state.establishmentCenterId = id;
    save();
    await loadStaffCenterConfig(true);
  } catch (error) {
    toast(error?.message || 'Ajout impossible.');
  }
}

async function setEstablishmentCenterStatus(centerId, status) {
  if (!canUseStaffPermission('settings.manage')) { toast('Action réservée à la direction.'); return; }
  // A5 : archiver coupe la réservation client en direct, confirmation
  // explicite obligatoire, annulation = zéro appel API.
  if (status === 'closed') {
    const center = (staffCenterConfigCache.centers || []).find(item => item.id === centerId);
    const centerName = center?.name || centerId;
    if (!window.confirm(`Archiver ${centerName} ? Les réservations client seront coupées pour ce centre.`)) return;
  }
  try {
    await apiRequest(API_ENDPOINTS.ops, { method: 'POST', body: JSON.stringify({ action: 'setCenterStatus', centerId, status }) });
    toast(status === 'closed' ? 'Centre archivé.' : 'Statut mis à jour.');
    await loadStaffCenterConfig(true);
  } catch (error) {
    toast(error?.message || 'Changement de statut impossible.');
  }
}

// ── LA COULEUR DU TUNNEL, SAISIE ICI ────────────────────────────────────────
//
// Le tunnel public d'un centre porte SA marque depuis que le magenta Fun Galaxy
// a quitté assets/pinlane-client.css. Cette couleur était une donnée de centre
// que seul un appel d'API savait poser : elle se saisit désormais dans l'écran
// qui configure le centre, comme le reste.
//
// UNE couleur, pas huit : assets/brand-color.js dérive le jeu complet de jetons
// (clair + sombre) et l'envoie DÉCLARÉ dans la config. Il MESURE aussi le
// contraste réel contre les fonds où la couleur sert, et l'interface le dit.
// Elle avertit, elle ne bloque pas : la marque appartient au client.
function establishmentBrandApi() {
  return (typeof window !== 'undefined' && window.PinlaneBrand) ? window.PinlaneBrand : null;
}

function establishmentBrandPalette() {
  const api = establishmentBrandApi();
  if (!api) return null;
  try { return api.readPlatformPalette(document); } catch (error) { return null; }
}

function establishmentAccentNoteHtml(raw) {
  const api = establishmentBrandApi();
  const value = String(raw == null ? '' : raw).trim();
  if (!value) return '<span class="estab-brand-note">Aucune couleur : le tunnel de ce centre garde l’accent Pinlane.</span>';
  if (!api || !api.isValidHex(value)) {
    return '<span class="estab-brand-note is-bad">Code couleur invalide : attendu un hexadécimal, par exemple #1f6f43.</span>';
  }
  const palette = establishmentBrandPalette();
  const notice = api.contrastNotice(api.deriveBranding(value, palette), palette);
  if (!notice) return '<span class="estab-brand-note"></span>';
  return `<span class="estab-brand-note ${notice.tone === 'warn' ? 'is-warn' : 'is-ok'}">${escapeHtml(notice.text)}</span>`;
}

// Les axes de style saisissables, avec leurs libelles metier. Le premier choix
// de chaque axe est le DEFAUT plateforme : le choisir n'ecrit rien en config.
const ESTABLISHMENT_STYLE_AXES = [
  { key: 'theme', label: 'Thème du tunnel', options: [['auto', 'Suit l’appareil du client'], ['light', 'Toujours clair'], ['dark', 'Toujours sombre']] },
  { key: 'radius', label: 'Angles', options: [['soft', 'Doux (défaut)'], ['sharp', 'Carrés'], ['round', 'Très arrondis']] },
  { key: 'font', label: 'Police', options: [['geist', 'Geist (défaut)'], ['humanist', 'Humaniste'], ['serif', 'Serif'], ['mono', 'Monospace']] },
  { key: 'backdrop', label: 'Fond de page', options: [['plain', 'Neutre (défaut)'], ['tint', 'Teinté à votre couleur'], ['aurora', 'Halo à votre couleur']] },
  { key: 'cards', label: 'Panneaux', options: [['line', 'Bordure fine (défaut)'], ['flat', 'Aplat sans bordure'], ['shadow', 'Ombre douce']] },
  { key: 'buttons', label: 'Boutons', options: [['pill', 'Pilule (défaut)'], ['rounded', 'Rectangle arrondi']] },
];

function establishmentAccentFieldHtml(center) {
  const api = establishmentBrandApi();
  const branding = (center && center.branding && typeof center.branding === 'object') ? center.branding : {};
  const accent = branding.accent ? String(branding.accent) : '';
  const swatch = (api && api.isValidHex(accent)) ? api.normalizeHex(accent) : '';
  const axisFields = ESTABLISHMENT_STYLE_AXES.map((axis) => {
    const current = String(branding[axis.key] || '').trim().toLowerCase();
    const options = axis.options.map(([value, label], index) => {
      const selected = current === value || (!axis.options.some(([v]) => v === current) && index === 0);
      return `<option value="${escapeHtml(value)}" ${selected ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    }).join('');
    return `<div class="field estab-style-field">
      <label for="estab-style-${escapeHtml(axis.key)}">${escapeHtml(axis.label)}</label>
      <select id="estab-style-${escapeHtml(axis.key)}" class="estab-style-select">${options}</select>
    </div>`;
  }).join('');
  return `<div class="field estab-brand-field">
    <label for="estab-accent">Couleur du tunnel client</label>
    <div class="estab-brand-pick">
      <input type="color" id="estab-accent-picker" aria-label="Choisir la couleur du tunnel"
        value="${escapeHtml(swatch || '#000000')}" ${swatch ? '' : 'data-unset="1"'}
        oninput="setEstablishmentAccent(this.value, 'picker')">
      <input type="text" id="estab-accent" spellcheck="false" autocomplete="off"
        placeholder="#1f6f43 (facultatif)" value="${escapeHtml(accent)}"
        aria-describedby="estab-brand-note" oninput="setEstablishmentAccent(this.value, 'text')">
      <button type="button" class="btn btn-ghost btn-sm" onclick="setEstablishmentAccent('', 'clear')">Retirer</button>
    </div>
    <span id="estab-brand-note">${establishmentAccentNoteHtml(accent)}</span>
    <div class="estab-style-grid">${axisFields}</div>
    <span class="estab-brand-note">Ces réglages habillent le tunnel de réservation public de ce centre : couleurs, thème, angles, police, fond, panneaux et boutons.</span>
  </div>`;
}

// LE MODE D'ENCAISSEMENT DU CENTRE. Un seul mode est activable aujourd'hui :
// « tout se règle sur place », parce que c'est le seul que le produit tient
// (aucun prestataire de paiement dans le dépôt). Les modes en ligne sont
// AFFICHÉS mais désactivés : le gérant voit où ça se règlera le jour où
// l'encaissement existe, sans qu'on lui vende une option fantôme (classe
// d'écart commercial payée le 2026-08-08).
function establishmentPaymentFieldHtml(center) {
  const mode = String(center && center.payment && center.payment.mode || 'onsite');
  return `<div class="field estab-brand-field">
    <label for="estab-payment-mode">Encaissement des réservations</label>
    <select id="estab-payment-mode" class="estab-style-select">
      <option value="onsite" ${mode === 'onsite' ? 'selected' : ''}>Tout se règle sur place (au comptoir)</option>
      <option value="deposit" disabled>Acompte en ligne : à venir avec l'encaissement</option>
      <option value="online" disabled>Paiement en ligne : à venir avec l'encaissement</option>
    </select>
    <span class="estab-brand-note">Le tunnel de réservation annonce ce mode au client. Les paiements en ligne s'activeront ici dès que l'encaissement Pinlane sera branché.</span>
  </div>`;
}

function collectEstablishmentPayment() {
  const select = document.getElementById('estab-payment-mode');
  if (!select) return undefined;
  const mode = String(select.value || '').trim().toLowerCase();
  return mode === 'onsite' ? { mode } : undefined;
}

function establishmentAccentReadValue(center) {
  const api = establishmentBrandApi();
  const accent = (center && center.branding && center.branding.accent) ? String(center.branding.accent) : '';
  if (!api || !api.isValidHex(accent)) return '<span class="estab-badge off">accent Pinlane</span>';
  const safe = api.normalizeHex(accent);
  return `<span class="estab-brand-read"><span class="estab-brand-dot" style="background:${escapeHtml(safe)}" aria-hidden="true"></span><span class="num">${escapeHtml(safe)}</span></span>`;
}

// Les deux contrôles portent LA MÊME valeur ; seul celui qui n'a pas la frappe
// est resynchronisé, sinon le curseur sauterait à chaque caractère.
function setEstablishmentAccent(value, source) {
  const api = establishmentBrandApi();
  const raw = String(value == null ? '' : value).trim();
  const text = document.getElementById('estab-accent');
  const picker = document.getElementById('estab-accent-picker');
  const note = document.getElementById('estab-brand-note');
  if (text && source !== 'text') text.value = raw;
  if (picker && source !== 'picker') {
    if (api && api.isValidHex(raw)) { picker.value = api.normalizeHex(raw); picker.removeAttribute('data-unset'); }
    else picker.setAttribute('data-unset', '1');
  }
  if (picker && source === 'picker') picker.removeAttribute('data-unset');
  if (note) note.innerHTML = establishmentAccentNoteHtml(raw);
}

// Ce qui part au serveur. Champ vide = `null` : mergeCenterConfig remplace la
// valeur, donc EFFACER la couleur est possible et le tunnel revient à l'accent
// plateforme. Champ absent du DOM (panneau jamais rendu) = `undefined` : on ne
// touche à rien plutôt que d'effacer une marque par accident.
function collectEstablishmentStyle() {
  const out = {};
  ESTABLISHMENT_STYLE_AXES.forEach((axis) => {
    const select = document.getElementById(`estab-style-${axis.key}`);
    if (!select) return;
    const value = String(select.value || '').trim().toLowerCase();
    // Le premier choix de l'axe est le defaut plateforme : on n'ecrit QUE les
    // ecarts, la config d'un centre au defaut reste vide.
    if (value && value !== axis.options[0][0]) out[axis.key] = value;
  });
  return out;
}

function collectEstablishmentBranding() {
  const input = document.getElementById('estab-accent');
  if (!input) return undefined;
  const api = establishmentBrandApi();
  const raw = String(input.value || '').trim();
  const style = collectEstablishmentStyle();
  const hasStyle = Object.keys(style).length > 0;
  if (!raw) return hasStyle ? style : null;
  if (!api || !api.isValidHex(raw)) return hasStyle ? style : undefined;
  const colors = api.deriveBranding(raw, establishmentBrandPalette());
  return { ...(colors || {}), ...style };
}

function renderEstablishmentDayRow(center, key, label, block = 'regular', prefix = 'estab-day') {
  const schedule = center.defaultSchedule && typeof center.defaultSchedule === 'object' ? center.defaultSchedule : null;
  const slot = schedule?.[block]?.[key] || null;
  const closed = !slot;
  // input[type=time] ne sait pas représenter « 24:00 » (minuit fin de journée) :
  // on l'affiche 00:00 et submitCenterConfig le re-stocke en 24:00.
  const closeValue = slot?.close === '24:00' ? '00:00' : (slot?.close || '22:00');
  const defaultOpen = block === 'holiday' ? '10:00' : '14:00';
  return `<div class="estab-day-row">
    <span class="estab-day-label">${escapeHtml(label)}</span>
    <label class="estab-day-closed"><input type="checkbox" class="estab-check" id="${prefix}-${key}-closed" ${closed ? 'checked' : ''} onchange="const r=this.closest('.estab-day-row');r.querySelectorAll('input[type=time]').forEach(i=>i.disabled=this.checked)"><span class="estab-check-box" aria-hidden="true"></span> Fermé</label>
    <input type="time" id="${prefix}-${key}-open" value="${escapeHtml(slot?.open || defaultOpen)}" ${closed ? 'disabled' : ''} aria-label="Ouverture ${escapeHtml(label)}">
    <span class="estab-day-sep">→</span>
    <input type="time" id="${prefix}-${key}-close" value="${escapeHtml(closeValue)}" ${closed ? 'disabled' : ''} aria-label="Fermeture ${escapeHtml(label)} (00:00 = minuit)">
  </div>`;
}

function renderStaffUtilityEstablishment() {
  if (!staffCenterConfigCache.loaded && !staffCenterConfigCache.loading) {
    setTimeout(() => loadStaffCenterConfig(false), 0);
  }
  // Le panneau Offres consomme la liste VIVE du catalogue : son chargement se
  // declenche d'ici aussi (pas seulement depuis la page Tarifs). Une fois la
  // liste arrivee, pevLoad repeint cette page en mode lecture.
  if (typeof window.pevEnsureCatalogLoaded === 'function') window.pevEnsureCatalogLoaded();
  if (!staffCenterConfigCache.loaded || staffCenterConfigCache.loading) {
    return `<div class="establishment-page"><div class="establishment-loading">Lecture de la configuration des centres…</div></div>`;
  }
  if (staffCenterConfigCache.error) {
    return `<div class="establishment-page"><div class="establishment-error"><strong>Configuration indisponible</strong><span>${escapeHtml(staffCenterConfigCache.error)}</span><button type="button" class="btn btn-secondary btn-sm" onclick="loadStaffCenterConfig(true)">Réessayer</button></div></div>`;
  }
  const centers = staffCenterConfigCache.centers;
  const center = getEstablishmentCenter();
  if (!center) return `<div class="establishment-page"><div class="establishment-loading">Aucun centre.</div></div>`;
  const canEdit = canUseStaffPermission('settings.manage');
  const editing = canEdit && !!state.establishmentEditing;
  const bowling = center.resources?.bowling || {};
  const laser = center.resources?.laser || {};
  const party = center.resources?.partyTables && typeof center.resources.partyTables === 'object' ? center.resources.partyTables : {};
  const barDesk = center.resources?.barDesk && typeof center.resources.barDesk === 'object' ? center.resources.barDesk : {};
  const timezone = center.timezone || 'Europe/Brussels';
  const laserRisk = ['critical', 'managed', 'low'].includes(laser.riskLevel) ? laser.riskLevel : 'managed';
  const classification = center.classification && typeof center.classification === 'object' ? center.classification : {};
  const classTiers = classification.sizeTiers && typeof classification.sizeTiers === 'object' ? classification.sizeTiers : {};
  const birthdayFormulaIds = Array.isArray(classification.birthdayFormulaIds) ? classification.birthdayFormulaIds : ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8'];
  const holidaySettings = center.holidaySettings && typeof center.holidaySettings === 'object'
    ? center.holidaySettings
    : { enabled: true, overrides: [], formulaBlockedPeriods: ['public', 'school_short', 'manual'] };
  const blockedPeriods = Array.isArray(holidaySettings.formulaBlockedPeriods)
    ? holidaySettings.formulaBlockedPeriods
    : ['public', 'school_short', 'manual'];
  const statusLabels = { active: 'Actif', planned: 'Prévu', closed: 'Archivé' };
  const tab = getEstablishmentTab();
  return `<div class="establishment-page">
    <section class="establishment-selector">
      <div class="establishment-selector-head">
        <div><h2>Centres</h2><p>${centers.length} centre${centers.length > 1 ? 's' : ''} · sélectionne un centre pour voir ou modifier sa configuration</p></div>
      </div>
      <div class="establishment-center-list">
        ${renderEstablishmentCenterChips(centers, center.id, statusLabels)}
        ${canEdit ? `<div id="estabAddSlot" class="establishment-add-slot">${renderEstablishmentAddCard()}</div>` : ''}
      </div>
    </section>

    <section class="establishment-editor" aria-label="Configuration ${escapeHtml(center.name)}">
      <div class="establishment-editor-head">
        <div>
          <span class="establishment-eyebrow">Configuration centre</span>
          <h2>${escapeHtml(center.name)} <span class="establishment-status establishment-status-${escapeHtml(center.status)}">${escapeHtml(statusLabels[center.status] || center.status)}</span></h2>
        </div>
        <div class="establishment-editor-actions">
          ${editing
            ? `<button type="button" id="estabSaveBtn" class="btn btn-primary" onclick="submitCenterConfig('${escapeJsString(center.id)}')">Enregistrer</button>
               <button type="button" class="btn btn-ghost btn-sm" onclick="cancelEstablishmentEdit()">Annuler</button>`
            : canEdit
              ? `<button type="button" class="btn btn-primary" onclick="startEstablishmentEdit()">Modifier</button>
                 ${center.status !== 'closed'
                   ? `<button type="button" class="btn btn-ghost btn-sm" onclick="setEstablishmentCenterStatus('${escapeJsString(center.id)}', 'closed')">Archiver</button>`
                   : `<button type="button" class="btn btn-secondary btn-sm" onclick="setEstablishmentCenterStatus('${escapeJsString(center.id)}', 'active')">Réactiver</button>`}`
              : `<span class="establishment-readonly">Lecture seule, édition réservée à la direction.</span>`}
        </div>
      </div>

      ${establishmentTabsHtml(tab)}
      ${editing ? '<p class="estab-edit-hint">Vous modifiez la configuration. « Enregistrer » enregistre les cinq sections d\'un coup, pas seulement celle affichée.</p>' : ''}

      <div class="estab-panels">
        ${editing ? renderEstablishmentEditPanels(center, tab) : renderEstablishmentReadPanels(center, tab)}
      </div>
    </section>
  </div>`;
}

// Ajouter un centre etait une 4e carte au milieu des centres : on croyait lire un
// centre nomme « Ajouter un centre ». C'est maintenant une carte d'action en
// pointilles qui ouvre le formulaire a la demande.
function renderEstablishmentAddCard() {
  if (!state.establishmentAdding) {
    return `<button type="button" class="establishment-add-card" onclick="toggleEstablishmentAddCenter()">
      <span class="establishment-add-plus" aria-hidden="true">+</span>
      <span>Ajouter un centre</span>
    </button>`;
  }
  return `<div class="establishment-add">
    <div class="establishment-add-head"><span>Nouveau centre</span><button type="button" class="estab-override-remove" aria-label="Fermer" onclick="toggleEstablishmentAddCenter()">×</button></div>
    <input type="text" id="estab-new-id" placeholder="Identifiant (ex : namur)" autocomplete="off">
    <input type="text" id="estab-new-name" placeholder="Nom du centre" autocomplete="off">
    <button type="button" class="btn btn-secondary btn-sm" onclick="submitNewCenter()">Ajouter</button>
  </div>`;
}

// EDITION : memes champs, memes IDs qu'avant (submitCenterConfig lit par ID),
// regroupes par question plutot qu'empiles. Les chiffres de capacite vivent dans
// « Le centre », les comportements du moteur dans « Regles & comptoir ».
function renderEstablishmentEditPanels(center, active) {
  const bowling = center.resources?.bowling || {};
  const laser = center.resources?.laser || {};
  const party = center.resources?.partyTables && typeof center.resources.partyTables === 'object' ? center.resources.partyTables : {};
  const barDesk = center.resources?.barDesk && typeof center.resources.barDesk === 'object' ? center.resources.barDesk : {};
  const timezone = center.timezone || 'Europe/Brussels';
  const laserRisk = ['critical', 'managed', 'low'].includes(laser.riskLevel) ? laser.riskLevel : 'managed';
  const classification = center.classification && typeof center.classification === 'object' ? center.classification : {};
  const classTiers = classification.sizeTiers && typeof classification.sizeTiers === 'object' ? classification.sizeTiers : {};
  const birthdayFormulaIds = Array.isArray(classification.birthdayFormulaIds) ? classification.birthdayFormulaIds : ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8'];
  const holidaySettings = center.holidaySettings && typeof center.holidaySettings === 'object'
    ? center.holidaySettings
    : { enabled: true, overrides: [], formulaBlockedPeriods: ['public', 'school_short', 'manual'] };
  const blockedPeriods = Array.isArray(holidaySettings.formulaBlockedPeriods)
    ? holidaySettings.formulaBlockedPeriods
    : ['public', 'school_short', 'manual'];

  const formulaGrid = (idPrefix, isOn, labelOf) => `<div class="establishment-activity-grid">
    ${getConsoleFormuleCatalog().map(formule => {
      const on = isOn(formule);
      return `<label class="establishment-activity ${on ? 'on' : ''}">
        <input type="checkbox" id="${idPrefix}-${escapeHtml(formule.id)}" data-${idPrefix}="${escapeHtml(formule.id)}" ${on ? 'checked' : ''} onchange="this.closest('.establishment-activity').classList.toggle('on', this.checked)">
        <span>${escapeHtml(labelOf(formule))}</span>
      </label>`;
    }).join('')}
  </div>`;

  const centrePanel = `<div class="estab-edit-grid cols-2">
    <fieldset class="establishment-card">
      <legend>Identité</legend>
      <div class="field"><label for="estab-name">Nom du centre</label><input type="text" id="estab-name" value="${escapeHtml(center.name)}"></div>
      ${establishmentAccentFieldHtml(center)}
      ${establishmentPaymentFieldHtml(center)}
      <div class="estab-field-row">
        <div class="field"><label for="estab-status">Statut</label>
          <select id="estab-status">
            <option value="active" ${center.status === 'active' ? 'selected' : ''}>Actif</option>
            <option value="planned" ${center.status === 'planned' ? 'selected' : ''}>Prévu</option>
            <option value="closed" ${center.status === 'closed' ? 'selected' : ''}>Archivé</option>
          </select>
        </div>
        <div class="field"><label for="estab-timezone">Fuseau horaire</label>
          <select id="estab-timezone">
            ${['Europe/Brussels', 'Europe/Paris', 'Europe/Luxembourg', 'Europe/Amsterdam'].map(tz => `<option value="${tz}" ${timezone === tz ? 'selected' : ''}>${tz}</option>`).join('')}
          </select>
        </div>
      </div>
    </fieldset>

    <fieldset class="establishment-card">
      <legend>Bowling</legend>
      <p class="estab-card-hint">Ce que le moteur peut allouer. Les comportements (pistes adjacentes…) sont dans « Règles &amp; comptoir ».</p>
      <div class="estab-field-row">
        <div class="field"><label for="estab-laneCount">Nombre de pistes</label><input type="number" id="estab-laneCount" min="1" max="40" value="${Number(bowling.laneCount || 8)}"></div>
        <div class="field"><label for="estab-normalCap">Joueurs confort / piste</label><input type="number" id="estab-normalCap" min="1" max="12" value="${Number(bowling.normalCapacityPerLane || 6)}"></div>
        <div class="field"><label for="estab-emergencyCap">Joueurs max / piste (secours)</label><input type="number" id="estab-emergencyCap" min="1" max="15" value="${Number(bowling.emergencyCapacityPerLane || 7)}"></div>
      </div>
    </fieldset>

    <fieldset class="establishment-card">
      <legend>Laser Game</legend>
      <div class="estab-field-row">
        <div class="field"><label for="estab-weaponCount">Nombre d'armes</label><input type="number" id="estab-weaponCount" min="0" max="200" value="${Number(laser.weaponCount || 0)}"></div>
        <div class="field"><label for="estab-launches">Lancements parallèles</label><input type="number" id="estab-launches" min="1" max="20" value="${Number(laser.parallelLaunches || 1)}"></div>
      </div>
    </fieldset>

    <fieldset class="establishment-card">
      <legend>Tables anniversaire</legend>
      <div class="estab-field-row">
        <div class="field"><label for="estab-tableSoft">Capacité conseillée</label><input type="number" id="estab-tableSoft" min="1" max="100" value="${Number(party.softCapacity || 6)}"></div>
        <div class="field"><label for="estab-tableHard">Capacité max</label><input type="number" id="estab-tableHard" min="1" max="120" value="${Number(party.hardCapacity || Math.max(Number(party.softCapacity || 6), 8))}"></div>
      </div>
    </fieldset>

    <fieldset class="establishment-card">
      <legend>Installations déclarées</legend>
      <p class="estab-card-hint">Déclare une ressource que le moteur doit compter comme les pistes (court de padel, terrain paintball, salle…). Le planning n'accepte alors que les enchaînements qui tiennent, remise en état comprise.</p>
      <div class="estab-field-row">
        <div class="field"><label for="estab-res-name">Nom</label><input type="text" id="estab-res-name" placeholder="ex : Court de padel" maxlength="60" autocomplete="off" onkeydown="if(event.key==='Enter'){event.preventDefault();addEstablishmentDeclaredResource();}"></div>
        <div class="field"><label for="estab-res-units">Installations</label><input type="number" id="estab-res-units" min="1" max="50" value="1"></div>
        <div class="field"><label for="estab-res-capacity">Joueurs / installation</label><input type="number" id="estab-res-capacity" min="1" max="500" value="4"></div>
        <div class="field"><label for="estab-res-cleanup">Remise en état (min)</label><input type="number" id="estab-res-cleanup" min="0" max="240" value="0"></div>
      </div>
      <label class="establishment-toggle"><input type="checkbox" id="estab-res-mixing"><span class="estab-check-box" aria-hidden="true"></span><span>Deux groupes distincts peuvent partager la même session (mixage)</span></label>
      <div class="estab-override-form">
        <button type="button" class="btn btn-secondary btn-sm" onclick="addEstablishmentDeclaredResource()">Ajouter l'installation</button>
      </div>
      <div id="estabDeclaredResourcesList" class="estab-custom-activities-list">${renderEstablishmentDeclaredResources()}</div>
    </fieldset>
  </div>`;

  const horairesPanel = `<div class="estab-edit-stack">
    <fieldset class="establishment-card establishment-hours">
      <legend>Horaires normaux</legend>
      ${ESTABLISHMENT_DAYS.map(([key, label]) => renderEstablishmentDayRow(center, key, label)).join('')}
    </fieldset>

    <fieldset class="establishment-card establishment-hours establishment-holiday-hours">
      <legend>Horaires vacances &amp; fériés</legend>
      <label class="establishment-toggle">
        <input type="checkbox" id="estab-holiday-enabled" ${holidaySettings.enabled !== false ? 'checked' : ''}>
        <span class="estab-check-box" aria-hidden="true"></span>
        <span>Appliquer automatiquement ces horaires les jours fériés belges et pendant les congés scolaires FWB</span>
      </label>
      ${ESTABLISHMENT_DAYS.map(([key, label]) => renderEstablishmentDayRow(center, key, label, 'holiday', 'estab-hday')).join('')}
      <div class="estab-subsection">
        <h4>Formules « non valables vacances/fériés » bloquées pendant :</h4>
        <div class="estab-period-grid">
          <label class="establishment-toggle"><input type="checkbox" id="estab-fbp-public" ${blockedPeriods.includes('public') ? 'checked' : ''}><span class="estab-check-box" aria-hidden="true"></span><span>Jours fériés</span></label>
          <label class="establishment-toggle"><input type="checkbox" id="estab-fbp-short" ${blockedPeriods.includes('school_short') ? 'checked' : ''}><span class="estab-check-box" aria-hidden="true"></span><span>Petits congés (automne, hiver, détente, printemps)</span></label>
          <label class="establishment-toggle"><input type="checkbox" id="estab-fbp-summer" ${blockedPeriods.includes('school_summer') ? 'checked' : ''}><span class="estab-check-box" aria-hidden="true"></span><span>Grandes vacances (juillet-août)</span></label>
        </div>
      </div>
      <div class="estab-subsection">
        <h4>Exceptions ponctuelles (jour forcé)</h4>
        <div class="estab-override-form">
          <input type="date" id="estab-override-date" aria-label="Date de l'exception">
          <select id="estab-override-mode" aria-label="Type d'exception">
            <option value="holiday">Traiter comme vacances/férié</option>
            <option value="normal">Traiter comme jour normal</option>
          </select>
          <button type="button" class="btn btn-secondary btn-sm" onclick="addEstablishmentHolidayOverride()">Ajouter</button>
        </div>
        <div id="estabHolidayOverridesList" class="estab-overrides-list">${renderEstablishmentOverridesList()}</div>
      </div>
    </fieldset>

    ${renderAvailabilityBlocksPanel()}
  </div>`;

  const offresPanel = `<div class="estab-edit-stack">
    <fieldset class="establishment-card establishment-offers">
      <legend>Offres &amp; formules</legend>
      <p class="estab-card-hint">Une offre décochée disparaît de l'espace client et n'est plus réservable (blocage aussi côté serveur).</p>
      ${(() => {
        // Liste VIVE du catalogue (customs comprises, retirees exclues) :
        // l'ancienne constante figeait la liste au deploiement et une formule
        // creee dans Tarifs n'apparaissait jamais ici.
        const families = [];
        getConsoleFormuleCatalog().forEach(formule => {
          const familyName = formule.family || 'Formules';
          let group = families.find(item => item.name === familyName);
          if (!group) { group = { name: familyName, items: [] }; families.push(group); }
          group.items.push(formule);
        });
        return families.map(group => `
          <div class="estab-offer-group">
            <h4>${escapeHtml(group.name)}</h4>
            <div class="establishment-activity-grid">
              ${group.items.map(formule => {
                const enabled = center.offerAvailability?.[formule.id] !== false;
                return `<label class="establishment-activity ${enabled ? 'on' : ''}">
                  <input type="checkbox" id="estab-offer-${escapeHtml(formule.id)}" data-estab-offer="${escapeHtml(formule.id)}" ${enabled ? 'checked' : ''} onchange="this.closest('.establishment-activity').classList.toggle('on', this.checked)">
                  <span>${escapeHtml(formule.name)}${formule.price != null ? ` · ${Number(formule.price)}€/${formule.type === 'per_lane' ? 'piste' : 'pers.'}` : ''}</span>
                </label>`;
              }).join('')}
            </div>
          </div>`).join('');
      })()}
    </fieldset>

    <fieldset class="establishment-card establishment-activities">
      <legend>Activités disponibles</legend>
      <p class="estab-card-hint">Coche les activités du catalogue proposées sur ce centre.</p>
      <div class="establishment-activity-grid">
        ${(staffCenterConfigCache.activities || []).map(activity => `<label class="establishment-activity ${center.activityAvailability?.[activity.id] ? 'on' : ''}">
          <input type="checkbox" id="estab-act-${escapeHtml(activity.id)}" ${center.activityAvailability?.[activity.id] ? 'checked' : ''} onchange="this.closest('.establishment-activity').classList.toggle('on', this.checked)">
          <span>${escapeHtml(activity.label)}</span>
        </label>`).join('')}
      </div>
      <div class="estab-subsection">
        <h4>Activités personnalisées de ce centre</h4>
        <p class="estab-card-hint">Ajoute une activité propre au centre (au-delà du catalogue). Retire-la avec la croix.</p>
        <div class="estab-override-form">
          <input type="text" id="estab-new-activity" placeholder="Nom (ex : Réalité Virtuelle)" maxlength="60" autocomplete="off" onkeydown="if(event.key==='Enter'){event.preventDefault();addEstablishmentCustomActivity();}">
          <button type="button" class="btn btn-secondary btn-sm" onclick="addEstablishmentCustomActivity()">Ajouter</button>
        </div>
        <div id="estabCustomActivitiesList" class="estab-custom-activities-list">${renderEstablishmentCustomActivities()}</div>
      </div>
    </fieldset>
  </div>`;

  const clientsPanel = `<div class="estab-edit-stack">
    <fieldset class="establishment-card establishment-classification">
      <legend>Quand une réservation devient un groupe</legend>
      <p class="estab-card-hint">S'applique en direct à la page Clients.</p>
      <div class="estab-field-row">
        <div class="field"><label for="estab-groupMinPax">Groupe dès (joueurs / résa)</label><input type="number" id="estab-groupMinPax" min="2" max="200" value="${Number(classification.groupMinPax || 10)}"></div>
        <div class="field"><label for="estab-groupMinCumulative">… ou joueurs cumulés</label><input type="number" id="estab-groupMinCumulative" min="2" max="5000" value="${Number(classification.groupMinCumulative || 18)}"></div>
      </div>
      <label class="establishment-toggle"><input type="checkbox" id="estab-countFormulaAsGroup" ${classification.countFormulaAsGroup !== false ? 'checked' : ''}><span class="estab-check-box" aria-hidden="true"></span><span>Une réservation avec formule compte comme groupe</span></label>
      <div class="estab-subsection">
        <h4>Client clé</h4>
        <p class="estab-card-hint">Le badge « Client clé » signale vos gros budgets sur la page Clients. À 0, le seuil est calculé tout seul : les 20 % qui dépensent le plus.</p>
        <div class="field"><label for="estab-keyClientMinSpend">Client clé à partir de (€ cumulés)</label><input type="number" id="estab-keyClientMinSpend" min="0" max="100000" step="50" value="${Number(classification.keyClientMinSpend || 0)}"></div>
      </div>
      <div class="estab-subsection">
        <h4>Paliers de taille (badges groupes)</h4>
        <div class="estab-field-row">
          <div class="field"><label for="estab-tier-medium">Moyen dès</label><input type="number" id="estab-tier-medium" min="2" max="500" value="${Number(classTiers.medium || 12)}"></div>
          <div class="field"><label for="estab-tier-large">Grand dès</label><input type="number" id="estab-tier-large" min="2" max="1000" value="${Number(classTiers.large || 30)}"></div>
          <div class="field"><label for="estab-tier-xl">XL dès</label><input type="number" id="estab-tier-xl" min="2" max="2000" value="${Number(classTiers.xl || 60)}"></div>
        </div>
      </div>
    </fieldset>

    <fieldset class="establishment-card">
      <legend>Formules considérées « anniversaire »</legend>
      <label class="establishment-toggle"><input type="checkbox" id="estab-birthdayFromFormula" ${classification.birthdayFromFormula !== false ? 'checked' : ''}><span class="estab-check-box" aria-hidden="true"></span><span>Une réservation avec une de ces formules est classée anniversaire (même sans le déclarer)</span></label>
      ${formulaGrid('estab-bday', formule => birthdayFormulaIds.includes(formule.id), formule => formule.name)}
    </fieldset>
  </div>`;

  const reglesPanel = `<div class="estab-edit-grid cols-3">
    <fieldset class="establishment-card">
      <legend>Moteur : bowling</legend>
      <label class="establishment-toggle"><input type="checkbox" id="estab-preferAdjacent" ${bowling.preferAdjacentLanes !== false ? 'checked' : ''}><span class="estab-check-box" aria-hidden="true"></span><span>Préférer des pistes adjacentes pour un même groupe</span></label>
    </fieldset>

    <fieldset class="establishment-card">
      <legend>Moteur : laser</legend>
      <div class="field"><label for="estab-laserRisk">Niveau de risque</label>
        <select id="estab-laserRisk">
          <option value="low" ${laserRisk === 'low' ? 'selected' : ''}>Faible</option>
          <option value="managed" ${laserRisk === 'managed' ? 'selected' : ''}>Maîtrisé</option>
          <option value="critical" ${laserRisk === 'critical' ? 'selected' : ''}>Critique</option>
        </select>
      </div>
      <label class="establishment-toggle"><input type="checkbox" id="estab-requiresComplete" ${laser.requiresCompleteGroupBeforeLaunch !== false ? 'checked' : ''}><span class="estab-check-box" aria-hidden="true"></span><span>Exiger le groupe complet avant de lancer une partie</span></label>
      <label class="establishment-toggle"><input type="checkbox" id="estab-canSplit" ${laser.canSplitGroupsCleanly === true ? 'checked' : ''}><span class="estab-check-box" aria-hidden="true"></span><span>Autoriser à scinder proprement les groupes</span></label>
    </fieldset>

    <fieldset class="establishment-card">
      <legend>Ce que gère le comptoir</legend>
      <label class="establishment-toggle"><input type="checkbox" id="estab-bar-booking" ${barDesk.handlesBooking !== false ? 'checked' : ''}><span class="estab-check-box" aria-hidden="true"></span><span>Prise de réservation au comptoir</span></label>
      <label class="establishment-toggle"><input type="checkbox" id="estab-bar-briefing" ${barDesk.handlesBriefing !== false ? 'checked' : ''}><span class="estab-check-box" aria-hidden="true"></span><span>Briefing / consignes de jeu</span></label>
      <label class="establishment-toggle"><input type="checkbox" id="estab-bar-food" ${barDesk.handlesFoodAndDrink !== false ? 'checked' : ''}><span class="estab-check-box" aria-hidden="true"></span><span>Boissons &amp; restauration</span></label>
      <label class="establishment-toggle"><input type="checkbox" id="estab-bar-escort" ${barDesk.activityEscort === true ? 'checked' : ''}><span class="estab-check-box" aria-hidden="true"></span><span>Accompagnement pendant l'activité</span></label>
    </fieldset>
  </div>`;

  return [
    establishmentPanel('centre', active, centrePanel),
    establishmentPanel('horaires', active, horairesPanel),
    establishmentPanel('offres', active, offresPanel),
    establishmentPanel('clients', active, clientsPanel),
    establishmentPanel('regles', active, reglesPanel),
  ].join('');
}

// LECTURE : meme decoupage que l'edition, pour qu'on retrouve au meme endroit ce
// qu'on vient de modifier.
function renderEstablishmentReadPanels(center, active) {
  const bowling = center.resources?.bowling || {};
  const laser = center.resources?.laser || {};
  const schedule = center.defaultSchedule && typeof center.defaultSchedule === 'object' ? center.defaultSchedule : {};
  const regular = schedule.regular || {};
  const holiday = schedule.holiday || {};
  const holidaySettings = center.holidaySettings && typeof center.holidaySettings === 'object'
    ? center.holidaySettings
    : { enabled: true, overrides: [], formulaBlockedPeriods: ['public', 'school_short', 'manual'] };
  const blockedPeriods = Array.isArray(holidaySettings.formulaBlockedPeriods)
    ? holidaySettings.formulaBlockedPeriods
    : ['public', 'school_short', 'manual'];
  const periodLabels = { public: 'jours fériés', school_short: 'petits congés', school_summer: 'grandes vacances' };
  const blockedLabel = ['public', 'school_short', 'school_summer'].filter(key => blockedPeriods.includes(key)).map(key => periodLabels[key]);
  const overrides = Array.isArray(holidaySettings.overrides) ? holidaySettings.overrides : [];
  const activities = (staffCenterConfigCache.activities || []);
  const enabled = activities.filter(activity => center.activityAvailability?.[activity.id]);
  const customList = Array.isArray(center.customActivities) ? center.customActivities : [];
  // Liste VIVE du catalogue : une formule creee dans Tarifs compte ici des sa
  // creation, une retiree disparait (l'ancienne constante figait ce panneau).
  const catalogFormuleList = getConsoleFormuleCatalog();
  const disabledOffers = catalogFormuleList.filter(formule => center.offerAvailability?.[formule.id] === false);
  const activeOffers = catalogFormuleList.filter(formule => center.offerAvailability?.[formule.id] !== false);
  const classification = center.classification && typeof center.classification === 'object' ? center.classification : {};
  const classTiers = classification.sizeTiers && typeof classification.sizeTiers === 'object' ? classification.sizeTiers : {};
  const birthdayIds = Array.isArray(classification.birthdayFormulaIds) ? classification.birthdayFormulaIds : ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8'];
  const birthdayNames = catalogFormuleList.filter(formule => birthdayIds.includes(formule.id)).map(formule => formule.name);
  const party = center.resources?.partyTables && typeof center.resources.partyTables === 'object' ? center.resources.partyTables : {};
  const barDesk = center.resources?.barDesk && typeof center.resources.barDesk === 'object' ? center.resources.barDesk : {};
  const timezone = center.timezone || 'Europe/Brussels';
  const softCap = Number(party.softCapacity || 6);
  const hardCap = Number(party.hardCapacity || Math.max(softCap, 8));
  const riskLevel = ['critical', 'managed', 'low'].includes(laser.riskLevel) ? laser.riskLevel : 'managed';
  const riskMeta = { critical: ['danger', 'Critique'], managed: ['warn', 'Maîtrisé'], low: ['on', 'Faible'] };

  const svg = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  const ICO = {
    resources: svg('<path d="M12 2 2 7l10 5 10-5-10-5Z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/>'),
    clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    rules: svg('<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>'),
    desk: svg('<path d="M3 10h18M5 10V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4M6 10v10M18 10v10M9 15h6"/>'),
    users: svg('<path d="M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9.5" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/>'),
    pin: svg('<circle cx="12" cy="12" r="9"/><circle cx="9" cy="9" r="1"/><circle cx="15" cy="9" r="1"/><circle cx="12" cy="13" r="1"/>'),
    target: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>'),
    bolt: svg('<path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z"/>'),
    cake: svg('<path d="M4 21h16M5 21v-7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7M5 15h14M12 12V8M12 5.5V3.5M9 8.5V6"/>'),
    tag: svg('<path d="M20.6 13.4 12 22l-9-9V4a1 1 0 0 1 1-1h9l7.6 7.6a2 2 0 0 1 0 2.8Z"/><circle cx="7.5" cy="7.5" r="1.4"/>'),
    grid: svg('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
    id: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="11" r="2.4"/><path d="M5.5 17c.7-1.6 2-2.4 3.5-2.4s2.8.8 3.5 2.4M15 9.5h4M15 13h4"/>'),
  };
  const stat = (ico, label, value, sub) => `<div class="estab-stat"><div class="estab-stat-top"><span class="estab-stat-ico">${ico}</span>${escapeHtml(label)}</div><div class="estab-stat-value">${escapeHtml(String(value))}</div>${sub ? `<div class="estab-stat-sub">${escapeHtml(sub)}</div>` : ''}</div>`;
  const section = (ico, title, desc, body, extra = '') => `<section class="estab-section ${extra}"><div class="estab-section-head"><span class="estab-section-ico">${ico}</span><div class="estab-section-copy"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(desc)}</p></div></div>${body}</section>`;
  const yesNo = (on) => on ? '<span class="estab-badge on">Oui</span>' : '<span class="estab-badge off">Non</span>';
  const rule = (label, valueHtml, sub) => `<div class="estab-rule"><div class="estab-rule-label">${escapeHtml(label)}${sub ? `<small>${escapeHtml(sub)}</small>` : ''}</div><div class="estab-rule-value">${valueHtml}</div></div>`;
  const hourCell = (slot, cls) => slot && slot.open && slot.close
    ? `<span class="estab-hour-pill ${cls}">${escapeHtml(slot.open)} → ${escapeHtml(slot.close)}</span>`
    : '<span class="estab-hour-closed">Fermé</span>';
  const weekRows = ESTABLISHMENT_DAYS.map(([key, label]) =>
    `<div class="estab-week-row"><span class="estab-week-day">${escapeHtml(label)}</span>${hourCell(regular[key], '')}${hourCell(holiday[key], 'holiday')}</div>`).join('');

  const centrePanel = `<div class="estab-read-stack">
    ${section(ICO.resources, 'Ressources & capacité', 'Ce que le moteur utilise pour allouer pistes, armes et tables.', `
      <div class="estab-stat-grid">
        ${stat(ICO.pin, 'Pistes bowling', Number(bowling.laneCount || 0), '')}
        ${stat(ICO.users, 'Confort / piste', Number(bowling.normalCapacityPerLane || 0), 'joueurs recommandés')}
        ${stat(ICO.users, 'Max / piste', Number(bowling.emergencyCapacityPerLane || 0), 'capacité secours')}
        ${stat(ICO.target, 'Armes laser', Number(laser.weaponCount || 0), '')}
        ${stat(ICO.bolt, 'Lancements //', Number(laser.parallelLaunches || 0), 'simultanés')}
        ${stat(ICO.cake, 'Tables anniv.', softCap, `capacité max ${hardCap}`)}
      </div>`)}
    ${(Array.isArray(center.resources?.declared) && center.resources.declared.length) ? section(ICO.grid, 'Installations déclarées', 'Les ressources propres au centre : le moteur les compte comme les pistes.', `
      <div class="estab-rules">
        ${center.resources.declared.map(item => rule(
          String(item.name || item.id),
          `<span class="num">${Number(item.units) || 1} × ${Number(item.capacityPerUnit) || 1} pers.</span>${Number(item.cleanupMinutes) ? ` <span class="estab-badge warn">remise ${Number(item.cleanupMinutes)} min</span>` : ''}${item.allowGroupMixing ? ' <span class="estab-badge on">mixage</span>' : ''}`,
          '',
        )).join('')}
      </div>`) : ''}
    ${section(ICO.id, 'Identité', 'Ce qui identifie le centre dans la plateforme.', `
      <div class="estab-rules">
        ${rule('Nom', `<span>${escapeHtml(center.name)}</span>`)}
        ${rule('Identifiant technique', `<span class="num">${escapeHtml(center.id)}</span>`, 'utilisé par le moteur et les URL')}
        ${rule('Fuseau horaire', `<span class="num">${escapeHtml(timezone)}</span>`)}
        ${rule('Couleur du tunnel', establishmentAccentReadValue(center), 'portée par la page de réservation publique')}
      </div>`)}
  </div>`;

  const horairesPanel = `<div class="estab-read-stack">
    ${section(ICO.clock, "Horaires d'ouverture", 'Horaires normaux et pendant les vacances / jours fériés.', `
      <div class="estab-week">
        <div class="estab-week-head"><span>Jour</span><span>Normal</span><span>Vacances / férié</span></div>
        ${weekRows}
      </div>
      <div class="estab-rules">
        ${rule('Application automatique fériés & congés FWB', holidaySettings.enabled !== false ? '<span class="estab-badge on">Activée</span>' : '<span class="estab-badge off">Manuelle</span>')}
        ${rule('Formules anniversaires bloquées', blockedLabel.length ? `<span class="estab-badge warn">${escapeHtml(blockedLabel.join(', '))}</span>` : '<span class="estab-badge off">jamais</span>')}
      </div>
      ${overrides.length ? `<div class="estab-chip-row">${overrides.map(item => `<span class="estab-tag">${escapeHtml(item.date)} · ${item.mode === 'holiday' ? 'vacances/férié' : 'jour normal'}</span>`).join('')}</div>` : ''}`)}
    ${renderAvailabilityBlocksPanel()}
  </div>`;

  const offresPanel = `<div class="estab-read-stack">
    ${section(ICO.tag, 'Offres & formules', 'Formules réservables côté client.', `
      <div class="estab-rules">
        ${rule('Formules réservables', `<span class="num">${activeOffers.length}</span> / ${catalogFormuleList.length}`)}
      </div>
      ${disabledOffers.length
        ? `<div><p class="estab-empty" style="margin-bottom:6px">Désactivées côté client :</p><div class="estab-chip-row">${disabledOffers.map(formule => `<span class="estab-tag estab-tag-off">${escapeHtml(formule.name)}</span>`).join('')}</div></div>`
        : '<p class="estab-empty">Toutes les offres sont actives côté client.</p>'}`)}
    ${section(ICO.grid, 'Activités disponibles', 'Catalogue proposé sur ce centre + activités personnalisées.', `
      ${(enabled.length || customList.length)
        ? `<div class="estab-chip-row">${enabled.map(activity => `<span class="estab-tag">${escapeHtml(activity.label)}</span>`).join('')}${customList.map(activity => `<span class="estab-tag estab-tag-custom">${escapeHtml(activity.label)}</span>`).join('')}</div>`
        : '<p class="estab-empty">Aucune activité activée.</p>'}`)}
  </div>`;

  const clientsPanel = `<div class="estab-read-stack">
    ${section(ICO.users, 'Classification clients & groupes', 'Seuils groupe et formules « anniversaire ».', `
      <div class="estab-rules">
        ${rule('Groupe dès', `<span class="num">${Number(classification.groupMinPax || 10)}</span> joueurs / résa`, `ou ${Number(classification.groupMinCumulative || 18)} cumulés${classification.countFormulaAsGroup !== false ? ' · ou 1 formule' : ''}`)}
        ${rule('Paliers de taille', `moyen <span class="num">${Number(classTiers.medium || 12)}</span> · grand <span class="num">${Number(classTiers.large || 30)}</span> · XL <span class="num">${Number(classTiers.xl || 60)}</span>`)}
      </div>
      ${classification.birthdayFromFormula !== false
        ? `<div><p class="estab-empty" style="margin-bottom:6px">Formules classées « anniversaire » :</p><div class="estab-chip-row">${birthdayNames.length ? birthdayNames.map(name => `<span class="estab-tag">${escapeHtml(name)}</span>`).join('') : '<span class="estab-tag">aucune</span>'}</div></div>`
        : '<p class="estab-empty">L\'anniversaire n\'est déterminé que par l\'occasion déclarée par le client.</p>'}`)}
  </div>`;

  const reglesPanel = `<div class="estab-read-stack estab-read-duo">
    ${section(ICO.rules, 'Règles opérationnelles', 'Comportement du moteur pour le laser et le bowling.', `
      <div class="estab-rules">
        ${rule('Groupe complet avant lancement laser', yesNo(laser.requiresCompleteGroupBeforeLaunch !== false), 'sinon départ possible en sous-groupe')}
        ${rule('Peut scinder les groupes proprement', yesNo(laser.canSplitGroupsCleanly === true))}
        ${rule('Niveau de risque laser', `<span class="estab-badge ${riskMeta[riskLevel][0]}">${riskMeta[riskLevel][1]}</span>`)}
        ${rule('Pistes bowling adjacentes préférées', yesNo(bowling.preferAdjacentLanes !== false))}
      </div>`)}
    ${section(ICO.desk, 'Comptoir & bar', 'Ce que gère le comptoir sur ce centre.', `
      <div class="estab-rules">
        ${rule('Prise de réservation', yesNo(barDesk.handlesBooking !== false))}
        ${rule('Briefing / consignes', yesNo(barDesk.handlesBriefing !== false))}
        ${rule('Boissons & restauration', yesNo(barDesk.handlesFoodAndDrink !== false))}
        ${rule('Accompagnement activité', yesNo(barDesk.activityEscort === true))}
      </div>`)}
  </div>`;

  return [
    establishmentPanel('centre', active, centrePanel),
    establishmentPanel('horaires', active, horairesPanel),
    establishmentPanel('offres', active, offresPanel),
    establishmentPanel('clients', active, clientsPanel),
    establishmentPanel('regles', active, reglesPanel),
  ].join('');
}

const STAFF_PERMISSION_GROUPS = [
  {
    id: 'pilotage',
    title: 'Pilotage',
    description: 'Vue globale, direction et exports.',
    permissions: [
      ['dashboard.view', 'Voir le dashboard'],
      ['direction.view', 'Ouvrir la direction'],
      ['centers.switch', 'Changer de centre'],
      ['reports.export', 'Exporter les rapports']
    ]
  },
  {
    id: 'planning',
    title: 'Planning',
    description: 'Bowling, Laser Game et déplacements.',
    permissions: [
      ['planning.view', 'Voir le planning'],
      ['planning.bowling', 'Gérer les pistes bowling'],
      ['planning.laser', 'Gérer les sessions Laser Game'],
      ['planning.drag', 'Déplacer les réservations'],
      ['planning.past', 'Modifier une date passée']
    ]
  },
  {
    id: 'reservations',
    title: 'Réservations',
    description: 'Création, correction et statuts terrain.',
    permissions: [
      ['reservations.view', 'Voir les réservations'],
      ['reservations.create', 'Créer une réservation'],
      ['reservations.edit', 'Modifier client, heure ou ressource'],
      ['reservations.cancel', 'Annuler ou supprimer'],
      ['reservations.status', 'Changer confirmé, arrivé, payé'],
      ['reservations.quick', 'Utiliser la réservation rapide']
    ]
  },
  {
    id: 'clients',
    title: 'Clients & caisse',
    description: 'Fiches clients, paiement et fichiers.',
    permissions: [
      ['clients.view', 'Voir les clients'],
      ['clients.edit', 'Modifier les fiches clients'],
      ['payments.view', 'Voir les montants'],
      ['payments.markPaid', 'Marquer payé'],
      ['exports.download', 'Télécharger les exports']
    ]
  },
  {
    id: 'communication',
    title: 'Communication',
    description: 'Emails, campagnes et relances.',
    permissions: [
      ['emails.view', 'Voir les emails'],
      ['emails.send', 'Envoyer ou relancer'],
      ['campaigns.manage', 'Créer des campagnes'],
      ['marketing.agents', 'Utiliser les agents marketing']
    ]
  },
  {
    id: 'administration',
    title: 'Administration',
    description: 'Réglages sensibles et sécurité.',
    permissions: [
      ['pricing.manage', 'Modifier tarifs et formules'],
      ['users.manage', 'Créer rôles et accès'],
      ['settings.manage', 'Changer les paramètres'],
      ['security.codes', 'Générer les codes d’accès'],
      ['ai.ops', 'Voir agents IA et logs Ops']
    ]
  }
];

const STAFF_ROLE_PRESETS = [
  {
    id: 'direction',
    name: 'Direction',
    code: 'DI',
    summary: 'Contrôle total multi-centres',
    description: 'Pour Rachel, Seb ou un administrateur responsable du produit.',
    tone: 'admin',
    permissions: STAFF_PERMISSION_GROUPS.flatMap(group => group.permissions.map(permission => permission[0]))
  },
  {
    id: 'manager',
    name: 'Manager',
    code: 'MA',
    summary: 'Opérations, clients et caisse',
    description: 'Pour gérer une journée complète sans toucher à la sécurité.',
    tone: 'manager',
    permissions: [
      'dashboard.view', 'planning.view', 'planning.bowling', 'planning.laser', 'planning.drag',
      'reservations.view', 'reservations.create', 'reservations.edit', 'reservations.status', 'reservations.quick',
      'clients.view', 'clients.edit', 'payments.view', 'payments.markPaid', 'exports.download',
      'emails.view'
    ]
  },
  {
    id: 'staff-bar',
    name: 'Staff bar',
    code: 'ST',
    summary: 'Accueil et rush terrain',
    description: 'Pour voir les arrivées, créer vite, encaisser et clôturer.',
    tone: 'staff',
    permissions: [
      'dashboard.view', 'planning.view', 'planning.bowling', 'planning.laser',
      'reservations.view', 'reservations.create', 'reservations.edit', 'reservations.status', 'reservations.quick',
      'clients.view', 'payments.view', 'payments.markPaid'
    ]
  },
  {
    id: 'marketing',
    name: 'Marketing',
    code: 'MK',
    summary: 'Campagnes et communication',
    description: 'Pour préparer les contenus, emails et audiences locales.',
    tone: 'marketing',
    permissions: [
      'dashboard.view', 'clients.view', 'emails.view', 'emails.send', 'campaigns.manage', 'marketing.agents',
      'reports.export'
    ]
  },
  // id ALIGNE sur lib/staff-auth.js : le bouton « preset » n'envoie que l'id et
  // c'est le SERVEUR qui applique les permissions. L'id local 'maintenance' ne
  // correspondait a rien la-bas -> « Preset introuvable » a chaque clic, sur
  // tous les roles. Le gate staff-role-presets-check verrouille l'alignement.
  {
    id: 'technique',
    name: 'Technique',
    code: 'TE',
    summary: 'Accès maintenance',
    description: 'Pour signaler une piste ou une session sans accès commercial.',
    tone: 'tech',
    permissions: [
      'dashboard.view', 'planning.view', 'planning.bowling', 'planning.laser', 'planning.drag',
      'reservations.view', 'settings.manage', 'ai.ops'
    ]
  }
];

function createStaffAccessCode(prefix = 'FG') {
  const safePrefix = String(prefix || 'FG').replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 4) || 'FG';
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  const day = new Date().getDate().toString().padStart(2, '0');
  return `${safePrefix}-${day}-${random}`;
}

function cloneStaffRolePreset(preset) {
  return {
    id: preset.id,
    name: preset.name,
    code: preset.code,
    summary: preset.summary,
    description: preset.description,
    tone: preset.tone,
    permissions: [...new Set(preset.permissions || [])],
    accessCode: createStaffAccessCode(preset.code),
    updatedAt: new Date().toISOString(),
    locked: preset.id === 'direction'
  };
}

// Un role PLATEFORME (proprietaire Pinlane : id 'platform-owner' ou permission
// platform.admin) est un acces de supervision produit, pas un role d'equipe du
// centre. La page Utilisateurs ne doit JAMAIS l'afficher, le compter ni le
// manipuler : ce serait un compteur absurde (30/29) et une fuite de l'acces
// proprietaire chez le client. Le serveur reste l'autorite ; ici on rend la
// page logique pour tous. On ne filtre QUE les roles plateforme, pas tous les
// roles verrouilles (Direction est un role legitime du centre).
function isPlatformStaffRole(role) {
  return Boolean(role && (role.id === 'platform-owner'
    || (Array.isArray(role.permissions) && role.permissions.includes('platform.admin'))));
}

function isPlatformStaffMember(access, member) {
  if (!member) return false;
  return isPlatformStaffRole((access?.roles || []).find(role => role.id === member.roleId));
}

function getVisibleStaffAccessRoles(access) {
  return (access?.roles || []).filter(role => !isPlatformStaffRole(role));
}

function getVisibleStaffAccessMembers(access) {
  return (access?.members || []).filter(member => !isPlatformStaffMember(access, member));
}

function ensureStaffAccessControl() {
  const current = state.staffAccessControl && typeof state.staffAccessControl === 'object'
    ? state.staffAccessControl
    : {};
  const presetRoles = STAFF_ROLE_PRESETS.map(cloneStaffRolePreset);
  const presetById = new Map(presetRoles.map(role => [role.id, role]));
  const serverRoles = (Array.isArray(current.roles) ? current.roles : []).filter(role => role && role.id);
  // LE SERVEUR FAIT AUTORITE sur la liste des roles. Les presets locaux sont un
  // repli de demarrage (premiere ouverture, hors ligne), PAS un complement.
  // Les fusionner par id ajoutait a la liste tout preset sans equivalent en
  // base : un role qui n'existe QUE dans le navigateur, impossible a supprimer,
  // renommer ou modifier puisque le serveur repond « Role introuvable ». C'est
  // ce qui faisait apparaitre deux « Technique » a Fun Galaxy, dont un
  // intouchable (preset 'maintenance', jamais cree en base).
  const roles = serverRoles.length
    ? serverRoles.map(role => {
      const preset = presetById.get(role.id);
      return {
        ...(preset || {}),
        ...role,
        permissions: Array.isArray(role.permissions) ? [...new Set(role.permissions)] : (preset?.permissions || []),
        accessCode: role.accessCode || createStaffAccessCode(role.code || role.name || 'FG'),
        updatedAt: role.updatedAt || new Date().toISOString()
      };
    })
    : presetRoles;
  // Resolution SURE de la selection : jamais un role plateforme, et la
  // selection courante est gardee tant qu'elle reste valide. A defaut, le
  // premier role visible du centre (l'ordre commence par les presets), sinon
  // 'direction'. L'ancien repli en dur sur 'manager' teleportait la selection
  // apres chaque rafraichissement serveur.
  const visibleRoles = roles.filter(role => !isPlatformStaffRole(role));
  const selectedRoleId = visibleRoles.some(role => role.id === current.selectedRoleId)
    ? current.selectedRoleId
    : ((visibleRoles[0] && visibleRoles[0].id) || 'direction');
  state.staffAccessControl = {
    selectedRoleId,
    selectedMemberId: current.selectedMemberId || 'admin-local',
    roles,
    members: Array.isArray(current.members) && current.members.length ? current.members : [
      {
        id: 'admin-local',
        name: 'Poste direction',
        contact: 'Accès local sécurisé',
        roleId: 'direction',
        status: 'active',
        code: 'pinlane-owner-demo-code',
        lastSeen: new Date().toISOString()
      }
    ],
    events: Array.isArray(current.events) ? current.events.slice(0, 12) : []
  };
  return state.staffAccessControl;
}

function getStaffPermissionKeys() {
  return STAFF_PERMISSION_GROUPS.flatMap(group => group.permissions.map(permission => permission[0]));
}

function getStaffAccessRole(roleId) {
  const access = ensureStaffAccessControl();
  return access.roles.find(role => role.id === roleId) || access.roles.find(role => role.id === access.selectedRoleId) || access.roles[0];
}

function getStaffRolePermissionSet(roleId) {
  const role = getStaffAccessRole(roleId);
  return new Set(Array.isArray(role?.permissions) ? role.permissions : []);
}

function staffRoleHasPermission(roleId, permission) {
  return getStaffRolePermissionSet(roleId).has(permission);
}

function logStaffAccessEvent(label) {
  const access = ensureStaffAccessControl();
  access.events.unshift({ id: Date.now(), label, at: new Date().toISOString() });
  access.events = access.events.slice(0, 14);
}

function renderStaffAccessAfterChange(message = 'Accès mis à jour.') {
  save();
  renderStaffUtilityPage();
  try { syncStaffMenuState(); } catch (error) {}
  toast(message);
}

async function runStaffAuthAction(action, payload = {}, successMessage = 'Accès mis à jour.') {
  if (!canUseStaffPermission('users.manage')) {
    toast('Gestion des accès réservée à la direction.');
    return null;
  }
  try {
    const response = await apiRequest(API_ENDPOINTS.staffAuth, {
      method: 'POST',
      body: JSON.stringify({
        action,
        centerId: getCurrentStaffCenterId(),
        ...payload
      })
    });
    if (response.session) storeStaffAuthSession(response.session);
    if (response.accessControl) {
      // selectedRoleId / selectedMemberId sont un etat purement UI, jamais
      // renvoye par le serveur : remplacer l'objet sans les reporter faisait
      // retomber ensureStaffAccessControl sur son defaut apres CHAQUE action
      // (editer une permission de "Technique" sautait sur "Manager"). On les
      // re-applique s'ils existent toujours dans la reponse, sans jamais
      // reprendre un role plateforme.
      const previousRoleId = state.staffAccessControl?.selectedRoleId;
      const previousMemberId = state.staffAccessControl?.selectedMemberId;
      state.staffAccessControl = response.accessControl;
      const nextRoles = Array.isArray(response.accessControl.roles) ? response.accessControl.roles : [];
      if (previousRoleId && nextRoles.some(role => role.id === previousRoleId && !isPlatformStaffRole(role))) {
        state.staffAccessControl.selectedRoleId = previousRoleId;
      }
      const nextMembers = Array.isArray(response.accessControl.members) ? response.accessControl.members : [];
      if (previousMemberId && nextMembers.some(member => member.id === previousMemberId)) {
        state.staffAccessControl.selectedMemberId = previousMemberId;
      }
    }
    if (response.createdRole?.id && state.staffAccessControl) state.staffAccessControl.selectedRoleId = response.createdRole.id;
    if (response.createdMember?.id && state.staffAccessControl) state.staffAccessControl.selectedMemberId = response.createdMember.id;
    save();
    renderStaffUtilityPage();
    try { syncStaffMenuState(); } catch (error) {}
    if (response.newAccessCode) {
      copyStaffAccessCode(response.newAccessCode, { silent: true });
      toast(`${successMessage} Code copié.`);
    } else {
      toast(successMessage);
    }
    return response;
  } catch (error) {
    await loadStaffAuthSession({ silent: true });
    renderStaffUtilityPage();
    toast(error.message || 'Action accès impossible.');
    return null;
  }
}

function setStaffAccessSelectedRole(roleId) {
  const access = ensureStaffAccessControl();
  const role = access.roles.find(item => item.id === roleId);
  if (!role || isPlatformStaffRole(role)) return;
  access.selectedRoleId = roleId;
  save();
  renderStaffUtilityPage();
}

async function toggleStaffRolePermission(roleId, permission, checked) {
  const role = getStaffAccessRole(roleId);
  if (isPlatformStaffRole(role)) {
    toast('Cet accès plateforme ne se gère pas depuis cette page.');
    renderStaffUtilityPage();
    return;
  }
  if (!role || role.id === 'direction') {
    toast('La direction garde toujours tous les accès.');
    renderStaffUtilityPage();
    return;
  }
  const allKeys = new Set(getStaffPermissionKeys());
  if (!allKeys.has(permission)) return;
  const permissions = new Set(role.permissions || []);
  if (checked) permissions.add(permission);
  else permissions.delete(permission);
  role.permissions = [...permissions];
  await runStaffAuthAction('updateRolePermissions', {
    roleId,
    permissions: [...permissions]
  }, 'Permission enregistrée.');
}

async function setStaffRolePreset(roleId, presetId) {
  const role = getStaffAccessRole(roleId);
  const preset = STAFF_ROLE_PRESETS.find(item => item.id === presetId);
  if (!role || !preset || role.id === 'direction' || isPlatformStaffRole(role)) return;
  await runStaffAuthAction('setRolePreset', { roleId, presetId }, 'Preset appliqué.');
}

// A10 : mémorise le bouton déclencheur pour lui rendre le focus au close
// (Échap, Annuler, clic backdrop ou submit) au lieu de retomber sur <body>.
let staffAccessModalTrigger = null;

function closeStaffAccessModal() {
  const overlay = document.getElementById('staffAccessModalOverlay');
  if (overlay) overlay.remove();
  document.removeEventListener('keydown', handleStaffAccessModalKeydown, true);
  if (staffAccessModalTrigger && document.contains(staffAccessModalTrigger)) {
    staffAccessModalTrigger.focus({ preventScroll: true });
  }
  staffAccessModalTrigger = null;
}

function handleStaffAccessModalKeydown(event) {
  if (event.key !== 'Escape') return;
  event.stopPropagation();
  closeStaffAccessModal();
}

function openStaffAccessModal(kind) {
  closeStaffAccessModal();
  staffAccessModalTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const access = ensureStaffAccessControl();
  const selectedRole = getStaffAccessRole(access.selectedRoleId);
  const isRole = kind === 'role';
  // Roles assignables a un membre = roles NON verrouilles (comme founder-team)
  // et JAMAIS un role plateforme : un role systeme verrouille (Direction,
  // proprietaire plateforme) n'est jamais offert a la creation. Defaut = role
  // du rail s'il est assignable, sinon le premier assignable.
  const assignableRoles = access.roles.filter(role => !role.locked && !isPlatformStaffRole(role));
  const defaultRoleId = assignableRoles.some(role => role.id === access.selectedRoleId)
    ? access.selectedRoleId
    : (assignableRoles[0] && assignableRoles[0].id) || '';
  const overlay = document.createElement('div');
  overlay.id = 'staffAccessModalOverlay';
  overlay.className = 'overlay-backdrop staff-access-modal-overlay';
  overlay.innerHTML = `
    <form class="modal-surface staff-access-modal" role="dialog" aria-modal="true" aria-labelledby="staffAccessModalTitle" onsubmit="submitStaffAccessModal(event, '${isRole ? 'role' : 'member'}')">
      <div>
        <h3 id="staffAccessModalTitle">${isRole ? 'Créer un rôle' : 'Créer un accès staff'}</h3>
        <p>${isRole
          ? 'Le rôle démarre avec Dashboard et Réservations, puis s’affine permission par permission.'
          : 'Choisissez le rôle du membre ; il reçoit un code d’accès personnel.'}</p>
      </div>
      <div class="field">
        <label for="staffAccessModalName">${isRole ? 'Nom du rôle' : 'Nom du membre'}</label>
        <input id="staffAccessModalName" type="text" required autocomplete="off" placeholder="${isRole ? 'Ex : Responsable anniversaires' : 'Ex : Camille Dupont'}">
      </div>
      ${isRole ? '' : `<div class="field">
        <label for="staffAccessModalContact">Contact : email, téléphone ou identifiant interne</label>
        <input id="staffAccessModalContact" type="text" autocomplete="off" placeholder="Ex : camille@votre-centre.be">
      </div>
      <div class="field">
        <label for="staffAccessModalRole">Rôle attribué</label>
        <select id="staffAccessModalRole">${assignableRoles.length
          ? assignableRoles.map(role => `<option value="${escapeHtml(role.id)}" ${role.id === defaultRoleId ? 'selected' : ''}>${escapeHtml(role.name)}</option>`).join('')
          : '<option value="">Aucun rôle assignable</option>'}</select>
      </div>`}
      <div class="staff-access-modal-actions">
        <button type="button" class="btn btn-ghost" onclick="closeStaffAccessModal()">Annuler</button>
        <button type="submit" class="btn btn-primary">${isRole ? 'Créer le rôle' : 'Créer l’accès'}</button>
      </div>
    </form>`;
  overlay.addEventListener('mousedown', event => {
    if (event.target === overlay) closeStaffAccessModal();
  });
  document.addEventListener('keydown', handleStaffAccessModalKeydown, true);
  document.body.appendChild(overlay);
  overlay.querySelector('#staffAccessModalName')?.focus({ preventScroll: true });
}

async function submitStaffAccessModal(event, kind) {
  event.preventDefault();
  const name = String(document.getElementById('staffAccessModalName')?.value || '').trim();
  if (!name) return;
  const contact = String(document.getElementById('staffAccessModalContact')?.value || '').trim();
  // Le role choisi doit etre lu AVANT la fermeture : closeStaffAccessModal
  // retire l'overlay du DOM.
  const chosenRoleId = String(document.getElementById('staffAccessModalRole')?.value || '').trim();
  closeStaffAccessModal();
  if (kind === 'role') {
    await runStaffAuthAction('createRole', {
      name,
      permissions: ['dashboard.view', 'reservations.view']
    }, 'Rôle créé.');
    return;
  }
  const access = ensureStaffAccessControl();
  const assignableRoles = access.roles.filter(role => !role.locked && !isPlatformStaffRole(role));
  const roleId = assignableRoles.some(role => role.id === chosenRoleId)
    ? chosenRoleId
    : (assignableRoles[0] && assignableRoles[0].id) || '';
  if (!roleId) { toast('Aucun rôle assignable disponible.'); return; }
  await runStaffAuthAction('createMember', {
    name,
    contact,
    roleId
  }, 'Accès staff créé.');
}

function createStaffCustomRole() {
  openStaffAccessModal('role');
}

function createStaffMember() {
  openStaffAccessModal('member');
}

async function updateStaffMemberRole(memberId, roleId) {
  const access = ensureStaffAccessControl();
  const member = access.members.find(item => item.id === memberId);
  const targetRole = access.roles.find(role => role.id === roleId);
  if (!member || !targetRole) return;
  // Defense en profondeur : un acces plateforme n'est ni une cible ni une
  // destination valide depuis la page centre, meme en appel direct.
  if (isPlatformStaffMember(access, member) || isPlatformStaffRole(targetRole)) {
    toast('Cet accès plateforme ne se gère pas depuis cette page.');
    return;
  }
  await runStaffAuthAction('updateMemberRole', { memberId, roleId }, 'Rôle du membre mis à jour.');
}

function getStaffSessionMemberId() {
  return (state.staffAuthSession && state.staffAuthSession.member && state.staffAuthSession.member.id) || '';
}

async function toggleStaffMemberStatus(memberId) {
  const access = ensureStaffAccessControl();
  const member = access.members.find(item => item.id === memberId);
  if (!member) return;
  // Defense en profondeur : l'acces proprietaire plateforme n'est jamais
  // blocable depuis la page centre, meme en appel direct.
  if (isPlatformStaffMember(access, member)) {
    toast('Cet accès plateforme ne peut pas être bloqué depuis le centre.');
    return;
  }
  // Reflet UI de la garde anti-lockout G2 (le serveur reste l'autorite) : on ne
  // se bloque pas soi-meme.
  if (memberId === getStaffSessionMemberId() && member.status === 'active') {
    toast('Vous ne pouvez pas bloquer votre propre acces.');
    return;
  }
  await runStaffAuthAction('toggleMemberStatus', { memberId }, member.status === 'blocked' ? 'Accès activé.' : 'Accès bloqué.');
}

async function renameStaffRole(roleId) {
  const role = getStaffAccessRole(roleId);
  if (!role) return;
  if (role.locked || isPlatformStaffRole(role)) { toast('Ce role systeme ne peut pas etre renomme.'); return; }
  const next = window.prompt('Nouveau nom du role', role.name || '');
  if (next === null) return;
  const name = String(next).trim();
  if (!name || name === role.name) return;
  await runStaffAuthAction('renameRole', { roleId, name }, 'Role renomme.');
}

async function deleteStaffRole(roleId) {
  const role = getStaffAccessRole(roleId);
  if (!role) return;
  if (role.locked || isPlatformStaffRole(role)) { toast('Ce role systeme ne peut pas etre supprime.'); return; }
  const access = ensureStaffAccessControl();
  const memberCount = access.members.filter(item => item.roleId === roleId).length;
  if (memberCount > 0) {
    toast(`Reassignez d'abord les ${memberCount} membre(s) de ce role avant de le supprimer.`);
    return;
  }
  if (!window.confirm(`Supprimer le role "${role.name}" ? Cette action est definitive.`)) return;
  await runStaffAuthAction('deleteRole', { roleId }, 'Role supprime.');
}

async function deleteStaffMember(memberId) {
  const access = ensureStaffAccessControl();
  const member = access.members.find(item => item.id === memberId);
  if (!member) return;
  // Defense en profondeur : l'acces proprietaire plateforme n'est jamais
  // supprimable depuis la page centre, meme en appel direct.
  if (isPlatformStaffMember(access, member)) {
    toast('Cet accès plateforme ne peut pas être supprimé depuis le centre.');
    return;
  }
  // Reflet UI de la garde G2 : pas d'auto-suppression (le serveur refuse aussi).
  if (memberId === getStaffSessionMemberId()) {
    toast('Vous ne pouvez pas supprimer votre propre acces.');
    return;
  }
  if (!window.confirm(`Supprimer definitivement l'acces de ${member.name} ? Ses sessions seront revoquees.`)) return;
  await runStaffAuthAction('deleteMember', { memberId }, 'Acces supprime.');
}

async function regenerateStaffAccessCode(roleId) {
  const role = getStaffAccessRole(roleId);
  if (!role) return;
  if (isPlatformStaffRole(role)) { toast('Cet accès plateforme ne se gère pas depuis cette page.'); return; }
  await runStaffAuthAction('regenerateRoleCode', { roleId }, 'Nouveau code généré.');
}

function copyStaffAccessCode(value, options = {}) {
  const code = String(value || '').trim();
  if (!code) return;
  if (code.includes('••') || code.includes('\u00e2\u20ac\u00a2')) {
    if (!options.silent) toast('Régénère le code pour obtenir une copie complète.');
    return;
  }
  navigator.clipboard?.writeText(code)
    .then(() => { if (!options.silent) toast('Code copié.'); })
    .catch(() => { if (!options.silent) toast(code); });
}

// Copie le code d'accès ACTUEL en le révélant via le serveur (déchiffrement),
// sans le régénérer. Gated à users.manage côté serveur ET côté client.
async function copyStaffRoleCode(roleId) {
  if (!canUseStaffPermission('users.manage')) { toast('Copie du code réservée à la direction.'); return; }
  const role = getStaffAccessRole(roleId);
  if (!role) return;
  if (isPlatformStaffRole(role)) { toast('Cet accès plateforme ne se gère pas depuis cette page.'); return; }
  try {
    const response = await apiRequest(API_ENDPOINTS.staffAuth, {
      method: 'POST',
      body: JSON.stringify({ action: 'revealRoleCode', centerId: getCurrentStaffCenterId(), roleId })
    });
    if (!response || response.needsRegenerate || !response.revealedCode) {
      toast('Régénère le code pour activer la copie.');
      return;
    }
    copyStaffAccessCode(response.revealedCode);
  } catch (error) {
    toast(error.message || 'Copie du code impossible.');
  }
}

async function copyStaffMemberCode(memberId) {
  if (!canUseStaffPermission('users.manage')) { toast('Copie du code réservée à la direction.'); return; }
  const access = ensureStaffAccessControl();
  const member = access.members.find(item => item.id === memberId);
  if (!member) return;
  try {
    const response = await apiRequest(API_ENDPOINTS.staffAuth, {
      method: 'POST',
      body: JSON.stringify({ action: 'revealMemberCode', centerId: getCurrentStaffCenterId(), memberId })
    });
    if (!response || response.needsRegenerate || !response.revealedCode) {
      toast('Régénère l’accès pour activer la copie.');
      return;
    }
    copyStaffAccessCode(response.revealedCode);
  } catch (error) {
    toast(error.message || 'Copie du code impossible.');
  }
}

function getStaffRoleAccessiblePages(roleId) {
  const permissions = getStaffRolePermissionSet(roleId);
  const pages = [
    ['Dashboard', 'dashboard.view'],
    ['Planning', 'planning.view'],
    ['Réservations', 'reservations.view'],
    ['Clients', 'clients.view'],
    ['Tarifs', 'pricing.manage'],
    ['Emails', 'emails.view'],
    ['Campagnes', 'campaigns.manage'],
    ['Direction', 'direction.view'],
    ['Utilisateurs', 'users.manage']
  ];
  return pages.map(([label, permission]) => ({ label, permission, allowed: permissions.has(permission) }));
}

const staffPermissionGroupOpenState = {};
let staffAccessCodeRevealed = false;

function toggleStaffAccessCodeVisibility() {
  staffAccessCodeRevealed = !staffAccessCodeRevealed;
  renderStaffUtilityPage();
}

function maskStaffAccessCode(code) {
  return String(code || '')
    .split('-')
    .map((part, index) => (index === 0 ? part : '•'.repeat(Math.max(part.length, 2))))
    .join('-');
}

const STAFF_MEMBER_STATUS_META = {
  active: ['Actif', 'badge-success'],
  blocked: ['Bloqué', 'badge-danger'],
  pending: ['En attente', 'badge-warning']
};

function renderStaffMemberCard(access, member) {
  const role = getStaffAccessRole(member.roleId);
  const [statusLabel, statusBadge] = STAFF_MEMBER_STATUS_META[member.status] || ['Statut inconnu', 'badge-neutral'];
  const lastSeenLabel = member.lastSeen ? `Vu ${formatOpsTimestamp(member.lastSeen)}` : 'Jamais connecté';
  const isSelf = member.id === getStaffSessionMemberId();
  // Reassignation : mêmes règles que la page fondateur. Les rôles verrouillés
  // (Direction) et les rôles plateforme ne sont jamais proposés ; si le membre
  // en porte un, il reste visible en option sélectionnée désactivée, non
  // réassignable à la volée.
  const assignableRoles = access.roles.filter(roleOption => !roleOption.locked && !isPlatformStaffRole(roleOption));
  const currentRoleLocked = !assignableRoles.some(roleOption => roleOption.id === member.roleId);
  const currentRoleName = (getStaffAccessRole(member.roleId) || {}).name || 'rôle verrouillé';
  const memberRoleOptions = (currentRoleLocked
    ? `<option value="${escapeHtml(member.roleId)}" selected disabled>${escapeHtml(currentRoleName)}</option>`
    : '')
    + assignableRoles.map(roleOption => `<option value="${escapeHtml(roleOption.id)}" ${!currentRoleLocked && roleOption.id === member.roleId ? 'selected' : ''}>${escapeHtml(roleOption.name)}</option>`).join('');
  return `<article class="staff-member-card ${escapeHtml(member.status || 'active')}">
    <div class="staff-member-top">
      <span class="staff-person-icon tone-${escapeHtml(role.tone || 'custom')}">${escapeHtml(getStaffClientInitials(member.name || role.name))}</span>
      <div><strong>${escapeHtml(member.name)}</strong><small>${escapeHtml(member.contact || member.code || 'Code interne')}</small></div>
      <span class="badge ${statusBadge}">${statusLabel}</span>
    </div>
    <span class="staff-member-last-seen">${escapeHtml(lastSeenLabel)}</span>
    <select aria-label="Rôle de ${escapeHtml(member.name)}" ${currentRoleLocked ? 'disabled' : ''} onchange='updateStaffMemberRole(${staffClientJs(member.id)}, this.value)'>
      ${memberRoleOptions}
    </select>
    <footer>
      <button type="button" class="btn btn-secondary btn-sm staff-member-code" onclick='copyStaffMemberCode(${staffClientJs(member.id)})'>${escapeHtml(member.code || 'Copier code')}</button>
      <button type="button" class="btn btn-ghost btn-sm" ${isSelf ? 'disabled title="Vous ne pouvez pas bloquer votre propre acces"' : ''} onclick='toggleStaffMemberStatus(${staffClientJs(member.id)})'>${member.status === 'active' ? 'Bloquer' : 'Activer'}</button>
      ${isSelf ? '' : `<button type="button" class="btn btn-ghost btn-sm staff-danger-btn" onclick='deleteStaffMember(${staffClientJs(member.id)})'>Supprimer</button>`}
    </footer>
  </article>`;
}

// Liste des membres groupee par contexte : d'abord ceux du role selectionne
// (le panneau de droite eclaire le role en cours d'edition), puis les autres.
// Toutes les actions restent disponibles pour chaque carte.
function renderStaffMemberListSections(access, visibleMembers, selectedRole) {
  if (!visibleMembers.length) {
    return `<div class="staff-member-empty">
      <strong>Aucun membre</strong>
      <span>Créez un accès staff : chaque membre reçoit un code personnel.</span>
    </div>`;
  }
  const selectedRoleMembers = visibleMembers.filter(member => member.roleId === selectedRole.id);
  const otherMembers = visibleMembers.filter(member => member.roleId !== selectedRole.id);
  const selectedBlock = `<span class="staff-member-group-label">${escapeHtml(selectedRole.name)}<em>${selectedRoleMembers.length}</em></span>`
    + (selectedRoleMembers.length
      ? selectedRoleMembers.map(member => renderStaffMemberCard(access, member)).join('')
      : '<p class="staff-member-group-empty">Aucun membre sur ce rôle.</p>');
  const othersBlock = otherMembers.length
    ? `<span class="staff-member-group-label">Autres rôles<em>${otherMembers.length}</em></span>`
      + otherMembers.map(member => renderStaffMemberCard(access, member)).join('')
    : '';
  return `<div class="staff-member-list">${selectedBlock}${othersBlock}</div>`;
}

function renderStaffUtilityUsers() {
  const access = ensureStaffAccessControl();
  // La page ne montre QUE l'equipe du centre : les roles/membres plateforme
  // (proprietaire Pinlane) sont exclus de tout affichage et de tout compteur.
  const visibleRoles = getVisibleStaffAccessRoles(access);
  const visibleMembers = getVisibleStaffAccessMembers(access);
  const selectedRole = getStaffAccessRole(access.selectedRoleId);
  const selectedPermissions = getStaffRolePermissionSet(selectedRole.id);
  const allPermissions = getStaffPermissionKeys();
  const activeMembers = visibleMembers.filter(member => member.status === 'active');
  const accessiblePages = getStaffRoleAccessiblePages(selectedRole.id);
  const openPagesCount = accessiblePages.filter(page => page.allowed).length;
  const rawAccessCode = String(selectedRole.accessCode || '');
  const codeAlreadyMasked = rawAccessCode.includes('••');
  const displayedCode = rawAccessCode
    ? (staffAccessCodeRevealed || codeAlreadyMasked ? rawAccessCode : maskStaffAccessCode(rawAccessCode))
    : 'À générer';
  return `<div class="staff-access-console">
    <section class="staff-access-grid">
      <aside class="staff-role-rail" aria-label="Rôles staff">
        <div class="staff-role-rail-head">
          <strong>Rôles du centre</strong>
          <em>${visibleRoles.length}</em>
        </div>
        ${visibleRoles.map(role => {
          const count = (role.permissions || []).length;
          const activeCount = visibleMembers.filter(member => member.roleId === role.id && member.status === 'active').length;
          return `<button type="button" class="staff-role-pill ${role.id === selectedRole.id ? 'active' : ''} tone-${escapeHtml(role.tone || 'custom')}" onclick='setStaffAccessSelectedRole(${staffClientJs(role.id)})' ${role.id === selectedRole.id ? 'aria-current="true"' : ''}>
            <span class="staff-person-icon" aria-hidden="true">${escapeHtml(role.code || role.name.slice(0, 2).toUpperCase())}</span>
            <span class="staff-role-pill-copy">
              <strong>${escapeHtml(role.name)}</strong>
              <small>${escapeHtml(role.summary || 'Rôle personnalisé')}</small>
            </span>
            <span class="staff-role-pill-meta">
              <em>${count}/${allPermissions.length}</em>
              <b>${activeCount} actif${activeCount > 1 ? 's' : ''}</b>
            </span>
          </button>`;
        }).join('')}
      </aside>

      <section class="staff-permission-editor">
        <div class="staff-permission-head">
          <div class="staff-role-identity">
            <span class="staff-person-portrait tone-${escapeHtml(selectedRole.tone || 'custom')}">${escapeHtml(selectedRole.code || selectedRole.name.slice(0, 2).toUpperCase())}</span>
            <div>
              <span>Rôle sélectionné</span>
              <h3>${escapeHtml(selectedRole.name)}</h3>
              <p>${escapeHtml(selectedRole.description || selectedRole.summary || '')}</p>
              ${selectedRole.locked ? '' : `<div class="staff-role-admin-actions">
                <button type="button" class="btn btn-ghost btn-sm" onclick='renameStaffRole(${staffClientJs(selectedRole.id)})'>Renommer</button>
                <button type="button" class="btn btn-ghost btn-sm staff-danger-btn" onclick='deleteStaffRole(${staffClientJs(selectedRole.id)})'>Supprimer le rôle</button>
              </div>`}
            </div>
          </div>
          <div class="staff-code-card">
            <span>Code d’accès rôle</span>
            <strong>${escapeHtml(displayedCode)}</strong>
            <div>
              ${rawAccessCode && !codeAlreadyMasked ? `<button type="button" class="btn btn-secondary btn-sm" aria-pressed="${staffAccessCodeRevealed ? 'true' : 'false'}" onclick="toggleStaffAccessCodeVisibility()">${staffAccessCodeRevealed ? 'Masquer' : 'Afficher'}</button>` : ''}
              <button type="button" class="btn btn-secondary btn-sm" onclick='copyStaffRoleCode(${staffClientJs(selectedRole.id)})'>Copier</button>
              <button type="button" class="btn btn-secondary btn-sm" onclick='regenerateStaffAccessCode(${staffClientJs(selectedRole.id)})'>Régénérer</button>
            </div>
            ${rawAccessCode && selectedRole.codeCopyReady === false ? '<small class="staff-code-hint">Régénérer pour activer la copie.</small>' : ''}
          </div>
        </div>

        <div class="staff-preset-strip">
          <span class="staff-preset-kicker">Appliquer un preset</span>
          ${STAFF_ROLE_PRESETS.map(preset => `<button type="button" class="staff-preset-btn" ${selectedRole.id === 'direction' ? 'disabled' : ''} onclick='setStaffRolePreset(${staffClientJs(selectedRole.id)}, ${staffClientJs(preset.id)})'>
            ${escapeHtml(preset.name)}
          </button>`).join('')}
        </div>

        <div class="staff-permission-groups">
          ${STAFF_PERMISSION_GROUPS.map((group, groupIndex) => {
            const grantedCount = group.permissions.filter(permission => selectedPermissions.has(permission[0])).length;
            const isOpen = staffPermissionGroupOpenState[group.id] ?? groupIndex < 2;
            return `<details class="staff-permission-group" ${isOpen ? 'open' : ''} ontoggle='staffPermissionGroupOpenState[${staffClientJs(group.id)}] = this.open'>
            <summary class="staff-permission-group-head">
              <div><strong>${escapeHtml(group.title)}</strong><span>${escapeHtml(group.description)}</span></div>
              <em>${grantedCount}/${group.permissions.length}</em>
            </summary>
            <div class="staff-permission-list">
              ${group.permissions.map(([key, label]) => {
                const checked = selectedPermissions.has(key);
                return `<label class="staff-permission-toggle ${checked ? 'is-on' : ''}">
                  <input type="checkbox" class="visually-hidden" ${checked ? 'checked' : ''} ${selectedRole.id === 'direction' ? 'disabled' : ''} onchange='toggleStaffRolePermission(${staffClientJs(selectedRole.id)}, ${staffClientJs(key)}, this.checked)'>
                  <span class="staff-toggle-track" aria-hidden="true"></span>
                  <b>${escapeHtml(label)}</b>
                  <small>${checked ? 'Autorisé' : 'Bloqué'}</small>
                </label>`;
              }).join('')}
            </div>
          </details>`;
          }).join('')}
        </div>
      </section>

      <aside class="staff-access-side">
        <section class="staff-access-summary">
          <div class="staff-access-summary-head">
            <span>Ce rôle ouvre</span>
            <em>${openPagesCount}/${accessiblePages.length}</em>
          </div>
          <div class="staff-access-page-list">
            ${accessiblePages.map(page => `<span class="${page.allowed ? 'allowed' : 'blocked'}">${escapeHtml(page.label)}</span>`).join('')}
          </div>
        </section>
        <section class="staff-member-panel">
          <div class="staff-member-head">
            <div><strong>Membres</strong><small>${activeMembers.length} actif${activeMembers.length > 1 ? 's' : ''} · ${visibleMembers.length} total</small></div>
            <button type="button" class="btn btn-secondary btn-sm" onclick="createStaffMember()">Ajouter</button>
          </div>
          ${renderStaffMemberListSections(access, visibleMembers, selectedRole)}
        </section>
        <section class="staff-access-log">
          <strong>Journal sécurité</strong>
          ${(access.events.length ? access.events : [{ label: 'Aucun changement récent.', at: '' }]).slice(0, 5).map(event => `<p><span>${escapeHtml(event.at ? formatOpsTimestamp(event.at) : 'Maintenant')}</span>${escapeHtml(event.label)}</p>`).join('')}
        </section>
      </aside>
    </section>
  </div>`;
}

// ===========================================================================
// Blocages de disponibilite (page Etablissement, permission settings.manage).
// Le centre est celui de la SESSION : le serveur le force, on ne l'envoie
// jamais dans le corps. Lecture via listAvailabilityBlocks, ecritures via
// saveAvailabilityBlock / deleteAvailabilityBlock (meme apiRequest que la
// config centre). Le planning consomme le meme cache pour marquer, en lecture
// seule, les ressources bloquees le jour affiche.
// ===========================================================================
let availabilityBlocksCache = { loaded: false, loading: false, error: '', blocks: [] };
const AVAILABILITY_DAY_NAMES = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

function getAvailabilitySessionCenter() {
  const centers = staffCenterConfigCache.centers || [];
  const id = getCurrentStaffCenterId();
  return centers.find(center => center.id === id) || centers[0] || null;
}

function getAvailabilityLaneCount() {
  const center = getAvailabilitySessionCenter();
  const count = Number(center?.resources?.bowling?.laneCount || 0);
  return Number.isFinite(count) && count > 0 ? Math.min(Math.trunc(count), 200) : TOTAL_LANES;
}

// Capacite laser (armes par lancement) du centre affiche, depuis la config staff
// chargee. Fallback sur la constante historique si la config est absente. Sert au
// planning laser pour ne plus afficher 30 armes en dur quand le centre en a moins.
function getAvailabilityLaserCapacity() {
  const center = getAvailabilitySessionCenter();
  const count = Number(center?.resources?.laser?.weaponCount || 0);
  return Number.isFinite(count) && count > 0 ? Math.min(Math.trunc(count), 200) : LASER_GAME_MAX_PLAYERS;
}

// Declenche (au plus une fois) le chargement de la config centre pour que le
// planning reflete la vraie capacite. Idempotent et sans risque : loadStaffCenterConfig
// s'auto-garde (deja charge / en cours / permission) et ne fait AUCUNE requete pour
// un staff sans droit de configuration (repli silencieux sur les constantes). Le
// prochain re-render du polling reprend la config une fois chargee.
function ensureStaffCenterConfigForPlanning() {
  if (!staffCenterConfigCache.loaded && !staffCenterConfigCache.loading) {
    loadStaffCenterConfig(false);
  }
}

function getAvailabilityActivities() {
  const center = getAvailabilitySessionCenter();
  const all = staffCenterConfigCache.activities || [];
  const enabled = all.filter(activity => center?.activityAvailability?.[activity.id]);
  return enabled.length ? enabled : all;
}

function availabilityActivityLabel(id) {
  const found = (staffCenterConfigCache.activities || []).find(activity => activity.id === id);
  return found ? found.label : String(id || '');
}

function availabilityFormulaLabel(id) {
  const found = FORMULES.find(formule => formule.id === id);
  return found ? found.name : String(id || '');
}

// La liste serveur renvoie startMin/endMin (minutes, ou null pour jour entier).
// On tolere aussi startTime/endTime au cas ou la forme evoluerait.
function availabilityBlockStartMin(block) {
  if (typeof block.startMin === 'number') return block.startMin;
  if (block.startTime) { const [h, m] = String(block.startTime).split(':').map(Number); return (h * 60) + (m || 0); }
  return null;
}

function availabilityBlockEndMin(block) {
  if (typeof block.endMin === 'number') return block.endMin;
  if (block.endTime) { const [h, m] = String(block.endTime).split(':').map(Number); return (h * 60) + (m || 0); }
  return null;
}

function availabilityMinutesToHHMM(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function availabilityScopeText(block) {
  if (block.scopeType === 'center') return 'Centre ferme';
  if (block.scopeType === 'lane') return `Piste ${block.scopeRef} bloquee`;
  if (block.scopeType === 'activity') return `${availabilityActivityLabel(block.scopeRef)} bloque`;
  if (block.scopeType === 'formula') return `${availabilityFormulaLabel(block.scopeRef)} bloquee`;
  return 'Blocage';
}

function availabilityRecurrenceText(block) {
  if (block.recurrence === 'weekly') {
    const name = AVAILABILITY_DAY_NAMES[Number(block.dayOfWeek)] || 'jour inconnu';
    let text = `tous les ${name}s`;
    if (block.dateFrom && block.dateUntil) text += ` (du ${block.dateFrom} au ${block.dateUntil})`;
    else if (block.dateFrom) text += ` (a partir du ${block.dateFrom})`;
    else if (block.dateUntil) text += ` (jusqu'au ${block.dateUntil})`;
    return text;
  }
  return `le ${block.date || ''}`.trim();
}

function availabilityTimeText(block) {
  const start = availabilityBlockStartMin(block);
  const end = availabilityBlockEndMin(block);
  if (start === null && end === null) return '(toute la journee)';
  if (start === null || end === null) return '';
  return `${availabilityMinutesToHHMM(start)}-${availabilityMinutesToHHMM(end)}`;
}

// Libelle humain : "Piste 3 bloquee tous les mardis 14:00-16:00",
// "Centre ferme le 2026-08-15 (toute la journee)", etc.
function describeAvailabilityBlock(block) {
  const parts = [availabilityScopeText(block), availabilityRecurrenceText(block), availabilityTimeText(block)].filter(Boolean);
  let label = parts.join(' ');
  if (block.reason) label += ` - motif : ${block.reason}`;
  return label;
}

async function loadAvailabilityBlocks(force = false) {
  if (availabilityBlocksCache.loading) return;
  if (availabilityBlocksCache.loaded && !force) return;
  if (!canUseStaffPermission('settings.manage')) return;
  availabilityBlocksCache.loading = true;
  if (force) availabilityBlocksCache.error = '';
  try {
    const centerId = getCurrentStaffCenterId();
    const response = await apiRequest(`${API_ENDPOINTS.ops}?action=listAvailabilityBlocks&centerId=${encodeURIComponent(centerId)}`);
    availabilityBlocksCache = {
      loaded: true,
      loading: false,
      error: '',
      blocks: Array.isArray(response.blocks) ? response.blocks : []
    };
  } catch (error) {
    availabilityBlocksCache.loading = false;
    availabilityBlocksCache.loaded = true;
    availabilityBlocksCache.error = error?.message || 'Lecture des blocages impossible.';
  }
  refreshAvailabilityBlocksUi();
}

// Charge une seule fois pour le planning (center-wide, filtre client par date).
function ensureAvailabilityBlocksForPlanning() {
  if (!canUseStaffPermission('settings.manage')) return;
  if (availabilityBlocksCache.loaded || availabilityBlocksCache.loading) return;
  loadAvailabilityBlocks(false);
}

function refreshAvailabilityBlocksUi() {
  const list = document.getElementById('avbList');
  if (list) list.innerHTML = renderAvailabilityBlocksList();
  if (state.view === 'staff') {
    if (document.getElementById('planningGridWrap')) renderPlanning();
    if (document.getElementById('laserPlanningGridWrap')) renderLaserPlanning();
  }
}

function getAvailabilityBlocksForDate(dateStr) {
  const blocks = availabilityBlocksCache.blocks || [];
  if (!dateStr) return [];
  const dow = parseLocalDate(dateStr).getDay();
  return blocks.filter(block => {
    if (block.recurrence === 'weekly') {
      if (Number(block.dayOfWeek) !== dow) return false;
      if (block.dateFrom && dateStr < block.dateFrom) return false;
      if (block.dateUntil && dateStr > block.dateUntil) return false;
      return true;
    }
    return block.date === dateStr;
  });
}

// Fenetres de blocage bowling (heures decimales) par piste, pour le jour
// affiche. center + activite bowling => toutes les pistes ; lane => la piste ;
// formula => pas de piste physique (non marque ici). Jour entier => plage
// complete d'ouverture.
function getBowlingBlockWindows(dateStr, openHour, closeHour) {
  const perLane = {};
  const push = (lane, win) => { (perLane[lane] = perLane[lane] || []).push(win); };
  const toWindow = (block) => {
    const startMin = availabilityBlockStartMin(block);
    const endMin = availabilityBlockEndMin(block);
    const full = startMin === null && endMin === null;
    const startH = full ? openHour : Math.max(openHour, startMin / 60);
    const endH = full ? closeHour : Math.min(closeHour, endMin / 60);
    return { startH, endH, reason: block.reason || '', full };
  };
  getAvailabilityBlocksForDate(dateStr).forEach(block => {
    if (block.scopeType === 'center' || (block.scopeType === 'activity' && (block.scopeRef === 'bowling' || block.scopeRef === 'duckpin_bowling'))) {
      for (let lane = 1; lane <= TOTAL_LANES; lane += 1) push(lane, toWindow(block));
    } else if (block.scopeType === 'lane') {
      const lane = Number(block.scopeRef);
      if (Number.isFinite(lane) && lane >= 1 && lane <= TOTAL_LANES) push(lane, toWindow(block));
    }
  });
  Object.keys(perLane).forEach(key => {
    perLane[key] = perLane[key].filter(win => win.endH > win.startH && win.endH > openHour && win.startH < closeHour);
    if (!perLane[key].length) delete perLane[key];
  });
  return perLane;
}

// Banniere laser : le planning laser est un agenda (pas une grille par piste),
// on signale donc au niveau du jour les blocages laser/centre actifs.
function renderLaserBlockBanner(dateStr) {
  if (!availabilityBlocksCache.loaded) return '';
  const blocks = getAvailabilityBlocksForDate(dateStr).filter(block =>
    block.scopeType === 'center' || (block.scopeType === 'activity' && block.scopeRef === 'laser_game'));
  if (!blocks.length) return '';
  const items = blocks.map(block => {
    const scope = block.scopeType === 'center' ? 'Centre ferme' : 'Laser Game bloque';
    const time = availabilityTimeText(block) || '(toute la journee)';
    const reason = block.reason ? ` (${escapeHtml(block.reason)})` : '';
    return `<li data-blocked-laser="1">${escapeHtml(scope)} ${escapeHtml(time)}${reason}</li>`;
  }).join('');
  return `<div class="planning-blocked-banner" role="status"><strong>Blocage actif ce jour</strong><ul>${items}</ul></div>`;
}

function renderAvailabilityBlocksList() {
  if (availabilityBlocksCache.loading && !availabilityBlocksCache.loaded) {
    return '<div class="availability-empty">Lecture des blocages...</div>';
  }
  if (availabilityBlocksCache.error) {
    return `<div class="availability-empty availability-error">${escapeHtml(availabilityBlocksCache.error)} <button type="button" class="btn btn-secondary btn-sm" onclick="loadAvailabilityBlocks(true)">Reessayer</button></div>`;
  }
  const blocks = availabilityBlocksCache.blocks || [];
  if (!blocks.length) {
    return '<div class="availability-empty">Aucun blocage actif. Le centre suit ses horaires normaux.</div>';
  }
  // Libelle scannable : ligne primaire (portee + quand + plage) dans
  // .availability-item-label (les gates comportementaux lisent ce span), motif
  // sur une ligne muette dessous. describeAvailabilityBlock reste la source du
  // libelle de confirmation (suppression), inchangee.
  return `<ul class="availability-list">${blocks.map(block => {
    const primary = [availabilityScopeText(block), availabilityRecurrenceText(block), availabilityTimeText(block)].filter(Boolean).join(' ');
    const reason = block.reason ? `<span class="availability-item-reason">Motif : ${escapeHtml(block.reason)}</span>` : '';
    return `<li class="availability-item" data-block-id="${escapeHtml(String(block.id))}">
      <span class="availability-dot scope-${escapeHtml(block.scopeType)}" aria-hidden="true"></span>
      <span class="availability-item-body">
        <span class="availability-item-label">${escapeHtml(primary)}</span>
        ${reason}
      </span>
      <button type="button" class="btn btn-ghost btn-sm availability-del" onclick="deleteAvailabilityBlockUi(${Number(block.id)})">Supprimer</button>
    </li>`;
  }).join('')}</ul>`;
}

function updateAvailabilityFormVisibility() {
  const scope = document.getElementById('avb-scope')?.value || 'center';
  const recurrence = document.getElementById('avb-recurrence')?.value || 'once';
  const setDisplay = (selector, on) => document.querySelectorAll(selector).forEach(el => { el.style.display = on ? '' : 'none'; });
  setDisplay('.avb-cond-lane', scope === 'lane');
  setDisplay('.avb-cond-activity', scope === 'activity');
  setDisplay('.avb-cond-formula', scope === 'formula');
  setDisplay('.avb-cond-once', recurrence === 'once');
  setDisplay('.avb-cond-weekly', recurrence === 'weekly');
}

function resetAvailabilityForm() {
  ['avb-date', 'avb-from', 'avb-until', 'avb-start', 'avb-end', 'avb-reason'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}

async function submitAvailabilityBlock() {
  if (!canUseStaffPermission('settings.manage')) { toast('Reserve a la direction.'); return; }
  const value = id => (document.getElementById(id)?.value || '').trim();
  const scopeType = value('avb-scope') || 'center';
  const recurrence = value('avb-recurrence') || 'once';
  // Le centre est FORCE par le serveur : on n'envoie JAMAIS centerId.
  const body = { action: 'saveAvailabilityBlock', scopeType, recurrence };
  if (scopeType === 'lane') {
    const lane = value('avb-lane');
    if (!lane) { toast('Choisissez une piste.'); return; }
    body.scopeRef = lane;
  } else if (scopeType === 'activity') {
    const activity = value('avb-activity');
    if (!activity) { toast('Choisissez une activite.'); return; }
    body.scopeRef = activity;
  } else if (scopeType === 'formula') {
    const formula = value('avb-formula');
    if (!formula) { toast('Choisissez une formule.'); return; }
    body.scopeRef = formula;
  }
  if (recurrence === 'once') {
    const date = value('avb-date');
    if (!date) { toast('Choisissez une date.'); return; }
    body.date = date;
  } else {
    body.dayOfWeek = Number(value('avb-dow'));
    const from = value('avb-from');
    const until = value('avb-until');
    if (from) body.dateFrom = from;
    if (until) body.dateUntil = until;
  }
  const start = value('avb-start');
  const end = value('avb-end');
  if ((start && !end) || (!start && end)) { toast('Renseignez les deux heures, ou aucune.'); return; }
  if (start && end) {
    if (end <= start) { toast("L'heure de fin doit suivre le debut."); return; }
    body.startTime = start;
    body.endTime = end;
  }
  const reason = value('avb-reason');
  if (reason) body.reason = reason;
  const submitBtn = document.getElementById('avbSubmit');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Ajout...'; }
  try {
    await apiRequest(API_ENDPOINTS.ops, { method: 'POST', body: JSON.stringify(body) });
    toast('Blocage ajoute.');
    resetAvailabilityForm();
    await loadAvailabilityBlocks(true);
  } catch (error) {
    toast(error?.message || 'Ajout du blocage impossible.');
  } finally {
    const btn = document.getElementById('avbSubmit');
    if (btn) { btn.disabled = false; btn.textContent = 'Ajouter le blocage'; }
  }
}

async function deleteAvailabilityBlockUi(id) {
  if (!canUseStaffPermission('settings.manage')) { toast('Reserve a la direction.'); return; }
  const block = (availabilityBlocksCache.blocks || []).find(item => Number(item.id) === Number(id));
  const label = block ? describeAvailabilityBlock(block) : `blocage numero ${id}`;
  if (!window.confirm(`Supprimer ce blocage ?\n${label}`)) return;
  try {
    await apiRequest(API_ENDPOINTS.ops, { method: 'POST', body: JSON.stringify({ action: 'deleteAvailabilityBlock', id: Number(id) }) });
    toast('Blocage supprime.');
    await loadAvailabilityBlocks(true);
  } catch (error) {
    toast(error?.message || 'Suppression impossible.');
  }
}

function renderAvailabilityBlocksPanel() {
  if (!canUseStaffPermission('settings.manage')) return '';
  if (!availabilityBlocksCache.loaded && !availabilityBlocksCache.loading) {
    setTimeout(() => loadAvailabilityBlocks(false), 0);
  }
  const center = getAvailabilitySessionCenter();
  const centerName = center?.name || getCurrentStaffCenterId();
  const laneCount = getAvailabilityLaneCount();
  const activities = getAvailabilityActivities();
  const lanesOptions = Array.from({ length: laneCount }, (unused, index) => index + 1)
    .map(lane => `<option value="${lane}">Piste ${lane}</option>`).join('');
  const activitiesOptions = activities.length
    ? activities.map(activity => `<option value="${escapeHtml(activity.id)}">${escapeHtml(activity.label)}</option>`).join('')
    : '<option value="">Aucune activité disponible</option>';
  const formulesOptions = FORMULES.map(formule => `<option value="${escapeHtml(formule.id)}">${escapeHtml(formule.name)}</option>`).join('');
  const dowOptions = [1, 2, 3, 4, 5, 6, 0]
    .map(day => `<option value="${day}">${escapeHtml(AVAILABILITY_DAY_NAMES[day].charAt(0).toUpperCase() + AVAILABILITY_DAY_NAMES[day].slice(1))}</option>`).join('');
  return `<section class="availability-blocks" aria-label="Blocages de disponibilite">
    <div class="availability-blocks-head">
      <div class="availability-blocks-headline">
        <span class="estab-section-ico avb-head-ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m6.3 6.3 11.4 11.4"/></svg></span>
        <div>
          <span class="establishment-eyebrow">Disponibilités</span>
          <h2>Blocages &amp; fermetures</h2>
          <p>Fermez le centre, une piste, une activité ou une formule, sur une date précise ou chaque semaine. Le moteur applique le blocage et le planning le montre. Centre concerné : <strong>${escapeHtml(centerName)}</strong>.</p>
        </div>
      </div>
      <button type="button" class="btn btn-secondary btn-sm" onclick="loadAvailabilityBlocks(true)">Actualiser</button>
    </div>
    <div class="availability-blocks-grid">
      <fieldset class="establishment-card availability-form">
        <legend>Nouveau blocage</legend>
        <div class="field">
          <label for="avb-scope">Que bloquer ?</label>
          <select id="avb-scope" onchange="updateAvailabilityFormVisibility()">
            <option value="center">Fermer le centre</option>
            <option value="lane">Bloquer une piste</option>
            <option value="activity">Bloquer une activité</option>
            <option value="formula">Bloquer une formule</option>
          </select>
        </div>
        <div class="field avb-cond avb-cond-lane" style="display:none">
          <label for="avb-lane">Piste</label>
          <select id="avb-lane">${lanesOptions}</select>
        </div>
        <div class="field avb-cond avb-cond-activity" style="display:none">
          <label for="avb-activity">Activite</label>
          <select id="avb-activity">${activitiesOptions}</select>
        </div>
        <div class="field avb-cond avb-cond-formula" style="display:none">
          <label for="avb-formula">Formule</label>
          <select id="avb-formula">${formulesOptions}</select>
        </div>
        <div class="field">
          <label for="avb-recurrence">Quand ?</label>
          <select id="avb-recurrence" onchange="updateAvailabilityFormVisibility()">
            <option value="once">Une date précise</option>
            <option value="weekly">Toutes les semaines</option>
          </select>
        </div>
        <div class="field avb-cond avb-cond-once">
          <label for="avb-date">Date</label>
          <input type="date" id="avb-date">
        </div>
        <div class="avb-cond avb-cond-weekly" style="display:none">
          <div class="field">
            <label for="avb-dow">Jour de la semaine</label>
            <select id="avb-dow">${dowOptions}</select>
          </div>
          <div class="estab-field-row">
            <div class="field"><label for="avb-from">A partir du (optionnel)</label><input type="date" id="avb-from"></div>
            <div class="field"><label for="avb-until">Jusqu'au (optionnel)</label><input type="date" id="avb-until"></div>
          </div>
        </div>
        <div class="estab-field-row">
          <div class="field"><label for="avb-start">De (optionnel)</label><input type="time" id="avb-start"></div>
          <div class="field"><label for="avb-end">A (optionnel)</label><input type="time" id="avb-end"></div>
        </div>
        <p class="avb-hint">Heures vides : le blocage couvre toute la journée.</p>
        <div class="field"><label for="avb-reason">Motif (optionnel)</label><input type="text" id="avb-reason" maxlength="200" placeholder="Ex : maintenance, événement privé"></div>
        <button type="button" id="avbSubmit" class="btn btn-primary" onclick="submitAvailabilityBlock()">Ajouter le blocage</button>
      </fieldset>
      <div class="availability-list-wrap">
        <h3>Blocages actifs</h3>
        <div id="avbList">${renderAvailabilityBlocksList()}</div>
      </div>
    </div>
  </section>`;
}

function renderStaffUtilitySettings() {
  const currentTheme = state.staffTheme === 'light' ? 'Clair' : 'Sombre';
  return `<div class="utility-settings-console">
    <article><span>Interface</span><strong>Thème ${escapeHtml(currentTheme)}</strong><p>Mode staff persistant sur ce poste.</p><div><button type="button" onclick="setStaffTheme('dark')">Sombre</button><button type="button" onclick="setStaffTheme('light')">Clair</button></div></article>
    <article><span>Données</span><strong>${state.reservations.length} réservation(s)</strong><p>Actualise planning, mails et état staff.</p><div><button type="button" onclick="refreshStaffPlanning()">Actualiser</button><button type="button" onclick="exportStaffPlanningCsv()">Exporter</button></div></article>
    <article><span>Ops</span><strong>${opsAdminCache.loaded ? 'Console chargée' : 'Console prête'}</strong><p>Mails, agents et suggestions terrain.</p><div><button type="button" onclick="requestOpsAdminLoad(true)">Charger Ops</button><button type="button" onclick="openStaffMenuPage('emails')">Emails</button></div></article>
  </div>`;
}

function getStaffUtilityPageModel(page = getStaffMenuPage()) {
  const reservations = getStaffUtilityReservations();
  const now = currentTimeDecimal();
  const isToday = state.currentDate === todayStr();
  const activeRows = reservations.filter(reservation => getStaffResourceWindows(reservation, 'all').some(window => window.start <= now && now < window.end));
  const openRows = reservations.filter(reservation => reservation.status !== 'paid');
  const arrivedRows = reservations.filter(reservation => reservation.status === 'arrived');
  const eventRows = reservations.filter(isStaffUtilityEventReservation);
  const clientRows = getStaffClientRows();
  const laserSessions = getStaffUtilityLaserSessions(reservations);
  const maintenanceCount = Object.values(state.laneStatuses || {}).filter(status => status === 'maintenance').length;
  const base = {
    page,
    layout: 'default',
    eyebrow: 'Staff',
    title: 'Espace staff',
    subtitle: getStaffUtilitySyncLabel(),
    primaryLabel: 'Réservation rapide',
    primaryAction: "openQuickBook({ date: state.currentDate, type: 'bowling' })",
    secondaryLabel: 'Voir planning',
    secondaryAction: "openStaffPlanningResource('bowling')",
    kpis: [],
    body: ''
  };
  if (page === 'formules') {
    const formuleRows = reservations.filter(reservation => reservation.type === 'formule' || reservation.formuleId);
    const withActivities = formuleRows.filter(reservationHasFormulaActivities);
    const totals = withActivities.reduce((acc, reservation) => {
      const summary = getFormulaActivityProgressSummary(reservation);
      acc.done += summary.done;
      acc.total += summary.total;
      if (summary.allDone) acc.complete += 1;
      return acc;
    }, { done: 0, total: 0, complete: 0 });
    return {
      ...base,
      layout: 'events',
      eyebrow: 'Terrain',
      title: 'Formules, suivi des activités',
      subtitle: 'Cochez chaque activité au fur et à mesure : vous voyez d\'un coup d\'œil ce qui reste à faire.',
      panelSubtitle: `${formuleRows.length} formule${formuleRows.length > 1 ? 's' : ''} sur la date · ${totals.done}/${totals.total} activité${totals.total > 1 ? 's' : ''} faite${totals.done > 1 ? 's' : ''}`,
      secondaryAction: "openStaffMenuPage('reservations')",
      kpis: [
        ['Formules', formuleRows.length, 'sur la date'],
        ['Joueurs', formuleRows.reduce((sum, r) => sum + Number(r.pax || 0), 0), 'participants'],
        ['Activités faites', `${totals.done}/${totals.total}`, 'cochées'],
        ['Complètes', totals.complete, 'toutes activités faites']
      ],
      body: renderStaffFormulesBoard(formuleRows)
    };
  }
  if (page === 'sessions') {
    const nextRows = reservations.filter(reservation => getReservationFirstResourceStart(reservation, 'all') > now && reservation.status !== 'paid').slice(0, 8);
    const closingRows = reservations.filter(reservation => reservation.status === 'arrived' || (getStaffResourceWindows(reservation, 'all').some(window => window.end <= now) && reservation.status !== 'paid')).slice(0, 8);
    const rows = isToday ? activeRows : openRows;
    return {
      ...base,
      layout: 'rush',
      eyebrow: 'Opérationnel',
      title: 'Sessions en cours',
      subtitle: isToday ? 'Ce qui demande une attention maintenant.' : 'Sessions ouvertes sur la date affichée.',
      secondaryAction: "openStaffMenuPage('reservations')",
      kpis: [
        ['En cours', rows.length, isToday ? 'fenêtre active maintenant' : 'sur la date'],
        ['À gérer', openRows.length, 'non clôturées'],
        ['Laser', reservations.filter(r => getLaserWindowsFromReservation(r).length).length, 'réservations visibles'],
        ['Bowling', reservations.filter(r => getBowlingWindowsFromReservation(r).length).length, 'réservations visibles']
      ],
      body: renderStaffUtilityRushBoard({ activeRows: rows.slice(0, 8), nextRows, closingRows })
    };
  }
  if (page === 'arrivals') {
    const rows = reservations.filter(reservation => reservation.status !== 'paid');
    return {
      ...base,
      layout: 'arrival',
      eyebrow: 'Accueil',
      title: 'Arrivées',
      subtitle: 'File de clients à accueillir, confirmer ou encaisser.',
      kpis: [
        ['À venir', rows.filter(r => r.status === 'pending').length, 'confirmées'],
        ['Sur place', arrivedRows.length, 'déjà arrivées'],
        ['Joueurs', rows.reduce((sum, r) => sum + Number(r.pax || 0), 0), 'à suivre'],
        ['À encaisser', rows.filter(r => r.status !== 'paid').length, 'réservations ouvertes']
      ],
      body: renderStaffUtilityArrivalDesk(rows)
    };
  }
  if (page === 'events') {
    return {
      ...base,
      layout: 'events',
      eyebrow: 'Terrain',
      title: 'Événements',
      subtitle: 'Les dossiers qui demandent une attention staff avant ou pendant le passage.',
      panelSubtitle: `${eventRows.length} dossier${eventRows.length > 1 ? 's' : ''} sensible${eventRows.length > 1 ? 's' : ''} · trié par heure · données réelles`,
      kpis: [
        ['Événements', eventRows.length, 'détectés sur la date'],
        ['Joueurs', eventRows.reduce((sum, r) => sum + Number(r.pax || 0), 0), 'participants'],
        ['Formules', eventRows.filter(r => r.formuleId || r.type === 'formule').length, 'à suivre'],
        ['CA prévu', formatMoney(eventRows.reduce((sum, r) => sum + Number(r.price || 0), 0)), 'sur ces lignes']
      ],
      body: renderStaffUtilityEventsBoard(eventRows)
    };
  }
  // Plus de branche « groups » : la page a disparu le 2026-07-13 (fusion
  // Clients+Groupes), tous ses chemins d'accès sont aliasés vers Clients /
  // segment « À venir » (openStaffMenuPage, renderStaffData, renderStaffUtilityPage).
  if (page === 'contacts') {
    const missing = clientRows.filter(row => !row.email || !row.phone).length;
    return {
      ...base,
      layout: 'contacts',
      eyebrow: 'Clients',
      title: 'Contacts',
      subtitle: 'Carnet client issu des réservations réelles.',
      primaryLabel: 'Exporter CSV',
      primaryAction: 'exportStaffClientsCsv()',
      kpis: [
        ['Contacts', clientRows.length, 'profils consolidés'],
        ['Téléphone', clientRows.filter(row => row.phone).length, 'renseignés'],
        ['Email', clientRows.filter(row => row.email).length, 'renseignés'],
        ['À compléter', missing, 'fiche incomplète']
      ],
      body: renderStaffUtilityContactLedger(clientRows)
    };
  }
  if (page === 'lanes') {
    const bowlingRows = reservations.filter(r => getBowlingWindowsFromReservation(r).length);
    return {
      ...base,
      layout: 'lanes',
      eyebrow: 'Bowling',
      title: 'Pistes',
      subtitle: 'État piste par piste, maintenance et occupation du jour.',
      primaryLabel: 'Créer bowling',
      primaryAction: "openQuickBook({ date: state.currentDate, type: 'bowling' })",
      kpis: [
        ['Pistes', TOTAL_LANES, 'configuration centre'],
        ['Actives', TOTAL_LANES - maintenanceCount, 'disponibles'],
        ['Maintenance', maintenanceCount, 'bloquées'],
        ['Réservations', bowlingRows.length, 'bowling sur la date']
      ],
      body: renderStaffUtilityLaneGrid(reservations)
    };
  }
  if (page === 'laserGame') {
    const laserRows = reservations.filter(r => getLaserWindowsFromReservation(r).length || r.type === 'laser');
    return {
      ...base,
      layout: 'laser',
      eyebrow: 'Laser Game',
      title: 'Laser Game',
      subtitle: 'Lancements, groupes partagés, capacité armes et réservations laser.',
      primaryLabel: 'Réserver Laser',
      primaryAction: "openQuickBook({ date: state.currentDate, type: 'laser' })",
      secondaryLabel: 'Planning Laser',
      secondaryAction: "openStaffPlanningResource('laser')",
      kpis: [
        ['Lancements', laserSessions.length, 'créneaux planifiés'],
        ['Passages', laserRows.reduce((sum, r) => sum + getLaserWindowsFromReservation(r).length, 0), 'fenêtres laser'],
        ['Joueurs', laserRows.reduce((sum, r) => sum + Number(r.pax || 0), 0), 'laser'],
        ['Capacité', `${LASER_GAME_MAX_PLAYERS}`, 'armes par lancement']
      ],
      body: renderStaffUtilityLaserSessions(reservations)
    };
  }
  if (page === 'establishment') {
    return {
      ...base,
      layout: 'establishment',
      eyebrow: 'Paramètres',
      title: 'Établissement',
      subtitle: 'Configuration des centres lue par le moteur.',
      hidePanelHead: true,
      hideDateAction: true,
      primaryLabel: 'Ouvrir la direction',
      primaryAction: "setView('admin'); openAdminTab('overview')",
      body: renderStaffUtilityEstablishment()
    };
  }
  if (page === 'users') {
    const access = ensureStaffAccessControl();
    // Entete "Acces" : memes exclusions que la page (les roles/membres
    // plateforme ne sont ni affiches ni comptes).
    const visibleRoles = getVisibleStaffAccessRoles(access);
    const visibleMembers = getVisibleStaffAccessMembers(access);
    const selectedRole = getStaffAccessRole(access.selectedRoleId);
    const permissionTotal = getStaffPermissionKeys().length;
    const selectedPermissionCount = new Set(selectedRole.permissions || []).size;
    const activeMembers = visibleMembers.filter(member => member.status === 'active').length;
    const pendingMembers = visibleMembers.filter(member => member.status === 'pending').length;
    return {
      ...base,
      layout: 'users',
      eyebrow: 'Paramètres',
      title: 'Utilisateurs',
      subtitle: 'Rôles, codes d’accès et permissions opérationnelles du centre.',
      hidePanelHead: true,
      hideDateAction: true,
      primaryLabel: 'Créer accès staff',
      primaryAction: 'createStaffMember()',
      secondaryLabel: 'Créer rôle',
      secondaryAction: 'createStaffCustomRole()',
      kpis: [
        ['Rôles', visibleRoles.length, 'presets + personnalisés'],
        ['Staff actif', activeMembers, `${pendingMembers} en attente`],
        ['Permissions du rôle', `${selectedPermissionCount}/${permissionTotal}`, selectedRole.name],
        ['Codes actifs', visibleRoles.filter(role => role.accessCode).length + visibleMembers.filter(member => member.code).length, 'rôles et membres']
      ],
      body: renderStaffUtilityUsers()
    };
  }
  if (page === 'settings') {
    return {
      ...base,
      layout: 'settings',
      eyebrow: 'Paramètres',
      title: 'Paramètres',
      subtitle: 'Actions réelles du poste staff, thème, données et console Ops.',
      primaryLabel: 'Actualiser',
      primaryAction: 'refreshStaffPlanning()',
      secondaryLabel: 'Exporter planning',
      secondaryAction: 'exportStaffPlanningCsv()',
      kpis: [
        ['Thème', state.staffTheme === 'light' ? 'Clair' : 'Sombre', 'ce poste'],
        // « local + API » decrivait la plomberie. Ce qui compte pour le staff :
        // combien de reservations sont chargees pour la date affichee.
        ['Réservations', state.reservations.length, 'chargées'],
        ['Mails Ops', opsAdminCache.communications?.length || 0, 'chargés'],
        ['Date', state.currentDate, 'contexte staff']
      ],
      body: renderStaffUtilitySettings()
    };
  }
  return base;
}

function renderStaffUtilityPage() {
  const root = document.getElementById('staffUtilityPage');
  if (!root) return;
  const model = getStaffUtilityPageModel();
  const dateLabel = parseLocalDate(state.currentDate).toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  // Sans texte de synchro (cas normal), la date reste seule : pas de « · » en
  // tete de ligne, pas de separateur qui pend.
  const prettyDate = dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1);
  const heroSubtitle = model.hidePanelHead
    ? escapeHtml(model.subtitle)
    : [model.subtitle, prettyDate].filter(Boolean).map(escapeHtml).join(' · ');
  const overviewPages = new Set(['users', 'settings']);
  const archivePages = new Set(['groups', 'contacts']);
  // Le sous-titre du panneau ne s'affiche que s'il DIT quelque chose : sans
  // texte propre a la page ni alerte de connexion, la ligne disparait au lieu
  // de rester vide sous le titre.
  const panelSubtitle = model.panelSubtitle || getStaffUtilitySyncLabel();
  const panelHead = model.hidePanelHead ? '' : `<div class="utility-panel-head">
        <div>
          <h2>${escapeHtml(model.title)}</h2>
          ${panelSubtitle ? `<p>${escapeHtml(panelSubtitle)}</p>` : ''}
        </div>
        <button type="button" onclick="renderStaffUtilityPage()">Rafraîchir</button>
      </div>`;
  root.className = `staff-utility-page utility-page-${escapeHtml(model.page)} utility-layout-${escapeHtml(model.layout || 'default')}`;
  root.innerHTML = `
    <section class="utility-hero">
      <div>
        <span>${escapeHtml(model.eyebrow)}</span>
        <h1>${escapeHtml(model.title)}</h1>
        <p>${heroSubtitle}</p>
      </div>
      <div class="utility-actions">
        ${model.hideDateAction ? '' : staffDateNavHtml()}
        ${model.secondaryAction ? `<button type="button" onclick="${model.secondaryAction}">${escapeHtml(model.secondaryLabel)}</button>` : ''}
        ${model.primaryAction ? `<button type="button" class="primary" onclick="${model.primaryAction}">${escapeHtml(model.primaryLabel)}</button>` : ''}
      </div>
    </section>
    ${overviewPages.has(model.page) ? renderStaffUtilityOverview(model) : ''}
    <section class="utility-panel ${model.hidePanelHead ? 'utility-panel-flat' : ''}">
      ${panelHead}
      ${model.body}
    </section>
  `;
  if (archivePages.has(model.page)) ensureStaffClientData();
  if (model.page === 'groups') ensureStaffCustomRequests();
  if ((model.page === 'emails' || model.page === 'settings' || model.page === 'establishment') && !opsAdminCache.loaded && !opsAdminCache.loading) requestOpsAdminLoad(false);
}

function isStaffClientsActive() {
  return state.view === 'staff' && getStaffMenuPage() === 'clients';
}

function getPricingTypeLabel(type) {
  return type === 'bowling' ? 'Bowling'
    : type === 'laser' ? 'Laser Game'
    : type === 'special' ? 'Formule spéciale'
    : 'Formule';
}

function getPricingPriceLabel(row) {
  if (row.type === 'bowling') return `${formatMoney(row.price)} / piste`;
  if (row.type === 'laser') return `${formatMoney(row.price)} / personne`;
  return `${formatMoney(row.price)} ${row.priceType === 'per_lane' ? '/ piste' : '/ personne'}`;
}

function getPricingAsset(type) {
  if (type === 'bowling') return './assets/pricing/bowling.png';
  if (type === 'laser') return './assets/pricing/laser.png';
  if (type === 'special') return './assets/pricing/special.png';
  return './assets/pricing/formula.png';
}

function getPricingTone(type) {
  if (type === 'bowling') return 'green';
  if (type === 'laser') return 'blue';
  if (type === 'special') return 'violet';
  return 'amber';
}

function getPricingReservations() {
  return (state.reservations || []).filter(reservation => reservation.status !== 'cancelled');
}

function getPricingUsageMap() {
  const usage = new Map();
  const register = (id, reservation) => {
    const item = usage.get(id) || { count: 0, players: 0, revenue: 0 };
    item.count += 1;
    item.players += Number(reservation.pax || 0);
    item.revenue += Number(reservation.price || 0);
    usage.set(id, item);
  };
  getPricingReservations().forEach(reservation => {
    if (reservation.formuleId) {
      register(`formula-${reservation.formuleId}`, reservation);
      return;
    }
    if (reservation.type === 'laser') {
      const option = LASER_GAME_OPTIONS.find(item => Number(item.value) === Number(reservation.duration || 0.5)) || LASER_GAME_OPTIONS[0];
      register(`laser-${option.games}`, reservation);
      return;
    }
    if (reservation.type === 'bowling') {
      register(`bowling-${Number(reservation.duration || 1)}`, reservation);
    }
  });
  return usage;
}

// LA SOURCE des formules pour les ecrans de la console (grille Tarifs,
// Etablissement > Offres) : la liste VIVE du catalogue (customs comprises,
// editions refletees, nom/prix effectifs du centre) quand elle est chargee,
// la constante FORMULES sinon. Les formules retirees du catalogue sont
// EXCLUES par defaut (elles n'existent plus pour le centre) ; la grille
// Tarifs les demande pour les montrer barrees et restaurables.
function getConsoleFormuleCatalog({ includeRemoved = false } = {}) {
  const live = typeof window !== 'undefined' && typeof window.pevLiveFormules === 'function'
    ? window.pevLiveFormules()
    : null;
  if (!Array.isArray(live) || !live.length) return FORMULES;
  return includeRemoved ? live : live.filter(formule => !formule.removed);
}

function getPricingRows() {
  const usage = getPricingUsageMap();
  const decorate = row => ({
    ...row,
    asset: getPricingAsset(row.type),
    tone: getPricingTone(row.type),
    ...(usage.get(row.id) || { count: 0, players: 0, revenue: 0 })
  });
  const bowling = DURATION_OPTIONS.map(option => decorate({
    id: `bowling-${Number(option.value)}`,
    type: 'bowling',
    title: `Bowling ${option.label}`,
    subtitle: 'Location de piste',
    description: `${option.label} de jeu, prix par piste, jusqu'à ${MAX_PER_LANE} joueurs confort.`,
    price: option.price,
    durationLabel: option.label,
    capacity: `${MAX_PER_LANE} joueurs / piste`,
    availability: 'Selon horaires du centre',
    tags: ['Piste', option.label, `${MAX_PER_LANE} joueurs`],
    activities: ['Bowling']
  }));
  const laser = LASER_GAME_OPTIONS.map(option => decorate({
    id: `laser-${option.games}`,
    type: 'laser',
    title: `${option.label} Laser Game`,
    subtitle: `${option.games} passage${option.games > 1 ? 's' : ''}`,
    description: `${option.durationMinutes} min estimées, session partageable selon l'affluence, ${LASER_GAME_MAX_PLAYERS} armes disponibles.`,
    price: option.price,
    durationLabel: `${option.durationMinutes} min`,
    capacity: `${LASER_GAME_MAX_PLAYERS} joueurs / lancement`,
    availability: `${LASER_GAME_PARALLEL_LAUNCHES} lancement${LASER_GAME_PARALLEL_LAUNCHES > 1 ? 's' : ''} simultané${LASER_GAME_PARALLEL_LAUNCHES > 1 ? 's' : ''}`,
    tags: ['Laser', `${option.games} partie${option.games > 1 ? 's' : ''}`, `${LASER_GAME_MAX_PLAYERS} armes`],
    activities: ['Laser Game']
  }));
  const formulas = getConsoleFormuleCatalog({ includeRemoved: true }).map(formule => {
    const special = formule.family !== 'Formules anniversaires';
    return decorate({
      id: `formula-${formule.id}`,
      sourceId: formule.id,
      removed: formule.removed === true,
      source: formule.source || 'seed',
      family: formule.family || '',
      type: special ? 'special' : 'formula',
      title: formule.name,
      subtitle: formule.family || 'Formule',
      description: (formule.desc || []).join(' · '),
      price: formule.price,
      oldPrice: formule.oldPrice,
      priceType: formule.type,
      durationLabel: `${formatDurationLabel(getFormuleTotalDuration(formule))} estimées`,
      capacity: `${formule.minPax || 1}+ personne${Number(formule.minPax || 1) > 1 ? 's' : ''}`,
      availability: getFormulaAvailabilityLabel(formule),
      tags: [
        formule.hasBowling ? `Bowling ${formatDurationLabel(formule.bowlingDur || 1)}` : '',
        getFormulaLaserGameCount(formule) ? `Laser x${getFormulaLaserGameCount(formule)}` : '',
        formule.noHolidays ? 'Hors congés' : '',
        ...(formule.validDays ? ['Jour limité'] : [])
      ].filter(Boolean),
      activities: formule.desc || [],
      best: !!formule.best,
      notes: formule.notes || []
    });
  });
  return [...bowling, ...laser, ...formulas];
}

function getFormulaAvailabilityLabel(formule) {
  const days = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const parts = [];
  if (Array.isArray(formule.validDays) && formule.validDays.length) {
    parts.push(formule.validDays.map(day => days[day] || '').filter(Boolean).join(', '));
  }
  if (formule.timeLimit?.min || formule.timeLimit?.max) {
    parts.push(`${formule.timeLimit.min ? formatClockDisplay(formule.timeLimit.min) : 'ouverture'} - ${formule.timeLimit.max ? formatClockDisplay(formule.timeLimit.max) : 'fermeture'}`);
  }
  if (formule.noHolidays) parts.push('hors vacances/jours fériés');
  return parts.length ? parts.join(' · ') : 'Tous horaires compatibles';
}

function getPricingRowsFiltered() {
  const filter = state.staffPricingFilter || 'all';
  const query = String(state.staffPricingQuery || '').trim().toLowerCase();
  const filtered = getPricingRows().filter(row => {
    if (filter !== 'all' && row.type !== filter) return false;
    if (!query) return true;
    return `${row.title} ${row.subtitle} ${row.description} ${row.tags.join(' ')}`.toLowerCase().includes(query);
  });
  return sortPricingRows(filtered);
}

// Classement rentabilité/demande : agrégats réels des réservations (count,
// revenue, players déjà portés par chaque ligne du catalogue).
function sortPricingRows(rows) {
  const ranking = state.staffPricingSort || 'default';
  if (ranking === 'default') return rows;
  const basket = row => (Number(row.count) ? Number(row.revenue || 0) / Number(row.count) : 0);
  const keyFn = {
    demand: row => Number(row.count || 0),
    revenue: row => Number(row.revenue || 0),
    players: row => Number(row.players || 0),
    basket,
  }[ranking] || (row => 0);
  return [...rows].sort((a, b) => keyFn(b) - keyFn(a) || Number(b.revenue || 0) - Number(a.revenue || 0));
}

function setStaffPricingSort(ranking) {
  state.staffPricingSort = state.staffPricingSort === ranking ? 'default' : ranking;
  save();
  renderStaffPricingPage();
}

function getPricingMetrics(rows = getPricingRows()) {
  const revenue = rows.reduce((sum, row) => sum + Number(row.revenue || 0), 0);
  const reservations = rows.reduce((sum, row) => sum + Number(row.count || 0), 0);
  const formulaRows = rows.filter(row => row.type === 'formula' || row.type === 'special');
  const activeOffers = rows.length;
  const topRow = [...rows].sort((a, b) => Number(b.count || 0) - Number(a.count || 0))[0] || null;
  return { revenue, reservations, activeOffers, formulaRows: formulaRows.length, topRow };
}

function setStaffPricingQuery(value) {
  state.staffPricingQuery = value || '';
  renderStaffPricingPage();
}

function getSelectedPricingRow(rows = getPricingRowsFiltered()) {
  return rows.find(row => row.id === state.staffPricingSelectedId) || rows[0] || getPricingRows()[0] || null;
}

function openStaffPricingBooking(id) {
  const row = getPricingRows().find(item => item.id === id);
  if (!row) return;
  if (row.type === 'laser') {
    const option = LASER_GAME_OPTIONS.find(item => `laser-${item.games}` === row.id) || LASER_GAME_OPTIONS[0];
    openQuickBook({ date: state.currentDate || todayStr(), type: 'laser', duration: option.value });
    return;
  }
  if (row.type === 'formula' || row.type === 'special') {
    openQuickBook({ date: state.currentDate || todayStr(), type: 'formule', formuleId: row.sourceId });
    return;
  }
  const option = DURATION_OPTIONS.find(item => `bowling-${Number(item.value)}` === row.id) || DURATION_OPTIONS[1];
  openQuickBook({ date: state.currentDate || todayStr(), type: 'bowling', duration: option.value });
}

// C14 : utilitaires d'export partagés staff/direction, vivaient dans
// admin-console.js, désormais ici car ce fichier est chargé pour tous les
// profils alors que la console admin est injectée à la demande.
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

function csvCell(value) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

// C14 : sélection d'onglet admin sûre même pendant l'injection des consoles 
// l'onglet est mémorisé et setView('admin') le rend une fois le script chargé.
function openAdminTab(tab) {
  if (typeof setAdminTab === 'function') {
    setAdminTab(tab);
    return;
  }
  state.adminTab = tab || 'overview';
  save();
}

// C14 : sélection de centre sûre pendant l'injection, le centre est mémorisé
// et le .then() de setView('admin') rend le dashboard avec (sans ce garde, le
// premier switch de centre était perdu, setAdminCenter n'existant pas encore).
function openAdminCenter(centerId) {
  if (typeof setAdminCenter === 'function') {
    setAdminCenter(centerId);
    return;
  }
  state.adminCenterId = centerId || 'libramont';
  save();
}

function exportStaffPricingCsv() {
  const rows = getPricingRowsFiltered();
  const header = ['Type', 'Nom', 'Prix', 'Capacite', 'Disponibilite', 'Reservations', 'Joueurs', 'Revenu', 'Details'];
  const body = rows.map(row => [
    getPricingTypeLabel(row.type),
    row.title,
    getPricingPriceLabel(row),
    row.capacity,
    row.availability,
    row.count || 0,
    row.players || 0,
    row.revenue || 0,
    row.description
  ].map(csvCell).join(','));
  downloadTextFile(`${getCurrentStaffCenterId()}-tarifs-formules-${state.currentDate || todayStr()}.csv`, [header.map(csvCell).join(','), ...body].join('\n'), 'text/csv;charset=utf-8');
}

function copyStaffPricingSummary() {
  const rows = getPricingRowsFiltered();
  const summary = rows.map(row => `${row.title}: ${getPricingPriceLabel(row)} (${row.availability})`).join('\n');
  navigator.clipboard?.writeText(summary).then(() => toast('Tarifs copiés.')).catch(() => toast(summary));
}

function getStaffEmailId(item, index = 0) {
  return String(item.id || item.communicationId || item.queueId || [
    item.templateId || 'mail',
    item.recipient || 'recipient',
    item.createdAt || item.scheduledAt || 'time',
    index
  ].join(':'));
}

function getStaffEmailStatusKind(item = {}) {
  const status = String(item.status || 'draft').toLowerCase();
  if (status === 'sent' || status === 'delivered') return 'sent';
  if (status === 'failed' || status === 'error') return 'failed';
  if (status === 'queued' || status === 'pending') return 'queued';
  if (status === 'skipped') return 'paused';
  return 'draft';
}

function getStaffEmailStatusLabel(item = {}) {
  const kind = getStaffEmailStatusKind(item);
  const labels = {
    sent: 'Envoyé',
    failed: 'À corriger',
    queued: 'En file',
    paused: 'En pause',
    draft: 'Brouillon'
  };
  return labels[kind] || 'Message';
}

function getStaffEmailRows() {
  // C14 : ops-console.js est injecté à la demande, avant son arrivée, la page
  // Emails rend son état vide (le chargement est déjà déclenché par la page).
  if (typeof getVisibleOpsCommunications !== 'function') return [];
  return getVisibleOpsCommunications()
    .map((item, index) => ({
      ...item,
      uid: getStaffEmailId(item, index),
      sourceIndex: index,
      statusKind: getStaffEmailStatusKind(item),
      templateLabel: getOpsTemplateLabel(item.templateId)
    }));
}

// ── Origine d'une communication : QUI l'a déclenchée ─────────────────────────
// Classifieur ancré sur les champs payload RÉELLEMENT posés par chaque chemin
// d'envoi serveur (vérifiés un à un sur les enqueue de lib/ops-communications.js,
// lib/ops-jobs.js et lib/email-agent.js) :
//   'inbound' : mail REÇU (ingestInboundEmail : direction='inbound', status
//               'received'). Ni auto ni manuel : c'est le client qui écrit.
//   'manual'  : une action humaine directe a déclenché CET envoi :
//               payload.direct/directEmail → sendDirectEmail (composer, studio_*)
//               payload.relance            → sendClientRelance (relance 1-clic, relance_*)
//               payload.clientMessage      → sendClientMessage (message depuis une résa, client_*)
//               payload.test               → sendAutomationTest (test au staff connecté, test_*)
//               payload.campaignId         → enqueueCampaign (campagne lancée par l'équipe, campaign_*)
//   'auto'    : tout le reste, parti tout seul (worker/cron/séquences) :
//               request_received, confirmation, reminder_48h, reminder_day_sms,
//               staff_review_request, delay_change, post_visit_followup,
//               birthday_j30, reactivation, custom_* et les rangées de
//               simulation. AUCUN de ces chemins ne pose les flags ci-dessus.
function getStaffEmailOrigin(row = {}) {
  if (row.direction === 'inbound' || row.status === 'received') return 'inbound';
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
  const flag = (value) => value === true || value === 'true';
  if (flag(payload.direct) || flag(payload.directEmail)) return 'manual';
  if (flag(payload.relance)) return 'manual';
  if (flag(payload.clientMessage)) return 'manual';
  if (flag(payload.test)) return 'manual';
  if (payload.campaignId) return 'manual';
  return 'auto';
}

function getStaffEmailOriginLabel(row = {}) {
  const origin = getStaffEmailOrigin(row);
  if (origin === 'inbound') return 'Reçu';
  return origin === 'manual' ? 'Envoi manuel' : 'Automatique';
}

function getStaffEmailText(row = {}) {
  const payload = row.payload || {};
  return [
    row.subject,
    row.recipient,
    row.templateLabel || getOpsTemplateLabel(row.templateId),
    row.channel,
    row.status,
    row.lastError,
    payload.textBody,
    payload.validationMode,
    payload.customerName,
    payload.phone
  ].filter(Boolean).join(' ').toLowerCase();
}

function getStaffEmailRowsFiltered() {
  const filter = state.staffEmailFilter || 'all';
  const template = state.staffEmailTemplateFilter || 'all';
  // Origine (auto/manuel) COMBINABLE avec les statuts : les deux filtres se
  // cumulent (ex. « Envois manuels » + « Échecs »). 'inbound' est géré par la
  // page (pv2EmailFilter), pas ici.
  const origin = ['auto', 'manual'].includes(state.staffEmailOriginFilter) ? state.staffEmailOriginFilter : 'all';
  const query = String(state.staffEmailQuery || '').trim().toLowerCase();
  return getStaffEmailRows().filter(row => {
    if (origin !== 'all' && getStaffEmailOrigin(row) !== origin) return false;
    if (filter === 'review' && row.templateId !== 'staff_review_request') return false;
    if (filter !== 'all' && filter !== 'review' && row.statusKind !== filter) return false;
    if (template !== 'all' && row.templateId !== template) return false;
    if (query && !getStaffEmailText(row).includes(query)) return false;
    return true;
  });
}

function getStaffEmailMetrics(rows = getStaffEmailRows()) {
  const sent = rows.filter(row => row.statusKind === 'sent').length;
  const queued = rows.filter(row => row.statusKind === 'queued').length;
  const failed = rows.filter(row => row.statusKind === 'failed').length;
  const review = rows.filter(row => row.templateId === 'staff_review_request').length;
  const due = rows.filter(row => row.statusKind === 'queued' && (!row.scheduledAt || new Date(row.scheduledAt).getTime() <= Date.now())).length;
  const reminders = rows.filter(row => row.templateId === 'reminder_48h').length;
  const attempted = rows.reduce((sum, row) => sum + Number(row.attempts || 0), 0);
  const deliveryBase = sent + failed;
  const deliveryRate = deliveryBase ? Math.round((sent / deliveryBase) * 100) : 100;
  return { sent, queued, failed, review, due, reminders, attempted, deliveryRate, total: rows.length };
}

function setStaffEmailQuery(query = '') {
  state.staffEmailQuery = String(query || '');
  state.staffEmailSelectedId = '';
  save();
  renderStaffEmailsPage();
}

function getSelectedStaffEmailRow(rows = getStaffEmailRowsFiltered()) {
  if (!rows.length) return null;
  const selected = rows.find(row => row.uid === state.staffEmailSelectedId);
  return selected || rows[0];
}

function exportStaffEmailsCsv() {
  const rows = getStaffEmailRowsFiltered();
  const header = ['Statut', 'Origine', 'Modele', 'Sujet', 'Destinataire', 'Canal', 'Planifie', 'Envoye', 'Tentatives', 'Erreur'];
  const body = rows.map(row => [
    getStaffEmailStatusLabel(row),
    getStaffEmailOriginLabel(row),
    getOpsTemplateLabel(row.templateId),
    row.subject || '',
    row.recipient || '',
    row.channel || 'email',
    row.scheduledAt || '',
    row.sentAt || '',
    Number(row.attempts || 0),
    row.lastError || ''
  ].map(csvCell).join(','));
  downloadTextFile(`${getCurrentStaffCenterId()}-mails-${state.currentDate || todayStr()}.csv`, [header.map(csvCell).join(','), ...body].join('\n'), 'text/csv;charset=utf-8');
}

function getStaffClientInitials(name = '') {
  const parts = String(name || 'Client')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  return (parts.map(part => part[0]).join('') || 'CL').toUpperCase();
}

function staffClientJs(value) {
  // escapeHtml sur le littéral JSON : sans ça les guillemets doubles de
  // JSON.stringify cassent l'attribut onclick="..." (double quotes) et le
  // handler devient un no-op silencieux (boutons fantômes Terrain/Groupes).
  // Encodé en entités, l'argument est valable dans onclick="" comme onclick=''.
  return escapeHtml(JSON.stringify(String(value || '')).replace(/</g, '\\u003c'));
}

function renderStaffClientIcon(name) {
  const icons = {
    users: '<circle cx="8.5" cy="8" r="3"></circle><path d="M3.5 19c.7-3.4 2.6-5.1 5-5.1s4.3 1.7 5 5.1"></path><path d="M16 10a2.6 2.6 0 1 0 0-5"></path><path d="M17 14c1.9.5 3.1 2.1 3.5 5"></path>',
    user: '<circle cx="12" cy="8" r="3.2"></circle><path d="M5.5 19c.9-3.6 3.2-5.4 6.5-5.4s5.6 1.8 6.5 5.4"></path>',
    star: '<path d="m12 3 2.7 5.5 6 .9-4.3 4.2 1 6-5.4-2.9-5.4 2.9 1-6-4.3-4.2 6-.9z"></path>',
    euro: '<path d="M17.5 6.5A6 6 0 1 0 18 17"></path><path d="M5 10h8M5 14h8"></path>',
    mail: '<rect x="4" y="6" width="16" height="12" rx="2"></rect><path d="m5 8 7 5 7-5"></path>',
    phone: '<path d="M8 5 5.5 7.5c-.5.5-.6 1.3-.2 2 1.9 3.6 5.6 7.3 9.2 9.2.7.4 1.5.3 2-.2L19 16l-3-3-1.7 1.7c-1.4-.8-2.2-1.6-3-3L13 10z"></path>',
    clock: '<circle cx="12" cy="12" r="8"></circle><path d="M12 7v5l3 2"></path>',
    search: '<circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path>',
    filter: '<path d="M4 5h16"></path><path d="M7 12h10"></path><path d="M10 19h4"></path>',
    import: '<path d="M12 3v11"></path><path d="m8 10 4 4 4-4"></path><path d="M5 20h14"></path>',
    refresh: '<path d="M20 12a8 8 0 0 1-13.6 5.7"></path><path d="M4 12A8 8 0 0 1 17.6 6.3"></path><path d="M17.5 3.5v3h-3"></path><path d="M6.5 20.5v-3h3"></path>',
    plus: '<path d="M12 5v14"></path><path d="M5 12h14"></path>',
    columns: '<rect x="4" y="5" width="6" height="14" rx="1.5"></rect><rect x="14" y="5" width="6" height="14" rx="1.5"></rect>'
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.user}</svg>`;
}

function getStaffClientRange() {
  const anchor = state.currentDate || todayStr();
  return {
    startDate: addDays(anchor, -120),
    endDate: addDays(anchor, 120)
  };
}

function getStaffClientCacheKey() {
  const range = getStaffClientRange();
  return `${getActiveOpsCenterId()}|${range.startDate}|${range.endDate}`;
}

function mergeReservationsById(lists = []) {
  const map = new Map();
  lists.flat().forEach(reservation => {
    if (!reservation) return;
    const id = reservation.id != null ? String(reservation.id) : `${reservation.date}|${reservation.startTime}|${reservation.name}|${reservation.phone}`;
    map.set(id, reservation);
  });
  return sortReservations([...map.values()]);
}

// Le serveur fait AUTORITE dans la fenetre qu'il vient de servir.
//
// state.reservations est persiste en localStorage (save() serialise tout state).
// Le fusionner par simple union avec une reponse serveur ressuscite donc, a
// chaque rendu, des reservations que le serveur ne renvoie plus - une union ne
// peut jamais RETIRER une ligne. Symptome vu le 2026-07-27 : apres la purge de
// la base, le calendrier affichait encore 24 resas et 4956 EUR, et les
// compteurs ne se corrigeaient qu'au clic sur chaque jour (seul chemin qui
// appelait replaceReservationsForDate).
//
// Regle : a l'interieur de [windowStart, windowEnd], une resa locale absente de
// la reponse serveur est consideree SUPPRIMEE. Deux exceptions gardees :
//   - hors fenetre, le serveur n'a rien dit : on conserve le local ;
//   - une mutation locale en vol (creation/edition optimiste) survit, sinon la
//     ligne clignoterait le temps de l'aller-retour.
function keepLocalWithinServerAuthority(localList, serverList, windowStart, windowEnd) {
  const serverIds = new Set((serverList || []).map(r => String(r && r.id)));
  return (localList || []).filter(reservation => {
    if (!reservation) return false;
    const date = String(reservation.date || '');
    const inWindow = !!date && (!windowStart || date >= windowStart) && (!windowEnd || date <= windowEnd);
    if (!inWindow) return true;
    if (serverIds.has(String(reservation.id))) return true;
    return pendingReservationMutations.has(getReservationWriteKey(reservation.id));
  });
}

function getStaffClientSourceReservations() {
  const centerId = getActiveOpsCenterId();
  const cacheReservations = staffClientDataCache.loaded ? (staffClientDataCache.reservations || []) : [];
  const reservationCache = staffReservationsDataCache.loaded ? (staffReservationsDataCache.reservations || []) : [];
  // Autorite serveur sur la fenetre du cache clients (anchor +/- 120 j). Sans
  // ca, le CRM comptait des clients dont toutes les resas avaient disparu.
  let local = state.reservations || [];
  if (staffClientDataCache.loaded) {
    const range = getStaffClientRange();
    local = keepLocalWithinServerAuthority(local, cacheReservations, range.startDate, range.endDate);
  }
  return mergeReservationsById([cacheReservations, reservationCache, local])
    .filter(reservation => (reservation.centerId || reservation.center_id || centerId) === centerId);
}

async function loadStaffClientData(force = false) {
  const key = getStaffClientCacheKey();
  if (!force && staffClientDataCache.loading) return;
  if (!force && staffClientDataCache.loaded && staffClientDataCache.key === key) return;
  const range = getStaffClientRange();
  staffClientDataCache = {
    ...staffClientDataCache,
    key,
    loading: true,
    error: ''
  };
  if (isStaffClientsActive()) renderStaffClientsPage();
  else if (isStaffUtilityActive()) renderStaffUtilityPage();
  try {
    const centerQuery = encodeURIComponent(getActiveOpsCenterId());
    const startDate = encodeURIComponent(range.startDate);
    const endDate = encodeURIComponent(range.endDate);
    const payload = await apiRequest(`${API_ENDPOINTS.adminRange}?startDate=${startDate}&endDate=${endDate}&centerId=${centerQuery}`);
    staffClientDataCache = {
      key,
      loading: false,
      loaded: true,
      error: '',
      reservations: payload.reservations || [],
      syncedAt: payload.syncedAt || new Date().toISOString(),
      loadedAt: Date.now()
    };
  } catch (error) {
    staffClientDataCache = {
      ...staffClientDataCache,
      key,
      loading: false,
      loaded: false,
      error: error.message || 'Chargement clients impossible.'
    };
  }
  if (isStaffClientsActive()) renderStaffClientsPage();
  else if (isStaffUtilityActive()) renderStaffUtilityPage();
}

function ensureStaffClientData() {
  const key = getStaffClientCacheKey();
  if (staffClientDataCache.key !== key || (!staffClientDataCache.loaded && !staffClientDataCache.loading && !staffClientDataCache.error)) {
    loadStaffClientData(false);
  }
}

// ── Communications par client (mails/relances) : cache page dédié ──────────────
// On charge l'historique des communications du centre (même source que le studio
// mails) dans un cache propre à la page CRM, puis on filtre par destinataire
// (email/téléphone) ou par réservation. Découplé de la console admin (pas de
// dépendance au module ops lourd). Dégrade proprement si l'API refuse (permissions).
let staffClientCommsCache = { key: '', loading: false, loaded: false, error: '', items: [], loadedAt: 0 };

function getStaffClientCommsKey() {
  return getActiveOpsCenterId();
}

async function loadStaffClientComms(force = false) {
  const key = getStaffClientCommsKey();
  if (!force && staffClientCommsCache.loading) return;
  if (!force && staffClientCommsCache.loaded && staffClientCommsCache.key === key) return;
  staffClientCommsCache = { ...staffClientCommsCache, key, loading: true, error: '' };
  try {
    const centerQuery = encodeURIComponent(getActiveOpsCenterId());
    const payload = await apiRequest(`/api/ops?action=communications&centerId=${centerQuery}&limit=300`);
    staffClientCommsCache = { key, loading: false, loaded: true, error: '', items: Array.isArray(payload.communications) ? payload.communications : [], loadedAt: Date.now() };
  } catch (error) {
    staffClientCommsCache = { ...staffClientCommsCache, key, loading: false, loaded: false, error: error.message || 'indisponible' };
  }
  if (isStaffClientsActive()) renderStaffClientsPage();
}

function ensureStaffClientComms(force = false) {
  const key = getStaffClientCommsKey();
  if (force || staffClientCommsCache.key !== key || (!staffClientCommsCache.loaded && !staffClientCommsCache.loading && !staffClientCommsCache.error)) {
    loadStaffClientComms(force);
  }
}

function staffClientPhoneDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

// Retourne la liste des communications du client (triée récent→ancien), ou null si
// le cache n'est pas encore chargé (permet de distinguer "0 message" de "inconnu").
function getStaffClientCommunications(row) {
  if (!row || !staffClientCommsCache.loaded) return null;
  const email = String(row.email || '').trim().toLowerCase();
  const phone = staffClientPhoneDigits(row.phone);
  const reservationIds = new Set((row.history || []).map(entry => Number(entry.id)).filter(Boolean));
  return staffClientCommsCache.items
    .filter(comm => {
      if (comm.reservationId && reservationIds.has(Number(comm.reservationId))) return true;
      const recipient = String(comm.recipient || '').trim().toLowerCase();
      if (!recipient) return false;
      if (email && recipient === email) return true;
      if (phone && staffClientPhoneDigits(recipient) === phone) return true;
      return false;
    })
    .sort((a, b) => String(b.sentAt || b.createdAt || '').localeCompare(String(a.sentAt || a.createdAt || '')));
}

function getStaffClientCommsCount(row) {
  const list = getStaffClientCommunications(row);
  return list === null ? -1 : list.length;
}

// ── File staff des DEMANDES SUR MESURE (leads hors planning) ───────────────
// Clé centre OBLIGATOIRE : ce cache alimente maintenant des compteurs visibles
// (alerte dashboard, badge menu, badge de segment, tuile Clients). Sans clé, le
// TTL de 60 s afficherait les leads de l'ancien centre après un changement de
// centre (selectMenuCenter ne purge pas ce cache). Même mécanique que
// staffReservationsDataCache.
let staffCustomRequestsCache = { key: '', loading: false, loaded: false, error: '', items: [], loadedAt: 0 };

async function loadStaffCustomRequests(force = false) {
  const centerKey = String(getActiveOpsCenterId());
  if (staffCustomRequestsCache.key !== centerKey) {
    staffCustomRequestsCache = { key: centerKey, loading: false, loaded: false, error: '', items: [], loadedAt: 0 };
  }
  if (!force && staffCustomRequestsCache.loading) return;
  if (!force && staffCustomRequestsCache.loaded && (Date.now() - staffCustomRequestsCache.loadedAt) < 60000) return;
  staffCustomRequestsCache = { ...staffCustomRequestsCache, key: centerKey, loading: true, error: '' };
  renderStaffGroupHost();
  try {
    const centerQuery = encodeURIComponent(centerKey);
    const payload = await apiRequest(`${API_ENDPOINTS.ops}?action=customRequests&centerId=${centerQuery}&limit=100`);
    staffCustomRequestsCache = {
      key: centerKey,
      loading: false,
      loaded: true,
      error: '',
      items: Array.isArray(payload.customRequests) ? payload.customRequests : [],
      loadedAt: Date.now()
    };
  } catch (error) {
    staffCustomRequestsCache = {
      ...staffCustomRequestsCache,
      key: centerKey,
      loading: false,
      error: error.message || 'Chargement des demandes impossible.'
    };
  }
  renderStaffGroupHost();
  // Le menu ne se reconstruit que sur appel explicite : sans ça le badge
  // « Clients » resterait figé sur la valeur du dernier rendu d'auth.
  if (typeof window.renderStaffMenu === 'function') window.renderStaffMenu();
}

function ensureStaffCustomRequests() {
  if (staffCustomRequestsCache.key !== String(getActiveOpsCenterId())) { loadStaffCustomRequests(false); return; }
  if (!staffCustomRequestsCache.loaded && !staffCustomRequestsCache.loading) loadStaffCustomRequests(false);
}

// Items du centre ACTIF uniquement. Toute lecture passe par ici : un cache
// resté sur l'ancien centre ne doit jamais alimenter un affichage.
function getStaffCustomRequestItems() {
  if (staffCustomRequestsCache.key !== String(getActiveOpsCenterId())) return [];
  return staffCustomRequestsCache.items || [];
}

// Source UNIQUE du chiffre « nouvelles demandes ». Toute surface qui affiche un
// nombre de leads passe par ici : un seul endroit à corriger si la définition
// change.
function getStaffNewCustomRequestCount() {
  return getStaffCustomRequestItems().filter(item => item.status === 'new').length;
}
window.getStaffNewCustomRequestCount = getStaffNewCustomRequestCount;

// DEUX COMPTAGES POUR UN MEME OBJET, C EST UNE CONTRADICTION A L ECRAN.
// Movsar, 2026-08-14, capture a l appui : la tuile « Demandes sur mesure »
// annoncait « 0 · aucune en attente » pendant que le panneau juste en dessous
// listait « 1 demande(s) active(s) », une demande d Ansar Bisultanov en cours.
// Les deux disaient vrai selon leur propre definition : la tuile comptait le
// statut `new`, le panneau comptait tout ce qui n est pas archive. Une demande
// qu on a commence a traiter disparaissait donc du compteur alors qu elle reste
// A FAIRE. C est le compte du panneau qui fait foi : tant qu une demande n est
// ni traitee ni archivee, elle attend quelqu un.
function getStaffActiveCustomRequestCount() {
  return getStaffCustomRequestItems().filter(item => item.status !== 'archived' && item.status !== 'handled').length;
}
window.getStaffActiveCustomRequestCount = getStaffActiveCustomRequestCount;

// La tuile MENE aux demandes au lieu de changer de segment. Elle declenchait
// `setStaffClientSegment('avenir')`, donc un clic sur « Demandes sur mesure »
// affichait les reservations a venir : deux sujets sans rapport, et le sentiment
// que le bouton est casse (verbatim : « ca nous met d office avec reservation a
// venir, c est pas complet du tout »).
function focusStaffCustomRequests() {
  if (typeof ensureStaffCustomRequests === 'function') ensureStaffCustomRequests();
  const panneau = document.querySelector('.cr-panel');
  if (!panneau) return;
  panneau.scrollIntoView({ behavior: 'smooth', block: 'center' });
  panneau.classList.add('is-called');
  window.setTimeout(() => panneau.classList.remove('is-called'), 1600);
}
window.focusStaffCustomRequests = focusStaffCustomRequests;

async function setStaffCustomRequestStatus(id, status) {
  try {
    await apiRequest(API_ENDPOINTS.ops, {
      method: 'POST',
      body: JSON.stringify({ action: 'customRequestStatus', id, status, centerId: getActiveOpsCenterId() })
    });
    // Mise à jour optimiste locale puis rechargement serveur (source de vérité).
    staffCustomRequestsCache.items = (staffCustomRequestsCache.items || []).map(item =>
      String(item.id) === String(id) ? { ...item, status } : item);
    renderStaffGroupHost();
    loadStaffCustomRequests(true);
    toast('Demande mise à jour.');
  } catch (error) {
    toast(error.message || 'Mise à jour impossible.');
  }
}

function renderStaffCustomRequestBadge(status) {
  const map = {
    new: ['Nouvelle', 'new'],
    in_progress: ['En cours', 'progress'],
    handled: ['Traitée', 'handled'],
    archived: ['Archivée', 'archived']
  };
  const [label, cls] = map[status] || map.new;
  return `<span class="cr-badge cr-badge-${cls}">${escapeHtml(label)}</span>`;
}

function renderStaffCustomRequestCard(item) {
  const occKey = String(item.occasion || '').toLowerCase();
  const occ = STAFF_OCCASION_LABELS[occKey] || '';
  const meta = [
    item.company,
    item.phone,
    item.requestedDate ? `Souhait : ${item.requestedDate}` : '',
    Number(item.pax) > 0 ? `${item.pax} pers.` : ''
  ].filter(Boolean).join(' · ');
  const jid = staffClientJs(item.id);
  // La carte entiere ouvre la fiche : c'est la ligne de liste d'un dossier, et
  // une ligne de liste s'ouvre. Les boutons d'action gardent leur propre clic.
  return `<article class="cr-card cr-status-${escapeHtml(item.status)}" role="button" tabindex="0"
      onclick="openStaffCustomRequest(${jid})"
      onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openStaffCustomRequest(${jid});}">
    <div class="cr-card-head">
      <div class="cr-card-ident">
        <strong>${escapeHtml(item.contactName || 'Contact')}</strong>
        ${occ ? `<span class="res-occasion-tag res-occasion-${escapeHtml(occKey)}">${escapeHtml(occ)}</span>` : ''}
      </div>
      ${renderStaffCustomRequestBadge(item.status)}
    </div>
    ${meta ? `<div class="cr-meta">${escapeHtml(meta)}</div>` : ''}
    ${item.email ? `<div class="cr-meta cr-email">${escapeHtml(item.email)}</div>` : ''}
    <p class="cr-message">${escapeHtml(item.message || '')}</p>
    <div class="cr-actions" onclick="event.stopPropagation()">
      ${item.email ? `<button type="button" onclick="composeStaffClientEmail(${staffClientJs(item.email)}, ${staffClientJs(item.contactName || '')})">Répondre</button>` : ''}
      ${item.status !== 'in_progress' && item.status !== 'handled' ? `<button type="button" onclick="setStaffCustomRequestStatus(${jid}, 'in_progress')">Prendre en charge</button>` : ''}
      ${item.status !== 'handled' ? `<button type="button" class="success" onclick="setStaffCustomRequestStatus(${jid}, 'handled')">Marquer traitée</button>` : ''}
      <button type="button" class="ghost" onclick="setStaffCustomRequestStatus(${jid}, 'archived')">Archiver</button>
    </div>
  </article>`;
}

// UNE DEMANDE SUR MESURE S OUVRE, COMME UNE RESERVATION.
// Movsar, 2026-08-14 : « les demandes sur mesure, on sait rien faire, on sait
// pas voir la demande, il n'y a rien qui y est dedie ». Elles ne vivaient que
// dans une carte d un panneau lateral de la page Clients : le message y est
// borne par la largeur de la colonne, rien n est cliquable, et un dossier qui
// ne s ouvre pas ne se traite pas. C est pourtant le SEUL endroit ou arrive une
// demande d entreprise ou de groupe, c est-a-dire les plus gros paniers.
// La fiche reprend la forme des fiches de reservation : un en-tete qui dit qui
// et quand, un corps qui commence par l ACTION, le message en entier, et les
// coordonnees cliquables (telephone et email s ouvrent vraiment).
let staffCustomRequestFocusReturn = null;

function openStaffCustomRequest(id) {
  const item = getStaffCustomRequestItems().find(entry => String(entry.id) === String(id));
  const overlay = document.getElementById('crOverlay');
  if (!item || !overlay) return;
  staffCustomRequestFocusReturn = document.activeElement;
  const occKey = String(item.occasion || '').toLowerCase();
  const occ = STAFF_OCCASION_LABELS[occKey] || '';
  const jid = staffClientJs(item.id);
  const faits = [
    item.company ? ['Société', item.company] : null,
    item.requestedDate ? ['Date souhaitée', item.requestedDate] : null,
    Number(item.pax) > 0 ? ['Participants', `${item.pax} personnes`] : null,
    occ ? ['Occasion', occ] : null,
  ].filter(Boolean);
  overlay.className = 'cr-sheet-overlay';
  overlay.innerHTML = `<div class="cr-sheet" role="dialog" aria-modal="true" aria-labelledby="crSheetTitle">
    <div class="cr-sheet-head">
      <div>
        <h2 id="crSheetTitle">${escapeHtml(item.contactName || 'Contact')}</h2>
        <p>${escapeHtml([item.company, occ, Number(item.pax) > 0 ? `${item.pax} personnes` : '', item.requestedDate ? `souhait ${item.requestedDate}` : ''].filter(Boolean).join(' · ') || 'Demande sur mesure')}</p>
      </div>
      <button type="button" class="cr-sheet-close" onclick="closeStaffCustomRequest()" aria-label="Fermer">×</button>
    </div>
    <div class="cr-sheet-body">
      <section class="cr-sheet-action">
        <span class="cr-sheet-label">Que faire</span>
        <div class="cr-sheet-buttons">
          ${item.email ? `<button type="button" class="primary" onclick="composeStaffClientEmail(${staffClientJs(item.email)}, ${staffClientJs(item.contactName || '')})">Répondre par email</button>` : ''}
          ${item.status !== 'in_progress' && item.status !== 'handled' ? `<button type="button" onclick="setStaffCustomRequestStatus(${jid}, 'in_progress'); closeStaffCustomRequest();">Prendre en charge</button>` : ''}
          ${item.status !== 'handled' ? `<button type="button" class="success" onclick="setStaffCustomRequestStatus(${jid}, 'handled'); closeStaffCustomRequest();">Marquer traitée</button>` : ''}
          <button type="button" class="ghost" onclick="setStaffCustomRequestStatus(${jid}, 'archived'); closeStaffCustomRequest();">Archiver</button>
        </div>
      </section>
      <section class="cr-sheet-block">
        <span class="cr-sheet-label">Sa demande</span>
        <p class="cr-sheet-message">${escapeHtml(item.message || 'Aucun message.')}</p>
      </section>
      ${faits.length ? `<section class="cr-sheet-block">
        <span class="cr-sheet-label">Le besoin</span>
        <dl class="cr-sheet-facts">${faits.map(([cle, valeur]) => `<div><dt>${escapeHtml(cle)}</dt><dd>${escapeHtml(String(valeur))}</dd></div>`).join('')}</dl>
      </section>` : ''}
      <section class="cr-sheet-block">
        <span class="cr-sheet-label">Le joindre</span>
        <div class="cr-sheet-contact">
          ${item.phone ? `<a href="tel:${escapeHtml(String(item.phone).replace(/\s+/g, ''))}">${escapeHtml(item.phone)}</a>` : ''}
          ${item.email ? `<a href="mailto:${escapeHtml(item.email)}">${escapeHtml(item.email)}</a>` : ''}
          ${!item.phone && !item.email ? '<span class="cr-sheet-empty">Aucune coordonnée fournie.</span>' : ''}
        </div>
      </section>
    </div>
  </div>`;
  overlay.classList.remove('hidden');
  const premier = overlay.querySelector('button, a[href]');
  if (premier) premier.focus();
}
window.openStaffCustomRequest = openStaffCustomRequest;

function closeStaffCustomRequest() {
  const overlay = document.getElementById('crOverlay');
  if (!overlay) return;
  overlay.className = 'hidden';
  overlay.innerHTML = '';
  if (staffCustomRequestFocusReturn && typeof staffCustomRequestFocusReturn.focus === 'function') {
    staffCustomRequestFocusReturn.focus();
  }
  staffCustomRequestFocusReturn = null;
}
window.closeStaffCustomRequest = closeStaffCustomRequest;

function renderStaffCustomRequestsPanel() {
  const cache = staffCustomRequestsCache;
  const items = getStaffCustomRequestItems().filter(item => item.status !== 'archived');
  const newCount = getStaffNewCustomRequestCount();
  const head = `<div class="cr-panel-head">
    <div>
      <strong>Demandes sur mesure${newCount ? ` <span class="cr-count">${newCount}</span>` : ''}</strong>
      <span>${cache.loading ? renderThinking('searching', { label: 'Lecture des demandes' }) : `${items.length} demande(s) active(s)${newCount ? ` · ${newCount} nouvelle(s)` : ''}`}</span>
    </div>
    <button type="button" onclick="loadStaffCustomRequests(true)">Actualiser</button>
  </div>`;
  let body;
  if (cache.loading && !items.length) {
    body = `<div class="cr-empty">${renderThinking('searching', { size: 64, label: 'Lecture des demandes' })}</div>`;
  } else if (cache.error) {
    body = `<div class="cr-empty cr-error">${escapeHtml(cache.error)}</div>`;
  } else if (!items.length) {
    body = `<div class="cr-empty">Aucune demande sur mesure en attente. Les demandes entreprises et besoins spéciaux envoyées depuis la page client apparaissent ici, sans occuper le planning.</div>`;
  } else {
    body = items.map(renderStaffCustomRequestCard).join('');
  }
  return `<section class="cr-panel">${head}<div class="cr-list">${body}</div></section>`;
}

function getStaffClientTone(seed = '') {
  const tones = ['violet', 'blue', 'green', 'gold', 'teal'];
  const score = String(seed || 'client').split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return tones[score % tones.length];
}

function getMonthKey(dateValue = state.currentDate || todayStr()) {
  return String(dateValue || '').slice(0, 7);
}

function getPreviousMonthKey(monthKey = getMonthKey()) {
  const date = parseLocalDate(`${monthKey}-01`);
  date.setMonth(date.getMonth() - 1);
  return toLocalDateStr(date).slice(0, 7);
}

function staffClientDaysBetween(left, right) {
  if (!left || !right) return 0;
  return Math.round((parseLocalDate(left) - parseLocalDate(right)) / 86400000);
}

function getStaffClientReservationKey(reservation) {
  const phone = String(reservation.phone || '').replace(/\D/g, '');
  if (phone) return `tel:${phone}`;
  const email = String(reservation.email || '').trim().toLowerCase();
  if (email) return `mail:${email}`;
  return `name:${String(reservation.name || 'client').trim().toLowerCase()}`;
}

function getStaffClientOfferLabel(reservation) {
  if (!reservation) return 'Réservation';
  if (reservation.type === 'laser') return getLaserGameCountForReservation(reservation) > 1 ? `Laser x${getLaserGameCountForReservation(reservation)}` : 'Laser Game';
  if (reservation.type === 'formule' || reservation.formuleId) return getReservationLabel(reservation);
  return `Bowling ${formatDurationLabel(reservation.duration || 1)}`;
}

function formatStaffClientDateText(dateValue) {
  if (!dateValue) return '--';
  return parseLocalDate(dateValue)
    .toLocaleDateString('fr-BE', { day: 'numeric', month: 'short', year: 'numeric' })
    .replace('.', '');
}

function formatStaffClientAgo(dateValue) {
  if (!dateValue) return '';
  const diff = staffClientDaysBetween(todayStr(), dateValue);
  if (diff === 0) return "Aujourd'hui";
  if (diff === 1) return 'Il y a 1 jour';
  if (diff > 1) return `Il y a ${diff} jours`;
  if (diff === -1) return 'Demain';
  return `Dans ${Math.abs(diff)} jours`;
}

function formatStaffClientStatus(status = 'pending') {
  const labels = {
    pending: 'Confirmé',
    arrived: 'Arrivé',
    paid: 'Payé',
    cancelled: 'Annulé'
  };
  return labels[status] || status || 'Confirmé';
}

function buildStaffClientRowsFromReservations(reservations = []) {
  const groups = new Map();
  reservations.forEach(reservation => {
    if (!reservation || !reservation.name) return;
    const key = getStaffClientReservationKey(reservation);
    const profile = groups.get(key) || {
      key,
      id: `client-${key.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 70) || groups.size}`,
      name: reservation.name || 'Client',
      phone: reservation.phone || '',
      email: reservation.email || '',
      reservationsRaw: [],
      visits: 0,
      players: 0,
      revenue: 0,
      cancellations: 0,
      formulas: 0,
      maxPax: 0,
      firstDate: '',
      lastDate: ''
    };
    profile.name = profile.name || reservation.name || 'Client';
    profile.phone = profile.phone || reservation.phone || '';
    profile.email = profile.email || reservation.email || '';
    profile.reservationsRaw.push(reservation);
    if (reservation.status === 'cancelled') {
      profile.cancellations += 1;
    } else {
      profile.visits += 1;
      profile.players += Number(reservation.pax || 0);
      profile.revenue += Number(reservation.price || 0);
      profile.maxPax = Math.max(profile.maxPax, Number(reservation.pax || 0));
      if (reservation.type === 'formule' || reservation.formuleId) profile.formulas += 1;
      if (!profile.firstDate || reservation.date < profile.firstDate) profile.firstDate = reservation.date;
      if (!profile.lastDate || reservation.date > profile.lastDate) profile.lastDate = reservation.date;
    }
    groups.set(key, profile);
  });

  return [...groups.values()]
    .filter(profile => profile.visits || profile.cancellations)
    .map(profile => {
      const daysSinceLast = profile.lastDate ? staffClientDaysBetween(todayStr(), profile.lastDate) : 999;
      const isNew = profile.firstDate && getMonthKey(profile.firstDate) === getMonthKey(state.currentDate || todayStr());
      // Seuils groupe SERVIS PAR LE CENTRE (éditables côté Établissement).
      const classification = getStaffClassification();
      const isGroup = profile.maxPax >= classification.groupMinPax
        || profile.players >= classification.groupMinCumulative
        || (classification.countFormulaAsGroup && profile.formulas > 0);
      // Occasion DÉCLARÉE : on prend la plus récente réservation qui en porte une.
      const declaredOccasionSource = [...profile.reservationsRaw]
        .sort((left, right) => `${right.date || ''} ${right.startTime || ''}`.localeCompare(`${left.date || ''} ${left.startTime || ''}`))
        .find(reservation => STAFF_OCCASION_LABELS[String(reservation.occasion || '').toLowerCase()]);
      const declaredOccasion = declaredOccasionSource
        ? String(declaredOccasionSource.occasion).toLowerCase()
        : '';
      // hasBirthday : une résa avec une FORMULE anniversaire (f1-f8 par défaut,
      // configurable) compte comme anniversaire ; sinon occasion déclarée ;
      // sinon repli regex (rétrocompat anciennes réservations sans occasion).
      const hasBirthdayFormula = profile.reservationsRaw.some(reservation =>
        reservation.status !== 'cancelled' && isStaffBirthdayFormulaReservation(reservation, classification));
      const hasBirthday = hasBirthdayFormula || (declaredOccasion
        ? declaredOccasion === 'anniversaire'
        : profile.reservationsRaw.some(reservation => /anniversaire|birthday|enfant/i.test(`${reservation.name || ''} ${reservation.label || ''} ${reservation.notes || ''}`)));
      const status = profile.revenue >= 500 || profile.visits >= 4
        ? 'Fidèle'
        : isNew
          ? 'Nouveau'
          : daysSinceLast > 90
            ? 'Inactif'
            : 'Actif';
      const statusClass = status === 'Fidèle' ? 'loyal' : status === 'Nouveau' ? 'new' : status === 'Inactif' ? 'inactive' : 'active';
      const sortedReservations = [...profile.reservationsRaw].sort((left, right) => {
        const leftKey = `${left.date || ''} ${left.startTime || ''}`;
        const rightKey = `${right.date || ''} ${right.startTime || ''}`;
        return rightKey.localeCompare(leftKey);
      });
      const lastBooking = sortedReservations.find(reservation => reservation.status !== 'cancelled') || sortedReservations[0] || null;
      // ── Agrégats "data à mort" (dérivés SANS réseau des réservations en main) ──
      const activeRes = profile.reservationsRaw.filter(reservation => reservation.status !== 'cancelled');
      const totalBookings = profile.visits + profile.cancellations;
      const avgBasket = profile.visits ? profile.revenue / profile.visits : 0;
      const avgPlayers = profile.visits ? profile.players / profile.visits : 0;
      const cancelRate = totalBookings ? profile.cancellations / totalBookings : 0;
      const tenureDays = profile.firstDate ? staffClientDaysBetween(todayStr(), profile.firstDate) : 0;
      const frequencyPerMonth = tenureDays > 15 ? (profile.visits / (tenureDays / 30)) : profile.visits;
      const visitDates = [...new Set(activeRes.map(reservation => reservation.date).filter(Boolean))].sort();
      let avgIntervalDays = 0;
      if (visitDates.length > 1) {
        let intervalSum = 0;
        for (let i = 1; i < visitDates.length; i += 1) intervalSum += staffClientDaysBetween(visitDates[i], visitDates[i - 1]);
        avgIntervalDays = Math.round(intervalSum / (visitDates.length - 1));
      }
      const typeBreakdown = { bowling: 0, laser: 0, formule: 0 };
      const formuleCount = {};
      const channelCount = { staff: 0, public: 0 };
      const occasionsSet = new Set();
      const centersSet = new Set();
      const paymentCount = {};
      let laserGamesTotal = 0;
      let bowlingHoursTotal = 0;
      let totalDurationBooked = 0;
      let paidCount = 0;
      let leadSum = 0;
      let leadN = 0;
      let activityDone = 0;
      let activityTotal = 0;
      const notesParts = [];
      activeRes.forEach(reservation => {
        const t = (reservation.type === 'formule' || reservation.formuleId) ? 'formule' : (reservation.type === 'laser' ? 'laser' : 'bowling');
        typeBreakdown[t] += 1;
        if (reservation.formuleId) formuleCount[reservation.formuleId] = (formuleCount[reservation.formuleId] || 0) + 1;
        const ch = reservation.channel === 'staff' ? 'staff' : 'public';
        channelCount[ch] += 1;
        const occ = String(reservation.occasion || '').toLowerCase();
        if (occ && STAFF_OCCASION_LABELS[occ]) occasionsSet.add(occ);
        const center = reservation.centerId || reservation.center_id;
        if (center) centersSet.add(center);
        if ((reservation.type === 'laser' || reservation.formuleId || reservation.type === 'formule') && typeof getLaserGameCountForReservation === 'function') {
          laserGamesTotal += Number(getLaserGameCountForReservation(reservation)) || 0;
        }
        if (typeof getBowlingDurationForReservation === 'function') bowlingHoursTotal += Number(getBowlingDurationForReservation(reservation)) || 0;
        totalDurationBooked += Number(reservation.totalDuration || reservation.duration || 0);
        if (reservation.status === 'paid') paidCount += 1;
        if (reservation.paymentMethod) paymentCount[reservation.paymentMethod] = (paymentCount[reservation.paymentMethod] || 0) + 1;
        if (reservation.createdAt && reservation.date) {
          const lead = staffClientDaysBetween(reservation.date, String(reservation.createdAt).slice(0, 10));
          if (Number.isFinite(lead)) { leadSum += Math.max(0, lead); leadN += 1; }
        }
        if ((reservation.type === 'formule' || reservation.formuleId) && typeof getFormulaActivityProgressSummary === 'function') {
          const summary = getFormulaActivityProgressSummary(reservation);
          activityDone += summary.done; activityTotal += summary.total;
        }
        const note = String(reservation.notes || '').trim();
        if (note) notesParts.push(note);
      });
      const favoriteType = Object.keys(typeBreakdown).sort((a, b) => typeBreakdown[b] - typeBreakdown[a]).find(k => typeBreakdown[k] > 0) || '';
      const favoriteFormula = Object.keys(formuleCount).sort((a, b) => formuleCount[b] - formuleCount[a])[0] || '';
      const preferredChannel = channelCount.staff > channelCount.public ? 'Comptoir' : channelCount.public > 0 ? 'En ligne' : '';
      const paymentMethodDominant = Object.keys(paymentCount).sort((a, b) => paymentCount[b] - paymentCount[a])[0] || '';
      const paidShare = profile.visits ? paidCount / profile.visits : 0;
      const leadTimeAvgDays = leadN ? Math.round(leadSum / leadN) : 0;
      const activityCompletionRate = activityTotal ? activityDone / activityTotal : 0;
      let favoriteLabel = '';
      if (favoriteFormula && typeof FORMULES !== 'undefined') {
        const f = FORMULES.find(item => item.id === favoriteFormula);
        favoriteLabel = f ? f.name : 'Formule';
      } else if (favoriteType === 'laser') favoriteLabel = 'Laser Game';
      else if (favoriteType === 'bowling') favoriteLabel = 'Bowling';
      else if (favoriteType === 'formule') favoriteLabel = 'Formule';
      const nextBooking = [...activeRes]
        .filter(reservation => reservation.date && reservation.date > todayStr())
        .sort((a, b) => `${a.date} ${a.startTime || ''}`.localeCompare(`${b.date} ${b.startTime || ''}`))[0] || null;
      // « Anniversaire À VENIR » ne se decide que sur la PROCHAINE reservation.
      // Avant, le badge sortait des que le client avait DEJA pris une formule
      // anniversaire un jour (hasBirthday, historique) : sur un fichier client
      // ou la moitie des resas sont des formules f1-f8, toutes les lignes
      // portaient « Anniv. a venir ». Un badge que tout le monde porte
      // n'informe plus personne.
      const nextIsBirthday = Boolean(nextBooking) && (
        String(nextBooking.occasion || '').toLowerCase() === 'anniversaire'
        || isStaffBirthdayFormulaReservation(nextBooking, classification)
      );
      const recencyScore = daysSinceLast <= 14 ? 100 : daysSinceLast <= 30 ? 80 : daysSinceLast <= 90 ? 55 : daysSinceLast <= 180 ? 30 : 10;
      const frequencyScore = Math.min(100, profile.visits * 20);
      const monetaryScore = Math.min(100, profile.revenue / 10);
      const engagementScore = Math.round(recencyScore * 0.4 + frequencyScore * 0.3 + monetaryScore * 0.3);
      const tags = [status];
      if (isGroup) tags.push('Groupe');
      if (declaredOccasion && STAFF_OCCASION_LABELS[declaredOccasion]) tags.push(STAFF_OCCASION_LABELS[declaredOccasion]);
      else if (hasBirthday) tags.push('Anniversaire');
      return {
        id: profile.id,
        key: profile.key,
        name: profile.name,
        email: profile.email,
        phone: profile.phone,
        declaredOccasion,
        status,
        statusClass,
        lastVisit: formatStaffClientDateText(profile.lastDate),
        lastVisitAgo: formatStaffClientAgo(profile.lastDate),
        reservations: profile.visits,
        spent: profile.revenue,
        cancellations: profile.cancellations,
        initials: getStaffClientInitials(profile.name),
        avatarTone: getStaffClientTone(profile.key),
        tags,
        firstDate: profile.firstDate,
        lastDate: profile.lastDate,
        players: profile.players,
        formulas: profile.formulas,
        isGroup,
        hasBirthday,
        lastBooking,
        history: sortedReservations.map(reservation => ({
          id: reservation.id,
          date: formatStaffClientDateText(reservation.date),
          label: getStaffClientOfferLabel(reservation),
          status: formatStaffClientStatus(reservation.status),
          amount: Number(reservation.price || 0) * (reservation.status === 'cancelled' ? -1 : 1),
          reservation
        })),
        // Agrégats enrichis
        daysSinceLast,
        avgBasket,
        avgPlayers,
        cancelRate,
        tenureDays,
        frequencyPerMonth,
        avgIntervalDays,
        favoriteType,
        favoriteFormula,
        favoriteLabel,
        typeBreakdown,
        preferredChannel,
        occasions: [...occasionsSet],
        centers: [...centersSet],
        paymentMethodDominant,
        paidShare,
        laserGamesTotal,
        bowlingHoursTotal,
        totalDurationBooked: Math.round(totalDurationBooked * 10) / 10,
        leadTimeAvgDays,
        activityCompletionRate,
        notesConcat: notesParts.join(' · ').slice(0, 400),
        nextBooking,
        nextIsBirthday,
        engagementScore,
        maxPax: profile.maxPax,
        firstBooking: sortedReservations.length ? sortedReservations[sortedReservations.length - 1] : null
      };
    })
    .sort((left, right) => {
      const dateDelta = String(right.lastDate || '').localeCompare(String(left.lastDate || ''));
      if (dateDelta) return dateDelta;
      return Number(right.spent || 0) - Number(left.spent || 0);
    });
}

function getStaffClientRows() {
  return buildStaffClientRowsFromReservations(getStaffClientSourceReservations());
}

// Segments CRM v4 (KISS) : 4 vues simples, une seule active, re-clic = retour à
// « Tous ». Remplace les familles de facettes + le tri custom (retour client).
function getStaffClientSegment() {
  return ['tous', 'avenir', 'relancer', 'vip'].includes(state.staffClientSegment) ? state.staffClientSegment : 'tous';
}

// « À relancer » = la liste qui rapporte : dormants avec historique, et clients
// dont l'anniversaire fêté ici revient (11-13 mois). Raison = 1 phrase FR.
function getStaffClientRelance(row) {
  const visits = Number(row.reservations || 0);
  const history = Array.isArray(row.history) ? row.history : [];
  const today = staffGroupToday();
  const birthdayPast = history
    .map(entry => entry.reservation)
    .filter(reservation => reservation && String(reservation.status) !== 'cancelled')
    .filter(reservation => String(reservation.occasion || '').toLowerCase() === 'anniversaire'
      || (typeof isStaffBirthdayFormulaReservation === 'function' && isStaffBirthdayFormulaReservation(reservation)))
    .map(reservation => staffClientDaysBetween(today, String(reservation.date || '')))
    .filter(days => days >= 335 && days <= 395);
  if (birthdayPast.length) {
    return { due: true, kind: 'anniversaire', reason: 'Anniversaire fêté ici il y a ~1 an, ça se re-réserve maintenant' };
  }
  const daysSince = Number(row.daysSinceLast || 0);
  if (visits >= 2 && daysSince > 60 && !row.nextBooking) {
    return { due: true, kind: 'dormant', reason: `Venu ${visits}×, plus vu depuis ${daysSince > 90 ? Math.round(daysSince / 30) + ' mois' : daysSince + ' j'}` };
  }
  return { due: false, kind: '', reason: '' };
}

// Seuil « client cle » : le MONTANT regle par le centre (Etablissement >
// Clients & groupes). A 0, repli automatique sur les 20 % qui depensent le
// plus : un seuil relatif vaut mieux que rien, mais il ne se DECIDE pas -
// d'ou le reglage demande par Movsar.
function getStaffClientVipThreshold(allRows) {
  const configured = Number(getStaffClassification().keyClientMinSpend) || 0;
  if (configured > 0) return configured;
  const spends = allRows.map(row => Number(row.spent || 0)).sort((a, b) => b - a);
  return spends.length ? (spends[Math.max(0, Math.floor(spends.length * 0.2) - 1)] || spends[0] || 0) : 0;
}

function getFilteredStaffClientRows() {
  const query = String(state.staffClientQuery || '').trim().toLowerCase();
  const segment = getStaffClientSegment();
  const allRows = getStaffClientRows();
  const vipThreshold = getStaffClientVipThreshold(allRows);
  return sortStaffClientRows(allRows.filter(row => {
    const text = `${row.name} ${row.email} ${row.phone} ${row.status} ${row.tags.join(' ')}`.toLowerCase();
    if (query && !text.includes(query)) return false;
    if (segment === 'relancer') return getStaffClientRelance(row).due;
    if (segment === 'vip') return vipThreshold > 0 && Number(row.spent || 0) >= vipThreshold;
    return true;
  }));
}

// Segment cliqué : re-clic sur l'actif → retour « Tous ». Chaque segment pose son
// tri par défaut (les en-têtes de colonnes restent cliquables ensuite).
function setStaffClientSegment(segment) {
  const next = getStaffClientSegment() === segment ? 'tous' : segment;
  state.staffClientSegment = ['tous', 'avenir', 'relancer', 'vip'].includes(next) ? next : 'tous';
  state.staffClientSort = state.staffClientSegment === 'vip' || state.staffClientSegment === 'relancer'
    ? { key: 'spent', dir: 'desc' }
    : { key: 'lastDate', dir: 'desc' };
  if (state.staffClientSegment === 'avenir' && typeof ensureStaffCustomRequests === 'function') ensureStaffCustomRequests();
  save();
  renderStaffClientsPage();
}

// Tri CRM : colonne + direction, appliqué APRÈS filtres, chaque colonne de la
// table est triable, valeurs brutes (lastDate ISO, spent numérique).
function sortStaffClientRows(rows) {
  const { key, dir } = state.staffClientSort || { key: 'lastDate', dir: 'desc' };
  const mul = dir === 'asc' ? 1 : -1;
  const statusWeight = { loyal: 3, active: 2, new: 1, inactive: 0 };
  const num = value => Number(value || 0);
  return [...rows].sort((a, b) => {
    if (key === 'name') return a.name.localeCompare(b.name, 'fr') * mul;
    if (key === 'status') {
      const delta = (statusWeight[a.statusClass] ?? 0) - (statusWeight[b.statusClass] ?? 0);
      return delta ? delta * mul : a.name.localeCompare(b.name, 'fr');
    }
    if (key === 'reservations') return (num(a.reservations) - num(b.reservations)) * mul;
    if (key === 'players') return (num(a.players) - num(b.players)) * mul;
    if (key === 'spent') return (num(a.spent) - num(b.spent)) * mul;
    if (key === 'avgBasket') return (num(a.avgBasket) - num(b.avgBasket)) * mul;
    if (key === 'frequencyPerMonth') return (num(a.frequencyPerMonth) - num(b.frequencyPerMonth)) * mul;
    if (key === 'avgIntervalDays') return (num(a.avgIntervalDays) - num(b.avgIntervalDays)) * mul;
    if (key === 'cancelRate') return (num(a.cancelRate) - num(b.cancelRate)) * mul;
    if (key === 'engagementScore') return (num(a.engagementScore) - num(b.engagementScore)) * mul;
    if (key === 'firstDate') return String(a.firstDate || '').localeCompare(String(b.firstDate || '')) * mul;
    return String(a.lastDate || '').localeCompare(String(b.lastDate || '')) * mul;
  });
}

// Tri par en-tête de colonne : bascule asc/desc si même colonne.
function setStaffClientSort(key) {
  const current = state.staffClientSort || { key: 'lastDate', dir: 'desc' };
  state.staffClientSort = current.key === key
    ? { key, dir: current.dir === 'desc' ? 'asc' : 'desc' }
    : { key, dir: ['name', 'status'].includes(key) ? 'asc' : 'desc' };
  save();
  renderStaffClientsPage();
}

function getStaffClientDailySeries(reservations = [], metric = 'count') {
  const anchor = state.currentDate || todayStr();
  return Array.from({ length: 7 }, (_, index) => addDays(anchor, index - 6)).map(date => {
    const dayReservations = reservations.filter(reservation => reservation.date === date && reservation.status !== 'cancelled');
    if (metric === 'revenue') return dayReservations.reduce((sum, reservation) => sum + Number(reservation.price || 0), 0);
    if (metric === 'players') return dayReservations.reduce((sum, reservation) => sum + Number(reservation.pax || 0), 0);
    return dayReservations.length;
  });
}

function getStaffClientMetrics(rows = getStaffClientRows(), reservations = getStaffClientSourceReservations()) {
  const activeReservations = reservations.filter(reservation => reservation.status !== 'cancelled');
  const monthKey = getMonthKey(state.currentDate || todayStr());
  const previousMonthKey = getPreviousMonthKey(monthKey);
  const totalRevenue = activeReservations.reduce((sum, reservation) => sum + Number(reservation.price || 0), 0);
  const previousMonthRevenue = activeReservations
    .filter(reservation => getMonthKey(reservation.date) === previousMonthKey)
    .reduce((sum, reservation) => sum + Number(reservation.price || 0), 0);
  const currentMonthRevenue = activeReservations
    .filter(reservation => getMonthKey(reservation.date) === monthKey)
    .reduce((sum, reservation) => sum + Number(reservation.price || 0), 0);
  const newThisMonth = rows.filter(row => getMonthKey(row.firstDate) === monthKey).length;
  const previousNew = rows.filter(row => getMonthKey(row.firstDate) === previousMonthKey).length;
  const activeClients = rows.filter(row => row.statusClass !== 'inactive').length;
  const averageSpend = rows.length ? totalRevenue / rows.length : 0;
  const activeShare = rows.length ? Math.round((activeClients / rows.length) * 100) : 0;
  return {
    totalClients: rows.length,
    activeClients,
    loyalClients: rows.filter(row => row.statusClass === 'loyal').length,
    groupClients: rows.filter(row => row.isGroup).length,
    birthdayClients: rows.filter(row => row.hasBirthday).length,
    newThisMonth,
    previousNew,
    activeShare,
    averageSpend,
    currentMonthRevenue,
    previousMonthRevenue,
    reservations: activeReservations.length,
    series: {
      clients: getStaffClientDailySeries(activeReservations, 'count'),
      players: getStaffClientDailySeries(activeReservations, 'players'),
      revenue: getStaffClientDailySeries(activeReservations, 'revenue')
    }
  };
}

let staffClientQueryTimer = 0;
function setStaffClientQuery(value) {
  state.staffClientQuery = value || '';
  // DEBOUNCE 120 ms (retour Movsar 2026-08-07 : « c'est super lent quand
  // j'écris ») : chaque lettre déclenchait un rebuild innerHTML COMPLET de la
  // page (liste + fiche), synchrone, dans la frappe. L'état, lui, suit chaque
  // lettre (rien ne se perd) ; le rendu n'a lieu qu'à la pause de frappe.
  // garderFocus restaure champ et curseur au rendu (bug « douze clics »).
  clearTimeout(staffClientQueryTimer);
  staffClientQueryTimer = setTimeout(() => {
    if (typeof PinlaneMotion !== 'undefined') PinlaneMotion.garderFocus(renderStaffClientsPage);
    else renderStaffClientsPage();
  }, 120);
}

function selectStaffClient(id) {
  state.staffSelectedClientId = id;
  state.staffClientHistoryExpanded = false;
  save();
  renderStaffClientsPage();
}

function refreshStaffClients() {
  loadStaffClientData(true);
}

// Export CSV du SEGMENT courant : la liste prête à l'emploi (relance = avec le
// pourquoi ; marketing = emails). Colonnes réduites à l'utile.
function exportStaffClientsCsv() {
  if (!staffClientDataCache.loaded) { toast('Clients en cours de chargement : patientez avant d\'exporter.'); return; }
  const segment = getStaffClientSegment();
  const rows = getFilteredStaffClientRows();
  const relance = segment === 'relancer';
  const header = ['Client', 'Email', 'Telephone', 'Visites', 'Depense', 'Panier moyen', 'Derniere visite', ...(relance ? ['Pourquoi relancer'] : [])];
  const body = rows.map(row => [
    row.name,
    row.email,
    row.phone,
    row.reservations,
    row.spent,
    Math.round(Number(row.avgBasket) || 0),
    row.lastDate,
    ...(relance ? [getStaffClientRelance(row).reason] : [])
  ].map(csvCell).join(','));
  downloadTextFile(`${getCurrentStaffCenterId()}-clients-${segment}-${state.currentDate || todayStr()}.csv`, [header.map(csvCell).join(','), ...body].join('\n'), 'text/csv;charset=utf-8');
}

function openStaffClientBooking(id = '') {
  const row = id ? getStaffClientRows().find(client => client.id === id) : null;
  openQuickBook({
    name: row?.name || '',
    phone: row?.phone || '+32 ',
    email: row?.email || '',
    date: state.currentDate || todayStr(),
    type: 'bowling'
  });
}

// Prépare un email client : ouvre le client mail par défaut avec objet/corps
// pré-remplis via une ancre (plus fiable que location.href) ET donne un retour
// visible (toast + copie de l'adresse) pour que le bouton ne soit jamais inerte
// quand aucun handler mailto n'est configuré.
function composeStaffClientEmail(email = '', name = '') {
  const address = String(email || '').trim();
  if (!address) {
    toast('Aucune adresse email pour ce client.');
    return;
  }
  // Studio mails interne quand accessible : envoi tracé dans l'historique,
  // template relance prérempli. Mailto en repli pour les rôles sans direction.
  if (typeof canOpenAdminView === 'function' && canOpenAdminView()) {
    const firstName = String(name || '').trim().split(/\s+/)[0] || '';
    setView('admin');
    ensureAdminConsolesLoaded().then(() => {
      if (typeof msState === 'undefined') return;
      const starter = typeof MS_STARTERS !== 'undefined' ? MS_STARTERS.find(s => s.key === 'relance-client') : null;
      msState.section = 'compose';
      msState.draft.to = address;
      msState.draft.category = 'relance';
      msState.draft.templateRef = starter ? 'starter:relance-client' : '';
      // Les starters portent {{centre}} : on le remplit ici comme msApplyTemplate,
      // sinon la relance partirait avec un jeton brut.
      const centreName = getCurrentStaffCenterName() || getCurrentStaffCenterId();
      const fillStarter = (text, fallbackPrenom) => String(text || '')
        .replace(/\{\{\s*prenom\s*\}\}/gi, firstName || fallbackPrenom)
        .replace(/\{\{\s*centre\s*\}\}/gi, centreName);
      msState.draft.subject = starter ? fillStarter(starter.subject, 'vous') : `${centreName || 'Votre centre'}, ${name || 'votre visite'}`;
      msState.draft.body = starter ? fillStarter(starter.body, '') : `Bonjour ${name || ''},\n\n`;
      msState.aiTips = [];
      if (typeof setAdminTab === 'function') setAdminTab('mail');
      toast(`Relance prête pour ${address} : relis et envoie.`);
    }).catch(() => {});
    return;
  }
  const subject = [getCurrentStaffCenterName(), name || 'votre réservation'].filter(Boolean).join(' : ');
  const body = `Bonjour ${name || ''},\n\n`;
  const href = `mailto:${address}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  const link = document.createElement('a');
  link.href = href;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(address)
      .then(() => toast(`Email prêt · ${address} copié`))
      .catch(() => toast(`Préparation email · ${address}`));
  } else {
    toast(`Préparation email · ${address}`);
  }
}

function getStaffReservationsMonthKey() {
  return /^\d{4}-\d{2}$/.test(state.staffReservationsMonth || '') ? state.staffReservationsMonth : getMonthKey(state.currentDate || todayStr());
}

function addMonthsToMonthKey(monthKey, delta) {
  const date = parseLocalDate(`${monthKey}-01`);
  date.setMonth(date.getMonth() + delta);
  return toLocalDateStr(date).slice(0, 7);
}

function getStaffReservationsRange() {
  const monthKey = getStaffReservationsMonthKey();
  const monthStart = startOfMonth(`${monthKey}-01`);
  const monthEnd = endOfMonth(`${monthKey}-01`);
  const gridStart = startOfWeek(monthStart);
  const gridEnd = addDays(startOfWeek(monthEnd), 6);
  const previousMonthStart = startOfMonth(`${addMonthsToMonthKey(monthKey, -1)}-01`);
  return {
    monthKey,
    monthStart,
    monthEnd,
    previousMonthStart,
    previousMonthEnd: addDays(monthStart, -1),
    gridStart,
    gridEnd,
    gridDays: getDateRangeDays(gridStart, gridEnd),
    monthDays: getDateRangeDays(monthStart, monthEnd)
  };
}

function getStaffReservationsCacheKey() {
  const range = getStaffReservationsRange();
  return `${getActiveOpsCenterId()}|${range.previousMonthStart}|${range.gridEnd}`;
}

function getStaffReservationsSourceReservations() {
  const centerId = getActiveOpsCenterId();
  const cacheReservations = staffReservationsDataCache.loaded ? (staffReservationsDataCache.reservations || []) : [];
  // Le calendrier lit la plage servie par /api/admin-range : dans cette
  // fenetre, ce que le serveur ne renvoie pas n'existe plus. C'est ce qui
  // supprime les compteurs fantomes sans avoir a cliquer chaque jour.
  let local = state.reservations || [];
  if (staffReservationsDataCache.loaded) {
    const range = getStaffReservationsRange();
    local = keepLocalWithinServerAuthority(local, cacheReservations, range.previousMonthStart, range.gridEnd);
  }
  return mergeReservationsById([cacheReservations, local])
    .filter(reservation => (reservation.centerId || reservation.center_id || centerId) === centerId);
}

async function loadStaffReservationsData(force = false) {
  const range = getStaffReservationsRange();
  const key = getStaffReservationsCacheKey();
  if (!force && staffReservationsDataCache.loading) return;
  if (!force && staffReservationsDataCache.loaded && staffReservationsDataCache.key === key) return;
  staffReservationsDataCache = {
    ...staffReservationsDataCache,
    key,
    loading: true,
    error: ''
  };
  if (isStaffReservationsActive()) renderStaffReservationsPage();
  else if (isStaffUtilityActive()) renderStaffUtilityPage();
  try {
    const centerQuery = encodeURIComponent(getActiveOpsCenterId());
    const startDate = encodeURIComponent(range.previousMonthStart);
    const endDate = encodeURIComponent(range.gridEnd);
    const payload = await apiRequest(`${API_ENDPOINTS.adminRange}?startDate=${startDate}&endDate=${endDate}&centerId=${centerQuery}`);
    staffReservationsDataCache = {
      key,
      loading: false,
      loaded: true,
      error: '',
      reservations: payload.reservations || [],
      syncedAt: payload.syncedAt || new Date().toISOString(),
      loadedAt: Date.now()
    };
  } catch (error) {
    staffReservationsDataCache = {
      ...staffReservationsDataCache,
      key,
      loading: false,
      loaded: false,
      error: error.message || 'Chargement reservations impossible.'
    };
  }
  if (isStaffReservationsActive()) renderStaffReservationsPage();
  else if (isStaffUtilityActive()) renderStaffUtilityPage();
}

function ensureStaffReservationsData() {
  const key = getStaffReservationsCacheKey();
  if (staffReservationsDataCache.key !== key || (!staffReservationsDataCache.loaded && !staffReservationsDataCache.loading && !staffReservationsDataCache.error)) {
    loadStaffReservationsData(false);
  }
}

function getStaffReservationActivityType(reservation) {
  const hasBowling = getBowlingWindowsFromReservation(reservation).length > 0;
  const hasLaser = getLaserWindowsFromReservation(reservation).length > 0 || reservation.type === 'laser';
  if (reservation.type === 'formule' || reservation.formuleId || (hasBowling && hasLaser)) return 'complete';
  if (hasLaser) return 'laser';
  if (hasBowling) return 'bowling';
  return 'event';
}

function getStaffReservationStatusLabel(status) {
  const labels = {
    pending: 'En attente',
    confirmed: 'Confirmé',
    arrived: 'Arrivé',
    paid: 'Payé',
    cancelled: 'Annulé'
  };
  return labels[status] || status || 'Confirmé';
}

function getStaffReservationsDailySeries(days, reservations, metric = 'count') {
  return days.map(date => reservations
    .filter(reservation => reservation.date === date && reservation.status !== 'cancelled')
    .reduce((sum, reservation) => {
      if (metric === 'players') return sum + (Number(reservation.pax) || 0);
      if (metric === 'revenue') return sum + (Number(reservation.price) || 0);
      if (metric === 'laneHours') {
        return sum + getBowlingWindowsFromReservation(reservation)
          .reduce((windowSum, window) => windowSum + ((Number(window.duration) || 0) * Math.max((window.lanes || []).length, 1)), 0);
      }
      return sum + 1;
    }, 0));
}

function getStaffReservationsOccupancy(days, reservations) {
  const activeLaneCount = Math.max(1, TOTAL_LANES - Object.values(state.laneStatuses || {}).filter(status => status === 'maintenance').length);
  const capacity = days.reduce((sum, date) => {
    const windowCfg = getPlanningWindow(date);
    if (windowCfg.closed) return sum;
    return sum + (activeLaneCount * Math.max(windowCfg.close - windowCfg.open, 0));
  }, 0);
  const laneHours = reservations.reduce((sum, reservation) => sum + getBowlingWindowsFromReservation(reservation)
    .reduce((windowSum, window) => windowSum + ((Number(window.duration) || 0) * Math.max((window.lanes || []).length, 1)), 0), 0);
  return capacity ? Math.round((laneHours / capacity) * 100) : 0;
}

function getStaffReservationsTrend(currentValue, previousValue) {
  const current = Number(currentValue) || 0;
  const previous = Number(previousValue) || 0;
  if (!previous && current) return '+100%';
  if (!previous) return '0%';
  const trend = Math.round(((current - previous) / previous) * 100);
  return `${trend > 0 ? '+' : ''}${trend}%`;
}

function getStaffReservationsMetrics() {
  const range = getStaffReservationsRange();
  const source = getStaffReservationsSourceReservations().filter(reservation => reservation.status !== 'cancelled');
  const monthReservations = source.filter(reservation => reservation.date >= range.monthStart && reservation.date <= range.monthEnd);
  const previousReservations = source.filter(reservation => reservation.date >= range.previousMonthStart && reservation.date <= range.previousMonthEnd);
  const monthPlayers = monthReservations.reduce((sum, reservation) => sum + (Number(reservation.pax) || 0), 0);
  const previousPlayers = previousReservations.reduce((sum, reservation) => sum + (Number(reservation.pax) || 0), 0);
  const monthRevenue = monthReservations.reduce((sum, reservation) => sum + (Number(reservation.price) || 0), 0);
  const previousRevenue = previousReservations.reduce((sum, reservation) => sum + (Number(reservation.price) || 0), 0);
  const currentOcc = getStaffReservationsOccupancy(range.monthDays, monthReservations);
  const previousOcc = getStaffReservationsOccupancy(getDateRangeDays(range.previousMonthStart, range.previousMonthEnd), previousReservations);
  return {
    range,
    source,
    monthReservations,
    previousReservations,
    reservations: monthReservations.length,
    reservationTrend: getStaffReservationsTrend(monthReservations.length, previousReservations.length),
    players: monthPlayers,
    playersTrend: getStaffReservationsTrend(monthPlayers, previousPlayers),
    revenue: monthRevenue,
    revenueTrend: getStaffReservationsTrend(monthRevenue, previousRevenue),
    occupancy: currentOcc,
    occupancyTrend: getStaffReservationsTrend(currentOcc, previousOcc),
    series: {
      reservations: getStaffReservationsDailySeries(range.monthDays, monthReservations, 'count'),
      players: getStaffReservationsDailySeries(range.monthDays, monthReservations, 'players'),
      revenue: getStaffReservationsDailySeries(range.monthDays, monthReservations, 'revenue'),
      occupancy: getStaffReservationsDailySeries(range.monthDays, monthReservations, 'laneHours')
    }
  };
}

function refreshStaffReservations() {
  loadStaffReservationsData(true);
}

function selectStaffReservationsDate(dateStr) {
  state.staffReservationsSelectedDate = dateStr;
  state.currentDate = dateStr;
  save();
  renderStaffReservationsPage();
  syncDateReservations(dateStr, { silent: true });
}

function setStaffReservationsMonthFromPicker(value) {
  if (!/^\d{4}-\d{2}$/.test(value || '')) return;
  state.staffReservationsMonth = value;
  state.staffReservationsPreset = 'month';
  const selected = `${value}-01`;
  state.staffReservationsSelectedDate = selected;
  state.currentDate = selected;
  save();
  renderStaffReservationsPage();
  ensureStaffReservationsData();
}

function shiftStaffReservationsMonth(delta) {
  const nextMonth = addMonthsToMonthKey(getStaffReservationsMonthKey(), delta);
  setStaffReservationsMonthFromPicker(nextMonth);
}

function openStaffReservationsMonthPicker() {
  const picker = document.getElementById('staffReservationsMonthPicker');
  if (!picker) return;
  try {
    if (typeof picker.showPicker === 'function') {
      picker.showPicker();
      return;
    }
  } catch (error) {}
  picker.focus();
  picker.click();
}

function openStaffReservationsQuick(type = 'bowling') {
  openQuickBook({
    date: state.staffReservationsSelectedDate || state.currentDate || todayStr(),
    type
  });
}

// Recherche une réservation par id dans TOUTES les sources chargées, pas
// seulement la source de la page Réservations. Indispensable depuis Terrain
// et Groupes où la résa provient du cache clients (historique) et pas de
// state.reservations. Comparaison en String : les ids d'état sont numériques
// alors que les onclick passent des chaînes.
function findStaffReservationById(id) {
  if (id == null || id === '') return null;
  const key = String(id);
  const local = (state.reservations || []).find(item => item && String(item.id) === key);
  if (local) return local;
  const sources = [];
  if (typeof getStaffClientSourceReservations === 'function') sources.push(getStaffClientSourceReservations());
  if (typeof getStaffReservationsSourceReservations === 'function') sources.push(getStaffReservationsSourceReservations());
  for (const list of sources) {
    const match = (list || []).find(item => item && String(item.id) === key);
    if (match) return match;
  }
  return null;
}

function openStaffReservationDetail(id) {
  const reservation = findStaffReservationById(id);
  if (!reservation) {
    toast('Réservation introuvable ou non chargée.');
    return;
  }
  upsertReservationInState(reservation);
  state.currentDate = reservation.date || state.currentDate;
  state.selectedRes = reservation;
  state.activeTab = 'details';
  state.editState = { ...reservation, lanesStr: (reservation.lanes || []).join(', ') };
  save();
  renderPos();
}

function renderStaff() {
  if (!hasSavedAuth()) {
    renderStaffShell(todaysReservations());
    applyAuthState();
    return;
  }
  guardStaffPage();
  const dayReservations = todaysReservations();
  renderStaffShell(dayReservations);
  // Les pages v2 vivent dans staff-pages-v2.js, un defer charge APRES ce
  // fichier. Depuis que la vue est appliquee AVANT les attentes reseau
  // (correctif anti-flash du 2026-08-06), ce dispatcher peut tourner pendant
  // que leur script se parse encore : sans garde, ReferenceError et la page
  // restait NOIRE jusqu'a un rechargement (bug rapporte le jour meme). Chaque
  // page absente est simplement sautee ; le filet post-chargement (listener
  // load, plus bas) re-rend la vue des que tous les scripts sont la.
  const pageReady = (fn) => typeof window[fn] === 'function';
  if (isStaffDashboardActive()) {
    document.body.style.overflow = '';
    renderStaffDashboard(dayReservations);
    return;
  }
  if (isStaffReservationsActive()) {
    document.body.style.overflow = '';
    if (pageReady('renderStaffReservationsPage')) renderStaffReservationsPage();
    return;
  }
  if (isStaffClientsActive()) {
    document.body.style.overflow = '';
    if (pageReady('renderStaffClientsPage')) renderStaffClientsPage();
    return;
  }
  if (isStaffPricingActive()) {
    document.body.style.overflow = '';
    if (pageReady('renderStaffPricingPage')) renderStaffPricingPage();
    return;
  }
  if (isStaffEmailsActive()) {
    document.body.style.overflow = '';
    if (pageReady('renderStaffEmailsPage')) renderStaffEmailsPage();
    return;
  }
  if (isStaffCampaignsActive()) {
    document.body.style.overflow = '';
    if (pageReady('renderStaffCampaignsPage')) renderStaffCampaignsPage();
    return;
  }
  if (isStaffCockpitActive()) {
    document.body.style.overflow = '';
    const cockpitHost = document.getElementById('staffCockpitPage');
    const cockpitPage = getStaffMenuPage();
    // Les surfaces de GESTION (Centres, Equipe) sont des modules dedies ; les
    // pages d'observation (cockpit, agents, incidents, clients) restent servies
    // par founder-cockpit.js.
    if (cockpitPage === 'cockpit-clients-platform' && typeof window.renderPlatformClientsPage === 'function') {
      window.renderPlatformClientsPage(cockpitHost);
    } else if (cockpitPage === 'cockpit-centres' && typeof window.renderFounderCentresPage === 'function') {
      window.renderFounderCentresPage(cockpitHost);
    } else if (typeof renderStaffFounderCockpitPage === 'function') {
      renderStaffFounderCockpitPage(cockpitHost, cockpitPage);
    }
    return;
  }
  if (isStaffUtilityActive()) {
    document.body.style.overflow = '';
    if (pageReady('renderStaffUtilityPage')) renderStaffUtilityPage();
    return;
  }
  document.getElementById('searchInput').value = state.searchTerm || '';
  const planningBox = document.getElementById('planningBox');
  const laserPlanningBox = document.getElementById('laserPlanningBox');
  if (planningBox) planningBox.classList.toggle('expanded', !!state.staffPlanningExpanded);
  if (laserPlanningBox) laserPlanningBox.classList.toggle('expanded', !!state.staffLaserPlanningExpanded);
  const planningToggle = document.getElementById('planningToggle');
  if (planningToggle) planningToggle.textContent = state.staffPlanningExpanded ? 'Réduire' : 'Agrandir';
  const laserPlanningToggle = document.getElementById('laserPlanningToggle');
  if (laserPlanningToggle) laserPlanningToggle.textContent = state.staffLaserPlanningExpanded ? 'Réduire' : 'Agrandir';
  document.body.style.overflow = state.view === 'staff' && (state.staffPlanningExpanded || state.staffLaserPlanningExpanded) ? 'hidden' : '';
  attachPlanningFullscreenResize();
  renderKpis();
  renderPlanning();
  renderLaserPlanning();
  renderTable();
}

// Recalcule le planning quand la fenêtre change de taille. Ce n'était attaché
// QUE pendant le plein écran, et c'était un trou : hors plein écran aussi, des
// décisions de rendu sont prises en pixels au moment du render (hauteur de
// ligne tactile sous 768px, hauteur des cartes). Redimensionner ou zoomer sans
// re-render laissait donc une grille calculée pour l'ancienne taille. Un seul
// écouteur, posé une fois, qui ne travaille que si le planning est à l'écran.
let planningFullscreenResizeHandler = null;

function attachPlanningFullscreenResize() {
  if (planningFullscreenResizeHandler) return;
  let raf = 0;
  planningFullscreenResizeHandler = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (state.view !== 'staff') return;
      if (state.staffLaserPlanningExpanded) { renderLaserPlanning(); return; }
      if (state.staffPlanningExpanded) { renderPlanning(); return; }
      if (document.getElementById('planningGridWrap')) renderPlanning();
      if (document.getElementById('laserPlanningGridWrap')) renderLaserPlanning();
    });
  };
  window.addEventListener('resize', planningFullscreenResizeHandler, { passive: true });
}

function detachPlanningFullscreenResize() {
  // Volontairement conservé : l'écouteur reste posé pour couvrir aussi le mode
  // fenêtre. Il se contente de ne rien faire quand le planning n'est pas visible.
}

function togglePlanningExpanded() {
  const next = !state.staffPlanningExpanded;
  state.staffPlanningExpanded = next;
  state.staffLaserPlanningExpanded = false;
  if (next) attachPlanningFullscreenResize();
  else detachPlanningFullscreenResize();
  save();
  renderStaff();
}

function toggleLaserPlanningExpanded() {
  const next = !state.staffLaserPlanningExpanded;
  state.staffLaserPlanningExpanded = next;
  state.staffPlanningExpanded = false;
  if (next) attachPlanningFullscreenResize();
  else detachPlanningFullscreenResize();
  save();
  renderStaff();
}

function collapseStaffPlanningFullscreen() {
  if (!state.staffPlanningExpanded && !state.staffLaserPlanningExpanded) return false;
  state.staffPlanningExpanded = false;
  state.staffLaserPlanningExpanded = false;
  detachPlanningFullscreenResize();
  save();
  renderStaff();
  return true;
}

function setStaffStatusFilter(filter) {
  state.staffStatusFilter = filter;
  save();
  renderPlanning();
  renderLaserPlanning();
  renderTable();
}

function getPlanningVisibleReservations(view = getStaffResourceView()) {
  let reservations = todaysReservations().filter(r => reservationMatchesStaffResource(r, view));
  releaseDeadNoteFilter();
  reservations = filterReservationsForStaff(reservations, state.staffStatusFilter || 'all');
  const query = String(state.searchTerm || '').trim().toLowerCase();
  if (query) {
    reservations = reservations.filter(r => {
      const label = `${r.name || ''} ${r.phone || ''} ${getReservationLabel(r)} ${r.email || ''}`.toLowerCase();
      return label.includes(query);
    });
  }
  return reservations;
}

// Recherche planning/liste unifiée. Root cause du bug : les champs de recherche
// n'appelaient que renderTable() : le PLANNING (grille) et le planning Laser ne
// se re-filtraient jamais à la frappe (il fallait recharger), et l'effacement ne
// re-remplissait pas la grille (elle restait figée). On centralise ici : un seul
// state.searchTerm, on synchronise les champs jumeaux (bowling/laser/liste) sans
// voler le focus, puis on re-render planning + planning laser + liste. Débounce
// léger pour rester fluide à la frappe ; effacement = ré-affichage immédiat.
let staffSearchDebounceTimer = null;
function applyStaffSearch(value, opts = {}) {
  state.searchTerm = value;
  ['searchInput', 'planningSearchInput', 'laserPlanningSearchInput'].forEach(id => {
    const el = document.getElementById(id);
    if (el && el !== document.activeElement && el.value !== value) el.value = value;
  });
  const run = () => {
    save();
    if (state.view !== 'staff') return;
    renderPlanning();
    renderLaserPlanning();
    renderTable();
  };
  clearTimeout(staffSearchDebounceTimer);
  // Effacer (champ vide) = ré-affichage instantané du planning complet, sans délai.
  if (opts.immediate || !String(value || '').trim()) {
    run();
    return;
  }
  staffSearchDebounceTimer = setTimeout(run, 120);
}

function closeStaffFloatingMenus() {
  document.querySelectorAll('.staff-action-popover').forEach(menu => menu.remove());
}

function showStaffFloatingMenu(event, html) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const current = document.querySelector('.staff-action-popover');
  if (current && current.dataset.anchor === event?.currentTarget?.className) {
    current.remove();
    return;
  }
  closeStaffFloatingMenus();
  const menu = document.createElement('div');
  menu.className = 'staff-action-popover';
  menu.dataset.anchor = event?.currentTarget?.className || 'staff-action';
  menu.innerHTML = html;
  document.body.appendChild(menu);
  const rect = event?.currentTarget?.getBoundingClientRect?.();
  if (rect) {
    const width = Math.min(260, Math.max(menu.offsetWidth || 220, 220));
    const left = Math.min(window.innerWidth - width - 12, Math.max(12, rect.right - width));
    const top = Math.min(window.innerHeight - 12, rect.bottom + 8);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }
  setTimeout(() => document.addEventListener('click', closeStaffFloatingMenus, { once: true }), 0);
}

function applyPlanningStatusFilter(filter) {
  state.staffStatusFilter = ['all', 'open', 'pending', 'arrived', 'paid'].includes(filter) ? filter : 'all';
  save();
  closeStaffFloatingMenus();
  renderStaff();
}

// LE MÊME FILTRE, DONC LES MÊMES MOTS ET LE MÊME CLASSEMENT QUE LA LISTE.
// Ce menu pilote `state.staffStatusFilter`, exactement comme les puces de la
// liste du jour : il nommait pourtant « Payées » ce que la liste appelle
// « Terminées », et rangeait « À gérer » entre deux états comme s'il en était
// un troisième. Un même filtre qui porte deux noms selon l'endroit où on le
// touche, c'est la même classe d'erreur que les compteurs qui ne se
// recomposent pas. Les trois états d'abord, dans l'ordre de la liste ; le
// recoupement ensuite, sous son propre intitulé.
function togglePlanningFilterMenu(event) {
  const active = state.staffStatusFilter || 'all';
  const bouton = ([key, label]) => `<button type="button" class="${active === key ? 'active' : ''}" onclick="applyPlanningStatusFilter('${key}')">${label}</button>`;
  const etats = [
    ['all', 'Toutes'],
    ['arrived', 'Sur place'],
    ['pending', 'À venir'],
    ['paid', 'Terminées']
  ];
  showStaffFloatingMenu(event, `
    <div class="staff-action-popover-title">Filtrer le planning</div>
    ${etats.map(bouton).join('')}
    <div class="staff-action-popover-title">Recoupe ces états</div>
    ${bouton(['open', 'À gérer'])}
  `);
}

function refreshStaffPlanning() {
  closeStaffFloatingMenus();
  syncDateReservations(state.currentDate, { silent: true });
  renderStaff();
}

function exportStaffPlanningCsv() {
  const rows = getPlanningVisibleReservations().map(reservation => [
    reservation.date,
    reservation.startTime,
    reservation.name,
    reservation.phone || '',
    getReservationLabel(reservation),
    reservation.pax || 0,
    getStaffResourceWindows(reservation, 'all').map(window => window.resourceType === 'laser_arena'
      ? `Laser ${formatClockDisplay(window.start)}-${formatClockDisplay(window.end)}`
      : `Pistes ${(window.lanes || []).join(' ')} ${formatClockDisplay(window.start)}-${formatClockDisplay(window.end)}`).join(' / '),
    reservation.status || 'pending',
    reservation.price || 0
  ]);
  const header = ['Date', 'Heure', 'Client', 'Telephone', 'Offre', 'Joueurs', 'Ressources', 'Statut', 'Montant'];
  downloadTextFile(`${getCurrentStaffCenterId()}-planning-${state.currentDate || todayStr()}.csv`, [header.map(csvCell).join(','), ...rows.map(row => row.map(csvCell).join(','))].join('\n'), 'text/csv;charset=utf-8');
  closeStaffFloatingMenus();
}

function togglePlanningActionsMenu(event) {
  showStaffFloatingMenu(event, `
    <div class="staff-action-popover-title">Actions planning</div>
    <button type="button" onclick="togglePlanningExpanded(); closeStaffFloatingMenus();">${state.staffPlanningExpanded ? 'Réduire le planning' : 'Agrandir le planning'}</button>
    <button type="button" onclick="refreshStaffPlanning()">Actualiser les données</button>
    <button type="button" onclick="exportStaffPlanningCsv()">Exporter le jour en CSV</button>
    <button type="button" onclick="openQuickBook({ date: state.currentDate, type: getStaffResourceView() === 'laser' ? 'laser' : 'bowling' }); closeStaffFloatingMenus();">Nouvelle réservation ici</button>
  `);
}

function setStaffResourceView(view) {
  state.staffResourceView = ['all', 'bowling', 'laser'].includes(view) ? view : 'all';
  state.staffMenuPage = 'planning';
  setStaffRouteHash('planning', state.staffResourceView);
  syncOpsSidebar();
  save();
  renderStaff();
}

// Calendrier custom (popover) : remplace le picker natif <input type=date>
// dont showPicker() ancrait la surface au coin haut-gauche quand l'input etait
// masque sur les pages Terrain. Ici la position est calculee et CONTROLEE
// (positionStaffCalendar : ancree sous le declencheur, maintenue dans le
// viewport), la surface est stylee aux tokens, clavier + aria.
let staffCalTrigger = null;
let staffCalAnchor = null;
let staffCalMonth = null;

const STAFF_CAL_CHEVRON_LEFT = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>';
const STAFF_CAL_CHEVRON_RIGHT = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>';

// Widget date reutilisable : navigation jour (fleches), label cliquable qui
// ouvre le calendrier custom, bouton Aujourd'hui. Le MEME controle sur toutes
// les surfaces staff (planning, dashboard, pages Terrain).
function staffDateNavHtml() {
  const d = parseLocalDate(state.currentDate || todayStr());
  const shortText = d.toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).replace(',', '');
  const label = shortText.charAt(0).toUpperCase() + shortText.slice(1);
  return `<div class="staff-date-widget">
      <div class="date-nav">
        <button type="button" aria-label="Jour précédent" onclick="shiftDate(-1)">${STAFF_CAL_CHEVRON_LEFT}</button>
        <button type="button" class="staff-date-label" aria-haspopup="dialog" title="Choisir une date" onclick="openStaffCalendar(event)">${escapeHtml(label)}</button>
        <button type="button" aria-label="Jour suivant" onclick="shiftDate(1)">${STAFF_CAL_CHEVRON_RIGHT}</button>
      </div>
      <button type="button" class="staff-today-btn" onclick="setStaffToday()">Aujourd'hui</button>
    </div>`;
}

function renderStaffCalendar(dateISO) {
  const selected = dateISO || state.currentDate || todayStr();
  const view = staffCalMonth || getMonthKey(selected);
  const [vy, vm] = view.split('-').map(Number);
  const today = todayStr();
  const months = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const title = `${months[vm - 1]} ${vy}`;
  const first = new Date(vy, vm - 1, 1);
  const startOffset = (first.getDay() + 6) % 7; // grille lundi -> dimanche
  const daysInMonth = new Date(vy, vm, 0).getDate();
  const dows = ['Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa', 'Di'];
  const cells = [];
  for (let i = 0; i < startOffset; i += 1) cells.push('');
  for (let day = 1; day <= daysInMonth; day += 1) cells.push(day);
  const dayCells = cells.map(day => {
    if (day === '') return '<span class="staff-cal-day is-out" aria-hidden="true"></span>';
    const iso = `${vy}-${String(vm).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const classes = ['staff-cal-day'];
    if (iso === today) classes.push('is-today');
    if (iso === selected) classes.push('is-selected');
    const current = iso === selected ? ' aria-current="date"' : '';
    return `<button type="button" class="${classes.join(' ')}"${current} onclick="staffCalendarPick('${iso}')">${day}</button>`;
  }).join('');
  return `<div class="staff-cal-head">
      <button type="button" class="staff-cal-nav" aria-label="Mois précédent" onclick="staffCalendarShiftMonth(-1)">${STAFF_CAL_CHEVRON_LEFT}</button>
      <div class="staff-cal-title">${escapeHtml(title.charAt(0).toUpperCase() + title.slice(1))}</div>
      <button type="button" class="staff-cal-nav" aria-label="Mois suivant" onclick="staffCalendarShiftMonth(1)">${STAFF_CAL_CHEVRON_RIGHT}</button>
    </div>
    <div class="staff-cal-grid" role="grid">
      ${dows.map(dow => `<div class="staff-cal-dow" role="columnheader">${dow}</div>`).join('')}
      ${dayCells}
    </div>
    <div class="staff-cal-foot">
      <button type="button" class="staff-cal-today-btn" onclick="staffCalendarPickToday()">Aujourd'hui</button>
    </div>`;
}

// Positionnement FIABLE : ancre sous le declencheur (rect capture a l'ouverture)
// et reste dans le viewport (rabat a gauche/au-dessus si ca deborde).
function positionStaffCalendar(pop, anchor) {
  const margin = 8;
  const gap = 6;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = pop.offsetWidth || 300;
  const height = pop.offsetHeight || 320;
  let left = anchor.left;
  if (left + width > vw - margin) left = vw - margin - width;
  if (left < margin) left = margin;
  let top = anchor.bottom + gap;
  if (top + height > vh - margin && anchor.top - gap - height >= margin) {
    top = anchor.top - gap - height;
  }
  if (top + height > vh - margin) top = Math.max(margin, vh - margin - height);
  if (top < margin) top = margin;
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(top)}px`;
}

function openStaffCalendar(ev) {
  ev?.preventDefault?.();
  ev?.stopPropagation?.();
  const trigger = ev && (ev.currentTarget || ev.target);
  const existing = document.querySelector('.staff-calendar-pop');
  if (existing) {
    const sameTrigger = staffCalTrigger === trigger;
    closeStaffCalendar();
    if (sameTrigger) return; // re-clic sur le meme declencheur = fermer
  }
  const rect = trigger && typeof trigger.getBoundingClientRect === 'function' ? trigger.getBoundingClientRect() : null;
  staffCalTrigger = trigger || null;
  staffCalAnchor = rect
    ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
    : { left: 12, right: 12, top: 12, bottom: 12 };
  staffCalMonth = getMonthKey(state.currentDate || todayStr());
  const pop = document.createElement('div');
  pop.className = 'staff-calendar-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-modal', 'false');
  pop.setAttribute('aria-label', 'Choisir une date');
  pop.innerHTML = renderStaffCalendar(state.currentDate || todayStr());
  document.body.appendChild(pop);
  positionStaffCalendar(pop, staffCalAnchor);
  const focusTarget = pop.querySelector('.staff-cal-day.is-selected')
    || pop.querySelector('.staff-cal-day.is-today')
    || pop.querySelector('.staff-cal-day');
  if (focusTarget) focusTarget.focus();
  setTimeout(() => {
    document.addEventListener('click', staffCalendarOutside, true);
    document.addEventListener('keydown', staffCalendarKeydown, true);
  }, 0);
}

function staffCalendarShiftMonth(delta) {
  const view = staffCalMonth || getMonthKey(state.currentDate || todayStr());
  const [vy, vm] = view.split('-').map(Number);
  const moved = new Date(vy, vm - 1 + delta, 1);
  staffCalMonth = `${moved.getFullYear()}-${String(moved.getMonth() + 1).padStart(2, '0')}`;
  const pop = document.querySelector('.staff-calendar-pop');
  if (!pop) return;
  pop.innerHTML = renderStaffCalendar(state.currentDate || todayStr());
  if (staffCalAnchor) positionStaffCalendar(pop, staffCalAnchor);
}

function staffCalendarPick(dateISO) {
  closeStaffCalendar();
  setStaffDateFromPicker(dateISO); // logique existante : currentDate + save + renderStaff + sync
}

function staffCalendarPickToday() {
  staffCalendarPick(todayStr());
}

function staffCalendarOutside(ev) {
  const pop = document.querySelector('.staff-calendar-pop');
  if (!pop) return;
  if (pop.contains(ev.target)) return;
  if (staffCalTrigger && staffCalTrigger.contains && staffCalTrigger.contains(ev.target)) return;
  closeStaffCalendar();
}

function staffCalendarKeydown(ev) {
  if (ev.key !== 'Escape' && ev.key !== 'Esc') return;
  ev.preventDefault();
  const trigger = staffCalTrigger;
  closeStaffCalendar();
  if (trigger && typeof trigger.focus === 'function') trigger.focus();
}

function closeStaffCalendar() {
  document.querySelectorAll('.staff-calendar-pop').forEach(pop => pop.remove());
  document.removeEventListener('click', staffCalendarOutside, true);
  document.removeEventListener('keydown', staffCalendarKeydown, true);
  staffCalTrigger = null;
  staffCalAnchor = null;
}

function setStaffDateFromPicker(value) {
  if (!value) return;
  state.currentDate = value;
  save();
  renderStaff();
  syncDateReservations(state.currentDate, { silent: true });
}

function shiftDate(delta) {
  const nextDate = addDays(state.currentDate, delta);
  state.currentDate = nextDate;
  save();
  renderStaff();
  syncDateReservations(state.currentDate, { silent: true });
}

function todaysReservations() {
  return state.reservations.filter(r => r.date === state.currentDate && r.status !== 'cancelled');
}

function getStaffResourceView() {
  return state.staffResourceView === 'laser' ? 'laser' : state.staffResourceView === 'all' ? 'all' : 'bowling';
}

function getStaffResourceWindows(reservation, view = getStaffResourceView()) {
  if (view === 'all') {
    return [...getBowlingWindowsFromReservation(reservation), ...getLaserWindowsFromReservation(reservation)]
      .sort((left, right) => Number(left.start) - Number(right.start));
  }
  return view === 'laser'
    ? getLaserWindowsFromReservation(reservation)
    : getBowlingWindowsFromReservation(reservation);
}

function reservationMatchesStaffResource(reservation, view = getStaffResourceView()) {
  if (view === 'all') return true;
  return getStaffResourceWindows(reservation, view).length > 0;
}

// « Hors planning » : la reservation n'occupe NI piste bowling NI zone laser,
// donc elle n'apparait sur AUCUNE des deux grilles. C'est le cas des formules
// table + plaine de jeux (f6/f7/f8) et du Kids Fun Day : le staff ne les voyait
// nulle part, noyees dans la liste du jour. Elles ont maintenant leur zone en
// tete de l'onglet « Toutes les reservations ».
// Exception VOULUE : une partie laser non encore placee n'est pas hors planning,
// elle attend deja dans le tiroir « a placer » du planning laser.
function isOffPlanningReservation(reservation) {
  if (!reservation) return false;
  if (getBowlingWindowsFromReservation(reservation).length) return false;
  if (getLaserWindowsFromReservation(reservation).length) return false;
  return getLaserGameCountForReservation(reservation) === 0;
}

function scopedStaffReservations(view = getStaffResourceView()) {
  return todaysReservations().filter(r => reservationMatchesStaffResource(r, view));
}

// UN SEUL endroit qui synchronise la bande d'onglets (onglet actif, compteurs,
// alerte hors planning, visibilite des grilles). renderStaffShell et
// renderStaffData en tenaient chacun une copie : deux verites qui pouvaient
// diverger en silence au premier changement de regle.
// Regle de visibilite : une grille ne s'affiche que sur SON onglet. « Toutes les
// reservations » n'est plus un empilement des deux plannings mais la liste du
// jour, hors planning en tete.
// LES BLOCS DU PLANNING SUIVAIENT LE VISITEUR PARTOUT (2026-08-14, 2e passe).
// Movsar : « j'ai toujours cette colonne qui s'affiche partout sur toutes les
// categories ». Le premier correctif etait bon mais il etait ANNULE : ce
// parametre valait `false` par defaut, et l'appelant de `renderStaffDay` ne le
// passait pas. Un appelant qui oublie l'argument re-affichait donc les trois
// blocs sur n'importe quelle page.
//
// La regle : une fonction qui doit connaitre l'etat de l'application le DEDUIT,
// elle ne l'accepte pas d'un appelant qui peut l'oublier. Un defaut permissif
// transforme chaque oubli futur en bug visible par l'utilisateur.
function isStaffPlanningPageActive() {
  return !(isStaffDashboardActive() || isStaffReservationsActive() || isStaffClientsActive()
    || isStaffPricingActive() || isStaffEmailsActive() || isStaffCampaignsActive()
    || isStaffUtilityActive() || isStaffCockpitActive());
}

function syncStaffResourceTabs(dayReservations = todaysReservations(), view = getStaffResourceView()) {
  const hiddenByPage = !isStaffPlanningPageActive();
  const bowlingCount = dayReservations.filter(r => getBowlingWindowsFromReservation(r).length > 0).length;
  const laserCount = dayReservations.filter(r => getLaserWindowsFromReservation(r).length > 0).length;
  const offPlanningCount = dayReservations.filter(isOffPlanningReservation).length;
  const allTab = document.getElementById('staffTabAll');
  allTab?.classList.toggle('active', view === 'all');
  allTab?.classList.toggle('has-alert', offPlanningCount > 0);
  document.getElementById('staffTabBowling')?.classList.toggle('active', view === 'bowling');
  document.getElementById('staffTabLaser')?.classList.toggle('active', view === 'laser');
  const allSub = document.getElementById('staffAllSub');
  if (allSub) {
    allSub.textContent = offPlanningCount
      ? `${offPlanningCount} hors planning`
      : 'Le jour au complet';
    allSub.classList.toggle('is-alert', offPlanningCount > 0);
  }
  const allCountEl = document.getElementById('staffAllCount');
  const bowlingCountEl = document.getElementById('staffBowlingCount');
  const laserCountEl = document.getElementById('staffLaserCount');
  if (allCountEl) allCountEl.textContent = dayReservations.length;
  if (bowlingCountEl) bowlingCountEl.textContent = bowlingCount;
  if (laserCountEl) laserCountEl.textContent = laserCount;
  document.getElementById('planningBox')?.classList.toggle('hidden', hiddenByPage || view !== 'bowling');
  document.getElementById('laserPlanningBox')?.classList.toggle('hidden', hiddenByPage || view !== 'laser');
  // LA LISTE DU JOUR SUIVAIT LE VISITEUR PARTOUT (2026-08-14). Movsar :
  // « le truc reservations s'affiche sur toutes les categories ». Les deux
  // plannings etaient masques au changement de page ; la boite de la liste
  // n'entrait pas dans la regle et n'avait meme pas d'identifiant, donc elle
  // restait peinte sous Vue d'ensemble, Reservations, Terrain, Clients...
  // Regle a retenir : tout bloc de la page Planning se masque par la MEME
  // decision. Un bloc qu'on oublie de rattacher a cette decision est visible
  // par defaut, et personne ne le voit en relisant le code.
  document.getElementById('staffTableBox')?.classList.toggle('hidden', hiddenByPage);
}

function getReservationFirstResourceStart(reservation, view = getStaffResourceView()) {
  const windows = getStaffResourceWindows(reservation, view);
  if (!windows.length) return timeToNum(reservation.startTime);
  return Math.min(...windows.map(window => Number(window.start)));
}

function getFormulaLaserGameCount(formule) {
  if (!formule) return 0;
  return (formule.desc || []).reduce((max, line) => {
    const text = normalizeActivityText(line);
    if (!text.includes('laser game')) return max;
    const match = text.match(/(\d+)\s*part/);
    return Math.max(max, match ? Number(match[1]) : 1);
  }, 0);
}

function getLaserGameCountForReservation(reservation) {
  if (reservation.type === 'laser') return getLaserGameCount(Number(reservation.duration) || 0.5);
  const formule = reservation.formuleId ? FORMULES.find(x => x.id === reservation.formuleId) : null;
  return getFormulaLaserGameCount(formule);
}

function getBowlingDurationForReservation(reservation) {
  const windows = getBowlingWindowsFromReservation(reservation);
  if (windows.length) return Number(windows[0].duration) || 0;
  const formule = reservation.formuleId ? FORMULES.find(x => x.id === reservation.formuleId) : null;
  if (formule) return formule.hasBowling ? Number(formule.bowlingDur || 1) : 0;
  if (reservation.type !== 'bowling') return 0;
  return Number(reservation.duration || 0);
}

// Palier d'emphase effectif selon la taille du groupe. Escalade en niveaux de
// gris + graisse (grp-l/grp-xl deviennent des pastilles pleines) pour repérer
// un gros groupe d'un coup d'œil, sans introduire une 2e couleur vive à côté de
// la durée (design system : un seul accent chaud = ambre pour la durée).
//   ≤6 neutre · 7-14 semi-gras · 15-29 pastille · 30+ pastille inversée.
function getGroupSizeClass(pax) {
  const n = Number(pax) || 0;
  if (n >= 30) return 'grp-xl';
  if (n >= 15) return 'grp-l';
  if (n >= 7) return 'grp-m';
  return 'grp-s';
}

// Durée bowling « standard » = 1h (neutre). Toute autre durée (30 min, 1h30,
// 2h…) est signalée pour attirer l'œil du staff.
function isSpecialBowlingDuration(duration) {
  const d = Number(duration) || 0;
  return d > 0 && Math.abs(d - 1) > 0.01;
}

// Densité d'info d'une carte bowling dérivée de sa HAUTEUR réelle (durée × zoom
// du planning). Une seule classe pilote l'affichage responsive côté CSS :
//   dens-xs : très petite (≈30 min) → nom tronqué + effectif + durée, 1 ligne.
//   dens-md : moyenne (≈1h)         → nom + activité + effectif + durée.
//   dens-lg : grande (1h30/2h+)     → tout, aéré (+ tags en plein écran).
// En plein écran les cellules sont plus hautes ET les polices plus grandes :
// on ne descend jamais sous dens-md pour afficher davantage de détail.
function getBookingDensityClass(height, expanded) {
  if (expanded) {
    // Polices plus grandes en plein écran : une cellule très courte (≈30 min)
    // ne tient toujours pas 2 lignes → ligne unique essentielle. Les créneaux
    // plus longs profitent de la hauteur pour afficher davantage de détail.
    if (height < 54) return 'dens-xs';
    return height >= 108 ? 'dens-lg' : 'dens-md';
  }
  // LE SEUIL D'UNE LIGNE EST CELUI OU DEUX LIGNES NE TIENNENT PLUS, et il se
  // MESURE. Il valait 40px, choisi avant que la carte porte son contenu actuel :
  // deux lignes (nom 13,8px + gouttiere 2px + chiffres 12px + 11px de calage
  // vertical) en demandent 43. Une carte de 42px partait donc en deux lignes et
  // son contenu sortait par le bas, a 4 pistes et 150 % de zoom. 46px laisse
  // 44px utiles, soit un pixel de marge sur les 43 mesures.
  if (height < 46) return 'dens-xs';
  if (height < 66) return 'dens-md';
  return 'dens-lg';
}

// ÉTAT DE LA RÉSERVATION SUR LA CARTE, ET IL NE TIENT PLUS À LA COULEUR SEULE.
// Le fond et la barre de gauche disaient l'état à eux seuls : bleu = confirmé,
// ambre = arrivé, vert = payé, avec une légende en haut du panneau. DESIGN.md §7
// l'interdit (« pas d'info portée par la couleur seule »), et un gérant
// deutéranope confond exactement ces deux-là, l'ambre et le vert.
// Le repère porte donc une FORME distincte par état, plus un libellé lu par la
// synthèse vocale. « Confirmé » est l'état par défaut : il ne reçoit aucun
// repère, parce qu'un écran où tout est marqué est un écran où rien ne ressort.
const BOOKING_STATE_MARKS = {
  // Arrivé : la flèche qui entre. C'est la question du comptoir.
  arr: { label: 'Arrivé', path: '<path d="M3 12h10"/><path d="M9 8l4 4-4 4"/><path d="M17 4v16"/>' },
  // Payé : la coche. Le dossier est clos.
  paid: { label: 'Payé', path: '<path d="M20 6 9 17l-5-5"/>' },
};
function renderBookingStateMark(cls) {
  const mark = BOOKING_STATE_MARKS[cls];
  if (!mark) return '';
  return `<span class="bk-state" role="img" aria-label="${mark.label}" title="${mark.label}">`
    + `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${mark.path}</svg>`
    + `</span>`;
}

// Durée d'une carte de planning : forme COMPACTE et de largeur BORNÉE (`0h30`,
// `1h`, `1h30`), là où `formatDurationLabel` rend « 30 min » pour la demi-heure.
// Deux raisons, et la seconde n'est pas cosmétique.
// (1) La grille est un tableau de données : DESIGN.md §4 veut du Geist Mono
//     tabulaire, or « 30 min » mélange chiffres, lettre et espace et ne
//     s'aligne avec rien dans la colonne.
// (2) Surtout, sa largeur DÉCIDE : c'est elle qui fixe le plancher en dessous
//     duquel la durée doit céder la place au nom sur une carte d'une seule
//     ligne. Mesuré : « 30 min » occupe 51,6px contre 38,4px au pire pour la
//     forme compacte. Une largeur bornée rend ce plancher CALCULABLE au lieu
//     d'être deviné, et c'est tout l'objet de la correction du 2026-08-13.
// Le libellé long reste dans l'infobulle : aucune information ne se perd.
function formatCardDurationLabel(hours) {
  const totalMinutes = Math.max(0, Math.round((Number(hours) || 0) * 60));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

// ON N'AFFICHE JAMAIS UN FRAGMENT DE MOT DANS UNE ÉTIQUETTE.
// Movsar, 2026-08-13, en regardant la prod : « tu as encore tout qui est coupé
// même en agrandi, genre "Bowling Classique" c'est coupé. Des petits trucs qui
// font cheap. » Un mot coupé en deux est PIRE qu'un mot absent : il oblige à
// deviner, et il signe un logiciel qu'on n'a pas fini.
//
// La cause n'était pas un seuil de mise en page : c'était la LONGUEUR du texte.
// Le défaut métier d'une réservation bowling est « Bowling Classique », dix-sept
// caractères, soit environ 84px là où une piste de 127px en offre quarante.
// Aucune règle de mise en page ne fait tenir ça : il fallait raccourcir le
// texte, pas ruser avec la place. On coupe donc par MOTS ENTIERS, jamais au
// milieu d'un mot, et le libellé complet reste dans l'infobulle et dans la
// fiche, où on a la place de le lire.
// ET LA COUPE PAR MOTS NE SUFFISAIT PAS : LA CSS RECOUPAIT DERRIERE.
// Movsar, 2026-08-14, capture en fenetre AGRANDIE : « Camille Laurent · Bowl…
// · ✓ · 6j · 1h ». Le raccourcissement ci-dessous marchait pourtant : il rend
// « Bowling », sept lettres entieres. C'est `text-overflow: ellipsis` qui
// recoupait ce mot deja court des que la place manquait. Raccourcir le TEXTE
// et laisser la mise en page le retailler, c'est deux regles qui se
// contredisent, et c'est toujours la seconde qui gagne.
//
// La regle est donc devenue binaire : ENTIER OU ABSENT. Le texte vit dans un
// enfant que le CSS n'affiche que si la place qui RESTE peut le contenir en
// entier ; sinon il n'y a rien du tout, et jamais un morceau. La classe de
// longueur (`lab-s` / `lab-m` / `lab-l`) porte le seul chiffre dont le CSS a
// besoin pour trancher : combien de caracteres il doit loger. Le libelle
// complet reste dans l'infobulle et dans la fiche.
function renderCardActivityTag(reservation, view = 'bowling') {
  const complet = String(getReservationLabel(reservation) || '').trim();
  const texte = getPlanningCardOfferLabel(reservation, view);
  // La boite reste, meme vide : c'est elle qui absorbe la place libre et
  // repousse les chiffres a droite. Sans elle, le pied se recollerait au nom.
  // L'offre a maintenant sa propre ligne : quand il n'y a rien a dire, la ligne
  // n'existe pas du tout, au lieu de reserver un vide. Le pied n'a plus besoin
  // d'une boite fantome pour repousser les chiffres, il ne partage plus sa ligne.
  if (!texte) return '';
  return `<span class="b-tag lab-${planningLabelWidthUnits(texte)}" title="${escapeHtml(complet)}"><span class="b-tag-text">${escapeHtml(texte)}</span></span>`;
}

// LARGEUR D UN LIBELLE, EN UNITES DE CARACTERE MOYEN.
// Le CSS a besoin d un seul chiffre pour trancher : combien de place ce texte
// PRECIS reclame. Compter les caracteres ne suffit pas, « Mini-golf » (neuf
// signes) est plus etroit que « Laser x2 » (huit) : mesure au navigateur,
// 41,5 px contre 40,2 px a police egale, et « WWWW » vaut deux fois « iiii ».
// Un comptage brut obligerait donc a reserver la largeur du pire cas pour
// tout le monde, c est-a-dire a masquer des libelles qui tenaient - le defaut
// exact que Movsar avait signale la veille.
// Trois familles suffisent, calibrees sur des mesures reelles a 10 px :
// majuscules et chiffres 1,3 ; signes etroits 0,6 ; le reste 1. L unite vaut
// 0,58 em cote CSS, et le gate mesure les deux sens sur 324 combinaisons.
const PLANNING_LABEL_NARROW = new Set(['i', 'l', 'j', 't', 'f', 'r', '.', ',', '-', ' ', "'"]);
function planningLabelWidthUnits(texte) {
  let unites = 0;
  for (const caractere of String(texte)) {
    if (PLANNING_LABEL_NARROW.has(caractere)) unites += 0.6;
    else if (caractere === caractere.toUpperCase() && caractere !== caractere.toLowerCase()) unites += 1.3;
    else if (caractere >= '0' && caractere <= '9') unites += 1.3;
    else unites += 1;
  }
  // LE PLAFOND MENTAIT DES QUE LE LIBELLE A GRANDI. Il valait 16 unites, ce qui
  // suffisait a « Bowling » (7) mais pas a « FORMULE 4 · Laser x2 » (23) : au-dela
  // du plafond, la classe posee reclamait moins de place que le texte n'en prend,
  // donc le CSS l'affichait sur une piste trop etroite et il debordait de 12px.
  // Un plafond n'est pas un detail de calibration : c'est un MENSONGE des que le
  // contenu le depasse. Il suit maintenant la longueur reelle de l'offre.
  return Math.min(28, Math.max(1, Math.ceil(unites)));
}

const PLANNING_CARD_LABEL_MAX = 12;
// UNE CARTE DIT CE QU'ON NE PEUT PAS DEVINER, PAS CE QU'ON VOIT DEJA.
// Movsar, 2026-08-14 : « les cartes du planning sont super nul pas complet, on
// voit pas formule ». L'information EXISTAIT (`renderReservationTags` fabrique
// bien « FORMULE 5 », « Laser x2 », « Note a lire ») mais deux regles CSS la
// masquaient partout : les etiquettes ne s'affichaient qu'en plein ecran, et
// au-dessus de 190px de piste, alors qu'une piste en fait 147 a huit pistes.
// Elle etait donc rendue dans le DOM et invisible a l'ecran, toujours.
//
// Pendant ce temps le libelle, lui, ecrivait « Bowling » sur un planning DE
// BOWLING : la seule chose que la colonne dit deja. La carte depensait sa
// derniere ligne pour une evidence et taisait ce que le client a achete.
//
// La regle est donc : le libelle porte L'OFFRE, dans l'ordre de ce qui surprend
// un gerant. Une formule d'abord (c'est elle qui commande la soiree), le
// nombre de parties laser ensuite (c'est lui qui contraint l'arene). Quand il
// n'y a ni l'un ni l'autre, la reservation EST l'activite de la colonne, et on
// n'ecrit rien.
function getPlanningCardOfferLabel(reservation, view = 'bowling') {
  const morceaux = [];
  const formule = reservation?.formuleId ? FORMULES.find(x => x.id === reservation.formuleId) : null;
  if (formule || reservation?.type === 'formule') {
    // « FORMULE 5 » tient, « CRAZY STUDENT STRIKE » non : on garde le nom quand
    // il est court, et on retombe sur la NATURE de l'offre, vraie et entiere.
    const nom = String(formule?.name || '').trim();
    morceaux.push(nom && nom.length <= 12 ? nom : 'Formule');
  }
  // LE LASER N'EST PLUS DANS LE TEXTE, IL EST DEVENU UN MARQUEUR.
  // « FORMULE 5 · Laser x2 » fait 20 caracteres : sur une piste de 147px la
  // regle « entier ou absent » le jugeait trop long et n'affichait RIEN, donc
  // on reperdait la formule pour avoir voulu dire deux choses. La formule seule
  // (« FORMULE 5 ») tient des 64px de piste. Le nombre de parties laser part
  // dans les marqueurs, ou il coute 13px au lieu de 60.
  if (morceaux.length) return morceaux.join(' · ');
  // Ni formule ni laser multiple : la colonne dit deja l'activite. On ne repete
  // pas « Bowling » sur le planning bowling.
  if (view === 'bowling' || view === 'laser') return '';
  return getPlanningCardLabel(reservation);
}

function getPlanningCardLabel(reservation) {
  const complet = String(getReservationLabel(reservation) || '').trim();
  if (!complet || complet.length <= PLANNING_CARD_LABEL_MAX) return complet;
  // Une formule porte un nom commercial qui peut faire vingt caractères
  // (« CRAZY STUDENT STRIKE »). Son premier mot n'en dit rien de juste : on
  // nomme la NATURE de l'offre, qui est vraie et entière.
  if (reservation && (reservation.type === 'formule' || reservation.formuleId)) return 'Formule';
  const premier = complet.split(/\s+/).filter(Boolean)[0] || '';
  return premier.length <= PLANNING_CARD_LABEL_MAX ? premier : '';
}

// Bloc effectif + durée commun aux cartes bowling ET laser. Le libellé texte
// porte toujours l'info (accessibilité : jamais de sens porté par la couleur
// seule) ; la couleur/pastille ne fait que renforcer.
function renderCardStats(pax, durationLabel, options = {}) {
  const special = Boolean(options.special);
  const paxNum = Math.max(0, Number(pax) || 0);
  const grp = getGroupSizeClass(paxNum);
  const durClass = special ? 'bk-dur dur-special' : 'bk-dur';
  const durTitle = options.durationTitle || durationLabel;
  return `<span class="booking-stats">`
    + `<span class="bk-pax ${grp}" title="${paxNum} joueur${paxNum > 1 ? 's' : ''}">${paxNum}<span class="u"><span class="u-short">j</span><span class="u-long">&nbsp;joueurs</span></span></span>`
    + `<span class="bk-sep" aria-hidden="true">·</span>`
    + `<span class="${durClass}" title="Durée ${escapeHtml(durTitle)}">${escapeHtml(durationLabel)}</span>`
    + `</span>`;
}

function getReservationHighlightClasses(reservation) {
  const classes = [];
  // Ce qui vient de tomber du site pendant le service se signale DANS la liste
  // et DANS le planning, pas seulement dans le bandeau du coin qu'on rate quand
  // on a la tete au comptoir. Le bloc `.booking` et la ligne `.res-row` passent
  // tous les deux par ici : un seul branchement couvre les deux vues.
  // Le marquage se perime tout seul au bout de trois minutes - un ecran ou tout
  // brille est un ecran ou plus rien ne ressort.
  if (typeof PinlaneMotion !== 'undefined' && PinlaneMotion.estNeuve(reservation.id)) classes.push('is-neuve');
  if (reservation.type === 'formule' || reservation.formuleId) classes.push('is-formula');
  const bowlingDuration = getBowlingDurationForReservation(reservation);
  if (bowlingDuration && Math.abs(bowlingDuration - 1) > 0.01) classes.push('is-special-duration');
  if (getLaserGameCountForReservation(reservation) > 1) classes.push('is-laser-multi');
  return classes.join(' ');
}

// `notes` MÉLANGE plusieurs sources : demande particulière du client, libellé
// libre d'une occasion « autre », note staff saisie au QuickBook, ajouts
// serveur (noteAppend) et marqueurs de simulation [SIM:<runId>]. Le libellé
// affiché dit donc « Note », jamais « Demande du client » : l'UI n'affirme que
// ce que la donnée prouve. Les marqueurs de simulation sont retirés, sinon une
// réservation simulée compterait comme une vraie demande.
function getReservationNoteText(reservation = {}) {
  // `[ops:xxx]` marque les traces posees par le moteur (retard, decalage) pour
  // qu'elles puissent etre RETIREES quand l'operation est annulee. Le marqueur
  // est une mecanique interne : il ne se lit jamais a l'ecran.
  return String(reservation.notes || '')
    .replace(/\[SIM:[^\]]*\]/g, '')
    .replace(/\[ops:[^\]]*\]\s*/g, '')
    .trim();
}

function hasReservationNote(reservation) {
  return !!getReservationNoteText(reservation);
}

// UNE NOTE QU ON NE PEUT PAS LIRE N EST PAS UNE NOTE, C EST UN RAPPEL D OUBLI.
// Movsar, 2026-08-14 : « il y a aussi les notes a lire qui s affichent nulle
// part, on sait pas lire la note ». L etiquette « Note a lire » etait posee sur
// la ligne depuis toujours, et le TEXTE n apparaissait sur aucune surface de
// liste : il fallait ouvrir la fiche pour decouvrir de quoi il s agissait, donc
// ouvrir chaque dossier marque pour savoir si la consigne concernait ce
// service. Dans une table, la colonne « Réservation » a la largeur pour la dire.
// Elle est ecrite en entier jusqu a 90 caracteres, coupee au MOT au-dela, et le
// texte complet reste dans l infobulle et dans la fiche.
// LES ORBES DE REFLEXION : « chargement » ne dit pas ce qui se passe.
// Toutes les surfaces d'agent affichaient le meme mot, « Chargement… », que la
// machine soit en train de lire la base, d'appeler un modele ou de composer un
// texte. Or ces trois attentes n'ont ni la meme duree ni la meme raison, et
// c'est justement ce qu'un gerant veut savoir quand il regarde un ecran qui ne
// bouge pas. Cinq etats, chacun avec son mouvement (voir le bloc `.pl-orbs`
// dans la feuille de style).
// Les orbes sont DECORATIVES (`aria-hidden`) : c'est le libelle qui porte
// l'information, et une synthese vocale lit « L'agent rédige », pas trois
// points qui bougent.
// NEUF ETATS, PAS UN SEUL « chargement ». Chacun correspond a un etat du
// moteur `thinking-orbs` (voir `assets/thinking-orbs.js` pour l'attribution et
// ce qui est repris tel quel). Le libelle FRANCAIS dit ce que la machine fait ;
// l'animation dit qu'elle le fait encore. Les deux ensemble evitent la question
// « est-ce que c'est bloque ? », qui est la seule que pose un ecran fige.
const PL_THINKING_LABELS = {
  breathing: 'L’agent réfléchit',
  composing: 'L’agent rédige',
  searching: 'Lecture des données',
  solving: 'Analyse en cours',
  connecting: 'Envoi en cours',
  working: 'Traitement en cours',
  weaving: 'Assemblage des données',
  listening: 'Écoute des réponses',
  shaping: 'Mise en forme',
};

// UNE ATTENTE LONGUE MONTRE OU ELLE EN EST.
// `renderThinking` dit « ca travaille » ; celle-ci dit « voila ce qui est fait,
// voila ce qui reste ». Les etapes nomment le travail REEL du cycle marketing
// (lire les donnees du centre, les croiser, rediger, verifier ce qu'on avance) :
// une progression inventee serait un mensonge anime. La barre ne revient jamais
// en arriere et la derniere etape reste affichee jusqu'a la reponse : voir une
// barre se vider fait conclure que ca a echoue.
function renderThinkingSteps(etapes, options = {}) {
  const liste = (etapes || []).filter((etape) => etape && etape.state && etape.label);
  if (!liste.length) return renderThinking('breathing', options);
  const premiere = liste[0];
  const cadence = Number(options.stepMs) || 1600;
  return `<div class="pl-progress" role="status" aria-live="polite"`
    + ` data-orb-steps="${escapeHtml(JSON.stringify(liste))}" data-orb-step-ms="${cadence}">`
    + `<canvas class="pl-orb-canvas" data-orb-state="${escapeHtml(premiere.state)}" data-orb-size="64" aria-hidden="true"></canvas>`
    + `<div class="pl-progress-body">`
    + `<span class="pl-progress-label" data-orb-step-label>${escapeHtml(premiere.label)}</span>`
    + `<span class="pl-progress-track"><span class="pl-progress-bar" data-orb-step-bar style="width:${Math.round(100 / liste.length)}%"></span></span>`
    + `</div></div>`;
}
window.renderThinkingSteps = renderThinkingSteps;

function renderThinking(etat = 'breathing', options = {}) {
  const cle = PL_THINKING_LABELS[etat] ? etat : 'breathing';
  const libelle = options.label || PL_THINKING_LABELS[cle];
  // Deux tailles, celles du moteur : 20 en ligne dans un texte, 64 quand
  // l'attente occupe un panneau entier et qu'il n'y a rien d'autre a regarder.
  const taille = Number(options.size) === 64 ? 64 : 20;
  return `<span class="pl-thinking" role="status" aria-live="polite">`
    + `<canvas class="pl-orb-canvas" data-orb-state="${cle}" data-orb-size="${taille}" aria-hidden="true"></canvas>`
    + `<span>${escapeHtml(libelle)}</span></span>`;
}
window.renderThinking = renderThinking;

// LA NOTE SE LIT AUSSI QUAND ON OUVRE LE DOSSIER.
// Movsar, 2026-08-14 : « la note, on doit pouvoir la lire aussi quand on clique
// sur la carte, ou on voit les infos ». La fiche « Infos » affichait le plan
// automatique, le contact, le retard, mais pas la consigne du client : le seul
// endroit ou on ouvre un dossier pour comprendre ce qu'il a de particulier ne
// disait pas ce qu'il a de particulier. Elle se place juste apres l'action,
// avant le programme : c'est ce qui change la maniere de servir.
function renderPosNoteBlock(reservation) {
  const note = getReservationNoteText(reservation);
  if (!note) return '';
  return `<section class="info-block pos-note-block">
    <span class="info-label">Note du dossier</span>
    <p class="pos-note-text">${escapeHtml(note)}</p>
  </section>`;
}

function renderReservationNoteLine(reservation) {
  const note = getReservationNoteText(reservation);
  if (!note) return '';
  let affiche = note;
  if (note.length > 90) {
    const coupe = note.slice(0, 90);
    const dernierEspace = coupe.lastIndexOf(' ');
    affiche = `${(dernierEspace > 40 ? coupe.slice(0, dernierEspace) : coupe).trim()}…`;
  }
  return `<span class="res-note-line" title="${escapeHtml(note)}">`
    + `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 14.4a2 2 0 0 1-2 2H8.2L4 20.4V5.6a2 2 0 0 1 2-2h12.5a2 2 0 0 1 2 2z"/></svg>`
    + `<span>${escapeHtml(affiche)}</span></span>`;
}

// MARQUEURS DE CARTE : ce qui change la maniere de servir, en une forme.
// Une note et un anniversaire ne se lisent pas comme un chiffre : ce sont des
// consignes. Sur 147px de piste, les ecrire en toutes lettres coute la ligne
// entiere de l'offre ; en icone titree, ils coutent 13px et restent lisibles
// par la synthese vocale. Le texte complet vit dans la fiche, ou on l'ouvre
// justement pour le lire.
function renderCardFlags(reservation) {
  const marques = [];
  const parties = getLaserGameCountForReservation(reservation);
  if (parties > 1) {
    marques.push({
      cls: 'flag-laser',
      label: `${parties} parties de laser`,
      texte: `x${parties}`,
      path: '<circle cx="12" cy="12" r="6.4"/><path d="M12 2.6v3M12 18.4v3M2.6 12h3M18.4 12h3"/>',
    });
  }
  if (getReservationOccasion(reservation) === 'birthday') {
    marques.push({
      cls: 'flag-birthday',
      label: 'Anniversaire',
      path: '<path d="M5 21h14M6 21v-6h12v6M12 9V6"/><path d="M6 15a2.4 2.4 0 0 0 3 0 2.4 2.4 0 0 1 3 0 2.4 2.4 0 0 0 3 0 2.4 2.4 0 0 1 3 0"/><circle cx="12" cy="4.4" r="1.1"/>',
    });
  }
  if (hasReservationNote(reservation)) {
    marques.push({
      cls: 'flag-note',
      label: 'Note a lire',
      // UNE BULLE, PAS UN ROND D'ALERTE. Movsar, 2026-08-14 : « le petit badge
      // attention est proche de celui qui montre la piste en retard, donc
      // relou ». Les deux etaient un cercle : a 12px, un cercle avec un point
      // ressemble a tous les autres cercles avec un point. Une bulle de message
      // ne peut se confondre avec rien, et elle dit ce qu'elle est.
      path: '<path d="M20.5 14.4a2 2 0 0 1-2 2H8.2L4 20.4V5.6a2 2 0 0 1 2-2h12.5a2 2 0 0 1 2 2z"/><path d="M8.4 8.6h7.6M8.4 11.8h4.8"/>',
    });
  }
  if (!marques.length) return '';
  return `<span class="bk-flags">${marques.map(m => `<span class="bk-flag ${m.cls}" role="img" aria-label="${m.label}" title="${m.label}">`
    + `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${m.path}</svg>`
    + (m.texte ? `<span class="bk-flag-num">${escapeHtml(m.texte)}</span>` : '')
    + `</span>`).join('')}</span>`;
}

// `contexteSeul` : ne rend QUE ce que la ligne ne dit pas deja ailleurs.
// Dans la liste refaite, la formule est ecrite dans sa colonne, la duree dans
// la colonne de gauche et les parties laser dans les marqueurs : les repeter en
// etiquettes, c'est ecrire trois fois le meme fait, ce qui etait exactement le
// defaut signale. Restent l'occasion et la note, qui n'ont aucune autre place.
function renderReservationTags(reservation, options = {}) {
  const tags = [];
  const contexteSeul = Boolean(options.contexteSeul);
  const formule = reservation.formuleId ? FORMULES.find(x => x.id === reservation.formuleId) : null;
  if (!contexteSeul && (reservation.type === 'formule' || formule)) tags.push({ cls: 'formula', label: formule?.name || 'Formule' });
  const bowlingDuration = getBowlingDurationForReservation(reservation);
  if (!contexteSeul && bowlingDuration && Math.abs(bowlingDuration - 1) > 0.01) {
    tags.push({ cls: 'duration', label: `Bowling ${formatDurationLabel(bowlingDuration)}` });
  }
  const laserGames = getLaserGameCountForReservation(reservation);
  if (!contexteSeul && laserGames > 1) tags.push({ cls: 'laser-plus', label: `Laser x${laserGames}` });
  // Occasion + note : sans ça, la liste dense du jour n'affiche RIEN d'une
  // réservation qui porte une demande particulière.
  const occasion = getReservationOccasion(reservation);
  if (occasion) tags.push({ cls: 'occasion', label: (STAFF_OCCASION_LABELS[occasion] || '').split(' / ')[0] });
  if (hasReservationNote(reservation)) tags.push({ cls: 'note', label: 'Note à lire' });
  if (!tags.length) return '';
  return `<div class="reservation-tags">${tags.map(tag => `<span class="reservation-tag ${tag.cls}">${tag.label}</span>`).join('')}</div>`;
}

// Flag d'affichage « retard » posé par l'application d'un plan de retard
// (opsPlan.delayFlag). Actif tant qu'il n'a pas été retiré (cleared) par le
// staff depuis la carte. Purement visuel : n'affecte pas l'horaire appliqué.
function getReservationDelayFlag(reservation) {
  const flag = reservation && reservation.opsPlan && reservation.opsPlan.delayFlag;
  if (!flag || flag.cleared) return null;
  return flag;
}

// Petit indicateur horloge « +X min » sur la carte planning, avec tooltip
// (« retardée de X min, 15:00→15:15 »). Cliquable pour retirer l'indicateur.
function renderDelayIndicator(reservation) {
  const flag = getReservationDelayFlag(reservation);
  if (!flag) return '';
  const mins = Math.round(Number(flag.minutes) || 0);
  const range = flag.from && flag.to ? ` ${flag.from}→${flag.to}` : '';
  const tip = `Retardée de ${mins} min${range ? ` (${flag.from}→${flag.to})` : ''}, cliquer pour retirer le retard et remettre à l'heure d'origine`;
  return `<button type="button" class="delay-indicator" title="${escapeHtml(tip)}" aria-label="${escapeHtml(tip)}" onmousedown="event.stopPropagation()" onclick="revertDelay(event, ${reservation.id})">`
    + `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 16 14"/></svg>`
    + `<span class="delay-indicator-label">+${mins}</span></button>`;
}

// Retire l'indicateur de retard directement depuis la carte planning. Le
// serveur passe opsPlan.delayFlag.cleared = true SANS toucher à l'horaire.
async function clearDelayFlag(ev, id) {
  if (ev) { ev.stopPropagation(); ev.preventDefault(); }
  const reservation = state.reservations.find(item => Number(item.id) === Number(id));
  const centerId = (reservation && reservation.centerId) || state.adminCenterId || 'libramont';
  try {
    const payload = await apiRequest(API_ENDPOINTS.ops, {
      method: 'POST',
      body: JSON.stringify({ action: 'delayClear', centerId, reservationId: Number(id) })
    });
    if (payload.reservation) upsertReservationInState(payload.reservation);
    if (state.selectedRes && Number(state.selectedRes.id) === Number(id) && payload.reservation) {
      state.selectedRes = payload.reservation;
    }
    save();
    renderStaffData();
    renderPos();
    toast(payload.cleared === false ? 'Aucun indicateur à retirer.' : 'Indicateur de retard retiré.');
  } catch (error) {
    toast(error.message || 'Impossible de retirer l\'indicateur de retard.');
  }
}

// Retire le retard d'une réservation ET restaure son créneau d'origine (heure +
// plan + pistes) via l'action serveur delayRevert (snapshot pré-décalage). Si
// l'origine n'est pas restaurable (retard legacy / résa cascadée), le serveur se
// contente de masquer l'indicateur et le signale dans le message.
async function revertDelay(ev, id) {
  if (ev) { ev.stopPropagation(); ev.preventDefault(); }
  const reservation = state.reservations.find(item => Number(item.id) === Number(id));
  const centerId = (reservation && reservation.centerId) || state.adminCenterId || 'libramont';
  try {
    const payload = await apiRequest(API_ENDPOINTS.ops, {
      method: 'POST',
      body: JSON.stringify({ action: 'delayRevert', centerId, reservationId: Number(id) })
    });
    if (payload.reservation) upsertReservationInState(payload.reservation);
    if (state.selectedRes && Number(state.selectedRes.id) === Number(id) && payload.reservation) {
      state.selectedRes = payload.reservation;
    }
    save();
    renderStaffData();
    renderPos();
    if (payload.reverted) toast('Retard retiré : créneau d\'origine restauré.');
    else if (payload.message) toast(payload.message);
    else toast('Aucun retard à retirer.');
  } catch (error) {
    toast(error.message || 'Impossible de retirer le retard.');
  }
}

function getReservationCommercialStore(reservation) {
  return reservation?.opsPlan?.guestOps && typeof reservation.opsPlan.guestOps === 'object'
    ? reservation.opsPlan.guestOps
    : {};
}

// SUPPRIMÉ le 2026-08-13 : `getReservationCheckInCode`, qui fabriquait un code
// du genre « FG-260813-0930 » (enseigne en dur + date + 4 derniers chiffres de
// l'identifiant). Movsar, verbatim : « pourquoi il y a des trucs genre FG chais
// pas quoi, ça sert à rien ici ». Il avait raison, et pour une raison plus dure
// que l'encombrement : ce code N'EXISTAIT NULLE PART AILLEURS. Il n'était ni
// stocké en base, ni envoyé dans un email, ni accepté par la recherche du staff
// (`getPlanningVisibleReservations` cherche sur nom / téléphone / offre / email),
// ni affiché dans le détail du dossier. Personne ne pouvait donc retrouver une
// réservation avec. C'est exactement ce que la Product Rule de DESIGN.md §9
// interdit : donner l'illusion d'une donnée que le backend ne fournit pas.
// Le préfixe « FG » était en prime codé en dur : un 2e client aurait vu la
// marque de Fun Galaxy sur ses propres dossiers.
// LA VRAIE RÉFÉRENCE EXISTE, et c'est l'identifiant de la réservation : il est
// stocké, unique, stable. Il est désormais montré là où une référence sert
// vraiment : l'en-tête du dossier et l'export.
function reservationRequiresGuestWaiver(reservation) {
  return reservation?.type === 'laser'
    || getLaserGameCountForReservation(reservation) > 0
    || getLaserWindowsFromReservation(reservation).length > 0;
}

function getReservationGuestOps(reservation) {
  const stored = getReservationCommercialStore(reservation);
  const waiverRequired = Boolean(stored.waiverRequired ?? reservationRequiresGuestWaiver(reservation));
  const checkInDone = Boolean(stored.checkInDone || reservation.status === 'arrived' || reservation.status === 'paid');
  const waiverDone = Boolean(stored.waiverDone);
  const missing = [];
  if (waiverRequired && !waiverDone) missing.push('consignes laser');
  if (!checkInDone) missing.push('check-in');
  const scoreBase = [!waiverRequired || waiverDone, checkInDone];
  const readinessScore = Math.round((scoreBase.filter(Boolean).length / scoreBase.length) * 100);
  return {
    waiverRequired,
    waiverDone,
    checkInDone,
    reminderSent: Boolean(stored.reminderSent),
    lastUpdatedAt: stored.updatedAt || '',
    missing,
    readinessScore,
  };
}

function getGuestOpsChips(reservation) {
  const guest = getReservationGuestOps(reservation);
  const chips = [];
  if (guest.waiverRequired) {
    chips.push({
      cls: guest.waiverDone ? 'ok' : 'warn',
      label: guest.waiverDone ? 'Consignes OK' : 'Consignes laser',
    });
  }
  // La pastille dit l'ÉTAT, pas un code. Un code qu'on ne peut chercher nulle
  // part mangeait la ligne à la place de l'information qui sert au comptoir.
  chips.push({
    cls: guest.checkInDone ? 'ok' : 'danger',
    label: guest.checkInDone ? 'Check-in OK' : 'Check-in à faire',
  });
  return chips;
}

function renderGuestOpsMini(reservation) {
  const chips = getGuestOpsChips(reservation).slice(0, 3);
  return `<div class="guest-mini">${chips.map(chip => `<span class="guest-chip ${escapeHtml(chip.cls)}">${escapeHtml(chip.label)}</span>`).join('')}</div>`;
}

function renderAdminGuestOpsCell(reservation) {
  const chips = getGuestOpsChips(reservation);
  return `<div class="engagement-cell">${chips.map(chip => `<span class="guest-chip ${escapeHtml(chip.cls)}">${escapeHtml(chip.label)}</span>`).join('')}</div>`;
}

function getOpsPlanFixedCommitments(plan) {
  return Array.isArray(plan?.entitlements?.fixedCommitments) ? plan.entitlements.fixedCommitments : [];
}

function getOpsPlanFlexibleEntitlements(plan) {
  return Array.isArray(plan?.entitlements?.flexibleEntitlements) ? plan.entitlements.flexibleEntitlements : [];
}

function formatOpsCommitment(item) {
  if (!item) return '';
  const label = item.type === 'bowling'
    ? `Bowling${Array.isArray(item.lanes) && item.lanes.length ? ` pistes ${item.lanes.join(', ')}` : ''}`
    : item.type === 'laser_game'
      ? `Laser${item.countIndex ? ` partie ${item.countIndex}` : ''}`
      : item.label || item.type || 'Ressource';
  const time = item.startTime ? `${item.startTime}${item.endTime ? `-${item.endTime}` : ''}` : '';
  return [label, time].filter(Boolean).join(' · ');
}

function getOpsPlanPrimarySignal(plan) {
  const warnings = Array.isArray(plan?.marketIntelligence?.warnings) ? plan.marketIntelligence.warnings : [];
  if (warnings.length) return { cls: 'warn', text: warnings[0] };
  const checklist = Array.isArray(plan?.operationsChecklist) ? plan.operationsChecklist : [];
  if (checklist.length) return { cls: 'fixed', text: checklist[0] };
  const commitments = Array.isArray(plan?.customerCommitment) ? plan.customerCommitment : [];
  if (commitments.length) return { cls: '', text: commitments[0] };
  return null;
}

function renderStaffOpsMini(reservation) {
  const plan = reservation?.opsPlan;
  if (!plan) return '';
  const signal = getOpsPlanPrimarySignal(plan);
  const fixed = getOpsPlanFixedCommitments(plan).slice(0, 2).map(formatOpsCommitment).filter(Boolean);
  const lines = [];
  if (fixed.length) lines.push(`<span class="res-ops-line fixed">${escapeHtml(fixed.join(' · '))}</span>`);
  if (signal?.text) lines.push(`<span class="res-ops-line ${escapeHtml(signal.cls)}">${escapeHtml(signal.text)}</span>`);
  if (!lines.length) return '';
  return `<div class="res-ops-mini">${lines.join('')}</div>`;
}

function renderStaffShell(dayReservations = todaysReservations()) {
  const normalizedPage = normalizeStaffMenuPage(state.staffMenuPage);
  if (state.staffMenuPage !== normalizedPage) {
    state.staffMenuPage = normalizedPage;
    save();
  }
  const setPageVisibility = (id, active) => {
    const element = document.getElementById(id);
    if (!element) return;
    element.classList.toggle('hidden', !active);
    element.setAttribute('aria-hidden', active ? 'false' : 'true');
    if (active) element.removeAttribute('inert');
    else element.setAttribute('inert', '');
  };
  const dashboardActive = isStaffDashboardActive();
  const reservationsActive = isStaffReservationsActive();
  const clientsActive = isStaffClientsActive();
  const pricingActive = isStaffPricingActive();
  const emailsActive = isStaffEmailsActive();
  const campaignsActive = isStaffCampaignsActive();
  const utilityActive = isStaffUtilityActive();
  const cockpitActive = isStaffCockpitActive();
  setPageVisibility('staffDashboardPage', dashboardActive);
  setPageVisibility('staffReservationsPage', reservationsActive);
  setPageVisibility('staffClientsPage', clientsActive);
  setPageVisibility('staffPricingPage', pricingActive);
  setPageVisibility('staffEmailsPage', emailsActive);
  setPageVisibility('staffCampaignsPage', campaignsActive);
  setPageVisibility('staffUtilityPage', utilityActive);
  setPageVisibility('staffCockpitPage', cockpitActive);
  ['.staff-head', '.kpi-grid', '.staff-resource-tabs', '#planningBox', '#laserPlanningBox', '.table-box'].forEach(selector => {
    document.querySelectorAll(`#staffView ${selector}`).forEach(element => element.classList.toggle('hidden', dashboardActive || reservationsActive || clientsActive || pricingActive || emailsActive || campaignsActive || utilityActive || cockpitActive));
  });
  const d = parseLocalDate(state.currentDate);
  const view = getStaffResourceView();
  const scopedReservations = dayReservations.filter(r => reservationMatchesStaffResource(r, view));
  const now = currentTimeDecimal();
  const activeWindows = scopedReservations
    .flatMap(r => getStaffResourceWindows(r, view).map(window => ({ ...window, reservation: r })))
    .filter(window => window.start <= now && now < window.end);
  const activeReservationIds = new Set(activeWindows.map(window => window.reservation.id));
  const activeSessions = view === 'laser' ? activeWindows.length : activeReservationIds.size;
  const activeLaserPlayers = activeWindows.reduce((sum, window) => sum + (Number(window.players || window.reservation?.pax) || 0), 0);
  const activeLanes = new Set(activeWindows.flatMap(window => window.lanes || [])).size;
  const nextArrival = [...scopedReservations]
    .filter(r => getReservationFirstResourceStart(r, view) >= now && r.status !== 'paid')
    .sort((a, b) => getReservationFirstResourceStart(a, view) - getReservationFirstResourceStart(b, view))[0];
  const activeLabel = view === 'all'
    ? `${scopedReservations.length} réservation${scopedReservations.length > 1 ? 's' : ''} au total`
    : view === 'laser'
    ? `${activeSessions} lancement${activeSessions > 1 ? 's' : ''} en cours • ${activeLaserPlayers} joueurs laser`
    : `${activeSessions} session${activeSessions > 1 ? 's' : ''} en cours • ${activeLanes} piste${activeLanes > 1 ? 's' : ''} occupée${activeLanes > 1 ? 's' : ''}`;
  const nextLabel = nextArrival
    ? ` • prochaine ${view === 'laser' ? 'session' : 'arrivée'} ${formatClockDisplay(getReservationFirstResourceStart(nextArrival, view))}`
    : '';
  const dateLabel = document.getElementById('staffDateLabel');
  if (dateLabel) {
    const dateText = d.toLocaleDateString('fr-BE', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
    dateLabel.textContent = dateText.charAt(0).toUpperCase() + dateText.slice(1);
    dateLabel.dataset.now = new Date().toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
  }
  const dateShort = document.getElementById('staffDateShort');
  if (dateShort) {
    const shortDateText = d.toLocaleDateString('fr-BE', { weekday:'short', day:'numeric', month:'short', year:'numeric' }).replace(',', '');
    dateShort.textContent = shortDateText.charAt(0).toUpperCase() + shortDateText.slice(1);
  }
  const prevBtn = document.getElementById('staffPrevDateBtn');
  if (prevBtn) prevBtn.disabled = false;

  const bowlingReservations = dayReservations.filter(r => getBowlingWindowsFromReservation(r).length > 0);
  const planningWindow = getPlanningWindow(state.currentDate);
  const bowlingPlayers = bowlingReservations.reduce((sum, reservation) => sum + (Number(reservation.pax) || 0), 0);
  const planningSub = document.getElementById('planningSub');
  if (planningSub) planningSub.textContent = `${bowlingReservations.length} réservation${bowlingReservations.length > 1 ? 's' : ''} bowling • ${bowlingPlayers} joueurs • ${planningWindow.closed ? 'centre fermé' : planningWindow.label}`;
  const planningSearchInput = document.getElementById('planningSearchInput');
  if (planningSearchInput && planningSearchInput !== document.activeElement) planningSearchInput.value = state.searchTerm || '';
  const laserPlanningSearchInput = document.getElementById('laserPlanningSearchInput');
  if (laserPlanningSearchInput && laserPlanningSearchInput !== document.activeElement) laserPlanningSearchInput.value = state.searchTerm || '';
  syncStaffResourceTabs(dayReservations, view);
}

function renderKpis() {
  const view = getStaffResourceView();
  const res = scopedStaffReservations(view);
  let revTotal = 0, revColl = 0, pax = 0, bookedUnits = 0;
  res.forEach(r => {
    revTotal += Number(r.price) || 0;
    pax += Number(r.pax) || 0;
    if (r.status === 'paid') revColl += Number(r.price) || 0;
    if (view === 'laser') {
      bookedUnits += getLaserWindowsFromReservation(r).reduce((sum, window) => sum + (Number(window.players || r.pax) || 0), 0);
    } else if (view === 'all') {
      bookedUnits += getBowlingWindowsFromReservation(r).reduce((sum, window) => sum + ((Number(window.duration) || 0) * Math.max((window.lanes || []).length, 1)), 0);
      bookedUnits += getLaserWindowsFromReservation(r).reduce((sum, window) => sum + ((Number(window.players || r.pax) || 0) / Math.max(LASER_GAME_MAX_PLAYERS, 1)), 0);
    } else {
      bookedUnits += getBowlingWindowsFromReservation(r).reduce((sum, window) => sum + ((Number(window.duration) || 0) * Math.max((window.lanes || []).length, 1)), 0);
    }
  });
  const windowCfg = getPlanningWindow(state.currentDate);
  const totalAvail = windowCfg.closed
    ? 0
    : view === 'all'
      ? (TOTAL_LANES * Math.max(windowCfg.close - windowCfg.open, 1)) + Math.max((windowCfg.close - windowCfg.open) * 2, 1)
      : view === 'laser'
        ? LASER_GAME_MAX_PLAYERS * LASER_GAME_PARALLEL_LAUNCHES * Math.max((windowCfg.close - windowCfg.open) * 2, 1)
        : TOTAL_LANES * Math.max(windowCfg.close - windowCfg.open, 1);
  const occ = totalAvail > 0 ? Math.round((bookedUnits / totalAvail) * 100) : 0;
  const kpiCards = document.querySelectorAll('#staffView .kpi-grid .kpi');
  const setKpiCopy = (index, label, hint) => {
    const card = kpiCards[index];
    if (!card) return;
    const labelEl = card.querySelector('.label');
    const hintEl = card.querySelector('.hint');
    if (labelEl) labelEl.textContent = label;
    if (hintEl) hintEl.textContent = hint;
  };
  setKpiCopy(0, "Réservations aujourd'hui", view === 'laser' ? 'sessions laser' : view === 'all' ? 'sessions activité' : 'sessions piste');
  setKpiCopy(1, 'Joueurs prévus', 'personnes');
  setKpiCopy(2, "Chiffre d'affaires", '');
  setKpiCopy(3, "Taux d'occupation", view === 'laser' ? 'capacité laser' : view === 'all' ? 'capacité globale' : 'capacité pistes');
  document.getElementById('kpiRes').textContent = res.length;
  document.getElementById('kpiPax').textContent = pax;
  document.getElementById('kpiRev').textContent = revTotal + '€';
  document.getElementById('kpiCollected').textContent = revColl + '€ validés';
  document.getElementById('kpiOcc').textContent = occ + '%';
}

function renderPlanning() {
  ensureAvailabilityBlocksForPlanning();
  ensureStaffCenterConfigForPlanning();
  const wrap = document.getElementById('planningGridWrap');
  const planningBox = document.getElementById('planningBox');
  // Le re-render (polling 4s / 60s) reconstruit innerHTML et remet le scroll à 0.
  // On mémorise la position pour ne pas faire sauter la vue en mode plein écran.
  const prevScrollTop = wrap ? wrap.scrollTop : 0;
  const prevScrollLeft = wrap ? wrap.scrollLeft : 0;
  const config = getPlanningWindow(state.currentDate);
  if (config.closed) {
    const closedReservations = getPlanningVisibleReservations('bowling')
      .filter(r => getBowlingWindowsFromReservation(r).length > 0);
    if (closedReservations.length) {
      const rows = closedReservations.slice(0, 8).map(reservation => {
        const windows = getBowlingWindowsFromReservation(reservation);
        const resources = windows.map(window => {
          const lanes = window.lanes?.length ? `piste${window.lanes.length > 1 ? 's' : ''} ${window.lanes.join(', ')}` : 'piste auto';
          return `${lanes} ${formatClockDisplay(window.start)}-${formatClockDisplay(window.end)}`;
        }).join(' · ');
        return `<button type="button" class="closed-planning-row" onclick="openPos(${staffClientJs(reservation.id)})">
          <span><strong>${escapeHtml(getPlanningBookingDisplayName(reservation))}</strong><small>${escapeHtml(getReservationLabel(reservation))}</small></span>
          <span>${Number(reservation.pax || 0)}j</span>
          <span>${escapeHtml(resources)}</span>
        </button>`;
      }).join('');
      wrap.innerHTML = `<div class="planning-closed-exception">
        <div>
          <strong>Centre fermé, réservations existantes</strong>
          <span>À contrôler par le staff.</span>
        </div>
        <div class="closed-planning-list">${rows}</div>
      </div>`;
      return;
    }
    wrap.innerHTML = `<div class="empty-state"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 15h8"/><path d="M9 9h.01"/><path d="M15 9h.01"/></svg><div class="e-title">Centre fermé ce jour</div><div class="e-sub">Le planning reprend automatiquement aux prochaines heures d'ouverture.</div></div>`;
    return;
  }

  const startHour = config.open;
  const closeHour = config.close;
  const totalHours = Math.max(closeHour - startHour, 1);
  const halfSlots = totalHours * 2;
  // P1-11 : mobile : cellules plus hautes pour des cibles tactiles correctes
  // (slot 30 min = HH/2 = 44px). Le zoom horizontal vient du CSS (largeur de
  // piste lisible + scroll du wrap), la hauteur vient d'ici (positions px JS).
  const compactTouch = !state.staffPlanningExpanded
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(max-width: 768px)').matches;
  const verticalInset = state.staffPlanningExpanded ? 3 : 1;
  // INVARIANT DE NON-CHEVAUCHEMENT, et c'est la cause racine du « bug graphique
  // avec les cartes » : la hauteur MINIMALE d'une carte ne doit JAMAIS dépasser
  // la hauteur du plus petit créneau que la grille sait produire (30 min, soit
  // HH/2, moins les deux marges verticales). Le plein écran violait cet
  // invariant : il laissait la ligne d'heure tomber à 34px (créneau de 30 min =
  // 17px) tout en imposant 40px de hauteur minimale à chaque carte. Résultat,
  // deux réservations qui ne se croisent PAS dans le temps se croisaient à
  // l'écran. On pose donc la hauteur de carte lisible d'abord, et on en DÉDUIT
  // le plancher de la ligne d'heure.
  const MIN_CARD_H = compactTouch ? 42 : 22;
  const MIN_HOUR_H = (MIN_CARD_H + verticalInset * 2) * 2;
  let HH = state.staffPlanningExpanded ? 52 : compactTouch ? 88 : 48;
  let HEADER_H = state.staffPlanningExpanded ? 46 : 38;
  if (state.staffPlanningExpanded) {
    // Plein écran comptoir : toutes les heures d'ouverture doivent tenir d'une
    // traite, sans scroll vertical. La hauteur de ligne n'est donc PAS fixe :
    // on la calcule pour remplir la hauteur disponible.
    // Hauteur totale de la grille = HEADER_H (ligne d'en-tête pistes)
    //   + totalHours * HH (les heures pleines)
    //   + HH/2 (la cellule de fin) => facteur (totalHours + 0.5).
    // On retire une marge de sécurité pour l'éventuelle scrollbar horizontale
    // (pistes larges) afin de ne jamais déborder verticalement.
    // Quand la fenêtre est trop courte pour ça (zoom 200 %, petit écran), la
    // grille défile verticalement : mieux vaut faire défiler que superposer.
    const SCROLLBAR_SAFETY = 14;
    const availableHeight = wrap.clientHeight
      || (window.innerHeight - HEADER_H - 64);
    const usableHeight = availableHeight - HEADER_H - SCROLLBAR_SAFETY;
    const computedHeight = Math.floor(usableHeight / (totalHours + 0.5));
    HH = Math.max(MIN_HOUR_H, computedHeight);
  }
  if (planningBox) {
    planningBox.style.setProperty('--planning-header-h', `${HEADER_H}px`);
    planningBox.style.setProperty('--planning-hour-h', `${HH}px`);
    planningBox.style.setProperty('--planning-hour-col', state.staffPlanningExpanded ? '76px' : '54px');
  }
  const res = getPlanningVisibleReservations('bowling').filter(r => getBowlingWindowsFromReservation(r).length > 0);
  const isToday = state.currentDate === todayStr();
  const curH = currentTimeDecimal();
  const curPos = isToday && curH >= startHour && curH <= closeHour ? (curH - startHour) * HH + HEADER_H : -1;

  let hoursHtml = '';
  for (let slot = 0; slot < halfSlots; slot++) {
    const timeValue = startHour + (slot * 0.5);
    const isHalf = slot % 2 === 1;
    hoursHtml += `<div class="hour-cell ${isHalf ? 'minor' : 'major'}">
      <span class="${isHalf ? 'hour-label-half' : 'hour-label-hour'}">${formatClockDisplay(timeValue)}</span>
    </div>`;
  }
  hoursHtml += `<div class="hour-cell end"><span class="hour-label-end">${formatClockDisplay(closeHour)}</span></div>`;

  const laneBlockWindows = getBowlingBlockWindows(state.currentDate, startHour, closeHour);
  // Nombre de pistes REEL du centre affiche (config staff chargee), avec repli sur
  // la constante historique quand la config n'est pas encore disponible. Corrige le
  // planning qui affichait 8 pistes en dur meme pour un centre a 6 pistes. Ne touche
  // QUE le nombre de lignes rendues : l'allocation et le drag-drop restent inchanges.
  const planningLaneCount = getAvailabilityLaneCount();
  let lanesHtml = '';
  for (let i = 1; i <= planningLaneCount; i++) {
    const maint = state.laneStatuses[i] === 'maintenance';
    const bookings = res.flatMap(r => getBowlingWindowsFromReservation(r)
      .filter(window => window.lanes.includes(i))
      .map(window => ({ reservation: r, window })));
    let cells = '';
    for (let slot = 0; slot < halfSlots; slot++) {
      const cellTime = startHour + (slot * 0.5);
      const halfClass = slot % 2 === 1 ? ' half' : '';
      cells += maint
        ? `<div class="slot-cell${halfClass}"></div>`
        : `<div class="slot-cell clickable${halfClass}" data-bowling-drop-lane="${i}" data-bowling-drop-start="${cellTime}" onclick="quickFromCell(${i},${cellTime})" title="Nouvelle réservation"></div>`;
    }
    cells += `<div class="slot-cell end"></div>`;
    let bkHtml = '';
    bookings.forEach(item => {
      const r = item.reservation;
      const st = item.window.start;
      if (st < startHour || st >= closeHour) return;
      const top = (st - startHour) * HH + HEADER_H + verticalInset;
      const rawHeight = (Number(item.window.duration) * HH) - (verticalInset * 2);
      // MIN_CARD_H tient par construction dans un créneau de 30 min (cf.
      // l'invariant plus haut) : ce plancher ne peut donc plus faire mordre
      // une carte sur la suivante.
      const height = Math.max(rawHeight, MIN_CARD_H);
      const end = formatClockDisplay(item.window.end);
      let cls = 'conf';
      if (r.status === 'arrived') cls = 'arr';
      if (r.status === 'paid') cls = 'paid';
      const densClass = getBookingDensityClass(height, state.staffPlanningExpanded);
      const displayName = getPlanningBookingDisplayName(r);
      const fullName = String(r.name || 'Client');
      const delayedClass = getReservationDelayFlag(r) ? ' is-delayed' : '';
      const bowlingDuration = Number(item.window.duration) || 0;
      const statsHtml = renderCardStats(r.pax, formatCardDurationLabel(bowlingDuration), { special: isSpecialBowlingDuration(bowlingDuration), durationTitle: formatDurationLabel(bowlingDuration) });
      // L'OFFRE N'A SA PROPRE LIGNE QUE SI LA CARTE A LA HAUTEUR DE L'OFFRIR.
      // Mesure : une carte d'1h fait 46px, dont 44 utiles ; trois lignes (nom,
      // offre, chiffres) en demandent 56. L'offre partage donc la ligne des
      // chiffres sur les cartes courtes, exactement comme le libelle d'activite
      // le faisait avant, avec le mecanisme qui la fait ceder toute seule quand
      // la place manque. Sur une carte de 1h30 et plus, elle a la place et la
      // prend : c'est la hauteur reelle qui decide, pas une preference.
      const offreHtml = renderCardActivityTag(r, 'bowling');
      const offreSurSaLigne = densClass === 'dens-lg';
      bkHtml += `<div class="booking ${cls} ${densClass} ${getReservationHighlightClasses(r)}${delayedClass}${activitiesCompleteClass(r)}" data-booking-res-id="${r.id}" data-booking-lane="${i}" data-booking-start="${st}" data-range="${formatClockDisplay(st)} - ${end}" data-extra="${cls === 'paid' ? 'payé' : cls === 'arr' ? 'sur place' : 'confirmé'}" style="top:${top}px;height:${height}px;--bk-order:${i};" onmousedown="startBowlingBookingPointerDrag(event, ${r.id}, ${i}, ${st})" onclick="if(shouldIgnoreBowlingDragClick(event)) return; event.stopPropagation();openPos(${r.id})">
        ${renderDelayIndicator(r)}
        <div class="booking-head">
          <span class="bk-time">${formatClockDisplay(st)}</span>
          <span class="booking-name" title="${escapeHtml(fullName)}">${escapeHtml(displayName)}</span>
          ${renderCardFlags(r)}
          ${renderBookingStateMark(cls)}
        </div>
        ${offreSurSaLigne ? `<div class="booking-offer">${offreHtml}</div>` : ''}
        <div class="booking-foot">
          ${offreSurSaLigne ? '' : offreHtml}
          ${statsHtml}
          ${renderActivityProgressPill(r)}
        </div>
      </div>`;
    });
    const laneWins = laneBlockWindows[i] || [];
    let blockHtml = '';
    laneWins.forEach(w => {
      const blkTop = (w.startH - startHour) * HH + HEADER_H;
      const blkHeight = Math.max((w.endH - w.startH) * HH, 16);
      const blkReason = w.reason ? w.reason : (w.full ? 'Bloque toute la journee' : 'Creneau bloque');
      blockHtml += `<div class="planning-blocked${w.full ? ' full' : ''}" data-blocked-lane="${i}" style="top:${blkTop}px;height:${blkHeight}px;" title="${escapeHtml(blkReason)}"><span>${escapeHtml(blkReason)}</span></div>`;
    });
    lanesHtml += `<div class="lane-col ${maint ? 'maint' : ''}${laneWins.length ? ' has-block' : ''}" data-lane="${i}"${laneWins.length ? ' data-blocked="1"' : ''}>
      <div class="lane-header">
        <span class="pl">Piste</span>
        <span class="num">${i}</span>
        <button class="settings" onclick="toggleMaint(${i}, event)" title="Maintenance" aria-label="Parametres piste ${i}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        </button>
      </div>
      ${cells}
      ${bkHtml}
      ${blockHtml}
    </div>`;
  }

  // L'HEURE COURANTE EN DEUX MORCEAUX, et c'est voulu : la barre traverse les
  // pistes, l'étiquette vit DANS la colonne d'heures. La colonne d'heures est
  // collante à gauche : l'étiquette reste donc lisible même quand on fait
  // glisser un planning à 40 pistes vers la droite. Avant, elle était posée sur
  // la barre elle-même et sortait du cadre au premier défilement.
  const nowBadge = curPos >= HEADER_H
    ? `<div class="current-badge" style="top:${curPos}px" aria-hidden="true">${formatClockDisplay(curH)}</div>`
    : '';
  wrap.innerHTML = `
    <div class="planning-grid">
      ${curPos >= HEADER_H ? `<div class="current-line" style="top:${curPos}px"></div>` : ''}
      <div class="hour-col">
        <div class="hour-header">Heure</div>
        ${hoursHtml}
        ${nowBadge}
      </div>
      <div class="lanes-row">${lanesHtml}</div>
    </div>`;
  wrap.scrollTop = prevScrollTop;
  wrap.scrollLeft = prevScrollLeft;
  markPlanningGridFresh(wrap, state.currentDate);
}

// L'ANIMATION D'ENTREE NE JOUE QU'AU CHANGEMENT DE JOURNEE.
// Le planning se redessine au sondage reseau toutes les 60 secondes : une
// animation posee sans condition rejouerait a chaque tour, et un ecran qui
// clignote toutes les minutes derriere un comptoir n'est pas anime, il est
// casse. On compare donc la journee rendue a la precedente et on ne marque la
// grille que quand elle a vraiment change de jour. La classe se retire des la
// derniere carte arrivee, pour qu'un re-rendu suivant ne la retrouve pas posee.
function markPlanningGridFresh(wrap, dateKey) {
  if (!wrap) return;
  const precedente = wrap.dataset.renderedDate || '';
  wrap.dataset.renderedDate = String(dateKey || '');
  if (precedente === String(dateKey || '')) return;
  wrap.classList.add('is-fresh');
  const cartes = wrap.querySelectorAll('.booking').length;
  window.setTimeout(() => wrap.classList.remove('is-fresh'), 320 + cartes * 22);
}

function getPlanningBookingDisplayName(reservation) {
  const fullName = String(reservation?.name || 'Client').trim();
  if (fullName.length <= 26) return fullName;
  const id = fullName.match(/#\d+\b/)?.[0] || '';
  const activityMatch = fullName.match(/\s+(?:formule|bowling|laser(?: game)?)(?:\s|$)/i);
  let base = activityMatch ? fullName.slice(0, activityMatch.index).trim() : fullName;
  if (!base) base = fullName;
  base = base.replace(/^Anniversaire\b/i, 'Anniv.');
  let candidate = id && !base.includes(id) ? `${base} ${id}` : base;
  if (candidate.length <= 26) return candidate;
  const firstWord = base.split(/\s+/).filter(Boolean)[0] || base;
  candidate = id ? `${firstWord} ${id}` : firstWord;
  if (candidate.length <= 24) return candidate;
  return id ? `${firstWord.slice(0, 14)} ${id}` : firstWord.slice(0, 24);
}

function renderLaserPlanning() {
  ensureAvailabilityBlocksForPlanning();
  ensureStaffCenterConfigForPlanning();
  const wrap = document.getElementById('laserPlanningGridWrap');
  const sub = document.getElementById('laserPlanningSub');
  if (!wrap) return;
  // Préserve le scroll (heures + horizontal) entre deux re-renders du polling.
  const prevScrollTop = wrap.scrollTop;
  const prevScrollLeft = wrap.scrollLeft;
  // En PLEIN ÉCRAN, le wrap est en overflow:hidden (grille 2 colonnes) : le vrai
  // scroller vertical est la timeline `.laser-agenda` (et la file `.laser-pass-queue`
  // à gauche défile aussi). Comme on reconstruit tout le innerHTML, ces éléments
  // repartaient à 0 → « ça remet tout en haut à chaque déplacement ». On mémorise
  // donc leur position pour la restaurer après le rebuild. (Signalé Movsar 2026-07-12.)
  const prevAgenda = wrap.querySelector('.laser-agenda');
  const prevAgendaTop = prevAgenda ? prevAgenda.scrollTop : 0;
  const prevAgendaLeft = prevAgenda ? prevAgenda.scrollLeft : 0;
  const prevQueue = wrap.querySelector('.laser-pass-queue');
  const prevQueueTop = prevQueue ? prevQueue.scrollTop : 0;
  const config = getPlanningWindow(state.currentDate);
  if (config.closed) {
    wrap.innerHTML = `<div class="empty-state"><div class="e-title">Laser fermé ce jour</div><div class="e-sub">Aucun lancement possible sur cette date.</div></div>`;
    if (sub) sub.textContent = 'Centre fermé';
    return;
  }

  const windows = getPlanningVisibleReservations('laser')
    .flatMap(r => getLaserWindowsFromReservation(r).map(window => ({ ...window, reservation: r })))
    .filter(window => window.end > config.open && window.start < config.close);
  const sessionGroups = new Map();
  windows.forEach(window => {
    const key = `${window.start}-${window.end}`;
    if (!sessionGroups.has(key)) {
      sessionGroups.set(key, { start: window.start, end: window.end, windows: [] });
    }
    sessionGroups.get(key).windows.push(window);
  });
  const sessions = [...sessionGroups.values()].sort((a, b) => a.start - b.start);
  const players = windows.reduce((sum, window) => sum + Number(window.players || window.reservation?.pax || 0), 0);
  // Capacite REELLE (armes) du centre affiche, repli sur la constante si config absente.
  const capacity = getAvailabilityLaserCapacity();
  const pendingPasses = getPendingLaserPasses(state.currentDate);
  if (sub) sub.textContent = `${sessions.length} lancement${sessions.length > 1 ? 's' : ''} • ${players} passages • ${pendingPasses.length} partie${pendingPasses.length > 1 ? 's' : ''} à placer • capacité ${capacity} armes`;

  const startHour = config.open;
  const closeHour = config.close;
  const halfSlots = Math.max((closeHour - startHour) * 2, 1);
  const isToday = state.currentDate === todayStr();
  const curH = currentTimeDecimal();
  const sessionsBySlot = new Map();
  sessions.forEach(session => {
    // Arrondi (et non plancher) à la demi-heure la plus proche : une vague qui
    // démarre à :55 (ex. vague 2 d'un groupe scindé) tombe sur la LIGNE suivante
    // (11:00) au lieu d'être empilée avec la vague 1 dans la case 10:30.
    const slotIndex = Math.max(0, Math.min(halfSlots - 1, Math.round((session.start - startHour) * 2)));
    if (!sessionsBySlot.has(slotIndex)) sessionsBySlot.set(slotIndex, []);
    sessionsBySlot.get(slotIndex).push(session);
  });
  // La file « Parties à placer » est TOUJOURS rendue en plein écran (zone
  // permanente) pour ne jamais oublier une partie ; en mode réduit elle
  // n'apparaît que s'il reste des parties à placer.
  const showPassQueue = pendingPasses.length > 0 || state.staffLaserPlanningExpanded;
  const passListHtml = pendingPasses.length
    ? pendingPasses.map(pass => {
        const reservation = pass.reservation;
        const scheduled = getLaserWindowsFromReservation(reservation)
          .filter(window => Number(window.countIndex || 1) === 1)
          .sort((a, b) => a.start - b.start)[0];
        const unitKey = pass.unitKey || `${pass.countIndex}.${pass.waveIndex || 1}`;
        const unitLabel = pass.waveCount > 1
          ? `Vague ${pass.waveIndex}/${pass.waveCount}${pass.totalGames > 1 ? ` • Partie ${pass.countIndex}/${pass.totalGames}` : ''}`
          : `Partie ${pass.countIndex}/${pass.totalGames}`;
        return `<button type="button" class="laser-pass-card" draggable="false" onmousedown="startLaserPassPointerDrag(event, ${reservation.id}, '${unitKey}')" onclick="if(shouldIgnoreLaserPassClick(event)) return; editRes(${reservation.id}, event)" title="Glisser pour placer cette vague">
          <span class="laser-pass-name">${escapeHtml(reservation.name || 'Groupe')}</span>
          <span class="laser-pass-meta">${unitLabel} • ${pass.players} joueur${pass.players > 1 ? 's' : ''}</span>
          <span class="laser-pass-origin">1re partie ${scheduled ? formatClockDisplay(scheduled.start) : formatClockDisplay(timeToNum(reservation.startTime))}</span>
        </button>`;
      }).join('')
    : `<div class="laser-pass-empty">Aucune partie en attente. Toutes les parties sont placées.</div>`;
  const pendingQueueHtml = showPassQueue ? `
    <div class="laser-pass-queue${pendingPasses.length ? '' : ' is-empty'}" aria-label="Parties Laser Game à placer">
      <div class="laser-pass-queue-copy">
        <strong>Parties à placer${pendingPasses.length ? ` • ${pendingPasses.length}` : ''}</strong>
        <span>Glissez une partie <b>ici</b> pour la retirer du planning, ou sur un lancement pour la placer.</span>
      </div>
      <div class="laser-pass-list">
        ${passListHtml}
      </div>
    </div>` : '';

  const renderLaserSession = (session, timeValue) => {
    if (!session) {
      return `<button type="button" class="laser-session-slot is-empty" data-laser-drop-start="${timeValue}" onclick="openQuickBook({ date: state.currentDate, startTime: '${numToTime(timeValue)}', type: 'laser' })" ondragenter="onLaserPassDragEnter(event)" ondragover="onLaserPassDragOver(event)" ondragleave="onLaserPassDragLeave(event)" ondrop="onLaserPassDrop(event, ${timeValue})">
        <span class="laser-empty-title">Disponible</span>
        <span class="laser-empty-sub">${capacity} armes libres</span>
      </button>`;
    }

    const sessionPlayers = session.windows.reduce((sum, window) => sum + Number(window.players || window.reservation?.pax || 0), 0);
    const remaining = Math.max(0, capacity - sessionPlayers);
    const hasFormula = session.windows.some(window => window.reservation?.type === 'formule' || window.reservation?.formuleId);
    const hasDirect = session.windows.some(window => window.reservation?.type === 'laser');
    const shared = session.windows.length > 1;
    const fill = Math.min(100, Math.max(0, (sessionPlayers / capacity) * 100));
    const addStart = getQuickBookStartForLaserSession(session, Math.min(4, Math.max(1, remaining || 1)));
    let cursor = 0;
    const meterSegments = session.windows.map(window => {
      const players = Math.max(1, Number(window.players || window.reservation?.pax || 0));
      const width = Math.min(100 - cursor, Math.max(4, (players / capacity) * 100));
      const left = cursor;
      cursor = Math.min(100, cursor + width);
      const typeClass = window.reservation?.type === 'formule' ? 'formula' : 'direct';
      return `<span class="laser-meter-segment ${typeClass}" style="left:${left}%;width:${width}%;"></span>`;
    }).join('');
    const groupChips = session.windows.map(window => {
      const reservation = window.reservation;
      const players = Math.max(1, Number(window.players || reservation?.pax || 0));
      const isFormulaGroup = reservation.type === 'formule' || reservation.formuleId;
      const typeClass = isFormulaGroup ? 'formula' : 'direct';
      const statusClass = reservation.status === 'paid' ? 'paid' : reservation.status === 'arrived' ? 'arrived' : 'confirmed';
      const waveCount = Number(window.groupWaveCount || 1);
      const waveIndex = Number(window.groupWaveIndex || 1);
      const waveLabel = waveCount > 1 ? `Vague ${waveIndex}/${waveCount}` : '';
      const laserGames = getLaserGameCountForReservation(reservation);
      const passIndex = Number(window.countIndex || 1);
      const unitKey = window.unitKey || `${passIndex}.${waveIndex}`;
      const passLabel = laserGames > 1 ? `Partie ${passIndex}/${laserGames}` : 'Partie unique';
      const label = isFormulaGroup
        ? `${getReservationLabel(reservation)}${laserGames > 1 ? ` • ${passLabel}` : ' • Laser'}`
        : laserGames > 1 ? `Laser • ${passLabel}` : 'Laser direct';
      const pillHtml = `
        <span class="laser-card-pills">
          ${isFormulaGroup ? '<span class="laser-card-pill formula">Formule</span>' : '<span class="laser-card-pill direct">Direct</span>'}
          ${laserGames > 1 ? `<span class="laser-card-pill pass">P${passIndex}/${laserGames}</span>` : ''}
          ${waveCount > 1 ? `<span class="laser-card-pill wave">V${waveIndex}/${waveCount}</span>` : ''}
          ${window.formulaFallback ? '<span class="laser-card-pill fallback">Plan estimé</span>' : ''}
        </span>`;
      const dragTitle = waveCount > 1
        ? `Déplacer la vague ${waveIndex}/${waveCount}${laserGames > 1 ? ` (partie ${passIndex})` : ''}`
        : passIndex > 1 ? `Déplacer la partie ${passIndex}/${laserGames}` : 'Déplacer ce groupe Laser Game';
      const laserDelayedClass = getReservationDelayFlag(reservation) ? ' is-delayed' : '';
      return `<button type="button" class="laser-group-card ${typeClass} ${statusClass}${laserDelayedClass}${activitiesCompleteClass(reservation)}" draggable="false" onmousedown="startLaserPassPointerDrag(event, ${reservation.id}, '${unitKey}')" onclick="if(shouldIgnoreLaserPassClick(event)) return; event.stopPropagation();editRes(${reservation.id}, event)" title="${escapeHtml(dragTitle)}">
        <span class="laser-group-main">
          <strong>${escapeHtml(reservation.name || 'Groupe')}</strong>
          <small>${escapeHtml(label)}${waveLabel ? ` • ${escapeHtml(waveLabel)}` : ''}</small>
          ${pillHtml}
        </span>
        ${renderDelayIndicator(reservation)}
        <span class="booking-stats laser-group-stats">
          ${renderActivityProgressPill(reservation)}
          <span class="bk-pax laser-group-count ${getGroupSizeClass(players)}" title="${players} joueur${players > 1 ? 's' : ''}">${players}<span class="u">j</span></span>
          <span class="bk-dur laser-dur" title="Durée ${escapeHtml(formatDurationLabel(window.duration || (LASER_GAME_ARENA_MINUTES / 60)))}">${escapeHtml(formatDurationLabel(window.duration || (LASER_GAME_ARENA_MINUTES / 60)))}</span>
        </span>
      </button>`;
    }).join('');
    const sessionType = hasFormula && hasDirect ? 'mixte' : hasFormula ? 'formule' : 'direct';

    return `<div class="laser-session-slot has-session ${shared ? 'is-shared' : ''} ${hasFormula ? 'has-formula' : 'has-direct'}" data-laser-drop-start="${session.start}" data-laser-drop-end="${session.end}" role="button" tabindex="0" onclick="openQuickBookForLaserSession(${session.start}, ${remaining})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openQuickBookForLaserSession(${session.start}, ${remaining});}" ondragenter="onLaserPassDragEnter(event)" ondragover="onLaserPassDragOver(event)" ondragleave="onLaserPassDragLeave(event)" ondrop="onLaserPassDrop(event, ${session.start}, ${session.end})" title="Ajouter un groupe sur ce lancement">
      <div class="laser-session-top">
        <div>
          <div class="laser-session-title">${formatClockDisplay(session.start)} - ${formatClockDisplay(session.end)}</div>
          <div class="laser-session-sub">${session.windows.length} groupe${session.windows.length > 1 ? 's' : ''} • ${sessionPlayers}/${capacity} joueurs</div>
        </div>
        <span class="laser-session-kind">${remaining > 0 ? `+ groupe • ${addStart}` : sessionType}</span>
      </div>
      <div class="laser-group-list">${groupChips}</div>
      <div class="laser-capacity-line" aria-label="${sessionPlayers} joueurs sur ${capacity}">
        <span class="laser-capacity-fill" style="width:${fill}%;"></span>
        ${meterSegments}
      </div>
    </div>`;
  };

  let rowsHtml = '';
  for (let slot = 0; slot < halfSlots; slot += 1) {
    const timeValue = startHour + (slot * 0.5);
    const isHalf = slot % 2 === 1;
    const slotSessions = sessionsBySlot.get(slot) || [];
    const current = isToday && curH >= timeValue && curH < timeValue + 0.5;
    // Occupation par tranche = pic de joueurs simultanés parmi les sessions qui
    // CHEVAUCHENT la tranche [timeValue, +30 min), pas seulement celles qui y
    // démarrent : sinon une vague qui déborde (ex. 10:55-11:20) laisse la tranche
    // 11:00 à « 30 armes libres » alors qu'elle est occupée. `max` (pas somme) car
    // deux vagues séquentielles ne tournent jamais en même temps ; exact tant que
    // parallelLaunches === 1 (cas Fun Galaxy).
    const slotStart = timeValue;
    const slotEnd = timeValue + 0.5;
    const activeSessions = sessions.filter(s => s.start < slotEnd && s.end > slotStart);
    const sessionPlayers = activeSessions.reduce((peak, s) => Math.max(peak, s.windows.reduce((inner, window) => inner + Number(window.players || window.reservation?.pax || 0), 0)), 0);
    const remaining = Math.max(0, capacity - sessionPlayers);
    const sessionHtml = slotSessions.length
      ? `<div class="laser-session-stack">${slotSessions.map(session => renderLaserSession(session, timeValue)).join('')}</div>`
      : renderLaserSession(null, timeValue);
    rowsHtml += `<div class="laser-agenda-row ${slotSessions.length ? 'has-session' : 'is-empty'} ${isHalf ? 'is-half' : 'is-hour'} ${current ? 'is-current' : ''}">
      <div class="laser-agenda-time">
        <strong>${formatClockDisplay(timeValue)}</strong>
        <span>${isHalf ? 'demi-heure' : 'départ'}</span>
      </div>
      ${sessionHtml}
      <div class="laser-agenda-capacity">
        <strong>${sessionPlayers}/${capacity}</strong>
        <span>${remaining} libre${remaining > 1 ? 's' : ''}</span>
      </div>
    </div>`;
  }

  const laserBlockBanner = renderLaserBlockBanner(state.currentDate);
  wrap.innerHTML = `
    ${pendingQueueHtml}
    ${laserBlockBanner}
    <div class="laser-agenda">
      <div class="laser-agenda-header">
        <div>Heure</div>
        <div>Session Laser Game</div>
        <div>Capacité</div>
      </div>
      <div class="laser-agenda-body">${rowsHtml}</div>
    </div>`;
  wrap.scrollTop = prevScrollTop;
  wrap.scrollLeft = prevScrollLeft;
  const nextAgenda = wrap.querySelector('.laser-agenda');
  if (nextAgenda) {
    nextAgenda.scrollTop = prevAgendaTop;
    nextAgenda.scrollLeft = prevAgendaLeft;
  }
  const nextQueue = wrap.querySelector('.laser-pass-queue');
  if (nextQueue) nextQueue.scrollTop = prevQueueTop;
}

// Maintenance datée : fenêtre [du, au], la piste reste réservable hors
// fenêtre et se libère automatiquement après (résolution par date côté
// serveur, y compris dans le chemin d'écriture des réservations).
async function toggleMaintDated(i, ev) {
  if (ev) ev.stopPropagation();
  const today = todayStr();
  const from = window.prompt(`Piste ${i} : début de maintenance (AAAA-MM-JJ, vide = dès maintenant) :`, today);
  if (from === null) return;
  const until = window.prompt(`Piste ${i} : fin de maintenance (AAAA-MM-JJ, vide = jusqu'à réactivation manuelle) :`, from || today);
  if (until === null) return;
  const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;
  if ((from && !DATE_RX.test(from)) || (until && !DATE_RX.test(until))) { toast('Format de date invalide (AAAA-MM-JJ).'); return; }
  if (from && until && until < from) { toast('La fin précède le début.'); return; }
  const note = window.prompt("Motif (optionnel, visible par l'équipe) :", '') || '';
  try {
    const payload = await apiRequest(API_ENDPOINTS.staffLanes, {
      method: 'PATCH',
      body: JSON.stringify({ lane: i, status: 'maintenance', maintenanceFrom: from || '', maintenanceUntil: until || '', note }),
    });
    const lane = payload.lane || {};
    state.laneMaintenance = state.laneMaintenance || {};
    state.laneMaintenance[i] = { from: lane.maintenanceFrom || '', until: lane.maintenanceUntil || '', note: lane.maintenanceNote || '' };
    const applies = (!lane.maintenanceFrom || today >= lane.maintenanceFrom) && (!lane.maintenanceUntil || today <= lane.maintenanceUntil);
    state.laneStatuses[i] = applies ? 'maintenance' : 'active';
    save();
    renderStaff();
    toast(`Piste ${i} : maintenance ${lane.maintenanceFrom || 'immédiate'} → ${lane.maintenanceUntil || 'sans fin'}${applies ? '' : ' (programmée)'}`);
  } catch (error) {
    toast(error.message || 'Impossible de programmer la maintenance.');
  }
}

async function toggleMaint(i, ev) {
  if (ev) ev.stopPropagation();
  const previousStatus = state.laneStatuses[i];
  const nextStatus = state.laneStatuses[i] === 'maintenance' ? 'active' : 'maintenance';
  state.laneStatuses[i] = nextStatus;
  save();
  renderPlanning();
  try {
    const payload = await apiRequest(API_ENDPOINTS.staffLanes, {
      method: 'PATCH',
      body: JSON.stringify({ lane: i, status: nextStatus })
    });
    const confirmedStatus = payload.lane?.status || nextStatus;
    const changedOnConfirm = state.laneStatuses[i] !== confirmedStatus;
    state.laneStatuses[i] = confirmedStatus;
    if (state.laneMaintenance) {
      if (confirmedStatus === 'maintenance') state.laneMaintenance[i] = { from: payload.lane?.maintenanceFrom || '', until: payload.lane?.maintenanceUntil || '', note: payload.lane?.maintenanceNote || '' };
      else delete state.laneMaintenance[i];
    }
    save();
    if (changedOnConfirm) renderPlanning();
    toast(`Piste ${i} ${state.laneStatuses[i] === 'maintenance' ? 'en maintenance' : 'active'}`);
  } catch (error) {
    state.laneStatuses[i] = previousStatus;
    save();
    renderPlanning();
    toast(error.message || 'Impossible de mettre la piste a jour.');
  }
}

// La puce « Avec note » n'apparaît que s'il y a des notes. Sans ce relâchement,
// un changement de date laisserait le filtre actif sur une puce disparue de
// l'écran : le planning et la liste sembleraient vides sans raison visible.
// Le verdict porte sur LA JOURNÉE ENTIÈRE, jamais sur la ressource affichée :
// bowling, laser et table sont peints dans le même tick, et un scope laser vide
// relâcherait le filtre que le staff vient de poser depuis la table bowling.
function releaseDeadNoteFilter() {
  if (state.staffStatusFilter === 'notes' && !todaysReservations().some(hasReservationNote)) {
    state.staffStatusFilter = 'all';
  }
}

function filterReservationsForStaff(reservations, filter) {
  if (filter === 'open') return reservations.filter(r => r.status !== 'paid');
  if (filter === 'notes') return reservations.filter(hasReservationNote);
  if (filter === 'all') return reservations;
  return reservations.filter(r => r.status === filter);
}

function getStaffStatusCounts(reservations) {
  const pending = reservations.filter(r => r.status === 'pending').length;
  const arrived = reservations.filter(r => r.status === 'arrived').length;
  const paid = reservations.filter(r => r.status === 'paid').length;
  return {
    all: reservations.length,
    open: pending + arrived,
    pending,
    arrived,
    paid,
    notes: reservations.filter(hasReservationNote).length
  };
}

function renderReservationRow(r) {
  const formule = r.formuleId ? FORMULES.find(x => x.id === r.formuleId) : null;
  const isFormule = !!formule;
  const view = getStaffResourceView();
  const isLaser = view === 'laser' || r.type === 'laser';
  const typeLabel = getReservationLabel(r);
  const resourceWindows = getStaffResourceWindows(r, view);
  const laserWindow = getLaserWindowsFromReservation(r)[0] || null;
  const bowlingWindows = getBowlingWindowsFromReservation(r);
  const bowlingLanes = [...new Set(bowlingWindows.flatMap(window => window.lanes || r.lanes || []))];
  const bowlingChipHtml = bowlingLanes.length ? bowlingLanes.map(l => `<span class="res-lane-chip">${l}</span>`).join('') : '';
  const laserChipHtml = getLaserWindowsFromReservation(r).map(window => `<span class="res-lane-chip laser">${formatClockDisplay(window.start)}-${formatClockDisplay(window.end)}</span>`).join('');
  const lanesHtml = view === 'all'
    ? `<div class="res-row-lanes">${bowlingChipHtml}${laserChipHtml || ''}${!bowlingChipHtml && !laserChipHtml ? `<span class="res-lanes-empty">${isOffPlanningReservation(r) ? 'Hors planning' : 'À placer'}</span>` : ''}</div>`
    : view === 'laser'
      ? `<div class="res-row-lanes"><span class="res-lane-chip laser">${laserWindow ? `${formatClockDisplay(laserWindow.start)}-${formatClockDisplay(laserWindow.end)}` : 'Laser'}</span></div>`
      : bowlingLanes.length
        ? `<div class="res-row-lanes">${bowlingChipHtml}</div>`
        : `<span class="res-lanes-empty">Hors piste</span>`;
  // La pastille d'état ne se dessine QUE si elle dit quelque chose que le
  // sélecteur juste à côté ne dit pas déjà. « Arrivé » suivi de trois boutons
  // dont « Arrivé » est actif, c'est la même information écrite deux fois à
  // 8px d'écart. Sur une réservation payée, elle porte le MONTANT : là, elle
  // apporte, et elle reste.
  const stateText = r.status === 'paid' ? `${r.price}€ payé` : '';
  const timeLabel = resourceWindows.length ? formatClockDisplay(resourceWindows[0].start) : r.startTime;
  const resourceDurationLabel = view === 'all'
    ? (isFormule ? 'Formule' : r.type === 'laser' ? (getLaserGameCountForReservation(r) > 1 ? `Laser x${getLaserGameCountForReservation(r)}` : 'Laser') : formatDurationLabel(r.duration))
    : view === 'laser'
    ? (getLaserGameCountForReservation(r) > 1 ? `Laser x${getLaserGameCountForReservation(r)}` : 'Laser')
    : formatDurationLabel(resourceWindows[0]?.duration || r.duration);

  // CE QUE LE CLIENT A RESERVE, ECRIT UNE SEULE FOIS.
  // Il l'etait TROIS fois par ligne : la pastille etoilee « FORMULE 1 » contre
  // le nom, puis « FORMULE 1 » en etiquette grise juste en dessous, puis
  // « Bowling 2h » alors que la duree est deja dans la colonne de gauche. Trois
  // ecritures d'un meme fait, sur trois lignes, en trois styles.
  const parties = getLaserGameCountForReservation(r);
  const offre = isFormule
    ? [formule.name, parties > 1 ? `Laser x${parties}` : ''].filter(Boolean).join(' · ')
    : typeLabel;

  return `<div class="res-row ${r.status} ${getReservationHighlightClasses(r)}" data-res-row-id="${r.id}" onclick="openPos(${r.id})">
    <div class="res-c-time">
      <strong>${timeLabel}</strong>
      <span class="${isSpecialBowlingDuration(getBowlingDurationForReservation(r)) ? 'is-special' : ''}">${resourceDurationLabel}</span>
    </div>
    <div class="res-c-client">
      <span class="res-row-name">${escapeHtml(r.name)}</span>
      <span class="res-c-pax">${r.pax} joueur${r.pax > 1 ? 's' : ''}</span>
    </div>
    <div class="res-c-what">
      <span class="res-offer ${isFormule ? 'is-formule' : isLaser ? 'is-laser' : ''}">${escapeHtml(offre)}</span>
      ${stateText ? `<span class="res-state-pill ${r.status}">${stateText}</span>` : ''}
      ${renderReservationTags(r, { contexteSeul: true })}
      ${renderReservationNoteLine(r)}
      ${renderStaffOpsMini(r)}
      ${renderGuestOpsMini(r)}
    </div>
    <div class="res-c-where">
      ${lanesHtml}
    </div>
    <div class="res-c-state" onclick="event.stopPropagation()">
      <div class="res-status-row compact">
        <button class="res-status-btn ${r.status === 'pending' ? 'active pending' : ''}" onclick="setReservationStatusDirect(${r.id}, 'pending', event)">Confirmé</button>
        <button class="res-status-btn ${r.status === 'arrived' ? 'active arrived' : ''}" onclick="setReservationStatusDirect(${r.id}, 'arrived', event)">Arrivé</button>
        <button class="res-status-btn ${r.status === 'paid' ? 'active paid' : ''}" onclick="setReservationStatusDirect(${r.id}, 'paid', event)">Payé</button>
      </div>
      <div class="res-row-tools">
        <button class="res-icon-btn" onclick="editRes(${r.id}, event)" title="Editer" aria-label="Editer ${escapeHtml(r.name)}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
        <button class="res-icon-btn warn" onclick="cancelRes(${r.id}, event)" title="Annuler" aria-label="Annuler ${escapeHtml(r.name)}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="8" y1="8" x2="16" y2="16"/></svg></button>
        <button class="res-icon-btn danger" onclick="deleteRes(${r.id}, event)" title="Supprimer" aria-label="Supprimer ${escapeHtml(r.name)}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
      </div>
    </div>
  </div>`;
}

function renderReservationSection(statusKey, title, subtitle, reservations) {
  const ordered = [...reservations].sort((a, b) => {
    if (statusKey === 'paid') return timeToNum(b.startTime) - timeToNum(a.startTime);
    return timeToNum(a.startTime) - timeToNum(b.startTime);
  });
  // UN EN-TETE DE COLONNES, UNE FOIS, AU LIEU D'UN LIBELLE PAR LIGNE.
  // Le mot « Pistes » etait ecrit sur CHAQUE ligne, au-dessus de ses numeros :
  // sept fois pour sept dossiers. Un libelle qui se repete a chaque ligne n'est
  // pas une colonne, c'est une fiche recopiee, et c'est ce qui donnait a la
  // liste son air de formulaire des annees 2000. Ecrit une fois en tete, il
  // devient une VRAIE colonne : l'oeil descend au lieu de relire.
  // Le sous-titre explicatif de chaque section a disparu. « Clients presents, a
  // suivre maintenant » sous « Sur place » explique un titre qui se comprend
  // seul : c'est du texte d'aide permanent, qui coute une ligne par section et
  // n'est lu qu'une fois dans une vie de logiciel. Il reste dans l'infobulle.
  return `<div class="res-section workflow ${statusKey}">
    <div class="res-section-head" title="${escapeHtml(subtitle)}">
      <span class="label">${title}</span>
      <span class="count">${ordered.length}</span>
    </div>
    ${ordered.length ? `<div class="res-dense-list" data-pl-stagger="resa.liste">${ordered.map(renderReservationRow).join('')}</div>` : `<div class="res-empty-inline">Aucune réservation dans cette zone.</div>`}
  </div>`;
}

function renderTable() {
  const view = getStaffResourceView();
  const res = scopedStaffReservations(view);
  releaseDeadNoteFilter();
  const counts = getStaffStatusCounts(res);
  let filtered = res;
  if (state.searchTerm) {
    const q = state.searchTerm.toLowerCase();
    filtered = res.filter(r => r.name.toLowerCase().includes(q) || (r.phone || '').includes(q) || getReservationLabel(r).toLowerCase().includes(q));
  }
  filtered = filterReservationsForStaff(filtered, state.staffStatusFilter);
  const tableTitle = document.getElementById('tableTitleText');
  if (tableTitle) tableTitle.textContent = view === 'all' ? 'Toutes les réservations' : view === 'laser' ? 'Réservations Laser Game' : 'Réservations Bowling';
  document.getElementById('tableCount').textContent = res.length;
  const list = document.getElementById('resList');
  // Hors planning : calculé sur le JOUR (pas sur `filtered`) pour que le résumé
  // annonce le même nombre que l'onglet, quel que soit le filtre de statut actif.
  const offPlanningDay = view === 'all' ? res.filter(isOffPlanningReservation).length : 0;
  const resourceSummary = view === 'all'
    ? `Toutes activités${offPlanningDay ? ` • ${offPlanningDay} hors planning` : ''}`
    : view === 'laser'
      ? 'Laser Game uniquement'
      : 'Bowling uniquement';
  const resourceName = view === 'all' ? 'pour ce jour' : view === 'laser' ? 'Laser Game pour ce jour' : 'Bowling pour ce jour';
  const planningName = view === 'all' ? 'sur un planning' : view === 'laser' ? 'Laser Game' : 'Bowling';
  // LES ONGLETS NE DISAIENT PAS TOUS LA MÊME CHOSE, ET RIEN NE LE DISAIT.
  // Movsar, 2026-08-14 : « ça apparaît dans toutes les catégories, ça va pas du
  // tout ». Sa capture : Tout 9 · À gérer 6 · Sur place 0 · À venir 6 ·
  // Terminées 3. Rien n'était cassé dans le filtrage : les six puces étaient
  // peintes à l'identique alors qu'elles répondent à TROIS questions
  // différentes.
  //   - « Tout » = absence de filtre ;
  //   - « Sur place / À venir / Terminées » = l'ÉTAT, trois valeurs exclusives
  //     qui se totalisent (8 + 8 + 8 = 24) ;
  //   - « À gérer » = l'UNION de deux états (tout sauf terminé), donc chaque
  //     réservation non terminée y apparaît EN PLUS de son état ;
  //   - « Avec note » = un ATTRIBUT, vrai dans n'importe quel état.
  // Alignées sur une seule rangée, elles se lisent comme cinq cases d'un même
  // classement, et un gérant qui additionne tombe sur 40 pour 24 dossiers.
  // Le recoupement reste : « tout ce qui n'est pas fini », c'est la liste de
  // travail d'un comptoir. Mais il est désormais VISIBLE et NOMMÉ : deux
  // groupes séparés par un filet, les recoupements marqués d'un repère, et la
  // ligne de résumé qui recompose les comptes au lieu d'en citer deux au hasard.
  const crossHint = (label, text) => ` title="${escapeHtml(text)}" aria-label="${escapeHtml(`${label} : ${text}`)}"`;
  const crossMark = `<svg class="chip-cross-mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/></svg>`;
  const openHint = 'recoupe les états ci-dessus : les réservations Sur place et À venir réunies';
  const notesHint = 'recoupe les états ci-dessus : les réservations qui portent une note, quel que soit leur état';
  const toolbar = `<div class="table-toolbar">
    <div class="status-filters">
      <div class="status-group" role="group" aria-label="Filtrer par état. Les trois états ne se recoupent pas et se totalisent.">
        <button class="status-chip ${state.staffStatusFilter === 'all' ? 'active' : ''}" onclick="setStaffStatusFilter('all')">Tout <span>${counts.all}</span></button>
        <button class="status-chip ${state.staffStatusFilter === 'arrived' ? 'active arrived' : ''}" onclick="setStaffStatusFilter('arrived')">Sur place <span>${counts.arrived}</span></button>
        <button class="status-chip ${state.staffStatusFilter === 'pending' ? 'active pending' : ''}" onclick="setStaffStatusFilter('pending')">À venir <span>${counts.pending}</span></button>
        <button class="status-chip ${state.staffStatusFilter === 'paid' ? 'active paid' : ''}" onclick="setStaffStatusFilter('paid')">Terminées <span>${counts.paid}</span></button>
      </div>
      <div class="status-group status-group-cross" role="group" aria-label="Vues qui recoupent les états ci-dessus">
        <button class="status-chip is-cross ${state.staffStatusFilter === 'open' ? 'active open' : ''}" onclick="setStaffStatusFilter('open')"${crossHint('À gérer', openHint)}>${crossMark}À gérer <span>${counts.open}</span></button>
        ${(counts.notes || state.staffStatusFilter === 'notes') ? `<button class="status-chip is-cross ${state.staffStatusFilter === 'notes' ? 'active notes' : ''}" onclick="setStaffStatusFilter('notes')"${crossHint('Avec note', notesHint)}>${crossMark}Avec note <span>${counts.notes}</span></button>` : ''}
      </div>
    </div>
    <div class="table-summary">${resourceSummary} • ${counts.all} réservation${counts.all > 1 ? 's' : ''} = ${counts.arrived} sur place + ${counts.pending} à venir + ${counts.paid} terminée${counts.paid > 1 ? 's' : ''} • « À gérer » réunit les ${counts.open} non terminée${counts.open > 1 ? 's' : ''}</div>
  </div>`;
  if (!filtered.length) {
    list.innerHTML = `${toolbar}<div class="empty-state">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      <div class="e-title">${state.searchTerm ? 'Aucun résultat' : `Aucune réservation ${resourceName}`}</div>
      <div class="e-sub">${state.searchTerm ? 'Essayez un autre mot-clé' : `Cliquez sur "Réservation rapide" ou ${planningName} pour en créer une`}</div>
    </div>`;
    return;
  }
  // Les réservations hors planning sortent des sections de statut et remontent en
  // tête : elles n'apparaissent sur aucune grille, donc c'est ICI ou nulle part.
  const offPlanningRows = view === 'all' ? filtered.filter(isOffPlanningReservation) : [];
  const offPlanningIds = new Set(offPlanningRows.map(r => r.id));
  const inStatus = status => filtered.filter(r => r.status === status && !offPlanningIds.has(r.id));
  const sections = [
    { key: 'offplanning', title: 'Hors planning', subtitle: "Ni piste bowling ni zone laser : visibles nulle part ailleurs", rows: offPlanningRows },
    { key: 'arrived', title: 'Sur place', subtitle: 'Clients présents, à suivre maintenant', rows: inStatus('arrived') },
    { key: 'pending', title: 'À venir', subtitle: 'Réservations confirmées, triées par horaire', rows: inStatus('pending') },
    { key: 'paid', title: 'Terminées', subtitle: 'Clôturées et descendues en bas de liste', rows: inStatus('paid') }
  ].filter(section => {
    if (section.key === 'offplanning') return true;
    if (state.staffStatusFilter === 'arrived') return section.key === 'arrived';
    if (state.staffStatusFilter === 'pending') return section.key === 'pending';
    if (state.staffStatusFilter === 'paid') return section.key === 'paid';
    if (state.staffStatusFilter === 'open') return section.key !== 'paid';
    return true;
  }).filter(section => section.rows.length > 0);

  // L'EN-TETE DE COLONNES EST ECRIT UNE SEULE FOIS, POUR TOUTE LA LISTE.
  // Premiere tentative : un en-tete par section. C'etait reproduire exactement
  // le defaut qu'on corrigeait, le mot « Pistes » repete a chaque ligne devenant
  // « HEURE CLIENT RESERVATION PISTES ETAT » repete a chaque section. Les
  // colonnes sont les MEMES partout puisque la grille est declaree une fois :
  // l'en-tete l'est aussi, et il reste colle en haut au defilement.
  const colOu = view === 'all' ? 'Ressources' : view === 'laser' ? 'Laser' : 'Pistes';
  list.innerHTML = `${toolbar}
  <div class="res-col-head" aria-hidden="true">
    <span>Heure</span><span>Client</span><span>Réservation</span><span>${colOu}</span><span>État</span>
  </div>
  <div class="res-sections">
    ${sections.map(section => renderReservationSection(section.key, section.title, section.subtitle, section.rows)).join('')}
  </div>`;
}

function quickAction(id, status) {
  setReservationStatusDirect(id, status);
}

function setReservationStatusDirect(id, status, ev) {
  if (ev) ev.stopPropagation();
  const key = String(id);
  let current = state.reservations.find(r => String(r.id) === key);
  if (!current) {
    // Depuis Terrain/Groupes la résa peut ne pas être dans state.reservations
    // (autre date/source). On la récupère et on l'injecte pour que la mise à
    // jour optimiste et le re-render fonctionnent.
    const external = findStaffReservationById(id);
    if (external) {
      upsertReservationInState(external);
      current = state.reservations.find(r => String(r.id) === key) || external;
    }
  }
  if (!current) {
    toast('Réservation introuvable.');
    return;
  }
  // Anti double-envoi : même statut déjà en vol → on ignore. La résa affiche
  // déjà la valeur voulue (optimiste), inutile de re-PATCH.
  if (isReservationMutationInFlight(id, 'status', status)) return;
  const nextReservation = {
    ...current,
    status,
    paymentMethod: status === 'paid' ? (current.paymentMethod || 'Comptoir') : current.paymentMethod
  };
  const requestKey = Number(id);
  const requestSeq = ++statusSaveSeq;
  statusSaveLatestSeqByReservation[requestKey] = requestSeq;
  const isLatestRequest = () => statusSaveLatestSeqByReservation[requestKey] === requestSeq;
  // Protège le statut optimiste contre l'écrasement par un poll serveur en retard.
  markReservationMutation(id, nextReservation, ['status', 'paymentMethod']);
  setReservationMutationInFlight(id, 'status', status);
  applyOptimisticReservation(nextReservation, { preserveEditState: true });
  apiRequest(API_ENDPOINTS.staffReservations, {
    method: 'PATCH',
    body: JSON.stringify(buildReservationApiPayload(nextReservation))
  }).then(payload => {
    if (!isLatestRequest()) return;
    applyOptimisticReservation(payload.reservation, { preserveEditState: true });
    // Ré-ancre la protection sur la valeur confirmée par le serveur et repousse
    // le délai de grâce : les lectures (staff-state) peuvent encore être en
    // retard sur l'écriture qui vient d'être committée.
    markReservationMutation(id, payload.reservation, ['status', 'paymentMethod']);
    // UN SEUL RETOUR POUR UNE SEULE ACTION. La pastille qui bascule EST le
    // retour : le bouton passe en `active`, la ligne change de section. Un
    // message qui arrive 300 ms plus tard raconte une DEUXIEME fois ce que
    // l'ecran a deja dit, et c'est ce troisieme signal (rendu optimiste, puis
    // re-rendu a l'echo, puis message) qui donnait l'impression d'un double
    // clic. L'echec, lui, garde son message : il dit quelque chose de neuf.
  }).catch(error => {
    if (!isLatestRequest()) return;
    applyOptimisticReservation(current, { preserveEditState: true });
    clearReservationMutation(id);
    toast(error.message || 'Impossible de mettre à jour le statut.');
  }).finally(() => {
    clearReservationMutationInFlight(id, 'status');
    if (isLatestRequest()) delete statusSaveLatestSeqByReservation[requestKey];
  });
}

function quickPay(id) {
  setReservationStatusDirect(id, 'paid');
}

// Coche/décoche une activité de formule comme « faite ». PATCH MINIMAL
// { id, centerId, activityProgress } → chemin permission-light (reservations.status,
// staff comptoir/terrain OK) + AUCUN replan (activityProgress hors REPLAN_FIELDS) →
// l'opsPlan reste intact, seule la colonne activity_progress change. Optimiste +
// rollback + protection anti-poll (markReservationMutation) comme le statut.
function toggleFormulaActivity(reservationId, key, ev) {
  if (ev) ev.stopPropagation();
  const idKey = String(reservationId);
  let current = state.reservations.find(r => String(r.id) === idKey);
  if (!current) {
    const external = findStaffReservationById(reservationId);
    if (external) {
      upsertReservationInState(external);
      current = state.reservations.find(r => String(r.id) === idKey) || external;
    }
  }
  if (!current) { toast('Réservation introuvable.'); return; }
  const progress = current.activityProgress && typeof current.activityProgress === 'object'
    ? { ...current.activityProgress }
    : {};
  const wasDone = !!(progress[key] && progress[key].done);
  if (wasDone) {
    delete progress[key];
  } else {
    progress[key] = { done: true, doneAt: new Date().toISOString(), by: state.staffAuthSession?.member?.name || 'Staff' };
  }
  const nextReservation = { ...current, activityProgress: progress };
  const requestKey = Number(reservationId);
  const requestSeq = ++activitySaveSeq;
  activitySaveLatestSeqByReservation[requestKey] = requestSeq;
  const isLatestRequest = () => activitySaveLatestSeqByReservation[requestKey] === requestSeq;
  // Les signatures de re-render (getStaffDataSignature / getSelectedReservationSignature)
  // n'incluent pas activityProgress → applyOptimisticReservation zapperait le re-render.
  // On rafraîchit donc explicitement la surface courante + l'overlay détail s'il est ouvert.
  const refreshSurfaces = () => {
    if (state.view === 'staff') { try { renderStaffData(); } catch (e) { /* page peut ne plus être montée */ } }
    if (state.selectedRes && Number(state.selectedRes.id) === Number(reservationId)) { try { renderPos(); } catch (e) { /* overlay fermé */ } }
  };
  markReservationMutation(reservationId, nextReservation, ['activityProgress']);
  applyOptimisticReservation(nextReservation, { preserveEditState: true });
  refreshSurfaces();
  apiRequest(API_ENDPOINTS.staffReservations, {
    method: 'PATCH',
    body: JSON.stringify({
      id: Number(reservationId),
      centerId: current.centerId || (typeof getCurrentStaffCenterId === 'function' ? getCurrentStaffCenterId() : 'libramont'),
      activityProgress: progress,
    })
  }).then(payload => {
    if (!isLatestRequest()) return;
    if (payload?.reservation) {
      applyOptimisticReservation(payload.reservation, { preserveEditState: true });
      markReservationMutation(reservationId, payload.reservation, ['activityProgress']);
      refreshSurfaces();
    }
  }).catch(error => {
    if (!isLatestRequest()) return;
    applyOptimisticReservation(current, { preserveEditState: true });
    clearReservationMutation(reservationId);
    refreshSurfaces();
    toast(error.message || "Impossible d'enregistrer l'activité.");
  }).finally(() => {
    if (isLatestRequest()) delete activitySaveLatestSeqByReservation[requestKey];
  });
}

async function cancelRes(id, ev) {
  if (ev) ev.stopPropagation();
  if (!confirm('Annuler cette réservation ?')) return;
  const current = state.reservations.find(r => String(r.id) === String(id)) || findStaffReservationById(id);
  if (!current) {
    toast('Réservation introuvable.');
    return;
  }
  applyOptimisticReservation({ ...current, status: 'cancelled' }, { preserveEditState: true });
  try {
    const payload = await apiRequest(API_ENDPOINTS.staffReservations, {
      method: 'PATCH',
      body: JSON.stringify(buildReservationApiPayload({ ...current, status: 'cancelled' }))
    });
    applyOptimisticReservation(payload.reservation, { preserveEditState: true });
    if (state.selectedRes && state.selectedRes.id === id) closePos();
    toast('Reservation annulee');
  } catch (error) {
    applyOptimisticReservation(current, { preserveEditState: true });
    toast(error.message || 'Impossible d annuler la reservation.');
  }
}

async function deleteRes(id, ev) {
  if (ev) ev.stopPropagation();
  const current = state.reservations.find(r => r.id === id);
  if (!current) return;
  // La confirmation NOMME ce qu'elle détruit. « Supprimer cette réservation ? »
  // ne dit pas laquelle : on clique dessus en pensant à une autre. Elle dit
  // aussi que c'est définitif, parce que ça l'est : il n'y a pas d'annulation.
  const quoi = `${current.name || 'Client'} · ${current.startTime || ''} · ${current.pax || 0} joueur${(current.pax || 0) > 1 ? 's' : ''}`;
  if (!confirm(`Supprimer definitivement la reservation #${id} ?\n\n${quoi}\n\nCette action est irreversible. Pour garder la trace du dossier, utilisez plutot « Annuler reservation ».`)) return;
  removeOptimisticReservation(id);
  // La fiche se ferme : elle décrivait un dossier qui n'existe plus. Elle
  // restait ouverte, avec ses boutons « Enregistrer » et « Arrivé » actifs sur
  // une réservation supprimée.
  if (state.selectedRes && state.selectedRes.id === id) closePos();
  try {
    await apiRequest(API_ENDPOINTS.staffReservations, {
      method: 'DELETE',
      body: JSON.stringify({ id })
    });
    toast('Reservation supprimee');
  } catch (error) {
    applyOptimisticReservation(current, { preserveEditState: true });
    toast(error.message || 'Impossible de supprimer la reservation.');
  }
}

function editRes(id, ev) {
  if (ev) ev.stopPropagation();
  state.selectedRes = state.reservations.find(r => r.id === id);
  if (!state.selectedRes) return;
  state.activeTab = 'modifier';
  state.editState = { ...state.selectedRes, lanesStr: (state.selectedRes.lanes || []).join(', ') };
  syncEditLaneAssignment();
  renderPos();
}

function openPos(id) {
  const reservation = findStaffReservationById(id);
  if (!reservation) {
    toast('Réservation introuvable ou non chargée.');
    return;
  }
  upsertReservationInState(reservation);
  state.selectedRes = reservation;
  state.activeTab = 'details';
  state.editState = { ...reservation, lanesStr: (reservation.lanes || []).join(', ') };
  renderPos();
}

function closePos() {
  state.selectedRes = null;
  const overlay = document.getElementById('posOverlay');
  overlay.classList.add('hidden');
  overlay.classList.remove('centered');
  overlay.innerHTML = '';
  // Le focus revient d'où il venait : la ligne ou la carte qu'on avait ouverte.
  if (posReturnFocus && document.contains(posReturnFocus)) {
    try { posReturnFocus.focus({ preventScroll: true }); } catch (e) { /* élément disparu entre-temps */ }
  }
  posReturnFocus = null;
}

function setTab(t) {
  state.activeTab = t === 'caisse' ? 'details' : t;
  if (state.activeTab === 'modifier') {
    state.editState = { ...state.selectedRes, lanesStr: (state.selectedRes.lanes || []).join(', ') };
    syncEditLaneAssignment();
  }
  renderPos();
}

// Classe « toutes les activités faites » pour styliser (griser) une carte planning.
function activitiesCompleteClass(r) {
  if (typeof reservationHasFormulaActivities !== 'function' || !reservationHasFormulaActivities(r)) return '';
  return getFormulaActivityProgressSummary(r).allDone ? ' activities-complete' : '';
}

// Pill compacte « faites/total » pour les cartes planning (formules uniquement).
function renderActivityProgressPill(r) {
  if (typeof reservationHasFormulaActivities === 'function' && !reservationHasFormulaActivities(r)) return '';
  const summary = getFormulaActivityProgressSummary(r);
  if (!summary.total) return '';
  // UNE PROGRESSION SE VOIT, ELLE NE SE LIT PAS.
  // Movsar, 2026-08-14 : « le 0/4, le design je le trouve pas fou ». Deux
  // chiffres separes d'une barre oblique demandent une LECTURE pour dire une
  // chose qu'une jauge dit d'un coup d'oeil, et ils prenaient la place d'une
  // donnee sur une carte qui en manque. Le compte exact reste dans l'infobulle
  // et dans le texte lu par la synthese vocale : rien n'est perdu, seule la
  // forme change.
  const part = Math.max(0, Math.min(1, summary.total ? summary.done / summary.total : 0));
  return `<span class="activity-pill${summary.allDone ? ' done' : ''}" role="img"`
    + ` title="Activités faites : ${summary.done}/${summary.total}"`
    + ` aria-label="${summary.done} activité${summary.done > 1 ? 's' : ''} faite${summary.done > 1 ? 's' : ''} sur ${summary.total}">`
    + `<span class="activity-bar"><span class="activity-bar-fill" style="width:${Math.round(part * 100)}%"></span></span>`
    + `<span class="visually-hidden">${summary.done}/${summary.total}</span>`
    + `</span>`;
}

function formatActivityDoneTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
}

const ACTIVITY_CHECK_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

// Icône par type d'activité (ligne d'icônes fines, cohérent avec le design system).
const ACTIVITY_ICON_PATHS = {
  bowling: '<circle cx="12" cy="12" r="9"/><circle cx="9.4" cy="9" r=".55" fill="currentColor" stroke="none"/><circle cx="12.6" cy="8.2" r=".55" fill="currentColor" stroke="none"/><circle cx="9.9" cy="12" r=".55" fill="currentColor" stroke="none"/>',
  laser_game: '<circle cx="12" cy="12" r="6.4"/><path d="M12 2.2v3M12 18.8v3M2.2 12h3M18.8 12h3"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
  minigolf_blacklight: '<path d="M7 21V4l9.2 2.6L7 9.2"/>',
  golf_oclock: '<path d="M7 21V4l9.2 2.6L7 9.2"/>',
  arcade_time: '<rect x="2.5" y="8" width="19" height="10" rx="3.6"/><path d="M7.4 12v3M5.9 13.5h3"/><circle cx="16" cy="12.6" r=".7" fill="currentColor" stroke="none"/><circle cx="18" cy="14.8" r=".7" fill="currentColor" stroke="none"/>',
  arcade_credit: '<rect x="2.5" y="8" width="19" height="10" rx="3.6"/><path d="M7.4 12v3M5.9 13.5h3"/><circle cx="16" cy="12.6" r=".7" fill="currentColor" stroke="none"/><circle cx="18" cy="14.8" r=".7" fill="currentColor" stroke="none"/>',
  playground: '<circle cx="12" cy="12" r="9"/><path d="M8.4 14.8a4.2 4.2 0 0 0 7.2 0"/><path d="M9 9.8h.01M15 9.8h.01"/>',
  party_table: '<path d="M5 21h14M7 21v-6a5 5 0 0 1 10 0v6M12 6.2V3.6"/><path d="M10.6 3.6h2.8"/>',
  service_drinks: '<path d="M7 8h10l-1 11.2a2 2 0 0 1-2 1.8H10a2 2 0 0 1-2-1.8L7 8z"/><path d="M9 8V6.6a3 3 0 0 1 6 0V8"/>',
};
function renderActivityIcon(activityId) {
  const paths = ACTIVITY_ICON_PATHS[activityId] || '<circle cx="12" cy="12" r="8"/>';
  return `<svg class="activity-check-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

// Bloc de suivi des activités d'une formule : une case cochable par activité incluse
// (bowling, laser ×N, minigolf, arcades, boissons…), grisée + horodatée quand faite.
// Réutilisé dans le détail réservation, la page Formules et le board Terrain.
function renderFormulaActivityChecklist(r, opts = {}) {
  if (typeof reservationHasFormulaActivities === 'function' && !reservationHasFormulaActivities(r)) return '';
  const summary = getFormulaActivityProgressSummary(r);
  if (!summary.total) return '';
  const pct = Math.round((summary.done / summary.total) * 100);
  const rows = summary.items.map(item => {
    const time = item.startTime ? `${escapeHtml(item.startTime)}${item.endTime ? ' : ' + escapeHtml(item.endTime) : ''}` : '';
    const meta = item.done
      ? [item.by ? `par ${escapeHtml(item.by)}` : '', formatActivityDoneTime(item.doneAt)].filter(Boolean).join(' · ')
      : '';
    return `<button type="button" class="activity-check-row${item.done ? ' is-done' : ''}" onclick="toggleFormulaActivity(${Number(r.id)}, '${escapeHtml(item.key)}', event)" aria-pressed="${item.done}" title="${item.done ? 'Annuler : marquer à faire' : 'Marquer comme fait'}">
      <span class="activity-check-box" aria-hidden="true">${item.done ? ACTIVITY_CHECK_SVG : ''}</span>
      <span class="activity-check-icon-wrap" aria-hidden="true">${renderActivityIcon(item.activityId)}</span>
      <span class="activity-check-main">
        <span class="activity-check-label">${escapeHtml(item.label)}</span>
        ${time ? `<span class="activity-check-time">${time}</span>` : ''}
      </span>
      <span class="activity-check-state">${item.done ? (meta || 'Fait') : 'À faire'}</span>
    </button>`;
  }).join('');
  // opts.bare : sans en-tête (utilisé dans la carte Formules qui porte déjà nom + count).
  const head = opts.bare ? '' : `<div class="activity-check-head">
      <div class="info-label">Suivi des activités${opts.titleSuffix ? ` ${escapeHtml(opts.titleSuffix)}` : ''}</div>
      <span class="activity-check-count${summary.allDone ? ' done' : ''}">${summary.done}/${summary.total}${summary.allDone ? ' ✓' : ''}</span>
    </div>`;
  return `<div class="info-block activity-check-block${summary.allDone ? ' all-done' : ''}${opts.bare ? ' is-bare' : ''}">
    ${head}
    <div class="activity-check-bar" aria-hidden="true"><span style="width:${pct}%"></span></div>
    <div class="activity-check-list">${rows}</div>
  </div>`;
}

// LE PROGRAMME d'une visite, sur la fiche staff. Deux colonnes de sens :
// ce qui est PLACE au planning (piste, arene) et ce qui se fait SUR PLACE. Le
// comptoir doit savoir que le groupe de 15h vient aussi pour le minigolf et
// deux billards : c'est exactement l'information qu'il decouvrait a l'arrivee.
// Absent des reservations mono-activite (program null) : rien ne change pour
// elles, la fiche reste celle d'avant.
function renderReservationProgram(reservation) {
  const items = reservation && reservation.program && Array.isArray(reservation.program.items)
    ? reservation.program.items
    : [];
  if (items.length < 2) return '';
  const line = (item) => {
    const detail = item.activityId === 'bowling'
      ? `${item.duration}h`
      : item.games
        ? `${item.games} partie${item.games > 1 ? 's' : ''}`
        : item.units
          ? `${item.units} x ${item.hours}h`
          : '';
    const price = item.priceKnown ? `${Math.round(Number(item.price))}€` : 'sur place';
    return `<div style="display:flex;justify-content:space-between;gap:12px;font-size:13px;padding:8px 0;border-bottom:1px solid var(--border);">
      <span style="font-weight:700;color:var(--text);">${escapeHtml(item.name || item.activityId)}${detail ? ` <small style="font-weight:400;color:var(--text-3);">${escapeHtml(detail)}</small>` : ''}</span>
      <span style="color:var(--text-2);font-weight:700;">${item.planned ? 'planifié' : price}</span>
    </div>`;
  };
  const planned = items.filter((item) => item.planned);
  const free = items.filter((item) => !item.planned);
  return `<div class="info-block">
    <div class="info-label">Programme du groupe</div>
    ${planned.map(line).join('')}
    ${free.length ? `<div style="margin-top:10px;color:var(--text-3);font-size:12px;">Sans réservation de ressource, à prévoir au comptoir :</div>${free.map(line).join('')}` : ''}
    ${reservation.program.priceComplete === false ? '<div style="margin-top:10px;color:var(--text-3);font-size:12px;line-height:1.45;">Une partie du programme n\'a pas de tarif enregistré : elle se règle au comptoir.</div>' : ''}
  </div>`;
}

// LA FICHE « INFOS » : L'EN-TETE DIT QUI EST LA, LE CORPS DIT QUOI FAIRE.
//
// Etat mesure avant refonte (2026-08-14) : 868 px, 11 boutons, CINQ blocs au
// meme poids typographique, et le premier - le plus visible - recopiait MOT
// POUR MOT le sous-titre de l'en-tete (activite, horaire, effectif, piste).
// « Suivi rapide » affichait le statut DEUX FOIS cote a cote (une pastille et,
// a 8 px de la, le meme mot en bouton actif) : exactement le defaut deja
// corrige dans la liste du jour le 2026-08-13, laisse vivre a cote parce que
// le retrait avait ete scope a un seul ecran. Et « Resume » remontait le
// montant, deja present dans l'en-tete, tout en bas de l'ecran.
//
// L'ORDRE DE LECTURE D'UN COMPTOIR est : qui, quand, ou, combien, et QUELLE
// ACTION FAIRE. L'en-tete porte deja les quatre premiers (nom en titre, puis
// reference, activite, horaire, lieu, effectif, montant en ligne de donnee) :
// le corps n'a donc qu'une seule chose a dire en premier, l'action.
//
// DEUX POIDS, PAS CINQ. Le bloc d'action est la seule surface qui se souleve
// (fond, bordure, ombre courte) ; tout le reste est plat et se separe par un
// filet, ce qui le range visuellement SOUS l'action sans ajouter une couleur.
// Le retard est une action occasionnelle qui ouvre sa propre fenetre : il se
// range derriere un depliant natif au lieu d'occuper six controles en
// permanence. Aucune fonctionnalite retiree ; l'encaissement, seule donnee du
// bloc « Resume » absente de l'en-tete, remonte dans le bloc d'action, la ou
// on s'en sert.
function renderPosDetails(r) {
  // Pour une formule : checklist cochable des activités (suivi « fait / à faire »).
  // Sinon : plan automatique en lecture seule.
  const activityChecklistHtml = renderFormulaActivityChecklist(r);
  const opsPlanHtml = (r.opsPlan?.timeline?.length && !activityChecklistHtml) ? `
    <div class="info-block">
      <div class="info-label">Plan automatique</div>
      <div class="pos-plan-list">
        ${r.opsPlan.timeline.filter(step => step.type === 'activity').map(step => `
          <div class="pos-plan-row">
            <span class="pos-plan-label">${step.label}</span>
            <span class="pos-plan-time">${step.startTime} - ${step.endTime}</span>
          </div>
        `).join('')}
      </div>
      ${r.opsPlan.staffSummary ? `<p class="pos-note">${r.opsPlan.staffSummary}</p>` : ''}
    </div>
  ` : '';
  const paid = r.status === 'paid';
  const method = r.paymentMethod || (paid ? 'Comptoir' : 'Sur place');
  const lateMinutes = getLateArrivalMinutes(r);
  return `<div class="pos-sheet fade-in">
    <section class="pos-act">
      <div class="pos-act-head">
        <span class="pos-eyebrow">État du dossier</span>
        <!-- Le MONTANT est dans la ligne d'identité, deux lignes plus haut :
             le réécrire ici en ferait la seule chose dite deux fois de toute
             la fiche. Ce qui manque à l'en-tête, et qui se décide ici, c'est
             l'état de l'encaissement et par quel moyen. -->
        <span class="pos-act-money ${paid ? 'is-paid' : ''}">${paid
          ? `Encaissé · ${escapeHtml(method)}`
          : `À encaisser · ${escapeHtml(method)}`}</span>
      </div>
      <div class="res-status-row pos-act-row">
        <button type="button" class="res-status-btn pending ${r.status === 'pending' ? 'active pending' : ''}" aria-pressed="${r.status === 'pending'}" onclick="setReservationStatusDirect(${r.id}, 'pending')">Confirmé</button>
        <button type="button" class="res-status-btn arrived ${r.status === 'arrived' ? 'active arrived' : ''}" aria-pressed="${r.status === 'arrived'}" onclick="setReservationStatusDirect(${r.id}, 'arrived')">Arrivé</button>
        <button type="button" class="res-status-btn paid ${r.status === 'paid' ? 'active paid' : ''}" aria-pressed="${r.status === 'paid'}" onclick="setReservationStatusDirect(${r.id}, 'paid')">Payé</button>
      </div>
    </section>
    ${renderPosNoteBlock(r)}
    ${renderReservationProgram(r)}
    ${activityChecklistHtml}
    ${opsPlanHtml}
    <section class="info-block">
      <div class="pos-group-head">
        <span class="info-label">Contact</span>
        <button type="button" class="comm-open-btn" onclick="openCommCenter(${r.id}, event)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          Envoyer un message
        </button>
      </div>
      <div class="pos-contact">
        <span class="pos-contact-item"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>${escapeHtml(r.phone || 'Non renseigné')}</span>
        <span class="pos-contact-item"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>${escapeHtml(r.email || 'Non renseigné')}</span>
      </div>
    </section>
    <details class="info-block pos-fold delay-control-block"${lateMinutes > 0 ? ' open' : ''}>
      <summary class="pos-group-head">
        <span class="info-label">Client en retard</span>
        <svg class="pos-fold-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
      </summary>
      <p class="pos-note">Choisissez le retard : le meilleur plan s'affiche avant validation.</p>
      <div class="delay-control-actions">
        ${lateMinutes > 0 ? `<button type="button" class="delay-chip delay-chip-now" onclick="openDelayImpact(${r.id}, ${lateMinutes}, event)">Arrivé maintenant (+${lateMinutes} min)</button>` : ''}
        <button type="button" class="delay-chip" onclick="openDelayImpact(${r.id}, 5, event)">+5 min</button>
        <button type="button" class="delay-chip" onclick="openDelayImpact(${r.id}, 10, event)">+10 min</button>
        <button type="button" class="delay-chip" onclick="openDelayImpact(${r.id}, 15, event)">+15 min</button>
      </div>
      <div class="delay-custom-row">
        <label class="visually-hidden" for="delayCustomMinutes">Retard en minutes</label>
        <input type="number" id="delayCustomMinutes" min="1" max="240" placeholder="Minutes" inputmode="numeric" onclick="event.stopPropagation()">
        <button type="button" class="delay-chip delay-chip-run" onclick="openDelayImpactCustom(${r.id}, event)">Analyser ce retard</button>
      </div>
    </details>
  </div>`;
}

// === Gestion des retards (staff) ============================================
// Flux en 3 temps, jamais automatique :
// 1. openDelayImpact → le serveur calcule le plan d'impact (preview) ;
// 2. applyDelayPlan → le staff valide UNE stratégie, application atomique ;
// 3. étape « Prévenir les clients ? » → emails uniquement pour les clients
//    cochés, sur clic explicite. « Ne pas prévenir » est toujours possible.
let delayFlowState = null;

function getLateArrivalMinutes(r) {
  if (!r || r.date !== todayStr()) return 0;
  const late = Math.round(currentTimeDecimal() * 60) - Math.round(timeToNum(r.startTime) * 60);
  return late >= 1 && late <= 240 ? late : 0;
}

function openDelayImpactCustom(id, ev) {
  const input = document.getElementById('delayCustomMinutes');
  const minutes = input ? Number(input.value) : 0;
  if (!minutes || minutes < 1) {
    toast('Indiquez le retard en minutes avant d\'analyser.');
    if (ev) ev.stopPropagation();
    return;
  }
  openDelayImpact(id, minutes, ev);
}

async function openDelayImpact(id, delayMinutes, ev) {
  if (ev) ev.stopPropagation();
  const reservation = state.reservations.find(item => Number(item.id) === Number(id));
  if (!reservation) return;
  const minutes = Math.max(1, Math.min(240, Math.round(Number(delayMinutes) || 0)));
  delayFlowState = {
    step: 'loading',
    reservationId: Number(id),
    reservationName: reservation.name || '',
    centerId: reservation.centerId || state.adminCenterId || 'libramont',
    delayMinutes: minutes,
    impact: null,
    selectedStrategyId: '',
    notifyChecked: {},
    notifyMessages: {},
    applyResult: null,
    busy: false
  };
  renderDelayModal();
  try {
    const payload = await apiRequest(API_ENDPOINTS.ops, {
      method: 'POST',
      body: JSON.stringify({
        action: 'delayImpact',
        centerId: delayFlowState.centerId,
        reservationId: Number(id),
        delayMinutes: minutes,
        reasonId: 'late_customer'
      })
    });
    if (!delayFlowState || delayFlowState.reservationId !== Number(id)) return;
    delayFlowState.step = 'preview';
    delayFlowState.impact = payload.impact || null;
    delayFlowState.selectedStrategyId = payload.impact?.recommendedStrategyId || '';
    renderDelayModal();
  } catch (error) {
    closeDelayModal();
    toast(error.message || 'Analyse du retard impossible pour le moment.');
  }
}

function selectDelayStrategy(strategyId) {
  if (!delayFlowState || delayFlowState.step !== 'preview') return;
  const strategy = (delayFlowState.impact?.strategies || []).find(item => item.id === strategyId && item.feasible);
  if (!strategy) return;
  delayFlowState.selectedStrategyId = strategyId;
  renderDelayModal();
}

function toggleDelayNotifyClient(reservationId) {
  if (!delayFlowState || delayFlowState.step !== 'notify') return;
  const key = Number(reservationId);
  delayFlowState.notifyChecked[key] = !delayFlowState.notifyChecked[key];
  renderDelayModal();
}

// Mise à jour du texte relu/modifié SANS re-render (préserve le focus/curseur
// dans le textarea). Le texte part au serveur au moment de l'envoi.
function setDelayNotifyMessage(reservationId, value) {
  if (!delayFlowState || delayFlowState.step !== 'notify') return;
  delayFlowState.notifyMessages[Number(reservationId)] = value;
}

function closeDelayModal() {
  delayFlowState = null;
  const overlay = document.getElementById('delayOverlay');
  overlay.classList.add('hidden');
  overlay.innerHTML = '';
}

async function applyDelayPlan() {
  if (!delayFlowState || delayFlowState.busy || delayFlowState.step !== 'preview') return;
  const strategy = (delayFlowState.impact?.strategies || []).find(item => item.id === delayFlowState.selectedStrategyId && item.feasible);
  if (!strategy) {
    toast('Choisissez une option applicable avant de valider.');
    return;
  }
  delayFlowState.busy = true;
  renderDelayModal();
  try {
    const payload = await apiRequest(API_ENDPOINTS.ops, {
      method: 'POST',
      body: JSON.stringify({
        action: 'delayApply',
        centerId: delayFlowState.centerId,
        reservationId: delayFlowState.reservationId,
        delayMinutes: delayFlowState.delayMinutes,
        reasonId: 'late_customer',
        strategyId: delayFlowState.selectedStrategyId
      })
    });
    (payload.reservations || []).forEach(item => upsertReservationInState(item));
    if (state.selectedRes) {
      const fresh = (payload.reservations || []).find(item => Number(item.id) === Number(state.selectedRes.id));
      if (fresh) {
        state.selectedRes = fresh;
        state.editState = { ...fresh, lanesStr: (fresh.lanes || []).join(', ') };
      }
    }
    save();
    renderStaffData();
    renderPos();
    delayFlowState.busy = false;
    delayFlowState.applyResult = payload;
    const candidates = payload.notifications?.candidates || [];
    if (!candidates.length) {
      closeDelayModal();
      toast('Plan de retard appliqué. Aucun client avec email à prévenir.');
      return;
    }
    delayFlowState.step = 'notify';
    delayFlowState.notifyChecked = {};
    delayFlowState.notifyMessages = {};
    candidates.forEach(candidate => {
      const key = Number(candidate.reservationId);
      delayFlowState.notifyChecked[key] = true;
      // Textarea pré-remplie par le template serveur, éditable avant envoi.
      delayFlowState.notifyMessages[key] = (candidate.message && candidate.message.body) || '';
    });
    renderDelayModal();
  } catch (error) {
    if (delayFlowState) {
      delayFlowState.busy = false;
      renderDelayModal();
    }
    toast(error.message || 'Application du plan de retard impossible.');
  }
}

function skipDelayNotifications() {
  closeDelayModal();
  toast('Plan de retard appliqué. Aucun client prévenu.');
}

async function sendDelayNotifications() {
  if (!delayFlowState || delayFlowState.busy || delayFlowState.step !== 'notify') return;
  const candidates = delayFlowState.applyResult?.notifications?.candidates || [];
  const selectedIds = candidates
    .map(candidate => Number(candidate.reservationId))
    .filter(id => delayFlowState.notifyChecked[id]);
  if (!selectedIds.length) {
    skipDelayNotifications();
    return;
  }
  // Corps relus/modifiés par le staff, transmis au serveur (source de vérité).
  const messages = selectedIds.map(id => {
    const candidate = candidates.find(item => Number(item.reservationId) === id);
    return {
      reservationId: id,
      subject: (candidate && candidate.message && candidate.message.subject) || '',
      body: delayFlowState.notifyMessages[id] || ''
    };
  });
  delayFlowState.busy = true;
  renderDelayModal();
  try {
    await apiRequest(API_ENDPOINTS.ops, {
      method: 'POST',
      body: JSON.stringify({
        action: 'delayNotify',
        centerId: delayFlowState.centerId,
        incidentId: delayFlowState.applyResult?.incidentId || null,
        reservationIds: selectedIds,
        channels: ['email'],
        messages
      })
    });
    closeDelayModal();
    toast(`${selectedIds.length} email(s) de retard envoyé(s).`);
  } catch (error) {
    if (delayFlowState) {
      delayFlowState.busy = false;
      renderDelayModal();
    }
    toast(error.message || 'Envoi des emails impossible pour le moment.');
  }
}

function renderDelayPlanRows(changes = []) {
  if (!changes.length) return '<div class="delay-plan-empty">Aucune réservation modifiée.</div>';
  return changes.map(change => `
    <div class="delay-plan-row ${change.kind === 'delayed' ? 'is-delayed' : ''}">
      <div class="delay-plan-name">${escapeHtml(change.name)}${change.kind === 'delayed' ? ' <span class="delay-plan-tag">retardée</span>' : ''}</div>
      <div class="delay-plan-summary">${escapeHtml(change.summary || 'aucune incidence')}</div>
    </div>
  `).join('');
}

function renderDelayModal() {
  const overlay = document.getElementById('delayOverlay');
  if (!delayFlowState) {
    overlay.classList.add('hidden');
    overlay.innerHTML = '';
    return;
  }
  const flow = delayFlowState;
  const impact = flow.impact;
  let body = '';
  let footer = '';

  if (flow.step === 'loading') {
    body = '<div class="delay-loading">Analyse de l\'impact sur le planning...</div>';
    footer = '<button type="button" class="delay-btn" onclick="closeDelayModal()">Annuler</button>';
  } else if (flow.step === 'preview' && impact) {
    const strategies = impact.strategies || [];
    const selected = strategies.find(item => item.id === flow.selectedStrategyId) || null;
    const downstream = impact.downstreamConflicts || [];
    const strategyOptions = strategies.map(strategy => `
      <label class="delay-strategy ${strategy.feasible ? '' : 'is-disabled'} ${flow.selectedStrategyId === strategy.id ? 'is-selected' : ''}">
        <input type="radio" name="delayStrategyChoice" ${strategy.feasible ? '' : 'disabled'} ${flow.selectedStrategyId === strategy.id ? 'checked' : ''} onchange="selectDelayStrategy('${strategy.id}')">
        <span class="delay-strategy-body">
          <span class="delay-strategy-head"><strong>${escapeHtml(strategy.label)}</strong>${strategy.id === impact.recommendedStrategyId && strategy.feasible ? '<span class="delay-strategy-reco">Recommandé</span>' : ''}</span>
          <span class="delay-strategy-desc">${escapeHtml(strategy.feasible ? strategy.description : (strategy.reasonIfNot || 'Indisponible sur ce planning.'))}</span>
        </span>
      </label>
    `).join('');
    const warnings = (selected?.warnings || []).map(warning => `<div class="delay-warning">${escapeHtml(warning)}</div>`).join('');
    body = `
      <div class="delay-context">
        <span>${escapeHtml(impact.previousStartTime)} devient <strong>${escapeHtml(impact.proposedStartTime)}</strong></span>
        <span>${downstream.length ? `${downstream.length} réservation(s) en conflit en aval` : 'Aucune réservation en conflit en aval'}</span>
      </div>
      ${strategies.length > 1 ? `<div class="delay-section-title">Options (par ordre de préférence)</div><div class="delay-strategy-list">${strategyOptions}</div>` : ''}
      <div class="delay-section-title">Plan d'impact</div>
      <div class="delay-plan-list">${renderDelayPlanRows(selected?.changes || [])}</div>
      ${warnings}
      <div class="delay-confirm-note">Rien n'est appliqué sans votre validation. Les clients ne seront prévenus qu'à l'étape suivante, si vous le demandez.</div>
    `;
    footer = `
      <button type="button" class="delay-btn" onclick="closeDelayModal()">Annuler</button>
      <button type="button" class="delay-btn delay-btn-primary" ${selected && selected.feasible && !flow.busy ? '' : 'disabled'} onclick="applyDelayPlan()">${flow.busy ? 'Application...' : 'Appliquer ce plan'}</button>
    `;
  } else if (flow.step === 'notify') {
    const candidates = flow.applyResult?.notifications?.candidates || [];
    const checkedCount = candidates.filter(candidate => flow.notifyChecked[Number(candidate.reservationId)]).length;
    body = `
      <div class="delay-applied-banner">Plan appliqué. ${escapeHtml(flow.applyResult?.strategyLabel || '')}</div>
      <div class="delay-notify-prominent">
        <div class="delay-notify-step">Étape 2 · Prévenir les clients</div>
        <div class="delay-notify-intro">Chaque message est <strong>pré-rédigé et personnalisé</strong> : relisez-le et modifiez-le si besoin. Un email part uniquement aux clients cochés, quand vous cliquez sur « Envoyer les emails ». Vous pouvez aussi ne prévenir personne.</div>
      </div>
      <div class="delay-notify-list">
        ${candidates.map(candidate => {
          const key = Number(candidate.reservationId);
          const checked = flow.notifyChecked[key];
          const value = flow.notifyMessages[key] !== undefined ? flow.notifyMessages[key] : ((candidate.message && candidate.message.body) || '');
          return `
          <div class="delay-notify-card ${checked ? 'is-on' : 'is-off'}">
            <label class="delay-notify-head">
              <input type="checkbox" ${checked ? 'checked' : ''} onchange="toggleDelayNotifyClient(${key})">
              <span class="delay-notify-body">
                <span class="delay-notify-name">${escapeHtml(candidate.name)}</span>
                <span class="delay-notify-summary">${escapeHtml(candidate.summary || '')}</span>
                <span class="delay-notify-email">${escapeHtml(candidate.email)}</span>
              </span>
            </label>
            <textarea class="delay-notify-textarea" rows="7" ${checked ? '' : 'disabled'} oninput="setDelayNotifyMessage(${key}, this.value)" aria-label="Message pour ${escapeHtml(candidate.name)}">${escapeHtml(value)}</textarea>
          </div>
        `;
        }).join('')}
      </div>
    `;
    footer = `
      <button type="button" class="delay-btn" ${flow.busy ? 'disabled' : ''} onclick="skipDelayNotifications()">Ne pas prévenir</button>
      <button type="button" class="delay-btn delay-btn-primary" ${flow.busy || !checkedCount ? 'disabled' : ''} onclick="sendDelayNotifications()">${flow.busy ? 'Envoi...' : `Envoyer les emails (${checkedCount})`}</button>
    `;
  }

  overlay.className = 'delay-overlay';
  overlay.innerHTML = `
    <div class="delay-modal" role="dialog" aria-modal="true" aria-label="Gestion du retard">
      <div class="delay-modal-head">
        <div>
          <h3>Retard +${flow.delayMinutes} min</h3>
          <p>${escapeHtml(flow.reservationName)}</p>
        </div>
        <button type="button" class="close-btn" onclick="closeDelayModal()" aria-label="Fermer">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="delay-modal-body">${body}</div>
      <div class="delay-modal-foot">${footer}</div>
    </div>
  `;
}

// === Centre de communication client (mail + SMS) ===========================
// Ouvert depuis une fiche résa : le staff choisit un modèle pré-rédigé (qui se
// remplit avec les variables de la résa), ajuste le texte, choisit le canal
// (email actif, SMS « à activer » sans Twilio), pré-visualise, puis envoie.
// Le serveur fait l'envoi et la trace ; le front ne fait que composer.
let commCenterState = null;

function openCommCenter(reservationId, ev) {
  if (ev) ev.stopPropagation();
  const reservation = state.reservations.find(item => Number(item.id) === Number(reservationId))
    || (state.selectedRes && Number(state.selectedRes.id) === Number(reservationId) ? state.selectedRes : null);
  const centerId = (reservation && reservation.centerId) || state.adminCenterId || 'libramont';
  commCenterState = {
    step: 'loading',
    reservationId: Number(reservationId),
    centerId,
    data: null,
    templateId: 'confirmation',
    channel: 'email',
    subject: '',
    body: '',
    busy: false
  };
  renderCommCenter();
  apiRequest(API_ENDPOINTS.ops, {
    method: 'POST',
    body: JSON.stringify({ action: 'clientMessageComposer', centerId, reservationId: Number(reservationId) })
  }).then(payload => {
    if (!commCenterState || commCenterState.reservationId !== Number(reservationId)) return;
    commCenterState.data = payload;
    // Canal par défaut : email si dispo, sinon le premier canal disponible.
    const channels = payload.channels || [];
    const emailChannel = channels.find(c => c.id === 'email');
    commCenterState.channel = (emailChannel && emailChannel.available) ? 'email' : (channels.find(c => c.available)?.id || 'email');
    commCenterState.step = 'compose';
    fillCommFromTemplate();
    renderCommCenter();
  }).catch(error => {
    closeCommCenter();
    toast(error.message || 'Ouverture du centre de communication impossible.');
  });
}

function closeCommCenter() {
  commCenterState = null;
  const overlay = document.getElementById('commOverlay');
  if (!overlay) return;
  overlay.classList.add('hidden');
  overlay.innerHTML = '';
}

function getCommTemplate() {
  if (!commCenterState || !commCenterState.data) return null;
  return (commCenterState.data.templates || []).find(t => t.id === commCenterState.templateId) || null;
}

// (Re)remplit sujet + corps à partir du modèle courant et du canal courant.
function fillCommFromTemplate() {
  const template = getCommTemplate();
  if (!template) return;
  if (commCenterState.channel === 'email') {
    commCenterState.subject = (template.email && template.email.subject) || '';
    commCenterState.body = (template.email && template.email.body) || '';
  } else {
    commCenterState.subject = '';
    commCenterState.body = template.sms || '';
  }
}

function selectCommTemplate(templateId) {
  if (!commCenterState || commCenterState.step !== 'compose') return;
  commCenterState.templateId = templateId;
  fillCommFromTemplate();
  renderCommCenter();
}

function selectCommChannel(channelId) {
  if (!commCenterState || commCenterState.step !== 'compose') return;
  const channel = (commCenterState.data.channels || []).find(c => c.id === channelId);
  if (!channel || !channel.available) return;
  commCenterState.channel = channelId;
  fillCommFromTemplate();
  renderCommCenter();
}

function setCommSubject(value) {
  if (!commCenterState) return;
  commCenterState.subject = value;
}

// Édition du corps SANS re-render (préserve le focus). Met à jour le compteur
// SMS et l'aperçu en direct via le DOM.
function setCommBody(value) {
  if (!commCenterState) return;
  commCenterState.body = value;
  const preview = document.getElementById('commPreviewBody');
  if (preview) preview.textContent = value;
  const counter = document.getElementById('commCharCounter');
  if (counter && commCenterState.channel === 'sms') {
    const len = value.length;
    const segments = Math.max(1, Math.ceil(len / 160));
    counter.textContent = `${len} caractère${len > 1 ? 's' : ''} · ${segments} SMS`;
  }
}

async function sendCommMessage() {
  if (!commCenterState || commCenterState.busy || commCenterState.step !== 'compose') return;
  const channel = (commCenterState.data.channels || []).find(c => c.id === commCenterState.channel);
  if (!channel || !channel.available) { toast('Ce canal doit d\'abord être activé.'); return; }
  if (!channel.hasRecipient) {
    toast(commCenterState.channel === 'sms' ? 'Aucun numéro de téléphone pour ce client.' : 'Aucun email pour ce client.');
    return;
  }
  if (!commCenterState.body.trim()) { toast('Le message est vide.'); return; }
  commCenterState.busy = true;
  renderCommCenter();
  try {
    await apiRequest(API_ENDPOINTS.ops, {
      method: 'POST',
      body: JSON.stringify({
        action: 'clientMessageSend',
        centerId: commCenterState.centerId,
        reservationId: commCenterState.reservationId,
        channel: commCenterState.channel,
        templateId: commCenterState.templateId,
        subject: commCenterState.subject,
        body: commCenterState.body
      })
    });
    toast(commCenterState.channel === 'sms' ? 'SMS envoyé.' : 'Email envoyé.');
    // Rafraîchit l'historique (trace) sans fermer le centre.
    const reservationId = commCenterState.reservationId;
    const centerId = commCenterState.centerId;
    try {
      const refreshed = await apiRequest(API_ENDPOINTS.ops, {
        method: 'POST',
        body: JSON.stringify({ action: 'clientMessageComposer', centerId, reservationId })
      });
      if (commCenterState && commCenterState.reservationId === reservationId) {
        commCenterState.data = refreshed;
        commCenterState.busy = false;
        renderCommCenter();
      }
    } catch (refreshError) {
      if (commCenterState) { commCenterState.busy = false; renderCommCenter(); }
    }
  } catch (error) {
    if (commCenterState) { commCenterState.busy = false; renderCommCenter(); }
    toast(error.message || 'Envoi du message impossible pour le moment.');
  }
}

function renderCommHistory(history = []) {
  if (!history.length) return '<div class="comm-history-empty">Aucun message envoyé à ce client pour le moment.</div>';
  const statusLabel = { sent: 'Envoyé', delivered: 'Reçu', queued: 'En file', failed: 'Échec', cancelled: 'Annulé', processing: 'En cours', draft: 'Brouillon' };
  return history.slice(0, 12).map(item => {
    const when = item.createdAt ? new Date(item.createdAt).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
    const cls = item.status === 'sent' || item.status === 'delivered' ? 'ok' : item.status === 'failed' ? 'err' : 'wait';
    return `<div class="comm-history-row">
      <span class="comm-history-chan ${escapeHtml(item.channel)}">${item.channel === 'sms' ? 'SMS' : 'Email'}</span>
      <span class="comm-history-main">
        <span class="comm-history-subject">${escapeHtml(item.subject || item.templateId || 'Message')}</span>
        <span class="comm-history-meta">${escapeHtml(when)} · ${escapeHtml(item.recipient || '')}</span>
      </span>
      <span class="comm-history-status ${cls}">${escapeHtml(statusLabel[item.status] || item.status || '')}</span>
    </div>`;
  }).join('');
}

function renderCommCenter() {
  const overlay = document.getElementById('commOverlay');
  if (!overlay) return;
  if (!commCenterState) {
    overlay.classList.add('hidden');
    overlay.innerHTML = '';
    return;
  }
  overlay.classList.remove('hidden');
  const flow = commCenterState;
  let body = '';
  let footer = '';

  if (flow.step === 'loading') {
    body = '<div class="delay-loading">Chargement des modèles de message...</div>';
    footer = '<button type="button" class="delay-btn" onclick="closeCommCenter()">Fermer</button>';
  } else if (flow.step === 'compose' && flow.data) {
    const channels = flow.data.channels || [];
    const templates = flow.data.templates || [];
    const activeChannel = channels.find(c => c.id === flow.channel) || channels[0] || {};
    const channelBtns = channels.map(channel => {
      const disabled = !channel.available;
      const title = disabled ? channel.unavailableReason : (channel.hasRecipient ? '' : 'Aucun destinataire pour ce canal');
      return `<button type="button" class="comm-channel-btn ${flow.channel === channel.id ? 'is-active' : ''} ${disabled ? 'is-disabled' : ''}" ${disabled ? 'disabled' : ''} title="${escapeHtml(title || '')}" onclick="selectCommChannel('${channel.id}')">
        ${channel.id === 'sms' ? 'SMS' : 'Email'}${disabled ? ' <span class="comm-channel-tag">à activer</span>' : ''}
      </button>`;
    }).join('');
    const templateOptions = templates.map(template =>
      `<option value="${template.id}" ${flow.templateId === template.id ? 'selected' : ''}>${escapeHtml(template.category ? `${template.category}, ${template.label}` : template.label)}</option>`
    ).join('');
    const activeTemplate = templates.find(t => t.id === flow.templateId) || null;
    const recipient = flow.channel === 'sms' ? (flow.data.reservation?.phone || '') : (flow.data.reservation?.email || '');
    const recipientMissing = !activeChannel.hasRecipient;
    const smsUnavailable = flow.channel === 'sms' && !activeChannel.available;
    const smsCounter = flow.channel === 'sms'
      ? `<div class="comm-char-counter" id="commCharCounter">${flow.body.length} caractère${flow.body.length > 1 ? 's' : ''} · ${Math.max(1, Math.ceil(flow.body.length / 160))} SMS</div>`
      : '';

    body = `
      <div class="comm-channels">${channelBtns}</div>
      ${smsUnavailable ? `<div class="comm-warning">${escapeHtml(activeChannel.unavailableReason || 'Ce canal doit être activé.')}</div>` : ''}
      <div class="comm-field">
        <label class="comm-label" for="commTemplateSelect">Modèle</label>
        <select id="commTemplateSelect" class="comm-select" onchange="selectCommTemplate(this.value)">${templateOptions}</select>
        ${activeTemplate && activeTemplate.description ? `<div class="comm-template-desc">${escapeHtml(activeTemplate.description)}</div>` : ''}
      </div>
      <div class="comm-recipient ${recipientMissing ? 'is-missing' : ''}">À : ${recipientMissing ? '<em>aucun destinataire pour ce canal</em>' : escapeHtml(recipient)}</div>
      ${flow.channel === 'email' ? `
      <div class="comm-field">
        <label class="comm-label" for="commSubjectInput">Sujet</label>
        <input id="commSubjectInput" class="comm-input" value="${escapeHtml(flow.subject)}" oninput="setCommSubject(this.value)">
      </div>` : ''}
      <div class="comm-field">
        <label class="comm-label" for="commBodyTextarea">Message</label>
        <textarea id="commBodyTextarea" class="comm-textarea" rows="${flow.channel === 'sms' ? 4 : 9}" oninput="setCommBody(this.value)" aria-label="Corps du message">${escapeHtml(flow.body)}</textarea>
        ${smsCounter}
      </div>
      <div class="comm-preview">
        <div class="comm-preview-label">Aperçu</div>
        <div class="comm-preview-body" id="commPreviewBody">${escapeHtml(flow.body)}</div>
      </div>
      <div class="comm-history">
        <div class="comm-history-title">Historique par client</div>
        ${renderCommHistory(flow.data.history || [])}
      </div>
    `;
    const canSend = !flow.busy && activeChannel.available && activeChannel.hasRecipient;
    footer = `
      <button type="button" class="delay-btn" ${flow.busy ? 'disabled' : ''} onclick="closeCommCenter()">Fermer</button>
      <button type="button" class="delay-btn delay-btn-primary" ${canSend ? '' : 'disabled'} onclick="sendCommMessage()">${flow.busy ? 'Envoi...' : (flow.channel === 'sms' ? 'Envoyer le SMS' : 'Envoyer l\'email')}</button>
    `;
  }

  const clientName = flow.data?.reservation?.name || '';
  overlay.className = 'delay-overlay comm-overlay';
  overlay.innerHTML = `
    <div class="delay-modal comm-modal" role="dialog" aria-modal="true" aria-label="Centre de communication client">
      <div class="delay-modal-head">
        <div>
          <h3>Message au client</h3>
          <p>${escapeHtml(clientName)}</p>
        </div>
        <button type="button" class="close-btn" onclick="closeCommCenter()" aria-label="Fermer">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="delay-modal-body">${body}</div>
      <div class="delay-modal-foot">${footer}</div>
    </div>
  `;
}

function renderPosCaisse(r) {
  const extras = r.extras || [];
  const basePrice = r.basePrice || getBasePriceForReservation(r);
  const total = r.price;
  // L'en-tete du ticket porte le NOM DU CENTRE de la reservation, jamais une
  // marque ecrite en dur : le comptoir d'un autre client encaissait sous
  // « FUN GALAXY ».
  const receiptName = (getAdminCenter(r.centerId || state.adminCenterId)?.name
    || getCurrentStaffCenterName()
    || getCurrentStaffCenterId()
    || 'CENTRE').toUpperCase();
  return `<div class="fade-in">
    <div class="receipt">
      <div class="receipt-head">
        <div class="title">${escapeHtml(receiptName)}</div>
        <div style="color:var(--text-3);font-size:11px;margin-top:4px;">Ticket #${String(r.id).slice(-5)}</div>
      </div>
      <div>
        <div class="receipt-line"><span style="font-weight:700;flex:1;">${escapeHtml(getReservationLabel(r))}</span><span style="font-weight:700;">${basePrice}€</span></div>
        ${extras.map((ex, i) => `<div class="receipt-line" style="color:var(--text-2);"><div style="display:flex;align-items:center;gap:6px;flex:1;">${r.status !== 'paid' ? `<button class="extra-rm" onclick="removeExtra(${i})">&times;</button>` : ''}<span>${ex.name}</span></div><span>${ex.price}€</span></div>`).join('')}
      </div>
      <div class="receipt-total">
        <span class="lbl">TOTAL</span>
        <span class="amount">${total}€</span>
      </div>
      ${r.status === 'paid' ? `<div class="paid-overlay">
        <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        <div class="paid-text">PAYÉ</div>
        <div class="paid-method">${r.paymentMethod || ''}</div>
      </div>` : ''}
    </div>
    ${r.status !== 'paid' ? `
      <div style="font-size:10px;color:var(--text-3);font-weight:800;letter-spacing:0.12em;text-transform:uppercase;padding-bottom:10px;border-bottom:1px solid var(--border);">Upsell rapide</div>
      <div class="upsell-grid">
        ${UPSELL_CATALOG.map(u => `<button class="upsell-btn" onclick="addExtra('${u.id}')"><div class="n">${u.name}</div><div class="p">+ ${u.price}€</div></button>`).join('')}
      </div>
      <div style="text-align:center;font-size:10px;color:var(--text-3);font-weight:800;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:12px;">Encaisser</div>
      <div class="pay-grid">
        <button class="pay-btn" onclick="pay('Carte Bancaire')">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
          Carte
        </button>
        <button class="pay-btn" onclick="pay('Espèces')">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/></svg>
          Espèces
        </button>
      </div>
    ` : ''}
  </div>`;
}

// L'ONGLET « MODIFIER » : LES CHAMPS SONT LA VERITE, RIEN N'EST DIT DEUX FOIS.
//
// Etat mesure avant refonte (2026-08-14) : 610 px, et l'identite du dossier
// ecrite une TROISIEME fois. Le bandeau « Apres enregistrement » (nom, type,
// heure, pistes) et les deux compteurs Joueurs / Duree ne faisaient que
// recopier des CHAMPS DE SAISIE situes 200 px plus bas : un apercu qui n'ajoute
// rien a ce que la saisie montre deja n'est pas une garantie, c'est du bruit.
// Le bloc « Type / Affectation » etait pire : « Type » redisait l'activite de
// l'en-tete, et « Affectation » recopiait le champ « Pistes » de la colonne
// d'a cote, que `syncEditLaneAssignment` tient deja a jour tout seul.
//
// Ce qui reste : DEUX groupes de champs nommes (le client, la reservation), au
// meme habillage plat que l'onglet « Infos » pour que les deux vues se lisent
// comme le meme ecran, et la barre d'actions inchangee. L'information perdue
// par ces retraits est nulle : chaque valeur retiree est encore a l'ecran, dans
// le champ qui la commande. La reattribution automatique des pistes, elle,
// n'etait ecrite NULLE PART : elle est maintenant dite sous le champ.
function renderPosEdit(r) {
  const e = state.editState;
  return `<div class="edit-shell pos-sheet fade-in">
    <form class="edit-form" onsubmit="saveEdit(event)">
      <div class="edit-layout">
        <div class="edit-stack">
          <section class="info-block">
            <span class="info-label">Le client</span>
            <div class="field-stack">
              <div class="pos-field">
                <label class="lbl" for="editNameInput">Client</label>
                <input id="editNameInput" class="input" value="${escapeHtml(e.name)}" oninput="setEditField('name', this.value)" required>
              </div>
              <div class="pos-field">
                <label class="lbl" for="editPhoneInput">Téléphone</label>
                <input id="editPhoneInput" class="input" value="${escapeHtml(e.phone)}" oninput="setEditField('phone', this.value)" required>
              </div>
            </div>
          </section>
        </div>
        <div class="edit-stack">
          <section class="info-block">
            <span class="info-label">La réservation</span>
            <div class="edit-grid-2">
              <div class="pos-field">
                <label class="lbl" for="editStartInput">Heure</label>
                <input id="editStartInput" class="input" type="time" value="${e.startTime}" oninput="setEditField('startTime', this.value, true)" required>
              </div>
              <!-- UNE DUREE SE CHOISIT EN HEURES ET MINUTES, PAS EN DECIMAL.
                   Movsar, 2026-08-14 : « pour le temps c'est mal foutu aussi, ca
                   montre pas en minutes, genre ca montre en ,5 ». Le champ etait
                   un compteur numerique au pas de 0,5 : il fallait traduire
                   « 1,5 » en « une heure et demie » de tete, et rien n'empechait
                   de saisir 3,7. La liste ne propose que des durees qui existent
                   au comptoir, ecrites comme on les dit. -->
              <div class="pos-field">
                <label class="lbl" for="editDurationInput">Durée</label>
                <select id="editDurationInput" class="input" oninput="setEditField('duration', this.value, true)" required>
                  ${[0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4].map(h => `<option value="${h}" ${Math.abs(Number(e.duration) - h) < 0.01 ? 'selected' : ''}>${formatDurationLabel(h)}</option>`).join('')}
                  ${[0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4].some(h => Math.abs(Number(e.duration) - h) < 0.01) ? '' : `<option value="${e.duration}" selected>${formatDurationLabel(Number(e.duration) || 0)}</option>`}
                </select>
              </div>
              <div class="pos-field">
                <label class="lbl" for="editPaxInput">Joueurs</label>
                <input id="editPaxInput" class="input" type="number" min="1" value="${e.pax}" oninput="setEditField('pax', this.value, true)" required>
              </div>
              <div class="pos-field">
                <label class="lbl" for="editStatusInput">Statut</label>
                <select id="editStatusInput" class="input" oninput="setEditField('status', this.value)">
                  <option value="pending" ${e.status === 'pending' ? 'selected' : ''}>Confirmé</option>
                  <option value="arrived" ${e.status === 'arrived' ? 'selected' : ''}>Arrivé</option>
                  <option value="paid" ${e.status === 'paid' ? 'selected' : ''}>Payé</option>
                </select>
              </div>
              <!-- LES PISTES SE CHOISISSENT, ELLES NE SE TAPENT PAS.
                   Movsar : « le truc modifier aussi pour les pistes, c'est mal
                   foutu ». C'etait un champ texte libre avec « Ex: 1,2 » pour
                   seule indication : il fallait connaitre le nombre de pistes du
                   centre, la syntaxe attendue, et rien n'empechait d'ecrire 99.
                   Une piste est un objet fini et denombrable, donc elle se
                   presente comme telle : une case par piste, celles qui sont en
                   maintenance sont hors service et le disent. -->
              <div class="pos-field pos-field-wide">
                <span class="lbl">Pistes</span>
                <div class="lane-picker" role="group" aria-label="Pistes attribuées" aria-describedby="editLanesHint">
                  ${Array.from({ length: TOTAL_LANES }, (_, index) => index + 1).map(lane => {
                    const choisie = getEditLaneNumbers().includes(lane);
                    const maintenance = state.laneStatuses[lane] === 'maintenance';
                    return `<button type="button" class="lane-chip${choisie ? ' is-on' : ''}${maintenance ? ' is-off' : ''}"
                      ${maintenance ? 'disabled aria-disabled="true" title="Piste en maintenance"' : ''}
                      aria-pressed="${choisie ? 'true' : 'false'}"
                      onclick="toggleEditLane(${lane})">${lane}</button>`;
                  }).join('')}
                </div>
                <p class="field-hint" id="editLanesHint">Réattribuées automatiquement quand l'effectif, l'heure ou la durée change.</p>
              </div>
            </div>
          </section>
        </div>
      </div>
      <!-- DEUX GROUPES, ET UN VIDE ENTRE LES DEUX. « Supprimer » était collé à
           « Enregistrer » : le geste qui détruit et le geste qui enregistre à
           8px l'un de l'autre, sur la même ligne, avec la même forme. Ce qui
           détruit part à GAUCHE, ce qui fait avancer reste à DROITE, et
           « Supprimer » est le seul bouton à porter la couleur de danger. -->
      <div class="edit-actions">
        <div class="edit-actions-destructive">
          <button type="button" class="btn-secondary warn" onclick="cancelRes(${r.id})">Annuler réservation</button>
          <button type="button" class="btn-secondary danger" onclick="deleteRes(${r.id})">Supprimer</button>
        </div>
        <div class="edit-actions-main">
        <button type="button" class="btn-secondary" onclick="closePos()">Fermer</button>
        <button type="submit" class="btn-primary">Enregistrer
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
        </button>
        </div>
      </div>
    </form>
  </div>`;
}

async function saveEdit(e) {
  e.preventDefault();
  const es = state.editState;
  const requiresLanes = reservationNeedsLanes(state.selectedRes.type, state.selectedRes.formuleId);
  const requiredCount = getRequiredLaneCount(state.selectedRes.type, es.pax, state.selectedRes.formuleId);
  const duration = Number(es.duration);
  const pax = Number(es.pax);
  const slotCheck = validateSlotWindow(state.selectedRes.date, es.startTime, duration, { allowPastStart: true });
  if (!slotCheck.ok) { toast(slotCheck.message); return; }
  let lanes = parseLaneInput(es.lanesStr);
  if (requiresLanes) {
    const suggested = getSuggestedEditLanes(requiredCount, state.selectedRes.date, es.startTime, duration, state.selectedRes.id, es.lanesStr);
    if (!suggested || suggested.length < requiredCount) {
      toast('Impossible de libérer ' + requiredCount + ' piste(s) pour ' + pax + ' joueurs sur ce créneau.');
      return;
    }
    lanes = suggested;
    state.editState.lanesStr = formatLaneInput(lanes);
  }
  if (lanes.some(l => state.laneStatuses[l] === 'maintenance')) { toast('Une des pistes choisies est en maintenance.'); return; }
  const conflicts = lanesConflict(state.selectedRes.date, es.startTime, duration, lanes, state.selectedRes.id);
  if (conflicts.length) { toast('Conflit detecte avec une autre reservation.'); return; }
  if (state.selectedRes.type === 'laser') {
    const laserAvailability = getLaserAvailability(state.selectedRes.date, es.startTime, duration, pax, state.selectedRes.id);
    if (!laserAvailability.ok) { toast(laserAvailability.message); return; }
  }

  const updated = {
    ...state.selectedRes,
    name: es.name,
    phone: es.phone,
    pax,
    duration,
    startTime: es.startTime,
    status: es.status,
    allowPastStart: true,
    lanes: requiresLanes ? lanes : []
  };
  updated.basePrice = getBasePrice(updated.type, updated.duration, updated.lanes.length, updated.pax, updated.formuleId);
  updated.price = updated.basePrice + sumExtras(updated.extras);
  const previousReservation = state.selectedRes;
  applyOptimisticReservation(updated, { preserveEditState: true });

  try {
    const payload = await apiRequest(API_ENDPOINTS.staffReservations, {
      method: 'PATCH',
      body: JSON.stringify(buildReservationApiPayload(updated, { laneCount: requiredCount, requiresLanes, allowPastStart: true }))
    });
    applyOptimisticReservation(payload.reservation, { preserveEditState: true });
    state.selectedRes = payload.reservation;
    save();
    closePos();
    toast('Réservation mise à jour');
  } catch (error) {
    applyOptimisticReservation(previousReservation, { preserveEditState: true });
    toast(error.message || 'Impossible de mettre à jour la réservation.');
  }
}

function setStatus(id, st) {
  setReservationStatusDirect(id, st);
}

async function addExtra(uid) {
  const u = UPSELL_CATALOG.find(x => x.id === uid);
  const r = state.selectedRes;
  if (!u || !r) return;
  const updated = {
    ...r,
    extras: [...(r.extras || []), u]
  };
  updated.price = (updated.basePrice || getBasePriceForReservation(updated)) + sumExtras(updated.extras);
  applyOptimisticReservation(updated, { preserveEditState: true });
  try {
    const payload = await apiRequest(API_ENDPOINTS.staffReservations, {
      method: 'PATCH',
      body: JSON.stringify(buildReservationApiPayload(updated))
    });
    applyOptimisticReservation(payload.reservation, { preserveEditState: true });
  } catch (error) {
    applyOptimisticReservation(r, { preserveEditState: true });
    toast(error.message || 'Impossible d ajouter l extra.');
  }
}

async function removeExtra(i) {
  const r = state.selectedRes;
  if (!r) return;
  const updated = {
    ...r,
    extras: (r.extras || []).filter((_, index) => index !== i)
  };
  updated.price = (updated.basePrice || getBasePriceForReservation(updated)) + sumExtras(updated.extras);
  applyOptimisticReservation(updated, { preserveEditState: true });
  try {
    const payload = await apiRequest(API_ENDPOINTS.staffReservations, {
      method: 'PATCH',
      body: JSON.stringify(buildReservationApiPayload(updated))
    });
    applyOptimisticReservation(payload.reservation, { preserveEditState: true });
  } catch (error) {
    applyOptimisticReservation(r, { preserveEditState: true });
    toast(error.message || 'Impossible de retirer l extra.');
  }
}

async function pay(method) {
  const r = state.selectedRes;
  if (!r) return;
  const updated = {
    ...r,
    status: 'paid',
    paymentMethod: method
  };
  applyOptimisticReservation(updated, { preserveEditState: true });
  try {
    const payload = await apiRequest(API_ENDPOINTS.staffReservations, {
      method: 'PATCH',
      body: JSON.stringify(buildReservationApiPayload(updated))
    });
    applyOptimisticReservation(payload.reservation, { preserveEditState: true });
    toast('Paiement encaisse : ' + method);
  } catch (error) {
    applyOptimisticReservation(r, { preserveEditState: true });
    toast(error.message || 'Impossible d enregistrer le paiement.');
  }
}

// Contexte d'ouverture de la réservation rapide : ce que le point d'entrée
// SAIT déjà (activité, date, heure, piste, client...) est considéré « acquis »
// : affiché en rappel, jamais redemandé, et la modale ne pose que les
// questions restantes. Dérivé du prefill brut pour ne pas toucher aux
// dizaines de points d'appel existants.
function deriveQuickBookContext(prefill = {}) {
  const known = [];
  if (prefill.name) known.push('client');
  if (prefill.type) known.push('type');
  if (prefill.date) known.push('date');
  if (prefill.startTime) known.push('startTime');
  if (Array.isArray(prefill.lanes) && prefill.lanes.length) known.push('lanes');
  if (prefill.duration) known.push('duration');
  if (prefill.formuleId) known.push('formule');
  let source = 'generic';
  if (prefill.context) source = prefill.context;
  else if (Array.isArray(prefill.lanes) && prefill.lanes.length) source = 'planning-bowling';
  else if (prefill.lockStartTime) source = 'laser-session';
  else if (prefill.type === 'laser' && prefill.startTime) source = 'laser-slot';
  else if (prefill.type === 'formule') source = 'groupe';
  else if (prefill.name) source = 'client';
  else if (prefill.type) source = 'activite';
  return { source, known };
}

// Email obligatoire côté staff (confirmations/rappels partent par mail). Format
// simple mais robuste : une @ entourée de texte sans espace, un point dans le
// domaine. Réutilisé par renderQuickBook (champ essentiel) et saveQuickBook.
function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function createQuickBookState(prefill = {}) {
  return {
    name: prefill.name || '',
    phone: prefill.phone ? normalizePhoneInput(prefill.phone) : '+32 ',
    email: prefill.email || '',
    notes: prefill.notes || '',
    date: prefill.date || state.currentDate || todayStr(),
    startTime: prefill.startTime || '',
    pax: prefill.pax || 4,
    type: prefill.type || 'bowling',
    formuleId: prefill.formuleId || '',
    duration: prefill.duration || 1,
    totalDuration: prefill.totalDuration || prefill.duration || 1,
    lanes: Array.isArray(prefill.lanes) ? [...prefill.lanes] : [],
    autoAssign: !prefill.lanes || !prefill.lanes.length,
    allowPastStart: prefill.allowPastStart === false ? false : true,
    pastStartDate: prefill.pastStartDate || prefill.date || state.currentDate || todayStr(),
    pastStartTime: prefill.pastStartTime || prefill.startTime || '',
    lockStartTime: Boolean(prefill.lockStartTime),
    context: deriveQuickBookContext(prefill),
    unlocked: {},
    moreOpen: false,
    error: '',
    payNow: false,
    submitting: false
  };
}

function openQuickBook(prefill = {}) {
  quickBookState = createQuickBookState(prefill);
  if (!quickBookState.startTime) {
    const schedule = getSchedule(quickBookState.date, state.isHolidayMode);
    if (schedule) {
      const defaultStart = quickBookState.date === todayStr() ? Math.max(schedule.open, roundUpHalfHour(currentTimeDecimal())) : schedule.open;
      quickBookState.startTime = numToTime(defaultStart);
    }
  }
  syncQuickBookDuration();
  reconcileQuickLaneSelection();
  renderQuickBook();
}

function quickFromCell(lane, startTime) {
  // Case du planning bowling : la piste, la date et l'heure sont déjà connues
  // : la modale ne redemande que le client, les joueurs et la durée.
  openQuickBook({
    date: state.currentDate,
    startTime: numToTime(startTime),
    type: 'bowling',
    lanes: Number(lane) ? [Number(lane)] : []
  });
}

function closeQuickBook() {
  quickBookState = null;
  const overlay = document.getElementById('quickBookOverlay');
  overlay.classList.add('hidden');
  overlay.innerHTML = '';
}

function syncQuickBookDuration() {
  if (!quickBookState) return;
  const formule = FORMULES.find(x => x.id === quickBookState.formuleId);
  if (quickBookState.type === 'formule' && formule) {
    quickBookState.duration = getFormuleLaneDuration(formule);
    quickBookState.totalDuration = getFormuleTotalDuration(formule);
  } else if (quickBookState.type === 'laser') {
    if (!LASER_GAME_OPTIONS.some(option => Number(option.value) === Number(quickBookState.duration))) {
      quickBookState.duration = LASER_GAME_OPTIONS[0].value;
    }
    quickBookState.totalDuration = Number(quickBookState.duration) * getLaserWaveCount(quickBookState.pax);
  } else {
    quickBookState.totalDuration = quickBookState.duration;
  }
}

// Quand le nombre de joueurs exige plus de pistes que la sélection contextuelle
// (une piste pré-remplie depuis une case du planning), on étend AUTOMATIQUEMENT
// la sélection à N pistes disponibles en gardant la piste cliquée. L'extension
// ne s'applique que si le groupe déborde (N > 1 et sélection incomplète) : les
// petits groupes (1 piste) gardent leur piste pré-remplie, et une sélection
// manuelle déjà complète n'est jamais modifiée.
function reconcileQuickLaneSelection() {
  if (!quickBookState || quickBookState.autoAssign) return;
  if (!reservationNeedsLanes(quickBookState.type, quickBookState.formuleId)) return;
  if (!quickBookState.startTime) return;
  const requiredCount = getRequiredLaneCount(quickBookState.type, quickBookState.pax, quickBookState.formuleId);
  const current = quickBookState.lanes || [];
  if (requiredCount <= 1) return;
  if (current.length === 0 || current.length >= requiredCount) return;
  const extended = allocateLanesIncludingSeed(requiredCount, current, quickBookState.date, quickBookState.startTime, quickBookState.duration);
  if (extended && extended.length >= requiredCount) quickBookState.lanes = extended;
}

function setQuickPax(value) {
  if (!quickBookState) return;
  quickBookState.pax = Math.max(1, Number(value) || 1);
  syncQuickBookDuration();
  reconcileQuickLaneSelection();
  renderQuickBook();
}

// Met à jour le « Total estimé » (seul nombre visible qui dépend des joueurs)
// SANS reconstruire la modale : on patche en place, jamais l'input ni le bouton.
function patchQuickBookPaxDerived() {
  if (!quickBookState) return;
  const overlay = document.getElementById('quickBookOverlay');
  if (!overlay) return;
  const summary = getQuickBookSummary();
  const amt = overlay.querySelector('.qb-summary .amt');
  const desc = overlay.querySelector('.qb-summary .desc');
  if (amt) amt.textContent = `${summary.total}€`;
  if (desc) desc.textContent = `${summary.detail} - durée estimée ${formatDurationLabel(quickBookState.totalDuration)}`;
}

// Champ « Joueurs » de la modale staff : saisie NORMALE sans re-render destructif.
// Pendant la frappe on met à jour l'état + la réconciliation pistes/laser SANS
// reconstruire l'input (sinon perte de focus) et SANS forcer « 1 » (le champ peut
// rester vide transitoirement, backspace inclus). La normalisation (entier >= 1)
// n'a lieu qu'au blur/commit.
function onQuickPaxInput(value) {
  if (!quickBookState) return;
  const trimmed = String(value).trim();
  if (trimmed === '') return; // champ vidé : on laisse l'utilisateur, aucune normalisation
  const n = Math.trunc(Number(trimmed));
  if (!Number.isFinite(n) || n < 1) return; // valeur transitoire invalide : on ne force rien
  quickBookState.pax = n;
  syncQuickBookDuration();
  reconcileQuickLaneSelection();
  patchQuickBookPaxDerived();
}

function onQuickPaxBlur(el, ev) {
  if (!quickBookState) return;
  const n = Math.max(1, Math.trunc(Number(el && el.value) || 1));
  quickBookState.pax = n;
  syncQuickBookDuration();
  reconcileQuickLaneSelection();
  // On reflète la valeur normalisée directement dans le champ (pas de re-render :
  // reconstruire la modale ici détruirait « Créer la réservation » avant l'arrivée
  // du clic : le même piège que le champ téléphone, et volerait le focus si on
  // tabule vers un autre champ). Le « Total estimé » est patché en place.
  if (el) el.value = String(n);
  patchQuickBookPaxDerived();
}

function setQuickType(type) {
  quickBookState.type = type;
  if (type === 'bowling' || type === 'laser') {
    quickBookState.formuleId = '';
    quickBookState.lanes = [];
    quickBookState.autoAssign = type === 'bowling';
  }
  syncQuickBookDuration();
  renderQuickBook();
}

function setQuickDuration(duration) {
  if (quickBookState.type === 'formule' && quickBookState.formuleId) return;
  quickBookState.duration = duration;
  syncQuickBookDuration();
  renderQuickBook();
}

function setQuickFormule(id) {
  quickBookState.formuleId = id;
  syncQuickBookDuration();
  renderQuickBook();
}

function normalizePhoneInput(value = '') {
  const raw = String(value || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '+32 ';
  if (raw.startsWith('+')) return raw;
  if (raw.startsWith('00')) return `+${raw.slice(2)}`;
  if (raw.startsWith('0')) return `+32 ${raw.slice(1)}`.trim();
  return `+32 ${raw}`.trim();
}

function onQuickPhoneFocus() {
  if (!quickBookState) return;
  if (!quickBookState.phone.trim()) quickBookState.phone = '+32 ';
}

function onQuickPhoneInput(value) {
  if (!quickBookState) return;
  quickBookState.phone = value;
}

function onQuickPhoneBlur(elOrValue) {
  if (!quickBookState) return;
  const el = elOrValue && typeof elOrValue === 'object' ? elOrValue : null;
  const value = el ? el.value : elOrValue;
  quickBookState.phone = normalizePhoneInput(value);
  // Pas de re-render complet ici : le clic sur « Créer la réservation »
  // déclenche d'abord le blur du téléphone. Un renderQuickBook() reconstruirait
  // la modale (innerHTML) et détruirait le bouton avant que le clic n'atterrisse
  // : d'où le fameux « il faut cliquer deux fois ». On reflète juste la valeur
  // normalisée dans le champ, sans reconstruire le DOM.
  if (el) el.value = quickBookState.phone;
}

function getQuickBookFormulaChoices() {
  if (!quickBookState) return [];
  const pax = Number(quickBookState.pax) || 1;
  return FORMULES.map(formule => {
    const availability = getFormuleAvailability(formule, quickBookState.date, pax, quickBookState.startTime);
    return {
      ...formule,
      available: availability.ok,
      reason: availability.message
    };
  }).sort((a, b) => {
    if (a.available === b.available) return a.price - b.price;
    return a.available ? -1 : 1;
  });
}

function quickBookAllowsPastSelectedTime() {
  return Boolean(quickBookState && quickBookState.allowPastStart);
}

function getQuickBookSelectedSlotIfValid({ duration, totalDuration, needsLanes, requiredCount, formule = null } = {}) {
  if (!quickBookState?.startTime) return null;
  const time = quickBookState.startTime;
  const slotCheck = validateSlotWindow(quickBookState.date, time, totalDuration, {
    allowPastStart: quickBookAllowsPastSelectedTime()
  });
  if (!slotCheck.ok) return null;
  if (formule) {
    const availability = getFormuleAvailability(formule, quickBookState.date, quickBookState.pax, time);
    if (!availability.ok) return null;
  }
  if (quickBookState.type === 'laser') {
    const laserAvailability = getLaserAvailability(quickBookState.date, time, duration, quickBookState.pax);
    if (!laserAvailability.ok) return null;
    return {
      time,
      lanes: [],
      freeCount: laserAvailability.remainingPlaces,
      groupPlayers: laserAvailability.groupPlayers,
      waveCount: laserAvailability.waveCount,
      splitGroup: laserAvailability.splitGroup,
      sharedSession: laserAvailability.sharedNow,
      mayShareSession: laserAvailability.mayShare,
      selected: true,
      locked: Boolean(quickBookState.lockStartTime)
    };
  }
  const lanes = needsLanes ? allocateLanes(requiredCount, quickBookState.date, time, duration) : [];
  if (needsLanes && (!lanes || lanes.length < requiredCount)) return null;
  return {
    time,
    lanes: lanes || [],
    freeCount: needsLanes ? getFreeCount(quickBookState.date, time, duration) : 0,
    selected: true,
    locked: Boolean(quickBookState.lockStartTime)
  };
}

function getQuickBookAvailableSlots() {
  if (!quickBookState) return [];
  const schedule = getSchedule(quickBookState.date, state.isHolidayMode);
  if (!schedule) return [];
  const formule = quickBookState.type === 'formule' ? FORMULES.find(x => x.id === quickBookState.formuleId) : null;
  if (quickBookState.type === 'formule' && !formule) return [];
  if (formule) {
    const baseAvailability = getFormuleAvailability(formule, quickBookState.date, quickBookState.pax);
    if (!baseAvailability.ok) return [];
  }

  const duration = Number(quickBookState.duration || 0);
  const totalDuration = Number(quickBookState.totalDuration || duration || 0);
  const needsLanes = reservationNeedsLanes(quickBookState.type, quickBookState.formuleId);
  const requiredCount = getRequiredLaneCount(quickBookState.type, quickBookState.pax, quickBookState.formuleId);
  let minTime = schedule.open;
  let maxTime = schedule.close - totalDuration;

  if (quickBookState.lockStartTime) {
    const lockedSlot = getQuickBookSelectedSlotIfValid({ duration, totalDuration, needsLanes, requiredCount, formule });
    return lockedSlot ? [lockedSlot] : [];
  }

  if (formule && formule.timeLimit) {
    if (formule.timeLimit.min) minTime = Math.max(minTime, formule.timeLimit.min);
    if (formule.timeLimit.max) maxTime = Math.min(maxTime, formule.timeLimit.max - totalDuration);
  }
  if (quickBookState.date === todayStr() && !quickBookAllowsPastSelectedTime()) {
    minTime = Math.max(minTime, roundUpHalfHour(currentTimeDecimal()));
  }

  const slots = [];
  for (let value = minTime; value <= maxTime; value += 0.5) {
    const time = numToTime(value);
    const slotCheck = validateSlotWindow(quickBookState.date, time, totalDuration, {
      allowPastStart: quickBookAllowsPastSelectedTime()
    });
    if (!slotCheck.ok) continue;
    if (formule) {
      const availability = getFormuleAvailability(formule, quickBookState.date, quickBookState.pax, time);
      if (!availability.ok) continue;
    }
    if (quickBookState.type === 'laser') {
      const laserAvailability = getLaserAvailability(quickBookState.date, time, duration, quickBookState.pax);
      if (!laserAvailability.ok) continue;
      slots.push({
        time,
        lanes: [],
        freeCount: laserAvailability.remainingPlaces,
        groupPlayers: laserAvailability.groupPlayers,
        waveCount: laserAvailability.waveCount,
        splitGroup: laserAvailability.splitGroup,
        sharedSession: laserAvailability.sharedNow,
        mayShareSession: laserAvailability.mayShare,
        selected: quickBookState.startTime === time
      });
      continue;
    }
    const lanes = needsLanes ? allocateLanes(requiredCount, quickBookState.date, time, duration) : [];
    if (needsLanes && (!lanes || lanes.length < requiredCount)) continue;
    const freeCount = needsLanes ? getFreeCount(quickBookState.date, time, duration) : 0;
    slots.push({
      time,
      lanes: lanes || [],
      freeCount,
      selected: quickBookState.startTime === time
    });
  }
  if (quickBookState.startTime && !slots.some(slot => slot.time === quickBookState.startTime)) {
    const selectedSlot = getQuickBookSelectedSlotIfValid({ duration, totalDuration, needsLanes, requiredCount, formule });
    if (selectedSlot) slots.push(selectedSlot);
  }
  slots.sort((left, right) => timeToNum(left.time) - timeToNum(right.time));
  return slots;
}

function setQuickStartTime(time) {
  if (!quickBookState) return;
  if (quickBookState.lockStartTime && time !== quickBookState.startTime) return;
  quickBookState.error = '';
  quickBookState.startTime = time;
  renderQuickBook();
}

function applyQuickSuggestedLanes() {
  if (!quickBookState || !quickBookState.startTime) return;
  const requiredCount = getRequiredLaneCount(quickBookState.type, quickBookState.pax, quickBookState.formuleId);
  // Garde la piste déjà choisie (case du planning) et complète jusqu'à N.
  const seed = quickBookState.autoAssign ? [] : (quickBookState.lanes || []);
  const suggested = seed.length
    ? allocateLanesIncludingSeed(requiredCount, seed, quickBookState.date, quickBookState.startTime, quickBookState.duration)
    : allocateLanes(requiredCount, quickBookState.date, quickBookState.startTime, quickBookState.duration);
  if (!suggested || !suggested.length) return;
  quickBookState.autoAssign = false;
  quickBookState.lanes = suggested;
  renderQuickBook();
}

function toggleQuickLane(lane) {
  if (!quickBookState) return;
  if (quickBookState.autoAssign) quickBookState.autoAssign = false;
  const lanes = new Set(quickBookState.lanes);
  if (lanes.has(lane)) lanes.delete(lane);
  else lanes.add(lane);
  quickBookState.lanes = Array.from(lanes).sort((a, b) => a - b);
  renderQuickBook();
}

function setQuickAutoAssign() {
  quickBookState.autoAssign = true;
  quickBookState.lanes = [];
  renderQuickBook();
}

function getQuickBookSummary() {
  if (!quickBookState) return { total: 0, detail: '' };
  if (quickBookState.type === 'laser') {
    const option = getLaserOption(quickBookState.duration);
    return {
      total: option.price * Number(quickBookState.pax || 0),
      detail: `${option.label} Laser Game - ${quickBookState.pax} joueur(s)`
    };
  }
  const laneCount = quickBookState.autoAssign ? getRequiredLaneCount(quickBookState.type, quickBookState.pax, quickBookState.formuleId) : quickBookState.lanes.length;
  const total = getBasePrice(quickBookState.type, quickBookState.duration, laneCount, quickBookState.pax, quickBookState.formuleId);
  const detail = laneCount ? `${laneCount} piste(s) prévues` : 'Sans piste';
  return { total, detail };
}

// Un champ « acquis » par le contexte reste modifiable : le rappel propose un
// lien discret qui rouvre le contrôle correspondant (zéro perte de capacité).
function quickFieldKnown(field) {
  if (!quickBookState) return false;
  return quickBookState.context.known.includes(field) && !quickBookState.unlocked[field];
}

function unlockQuickField(field) {
  if (!quickBookState) return;
  quickBookState.unlocked[field] = true;
  // Les contrôles avancés (pistes, créneaux) vivent dans « Plus d'options ».
  if (field === 'lanes') quickBookState.moreOpen = true;
  renderQuickBook();
}

function toggleQuickBookMore() {
  if (!quickBookState) return;
  quickBookState.moreOpen = !quickBookState.moreOpen;
  renderQuickBook();
}

function formatQuickBookDateLabel(dateStr) {
  try {
    return new Intl.DateTimeFormat('fr-BE', { weekday: 'short', day: 'numeric', month: 'short' }).format(parseLocalDate(dateStr));
  } catch (error) {
    return dateStr;
  }
}

// Titre + tonalité par contexte : la popup « parle » l'endroit d'où elle vient.
function getQuickBookHeader(formule) {
  const s = quickBookState;
  const src = s.context.source;
  if (src === 'planning-bowling') {
    const laneText = s.lanes.length ? `la piste ${s.lanes.join(' & ')}` : 'le bowling';
    return { eyebrow: 'Planning bowling', title: `Réserver ${laneText}${s.startTime ? ` · ${s.startTime}` : ''}`, sub: 'Créneau repris du planning, il ne reste que le client à compléter.' };
  }
  if (src === 'laser-session') {
    return { eyebrow: 'Laser Game', title: `Rejoindre le lancement${s.startTime ? ` · ${s.startTime}` : ''}`, sub: 'Le groupe complète une session existante, départ verrouillé.' };
  }
  if (src === 'laser-slot' || (src === 'activite' && s.type === 'laser')) {
    return { eyebrow: 'Laser Game', title: `Nouvelle session laser${quickFieldKnown('startTime') && s.startTime ? ` · ${s.startTime}` : ''}`, sub: 'Session laser depuis le planning des lancements.' };
  }
  if (src === 'groupe' || (src === 'activite' && s.type === 'formule')) {
    return { eyebrow: 'Groupes & anniversaires', title: 'Réservation groupe · anniversaire', sub: 'Choisissez la formule, le reste suit.' };
  }
  if (src === 'client') {
    return { eyebrow: 'Fiche client', title: `Réserver pour ${s.name || 'ce client'}`, sub: 'Coordonnées reprises de la fiche, choisissez le créneau.' };
  }
  if (src === 'activite') {
    return { eyebrow: 'Staff Booking', title: s.type === 'laser' ? 'Nouvelle session laser' : 'Nouvelle partie bowling', sub: 'Créée depuis la page en cours, sur la date affichée.' };
  }
  return { eyebrow: 'Staff Booking', title: 'Réservation rapide', sub: '' };
}

function renderQuickBook() {
  if (!quickBookState) return;
  const overlay = document.getElementById('quickBookOverlay');
  const schedule = getSchedule(quickBookState.date, state.isHolidayMode);
  const formule = quickBookState.type === 'formule' ? FORMULES.find(x => x.id === quickBookState.formuleId) : null;
  const formuleChoices = getQuickBookFormulaChoices();
  const availableSlots = getQuickBookAvailableSlots();
  const firstSlot = availableSlots[0] || null;
  const selectedSlot = availableSlots.find(slot => slot.time === quickBookState.startTime) || null;
  const needsLanes = reservationNeedsLanes(quickBookState.type, quickBookState.formuleId);
  const requiredCount = getRequiredLaneCount(quickBookState.type, quickBookState.pax, quickBookState.formuleId);
  const occupied = quickBookState.startTime ? getOccupiedLanes(quickBookState.date, quickBookState.startTime, quickBookState.duration) : new Set();
  const suggestedLanes = quickBookState.startTime && needsLanes
    ? allocateLanes(requiredCount, quickBookState.date, quickBookState.startTime, quickBookState.duration) || []
    : [];
  const summary = getQuickBookSummary();
  const formuleAvailability = formule ? getFormuleAvailability(formule, quickBookState.date, quickBookState.pax, quickBookState.startTime) : { ok: true, message: '' };
  const slotCheck = quickBookState.startTime
    ? validateSlotWindow(quickBookState.date, quickBookState.startTime, quickBookState.totalDuration, {
      allowPastStart: quickBookAllowsPastSelectedTime()
    })
    : { ok: false, message: 'Sélectionnez une heure.' };
  const laserAvailability = quickBookState.type === 'laser' && quickBookState.startTime
    ? getLaserAvailability(quickBookState.date, quickBookState.startTime, quickBookState.duration, quickBookState.pax)
    : { ok: true, message: '' };
  const warning = !schedule
    ? 'Centre fermé à cette date.'
    : !slotCheck.ok ? slotCheck.message : formule && !formuleAvailability.ok ? formuleAvailability.message : !laserAvailability.ok ? laserAvailability.message : '';
  const activeLanes = quickBookState.autoAssign ? suggestedLanes : quickBookState.lanes;
  const activeLaneText = activeLanes.length ? activeLanes.join(' - ') : 'A attribuer';
  const freeCount = selectedSlot
    ? selectedSlot.freeCount
    : quickBookState.startTime && needsLanes
      ? getFreeCount(quickBookState.date, quickBookState.startTime, quickBookState.duration)
      : 0;
  const autoLaneMessage = needsLanes
    ? quickBookState.autoAssign
      ? `Attribution auto de ${requiredCount} piste(s)${suggestedLanes.length ? ` - suggestion ${suggestedLanes.join(' - ')}` : ''}`
      : `Sélection actuelle : ${quickBookState.lanes.length}/${requiredCount} piste(s)`
    : 'Sans piste de bowling';
  const laserOption = quickBookState.type === 'laser' ? getLaserOption(quickBookState.duration) : null;
  const typeLabel = quickBookState.type === 'bowling'
    ? 'Bowling classique'
    : quickBookState.type === 'laser'
      ? `Laser Game - ${laserOption.label}`
      : formule ? formule.name : 'Choisir une formule';
  const selectedSlotLabel = selectedSlot
    ? `${selectedSlot.time} - ${quickBookState.type === 'laser' ? getLaserSlotAfterText(selectedSlot, quickBookState.pax) : needsLanes ? `${selectedSlot.freeCount} piste(s) libre(s)` : 'disponible'}`
    : firstSlot
      ? `Premier créneau ${firstSlot.time}`
      : 'Aucun créneau trouvé';
  const laneNeedLabel = quickBookState.type === 'laser'
    ? `${quickBookState.pax} joueurs • ${getLaserWaveCount(quickBookState.pax)} session${getLaserWaveCount(quickBookState.pax) > 1 ? 's' : ''}`
    : needsLanes ? `${requiredCount} piste${requiredCount > 1 ? 's' : ''} requise${requiredCount > 1 ? 's' : ''}` : 'Sans piste';
  const laneSuggestionLabel = !needsLanes
    ? 'Cette réservation ne prend pas de piste.'
    : suggestedLanes.length
      ? `Suggestion actuelle : piste${suggestedLanes.length > 1 ? 's' : ''} ${suggestedLanes.join(' - ')}`
      : 'Aucune suggestion automatique sur ce créneau.';
  const laneSelectionLabel = !needsLanes
    ? 'Aucune affectation'
    : quickBookState.autoAssign
      ? `Mode auto${activeLanes.length ? ` - ${activeLaneText}` : ''}`
      : quickBookState.lanes.length
        ? `Sélection manuelle - ${quickBookState.lanes.join(' - ')}`
        : 'Sélection manuelle en attente';

  const header = getQuickBookHeader(formule);
  const showClient = !quickFieldKnown('client');
  const showType = !quickFieldKnown('type');
  const showDate = !quickFieldKnown('date');
  const showTime = !quickFieldKnown('startTime');
  const durationEssential = !quickFieldKnown('duration') && (
    quickBookState.type === 'laser'
    || (quickBookState.type === 'bowling' && (quickFieldKnown('type') || quickFieldKnown('startTime') || quickFieldKnown('lanes')))
  );
  const showFormuleGrid = quickBookState.type === 'formule' && (!quickFieldKnown('formule') || !formule);
  const manualLanesShort = needsLanes && !quickBookState.autoAssign && quickBookState.lanes.length < requiredCount;
  // Email = champ visible et saisissable, mais NON obligatoire côté staff (contact
  // libre au comptoir). On le montre dans le bloc client ; s'il est déjà connu mais
  // renseigné avec un format invalide, on le signale sans jamais bloquer la création.
  const emailValid = isValidEmail(quickBookState.email);
  const emailInputHtml = `
    <div>
      <label class="qb-mini-label">Email</label>
      <input class="qb-input ${quickBookState.email && !emailValid ? 'qb-input-invalid' : ''}" type="email" value="${escapeHtml(quickBookState.email)}" oninput="quickBookState.email=this.value" placeholder="client@email.com">
      ${quickBookState.email && !emailValid ? '<div class="qb-field-note danger">Format email invalide.</div>' : '<div class="qb-field-note">Sert aux confirmations et rappels automatiques.</div>'}
    </div>`;

  // Rappel des acquis du contexte : affichés, jamais redemandés, modifiables.
  const chips = [];
  if (!showClient) chips.push({ k: 'Client', v: `${escapeHtml(quickBookState.name)} · ${escapeHtml(quickBookState.phone)}`, field: 'client' });
  if (!showType) chips.push({ k: 'Activité', v: quickBookState.type === 'laser' ? 'Laser Game' : escapeHtml(typeLabel), field: 'type' });
  if (!showDate) chips.push({ k: 'Date', v: formatQuickBookDateLabel(quickBookState.date), field: 'date' });
  if (!showTime) chips.push({ k: 'Départ', v: quickBookState.startTime || '--:--', field: quickBookState.lockStartTime ? '' : 'startTime', lock: quickBookState.lockStartTime });
  if (quickFieldKnown('lanes')) chips.push({ k: quickBookState.lanes.length > 1 ? 'Pistes' : 'Piste', v: quickBookState.lanes.join(' · ') || 'Auto', field: 'lanes' });
  if (!durationEssential && quickFieldKnown('duration')) chips.push({ k: 'Durée', v: quickBookState.type === 'laser' ? getLaserOption(quickBookState.duration).label : formatDurationLabel(quickBookState.duration), field: 'duration' });
  if (quickBookState.type === 'formule' && quickFieldKnown('formule') && formule) chips.push({ k: 'Formule', v: escapeHtml(formule.name), field: 'formule' });

  const contextStripHtml = chips.length ? `
    <div class="qb-context-strip">
      ${chips.map(chip => `
        <div class="qb-context-chip">
          <div><div class="k">${chip.k}</div><div class="v">${chip.v}</div></div>
          ${chip.lock ? '<span class="qb-chip-lock">Verrouillé</span>' : chip.field ? `<button type="button" class="qb-chip-edit" onclick="unlockQuickField('${chip.field}')">Modifier</button>` : ''}
        </div>
      `).join('')}
    </div>
  ` : '';

  // Cellules essentielles restantes (date/heure/joueurs) selon le contexte.
  const essentialCells = [];
  if (showDate) essentialCells.push(`
    <div>
      <label class="qb-mini-label">Date</label>
      <input class="qb-input" type="date" value="${quickBookState.date}" oninput="quickBookState.date=this.value; renderQuickBook()">
    </div>`);
  if (showTime) essentialCells.push(`
    <div>
      <label class="qb-mini-label">Heure</label>
      <input class="qb-input" type="time" step="1800" value="${quickBookState.startTime}" oninput="quickBookState.startTime=this.value; renderQuickBook()">
    </div>`);
  essentialCells.push(`
    <div>
      <label class="qb-mini-label">Joueurs</label>
      <input class="qb-input" type="number" min="1" max="120" value="${quickBookState.pax}" oninput="onQuickPaxInput(this.value)" onblur="onQuickPaxBlur(this, event)">
    </div>`);

  const essentialActions = [];
  if (showTime && firstSlot && !quickBookState.lockStartTime && (!selectedSlot || firstSlot.time !== quickBookState.startTime)) {
    essentialActions.push(`<button class="qb-ghost-btn" onclick="setQuickStartTime('${firstSlot.time}')">Premier créneau ${firstSlot.time}</button>`);
  }
  if (manualLanesShort && suggestedLanes.length) {
    essentialActions.push(`<button class="qb-ghost-btn" onclick="applyQuickSuggestedLanes()">Compléter les pistes (${suggestedLanes.join(' - ')})</button>`);
  }

  // Ligne d'état compacte : la synthèse dispo/pistes/sessions sans les 3 cartes.
  const statusParts = [];
  if (schedule) statusParts.push(`Ouvert ${schedule.label}`);
  if (quickBookState.type === 'laser') {
    statusParts.push(laneNeedLabel);
    if (selectedSlot) statusParts.push(getLaserSlotAfterText(selectedSlot, quickBookState.pax));
    if (selectedSlot && (selectedSlot.sharedSession || selectedSlot.mayShareSession)) statusParts.push('Session partagée possible selon l’affluence');
  } else if (needsLanes) {
    statusParts.push(laneNeedLabel);
    statusParts.push(quickBookState.autoAssign ? `Attribution auto${suggestedLanes.length ? ` : pistes ${suggestedLanes.join(' · ')}` : ''}` : `Pistes ${quickBookState.lanes.join(' · ') || 'à choisir'}${manualLanesShort ? ` (${quickBookState.lanes.length}/${requiredCount})` : ''}`);
    if (quickBookState.startTime && selectedSlot) statusParts.push(`${Math.max(freeCount, 0)} piste(s) libre(s)`);
  } else if (quickBookState.type === 'formule' && formule) {
    statusParts.push('Sans piste de bowling');
  }

  const formuleGridHtml = showFormuleGrid ? `
    <div style="margin-top:12px;">
      <label class="qb-mini-label">Formules disponibles</label>
      <div class="qb-formule-grid">
        ${formuleChoices.map(item => {
          const timeWindow = item.timeLimit
            ? item.timeLimit.min && item.timeLimit.max
              ? `${item.timeLimit.min}h-${item.timeLimit.max}h`
              : item.timeLimit.max
                ? `avant ${item.timeLimit.max}h`
                : `des ${item.timeLimit.min}h`
            : item.validDays
              ? `${item.validDays.length} jour(s)`
              : 'Libre';
          const isActive = quickBookState.formuleId === item.id;
          const locked = !item.available && !isActive;
          return `
            <button class="qb-formule-card ${isActive ? 'active' : ''} ${item.available ? '' : 'unavailable'}" onclick="setQuickFormule('${item.id}')" ${locked ? 'disabled' : ''}>
              <div class="qb-formule-top">
                <div class="qb-formule-name">${item.name}</div>
                <div class="qb-formule-price">${item.price}EUR/${item.type === 'per_lane' ? 'piste' : 'pers'}</div>
              </div>
              <div class="qb-formule-sub">${item.family} - ${timeWindow}</div>
              <div class="qb-formule-status">
                <span class="qb-status-pill ${item.available ? 'ok' : 'no'}">${item.available ? 'Dispo' : 'Bloquée'}</span>
                <span class="qb-inline-note">${item.available ? item.desc[0] : item.reason}</span>
              </div>
            </button>
          `;
        }).join('')}
      </div>
    </div>
  ` : '';

  const durationEssentialHtml = durationEssential
    ? quickBookState.type === 'laser'
      ? `
        <div style="margin-top:12px;">
          <label class="qb-mini-label">Parties</label>
          <div class="qb-dur-grid laser">
            ${LASER_GAME_OPTIONS.map(opt => `<button class="qb-dur-btn ${Number(quickBookState.duration) === Number(opt.value) ? 'active' : ''}" onclick="setQuickDuration(${opt.value})">${opt.label}<small>${opt.price}€/pers</small></button>`).join('')}
          </div>
        </div>`
      : `
        <div style="margin-top:12px;">
          <label class="qb-mini-label">Durée</label>
          <div class="qb-dur-grid">
            ${DURATION_OPTIONS.map(opt => `<button class="qb-dur-btn ${quickBookState.duration === opt.value ? 'active' : ''}" onclick="setQuickDuration(${opt.value})">${opt.label}</button>`).join('')}
          </div>
        </div>`
    : '';

  // « Plus d'options » : toutes les capacités avancées restent là, repliées.
  const advancedHtml = quickBookState.moreOpen ? `
    <div class="qb-block">
      <div class="blk-label">Créneau &amp; disponibilité</div>
      <div class="qb-block-help">Horaires du centre, choix du départ et pistes libres en temps réel.</div>
      <div class="qb-snapshot-row">
        <div class="qb-snapshot">
          <div class="k">Ouverture</div>
          <div class="v">${schedule ? schedule.label : 'Fermé'}</div>
          <div class="t">${schedule ? 'Lecture directe des horaires du centre' : 'Aucune réservation possible sur cette date'}</div>
        </div>
        <div class="qb-snapshot">
          <div class="k">Créneau</div>
          <div class="v">${quickBookState.startTime || '--:--'}</div>
          <div class="t">${selectedSlotLabel}</div>
        </div>
        <div class="qb-snapshot">
          <div class="k">Affectation</div>
          <div class="v">${laneNeedLabel}</div>
          <div class="t">${laneSelectionLabel}</div>
        </div>
      </div>
      <div class="qb-slot-head" style="margin-top:12px;">
        <label class="qb-mini-label" style="margin-bottom:0;">Créneaux disponibles</label>
        <div class="qb-section-note">${quickBookState.type === 'laser' ? (selectedSlot ? getLaserSlotAfterText(selectedSlot, quickBookState.pax) : `${getLaserWaveCount(quickBookState.pax)} session${getLaserWaveCount(quickBookState.pax) > 1 ? 's' : ''} à planifier`) : needsLanes ? `${Math.max(freeCount, 0)} piste(s) libre(s) sur le créneau choisi` : 'Sélection rapide de l’heure de départ'}</div>
      </div>
      ${availableSlots.length ? `
        <div class="qb-slot-strip">
          ${availableSlots.slice(0, 8).map(slot => `
            <button class="qb-slot-chip ${slot.selected ? 'active' : ''} ${quickBookState.lockStartTime ? 'locked' : ''}" ${quickBookState.lockStartTime ? 'disabled aria-disabled="true"' : `onclick="setQuickStartTime('${slot.time}')"`}>
              <span class="time">${slot.time}</span>
              <span class="sub">${quickBookState.type === 'laser' ? getLaserSlotCapacityText(slot, quickBookState.pax) : needsLanes ? `${slot.freeCount} piste(s) libre(s)` : 'disponible'}</span>
              <span class="lanes">${slot.selected ? (quickBookState.lockStartTime ? 'Lancement verrouillé' : 'Sélectionné') : quickBookState.type === 'laser' && slot.sharedSession ? 'Rejoindre session' : 'Choisir ce départ'}</span>
            </button>
          `).join('')}
        </div>
      ` : `
        <div class="qb-empty-note">Aucun créneau automatique avec ces critères. Changez la date, l'heure, le nombre de joueurs ou la formule.</div>
      `}
    </div>

    <div class="qb-block">
      <div class="blk-label">Durée &amp; pistes</div>
      <div class="qb-block-help">Durée de jeu et affectation des pistes (auto ou sélection manuelle).</div>
      ${quickBookState.type === 'formule' && !formule ? `
        <div class="qb-warn">Sélectionnez d'abord une formule pour voir la logique de durée et de pistes.</div>
      ` : quickBookState.type === 'laser' ? `
        ${durationEssential ? '' : `
        <div class="qb-dur-grid laser" style="margin-bottom:12px;">
          ${LASER_GAME_OPTIONS.map(opt => `<button class="qb-dur-btn ${Number(quickBookState.duration) === Number(opt.value) ? 'active' : ''}" onclick="setQuickDuration(${opt.value})">${opt.label}<small>${opt.price}€/pers</small></button>`).join('')}
        </div>`}
        <div class="qb-lane-focus laser-focus">
          <div>
            <div class="qb-lane-focus-title">Arène Laser Game</div>
            <div class="qb-lane-focus-sub">${selectedSlot ? `${getLaserSlotAfterText(selectedSlot, quickBookState.pax)}${selectedSlot.sharedSession ? ' • session déjà partagée' : ''}` : 'Choisissez un départ disponible'}</div>
          </div>
          <div class="qb-action-stack">
            ${firstSlot && !quickBookState.lockStartTime ? `<button class="qb-ghost-btn" onclick="setQuickStartTime('${firstSlot.time}')">Premier départ ${firstSlot.time}</button>` : ''}
          </div>
        </div>
        <div class="qb-warn">Prévenir le client : une session Laser Game peut être complétée avec d'autres joueurs selon l'affluence.</div>
      ` : needsLanes ? `
        <div class="qb-dur-grid" style="margin-bottom:12px;">
          ${DURATION_OPTIONS.map(opt => `<button class="qb-dur-btn ${quickBookState.duration === opt.value ? 'active' : ''}" onclick="setQuickDuration(${opt.value})">${opt.label}</button>`).join('')}
        </div>
        ${quickBookState.type === 'formule' && formule ? `<div class="qb-warn" style="margin-bottom:12px;">Durée liée à la formule ${formule.name}.</div>` : ''}
        <div class="qb-lane-focus">
          <div>
            <div class="qb-lane-focus-title">${laneNeedLabel}</div>
            <div class="qb-lane-focus-sub">${laneSuggestionLabel}</div>
          </div>
          <div class="qb-action-stack">
            ${quickBookState.startTime && suggestedLanes.length ? `<button class="qb-ghost-btn" onclick="applyQuickSuggestedLanes()">Appliquer ${suggestedLanes.join(' - ')}</button>` : ''}
            <button class="qb-ghost-btn" onclick="setQuickAutoAssign()">Mode auto</button>
          </div>
        </div>
        <div class="qb-lane-grid">
          <button class="qb-lane-btn auto ${quickBookState.autoAssign ? 'active' : ''}" onclick="setQuickAutoAssign()">Auto</button>
          ${Array.from({ length: TOTAL_LANES }, (_, idx) => idx + 1).map(lane => {
            const busy = occupied.has(lane);
            const maint = state.laneStatuses[lane] === 'maintenance';
            const active = !quickBookState.autoAssign && quickBookState.lanes.includes(lane);
            const suggested = quickBookState.autoAssign && suggestedLanes.includes(lane);
            const cls = `${active ? 'active' : ''} ${busy ? 'busy' : ''} ${maint ? 'maint' : ''} ${suggested ? 'suggested' : ''}`.trim();
            const action = busy || maint ? '' : `onclick="toggleQuickLane(${lane})"`;
            const disabledAttr = busy || maint ? 'disabled aria-disabled="true"' : '';
            return `<button class="qb-lane-btn ${cls}" ${disabledAttr} ${action}>${lane}</button>`;
          }).join('')}
        </div>
        <div class="qb-lane-footer">
          <div class="qb-lane-selection">${laneSelectionLabel}</div>
          <div class="schedule-hint">${quickBookState.autoAssign ? `<span class="open">${autoLaneMessage}</span>` : `<span class="${quickBookState.lanes.length >= requiredCount ? 'open' : 'closed'}">${autoLaneMessage}</span>`}</div>
        </div>
      ` : `
        <div class="qb-warn">Cette formule ne nécessite pas de piste de bowling.</div>
      `}
    </div>

    <div class="qb-block">
      <div class="blk-label">Notes internes</div>
      <div class="qb-block-help">Visible par le staff uniquement : jamais envoyé au client.</div>
      <textarea class="qb-input qb-textarea" rows="2" oninput="quickBookState.notes=this.value" placeholder="Ex. anniversaire, gâteau à prévoir, paiement à l'arrivée…">${escapeHtml(quickBookState.notes || '')}</textarea>
    </div>
  ` : '';

  overlay.classList.remove('hidden');
  overlay.className = 'qb-overlay';
  overlay.innerHTML = `
    <div class="qb-modal qb-context-${quickBookState.context.source}">
      <div class="qb-head">
        <div>
          <div class="ticket-id">${header.eyebrow}</div>
          <h3>${header.title}</h3>
          ${header.sub ? `<div class="sub">${header.sub}</div>` : ''}
        </div>
        <button class="close-btn" onclick="closeQuickBook()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="qb-body">
        ${contextStripHtml}
        <div class="qb-block">
          ${showClient ? `
          <div class="blk-label">Client</div>
          <div class="qb-row two">
            <div>
              <label class="qb-mini-label">Nom</label>
              <input class="qb-input" value="${escapeHtml(quickBookState.name)}" oninput="quickBookState.name=this.value" placeholder="Marie Dupont">
            </div>
            <div>
              <label class="qb-mini-label">Téléphone</label>
              <input class="qb-input" value="${escapeHtml(quickBookState.phone)}" onfocus="onQuickPhoneFocus()" oninput="onQuickPhoneInput(this.value)" onblur="onQuickPhoneBlur(this)" placeholder="+32 470 00 00 00">
            </div>
          </div>
          <div class="qb-row" style="margin-top:12px;">
            ${emailInputHtml}
          </div>
          ` : !emailValid ? `
          <div class="blk-label">Email client (facultatif)</div>
          <div class="qb-row">
            ${emailInputHtml}
          </div>
          ` : ''}
          ${showType ? `
          <div class="blk-label" ${showClient ? 'style="margin-top:12px;"' : ''}>Activité</div>
          <div class="qb-type-row">
            <button class="qb-type-btn ${quickBookState.type === 'bowling' ? 'active' : ''}" onclick="setQuickType('bowling')">Bowling</button>
            <button class="qb-type-btn ${quickBookState.type === 'laser' ? 'active' : ''}" onclick="setQuickType('laser')">Laser</button>
            <button class="qb-type-btn ${quickBookState.type === 'formule' ? 'active' : ''}" onclick="setQuickType('formule')">Formule</button>
          </div>
          ` : ''}
          <div class="qb-row auto" ${showClient || showType ? 'style="margin-top:12px;"' : ''}>
            ${essentialCells.join('')}
          </div>
          ${durationEssentialHtml}
          ${formuleGridHtml}
          ${essentialActions.length ? `<div class="qb-inline-actions" style="margin-top:12px;">${essentialActions.join('')}</div>` : ''}
          ${statusParts.length ? `<div class="qb-status-line">${statusParts.map(part => `<span>${part}</span>`).join('')}</div>` : ''}
        </div>

        ${warning ? `<div class="qb-warn">${warning}</div>` : ''}
        ${quickBookState.error ? `<div class="qb-warn danger">${quickBookState.error}</div>` : ''}

        <button type="button" class="qb-more-toggle" aria-expanded="${quickBookState.moreOpen ? 'true' : 'false'}" onclick="toggleQuickBookMore()">
          ${quickBookState.moreOpen ? 'Masquer les options avancées' : 'Plus d’options, créneau, pistes, durée, notes'}
        </button>

        ${advancedHtml}

        <div class="qb-summary">
          <div>
            <div class="lbl">Total estimé</div>
            <div class="desc">${summary.detail} - durée estimée ${formatDurationLabel(quickBookState.totalDuration)}</div>
          </div>
          <div class="amt">${summary.total}€</div>
        </div>
      </div>
      <div class="qb-actions">
        <button class="qb-btn-cancel" onclick="closeQuickBook()">Annuler</button>
        <button class="qb-btn-save" onclick="saveQuickBook()">Créer la réservation</button>
      </div>
    </div>
  `;
}

async function saveQuickBook() {
  // Anti double-submit : un seul envoi en vol. Le garde couvre aussi la fenêtre
  // asynchrone (syncDateReservations/POST) : un 2e clic pendant l'envoi est ignoré.
  if (!quickBookState || quickBookState.submitting) return;
  quickBookState.submitting = true;
  quickBookState.error = '';
  const saveBtn = document.querySelector('#quickBookOverlay .qb-btn-save');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.setAttribute('aria-busy', 'true');
    saveBtn.textContent = 'Création…';
  }
  // Contact STAFF libre : on ne bloque pas sur nom/tél/email manquants. Fallback
  // propre pour le payload (nom par défaut « Client » si vide, tél vide autorisé)
  // afin de ne pas casser createReservation. L'email obligatoire reste au CLIENT.
  const name = quickBookState.name.trim() || 'Client';
  const phoneDigits = quickBookState.phone.replace(/\D/g, '');
  const phone = phoneDigits && phoneDigits !== '32' ? normalizePhoneInput(quickBookState.phone) : '';
  const failQuickBook = (message) => {
    // Ré-active le bouton (le re-render reconstruit « Créer la réservation »).
    quickBookState.submitting = false;
    quickBookState.error = message;
    renderQuickBook();
    toast(message);
  };
  const email = quickBookState.email.trim();
  quickBookState.email = email;
  // Seul garde-fou email : un format invalide SI le staff a saisi quelque chose
  // (on évite d'enregistrer une adresse cassée). Un email vide reste accepté.
  if (email && !isValidEmail(email)) { failQuickBook('Adresse email invalide. Format attendu : nom@domaine.com'); return; }
  if (!quickBookState.startTime) { failQuickBook('Choisissez une heure.'); return; }
  const formule = quickBookState.type === 'formule' ? FORMULES.find(x => x.id === quickBookState.formuleId) : null;
  if (quickBookState.type === 'formule' && !formule) { failQuickBook('Sélectionnez une formule.'); return; }

  // Pas d'aller-retour réseau superflu sur le chemin de création : le poll
  // (4 s) garde la date courante fraîche. On ne re-synchronise ici que si la
  // donnée locale est vieille (> 10 s) : le serveur re-valide de toute façon.
  if (!isDateSyncFresh(quickBookState.date)) {
    await syncDateReservations(quickBookState.date, { silent: true, skipRender: true });
  }
  syncQuickBookDuration();
  const duration = Number(quickBookState.duration);
  const totalDuration = Number(quickBookState.totalDuration || duration);
  const slotCheck = validateSlotWindow(quickBookState.date, quickBookState.startTime, totalDuration, {
    allowPastStart: quickBookAllowsPastSelectedTime()
  });
  if (!slotCheck.ok) { failQuickBook(slotCheck.message); return; }
  if (formule) {
    const availability = getFormuleAvailability(formule, quickBookState.date, quickBookState.pax, quickBookState.startTime);
    if (!availability.ok) { failQuickBook(availability.message); return; }
  }
  if (quickBookState.type === 'laser') {
    const laserAvailability = getLaserAvailability(quickBookState.date, quickBookState.startTime, duration, quickBookState.pax);
    if (!laserAvailability.ok) { failQuickBook(laserAvailability.message); return; }
  }

  const needsLanes = reservationNeedsLanes(quickBookState.type, quickBookState.formuleId);
  const requiredCount = getRequiredLaneCount(quickBookState.type, quickBookState.pax, quickBookState.formuleId);
  let lanes = [];
  if (needsLanes) {
    if (quickBookState.autoAssign) lanes = allocateLanes(requiredCount, quickBookState.date, quickBookState.startTime, duration);
    else lanes = [...quickBookState.lanes];
    if (!lanes || lanes.length < requiredCount) { failQuickBook('Il faut ' + requiredCount + ' piste(s) disponibles.'); return; }
    if (lanes.some(l => state.laneStatuses[l] === 'maintenance')) { failQuickBook('Une des pistes choisies est en maintenance.'); return; }
    if (lanesConflict(quickBookState.date, quickBookState.startTime, duration, lanes).length) { failQuickBook('Conflit détecté sur les pistes choisies.'); return; }
  }

  const basePrice = getBasePrice(quickBookState.type, duration, lanes.length, quickBookState.pax, quickBookState.formuleId);
  const reservation = {
    name,
    phone,
    email,
    notes: (quickBookState.notes || '').trim(),
    date: quickBookState.date,
    startTime: quickBookState.startTime,
    duration,
    totalDuration,
    lanes,
    pax: Number(quickBookState.pax),
    status: 'pending',
    basePrice,
    price: basePrice,
    type: quickBookState.type,
    formuleId: quickBookState.formuleId,
    label: formule ? formule.name : quickBookState.type === 'laser' ? 'Laser Game' : 'Bowling Classique',
    laserGames: quickBookState.type === 'laser' ? getLaserGameCount(quickBookState.duration) : 0,
    allowPastStart: quickBookAllowsPastSelectedTime(),
    extras: []
  };

  try {
    const payload = await apiRequest(API_ENDPOINTS.staffReservations, {
      method: 'POST',
      body: JSON.stringify(buildReservationApiPayload(reservation, {
        channel: 'staff',
        laneCount: requiredCount,
        requiresLanes: needsLanes
      }))
    });
    upsertReservationInState(payload.reservation);
    // Protège la création contre un snapshot staff-state parti AVANT le commit
    // serveur et appliqué APRÈS : sans cette entrée, replaceReservationsForDate
    // retirerait la résa fraîchement créée (flicker) jusqu'au poll suivant.
    markReservationMutation(payload.reservation.id, payload.reservation, ['status', 'startTime', 'lanes']);
    save();
    closeQuickBook();
    renderStaff();
    toast('Réservation créée');
  } catch (error) {
    failQuickBook(error.message || 'Impossible de créer la réservation.');
  }
}

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  // msg peut contenir des données client (email, nom), toujours échappé au sink.
  el.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> ${escapeHtml(String(msg ?? ''))}`;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2500);
}

/* ============================================================================
   Notification « nouvelle réservation du jour » : bip + carte, visible même
   avec le planning en plein écran (z-index au-dessus). Déclenchée par le poll
   quand une résa du jour apparaît DEPUIS LE SERVEUR (site public / autre poste) ;
   jamais pour une création locale au comptoir (déjà dans l'état avant le poll).
   ========================================================================== */
let newResAudioCtx = null;

function ensureNewResAudio() {
  if (newResAudioCtx) return newResAudioCtx;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    newResAudioCtx = new Ctx();
  } catch (error) { return null; }
  return newResAudioCtx;
}

// Politique autoplay : le contexte audio ne démarre qu'après un geste utilisateur.
['pointerdown', 'keydown'].forEach(evt => {
  document.addEventListener(evt, () => {
    const ctx = ensureNewResAudio();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  }, { once: true, passive: true });
});

// Petit « ding-dong » synthétisé (aucun fichier son, compatible CSP self).
function playNewResChime() {
  if (state.newResSound === false) return;
  const ctx = ensureNewResAudio();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.16, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
  [[880, 0], [1320, 0.13]].forEach(([freq, offset]) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    osc.connect(gain);
    osc.start(now + offset);
    osc.stop(now + offset + 0.42);
  });
}

function newResNotifRoot() {
  let root = document.getElementById('newResNotifs');
  if (!root) {
    root = document.createElement('div');
    root.id = 'newResNotifs';
    document.body.appendChild(root);
  }
  return root;
}

function toggleNewResSound() {
  state.newResSound = state.newResSound === false;
  save();
  const muted = state.newResSound === false;
  document.querySelectorAll('#newResNotifs .nr-mute').forEach(btn => { btn.textContent = muted ? '🔕' : '🔔'; });
  toast(muted ? 'Son des réservations coupé.' : 'Son des réservations activé.');
}

function dismissNewResNotif(id) {
  const el = document.getElementById(`nr-${id}`);
  if (!el) return;
  el.classList.add('nr-leaving');
  setTimeout(() => el.remove(), 260);
}

function openNewResFromNotif(id) {
  dismissNewResNotif(id);
  if (typeof openStaffReservationDetail === 'function') openStaffReservationDetail(id);
}

function clearNewResNotifs() {
  const root = document.getElementById('newResNotifs');
  if (root) root.innerHTML = '';
}

function notifyNewReservation(reservation) {
  // Verrou : jamais côté client/public, uniquement au poste staff.
  if (state.view !== 'staff') return;
  if (!reservation || reservation.id == null) return;
  const id = reservation.id;
  if (document.getElementById(`nr-${id}`)) return; // déjà affichée
  playNewResChime();
  const name = escapeHtml(reservation.name || 'Client');
  const time = escapeHtml(reservation.startTime || '');
  const label = escapeHtml(typeof getReservationLabel === 'function' ? (getReservationLabel(reservation) || reservation.label || '') : (reservation.label || ''));
  const pax = Number(reservation.pax || 0);
  const muted = state.newResSound === false;
  const card = document.createElement('div');
  card.id = `nr-${id}`;
  card.className = 'nr-card';
  card.setAttribute('role', 'alert');
  card.innerHTML = `
    <button type="button" class="nr-body" onclick="openNewResFromNotif(${staffClientJs(id)})">
      <span class="nr-eyebrow"><span class="nr-dot"></span>Nouvelle réservation</span>
      <strong class="nr-title">${name}</strong>
      <span class="nr-meta">${time ? time + ' · ' : ''}${label}${pax ? ' · ' + pax + ' j.' : ''}</span>
    </button>
    <div class="nr-actions">
      <button type="button" class="nr-mute" title="Activer/couper le son" aria-label="Activer ou couper le son des réservations" onclick="toggleNewResSound()">${muted ? '🔕' : '🔔'}</button>
      <button type="button" class="nr-close" title="Fermer" aria-label="Fermer la notification" onclick="dismissNewResNotif(${staffClientJs(id)})">✕</button>
    </div>`;
  newResNotifRoot().appendChild(card);
  requestAnimationFrame(() => card.classList.add('nr-in'));
  setTimeout(() => dismissNewResNotif(id), 12000);
}

document.addEventListener('input', e => {
  if (e.target.id === 'searchInput') {
    applyStaffSearch(e.target.value);
  }
});

// Vocabulaire FERME. Le code vient du serveur ('formula' | 'bowling' | 'laser_game').
// Le champ reason saisi par le staff n'arrive jamais ici et ne doit jamais y arriver :
// c'est du texte libre qui peut contenir un nom de client.
function formulaDayBlockLabel(dayStatus, formuleId) {
  const code = dayStatus && dayStatus.unavailableFormulaReason ? dayStatus.unavailableFormulaReason[formuleId] : '';
  if (code === 'laser_game') return 'Laser Game fermé ce jour';
  if (code === 'bowling') return 'Bowling fermé ce jour';
  return 'Indisponible à cette date';
}

function getFormuleAvailability(formule, dateStr, pax, startTime = '') {
  const day = parseLocalDate(dateStr).getDay();
  const schedule = getSchedule(dateStr, state.isHolidayMode);
  const totalDuration = getFormuleTotalDuration(formule);
  if (!isOfferEnabled(formule.id)) return { ok: false, message: 'Offre momentanément indisponible' };
  // Verdict serveur du jour. La garde d'egalite de date est portee par
  // getCenterDayStatusFor : cette fonction sert aussi le QuickBook staff, qui
  // travaille sur sa propre date. Sans verdict, comportement historique.
  const dayStatus = typeof getCenterDayStatusFor === 'function' ? getCenterDayStatusFor(dateStr) : null;
  if (dayStatus && Array.isArray(dayStatus.unavailableFormulaIds) && dayStatus.unavailableFormulaIds.includes(formule.id)) {
    return { ok: false, message: formulaDayBlockLabel(dayStatus, formule.id) };
  }
  if (pax < formule.minPax) return { ok: false, message: `Min. ${formule.minPax} personnes` };
  if (formule.noHolidays && isFormulaBlockedDate(dateStr, state.isHolidayMode)) return { ok: false, message: 'Indisponible vacances/fériés' };
  if (formule.validDays && !formule.validDays.includes(day)) return { ok: false, message: 'Indisponible ce jour' };
  if (!schedule) return { ok: false, message: 'Centre fermé ce jour' };
  if (startTime && formule.timeLimit) {
    const start = timeToNum(startTime);
    if (formule.timeLimit.min && start < formule.timeLimit.min) return { ok: false, message: `À partir de ${formule.timeLimit.min}h` };
    if (formule.timeLimit.max && start + totalDuration > formule.timeLimit.max) return { ok: false, message: `Jusqu'à ${formule.timeLimit.max}h` };
  } else {
    let earliest = schedule.open;
    let latest = schedule.close - totalDuration;
    if (formule.timeLimit && formule.timeLimit.min) earliest = Math.max(earliest, formule.timeLimit.min);
    if (formule.timeLimit && formule.timeLimit.max) latest = Math.min(latest, formule.timeLimit.max - totalDuration);
    if (dateStr === todayStr()) earliest = Math.max(earliest, roundUpHalfHour(currentTimeDecimal()));
    if (earliest > latest) return { ok: false, message: 'Aucun créneau possible ce jour' };
  }
  return { ok: true, message: 'Disponible' };
}

function renderFormules() {
  const grid = document.getElementById('formuleGrid');
  const pax = Number(state.booking.pax) || 0;
  const day = parseLocalDate(state.booking.date).getDay();
  const blockedToday = isFormulaBlockedDate(state.booking.date, state.isHolidayMode);
  const daysMap = { 0:'dimanche', 1:'lundi', 2:'mardi', 3:'mercredi', 4:'jeudi', 5:'vendredi', 6:'samedi' };
  const formatDays = arr => {
    if (!arr || !arr.length) return '';
    if (arr.length === 1) return `Uniquement le ${daysMap[arr[0]]}`;
    if (arr.length === 7) return 'Tous les jours';
    const names = arr.map(d => daysMap[d]);
    const last = names.pop();
    return `Dispo : ${names.join(', ')} et ${last}`;
  };
  const formatTime = lim => {
    if (!lim) return '';
    if (lim.min && lim.max) return `De ${lim.min}h à ${lim.max}h`;
    if (lim.max) return `Avant ${lim.max}h`;
    if (lim.min) return `Dès ${lim.min}h`;
    return '';
  };

  // Les offres désactivées par le staff (Établissement) sont masquées côté client.
  // Catalogue override-aware poussé par loadCenterScheduleConfig (prix/nom édités,
  // formules retirées déjà exclues) ; fallback sur FORMULES statique si absent.
  const catalogFormules = Array.isArray(window.__pinlaneDisplayFormules) && window.__pinlaneDisplayFormules.length
    ? window.__pinlaneDisplayFormules
    : FORMULES;
  // Verdict serveur du jour (fermeture ponctuelle, activite bloquee). `day`
  // ci-dessus est le jour de SEMAINE : le verdict s'appelle donc dayStatus.
  const dayStatus = typeof getCenterDayStatusFor === 'function' ? getCenterDayStatusFor(state.booking.date) : null;
  const centerClosed = !getSchedule(state.booking.date, state.isHolidayMode);
  const blockedFormulaIds = dayStatus && Array.isArray(dayStatus.unavailableFormulaIds) ? dayStatus.unavailableFormulaIds : [];
  const processed = catalogFormules.filter(f => isOfferEnabled(f.id)).map(f => {
    const availability = getFormuleAvailability(f, state.booking.date, pax);
    const validDay = !f.validDays || f.validDays.includes(day);
    let status = '';
    let cls = 'ok';
    // Le motif du JOUR prime sur tous les autres : inutile d'annoncer
    // "Min. 12 personnes" quand le centre est ferme.
    if (centerClosed) { status = ''; cls = 'warn'; }
    else if (blockedFormulaIds.includes(f.id)) { status = formulaDayBlockLabel(dayStatus, f.id); cls = 'warn'; }
    else if (!validDay) { status = formatDays(f.validDays); cls = 'warn'; }
    else if (f.noHolidays && blockedToday) { status = 'Indisponible à cette date (vacances/férié)'; cls = 'warn'; }
    else if (pax < f.minPax) { status = `Min. ${f.minPax} personnes (vous : ${pax})`; cls = 'warn'; }
    else if (!availability.ok) { status = availability.message; cls = 'warn'; }
    return { ...f, available: availability.ok, status, cls };
  });

  // Regroupement par famille : les mentions communes à toute la famille sont
  // factorisées une seule fois dans l'en-tête au lieu d'être répétées par carte.
  const families = [];
  processed.forEach(f => {
    const familyName = f.family || 'Formules';
    let group = families.find(g => g.name === familyName);
    if (!group) { group = { name: familyName, items: [] }; families.push(group); }
    group.items.push(f);
  });

  // Ordre d'affichage : les formules réservables à la date choisie d'abord,
  // les indisponibles ensuite (grisées avec leur raison). Idem entre familles.
  families.forEach(group => {
    group.items.sort((left, right) => Number(right.available) - Number(left.available));
  });
  families.sort((left, right) => (
    Number(right.items.some(item => item.available)) - Number(left.items.some(item => item.available))
  ));

  // Date en grandes vacances : les formules « noHolidays » restent ouvertes
  // (exception été) : on l'affiche explicitement pour lever l'ambiguïté.
  const dateContext = getSpecialOpeningContext(state.booking.date, state.isHolidayMode);
  const summerOpen = dateContext.active && dateContext.periodType === 'school_summer' && !blockedToday;

  // Repeter la meme raison sur quinze cartes est du bruit : quand le centre est
  // ferme, une seule phrase en tete et des cartes muettes mais visiblement inertes.
  const closedBanner = centerClosed ? `<div class="formule-group-alert formule-day-alert" role="status">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
    <span>Le centre est fermé le ${escapeHtml(formatBookingDateLong(state.booking.date))} : aucune formule n’est réservable. Choisissez une autre date.</span>
  </div>` : '';

  grid.innerHTML = closedBanner + families.map(group => {
    const sharedNotes = (group.items[0].notes || []).filter(note =>
      group.items.length > 1 && group.items.every(item => (item.notes || []).includes(note)));
    const groupBlocked = blockedToday && group.items.length > 1 && group.items.every(item => item.noHolidays);
    const groupSummerOpen = summerOpen && group.items.length > 1 && group.items.every(item => item.noHolidays);
    return `
    <section class="formule-group">
      <div class="formule-group-head">
        <h3>${group.name}</h3>
        ${sharedNotes.length ? `<p class="formule-group-notes">${sharedNotes.join(' · ')}</p>` : ''}
        ${groupSummerOpen ? '<p class="formule-group-info">Exception grandes vacances : ces formules sont bien disponibles à la date choisie.</p>' : ''}
      </div>
      ${groupBlocked ? `<div class="formule-group-alert" role="status">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <span>Ces formules ne sont pas disponibles à la date choisie (vacances scolaires ou jour férié). Choisissez une autre date pour les réserver.</span>
      </div>` : ''}
      <div class="formule-cards">
        ${group.items.map(f => {
          // Notes propres à la carte, en version compacte (la phrase longue
          // reste réservée à l'en-tête de famille quand elle y est factorisée).
          // Sur la carte, une condition tient en quelques mots : elle ferme la
          // lecture, elle ne concurrence pas le contenu de l'offre.
          const uniqueNotes = (f.notes || [])
            .filter(note => !sharedNotes.includes(note))
            .map(note => String(note)
              // Tolerant aux accents : le catalogue servi ecrit « jours feries »
              // sans accent la ou le socle fichier ecrit « fériés » (vu en prod).
              .replace(/^Non valable durant les vacances scolaires et jours f[ée]ri[ée]s\.?$/i, 'Hors vacances scolaires et fériés')
              .replace(/^Minimum (\d+) personnes$/i, 'Min. $1 pers.')
              .replace(/^Disponible uniquement le /i, 'Uniquement le '));
          // Le motif « vacances/férié » est déjà annoncé une seule fois au
          // niveau de la famille : pas de redite par carte.
          const cardStatus = groupBlocked && f.noHolidays ? '' : f.status;
          // La fenêtre horaire ne s'écrit qu'une fois : si une note ou une
          // ligne de contenu la porte déjà (« Disponible uniquement avant
          // 12h », « De 12h à 17h pour les enfants... »), pas de redite.
          const timeLabel = f.timeLimit ? formatTime(f.timeLimit) : '';
          const timeAlreadySaid = timeLabel && [...uniqueNotes, ...(f.desc || [])]
            .some(line => String(line).toLowerCase().includes(timeLabel.toLowerCase()));
          const meta = [...new Set([
            ...uniqueNotes,
            timeAlreadySaid ? '' : timeLabel
          ].filter(Boolean))]
            // Quand le statut du jour dit déjà « Uniquement le mardi », la même
            // phrase en condition statique juste au-dessus est du bruit.
            .filter(entry => !cardStatus || entry.toLowerCase() !== cardStatus.toLowerCase());
          return `
        <button type="button" data-formule-id="${escapeHtml(f.id)}" class="formule-card ${f.available ? '' : 'disabled'} ${state.booking.formuleId === f.id ? 'active' : ''}" ${f.available ? `onclick="selectFormule('${f.id}')"` : 'disabled aria-disabled="true"'}>
          <span class="formule-card-head">
            <span class="formule-card-title">
              <span class="formule-name">${f.name}</span>
              ${f.best ? '<span class="badge-best">Best deal</span>' : ''}
            </span>
            <span class="formule-card-price">
              ${f.oldPrice ? `<s>${f.oldPrice}€</s>` : ''}
              <strong>${f.price}€</strong>
              <small>/ ${f.type === 'per_lane' ? 'piste' : 'pers.'}</small>
            </span>
          </span>
          <ul class="formule-card-list">
            ${f.desc.map(line => `<li>${line}</li>`).join('')}
          </ul>
          ${meta.length ? `<span class="formule-card-meta">${meta.join(' · ')}</span>` : ''}
          ${cardStatus ? `<span class="formule-card-status ${f.cls}">${f.cls === 'warn' ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="8" y1="8" x2="16" y2="16"/><line x1="16" y1="8" x2="8" y2="16"/></svg>' : ''}${escapeHtml(cardStatus)}</span>` : ''}
          <span class="formule-card-check" aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </span>
        </button>`;
        }).join('')}
      </div>
    </section>`;
  }).join('');
  renderFormulaPreferences();
}

// LES CINQ CHOSES QU'UN GÉRANT CHERCHE AVANT TOUT LE RESTE, dans l'ordre où il
// les cherche quand le client est devant lui : QUI (le nom, c'est le titre),
// QUAND, OÙ, COMBIEN ILS SONT, COMBIEN ÇA FAIT. La ligne d'identité les porte
// toutes les cinq, et elle ne change pas d'un onglet à l'autre : basculer sur
// « Modifier » remplaçait le nom du client par « Modifier la réservation », et
// on perdait de vue le dossier qu'on est en train de modifier.
function getPosIdentityParts(r) {
  const laserWindow = getLaserWindowsFromReservation(r)[0] || null;
  const bowlingWindow = getBowlingWindowsFromReservation(r)[0] || null;
  const window = r.type === 'laser' ? laserWindow : bowlingWindow;
  // La duree se lit dans la fenetre (11:00 - 12:00), mais pas toujours : sur
  // une formule, la fenetre affichee est celle du bowling et la duree du
  // dossier peut differer. Elle est donc ECRITE, collee a l'horaire, pour que
  // la ligne d'identite reste la seule source de ces faits maintenant que le
  // premier bloc de la fiche ne les recopie plus.
  const duree = formatDurationLabel(Number(r.duration) || 0);
  const horaire = window
    ? `${formatClockDisplay(window.start)} - ${formatClockDisplay(window.end)}${duree ? ` (${duree})` : ''}`
    : `${String(r.startTime || '')}${duree ? ` (${duree})` : ''}`;
  const lieu = r.type === 'laser'
    ? 'Laser Game'
    : (r.lanes || []).length ? `Piste${r.lanes.length > 1 ? 's' : ''} ${r.lanes.join(', ')}` : 'Hors piste';
  const parts = [
    `<span class="pos-ref">#${escapeHtml(String(r.id))}</span>`,
    escapeHtml(getReservationLabel(r)),
    escapeHtml(horaire),
    escapeHtml(lieu),
    `${r.pax} joueur${r.pax > 1 ? 's' : ''}`,
  ];
  if (Number(r.price) > 0) parts.push(`${Number(r.price)} €`);
  return parts;
}

// Mémorise l'élément qui avait le focus AVANT l'ouverture, pour le lui rendre à
// la fermeture. Sans ça, fermer la fiche renvoie le focus au début de la page.
let posReturnFocus = null;

// LES ARRETS DE LA TABULATION DANS LA FICHE.
//
// Deux pieges, tous les deux poses par le depliant « Client en retard » :
//   1. `summary` est focusable NATIVEMENT et n'etait dans aucun selecteur : le
//      piege a focus ne le connaissait pas, la tabulation passait dessus et
//      sortait de la fenetre.
//   2. `offsetParent` reste NON NUL pour un controle range dans un depliant
//      ferme (Chromium le masque par content-visibility, pas par display:none).
//      La liste comptait donc quatre boutons que le navigateur, lui, saute :
//      19 tabulations sur 25 s'echappaient de la fenetre.
// On exclut donc explicitement ce qui vit sous un `details` ferme.
function focusablesInPos() {
  const modal = document.querySelector('#posOverlay .edit-modal');
  if (!modal) return [];
  return [...modal.querySelectorAll('button, summary, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((el) => !el.disabled && el.offsetParent !== null && !el.closest('details:not([open])'));
}

// Piège à focus + Échap. La fiche est une fenêtre modale : tabuler dedans ne
// doit pas en sortir vers la page qui est derrière, et Échap doit la fermer.
// Aucun des deux n'existait, alors que les trois autres modales de la console
// (retard, communication, accès staff) les avaient déjà.
function handlePosKeydown(ev) {
  if (!state.selectedRes) return;
  if (ev.key === 'Escape') { ev.stopPropagation(); closePos(); return; }
  if (ev.key !== 'Tab') return;
  const items = focusablesInPos();
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (ev.shiftKey && (active === first || !items.includes(active))) { ev.preventDefault(); last.focus(); }
  else if (!ev.shiftKey && active === last) { ev.preventDefault(); first.focus(); }
}

function renderPos() {
  if (!state.selectedRes) return;
  const r = state.selectedRes;
  const overlay = document.getElementById('posOverlay');
  const wasOpen = !overlay.classList.contains('hidden');
  if (!wasOpen) posReturnFocus = document.activeElement;
  const isEdit = state.activeTab === 'modifier';
  // La référence du dossier vit ICI, et nulle part ailleurs dans l'écran : c'est
  // l'endroit où on la lit quand on a un client au téléphone. C'est
  // l'identifiant réel de la réservation, celui qui est stocké et qui sort dans
  // l'export, pas un code reconstruit à l'affichage.
  const subtitle = getPosIdentityParts(r).join(' • ');
  const bodyHtml = isEdit ? renderPosEdit(r) : renderPosDetails(r);
  overlay.classList.remove('hidden');
  overlay.classList.add('centered');
  overlay.innerHTML = `
    <div class="edit-modal" role="dialog" aria-modal="true" aria-labelledby="posTitle" tabindex="-1">
      <div class="edit-modal-head">
        <div class="edit-modal-ident">
          <h3 id="posTitle">${escapeHtml(r.name)}</h3>
          <p>${subtitle}</p>
        </div>
        <button type="button" class="close-btn" aria-label="Fermer la fiche" onclick="closePos()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <div class="modal-tabs" role="tablist" aria-label="Vues de la fiche">
          <button type="button" role="tab" aria-selected="${!isEdit}" class="tab ${!isEdit ? 'active' : ''}" onclick="setTab('details')">Infos</button>
          <button type="button" role="tab" aria-selected="${isEdit}" class="tab ${isEdit ? 'active' : ''}" onclick="setTab('modifier')">Modifier</button>
        </div>
      </div>
      <div class="edit-modal-body">${bodyHtml}</div>
    </div>
  `;
  if (!overlay.dataset.keyboardBound) {
    overlay.addEventListener('keydown', handlePosKeydown);
    overlay.dataset.keyboardBound = '1';
  }
  // Le focus entre dans la fenêtre, sur l'onglet actif : c'est le premier
  // élément utile, et ça annonce à la synthèse vocale où on vient d'arriver.
  const entry = overlay.querySelector('.modal-tabs .tab.active') || overlay.querySelector('.edit-modal');
  if (entry) entry.focus({ preventScroll: true });
}

// Contact public du centre (téléphone + email) servi par
// /api/public-booking-meta (center.contact), affiché en permanence sous le
// parcours client avec des liens cliquables (tel: / mailto:). Absent => barre
// masquée : fallback discret, jamais de coordonnées inventées.
function renderCenterContact(contact) {
  const bar = document.getElementById('clientContactBar');
  const links = document.getElementById('clientContactLinks');
  if (!bar || !links) return;
  const phone = contact && typeof contact.phone === 'string' ? contact.phone.trim() : '';
  const email = contact && typeof contact.email === 'string' ? contact.email.trim() : '';
  const parts = [];
  if (phone) {
    const telHref = phone.replace(/[^0-9+]/g, '');
    parts.push(`<a class="client-contact-link" href="tel:${escapeHtml(telHref)}"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg><span>${escapeHtml(phone)}</span></a>`);
  }
  if (email) {
    parts.push(`<a class="client-contact-link" href="mailto:${escapeHtml(email)}"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg><span>${escapeHtml(email)}</span></a>`);
  }
  if (!parts.length) {
    bar.hidden = true;
    links.innerHTML = '';
    return;
  }
  links.innerHTML = parts.join('');
  bar.hidden = false;
}

// LES COULEURS DU CENTRE, posees sur <body> a partir de la donnee servie par
// /api/public-booking-meta (center.branding).
//
// Le magenta Fun Galaxy vivait en dur dans assets/pinlane-client.css : tout
// deuxieme client heritait de la marque du premier. Le CSS ne connait plus que
// les jetons `--tenant-*` (defaut = accent plateforme, cf. pinlane.css) ; c'est
// ici, et seulement ici, qu'un centre les reassigne.
//
// Aucune couleur n'est calculee : chaque valeur est declaree par le centre,
// theme par theme, ou absente. Un centre sans marque efface les jetons et
// retombe sur l'accent systeme, jamais sur celui d'un autre client.
//
// Les jetons sont poses sur <html> (pas sur <body>) et memorises par centre :
// c'est le rappel avant peinture de index.html qui les relit au chargement
// suivant, comme il le fait deja pour le theme. Sans cette memoire, le tunnel
// affichait l'accent plateforme pendant ~1 s avant la couleur du centre.
const TENANT_BRANDING_PROPS = [
  ['accent', '--tenant-accent'],
  ['accentStrong', '--tenant-accent-strong'],
  ['accentSoft', '--tenant-accent-soft'],
  ['accentContrast', '--tenant-accent-contrast'],
];
const TENANT_HEX = /^#[0-9a-f]{6}$/i;
const TENANT_BRAND_STORAGE_PREFIX = 'pinlane-brand:';
// Les axes de STYLE du tunnel (miroir de lib/center-config.js, liste blanche
// des deux cotes) : poses en data-attributs sur <html>, consommes par
// pinlane-client.css. Une valeur par defaut ne pose RIEN (defaut plateforme).
const TENANT_STYLE_AXES = {
  radius: ['sharp', 'soft', 'round'],
  font: ['geist', 'humanist', 'serif', 'mono'],
  backdrop: ['plain', 'tint', 'aurora'],
  cards: ['line', 'flat', 'shadow'],
  buttons: ['pill', 'rounded'],
};

function applyCenterBranding(branding, centerId = '') {
  const root = document.documentElement;
  if (!root) return;
  const light = branding && typeof branding === 'object' ? branding : {};
  const dark = light.dark && typeof light.dark === 'object' ? light.dark : {};
  TENANT_BRANDING_PROPS.forEach(([key, prop]) => {
    const lightValue = String(light[key] || '').trim();
    const darkValue = String(dark[key] || '').trim();
    if (TENANT_HEX.test(lightValue)) root.style.setProperty(prop, lightValue);
    else root.style.removeProperty(prop);
    if (TENANT_HEX.test(darkValue)) root.style.setProperty(`${prop}-dark`, darkValue);
    else root.style.removeProperty(`${prop}-dark`);
  });
  // Le style du tunnel : un attribut par axe declare, rien pour les absents.
  Object.entries(TENANT_STYLE_AXES).forEach(([axis, allowed]) => {
    const value = String(light[axis] || '').trim().toLowerCase();
    if (allowed.includes(value)) root.setAttribute(`data-tunnel-${axis}`, value);
    else root.removeAttribute(`data-tunnel-${axis}`);
  });
  // Le THEME force ne s'applique qu'au tunnel pur (client final / iframe) :
  // dans la console, le staff garde SON theme, l'apercu du sien ne se fait
  // pas en douce.
  const forcedTheme = String(light.theme || '').trim().toLowerCase();
  const isPureTunnel = Boolean(document.body && (document.body.classList.contains('customer-mode') || document.body.classList.contains('embed-mode')));
  if (isPureTunnel && (forcedTheme === 'light' || forcedTheme === 'dark')) {
    root.setAttribute('data-theme', forcedTheme);
  }
  // Memoire par centre. En mode demonstration, window.localStorage est deja
  // remplace par une memoire vive (assets/demo-mode.js) : rien ne sort.
  // L'objet memorise porte les couleurs A PLAT (contrat historique de
  // boot-view.js) et, depuis la purge de marque, une cle `identity` que le
  // meme rappel applique au logo, au titre et aux liens.
  const key = String(centerId || '').trim().toLowerCase();
  if (!key) return;
  try {
    const storageKey = `${TENANT_BRAND_STORAGE_PREFIX}${key}`;
    const stored = readTenantBrandMemory(key);
    // Une marque se memorise des qu'elle declare une couleur OU un axe de
    // style : le rappel avant peinture (boot-view.js) rejoue les deux.
    const hasAccent = TENANT_HEX.test(String(light.accent || '').trim());
    const hasStyle = Object.keys(TENANT_STYLE_AXES).some((axis) => TENANT_STYLE_AXES[axis].includes(String(light[axis] || '').trim().toLowerCase()))
      || ['light', 'dark'].includes(String(light.theme || '').trim().toLowerCase());
    const next = (hasAccent || hasStyle)
      ? { ...branding, ...(stored.identity ? { identity: stored.identity } : {}) }
      : (stored.identity ? { identity: stored.identity } : null);
    if (next) window.localStorage.setItem(storageKey, JSON.stringify(next));
    else window.localStorage.removeItem(storageKey);
  } catch (error) {
    // Stockage refuse (navigation privee stricte) : la couleur reste correcte
    // pour cette page, seul le rappel avant peinture est perdu.
  }
}

function readTenantBrandMemory(key) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(`${TENANT_BRAND_STORAGE_PREFIX}${key}`) || 'null');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    return {};
  }
}

// L'IDENTITE du centre sur le tunnel : nom d'onglet, logo, liens du site,
// ville du sous-titre. index.html est NEUTRE (aucune identite de client dans
// le HTML statique) : tout part de la donnee center.identity servie par
// /api/public-booking-meta, exactement comme les couleurs juste au-dessus.
// Un centre sans identite garde le tunnel neutre Pinlane ; il n'herite jamais
// du logo ou des liens d'un autre client. Memoire par centre pour le rappel
// avant peinture (boot-view.js), effacee des que le serveur ne declare plus
// d'identite.
const TENANT_IDENTITY_MAX_LINKS = 6;
const TENANT_LOGO_URL = /^(?:https:\/\/[^\s"'<>]+|\.?\/?assets\/[a-z0-9_/.-]+)$/i;
const TENANT_SITE_URL = /^https:\/\/[^\s"'<>]+$/i;

function sanitizeTunnelIdentity(center) {
  const identity = center && typeof center.identity === 'object' && center.identity ? center.identity : {};
  const name = center && typeof center.name === 'string' ? center.name.trim().slice(0, 120) : '';
  const city = center && typeof center.city === 'string' ? center.city.trim().slice(0, 80) : '';
  const rawLogo = String(identity.logoUrl || '').trim();
  const logoUrl = rawLogo.length <= 300 && TENANT_LOGO_URL.test(rawLogo) ? rawLogo : '';
  const siteLinks = (Array.isArray(identity.siteLinks) ? identity.siteLinks : [])
    .map(link => ({
      label: String((link && link.label) || '').trim().slice(0, 40),
      url: String((link && link.url) || '').trim(),
    }))
    .filter(link => link.label && link.url.length <= 300 && TENANT_SITE_URL.test(link.url))
    .slice(0, TENANT_IDENTITY_MAX_LINKS);
  if (!name && !city && !logoUrl && !siteLinks.length) return null;
  return {
    name,
    city,
    logoUrl,
    logoOnDark: Boolean(logoUrl && identity.logoOnDark === true),
    siteLinks,
  };
}

function renderTunnelIdentity(identity) {
  const safe = identity || { name: '', city: '', logoUrl: '', logoOnDark: false, siteLinks: [] };
  const logo = document.getElementById('centerLogo');
  const wordmark = document.getElementById('centerWordmark');
  if (logo && wordmark) {
    if (safe.logoUrl) {
      logo.src = safe.logoUrl;
      logo.alt = safe.name || 'Logo du centre';
      logo.hidden = false;
      wordmark.hidden = true;
      wordmark.textContent = '';
    } else {
      logo.removeAttribute('src');
      logo.alt = '';
      logo.hidden = true;
      wordmark.textContent = safe.name || '';
      wordmark.hidden = !safe.name;
    }
    const wrap = logo.closest('.logo-wrap');
    if (wrap) wrap.classList.toggle('logo-on-dark', Boolean(safe.logoOnDark));
  }
  const nav = document.getElementById('nav');
  if (nav) {
    nav.textContent = '';
    (safe.siteLinks || []).forEach(link => {
      const anchor = document.createElement('a');
      anchor.className = 'nav-link';
      anchor.href = link.url;
      anchor.target = '_blank';
      anchor.rel = 'noopener';
      anchor.textContent = link.label;
      nav.appendChild(anchor);
    });
  }
  const hero = document.getElementById('heroSubtitle');
  if (hero) {
    hero.textContent = safe.city
      ? `À ${safe.city} : le jour, votre groupe, le reste suit.`
      : 'Le jour et votre groupe : le reste suit.';
  }
  // Le titre d'onglet ne porte une identite que sur le TUNNEL (mode client pur
  // ou centre explicite dans l'URL) : la console garde son titre neutre.
  const isTunnel = Boolean(document.body && document.body.classList.contains('customer-mode'))
    || Boolean(typeof getUrlCenterId === 'function' && getUrlCenterId());
  if (isTunnel) document.title = safe.name ? `${safe.name} · Réservation` : 'Pinlane';
}

function applyCenterIdentity(center, centerId = '') {
  const identity = sanitizeTunnelIdentity(center);
  renderTunnelIdentity(identity);
  const key = String(centerId || '').trim().toLowerCase();
  if (!key) return;
  try {
    const storageKey = `${TENANT_BRAND_STORAGE_PREFIX}${key}`;
    const stored = readTenantBrandMemory(key);
    if (identity) stored.identity = identity;
    else delete stored.identity;
    if (Object.keys(stored).length) window.localStorage.setItem(storageKey, JSON.stringify(stored));
    else window.localStorage.removeItem(storageKey);
  } catch (error) {
    // Stockage refuse : l'identite reste correcte pour cette page, seul le
    // rappel avant peinture est perdu.
  }
}

// Recupere la config publique du centre (horaires staff, vacances/feries,
// offres activees) et la pousse dans booking-core pour que l'affichage client
// (hint "Ouvert...", formules) reflete la meme verite que le serveur.
// Fail-soft : sans reponse, la grille locale historique reste utilisee.
async function loadCenterScheduleConfig(dateOverride = '') {
  const wanted = String(dateOverride || state.booking.date || '');
  const dateParam = /^\d{4}-\d{2}-\d{2}$/.test(wanted) ? `&date=${encodeURIComponent(wanted)}` : '';
  if (dateParam && typeof setCenterDayPending === 'function') {
    setCenterDayPending(wanted);
    // Repeint DANS LE MEME TICK : au boot, initClient a deja ecrit "Ouvert ..."
    // avant que la requete parte. Sans ce repaint, un centre ferme aujourd'hui
    // afficherait un faux "Ouvert" jusqu'a la reponse du serveur.
    if (state.view === 'client') updateSchedHint();
  }
  try {
    const centerKey = String(typeof getTunnelCenterId === 'function' ? getTunnelCenterId() : 'libramont');
    const payload = await apiRequest(`${API_ENDPOINTS.publicBookingMeta || '/api/public-booking-meta'}?centerId=${encodeURIComponent(centerKey)}${dateParam}`, { method: 'GET' });
    // payload.formules est deja override-aware (prix/nom edites appliques,
    // formules retirees exclues). On l'expose pour que renderFormules affiche au
    // tunnel de resa staff la MEME chose que le catalogue public (fix d'affichage).
    // Fallback sur la constante FORMULES statique si absent, pour ne rien casser.
    if (Array.isArray(payload?.formules)) {
      window.__pinlaneDisplayFormules = payload.formules;
    }
    // Ce que CE centre vend. Sans cette liste, le tunnel ne propose que bowling
    // et laser : exactement le formulaire d'avant, jamais une page vide.
    if (Array.isArray(payload?.activities) && typeof setCenterActivities === 'function') {
      setCenterActivities(payload.activities);
    }
    if (payload?.center && typeof setCenterScheduleConfig === 'function') {
      setCenterScheduleConfig(payload.center);
    }
    // La marque du centre : posee des que le serveur a repondu, effacee si ce
    // centre n'en declare pas (retour a l'accent plateforme).
    applyCenterBranding(payload?.center?.branding || null, centerKey);
    // L'identite du centre (logo, titre, liens, ville) : meme voie, meme
    // moment. Sans donnee, le tunnel reste neutre Pinlane.
    applyCenterIdentity(payload?.center || null, centerKey);
    // Anti-course : une reponse pour une date que l'utilisateur a deja quittee
    // est jetee. Sans `day` dans le payload, on efface : mieux vaut le rendu
    // historique qu'un verdict perime.
    if (typeof setCenterDayStatus === 'function') {
      const day = payload?.center?.day || null;
      setCenterDayStatus(day && day.date === state.booking.date ? day : null, centerKey);
    }
    if (payload?.center) {
      renderCenterContact(payload.center.contact || null);
    }
    if (state.view === 'client' && (payload?.center || Array.isArray(payload?.formules))) {
      updateSchedHint();
      syncBookingTypeUi();
      renderFormules();
      // La config (capacite pistes/joueurs) arrive en async : re-render le cadre
      // pax pour qu'il reflete la vraie capacite au lieu des constantes de repli.
      if (typeof updatePaxAlert === 'function') updatePaxAlert();
    }
  } catch (error) {
    // Grille locale conservee.
  } finally {
    // Toujours relacher l'attente : une panne reseau ne doit pas figer le
    // parcours sur "Vérification des horaires...".
    if (dateParam && typeof clearCenterDayPending === 'function') clearCenterDayPending(wanted);
    if (state.view === 'client') updateSchedHint();
  }
}

// Mode client pur : entrée /reserver destinée aux clients finaux. Force la vue
// client et masque toute commande staff (switch de vue, Déconnexion, Accès SaaS)
// via la classe body.customer-mode. Le flag est mémorisé pour la durée de
// l'onglet (sessionStorage) afin de survivre aux changements de hash internes
// sans jamais « fuiter » vers l'usage staff normal (/ ou #staff) dans une autre
// session/onglet.
function detectCustomerMode() {
  let path = '';
  try { path = String(window.location.pathname || '').toLowerCase().replace(/\/+$/, ''); } catch (e) { path = ''; }
  // Une session staff annule le mode client pur. Depuis que la vue client a son
  // adresse a elle (/reserver), un membre du staff qui clique « Réserver » y
  // arrive aussi : le verrouiller en mode client lui retirerait les bascules de
  // vue pour tout l'onglet, sans moyen de revenir au staff.
  if (typeof hasSavedAuth === 'function' && hasSavedAuth()) {
    try { sessionStorage.removeItem('pinlane-customer-mode'); } catch (e) {}
    return false;
  }
  if (path === '/reserver' || path.startsWith('/reserver/')) {
    try { sessionStorage.setItem('pinlane-customer-mode', '1'); } catch (e) {}
    return true;
  }
  try { return sessionStorage.getItem('pinlane-customer-mode') === '1'; } catch (e) { return false; }
}

async function bootstrapApp() {
  isAuthenticated = hasSavedAuth();
  const customerMode = detectCustomerMode();
  if (customerMode) document.body.classList.add('customer-mode');
  applyInitialRouteFromHash();
  if (customerMode) state.view = 'client';
  initClient();
  loadCenterScheduleConfig();
  // LA VUE EST POSEE AVANT LE RESEAU. setView() vivait apres le controle de
  // session et deux synchros : la console mettait 1 a 2 s a remplacer le
  // parcours de reservation a l'ecran. La vue client/staff ne depend d'aucune
  // reponse serveur, on l'applique donc tout de suite. Seule la vue DIRECTION
  // attend, parce qu'elle seule se decide sur les permissions (canOpenAdminView)
  // et qu'un rendu optimiste retomberait sur staff avec un toast de refus.
  if (state.view !== 'admin') setView(state.view);
  if (isAuthenticated) {
    await loadStaffAuthSession({ silent: true });
    await syncDateReservations(state.booking.date, { silent: true, skipRender: true });
    if (state.currentDate !== state.booking.date) {
      await syncDateReservations(state.currentDate, { silent: true, skipRender: true });
    }
  }
  setView(state.view);
  applyAuthState();
  scheduleRemoteSync();
}

bootstrapApp();

// LE FILET POST-CHARGEMENT (bug « la page reste noire, on recharge »,
// 2026-08-06). La vue est appliquee AVANT les attentes reseau (anti-flash) :
// renderStaff peut donc tourner pendant que les scripts defer suivants
// (staff-pages-v2, founder-*) se parsent encore, et la page active est alors
// sautee par les gardes du dispatcher. Quand TOUT est charge, on re-rend UNE
// fois la vue active : la page se remplit sans que personne ne recharge.
window.addEventListener('load', () => {
  try {
    if (state.view === 'staff') renderStaff();
    else if (state.view === 'admin' && typeof renderAdmin === 'function') renderAdmin();
  } catch (error) { /* un filet ne casse jamais le demarrage */ }
});

// LE DETECTEUR DE MISE A JOUR (2026-08-07). La console est une app d'une
// seule page : un onglet laisse ouvert ne recharge JAMAIS ses fichiers, et
// le gerant peut tester pendant des heures une version perimee en croyant
// que rien n'est corrige (verifie : les bundles de prod passaient les tests
// pendant que l'onglet servait l'ancienne version). Au retour sur l'onglet
// et toutes les 4 minutes, on compare la version des assets de CE chargement
// a celle que le serveur sert MAINTENANT : si elles different, un bandeau
// propose de recharger. Jamais de rechargement force : une frappe en cours
// ne se perd pas.
(function watchAppVersion() {
  const rx = /staff-pages-v2\.js\?v=([0-9a-z-]+)/;
  const script = document.querySelector('script[src*="staff-pages-v2.js"]');
  const mine = script ? (String(script.src).match(rx) || [])[1] : '';
  // Marqueur d'armement + controle exposee : le gate appelle le controle
  // directement (pas de dependance aux evenements du harnais headless).
  window.__plUpdateWatch = mine || 'sans-version';
  if (!mine) return;
  let shown = false;
  let checking = false;
  const check = async () => {
    if (shown || checking || document.hidden) return;
    checking = true;
    try {
      // TOUJOURS la racine : l'app reecrit son URL (/reserver, /#/staff/...)
      // et interroger le chemin courant renvoyait autre chose que l'index.
      const response = await fetch(`/?plv=${Date.now()}`, { cache: 'no-store' });
      const html = await response.text();
      const served = (html.match(rx) || [])[1] || '';
      // Trace de diagnostic (lisible en console prod : window.__plUpdateLast).
      window.__plUpdateLast = { mine, served, at: new Date().toISOString() };
      if (served && served !== mine) {
        shown = true;
        const bar = document.createElement('div');
        bar.id = 'plUpdateBar';
        bar.setAttribute('role', 'status');
        bar.innerHTML = `<span>Une mise à jour de la console est prête.</span>
          <button type="button" onclick="window.location.reload()">Recharger</button>`;
        document.body.appendChild(bar);
      }
    } catch (error) {
      window.__plUpdateLast = { mine, error: String(error), at: new Date().toISOString() };
    } finally {
      checking = false;
    }
  };
  window.__plUpdateCheck = check;
  window.addEventListener('focus', check);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  setInterval(check, 240000);
  setTimeout(check, 20000);
})();

// Fraîcheur multi-postes sobre : au retour sur l'onglet (changement de poste,
// réveil de tablette), une synchro différentielle immédiate au lieu d'attendre
// le prochain tick du poll. Coût quasi nul : If-None-Match => 304 vide si rien
// n'a changé côté serveur.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if ((state.view === 'staff' || state.view === 'admin') && hasSavedAuth()) {
    syncDateReservations(state.currentDate, { silent: true });
  }
});

function applyInitialRouteFromHash() {
  // Le CHEMIN prime sur le hash : /reserver est l'adresse de la vue client, quel
  // que soit l'etat sauvegarde ou un hash staff herite d'une session precedente.
  if (getCurrentPathname().toLowerCase() === CLIENT_ROUTE_PATH) {
    state.view = 'client';
    return;
  }
  const rawHash = String(window.location.hash || '').replace(/^#\/?/, '').trim().toLowerCase();
  if (!rawHash) return;
  const [view, page, resource] = rawHash.split('/').filter(Boolean);
  const staffPageAliases = {
    lasergame: 'laserGame',
    'laser-game': 'laserGame',
    tariffs: 'prices',
    tarifs: 'prices'
  };
  const normalizedPage = staffPageAliases[page] || page;
  if (['client', 'staff', 'admin'].includes(view)) state.view = view;
  if (view === 'staff') {
    // Source de verite UNIQUE : STAFF_MENU_PAGES (la meme que normalizeStaffMenuPage).
    // Une liste blanche dupliquee vivait ici et avait deja diverge : les 4 pages
    // de la categorie Plateforme (cockpit, cockpit-agents, cockpit-incidents,
    // cockpit-clients) y manquaient, donc un deep-link/bookmark vers
    // #/staff/cockpit-incidents retombait sur planning. On ne redonne jamais
    // deux listes a maintenir en parallele.
    if (typeof STAFF_MENU_PAGES !== 'undefined' && STAFF_MENU_PAGES.includes(normalizedPage)) state.staffMenuPage = normalizedPage;
    if (['all', 'bowling', 'laser'].includes(resource || normalizedPage)) state.staffResourceView = resource || normalizedPage;
  }
  if (view === 'admin') {
    // « clients » (onglet retiré : doublon du CRM v2) retombe sur la vue période.
    const adminPageAliases = { period: 'overview', clients: 'overview' };
    const normalizedAdminTab = adminPageAliases[page] || page;
    // 'journal' n'est plus un onglet Direction : un vieux lien #/admin/journal
    // retombe sur la synthese, et le journal se lit dans Plateforme > Journal.
    const allowedAdminTabs = ['overview', 'data', 'mail', 'reservations', 'ops', 'exports'];
    if (allowedAdminTabs.includes(normalizedAdminTab)) state.adminTab = normalizedAdminTab;
  }
  // A1 : deep-link #admin/... refusé à un rôle connecté sans direction.view 
  // même refus que setView, retombée sur la vue staff.
  if (state.view === 'admin' && !canOpenAdminView()) {
    state.view = 'staff';
    toast('Accès non autorisé pour ce rôle.');
  }
  // En mode client pur, aucune bascule staff/admin possible (même via #staff).
  if (document.body.classList.contains('customer-mode')) state.view = 'client';
}

window.addEventListener('hashchange', syncRouteFromHash);
window.addEventListener('popstate', syncRouteFromHash);

document.getElementById('posOverlay').addEventListener('click', e => {
  if (e.target.id === 'posOverlay') closePos();
});

document.getElementById('delayOverlay').addEventListener('click', e => {
  if (e.target.id === 'delayOverlay') closeDelayModal();
});
document.getElementById('quickBookOverlay').addEventListener('click', e => {
  if (e.target.id === 'quickBookOverlay') closeQuickBook();
});
document.getElementById('crOverlay')?.addEventListener('click', e => {
  if (e.target.id === 'crOverlay') closeStaffCustomRequest();
});

setInterval(() => {
  if (state.view === 'staff') {
    renderPlanning();
    renderLaserPlanning();
  }
}, 60000);

// Échap ferme le mode plein écran du planning (bowling ou laser).
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  const crOverlay = document.getElementById('crOverlay');
  if (crOverlay && !crOverlay.classList.contains('hidden')) {
    closeStaffCustomRequest();
    event.preventDefault();
    return;
  }
  if (delayFlowState) {
    closeDelayModal();
    event.preventDefault();
    return;
  }
  if (state.view !== 'staff') return;
  if (collapseStaffPlanningFullscreen()) {
    event.preventDefault();
  }
});

/* ==========================================================================
   MODE EMBARQUE : la hauteur remonte au site du client.
   ==========================================================================
   Quand le parcours tourne dans l'iframe d'un client (embed.js pose ?embed=1),
   le site hote ne peut PAS mesurer notre contenu : une iframe est opaque. Sans
   ce message, le client choisit une hauteur fixe et se retrouve avec un
   ascenseur interne sur les etapes longues, ou un trou blanc sur les courtes.
   On poste donc la hauteur reelle a chaque changement (etape suivante, message
   d'erreur, liste de creneaux qui se remplit).
   Regles : rien ne part hors mode embarque, le message est cible sur l'origine
   du PARENT (jamais '*' : ca diffuserait la taille de notre contenu a tout site
   capable de nous encadrer), et l'observation s'arrete si le navigateur n'a pas
   ResizeObserver (repli sur les evenements de redimensionnement). */
(function () {
  'use strict';
  if (typeof window === 'undefined' || window.parent === window) return;
  var params;
  try { params = new URLSearchParams(window.location.search); } catch (error) { return; }
  if (params.get('embed') !== '1') return;

  // La scene sait qu'elle vit dans un cadre : pas de header, un plancher de
  // hauteur (CSS body.client-mode.embed-mode) que le postMessage ci-dessous
  // fait respecter au parent.
  var markEmbed = function () { if (document.body) document.body.classList.add('embed-mode'); };
  if (document.body) markEmbed();
  else document.addEventListener('DOMContentLoaded', markEmbed, { once: true });

  // L'origine du parent n'est pas lisible (cross-origin) : le referrer la
  // donne, et il est pose par le navigateur, pas par la page hote.
  var parentOrigin = '';
  try { parentOrigin = document.referrer ? new URL(document.referrer).origin : ''; } catch (error) { parentOrigin = ''; }
  if (!parentOrigin) return;

  var last = 0;
  function post() {
    var body = document.body;
    var doc = document.documentElement;
    if (!body || !doc) return;
    var height = Math.max(body.scrollHeight, body.offsetHeight, doc.scrollHeight, doc.offsetHeight);
    if (!height || Math.abs(height - last) < 8) return; // hysteresis : pas de flot de messages au pixel pres
    last = height;
    try { window.parent.postMessage({ type: 'pinlane:height', height: height }, parentOrigin); } catch (error) { /* parent parti */ }
  }

  if (typeof ResizeObserver === 'function') {
    var observer = new ResizeObserver(post);
    if (document.body) observer.observe(document.body);
    else document.addEventListener('DOMContentLoaded', function () { observer.observe(document.body); });
  } else {
    window.addEventListener('resize', post, { passive: true });
    setInterval(post, 800);
  }
  document.addEventListener('DOMContentLoaded', post);
  window.addEventListener('load', post);
}());

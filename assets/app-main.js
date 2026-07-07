// Booking domain constants and planning helpers live in ./assets/booking-core.js.
let laserDragActive = false;
let laserDragScrollRaf = null;
let laserDragLastY = 0;
let laserPointerDrag = null;
let laserDragDropTarget = null;
let laserDragSuppressClickUntil = 0;
let bowlingPointerDrag = null;
let bowlingDragDropTarget = null;
let bowlingDragPreviewEls = [];
let bowlingDragSuppressClickUntil = 0;
let bowlingDragSaveSeq = 0;
const bowlingDragLatestSeqByReservation = {};
let statusSaveSeq = 0;
const statusSaveLatestSeqByReservation = {};
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
  if (activeWrap && activeWrap.scrollHeight > activeWrap.clientHeight) {
    activeWrap.scrollTop += deltaY;
    return;
  }
  const scroller = document.scrollingElement || document.documentElement;
  if (!scroller) return;
  scroller.scrollTop += deltaY;
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
  setLaserDragDropTarget(getLaserDropTargetFromPoint(event.clientX, event.clientY));
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
  const target = getLaserDropTargetFromPoint(event.clientX, event.clientY) || laserDragDropTarget;
  clearLaserDragDropTarget();
  if (!target) {
    showPlanningMoveNotice('Aucun lancement choisi', 'Deposez la carte sur une ligne Laser Game disponible.', 'warning');
    return;
  }
  const targetStart = Number(target.dataset.laserDropStart);
  const targetEnd = target.dataset.laserDropEnd ? Number(target.dataset.laserDropEnd) : null;
  scheduleLaserPass(drag.reservationId, drag.passIndex, targetStart, targetEnd);
}

function startLaserPassPointerDrag(event, reservationId, passIndex) {
  if (event.button !== 0) return;
  event.stopPropagation();
  laserPointerDrag = {
    reservationId,
    passIndex,
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
    showPlanningMoveNotice('Deplacement impossible', slotCheck.message || 'Ce creneau ne peut pas etre utilise.', 'warning');
    return;
  }
  const lanes = getTargetBowlingLanes(requiredCount, targetLane, reservation.date, startTime, duration, reservation.id, currentLanes, sourceLane, splitLane);
  if (!lanes || lanes.length < requiredCount) {
    showPlanningMoveNotice(
      'Conflit de pistes',
      `Il faut ${requiredCount} piste${requiredCount > 1 ? 's' : ''} libre${requiredCount > 1 ? 's' : ''} sur ce creneau.`,
      'warning'
    );
    return;
  }
  const movedOpsPlan = moveBowlingOpsPlan(reservation, targetStart, lanes, duration);
  if (lanesConflict(reservation.date, startTime, duration, lanes, reservation.id, movedOpsPlan).length) {
    showPlanningMoveNotice('Conflit detecte', 'Une autre reservation occupe deja cette piste ou cet horaire.', 'warning');
    return;
  }
  const shouldMoveReservationStart = reservation.type === 'bowling' || !Array.isArray(reservation.opsPlan?.resourceBlocks);
  const updated = {
    ...reservation,
    startTime: shouldMoveReservationStart ? startTime : reservation.startTime,
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
    toast(`Bowling déplacé à ${formatClockDisplay(Number(targetStart))} piste${lanes.length > 1 ? 's' : ''} ${lanes.join(', ')}`);
  } catch (error) {
    if (!isLatestRequest()) return;
    applyOptimisticReservation(previous, { preserveEditState: true });
    clearReservationMutation(requestKey);
    showPlanningMoveNotice('Deplacement annule', error.message || 'Le serveur a refuse ce placement.', 'warning');
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
    showPlanningMoveNotice('Aucun creneau choisi', 'Deposez la carte sur une cellule piste/heure disponible.', 'warning');
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

function onLaserPassDragStart(event, reservationId, passIndex) {
  event.stopPropagation();
  event.dataTransfer.setData('text/plain', JSON.stringify({ type: 'laser-pass', reservationId, passIndex }));
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
    scheduleLaserPass(data.reservationId, data.passIndex, Number(targetStart), targetEnd === null ? null : Number(targetEnd));
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
    // demande avec une session laser existante compatible — capacité libre et
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
let staffMarketingAgentsCache = {
  loaded: false,
  loading: false,
  running: false,
  error: '',
  status: null,
  lastLoadedAt: ''
};
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

function replaceReservationsForDate(dateStr, reservations) {
  const others = state.reservations.filter(r => r.date !== dateStr);
  const serverList = reservations || [];
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
// d'attendre le bouton « Actualiser » — indispensable pour les suppressions,
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
    centerId: overrides.centerId || reservation.centerId || reservation.center_id || getCurrentStaffCenterId(),
    laneCount,
    requiresLanes,
    channel,
    allowPastStart: channel === 'staff' && Boolean(overrides.allowPastStart ?? reservation.allowPastStart)
  };
}

function getCurrentStaffReservationsForUi() {
  return todaysReservations().map(r => ({
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
    updatedAt: r.updatedAt || ''
  }));
}

function getStaffDataSignature(dateStr = state.currentDate) {
  const reservations = dateStr === state.currentDate
    ? getCurrentStaffReservationsForUi()
    : state.reservations
        .filter(r => r.date === dateStr && r.status !== 'cancelled')
        .map(r => ({
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
          updatedAt: r.updatedAt || ''
        }));
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
  const bowlingReservations = dayReservations.filter(r => getBowlingWindowsFromReservation(r).length > 0);
  const laserReservations = dayReservations.filter(r => getLaserWindowsFromReservation(r).length > 0);
  document.getElementById('staffTabAll')?.classList.toggle('active', view === 'all');
  document.getElementById('staffTabBowling')?.classList.toggle('active', view === 'bowling');
  document.getElementById('staffTabLaser')?.classList.toggle('active', view === 'laser');
  const allCountEl = document.getElementById('staffAllCount');
  const bowlingCountEl = document.getElementById('staffBowlingCount');
  const laserCountEl = document.getElementById('staffLaserCount');
  if (allCountEl) allCountEl.textContent = dayReservations.length;
  if (bowlingCountEl) bowlingCountEl.textContent = bowlingReservations.length;
  if (laserCountEl) laserCountEl.textContent = laserReservations.length;
  document.getElementById('planningBox')?.classList.toggle('hidden', view === 'laser');
  document.getElementById('laserPlanningBox')?.classList.toggle('hidden', view === 'bowling');
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
  return fallback;
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
}

function markRemoteSyncFailure(error) {
  remoteSyncFailureCount += 1;
  remoteSyncLastFailure = getRemoteSyncErrorMessage(error);
  if (isStaticApiFailure(error)) {
    remoteSyncPausedUntil = Date.now() + 5 * 60 * 1000;
    return;
  }
  if (remoteSyncFailureCount >= 3) {
    remoteSyncPausedUntil = Date.now() + Math.min(2 * 60 * 1000, 15000 * remoteSyncFailureCount);
  }
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
  const labels = {
    request_received: 'Demande reçue',
    confirmation: 'Confirmation client',
    reminder_48h: 'Rappel 48h',
    staff_review_request: 'Validation staff',
    staff_alert: 'Alerte staff'
  };
  return labels[templateId] || templateId || 'Message';
}

function getAdminCenters() {
  return adminDashboardCache.knowledge?.centers?.length ? adminDashboardCache.knowledge.centers : ADMIN_CENTER_FALLBACKS;
}

function getAdminCenter(centerId = state.adminCenterId) {
  return getAdminCenters().find(center => center.id === centerId) || ADMIN_CENTER_FALLBACKS[0];
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
    staffRevisionByDate[revisionKey] = nextRevision;
    staffSyncAtByDate[revisionKey] = Date.now();
    replaceReservationsForDate(dateStr, payload.reservations || []);
    if (payload.laneStatuses) state.laneStatuses = payload.laneStatuses;
    hydrateSelectedReservation();
    save();
    if (!opts.skipRender && changed && state.view === 'staff' && state.currentDate === dateStr) {
      const afterData = getStaffDataSignature(dateStr);
      if (beforeData !== afterData) renderStaffData();
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
    // Le mode client (parcours public) n'a pas de session staff : il ne doit
    // PAS interroger les endpoints protégés (staff-state → 401). Ses créneaux
    // sont chargés à la demande via public-availability. On arrête donc la
    // boucle de sync ; setView() la relance quand on passe en staff/admin.
    if (state.view === 'client') return;
    if ((state.view === 'staff' || state.view === 'admin') && !hasSavedAuth()) {
      scheduleRemoteSync();
      return;
    }
    if (state.view === 'admin') await loadAdminDashboard(true);
    else await syncDateReservations(state.currentDate, { silent: true });
    scheduleRemoteSync();
  }, delay);
}

function loadState() {
  try {
    const storedState = window.PinlaneStorage?.getJson
      ? window.PinlaneStorage.getJson(STORAGE_KEY, null)
      : JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (storedState) return storedState;
  } catch (error) {}
  const today = todayStr();
  return {
    view: 'client',
    reservations: [
      { id: 1042, name:'Sophie Renard', phone:'0470 111 222', email:'', date: today, startTime:'14:00', duration:1, lanes:[1,2], status:'paid', pax:6, price:78, basePrice:78, type:'bowling', label:'Bowling Classique', paymentMethod:'Carte Bancaire', extras:[] },
      { id: 1043, name:'Marc Dubois', phone:'0470 333 444', email:'', date: today, startTime:'16:00', duration:2, lanes:[3,4], status:'paid', pax:8, price:156, basePrice:156, type:'bowling', label:'Bowling Classique', paymentMethod:'Espèces', extras:[] },
      { id: 1044, name:'Laura Petit', phone:'0470 555 666', email:'', date: today, startTime:'19:00', duration:1, lanes:[5,6], status:'pending', pax:4, price:78, basePrice:78, type:'bowling', label:'Bowling Classique', extras:[] },
      { id: 1045, name:'Equipe Delta', phone:'0471 987 654', email:'', date: today, startTime:'20:00', duration:2, lanes:[7,8], status:'arrived', pax:10, price:156, basePrice:156, type:'bowling', label:'Bowling Classique', extras:[] },
    ],
    laneStatuses: Array.from({ length: TOTAL_LANES }).reduce((acc, _, i) => ({ ...acc, [i + 1]: 'active' }), {}),
    isHolidayMode: false,
    currentDate: today,
    searchTerm: '',
    step: 1,
    booking: {
      name:'', phone:'', email:'', pax:4,
      date: today,
      type:'bowling', formuleId:'', duration:1, totalDuration:1, laneCount:1, startTime:'',
      allocatedLanes: [],
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
    opsPanelTab: 'communications',
    adminCenterId: 'libramont',
    adminDate: today,
    adminPeriod: 'day',
    adminTab: 'overview',
    adminCockpitMode: 'today',
    staffPricingFilter: 'all',
    staffPricingQuery: '',
    staffPricingSelectedId: '',
    staffEmailFilter: 'all',
    staffEmailQuery: '',
    staffEmailTemplateFilter: 'all',
    staffEmailSelectedId: '',
    staffCampaignObjective: 'anniversaires',
    staffCampaignChannel: 'linkedin',
    staffCampaignSelectedId: '',
    staffCampaignBrief: '',
    staffCampaignDraft: null,
    marketingCampaigns: [],
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
let bookingSubmitBusy = false;
const STAFF_MENU_PAGES = [
  'dashboard',
  'planning',
  'reservations',
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
  'settings'
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
state.opsPanelTab = state.opsPanelTab || 'communications';
state.adminCenterId = state.adminCenterId || 'libramont';
state.adminDate = state.adminDate || todayStr();
state.adminPeriod = ['day', 'week', 'month', 'year'].includes(state.adminPeriod) ? state.adminPeriod : 'day';
state.adminTab = state.adminTab || 'overview';
state.adminCockpitMode = ['today', 'bowling', 'laser', 'direction'].includes(state.adminCockpitMode) ? state.adminCockpitMode : 'today';
state.staffMenuPage = normalizeStaffMenuPage(state.staffMenuPage);
state.staffClientSegment = ['all', 'loyal', 'groups', 'birthdays'].includes(state.staffClientSegment) ? state.staffClientSegment : 'all';
state.staffClientStatusFilter = ['all', 'active', 'inactive', 'new', 'loyal'].includes(state.staffClientStatusFilter) ? state.staffClientStatusFilter : 'all';
state.staffClientQuery = state.staffClientQuery || '';
state.staffSelectedClientId = state.staffSelectedClientId || '';
state.staffClientFiltersOpen = !!state.staffClientFiltersOpen;
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
state.staffEmailQuery = state.staffEmailQuery || '';
state.staffEmailTemplateFilter = state.staffEmailTemplateFilter || 'all';
state.staffEmailSelectedId = state.staffEmailSelectedId || '';
state.staffCampaignObjective = ['anniversaires', 'calme', 'groupes', 'fidelisation', 'laser', 'formules'].includes(state.staffCampaignObjective) ? state.staffCampaignObjective : 'anniversaires';
state.staffCampaignChannel = ['linkedin', 'facebook', 'instagram', 'tiktok', 'email'].includes(state.staffCampaignChannel) ? state.staffCampaignChannel : 'linkedin';
state.staffCampaignSelectedId = state.staffCampaignSelectedId || '';
state.staffCampaignBrief = state.staffCampaignBrief || '';
state.staffCampaignDraft = state.staffCampaignDraft && typeof state.staffCampaignDraft === 'object' ? state.staffCampaignDraft : null;
state.marketingCampaigns = Array.isArray(state.marketingCampaigns) ? state.marketingCampaigns : [];
state.staffMenuCollapsed = !!state.staffMenuCollapsed;
state.booking = state.booking || {};
state.booking.preference = createDefaultFormulaPreference(state.booking.preference || {});
state.booking.pauseMinutes = Number(state.booking.pauseMinutes || 0);
state.booking.opsPlan = state.booking.opsPlan || null;
function save() {
  if (window.PinlaneStorage?.setJson) {
    window.PinlaneStorage.setJson(STORAGE_KEY, state);
    return;
  }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (error) {}
}
function applyStaffTheme() {
  const isLight = state.staffTheme === 'light';
  document.body.classList.toggle('staff-light', isLight);
  if (state.view === 'staff' || state.view === 'admin') {
    document.documentElement.setAttribute('data-theme', isLight ? 'light' : 'dark');
    try { localStorage.setItem('pinlane-theme', isLight ? 'light' : 'dark'); } catch (error) {}
  }
  const darkBtn = document.getElementById('staffThemeDark');
  const lightBtn = document.getElementById('staffThemeLight');
  if (darkBtn) darkBtn.classList.toggle('active', !isLight);
  if (lightBtn) lightBtn.classList.toggle('active', isLight);
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
  settings: ['settings.manage']
};

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
  if (session.role?.locked) return true;
  const permissions = new Set(session.permissions || []);
  if (Array.isArray(permission)) return permission.some(item => permissions.has(item));
  return permissions.has(permission);
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
      await loadAdminDashboard(true);
      renderAdminDashboard();
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

function setView(v) {
  state.view = v;
  document.body.classList.toggle('client-mode', v === 'client');
  document.body.classList.toggle('staff-mode', v === 'staff' || v === 'admin');
  document.body.classList.toggle('admin-mode', v === 'admin');
  document.getElementById('clientView').classList.toggle('hidden', v !== 'client');
  document.getElementById('staffView').classList.toggle('hidden', v !== 'staff');
  document.getElementById('adminView').classList.toggle('hidden', v !== 'admin');
  document.getElementById('btnClient').classList.toggle('active', v === 'client');
  document.getElementById('btnStaff').classList.toggle('active', v === 'staff');
  document.getElementById('btnAdmin').classList.toggle('active', v === 'admin');
  document.getElementById('locSelect').style.display = v === 'client' ? 'flex' : 'none';
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
    renderAdminDashboard();
    loadAdminDashboard(false);
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
    clearBookingAlternatives();
    state.booking.formuleId = '';
    state.booking.startTime = '';
    state.booking.totalDuration = state.booking.type === 'laser'
      ? Number(state.booking.duration) * getLaserWaveCount(state.booking.pax)
      : state.booking.duration;
    state.booking.preference = createDefaultFormulaPreference();
    state.booking.pauseMinutes = 0;
    state.booking.opsPlan = null;
    updateSchedHint();
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
  updateProgress();
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

function updateSchedHint() {
  const sch = getSchedule(state.booking.date, state.isHolidayMode);
  const context = getSpecialOpeningContext(state.booking.date, state.isHolidayMode);
  const el = document.getElementById('schedHint');
  if (isPastBusinessDate(state.booking.date)) {
    el.innerHTML = '<span class="closed">Date passée - réservations terminées</span>';
  }
  else if (!sch) el.innerHTML = '<span class="closed">Fermé ce jour</span>';
  else el.innerHTML = `<span class="open">Ouvert ${sch.label}</span>${context.active && context.label ? `<span class="sched-holiday">${escapeHtml(context.label)}</span>` : ''}`;
}

function updatePaxAlert() {
  const pax = Number(state.booking.pax) || 0;
  const needed = getRequiredLaneCount(state.booking.type || 'bowling', pax, state.booking.formuleId);
  const impossibleBowlingGroup = state.booking.type !== 'laser' && needed > TOTAL_LANES;
  const el = document.getElementById('paxAlert');
  if (pax <= 0) { el.innerHTML = ''; return; }
  if (state.booking.type === 'laser') {
    const waveCount = getLaserWaveCount(pax);
    const waveSize = getBalancedLaserWaveSize(pax);
    const remainingIfEmpty = Math.max(0, LASER_GAME_MAX_PLAYERS - (waveCount > 1 ? waveSize : pax));
    el.innerHTML = `
      <div class="pax-alert ${waveCount > 1 ? 'warning' : ''}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${waveCount > 1 ? '2.5' : '2'}" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:1px;"><circle cx="12" cy="12" r="10"/><path d="M12 7v5l3 2"/></svg>
        <span>${waveCount > 1 ? `Groupe de <b>${pax} joueurs</b> : l'agent prépare <b>${waveCount} sessions Laser</b> d'environ ${waveSize} joueurs.` : `Vous réservez <b>${pax} place${pax > 1 ? 's' : ''}</b>. Dans une session vide, il restera <b>${remainingIfEmpty}</b> place${remainingIfEmpty > 1 ? 's' : ''}.`}</span>
      </div>`;
    return;
  }
  if (impossibleBowlingGroup) {
    el.innerHTML = `
      <div class="pax-alert warning">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:1px;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        <span>Groupe de <b>${pax} joueurs</b> : impossible sur 8 pistes en même temps. Le staff devra proposer deux vagues ou un autre horaire.</span>
      </div>`;
  } else if (pax > MAX_PER_LANE) {
    el.innerHTML = `
      <div class="pax-alert warning">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:1px;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        <span>Maximum conseillé : <b>${MAX_PER_LANE} joueurs par piste</b>. Avec ${pax} joueurs, nous réservons <b>${needed} pistes</b>${pax > TOTAL_LANES * MAX_PER_LANE ? ' avec répartition serrée validée staff' : ' côte à côte'}.</span>
      </div>`;
  } else {
    el.innerHTML = `
      <div class="pax-alert">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:1px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        <span>Allocation : <b>${needed} piste${needed > 1 ? 's' : ''}</b> (max ${MAX_PER_LANE}/piste)</span>
      </div>`;
  }
}

function normalizeBookingType(type) {
  return ['bowling', 'laser', 'formule'].includes(type) ? type : 'bowling';
}

function syncBookingTypeUi() {
  const type = normalizeBookingType(state.booking.type);
  state.booking.type = type;
  document.getElementById('segBowling').classList.toggle('active', type === 'bowling');
  document.getElementById('segLaser').classList.toggle('active', type === 'laser');
  document.getElementById('segFormule').classList.toggle('active', type === 'formule');
  document.getElementById('bowlingBlock').classList.toggle('hidden', type !== 'bowling');
  document.getElementById('laserBlock').classList.toggle('hidden', type !== 'laser');
  document.getElementById('formuleBlock').classList.toggle('hidden', type !== 'formule');
}

function clearCurrentBookingChoice() {
  state.availableSlots = [];
  state.booking.startTime = '';
  state.booking.allocatedLanes = [];
  state.booking.opsPlan = null;
}

function setType(t) {
  const type = normalizeBookingType(t);
  state.booking.type = type;
  syncBookingTypeUi();
  clearCurrentBookingChoice();
  clearBookingAlternatives();
  if (type === 'bowling') {
    state.booking.formuleId = '';
    if (!DURATION_OPTIONS.some(option => Number(option.value) === Number(state.booking.duration))) {
      state.booking.duration = 1;
    }
    state.booking.totalDuration = state.booking.duration;
    state.booking.preference = createDefaultFormulaPreference();
    state.booking.pauseMinutes = 0;
    state.booking.laneCount = getRequiredLaneCount('bowling', state.booking.pax, '');
  }
  if (type === 'laser') {
    state.booking.formuleId = '';
    if (!LASER_GAME_OPTIONS.some(option => Number(option.value) === Number(state.booking.duration))) {
      state.booking.duration = LASER_GAME_OPTIONS[0].value;
    }
    state.booking.totalDuration = Number(state.booking.duration) * getLaserWaveCount(state.booking.pax);
    state.booking.allocatedLanes = [];
    state.booking.laneCount = 0;
    state.booking.preference = createDefaultFormulaPreference();
    state.booking.pauseMinutes = 0;
  }
  renderFormules();
  renderFormulaPreferences();
  renderLaserOptions();
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
// (bowling, laser) — plus d'ordre imposé ni de mode « Fun Galaxy organise /
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

// Étape 1 : simple annonce du modèle — le vrai choix (une heure par ancre)
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
    ? 'À l’étape suivante, choisissez une heure pour chaque activité à créneau — le reste se vit librement sur place.'
    : 'À l’étape suivante, choisissez simplement votre heure d’arrivée — tout le reste se vit librement sur place.';
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
        <span>${freeIds.map(id => escapeHtml(getFormulaActivityLabel(formule, id))).join(' · ')} — à votre rythme, quand vous voulez</span>
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
}

function showAlert(msg) {
  const el = document.getElementById('alertBox');
  el.innerHTML = `<div class="alert shake"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> ${msg}</div>`;
  setTimeout(() => { el.innerHTML = ''; }, 4500);
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

function goStep(n) {
  ['step1', 'step2', 'step3', 'step4', 'step5'].forEach(s => document.getElementById(s).classList.add('hidden'));
  document.getElementById('step' + n).classList.remove('hidden');
  state.step = n;
  updateProgress();
  window.scrollTo({ top: 0, behavior: 'smooth' });
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

function setBookingSubmitBusy(isBusy) {
  const confirmBtn = document.getElementById('btnConfirmBooking');
  const backBtn = document.getElementById('btnStep4Back');
  if (confirmBtn) {
    confirmBtn.disabled = !!isBusy;
    confirmBtn.innerHTML = isBusy
      ? 'Confirmation en cours...'
      : `Confirmer la r\u00e9servation
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
  }
  if (backBtn) backBtn.disabled = !!isBusy;
}

async function goStep2() {
  if (isPastBusinessDate(state.booking.date)) {
    showAlert('Cette date est déjà passée. Vous ne pouvez plus réserver pour ce jour.');
    return;
  }
  const schedule = getSchedule(state.booking.date, state.isHolidayMode);
  if (!schedule) { showAlert('Le centre est fermé à cette date.'); return; }
  const pax = Number(state.booking.pax) || 0;
  if (pax < 1) { showAlert('Nombre de joueurs invalide.'); return; }
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
  if (!options.keepAlternatives) clearBookingAlternatives();
  const formule = state.booking.type === 'formule' ? FORMULES.find(x => x.id === state.booking.formuleId) : null;
  if (options.showLoading !== false) {
    slotLoading = true;
    state.availableSlots = [];
    renderSlots(formule);
  }
  setStep1Busy(true);

  try {
    const params = new URLSearchParams({
      date: state.booking.date,
      type: state.booking.type,
      pax: String(Number(state.booking.pax) || 1)
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
    } else {
      params.set('duration', String(state.booking.duration));
      if (state.booking.type === 'laser') params.set('laserGames', String(getLaserGameCount(state.booking.duration)));
    }

    const payload = await apiRequest(`${API_ENDPOINTS.publicAvailability || '/api/public-availability'}?${params.toString()}`, {
      method: 'GET'
    });
    if (requestId !== slotFetchRequestId) return;

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
    state.booking.opsPlan = null;
  } catch (error) {
    if (requestId !== slotFetchRequestId) return;
    state.availableSlots = [];
    formulaAnchorData = null;
    formulaAnchorMessage = '';
    formulaAnchorSuggestions = [];
    showAlert(error.message || 'Impossible de charger les créneaux.');
  }

  if (requestId !== slotFetchRequestId) return;
  slotLoading = false;
  renderSlots(formule);
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
// JAMAIS d'heure — ni ici, ni au récap, ni dans le mail.
let formulaArrivalChoice = '';      // formules sans ancre : heure d'arrivée
let formulaAnchorData = null;       // bloc `anchors` renvoyé par le serveur
let formulaAnchorMessage = '';      // message de refus de combinaison
let formulaAnchorSuggestions = [];  // combinaisons proches proposées
let formulaAnchorBusy = false;      // revalidation en cours

function resetFormulaProgramChoice() {
  formulaArrivalChoice = '';
}

function formulaHasAnchorUi() {
  return Boolean(formulaAnchorData && Array.isArray(formulaAnchorData.activities) && formulaAnchorData.activities.length);
}

// Défaut zéro friction : à l'arrivée sur l'étape, la combinaison valide
// proposée par le serveur est pré-sélectionnée — chaque ancre reste modifiable.
function adoptDefaultFormulaAnchors() {
  if (state.booking.type !== 'formule' || !formulaHasAnchorUi()) return;
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

async function revalidateFormulaAnchors() {
  const formule = state.booking.type === 'formule' ? FORMULES.find(x => x.id === state.booking.formuleId) : null;
  formulaAnchorBusy = true;
  renderSlots(formule);
  await fetchSlots({ showLoading: false });
  formulaAnchorBusy = false;
  renderSlots(formule);
}

async function setFormulaAnchorTime(activityId, time) {
  const preference = createDefaultFormulaPreference(state.booking.preference || {});
  if (preference.preferredTimes[activityId] === time && preference.laserPlacement !== 'onsite') return;
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
// le pass liberté — sans aucune heure pour les activités libres.
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
    rows.push(`<div class="visit-line"><span class="visit-tag free">À votre rythme</span><span>${passLabels.map(escapeHtml).join(' · ')} — quand vous voulez</span></div>`);
  }
  if (remainingLaser > 0) {
    rows.push(`<div class="visit-line"><span class="visit-tag laser">Laser</span><span>${remainingLaser} partie${remainingLaser > 1 ? 's' : ''} à placer sur place avec l'équipe, selon l'affluence</span></div>`);
  }
  if (plan.laserSharing?.mayShare) {
    rows.push(`<div class="visit-line visit-line-note"><span>Le Laser Game peut être complété par d'autres joueurs selon l'affluence</span></div>`);
  }
  return `<div class="formula-visit-summary">${rows.join('')}</div>`;
}

// Formules AVEC ancres : une ligne de chips par ancre + pass liberté.
function renderFormulaAnchorRows(formule) {
  const { preference, times } = getCurrentFormulaAnchorSelection();
  const laserOnSite = preference.laserPlacement === 'onsite';
  return formulaAnchorData.activities.map((activity) => {
    const isLaser = activity.activityId === 'laser_game';
    const disabled = isLaser && laserOnSite;
    const selected = disabled ? '' : (times[activity.activityId] || '');
    const chips = activity.times.map(item => `
      <button type="button" class="anchor-chip ${item.time === selected ? 'active' : ''}" ${disabled ? 'disabled' : ''} onclick="setFormulaAnchorTime('${escapeHtml(activity.activityId)}','${escapeHtml(item.time)}')">${escapeHtml(item.time)}</button>`).join('');
    const detail = isLaser
      ? (activity.count > 1
        ? `${activity.count} parties incluses — choisissez la 1re, le reste se place sur place`
        : `Session de ${activity.durationMinutes} min`)
      : `${formatDurationLabel(Number(activity.durationMinutes || 60) / 60)} de piste réservée`;
    const onSiteToggle = isLaser && formulaAnchorData.laserOnSiteAvailable ? `
      <label class="anchor-onsite ${laserOnSite ? 'active' : ''}">
        <input type="checkbox" ${laserOnSite ? 'checked' : ''} onchange="setFormulaLaserPlacement(this.checked ? 'onsite' : 'scheduled')">
        <span>Je place mes parties laser sur place, selon l'affluence</span>
      </label>` : '';
    return `
      <div class="anchor-row ${disabled ? 'anchor-row-onsite' : ''}" data-anchor="${escapeHtml(activity.activityId)}">
        <div class="anchor-row-head">
          <strong>${escapeHtml(activity.label)}</strong>
          <small>${escapeHtml(detail)}</small>
        </div>
        <div class="anchor-chip-grid">${chips}</div>
        ${onSiteToggle}
      </div>`;
  }).join('');
}

function renderFormulaFreePassBlock(formule) {
  const passItems = (formulaAnchorData?.freePass || []).map(item => item.label);
  if (!passItems.length && formule) {
    passItems.push(...getFormulaFreePassIds(formule).map(id => ACTIVITY_LABELS[id] || id));
  }
  const drinks = formulaAnchorData?.drinks || [];
  if (!passItems.length && !drinks.length) return '';
  return `
    <div class="anchor-free-pass">
      <div class="anchor-free-head">
        <span class="anchor-free-badge">Pass liberté</span>
        <strong>Inclus, à votre rythme sur place — quand vous voulez</strong>
      </div>
      <div class="anchor-free-items">
        ${passItems.map(label => `<span class="anchor-free-item">${escapeHtml(label)}</span>`).join('')}
        ${drinks.map(label => `<span class="anchor-free-item anchor-free-drink">${escapeHtml(label)}</span>`).join('')}
      </div>
      <small>Aucune heure à choisir : ces avantages se vivent librement pendant toute votre visite.</small>
    </div>`;
}

function renderFormulaAnchorPicker(formule) {
  if (!formulaHasAnchorUi()) return renderFormulaArrivalPicker(formule);
  const slotIndex = getCurrentFormulaAnchorSlotIndex();
  const slot = slotIndex >= 0 ? state.availableSlots[slotIndex] : null;
  let statusHtml = '';
  if (formulaAnchorBusy) {
    statusHtml = `
      <div class="anchor-status anchor-status-busy" role="status" aria-live="polite">
        <span class="slot-spinner" aria-hidden="true"></span>
        <span>Vérification de votre combinaison…</span>
      </div>`;
  } else if (slot) {
    statusHtml = `
      <div class="formula-program-panel">
        ${renderFormulaVisitSummary(slot, formule)}
        <button type="button" class="btn-primary formula-plan-confirm" onclick="selectSlot(${slotIndex})">Valider ces horaires</button>
      </div>`;
  } else {
    const suggestions = (formulaAnchorSuggestions || []).map((suggestion, index) => `
      <button type="button" class="anchor-suggestion" onclick="applyFormulaAnchorSuggestion(${index})">${escapeHtml(suggestion.label || Object.values(suggestion.times || {}).join(' · '))}</button>`).join('');
    statusHtml = `
      <div class="anchor-status anchor-status-error" role="alert">
        <strong>${escapeHtml(formulaAnchorMessage || 'Cette combinaison n’est pas possible.')}</strong>
        ${suggestions ? `<div class="anchor-suggestions"><span>Essayez plutôt :</span>${suggestions}</div>` : ''}
        <button type="button" class="formula-order-fallback-btn" onclick="resetFormulaAnchorChoices()">Revenir à la proposition automatique</button>
      </div>`;
  }
  return `
    <div class="formula-anchor-picker">
      <div class="formula-arrival-head">
        <strong>Composez votre visite</strong>
        <span>Choisissez l'heure de chaque activité à créneau — présentez-vous 10 minutes avant votre premier rendez-vous. Le reste de la formule se vit à votre rythme, sans horaire.</span>
      </div>
      ${renderFormulaAnchorRows(formule)}
      ${statusHtml}
      ${renderFormulaFreePassBlock(formule)}
    </div>`;
}

// Formules SANS ancre (table anniversaire + pass liberté) : le seul choix est
// l'heure d'arrivée — la table suit automatiquement.
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
        <span>Votre table vous attend dès votre arrivée et les activités incluses se vivent à votre rythme — présentez-vous 10 minutes avant l'heure choisie pour l'accueil.</span>
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

function renderSlots(formule) {
  const isLaser = state.booking.type === 'laser';
  const ds = parseLocalDate(state.booking.date).toLocaleDateString('fr-BE', { weekday:'long', day:'2-digit', month:'short' });
  const slotTitle = document.getElementById('slotTitle');
  if (slotTitle) slotTitle.textContent = formule ? 'Votre programme' : 'Horaire disponible';
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
  if (formule && formulaHasAnchorUi()) {
    // Formule à ancres : le picker reste affiché même sans créneau composé
    // (combinaison refusée → message + suggestions proches).
    list.innerHTML = renderFormulaAnchorPicker(formule);
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
  const showLanes = reservationNeedsLanes(state.booking.type, state.booking.formuleId);
  list.innerHTML = `<div class="slot-grid stagger">${state.availableSlots.map((s, i) => `
    <button class="slot" onclick="selectSlot(${i})">
      <span class="slot-time">${s.time}</span>
      ${showLanes ? `<span class="slot-free">${s.freeCount} pistes libres</span>` : isLaser ? `<span class="slot-free">${getLaserSlotCapacityText(s)}</span>` : ''}
      ${isLaser ? `<span class="slot-plan"><b>${s.sharedSession ? 'Session partagée' : s.splitGroup ? 'Groupe découpé' : 'Session ouverte'}</b><br>${getLaserSlotAfterText(s)}</span>` : ''}
      ${!isLaser && s.opsPlan ? `<span class="slot-plan"><b>Plan conseillé</b><br>${describeSlotPlan(s.opsPlan)}</span>` : ''}
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
  if (!name || !phone || !email) { showAlert('Nom, téléphone et email requis pour envoyer la confirmation.'); return; }
  if (name.length < 2) { showAlert('Merci d\'indiquer votre nom complet.'); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showAlert('Adresse email invalide — vérifiez-la pour recevoir votre confirmation.'); return; }
  const phoneDigits = phone.replace(/[^0-9]/g, '');
  if (phoneDigits.length < 8 || phoneDigits.length > 15) { showAlert('Numéro de téléphone invalide.'); return; }
  state.booking.name = name;
  state.booking.phone = phone;
  state.booking.email = email;
  renderRecap();
  goStep(4);
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
  const showLanes = reservationNeedsLanes(b.type, b.formuleId);
  const total = getBasePrice(b.type, Number(b.duration), b.laneCount, Number(b.pax), b.formuleId);
  const totalDuration = getBookingTotalDuration(b);
  const formulaRecap = formule ? getFormulaRecapModel(b) : null;
  const planLine = b.opsPlan ? describeSlotPlan(b.opsPlan) : '';
  const laserOption = isLaser ? getLaserOption(b.duration) : null;
  const laserWaveCount = isLaser ? Number(b.opsPlan?.laserSharing?.waveCount || getLaserWaveCount(b.pax)) : 1;
  document.getElementById('recapTotal').textContent = total + '€';
  const dateLabel = parseLocalDate(b.date).toLocaleDateString('fr-BE', { weekday:'long', day:'numeric', month:'long' });
  document.getElementById('recapList').innerHTML = `
    <div class="recap-item"><span class="recap-label">Client</span><span class="recap-value">${escapeHtml(b.name)}</span></div>
    <div class="recap-item"><span class="recap-label">Téléphone</span><span class="recap-value">${escapeHtml(b.phone)}</span></div>
    <div class="recap-item"><span class="recap-label">Date</span><span class="recap-value">${dateLabel}</span></div>
    <div class="recap-item"><span class="recap-label">${formule ? 'Première activité' : 'Horaire'}</span><span class="recap-value accent">${b.startTime} <small style="font-size:13px;color:var(--text-3);font-weight:500;">• ${b.duration}h</small></span></div>
    ${formule && b.opsPlan?.arrivalTime ? `<div class="recap-item"><span class="recap-label">Arrivée conseillée</span><span class="recap-value">${escapeHtml(b.opsPlan.arrivalTime)} <small style="font-size:13px;color:var(--text-3);font-weight:500;">• accueil ${Number(b.opsPlan.arrivalMinutes || 10)} min avant</small></span></div>` : ''}
    <div class="recap-item"><span class="recap-label">Joueurs</span><span class="recap-value">${b.pax} personne${b.pax > 1 ? 's' : ''}</span></div>
    ${showLanes ? `<div class="recap-item"><span class="recap-label">Piste${b.allocatedLanes.length > 1 ? 's' : ''} assignée${b.allocatedLanes.length > 1 ? 's' : ''}</span><span class="recap-value teal">${b.allocatedLanes.join(' & ')}</span></div>` : ''}
    ${isLaser ? `<div class="recap-item"><span class="recap-label">Activité</span><span class="recap-value">Laser Game • ${laserOption.label}</span></div>` : ''}
    ${formule ? `<div class="recap-item"><span class="recap-label">Formule</span><span class="recap-value">${formule.name}</span></div>` : ''}
    ${formulaRecap && formulaRecap.appointments.length ? `<div class="recap-item"><span class="recap-label">Vos rendez-vous</span><span class="recap-value">${formulaRecap.appointments.map(escapeHtml).join(' · ')}</span></div>` : ''}
    ${formulaRecap && formulaRecap.hasTable ? `<div class="recap-item"><span class="recap-label">Votre table</span><span class="recap-value">Dès l'arrivée${formulaRecap.arrivalTime ? ` (${escapeHtml(formulaRecap.arrivalTime)})` : ''}</span></div>` : ''}
    ${formulaRecap && formulaRecap.freeLabels.length ? `<div class="recap-item"><span class="recap-label">À votre rythme</span><span class="recap-value">${formulaRecap.freeLabels.map(escapeHtml).join(' · ')}</span></div>` : ''}
    ${formule ? `<div class="recap-item"><span class="recap-label">Temps total estimé</span><span class="recap-value">${formatDurationLabel(totalDuration)}</span></div>` : ''}
    ${isLaser ? `<div class="recap-note"><b>Laser Game :</b> ${laserWaveCount > 1 ? `votre groupe est réparti sur ${laserWaveCount} sessions successives. ` : ''}Votre session peut être complétée avec d'autres joueurs selon l'affluence. ${planLine ? `Plan retenu : ${planLine}.` : ''}</div>` : ''}
    ${formulaRecap && (formulaRecap.remainingLaser > 0 || formulaRecap.laserOnSite) ? `<div class="recap-note"><b>Laser Game :</b> ${formulaRecap.remainingLaser > 0 ? `${formulaRecap.remainingLaser} partie${formulaRecap.remainingLaser > 1 ? 's' : ''} à placer sur place avec l'équipe, selon l'affluence.` : ''} ${formulaRecap.laserOnSite ? 'Vous placez vos parties laser librement pendant la visite.' : ''}</div>` : ''}
    ${formule ? `<div class="recap-note"><b>Le reste, à votre rythme :</b> aucune heure imposée pour les activités du pass liberté — vous les vivez quand vous voulez pendant votre visite.</div>` : ''}
  `;
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

  const basePrice = getBasePrice(b.type, duration, needsLanes ? allocated.length : 0, Number(b.pax), b.formuleId);
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
    preference: b.preference || {},
    pauseMinutes: 0,
    opsPlan: b.opsPlan || null,
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
    ? ` À votre rythme sur place : ${successRecap.freeLabels.map(escapeHtml).join(', ')} — quand vous voulez.`
    : '';
  document.getElementById('successDetails').innerHTML = `${confirmationText} ${b.type === 'formule' ? 'Première activité' : 'Départ prévu'} à <b>${b.startTime}</b>${showLanes && allocated.length ? ` sur la/les piste(s) <b>${allocated.join(' & ')}</b>` : ''}.${appointmentsLine}${tableLine}${arrivalLine}${freeLine} Temps total estimé : <b>${formatDurationLabel(totalDuration)}</b>.${laserLine}`;
  releaseBookingSubmit();
  goStep(5);
}

function resetBooking() {
  clearBookingAlternatives();
  state.booking = {
    name:'', phone:'', email:'', pax:4,
    date: todayStr(),
    type:'bowling', formuleId:'', duration:1, totalDuration:1, laneCount:1, startTime:'', allocatedLanes:[],
    preference: createDefaultFormulaPreference(),
    pauseMinutes: 0,
    opsPlan: null,
    opsResult: null
  };
  document.getElementById('fName').value = '';
  document.getElementById('fPhone').value = '';
  document.getElementById('fEmail').value = '';
  document.getElementById('fPax').value = 4;
  document.getElementById('fDate').value = todayStr();
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

const STAFF_UTILITY_MENU_PAGES = [
  'sessions',
  'arrivals',
  'events',
  'groups',
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
  const completeCount = activeReservations.filter(reservation => getBowlingWindowsFromReservation(reservation).length && getLaserWindowsFromReservation(reservation).length).length;
  const bowlingOnly = activeReservations.filter(reservation => getBowlingWindowsFromReservation(reservation).length && !getLaserWindowsFromReservation(reservation).length).length;
  const laserOnly = activeReservations.filter(reservation => getLaserWindowsFromReservation(reservation).length && !getBowlingWindowsFromReservation(reservation).length).length;
  const laneUsage = Array.from({ length: TOTAL_LANES }, (_, index) => ({
    lane: index + 1,
    value: bowlingWindows.reduce((sum, window) => sum + ((window.lanes || []).includes(index + 1) ? Number(window.duration || 0) : 0), 0)
  })).sort((left, right) => right.value - left.value);
  const days = Array.from({ length: 7 }, (_, index) => addDays(state.currentDate, index - 6));
  const revenueSeries = days.map(date => state.reservations
    .filter(reservation => reservation.date === date && reservation.status !== 'cancelled')
    .reduce((sum, reservation) => sum + (Number(reservation.price) || 0), 0));
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
    bowlingOnly,
    laserOnly,
    completeCount,
    laneUsage,
    revenueSeries,
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

function renderStaffDashboardHourly(metrics) {
  const { planningWindow, bowlingWindows } = metrics;
  if (planningWindow.closed) return `<div class="dash-empty">Centre fermé sur cette date.</div>`;
  const startHour = Math.floor(planningWindow.open);
  const endHour = Math.ceil(planningWindow.close);
  const hours = [];
  for (let hour = startHour; hour <= endHour; hour++) {
    const bucket = { hour, confirmed: 0, arrived: 0, paid: 0 };
    bowlingWindows.forEach(window => {
      const overlap = Math.max(0, Math.min(hour + 1, window.end) - Math.max(hour, window.start));
      if (!overlap) return;
      const value = overlap * Math.max((window.lanes || []).length, 1);
      if (window.reservation.status === 'paid') bucket.paid += value;
      else if (window.reservation.status === 'arrived') bucket.arrived += value;
      else bucket.confirmed += value;
    });
    bucket.total = bucket.confirmed + bucket.arrived + bucket.paid;
    hours.push(bucket);
  }
  const chart = { width: 620, height: 238, left: 42, right: 16, top: 18, bottom: 34 };
  const innerWidth = chart.width - chart.left - chart.right;
  const innerHeight = chart.height - chart.top - chart.bottom;
  const plotBottom = chart.height - chart.bottom;
  const lanes = Math.max(TOTAL_LANES, 1);
  const toPercent = value => Math.max(0, Math.min(100, (value / lanes) * 100));
  const xFor = index => chart.left + (hours.length <= 1 ? 0 : (index / (hours.length - 1)) * innerWidth);
  const yFor = percent => chart.top + innerHeight - ((Math.max(0, Math.min(100, percent)) / 100) * innerHeight);
  const seriesMeta = [
    { key: 'confirmed', cls: 'confirmed', name: 'Confirmé' },
    { key: 'arrived', cls: 'arrived', name: 'Arrivé' },
    { key: 'paid', cls: 'paid', name: 'Payé' }
  ];
  const pointsFor = key => hours.map((hour, index) => `${xFor(index).toFixed(1)},${yFor(toPercent(hour[key])).toFixed(1)}`).join(' ');
  const peak = hours.reduce((best, hour, index) => hour.total > best.total ? { ...hour, index } : best, { total: -1, index: 0 });
  const peakX = xFor(peak.index || 0);
  const peakPercent = Math.round(toPercent(peak.total || 0));
  const peakY = yFor(peakPercent);
  const xLabels = hours.map((hour, index) => {
    const show = index === 0 || index === hours.length - 1 || Math.floor(hour.hour) % 2 === 0;
    return show ? `<text x="${xFor(index).toFixed(1)}" y="${chart.height - 7}" text-anchor="middle">${String(Math.floor(hour.hour)).padStart(2, '0')}h</text>` : '';
  }).join('');
  const yTicks = [100, 75, 50, 25, 0].map(percent => {
    const y = yFor(percent);
    return `<g class="dash-line-grid"><line x1="${chart.left}" x2="${chart.width - chart.right}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"></line><text x="4" y="${(y + 4).toFixed(1)}">${percent}%</text></g>`;
  }).join('');
  const chartData = {
    w: chart.width,
    h: chart.height,
    top: chart.top,
    bottom: plotBottom,
    pts: hours.map((hour, index) => ({
      x: Number(xFor(index).toFixed(1)),
      label: `${String(Math.floor(hour.hour)).padStart(2, '0')}h`,
      s: seriesMeta.map(meta => ({
        n: meta.name,
        c: meta.cls,
        v: Math.round(toPercent(hour[meta.key])),
        y: Number(yFor(toPercent(hour[meta.key])).toFixed(1))
      }))
    }))
  };
  return `<div class="dash-line-chart" aria-label="Occupations par heure" data-hourly-chart="${escapeHtml(JSON.stringify(chartData))}">
    <svg viewBox="0 0 ${chart.width} ${chart.height}" role="img" aria-hidden="true">
      ${yTicks}
      <polyline class="confirmed" points="${pointsFor('confirmed')}"></polyline>
      <polyline class="arrived" points="${pointsFor('arrived')}"></polyline>
      <polyline class="paid" points="${pointsFor('paid')}"></polyline>
      ${peak.total > 0 ? `<line class="dash-line-marker" x1="${peakX.toFixed(1)}" x2="${peakX.toFixed(1)}" y1="${chart.top}" y2="${plotBottom.toFixed(1)}"></line>
        <circle class="dash-line-point" cx="${peakX.toFixed(1)}" cy="${peakY.toFixed(1)}" r="5"></circle>
        <g class="dash-line-badge">
          <rect x="${Math.max(chart.left, Math.min(peakX - 18, chart.width - chart.right - 42)).toFixed(1)}" y="${Math.max(6, peakY - 35).toFixed(1)}" width="44" height="24" rx="8"></rect>
          <text x="${Math.max(chart.left + 22, Math.min(peakX + 4, chart.width - chart.right - 20)).toFixed(1)}" y="${Math.max(22, peakY - 18).toFixed(1)}" text-anchor="middle">${peakPercent}%</text>
        </g>` : ''}
      <g class="dash-line-x">${xLabels}</g>
      <g class="dash-line-cursor" aria-hidden="true" style="display:none;">
        <line x1="0" x2="0" y1="${chart.top}" y2="${plotBottom.toFixed(1)}"></line>
        <circle class="confirmed" r="4"></circle>
        <circle class="arrived" r="4"></circle>
        <circle class="paid" r="4"></circle>
      </g>
    </svg>
  </div>`;
}

function renderStaffDashboardActivity(metrics) {
  const totalCount = metrics.activeReservations.length;
  const total = Math.max(totalCount, 1);
  const bowlingPct = totalCount ? Math.round((metrics.bowlingOnly / total) * 100) : 0;
  const laserPct = totalCount ? Math.round((metrics.laserOnly / total) * 100) : 0;
  const completePct = totalCount ? Math.max(0, 100 - bowlingPct - laserPct) : 0;
  return `<div class="dash-donut-wrap">
    <div class="dash-donut" style="--bowling:${bowlingPct};--laser:${laserPct};--complete:${completePct};">
      <strong>${metrics.activeReservations.length}</strong>
      <span>réservations aujourd'hui</span>
    </div>
    <div class="dash-activity-list">
      <div><i class="bowling"></i><span>Bowling</span><strong>${metrics.bowlingOnly}</strong><small>${bowlingPct}%</small></div>
      <div><i class="laser"></i><span>Laser Game</span><strong>${metrics.laserOnly}</strong><small>${laserPct}%</small></div>
      <div><i class="complete"></i><span>Complet (Bowling + Laser)</span><strong>${metrics.completeCount}</strong><small>${completePct}%</small></div>
    </div>
  </div>`;
}

function renderStaffDashboardTopLanes(metrics) {
  const sortMode = state.dashboardLaneSort === 'low' ? 'low' : 'high';
  const items = [...metrics.laneUsage].sort((left, right) => sortMode === 'low' ? left.value - right.value : right.value - left.value);
  const openHours = metrics.planningWindow.closed ? 0 : Math.max(metrics.planningWindow.close - metrics.planningWindow.open, 1);
  return items.slice(0, 5).map(item => {
    const percent = Math.min(100, Math.round((item.value / openHours) * 100));
    return `<div class="dash-lane-row">
      <small>${item.lane}</small>
      <strong>Piste ${item.lane}</strong>
      <span><i style="width:${percent}%"></i></span>
      <em>${percent}%</em>
    </div>`;
  }).join('');
}

function renderStaffDashboardArrivals(metrics) {
  const rows = metrics.upcoming.slice(0, 3);
  if (!rows.length) return `<div class="dash-empty">Aucune arrivée à venir sur cette date.</div>`;
  return rows.map(reservation => {
    const lanes = getBowlingWindowsFromReservation(reservation)[0]?.lanes || reservation.lanes || [];
    const statusLabel = reservation.status === 'paid' ? 'Payé' : reservation.status === 'arrived' ? 'Arrivé' : reservation.type === 'formule' ? 'Formule' : 'Confirmé';
    return `<div class="dash-arrival-row">
      <time>${escapeHtml(formatClockDisplay(getReservationFirstResourceStart(reservation, 'all')))}</time>
      <strong>${escapeHtml(reservation.name || 'Client')}</strong>
      <span>${lanes.length ? `Piste ${escapeHtml(lanes.join(', '))}` : getLaserWindowsFromReservation(reservation).length ? 'Laser' : 'Hors piste'}</span>
      <em class="${escapeHtml(reservation.status || 'pending')}">${escapeHtml(statusLabel)}</em>
    </div>`;
  }).join('');
}

function renderStaffDashboardAlerts(metrics) {
  const alerts = getStaffDashboardAlertDefinitions(metrics);
  if (!alerts.length) {
    return `<div class="dash-alert-row info">
      <span class="dash-alert-dot info" aria-hidden="true"></span>
      <div class="dash-alert-copy"><strong>Tout est à jour</strong><p>Aucune alerte : paiements, laser et pistes sont sous contrôle.</p></div>
    </div>`;
  }
  return alerts.slice(0, 4).map(alert => `<div class="dash-alert-row ${escapeHtml(alert.kind)}">
    <span class="dash-alert-dot ${escapeHtml(alert.kind)}" aria-hidden="true"></span>
    <div class="dash-alert-copy"><strong>${escapeHtml(alert.title)}</strong><p>${escapeHtml(alert.text)}</p></div>
    <button type="button" onclick="openStaffDashboardDetail('alerts', '${escapeJsString(alert.kind)}')">Voir</button>
  </div>`).join('');
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
    setAdminTab('overview');
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
      title: 'Paiement à encaisser',
      text: `${unpaidRows.length} réservation${unpaidRows.length > 1 ? 's' : ''} non payée${unpaidRows.length > 1 ? 's' : ''} · ${formatMoney(outstanding)}${onSite ? ` · ${onSite} déjà sur place` : ''}`,
      rows: unpaidRows,
      action: onSite
        ? `Encaisser en priorité les ${onSite} client${onSite > 1 ? 's' : ''} déjà sur place, puis clôturer les réservations restantes.`
        : 'Encaisser ou clôturer les réservations restées ouvertes.'
    });
  }
  const lateLaserWindows = metrics.laserWindows.filter(window => window.end > metrics.planningWindow.close);
  if (lateLaserWindows.length) {
    const rows = [...new Map(lateLaserWindows.map(window => [window.reservation.id, window.reservation])).values()];
    const closeLabel = formatClockDisplay(metrics.planningWindow.close);
    alerts.push({
      kind: 'warning',
      title: 'Laser après fermeture',
      text: `${rows.length} réservation${rows.length > 1 ? 's' : ''} laser se termine${rows.length > 1 ? 'nt' : ''} après ${closeLabel}`,
      rows,
      windows: lateLaserWindows,
      action: `Ces sessions dépassent l'heure de fermeture (${closeLabel}) : vérifier le lancement laser ou décaler le créneau.`
    });
  }
  const maintenanceLanes = Object.entries(state.laneStatuses || {})
    .filter(([, status]) => status === 'maintenance')
    .map(([lane]) => Number(lane) + 1);
  if (maintenanceLanes.length) {
    alerts.push({
      kind: 'maintenance',
      title: 'Pistes en maintenance',
      text: `Piste${maintenanceLanes.length > 1 ? 's' : ''} ${maintenanceLanes.join(', ')} bloquée${maintenanceLanes.length > 1 ? 's' : ''}`,
      lanes: maintenanceLanes,
      rows: [],
      action: 'Garder ces pistes bloquées tant que le responsable terrain ne les a pas libérées.'
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
      title: 'Formules à enchaîner',
      text: `${comboRows.length} formule${comboRows.length > 1 ? 's' : ''} bowling + laser à cadencer aujourd'hui`,
      rows: comboRows,
      action: 'Surveiller le passage bowling → laser pour éviter les retards de groupe.'
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
  const type = state.dashboardDetailType || 'arrivals';
  const kind = state.dashboardDetailKind || '';
  window.setTimeout(() => openStaffDashboardDetail(type, kind), 140);
}

function openStaffDashboardDetail(type = 'arrivals', kind = '') {
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
      <header class="dashboard-detail-head">
        <div>
          <span>${escapeHtml(config.eyebrow)}</span>
          <h2 id="dashboardDetailTitle">${escapeHtml(config.title)}</h2>
          <p>${escapeHtml(dateLong)} · ${escapeHtml(config.subtitle)}</p>
        </div>
        <button type="button" class="dashboard-detail-close" onclick="closeStaffDashboardDetail()" aria-label="Fermer">×</button>
      </header>
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
  const openDirection = "closeStaffDashboardDetail(); setView('admin'); setAdminTab('overview');";
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
      actions: [
        { label: 'Voir toutes les réservations', onclick: openReservations },
        { label: 'Ouvrir le planning', onclick: openPlanning, className: 'secondary' }
      ]
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
    return {
      eyebrow: 'Mix activité',
      title: 'Réservations par activité',
      subtitle: 'répartition bowling, laser et formules',
      stats: [
        { label: 'Bowling', value: String(metrics.bowlingOnly), note: 'direct' },
        { label: 'Laser', value: String(metrics.laserOnly), note: 'direct' },
        { label: 'Complet', value: String(metrics.completeCount), note: 'bowling + laser' }
      ],
      body: renderStaffDashboardActivityDetail(metrics),
      actions: [
        { label: 'Voir réservations', onclick: openReservations },
        { label: 'Ouvrir planning complet', onclick: "closeStaffDashboardDetail(); setStaffResourceView('all');", className: 'secondary' }
      ]
    };
  }
  return {
    eyebrow: 'Accueil',
    title: 'Prochaines arrivées',
    subtitle: `${metrics.upcoming.length} arrivée${metrics.upcoming.length > 1 ? 's' : ''} à préparer`,
    stats: [
      { label: 'À venir', value: String(metrics.upcoming.length), note: 'sur la date' },
      { label: 'Sur place', value: String(metrics.activeReservations.filter(r => r.status === 'arrived').length), note: 'déjà arrivées' },
      { label: 'À clôturer', value: String(unpaidCount), note: 'paiement ou suivi' }
    ],
    body: renderStaffDashboardArrivalsDetail(metrics),
    actions: [
      { label: 'Voir la liste complète', onclick: openReservations },
      { label: 'Ajouter une réservation', onclick: "closeStaffDashboardDetail(); openQuickBook({ date: state.currentDate });", className: 'secondary' }
    ]
  };
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

function renderStaffDashboardReservationRows(rows = [], emptyText = 'Aucune donnée à afficher.') {
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
        <button type="button" onclick="closeStaffDashboardDetail(); openPos(${reservation.id});">Fiche</button>
        ${reservation.status !== 'arrived' && reservation.status !== 'paid' ? `<button type="button" onclick="dashboardDetailSetStatus(${reservation.id}, 'arrived', event)">Arrivé</button>` : ''}
        ${reservation.status !== 'paid' ? `<button type="button" onclick="dashboardDetailSetStatus(${reservation.id}, 'paid', event)">Payé</button>` : ''}
      </div>
    </article>`;
  }).join('');
}

function renderStaffDashboardArrivalsDetail(metrics) {
  const rows = metrics.upcoming.slice(0, 30);
  return `<div class="dashboard-detail-section">
    <div class="dashboard-detail-section-head"><h3>Arrivées triées par horaire</h3><p>Le staff peut ouvrir la fiche ou clôturer directement.</p></div>
    ${renderStaffDashboardReservationRows(rows, 'Aucune arrivée à venir sur cette date.')}
  </div>`;
}

function renderStaffDashboardAlertsDetail(alerts = []) {
  if (!alerts.length) {
    return `<div class="dashboard-detail-empty">Aucune alerte active. Les réservations restent surveillées en temps réel.</div>`;
  }
  return alerts.map(alert => `<section class="dashboard-detail-section alert-${escapeHtml(alert.kind)}">
    <div class="dashboard-detail-section-head">
      <h3>${escapeHtml(alert.title)}</h3>
      <p>${escapeHtml(alert.action || alert.text)}</p>
    </div>
    ${alert.lanes?.length ? `<div class="dashboard-detail-lane-chips">${alert.lanes.map(lane => `<span>Piste ${lane}</span>`).join('')}</div>` : ''}
    ${renderStaffDashboardReservationRows(alert.rows || [], alert.kind === 'info' ? 'Aucun élément à traiter.' : 'Pas de réservation liée à ce signal.')}
  </section>`).join('');
}

function renderStaffDashboardRevenueDetail(metrics) {
  const days = Array.from({ length: 7 }, (_, index) => addDays(state.currentDate, index - 6));
  const rows = days.map((date, index) => {
    const reservations = state.reservations.filter(reservation => reservation.date === date && reservation.status !== 'cancelled');
    const collected = reservations.filter(reservation => reservation.status === 'paid').reduce((sum, reservation) => sum + (Number(reservation.price) || 0), 0);
    return {
      date,
      reservations,
      revenue: metrics.revenueSeries[index] || 0,
      collected
    };
  });
  const max = Math.max(...rows.map(row => row.revenue), 1);
  return `<div class="dashboard-detail-section">
    <div class="dashboard-detail-section-head"><h3>Détail caisse</h3><p>Prévu, encaissé et reste à suivre sur les 7 derniers jours.</p></div>
    <div class="dashboard-detail-revenue-list">
      ${rows.map(row => `<div class="dashboard-detail-revenue-row">
        <time>${escapeHtml(parseLocalDate(row.date).toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric', month: 'short' }).replace('.', ''))}</time>
        <span><i style="width:${Math.max(4, Math.round((row.revenue / max) * 100))}%"></i></span>
        <strong>${formatMoney(row.revenue)}</strong>
        <small>${row.reservations.length} rés. · ${formatMoney(row.collected)} validés</small>
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

function renderStaffDashboardActivityDetail(metrics) {
  const groups = [
    ['Bowling', metrics.activeReservations.filter(reservation => getBowlingWindowsFromReservation(reservation).length && !getLaserWindowsFromReservation(reservation).length)],
    ['Laser Game', metrics.activeReservations.filter(reservation => getLaserWindowsFromReservation(reservation).length && !getBowlingWindowsFromReservation(reservation).length)],
    ['Complet', metrics.activeReservations.filter(reservation => getBowlingWindowsFromReservation(reservation).length && getLaserWindowsFromReservation(reservation).length)]
  ];
  return groups.map(([title, rows]) => `<section class="dashboard-detail-section">
    <div class="dashboard-detail-section-head"><h3>${escapeHtml(title)}</h3><p>${rows.length} réservation${rows.length > 1 ? 's' : ''}</p></div>
    ${renderStaffDashboardReservationRows(rows.slice(0, 12), 'Aucune réservation dans cette activité.')}
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

function cycleDashboardLaneSort() {
  state.dashboardLaneSort = state.dashboardLaneSort === 'low' ? 'high' : 'low';
  save();
  renderStaffDashboard();
}

function getDashboardLaneSortLabel() {
  return state.dashboardLaneSort === 'low' ? 'Moins occupées' : 'Par occupation';
}

function renderStaffDashboard(dayReservations = todaysReservations()) {
  const root = document.getElementById('staffDashboardPage');
  if (!root) return;
  const metrics = getStaffDashboardMetrics(dayReservations);
  const d = parseLocalDate(state.currentDate);
  const dateShort = d.toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).replace(',', '');
  const formattedDate = dateShort.charAt(0).toUpperCase() + dateShort.slice(1);
  const revenueTrendText = metrics.revenueTrend > 0 ? `+${metrics.revenueTrend}%` : `${metrics.revenueTrend}%`;
  const reservationTrendText = formatDashboardTrend(metrics.activeReservations.length, metrics.previousReservationsCount);
  const playerTrendText = formatDashboardTrend(metrics.players, metrics.previousPlayers);
  const occupancyTrendText = formatDashboardTrend(metrics.occupancy, metrics.previousOccupancy);
  const availableLanes = TOTAL_LANES - Object.values(state.laneStatuses || {}).filter(status => status === 'maintenance').length;
  const totalPeriodRevenue = metrics.revenueSeries.reduce((sum, value) => sum + value, 0);
  root.innerHTML = `
    <section class="dash-hero">
      <div>
        <h1>Dashboard</h1>
        <p>Vue d'ensemble de votre activité <span class="dash-live-dot"></span><span>Données en temps réel</span></p>
      </div>
      <div class="dash-actions">
        <div class="dash-date-control">
          <span>${escapeHtml(formattedDate)}</span>
          <button type="button" onclick="openStaffDatePicker(event)" aria-label="Choisir une date">${renderDashboardIcon('date')}</button>
          <input id="dashboardDatePicker" class="dash-date-input" type="date" onchange="setStaffDateFromPicker(this.value)" aria-label="Choisir une date">
        </div>
        <button type="button" class="dash-period-btn" onclick="setStaffToday()">Aujourd'hui</button>
        <button type="button" class="dash-new-btn" onclick="openQuickBook()">+ Réservation rapide</button>
      </div>
    </section>

    <section class="dash-kpis">
      <article class="dash-kpi purple">
        <div class="dash-icon">${renderDashboardIcon('calendar')}</div>
        <div class="dash-kpi-copy"><span>Réservations aujourd'hui</span><strong>${metrics.activeReservations.length}</strong><small>sessions piste</small></div>
        <div class="dash-kpi-trend"><strong>${escapeHtml(reservationTrendText)}</strong><span>vs hier</span></div>
        ${renderDashboardSpark([metrics.previousReservationsCount, Math.max(0, metrics.activeReservations.length - 3), metrics.activeReservations.length, metrics.upcoming.length, metrics.activeNow.length, metrics.activeReservations.length], 'purple')}
      </article>
      <article class="dash-kpi blue">
        <div class="dash-icon">${renderDashboardIcon('users')}</div>
        <div class="dash-kpi-copy"><span>Joueurs aujourd'hui</span><strong>${metrics.players}</strong><small>personnes</small></div>
        <div class="dash-kpi-trend"><strong>${escapeHtml(playerTrendText)}</strong><span>vs hier</span></div>
        ${renderDashboardSpark([metrics.previousPlayers, Math.max(0, metrics.players - 12), metrics.players, metrics.players * .72, metrics.players * .9, metrics.players], 'blue')}
      </article>
      <article class="dash-kpi green">
        <div class="dash-icon">${renderDashboardIcon('euro')}</div>
        <div class="dash-kpi-copy"><span>Chiffre d'affaires</span><strong>${formatMoney(metrics.revenue)}</strong><small>${formatMoney(metrics.collected)} validés aujourd'hui</small></div>
        <div class="dash-kpi-trend"><strong>${escapeHtml(revenueTrendText)}</strong><span>vs hier</span></div>
        ${renderDashboardSpark(metrics.revenueSeries, 'green')}
      </article>
      <article class="dash-kpi orange">
        <div class="dash-icon">${renderDashboardIcon('activity')}</div>
        <div class="dash-kpi-copy"><span>Taux d'occupation</span><strong>${metrics.occupancy}%</strong><small>${availableLanes} pistes disponibles</small></div>
        <div class="dash-kpi-trend"><strong>${escapeHtml(occupancyTrendText)}</strong><span>vs hier</span></div>
        ${renderDashboardSpark([metrics.previousOccupancy, Math.max(0, metrics.occupancy - 14), metrics.occupancy * .82, metrics.occupancy, metrics.occupancy * .76, metrics.occupancy], 'orange')}
      </article>
    </section>

    <section class="dash-grid-main">
      <article class="dash-card dash-card-wide">
        <div class="dash-card-head"><h2>Occupations par heure</h2><button type="button" onclick="openStaffDashboardDetail('occupation')">${TOTAL_LANES} pistes</button></div>
        <div class="dash-chart-legend"><span class="confirmed"></span>Confirmé <span class="arrived"></span>Arrivé <span class="paid"></span>Payé</div>
        ${renderStaffDashboardHourly(metrics)}
      </article>
      <article class="dash-card">
        <div class="dash-card-head"><h2>Réservations par activité</h2><button type="button" onclick="openStaffDashboardDetail('activity')">Détails</button></div>
        ${renderStaffDashboardActivity(metrics)}
      </article>
      <article class="dash-card">
        <div class="dash-card-head"><h2>Top pistes</h2><button type="button" onclick="cycleDashboardLaneSort()">${escapeHtml(getDashboardLaneSortLabel())}</button></div>
        <div class="dash-lanes">${renderStaffDashboardTopLanes(metrics)}</div>
      </article>
    </section>

    <section class="dash-grid-bottom">
      <article class="dash-card">
        <div class="dash-card-head"><h2>Prochaines arrivées</h2><button type="button" onclick="openStaffDashboardDetail('arrivals')">Voir toutes</button></div>
        <div class="dash-arrivals">${renderStaffDashboardArrivals(metrics)}</div>
      </article>
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
  setupStaffDashboardCharts();
}

function setupStaffDashboardCharts() {
  const root = document.getElementById('staffDashboardPage');
  if (!root) return;
  const hourly = root.querySelector('.dash-line-chart[data-hourly-chart]');
  if (hourly) setupHourlyChartInteraction(hourly);
  const revenue = root.querySelector('.dash-revenue-bars[data-revenue-bars]');
  if (revenue) setupRevenueChartInteraction(revenue);
}

function setupHourlyChartInteraction(container) {
  let data;
  try { data = JSON.parse(container.dataset.hourlyChart || '{}'); } catch (_) { return; }
  const points = Array.isArray(data.pts) ? data.pts : [];
  const svg = container.querySelector('svg');
  const cursor = container.querySelector('.dash-line-cursor');
  if (!points.length || !svg || !cursor) return;
  const cursorLine = cursor.querySelector('line');
  const cursorDots = Array.from(cursor.querySelectorAll('circle'));
  const tip = document.createElement('div');
  tip.className = 'dash-chart-tip';
  tip.setAttribute('role', 'status');
  tip.hidden = true;
  container.appendChild(tip);
  let frame = null;
  let pendingX = null;
  const hide = () => { cursor.style.display = 'none'; tip.hidden = true; };
  const render = clientX => {
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    const svgX = ((clientX - rect.left) / rect.width) * data.w;
    let nearest = points[0];
    let bestDist = Infinity;
    points.forEach(point => {
      const dist = Math.abs(point.x - svgX);
      if (dist < bestDist) { bestDist = dist; nearest = point; }
    });
    cursor.style.display = '';
    cursorLine.setAttribute('x1', nearest.x);
    cursorLine.setAttribute('x2', nearest.x);
    nearest.s.forEach((series, index) => {
      const dot = cursorDots[index];
      if (!dot) return;
      dot.setAttribute('cx', nearest.x);
      dot.setAttribute('cy', series.y);
    });
    tip.innerHTML = `<strong>${escapeHtml(nearest.label)}</strong>${nearest.s.map(series => `<span class="dash-chart-tip-row"><i class="${escapeHtml(series.c)}"></i>${escapeHtml(series.n)}<b>${series.v}%</b></span>`).join('')}`;
    tip.hidden = false;
    const contRect = container.getBoundingClientRect();
    const pxX = (nearest.x / data.w) * contRect.width;
    const left = Math.max(4, Math.min(pxX - tip.offsetWidth / 2, contRect.width - tip.offsetWidth - 4));
    tip.style.left = `${left}px`;
    tip.style.top = `${(data.top / data.h) * contRect.height}px`;
  };
  const schedule = clientX => {
    pendingX = clientX;
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = null; if (pendingX != null) render(pendingX); });
  };
  svg.addEventListener('pointermove', event => schedule(event.clientX));
  svg.addEventListener('pointerdown', event => schedule(event.clientX));
  svg.addEventListener('pointerleave', hide);
  svg.addEventListener('pointercancel', hide);
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
  const cleanPage = normalizeStaffMenuPage(requestedPage);
  if (cleanPage !== requestedPage) {
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
  if (window.location.hash !== route) {
    window.history.replaceState(null, '', route);
  }
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

function getStaffUtilitySyncLabel() {
  const apiText = staffReservationsDataCache.loading || staffClientDataCache.loading || opsAdminCache.loading
    ? 'Synchronisation en cours'
    : (staffReservationsDataCache.loaded || staffClientDataCache.loaded || opsAdminCache.loaded)
      ? 'Données API + locales'
      : 'Données locales disponibles';
  const visibleRows = getStaffUtilityReservations().length;
  const syncState = staffRevisionByDate?.[state.currentDate] ? 'mise à jour active' : 'lecture locale';
  return `${apiText} · ${visibleRows} réservation${visibleRows === 1 ? '' : 's'} visibles · ${syncState}`;
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
        <span>${escapeHtml(getStaffUtilityRiskLabel(reservation))}</span>
      </div>
      <p>${escapeHtml(getReservationLabel(reservation))}</p>
      <small>${escapeHtml(getStaffUtilityResourceSummary(reservation))}</small>
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

function getStaffGroupNextReservation(row = {}) {
  const reservations = getStaffGroupReservations(row).filter(reservation => reservation.status !== 'cancelled');
  const visibleDate = state.currentDate || todayStr();
  return reservations.find(reservation => String(reservation.date || '') >= visibleDate)
    || reservations[reservations.length - 1]
    || row.lastBooking
    || null;
}

function getStaffGroupKind(row = {}) {
  if (row.hasBirthday) return 'Anniversaire';
  if (Number(row.formulas || 0) > 0) return 'Formule';
  if (Number(row.players || 0) >= 30 || Number(row.reservations || 0) >= 3) return 'Groupe regulier';
  return 'Groupe';
}

function getStaffGroupContact(row = {}) {
  if (row.phone && row.email) return `${row.phone} - ${row.email}`;
  if (row.phone) return row.phone;
  if (row.email) return row.email;
  return 'Contact a completer';
}

function formatStaffGroupReservationDate(reservation) {
  if (!reservation?.date) return 'Date inconnue';
  return parseLocalDate(reservation.date)
    .toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric', month: 'short' })
    .replace('.', '');
}

function getStaffGroupAgenda(rows = []) {
  const visibleDate = state.currentDate || todayStr();
  return rows
    .flatMap(row => getStaffGroupReservations(row).map(reservation => ({ row, reservation })))
    .filter(item => item.reservation.status !== 'cancelled' && String(item.reservation.date || '') >= visibleDate)
    .sort((left, right) => {
      const leftKey = `${left.reservation.date || ''} ${left.reservation.startTime || '00:00'}`;
      const rightKey = `${right.reservation.date || ''} ${right.reservation.startTime || '00:00'}`;
      return leftKey.localeCompare(rightKey);
    });
}

function renderStaffGroupWorkspace(rows = []) {
  if (!rows.length) {
    const loading = !!staffClientDataCache.loading;
    const error = staffClientDataCache.error || '';
    const title = loading ? 'Chargement des groupes' : error ? 'Donnees groupes indisponibles' : 'Aucun groupe detecte';
    const subtitle = loading
      ? 'Lecture de l historique reservations sur 24 mois pour consolider anniversaires, ecoles et entreprises.'
      : error
        ? 'La page reste utilisable, mais la consolidation historique doit etre relancee.'
        : 'Les groupes apparaitront ici automatiquement des qu une reservation contient un gros volume, une formule ou un anniversaire.';
    return `<div class="utility-group-workspace utility-group-empty-state">
      <section class="group-command">
        <article class="group-focus">
          <span class="group-label">${loading ? 'Synchronisation' : 'Point de depart'}</span>
          <div class="group-focus-main">
            <span class="group-avatar">${loading ? '...' : 'GR'}</span>
            <div>
              <strong>${escapeHtml(title)}</strong>
              <small>${escapeHtml(subtitle)}</small>
            </div>
          </div>
          <dl class="group-focus-grid">
            <div><dt>Source</dt><dd>${loading ? 'API en cours' : 'Reservations'}</dd></div>
            <div><dt>Portee</dt><dd>Historique centre</dd></div>
            <div><dt>Action</dt><dd>${error ? 'Relancer' : 'Creer groupe'}</dd></div>
          </dl>
          <div class="group-focus-actions">
            ${renderStaffUtilityAction('Nouvelle reservation groupe', "openQuickBook({ date: state.currentDate, type: 'formule' })", 'success')}
            ${renderStaffUtilityAction('Voir les clients', "openStaffMenuPage('clients')")}
            ${renderStaffUtilityAction('Actualiser', 'loadStaffClientData(true)')}
          </div>
        </article>
        <article class="group-agenda">
          <div class="group-section-title"><strong>Ce que cette page suivra</strong><span>Automatique</span></div>
          <div class="group-agenda-list">
            <div class="group-agenda-row"><span>01</span><strong>Anniversaires et ecoles</strong><em>dates, joueurs, formule</em></div>
            <div class="group-agenda-row"><span>02</span><strong>Groupes laser ou bowling</strong><em>volume et ressources</em></div>
            <div class="group-agenda-row"><span>03</span><strong>Relances utiles</strong><em>contact, confirmation, suivi</em></div>
          </div>
        </article>
      </section>
      <section class="group-ledger group-empty-guide">
        <div class="group-ledger-head">
          <div><strong>Mode d emploi staff</strong><span>Simple: creer une reservation, le profil groupe se consolide tout seul.</span></div>
        </div>
        <div class="group-empty-steps">
          <article><strong>1. Identifier</strong><span>Le systeme repere les gros groupes, anniversaires et formules.</span></article>
          <article><strong>2. Preparer</strong><span>Agenda, prochaine visite et contraintes remontent en priorite.</span></article>
          <article><strong>3. Suivre</strong><span>La fiche client garde l historique et les prochaines reservations.</span></article>
        </div>
      </section>
    </div>`;
  }

  const sortedRows = [...rows].sort((left, right) => Number(right.spent || 0) - Number(left.spent || 0));
  const agenda = getStaffGroupAgenda(sortedRows);
  const focusItem = agenda[0] || { row: sortedRows[0], reservation: getStaffGroupNextReservation(sortedRows[0]) };
  const focusReservation = focusItem.reservation || {};
  const followUps = sortedRows
    .filter(row => !row.phone || !row.email || row.hasBirthday || Number(row.formulas || 0) > 0)
    .slice(0, 5);

  return `<div class="utility-group-workspace">
    <section class="group-command">
      <article class="group-focus">
        <span class="group-label">Priorite</span>
        <div class="group-focus-main">
          <span class="group-avatar">${escapeHtml(focusItem.row?.initials || 'GR')}</span>
          <div>
            <strong>${escapeHtml(focusItem.row?.name || 'Groupe')}</strong>
            <small>${escapeHtml(getStaffGroupKind(focusItem.row || {}))} - ${Number(focusItem.row?.players || focusReservation.pax || 0)} joueur(s) cumules</small>
          </div>
        </div>
        <dl class="group-focus-grid">
          <div><dt>Prochaine visite</dt><dd>${escapeHtml(focusReservation.date ? `${formatStaffGroupReservationDate(focusReservation)} - ${getStaffUtilityStartLabel(focusReservation)}` : 'A planifier')}</dd></div>
          <div><dt>Activite</dt><dd>${escapeHtml(focusReservation.id ? getStaffUtilityTypeLabel(focusReservation) : getStaffGroupKind(focusItem.row || {}))}</dd></div>
          <div><dt>Contact</dt><dd>${escapeHtml(getStaffGroupContact(focusItem.row || {}))}</dd></div>
        </dl>
        <div class="group-focus-actions">
          ${focusReservation.id ? renderStaffUtilityAction('Ouvrir reservation', `openStaffReservationDetail(${staffClientJs(focusReservation.id)})`) : ''}
          ${renderStaffUtilityAction('Fiche client', `openStaffMenuPage('clients'); selectStaffClient('${escapeJsString(focusItem.row?.id || '')}')`)}
          ${renderStaffUtilityAction('Nouvelle reservation', `openStaffClientBooking('${escapeJsString(focusItem.row?.id || '')}')`, 'success')}
        </div>
      </article>
      <article class="group-agenda">
        <div class="group-section-title"><strong>Agenda groupes</strong><span>${agenda.length} passage(s) a venir</span></div>
        <div class="group-agenda-list">
          ${(agenda.length ? agenda.slice(0, 6) : sortedRows.slice(0, 3).map(row => ({ row, reservation: getStaffGroupNextReservation(row) || {} }))).map(item => {
            const reservation = item.reservation || {};
            const onclick = reservation.id
              ? `openStaffReservationDetail(${staffClientJs(reservation.id)})`
              : `openStaffMenuPage('clients'); selectStaffClient('${escapeJsString(item.row.id)}')`;
            return `<button type="button" class="group-agenda-row" onclick="${onclick}">
              <span>${escapeHtml(reservation.date ? formatStaffGroupReservationDate(reservation) : 'Sans date')}</span>
              <strong>${escapeHtml(item.row.name || reservation.name || 'Groupe')}</strong>
              <em>${escapeHtml(reservation.id ? `${getStaffUtilityStartLabel(reservation)} - ${Number(reservation.pax || 0)} pers.` : `${Number(item.row.players || 0)} joueurs historique`)}</em>
            </button>`;
          }).join('')}
        </div>
      </article>
    </section>

    <section class="group-ledger">
      <div class="group-ledger-head">
        <div><strong>Groupes exploitables</strong><span>Clients a fort volume, anniversaires et formules.</span></div>
        <button type="button" onclick="exportStaffClientsCsv()">Exporter CSV</button>
      </div>
      <div class="group-table">
        <div class="group-table-head"><span>Groupe</span><span>Prochaine action</span><span>Volume</span><span>Valeur</span><span>Actions</span></div>
        ${sortedRows.slice(0, 14).map(row => {
          const nextReservation = getStaffGroupNextReservation(row);
          const tags = [getStaffGroupKind(row), ...(row.tags || []).filter(Boolean)].slice(0, 3);
          return `<article class="group-table-row">
            <div class="group-identity">
              <span class="group-avatar">${escapeHtml(row.initials || 'GR')}</span>
              <div><strong>${escapeHtml(row.name || 'Groupe')}</strong><small>${escapeHtml(getStaffGroupContact(row))}</small></div>
            </div>
            <div class="group-next">
              <strong>${escapeHtml(nextReservation?.date ? `${formatStaffGroupReservationDate(nextReservation)} - ${getStaffUtilityStartLabel(nextReservation)}` : 'A relancer')}</strong>
              <small>${escapeHtml(nextReservation?.id ? getReservationLabel(nextReservation) : 'Aucune reservation future detectee')}</small>
            </div>
            <div class="group-metrics"><strong>${Number(row.reservations || 0)} res.</strong><small>${Number(row.players || 0)} joueur(s) - ${Number(row.formulas || 0)} formule(s)</small></div>
            <div class="group-value"><strong>${formatMoney(row.spent || 0)}</strong><small>${Number(row.cancellations || 0)} annulation(s)</small></div>
            <div class="group-row-actions">
              ${renderStaffUtilityAction('Fiche', `openStaffMenuPage('clients'); selectStaffClient('${escapeJsString(row.id)}')`)}
              ${renderStaffUtilityAction('Reserver', `openStaffClientBooking('${escapeJsString(row.id)}')`, 'success')}
            </div>
            <div class="group-tags">${tags.map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}</div>
          </article>`;
        }).join('')}
      </div>
    </section>

    <aside class="group-followups">
      <div class="group-section-title"><strong>Relances utiles</strong><span>Ce qui evite les oublis staff.</span></div>
      <div class="group-followup-list">
      ${followUps.length ? followUps.map(row => {
        const reason = !row.phone || !row.email
          ? 'Completer les coordonnees'
          : row.hasBirthday
            ? 'Anniversaire a confirmer'
            : 'Formule a suivre';
        return `<button type="button" class="group-followup-row" onclick="openStaffMenuPage('clients'); selectStaffClient('${escapeJsString(row.id)}')">
          <span>${escapeHtml(reason)}</span>
          <strong>${escapeHtml(row.name || 'Groupe')}</strong>
          <em>${escapeHtml(getStaffGroupContact(row))}</em>
        </button>`;
      }).join('') : `<div class="utility-mini-empty">Aucune relance urgente.</div>`}
      </div>
    </aside>
  </div>`;
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
    renderStaffUtilityPage();
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

function getStaffGroupSizeKey(row = {}, reservation = null) {
  const pax = Number(reservation?.pax || row.maxPax || row.players || 0);
  if (pax >= 60) return 'xl';
  if (pax >= 30) return 'large';
  if (pax >= 12) return 'medium';
  return 'small';
}

function isStaffGroupBusiness(row = {}) {
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
    if (tab === 'regular' && Number(row.reservations || 0) < 2) return false;
    if (tab === 'business' && !isStaffGroupBusiness(row)) return false;
    if (tab === 'followup' && !needsStaffGroupFollowup(row, reservation)) return false;
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
  const regular = allRows.filter(row => Number(row.reservations || 0) >= 2).length;
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

function renderStaffGroupActionsPanel(followUps = []) {
  const rows = followUps.slice(0, 4);
  return `<section class="groups-side-card">
    <div class="groups-side-head"><h3>Actions recommandees</h3><button type="button" onclick="setStaffGroupFilter('tab', 'followup')">Voir tout</button></div>
    <div class="groups-action-list">
      ${rows.length ? rows.map(({ row, reservation }) => {
        const reason = getStaffGroupFollowupReason(row, reservation);
        const activity = getStaffGroupActivityKey(row, reservation);
        return `<article class="groups-action-item">
          <span class="groups-action-icon groups-action-${escapeHtml(activity)}">${renderStaffClientIcon(activity === 'laser' ? 'clock' : activity === 'formule' ? 'star' : 'users')}</span>
          <div><strong>${escapeHtml(reason.label)}</strong><small>${escapeHtml(row.name || 'Groupe')} · ${escapeHtml(reservation?.date ? formatStaffGroupReservationDate(reservation) : 'sans date')}</small></div>
          <button type="button" onclick="${getStaffGroupProfileAction(row, reason.action === 'Planifier' ? 'book' : 'client')}">${escapeHtml(reason.action)}</button>
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

function renderStaffGroupWorkspaceV2(rows = []) {
  if (!rows.length) {
    const loading = !!staffClientDataCache.loading;
    const error = staffClientDataCache.error || '';
    return `<div class="groups-page">
      <section class="groups-empty-state">
        <span>${loading ? 'Synchronisation' : error ? 'Lecture impossible' : 'Aucun groupe'}</span>
        <h2>${loading ? 'Chargement des profils groupes' : error ? 'Donnees groupes indisponibles' : 'Aucun groupe repere pour le moment'}</h2>
        <p>${loading ? 'Pinlane lit les reservations reelles du centre pour consolider anniversaires, ecoles, entreprises et gros volumes.' : error || 'Les profils apparaitront automatiquement quand une reservation contient un gros groupe, une formule ou un anniversaire.'}</p>
        <div>
          ${renderStaffGroupActionButton('Nouvelle reservation groupe', "openQuickBook({ date: state.currentDate, type: 'formule' })", 'primary')}
          ${renderStaffGroupActionButton('Actualiser', 'loadStaffClientData(true)')}
        </div>
      </section>
    </div>`;
  }

  const allRows = [...rows].sort((left, right) => {
    const leftNext = getStaffGroupNextReservation(left);
    const rightNext = getStaffGroupNextReservation(right);
    const leftKey = `${leftNext?.date || '9999-12-31'} ${leftNext?.startTime || '23:59'}`;
    const rightKey = `${rightNext?.date || '9999-12-31'} ${rightNext?.startTime || '23:59'}`;
    const dateDelta = leftKey.localeCompare(rightKey);
    if (dateDelta) return dateDelta;
    return Number(right.spent || 0) - Number(left.spent || 0);
  });
  const filteredRows = getFilteredStaffGroupRows(allRows);
  const agenda = getStaffGroupAgenda(filteredRows.length ? filteredRows : allRows);
  const followUps = (filteredRows.length ? filteredRows : allRows)
    .map(row => ({ row, reservation: getStaffGroupNextReservation(row) || {} }))
    .filter(item => needsStaffGroupFollowup(item.row, item.reservation));
  const focusItem = agenda[0] || {
    row: filteredRows[0] || allRows[0],
    reservation: getStaffGroupNextReservation(filteredRows[0] || allRows[0]) || {}
  };

  return `<div class="groups-page">
    ${renderStaffGroupToolbar(allRows, filteredRows, agenda, followUps)}
    <div class="groups-main-layout">
      <div class="groups-primary-stack">
        ${renderStaffGroupSelected(focusItem)}
        ${renderStaffGroupTable(filteredRows)}
      </div>
      <aside class="groups-side-stack">
        ${renderStaffGroupAgendaPanel(agenda)}
        ${renderStaffGroupActionsPanel(followUps)}
      </aside>
    </div>
  </div>`;
}

function renderStaffUtilityGroupBoard(rows = []) {
  return renderStaffGroupWorkspaceV2(rows);
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
          <button type="button" onclick="openStaffPlanningResource('all')">Voir planning complet</button>
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
        <button type="button" onclick="toggleMaint(${lane}, event)">${status === 'maintenance' ? 'Réactiver' : 'Maintenance'}</button>
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

// Brouillon des overrides ponctuels (jour forcé vacances/normal) pendant
// l'édition : manipulé en direct dans le DOM pour ne pas perdre les autres
// champs non sauvegardés à chaque ajout/retrait.
let establishmentHolidayOverridesDraft = [];

function startEstablishmentEdit() {
  if (!canUseStaffPermission('settings.manage')) { toast('Édition réservée à la direction.'); return; }
  const center = getEstablishmentCenter();
  establishmentHolidayOverridesDraft = (center?.holidaySettings?.overrides || [])
    .filter(item => item && item.date && (item.mode === 'holiday' || item.mode === 'normal'))
    .map(item => ({ date: item.date, mode: item.mode }));
  state.establishmentEditing = true;
  renderStaffUtilityPage();
}

function cancelEstablishmentEdit() {
  state.establishmentEditing = false;
  establishmentHolidayOverridesDraft = [];
  renderStaffUtilityPage();
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

async function submitCenterConfig(centerId) {
  if (!canUseStaffPermission('settings.manage')) { toast('Édition réservée à la direction.'); return; }
  const regular = collectEstablishmentScheduleBlock('estab-day');
  const holiday = collectEstablishmentScheduleBlock('estab-hday');
  const activityAvailability = {};
  (staffCenterConfigCache.activities || []).forEach(activity => {
    activityAvailability[activity.id] = !!document.getElementById(`estab-act-${activity.id}`)?.checked;
  });
  // Panneau « Offres & formules » : map générique offerId -> booléen,
  // appliquée aussi côté serveur (une formule décochée n'est plus réservable).
  const offerAvailability = {};
  FORMULES.forEach(formule => {
    offerAvailability[formule.id] = !!document.getElementById(`estab-offer-${formule.id}`)?.checked;
  });
  const formulaBlockedPeriods = ['manual'];
  if (document.getElementById('estab-fbp-public')?.checked) formulaBlockedPeriods.push('public');
  if (document.getElementById('estab-fbp-short')?.checked) formulaBlockedPeriods.push('school_short');
  if (document.getElementById('estab-fbp-summer')?.checked) formulaBlockedPeriods.push('school_summer');
  const config = {
    status: establishmentInputValue('estab-status', 'active'),
    resources: {
      bowling: {
        laneCount: Number(establishmentInputValue('estab-laneCount', 8)),
        normalCapacityPerLane: Number(establishmentInputValue('estab-normalCap', 6)),
        emergencyCapacityPerLane: Number(establishmentInputValue('estab-emergencyCap', 7))
      },
      laser: {
        weaponCount: Number(establishmentInputValue('estab-weaponCount', 30)),
        parallelLaunches: Number(establishmentInputValue('estab-launches', 1))
      }
    },
    defaultSchedule: { regular, holiday },
    holidaySettings: {
      enabled: !!document.getElementById('estab-holiday-enabled')?.checked,
      overrides: establishmentHolidayOverridesDraft.map(item => ({ date: item.date, mode: item.mode })),
      formulaBlockedPeriods
    },
    offerAvailability,
    activityAvailability
  };
  const name = establishmentInputValue('estab-name').trim();
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
  try {
    await apiRequest(API_ENDPOINTS.ops, { method: 'POST', body: JSON.stringify({ action: 'setCenterStatus', centerId, status }) });
    toast(status === 'closed' ? 'Centre archivé.' : 'Statut mis à jour.');
    await loadStaffCenterConfig(true);
  } catch (error) {
    toast(error?.message || 'Changement de statut impossible.');
  }
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
  const holidaySettings = center.holidaySettings && typeof center.holidaySettings === 'object'
    ? center.holidaySettings
    : { enabled: true, overrides: [], formulaBlockedPeriods: ['public', 'school_short', 'manual'] };
  const blockedPeriods = Array.isArray(holidaySettings.formulaBlockedPeriods)
    ? holidaySettings.formulaBlockedPeriods
    : ['public', 'school_short', 'manual'];
  const statusLabels = { active: 'Actif', planned: 'Prévu', closed: 'Archivé' };
  return `<div class="establishment-page">
    <section class="establishment-selector">
      <div class="establishment-selector-head">
        <div><h2>Centres</h2><p>${centers.length} centre${centers.length > 1 ? 's' : ''} · sélectionne un centre pour voir ou modifier sa configuration</p></div>
      </div>
      <div class="establishment-center-list">
        ${centers.map(c => `<button type="button" class="establishment-center-chip ${c.id === center.id ? 'active' : ''}" onclick="selectEstablishmentCenter('${escapeJsString(c.id)}')">
          <span class="establishment-chip-top">
            <strong>${escapeHtml(c.name)}</strong>
            <span class="establishment-status establishment-status-${escapeHtml(c.status)}">${escapeHtml(statusLabels[c.status] || c.status)}</span>
          </span>
          <small>${Number(c.resources?.bowling?.laneCount || 0)} pistes · ${Number(c.resources?.laser?.weaponCount || 0)} armes laser</small>
        </button>`).join('')}
        ${canEdit ? `<div class="establishment-add">
          <span>Ajouter un centre</span>
          <input type="text" id="estab-new-id" placeholder="Identifiant (ex : namur)" autocomplete="off">
          <input type="text" id="estab-new-name" placeholder="Nom du centre" autocomplete="off">
          <button type="button" class="btn btn-secondary btn-sm" onclick="submitNewCenter()">Ajouter</button>
        </div>` : ''}
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
            ? `<button type="button" class="btn btn-primary" onclick="submitCenterConfig('${escapeJsString(center.id)}')">Enregistrer</button>
               <button type="button" class="btn btn-ghost btn-sm" onclick="cancelEstablishmentEdit()">Annuler</button>`
            : canEdit
              ? `<button type="button" class="btn btn-primary" onclick="startEstablishmentEdit()">Modifier</button>
                 ${center.status !== 'closed'
                   ? `<button type="button" class="btn btn-ghost btn-sm" onclick="setEstablishmentCenterStatus('${escapeJsString(center.id)}', 'closed')">Archiver</button>`
                   : `<button type="button" class="btn btn-secondary btn-sm" onclick="setEstablishmentCenterStatus('${escapeJsString(center.id)}', 'active')">Réactiver</button>`}`
              : `<span class="establishment-readonly">Lecture seule — édition réservée à la direction.</span>`}
        </div>
      </div>

      ${editing ? `<div class="establishment-grid">
        <fieldset class="establishment-card">
          <legend>Identité</legend>
          <div class="field"><label for="estab-name">Nom du centre</label><input type="text" id="estab-name" value="${escapeHtml(center.name)}"></div>
          <div class="field"><label for="estab-status">Statut</label>
            <select id="estab-status">
              <option value="active" ${center.status === 'active' ? 'selected' : ''}>Actif</option>
              <option value="planned" ${center.status === 'planned' ? 'selected' : ''}>Prévu</option>
              <option value="closed" ${center.status === 'closed' ? 'selected' : ''}>Archivé</option>
            </select>
          </div>
        </fieldset>

        <fieldset class="establishment-card">
          <legend>Bowling</legend>
          <div class="field"><label for="estab-laneCount">Nombre de pistes</label><input type="number" id="estab-laneCount" min="1" max="40" value="${Number(bowling.laneCount || 8)}"></div>
          <div class="field"><label for="estab-normalCap">Joueurs confort / piste</label><input type="number" id="estab-normalCap" min="1" max="12" value="${Number(bowling.normalCapacityPerLane || 6)}"></div>
          <div class="field"><label for="estab-emergencyCap">Joueurs max / piste (secours)</label><input type="number" id="estab-emergencyCap" min="1" max="15" value="${Number(bowling.emergencyCapacityPerLane || 7)}"></div>
        </fieldset>

        <fieldset class="establishment-card">
          <legend>Laser Game</legend>
          <div class="field"><label for="estab-weaponCount">Nombre d'armes</label><input type="number" id="estab-weaponCount" min="0" max="200" value="${Number(laser.weaponCount || 0)}"></div>
          <div class="field"><label for="estab-launches">Lancements parallèles</label><input type="number" id="estab-launches" min="1" max="20" value="${Number(laser.parallelLaunches || 1)}"></div>
        </fieldset>

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

        <fieldset class="establishment-card establishment-offers">
          <legend>Offres &amp; formules</legend>
          <p class="estab-card-hint">Une offre décochée disparaît de l'espace client et n'est plus réservable (blocage aussi côté serveur).</p>
          ${(() => {
            const families = [];
            FORMULES.forEach(formule => {
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
                      <input type="checkbox" id="estab-offer-${escapeHtml(formule.id)}" ${enabled ? 'checked' : ''} onchange="this.closest('.establishment-activity').classList.toggle('on', this.checked)">
                      <span>${escapeHtml(formule.name)} · ${Number(formule.price)}€/${formule.type === 'per_lane' ? 'piste' : 'pers.'}</span>
                    </label>`;
                  }).join('')}
                </div>
              </div>`).join('');
          })()}
        </fieldset>

        <fieldset class="establishment-card establishment-activities">
          <legend>Activités disponibles</legend>
          <div class="establishment-activity-grid">
            ${(staffCenterConfigCache.activities || []).map(activity => `<label class="establishment-activity ${center.activityAvailability?.[activity.id] ? 'on' : ''}">
              <input type="checkbox" id="estab-act-${escapeHtml(activity.id)}" ${center.activityAvailability?.[activity.id] ? 'checked' : ''} onchange="this.closest('.establishment-activity').classList.toggle('on', this.checked)">
              <span>${escapeHtml(activity.label)}</span>
            </label>`).join('')}
          </div>
        </fieldset>
      </div>` : renderEstablishmentReadView(center)}
    </section>
  </div>`;
}

function renderEstablishmentReadView(center) {
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
  const disabledOffers = FORMULES.filter(formule => center.offerAvailability?.[formule.id] === false);
  const kv = (label, value) => `<div class="establishment-kv"><span>${escapeHtml(label)}</span><strong>${value}</strong></div>`;
  const num = (v) => `<span class="num">${escapeHtml(String(v))}</span>`;
  const hoursGrid = (block) => ESTABLISHMENT_DAYS.map(([key, label]) => {
    const slot = block[key];
    const value = slot && slot.open && slot.close
      ? `<span class="num">${escapeHtml(slot.open)}</span> → <span class="num">${escapeHtml(slot.close)}</span>`
      : '<span class="establishment-closed-tag">Fermé</span>';
    return kv(label, value);
  }).join('');
  return `<div class="establishment-readview">
    <div class="establishment-read-card establishment-resources-read">
      <h3>Ressources</h3>
      <div class="establishment-resources-cols">
        <div class="establishment-resource-col">
          <h4>Bowling</h4>
          ${kv('Pistes', num(Number(bowling.laneCount || 0)))}
          ${kv('Joueurs confort / piste', num(Number(bowling.normalCapacityPerLane || 0)))}
          ${kv('Joueurs max / piste (secours)', num(Number(bowling.emergencyCapacityPerLane || 0)))}
        </div>
        <div class="establishment-resource-col">
          <h4>Laser Game</h4>
          ${kv('Armes disponibles', num(Number(laser.weaponCount || 0)))}
          ${kv('Lancements parallèles', num(Number(laser.parallelLaunches || 0)))}
        </div>
      </div>
    </div>
    <div class="establishment-read-card establishment-hours-read">
      <h3>Horaires normaux</h3>
      <div class="establishment-hours-grid">${hoursGrid(regular)}</div>
    </div>
    <div class="establishment-read-card establishment-hours-read">
      <h3>Horaires vacances &amp; fériés</h3>
      <p class="establishment-read-hint">${holidaySettings.enabled !== false
        ? 'Appliqués automatiquement les fériés belges et congés scolaires FWB.'
        : 'Application automatique désactivée — uniquement via les exceptions ponctuelles.'}</p>
      <div class="establishment-hours-grid">${hoursGrid(holiday)}</div>
      ${kv('Formules anniversaires bloquées', blockedLabel.length ? escapeHtml(blockedLabel.join(', ')) : 'jamais')}
      ${overrides.length ? `<div class="establishment-read-tags">${overrides.map(item => `<span>${escapeHtml(item.date)} · ${item.mode === 'holiday' ? 'vacances/férié' : 'jour normal'}</span>`).join('')}</div>` : ''}
    </div>
    <div class="establishment-read-card establishment-activities-read">
      <h3>Offres &amp; formules</h3>
      ${disabledOffers.length
        ? `<p class="establishment-read-hint">Désactivées : </p><div class="establishment-read-tags">${disabledOffers.map(formule => `<span>${escapeHtml(formule.name)}</span>`).join('')}</div>`
        : '<p class="establishment-read-empty">Toutes les offres sont actives côté client.</p>'}
    </div>
    <div class="establishment-read-card establishment-activities-read">
      <h3>Activités disponibles</h3>
      ${enabled.length
        ? `<div class="establishment-read-tags">${enabled.map(activity => `<span>${escapeHtml(activity.label)}</span>`).join('')}</div>`
        : '<p class="establishment-read-empty">Aucune activité activée.</p>'}
    </div>
  </div>`;
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
  {
    id: 'maintenance',
    name: 'Technique',
    code: 'TE',
    summary: 'Pistes, laser et incidents',
    description: 'Pour signaler une piste ou une session sans accès commercial.',
    tone: 'tech',
    permissions: ['dashboard.view', 'planning.view', 'planning.bowling', 'planning.laser', 'planning.drag', 'reservations.view']
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

function ensureStaffAccessControl() {
  const current = state.staffAccessControl && typeof state.staffAccessControl === 'object'
    ? state.staffAccessControl
    : {};
  const presetRoles = STAFF_ROLE_PRESETS.map(cloneStaffRolePreset);
  const roleMap = new Map(presetRoles.map(role => [role.id, role]));
  (Array.isArray(current.roles) ? current.roles : []).forEach(role => {
    if (!role || !role.id) return;
    const preset = roleMap.get(role.id);
    roleMap.set(role.id, {
      ...(preset || {}),
      ...role,
      permissions: Array.isArray(role.permissions) ? [...new Set(role.permissions)] : (preset?.permissions || []),
      accessCode: role.accessCode || createStaffAccessCode(role.code || role.name || 'FG'),
      updatedAt: role.updatedAt || new Date().toISOString()
    });
  });
  const roles = [...roleMap.values()];
  const selectedRoleId = roles.some(role => role.id === current.selectedRoleId) ? current.selectedRoleId : 'manager';
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
    if (response.accessControl) state.staffAccessControl = response.accessControl;
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
  if (!access.roles.some(role => role.id === roleId)) return;
  access.selectedRoleId = roleId;
  save();
  renderStaffUtilityPage();
}

async function toggleStaffRolePermission(roleId, permission, checked) {
  const role = getStaffAccessRole(roleId);
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
  if (!role || !preset || role.id === 'direction') return;
  await runStaffAuthAction('setRolePreset', { roleId, presetId }, 'Preset appliqué.');
}

function closeStaffAccessModal() {
  const overlay = document.getElementById('staffAccessModalOverlay');
  if (overlay) overlay.remove();
  document.removeEventListener('keydown', handleStaffAccessModalKeydown, true);
}

function handleStaffAccessModalKeydown(event) {
  if (event.key !== 'Escape') return;
  event.stopPropagation();
  closeStaffAccessModal();
}

function openStaffAccessModal(kind) {
  closeStaffAccessModal();
  const access = ensureStaffAccessControl();
  const selectedRole = getStaffAccessRole(access.selectedRoleId);
  const isRole = kind === 'role';
  const overlay = document.createElement('div');
  overlay.id = 'staffAccessModalOverlay';
  overlay.className = 'overlay-backdrop staff-access-modal-overlay';
  overlay.innerHTML = `
    <form class="modal-surface staff-access-modal" role="dialog" aria-modal="true" aria-labelledby="staffAccessModalTitle" onsubmit="submitStaffAccessModal(event, '${isRole ? 'role' : 'member'}')">
      <div>
        <h3 id="staffAccessModalTitle">${isRole ? 'Créer un rôle' : 'Créer un accès staff'}</h3>
        <p>${isRole
          ? 'Le rôle démarre avec Dashboard et Réservations, puis s’affine permission par permission.'
          : `Le membre reçoit le rôle « ${escapeHtml(selectedRole.name)} » et un code d’accès personnel.`}</p>
      </div>
      <div class="field">
        <label for="staffAccessModalName">${isRole ? 'Nom du rôle' : 'Nom du membre'}</label>
        <input id="staffAccessModalName" type="text" required autocomplete="off" placeholder="${isRole ? 'Ex : Responsable anniversaires' : 'Ex : Camille Dupont'}">
      </div>
      ${isRole ? '' : `<div class="field">
        <label for="staffAccessModalContact">Contact — email, téléphone ou identifiant interne</label>
        <input id="staffAccessModalContact" type="text" autocomplete="off" placeholder="Ex : camille@fungalaxy.be">
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
  closeStaffAccessModal();
  if (kind === 'role') {
    await runStaffAuthAction('createRole', {
      name,
      permissions: ['dashboard.view', 'reservations.view']
    }, 'Rôle créé.');
    return;
  }
  const access = ensureStaffAccessControl();
  const selectedRole = getStaffAccessRole(access.selectedRoleId);
  await runStaffAuthAction('createMember', {
    name,
    contact,
    roleId: selectedRole.id
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
  if (!member || !access.roles.some(role => role.id === roleId)) return;
  await runStaffAuthAction('updateMemberRole', { memberId, roleId }, 'Rôle du membre mis à jour.');
}

async function toggleStaffMemberStatus(memberId) {
  const access = ensureStaffAccessControl();
  const member = access.members.find(item => item.id === memberId);
  if (!member) return;
  await runStaffAuthAction('toggleMemberStatus', { memberId }, member.status === 'blocked' ? 'Accès activé.' : 'Accès bloqué.');
}

async function regenerateStaffAccessCode(roleId) {
  const role = getStaffAccessRole(roleId);
  if (!role) return;
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

function renderStaffUtilityUsers() {
  const access = ensureStaffAccessControl();
  const selectedRole = getStaffAccessRole(access.selectedRoleId);
  const selectedPermissions = getStaffRolePermissionSet(selectedRole.id);
  const allPermissions = getStaffPermissionKeys();
  const activeMembers = access.members.filter(member => member.status === 'active');
  const accessiblePages = getStaffRoleAccessiblePages(selectedRole.id);
  const rawAccessCode = String(selectedRole.accessCode || '');
  const codeAlreadyMasked = rawAccessCode.includes('••');
  const displayedCode = rawAccessCode
    ? (staffAccessCodeRevealed || codeAlreadyMasked ? rawAccessCode : maskStaffAccessCode(rawAccessCode))
    : 'À générer';
  return `<div class="staff-access-console">
    <section class="staff-access-grid">
      <aside class="staff-role-rail" aria-label="Rôles staff">
        ${access.roles.map(role => {
          const count = (role.permissions || []).length;
          const activeCount = access.members.filter(member => member.roleId === role.id && member.status === 'active').length;
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
            </div>
          </div>
          <div class="staff-code-card">
            <span>Code d’accès rôle</span>
            <strong>${escapeHtml(displayedCode)}</strong>
            <div>
              ${rawAccessCode && !codeAlreadyMasked ? `<button type="button" class="btn btn-secondary btn-sm" aria-pressed="${staffAccessCodeRevealed ? 'true' : 'false'}" onclick="toggleStaffAccessCodeVisibility()">${staffAccessCodeRevealed ? 'Masquer' : 'Afficher'}</button>` : ''}
              <button type="button" class="btn btn-secondary btn-sm" onclick='copyStaffAccessCode(${staffClientJs(rawAccessCode)})'>Copier</button>
              <button type="button" class="btn btn-secondary btn-sm" onclick='regenerateStaffAccessCode(${staffClientJs(selectedRole.id)})'>Régénérer</button>
            </div>
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
          <span>Ce rôle ouvre</span>
          <div class="staff-access-page-list">
            ${accessiblePages.map(page => `<span class="${page.allowed ? 'allowed' : 'blocked'}">${escapeHtml(page.label)}</span>`).join('')}
          </div>
        </section>
        <section class="staff-member-panel">
          <div class="staff-member-head">
            <div><strong>Membres</strong><small>${activeMembers.length} actif${activeMembers.length > 1 ? 's' : ''} · ${access.members.length} total</small></div>
            <button type="button" class="btn btn-secondary btn-sm" onclick="createStaffMember()">Ajouter</button>
          </div>
          <div class="staff-member-list">
            ${access.members.map(member => {
              const role = getStaffAccessRole(member.roleId);
              const [statusLabel, statusBadge] = STAFF_MEMBER_STATUS_META[member.status] || ['Statut inconnu', 'badge-neutral'];
              const lastSeenLabel = member.lastSeen ? `Vu ${formatOpsTimestamp(member.lastSeen)}` : 'Jamais connecté';
              return `<article class="staff-member-card ${escapeHtml(member.status || 'active')}">
                <div class="staff-member-top">
                  <span class="staff-person-icon tone-${escapeHtml(role.tone || 'custom')}">${escapeHtml(getStaffClientInitials(member.name || role.name))}</span>
                  <div><strong>${escapeHtml(member.name)}</strong><small>${escapeHtml(member.contact || member.code || 'Code interne')}</small></div>
                  <span class="badge ${statusBadge}">${statusLabel}</span>
                </div>
                <span class="staff-member-last-seen">${escapeHtml(lastSeenLabel)}</span>
                <select aria-label="Rôle de ${escapeHtml(member.name)}" onchange='updateStaffMemberRole(${staffClientJs(member.id)}, this.value)'>
                  ${access.roles.map(roleOption => `<option value="${escapeHtml(roleOption.id)}" ${roleOption.id === member.roleId ? 'selected' : ''}>${escapeHtml(roleOption.name)}</option>`).join('')}
                </select>
                <footer>
                  <button type="button" class="btn btn-secondary btn-sm staff-member-code" onclick='copyStaffAccessCode(${staffClientJs(member.code || '')})'>${escapeHtml(member.code || 'Copier code')}</button>
                  <button type="button" class="btn btn-ghost btn-sm" onclick='toggleStaffMemberStatus(${staffClientJs(member.id)})'>${member.status === 'active' ? 'Bloquer' : 'Activer'}</button>
                </footer>
              </article>`;
            }).join('')}
          </div>
        </section>
        <section class="staff-access-log">
          <strong>Journal sécurité</strong>
          ${(access.events.length ? access.events : [{ label: 'Aucun changement récent.', at: '' }]).slice(0, 5).map(event => `<p><span>${escapeHtml(event.at ? formatOpsTimestamp(event.at) : 'Maintenant')}</span>${escapeHtml(event.label)}</p>`).join('')}
        </section>
      </aside>
    </section>
  </div>`;
}

function renderStaffUtilitySettings() {
  const currentTheme = state.staffTheme === 'light' ? 'Clair' : 'Sombre';
  return `<div class="utility-settings-console">
    <article><span>Interface</span><strong>Thème ${escapeHtml(currentTheme)}</strong><p>Mode staff persistant sur ce poste.</p><div><button type="button" onclick="setStaffTheme('dark')">Sombre</button><button type="button" onclick="setStaffTheme('light')">Clair</button></div></article>
    <article><span>Données</span><strong>${state.reservations.length} réservation(s)</strong><p>Actualise planning, mails et état staff.</p><div><button type="button" onclick="refreshStaffPlanning()">Actualiser</button><button type="button" onclick="exportStaffPlanningCsv()">Exporter</button></div></article>
    <article><span>Ops</span><strong>${opsAdminCache.loaded ? 'Console chargée' : 'Console prête'}</strong><p>Mails, agents et suggestions terrain.</p><div><button type="button" onclick="loadOpsAdmin(true)">Charger Ops</button><button type="button" onclick="openStaffMenuPage('emails')">Emails</button></div></article>
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
  const groupRows = clientRows.filter(row => row.isGroup || row.hasBirthday);
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
  if (page === 'groups') {
    return {
      ...base,
      layout: 'groups',
      eyebrow: 'Groupes & anniversaires',
      title: 'Groupes & anniversaires',
      subtitle: 'Suivi operationnel des groupes, anniversaires, entreprises et actions commerciales.',
      panelSubtitle: `${groupRows.length} profil${groupRows.length > 1 ? 's' : ''} consolidé${groupRows.length > 1 ? 's' : ''} · ${groupRows.reduce((sum, row) => sum + Number(row.players || 0), 0)} joueur(s) cumulés · suivi groupes prêt terrain`,
      hidePanelHead: true,
      kpis: [
        ['Groupes', groupRows.length, 'profils actifs'],
        ['Joueurs cumulés', groupRows.reduce((sum, row) => sum + Number(row.players || 0), 0), 'historique'],
        ['Formules', groupRows.reduce((sum, row) => sum + Number(row.formulas || 0), 0), 'réservées'],
        ['CA groupe', formatMoney(groupRows.reduce((sum, row) => sum + Number(row.spent || 0), 0)), 'historique']
      ],
      body: renderStaffUtilityGroupBoard(groupRows)
    };
  }
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
      primaryAction: "setView('admin'); setAdminTab('overview')",
      body: renderStaffUtilityEstablishment()
    };
  }
  if (page === 'users') {
    const access = ensureStaffAccessControl();
    const selectedRole = getStaffAccessRole(access.selectedRoleId);
    const permissionTotal = getStaffPermissionKeys().length;
    const selectedPermissionCount = new Set(selectedRole.permissions || []).size;
    const activeMembers = access.members.filter(member => member.status === 'active').length;
    const pendingMembers = access.members.filter(member => member.status === 'pending').length;
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
        ['Rôles', access.roles.length, 'presets + personnalisés'],
        ['Staff actif', activeMembers, `${pendingMembers} en attente`],
        ['Permissions du rôle', `${selectedPermissionCount}/${permissionTotal}`, selectedRole.name],
        ['Codes actifs', access.roles.filter(role => role.accessCode).length + access.members.filter(member => member.code).length, 'rôles et membres']
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
        ['Thème', state.staffTheme === 'light' ? 'Clair' : 'Sombre', 'préférence locale'],
        ['Réservations', state.reservations.length, 'local + API'],
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
  const heroSubtitle = model.hidePanelHead
    ? escapeHtml(model.subtitle)
    : `${escapeHtml(model.subtitle)} · ${escapeHtml(dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1))}`;
  const overviewPages = new Set(['users', 'settings']);
  const archivePages = new Set(['groups', 'contacts']);
  const panelHead = model.hidePanelHead ? '' : `<div class="utility-panel-head">
        <div>
          <h2>${escapeHtml(model.title)}</h2>
          <p>${escapeHtml(model.panelSubtitle || getStaffUtilitySyncLabel())}</p>
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
        ${model.hideDateAction ? '' : `<button type="button" onclick="openStaffDatePicker(event)">Changer date</button>`}
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
  if ((model.page === 'emails' || model.page === 'settings' || model.page === 'establishment') && !opsAdminCache.loaded && !opsAdminCache.loading) loadOpsAdmin(false);
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
  const formulas = FORMULES.map(formule => {
    const special = formule.family !== 'Formules anniversaires';
    return decorate({
      id: `formula-${formule.id}`,
      sourceId: formule.id,
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
  return getPricingRows().filter(row => {
    if (filter !== 'all' && row.type !== filter) return false;
    if (!query) return true;
    return `${row.title} ${row.subtitle} ${row.description} ${row.tags.join(' ')}`.toLowerCase().includes(query);
  });
}

function getPricingMetrics(rows = getPricingRows()) {
  const revenue = rows.reduce((sum, row) => sum + Number(row.revenue || 0), 0);
  const reservations = rows.reduce((sum, row) => sum + Number(row.count || 0), 0);
  const formulaRows = rows.filter(row => row.type === 'formula' || row.type === 'special');
  const activeOffers = rows.length;
  const topRow = [...rows].sort((a, b) => Number(b.count || 0) - Number(a.count || 0))[0] || null;
  return { revenue, reservations, activeOffers, formulaRows: formulaRows.length, topRow };
}

function setStaffPricingFilter(filter) {
  state.staffPricingFilter = ['all', 'bowling', 'laser', 'formula', 'special'].includes(filter) ? filter : 'all';
  save();
  renderStaffPricingPage();
}

function setStaffPricingQuery(value) {
  state.staffPricingQuery = value || '';
  renderStaffPricingPage();
}

function selectStaffPricing(id) {
  state.staffPricingSelectedId = id || '';
  save();
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
  downloadTextFile(`fungalaxy-tarifs-formules-${state.currentDate || todayStr()}.csv`, [header.map(csvCell).join(','), ...body].join('\n'), 'text/csv;charset=utf-8');
}

function copyStaffPricingSummary() {
  const rows = getPricingRowsFiltered();
  const summary = rows.map(row => `${row.title}: ${getPricingPriceLabel(row)} (${row.availability})`).join('\n');
  navigator.clipboard?.writeText(summary).then(() => toast('Tarifs copiés.')).catch(() => toast(summary));
}

function renderStaffPricingKpi(asset, label, value, detail, tone) {
  return `<article class="pricing-kpi ${escapeHtml(tone)}">
    <span class="pricing-kpi-media"><img src="${escapeHtml(asset)}" alt=""></span>
    <div>
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(detail)}</small>
    </div>
  </article>`;
}

function renderStaffPricingFilterButton(key, label, count) {
  const active = (state.staffPricingFilter || 'all') === key;
  return `<button type="button" class="${active ? 'active' : ''}" onclick="setStaffPricingFilter('${key}')">
    <span>${escapeHtml(label)}</span><em>${Number(count || 0)}</em>
  </button>`;
}

function renderStaffPricingRow(row, selected) {
  const tags = row.tags.slice(0, 3).map(tag => `<em>${escapeHtml(tag)}</em>`).join('');
  return `<button type="button" class="pricing-row ${escapeHtml(row.type)} ${selected ? 'selected' : ''}" onclick="selectStaffPricing('${escapeJsString(row.id)}')">
    <span class="pricing-row-main">
      <span class="pricing-row-visual"><img src="${escapeHtml(row.asset)}" alt=""></span>
      <span class="pricing-row-copy">
        <strong>${escapeHtml(row.title)}</strong>
        <small><em>${escapeHtml(getPricingTypeLabel(row.type))}</em>${escapeHtml(row.subtitle)} · ${escapeHtml(row.durationLabel)}</small>
        <span class="pricing-row-tags-inline">${tags}</span>
      </span>
    </span>
    <span class="pricing-cell price">${escapeHtml(getPricingPriceLabel(row))}${row.oldPrice ? `<small>${formatMoney(row.oldPrice)}</small>` : ''}</span>
    <span class="pricing-cell">${escapeHtml(row.capacity)}</span>
    <span class="pricing-cell">${Number(row.count || 0)} rés.<small>${formatMoney(row.revenue || 0)}</small></span>
  </button>`;
}

function renderStaffPricingDetail(row) {
  if (!row) {
    return `<aside class="pricing-detail empty"><h2>Aucun tarif</h2><p>Aucune offre ne correspond au filtre actuel.</p></aside>`;
  }
  const activityItems = (row.activities || []).slice(0, 6);
  const noteItems = row.notes?.length ? row.notes : [row.availability, row.capacity];
  return `<aside class="pricing-detail ${escapeHtml(row.type)}">
    <div class="pricing-detail-visual">
      <img src="${escapeHtml(row.asset)}" alt="">
      <div>
        <span>${escapeHtml(getPricingTypeLabel(row.type))}</span>
        <strong>${escapeHtml(row.durationLabel)}</strong>
      </div>
    </div>
    <div class="pricing-detail-head">
      <span>${escapeHtml(getPricingTypeLabel(row.type))}</span>
      <h2>${escapeHtml(row.title)}</h2>
      <p>${escapeHtml(row.description)}</p>
    </div>
    <div class="pricing-detail-price">
      <strong>${escapeHtml(getPricingPriceLabel(row))}</strong>
      ${row.oldPrice ? `<span>Ancien prix ${formatMoney(row.oldPrice)}</span>` : `<span>Tarif actif</span>`}
    </div>
    <div class="pricing-detail-stats">
      <div><strong>${Number(row.count || 0)}</strong><span>Réservations</span></div>
      <div><strong>${Number(row.players || 0)}</strong><span>Joueurs</span></div>
      <div><strong>${formatMoney(row.revenue || 0)}</strong><span>Prévu</span></div>
    </div>
    <div class="pricing-detail-section">
      <h3>Contenu</h3>
      <div class="pricing-activity-list">
        ${activityItems.length ? activityItems.map(item => `<span>${escapeHtml(item)}</span>`).join('') : `<span>${escapeHtml(row.description)}</span>`}
      </div>
    </div>
    <div class="pricing-detail-section">
      <h3>Conditions terrain</h3>
      <div class="pricing-note-list">
        ${noteItems.map(item => `<span>${escapeHtml(item)}</span>`).join('')}
      </div>
    </div>
    <div class="pricing-detail-actions">
      <button type="button" class="primary" onclick="openStaffPricingBooking('${escapeJsString(row.id)}')">Créer une réservation</button>
      <button type="button" onclick="state.staffMenuPage='planning'; save(); renderStaff(); syncOpsSidebar();">Voir planning</button>
    </div>
  </aside>`;
}

function renderStaffPricingPage() {
  const root = document.getElementById('staffPricingPage');
  if (!root) return;
  const allRows = getPricingRows();
  const rows = getPricingRowsFiltered();
  const selected = getSelectedPricingRow(rows);
  if (selected && state.staffPricingSelectedId !== selected.id) state.staffPricingSelectedId = selected.id;
  const metrics = getPricingMetrics(allRows);
  const countByType = type => allRows.filter(row => row.type === type).length;
  const queryValue = escapeHtml(state.staffPricingQuery || '');
  root.innerHTML = `
    <section class="pricing-hero">
      <div>
        <h1>Tarifs & formules</h1>
        <p>Catalogue opérationnel, prix publics et contraintes de réservation.</p>
      </div>
      <div class="pricing-actions">
        <label class="pricing-search">
          <span>⌕</span>
          <input value="${queryValue}" placeholder="Rechercher une formule, activité, condition..." oninput="setStaffPricingQuery(this.value)">
        </label>
        <button type="button" onclick="copyStaffPricingSummary()">Copier</button>
        <button type="button" onclick="exportStaffPricingCsv()">Exporter CSV</button>
        <button type="button" class="primary" onclick="openStaffPricingBooking('${escapeJsString(selected?.id || '')}')">+ Réservation</button>
      </div>
    </section>

    <section class="pricing-kpis">
      ${renderStaffPricingKpi('./assets/pricing/special.png', 'Offres actives', String(metrics.activeOffers), `${metrics.formulaRows} formules`, 'violet')}
      ${renderStaffPricingKpi('./assets/pricing/bowling.png', 'Réservations liées', String(metrics.reservations), 'sur toutes les données locales', 'blue')}
      ${renderStaffPricingKpi('./assets/pricing/formula.png', 'Chiffre associé', formatMoney(metrics.revenue), 'réservations non annulées', 'green')}
      ${renderStaffPricingKpi(metrics.topRow?.asset || './assets/pricing/bowling.png', 'Plus demandé', metrics.topRow?.title || 'Aucun', `${metrics.topRow?.count || 0} réservation(s)`, 'amber')}
    </section>

    <section class="pricing-workspace">
      <article class="pricing-list-panel">
        <div class="pricing-tabs">
          ${renderStaffPricingFilterButton('all', 'Tout', allRows.length)}
          ${renderStaffPricingFilterButton('bowling', 'Bowling', countByType('bowling'))}
          ${renderStaffPricingFilterButton('laser', 'Laser Game', countByType('laser'))}
          ${renderStaffPricingFilterButton('formula', 'Anniversaires', countByType('formula'))}
          ${renderStaffPricingFilterButton('special', 'Spéciales', countByType('special'))}
        </div>
        <div class="pricing-table-head">
          <span>Offre</span><span>Prix</span><span>Capacité</span><span>Usage</span>
        </div>
        <div class="pricing-list">
          ${rows.length ? rows.map(row => renderStaffPricingRow(row, selected && row.id === selected.id)).join('') : `<div class="pricing-empty">Aucun tarif ne correspond à cette recherche.</div>`}
        </div>
      </article>
      ${renderStaffPricingDetail(selected)}
    </section>
  `;
}

function staffEmailJs(value) {
  return escapeHtml(JSON.stringify(String(value || '')).replace(/</g, '\\u003c'));
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
  return getVisibleOpsCommunications()
    .map((item, index) => ({
      ...item,
      uid: getStaffEmailId(item, index),
      sourceIndex: index,
      statusKind: getStaffEmailStatusKind(item),
      templateLabel: getOpsTemplateLabel(item.templateId)
    }));
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
  const query = String(state.staffEmailQuery || '').trim().toLowerCase();
  return getStaffEmailRows().filter(row => {
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

function setStaffEmailFilter(filter) {
  state.staffEmailFilter = ['all', 'queued', 'sent', 'failed', 'review'].includes(filter) ? filter : 'all';
  state.staffEmailSelectedId = '';
  save();
  renderStaffEmailsPage();
}

function setStaffEmailQuery(query = '') {
  state.staffEmailQuery = String(query || '');
  state.staffEmailSelectedId = '';
  save();
  renderStaffEmailsPage();
}

function setStaffEmailTemplateFilter(templateId = 'all') {
  state.staffEmailTemplateFilter = templateId || 'all';
  state.staffEmailSelectedId = '';
  save();
  renderStaffEmailsPage();
}

function selectStaffEmail(id) {
  state.staffEmailSelectedId = String(id || '');
  save();
  renderStaffEmailsPage();
}

function getSelectedStaffEmailRow(rows = getStaffEmailRowsFiltered()) {
  if (!rows.length) return null;
  const selected = rows.find(row => row.uid === state.staffEmailSelectedId);
  return selected || rows[0];
}

function getStaffEmailReservation(row = {}) {
  const payload = row.payload || {};
  const reservationId = row.reservationId || payload.reservationId || payload.reservation_id;
  const source = typeof getStaffReservationsSourceReservations === 'function'
    ? getStaffReservationsSourceReservations()
    : (state.reservations || []);
  if (reservationId) {
    const byId = source.find(reservation => String(reservation.id) === String(reservationId));
    if (byId) return byId;
  }
  const recipient = String(row.recipient || '').trim().toLowerCase();
  if (recipient) {
    const byEmail = source.find(reservation => String(reservation.email || '').trim().toLowerCase() === recipient);
    if (byEmail) return byEmail;
  }
  const phone = String(payload.phone || payload.clientPhone || '').replace(/\D/g, '');
  if (phone) {
    return source.find(reservation => String(reservation.phone || '').replace(/\D/g, '').endsWith(phone.slice(-8))) || null;
  }
  return null;
}

function openStaffEmailReservation(id) {
  const row = getStaffEmailRows().find(item => item.uid === String(id));
  const reservation = row ? getStaffEmailReservation(row) : null;
  if (!reservation) {
    toast('Réservation liée introuvable dans les données chargées.');
    return;
  }
  openStaffReservationDetail(reservation.id);
}

function previewStaffEmail(id) {
  const row = getStaffEmailRows().find(item => item.uid === String(id));
  if (!row) return;
  previewOpsEmail(row.sourceIndex, 'communication-visible');
}

function copyStaffEmailDiagnostic(id) {
  const row = getStaffEmailRows().find(item => item.uid === String(id));
  if (!row) return;
  const reservation = getStaffEmailReservation(row);
  const diagnostic = [
    `Sujet: ${row.subject || getOpsTemplateLabel(row.templateId)}`,
    `Statut: ${getStaffEmailStatusLabel(row)} (${row.status || 'inconnu'})`,
    `Destinataire: ${row.recipient || 'manquant'}`,
    `Modele: ${getOpsTemplateLabel(row.templateId)}`,
    `Tentatives: ${Number(row.attempts || 0)}`,
    `Planifie: ${formatOpsTimestamp(row.scheduledAt || row.createdAt)}`,
    `Envoye: ${row.sentAt ? formatOpsTimestamp(row.sentAt) : 'non'}`,
    `Erreur: ${row.lastError || 'aucune'}`,
    reservation ? `Reservation: #${reservation.id} ${reservation.name || ''} ${reservation.date || ''} ${reservation.startTime || ''}` : 'Reservation: non trouvee'
  ].join('\n');
  const writer = navigator.clipboard?.writeText
    ? navigator.clipboard.writeText(diagnostic)
    : Promise.reject(new Error('Clipboard indisponible.'));
  writer
    .then(() => toast('Diagnostic mail copié.'))
    .catch(() => toast(diagnostic));
}

function exportStaffEmailsCsv() {
  const rows = getStaffEmailRowsFiltered();
  const header = ['Statut', 'Modele', 'Sujet', 'Destinataire', 'Canal', 'Planifie', 'Envoye', 'Tentatives', 'Erreur'];
  const body = rows.map(row => [
    getStaffEmailStatusLabel(row),
    getOpsTemplateLabel(row.templateId),
    row.subject || '',
    row.recipient || '',
    row.channel || 'email',
    row.scheduledAt || '',
    row.sentAt || '',
    Number(row.attempts || 0),
    row.lastError || ''
  ].map(csvCell).join(','));
  downloadTextFile(`fungalaxy-mails-${state.currentDate || todayStr()}.csv`, [header.map(csvCell).join(','), ...body].join('\n'), 'text/csv;charset=utf-8');
}

function formatStaffEmailDate(value) {
  if (!value) return 'Non planifié';
  return formatOpsTimestamp(value);
}

function getStaffEmailTiming(row = {}) {
  if (row.statusKind === 'sent' && row.sentAt) return `Envoyé ${formatStaffEmailDate(row.sentAt)}`;
  if (row.statusKind === 'failed') return row.lastError ? 'Erreur à traiter' : 'Échec envoi';
  if (row.scheduledAt) {
    const due = new Date(row.scheduledAt).getTime() <= Date.now();
    return due ? `À envoyer maintenant` : `Planifié ${formatStaffEmailDate(row.scheduledAt)}`;
  }
  return `Créé ${formatStaffEmailDate(row.createdAt)}`;
}

function renderStaffEmailIcon(name) {
  const icons = {
    queued: '<path d="M12 6v6l4 2"></path><circle cx="12" cy="12" r="8"></circle>',
    sent: '<path d="M5 12.5 9.2 17 19 7"></path>',
    failed: '<path d="M12 8v5"></path><path d="M12 17h.01"></path><circle cx="12" cy="12" r="8"></circle>',
    review: '<path d="M8 7h8"></path><path d="M8 11h8"></path><path d="M8 15h5"></path><rect x="5" y="4" width="14" height="16" rx="2"></rect>',
    mail: '<rect x="4" y="6" width="16" height="12" rx="2"></rect><path d="m5 8 7 5 7-5"></path>',
    search: '<circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path>',
    export: '<path d="M12 3v11"></path><path d="m8 10 4 4 4-4"></path><path d="M5 20h14"></path>'
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.mail}</svg>`;
}

function renderStaffEmailMetric(kind, label, value, detail) {
  return `<article class="email-metric ${escapeHtml(kind)}">
    <span>${renderStaffEmailIcon(kind)}</span>
    <div>
      <small>${escapeHtml(label)}</small>
      <strong>${escapeHtml(value)}</strong>
      <em>${escapeHtml(detail)}</em>
    </div>
  </article>`;
}

function renderStaffEmailFilterButton(key, label, count) {
  const active = (state.staffEmailFilter || 'all') === key;
  return `<button type="button" class="${active ? 'active' : ''}" onclick="setStaffEmailFilter('${escapeJsString(key)}')">
    <span>${escapeHtml(label)}</span><em>${Number(count || 0)}</em>
  </button>`;
}

function renderStaffEmailTemplateButtons(rows = []) {
  const templateIds = [...new Set(rows.map(row => row.templateId || '').filter(Boolean))].slice(0, 6);
  const active = state.staffEmailTemplateFilter || 'all';
  return `<div class="email-template-tabs">
    <button type="button" class="${active === 'all' ? 'active' : ''}" onclick="setStaffEmailTemplateFilter('all')">Tous modèles</button>
    ${templateIds.map(templateId => `<button type="button" class="${active === templateId ? 'active' : ''}" onclick="setStaffEmailTemplateFilter(${staffEmailJs(templateId)})">${escapeHtml(getOpsTemplateLabel(templateId))}</button>`).join('')}
  </div>`;
}

function renderStaffEmailRow(row, selected) {
  const reservation = getStaffEmailReservation(row);
  const reservationLabel = reservation
    ? `${reservation.name || 'Client'} · ${reservation.date || ''} ${reservation.startTime || ''}`.trim()
    : 'Aucune réservation chargée';
  return `<button type="button" class="email-row ${escapeHtml(row.statusKind)} ${row.templateId === 'staff_review_request' ? 'review' : ''} ${selected ? 'selected' : ''}" onclick="selectStaffEmail(${staffEmailJs(row.uid)})">
    <span class="email-row-status">
      <span class="email-status-dot" aria-hidden="true"></span>
      <strong>${escapeHtml(getStaffEmailStatusLabel(row))}</strong>
      <small>${Number(row.attempts || 0)} tentative${Number(row.attempts || 0) > 1 ? 's' : ''}</small>
    </span>
    <span class="email-row-main">
      <strong>${escapeHtml(row.subject || getOpsTemplateLabel(row.templateId))}</strong>
      <small>${escapeHtml(getOpsTemplateLabel(row.templateId))} · ${escapeHtml(row.recipient || 'destinataire manquant')}</small>
      <em>${escapeHtml(reservationLabel)}</em>
    </span>
    <span class="email-row-time">
      <strong>${escapeHtml(getStaffEmailTiming(row))}</strong>
      <small>${escapeHtml(row.channel || 'email')}</small>
    </span>
  </button>`;
}

function renderStaffEmailDetail(row) {
  if (!row) {
    return `<aside class="email-detail empty">
      <h2>Aucun message</h2>
      <p>Les confirmations, rappels, validations et erreurs s'afficheront ici dès qu'une réservation génère un mail.</p>
    </aside>`;
  }
  const reservation = getStaffEmailReservation(row);
  const payload = row.payload || {};
  const actionText = row.statusKind === 'failed'
    ? 'Corriger le destinataire ou la configuration, puis relancer la file.'
    : row.statusKind === 'queued'
      ? 'Message en attente. Envoyer la file vérifie uniquement les mails arrivés à échéance.'
      : row.statusKind === 'sent'
        ? 'Message envoyé. Garder le suivi pour historique client et direction.'
        : 'Message à surveiller.';
  return `<aside class="email-detail ${escapeHtml(row.statusKind)}">
    <div class="email-detail-head">
      <span class="email-detail-icon">${renderStaffEmailIcon(row.templateId === 'staff_review_request' ? 'review' : row.statusKind)}</span>
      <div>
        <small>${escapeHtml(getOpsTemplateLabel(row.templateId))}</small>
        <h2>${escapeHtml(row.subject || getOpsTemplateLabel(row.templateId))}</h2>
        <p>${escapeHtml(row.recipient || 'Destinataire manquant')}</p>
      </div>
    </div>
    <div class="email-detail-grid">
      <div><small>Statut</small><strong>${escapeHtml(getStaffEmailStatusLabel(row))}</strong></div>
      <div><small>Canal</small><strong>${escapeHtml(row.channel || 'email')}</strong></div>
      <div><small>Planifié</small><strong>${escapeHtml(formatStaffEmailDate(row.scheduledAt || row.createdAt))}</strong></div>
      <div><small>Envoyé</small><strong>${escapeHtml(row.sentAt ? formatStaffEmailDate(row.sentAt) : 'Non')}</strong></div>
    </div>
    ${row.lastError ? `<div class="email-alert"><strong>Erreur</strong><span>${escapeHtml(row.lastError)}</span></div>` : ''}
    <div class="email-detail-section">
      <h3>Réservation liée</h3>
      ${reservation ? `
        <div class="email-linked-reservation">
          <strong>#${escapeHtml(reservation.id)} · ${escapeHtml(reservation.name || 'Client')}</strong>
          <span>${escapeHtml(reservation.date || '')} · ${escapeHtml(reservation.startTime || '')} · ${escapeHtml(getReservationLabel(reservation))}</span>
        </div>` : `<p>Aucune réservation locale trouvée pour ce message. Le mail reste visible avec son destinataire et son identifiant.</p>`}
    </div>
    <div class="email-detail-section">
      <h3>Prochaine action</h3>
      <p>${escapeHtml(actionText)}</p>
      ${payload.textBody ? `<blockquote>${escapeHtml(String(payload.textBody).slice(0, 260))}${String(payload.textBody).length > 260 ? '...' : ''}</blockquote>` : ''}
    </div>
    <div class="email-detail-actions">
      <button type="button" class="primary" onclick="previewStaffEmail(${staffEmailJs(row.uid)})">Prévisualiser</button>
      <button type="button" onclick="copyStaffEmailDiagnostic(${staffEmailJs(row.uid)})">Copier diagnostic</button>
      <button type="button" ${reservation ? '' : 'disabled'} onclick="openStaffEmailReservation(${staffEmailJs(row.uid)})">Voir réservation</button>
    </div>
  </aside>`;
}

function renderStaffEmailSamples() {
  const samples = opsAdminCache.samples || [];
  if (!samples.length) return '';
  return `<section class="email-samples">
    <div>
      <h2>Modèles disponibles</h2>
      <p>Prévisualisations officielles utilisées par le moteur de communication.</p>
    </div>
    <div class="email-sample-list">
      ${samples.map((sample, index) => `<button type="button" onclick="previewOpsEmail(${index}, 'sample')">
        <strong>${escapeHtml(sample.subject || getOpsTemplateLabel(sample.templateId))}</strong>
        <span>${escapeHtml(getOpsTemplateLabel(sample.templateId))}</span>
      </button>`).join('')}
    </div>
  </section>`;
}

function renderStaffEmailsPage(errorMessage = '') {
  const root = document.getElementById('staffEmailsPage');
  if (!root) return;
  if (!opsAdminCache.loaded && !opsAdminCache.loading) {
    setTimeout(() => loadOpsAdmin(false), 0);
  }
  const allRows = getStaffEmailRows();
  const rows = getStaffEmailRowsFiltered();
  const selected = getSelectedStaffEmailRow(rows);
  if (selected && state.staffEmailSelectedId !== selected.uid) state.staffEmailSelectedId = selected.uid;
  const metrics = getStaffEmailMetrics(allRows);
  const filteredMetrics = getStaffEmailMetrics(rows);
  const queryValue = escapeHtml(state.staffEmailQuery || '');
  const updatedAt = opsAdminCache.lastLoadedAt ? formatOpsTimestamp(opsAdminCache.lastLoadedAt) : 'Non chargé';
  const loading = opsAdminCache.loading && !opsAdminCache.loaded;
  root.innerHTML = `
    <section class="emails-hero">
      <div>
        <span class="emails-eyebrow">Communication opérationnelle</span>
        <h1>Emails</h1>
        <p>Suivi des confirmations, rappels, validations staff, erreurs et modèles envoyés depuis les réservations.</p>
      </div>
      <div class="emails-actions">
        <label class="emails-search">
          ${renderStaffEmailIcon('search')}
          <input value="${queryValue}" placeholder="Rechercher un client, sujet, erreur..." oninput="setStaffEmailQuery(this.value)">
        </label>
        <button type="button" onclick="loadOpsAdmin(true)">Actualiser</button>
        <button type="button" onclick="exportStaffEmailsCsv()">Exporter</button>
        <button type="button" class="primary" onclick="dispatchOpsEmails()">Envoyer la file</button>
      </div>
    </section>

    ${errorMessage ? `<div class="email-page-alert">${escapeHtml(errorMessage)}</div>` : ''}

    <section class="email-metrics">
      ${renderStaffEmailMetric('queued', 'En file', String(metrics.queued), `${metrics.due} prêt(s) à partir`)}
      ${renderStaffEmailMetric('sent', 'Envoyés', String(metrics.sent), `${metrics.deliveryRate}% de réussite`)}
      ${renderStaffEmailMetric('failed', 'À corriger', String(metrics.failed), `${metrics.attempted} tentative(s)`)}
      ${renderStaffEmailMetric('review', 'Validations', String(metrics.review), 'messages staff')}
      ${renderStaffEmailMetric('mail', 'Rappels', String(metrics.reminders), '48h avant venue')}
    </section>

    <section class="emails-workspace">
      <article class="emails-list-panel">
        <div class="emails-list-head">
          <div>
            <h2>File et historique</h2>
            <p>${loading ? 'Chargement des données Ops...' : `${rows.length} message(s) affiché(s) sur ${allRows.length} · actualisé ${updatedAt}`}</p>
          </div>
          <span>${filteredMetrics.failed ? `${filteredMetrics.failed} à corriger` : 'File propre'}</span>
        </div>
        <div class="emails-tabs">
          ${renderStaffEmailFilterButton('all', 'Tout', allRows.length)}
          ${renderStaffEmailFilterButton('queued', 'En file', metrics.queued)}
          ${renderStaffEmailFilterButton('sent', 'Envoyés', metrics.sent)}
          ${renderStaffEmailFilterButton('failed', 'Échecs', metrics.failed)}
          ${renderStaffEmailFilterButton('review', 'Validations', metrics.review)}
        </div>
        ${renderStaffEmailTemplateButtons(allRows)}
        <div class="email-table-head">
          <span>Statut</span><span>Message</span><span>Échéance</span>
        </div>
        <div class="email-row-list">
          ${loading ? `
            <div class="email-loading"><span></span><span></span><span></span></div>
            <div class="email-loading"><span></span><span></span><span></span></div>
            <div class="email-loading"><span></span><span></span><span></span></div>
          ` : rows.length ? rows.map(row => renderStaffEmailRow(row, selected && selected.uid === row.uid)).join('') : `
            <div class="email-empty">
              <strong>Aucun mail ne correspond aux filtres.</strong>
              <span>Retirez la recherche ou changez de modèle pour revoir la file complète.</span>
            </div>`}
        </div>
      </article>
      ${renderStaffEmailDetail(selected)}
    </section>
    ${renderStaffEmailSamples()}
  `;
}

function staffCampaignJs(value) {
  return JSON.stringify(String(value || '')).replace(/</g, '\\u003c');
}

function getStaffCampaignChannel() {
  return STAFF_CAMPAIGN_CHANNELS.includes(state.staffCampaignChannel) ? state.staffCampaignChannel : 'linkedin';
}

function getStaffCampaignAgent(channel = getStaffCampaignChannel()) {
  return STAFF_SOCIAL_AGENTS[channel] || STAFF_SOCIAL_AGENTS.linkedin;
}

function getStaffCampaignCenterIds() {
  return ['libramont', 'gembloux'];
}

function getStaffCampaignCenter(centerId) {
  const fallback = STAFF_CAMPAIGN_CENTERS[centerId] || STAFF_CAMPAIGN_CENTERS.libramont;
  const live = (typeof getAdminCenters === 'function' ? getAdminCenters() : ADMIN_CENTER_FALLBACKS).find(center => center.id === fallback.id) || {};
  return {
    ...fallback,
    resources: live.resources || ADMIN_CENTER_FALLBACKS.find(center => center.id === fallback.id)?.resources || {},
    status: live.status || fallback.status || 'active'
  };
}

function getStaffCampaignCenters() {
  return getStaffCampaignCenterIds().map(getStaffCampaignCenter);
}

function getStaffCampaignReservationCenterId(reservation) {
  return reservation.centerId || reservation.center_id || state.adminCenterId || 'libramont';
}

function getStaffCampaignReservations(centerId = '') {
  const rows = (state.reservations || []).filter(reservation => reservation.status !== 'cancelled');
  if (!centerId) return rows;
  return rows.filter(reservation => getStaffCampaignReservationCenterId(reservation) === centerId);
}

function getStaffCampaignMonthReservations(centerId = '') {
  const monthKey = getMonthKey(state.currentDate || todayStr());
  return getStaffCampaignReservations(centerId).filter(reservation => getMonthKey(reservation.date) === monthKey);
}

function getStaffCampaignQuietDays(reservations = getStaffCampaignReservations()) {
  const anchor = state.currentDate || todayStr();
  return Array.from({ length: 14 }, (_, index) => addDays(anchor, index)).map(date => {
    const dayReservations = reservations.filter(reservation => reservation.date === date);
    return {
      date,
      count: dayReservations.length,
      players: dayReservations.reduce((sum, reservation) => sum + (Number(reservation.pax) || 0), 0)
    };
  }).filter(day => day.count <= 2).slice(0, 5);
}

function getStaffCampaignSnapshot() {
  const reservations = getStaffCampaignReservations();
  const monthReservations = getStaffCampaignMonthReservations();
  const clients = typeof getStaffClientRows === 'function' ? getStaffClientRows() : [];
  const upcoming = reservations.filter(reservation => reservation.date >= (state.currentDate || todayStr())).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const bowling = monthReservations.filter(reservation => getBowlingWindowsFromReservation(reservation).length > 0);
  const laser = monthReservations.filter(reservation => getLaserWindowsFromReservation(reservation).length > 0);
  const formulas = monthReservations.filter(reservation => normalizeBookingType(reservation.type) === 'formula' || String(reservation.formuleId || '').trim());
  const groups = clients.filter(client => client.isGroup || Number(client.players || 0) >= 8);
  const loyal = clients.filter(client => client.statusClass === 'loyal');
  const monthRevenue = monthReservations.reduce((sum, reservation) => sum + (Number(reservation.price) || 0), 0);
  const quietDays = getStaffCampaignQuietDays(reservations);
  const centers = getStaffCampaignCenters().map(center => {
    const centerReservations = getStaffCampaignReservations(center.id);
    const centerMonthReservations = getStaffCampaignMonthReservations(center.id);
    const centerRevenue = centerMonthReservations.reduce((sum, reservation) => sum + (Number(reservation.price) || 0), 0);
    return {
      center,
      reservations: centerReservations,
      monthReservations: centerMonthReservations,
      bowling: centerMonthReservations.filter(reservation => getBowlingWindowsFromReservation(reservation).length > 0),
      laser: centerMonthReservations.filter(reservation => getLaserWindowsFromReservation(reservation).length > 0),
      formulas: centerMonthReservations.filter(reservation => normalizeBookingType(reservation.type) === 'formula' || String(reservation.formuleId || '').trim()),
      quietDays: getStaffCampaignQuietDays(centerReservations),
      revenue: centerRevenue,
      players: centerMonthReservations.reduce((sum, reservation) => sum + (Number(reservation.pax) || 0), 0)
    };
  });
  return {
    reservations,
    monthReservations,
    clients,
    upcoming,
    bowling,
    laser,
    formulas,
    groups,
    loyal,
    quietDays,
    centers,
    monthRevenue,
    players: monthReservations.reduce((sum, reservation) => sum + (Number(reservation.pax) || 0), 0),
    averageTicket: monthReservations.length ? monthRevenue / monthReservations.length : 0,
  };
}

function buildStaffCampaignIdeas(snapshot = getStaffCampaignSnapshot()) {
  const quietDay = snapshot.quietDays[0];
  const nextFormula = snapshot.formulas.find(reservation => reservation.date >= (state.currentDate || todayStr()));
  const nextLaser = snapshot.laser.find(reservation => reservation.date >= (state.currentDate || todayStr()));
  const nextGroup = snapshot.upcoming.find(reservation => Number(reservation.pax || 0) >= 8);
  const monthName = parseLocalDate(state.currentDate || todayStr()).toLocaleDateString('fr-BE', { month: 'long' });
  const ideas = [
    {
      id: 'anniversaires',
      objective: 'anniversaires',
      title: 'Anniversaires sans stress',
      segment: 'Parents et familles',
      channel: 'facebook',
      score: 94,
      source: `${snapshot.groups.length} groupe(s) repérés dans les réservations`,
      promise: 'Faire comprendre que Fun Galaxy organise une vraie sortie complète avec des activités vérifiées par centre.',
      angle: `Mettre en avant les anniversaires, les formules, les activités réelles et la simplicité pour les parents.`,
      cta: 'Demander les disponibilités anniversaire'
    },
    {
      id: 'calme',
      objective: 'calme',
      title: quietDay ? `Remplir ${formatCampaignDate(quietDay.date)}` : 'Remplir les créneaux calmes',
      segment: 'Clients locaux disponibles en semaine',
      channel: 'email',
      score: quietDay ? 88 : 72,
      source: quietDay ? `${quietDay.count} réservation(s), ${quietDay.players} joueur(s)` : 'Analyse des 14 prochains jours',
      promise: 'Transformer les jours faibles en offres simples, claires et limitées.',
      angle: quietDay ? `Proposer une sortie facile sur ${formatCampaignDate(quietDay.date)} sans casser les prix.` : 'Relancer les créneaux calmes avec un message court et concret.',
      cta: 'Réserver un créneau calme'
    },
    {
      id: 'groupes',
      objective: 'groupes',
      title: 'Sorties équipe et groupes',
      segment: 'Entreprises, écoles, clubs',
      channel: 'linkedin',
      score: nextGroup ? 91 : 78,
      source: nextGroup ? `Un groupe de ${nextGroup.pax} personne(s) prévu le ${formatCampaignDate(nextGroup.date)}` : `${snapshot.groups.length} client(s) groupe dans l'historique`,
      promise: 'Vendre le centre comme solution clé en main pour une sortie de groupe.',
      angle: "Montrer que le centre aide à organiser bowling, laser et activités complémentaires sans inventer une offre sur mesure.",
      cta: 'Organiser une sortie groupe'
    },
    {
      id: 'laser',
      objective: 'laser',
      title: 'Laser Game partagé',
      segment: 'Ados, groupes, familles',
      channel: 'facebook',
      score: nextLaser ? 86 : 70,
      source: nextLaser ? `Prochaine session laser ${formatCampaignDate(nextLaser.date)} à ${nextLaser.startTime || '--'}` : `${snapshot.laser.length} session(s) laser ce mois`,
      promise: 'Dédramatiser les sessions partagées et rendre le laser plus lisible.',
      angle: "Expliquer que les groupes peuvent jouer avec d'autres personnes selon l'affluence, sans promettre une session privée.",
      cta: 'Voir les départs Laser Game'
    },
    {
      id: 'formules',
      objective: 'formules',
      title: 'Formules bowling + laser',
      segment: 'Clients qui veulent une sortie complète',
      channel: 'linkedin',
      score: nextFormula ? 90 : 76,
      source: `${snapshot.formulas.length} formule(s) sur ${monthName}`,
      promise: "Faire comprendre la valeur d'une formule sans noyer le client dans les contraintes.",
      angle: "Insister sur le choix de l'ordre des activités et la flexibilité sur place.",
      cta: 'Comparer les formules'
    },
    {
      id: 'fidelisation',
      objective: 'fidelisation',
      title: 'Retour des habitués',
      segment: 'Clients fidèles',
      channel: 'email',
      score: snapshot.loyal.length ? 84 : 62,
      source: `${snapshot.loyal.length} client(s) fidèle(s) dans la base`,
      promise: 'Créer un message simple qui donne envie de revenir sans parler comme une publicité.',
      angle: 'Remercier, rappeler une bonne expérience et proposer un nouveau moment.',
      cta: 'Revenir cette semaine'
    }
  ];
  return ideas.sort((left, right) => (right.objective === state.staffCampaignObjective ? 20 : 0) + right.score - ((left.objective === state.staffCampaignObjective ? 20 : 0) + left.score));
}

function getStaffCampaignIdeaById(id) {
  const saved = (state.marketingCampaigns || []).find(campaign => campaign.id === id);
  if (saved) return saved;
  return buildStaffCampaignIdeas().find(idea => idea.id === id) || buildStaffCampaignIdeas()[0];
}

function getSelectedStaffCampaignIdea() {
  const ideas = buildStaffCampaignIdeas();
  const selected = getStaffCampaignIdeaById(state.staffCampaignSelectedId);
  return selected || ideas[0];
}

function formatCampaignDate(dateStr) {
  if (!dateStr) return 'date à choisir';
  return parseLocalDate(dateStr).toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric', month: 'short' }).replace('.', '');
}

function renderCampaignIcon(name) {
  const icons = {
    calendar: '<rect x="4" y="5" width="16" height="15" rx="2"></rect><path d="M8 3v4M16 3v4M4 10h16"></path>',
    users: '<circle cx="8" cy="8" r="3"></circle><path d="M3.5 19c.7-3.5 2.4-5.2 4.5-5.2s3.8 1.7 4.5 5.2"></path><path d="M16 10a2.6 2.6 0 1 0 0-5"></path><path d="M17 14c1.7.6 2.8 2.2 3.2 5"></path>',
    euro: '<path d="M17 6.5A6 6 0 1 0 17 17.5"></path><path d="M7 10h8M7 14h7"></path>',
    spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z"></path>',
    send: '<path d="M21 3 10 14"></path><path d="m21 3-7 18-4-7-7-4 18-7z"></path>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"></rect><rect x="4" y="4" width="11" height="11" rx="2"></rect>',
    plus: '<path d="M12 5v14M5 12h14"></path>',
    filter: '<path d="M4 6h16M7 12h10M10 18h4"></path>',
    linkedin: '<path d="M6 9v10"></path><path d="M6 5.5v.01"></path><path d="M11 19v-5.5a3 3 0 0 1 6 0V19"></path><path d="M11 9v10"></path>',
    facebook: '<path d="M14 8h2V4h-3a4 4 0 0 0-4 4v3H7v4h2v5h4v-5h3l1-4h-4V8a1 1 0 0 1 1-1z"></path>',
    instagram: '<rect x="4" y="4" width="16" height="16" rx="5"></rect><circle cx="12" cy="12" r="3.2"></circle><path d="M16.8 7.2v.01"></path>',
    tiktok: '<path d="M14 4v9.2a4 4 0 1 1-3-3.9"></path><path d="M14 4c.8 2.7 2.5 4.2 5 4.4"></path>',
    mail: '<rect x="4" y="6" width="16" height="12" rx="2"></rect><path d="m5 8 7 5 7-5"></path>',
    shield: '<path d="M12 3 5 6v5c0 4.4 2.8 8.3 7 10 4.2-1.7 7-5.6 7-10V6l-7-3z"></path><path d="m9 12 2 2 4-5"></path>'
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.spark}</svg>`;
}

function renderStaffCampaignMetric(icon, label, value, detail) {
  return `<article class="campaign-metric">
    <span>${renderCampaignIcon(icon)}</span>
    <div><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong><em>${escapeHtml(detail)}</em></div>
  </article>`;
}

function renderStaffCampaignObjectiveButton(key, label) {
  const active = state.staffCampaignObjective === key;
  return `<button type="button" class="${active ? 'active' : ''}" onclick="setStaffCampaignObjective('${escapeJsString(key)}')">${escapeHtml(label)}</button>`;
}

function renderStaffCampaignChannelButton(key, label) {
  const active = state.staffCampaignChannel === key;
  const agent = getStaffCampaignAgent(key);
  return `<button type="button" class="${active ? 'active' : ''}" onclick="setStaffCampaignChannel('${escapeJsString(key)}')" title="${escapeHtml(agent.name)}">${renderCampaignIcon(agent.icon)} ${escapeHtml(label)}</button>`;
}

function renderStaffCampaignIdea(idea) {
  const selected = idea.id === (getSelectedStaffCampaignIdea()?.id || '');
  return `<button type="button" class="campaign-idea ${selected ? 'selected' : ''}" onclick="selectStaffCampaignIdea(${staffCampaignJs(idea.id)})">
    <span><strong>${escapeHtml(idea.title)}</strong><em>${escapeHtml(idea.segment)}</em></span>
    <small>${Number(idea.score || 0)}/100</small>
    <p>${escapeHtml(idea.source || '')}</p>
  </button>`;
}

function getStaffCampaignActivitiesForIdea(idea, center) {
  const activities = center.approvedActivities || [];
  const picks = {
    anniversaires: ['Formules anniversaires', 'Bowling 8 pistes', 'Laser Game 30 armes', 'Mini Golf Blacklight', 'Arcades', 'Plaine de jeux'],
    calme: ['Bowling 8 pistes', 'Laser Game 30 armes', 'Mini Golf Blacklight', 'Arcades'],
    groupes: ['Bowling 8 pistes', 'Laser Game 30 armes', 'Mini Golf Blacklight', 'Arcades', "Golf o'Clock"],
    laser: ['Laser Game 30 armes'],
    formules: ['Formules anniversaires', 'Bowling 8 pistes', 'Laser Game 30 armes', 'Mini Golf Blacklight', 'Arcades', 'Plaine de jeux'],
    fidelisation: ['Bowling 8 pistes', 'Laser Game 30 armes', 'Mini Golf Blacklight', 'Arcades']
  }[idea.objective] || activities;
  return picks.filter(activity => activities.includes(activity));
}

function getStaffCampaignCenterStats(centerId, snapshot = getStaffCampaignSnapshot()) {
  return snapshot.centers.find(item => item.center.id === centerId) || snapshot.centers[0];
}

function getStaffCampaignSafeBrief(center) {
  const raw = String(state.staffCampaignBrief || '').trim();
  if (!raw) return '';
  const lower = raw.toLowerCase();
  const forbidden = (center.forbiddenClaims || []).some(claim => lower.includes(String(claim).toLowerCase()));
  return forbidden ? '' : raw;
}

function getStaffCampaignProofLine(idea, center, centerStats) {
  if (!centerStats) return center.practicalFacts[0] || '';
  if (idea.objective === 'laser') {
    const launches = center.resources?.laser?.parallelLaunches || (center.id === 'gembloux' ? 3 : 1);
    return `${center.name}: ${center.resources?.laser?.weaponCount || 30} armes Laser Game, ${launches} lancement(s) configuré(s).`;
  }
  if (idea.objective === 'formules') {
    return `${FORMULES.filter(formula => formula.family === 'Formules anniversaires').length} formules anniversaires référencées dans le système.`;
  }
  if (idea.objective === 'calme' && centerStats.quietDays[0]) {
    return `${formatCampaignDate(centerStats.quietDays[0].date)} ressort comme un créneau plus calme pour ${center.city}.`;
  }
  if (idea.objective === 'groupes') {
    return `${center.name}: bowling 8 pistes et Laser Game 30 armes pour organiser les groupes sans inventer d’activité.`;
  }
  return `${center.name}: ${center.approvedActivities.slice(0, 4).join(', ')}.`;
}

function getStaffCampaignCta(idea, center, channel) {
  if (channel === 'email') return `Répondez à ce message avec le nombre de personnes et la date souhaitée.`;
  if (channel === 'tiktok' || channel === 'instagram') return `Réservez ou demandez les disponibilités pour ${center.city}.`;
  return `${idea.cta} à ${center.city}.`;
}

function buildStaffCampaignCopyForCenter(idea, center, channel, snapshot = getStaffCampaignSnapshot()) {
  const agent = getStaffCampaignAgent(channel);
  const centerStats = getStaffCampaignCenterStats(center.id, snapshot);
  const activities = getStaffCampaignActivitiesForIdea(idea, center);
  const safeBrief = getStaffCampaignSafeBrief(center);
  const proof = getStaffCampaignProofLine(idea, center, centerStats);
  const activityLine = activities.length ? activities.join(', ') : center.approvedActivities.slice(0, 4).join(', ');
  const cta = getStaffCampaignCta(idea, center, channel);
  const briefLine = safeBrief ? `Note terrain à intégrer: ${safeBrief}` : '';
  const subject = `${idea.title} à ${center.city}`;
  const base = {
    centerId: center.id,
    centerName: center.name,
    city: center.city,
    channel,
    agentName: agent.name,
    subject,
    factsUsed: [
      proof,
      `Activités autorisées: ${activityLine}.`,
      center.laserAdvice
    ].filter(Boolean),
    guardrails: [
      'Ne pas inventer d’activité, de promotion, de client ou d’événement.',
      `Ne pas mentionner: ${(center.forbiddenClaims || []).join(', ')}.`,
      'Ne pas promettre de session privée Laser Game si ce n’est pas validé par le staff.'
    ],
    alternatives: [
      { label: 'Direct', text: `${center.name}: ${activityLine}. ${cta}` },
      { label: 'Famille', text: `Une sortie simple à ${center.city}, avec des activités indoor claires et réservables.` },
      { label: 'Plus pro', text: `Pour vos groupes à ${center.city}, Fun Galaxy aide à organiser les activités sans multiplier les échanges.` }
    ]
  };

  if (channel === 'linkedin') {
    return {
      ...base,
      text: [
        `Organiser une sortie de groupe, ce n’est pas seulement bloquer une heure dans un planning.`,
        '',
        `À ${center.city}, ${center.name} permet de construire une sortie indoor autour de vraies activités du centre: ${activityLine}.`,
        '',
        proof,
        '',
        `L’intérêt pour une école, une entreprise ou un club: garder un programme clair, vérifier les disponibilités, et éviter les promesses qui ne tiennent pas sur place.`,
        briefLine ? `\n${briefLine}` : '',
        '',
        cta
      ].filter(Boolean).join('\n')
    };
  }

  if (channel === 'facebook') {
    return {
      ...base,
      text: [
        `Une sortie facile à organiser à ${center.city} ?`,
        '',
        `${center.name} réunit ${activityLine}.`,
        '',
        `Pour un anniversaire, une sortie entre amis, un club ou une journée en famille, le plus simple est de partir des vraies disponibilités du centre et du nombre de personnes.`,
        '',
        proof,
        briefLine ? `\n${briefLine}` : '',
        '',
        cta
      ].filter(Boolean).join('\n')
    };
  }

  if (channel === 'instagram') {
    return {
      ...base,
      text: [
        `${center.city}: une sortie indoor qui se décide facilement.`,
        '',
        `À montrer en image: ${activityLine}.`,
        '',
        `Idée Reels/carrousel: arrivée au centre, choix de l’activité, moment Laser Game ou bowling, puis pause arcade ou Mini Golf selon le centre.`,
        '',
        proof,
        briefLine ? `\n${briefLine}` : '',
        '',
        `${cta}`,
        `#FunGalaxy #${center.city.replace(/\s+/g, '')} #Bowling #LaserGame`
      ].filter(Boolean).join('\n')
    };
  }

  if (channel === 'tiktok') {
    return {
      ...base,
      text: [
        `Script TikTok/Reels pour ${center.name}`,
        '',
        `Hook 0-2s: "On fait quoi ce week-end à ${center.city} ?"`,
        `Plan 1: entrée du centre + texte court "${center.city}".`,
        `Plan 2: bowling ou Laser Game selon la campagne.`,
        `Plan 3: ${activityLine}.`,
        `Plan 4: CTA simple: "${cta}"`,
        '',
        proof,
        briefLine ? `\n${briefLine}` : ''
      ].filter(Boolean).join('\n')
    };
  }

  return {
    ...base,
    text: [
      `Objet: ${subject}`,
      '',
      'Bonjour,',
      '',
      `On vous partage une idée de sortie simple chez ${center.name}.`,
      '',
      `Les activités disponibles côté centre: ${activityLine}.`,
      '',
      `${proof}`,
      '',
      `Si vous avez une date, un nombre de personnes ou une formule en tête, répondez simplement à ce message. On vous aide à vérifier ce qui est réellement possible.`,
      briefLine ? `\n${briefLine}` : '',
      '',
      'À bientôt,',
      center.name
    ].filter(Boolean).join('\n')
  };
}

function getStaffCampaignDraftForIdea(idea, channelOverride = '') {
  const brief = String(state.staffCampaignBrief || '').trim();
  const channel = STAFF_CAMPAIGN_CHANNELS.includes(channelOverride) ? channelOverride : (STAFF_CAMPAIGN_CHANNELS.includes(state.staffCampaignChannel) ? state.staffCampaignChannel : idea.channel || 'linkedin');
  const snapshot = getStaffCampaignSnapshot();
  const variants = getStaffCampaignCenters().map(center => buildStaffCampaignCopyForCenter(idea, center, channel, snapshot));
  return {
    channel,
    agentKey: channel,
    agentName: getStaffCampaignAgent(channel).name,
    subject: variants[0]?.subject || idea.title,
    variants,
    linkedin: variants[0]?.text || '',
    email: variants[0]?.text || '',
    sms: '',
    brief,
    createdAt: new Date().toISOString()
  };
}

function normalizeStaffCampaignDraft(draft, idea) {
  if (draft && Array.isArray(draft.variants) && draft.variants.length) return draft;
  return getStaffCampaignDraftForIdea(idea);
}

function renderStaffCampaignAgentPanel(channel = getStaffCampaignChannel()) {
  const agent = getStaffCampaignAgent(channel);
  return `<div class="campaign-agent-brief campaign-agent-brief-simple">
    <span>${renderCampaignIcon(agent.icon)}</span>
    <div>
      <small>Format appliqué</small>
      <strong>${escapeHtml(agent.name)}</strong>
      <p>${escapeHtml(agent.tone)}. Activités réelles seulement, aucune offre inventée.</p>
    </div>
  </div>`;
}

function renderStaffCampaignCenterDraft(variant) {
  return `<article class="campaign-center-draft">
    <div class="campaign-center-head">
      <div>
        <small>Version prête à copier</small>
        <h3>${escapeHtml(variant.centerName)}</h3>
      </div>
      <button type="button" onclick="copyStaffCampaignDraft(${staffCampaignJs(variant.centerId)})">${renderCampaignIcon('copy')} Copier</button>
    </div>
    <textarea id="campaignDraftText-${escapeHtml(variant.centerId)}" oninput="updateStaffCampaignDraftText(this.value, ${staffCampaignJs(variant.centerId)})">${escapeHtml(variant.text || '')}</textarea>
    <div class="campaign-center-tools">
      <span>${renderCampaignIcon('shield')} Activités vérifiées</span>
      <div class="campaign-tone-pills">
        ${(variant.alternatives || []).map(item => `<button type="button" onclick="updateStaffCampaignDraftText(${staffCampaignJs(item.text)}, ${staffCampaignJs(variant.centerId)}); renderStaffCampaignsPage();">${escapeHtml(item.label)}</button>`).join('')}
      </div>
    </div>
  </article>`;
}

function renderStaffCampaignDraft(draft, idea) {
  const normalized = normalizeStaffCampaignDraft(draft, idea);
  return `<div class="campaign-draft">
    <div class="campaign-draft-head">
      <div>
        <small>${escapeHtml((normalized.channel || 'linkedin').toUpperCase())}</small>
        <h3>Textes générés</h3>
      </div>
      <button type="button" onclick="copyStaffCampaignDraft()">${renderCampaignIcon('copy')} Copier les deux</button>
    </div>
    <div class="campaign-draft-grid">
      ${renderStaffCampaignAgentPanel(normalized.channel)}
      ${(normalized.variants || []).map(renderStaffCampaignCenterDraft).join('')}
    </div>
  </div>`;
}

function renderStaffCampaignSavedRow(campaign) {
  const draft = campaign.draft && Array.isArray(campaign.draft.variants) ? campaign.draft : null;
  const centers = draft ? draft.variants.map(variant => variant.city || variant.centerName).join(' + ') : 'Libramont + Gembloux';
  return `<div class="campaign-row">
    <span>
      <strong>${escapeHtml(campaign.title)}</strong>
      <small>${escapeHtml(campaign.segment)} · ${escapeHtml(campaign.channel)} · ${escapeHtml(centers)}</small>
    </span>
    <span>${escapeHtml(formatCampaignDate(campaign.date || state.currentDate))}</span>
    <span class="campaign-status ${escapeHtml(campaign.status || 'draft')}">${escapeHtml(getCampaignStatusLabel(campaign.status))}</span>
    <span class="campaign-actions">
      <button type="button" onclick="selectStaffCampaignIdea(${staffCampaignJs(campaign.id)})">Ouvrir</button>
      <button type="button" onclick="advanceStaffCampaignStatus(${staffCampaignJs(campaign.id)})">Avancer</button>
    </span>
  </div>`;
}

function getCampaignStatusLabel(status) {
  const labels = { draft: 'Brouillon', ready: 'Prêt', scheduled: 'Planifié', sent: 'Envoyé' };
  return labels[status || 'draft'] || 'Brouillon';
}

function setStaffCampaignObjective(objective) {
  state.staffCampaignObjective = ['anniversaires', 'calme', 'groupes', 'fidelisation', 'laser', 'formules'].includes(objective) ? objective : 'anniversaires';
  state.staffCampaignSelectedId = buildStaffCampaignIdeas()[0]?.id || '';
  state.staffCampaignDraft = null;
  save();
  renderStaffCampaignsPage();
}

function setStaffCampaignChannel(channel) {
  state.staffCampaignChannel = STAFF_CAMPAIGN_CHANNELS.includes(channel) ? channel : 'linkedin';
  state.staffCampaignDraft = null;
  save();
  renderStaffCampaignsPage();
}

function selectStaffCampaignIdea(id) {
  state.staffCampaignSelectedId = id;
  const selected = getStaffCampaignIdeaById(id);
  if (selected && selected.draft) state.staffCampaignDraft = selected.draft;
  else state.staffCampaignDraft = null;
  save();
  renderStaffCampaignsPage();
}

function setStaffCampaignBrief(value) {
  state.staffCampaignBrief = value || '';
  save();
}

function insertStaffCampaignPrompt(prompt) {
  const current = String(state.staffCampaignBrief || '').trim();
  state.staffCampaignBrief = current ? `${current}\n${prompt}` : prompt;
  save();
  renderStaffCampaignsPage();
}

function generateStaffCampaignDraft() {
  const idea = getSelectedStaffCampaignIdea();
  state.staffCampaignDraft = getStaffCampaignDraftForIdea(idea);
  save();
  renderStaffCampaignsPage();
  toast('Brouillon marketing généré.');
}

function updateStaffCampaignDraftText(value, centerId = '') {
  const idea = getSelectedStaffCampaignIdea();
  const draft = normalizeStaffCampaignDraft(state.staffCampaignDraft, idea);
  draft.variants = (draft.variants || []).map(variant => {
    if (centerId && variant.centerId !== centerId) return variant;
    return { ...variant, text: value };
  });
  draft.linkedin = draft.variants[0]?.text || '';
  draft.email = draft.variants[0]?.text || '';
  state.staffCampaignDraft = draft;
  save();
}

function saveStaffCampaignFromCurrent() {
  const idea = getSelectedStaffCampaignIdea();
  const draft = normalizeStaffCampaignDraft(state.staffCampaignDraft, idea);
  const campaign = {
    ...idea,
    id: `campaign-${Date.now()}`,
    date: state.currentDate || todayStr(),
    channel: state.staffCampaignChannel || idea.channel,
    status: 'ready',
    brief: state.staffCampaignBrief || '',
    draft
  };
  state.marketingCampaigns = [campaign, ...(state.marketingCampaigns || [])].slice(0, 30);
  state.staffCampaignSelectedId = campaign.id;
  state.staffCampaignDraft = draft;
  save();
  renderStaffCampaignsPage();
  toast('Campagne ajoutée au calendrier.');
}

function advanceStaffCampaignStatus(id) {
  const order = ['draft', 'ready', 'scheduled', 'sent'];
  state.marketingCampaigns = (state.marketingCampaigns || []).map(campaign => {
    if (campaign.id !== id) return campaign;
    const current = order.indexOf(campaign.status || 'draft');
    return { ...campaign, status: order[Math.min(current + 1, order.length - 1)] };
  });
  save();
  renderStaffCampaignsPage();
}

function copyStaffCampaignDraft() {
  const centerId = arguments.length ? arguments[0] : '';
  const draft = normalizeStaffCampaignDraft(state.staffCampaignDraft, getSelectedStaffCampaignIdea());
  const variants = centerId ? (draft.variants || []).filter(variant => variant.centerId === centerId) : (draft.variants || []);
  const text = variants.map(variant => `[${variant.centerName}]\n${variant.text}`).join('\n\n---\n\n');
  navigator.clipboard?.writeText(text).then(() => toast('Brouillon copié.')).catch(() => toast('Copie indisponible.'));
}

function exportStaffCampaignsCsv() {
  const campaigns = state.marketingCampaigns || [];
  const header = ['date', 'titre', 'centre', 'segment', 'canal', 'statut', 'source', 'texte'];
  const rows = campaigns.flatMap(campaign => {
    const variants = campaign.draft?.variants?.length ? campaign.draft.variants : [{ centerName: 'Libramont + Gembloux', text: campaign.draft?.linkedin || campaign.draft?.email || '' }];
    return variants.map(variant => [campaign.date || '', campaign.title || '', variant.centerName || '', campaign.segment || '', campaign.channel || '', getCampaignStatusLabel(campaign.status), campaign.source || '', variant.text || '']);
  });
  const csvCell = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
  downloadTextFile(`fungalaxy-campagnes-${state.currentDate || todayStr()}.csv`, [header.map(csvCell).join(','), ...rows.map(row => row.map(csvCell).join(','))].join('\n'), 'text/csv;charset=utf-8');
}

function seedStaffCampaignWeek() {
  const ideas = buildStaffCampaignIdeas().slice(0, 5);
  const existingTitles = new Set((state.marketingCampaigns || []).map(campaign => `${campaign.title}-${campaign.date}`));
  const additions = ideas.map((idea, index) => ({
    ...idea,
    id: `campaign-${Date.now()}-${index}`,
    date: addDays(state.currentDate || todayStr(), index * 2),
    channel: idea.channel,
    status: index === 0 ? 'ready' : 'draft',
    brief: '',
    draft: getStaffCampaignDraftForIdea(idea, idea.channel)
  })).filter(campaign => !existingTitles.has(`${campaign.title}-${campaign.date}`));
  state.marketingCampaigns = [...additions, ...(state.marketingCampaigns || [])].slice(0, 30);
  if (additions[0]) {
    state.staffCampaignSelectedId = additions[0].id;
    state.staffCampaignDraft = additions[0].draft;
  }
  save();
  renderStaffCampaignsPage();
  toast(`${additions.length} campagne(s) préparée(s).`);
}

function getStaffMarketingAgentCenters(status = staffMarketingAgentsCache.status) {
  return Array.isArray(status?.centers) ? status.centers : [];
}

function getStaffMarketingAgentCurrentCenter(status = staffMarketingAgentsCache.status) {
  const centers = getStaffMarketingAgentCenters(status);
  return centers.find(center => center.centerId === (state.adminCenterId || 'libramont')) || centers[0] || null;
}

async function loadStaffMarketingAgents(force = false) {
  if (staffMarketingAgentsCache.loading) return staffMarketingAgentsCache.status;
  if (!force && staffMarketingAgentsCache.loaded && Date.now() - (staffMarketingAgentsCache.loadedAt || 0) < 45000) {
    return staffMarketingAgentsCache.status;
  }
  staffMarketingAgentsCache.loading = true;
  staffMarketingAgentsCache.error = '';
  if (isStaffCampaignsActive()) renderStaffCampaignsPage();
  try {
    const payload = await apiRequest(`${API_ENDPOINTS.marketingAgents}?action=status&centerId=all`);
    staffMarketingAgentsCache = {
      ...staffMarketingAgentsCache,
      loaded: true,
      loading: false,
      status: payload,
      lastLoadedAt: payload.updatedAt || new Date().toISOString(),
      loadedAt: Date.now(),
      error: ''
    };
  } catch (error) {
    staffMarketingAgentsCache = {
      ...staffMarketingAgentsCache,
      loaded: true,
      loading: false,
      error: error.message || 'Agents marketing indisponibles.',
      loadedAt: Date.now()
    };
  }
  if (isStaffCampaignsActive()) renderStaffCampaignsPage();
  return staffMarketingAgentsCache.status;
}

function buildStaffCampaignDraftFromAgentResults(result) {
  const selected = getSelectedStaffCampaignIdea();
  const channel = getStaffCampaignChannel();
  const variants = (result?.centers || [])
    .map(centerResult => (centerResult.drafts || []).find(draft => draft.platform === channel))
    .filter(Boolean)
    .map(draft => ({
      centerId: draft.centerId,
      centerName: draft.centerName,
      subject: draft.title,
      text: draft.body,
      facts: draft.factsUsed?.activities || [],
      alternatives: [
        {
          label: `${draft.evaluation?.score || 0}/100`,
          text: draft.body
        }
      ]
    }));
  if (!variants.length) return null;
  return {
    channel,
    agentKey: channel,
    agentName: getStaffCampaignAgent(channel).name,
    subject: variants[0]?.subject || selected.title,
    variants,
    brief: state.staffCampaignBrief || '',
    createdAt: new Date().toISOString(),
    source: 'marketing-agents-api'
  };
}

async function runStaffMarketingAgents() {
  if (staffMarketingAgentsCache.running) return;
  staffMarketingAgentsCache.running = true;
  staffMarketingAgentsCache.error = '';
  renderStaffCampaignsPage();
  try {
    const payload = await apiRequest(API_ENDPOINTS.marketingAgents, {
      method: 'POST',
      body: JSON.stringify({
        action: 'run',
        centerId: 'all',
        objective: state.staffCampaignObjective || 'anniversaires',
        brief: state.staffCampaignBrief || '',
        runType: 'manual-staff'
      })
    });
    const draft = buildStaffCampaignDraftFromAgentResults(payload);
    if (draft) state.staffCampaignDraft = draft;
    staffMarketingAgentsCache.running = false;
    await loadStaffMarketingAgents(true);
    toast('Agents marketing lancés.');
  } catch (error) {
    staffMarketingAgentsCache.running = false;
    staffMarketingAgentsCache.error = error.message || 'Analyse marketing impossible.';
    toast(staffMarketingAgentsCache.error);
    renderStaffCampaignsPage();
  }
}

function renderMarketingAgentCard(agent) {
  const score = agent.score === null || agent.score === undefined ? '--' : `${Math.round(Number(agent.score) || 0)}`;
  const connectedLabel = agent.connected ? 'Connecté' : 'Interne';
  const mode = agent.generationMode === 'openai' ? 'OpenAI contrôlé' : 'Règles contrôlées';
  const learned = Number(agent.learnedCriteria || 0);
  return `<article class="campaign-agent-status">
    <div>
      <span class="campaign-agent-dot"></span>
      <strong>${escapeHtml(agent.label || agent.platform)}</strong>
      <small>${escapeHtml(agent.centerId || 'centre')} · ${escapeHtml(connectedLabel)} · ${escapeHtml(agent.platform || '')}</small>
    </div>
    <b>${escapeHtml(score)}</b>
    <p>${escapeHtml(agent.currentWork || agent.mission || 'Surveillance active.')}</p>
    <em>${escapeHtml(mode)} · ${escapeHtml(String(agent.criteriaChecked || 0))} critères · ${escapeHtml(String(learned))} appris</em>
    <em>${escapeHtml(agent.socialSummary || 'Données centre en cours de lecture.')}</em>
  </article>`;
}

function renderStaffMarketingAgentOps() {
  if (!staffMarketingAgentsCache.loaded && !staffMarketingAgentsCache.loading) {
    setTimeout(() => loadStaffMarketingAgents(), 0);
  }
  const status = staffMarketingAgentsCache.status;
  const centers = getStaffMarketingAgentCenters(status);
  const activeCenter = getStaffMarketingAgentCurrentCenter(status);
  const allAgents = centers.flatMap(center => (center.agents || []).map(agent => ({ ...agent, centerId: center.centerId })));
  const autonomyScores = centers.map(center => Number(center.autonomy?.score || 0)).filter(score => Number.isFinite(score));
  const autonomyScore = autonomyScores.length
    ? Math.round(autonomyScores.reduce((sum, score) => sum + score, 0) / autonomyScores.length)
    : 0;
  const autonomyLabel = centers.find(center => center.autonomy?.label)?.autonomy?.label || 'Non évalué';
  const autonomyBlockers = centers.flatMap(center => (center.autonomy?.blockers || []).map(blocker => ({
    centerId: center.centerId,
    ...blocker
  }))).slice(0, 4);
  const problemSuggestions = centers.flatMap(center => (center.suggestions || [])
    .filter(suggestion => ['high', 'critical'].includes(suggestion.severity))
    .slice(0, 3)
    .map(suggestion => ({
      centerId: center.centerId,
      label: suggestion.payload?.title || suggestion.title || 'Script marketing à corriger',
      detail: suggestion.payload?.evaluation?.summary || suggestion.summary || 'Relecture demandée.'
    })));
  const updatedAt = staffMarketingAgentsCache.lastLoadedAt ? formatOpsTimestamp(staffMarketingAgentsCache.lastLoadedAt) : 'Non lancé';
  const loadingText = staffMarketingAgentsCache.loading ? 'Lecture en cours...' : staffMarketingAgentsCache.running ? 'Analyse en cours...' : `Actualisé ${updatedAt}`;
  return `<section class="campaign-agent-ops">
    <div class="campaign-agent-ops-head">
      <div>
        <span class="campaigns-eyebrow">Agents IA marketing</span>
        <h2>Moteur de contenu contrôlé</h2>
        <p>Les agents lisent les données réelles du centre, vérifient chaque script et gardent une trace des décisions.</p>
      </div>
      <div class="campaign-agent-actions">
        <span>${escapeHtml(loadingText)}</span>
        <button type="button" onclick="loadStaffMarketingAgents(true)">Actualiser</button>
        <button type="button" class="primary" onclick="runStaffMarketingAgents()" ${staffMarketingAgentsCache.running ? 'disabled' : ''}>Analyser maintenant</button>
      </div>
    </div>
    ${staffMarketingAgentsCache.error ? `<div class="campaign-agent-alert">${escapeHtml(staffMarketingAgentsCache.error)}</div>` : ''}
    <div class="campaign-agent-summary">
      <div><small>Centres</small><strong>${escapeHtml(String(centers.length || 0))}</strong><span>Libramont + Gembloux</span></div>
      <div><small>Scripts suivis</small><strong>${escapeHtml(String(centers.reduce((sum, center) => sum + Number(center.metrics?.pendingScripts || 0), 0)))}</strong><span>en suggestion Ops</span></div>
      <div><small>Signaux appris</small><strong>${escapeHtml(String(centers.reduce((sum, center) => sum + Number(center.metrics?.learnedSignals ?? center.metrics?.externalSignals ?? 0), 0)))}</strong><span>internes + retours réels</span></div>
      <div><small>Autonomie</small><strong>${escapeHtml(String(autonomyScore))}</strong><span>${escapeHtml(autonomyLabel)}</span></div>
    </div>
    <div class="campaign-agent-body">
      <div class="campaign-agent-grid">
        ${allAgents.length ? allAgents.map(renderMarketingAgentCard).join('') : `<div class="campaign-empty">Aucun agent chargé pour le moment.</div>`}
      </div>
      <aside class="campaign-agent-problems">
        <h3>Ce qui bloque le 100/100</h3>
        ${autonomyBlockers.length
          ? autonomyBlockers.map(item => `<div class="campaign-agent-blocker ${escapeHtml(item.level || 'medium')}"><strong>${escapeHtml(item.centerId)}</strong><span>${escapeHtml(item.title)}</span><p>${escapeHtml(item.detail)}</p></div>`).join('')
          : `<p>Tous les prérequis critiques sont branchés sur les derniers contrôles.</p>`}
        ${problemSuggestions.length
          ? problemSuggestions.map(item => `<div><strong>${escapeHtml(item.centerId)}</strong><span>${escapeHtml(item.label)}</span><p>${escapeHtml(item.detail)}</p></div>`).join('')
          : `<p>Aucun script haut risque détecté sur les derniers contrôles.</p>`}
        <small>${escapeHtml(activeCenter?.scheduler?.note || 'Les agents analysent sans publier automatiquement.')}</small>
      </aside>
    </div>
  </section>`;
}

function renderStaffCampaignsPage() {
  const root = document.getElementById('staffCampaignsPage');
  if (!root) return;
  const snapshot = getStaffCampaignSnapshot();
  const ideas = buildStaffCampaignIdeas(snapshot);
  if (!state.staffCampaignSelectedId && ideas[0]) state.staffCampaignSelectedId = ideas[0].id;
  const selected = getSelectedStaffCampaignIdea();
  const draft = normalizeStaffCampaignDraft(state.staffCampaignDraft, selected);
  const saved = state.marketingCampaigns || [];
  const campaignsThisMonth = saved.filter(campaign => getMonthKey(campaign.date) === getMonthKey(state.currentDate || todayStr()));
  const activeAgent = getStaffCampaignAgent(getStaffCampaignChannel());
  root.innerHTML = `
    <section class="campaigns-hero campaigns-hero-simple">
      <div>
        <span class="campaigns-eyebrow">Marketing local</span>
        <h1>Campagnes</h1>
        <p>Choisissez un objectif, un réseau, puis copiez les deux textes: Libramont et Gembloux.</p>
      </div>
      <div class="campaigns-actions">
        <button type="button" class="primary" onclick="generateStaffCampaignDraft()">${renderCampaignIcon('spark')} Générer</button>
      </div>
    </section>

    <section class="campaign-safe-strip" aria-label="Ce que le générateur utilise">
      <span>${renderCampaignIcon('shield')} Aucune activité inventée</span>
      <span>Libramont + Gembloux</span>
      <span>${escapeHtml(activeAgent.label)}</span>
      <span>Agents actifs</span>
    </section>

    ${renderStaffMarketingAgentOps()}

    <section class="campaign-workspace campaign-workspace-simple">
      <article class="campaign-panel campaign-create">
        <div class="campaign-panel-head">
          <div>
            <h2>Créer une publication</h2>
            <p>Trois choix. Le reste est préparé automatiquement.</p>
          </div>
        </div>
        <div class="campaign-step">
          <b>1</b>
          <div>
            <h3>Objectif</h3>
            <div class="campaign-objectives">
              ${renderStaffCampaignObjectiveButton('anniversaires', 'Anniversaire')}
              ${renderStaffCampaignObjectiveButton('calme', 'Jour calme')}
              ${renderStaffCampaignObjectiveButton('groupes', 'Groupe')}
              ${renderStaffCampaignObjectiveButton('laser', 'Laser')}
              ${renderStaffCampaignObjectiveButton('formules', 'Formule')}
              ${renderStaffCampaignObjectiveButton('fidelisation', 'Fidéliser')}
            </div>
          </div>
        </div>
        <div class="campaign-step">
          <b>2</b>
          <div>
            <h3>Réseau</h3>
            <div class="campaign-channels">
              ${renderStaffCampaignChannelButton('facebook', 'Facebook')}
              ${renderStaffCampaignChannelButton('instagram', 'Instagram')}
              ${renderStaffCampaignChannelButton('tiktok', 'TikTok')}
              ${renderStaffCampaignChannelButton('linkedin', 'LinkedIn')}
              ${renderStaffCampaignChannelButton('email', 'Email')}
            </div>
          </div>
        </div>
        <div class="campaign-step">
          <b>3</b>
          <div>
            <h3>Détail utile <span>facultatif</span></h3>
            <label class="campaign-brief">
              <textarea placeholder="Ex: mettre en avant les anniversaires de juin, une journée calme, ou une sortie groupe. Rien d’obligatoire." oninput="setStaffCampaignBrief(this.value)">${escapeHtml(state.staffCampaignBrief || '')}</textarea>
            </label>
          </div>
        </div>
        <div class="campaign-create-actions">
          <button type="button" class="primary" onclick="generateStaffCampaignDraft()">${renderCampaignIcon('spark')} Créer les textes</button>
          <button type="button" onclick="saveStaffCampaignFromCurrent()">Garder cette campagne</button>
        </div>
      </article>

      <article class="campaign-panel campaign-editor campaign-result">
        <div class="campaign-panel-head">
          <div>
            <h2>${escapeHtml(selected.title)}</h2>
            <p>${escapeHtml(selected.segment)} · ${escapeHtml(activeAgent.label)} · ${escapeHtml(selected.source)}</p>
          </div>
        </div>
        ${renderStaffCampaignDraft(draft, selected)}
      </article>
    </section>

    <section class="campaign-calendar campaign-calendar-simple">
      <div class="campaign-panel-head">
        <div>
          <h2>Campagnes gardées</h2>
          <p>${saved.length ? `${saved.length} campagne(s) préparée(s)` : 'Planifiez une semaine pour créer les premières actions.'}</p>
        </div>
        <div class="campaigns-actions">
          <button type="button" onclick="seedStaffCampaignWeek()">${renderCampaignIcon('plus')} Préparer 5 idées</button>
          <button type="button" onclick="exportStaffCampaignsCsv()">${renderCampaignIcon('copy')} Exporter</button>
        </div>
      </div>
      <div class="campaign-table">
        <div class="campaign-table-head"><span>Campagne</span><span>Date</span><span>Statut</span><span>Actions</span></div>
        ${saved.length ? saved.map(renderStaffCampaignSavedRow).join('') : `<div class="campaign-empty">Aucune campagne enregistrée. Lancez une semaine pour préparer les premiers messages.</div>`}
      </div>
    </section>
  `;
}

function formatStaffClientMoney(value) {
  return new Intl.NumberFormat('fr-BE', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(value) || 0).replace(/\s/g, ' ');
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

function renderStaffClientSpark(values = [], tone = 'purple') {
  const clean = values.map(value => Number(value) || 0);
  const max = Math.max(...clean, 1);
  const points = clean.map((value, index) => {
    const x = clean.length <= 1 ? 100 : (index / (clean.length - 1)) * 100;
    const y = 34 - ((value / max) * 26);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg class="clients-spark ${escapeHtml(tone)}" viewBox="0 0 100 38" preserveAspectRatio="none" aria-hidden="true">
    <polyline points="${points}" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"></polyline>
  </svg>`;
}

function getStaffClientSeedRows() {
  return [];
  return [
    {
      id: 'martin-laurent',
      name: 'Martin Laurent',
      email: 'martin.laurent@gmail.com',
      phone: '06 12 34 56 78',
      status: 'Fidèle',
      statusClass: 'loyal',
      lastVisit: '24 mai 2026',
      lastVisitAgo: 'Il y a 2 jours',
      reservations: 18,
      spent: 764.80,
      cancellations: 3,
      initials: 'ML',
      avatarTone: 'violet',
      tags: ['Fidèle', 'VIP'],
      history: [
        { date: '24 mai 2026', label: 'Réservation', amount: 78 },
        { date: '18 mai 2026', label: 'Réservation', amount: 45 },
        { date: '10 mai 2026', label: 'Annulation', amount: -35 },
        { date: '2 mai 2026', label: 'Réservation', amount: 62 },
        { date: '20 avr. 2026', label: 'Réservation', amount: 52 },
      ],
      lastBooking: {
        date: 'Sam. 24 mai 2026',
        time: '20:00 - 22:00',
        lane: 'Piste 3',
        status: 'Terminée',
        offer: 'Bowling classique',
        players: '6 personnes',
        total: 78
      }
    },
    { id: 'sophie-dubois', name: 'Sophie Dubois', email: 'sophie.dubois@gmail.com', phone: '06 23 45 67 89', status: 'Actif', statusClass: 'active', lastVisit: '23 mai 2026', lastVisitAgo: 'Il y a 3 jours', reservations: 12, spent: 482.40, cancellations: 1, initials: 'SD', avatarTone: 'orange' },
    { id: 'julien-bernard', name: 'Julien Bernard', email: 'julien.bernard@gmail.com', phone: '06 34 56 78 90', status: 'Actif', statusClass: 'active', lastVisit: '20 mai 2026', lastVisitAgo: 'Il y a 6 jours', reservations: 9, spent: 315, cancellations: 0, initials: 'JB', avatarTone: 'blue' },
    { id: 'camille-moreau', name: 'Camille Moreau', email: 'camille.moreau@gmail.com', phone: '06 45 67 89 01', status: 'Nouveau', statusClass: 'new', lastVisit: '18 mai 2026', lastVisitAgo: 'Il y a 8 jours', reservations: 2, spent: 68, cancellations: 0, initials: 'CM', avatarTone: 'gold' },
    { id: 'nicolas-girard', name: 'Nicolas Girard', email: 'nicolas.girard@gmail.com', phone: '06 56 78 90 12', status: 'Inactif', statusClass: 'inactive', lastVisit: '10 avr. 2026', lastVisitAgo: 'Il y a 45 jours', reservations: 3, spent: 122, cancellations: 1, initials: 'NG', avatarTone: 'purple' },
    { id: 'amandine-petit', name: 'Amandine Petit', email: 'amandine.petit@gmail.com', phone: '06 67 89 01 23', status: 'Actif', statusClass: 'active', lastVisit: '9 mai 2026', lastVisitAgo: 'Il y a 17 jours', reservations: 7, spent: 246.50, cancellations: 0, initials: 'AP', avatarTone: 'green' },
    { id: 'tom-henry', name: 'Tom Henry', email: 'tom.henry@gmail.com', phone: '06 78 90 12 34', status: 'Fidèle', statusClass: 'loyal', lastVisit: '25 mai 2026', lastVisitAgo: 'Il y a 1 jour', reservations: 21, spent: 912.30, cancellations: 2, initials: 'TH', avatarTone: 'teal' },
  ];
}

function legacyFormatStaffClientDateText(dateValue) {
  if (!dateValue) return '--';
  const date = parseLocalDate(dateValue);
  return date.toLocaleDateString('fr-BE', { day: 'numeric', month: 'short', year: 'numeric' }).replace('.', '');
}

function legacyFormatStaffClientAgo(dateValue) {
  if (!dateValue) return '';
  const today = parseLocalDate(todayStr());
  const date = parseLocalDate(dateValue);
  const diff = Math.max(0, Math.round((today - date) / 86400000));
  if (diff === 0) return "Aujourd'hui";
  if (diff === 1) return 'Il y a 1 jour';
  return `Il y a ${diff} jours`;
}

function legacyGetStaffClientRows() {
  const seedRows = getStaffClientSeedRows();
  const known = new Set(seedRows.map(row => String(row.email || row.phone || row.name).toLowerCase()));
  const realRows = buildAdminClientProfiles(state.reservations || [])
    .map((profile, index) => {
      const key = String(profile.email || profile.phone || profile.name || '').toLowerCase();
      if (known.has(key)) return null;
      const status = profile.segment === 'VIP' || profile.segment === 'Récurrent' ? 'Fidèle' : profile.segment === 'Groupe' ? 'Actif' : 'Nouveau';
      const statusClass = status === 'Fidèle' ? 'loyal' : status === 'Nouveau' ? 'new' : 'active';
      return {
        id: `real-${index}-${String(profile.key || profile.name).replace(/[^a-z0-9]+/gi, '-')}`,
        name: profile.name || 'Client',
        email: profile.email || '',
        phone: profile.phone || '',
        status,
        statusClass,
        lastVisit: formatStaffClientDateText(profile.lastDate),
        lastVisitAgo: formatStaffClientAgo(profile.lastDate),
        reservations: profile.visits || 0,
        spent: Number(profile.revenue || 0),
        cancellations: 0,
        initials: getStaffClientInitials(profile.name),
        avatarTone: ['violet', 'blue', 'green', 'gold', 'teal'][index % 5],
        history: [],
        lastBooking: null
      };
    })
    .filter(Boolean);
  return [...seedRows, ...realRows];
}

function legacyGetFilteredStaffClientRows() {
  const query = String(state.staffClientQuery || '').trim().toLowerCase();
  const segment = state.staffClientSegment || 'all';
  return getStaffClientRows().filter(row => {
    const text = `${row.name} ${row.email} ${row.phone} ${row.status}`.toLowerCase();
    if (query && !text.includes(query)) return false;
    if (segment === 'loyal' && row.status !== 'Fidèle') return false;
    if (segment === 'groups' && row.reservations < 10) return false;
    if (segment === 'birthdays' && !/anniversaire|adam|camille|tom|martin/i.test(`${row.name} ${row.email}`)) return false;
    return true;
  });
}

function legacySetStaffClientSegment(segment) {
  state.staffClientSegment = ['all', 'loyal', 'groups', 'birthdays'].includes(segment) ? segment : 'all';
  save();
  renderStaffClientsPage();
}

function legacySetStaffClientQuery(value) {
  state.staffClientQuery = value || '';
  renderStaffClientsPage();
}

function legacySelectStaffClient(id) {
  state.staffSelectedClientId = id;
  save();
  renderStaffClientsPage();
}

function legacyRenderStaffClientRow(row, selected) {
  return `<button type="button" class="clients-table-row ${selected ? 'selected' : ''}" onclick='selectStaffClient(${staffClientJs(row.id)})'>
    <span class="client-cell client-main">
      <span class="client-avatar ${escapeHtml(row.avatarTone || 'violet')}">${escapeHtml(row.initials || getStaffClientInitials(row.name))}</span>
      <span><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(row.email || 'email à compléter')}</small><small>${escapeHtml(row.phone || 'téléphone à compléter')}</small></span>
    </span>
    <span class="client-cell"><span class="client-status ${escapeHtml(row.statusClass || 'active')}">${escapeHtml(row.status || 'Actif')}</span></span>
    <span class="client-cell"><strong>${escapeHtml(row.lastVisit || '--')}</strong><small>${escapeHtml(row.lastVisitAgo || '')}<i></i></small></span>
    <span class="client-cell"><strong>${row.reservations}</strong><small>Voir historique</small></span>
    <span class="client-cell"><strong>${formatStaffClientMoney(row.spent)}</strong><small>Total</small></span>
    <span class="client-cell actions"><span aria-hidden="true">Ouvrir</span></span>
  </button>`;
}

function legacyRenderStaffClientDetail(row) {
  const detail = row || getStaffClientSeedRows()[0];
  const history = detail.history?.length ? detail.history : [
    { date: detail.lastVisit || 'Dernière visite', label: 'Réservation', amount: detail.spent || 0 },
    { date: 'Historique', label: `${detail.reservations || 0} réservation(s) enregistrée(s)`, amount: 0 }
  ];
  const lastBooking = detail.lastBooking || {
    date: detail.lastVisit || 'Dernière réservation',
    time: '--',
    lane: 'Activité',
    status: detail.status || 'Actif',
    offer: detail.reservations > 10 ? 'Groupe / anniversaire' : 'Bowling classique',
    players: `${Math.max(2, Math.min(12, detail.reservations || 2))} personnes`,
    total: detail.spent || 0
  };
  return `<aside class="client-profile-panel">
    <div class="client-profile-kicker">Fiche client</div>
    <div class="client-profile-head">
      <span class="client-profile-avatar ${escapeHtml(detail.avatarTone || 'violet')}">${escapeHtml(detail.initials || getStaffClientInitials(detail.name))}</span>
      <div>
        <h2>${escapeHtml(detail.name)}</h2>
        <div class="client-profile-tags">
          ${(detail.tags || [detail.status || 'Actif']).map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}
        </div>
      </div>
      <button type="button" onclick="openStaffClientBooking(${staffClientJs(detail.id || '')})" aria-label="Nouvelle réservation">+</button>
    </div>
    <div class="client-profile-contact">
      <p>${renderStaffClientIcon('mail')}<span>${escapeHtml(detail.email || 'email à compléter')}</span></p>
      <p>${renderStaffClientIcon('phone')}<span>${escapeHtml(detail.phone || 'téléphone à compléter')}</span></p>
      <p>${renderStaffClientIcon('clock')}<span>Client depuis le 12 mars 2024</span></p>
    </div>
    <div class="client-profile-stats">
      <div><strong>${detail.reservations || 0}</strong><span>Réservations</span></div>
      <div><strong>${formatStaffClientMoney(detail.spent || 0)}</strong><span>Dépensés</span></div>
      <div><strong>${detail.cancellations || 0}</strong><span>Annulations</span></div>
    </div>
    <div class="client-last-booking">
      <div class="client-panel-title"><span>Dernière réservation</span><button type="button" onclick="toggleStaffClientHistory()">Voir tout</button></div>
      <div class="client-last-card">
        <div><strong>${escapeHtml(lastBooking.date)}</strong><span>${escapeHtml(lastBooking.time)}</span></div>
        <div><span>${escapeHtml(lastBooking.lane)}</span><em>${escapeHtml(lastBooking.status)}</em><span>${escapeHtml(lastBooking.offer)}</span></div>
        <div><span>${escapeHtml(lastBooking.players)}</span><strong>Total : ${formatStaffClientMoney(lastBooking.total || 0)}</strong></div>
      </div>
    </div>
    <div class="client-profile-tabs">
      <button type="button" class="active" onclick="setStaffClientDetailTab('history')">Historique</button>
      <button type="button" onclick="setStaffClientDetailTab('notes')">Notes</button>
      <button type="button" onclick="setStaffClientDetailTab('preferences')">Préférences</button>
    </div>
    <div class="client-history-list">
      ${history.map(item => `<div>
        <span>${escapeHtml(item.date)}</span>
        <span>${escapeHtml(item.label)}</span>
        <strong class="${Number(item.amount) < 0 ? 'negative' : ''}">${Number(item.amount) ? formatStaffClientMoney(item.amount) : ''}</strong>
      </div>`).join('')}
    </div>
    <button type="button" class="client-history-button" onclick="toggleStaffClientHistory()">Voir tout l'historique</button>
  </aside>`;
}

function legacyRenderStaffClientsPage() {
  const root = document.getElementById('staffClientsPage');
  if (!root) return;
  const rows = getFilteredStaffClientRows();
  const allRows = getStaffClientRows();
  const selected = rows.find(row => row.id === state.staffSelectedClientId)
    || allRows.find(row => row.id === state.staffSelectedClientId)
    || rows[0]
    || allRows[0];
  if (selected && state.staffSelectedClientId !== selected.id) state.staffSelectedClientId = selected.id;
  const activeRows = allRows.filter(row => row.statusClass !== 'inactive');
  const loyalRows = allRows.filter(row => row.status === 'Fidèle');
  const groupRows = allRows.filter(row => row.reservations >= 10);
  const birthdays = allRows.filter(row => /martin|camille|tom|anniversaire/i.test(row.name)).length || 23;
  const queryValue = escapeHtml(state.staffClientQuery || '');
  const tab = state.staffClientSegment || 'all';
  const tabButton = (key, label, count) => `<button type="button" class="${tab === key ? 'active' : ''}" onclick="setStaffClientSegment('${key}')"><span>${escapeHtml(label)}</span><em>${count}</em></button>`;
  root.innerHTML = `
    <section class="clients-hero">
      <div>
        <h1>Clients</h1>
        <p>Gérez votre base clients et leur historique</p>
      </div>
      <div class="clients-actions">
        <label class="clients-top-search">
          ${renderStaffClientIcon('search')}
          <input value="${queryValue}" placeholder="Rechercher un client..." oninput="setStaffClientQuery(this.value)">
          <kbd>⌘ K</kbd>
        </label>
        <button type="button" class="clients-action-btn" onclick="toggleStaffClientFilters()">${renderStaffClientIcon('filter')}Filtres</button>
        <button type="button" class="clients-action-btn" onclick="exportStaffClientsCsv()">${renderStaffClientIcon('import')}Exporter</button>
        <button type="button" class="clients-action-btn primary" onclick="openStaffClientBooking()">+ Nouveau client</button>
      </div>
    </section>

    <section class="clients-kpis">
      <article class="clients-kpi purple"><div class="clients-kpi-icon">${renderStaffClientIcon('users')}</div><div><span>Total clients</span><strong>2 847</strong><small>+23 ce mois-ci</small></div>${renderStaffClientSpark([12, 22, 18, 30, 24, 35, 28], 'purple')}</article>
      <article class="clients-kpi blue"><div class="clients-kpi-icon">${renderStaffClientIcon('user')}</div><div><span>Clients actifs</span><strong>1 892</strong><small>66% du total</small></div>${renderStaffClientSpark([8, 15, 14, 20, 17, 24, 21], 'blue')}</article>
      <article class="clients-kpi violet"><div class="clients-kpi-icon">${renderStaffClientIcon('star')}</div><div><span>Nouveaux ce mois</span><strong>78</strong><small>+18% vs mois dernier</small></div>${renderStaffClientSpark([5, 8, 12, 10, 16, 14, 19], 'purple')}</article>
      <article class="clients-kpi amber"><div class="clients-kpi-icon">${renderStaffClientIcon('euro')}</div><div><span>Dépense moyenne</span><strong>42,60 €</strong><small>+8% vs mois dernier</small></div>${renderStaffClientSpark([20, 18, 24, 21, 27, 23, 30], 'purple')}</article>
    </section>

    <section class="clients-workspace">
      <article class="clients-table-panel">
        <div class="clients-panel-head">
          <div>
            <span>Repertoire CRM</span>
            <strong>${rows.length} profil${rows.length > 1 ? 's' : ''} visible${rows.length > 1 ? 's' : ''}</strong>
          </div>
          <p>Selectionnez une ligne pour ouvrir la fiche, relancer un client ou creer une reservation.</p>
        </div>
        <div class="clients-tabs">
          ${tabButton('all', 'Tous les clients', '2 847')}
          ${tabButton('loyal', 'Clients fidèles', Math.max(892, loyalRows.length))}
          ${tabButton('groups', 'Groupes', Math.max(156, groupRows.length))}
          ${tabButton('birthdays', 'Anniversaires à venir', birthdays)}
        </div>
        <div class="clients-toolbar">
          <label class="clients-panel-search">${renderStaffClientIcon('search')}<input value="${queryValue}" placeholder="Rechercher..." oninput="setStaffClientQuery(this.value)"></label>
          <button type="button" onclick="toggleStaffClientFilters()">Segment <span>⌄</span></button>
          <button type="button" onclick="setStaffClientStatusFilter('all')">Dernière visite <span>⌄</span></button>
          <button type="button" class="clients-columns" onclick="toggleStaffClientCompact()">${renderStaffClientIcon('columns')}Colonnes</button>
        </div>
        <div class="clients-table-head">
          <span>Client</span><span>Statut ↕</span><span>Dernière visite ↕</span><span>Réservations ↕</span><span>Dépensé ↕</span><span>Actions</span>
        </div>
        <div class="clients-table-body">
          ${rows.length ? rows.slice(0, 7).map(row => renderStaffClientRow(row, selected && row.id === selected.id)).join('') : `<div class="clients-empty">Aucun client ne correspond à cette recherche.</div>`}
        </div>
        <div class="clients-table-footer">
          <span>Affichage de 1 à ${Math.min(rows.length, 20)} sur 2 847 clients</span>
          <div><button type="button" disabled>‹</button><button type="button" class="active" disabled>1</button><button type="button" disabled>2</button><button type="button" disabled>3</button><span>...</span><button type="button" disabled>143</button><button type="button" disabled>›</button></div>
        </div>
      </article>
      ${renderStaffClientDetail(selected)}
    </section>
  `;
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

function getStaffClientSourceReservations() {
  const centerId = getActiveOpsCenterId();
  const cacheReservations = staffClientDataCache.loaded ? (staffClientDataCache.reservations || []) : [];
  const reservationCache = staffReservationsDataCache.loaded ? (staffReservationsDataCache.reservations || []) : [];
  return mergeReservationsById([cacheReservations, reservationCache, state.reservations || []])
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

function getStaffClientResourceLabel(reservation) {
  if (!reservation) return '--';
  const bowlingWindows = getBowlingWindowsFromReservation(reservation);
  const laserWindows = getLaserWindowsFromReservation(reservation);
  const parts = [];
  if (bowlingWindows.length) {
    parts.push(`Piste${bowlingWindows[0].lanes?.length > 1 ? 's' : ''} ${(bowlingWindows[0].lanes || reservation.lanes || []).join(', ')}`);
  }
  if (laserWindows.length || reservation.type === 'laser') {
    parts.push('Laser Game');
  }
  return parts.join(' + ') || 'Activité';
}

function getStaffClientTimeRange(reservation) {
  if (!reservation) return '--';
  const windows = [...getBowlingWindowsFromReservation(reservation), ...getLaserWindowsFromReservation(reservation)]
    .filter(window => Number.isFinite(Number(window.start)))
    .sort((left, right) => Number(left.start) - Number(right.start));
  const start = windows.length ? Number(windows[0].start) : timeToNum(reservation.startTime || '00:00');
  const end = windows.length
    ? Math.max(...windows.map(window => Number(window.start) + Number(window.duration || reservation.duration || 0)))
    : start + Number(reservation.totalDuration || reservation.duration || 0);
  return `${numToTime(start)} - ${numToTime(end)}`;
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
      const isGroup = profile.maxPax >= 10 || profile.players >= 18 || profile.formulas > 0;
      const hasBirthday = profile.reservationsRaw.some(reservation => /anniversaire|birthday|enfant/i.test(`${reservation.name || ''} ${reservation.label || ''} ${reservation.notes || ''}`));
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
      const tags = [status];
      if (isGroup) tags.push('Groupe');
      if (hasBirthday) tags.push('Anniversaire');
      return {
        id: profile.id,
        key: profile.key,
        name: profile.name,
        email: profile.email,
        phone: profile.phone,
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
        }))
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

function getFilteredStaffClientRows() {
  const query = String(state.staffClientQuery || '').trim().toLowerCase();
  const segment = state.staffClientSegment || 'all';
  const statusFilter = state.staffClientStatusFilter || 'all';
  return getStaffClientRows().filter(row => {
    const text = `${row.name} ${row.email} ${row.phone} ${row.status} ${row.tags.join(' ')}`.toLowerCase();
    if (query && !text.includes(query)) return false;
    if (segment === 'loyal' && row.status !== 'Fidèle') return false;
    if (segment === 'groups' && !row.isGroup) return false;
    if (segment === 'birthdays' && !row.hasBirthday) return false;
    if (statusFilter === 'active' && row.statusClass === 'inactive') return false;
    if (statusFilter === 'inactive' && row.statusClass !== 'inactive') return false;
    if (statusFilter === 'new' && row.statusClass !== 'new') return false;
    if (statusFilter === 'loyal' && row.statusClass !== 'loyal') return false;
    return true;
  });
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

function renderStaffClientKpi(icon, tone, label, value, hint, series) {
  return `<article class="clients-kpi ${escapeHtml(tone)}">
    <div class="clients-kpi-icon">${renderStaffClientIcon(icon)}</div>
    <div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(hint)}</small></div>
    ${renderStaffClientSpark(series || [0, 0, 0], tone === 'blue' ? 'blue' : 'purple')}
  </article>`;
}

function setStaffClientSegment(segment) {
  state.staffClientSegment = ['all', 'loyal', 'groups', 'birthdays'].includes(segment) ? segment : 'all';
  save();
  renderStaffClientsPage();
}

function setStaffClientStatusFilter(filter) {
  state.staffClientStatusFilter = ['all', 'active', 'inactive', 'new', 'loyal'].includes(filter) ? filter : 'all';
  save();
  renderStaffClientsPage();
}

function setStaffClientQuery(value) {
  state.staffClientQuery = value || '';
  renderStaffClientsPage();
}

function selectStaffClient(id) {
  state.staffSelectedClientId = id;
  state.staffClientHistoryExpanded = false;
  save();
  renderStaffClientsPage();
}

function toggleStaffClientFilters() {
  state.staffClientFiltersOpen = !state.staffClientFiltersOpen;
  save();
  renderStaffClientsPage();
}

function toggleStaffClientCompact() {
  state.staffClientCompact = !state.staffClientCompact;
  save();
  renderStaffClientsPage();
}

function clearStaffClientFilters() {
  state.staffClientQuery = '';
  state.staffClientSegment = 'all';
  state.staffClientStatusFilter = 'all';
  save();
  renderStaffClientsPage();
}

function toggleStaffClientHistory() {
  state.staffClientHistoryExpanded = !state.staffClientHistoryExpanded;
  save();
  renderStaffClientsPage();
}

function refreshStaffClients() {
  loadStaffClientData(true);
}

function exportStaffClientsCsv() {
  const rows = getFilteredStaffClientRows();
  const header = ['Client', 'Email', 'Telephone', 'Statut', 'Reservations', 'Joueurs', 'Depense', 'Annulations', 'Premiere visite', 'Derniere visite'];
  const body = rows.map(row => [
    row.name,
    row.email,
    row.phone,
    row.status,
    row.reservations,
    row.players,
    row.spent,
    row.cancellations,
    row.firstDate,
    row.lastDate
  ].map(csvCell).join(','));
  downloadTextFile(`fungalaxy-clients-${state.currentDate || todayStr()}.csv`, [header.map(csvCell).join(','), ...body].join('\n'), 'text/csv;charset=utf-8');
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
  const subject = `Fun Galaxy — ${name ? name : 'votre réservation'}`;
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

function getStaffClientDetailTab() {
  return ['history', 'notes', 'preferences'].includes(state.staffClientDetailTab) ? state.staffClientDetailTab : 'history';
}

function setStaffClientDetailTab(tab) {
  state.staffClientDetailTab = ['history', 'notes', 'preferences'].includes(tab) ? tab : 'history';
  save();
  renderStaffClientsPage();
}

function setStaffClientNote(id, value) {
  state.staffClientNotes = state.staffClientNotes || {};
  state.staffClientNotes[String(id || 'default')] = value || '';
  save();
}

function toggleStaffClientPreference(id, key) {
  const clientId = String(id || 'default');
  state.staffClientPreferences = state.staffClientPreferences || {};
  const prefs = state.staffClientPreferences[clientId] || {};
  prefs[key] = !prefs[key];
  state.staffClientPreferences[clientId] = prefs;
  save();
  renderStaffClientsPage();
}

function renderStaffClientTabs() {
  const tab = getStaffClientDetailTab();
  return `<div class="client-profile-tabs">
    <button type="button" class="${tab === 'history' ? 'active' : ''}" onclick="setStaffClientDetailTab('history')">Historique</button>
    <button type="button" class="${tab === 'notes' ? 'active' : ''}" onclick="setStaffClientDetailTab('notes')">Notes</button>
    <button type="button" class="${tab === 'preferences' ? 'active' : ''}" onclick="setStaffClientDetailTab('preferences')">Préférences</button>
  </div>`;
}

function renderStaffClientTabBody(row, historyItems) {
  const tab = getStaffClientDetailTab();
  const clientId = String(row?.id || 'default');
  if (tab === 'notes') {
    const note = state.staffClientNotes?.[clientId] || '';
    return `<div class="client-tab-body">
      <label class="client-note-field">
        <span>Note interne</span>
        <textarea oninput="setStaffClientNote('${escapeJsString(clientId)}', this.value)" placeholder="Ajoutez une consigne utile pour l'équipe...">${escapeHtml(note)}</textarea>
      </label>
    </div>`;
  }
  if (tab === 'preferences') {
    const prefs = state.staffClientPreferences?.[clientId] || {};
    const options = [
      ['birthday', 'Anniversaire'],
      ['phone', 'Prévenir par téléphone'],
      ['quiet', 'Groupe calme'],
      ['invoice', 'Facture demandée']
    ];
    return `<div class="client-tab-body client-preferences-list">
      ${options.map(([key, label]) => `<button type="button" class="${prefs[key] ? 'active' : ''}" onclick="toggleStaffClientPreference('${escapeJsString(clientId)}', '${key}')">${escapeHtml(label)}</button>`).join('')}
    </div>`;
  }
  return `<div class="client-history-list">
    ${historyItems.length ? historyItems.map(item => `<div>
      <span>${escapeHtml(item.date)}</span>
      <span>${escapeHtml(item.label)} · ${escapeHtml(item.status)}</span>
      <strong class="${Number(item.amount) < 0 ? 'negative' : ''}">${Number(item.amount) ? formatStaffClientMoney(item.amount) : ''}</strong>
    </div>`).join('') : `<div><span>--</span><span>Aucun historique</span><strong></strong></div>`}
  </div>
  <button type="button" class="client-history-button" onclick="openStaffClientBooking(${staffClientJs(row.id)})">Nouvelle réservation pour ce client</button>`;
}

function renderStaffClientFilterPanel(metrics) {
  return `<div class="clients-filter-panel">
    <div>
      <label>Segment</label>
      <select class="clients-select" onchange="setStaffClientSegment(this.value)">
        <option value="all" ${state.staffClientSegment === 'all' ? 'selected' : ''}>Tous les clients</option>
        <option value="loyal" ${state.staffClientSegment === 'loyal' ? 'selected' : ''}>Clients fidèles</option>
        <option value="groups" ${state.staffClientSegment === 'groups' ? 'selected' : ''}>Groupes</option>
        <option value="birthdays" ${state.staffClientSegment === 'birthdays' ? 'selected' : ''}>Anniversaires</option>
      </select>
    </div>
    <div>
      <label>Statut</label>
      <select class="clients-select" onchange="setStaffClientStatusFilter(this.value)">
        <option value="all" ${state.staffClientStatusFilter === 'all' ? 'selected' : ''}>Tous les statuts</option>
        <option value="active" ${state.staffClientStatusFilter === 'active' ? 'selected' : ''}>Actifs</option>
        <option value="loyal" ${state.staffClientStatusFilter === 'loyal' ? 'selected' : ''}>Fidèles</option>
        <option value="new" ${state.staffClientStatusFilter === 'new' ? 'selected' : ''}>Nouveaux</option>
        <option value="inactive" ${state.staffClientStatusFilter === 'inactive' ? 'selected' : ''}>Inactifs</option>
      </select>
    </div>
    <div class="clients-filter-summary">
      <strong>${metrics.totalClients}</strong>
      <span>profil${metrics.totalClients > 1 ? 's' : ''} réel${metrics.totalClients > 1 ? 's' : ''} sur la période synchronisée</span>
    </div>
    <button type="button" class="clients-action-btn" onclick="clearStaffClientFilters()">Réinitialiser</button>
  </div>`;
}

function renderStaffClientRow(row, selected) {
  const email = String(row.email || '');
  const phone = String(row.phone || '');
  const syntheticEmail = /simulation\.fungalaxy\.invalid|_sim_|client\d+\.sim_/i.test(email);
  const primaryContact = phone || (!syntheticEmail ? email : '') || 'Contact a completer';
  const secondaryContact = (!syntheticEmail && email && phone)
    ? email
    : `${Number(row.players || 0)} joueur(s) cumule(s)`;
  return `<button type="button" class="clients-table-row ${selected ? 'selected' : ''}" onclick='selectStaffClient(${staffClientJs(row.id)})'>
    <span class="client-cell client-main">
      <span class="client-avatar ${escapeHtml(row.avatarTone || 'violet')}">${escapeHtml(row.initials || getStaffClientInitials(row.name))}</span>
      <span><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(primaryContact)}</small><small>${escapeHtml(secondaryContact)}</small></span>
    </span>
    <span class="client-cell"><span class="client-status ${escapeHtml(row.statusClass || 'active')}">${escapeHtml(row.status || 'Actif')}</span></span>
    <span class="client-cell"><strong>${escapeHtml(row.lastVisit || '--')}</strong><small>${escapeHtml(row.lastVisitAgo || '')}${row.statusClass !== 'inactive' ? '<i></i>' : ''}</small></span>
    <span class="client-cell"><strong>${row.reservations}</strong><small>${row.players} joueur(s)</small></span>
    <span class="client-cell"><strong>${formatStaffClientMoney(row.spent)}</strong><small>${row.cancellations} annulation(s)</small></span>
    <span class="client-cell actions"><span aria-hidden="true">Ouvrir</span></span>
  </button>`;
}

function renderStaffClientDetail(row) {
  if (!row) {
    return `<aside class="client-profile-panel empty">
      <h2>Aucun client réel</h2>
      <p>Les profils apparaissent dès que des réservations sont synchronisées depuis la base de données.</p>
      <button type="button" class="client-history-button" onclick="openStaffClientBooking()">Créer une réservation</button>
    </aside>`;
  }
  const lastBooking = row.lastBooking;
  const historyItems = state.staffClientHistoryExpanded ? row.history : row.history.slice(0, 6);
  return `<aside class="client-profile-panel">
    <div class="client-profile-kicker">Fiche client</div>
    <div class="client-profile-head">
      <span class="client-profile-avatar ${escapeHtml(row.avatarTone || 'violet')}">${escapeHtml(row.initials || getStaffClientInitials(row.name))}</span>
      <div>
        <h2>${escapeHtml(row.name)}</h2>
        <div class="client-profile-tags">
          ${(row.tags || [row.status || 'Actif']).map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}
        </div>
      </div>
      <button type="button" onclick="openStaffClientBooking(${staffClientJs(row.id)})" aria-label="Nouvelle réservation">+</button>
    </div>
    <div class="client-profile-contact">
      <p>${renderStaffClientIcon('mail')}<span>${escapeHtml(row.email || 'email absent')}</span></p>
      <p>${renderStaffClientIcon('phone')}<span>${escapeHtml(row.phone || 'téléphone absent')}</span></p>
      <p>${renderStaffClientIcon('clock')}<span>Client depuis ${escapeHtml(formatStaffClientDateText(row.firstDate))}</span></p>
    </div>
    <div class="client-profile-stats">
      <div><strong>${row.reservations || 0}</strong><span>Réservations</span></div>
      <div><strong>${formatStaffClientMoney(row.spent || 0)}</strong><span>Dépensés</span></div>
      <div><strong>${row.cancellations || 0}</strong><span>Annulations</span></div>
    </div>
    <div class="client-last-booking">
      <div class="client-panel-title"><span>Dernière réservation réelle</span><button type="button" onclick="toggleStaffClientHistory()">${state.staffClientHistoryExpanded ? 'Réduire' : 'Voir tout'}</button></div>
      ${lastBooking ? `<div class="client-last-card">
        <div><strong>${escapeHtml(formatStaffClientDateText(lastBooking.date))}</strong><span>${escapeHtml(getStaffClientTimeRange(lastBooking))}</span></div>
        <div><span>${escapeHtml(getStaffClientResourceLabel(lastBooking))}</span><em>${escapeHtml(formatStaffClientStatus(lastBooking.status))}</em><span>${escapeHtml(getStaffClientOfferLabel(lastBooking))}</span></div>
        <div><span>${Number(lastBooking.pax || 0)} personne(s)</span><strong>Total : ${formatStaffClientMoney(lastBooking.price || 0)}</strong></div>
      </div>` : `<div class="clients-empty compact">Aucune réservation active.</div>`}
    </div>
    ${renderStaffClientTabs()}
    ${renderStaffClientTabBody(row, historyItems)}
  </aside>`;
}

function renderStaffClientsPage() {
  const root = document.getElementById('staffClientsPage');
  if (!root) return;
  const allRows = getStaffClientRows();
  const rows = getFilteredStaffClientRows();
  const metrics = getStaffClientMetrics(allRows, getStaffClientSourceReservations());
  const selected = rows.find(row => row.id === state.staffSelectedClientId)
    || allRows.find(row => row.id === state.staffSelectedClientId)
    || rows[0]
    || allRows[0]
    || null;
  if (selected && state.staffSelectedClientId !== selected.id) state.staffSelectedClientId = selected.id;
  const queryValue = escapeHtml(state.staffClientQuery || '');
  const tab = state.staffClientSegment || 'all';
  const tabButton = (key, label, count) => `<button type="button" class="${tab === key ? 'active' : ''}" onclick="setStaffClientSegment('${key}')"><span>${escapeHtml(label)}</span><em>${count}</em></button>`;
  const loadingText = staffClientDataCache.loading ? 'Synchronisation...' : staffClientDataCache.loaded ? `Synchronisé ${formatOpsTimestamp(staffClientDataCache.syncedAt)}` : 'Données locales disponibles';
  const syncIssueText = staffClientDataCache.error ? ' · synchronisation indisponible' : '';
  root.classList.toggle('compact-clients', !!state.staffClientCompact);
  root.innerHTML = `
    <section class="clients-hero">
      <div>
        <h1>Clients</h1>
        <p>${escapeHtml(loadingText)}${escapeHtml(syncIssueText)}</p>
      </div>
      <div class="clients-actions">
        <label class="clients-top-search">
          ${renderStaffClientIcon('search')}
          <input value="${queryValue}" placeholder="Rechercher un client..." oninput="setStaffClientQuery(this.value)">
          <kbd>⌘ K</kbd>
        </label>
        <button type="button" class="clients-action-btn ${state.staffClientFiltersOpen ? 'active' : ''}" onclick="toggleStaffClientFilters()">${renderStaffClientIcon('filter')}Filtres</button>
        <button type="button" class="clients-action-btn" onclick="refreshStaffClients()">${renderStaffClientIcon('refresh')}Actualiser</button>
        <button type="button" class="clients-action-btn" onclick="exportStaffClientsCsv()">${renderStaffClientIcon('import')}Exporter</button>
        <button type="button" class="clients-action-btn primary" onclick="openStaffClientBooking()">${renderStaffClientIcon('plus')}Nouveau client</button>
      </div>
    </section>

    <section class="clients-kpis">
      ${renderStaffClientKpi('users', 'purple', 'Total clients', String(metrics.totalClients), `${metrics.reservations} réservation(s) réelles`, metrics.series.clients)}
      ${renderStaffClientKpi('user', 'blue', 'Clients actifs', String(metrics.activeClients), `${metrics.activeShare}% du total`, metrics.series.players)}
      ${renderStaffClientKpi('star', 'violet', 'Nouveaux ce mois', String(metrics.newThisMonth), `${metrics.previousNew} le mois précédent`, metrics.series.clients)}
      ${renderStaffClientKpi('euro', 'amber', 'Dépense moyenne', formatStaffClientMoney(metrics.averageSpend), `${formatStaffClientMoney(metrics.currentMonthRevenue)} ce mois`, metrics.series.revenue)}
    </section>

    ${state.staffClientFiltersOpen ? renderStaffClientFilterPanel(metrics) : ''}

    <section class="clients-workspace">
      <article class="clients-table-panel">
        <div class="clients-panel-head">
          <div>
            <span>Repertoire CRM</span>
            <strong>${rows.length} profil${rows.length > 1 ? 's' : ''} visible${rows.length > 1 ? 's' : ''}</strong>
          </div>
          <p>Selectionnez une ligne pour ouvrir la fiche, relancer un client ou creer une reservation.</p>
        </div>
        <div class="clients-tabs">
          ${tabButton('all', 'Tous les clients', metrics.totalClients)}
          ${tabButton('loyal', 'Clients fidèles', metrics.loyalClients)}
          ${tabButton('groups', 'Groupes', metrics.groupClients)}
          ${tabButton('birthdays', 'Anniversaires', metrics.birthdayClients)}
        </div>
        <div class="clients-toolbar">
          <label class="clients-panel-search">${renderStaffClientIcon('search')}<input value="${queryValue}" placeholder="Rechercher..." oninput="setStaffClientQuery(this.value)"></label>
          <select class="clients-select" onchange="setStaffClientSegment(this.value)">
            <option value="all" ${tab === 'all' ? 'selected' : ''}>Tous</option>
            <option value="loyal" ${tab === 'loyal' ? 'selected' : ''}>Fidèles</option>
            <option value="groups" ${tab === 'groups' ? 'selected' : ''}>Groupes</option>
            <option value="birthdays" ${tab === 'birthdays' ? 'selected' : ''}>Anniversaires</option>
          </select>
          <select class="clients-select" onchange="setStaffClientStatusFilter(this.value)">
            <option value="all" ${state.staffClientStatusFilter === 'all' ? 'selected' : ''}>Tous statuts</option>
            <option value="active" ${state.staffClientStatusFilter === 'active' ? 'selected' : ''}>Actifs</option>
            <option value="loyal" ${state.staffClientStatusFilter === 'loyal' ? 'selected' : ''}>Fidèles</option>
            <option value="new" ${state.staffClientStatusFilter === 'new' ? 'selected' : ''}>Nouveaux</option>
            <option value="inactive" ${state.staffClientStatusFilter === 'inactive' ? 'selected' : ''}>Inactifs</option>
          </select>
          <span></span>
          <button type="button" class="clients-columns" onclick="toggleStaffClientCompact()">${renderStaffClientIcon('columns')}Colonnes</button>
        </div>
        <div class="clients-table-head">
          <span>Client</span><span>Statut</span><span>Dernière visite</span><span>Réservations</span><span>Dépensé</span><span>Actions</span>
        </div>
        <div class="clients-table-body">
          ${rows.length ? rows.slice(0, 20).map(row => renderStaffClientRow(row, selected && row.id === selected.id)).join('') : `<div class="clients-empty">Aucun client réel ne correspond à ces filtres.</div>`}
        </div>
        <div class="clients-table-footer">
          <span>Affichage de ${rows.length ? 1 : 0} à ${Math.min(rows.length, 20)} sur ${rows.length} client(s) filtré(s)</span>
          <div><button type="button" onclick="clearStaffClientFilters()">Effacer filtres</button><button type="button" onclick="exportStaffClientsCsv()">CSV</button></div>
        </div>
      </article>
      ${renderStaffClientDetail(selected)}
    </section>
  `;
  ensureStaffClientData();
}

function getStaffReservationsMonthKey() {
  return /^\d{4}-\d{2}$/.test(state.staffReservationsMonth || '') ? state.staffReservationsMonth : getMonthKey(state.currentDate || todayStr());
}

function getStaffReservationsMonthAnchor() {
  return `${getStaffReservationsMonthKey()}-01`;
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
  return mergeReservationsById([cacheReservations, state.reservations || []])
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

function staffReservationMatchesActivityFilter(reservation, filter = state.staffReservationActivityFilter || 'all') {
  if (filter === 'all') return true;
  return getStaffReservationActivityType(reservation) === filter;
}

function getStaffReservationsForRange(startDate, endDate, filter = state.staffReservationActivityFilter || 'all') {
  return getStaffReservationsSourceReservations()
    .filter(reservation => reservation.status !== 'cancelled')
    .filter(reservation => reservation.date >= startDate && reservation.date <= endDate)
    .filter(reservation => staffReservationMatchesActivityFilter(reservation, filter));
}

function getStaffReservationFirstTime(reservation) {
  return getReservationFirstResourceStart(reservation, 'all') || timeToNum(reservation.startTime || '00:00');
}

function getStaffReservationTypeLabel(type) {
  const labels = {
    bowling: 'Bowling',
    laser: 'Laser Game',
    complete: 'Complet',
    event: 'Événement',
    maintenance: 'Maintenance'
  };
  return labels[type] || 'Réservation';
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

function renderStaffReservationsKpi(icon, tone, label, value, detail, series) {
  return `<article class="reservations-kpi ${escapeHtml(tone)}">
    <div class="reservations-kpi-icon">${renderDashboardIcon(icon)}</div>
    <div class="reservations-kpi-copy">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(detail)}</small>
    </div>
    ${renderDashboardSpark(series || [0], tone)}
  </article>`;
}

function getStaffReservationsDayCounts(dayReservations = []) {
  return dayReservations.reduce((acc, reservation) => {
    const type = getStaffReservationActivityType(reservation);
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, { bowling: 0, laser: 0, complete: 0, event: 0, maintenance: 0 });
}

function renderStaffReservationsDayRows(counts) {
  const entries = [
    ['bowling', 'Bowling'],
    ['laser', 'Laser Game'],
    ['complete', 'Complet']
  ].filter(([key]) => (counts[key] || 0) > 0);
  if (!entries.length) return '<div class="reservations-day-empty">Aucune réservation</div>';
  return entries.map(([key, label]) => `<div class="reservations-day-line ${key}">
    <span>${counts[key]}</span>
    <em>${escapeHtml(label)}</em>
  </div>`).join('');
}

function renderStaffReservationsCalendar(metrics) {
  const range = metrics.range;
  const filter = state.staffReservationActivityFilter || 'all';
  const source = getStaffReservationsForRange(range.gridStart, range.gridEnd, filter);
  const weeks = [];
  for (let index = 0; index < range.gridDays.length; index += 7) {
    weeks.push(range.gridDays.slice(index, index + 7));
  }
  const weekLabels = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
  return `<article class="reservations-calendar-panel">
    <div class="reservations-filter-row">
      <div class="reservations-pill-group">
        ${renderStaffReservationsFilterButton('all', 'Tous')}
        ${renderStaffReservationsFilterButton('bowling', 'Bowling')}
        ${renderStaffReservationsFilterButton('laser', 'Laser Game')}
        ${renderStaffReservationsFilterButton('complete', 'Complet')}
        ${renderStaffReservationsFilterButton('event', 'Événements')}
      </div>
      <div class="reservations-legend">
        <span><i class="bowling"></i>Bowling</span>
        <span><i class="laser"></i>Laser Game</span>
        <span><i class="complete"></i>Complet</span>
        <span><i class="event"></i>Événement</span>
        <span><i class="maintenance"></i>Maintenance</span>
      </div>
    </div>
    <div class="reservations-calendar">
      ${weekLabels.map(label => `<div class="reservations-weekday">${label}</div>`).join('')}
      ${weeks.flatMap(week => week.map(day => {
        const dayReservations = source.filter(reservation => reservation.date === day);
        const counts = getStaffReservationsDayCounts(dayReservations);
        const isOutside = day.slice(0, 7) !== range.monthKey;
        const isSelected = day === state.staffReservationsSelectedDate;
        const isToday = day === todayStr();
        const hasReservations = dayReservations.length > 0;
        return `<button type="button" class="reservations-day ${isOutside ? 'outside' : ''} ${isSelected ? 'selected' : ''} ${isToday ? 'today' : ''} ${hasReservations ? 'has-reservations' : 'is-empty'}" onclick="selectStaffReservationsDate('${day}')">
          <span class="reservations-day-head"><strong>${parseLocalDate(day).getDate()}</strong><em>${hasReservations ? `${dayReservations.length} rés.` : ''}</em></span>
          <span class="reservations-day-body">${renderStaffReservationsDayRows(counts)}</span>
        </button>`;
      })).join('')}
    </div>
    <div class="reservations-calendar-foot">
      <span>i</span>
      <p>Cliquez sur un jour pour voir le détail des réservations réelles.</p>
    </div>
  </article>`;
}

function renderStaffReservationsFilterButton(key, label) {
  const active = (state.staffReservationActivityFilter || 'all') === key;
  return `<button type="button" class="${active ? 'active' : ''}" onclick="setStaffReservationsActivityFilter('${key}')">${escapeHtml(label)}</button>`;
}

function renderStaffReservationsDayDetail() {
  const selectedDate = state.staffReservationsSelectedDate || state.currentDate || todayStr();
  const dayReservations = getStaffReservationsForRange(selectedDate, selectedDate, state.staffReservationActivityFilter || 'all')
    .sort((left, right) => getStaffReservationFirstTime(left) - getStaffReservationFirstTime(right));
  const dateLabel = parseLocalDate(selectedDate).toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const totalPlayers = dayReservations.reduce((sum, reservation) => sum + (Number(reservation.pax) || 0), 0);
  const totalRevenue = dayReservations.reduce((sum, reservation) => sum + (Number(reservation.price) || 0), 0);
  return `<aside class="reservations-day-detail">
    <div class="reservations-day-detail-head">
      <div>
        <span>Détail journée</span>
        <h2>${escapeHtml(dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1))}</h2>
      </div>
      <button type="button" onclick="openStaffReservationsQuick()">+ Réserver</button>
    </div>
    <div class="reservations-day-summary">
      <div><strong>${dayReservations.length}</strong><span>Réservations</span></div>
      <div><strong>${totalPlayers}</strong><span>Joueurs</span></div>
      <div><strong>${formatMoney(totalRevenue)}</strong><span>Prévu</span></div>
    </div>
    <div class="reservations-day-list">
      ${dayReservations.length ? dayReservations.map(renderStaffReservationsDetailRow).join('') : `<div class="reservations-empty-state">
        <strong>Aucune réservation réelle</strong>
        <span>Ce jour ne contient aucune ligne pour le filtre choisi.</span>
      </div>`}
    </div>
  </aside>`;
}

function renderStaffReservationsDetailRow(reservation) {
  const type = getStaffReservationActivityType(reservation);
  const start = formatClockDisplay(getStaffReservationFirstTime(reservation));
  const windows = getStaffResourceWindows(reservation, 'all');
  const resourceLabel = windows.length
    ? windows.map(window => window.resourceType === 'laser_arena'
      ? `Laser ${formatClockDisplay(window.start)}`
      : `Piste ${(window.lanes || []).join(', ')} ${formatClockDisplay(window.start)}`).join(' · ')
    : getReservationLabel(reservation);
  return `<button type="button" class="reservations-detail-row ${type}" onclick="openStaffReservationDetail(${staffClientJs(reservation.id)})">
    <span class="time">${escapeHtml(start)}</span>
    <span class="main"><strong>${escapeHtml(reservation.name || 'Sans nom')}</strong><em>${escapeHtml(getReservationLabel(reservation))}</em></span>
    <span class="resource">${escapeHtml(resourceLabel)}</span>
    <span class="players">${Number(reservation.pax || 0)} pers.</span>
    <span class="status ${escapeHtml(reservation.status || 'confirmed')}">${escapeHtml(getStaffReservationStatusLabel(reservation.status))}</span>
    <span class="amount">${formatMoney(reservation.price || 0)}</span>
  </button>`;
}

function renderStaffReservationsPage() {
  const root = document.getElementById('staffReservationsPage');
  if (!root) return;
  const metrics = getStaffReservationsMetrics();
  const range = metrics.range;
  const monthLabel = parseLocalDate(range.monthStart).toLocaleDateString('fr-BE', { month: 'long', year: 'numeric' });
  const syncText = staffReservationsDataCache.loading
    ? 'Synchronisation...'
    : staffReservationsDataCache.loaded
      ? `Synchronisé ${formatOpsTimestamp(staffReservationsDataCache.syncedAt)}`
      : 'Données locales disponibles';
  const syncIssue = staffReservationsDataCache.error ? ' · API indisponible' : '';
  root.innerHTML = `
    <section class="reservations-hero">
      <div>
        <h1>Réservations</h1>
        <p>Vue mensuelle des réservations réelles · ${escapeHtml(syncText)}${escapeHtml(syncIssue)}</p>
      </div>
      <div class="reservations-actions">
        <select class="reservations-select" onchange="setStaffReservationsPreset(this.value)">
          <option value="today" ${state.staffReservationsPreset === 'today' ? 'selected' : ''}>Aujourd'hui</option>
          <option value="month" ${state.staffReservationsPreset === 'month' ? 'selected' : ''}>Mois affiché</option>
        </select>
        <div class="reservations-month-nav">
          <button type="button" aria-label="Mois précédent" onclick="shiftStaffReservationsMonth(-1)">‹</button>
          <button type="button" class="month-button" onclick="openStaffReservationsMonthPicker()">${escapeHtml(monthLabel)}</button>
          <input id="staffReservationsMonthPicker" type="month" value="${escapeHtml(range.monthKey)}" onchange="setStaffReservationsMonthFromPicker(this.value)" aria-label="Choisir un mois">
          <button type="button" aria-label="Mois suivant" onclick="shiftStaffReservationsMonth(1)">›</button>
        </div>
        <button type="button" class="reservations-action" onclick="refreshStaffReservations()">Actualiser</button>
        <button type="button" class="reservations-action primary" onclick="openStaffReservationsQuick()">+ Nouvelle réservation</button>
      </div>
    </section>

    <section class="reservations-kpi-grid">
      ${renderStaffReservationsKpi('calendar', 'violet', 'Réservations ce mois', String(metrics.reservations), `${metrics.reservationTrend} vs mois précédent`, metrics.series.reservations)}
      ${renderStaffReservationsKpi('users', 'blue', 'Joueurs ce mois', String(metrics.players), `${metrics.playersTrend} vs mois précédent`, metrics.series.players)}
      ${renderStaffReservationsKpi('euro', 'green', "Chiffre d'affaires", formatMoney(metrics.revenue), `${metrics.revenueTrend} vs mois précédent`, metrics.series.revenue)}
      ${renderStaffReservationsKpi('activity', 'amber', "Taux d'occupation moyen", `${metrics.occupancy}%`, `${metrics.occupancyTrend} vs mois précédent`, metrics.series.occupancy)}
    </section>

    <section class="reservations-main-grid">
      ${renderStaffReservationsCalendar(metrics)}
      ${renderStaffReservationsDayDetail()}
    </section>
  `;
  ensureStaffReservationsData();
}

function refreshStaffReservations() {
  loadStaffReservationsData(true);
}

function setStaffReservationsActivityFilter(filter) {
  state.staffReservationActivityFilter = ['all', 'bowling', 'laser', 'complete', 'event'].includes(filter) ? filter : 'all';
  save();
  renderStaffReservationsPage();
}

function selectStaffReservationsDate(dateStr) {
  state.staffReservationsSelectedDate = dateStr;
  state.currentDate = dateStr;
  save();
  renderStaffReservationsPage();
  syncDateReservations(dateStr, { silent: true });
}

function setStaffReservationsPreset(value) {
  state.staffReservationsPreset = value === 'today' ? 'today' : 'month';
  if (state.staffReservationsPreset === 'today') {
    const today = todayStr();
    state.staffReservationsSelectedDate = today;
    state.currentDate = today;
    state.staffReservationsMonth = getMonthKey(today);
    syncDateReservations(today, { silent: true });
  }
  save();
  renderStaffReservationsPage();
  ensureStaffReservationsData();
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
  if (isStaffDashboardActive()) {
    document.body.style.overflow = '';
    renderStaffDashboard(dayReservations);
    return;
  }
  if (isStaffReservationsActive()) {
    document.body.style.overflow = '';
    renderStaffReservationsPage();
    return;
  }
  if (isStaffClientsActive()) {
    document.body.style.overflow = '';
    renderStaffClientsPage();
    return;
  }
  if (isStaffPricingActive()) {
    document.body.style.overflow = '';
    renderStaffPricingPage();
    return;
  }
  if (isStaffEmailsActive()) {
    document.body.style.overflow = '';
    renderStaffEmailsPage();
    return;
  }
  if (isStaffCampaignsActive()) {
    document.body.style.overflow = '';
    renderStaffCampaignsPage();
    return;
  }
  if (isStaffUtilityActive()) {
    document.body.style.overflow = '';
    renderStaffUtilityPage();
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
  renderKpis();
  renderPlanning();
  renderLaserPlanning();
  renderTable();
}

// Recalcule la hauteur de ligne bowling / le layout laser quand la fenêtre change
// de taille en plein écran. Attaché uniquement pendant le plein écran, détaché à
// la fermeture pour éviter toute fuite d'écouteur.
let planningFullscreenResizeHandler = null;

function attachPlanningFullscreenResize() {
  if (planningFullscreenResizeHandler) return;
  let raf = 0;
  planningFullscreenResizeHandler = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (state.staffPlanningExpanded) renderPlanning();
      else if (state.staffLaserPlanningExpanded) renderLaserPlanning();
    });
  };
  window.addEventListener('resize', planningFullscreenResizeHandler);
}

function detachPlanningFullscreenResize() {
  if (!planningFullscreenResizeHandler) return;
  window.removeEventListener('resize', planningFullscreenResizeHandler);
  planningFullscreenResizeHandler = null;
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

function togglePlanningFilterMenu(event) {
  const active = state.staffStatusFilter || 'all';
  const options = [
    ['all', 'Toutes'],
    ['open', 'À gérer'],
    ['pending', 'À venir'],
    ['arrived', 'Sur place'],
    ['paid', 'Payées']
  ];
  showStaffFloatingMenu(event, `
    <div class="staff-action-popover-title">Filtrer le planning</div>
    ${options.map(([key, label]) => `<button type="button" class="${active === key ? 'active' : ''}" onclick="applyPlanningStatusFilter('${key}')">${label}</button>`).join('')}
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
  downloadTextFile(`fungalaxy-planning-${state.currentDate || todayStr()}.csv`, [header.map(csvCell).join(','), ...rows.map(row => row.map(csvCell).join(','))].join('\n'), 'text/csv;charset=utf-8');
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

function openStaffDatePicker(ev) {
  const picker = document.getElementById(isStaffDashboardActive() ? 'dashboardDatePicker' : 'staffDatePicker') || document.getElementById('staffDatePicker');
  if (!picker) return;
  picker.value = state.currentDate;
  picker.removeAttribute('min');
  // Le picker natif vit dans .staff-head, masquée (display:none) sur les pages
  // Terrain — showPicker l'ancre alors au coin haut-gauche. On le déplace sous
  // le bouton déclencheur pour que le calendrier s'ouvre au bon endroit.
  const trigger = ev && (ev.currentTarget || ev.target);
  const rect = trigger && typeof trigger.getBoundingClientRect === 'function' ? trigger.getBoundingClientRect() : null;
  if (rect) {
    if (picker.parentElement !== document.body) document.body.appendChild(picker);
    picker.style.position = 'fixed';
    picker.style.left = `${Math.round(rect.left)}px`;
    picker.style.top = `${Math.round(rect.bottom + 4)}px`;
    picker.style.width = '1px';
    picker.style.height = '1px';
    picker.style.margin = '0';
    picker.style.opacity = '0';
    picker.style.pointerEvents = 'none';
    picker.style.zIndex = '1';
  }
  try {
    if (typeof picker.showPicker === 'function') {
      picker.showPicker();
      return;
    }
  } catch (error) {}
  picker.focus();
  picker.click();
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

function scopedStaffReservations(view = getStaffResourceView()) {
  return todaysReservations().filter(r => reservationMatchesStaffResource(r, view));
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

function getReservationHighlightClasses(reservation) {
  const classes = [];
  if (reservation.type === 'formule' || reservation.formuleId) classes.push('is-formula');
  const bowlingDuration = getBowlingDurationForReservation(reservation);
  if (bowlingDuration && Math.abs(bowlingDuration - 1) > 0.01) classes.push('is-special-duration');
  if (getLaserGameCountForReservation(reservation) > 1) classes.push('is-laser-multi');
  return classes.join(' ');
}

function renderReservationTags(reservation) {
  const tags = [];
  const formule = reservation.formuleId ? FORMULES.find(x => x.id === reservation.formuleId) : null;
  if (reservation.type === 'formule' || formule) tags.push({ cls: 'formula', label: formule?.name || 'Formule' });
  const bowlingDuration = getBowlingDurationForReservation(reservation);
  if (bowlingDuration && Math.abs(bowlingDuration - 1) > 0.01) {
    tags.push({ cls: 'duration', label: `Bowling ${formatDurationLabel(bowlingDuration)}` });
  }
  const laserGames = getLaserGameCountForReservation(reservation);
  if (laserGames > 1) tags.push({ cls: 'laser-plus', label: `Laser x${laserGames}` });
  if (!tags.length) return '';
  return `<div class="reservation-tags">${tags.map(tag => `<span class="reservation-tag ${tag.cls}">${tag.label}</span>`).join('')}</div>`;
}

function getReservationCommercialStore(reservation) {
  return reservation?.opsPlan?.guestOps && typeof reservation.opsPlan.guestOps === 'object'
    ? reservation.opsPlan.guestOps
    : {};
}

function getReservationCheckInCode(reservation) {
  const idPart = String(reservation?.id || '0000').slice(-4).padStart(4, '0');
  const datePart = String(reservation?.date || todayStr()).replace(/-/g, '').slice(2);
  return `FG-${datePart}-${idPart}`;
}

function reservationRequiresGuestWaiver(reservation) {
  return reservation?.type === 'laser'
    || getLaserGameCountForReservation(reservation) > 0
    || getLaserWindowsFromReservation(reservation).length > 0;
}

function getReservationDepositAmount(reservation) {
  const price = Number(reservation?.price || reservation?.basePrice || 0);
  const pax = Number(reservation?.pax || 0);
  const needsDeposit = reservation?.type === 'formule'
    || Boolean(reservation?.formuleId)
    || pax >= 10
    || price >= 150;
  if (!needsDeposit || price <= 0) return 0;
  return Math.min(price, Math.max(50, Math.ceil((price * 0.25) / 5) * 5));
}

function getReservationGuestOps(reservation) {
  const stored = getReservationCommercialStore(reservation);
  const depositAmount = Number(stored.depositAmount ?? getReservationDepositAmount(reservation));
  const waiverRequired = Boolean(stored.waiverRequired ?? reservationRequiresGuestWaiver(reservation));
  const depositRequired = Boolean(stored.depositRequired ?? depositAmount > 0);
  const checkInDone = Boolean(stored.checkInDone || reservation.status === 'arrived' || reservation.status === 'paid');
  const depositPaid = Boolean(stored.depositPaid || reservation.status === 'paid');
  const waiverDone = Boolean(stored.waiverDone);
  const missing = [];
  if (depositRequired && !depositPaid) missing.push('acompte');
  if (waiverRequired && !waiverDone) missing.push('consignes laser');
  if (!checkInDone) missing.push('check-in');
  const scoreBase = [!depositRequired || depositPaid, !waiverRequired || waiverDone, checkInDone];
  const readinessScore = Math.round((scoreBase.filter(Boolean).length / scoreBase.length) * 100);
  return {
    depositRequired,
    depositAmount,
    depositPaid,
    waiverRequired,
    waiverDone,
    checkInDone,
    checkInCode: stored.checkInCode || getReservationCheckInCode(reservation),
    reminderSent: Boolean(stored.reminderSent),
    lastUpdatedAt: stored.updatedAt || '',
    missing,
    readinessScore,
  };
}

function getGuestOpsChips(reservation) {
  const guest = getReservationGuestOps(reservation);
  const chips = [];
  if (guest.depositRequired) {
    chips.push({
      cls: guest.depositPaid ? 'ok' : 'warn',
      label: guest.depositPaid ? `Acompte OK` : `Acompte ${guest.depositAmount}€`,
    });
  }
  if (guest.waiverRequired) {
    chips.push({
      cls: guest.waiverDone ? 'ok' : 'warn',
      label: guest.waiverDone ? 'Consignes OK' : 'Consignes laser',
    });
  }
  chips.push({
    cls: guest.checkInDone ? 'ok' : 'danger',
    label: guest.checkInDone ? 'Check-in OK' : guest.checkInCode,
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

function renderOpsPlanInsightBlock(reservation) {
  const plan = reservation?.opsPlan;
  if (!plan) return '';
  const fixed = getOpsPlanFixedCommitments(plan).slice(0, 6);
  const flexible = getOpsPlanFlexibleEntitlements(plan)
    .map(item => item.label || item.type)
    .filter(Boolean);
  const flexibleUnique = [...new Set(flexible)].slice(0, 5);
  const checklist = [
    ...(Array.isArray(plan.operationsChecklist) ? plan.operationsChecklist : []),
    ...(Array.isArray(plan.marketIntelligence?.warnings) ? plan.marketIntelligence.warnings : []),
  ].slice(0, 4);
  const quality = plan.marketIntelligence?.qualityScore;
  const cards = [];
  if (fixed.length) {
    cards.push(`<div class="ops-plan-card"><div class="k">Réservé</div><div class="v">${fixed.map(formatOpsCommitment).map(escapeHtml).join('<br>')}</div></div>`);
  }
  if (flexibleUnique.length) {
    cards.push(`<div class="ops-plan-card"><div class="k">Libre sur place</div><div class="v">${escapeHtml(flexibleUnique.join(' · '))}</div></div>`);
  }
  if (Number.isFinite(Number(quality))) {
    cards.push(`<div class="ops-plan-card"><div class="k">Qualité planning</div><div class="v">${Math.round(Number(quality))}/100</div></div>`);
  }
  if (!cards.length && !checklist.length) return '';
  return `<div class="info-block">
    <div class="info-label">Lecture opérationnelle</div>
    ${cards.length ? `<div class="ops-plan-grid">${cards.join('')}</div>` : ''}
    ${checklist.length ? `<div class="ops-checklist">${checklist.map(item => `<span>${escapeHtml(item)}</span>`).join('')}</div>` : ''}
  </div>`;
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
  setPageVisibility('staffDashboardPage', dashboardActive);
  setPageVisibility('staffReservationsPage', reservationsActive);
  setPageVisibility('staffClientsPage', clientsActive);
  setPageVisibility('staffPricingPage', pricingActive);
  setPageVisibility('staffEmailsPage', emailsActive);
  setPageVisibility('staffCampaignsPage', campaignsActive);
  setPageVisibility('staffUtilityPage', utilityActive);
  ['.staff-head', '.kpi-grid', '.staff-resource-tabs', '#planningBox', '#laserPlanningBox', '.table-box'].forEach(selector => {
    document.querySelectorAll(`#staffView ${selector}`).forEach(element => element.classList.toggle('hidden', dashboardActive || reservationsActive || clientsActive || pricingActive || emailsActive || campaignsActive || utilityActive));
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
  const datePicker = document.getElementById('staffDatePicker');
  if (datePicker) {
    datePicker.value = state.currentDate;
    datePicker.removeAttribute('min');
  }
  const prevBtn = document.getElementById('staffPrevDateBtn');
  if (prevBtn) prevBtn.disabled = false;

  const bowlingReservations = dayReservations.filter(r => getBowlingWindowsFromReservation(r).length > 0);
  const laserReservations = dayReservations.filter(r => getLaserWindowsFromReservation(r).length > 0);
  const planningWindow = getPlanningWindow(state.currentDate);
  const bowlingPlayers = bowlingReservations.reduce((sum, reservation) => sum + (Number(reservation.pax) || 0), 0);
  const planningSub = document.getElementById('planningSub');
  if (planningSub) planningSub.textContent = `${bowlingReservations.length} réservation${bowlingReservations.length > 1 ? 's' : ''} bowling • ${bowlingPlayers} joueurs • ${planningWindow.closed ? 'centre fermé' : planningWindow.label}`;
  const planningSearchInput = document.getElementById('planningSearchInput');
  if (planningSearchInput) planningSearchInput.value = state.searchTerm || '';
  document.getElementById('staffTabAll')?.classList.toggle('active', view === 'all');
  document.getElementById('staffTabBowling')?.classList.toggle('active', view === 'bowling');
  document.getElementById('staffTabLaser')?.classList.toggle('active', view === 'laser');
  const allCountEl = document.getElementById('staffAllCount');
  const bowlingCountEl = document.getElementById('staffBowlingCount');
  const laserCountEl = document.getElementById('staffLaserCount');
  if (allCountEl) allCountEl.textContent = dayReservations.length;
  if (bowlingCountEl) bowlingCountEl.textContent = bowlingReservations.length;
  if (laserCountEl) laserCountEl.textContent = laserReservations.length;
  document.getElementById('planningBox')?.classList.toggle('hidden', dashboardActive || reservationsActive || clientsActive || pricingActive || emailsActive || campaignsActive || utilityActive || view === 'laser');
  document.getElementById('laserPlanningBox')?.classList.toggle('hidden', dashboardActive || reservationsActive || clientsActive || pricingActive || emailsActive || campaignsActive || utilityActive || view === 'bowling');
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
          <span>Ces dossiers restent visibles pour contrôle staff. Aucune nouvelle disponibilité publique ne sera proposée.</span>
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
  let HH = state.staffPlanningExpanded ? 52 : 48;
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
    const MIN_HOUR_H = 34;
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

  let lanesHtml = '';
  for (let i = 1; i <= TOTAL_LANES; i++) {
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
      const verticalInset = state.staffPlanningExpanded ? 4 : 1;
      const top = (st - startHour) * HH + HEADER_H + verticalInset;
      const rawHeight = (Number(item.window.duration) * HH) - (verticalInset * 2);
      const minHeight = state.staffPlanningExpanded ? 40 : 22;
      const height = Math.max(rawHeight, minHeight);
      const end = formatClockDisplay(item.window.end);
      let cls = 'conf';
      if (r.status === 'arrived') cls = 'arr';
      if (r.status === 'paid') cls = 'paid';
      const compactClass = state.staffPlanningExpanded
        ? (height < 92 ? ' booking-compact' : '')
        : (height <= 30 ? ' booking-mini' : height <= 52 ? ' booking-snug' : '');
      const displayName = getPlanningBookingDisplayName(r);
      const fullName = String(r.name || 'Client');
      bkHtml += `<div class="booking ${cls}${compactClass} ${getReservationHighlightClasses(r)}" data-booking-res-id="${r.id}" data-booking-lane="${i}" data-booking-start="${st}" data-range="${formatClockDisplay(st)} - ${end}" data-extra="${cls === 'paid' ? 'payé' : cls === 'arr' ? 'sur place' : 'confirmé'}" style="top:${top}px;height:${height}px;" onmousedown="startBowlingBookingPointerDrag(event, ${r.id}, ${i}, ${st})" onclick="if(shouldIgnoreBowlingDragClick(event)) return; event.stopPropagation();openPos(${r.id})">
        <div class="booking-name" title="${escapeHtml(fullName)}">${escapeHtml(displayName)}</div>
        <div class="b-tag">${getReservationLabel(r)}</div>
        ${renderReservationTags(r)}
        <div class="booking-meta">${r.pax}j • ${formatDurationLabel(item.window.duration)}</div>
      </div>`;
    });
    lanesHtml += `<div class="lane-col ${maint ? 'maint' : ''}" data-lane="${i}">
      <div class="lane-header">
        <span class="pl">Piste</span>
        <span class="num">${i}</span>
        <button class="settings" onclick="toggleMaint(${i}, event)" title="Maintenance" aria-label="Parametres piste ${i}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        </button>
      </div>
      ${cells}
      ${bkHtml}
    </div>`;
  }

  wrap.innerHTML = `
    <div class="planning-grid">
      ${curPos >= HEADER_H ? `<div class="current-line" data-time="${formatClockDisplay(curH)}" style="top:${curPos}px"></div>` : ''}
      <div class="hour-col">
        <div class="hour-header">Heure</div>
        ${hoursHtml}
      </div>
      <div class="lanes-row">${lanesHtml}</div>
    </div>`;
  wrap.scrollTop = prevScrollTop;
  wrap.scrollLeft = prevScrollLeft;
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
  const wrap = document.getElementById('laserPlanningGridWrap');
  const sub = document.getElementById('laserPlanningSub');
  if (!wrap) return;
  // Préserve le scroll (heures + horizontal) entre deux re-renders du polling.
  const prevScrollTop = wrap.scrollTop;
  const prevScrollLeft = wrap.scrollLeft;
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
  const capacity = LASER_GAME_MAX_PLAYERS;
  const pendingPasses = getPendingLaserPasses(state.currentDate);
  if (sub) sub.textContent = `${sessions.length} lancement${sessions.length > 1 ? 's' : ''} • ${players} passages • ${pendingPasses.length} partie${pendingPasses.length > 1 ? 's' : ''} à placer • capacité ${capacity} armes`;

  const startHour = config.open;
  const closeHour = config.close;
  const halfSlots = Math.max((closeHour - startHour) * 2, 1);
  const isToday = state.currentDate === todayStr();
  const curH = currentTimeDecimal();
  const sessionsBySlot = new Map();
  sessions.forEach(session => {
    const slotIndex = Math.max(0, Math.min(halfSlots - 1, Math.floor(((session.start - startHour) * 2) + 0.001)));
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
        return `<button type="button" class="laser-pass-card" draggable="false" onmousedown="startLaserPassPointerDrag(event, ${reservation.id}, ${pass.countIndex})" onclick="if(shouldIgnoreLaserPassClick(event)) return; editRes(${reservation.id}, event)" title="Glisser pour placer cette partie">
          <span class="laser-pass-name">${escapeHtml(reservation.name || 'Groupe')}</span>
          <span class="laser-pass-meta">Partie ${pass.countIndex}/${pass.totalGames} • ${pass.players} joueur${pass.players > 1 ? 's' : ''}</span>
          <span class="laser-pass-origin">1re partie ${scheduled ? formatClockDisplay(scheduled.start) : formatClockDisplay(timeToNum(reservation.startTime))}</span>
        </button>`;
      }).join('')
    : `<div class="laser-pass-empty">Aucune partie en attente. Toutes les parties sont placées.</div>`;
  const pendingQueueHtml = showPassQueue ? `
    <div class="laser-pass-queue${pendingPasses.length ? '' : ' is-empty'}" aria-label="Parties Laser Game à placer">
      <div class="laser-pass-queue-copy">
        <strong>Parties à placer${pendingPasses.length ? ` • ${pendingPasses.length}` : ''}</strong>
        <span>Glissez une carte sur un lancement disponible ou partagé.</span>
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
      const waveLabel = window.groupWaveCount > 1 ? `Vague ${window.groupWaveIndex || 1}/${window.groupWaveCount}` : '';
      const laserGames = getLaserGameCountForReservation(reservation);
      const passIndex = Number(window.countIndex || 1);
      const passLabel = laserGames > 1 ? `Partie ${passIndex}/${laserGames}` : 'Partie unique';
      const label = isFormulaGroup
        ? `${getReservationLabel(reservation)}${laserGames > 1 ? ` • ${passLabel}` : ' • Laser'}`
        : laserGames > 1 ? `Laser • ${passLabel}` : 'Laser direct';
      const pillHtml = `
        <span class="laser-card-pills">
          ${isFormulaGroup ? '<span class="laser-card-pill formula">Formule</span>' : '<span class="laser-card-pill direct">Direct</span>'}
          ${laserGames > 1 ? `<span class="laser-card-pill pass">P${passIndex}/${laserGames}</span>` : ''}
          ${window.formulaFallback ? '<span class="laser-card-pill fallback">Plan estimé</span>' : ''}
        </span>`;
      const dragTitle = passIndex > 1 ? `Déplacer la partie ${passIndex}/${laserGames}` : 'Déplacer ce groupe Laser Game';
      return `<button type="button" class="laser-group-card ${typeClass} ${statusClass}" draggable="false" onmousedown="startLaserPassPointerDrag(event, ${reservation.id}, ${passIndex})" onclick="if(shouldIgnoreLaserPassClick(event)) return; event.stopPropagation();editRes(${reservation.id}, event)" title="${escapeHtml(dragTitle)}">
        <span class="laser-group-main">
          <strong>${escapeHtml(reservation.name || 'Groupe')}</strong>
          <small>${escapeHtml(label)}${waveLabel ? ` • ${escapeHtml(waveLabel)}` : ''}</small>
          ${pillHtml}
        </span>
        <span class="laser-group-count">${players}j</span>
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
    const sessionPlayers = slotSessions.reduce((sum, session) => (
      sum + session.windows.reduce((inner, window) => inner + Number(window.players || window.reservation?.pax || 0), 0)
    ), 0);
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

  wrap.innerHTML = `
    ${pendingQueueHtml}
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

function filterReservationsForStaff(reservations, filter) {
  if (filter === 'open') return reservations.filter(r => r.status !== 'paid');
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
    paid
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
    ? `<div class="res-row-lanes">${bowlingChipHtml}${laserChipHtml || ''}${!bowlingChipHtml && !laserChipHtml ? '<span class="res-lanes-empty">Hors ressource</span>' : ''}</div>`
    : view === 'laser'
      ? `<div class="res-row-lanes"><span class="res-lane-chip laser">${laserWindow ? `${formatClockDisplay(laserWindow.start)}-${formatClockDisplay(laserWindow.end)}` : 'Laser'}</span></div>`
      : bowlingLanes.length
        ? `<div class="res-row-lanes">${bowlingChipHtml}</div>`
        : `<span class="res-lanes-empty">Hors piste</span>`;
  const stateText = r.status === 'paid' ? `${r.price}€ payé` : r.status === 'arrived' ? 'Arrivé' : 'Confirmé';
  const timeLabel = resourceWindows.length ? formatClockDisplay(resourceWindows[0].start) : r.startTime;
  const resourceDurationLabel = view === 'all'
    ? (isFormule ? 'Formule' : r.type === 'laser' ? (getLaserGameCountForReservation(r) > 1 ? `Laser x${getLaserGameCountForReservation(r)}` : 'Laser') : formatDurationLabel(r.duration))
    : view === 'laser'
    ? (getLaserGameCountForReservation(r) > 1 ? `Laser x${getLaserGameCountForReservation(r)}` : 'Laser')
    : formatDurationLabel(resourceWindows[0]?.duration || r.duration);

  return `<div class="res-row ${r.status} ${getReservationHighlightClasses(r)}" onclick="openPos(${r.id})">
    <div class="res-row-time">
      <strong>${timeLabel}</strong>
      <span>${resourceDurationLabel}</span>
    </div>
    <div class="res-row-main">
      <div class="res-row-top">
        <span class="res-row-name">${escapeHtml(r.name)}</span>
        <span class="type-badge ${isFormule ? 'formule' : isLaser ? 'laser' : 'bowling'}">
          ${isFormule ? '<svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8l-6.2 4.5 2.4-7.4L2 9.4h7.6z"/></svg>' : isLaser ? '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>' : '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="9"/><circle cx="9" cy="9" r="1.2" fill="currentColor"/><circle cx="14" cy="10" r="1.2" fill="currentColor"/></svg>'}
          ${typeLabel}
        </span>
      </div>
      ${renderReservationTags(r)}
      ${renderStaffOpsMini(r)}
      ${renderGuestOpsMini(r)}
      <div class="res-row-meta">
        <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>${r.phone || '—'}</span>
        <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>${r.pax} joueur${r.pax > 1 ? 's' : ''}</span>
      </div>
    </div>
    <div class="res-row-side">
      <div class="res-row-label">${view === 'all' ? 'Ressources' : view === 'laser' ? 'Laser' : bowlingLanes.length ? 'Pistes' : 'Emplacement'}</div>
      ${lanesHtml}
    </div>
    <div class="res-row-actions" onclick="event.stopPropagation()">
      <span class="res-state-pill ${r.status}">${stateText}</span>
      <div class="res-status-row compact">
        <button class="res-status-btn ${r.status === 'pending' ? 'active pending' : ''}" onclick="setReservationStatusDirect(${r.id}, 'pending', event)">Confirmé</button>
        <button class="res-status-btn ${r.status === 'arrived' ? 'active arrived' : ''}" onclick="setReservationStatusDirect(${r.id}, 'arrived', event)">Arrivé</button>
        <button class="res-status-btn ${r.status === 'paid' ? 'active paid' : ''}" onclick="setReservationStatusDirect(${r.id}, 'paid', event)">Payé</button>
      </div>
      <div class="res-row-tools">
        <button class="res-icon-btn" onclick="editRes(${r.id}, event)" title="Editer"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
        <button class="res-icon-btn warn" onclick="cancelRes(${r.id}, event)" title="Annuler"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="8" y1="8" x2="16" y2="16"/></svg></button>
        <button class="res-icon-btn danger" onclick="deleteRes(${r.id}, event)" title="Supprimer"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
      </div>
    </div>
  </div>`;
}

function renderReservationSection(statusKey, title, subtitle, reservations) {
  const ordered = [...reservations].sort((a, b) => {
    if (statusKey === 'paid') return timeToNum(b.startTime) - timeToNum(a.startTime);
    return timeToNum(a.startTime) - timeToNum(b.startTime);
  });
  return `<div class="res-section workflow ${statusKey}">
    <div class="res-section-head">
      <div>
        <span class="label">${title}</span>
        <div class="table-summary">${subtitle}</div>
      </div>
      <div class="meta">
        <span class="count">${ordered.length}</span>
      </div>
    </div>
    ${ordered.length ? `<div class="res-dense-list">${ordered.map(renderReservationRow).join('')}</div>` : `<div class="res-empty-inline">Aucune réservation dans cette zone.</div>`}
  </div>`;
}

function renderTable() {
  const view = getStaffResourceView();
  const res = scopedStaffReservations(view);
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
  const resourceSummary = view === 'all'
    ? `Vue complète • ${res.length}/${todaysReservations().length} visibles`
    : view === 'laser'
      ? 'Laser Game uniquement'
      : 'Bowling uniquement';
  const resourceName = view === 'all' ? 'pour ce jour' : view === 'laser' ? 'Laser Game pour ce jour' : 'Bowling pour ce jour';
  const planningName = view === 'all' ? 'sur un planning' : view === 'laser' ? 'Laser Game' : 'Bowling';
  const toolbar = `<div class="table-toolbar">
    <div class="status-filters">
      <button class="status-chip ${state.staffStatusFilter === 'all' ? 'active' : ''}" onclick="setStaffStatusFilter('all')">Tout <span>${counts.all}</span></button>
      <button class="status-chip ${state.staffStatusFilter === 'open' ? 'active open' : ''}" onclick="setStaffStatusFilter('open')">À gérer <span>${counts.open}</span></button>
      <button class="status-chip ${state.staffStatusFilter === 'arrived' ? 'active arrived' : ''}" onclick="setStaffStatusFilter('arrived')">Sur place <span>${counts.arrived}</span></button>
      <button class="status-chip ${state.staffStatusFilter === 'pending' ? 'active pending' : ''}" onclick="setStaffStatusFilter('pending')">À venir <span>${counts.pending}</span></button>
      <button class="status-chip ${state.staffStatusFilter === 'paid' ? 'active paid' : ''}" onclick="setStaffStatusFilter('paid')">Terminées <span>${counts.paid}</span></button>
    </div>
    <div class="table-summary">${resourceSummary} • ${counts.open} à gérer maintenant • ${counts.paid} terminées</div>
  </div>`;
  if (!filtered.length) {
    list.innerHTML = `${toolbar}<div class="empty-state">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      <div class="e-title">${state.searchTerm ? 'Aucun résultat' : `Aucune réservation ${resourceName}`}</div>
      <div class="e-sub">${state.searchTerm ? 'Essayez un autre mot-clé' : `Cliquez sur "Réservation rapide" ou ${planningName} pour en créer une`}</div>
    </div>`;
    return;
  }
  const sections = [
    { key: 'arrived', title: 'Sur place', subtitle: 'Clients présents, à suivre maintenant', rows: filtered.filter(r => r.status === 'arrived') },
    { key: 'pending', title: 'À venir', subtitle: 'Réservations confirmées, triées par horaire', rows: filtered.filter(r => r.status === 'pending') },
    { key: 'paid', title: 'Terminées', subtitle: 'Clôturées et descendues en bas de liste', rows: filtered.filter(r => r.status === 'paid') }
  ].filter(section => {
    if (state.staffStatusFilter === 'arrived') return section.key === 'arrived';
    if (state.staffStatusFilter === 'pending') return section.key === 'pending';
    if (state.staffStatusFilter === 'paid') return section.key === 'paid';
    if (state.staffStatusFilter === 'open') return section.key !== 'paid';
    return true;
  }).filter(section => section.rows.length > 0);

  list.innerHTML = `${toolbar}
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
    const labels = {
      pending: 'Réservation marquée comme confirmée',
      arrived: 'Client marqué comme arrivé',
      paid: 'Réservation marquée comme payée'
    };
    toast(labels[status] || 'Statut mis à jour');
  }).catch(error => {
    if (!isLatestRequest()) return;
    applyOptimisticReservation(current, { preserveEditState: true });
    clearReservationMutation(id);
    toast(error.message || 'Impossible de mettre à jour le statut.');
  }).finally(() => {
    clearReservationMutationInFlight(id, 'status');
    if (isLatestRequest()) delete statusSaveLatestSeqByReservation[requestKey];
  });
  return;
  state.reservations = state.reservations.map(r => {
    if (r.id !== id) return r;
    const updated = { ...r, status };
    if (status === 'paid' && !updated.paymentMethod) updated.paymentMethod = 'Comptoir';
    return updated;
  });
  const updatedReservation = state.reservations.find(r => r.id === id);
  if (state.selectedRes && state.selectedRes.id === id) {
    state.selectedRes = updatedReservation;
    state.editState = { ...updatedReservation, lanesStr: (updatedReservation.lanes || []).join(', ') };
    renderPos();
  }
  save();
  renderStaff();
  const labels = {
    pending: 'Réservation marquée comme confirmée',
    arrived: 'Client marqué comme arrivé',
    paid: 'Réservation marquée comme payée'
  };
  toast(labels[status] || 'Statut mis à jour');
}

function quickPay(id) {
  setReservationStatusDirect(id, 'paid');
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
  if (!confirm('Supprimer cette réservation ?')) return;
  const current = state.reservations.find(r => r.id === id);
  if (!current) return;
  removeOptimisticReservation(id);
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
}

function setTab(t) {
  state.activeTab = t === 'caisse' ? 'details' : t;
  if (state.activeTab === 'modifier') {
    state.editState = { ...state.selectedRes, lanesStr: (state.selectedRes.lanes || []).join(', ') };
    syncEditLaneAssignment();
  }
  renderPos();
}

function legacyRenderPos() {
  if (!state.selectedRes) return;
  const r = state.selectedRes;
  const overlay = document.getElementById('posOverlay');
  overlay.classList.remove('hidden');
  if (state.activeTab === 'modifier') {
    overlay.classList.add('centered');
    overlay.innerHTML = `
      <div class="edit-modal">
        <div class="edit-modal-head">
          <div>
            <h3>Modifier la réservation</h3>
            <p>Un seul pop-up centré pour corriger le client, l'horaire, les pistes ou le statut sans casser la lecture du planning.</p>
          </div>
          <button class="close-btn" onclick="closePos()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="edit-modal-body">${renderPosEdit(r)}</div>
      </div>
    `;
    return;
  }
  overlay.classList.remove('centered');
  const bodyHtml = renderPosDetails(r);

  overlay.innerHTML = `
    <div class="pos-panel">
      <div class="pos-head">
        <div class="pos-head-top">
          <div>
            <h3>${escapeHtml(r.name)}</h3>
          </div>
          <button class="close-btn" onclick="closePos()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="tabs">
          <button class="tab ${state.activeTab === 'details' ? 'active' : ''}" onclick="setTab('details')">Infos</button>
          <button class="tab ${state.activeTab === 'modifier' ? 'active' : ''}" onclick="setTab('modifier')">Éditer</button>
        </div>
      </div>
      <div class="pos-body">${bodyHtml}</div>
    </div>
  `;
}

function renderPosDetails(r) {
  const laserWindow = getLaserWindowsFromReservation(r)[0] || null;
  const lanesTxt = r.type === 'laser'
    ? `Laser Game : ${laserWindow ? `${formatClockDisplay(laserWindow.start)} - ${formatClockDisplay(laserWindow.end)}` : r.startTime}`
    : (r.lanes || []).length ? `Piste${r.lanes.length > 1 ? 's' : ''} : ${r.lanes.join(', ')}` : 'Hors piste';
  const statusMeta = {
    pending: { label: 'Confirmé', cls: 'conf' },
    arrived: { label: 'Arrivé', cls: 'arr' },
    paid: { label: 'Payé', cls: 'paid' }
  }[r.status] || { label: 'Confirmé', cls: 'conf' };
  const opsPlanHtml = r.opsPlan?.timeline?.length ? `
    <div class="info-block">
      <div class="info-label">Plan automatique</div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${r.opsPlan.timeline.filter(step => step.type === 'activity').map(step => `
          <div style="display:flex;justify-content:space-between;gap:12px;font-size:13px;padding:8px 0;border-bottom:1px solid var(--border);">
            <span style="font-weight:700;color:var(--text);">${step.label}</span>
            <span style="color:var(--text-2);font-weight:700;">${step.startTime} - ${step.endTime}</span>
          </div>
        `).join('')}
      </div>
      ${r.opsPlan.staffSummary ? `<div style="margin-top:10px;color:var(--text-3);font-size:12px;line-height:1.45;">${r.opsPlan.staffSummary}</div>` : ''}
    </div>
  ` : '';
  return `<div class="fade-in">
    <div class="info-block">
      <div class="info-label">${getReservationLabel(r)}</div>
      <div class="info-grid">
        <div class="info-row"><div class="lbl">Horaire</div><div class="val">${r.startTime} <small>(${r.duration}H)</small></div></div>
        <div class="info-row"><div class="lbl">Participants</div><div class="val">${r.pax} <small>Joueurs</small></div></div>
        <div class="info-row" style="grid-column:1/-1;padding-top:14px;border-top:1px solid var(--border);"><div class="lbl">Emplacement</div><div class="val">${lanesTxt}</div></div>
      </div>
    </div>
    ${opsPlanHtml}
    ${renderOpsPlanInsightBlock(r)}
    <div class="info-block">
      <div class="info-label">Suivi rapide</div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;">
        <span class="status-pill ${statusMeta.cls}"><span class="dot"></span>${statusMeta.label}</span>
        <div class="res-status-row">
          <button class="res-status-btn pending ${r.status === 'pending' ? 'active pending' : ''}" onclick="setReservationStatusDirect(${r.id}, 'pending')">Confirmé</button>
          <button class="res-status-btn arrived ${r.status === 'arrived' ? 'active arrived' : ''}" onclick="setReservationStatusDirect(${r.id}, 'arrived')">Arrivé</button>
          <button class="res-status-btn paid ${r.status === 'paid' ? 'active paid' : ''}" onclick="setReservationStatusDirect(${r.id}, 'paid')">Payé</button>
        </div>
      </div>
    </div>
    <div class="info-block delay-control-block">
      <div class="info-label">Retard client</div>
      <div class="delay-control-copy">Le moteur calcule l'impact sur les réservations suivantes et propose la meilleure option (autre piste, ou décalage minimal). Rien ne bouge sans votre validation, et les clients ne sont prévenus que si vous le demandez.</div>
      <div class="delay-control-actions">
        <button type="button" class="delay-chip" onclick="openDelayImpact(${r.id}, 5, event)">+5 min</button>
        <button type="button" class="delay-chip" onclick="openDelayImpact(${r.id}, 10, event)">+10 min</button>
        <button type="button" class="delay-chip" onclick="openDelayImpact(${r.id}, 15, event)">+15 min</button>
        ${getLateArrivalMinutes(r) > 0 ? `<button type="button" class="delay-chip delay-chip-now" onclick="openDelayImpact(${r.id}, ${getLateArrivalMinutes(r)}, event)">Arrivé maintenant (+${getLateArrivalMinutes(r)} min)</button>` : ''}
      </div>
      <div class="delay-custom-row">
        <input type="number" id="delayCustomMinutes" min="1" max="240" placeholder="Minutes" inputmode="numeric" onclick="event.stopPropagation()">
        <button type="button" class="delay-chip" onclick="openDelayImpactCustom(${r.id}, event)">Analyser ce retard</button>
      </div>
    </div>
    <div class="info-block">
      <div class="info-label">Contact client</div>
      <div style="display:flex;align-items:center;gap:10px;font-size:14px;margin-bottom:10px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg><span style="font-weight:600;">${r.phone || 'Non renseigné'}</span></div>
      <div style="display:flex;align-items:center;gap:10px;font-size:14px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg><span style="font-weight:600;">${r.email || 'Non renseigné'}</span></div>
    </div>
    <div class="info-block">
      <div class="info-label">Résumé</div>
      <div class="info-grid">
        <div class="info-row"><div class="lbl">Montant</div><div class="val">${r.price}€</div></div>
        <div class="info-row"><div class="lbl">Paiement</div><div class="val">${r.paymentMethod || (r.status === 'paid' ? 'Comptoir' : 'Sur place')}</div></div>
      </div>
    </div>
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
    centerId: reservation.centerId || state.currentCenterId || 'libramont',
    delayMinutes: minutes,
    impact: null,
    selectedStrategyId: '',
    notifyChecked: {},
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
    candidates.forEach(candidate => { delayFlowState.notifyChecked[Number(candidate.reservationId)] = true; });
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
        channels: ['email']
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
      <div class="delay-section-title">Prévenir les clients ?</div>
      <div class="delay-notify-intro">Un email courtois part uniquement aux clients cochés, quand vous cliquez sur « Envoyer les emails ». Rien n'est envoyé automatiquement.</div>
      <div class="delay-notify-list">
        ${candidates.map(candidate => `
          <label class="delay-notify-row">
            <input type="checkbox" ${flow.notifyChecked[Number(candidate.reservationId)] ? 'checked' : ''} onchange="toggleDelayNotifyClient(${Number(candidate.reservationId)})">
            <span class="delay-notify-body">
              <span class="delay-notify-name">${escapeHtml(candidate.name)}</span>
              <span class="delay-notify-summary">${escapeHtml(candidate.summary || '')}</span>
              <span class="delay-notify-email">${escapeHtml(candidate.email)}</span>
            </span>
          </label>
        `).join('')}
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

function renderPosCaisse(r) {
  const extras = r.extras || [];
  const basePrice = r.basePrice || getBasePriceForReservation(r);
  const total = r.price;
  return `<div class="fade-in">
    <div class="receipt">
      <div class="receipt-head">
        <div class="title">FUN GALAXY</div>
        <div style="color:var(--text-3);font-size:11px;margin-top:4px;">Ticket #${String(r.id).slice(-5)}</div>
      </div>
      <div>
        <div class="receipt-line"><span style="font-weight:700;flex:1;">${getReservationLabel(r)}</span><span style="font-weight:700;">${basePrice}€</span></div>
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

function renderPosEdit(r) {
  const e = state.editState;
  return `<div class="edit-shell fade-in">
    <div class="edit-summary">
      <div class="edit-summary-card">
        <div class="info-label" style="margin-bottom:6px;">Réservation en cours</div>
        <h4 id="editSummaryName">${e.name}</h4>
        <p id="editSummaryMeta">${getReservationLabel(r)} • ${e.startTime || '--:--'} • ${e.lanesStr ? `pistes ${e.lanesStr}` : 'hors piste'}</p>
      </div>
      <div class="edit-summary-stat">
        <span class="k">Joueurs</span>
        <span class="v" id="editSummaryPax">${e.pax || 0}</span>
      </div>
      <div class="edit-summary-stat">
        <span class="k">Durée</span>
        <span class="v" id="editSummaryDuration">${formatDurationLabel(e.duration || 0)}</span>
      </div>
    </div>
    <form class="edit-form" onsubmit="saveEdit(event)">
      <div class="edit-layout">
        <div class="edit-stack">
          <div class="info-block soft compact">
            <div class="field-stack">
              <div>
                <label class="lbl">Client</label>
                <input class="input" value="${e.name}" oninput="setEditField('name', this.value)" required>
              </div>
              <div>
                <label class="lbl">Téléphone</label>
                <input class="input" value="${e.phone}" oninput="setEditField('phone', this.value)" required>
              </div>
            </div>
          </div>
          <div class="info-block soft compact">
            <label class="lbl">Statut</label>
            <select class="input" oninput="setEditField('status', this.value)">
              <option value="pending" ${e.status === 'pending' ? 'selected' : ''}>Confirmé</option>
              <option value="arrived" ${e.status === 'arrived' ? 'selected' : ''}>Arrivé</option>
              <option value="paid" ${e.status === 'paid' ? 'selected' : ''}>Payé</option>
            </select>
          </div>
        </div>
        <div class="edit-stack">
          <div class="info-block soft compact">
            <div class="edit-grid-2">
              <div>
                <label class="lbl">Joueurs</label>
                <input class="input" type="number" min="1" value="${e.pax}" oninput="setEditField('pax', this.value, true)" required>
              </div>
              <div>
                <label class="lbl">Durée (h)</label>
                <input class="input" type="number" step="0.5" min="0.5" value="${e.duration}" oninput="setEditField('duration', this.value, true)" required>
              </div>
              <div>
                <label class="lbl">Heure</label>
                <input class="input" type="time" value="${e.startTime}" oninput="setEditField('startTime', this.value, true)" required>
              </div>
              <div>
                <label class="lbl">Pistes</label>
                <input id="editLanesInput" class="input" value="${e.lanesStr}" oninput="setEditLanes(this.value)" placeholder="Ex: 1,2">
              </div>
            </div>
          </div>
          <div class="info-block soft compact">
            <div class="edit-inline-note">
              <span class="n">Type</span>
              <span class="v">${getReservationLabel(r)}</span>
            </div>
            <div class="edit-inline-note" style="margin-top:10px;">
              <span class="n">Affectation</span>
              <span class="v" id="editAssignmentValue">${e.lanesStr ? `${e.lanesStr}` : 'Hors piste'}</span>
            </div>
          </div>
        </div>
      </div>
      <div class="edit-actions">
        <button type="button" class="btn-secondary" onclick="closePos()">Fermer</button>
        <button type="button" class="btn-secondary warn" onclick="cancelRes(${r.id})">Annuler réservation</button>
        <button type="button" class="btn-secondary danger" onclick="deleteRes(${r.id})">Supprimer</button>
        <button type="submit" class="btn-primary">Enregistrer
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
        </button>
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
// — affiché en rappel, jamais redemandé — et la modale ne pose que les
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

function createQuickBookState(prefill = {}) {
  return {
    name: prefill.name || '',
    phone: prefill.phone ? normalizePhoneInput(prefill.phone) : '+32 ',
    email: prefill.email || '',
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
  // — la modale ne redemande que le client, les joueurs et la durée.
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
// ne s'applique que si le groupe déborde (N > 1 et sélection incomplète) — les
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
  // — d'où le fameux « il faut cliquer deux fois ». On reflète juste la valeur
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
    return { eyebrow: 'Planning bowling', title: `Réserver ${laneText}${s.startTime ? ` · ${s.startTime}` : ''}`, sub: 'Créneau repris du planning — il ne reste que le client à compléter.' };
  }
  if (src === 'laser-session') {
    return { eyebrow: 'Laser Game', title: `Rejoindre le lancement${s.startTime ? ` · ${s.startTime}` : ''}`, sub: 'Le groupe complète une session existante — départ verrouillé.' };
  }
  if (src === 'laser-slot' || (src === 'activite' && s.type === 'laser')) {
    return { eyebrow: 'Laser Game', title: `Nouvelle session laser${quickFieldKnown('startTime') && s.startTime ? ` · ${s.startTime}` : ''}`, sub: 'Session laser depuis le planning des lancements.' };
  }
  if (src === 'groupe' || (src === 'activite' && s.type === 'formule')) {
    return { eyebrow: 'Groupes & anniversaires', title: 'Réservation groupe · anniversaire', sub: 'Choisissez la formule, le reste suit.' };
  }
  if (src === 'client') {
    return { eyebrow: 'Fiche client', title: `Réserver pour ${s.name || 'ce client'}`, sub: 'Coordonnées reprises de la fiche — choisissez le créneau.' };
  }
  if (src === 'activite') {
    return { eyebrow: 'Staff Booking', title: s.type === 'laser' ? 'Nouvelle session laser' : 'Nouvelle partie bowling', sub: 'Créée depuis la page en cours, sur la date affichée.' };
  }
  return { eyebrow: 'Staff Booking', title: 'Réservation rapide', sub: 'L’essentiel d’abord — le détail vit dans « Plus d’options ».' };
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
      <input class="qb-input" type="number" min="1" max="120" value="${quickBookState.pax}" oninput="setQuickPax(this.value)">
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
    statusParts.push(quickBookState.autoAssign ? `Attribution auto${suggestedLanes.length ? ` — pistes ${suggestedLanes.join(' · ')}` : ''}` : `Pistes ${quickBookState.lanes.join(' · ') || 'à choisir'}${manualLanesShort ? ` (${quickBookState.lanes.length}/${requiredCount})` : ''}`);
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
      <div class="blk-label">Créneaux et disponibilité</div>
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
      <div class="blk-label">Durée et pistes</div>
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
      <div class="blk-label">Client — détail</div>
      <div>
        <label class="qb-mini-label">Email</label>
        <input class="qb-input" type="email" value="${quickBookState.email}" oninput="quickBookState.email=this.value" placeholder="client@email.com">
      </div>
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
          <div class="sub">${header.sub}</div>
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
              <input class="qb-input" value="${quickBookState.name}" oninput="quickBookState.name=this.value" placeholder="Marie Dupont">
            </div>
            <div>
              <label class="qb-mini-label">Téléphone</label>
              <input class="qb-input" value="${quickBookState.phone}" onfocus="onQuickPhoneFocus()" oninput="onQuickPhoneInput(this.value)" onblur="onQuickPhoneBlur(this)" placeholder="+32 470 00 00 00">
            </div>
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
          ${quickBookState.moreOpen ? 'Masquer les options avancées' : 'Plus d’options — créneaux, pistes, durée, email'}
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
  // asynchrone (syncDateReservations/POST) — un 2e clic pendant l'envoi est ignoré.
  if (!quickBookState || quickBookState.submitting) return;
  quickBookState.submitting = true;
  quickBookState.error = '';
  const saveBtn = document.querySelector('#quickBookOverlay .qb-btn-save');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.setAttribute('aria-busy', 'true');
    saveBtn.textContent = 'Création…';
  }
  const name = quickBookState.name.trim();
  const phone = normalizePhoneInput(quickBookState.phone);
  quickBookState.phone = phone;
  const failQuickBook = (message) => {
    // Ré-active le bouton (le re-render reconstruit « Créer la réservation »).
    quickBookState.submitting = false;
    quickBookState.error = message;
    renderQuickBook();
    toast(message);
  };
  if (!name || !phone) { failQuickBook('Nom et téléphone requis.'); return; }
  if (!quickBookState.startTime) { failQuickBook('Choisissez une heure.'); return; }
  const formule = quickBookState.type === 'formule' ? FORMULES.find(x => x.id === quickBookState.formuleId) : null;
  if (quickBookState.type === 'formule' && !formule) { failQuickBook('Sélectionnez une formule.'); return; }

  // Pas d'aller-retour réseau superflu sur le chemin de création : le poll
  // (4 s) garde la date courante fraîche. On ne re-synchronise ici que si la
  // donnée locale est vieille (> 10 s) — le serveur re-valide de toute façon.
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
    email: quickBookState.email.trim(),
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
  el.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> ${msg}`;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2500);
}

document.addEventListener('input', e => {
  if (e.target.id === 'searchInput') {
    state.searchTerm = e.target.value;
    renderTable();
  }
});

function getFormuleAvailability(formule, dateStr, pax, startTime = '') {
  const day = parseLocalDate(dateStr).getDay();
  const schedule = getSchedule(dateStr, state.isHolidayMode);
  const totalDuration = getFormuleTotalDuration(formule);
  if (!isOfferEnabled(formule.id)) return { ok: false, message: 'Offre momentanément indisponible' };
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
  const processed = FORMULES.filter(f => isOfferEnabled(f.id)).map(f => {
    const availability = getFormuleAvailability(f, state.booking.date, pax);
    const validDay = !f.validDays || f.validDays.includes(day);
    let status = '';
    let cls = 'ok';
    if (!validDay) { status = formatDays(f.validDays); cls = 'warn'; }
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
  // (exception été) — on l'affiche explicitement pour lever l'ambiguïté.
  const dateContext = getSpecialOpeningContext(state.booking.date, state.isHolidayMode);
  const summerOpen = dateContext.active && dateContext.periodType === 'school_summer' && !blockedToday;

  grid.innerHTML = families.map(group => {
    const sharedNotes = (group.items[0].notes || []).filter(note =>
      group.items.length > 1 && group.items.every(item => (item.notes || []).includes(note)));
    const groupBlocked = blockedToday && group.items.length > 1 && group.items.every(item => item.noHolidays);
    const groupSummerOpen = summerOpen && group.items.length > 1 && group.items.every(item => item.noHolidays);
    return `
    <section class="formule-group">
      <header class="formule-group-head">
        <h3>${group.name}</h3>
        ${sharedNotes.length ? `<p class="formule-group-notes">${sharedNotes.join(' · ')}</p>` : ''}
        ${groupSummerOpen ? '<p class="formule-group-info">Exception grandes vacances : ces formules sont bien disponibles à la date choisie.</p>' : ''}
      </header>
      ${groupBlocked ? `<div class="formule-group-alert" role="status">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <span>Ces formules ne sont pas disponibles à la date choisie (vacances scolaires ou jour férié). Choisissez une autre date pour les réserver.</span>
      </div>` : ''}
      <div class="formule-cards">
        ${group.items.map(f => {
          // Notes propres à la carte, en version compacte (la phrase longue
          // « Non valable durant... » reste réservée à l'en-tête de famille).
          const uniqueNotes = (f.notes || [])
            .filter(note => !sharedNotes.includes(note))
            .map(note => note.replace(/^Non valable durant les vacances scolaires et jours fériés$/i, 'Hors vacances scolaires et fériés'));
          const meta = [...new Set([
            ...uniqueNotes,
            f.timeLimit ? formatTime(f.timeLimit) : ''
          ].filter(Boolean))];
          // Le motif « vacances/férié » est déjà annoncé une seule fois au
          // niveau de la famille : pas de redite par carte.
          const cardStatus = groupBlocked && f.noHolidays ? '' : f.status;
          return `
        <button type="button" class="formule-card ${f.available ? '' : 'disabled'} ${state.booking.formuleId === f.id ? 'active' : ''}" ${f.available ? `onclick="selectFormule('${f.id}')"` : 'disabled aria-disabled="true"'}>
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
          ${cardStatus ? `<span class="formule-card-status ${f.cls}">${cardStatus}</span>` : ''}
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

function renderPos() {
  if (!state.selectedRes) return;
  const r = state.selectedRes;
  const overlay = document.getElementById('posOverlay');
  const isEdit = state.activeTab === 'modifier';
  const title = isEdit ? 'Modifier la réservation' : r.name;
  const subtitle = isEdit
    ? 'Un seul pop-up centré pour corriger le client, l’horaire, les pistes ou le statut.'
    : `${getReservationLabel(r)} • ${r.startTime} • ${r.pax} joueur${r.pax > 1 ? 's' : ''}`;
  const bodyHtml = isEdit ? renderPosEdit(r) : renderPosDetails(r);
  overlay.classList.remove('hidden');
  overlay.classList.add('centered');
  overlay.innerHTML = `
    <div class="edit-modal">
      <div class="edit-modal-head">
        <div>
          <h3>${title}</h3>
          <p>${subtitle}</p>
          <div class="modal-tabs">
            <button class="tab ${state.activeTab === 'details' ? 'active' : ''}" onclick="setTab('details')">Infos</button>
            <button class="tab ${state.activeTab === 'modifier' ? 'active' : ''}" onclick="setTab('modifier')">Modifier</button>
          </div>
        </div>
        <button class="close-btn" onclick="closePos()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="edit-modal-body">${bodyHtml}</div>
    </div>
  `;
}

// Recupere la config publique du centre (horaires staff, vacances/feries,
// offres activees) et la pousse dans booking-core pour que l'affichage client
// (hint "Ouvert...", formules) reflete la meme verite que le serveur.
// Fail-soft : sans reponse, la grille locale historique reste utilisee.
async function loadCenterScheduleConfig() {
  try {
    const payload = await apiRequest(`${API_ENDPOINTS.publicBookingMeta || '/api/public-booking-meta'}?centerId=${encodeURIComponent(getCurrentStaffCenterId ? getCurrentStaffCenterId() : 'libramont')}`, { method: 'GET' });
    if (payload?.center && typeof setCenterScheduleConfig === 'function') {
      setCenterScheduleConfig(payload.center);
      if (state.view === 'client') {
        updateSchedHint();
        renderFormules();
      }
    }
  } catch (error) {
    // Grille locale conservee.
  }
}

async function bootstrapApp() {
  isAuthenticated = hasSavedAuth();
  applyInitialRouteFromHash();
  initClient();
  loadCenterScheduleConfig();
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
    const allowedPages = ['dashboard', 'planning', 'reservations', 'sessions', 'arrivals', 'events', 'clients', 'groups', 'contacts', 'lanes', 'prices', 'laserGame', 'emails', 'campaigns', 'establishment', 'users', 'settings'];
    if (allowedPages.includes(normalizedPage)) state.staffMenuPage = normalizedPage;
    if (['all', 'bowling', 'laser'].includes(resource || normalizedPage)) state.staffResourceView = resource || normalizedPage;
  }
  if (view === 'admin') {
    const adminPageAliases = { period: 'overview' };
    const normalizedAdminTab = adminPageAliases[page] || page;
    const allowedAdminTabs = ['overview', 'reservations', 'clients', 'ops', 'exports'];
    if (allowedAdminTabs.includes(normalizedAdminTab)) state.adminTab = normalizedAdminTab;
  }
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

setInterval(() => {
  if (state.view === 'staff') {
    renderPlanning();
    renderLaserPlanning();
  }
}, 60000);

// Échap ferme le mode plein écran du planning (bowling ou laser).
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
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

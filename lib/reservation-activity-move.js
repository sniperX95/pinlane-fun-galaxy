const { getCenter, getFormula } = require('./ops-knowledge');
const { formuleDuDossier } = require('./formula-choice');
const { getSchedule, LASER_GAME_ARENA_MINUTES } = require('./booking-config');

function reject(message, statusCode = 422) { const error = new Error(message); error.statusCode = statusCode; error.expose = true; throw error; }
function minute(value) { const match = /^(\d{2}):(\d{2})$/.exec(String(value)); return match && Number(match[1]) < 48 && Number(match[2]) < 60 ? Number(match[1]) * 60 + Number(match[2]) : NaN; }
function clock(value) { return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`; }
function edge(block, name) { if (block[`${name}Time`]) return minute(block[`${name}Time`]); const value = Number(block[name]); return Number.isFinite(value) ? Math.round(value <= 48 ? value * 60 : value) : NaN; }
function start(block) { return edge(block, 'start'); }
function end(block) { return edge(block, 'end'); }
function key(block) { return `${Number(block.countIndex || 1)}.${Number(block.groupWaveIndex || 1)}`; }
function timed(block, target) { const minutes = end(block) - start(block); if (!(minutes > 0)) reject('La durée enregistrée de cette activité est invalide.'); return { ...block, start: target, end: target + minutes, startTime: clock(target), endTime: clock(target + minutes), durationMinutes: minutes }; }

// Older dossiers are drawn from their saved anchors when no resource plan was
// persisted. Materialize that same placement before moving a single activity;
// never invoke the planner, which could silently move the other activities.
function materializeLegacyPlacement(current, center) {
  const old = current.opsPlan || {};
  const savedBlocks = Array.isArray(old.resourceBlocks) ? old.resourceBlocks : [];
  const legacyLaser = !savedBlocks.some(block => block.resourceType === 'laser_arena') && !old.laserManual;
  const blocks = savedBlocks.map(block => legacyLaser && block.resourceType === 'bowling_lane' && !Number.isInteger(block.requiredLanes) && block.lanes?.length ? {...block,requiredLanes:block.lanes.length} : block);
  const items = Array.isArray(current.program) ? current.program : current.program?.items || [];
  const participants = activityId => Math.min(Number(current.pax), Number(items.find(item => item.activityId === activityId)?.participants) || Number(current.pax));
  if (!blocks.some(block => block.resourceType === 'bowling_lane') && current.lanes?.length) {
    const at = minute(current.startTime), duration = Math.round(Number(current.duration) * 60);
    if (!Number.isFinite(at) || !(duration > 0)) reject('L’heure ou la durée du Bowling enregistrée est invalide.');
    blocks.push({ type:'activity', activityId:'bowling', label:'Bowling', resourceType:'bowling_lane', start:at, end:at+duration, startTime:clock(at), endTime:clock(at+duration), durationMinutes:duration, lanes:current.lanes.slice(), players:participants('bowling'), requiredLanes:current.lanes.length });
  }
  if (!blocks.some(block => block.resourceType === 'laser_arena') && !old.laserManual) {
    const item = items.find(item => item.activityId === 'laser_game');
    const formulaGames = current.formuleId ? (formuleDuDossier(getFormula(current.formuleId), current)?.steps || []).filter(step => step.activityId === 'laser_game').reduce((sum,step) => sum+Number(step.count || 1),0) : 0;
    const programGames = Math.max(Number(item?.games) || 0, Number(item?.extraLaser?.games) || 0);
    const mixed = current.type === 'formule' || current.formuleId || programGames > 0;
    const games = mixed ? item?.extraLaser ? Number(item.games) || 1 : programGames || formulaGames : current.type === 'laser' ? 1 : 0;
    if (games > 0) {
      const bowling = blocks.filter(block => block.resourceType === 'bowling_lane');
      const preferred = current.preference?.preferredLaserTime || old.laserPassPlan?.scheduledPasses?.[0]?.startTime;
      let cursor = preferred ? minute(preferred) : mixed && bowling.length ? Math.max(...bowling.map(end))+5 : minute(current.startTime);
      if (!Number.isFinite(cursor)) reject('L’heure Laser enregistrée est invalide.');
      cursor = Math.ceil(cursor / 30) * 30;
      const players = participants('laser_game'), capacity = Number(center.resources?.laser?.weaponCount || 30), waves = Math.ceil(players / capacity);
      if (!Number.isInteger(players) || players <= 0 || !Number.isInteger(games) || games > 100 || !(waves > 0)) reject('Le contenu Laser enregistré est invalide.');
      for (let game=1;game<=games;game++) for (let wave=1;wave<=waves;wave++) {
        const scheduled = old.laserPassPlan?.scheduledPasses;
        if (!item?.extraLaser || !Array.isArray(scheduled) || scheduled.some(pass => Number(pass.countIndex) === game)) blocks.push({ type:'activity',activityId:'laser_game',label:'Laser Game',resourceType:'laser_arena',countIndex:game,groupWaveIndex:wave,groupWaveCount:waves,players:Math.floor(players/waves)+(wave<=players%waves?1:0),groupPlayers:players,start:cursor,end:cursor+LASER_GAME_ARENA_MINUTES,startTime:clock(cursor),endTime:clock(cursor+LASER_GAME_ARENA_MINUTES),durationMinutes:LASER_GAME_ARENA_MINUTES,formulaFallback:Boolean(mixed),critical:true });
        cursor += 30;
      }
    }
  }
  const legacyLaserGames = current.type === 'laser' && !items.length ? Number(current.laserGames || current.games || (Number(current.duration) >= 1.25 ? 3 : Number(current.duration) >= 0.75 ? 2 : 1)) : 0;
  return { ...old,resourceBlocks:blocks,timeline:Array.isArray(old.timeline)?old.timeline.slice():[], ...(legacyLaserGames && !old.laserPassPlan ? {laserPassPlan:{totalGames:legacyLaserGames}} : {}) };
}

function buildActivityMove(current, move) {
  if (!move || typeof move !== 'object' || Array.isArray(move)) reject('Déplacement d’activité invalide.');
  const activity = move.activityId;
  const allowed = activity === 'bowling' ? ['activityId', 'startTime', 'lanes', 'laneMapping', 'sourceLanes'] : ['activityId', 'startTime', 'unitKey', 'unplace'];
  if (!['bowling', 'laser_game'].includes(activity) || Object.keys(move).some(field => !allowed.includes(field))) reject('Choix de déplacement invalide.');
  if (current.status === 'cancelled') reject('Cette réservation est annulée.');
  const center = getCenter(current.centerId || 'libramont');
  if (center.status && center.status !== 'active') reject('Ce centre n’est pas ouvert.');
  let old = materializeLegacyPlacement(current, center);
  if (!old?.resourceBlocks?.length && current.type === 'bowling' && !current.program && activity === 'bowling') {
    const at = minute(current.startTime);
    old = { resourceBlocks: [{ type: 'activity', activityId: 'bowling', resourceType: 'bowling_lane', start: at, end: at + Math.round(current.duration * 60), lanes: current.lanes, players: current.pax }], timeline: [] };
  }
  if (!old?.resourceBlocks?.length && !old?.laserManual && current.type === 'laser' && !current.program && activity === 'laser_game') {
    const at = minute(current.startTime);
    const players = Number(current.pax);
    const waves = Math.ceil(players / Number(center.resources?.laser?.weaponCount || 30));
    old = { ...old, laserPassPlan: { totalGames: Number(current.laserGames || current.games || (current.duration >= 1.25 ? 3 : current.duration >= 0.75 ? 2 : 1)) }, resourceBlocks: Array.from({ length: waves }, (_, index) => ({ type: 'activity', activityId: 'laser_game', resourceType: 'laser_arena', countIndex: 1, groupWaveIndex: index + 1, groupWaveCount: waves, start: at + index * 30, end: at + index * 30 + LASER_GAME_ARENA_MINUTES, startTime: clock(at + index * 30), endTime: clock(at + index * 30 + LASER_GAME_ARENA_MINUTES), players: Math.floor(players / waves) + (index < players % waves ? 1 : 0), groupPlayers: players })), timeline: [] };
  }
  if (!Array.isArray(old?.resourceBlocks) || (!old.resourceBlocks.length && !(old.laserManual && activity === 'laser_game'))) reject('Le placement de ce dossier doit être actualisé avant de déplacer une activité.');
  const resource = activity === 'bowling' ? 'bowling_lane' : 'laser_arena';
  const removing = move.unplace === true;
  if (move.unplace != null && move.unplace !== true) reject('Retrait invalide.');
  if (removing && move.startTime != null) reject('Choisissez déplacer ou retirer cette partie.');
  const target = removing ? null : minute(move.startTime);
  if (!removing && (!Number.isFinite(target) || (activity === 'bowling' && target % 30))) reject('Choisissez une heure valide, pleine ou demie pour le Bowling.');
  let selected = old.resourceBlocks.filter(block => block.resourceType === resource);
  let mapping;
  let replacement;
  let sourceLanes;
  let partialBowling = false;
  const movedBowling = [];
  if (activity === 'bowling') {
    if (!selected.length) reject('Ce dossier ne contient pas de bowling placé.');
    const oldLanes = [...new Set(selected.flatMap(block => block.lanes || []))].sort((a, b) => a - b);
    sourceLanes = move.sourceLanes == null ? oldLanes : move.sourceLanes;
    if (!Array.isArray(sourceLanes) || !sourceLanes.length || new Set(sourceLanes).size !== sourceLanes.length || sourceLanes.some(lane => !Number.isInteger(lane) || !oldLanes.includes(lane))) reject('Choisissez au moins une piste actuellement attribuée à ce dossier.');
    sourceLanes = sourceLanes.slice().sort((a,b) => a-b);
    partialBowling = sourceLanes.length < oldLanes.length;
    const lanes = move.lanes;
    if (!Array.isArray(lanes) || !lanes.length || lanes.length !== sourceLanes.length || new Set(lanes).size !== lanes.length || lanes.some(lane => !Number.isInteger(lane) || lane < 1 || lane > Number(center.resources?.bowling?.laneCount || 0))) reject('Choisissez autant de pistes de destination que de pistes à déplacer.');
    const wanted = lanes.slice().sort((a, b) => a - b);
    mapping = new Map(sourceLanes.map((lane, index) => [lane, wanted[index]]));
    if (move.laneMapping != null) {
      if (!move.laneMapping || typeof move.laneMapping !== 'object' || Array.isArray(move.laneMapping)
        || Object.keys(move.laneMapping).some(lane => String(Number(lane)) !== lane)
        || JSON.stringify(Object.keys(move.laneMapping).map(Number).sort((a,b)=>a-b)) !== JSON.stringify(sourceLanes)
        || JSON.stringify(Object.values(move.laneMapping).sort((a,b)=>a-b)) !== JSON.stringify(wanted)) reject('Correspondance des pistes invalide.');
      mapping = new Map(sourceLanes.map(lane => [lane, move.laneMapping[lane]]));
    }
    const delta = target - Math.min(...selected.filter(block => (block.lanes || []).some(lane => sourceLanes.includes(lane))).map(start));
    replacement = block => ({ ...timed(block, start(block) + delta), ...(block.resourceType === resource ? { lanes: (block.lanes || []).map(lane => mapping.get(lane)), requiredLanes: (block.lanes || []).length, ...(selected.length > 1 ? { groupWaveCount: selected.length, groupWaveIndex: selected.findIndex(item => start(item) === start(block) && JSON.stringify(item.lanes) === JSON.stringify(block.lanes)) + 1 } : {}) } : {}) });
    if (partialBowling) replacement = block => {
      // A lane carries its share of the saved service, never the whole group.
      // Stable source ordering also preserves odd counts across later moves.
      const blockLanes = (block.lanes || []).slice().sort((a,b) => a-b);
      if (!blockLanes.length) reject('Actualisez le placement des pistes avant de déplacer une partie du groupe.');
      const picked = blockLanes.filter(lane => sourceLanes.includes(lane));
      if (!picked.length) return [block];
      const kept = blockLanes.filter(lane => !sourceLanes.includes(lane));
      const players = Number(block.players ?? current.program?.items?.find(item => item.activityId === 'bowling')?.participants ?? current.pax);
      if (!Number.isInteger(players) || players < blockLanes.length) reject('Le nombre de joueurs par piste doit être précisé avant de séparer ce placement.');
      const share = lanes => lanes.reduce((sum,lane) => sum + Math.floor(players / blockLanes.length) + (blockLanes.indexOf(lane) < players % blockLanes.length ? 1 : 0),0);
      const moved = { ...timed(block,start(block)+delta), lanes:picked.map(lane => mapping.get(lane)), requiredLanes:picked.length, players:share(picked), lanePlacementSplit:true };
      return [...(kept.length ? [{...block,lanes:kept,requiredLanes:kept.length,players:share(kept),lanePlacementSplit:true}] : []),moved];
    };
  } else {
    if (!/^[1-9]\d*\.[1-9]\d*$/.test(String(move.unitKey))) reject('Partie ou vague laser invalide.');
    const [game, wave] = move.unitKey.split('.').map(Number);
    const item = current.program?.items?.find(item => item.activityId === 'laser_game');
    const formulaGames = current.formuleId ? (formuleDuDossier(getFormula(current.formuleId), current)?.steps || []).filter(step => step.activityId === 'laser_game').reduce((sum, step) => sum + Number(step.count || 1), 0) : 0;
    const games = Number(item?.extraLaser?.games || item?.games || old.laserPassPlan?.totalGames || current.laserGames || current.games || formulaGames || 1);
    const players = Number(item?.extraLaser && game > Number(item.games) ? item.extraLaser.participants : item?.participants ?? current.pax);
    const capacity = Number(center.resources?.laser?.weaponCount || 30);
    const waves = Math.ceil(players / capacity);
    if (!(game >= 1 && game <= games && wave >= 1 && wave <= waves && players > 0)) reject('Cette partie ou cette vague ne fait pas partie du dossier.');
    selected = selected.filter(block => key(block) === move.unitKey);
    if (selected.length > 1) reject('Cette vague laser est enregistrée plusieurs fois. Actualisez le dossier.');
    const joueursVague = Math.floor(players / waves) + (wave <= players % waves ? 1 : 0);
    // L ARENE POUR VOUS SEULS (2026-10-08) suit la partie qu on pose : elle
    // retient toute l arene (players = armes), le groupe reste dans joueursReels.
    const seuls = old.arene === 'seuls' ? { players: capacity, joueursReels: joueursVague, arene: 'seuls' } : { players: joueursVague };
    const template = selected[0] || { type: 'activity', activityId: 'laser_game', label: 'Laser Game', resourceType: resource, countIndex: game, groupWaveIndex: wave, groupWaveCount: waves, ...seuls, groupPlayers: players, start: 0, end: LASER_GAME_ARENA_MINUTES, startTime: '00:00', endTime: clock(LASER_GAME_ARENA_MINUTES), critical: true };
    if (removing && !selected.length) reject('Cette vague est déjà à placer.');
    replacement = block => ({ ...timed(block || template, target), manualLaserPass: true });
  }
  const isTarget = block => block.resourceType === resource && (activity === 'bowling' || key(block) === move.unitKey);
  let blocks = old.resourceBlocks.flatMap(block => {
    if (!isTarget(block)) return [block];
    if (removing) return [];
    if (!partialBowling) return [replacement(block)];
    const pieces = replacement(block);
    if ((block.lanes || []).some(lane => sourceLanes.includes(lane))) movedBowling.push(pieces.at(-1));
    return pieces;
  });
  if (activity === 'laser_game' && !selected.length && !removing) blocks.push(replacement());
  const moved = partialBowling ? movedBowling : blocks.filter(isTarget);
  if (partialBowling) {
    const bowlingBlocks = blocks.filter(block => block.resourceType === resource);
    for (let i=0;i<bowlingBlocks.length;i++) for (let j=i+1;j<bowlingBlocks.length;j++) {
      const a=bowlingBlocks[i],b=bowlingBlocks[j];
      if (start(a)<end(b) && start(b)<end(a) && a.lanes.some(lane => b.lanes.includes(lane))) reject('Une piste de destination est encore utilisée par une partie de ce dossier.');
    }
    blocks = blocks.map(block => block.resourceType === resource ? {...block,requiredLanes:block.lanes.length,groupWaveCount:bowlingBlocks.length,groupWaveIndex:bowlingBlocks.indexOf(block)+1} : block);
  }
  const schedule = getSchedule(current.date, center);
  if (!removing && (!schedule || moved.some(block => start(block) < schedule.open * 60 || end(block) > schedule.close * 60))) reject('Cette activité ne tient pas dans les horaires d’ouverture.');
  const formula = current.formuleId ? getFormula(current.formuleId) : null;
  if (!removing && formula?.timeLimit) {
    const min = formula.timeLimit.min == null ? -Infinity : minute(formula.timeLimit.min);
    const max = formula.timeLimit.max == null ? Infinity : minute(formula.timeLimit.max);
    if (moved.some(block => start(block) < min || end(block) > max)) reject(`Cette activité doit respecter les horaires de la formule${formula.timeLimit.min ? `, dès ${formula.timeLimit.min}` : ''}${formula.timeLimit.max ? ` et finir avant ${formula.timeLimit.max}` : ''}. Les autres horaires restent inchangés.`);
  }
  let timeline = Array.isArray(old.timeline) ? old.timeline.flatMap(block => (block.resourceType === resource || block.activityId === activity) && (activity === 'bowling' || key(block) === move.unitKey) ? removing ? [] : partialBowling ? replacement(block) : [replacement(block)] : [block]) : [];
  if (partialBowling) {
    const bowlingSteps = timeline.filter(block => block.resourceType === resource || block.activityId === activity);
    timeline = timeline.map(block => bowlingSteps.includes(block) ? {...block,requiredLanes:block.lanes.length,groupWaveCount:bowlingSteps.length,groupWaveIndex:bowlingSteps.indexOf(block)+1} : block);
  }
  if (activity === 'laser_game' && !removing && !timeline.some(block => (block.resourceType === resource || block.activityId === activity) && key(block) === move.unitKey)) timeline.push(...moved);
  // Les estimations libres ne sont pas des réservations à heure imposée.
  // Compter chaque groupe une fois, y compris quand le même bloc figure dans la timeline.
  const anchored = [...blocks, ...timeline].filter(block => block.resourceType !== 'party_table'
    && (['bowling', 'laser_game'].includes(block.activityId) || ['bowling_lane', 'laser_arena'].includes(block.resourceType) || block.critical === true || block.scheduled === true || block.planned === true));
  const unique = [...new Map(anchored.map(block => [JSON.stringify([block.activityId, start(block), end(block), Number(block.countIndex || 1), Number(block.groupWaveIndex || 1),block.resourceType === 'bowling_lane' ? [...(block.lanes || [])].sort((a,b)=>a-b) : null]), block])).values()];
  for (const movedBlock of moved) {
    const moments = [...new Set([start(movedBlock), ...unique.map(start)])].filter(at => at >= start(movedBlock) && at < end(movedBlock));
    for (const at of moments) {
      const concurrent = unique.filter(block => start(block) <= at && end(block) > at);
      // Les joueurs du GROUPE (joueursReels), pas la place retenue : une arene
      // privatisee porte players = armes et chevaucherait le groupe lui-meme.
      const demand = concurrent.reduce((sum, block) => sum + Number((block.joueursReels ?? block.players) || current.program?.items?.find(item => item.activityId === block.activityId)?.participants || current.pax), 0);
      if (demand > Number(current.pax)) {
        const other = concurrent.find(block => !isTarget(block)) || concurrent[0];
        const name = other.resourceType === 'laser_arena' ? 'le Laser Game' : other.resourceType === 'bowling_lane' ? 'le Bowling' : other.label || current.program?.items?.find(item => item.activityId === other.activityId)?.name || 'une autre activité';
        reject(`Ce déplacement chevauche ${name} à ${clock(start(other))}. Cet horaire reste inchangé.`);
      }
    }
  }
  const times = [...blocks, ...timeline].filter(block => Number.isFinite(start(block)) && Number.isFinite(end(block)));
  const first = Math.min(...times.map(start)); const last = Math.max(...times.map(end));
  const bowling = blocks.filter(block => block.resourceType === 'bowling_lane');
  const laser = blocks.filter(block => block.resourceType === 'laser_arena');
  const plan = { ...old, resourceBlocks: blocks, timeline, ...(times.length ? { startTime: clock(first), endTime: clock(last), totalMinutes: last - first } : {}), firstBowlingTime: bowling.length ? clock(Math.min(...bowling.map(start))) : '', firstLaserTime: laser.length ? clock(Math.min(...laser.map(start))) : '' };
  if (activity === 'bowling') plan.assignedLanes = [...new Set(bowling.flatMap(block => block.lanes || []))].sort((a, b) => a - b);
  if (old.anchorPlan?.times) plan.anchorPlan = { ...old.anchorPlan, times: { ...old.anchorPlan.times, [activity]: activity === 'bowling' ? plan.firstBowlingTime : plan.firstLaserTime } };
  if (activity === 'laser_game') {
    plan.laserManual = true;
    const items = Array.isArray(current.program) ? current.program : current.program?.items || [];
    const item = items.find(item => item.activityId === activity);
    const totalGames = Number(item?.extraLaser?.games || item?.games || old.laserPassPlan?.totalGames || current.laserGames || current.games || (current.formuleId ? (formuleDuDossier(getFormula(current.formuleId), current)?.steps || []).filter(step => step.activityId === activity).reduce((sum, step) => sum + Number(step.count || 1), 0) : 0) || 1);
    const scheduledKeys = new Set(laser.map(key));
    const units = Array.from({ length: totalGames }, (_, index) => index + 1).flatMap(countIndex => {
      const players = Number(item?.extraLaser && countIndex > Number(item.games) ? item.extraLaser.participants : item?.participants ?? current.pax);
      const waves = Math.ceil(players / Number(center.resources?.laser?.weaponCount || 30));
      return Array.from({ length: waves }, (_, index) => ({ countIndex, groupWaveIndex: index + 1, groupWaveCount: waves, unitKey: `${countIndex}.${index + 1}`, pax: Math.floor(players / waves) + (index < players % waves ? 1 : 0) }));
    });
    const pending = units.filter(unit => !scheduledKeys.has(unit.unitKey));
    const missingGames = [...new Set(pending.map(unit => unit.countIndex))];
    const scheduled = [...new Set(laser.map(block => Number(block.countIndex || 1)))];
    plan.laserPassPlan = { ...old.laserPassPlan, mode: 'manual_after_first', totalGames, scheduledGames: totalGames - missingGames.length, remainingGames: missingGames.length, scheduledUnits: units.filter(unit => scheduledKeys.has(unit.unitKey)), pendingUnits: pending, scheduledPasses: scheduled.map(countIndex => ({ countIndex, status: 'scheduled', complete: !missingGames.includes(countIndex), startTime: clock(Math.min(...laser.filter(block => Number(block.countIndex || 1) === countIndex).map(start))) })), pendingPasses: missingGames.map(countIndex => ({ countIndex, status: 'pending', pax: pending.filter(unit => unit.countIndex === countIndex).reduce((sum, unit) => sum + unit.pax, 0) })) };
  }
  return { ...current, opsPlan: plan, ...(bowling.length ? { laneCount: Math.max(...bowling.map(block => (block.lanes || []).length)), requiresLanes: true } : {}), ...(activity === 'bowling' ? { lanes: plan.assignedLanes } : {}) };
}

module.exports = { buildActivityMove };

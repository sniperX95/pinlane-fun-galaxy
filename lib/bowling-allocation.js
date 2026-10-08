'use strict';

function allocateBowlingCapacity({ players, config, requiredLanes, allocate, durationMinutes = 60, fixedLanes = null, games = 1 }) {
  const normal = Math.max(1, Number(config.normalCapacityPerLane) || 6);
  const emergency = Math.max(normal, Number(config.emergencyCapacityPerLane) || normal);
  const normalLanesNeeded = Math.ceil(players / normal);
  let lanes = allocate(Math.max(normalLanesNeeded, Number(requiredLanes) || 0));
  if (!lanes && emergency > normal) lanes = allocate(Math.ceil(players / emergency));
  if (!lanes || !lanes.length || players > lanes.length * emergency) return null;
  if (fixedLanes) {
    if (fixedLanes.length < lanes.length || players > fixedLanes.length * emergency) return null;
    lanes = fixedLanes;
  }
  const base = Math.floor(players / lanes.length);
  const extra = players % lanes.length;
  const lanePlayers = lanes.map((_, i) => base + (i >= lanes.length - extra ? 1 : 0));
  const maxPlayers = Math.max(...lanePlayers);
  const exceptional = maxPlayers > normal;
  const contractedGames = Math.max(1, Math.trunc(Number(games) || 1));
  const estimatedMinutes = maxPlayers * 10 * contractedGames;
  const speedWarning = exceptional && durationMinutes < estimatedMinutes;
  const bowlingCapacity = { emergency: exceptional, normalCapacityPerLane: normal, emergencyCapacityPerLane: emergency,
    normalLanesNeeded, lanePlayers, estimatedMinutes, speedWarning };
  const emergencyWarning = exceptional
    ? `${lanePlayers.join(' + ')} joueurs sur ${lanes.length} piste${lanes.length > 1 ? 's' : ''} : capacité exceptionnelle de ${emergency} joueurs par piste. Comptez environ ${estimatedMinutes} min par piste${contractedGames > 1 ? ` pour ${contractedGames} parties` : ''} à 10 min par joueur et par partie.${speedWarning ? ` Avec ${durationMinutes} min, jouez plus vite ; ${contractedGames > 1 ? `les ${contractedGames} parties complètes ne sont pas garanties` : 'une partie complète n’est pas garantie'}.` : ''}`
    : '';
  return { lanes, requiredLanes: lanes.length, bowlingCapacity, emergencyWarning };
}

// `auPalier` : le prix d une duree hors grille (2 h 30) au palier puis a
// l unite, comme a la normalisation du programme. Le comptoir seul le passe :
// sans lui, la ligne repartait a 0 EUR au moment de compter les pistes.
function bowlingPlanQuote(program, plan, { centerId, dateStr, bowlingConfig, auPalier = false } = {}) {
  const blocks = (plan?.resourceBlocks || []).filter((b) => b.resourceType === 'bowling_lane' && Array.isArray(b.lanes) && b.lanes.length);
  if (!blocks.length) return { program, bowlingCapacity: null, emergencyWarning: '' };
  const laneCount = Math.max(...blocks.map((b) => b.lanes.length));
  const billedLaneCount = blocks.reduce((sum, b) => sum + b.lanes.length, 0);
  const bowlingCapacity = blocks[0].bowlingCapacity || null;
  const emergencyWarning = [...new Set(blocks.map((b) => b.emergencyWarning).filter(Boolean))].join(' ');
  if (!program) return { bowlingCapacity, emergencyWarning, billedLaneCount, laneCount };
  const items = program.items.map((it) => it.activityId !== 'bowling' ? it : {
    ...it, laneCount, billedLaneCount, bowlingCapacity, emergencyWarning,
    price: require('./booking-config').getBowlingGameOptions(bowlingConfig, dateStr, { pax: it.participants || program.pax, laneCount: billedLaneCount }) !== null
      ? it.price
      : require('./booking-config').getBasePrice('bowling', it.duration, billedLaneCount, it.participants || program.pax, '', centerId, { bowlingConfig, dateStr, auPalier: auPalier === true }),
  });
  return { bowlingCapacity, emergencyWarning, billedLaneCount, laneCount,
    program: { ...program, items, plannedItems: items.filter((it) => it.planned), freeItems: items.filter((it) => !it.planned),
      price: Math.round(items.reduce((sum, it) => sum + (it.priceKnown ? Number(it.price) || 0 : 0), 0) * 100) / 100 }, };
}

module.exports = { allocateBowlingCapacity, bowlingPlanQuote };

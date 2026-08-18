// SERIE QUOTIDIENNE DU DASHBOARD STAFF : agregation pure d'une plage de
// reservations en un point par jour (CA prevu, encaisse, dossiers, joueurs,
// heures de piste). Fonction pure et testee : c'est elle qui remplace la
// lecture du cache local du poste, dont les jours jamais visites valaient 0
// (« des fois ca montre des fois non », capture Movsar 2026-08-18).
'use strict';

function isoAddDays(dateStr, delta) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

// reservations : lignes mapReservation (date, status, price, pax, duration,
// lanes). startDate/endDate inclus. Rend un point PAR jour de la plage, zeros
// compris : une journee sans vente est une valeur, pas un trou.
function buildStaffDaySeries(reservations = [], startDate, endDate) {
  const days = new Map();
  for (let cursor = startDate; cursor <= endDate; cursor = isoAddDays(cursor, 1)) {
    days.set(cursor, { date: cursor, revenue: 0, collected: 0, reservations: 0, players: 0, laneHours: 0 });
  }
  (Array.isArray(reservations) ? reservations : []).forEach((reservation) => {
    if (!reservation || reservation.status === 'cancelled' || reservation.status === 'rejected') return;
    const bucket = days.get(reservation.date);
    if (!bucket) return;
    const price = Number(reservation.price) || 0;
    bucket.reservations += 1;
    bucket.revenue += price;
    bucket.players += Number(reservation.pax) || 0;
    if (reservation.status === 'paid') bucket.collected += price;
    // Approximation assumee de la charge piste : duree x pistes assignees.
    // Sert la tendance d'occupation du dashboard, jamais une facture.
    const lanes = Array.isArray(reservation.lanes) ? reservation.lanes.length : 0;
    if (lanes > 0) bucket.laneHours += (Number(reservation.duration) || 0) * lanes;
  });
  return [...days.values()];
}

module.exports = { buildStaffDaySeries, isoAddDays };

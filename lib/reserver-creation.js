'use strict';
// LA CREATION D UNE RESERVATION PAR L EQUIPE (2026-11-11). Sortie telle quelle d api/staff-reservations.js
// pour servir aussi la reservation en un clic d une demande sur mesure (lib/demande-bureau-centre.js,
// reserverLaDemande) : le meme chemin, les memes droits (exigerLesDroits), le meme journal d audit et la
// meme confirmation au client (afterReservationCreated l envoie dans la requete).
const { createReservation } = require('./database');
const { afterReservationCreated } = require('./reservation-ops');
const { writeAuditLog, actorFromSession, newRequestId } = require('./audit-log');
const { reservationChanges } = require('./registre');
const { exigerLesDroits } = require('./reserver-fenetre');

async function creerDepuisLaFenetre(prepare, session, contexte = {}, { surface = 'api/staff-reservations.js' } = {}) {
  const { ops, conflits, aPlacer } = prepare;
  exigerLesDroits(prepare);
  const reservation = await createReservation(prepare.dossier);
  const [postCreate, annonce] = await Promise.all([
    afterReservationCreated(reservation, prepare.request),
    require('./garde-annonces').annoncerReservation(reservation, { par: actorFromSession(session).actorLabel }),
  ]);
  const auditCreate = await writeAuditLog({
    centerId: reservation.centerId || 'libramont',
    ...actorFromSession(session),
    surface,
    action: 'createReservation',
    method: 'POST',
    entityType: 'reservation',
    entityId: reservation.id,
    outcome: 'success',
    changes: reservationChanges({}, reservation),
    context: {
      canal: reservation.channel || 'staff',
      validationStatus: reservation.validationStatus || '',
      ...(aPlacer ? { aPlacer: true, conflits: conflits.map((conflit) => conflit.message) } : {}),
      ...contexte,
      annonce,
    },
    requestId: newRequestId(),
  });
  return {
    reservation,
    ops: {
      riskLevel: reservation.riskLevel,
      riskScore: reservation.riskScore,
      validationStatus: reservation.validationStatus,
      planWarning: ops.planWarning,
      autoDecision: ops.requiresHumanReview || aPlacer ? 'human_review_required' : 'auto_confirmed',
    },
    communications: postCreate.communications,
    warnings: auditCreate.warning
      ? [...(postCreate.warnings || []), auditCreate.warning]
      : postCreate.warnings,
    aPlacer,
    conflits,
  };
}

module.exports = { creerDepuisLaFenetre };

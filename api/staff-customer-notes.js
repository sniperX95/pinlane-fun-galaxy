const { getCustomerNote, getCustomerNotes, saveCustomerNote, listCustomerNoteVersions } = require('../lib/customer-notes');
const { requireStaffPermission } = require('../lib/staff-auth');
const { readJson, sendJson, sendError, publicErrorMessage } = require('../lib/http');
const { writeAuditLog, actorFromSession, newRequestId } = require('../lib/audit-log');

module.exports = async function handler(req, res) {
  try {
    if (!['GET', 'PATCH'].includes(req.method)) return sendError(res, 405, 'Méthode non autorisée.');
    const url = new URL(req.url, 'https://app.pinlane.be');
    const body = req.method === 'PATCH' ? await readJson(req) : {};
    const centerId = String(body.centerId || url.searchParams.get('centerId') || '').trim();
    const reservationId = body.reservationId || url.searchParams.get('reservationId');
    if (!centerId || centerId === 'all') return sendError(res, 422, 'Centre requis.');
    const session = await requireStaffPermission(req, res, req.method === 'GET' ? 'reservations.view' : 'clients.edit', { centerId });
    if (!session) return;
    const address = { centerId, reservationId };
    if (req.method === 'GET') {
      // L HISTORIQUE (registre, migration 0053) : chaque version enregistree
      // de la note de ce client, texte complet, la plus recente d abord.
      if (url.searchParams.get('versions') === '1') {
        const versions = await listCustomerNoteVersions({ centerId, reservationId, limit: Number(url.searchParams.get('limit') || 50) });
        return sendJson(res, 200, { ok: true, ...versions });
      }
      const ids = url.searchParams.get('reservationIds');
      const result = ids !== null ? await getCustomerNotes({ centerId, reservationIds: ids.split(',') }) : await getCustomerNote(address);
      return sendJson(res, 200, { ok: true, ...result });
    }
    const unexpected = Object.keys(body).filter((key) => !['centerId', 'reservationId', 'clientKey', 'baseUpdatedAt', 'body'].includes(key));
    if (unexpected.length) return sendError(res, 422, 'Champ non autorisé.');
    const saved = await saveCustomerNote({ ...address, clientKey: body.clientKey, baseUpdatedAt: body.baseUpdatedAt, body: body.body, updatedBy: session.member?.name || '' });
    // Le texte complet de chaque version vit dans client_note_versions (ecrit
    // dans la transaction de l enregistrement, jamais tronque). Le journal
    // d audit garde l acte, les longueurs avant/apres et le pointeur vers la
    // version ecrite : les deux ensemble disent qui a change quoi, et quoi
    // exactement.
    const { versionId, previousVersion, ...reponse } = saved;
    const audit = await writeAuditLog({
      centerId, ...actorFromSession(session), surface: 'api/staff-customer-notes.js', action: 'saveCustomerNote', method: 'PATCH', entityType: 'reservation', entityId: reservationId, outcome: 'success',
      changes: { note: { before: { longueur: previousVersion === null ? 0 : String(previousVersion).length, existait: previousVersion !== null }, after: { longueur: saved.note.body.length, versionId } } },
      context: { noteLength: saved.note.body.length, versionId, scope: 'customer' },
      requestId: newRequestId(),
    });
    return sendJson(res, 200, { ok: true, ...reponse, versionId, ...(audit.warning ? { warnings: [audit.warning] } : {}) });
  } catch (error) {
    return sendError(res, error.statusCode || 500, publicErrorMessage(error, req.method === 'GET' ? 'Impossible de charger la note client.' : 'Impossible de sauvegarder la note client.'), error.statusCode === 409 && Object.prototype.hasOwnProperty.call(error, 'note') ? { note: error.note } : {});
  }
};

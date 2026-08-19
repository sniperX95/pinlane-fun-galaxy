const { getOpsHealth, readAdminRangeState } = require('../lib/database');
const { sendError, sendJson } = require('../lib/http');
const { requireStaffPermission, sessionHasPermission } = require('../lib/staff-auth');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    sendError(res, 405, 'Méthode non autorisée.');
    return;
  }

  try {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    const requestUrl = new URL(req.url, 'http://localhost');
    const startDate = requestUrl.searchParams.get('startDate');
    const endDate = requestUrl.searchParams.get('endDate') || startDate;
    const centerId = requestUrl.searchParams.get('centerId') || 'libramont';
    // QUI A LE DROIT DE LIRE UN MOIS DE RESERVATIONS (corrige 2026-08-19).
    // Cet endpoint rend les MEMES donnees que /api/staff-state (reservations
    // de la periode + statuts de pistes), sur une plage au lieu d un jour.
    // Exiger 'direction.view' pour la plage refusait la page Reservations a un
    // Manager qui, lui, peut ouvrir chaque jour un par un : la restriction ne
    // protegeait rien, elle cassait juste le calendrier (bandeau « API
    // indisponible », et des compteurs qui n apparaissaient qu apres avoir
    // clique chaque jour, verdict de Movsar sur capture). Le droit de lire des
    // reservations suffit donc ; 'direction.view' garde ce qui lui appartient
    // vraiment, les indicateurs de supervision (voir opsHealth plus bas).
    // 'clients.view' entre dans la liste (2026-08-19, trouve par le gate
    // permissions-matrix) : une FICHE CLIENT est un agregat de ses visites,
    // donc la page Clients lit cette meme plage. Sans elle, un role qui voit
    // les clients partait chercher leur historique et prenait un refus.
    const session = await requireStaffPermission(req, res, ['direction.view', 'reservations.view', 'clients.view'], { centerId });
    if (!session) return;
    if (!startDate || !endDate) {
      sendError(res, 400, 'Periode manquante.');
      return;
    }
    const snapshot = await readAdminRangeState(startDate, endDate, centerId);
    // Les indicateurs de supervision restent a la Direction : ce qui s ouvre
    // au Manager, ce sont les reservations, pas la sante interne du systeme.
    const canSeeOps = sessionHasPermission(session, 'direction.view');
    let opsHealth = null;
    try {
      opsHealth = canSeeOps ? await getOpsHealth({ centerId, limit: 40 }) : null;
    } catch (opsError) {
      console.error('[admin-range] ops health indisponible', opsError && (opsError.stack || opsError.message || opsError));
      opsHealth = {
        unavailable: true,
        error: 'Indicateurs ops momentanément indisponibles.',
        generatedAt: new Date().toISOString(),
      };
    }
    const requestRevision = req.headers['if-none-match'];
    if (requestRevision && requestRevision === snapshot.revision) {
      res.statusCode = 304;
      res.setHeader('ETag', snapshot.revision);
      res.end();
      return;
    }
    res.setHeader('ETag', snapshot.revision);
    sendJson(res, 200, { ok: true, ...snapshot, opsHealth });
  } catch (error) {
    // Jamais de message technique brut à l'écran (ex : "tuple concurrently
    // updated"). Détail en logs, message propre côté client.
    console.error('[admin-range] échec', error && (error.stack || error.message || error));
    sendError(res, 503, 'Données direction momentanément indisponibles. Réessayez dans un instant.');
  }
};

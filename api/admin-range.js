const { getOpsHealth, readAdminRangeState } = require('../lib/database');
const { sendError, sendJson } = require('../lib/http');
const { requireStaffPermission } = require('../lib/staff-auth');

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
    const session = await requireStaffPermission(req, res, 'direction.view', { centerId });
    if (!session) return;
    if (!startDate || !endDate) {
      sendError(res, 400, 'Periode manquante.');
      return;
    }
    const snapshot = await readAdminRangeState(startDate, endDate, centerId);
    let opsHealth = null;
    try {
      opsHealth = await getOpsHealth({ centerId, limit: 40 });
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

const { getPool, readStaffState } = require('../lib/database');
const { sendError, sendJson } = require('../lib/http');
const { refreshCenterOverrides, getCenter } = require('../lib/ops-knowledge');
const { normalizeClassification } = require('../lib/center-config');
const { isStaffAuthStorageError, requireStaffPermission } = require('../lib/staff-auth');

function buildOfflineStaffState(date, centerId, error) {
  return {
    ok: true,
    degraded: true,
    storageUnavailable: true,
    storageMessage: 'Données temps réel temporairement indisponibles. Mode secours actif.',
    storageError: error?.message || 'Base indisponible.',
    date,
    centerId,
    reservations: [],
    laneStatuses: [],
    revision: `degraded:${centerId}:${date}`,
    syncedAt: new Date().toISOString(),
  };
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    sendError(res, 405, 'Méthode non autorisée.');
    return;
  }

  try {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    const requestUrl = new URL(req.url, 'http://localhost');
    const date = requestUrl.searchParams.get('date');
    const centerId = requestUrl.searchParams.get('centerId') || 'libramont';
    const session = await requireStaffPermission(req, res, ['planning.view', 'dashboard.view', 'reservations.view'], { centerId });
    if (!session) return;
    if (!date) {
      sendError(res, 400, 'Date manquante.');
      return;
    }
    // Reflète les éditions de config centre (cache ~30s, fail-soft) avant de
    // lire l'état : le moteur (getCenter) doit voir la config à jour.
    try {
      await refreshCenterOverrides(getPool());
    } catch (error) {
      // Fallback silencieux sur la baseline fichier.
    }
    const snapshot = await readStaffState(date, centerId);
    const requestRevision = req.headers['if-none-match'];
    if (requestRevision && requestRevision === snapshot.revision) {
      res.statusCode = 304;
      res.setHeader('ETag', snapshot.revision);
      res.end();
      return;
    }
    res.setHeader('ETag', snapshot.revision);
    // Classification client/groupe du centre (seuils groupe + formules anniversaire),
    // servie à tout le staff via le poll qu'il fait déjà : pas de requête en plus.
    let classification;
    try { classification = normalizeClassification(getCenter(centerId)?.classification); } catch (error) { classification = undefined; }
    sendJson(res, 200, { ok: true, ...snapshot, classification });
  } catch (error) {
    if (isStaffAuthStorageError(error)) {
      const requestUrl = new URL(req.url, 'http://localhost');
      const date = requestUrl.searchParams.get('date');
      const centerId = requestUrl.searchParams.get('centerId') || 'libramont';
      if (date) {
        const snapshot = buildOfflineStaffState(date, centerId, error);
        res.setHeader('Cache-Control', 'no-store, max-age=0');
        res.setHeader('ETag', snapshot.revision);
        sendJson(res, 200, snapshot);
        return;
      }
    }
    sendError(res, 500, error.message || 'Impossible de charger les donnees staff.');
  }
};

const { getPool, readStaffState, readAdminRangeState } = require('../lib/database');
const { sendError, sendJson } = require('../lib/http');
const { refreshCenterOverrides, getCenter } = require('../lib/ops-knowledge');
const { normalizeClassification, normalizeAccueil } = require('../lib/center-config');
const { isStaffAuthStorageError, requireStaffPermission } = require('../lib/staff-auth');
const { buildStaffDaySeries } = require('../lib/staff-day-series');

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
    // SERIE QUOTIDIENNE AGREGEE (?days=N) : la carte Revenus du dashboard lit
    // la vraie plage cote serveur au lieu du cache local du poste, qui ne
    // connaissait que les dates deja visitees (jours a 0 par intermittence,
    // capture Movsar 2026-08-18). Chiffres seulement, aucun dossier :
    // l'agregat en dit MOINS que le detail par date deja servi ici.
    const daysParam = Number(requestUrl.searchParams.get('days')) || 0;
    if (daysParam > 0) {
      const span = Math.min(Math.max(Math.round(daysParam), 1), 31);
      const startDate = new Date(`${date}T00:00:00Z`);
      startDate.setUTCDate(startDate.getUTCDate() - (span - 1));
      const start = startDate.toISOString().slice(0, 10);
      const range = await readAdminRangeState(start, date, centerId);
      sendJson(res, 200, { ok: true, centerId, endDate: date, days: buildStaffDaySeries(range.reservations, start, date) });
      return;
    }
    // Reflète les éditions de config centre (cache ~30s, fail-soft) avant de
    // lire l'état : le moteur (getCenter) doit voir la config à jour.
    try {
      await refreshCenterOverrides(getPool());
    } catch (error) {
      // Fallback silencieux sur la baseline fichier.
    }
    // Les horaires retenus par des clients en train de reserver en ligne
    // (migration 0049) arrivent A PART (`holds`) : le planning les montre en
    // attente, ils ne se melangent ni aux listes ni aux chiffres du jour.
    const snapshot = await readStaffState(date, centerId, { blocagesAPart: true });
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
    // Le seuil de retard du centre (Etablissement > Regles), lu par toute
    // l equipe, comme la classification.
    let accueil;
    try { accueil = normalizeAccueil(getCenter(centerId)?.accueil); } catch (error) { accueil = undefined; }
    sendJson(res, 200, { ok: true, ...snapshot, classification, accueil });
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
    sendError(res, 500, require('../lib/http').publicErrorMessage(error, 'Impossible de charger les donnees staff.'));
  }
};

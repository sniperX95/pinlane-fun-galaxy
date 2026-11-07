(function () {
  function isExpired(expiresAt) {
    return Boolean(expiresAt && new Date(expiresAt).getTime() <= Date.now());
  }

  function normalize(rawSession, centerIdFallback) {
    if (!rawSession || typeof rawSession !== 'object') return null;
    const token = rawSession.token || '';
    const cookieBacked = Boolean(rawSession.cookieBacked || !token);
    if (!token && !cookieBacked) return null;
    const expiresAt = rawSession.expiresAt || '';
    if (isExpired(expiresAt)) return null;
    return {
      token,
      cookieBacked,
      centerId: rawSession.centerId || centerIdFallback || 'libramont',
      expiresAt,
      member: rawSession.member || null,
      role: rawSession.role || null,
      permissions: Array.isArray(rawSession.permissions) ? rawSession.permissions : [],
      // Les centres ou la personne entre (null : tous, proprietaire de la
      // plateforme ; absent : session d avant ce champ). Le menu des centres
      // ne propose rien d autre.
      centres: Array.isArray(rawSession.centres) ? rawSession.centres.slice() : (rawSession.centres === null ? null : undefined),
      centreDeConnexion: rawSession.centreDeConnexion || rawSession.centerId || centerIdFallback || 'libramont',
    };
  }

  function getToken(rawSession) {
    const session = normalize(rawSession);
    if (!session || session.cookieBacked) return '';
    return session.token || '';
  }

  window.PinlaneStaffAuthSession = {
    isExpired,
    normalize,
    getToken,
  };
})();

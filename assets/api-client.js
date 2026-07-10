(function () {
  const endpoints = Object.freeze({
    publicReservations: '/api/public-reservations',
    publicBookingMeta: '/api/public-booking-meta',
    staffReservations: '/api/staff-reservations',
    staffState: '/api/staff-state',
    publicAvailability: '/api/public-availability',
    staffLanes: '/api/staff-lanes',
    adminRange: '/api/admin-range',
    ops: '/api/ops',
    simulation: '/api/simulation',
    marketingAgents: '/api/marketing-agents',
    staffAuth: '/api/staff-auth',
  });

  const protectedEndpointKeys = [
    'staffAuth',
    'staffReservations',
    'staffState',
    'staffLanes',
    'adminRange',
    'ops',
    'simulation',
    'marketingAgents',
  ];

  function isProtectedStaffApi(url = '') {
    const value = String(url || '');
    return protectedEndpointKeys.some((key) => endpoints[key] && value.includes(endpoints[key]));
  }

  function staffAuthHeaders(headers = {}, token = '') {
    return token ? { ...headers, 'X-Staff-Session': token } : headers;
  }

  function resolveRequestUrl(url, origin) {
    if (typeof url === 'string' && url.startsWith('/')) {
      return `${origin || window.location.origin}${url}`;
    }
    return url;
  }

  // Message utilisateur propre selon le code HTTP. On NE montre JAMAIS un
  // message technique brut (erreur d'infrastructure Vercel, trace Postgres,
  // anglais…) : seul un message issu de NOTRE API (enveloppe { ok:false,
  // message }, rédigé en français) est affiché tel quel.
  function friendlyMessageForStatus(status, method = 'GET') {
    if (status === 401) return 'Session expirée. Reconnectez-vous pour continuer.';
    if (status === 403) return "Vous n'avez pas l'autorisation pour cette action.";
    // « déjà supprimé » n'a de sens que sur une vraie suppression (DELETE) —
    // un endpoint non résolu (GET/POST) reste un 404 neutre.
    if (status === 404) return method === 'DELETE' ? 'Élément introuvable ou déjà supprimé.' : 'Ressource introuvable.';
    if (status === 408 || status === 504) return 'Le serveur a mis trop de temps à répondre. Réessayez.';
    if (status === 429) return 'Service momentanément surchargé. Réessayez dans quelques instants.';
    if (status >= 500 || status === 0) return 'Service temporairement indisponible. Réessayez dans un instant.';
    return 'Une erreur est survenue. Réessayez.';
  }

  function isOurApiError(payload) {
    // Notre API renvoie toujours { ok:false, message:'…' } en cas d'erreur.
    // Les pages d'erreur plateforme (Vercel) n'ont pas cette forme.
    return Boolean(
      payload
        && typeof payload === 'object'
        && payload.ok === false
        && typeof payload.message === 'string'
        && payload.message.trim(),
    );
  }

  function buildError(userMessage, { status = 0, payload = null, url = '', technical = '' } = {}) {
    const error = new Error(userMessage);
    error.userFacing = true;
    error.status = status;
    error.payload = payload;
    error.url = url;
    error.technical = technical || userMessage;
    return error;
  }

  async function request(url, options = {}, config = {}) {
    const requestUrl = resolveRequestUrl(url, config.origin || window.location.origin);
    const baseHeaders = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };
    const token = typeof config.getSessionToken === 'function' ? config.getSessionToken() : '';
    const headers = isProtectedStaffApi(url) ? staffAuthHeaders(baseHeaders, token) : baseHeaders;

    let response;
    try {
      response = await fetch(requestUrl, {
        ...options,
        cache: 'no-store',
        credentials: 'same-origin',
        headers,
      });
    } catch (networkError) {
      // fetch rejette = hors-ligne, DNS, CORS, coupure réseau.
      console.warn('[api] réseau', requestUrl, networkError);
      throw buildError('Connexion au serveur impossible. Vérifiez votre connexion et réessayez.', {
        url: requestUrl,
        technical: networkError && networkError.message,
      });
    }

    const contentType = (response.headers && typeof response.headers.get === 'function'
      ? response.headers.get('content-type')
      : '') || '';
    // Pas de content-type JSON explicite → on tente quand même de parser (certains
    // runtimes/tests omettent l'en-tête) ; échec silencieux → payload null.
    const payload = contentType.includes('application/json') || !contentType
      ? await response.json().catch(() => null)
      : null;

    if (!response.ok || (payload && payload.ok === false)) {
      if (response.status === 401 && isProtectedStaffApi(url) && typeof config.onUnauthorized === 'function') {
        config.onUnauthorized();
      }
      // Message brut connu (utile en console pour debug, jamais affiché tel quel
      // sauf s'il provient de notre propre API).
      let rawDetail = payload && typeof payload === 'object'
        ? (payload.message || (payload.error && payload.error.message) || '')
        : '';
      if (!rawDetail && typeof response.clone === 'function' && typeof response.text === 'function') {
        rawDetail = (await response.clone().text().catch(() => '')).slice(0, 300);
      }
      if (rawDetail) console.warn('[api]', response.status, requestUrl, rawDetail);

      const userMessage = isOurApiError(payload)
        ? payload.message
        : friendlyMessageForStatus(response.status, String(options.method || 'GET').toUpperCase());
      throw buildError(userMessage, {
        status: response.status,
        payload,
        url: requestUrl,
        technical: rawDetail,
      });
    }
    return payload || {};
  }

  window.PinlaneApiClient = {
    endpoints,
    isProtectedStaffApi,
    staffAuthHeaders,
    request,
  };
})();

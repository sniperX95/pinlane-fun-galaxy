(function () {
  const endpoints = Object.freeze({
    publicReservations: '/api/public-reservations',
    publicBookingMeta: '/api/public-booking-meta',
    staffReservations: '/api/staff-reservations',
    staffCustomerNotes: '/api/staff-customer-notes',
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
    'staffCustomerNotes',
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
    // « déjà supprimé » n'a de sens que sur une vraie suppression (DELETE) : 
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

    // Corps lu UNE SEULE fois : texte d'abord, puis parse JSON best-effort.
    // Jamais de response.clone() après consommation du body : c'est un
    // TypeError brut (« Failed to execute 'clone'… ») garanti côté UI.
    // Fallback .json() : certains runtimes de test n'exposent que json().
    let rawBody = '';
    let payload = null;
    if (typeof response.text === 'function') {
      rawBody = await response.text().catch(() => '');
      if (rawBody) {
        try { payload = JSON.parse(rawBody); } catch (parseError) { payload = null; }
      }
    } else if (typeof response.json === 'function') {
      payload = await response.json().catch(() => null);
    }

    if (!response.ok || (payload && payload.ok === false)) {
      if (response.status === 401 && isProtectedStaffApi(url) && typeof config.onUnauthorized === 'function') {
        config.onUnauthorized();
      }
      // Message brut connu (utile en console pour debug, jamais affiché tel quel
      // sauf s'il provient de notre propre API).
      let rawDetail = payload && typeof payload === 'object'
        ? (payload.message || (payload.error && payload.error.message) || '')
        : '';
      if (!rawDetail && rawBody) rawDetail = rawBody.slice(0, 300);
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

  // Fetch every page before publishing the history to a cache or CSV export.
  // requestPage is the app's authenticated apiRequest (also accepts one-page mocks).
  async function collectAdminRange(url, requestPage) {
    const target = new URL(url, window.location.origin);
    const incomplete = () => buildError('Historique incomplet. Réessayez le chargement.', { url });
    if (target.searchParams.has('cursor')) throw incomplete();
    const scope = {
      startDate: target.searchParams.get('startDate'),
      endDate: target.searchParams.get('endDate') || target.searchParams.get('startDate'),
      centerId: target.searchParams.get('centerId') || 'libramont',
    };
    let pageUrl = url;
    let first = null;
    const reservations = [];
    const cursors = new Set();
    const ids = new Set();
    for (;;) {
      const page = await requestPage(pageUrl);
      if (!page || page.ok === false || !Array.isArray(page.reservations)) throw incomplete();
      for (const key of Object.keys(scope)) {
        if (page[key] !== undefined && page[key] !== scope[key]) throw incomplete();
      }
      // Legacy fixtures and small older servers expose no pagination metadata.
      if (!first && page.pagination === undefined) return page;
      const pagination = page.pagination;
      if (!pagination || typeof pagination.hasMore !== 'boolean') throw incomplete();
      if (!first) first = page;
      for (const row of page.reservations) {
        if (!row || row.id === undefined || ids.has(String(row.id))) throw incomplete();
        ids.add(String(row.id));
        reservations.push(row);
      }
      if (!pagination.hasMore) {
        if (pagination.nextCursor !== null) throw incomplete();
        break;
      }
      const cursor = pagination.nextCursor;
      if (typeof cursor !== 'string' || !cursor || !page.reservations.length || cursors.has(cursor)) throw incomplete();
      cursors.add(cursor);
      target.searchParams.set('cursor', cursor);
      pageUrl = target.pathname + target.search;
    }
    // The transport uses immutable ids. Restore the reader's business ordering.
    reservations.sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))
      || String(a.startTime || '').localeCompare(String(b.startTime || ''))
      || Number(a.id) - Number(b.id));
    return {
      ...first,
      reservations,
      // The first page's ETag cannot validate a combined history.
      revision: null,
      pagination: { ...first.pagination, hasMore: false, nextCursor: null },
    };
  }

  // The attempt belongs to a draft and the exact content sent. Retrying a
  // lost response keeps its identity; editing or starting a draft creates one.
  function withMessageAttempt(draft, payload, idField = 'attemptId') {
    const content = JSON.stringify(payload);
    if (!draft.directEmailAttempt || draft.directEmailAttempt.content !== content) {
      const id = typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
      draft.directEmailAttempt = { id, content };
    }
    return { ...payload, [idField]: draft.directEmailAttempt.id };
  }

  window.PinlaneApiClient = {
    endpoints,
    isProtectedStaffApi,
    staffAuthHeaders,
    request,
    collectAdminRange,
    withMessageAttempt,
  };
})();

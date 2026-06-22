(function () {
  const endpoints = Object.freeze({
    publicReservations: '/api/public-reservations',
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

  async function request(url, options = {}, config = {}) {
    const requestUrl = resolveRequestUrl(url, config.origin || window.location.origin);
    const baseHeaders = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };
    const token = typeof config.getSessionToken === 'function' ? config.getSessionToken() : '';
    const headers = isProtectedStaffApi(url) ? staffAuthHeaders(baseHeaders, token) : baseHeaders;
    const response = await fetch(requestUrl, {
      ...options,
      cache: 'no-store',
      credentials: 'same-origin',
      headers,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      if (response.status === 401 && isProtectedStaffApi(url) && typeof config.onUnauthorized === 'function') {
        config.onUnauthorized();
      }
      const error = new Error(payload.message || 'Erreur serveur.');
      error.payload = payload;
      error.status = response.status;
      error.url = requestUrl;
      throw error;
    }
    return payload;
  }

  window.PinlaneApiClient = {
    endpoints,
    isProtectedStaffApi,
    staffAuthHeaders,
    request,
  };
})();

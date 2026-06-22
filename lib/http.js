function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.end(JSON.stringify(payload));
}

function sendError(res, status, message, extra = {}) {
  sendJson(res, status, { ok: false, message, ...extra });
}

function getAllowedOrigin(requestOrigin) {
  const defaultAllowedOrigins = 'https://www.mngfunglxy.com,https://mngfunglxy.com';
  const raw = process.env.PUBLIC_FORM_ORIGIN || defaultAllowedOrigins;

  const allowedOrigins = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (!requestOrigin) {
    return allowedOrigins[0] || 'https://www.mngfunglxy.com';
  }

  if (allowedOrigins.includes(requestOrigin)) {
    return requestOrigin;
  }

  return allowedOrigins[0] || 'https://www.mngfunglxy.com';
}

function setCors(res, methods = 'GET,POST,OPTIONS') {
  const requestOrigin = res.req?.headers?.origin;
  res.setHeader('Access-Control-Allow-Origin', getAllowedOrigin(requestOrigin));
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Staff-Session, X-FGX-Session, X-Fun-Galaxy-Session');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Vary', 'Origin');
}

function getJsonBodyLimit() {
  const configured = Number(process.env.MAX_JSON_BODY_BYTES || 0);
  return Number.isFinite(configured) && configured > 0 ? configured : 1024 * 1024;
}

async function readJson(req, options = {}) {
  const maxBytes = Number(options.maxBytes || getJsonBodyLimit());
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    totalBytes += buffer.length;
    if (totalBytes > maxBytes) {
      const error = new Error('Payload JSON trop volumineux.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(buffer);
  }

  const body = Buffer.concat(chunks).toString('utf8');
  if (!body) return {};

  try {
    return JSON.parse(body);
  } catch (parseError) {
    const error = new Error('JSON invalide.');
    error.statusCode = 400;
    throw error;
  }
}

module.exports = {
  readJson,
  sendError,
  sendJson,
  setCors,
};

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
  // Les origines de la PLATEFORME et de son premier client. pinlane.be y entre
  // le 2026-07-28 : la vitrine y heberge le formulaire de demande de demo, qui
  // poste vers /api/pilot-lead de cette application. Sans cette entree, le
  // navigateur bloque l'envoi et le prospect est perdu sans message utile.
  // Le domaine du PRODUIT a sa place ici, pas dans PUBLIC_FORM_ORIGIN : cette
  // variable sert a ajouter des origines CLIENTES sans redeployer, et l'ecraser
  // sans connaitre son contenu couperait ce qui s'y trouve deja.
  const canonicalOrigins = [
    'https://www.mngfunglxy.com',
    'https://mngfunglxy.com',
    'https://fungalaxy.be',
    'https://www.fungalaxy.be',
    'https://pinlane.be',
    'https://www.pinlane.be',
    'https://app.pinlane.be',
  ];
  const raw = process.env.PUBLIC_FORM_ORIGIN || '';

  const configuredOrigins = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const allowedOrigins = Array.from(new Set([...configuredOrigins, ...canonicalOrigins]));

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
  __test: {
    getAllowedOrigin,
  },
  readJson,
  sendError,
  sendJson,
  setCors,
};

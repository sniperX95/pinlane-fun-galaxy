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
    // Le site vitrine de N4 Bowling (Marche-en-Famenne), deuxieme client, sur
    // son domaine Vercel. Son script de reservation interroge d'abord
    // /api/public-booking-meta pour verifier que le catalogue servi est bien
    // celui de SON centre : sans cette origine, ce controle prealable est
    // bloque par le navigateur et le site retombe sur le telephone.
    // A remplacer par le domaine definitif quand N4 en aura un : n4bowling.be
    // n'a aucun enregistrement DNS au 2026-08-20, et on n'autorise jamais une
    // origine que personne ne possede.
    'https://n4-bowling.vercel.app',
  ];
  const raw = process.env.PUBLIC_FORM_ORIGIN || '';

  const configuredOrigins = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const allowedOrigins = Array.from(new Set([...configuredOrigins, ...canonicalOrigins]));

  if (allowedOrigins.includes(requestOrigin)) {
    return requestOrigin;
  }

  // Chemin de refus (origine absente ou non listee) : la valeur rendue ne
  // debloque rien cote navigateur, mais elle est VISIBLE dans la reponse.
  // On y met le domaine de la PLATEFORME, jamais celui d'un client.
  return 'https://app.pinlane.be';
}

function setCors(res, methods = 'GET,POST,OPTIONS') {
  const requestOrigin = res.req?.headers?.origin;
  res.setHeader('Access-Control-Allow-Origin', getAllowedOrigin(requestOrigin));
  res.setHeader('Access-Control-Allow-Methods', methods);
  // Seul X-Staff-Session est envoye par le code actuel (assets/api-client.js).
  // Les anciens noms restent ACCEPTES cote lecture (lib/staff-auth.js) pour un
  // onglet au bundle perime, mais ils n'ont plus a etre annonces ici.
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Staff-Session');
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

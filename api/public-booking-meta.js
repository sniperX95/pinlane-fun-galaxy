const { DURATION_OPTIONS, FORMULES, todayStr } = require('../lib/booking-config');
const { getPool } = require('../lib/database');
const { readJson, sendError, sendJson, setCors } = require('../lib/http');
const { enforceRateLimit } = require('../lib/rate-limit');

// This function serves two public surfaces to stay under the Vercel Hobby
// 12-function limit:
//   GET  /api/public-booking-meta  -> booking catalog for the public forms
//   POST /api/pilot-lead           -> pilot lead capture (rewritten here in
//                                      vercel.json; keeps the clean URL for free)

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

async function handlePilotLead(req, res) {
  if (enforceRateLimit(req, res, { scope: 'pilot-lead', limit: 5, windowMs: 600_000 })) {
    return;
  }

  let body;
  try {
    body = await readJson(req);
  } catch (error) {
    sendError(res, error.statusCode || 400, error.message || 'Requête invalide.');
    return;
  }

  const centerName = clean(body.centre ?? body.centerName, 160);
  const contactName = clean(body.contact ?? body.contactName, 160);
  const email = clean(body.email, 200);
  const priority = clean(body.priority, 120);

  if (!contactName || !email) {
    sendError(res, 400, 'Contact et email sont obligatoires.');
    return;
  }

  if (!EMAIL_PATTERN.test(email)) {
    sendError(res, 400, 'Adresse email invalide.');
    return;
  }

  const userAgent = clean(req.headers?.['user-agent'], 400);

  try {
    const result = await getPool().query(
      `
        insert into pilot_leads (center_name, contact_name, email, priority, source, user_agent, payload)
        values ($1, $2, $3, $4, 'landing', $5, $6::jsonb)
        returning id, created_at;
      `,
      [
        centerName,
        contactName,
        email,
        priority,
        userAgent,
        JSON.stringify({ centerName, contactName, email, priority }),
      ],
    );
    sendJson(res, 201, { ok: true, id: result.rows[0]?.id ?? null });
  } catch (error) {
    sendError(res, 503, 'Demande non enregistrée, réessayez dans un instant.');
  }
}

module.exports = async (req, res) => {
  setCors(res, 'GET,POST,OPTIONS');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method === 'POST') {
    await handlePilotLead(req, res);
    return;
  }

  if (req.method !== 'GET') {
    sendError(res, 405, 'Méthode non autorisée.');
    return;
  }

  sendJson(res, 200, {
    ok: true,
    today: todayStr(),
    durationOptions: DURATION_OPTIONS,
    formules: FORMULES,
  });
};

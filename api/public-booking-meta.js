const { DURATION_OPTIONS, FORMULES, todayStr } = require('../lib/booking-config');
const { getPool, createCustomRequest } = require('../lib/database');
const { readJson, sendError, sendJson, setCors } = require('../lib/http');
const { enforceRateLimit } = require('../lib/rate-limit');
const { getCenter, refreshCenterOverrides } = require('../lib/ops-knowledge');
const { sendCustomRequestAck } = require('../lib/ops-communications');

// This function serves several public surfaces to stay under the Vercel Hobby
// 12-function limit:
//   GET  /api/public-booking-meta  -> booking catalog for the public forms
//   POST /api/pilot-lead           -> pilot lead capture (SaaS landing)
//   POST /api/custom-request       -> bespoke enquiry lead (companies / special
//                                      needs). Both POSTs are rewritten here in
//                                      vercel.json; discriminated by body.kind.

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CUSTOM_REQUEST_OCCASIONS = new Set(['anniversaire', 'amis', 'entreprise', 'ecole', 'autre']);

function clean(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

// LEAD sur mesure : enregistré hors planning (table custom_requests), jamais
// dans reservations. Renvoie 201 même si l'accusé email échoue (best-effort).
async function handleCustomRequest(req, res, body) {
  if (enforceRateLimit(req, res, { scope: 'custom-request', limit: 5, windowMs: 600_000 })) {
    return;
  }

  const contactName = clean(body.contactName ?? body.name, 160);
  const email = clean(body.email, 200);
  const phone = clean(body.phone, 60);
  const company = clean(body.company, 160);
  const requestedDate = clean(body.requestedDate ?? body.date, 120);
  const message = clean(body.message ?? body.notes, 2000);
  const occasionRaw = clean(body.occasion, 40).toLowerCase();
  const occasion = CUSTOM_REQUEST_OCCASIONS.has(occasionRaw) ? occasionRaw : '';
  const pax = Math.max(0, Math.trunc(Number(body.pax) || 0));
  const centerId = clean(body.centerId ?? body.center_id, 60) || 'libramont';

  if (!contactName || !email) {
    sendError(res, 400, 'Nom du contact et email sont obligatoires.');
    return;
  }
  if (!EMAIL_PATTERN.test(email)) {
    sendError(res, 400, 'Adresse email invalide.');
    return;
  }
  if (!message) {
    sendError(res, 400, 'Merci de décrire votre besoin.');
    return;
  }

  let lead;
  try {
    lead = await createCustomRequest({
      centerId,
      contactName,
      company,
      email,
      phone,
      requestedDate,
      pax,
      occasion,
      message,
      source: 'client',
      payload: { userAgent: clean(req.headers?.['user-agent'], 400) },
    });
  } catch (error) {
    sendError(res, 503, 'Demande non enregistrée, réessayez dans un instant.');
    return;
  }

  // Accusé de réception client (best-effort, tracé mais non bloquant).
  const ack = await sendCustomRequestAck({
    id: lead.id,
    email: lead.email,
    contactName: lead.contactName,
    company: lead.company,
    occasion: lead.occasion,
    requestedDate: lead.requestedDate,
    pax: lead.pax,
    message: lead.message,
  }).catch((error) => ({ skipped: true, reason: error.message || 'Envoi impossible.' }));

  sendJson(res, 201, {
    ok: true,
    id: lead.id,
    acknowledgementSent: Boolean(ack && ack.ok),
    acknowledgement: ack || null,
  });
}

async function handlePilotLead(req, res, body) {
  if (enforceRateLimit(req, res, { scope: 'pilot-lead', limit: 5, windowMs: 600_000 })) {
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
    let body;
    try {
      body = await readJson(req);
    } catch (error) {
      sendError(res, error.statusCode || 400, error.message || 'Requête invalide.');
      return;
    }
    const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
    const isCustomRequest = body?.kind === 'custom-request' || url.pathname.endsWith('/custom-request');
    if (isCustomRequest) {
      await handleCustomRequest(req, res, body || {});
      return;
    }
    await handlePilotLead(req, res, body || {});
    return;
  }

  if (req.method !== 'GET') {
    sendError(res, 405, 'Méthode non autorisée.');
    return;
  }

  // Config publique du centre (horaires staff, regime vacances/feries, offres
  // activees) pour que l'affichage client reflete la meme verite que le moteur.
  // Fail-soft : sans DB ou centre inconnu, le client retombe sur la grille locale.
  const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  const centerId = String(url.searchParams.get('centerId') || 'libramont');
  try {
    await refreshCenterOverrides(getPool());
  } catch (error) {
    // Baseline fichier conservee.
  }
  let center = null;
  try {
    center = getCenter(centerId) || null;
  } catch (error) {
    center = null;
  }

  sendJson(res, 200, {
    ok: true,
    today: todayStr(),
    durationOptions: DURATION_OPTIONS,
    formules: FORMULES,
    center: center
      ? {
        id: center.id,
        status: center.status || 'active',
        defaultSchedule: center.defaultSchedule && typeof center.defaultSchedule === 'object' ? center.defaultSchedule : null,
        holidaySettings: center.holidaySettings && typeof center.holidaySettings === 'object'
          ? center.holidaySettings
          : { enabled: true, overrides: [], formulaBlockedPeriods: ['public', 'school_short', 'manual'] },
        offerAvailability: center.offerAvailability && typeof center.offerAvailability === 'object' ? center.offerAvailability : {},
      }
      : null,
  });
};

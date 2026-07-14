// Webhook de réception d'emails — POST /api/inbound-email
// Alimente la boîte de réception de la page « Emails & relances » : chaque
// email entrant est stocké (communications direction='inbound') AVEC son
// analyse par l'agent (intention, résumé, réponse proposée).
//
// Auth : header `x-inbound-secret` === env INBOUND_EMAIL_SECRET (posée dans
// Vercel). Sans configuration, l'endpoint refuse tout (401) — la boîte de
// réception reste alimentable à la main via l'action ops `analyzeInboundEmail`.
//
// Compatible Resend Inbound (`type: 'email.received'`, données sous `data`)
// et POST générique { from, subject, text|body, receivedAt }.

const { readJson, sendError, sendJson } = require('../lib/http');
const { ingestInboundEmail } = require('../lib/email-agent');

// "Marie Dupont <marie@test.be>" → { email, name } ; adresse nue acceptée.
function parseAddress(raw = '') {
  const value = String(raw || '').trim();
  const match = value.match(/<([^>]+)>/);
  const email = (match ? match[1] : value).trim();
  const name = match ? value.slice(0, match.index).replace(/["']/g, '').trim() : '';
  return { email, name };
}

function createHandler({ ingest = ingestInboundEmail } = {}) {
  return async (req, res) => {
    if (req.method !== 'POST') {
      sendError(res, 405, 'Méthode non autorisée.');
      return;
    }
    const expected = process.env.INBOUND_EMAIL_SECRET;
    if (!expected || req.headers['x-inbound-secret'] !== expected) {
      sendError(res, 401, 'Webhook non autorisé.');
      return;
    }

    let body;
    try {
      body = await readJson(req);
    } catch (error) {
      sendError(res, 400, 'Corps JSON invalide.');
      return;
    }

    // Enveloppe Resend (email.received) ou payload plat.
    const data = body && body.type === 'email.received' && body.data && typeof body.data === 'object'
      ? body.data
      : (body || {});
    const fromRaw = data.from && typeof data.from === 'object'
      ? (data.from.email || data.from.address || '')
      : (data.from || '');
    const { email: from, name: fromName } = parseAddress(fromRaw);
    const subject = String(data.subject || '').trim();
    const text = String(data.text || data.body || '').trim();
    if (!from || !from.includes('@') || !text) {
      sendError(res, 400, 'Payload invalide : from et text requis.');
      return;
    }

    try {
      const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
      const centerId = String(url.searchParams.get('centerId') || 'libramont');
      const result = await ingest({
        centerId,
        from,
        fromName,
        subject,
        body: text,
        receivedAt: data.receivedAt || data.created_at || null,
      });
      sendJson(res, 200, {
        ok: true,
        id: result.communication?.id || null,
        deduped: Boolean(result.deduped),
      });
    } catch (error) {
      const status = error && error.expose === true ? 400 : 503;
      sendError(res, status, error && error.expose === true
        ? (error.message || 'Payload invalide.')
        : 'Réception impossible pour le moment.');
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;

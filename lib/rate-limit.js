// Lightweight sliding-window rate limiter for public endpoints.
//
// Storage is in-memory and therefore per-instance: on a multi-instance
// serverless deployment each lambda keeps its own window, so this raises the
// bar against naive floods but is not a global guarantee. A durable limiter
// (Upstash/Redis) is the production-grade follow-up; the interface below is
// kept small so it can be swapped without touching the handlers.

const buckets = globalThis.__pinlaneRateBuckets || new Map();
globalThis.__pinlaneRateBuckets = buckets;

// L ADRESSE QUE LA PLATEFORME A VUE D ABORD (passe securite du 2026-11-08, point M1 du
// pentest) : x-vercel-forwarded-for et x-real-ip sont poses par Vercel ; x-forwarded-for
// peut arriver du client derriere un autre relais, il ne passe qu en dernier.
function getClientIp(req) {
  const h = req.headers || {};
  const brut = h['x-vercel-forwarded-for'] || h['x-real-ip'] || h['x-forwarded-for']
    || req.socket?.remoteAddress || req.connection?.remoteAddress || 'unknown';
  return String(Array.isArray(brut) ? brut[0] : brut).split(',')[0].trim() || 'unknown';
}

// UNE ADRESSE IPv6 SE COMPTE PAR SON BLOC /64 (passe securite du 2026-11-08) : un abonne
// en recoit des milliards, et changer d adresse dans son bloc remettait le compteur a
// zero. Une adresse IPv4 reste telle quelle. La regle elle-meme : lib/adresse-reseau.js.
function cleDeLAdresse(ip) {
  return require('./adresse-reseau').blocDeLAdresse(ip);
}

// Returns { allowed, remaining, retryAfterSeconds }.
function checkRateLimit(key, { limit = 30, windowMs = 60_000 } = {}) {
  const now = Date.now();
  const windowStart = now - windowMs;

  const hits = (buckets.get(key) || []).filter((timestamp) => timestamp > windowStart);

  if (hits.length >= limit) {
    const retryAfterMs = hits[0] + windowMs - now;
    buckets.set(key, hits);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    };
  }

  hits.push(now);
  buckets.set(key, hits);

  // Opportunistic cleanup so the map does not grow unbounded.
  if (buckets.size > 5000) {
    for (const [bucketKey, timestamps] of buckets) {
      const fresh = timestamps.filter((timestamp) => timestamp > windowStart);
      if (fresh.length === 0) buckets.delete(bucketKey);
      else buckets.set(bucketKey, fresh);
    }
  }

  return { allowed: true, remaining: limit - hits.length, retryAfterSeconds: 0 };
}

// Enforce a limit on an http response; returns true if the request was blocked
// (and a 429 has been written), false if it may proceed.
function enforceRateLimit(req, res, { scope, limit, windowMs }) {
  const key = `${scope}:${cleDeLAdresse(getClientIp(req))}`;
  const outcome = checkRateLimit(key, { limit, windowMs });
  if (!outcome.allowed) {
    res.setHeader('Retry-After', String(outcome.retryAfterSeconds));
    res.statusCode = 429;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.end(
      JSON.stringify({
        ok: false,
        message: 'Trop de requêtes. Merci de réessayer dans un instant.',
        retryAfterSeconds: outcome.retryAfterSeconds,
      }),
    );
    return true;
  }
  return false;
}

module.exports = {
  checkRateLimit,
  cleDeLAdresse,
  enforceRateLimit,
  getClientIp,
};

// Veille concurrence — surveillance automatique des SITES des concurrents.
//
// Le gérant enregistre ses concurrents (page Marketing). Le cron quotidien
// visite chaque site actif, extrait le texte, le hache : un changement produit
// un snapshot + un résumé (IA si clé disponible, grounded sur les deux textes ;
// sinon signalement brut). Instagram ne se scrape pas fiablement sans service
// tiers — le champ handle est informatif, et les observations Insta se
// saisissent à la main (elles nourrissent marketing_social_observations et
// l'apprentissage de critères existant).
//
// Sécurité : URL http(s) publique uniquement (pas de credentials, pas d'hôte
// privé/loopback — y compris après redirections), lecture bornée, timeout dur.
const crypto = require('crypto');
const { getPool, createOpsEvent } = require('./database');
const { callLlmJson } = require('./llm-client');

const MAX_COMPETITORS_PER_SWEEP = 10;
const FETCH_TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 400000;
const MAX_EXTRACT_CHARS = 8000;

function httpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.expose = true;
  return error;
}

// Hôtes interdits : loopback, lien-local, plages privées, .local, IP littérales
// internes. Défense raisonnable contre le SSRF via la config gérant (rôle
// campaigns.manage requis de toute façon).
function isForbiddenHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (/^\[?::1\]?$/.test(host) || host.startsWith('[fc') || host.startsWith('[fd') || host.startsWith('[fe80')) return true;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 0 || a === 10 || a === 127 || a === 169 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return true;
  }
  return false;
}

function validateWebsiteUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (value.length > 300) throw httpError('URL du site trop longue (300 caractères max).');
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    throw httpError('URL du site invalide.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw httpError('Le site doit être en http(s).');
  if (url.username || url.password) throw httpError('URL avec identifiants refusée.');
  if (isForbiddenHost(url.hostname)) throw httpError('Hôte du site non autorisé.');
  return url.toString();
}

function normalizeInstagramHandle(raw) {
  const value = String(raw || '').trim().replace(/^@+/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/\/+$/, '');
  if (!value) return '';
  if (!/^[a-zA-Z0-9._]{1,30}$/.test(value)) throw httpError('Compte Instagram invalide (lettres, chiffres, points, 30 max).');
  return value.toLowerCase();
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

async function listCompetitors(centerId, deps = {}) {
  const query = deps.query || ((text, params) => getPool().query(text, params));
  const result = await query(
    `select c.id, c.name, c.website_url, c.instagram_handle, c.notes, c.enabled,
            s.fetched_at as last_checked_at, s.diff_summary as last_diff
     from marketing_competitors c
     left join lateral (
       select fetched_at, diff_summary
       from competitor_snapshots
       where competitor_id = c.id
       order by fetched_at desc
       limit 1
     ) s on true
     where c.center_id = $1
     order by c.name asc;`,
    [centerId],
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    websiteUrl: row.website_url,
    instagramHandle: row.instagram_handle,
    notes: row.notes,
    enabled: Boolean(row.enabled),
    lastCheckedAt: row.last_checked_at,
    lastDiff: row.last_diff || '',
  }));
}

async function saveCompetitor(centerId, input = {}, deps = {}) {
  const query = deps.query || ((text, params) => getPool().query(text, params));
  const name = String(input.name || '').trim().slice(0, 80);
  if (!name) throw httpError('Nom du concurrent requis.');
  const websiteUrl = validateWebsiteUrl(input.websiteUrl);
  const instagramHandle = normalizeInstagramHandle(input.instagramHandle);
  const notes = String(input.notes || '').trim().slice(0, 500);
  const enabled = input.enabled === undefined ? true : Boolean(input.enabled);
  const id = Number(input.id) || null;
  if (id) {
    const result = await query(
      `update marketing_competitors
       set name = $3, website_url = $4, instagram_handle = $5, notes = $6, enabled = $7, updated_at = now()
       where id = $1 and center_id = $2
       returning id;`,
      [id, centerId, name, websiteUrl, instagramHandle, notes, enabled],
    );
    if (!result.rows[0]) throw httpError('Concurrent introuvable.', 404);
    return { ok: true, id: Number(result.rows[0].id) };
  }
  const count = await query(
    'select count(*)::int as count from marketing_competitors where center_id = $1;',
    [centerId],
  );
  if (Number(count.rows[0]?.count || 0) >= 20) throw httpError('20 concurrents max — supprime-en un d\'abord.');
  const result = await query(
    `insert into marketing_competitors (center_id, name, website_url, instagram_handle, notes, enabled)
     values ($1,$2,$3,$4,$5,$6)
     returning id;`,
    [centerId, name, websiteUrl, instagramHandle, notes, enabled],
  );
  return { ok: true, id: Number(result.rows[0].id) };
}

async function deleteCompetitor(centerId, id, deps = {}) {
  const query = deps.query || ((text, params) => getPool().query(text, params));
  const result = await query(
    'delete from marketing_competitors where id = $1 and center_id = $2 returning id;',
    [Number(id), centerId],
  );
  if (!result.rows[0]) throw httpError('Concurrent introuvable.', 404);
  return { ok: true, id: Number(result.rows[0].id) };
}

// ── Sweep ────────────────────────────────────────────────────────────────────

function extractText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#\d+;|&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_EXTRACT_CHARS);
}

async function fetchCompetitorPage(url, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'PinlaneWatch/1.0 (veille concurrentielle)' },
    });
    // Re-valide l'URL FINALE : une redirection vers un hôte privé est refusée.
    const finalUrl = new URL(response.url || url);
    if (isForbiddenHost(finalUrl.hostname)) throw new Error('Redirection vers un hôte non autorisé.');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const type = String(response.headers.get('content-type') || '');
    if (type && !/text\/html|text\/plain|application\/xhtml/.test(type)) throw new Error(`Type de contenu inattendu (${type.split(';')[0]}).`);
    const raw = await response.text();
    return extractText(raw.slice(0, MAX_HTML_BYTES));
  } finally {
    clearTimeout(timer);
  }
}

// Résumé IA du changement — grounded : uniquement les deux textes, réponse
// courte, fallback silencieux vers un signalement brut.
async function summarizeDiff(previousText, currentText) {
  const result = await callLlmJson({
    stableSystem: [
      'Tu compares deux captures texte du site web d\'un concurrent d\'un centre de loisirs.',
      'Résume UNIQUEMENT ce qui a changé côté offres, prix, événements ou activités, en 1 à 2 phrases en français.',
      'Tu ne cites que ce qui figure dans les textes fournis. Si le changement est cosmétique ou illisible, dis-le simplement.',
      'Réponds uniquement en JSON conforme au schéma.',
    ].join(' '),
    user: JSON.stringify({
      avant: String(previousText || '').slice(0, 4000),
      apres: String(currentText || '').slice(0, 4000),
    }),
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: { resume: { type: 'string' } },
      required: ['resume'],
    },
    schemaName: 'competitor_diff_summary',
    maxTokens: 300,
    timeoutMs: 12000,
  }).catch(() => null);
  const text = result && typeof result.resume === 'string' ? result.resume.trim().slice(0, 500) : '';
  return text || 'Changement détecté sur le site (résumé IA indisponible — clé API non configurée).';
}

async function runCompetitorSweep(centerId, { fetchImpl = fetch, deps = {} } = {}) {
  const query = deps.query || ((text, params) => getPool().query(text, params));
  const emitEvent = deps.createOpsEvent || createOpsEvent;
  const competitors = await query(
    `select id, name, website_url
     from marketing_competitors
     where center_id = $1 and enabled = true and website_url <> ''
     order by id asc
     limit $2;`,
    [centerId, MAX_COMPETITORS_PER_SWEEP],
  );
  const results = [];
  for (const competitor of competitors.rows) {
    const entry = { id: Number(competitor.id), name: competitor.name };
    try {
      const text = await fetchCompetitorPage(competitor.website_url, fetchImpl);
      const hash = crypto.createHash('sha256').update(text).digest('hex');
      const last = await query(
        `select content_hash, extracted_text
         from competitor_snapshots
         where competitor_id = $1
         order by fetched_at desc
         limit 1;`,
        [competitor.id],
      );
      const previous = last.rows[0] || null;
      if (previous && previous.content_hash === hash) {
        entry.status = 'unchanged';
      } else {
        const diffSummary = previous
          ? await summarizeDiff(previous.extracted_text, text)
          : 'Première capture du site — la surveillance démarre.';
        await query(
          `insert into competitor_snapshots (competitor_id, content_hash, extracted_text, diff_summary)
           values ($1,$2,$3,$4);`,
          [competitor.id, hash, text, diffSummary],
        );
        entry.status = previous ? 'changed' : 'first_snapshot';
        entry.diffSummary = diffSummary;
        if (previous) {
          await emitEvent({
            centerId,
            eventType: 'competitor_site_changed',
            severity: 'info',
            payload: { competitorId: Number(competitor.id), name: competitor.name, diffSummary },
          }).catch(() => null);
        }
      }
    } catch (error) {
      entry.status = 'error';
      entry.message = error.message || 'Visite du site impossible.';
    }
    results.push(entry);
  }
  return { ok: true, centerId, checked: results.length, results };
}

module.exports = {
  listCompetitors,
  saveCompetitor,
  deleteCompetitor,
  runCompetitorSweep,
  // Purs / testables
  validateWebsiteUrl,
  normalizeInstagramHandle,
  isForbiddenHost,
  extractText,
  fetchCompetitorPage,
};

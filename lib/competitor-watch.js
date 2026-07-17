// Veille concurrence : surveillance automatique des SITES des concurrents.
//
// Le gérant enregistre ses concurrents (page Marketing). Le cron quotidien
// visite chaque site actif, extrait le texte, le hache : un changement produit
// un snapshot + un résumé (IA si clé disponible, grounded sur les deux textes ;
// sinon signalement brut). Instagram ne se scrape pas fiablement sans service
// tiers : le champ handle est informatif, et les observations Insta se
// saisissent à la main (elles nourrissent marketing_social_observations et
// l'apprentissage de critères existant).
//
// Sécurité : URL http(s) publique uniquement (pas de credentials, pas d'hôte
// privé/loopback : y compris après redirections), lecture bornée, timeout dur.
const crypto = require('crypto');
const { getPool, createOpsEvent } = require('./database');
const { callLlmJson } = require('./llm-client');
const { ingestDnaRules } = require('./marketing-dna');

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
            c.rating, c.reviews_count, c.place_id, c.places_checked_at,
            s.fetched_at as last_checked_at, s.diff_summary as last_diff, s.signals as last_signals
     from marketing_competitors c
     left join lateral (
       select fetched_at, diff_summary, signals
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
    rating: row.rating === null || row.rating === undefined ? null : Number(row.rating),
    reviewsCount: row.reviews_count === null || row.reviews_count === undefined ? null : Number(row.reviews_count),
    placeId: row.place_id || '',
    placesCheckedAt: row.places_checked_at || null,
    signals: Array.isArray(row.last_signals) ? row.last_signals : [],
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
  if (Number(count.rows[0]?.count || 0) >= 20) throw httpError('20 concurrents max : supprime-en un d\'abord.');
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

// Résumé IA du changement : grounded : uniquement les deux textes, réponse
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
  return text || 'Changement détecté sur le site : résumé automatique indisponible pour le moment.';
}

// Extraction STRUCTURÉE du site concurrent (prix/offres/anniversaires/événements)
// : grounded (ne cite que le texte du site), fail-soft (sans clé → []). Tourne au
// sweep, uniquement quand le site a CHANGÉ (donc ~1 appel Haiku/concurrent-changé
// par jour). Ces signaux nourrissent l'affichage ET pourront nourrir la riposte.
async function extractCompetitorSignals(text, { deps = {} } = {}) {
  const content = String(text || '').slice(0, 5000);
  if (content.length < 40) return [];
  const call = deps.callLlmJson || callLlmJson;
  const result = await call({
    stableSystem: [
      'Tu lis le texte du site web d\'un concurrent d\'un centre de loisirs (bowling, laser game, arcades).',
      'Tu extrais UNIQUEMENT les faits business présents dans le texte : offres/promos, prix, formules anniversaire/groupe, événements, horaires spéciaux.',
      'Pour chaque item : un type (offre | prix | anniversaire | evenement | horaire), un libellé court, et le prix EXACT s\'il figure (sinon chaîne vide). N\'invente RIEN qui ne soit pas dans le texte. Maximum 8 items.',
      'Réponds uniquement en JSON conforme au schéma, en français.',
    ].join(' '),
    user: JSON.stringify({ site: content }),
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: { type: { type: 'string' }, label: { type: 'string' }, price: { type: 'string' } },
            required: ['type', 'label', 'price'],
          },
        },
      },
      required: ['items'],
    },
    schemaName: 'competitor_site_signals',
    maxTokens: 500,
    timeoutMs: 14000,
  }).catch(() => null);
  if (!result || !Array.isArray(result.items)) return [];
  return result.items
    .slice(0, 8)
    .map((item) => ({
      type: String(item.type || '').slice(0, 20),
      label: String(item.label || '').slice(0, 120),
      price: String(item.price || '').slice(0, 40),
    }))
    .filter((item) => item.label);
}

// ── Google Places (New) : note + nombre d'avis d'un concurrent ───────────────
// UN seul appel searchText (rating + userRatingCount, palier Enterprise, ~0 €
// à faible volume via le free tier). On ne stocke QUE {rating, reviewsCount,
// placeId} + un timestamp (JAMAIS le texte des avis : interdit par les Maps
// Terms). Fail-soft : sans clé GOOGLE_MAPS_API_KEY, retourne null (dormant).
const GOOGLE_PLACES_ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';

function googlePlacesKey() {
  return process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY || '';
}

async function fetchCompetitorPlaceStats(name, { fetchImpl = fetch } = {}) {
  const key = googlePlacesKey();
  const textQuery = String(name || '').trim();
  if (!key || textQuery.length < 2) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(GOOGLE_PLACES_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.rating,places.userRatingCount',
      },
      body: JSON.stringify({ textQuery: `${textQuery}, Belgique`, languageCode: 'fr', pageSize: 1 }),
      signal: controller.signal,
    });
    if (!response || !response.ok) return null;
    const data = await response.json();
    const place = data && Array.isArray(data.places) ? data.places[0] : null;
    if (!place) return null;
    return {
      placeId: String(place.id || ''),
      rating: typeof place.rating === 'number' ? place.rating : null,
      reviewsCount: typeof place.userRatingCount === 'number' ? place.userRatingCount : null,
    };
  } catch (error) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Rafraîchit la note Google des concurrents dont le check date de > 7 jours (ou
// jamais). Snapshot daté (pas un cache permanent). Non-fatal, no-op sans clé.
async function refreshCompetitorPlaces(centerId, { fetchImpl = fetch, deps = {} } = {}) {
  if (!googlePlacesKey()) return { ok: true, centerId, skipped: 'no_key', updated: 0 };
  const query = deps.query || ((text, params) => getPool().query(text, params));
  const due = await query(
    `select id, name from marketing_competitors
     where center_id = $1 and enabled = true
       and (places_checked_at is null or places_checked_at < now() - interval '7 days')
     order by id asc limit $2;`,
    [centerId, MAX_COMPETITORS_PER_SWEEP],
  );
  let updated = 0;
  for (const competitor of due.rows) {
    const stats = await fetchCompetitorPlaceStats(competitor.name, { fetchImpl });
    if (!stats) {
      // Marque le check même en cas d'échec/introuvable : évite de re-tenter en boucle.
      await query('update marketing_competitors set places_checked_at = now() where id = $1;', [competitor.id]).catch(() => null);
      continue;
    }
    await query(
      `update marketing_competitors
       set rating = $2, reviews_count = $3, place_id = coalesce(nullif($4, ''), place_id), places_checked_at = now()
       where id = $1;`,
      [competitor.id, stats.rating, stats.reviewsCount, stats.placeId],
    );
    updated += 1;
  }
  return { ok: true, centerId, updated };
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
          : 'Première capture du site, la surveillance démarre.';
        // Extraction structurée (prix/offres/événements) : sur changement seulement.
        const signals = await extractCompetitorSignals(text, { deps }).catch(() => []);
        await query(
          `insert into competitor_snapshots (competitor_id, content_hash, extracted_text, diff_summary, signals)
           values ($1,$2,$3,$4,$5::jsonb);`,
          [competitor.id, hash, text, diffSummary, JSON.stringify(signals)],
        );
        entry.status = previous ? 'changed' : 'first_snapshot';
        entry.diffSummary = diffSummary;
        entry.signals = signals;
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
  // Note Google (fail-soft, no-op sans clé), snapshot daté par concurrent.
  const places = await refreshCompetitorPlaces(centerId, { fetchImpl, deps }).catch(() => ({ updated: 0 }));
  return { ok: true, centerId, checked: results.length, results, places };
}

// « Colle un post » : le gérant colle le texte d'un post/offre d'un concurrent
// qu'il regarde DÉJÀ (déclenché par un humain, aucune collecte automatisée →
// défendable, cf. faisabilité veille 2026). L'IA en extrait le signal business
// ET une idée de riposte pour ce centre. GROUNDED (ne cite que le texte fourni,
// n'invente aucun prix/promo), fail-soft (clé absente → dégradé honnête).
// L'ADN d'ecriture extrait ici est la SEULE source d'ADN reel du secteur qu'on
// puisse obtenir legalement.
//
// Constate le 2026-07-16 par une recherche de 63 agents sur le web ouvert :
// aucun post Facebook/Instagram reel de bowling ou de FEC francophone n'est
// reproduit mot pour mot dans un article, une etude de cas ou un blog. Cet ADN
// vit derriere Instagram et Facebook, et aller le chercher a la machine viole
// leurs CGU (et ferait bannir les pages du client). Le meme run a montre que
// des agents de recherche fabriquent des chiffres a ~98 % quand on leur demande
// de sourcer ce qui marche dans le secteur.
//
// Ici, c'est l'HUMAIN qui apporte un post qu'il regarde deja. C'est licite, et
// c'est de la donnee de premiere main sur le vrai marche local, ce qu'aucun
// blog d'agence ne donne. On archive la REGLE abstraite (une idee), jamais le
// texte du concurrent (son expression) : on n'a aucun droit sur sa redaction.
async function analyzeCompetitorPost(rawText, { deps = {}, centerId = '', persistDna = true } = {}) {
  const text = String(rawText || '').trim().slice(0, 2000);
  if (text.length < 15) {
    const error = new Error('Colle le texte du post concurrent (au moins une phrase).');
    error.statusCode = 400;
    error.expose = true;
    throw error;
  }
  const call = deps.callLlmJson || callLlmJson;
  const result = await call({
    stableSystem: [
      'Tu analyses le texte d\'un post ou d\'une offre publié par un concurrent d\'un centre de loisirs (bowling, laser game, arcades).',
      'Tu extrais UNIQUEMENT ce qui figure dans le texte fourni : leur offre, le prix mentionné, le ton, l\'angle marketing. N\'invente AUCUN prix ni AUCUNE promo absente du texte.',
      'Puis tu proposes UNE idée de riposte courte et concrète pour le centre : comment se démarquer sans copier leur prix (miser sur une autre force : ambiance, activités, anniversaires, proximité).',
      'Enfin, tu extrais l\'ADN D\'ÉCRITURE de ce post : les techniques de rédaction observables, formulées comme des règles réutilisables (structure du hook, longueur, adresse tu/vous, usage des chiffres, emojis, type de CTA, rythme).',
      'Règles pour l\'ADN : décris la TECHNIQUE, jamais le contenu. « Le hook est une question qui nomme le besoin du parent » est une règle. « Ils font -30% le mercredi » n\'en est pas, c\'est leur offre. Ne recopie jamais leurs phrases. Si le post est trop pauvre pour en tirer une technique, rends une liste vide plutôt que de meubler.',
      'Réponds uniquement en JSON conforme au schéma, en français.',
    ].join(' '),
    user: JSON.stringify({ post: text }),
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        resume: { type: 'string' },
        offre: { type: 'string' },
        prix: { type: 'string' },
        ton: { type: 'string' },
        riposte: { type: 'string' },
        adn: {
          type: 'array',
          description: 'Techniques d\'ecriture observees, reutilisables. Vide si le post n\'en revele aucune.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              nom: { type: 'string', description: 'nom court de la technique' },
              regle: { type: 'string', description: 'la regle actionnable, injectable dans un prompt' },
            },
            required: ['nom', 'regle'],
          },
        },
      },
      required: ['resume', 'offre', 'prix', 'ton', 'riposte', 'adn'],
    },
    schemaName: 'competitor_post_analysis',
    maxTokens: 700,
    timeoutMs: 15000,
  }).catch(() => null);
  if (!result) {
    return { degraded: true, resume: '', offre: '', prix: '', ton: '', riposte: '', note: 'Analyse automatique indisponible pour le moment. Réessaie plus tard.' };
  }
  const adn = Array.isArray(result.adn) ? result.adn.slice(0, 4) : [];

  // On range l'ADN dans le second cerveau : au prochain post genere, ces regles
  // partiront dans le prompt. C'est ce qui fait du colle-un-post un geste qui
  // ameliore l'IA, et pas seulement un panneau d'affichage.
  //
  // Fail-soft total : si l'ecriture echoue, l'utilisateur voit quand meme son
  // analyse. Apprendre est un bonus, repondre est le contrat.
  let dnaLearned = 0;
  if (persistDna && adn.length) {
    try {
      const ingest = deps.ingestDnaRules || ingestDnaRules;
      const stamp = new Date().toISOString().slice(0, 10);
      const report = await ingest(
        adn.map((item) => ({
          nom: String(item.nom || '').slice(0, 120),
          regle: String(item.regle || '').slice(0, 400),
          preuve: `Technique observee dans un vrai post concurrent, apporte par le staff le ${stamp}.`,
          // La source est le geste humain lui-meme : c'est de la donnee de
          // premiere main sur le marche local, tracable et datee. Elle satisfait
          // la contrainte SQL « source non vide » sans mentir sur son origine.
          source: `colle-un-post:${centerId || 'centre'}:${stamp}`,
          // Jamais 'solide' : une occurrence unique n'etablit rien. C'est une
          // observation, pas une preuve. Elle sortira dans le prompt sous
          // « regles probables, a tester », ce qu'elle est.
          confiance: 'plausible',
          origine: 'colle-un-post',
        })),
        { angle: 'colle-un-post', channel: '' },
      );
      dnaLearned = (report.inserted || 0) + (report.updated || 0);
    } catch {
      dnaLearned = 0;
    }
  }

  return {
    degraded: false,
    resume: String(result.resume || '').slice(0, 400),
    offre: String(result.offre || '').slice(0, 200),
    prix: String(result.prix || '').slice(0, 80),
    ton: String(result.ton || '').slice(0, 80),
    riposte: String(result.riposte || '').slice(0, 400),
    adn: adn.map((item) => ({ nom: String(item.nom || '').slice(0, 120), regle: String(item.regle || '').slice(0, 400) })),
    dnaLearned,
  };
}

module.exports = {
  listCompetitors,
  saveCompetitor,
  deleteCompetitor,
  runCompetitorSweep,
  analyzeCompetitorPost,
  extractCompetitorSignals,
  fetchCompetitorPlaceStats,
  refreshCompetitorPlaces,
  // Purs / testables
  validateWebsiteUrl,
  normalizeInstagramHandle,
  isForbiddenHost,
  extractText,
  fetchCompetitorPage,
};

// Telemetrie des erreurs JS des consoles staff (table client_errors,
// database/client-errors-schema.sql).
//
// Le but produit : quand la directrice ou le staff declenche une erreur JS,
// le fondateur la voit dans son cockpit AVANT qu'on la lui signale.
//
// ── CE QUE CE MODULE GARANTIT (verrouille par scripts/client-errors-check.js) ─
//   1. CAPS stricts appliques sur la VALEUR inseree : message 500, source 300,
//      stack_excerpt 1500, user_agent 200. On ne fait jamais confiance au
//      client sur la taille (une erreur en boucle peut charrier des Mo).
//   2. stack_hash calcule COTE SERVEUR : sha1 hex du stack NORMALISE (chiffres
//      de ligne/colonne remplaces par N). Le meme bug reste UN groupe dans le
//      cockpit malgre les bumps de version qui decalent les numeros de ligne.
//   3. RATE-LIMIT comportemental : max 20 lignes par member_id par heure
//      (count SQL avant insert). Au-dela, on n'insere PAS et on repond
//      { ok: true, dropped: true } : silencieux, jamais d'erreur au client :
//      la telemetrie ne doit jamais casser la console qu'elle observe.
//   4. AUCUN secret ni PII au-dela du member_id : les motifs emails, jetons
//      Bearer, cles sk-/re_, URLs postgres:// et JWT sont expurges de chaque
//      champ texte AVANT le cap et AVANT le hash. Pas d'email, pas de corps
//      de requete : seuls neuf champs sont lus, en LISTE BLANCHE.
//
// Meme philosophie que le regime non bloquant de lib/audit-log.js : un echec
// d'ecriture ne remonte JAMAIS en erreur au client (la ligne est perdue, le
// console.error au prefixe stable la rend cherchable dans les logs), mais il
// ne se perd pas en silence total.

const crypto = require('crypto');
const { getPool } = require('./database');

// ── Caps (octets de sens : des VALEURS courtes, mesurees par le gate) ───────
const MESSAGE_CAP = 500;
const SOURCE_CAP = 300;
const STACK_EXCERPT_CAP = 1500;
const USER_AGENT_CAP = 200;
const PAGE_CAP = 120;
const MEMBER_ID_CAP = 120;
const CENTER_ID_CAP = 60;

// Plafond structurel : 20 lignes par membre et par heure, soit au pire
// 480 lignes/jour/poste. Une boucle d'erreurs ne peut pas inonder la table.
const MAX_PER_MEMBER_PER_HOUR = 20;

// ── Expurgation par MOTIF DE VALEUR ─────────────────────────────────────────
// Un message d'erreur ou un stack peut charrier n'importe quoi (une URL de
// fetch avec un jeton, un email affiche dans la page). On expurge AVANT le
// cap (une troncature ne doit pas laisser un demi-secret visible) et AVANT le
// hash (deux stacks du meme bug chez deux membres ne different pas par leur
// email expurge).
const SECRET_VALUE_PATTERNS = [
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, // email = PII interdite
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /sk-[A-Za-z0-9_-]{8,}/g,
  /re_[A-Za-z0-9_-]{8,}/g,
  /postgres(?:ql)?:\/\/\S+/gi,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, // JWT
];

function scrubSensitiveValues(text) {
  let out = String(text ?? '');
  for (const pattern of SECRET_VALUE_PATTERNS) {
    out = out.replace(pattern, '[expurge]');
  }
  return out;
}

function scrubAndCap(text, max) {
  const scrubbed = scrubSensitiveValues(text).trim();
  return scrubbed.length > max ? scrubbed.slice(0, max) : scrubbed;
}

function toIntOrNull(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 1e9 ? parsed : null;
}

// ── Normalisation du stack pour le hash ─────────────────────────────────────
// Chaque bump de version decale les numeros de ligne/colonne : sans
// normalisation, le meme bug produirait un groupe NEUF a chaque deploiement.
// On remplace donc tout chiffre par N (lignes, colonnes, hashes de version
// dans les URLs) et on neutralise l'indentation. Sur-regrouper deux frames qui
// ne different que par un chiffre est un cout accepte : le cockpit montre le
// sampleStackExcerpt, l'humain tranche.
function normalizeStackForHash(stack) {
  return String(stack ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
    .replace(/\d+/g, 'N');
}

function computeStackHash(stack, message, source) {
  const normalizedStack = normalizeStackForHash(stack);
  // Sans stack (vieux navigateur, erreur cross-origin muette), on regroupe
  // par message + source normalises : moins fin, jamais vide.
  const basis = normalizedStack || normalizeStackForHash(`${message}\n${source}`);
  return crypto.createHash('sha1').update(basis, 'utf8').digest('hex');
}

// ── Ecriture : recordClientError(entry) ─────────────────────────────────────
// LISTE BLANCHE de champs lus : centerId, page, message, source, lineno,
// colno, stack, memberId, userAgent. Rien d'autre de l'entree ne touche la
// base : un corps de requete forge ne peut pas y deverser un champ de plus.
//
// Ne jette JAMAIS vers l'appelant : une entree invalide, un membre au-dela du
// rate-limit ou une base indisponible repondent tous { ok: true, dropped: true }.
// La telemetrie est un capteur, pas une fonctionnalite : elle ne doit jamais
// produire une erreur dans la console qu'elle est censee observer.
async function recordClientError(entry = {}) {
  try {
    const message = scrubAndCap(entry.message, MESSAGE_CAP);
    if (!message) {
      // Sans message il n'y a rien a grouper ni a montrer : on abandonne
      // silencieusement plutot que d'ecrire une ligne vide.
      return { ok: true, dropped: true };
    }

    const centerId = String(entry.centerId ?? '').trim().slice(0, CENTER_ID_CAP) || 'libramont';
    const page = scrubAndCap(entry.page, PAGE_CAP);
    const source = scrubAndCap(entry.source, SOURCE_CAP);
    const memberId = String(entry.memberId ?? '').trim().slice(0, MEMBER_ID_CAP);
    const userAgent = scrubAndCap(entry.userAgent, USER_AGENT_CAP);
    const scrubbedStack = scrubSensitiveValues(entry.stack).trim();
    const stackHash = computeStackHash(scrubbedStack, message, source);
    const stackExcerpt = scrubbedStack.length > STACK_EXCERPT_CAP
      ? scrubbedStack.slice(0, STACK_EXCERPT_CAP)
      : scrubbedStack;

    // Rate-limit COMPORTEMENTAL : count AVANT insert, sur la fenetre glissante
    // d'une heure. Le 21e appel du meme membre ne produit AUCUN insert.
    const recent = await getPool().query(
      `
        select count(*)::int as recent
        from client_errors
        where member_id = $1
          and occurred_at > now() - interval '1 hour';
      `,
      [memberId],
    );
    const recentCount = Number(recent.rows[0] && recent.rows[0].recent) || 0;
    if (recentCount >= MAX_PER_MEMBER_PER_HOUR) {
      return { ok: true, dropped: true };
    }

    const inserted = await getPool().query(
      `
        insert into client_errors (
          center_id, page, message, source, lineno, colno,
          stack_hash, stack_excerpt, member_id, user_agent
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        returning id;
      `,
      [
        centerId,
        page,
        message,
        source,
        toIntOrNull(entry.lineno),
        toIntOrNull(entry.colno),
        stackHash,
        stackExcerpt,
        memberId,
        userAgent,
      ],
    );

    return { ok: true, dropped: false, id: inserted.rows[0] ? Number(inserted.rows[0].id) : null };
  } catch (error) {
    // Prefixe STABLE : cherchable dans les logs Vercel sans connaitre le
    // message du jour. La ligne est perdue, l'appel ne casse rien.
    console.error(
      '[client-errors] ECRITURE PERDUE',
      String((error && error.message) || 'erreur inconnue').slice(0, 300),
    );
    return { ok: true, dropped: true };
  }
}

// ── Lecture cockpit : loadClientErrorGroups({ limit, sinceDays }) ───────────
// Des GROUPES par stack_hash, pas des lignes brutes : le fondateur voit
// "ce bug, N fois, la derniere il y a 2 h, sur ces centres et ces pages",
// ordonne par derniere occurrence.
async function loadClientErrorGroups({ limit = 30, sinceDays = 14 } = {}) {
  const safeLimit = Math.min(Math.max(Math.trunc(Number(limit) || 30), 1), 100);
  const safeSinceDays = Math.min(Math.max(Math.trunc(Number(sinceDays) || 14), 1), 90);

  const result = await getPool().query(
    `
      select
        stack_hash,
        count(*)::int as count,
        max(occurred_at) as last_at,
        min(occurred_at) as first_at,
        array_agg(distinct center_id) as centers,
        array_agg(distinct page) as pages,
        (array_agg(message order by occurred_at desc, id desc))[1] as sample_message,
        (array_agg(source order by occurred_at desc, id desc))[1] as sample_source,
        (array_agg(stack_excerpt order by occurred_at desc, id desc))[1] as sample_stack_excerpt,
        count(distinct member_id) filter (where member_id <> '')::int as members_touches
      from client_errors
      where occurred_at > now() - make_interval(days => $1)
      group by stack_hash
      order by last_at desc
      limit $2;
    `,
    [safeSinceDays, safeLimit],
  );

  return result.rows.map(mapGroupRow);
}

function mapGroupRow(row) {
  return {
    stackHash: row.stack_hash,
    count: Number(row.count || 0),
    lastAt: row.last_at,
    firstAt: row.first_at,
    centers: Array.isArray(row.centers) ? row.centers.filter(Boolean) : [],
    pages: Array.isArray(row.pages) ? row.pages.filter(Boolean) : [],
    sampleMessage: row.sample_message || '',
    sampleSource: row.sample_source || '',
    sampleStackExcerpt: row.sample_stack_excerpt || '',
    membersTouches: Number(row.members_touches || 0),
  };
}

module.exports = {
  recordClientError,
  loadClientErrorGroups,
};

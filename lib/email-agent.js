// Agent email : le « second brain » qui lit les mails reçus, dit ce que veut
// le client et propose une réponse prête à envoyer.
//
// Hiérarchie de coût (NORTHSTAR) : règles/mots-clés d'abord (gratuit, toujours
// disponibles), IA via lib/llm-client (Claude Haiku prioritaire) quand une clé
// existe. GROUNDING DUR : la réponse ne contient jamais un chiffre absent du
// brain ou du mail (même garde-fou que polishIdeaWithAi) : sinon on retombe
// sur le template FAQ.
//
// Le brain = ops-knowledge/email-brain/(faq.md, rules.md) + voix marketing +
// config RÉELLE du centre (horaires/activités via getCenter) + les dernières
// leçons apprises (table email_agent_memory : corrections du staff).
// Toutes les fonctions à effets acceptent `deps` injectables → testables sans
// base (cf. scripts/email-agent-check.js).

const fs = require('fs');
const path = require('path');
const { getCenter } = require('./ops-knowledge');
const { callLlmJson, llmProvider } = require('./llm-client');
const { normalizeClientKey } = require('./ops-communications');
const { simulationSqlExclusion } = require('./simulation-filter');

const EMAIL_BRAIN_DIR = path.join(__dirname, '..', 'ops-knowledge', 'email-brain');

const INTENT_LABELS = {
  reservation: 'Réservation',
  annulation: 'Annulation / report',
  anniversaire: 'Anniversaire',
  prix: 'Prix & tarifs',
  horaires: 'Horaires',
  reclamation: 'Réclamation',
  autre: 'Autre',
};
const INTENTS = Object.keys(INTENT_LABELS);
const MEMORY_CAP_PER_CENTER = 200;

function defaultDeps() {
  const { getPool } = require('./database');
  return { query: (text, params) => getPool().query(text, params) };
}

function firstNameOf(name = '') {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

function readBrainFile(name) {
  try {
    return fs.readFileSync(path.join(EMAIL_BRAIN_DIR, name), 'utf8');
  } catch (error) {
    return '';
  }
}

function readVoiceFile() {
  try {
    return fs.readFileSync(path.join(__dirname, '..', 'ops-knowledge', 'marketing-brain', 'voice.md'), 'utf8');
  } catch (error) {
    return '';
  }
}

// Le NOM du centre qui parle : c'est lui qui remplace {{centre}} dans la FAQ
// fichier, les regles et la signature par defaut. Le fichier email-brain est
// NEUTRE depuis la purge de marque : aucun nom de client en dur, le texte
// servi a un centre porte toujours SON nom.
function centerNameOf(centerId) {
  try {
    return String(getCenter(centerId).name || '').trim();
  } catch (error) {
    return '';
  }
}

function fillCentre(text, centerName) {
  return String(text || '').replace(/\{\{\s*centre\s*\}\}/gi, String(centerName || '').trim() || 'votre centre');
}

function defaultSignature(centerName) {
  const name = String(centerName || '').trim();
  return name ? `L'équipe ${name}` : "L'équipe du centre";
}

// faq.md → { intent: { subject, body } }. Format : sections `## intent:xxx`,
// première ligne `Objet : …`, le reste = corps.
function parseFaqSections(faqMd = '') {
  const sections = {};
  const parts = String(faqMd).split(/^## intent:([a-z_]+)\s*$/m);
  for (let index = 1; index < parts.length - 1; index += 2) {
    const intent = parts[index];
    const lines = String(parts[index + 1] || '').trim().split('\n');
    let subject = '';
    if (/^Objet\s*:/i.test(lines[0] || '')) {
      subject = lines.shift().replace(/^Objet\s*:\s*/i, '').trim();
    }
    sections[intent] = { subject, body: lines.join('\n').trim() };
  }
  return sections;
}

const DAY_LABELS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

function scheduleLine(slot) {
  if (!slot || !slot.open) return 'fermé';
  const fmt = (time) => String(time).replace(':00', 'h').replace(':', 'h');
  const close = slot.close === '24:00' ? 'minuit' : fmt(slot.close);
  return `${fmt(slot.open)} à ${close}`;
}

// Faits RÉELS du centre pour le prompt : horaires 7 j + activités disponibles.
// Dérivés de la config (getCenter fusionne les overrides DB) : jamais inventés.
function buildCenterFacts(centerId = 'libramont') {
  let center = null;
  try {
    center = getCenter(centerId);
  } catch (error) {
    return `Centre : ${centerId}.`;
  }
  const lines = [`Centre : ${center.name}.`];
  const regular = center.defaultSchedule?.regular || {};
  const ordered = [1, 2, 3, 4, 5, 6, 0];
  lines.push(`Horaires habituels : ${ordered.map((day) => `${DAY_LABELS[day]} ${scheduleLine(regular[String(day)] || regular[day])}`).join(' · ')}.`);
  const holiday = center.defaultSchedule?.holiday || {};
  if (holiday && Object.keys(holiday).length) {
    lines.push(`Congés scolaires : ouvert tous les jours (${scheduleLine(holiday['1'] || holiday[1])} en semaine, ${scheduleLine(holiday['5'] || holiday[5])} vendredi/samedi).`);
  }
  const availability = center.activityAvailability || {};
  // Uniquement les activites du catalogue que des centres proposent reellement.
  // axe_throwing, darts, free_roaming_vr et karting_vr ont ete retires le
  // 2026-07-16 : aucun centre ne les propose. Les nommer ici, meme pour
  // les interdire, revenait a apprendre au modele qu'ils existent chez nous.
  const ACTIVITY_LABELS = {
    bowling: 'bowling',
    laser_game: 'laser game',
    minigolf_blacklight: 'minigolf blacklight',
    golf_oclock: "Golf O'Clock",
    arcade_time: 'arcades',
    playground: 'plaine de jeux',
    duckpin_bowling: 'duckpin bowling',
    billards: 'billards',
    fun_run: 'fun run',
  };
  const available = Object.entries(availability)
    .filter(([, ok]) => ok)
    .map(([key]) => ACTIVITY_LABELS[key] || key.replace(/_/g, ' '));
  if (available.length) lines.push(`Activités disponibles : ${available.join(', ')}.`);
  // On ne liste comme « non proposee » qu'une activite qui existe VRAIMENT
  // ailleurs (un client peut demander une activite vue dans un centre voisin).
  // Une activite absente d'ACTIVITY_LABELS n'existe nulle part : la nommer,
  // meme pour l'interdire, apprendrait au modele qu'elle existe (c'est ainsi
  // qu'un post de prod a promis du Karting VR le 15/07). Ce qui n'existe pas
  // ne se mentionne pas.
  const unavailable = Object.entries(availability)
    .filter(([key, ok]) => !ok && ACTIVITY_LABELS[key])
    .map(([key]) => ACTIVITY_LABELS[key]);
  if (unavailable.length) lines.push(`Proposé dans l'autre centre mais PAS ici (ne jamais le promettre pour ce centre) : ${unavailable.join(', ')}.`);
  lines.push('Formules anniversaire : à partir de 6 enfants. Les tarifs ne sont PAS fournis ici : ne jamais donner un prix, proposer de confirmer par retour.');
  return lines.join('\n');
}

async function getAgentLessons(centerId = 'libramont', deps = defaultDeps(), limit = 12) {
  try {
    const result = await deps.query(
      `select intent, question_excerpt, learned_reply
       from email_agent_memory
       where center_id = $1
       order by created_at desc
       limit $2;`,
      [centerId, limit],
    );
    return result.rows || [];
  } catch (error) {
    return [];
  }
}

/* ── « Ce que l'agent sait » : overrides ÉDITABLES par le gérant ────────────
   Stockés dans center_automation_settings.settings.email_brain (jsonb, pas de
   migration) : { faq: { <intent>: { subject, body } }, signature, extra }.
   Priorité : override gérant > fichier email-brain. ── */

const BRAIN_LIMITS = { subject: 140, body: 2000, extra: 3000, signature: 120 };

async function getEmailBrainOverrides(centerId = 'libramont', deps = defaultDeps()) {
  try {
    const result = await deps.query(
      'select settings from center_automation_settings where center_id = $1 limit 1;',
      [centerId],
    );
    const settings = result.rows?.[0]?.settings || {};
    const brain = settings.email_brain || {};
    return {
      faq: brain.faq && typeof brain.faq === 'object' ? brain.faq : {},
      signature: typeof brain.signature === 'string' ? brain.signature : '',
      extra: typeof brain.extra === 'string' ? brain.extra : '',
    };
  } catch (error) {
    return { faq: {}, signature: '', extra: '' };
  }
}

// Les défauts visibles par l'UI (placeholders + reset) : FAQ fichier parsée,
// {{centre}} rempli avec le nom du centre demandé (neutre sans centre).
function getEmailBrainDefaults(centerId = '') {
  const centerName = centerId ? centerNameOf(centerId) : '';
  const faq = parseFaqSections(readBrainFile('faq.md'));
  const filled = {};
  for (const [intent, entry] of Object.entries(faq)) {
    filled[intent] = { subject: fillCentre(entry.subject, centerName), body: fillCentre(entry.body, centerName) };
  }
  return {
    intents: INTENT_LABELS,
    faq: filled,
    signature: defaultSignature(centerName),
  };
}

// Patch validé du brain : {faq:{intent:{subject,body}|null}, signature?, extra?}.
// null sur un intent → reset au fichier. Champs absents → inchangés.
async function saveEmailBrainOverrides(centerId, patch = {}, deps = defaultDeps()) {
  const current = await getEmailBrainOverrides(centerId, deps);
  const next = { faq: { ...current.faq }, signature: current.signature, extra: current.extra };

  if (patch.faq && typeof patch.faq === 'object') {
    for (const [intent, value] of Object.entries(patch.faq)) {
      if (!INTENTS.includes(intent)) { const e = new Error(`Sujet inconnu : ${intent}.`); e.expose = true; throw e; }
      if (value === null) { delete next.faq[intent]; continue; }
      const subject = String(value?.subject || '').trim();
      const body = String(value?.body || '').trim();
      if (!body) { const e = new Error(`La réponse « ${INTENT_LABELS[intent]} » est vide : utilisez Réinitialiser pour revenir au modèle.`); e.expose = true; throw e; }
      if (subject.length > BRAIN_LIMITS.subject) { const e = new Error(`Objet trop long (${BRAIN_LIMITS.subject} caractères max).`); e.expose = true; throw e; }
      if (body.length > BRAIN_LIMITS.body) { const e = new Error(`Réponse trop longue (${BRAIN_LIMITS.body} caractères max).`); e.expose = true; throw e; }
      next.faq[intent] = { subject, body };
    }
  }
  if (patch.signature !== undefined) {
    const signature = String(patch.signature || '').trim();
    if (signature.length > BRAIN_LIMITS.signature) { const e = new Error(`Signature trop longue (${BRAIN_LIMITS.signature} caractères max).`); e.expose = true; throw e; }
    next.signature = signature;
  }
  if (patch.extra !== undefined) {
    const extra = String(patch.extra || '').trim();
    if (extra.length > BRAIN_LIMITS.extra) { const e = new Error(`Texte trop long (${BRAIN_LIMITS.extra} caractères max).`); e.expose = true; throw e; }
    next.extra = extra;
  }

  await deps.query(
    `insert into center_automation_settings (center_id, settings, updated_at)
     values ($1, jsonb_build_object('email_brain', $2::jsonb), now())
     on conflict (center_id)
     do update set settings = center_automation_settings.settings || jsonb_build_object('email_brain', $2::jsonb), updated_at = now();`,
    [centerId, JSON.stringify(next)],
  );
  return next;
}

function renderFaqSections(faq = {}) {
  return Object.entries(faq)
    .map(([intent, section]) => `## intent:${intent}\nObjet : ${section.subject || ''}\n${section.body || ''}`)
    .join('\n\n');
}

// Le brain complet : bloc STABLE (règles + voix + FAQ fusionnée, change
// seulement quand le gérant édite → prompt caching Anthropic par centre) +
// bloc CONTEXTE (faits centre + leçons apprises, hors du préfixe caché).
async function buildEmailBrain(centerId = 'libramont', deps = defaultDeps()) {
  const centerName = centerNameOf(centerId);
  const rules = fillCentre(readBrainFile('rules.md'), centerName);
  const voice = readVoiceFile();
  const [lessons, overrides] = await Promise.all([
    getAgentLessons(centerId, deps),
    getEmailBrainOverrides(centerId, deps),
  ]);

  // FAQ effective : ce que le gérant a écrit gagne sur le fichier. {{centre}}
  // est rempli avec le nom de CE centre, dans le fichier comme dans le texte
  // du gérant.
  const merged = { ...parseFaqSections(readBrainFile('faq.md')), ...overrides.faq };
  const faq = {};
  for (const [intent, entry] of Object.entries(merged)) {
    faq[intent] = { subject: fillCentre(entry.subject, centerName), body: fillCentre(entry.body, centerName) };
  }
  const faqRendered = renderFaqSections(faq);
  // La signature effective : celle du gérant, sinon le nom du centre. Elle est
  // TOUJOURS annoncée au modèle : aucune signature n'est laissée à son
  // imagination, et jamais celle d'un autre client.
  const signature = String(overrides.signature || '').trim() || defaultSignature(centerName);

  const stable = [
    'Tu es l\'assistant email du centre de loisirs. Tu analyses un email reçu et tu proposes une réponse prête à envoyer, que le staff valide.',
    'INTERDIT d\'affirmer une disponibilité (« on a de la place », « c\'est libre ») : seul le staff vérifie le planning, propose toujours de confirmer le créneau, sans le garantir.',
    'INTERDIT d\'annoncer un prix, une promotion ou une activité qui ne figure pas dans les faits fournis.',
    'Réponds uniquement en JSON conforme au schéma.',
    rules ? `\n--- RÈGLES ---\n${rules}` : '',
    `\nSignature à utiliser dans chaque réponse : ${signature}`,
    voice ? `\n--- VOIX ---\n${voice}` : '',
    faqRendered ? `\n--- RÉPONSES DE RÉFÉRENCE ---\n${faqRendered}` : '',
    overrides.extra ? `\n--- CONSIGNES DU GÉRANT (prioritaires) ---\n${overrides.extra}` : '',
  ].filter(Boolean).join('\n');

  const lessonLines = lessons.map((lesson) => [
    `Question type (${INTENT_LABELS[lesson.intent] || lesson.intent}) : ${String(lesson.question_excerpt || '').slice(0, 200)}`,
    `Réponse validée par le staff : ${String(lesson.learned_reply || '').slice(0, 400)}`,
  ].join('\n'));

  const context = [
    `--- FAITS DU CENTRE ---\n${buildCenterFacts(centerId)}`,
    lessonLines.length ? `\n--- LEÇONS APPRISES (corrections du staff, à imiter) ---\n${lessonLines.join('\n\n')}` : '',
  ].filter(Boolean).join('\n');

  return { stable, context, faq, lessons, overrides, signature, centerName };
}

// Croisement CRM : l'expéditeur est-il un client connu ? (nom, visites,
// dernière venue). Best-effort : jamais bloquant.
async function matchClient(from = '', centerId = 'libramont', deps = defaultDeps()) {
  const email = String(from || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return null;
  try {
    const result = await deps.query(
      `select name, phone, email, date::text as date
       from reservations
       where center_id = $1
         and lower(coalesce(email, '')) = $2
         and status != 'cancelled'
         and ${simulationSqlExclusion()}
       order by date desc
       limit 20;`,
      [centerId, email],
    );
    const rows = result.rows || [];
    if (!rows.length) return null;
    return {
      clientKey: normalizeClientKey({ phone: rows[0].phone, email }),
      clientName: rows[0].name || '',
      visits: rows.length,
      lastVisit: rows[0].date || '',
    };
  } catch (error) {
    return null;
  }
}

// Garde-fou anti-invention : tout nombre de la réponse doit exister dans le
// brain, le mail d'origine ou la fiche client (pattern polishIdeaWithAi).
function hasUngroundedNumbers(text = '', allowedSource = '') {
  const numbers = String(text).match(/\d+(?:[.,]\d+)?/g) || [];
  for (const number of numbers) {
    const canonical = number.replace(',', '.');
    if (!allowedSource.includes(number) && !allowedSource.includes(canonical)) return true;
  }
  return false;
}

function applyPrenom(text = '', clientName = '') {
  const prenom = firstNameOf(clientName);
  return String(text)
    .replace(/\{\{\s*pr[eé]nom\s*\}\}/gi, prenom)
    .replace(/Bonjour\s*,/g, 'Bonjour,');
}

// Analyse DÉTERMINISTE (mots-clés FR) : le mode qui tourne sans clé IA, et le
// filet de sécurité quand l'IA échoue ou invente.
function analyzeByRules({ subject = '', body = '', faq = {}, client = null, signature = '' }) {
  const haystack = `${subject}\n${body}`.toLowerCase();
  let intent = 'autre';
  if (/annul|report|décal|decal/.test(haystack)) intent = 'annulation';
  else if (/plainte|déçu|decu|mécontent|mecontent|rembours|réclamation|reclamation|problème|probleme|incident|inadmissible/.test(haystack)) intent = 'reclamation';
  else if (/anniv/.test(haystack)) intent = 'anniversaire';
  else if (/prix|tarif|combien|coût|cout|devis/.test(haystack)) intent = 'prix';
  else if (/horaire|ouvert|ouverture|fermé|ferme[zr]?\b|quelle heure/.test(haystack)) intent = 'horaires';
  else if (/réserv|reserv|dispo|créneau|creneau|place pour|venir à|venir a/.test(haystack)) intent = 'reservation';

  const firstSentence = String(body).trim().split(/(?<=[.!?])\s+|\n/)[0] || String(subject).trim();
  const summary = firstSentence.length > 140 ? `${firstSentence.slice(0, 137)}…` : firstSentence;

  const fallbackSignature = String(signature || '').trim() || defaultSignature('');
  const template = faq[intent] || faq.autre || { subject: 'Bien reçu, on vous répond vite', body: `Bonjour,\n\nMerci pour votre message, on revient vers vous rapidement.\n\n${fallbackSignature}` };
  return {
    intent,
    intentLabel: INTENT_LABELS[intent],
    summary: summary || 'Message reçu.',
    urgency: ['reclamation', 'annulation'].includes(intent) ? 'haute' : 'normale',
    reply: {
      subject: applyPrenom(template.subject, client?.clientName || ''),
      body: applyPrenom(template.body, client?.clientName || ''),
    },
    provider: 'rules',
  };
}

const ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    intent: { type: 'string', enum: INTENTS },
    summary: { type: 'string' },
    urgency: { type: 'string', enum: ['haute', 'normale'] },
    reply: {
      type: 'object',
      additionalProperties: false,
      properties: {
        subject: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['subject', 'body'],
    },
  },
  required: ['intent', 'summary', 'urgency', 'reply'],
};

// Analyse complète d'un email reçu → { intent, intentLabel, summary, urgency,
// reply{subject, body}, clientKey?, clientName?, provider }.
async function analyzeEmail({
  from = '',
  subject = '',
  body = '',
  centerId = 'libramont',
  deps = defaultDeps(),
  fetchImpl = fetch,
} = {}) {
  const client = await matchClient(from, centerId, deps);
  const brain = await buildEmailBrain(centerId, deps);
  const rulesAnalysis = analyzeByRules({ subject, body, faq: brain.faq, client, signature: brain.signature });

  let analysis = rulesAnalysis;
  if (llmProvider()) {
    const ai = await callLlmJson({
      stableSystem: brain.stable,
      system: brain.context,
      user: JSON.stringify({
        emailRecu: { from, subject, body: String(body).slice(0, 6000) },
        client: client || 'inconnu',
        attendu: `intent (ce que veut le client), summary (1 phrase FR), urgency, reply prête à envoyer (vous doux, signature ${brain.signature}).`,
      }),
      schema: ANALYSIS_SCHEMA,
      schemaName: 'email_analysis',
      maxTokens: 700,
      timeoutMs: 12000,
      fetchImpl,
    });
    if (ai && INTENTS.includes(ai.intent) && ai.reply && ai.reply.subject && ai.reply.body) {
      const allowed = `${brain.stable}\n${brain.context}\n${subject}\n${body}\n${JSON.stringify(client || {})}`;
      const grounded = !hasUngroundedNumbers(`${ai.reply.subject}\n${ai.reply.body}`, allowed);
      if (grounded) {
        analysis = {
          intent: ai.intent,
          intentLabel: INTENT_LABELS[ai.intent],
          summary: String(ai.summary || rulesAnalysis.summary).slice(0, 200),
          urgency: ai.urgency === 'haute' ? 'haute' : 'normale',
          reply: { subject: String(ai.reply.subject), body: String(ai.reply.body) },
          provider: ai._provider || 'anthropic',
        };
      }
    }
  }

  if (client) {
    analysis.clientKey = client.clientKey;
    analysis.clientName = client.clientName;
  }
  analysis.analyzedAt = new Date().toISOString();
  return analysis;
}

// Ingestion d'un email reçu (webhook Resend ou collage manuel) : idempotent,
// stocké dans communications direction='inbound' AVEC son analyse.
async function ingestInboundEmail({
  centerId = 'libramont',
  from = '',
  fromName = '',
  subject = '',
  body = '',
  receivedAt = null,
  deps = defaultDeps(),
  fetchImpl = fetch,
} = {}) {
  const { createCommunication } = require('./database');
  const enqueue = deps.enqueue || createCommunication;
  const sender = String(from || '').trim();
  const text = String(body || '').trim();
  if (!sender || !text) {
    const error = new Error('Email entrant invalide : expéditeur et contenu requis.');
    error.expose = true;
    throw error;
  }

  const minuteKey = String(receivedAt || new Date().toISOString()).slice(0, 16);
  const subjectKey = String(subject || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 60);
  const idempotencyKey = `inbound:${centerId}:${sender.toLowerCase()}:${minuteKey}:${subjectKey}`;

  try {
    const existing = await deps.query(
      `select id from communications
       where center_id = $1 and direction = 'inbound' and idempotency_key = $2
       limit 1;`,
      [centerId, idempotencyKey],
    );
    if (existing.rows.length) {
      return { communication: { id: existing.rows[0].id }, analysis: null, deduped: true };
    }
  } catch (error) { /* dédup best-effort : on ingère quand même */ }

  const analysis = await analyzeEmail({ from: sender, subject, body: text, centerId, deps, fetchImpl });
  if (fromName && !analysis.clientName) analysis.clientName = fromName;

  const communication = await enqueue({
    centerId,
    reservationId: null,
    channel: 'email',
    direction: 'inbound',
    templateId: 'inbound_email',
    recipient: sender,
    subject: String(subject || '').trim(),
    body: text,
    status: 'received',
    scheduledAt: null,
    idempotencyKey,
    payload: {
      textBody: text,
      inbound: true,
      from: sender,
      fromName: fromName || '',
      receivedAt: receivedAt || new Date().toISOString(),
      analysis,
    },
  });

  return { communication, analysis, deduped: false };
}

// Apprentissage implicite : le staff a modifié la réponse proposée avant envoi
// → la version corrigée devient une leçon (réinjectée dans le brain).
function significantDiff(original = '', sent = '') {
  const a = String(original || '').replace(/\s+/g, ' ').trim();
  const b = String(sent || '').replace(/\s+/g, ' ').trim();
  if (a === b) return false;
  const maxLength = Math.max(a.length, b.length, 1);
  const lengthDelta = Math.abs(a.length - b.length);
  let positionDiffs = 0;
  const minLength = Math.min(a.length, b.length);
  for (let index = 0; index < minLength; index += 1) {
    if (a[index] !== b[index]) positionDiffs += 1;
  }
  return (lengthDelta + positionDiffs) / maxLength > 0.15;
}

async function recordAgentLesson({
  centerId = 'libramont',
  intent = 'autre',
  questionExcerpt = '',
  original = { subject: '', body: '' },
  sent = { subject: '', body: '' },
  deps = defaultDeps(),
} = {}) {
  const subjectChanged = String(original.subject || '').trim() !== String(sent.subject || '').trim();
  const bodyChanged = significantDiff(original.body, sent.body);
  if (!subjectChanged && !bodyChanged) return { recorded: false };

  const learnedReply = [String(sent.subject || '').trim(), String(sent.body || '').trim()]
    .filter(Boolean)
    .join('\n')
    .slice(0, 2000);
  if (!learnedReply) return { recorded: false };

  try {
    await deps.query(
      `insert into email_agent_memory (center_id, intent, question_excerpt, learned_reply)
       values ($1, $2, $3, $4);`,
      [centerId, INTENTS.includes(intent) ? intent : 'autre', String(questionExcerpt || '').slice(0, 300), learnedReply],
    );
    await deps.query(
      `delete from email_agent_memory
       where center_id = $1
         and id not in (
           select id from email_agent_memory
           where center_id = $1
           order by created_at desc
           limit ${MEMORY_CAP_PER_CENTER}
         );`,
      [centerId],
    );
  } catch (error) {
    return { recorded: false };
  }
  return { recorded: true };
}

module.exports = {
  INTENT_LABELS,
  buildEmailBrain,
  buildCenterFacts,
  parseFaqSections,
  analyzeByRules,
  analyzeEmail,
  ingestInboundEmail,
  recordAgentLesson,
  getAgentLessons,
  getEmailBrainOverrides,
  getEmailBrainDefaults,
  saveEmailBrainOverrides,
  __test: { hasUngroundedNumbers, significantDiff, matchClient },
};

// Studio mails : amélioration de brouillon et analyse des envois.
// Déterministe d'abord (toujours fonctionnel), IA optionnelle quand une clé
// est présente : Claude (ANTHROPIC_API_KEY) prioritaire, OpenAI sinon (même
// philosophie que marketing-agents et direction-analytics : l'IA reformule,
// elle n'invente jamais un fait).
const { llmProvider, callLlmJson } = require('./llm-client');

const SPAM_WORDS = ['gratuit!!!', 'urgent!!!', '100% gratuit', 'cliquez ici!!!', 'garanti', 'offre exceptionnelle!!!'];

function analyzeDraft({ subject = '', body = '' }) {
  const tips = [];
  const s = subject.trim();
  const b = body.trim();
  if (!s) tips.push('Ajoute un objet : un mail sans objet part en spam ou reste non lu.');
  else {
    if (s.length < 20) tips.push(`Objet court (${s.length} car.) : vise 30-60 caractères pour donner une vraie raison d'ouvrir.`);
    if (s.length > 70) tips.push(`Objet long (${s.length} car.) : il sera tronqué sur mobile, vise 30-60 caractères.`);
    if (s === s.toUpperCase() && s.length > 8) tips.push('Objet tout en majuscules : signal spam classique, mixe la casse.');
  }
  if (b.length < 120) tips.push('Corps très court : ajoute le bénéfice concret pour le client et une info pratique (horaires, lien).');
  if (!/(réserv|appel|répond|clique|découvr|profite|venez|rendez-vous)/i.test(b)) {
    tips.push('Aucun appel à action détecté : termine par UNE action claire (réserver, répondre, appeler).');
  }
  if (!/\{\{\s*(prenom|nom|name)\s*\}\}/i.test(b) && !/bonjour\s+[A-Z]/.test(b)) {
    tips.push('Pas de personnalisation : un « Bonjour {{prenom}} » augmente nettement l’ouverture et la réponse.');
  }
  const lowered = `${s} ${b}`.toLowerCase();
  const spam = SPAM_WORDS.filter((w) => lowered.includes(w));
  if (spam.length) tips.push(`Mots à risque spam détectés (${spam.join(', ')}) : reformule plus sobrement.`);
  const paragraphs = b.split(/\n\s*\n/).filter(Boolean);
  if (paragraphs.some((p) => p.length > 500)) tips.push('Paragraphe(s) très denses : coupe en blocs de 2-3 phrases, aère avec des sauts de ligne.');
  if (!tips.length) tips.push('Structure saine : objet calibré, appel à action présent. Relis juste le ton avant envoi.');
  return tips;
}

async function improveEmailDraft({ subject = '', body = '', category = 'marketing', centerName = 'Fun Galaxy' }) {
  const tips = analyzeDraft({ subject, body });
  if (!llmProvider()) {
    return { mode: 'deterministe', tips, subject: null, body: null };
  }
  const { COPY_SYSTEM_CORE, channelPlaybook, COPY_FINAL_REMINDER } = require('./copy-playbook');
  const result = await callLlmJson({
    // Le contexte catégorie/centre varie peu : il reste dans le bloc stable
    // pour maximiser le cache (mêmes valeurs à chaque appel du studio).
    stableSystem: [
      `Tu améliores un email ${category} pour ${centerName} (centre de loisirs bowling/laser game, Belgique).`,
      'INTERDIT : inventer un prix, une date, une promotion, une activité ou une disponibilité absente du brouillon. Les chiffres des exemples canoniques sont un ADN d\'écriture, PAS des faits.',
      'Conserve les variables {{...}} telles quelles. Garde la même langue (français).',
      COPY_SYSTEM_CORE,
      channelPlaybook('email'),
      'Réponds UNIQUEMENT en JSON conforme au schéma : body en texte simple avec sauts de ligne.',
    ].join('\n\n'),
    user: JSON.stringify({ subject, body, pointsAmeliorer: tips, rappel: COPY_FINAL_REMINDER }),
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        subject: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['subject', 'body'],
    },
    schemaName: 'improved_email',
    maxTokens: 900,
    timeoutMs: 14000,
    openaiModel: process.env.OPENAI_DIRECTION_MODEL || 'gpt-4o-mini',
  });
  if (!result || !result.subject || !result.body) {
    return { mode: 'deterministe', tips, subject: null, body: null };
  }
  return { mode: 'ia', tips, subject: String(result.subject), body: String(result.body) };
}

const WEEKDAYS_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

// Analyse déterministe des envois : chaque affirmation sort des lignes SQL.
function buildEmailInsights({ statusCounts, templateCounts, hourCounts, failureReasons, weeklySeries, resendConfigured }) {
  const total = statusCounts.reduce((s, r) => s + Number(r.count), 0);
  const sent = Number(statusCounts.find((r) => r.status === 'sent')?.count || 0);
  const failed = Number(statusCounts.find((r) => r.status === 'failed')?.count || 0);
  const queued = Number(statusCounts.find((r) => r.status === 'queued')?.count || 0);
  const failRate = sent + failed ? Math.round((failed / (sent + failed)) * 1000) / 10 : 0;

  const recommendations = [];
  if (!resendConfigured) {
    recommendations.push('Le canal d’envoi (RESEND_API_KEY) n’est pas configuré : les mails restent en file. C’est le premier blocage à lever.');
  }
  if (queued > 5) recommendations.push(`${queued} mails attendent en file : lance « Envoyer la file » ou vérifie le canal.`);
  if (failRate > 10 && failureReasons.length) {
    recommendations.push(`Taux d'échec élevé (${failRate} %) : cause principale : « ${failureReasons[0].reason} » (${failureReasons[0].count} cas).`);
  }
  const bestHour = [...hourCounts].sort((a, b) => b.count - a.count)[0];
  if (bestHour && Number(bestHour.count) >= 3) {
    recommendations.push(`Vos envois aboutis partent surtout le ${WEEKDAYS_FR[Number(bestHour.dow)]} vers ${bestHour.hour}h : créneau à privilégier pour les campagnes.`);
  }
  const topTemplate = templateCounts[0];
  if (topTemplate) {
    recommendations.push(`Modèle le plus utilisé sur 30 jours : « ${topTemplate.template_id || 'direct'} » (${topTemplate.count} envois).`);
  }
  if (weeklySeries.length >= 2) {
    const last = Number(weeklySeries[weeklySeries.length - 1].count);
    const prev = Number(weeklySeries[weeklySeries.length - 2].count);
    if (prev && last < prev * 0.5) recommendations.push(`Volume en forte baisse cette semaine (${last} vs ${prev}) : vérifie que les confirmations partent bien.`);
  }
  if (!recommendations.length) recommendations.push('Rien d’anormal : volumes réguliers, échecs contenus. Continue le suivi hebdomadaire.');

  return {
    totals: { total, sent, failed, queued, failRate },
    byTemplate: templateCounts,
    byStatus: statusCounts,
    weekly: weeklySeries,
    failureReasons,
    recommendations,
  };
}

module.exports = { improveEmailDraft, buildEmailInsights, analyzeDraft };

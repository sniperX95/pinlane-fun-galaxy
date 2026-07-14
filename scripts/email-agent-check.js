// Gate SERVEUR de l'agent email + automations éditables (Emails v3) — zéro
// réseau, zéro DB : deps.query mockée par fragments SQL, fetch IA mockée.
// Couvre (spec 2026-07-14-emails-v3) : brain chargé, fallback règles (7
// intents), grounding anti-chiffres, mémoire apprenante (leçon si diff, cap),
// overrides automations (défauts C1, validation C2, builders + timings),
// sendDirectEmail C3 (validation, payload, replyTo → marquage + leçon),
// ingestion inbound (idempotence) et webhook C5 (401/Resend/payload plat).
const path = require('path');
const {
  buildEmailBrain,
  analyzeEmail,
  ingestInboundEmail,
  recordAgentLesson,
} = require('../lib/email-agent');
const {
  getAutomationSettings,
  getAutomationDefaults,
  setAutomationSetting,
  buildMessage,
  buildBirthdayJ30Message,
  buildReactivationMessage,
  buildPostVisitMessage,
  enqueueReservationCommunications,
  runBirthdayJ30Sweep,
  runReactivationSweep,
  sendDirectEmail,
} = require('../lib/ops-communications');
const { createHandler } = require('../api/inbound-email.js');

let failures = 0;
function ok(cond, label) { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`); if (!cond) failures += 1; return cond; }
const iso = (offsetDays) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + offsetDays); return d.toISOString().slice(0, 10); };

const ENV_KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_MARKETING_MODEL', 'OPENAI_MARKETING_MODEL', 'INBOUND_EMAIL_SECRET'];
const savedEnv = {};
for (const key of ENV_KEYS) { savedEnv[key] = process.env[key]; delete process.env[key]; }
function restoreEnv() { for (const key of ENV_KEYS) { if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key]; } }

// Mock deps : route les requêtes par fragment SQL. `state` pilote les fixtures.
function makeDeps(state) {
  state.enqueued = state.enqueued || [];
  state.memoryInserts = state.memoryInserts || [];
  state.memoryDeletes = 0;
  state.payloadMerges = state.payloadMerges || [];
  return {
    state,
    enqueue: async (row) => { state.enqueued.push(row); return { id: state.nextId || 0 }; },
    query: async (text, params) => {
      const sql = String(text);
      if (sql.includes('from email_agent_memory') && sql.startsWith('select')) return { rows: state.lessons || [] };
      if (sql.includes('insert into email_agent_memory')) { state.memoryInserts.push(params); return { rows: [] }; }
      if (sql.includes('delete from email_agent_memory')) { state.memoryDeletes += 1; return { rows: [] }; }
      if (sql.includes('payload = payload ||')) { state.payloadMerges.push(params); return { rows: [] }; }
      if (sql.includes("direction = 'inbound' and idempotency_key")) return { rows: state.inboundDupe ? [{ id: 55 }] : [] };
      if (sql.includes("direction = 'inbound'")) return { rows: state.inboundRow ? [{ payload: state.inboundRow }] : [] };
      if (sql.includes('center_automation_settings') && sql.trim().startsWith('select')) {
        return { rows: state.settings ? [{ settings: state.settings }] : [] };
      }
      if (sql.includes('center_automation_settings')) { state.settings = JSON.parse(params[1]); return { rows: [] }; }
      if (sql.includes('with clients as')) return { rows: state.reactivationCandidates || [] };
      if (sql.includes('from reservations') && sql.includes('lower(coalesce(email')) return { rows: state.clientRows || [] };
      if (sql.includes("occasion = 'anniversaire'")) return { rows: state.birthdayCandidates || [] };
      if (sql.includes("template_id = 'birthday_j30'")) return { rows: [] };
      if (sql.includes("template_id = 'reactivation'")) return { rows: [] };
      return { rows: [] };
    },
  };
}

const anthropicOk = (object) => ({
  ok: true,
  json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(object) }] }),
});

(async () => {
  console.log('[BRAIN] second brain de l\'agent (fichiers + faits centre + leçons)');
  const depsBrain = makeDeps({ lessons: [{ intent: 'prix', question_excerpt: 'Combien pour 8 ?', learned_reply: 'Objet corrigé\nCorps corrigé par le staff' }] });
  const brain = await buildEmailBrain('libramont', depsBrain);
  ok(brain.stable.includes('Jamais promettre une disponibilité'), 'rules.md chargé dans le bloc stable');
  ok(brain.stable.includes('Français de Belgique'), 'voice.md (marketing-brain) chargé');
  ok(Object.keys(brain.faq).length === 7, `FAQ parsée : 7 intents (obtenu ${Object.keys(brain.faq).length})`);
  ok(brain.context.includes('Lundi fermé') && brain.context.includes('Samedi 10h à minuit'), 'horaires RÉELS du centre dans le contexte');
  ok(brain.context.includes('LEÇONS APPRISES') && brain.context.includes('Corps corrigé par le staff'), 'leçons mémoire injectées dans le contexte');
  ok(!brain.context.includes("Golf O'Clock — disponible") && brain.context.includes('NON proposées'), 'activités indisponibles signalées (jamais promises)');

  console.log('\n[RULES] analyse déterministe sans clé IA (mode jour 1)');
  const cases = [
    ['prix', 'Tarif groupe', 'Bonjour, quel est le prix pour 8 personnes mercredi ?'],
    ['annulation', '', 'Je dois annuler ma réservation de samedi, désolé.'],
    ['reclamation', 'Très déçu', 'Soirée décevante, je souhaite un remboursement.'],
    ['anniversaire', '', "C'est pour l'anniversaire de ma fille de 9 ans."],
    ['horaires', '', 'Vous êtes ouverts à quelle heure le dimanche ?'],
    ['reservation', '', 'Je voudrais réserver une piste pour 6 ce vendredi.'],
    ['autre', 'Merci', 'Merci pour tout, super équipe !'],
  ];
  for (const [expected, subject, body] of cases) {
    const analysis = await analyzeEmail({ from: 'inconnu@test.be', subject, body, centerId: 'libramont', deps: makeDeps({}) });
    ok(analysis.intent === expected && analysis.provider === 'rules', `intent « ${expected} » (obtenu ${analysis.intent}, ${analysis.provider})`);
  }
  const urgent = await analyzeEmail({ from: 'x@test.be', body: 'Je veux annuler.', deps: makeDeps({}) });
  ok(urgent.urgency === 'haute', 'annulation → urgence haute');
  const known = await analyzeEmail({
    from: 'marie@test.be',
    subject: 'Prix',
    body: 'Combien pour un groupe ?',
    deps: makeDeps({ clientRows: [{ name: 'Marie Dupont', phone: '+32 470 11 10 01', email: 'marie@test.be', date: '2026-06-20' }] }),
  });
  ok(known.clientName === 'Marie Dupont' && known.clientKey === '+32470111001', 'croisement CRM : client reconnu + clé normalisée');
  ok(known.reply.body.includes('Bonjour Marie,'), 'réponse personnalisée au prénom');
  const anonymous = await analyzeEmail({ from: 'x@test.be', body: 'Le prix svp ?', deps: makeDeps({}) });
  ok(anonymous.reply.body.includes('Bonjour,') && !anonymous.reply.body.includes('Bonjour ,'), 'sans prénom : « Bonjour, » propre');
  ok(anonymous.reply.body.includes('L\'équipe Fun Galaxy'), 'signature systématique');

  console.log('\n[GROUNDING] l\'IA ne peut pas inventer un chiffre');
  process.env.ANTHROPIC_API_KEY = 'test-key-anthropic';
  const invented = await analyzeEmail({
    from: 'x@test.be', subject: 'Prix', body: 'Combien pour un anniversaire ?',
    deps: makeDeps({}),
    fetchImpl: async () => anthropicOk({ intent: 'prix', summary: 'Demande de prix', urgency: 'normale', reply: { subject: 'Nos prix', body: 'C’est 42 € par enfant, promis !' } }),
  });
  ok(invented.provider === 'rules', `chiffre inventé (42 €) → réponse IA REJETÉE, fallback règles (obtenu ${invented.provider})`);
  const grounded = await analyzeEmail({
    from: 'x@test.be', subject: 'Groupe', body: 'On serait 8 personnes vendredi.',
    deps: makeDeps({}),
    fetchImpl: async () => anthropicOk({ intent: 'reservation', summary: 'Réservation pour 8 vendredi', urgency: 'normale', reply: { subject: 'Votre venue à 8', body: 'Avec plaisir pour vos 8 personnes vendredi — réservez en ligne sur www.mngfunglxy.com et c’est confirmé.' } }),
  });
  ok(grounded.provider === 'anthropic' && grounded.summary === 'Réservation pour 8 vendredi', 'chiffres du mail uniquement → réponse IA acceptée');
  const badIntent = await analyzeEmail({
    from: 'x@test.be', body: 'Le prix ?', deps: makeDeps({}),
    fetchImpl: async () => anthropicOk({ intent: 'venteflash', summary: 'x', urgency: 'normale', reply: { subject: 'a', body: 'b' } }),
  });
  ok(badIntent.provider === 'rules', 'intent hors liste fermée → rejeté');
  delete process.env.ANTHROPIC_API_KEY;

  console.log('\n[MEMORY] apprentissage implicite (corrections du staff)');
  const depsMemoryIdentical = makeDeps({});
  const same = await recordAgentLesson({
    centerId: 'libramont', intent: 'prix', questionExcerpt: 'Q',
    original: { subject: 'A', body: 'Bonjour, voici notre réponse standard.' },
    sent: { subject: 'A', body: 'Bonjour, voici notre réponse standard.' },
    deps: depsMemoryIdentical,
  });
  ok(same.recorded === false && depsMemoryIdentical.state.memoryInserts.length === 0, 'réponse envoyée telle quelle → pas de leçon');
  const depsMemoryDiff = makeDeps({});
  const diff = await recordAgentLesson({
    centerId: 'libramont', intent: 'prix', questionExcerpt: 'Combien pour 8 ?',
    original: { subject: 'A', body: 'Bonjour, voici notre réponse standard.' },
    sent: { subject: 'A', body: 'Bonjour Marie, pour 8 personnes on vous prépare un devis précis — on vous rappelle demain matin.' },
    deps: depsMemoryDiff,
  });
  ok(diff.recorded === true && depsMemoryDiff.state.memoryInserts.length === 1, 'texte substantiellement modifié → leçon enregistrée');
  ok(depsMemoryDiff.state.memoryDeletes === 1, 'cap mémoire appliqué (purge des plus vieilles)');

  console.log('\n[AUTOMATIONS] défauts C1 + validation C2');
  const defaults = getAutomationDefaults();
  ok(defaults.reminder_48h.offsetDays === 2 && String(defaults.reminder_48h.offsetRange) === '1,4', 'rappel : défaut 2 j, borné 1..4');
  ok(defaults.birthday_j30.offsetDays === 30 && String(defaults.birthday_j30.offsetRange) === '15,60', 'anniversaire : défaut J-30, borné 15..60');
  ok(defaults.post_visit.offsetDays === 1 && String(defaults.post_visit.offsetRange) === '0,3', 'merci : défaut J+1, borné 0..3');
  ok(defaults.reactivation.cap === 20 && String(defaults.reactivation.capRange) === '5,50', 'réactivation : cap 20, borné 5..50');
  ok(defaults.confirmation.body.includes('{{formule}}') && defaults.confirmation.variables.includes('prenom'), 'défauts = templates à variables visibles pour l\'UI');

  const depsAuto = makeDeps({});
  const throwsWith = async (fn, rx, label) => {
    try { await fn(); ok(false, label); } catch (error) { ok(rx.test(error.message || ''), `${label} (« ${error.message} »)`); }
  };
  await throwsWith(() => setAutomationSetting('libramont', 'inconnu', true, depsAuto), /inconnue/i, 'séquence inconnue → rejet');
  await throwsWith(() => setAutomationSetting('libramont', 'reminder_48h', { subject: 'x'.repeat(150) }, depsAuto), /140/, 'objet > 140 → rejet');
  await throwsWith(() => setAutomationSetting('libramont', 'reminder_48h', { body: 'Salut {{prix_total}} !' }, depsAuto), /inconnue/i, 'variable inconnue → rejet FR avec liste');
  await throwsWith(() => setAutomationSetting('libramont', 'reminder_48h', { offsetDays: 9 }, depsAuto), /entre 1 et 4/, 'délai hors bornes → rejet');
  await throwsWith(() => setAutomationSetting('libramont', 'reactivation', { cap: 200 }, depsAuto), /entre 5 et 50/, 'cap hors bornes → rejet');
  await throwsWith(() => setAutomationSetting('libramont', 'confirmation', { offsetDays: 2 }, depsAuto), /délai réglable/i, 'délai sur séquence sans timing → rejet');

  const saved = await setAutomationSetting('libramont', 'reminder_48h', { subject: 'Rappel {{prenom}} !', offsetDays: 3 }, depsAuto);
  ok(saved.reminder_48h.subject === 'Rappel {{prenom}} !' && saved.reminder_48h.offsetDays === 3, 'override sujet + délai enregistré');
  ok(depsAuto.state.settings.reminder_48h.subject === 'Rappel {{prenom}} !', 'seul l\'écart est persisté en base');
  const toggled = await setAutomationSetting('libramont', 'reminder_48h', false, depsAuto);
  ok(toggled.reminder_48h.enabled === false && toggled.reminder_48h.subject === 'Rappel {{prenom}} !', 'compat toggle boolean : garde les textes custom');
  const resetResult = await setAutomationSetting('libramont', 'reminder_48h', { reset: true }, depsAuto);
  ok(resetResult.reminder_48h.enabled === false && !resetResult.reminder_48h.subject && !resetResult.reminder_48h.offsetDays, 'reset : contenu/timing effacés, état ON/OFF conservé');

  console.log('\n[BUILDERS] overrides consommés, défauts intacts (non-régression)');
  const resa = { centerId: 'libramont', name: 'Marie Dupont', email: 'm@test.be', phone: '', date: '2026-08-20', startTime: '15:00', pax: 12, price: 468, type: 'formule', formuleId: 'f4', label: 'FORMULE 4' };
  const defaultMessage = buildMessage({ reservation: resa, templateId: 'confirmation', channel: 'email' });
  ok(defaultMessage.subject === 'Votre réservation Fun Galaxy est confirmée', 'confirmation sans override : sujet historique exact');
  const custom = buildMessage({
    reservation: resa, templateId: 'confirmation', channel: 'email',
    overrides: { subject: 'Merci {{prenom}} !', body: 'RDV le {{date}} à {{heure}} pour {{formule}} ({{pax}} pers) — {{centre}}' },
  });
  ok(custom.subject === 'Merci Marie !', 'sujet custom : {{prenom}} substitué');
  ok(custom.body === 'RDV le 20/08/2026 à 15:00 pour FORMULE 4 (12 pers) — Fun Galaxy Libramont', `corps custom : toutes variables substituées (obtenu « ${custom.body} »)`);
  const subjectOnly = buildMessage({ reservation: resa, templateId: 'confirmation', channel: 'email', overrides: { subject: 'Youpi {{prenom}}' } });
  ok(subjectOnly.subject === 'Youpi Marie' && subjectOnly.body.includes('confirmé pour FORMULE 4'), 'override sujet seul : corps par défaut conservé');
  const smsUntouched = buildMessage({ reservation: resa, templateId: 'reminder_day_sms', channel: 'sms', overrides: { subject: 'X', body: 'Y' } });
  ok(smsUntouched.body.startsWith('Fun Galaxy:'), 'SMS jamais touché par les overrides email');

  const birthdayDefault = buildBirthdayJ30Message({ name: 'Georges Dupuis', partyDateFr: '20 août' });
  ok(birthdayDefault.subject === 'Un anniversaire approche 🎂' && birthdayDefault.body.includes('(le 20 août)'), 'anniversaire sans override : texte historique');
  const birthdayCustom = buildBirthdayJ30Message({ name: 'Georges Dupuis', partyDateFr: '20 août', centerName: 'Fun Galaxy Libramont' }, { subject: 'La fête de {{prenom}} approche ({{date_fete}})' });
  ok(birthdayCustom.subject === 'La fête de Georges approche (20 août)', 'anniversaire : sujet custom substitué');
  const reactivationCustom = buildReactivationMessage({ name: 'Léa Petit', centerName: 'Fun Galaxy Libramont' }, { body: 'Reviens {{prenom}}, le {{centre}} t’attend !' });
  ok(reactivationCustom.body === 'Reviens Léa, le Fun Galaxy Libramont t’attend !', 'réactivation : corps custom substitué');
  const postVisitDefault = buildPostVisitMessage({ name: 'Marie Dupont' });
  ok(postVisitDefault.subject === 'Merci pour votre visite chez Fun Galaxy' && postVisitDefault.body.includes('Merci d etre venu'), 'merci post-visite : défaut byte-identique à l\'historique');
  const postVisitCustom = buildPostVisitMessage({ name: 'Marie Dupont' }, { body: 'Merci {{prenom}}, à bientôt chez {{centre}} !' });
  ok(postVisitCustom.body === 'Merci Marie, à bientôt chez Fun Galaxy !', 'merci post-visite : corps custom substitué');

  console.log('\n[ENQUEUE] confirmation + rappel avec réglages du gérant');
  const depsEnqueue = makeDeps({ settings: { reminder_48h: { enabled: true, subject: 'Rappel {{prenom}}', offsetDays: 4 }, confirmation: { enabled: true, body: 'Tout est bon {{prenom}} !' } } });
  const resaFuture = { ...resa, id: 901, date: iso(10) };
  await enqueueReservationCommunications(resaFuture, { deps: depsEnqueue, enqueue: depsEnqueue.enqueue });
  const confirmationRow = depsEnqueue.state.enqueued.find((row) => row.templateId === 'confirmation');
  const reminderRow = depsEnqueue.state.enqueued.find((row) => row.templateId === 'reminder_48h');
  ok(Boolean(confirmationRow) && confirmationRow.payload.textBody === 'Tout est bon Marie !', 'confirmation : corps custom dans la file');
  ok(Boolean(reminderRow) && reminderRow.subject === 'Rappel Marie', 'rappel : sujet custom dans la file');
  ok(Boolean(reminderRow) && String(reminderRow.scheduledAt).slice(0, 10) === iso(6), `rappel : programmé à J-4 de la venue (obtenu ${String(reminderRow && reminderRow.scheduledAt).slice(0, 10)}, attendu ${iso(6)})`);

  console.log('\n[SWEEPS] timing anniversaire réglable + cap réactivation');
  const birthdayOffset = 45;
  const candidate = { id: 1, name: 'Famille Kessler', phone: '+32470111007', email: 'kessler@test.be', date: iso(-(365 - birthdayOffset)) };
  const depsSweep = makeDeps({ settings: { birthday_j30: { enabled: true, offsetDays: birthdayOffset, subject: 'Bientôt la fête de {{prenom}}' } }, birthdayCandidates: [candidate] });
  const sweep = await runBirthdayJ30Sweep('libramont', depsSweep, { today: iso(0) });
  ok(sweep.enqueued === 1 && depsSweep.state.enqueued[0].subject === 'Bientôt la fête de Famille', 'sweep anniversaire : sujet custom appliqué');
  const rCands = Array.from({ length: 7 }, (_, i) => ({ client_key: `+3247011${i}`, email: `c${i}@test.be`, name: `Client ${i}`, last_visit: iso(-70) }));
  const depsReact = makeDeps({ settings: { reactivation: { enabled: true, cap: 5 } }, reactivationCandidates: rCands });
  const react = await runReactivationSweep('libramont', depsReact, { today: iso(0) });
  ok(react.enqueued === 5, `cap du gérant respecté : 7 candidats, cap 5 → 5 envois (obtenu ${react.enqueued})`);
  const depsReactExplicit = makeDeps({ settings: { reactivation: { enabled: true, cap: 5 } }, reactivationCandidates: rCands });
  const reactExplicit = await runReactivationSweep('libramont', depsReactExplicit, { today: iso(0), cap: 1 });
  ok(reactExplicit.enqueued === 1, 'cap explicite (tests/cron) prioritaire sur le réglage');

  console.log('\n[SENDDIRECT] composer libre + boucle inbox (répondu + leçon)');
  let rejected = false;
  try { await sendDirectEmail({ to: 'pas-un-email', subject: 'a', body: 'b' }, makeDeps({})); } catch (error) { rejected = true; }
  ok(rejected, 'email invalide → rejeté');
  const depsSend = makeDeps({});
  await sendDirectEmail({ centerId: 'libramont', to: 'georges@test.be', name: 'Georges Dupuis', subject: 'Hello', body: 'Corps du message', identityId: 3 }, depsSend);
  const sentRow = depsSend.state.enqueued[0];
  ok(sentRow.payload.direct === true && sentRow.payload.clientKey === 'georges@test.be' && sentRow.payload.identityId === 3, 'payload direct : clientKey + identité tracés');
  const proposal = { subject: 'Nos tarifs — Fun Galaxy', body: 'Bonjour,\n\nRéponse proposée standard de l\'agent.' };
  const depsReply = makeDeps({ inboundRow: { textBody: 'Combien pour 8 ?', analysis: { intent: 'prix', reply: proposal } } });
  await sendDirectEmail({
    centerId: 'libramont', to: 'client@test.be', subject: 'Nos tarifs — Fun Galaxy',
    body: 'Bonjour Marie, pour 8 personnes voici comment on fait : on vous confirme le tarif exact par retour, promis vite.',
    replyToCommunicationId: 42,
  }, depsReply);
  const merge = depsReply.state.payloadMerges[0];
  ok(Boolean(merge) && Number(merge[0]) === 42 && JSON.parse(merge[1]).repliedAt, 'inbound marqué répondu (repliedAt)');
  ok(depsReply.state.memoryInserts.length === 1, 'réponse modifiée par le staff → leçon apprise');
  const depsReplySame = makeDeps({ inboundRow: { textBody: 'Combien pour 8 ?', analysis: { intent: 'prix', reply: proposal } } });
  await sendDirectEmail({ centerId: 'libramont', to: 'client@test.be', subject: proposal.subject, body: proposal.body, replyToCommunicationId: 43 }, depsReplySame);
  ok(depsReplySame.state.memoryInserts.length === 0 && depsReplySame.state.payloadMerges.length === 1, 'réponse envoyée telle quelle → répondu marqué, PAS de leçon');

  console.log('\n[INGEST] boîte de réception (collage manuel / webhook)');
  const depsIngest = makeDeps({});
  const ingested = await ingestInboundEmail({ centerId: 'libramont', from: 'client@test.be', subject: 'Prix ?', body: 'Combien pour 8 personnes ?', deps: depsIngest });
  const inboundRow = depsIngest.state.enqueued[0];
  ok(inboundRow.direction === 'inbound' && inboundRow.status === 'received' && inboundRow.templateId === 'inbound_email', 'communication inbound status received');
  ok(ingested.analysis.intent === 'prix' && inboundRow.payload.analysis.intent === 'prix', 'analyse stockée dans le payload');
  ok(String(inboundRow.idempotencyKey || '').startsWith('inbound:libramont:client@test.be'), 'clé d\'idempotence posée');
  const depsIngestDupe = makeDeps({ inboundDupe: true });
  const deduped = await ingestInboundEmail({ centerId: 'libramont', from: 'client@test.be', subject: 'Prix ?', body: 'Combien ?', deps: depsIngestDupe });
  ok(deduped.deduped === true && depsIngestDupe.state.enqueued.length === 0, 'même mail re-reçu → dédupliqué, zéro doublon');

  console.log('\n[WEBHOOK] /api/inbound-email (secret + Resend + payload plat)');
  process.env.INBOUND_EMAIL_SECRET = 'test-secret';
  const calls = [];
  const handler = createHandler({ ingest: async (input) => { calls.push(input); return { communication: { id: 9 }, analysis: { intent: 'reservation' }, deduped: false }; } });
  const fakeReq = (payload, secret) => ({
    method: 'POST',
    url: '/api/inbound-email?centerId=libramont',
    headers: { 'x-inbound-secret': secret, host: 'test.local' },
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(payload)); },
  });
  const fakeRes = () => { const res = { statusCode: 0, headers: {}, body: '' }; res.setHeader = (k, v) => { res.headers[k] = v; }; res.end = (b) => { res.body = String(b || ''); }; return res; };

  const resBad = fakeRes();
  await handler(fakeReq({ from: 'a@b.be', text: 'x' }, 'mauvais-secret'), resBad);
  ok(resBad.statusCode === 401, 'secret invalide → 401');
  const resResend = fakeRes();
  await handler(fakeReq({ type: 'email.received', data: { from: 'Marie Dupont <marie@test.be>', subject: 'Résa', text: 'Je veux réserver vendredi.' } }, 'test-secret'), resResend);
  ok(resResend.statusCode === 200 && calls.length === 1, 'enveloppe Resend → 200 + ingestion');
  ok(calls[0].from === 'marie@test.be' && calls[0].fromName === 'Marie Dupont' && calls[0].centerId === 'libramont', 'adresse « Nom <email> » proprement extraite');
  const resFlat = fakeRes();
  await handler(fakeReq({ from: 'x@y.be', subject: 'Sans texte' }, 'test-secret'), resFlat);
  ok(resFlat.statusCode === 400, 'payload sans texte → 400');
  delete process.env.INBOUND_EMAIL_SECRET;
  const resNoSecret = fakeRes();
  await handler(fakeReq({ from: 'a@b.be', text: 'x' }, 'test-secret'), resNoSecret);
  ok(resNoSecret.statusCode === 401, 'INBOUND_EMAIL_SECRET non configuré → tout refusé');

  restoreEnv();
  if (failures) { console.error(`\nemail-agent-check: ${failures} FAIL`); process.exit(1); }
  console.log('\nemail-agent-check: ALL OK');
})().catch((error) => { restoreEnv(); console.error('email-agent-check CRASH:', error.stack || error.message); process.exit(1); });

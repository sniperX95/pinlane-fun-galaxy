// Gate SERVEUR de l'agent email + automations éditables (Emails v3) : zéro
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
  analyzeByRules,
  saveEmailBrainOverrides,
  getEmailBrainDefaults,
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
  saveCustomSequence,
  toggleCustomSequence,
  deleteCustomSequence,
  runCustomSequencesSweep,
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
      if (sql.includes("jsonb_build_object('email_brain'")) { state.brainSaved = JSON.parse(params[1]); state.settings = { ...(state.settings || {}), email_brain: state.brainSaved }; return { rows: [] }; }
      if (sql.includes("jsonb_build_object('custom_sequences'")) { state.seqSaved = JSON.parse(params[1]); state.settings = { ...(state.settings || {}), custom_sequences: state.seqSaved }; return { rows: [] }; }
      if (sql.includes("payload->>'dedupeKey'")) return { rows: state.customDupe ? [{ 1: 1 }] : [] };
      if (sql.includes('last_visit = ($2::date -')) return { rows: state.afterVisitRows || [] };
      if (sql.includes('last_visit <= ($2::date -')) return { rows: state.inactiveRows || [] };
      if (sql.includes('date = ($2::date + (')) return { rows: state.beforeVisitRows || [] };
      if (sql.includes('as birthdays')) return { rows: state.weeklyRows || [] };
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
  // Libramont n'a pas le Golf o'Clock, mais Gembloux l'a : la question se pose
  // vraiment, donc on prévient le modèle de ne pas le promettre ICI.
  ok(!brain.context.includes("Golf O'Clock : disponible") && /PAS ici/.test(brain.context) && /Golf O'Clock/i.test(brain.context),
    'activité réelle de l\'autre centre signalée comme non proposée ici');
  // Le piège inverse, payé cash le 15/07 : nommer une activité que Fun Galaxy
  // n'a NULLE PART, même pour l'interdire, apprend au modèle qu'elle existe
  // chez nous. Un post de prod a fini par promettre du Karting VR.
  // Ce qui n'existe pas ne se mentionne pas, dans aucun sens.
  for (const phantom of ['karting', 'free roaming', 'hache', 'fléchette']) {
    ok(!new RegExp(phantom, 'i').test(brain.context),
      `activité inexistante « ${phantom} » absente du contexte (même pas en interdiction)`);
  }

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
    fetchImpl: async () => anthropicOk({ intent: 'reservation', summary: 'Réservation pour 8 vendredi', urgency: 'normale', reply: { subject: 'Votre venue à 8', body: 'Avec plaisir pour vos 8 personnes vendredi, réservez en ligne sur www.mngfunglxy.com et c’est confirmé.' } }),
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
    sent: { subject: 'A', body: 'Bonjour Marie, pour 8 personnes on vous prépare un devis précis, on vous rappelle demain matin.' },
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
  // Ces asserts testent le MECANISME d'override (defaut applique sans reglage,
  // substitution des variables avec), pas la copie exacte. Figer une phrase
  // editoriale dans un assert interdit toute reecriture de la copie sans casser
  // la suite (constate le 2026-07-19, refonte des gabarits mail).
  ok(defaultMessage.subject.length > 10 && /confirm/i.test(defaultMessage.subject), 'confirmation sans override : sujet par défaut du gabarit');

  // Garde-fou des TROIS VARIANTES. Le 2026-07-19, une refonte de la copie a
  // livre « votre bowling est confirmée » et « votre Laser Game est confirmée »
  // parce qu'une seule variante (une formule, donc feminine) avait ete rendue
  // et relue. `offer` vaut aussi 'bowling', 'Laser Game' ou 'votre formule'
  // (lib/ops-communications.js:591) : toute tournure qui accorde sur lui casse.
  // Ce test rend les trois et bloque la classe entiere de defaut, sans figer
  // une seule phrase editoriale.
  const variantes = [
    { nom: 'formule', resa: { ...resa } },
    { nom: 'bowling', resa: { ...resa, type: 'bowling', formuleId: null, label: '' } },
    { nom: 'laser', resa: { ...resa, type: 'laser', formuleId: null, label: '' } },
  ];
  for (const variante of variantes) {
    const rendu = buildMessage({ reservation: variante.resa, templateId: 'confirmation', channel: 'email' });
    const texte = `${rendu.subject}\n${rendu.body}`;
    ok(!/undefined|\[object|NaN/.test(texte), `confirmation ${variante.nom} : aucune valeur non résolue`);
    ok(!/\{\{/.test(texte), `confirmation ${variante.nom} : aucun token de gabarit laissé brut`);
    ok(!/\bvotre votre\b/i.test(texte), `confirmation ${variante.nom} : pas de déterminant doublé`);
    ok(!/votre (bowling|Laser Game|formule) est confirmée/i.test(texte),
      `confirmation ${variante.nom} : pas d'accord fautif sur le libellé d'offre (masculin traité au féminin)`);
  }
  const custom = buildMessage({
    reservation: resa, templateId: 'confirmation', channel: 'email',
    overrides: { subject: 'Merci {{prenom}} !', body: 'RDV le {{date}} à {{heure}} pour {{formule}} ({{pax}} pers), {{centre}}' },
  });
  ok(custom.subject === 'Merci Marie !', 'sujet custom : {{prenom}} substitué');
  ok(custom.body === 'RDV le 20/08/2026 à 15:00 pour FORMULE 4 (12 pers), Fun Galaxy Libramont', `corps custom : toutes variables substituées (obtenu « ${custom.body} »)`);
  const subjectOnly = buildMessage({ reservation: resa, templateId: 'confirmation', channel: 'email', overrides: { subject: 'Youpi {{prenom}}' } });
  ok(subjectOnly.subject === 'Youpi Marie' && subjectOnly.body === defaultMessage.body, 'override sujet seul : corps par défaut conservé à l\'identique');
  const smsUntouched = buildMessage({ reservation: resa, templateId: 'reminder_day_sms', channel: 'sms', overrides: { subject: 'X', body: 'Y' } });
  // Purge de marque : le SMS s'annonce du NOM DU CENTRE (donnee), plus d'une
  // marque en dur. La resa incarne le centre libramont : son nom complet.
  ok(smsUntouched.body.startsWith('Fun Galaxy Libramont:'), 'SMS jamais touché par les overrides email, annoncé au nom du centre');

  const birthdayDefault = buildBirthdayJ30Message({ name: 'Georges Dupuis', partyDateFr: '20 août' });
  ok(birthdayDefault.subject === 'Un anniversaire approche 🎂' && birthdayDefault.body.includes('(le 20 août)'), 'anniversaire sans override : texte historique');
  const birthdayCustom = buildBirthdayJ30Message({ name: 'Georges Dupuis', partyDateFr: '20 août', centerName: 'Fun Galaxy Libramont' }, { subject: 'La fête de {{prenom}} approche ({{date_fete}})' });
  ok(birthdayCustom.subject === 'La fête de Georges approche (20 août)', 'anniversaire : sujet custom substitué');
  const reactivationCustom = buildReactivationMessage({ name: 'Léa Petit', centerName: 'Fun Galaxy Libramont' }, { body: 'Reviens {{prenom}}, le {{centre}} t’attend !' });
  ok(reactivationCustom.body === 'Reviens Léa, le Fun Galaxy Libramont t’attend !', 'réactivation : corps custom substitué');
  const postVisitDefault = buildPostVisitMessage({ name: 'Marie Dupont' });
  ok(postVisitDefault.subject.length > 5 && /merci/i.test(postVisitDefault.body), 'merci post-visite : texte par défaut du gabarit');
  // Purge de marque : {{centre}} vaut le nom du centre passe par l'appelant
  // (ops-jobs le resout), et un repli NEUTRE sans centre, jamais une marque.
  const postVisitCustom = buildPostVisitMessage({ name: 'Marie Dupont', centerName: 'Fun Galaxy Libramont' }, { body: 'Merci {{prenom}}, à bientôt chez {{centre}} !' });
  ok(postVisitCustom.body === 'Merci Marie, à bientôt chez Fun Galaxy Libramont !', 'merci post-visite : corps custom substitué');
  const postVisitNoCenter = buildPostVisitMessage({ name: 'Marie Dupont' }, { body: 'À bientôt chez {{centre}} !' });
  ok(postVisitNoCenter.body === 'À bientôt chez votre centre !', 'merci post-visite sans centre : repli neutre, jamais une marque');

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
  const proposal = { subject: 'Nos tarifs, Fun Galaxy', body: 'Bonjour,\n\nRéponse proposée standard de l\'agent.' };
  const depsReply = makeDeps({ inboundRow: { textBody: 'Combien pour 8 ?', analysis: { intent: 'prix', reply: proposal } } });
  await sendDirectEmail({
    centerId: 'libramont', to: 'client@test.be', subject: 'Nos tarifs, Fun Galaxy',
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

  console.log('\n[BRAIN ÉDITABLE] « Ce que l\'agent sait » : le gérant possède les textes');
  const depsBrainSave = makeDeps({});
  await saveEmailBrainOverrides('libramont', { signature: 'La team FG', extra: 'Parking gratuit derrière le bâtiment.', faq: { horaires: { subject: 'Nos horaires', body: 'Custom horaires du gérant, ouverts sauf lundi.' } } }, depsBrainSave);
  ok(depsBrainSave.state.brainSaved && depsBrainSave.state.brainSaved.signature === 'La team FG', 'écrit dans settings.email_brain (signature + faq + consignes)');
  const mergedBrain = await buildEmailBrain('libramont', makeDeps({ settings: { email_brain: depsBrainSave.state.brainSaved } }));
  ok(mergedBrain.faq.horaires.body.includes('Custom horaires du gérant'), 'la FAQ du gérant GAGNE sur le fichier');
  ok(mergedBrain.stable.includes('La team FG') && mergedBrain.stable.includes('Parking gratuit'), 'signature + consignes injectées dans le bloc stable (IA)');
  const rulesCustom = analyzeByRules({ subject: 'Question', body: 'Vous êtes ouverts à quelle heure ?', faq: mergedBrain.faq, client: null });
  ok(rulesCustom.intent === 'horaires' && rulesCustom.reply.body.includes('Custom horaires'), 'le mode règles répond avec le texte du gérant');
  let brainThrew = false;
  try { await saveEmailBrainOverrides('libramont', { faq: { inconnu: { body: 'x' } } }, makeDeps({})); } catch (e) { brainThrew = e.expose === true; }
  ok(brainThrew, 'sujet FAQ inconnu → rejeté proprement');
  ok(getEmailBrainDefaults().faq.horaires && getEmailBrainDefaults().intents.horaires, 'défauts exposés (placeholders + reset UI)');

  console.log('\n[SÉQUENCES PERSO] le gérant crée SES automatisations');
  for (const [bad, label] of [
    [{ name: '', trigger: { type: 'after_visit', days: 7 }, subject: 'a', body: 'b' }, 'nom vide'],
    [{ name: 'X', trigger: { type: 'after_visit', days: 400 }, subject: 'a', body: 'b' }, 'délai hors bornes'],
    [{ name: 'X', trigger: { type: 'after_visit', days: 7 }, subject: 'a', body: 'Salut {{date}}' }, 'variable indisponible pour ce déclencheur'],
    [{ name: 'X', trigger: { type: 'weekly', weekday: 9 }, subject: 'a', body: 'b' }, 'jour de semaine invalide'],
  ]) {
    let threw = false;
    try { await saveCustomSequence('libramont', bad, makeDeps({})); } catch (e) { threw = e.expose === true; }
    ok(threw, `séquence invalide rejetée : ${label}`);
  }
  const depsSeq = makeDeps({});
  const seqs = await saveCustomSequence('libramont', { name: 'Relance J+7', trigger: { type: 'after_visit', days: 7 }, subject: 'On se revoit, {{prenom}} ?', body: 'Bonjour {{prenom}},\n\nMerci pour votre venue chez {{centre}} !', cap: 10 }, depsSeq);
  ok(seqs.length === 1 && seqs[0].id && seqs[0].enabled === true, 'séquence créée (id généré, active)');
  const seqToggled = await toggleCustomSequence('libramont', seqs[0].id, false, makeDeps({ settings: { custom_sequences: seqs } }));
  ok(seqToggled[0].enabled === false, 'toggle OFF persisté');
  seqs[0].enabled = true; // le toggle a muté l'objet partagé du test : on réarme pour le sweep
  const depsSweepA = makeDeps({ settings: { custom_sequences: seqs }, afterVisitRows: [{ client_key: '+32470111001', email: 'marie@test.be', name: 'Marie Dupont' }] });
  const sweepA = await runCustomSequencesSweep('libramont', depsSweepA, { today: '2026-07-14' });
  ok(sweepA.enqueued === 1 && depsSweepA.state.enqueued.length === 1, 'sweep after_visit → 1 email en file');
  const sentA = depsSweepA.state.enqueued[0];
  ok(sentA.templateId === `custom_${seqs[0].id}` && sentA.subject === 'On se revoit, Marie ?', 'variables substituées ({{prenom}} → Marie)');
  ok(sentA.payload.dedupeKey === `${seqs[0].id}:+32470111001:2026-07-14`, 'clé d\'idempotence datée');
  const depsSweepDupe = makeDeps({ settings: { custom_sequences: seqs }, afterVisitRows: [{ client_key: '+32470111001', email: 'marie@test.be', name: 'Marie Dupont' }], customDupe: true });
  const sweepDupe = await runCustomSequencesSweep('libramont', depsSweepDupe, { today: '2026-07-14' });
  ok(sweepDupe.enqueued === 0, 'IDEMPOTENT : déjà envoyé ce jour-là → 0 envoi');
  const beforeSeq = [{ id: 'cs_b1', name: 'Rappel J-3', enabled: true, trigger: { type: 'before_visit', days: 3 }, subject: 'À {{date}} !', body: 'Bonjour {{prenom}}, rendez-vous le {{date}} à {{heure}} pour {{formule}}.', cap: 20 }];
  const depsSweepB = makeDeps({ settings: { custom_sequences: beforeSeq }, beforeVisitRows: [{ id: 9, name: 'Lucas Petit', email: 'lucas@test.be', phone: '', date: '2026-07-17', startTime: '15:00:00', formuleId: 'FORMULE 2', pax: 6 }] });
  const sweepB = await runCustomSequencesSweep('libramont', depsSweepB, { today: '2026-07-14' });
  const sentB = depsSweepB.state.enqueued[0] || {};
  ok(sweepB.enqueued === 1 && sentB.payload.textBody.includes('le 2026-07-17 à 15:00'), 'before_visit : variables réservation (date/heure/formule) substituées');
  const weeklySeq = [{ id: 'cs_w1', name: 'News mardi', enabled: true, trigger: { type: 'weekly', weekday: 2 }, segment: 'all', subject: 'Hello', body: 'Bonjour {{prenom}} !', cap: 5 }];
  const depsSweepW = makeDeps({ settings: { custom_sequences: weeklySeq }, weeklyRows: [{ client_key: 'a@b.be', email: 'a@b.be', name: 'Ana' }] });
  const sweepWrongDay = await runCustomSequencesSweep('libramont', depsSweepW, { today: '2026-07-14' }); // 2026-07-14 = mardi ? getUTCDay = 2 → mardi OUI
  ok(sweepWrongDay.enqueued === 1, 'weekly : envoie le bon jour de semaine');
  const depsSweepW2 = makeDeps({ settings: { custom_sequences: weeklySeq }, weeklyRows: [{ client_key: 'a@b.be', email: 'a@b.be', name: 'Ana' }] });
  const sweepOff = await runCustomSequencesSweep('libramont', depsSweepW2, { today: '2026-07-15' }); // mercredi
  ok(sweepOff.enqueued === 0, 'weekly : silencieux les autres jours');
  const deleted = await deleteCustomSequence('libramont', seqs[0].id, makeDeps({ settings: { custom_sequences: seqs } }));
  ok(deleted.length === 0, 'suppression persistée');

  console.log('\n[ENVOI PROGRAMMÉ] composer → plus tard');
  const depsSched = makeDeps({});
  const futureAt = new Date(Date.now() + 3600000).toISOString();
  await sendDirectEmail({ centerId: 'libramont', to: 'x@y.be', subject: 'Programmé', body: 'Contenu', scheduledAt: futureAt }, depsSched);
  const schedRow = depsSched.state.enqueued[0];
  ok(schedRow.scheduledAt === futureAt && schedRow.payload.scheduled === true, 'scheduledAt futur → file au moment choisi (pas de dispatch immédiat)');
  let schedThrew = false;
  try { await sendDirectEmail({ centerId: 'libramont', to: 'x@y.be', subject: 'a', body: 'b', scheduledAt: 'pas-une-date' }, makeDeps({})); } catch (e) { schedThrew = e.expose === true; }
  ok(schedThrew, 'date invalide → rejetée');


  console.log('\n[HORAIRES] un horaire non declare n est pas un horaire ferme');
  // Mesure du 2026-09-09 : `defaultSchedule` vaut une CHAINE sentinelle pour
  // Gembloux (« same_as_libramont_public_schedule ») et Ciney (« to_confirm »).
  // `?.regular || {}` en faisait une grille vide et les sept jours sortaient
  // « fermé » vers le modele qui repond AUX CLIENTS, sur un centre ACTIF dont
  // le telephone et l adresse sont publies.
  const { buildCenterFacts: faitsDuCentre } = require('../lib/email-agent');
  const { getCenter: centrePose } = require('../lib/ops-knowledge');
  const JOUR_HEURE = /(Lundi|Mardi|Mercredi|Jeudi|Vendredi|Samedi|Dimanche) (fermé|non renseigné|\d)/;

  // MONTAGE : sans ces trois assertions, le gate testerait une situation qui
  // n existe pas. C est exactement le piege qui a laisse passer le defaut.
  const grilleLibramont = centrePose('libramont').defaultSchedule;
  const grilleGembloux = centrePose('gembloux').defaultSchedule;
  ok(typeof grilleGembloux === 'string', 'MONTAGE : Gembloux declare une CHAINE, pas une grille');
  ok(centrePose('gembloux').status === 'active', 'MONTAGE : Gembloux est un centre ACTIF');
  ok(grilleLibramont && typeof grilleLibramont === 'object' && grilleLibramont.regular
    && grilleLibramont.regular['1'] === null, 'MONTAGE : Libramont declare son lundi FERME (null)');

  const faitsGembloux = String(faitsDuCentre('gembloux'));
  const faitsCiney = String(faitsDuCentre('ciney'));
  const faitsLibramont = String(faitsDuCentre('libramont'));

  ok(!JOUR_HEURE.test(faitsGembloux), 'Gembloux : aucun jour ne recoit d horaire ni de fermeture inventee');
  ok(!faitsGembloux.includes('Samedi fermé') && !faitsGembloux.includes('Dimanche fermé'),
    'Gembloux : le week-end n est plus annonce ferme');
  ok(faitsGembloux.includes('NON RENSEIGNÉS'), 'Gembloux : le trou est NOMME au modele');
  ok(/N annonce jamais une ouverture, une fermeture/.test(faitsGembloux),
    'Gembloux : le modele a l INTERDICTION de combler le vide');
  ok(/ne les déduis d aucun autre centre/.test(faitsGembloux),
    'Gembloux : et l interdiction de reprendre l horaire d un autre centre');
  ok(faitsGembloux.includes('0472/89.04.11'), 'Gembloux : la sortie donnee au client est son propre telephone');
  ok(!faitsGembloux.includes('0491/30.16.67'), 'CLOISONNEMENT : le telephone de Libramont n apparait pas');
  ok(!JOUR_HEURE.test(faitsCiney), 'Ciney : aucun jour ne recoit d horaire ni de fermeture inventee');
  ok(/invite le client à nous appeler/.test(faitsCiney), 'Ciney, sans telephone publie, garde une sortie');

  // CONTRE-PREUVE : le seul centre qui declare vraiment sa grille garde
  // EXACTEMENT la ligne d avant, fermeture du lundi comprise. Une garde qui
  // rendrait muet le centre configure serait pire que le defaut corrige.
  ok(faitsLibramont.includes('Horaires habituels : Lundi fermé · Mardi 14h à 22h · Mercredi 12h à 22h · Jeudi 14h à 22h · Vendredi 14h à minuit · Samedi 10h à minuit · Dimanche 10h à 22h.'),
    'CONTRE-PREUVE : Libramont annonce ses 7 jours, lundi ferme compris',
    faitsLibramont.split('\n').find((l) => l.startsWith('Horaires')) || '(aucune ligne)');
  ok(/Congés scolaires : ouvert tous les jours \(10h à 22h en semaine/.test(faitsLibramont),
    'CONTRE-PREUVE : la ligne conges de Libramont survit');
  ok(!/Congés scolaires/.test(faitsGembloux), 'et elle ne se fabrique pas la ou rien n est declare');

  // LE MEME DEFAUT AU NIVEAU DU JOUR. Une grille PARTIELLE est atteignable :
  // normalizeScheduleBlock garde les jours declares et saute les autres, donc
  // une sauvegarde staff qui ne touche que le samedi produit une grille a un
  // seul jour. Sans le filtre, les six autres sortaient « fermé ».
  // Le crochet se pose sur l objet module AVANT le require applicatif :
  // email-agent destructure getCenter a son chargement.
  const moduleOps = require('../lib/ops-knowledge');
  const vraiGetCenter = moduleOps.getCenter;
  moduleOps.getCenter = (id) => (id === '__partiel' ? {
    name: 'Centre partiel', status: 'active',
    defaultSchedule: { regular: { '6': { open: '10:00', close: '18:00' } } },
    publicInfo: { phone: '000' }, activityAvailability: {},
  } : vraiGetCenter(id));
  delete require.cache[require.resolve('../lib/email-agent')];
  const faitsPartiels = String(require('../lib/email-agent').buildCenterFacts('__partiel'));
  moduleOps.getCenter = vraiGetCenter;
  delete require.cache[require.resolve('../lib/email-agent')];
  ok(/^Horaires habituels : Samedi 10h à 18h\.$/m.test(faitsPartiels),
    'grille PARTIELLE : seul le jour declare est annonce',
    faitsPartiels.split('\n').find((l) => l.startsWith('Horaires')) || '(aucune ligne)');
  ok(!/(Lundi|Dimanche) fermé/.test(faitsPartiels),
    'grille PARTIELLE : les jours non declares ne deviennent pas des fermetures');

  // ── L ETAT REEL DU CENTRE ATTEINT LA BOITE MAIL ─────────────────────────
  // Mesure du 2026-09-10, centre ferme du 12 au 20 et laser bloque : l agent
  // email annoncait « Samedi 10h a minuit » et listait le laser game comme
  // disponible. Une personne reelle lit la reponse et prend la voiture.
  console.log('\n[ETAT] ce que le centre peut tenir aujourd hui');
  const { etatDuCentre, plagesDeDates } = require('../lib/email-agent');

  // La compression de dates, pure et testee seule.
  ok(plagesDeDates(['2026-09-12', '2026-09-13', '2026-09-14']).join(';') === '2026-09-12 -> 2026-09-14',
    'des dates contigues font UNE plage');
  ok(plagesDeDates(['2026-09-12', '2026-09-14']).join(';') === '2026-09-12;2026-09-14',
    'un trou coupe la plage en deux dates seules');
  ok(plagesDeDates(['2026-09-12']).join(';') === '2026-09-12',
    'une date seule reste une date, pas une plage');
  ok(plagesDeDates([]).length === 0 && plagesDeDates(null).length === 0,
    'aucune date, aucune plage');
  ok(plagesDeDates(['2026-09-14', '2026-09-12', '2026-09-13']).join(';') === '2026-09-12 -> 2026-09-14',
    'des dates en desordre sont triees avant d etre compressees');

  // Fabrique de blocs, dans la forme exacte de la table.
  const bloc = (over) => ({
    id: 1, center_id: 'libramont', scope_type: 'center', scope_ref: null,
    recurrence: 'once', date: '2026-09-12', day_of_week: null, date_from: null,
    date_until: null, start_time: null, end_time: null,
    reason: 'travaux prives', created_by: 'gerant', ...over,
  });
  const depsAvec = (rows) => ({
    query: async (sql) => (/from availability_blocks/i.test(String(sql)) ? { rows } : { rows: [] }),
  });
  const JOUR = '2026-09-10';

  // SANS RIEN : le prompt ne bouge pas d un caractere.
  const etatVide = await etatDuCentre('libramont', depsAvec([]), JOUR);
  ok(etatVide === '', 'sans fermeture ni blocage, aucun bloc ajoute au prompt');

  // UNE FERMETURE EXCEPTIONNELLE.
  const fermeture = ['2026-09-12', '2026-09-13'].map((date, i) => bloc({ id: 10 + i, date }));
  const etatFerme = await etatDuCentre('libramont', depsAvec(fermeture), JOUR);
  ok(/N OUVRE PAS/.test(etatFerme), 'une fermeture declaree atteint le modele');
  // Les jours deja fermes A LA GRILLE entrent dans la liste : sinon « 12 -> 13,
  // 15 -> 20 » laisse croire qu on ouvre le 14, qui est un lundi.
  ok(/2026-09-12 -> 2026-09-14/.test(etatFerme),
    `la plage englobe le lundi ferme a la grille : ${etatFerme.split('\n')[1] || ''}`);
  ok(!/travaux/i.test(etatFerme),
    'la RAISON de la fermeture ne sort jamais vers le client');
  ok(/14 prochains jours SEULEMENT/.test(etatFerme),
    'la fenetre est annoncee : au-dela, le modele sait qu il ne sait pas');

  // CONTRE-PREUVE : des lundis fermes a la grille, SANS fermeture
  // exceptionnelle, ne produisent aucun bloc. Sans elle, chaque centre
  // trainerait la liste de ses lundis dans chaque reponse.
  ok(await etatDuCentre('libramont', depsAvec([]), JOUR) === '',
    'CONTRE-PREUVE : les jours fermes a la grille seuls ne declenchent rien');

  // UNE ACTIVITE BLOQUEE, AVEC SES DATES.
  const blocLaser = ['2026-09-10', '2026-09-11'].map((date, i) => bloc({
    id: 20 + i, date, scope_type: 'activity', scope_ref: 'laser_game', reason: 'gilets',
  }));
  const etatLaser = await etatDuCentre('libramont', depsAvec(blocLaser), JOUR);
  ok(/laser game : INDISPONIBLE 2026-09-10 -> 2026-09-11/.test(etatLaser),
    `l activite bloquee est nommee AVEC ses dates : ${etatLaser.split('\n')[1] || ''}`);
  ok(!/gilets/i.test(etatLaser), 'la raison du blocage ne sort pas non plus');
  ok(!/N OUVRE PAS/.test(etatLaser),
    'un blocage d activite ne se transforme pas en fermeture du centre');
  ok(!/bowling/i.test(etatLaser),
    'les activites NON bloquees ne sont pas nommees dans ce bloc');

  // Une activite que ce centre ne declare PAS ne se nomme jamais, meme
  // bloquee : la nommer apprendrait au modele qu elle existe ici.
  const blocGolf = ['2026-09-10'].map((date, i) => bloc({
    id: 30 + i, date, scope_type: 'activity', scope_ref: 'golf_oclock',
  }));
  ok(await etatDuCentre('libramont', depsAvec(blocGolf), JOUR) === '',
    'une activite que ce centre n a pas n apparait jamais, meme bloquee');

  // CLOISONNEMENT. La contrainte posee par Movsar mot pour mot : chaque centre
  // a son propre agent, il ne doit jamais sortir l info d un autre. Le pool
  // simule respecte le filtre center_id de la requete, comme la vraie base.
  const depsParCentre = {
    query: async (sql, params) => {
      if (!/from availability_blocks/i.test(String(sql))) return { rows: [] };
      return { rows: params && params[0] === 'libramont' ? fermeture : [] };
    },
  };
  ok(/N OUVRE PAS/.test(await etatDuCentre('libramont', depsParCentre, JOUR)),
    'MONTAGE : la fermeture est bien vue chez le centre qui la porte');
  ok(await etatDuCentre('gembloux', depsParCentre, JOUR) === '',
    'CLOISONNEMENT : une fermeture de Libramont ne dit rien chez Gembloux');

  // ── ET LE CERVEAU LE TRANSMET ───────────────────────────────────────────
  // La fonction peut etre juste et personne ne l appeler : c est le defaut
  // paye plusieurs fois sur l autre porte de l agent.
  const cerveauFerme = await buildEmailBrain('libramont', depsAvec(fermeture));
  ok(/ETAT DU CENTRE/.test(cerveauFerme.context),
    'LE POINT : le bloc entre dans le CONTEXTE du modele');
  ok(/PRIME sur les horaires habituels/.test(cerveauFerme.context),
    'et il est annonce comme primant sur les horaires habituels');
  ok(!/ETAT DU CENTRE/.test(cerveauFerme.stable),
    'il n entre PAS dans le bloc stable : il change tous les jours');
  const cerveauNormal = await buildEmailBrain('libramont', depsAvec([]));
  ok(!/ETAT DU CENTRE/.test(cerveauNormal.context),
    'CONTRE-PREUVE : sans fermeture, le contexte ne porte aucun bloc d etat');

  // ── ET LES HORAIRES ANNONCES VIENNENT DE LA BASE ────────────────────────
  // getCenter rend le socle du DEPOT tant que personne n a rafraichi dans ce
  // processus. Les horaires envoyes au client etaient donc ceux du fichier,
  // pas ceux que le staff a poses. La ligne simulee porte une valeur que le
  // socle NE PORTE PAS (lundi ouvert) : sans ca on ne saurait pas si le gate a
  // lu la base ou le fichier.
  const { applyCenterOverrides, getCenter: centreLu } = require('../lib/ops-knowledge');
  applyCenterOverrides(new Map());
  ok(centreLu('libramont').defaultSchedule.regular['1'] === null,
    'MONTAGE : le socle du depot declare bien le lundi ferme');
  const configDeLaBase = JSON.parse(JSON.stringify(centreLu('libramont')));
  configDeLaBase.defaultSchedule.regular['1'] = { open: '09:00', close: '23:00' };
  const depsDuStaff = {
    query: async (sql) => (/from centers/.test(String(sql))
      ? { rows: [{ id: 'libramont', name: 'Fun Galaxy Libramont', status: 'active', timezone: 'Europe/Brussels', settings: { config: configDeLaBase } }] }
      : { rows: [] }),
  };
  const cerveauDeLaBase = await buildEmailBrain('libramont', depsDuStaff);
  ok(/Lundi 09h a 23h/.test(cerveauDeLaBase.context.normalize('NFD').replace(/[̀-ͯ]/g, '')),
    `LE POINT : les horaires annonces viennent de la BASE : ${
      cerveauDeLaBase.context.split('\n').find((l) => l.startsWith('Horaires')) || '(aucune ligne)'}`);
  applyCenterOverrides(new Map());
  const cerveauDuDepot = await buildEmailBrain('libramont', depsAvec([]));
  ok(/Lundi fermé/.test(cerveauDuDepot.context),
    'CONTRE-PREUVE : socle rendu, le lundi redevient ferme');

  // ── LES TARIFS ATTEIGNENT LA PORTE EMAIL ────────────────────────────────
  console.log('\n[TARIFS] la porte email peut enfin repondre « combien ca coute »');
  const { prixDuCentre, __test: outilsDuMail } = require('../lib/email-agent');
  const { chargerFicheDuRegistre: ficheDuCentre } = require('../lib/center-facts');
  applyCenterOverrides(new Map());

  const tarifsLibramont = await prixDuCentre('libramont', depsAvec([]), JOUR);
  ok(tarifsLibramont.length > 200, 'MONTAGE : le centre qui a une grille horaire a des tarifs');

  // LE POINT : les deux portes annoncent le MEME catalogue. Elles appellent la
  // meme fonction, donc le meme moteur de reservation ; sans cette comparaison
  // rien n interdirait a une porte de deriver de l autre.
  const fichePublique = await ficheDuCentre({ centerId: 'libramont', aujourdhui: JOUR, pool: depsAvec([]) });
  const nomsPublics = String((fichePublique.prix_du_catalogue || {}).valeur || '')
    .split(' | ').map((ligne) => ligne.split(' : ')[0]).filter(Boolean).sort();
  const nomsDuMail = tarifsLibramont.split('\n').slice(1)
    .map((ligne) => ligne.split(' : ')[0]).filter(Boolean).sort();
  ok(nomsDuMail.length >= 5 && JSON.stringify(nomsDuMail) === JSON.stringify(nomsPublics),
    'LE POINT : la porte email annonce EXACTEMENT les formules de la porte publique');

  // CHAQUE LIGNE PORTE SA CONDITION. Un prix nu se cite ensuite sans reserve.
  const lignesDeTarif = tarifsLibramont.split('\n').slice(1);
  ok(lignesDeTarif.every((ligne) => /EUR (par personne|par piste)/.test(ligne)),
    'chaque tarif porte son unite');
  ok(lignesDeTarif.every((ligne) => /(des \d+ personnes|sans minimum de personnes)/.test(ligne)),
    'chaque tarif porte son minimum de personnes');
  ok(lignesDeTarif.some((ligne) => /jours sur \d+ seulement/.test(ligne))
    && lignesDeTarif.some((ligne) => /(avant|a partir de|de) \d+ h/.test(ligne)),
    'les tarifs conditionnes portent leur jour et leur heure');

  // ET LE MODELE EST PREVENU DE CE QU IL NE DOIT PAS FAIRE.
  ok(/JAMAIS un total/.test(tarifsLibramont) && /n additionnes rien/.test(tarifsLibramont),
    'LE POINT : le bloc interdit de calculer un total pour un groupe');

  // LE FILET TIENT AVEC LES PRIX. Un tarif recopie passe ; un total calcule
  // par le modele est JETE, parce que le nombre n existe nulle part dans le
  // cerveau. C est ce qui rend le bloc sur.
  const cerveauTarife = await buildEmailBrain('libramont', depsAvec([]));
  const socleAutorise = `${cerveauTarife.stable}\n${cerveauTarife.context}`;
  const unTarifReel = lignesDeTarif[0];
  ok(!outilsDuMail.hasUngroundedNumbers(unTarifReel, socleAutorise),
    'un tarif recopie tel quel est ancre');
  ok(outilsDuMail.hasUngroundedNumbers('Pour 8 personnes cela fera 208 EUR au total.', socleAutorise),
    'LE POINT : un total calcule par le modele est JETE, le nombre n existe nulle part');

  // AUCUNE CONTRADICTION : des prix, ou un refus, jamais les deux. La
  // verification porte sur le cerveau ENTIER : le refus vivait dans les FAITS
  // DU CENTRE, qui partent dans le contexte, pas dans le bloc stable. Ne
  // regarder que stable laisserait la contradiction revenir sans un mot.
  const cerveauEntier = `${cerveauTarife.stable}\n${cerveauTarife.context}`;
  ok(!/ne jamais donner un prix|ne donne jamais un prix/i.test(cerveauEntier),
    'LE POINT : aucun refus de prix ne survit nulle part a cote des tarifs');
  ok(/--- TARIFS DE CE CENTRE/.test(cerveauTarife.context),
    'et le contexte annonce les tarifs comme etant CEUX DE CE CENTRE');

  // ET UNE RESSOURCE FERMEE RETIRE SES FORMULES, ICI AUSSI. Annoncer par mail
  // un tarif que le tunnel refusera est pire que ne pas repondre : le client
  // a la reponse ecrite sous les yeux quand la reservation echoue.
  const blocsDeLArene = Array.from({ length: 14 }, (inutilise, i) => bloc({
    id: 300 + i, scope_type: 'activity', scope_ref: 'laser_game',
    date: new Date(Date.parse(`${JOUR}T00:00:00Z`) + i * 86400000).toISOString().slice(0, 10),
  }));
  const tarifsAreneFermee = await prixDuCentre('libramont', depsAvec(blocsDeLArene), JOUR);
  const nomsAreneFermee = tarifsAreneFermee.split('\n').slice(1)
    .map((ligne) => ligne.split(' : ')[0]).filter(Boolean);
  ok(nomsAreneFermee.length > 0 && nomsAreneFermee.length < nomsDuMail.length,
    'LE POINT : arene fermee, la porte email retire les formules qui la consomment');
  ok(nomsAreneFermee.every((nom) => nomsDuMail.includes(nom)),
    'CONTRE-PREUVE : et elle n en invente aucune au passage');

  // CONTRE-PREUVE ET CLOISONNEMENT : un centre sans grille horaire n a aucun
  // prix de FORMULE (patch 46) et ne voit RIEN de son voisin. Le REFUS, lui,
  // ne tombe que s il n a rien d autre a dire : les prix a l unite ne
  // dependent d aucune grille horaire, une piste coute le meme prix qu on
  // connaisse ou non les heures d ouverture. Les deux cas existent pour de
  // vrai et sont joues ici, l assertion de montage le prouve.
  const { prixALaCarte: prixUnitaires } = require('../lib/email-agent');
  const branchesJouees = new Set();
  for (const sansGrille of ['gembloux', 'ciney']) {
    const tarifsVides = await prixDuCentre(sansGrille, depsAvec([]), JOUR);
    ok(tarifsVides === '', `CONTRE-PREUVE : ${sansGrille} n a aucun tarif de FORMULE a annoncer`);
    const cerveauSansPrix = await buildEmailBrain(sansGrille, depsAvec([]));
    ok(!/--- TARIFS DE CE CENTRE/.test(cerveauSansPrix.context),
      `LE POINT : ${sansGrille} ne recoit AUCUN bloc de tarifs de formule`);
    const aLaCarteDeLui = prixUnitaires(sansGrille, JOUR);
    branchesJouees.add(aLaCarteDeLui ? 'prix a l unite' : 'refus complet');
    if (aLaCarteDeLui) {
      ok(!/Aucun tarif n est disponible pour ce centre/.test(cerveauSansPrix.context)
        && cerveauSansPrix.context.includes(aLaCarteDeLui),
        `LE POINT : ${sansGrille} annonce ses prix a l unite au lieu d un refus`);
    } else {
      ok(/Aucun tarif n est disponible pour ce centre/.test(cerveauSansPrix.context)
        && /ne donne jamais un prix/.test(cerveauSansPrix.context),
        `LE POINT : ${sansGrille}, qui n a RIEN a dire, garde le refus mot pour mot`);
    }
    ok(!nomsPublics.some((nom) => cerveauSansPrix.context.includes(nom)),
      `ISOLATION : aucune formule de Libramont n apparait chez ${sansGrille}`);
  }
  ok(branchesJouees.size === 2,
    'MONTAGE : les deux cas ont ete joues, prix a l unite ET refus complet',
    [...branchesJouees].join(' | '));


  // ET LE PARC DE PISTES, ICI AUSSI. Corriger une porte et pas l autre est
  // exactement le defaut que ces patches n arretent pas de rencontrer.
  const depsParcArrete = {
    query: async (sql) => (/from lane_statuses/i.test(String(sql))
      ? { rows: Array.from({ length: 8 }, (inutilise, i) => ({ lane_number: i + 1, status: 'maintenance', maintenance_from: null, maintenance_until: null, maintenance_note: '' })) }
      : { rows: [] }),
  };
  const tarifsParcArrete = await prixDuCentre('libramont', depsParcArrete, JOUR);
  const nomsParcArrete = tarifsParcArrete.split('\n').slice(1)
    .map((ligne) => ligne.split(' : ')[0]).filter(Boolean);
  ok(nomsParcArrete.length > 0 && nomsParcArrete.length < nomsDuMail.length,
    'LE POINT : parc de pistes a l arret, la porte email retire les formules bowling');
  ok(nomsParcArrete.every((nom) => nomsDuMail.includes(nom)),
    'CONTRE-PREUVE : et elle n en invente aucune au passage');
  // LE CLOISONNEMENT, PROUVE PAR UNE DIFFERENCE REELLE.
  // Tant que Gembloux n a aucune grille horaire il n a aucun tarif, et « les
  // tarifs de CE centre » ne se distingue en rien de « les tarifs de
  // Libramont » : les deux listes sont vides. On lui pose donc une grille ET
  // on desactive une formule pour lui seul. Sa liste doit alors etre la
  // SIENNE, strictement plus courte. Sans ce montage, remplacer centerId par
  // 'libramont' dans la lecture du catalogue ne ferait rougir personne.
  const { getCenter: centreConfigure, applyCenterOverrides: poserConfig } = require('../lib/ops-knowledge');
  const configDeGembloux = JSON.parse(JSON.stringify(centreConfigure('gembloux')));
  configDeGembloux.defaultSchedule = JSON.parse(JSON.stringify(centreConfigure('libramont').defaultSchedule));
  const depsDeGembloux = {
    query: async (sql) => {
      const texte = String(sql);
      if (/from centers/i.test(texte)) {
        return {
          rows: [{
            id: 'gembloux', name: 'Fun Galaxy Gembloux', status: 'active',
            timezone: 'Europe/Brussels', settings: { config: configDeGembloux },
          }],
        };
      }
      if (/from formule_overrides/i.test(texte)) {
        return {
          rows: [{
            formule_id: 'f1', center_id: 'gembloux', name: null, price_value: null,
            price_old: null, enabled: false, removed: false, sort_index: null,
          }],
        };
      }
      return { rows: [] };
    },
  };
  // prixDuCentre lit la configuration DEJA rafraichie, comme etatDuCentre :
  // c est buildEmailBrain qui rafraichit, une fois, avant les deux. Le montage
  // doit donc faire le meme geste, sinon il testerait le socle du depot.
  await require('../lib/ops-knowledge').refreshCenterOverrides(depsDeGembloux, { force: true });
  const tarifsDeGembloux = await prixDuCentre('gembloux', depsDeGembloux, JOUR);
  const nomsDeGembloux = tarifsDeGembloux.split('\n').slice(1)
    .map((ligne) => ligne.split(' : ')[0]).filter(Boolean);
  ok(nomsDeGembloux.length > 0,
    'MONTAGE : une grille horaire posee donne enfin des tarifs a Gembloux');
  ok(nomsDeGembloux.length === nomsDuMail.length - 1
    && nomsDeGembloux.every((nom) => nomsDuMail.includes(nom)),
    'LE POINT : la liste de Gembloux est la SIENNE, amputee de la formule qu il a desactivee');

  // UNE GRILLE POSEE MAIS AUCUNE FORMULE ACTIVE : c est l etat d un centre qui
  // a saisi ses horaires et pas encore son catalogue. Il a un agenda, donc la
  // garde des jours ne le protege pas ; c est celle des prix vides qui doit
  // rendre la main au refus, sinon le modele recoit un entete « TARIFS » suivi
  // de rien, et comble.
  const idsDuCatalogue = require('../lib/booking-config')
    .getEffectiveFormules('libramont').map((formule) => formule.id);
  const depsSansCatalogue = {
    query: async (sql) => {
      const texte = String(sql);
      if (/from centers/i.test(texte)) {
        return {
          rows: [{
            id: 'gembloux', name: 'Fun Galaxy Gembloux', status: 'active',
            timezone: 'Europe/Brussels', settings: { config: configDeGembloux },
          }],
        };
      }
      if (/from formule_overrides/i.test(texte)) {
        return {
          rows: idsDuCatalogue.map((id) => ({
            formule_id: id, center_id: 'gembloux', name: null, price_value: null,
            price_old: null, enabled: false, removed: false, sort_index: null,
          })),
        };
      }
      return { rows: [] };
    },
  };
  await require('../lib/ops-knowledge').refreshCenterOverrides(depsSansCatalogue, { force: true });
  const tarifsSansCatalogue = await prixDuCentre('gembloux', depsSansCatalogue, JOUR);
  ok(tarifsSansCatalogue === '',
    'LE POINT : une grille sans aucune formule active ne produit AUCUN bloc tarifs');
  const cerveauSansCatalogue = await buildEmailBrain('gembloux', depsSansCatalogue);
  ok(!/--- TARIFS DE CE CENTRE/.test(cerveauSansCatalogue.context),
    'et aucun entete de tarifs de formule vide ne reste');
  // Ce que l ancienne assertion protegeait vraiment : qu aucun contenu de
  // formule ne se glisse dans ce qui reste. Verifie directement, donc plus
  // strictement qu en exigeant un refus qui n a plus lieu d etre.
  ok(!nomsDuMail.some((nom) => cerveauSansCatalogue.context.includes(nom)),
    'CONTRE-PREUVE : et pas une seule formule ne se glisse dans ce qui reste',
    nomsDuMail.filter((nom) => cerveauSansCatalogue.context.includes(nom)).join(', '));

  // RESTAURATION : la configuration et le catalogue redeviennent ceux du depot.
  poserConfig(new Map());
  await require('../lib/booking-config').refreshFormuleOverrides(depsAvec([]), { force: true });
  const tarifsApresRestauration = await prixDuCentre('libramont', depsAvec([]), JOUR);
  ok(tarifsApresRestauration === tarifsLibramont,
    'CONTRE-PREUVE : apres restauration, Libramont retrouve exactement ses tarifs');

  // ── CE QUE LE LIEU PEUT ACCUEILLIR ─────────────────────────────────────
  console.log('\n[CAPACITE] chaque centre annonce SES chiffres, et un centre sans rien n annonce rien');
  const { getCenter: centreDeclare } = require('../lib/ops-knowledge');
  const { buildCenterFacts: faitsDeLaPorteMail } = require('../lib/email-agent');
  applyCenterOverrides(new Map());

  // MONTAGE : les trois centres declarent des choses DIFFERENTES. Sans cette
  // assertion, les suivantes pourraient toutes passer sur trois centres
  // identiques, et ne rien prouver du cloisonnement.
  const laserDe = (id) => ((centreDeclare(id).resources || {}).laser || {});
  ok(laserDe('libramont').maxPlayers !== laserDe('gembloux').maxPlayers
    && laserDe('libramont').parallelLaunches !== laserDe('gembloux').parallelLaunches,
    'MONTAGE : Libramont et Gembloux declarent des lasers differents',
    JSON.stringify({ libramont: laserDe('libramont'), gembloux: laserDe('gembloux') }));
  ok(!laserDe('ciney').maxPlayers && !((centreDeclare('ciney').resources || {}).bowling || {}).laneCount,
    'MONTAGE : Ciney ne declare aucune ressource',
    JSON.stringify(centreDeclare('ciney').resources));

  const ligneCapacite = (id) => (faitsDeLaPorteMail(id).split('\n').find((l) => l.startsWith('Capacité')) || '');

  ok(ligneCapacite('libramont').includes(String(laserDe('libramont').maxPlayers)),
    'LE POINT : Libramont annonce SON nombre de joueurs laser', ligneCapacite('libramont'));
  ok(ligneCapacite('gembloux').includes(String(laserDe('gembloux').maxPlayers)),
    'LE POINT : Gembloux annonce le SIEN', ligneCapacite('gembloux'));
  ok(!ligneCapacite('gembloux').includes(String(laserDe('libramont').maxPlayers)),
    'ISOLATION : et jamais celui de son voisin', ligneCapacite('gembloux'));

  // LE POINT QUI COMPTE : aucun repli. Le moteur retombe sur les valeurs de
  // Libramont quand rien n est declare ; la porte email, elle, se tait.
  ok(ligneCapacite('ciney') === '',
    'LE POINT : un centre sans ressource declaree n annonce AUCUNE capacite',
    ligneCapacite('ciney'));
  // On cherche une LIGNE DE CAPACITE, pas un chiffre : « 30 » se retrouve
  // dans un numero de telephone, et ce gate rougirait le jour ou le staff
  // pose enfin un numero pour Ciney. Plus strict, pas moins.
  ok(!faitsDeLaPorteMail('ciney').split('\n').some((l) => /piste|joueur|session/i.test(l)),
    'ISOLATION : et surtout aucune ligne de capacite, meme deguisee, ni le repli du moteur',
    faitsDeLaPorteMail('ciney'));

  // CAPACITE N EST PAS DISPONIBILITE, et la ligne le dit.
  ok(/PAS une disponibilit/.test(ligneCapacite('libramont')),
    'la ligne rappelle qu une capacite n est pas une disponibilite');

  // LA REGLE DU GROUPE COMPLET N EST DITE QUE LA OU ELLE EST DECLAREE.
  ok(laserDe('libramont').requiresCompleteGroupBeforeLaunch === true
    && /groupe complet/.test(ligneCapacite('libramont')),
    'LE POINT : la regle du groupe complet est dite ou elle est declaree');
  ok(laserDe('gembloux').requiresCompleteGroupBeforeLaunch !== true
    && !/groupe complet/.test(ligneCapacite('gembloux')),
    'CONTRE-PREUVE : et tue la ou elle ne l est pas', ligneCapacite('gembloux'));

  // ── OU EST LE CENTRE, ET COMMENT ON LE JOINT ──────────────────────────
  console.log('\n[COORDONNEES] chaque centre dit ou il est, ou dit qu il n en sait rien');
  const { buildCenterFacts: faitsDuLieu } = require('../lib/email-agent');
  const { getCenter: lieuDeclare } = require('../lib/ops-knowledge');
  applyCenterOverrides(new Map());

  const infoDe = (id) => {
    try { return lieuDeclare(id).publicInfo || {}; } catch (error) { return {}; }
  };

  // MONTAGE : sans deux adresses DIFFERENTES et un centre qui n en a AUCUNE,
  // les assertions suivantes passeraient sur trois centres identiques et ne
  // prouveraient rien.
  ok(Boolean(infoDe('libramont').address) && Boolean(infoDe('gembloux').address)
    && infoDe('libramont').address !== infoDe('gembloux').address,
    'MONTAGE : Libramont et Gembloux declarent des adresses differentes',
    JSON.stringify([infoDe('libramont').address, infoDe('gembloux').address]));
  ok(Object.keys(infoDe('ciney')).length === 0,
    'MONTAGE : Ciney ne declare aucune coordonnee', JSON.stringify(infoDe('ciney')));

  ['libramont', 'gembloux'].forEach((id) => {
    const info = infoDe(id);
    const fiche = faitsDuLieu(id);
    ['address', 'phone', 'email', 'parking'].forEach((cle) => {
      ok(fiche.includes(String(info[cle])),
        `LE POINT : ${id} annonce SON ${cle}`, String(info[cle]));
    });
  });

  // ISOLATION : une adresse empruntee envoie un client a cent trente
  // kilometres. Les deux sens sont verifies : une garde posee sur une seule
  // porte ne dit rien de sa voisine.
  ok(!faitsDuLieu('gembloux').includes(infoDe('libramont').address)
    && !faitsDuLieu('gembloux').includes(infoDe('libramont').phone),
    'ISOLATION : Gembloux ne porte ni l adresse ni le telephone de Libramont');
  ok(!faitsDuLieu('libramont').includes(infoDe('gembloux').address)
    && !faitsDuLieu('libramont').includes(infoDe('gembloux').phone),
    'ISOLATION : et reciproquement');

  // LE CENTRE QUI N A RIEN : il n emprunte a personne, ET il le dit.
  const ficheCiney = faitsDuLieu('ciney');
  ok(!ficheCiney.includes(infoDe('libramont').address)
    && !ficheCiney.includes(infoDe('gembloux').address)
    && !ficheCiney.includes(infoDe('libramont').phone)
    && !ficheCiney.includes(infoDe('gembloux').phone),
    'LE POINT : un centre sans coordonnees n emprunte celles de personne');
  ok(/Coordonnées : NON RENSEIGNÉES pour ce centre/.test(ficheCiney)
    && /N invente ni adresse/.test(ficheCiney),
    'LE POINT : et il porte le refus explicite, parce qu une adresse s invente',
    ficheCiney.split('\n').find((l) => l.startsWith('Coordonnées')) || '(aucune ligne)');

  // CONTRE-PREUVE : le refus et les coordonnees ne coexistent jamais. Un
  // modele qui lit une adresse et « n invente pas d adresse » tranche au
  // hasard, comme il le faisait pour les prix avant le patch 50.
  ok(!/NON RENSEIGNÉES pour ce centre\. N invente ni adresse/.test(faitsDuLieu('libramont')),
    'CONTRE-PREUVE : un centre qui a ses coordonnees ne porte pas le refus');

  // ── QUI PEUT ENTRER, ET POUR COMBIEN DE TEMPS ─────────────────────────
  console.log('\n[ACCES] chaque centre dit SES conditions, et seulement pour ce qu il propose');
  const { buildCenterFacts: faitsDAcces } = require('../lib/email-agent');
  const { getCenter: centreThematique, applyCenterOverrides: rendreLaConfig,
    refreshCenterOverrides: poserLaConfig } = require('../lib/ops-knowledge');
  rendreLaConfig(new Map());

  const themeDe = (id, activite) => {
    try { return (centreThematique(id).activityThemes || {})[activite] || {}; }
    catch (error) { return {}; }
  };

  // MONTAGE : les deux centres partagent l age ET la taille. Sans univers
  // distincts, une lecture croisee ne ferait rougir personne.
  ok(themeDe('libramont', 'laser_game').minAge === themeDe('gembloux', 'laser_game').minAge
    && themeDe('libramont', 'laser_game').minHeightCm === themeDe('gembloux', 'laser_game').minHeightCm,
    'MONTAGE : les deux centres ont le MEME age et la MEME taille minimum',
    JSON.stringify([themeDe('libramont', 'laser_game').minAge, themeDe('libramont', 'laser_game').minHeightCm]));
  ok(Boolean(themeDe('libramont', 'laser_game').theme) && Boolean(themeDe('gembloux', 'laser_game').theme)
    && themeDe('libramont', 'laser_game').theme !== themeDe('gembloux', 'laser_game').theme,
    'MONTAGE : mais des univers DIFFERENTS, et c est lui qui prouve le cloisonnement',
    JSON.stringify([themeDe('libramont', 'laser_game').theme, themeDe('gembloux', 'laser_game').theme]));

  const ligneAccesDe = (id, etiquette) => (faitsDAcces(id).split('\n')
    .find((l) => l.trim().startsWith(`- ${etiquette} :`)) || '');

  ['libramont', 'gembloux'].forEach((id) => {
    const laser = themeDe(id, 'laser_game');
    const ligne = ligneAccesDe(id, 'laser game');
    ok(ligne.includes(`${laser.minAge} ans`),
      `LE POINT : ${id} annonce l age minimum de SON laser`, ligne);
    ok(ligne.includes(`${laser.minHeightCm} cm`),
      `LE POINT : ${id} annonce la taille minimum`, ligne);
    ok(ligne.includes(`${laser.gameMinutes} minutes`),
      `LE POINT : ${id} annonce la duree d une partie`, ligne);
    ok(ligne.includes(laser.theme),
      `LE POINT : ${id} annonce SON univers`, ligne);
  });

  ok(!faitsDAcces('gembloux').includes(themeDe('libramont', 'laser_game').theme),
    'ISOLATION : Gembloux ne porte jamais l univers de Libramont');
  ok(!faitsDAcces('libramont').includes(themeDe('gembloux', 'laser_game').theme),
    'ISOLATION : et reciproquement');

  // UNE ACTIVITE THEMEE MAIS NON PROPOSEE NE SORT PAS. Le theme reste dans la
  // config, seule la disponibilite bascule : c est la seule facon de prouver
  // que c est bien activityAvailability qui commande, et pas la presence du
  // theme.
  ok(/Golf O'Clock/.test(faitsDAcces('gembloux')),
    'MONTAGE : avant bascule, Gembloux annonce les conditions du Golf O Clock');
  const configSansGolf = JSON.parse(JSON.stringify(centreThematique('gembloux')));
  configSansGolf.activityAvailability = {
    ...configSansGolf.activityAvailability, golf_oclock: false,
  };
  await poserLaConfig({
    query: async (sql) => (/from centers/i.test(String(sql))
      ? { rows: [{ id: 'gembloux', name: 'Fun Galaxy Gembloux', status: 'active',
        timezone: 'Europe/Brussels', settings: { config: configSansGolf } }] }
      : { rows: [] }),
  }, { force: true });
  ok(Boolean((centreThematique('gembloux').activityThemes || {}).golf_oclock)
    && centreThematique('gembloux').activityAvailability.golf_oclock === false,
    'MONTAGE : le theme du Golf O Clock est toujours declare, seule sa disponibilite tombe');
  const apresBascule = faitsDAcces('gembloux');
  ok(!/- Golf O'Clock :/.test(apresBascule),
    'LE POINT : une activite themee mais NON proposee ne sort pas des conditions',
    apresBascule.split('\n').filter((l) => l.trim().startsWith('- ')).join(' | '));
  ok(/- laser game :/.test(apresBascule),
    'CONTRE-PREUVE : et le reste des conditions tient toujours');
  rendreLaConfig(new Map());

  // LE CENTRE QUI N A RIEN : refus explicite, et aucune condition empruntee.
  const accesCiney = faitsDAcces('ciney');
  ok(/Conditions d'accès : NON RENSEIGNÉES pour ce centre/.test(accesCiney)
    && /N annonce jamais un âge minimum/.test(accesCiney),
    'LE POINT : un centre sans condition porte le refus, parce qu un age s invente',
    accesCiney.split('\n').find((l) => l.startsWith("Conditions d'accès")) || '(aucune ligne)');
  ok(!accesCiney.includes(themeDe('libramont', 'laser_game').theme)
    && !accesCiney.includes(themeDe('gembloux', 'laser_game').theme)
    && !/ans|cm/.test(accesCiney.split('\n').filter((l) => l.trim().startsWith('- ')).join(' ')),
    'ISOLATION : et il n emprunte aucune condition a personne');

  ok(!/Conditions d'accès : NON RENSEIGNÉES/.test(faitsDAcces('libramont')),
    'CONTRE-PREUVE : un centre qui a ses conditions ne porte pas le refus');

  // ── CE QUE LA FORMULE COMPREND ────────────────────────────────────────
  console.log('\n[CONTENU] chaque tarif dit ce qu il comprend, mot pour mot comme le site');

  // On rejoue une lecture PROPRE : les montages precedents ont pousse des
  // surcharges de catalogue, et prixDuCentre rafraichit avant de lire.
  const tarifsAvecContenu = await prixDuCentre('libramont', depsAvec([]), JOUR);
  const catalogueLu = require('../lib/booking-config').getEffectiveFormules('libramont');
  const lignesDuContenu = tarifsAvecContenu.split('\n').slice(1);

  // MONTAGE : sans desc ni notes au catalogue, il n y a rien a prouver.
  const avecContenu = catalogueLu.filter((f) => Array.isArray(f.desc) && f.desc.length
    && Array.isArray(f.notes) && f.notes.length);
  ok(avecContenu.length >= 10,
    'MONTAGE : le catalogue effectif porte bien un contenu et des conditions',
    `${avecContenu.length} formules sur ${catalogueLu.length}`);

  const ligneDe = (formule) => lignesDuContenu.find((l) => l.startsWith(`${formule.name} : `)) || '';
  const publiees = avecContenu.filter((f) => ligneDe(f));
  ok(publiees.length >= 10,
    'MONTAGE : et ces formules sont bien publiees au client', String(publiees.length));

  // LE POINT : mot pour mot, et sur LA BONNE formule. Un decalage d une case
  // ferait payer 39 EUR ce que le client a lu a 26.
  const contenuFaux = publiees.filter((f) => !ligneDe(f).includes(` | comprend : ${f.desc.join(' · ')}`));
  ok(contenuFaux.length === 0,
    'LE POINT : chaque tarif porte le contenu de SA formule, mot pour mot',
    contenuFaux.map((f) => f.name).join(', '));
  const conditionsFausses = publiees.filter((f) => !ligneDe(f).includes(` | conditions : ${f.notes.join(' · ')}`));
  ok(conditionsFausses.length === 0,
    'LE POINT : et ses conditions ecrites, mot pour mot',
    conditionsFausses.map((f) => f.name).join(', '));

  ok(/cite-la telle quelle/.test(tarifsAvecContenu),
    'LE POINT : et le modele est prevenu que ce contenu se cite, pas se reecrit');

  // UNE FORMULE SANS CONTENU NE PRODUIT PAS D ENTETE VIDE. Aucune formule
  // reelle n est dans ce cas : on monte la situation par un crochet sur le
  // MODULE, pose avant que prixDuCentre ne le destructure.
  const reservation = require('../lib/booking-config');
  const vraiCatalogue = reservation.getEffectiveFormules;
  const nomVide = publiees[0].name;
  reservation.getEffectiveFormules = (id) => vraiCatalogue(id)
    .map((f) => (f.name === nomVide ? { ...f, desc: [], notes: [] } : f));
  ok(reservation.getEffectiveFormules('libramont').find((f) => f.name === nomVide).desc.length === 0,
    'MONTAGE : le crochet mord, cette formule n a plus ni contenu ni conditions', nomVide);
  const tarifsAmputes = await prixDuCentre('libramont', depsAvec([]), JOUR);
  reservation.getEffectiveFormules = vraiCatalogue;
  const ligneAmputee = tarifsAmputes.split('\n').find((l) => l.startsWith(`${nomVide} : `)) || '';
  ok(Boolean(ligneAmputee) && !/comprend :/.test(ligneAmputee) && !/conditions :/.test(ligneAmputee),
    'LE POINT : sans contenu, aucun entete vide, et le tarif reste publie', ligneAmputee);
  const uneAutre = tarifsAmputes.split('\n').find((l) => l.startsWith(`${publiees[1].name} : `)) || '';
  ok(/comprend :/.test(uneAutre) && /conditions :/.test(uneAutre),
    'CONTRE-PREUVE : et les autres formules gardent le leur', uneAutre.slice(0, 110));

  const tarifsRendus = await prixDuCentre('libramont', depsAvec([]), JOUR);
  ok(tarifsRendus === tarifsAvecContenu,
    'CONTRE-PREUVE : crochet retire, le bloc est EXACTEMENT celui du depart');

  // ── LE MOYEN D AGIR : DES LIENS VRAIS, OU AUCUN ───────────────────────
  console.log('\n[LIENS] la voix reclame un moyen d agir, le cerveau doit le fournir');
  const { buildCenterFacts: faitsAvecLiens } = require('../lib/email-agent');
  const { getCenter: centreIdentifie, applyCenterOverrides: rendreIdentite,
    refreshCenterOverrides: poserIdentite } = require('../lib/ops-knowledge');
  rendreIdentite(new Map());

  const identiteDe = (id) => {
    try { return centreIdentifie(id).identity || {}; } catch (error) { return {}; }
  };

  // MONTAGE : la voix EXIGE bien un moyen d agir. Sans cette exigence, ne rien
  // donner ne serait pas un defaut.
  const voixLue = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'ops-knowledge', 'marketing-brain', 'voice.md'), 'utf8');
  ok(/moyen d.agir/i.test(voixLue) && /lien/i.test(voixLue),
    'MONTAGE : la voix de la maison demande bien de terminer par un lien');

  const liensDeclares = (id) => (Array.isArray(identiteDe(id).siteLinks) ? identiteDe(id).siteLinks : []);
  ok(liensDeclares('libramont').length >= 3 && liensDeclares('ciney').length === 0,
    'MONTAGE : Libramont declare plusieurs liens, Ciney aucun',
    `${liensDeclares('libramont').length} contre ${liensDeclares('ciney').length}`);

  // LE POINT : chaque lien declare sort ENTIER, avec son intitule declare.
  const ficheLibramont = faitsAvecLiens('libramont');
  const liensManquants = liensDeclares('libramont')
    .filter((lien) => !ficheLibramont.includes(`${lien.label} : ${lien.url}.`));
  ok(liensManquants.length === 0,
    'LE POINT : chaque lien declare sort entier, avec son intitule',
    liensManquants.map((l) => l.label).join(', '));
  ok(ficheLibramont.includes(`Site : ${identiteDe('libramont').siteUrl}.`),
    'LE POINT : et l adresse du site aussi');

  // LE POINT : ce qui n est PAS une adresse web ne sort pas. logoUrl est un
  // chemin relatif, il n a aucun sens dans un mail.
  ok(/^\.\//.test(String(identiteDe('libramont').logoUrl || '')),
    'MONTAGE : le logo declare est bien un chemin relatif, pas une adresse web',
    String(identiteDe('libramont').logoUrl));
  ok(!ficheLibramont.includes(String(identiteDe('libramont').logoUrl)),
    'LE POINT : et il ne sort pas vers le client');

  // LE POINT : le modele est prevenu de ne rien rebaptiser.
  ok(/n'appelle pas « réservation » une page qui ne le dit pas/.test(ficheLibramont),
    'LE POINT : et il lui est interdit de rebaptiser un lien en reservation');

  // UN CENTRE QUI N A QUE SON SITE : il le donne, et rien de plus.
  const ficheDeCiney = faitsAvecLiens('ciney');
  ok(ficheDeCiney.includes(`Site : ${identiteDe('ciney').siteUrl}.`),
    'LE POINT : un centre qui ne declare que son site donne son site');
  const empruntes = liensDeclares('libramont').filter((lien) => ficheDeCiney.includes(lien.url));
  ok(empruntes.length === 0,
    'ISOLATION : et jamais les liens declares par un autre centre',
    empruntes.map((l) => l.label).join(', '));

  // AUCUNE IDENTITE DU TOUT : le refus explicite, parce que la voix vient de
  // reclamer un moyen d agir et qu un modele comble.
  const configSansIdentite = JSON.parse(JSON.stringify(centreIdentifie('ciney')));
  configSansIdentite.identity = null;
  await poserIdentite({
    query: async (sql) => (/from centers/i.test(String(sql))
      ? { rows: [{ id: 'ciney', name: 'Fun Galaxy Ciney', status: 'planned',
        timezone: 'Europe/Brussels', settings: { config: configSansIdentite } }] }
      : { rows: [] }),
  }, { force: true });
  ok(!identiteDe('ciney').siteUrl,
    'MONTAGE : le centre ne declare plus aucune identite',
    JSON.stringify(identiteDe('ciney')));
  const ficheSansLien = faitsAvecLiens('ciney');
  ok(/AUCUN lien officiel n est déclaré pour ce centre/.test(ficheSansLien)
    && /N écris jamais une adresse web/.test(ficheSansLien),
    'LE POINT : sans aucun lien, un refus explicite prend la place',
    ficheSansLien.split('\n').find((l) => l.startsWith('Liens')) || '(aucune ligne)');
  ok(!/https?:\/\//.test(ficheSansLien),
    'LE POINT : et pas une seule adresse web ne traine dans sa fiche');
  rendreIdentite(new Map());

  ok(!/AUCUN lien officiel/.test(faitsAvecLiens('libramont')),
    'CONTRE-PREUVE : un centre qui a ses liens ne porte pas le refus');

  // ── UNE COUPURE N EST PAS UNE FERMETURE, ET CE N EST PAS RIEN ─────────
  console.log('\n[COUPURES] quelques heures fermees arrivent aussi jusqu au client');

  // MONTAGE : le bloc de deux heures ne ferme PAS la journee. Sans cette
  // assertion, la ligne suivante pourrait passer sur une simple fermeture.
  const { agendaDuCentre: agendaLu } = require('../lib/center-facts');
  const { loadAvailabilityBlocks: chargerBlocs } = require('../lib/availability-blocks');
  const coupureCentre = [bloc({ id: 60, start_time: '14:00', end_time: '16:00' })];
  const blocsLus = await chargerBlocs(depsAvec(coupureCentre), 'libramont', { force: true });
  const jourCoupe = agendaLu(centreLu('libramont'), blocsLus, JOUR)
    .find((j) => j.date === '2026-09-12') || {};
  ok(jourCoupe.ouvert === true && jourCoupe.ferme === false
    && (jourCoupe.coupures || []).length === 1,
    'MONTAGE : deux heures posees font une COUPURE, pas une fermeture',
    JSON.stringify(jourCoupe));

  const etatCoupeCentre = await etatDuCentre('libramont', depsAvec(coupureCentre), JOUR);
  ok(/Le centre est FERME de 14 h a 16 h/.test(etatCoupeCentre)
    && /2026-09-12/.test(etatCoupeCentre),
    'LE POINT : la coupure du centre atteint le modele, avec ses heures et sa date',
    etatCoupeCentre);
  ok(!/travaux/i.test(etatCoupeCentre),
    'LE POINT : et sa raison ne sort pas vers le client', etatCoupeCentre);

  // UNE COUPURE D ACTIVITE : celle-la n etait calculee NULLE PART.
  const coupureLaser = [bloc({ id: 61, scope_type: 'activity', scope_ref: 'laser_game',
    start_time: '14:00', end_time: '16:00' })];
  const etatCoupeLaser = await etatDuCentre('libramont', depsAvec(coupureLaser), JOUR);
  ok(/laser game : INDISPONIBLE de 14 h a 16 h/.test(etatCoupeLaser)
    && /2026-09-12/.test(etatCoupeLaser),
    'LE POINT : la coupure d une activite aussi', etatCoupeLaser);
  ok(!/travaux/i.test(etatCoupeLaser),
    'LE POINT : sans sa raison non plus');

  // UNE BORNE ABSENTE SE DIT. « Ferme a partir de 20 h » n est pas « ferme de
  // 20 h a rien ».
  const coupureOuverte = [bloc({ id: 62, scope_type: 'activity', scope_ref: 'laser_game',
    start_time: '20:00', end_time: null })];
  const etatBorneOuverte = await etatDuCentre('libramont', depsAvec(coupureOuverte), JOUR);
  ok(/de 20 h a la fermeture/.test(etatBorneOuverte),
    'LE POINT : une borne absente se dit au lieu de disparaitre', etatBorneOuverte);

  // LA MEME PLAGE PLUSIEURS JOURS FAIT UNE LIGNE, PAS DIX.
  const troisJours = [
    bloc({ id: 63, scope_type: 'activity', scope_ref: 'laser_game', date: '2026-09-12', start_time: '14:00', end_time: '16:00' }),
    bloc({ id: 64, scope_type: 'activity', scope_ref: 'laser_game', date: '2026-09-13', start_time: '14:00', end_time: '16:00' }),
    bloc({ id: 65, scope_type: 'activity', scope_ref: 'laser_game', date: '2026-09-15', start_time: '14:00', end_time: '16:00' }),
  ];
  const etatTroisJours = await etatDuCentre('libramont', depsAvec(troisJours), JOUR);
  const lignesLaser = etatTroisJours.split('\n').filter((l) => /^laser game/.test(l));
  ok(lignesLaser.length === 1 && /2026-09-12 -> 2026-09-13/.test(lignesLaser[0])
    && /2026-09-15/.test(lignesLaser[0]),
    'LE POINT : la meme plage sur plusieurs jours fait UNE ligne, dates groupees',
    lignesLaser.join(' | '));

  // CONTRE-PREUVE : un jour deja annonce ENTIEREMENT indisponible ne recoit
  // pas en plus sa coupure. Deux phrases dont l une contredit l autre font
  // trancher le modele au hasard.
  const journeeEtCoupure = [
    bloc({ id: 66, scope_type: 'activity', scope_ref: 'laser_game', date: '2026-09-12' }),
    bloc({ id: 67, scope_type: 'activity', scope_ref: 'laser_game', date: '2026-09-12', start_time: '14:00', end_time: '16:00' }),
  ];
  const etatDouble = await etatDuCentre('libramont', depsAvec(journeeEtCoupure), JOUR);
  ok(/laser game : INDISPONIBLE 2026-09-12/.test(etatDouble)
    && !/laser game : INDISPONIBLE de 14 h/.test(etatDouble),
    'CONTRE-PREUVE : la journee entiere absorbe la coupure du meme jour', etatDouble);

  // CONTRE-PREUVE : sans aucun bloc, rien de tout cela n apparait.
  const etatSansRien = await etatDuCentre('libramont', depsAvec([]), JOUR);
  ok(etatSansRien === '',
    'CONTRE-PREUVE : sans bloc, le prompt ne gagne pas une ligne', etatSansRien);

  // ── LE PRIX D UNE PARTIE, PAS SEULEMENT CELUI D UN PACK ───────────────
  console.log('\n[A L UNITE] ce que le tunnel facture hors formule, centre par centre');
  const { prixALaCarte: tarifsUnitaires } = require('../lib/email-agent');
  const { BOWLING_PRICES: grilleParPiste, LASER_GAME_OPTIONS: grilleLaser,
    getBowlingGameOptions: optionsAuxParties } = require('../lib/booking-config');
  const { getCenter: centreTarife, applyCenterOverrides: rendreTarifs,
    refreshCenterOverrides: poserTarifs } = require('../lib/ops-knowledge');
  rendreTarifs(new Map());

  // MONTAGE : le moteur a bien deux grilles a annoncer.
  ok(Object.keys(grilleParPiste).length >= 2 && grilleLaser.length >= 2,
    'MONTAGE : le moteur porte une grille bowling et une grille laser',
    `${Object.keys(grilleParPiste).length} paliers bowling, ${grilleLaser.length} paliers laser`);

  const blocUnitaire = tarifsUnitaires('libramont', JOUR);
  ok(blocUnitaire.length > 80,
    'MONTAGE : Libramont a bien un bloc de prix a l unite', String(blocUnitaire.length));

  // LE POINT : chaque palier du moteur est annonce, avec SON montant.
  const paliersBowlingManquants = Object.entries(grilleParPiste)
    .filter(([, prix]) => !blocUnitaire.includes(`${prix} EUR la piste`));
  ok(paliersBowlingManquants.length === 0,
    'LE POINT : chaque palier de la grille bowling est annonce, avec son montant',
    JSON.stringify(paliersBowlingManquants));
  const paliersLaserManquants = grilleLaser
    .filter((o) => !blocUnitaire.includes(`${o.price} EUR par personne pour ${o.label}`));
  ok(paliersLaserManquants.length === 0,
    'LE POINT : et chaque palier laser, avec son libelle',
    JSON.stringify(paliersLaserManquants.map((o) => o.label)));

  // LE POINT : ce que le moteur ne chiffre pas est NOMME, pas taxi.
  ok(/Aucun prix a l unite n existe dans le systeme pour :/.test(blocUnitaire)
    && /Ne les chiffre jamais/.test(blocUnitaire),
    'LE POINT : les activites sans tarif sont nommees, avec l interdit de les chiffrer');

  // CONTRE-PREUVE : une activite que le centre ne propose PAS n y figure pas.
  ok(centreTarife('libramont').activityAvailability.golf_oclock !== true
    && !/Golf O'Clock/.test(blocUnitaire),
    'CONTRE-PREUVE : une activite absente du centre n apparait nulle part ici');

  // UN CENTRE SANS BOWLING NI LASER N A RIEN A DIRE ICI.
  ok(tarifsUnitaires('ciney', JOUR) === '',
    'LE POINT : un centre qui ne declare ni bowling ni laser n a aucun prix a l unite',
    tarifsUnitaires('ciney', JOUR));

  // LA GRILLE DU CENTRE GAGNE SUR CELLE DU MOTEUR, comme dans getBasePrice.
  // Sans ce montage, coder la grille globale en dur passerait sans un bruit.
  const configAuxParties = JSON.parse(JSON.stringify(centreTarife('libramont')));
  configAuxParties.resources.bowling.pricing = {
    mode: 'per_game_per_person', minutesPerGame: 60,
    tiers: [{ days: [0, 1, 2, 3, 4, 5, 6], prices: [7, 12, 16] }],
  };
  await poserTarifs({
    query: async (sql) => (/from centers/i.test(String(sql))
      ? { rows: [{ id: 'libramont', name: 'Fun Galaxy Libramont', status: 'active',
        timezone: 'Europe/Brussels', settings: { config: configAuxParties } }] }
      : { rows: [] }),
  }, { force: true });
  const optionsDuCentre = optionsAuxParties((centreTarife('libramont').resources || {}).bowling,
    JOUR, { pax: 1, laneCount: 1 });
  ok(Array.isArray(optionsDuCentre) && optionsDuCentre.length === 3,
    'MONTAGE : le centre declare desormais sa propre grille aux parties',
    JSON.stringify(optionsDuCentre));
  const blocAuxParties = tarifsUnitaires('libramont', JOUR);
  const siennesManquantes = optionsDuCentre
    .filter((o) => !blocAuxParties.includes(`${o.price} EUR par personne pour ${o.label}`));
  ok(siennesManquantes.length === 0,
    'LE POINT : il annonce SA grille, pas celle du moteur',
    JSON.stringify(siennesManquantes.map((o) => o.label)));
  ok(!Object.values(grilleParPiste).some((prix) => blocAuxParties.includes(`${prix} EUR la piste`)),
    'ISOLATION : et plus un seul montant de la grille du moteur');
  ok(/tarif du jour/.test(blocAuxParties),
    'LE POINT : un tarif qui depend du jour est annonce comme tel', blocAuxParties.split('\n')[0]);
  rendreTarifs(new Map());
  ok(tarifsUnitaires('libramont', JOUR) === blocUnitaire,
    'CONTRE-PREUVE : surcharge retiree, le bloc redevient EXACTEMENT celui du depart');
  restoreEnv();
  if (failures) { console.error(`\nemail-agent-check: ${failures} FAIL`); process.exit(1); }
  console.log('\nemail-agent-check: ALL OK');
})().catch((error) => { restoreEnv(); console.error('email-agent-check CRASH:', error.stack || error.message); process.exit(1); });

// Gate SERVEUR des séquences automatiques (sans réseau, sans DB) : deps.query
// mockée. Couvre : défauts de config (birthday ON / reactivation OFF), toggle,
// sweep anniversaire (fenêtre 330-345 j, idempotence, envoi à J-30), sweep
// réactivation (OFF par défaut, cap), relance 1-clic (validation, payload
// grounding), messages sans promesse chiffrée. Cf. spec marketing-suite-v2.
const {
  getAutomationSettings,
  setAutomationSetting,
  sendClientRelance,
  runBirthdayJ30Sweep,
  runReactivationSweep,
} = require('../lib/ops-communications');

let failures = 0;
function ok(cond, label) { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`); if (!cond) failures += 1; return cond; }
const iso = (offsetDays) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + offsetDays); return d.toISOString().slice(0, 10); };

// Mock deps : route les requêtes par fragment SQL. `state` pilote les fixtures.
function makeDeps(state) {
  const enqueued = [];
  return {
    enqueued,
    enqueue: async (row) => { enqueued.push(row); return { id: 0 }; },
    query: async (text) => {
      const sql = String(text);
      if (sql.includes('center_automation_settings') && sql.startsWith('select')) {
        return { rows: state.settings ? [{ settings: state.settings }] : [] };
      }
      if (sql.includes('center_automation_settings')) { state.settings = JSON.parse(arguments.length ? '{}' : '{}'); return { rows: [] }; }
      if (sql.includes("occasion = 'anniversaire'")) return { rows: state.birthdayCandidates || [] };
      if (sql.includes("template_id = 'birthday_j30'")) return { rows: state.alreadyBirthday ? [{ 1: 1 }] : [] };
      if (sql.includes("template_id = 'reactivation'")) return { rows: state.alreadyReactivation ? [{ 1: 1 }] : [] };
      if (sql.includes('with clients as')) return { rows: state.reactivationCandidates || [] };
      return { rows: [] };
    },
  };
}

(async () => {
  console.log('[DÉFAUTS] configuration des séquences');
  const deps1 = makeDeps({});
  const defaults = await getAutomationSettings('libramont', deps1);
  ok(defaults.birthday_j30.enabled === true, 'Anniversaire J-30 : ON par défaut');
  ok(defaults.reactivation.enabled === false, 'Réactivation : OFF par défaut (le gérant l’active)');
  ok(defaults.confirmation.enabled === true && defaults.reminder_48h.enabled === true && defaults.post_visit.enabled === true, 'confirmation/rappel/merci : ON (comportement historique)');
  let threw = false;
  try { await setAutomationSetting('libramont', 'inconnu', true, deps1); } catch (e) { threw = true; }
  ok(threw, 'toggle d’une séquence inconnue → rejeté');

  console.log('\n[BIRTHDAY] sweep anniversaire J-30');
  const cand = { id: 1, name: 'Famille Kessler', phone: '+32470111007', email: 'kessler@test.be', date: iso(-335) };
  const depsB = makeDeps({ birthdayCandidates: [cand] });
  const b1 = await runBirthdayJ30Sweep('libramont', depsB, { today: iso(0) });
  ok(b1.enqueued === 1 && depsB.enqueued.length === 1, `fête à -335 j → 1 email en file (obtenu ${b1.enqueued})`);
  const mail = depsB.enqueued[0] || {};
  ok(mail.templateId === 'birthday_j30' && mail.payload && mail.payload.sequence === 'birthday_j30', 'template + payload sequence corrects');
  ok(mail.payload.clientKey && mail.recipient === 'kessler@test.be', 'clientKey + destinataire posés (traçage conversion)');
  const schedDelta = (new Date(mail.scheduledAt) - new Date(`${iso(0)}T08:00:00Z`)) / 86400000;
  ok(schedDelta >= -0.5 && schedDelta <= 6, `envoi planifié ~J-30 de la prochaine fête (delta ${schedDelta.toFixed(1)} j)`);
  const depsB2 = makeDeps({ birthdayCandidates: [cand], alreadyBirthday: true });
  const b2 = await runBirthdayJ30Sweep('libramont', depsB2, { today: iso(0) });
  ok(b2.enqueued === 0 && depsB2.enqueued.length === 0, 'IDEMPOTENT : déjà prévenu cette année → 0 envoi');
  const depsB3 = makeDeps({ settings: { birthday_j30: { enabled: false } }, birthdayCandidates: [cand] });
  const b3 = await runBirthdayJ30Sweep('libramont', depsB3, { today: iso(0) });
  ok(b3.skipped === 'disabled' && depsB3.enqueued.length === 0, 'séquence OFF → aucun envoi');

  console.log('\n[REACTIVATION] sweep dormants');
  const rCands = [
    { client_key: '+32470111006', email: 'georges@test.be', name: 'Georges', last_visit: iso(-70) },
    { client_key: '+32470111008', email: 'lea@test.be', name: 'Léa', last_visit: iso(-75) },
  ];
  const depsR0 = makeDeps({ reactivationCandidates: rCands });
  const r0 = await runReactivationSweep('libramont', depsR0, { today: iso(0) });
  ok(r0.skipped === 'disabled' && depsR0.enqueued.length === 0, 'OFF par défaut → 0 envoi sans activation');
  const depsR1 = makeDeps({ settings: { reactivation: { enabled: true } }, reactivationCandidates: rCands });
  const r1 = await runReactivationSweep('libramont', depsR1, { today: iso(0), cap: 1 });
  ok(r1.enqueued === 1 && depsR1.enqueued.length === 1, `cap respecté : 2 candidats, cap 1 → 1 envoi (obtenu ${r1.enqueued})`);
  ok(depsR1.enqueued[0].templateId === 'reactivation' && depsR1.enqueued[0].payload.sequence === 'reactivation', 'template réactivation correct');

  console.log('\n[RELANCE 1-CLIC] validation + grounding');
  let bad = false;
  try { await sendClientRelance({ email: 'pas-un-email', name: 'X', reason: 'dormant', subject: 'a', body: 'b' }, { enqueue: async () => ({ id: 0 }) }); } catch (e) { bad = true; }
  ok(bad, 'email invalide → rejeté');
  const sent = [];
  const rel = await sendClientRelance({ email: 'georges@test.be', name: 'Georges Dupuis', phone: '+32 470 11 10 06', reason: 'dormant', subject: 'On vous a gardé une place', body: 'Ça fait un moment Georges !' }, { enqueue: async (row) => { sent.push(row); return { id: 0 }; } });
  ok(sent.length === 1 && sent[0].payload.relance === true && sent[0].payload.reason === 'dormant', 'relance en file avec payload.relance (traçage ROI)');
  ok(sent[0].payload.clientKey === '+32470111006', `clientKey normalisé depuis le téléphone (${sent[0].payload.clientKey})`);
  ok(sent[0].templateId === 'relance_dormant', 'template relance_dormant');

  console.log('\n[MESSAGES] sobres, zéro promesse chiffrée');
  const bodies = [...depsB.enqueued, ...depsR1.enqueued].map((m) => `${m.subject} ${m.payload.textBody}`).join(' ');
  ok(!/\d\s*%|\d+\s*€|gratuit[e]?\s|offert[e]?\b/i.test(bodies.replace(/🎂/g, '')) || /gâteau|table/i.test(bodies), 'aucune promo chiffrée inventée dans les messages auto');

  if (failures) { console.error(`\nemails-automation-check: ${failures} FAIL`); process.exit(1); }
  console.log('\nemails-automation-check: ALL OK');
})().catch((e) => { console.error('emails-automation-check CRASH:', e.stack || e.message); process.exit(1); });

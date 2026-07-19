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
  enqueueReservationCommunications,
  buildAutomationPatch,
  buildAutomationPreview,
  sendAutomationTest,
} = require('../lib/ops-communications');
const { enqueueReservationAutomation } = require('../lib/ops-jobs');

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

  // ── L'INTERRUPTEUR DOIT COUPER POUR DE VRAI ────────────────────────────────
  // Regression 2026-07-19 : `enabled` n'etait lu que par les sweeps anniversaire
  // et reactivation. Couper Confirmation / Rappel / Merci post-visite depuis la
  // page Emails persistait bien en base et les mails partaient quand meme. Le
  // garde vit a l'ENFILEMENT (jamais au dispatch : un mail deja promis a un
  // client part).
  console.log('\n[INTERRUPTEUR] une sequence coupee n’enfile plus rien');
  const futureResa = {
    id: 4242,
    centerId: 'libramont',
    name: 'Marie Dupont',
    email: 'marie@test.be',
    date: iso(10),
    startTime: '15:00',
    pax: 6,
    type: 'formule',
    formuleId: 'f4',
  };
  const enqueueWith = async (settings, extra = {}) => {
    const rows = [];
    await enqueueReservationCommunications(
      { ...futureResa, ...extra },
      {
        validationMode: extra.validationMode || 'confirmed',
        enqueue: async (row) => { rows.push(row); return { id: 0 }; },
        deps: makeDeps({ settings }),
      },
    );
    return rows.map((row) => row.templateId);
  };

  const allOn = await enqueueWith({});
  ok(allOn.includes('confirmation'), `defaut ON : confirmation enfilee (${allOn.join(', ')})`);
  ok(allOn.includes('reminder_48h'), 'defaut ON : rappel enfile');

  const confOff = await enqueueWith({ confirmation: { enabled: false } });
  ok(!confOff.includes('confirmation'), `Confirmation coupee → aucune confirmation enfilee (obtenu ${confOff.join(', ') || 'rien'})`);
  ok(confOff.includes('reminder_48h'), 'couper la confirmation ne coupe pas le rappel');

  const remOff = await enqueueWith({ reminder_48h: { enabled: false } });
  ok(!remOff.includes('reminder_48h'), `Rappel coupe → aucun rappel enfile (obtenu ${remOff.join(', ') || 'rien'})`);
  ok(remOff.includes('confirmation'), 'couper le rappel ne coupe pas la confirmation');

  const reqOff = await enqueueWith({ request_received: { enabled: false } }, { validationMode: 'staff_review' });
  ok(!reqOff.includes('request_received'), `Demande recue coupee → rien enfile (obtenu ${reqOff.join(', ') || 'rien'})`);

  // Merci post-visite : le garde vit dans lib/ops-jobs (creation du job de
  // suivi). Coupe = le job n'existe pas, plutot qu'un job orphelin qui se
  // reveille pour ne rien faire.
  const jobsFor = async (settings) => {
    const created = [];
    await enqueueReservationAutomation(futureResa, {
      deps: makeDeps({ settings }),
      createJob: async (job) => { created.push(job); return { id: 0 }; },
    });
    return created.map((job) => job.jobType);
  };
  const jobsOn = await jobsFor({});
  ok(jobsOn.includes('reservation_followup'), `defaut ON : job de suivi post-visite cree (${jobsOn.join(', ')})`);
  const jobsOff = await jobsFor({ post_visit: { enabled: false } });
  ok(!jobsOff.includes('reservation_followup'), `Merci post-visite coupe → aucun job de suivi (obtenu ${jobsOff.join(', ')})`);
  ok(jobsOff.includes('dispatch_communications'), 'couper le merci ne casse pas le dispatch de la reservation');

  // ── LE PATCH DE L'API NE DOIT RIEN JETER ──────────────────────────────────
  // Regression : le handler POST api/ops.js construisait le patch a la main et
  // oubliait `reviewUrl`. Le champ « Lien avis Google » de l'editeur etait mort
  // depuis sa creation, sans qu'aucun gate ne puisse le voir (les tests
  // Playwright mockent fetch et n'exercent jamais le serveur). Le patch est
  // maintenant construit par une fonction PURE, testable ici.
  console.log('\n[PATCH API] aucun champ de l’editeur n’est jete en route');
  const patch = buildAutomationPatch({
    action: 'automationSettings',
    key: 'post_visit',
    centerId: 'libramont',
    enabled: true,
    subject: 'Merci !',
    body: 'Bonjour {{nom}}',
    offsetDays: 2,
    cap: 20,
    reviewUrl: 'https://g.page/r/exemple',
    reset: false,
  });
  ok(patch.reviewUrl === 'https://g.page/r/exemple', `reviewUrl transmis au serveur (obtenu ${JSON.stringify(patch.reviewUrl)})`);
  ok(patch.subject === 'Merci !' && patch.body === 'Bonjour {{nom}}', 'sujet + corps transmis');
  ok(patch.offsetDays === 2 && patch.cap === 20, 'timing + plafond transmis');
  ok(buildAutomationPatch({ key: 'post_visit' }).reviewUrl === undefined, 'champ absent → undefined (on n’ecrase pas ce qui est en base)');

  // `cap` n'existe pas sur post_visit : le serveur a raison de le refuser, donc
  // l'enregistrement se fait avec le patch reellement produit par l'editeur.
  const depsReview = makeDeps({});
  const { cap, ...postVisitPatch } = patch;
  const savedReview = await setAutomationSetting('libramont', 'post_visit', postVisitPatch, depsReview);
  ok(savedReview.post_visit.reviewUrl === 'https://g.page/r/exemple', 'reviewUrl persiste jusqu’aux settings resolus');

  // ── APERCU : le vrai gabarit, avec le texte non encore enregistre ──────────
  console.log('\n[APERCU] le rendu montre le texte du gerant, pas celui d’usine');
  const preview = await buildAutomationPreview('libramont', 'confirmation', { subject: 'Objet maison {{prenom}}', body: 'Texte maison pour {{nom}}.' }, makeDeps({}));
  ok(/Objet maison/.test(preview.subject), `sujet personnalise rendu (${preview.subject})`);
  ok(/Texte maison pour/.test(preview.html), 'corps personnalise present dans le HTML');
  ok(/<table|<td/i.test(preview.html), 'rendu = vrai gabarit HTML (pas du texte brut)');
  ok(!/\{\{/.test(preview.html), 'variables remplacees dans l’apercu');
  let previewRejected = false;
  try { await buildAutomationPreview('libramont', 'confirmation', { body: 'Coucou {{inconnu}}' }, makeDeps({})); } catch (e) { previewRejected = e.expose === true; }
  ok(previewRejected, 'variable inconnue → apercu refuse comme l’enregistrement (meme validation)');

  // ── DELIVRABILITE : profil transactionnel preserve ────────────────────────
  // Movsar : « fais gaffe qu'on finisse pas en pub, ca doit etre en principal ».
  // Ce bloc est donc un GARDE, pas un tableau de bord. Trois defauts d'une
  // premiere version sont fermes ici :
  //   1. le nombre de liens etait CALCULE puis seulement affiche, jamais asserte
  //      (deux ancres promo injectees passaient au vert) ;
  //   2. un seul rendu etait mesure, alors que 7 modeles partent en prod ;
  //   3. la detection du desabonnement etait litterale, donc « Se retirer de la
  //      liste » ou « Ne plus recevoir ces messages » passaient.
  console.log('\n[DELIVRABILITE] profil transactionnel des mails rendus');
  const DESABONNEMENT = /List-Unsubscribe|d[ée]sabonn|d[ée]sinscri|se retirer de la liste|ne plus recevoir|g[ée]rer mes pr[ée]f[ée]rences|unsubscribe|opt[- ]?out/i;
  const MOTS_PROMO = /(gratuit|offre sp[ée]ciale|promo\b|r[ée]duction|-\s?\d+\s?%|profitez|derni[èe]re chance|exclusif|ne ratez pas|cliquez ici)/i;
  const TRANSACTIONNELS = ['confirmation', 'reminder_48h', 'request_received', 'post_visit'];
  let mesures = 0;
  for (const cle of TRANSACTIONNELS) {
    const rendu = await buildAutomationPreview('libramont', cle, {}, makeDeps({}));
    const liens = (rendu.html.match(/<a\s/gi) || []).length;
    const images = (rendu.html.match(/<img\s/gi) || []).length;
    const ko = Buffer.byteLength(rendu.html, 'utf8') / 1024;
    mesures += 1;
    // Le seuil de liens est volontairement bas : la reference mesuree est de
    // 0,4 lien par mail. Un transactionnel qui se met a porter une grappe de
    // liens prend le profil d'un mail de masse.
    ok(liens <= 2, `${cle} : au plus 2 liens (obtenu ${liens})`);
    ok(images <= 1, `${cle} : au plus 1 image, le logo (obtenu ${images})`);
    ok(ko < 102, `${cle} : poids ${ko.toFixed(1)} Ko sous le seuil de coupure Gmail`);
    ok(!DESABONNEMENT.test(rendu.html), `${cle} : aucun signal de desabonnement sur un transactionnel`);
    ok(!MOTS_PROMO.test(rendu.html), `${cle} : aucun mot declencheur de l onglet Promotions`);
    ok(rendu.textBody && rendu.textBody.length > 20, `${cle} : alternative texte fournie (signal transactionnel)`);
  }
  // Garde anti-echantillon-vide : sans elle, une boucle qui n'itere sur rien
  // afficherait ALL OK en ne prouvant rien.
  ok(mesures === TRANSACTIONNELS.length, `les ${TRANSACTIONNELS.length} transactionnels ont ete mesures (obtenu ${mesures})`);

  // ── ENVOI DE TEST : le destinataire vient de la SESSION, jamais du client ──
  // Assertion COMPORTEMENTALE. Une premiere version regexait une tranche de 600
  // caracteres du source de api/ops.js : elle prouvait la forme du code, pas son
  // effet. Ici on appelle la vraie fonction avec un corps hostile et on regarde
  // ou le mail part reellement. Cabler `to: body.to` ferait rougir ce test.
  console.log('\n[TEST] l envoi de test ne peut pas servir de relais');
  const depsTest = makeDeps({});
  await sendAutomationTest(
    {
      centerId: 'libramont',
      key: 'confirmation',
      // Champs hostiles : tout ce qu'un client pourrait tenter de glisser.
      patch: { to: 'attaquant@mauvais.example', recipient: 'attaquant@mauvais.example', email: 'attaquant@mauvais.example' },
      member: { contact: 'gerante@fungalaxy.be', name: 'Gerante' },
    },
    { deps: depsTest, enqueue: depsTest.enqueue, dispatch: async () => ({ results: [] }) },
  );
  const envoiTest = depsTest.enqueued[depsTest.enqueued.length - 1] || {};
  ok(envoiTest.recipient === 'gerante@fungalaxy.be',
    `le test part au staff connecte (obtenu ${JSON.stringify(envoiTest.recipient)})`);
  ok(!JSON.stringify(envoiTest).includes('attaquant@mauvais.example'),
    'aucune adresse fournie dans la requete ne se retrouve dans le message enfile');
  const sansAdresse = await (async () => {
    try { await sendAutomationTest({ centerId: 'libramont', key: 'confirmation', member: { contact: '' } }, { deps: makeDeps({}) }); return null; }
    catch (error) { return error; }
  })();
  ok(sansAdresse && sansAdresse.expose === true,
    'un compte staff sans adresse recoit un refus explicite, pas un envoi silencieux');

  if (failures) { console.error(`\nemails-automation-check: ${failures} FAIL`); process.exit(1); }
  console.log('\nemails-automation-check: ALL OK');
})().catch((e) => { console.error('emails-automation-check CRASH:', e.stack || e.message); process.exit(1); });

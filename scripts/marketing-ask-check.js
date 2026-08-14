// Le mode « Demander » : ce que l'agent a le droit de dire, et ce qui se passe
// quand il deborde.
//
// CE QUE CE GATE DEFEND, et pourquoi :
//
//  1. LA REPONSE EST ANCREE. Le dossier envoye au modele porte les faits REELS
//     du centre, lus des memes sources que le produit : catalogue d'activites
//     (activity-catalog), formules et prix (catalog-store), journees mesurees,
//     radar 14 j, panier moyen, veille. Et ses chiffres sont ecrits AVEC leur
//     unite, parce que c'est ce qui permet au controle d'apres coup de
//     reconnaitre un montant prouve.
//  2. UN FAUX FAIT EST REFUSE. Une activite que ce centre n'a pas, un prix ou
//     un pourcentage absent du dossier : la reponse ne s'affiche pas. Le bloc
//     [CONTRE-PREUVE PAR MUTATION] rejoue l'assertion honnete sur une reponse
//     MUTEE et exige qu'elle ROUGISSE. Une assertion qui reste verte sur une
//     donnee fausse ne prouve rien.
//  3. SANS MODELE, ZERO APPEL ET ZERO INVENTION. Pas de cle, budget au plafond :
//     le serveur rend `grounded: false` et n'appelle rien. Le navigateur reprend
//     son chemin deterministe.
//  4. LA FRONTIERE DES DONNEES TIENT. La question est du texte libre tape par le
//     gerant : elle peut nommer un client. L'appel part donc en `sensitive`, ce
//     qui ferme OpenRouter (modeles « :free » dont les fournisseurs peuvent
//     exploiter les requetes). Voir OPENROUTER_ALLOWED, lib/llm-client.js.
//
// Aucune cle IA ni base de donnees requise : le modele est injecte, le
// catalogue vient des fichiers socle. Ce sont les VRAIES longueurs de libelles
// (« Bowling Classique », pas « Bowling ») : une donnee de test plus courte que
// la vraie ne teste rien.

// Cle LLM chargee depuis un fichier d'environnement local, JAMAIS affichee, et
// SEULES les variables du fournisseur : ce gate ne doit pas pouvoir toucher une
// base de production par accident. Sans cle, le bloc [MODELE REEL] est saute et
// le reste du gate tourne quand meme : test:ops:all ne depend d'aucun secret.
const fs = require('fs');
const path = require('path');
const LLM_VARS = new Set(['KIMI_API_KEY', 'MOONSHOT_API_KEY', 'KIMI_MODEL', 'LLM_PROVIDER']);
for (const file of [process.env.PINLANE_ENV_FILE, '.env.local', '.env'].filter(Boolean)) {
  const target = path.isAbsolute(file) ? file : path.join(__dirname, '..', file);
  if (!fs.existsSync(target)) continue;
  for (const line of fs.readFileSync(target, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (match && LLM_VARS.has(match[1]) && match[2] && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^"|"$/g, '');
    }
  }
}

const {
  answerMarketingQuestion,
  buildAskDossier,
  checkAnswerGrounding,
} = require('../lib/marketing-ask');
const { llmProvider } = require('../lib/llm-client');
const { buildCenterFacts } = require('../lib/marketing-agents');
const { listBookingFormules } = require('../lib/catalog-store');
const { listCenterActivities } = require('../lib/activity-catalog');

let failures = 0;
function ok(cond, label, detail) {
  if (cond) { console.log(`ok    ${label}`); return cond; }
  failures += 1;
  console.log(`FAIL  ${label}`);
  if (detail) console.log(`      ${detail}`);
  return cond;
}

// Dans le bloc de mutation, la ligne DOIT afficher FAIL : c'est la preuve que
// l'assertion honnete a des dents. Si elle affiche ok sur une donnee fausse,
// c'est le gate qui est complaisant, et CE script compte alors un echec.
function shadow(cond, label) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  (attendu FAIL) ${label}`);
  if (cond) failures += 1;
}

// Le bundle du brief, aux vraies longueurs de la prod (explications de radar
// completes, libelles de jour entiers, sources de revenu nommees).
function briefBundle() {
  const today = '2026-08-14';
  const day = (offset) => {
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  };
  return {
    ok: true,
    centerId: 'libramont',
    today,
    dataDays: 210,
    medianVisitors: 40,
    pulse: {
      revenue30: 8334, visitors30: 540, avgBasket: 15.4,
      upcomingPax: 102, upcomingResa: 5, reservedRevenue: 2864,
      bestDay: { date: '2026-07-11', revenue: 4009, visitors: 234 },
    },
    facts: {
      bestDay: { dow: 6, label: 'samedi', avgVisitors: 128, vsMedianPct: 121, confidence: 'solide' },
      worstDay: { dow: 2, label: 'mardi', avgVisitors: 34, vsMedianPct: -41, confidence: 'solide' },
      weather: { rainEffectPct: 12, heatEffectPct: -8, confidence: 'solide', sampleDays: 210 },
      holidayEffectPct: -6, holidayEffectConfidence: 'signal', trend4w: { pct: 9 }, bestMonth: null,
    },
    radar: [
      { date: day(0), dow: 4, level: 'normal', tmax: 19, precipMm: 0, event: '', resaCount: 6, explanation: 'Jeudi 14 : journee normale attendue, 6 personnes deja posees.' },
      { date: day(2), dow: 6, level: 'fort', tmax: 27, precipMm: 0, event: '', resaCount: 34, explanation: 'Samedi 16 : grosse journee attendue, 34 personnes deja posees.' },
      { date: day(4), dow: 1, level: 'creux', tmax: 17, precipMm: 12, event: '', resaCount: 0, explanation: 'Lundi 18 : tres calme attendu, jour structurellement faible. Rien de pose.' },
      { date: day(8), dow: 5, level: 'normal', tmax: 21, precipMm: 0, event: 'Foire de Libramont (a 5 min)', resaCount: 4, explanation: 'Vendredi 22 : la Foire de Libramont se tient a 5 minutes, flux de passage attendu.' },
    ],
    patterns: [
      { context: 'Post FB - evenement local', kind: 'post', channel: 'facebook', netDeltaPct: 22, basis: 'net', n: 3, confidence: 'signal' },
      { context: 'Email - jour calme', kind: 'email', channel: 'email', netDeltaPct: 14, basis: 'brut', n: 4, confidence: 'signal' },
    ],
    paie: { euros: 1240, venues: 5, sent: 17, reviewClicks: 4, days: 30, young: false, quietWindow: false, firstVerdictDate: 'jeudi 28 aout' },
    veille: { count: 2, changed: [{ name: 'Bowling Arlon', diff: 'Nouvelle offre etudiants le mercredi, annoncee sur leur page d\'accueil.' }] },
    propositions: [
      { key: 'plan:social-1', whyShort: 'Lundi s\'annonce tres calme, je posterais samedi pour le remplir.', network: 'facebook', targetDate: day(4) },
    ],
    receipts: [
      { id: 31, label: 'Post pluie du 03/07', tone: 'good', result: '+18 % de monde' },
    ],
  };
}

// Une reponse ANCREE : chaque chiffre est recopie du dossier.
const GOOD_ANSWER = {
  titre: 'Lundi 18 : le jour a remplir',
  reponse: 'Lundi 18 est ta journee la plus faible des quatorze prochains jours : rien n\'est pose et 12 mm de pluie sont annonces. Ton panier moyen est de 15.4 €, donc chaque visiteur ramene ce jour-la vaut ce montant. Je te prepare un post bowling pour samedi, tu le valides et tu le publies.',
  faits: ['lundi 18 : 0 personne posee, 12 mm de pluie annonces', 'panier moyen mesure : 15.4 €', 'mardi est ton jour le plus creux, -41 % vs la mediane'],
  jeNeSaisPas: ['Je n\'ai pas de mesure de l\'effet d\'un post sur un lundi precisement.'],
  action: 'creer_post',
};

function deps({ answer, calls, provider = 'kimi', exhausted = false }) {
  return {
    llmProvider: () => provider,
    isBudgetExhausted: () => exhausted,
    buildMarketingBriefBundle: async (centerId, options, injected) => {
      calls.push({ kind: 'brief', centerId, options, injected });
      return briefBundle();
    },
    // Catalogue REEL du socle : les vraies formules, leurs vrais prix, les vrais
    // noms d'activites de CE centre.
    getMergedFormulas: async () => listBookingFormules(),
    callLlmJson: async (options) => {
      calls.push({ kind: 'llm', options });
      return answer ? { ...answer, _provider: 'kimi', _model: 'kimi-k2.6' } : null;
    },
  };
}

(async () => {
  const facts = buildCenterFacts('libramont');
  const formulas = listBookingFormules();
  const activities = listCenterActivities('libramont');

  console.log('[DOSSIER] les faits reels du centre, chiffres avec leur unite');
  const dossier = buildAskDossier({ bundle: briefBundle(), centerFacts: facts, formulas, activities });
  ok(dossier.centre.activitesDisponibles.length >= 5,
    `le catalogue reel du centre est charge (${dossier.centre.activitesDisponibles.length} activites)`,
    JSON.stringify(dossier.centre.activitesDisponibles));
  ok(!JSON.stringify(dossier).toLowerCase().includes('karting'),
    'aucune activite absente du centre ne rentre dans le dossier');
  ok(dossier.formules.length > 0 && dossier.formules.every((f) => f.nom.length > 3),
    `les formules du socle sont la, avec leurs vrais libelles (${dossier.formules.length}, ex. "${(dossier.formules[0] || {}).nom}")`);
  ok(dossier.formules.some((f) => /€/.test(f.prix)),
    `les prix des formules portent leur unite (ex. ${(dossier.formules.find((f) => /€/.test(f.prix)) || {}).prix})`);
  ok(dossier.pouls.panierMoyen === '15.4 €', `le panier moyen est ecrit avec son unite (${dossier.pouls.panierMoyen})`);
  ok(/\+12 %/.test(String(dossier.faitsMesures.effetPluie)),
    `l'effet mesure de la pluie porte son pourcentage (${dossier.faitsMesures.effetPluie})`);
  ok(dossier.radar14j.length === 4 && dossier.radar14j[2].pluie === '12 mm',
    'le radar garde la pluie annoncee, avec son unite');
  ok(dossier.veille.changementsRecents.length === 1 && /offre etudiants/i.test(dossier.veille.changementsRecents[0].changement),
    'la veille concurrentielle reelle est dans le dossier');

  console.log('\n[REPONSE ANCREE] elle passe, et elle dit ce qu\'elle a lu');
  let calls = [];
  const good = await answerMarketingQuestion('libramont', { question: 'Comment je remplis lundi ?' }, deps({ answer: GOOD_ANSWER, calls }));
  ok(good.grounded === true, 'une reponse ancree est acceptee', JSON.stringify(good.blockers || good.reason || ''));
  ok(good.answer && /15\.4 €/.test(good.answer.reponse), 'elle cite un chiffre reel du centre');
  ok((good.answer.jeNeSaisPas || []).length === 1, 'elle dit ce qu\'elle ne sait pas');
  ok(good.answer.action === 'creer_post', 'elle propose une suite d\'ecran de la liste fermee');
  ok(good.basis && good.basis.joursMesures === 210 && good.basis.formules === dossier.formules.length,
    'la base de la reponse est rendue (jours mesures, formules) : le gerant voit d\'ou ca sort');

  console.log('\n[FRONTIERE DES DONNEES] la question libre ne sort jamais vers un modele ouvert');
  const llmCall = calls.find((c) => c.kind === 'llm');
  ok(llmCall && llmCall.options.usage === 'sensitive',
    'l\'appel est declare `sensitive` : OPENROUTER_ALLOWED le ferme aux modeles « :free »');
  const briefCall = calls.find((c) => c.kind === 'brief');
  ok(briefCall && briefCall.injected && briefCall.injected.skipPolish === true,
    'le brief est monte sans polissage : une question ne paie pas DEUX appels modele');

  console.log('\n[CONTRE-PREUVE PAR MUTATION] un faux fait fait ROUGIR le controle');
  // Mutation 1 : une activite que Libramont n'a pas.
  calls = [];
  const mutedActivity = await answerMarketingQuestion('libramont', { question: 'Comment je remplis lundi ?' }, deps({
    calls,
    answer: { ...GOOD_ANSWER, reponse: 'Mets en avant ton karting et ta realite virtuelle lundi, ca remplit toujours.' },
  }));
  shadow(mutedActivity.grounded === true, 'la reponse qui cite le karting serait affichee');
  ok(mutedActivity.grounded === false && mutedActivity.reason === 'bloque',
    'MUTATION activite : la reponse est REFUSEE');
  ok((mutedActivity.blockers || []).some((b) => /karting/i.test(b)),
    'le motif du refus est rendu, pas avale', JSON.stringify(mutedActivity.blockers));

  // Mutation 2 : un prix que le centre n'a jamais decide.
  calls = [];
  const mutedPrice = await answerMarketingQuestion('libramont', { question: 'Je propose quoi lundi ?' }, deps({
    calls,
    answer: { ...GOOD_ANSWER, reponse: 'Lance une partie a 7 € lundi, c\'est le bon prix d\'appel.' },
  }));
  shadow(mutedPrice.grounded === true, 'la reponse qui invente un prix de 7 € serait affichee');
  ok(mutedPrice.grounded === false && (mutedPrice.blockers || []).some((b) => /7 €/.test(b)),
    'MUTATION prix : le montant absent du dossier bloque la reponse', JSON.stringify(mutedPrice.blockers));

  // Mutation 3 : un pourcentage invente, glisse dans les FAITS et non dans le
  // corps. Le controle relit titre + reponse + faits : une invention rangee
  // dans la liste des preuves est exactement celle qu'il faut attraper.
  calls = [];
  const mutedPct = await answerMarketingQuestion('libramont', { question: 'La pluie, ca change quoi ?' }, deps({
    calls,
    answer: { ...GOOD_ANSWER, faits: ['la pluie te fait -35 % de frequentation'] },
  }));
  shadow(mutedPct.grounded === true, 'le -35 % invente, range dans les faits, serait affiche');
  ok(mutedPct.grounded === false && (mutedPct.blockers || []).some((b) => /35%|35 %/.test(b)),
    'MUTATION pourcentage : un chiffre invente dans les faits bloque aussi', JSON.stringify(mutedPct.blockers));

  // Le controle lui-meme, hors flux : un chiffre VRAI ne doit jamais bloquer.
  const control = checkAnswerGrounding('Ton panier moyen est de 15,4 € et la pluie te fait +12 %.', { centerFacts: facts, dossier });
  ok(control.blocked === false, 'CONTRE-PREUVE inverse : les vrais chiffres du dossier passent', JSON.stringify(control.reasons));

  console.log('\n[SANS MODELE] zero appel, zero invention, le filet deterministe reprend');
  calls = [];
  const noKey = await answerMarketingQuestion('libramont', { question: 'Comment je remplis lundi ?' }, deps({ answer: GOOD_ANSWER, calls, provider: null }));
  ok(noKey.grounded === false && noKey.reason === 'sans_modele', 'sans cle : grounded=false, motif dit');
  ok(calls.length === 0, 'sans cle : AUCUN appel, pas meme le montage du dossier');

  calls = [];
  const broke = await answerMarketingQuestion('libramont', { question: 'Comment je remplis lundi ?' }, deps({ answer: GOOD_ANSWER, calls, exhausted: true }));
  ok(broke.grounded === false && broke.reason === 'budget', 'budget au plafond : grounded=false, motif dit');
  ok(calls.length === 0, 'budget au plafond : AUCUN appel (le garde-fou de lib/llm-budget tient)');

  calls = [];
  const dead = await answerMarketingQuestion('libramont', { question: 'Comment je remplis lundi ?' }, deps({ answer: null, calls }));
  ok(dead.grounded === false && dead.reason === 'echec', 'modele muet : grounded=false, aucune reponse inventee');

  console.log('\n[GARDE D\'ENTREE] une question vide n\'atteint jamais le modele');
  calls = [];
  let thrown = null;
  try {
    await answerMarketingQuestion('libramont', { question: 'ok' }, deps({ answer: GOOD_ANSWER, calls }));
  } catch (error) { thrown = error; }
  ok(thrown && thrown.statusCode === 400 && calls.length === 0, 'question de moins de 4 caracteres : refusee avant tout appel');

  // ── Le seul bloc qui fait parler le VRAI modele ───────────────────────────
  // Tout ce qui precede teste la plomberie avec un modele injecte. Un mock ne
  // peut pas dire si Kimi, nourri du vrai catalogue de ce centre, ecrit une
  // reponse qui SURVIT au controle : il pourrait la faire echouer a chaque fois
  // et personne ne le saurait avant la prod. Cout : 3 appels, de l'ordre de
  // 0,01 $. Sans cle : saute proprement.
  if (!llmProvider('sensitive')) {
    console.log('\n[MODELE REEL] SKIP (aucune cle LLM dans l\'environnement)');
  } else {
    console.log('\n[MODELE REEL] Kimi, nourri du vrai catalogue, passe le controle');
    const realDeps = {
      buildMarketingBriefBundle: async () => briefBundle(),
      getMergedFormulas: async () => listBookingFormules(),
    };
    for (const question of [
      'Comment je remplis lundi 18 ?',
      'Est-ce que ca vaut le coup de pousser les anniversaires ados en ce moment ?',
      'Quelle est la capitale du Danemark ?',
    ]) {
      const real = await answerMarketingQuestion('libramont', { question }, realDeps);
      if (!ok(real.grounded === true, `« ${question} » : la reponse du modele passe le controle`,
        `motif : ${real.reason}${real.blockers ? ' / ' + JSON.stringify(real.blockers) : ''}`)) continue;
      console.log(`      [${real.provider}/${real.model}] ${real.answer.titre}`);
      console.log(`      "${real.answer.reponse.slice(0, 160)}"`);
      console.log(`      faits : ${JSON.stringify(real.answer.faits)}`);
      console.log(`      ne sait pas : ${JSON.stringify(real.answer.jeNeSaisPas)}`);
      const DASH_RE = new RegExp('[\\u2014\\u2013]');
      ok(!DASH_RE.test(real.answer.reponse), '      zero tiret cadratin dans la sortie');
      if (/danemark/i.test(question)) {
        // La question hors perimetre : l'agent DIT qu'il ne sait pas au lieu de
        // repondre « Copenhague ». C'est la loi produit, pas une preference.
        ok(!/copenhague/i.test(`${real.answer.titre} ${real.answer.reponse} ${real.answer.faits.join(' ')}`)
          && (real.answer.jeNeSaisPas.length > 0 || /pas mon sujet|ne sais pas|aucune donn/i.test(real.answer.reponse)),
          '      hors perimetre : il refuse de repondre au lieu d\'inventer');
      } else {
        ok(real.answer.faits.length > 0, '      elle cite au moins un fait du dossier');
      }
    }
  }

  console.log(`\nmarketing-ask-check: ${failures ? `${failures} FAIL` : 'ALL OK'}`);
  process.exit(failures ? 1 : 0);
})().catch((error) => {
  console.error('marketing-ask-check: CRASH', error && error.stack);
  process.exit(1);
});

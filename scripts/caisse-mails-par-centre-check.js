// LA PART D UN CENTRE DANS LA CAISSE DES MAILS (2026-11-18, avant-lancement B1).
//
// La caisse IA des mails (5 USD par mois par defaut) etait commune a tous les centres. Quelques centaines
// de faux mails envoyes a UN centre la vidaient, et tous les centres retombaient sur la reponse type
// jusqu a la fin du mois. Chaque centre y a maintenant sa part (la moitie de la caisse par defaut,
// LLM_MAILS_CENTRE_BUDGET_USD pour un montant fixe), rangee dans llm_spend sur sa propre ligne
// (« AAAA-MM:mails:<centre> »), sans migration. Le plafond de la caisse reste.
//
// [P] LA PART (lib/llm-budget.js) : un centre qui a use sa part se tait, les autres non ; la depense
//     s ecrit sur la caisse et sur la part ; la caisse plafonne toujours ; la part se relit a froid.
// [L] L APPEL (lib/llm-client.js, callLlm) : le centre qui a use sa part ne joint plus le modele, un
//     autre centre le joint et paie sur sa part.
// [M] LE MAIL RECU (lib/email-agent.js, analyzeEmail, avec la lecture de lib/email-verifications.js) :
//     le centre vide repond par la reponse type sans appel, l autre centre garde l IA, chaque appel de
//     son mail compte sur sa part.
// [D] LES DEMANDES DE GROUPE (lib/demande-bureau.js, lib/demande-bureau-centre.js) : elles puisent dans
//     la meme caisse, sur la part de leur centre.
// [R] LE RELEVE DU FONDATEUR (lib/founder-cockpit.js) : les lignes des parts ne poussent pas le mois en
//     cours hors de son releve.
//
// Rien ne part : la base est une fausse piscine, le modele une fausse adresse, la cle une chaine de banc.
// Les contre-preuves chargent le code mute en memoire : aucun fichier n est ecrit.
// Lancement : node scripts/caisse-mails-par-centre-check.js [--contre-preuves]

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Module = require('module');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
['DATABASE_URL', 'POSTGRES_URL', 'KIMI_API_KEY', 'MOONSHOT_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'LLM_PROVIDER',
  'ANTHROPIC_MAILS_MODEL', 'ANTHROPIC_MAILS_EFFORT', 'LLM_MAILS_CENTRE_BUDGET_USD'].forEach((cle) => { delete process.env[cle]; });

const MUTATIONS = {
  'part-ignoree': { f: 'lib/llm-budget.js', de: '  return Boolean(centreDe(poste, centre)) && getMonthlySpend(poste, centre) >= plafondDuCentre(poste);', vers: '  return false;', lettre: 'P' },
  'part-non-ecrite': { f: 'lib/llm-budget.js', de: '  const lignes = centreDe(poste, centre) ? [ensureMonth(poste), ensureMonth(poste, centre)] : [ensureMonth(poste)];', vers: '  const lignes = [ensureMonth(poste)];', lettre: 'P' },
  'caisse-oubliee': { f: 'lib/llm-budget.js', de: '  if (getMonthlySpend(poste) >= monthlyBudgetUsd(poste)) return true;\n', vers: '  if (!centreDe(poste, centre) && getMonthlySpend(poste) >= monthlyBudgetUsd(poste)) return true;\n', lettre: 'P' },
  'part-pas-relue': { f: 'lib/llm-budget.js', de: "      const { month } = ligneDe(p, c);", vers: "      const { month } = ligneDe(p, '');", lettre: 'P' },
  'appel-sans-centre': { f: 'lib/llm-client.js', de: '  if (isBudgetExhausted(budget, centre)) return null;', vers: '  if (isBudgetExhausted(budget)) return null;', lettre: 'L' },
  'depense-sans-centre': { f: 'lib/llm-client.js', de: 'recordSpend(computeCallCost(payload?.usage, model), budget, centre);', vers: 'recordSpend(computeCallCost(payload?.usage, model), budget);', lettre: 'L' },
  'ecriture-sans-centre': { f: 'lib/email-agent.js', de: '      centre: centerId,\n      model: modeleEcrit,', vers: '      model: modeleEcrit,', lettre: 'M' },
  'lecture-sans-centre': { f: 'lib/email-verifications.js', de: '      centre: centerId,\n      model: modele,', vers: '      model: modele,', lettre: 'M' },
  'reponse-de-demande-sans-centre': { f: 'lib/demande-bureau.js', de: '        centre: item && item.centerId,\n', vers: '', lettre: 'D' },
  'choix-de-demande-sans-centre': { f: 'lib/demande-bureau-centre.js', de: "        budget: 'mails',\n        centre: centerId,\n", vers: "        budget: 'mails',\n", lettre: 'D' },
  'releve-avec-les-parts': { f: 'lib/founder-cockpit.js', de: "    where month not like '%:%:%'\n    order by month desc\n    limit 6;", vers: '    order by month desc\n    limit 6;', lettre: 'R' },
};
const MUTATION = (process.argv.find((a) => a.startsWith('--mutation=')) || '').slice('--mutation='.length);
if (MUTATION && !MUTATIONS[MUTATION]) { console.error(`mutation inconnue : ${MUTATION}`); process.exit(2); }
function muter(fichier, texte) {
  const m = MUTATION ? MUTATIONS[MUTATION] : null;
  const t = String(texte).split('\r\n').join('\n');
  if (!m || path.resolve(fichier) !== path.join(ROOT, m.f)) return t;
  if (t.split(m.de).length !== 2) throw new Error(`ANCRE DE MUTATION absente ou multiple (${MUTATION}) dans ${m.f}`);
  return t.split(m.de).join(m.vers);
}
const compiler = Module.prototype._compile;
Module.prototype._compile = function compilerMute(contenu, fichier) {
  return compiler.call(this, muter(fichier, contenu), fichier);
};

let rouges = 0;
let lettre = '';
function section(titre) { lettre = (titre.match(/^\[([A-Z])\]/) || [])[1] || ''; console.log(`\n${titre}`); }
function ok(condition, quoi, detail) {
  if (condition) { console.log(`ok    ${quoi}`); return; }
  rouges += 1;
  console.log(`ROUGE [${lettre}] ${quoi}${detail !== undefined ? ` : ${String(detail).slice(0, 300)}` : ''}`);
}

if (process.argv.includes('--contre-preuves')) {
  const temoin = spawnSync(process.execPath, [__filename], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  if (temoin.status !== 0) { console.log(`${temoin.stdout || ''}${temoin.stderr || ''}`.split('\n').filter((l) => /ROUGE|Error/.test(l)).join('\n')); console.log('\ncaisse-mails-par-centre-check --contre-preuves: le gate est rouge sans mutation, aucune contre-preuve ne compte'); process.exit(1); }
  let rates = 0;
  for (const [nom, m] of Object.entries(MUTATIONS)) {
    const r = spawnSync(process.execPath, [__filename, `--mutation=${nom}`], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
    const sortie = `${r.stdout || ''}${r.stderr || ''}`;
    const mord = r.status === 1 && sortie.includes(`ROUGE [${m.lettre}]`) && !/ANCRE DE MUTATION/.test(sortie);
    if (!mord) rates += 1;
    console.log(`${mord ? 'TUEE ' : 'VIVANTE'} ${nom} (attendu : ROUGE [${m.lettre}], sortie ${r.status})${mord ? '' : `\n${sortie.split('\n').filter((l) => /ROUGE|ANCRE|Error/.test(l)).slice(0, 6).join('\n')}`}`);
  }
  console.log(rates ? `\ncaisse-mails-par-centre-check --contre-preuves: ${rates} mutation(s) vivante(s)` : '\ncaisse-mails-par-centre-check --contre-preuves: ALL OK - chaque regle retiree fait rougir sa lettre');
  process.exit(rates ? 1 : 0);
}

// ── La base, sans la base : llm_spend tenue en memoire ──
const MOIS = new Date().toISOString().slice(0, 7);
const ecritures = [];
const enBase = new Map();
const fauxPool = {
  async query(sql, params = []) {
    const q = String(sql).replace(/\s+/g, ' ').trim();
    if (q.startsWith('insert into llm_spend')) {
      ecritures.push(params[0]);
      enBase.set(params[0], (enBase.get(params[0]) || 0) + Number(params[1]));
      return { rows: [] };
    }
    if (q.startsWith('select cost_usd from llm_spend where month = $1')) {
      return { rows: enBase.has(params[0]) ? [{ cost_usd: String(enBase.get(params[0])) }] : [] };
    }
    return { rows: [] };
  },
};
const cheminBase = require.resolve(path.join(ROOT, 'lib/database.js'));
require.cache[cheminBase] = { id: cheminBase, filename: cheminBase, loaded: true, exports: { ...require(cheminBase), getPool: () => fauxPool } };

const budget = require('../lib/llm-budget');
const tours = () => new Promise((r) => setImmediate(r));
async function aZero() {
  budget.__resetForTests();
  ecritures.length = 0;
  enBase.clear();
  await tours();
}

// Une fausse adresse du modele : elle compte les appels et rend une reponse valide avec sa consommation.
function fauxModele(json) {
  const f = async () => {
    f.appels += 1;
    return { ok: true, json: async () => ({ stop_reason: 'end_turn', usage: { input_tokens: 20000, output_tokens: 800 }, content: [{ type: 'text', text: JSON.stringify(json) }] }) };
  };
  f.appels = 0;
  return f;
}

async function principal() {
  process.env.LLM_MAILS_BUDGET_USD = '1';

  section('[P] LA PART D UN CENTRE (lib/llm-budget.js)');
  await aZero();
  ok(budget.plafondDuCentre('mails') === 0.5, 'la part d un centre vaut la moitie de la caisse par defaut', budget.plafondDuCentre('mails'));
  budget.recordSpend(0.5, 'mails', 'libramont');
  ok(budget.isBudgetExhausted('mails', 'libramont') && !budget.isBudgetExhausted('mails', 'gembloux') && !budget.isBudgetExhausted('mails'),
    'un centre qui a use sa part se tait, les autres centres et la caisse gardent la leur',
    JSON.stringify({ libramont: budget.isBudgetExhausted('mails', 'libramont'), gembloux: budget.isBudgetExhausted('mails', 'gembloux'), caisse: budget.isBudgetExhausted('mails') }));
  ok(JSON.stringify(ecritures) === JSON.stringify([`${MOIS}:mails`, `${MOIS}:mails:libramont`]), 'la depense s ecrit sur la ligne de la caisse et sur celle de la part du centre', JSON.stringify(ecritures));
  budget.recordSpend(0.45, 'mails', 'gembloux');
  budget.recordSpend(0.06, 'mails', 'ciney');
  ok(budget.isBudgetExhausted('mails', 'ciney') && budget.isBudgetExhausted('mails'), 'le plafond de la caisse reste, la caisse pleine fait taire un centre qui n a entame sa part que de 6 cents',
    JSON.stringify({ ciney: budget.getMonthlySpend('mails', 'ciney'), caisse: budget.getMonthlySpend('mails') }));
  process.env.LLM_MAILS_CENTRE_BUDGET_USD = '0.2';
  const fixe = budget.plafondDuCentre('mails');
  process.env.LLM_MAILS_CENTRE_BUDGET_USD = '5';
  const auDessus = budget.plafondDuCentre('mails');
  delete process.env.LLM_MAILS_CENTRE_BUDGET_USD;
  ok(fixe === 0.2 && auDessus === 1, 'LLM_MAILS_CENTRE_BUDGET_USD fixe la part, jamais au-dessus de la caisse', JSON.stringify({ fixe, auDessus }));
  await aZero();
  enBase.set(`${MOIS}:mails`, 0.6);
  enBase.set(`${MOIS}:mails:libramont`, 0.55);
  budget.isBudgetExhausted('mails', 'libramont');
  budget.isBudgetExhausted('mails', 'gembloux');
  await tours();
  await tours();
  ok(budget.isBudgetExhausted('mails', 'libramont') && !budget.isBudgetExhausted('mails', 'gembloux'), 'apres un demarrage a froid, la part de chaque centre se relit sur sa ligne de llm_spend',
    JSON.stringify({ libramont: budget.getMonthlySpend('mails', 'libramont'), gembloux: budget.getMonthlySpend('mails', 'gembloux') }));
  await aZero();
  budget.recordSpend(0.1, 'garde', 'libramont');
  ok(JSON.stringify(ecritures) === JSON.stringify([`${MOIS}:garde`]), 'les autres caisses n ont pas de part par centre', JSON.stringify(ecritures));

  section('[L] L APPEL (lib/llm-client.js, callLlm)');
  process.env.ANTHROPIC_API_KEY = 'cle-de-banc';
  const { callLlm } = require('../lib/llm-client');
  await aZero();
  budget.recordSpend(0.5, 'mails', 'libramont');
  ecritures.length = 0;
  const modele = fauxModele({ ok: true });
  const vide = await callLlm({ user: 'Bonjour', usage: 'mails', budget: 'mails', centre: 'libramont', fetchImpl: modele });
  ok(vide === null && modele.appels === 0, 'le centre qui a use sa part ne joint plus le modele', JSON.stringify({ rendu: vide, appels: modele.appels }));
  const plein = await callLlm({ user: 'Bonjour', usage: 'mails', budget: 'mails', centre: 'gembloux', fetchImpl: modele });
  ok(plein && modele.appels === 1 && ecritures.includes(`${MOIS}:mails`) && ecritures.includes(`${MOIS}:mails:gembloux`), 'un autre centre le joint encore, et sa depense va sur la caisse et sur sa part', JSON.stringify({ appels: modele.appels, ecritures }));

  section('[M] LE MAIL RECU (lib/email-agent.js, analyzeEmail)');
  const { analyzeEmail } = require('../lib/email-agent');
  const deps = { query: async () => ({ rows: [] }) };
  const mail = { from: 'client@exemple.invalid', subject: 'Bowling samedi', body: 'Bonjour, avez-vous encore de la place samedi apres-midi pour notre groupe ? Merci.' };
  const reponse = { intent: 'reservation', summary: 'Demande de place', urgency: 'normale', question: '', faitsUtilises: [], alerte: '', reply: { subject: 'Votre venue', body: 'Bonjour, merci pour votre message. L equipe vous repond au plus vite.' } };
  await aZero();
  budget.recordSpend(0.5, 'mails', 'libramont');
  ecritures.length = 0;
  const auVide = fauxModele(reponse);
  const repli = await analyzeEmail({ ...mail, centerId: 'libramont', deps, fetchImpl: auVide }).catch((e) => ({ erreur: e.message }));
  ok(auVide.appels === 0 && repli.repli === 'modele-muet', 'le centre qui a use sa part repond par la reponse type, sans joindre le modele', JSON.stringify({ appels: auVide.appels, repli: repli.repli, erreur: repli.erreur }));
  const vivant = fauxModele(reponse);
  const analyse = await analyzeEmail({ ...mail, centerId: 'gembloux', deps, fetchImpl: vivant }).catch((e) => ({ erreur: e.message }));
  const surLaCaisse = ecritures.filter((k) => k === `${MOIS}:mails`).length;
  const surLaPart = ecritures.filter((k) => k === `${MOIS}:mails:gembloux`).length;
  ok(vivant.appels >= 2 && surLaCaisse === vivant.appels && surLaPart === vivant.appels && !analyse.repli,
    'un autre centre garde l IA, et chaque appel de son mail (lecture et ecriture) compte sur sa part',
    JSON.stringify({ appels: vivant.appels, surLaCaisse, surLaPart, repli: analyse.repli, erreur: analyse.erreur }));

  section('[D] LES DEMANDES DE GROUPE (lib/demande-bureau.js, lib/demande-bureau-centre.js)');
  const B = require('../lib/demande-bureau');
  const C = require('../lib/demande-bureau-centre');
  const vus = [];
  const llm = async (options) => { vus.push(options); return null; };
  const demande = {
    id: 7, centerId: 'gembloux', contactName: 'Client de banc', email: 'client@exemple.invalid', phone: '', pax: 20, status: 'new', message: '', createdAt: '2030-04-30T08:00:00.000Z',
    payload: { demande: { version: 1, groupType: 'ecole', participants: 20, date: '2030-05-15', moment: 'apres-midi', formulas: [], activities: [{ id: 'bowling', name: 'Bowling' }] } },
  };
  const cerveau = { stable: 'REGLES.', context: 'FAITS.', signature: 'L equipe', centerName: 'Fun Galaxy Gembloux' };
  await B.redigerReponse({ item: demande, etude: { dates: [] }, client: null, conversation: [], brain: cerveau, llm, nomDuCentre: 'Fun Galaxy Gembloux', essais: 1 }).catch(() => null);
  const reponses = vus.splice(0);
  ok(reponses.length === 1 && reponses[0].budget === 'mails' && reponses[0].centre === 'gembloux', 'la reponse a une demande de groupe puise sur la part de son centre', JSON.stringify(reponses.map((o) => ({ budget: o.budget, centre: o.centre }))));
  const { getSchedule } = require('../lib/booking-config');
  const depsDemande = {
    rafraichir: async () => {}, centre: () => null, fermetures: async () => [], getSchedule, isCenterClosedAt: () => false,
    disponibilite: async () => ({ status: 200, json: { ok: true, slots: [] } }), planning: async () => ({ reservations: [] }),
    aujourdhui: () => '2030-05-01', client: async () => null, conversation: async () => [], cerveau: async () => null,
    catalogue: () => ({ formules: [], activites: [{ id: 'bowling', name: 'Bowling' }] }), llm,
  };
  await C.assisterLaDemande(demande, depsDemande).catch(() => null);
  const choix = vus.splice(0);
  ok(choix.length >= 1 && choix.every((o) => o.budget === 'mails' && o.centre === 'gembloux'), 'le choix de l assistant d une demande puise sur la part de son centre', JSON.stringify(choix.map((o) => ({ budget: o.budget, centre: o.centre }))));

  section('[R] LE RELEVE DU FONDATEUR (lib/founder-cockpit.js, loadCost)');
  const fichier = path.join(ROOT, 'lib', 'founder-cockpit.js');
  const source = muter(fichier, fs.readFileSync(fichier, 'utf8'));
  const debut = source.indexOf('async function loadCost(pool) {');
  const fin = source.indexOf('\n}\n', debut);
  if (debut < 0 || fin < 0) throw new Error('fonction absente : loadCost');
  const lignes = [`${MOIS}`, `${MOIS}:mails`, `${MOIS}:garde`, `${MOIS}:assistant`, `${MOIS}:mails:libramont`, `${MOIS}:mails:gembloux`, `${MOIS}:mails:ciney`, '2000-01']
    .map((month, i) => ({ month, cost_usd: String(i === 0 ? 1.25 : 0.1), calls: 1, updated_at: new Date() }));
  const releve = {
    async query(sql) {
      const q = String(sql).replace(/\s+/g, ' ');
      const limite = Number((q.match(/limit (\d+)/) || [])[1]) || 1000;
      const gardees = /where month not like '%:%:%'/.test(q) ? lignes.filter((l) => l.month.split(':').length < 3) : lignes;
      return { rows: gardees.slice().sort((a, b) => (a.month < b.month ? 1 : -1)).slice(0, limite) };
    },
  };
  const bac = { monthlyBudgetUsd: () => 5, toIso: (d) => new Date(d).toISOString(), Date, Math, Number, Boolean };
  vm.runInNewContext(`${source.slice(debut, fin + 2)}\nthis.loadCost = loadCost;`, bac);
  const cout = await bac.loadCost(releve);
  ok(cout.monthMeasured === true && cout.spentUsd === 1.25 && cout.months.every((m) => m.month.split(':').length < 3), 'avec trois centres sur la caisse des mails, le mois en cours reste dans le releve, sans les parts',
    JSON.stringify({ mesure: cout.monthMeasured, depense: cout.spentUsd, mois: cout.months.map((m) => m.month) }));

  console.log(rouges ? `\ncaisse-mails-par-centre-check: ${rouges} ROUGE(S)` : '\ncaisse-mails-par-centre-check: ALL OK');
  process.exit(rouges ? 1 : 0);
}

principal().catch((erreur) => {
  console.error(`caisse-mails-par-centre-check: Error ${erreur && erreur.stack}`);
  process.exit(1);
});

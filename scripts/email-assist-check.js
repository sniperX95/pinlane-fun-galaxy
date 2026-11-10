// LES AIDES D ECRITURE DES MAILS (2026-11-10, Emails & relances refait).
//
// Une seule porte, POST /api/ops emailAssist, sert toutes les aides de la page : ecrire, ameliorer, raccourcir,
// changer le ton, traduire, proposer des objets. L IA reformule et propose ; elle ne doit jamais faire entrer un
// fait, ni perdre ou inventer une variable {{...}} du texte. Sans cle IA, chaque aide rend ce qu une regle sait
// faire, et le dit.
//
//   [A] sans IA : chaque aide rend un resultat honnete (mail simple, texte raccourci, un objet, traduction refusee)
//   [B] avec une IA simulee : la consigne interdit d inventer et porte les faits du centre ; une reponse qui perd
//       une variable, en invente une, ou ne raccourcit pas, est refusee et la regle reprend
//   [C] la porte demande les memes droits que « Ameliorer », et la route existe
//   --mutate : chaque garde retiree fait rougir
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const LF = '\n';
const CRLF = '\r\n';

const MUTATIONS = [
  {
    nom: 'une variable perdue par l IA passe',
    fichier: 'lib/email-assist.js',
    de: '  if (TRANSFORMENT.has(intention) && [...variablesDe(body)].some((v) => !variablesDe(corps).has(v))) return false;\n',
    vers: '',
    attendu: ['[B]'],
  },
  {
    nom: 'une variable inventee par l IA passe',
    fichier: 'lib/email-assist.js',
    de: '  if ([...variablesDe(`${rep.subject} ${corps}`)].some((v) => !permises.has(v))) return false;\n',
    vers: '',
    attendu: ['[B]'],
  },
  {
    nom: 'la consigne n interdit plus d inventer',
    fichier: 'lib/email-assist.js',
    de: "        'INTERDIT : inventer un prix, une date, une heure, une promotion, une activité, une disponibilité ou un chiffre qui ne figure ni dans les faits du centre ni dans le texte fourni. Les faits du centre sont les seuls que tu peux citer.',\n",
    vers: '',
    attendu: ['[B]'],
  },
  {
    nom: 'un texte « raccourci » plus long passe',
    fichier: 'lib/email-assist.js',
    de: "  if (intention === 'raccourcir' && corps.length >= body.length) return false;\n",
    vers: '',
    attendu: ['[B]'],
  },
  {
    nom: 'la porte perd ses droits',
    fichier: 'api/ops.js',
    de: "  if (action === 'emailAssist') return ['emails.view', 'direction.view', 'campaigns.manage'];\n",
    vers: '',
    attendu: ['[C]'],
  },
];

const MUTATION_PREUVE = '[mutation] servie :';
const MUTATION_ACTIVE = Number(process.env.PINLANE_ASSIST_MUTATION || 0);
const MUTATION = MUTATION_ACTIVE ? MUTATIONS[MUTATION_ACTIVE - 1] : null;
function muter(contenu, mutation) {
  const texte = contenu.split(CRLF).join(LF);
  if (texte.split(mutation.de).length - 1 !== 1) {
    console.error(`mutation impossible : ancre absente ou multiple dans ${mutation.fichier} : ${mutation.de.slice(0, 70)}`);
    process.exit(2);
  }
  console.log(`${MUTATION_PREUVE} ${mutation.nom}`);
  return texte.split(mutation.de).join(mutation.vers);
}
if (MUTATION) {
  const Module = require('module');
  const compile = Module.prototype._compile;
  const cible = path.resolve(ROOT, MUTATION.fichier);
  Module.prototype._compile = function (contenu, nom) {
    if (path.resolve(nom) === cible) return compile.call(this, muter(contenu, MUTATION), nom);
    return compile.call(this, contenu, nom);
  };
}

let failures = 0;
function ok(condition, message, detail) {
  console.log(`${condition ? 'OK  ' : 'FAIL'}  ${message}${detail !== undefined && detail !== '' ? `  ${detail}` : ''}`);
  if (!condition) failures += 1;
  return condition;
}
function section(titre) { console.log(`\n${titre}`); }

const CENTRE = { name: 'Centre du gate', publicInfo: { address: 'Rue du Gate 1, 6800 Libramont', phone: '0491/30.16.67' }, identity: { siteUrl: 'https://exemple.test' } };
const TEXTE = 'Bonjour {{prenom}},\n\nNous sommes ouverts samedi jusqu à 23 h. Venez avec vos amis. Le bowling vous attend.\n\nÀ bientôt';

async function main() {
  // Aucune cle IA pour [A] : la regle doit repondre seule.
  ['LLM_PROVIDER', 'KIMI_API_KEY', 'MOONSHOT_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY'].forEach((k) => { delete process.env[k]; });
  const llm = require('../lib/llm-client');
  let ia = null;
  const appels = [];
  const provider = llm.llmProvider;
  llm.llmProvider = (...a) => (ia ? 'anthropic' : provider(...a));
  llm.callLlmJson = async (options) => { appels.push(options); return typeof ia === 'function' ? ia(options) : ia; };
  const { aiderAEcrire } = require('../lib/email-assist');
  const aide = (x) => aiderAEcrire({ center: CENTRE, contexte: 'message', ...x });

  section('[A] Sans IA');
  const ecrit = await aide({ intention: 'ecrire', brief: 'rappeler que le bowling ouvre jusqu à 23 h samedi' });
  ok(ecrit.ok && ecrit.mode === 'regles' && ecrit.body.includes('Rappeler que le bowling ouvre jusqu à 23 h samedi.') && ecrit.body.startsWith('Bonjour {{prenom}},'), '[A] ecrire pose la demande dans un mail simple, salue le client', JSON.stringify(ecrit.body));
  const reponse = await aide({ intention: 'ecrire', contexte: 'reponse', recu: 'Bonjour, êtes-vous ouverts lundi ?' });
  ok(reponse.ok && reponse.body.startsWith('Bonjour,') && !reponse.body.includes('{{'), '[A] une reponse sans demande salue sans variable', JSON.stringify(reponse.body));
  const vide = await aide({ intention: 'ecrire' });
  ok(vide.ok === false && /quelques mots/.test(vide.message || ''), '[A] ecrire sans rien a dire est refuse avec la raison', vide.message);
  const court = await aide({ intention: 'raccourcir', subject: 'Samedi', body: TEXTE });
  ok(court.ok && court.mode === 'regles' && court.body.length < TEXTE.length && court.body.includes('{{prenom}}'), '[A] raccourcir rend un texte plus court qui garde ses variables', `${court.body.length} < ${TEXTE.length}`);
  const objets = await aide({ intention: 'objets', subject: '', body: TEXTE });
  ok(objets.ok && objets.objets.length === 1 && objets.objets[0].length > 8 && !objets.objets[0].includes('{{'), '[A] sans IA, un seul objet tire du texte', JSON.stringify(objets.objets));
  const nl = await aide({ intention: 'nl', subject: 'Samedi', body: TEXTE });
  ok(nl.ok && nl.body === TEXTE && /traduction demande l'IA/.test(nl.note), '[A] sans IA, aucune fausse traduction, et la raison dite', nl.note);
  const mieux = await aide({ intention: 'ameliorer', subject: 'x', body: 'court' });
  ok(mieux.ok && mieux.conseils.length > 0 && mieux.conseils.every((c) => !/^Ajoute |: vise /.test(c)), '[A] ameliorer sans IA rend des conseils, dits au vous', JSON.stringify(mieux.conseils.slice(0, 2)));
  const inconnue = await aide({ intention: 'poeme', body: TEXTE });
  ok(inconnue.ok === false, '[A] une aide inconnue est refusee');

  section('[B] Avec une IA simulee');
  ia = { subject: 'Ce samedi, jusqu à 23 h', body: 'Bonjour {{prenom}},\n\nCe samedi, nous restons ouverts jusqu à 23 h.\n\nÀ bientôt', objets: [] };
  const bon = await aide({ intention: 'ameliorer', subject: 'Samedi', body: TEXTE });
  ok(bon.mode === 'ia' && bon.body === ia.body, '[B] une reponse qui tient la regle passe', bon.mode);
  const consigne = appels.length ? `${appels[appels.length - 1].stableSystem}` : '';
  const donnees = appels.length ? JSON.parse(appels[appels.length - 1].user) : {};
  ok(/INTERDIT : inventer un prix/.test(consigne) && consigne.includes('Centre du gate'), '[B] la consigne interdit d inventer et nomme le centre');
  ok(donnees.faitsDuCentre && donnees.faitsDuCentre.telephone === '0491/30.16.67' && donnees.faitsDuCentre.site === 'https://exemple.test', '[B] les faits du centre partent avec la demande', JSON.stringify(donnees.faitsDuCentre));
  ia = { subject: 'Samedi', body: 'Bonjour,\n\nOuvert samedi jusqu à 23 h.', objets: [] };
  const perdue = await aide({ intention: 'ameliorer', subject: 'Samedi', body: TEXTE });
  ok(perdue.mode === 'regles', '[B] une reponse qui perd {{prenom}} est refusee, la regle reprend', perdue.mode);
  ia = { subject: 'Samedi', body: 'Bonjour {{prenom}},\n\nAvec le code {{code_promo}}, venez samedi.', objets: [] };
  const inventee = await aide({ intention: 'ameliorer', subject: 'Samedi', body: TEXTE });
  ok(inventee.mode === 'regles', '[B] une reponse qui invente {{code_promo}} est refusee', inventee.mode);
  ia = { subject: 'Samedi', body: `${TEXTE}\n\nEt encore une phrase de plus pour rien.`, objets: [] };
  const pasPlusCourt = await aide({ intention: 'raccourcir', subject: 'Samedi', body: TEXTE });
  ok(pasPlusCourt.mode === 'regles' && pasPlusCourt.body.length < TEXTE.length, '[B] un texte « raccourci » plus long est refuse', pasPlusCourt.mode);
  ia = { subject: 'Samedi', body: 'Bonjour {{prenom}},\n\nVotre partie de bowling vous attend samedi.', objets: [] };
  const salue = await aide({ intention: 'ecrire', brief: 'inviter a venir samedi' });
  ok(salue.mode === 'ia' && salue.body.includes('{{prenom}}'), '[B] en ecrivant, l IA peut saluer avec {{prenom}}', salue.mode);
  ia = { subject: '', body: '', objets: ['Samedi, on reste ouvert jusqu à 23 h', 'Votre soirée bowling ce samedi', 'Ouvert tard ce samedi, venez nombreux'] };
  const trois = await aide({ intention: 'objets', subject: 'Samedi', body: TEXTE });
  ok(trois.mode === 'ia' && trois.objets.length === 3 && trois.body === TEXTE, '[B] trois objets distincts passent, le texte ne change pas', JSON.stringify(trois.objets));
  ia = { subject: '', body: '', objets: ['Samedi', 'Samedi'] };
  const deux = await aide({ intention: 'objets', subject: 'Samedi', body: TEXTE });
  ok(deux.mode === 'regles', '[B] moins de trois objets distincts : la regle reprend', deux.mode);

  section('[C] La porte');
  const ops = require('../api/ops');
  const droits = ops.getRequiredOpsPermission('POST', 'emailAssist');
  const ameliorer = ops.getRequiredOpsPermission('POST', 'improveEmailWithAi');
  ok(Array.isArray(droits) && JSON.stringify(droits) === JSON.stringify(ameliorer), '[C] emailAssist demande les memes droits que « Ameliorer »', JSON.stringify(droits));
  const source = fs.readFileSync(path.join(ROOT, 'api/ops.js'), 'utf8');
  ok(/if \(action === 'emailAssist'\) \{[\s\S]{0,400}aiderAEcrire\(/.test(source), '[C] la route appelle l aide');

  if (failures) {
    console.error(`\nemail-assist-check: ${failures} defaut(s).`);
    process.exitCode = 1;
    return;
  }
  console.log('\nemail-assist-check: ALL OK (les aides d ecriture tiennent la regle, avec et sans IA)');
}

if (process.argv.includes('--mutate')) {
  const empreintes = new Map(MUTATIONS.map((x) => [x.fichier, fs.readFileSync(path.join(ROOT, x.fichier), 'utf8')]));
  let defauts = 0;
  MUTATIONS.forEach((mutation, index) => {
    const r = spawnSync(process.execPath, [__filename], { env: { ...process.env, PINLANE_ASSIST_MUTATION: String(index + 1) }, encoding: 'utf8', timeout: 120000 });
    const sortie = `${r.stdout || ''}${r.stderr || ''}`;
    const servie = sortie.includes(`${MUTATION_PREUVE} ${mutation.nom}`);
    const rougit = r.status === 1 && mutation.attendu.every((lettre) => sortie.split('\n').some((l) => l.startsWith('FAIL') && l.includes(lettre)));
    if (r.status === 2 || !servie) { defauts += 1; console.error(`contre-epreuve DESARMEE : ${mutation.nom} (${r.status === 2 ? 'ancre introuvable' : 'mutation non servie'})`); }
    else if (!rougit) { defauts += 1; console.error(`contre-epreuve MUETTE : le gate reste vert quand ${mutation.nom}.`); }
    else console.log(`contre-epreuve OK : le gate rougit quand ${mutation.nom}.`);
  });
  const touche = [...empreintes].filter(([f, avant]) => fs.readFileSync(path.join(ROOT, f), 'utf8') !== avant);
  if (touche.length) { defauts += 1; console.error(`un fichier a ete ecrit : ${touche.map(([f]) => f).join(', ')}`); }
  if (defauts) { console.error(`\nemail-assist-check --mutate: ${defauts} defaut(s).`); process.exitCode = 1; }
  else console.log(`contre-epreuve OK : ${MUTATIONS.length} mutations, et aucun fichier n a ete ecrit.`);
} else {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}

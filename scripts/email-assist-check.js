// LES AIDES D ECRITURE DES MAILS (2026-11-10, refaites en conversation le 2026-11-13).
//
// Une seule porte, POST /api/ops emailAssist, sert toutes les aides de la page : ecrire, corriger en une phrase,
// adapter au centre, ameliorer, raccourcir, changer le ton, traduire, proposer des objets. L IA ecrit le mail et
// dit en une phrase ce qu elle a fait. Elle ne doit jamais faire entrer un fait, ni perdre ou inventer une
// variable {{...}} du texte. Une reponse qui ne tient pas la regle ne remplace RIEN : la porte rend ok:false et
// refus:true avec la raison, sans objet ni texte. Sans cle IA, chaque aide rend ce qu une regle sait faire, et le dit.
//
//   [A] sans IA : chaque aide rend un resultat honnete (mail simple, texte raccourci, un objet, traduction et
//       correction refusees), et sa note est son message ; aucun appel
//   [B] avec une IA simulee : le modele, l usage et la caisse ; la consigne interdit d inventer, reste la meme d un
//       appel a l autre, et sait si la signature s ajoute ; les faits du centre, le mail et la conversation (bornee)
//       partent avec la demande ; une reponse qui perd une variable, en invente une, ne raccourcit pas, ecrit un mot
//       de spam, cite un prix ou un telephone sans source, ou ne repond pas, est refusee sans rien changer ; le
//       tiret long est retire ; caisse vide, aucun appel
//   [C] la porte : les memes droits que « Ameliorer », les faits et la conversation passes a l aide, un refus dit en
//       200, et l appel tient sous la duree de la fonction
//   --mutate : chaque garde retiree fait rougir
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const LF = '\n';
const CRLF = '\r\n';

const MUTATIONS = [
  { nom: 'une variable perdue par l IA passe', fichier: 'lib/email-assist.js', de: 'if (perdues.length) return', vers: 'if (false) return', attendu: ['[B]'] },
  { nom: 'une variable inventee par l IA passe', fichier: 'lib/email-assist.js', de: 'if (inventees.length) return', vers: 'if (false) return', attendu: ['[B]'] },
  { nom: 'un texte « raccourci » plus long passe', fichier: 'lib/email-assist.js', de: "if (intention === 'raccourcir' && corps.length >= body.length) return", vers: 'if (false) return', attendu: ['[B]'] },
  { nom: 'un mot de spam ecrit par l IA passe', fichier: 'lib/email-assist.js', de: "if (spam && !MOTS_INTERDITS.test(ecritParLEquipe) && contexte !== 'campagne') {", vers: 'if (false) {', attendu: ['[B]'] },
  { nom: 'un prix ou un telephone sans source passe', fichier: 'lib/email-assist.js', de: '  if (controle && controle.ok === false) {', vers: '  if (false) {', attendu: ['[B]'] },
  { nom: 'la consigne laisse inventer', fichier: 'lib/email-assist.js', de: "'Tu n\\'écris QUE ce que disent les faits du centre", vers: "'Tu écris ce que tu veux", attendu: ['[B]'] },
  { nom: 'la consigne oublie la regle du « nous »', fichier: 'lib/email-assist.js', de: '    `Jamais ${PRONOMS_INTERDITS.map((r) => r.nom).join(\' ni \')}, même accroché au verbe', vers: '    `Toujours, même accroché au verbe', attendu: ['[B]'] },
  { nom: 'le message de l IA se coupe au milieu d une phrase', fichier: 'lib/email-assist.js', de: '  if (t.length <= max) return t;\n', vers: '  if (t.length <= max) return t;\n  return t.slice(0, max);\n', attendu: ['[B]'] },
  { nom: 'les faits du centre ne partent plus', fichier: 'lib/email-assist.js', de: "bloc('faits_du_centre', faits ||", vers: "bloc('faits_du_centre', '' ||", attendu: ['[B]'] },
  { nom: 'la conversation ne part plus', fichier: 'lib/email-assist.js', de: "    bloc('conversation', conversation),\n", vers: '', attendu: ['[B]'] },
  { nom: 'la conversation n est plus bornee', fichier: 'lib/email-assist.js', de: '  return tours.slice(-LIMITES.tours);\n', vers: '  return tours;\n', attendu: ['[B]'] },
  { nom: 'le tiret long de l IA passe', fichier: 'lib/email-assist.js', de: '{ ...rep, subject: sansTiretsLongs(rep.subject), body: sansTiretsLongs(rep.body),', vers: '{ ...rep, subject: rep.subject, body: rep.body,', attendu: ['[B]'] },
  { nom: 'un modele plus faible ecrit les mails', fichier: 'lib/email-assist.js', de: "const MODELE = 'claude-opus-5-5';", vers: "const MODELE = 'claude-haiku-4-5';", attendu: ['[B]'] },
  { nom: 'la caisse vide appelle quand meme l IA', fichier: 'lib/email-assist.js', de: "  if (require('./llm-budget').isBudgetExhausted(BUDGET)) {", vers: '  if (false) {', attendu: ['[B]'] },
  { nom: 'la porte perd ses droits', fichier: 'api/ops.js', de: "  if (action === 'emailAssist') return ['emails.view', 'direction.view', 'campaigns.manage'];\n", vers: '', attendu: ['[C]'] },
  { nom: 'un refus de l IA part en erreur 400', fichier: 'api/ops.js', de: '    if (!result.ok && result.refus) { sendJson(res, 200, { ...result, action }); return; }\n', vers: '', attendu: ['[C]'] },
  { nom: 'la conversation ne passe plus la porte', fichier: 'api/ops.js', de: '      historique: body.historique,\n', vers: '', attendu: ['[C]'] },
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
// Le code lu comme texte passe par la meme mutation que le code charge.
function lireSource(fichier) {
  const brut = fs.readFileSync(path.join(ROOT, fichier), 'utf8');
  if (MUTATION && path.resolve(ROOT, MUTATION.fichier) === path.resolve(ROOT, fichier)) return muter(brut, MUTATION);
  return brut.split(CRLF).join(LF);
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
const FAITS = 'Activités : bowling, laser game, minigolf.\nPack anniversaire enfant : 18 € par enfant, dès 6 enfants.\nOuvert du mercredi au dimanche.';
// Un calendrier fixe : le controle des nombres ne depend pas du jour ou le gate tourne.
const CALENDRIER = 'samedi 15 novembre 2026 15/11/2026';
const TIRET = '\u2014';

async function main() {
  // Aucune cle IA pour [A] : la regle doit repondre seule.
  ['LLM_PROVIDER', 'KIMI_API_KEY', 'MOONSHOT_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY'].forEach((k) => { delete process.env[k]; });
  const llm = require('../lib/llm-client');
  let ia = null;
  const appels = [];
  const provider = llm.llmProvider;
  llm.llmProvider = (...a) => (ia ? 'anthropic' : provider(...a));
  llm.callLlmJson = async (options) => { appels.push(options); return typeof ia === 'function' ? ia(options) : ia; };
  const assist = require('../lib/email-assist');
  const aide = (x) => assist.aiderAEcrire({ center: CENTRE, contexte: 'message', ...x }, { calendrier: CALENDRIER });
  const dernier = () => appels[appels.length - 1] || {};

  section('[A] Sans IA');
  const ecrit = await aide({ intention: 'ecrire', brief: 'rappeler que le bowling ouvre jusqu à 23 h samedi' });
  ok(ecrit.ok && ecrit.mode === 'regles' && ecrit.body.includes('Rappeler que le bowling ouvre jusqu à 23 h samedi.') && ecrit.body.startsWith('Bonjour {{prenom}},'), '[A] ecrire pose la demande dans un mail simple, salue le client', JSON.stringify(ecrit.body));
  const reponse = await aide({ intention: 'ecrire', contexte: 'reponse', recu: 'Bonjour, êtes-vous ouverts lundi ?' });
  ok(reponse.ok && reponse.body.startsWith('Bonjour,') && !reponse.body.includes('{{'), '[A] une reponse sans demande salue sans variable', JSON.stringify(reponse.body));
  const rien = await aide({ intention: 'ecrire' });
  ok(rien.ok === false && /quelques mots/.test(rien.message || ''), '[A] ecrire sans rien a dire est refuse avec la raison', rien.message);
  const court = await aide({ intention: 'raccourcir', subject: 'Samedi', body: TEXTE });
  ok(court.ok && court.mode === 'regles' && court.body.length < TEXTE.length && court.body.includes('{{prenom}}'), '[A] raccourcir rend un texte plus court qui garde ses variables', `${court.body.length} < ${TEXTE.length}`);
  const objets = await aide({ intention: 'objets', subject: '', body: TEXTE });
  ok(objets.ok && objets.objets.length === 1 && objets.objets[0].length > 8 && !objets.objets[0].includes('{{') && !/^Bonjour|\n/.test(objets.objets[0]), '[A] sans IA, un seul objet tire du texte, sans la salutation, sur une ligne', JSON.stringify(objets.objets));
  const nl = await aide({ intention: 'nl', subject: 'Samedi', body: TEXTE });
  ok(nl.ok && nl.body === TEXTE && /traduction demande l'IA/.test(nl.note) && nl.message === nl.note, '[A] sans IA, aucune fausse traduction, et la raison dite dans le message', nl.message);
  const mieux = await aide({ intention: 'ameliorer', subject: 'x', body: 'court' });
  ok(mieux.ok && mieux.conseils.length > 0 && mieux.conseils.every((c) => !/^Ajoute |: vise /.test(c)), '[A] ameliorer sans IA rend des conseils, dits au vous', JSON.stringify(mieux.conseils.slice(0, 2)));
  const corrigeSansIa = await aide({ intention: 'corriger', brief: 'plus court', subject: 'Samedi', body: TEXTE });
  ok(corrigeSansIa.ok && corrigeSansIa.mode === 'regles' && corrigeSansIa.body === TEXTE && /ne sais pas réécrire/.test(corrigeSansIa.message), '[A] corriger sans IA laisse le texte tel quel et le dit', corrigeSansIa.message);
  const corrigeQuoi = await aide({ intention: 'corriger', subject: 'Samedi', body: TEXTE });
  ok(corrigeQuoi.ok === false && /ce qu'il faut changer/.test(corrigeQuoi.message || ''), '[A] corriger sans dire quoi est refuse avec la raison', corrigeQuoi.message);
  const inconnue = await aide({ intention: 'poeme', body: TEXTE });
  ok(inconnue.ok === false, '[A] une aide inconnue est refusee');
  ok(appels.length === 0, '[A] sans cle, aucun appel a l IA', String(appels.length));

  section('[B] Avec une IA simulee');
  ia = { subject: 'Ce samedi, jusqu à 23 h', body: 'Bonjour {{prenom}},\n\nCe samedi, nous restons ouverts jusqu à 23 h.', message: 'J\'ai gardé l\'heure de fermeture, 23 h.', objets: [] };
  const bon = await aide({ intention: 'ameliorer', subject: 'Samedi', body: TEXTE, faits: FAITS });
  const appelBon = dernier();
  ok(bon.ok && bon.mode === 'ia' && bon.body === ia.body && bon.message === ia.message, '[B] une reponse qui tient la regle passe, avec le message de l IA', `${bon.mode} / ${bon.message}`);
  ok(/^claude-opus-/.test(String(appelBon.model)) && appelBon.usage === 'mails' && appelBon.budget === 'assistant' && appelBon.fallbacks === 'default',
    '[B] le meilleur modele ecrit, chez Anthropic seulement, sur la caisse de l assistant', JSON.stringify({ model: appelBon.model, usage: appelBon.usage, budget: appelBon.budget, fallbacks: appelBon.fallbacks }));
  const consigne = String(appelBon.stableSystem || '');
  ok(consigne.includes('Tu n\'écris QUE ce que disent les faits du centre') && consigne.includes('Centre du gate') && consigne.includes('<faits>') && consigne.includes('<rappel>'), '[B] la consigne interdit d inventer et nomme le centre');
  // La regle d ecriture de tous les textes clients (lib/client-writing, retour de Seb du 2026-09-18), lue a sa source.
  const { PRONOMS_INTERDITS } = require('../lib/client-writing');
  ok(PRONOMS_INTERDITS.every((r) => consigne.includes(r.nom)), '[B] la consigne porte la regle d ecriture du produit : jamais « on » ni « nous »', PRONOMS_INTERDITS.map((r) => r.nom).join(' / '));
  const demandeBon = String(appelBon.user || '');
  ok(demandeBon.includes('<faits_du_centre>') && demandeBon.includes('18 € par enfant, dès 6 enfants') && demandeBon.includes('<mail_actuel>') && demandeBon.includes('ouverts samedi jusqu à 23 h'),
    '[B] les faits du centre et le mail actuel partent avec la demande', demandeBon.slice(0, 90).replace(/\n/g, ' | '));
  await aide({ intention: 'ameliorer', subject: 'Samedi', body: TEXTE });
  ok(/Aucun autre fait n'est disponible : n'écris ni prix/.test(String(dernier().user || '')), '[B] sans faits lus, la demande dit de n ecrire ni prix, ni horaire, ni activite');

  const tours = [{ qui: 'equipe', texte: 'Écris une invitation pour samedi' }, { qui: 'aide', texte: 'Voici le mail, avec l heure de fermeture.' }];
  ia = { subject: 'Samedi, jusqu à 23 h', body: 'Bonjour {{prenom}},\n\nCe samedi, nous restons ouverts jusqu à 23 h.', message: 'C\'est plus court.', objets: [] };
  const corrige = await aide({ intention: 'corriger', brief: 'plus court', subject: 'Samedi', body: TEXTE, historique: tours });
  const appelCorrige = dernier();
  const demandeCorrige = String(appelCorrige.user || '');
  ok(corrige.ok && corrige.mode === 'ia' && demandeCorrige.includes('<conversation>') && demandeCorrige.includes('L\'équipe : Écris une invitation pour samedi') && demandeCorrige.includes('Toi : Voici le mail, avec l heure de fermeture.') && demandeCorrige.includes('Demande de l\'équipe : « plus court »'),
    '[B] la conversation et la correction partent avec la demande', demandeCorrige.slice(0, 120).replace(/\n/g, ' | '));
  ok(appelCorrige.stableSystem === appelBon.stableSystem, '[B] la consigne reste la meme d un appel a l autre (cache), seul le message change');
  const longue = Array.from({ length: 14 }, (_, i) => ({ qui: i % 2 ? 'aide' : 'equipe', texte: `Tour ${String(i + 1).padStart(2, '0')}` }));
  await aide({ intention: 'corriger', brief: 'plus court', subject: 'Samedi', body: TEXTE, historique: longue });
  const demandeLongue = String(dernier().user || '');
  ok(!demandeLongue.includes('Tour 01') && !demandeLongue.includes('Tour 04') && demandeLongue.includes('Tour 05') && demandeLongue.includes('Tour 14'), '[B] la conversation est bornee aux dix derniers echanges');
  await aide({ intention: 'ameliorer', subject: 'Samedi', body: TEXTE, signatureAjoutee: false });
  const consigneSansSignature = String(dernier().stableSystem || '');
  ok(consigneSansSignature.includes('Aucune signature ne s\'ajoute') && consigne.includes('s\'ajoute toute seule sous le texte'), '[B] la consigne dit si la signature du centre s ajoute sous le mail');
  const portee = { signatureScope: { manual: true, sequences: true, campaigns: false } };
  ok(assist.signatureAjouteePour(portee, 'message') === true && assist.signatureAjouteePour(portee, 'campagne') === false
    && assist.signatureAjouteePour({ signature: { enabled: false }, signatureScope: { manual: true } }, 'message') === false && assist.signatureAjouteePour(null, 'message') === true,
  '[B] la signature suit la portee du design du centre');

  ia = { subject: 'Samedi', body: 'Bonjour,\n\nOuvert samedi jusqu à 23 h.', message: '', objets: [] };
  const perdue = await aide({ intention: 'ameliorer', subject: 'Samedi', body: TEXTE });
  ok(perdue.ok === false && perdue.refus === true && /\{\{prenom\}\}/.test(perdue.message) && !('body' in perdue) && !('subject' in perdue), '[B] une reponse qui perd {{prenom}} est refusee, rien ne change', perdue.message);
  ia = { subject: 'Votre soirée au Centre du gate', body: 'Bonjour {{prenom}},\n\nCe samedi, nous restons ouverts jusqu à 23 h.', message: '', objets: [] };
  const sansEquipe = await aide({ intention: 'adapter', subject: 'Samedi', body: `${TEXTE}\n\nL'équipe {{centre}}`, faits: FAITS });
  ok(sansEquipe.ok && sansEquipe.mode === 'ia' && sansEquipe.message === 'J\'ai adapté le mail à votre centre.', '[B] la ligne « L equipe {{centre}} » peut partir (la signature la remplace) ; sans message, la phrase par defaut', sansEquipe.message);
  ia = { subject: 'Samedi', body: 'Bonjour {{prenom}},\n\nAvec le code {{code_promo}}, venez samedi.', message: '', objets: [] };
  const inventee = await aide({ intention: 'ameliorer', subject: 'Samedi', body: TEXTE });
  ok(inventee.ok === false && inventee.refus === true && /\{\{code_promo\}\}/.test(inventee.message), '[B] une reponse qui invente {{code_promo}} est refusee', inventee.message);
  ia = { subject: 'Samedi', body: `${TEXTE}\n\nEt encore une phrase de plus pour rien.`, message: '', objets: [] };
  const pasPlusCourt = await aide({ intention: 'raccourcir', subject: 'Samedi', body: TEXTE });
  ok(pasPlusCourt.ok === false && pasPlusCourt.refus === true && /pas plus court/.test(pasPlusCourt.message), '[B] un texte « raccourci » plus long est refuse', pasPlusCourt.message);

  ia = { subject: 'Samedi au bowling', body: 'Bonjour {{prenom}},\n\nN\'hésitez pas à venir samedi, jusqu à 23 h.', message: '', objets: [] };
  const spam = await aide({ intention: 'ameliorer', subject: 'Samedi', body: TEXTE });
  ok(spam.ok === false && spam.refus === true && /n'hésitez pas/i.test(spam.message), '[B] un mot de spam que l equipe n a pas ecrit est refuse', spam.message);
  const voulu = await aide({ intention: 'ameliorer', subject: 'Samedi', body: `${TEXTE}\n\nN'hésitez pas à appeler.` });
  ok(voulu.ok && voulu.mode === 'ia', '[B] le meme mot passe quand l equipe l a ecrit elle-meme', voulu.message);
  ia = { subject: 'Samedi au bowling', body: 'Bonjour {{prenom}},\n\nUne promo pour samedi, jusqu à 23 h.', message: '', objets: [] };
  const campagne = await aide({ intention: 'ameliorer', contexte: 'campagne', subject: 'Samedi', body: TEXTE });
  ok(campagne.ok && campagne.mode === 'ia', '[B] une campagne peut parler d une promo', campagne.message);

  ia = { subject: 'L anniversaire de votre enfant', body: 'Bonjour {{prenom}},\n\nLe pack anniversaire coûte 18 € par enfant, dès 6 enfants.', message: '', objets: [] };
  const prix = await aide({ intention: 'ecrire', brief: 'proposer le pack anniversaire' });
  ok(prix.ok === false && prix.refus === true && /18/.test(prix.message), '[B] un prix que ni les faits ni l equipe ne donnent est refuse', prix.message);
  const prixDesFaits = await aide({ intention: 'ecrire', brief: 'proposer le pack anniversaire', faits: FAITS });
  ok(prixDesFaits.ok && prixDesFaits.mode === 'ia', '[B] le meme prix passe quand les faits du centre le donnent', prixDesFaits.message);
  const prixDit = await aide({ intention: 'corriger', brief: 'ajoute le prix', subject: 'Anniversaire', body: 'Bonjour {{prenom}},\n\nVenez fêter un anniversaire.', historique: [{ qui: 'equipe', texte: 'Le pack coûte 18 € par enfant, dès 6 enfants.' }] });
  ok(prixDit.ok && prixDit.mode === 'ia', '[B] et quand l equipe l a donne plus tot dans la conversation', prixDit.message);
  ia = { subject: 'Votre réservation de samedi', body: 'Bonjour {{prenom}},\n\nAppelez-nous au 0470 12 34 56 pour réserver samedi.', message: '', objets: [] };
  const telephone = await aide({ intention: 'ecrire', brief: 'inviter a reserver samedi' });
  ok(telephone.ok === false && telephone.refus === true, '[B] un telephone qui n est pas celui du centre est refuse', telephone.message);
  ia = { ...ia, body: 'Bonjour {{prenom}},\n\nAppelez-nous au 0491/30.16.67 pour réserver samedi.' };
  const vraiTelephone = await aide({ intention: 'ecrire', brief: 'inviter a reserver samedi' });
  ok(vraiTelephone.ok && vraiTelephone.mode === 'ia', '[B] le telephone du centre passe', vraiTelephone.message);

  ia = { subject: `Samedi ${TIRET} jusqu à 23 h`, body: `Bonjour {{prenom}},\n\nCe samedi ${TIRET} jusqu à 23 h ${TIRET} on vous attend.`, message: `Fait ${TIRET} plus court.`, objets: [] };
  const tiret = await aide({ intention: 'ameliorer', subject: 'Samedi', body: TEXTE });
  ok(tiret.ok && ![tiret.subject, tiret.body, tiret.message].some((t) => /[\u2013\u2014]/.test(String(t))), '[B] le tiret long de l IA est retire de l objet, du texte et du message', JSON.stringify(tiret.body));

  ia = { subject: 'Samedi, jusqu à 23 h', body: 'Bonjour {{prenom}},\n\nCe samedi, jusqu à 23 h.', message: 'J\'ai gardé l\'heure de fermeture. '.repeat(40), objets: [] };
  const bavard = await aide({ intention: 'ameliorer', subject: 'Samedi', body: TEXTE });
  ok(bavard.ok && bavard.message.length <= 600 && /\.$/.test(bavard.message), '[B] un long message de l IA se coupe a la fin d une phrase, jamais au milieu', `${bavard.message.length} signes, fin « ${bavard.message.slice(-20)} »`);

  ia = { subject: '', body: '', message: '', objets: ['Samedi, on reste ouvert jusqu à 23 h', 'Votre soirée bowling ce samedi', 'Ouvert tard ce samedi, venez nombreux'] };
  const trois = await aide({ intention: 'objets', subject: 'Samedi', body: TEXTE });
  ok(trois.ok && trois.mode === 'ia' && trois.objets.length === 3 && trois.body === TEXTE && trois.subject === 'Samedi', '[B] trois objets distincts passent, le mail ne change pas', JSON.stringify(trois.objets));
  ia = { subject: '', body: '', message: '', objets: ['Samedi soir', 'Samedi soir'] };
  const deux = await aide({ intention: 'objets', subject: 'Samedi', body: TEXTE });
  ok(deux.ok === false && deux.refus === true, '[B] moins de trois objets distincts : refus, rien ne change', deux.message);
  ia = () => null;
  const muet = await aide({ intention: 'ameliorer', subject: 'Samedi', body: TEXTE });
  ok(muet.ok === false && muet.refus === true && /pas répondu/.test(muet.message), '[B] une IA qui ne repond pas : refus, le texte reste', muet.message);

  const budget = require('../lib/llm-budget');
  const vraiBudget = budget.isBudgetExhausted;
  budget.isBudgetExhausted = (poste) => poste === 'assistant';
  ia = { subject: 'Samedi', body: 'Bonjour {{prenom}},\n\nCe samedi, jusqu à 23 h.', message: '', objets: [] };
  const avantCaisse = appels.length;
  const caisse = await aide({ intention: 'ameliorer', subject: 'Samedi', body: TEXTE });
  budget.isBudgetExhausted = vraiBudget;
  ok(caisse.ok === false && caisse.refus === true && /budget/.test(caisse.message) && appels.length === avantCaisse, '[B] caisse de l assistant vide : aucun appel, et la raison dite', caisse.message);

  section('[C] La porte');
  const ops = require('../api/ops');
  const droits = ops.getRequiredOpsPermission('POST', 'emailAssist');
  const ameliorer = ops.getRequiredOpsPermission('POST', 'improveEmailWithAi');
  ok(Array.isArray(droits) && JSON.stringify(droits) === JSON.stringify(ameliorer), '[C] emailAssist demande les memes droits que « Ameliorer »', JSON.stringify(droits));
  const source = lireSource('api/ops.js');
  const debut = source.indexOf("  if (action === 'emailAssist') {");
  const route = debut >= 0 ? source.slice(debut, source.indexOf('\n  }\n', debut) + 4) : '';
  ok(/aiderAEcrire\(\{/.test(route) && /buildEmailBrain\(/.test(route) && route.includes('historique: body.historique,') && /\n\s+faits,\n/.test(route) && /\n\s+signatureAjoutee,\n/.test(route),
    '[C] la route lit les faits du centre et passe la conversation a l aide');
  ok(route.includes('if (!result.ok && result.refus) { sendJson(res, 200,'), '[C] un refus de l IA se dit en 200 : la console le montre dans la conversation');
  const vercel = JSON.parse(lireSource('vercel.json'));
  const duree = Number(((vercel.functions || {})['api/ops.js'] || {}).maxDuration || 10);
  const delai = Number(appelBon.timeoutMs || 0);
  ok(delai > 0 && delai + 10000 <= duree * 1000, '[C] l appel a l IA et la lecture des faits tiennent sous la duree de la fonction', `${delai} ms + 10 s <= ${duree} s`);

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

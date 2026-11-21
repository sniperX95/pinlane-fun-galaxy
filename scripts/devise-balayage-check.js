// AUCUN « € » EN DUR NE REVIENT DANS CE QUE VOIT UN CENTRE (2026-11-17, avant-lancement D6).
//
// Un centre suisse vend en francs : chaque montant d un centre s ecrit avec sa monnaie, par
// assets/pinlane-monnaie.js (pages) et lib/monnaie.js (serveur). Le jour ou quelqu un ecrit de nouveau
// `${prix} €` dans un mail, une page ou un message, un centre suisse lit des euros.
//
// [A] LE BALAYAGE. Chaque ligne de code (commentaires retires) de api/, lib/, assets/ et des pages HTML de la
//     racine qui porte un signe de l euro (le caractere, son echappement €, l entite HTML) ou le code
//     EUR est soit une ecriture par la monnaie du centre, soit une DEROGATION nommee ci-dessous, A LA LIGNE
//     (un morceau de cette ligne, le fichier, la raison). Une ligne neuve qui n en a pas rougit.
// [B] LES DEROGATIONS RESTENT VRAIES. Une derogation qui ne trouve plus sa ligne rougit aussi : elle
//     couvrirait la prochaine ligne qui lui ressemble, sans que personne ne l ait relue.
//
// Les contre-preuves lisent le code mute en memoire : aucun fichier n est ecrit.
// Lancement : node scripts/devise-balayage-check.js [--contre-preuves]

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

const MUTATIONS = {
  'euro-en-dur-dans-un-mail': { f: 'lib/ops-communications.js', de: '  return `${text}${NBSP}${monnaie.signe(devise)}`;', vers: '  return `${text}${NBSP}€`;', lettre: 'A' },
  'euro-en-dur-dans-la-console': { f: 'assets/staff-pages-v2.js', de: "    if (champ === 'prix') savoir = `À 0 ${signeMonnaie()}, la formule ne se réserve plus en ligne.`;", vers: "    if (champ === 'prix') savoir = 'À 0 €, la formule ne se réserve plus en ligne.';", lettre: 'A' },
  'derogation-perimee': { f: 'lib/booking-config.js', de: "\"8 crédits d'arcade (8€) par enfant\", '2 cruches boissons'], price: 18, oldPrice: 20,", vers: "\"8 crédits d'arcade par enfant\", '2 cruches boissons'], price: 18, oldPrice: 20,", lettre: 'B' },
};
const MUTATION = (process.argv.find((a) => a.startsWith('--mutation=')) || '').slice('--mutation='.length);
if (MUTATION && !MUTATIONS[MUTATION]) { console.error(`mutation inconnue : ${MUTATION}`); process.exit(2); }

let rouges = 0;
let lettre = '';
function section(titre) { lettre = (titre.match(/^\[([A-Z])\]/) || [])[1] || ''; console.log(`\n${titre}`); }
function ok(condition, quoi, detail) {
  if (condition) { console.log(`ok    ${quoi}`); return; }
  rouges += 1;
  console.log(`ROUGE [${lettre}] ${quoi}${detail !== undefined ? ` : ${String(detail).slice(0, 600)}` : ''}`);
}

if (process.argv.includes('--contre-preuves')) {
  const temoin = spawnSync(process.execPath, [__filename], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  if (temoin.status !== 0) { console.log(`${temoin.stdout || ''}${temoin.stderr || ''}`.split('\n').filter((l) => /ROUGE|Error/.test(l)).join('\n')); console.log('\ndevise-balayage-check --contre-preuves: le gate est rouge sans mutation, aucune contre-preuve ne compte'); process.exit(1); }
  let rates = 0;
  for (const [nom, m] of Object.entries(MUTATIONS)) {
    const r = spawnSync(process.execPath, [__filename, `--mutation=${nom}`], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
    const sortie = `${r.stdout || ''}${r.stderr || ''}`;
    const mord = r.status === 1 && sortie.includes(`ROUGE [${m.lettre}]`) && !/ANCRE DE MUTATION/.test(sortie);
    if (!mord) rates += 1;
    console.log(`${mord ? 'TUEE ' : 'VIVANTE'} ${nom} (attendu : ROUGE [${m.lettre}], sortie ${r.status})${mord ? '' : `\n${sortie.split('\n').filter((l) => /ROUGE|ANCRE|Error/.test(l)).slice(0, 6).join('\n')}`}`);
  }
  console.log(rates ? `\ndevise-balayage-check --contre-preuves: ${rates} mutation(s) vivante(s)` : '\ndevise-balayage-check --contre-preuves: ALL OK - un euro en dur rougit, une derogation perimee aussi');
  process.exit(rates ? 1 : 0);
}

// La source telle que le serveur ou la page la liraient, mutee en memoire pour une contre-preuve.
function lire(relatif) {
  const brut = fs.readFileSync(path.join(ROOT, relatif), 'utf8');
  const m = MUTATION ? MUTATIONS[MUTATION] : null;
  if (!m || m.f !== relatif) return brut;
  const t = brut.split('\r\n').join('\n');
  if (t.split(m.de).length !== 2) throw new Error(`ANCRE DE MUTATION absente ou multiple (${MUTATION}) dans ${m.f}`);
  return t.split(m.de).join(m.vers);
}

// Les commentaires sortent, les numeros de ligne restent : un bloc /* */ devient des lignes vides, une ligne
// qui commence par // aussi, et une fin de ligne // hors de toute chaine.
function codeSeul(texte) {
  const sansBlocs = texte.replace(/\/\*[\s\S]*?\*\//g, (bloc) => bloc.replace(/[^\n]/g, ' '));
  return sansBlocs.split(/\r?\n/).map((ligne) => {
    if (/^\s*\/\//.test(ligne)) return '';
    const i = ligne.search(/\s\/\/\s/);
    if (i < 0) return ligne;
    const avant = ligne.slice(0, i);
    const pair = ['\'', '"', '`'].every((q) => (avant.split(q).length - 1) % 2 === 0);
    return pair ? avant : ligne;
  });
}

const SIGNE = /€|\\u20ac|&euro;|\bEUR\b/i;
function fichiersBalayes() {
  const liste = [];
  const parcourir = (dossier) => {
    for (const e of fs.readdirSync(path.join(ROOT, dossier), { withFileTypes: true })) {
      const rel = `${dossier}/${e.name}`;
      if (e.isDirectory()) { if (!/node_modules|vendor/.test(e.name)) parcourir(rel); continue; }
      if (/\.(js|mjs|cjs)$/.test(e.name) && !/\.min\.js$/.test(e.name)) liste.push(rel);
    }
  };
  ['api', 'lib', 'assets'].forEach(parcourir);
  for (const e of fs.readdirSync(ROOT)) if (/\.html$/.test(e) || e === 'embed.js') liste.push(e);
  return liste.sort();
}

// LES DEROGATIONS, A LA LIGNE : `l` est un morceau de LA ligne couverte, `n` le nombre de lignes qu il couvre.
const DEROGATIONS = [
  // La liste blanche elle-meme, et le serveur qui la relaie.
  { f: 'assets/pinlane-monnaie.js', l: "EUR: Object.freeze({ code: 'EUR', signe: '€'", raison: 'la liste blanche : la ligne de l euro' },
  { f: 'assets/pinlane-monnaie.js', l: "const DEFAUT = 'EUR';", raison: 'le repli de la liste blanche' },
  { f: 'assets/pinlane-monnaie.js', l: "return s === '€' ? s : ` ${s}`;", raison: 'l euro reste colle au nombre comme avant' },
  // Les replis des pages quand le fichier de la monnaie manque : le code du centre, jamais un euro a sa place.
  { f: 'assets/booking-core.js', l: "return m ? m.devise(code) : String(code || 'EUR');", raison: 'repli sans pinlane-monnaie.js' },
  { f: 'assets/booking-core.js', l: "return m ? m.signe(code) : (code === 'EUR' ? '€' : code);", raison: 'repli sans pinlane-monnaie.js' },
  { f: 'assets/booking-core.js', l: "return s === '€' ? s : ` ${s}`;", raison: 'l euro reste colle au nombre comme avant' },
  { f: 'assets/booking-core.js', l: "return m ? m.noms(deviseMonnaie()) : (deviseMonnaie() === 'EUR' ? 'euros' : deviseMonnaie());", raison: 'repli sans pinlane-monnaie.js' },
  { f: 'assets/booking-core.js', l: "return m ? m.MOTIF_SIGNES : '€';", raison: 'repli sans pinlane-monnaie.js' },
  { f: 'assets/booking-core.js', l: "return m ? m.deNoms(deviseMonnaie()) : (deviseMonnaie() === 'EUR' ? 'd’euros' : `de ${deviseMonnaie()}`);", raison: 'repli sans pinlane-monnaie.js' },
  { f: 'assets/fungalaxy-booking.js', l: "return window.PinlaneMonnaie ? window.PinlaneMonnaie.devise(c) : (c || 'EUR');", raison: 'repli sans pinlane-monnaie.js' },
  { f: 'assets/fungalaxy-booking.js', l: "(deviseMonnaie() === 'EUR' ? '€' : deviseMonnaie())", raison: 'repli sans pinlane-monnaie.js' },
  { f: 'assets/fungalaxy-booking.js', l: "return window.PinlaneMonnaie ? window.PinlaneMonnaie.MOTIF_SIGNES : '€';", raison: 'repli sans pinlane-monnaie.js' },
  { f: 'assets/fungalaxy-sur-mesure.js', l: '<span aria-hidden="true" data-sm-signe>€ par personne</span>', raison: 'reecrit a chaque ouverture avec la monnaie du centre (data-sm-signe)' },
  { f: 'assets/fungalaxy-sur-mesure.js', l: "(I.signeMonnaie ? I.signeMonnaie() : '€')", raison: 'repli si la page ne passe pas encore sa monnaie' },
  { f: 'assets/pinlane-charts.js', l: "if (format === 'eurPlateforme') return window.PinlaneMonnaie ? window.PinlaneMonnaie.signe('EUR') : '\\u20ac';", raison: 'les pages fondateur : le chiffre de Pinlane, en euros' },
  { f: 'assets/pinlane-charts.js', l: "return typeof signeMonnaie === 'function' ? signeMonnaie() : '\\u20ac';", raison: 'repli hors de la console' },
  { f: 'assets/pinlane-sur-mesure-settings.js', l: "const signeMonnaie = () => (typeof global.signeMonnaie === 'function' ? global.signeMonnaie()", raison: 'module charge seul (son gate) : l euro, comme avant' },
  // Les pages fondateur : le chiffre de Pinlane, facture en euros, et les centres de tous les clients.
  { f: 'assets/founder-centres.js', l: "currency: 'EUR'", raison: 'page fondateur' },
  { f: 'assets/founder-centres.js', l: '`${Math.round(v)} EUR`', raison: 'page fondateur' },
  { f: 'assets/founder-clients-platform.js', l: "currency: 'EUR'", raison: 'page fondateur' },
  { f: 'assets/founder-clients-platform.js', l: '`${Math.round(v)} EUR`', raison: 'page fondateur' },
  { f: 'assets/founder-clients-platform.js', l: '<span class="fcp-price-unit">EUR/mois</span>', raison: 'page fondateur : l abonnement Pinlane' },
  { f: 'assets/founder-cockpit.js', l: "currency: 'EUR'", raison: 'page fondateur' },
  { f: 'assets/founder-cockpit.js', l: '`${Math.round(v)} EUR`', raison: 'page fondateur' },
  { f: 'assets/founder-tarifs.js', l: "currency: 'EUR'", raison: 'page fondateur : les prix de Pinlane' },
  { f: 'assets/founder-tarifs.js', l: '`${v} EUR`', raison: 'page fondateur : les prix de Pinlane' },
  { f: 'assets/founder-tarifs.js', l: 'Le prix per-pax est borné de 0 à 1000 EUR.', raison: 'page fondateur : les prix de Pinlane' },
  { f: 'assets/founder-tarifs.js', l: '<span class="ftr-unit">EUR</span>', raison: 'page fondateur : les prix de Pinlane' },
  { f: 'assets/founder-tarifs.js', l: "ftr.modalError = 'Indiquez un prix per-pax entre 0 et 1000 EUR.';", raison: 'page fondateur : les prix de Pinlane' },
  // Les donnees de Fun Galaxy : le texte de LEURS formules, pas une ecriture de montant.
  { f: 'lib/booking-config.js', l: "8 crédits d'arcade (8€) par enfant", n: 2, raison: 'texte du catalogue de Fun Galaxy' },
  { f: 'assets/booking-core.js', l: "8 crédits d'arcade (8€) par enfant", n: 4, raison: 'texte du catalogue de Fun Galaxy (sa copie navigateur)' },
  // Un decodeur d entites HTML, pas un montant.
  { f: 'assets/app-main.js', l: "if (code.includes('••') || code.includes(", raison: 'reconnait un « • » mal decode dans un code (echappement du signe), pas un montant' },
  // Le repli de l installateur sur le site du client : le formulaire envoie la monnaie de son centre.
  { f: 'embed.js', l: "var devise = detail.currency || 'EUR';", raison: 'repli si un ancien formulaire n envoie pas sa monnaie' },
  // Le total de l ancien tunnel avant son premier rendu, reecrit avec la monnaie du centre (app-main recapTotal).
  { f: 'index.html', l: '<div class="total-amount" id="recapTotal">0€</div>', raison: 'reecrit au premier rendu avec la monnaie du centre' },
  // L abonnement Pinlane d un client : le prix de Pinlane, en euros.
  { f: 'lib/platform-clients.js', l: 'Prix mensuel invalide (0 a 100000 EUR, ou vide pour effacer).', raison: 'abonnement Pinlane, facture en euros' },
  { f: 'assets/app-main.js', l: "euro: '€', pound: '£'", raison: 'decodage de l entite &euro; dans un mail recu' },
  { f: 'assets/app-main.js', l: "return /^arcade/.test(id) && /credit|", raison: 'reconnait des arcades vendues en argent dans le libelle d une formule (10 euros d arcades), aucun montant affiche' },
  // Les comparaisons au code de l euro : seul un centre hors euro change quelque chose.
  { f: 'lib/garde-bilan.js', l: "...(deviseDuCentre !== 'EUR' ? { monnaie: deviseDuCentre } : {}),", raison: 'le bilan dit la monnaie d un centre hors euro' },
  // Les lectures de montants dans un texte : elles reconnaissent l euro ET le franc.
  { f: 'lib/assistant-demande.js', l: 'const PARLE_DE_PRIX = /prix|tarif|forfait|remise|r[ée]duc|factur|€|euro|\\beur\\b|\\bchf\\b|\\bfranc|', raison: 'lecture des mots de la personne' },
  { f: 'lib/assistant-gestes-centre.js', l: '|\\bactive[rz]?\\b|%|€|\\beuro|\\bchf\\b|\\bfranc/i;', raison: 'lecture des mots de la personne' },
  { f: 'lib/assistant-gestes-centre.js', l: 'const DEMANDE_CARTES = /\\bprix|\\btarif|€|\\beuro|\\bchf\\b|\\bfranc|', raison: 'lecture des mots de la personne' },
  { f: 'lib/assistant-gestes-centre.js', l: 'const DEMANDE_SUPPLEMENTS = /\\bprix|\\btarif|€|\\beuro|\\bchf\\b|\\bfranc|', raison: 'lecture des mots de la personne' },
  { f: 'lib/assistant-gestes-centre.js', l: 'if (m && /€|eur|chf|franc/.test(t)) return {', raison: 'lecture des mots de la personne' },
  { f: 'lib/assistant-outils-centre.js', l: 'const MOTIF_EUROS = /\\d[\\d\\s.,]*(?:[.,]-)?\\s*(?:€|eur(?:os?)?\\b|chf\\b|francs?\\b)|(?:€|\\beur(?:os?)?\\b|\\bchf\\b)\\s*\\d[\\d\\s.,]*/gi;', raison: 'un montant se masque, en euros comme en francs' },
  { f: 'lib/assistant-outils-centre.js', l: "!(FAIT_D_ARGENT.test(f.id) || /\\bEUR\\b|€|\\bCHF\\b/.test(String(f.valeur)))", raison: 'un fait en argent se masque' },
  { f: 'lib/assistant-verite.js', l: '(%|€|CHF\\b|euros?\\b|francs?\\b|pts?\\b|points?\\b)', raison: 'controle des nombres de la reponse' },
  { f: 'lib/assistant-verite.js', l: "const enEuros = /€|euro|chf|franc/i.test(c.unite);", raison: 'controle des nombres de la reponse' },
  { f: 'lib/center-guards.js', l: '(?:EUR(?:OS?)?\\\\b|€|CHF\\\\b|FRANCS?\\\\b)', raison: 'garde des montants dans un texte' },
  { f: 'lib/client-writing.js', l: 'const MOTIF_MONTANT = /montant|prix|tarif|€|\\bchf\\b/i;', raison: 'doctrine d ecriture : repere un montant' },
  { f: 'lib/demande-bureau.js', l: '|euros?\\\\b|EUR\\\\b|francs?\\\\b|CHF\\\\b)`', raison: 'lecture des montants d un mail, toutes monnaies' },
  { f: 'lib/marketing-agents.js', l: 'const EURO_RX = /\\d+(?:[.,]\\d+)?\\s?(?:€|eur(?:os?)?\\b|chf\\b|francs?\\b)/gi;', raison: 'lecture des montants d un texte marketing' },
  { f: 'lib/marketing-ask.js', l: '(?:€|eur(?:os?)?\\b|chf\\b|francs?\\b)/gi)', n: 2, raison: 'lecture des montants d un texte marketing' },
  // Les invites des modeles : des exemples de format, la monnaie du centre leur est dite a part
  // (lib/assistant-agent.js ditLaMonnaie, lib/garde-bilan.js consigneDuBilan).
  { f: 'lib/assistant-agent.js', l: 'reste une seule ligne laser : parties 1, groupes [10, 14]', raison: 'exemple d invite du modele' },
  { f: 'lib/assistant-demande.js', l: 'le montant de TOUTE la réservation, en euros. « 30 € par personne »', raison: 'description d outil, la monnaie du centre est dite dans le contexte' },
  { f: 'lib/assistant-demande.js', l: "raison_prix: { type: 'string', description: 'Avec prix_total : la raison en quelques mots, par exemple « forfait 30 € par personne ».' },", raison: 'description d outil' },
  { f: 'lib/assistant-outils.js', l: 'le montant de TOUTE la réservation, en euros. « 30 € par personne »', raison: 'description d outil' },
  { f: 'lib/assistant-outils.js', l: "raison_prix: { type: 'string', description: 'Avec prix_total : la raison en quelques mots, par exemple « forfait 30 € par personne ».' },", raison: 'description d outil' },
  { f: 'lib/assistant-gestes-centre.js', l: "offre: 'facultatif : son titre, lu dans catalogue_et_tarifs", raison: 'description d outil' },
  { f: 'lib/email-assist.js', l: '« 18 € par enfant, dès 6 enfants » vaut mieux que « un prix doux »', raison: 'exemple d invite du modele' },
  { f: 'lib/email-assist.js', l: 'gardé le prix du pack anniversaire, 18 € par enfant', raison: 'exemple d invite du modele' },
  { f: 'lib/garde-bilan.js', l: 'Écris les montants avec deux décimales après une virgule', raison: 'invite du bilan de Pinlane, la monnaie d un centre hors euro y est ajoutee' },
  { f: 'lib/garde-bilan.js', l: 'La dépense IA (depenseIA) est en dollars', raison: 'invite du bilan de Pinlane' },
  // Les libelles fixes relus a la sortie par monnaie.localiserSignes (api/ops.js).
  { f: 'lib/campaigns.js', l: "description: 'Au moins 4 visites ou 500 € dépensés.'", raison: 'relu par localiserSignes a la sortie' },
  { f: 'lib/ops-communications.js', l: "loyal: 'Fidèles (4 visites ou 500 €)',", raison: 'relu par localiserSignes a la sortie' },
];

section('[A] LE BALAYAGE : chaque « € » ou EUR du code est une ecriture par la monnaie du centre, ou une derogation a la ligne');
const fichiers = fichiersBalayes();
const vues = new Map(DEROGATIONS.map((d) => [d, 0]));
const libres = [];
for (const f of fichiers) {
  const lignes = codeSeul(lire(f));
  lignes.forEach((ligne, i) => {
    if (!SIGNE.test(ligne)) return;
    const d = DEROGATIONS.find((x) => x.f === f && ligne.includes(x.l));
    if (d) { vues.set(d, vues.get(d) + 1); return; }
    libres.push(`${f}:${i + 1}  ${ligne.trim().slice(0, 140)}`);
  });
}
ok(fichiers.length > 100 && fichiers.includes('lib/ops-communications.js') && fichiers.includes('assets/fungalaxy-booking.js') && fichiers.includes('index.html'), `le balayage lit api, lib, assets et les pages (${fichiers.length} fichiers)`);
ok(libres.length === 0, 'aucun signe de l euro en dur hors des derogations nommees', `\n${libres.join('\n')}`);

section('[B] LES DEROGATIONS RESTENT VRAIES : chacune couvre exactement ses lignes');
const perimees = DEROGATIONS.filter((d) => vues.get(d) !== (d.n === undefined ? 1 : d.n)).map((d) => `${d.f} « ${d.l.slice(0, 70)} » : ${vues.get(d)} ligne(s) au lieu de ${d.n === undefined ? 1 : d.n}`);
ok(perimees.length === 0, `${DEROGATIONS.length} derogations, chacune sur sa ligne`, `\n${perimees.join('\n')}`);
ok(DEROGATIONS.every((d) => d.raison && d.raison.length > 8), 'chaque derogation dit pourquoi');

console.log(rouges ? `\ndevise-balayage-check: ${rouges} rouge(s)` : '\ndevise-balayage-check: ALL OK');
process.exit(rouges ? 1 : 0);

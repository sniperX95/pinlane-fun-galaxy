// La page « Apprentissage de l'IA » : reservee a la plateforme, et honnete.
//
// Demande de Movsar (2026-07-28) : « j'aimerais pour moi cote admin uniquement
// un truc ou je peux voir l'evolution de l'IA integree, son apprentissage ».
// Deux choses doivent tenir dans le temps :
//
//   1. « cote admin uniquement » est une regle de SERVEUR. Cacher l'entree de
//      menu ne protege rien : l'action reste appelable par lien direct. Ce gate
//      verifie que api/ops.js exige platform.admin sur `aiLearning`, et que la
//      page est declaree platform.admin cote UI (les deux, pas l'un ou l'autre).
//   2. La page doit dire ce qu'elle NE SAIT PAS. L'apprentissage par les
//      resultats demande des publications mesurees ; tant qu'il n'y en a pas,
//      un tableau de bord d'IA qui affiche quand meme des courbes ment. Le
//      lecteur (lib/marketing-learning.js) doit donc marquer `measurement.empty`
//      et la page doit rendre un etat vide EXPLIQUE.

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
let failures = 0;

function ok(cond, label) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`);
  if (!cond) failures += 1;
  return cond;
}

const OPS = path.join(root, 'api/ops.js');
const APP = path.join(root, 'assets/app-main.js');
const COCKPIT = path.join(root, 'assets/founder-cockpit.js');
const LIB = path.join(root, 'lib/marketing-learning.js');

// ===========================================================================
console.log('[1] Le serveur exige platform.admin');
// ===========================================================================
const ops = fs.readFileSync(OPS, 'utf8');
const permLine = ops.match(/if \(action === 'aiLearning'\) return '([^']+)';/);
ok(Boolean(permLine), 'api/ops.js declare une permission pour aiLearning');
ok(permLine && permLine[1] === 'platform.admin', `la permission est platform.admin (lue : ${permLine ? permLine[1] : 'aucune'})`);
ok(/if \(action === 'aiLearning'\) \{/.test(ops), 'api/ops.js sert bien l action aiLearning');

// ===========================================================================
console.log('\n[2] L UI declare la page au meme niveau');
// ===========================================================================
const app = fs.readFileSync(APP, 'utf8');
const uiPerm = app.match(/'cockpit-ia': \[([^\]]+)\]/);
ok(Boolean(uiPerm), 'app-main.js declare les permissions de la page cockpit-ia');
ok(uiPerm && uiPerm[1].includes('platform.admin'), 'la page cockpit-ia exige platform.admin');
ok(/'cockpit-ia',/.test(app), 'cockpit-ia est une page connue (deep-link resolu, pas de retombee sur planning)');

// ===========================================================================
console.log('\n[3] Le lecteur distingue ce qui est APPRIS de ce qui est pose');
// ===========================================================================
const { isLearned, readEvidence } = require(LIB);
ok(isLearned('observed_sortie_locale', {}) === true,
  'un critere prefixe observed_ est compte comme appris');
ok(isLearned('center_truth', { signalType: '' }) === false,
  'un critere de depart sans signal n est PAS compte comme appris');
ok(isLearned('center_truth', { signalType: 'seed' }) === false,
  'un signal seed reste un critere de depart');
ok(isLearned('center_truth', { signalType: 'strategy_seed' }) === true,
  'un critere revu depuis une observation terrain est compte comme appris');
const evidence = readEvidence('{"source":"internal_playbook","signalType":"strategy_seed","keywords":["a","b"]}');
ok(evidence.source === 'internal_playbook' && evidence.keywords.length === 2,
  'l evidence JSON est lue (source + mots-cles)');
ok(readEvidence('pas du json').source === '',
  'une evidence illisible ne fait pas tomber la lecture');

// ===========================================================================
console.log('\n[4] L etat vide de l apprentissage par resultats est EXPLIQUE');
// ===========================================================================
const cockpit = fs.readFileSync(COCKPIT, 'utf8');
const emptyBlock = cockpit.slice(cockpit.indexOf('function renderIaMeasurement'), cockpit.indexOf('function renderIaGrid'));
ok(emptyBlock.includes('measurement.empty'), 'le rendu teste measurement.empty');
ok(/aucune proposition n\\?'a encore été publiée/.test(emptyBlock),
  'l etat vide dit POURQUOI il est vide (aucune publication mesuree)');
ok(emptyBlock.includes('14 jours'), 'il rappelle la condition de deblocage (la mesure a 14 jours)');
const lib = fs.readFileSync(LIB, 'utf8');
ok(/empty: rows\.length === 0 && armRows\.length === 0/.test(lib),
  'le lecteur marque empty quand les deux tables d apprentissage sont vides');

// ===========================================================================
console.log('\n[5] L apprentissage remonte des VISITES, pas de la note du correcteur');
// ===========================================================================
// Tout le reste de cette page lit ce que l agent pense de lui-meme. Ce bloc
// defend le seul signal qui ne vient pas de lui : l auteur du texte publie
// croise avec l ecart de frequentation mesure a 14 jours. Deux choses doivent
// tenir : l auteur est ECRIT au moment de la creation (sans lui, rien a
// croiser), et aucun verdict ne sort d un echantillon trop mince.
const { aggregateAuthorship } = require(LIB);
const brief = fs.readFileSync(path.join(root, 'lib/marketing-brief.js'), 'utf8');
const metrics = fs.readFileSync(path.join(root, 'lib/center-metrics.js'), 'utf8');
ok(/auteur: pack\.generationMode === 'ai' \? 'ai' : 'rules'/.test(brief),
  'une proposition creee a la demande enregistre QUI l a ecrite');
ok(/'auteur', \$7::text/.test(brief),
  'une variante reecrite met l auteur A JOUR (c est la version publiee qui compte)');
ok(/auteur: idea\.auteur === 'ai' \? 'ai' : 'rules'/.test(metrics),
  'une idee du cycle data enregistre aussi son auteur');
// L invariant defendu n a pas bouge : l auteur est un FAIT, jamais une
// intention. Ce qui a bouge, c est le code qui le porte. Avant, le cycle
// publiait soit la reecriture du modele (auteur 'ai'), soit le gabarit
// (auteur 'rules'), et l assertion lisait ce ternaire. Depuis le passage a
// lib/center-advisor.js il n y a plus de gabarit : soit une proposition passe
// les garde-fous et elle est publiee comme venant du modele, soit RIEN n est
// publie. On asserte donc la meme propriete sur le nouveau chemin, en
// inspectant le corps reel de la fonction.
const debutCycle = metrics.indexOf('async function runDataIdeasCycle');
const finCycle = metrics.indexOf('\nfunction computeInsightMeasurement', debutCycle);
const corpsCycle = metrics.slice(debutCycle, finCycle > debutCycle ? finCycle : debutCycle + 6000);
ok(debutCycle > 0 && corpsCycle.length > 800,
  'MONTAGE : le corps de runDataIdeasCycle est bien inspecte');
ok(/if \(rendu\.proposition\)/.test(corpsCycle) && /auteur: 'ai'/.test(corpsCycle),
  'et l auteur suit le FAIT : seule une proposition qui a passe les gardes est publiee, comme venant du modele');
// L invariant defendu ici est « aucun texte n est publie sans avoir passe les
// gardes ». Il etait mesure par deux proxys : l absence totale de
// `auteur: 'rules'` dans le cycle, et la position de la PREMIERE insertion.
// Les deux sont tombes le jour ou le cycle a commence a ecrire une PISTE :
// une question a trancher, ecrite avant la branche, marquee 'rules' parce
// qu aucun modele ne l a redigee. L invariant, lui, tenait toujours : une
// piste ne porte aucun texte a publier. On asserte donc la propriete
// elle-meme au lieu de ses proxys.
const contenusEcrits = [...corpsCycle.matchAll(/readyContent: ([^,\n]+)/g)].map((m) => m[1].trim());
ok(contenusEcrits.length >= 2, `MONTAGE : le cycle ecrit bien plusieurs lignes (${contenusEcrits.length})`);
ok(contenusEcrits.every((valeur) => valeur === 'null' || valeur === 'rendu.proposition.corps'),
  `le SEUL contenu pret a coller que ce cycle ecrit vient de la proposition (${contenusEcrits.join(' | ')})`);
ok(corpsCycle.indexOf('readyContent: rendu.proposition.corps') > corpsCycle.indexOf('if (rendu.proposition)'),
  'et il est ecrit DANS la branche de la proposition : pas de publication sans texte verifie');

// La piste, elle, est une question : ni texte, ni canal. Si elle gagnait un
// jour un contenu ou un canal, l assertion ci-dessus tomberait, et celle-ci
// dit pourquoi.
// Ancre SEMANTIQUE : ce qui identifie la ligne (son genre), pas le nom de la
// variable qui la porte. Un refactor peut renommer la variable sans rien
// changer a la propriete defendue ; il ne peut pas changer le genre sans
// changer la ligne.
const debutPiste = corpsCycle.indexOf("kind: 'piste'");
const corpsPiste = debutPiste > 0 ? corpsCycle.slice(debutPiste, corpsCycle.indexOf('};', debutPiste)) : '';
ok(debutPiste > 0 && corpsPiste.length > 60,
  `MONTAGE : le litteral de la piste est bien inspecte (${corpsPiste.length} caracteres)`);
ok(/readyContent: null/.test(corpsPiste) && /channel: null/.test(corpsPiste),
  'la piste ne porte ni texte a coller ni canal : elle se tranche, elle ne se publie pas');

// Et elle ne peut pas fausser la comparaison modele / gabarit : cette lecture
// ne prend que les lignes MESUREES, et une piste ne rejoint jamais le panneau
// « Appliquer » qui declenche la mesure (lib/founder-cockpit.js).
const sourceApprentissage = fs.readFileSync(path.join(root, 'lib/marketing-learning.js'), 'utf8');
ok(/measured_at is not null and result is not null/.test(sourceApprentissage),
  'la comparaison des auteurs ne lit que des publications MESUREES');
const sourceCockpitServeur = fs.readFileSync(path.join(root, 'lib/founder-cockpit.js'), 'utf8');
ok(/kind <> 'piste'/.test(sourceCockpitServeur),
  'et une piste n atteint jamais le bouton qui la ferait passer en mesure');

const mesure = (auteur, nets, wins = 0) => nets.map((netDeltaPct, index) => ({
  auteur, result: { netDeltaPct }, status: index < wins ? 'validated' : 'inconclusive',
}));
const mince = aggregateAuthorship([...mesure('ai', [20, 30]), ...mesure('rules', [5])]);
ok(mince.verdict === null, 'echantillon mince : AUCUN verdict n est rendu');
ok(/au moins 3 publications mesurees de chaque cote/.test(mince.pourquoiPasDeVerdict)
  && /2 pour le modele/.test(mince.pourquoiPasDeVerdict),
  `et la page dit ce qui manque, chiffre a l appui ("${mince.pourquoiPasDeVerdict}")`);
const seul = aggregateAuthorship(mesure('rules', [4, 5, 6, 7]));
ok(seul.verdict === null && /Aucune publication mesuree ecrite par le modele/.test(seul.pourquoiPasDeVerdict),
  'un seul auteur mesure : rien a comparer, et c est dit');
const assez = aggregateAuthorship([...mesure('ai', [20, 24, 16], 2), ...mesure('rules', [4, 6, 8], 1)]);
ok(assez.verdict && assez.verdict.gagnant === 'ai' && assez.verdict.ecartPoints === 14,
  `avec 3 mesures de chaque cote, le verdict sort et il est calcule (${assez.verdict && assez.verdict.ecartPoints} points)`);
ok(assez.auteurs[0].n === 3 && assez.auteurs[0].wins === 2 && assez.auteurs[0].confiance === 'signal',
  'le detail par auteur porte son volume, ses reussites et sa confiance');
// CONTRE-PREUVE : l agregation lit bien l EFFET MESURE, pas un compteur de
// publications. Le modele qui publie DIX fois pour un effet mediocre ne doit
// pas passer devant le gabarit qui publie trois fois pour un effet fort.
const volumeur = aggregateAuthorship([...mesure('ai', [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]), ...mesure('rules', [30, 30, 30])]);
ok(volumeur.verdict && volumeur.verdict.gagnant === 'rules',
  'CONTRE-PREUVE : publier BEAUCOUP ne fait pas gagner, c est l effet mesure qui tranche');
const cockpitAuthor = cockpit.slice(cockpit.indexOf('function renderIaAuthorship'), cockpit.indexOf('function renderIaGrid'));
ok(cockpitAuthor.includes('pourquoiPasDeVerdict'),
  'la page AFFICHE la raison du non-verdict au lieu d une conclusion fabriquee');
ok(/renderIaAuthorship\(d\.authorship/.test(cockpit), 'le panneau est bien monte dans la page');

// ===========================================================================
console.log('\n[6] CONTRE-PREUVE par mutation (ce gate sait-il rougir ?)');
// ===========================================================================
const original = fs.readFileSync(OPS, 'utf8');
const anchor = "if (action === 'aiLearning') return 'platform.admin';";
if ((original.split(anchor).length - 1) !== 1) {
  ok(false, 'ancre de mutation introuvable ou ambigue dans api/ops.js');
} else {
  fs.writeFileSync(OPS, original.replace(anchor, "if (action === 'aiLearning') return 'dashboard.view';"));
  let downgraded = false;
  try {
    const mutated = fs.readFileSync(OPS, 'utf8').match(/if \(action === 'aiLearning'\) return '([^']+)';/);
    downgraded = Boolean(mutated) && mutated[1] !== 'platform.admin';
  } finally {
    fs.writeFileSync(OPS, original); // restauration par edition inverse
  }
  ok(downgraded, 'permission abaissee a dashboard.view : le gate ROUGIRAIT');
  const restored = fs.readFileSync(OPS, 'utf8').match(/if \(action === 'aiLearning'\) return '([^']+)';/);
  ok(restored && restored[1] === 'platform.admin', 'restauration inverse : platform.admin est revenu');
}

if (failures) {
  console.error(`\nai-learning-check: FAIL ${failures} assertion(s)`);
  process.exit(1);
}
console.log('\nai-learning-check: ALL OK - lecture reservee a la plateforme, et ce qui manque est nomme.');

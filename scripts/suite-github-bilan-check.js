// LE BILAN D UNE SUITE GITHUB SE LIT AVANT D ETRE DIT VERT (2026-11-12).
//
// scripts/suite-github.js, lireLeBilan, joue avec un faux `gh` : aucun reseau,
// aucune etiquette poussee, un dossier temporaire par cas. Le faux refuse
// d ecrire un fichier deja la, comme le vrai `gh run download` (vu le
// 2026-11-12 sur le run 43090621688).
//
//   [A] le telechargement rate quatre fois puis passe (la coupure du Wi-Fi du
//       2026-11-11) : le bilan est lu, sortie 0, jamais « aucun gate » ;
//   [B] il rate a chaque essai alors que le passage a publie un bilan :
//       sortie 2 avec la commande pour le relire, jamais VERT ;
//   [C] le passage n a publie aucun bilan (aucun gate touche par le diff) :
//       sortie 0, « VERT : aucun gate a jouer », sans attendre ;
//   [D] la liste des artefacts ne se lit pas non plus : sortie 2 ;
//   [E] une extraction coupee laisse un morceau du bilan : l essai suivant,
//       dans un dossier neuf, le lit, et aucun dossier rate ne reste ;
//   [F] un bilan lu avec un rouge : sortie 1 ; un passage rouge sans bilan
//       publie : sortie 2 ;
//   [G] CONTRE-EPREUVES, sur une copie mutee du script en memoire (le disque
//       n est jamais ecrit) : la regle d avant le 2026-11-11 (un telechargement
//       rate sur un passage vert dit VERT) fait rougir [B] ; les essais dans un
//       meme dossier font rougir [E] ; un seul essai fait rougir [A].
//
// Lancement : node scripts/suite-github-bilan-check.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const SCRIPT = path.join(__dirname, 'suite-github.js');
const ID = '43090621688';
const REPO = 'proprietaire/depot';
let echecs = 0;
function ok(condition, message, detail) {
  console.log(`${condition ? 'ok  ' : 'FAIL'}  ${message}${detail ? `  ${detail}` : ''}`);
  if (!condition) echecs += 1;
}

// Le faux `gh` : une etape par essai de telechargement (la derniere se repete),
// et la liste des artefacts du passage (null : elle ne se lit pas).
//   reseau : la coupure du 2026-11-11, rien n est ecrit ;
//   coupe  : le json s ecrit, puis l extraction s arrete ;
//   ok     : le json et le texte s ecrivent.
function fauxGh(cas) {
  let essais = 0;
  const lancer = (args) => {
    if (args[0] === 'run' && args[1] === 'download') {
      essais += 1;
      const etape = cas.telechargements[Math.min(essais, cas.telechargements.length) - 1];
      if (etape === 'reseau') return { status: 1, stdout: '', stderr: 'error connecting to productionresultssa10.blob.core.windows.net' };
      const dossier = args[args.indexOf('--dir') + 1];
      try {
        fs.writeFileSync(path.join(dossier, 'bilan-assemble.json'), JSON.stringify(cas.bilan || { rouges: 0, manquantes: [] }), { flag: 'wx' });
        if (etape === 'coupe') return { status: 1, stdout: '', stderr: 'error downloading bilan: error extracting zip archive' };
        fs.writeFileSync(path.join(dossier, 'bilan-assemble.txt'), 'BILAN ASSEMBLE 400 scripts (420 unites) en 7 parts : 395 verts, 0 rouges', { flag: 'wx' });
        return { status: 0, stdout: '', stderr: '' };
      } catch (erreur) {
        return { status: 1, stdout: '', stderr: `error extracting "bilan-assemble.json": ${erreur.code}` };
      }
    }
    if (args[0] === 'api') {
      if (cas.artefacts === null) return { status: 1, stdout: '', stderr: 'error connecting to api.github.com' };
      return { status: 0, stdout: JSON.stringify(cas.artefacts), stderr: '' };
    }
    return { status: 1, stdout: '', stderr: `appel inattendu : ${args.join(' ')}` };
  };
  return { lancer, essais: () => essais };
}

async function jouer(lib, cas) {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'suite-bilan-check-'));
  const faux = fauxGh(cas);
  const lignes = [];
  const pauses = [];
  let code = null;
  try {
    code = await lib.lireLeBilan({
      repo: REPO, id: ID, conclusion: cas.conclusion || 'success', lancer: faux.lancer, racine,
      patienter: async (ms) => { pauses.push(ms); },
      dire: (t) => lignes.push(String(t)), alerter: (t) => lignes.push(String(t)),
    });
  } catch (erreur) {
    lignes.push(`EXCEPTION ${erreur && erreur.message}`);
  }
  const restes = fs.readdirSync(racine);
  fs.rmSync(racine, { recursive: true, force: true });
  return { code, texte: lignes.join('\n'), essais: faux.essais(), pauses, restes };
}

const CAS = {
  A: { telechargements: ['reseau', 'reseau', 'reseau', 'reseau', 'ok'], artefacts: ['bilan', 'journaux-part-1'] },
  B: { telechargements: ['reseau'], artefacts: ['bilan', 'journaux-part-1'] },
  C: { telechargements: ['reseau'], artefacts: ['journaux-part-1'] },
  D: { telechargements: ['reseau'], artefacts: null },
  E: { telechargements: ['coupe', 'ok'], artefacts: ['bilan'] },
  F1: { telechargements: ['ok'], artefacts: ['bilan'], bilan: { rouges: 1, manquantes: [] } },
  F2: { telechargements: ['reseau'], artefacts: [], conclusion: 'failure' },
};

// Les regles, chacune rendue vraie ou fausse, pour le script et pour ses mutants.
const REGLES = {
  A: (r) => r.code === 0 && r.texte.includes('BILAN ASSEMBLE') && !r.texte.includes('aucun gate') && r.essais === 5 && r.pauses.length === 4 && r.pauses.every((ms) => ms >= 20000),
  B: (r) => r.code === 2 && !r.texte.includes('VERT') && r.texte.includes('un bilan existe mais ne se telecharge pas') && r.texte.includes(`gh run download ${ID}`) && r.essais === 5,
  C: (r) => r.code === 0 && r.texte.includes('VERT : aucun gate a jouer') && r.essais === 1 && r.pauses.length === 0,
  D: (r) => r.code === 2 && !r.texte.includes('VERT') && r.texte.includes('la liste des bilans ne se lit pas'),
  E: (r) => r.code === 0 && r.texte.includes('BILAN ASSEMBLE') && r.essais === 2 && r.restes.length === 1,
  F1: (r) => r.code === 1,
  F2: (r) => r.code === 2 && !r.texte.includes('VERT') && r.texte.includes('aucun bilan publie'),
};
const DIT = {
  A: 'quatre telechargements rates puis un bon : le bilan est lu, sortie 0, jamais « aucun gate »',
  B: 'un bilan publie qui ne se telecharge pas : sortie 2 et la commande pour le relire, jamais VERT',
  C: 'aucun bilan publie sur un passage vert : VERT sans attendre, au premier essai',
  D: 'la liste des artefacts illisible : sortie 2, jamais VERT',
  E: 'une extraction coupee : l essai suivant, dans un dossier neuf, lit le bilan, rien ne reste',
  F1: 'un bilan lu avec un rouge : sortie 1',
  F2: 'un passage rouge sans bilan publie : sortie 2, jamais VERT',
};
const resume = (r) => `code ${r.code}, ${r.essais} essai(s), ${r.pauses.length} pause(s), ${r.restes.length} dossier(s) laisse(s) : ${r.texte.split('\n').slice(-1)[0].slice(0, 140)}`;

// Une copie mutee du script, compilee en memoire. Une ancre absente se dit :
// la contre-epreuve ne doit jamais passer parce que sa mutation ne s applique plus.
function chargerMutant(mutations) {
  let source = fs.readFileSync(SCRIPT, 'utf8').split('\r\n').join('\n');
  for (const m of mutations) {
    if (!source.includes(m.de)) return { absente: m.de };
    source = source.replace(m.de, () => m.vers);
  }
  const mutant = new Module(SCRIPT, module);
  mutant.filename = SCRIPT;
  mutant.paths = Module._nodeModulePaths(__dirname);
  mutant._compile(source, SCRIPT);
  return { lib: mutant.exports };
}

const CONTRE_EPREUVES = [
  {
    nom: 'la regle d avant le 2026-11-11 : un telechargement rate sur un passage vert dit VERT',
    cas: 'B',
    mutations: [{ fichier: 'scripts/suite-github.js', de: "if (Array.isArray(noms) && !noms.includes('bilan')) {", vers: 'if (true) {' }],
  },
  {
    nom: 'tous les essais dans le meme dossier',
    cas: 'E',
    mutations: [{ fichier: 'scripts/suite-github.js', de: "    if (dossier) fs.rmSync(dossier, { recursive: true, force: true });\n    dossier = fs.mkdtempSync(path.join(racine, 'suite-github-'));", vers: "    if (!dossier) dossier = fs.mkdtempSync(path.join(racine, 'suite-github-'));" }],
  },
  {
    nom: 'un seul essai de telechargement',
    cas: 'A',
    mutations: [{ fichier: 'scripts/suite-github.js', de: 'essais = 5, pause = 30000', vers: 'essais = 1, pause = 30000' }],
  },
];

(async () => {
  const lib = require('./suite-github');
  ok(typeof lib.lireLeBilan === 'function', '[0] scripts/suite-github.js exporte lireLeBilan sans lancer de suite');
  for (const nom of Object.keys(CAS)) {
    const r = await jouer(lib, CAS[nom]);
    ok(REGLES[nom](r), `[${nom.charAt(0)}] ${DIT[nom]}`, resume(r));
  }
  for (const ce of CONTRE_EPREUVES) {
    const charge = chargerMutant(ce.mutations);
    if (charge.absente) { ok(false, `[G] contre-epreuve « ${ce.nom} » : ancre introuvable dans scripts/suite-github.js`, charge.absente.slice(0, 80)); continue; }
    const r = await jouer(charge.lib, CAS[ce.cas]);
    ok(!REGLES[ce.cas](r), `[G] contre-epreuve « ${ce.nom} » : [${ce.cas}] la voit`, resume(r));
  }
  console.log(echecs ? `\n${echecs} echec(s)` : '\nsuite-github-bilan : tout est vert');
  process.exit(echecs ? 1 : 0);
})().catch((erreur) => { console.error(erreur); process.exit(1); });

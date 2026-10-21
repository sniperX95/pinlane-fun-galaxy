// LES CARACTERES DE CONTROLE (2026-10-21).
//
// Un patch ecrit a travers un shell peut perdre un antislash : le `\b` d une
// regex y devient le caractere 8 (retour arriere). La regex reste valide et ne
// matche plus jamais rien. Deux gates l ont porte des semaines en restant
// verts : simulation-isolation (77b7af4, une alternative morte dans le verrou
// du planificateur) et heures-passees (d2a9fbc, trois selecteurs de case dont
// le filtre etait toujours vrai : le gate posait l heure proposee par le
// moteur au lieu d une case libre). L outil de lecture n affiche rien a la
// place du caractere : seul un balayage des octets le voit.
//
// Ce gate lit chaque fichier texte que git voit (suivis et non suivis, sans
// les ignores : scripts/gates-commun.js) et refuse tout caractere de controle
// sauf la tabulation, le CR et le LF : C0 (00 a 1F), DEL (7F) et C1 (U+0080 a
// U+009F, en UTF-8 les octets C2 80 a C2 9F).
//
// Les binaires se reconnaissent a leur EXTENSION (BINAIRES), pas a l avis de
// git : git range en binaire un fichier qui contient un octet nul ou un CR
// seul (scripts/upsell-settings-app-check.js l est, 2026-10-21), et c est
// justement ce qu il faut lire. Un nouveau type binaire rougit ici : ajouter
// son extension a BINAIRES.
//
// Un caractere de controle voulu s ecrit en sequence d echappement dans le
// source (String.fromCharCode(27), un \x1b dans une chaine), jamais en octet
// brut.
//
// Garde anti-echantillon-vide : moins de MINIMUM_FICHIERS fichiers texte, ou
// un temoin absent de la liste, et le gate rougit au lieu de passer sur du
// vide.
//
// CONTRE-EPREUVE (--mutate) : chaque caractere est injecte EN MEMOIRE dans un
// fichier du depot (le disque n est jamais ecrit, et on le verifie) ; le gate
// doit rougir et nommer exactement ce fichier, ce caractere, autant de fois
// qu il a ete injecte. Un contre-temoin injecte une tabulation, un CR seul et
// un LF : le gate doit rester vert.
//
// Lancement : node scripts/caracteres-de-controle-check.js [--mutate]
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const commun = require('./gates-commun');

const ROOT = commun.ROOT;
const MOI = 'scripts/caracteres-de-controle-check.js';
const MINIMUM_FICHIERS = 300;
const TEMOINS = ['package.json', 'lib/reservation-ops.js', MOI];
const BINAIRES = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.bmp', '.tif', '.tiff', '.heic',
  '.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.mp4', '.webm', '.mov',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.pdf', '.zip', '.gz', '.tgz', '.7z', '.br', '.wasm',
]);

const NUL = String.fromCharCode(0);
const RETOUR = String.fromCharCode(8);
const TAB = String.fromCharCode(9);
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const SUPPRESSION = String.fromCharCode(127);
const LIGNE_SUIVANTE = String.fromCharCode(133);

const NOMS = {
  0: 'octet nul', 8: 'retour arriere', 11: 'tabulation verticale', 12: 'saut de page',
  27: 'echappement', 127: 'suppression', 133: 'ligne suivante C1',
};
const nomDe = (code) => NOMS[code] || (code < 32 ? 'controle C0' : 'controle C1');
const hex = (code) => `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
const interdit = (code) => (code < 32 && code !== 9 && code !== 10 && code !== 13) || (code >= 127 && code <= 159);

const MUTATIONS = [
  {
    nom: 'le retour arriere de 77b7af4 revient dans simulation-isolation',
    fichier: 'scripts/simulation-isolation-check.js',
    de: '(?:readStaffState\\b|',
    vers: '(?:readStaffState' + RETOUR + '|',
    fois: 1, code: 8, rouge: true,
  },
  {
    nom: 'les trois retours arriere de d2a9fbc reviennent dans heures-passees',
    fichier: 'scripts/heures-passees-check.js',
    de: 'wave)\\b/',
    vers: 'wave)' + RETOUR + '/',
    fois: 3, code: 8, rouge: true,
  },
  {
    nom: 'un octet nul dans lib/reservation-ops.js (git rangerait le fichier en binaire)',
    fichier: 'lib/reservation-ops.js',
    de: 'const readState = options.readState',
    vers: 'const readState = options.readState' + NUL,
    fois: 1, code: 0, rouge: true,
  },
  {
    nom: 'un caractere C1 (ligne suivante) dans index.html',
    fichier: 'index.html',
    de: '<!DOCTYPE html>',
    vers: '<!DOCTYPE html>' + LIGNE_SUIVANTE,
    fois: 1, code: 133, rouge: true,
  },
  {
    nom: 'un DEL dans package.json',
    fichier: 'package.json',
    de: '"db:migrate": "node scripts/run-db-migrations.js"',
    vers: '"db:migrate": "node scripts/run-db-migrations.js"' + SUPPRESSION,
    fois: 1, code: 127, rouge: true,
  },
  {
    nom: 'une tabulation, un CR seul et un LF dans assets/pinlane.css (permis)',
    fichier: 'assets/pinlane.css',
    de: '--page: #fafafa;',
    vers: '--page: #fafafa;' + TAB + CR + LF,
    fois: 1, code: null, rouge: false,
  },
];
const MUTATION_PREUVE = '[mutation] servie :';
const MUTATION_ACTIVE = Number(process.env.PINLANE_CONTROLE_MUTATION || 0);
const MUTATION = MUTATION_ACTIVE ? MUTATIONS[MUTATION_ACTIVE - 1] : null;

// Le contenu d un fichier ; sous --mutate, celui de la cible arrive mute ici,
// en memoire, et nulle part ailleurs.
function lire(rel) {
  const brut = fs.readFileSync(path.join(ROOT, rel));
  if (!MUTATION || MUTATION.fichier !== rel) return brut;
  const texte = brut.toString('utf8');
  const fois = texte.split(MUTATION.de).length - 1;
  if (fois !== MUTATION.fois) {
    console.error(`mutation impossible : ancre trouvee ${fois} fois (attendu ${MUTATION.fois}) dans ${rel} : ${MUTATION.de}`);
    process.exit(2);
  }
  console.log(`${MUTATION_PREUVE} ${MUTATION.nom}`);
  return Buffer.from(texte.split(MUTATION.de).join(MUTATION.vers), 'utf8');
}

// Les octets, pas le texte decode : C0 et DEL sont des octets seuls en UTF-8,
// un C1 est la paire C2 80 a C2 9F.
function chercher(buf) {
  const trouves = [];
  let ligne = 1;
  let debutLigne = 0;
  for (let k = 0; k < buf.length; k += 1) {
    const b = buf[k];
    if (b === 10) { ligne += 1; debutLigne = k + 1; continue; }
    let code = -1;
    if (b < 128 && interdit(b)) code = b;
    else if (b === 0xc2 && k + 1 < buf.length && buf[k + 1] >= 0x80 && buf[k + 1] <= 0x9f) code = buf[k + 1];
    if (code >= 0) trouves.push({ code, ligne, colonne: k - debutLigne + 1, k });
  }
  return trouves;
}

// La ligne autour du caractere, chaque controle rendu visible : un octet brut
// dans la console serait aussi invisible que dans l editeur.
function extrait(buf, trouve) {
  const debut = Math.max(trouve.k - 50, buf.lastIndexOf(10, trouve.k) + 1);
  let fin = buf.indexOf(10, trouve.k);
  if (fin < 0) fin = buf.length;
  else if (fin > trouve.k + 1 && buf[fin - 1] === 13) fin -= 1; // le CR d un CRLF n est pas un defaut
  fin = Math.min(fin, trouve.k + 30);
  let rendu = '';
  for (const c of buf.slice(debut, fin).toString('utf8')) {
    const code = c.charCodeAt(0);
    rendu += interdit(code) || code === 13 ? `<${hex(code)}>` : c;
  }
  return rendu.trim();
}

function controler() {
  let fichiers;
  try {
    fichiers = commun.fichiersDuDepot(ROOT);
  } catch (error) {
    console.error(`caracteres-de-controle-check: FAIL git ne liste pas les fichiers du depot (${String(error.message).split(LF)[0]})`);
    process.exit(1);
  }
  const textes = fichiers.filter((rel) => !BINAIRES.has(path.extname(rel).toLowerCase()));
  const absents = TEMOINS.filter((t) => !textes.includes(t));
  if (textes.length < MINIMUM_FICHIERS || absents.length) {
    console.error(`caracteres-de-controle-check: FAIL echantillon vide ou incomplet : ${textes.length} fichiers texte (minimum ${MINIMUM_FICHIERS}), temoins absents : ${absents.join(', ') || 'aucun'}`);
    process.exit(1);
  }
  let octets = 0;
  const defauts = [];
  for (const rel of textes) {
    const buf = lire(rel);
    octets += buf.length;
    for (const t of chercher(buf)) defauts.push({ rel, ...t, extrait: extrait(buf, t) });
  }
  if (defauts.length) {
    console.error(`caracteres-de-controle-check: ${defauts.length} caractere(s) de controle interdit(s).\n`);
    for (const d of defauts.slice(0, 60)) {
      console.error(`  ${d.rel}:${d.ligne}:${d.colonne}  ${hex(d.code)} (${nomDe(d.code)})  ${d.extrait}`);
    }
    if (defauts.length > 60) console.error(`\n  ... et ${defauts.length - 60} autres.`);
    console.error('\nUn caractere de controle voulu s ecrit en echappement (String.fromCharCode, \\x1b), jamais en octet brut.');
    console.error('Un retour arriere apres un mot de regex, c est le plus souvent un \\b perdu par un shell.');
    process.exit(1);
  }
  console.log(`caracteres-de-controle-check: ALL OK (${textes.length} fichiers texte, ${octets} octets, aucun caractere de controle hors tabulation, CR et LF)`);
}

function contreEpreuve() {
  const empreintes = new Map(MUTATIONS.map((m) => [m.fichier, fs.readFileSync(path.join(ROOT, m.fichier))]));
  let defauts = 0;
  MUTATIONS.forEach((m, index) => {
    const r = spawnSync(process.execPath, [__filename], {
      env: { ...process.env, PINLANE_CONTROLE_MUTATION: String(index + 1) },
      encoding: 'utf8',
      timeout: 120000,
    });
    const sortie = `${r.stdout || ''}${r.stderr || ''}`;
    const servie = sortie.includes(`${MUTATION_PREUVE} ${m.nom}`);
    const signales = sortie.split(/\r?\n/)
      .map((l) => /^ {2}(\S+):(\d+):(\d+) {2}U\+([0-9A-F]{4})/.exec(l))
      .filter(Boolean)
      .map((x) => ({ rel: x[1], code: parseInt(x[4], 16) }));
    const resume = signales.map((s) => `${s.rel} ${hex(s.code)}`).join(', ') || 'rien';
    if (r.status === 2 || !servie) {
      defauts += 1;
      console.error(`contre-epreuve DESARMEE : ${m.nom} (${r.status === 2 ? 'ancre introuvable' : 'mutation non servie'})`);
    } else if (m.rouge) {
      const juste = r.status === 1 && signales.length === m.fois && signales.every((s) => s.rel === m.fichier && s.code === m.code);
      if (juste) console.log(`contre-epreuve OK : le gate rougit quand ${m.nom} (${m.fois} x ${hex(m.code)}).`);
      else { defauts += 1; console.error(`contre-epreuve MUETTE ou IMPRECISE : ${m.nom} : code ${r.status}, signale : ${resume}`); }
    } else if (r.status === 0 && !signales.length) {
      console.log(`contre-temoin OK : le gate reste vert avec ${m.nom}.`);
    } else {
      defauts += 1;
      console.error(`contre-temoin ROUGE : le gate refuse ce qui est permis : ${m.nom} : code ${r.status}, signale : ${resume}`);
    }
  });
  const touches = [...empreintes].filter(([f, avant]) => !fs.readFileSync(path.join(ROOT, f)).equals(avant));
  if (touches.length) { defauts += 1; console.error(`un fichier a ete ecrit : ${touches.map(([f]) => f).join(', ')}`); }
  if (defauts) {
    console.error(`\ncaracteres-de-controle-check --mutate: ${defauts} defaut(s).`);
    process.exit(1);
  }
  console.log(`contre-epreuve OK : ${MUTATIONS.length} mutations en memoire, et aucun fichier n a ete ecrit.`);
}

if (process.argv.includes('--mutate')) contreEpreuve();
else controler();

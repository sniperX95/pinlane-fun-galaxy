// LES PARTS D UNE SUITE (2026-10-30, le workflow GitHub).
//
// Le workflow joue la suite en N parts sur N machines (gates-lancer.js
// --partie K/N) puis rassemble leurs bilans (gates-assembler.js). Une erreur
// la ne se voit pas : une unite qui ne tombe dans aucune part n est jouee
// nulle part, et la suite reste verte. Ce gate exige :
//   [A] chaque unite du plan dans une part et une seule, quel que soit N, et
//       la meme repartition a chaque calcul (chaque machine refait le plan) ;
//   [B] des parts equilibrees : aucune ne depasse de moitie la borne basse
//       (la plus longue unite, ou tout le travail reparti sur toutes les places) ;
//   [C] l assemblage : un rouge d une part rougit le bilan, un script coupe
//       entre deux parts revient entier, une part sans bilan rougit ;
//   [D] le vrai lanceur : deux parts d une petite suite, jouees, rendent a
//       elles deux chaque unite une fois, chacune signee de sa part, et
//       l assembleur rend leurs rouges, ni plus ni moins.
// --contre-preuves : chaque regle cassee (en memoire, le disque n est jamais
// ecrit) fait rougir sa lettre.
//
// Lancement : node scripts/gates-parties-check.js [--contre-preuves]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { spawnSync } = require('child_process');
const commun = require('./gates-commun');

const ROOT = path.resolve(__dirname, '..');
const lf = (t) => String(t).split('\r\n').join('\n');
let lignes = [];
let silence = false;
const ok = (cond, label, detail = '') => {
  lignes.push({ cond: Boolean(cond), label });
  if (!silence) console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
};

// Un module du depot, eventuellement mute EN MEMOIRE (le fichier reste intact).
function charger(rel, mutation) {
  const fichier = path.join(ROOT, rel);
  let source = lf(fs.readFileSync(fichier, 'utf8'));
  if (mutation && mutation.fichier === rel) {
    if (!source.includes(mutation.de)) throw new Error(`ancre introuvable pour la mutation ${mutation.nom}`);
    source = source.replace(mutation.de, mutation.vers);
  }
  const m = new Module(fichier, module);
  m.filename = fichier;
  m.paths = Module._nodeModulePaths(path.dirname(fichier));
  m._compile(source, fichier);
  return m.exports;
}

// Le plan reel de la suite entiere, avec les durees de la graine (celles que
// lit chaque machine du workflow).
function planReel() {
  const durees = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'gates-durees.json'), 'utf8'));
  const config = commun.configSuite(ROOT);
  const scripts = commun.scriptsNpm(ROOT);
  const seuls = new Set(config.seuls || []);
  const unites = [];
  for (const nom of config.suite) {
    for (const u of commun.unites(nom, scripts)) {
      const navigateur = commun.piloteUnNavigateur(u.fichier, ROOT);
      unites.push({ ...u, seul: seuls.has(nom), estimee: durees[`${u.script}#${u.rang}`] || (navigateur ? 60 : 8) });
    }
  }
  return unites;
}

// Un plan synthetique : des durees pseudo aleatoires mais fixes (meme graine).
function planSynthetique() {
  let x = 20261030;
  const hasard = () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
  const unites = [];
  for (let i = 0; i < 47; i += 1) unites.push({ script: `test:g${i}`, rang: i % 2, estimee: Math.round(1 + hasard() * 900), seul: false });
  for (let i = 0; i < 5; i += 1) unites.push({ script: `test:seul${i}`, rang: 0, estimee: Math.round(100 + hasard() * 300), seul: true });
  return unites;
}

const cle = (u) => `${u.script}#${u.rang}`;

function verifierRepartition(lanceur, nomPlan, unites) {
  for (const n of [1, 2, 5, 12, 16]) {
    const a = lanceur.repartir(unites, n, 3);
    const b = lanceur.repartir(unites, n, 3);
    const placees = a.flatMap((p) => p.unites.map(cle));
    const distinctes = new Set(placees);
    const manquantes = unites.filter((u) => !distinctes.has(cle(u))).length;
    ok(a.length === n && placees.length === unites.length && distinctes.size === unites.length && !manquantes,
      `[A] ${nomPlan}, ${n} part(s) : chaque unite dans une part et une seule`, `${placees.length} placees, ${distinctes.size} distinctes, ${manquantes} oubliee(s) sur ${unites.length}`);
    ok(JSON.stringify(a.map((p) => p.unites.map(cle))) === JSON.stringify(b.map((p) => p.unites.map(cle))),
      `[A] ${nomPlan}, ${n} part(s) : la meme repartition au second calcul`);
    const nbSeuls = unites.filter((u) => u.seul).length;
    if (n >= nbSeuls) ok(a.every((p) => p.unites.filter((u) => u.seul).length <= 1), `[A] ${nomPlan}, ${n} parts : une unite seule par part au plus`);
    // [B] La borne basse : la plus longue unite, ou tout le travail (une
    // unite seule bloque toutes les places de sa machine) reparti partout.
    const travail = unites.reduce((s, u) => s + u.estimee * (u.seul ? 3 : 1), 0);
    const borne = Math.max(...unites.map((u) => u.estimee), travail / (n * 3));
    const pire = Math.max(...a.map((p) => p.estimee));
    ok(pire <= borne * 1.5, `[B] ${nomPlan}, ${n} part(s) : la plus chargee reste sous 1,5 fois la borne basse`, `${Math.round(pire)} s pour une borne de ${Math.round(borne)} s`);
  }
  let refusee = 0;
  for (const texte of ['0/3', '4/3', 'x', '']) { try { lanceur.partDuPlan(unites, texte, 3); } catch (error) { refusee += 1; } }
  ok(refusee === 4, '[A] une part hors de 1..N est refusee, pas jouee a vide', `${refusee}/4 refusees`);
}

function verifierAssemblage(assembleur) {
  const u = (commande, etat, extra = {}) => ({ commande, etat, code: etat === 'ROUGE' ? 1 : 0, ms: 1000, raison: '', parties: [], fails: etat === 'ROUGE' ? ['FAIL  [X] une regle'] : [], fin: [], ...extra });
  const b1 = { partie: '1/3', msMur: 5000, scripts: [{ nom: 'test:a', unites: [u('node a', 'VERT')] }, { nom: 'test:b', unites: [u('node b', 'ROUGE')] }] };
  const b2 = { partie: '2/3', msMur: 9000, scripts: [{ nom: 'test:b', unites: [u('node b --contre-preuves', 'VERT')] }, { nom: 'test:c', unites: [u('node c', 'INSTABLE')] }] };
  const b3 = { partie: '3/3', msMur: 7000, scripts: [{ nom: 'test:d', unites: [u('node d', 'SAUTE')] }] };
  const a = assembleur.assembler([b1, b2, b3], 3);
  const b = a.scripts.find((s) => s.nom === 'test:b');
  ok(b && b.unites.length === 2, '[C] un script coupe entre deux parts revient entier', b ? `${b.unites.length} unites` : 'absent');
  ok(b && b.etat === 'ROUGE' && a.rouges === 1, '[C] le rouge d une part rougit le bilan, meme si l autre part du script est verte', b ? `test:b ${b.etat}, ${a.rouges} rouge(s)` : '');
  ok(a.instables === 1 && a.sautes === 1 && a.verts === 1 && a.unites === 5, '[C] chaque etat compte une fois', `${a.verts} vert, ${a.instables} instable, ${a.sautes} saute, ${a.unites} unites`);
  ok(a.msMur === 9000, '[C] le mur est celui de la plus longue part', `${a.msMur} ms`);
  const sansDeux = assembleur.assembler([b1, b3], 3);
  ok(sansDeux.manquantes.length === 1 && sansDeux.manquantes[0] === '2/3', '[C] une part sans bilan est dite, donc rouge', sansDeux.manquantes.join(', ') || 'aucune');
  const vide = { partie: '2/2', msMur: 100, scripts: [] };
  const vert = assembleur.assembler([{ ...b1, partie: '1/2', scripts: [b1.scripts[0]] }, vide], 2);
  ok(!vert.rouges && !vert.manquantes.length, '[C] une part qui n avait rien a jouer reste une part rendue', `${vert.rouges} rouge(s), ${vert.manquantes.length} manquante(s)`);
}

// [D] Le vrai lanceur, en ligne de commande, dans un dossier temporaire a lui.
function verifierLanceurReel(assembleur) {
  const noms = ['test:no-em-dash', 'test:ancres', 'test:constants-drift'];
  const attendues = noms.flatMap((nom) => commun.unites(nom, commun.scriptsNpm(ROOT)).map(cle)).sort();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-parties-'));
  const env = { ...process.env, TEMP: tmp, TMP: tmp, TMPDIR: tmp, PINLANE_GATES_PORT_DEPART: process.env.PINLANE_GATES_PORT_DEPART || '39000' };
  try {
    const sorties = [];
    for (const partie of ['1/2', '2/2']) {
      const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'gates-lancer.js'), ...noms, '--partie', partie, '--jobs', '1'], { cwd: ROOT, env, encoding: 'utf8', windowsHide: true, timeout: 5 * 60 * 1000 });
      sorties.push(r.status);
    }
    const bilans = assembleur.trouverBilans(path.join(tmp, 'pinlane-gates')).map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
    const jouees = bilans.flatMap((b) => b.scripts.flatMap((s) => s.unites.map((u) => u.commande))).length;
    const parts = bilans.map((b) => b.partie).sort();
    ok(bilans.length === 2 && JSON.stringify(parts) === JSON.stringify(['1/2', '2/2']), '[D] chaque part jouee rend son bilan, signe de sa part', parts.join(', ') || 'aucun bilan');
    ok(jouees === attendues.length, '[D] les deux parts jouent a elles deux chaque unite une fois', `${jouees} jouees pour ${attendues.length} attendues`);
    const a = assembleur.assembler(bilans, 2);
    // Le verdict, pas la couleur des trois gates joues : si l un d eux rougit
    // pour de vrai, la suite le dit une fois, sans rougir [D] en plus (vu le
    // 2026-10-30 : une ancre morte rougissait test:ancres ET ce gate).
    const rougesDe = (b) => b.scripts.filter((s) => s.etat === 'ROUGE').map((s) => s.nom);
    const codesJustes = ['1/2', '2/2'].every((p, i) => { const b = bilans.find((x) => x.partie === p); return Boolean(b) && sorties[i] === (rougesDe(b).length ? 1 : 0); });
    const rougesParts = new Set(bilans.flatMap(rougesDe));
    ok(codesJustes && a.rouges === rougesParts.size && !a.manquantes.length, '[D] chaque part sort sur son bilan, l assembleur rend les rouges des parts, ni plus ni moins', `codes ${sorties.join(', ')}, ${rougesParts.size} rouge(s) dans les parts, ${a.rouges} au bilan`);
  } finally {
    // Les places du lanceur portent une jonction vers node_modules : elles se
    // retirent par le lanceur lui-meme, jonction d abord, avant tout effacement.
    spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'gates-lancer.js'), '--nettoyer'], { cwd: ROOT, env, encoding: 'utf8', windowsHide: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function scenarios(mutation = null) {
  const lanceur = charger('scripts/gates-lancer.js', mutation);
  const assembleur = charger('scripts/gates-assembler.js', mutation);
  if (!mutation || mutation.partie !== 'C') {
    verifierRepartition(lanceur, 'plan synthetique', planSynthetique());
    verifierRepartition(lanceur, 'suite entiere', planReel());
  }
  if (!mutation || mutation.partie === 'C') verifierAssemblage(assembleur);
  if (!mutation) verifierLanceurReel(assembleur);
}

const MUTATIONS = [
  { nom: 'oubli', partie: 'A', lettre: '[A]', fichier: 'scripts/gates-lancer.js',
    de: 'for (const u of [...unites.filter((x) => x.seul).sort(ordre), ...unites.filter((x) => !x.seul).sort(ordre)]) {',
    vers: 'for (const u of [...unites.filter((x) => x.seul).sort(ordre), ...unites.filter((x) => !x.seul).sort(ordre)].slice(1)) {' },
  { nom: 'hasard', partie: 'A', lettre: 'la meme repartition', fichier: 'scripts/gates-lancer.js',
    de: 'const ordre = (a, b) => b.estimee - a.estimee || (cleUnite(a) < cleUnite(b) ? -1 : cleUnite(a) > cleUnite(b) ? 1 : 0);',
    vers: 'const ordre = () => Math.random() - 0.5;' },
  { nom: 'desequilibre', partie: 'B', lettre: '[B]', fichier: 'scripts/gates-lancer.js',
    de: '    for (const p of parts) if (fin(p, u) < fin(meilleure, u)) meilleure = p;',
    vers: '    for (const p of parts) if (false && fin(p, u) < fin(meilleure, u)) meilleure = p;' },
  { nom: 'pire', partie: 'C', lettre: 'le rouge d une part rougit le bilan', fichier: 'scripts/gates-assembler.js',
    de: "  if (etats.includes('ROUGE')) return 'ROUGE';",
    vers: "  if (etats[etats.length - 1] === 'ROUGE') return 'ROUGE';" },
  { nom: 'manquante', partie: 'C', lettre: 'une part sans bilan', fichier: 'scripts/gates-assembler.js',
    de: '  for (let k = 1; k <= attendues; k += 1) if (!vues.has(`${k}/${attendues}`)) manquantes.push(`${k}/${attendues}`);',
    vers: '' },
];

function main() {
  scenarios();
  let echecs = lignes.filter((l) => !l.cond).length;
  if (process.argv.includes('--contre-preuves')) {
    console.log('\n[K] contre-preuves : chaque regle cassee fait rougir sa lettre');
    for (const m of MUTATIONS) {
      lignes = [];
      silence = true;
      try { scenarios(m); } catch (error) { lignes.push({ cond: false, label: `crash ${error.message}` }); }
      silence = false;
      const rouges = lignes.filter((l) => !l.cond).map((l) => l.label);
      const mord = rouges.some((l) => l.includes(m.lettre));
      console.log(`${mord ? 'ok  ' : 'FAIL'}  [K] mutation ${m.nom} : « ${m.lettre} » rougit  (${rouges.slice(0, 2).join(' ; ') || 'rien de rouge'})`);
      if (!mord) echecs += 1;
    }
  }
  console.log(echecs ? `\ngates-parties-check: ${echecs} echec(s)` : '\ngates-parties-check: ALL OK');
  return echecs ? 1 : 0;
}

if (require.main === module) process.exit(main());

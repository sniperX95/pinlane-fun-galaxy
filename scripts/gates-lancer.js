// LE LANCEUR DES GATES (2026-10-19).
//
// Avant : test:ops:all etait une chaine de 324 `npm run ... &&` jouee un par
// un, 2 a 4 h, qui s arretait au premier rouge (les rouges suivants restaient
// caches) et disait VERT d un gate qui sortait 0 sans rien prouver. Ici :
//   - chaque script npm se decoupe en unites (`node scripts/x.js [--drapeau]`,
//     scripts/gates-commun.js) jouees en parallele dans un pool ;
//   - chaque place du pool a SA copie du depot (les fichiers que git voit,
//     node_modules en jonction), son dossier temporaire et sa plage de ports,
//     donnes aux gates par leurs variables PINLANE_*_PORT : un gate qui mute
//     un fichier sur le disque ou qui ecoute sur un port fixe ne touche pas
//     son voisin ;
//   - les gates sensibles au temps (scripts/gates-suite.json, `seuls`) se
//     jouent a la fin, un par un, la machine pour eux seuls ;
//   - TOUT se joue meme apres un rouge ; un gate qui imprime `GATE-SAUTE` et
//     sort 0 se dit SAUTE, jamais VERT ;
//   - le bilan (vert, rouge, saute, duree) s imprime et s ecrit, le code de
//     sortie est 1 s il y a un rouge.
//
// Usage :
//   node scripts/gates-lancer.js --tout                 la suite entiere (npm run test:tout)
//   node scripts/gates-lancer.js --impact [--base REF | --fichiers a,b]  les gates que le diff touche (npm run test:impact)
//   node scripts/gates-lancer.js test:x test:y          ces scripts npm
//   node scripts/gates-lancer.js "node scripts/x.js --mutate"   une commande hors npm
// Options : --jobs N (places du pool, defaut PINLANE_GATES_JOBS ou 3/4 des
//   coeurs), --deux-chances (CI : un rouge se rejoue une fois, seul ; vert au
//   second tour = INSTABLE, compte vert), --sur REF (la suite d un commit,
//   extraite a part, jouee par ce lanceur : le avant/apres d un changement),
//   --tracer (chaque gate note ce qu il lit, la preuve de la selection :
//   node scripts/gates-impactes.js --verifier-traces <dossier du passage>),
//   --liste (le plan, sans rien jouer), --nettoyer (retire les copies du pool),
//   --partie K/N (la part K de la suite coupee en N parts egales : le workflow
//   GitHub joue les N parts en meme temps sur N machines, chacune refait le
//   meme plan et ne joue que la sienne ; scripts/gates-assembler.js rassemble
//   leurs bilans), --parts-ci MAX (le nombre de parts que le plan merite, MAX
//   au plus, ecrit parts=N et matrice=[1..N] pour le workflow, sans rien jouer).
// Variables : PINLANE_GATES_PORT_DEPART (31000 ; deux lanceurs en meme temps
//   prennent deux plages), PINLANE_GATES_DELAI_S (40 min par unite).
// Les journaux : <tmp>/pinlane-gates/run-<horodatage>/ (bilan.txt, bilan.json,
// progres.log, un .log par unite).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync, execFileSync } = require('child_process');
const commun = require('./gates-commun');

const ROOT = commun.ROOT;
const ARGS = process.argv.slice(2);
const option = (nom) => { const i = ARGS.indexOf(nom); return i >= 0 ? ARGS[i + 1] : undefined; };
const drapeau = (nom) => ARGS.includes(nom);
const WINDOWS = process.platform === 'win32';
const BASE_TMP = path.join(os.tmpdir(), 'pinlane-gates');
// La source des copies : l arbre de travail, ou un commit (--sur REF) extrait
// a part (git archive) pour rejouer la suite d un commit avec ce lanceur.
let SOURCE = ROOT;
let DOSSIER_PLACES = path.join(BASE_TMP, `places-${crypto.createHash('sha1').update(ROOT.toLowerCase()).digest('hex').slice(0, 10)}`);
const DUREES_LOCALES = path.join(ROOT, 'tmp', 'gates-durees.json');
// La graine : les durees mesurees sur les machines GitHub, celles qui jouent
// les parts (passage 40984074983 du 2026-10-30) ; le poste les recouvre des
// siennes (tmp/) hors du workflow.
const DUREES_GRAINE = path.join(ROOT, 'scripts', 'gates-durees.json');
const DELAI_UNITE_MS = Number(process.env.PINLANE_GATES_DELAI_S || 40 * 60) * 1000;
const PORT_DEPART = Number(process.env.PINLANE_GATES_PORT_DEPART || 31000);
const PORTS_PAR_PLACE = 200;
const SECRET = /(^PG|DATABASE|POSTGRES|RESEND|SECRET|TOKEN|API_KEY|PASSWORD|PASSPHRASE)/i;
const GARDER = new Set(['PINLANE_TEST_DATABASE_URL']);

function duree(ms) {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s` : `${s} s`;
}

// --- La copie du depot d une place -----------------------------------------
function retirerPlaces() {
  if (!fs.existsSync(BASE_TMP)) return;
  const cible = path.join(ROOT, 'node_modules');
  for (const groupe of fs.readdirSync(BASE_TMP).filter((nom) => /^places-/.test(nom))) {
    const dossierPlaces = path.join(BASE_TMP, groupe);
    for (const nom of fs.readdirSync(dossierPlaces)) {
      const lien = path.join(dossierPlaces, nom, 'depot', 'node_modules');
      // La jonction se retire SEULE, avant tout effacement recursif : effacer
      // a travers elle viderait le node_modules du vrai depot.
      try { if (fs.lstatSync(lien).isSymbolicLink()) fs.rmdirSync(lien); } catch (error) { /* absente */ }
      if (fs.existsSync(lien)) throw new Error(`jonction ${lien} encore la : arret avant tout effacement`);
    }
    if (!fs.existsSync(cible)) throw new Error('node_modules du depot introuvable : arret avant tout effacement');
    fs.rmSync(dossierPlaces, { recursive: true, force: true });
  }
}

function preparerPlace(rang, fichiers) {
  const dossier = path.join(DOSSIER_PLACES, String(rang));
  const depot = path.join(dossier, 'depot');
  const tmp = path.join(dossier, 'tmp');
  fs.mkdirSync(depot, { recursive: true });
  fs.mkdirSync(tmp, { recursive: true });
  const lien = path.join(depot, 'node_modules');
  if (!fs.existsSync(lien)) fs.symlinkSync(path.join(ROOT, 'node_modules'), lien, 'junction');
  const manifesteFichier = path.join(dossier, 'manifeste.json');
  let manifeste = {};
  try { manifeste = JSON.parse(fs.readFileSync(manifesteFichier, 'utf8')); } catch (error) { manifeste = {}; }
  return { rang, dossier, depot, tmp, manifeste, manifesteFichier, fichiers, base: PORT_DEPART + rang * PORTS_PAR_PLACE };
}

// La copie redevient celle du depot : chaque fichier dont la source ou la
// copie a bouge (un gate qui a mute puis restaure, ou plante entre les deux)
// est recopie ; ce que les gates ont cree dans la copie s efface.
function synchroniser(place) {
  const attendus = new Set();
  let copies = 0;
  for (const f of place.fichiers) {
    attendus.add(f.rel);
    const dest = path.join(place.depot, f.rel);
    const e = place.manifeste[f.rel];
    let st = null;
    try { st = fs.statSync(dest); } catch (error) { st = null; }
    if (e && st && e.s === f.size && e.m === f.mtimeMs && st.size === e.ds && st.mtimeMs === e.dm) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(SOURCE, f.rel), dest);
    const apres = fs.statSync(dest);
    place.manifeste[f.rel] = { s: f.size, m: f.mtimeMs, ds: apres.size, dm: apres.mtimeMs };
    copies += 1;
  }
  const parcourir = (rel) => {
    let entrees = [];
    try { entrees = fs.readdirSync(path.join(place.depot, rel), { withFileTypes: true }); } catch (error) { return; }
    for (const entree of entrees) {
      const enfant = rel ? `${rel}/${entree.name}` : entree.name;
      if (!rel && entree.name === 'node_modules') continue;
      if (entree.isSymbolicLink()) continue;
      if (entree.isDirectory()) { parcourir(enfant); continue; }
      if (!attendus.has(enfant)) { try { fs.unlinkSync(path.join(place.depot, enfant)); } catch (error) { /* tenu */ } delete place.manifeste[enfant]; }
    }
  };
  parcourir('');
  // (un profil de navigateur encore tenu par un processus qui s eteint reste
  // la : l unite suivante en cree un autre. Le 2026-10-26, un EPERM ici a tue
  // la suite entiere a 4 unites sur 400.)
  for (const nom of fs.readdirSync(place.tmp)) {
    try { fs.rmSync(path.join(place.tmp, nom), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (error) { /* tenu */ }
  }
  fs.writeFileSync(place.manifesteFichier, JSON.stringify(place.manifeste));
  return copies;
}

// --- Le plan ----------------------------------------------------------------
// Une suite en parts lit la graine SEULE : les durees que ce poste a mesurees
// (tmp/) changeraient la repartition d une part a l autre, et une unite
// tomberait dans deux parts ou dans aucune (vu le 2026-10-30 : deux parts
// jouees a la suite sur la meme machine, la seconde relisait les durees de la
// premiere).
function lireDurees() {
  const d = {};
  const enParts = Boolean(option('--partie') || option('--parts-ci'));
  for (const f of enParts ? [DUREES_GRAINE] : [DUREES_GRAINE, DUREES_LOCALES]) {
    try { Object.assign(d, JSON.parse(fs.readFileSync(f, 'utf8'))); } catch (error) { /* absent */ }
  }
  return d;
}

function cleUnite(u) { return `${u.script}#${u.rang}`; }

function plan(noms, config) {
  const scripts = commun.scriptsNpm(SOURCE);
  const seuls = new Set(config.seuls || []);
  const durees = lireDurees();
  const toutes = [];
  for (const nom of noms) {
    for (const u of commun.unites(nom, scripts)) {
      u.navigateur = commun.piloteUnNavigateur(u.fichier, SOURCE);
      u.ports = commun.variablesDePort(u.fichier, SOURCE);
      u.seul = seuls.has(nom);
      u.estimee = durees[cleUnite(u)] || (u.navigateur ? 60 : 8);
      toutes.push(u);
    }
  }
  return toutes;
}

// --- Les parts (le workflow GitHub) ------------------------------------------
// Chaque machine refait le meme plan (les durees de scripts/gates-durees.json,
// un ordre stable, rien qui depende de la machine) et la meme repartition,
// puis ne joue que sa part : rien ne circule entre les machines. Les unites
// seules d abord, puis le pool, chacune de la plus longue a la plus courte,
// dans la part qui finirait le plus tot avec elle : le plus long de sa plus
// longue unite et de son pool reparti sur ses places, plus ses seules jouees
// a la suite.
function repartir(unites, n, places) {
  const parts = Array.from({ length: n }, () => ({ pool: 0, longue: 0, seuls: 0, unites: [] }));
  const fin = (p, u) => (u.seul
    ? Math.max(p.longue, p.pool / places) + p.seuls + u.estimee
    : Math.max(p.longue, u.estimee, (p.pool + u.estimee) / places) + p.seuls);
  // (l ordre des cles en points de code, pas localeCompare : la meme reponse
  // sur la machine du plan et sur chaque machine d une part)
  const ordre = (a, b) => b.estimee - a.estimee || (cleUnite(a) < cleUnite(b) ? -1 : cleUnite(a) > cleUnite(b) ? 1 : 0);
  for (const u of [...unites.filter((x) => x.seul).sort(ordre), ...unites.filter((x) => !x.seul).sort(ordre)]) {
    let meilleure = parts[0];
    for (const p of parts) if (fin(p, u) < fin(meilleure, u)) meilleure = p;
    meilleure.unites.push(u);
    if (u.seul) meilleure.seuls += u.estimee;
    else { meilleure.pool += u.estimee; meilleure.longue = Math.max(meilleure.longue, u.estimee); }
  }
  return parts.map((p) => ({ ...p, estimee: Math.max(p.longue, p.pool / places) + p.seuls }));
}

function partDuPlan(unites, texte, places) {
  const m = /^(\d+)\/(\d+)$/.exec(String(texte || ''));
  if (!m || Number(m[1]) < 1 || Number(m[1]) > Number(m[2])) throw new Error(`--partie K/N attendu, 1 <= K <= N, recu « ${texte} »`);
  return repartir(unites, Number(m[2]), places)[Number(m[1]) - 1].unites;
}

// Le nombre de parts : dix minutes de pool par part environ, MAX au plus. La
// plus longue unite borne de toute facon le mur d une part.
function partsPourLeWorkflow(unites, max, places) {
  const somme = unites.reduce((s, u) => s + u.estimee, 0);
  const n = unites.length ? Math.min(Math.max(1, max || 1), Math.max(1, Math.ceil(somme / (places * 600)))) : 0;
  const parts = n ? repartir(unites, n, places) : [];
  console.log(`parts=${n}`);
  console.log(`matrice=${JSON.stringify(Array.from({ length: n }, (_, i) => i + 1))}`);
  console.log(`unites=${unites.length}`);
  console.log(`estimee=${Math.round(Math.max(0, ...parts.map((p) => p.estimee)))}`);
  return 0;
}

// --- Jouer une unite --------------------------------------------------------
function environnement(place, u, gitDir, contexte = {}) {
  const env = {};
  for (const [cle, valeur] of Object.entries(process.env)) {
    if (SECRET.test(cle) && !GARDER.has(cle)) continue;
    env[cle] = valeur;
  }
  delete env.SECRETGPT_API_KEY;
  delete env.CLAUDE_CODE_MESSAGING_TOKEN;
  for (const cle of ['TEMP', 'TMP', 'TMPDIR']) env[cle] = place.tmp;
  if (gitDir) { env.GIT_DIR = gitDir; env.GIT_WORK_TREE = place.depot; }
  env.PINLANE_GATE_PLACE = String(place.rang);
  env.PINLANE_GATE_PORT_BASE = String(place.base);
  if (contexte.tracer) {
    // --tracer : chaque processus node du gate note ce qu il lit (scripts/gates-traceur.js).
    env.NODE_OPTIONS = `${env.NODE_OPTIONS ? `${env.NODE_OPTIONS} ` : ''}--require "${path.join(ROOT, 'scripts', 'gates-traceur.js').split(path.sep).join('/')}"`;
    env.PINLANE_GATE_TRACE_ROOT = place.depot;
    env.PINLANE_GATE_TRACE_FILE = path.join(contexte.dossierRun, 'traces', `${u.script.replace(/:/g, '~').replace(/[^\w.~-]+/g, '_')}__${u.rang}.txt`);
  }
  // Chaque variable de port de l unite recoit sa plage de 20 ports (le gate
  // peut donner PORT+1.. a ses fils).
  u.ports.forEach((nom, i) => { env[nom] = String(place.base + 10 + i * 20); });
  // Dans le pool, la machine est deja partagee : un gate qui s eclate en fils
  // (scripts/gates-eclats.js) en prend 2, pas 6, sinon 16 places x 6 fils
  // navigateurs epuisent la memoire et les gates de rendu rougissent de
  // lenteur (mesure du 2026-10-20 : 0,7 Go libres, des unites a 15 min).
  if (!u.seul && !process.env.PINLANE_ECLATS) env.PINLANE_ECLATS = '2';
  return env;
}

function tuerArbre(pid) {
  if (!pid) return;
  if (WINDOWS) spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true });
  else { try { process.kill(-pid, 'SIGKILL'); } catch (error) { try { process.kill(pid, 'SIGKILL'); } catch (e) { /* fini */ } } }
}

function jouerUnite(place, u, contexte) {
  return new Promise((resolve) => {
    synchroniser(place);
    const journal = path.join(contexte.dossierRun, 'logs', `${u.script.replace(/:/g, '~').replace(/[^\w.~-]+/g, '_')}__${u.rang}.log`);
    const sortie = fs.openSync(journal, 'w');
    const debut = Date.now();
    const enfant = spawn(process.execPath, [path.join(place.depot, u.fichier), ...u.args], {
      cwd: place.depot,
      env: environnement(place, u, contexte.gitDir, contexte),
      stdio: ['ignore', sortie, sortie],
      windowsHide: true,
      detached: !WINDOWS,
    });
    let delaiDepasse = false;
    let fini = false;
    const minuteur = setTimeout(() => { delaiDepasse = true; tuerArbre(enfant.pid); }, DELAI_UNITE_MS);
    const fin = (code, signal) => {
      if (fini) return;
      fini = true;
      clearTimeout(minuteur);
      fs.closeSync(sortie);
      const ms = Date.now() - debut;
      const texte = fs.readFileSync(journal, 'utf8');
      // GATE-SAUTE seul (suivi d un espace ou de la fin de ligne) : le gate
      // entier ; GATE-SAUTE-PARTIE : une partie, le gate reste vert.
      const saute = code === 0 && /^GATE-SAUTE(?:[ \t]+(.*))?\r?$/m.exec(texte);
      const partie = [...texte.matchAll(/^GATE-SAUTE-PARTIE\b\s*(.*)$/gm)].map((m) => m[1].trim());
      const etat = delaiDepasse ? 'ROUGE' : code === 0 ? (saute ? 'SAUTE' : 'VERT') : 'ROUGE';
      const fails = etat === 'ROUGE' ? texte.split(/\r?\n/).filter((l) => /^\s*(FAIL|KO\b|ECHEC|not ok|AssertionError|Error:)/.test(l)).slice(0, 8) : [];
      resolve({ cle: cleUnite(u), script: u.script, rang: u.rang, commande: u.commande, etat, code: delaiDepasse ? `delai ${duree(DELAI_UNITE_MS)}` : (code === null ? `signal ${signal}` : code), ms, journal, raison: saute ? saute[1].trim() : '', parties: partie, fails, fin: etat === 'ROUGE' ? texte.trim().split(/\r?\n/).slice(-4) : [] });
    };
    enfant.on('error', (error) => { fs.writeSync(sortie, String(error.stack || error)); fin(1, null); });
    enfant.on('exit', fin);
  });
}

// --- Le pool ----------------------------------------------------------------
async function pool(unitesAJouer, places, contexte, surFin) {
  const file = [...unitesAJouer].sort((a, b) => b.estimee - a.estimee);
  const libres = [...places];
  const resultats = [];
  await new Promise((resolve) => {
    let enCours = 0;
    const lancer = () => {
      while (libres.length && file.length) {
        const place = libres.shift();
        const u = file.shift();
        enCours += 1;
        jouerUnite(place, u, contexte).then((r) => {
          resultats.push(r);
          surFin(r);
          libres.push(place);
          enCours -= 1;
          if (!file.length && !enCours) resolve();
          else lancer();
        });
      }
      if (!file.length && !enCours) resolve();
    };
    lancer();
  });
  return resultats;
}

// Les processus restes derriere une copie du pool (un navigateur dont le gate
// a plante) : retrouves par leur ligne de commande, jamais par leur nom.
function balayerSurvivants() {
  if (!WINDOWS) return 0;
  const motif = DOSSIER_PLACES.replace(/'/g, "''");
  const r = spawnSync('powershell', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${motif}') -and $_.ProcessId -ne ${process.pid} -and $_.ProcessId -ne $PID } | ForEach-Object { $_.ProcessId }`], { encoding: 'utf8', windowsHide: true });
  const pids = String(r.stdout || '').split(/\s+/).map(Number).filter(Boolean);
  pids.forEach(tuerArbre);
  return pids.length;
}

// Un commit extrait une fois : <tmp>/pinlane-gates/source-<sha>/.
function extraireCommit(ref) {
  const sha = execFileSync('git', ['-C', ROOT, 'rev-parse', '--verify', `${ref}^{commit}`], { encoding: 'utf8', windowsHide: true }).trim();
  const dossier = path.join(BASE_TMP, `source-${sha.slice(0, 12)}`);
  const fait = path.join(BASE_TMP, `source-${sha.slice(0, 12)}.fait`);
  if (!fs.existsSync(fait)) {
    fs.rmSync(dossier, { recursive: true, force: true });
    fs.mkdirSync(dossier, { recursive: true });
    const archive = `${dossier}.tar`;
    fs.writeFileSync(archive, execFileSync('git', ['-C', ROOT, 'archive', '--format=tar', sha], { maxBuffer: 1024 * 1024 * 1024, windowsHide: true }));
    // Chemins relatifs : le tar de Git Bash lit « C: » comme un hote distant.
    const r = spawnSync('tar', ['-xf', path.basename(archive), '-C', path.basename(dossier)], { cwd: BASE_TMP, stdio: 'inherit', windowsHide: true });
    fs.rmSync(archive, { force: true });
    if (r.status !== 0) throw new Error(`extraction de ${ref} impossible`);
    fs.writeFileSync(fait, sha);
  }
  return { sha, dossier };
}

function fichiersDeLaSource() {
  if (SOURCE === ROOT) return commun.fichiersDuDepot();
  const liste = [];
  const parcourir = (rel) => {
    for (const e of fs.readdirSync(path.join(SOURCE, rel || '.'), { withFileTypes: true })) {
      const enfant = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (enfant !== 'node_modules') parcourir(enfant); } else if (e.isFile()) liste.push(enfant);
    }
  };
  parcourir('');
  return liste.sort();
}

// La suite d une source sans scripts/gates-suite.json (un commit d avant le
// lanceur) : la chaine de son test:ops:all, les gates sensibles d aujourd hui.
function configDeLaSource() {
  try { return commun.configSuite(SOURCE); } catch (error) {
    const chaine = String(commun.scriptsNpm(SOURCE)['test:ops:all'] || '');
    const suite = chaine.split('&&').map((x) => x.trim().replace(/^npm run /, '')).filter((x) => /^test:/.test(x));
    const actuelle = commun.configSuite(ROOT);
    return { suite, seuls: actuelle.seuls.filter((x) => suite.includes(x)), toujours: (actuelle.toujours || []).filter((x) => suite.includes(x)) };
  }
}

function choisirNoms(config) {
  const noms = ARGS.filter((a) => /^test:/.test(a) || /^node scripts\//.test(a));
  if (drapeau('--tout')) return [...config.suite];
  if (drapeau('--impact')) {
    const { gatesImpactes } = require('./gates-impactes');
    // --fichiers a,b : la selection d un diff donne (sans git), pour mesurer.
    const fichiers = option('--fichiers') ? option('--fichiers').split(',').map((x) => x.trim()).filter(Boolean) : undefined;
    const r = gatesImpactes({ base: option('--base'), fichiers });
    console.log(`[gates] impact : ${r.fichiers.length} fichier(s) modifie(s) depuis ${r.depart} -> ${r.gates.length} script(s)${r.sansProprietaire.length ? ` ; aucun gate ne charge ${r.sansProprietaire.join(', ')}` : ''}`);
    return r.gates;
  }
  if (noms.length) return noms;
  console.error('Usage : node scripts/gates-lancer.js --tout | --impact [--base REF] | test:x [test:y ...]');
  process.exit(2);
  return [];
}

async function main() {
  if (drapeau('--nettoyer')) { retirerPlaces(); console.log(`places retirees : ${DOSSIER_PLACES}`); return 0; }
  if (option('--sur')) {
    const { sha, dossier } = extraireCommit(option('--sur'));
    SOURCE = dossier;
    DOSSIER_PLACES = path.join(BASE_TMP, `places-${sha.slice(0, 10)}`);
    console.log(`[gates] suite du commit ${sha.slice(0, 10)} (${dossier})`);
  }
  const config = configDeLaSource();
  const tousLesNoms = choisirNoms(config);
  const toutes = plan(tousLesNoms, config);
  // Par defaut : 3/4 des coeurs, mais jamais plus de places que la memoire
  // libre n en porte (environ 700 Mo par gate navigateur et son serveur).
  const parMemoire = Math.floor(os.freemem() / (700 * 1024 * 1024));
  const jobs = Math.max(1, Number(option('--jobs') || process.env.PINLANE_GATES_JOBS || Math.max(2, Math.min(Math.floor(os.cpus().length * 0.75), parMemoire))));
  if (option('--parts-ci')) return partsPourLeWorkflow(toutes, Number(option('--parts-ci')), jobs);
  const unitesDuPlan = option('--partie') ? partDuPlan(toutes, option('--partie'), jobs) : toutes;
  // Une part ne rend que les scripts dont elle joue une unite au moins.
  const noms = tousLesNoms.filter((nom) => unitesDuPlan.some((u) => u.script === nom));
  const enPool = unitesDuPlan.filter((u) => !u.seul);
  const seuls = unitesDuPlan.filter((u) => u.seul);
  if (drapeau('--liste')) {
    console.log(`${noms.length} scripts, ${unitesDuPlan.length} unites (${enPool.length} en pool de ${jobs}, ${seuls.length} seules a la fin)`);
    [...enPool].sort((a, b) => b.estimee - a.estimee).concat(seuls).forEach((u) => console.log(`${u.seul ? 'SEUL ' : 'POOL '} ${String(Math.round(u.estimee)).padStart(5)} s  ${u.navigateur ? 'NAV' : 'PUR'}  ${cleUnite(u).padEnd(42)} ${u.ports.join(',')}`));
    // (lu par le workflow : ce que la machine doit installer pour cette liste)
    console.log(`outils=${[...new Set(unitesDuPlan.flatMap((u) => commun.outilsExternes(u.fichier, SOURCE)))].sort().join(',')}`);
    return 0;
  }
  const horodatage = new Date().toISOString().replace(/[:.]/g, '-');
  const dossierRun = path.join(BASE_TMP, `run-${horodatage}`);
  fs.mkdirSync(path.join(dossierRun, 'logs'), { recursive: true });
  let gitDir = '';
  try { gitDir = execFileSync('git', ['-C', ROOT, 'rev-parse', '--absolute-git-dir'], { encoding: 'utf8', windowsHide: true }).trim(); } catch (error) { gitDir = ''; }
  const fichiers = fichiersDeLaSource().map((rel) => { const st = fs.statSync(path.join(SOURCE, rel)); return { rel, size: st.size, mtimeMs: st.mtimeMs }; });
  const nbPlaces = Math.min(jobs, Math.max(1, enPool.length));
  const places = [];
  const debutCopie = Date.now();
  for (let rang = 0; rang < nbPlaces; rang += 1) places.push(preparerPlace(rang, fichiers));
  console.log(`[gates] ${noms.length} scripts, ${unitesDuPlan.length} unites : ${enPool.length} en pool de ${nbPlaces}, ${seuls.length} seules a la fin. Journaux : ${dossierRun}`);
  const contexte = { dossierRun, gitDir, tracer: drapeau('--tracer') };
  if (contexte.tracer) fs.mkdirSync(path.join(dossierRun, 'traces'), { recursive: true });
  const progres = path.join(dossierRun, 'progres.log');
  let faits = 0;
  const total = unitesDuPlan.length;
  const surFin = (r) => {
    faits += 1;
    const ligne = `${r.etat === 'SAUTE' ? 'SAUTE' : r.etat} ${faits}/${total} ${r.rang ? `${r.script}#${r.rang}` : r.script} code ${r.code} en ${Math.round(r.ms / 1000)} s`;
    fs.appendFileSync(progres, `${ligne}\n`);
    console.log(`[${String(faits).padStart(3)}/${total}] ${r.etat.padEnd(5)} ${(r.rang ? `${r.script}#${r.rang}` : r.script).padEnd(44)} ${duree(r.ms)}`);
  };
  const debut = Date.now();
  // La premiere synchronisation (la copie entiere) se fait avant le chrono des gates.
  places.forEach(synchroniser);
  const msCopie = Date.now() - debutCopie;
  let resultats = await pool(enPool, places, contexte, surFin);
  const msPool = Date.now() - debut;
  for (const u of seuls) {
    const [r] = await pool([u], [places[0]], contexte, surFin);
    resultats.push(r);
  }
  if (drapeau('--deux-chances')) {
    for (const r of resultats.filter((x) => x.etat === 'ROUGE')) {
      const u = unitesDuPlan.find((x) => cleUnite(x) === r.cle);
      const [second] = await pool([u], [places[0]], contexte, () => {});
      if (second.etat !== 'ROUGE') { r.etat = 'INSTABLE'; r.second = second; }
    }
  }
  const msMur = Date.now() - debut;
  const survivants = balayerSurvivants();
  // Les durees servent a ordonner le prochain passage (du plus long au plus court).
  try {
    const durees = (() => { try { return JSON.parse(fs.readFileSync(DUREES_LOCALES, 'utf8')); } catch (error) { return {}; } })();
    resultats.forEach((r) => { durees[r.cle] = Math.round(r.ms / 100) / 10; });
    fs.mkdirSync(path.dirname(DUREES_LOCALES), { recursive: true });
    fs.writeFileSync(DUREES_LOCALES, JSON.stringify(durees, null, 1));
  } catch (error) { /* ordre seulement */ }
  return bilan(noms, resultats, { msMur, msPool, msCopie, dossierRun, survivants, jobs: nbPlaces, partie: option('--partie') || null });
}

function bilan(noms, resultats, info) {
  const parScript = noms.map((nom) => {
    const siens = resultats.filter((r) => r.script === nom).sort((a, b) => a.rang - b.rang);
    const etats = siens.map((r) => r.etat);
    const etat = etats.includes('ROUGE') ? 'ROUGE' : etats.every((e) => e === 'SAUTE') ? 'SAUTE' : etats.includes('INSTABLE') ? 'INSTABLE' : 'VERT';
    return { nom, etat, ms: siens.reduce((s, r) => s + r.ms, 0), unites: siens };
  });
  const lignes = [];
  const compte = (e) => parScript.filter((s) => s.etat === e).length;
  for (const s of [...parScript].sort((a, b) => ['ROUGE', 'INSTABLE', 'SAUTE', 'VERT'].indexOf(a.etat) - ['ROUGE', 'INSTABLE', 'SAUTE', 'VERT'].indexOf(b.etat) || b.ms - a.ms)) {
    lignes.push(`${s.etat.padEnd(8)} ${s.nom.padEnd(40)} ${duree(s.ms).padStart(10)}`);
    for (const r of s.unites) {
      if (r.etat === 'SAUTE') lignes.push(`         ${r.commande} : SAUTE ${r.raison}`);
      if (r.parties.length) lignes.push(`         ${r.commande} : partie sautee : ${r.parties.join(' ; ')}`);
      if (r.etat === 'ROUGE' || r.etat === 'INSTABLE') {
        lignes.push(`         ${r.commande} : code ${r.code}${r.etat === 'INSTABLE' ? ' puis vert au second tour' : ''}  (${r.journal})`);
        r.fails.forEach((l) => lignes.push(`           ${l.slice(0, 220)}`));
        if (!r.fails.length) r.fin.forEach((l) => lignes.push(`           | ${l.slice(0, 220)}`));
      }
    }
  }
  const somme = resultats.reduce((s, r) => s + r.ms, 0);
  const resume = `BILAN${info.partie ? ` DE LA PART ${info.partie}` : ''} ${noms.length} scripts (${resultats.length} unites) : ${compte('VERT')} verts, ${compte('ROUGE')} rouges, ${compte('SAUTE')} sautes${compte('INSTABLE') ? `, ${compte('INSTABLE')} instables` : ''} ; mur ${duree(info.msMur)} (pool de ${info.jobs} : ${duree(info.msPool)}), somme des unites ${duree(somme)}, copie ${duree(info.msCopie)}${info.survivants ? ` ; ${info.survivants} processus survivants tues` : ''}`;
  lignes.push('', resume);
  const texte = lignes.join('\n');
  fs.writeFileSync(path.join(info.dossierRun, 'bilan.txt'), `${texte}\n`);
  // (les lignes FAIL du premier tour y restent : le journal d une unite
  // INSTABLE ne garde que son second tour)
  fs.writeFileSync(path.join(info.dossierRun, 'bilan.json'), JSON.stringify({ resume, msMur: info.msMur, partie: info.partie || null, scripts: parScript.map((s) => ({ nom: s.nom, etat: s.etat, ms: s.ms, unites: s.unites.map((r) => ({ commande: r.commande, etat: r.etat, code: r.code, ms: r.ms, raison: r.raison, parties: r.parties, journal: r.journal, fails: r.fails, fin: r.fin })) })) }, null, 1));
  console.log(`\n${texte}\nbilan : ${path.join(info.dossierRun, 'bilan.txt')}`);
  return compte('ROUGE') ? 1 : 0;
}

if (require.main === module) {
  main().then((code) => process.exit(code), (error) => { console.error(error); process.exit(1); });
}

module.exports = { retirerPlaces, repartir, partDuPlan };

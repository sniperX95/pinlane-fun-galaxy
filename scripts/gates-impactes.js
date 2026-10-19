// LA SELECTION PAR IMPACT (2026-10-19) : un diff -> les gates qu il touche.
//
// Chaque script npm de la suite (scripts/gates-suite.json) depend des fichiers
// que ses unites chargent, lu sans rien executer :
//   - la fermeture des require : relatifs, path.join(ROOT, 'lib', 'x.js'),
//     path.resolve(__dirname, '..', 'api/x.js'), ROOT + '/x', a travers lib/,
//     api/ et les scripts qu un gate lance ou charge (serveurs de dev) ;
//   - les chemins litteraux du produit ('assets/x.js', 'index.html'...) cites
//     par n importe quel fichier de cette fermeture ;
//   - les pages servies et leurs balises (src, href), puis les assets qu un
//     asset charge lui-meme par son nom (la console qui charge ses modules).
// Un fichier modifie que personne ne charge : s il est de ceux qui changent
// tout sans etre require (*.sql, package.json, vercel.json, middleware.ts,
// .github/), il donne tous les gates PURS ; sinon (docs, images), rien de
// plus. Toujours joues : scripts/gates-suite.json `toujours`.
// Grain : le FICHIER. assets/app-main.js (35 000 lignes) touche la moitie des
// gates ; un grain plus fin (fonction) demanderait de savoir quelles fonctions
// un parcours de navigateur execute, ce qu une lecture statique ne sait pas
// dire de facon fiable : il n est pas pris.
// Un require que la lecture ne resout pas (nom calcule) rend son gate
// dependant du dossier entier qu il vise (api/, lib/), jamais de rien.
// L index se garde dans tmp/gates-index.json, invalide par l empreinte
// (chemin, taille, date) de chaque fichier du depot.
//
// Usage : node scripts/gates-impactes.js [--base REF] [--fichiers a,b] [--json]
//   sans --base : contre le point de depart de la branche sur origin/main (ou HEAD).
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const commun = require('./gates-commun');

const ROOT = commun.ROOT;
const INDEX = path.join(ROOT, 'tmp', 'gates-index.json');
const VERSION_INDEX = 1;
const PRODUIT = /^(?:lib|api|assets|database|ops-knowledge|workers|tools|menu|demo|scripts)\/[\w./-]+\.\w{1,6}$|^[\w.-]+\.(?:html|js|ts|json|txt|xml)$/;
const SANS_PROPRIETAIRE = /\.sql$|^package(?:-lock)?\.json$|^vercel\.json$|^middleware\.ts$|^\.github\//;
const INFRA = /^scripts\/(?:gates-commun|gates-lancer|gates-impactes)\.js$|^scripts\/gates-(?:suite|durees)\.json$/;
const PAQUETS_NODE = /^(?:node:)?(?:fs|path|http|https|os|vm|assert|assert\/strict|crypto|zlib|stream|util|module|child_process|events|url|net|readline|buffer|timers|perf_hooks|worker_threads|querystring|string_decoder|tls|dns|v8|process|fs\/promises|timers\/promises|stream\/promises|test)$/;

function contexte() {
  const fichiers = commun.fichiersDuDepot();
  const ensemble = new Set(fichiers);
  const sources = new Map();
  const lire = (rel) => {
    if (!sources.has(rel)) { let t = ''; try { t = fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch (error) { t = ''; } sources.set(rel, t); }
    return sources.get(rel);
  };
  return { fichiers, ensemble, lire };
}

const norme = (rel) => path.posix.normalize(String(rel).replace(/\\/g, '/')).replace(/^(?:\.\/)+/, '');
function candidats(rel, ctx) {
  const base = norme(rel);
  return [base, `${base}.js`, `${base}.cjs`, `${base}.json`, `${base}/index.js`].find((c) => ctx.ensemble.has(c)) || null;
}

// Les arguments de chaque require(...) d une source (parentheses equilibrees).
function argumentsDeRequire(source) {
  const sortie = [];
  const rx = /\brequire\s*\(/g;
  let m;
  while ((m = rx.exec(source))) {
    let i = rx.lastIndex;
    let profondeur = 1;
    const debut = i;
    while (i < source.length && profondeur > 0) {
      if (source[i] === '(') profondeur += 1;
      else if (source[i] === ')') profondeur -= 1;
      i += 1;
    }
    sortie.push(source.slice(debut, i - 1).trim());
  }
  return sortie;
}

function dependancesDirectes(rel, ctx) {
  const brut = ctx.lire(rel);
  const source = /\.(?:c?js|ts|mjs)$/.test(rel) ? commun.sansCommentaires(brut) : /\.html$/.test(rel) ? brut.replace(/<!--[\s\S]*?-->/g, ' ') : brut;
  const deps = new Set();
  const dossiers = new Set();
  const dossier = path.posix.dirname(rel);
  if (/\.(?:c?js|ts|mjs)$/.test(rel)) {
    for (const arg of argumentsDeRequire(source)) {
      const simple = /^['"`]([^'"`$]+)['"`]$/.exec(arg);
      if (simple) {
        const nom = simple[1];
        if (nom.startsWith('.')) { const c = candidats(path.posix.join(dossier, nom), ctx); if (c) deps.add(c); }
        continue; // paquet ou module de node
      }
      const morceaux = [...arg.matchAll(/['"`]([^'"`$]*)['"`]/g)].map((x) => x[1]).filter((x) => x && !/^\.\.?$/.test(x));
      if (/ROOT|__dirname|root|RACINE|DEPOT/i.test(arg) && morceaux.length) {
        const c = candidats(path.posix.join(...morceaux.map((x) => x.replace(/^(?:\.\.\/)+/, ''))), ctx)
          || candidats(path.posix.join(dossier, ...morceaux), ctx);
        if (c) { deps.add(c); continue; }
        // Un nom calcule sous un dossier connu : tout le dossier.
        const tete = morceaux[0].replace(/^(?:\.\.\/)+/, '').split('/')[0];
        if (/^(?:lib|api|assets|ops-knowledge|workers|tools|database|scripts)$/.test(tete)) dossiers.add(tete);
        continue;
      }
      if (morceaux.length === 1 && (PAQUETS_NODE.test(morceaux[0]) || /^[a-z@]/.test(morceaux[0]))) continue;
    }
  }
  // Les chemins litteraux du produit et les noms de fichier de scripts/.
  for (const m of source.matchAll(/(?:['"`]|['"`}]\/|=\/|\.\/)((?:\.{1,2}\/)*(?:lib|api|assets|database|ops-knowledge|workers|tools|menu|demo|scripts)\/[\w./-]+?\.(?:c?js|css|html|json|sql|svg|png|webp|jpg|woff2|txt))\b/g)) {
    const c = candidats(m[1].replace(/^(?:\.{1,2}\/)+/, ''), ctx);
    if (c) deps.add(c);
  }
  for (const m of source.matchAll(/['"`/]([\w-]+\.(?:html|ts)|embed\.js|robots\.txt|sitemap\.xml)['"`?#]/g)) {
    if (ctx.ensemble.has(m[1])) deps.add(m[1]);
  }
  if (rel.startsWith('scripts/')) {
    for (const lie of commun.scriptsLies(rel)) if (lie !== rel) deps.add(lie);
  }
  // Une page : ses balises.
  if (/\.html$/.test(rel)) {
    for (const m of source.matchAll(/(?:src|href)\s*=\s*["']([^"'?#]+)/g)) {
      const c = candidats(m[1].replace(/^\.?\//, ''), ctx);
      if (c) deps.add(c);
    }
  }
  return { deps, dossiers };
}

function fermeture(depart, ctx, memo) {
  const vus = new Set();
  const pile = [...depart];
  const dossiers = new Set();
  while (pile.length) {
    const rel = pile.pop();
    if (vus.has(rel)) continue;
    vus.add(rel);
    if (!memo.has(rel)) memo.set(rel, dependancesDirectes(rel, ctx));
    const d = memo.get(rel);
    d.dossiers.forEach((x) => dossiers.add(x));
    for (const x of d.deps) if (!vus.has(x)) pile.push(x);
  }
  for (const dossier of dossiers) ctx.fichiers.filter((f) => f.startsWith(`${dossier}/`)).forEach((f) => vus.add(f));
  return vus;
}

function empreinte(ctx) {
  const h = crypto.createHash('sha1');
  h.update(`v${VERSION_INDEX}`);
  for (const rel of ctx.fichiers) {
    let st = null;
    try { st = fs.statSync(path.join(ROOT, rel)); } catch (error) { continue; }
    h.update(`${rel}\0${st.size}\0${st.mtimeMs}\n`);
  }
  return h.digest('hex');
}

function construireIndex(ctx) {
  const config = commun.configSuite();
  const scripts = commun.scriptsNpm();
  const noms = [...new Set([...config.suite, ...(config.toujours || [])])];
  const memo = new Map();
  const index = {};
  const purs = [];
  for (const nom of noms) {
    const unites = commun.unites(nom, scripts);
    const deps = fermeture(unites.map((u) => u.fichier), ctx, memo);
    index[nom] = [...deps].sort();
    if (unites.every((u) => !commun.piloteUnNavigateur(u.fichier))) purs.push(nom);
  }
  return { index, purs };
}

function lireIndex(ctx) {
  const e = empreinte(ctx);
  try {
    const cache = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
    if (cache.empreinte === e) return cache;
  } catch (error) { /* a construire */ }
  const { index, purs } = construireIndex(ctx);
  const cache = { empreinte: e, index, purs };
  try { fs.mkdirSync(path.dirname(INDEX), { recursive: true }); fs.writeFileSync(INDEX, JSON.stringify(cache)); } catch (error) { /* cache seulement */ }
  return cache;
}

function git(args) {
  return execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
}
function fichiersModifies(base) {
  let depart = base;
  if (!depart) {
    try { depart = git(['merge-base', 'HEAD', 'origin/main']).trim(); } catch (error) { depart = 'HEAD'; }
  }
  const lignes = [
    ...git(['diff', '--name-only', '-z', depart]).split('\0'),
    ...git(['ls-files', '-z', '-o', '--exclude-standard']).split('\0'),
  ];
  return { depart, fichiers: [...new Set(lignes.map((l) => l.trim()).filter(Boolean))].sort() };
}

function gatesImpactes({ base, fichiers } = {}) {
  const ctx = contexte();
  const { index, purs } = lireIndex(ctx);
  const config = commun.configSuite();
  const modifies = fichiers ? { depart: '(liste)', fichiers } : fichiersModifies(base);
  const raisons = {};
  const ajouter = (nom, pourquoi) => { (raisons[nom] = raisons[nom] || []).push(pourquoi); };
  const proprietaires = new Map();
  for (const [nom, deps] of Object.entries(index)) for (const f of deps) { if (!proprietaires.has(f)) proprietaires.set(f, []); proprietaires.get(f).push(nom); }
  const sansProprietaire = [];
  for (const f of modifies.fichiers) {
    const siens = (proprietaires.get(f) || []).filter((nom) => config.suite.includes(nom) || (config.toujours || []).includes(nom));
    siens.forEach((nom) => ajouter(nom, f));
    if (SANS_PROPRIETAIRE.test(f)) { purs.filter((nom) => config.suite.includes(nom)).forEach((nom) => ajouter(nom, `${f} (sans proprietaire : tous les gates purs)`)); }
    if (!siens.length && !INFRA.test(f)) sansProprietaire.push(f);
  }
  (config.toujours || []).forEach((nom) => ajouter(nom, 'toujours'));
  const ordre = [...config.suite, ...(config.toujours || [])];
  const gates = ordre.filter((nom, i) => raisons[nom] && ordre.indexOf(nom) === i);
  return { depart: modifies.depart, fichiers: modifies.fichiers, gates, raisons, sansProprietaire };
}

// La preuve : ce que chaque gate a VRAIMENT lu (un passage `gates-lancer.js
// --tracer`, dossier traces/) doit etre dans l index statique de son script.
// Rend les lectures que l index ne prevoyait pas (les trous de la selection).
function verifierTraces(dossierRun) {
  const ctx = contexte();
  const { index } = lireIndex(ctx);
  const dossier = path.join(dossierRun, 'traces');
  const trous = [];
  let lectures = 0;
  for (const nom of fs.readdirSync(dossier)) {
    const m = /^(.+)__(\d+)\.txt$/.exec(nom);
    if (!m) continue;
    const script = m[1].replace(/~/g, ':');
    const prevus = new Set(index[script] || []);
    for (const rel of fs.readFileSync(path.join(dossier, nom), 'utf8').split(/\r?\n/).filter(Boolean)) {
      lectures += 1;
      // Un fichier que le gate a cree lui-meme dans sa copie n est pas une dependance.
      if (!ctx.ensemble.has(rel)) continue;
      if (!prevus.has(rel)) trous.push({ script, unite: Number(m[2]), fichier: rel });
    }
  }
  return { lectures, trous };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const valeur = (nom) => { const i = args.indexOf(nom); return i >= 0 ? args[i + 1] : undefined; };
  if (valeur('--verifier-traces')) {
    const { lectures, trous } = verifierTraces(valeur('--verifier-traces'));
    const parFichier = {};
    trous.forEach((t) => { (parFichier[t.fichier] = parFichier[t.fichier] || new Set()).add(t.script); });
    Object.entries(parFichier).sort((a, b) => b[1].size - a[1].size).forEach(([f, s]) => console.log(`TROU  ${f} lu par ${s.size} script(s) sans etre prevu : ${[...s].slice(0, 6).join(' ')}`));
    console.log(`${lectures} lectures tracees, ${trous.length} hors index (${Object.keys(parFichier).length} fichiers).`);
    process.exit(trous.length ? 1 : 0);
  }
  const liste = valeur('--fichiers');
  const debut = Date.now();
  const r = gatesImpactes({ base: valeur('--base'), fichiers: liste ? liste.split(',').map((x) => x.trim()).filter(Boolean) : undefined });
  if (args.includes('--json')) console.log(JSON.stringify(r, null, 1));
  else {
    console.log(`depart ${r.depart} : ${r.fichiers.length} fichier(s) modifie(s) -> ${r.gates.length} script(s) de gate (${Date.now() - debut} ms)`);
    r.gates.forEach((nom) => console.log(`  ${nom.padEnd(40)} ${r.raisons[nom].slice(0, 3).join(', ')}${r.raisons[nom].length > 3 ? ` (+${r.raisons[nom].length - 3})` : ''}`));
    if (r.sansProprietaire.length) console.log(`aucun gate ne charge : ${r.sansProprietaire.join(', ')}`);
  }
}

module.exports = { gatesImpactes, lireIndex, contexte, verifierTraces };

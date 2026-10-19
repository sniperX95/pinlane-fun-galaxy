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
const VERSION_INDEX = 5;
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

// Les arguments de premier niveau d un appel dont `debut` suit la parenthese.
function argumentsDe(source, debut) {
  const args = [];
  let profondeur = 0;
  let courant = '';
  let i = debut;
  let chaine = '';
  for (; i < source.length; i += 1) {
    const c = source[i];
    if (chaine) { courant += c; if (c === '\\') { courant += source[i + 1] || ''; i += 1; } else if (c === chaine) chaine = ''; continue; }
    if (c === '\'' || c === '"' || c === '`') { chaine = c; courant += c; continue; }
    if (c === '(' || c === '[' || c === '{') profondeur += 1;
    if (c === ')' || c === ']' || c === '}') { if (profondeur === 0) break; profondeur -= 1; }
    if (c === ',' && profondeur === 0) { args.push(courant.trim()); courant = ''; continue; }
    courant += c;
  }
  if (courant.trim()) args.push(courant.trim());
  return { args, fin: i };
}

const RACINES = /^(?:ROOT|root|RACINE|racine|DEPOT|depot|REPO|repoRoot|ROOT_DIR|PROJECT_ROOT)$/;
// Un chemin calcule : path.join(ROOT, 'lib', 'x.js'), path.resolve(__dirname,
// '..', 'assets'), une constante qui en tient un, ROOT seul. Rend
// { chemin, dynamique } (dynamique : un morceau calcule a la fin), ou null.
function resoudreChemin(expr, rel, constantes) {
  const e = String(expr || '').trim();
  const lit = /^(['"`])([^'"`$]*)\1$/.exec(e);
  if (lit) return { chemin: lit[2], dynamique: false, litteral: true };
  if (RACINES.test(e) || e === 'process.cwd()') return { chemin: '', dynamique: false };
  if (e === '__dirname') return { chemin: path.posix.dirname(rel), dynamique: false };
  if (/^[A-Za-z_$][\w$]*$/.test(e) && constantes.has(e)) return constantes.get(e);
  const appel = /^[A-Za-z_$][\w$]*\s*\.\s*(?:join|resolve)\s*\(/.exec(e);
  if (!appel) return null;
  const { args } = argumentsDe(e, appel[0].length);
  if (!args.length) return null;
  const tete = resoudreChemin(args[0], rel, constantes);
  if (!tete || tete.litteral) return null; // path.join('a', 'b') sans racine : un chemin relatif quelconque
  let chemin = tete.chemin;
  for (const a of args.slice(1)) {
    const r = resoudreChemin(a, rel, constantes);
    if (!r || r.dynamique) return { chemin: path.posix.normalize(chemin || '.').replace(/^\.$/, ''), dynamique: true };
    chemin = path.posix.join(chemin || '.', r.chemin);
  }
  chemin = path.posix.normalize(chemin || '.').replace(/^\.\/?/, '');
  if (chemin.startsWith('..')) return null;
  return { chemin: chemin === '.' ? '' : chemin, dynamique: tete.dynamique };
}

const estDossier = (ctx, chemin) => chemin === '' || ctx.fichiers.some((f) => f.startsWith(`${chemin}/`));

// Les fichiers qu une source atteint par des chemins calcules, et les dossiers
// qu elle liste (readdir) ou dont elle lit un nom calcule : tout leur contenu.
function cheminsCalcules(brut, rel, ctx, deps, dossiers) {
  // require('path').join(...) se lit comme path.join(...).
  const source = brut.replace(/\brequire\s*\(\s*['"](?:node:)?path['"]\s*\)\s*\./g, 'path.');
  const constantes = new Map();
  for (const m of source.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*/g)) {
    const debut = m.index + m[0].length;
    const fin = (() => { let p = 0; for (let i = debut; i < source.length; i += 1) { const c = source[i]; if ('([{'.includes(c)) p += 1; else if (')]}'.includes(c)) { if (p === 0) return i; p -= 1; } else if ((c === ';' || c === '\n' || c === ',') && p === 0) return i; } return source.length; })();
    const r = resoudreChemin(source.slice(debut, fin), rel, constantes);
    if (r && !r.litteral) constantes.set(m[1], r);
  }
  const vus = [];
  for (const m of source.matchAll(/\b[A-Za-z_$][\w$]*\s*\.\s*(?:join|resolve)\s*\(/g)) {
    const { fin } = argumentsDe(source, m.index + m[0].length);
    const r = resoudreChemin(source.slice(m.index, fin + 1), rel, constantes);
    if (!r) continue;
    vus.push(r);
    if (!r.dynamique) { const c = candidats(r.chemin, ctx); if (c) deps.add(c); }
    // Un nom calcule sous un dossier du depot (pas la racine) : tout le dossier.
    else if (r.chemin && estDossier(ctx, r.chemin)) dossiers.add(r.chemin);
  }
  // Les dossiers listes.
  for (const m of source.matchAll(/\breaddir(?:Sync)?\s*\(|\bopendir(?:Sync)?\s*\(/g)) {
    const { args } = argumentsDe(source, m.index + m[0].length);
    const r = resoudreChemin(args[0], rel, constantes);
    if (r && estDossier(ctx, r.chemin)) { dossiers.add(r.chemin); continue; }
    // Une liste au chemin calcule, dans une fonction (walk(dir)) : les
    // dossiers que ses appels lui donnent ; a defaut, chaque dossier (hors la
    // racine) que la source nomme.
    const avant = source.slice(Math.max(0, m.index - 4000), m.index);
    const noms = [...avant.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(|\b([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^()]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/g)].map((x) => x[1] || x[2]);
    const nom = noms[noms.length - 1];
    let trouve = false;
    if (nom) {
      for (const appel of source.matchAll(new RegExp(`\\b${nom.replace(/\$/g, '\\$')}\\s*\\(`, 'g'))) {
        const a = argumentsDe(source, appel.index + appel[0].length).args[0];
        const ra = resoudreChemin(a, rel, constantes);
        if (ra && !ra.dynamique && estDossier(ctx, ra.chemin)) { dossiers.add(ra.chemin); trouve = true; }
      }
    }
    if (!trouve) {
      for (const x of vus) if (!x.dynamique && x.chemin && estDossier(ctx, x.chemin)) dossiers.add(x.chemin);
      for (const [, x] of constantes) if (!x.dynamique && x.chemin && estDossier(ctx, x.chemin)) dossiers.add(x.chemin);
    }
  }
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
    cheminsCalcules(source, rel, ctx, deps, dossiers);
  }
  // Les chemins litteraux du produit et les noms de fichier de scripts/.
  for (const m of source.matchAll(/(?:['"`]|['"`}]\/|=\/|\.\/)((?:\.{1,2}\/)*(?:lib|api|assets|database|ops-knowledge|workers|tools|menu|demo|scripts)\/[\w./-]+?\.(?:c?js|css|html|json|sql|svg|png|webp|jpg|woff2|txt))\b/g)) {
    const c = candidats(m[1].replace(/^(?:\.{1,2}\/)+/, ''), ctx);
    if (c) deps.add(c);
  }
  // Une page de la racine : 'index.html', '/fungalaxy.html', `${BASE}/pro.html`
  // (jamais la fin d une adresse d un autre site, .../guide/index.html).
  for (const m of source.matchAll(/(?:['"`]\/?|\}\/)([\w-]+\.(?:html|ts)|embed\.js|robots\.txt|sitemap\.xml)['"`?#]/g)) {
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
    for (const x of d.deps) if (!vus.has(x)) pile.push(x);
    // Un dossier liste : chacun de ses fichiers, et ce que chacun charge.
    for (const dossier of d.dossiers) {
      if (dossiers.has(dossier)) continue;
      dossiers.add(dossier);
      ctx.fichiers.filter((x) => dossier === '' || x.startsWith(`${dossier}/`)).forEach((x) => { if (!vus.has(x)) pile.push(x); });
    }
  }
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
  // Un fichier SUPPRIME (ou renomme) n est plus dans l index : ceux qui le
  // chargeaient encore casseraient sans etre choisis. Ses proprietaires sont
  // ceux des fichiers qui citent encore son nom (require, chemin, balise).
  const citeurs = (f) => {
    const nom = path.posix.basename(f);
    const tige = nom.replace(/\.\w+$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(`[\\\\/'"\`]${tige}(?:\\.\\w{1,6})?['"\`?#]`);
    return ctx.fichiers.filter((g) => /\.(?:c?js|ts|html|json)$/.test(g) && rx.test(ctx.lire(g)));
  };
  for (const f of modifies.fichiers) {
    const siens = (proprietaires.get(f) || []).filter((nom) => config.suite.includes(nom) || (config.toujours || []).includes(nom));
    siens.forEach((nom) => ajouter(nom, f));
    let cites = 0;
    if (!ctx.ensemble.has(f) && PRODUIT.test(f)) {
      for (const g of citeurs(f)) {
        const leurs = (proprietaires.get(g) || []).filter((nom) => config.suite.includes(nom));
        leurs.forEach((nom) => ajouter(nom, `${f} (supprime, encore cite par ${g})`));
        cites += leurs.length;
      }
    }
    if (SANS_PROPRIETAIRE.test(f)) { purs.filter((nom) => config.suite.includes(nom)).forEach((nom) => ajouter(nom, `${f} (sans proprietaire : tous les gates purs)`)); }
    if (!siens.length && !cites && !INFRA.test(f)) sansProprietaire.push(f);
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
  const toujours = new Set(commun.configSuite().toujours || []);
  const trous = [];
  let lectures = 0;
  for (const nom of fs.readdirSync(dossier)) {
    const m = /^(.+)__(\d+)\.txt$/.exec(nom);
    if (!m) continue;
    const script = m[1].replace(/~/g, ':');
    // Un gate joue a chaque diff (no-em-dash relit tout le depot) n a pas de trou.
    if (toujours.has(script)) continue;
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

// Pourquoi un script depend d un fichier : le chemin de dependances, du gate
// au fichier (--pourquoi test:x lib/y.js).
function pourquoi(nom, cible) {
  const ctx = contexte();
  const memo = new Map();
  const depart = commun.unites(nom).map((u) => u.fichier);
  const parent = new Map(depart.map((f) => [f, null]));
  const file = [...depart];
  while (file.length) {
    const rel = file.shift();
    if (rel === cible) break;
    if (!memo.has(rel)) memo.set(rel, dependancesDirectes(rel, ctx));
    const d = memo.get(rel);
    const suivants = [...d.deps, ...[...d.dossiers].flatMap((dossier) => ctx.fichiers.filter((x) => dossier === '' || x.startsWith(`${dossier}/`)))];
    for (const x of suivants) if (!parent.has(x)) { parent.set(x, `${rel}${d.dossiers.size && !d.deps.has(x) ? ' (dossier liste)' : ''}`); file.push(x); }
  }
  if (!parent.has(cible)) return null;
  const chemin = [cible];
  for (let x = parent.get(cible); x; x = parent.get(x.replace(/ \(dossier liste\)$/, ''))) chemin.unshift(x);
  return chemin;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const valeur = (nom) => { const i = args.indexOf(nom); return i >= 0 ? args[i + 1] : undefined; };
  if (valeur('--pourquoi')) {
    const i = args.indexOf('--pourquoi');
    const chemin = pourquoi(args[i + 1], args[i + 2]);
    console.log(chemin ? chemin.join('\n  -> ') : `${args[i + 1]} ne depend pas de ${args[i + 2]}`);
    process.exit(0);
  }
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

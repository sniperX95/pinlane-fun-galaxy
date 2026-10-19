// LE VERIFICATEUR D ANCRES (2026-10-19).
//
// Une contre-epreuve casse une regle en remplacant un morceau du code (son
// ancre) puis exige que son gate rougisse. Si le code change et que l ancre
// disparait, la mutation ne s applique plus : selon le gate, la contre-epreuve
// rougit a tort au prochain --mutate... ou ne mord plus jamais, en silence.
// Ce gate relit, sans rien jouer, chaque ancre de mutation de chaque script
// de scripts/ et exige qu elle existe encore dans le fichier qu elle vise.
//
// Une ancre, c est :
//   - dans un objet litteral qui porte aussi un remplacement, la valeur d une
//     cle de/from/find/ancre/anchor (le remplacement : vers/to/replace/...),
//     le fichier vise etant sa cle fichier/file/cible/target/path ;
//   - l argument d un appel f(<fichier du produit>, '<ancre>', '<remplacement>').
// Le fichier vise se resout depuis un litteral, une constante du script
// (`const JS = 'assets/x.js'`, path.join(ROOT, 'lib/x.js')) ; sans fichier
// nomme, l ancre doit exister dans l un des fichiers du produit que le script
// cite. Fins de ligne ramenees a LF des deux cotes (les gates lisent ainsi).
//
// Sortie 1 si une ancre est morte. --contre-preuves : chaque ancre d une
// liste temoin est retiree EN MEMOIRE de son fichier (le disque n est jamais
// ecrit) et le verificateur doit la dire morte.
//
// Lancement : node scripts/ancres-check.js [--contre-preuves] [--detail]
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const lf = (t) => String(t).split('\r\n').join('\n');
const CLES_ANCRE = new Set(['de', 'from', 'find', 'ancre', 'anchor']);
const CLES_REMPLACEMENT = new Set(['vers', 'to', 'replace', 'replacement', 'remplacement', 'par', 'apres', 'with', 'mutant', 'mute']);
const CLES_FICHIER = new Set(['fichier', 'file', 'cible', 'target', 'path', 'rel', 'chemin', 'source', 'src']);
const PRODUIT = /^(?:lib|api|assets|database|ops-knowledge|workers|tools|menu|demo)\/[\w./-]+\.\w{1,5}$|^(?:index|fungalaxy|fungalaxy-site|direction|pro)\.html$|^(?:embed\.js|middleware\.ts|vercel\.json|package\.json)$/;
const LONGUEUR_MIN = 10;

// --- Un lexeur JavaScript suffisant : chaines (avec leur valeur), gabarits,
// commentaires, expressions regulieres, ponctuation et identifiants.
function lexer(source) {
  const jetons = [];
  let i = 0;
  const n = source.length;
  const precedentSignifiant = () => jetons[jetons.length - 1];
  const regexPossible = () => {
    const p = precedentSignifiant();
    if (!p) return true;
    if (p.t === 'ponct') return !/^[)\]}]$/.test(p.v);
    if (p.t === 'id') return /^(return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await)$/.test(p.v);
    return false;
  };
  while (i < n) {
    const c = source[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { i += 1; continue; }
    if (c === '/' && source[i + 1] === '/') { while (i < n && source[i] !== '\n') i += 1; continue; }
    if (c === '/' && source[i + 1] === '*') { const f = source.indexOf('*/', i + 2); i = f < 0 ? n : f + 2; continue; }
    if (c === '\'' || c === '"') {
      const debut = i;
      i += 1;
      while (i < n && source[i] !== c && source[i] !== '\n') { if (source[i] === '\\') i += 1; i += 1; }
      i += 1;
      const brut = source.slice(debut, i);
      let v = null;
      if (!brut.includes('\\')) v = brut.slice(1, -1);
      else { try { v = Function(`"use strict"; return ${brut};`)(); } catch (error) { v = null; } }
      jetons.push({ t: 'str', v, debut, fin: i });
      continue;
    }
    if (c === '`') {
      const debut = i;
      i += 1;
      let interpole = false;
      let profondeur = 0;
      while (i < n) {
        if (source[i] === '\\') { i += 2; continue; }
        if (profondeur === 0 && source[i] === '`') break;
        if (source[i] === '$' && source[i + 1] === '{') { interpole = true; profondeur += 1; i += 2; continue; }
        if (profondeur > 0 && source[i] === '}') { profondeur -= 1; i += 1; continue; }
        if (profondeur > 0 && source[i] === '{') { profondeur += 1; i += 1; continue; }
        i += 1;
      }
      i += 1;
      const brut = source.slice(debut, i);
      let v = null;
      if (!interpole && !brut.includes('\\')) v = brut.slice(1, -1).split('\r\n').join('\n');
      else if (!interpole) { try { v = Function(`"use strict"; return ${brut};`)(); } catch (error) { v = null; } }
      jetons.push({ t: 'str', v, debut, fin: i, gabarit: true });
      continue;
    }
    if (c === '/' && regexPossible()) {
      const debut = i;
      i += 1;
      let classe = false;
      while (i < n && source[i] !== '\n') {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i] === '[') classe = true;
        else if (source[i] === ']') classe = false;
        else if (source[i] === '/' && !classe) break;
        i += 1;
      }
      i += 1;
      while (i < n && /[a-z]/i.test(source[i])) i += 1;
      jetons.push({ t: 'regex', v: source.slice(debut, i), debut, fin: i });
      continue;
    }
    const code = source.charCodeAt(i);
    const lettre = (x) => (x >= 65 && x <= 90) || (x >= 97 && x <= 122) || x === 95 || x === 36;
    const chiffre = (x) => x >= 48 && x <= 57;
    if (lettre(code)) {
      const debut = i;
      while (i < n && (lettre(source.charCodeAt(i)) || chiffre(source.charCodeAt(i)))) i += 1;
      jetons.push({ t: 'id', v: source.slice(debut, i), debut, fin: i });
      continue;
    }
    if (chiffre(code)) {
      const debut = i;
      while (i < n && (lettre(source.charCodeAt(i)) || chiffre(source.charCodeAt(i)) || source[i] === '.')) i += 1;
      jetons.push({ t: 'num', v: source.slice(debut, i), debut, fin: i });
      continue;
    }
    jetons.push({ t: 'ponct', v: c, debut: i, fin: i + 1 });
    i += 1;
  }
  return jetons;
}

// Une valeur de chaine : 'a' ou 'a' + 'b' + ... (que des litteraux).
function chaineA(jetons, k) {
  if (!jetons[k] || jetons[k].t !== 'str' || jetons[k].v == null) return null;
  let v = jetons[k].v;
  let j = k + 1;
  while (jetons[j] && jetons[j].v === '+' && jetons[j + 1] && jetons[j + 1].t === 'str') {
    if (jetons[j + 1].v == null) return null;
    v += jetons[j + 1].v;
    j += 2;
  }
  if (jetons[j] && jetons[j].v === '+') return null;
  return { v, fin: j };
}

// Le fichier qu une expression nomme : 'lib/x.js', CONST, path.join(ROOT, 'lib/x.js'),
// path.join(ROOT, 'lib', 'x.js'), path.resolve(__dirname, '..', 'lib/x.js').
const relatif = (texte) => String(texte).replace(/\\/g, '/').replace(/^(?:\.{1,2}\/)+/, '');
function fichierA(jetons, k, constantes) {
  const j = jetons[k];
  if (!j) return null;
  const s = chaineA(jetons, k);
  if (s && PRODUIT.test(relatif(s.v))) return relatif(s.v);
  if (j.t === 'id' && constantes.has(j.v) && !(jetons[k + 1] && jetons[k + 1].v === '.')) return constantes.get(j.v);
  // path.join(ROOT, 'lib/x.js'), p.join(ROOT, 'lib', 'x.js'), path.resolve(__dirname, '..', 'lib/x.js')
  if (j.t === 'id' && jetons[k + 1] && jetons[k + 1].v === '.' && jetons[k + 2] && /^(join|resolve)$/.test(jetons[k + 2].v) && jetons[k + 3] && jetons[k + 3].v === '(') {
    const morceaux = [];
    let m = k + 4;
    while (jetons[m] && jetons[m].v !== ')') {
      if (jetons[m].t === 'str' && jetons[m].v != null && !/^\.\.?$/.test(jetons[m].v)) morceaux.push(relatif(jetons[m].v));
      m += 1;
    }
    const rel = relatif(path.posix.join(...(morceaux.length ? morceaux : [''])));
    if (PRODUIT.test(rel)) return rel;
  }
  return null;
}

function constantesDuScript(jetons) {
  const c = new Map();
  for (let k = 0; k + 3 < jetons.length; k += 1) {
    if (jetons[k].t === 'id' && /^(const|let|var)$/.test(jetons[k].v) && jetons[k + 1].t === 'id' && jetons[k + 2].v === '=') {
      const f = fichierA(jetons, k + 3, c);
      if (f) c.set(jetons[k + 1].v, f);
    }
  }
  return c;
}

// Les ancres d un script : [{ ancre, fichier | null, ligne }].
function ancresDuScript(source) {
  const jetons = lexer(source);
  const constantes = constantesDuScript(jetons);
  const debutsDeLigne = [0];
  for (let p = source.indexOf('\n'); p >= 0; p = source.indexOf('\n', p + 1)) debutsDeLigne.push(p + 1);
  const ligneDe = (pos) => { let a = 0; let b = debutsDeLigne.length - 1; while (a < b) { const m = (a + b + 1) >> 1; if (debutsDeLigne[m] <= pos) a = m; else b = m - 1; } return a + 1; };
  const ancres = [];
  // Les objets : pile des accolades ouvertes, cles directes de chaque objet.
  const pile = [];
  const objets = [];
  for (let k = 0; k < jetons.length; k += 1) {
    const j = jetons[k];
    if (j.v === '{' && j.t === 'ponct') { pile.push({ cles: new Map(), debut: k }); continue; }
    if (j.v === '}' && j.t === 'ponct') { const o = pile.pop(); if (o) objets.push(o); continue; }
    const courant = pile[pile.length - 1];
    if (!courant) continue;
    if ((j.t === 'id' || (j.t === 'str' && j.v != null)) && jetons[k + 1] && jetons[k + 1].v === ':' && jetons[k - 1] && (jetons[k - 1].v === '{' || jetons[k - 1].v === ',')) {
      courant.cles.set(String(j.v), k + 2);
    }
  }
  for (const o of objets) {
    const cleAncre = [...o.cles.keys()].find((cle) => CLES_ANCRE.has(cle));
    if (!cleAncre || ![...o.cles.keys()].some((cle) => CLES_REMPLACEMENT.has(cle))) continue;
    const valeur = chaineA(jetons, o.cles.get(cleAncre));
    if (!valeur || valeur.v.length < LONGUEUR_MIN) continue;
    const cleFichier = [...o.cles.keys()].find((cle) => CLES_FICHIER.has(cle));
    const fichier = cleFichier ? fichierA(jetons, o.cles.get(cleFichier), constantes) : null;
    ancres.push({ ancre: valeur.v, fichier, ligne: ligneDe(jetons[o.cles.get(cleAncre)].debut), forme: 'objet' });
  }
  // Les appels f(fichier, 'ancre', 'remplacement').
  for (let k = 0; k + 1 < jetons.length; k += 1) {
    if (jetons[k].t !== 'id' || jetons[k + 1].v !== '(' || /^(if|for|while|switch|catch|function|require)$/.test(jetons[k].v)) continue;
    const fichier = fichierA(jetons, k + 2, constantes);
    if (!fichier) continue;
    // fin du premier argument
    let m = k + 2;
    let profondeur = 0;
    while (jetons[m] && !(profondeur === 0 && (jetons[m].v === ',' || jetons[m].v === ')'))) {
      if (/^[([{]$/.test(jetons[m].v)) profondeur += 1;
      if (/^[)\]}]$/.test(jetons[m].v)) profondeur -= 1;
      m += 1;
    }
    if (!jetons[m] || jetons[m].v !== ',') continue;
    const ancre = chaineA(jetons, m + 1);
    if (!ancre || ancre.v.length < LONGUEUR_MIN || !jetons[ancre.fin] || jetons[ancre.fin].v !== ',') continue;
    const remplacement = chaineA(jetons, ancre.fin + 1);
    if (!remplacement) continue;
    ancres.push({ ancre: ancre.v, fichier, ligne: ligneDe(jetons[m + 1].debut), forme: 'appel' });
  }
  // Les ancres tenues par une variable : `const marqueur = '...'` (ou un
  // tableau de lignes `[...].join(eol)`), lue par `.split(marqueur)`,
  // `.includes(marqueur)`, `.replace(marqueur, ...)` ou `.indexOf(marqueur)`.
  const lues = new Set();
  for (let k = 0; k + 3 < jetons.length; k += 1) {
    if (jetons[k].v === '.' && /^(split|includes|replace|indexOf)$/.test(jetons[k + 1].v) && jetons[k + 2].v === '(' && jetons[k + 3].t === 'id' && jetons[k + 4] && /^[,)]$/.test(jetons[k + 4].v)) lues.add(jetons[k + 3].v);
  }
  for (let k = 0; k + 3 < jetons.length; k += 1) {
    if (!(jetons[k].t === 'id' && /^(const|let|var)$/.test(jetons[k].v) && jetons[k + 1].t === 'id' && jetons[k + 2].v === '=' && lues.has(jetons[k + 1].v))) continue;
    let valeur = chaineA(jetons, k + 3);
    if (!valeur && jetons[k + 3].v === '[') {
      const lignes = [];
      let m = k + 4;
      while (jetons[m] && jetons[m].t === 'str' && jetons[m].v != null) { lignes.push(jetons[m].v); m += 1; if (jetons[m] && jetons[m].v === ',') m += 1; }
      if (lignes.length && jetons[m] && jetons[m].v === ']' && jetons[m + 1] && jetons[m + 1].v === '.' && jetons[m + 2] && jetons[m + 2].v === 'join') valeur = { v: lignes.join('\n') };
    }
    if (!valeur || valeur.v.length < LONGUEUR_MIN) continue;
    ancres.push({ ancre: valeur.v, fichier: null, ligne: ligneDe(jetons[k + 1].debut), forme: 'variable' });
  }
  const cites = new Set();
  for (const j of jetons) if (j.t === 'str' && j.v != null && PRODUIT.test(relatif(j.v))) cites.add(relatif(j.v));
  constantes.forEach((f) => cites.add(f));
  // Sans fichier nomme, seule une ancre qui ressemble a du code compte (une
  // plage { from: '2026-07-03', to: ... } ou un courriel ne sont pas des mutations).
  return { ancres: ancres.filter((a) => a.fichier || /[(){};=<>]/.test(a.ancre)), cites: [...cites] };
}

// Les mutations desarmees expres, ecrites dans leur gate avec leur raison :
// leur ancre a disparu et le gate le sait.
const DESARMEES = [
  // (le nom sans son suffixe : un nom de script litteral se lirait comme un
  // script que ce gate lance, scripts/gates-commun.js)
  { script: 'complements-truth', ancre: '    if (Number.isFinite(maximum) && maximum > 0 && context.pax > maximum) continue;', raison: 'branche `false ?` : plus aucune activite ne declare de maximum (journal 321)' },
];

let PRODUITS = null;
function fichiersDuProduit() {
  if (!PRODUITS) {
    PRODUITS = [];
    const parcourir = (rel) => {
      for (const e of fs.readdirSync(path.join(ROOT, rel || '.'), { withFileTypes: true })) {
        const enfant = rel ? `${rel}/${e.name}` : e.name;
        // Le produit, plus scripts/ : une ancre peut viser le harnais d un
        // autre gate (staff-activity-participants-browser mute son montage).
        if (e.isDirectory()) { if (!rel ? /^(lib|api|assets|database|ops-knowledge|workers|tools|menu|demo|scripts)$/.test(e.name) : e.name !== 'node_modules') parcourir(enfant); }
        else if (PRODUIT.test(enfant) || /^scripts\/[\w.-]+\.c?js$/.test(enfant)) PRODUITS.push(enfant);
      }
    };
    parcourir('');
  }
  return PRODUITS;
}

function contenuDe(rel, memo, remplacements) {
  if (remplacements && remplacements.has(rel)) return remplacements.get(rel);
  if (!memo.has(rel)) { let t = null; try { t = lf(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch (error) { t = null; } memo.set(rel, t); }
  return memo.get(rel);
}

function verifier(scripts, remplacements) {
  const memo = new Map();
  const mortes = [];
  let total = 0;
  let desarmees = 0;
  const contient = (rel, ancre) => { const t = contenuDe(rel, memo, remplacements); return t != null && t.includes(lf(ancre)); };
  for (const f of scripts) {
    const { ancres, cites } = ancresDuScript(lf(fs.readFileSync(path.join(ROOT, 'scripts', f), 'utf8')));
    for (const a of ancres) {
      total += 1;
      if (DESARMEES.some((d) => `${d.script}-check.js` === f && d.ancre === a.ancre)) { desarmees += 1; continue; }
      // Un fichier nomme : l ancre doit y etre. Sinon : dans un fichier que le
      // script cite, ou a defaut n importe ou dans le produit.
      const trouve = a.fichier ? contient(a.fichier, a.ancre) : (cites.some((rel) => contient(rel, a.ancre)) || fichiersDuProduit().some((rel) => contient(rel, a.ancre)));
      if (!trouve) mortes.push({ script: f, ...a, cibles: a.fichier ? [a.fichier] : cites });
    }
  }
  return { total, mortes, desarmees };
}

const listeScripts = () => fs.readdirSync(path.join(ROOT, 'scripts')).filter((f) => /\.c?js$/.test(f) && f !== 'ancres-check.js').sort();

function principal() {
  const scripts = listeScripts();
  const { total, mortes } = verifier(scripts);
  if (process.argv.includes('--detail')) {
    for (const f of scripts) {
      const { ancres } = ancresDuScript(lf(fs.readFileSync(path.join(ROOT, 'scripts', f), 'utf8')));
      if (ancres.length) console.log(`${f} : ${ancres.length} ancre(s)`);
    }
  }
  for (const m of mortes) {
    console.log(`FAIL  ancre morte : scripts/${m.script}:${m.ligne} (${m.forme}) vise ${m.fichier || `l un de ${m.cibles.length} fichiers cites`}`);
    console.log(`      ${JSON.stringify(m.ancre).slice(0, 200)}`);
  }
  console.log(`\n${total} ancres de mutation dans ${scripts.length} scripts, ${mortes.length} morte(s).`);
  return mortes.length;
}

// La contre-epreuve : une ancre de chaque forme, retiree de son fichier en
// memoire, doit etre dite morte ; le fichier d origine la garde vivante.
function contrePreuves() {
  let echecs = 0;
  const ok = (c, l) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${l}`); if (!c) echecs += 1; };
  const scripts = listeScripts();
  const temoins = [];
  const memoTemoins = new Map();
  const vivante = (x) => { const t = contenuDe(x.fichier, memoTemoins); return t != null && t.includes(lf(x.ancre)); };
  for (const f of scripts) {
    const { ancres } = ancresDuScript(lf(fs.readFileSync(path.join(ROOT, 'scripts', f), 'utf8')));
    for (const forme of ['objet', 'appel']) {
      const a = ancres.find((x) => x.forme === forme && x.fichier && vivante(x) && !temoins.some((t) => t.forme === forme && t.fichier === x.fichier));
      if (a && temoins.filter((t) => t.forme === forme).length < 4) temoins.push({ script: f, ...a });
    }
  }
  ok(temoins.some((t) => t.forme === 'objet') && temoins.some((t) => t.forme === 'appel'), `MONTAGE des ancres temoins des deux formes (${temoins.length})`);
  for (const t of temoins) {
    const memo = new Map();
    const original = contenuDe(t.fichier, memo);
    ok(original != null && original.includes(lf(t.ancre)), `${t.script}:${t.ligne} : l ancre vit dans ${t.fichier}`);
    const remplacements = new Map([[t.fichier, original.split(lf(t.ancre)).join('')]]);
    const { mortes } = verifier([t.script], remplacements);
    ok(mortes.some((m) => m.ligne === t.ligne && m.ancre === t.ancre), `${t.script}:${t.ligne} : retiree de ${t.fichier} (en memoire), elle est dite morte`);
  }
  return echecs;
}

if (require.main === module) {
  const echecs = process.argv.includes('--contre-preuves') ? contrePreuves() : principal();
  console.log(echecs ? `ancres-check: ${echecs} echec(s)` : 'ancres-check: ALL OK');
  process.exit(echecs ? 1 : 0);
}

module.exports = { lexer, ancresDuScript, verifier };

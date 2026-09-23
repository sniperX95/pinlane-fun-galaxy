'use strict';
/*
 * CE QUI EST SERVI SANS MOT DE PASSE NE DOIT RIEN DIRE DE NOUS.
 *
 * Le middleware ouvre a tout le monde `/assets/`, `/demo/`, `/menu/`, la page du
 * parcours et les pages publiques : il suffit de taper l adresse d un fichier
 * pour le lire en entier. Nos commentaires de code y racontaient l historique
 * interne du projet, avec des noms, des dates et des phrases citees. Le client,
 * son agence, ou n importe qui d autre pouvait les lire.
 *
 * `tools/build-public.js` retire les commentaires de ces fichiers au moment de
 * la construction. Ce gate mesure le RESULTAT de cette preparation, sur une
 * COPIE : le depot n est jamais touche.
 *
 * Il verifie deux choses, et la seconde compte autant que la premiere :
 *   - le resultat ne porte plus aucune trace interne ;
 *   - le resultat est le MEME PROGRAMME que la source. Un nettoyage qui casse
 *     le code serait pire que le probleme qu il resout. L egalite se prouve en
 *     reduisant les deux versions a leur forme minifiee : si les deux formes
 *     sont identiques, seuls des commentaires et des espaces ont bouge.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CONSTRUCTEUR = path.join(ROOT, 'tools', 'build-public.js');
const DOSSIERS = ['assets', 'demo', 'menu'];
const PAGES = ['index.html', 'pro.html', 'public-form.html', 'fungalaxy.html'];
const EXCLUS = new Set(['embed.js']);

// Ce qui ne doit JAMAIS sortir. La liste est courte et sans ambiguite : un mot
// trop general (« journal », une date) existe aussi dans du texte affiche a
// l ecran et rendrait ce gate menteur.
const TRACES = [
  { nom: 'le prenom du proprietaire', motif: /movsar/i },
  { nom: 'un outil d assistance', motif: /\bclaude\b|anthropic|chatgpt|copilot/i },
  { nom: 'le nom du depot', motif: /sniperx95/i },
  { nom: 'une signature de commit', motif: /co-authored-by/i },
];

let failures = 0;
function ok(condition, message, detail) {
  if (condition) {
    console.log('ok    ' + message + (detail ? '  ' + detail : ''));
    return true;
  }
  failures += 1;
  console.log('FAIL  ' + message + (detail ? '  ' + detail : ''));
  return false;
}

function esbuild() {
  try { return require('esbuild'); } catch (error) { return null; }
}

function listerFichiers(dossier, sortie) {
  let entrees;
  try { entrees = fs.readdirSync(dossier, { withFileTypes: true }); } catch (error) { return sortie; }
  for (const e of entrees) {
    const complet = path.join(dossier, e.name);
    if (e.isDirectory()) listerFichiers(complet, sortie);
    else sortie.push(complet);
  }
  return sortie;
}

function surfacePublique(racine) {
  const cibles = [];
  for (const d of DOSSIERS) {
    for (const f of listerFichiers(path.join(racine, d), [])) {
      if (/\.(js|css|html)$/i.test(f)) cibles.push(f);
    }
  }
  for (const p of PAGES) {
    const f = path.join(racine, p);
    if (fs.existsSync(f)) cibles.push(f);
  }
  return cibles.filter((f) => !EXCLUS.has(path.relative(racine, f).split(path.sep).join('/')));
}

// Un commentaire HTML ecrit DANS un gabarit JavaScript n est pas un commentaire :
// c est une chaine, elle finit dans le DOM et aucun outil ne la retire. Le motif
// d une expression reguliere commence par les memes caracteres, mais il est
// precede d une barre oblique et c est du CODE.
function commentairesHtmlEchappes(texte) {
  let n = 0;
  let i = 0;
  while (true) {
    const d = texte.indexOf('<!--', i);
    if (d === -1) return n;
    const precedent = d > 0 ? texte[d - 1] : '';
    if (precedent !== '/' && !/^<!--\s*\[if/i.test(texte.slice(d, d + 12))) n += 1;
    i = d + 4;
  }
}

function tracesTrouvees(texte) {
  return TRACES.filter((t) => t.motif.test(texte)).map((t) => t.nom);
}

function copierSurface(destination) {
  fs.mkdirSync(destination, { recursive: true });
  let copies = 0;
  for (const f of surfacePublique(ROOT).concat([path.join(ROOT, 'embed.js')])) {
    if (!fs.existsSync(f)) continue;
    const rel = path.relative(ROOT, f);
    const cible = path.join(destination, rel);
    fs.mkdirSync(path.dirname(cible), { recursive: true });
    fs.copyFileSync(f, cible);
    copies += 1;
  }
  return copies;
}

function construire(racine) {
  return execFileSync(process.execPath, [CONSTRUCTEUR], {
    env: Object.assign({}, process.env, { BUILD_PUBLIC_ROOT: racine }),
    encoding: 'utf8',
  });
}

// La forme canonique d un fichier : son programme, sans commentaires ni
// espaces. Le renommage des identifiants est volontairement DESACTIVE : pour
// choisir ses noms courts, le minificateur classe les caracteres par frequence
// dans le TEXTE d entree. Retirer les commentaires change cette frequence, donc
// les lettres choisies, sans changer le programme d une virgule. Les comparer
// ferait rougir ce gate sur une difference qui n existe pas.
// UNE FORME CANONIQUE EST UN POINT FIXE. `minifySyntax` n est pas idempotent
// en une passe : la seconde inline une constante utilisee une seule fois
// (mesure du 2026-09-23 sur assets/app-main.js, 915 782 puis 915 610 octets,
// stable ensuite). Depuis que `tools/build-public.js` applique lui aussi
// `minifySyntax`, la copie preparee arrivait ici DEJA reduite une fois : la
// comparer a une source reduite une seule fois faisait rougir quatre fichiers
// sur une difference qui n existe pas. On reduit donc des deux cotes jusqu a
// ce que le texte ne bouge plus.
function formeCanonique(eb, texte, loader) {
  let courant = texte;
  for (let passe = 0; passe < 4; passe += 1) {
    const suivant = eb.transformSync(courant, {
      loader,
      target: 'esnext',
      legalComments: 'none',
      minifyWhitespace: true,
      minifySyntax: true,
      minifyIdentifiers: false,
    }).code;
    if (suivant === courant) return courant;
    courant = suivant;
  }
  return courant;
}

function main() {
  const eb = esbuild();
  if (!ok(Boolean(eb), 'MONTAGE : esbuild est disponible')) return;
  if (!ok(fs.existsSync(CONSTRUCTEUR), 'MONTAGE : tools/build-public.js existe')) return;

  const sources = surfacePublique(ROOT);
  ok(sources.length >= 30, 'MONTAGE : la surface publique est bien peuplee', sources.length + ' fichier(s)');

  // Si la source ne contenait AUCUNE trace, ce gate serait vert sans rien
  // prouver. On exige donc qu il y ait quelque chose a retirer.
  let sourcesAvecTrace = 0;
  for (const f of sources) {
    if (tracesTrouvees(fs.readFileSync(f, 'utf8')).length) sourcesAvecTrace += 1;
  }
  ok(sourcesAvecTrace > 0,
    'MONTAGE : la source contient bien des traces internes a retirer', sourcesAvecTrace + ' fichier(s)');

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pinlane-public-'));
  try {
    const copies = copierSurface(temp);
    ok(copies === sources.length + 1, 'MONTAGE : la copie est complete', copies + ' fichier(s) copie(s)');

    const sortie = construire(temp);
    ok(/fichier\(s\) nettoye\(s\)/.test(sortie), 'MONTAGE : la preparation a tourne sur la copie', sortie.trim().split('\n')[0]);

    console.log('');
    console.log('[A] AUCUNE TRACE INTERNE DANS CE QUI EST SERVI');
    const coupables = [];
    for (const f of sources) {
      const rel = path.relative(ROOT, f).split(path.sep).join('/');
      const bati = fs.readFileSync(path.join(temp, rel), 'utf8');
      const trouve = tracesTrouvees(bati);
      if (trouve.length) coupables.push(rel + ' (' + trouve.join(', ') + ')');
    }
    ok(coupables.length === 0, 'aucun fichier public ne porte de trace interne',
      coupables.length ? coupables.slice(0, 5).join(' | ') : sources.length + ' fichier(s) verifie(s)');

    console.log('');
    console.log('[B] AUCUNE NOTE INTERNE RENDUE DANS LE DOM');
    // Ceux-la, la preparation ne peut pas les retirer : ce sont des chaines.
    const dansLeDom = [];
    for (const f of sources) {
      const rel = path.relative(ROOT, f).split(path.sep).join('/');
      const bati = fs.readFileSync(path.join(temp, rel), 'utf8');
      const n = commentairesHtmlEchappes(bati);
      if (n) dansLeDom.push(rel + ' x' + n);
    }
    ok(dansLeDom.length === 0, 'aucun commentaire HTML ne survit dans un gabarit',
      dansLeDom.length ? dansLeDom.join(' | ') : '0');

    console.log('');
    console.log('[C] LE RESULTAT EST LE MEME PROGRAMME QUE LA SOURCE');
    const divergents = [];
    let compares = 0;
    for (const f of sources) {
      if (/\.html$/i.test(f)) continue;
      const rel = path.relative(ROOT, f).split(path.sep).join('/');
      const loader = /\.css$/i.test(f) ? 'css' : 'js';
      let a;
      let b;
      try {
        a = formeCanonique(eb, fs.readFileSync(f, 'utf8'), loader);
        b = formeCanonique(eb, fs.readFileSync(path.join(temp, rel), 'utf8'), loader);
      } catch (error) {
        divergents.push(rel + ' (illisible : ' + String(error.message).split('\n')[0] + ')');
        continue;
      }
      compares += 1;
      if (a !== b) divergents.push(rel);
    }
    ok(divergents.length === 0, 'chaque fichier prepare se reduit a la meme forme que sa source',
      divergents.length ? divergents.slice(0, 5).join(' | ') : compares + ' fichier(s) compare(s)');

    console.log('');
    console.log('[D] LE GATE SAIT-IL ROUGIR ?');
    contreEpreuves(eb);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function contreEpreuves(eb) {
  // (1) Une trace ajoutee dans un commentaire de la copie doit disparaitre a la
  //     preparation : c est ce qui prouve que [A] mesure la preparation et non
  //     un hasard. On mute donc dans l autre sens : une trace posee dans une
  //     CHAINE, que la preparation ne peut pas retirer, doit etre vue.
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pinlane-mut-'));
  try {
    copierSurface(temp);
    const cible = path.join(temp, 'assets', 'boot-view.js');
    if (!ok(fs.existsSync(cible), 'MONTAGE : le fichier de la contre-epreuve est bien dans la copie')) return;
    const avant = fs.readFileSync(cible, 'utf8');

    fs.writeFileSync(cible, avant + '\nvar noteInterne = "demande de Movsar, 2026-09-08";\n');
    construire(temp);
    const mute = fs.readFileSync(cible, 'utf8');
    ok(tracesTrouvees(mute).length > 0,
      'trace posee dans une chaine : elle SURVIT a la preparation, donc [A] la verrait',
      tracesTrouvees(mute).join(', ') || 'aucune');

    // (2) Un commentaire, lui, doit bien disparaitre : sinon la preparation ne
    //     sert a rien et [A] serait vert par accident.
    fs.writeFileSync(cible, avant + '\n// demande de Movsar, 2026-09-08\n');
    construire(temp);
    const commente = fs.readFileSync(cible, 'utf8');
    ok(tracesTrouvees(commente).length === 0,
      'trace posee en commentaire : la preparation la retire bien',
      tracesTrouvees(commente).join(', ') || 'aucune');

    // (3) Un CODE modifie doit faire diverger la forme canonique, sinon [C] ne
    //     prouverait rien.
    fs.writeFileSync(cible, avant.replace('function', 'function ') + '\nvar ajoutReel = 1;\n');
    construire(temp);
    const a = formeCanonique(eb, avant, 'js');
    const b = formeCanonique(eb, fs.readFileSync(cible, 'utf8'), 'js');
    ok(a !== b, 'code modifie : la forme canonique diverge, donc [C] le verrait');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main();
console.log('');
console.log(failures ? failures + ' controle(s) en echec.' : 'Tous les controles passent.');
process.exit(failures ? 1 : 0);

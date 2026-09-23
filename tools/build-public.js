'use strict';
/*
 * PREPARATION DES FICHIERS PUBLICS AVANT MISE EN LIGNE.
 *
 * Le middleware ouvre a tout le monde, sans identifiants, un ensemble precis de
 * chemins : `/assets/`, `/demo/`, `/menu/`, la page du parcours et les deux
 * pages publiques. N importe qui peut donc lire ces fichiers en tapant leur
 * adresse. Nos commentaires de code y racontent l historique interne du projet :
 * qui a demande quoi, quand, et avec quels mots. Ce n est pas une information
 * a publier.
 *
 * Ce script retire les commentaires de ces fichiers au moment de la
 * construction, sur la copie que Vercel deploie. Le depot garde les siens
 * intacts : c est la seule facon de garder un code qui s explique sans le
 * publier.
 *
 * Trois regles de surete :
 *   1. un fichier qui ne se transforme pas est laisse TEL QUEL, jamais casse ;
 *   2. `embed.js` est exclu : c est le fichier que le client colle sur son site,
 *      il est ecrit pour etre lu et il ne contient rien d interne ;
 *   3. le resultat est relu par le meme analyseur avant d etre ecrit ; a la
 *      moindre erreur, on garde l original.
 *
 * Ce que ce script NE PEUT PAS faire : un commentaire HTML ecrit a l interieur
 * d un gabarit JavaScript n est pas un commentaire, c est une chaine qui finit
 * dans le DOM. Aucun outil ne l enlevera. C est le role du gate
 * `scripts/public-leak-check.js`, qui mesure le RESULTAT de ce script.
 */
const fs = require('fs');
const path = require('path');

// La racine est surchargeable pour que le gate puisse construire une COPIE
// et mesurer le resultat sans jamais toucher au depot.
const ROOT = process.env.BUILD_PUBLIC_ROOT ? path.resolve(process.env.BUILD_PUBLIC_ROOT) : path.resolve(__dirname, '..');

// Les chemins ouverts par le middleware, et eux seuls.
const DOSSIERS = ['assets', 'demo', 'menu'];
const PAGES = ['index.html', 'pro.html', 'public-form.html', 'fungalaxy.html', 'fungalaxy-site.html'];
const EXCLUS = new Set(['embed.js']);

function chargerEsbuild() {
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

// Les commentaires conditionnels (`<!--[if ...]>`) sont du code pour les vieux
// navigateurs : ils restent.
function retirerCommentairesHtml(html) {
  let sortie = '';
  let i = 0;
  while (i < html.length) {
    const d = html.indexOf('<!--', i);
    if (d === -1) { sortie += html.slice(i); break; }
    const fin = html.indexOf('-->', d);
    if (fin === -1) { sortie += html.slice(i); break; }
    sortie += html.slice(i, d);
    const contenu = html.slice(d, fin + 3);
    if (/^<!--\s*\[if/i.test(contenu)) sortie += contenu;
    i = fin + 3;
  }
  return sortie;
}

// Les blocs <script> et <style> ecrits dans la page portent eux aussi des
// commentaires. On ne touche qu au code executable : un `<script
// type="application/json">` contient des donnees, pas du code, et un script
// avec `src` n a pas de corps a nettoyer.
function nettoyerBlocsIntegres(html, eb, journal) {
  return html.replace(/<(script|style)([^>]*)>([\s\S]*?)<\/\1>/gi, (tout, balise, attributs, corps) => {
    if (!corps.trim()) return tout;
    const estScript = balise.toLowerCase() === 'script';
    if (estScript) {
      const type = /type\s*=\s*["']?([^"'\s>]+)/i.exec(attributs);
      if (type && !/^(?:(?:text|application)\/(?:java|ecma)script|module)$/i.test(type[1])) return tout;
      if (/\ssrc\s*=/i.test(attributs)) return tout;
    }
    try {
      const rendu = eb.transformSync(corps, {
        loader: estScript ? 'js' : 'css',
        target: 'esnext',
        legalComments: 'none',
        minifyWhitespace: true,
      }).code;
      return '<' + balise + attributs + '>' + rendu + '</' + balise + '>';
    } catch (error) {
      journal.push('  bloc <' + balise + '> laisse tel quel : ' + String(error.message).split('\n')[0]);
      return tout;
    }
  });
}

function main() {
  const eb = chargerEsbuild();
  if (!eb) {
    console.log('build-public : esbuild absent, fichiers laisses tels quels.');
    return 0;
  }

  const cibles = [];
  for (const d of DOSSIERS) {
    for (const f of listerFichiers(path.join(ROOT, d), [])) {
      if (/\.(js|css|html)$/i.test(f)) cibles.push(f);
    }
  }
  for (const p of PAGES) {
    const f = path.join(ROOT, p);
    if (fs.existsSync(f)) cibles.push(f);
  }

  let traites = 0;
  let laisses = 0;
  let gagnes = 0;
  const journal = [];

  for (const f of cibles) {
    const rel = path.relative(ROOT, f).split(path.sep).join('/');
    if (EXCLUS.has(rel)) { laisses += 1; continue; }
    let avant;
    try { avant = fs.readFileSync(f, 'utf8'); } catch (error) { laisses += 1; continue; }

    const estHtml = /\.html$/i.test(f);
    const loader = /\.css$/i.test(f) ? 'css' : 'js';
    let apres = null;
    try {
      apres = estHtml
        ? nettoyerBlocsIntegres(retirerCommentairesHtml(avant), eb, journal)
        // `minifySyntax` reecrit ce qui est equivalent (couleurs courtes,
        // raccourcis, declarations doublees) sans jamais toucher un NOM :
        // c est exactement ce que `public-leak-check` simulait deja de son
        // cote (minifyIdentifiers: false) pour mesurer ce que le public
        // recoit. Le build le fait desormais pour de vrai : 2,9 Ko de moins
        // sur le seul formulaire Fun Galaxy, et le code reste lisible en
        // production (aucun identifiant mange, aucune sonde aveuglee).
        : eb.transformSync(avant, { loader, target: 'esnext', legalComments: 'none', minifyWhitespace: true, minifySyntax: true, minifyIdentifiers: false }).code;
    } catch (error) {
      journal.push('  ' + rel + ' laisse tel quel : ' + String(error.message).split('\n')[0]);
      apres = null;
    }

    // Relecture du resultat : un fichier qui ne se reanalyse pas ne part pas.
    if (apres !== null && !estHtml) {
      try {
        eb.transformSync(apres, { loader, target: 'esnext' });
      } catch (error) {
        journal.push('  ' + rel + ' laisse tel quel (relecture en echec) : ' + String(error.message).split('\n')[0]);
        apres = null;
      }
    }

    if (apres === null || apres === avant) { laisses += 1; continue; }
    fs.writeFileSync(f, apres);
    traites += 1;
    gagnes += avant.length - apres.length;
  }

  console.log('build-public : ' + traites + ' fichier(s) nettoye(s), ' + laisses
    + ' laisse(s) tel(s) quel(s), ' + Math.round(gagnes / 1024) + ' Ko retires.');
  for (const ligne of journal) console.log(ligne);
  return 0;
}

process.exit(main());

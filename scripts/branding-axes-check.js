// LE STYLE CHOISI PAR UN CENTRE DOIT SURVIVRE AU VOYAGE.
//
// Un axe de style traverse QUATRE endroits avant d arriver a l ecran :
//   1. la liste blanche du SERVEUR (lib/center-config.js), qui accepte ou jette
//      la valeur a l enregistrement ;
//   2. la liste blanche du NAVIGATEUR (assets/app-main.js), qui la pose en
//      data-attribut ou la jette ;
//   3. le menu deroulant de la CONSOLE, qui l offre au staff ;
//   4. la feuille de style, qui lui donne une apparence.
//
// Si l un des quatre manque, RIEN NE SE PLAINT. Le staff choisit son style,
// l enregistre, et la page ne change pas. C est arrive pendant l ecriture de la
// matiere « neon » : la valeur etait acceptee par le serveur, jetee par le
// navigateur, et l apercu montrait l ancien style sans un seul message.
//
// LES PROPRIETES :
//
//   [A] LES DEUX LISTES BLANCHES SONT IDENTIQUES. Une valeur acceptee d un cote
//       et jetee de l autre est une panne muette : la config contient un choix
//       que la page n applique jamais.
//
//   [B] LA CONSOLE N OFFRE QUE DES VALEURS ACCEPTEES. Un menu qui propose un
//       choix voue a etre jete ment a celui qui l utilise.
//
//   [C] CHAQUE VALEUR NON PAR DEFAUT A UNE APPARENCE. Le premier choix de
//       chaque axe est le defaut plateforme et ne s ecrit pas ; tous les autres
//       doivent etre consommes par la feuille de style, sinon les choisir ne
//       fait rien.
//
//   [D] LE GATE SAIT ROUGIR : chaque propriete est mise en defaut par une
//       mutation, et les fichiers sur le disque restent intacts.
//
// Usage : node scripts/branding-axes-check.js
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SERVEUR = path.join(ROOT, 'lib', 'center-config.js');
const FRONT = path.join(ROOT, 'assets', 'app-main.js');
const CSS = path.join(ROOT, 'assets', 'pinlane-client.css');

let failures = 0;
function ok(cond, label, detail) {
  console.log((cond ? 'ok  ' : 'FAIL') + '  ' + label + (detail ? '  ' + detail : ''));
  if (!cond) failures += 1;
  return cond;
}

// On LIT le bloc reel de chaque fichier et on l evalue, au lieu de recopier les
// listes ici : une copie testerait ma copie, pas le code servi.
function litObjet(source, nom) {
  const debut = source.indexOf('const ' + nom + ' = {');
  if (debut === -1) throw new Error(nom + ' introuvable');
  const ouvre = source.indexOf('{', debut);
  let profondeur = 0;
  let fin = -1;
  for (let i = ouvre; i < source.length; i += 1) {
    if (source[i] === '{') profondeur += 1;
    else if (source[i] === '}') {
      profondeur -= 1;
      if (profondeur === 0) { fin = i; break; }
    }
  }
  if (fin === -1) throw new Error(nom + ' : accolade non fermee');
  // eslint-disable-next-line no-eval
  return eval('(' + source.slice(ouvre, fin + 1) + ')');
}

function litTableau(source, nom) {
  const debut = source.indexOf('const ' + nom + ' = [');
  if (debut === -1) throw new Error(nom + ' introuvable');
  const ouvre = source.indexOf('[', debut);
  let profondeur = 0;
  let fin = -1;
  for (let i = ouvre; i < source.length; i += 1) {
    if (source[i] === '[') profondeur += 1;
    else if (source[i] === ']') {
      profondeur -= 1;
      if (profondeur === 0) { fin = i; break; }
    }
  }
  if (fin === -1) throw new Error(nom + ' : crochet non ferme');
  // eslint-disable-next-line no-eval
  return eval('(' + source.slice(ouvre, fin + 1) + ')');
}

function controler(sources) {
  const local = { echecs: 0, tombees: [] };
  const dire = (cond, label, detail) => {
    if (!sources.silencieux) ok(cond, label, detail);
    if (!cond) { local.echecs += 1; local.tombees.push(label); }
    return cond;
  };

  const serveur = litObjet(sources.serveur, 'BRANDING_STYLE_AXES');
  const front = litObjet(sources.front, 'TENANT_STYLE_AXES');
  const console_ = litTableau(sources.front, 'ESTABLISHMENT_STYLE_AXES');
  const css = sources.css;

  // =========================================================================
  if (!sources.silencieux) console.log('[A] les deux listes blanches disent la meme chose');
  // =========================================================================
  // Le theme est le seul axe qui vit cote serveur sans data-attribut : il pose
  // data-theme, pas data-tunnel-theme. On le compare donc a part.
  const clesServeur = Object.keys(serveur).filter((k) => k !== 'theme').sort();
  const clesFront = Object.keys(front).sort();
  dire(clesServeur.join(',') === clesFront.join(','),
    '[A] les memes axes des deux cotes',
    'serveur ' + clesServeur.join('/') + ' contre navigateur ' + clesFront.join('/'));
  let ecarts = [];
  for (const cle of clesFront) {
    const a = (serveur[cle] || []).slice().sort().join(',');
    const b = (front[cle] || []).slice().sort().join(',');
    if (a !== b) ecarts.push(cle + ' : serveur[' + a + '] contre navigateur[' + b + ']');
  }
  dire(ecarts.length === 0,
    '[A] et les memes valeurs dans chaque axe',
    ecarts.length ? ecarts.join(' · ') : Object.keys(front).length + ' axe(s) alignes');

  // =========================================================================
  if (!sources.silencieux) console.log('');
  if (!sources.silencieux) console.log('[B] la console n offre que des valeurs que le produit accepte');
  // =========================================================================
  const offertesInconnues = [];
  for (const axe of console_) {
    const permises = serveur[axe.key] || [];
    for (const [valeur] of axe.options) {
      if (!permises.includes(valeur)) offertesInconnues.push(axe.key + '=' + valeur);
    }
  }
  dire(offertesInconnues.length === 0,
    '[B] aucun choix propose au staff ne serait jete a l enregistrement',
    offertesInconnues.length ? offertesInconnues.join(' · ') : console_.length + ' axe(s) verifies');

  // =========================================================================
  if (!sources.silencieux) console.log('');
  if (!sources.silencieux) console.log('[C] chaque valeur non par defaut a une apparence');
  // =========================================================================
  // LE DEFAUT EST LE PREMIER CHOIX DU MENU, pas le premier de la liste blanche.
  // Les deux ne coincident pas : la liste blanche de `radius` commence par
  // 'sharp' alors que le defaut plateforme est 'soft'. Confondre les deux
  // faisait reclamer une regle pour le defaut (qui n en a pas, par
  // construction) et en dispensait une vraie valeur.
  const defauts = {};
  for (const axe of console_) defauts[axe.key] = axe.options[0][0];
  const sansStyle = [];
  for (const [axe, valeurs] of Object.entries(front)) {
    valeurs.forEach((valeur) => {
      if (valeur === defauts[axe]) return; // le defaut plateforme n ecrit rien
      const marqueur = "data-tunnel-" + axe + "='" + valeur + "'";
      if (css.indexOf(marqueur) === -1) sansStyle.push(axe + '=' + valeur);
    });
  }
  dire(sansStyle.length === 0,
    '[C] toute valeur choisissable est consommee par la feuille de style',
    sansStyle.length ? 'sans effet : ' + sansStyle.join(' · ') : 'toutes les valeurs ont une regle');

  return local;
}

function main() {
  // Le depot est en CRLF : sans normalisation, les ancres de mutation (ecrites
  // avec des sauts de ligne simples) ne mordent jamais, et le gate se declarerait
  // capable de rougir alors qu il n aurait rien mute du tout.
  const lire = (f) => fs.readFileSync(f, 'utf8').split('\r\n').join('\n');
  const sources = {
    serveur: lire(SERVEUR),
    front: lire(FRONT),
    css: lire(CSS),
    silencieux: false,
  };
  controler(sources);

  // =========================================================================
  console.log('');
  console.log('[D] LE GATE SAIT-IL ROUGIR ? une mutation par propriete');
  // =========================================================================
  // Les mutations sont appliquees EN MEMOIRE : le disque n est jamais touche,
  // il n y a donc rien a restaurer et rien a oublier de restaurer.
  const MUTATIONS = [
    {
      nom: 'le navigateur perd une valeur que le serveur accepte',
      applique: (s) => Object.assign({}, s, {
        front: s.front.replace("  cards: ['line', 'flat', 'shadow', 'neon'],\n  buttons:", "  cards: ['line', 'flat', 'shadow'],\n  buttons:"),
      }),
      vise: '[A] et les memes valeurs dans chaque axe',
    },
    {
      nom: 'la console offre un choix que le serveur jetterait',
      applique: (s) => Object.assign({}, s, {
        front: s.front.replace("['neon', 'Néon (anneau + halo, suit votre 2ᵉ couleur)']", "['chrome', 'Chromé']"),
      }),
      vise: '[B] aucun choix propose au staff ne serait jete a l enregistrement',
    },
    {
      nom: 'une valeur reste choisissable mais perd toute regle de style',
      applique: (s) => Object.assign({}, s, {
        css: s.css.split("data-tunnel-cards='neon'").join("data-tunnel-cards='neon-desactive'"),
      }),
      vise: '[C] toute valeur choisissable est consommee par la feuille de style',
    },
  ];

  for (const m of MUTATIONS) {
    const mutees = m.applique(Object.assign({}, sources, { silencieux: true }));
    if (mutees.front === sources.front && mutees.css === sources.css) {
      ok(false, '[D] mutation « ' + m.nom + ' » : ANCRE INTROUVABLE, elle ne mute rien');
      continue;
    }
    let resultat;
    try { resultat = controler(mutees); } catch (error) { resultat = { echecs: 1, tombees: ['exception : ' + error.message] }; }
    ok(resultat.tombees.includes(m.vise),
      '[D] « ' + m.nom +' » fait bien tomber SA propriete',
      resultat.tombees.length ? resultat.tombees.length + ' tombee(s) : ' + resultat.tombees.join(' · ') : 'AUCUNE tombee');
  }

  // Le disque n a jamais ete touche : on le prouve plutot que de l affirmer.
  ok(lire(FRONT) === sources.front && lire(CSS) === sources.css,
    '[D] et les fichiers sur le disque sont intacts (mutations en memoire seulement)');

  console.log('');
  console.log(failures ? failures + ' controle(s) en echec.' : 'branding-axes-check: ALL OK');
  process.exit(failures ? 1 : 0);
}

main();

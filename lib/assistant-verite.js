// CE QUE L ASSISTANT A LE DROIT D AFFIRMER (2026-11-08). Deux morceaux sans modele et sans base :
//  - calculer : un calcul se fait ici, pas dans la tete du modele, et il garde ses entrees ;
//  - tracer : chaque chiffre de la reponse finale est cherche dans ce que les outils ont rendu.
//    Un chiffre qu aucun outil n a produit est signale au gerant sous la reponse.
'use strict';

// ---- Calculer ------------------------------------------------------------------
// Une petite grammaire et pas de eval : l expression vient du modele, et le modele lit des textes
// de clients. + - * / ( ), des nombres, des noms de valeurs, somme moyenne min max arrondi.
const FONCTIONS = {
  somme: (a) => a.reduce((s, x) => s + x, 0),
  moyenne: (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN),
  min: (a) => Math.min(...a),
  max: (a) => Math.max(...a),
  arrondi: (a) => {
    const p = 10 ** (a[1] === undefined ? 0 : a[1]);
    return Math.round(a[0] * p) / p;
  },
};

function jetons(texte) {
  const sortie = [];
  let i = 0;
  while (i < texte.length) {
    const c = texte[i];
    if (c === ' ' || c === '\t') { i += 1; continue; }
    if ('+-*/(),'.includes(c)) { sortie.push({ t: c }); i += 1; continue; }
    const nombre = /^\d+(?:\.\d+)?/.exec(texte.slice(i));
    if (nombre) { sortie.push({ t: 'n', v: Number(nombre[0]) }); i += nombre[0].length; continue; }
    const nom = /^[A-Za-z_][A-Za-z0-9_]*/.exec(texte.slice(i));
    if (nom) { sortie.push({ t: 'id', v: nom[0] }); i += nom[0].length; continue; }
    throw new Error(`caractere non accepte : ${c}`);
  }
  return sortie;
}

function evaluer(expression, valeurs) {
  if (typeof expression !== 'string' || !expression.trim() || expression.length > 400) throw new Error('expression vide ou trop longue');
  const j = jetons(expression);
  let p = 0;
  const lit = (t) => (j[p] && j[p].t === t ? j[p++] : null);
  function primaire() {
    if (lit('-')) return -primaire();
    if (lit('(')) {
      const v = somme();
      if (!lit(')')) throw new Error('parenthese non fermee');
      return v;
    }
    const n = lit('n');
    if (n) return n.v;
    const id = lit('id');
    if (!id) throw new Error('expression incomplete');
    if (j[p] && j[p].t === '(') {
      const f = Object.prototype.hasOwnProperty.call(FONCTIONS, id.v) ? FONCTIONS[id.v] : null;
      if (!f) throw new Error(`fonction inconnue : ${id.v}`);
      lit('(');
      const args = [];
      if (!lit(')')) {
        do { args.push(somme()); } while (lit(','));
        if (!lit(')')) throw new Error('parenthese non fermee');
      }
      return f(args);
    }
    if (!Object.prototype.hasOwnProperty.call(valeurs, id.v)) throw new Error(`valeur inconnue : ${id.v}`);
    return valeurs[id.v];
  }
  function produit() {
    let v = primaire();
    for (;;) {
      if (lit('*')) v *= primaire();
      else if (lit('/')) {
        const d = primaire();
        if (d === 0) throw new Error('division par zero');
        v /= d;
      } else return v;
    }
  }
  function somme() {
    let v = produit();
    for (;;) {
      if (lit('+')) v += produit();
      else if (lit('-')) v -= produit();
      else return v;
    }
  }
  const resultat = somme();
  if (p !== j.length) throw new Error('expression mal formee');
  if (!Number.isFinite(resultat)) throw new Error('resultat non calculable');
  return resultat;
}

// ---- Tracer --------------------------------------------------------------------
function ajouterFormes(ensemble, brut) {
  const v = Math.abs(brut);
  if (!Number.isFinite(v)) return;
  ensemble.add(v);
  ensemble.add(Math.round(v));
  ensemble.add(Math.round(v * 10) / 10);
  ensemble.add(Math.round(v * 100) / 100);
  ensemble.add(Math.floor(v));
  ensemble.add(Math.ceil(v));
}

function nombresConnus(sources) {
  const ensemble = new Set();
  const fouiller = (x) => {
    if (typeof x === 'number') ajouterFormes(ensemble, x);
    else if (typeof x === 'string') (x.match(/\d{1,3}(?:[ \u00A0\u202F]\d{3})+|\d+(?:[.,]\d+)?/g) || []).forEach((m) => ajouterFormes(ensemble, Number(m.replace(/[ \u00A0\u202F]/g, '').replace(',', '.'))));
    else if (Array.isArray(x)) x.forEach(fouiller);
    else if (x && typeof x === 'object') Object.values(x).forEach(fouiller);
  };
  fouiller(sources);
  return ensemble;
}

// Un chiffre qui engage : un montant, un pourcentage, ou un nombre de deux chiffres et plus qui
// compte quelque chose. Pas les dates, les heures, les durees ni les renvois [S3].
const CHIFFRE = /(\d{1,3}(?:[ \u00A0\u202F]\d{3})+|\d+)(?:[.,](\d+))?(?:[ \u00A0\u202F]*(%|€|euros?\b|pts?\b|points?\b))?/g;
const APRES_NON_COMPTE = /^[ \u00A0\u202F]*(h\b|:\d|jours?\b|semaines?\b|mois\b|ans?\b|heures?\b|minutes?\b|min\b|janv|févr|fevr|mars|avr|mai|juin|juil|août|aout|sept|oct|nov|déc|dec)/i;

function chiffresDuTexte(texte) {
  // Un telephone ou une adresse cite ne compte rien : on les retire avant de chercher les chiffres.
  const propre = String(texte || '').replace(/\[[SGF]\d+\]/g, ' ').replace(/`[^`]*`/g, ' ').replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, ' ').replace(/(?:\+|00)?\d[\d\s./-]{7,}\d/g, ' ');
  const trouves = [];
  CHIFFRE.lastIndex = 0;
  let m;
  while ((m = CHIFFRE.exec(propre))) {
    const avant = propre[m.index - 1] || '';
    if (/[\w:/-]/.test(avant)) continue;
    const entier = m[1].replace(/[ \u00A0\u202F]/g, '');
    const valeur = Number(`${entier}${m[2] ? `.${m[2]}` : ''}`);
    const unite = m[3] || '';
    if (!unite) {
      // Sans unite : on ne juge que ce qui ressemble a un compte, pas une date ni un rang.
      if (valeur < 11 || (valeur >= 1900 && valeur <= 2100 && !m[2])) continue;
      if (APRES_NON_COMPTE.test(propre.slice(m.index + m[0].length, m.index + m[0].length + 12))) continue;
    }
    trouves.push({ texte: m[0].trim(), valeur });
  }
  return trouves;
}

function tracer(texte, sources) {
  const connus = nombresConnus(sources);
  const chiffres = chiffresDuTexte(texte);
  const nonTraces = chiffres.filter((c) => !connus.has(c.valeur));
  return { total: chiffres.length, nonTraces: nonTraces.map((c) => c.texte).filter((t, i, l) => l.indexOf(t) === i) };
}

// Les renvois [S3] qui ne menent nulle part sont retires : une reference ne s invente pas.
function citationsValides(texte, identifiants) {
  const cites = [];
  const inconnus = [];
  String(texte || '').replace(/\[S(\d+)\]/g, (_, n) => {
    const id = `S${n}`;
    if (identifiants.includes(id)) { if (!cites.includes(id)) cites.push(id); } else if (!inconnus.includes(id)) inconnus.push(id);
    return '';
  });
  return { cites, inconnus };
}

// Le texte final ne garde que les renvois qui menent quelque part.
function nettoyerCitations(texte, sources, graphiques = [], faits = []) {
  const parGenre = { S: sources, G: graphiques, F: faits };
  return String(texte || '').replace(/[ \u00A0]*\[(S|G|F)(\d+)\]/g, (tout, genre, n) => (parGenre[genre].includes(`${genre}${n}`) ? tout : ''));
}

module.exports = { evaluer, tracer, chiffresDuTexte, citationsValides, nettoyerCitations };

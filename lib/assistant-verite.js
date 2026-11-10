// CE QUE L ASSISTANT A LE DROIT D AFFIRMER (2026-11-08). Deux morceaux sans modele et sans base :
//  - calculer : un calcul se fait ici, pas dans la tete du modele, et il garde ses entrees ;
//  - prouver : chaque chiffre de la reponse finale est relie a la case d ou il vient, ou au calcul
//    refait avec ses entrees. Celui qu on ne retrouve pas est signale au gerant, sur le chiffre.
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
    // 51 / 80 * 100 vaut 63,74999… en virgule flottante : le « juste milieu » doit monter.
    return Math.round(a[0] * p + 1e-9) / p;
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

// ---- Prouver -------------------------------------------------------------------
// Un pourcentage ne se rattache qu a un taux ou a un calcul : « 64 % » n est pas prouve par « 64 joueurs ».
const TAUX = /taux|part|pourc|pct|ratio|evolution|variation|remplissage|occupation|marge|conversion/i;
// Un montant se relie d abord a une colonne de montants, s il y en a une qui le porte.
const MONTANT = /chiffre|montant|prix|panier|perdu|revenu|euros?|cout|depense|recette|gain/i;
const CLE_PERSONNELLE = /(^|_)(client|prenom|contact|email|mail|telephone|phone|adresse|objet|message|corps|notes?|auteur)($|_)/i;
const PREUVES_MAX = 150;
const MOTS = { modele: 'modèle', creneaux: 'créneaux', confirmes: 'confirmés', reservations: 'réservations', reservation: 'réservation', deja: 'déjà', fidelite: 'fidélité', periode: 'période', activite: 'activité', activites: 'activités', numero: 'numéro', apres: 'après', duree: 'durée', evolution: 'évolution', frequence: 'fréquence', categorie: 'catégorie', mediane: 'médiane', depense: 'dépense', depenses: 'dépenses', annee: 'année', donnees: 'données', age: 'âge', ages: 'âges', general: 'Général', ecran: 'écran', ecrans: 'écrans', arrives: 'arrivés', completes: 'complètes', depart: 'départ', ligne: '' };

function motDe(cle) {
  const t = String(cle).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase().split(/\s+/).map((m) => (Object.prototype.hasOwnProperty.call(MOTS, m) ? MOTS[m] : m)).join(' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function typeDeCle(cle, objets) {
  const nombres = objets.map((o) => o[cle]).filter((x) => typeof x === 'number');
  if (!nombres.length) return 'texte';
  if (/taux|pourc|pct/i.test(cle) && nombres.some((n) => Math.abs(n) > 1)) return 'pct';
  if (/chiffre|montant|prix|panier|perdu|revenu|euros?|cout|depense/i.test(cle)) return 'euro';
  return 'dec';
}

function tableDe(titre, objets) {
  const cles = [];
  objets.forEach((o) => Object.entries(o).forEach(([k, x]) => { if (!cles.includes(k) && (x === null || ['number', 'string', 'boolean'].includes(typeof x))) cles.push(k); }));
  if (!cles.length) return null;
  return { titre: motDe(titre), colonnes: cles.map((k) => ({ cle: k, nom: motDe(k), type: typeDeCle(k, objets) })), lignes: objets };
}

// Tout ce qu un outil a rendu, range en tableaux : c est ce que la personne peut relire.
function sectionsDe(modele) {
  if (!modele || typeof modele !== 'object') return [];
  const sections = [];
  const general = {};
  const compacte = (x) => x.lignes.map((l) => Object.fromEntries(x.colonnes.map((c, i) => [c, Array.isArray(l) ? l[i] : undefined])));
  const poser = (s) => { if (s && s.lignes.length) sections.push(s); };
  const aPlat = Array.isArray(modele.colonnes) && Array.isArray(modele.lignes);
  if (aPlat) poser(tableDe('lignes', compacte(modele)));
  Object.entries(modele).forEach(([cle, x]) => {
    if (aPlat && (cle === 'colonnes' || cle === 'lignes')) return;
    if (x === null || x === undefined) return;
    if (typeof x !== 'object') { general[cle] = x; return; }
    const objet = (y) => y && typeof y === 'object' && !Array.isArray(y);
    if (Array.isArray(x)) { if (x.length && x.every(objet)) poser(tableDe(cle, x)); return; }
    if (Array.isArray(x.colonnes) && Array.isArray(x.lignes)) { poser(tableDe(cle, compacte(x))); return; }
    const valeurs = Object.values(x);
    if (valeurs.length && valeurs.every(objet)) poser(tableDe(cle, Object.entries(x).map(([k, y]) => ({ ligne: k, ...y }))));
    else poser(tableDe(cle, Object.entries(x).filter(([, y]) => y === null || typeof y !== 'object').map(([k, y]) => ({ ligne: motDe(k), valeur: y }))));
  });
  if (Object.keys(general).length) poser(tableDe('general', Object.entries(general).map(([k, y]) => ({ ligne: motDe(k), valeur: y }))));
  return sections;
}

// Ce qui part vers l ecran : borne, et sans ce qui designe une personne.
function sectionsPourEcran(modele, { personnes = false } = {}) {
  const interdite = (cle) => CLE_PERSONNELLE.test(cle) || (personnes && /(^|_)nom($|_)/i.test(cle));
  return sectionsDe(modele).slice(0, 12).map((s) => {
    const colonnes = s.colonnes.filter((c) => !interdite(c.cle)).slice(0, 12);
    return { titre: s.titre, colonnes, lignes: s.lignes.slice(0, 40).map((l) => Object.fromEntries(colonnes.map((c) => [c.cle, typeof l[c.cle] === 'string' ? l[c.cle].slice(0, 120) : l[c.cle]]))) };
  });
}

function libelleDeCase(section, ligne, colonne) {
  const etiquette = section.colonnes.find((c) => c !== colonne && typeof ligne[c.cle] === 'string' && ligne[c.cle] && !CLE_PERSONNELLE.test(c.cle));
  return [section.titre, etiquette ? ligne[etiquette.cle] : '', colonne.cle === 'valeur' ? '' : colonne.nom].filter(Boolean).join(', ').slice(0, 140);
}

// Chaque nombre lu, avec l endroit ou il se lit.
function indexer(sources) {
  const index = new Map();
  const poser = (brut, lieu) => {
    const v = Math.abs(brut);
    if (!Number.isFinite(v)) return;
    new Set([v, Math.round(v), Math.round(v * 10) / 10, Math.round(v * 100) / 100, Math.floor(v), Math.ceil(v)]).forEach((f) => {
      if (!index.has(f)) index.set(f, []);
      const l = index.get(f);
      if (l.filter((x) => x.source === lieu.source).length < 12) l.push(lieu);
    });
  };
  sources.forEach((s) => {
    const calcul = s.outil === 'calculer';
    sectionsDe(s.modele).forEach((sec, si) => sec.lignes.forEach((ligne, ri) => sec.colonnes.forEach((col) => {
      if (typeof ligne[col.cle] !== 'number') return;
      poser(ligne[col.cle], { source: s.id, calcul, cle: col.cle === 'valeur' ? String(ligne.ligne) : col.cle, libelle: calcul ? s.titre : libelleDeCase(sec, ligne, col), ...(calcul ? {} : { z: [si, ri, col.cle] }) });
    })));
    // Ce que les tableaux ne prennent pas : un chiffre dans une phrase, un objet imbrique.
    const fouiller = (x, cle) => {
      if (typeof x === 'number') poser(x, { source: s.id, calcul, cle, libelle: s.titre });
      else if (typeof x === 'string') {
        const sansDates = x.replace(/\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?|\b\d{1,2}[:h]\d{2}\b/g, ' ');
        for (const m of sansDates.matchAll(/(\d{1,3}(?:[ \u00A0\u202F]\d{3})+|\d+(?:[.,]\d+)?)([ \u00A0\u202F]*%)?/g)) poser(Number(m[1].replace(/[ \u00A0\u202F]/g, '').replace(',', '.')), { source: s.id, calcul, cle, libelle: s.titre, pct: Boolean(m[2]) });
      } else if (Array.isArray(x)) x.forEach((y) => fouiller(y, cle));
      else if (x && typeof x === 'object') Object.entries(x).forEach(([k, y]) => fouiller(y, k));
    };
    fouiller(s.modele, '');
  });
  return index;
}

const sansAccents = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const motsDe = (t) => [...new Set(sansAccents(t).split(/[^a-z0-9]+/).filter((m) => m.length >= 4))];

// La source ou une valeur se lit vraiment : celle annoncee si elle la porte, sinon une autre.
function ouSeLit(sources, valeur, annoncee, nom = '') {
  const lieux = indexer(sources).get(Math.abs(Number(valeur))) || [];
  const dites = lieux.filter((l) => l.source === annoncee);
  const mots = motsDe(String(nom).replace(/_/g, ' '));
  const note = (l) => (l.z ? 1 : 0) + (mots.filter((m) => sansAccents(l.libelle).includes(m)).length * 10);
  return [...(dites.length ? dites : lieux)].sort((a, b) => note(b) - note(a))[0] || null;
}

// Un chiffre qui engage : un montant, un pourcentage, ou un nombre de deux chiffres et plus qui
// compte quelque chose. Pas les dates, les heures, les durees ni les renvois [S3].
const CHIFFRE = /(\d{1,3}(?:[ \u00A0\u202F]\d{3})+|\d+)(?:[.,](\d+))?(?:[ \u00A0\u202F]*(%|€|euros?\b|pts?\b|points?\b))?/g;
const APRES_NON_COMPTE = /^[ \u00A0\u202F]*(h\b|:\d|\/\d|derni|prochain|premi|jours?\b|semaines?\b|mois\b|ans?\b|heures?\b|minutes?\b|min\b|janv|févr|fevr|mars|avr|mai|juin|juil|août|aout|sept|oct|nov|déc|dec)/i;

// Un jour du mois n est pas un compte : « jeudi 19 », « les mardis 17 et 24 », « du 14 au 21 novembre ».
// Ansar, 2026-11-10, sur « Mardi 17 et jeudi 19 n ont aucune réservation » : l alerte disait que 19
// n avait pas ete retrouve dans les donnees. Un nombre suivi de ce qu il compte reste un compte.
const MOIS_COURTS = 'janv|févr|fevr|mars|avr|mai|juin|juil|août|aout|sept|oct|nov|déc|dec';
const JOUR_AVANT = /(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)s?(?:\s+le)?(?:\s+\d{1,2}(?:er)?\s*(?:,|et|ou|au)\s*(?:le\s+)?)*\s*$/i;
const QUANTIEME_APRES = new RegExp(`^(?:er)?\\s*(?:,|et|ou|au)\\s*(?:le\\s+)?\\d{1,2}(?:er)?\\s+(?:${MOIS_COURTS})`, 'i');
const COMPTE_APRES = /^\s*(?:r[ée]servations?|groupes?|joueurs?|personnes?|clients?|pistes?|demandes?|visites?|enfants?|[ée]l[èe]ves?|parties?|formules?|mails?|cr[ée]neaux?|tables?|activit[ée]s?|fois)(?![a-zà-ÿ])/i;

function estUnJourDuMois(propre, m, valeur) {
  if (valeur > 31 || m[2]) return false;
  const apres = propre.slice(m.index + m[0].length, m.index + m[0].length + 30);
  if (COMPTE_APRES.test(apres)) return false;
  return JOUR_AVANT.test(propre.slice(Math.max(0, m.index - 44), m.index)) || QUANTIEME_APRES.test(apres);
}

// Un seuil ou un rang n affirme rien sur les donnees : « moins de 20 », « au moins 30 », « top 10 ».
const AVANT_NON_COMPTE = /(?:moins de|au moins|plus de|au[- ]del[aà] de|seuil de|minimum de|maximum de|sous les|top)[ \u00A0\u202F]*$/i;

function chiffresDuTexte(texte) {
  // Un telephone ou une adresse cite ne compte rien. On les efface a la meme longueur : les positions restent justes.
  const blanc = (m) => ' '.repeat(m.length);
  const propre = String(texte || '').replace(/\[[SGF]\d+\]/g, blanc).replace(/`[^`]*`/g, blanc).replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, blanc).replace(/(?:\+|00)?\d[\d\s./-]{7,}\d/g, blanc);
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
      if (AVANT_NON_COMPTE.test(propre.slice(Math.max(0, m.index - 14), m.index))) continue;
      if (estUnJourDuMois(propre, m, valeur)) continue;
    }
    trouves.push({ texte: m[0], valeur, d: m.index, f: m.index + m[0].length, unite });
  }
  return trouves;
}

// « [S1, S2] » s ecrit « [S1][S2] » : chaque renvoi garde sa pastille, et le controle les voit.
function normaliserRenvois(texte) {
  return String(texte || '').replace(/\[((?:[SGF]\d+\s*[,;]\s*)+[SGF]\d+)\]/g, (tout, liste) => liste.split(/\s*[,;]\s*/).map((r) => `[${r}]`).join(''));
}

function renvoisAutour(texte, position) {
  const avant = texte.slice(0, position);
  const debut = Math.max(avant.lastIndexOf('\n'), avant.lastIndexOf('. '), avant.lastIndexOf('! '), avant.lastIndexOf('? ')) + 1;
  const suite = texte.slice(position).search(/\n|[.!?](?:\s|$)/);
  const phrase = texte.slice(debut, suite < 0 ? texte.length : position + suite + 1);
  return (phrase.match(/\[S\d+\]/g) || []).map((c) => c.slice(1, -1));
}

// Pour chaque chiffre de la reponse : d ou il vient, ou le fait qu on ne le retrouve pas.
function preuves(texte, sources, faits = []) {
  const index = indexer(sources);
  const parFait = faits.map((f) => ({ id: f.id, index: indexer([{ id: `F${f.id}`, modele: { texte: f.texte } }]) }));
  return chiffresDuTexte(texte).slice(0, PREUVES_MAX).map((c) => {
    const base = { d: c.d, f: c.f, t: c.texte };
    const admis = (l) => c.unite !== '%' || l.calcul || l.pct || TAUX.test(l.cle || '');
    const lieux = (index.get(c.valeur) || []).filter(admis);
    const cites = renvoisAutour(texte, c.d);
    const enEuros = /€|euro/i.test(c.unite);
    // Une meme valeur se lit souvent a plusieurs endroits : on prend celui dont parlent les mots autour.
    const autour = sansAccents(texte.slice(Math.max(0, c.d - 30), c.f + 30));
    const parle = (l) => motsDe(l.libelle).filter((m) => autour.includes(m)).length;
    const score = (l) => (cites.includes(l.source) ? 1000 : 0) + (l.calcul ? 500 : 0) + (parle(l) * 10) + (l.z ? 1 : 0);
    const classes = (liste) => [...liste].sort((x, y) => score(y) - score(x));
    const lieu = classes(lieux.filter((l) => !enEuros || l.calcul || MONTANT.test(l.cle || '')))[0] || classes(lieux)[0];
    // Un nombre nu trouve ailleurs, dont rien ne parle autour : une coincidence, ni preuve ni alerte.
    if (lieu && !c.unite && !cites.includes(lieu.source) && !lieu.calcul && !parle(lieu)) return null;
    if (lieu) {
      const vues = new Set(lieu.z ? [lieu.z.join()] : []);
      const autres = !lieu.z ? [] : lieux.filter((l) => l.source === lieu.source && l.z && !vues.has(l.z.join()) && vues.add(l.z.join())).slice(0, 5).map((l) => ({ l: l.libelle, z: l.z }));
      return { ...base, e: lieu.calcul ? 'calcule' : 'lu', s: lieu.source, l: lieu.libelle, ...(lieu.z ? { z: lieu.z } : {}), ...(autres.length ? { a: autres } : {}) };
    }
    const fait = parFait.find((f) => (f.index.get(c.valeur) || []).some(admis));
    if (fait) return { ...base, e: 'appris', s: `F${fait.id}` };
    return { ...base, e: 'inconnu' };
  }).filter(Boolean);
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

module.exports = { evaluer, preuves, normaliserRenvois, motDe, ouSeLit, sectionsDe, sectionsPourEcran, chiffresDuTexte, citationsValides, nettoyerCitations };

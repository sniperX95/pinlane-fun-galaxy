'use strict';
// UN ÉCRIVAIN .XLSX MINIMAL, SANS DÉPENDANCE (2026-10-05).
//
// Un classeur Excel est un conteneur ZIP de documents XML (OOXML,
// SpreadsheetML). Ce module écrit les deux à la main : le zip (en-têtes
// locaux, répertoire central, CRC-32, deflate via zlib) et les parties XML
// (classeur, feuilles, styles, chaînes partagées, propriétés). Rien d'autre :
// pas de formules, pas de graphiques, pas d'images. Ce qu'il sait faire est
// ce dont un export de journée a besoin, et il le fait proprement, pour
// qu'Excel, LibreOffice et Google Sheets ouvrent le fichier sans réparation :
//
//   plusieurs feuilles ; texte, nombres, dates, heures, dates-heures ;
//   en-tête gras sur fond coloré, bordures fines, retour à la ligne ;
//   format monétaire « #,##0.00 € », formats date et heure ;
//   largeurs de colonnes (données ou calculées sur le contenu) ;
//   ligne d'en-tête figée, filtre automatique, lignes en bandes ;
//   cellules fusionnées pour un titre ; orientation paysage à l'impression.
//
// L'ordre des éléments dans chaque XML suit le schéma (sheetPr, dimension,
// sheetViews, sheetFormatPr, cols, sheetData, autoFilter, mergeCells,
// pageMargins, pageSetup) : c'est cet ordre, pas la syntaxe, qui fait qu'un
// fichier passe ou déclenche une « réparation » dans Excel.
//
// API :
//   const classeur = new Classeur({ titre, auteur });
//   const f = classeur.ajouterFeuille('Réservations', { figer: 1, filtre: true, bandes: true, paysage: true });
//   f.definirColonnes([{ titre: 'Heure', type: 'heure', largeur: 8 }, { titre: 'Client', type: 'texte', wrap: true }]);
//   f.entete();                       // la ligne des titres, dans le style d'en-tête
//   f.ajouterLigne(['14:30', 'Dupont']);
//   f.ajouterLigne([{ v: 12, type: 'euros', gras: true }]);
//   classeur.versBuffer();            // -> Buffer .xlsx
//
// Types de cellule : texte, nombre, entier, euros, date ('YYYY-MM-DD' ou
// Date), heure ('HH:MM' ou fraction de jour), dateheure (ISO ou Date, heure
// de Bruxelles), booleen (« oui » / « non »).

const zlib = require('zlib');

// ---------------------------------------------------------------------------
// ZIP
// ---------------------------------------------------------------------------
const TABLE_CRC = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
function crc32(buffer) {
  let c = -1;
  for (let i = 0; i < buffer.length; i += 1) c = TABLE_CRC[(c ^ buffer[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function horodatageDos(date) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const annee = Math.min(2107, Math.max(1980, d.getFullYear()));
  return {
    heure: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    jour: ((annee - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}
// `entrees` : [{ nom, donnees }] dans l'ordre d'écriture ([Content_Types].xml
// en premier). Chaque entrée est compressée (deflate brut) sauf si cela ne
// gagne rien, auquel cas elle est stockée telle quelle.
function ecrireZip(entrees, { date = new Date() } = {}) {
  const { heure, jour } = horodatageDos(date);
  const locaux = [];
  const centraux = [];
  let offset = 0;
  for (const { nom, donnees } of entrees) {
    const nomBuf = Buffer.from(String(nom), 'utf8');
    const brut = Buffer.isBuffer(donnees) ? donnees : Buffer.from(String(donnees), 'utf8');
    const comprime = zlib.deflateRawSync(brut, { level: 9 });
    const stocke = comprime.length >= brut.length;
    const corps = stocke ? brut : comprime;
    const methode = stocke ? 0 : 8;
    const crc = crc32(brut);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);        // version requise : 2.0
    local.writeUInt16LE(0x0800, 6);    // noms en UTF-8
    local.writeUInt16LE(methode, 8);
    local.writeUInt16LE(heure, 10);
    local.writeUInt16LE(jour, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(corps.length, 18);
    local.writeUInt32LE(brut.length, 22);
    local.writeUInt16LE(nomBuf.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);      // version de création
    central.writeUInt16LE(20, 6);      // version requise
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(methode, 10);
    central.writeUInt16LE(heure, 12);
    central.writeUInt16LE(jour, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(corps.length, 20);
    central.writeUInt32LE(brut.length, 24);
    central.writeUInt16LE(nomBuf.length, 28);
    central.writeUInt16LE(0, 30);      // extra
    central.writeUInt16LE(0, 32);      // commentaire
    central.writeUInt16LE(0, 34);      // disque
    central.writeUInt16LE(0, 36);      // attributs internes
    central.writeUInt32LE(0, 38);      // attributs externes
    central.writeUInt32LE(offset, 42);
    locaux.push(local, nomBuf, corps);
    centraux.push(central, nomBuf);
    offset += local.length + nomBuf.length + corps.length;
  }
  const tailleCentral = centraux.reduce((s, b) => s + b.length, 0);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(0, 4);
  fin.writeUInt16LE(0, 6);
  fin.writeUInt16LE(entrees.length, 8);
  fin.writeUInt16LE(entrees.length, 10);
  fin.writeUInt32LE(tailleCentral, 12);
  fin.writeUInt32LE(offset, 16);
  fin.writeUInt16LE(0, 20);
  return Buffer.concat([...locaux, ...centraux, fin]);
}
// Le contraire, pour vérifier un classeur : [{ nom, donnees, crcOk }], lu
// depuis le répertoire central.
function lireZip(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  let finCentral = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 65557; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { finCentral = i; break; }
  }
  if (finCentral < 0) throw new Error('Pas de fin de répertoire central : ce n’est pas un zip.');
  const nombre = buf.readUInt16LE(finCentral + 10);
  let position = buf.readUInt32LE(finCentral + 16);
  const entrees = [];
  for (let n = 0; n < nombre; n += 1) {
    if (buf.readUInt32LE(position) !== 0x02014b50) throw new Error('Répertoire central corrompu.');
    const methode = buf.readUInt16LE(position + 10);
    const crc = buf.readUInt32LE(position + 16);
    const tailleComprimee = buf.readUInt32LE(position + 20);
    const tailleBrute = buf.readUInt32LE(position + 24);
    const longueurNom = buf.readUInt16LE(position + 28);
    const longueurExtra = buf.readUInt16LE(position + 30);
    const longueurCommentaire = buf.readUInt16LE(position + 32);
    const offsetLocal = buf.readUInt32LE(position + 42);
    const nom = buf.slice(position + 46, position + 46 + longueurNom).toString('utf8');
    if (buf.readUInt32LE(offsetLocal) !== 0x04034b50) throw new Error(`En-tête local absent pour ${nom}.`);
    const nomLocal = buf.readUInt16LE(offsetLocal + 26);
    const extraLocal = buf.readUInt16LE(offsetLocal + 28);
    const debut = offsetLocal + 30 + nomLocal + extraLocal;
    const corps = buf.slice(debut, debut + tailleComprimee);
    const donnees = methode === 8 ? zlib.inflateRawSync(corps) : corps;
    entrees.push({ nom, donnees, methode, crcOk: crc32(donnees) === crc && donnees.length === tailleBrute });
    position += 46 + longueurNom + longueurExtra + longueurCommentaire;
  }
  return entrees;
}

// ---------------------------------------------------------------------------
// XML
// ---------------------------------------------------------------------------
// Texte échappé pour XML, sans les caractères de contrôle qu'Excel refuse.
function xml(texte) {
  return String(texte == null ? '' : texte)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF￾￿]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
const ENTETE_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

// « A », « Z », « AA » : la lettre d'une colonne (index 0).
function lettreColonne(index) {
  let n = index + 1;
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
function refCellule(ligne, colonne) {
  return `${lettreColonne(colonne)}${ligne + 1}`;
}
// Un nom de feuille valable pour Excel : 31 caractères au plus, sans []:*?/\.
function nomDeFeuille(nom) {
  const propre = String(nom || 'Feuille').replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31);
  return propre || 'Feuille';
}

// ---------------------------------------------------------------------------
// Dates et heures : les nombres d'Excel (jours depuis le 30/12/1899).
// ---------------------------------------------------------------------------
const EPOQUE = Date.UTC(1899, 11, 30);
function serieDate(iso) {
  if (iso instanceof Date) return serieDateHeure(iso, { sansHeure: true });
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return null;
  return Math.round((Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - EPOQUE) / 86400000);
}
function fractionHeure(valeur) {
  if (typeof valeur === 'number') return valeur >= 1 ? (valeur % 1) : valeur;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(valeur || '').trim());
  if (!m) return null;
  return (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] || 0)) / 86400;
}
// Un instant (ISO ou Date) vu de Bruxelles, en série Excel (Excel n'a pas de
// fuseau : on écrit l'heure murale du centre).
function serieDateHeure(valeur, { sansHeure = false, fuseau = 'Europe/Brussels' } = {}) {
  const d = valeur instanceof Date ? valeur : new Date(valeur);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: fuseau, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(d);
  const v = (type) => Number((parts.find((x) => x.type === type) || {}).value || 0);
  const jours = Math.round((Date.UTC(v('year'), v('month') - 1, v('day')) - EPOQUE) / 86400000);
  if (sansHeure) return jours;
  const heure = v('hour') === 24 ? 0 : v('hour');
  return jours + (heure * 3600 + v('minute') * 60 + v('second')) / 86400;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const POLICES = [
  { taille: 10 },
  { taille: 10, gras: true, couleur: 'FFFFFFFF' },
  { taille: 10, gras: true },
  { taille: 14, gras: true, couleur: 'FF1F3A5F' },
  { taille: 10, italique: true, couleur: 'FF6B7280' },
];
const POLICE = { normale: 0, entete: 1, grasse: 2, titre: 3, muette: 4 };
const FONDS = [null, 'gray125', 'FF1F4E78', 'FFF2F6FA', 'FFE9EEF4'];
const FOND = { aucun: 0, entete: 2, bande: 3, cle: 4 };
const BORDURE = { aucune: 0, fine: 1 };
const FORMATS = { general: 0, euros: 164, date: 165, dateheure: 166, heure: 167, entier: 168, nombre: 169 };
const FORMATS_PERSONNALISES = [
  [164, '#,##0.00\\ "€"'],
  [165, 'dd/mm/yyyy'],
  [166, 'dd/mm/yyyy\\ hh:mm'],
  [167, 'hh:mm'],
  [168, '#,##0'],
  [169, '#,##0.##'],
];
const TYPES = new Set(['texte', 'nombre', 'entier', 'euros', 'date', 'heure', 'dateheure', 'booleen']);

class Styles {
  constructor() {
    this.xfs = [];
    this.index = new Map();
    this.obtenir({});
  }
  obtenir({ police = POLICE.normale, fond = FOND.aucun, bordure = BORDURE.aucune, format = FORMATS.general, h = '', v = '', wrap = false } = {}) {
    const cle = `${police}|${fond}|${bordure}|${format}|${h}|${v}|${wrap ? 1 : 0}`;
    if (this.index.has(cle)) return this.index.get(cle);
    const id = this.xfs.length;
    this.xfs.push({ police, fond, bordure, format, h, v, wrap });
    this.index.set(cle, id);
    return id;
  }
  xmlStyles() {
    const fonts = POLICES.map((p) => `<font>${p.gras ? '<b/>' : ''}${p.italique ? '<i/>' : ''}<sz val="${p.taille}"/>${p.couleur ? `<color rgb="${p.couleur}"/>` : ''}<name val="Calibri"/><family val="2"/></font>`).join('');
    const fills = FONDS.map((f) => {
      if (!f) return '<fill><patternFill patternType="none"/></fill>';
      if (f === 'gray125') return '<fill><patternFill patternType="gray125"/></fill>';
      return `<fill><patternFill patternType="solid"><fgColor rgb="${f}"/><bgColor indexed="64"/></patternFill></fill>`;
    }).join('');
    const borders = '<border><left/><right/><top/><bottom/><diagonal/></border>' +
      '<border><left style="thin"><color rgb="FFC9D1DB"/></left><right style="thin"><color rgb="FFC9D1DB"/></right><top style="thin"><color rgb="FFC9D1DB"/></top><bottom style="thin"><color rgb="FFC9D1DB"/></bottom><diagonal/></border>';
    const xfs = this.xfs.map((x) => {
      const alignement = x.h || x.v || x.wrap ? `<alignment${x.h ? ` horizontal="${x.h}"` : ''}${x.v ? ` vertical="${x.v}"` : ''}${x.wrap ? ' wrapText="1"' : ''}/>` : '';
      return `<xf numFmtId="${x.format}" fontId="${x.police}" fillId="${x.fond}" borderId="${x.bordure}" xfId="0"` +
        `${x.format ? ' applyNumberFormat="1"' : ''}${x.police ? ' applyFont="1"' : ''}${x.fond ? ' applyFill="1"' : ''}${x.bordure ? ' applyBorder="1"' : ''}${alignement ? ' applyAlignment="1"' : ''}>${alignement}</xf>`;
    }).join('');
    return `${ENTETE_XML}<styleSheet xmlns="${NS_MAIN}">` +
      `<numFmts count="${FORMATS_PERSONNALISES.length}">${FORMATS_PERSONNALISES.map(([id, code]) => `<numFmt numFmtId="${id}" formatCode="${xml(code)}"/>`).join('')}</numFmts>` +
      `<fonts count="${POLICES.length}">${fonts}</fonts>` +
      `<fills count="${FONDS.length}">${fills}</fills>` +
      '<borders count="2">' + borders + '</borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      `<cellXfs count="${this.xfs.length}">${xfs}</cellXfs>` +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '<dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>' +
      '</styleSheet>';
  }
}

// ---------------------------------------------------------------------------
// Feuille
// ---------------------------------------------------------------------------
// Une cellule normalisée : { v, type, gras, aligner, wrap, fond, police }.
function normaliserCellule(valeur, colonne) {
  const base = colonne && typeof colonne === 'object' ? colonne : {};
  if (valeur && typeof valeur === 'object' && !(valeur instanceof Date) && Object.prototype.hasOwnProperty.call(valeur, 'v')) {
    return { ...base, ...valeur, type: TYPES.has(valeur.type) ? valeur.type : (base.type || deviner(valeur.v)) };
  }
  return { ...base, v: valeur, type: TYPES.has(base.type) ? base.type : deviner(valeur) };
}
function deviner(valeur) {
  if (typeof valeur === 'number') return 'nombre';
  if (typeof valeur === 'boolean') return 'booleen';
  if (valeur instanceof Date) return 'dateheure';
  return 'texte';
}

class Feuille {
  constructor(classeur, nom, { figer = 1, filtre = true, bandes = true, paysage = true, zoom = 100 } = {}) {
    this.classeur = classeur;
    this.nom = nomDeFeuille(nom);
    this.options = { figer, filtre, bandes, paysage, zoom };
    this.colonnes = [];
    this.lignes = [];       // [{ cellules: [normalisées], style, hauteur }]
    this.fusions = [];
    this.ligneEntete = -1;
  }
  // [{ titre, type, largeur, wrap, aligner }]
  definirColonnes(colonnes) {
    this.colonnes = (Array.isArray(colonnes) ? colonnes : []).map((c) => (typeof c === 'string' ? { titre: c } : { ...c }));
    return this;
  }
  // La ligne des titres : toujours du texte, quel que soit le type de la colonne.
  entete(titres = null) {
    const t = (Array.isArray(titres) ? titres : this.colonnes.map((c) => c.titre || '')).map((titre) => ({ v: String(titre == null ? '' : titre), type: 'texte' }));
    this.ligneEntete = this.lignes.length;
    return this.ajouterLigne(t, { style: 'entete', hauteur: 24 });
  }
  // Une ligne de titre, fusionnée sur `largeur` colonnes.
  titre(texte, largeur = Math.max(2, this.colonnes.length), { style = 'titre' } = {}) {
    const index = this.lignes.length;
    this.ajouterLigne([{ v: texte, type: 'texte' }], { style, hauteur: style === 'titre' ? 24 : 16 });
    if (largeur > 1) this.fusions.push(`${refCellule(index, 0)}:${refCellule(index, largeur - 1)}`);
    return this;
  }
  // Une ligne « clé : valeur » (clé en gras sur fond clair).
  ligneCle(cle, valeur, type = null) {
    return this.ajouterLigne([{ v: cle, type: 'texte', gras: true, fond: FOND.cle }, type ? { v: valeur, type } : valeur], { style: 'cle' });
  }
  // Une ligne d'état vide (« Aucune demande »), fusionnée sur les colonnes.
  ligneVide(texte) {
    const index = this.lignes.length;
    this.ajouterLigne([{ v: texte, type: 'texte' }], { style: 'muet' });
    const largeur = Math.max(2, this.colonnes.length);
    this.fusions.push(`${refCellule(index, 0)}:${refCellule(index, largeur - 1)}`);
    return this;
  }
  vide() { this.lignes.push({ cellules: [], style: null }); return this; }
  ajouterLigne(valeurs, { style = null, hauteur = null } = {}) {
    const cellules = (Array.isArray(valeurs) ? valeurs : [valeurs]).map((v, i) => normaliserCellule(v, this.colonnes[i]));
    this.lignes.push({ cellules, style, hauteur });
    return this;
  }
  get nombreDeColonnes() {
    return Math.max(this.colonnes.length, ...this.lignes.map((l) => l.cellules.length), 1);
  }
}

// La largeur d'affichage d'une cellule (en caractères), pour dimensionner.
function longueurAffichee(cellule) {
  const { v, type } = cellule;
  if (v == null || v === '') return 0;
  if (type === 'euros') return 12;
  if (type === 'date') return 11;
  if (type === 'dateheure') return 17;
  if (type === 'heure') return 6;
  if (type === 'nombre' || type === 'entier') return String(v).length + 1;
  if (type === 'booleen') return 4;
  return Math.max(...String(v).split('\n').map((l) => l.length));
}

// ---------------------------------------------------------------------------
// Classeur
// ---------------------------------------------------------------------------
class Classeur {
  constructor({ titre = '', auteur = 'Pinlane', date = new Date() } = {}) {
    this.titre = titre;
    this.auteur = auteur;
    this.date = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
    this.feuilles = [];
    this.styles = new Styles();
    this.chaines = [];
    this.indexChaines = new Map();
  }
  ajouterFeuille(nom, options = {}) {
    const feuille = new Feuille(this, nom, options);
    this.feuilles.push(feuille);
    return feuille;
  }
  chaine(texte) {
    const t = String(texte);
    if (!this.indexChaines.has(t)) { this.indexChaines.set(t, this.chaines.length); this.chaines.push(t); }
    return this.indexChaines.get(t);
  }

  // La valeur et l'attribut `t` d'une cellule, ou null si elle reste vide.
  valeurCellule(cellule) {
    const { v, type } = cellule;
    if (v == null || v === '') return null;
    if (type === 'texte') return { t: 's', xmlValeur: `<v>${this.chaine(v)}</v>` };
    if (type === 'booleen') return { t: 's', xmlValeur: `<v>${this.chaine(v ? 'oui' : 'non')}</v>` };
    let n = null;
    if (type === 'nombre' || type === 'entier' || type === 'euros') n = Number(v);
    else if (type === 'date') n = serieDate(v);
    else if (type === 'heure') n = fractionHeure(v);
    else if (type === 'dateheure') n = serieDateHeure(v);
    if (n == null || !Number.isFinite(n)) return { t: 's', xmlValeur: `<v>${this.chaine(String(v))}</v>` };
    // Les montants s'arrondissent au centime ; les dates et heures gardent
    // toute leur précision (arrondir en dessous d'une minute juste la ferait
    // afficher une minute de moins).
    const ecrit = type === 'euros' ? Math.round(n * 100) / 100 : n;
    return { t: '', xmlValeur: `<v>${String(ecrit)}</v>` };
  }
  styleCellule(cellule, style, bande) {
    const { type } = cellule;
    const numerique = ['nombre', 'entier', 'euros', 'date', 'heure', 'dateheure'].includes(type);
    if (style === 'entete') return this.styles.obtenir({ police: POLICE.entete, fond: FOND.entete, bordure: BORDURE.fine, h: cellule.aligner || 'center', v: 'center', wrap: true });
    if (style === 'titre') return this.styles.obtenir({ police: POLICE.titre, v: 'center' });
    if (style === 'sous-titre' || style === 'muet') return this.styles.obtenir({ police: POLICE.muette, v: 'center' });
    const format = FORMATS[type] != null ? FORMATS[type] : FORMATS.general;
    return this.styles.obtenir({
      police: cellule.gras ? POLICE.grasse : (cellule.police != null ? cellule.police : POLICE.normale),
      fond: cellule.fond != null ? cellule.fond : (bande ? FOND.bande : FOND.aucun),
      bordure: BORDURE.fine,
      format,
      h: cellule.aligner || (type === 'texte' || type === 'booleen' ? '' : type === 'heure' || type === 'date' || type === 'dateheure' ? 'center' : 'right'),
      v: 'top',
      wrap: Boolean(cellule.wrap),
    });
  }
  xmlFeuille(feuille, index) {
    const nbCols = feuille.nombreDeColonnes;
    const nbLignes = Math.max(1, feuille.lignes.length);
    const dimension = `A1:${refCellule(nbLignes - 1, nbCols - 1)}`;
    // Largeurs : données, sinon calculées sur le contenu (entre 6 et 60).
    const largeurs = [];
    for (let c = 0; c < nbCols; c += 1) {
      const donnee = feuille.colonnes[c] && Number(feuille.colonnes[c].largeur) > 0 ? Number(feuille.colonnes[c].largeur) : null;
      if (donnee) { largeurs.push(donnee); continue; }
      let max = 0;
      feuille.lignes.forEach((l, i) => {
        const cellule = l.cellules[c];
        if (!cellule || l.style === 'titre' || l.style === 'muet' || l.style === 'sous-titre') return;
        const longueur = longueurAffichee(cellule);
        if (cellule.wrap && i !== feuille.ligneEntete) { max = Math.max(max, Math.min(longueur, 45)); return; }
        max = Math.max(max, longueur);
      });
      largeurs.push(Math.min(60, Math.max(6, Math.round(max * 1.08 + 2))));
    }
    const cols = largeurs.map((w, c) => `<col min="${c + 1}" max="${c + 1}" width="${w}" customWidth="1"/>`).join('');
    let compteDonnees = 0;
    const rows = feuille.lignes.map((ligne, r) => {
      const estDonnee = ligne.style == null && ligne.cellules.length > 0;
      const bande = feuille.options.bandes && estDonnee && (compteDonnees % 2 === 1);
      if (estDonnee) compteDonnees += 1;
      const cells = [];
      const nbCellules = estDonnee && feuille.options.bandes ? Math.max(ligne.cellules.length, feuille.colonnes.length) : ligne.cellules.length;
      for (let c = 0; c < nbCellules; c += 1) {
        const cellule = ligne.cellules[c] || normaliserCellule(null, feuille.colonnes[c]);
        const s = this.styleCellule(cellule, ligne.style, bande);
        const valeur = this.valeurCellule(cellule);
        if (!valeur) { if (s) cells.push(`<c r="${refCellule(r, c)}" s="${s}"/>`); continue; }
        cells.push(`<c r="${refCellule(r, c)}"${s ? ` s="${s}"` : ''}${valeur.t ? ` t="${valeur.t}"` : ''}>${valeur.xmlValeur}</c>`);
      }
      const hauteur = ligne.hauteur ? ` ht="${ligne.hauteur}" customHeight="1"` : '';
      return `<row r="${r + 1}"${hauteur}>${cells.join('')}</row>`;
    }).join('');
    const figer = Math.min(feuille.options.figer || 0, nbLignes - 1);
    const vue = `<sheetView workbookViewId="0"${index === 0 ? ' tabSelected="1"' : ''}${feuille.options.zoom && feuille.options.zoom !== 100 ? ` zoomScale="${feuille.options.zoom}"` : ''}>` +
      (figer > 0 ? `<pane ySplit="${figer}" topLeftCell="A${figer + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${figer + 1}" sqref="A${figer + 1}"/>` : '') +
      '</sheetView>';
    const filtre = feuille.options.filtre && feuille.ligneEntete >= 0 && nbLignes > feuille.ligneEntete + 1
      ? `<autoFilter ref="${refCellule(feuille.ligneEntete, 0)}:${refCellule(nbLignes - 1, nbCols - 1)}"/>`
      : '';
    const fusions = feuille.fusions.length ? `<mergeCells count="${feuille.fusions.length}">${feuille.fusions.map((f) => `<mergeCell ref="${f}"/>`).join('')}</mergeCells>` : '';
    return `${ENTETE_XML}<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
      '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' +
      `<dimension ref="${dimension}"/>` +
      `<sheetViews>${vue}</sheetViews>` +
      '<sheetFormatPr defaultRowHeight="15"/>' +
      `<cols>${cols}</cols>` +
      `<sheetData>${rows}</sheetData>` +
      filtre + fusions +
      '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>' +
      `<pageSetup paperSize="9" orientation="${feuille.options.paysage ? 'landscape' : 'portrait'}" fitToWidth="1" fitToHeight="0"/>` +
      '</worksheet>';
  }
  xmlClasseur() {
    const sheets = this.feuilles.map((f, i) => `<sheet name="${xml(f.nom)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('');
    const noms = this.feuilles.map((f, i) => {
      if (!f.options.filtre || f.ligneEntete < 0 || f.lignes.length <= f.ligneEntete + 1) return '';
      const ref = `'${f.nom.replace(/'/g, "''")}'!$A$${f.ligneEntete + 1}:$${lettreColonne(f.nombreDeColonnes - 1)}$${f.lignes.length}`;
      return `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${xml(ref)}</definedName>`;
    }).join('');
    return `${ENTETE_XML}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
      '<workbookPr date1904="0"/>' +
      '<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="16000" activeTab="0"/></bookViews>' +
      `<sheets>${sheets}</sheets>` +
      (noms ? `<definedNames>${noms}</definedNames>` : '') +
      '<calcPr calcId="0"/>' +
      '</workbook>';
  }
  xmlChaines() {
    const items = this.chaines.map((t) => `<si><t xml:space="preserve">${xml(t)}</t></si>`).join('');
    return `${ENTETE_XML}<sst xmlns="${NS_MAIN}" count="${this.chaines.length}" uniqueCount="${this.chaines.length}">${items}</sst>`;
  }
  versBuffer() {
    if (!this.feuilles.length) this.ajouterFeuille('Feuille 1');
    const feuillesXml = this.feuilles.map((f, i) => this.xmlFeuille(f, i)); // remplit les styles et les chaînes
    const n = this.feuilles.length;
    const quand = this.date.toISOString().replace(/\.\d{3}Z$/, 'Z');
    const contentTypes = `${ENTETE_XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      this.feuilles.map((f, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
      '</Types>';
    const rels = `${ENTETE_XML}<Relationships xmlns="${NS_PKG_REL}">` +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
      '</Relationships>';
    const relsClasseur = `${ENTETE_XML}<Relationships xmlns="${NS_PKG_REL}">` +
      this.feuilles.map((f, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
      `<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      `<Relationship Id="rId${n + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>` +
      '</Relationships>';
    const core = `${ENTETE_XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
      `<dc:title>${xml(this.titre)}</dc:title><dc:creator>${xml(this.auteur)}</dc:creator><cp:lastModifiedBy>${xml(this.auteur)}</cp:lastModifiedBy>` +
      `<dcterms:created xsi:type="dcterms:W3CDTF">${quand}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${quand}</dcterms:modified>` +
      '</cp:coreProperties>';
    const app = `${ENTETE_XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Pinlane</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>1.0</AppVersion></Properties>`;
    const entrees = [
      { nom: '[Content_Types].xml', donnees: contentTypes },
      { nom: '_rels/.rels', donnees: rels },
      { nom: 'docProps/core.xml', donnees: core },
      { nom: 'docProps/app.xml', donnees: app },
      { nom: 'xl/workbook.xml', donnees: this.xmlClasseur() },
      { nom: 'xl/_rels/workbook.xml.rels', donnees: relsClasseur },
      { nom: 'xl/styles.xml', donnees: this.styles.xmlStyles() },
      { nom: 'xl/sharedStrings.xml', donnees: this.xmlChaines() },
      ...feuillesXml.map((x, i) => ({ nom: `xl/worksheets/sheet${i + 1}.xml`, donnees: x })),
    ];
    return ecrireZip(entrees, { date: this.date });
  }
}

module.exports = {
  Classeur,
  Feuille,
  FOND,
  POLICE,
  TYPES,
  ecrireZip,
  lireZip,
  crc32,
  xml,
  lettreColonne,
  refCellule,
  nomDeFeuille,
  serieDate,
  serieDateHeure,
  fractionHeure,
};

'use strict';
// UN ÉCRIVAIN PDF 1.4 MINIMAL, SANS DÉPENDANCE (2026-10-05).
//
// Ce dépôt n'a que deux dépendances d'exécution (pg, @vercel/functions) et n'en
// veut pas une troisième pour imprimer une feuille. Ce module écrit donc un PDF
// à la main : pages A4 (portrait ou paysage), traits, rectangles (contour et
// fond, en niveaux de gris), texte dans les polices standard Helvetica et
// Helvetica-Bold (toujours présentes dans un lecteur PDF, rien à embarquer),
// flux de contenu compressés en zlib, table xref exacte.
//
// Le texte est encodé en WinAnsiEncoding (cp1252) : les accents français
// (é è ê à ç ô û ù ë ï), les guillemets « » et le signe € (code 0x80) sortent
// tels quels. Un caractère hors de cette table est ramené à sa base sans
// accent quand c'est possible, sinon à « ? » : jamais de glyphe manquant.
//
// Les largeurs des glyphes sont celles des fichiers AFM Adobe (Core 14), en
// millièmes d'em : on sait donc mesurer un texte avant de l'écrire, le tronquer
// avec « … » pour qu'il tienne dans une case, ou le couper en lignes.
//
// Repère : les coordonnées de l'API sont en MILLIMÈTRES depuis le coin
// SUPÉRIEUR GAUCHE de la page (comme on dessine une grille sur papier) ; la
// conversion vers le repère PDF (points, origine en bas à gauche) est interne.

const zlib = require('zlib');

const MM = 72 / 25.4; // un millimètre en points PDF
const FORMATS = { A4: { largeur: 210, hauteur: 297 } };
const POLICES = { normale: 'Helvetica', grasse: 'Helvetica-Bold' };
const ELLIPSE = '…';

// ---------------------------------------------------------------------------
// WinAnsiEncoding : nom de glyphe par code (32..255), puis largeurs AFM.
// ---------------------------------------------------------------------------
const NOMS_ASCII = 'space exclam quotedbl numbersign dollar percent ampersand quotesingle parenleft parenright asterisk plus comma hyphen period slash zero one two three four five six seven eight nine colon semicolon less equal greater question at A B C D E F G H I J K L M N O P Q R S T U V W X Y Z bracketleft backslash bracketright asciicircum underscore grave a b c d e f g h i j k l m n o p q r s t u v w x y z braceleft bar braceright asciitilde'.split(' ');
const NOMS_HAUTS = {
  128: 'Euro', 130: 'quotesinglbase', 131: 'florin', 132: 'quotedblbase', 133: 'ellipsis', 134: 'dagger', 135: 'daggerdbl', 136: 'circumflex', 137: 'perthousand', 138: 'Scaron', 139: 'guilsinglleft', 140: 'OE', 142: 'Zcaron',
  145: 'quoteleft', 146: 'quoteright', 147: 'quotedblleft', 148: 'quotedblright', 149: 'bullet', 150: 'endash', 151: 'emdash', 152: 'tilde', 153: 'trademark', 154: 'scaron', 155: 'guilsinglright', 156: 'oe', 158: 'zcaron', 159: 'Ydieresis',
  160: 'space', 161: 'exclamdown', 162: 'cent', 163: 'sterling', 164: 'currency', 165: 'yen', 166: 'brokenbar', 167: 'section', 168: 'dieresis', 169: 'copyright', 170: 'ordfeminine', 171: 'guillemotleft', 172: 'logicalnot', 173: 'hyphen', 174: 'registered', 175: 'macron',
  176: 'degree', 177: 'plusminus', 178: 'twosuperior', 179: 'threesuperior', 180: 'acute', 181: 'mu', 182: 'paragraph', 183: 'periodcentered', 184: 'cedilla', 185: 'onesuperior', 186: 'ordmasculine', 187: 'guillemotright', 188: 'onequarter', 189: 'onehalf', 190: 'threequarters', 191: 'questiondown',
  192: 'Agrave', 193: 'Aacute', 194: 'Acircumflex', 195: 'Atilde', 196: 'Adieresis', 197: 'Aring', 198: 'AE', 199: 'Ccedilla', 200: 'Egrave', 201: 'Eacute', 202: 'Ecircumflex', 203: 'Edieresis', 204: 'Igrave', 205: 'Iacute', 206: 'Icircumflex', 207: 'Idieresis',
  208: 'Eth', 209: 'Ntilde', 210: 'Ograve', 211: 'Oacute', 212: 'Ocircumflex', 213: 'Otilde', 214: 'Odieresis', 215: 'multiply', 216: 'Oslash', 217: 'Ugrave', 218: 'Uacute', 219: 'Ucircumflex', 220: 'Udieresis', 221: 'Yacute', 222: 'Thorn', 223: 'germandbls',
  224: 'agrave', 225: 'aacute', 226: 'acircumflex', 227: 'atilde', 228: 'adieresis', 229: 'aring', 230: 'ae', 231: 'ccedilla', 232: 'egrave', 233: 'eacute', 234: 'ecircumflex', 235: 'edieresis', 236: 'igrave', 237: 'iacute', 238: 'icircumflex', 239: 'idieresis',
  240: 'eth', 241: 'ntilde', 242: 'ograve', 243: 'oacute', 244: 'ocircumflex', 245: 'otilde', 246: 'odieresis', 247: 'divide', 248: 'oslash', 249: 'ugrave', 250: 'uacute', 251: 'ucircumflex', 252: 'udieresis', 253: 'yacute', 254: 'thorn', 255: 'ydieresis',
};
function nomDuCode(code) {
  if (code >= 32 && code <= 126) return NOMS_ASCII[code - 32];
  return NOMS_HAUTS[code] || '';
}

// Largeurs AFM (Adobe Core 14) par nom de glyphe, millièmes d'em.
// Les groupes « a b c:556 » se lisent : chaque nom vaut la largeur donnée.
function tableLargeurs(spec) {
  const table = {};
  for (const groupe of spec.split(';')) {
    const [noms, largeur] = groupe.split(':');
    for (const nom of noms.trim().split(/\s+/)) if (nom) table[nom] = Number(largeur);
  }
  return table;
}
const LARGEURS = {
  Helvetica: tableLargeurs(
    'space exclam comma period slash colon semicolon I i j l igrave iacute icircumflex idieresis Igrave Iacute Icircumflex Idieresis f t periodcentered:278;' +
    'quotedbl:355; numbersign dollar zero one two three four five six seven eight nine question underscore a b d e g h n o p q u Euro florin cent sterling currency yen section dagger daggerdbl endash mu agrave aacute acircumflex atilde adieresis aring egrave eacute ecircumflex edieresis eth ntilde ograve oacute ocircumflex otilde odieresis ugrave uacute ucircumflex udieresis thorn guillemotleft guillemotright:556;' +
    'percent:889; ampersand A B E K X Y Agrave Aacute Acircumflex Atilde Adieresis Aring Egrave Eacute Ecircumflex Edieresis P S V Thorn Yacute Ydieresis Scaron:667;' +
    'quotesingle:191; parenleft parenright hyphen r grave circumflex tilde acute dieresis macron cedilla guilsinglleft guilsinglright quotedblleft quotedblright quotedblbase onesuperior twosuperior threesuperior exclamdown:333;' +
    'asterisk:389; plus less equal greater asciitilde multiply divide plusminus logicalnot:584;' +
    'at:1015; C D H N R U Ccedilla Ntilde Ugrave Uacute Ucircumflex Udieresis Eth:722; F T Z Zcaron questiondown germandbls oslash:611; G O Q Ograve Oacute Ocircumflex Otilde Odieresis Oslash:778;' +
    'J c k s v x y z ccedilla yacute ydieresis scaron zcaron:500; L:556; M m:833; W:944;' +
    'bracketleft backslash bracketright:278; asciicircum:469; w:722; braceleft braceright:334; bar brokenbar:260;' +
    'quotesinglbase quoteleft quoteright:222; ellipsis perthousand emdash trademark AE OE:1000; bullet:350;' +
    'copyright registered:737; ordfeminine:370; ordmasculine:365; degree:400; paragraph:537; onequarter onehalf threequarters:834; ae:889; oe:944',
  ),
  'Helvetica-Bold': tableLargeurs(
    'space comma period slash I i j l igrave iacute icircumflex idieresis Igrave Iacute Icircumflex Idieresis backslash periodcentered:278;' +
    'exclam colon semicolon parenleft parenright hyphen f t bracketleft bracketright grave circumflex tilde acute dieresis macron cedilla guilsinglleft guilsinglright onesuperior twosuperior threesuperior exclamdown:333;' +
    'quotedbl:474; numbersign dollar zero one two three four five six seven eight nine underscore a c e Euro florin cent sterling currency yen section dagger daggerdbl endash agrave aacute acircumflex atilde adieresis aring ccedilla egrave eacute ecircumflex edieresis guillemotleft guillemotright paragraph s v x y yacute ydieresis scaron:556;' +
    'percent:889; ampersand A B C D H K N R U Agrave Aacute Acircumflex Atilde Adieresis Aring Ccedilla Ntilde Ugrave Uacute Ucircumflex Udieresis Eth:722;' +
    'quotesingle:238; asterisk braceleft braceright r:389; plus less equal greater asciitilde asciicircum multiply divide plusminus logicalnot:584;' +
    'question F T Z L b d g h n o p q u mu Zcaron germandbls oslash questiondown ntilde ograve oacute ocircumflex otilde odieresis ugrave uacute ucircumflex udieresis thorn eth:611;' +
    'at:975; E P S V Thorn X Y Yacute Ydieresis Scaron Egrave Eacute Ecircumflex Edieresis:667; G O Q Ograve Oacute Ocircumflex Otilde Odieresis Oslash:778;' +
    'J k:556; M:833; m:889; W:944; w:778; z zcaron:500; bar brokenbar:280;' +
    'quotesinglbase quoteleft quoteright:278; quotedblleft quotedblright quotedblbase:500; ellipsis perthousand emdash trademark AE OE:1000; bullet:350;' +
    'copyright registered:737; ordfeminine:370; ordmasculine:365; degree:400; onequarter onehalf threequarters:834; ae:889; oe:944',
  ),
};
// Largeur d'un code WinAnsi, par police (code inconnu : la largeur de « ? »).
const LARGEURS_PAR_CODE = {};
for (const police of Object.keys(LARGEURS)) {
  const table = new Array(256).fill(0);
  for (let code = 32; code < 256; code += 1) {
    const nom = nomDuCode(code);
    table[code] = nom && LARGEURS[police][nom] != null ? LARGEURS[police][nom] : LARGEURS[police].question;
  }
  LARGEURS_PAR_CODE[police] = table;
}

// ---------------------------------------------------------------------------
// Encodage WinAnsi (cp1252)
// ---------------------------------------------------------------------------
const SPECIAUX = {
  0x20AC: 128, 0x201A: 130, 0x0192: 131, 0x201E: 132, 0x2026: 133, 0x2020: 134, 0x2021: 135, 0x02C6: 136, 0x2030: 137, 0x0160: 138, 0x2039: 139, 0x0152: 140, 0x017D: 142,
  0x2018: 145, 0x2019: 146, 0x201C: 147, 0x201D: 148, 0x2022: 149, 0x2013: 150, 0x2014: 151, 0x02DC: 152, 0x2122: 153, 0x0161: 154, 0x203A: 155, 0x0153: 156, 0x017E: 158, 0x0178: 159,
  0x2009: 32, 0x200A: 32, 0x202F: 32, 0x2007: 32, 0x2008: 32, 0x3000: 32, 0x2010: 45, 0x2011: 45, 0x2212: 45, 0x2032: 39, 0x2033: 34,
};
function codeWinAnsi(cp) {
  if (cp >= 32 && cp <= 126) return cp;
  if (cp >= 160 && cp <= 255) return cp;
  if (SPECIAUX[cp] != null) return SPECIAUX[cp];
  if (cp === 9) return 32;
  if (cp < 32) return -1; // caractère de contrôle : ignoré
  // Hors table : la lettre de base sans son accent (ő -> o), sinon « ? ».
  const base = String.fromCodePoint(cp).normalize('NFKD').replace(/[̀-ͯ]/g, '');
  if (base.length === 1 && base.codePointAt(0) !== cp) return codeWinAnsi(base.codePointAt(0));
  return 63;
}
// Le texte en octets WinAnsi (Buffer). Les sauts de ligne deviennent des
// espaces : une ligne de texte est une ligne.
function encoderWinAnsi(texte) {
  const octets = [];
  for (const caractere of String(texte == null ? '' : texte).replace(/\r?\n/g, ' ')) {
    const code = codeWinAnsi(caractere.codePointAt(0));
    if (code >= 0) octets.push(code);
  }
  return Buffer.from(octets);
}

// ---------------------------------------------------------------------------
// Mesure, troncature, coupe en lignes (toutes en millimètres)
// ---------------------------------------------------------------------------
function nomPolice(police) {
  if (police === 'bold' || police === 'grasse' || police === POLICES.grasse) return POLICES.grasse;
  return POLICES.normale;
}
function largeurOctets(octets, police, taille) {
  const table = LARGEURS_PAR_CODE[nomPolice(police)];
  let total = 0;
  for (const code of octets) total += table[code];
  return (total / 1000) * taille / MM;
}
// La largeur d'un texte, en mm, dans la police et la taille (points) données.
function largeurTexte(texte, police = POLICES.normale, taille = 9) {
  return largeurOctets(encoderWinAnsi(texte), police, taille);
}
// Le texte tel qu'il tient dans `maxMm` : intact s'il tient, sinon tronqué et
// terminé par « … ». Un texte qui ne tient même pas avec un caractère rend
// « … » seul (ou vide si l'ellipse ne tient pas).
function ajusterTexte(texte, police, taille, maxMm) {
  const propre = String(texte == null ? '' : texte).replace(/\r?\n/g, ' ');
  if (!(maxMm > 0)) return '';
  if (largeurTexte(propre, police, taille) <= maxMm) return propre;
  const ellipse = largeurTexte(ELLIPSE, police, taille);
  if (ellipse > maxMm) return '';
  const caracteres = [...propre];
  let bas = 0;
  let haut = caracteres.length;
  while (bas < haut) {
    const milieu = Math.ceil((bas + haut) / 2);
    const essai = caracteres.slice(0, milieu).join('').replace(/\s+$/, '');
    if (largeurTexte(essai, police, taille) + ellipse <= maxMm) bas = milieu; else haut = milieu - 1;
  }
  return `${caracteres.slice(0, bas).join('').replace(/\s+$/, '')}${ELLIPSE}`;
}
// Le texte coupé en lignes de `maxMm` au plus : sur les espaces, et au milieu
// d'un mot trop long pour une ligne. Les sauts de ligne du texte sont
// respectés. Rend toujours au moins une ligne (vide).
function couperTexte(texte, police, taille, maxMm) {
  const lignes = [];
  for (const paragraphe of String(texte == null ? '' : texte).replace(/\r\n?/g, '\n').split('\n')) {
    const mots = paragraphe.split(/[ \t]+/).filter((m) => m.length);
    if (!mots.length) { lignes.push(''); continue; }
    let courante = '';
    const pousserMot = (mot) => {
      if (largeurTexte(mot, police, taille) <= maxMm) { courante = mot; return; }
      // Mot plus long qu'une ligne : coupé caractère par caractère.
      let morceau = '';
      for (const c of mot) {
        if (largeurTexte(morceau + c, police, taille) > maxMm && morceau) { lignes.push(morceau); morceau = ''; }
        morceau += c;
      }
      courante = morceau;
    };
    for (const mot of mots) {
      const essai = courante ? `${courante} ${mot}` : mot;
      if (largeurTexte(essai, police, taille) <= maxMm) courante = essai;
      else { if (courante) lignes.push(courante); pousserMot(mot); }
    }
    lignes.push(courante);
  }
  return lignes.length ? lignes : [''];
}

// ---------------------------------------------------------------------------
// Sérialisation
// ---------------------------------------------------------------------------
function nombre(n) {
  const v = Math.round(Number(n) * 1000) / 1000;
  return Object.is(v, -0) ? '0' : String(v);
}
// Une chaîne PDF littérale depuis des octets : parenthèses et antislash
// échappés, tout octet hors ASCII imprimable en octal.
function chainePdf(octets) {
  let out = '(';
  for (const code of octets) {
    if (code === 0x28 || code === 0x29 || code === 0x5C) out += `\\${String.fromCharCode(code)}`;
    else if (code < 32 || code > 126) out += `\\${code.toString(8).padStart(3, '0')}`;
    else out += String.fromCharCode(code);
  }
  return `${out})`;
}
// Une chaîne du dictionnaire Info (titre, auteur) : UTF-16BE avec BOM, en
// hexadécimal, pour que les accents passent quel que soit le lecteur.
function chaineInfo(texte) {
  const bom = Buffer.from([0xFE, 0xFF]);
  const corps = Buffer.from(String(texte || ''), 'utf16le').swap16();
  return `<${Buffer.concat([bom, corps]).toString('hex').toUpperCase()}>`;
}
function dateInfo(date) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `(D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z)`;
}

class PdfPage {
  constructor(document, { format = 'A4', orientation = 'portrait' } = {}) {
    const dims = FORMATS[format] || FORMATS.A4;
    const paysage = orientation === 'landscape' || orientation === 'paysage';
    this.document = document;
    this.largeur = paysage ? dims.hauteur : dims.largeur; // mm
    this.hauteur = paysage ? dims.largeur : dims.hauteur; // mm
    this.ops = [];
    this.policesUtilisees = new Set();
  }
  x(mm) { return nombre(mm * MM); }
  y(mm) { return nombre((this.hauteur - mm) * MM); }

  // Un trait de (x1,y1) à (x2,y2). `epaisseur` en mm, `gris` 0 (noir) à 1 (blanc).
  ligne(x1, y1, x2, y2, { epaisseur = 0.2, gris = 0 } = {}) {
    this.ops.push(`q ${nombre(epaisseur * MM)} w ${nombre(gris)} G 2 J ${this.x(x1)} ${this.y(y1)} m ${this.x(x2)} ${this.y(y2)} l S Q`);
    return this;
  }
  // Un rectangle au coin supérieur gauche (x,y), largeur l, hauteur h.
  // `fond` : gris du fond (null = pas de fond) ; `contour` : gris du trait
  // (null = pas de contour).
  rectangle(x, y, l, h, { fond = null, contour = null, epaisseur = 0.2 } = {}) {
    if (fond == null && contour == null) return this;
    const parts = ['q'];
    if (fond != null) parts.push(`${nombre(fond)} g`);
    if (contour != null) parts.push(`${nombre(contour)} G ${nombre(epaisseur * MM)} w`);
    parts.push(`${this.x(x)} ${this.y(y + h)} ${nombre(l * MM)} ${nombre(h * MM)} re`);
    parts.push(fond != null && contour != null ? 'B' : fond != null ? 'f' : 'S');
    parts.push('Q');
    this.ops.push(parts.join(' '));
    return this;
  }
  // Une ligne de texte dont la LIGNE DE BASE commence en (x,y). `aligner` :
  // left | center | right (x est alors le centre ou le bord droit).
  // `maxLargeur` : le texte est tronqué avec « … » pour y tenir.
  // Rend la largeur écrite, en mm.
  texte(contenu, x, y, { police = POLICES.normale, taille = 9, gris = 0, aligner = 'left', maxLargeur = null } = {}) {
    const nom = nomPolice(police);
    const propre = maxLargeur != null ? ajusterTexte(contenu, nom, taille, maxLargeur) : String(contenu == null ? '' : contenu);
    const octets = encoderWinAnsi(propre);
    if (!octets.length) return 0;
    const largeur = largeurOctets(octets, nom, taille);
    let x0 = x;
    if (aligner === 'center' || aligner === 'centre') x0 = x - largeur / 2;
    else if (aligner === 'right' || aligner === 'droite') x0 = x - largeur;
    const ref = nom === POLICES.grasse ? 'F2' : 'F1';
    this.policesUtilisees.add(ref);
    this.ops.push(`BT /${ref} ${nombre(taille)} Tf ${nombre(gris)} g ${this.x(x0)} ${this.y(y)} Td ${chainePdf(octets)} Tj ET`);
    return largeur;
  }
  // Une ligne de texte centrée verticalement dans la boîte (x,y,l,h), avec une
  // marge intérieure, tronquée pour tenir. La ligne de base est posée pour que
  // les capitales soient au milieu de la boîte (hauteur de capitale ~0,72 em).
  texteDansBoite(contenu, x, y, l, h, options = {}) {
    const { marge = 1, aligner = 'left', taille = 9 } = options;
    const utile = Math.max(0, l - 2 * marge);
    const base = y + h / 2 + (0.36 * taille) / MM;
    const ancre = aligner === 'center' || aligner === 'centre' ? x + l / 2 : aligner === 'right' || aligner === 'droite' ? x + l - marge : x + marge;
    return this.texte(contenu, ancre, base, { ...options, aligner, taille, maxLargeur: utile });
  }
  // Plusieurs lignes (déjà coupées) à partir de la ligne de base y, espacées
  // de `interligne` mm. Rend la hauteur occupée.
  lignesTexte(lignes, x, y, { interligne = 3.5, ...options } = {}) {
    let i = 0;
    for (const ligne of lignes) { this.texte(ligne, x, y + i * interligne, options); i += 1; }
    return lignes.length * interligne;
  }
  contenu() { return this.ops.join('\n'); }
}

class PdfDocument {
  constructor({ titre = '', auteur = '', sujet = '', createur = 'Pinlane', date = new Date() } = {}) {
    this.info = { titre, auteur, sujet, createur, date };
    this.pages = [];
  }
  ajouterPage(options = {}) {
    const page = new PdfPage(this, options);
    this.pages.push(page);
    return page;
  }
  get nombreDePages() { return this.pages.length; }

  versBuffer() {
    const objets = []; // objets[i] = Buffer du corps de l'objet i+1
    const ajouter = (corps) => { objets.push(Buffer.isBuffer(corps) ? corps : Buffer.from(corps, 'latin1')); return objets.length; };
    const CATALOGUE = 1; const PAGES = 2; const F1 = 3; const F2 = 4; const INFO = 5;
    objets.length = 5;
    const refsPages = [];
    for (const page of this.pages) {
      const flux = zlib.deflateSync(Buffer.from(page.contenu(), 'latin1'));
      const numContenu = ajouter(Buffer.concat([
        Buffer.from(`<< /Length ${flux.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'),
        flux,
        Buffer.from('\nendstream', 'latin1'),
      ]));
      const numPage = ajouter(
        `<< /Type /Page /Parent ${PAGES} 0 R /MediaBox [0 0 ${nombre(page.largeur * MM)} ${nombre(page.hauteur * MM)}] ` +
        `/Resources << /Font << /F1 ${F1} 0 R /F2 ${F2} 0 R >> /ProcSet [/PDF /Text] >> /Contents ${numContenu} 0 R >>`,
      );
      refsPages.push(`${numPage} 0 R`);
    }
    objets[CATALOGUE - 1] = Buffer.from(`<< /Type /Catalog /Pages ${PAGES} 0 R >>`, 'latin1');
    objets[PAGES - 1] = Buffer.from(`<< /Type /Pages /Kids [${refsPages.join(' ')}] /Count ${refsPages.length} >>`, 'latin1');
    objets[F1 - 1] = Buffer.from(`<< /Type /Font /Subtype /Type1 /BaseFont /${POLICES.normale} /Encoding /WinAnsiEncoding >>`, 'latin1');
    objets[F2 - 1] = Buffer.from(`<< /Type /Font /Subtype /Type1 /BaseFont /${POLICES.grasse} /Encoding /WinAnsiEncoding >>`, 'latin1');
    objets[INFO - 1] = Buffer.from(
      `<< /Title ${chaineInfo(this.info.titre)} /Author ${chaineInfo(this.info.auteur)} /Subject ${chaineInfo(this.info.sujet)} ` +
      `/Creator ${chaineInfo(this.info.createur)} /Producer ${chaineInfo('Pinlane pdf-writer')} /CreationDate ${dateInfo(this.info.date)} /ModDate ${dateInfo(this.info.date)} >>`,
      'latin1',
    );

    const morceaux = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
    let position = morceaux[0].length;
    const offsets = [];
    objets.forEach((corps, index) => {
      offsets.push(position);
      const entete = Buffer.from(`${index + 1} 0 obj\n`, 'latin1');
      const fin = Buffer.from('\nendobj\n', 'latin1');
      morceaux.push(entete, corps, fin);
      position += entete.length + corps.length + fin.length;
    });
    const xref = [`xref\n0 ${objets.length + 1}\n0000000000 65535 f \n`];
    for (const offset of offsets) xref.push(`${String(offset).padStart(10, '0')} 00000 n \n`);
    xref.push(`trailer\n<< /Size ${objets.length + 1} /Root ${CATALOGUE} 0 R /Info ${INFO} 0 R >>\nstartxref\n${position}\n%%EOF\n`);
    morceaux.push(Buffer.from(xref.join(''), 'latin1'));
    return Buffer.concat(morceaux);
  }
}

module.exports = {
  PdfDocument,
  PdfPage,
  MM,
  FORMATS,
  POLICES,
  ELLIPSE,
  LARGEURS,
  encoderWinAnsi,
  codeWinAnsi,
  largeurTexte,
  ajusterTexte,
  couperTexte,
};

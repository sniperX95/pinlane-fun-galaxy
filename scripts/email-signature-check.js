#!/usr/bin/env node
// GATE : la signature B2C des mails (lot 2, 2026-11-11).
//
// Ce qu il defend, avec le vrai code (lib/email-design.js et
// lib/ops-communications.js), sans base ni reseau :
//   [A] le catalogue fait le defaut : Fun Galaxy a ses photos (notre domaine,
//       decrites, moins de 100 Ko, 600 px de large), sa formule, sa forme et
//       sa couleur ; un centre sans catalogue n en a aucune. « À très bientôt »
//       n est ni proposee ni donnee par defaut.
//   [B] chaque forme (carte avec photo, carte avec logo, bandeau, une ligne)
//       rend un mail automatique de 2 liens et 1 image au plus, la formule
//       imprimee, l equipe, les reseaux nommes en texte, et le trait ou
//       l aplat dans la couleur du centre.
//   [C] le budget tient quand le reste du mail prend deja un lien (un bouton)
//       ou une image (un logo d en-tete) ; un mail manuel garde ses liens.
//   [D] l apercu de la page Apparence est le mail envoye : meme HTML que la
//       sequence, et que le test reellement enfile.
//   [E] chaque centre ses couleurs et ses photos : un autre centre ne recoit
//       jamais celles de Fun Galaxy, une photo d un autre centre ou d un autre
//       domaine est refusee.
//   [F] l ancienne formule enregistree retombe sur celle du centre.
//   [G] la formule en couleur se lit (3:1 au moins), sinon elle passe a l encre.
//   [H] le corps signe deja (lot 2b) : un corps fini par une formule (« Bien à
//       vous, »), suivie ou non de qui signe (« L'équipe X »), garde son texte
//       entier ; la signature retire sa formule, et son equipe quand le corps
//       l a ecrite, et garde la photo, les coordonnees et le trait. Une
//       formule au milieu du corps ne compte pas. Meme regle pour la version
//       texte et sur chaque chemin : composeur, reponse Reçus, sequence,
//       campagne, Apercu.
//   [I] la version texte envoyee (2026-11-12) : sendEmail envoie le texte
//       puis la signature (texteEnvoye) quand le HTML est signe, la ligne de
//       retrait restant la derniere ; textBody garde le texte de l auteur ; la
//       formule n est pas doublee ; les interrupteurs (ligne eteinte,
//       signature coupee, case decochee, portee) sont suivis.
//   [J] les signatures d enseigne (2026-11-12) : Fun Galaxy signe en affiche
//       (la banniere de sa photo, son accroche) ; affiche, arene et enseigne
//       tiennent 2 liens et 1 image, posent le vrai logo sans fond (jamais le
//       logo a carre), ne posent pas d image quand l en-tete l a prise, et ne
//       donnent rien de Fun Galaxy a un autre centre.
//   [K] le mode sombre et les designs d avant l affiche (2026-11-12) : les
//       logos sans fond de l arene et de l enseigne ont un contour de la
//       couleur du fond qu ils bordent (lisibles quand Gmail sur iPhone
//       inverse tout, ou quand Outlook et Gmail Android assombrissent le
//       blanc) ; un design enregistre avant l affiche (carte et site
//       pre-remplis, celui de Libramont le 03/11) se lit en affiche avec le
//       site du centre, une carte enregistree depuis reste une carte.
//   [L] l apercu d Apparence de la capture d Ansar (2026-11-12) : le design
//       enregistre le 03/11 (encre pre-remplie) prend la couleur du centre ;
//       la note du mail se lit avant la signature ; la banniere suit la
//       largeur du mail meme bloquee ; les photos et logos des mails se
//       laissent afficher hors du site (Cross-Origin-Resource-Policy).
//   [M] la galerie de gabarits (2026-11-12) : deux liens et une image au plus sur
//       un mail automatique, les grands formats de campagne jamais dessus, la
//       photo de l activite prise dans la fiche du centre.
//   [N] ce que Gmail et Outlook lisent (2026-11-12) : les douze gabarits sur les
//       vrais mails de la reservation, a Libramont et a Gembloux, sous 60 Ko,
//       chaque image avec sa largeur et sa description, aucun CSS qu Outlook ne
//       lit pas, aucun mot de promotion dans un mail automatique ; le test
//       d Apparence part avec la vraie version texte du mail (section [D]).
//   [mutation] contre-preuves : chaque garde, retiree, fait rougir ce gate.
'use strict';

const path = require('path');
const fs = require('fs');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
const LF = String.fromCharCode(10);
process.env.PUBLIC_APP_ORIGIN = 'https://app.pinlane.be';

let failures = 0;
let resultats = null;
function ok(cond, label, detail = '') {
  if (resultats) { resultats.set(label, Boolean(cond)); return; }
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures += 1;
}

// ---------------------------------------------------------------------------
// Base factice : les reglages d un centre, et rien d autre.
// ---------------------------------------------------------------------------
const REGLAGES = new Map();
async function requete(texte, params = []) {
  const sql = String(texte).replace(/\s+/g, ' ').trim();
  const p = params || [];
  if (/^select settings from center_automation_settings where center_id = \$1/i.test(sql)) {
    return { rows: REGLAGES.has(p[0]) ? [{ settings: JSON.parse(JSON.stringify(REGLAGES.get(p[0]))) }] : [], rowCount: 0 };
  }
  // Le message recu auquel la reponse Reçus repond (section [H]).
  if (/^select payload, message_id, references_ids, thread_id, subject from communications where id = \$1/i.test(sql)) {
    return { rows: p[0] === 77 ? [{ payload: {}, message_id: '<question-77@exemple.be>', references_ids: '', thread_id: null, subject: 'Une piste samedi ?' }] : [], rowCount: 0 };
  }
  return { rows: [], rowCount: 0 };
}
class FakePool {
  async query(texte, params) { return requete(texte, params); }
  async connect() { return { query: (texte, params) => requete(texte, params), release() {} }; }
  on() {}
  async end() {}
}
const pgResolu = require.resolve('pg', { paths: [ROOT] });
require.cache[pgResolu] = { id: pgResolu, filename: pgResolu, loaded: true, exports: { Pool: FakePool } };
global.fetch = async () => { throw new Error('reseau interdit dans ce gate'); };
const deps = { query: requete };

// ---------------------------------------------------------------------------
// Mutations compilees en memoire (aucun fichier touche).
// ---------------------------------------------------------------------------
const MUTABLES = ['lib/email-gabarits.js', 'lib/email-design.js', 'lib/ops-communications.js'];
let mutations = [];
const compileOrigine = Module.prototype._compile;
Module.prototype._compile = function compileMute(contenu, nom) {
  const rel = path.relative(ROOT, nom).split(path.sep).join('/');
  const editions = mutations.filter((e) => e.fichier === rel);
  if (!editions.length) return compileOrigine.call(this, contenu, nom);
  let mute = contenu.split(CRLF).join(LF);
  for (const { de, vers } of editions) {
    if (mute.split(de).length - 1 !== 1) throw new Error(`ancre absente ou multiple dans ${rel} : ${de.slice(0, 80)}`);
    mute = mute.split(de).join(vers);
  }
  return compileOrigine.call(this, mute, nom);
};
function charger() {
  for (const rel of MUTABLES) delete require.cache[require.resolve(path.join(ROOT, rel))];
  return { design: require(path.join(ROOT, 'lib/email-design.js')), comms: require(path.join(ROOT, 'lib/ops-communications.js')) };
}

const { getCenter } = require(path.join(ROOT, 'lib/ops-knowledge.js'));
const LIBRAMONT = getCenter('libramont');
const ACCENT_FG = String(LIBRAMONT.branding.accent || '').toLowerCase();
const CATALOGUE_FG = (LIBRAMONT.branding.emailDesign && LIBRAMONT.branding.emailDesign.signature) || {};
const CENTRE_NU = { id: 'nu', name: 'Centre Nu', publicInfo: {}, branding: {} };
// Un deuxieme client fictif, avec SA couleur et sans photo.
const AUTRE = { id: 'autre', name: 'Bowling des Tilleuls', publicInfo: { phone: '081 22 33 44', email: 'accueil@tilleuls.example', address: 'Rue des Tilleuls 3, 5000 Namur' }, branding: { accent: '#0f6b4f' } };
// Un centre a la couleur claire : la formule ne peut pas s ecrire dedans.
const CLAIR = { id: 'clair', name: 'Jaune Bowling', publicInfo: {}, branding: { accent: '#e3d341' } };
const liens = (html) => (String(html).match(/<a\s/gi) || []).length;
const images = (html) => (String(html).match(/<img\s/gi) || []).length;
const echapper = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const RESEAUX = { facebook: 'https://www.facebook.com/exemple', instagram: 'https://www.instagram.com/exemple', tiktok: '', linkedin: '' };
const KEVIN = { id: 'libramont:kevin', name: 'Kevin Dupont', role: 'Direction', contact: 'kevin@fungalaxy.be' };

function largeurImage(fichier) {
  const b = fs.readFileSync(fichier);
  if (b[0] === 0x89 && b[1] === 0x50) return b.readUInt32BE(16);
  if (b[0] !== 0xff || b[1] !== 0xd8) return 0;
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) { i += 1; continue; }
    const marque = b[i + 1];
    const longueur = b.readUInt16BE(i + 2);
    if (marque >= 0xc0 && marque <= 0xc3) return b.readUInt16BE(i + 7);
    i += 2 + longueur;
  }
  return 0;
}

// Les pixels d un PNG RGBA 8 bits non entrelace (le format des logos sans fond),
// sans dependance. null pour tout autre format : le controle qui le lit rougit.
function pixelsPng(fichier) {
  const b = fs.readFileSync(fichier);
  if (b.length < 33 || b.readUInt32BE(0) !== 0x89504e47) return null;
  let i = 8; let largeur = 0; let hauteur = 0; let type = -1; let profondeur = 0; let entrelace = 1;
  const idat = [];
  while (i + 8 <= b.length) {
    const n = b.readUInt32BE(i);
    const nom = b.toString('latin1', i + 4, i + 8);
    const data = b.subarray(i + 8, i + 8 + n);
    if (nom === 'IHDR') { largeur = data.readUInt32BE(0); hauteur = data.readUInt32BE(4); profondeur = data[8]; type = data[9]; entrelace = data[12]; }
    if (nom === 'IDAT') idat.push(data);
    if (nom === 'IEND') break;
    i += 12 + n;
  }
  if (type !== 6 || profondeur !== 8 || entrelace !== 0) return null;
  const brut = require('zlib').inflateSync(Buffer.concat(idat));
  const ligne = largeur * 4;
  const px = Buffer.alloc(ligne * hauteur);
  for (let y = 0; y < hauteur; y += 1) {
    const filtre = brut[y * (ligne + 1)];
    for (let x = 0; x < ligne; x += 1) {
      const v = brut[y * (ligne + 1) + 1 + x];
      const a = x >= 4 ? px[y * ligne + x - 4] : 0;
      const h = y > 0 ? px[(y - 1) * ligne + x] : 0;
      const c = x >= 4 && y > 0 ? px[(y - 1) * ligne + x - 4] : 0;
      let r = v;
      if (filtre === 1) r = v + a;
      else if (filtre === 2) r = v + h;
      else if (filtre === 3) r = v + ((a + h) >> 1);
      else if (filtre === 4) {
        const p = a + h - c;
        const pa = Math.abs(p - a); const pb = Math.abs(p - h); const pc = Math.abs(p - c);
        r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? h : c);
      }
      px[y * ligne + x] = r & 0xff;
    }
  }
  return { largeur, hauteur, px };
}

// Le contour d un logo sans fond : la part des pixels de son liseré (ni pleins ni
// vides) qui ont la couleur attendue. Sans contour, le liseré est celui des
// lettres (blanc ou fonce) et des courbes de couleur : la part tombe pres de 0.
function partDuLisereEn(fichier, hex) {
  const image = fichier && fs.existsSync(fichier) ? pixelsPng(fichier) : null;
  if (!image) return 0;
  const [r0, g0, b0] = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
  let lisere = 0; let bon = 0;
  for (let k = 0; k < image.px.length; k += 4) {
    const alpha = image.px[k + 3];
    if (alpha < 8 || alpha > 247) continue;
    lisere += 1;
    if (Math.hypot(image.px[k] - r0, image.px[k + 1] - g0, image.px[k + 2] - b0) <= 48) bon += 1;
  }
  return lisere ? bon / lisere : 0;
}

async function controles(m) {
  const defautsFG = m.design.getEmailDesignDefaults(LIBRAMONT);
  const photos = m.design.photosDisponibles(LIBRAMONT);
  const origine = m.design.origineApplication();
  const transactionnel = async (design, { action = null, center = LIBRAMONT, portee = 'sequences', person = null } = {}) => m.comms.emailShell({
    title: 'Votre réservation est confirmée', body: 'Bonjour Marie,\n\nVotre piste est réservée samedi à 15 h.', preheader: 'Votre réservation', center, action,
    design, signature: { enabled: true, person, portee },
  });

  // =====================================================================
  console.log('[A] le catalogue fait le defaut');
  // =====================================================================
  const fichiers = photos.map((p) => path.join(ROOT, p.url.slice(origine.length)));
  ok(photos.length >= 3 && photos.every((p) => p.url.startsWith(`${origine}/assets/mail/`) && p.alt.length >= 12)
    && fichiers.every((f) => fs.existsSync(f) && fs.statSync(f).size < 100 * 1024 && largeurImage(f) === 600),
    '[A] Fun Galaxy : au moins 3 photos sur notre domaine, decrites, de moins de 100 Ko et 600 px de large',
    JSON.stringify(fichiers.map((f) => (fs.existsSync(f) ? `${path.basename(f)} ${fs.statSync(f).size} o ${largeurImage(f)} px` : `${path.basename(f)} absente`))));
  ok(defautsFG.signature.closing === CATALOGUE_FG.closing && defautsFG.signature.layout === CATALOGUE_FG.layout
    && defautsFG.signature.photo.enabled === true && defautsFG.signature.photo.url === `${origine}${CATALOGUE_FG.photo}` && defautsFG.accent.mode === 'centre',
    '[A] Fun Galaxy : formule, forme, photo et couleur par defaut viennent de sa fiche', JSON.stringify({ closing: defautsFG.signature.closing, layout: defautsFG.signature.layout, photo: defautsFG.signature.photo, accent: defautsFG.accent.mode }));
  const defautsNu = m.design.getEmailDesignDefaults(CENTRE_NU);
  ok(m.design.photosDisponibles(CENTRE_NU).length === 0 && defautsNu.signature.photo.enabled === false && defautsNu.accent.mode === 'encre' && Boolean(defautsNu.signature.closing),
    '[A] un centre sans catalogue : ni photo ni couleur, une formule commune');
  const plate = /à\s+très\s+bient[ôo]t/i;
  const tousLesCentres = require(path.join(ROOT, 'ops-knowledge/centers.json')).centers;
  ok(!m.design.FORMULES_DE_FIN.some((f) => plate.test(f)) && tousLesCentres.every((c) => !plate.test(m.design.getEmailDesignDefaults(c).signature.closing)) && !plate.test(defautsNu.signature.closing),
    '[A] « À très bientôt » n est ni proposee ni donnee par defaut, a aucun centre');

  // =====================================================================
  console.log('\n[B] chaque forme, dans un mail automatique');
  // =====================================================================
  const complet = (signature) => ({ ...defautsFG, signature: { ...defautsFG.signature, website: 'https://www.fungalaxy.be', socials: RESEAUX, ...signature } });
  const formes = {
    'carte avec photo': complet({ layout: 'carte' }),
    'carte avec logo': complet({ layout: 'carte', photo: { enabled: false, url: '' } }),
    bandeau: complet({ layout: 'bandeau' }),
    'une ligne': complet({ layout: 'ligne' }),
  };
  const rendus = {};
  for (const [nom, design] of Object.entries(formes)) {
    const html = await transactionnel(design);
    rendus[nom] = html;
    ok(liens(html) <= 2 && images(html) <= 1, `[B] ${nom} : 2 liens et 1 image au plus`, `liens=${liens(html)} images=${images(html)}`);
    ok(html.includes(echapper(design.signature.closing)) && /L&#39;équipe Fun Galaxy Libramont/.test(html) && /Facebook/.test(html) && /Instagram/.test(html),
      `[B] ${nom} : la formule, l equipe et les reseaux nommes en texte`);
  }
  const photoFG = defautsFG.signature.photo.url;
  ok(rendus['carte avec photo'].includes(`src="${photoFG}"`) && /<img src="[^"]+" width="600" alt="[^"]{12,}"/.test(rendus['carte avec photo']) && !/logo-fun-galaxy/.test(rendus['carte avec photo'])
    && rendus['carte avec photo'].includes(`bgcolor="${ACCENT_FG}"`),
    '[B] carte avec photo : la photo du centre (600 px, decrite) a la place du logo, et le trait de sa couleur');
  ok(!rendus['carte avec logo'].includes(photoFG) && /logo-fun-galaxy-email-clair\.png/.test(rendus['carte avec logo']), '[B] carte avec logo : le logo clair, aucune photo');
  // Les logos du catalogue ont un fond plein : sur l aplat de couleur, le nom
  // du centre en grand ; le logo blanc seulement sur l aplat a l encre.
  ok(rendus.bandeau.includes(`<td bgcolor="${ACCENT_FG}" style="padding:20px 22px;`) && /;">Fun Galaxy Libramont<\/p><\/td>/.test(rendus.bandeau) && images(rendus.bandeau) === 0 && !rendus.bandeau.includes(photoFG),
    '[B] bandeau : un aplat de la couleur du centre avec son nom en grand, aucune image en boite');
  const bandeauEncre = await transactionnel({ ...formes.bandeau, accent: { mode: 'encre', hex: '' } });
  ok(/logo-fun-galaxy-email\.png/.test(bandeauEncre) && images(bandeauEncre) === 1 && !bandeauEncre.toLowerCase().includes(ACCENT_FG),
    '[B] bandeau a l encre : le logo blanc sur l aplat sombre, sans couleur du centre');
  ok(images(rendus['une ligne']) === 0 && !rendus['une ligne'].includes(`bgcolor="${ACCENT_FG}"`), '[B] une ligne : ni image ni aplat');

  // =====================================================================
  console.log('\n[C] le budget tient sous la pression');
  // =====================================================================
  const avecBouton = await transactionnel(formes['carte avec photo'], { action: { label: 'Voir ma réservation', href: 'https://app.pinlane.be/r/abc' } });
  ok(liens(avecBouton) <= 2 && !/mailto:/.test(avecBouton) && /libramont@fungalaxy\.be/.test(avecBouton) && /tel:0491301667/.test(avecBouton),
    '[C] avec un bouton : le telephone reste lie, l adresse mail passe en clair', `liens=${liens(avecBouton)}`);
  const avecLogoEnTete = await transactionnel({ ...formes['carte avec photo'], preset: 'classique', header: { mode: 'logo', logoUrl: '', logoWidth: 140 } });
  ok(images(avecLogoEnTete) <= 1 && !avecLogoEnTete.includes(photoFG), '[C] avec un logo d en-tete : la photo de signature n est pas posee', `images=${images(avecLogoEnTete)}`);
  const manuel = await transactionnel(formes['carte avec photo'], { portee: 'manual', person: KEVIN });
  ok(/>Facebook<\/a> · <a [^>]+>Instagram<\/a>/.test(manuel) && /fungalaxy\.be<\/a>/.test(manuel) && /<strong>Kevin Dupont<\/strong>/.test(manuel),
    '[C] un mail manuel garde ses liens et signe de la personne');

  // =====================================================================
  console.log('\n[D] l apercu est le mail envoye');
  // =====================================================================
  for (const [nom, design] of Object.entries(formes)) {
    const valide = m.design.validateEmailDesign(design, LIBRAMONT);
    // Comme saveEmailDesign : un design enregistre porte toujours sa date (sans elle,
    // il se lirait comme un design d avant l affiche, section [K]).
    REGLAGES.set('libramont', { email_design: { ...valide, updatedAt: new Date().toISOString() } });
    const apercu = await m.comms.buildDesignPreview({ centerId: 'libramont', design: valide, sample: 'confirmation' }, deps);
    const sequence = await m.comms.buildAutomationPreview('libramont', 'confirmation', {}, deps);
    const enfiles = [];
    await m.comms.sendDesignTest(
      { centerId: 'libramont', member: { id: 'libramont:gerante', contact: 'gerante@fungalaxy.be', name: 'Gérante' }, design: valide, sample: 'confirmation' },
      { deps, enqueue: async (row) => { enfiles.push(row); return { id: 1 }; }, dispatch: async () => ({ results: [{ id: 1, status: 'sent' }] }) },
    );
    ok(apercu.html === sequence.html && enfiles.length === 1 && enfiles[0].body === apercu.html && liens(apercu.html) <= 2,
      `[D] ${nom} : apercu == sequence == test enfile`);
  }
  REGLAGES.clear();
  // Le test d Apparence part avec la vraie version texte du mail (2026-11-12). Avant,
  // une ligne (« Test du design (confirmation) : ... ») qui reprenait 6 des 88 mots du
  // HTML : un texte qui ne dit pas ce que dit le HTML est un signal de spam, et c est
  // sur ce test que le gerant juge dans quel onglet Gmail le mail arrive.
  const testsTexte = [];
  for (const sample of ['confirmation', 'reponse', 'campagne']) {
    await m.comms.sendDesignTest(
      { centerId: 'libramont', member: { id: 'libramont:gerante', contact: 'gerante@fungalaxy.be', name: 'Gérante' }, design: null, sample },
      { deps, enqueue: async (row) => { testsTexte.push(row); return { id: 1 }; }, dispatch: async () => ({ results: [] }) },
    );
  }
  const motsDe = (t) => new Set(String(t).toLowerCase().match(/[a-zà-ÿ0-9]{3,}/g) || []);
  const visibleDe = (html) => String(html).replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<div style="display:none[\s\S]*?<\/div>/i, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ');
  const partages = testsTexte.map((row) => {
    const texte = String(row.payload.texteEnvoye || row.payload.textBody || '');
    const motsHtml = motsDe(visibleDe(row.body));
    const motsTexte = motsDe(texte);
    return { sample: row.payload.sample, part: [...motsHtml].filter((w) => motsTexte.has(w)).length / Math.max(1, motsHtml.size), texte };
  });
  ok(partages.length === 3 && partages.every((p) => p.part >= 0.6 && /^Bonjour Marie/.test(p.texte))
    && /Réservation n°\s9001/.test(partages[0].texte) && /Funement vôtre/.test(partages[0].texte),
  '[D] le test enfile part avec la vraie version texte du mail (le texte, son numero, la signature), pas une ligne de resume',
  partages.map((p) => `${p.sample}:${Math.round(p.part * 100)}%`).join(' '));

  // =====================================================================
  console.log('\n[E] chaque centre ses couleurs et ses photos');
  // =====================================================================
  const designAutre = { ...m.design.getEmailDesignDefaults(AUTRE), accent: { mode: 'centre', hex: '' } };
  // Le design relu en base d un autre centre, qui reclamerait la photo de Fun Galaxy.
  const htmlAutre = await transactionnel(m.design.fusionnerEmailDesign({ ...designAutre, signature: { ...designAutre.signature, photo: { enabled: true, url: photoFG } } }, AUTRE), { center: AUTRE });
  ok(htmlAutre.includes('#0f6b4f') && !htmlAutre.toLowerCase().includes(ACCENT_FG) && !/\/assets\/mail\//.test(htmlAutre) && !/fun-galaxy/i.test(htmlAutre),
    '[E] un autre centre : sa couleur, jamais celle ni les photos de Fun Galaxy');
  const htmlFG = await transactionnel(defautsFG);
  // Depuis le 12/11, Fun Galaxy signe en affiche : sa photo y vient en banniere
  // (la meme activite, son logo a cote).
  const banniereDeFG = (photos.find((p) => p.url === photoFG) || {}).banniere || '';
  ok(htmlFG.toLowerCase().includes(ACCENT_FG) && Boolean(banniereDeFG) && htmlFG.includes(banniereDeFG), '[E] Fun Galaxy : sa couleur et sa photo, lues dans sa fiche');
  const refus = (fn) => { try { fn(); return null; } catch (error) { return error; } };
  const photoVolee = refus(() => m.design.validateEmailDesign({ ...designAutre, signature: { ...designAutre.signature, photo: { enabled: true, url: photoFG } } }, AUTRE));
  const photoAilleurs = refus(() => m.design.validateEmailDesign({ ...defautsFG, signature: { ...defautsFG.signature, photo: { enabled: true, url: 'https://images.example.com/piste.jpg' } } }, LIBRAMONT));
  ok(photoVolee && photoVolee.expose === true && photoAilleurs && photoAilleurs.expose === true,
    '[E] une photo d un autre centre, ou d un autre domaine, est refusee a l enregistrement');
  const relue = m.design.fusionnerEmailDesign({ ...designAutre, signature: { ...designAutre.signature, photo: { enabled: true, url: photoFG } } }, AUTRE);
  ok(relue.signature.photo.enabled === false && relue.signature.photo.url === '', '[E] relue en base, une photo d un autre centre tombe');

  // =====================================================================
  console.log('\n[F] l ancienne formule');
  // =====================================================================
  const ancienne = m.design.fusionnerEmailDesign({ signature: { closing: 'À très bientôt,' } }, LIBRAMONT);
  const ancienneValidee = m.design.validateEmailDesign({ signature: { closing: 'À très bientôt,' } }, LIBRAMONT);
  const choisie = m.design.validateEmailDesign({ signature: { closing: 'Bien à vous,' } }, LIBRAMONT);
  ok(ancienne.signature.closing === CATALOGUE_FG.closing && ancienneValidee.signature.closing === CATALOGUE_FG.closing && choisie.signature.closing === 'Bien à vous,',
    '[F] l ancien defaut retombe sur la formule du centre ; une formule ecrite par le gerant reste la sienne');

  // =====================================================================
  console.log('\n[G] la formule en couleur se lit');
  // =====================================================================
  const couleurFormule = (html, formule) => {
    const rx = new RegExp(`color:(#[0-9a-fA-F]{6});">${echapper(formule).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</p>`);
    const trouve = String(html).match(rx);
    return trouve ? trouve[1].toLowerCase() : '';
  };
  const lum = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
  const contraste = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const designClair = { ...m.design.getEmailDesignDefaults(CLAIR), accent: { mode: 'centre', hex: '' } };
  const htmlClair = await transactionnel(designClair, { center: CLAIR });
  const fFG = couleurFormule(htmlFG, defautsFG.signature.closing);
  const fClair = couleurFormule(htmlClair, designClair.signature.closing);
  ok(fFG === ACCENT_FG && contraste(fFG, '#ffffff') >= 3 && fClair && fClair !== '#e3d341' && contraste(fClair, '#ffffff') >= 3,
    '[G] la formule prend la couleur du centre quand elle tient 3:1, sinon l encre', JSON.stringify({ fFG, fClair }));

  // =====================================================================
  console.log('\n[H] le corps signe deja : la signature ne se repete pas');
  // =====================================================================
  // Le brouillon de l agent dans Reçus finit par « Bien à vous, », les modeles
  // par « À bientôt, / L'équipe {{centre}} ». La signature retire alors sa
  // formule, et son equipe quand le corps l a ecrite ; le texte part entier.
  const FORMULE_FG = echapper(defautsFG.signature.closing);
  const equipes = (html) => (String(html).match(/L&#39;équipe Fun Galaxy Libramont/g) || []).length;
  const fois = (html, texte) => String(html).split(echapper(texte)).length - 1;
  const trait = (html) => String(html).includes(`<td height="4" bgcolor="${ACCENT_FG}"`);
  const coordonnees = (html) => /0491\/30\.16\.67/.test(html) && /libramont@fungalaxy\.be/.test(html);
  const signe = (body, { layout = 'carte' } = {}) => m.comms.emailShell({
    title: 'Votre piste samedi', body, preheader: 'Votre piste', center: LIBRAMONT,
    design: { ...defautsFG, signature: { ...defautsFG.signature, layout } }, signature: { enabled: true, person: null, portee: 'sequences' },
  });
  const ouverture = 'Bonjour Marie,\n\nVotre piste est réservée samedi à 15 h.';
  const corpsBienAVous = `${ouverture}\n\nBien à vous,`;
  const corpsEquipe = `${ouverture}\n\nÀ bientôt,\nL'équipe Fun Galaxy Libramont`;
  const corpsSansFormule = `${ouverture}\nPensez à venir 10 minutes avant.`;
  const corpsFormuleAuMilieu = 'Bonjour Marie,\n\nVous nous écriviez :\nBien à vous,\nMarie\n\nVotre piste est bien réservée samedi à 15 h.';
  const hBienAVous = signe(corpsBienAVous);
  ok(fois(hBienAVous, 'Bien à vous,') === 1 && !hBienAVous.includes(FORMULE_FG) && equipes(hBienAVous) === 1
    && hBienAVous.includes(`src="${photoFG}"`) && coordonnees(hBienAVous) && trait(hBienAVous),
    '[H] corps fini par « Bien à vous, » : la signature retire sa formule, garde l equipe, la photo, les coordonnees et le trait');
  const hEquipe = signe(corpsEquipe);
  ok(fois(hEquipe, 'À bientôt,') === 1 && equipes(hEquipe) === 1 && !hEquipe.includes(FORMULE_FG)
    && hEquipe.includes(`src="${photoFG}"`) && coordonnees(hEquipe) && trait(hEquipe),
    '[H] corps fini par « À bientôt, / L équipe X » : la signature retire sa formule et son equipe, garde la photo, les coordonnees et le trait');
  const autresFormes = ['bandeau', 'ligne'].map((layout) => signe(corpsEquipe, { layout }));
  ok(autresFormes.every((h) => equipes(h) === 1 && !h.includes(FORMULE_FG) && coordonnees(h)) && autresFormes[0].includes(`<td bgcolor="${ACCENT_FG}"`),
    '[H] bandeau et une ligne : la meme regle, l aplat reste');
  const hSansFormule = signe(corpsSansFormule);
  ok(hSansFormule.includes(FORMULE_FG) && equipes(hSansFormule) === 1 && hSansFormule.includes(`src="${photoFG}"`),
    '[H] corps sans formule de fin : la signature entiere, avec « Funement vôtre, » et l equipe');
  const hAuMilieu = signe(corpsFormuleAuMilieu);
  ok(hAuMilieu.includes(FORMULE_FG) && equipes(hAuMilieu) === 1 && fois(hAuMilieu, 'Bien à vous,') === 1,
    '[H] une formule au milieu du corps ne compte pas : la signature reste entiere');
  const hEquipeSeule = signe(`${ouverture}\nL'équipe Fun Galaxy Libramont`);
  ok(!hEquipeSeule.includes(FORMULE_FG) && equipes(hEquipeSeule) === 1 && coordonnees(hEquipeSeule),
    '[H] corps signe « L équipe X » sans formule (modeles du composeur) : ni formule apres le nom, ni deuxieme equipe');
  // « L’équipe » sans nom, comme un brouillon de Reçus (emails-threads-ui) :
  // elle ne dit pas qui ecrit, la signature le dit.
  const hEquipeSansNom = m.comms.emailShell({
    title: 'Re: gâteau', body: 'Bonjour,\n\nOui, vous pouvez apporter votre gâteau.\n\nL’équipe', preheader: 'Re: gâteau', center: LIBRAMONT,
    design: defautsFG, signature: { enabled: true, person: KEVIN, portee: 'manual' },
  });
  ok(hEquipeSansNom.includes(FORMULE_FG) && /<strong>Kevin Dupont<\/strong>/.test(hEquipeSansNom),
    '[H] « L’équipe » seule, sans nom : la signature reste entiere et dit qui ecrit');
  // L espace insecable de la typo (avant ? ! : ;, section [L]) n est pas une reecriture.
  const entier = (corps, html) => {
    const vu = String(html).split(String.fromCharCode(0xa0)).join(' ');
    return corps.split('\n').map((l) => l.trim()).filter(Boolean).every((l) => vu.includes(echapper(l)));
  };
  ok(entier(corpsBienAVous, hBienAVous) && entier(corpsEquipe, hEquipe) && entier(corpsSansFormule, hSansFormule) && entier(corpsFormuleAuMilieu, hAuMilieu),
    '[H] le texte de l auteur part entier : aucune ligne retiree ni reecrite');
  const texte = (corps) => m.comms.renderSignatureText({ design: defautsFG, center: LIBRAMONT, corps });
  const tBienAVous = texte(corpsBienAVous);
  const tEquipe = texte(corpsEquipe);
  const tSansFormule = texte(corpsSansFormule);
  ok(!tBienAVous.includes(defautsFG.signature.closing) && tBienAVous.startsWith('L\'équipe Fun Galaxy Libramont')
    && !tEquipe.includes(defautsFG.signature.closing) && !tEquipe.includes('L\'équipe') && tEquipe.includes('0491/30.16.67')
    && tSansFormule.startsWith(`${defautsFG.signature.closing}\nL'équipe Fun Galaxy Libramont`),
    '[H] la version texte suit la meme regle (formule, equipe, coordonnees)', JSON.stringify({ tBienAVous, tEquipe }));

  // Chaque chemin d envoi passe par ce rendu : composeur, reponse Reçus,
  // sequence, campagne, et l Apercu de la page Apparence.
  const kevin = (html) => /<strong>Kevin Dupont<\/strong>/.test(String(html));
  const composeur = await m.comms.buildDirectEmailPreview({ centerId: 'libramont', subject: 'Votre question', body: corpsBienAVous, member: KEVIN }, deps);
  ok(!composeur.html.includes(FORMULE_FG) && kevin(composeur.html) && fois(composeur.html, 'Bien à vous,') === 1,
    '[H] composeur : un texte fini par « Bien à vous, » signe de la personne, sans seconde formule');
  const envoyes = [];
  await m.comms.sendDirectEmail({ centerId: 'libramont', to: 'marie@exemple.be', subject: '', body: corpsBienAVous, replyToCommunicationId: 77, attemptId: 'gate-signature-recus', member: KEVIN },
    { query: requete, enqueue: async (row) => { envoyes.push(row); return { id: 0 }; } });
  const reponse = envoyes[0] || {};
  ok(Boolean(reponse.payload && reponse.payload.inReplyTo) && !String(reponse.body).includes(FORMULE_FG) && kevin(reponse.body) && fois(reponse.body, 'Bien à vous,') === 1,
    '[H] reponse Reçus (sendDirectEmail, en reponse a un message recu) : une seule formule, celle du brouillon');
  const anniversaire = await m.comms.buildAutomationPreview('libramont', 'birthday_j30', {}, deps);
  ok(!anniversaire.html.includes(FORMULE_FG) && equipes(anniversaire.html) === 1 && fois(anniversaire.html, 'Bien à vous,') === 1,
    '[H] sequence anniversaire (« Bien à vous, / L équipe X ») : une formule, une equipe');
  REGLAGES.set('libramont', { email_design: m.design.validateEmailDesign({ ...defautsFG, signatureScope: { manual: true, sequences: true, campaigns: true } }, LIBRAMONT) });
  const campagnes = [];
  await m.comms.enqueueCampaign({ centerId: 'libramont', campaignId: 9, recipients: [{ email: 'c@exemple.be', name: 'C' }], subject: 'Une soirée bowling ?', body: corpsEquipe, scheduledAt: new Date(Date.now() + 86400000).toISOString(), personalize: (t) => t, deps, enqueue: async (row) => { campagnes.push(row); return { id: 1 }; } });
  REGLAGES.clear();
  ok(campagnes.length === 1 && !String(campagnes[0].body).includes(FORMULE_FG) && equipes(campagnes[0].body) === 1 && fois(campagnes[0].body, 'À bientôt,') === 1,
    '[H] campagne signee : une formule, une equipe');
  const apercuApparence = await m.comms.buildDesignPreview({ centerId: 'libramont', design: defautsFG, sample: 'reponse', member: KEVIN }, deps);
  ok(apercuApparence.html.includes(FORMULE_FG) && kevin(apercuApparence.html),
    '[H] Apercu de la page Apparence : son exemple ne finit pas par une formule, la signature s y montre entiere');

  // =====================================================================
  console.log('\n[I] la version texte envoyee porte la signature');
  // =====================================================================
  // Le texte de l auteur reste seul dans payload.textBody (fil de Reçus,
  // apprentissage de l agent) ; payload.texteEnvoye, que sendEmail envoie,
  // y ajoute la signature, avec les memes interrupteurs et la meme regle.
  const TEL_FG = '0491/30.16.67';
  const versionEnvoyee = async (payload) => {
    const cleAvant = process.env.RESEND_API_KEY;
    const fetchAvant = global.fetch;
    process.env.RESEND_API_KEY = 're_gate_signature';
    let demande = null;
    global.fetch = async (url, options) => { demande = JSON.parse(options.body); return { ok: true, json: async () => ({ id: 'gate' }) }; };
    try {
      await m.comms.__test.sendEmail({ recipient: 'marie@exemple.be', subject: 's', body: '<html></html>', payload });
    } finally {
      global.fetch = fetchAvant;
      if (cleAvant === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = cleAvant;
    }
    return demande ? String(demande.text || '') : '';
  };
  let tentative = 0;
  const envoyer = async (extra = {}) => {
    const lignes = [];
    tentative += 1;
    await m.comms.sendDirectEmail({ centerId: 'libramont', to: 'marie@exemple.be', subject: 'Votre question', body: corpsBienAVous, attemptId: `gate-signature-texte-${tentative}`, member: KEVIN, ...extra },
      { query: requete, enqueue: async (row) => { lignes.push(row); return { id: 0 }; } });
    return lignes[0] || { payload: {} };
  };
  const manuelTexte = await envoyer();
  const envoiManuel = await versionEnvoyee(manuelTexte.payload);
  ok(envoiManuel === manuelTexte.payload.texteEnvoye && envoiManuel.startsWith(corpsBienAVous) && envoiManuel.includes('Kevin Dupont') && envoiManuel.includes(TEL_FG) && envoiManuel.includes('libramont@fungalaxy.be'),
    '[I] envoi manuel : sendEmail envoie le texte puis la signature (Kevin, telephone, adresse mail)');
  ok(manuelTexte.payload.textBody === corpsBienAVous,
    '[I] le texte de l auteur reste seul dans textBody (le fil de Reçus et l apprentissage de l agent le relisent tel quel)');
  ok(envoiManuel.split('Bien à vous,').length === 2 && !envoiManuel.includes(defautsFG.signature.closing),
    '[I] « Bien à vous, » en fin de texte : la version texte n ajoute pas de seconde formule');
  const reservationTexte = [];
  const dansJours = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  await m.comms.enqueueReservationCommunications(
    { id: 501, centerId: 'libramont', name: 'Client Resa', email: 'resa@exemple.be', phone: '+32470999000', date: dansJours(5), startTime: '14:00', formuleId: 'bowling', pax: 6, validationStatus: 'confirmed' },
    { enqueue: async (row) => { reservationTexte.push(row); return { id: reservationTexte.length }; }, deps },
  );
  const confirmationTexte = reservationTexte.find((row) => row.channel === 'email' && row.payload && row.payload.texteEnvoye) || { payload: {} };
  const envoiConfirmation = String(confirmationTexte.payload.texteEnvoye || '');
  ok(envoiConfirmation.startsWith(String(confirmationTexte.payload.textBody || '-')) && envoiConfirmation.includes('Réservation n° 501')
    && envoiConfirmation.indexOf('Réservation n° 501') < envoiConfirmation.indexOf(defautsFG.signature.closing)
    && envoiConfirmation.includes('L\'équipe Fun Galaxy Libramont') && envoiConfirmation.includes(TEL_FG),
    '[I] sequence (confirmation enfilee) : le texte, son numero de reservation, puis la signature');
  const anniversaireTexte = String(anniversaire.texteEnvoye || '');
  ok(anniversaireTexte.split('Bien à vous,').length === 2 && anniversaireTexte.split('L\'équipe Fun Galaxy Libramont').length === 2 && !anniversaireTexte.includes(defautsFG.signature.closing) && anniversaireTexte.includes(TEL_FG),
    '[I] sequence anniversaire : une formule, une equipe, les coordonnees');
  const campagneTexte = String((campagnes[0] && campagnes[0].payload && campagnes[0].payload.texteEnvoye) || '');
  const ligneRetrait = String((campagnes[0] && campagnes[0].payload && campagnes[0].payload.textBody) || '').split('\n\n').pop();
  ok(/\/api\/u\?k=[0-9a-f]{32}/.test(ligneRetrait) && campagneTexte.endsWith(ligneRetrait) && campagneTexte.indexOf(TEL_FG) > 0 && campagneTexte.indexOf(TEL_FG) < campagneTexte.indexOf(ligneRetrait),
    '[I] campagne : la signature avant la ligne de retrait, qui reste la derniere');
  REGLAGES.set('libramont', { email_design: m.design.validateEmailDesign({ ...defautsFG, signature: { ...defautsFG.signature, afficher: { ...defautsFG.signature.afficher, telephone: false } } }, LIBRAMONT) });
  const sansTelephone = await envoyer();
  REGLAGES.set('libramont', { email_design: m.design.validateEmailDesign({ ...defautsFG, signature: { ...defautsFG.signature, enabled: false } }, LIBRAMONT) });
  const signatureCoupee = await envoyer();
  REGLAGES.set('libramont', { email_design: m.design.validateEmailDesign({ ...defautsFG, signatureScope: { manual: true, sequences: false, campaigns: false } }, LIBRAMONT) });
  const sequenceSansSignature = await m.comms.buildAutomationPreview('libramont', 'birthday_j30', {}, deps);
  REGLAGES.clear();
  const caseDecochee = await envoyer({ signature: false });
  ok(String(sansTelephone.payload.texteEnvoye || '').includes('libramont@fungalaxy.be') && !String(sansTelephone.payload.texteEnvoye || '').includes(TEL_FG),
    '[I] interrupteurs : la ligne du telephone eteinte ne s ecrit pas dans la version texte');
  ok(!('texteEnvoye' in signatureCoupee.payload) && (await versionEnvoyee(signatureCoupee.payload)) === corpsBienAVous
    && !('texteEnvoye' in caseDecochee.payload) && !('texteEnvoye' in sequenceSansSignature),
    '[I] interrupteurs : signature coupee, case decochee ou portee eteinte, la version texte est le texte seul');

  // =====================================================================
  console.log('\n[J] les signatures d enseigne (2026-11-12) : le vrai logo sans fond, une vraie photo, l accroche');
  // =====================================================================
  // Ansar : « un truc jolie avec notre logo le vrai [...] design bowling laser
  // game super beau avec info et tout », puis « logo sans fond ». Jury a
  // l aveugle du 12/11 : affiche, puis arene, enseigne, la carte d avant.
  const enseigne = (layout, extra = {}) => ({ ...defautsFG, signature: { ...defautsFG.signature, layout, ...extra } });
  const banniereFG = (photos.find((p) => p.url === defautsFG.signature.photo.url) || {}).banniere || '';
  const logoNuitFG = m.design.urlDImage(LIBRAMONT.branding.emailLogoSansFondDark);
  const logoJourFG = m.design.urlDImage(LIBRAMONT.branding.emailLogoSansFond);
  const fichiersEnseigne = [banniereFG, logoNuitFG, logoJourFG]
    .map((u) => (u && u.startsWith(origine) ? path.join(ROOT, u.slice(origine.length)) : ''));
  ok(defautsFG.signature.layout === 'affiche' && /^Bowling · Laser game/.test(defautsFG.signature.accroche) && banniereFG.endsWith('/assets/mail/signature-libramont-bowling-logo.jpg')
    && fichiersEnseigne.every((f) => f && fs.existsSync(f) && fs.statSync(f).size < 100 * 1024) && largeurImage(fichiersEnseigne[0]) === 1200,
    '[J] Fun Galaxy signe par defaut en affiche : son accroche, la banniere de sa photo (1200 px, moins de 100 Ko) et ses logos sans fond sur notre domaine');
  const formesEnseigne = {};
  for (const layout of ['affiche', 'arene', 'enseigne']) {
    const html = await transactionnel(enseigne(layout));
    formesEnseigne[layout] = html;
    ok(liens(html) <= 2 && images(html) === 1 && html.includes(echapper(defautsFG.signature.closing)) && html.includes(echapper(defautsFG.signature.accroche))
      && /L&#39;équipe Fun Galaxy Libramont/.test(html) && html.includes(`max-width:${600}px`),
      `[J] ${layout} : 2 liens et 1 image au plus, la formule, l accroche, l equipe, a la largeur du corps`, `liens=${liens(html)} images=${images(html)}`);
  }
  ok(formesEnseigne.affiche.includes(`src="${banniereFG}"`) && /sans-fond/.test(logoNuitFG) && formesEnseigne.arene.includes(`src="${logoNuitFG}"`)
    && /sans-fond/.test(logoJourFG) && formesEnseigne.enseigne.includes(`src="${logoJourFG}"`)
    && !Object.values(formesEnseigne).some((h) => /logo-fun-galaxy-email(-clair)?\.png/.test(h)),
    '[J] le vrai logo sans fond : la banniere en affiche, les lettres blanches sur la nuit de l arene, les lettres foncees sur le blanc de l enseigne, jamais le logo a carre');
  ok(/href="tel:[^"]+" style="color:#ffffff;/.test(formesEnseigne.arene) && formesEnseigne.arene.toLowerCase().includes(LIBRAMONT.branding.dark.accentStrong.toLowerCase()),
    '[J] arene : les liens en blanc sur la nuit, la formule dans la couleur de nuit du centre (sa fiche)');
  ok(Object.values(formesEnseigne).every((h) => /white-space:nowrap;">[^<]*<a href="tel:/.test(h) && !/gratuit/i.test(h)),
    '[J] chaque coordonnee d un seul tenant au telephone, et aucun mot qui range le mail dans Promotions');
  // Le budget : l en-tete a deja pris l image du mail, la signature n en pose pas.
  for (const layout of ['affiche', 'arene', 'enseigne']) {
    const html = await transactionnel({ ...enseigne(layout), preset: 'classique', header: { mode: 'logo', logoUrl: '', logoWidth: 140 } });
    ok(images(html) === 1 && !html.includes('sans-fond') && !html.includes(banniereFG), `[J] ${layout} avec un logo d en-tete : la signature ne pose pas d image`, `images=${images(html)}`);
  }
  // Un autre centre, sans bannieres ni logos sans fond : rien de Fun Galaxy.
  const designAutreEnseigne = (layout) => ({ ...m.design.getEmailDesignDefaults(AUTRE), signature: { ...m.design.getEmailDesignDefaults(AUTRE).signature, layout } });
  const autres = await Promise.all(['affiche', 'arene', 'enseigne'].map((layout) => transactionnel(designAutreEnseigne(layout), { center: AUTRE })));
  ok(autres.every((h) => images(h) === 0 && !/\/assets\/mail\//.test(h) && !/fun-galaxy/i.test(h) && !h.includes('Laser game')),
    '[J] un autre centre en affiche, arene ou enseigne : ni photo, ni logo, ni accroche de Fun Galaxy');
  const sansAccroche = await transactionnel(enseigne('enseigne', { accroche: '' }));
  ok(!sansAccroche.includes('text-transform:uppercase') && sansAccroche.includes(echapper(defautsFG.signature.closing)),
    '[J] sans accroche, l enseigne n a pas de bande vide');
  const relueEnseigne = m.design.fusionnerEmailDesign({ ...defautsFG, signature: { ...defautsFG.signature, accroche: 'Bowling · Karting' } }, LIBRAMONT);
  ok(relueEnseigne.signature.accroche === 'Bowling · Karting' && relueEnseigne.signature.layout === 'affiche',
    '[J] l accroche et la forme ecrites par le gerant se gardent a l enregistrement');

  // =====================================================================
  console.log('\n[K] le mode sombre et les designs d avant l affiche (2026-11-12)');
  // =====================================================================
  // Gmail sur iPhone inverse TOUT (la nuit de l arene devient claire), Outlook et
  // Gmail Android assombrissent le blanc (sous l enseigne) : un logo sans fond y
  // perdait ses lettres. Son contour a la couleur du fond qu il borde, invisible
  // en temps normal. On lit le logo que le mail POSE, pas celui de la fiche.
  const nuit = (fs.readFileSync(path.join(ROOT, 'lib/ops-communications.js'), 'utf8').match(/const NUIT_SIGNATURE = '(#[0-9a-f]{6})'/i) || [])[1] || '';
  const logoPose = (html) => {
    const src = (String(html).match(/<img src="([^"]*sans-fond[^"]*)"/) || [])[1] || '';
    return src.startsWith(origine) ? path.join(ROOT, src.slice(origine.length)) : '';
  };
  const lisereArene = nuit ? partDuLisereEn(logoPose(formesEnseigne.arene), nuit) : 0;
  const lisereEnseigne = partDuLisereEn(logoPose(formesEnseigne.enseigne), '#ffffff');
  ok(lisereArene >= 0.95, '[K] arene : le logo blanc a un contour de la couleur de la nuit, il reste lisible quand Gmail sur iPhone eclaircit le bloc', `part=${lisereArene.toFixed(3)}`);
  ok(lisereEnseigne >= 0.95, '[K] enseigne : le logo fonce a un contour blanc, il reste lisible quand Outlook ou Gmail Android assombrit le blanc', `part=${lisereEnseigne.toFixed(3)}`);
  ok(['gembloux', 'ciney'].every((id) => {
    const b = getCenter(id).branding || {};
    return b.emailLogoSansFond === LIBRAMONT.branding.emailLogoSansFond && b.emailLogoSansFondDark === LIBRAMONT.branding.emailLogoSansFondDark;
  }), '[K] Gembloux et Ciney signent avec les memes logos a contour que Libramont');
  ok(fichiersEnseigne.slice(1).every((f) => f && fs.statSync(f).size < 100 * 1024), '[K] les logos a contour pesent moins de 100 Ko');
  // Le design de Libramont, enregistre le 03/11 (forme lue en base le 12/11, en lecture seule) :
  // la carte et le site vide y etaient pre-remplis.
  const enregistre0311 = {
    preset: 'epure', updatedAt: '2026-11-03T22:20:20.481Z', updatedBy: 'Proprietaire plateforme',
    signature: {
      role: '', email: 'libramont@fungalaxy.be', phone: '0491/30.16.67', layout: 'carte', address: "L'Alienau, 100, 6800 Libramont",
      closing: 'À très bientôt,', enabled: true, logoUrl: `${origine}/assets/brand/logo-fun-galaxy-email-clair.png`,
      socials: { tiktok: '', facebook: '', linkedin: '', instagram: '' }, website: '', logoWidth: 120, teamLabel: '',
    },
  };
  const relu0311 = m.design.fusionnerEmailDesign(enregistre0311, LIBRAMONT);
  const mail0311 = await transactionnel(relu0311);
  ok(relu0311.signature.layout === 'affiche' && relu0311.signature.website === LIBRAMONT.identity.siteUrl && relu0311.signature.closing === CATALOGUE_FG.closing
    && relu0311.preset === 'epure' && mail0311.includes(`src="${banniereFG}"`) && mail0311.includes(echapper(defautsFG.signature.accroche)),
    '[K] le design enregistre le 03/11 (carte et site pre-remplis) se lit en affiche avec le site du centre, et garde son gabarit',
    `layout=${relu0311.signature.layout} site=${relu0311.signature.website} preset=${relu0311.preset}`);
  const choisiDepuis = m.design.fusionnerEmailDesign({ ...enregistre0311, updatedAt: '2026-11-12T09:00:00.000Z' }, LIBRAMONT);
  ok(choisiDepuis.signature.layout === 'carte' && choisiDepuis.signature.website === '',
    '[K] enregistree depuis l arrivee de l affiche, la carte est un vrai choix : elle reste, sans site', `layout=${choisiDepuis.signature.layout}`);

  // =====================================================================
  console.log('\n[L] l apercu d Apparence de la capture d Ansar (2026-11-12) : couleurs, ordre, largeur, images');
  // =====================================================================
  // La capture : la banniere en texte de remplacement (bloquee), la formule et
  // l accroche en noir, la note du mail sous la signature, l apercu qui deborde.
  // Le design enregistre de Libramont, ENTIER cette fois (lu en base le 12/11).
  const enregistre0311Complet = {
    ...enregistre0311,
    accent: { hex: '', mode: 'encre' },
    header: { mode: 'aucun', logoUrl: `${origine}/assets/brand/logo-fun-galaxy-email-clair.png`, logoWidth: 80 },
    footer: { email: true, adresse: true, mention: '', telephone: true },
    signatureScope: { manual: true, campaigns: false, sequences: true },
  };
  const couleurDeLaFormule = (html) => (String(html).match(new RegExp(`color:(#[0-9a-fA-F]{6});">${echapper(defautsFG.signature.closing)}</p>`)) || [])[1] || '';
  const reluComplet = m.design.fusionnerEmailDesign(enregistre0311Complet, LIBRAMONT);
  const mailComplet = await transactionnel(reluComplet);
  const couleurDefaut = couleurDeLaFormule(formesEnseigne.affiche);
  ok(reluComplet.accent.mode === defautsFG.accent.mode && couleurDefaut && couleurDeLaFormule(mailComplet) === couleurDefaut && couleurDefaut.toLowerCase() !== '#111827',
    '[L] le design du 03/11 (encre pre-remplie) prend la couleur du centre, comme le defaut', `accent=${reluComplet.accent.mode} formule=${couleurDeLaFormule(mailComplet)} defaut=${couleurDefaut}`);
  const encreChoisie = m.design.fusionnerEmailDesign({ ...enregistre0311Complet, updatedAt: '2026-11-12T09:00:00.000Z' }, LIBRAMONT);
  ok(encreChoisie.accent.mode === 'encre', '[L] l encre choisie depuis le lot 2 reste l encre', `accent=${encreChoisie.accent.mode}`);
  // L ordre : l apercu de confirmation (celui de la capture) pose sa note avant la signature.
  const apercuConfirmation = await m.comms.buildDesignPreview({ centerId: 'libramont', design: reluComplet, sample: 'confirmation' }, deps);
  const iNote = apercuConfirmation.html.indexOf('s&#39;adapte');
  const iFormule = apercuConfirmation.html.indexOf(echapper(defautsFG.signature.closing));
  ok(iNote > -1 && iFormule > iNote, '[L] la note du mail se lit avant la signature, qui ferme le mail', `note=${iNote} formule=${iFormule}`);
  // La typo : « Un retard ? » ne laisse plus son « ? » seul en debut de ligne.
  const insecable = String.fromCharCode(0xa0);
  const corpsAvecQuestion = await transactionnel({ ...defautsFG }, {});
  const htmlQuestion = m.comms.emailShell({ title: 'Une question', body: 'Bonjour Marie,\n\nUne piste samedi ? Oui : 15 h, « Bowling » compris !', preheader: 'x', center: LIBRAMONT, design: defautsFG, signature: { enabled: false } });
  ok(apercuConfirmation.html.includes(`Un retard${insecable}?`) && !apercuConfirmation.html.includes('Un retard ?')
    && htmlQuestion.includes(`samedi${insecable}?`) && htmlQuestion.includes(`Oui${insecable}:`) && htmlQuestion.includes(`«${insecable}Bowling${insecable}»`) && htmlQuestion.includes(`compris${insecable}!`)
    && !new RegExp(`style="[^"]*${insecable}`).test(htmlQuestion) && corpsAvecQuestion.length > 0,
    '[L] l espace avant ? ! : ; et dans les guillemets est insecable dans le mail, jamais dans une balise');
  // La largeur : une banniere bloquee ou coupee ne garde pas un cadre fixe.
  const styleBanniere = (String(formesEnseigne.affiche).match(new RegExp(`<img src="${banniereFG.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}"[^>]*style="([^"]*)"`)) || [])[1] || '';
  ok(/(^|;)width:100%;max-width:\d+px;/.test(styleBanniere) && !/(^|;)width:\d+px;max-width:100%/.test(styleBanniere),
    '[L] la banniere suit la largeur du mail, meme quand elle ne charge pas', styleBanniere.slice(0, 90));
  // Les images : servies avec Cross-Origin-Resource-Policy same-origin, elles etaient
  // bloquees dans le cadre isole de l apercu (net::ERR_BLOCKED_BY_RESPONSE.NotSameOrigin).
  const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const corpDe = (source) => (((vercel.headers || []).find((h) => h.source === source) || { headers: [] }).headers
    .find((h) => String(h.key).toLowerCase() === 'cross-origin-resource-policy') || {}).value;
  const imagesFG = [...photos.map((p) => p.url), ...photos.map((p) => p.banniere).filter(Boolean), logoNuitFG, logoJourFG];
  ok(corpDe('/assets/mail/(.*)') === 'cross-origin' && corpDe('/assets/brand/(.*)') === 'cross-origin'
    && imagesFG.every((u) => u.startsWith(`${origine}/assets/mail/`) || u.startsWith(`${origine}/assets/brand/`)),
    '[L] les photos et logos des mails se laissent afficher hors du site (apercu d Apparence, messageries)', `mail=${corpDe('/assets/mail/(.*)')} brand=${corpDe('/assets/brand/(.*)')}`);

  // =====================================================================
  console.log('\n[M] la galerie : la boite principale tenue, les photos du bon centre');
  // =====================================================================
  // Ansar, 12/11 : « plein de versions qu on peut choisir [...] et fais gaffe pour
  // qu on soit le plus possible dans la boite principale ».
  const GEMBLOUX = getCenter('gembloux');
  const CINEY = getCenter('ciney');
  const ids = m.design.EMAIL_DESIGN_PRESETS.map((p) => p.id);
  const neufs = ids.slice(5);
  const recap = [
    { label: 'Date', value: 'samedi 20 juin' }, { label: 'Heure', value: '15:00' }, { label: 'Participants', value: '12' },
    { label: 'Offre', value: 'FORMULE 4' }, { label: 'Montant estimé', value: '468 €' }, { label: 'Réservation', value: 'n° 9001' },
  ];
  const automatique = (preset, { center = LIBRAMONT, activite = 'FORMULE 4 | formule', title = 'Rendez-vous samedi 20 juin', signer = true } = {}) => m.comms.emailShell({
    title, eyebrow: 'Réservation confirmée', body: 'Bonjour Marie,\n\nVotre réservation est confirmée.', preheader: 'Votre réservation', center,
    details: recap, action: { href: 'https://app.pinlane.be/r/abc', label: 'Gérer ma réservation' }, note: 'Un retard ? Un appel suffit.',
    design: { ...m.design.getEmailDesignDefaults(center), preset }, signature: { enabled: signer, person: null, portee: 'sequences' }, activite,
  });
  const horsBudget = ids.filter((id) => { const h = automatique(id); return liens(h) > 2 || images(h) > 1; });
  ok(ids.length === 12 && horsBudget.length === 0, '[M] les douze gabarits, dans un mail automatique : deux liens et une image au plus', horsBudget.join(', ') || `${ids.length} gabarits`);
  ok(automatique('grand-format') === automatique('photo') && automatique('vitrine') === automatique('billet'),
    '[M] un grand format de campagne ne part jamais sur un mail automatique : il prend son repli de la boite principale');
  const campagne = m.comms.emailShell({
    title: 'Une soirée bowling entre amis ?', body: 'Bonjour Marie,\n\nRéservez une piste.', preheader: 'Une soirée bowling', center: LIBRAMONT,
    action: { href: 'https://app.pinlane.be/reserver/libramont', label: 'Réserver une piste' },
    unsubscribeLine: { text: 'Vous recevez ce message parce que vous avez déjà réservé chez nous.', url: 'https://app.pinlane.be/api/u?k=test', label: 'Ne plus recevoir' },
    design: { ...defautsFG, preset: 'vitrine' }, signature: { enabled: false },
  });
  const photosCampagne = (campagne.match(/\/assets\/mail\/activites\/[a-z-]+\.jpg/g) || []);
  ok(photosCampagne.length === 2 && photosCampagne.every((u) => u.includes('/libramont-')) && new Set(photosCampagne).size === 2,
    '[M] une campagne en vitrine pose deux vraies photos du centre', photosCampagne.join(' '));
  // Le grand format : sa seconde photo est de la meme activite que le titre, ou il n y en a pas.
  const grandFormat = (title) => m.comms.emailShell({
    title, body: 'Bonjour Marie,\n\nRéservez une piste.', preheader: title, center: LIBRAMONT,
    action: { href: 'https://app.pinlane.be/reserver/libramont', label: 'Réserver' },
    unsubscribeLine: { text: 'Vous recevez ce message parce que vous avez déjà réservé chez nous.', url: 'https://app.pinlane.be/api/u?k=test', label: 'Ne plus recevoir' },
    design: { ...defautsFG, preset: 'grand-format' }, signature: { enabled: false },
  });
  const photosBowling = grandFormat('Une soirée bowling entre amis ?').match(/\/assets\/mail\/activites\/[a-z-]+\.jpg/g) || [];
  const photosLaser = grandFormat('Une partie de laser entre amis ?').match(/\/assets\/mail\/activites\/[a-z-]+\.jpg/g) || [];
  ok(photosBowling.length === 2 && photosBowling[0] === '/assets/mail/activites/libramont-bowling.jpg' && !photosBowling.some((u) => u.includes('laser'))
    && photosLaser.length === 1 && photosLaser[0] === '/assets/mail/activites/libramont-laser.jpg',
    '[M] le grand format : la seconde photo est de la meme activite que le titre, jamais le laser sous un titre bowling', `${photosBowling.join(' ')} | ${photosLaser.join(' ')}`);
  const photoDe = (html) => (String(html).match(/\/assets\/mail\/activites\/[a-z-]+\.jpg/) || [''])[0];
  const laserGembloux = automatique('photo', { center: GEMBLOUX, activite: 'Laser Game | laser' });
  const duckLibramont = automatique('photo', { activite: 'Duckpin bowling | duckpin' });
  const formuleLibramont = automatique('photo');
  const sansPhotoCiney = automatique('photo', { center: CINEY, activite: 'Laser Game | laser' });
  ok(photoDe(laserGembloux) === '/assets/mail/activites/gembloux-laser.jpg' && !laserGembloux.includes('/activites/libramont-')
    && photoDe(duckLibramont) === '/assets/mail/activites/libramont-duckpin.jpg' && photoDe(formuleLibramont) === '/assets/mail/activites/libramont-salle.jpg'
    && photoDe(sansPhotoCiney) === '',
    '[M] la photo de l activite vient de la fiche du centre : laser a Gembloux, duckpin et formule a Libramont, aucune a Ciney qui n en a pas',
    [laserGembloux, duckLibramont, formuleLibramont, sansPhotoCiney].map(photoDe).join(' | '));
  const srcs = (html) => [...String(html).matchAll(/<img\s[^>]*src="([^"]+)"/g)].map((x) => x[1]);
  ok(srcs(formuleLibramont).length === 1 && srcs(formuleLibramont)[0].includes('/assets/mail/activites/') && /Funement/.test(formuleLibramont),
    '[M] Photo de l activite : la photo en tete est la seule image, la signature passe en texte', srcs(formuleLibramont).join(' '));
  const traits = neufs.filter((id) => /border(?:-top|-bottom|-left|-right)?:\s*1px/i.test(automatique(id, { signer: false })));
  ok(traits.length === 0, '[M] aucun trait fin dans les sept gabarits de la galerie', traits.join(', '));
  const avantLeTexte = ['billet', 'affiche', 'score', 'photo'].filter((id) => { const h = automatique(id, { signer: false }); return h.indexOf('20 juin') > -1 && h.indexOf('20 juin') < h.indexOf('Bonjour Marie'); });
  ok(avantLeTexte.length === 4, '[M] billet, score et photo ouvrent sur le rendez-vous, avant le texte', avantLeTexte.join(','));
  const h1 = (html) => ((String(html).match(/<h1[^>]*>([^<]*)<\/h1>/) || [])[1] || '').trim();
  const titreDuBillet = h1(automatique('billet', { signer: false }));
  const autreTitre = h1(automatique('billet', { signer: false, title: 'Votre visite approche' }));
  ok(titreDuBillet === 'Réservation confirmée' && autreTitre === 'Votre visite approche',
    '[M] un titre qui redit la date du billet cede sa place au sourcil, un autre titre reste', `${titreDuBillet} / ${autreTitre}`);
  const galerie = await m.comms.buildDesignGallery({ centerId: 'libramont' }, deps);
  ok(galerie.vignettes.map((v) => v.id).join(',') === ids.join(',') && galerie.vignettes.every((v) => v.html.startsWith('<!doctype html>') && v.sample === (['grand-format', 'vitrine'].includes(v.id) ? 'campagne' : 'confirmation')),
    '[M] la galerie d Apparence rend les douze gabarits, les grands formats sur la campagne d exemple', galerie.vignettes.map((v) => `${v.id}:${v.sample}`).join(' '));
  const fiches = [[LIBRAMONT, 'libramont-'], [GEMBLOUX, 'gembloux-']].map(([c, prefixe]) => ({ prefixe, liste: (c.branding && c.branding.emailPhotosActivites) || [] }));
  const photosMal = fiches.flatMap(({ prefixe, liste }) => liste.filter((p) => {
    const f = path.join(ROOT, String(p.url || ''));
    return !/^\/assets\/mail\/activites\/[a-z-]+\.jpg$/.test(String(p.url || '')) || !String(p.url).includes(`/${prefixe}`) || !fs.existsSync(f)
      || fs.statSync(f).size > 110 * 1024 || fs.readFileSync(f).readUInt16BE(0) !== 0xffd8 || String(p.alt || '').length < 8 || !Array.isArray(p.activites) || !p.activites.length;
  }).map((p) => p.url));
  ok(fiches.every((f) => f.liste.length >= 5) && photosMal.length === 0,
    '[M] les photos d activite : des JPG du centre, sur notre domaine, decrits, de moins de 110 Ko', photosMal.join(', ') || fiches.map((f) => `${f.prefixe}${f.liste.length}`).join(' '));

  // =====================================================================
  console.log('\n[N] ce que Gmail et Outlook lisent, sur les vrais mails automatiques');
  // =====================================================================
  // Ansar, 12/11 : « fais gaffe pour qu on soit le plus possible dans la boite
  // principale ». Les douze gabarits sur les mails que la reservation envoie
  // (accuse de reception, confirmation, rappel, horaire decale) et sur la campagne
  // d exemple, a Libramont et a Gembloux. Gmail coupe un mail de plus de 102 Ko
  // (le bas, signature et retrait compris, passe derriere « Message tronqué »).
  // Outlook ignore la largeur CSS d une image et prend son attribut width : sans
  // lui, une photo de 1 200 px deborde. Il ne lit ni flex, ni grid, ni position, ni
  // float, ni image de fond, ni SVG. Un mot de promotion range un mail automatique
  // dans Promotions.
  const reservationN = { id: 9103, name: 'Sophie Leroy', phone: '+32470123458', email: 'client@example.com', date: '2026-12-20', startTime: '14:00', pax: 12, price: 468, type: 'formule', formuleId: 'f4', label: 'FORMULE 4' };
  const MOTS_PROMO = /gratuit|\bpromo|offre sp[ée]ciale|r[ée]duction|\bremise\b|\d ?%|\bsoldes?\b|urgent|derni[eè]re chance|cliquez ici|exclusi|meilleur prix|!!|ne manquez pas/i;
  const CSS_OUTLOOK = /display\s*:\s*(inline-)?(flex|grid)|position\s*:\s*(absolute|fixed|relative)|float\s*:|background(-image)?\s*:[^;"]*url\(|<svg/i;
  const lus = { lourds: [], sansLargeur: [], css: [], promo: [], sansLangue: [] };
  let nombreDeMails = 0;
  for (const center of [LIBRAMONT, GEMBLOUX]) {
    for (const preset of ids) {
      const design = m.design.validateEmailDesign({ ...m.design.getEmailDesignDefaults(center), preset }, center);
      const habillage = m.comms.__test.habillageDe(design, 'sequences');
      const mails = ['request_received', 'confirmation', 'reminder_48h', 'delay_update'].map((templateId) => {
        const reservation = { ...reservationN, centerId: center.id, ...(templateId === 'delay_update' ? { startTime: '14:10', delayUpdate: { previousStartTime: '14:00', proposedStartTime: '14:10', delayMinutes: 10, reason: 'une partie qui a débordé', nextAction: '' } } : {}) };
        const message = m.comms.buildMessage({ reservation, templateId, channel: 'email' });
        const html = m.comms.emailShell({
          title: message.title || message.subject, body: message.body, preheader: message.preheader, details: message.details, action: message.action,
          note: message.note, eyebrow: message.eyebrow, replyLine: message.replyLine, accent: message.accent, center,
          design: habillage.design, signature: habillage.signature, activite: message.activite || '',
        });
        return { quoi: templateId, sujet: message.subject, automatique: true, html };
      });
      const exemple = await m.comms.buildDesignPreview({ centerId: center.id, design, sample: 'campagne' }, deps);
      mails.push({ quoi: 'campagne', sujet: exemple.subject, automatique: false, html: exemple.html });
      for (const mail of mails) {
        nombreDeMails += 1;
        const ou = `${center.id}/${preset}/${mail.quoi}`;
        const imgs = mail.html.match(/<img\s[^>]*>/gi) || [];
        const lu = `${mail.sujet} ${visibleDe(mail.html).replace(/\s+/g, ' ')}`;
        if (Buffer.byteLength(mail.html) > 60 * 1024) lus.lourds.push(`${ou} ${Math.round(Buffer.byteLength(mail.html) / 1024)} Ko`);
        if (imgs.some((i) => !/\swidth="\d+"/.test(i) || !/\salt="[^"]+"/.test(i))) lus.sansLargeur.push(ou);
        if (CSS_OUTLOOK.test(mail.html)) lus.css.push(`${ou} ${(mail.html.match(CSS_OUTLOOK) || [''])[0]}`);
        if (mail.automatique && MOTS_PROMO.test(lu)) lus.promo.push(`${ou} « ${(lu.match(MOTS_PROMO) || [''])[0]} »`);
        if (!/<html[^>]*\slang="fr"/.test(mail.html) || !/<title>[^<]+<\/title>/.test(mail.html)) lus.sansLangue.push(ou);
      }
    }
  }
  ok(nombreDeMails === 2 * ids.length * 5 && lus.lourds.length === 0,
    '[N] poids : chaque mail sous 60 Ko, loin des 102 Ko ou Gmail le coupe', lus.lourds.slice(0, 4).join(', ') || `${nombreDeMails} mails`);
  ok(lus.sansLargeur.length === 0, '[N] Outlook : chaque image porte sa largeur (attribut width) et sa description', lus.sansLargeur.slice(0, 4).join(', '));
  ok(lus.css.length === 0, '[N] Outlook : ni flex, ni grid, ni position, ni float, ni image de fond, ni SVG', lus.css.slice(0, 4).join(', '));
  ok(lus.promo.length === 0, '[N] aucun mot de promotion dans un mail automatique (objet et texte)', lus.promo.slice(0, 4).join(', '));
  ok(lus.sansLangue.length === 0, '[N] chaque mail dit sa langue (fr) et porte un titre', lus.sansLangue.slice(0, 4).join(', '));
}

(async () => {
  let m = charger();
  await controles(m);

  // =====================================================================
  console.log('\n[mutation] contre-preuves (le gate ROUGIRAIT sans chaque garde)');
  // =====================================================================
  const CAS = [
    { nom: 'budget de liens retire', cible: '[C] avec un bouton : le telephone reste lie, l adresse mail passe en clair',
      fichier: 'lib/ops-communications.js', de: '    if (liensRestants <= 0) return texte;\n', vers: '' },
    { nom: 'budget d image retire', cible: '[C] avec un logo d en-tete : la photo de signature n est pas posee',
      fichier: 'lib/ops-communications.js', de: '  if (photoChoisie && imagesRestantes > 0) {', vers: '  if (photoChoisie) {' },
    { nom: 'formule oubliee', cible: '[B] carte avec photo : la formule, l equipe et les reseaux nommes en texte',
      fichier: 'lib/ops-communications.js', de: "  const closing = deja.formule ? '' : String(sig.closing || '').trim();\n  const disposition", vers: "  const closing = '';\n  const disposition" },
    { nom: 'photos du premier centre pour tous', cible: '[E] un autre centre : sa couleur, jamais celle ni les photos de Fun Galaxy',
      fichier: 'lib/email-design.js', de: '  const liste = center && center.branding && Array.isArray(center.branding.emailPhotos) ? center.branding.emailPhotos : [];',
      vers: "  const liste = require('./ops-knowledge').getCenter('libramont').branding.emailPhotos;" },
    { nom: 'photo etrangere acceptee', cible: '[E] une photo d un autre centre, ou d un autre domaine, est refusee a l enregistrement',
      fichier: 'lib/email-design.js', de: '  const photoUrl = !photoUrlBrute || photos.some((p) => p.url === urlDImage(photoUrlBrute))', vers: '  const photoUrl = true' },
    { nom: 'apercu sans le budget du mail envoye', cible: '[D] carte avec photo : apercu == sequence == test enfile',
      fichier: 'lib/ops-communications.js', de: "      html: shellFromMessage(message, center, habillageDe(resolu, 'sequences')),", vers: "      html: shellFromMessage(message, center, habillageDe(resolu, 'manual')),\n      __apercu: true," },
    { nom: 'ancienne formule gardee', cible: '[F] l ancien defaut retombe sur la formule du centre ; une formule ecrite par le gerant reste la sienne',
      fichier: 'lib/email-design.js', de: '    closing: closingBrut === ANCIENNE_FORMULE ? sigDefauts.closing : closingBrut,', vers: '    closing: closingBrut,' },
    { nom: 'formule claire illisible', cible: '[G] la formule prend la couleur du centre quand elle tient 3:1, sinon l encre',
      fichier: 'lib/ops-communications.js', de: 'color:${sobre ? EMAIL_THEME.ink : encreLisible(couleur, 3)};">${escapeHtml(closing)}</p>', vers: 'color:${couleur};">${escapeHtml(closing)}</p>' },
    // Lot 2b : la signature s efface devant la fin que le corps a deja ecrite.
    { nom: 'liste des formules ignoree', cible: '[H] corps fini par « Bien à vous, » : la signature retire sa formule, garde l equipe, la photo, les coordonnees et le trait',
      fichier: 'lib/ops-communications.js', de: '    ...FORMULES_DE_FIN_DU_CORPS,\n', vers: '' },
    { nom: 'qui signe redit', cible: '[H] corps fini par « À bientôt, / L équipe X » : la signature retire sa formule et son equipe, garde la photo, les coordonnees et le trait',
      fichier: 'lib/ops-communications.js', de: '  if (deja.signataire) identite.length = 0;\n', vers: '' },
    { nom: 'toute fin vaut une formule', cible: '[H] corps sans formule de fin : la signature entiere, avec « Funement vôtre, » et l equipe',
      fichier: 'lib/ops-communications.js', de: '  if (estFormule(derniere)) return { formule: true, signataire: false };', vers: '  return { formule: true, signataire: false };' },
    { nom: 'tout le corps est lu', cible: '[H] une formule au milieu du corps ne compte pas : la signature reste entiere',
      fichier: 'lib/ops-communications.js', de: '  const derniere = lignes[lignes.length - 1];', vers: '  const derniere = lignes.find((l) => estFormule(l)) || lignes[lignes.length - 1];' },
    { nom: 'l equipe seule ignoree', cible: '[H] corps signe « L équipe X » sans formule (modeles du composeur) : ni formule apres le nom, ni deuxieme equipe',
      fichier: 'lib/ops-communications.js', de: "  if (signe === 'nomme') return { formule: true, signataire: true };\n", vers: '' },
    { nom: 'l equipe sans nom vaut un nom', cible: '[H] « L’équipe » seule, sans nom : la signature reste entiere et dit qui ecrit',
      fichier: 'lib/ops-communications.js', de: "    if (!reste || /^centre$/iu.test(reste)) return 'anonyme';", vers: "    if (!reste || /^centre$/iu.test(reste)) return 'nomme';" },
    { nom: 'le corps retouche', cible: '[H] le texte de l auteur part entier : aucune ligne retiree ni reecrite',
      fichier: 'lib/ops-communications.js', de: '  const corps = body;\n', vers: "  const corps = String(body).replace(/\\n[^\\n]*$/, '');\n" },
    { nom: 'version texte sans le corps', cible: '[H] la version texte suit la meme regle (formule, equipe, coordonnees)',
      fichier: 'lib/ops-communications.js', de: '  const deja = finDejaEcrite(corps, { center, design, person });\n  const lignes = [];', vers: "  const deja = finDejaEcrite('', { center, design, person });\n  const lignes = [];" },
    { nom: 'le mail ne passe pas son corps a la signature', cible: '[H] reponse Reçus (sendDirectEmail, en reponse a un message recu) : une seule formule, celle du brouillon',
      fichier: 'lib/ops-communications.js', de: 'largeur: largeurSignature, corps });', vers: "largeur: largeurSignature, corps: '' });" },
    // La version texte envoyee (2026-11-12).
    { nom: 'sendEmail ignore la version signee', cible: '[I] envoi manuel : sendEmail envoie le texte puis la signature (Kevin, telephone, adresse mail)',
      fichier: 'lib/ops-communications.js', de: '        ? { text: String(communication.payload.texteEnvoye || communication.payload.textBody) }', vers: '        ? { text: String(communication.payload.textBody) }' },
    { nom: 'version texte signee sans le corps', cible: '[I] « Bien à vous, » en fin de texte : la version texte n ajoute pas de seconde formule',
      fichier: 'lib/ops-communications.js', de: '  const bloc = renderSignatureText({ design: gabarit, center, person: signature.person || null, corps });', vers: "  const bloc = renderSignatureText({ design: gabarit, center, person: signature.person || null, corps: '' });" },
    { nom: 'le numero de reservation perdu en texte', cible: '[I] sequence (confirmation enfilee) : le texte, son numero de reservation, puis la signature',
      fichier: 'lib/ops-communications.js', de: "texte: Array.isArray(message.details) ? texteAvecNumero(message.body, reservation) : message.body, corps: message.body,", vers: 'texte: message.body, corps: message.body,' },
    { nom: 'retrait avant la signature', cible: '[I] campagne : la signature avant la ligne de retrait, qui reste la derniere',
      fichier: 'lib/ops-communications.js', de: "[String(texte || '').replace(/\\s+$/, ''), bloc, retrait]", vers: "[String(texte || '').replace(/\\s+$/, ''), retrait, bloc]" },
    { nom: 'telephone eteint ecrit en texte', cible: '[I] interrupteurs : la ligne du telephone eteinte ne s ecrit pas dans la version texte',
      fichier: 'lib/ops-communications.js', de: "  const phone = afficher.telephone !== false ? String(sig.phone || '').trim() : '';\n  if (phone) lignes.push(phone);", vers: "  const phone = String(sig.phone || '').trim();\n  if (phone) lignes.push(phone);" },
    { nom: 'version signee malgre l interrupteur', cible: '[I] interrupteurs : signature coupee, case decochee ou portee eteinte, la version texte est le texte seul',
      fichier: 'lib/ops-communications.js', de: '  if (!signatureAllumee(gabarit, signature)) return { textBody };', vers: '  if (!gabarit) return { textBody };' },
    { nom: 'le texte de l auteur remplace', cible: '[I] le texte de l auteur reste seul dans textBody (le fil de Reçus et l apprentissage de l agent le relisent tel quel)',
      fichier: 'lib/ops-communications.js', de: '  return { textBody, texteEnvoye };', vers: '  return { textBody: texteEnvoye, texteEnvoye };' },
    // Les signatures d enseigne (2026-11-12).
    { nom: 'la banniere oubliee', cible: '[J] le vrai logo sans fond : la banniere en affiche, les lettres blanches sur la nuit de l arene, les lettres foncees sur le blanc de l enseigne, jamais le logo a carre',
      fichier: 'lib/ops-communications.js', de: '        const url = photoAffiche.banniere || photoAffiche.url;', vers: '        const url = photoAffiche.url;' },
    { nom: 'le logo a carre sur la nuit', cible: '[J] le vrai logo sans fond : la banniere en affiche, les lettres blanches sur la nuit de l arene, les lettres foncees sur le blanc de l enseigne, jamais le logo a carre',
      fichier: 'lib/ops-communications.js', de: '      const logoNuit = emailDesign.urlDImage(center?.branding?.emailLogoSansFondDark);', vers: '      const logoNuit = emailDesign.urlDImage(center?.branding?.emailLogoDark);' },
    { nom: 'l enseigne passe le budget d image', cible: '[J] enseigne avec un logo d en-tete : la signature ne pose pas d image',
      fichier: 'lib/ops-communications.js', de: '    if (logoJour && imagesRestantes > 0) {', vers: '    if (logoJour) {' },
    { nom: 'liens sombres sur la nuit', cible: '[J] arene : les liens en blanc sur la nuit, la formule dans la couleur de nuit du centre (sa fiche)',
      fichier: 'lib/ops-communications.js', de: "  if (disposition === 'arene') couleurLien = '#ffffff';", vers: '' },
    { nom: 'l accroche perdue a l enregistrement', cible: '[J] l accroche et la forme ecrites par le gerant se gardent a l enregistrement',
      fichier: 'lib/email-design.js', de: "    accroche: texte(sigSource.accroche, LIMITES.accroche, 'Accroche', sigDefauts.accroche),\n", vers: '' },
    // Le mode sombre et les designs d avant l affiche (2026-11-12).
    { nom: 'le logo blanc sans contour', cible: '[K] arene : le logo blanc a un contour de la couleur de la nuit, il reste lisible quand Gmail sur iPhone eclaircit le bloc',
      fichier: 'lib/ops-communications.js', de: '      const logoNuit = emailDesign.urlDImage(center?.branding?.emailLogoSansFondDark);', vers: "      const logoNuit = emailDesign.urlDImage('/assets/brand/logo-fun-galaxy-sans-fond-sombre.png');" },
    { nom: 'le logo fonce sans contour', cible: '[K] enseigne : le logo fonce a un contour blanc, il reste lisible quand Outlook ou Gmail Android assombrit le blanc',
      fichier: 'lib/ops-communications.js', de: '    const logoJour = emailDesign.urlDImage(center?.branding?.emailLogoSansFond);', vers: "    const logoJour = emailDesign.urlDImage('/assets/brand/logo-fun-galaxy-sans-fond-clair.png');" },
    { nom: 'l ancienne carte gardee', cible: '[K] le design enregistre le 03/11 (carte et site pre-remplis) se lit en affiche avec le site du centre, et garde son gabarit',
      fichier: 'lib/email-design.js', de: '  return normaliserEmailDesign(sansLesAnciensDefauts(stocke), center, { strict: false });', vers: '  return normaliserEmailDesign(stocke, center, { strict: false });' },
    { nom: 'la carte choisie perdue', cible: '[K] enregistree depuis l arrivee de l affiche, la carte est un vrai choix : elle reste, sans site',
      fichier: 'lib/email-design.js', de: '  const enregistreAvant = (moment) => !Number.isFinite(quand) || quand < moment;', vers: '  const enregistreAvant = () => true;' },
    // L apercu d Apparence de la capture d Ansar (2026-11-12).
    { nom: 'l ancienne encre gardee', cible: '[L] le design du 03/11 (encre pre-remplie) prend la couleur du centre, comme le defaut',
      fichier: 'lib/email-design.js', de: "  if (enregistreAvant(COULEUR_DU_CENTRE_DEPUIS) && accent && typeof accent === 'object' && accent.mode === 'encre') {", vers: '  if (false) {' },
    { nom: 'la note sous la signature', cible: '[L] la note du mail se lit avant la signature, qui ferme le mail',
      fichier: 'lib/ops-communications.js', de: '                ${actionButton(action, couleur)}\n', vers: "                ${actionButton(action, couleur)}\n                ${avecSignature ? MARQUE_SIGNATURE : ''}\n" },
    { nom: 'le ? seul en debut de ligne', cible: '[L] l espace avant ? ! : ; et dans les guillemets est insecable dans le mail, jamais dans une balise',
      fichier: 'lib/ops-communications.js', de: "    .replace(/ ([?!:;»])/g, `${INSECABLE}$1`)\n", vers: '' },
    { nom: 'la banniere a largeur fixe', cible: '[L] la banniere suit la largeur du mail, meme quand elle ne charge pas',
      fichier: 'lib/ops-communications.js', de: "${image(url, largeur, alt, 'border-radius:12px;', true)}", vers: "${image(url, largeur, alt, 'border-radius:12px;')}" },
    { nom: 'le grand format sur un mail automatique', cible: '[M] un grand format de campagne ne part jamais sur un mail automatique : il prend son repli de la boite principale',
      fichier: 'lib/email-gabarits.js', de: "  if (transactionnel && g.famille === 'campagne') return trouver(g.repli) || trouver('billet');\n", vers: '' },
    { nom: 'la photo d un autre centre', cible: '[M] la photo de l activite vient de la fiche du centre : laser a Gembloux, duckpin et formule a Libramont, aucune a Ciney qui n en a pas',
      fichier: 'lib/email-gabarits.js',
      de: 'function photoDeLActivite(center, activite, origine) {\n  const liste = center && center.branding && Array.isArray(center.branding.emailPhotosActivites) ? center.branding.emailPhotosActivites : [];',
      vers: "function photoDeLActivite(center, activite, origine) {\n  const liste = require('./ops-knowledge').getCenter('libramont').branding.emailPhotosActivites;" },
    { nom: 'la photo hors budget', cible: '[M] les douze gabarits, dans un mail automatique : deux liens et une image au plus',
      fichier: 'lib/ops-communications.js', de: 'images: Math.max(0, 1 - compter(/<img\\s/gi))', vers: 'images: 1' },
    { nom: 'un trait fin sous le billet', cible: '[M] aucun trait fin dans les sept gabarits de la galerie',
      fichier: 'lib/email-gabarits.js', de: 'style="background:${fonce};border-radius:0 0 16px 16px;padding:14px 24px 16px;">', vers: 'style="background:${fonce};border-radius:0 0 16px 16px;border-top:1px solid #ffffff;padding:14px 24px 16px;">' },
    { nom: 'le recapitulatif sous le texte', cible: '[M] billet, score et photo ouvrent sur le rendez-vous, avant le texte',
      fichier: 'lib/email-gabarits.js',
      de: ["  if (g.id === 'billet') {", '    corps = `${nomEnTete(p.accentTexte)}${sourcilSiUtile(THEME.inkSoft)}${titreSurRecap()}${p.billet(EN_TETE)}${o.corpsHtml}'].join(LF),
      vers: ["  if (g.id === 'billet') {", '    corps = `${nomEnTete(p.accentTexte)}${sourcilSiUtile(THEME.inkSoft)}${titreSurRecap()}${o.corpsHtml}${p.billet(EN_TETE)}'].join(LF) },
    { nom: 'une seconde photo au hasard', cible: '[M] le grand format : la seconde photo est de la meme activite que le titre, jamais le laser sous un titre bowling',
      fichier: 'lib/email-gabarits.js', de: ' && parle(p))', vers: ')' },
    { nom: 'le titre redit la date', cible: '[M] un titre qui redit la date du billet cede sa place au sourcil, un autre titre reste',
      fichier: 'lib/email-gabarits.js', de: "  const titreRedit = Boolean(r.date && String(o.eyebrow || '').trim() && plat(o.title).includes(plat(valeur(r.date))));", vers: '  const titreRedit = false;' },
    // Ce que Gmail et Outlook lisent (2026-11-12).
    { nom: 'le test sans sa version texte', cible: '[D] le test enfile part avec la vraie version texte du mail (le texte, son numero, la signature), pas une ligne de resume',
      fichier: 'lib/ops-communications.js',
      de: "payload: { textBody: preview.textBody, ...(preview.texteEnvoye ? { texteEnvoye: preview.texteEnvoye } : {}), test: true, sequence: 'design',",
      vers: "payload: { textBody: `Test du design (${preview.sample}) : ${preview.subject}`, test: true, sequence: 'design'," },
    { nom: 'une photo sans largeur', cible: '[N] Outlook : chaque image porte sa largeur (attribut width) et sa description',
      fichier: 'lib/email-gabarits.js', de: '<img src="${escapeHtml(url)}" width="${largeur}" alt=', vers: '<img src="${escapeHtml(url)}" alt=' },
    { nom: 'une vitrine en flex', cible: '[N] Outlook : ni flex, ni grid, ni position, ni float, ni image de fond, ni SVG',
      fichier: 'lib/email-gabarits.js', de: '<td class="fgx-vitrine-case" width="50%" valign="top" style="padding:', vers: '<td class="fgx-vitrine-case" width="50%" valign="top" style="display:flex;padding:' },
    { nom: 'un mot de promotion', cible: '[N] aucun mot de promotion dans un mail automatique (objet et texte)',
      fichier: 'lib/email-gabarits.js', de: "(Number(valeur(r.joueurs)) > 1 ? 'participants' : 'participant')", vers: "(Number(valeur(r.joueurs)) > 1 ? 'participants, entrée gratuite' : 'participant')" },
  ];
  const survivantes = [];
  for (const c of CAS) {
    mutations = [{ fichier: c.fichier, de: c.de, vers: c.vers }];
    let verdict = false;
    try {
      const mm = charger();
      resultats = new Map();
      const sortie = console.log;
      console.log = () => {};
      try { await controles(mm); } finally { console.log = sortie; }
      verdict = resultats.has(c.cible) && resultats.get(c.cible) === false;
    } catch (error) {
      verdict = false;
      console.log(`      (${c.nom} : ${error.message})`);
    } finally {
      resultats = null;
      mutations = [];
    }
    if (!verdict) survivantes.push(c.nom);
    ok(verdict, `[mutation] « ${c.nom} » (le gate ROUGIRAIT)`);
  }
  ok(survivantes.length === 0, '[mutation] aucune mutation ne survit', survivantes.join(', '));
  charger();

  console.log(failures ? `\n${failures} controle(s) en echec.` : '\nemail-signature-check: ALL OK');
  process.exit(failures ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

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
const MUTABLES = ['lib/email-design.js', 'lib/ops-communications.js'];
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
    REGLAGES.set('libramont', { email_design: valide });
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

  // =====================================================================
  console.log('\n[E] chaque centre ses couleurs et ses photos');
  // =====================================================================
  const designAutre = { ...m.design.getEmailDesignDefaults(AUTRE), accent: { mode: 'centre', hex: '' } };
  // Le design relu en base d un autre centre, qui reclamerait la photo de Fun Galaxy.
  const htmlAutre = await transactionnel(m.design.fusionnerEmailDesign({ ...designAutre, signature: { ...designAutre.signature, photo: { enabled: true, url: photoFG } } }, AUTRE), { center: AUTRE });
  ok(htmlAutre.includes('#0f6b4f') && !htmlAutre.toLowerCase().includes(ACCENT_FG) && !/\/assets\/mail\//.test(htmlAutre) && !/fun-galaxy/i.test(htmlAutre),
    '[E] un autre centre : sa couleur, jamais celle ni les photos de Fun Galaxy');
  const htmlFG = await transactionnel(defautsFG);
  ok(htmlFG.toLowerCase().includes(ACCENT_FG) && htmlFG.includes(photoFG), '[E] Fun Galaxy : sa couleur et sa photo, lues dans sa fiche');
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
  const entier = (corps, html) => corps.split('\n').map((l) => l.trim()).filter(Boolean).every((l) => html.includes(echapper(l)));
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
      fichier: 'lib/ops-communications.js', de: 'largeur: largeurDuCorps(preset), corps });', vers: "largeur: largeurDuCorps(preset), corps: '' });" },
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

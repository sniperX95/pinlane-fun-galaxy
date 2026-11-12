// LE DESIGN DES MAILS D UN CENTRE : gabarit, couleur d accent, en-tete, pied de
// page et signature (2026-09-16, refonte « Emails & relances » v4).
//
// Ce module ne rend rien : il DECRIT (defauts, gabarits disponibles) et il
// VALIDE. Le rendu vit dans lib/ops-communications.js (emailShell,
// renderSignatureHtml), qui consomme un design deja resolu.
//
// RIEN D INVENTE. Les defauts viennent du catalogue du centre
// (ops-knowledge/centers.json : publicInfo pour le telephone, l adresse et
// l email ; branding.emailLogo pour le logo ; branding.emailPhotos et
// branding.emailSignature pour la signature) ou restent VIDES. Un champ vide
// reste vide dans le mail : jamais un numero plausible, jamais un reseau social
// qu on suppose, jamais un logo ni une photo qui ne sont pas declares.
//
// Deux modes de validation, une seule liste de regles :
//   - stricte (validateEmailDesign) : ce que le gerant enregistre. Une valeur
//     hors regle leve une erreur francaise exposable ;
//   - indulgente (fusionnerEmailDesign) : ce qui est deja en base. Une valeur
//     devenue invalide (regle durcie, catalogue change) retombe sur le defaut
//     au lieu de bloquer tous les envois du centre.
'use strict';

const EMAIL_DESIGN_PRESETS = [
  { id: 'simple', label: 'Mail simple', description: 'Comme un mail ecrit a la main : pas de titre ni de cadre, le texte puis la signature.' },
  { id: 'classique', label: 'Classique', description: 'Carte blanche a filet fin sur fond gris, nom du centre en tete. Le gabarit historique.' },
  { id: 'epure', label: 'Epure', description: 'Pas de carte : fond blanc, grandes marges, un filet fin sous le titre.' },
  { id: 'carte', label: 'Carte', description: 'La carte classique avec une barre de couleur en haut.' },
  { id: 'contraste', label: 'Contraste', description: 'Bandeau d en-tete sombre avec le nom ou le logo blanc du centre.' },
];
const PRESET_IDS = EMAIL_DESIGN_PRESETS.map((preset) => preset.id);
const ACCENT_MODES = ['encre', 'centre', 'perso'];
const HEADER_MODES = ['nom', 'logo', 'logo-nom', 'aucun'];
// LA SIGNATURE B2C (lot 2, 2026-11-11) : trois dispositions.
//   - carte   : la photo du centre en bandeau (ou son logo quand la photo est
//               coupee), la formule en grand dans la couleur du centre,
//               l equipe, les coordonnees, les reseaux nommes, un trait de
//               couleur pour finir ;
//   - bandeau : un aplat de la couleur du centre avec le logo blanc, puis la
//               formule et les coordonnees ;
//   - ligne   : une ligne de texte, sans image.
// LES SIGNATURES D ENSEIGNE (2026-11-12, Ansar : « un truc jolie avec notre
// logo le vrai [...] design bowling laser game super beau avec info et tout »,
// puis « logo sans fond ») : le vrai logo detoure (branding.emailLogoSansFond,
// emailLogoSansFondDark), les vraies photos, l accroche du centre en typo
// d affiche, des aplats pleins.
//   - arene    : un bloc de nuit, le logo blanc, la formule, l accroche, les
//                coordonnees ;
//   - affiche  : la banniere du centre (son logo a cote d une vraie photo),
//                puis la formule et deux colonnes, nous joindre, nous trouver ;
//   - enseigne : l accroche sur un aplat de la couleur du centre, puis le logo
//                et les coordonnees sur le blanc du mail.
const SIGNATURE_LAYOUTS = ['carte', 'bandeau', 'ligne', 'arene', 'affiche', 'enseigne'];
// LES FORMULES DE FIN que la console propose en un toucher. Jamais « À très
// bientôt » : c est la formule que tout le monde ecrit, celle qui ne dit rien
// du centre. Un centre peut declarer la sienne dans le catalogue
// (branding.emailSignature.closing) : elle devient son defaut.
const FORMULES_DE_FIN = [
  'Funement vôtre,',
  'À très vite pour une nouvelle partie !',
  'On vous garde une piste !',
  'Rendez-vous sur les pistes !',
  'Au plaisir de vous revoir,',
];
const FORMULE_PAR_DEFAUT = 'Au plaisir de vous revoir,';
// L ANCIEN DEFAUT. Un design enregistre avant le lot 2 porte cette formule
// parce qu elle etait pre-remplie, pas parce que le gerant l a choisie : elle
// retombe sur le defaut du centre, a la lecture comme a l enregistrement.
const ANCIENNE_FORMULE = 'À très bientôt,';
// LES ANCIENS DEFAUTS DE LA DISPOSITION ET DU SITE (2026-11-12). Avant l'Affiche,
// l'Arene et l'Enseigne, un design enregistre portait la disposition 'carte' et un
// site vide parce qu'ils etaient pre-remplis : Apparence ne proposait ni ces
// dispositions ni le site du centre. Meme doctrine que ANCIENNE_FORMULE, mais A LA
// LECTURE seulement, et pour un design enregistre avant leur arrivee : enregistree
// depuis, la carte est un vrai choix et reste. Libramont avait enregistre le 03/11
// et gardait la carte des quilles malgre l'Affiche (lu en base le 12/11).
const NOUVELLES_DISPOSITIONS_DEPUIS = Date.parse('2026-11-12T03:51:00Z');
// L'ENCRE etait la couleur pre-remplie jusqu'au lot 2 (11/11 au soir), quand le
// catalogue a donne sa couleur au centre : le design de Libramont du 03/11 la
// portait, et son affiche sortait toute noire (capture d'Ansar du 12/11). Meme
// doctrine : avant le lot 2, l'encre retombe sur la couleur du centre ; choisie
// depuis, elle reste.
const COULEUR_DU_CENTRE_DEPUIS = Date.parse('2026-11-11T19:26:00Z');
function sansLesAnciensDefauts(stocke) {
  const quand = Date.parse(String(stocke.updatedAt || ''));
  const enregistreAvant = (moment) => !Number.isFinite(quand) || quand < moment;
  let relu = stocke;
  const signature = stocke.signature;
  if (enregistreAvant(NOUVELLES_DISPOSITIONS_DEPUIS) && signature && typeof signature === 'object' && !Array.isArray(signature)) {
    const relue = { ...signature };
    if (relue.layout === 'carte') delete relue.layout;
    if (typeof relue.website === 'string' && !relue.website.trim()) delete relue.website;
    relu = { ...relu, signature: relue };
  }
  const accent = stocke.accent;
  if (enregistreAvant(COULEUR_DU_CENTRE_DEPUIS) && accent && typeof accent === 'object' && accent.mode === 'encre') {
    relu = { ...relu };
    delete relu.accent;
  }
  return relu;
}
// Chaque ligne de coordonnees s allume ou s eteint, sans effacer sa valeur.
const AFFICHAGES = ['telephone', 'email', 'site', 'adresse', 'reseaux'];
const SOCIAL_DOMAINS = {
  facebook: 'facebook.com',
  instagram: 'instagram.com',
  tiktok: 'tiktok.com',
  linkedin: 'linkedin.com',
};
const LIMITES = {
  closing: 80,
  accroche: 90,
  teamLabel: 80,
  role: 80,
  phone: 40,
  email: 200,
  website: 200,
  address: 200,
  mention: 300,
  logoUrl: 500,
  logoWidth: [60, 300],
};
const HEX_RX = /^#[0-9a-f]{6}$/;
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// L origine publique de l application, pour rendre absolu un chemin du depot
// (`/assets/brand/...`) : un client mail ne sait pas resoudre un chemin
// relatif. PUBLIC_APP_ORIGIN prime, puis PUBLIC_APP_URL (la variable que le
// reste du depot lit deja), puis le domaine de la plateforme.
function origineApplication() {
  const brut = process.env.PUBLIC_APP_ORIGIN || process.env.PUBLIC_APP_URL || 'https://app.pinlane.be';
  return String(brut).trim().replace(/\/+$/, '');
}

function estCheminDuDepot(valeur) {
  return /^\/assets\/[A-Za-z0-9_./-]+$/.test(String(valeur || ''));
}

function urlHttpsValide(valeur) {
  let parsee = null;
  try { parsee = new URL(String(valeur || '')); } catch (error) { return null; }
  if (parsee.protocol !== 'https:') return null;
  return parsee;
}

// Une URL d image acceptee : https, ou un chemin du depot. Rendue absolue.
function urlDImage(valeur) {
  const brut = String(valeur || '').trim();
  if (!brut) return '';
  if (estCheminDuDepot(brut)) return `${origineApplication()}${brut}`;
  return urlHttpsValide(brut) ? brut : '';
}

// L adresse postale du centre, comme le pied de page l ecrit deja : l adresse
// du catalogue contient souvent la ville, on ne la recolle que si elle manque.
function adressePostaleDuCentre(center) {
  const info = (center && center.publicInfo) || {};
  const address = String(info.address || '').trim();
  const city = String(info.city || '').trim();
  if (address && city && !address.toLowerCase().includes(city.toLowerCase())) return `${address}, ${city}`;
  return address || city;
}

// Le site public du centre, tel que son identite le declare, en https seulement.
function siteDuCentre(center) {
  const brut = String((center && center.identity && center.identity.siteUrl) || '').trim();
  return brut.length <= LIMITES.website && urlHttpsValide(brut) ? brut : '';
}

// Les images que le centre peut poser dans ses mails : uniquement celles que le
// catalogue declare. Aucune image n est proposee a un centre qui n en a pas.
function logosDisponibles(center) {
  const branding = (center && center.branding) || {};
  const logos = [];
  const clair = urlDImage(branding.emailLogo);
  const sombre = urlDImage(branding.emailLogoDark);
  if (clair) logos.push({ label: 'Logo du centre (fond clair)', url: clair });
  if (sombre) logos.push({ label: 'Logo du centre (fond sombre)', url: sombre });
  return logos;
}

// Les photos que la signature peut porter : celles que le catalogue declare
// (branding.emailPhotos), servies par notre domaine (un chemin du depot) et
// decrites (le texte alternatif est obligatoire, c est lui qu un client mail
// montre quand il bloque les images). Rien d autre : ni une adresse collee, ni
// une photo d un autre centre.
function photosDisponibles(center) {
  const liste = center && center.branding && Array.isArray(center.branding.emailPhotos) ? center.branding.emailPhotos : [];
  return liste
    .filter((photo) => photo && estCheminDuDepot(photo.url) && String(photo.alt || '').trim())
    .map((photo) => ({
      url: `${origineApplication()}${photo.url}`,
      alt: String(photo.alt).trim(),
      label: String(photo.label || photo.alt).trim(),
      // La banniere de la disposition « affiche » : la meme activite, avec le
      // logo du centre deja pose a cote (une seule image dans le mail).
      banniere: estCheminDuDepot(photo.banniere) && String(photo.banniereAlt || '').trim() ? `${origineApplication()}${photo.banniere}` : '',
      banniereAlt: String(photo.banniereAlt || '').trim(),
    }));
}

// Les couleurs que le centre declare, dans l ordre ou la console les propose.
// La premiere est « la couleur du centre » ; un centre sans couleur n en
// propose aucune et signe a l encre.
function couleursDuCentre(center) {
  const branding = (center && center.branding) || {};
  const vues = new Set();
  const couleurs = [];
  for (const [cle, label] of [['accent', 'La couleur du centre'], ['glow', 'Sa deuxième couleur'], ['accentStrong', 'Sa couleur foncée']]) {
    const hex = String(branding[cle] || '').trim().toLowerCase();
    if (!HEX_RX.test(hex) || vues.has(hex)) continue;
    vues.add(hex);
    couleurs.push({ cle, label, hex });
  }
  return couleurs;
}

// Ce que le catalogue dit du design d un centre (branding.emailDesign) : sa
// couleur d accent, et pour la signature sa formule, sa disposition, sa photo.
// Rien d autre n est lu ; ce qui n y est pas reste au defaut commun, sobre.
function designDuCatalogue(center) {
  const brut = center && center.branding && center.branding.emailDesign;
  const design = brut && typeof brut === 'object' ? brut : {};
  const signature = design.signature && typeof design.signature === 'object' ? design.signature : {};
  return {
    accent: String(design.accent || ''),
    closing: String(signature.closing || '').trim(),
    accroche: String(signature.accroche || '').trim(),
    layout: String(signature.layout || ''),
    photo: String(signature.photo || ''),
  };
}

function getEmailDesignDefaults(center = null) {
  const info = (center && center.publicInfo) || {};
  const branding = (center && center.branding) || {};
  const catalogue = designDuCatalogue(center);
  const formule = catalogue.closing;
  const photo = photosDisponibles(center).find((p) => p.url === urlDImage(catalogue.photo)) || null;
  // La couleur du centre par defaut seulement s il la declare ET la demande :
  // le gabarit commun reste a l encre.
  const accentCentre = catalogue.accent === 'centre' && couleursDuCentre(center).some((c) => c.cle === 'accent');
  return {
    preset: 'simple',
    accent: { mode: accentCentre ? 'centre' : 'encre', hex: '' },
    header: { mode: 'nom', logoUrl: '', logoWidth: 140 },
    footer: { adresse: true, telephone: true, email: true, mention: '' },
    signature: {
      enabled: true,
      closing: formule && formule.length <= LIMITES.closing && formule !== ANCIENNE_FORMULE ? formule : FORMULE_PAR_DEFAUT,
      // Les activites du centre en une ligne d affiche (« Bowling · Laser game · … »),
      // ecrites dans le catalogue : rien n est devine.
      accroche: catalogue.accroche && catalogue.accroche.length <= LIMITES.accroche ? catalogue.accroche : '',
      // Vide = « L équipe » + nom du centre, calcule au rendu.
      teamLabel: '',
      role: '',
      phone: String(info.phone || '').trim(),
      email: String(info.email || '').trim(),
      // Le site du centre (identity.siteUrl), la ou le client reserve.
      website: siteDuCentre(center),
      address: adressePostaleDuCentre(center),
      logoUrl: urlDImage(branding.emailLogo),
      logoWidth: 120,
      socials: { facebook: '', instagram: '', tiktok: '', linkedin: '' },
      layout: SIGNATURE_LAYOUTS.includes(catalogue.layout) ? catalogue.layout : 'carte',
      photo: { enabled: Boolean(photo), url: photo ? photo.url : '' },
      afficher: { telephone: true, email: true, site: true, adresse: true, reseaux: true },
    },
    signatureScope: { manual: true, sequences: true, campaigns: false },
    updatedAt: null,
    updatedBy: '',
  };
}

function erreurExposable(message) {
  const error = new Error(message);
  error.expose = true;
  error.statusCode = 400;
  return error;
}

// UNE SEULE LISTE DE REGLES, deux modes. `probleme` leve en mode strict et
// rend le repli en mode indulgent : la meme regle protege l enregistrement
// (le gerant voit l erreur) et la lecture (un envoi ne bloque jamais).
function normaliserEmailDesign(brouillon, center, { strict = true } = {}) {
  const defauts = getEmailDesignDefaults(center);
  const source = brouillon && typeof brouillon === 'object' ? brouillon : {};
  const probleme = (message, repli) => {
    if (strict) throw erreurExposable(message);
    return repli;
  };
  const objet = (valeur) => (valeur && typeof valeur === 'object' ? valeur : {});
  const texte = (valeur, max, libelle, repli) => {
    if (valeur === undefined || valeur === null) return repli;
    // Les tirets longs (cadratin U+2014, demi-cadratin U+2013) deviennent un
    // trait d union : la maison n en ecrit jamais, un texte colle en porte.
    const propre = String(valeur).replace(new RegExp(`[${String.fromCharCode(0x2014, 0x2013)}]`, 'g'), '-').trim();
    if (propre.length > max) return probleme(`${libelle} : ${max} caractères maximum.`, repli);
    return propre;
  };
  const booleen = (valeur, repli) => (typeof valeur === 'boolean' ? valeur : repli);
  const largeur = (valeur, libelle, repli) => {
    if (valeur === undefined || valeur === null || valeur === '') return repli;
    const nombre = Number(valeur);
    const [min, max] = LIMITES.logoWidth;
    if (!Number.isInteger(nombre) || nombre < min || nombre > max) return probleme(`${libelle} : largeur entre ${min} et ${max} pixels.`, repli);
    return nombre;
  };
  const image = (valeur, libelle, repli) => {
    if (valeur === undefined || valeur === null) return repli;
    const brut = String(valeur).trim();
    if (!brut) return '';
    if (brut.length > LIMITES.logoUrl) return probleme(`${libelle} : ${LIMITES.logoUrl} caractères maximum.`, repli);
    const url = urlDImage(brut);
    if (!url) return probleme(`${libelle} : seule une adresse https (ou une image du site) est acceptée.`, repli);
    return url;
  };

  // Gabarit.
  const presetBrut = source.preset === undefined ? defauts.preset : String(source.preset || '');
  const preset = PRESET_IDS.includes(presetBrut) ? presetBrut : probleme('Gabarit inconnu.', defauts.preset);

  // Accent.
  const accentSource = objet(source.accent);
  const modeAccentBrut = accentSource.mode === undefined ? defauts.accent.mode : String(accentSource.mode || '');
  let modeAccent = ACCENT_MODES.includes(modeAccentBrut) ? modeAccentBrut : probleme('Couleur d accent : choix inconnu.', defauts.accent.mode);
  let hex = '';
  if (modeAccent === 'perso') {
    const hexBrut = String(accentSource.hex || '').trim().toLowerCase();
    if (HEX_RX.test(hexBrut)) hex = hexBrut;
    else {
      // En mode indulgent, une couleur illisible retombe sur l encre.
      probleme('Couleur personnalisée : écrivez une couleur au format #rrggbb.', '');
      modeAccent = 'encre';
    }
  }

  // En-tete.
  const headerSource = objet(source.header);
  const modeHeaderBrut = headerSource.mode === undefined ? defauts.header.mode : String(headerSource.mode || '');
  const header = {
    mode: HEADER_MODES.includes(modeHeaderBrut) ? modeHeaderBrut : probleme('En-tête : choix inconnu.', defauts.header.mode),
    logoUrl: image(headerSource.logoUrl, 'Logo d en-tête', defauts.header.logoUrl),
    logoWidth: largeur(headerSource.logoWidth, 'Logo d en-tête', defauts.header.logoWidth),
  };

  // Pied de page.
  const footerSource = objet(source.footer);
  const footer = {
    adresse: booleen(footerSource.adresse, defauts.footer.adresse),
    telephone: booleen(footerSource.telephone, defauts.footer.telephone),
    email: booleen(footerSource.email, defauts.footer.email),
    mention: texte(footerSource.mention, LIMITES.mention, 'Mention de pied de page', defauts.footer.mention),
  };

  // Signature.
  const sigSource = objet(source.signature);
  const sigDefauts = defauts.signature;
  const emailSignature = texte(sigSource.email, LIMITES.email, 'Email de la signature', sigDefauts.email);
  const website = texte(sigSource.website, LIMITES.website, 'Site web', sigDefauts.website);
  const socialsSource = objet(sigSource.socials);
  const socials = {};
  for (const [reseau, domaine] of Object.entries(SOCIAL_DOMAINS)) {
    const brut = socialsSource[reseau] === undefined ? sigDefauts.socials[reseau] : String(socialsSource[reseau] || '').trim();
    if (!brut) { socials[reseau] = ''; continue; }
    const parsee = brut.length <= LIMITES.website ? urlHttpsValide(brut) : null;
    const hote = parsee ? parsee.hostname.toLowerCase() : '';
    const bonDomaine = hote === domaine || hote.endsWith(`.${domaine}`);
    socials[reseau] = parsee && bonDomaine ? brut : probleme(`Réseau ${reseau} : une adresse https sur ${domaine} est attendue.`, '');
  }
  const layoutBrut = sigSource.layout === undefined ? sigDefauts.layout : String(sigSource.layout || '');
  const closingBrut = texte(sigSource.closing, LIMITES.closing, 'Formule de politesse', sigDefauts.closing);
  // La photo : une de celles que le catalogue declare pour CE centre.
  const photoSource = objet(sigSource.photo);
  const photos = photosDisponibles(center);
  const photoUrlBrute = photoSource.url === undefined || photoSource.url === null ? sigDefauts.photo.url : String(photoSource.url).trim();
  const photoUrl = !photoUrlBrute || photos.some((p) => p.url === urlDImage(photoUrlBrute))
    ? urlDImage(photoUrlBrute)
    : probleme('Photo de la signature : choisissez une des photos du centre.', sigDefauts.photo.url);
  const photoAllumee = booleen(photoSource.enabled, sigDefauts.photo.enabled);
  const afficherSource = objet(sigSource.afficher);
  const afficher = {};
  for (const cle of AFFICHAGES) afficher[cle] = booleen(afficherSource[cle], sigDefauts.afficher[cle]);
  const signature = {
    enabled: booleen(sigSource.enabled, sigDefauts.enabled),
    closing: closingBrut === ANCIENNE_FORMULE ? sigDefauts.closing : closingBrut,
    accroche: texte(sigSource.accroche, LIMITES.accroche, 'Accroche', sigDefauts.accroche),
    teamLabel: texte(sigSource.teamLabel, LIMITES.teamLabel, 'Nom d équipe', sigDefauts.teamLabel),
    role: texte(sigSource.role, LIMITES.role, 'Fonction', sigDefauts.role),
    phone: texte(sigSource.phone, LIMITES.phone, 'Téléphone', sigDefauts.phone),
    email: !emailSignature || EMAIL_RX.test(emailSignature) ? emailSignature : probleme('Email de la signature : adresse invalide.', sigDefauts.email),
    website: !website || urlHttpsValide(website) ? website : probleme('Site web : une adresse https est attendue.', sigDefauts.website),
    address: texte(sigSource.address, LIMITES.address, 'Adresse', sigDefauts.address),
    logoUrl: image(sigSource.logoUrl, 'Logo de la signature', sigDefauts.logoUrl),
    logoWidth: largeur(sigSource.logoWidth, 'Logo de la signature', sigDefauts.logoWidth),
    socials,
    layout: SIGNATURE_LAYOUTS.includes(layoutBrut) ? layoutBrut : probleme('Disposition de la signature : choix inconnu.', sigDefauts.layout),
    // Une photo allumee sans photo choisie s eteint : jamais un cadre vide.
    photo: { enabled: Boolean(photoAllumee && photoUrl), url: photoUrl },
    afficher,
  };

  const scopeSource = objet(source.signatureScope);
  const signatureScope = {
    manual: booleen(scopeSource.manual, defauts.signatureScope.manual),
    sequences: booleen(scopeSource.sequences, defauts.signatureScope.sequences),
    campaigns: booleen(scopeSource.campaigns, defauts.signatureScope.campaigns),
  };

  return {
    preset,
    accent: { mode: modeAccent, hex },
    header,
    footer,
    signature,
    signatureScope,
    updatedAt: source.updatedAt || null,
    updatedBy: String(source.updatedBy || '').slice(0, 80),
  };
}

// Ce que le gerant enregistre : strict, erreurs FR exposables.
function validateEmailDesign(brouillon, center = null) {
  return normaliserEmailDesign(brouillon, center, { strict: true });
}

// Ce qui est en base, fusionne sur les defauts du centre : indulgent.
function fusionnerEmailDesign(stocke, center = null) {
  if (!stocke || typeof stocke !== 'object') return getEmailDesignDefaults(center);
  return normaliserEmailDesign(sansLesAnciensDefauts(stocke), center, { strict: false });
}

// La couleur d accent effective d un design resolu. `centre` lit le catalogue
// (branding.accent) et retombe sur l encre si le centre n en declare pas.
function accentEffectif(design, center, encre) {
  const accent = (design && design.accent) || {};
  if (accent.mode === 'perso' && HEX_RX.test(String(accent.hex || ''))) return String(accent.hex);
  if (accent.mode === 'centre') {
    const brut = String((center && center.branding && center.branding.accent) || '').trim().toLowerCase();
    if (HEX_RX.test(brut)) return brut;
  }
  return encre;
}

module.exports = {
  EMAIL_DESIGN_PRESETS,
  SIGNATURE_LAYOUTS,
  FORMULES_DE_FIN,
  ANCIENNE_FORMULE,
  getEmailDesignDefaults,
  validateEmailDesign,
  fusionnerEmailDesign,
  accentEffectif,
  couleursDuCentre,
  logosDisponibles,
  photosDisponibles,
  urlDImage,
  origineApplication,
  adressePostaleDuCentre,
};

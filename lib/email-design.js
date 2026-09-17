// LE DESIGN DES MAILS D UN CENTRE : gabarit, couleur d accent, en-tete, pied de
// page et signature (2026-09-16, refonte « Emails & relances » v4).
//
// Ce module ne rend rien : il DECRIT (defauts, gabarits disponibles) et il
// VALIDE. Le rendu vit dans lib/ops-communications.js (emailShell,
// renderSignatureHtml), qui consomme un design deja resolu.
//
// RIEN D INVENTE. Les defauts viennent du catalogue du centre
// (ops-knowledge/centers.json : publicInfo pour le telephone, l adresse et
// l email ; branding.emailLogo pour le logo) ou restent VIDES. Un champ vide
// reste vide dans le mail : jamais un numero plausible, jamais un reseau social
// qu on suppose, jamais un logo qui n est pas declare.
//
// Deux modes de validation, une seule liste de regles :
//   - stricte (validateEmailDesign) : ce que le gerant enregistre. Une valeur
//     hors regle leve une erreur francaise exposable ;
//   - indulgente (fusionnerEmailDesign) : ce qui est deja en base. Une valeur
//     devenue invalide (regle durcie, catalogue change) retombe sur le defaut
//     au lieu de bloquer tous les envois du centre.
'use strict';

const EMAIL_DESIGN_PRESETS = [
  { id: 'classique', label: 'Classique', description: 'Carte blanche a filet fin sur fond gris, nom du centre en tete. Le gabarit historique.' },
  { id: 'epure', label: 'Epure', description: 'Pas de carte : fond blanc, grandes marges, un filet fin sous le titre.' },
  { id: 'carte', label: 'Carte', description: 'La carte classique avec une barre de couleur en haut.' },
  { id: 'contraste', label: 'Contraste', description: 'Bandeau d en-tete sombre avec le nom ou le logo blanc du centre.' },
];
const PRESET_IDS = EMAIL_DESIGN_PRESETS.map((preset) => preset.id);
const ACCENT_MODES = ['encre', 'centre', 'perso'];
const HEADER_MODES = ['nom', 'logo', 'logo-nom', 'aucun'];
const SIGNATURE_LAYOUTS = ['carte', 'ligne'];
const SOCIAL_DOMAINS = {
  facebook: 'facebook.com',
  instagram: 'instagram.com',
  tiktok: 'tiktok.com',
  linkedin: 'linkedin.com',
};
const LIMITES = {
  closing: 80,
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

function getEmailDesignDefaults(center = null) {
  const info = (center && center.publicInfo) || {};
  const branding = (center && center.branding) || {};
  return {
    preset: 'classique',
    accent: { mode: 'encre', hex: '' },
    header: { mode: 'nom', logoUrl: '', logoWidth: 140 },
    footer: { adresse: true, telephone: true, email: true, mention: '' },
    signature: {
      enabled: true,
      closing: 'À très bientôt,',
      // Vide = « L équipe » + nom du centre, calcule au rendu.
      teamLabel: '',
      role: '',
      phone: String(info.phone || '').trim(),
      email: String(info.email || '').trim(),
      website: '',
      address: adressePostaleDuCentre(center),
      logoUrl: urlDImage(branding.emailLogo),
      logoWidth: 120,
      socials: { facebook: '', instagram: '', tiktok: '', linkedin: '' },
      layout: 'carte',
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
  const signature = {
    enabled: booleen(sigSource.enabled, sigDefauts.enabled),
    closing: texte(sigSource.closing, LIMITES.closing, 'Formule de politesse', sigDefauts.closing),
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
  return normaliserEmailDesign(stocke, center, { strict: false });
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
  getEmailDesignDefaults,
  validateEmailDesign,
  fusionnerEmailDesign,
  accentEffectif,
  logosDisponibles,
  urlDImage,
  origineApplication,
  adressePostaleDuCentre,
};

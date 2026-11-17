'use strict';

// L HABILLAGE DU FORMULAIRE EN LIGNE (2026-11-17).
//
// La page de reservation (fungalaxy.html) portait le premier client en dur : le titre de l onglet, le
// logo et son lien, le violet et la sarcelle, « Carte Fun Galaxy ». Tout autre centre les aurait
// montres. L habillage est maintenant une DONNEE du centre, calculee ICI et nulle part ailleurs : la
// page est neutre, et ce module dit ce qu elle montre pour un centre donne.
//
// Ce qu il lit : le nom et la ville du centre, son `identity` (logo, site) et son `branding` (accent,
// seconde couleur `glow`, et les teintes du formulaire quand elles ont ete reglees a la main dans
// `branding.formulaire`). Ce qu il rend : un objet plat, le MEME pour la reponse du serveur
// (api/public-booking-meta, `center.habillage`) et pour les instantanes servis avant le premier
// affichage (assets/habillage/<centre>.js, ecrits par scripts/habillage-instantanes.js).
//
// LES COULEURS SE CALCULENT, LES CONTRASTES SE GARANTISSENT. Un centre declare une couleur, deux au
// plus. La feuille du formulaire en consomme sept. Les cinq autres sont derivees ici, et chacune est
// poussee jusqu a rester lisible la ou la feuille l emploie : du blanc sur l accent, l encre sur le
// fond noir, un texte sombre sur la seconde couleur. Une teinte reglee a la main passe telle quelle.
// Sans accent declare : `couleurs` vaut null et la page garde ses couleurs neutres.

const { normalizeBranding, normalizeIdentity } = require('./center-config');

const HEX = /^#[0-9a-f]{6}$/i;
// Le fond du formulaire, le blanc de ses boutons, le texte sombre qu il pose sur la seconde couleur.
const FOND = '#050505';
const BLANC = '#ffffff';
const NOIR = '#000000';
const SUR_SECOND = '#04110f';
// Les teintes qu un centre peut regler a la main (branding.formulaire).
const TEINTES_REGLEES = ['accentVif', 'accentEncre', 'accentTitre', 'secondEncre', 'secondSombre'];
// Les couleurs neutres de la page, quand le centre n a rien declare : l accent de la plateforme.
// La feuille (assets/fungalaxy-booking.css, :root) porte les MEMES valeurs ; le gate les compare.
const ACCENT_NEUTRE = '#0070f3';

const hexOuVide = (valeur) => (HEX.test(String(valeur || '').trim()) ? String(valeur).trim().toLowerCase() : '');
const rvb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hexDe = (canaux) => `#${canaux.map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('')}`;
// `part` de `vers` dans `couleur` (0 = la couleur, 1 = `vers`).
function melanger(couleur, vers, part) {
  const a = rvb(couleur);
  const b = rvb(vers);
  return hexDe(a.map((c, i) => c + (b[i] - c) * part));
}
function luminance(hex) {
  const [r, g, b] = rvb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contraste(a, b) {
  const [clair, sombre] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (clair + 0.05) / (sombre + 0.05);
}
// Pousse `couleur` vers `vers` par petits pas jusqu a atteindre `cible` contre `contre`.
function jusquA(couleur, vers, cible, contre) {
  for (let pas = 0; pas <= 25; pas += 1) {
    const essai = melanger(couleur, vers, pas / 25);
    if (contraste(essai, contre) >= cible) return essai;
  }
  return vers;
}

function couleursDepuis(accentDeclare, secondDeclare, reglees) {
  const r = reglees || {};
  // Le formulaire ecrit en blanc sur l accent (ses boutons) : un accent trop clair est fonce. Et ses
  // boutons se detachent du fond noir : un accent trop sombre est eclairci.
  const accent = jusquA(jusquA(accentDeclare, NOIR, 4.5, BLANC), BLANC, 3, FOND);
  const accentVif = r.accentVif || jusquA(melanger(accent, BLANC, 0.18), NOIR, 3, BLANC);
  // Le titre et l encre s ecrivent sur le fond noir.
  const accentTitre = r.accentTitre || jusquA(melanger(accent, BLANC, 0.28), BLANC, 4.5, FOND);
  const accentEncre = r.accentEncre || jusquA(melanger(accent, BLANC, 0.48), BLANC, 7, FOND);
  // La seconde couleur porte un texte sombre (le nom du centre, l ombre des boutons). Un centre qui
  // n en declare pas recoit un ton clair de son accent : une seule famille de couleurs.
  const second = jusquA(secondDeclare || melanger(accent, BLANC, 0.55), BLANC, 4.5, SUR_SECOND);
  const secondEncre = r.secondEncre || jusquA(melanger(second, BLANC, 0.3), BLANC, 7, FOND);
  const secondSombre = r.secondSombre || melanger(second, NOIR, 0.3);
  return { accent, accentVif, accentEncre, accentTitre, second, secondEncre, secondSombre };
}

function couleursDuFormulaire(branding) {
  const b = normalizeBranding(branding) || {};
  const sombre = b.dark || {};
  const accent = hexOuVide(sombre.accent) || hexOuVide(b.accent);
  if (!accent) return null;
  const reglees = {};
  TEINTES_REGLEES.forEach((cle) => { const v = hexOuVide(b.formulaire && b.formulaire[cle]); if (v) reglees[cle] = v; });
  return couleursDepuis(accent, hexOuVide(sombre.glow) || hexOuVide(b.glow), reglees);
}
const couleursNeutres = () => couleursDepuis(ACCENT_NEUTRE, '', {});

const texte = (valeur, max) => String(valeur || '').replace(/[\u0000-\u001f<>]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

// LA MARQUE : « Fun Galaxy Libramont » a Libramont se dit « Fun Galaxy ». Sans ville saisie,
// l identifiant du centre en tient lieu (« ciney »). Un nom qui ne finit ni par sa ville ni par son
// identifiant n a pas de marque a part : le centre se nomme en entier.
function marqueDuCentre(nom, ville, id) {
  const fins = [ville, String(id || '').replace(/-/g, ' ')].map((f) => String(f || '').trim()).filter(Boolean);
  for (const fin of fins) {
    if (nom.length <= fin.length || !nom.toLowerCase().endsWith(fin.toLowerCase())) continue;
    const marque = nom.slice(0, nom.length - fin.length).replace(/[\s,·-]+$/, '').trim();
    if (marque) return marque;
  }
  return '';
}

function habillageDuFormulaire(centre) {
  const c = centre && typeof centre === 'object' ? centre : {};
  const nom = texte(c.name, 80);
  const ville = texte(c.city, 60);
  const marque = marqueDuCentre(nom, ville, c.id);
  const identite = normalizeIdentity(c.identity) || {};
  const out = {
    centre: texte(c.id, 60),
    nom,
    // L onglet : « Réserver à Libramont · Fun Galaxy », « Réserver · Bowling Atlas », sinon neutre.
    titre: marque && ville ? `Réserver à ${ville} · ${marque}` : nom ? `Réserver · ${nom}` : 'Réserver en ligne',
    // La carte de jeu des arcades porte la marque quand le centre en a une.
    carte: marque ? `Carte ${marque}` : 'Carte de jeu',
    logo: identite.logoUrl || '',
    logoSurSombre: identite.logoOnDark === true,
    logoAlt: marque || nom,
    site: identite.siteUrl || '',
    couleurs: couleursDuFormulaire(c.branding),
  };
  return out;
}

module.exports = {
  ACCENT_NEUTRE,
  FOND,
  SUR_SECOND,
  TEINTES_REGLEES,
  contraste,
  couleursDuFormulaire,
  couleursNeutres,
  habillageDuFormulaire,
  marqueDuCentre,
};

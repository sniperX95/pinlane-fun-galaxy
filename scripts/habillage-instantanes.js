'use strict';

// LES INSTANTANES DE L HABILLAGE (2026-11-17).
//
// La page de reservation est neutre et recoit l habillage de son centre du serveur. Pour qu un centre
// connu du depot s affiche a ses couleurs des la premiere image, sans attendre cette reponse, son
// habillage est aussi servi comme un fichier : assets/habillage/<centre>.js, charge par
// assets/fungalaxy-habillage.js avant le premier affichage.
//
// Ce script les ecrit depuis ops-knowledge/centers.json, par la MEME fonction que le serveur
// (lib/habillage-formulaire.js). Il ajoute la taille du logo quand le fichier est dans le depot : la
// page garde sa place avant qu il arrive.
//
//   node scripts/habillage-instantanes.js             ecrit les fichiers
//   node scripts/habillage-instantanes.js --verifier  ne touche a rien, sort en erreur s ils ne sont plus a jour
//
// Un centre cree dans la console n a pas d instantane : sa page est neutre le temps de la premiere
// reponse du serveur, puis son navigateur garde son habillage.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DOSSIER = path.join(ROOT, 'assets', 'habillage');
const { habillageDuFormulaire } = require('../lib/habillage-formulaire');

function tailleDuLogo(adresse) {
  if (!/^\/assets\//.test(String(adresse || ''))) return null;
  const fichier = path.join(ROOT, adresse.replace(/^\//, ''));
  if (!fs.existsSync(fichier)) return null;
  if (/\.svg$/i.test(fichier)) {
    const tete = (fs.readFileSync(fichier, 'utf8').match(/<svg\b[^>]*>/i) || [''])[0];
    const boite = (tete.match(/viewBox\s*=\s*"([^"]+)"/i) || [])[1];
    const nombres = boite ? boite.trim().split(/[\s,]+/).map(Number) : [];
    if (nombres.length === 4 && nombres[2] > 0 && nombres[3] > 0) return [Math.round(nombres[2]), Math.round(nombres[3])];
    return null;
  }
  if (/\.png$/i.test(fichier)) {
    const octets = fs.readFileSync(fichier);
    if (octets.length > 24 && octets.toString('ascii', 12, 16) === 'IHDR') return [octets.readUInt32BE(16), octets.readUInt32BE(20)];
  }
  return null;
}

function instantanes() {
  const centres = require('../ops-knowledge/centers.json').centers;
  return centres.map((centre) => {
    const h = habillageDuFormulaire({
      id: centre.id,
      name: centre.name,
      city: centre.publicInfo && centre.publicInfo.city,
      identity: centre.identity,
      branding: centre.branding,
    });
    const taille = tailleDuLogo(h.logo);
    if (taille) h.logoTaille = taille;
    const contenu = `/* Habillage de ${centre.id}, ecrit par scripts/habillage-instantanes.js depuis ops-knowledge/centers.json : ne pas editer. */\nwindow.PinlaneHabillage&&window.PinlaneHabillage.instantane(${JSON.stringify(h)});\n`;
    return { id: centre.id, fichier: path.join(DOSSIER, `${centre.id}.js`), contenu, habillage: h };
  });
}

function ecarts() {
  const attendus = instantanes();
  const out = [];
  attendus.forEach((a) => {
    const lu = fs.existsSync(a.fichier) ? fs.readFileSync(a.fichier, 'utf8').split('\r\n').join('\n') : null;
    if (lu !== a.contenu) out.push(`${path.relative(ROOT, a.fichier)} ${lu === null ? 'manque' : 'n est plus a jour'}`);
  });
  const voulus = new Set(attendus.map((a) => path.basename(a.fichier)));
  (fs.existsSync(DOSSIER) ? fs.readdirSync(DOSSIER) : []).forEach((nom) => { if (!voulus.has(nom)) out.push(`assets/habillage/${nom} ne correspond a aucun centre du depot`); });
  return out;
}

if (require.main === module) {
  if (process.argv.includes('--verifier')) {
    const e = ecarts();
    if (e.length) { console.error(`habillage-instantanes : ${e.join(' ; ')}. Relancer node scripts/habillage-instantanes.js`); process.exit(1); }
    console.log('habillage-instantanes : a jour');
  } else {
    fs.mkdirSync(DOSSIER, { recursive: true });
    instantanes().forEach((a) => { fs.writeFileSync(a.fichier, a.contenu); console.log('ecrit', path.relative(ROOT, a.fichier)); });
  }
}

module.exports = { instantanes, ecarts, tailleDuLogo };

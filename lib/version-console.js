// LA VERSION D UNE CONSOLE (2026-11-13, Ansar : « quand je fais des modifs je reçois des alertes
// genre 5-10 après »). Apres une mise en ligne, les consoles restees ouvertes tournent encore sur
// l ancien code : leurs erreurs sont souvent deja corrigees dans la version en ligne, et chacune
// sonnait. Une console qui n est pas sur la version servie ne fait plus d alerte (son erreur reste
// enregistree dans les Incidents).
//
// La version, c est l empreinte des numeros de version (?v=) des fichiers /assets/ que la page
// charge, dans leur ordre. La console la calcule au chargement (assets/app-main.js,
// VERSION_DE_LA_CONSOLE, le meme calcul) et l envoie avec son erreur ; le serveur la calcule sur
// la page qu il sert en ce moment. Toute mise en ligne qui change un fichier de la console change
// au moins un ?v= (memoire asset-modifie-monte-sa-version).
'use strict';

const { adresseDeLaConsole } = require('./alertes-texte');

// djb2, en base 36 : le meme calcul que la console, sans dependance.
function empreinte(texte) {
  let h = 5381;
  for (const c of String(texte)) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0;
  return h.toString(36);
}
function versionDesSources(sources) {
  const numeros = (sources || []).filter((s) => /^\/assets\//.test(String(s))).map((s) => (String(s).match(/[?&]v=([0-9A-Za-z._-]+)/) || [])[1]).filter(Boolean);
  return numeros.length ? empreinte(numeros.join(',')) : '';
}
// La version d une page HTML servie : ses balises <script src>, commentaires retires.
function versionDeLaPage(html) {
  const sans = String(html || '').replace(/<!--[\s\S]*?-->/g, '');
  return versionDesSources([...sans.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)].map((m) => m[1]));
}

// La version servie en ce moment, relue au plus toutes les 5 minutes. Illisible : '' (on ne sait
// pas, et une erreur qu on ne sait pas classer reste une alerte).
const DUREE_MS = 5 * 60_000;
let memoire = { version: '', jusqua: 0 };
async function versionServie({ env = process.env, fetcher = fetch, maintenant = Date.now() } = {}) {
  if (memoire.version && maintenant < memoire.jusqua) return memoire.version;
  try {
    const r = await fetcher(`${adresseDeLaConsole(env)}/?plv=${maintenant}`, { cache: 'no-store', headers: { 'user-agent': 'pinlane-garde' }, signal: AbortSignal.timeout(2500) });
    if (!r.ok) { if (r.body && r.body.cancel) await r.body.cancel().catch(() => {}); return ''; }
    const version = versionDeLaPage(await r.text());
    if (version) memoire = { version, jusqua: maintenant + DUREE_MS };
    return version;
  } catch (error) {
    return '';
  }
}
const oublierLaVersion = () => { memoire = { version: '', jusqua: 0 }; };

// Une console sur une version plus ancienne que celle en ligne : sa version differe de la version
// servie, ou elle n en envoie pas (le code d avant le 2026-11-13 ne l envoyait pas).
function consoleAncienne(envoyee, servie) {
  const v = String(envoyee || '').trim();
  if (!v) return true;
  return Boolean(servie) && v !== servie;
}

module.exports = { consoleAncienne, empreinte, oublierLaVersion, versionDeLaPage, versionDesSources, versionServie };

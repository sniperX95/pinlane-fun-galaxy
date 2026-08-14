// LE CHIFFRE QUI DIT SI « TOUJOURS LA MEME CHOSE » EST REGLE.
//
// Dix demandes DIFFERENTES du gerant, dix generations reelles, et une seule
// question : combien de textes distincts en sort-il, et qui les a ecrits ?
//
// Pourquoi ce fichier existe : le mode « Creer » appelait deja le modele, mais
// un juge heuristique taille pour le gabarit decidait ensuite qui publiait. Le
// commentaire du code le disait lui-meme : « exiger que l'IA le batte revenait a
// ne jamais publier ce qu'elle ecrit (constate en reel : rules 87 vs ai 86) ».
// Resultat visible par le gerant : le meme paragraphe, semaine apres semaine.
// Aucun test ne mesurait ca, parce qu'aucun test ne comparait DEUX demandes.
//
// Ce que ce script mesure, sur de VRAIES generations :
//   - textes distincts sur 10 demandes differentes (le chiffre qui compte) ;
//   - part ecrite par le modele plutot que par le gabarit ;
//   - part refusee pour invention (le garde-fou doit rester debout).
//
// Cout : 10 a 20 appels Kimi, de l'ordre de 0,05 a 0,10 $ par passage. Le
// plafond de lib/llm-budget.js s'applique. Sans cle : SKIP propre (exit 0), donc
// jamais dans test:ops:all.
//
// Aucune base de donnees : le catalogue vient des fichiers socle, la persistance
// et le bandit sont injectes a vide.

const fs = require('fs');
const path = require('path');

// Cle chargee depuis un fichier d'environnement local, JAMAIS affichee. Seules
// les variables du fournisseur LLM sont importees : ce script ne doit pas
// pouvoir toucher une base de donnees de production par accident.
const LLM_VARS = new Set(['KIMI_API_KEY', 'MOONSHOT_API_KEY', 'KIMI_MODEL', 'LLM_PROVIDER', 'LLM_MONTHLY_BUDGET_USD']);
for (const file of [process.env.PINLANE_ENV_FILE, '.env.local', '.env'].filter(Boolean)) {
  const target = path.isAbsolute(file) ? file : path.join(__dirname, '..', file);
  if (!fs.existsSync(target)) continue;
  for (const line of fs.readFileSync(target, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (match && LLM_VARS.has(match[1]) && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^"|"$/g, '');
    }
  }
}

const { llmProvider } = require('../lib/llm-client');
const { generateContentPack } = require('../lib/content-studio');

// De vraies phrases de gerant, pas dix variantes du meme mot.
const DEMANDES = [
  'un post pour le week-end',
  'une offre anniversaire pour les ados',
  'remplir le mardi apres-midi, il est toujours vide',
  'annoncer notre soiree fluo',
  'attirer les groupes d entreprise pour un teambuilding',
  'les conges de la Toussaint arrivent',
  'un message pour les familles le dimanche',
  'faire venir les ecoles en semaine',
  'la Foire de Libramont se tient juste a cote',
  'relancer les clients qui ne sont pas revenus',
];

const CENTER = process.env.PINLANE_VARIETY_CENTER || 'libramont';

function normalize(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

(async () => {
  if (!llmProvider('content')) {
    console.log('marketing-variety-check: SKIP (aucune cle IA dans l\'environnement).');
    process.exit(0);
  }

  const deps = {
    query: async () => ({ rows: [] }),
    recommendAngle: async () => null,
    // Bundle data fige : sans lui, chaque generation irait chercher la meteo et
    // la base. On veut mesurer la VARIETE DU TEXTE a contexte constant, pas la
    // variete du contexte.
    bundle: { today: '2026-08-14', forecast7: [], localEvents: [], nextSchoolHoliday: null },
  };

  // CADENCE DE LA MESURE, PAS DU PRODUIT. Le compte Moonshot est plafonne a
  // trois requetes par minute (mesure du 2026-08-14). Dix demandes enchainees
  // en dix secondes n'existent nulle part en exploitation : un gerant en pose
  // une, lit la reponse, en pose une autre. Enchainer sans respirer mesurerait
  // le plafond de cadence, pas la variete du texte. On espace donc les demandes
  // ici, et SEULEMENT ici : le produit, lui, garde ses reprises bornees.
  const PACE_MS = Number(process.env.PINLANE_VARIETY_PACE_MS || 21000);
  const results = [];
  let first = true;
  for (const brief of DEMANDES) {
    if (!first && PACE_MS > 0) await new Promise((resolve) => setTimeout(resolve, PACE_MS));
    first = false;
    let pack = null;
    try {
      pack = await generateContentPack(CENTER, { platform: 'facebook', brief }, deps);
    } catch (error) {
      console.log(`      (echec sur "${brief}" : ${error && error.message})`);
    }
    const iterations = (pack && pack.quality && pack.quality.iterations) || [];
    const blocked = iterations.filter((step) => step.blocked).length;
    results.push({
      brief,
      long: (pack && pack.long) || '',
      mode: (pack && pack.generationMode) || 'aucun',
      score: pack && pack.quality ? pack.quality.score : null,
      blocked,
    });
    console.log(`  ${(pack && pack.generationMode) === 'ai' ? 'modele ' : 'gabarit'} | note ${pack && pack.quality ? String(pack.quality.score).padStart(3) : '  ?'} | ${brief}`);
    console.log(`            "${normalize((pack && pack.long) || '').slice(0, 96)}"`);
  }

  const textes = results.map((row) => normalize(row.long)).filter(Boolean);
  const distincts = new Set(textes).size;
  const parModele = results.filter((row) => row.mode === 'ai').length;
  const refusesPourInvention = results.reduce((sum, row) => sum + row.blocked, 0);

  console.log('\n=== MESURE ===');
  console.log(`textes distincts        : ${distincts}/${DEMANDES.length}`);
  console.log(`ecrits par le modele    : ${parModele}/${DEMANDES.length}`);
  console.log(`iterations refusees     : ${refusesPourInvention} (invention detectee, le garde-fou a tenu)`);
  console.log(`note moyenne affichee   : ${Math.round(results.reduce((sum, row) => sum + (row.score || 0), 0) / DEMANDES.length)}`);
  // Aucun seuil ici : ce script MESURE, il ne juge pas. Le seuil, c'est la
  // comparaison avant/apres notee dans le journal du projet.
  process.exit(0);
})().catch((error) => {
  console.error('marketing-variety-check: CRASH', error && error.stack);
  process.exit(1);
});

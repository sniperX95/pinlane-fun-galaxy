// LE POOL DES ECLATS SE BORNE (2026-11-05). En mode `nombre` (un fils neuf par rang),
// eclater() lancait autant de fils a la fois que de coeurs, 22 sur le poste d Ansar, sans lire
// PINLANE_ECLATS : la regle « un navigateur de test a la fois » ne pouvait pas tenir pour
// formules-arrivee et fungalaxy-information (le PC a plante par manque de memoire ce jour-la),
// et le lanceur de la suite, qui donne 2 fils a chaque gate du pool, etait contourne aussi.
// Ici, des fils qui ne font que dormir disent combien tournaient en meme temps.
// `--contre-preuves` : la meme mesure, sur gates-eclats.js sans la borne, doit rougir.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SOURCE = path.join(__dirname, 'gates-eclats.js');
const eclats = require(process.env.ECLATS_SOURCE || SOURCE);

const MUTATIONS = [
  { nom: 'nombre-sans-borne', cible: 'PINLANE_ECLATS=1 : un fils a la fois en mode nombre', fichier: 'scripts/gates-eclats.js', de: 'const parallele = nombre ? (process.env.PINLANE_ECLATS ? nombreDeFils(n) : Math.max(2, os.cpus().length)) : n;', vers: 'const parallele = nombre ? Math.max(2, os.cpus().length) : n;' },
];

// Combien d intervalles se recouvrent au plus (une fin et un debut a la meme milliseconde ne se
// recouvrent pas).
function chevauchement(intervalles) {
  const points = intervalles.flatMap((x) => [[x.debut, 1], [x.fin, -1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let encours = 0;
  let max = 0;
  for (const [, delta] of points) { encours += delta; max = Math.max(max, encours); }
  return max;
}

async function mesurer(valeur) {
  const rangs = [0, 1, 2, 3, 4, 5];
  const avant = process.env.PINLANE_ECLATS;
  if (valeur === null) delete process.env.PINLANE_ECLATS; else process.env.PINLANE_ECLATS = String(valeur);
  try {
    const { resultats } = await eclats.eclater({ fichier: __filename, rangs, nombre: rangs.length });
    const intervalles = [...resultats.values()];
    return { tous: rangs.every((r) => resultats.has(r)), max: chevauchement(intervalles) };
  } finally {
    if (avant === undefined) delete process.env.PINLANE_ECLATS; else process.env.PINLANE_ECLATS = avant;
  }
}

async function principal() {
  let echecs = 0;
  const ok = (condition, nom, detail) => {
    if (condition) console.log(`ok    ${nom}`);
    else { echecs += 1; console.log(`FAIL  ${nom}  ${JSON.stringify(detail)}`); }
  };
  const un = await mesurer(1);
  ok(un.tous && un.max === 1, 'PINLANE_ECLATS=1 : un fils a la fois en mode nombre', un);
  const trois = await mesurer(3);
  ok(trois.tous && trois.max >= 2 && trois.max <= 3, 'PINLANE_ECLATS=3 : au plus trois fils a la fois', trois);
  const coeurs = Math.max(2, os.cpus().length);
  const libre = await mesurer(null);
  ok(libre.tous && libre.max >= 2 && libre.max <= coeurs, 'sans PINLANE_ECLATS : le mode nombre garde son pool par coeurs', { ...libre, coeurs });
  console.log(echecs ? `gates-eclats-check: ${echecs} FAIL` : 'gates-eclats-check: ALL OK - le mode nombre respecte PINLANE_ECLATS quand il est pose.');
  process.exit(echecs ? 1 : 0);
}

// Chaque mutation sur une copie de gates-eclats.js hors du depot ; sa cible doit rougir.
function contrePreuves() {
  const texte = fs.readFileSync(SOURCE, 'utf8').replace(/\r\n/g, '\n');
  let mordent = 0;
  for (const m of MUTATIONS) {
    const n = texte.split(m.de).length - 1;
    if (n !== 1) { console.log(`FAIL  ancre ${m.nom} trouvee ${n} fois`); continue; }
    const copie = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gates-eclats-')), 'gates-eclats.js');
    fs.writeFileSync(copie, texte.replace(m.de, m.vers));
    const r = spawnSync(process.execPath, [__filename], { env: { ...process.env, ECLATS_SOURCE: copie }, encoding: 'utf8', timeout: 120000 });
    const rouge = `${r.stdout || ''}`.split('\n').some((l) => l.startsWith('FAIL') && l.includes(m.cible));
    if (rouge) { mordent += 1; console.log(`ok    contre-preuve ${m.nom} : « ${m.cible} » rougit`); } else console.log(`FAIL  contre-preuve ${m.nom} : « ${m.cible} » reste vert`);
    fs.rmSync(path.dirname(copie), { recursive: true, force: true });
  }
  console.log(`gates-eclats-check --contre-preuves : ${mordent}/${MUTATIONS.length} mordent`);
  process.exit(mordent === MUTATIONS.length ? 0 : 1);
}

if (eclats.estFils()) {
  // Le fils : dort sur chaque rang et dit quand il a commence et fini. 800 ms : deux fils
  // lances ensemble se recouvrent meme quand l un demarre lentement (machine chargee).
  eclats.servir(async (rang) => {
    const debut = Date.now();
    await new Promise((r) => setTimeout(r, 800));
    return { rang, debut, fin: Date.now() };
  });
} else if (process.argv.includes('--contre-preuves')) contrePreuves();
else principal().catch((error) => { console.log(`FAIL  exception ${error && error.stack}`); process.exit(1); });

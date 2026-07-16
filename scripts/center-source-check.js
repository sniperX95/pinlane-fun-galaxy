// Une seule source de verite du centre courant cote front (bug transversal
// n°1 de AUDIT-MARKETING.md) : state.currentCenterId etait lu 53 fois et
// assigne NULLE PART, donc toute la zone Marketing envoyait toujours
// centerId=libramont. Le champ pilote par le switcher reel est
// state.adminCenterId : ce gate verrouille qu'aucun code ne relit jamais le
// fantome.
//
// Regle anti-faux-vert (les deux incidents documentes du repo) : un grep qui
// rend 0 sur un echantillon vide "prouve" zero probleme. Ce gate ECHOUE donc
// d'abord si son echantillon est vide ou anormalement petit, et exige une
// preuve POSITIVE (la zone Marketing lit bien le champ pilote) avant de
// verifier l'absence du fantome. Preuve d'echec sur echantillon vide :
// `node scripts/center-source-check.js <dossier-vide>` doit sortir en erreur.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const targetDir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'assets');

function fail(message) {
  console.error(`center-source-check: FAIL ${message}`);
  process.exit(1);
}

if (!fs.existsSync(targetDir)) fail(`dossier introuvable: ${targetDir}`);
const files = fs.readdirSync(targetDir)
  .filter((name) => name.endsWith('.js'))
  .map((name) => path.join(targetDir, name));

// Garde echantillon : sans fichiers, un ensemble vide satisferait toutes les
// assertions d'absence. On echoue AVANT de conclure quoi que ce soit.
if (files.length < 5) fail(`echantillon vide ou trop petit (${files.length} fichier(s) .js dans ${targetDir})`);

let totalBytes = 0;
let adminReads = 0;
let ghostHits = [];
for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  totalBytes += content.length;
  adminReads += (content.match(/state\.adminCenterId/g) || []).length;
  const lines = content.split('\n');
  lines.forEach((line, index) => {
    if (line.includes('currentCenterId')) {
      ghostHits.push(`${path.basename(file)}:${index + 1}`);
    }
  });
}

if (totalBytes < 100000) fail(`echantillon trop petit (${totalBytes} octets lus) : ce n'est pas le vrai dossier assets`);

// Preuve POSITIVE d'abord : la zone staff lit le champ pilote par le switcher.
if (adminReads < 40) {
  fail(`preuve positive absente : seulement ${adminReads} lecture(s) de state.adminCenterId (attendu >= 40). Le scan ne lit pas le vrai code.`);
}

// Ensuite seulement, l'absence du fantome.
if (ghostHits.length) {
  fail(`le centre fantome est revenu : currentCenterId lu dans ${ghostHits.join(', ')}`);
}

console.log(`center-source-check: ALL OK (${files.length} fichiers, ${adminReads} lectures de state.adminCenterId, 0 currentCenterId)`);

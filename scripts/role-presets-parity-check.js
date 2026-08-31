// UN PRESET DE ROLE MONTRE CE QU IL ACCORDE VRAIMENT.
//
// Mesure du 2026-08-31, la veille de l ouverture Fun Galaxy Libramont.
//
// Les presets de roles existent en DEUX exemplaires : lib/staff-auth.js (le
// serveur) et assets/app-main.js (l ecran « Equipe & acces »). Le bouton
// « preset » n envoie que l id, et c est le SERVEUR qui applique la liste : le
// tableau du navigateur ne sert qu a AFFICHER ce que le preset va donner.
//
// Les deux avaient diverge en silence :
//   manager   : le serveur accorde en plus planning.past, reservations.cancel,
//               reports.export et pricing.manage ; le client affichait a la
//               place exports.download, qu il n accorde pas.
//   staff-bar : le client affichait reservations.edit et clients.view, que le
//               serveur n accorde pas.
//
// Autrement dit, l ecran mentait sur qui peut annuler une reservation et
// toucher aux tarifs. Dans un centre qui fait 4000 EUR par jour, c est la
// question « qui a le droit de changer un prix » a laquelle le produit
// repondait faux.
//
// Trois proprietes :
//   A. Les deux cotes connaissent les MEMES roles (deja couvert par
//      staff-roles-source-check, repris ici comme garde-fou de montage).
//   B. Pour chaque preset, les deux cotes accordent EXACTEMENT les memes
//      permissions.
//   C. Aucun preset ne cite une permission inconnue du vocabulaire commun.
//
// Contre-epreuve par mutation : on remet une divergence dans le tableau du
// client, on prouve que le gate rougit, on restaure.
//
// Lancement : node scripts/role-presets-parity-check.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'assets/app-main.js');

let failures = 0;
function ok(condition, message) {
  console.log(`${condition ? 'OK  ' : 'FAIL'}  ${message}`);
  if (!condition) failures += 1;
  return condition;
}

// Extrait une declaration de haut niveau jusqu a sa fermeture en colonne 0.
// Insensible au style de fin de ligne (le depot vit en CRLF sur Windows).
function extractBlock(src, header, closing) {
  const start = src.indexOf(header);
  if (start === -1) return null;
  const match = new RegExp(`\\r?\\n${closing}\\r?\\n`).exec(src.slice(start));
  return match ? src.slice(start, start + match.index + match[0].length) : null;
}

// Le tableau du CLIENT, lu dans le fichier a chaque appel : la mutation doit
// etre vue.
function presetsClient() {
  const src = fs.readFileSync(APP, 'utf8');
  const groupes = extractBlock(src, 'const STAFF_PERMISSION_GROUPS = [', '\\];');
  const presets = extractBlock(src, 'const STAFF_ROLE_PRESETS = [', '\\];');
  if (!groupes || !presets) throw new Error('bloc introuvable dans assets/app-main.js');
  const bac = { presets: null, vocabulaire: null };
  vm.createContext(bac);
  vm.runInContext(`${groupes}\n${presets}\npresets = STAFF_ROLE_PRESETS;\nvocabulaire = STAFF_PERMISSION_GROUPS.flatMap(group => group.permissions.map(permission => permission[0]));`, bac);
  return { presets: bac.presets, vocabulaire: bac.vocabulaire };
}

function main() {
  const { STAFF_ROLE_PRESETS: serveur, ALL_PERMISSIONS } = require(path.join(ROOT, 'lib/staff-auth.js'));
  const { presets: client, vocabulaire } = presetsClient();

  // --- A. Les memes roles des deux cotes ---------------------------------
  const idsServeur = serveur.map((role) => role.id).sort();
  const idsClient = client.map((role) => role.id).sort();
  ok(idsServeur.join('|') === idsClient.join('|'),
    `les deux cotes connaissent les memes roles (serveur : ${idsServeur.join(', ')} / client : ${idsClient.join(', ')})`);

  // --- C. Le vocabulaire est commun ---------------------------------------
  const vocabServeur = new Set(ALL_PERMISSIONS || []);
  const vocabClient = new Set(vocabulaire || []);
  const inconnuesClient = [...vocabClient].filter((id) => !vocabServeur.has(id));
  const inconnuesServeur = [...vocabServeur].filter((id) => !vocabClient.has(id));
  ok(inconnuesClient.length === 0 && inconnuesServeur.length === 0,
    `un seul vocabulaire de permissions (${vocabServeur.size} des deux cotes${inconnuesClient.length ? `, client seul : ${inconnuesClient.join(', ')}` : ''}${inconnuesServeur.length ? `, serveur seul : ${inconnuesServeur.join(', ')}` : ''})`);

  // --- B. Chaque preset accorde la meme chose -----------------------------
  for (const roleServeur of serveur) {
    const roleClient = client.find((role) => role.id === roleServeur.id);
    if (!roleClient) { ok(false, `${roleServeur.id} : absent du tableau client`); continue; }
    const a = new Set(roleServeur.permissions || []);
    const b = new Set(roleClient.permissions || []);
    const serveurSeul = [...a].filter((id) => !b.has(id));
    const clientSeul = [...b].filter((id) => !a.has(id));
    const ecart = [
      serveurSeul.length ? `accorde par le SERVEUR mais pas affiche : ${serveurSeul.join(', ')}` : '',
      clientSeul.length ? `affiche par le CLIENT mais pas accorde : ${clientSeul.join(', ')}` : '',
    ].filter(Boolean).join(' | ');
    ok(!ecart, `preset ${roleServeur.id} : l ecran dit ce que le serveur applique (${ecart || `${a.size} permissions identiques`})`);

    const horsVocabulaire = [...a, ...b].filter((id) => !vocabServeur.has(id));
    ok(horsVocabulaire.length === 0,
      `preset ${roleServeur.id} : aucune permission fantome (${horsVocabulaire.join(', ') || 'aucune'})`);
  }

  if (failures) {
    console.error(`\nrole-presets-parity-check: ${failures} defaut(s).`);
    process.exit(1);
  }
  console.log('\nrole-presets-parity-check: ALL OK (l ecran des roles ne ment pas sur ce qui sera applique)');
}

if (process.argv.includes('--mutate')) {
  const source = fs.readFileSync(APP, 'utf8');
  const marqueur = "'clients.view', 'clients.edit', 'payments.view', 'payments.markPaid',";
  if (!source.includes(marqueur)) {
    console.error('mutation impossible : le preset manager est introuvable dans assets/app-main.js');
    process.exit(1);
  }
  // On remet une divergence : le client affiche une permission de moins.
  const mute = source.replace(marqueur, "'clients.view', 'payments.view', 'payments.markPaid',");
  fs.writeFileSync(APP, mute);
  const { spawnSync } = require('child_process');
  const run = spawnSync(process.execPath, [__filename], { encoding: 'utf8' });
  fs.writeFileSync(APP, source);
  console.log(run.stdout || '');
  if (run.status === 0) {
    console.error('CONTRE-EPREUVE RATEE : le gate reste vert avec un preset desaligne.');
    process.exit(1);
  }
  console.log('contre-epreuve OK : une permission retiree du tableau client fait rougir le gate.');
  process.exit(0);
}

main();

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
// Quatre proprietes :
//   A. Les deux cotes connaissent les MEMES roles (deja couvert par
//      staff-roles-source-check, repris ici comme garde-fou de montage).
//   B. Pour chaque preset, les deux cotes accordent EXACTEMENT les memes
//      permissions, niveaux compris.
//   C. Aucun preset ne cite une permission inconnue du vocabulaire commun.
//   D. LES DROITS A NIVEAUX (2026-11-03) : la definition, le defaut et la
//      lecture d une session disent la meme chose des deux cotes, sur une
//      matrice de roles, verrouille et plateforme compris.
//
// Contre-epreuve par mutation : chaque divergence est remise dans une copie du
// source, EN MEMOIRE (un gate voisin lit le meme fichier), et le gate doit
// rougir dessus.
//
// Lancement : node scripts/role-presets-parity-check.js [--mutate]
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'assets/app-main.js');

let failures = 0;
let muet = false;
function ok(condition, message) {
  if (!muet) console.log(`${condition ? 'OK  ' : 'FAIL'}  ${message}`);
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

// Le tableau du CLIENT, tel que le source donne le dit.
function presetsClient(src) {
  const groupes = extractBlock(src, 'const STAFF_PERMISSION_GROUPS = [', '\\];');
  const presets = extractBlock(src, 'const STAFF_ROLE_PRESETS = [', '\\];');
  const niveaux = extractBlock(src, 'const DROITS_NIVEAUX = [', '\\];');
  const maximum = extractBlock(src, 'function niveauMaximum(cle) {', '}');
  const lecture = extractBlock(src, 'function niveauDesPermissions(permissions, cle) {', '}');
  const session = extractBlock(src, 'function niveauDeLaSession(session, cle) {', '}');
  if (!groupes || !presets || !niveaux || !maximum || !lecture || !session) throw new Error('bloc introuvable dans assets/app-main.js');
  const bac = { presets: null, vocabulaire: null, niveaux: null, lireSession: null };
  vm.createContext(bac);
  vm.runInContext(`${groupes}\n${presets}\n${niveaux}\n${maximum}\n${lecture}\n${session}\npresets = STAFF_ROLE_PRESETS;\nvocabulaire = STAFF_PERMISSION_GROUPS.flatMap(group => group.permissions.map(permission => permission[0]));\nniveaux = DROITS_NIVEAUX;\nlireSession = niveauDeLaSession;`, bac);
  return { presets: bac.presets, vocabulaire: bac.vocabulaire, niveaux: bac.niveaux, lireSession: bac.lireSession };
}

// Une matrice de sessions : ce que la base peut contenir, jusqu aux cas limites
// (deux options d une cle, une option morte, un role sans aucun droit).
function matriceDeSessions(optionsConnues) {
  const sansRole = (permissions) => ({ permissions, role: { locked: false } });
  const sessions = [
    ['role vide', sansRole([])],
    ['lecture seule', sansRole(['reservations.view'])],
    ['creation sans modification', sansRole(['reservations.view', 'reservations.create'])],
    ['modification sans creation', sansRole(['reservations.view', 'reservations.edit'])],
    ['creation et modification', sansRole(['reservations.view', 'reservations.create', 'reservations.edit'])],
    ['deux options d une cle, la derniere gagne', sansRole(['reservations.edit', 'niveau:prix:libre', 'niveau:prix:5'])],
    ['option morte, le defaut reste', sansRole(['reservations.edit', 'niveau:prix:15', 'niveau:surmesure:peut-etre'])],
    ['role verrouille, tableau vide', { permissions: [], role: { locked: true } }],
    ['role verrouille, tableau qui dit non', { permissions: ['niveau:prix:non', 'niveau:surmesure:non'], role: { locked: true } }],
    ['plateforme non verrouille, tableau qui dit non', { permissions: ['platform.admin', 'niveau:prix:non'], role: { locked: false } }],
  ];
  optionsConnues.forEach((option) => sessions.push([`option seule ${option}`, sansRole([option])]));
  return sessions;
}

function verifier(source) {
  failures = 0;
  const staffAuth = require(path.join(ROOT, 'lib/staff-auth.js'));
  const { STAFF_ROLE_PRESETS: serveur, ALL_PERMISSIONS, DROITS_NIVEAUX, niveauEffectif, optionsDeNiveau } = staffAuth;
  const { presets: client, vocabulaire, niveaux: niveauxClient, lireSession } = presetsClient(source);

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

    const horsVocabulaire = [...a, ...b].filter((id) => !vocabServeur.has(id) && !optionsDeNiveau().includes(id));
    ok(horsVocabulaire.length === 0,
      `preset ${roleServeur.id} : aucune permission fantome (${horsVocabulaire.join(', ') || 'aucune'})`);

    // Un choix pour chaque reglage, ecrit en toutes lettres : un preset qui
    // laisserait une cle au defaut changerait de sens selon les droits du role.
    const cles = DROITS_NIVEAUX.map((droit) => droit.cle);
    const manquantes = cles.filter((cle) => [...a].filter((id) => id.startsWith(`niveau:${cle}:`)).length !== 1);
    ok(manquantes.length === 0, `preset ${roleServeur.id} : une option et une seule par reglage (${manquantes.join(', ') || `${cles.length} reglages`})`);
  }

  // --- D. Les droits a niveaux -------------------------------------------
  const definition = (liste) => JSON.stringify(liste.map(({ cle, libelle, options }) => [cle, libelle, options]));
  ok(definition(DROITS_NIVEAUX) === definition(JSON.parse(JSON.stringify(niveauxClient))),
    `une seule definition des reglages (${DROITS_NIVEAUX.length} cles, ${optionsDeNiveau().length} options, memes mots des deux cotes)`);
  const ecarts = [];
  const sessions = matriceDeSessions(optionsDeNiveau());
  for (const [nom, session] of sessions) {
    for (const { cle } of DROITS_NIVEAUX) {
      const s = niveauEffectif(session, cle);
      const c = lireSession(session, cle);
      if (s !== c) ecarts.push(`${nom} / ${cle} : serveur ${s}, ecran ${c}`);
    }
  }
  ok(ecarts.length === 0, `le niveau d une session se lit pareil des deux cotes (${sessions.length} sessions x ${DROITS_NIVEAUX.length} cles${ecarts.length ? ` : ${ecarts.slice(0, 3).join(' | ')}` : ''})`);
  return failures;
}

if (process.argv.includes('--mutate')) {
  const source = fs.readFileSync(APP, 'utf8').split('\r\n').join('\n');
  const fichier = 'assets/app-main.js';
  const MUTATIONS = [
    {
      nom: 'une permission retiree du tableau client',
      fichier,
      // (ancre allongee le 2026-11-07 : le modele Assistant manager reprend la
      // meme ligne ; la suivante, propre au Manager, la rend unique)
      de: "'clients.view', 'clients.edit', 'payments.view', 'payments.markPaid',\n      'emails.view', 'reports.export', 'pricing.manage',",
      vers: "'clients.view', 'payments.view', 'payments.markPaid',\n      'emails.view', 'reports.export', 'pricing.manage',",
    },
    {
      nom: 'le preset Manager affiche un autre plafond de prix',
      fichier,
      de: "'niveau:surmesure:libre', 'niveau:prix:20', 'niveau:formule:oui'",
      vers: "'niveau:surmesure:libre', 'niveau:prix:10', 'niveau:formule:oui'",
    },
    {
      nom: 'le miroir oublie une option',
      fichier,
      de: "options: [['non', 'Non'], ['5', '5 %'], ['10', '10 %'], ['20', '20 %'], ['libre', 'Sans limite']]\n",
      vers: "options: [['non', 'Non'], ['5', '5 %'], ['20', '20 %'], ['libre', 'Sans limite']]\n",
    },
    {
      nom: 'le miroir change le defaut d un role sans modification',
      fichier,
      de: "return liste.includes('reservations.create') && cle === 'surmesure' ? 'catalogue' : 'non';",
      vers: "return liste.includes('reservations.create') && cle === 'surmesure' ? 'libre' : 'non';",
    },
    {
      nom: 'le miroir lit le tableau d un role verrouille',
      fichier,
      de: "if (session.role?.locked || permissions.includes('platform.admin')) return niveauMaximum(cle);",
      vers: "if (permissions.includes('platform.admin')) return niveauMaximum(cle);",
    },
  ];
  let ratees = 0;
  muet = true;
  for (const { nom, de, vers } of MUTATIONS) {
    if (source.split(de).length - 1 !== 1) {
      console.error(`mutation impossible (${nom}) : ancre absente ou multiple dans assets/app-main.js`);
      process.exit(1);
    }
    if (verifier(source.replace(de, vers)) === 0) {
      console.error(`CONTRE-EPREUVE RATEE : le gate reste vert (${nom}).`);
      ratees += 1;
    } else {
      console.log(`contre-epreuve OK : ${nom} fait rougir le gate.`);
    }
  }
  process.exit(ratees ? 1 : 0);
}

if (verifier(fs.readFileSync(APP, 'utf8'))) {
  console.error(`\nrole-presets-parity-check: ${failures} defaut(s).`);
  process.exit(1);
}
console.log('\nrole-presets-parity-check: ALL OK (l ecran des roles ne ment pas sur ce qui sera applique)');

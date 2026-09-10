// LES CONSTANTES DE RESERVATION EXISTENT EN DOUBLE : ELLES DOIVENT DIRE PAREIL.
//
// lib/booking-config.js (le serveur, qui facture et planifie) et
// assets/booking-core.js (le navigateur, qui affiche et estime) declarent DIX-SEPT
// constantes de meme nom : le nombre de pistes, la capacite par piste, la grille
// bowling, les options laser, les formules, les vacances scolaires.
//
// Aucune ne diverge aujourd hui sur un CHIFFRE. Mais rien ne l empechait : une
// piste ajoutee d un cote, un tarif corrige de l autre, et le tunnel vend a un
// prix que le serveur ne pratique pas. C est exactement la classe de defaut qui
// a coute le duckpin sur-reserve et le « 120 EUR devenus 20 » de ce mois-ci.
//
// L ECART CONNU ET VOULU : les accents. lib/catalog-store.js fait de
// « Formules speciales » (sans accent) sa valeur canonique et lib/center-metrics.js
// mappe les libelles de conges sans accent vers leur version accentuee ; le
// navigateur, lui, affiche du francais correct. Les deux cotes se rejoignent par
// pliage d accents, deja documente dans assets/app-main.js (l.14102 et l.23115).
// Ce gate PLIE donc les accents sur les chaines, et reste STRICT sur tout le
// reste : un nombre, un identifiant, une longueur de liste, une structure.
//
// Quatre proprietes :
//   A. La LISTE des constantes en double est celle qu on croit : une nouvelle
//      jumelle ajoutee en silence fait rougir, pour forcer la decision.
//   B. Aucun CHIFFRE ne diverge (prix, capacites, minutes, minPax).
//   C. Aucune STRUCTURE ne diverge (memes ids, memes longueurs, memes cles).
//   D. Les seules differences restantes sont des accents, et on les compte.
//
// Contre-epreuve par mutation : on change TOTAL_LANES dans le navigateur, on
// prouve que le gate rougit, on restaure.
//
// Lancement : node scripts/booking-constants-drift-check.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const CORE = path.join(ROOT, 'assets/booking-core.js');
const CONFIG = path.join(ROOT, 'lib/booking-config.js');

let failures = 0;
function ok(condition, message) {
  console.log(`${condition ? 'OK  ' : 'FAIL'}  ${message}`);
  if (!condition) failures += 1;
  return condition;
}

// Les jumelles comparables : meme nom des deux cotes ET exportees par le serveur.
const JUMELLES = [
  'TOTAL_LANES', 'MAX_PER_LANE', 'EMERGENCY_MAX_PER_LANE', 'PAIRS',
  'LASER_GAME_ARENA_MINUTES', 'BOWLING_PRICES', 'LASER_GAME_MAX_PLAYERS',
  'LASER_GAME_OPTIONS', 'FUN_RUN_OPTIONS', 'FUN_RUN_MAX_PAX',
  'DURATION_OPTIONS', 'FORMULES', 'WALLONIA_SCHOOL_HOLIDAYS',
];

function nomsDeclares(source) {
  const noms = new Set();
  const re = /^const ([A-Z][A-Z0-9_]{2,})\s*=/gm;
  let m;
  while ((m = re.exec(source))) noms.add(m[1]);
  return noms;
}

// Le navigateur n exporte rien : on evalue le fichier dans un bac a sable, puis
// on demande les constantes par une expression (un `const` de haut niveau ne se
// pose pas sur l objet de contexte).
function constantesDuNavigateur() {
  const source = fs.readFileSync(CORE, 'utf8');
  const bac = {
    window: {}, document: { addEventListener() {} },
    console: { log() {}, warn() {}, error() {} },
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout, clearTimeout, __out: null,
  };
  bac.globalThis = bac;
  vm.createContext(bac);
  const collecte = `__out = { ${JUMELLES.map((n) => `'${n}': (typeof ${n} !== 'undefined' ? ${n} : undefined)`).join(', ')} };`;
  vm.runInContext(`${source}\n${collecte}`, bac, { timeout: 20000 });
  return bac.__out;
}

const plieAccents = (valeur) => String(valeur).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// LE MOTEUR DU NAVIGATEUR LUI-MEME, pour ses FONCTIONS : une declaration de
// fonction de haut niveau se pose sur l objet de contexte.
function moteurDuNavigateur() {
  const source = fs.readFileSync(CORE, 'utf8');
  const bac = {
    window: {}, document: { addEventListener() {} },
    console: { log() {}, warn() {}, error() {} },
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout, clearTimeout,
  };
  bac.globalThis = bac;
  vm.createContext(bac);
  vm.runInContext(source, bac, { timeout: 20000 });
  return bac;
}

// UNE FONCTION DU TUNNEL (assets/app-main.js), extraite telle quelle : le
// fichier entier suppose un navigateur, cette fonction-la non.
function fonctionDuTunnel(nom) {
  const source = fs.readFileSync(path.join(ROOT, 'assets/app-main.js'), 'utf8').replace(/\r\n/g, '\n');
  const debut = source.indexOf(`\nfunction ${nom}(`);
  if (debut === -1) return '';
  const fin = source.indexOf('\n}\n', debut + 1);
  return fin === -1 ? '' : source.slice(debut + 1, fin + 2);
}

// Compare en profondeur. Renvoie { chiffres, structures, accents } : les listes
// des chemins fautifs par nature d ecart.
function compare(a, b, chemin, sortie) {
  if (typeof a === 'number' || typeof b === 'number' || typeof a === 'boolean' || typeof b === 'boolean') {
    if (a !== b) sortie.chiffres.push(`${chemin} : serveur=${JSON.stringify(a)} navigateur=${JSON.stringify(b)}`);
    return;
  }
  if (typeof a === 'string' && typeof b === 'string') {
    if (a === b) return;
    if (plieAccents(a) === plieAccents(b)) sortie.accents.push(chemin);
    else sortie.structures.push(`${chemin} : serveur=${JSON.stringify(a)} navigateur=${JSON.stringify(b)}`);
    return;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) { sortie.structures.push(`${chemin} : une liste d un seul cote`); return; }
    if (a.length !== b.length) { sortie.structures.push(`${chemin} : ${a.length} elements cote serveur, ${b.length} cote navigateur`); return; }
    a.forEach((item, index) => compare(item, b[index], `${chemin}[${index}]`, sortie));
    return;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const cles = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    const manquantes = cles.filter((cle) => !(cle in a) || !(cle in b));
    if (manquantes.length) { sortie.structures.push(`${chemin} : cles absentes d un cote (${manquantes.join(', ')})`); return; }
    cles.forEach((cle) => compare(a[cle], b[cle], `${chemin}.${cle}`, sortie));
    return;
  }
  if (a !== b) sortie.structures.push(`${chemin} : serveur=${JSON.stringify(a)} navigateur=${JSON.stringify(b)}`);
}

function main() {
  const serveur = require(CONFIG);
  const navigateur = constantesDuNavigateur();

  // --- A. La liste des jumelles n a pas grossi en silence -----------------
  const nomsServeur = nomsDeclares(fs.readFileSync(CONFIG, 'utf8'));
  const nomsNavigateur = nomsDeclares(fs.readFileSync(CORE, 'utf8'));
  const enDouble = [...nomsServeur].filter((nom) => nomsNavigateur.has(nom));
  const comparables = enDouble.filter((nom) => serveur[nom] !== undefined);
  const nouvelles = comparables.filter((nom) => !JUMELLES.includes(nom));
  ok(nouvelles.length === 0,
    `aucune jumelle comparable ajoutee sans decision (${enDouble.length} noms en double, ${comparables.length} comparables${nouvelles.length ? `, NOUVELLES : ${nouvelles.join(', ')}` : ''})`);
  const disparues = JUMELLES.filter((nom) => !comparables.includes(nom));
  ok(disparues.length === 0,
    `les jumelles connues sont toujours la (${disparues.join(', ') || 'toutes presentes'})`);

  // --- B, C, D. Aucun chiffre, aucune structure ; les accents, on les compte
  const sortie = { chiffres: [], structures: [], accents: [] };
  for (const nom of JUMELLES) {
    if (serveur[nom] === undefined || navigateur[nom] === undefined) {
      ok(false, `${nom} : illisible d un cote (serveur=${serveur[nom] === undefined ? 'absent' : 'ok'}, navigateur=${navigateur[nom] === undefined ? 'absent' : 'ok'})`);
      continue;
    }
    compare(serveur[nom], navigateur[nom], nom, sortie);
  }

  ok(sortie.chiffres.length === 0,
    `aucun CHIFFRE ne diverge entre le serveur et le navigateur (${sortie.chiffres.slice(0, 4).join(' | ') || 'zero ecart'})`);
  ok(sortie.structures.length === 0,
    `aucune STRUCTURE ne diverge (${sortie.structures.slice(0, 4).join(' | ') || 'zero ecart'})`);
  console.log(`  (${sortie.accents.length} libelles ne different que par les accents : ecart connu, plie par lib/catalog-store.js et lib/center-metrics.js)`);

  // --- E. LA REGLE D ARRIVEE : UNE FONCTION, ET SA JUMELLE EXACTE ----------
  // La route qui compose les creneaux et l agent lisent getFormuleArrivalWindow
  // (lib/booking-config.js) ; le navigateur, sa jumelle (assets/booking-core.js).
  // Une divergence ferait griser une carte que la route sert, ou servir une
  // heure que l agent a dite impossible.
  const moteurNavigateur = moteurDuNavigateur();
  ok(typeof moteurNavigateur.getFormuleArrivalWindow === 'function' && typeof moteurNavigateur.getFormuleBookedDuration === 'function',
    'MONTAGE : le navigateur porte bien la fenetre d arrivee et la duree reservee');
  const grilles = [];
  for (let ouverture = 9; ouverture <= 15; ouverture += 0.5) {
    for (let fermeture = ouverture + 2; fermeture <= 24; fermeture += 1) grilles.push({ open: ouverture, close: fermeture });
  }
  const formulesE = [...serveur.FORMULES,
    { id: 'gate-bornee', name: 'GATE BORNEE', minPax: 1, timeLimit: { min: 11, max: 15 }, estimatedTotalDuration: 3 },
    { id: 'gate-ouverte', name: 'GATE OUVERTE', minPax: 1, timeLimit: { min: 12, max: 17 }, orderPolicy: 'open_window' },
    { id: 'gate-longue', name: 'GATE LONGUE', minPax: 1, estimatedTotalDuration: 9 }];
  ok(serveur.FORMULES.some((f) => f.orderPolicy === 'open_window') && serveur.FORMULES.some((f) => f.timeLimit && f.timeLimit.max && f.orderPolicy !== 'open_window'),
    'MONTAGE : le catalogue porte des fenetres ouvertes ET des formules bornees a duree');
  let casE = 0;
  const ecartsE = [];
  formulesE.forEach((formule) => grilles.forEach((grille) => {
    casE += 1;
    const s = JSON.stringify([serveur.getFormuleBookedDuration(formule), serveur.getFormuleArrivalWindow(formule, grille)]);
    const n = JSON.stringify([moteurNavigateur.getFormuleBookedDuration(formule), moteurNavigateur.getFormuleArrivalWindow(formule, grille)]);
    if (s !== n) ecartsE.push(`${formule.id} ${JSON.stringify(grille)} serveur=${s} navigateur=${n}`);
  }));
  ok(ecartsE.length === 0, `la fenetre d arrivee est la meme des deux cotes (${casE} cas${ecartsE.length ? ` ; ${ecartsE.slice(0, 3).join(' | ')}` : ''})`);

  // --- F. LE TUNNEL DU NAVIGATEUR APPLIQUE LA JUMELLE -------------------------
  // La fonction qui grise une formule (« Aucun creneau possible ce jour ») est
  // extraite de app-main.js et jouee sur le moteur du navigateur, une semaine
  // PASSEE (le jour meme n y tombe jamais, donc aucune heure courante n entre).
  const extrait = fonctionDuTunnel('getFormuleAvailability');
  ok(/getFormuleArrivalWindow\(formule, schedule\)/.test(extrait),
    'MONTAGE : la fonction du tunnel est extraite, et elle lit la fenetre du moteur');
  vm.runInContext(`${extrait}\nvar state = { isHolidayMode: false };`, moteurNavigateur, { timeout: 20000 });
  const SEMAINE = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07'];
  const verdictAttendu = (formule, date) => {
    const jour = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (formule.validDays && !formule.validDays.includes(jour)) return 'Indisponible ce jour';
    const plage = moteurNavigateur.getSchedule(date, false);
    if (!plage) return 'Centre fermé ce jour';
    const fenetre = serveur.getFormuleArrivalWindow(formule, plage);
    return fenetre.earliestStart > fenetre.latestStart ? 'Aucun créneau possible ce jour' : 'Disponible';
  };
  let casF = 0;
  const ecartsF = [];
  const refusesParLaFenetre = new Set();
  formulesE.forEach((formule) => SEMAINE.forEach((date) => {
    casF += 1;
    const lu = moteurNavigateur.getFormuleAvailability(formule, date, Number(formule.minPax) || 1);
    const attendu = verdictAttendu(formule, date);
    if (attendu === 'Aucun créneau possible ce jour') refusesParLaFenetre.add(formule.id);
    if (lu.message !== attendu) ecartsF.push(`${formule.id} ${date} tunnel=${lu.message} attendu=${attendu}`);
  }));
  ok(refusesParLaFenetre.size >= 2,
    `MONTAGE : la fenetre refuse bien des formules sur cette semaine (${[...refusesParLaFenetre].join(', ')})`);
  ok(ecartsF.length === 0, `le tunnel du navigateur grise exactement les formules sans arrivee possible (${casF} cas${ecartsF.length ? ` ; ${ecartsF.slice(0, 3).join(' | ')}` : ''})`);

  // ET UNE HEURE PRECISE : dans une fenetre ouverte, le tunnel accepte une
  // arrivee une demi-heure avant la fin et la refuse a la fin. C est ce que
  // l agent promet (« on arrive jusqu a une demi-heure avant la fin »).
  const ouverteBornee = serveur.FORMULES.find((f) => f.orderPolicy === 'open_window' && f.timeLimit && f.timeLimit.min && f.timeLimit.max);
  const jourOuvert = ouverteBornee && SEMAINE.find((date) => verdictAttendu(ouverteBornee, date) === 'Disponible');
  const heureDe = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${h % 1 ? '30' : '00'}`;
  ok(Boolean(ouverteBornee && jourOuvert) && serveur.getFormuleTotalDuration(ouverteBornee) > 0.5,
    `MONTAGE : une fenetre ouverte bornee se vend cette semaine, et sa duree estimee depasse la demi-heure (${ouverteBornee && ouverteBornee.id} le ${jourOuvert})`);
  const finOuverte = ouverteBornee ? Number(ouverteBornee.timeLimit.max) : 0;
  const avantLaFin = jourOuvert ? moteurNavigateur.getFormuleAvailability(ouverteBornee, jourOuvert, 1, heureDe(finOuverte - 0.5)) : {};
  const aLaFin = jourOuvert ? moteurNavigateur.getFormuleAvailability(ouverteBornee, jourOuvert, 1, heureDe(finOuverte)) : {};
  ok(avantLaFin.ok === true && aLaFin.ok === false,
    `le tunnel accepte une arrivee une demi-heure avant la fin d une fenetre ouverte, et la refuse a la fin (${heureDe(finOuverte - 0.5)} ${avantLaFin.message} ; ${heureDe(finOuverte)} ${aLaFin.message})`);

  // --- G. LA SIMULATION JUGE LA MEME REGLE, HEURE PAR HEURE ----------------
  // Ni la route ni l agent n appellent getFormuleAvailability (serveur) avec
  // une heure : seule la simulation le fait (lib/ops-simulation.js). Sa borne
  // d arrivee est une seconde ecriture de la limite de la formule, et elle doit
  // dire ce que dit la fenetre. Toute heure que la fenetre accepte, elle
  // l accepte ; et quand la limite de la formule borne la fenetre plus que
  // le centre, la demi-heure avant la premiere arrivee et celle apres la
  // derniere sont refusees des deux cotes. Sans cette section, remplacer la
  // duree reservee par la duree estimee dans getFormuleAvailability ne
  // faisait rougir aucun gate (mutation 71 #4, trouvee le 2026-09-10).
  let casG = 0;
  const ecartsG = [];
  const couvertesG = new Set();
  formulesE.forEach((formule) => {
    const pax = Number(formule.minPax) || 1;
    const jour = SEMAINE.find((date) => serveur.getFormuleAvailability(formule, date, pax, '').ok);
    if (!jour) return;
    grilles.forEach((grille) => {
      const fenetre = serveur.getFormuleArrivalWindow(formule, grille);
      if (!fenetre || fenetre.earliestStart > fenetre.latestStart) return;
      for (let h = Math.ceil(fenetre.earliestStart * 2) / 2; h <= fenetre.latestStart; h += 0.5) {
        casG += 1;
        couvertesG.add(formule.id);
        const verdict = serveur.getFormuleAvailability(formule, jour, pax, heureDe(h));
        if (!verdict.ok) ecartsG.push(`${formule.id} ${heureDe(h)} refusee (${verdict.message}) alors que la fenetre ${JSON.stringify(grille)} l accepte`);
      }
      const debut = formule.timeLimit && Number(formule.timeLimit.min);
      if (debut && debut > grille.open) {
        const avant = Math.ceil(fenetre.earliestStart * 2) / 2 - 0.5;
        casG += 1;
        const verdict = serveur.getFormuleAvailability(formule, jour, pax, heureDe(avant));
        if (verdict.ok) ecartsG.push(`${formule.id} ${heureDe(avant)} acceptee avant la premiere arrivee de la fenetre ${JSON.stringify(grille)}`);
      }
      const limite = formule.timeLimit && Number(formule.timeLimit.max);
      if (limite && limite <= grille.close) {
        const apres = Math.floor(fenetre.latestStart * 2) / 2 + 0.5;
        casG += 1;
        const verdict = serveur.getFormuleAvailability(formule, jour, pax, heureDe(apres));
        if (verdict.ok) ecartsG.push(`${formule.id} ${heureDe(apres)} acceptee apres la derniere arrivee de la fenetre ${JSON.stringify(grille)}`);
      }
    });
  });
  const ouvertesG = formulesE.filter((f) => f.orderPolicy === 'open_window' && f.timeLimit && f.timeLimit.max && couvertesG.has(f.id));
  const borneesG = formulesE.filter((f) => f.orderPolicy !== 'open_window' && f.timeLimit && f.timeLimit.max && couvertesG.has(f.id));
  ok(ouvertesG.length >= 2 && borneesG.length >= 2,
    `MONTAGE : la section G juge des fenetres ouvertes ET des formules bornees a duree (${ouvertesG.map((f) => f.id).join(', ')} ; ${borneesG.map((f) => f.id).join(', ')})`);
  ok(ecartsG.length === 0, `getFormuleAvailability juge chaque heure comme la fenetre (${casG} cas${ecartsG.length ? ` ; ${ecartsG.slice(0, 3).join(' | ')}` : ''})`);

  if (failures) {
    console.error(`\nbooking-constants-drift-check: ${failures} defaut(s).`);
    process.exit(1);
  }
  console.log('\nbooking-constants-drift-check: ALL OK (les deux copies disent le meme prix et la meme capacite)');
}

if (process.argv.includes('--mutate')) {
  const source = fs.readFileSync(CORE, 'utf8');
  const marqueur = 'const TOTAL_LANES = 8;';
  if (!source.includes(marqueur)) {
    console.error('mutation impossible : TOTAL_LANES est introuvable dans assets/booking-core.js');
    process.exit(1);
  }
  // Une neuvieme piste cote navigateur, aucune cote serveur : le tunnel vendrait
  // une piste qui n existe pas.
  const mute = source.replace(marqueur, 'const TOTAL_LANES = 9;');
  fs.writeFileSync(CORE, mute);
  const { spawnSync } = require('child_process');
  const run = spawnSync(process.execPath, [__filename], { encoding: 'utf8' });
  fs.writeFileSync(CORE, source);
  console.log(run.stdout || '');
  if (run.status === 0) {
    console.error('CONTRE-EPREUVE RATEE : le gate reste vert avec 9 pistes d un cote et 8 de l autre.');
    process.exit(1);
  }
  console.log('contre-epreuve OK : une piste de plus dans le navigateur fait rougir le gate.');
  process.exit(0);
}

main();

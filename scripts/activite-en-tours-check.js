'use strict';
// UNE ACTIVITE EN TOURS (2026-11-12, Ansar : « car racing, 10 € les 15 minutes, 2 machines, 1 personne par
// machine, pour le temps pris »). Une activite par personne qui declare ses machines (activityCapacity du
// centre : units, capacityPerUnit) fait jouer un groupe plus grand que ses machines en tours qui
// s enchainent. Ce gate tient, sans base ni reseau :
//   A. le temps du groupe est celui de tous ses tours : 6 joueurs sur 2 simulateurs de 15 min font 3 tours,
//      45 min (lib/activity-catalog.js activityEstimatedMinutes) ; le Fun Run, une activite sans machines
//      et les tables a l heure gardent leur duree d avant ;
//   B. la ligne du programme le dit : 3 tours, 45 min, 60 € (10 € par personne) ;
//   C. la garde des machines compte ce temps (lib/reservation-ops.js dotationDepassee) : un groupe de 6
//      ne prend pas les machines d un groupe deja la, et passe des qu elles sont libres.
// Le catalogue lu par le moteur recoit une activite « Car racing » telle que la liste vendable la sert ;
// rien d autre n est double.
// Lancement : node scripts/activite-en-tours-check.js [--contre-preuves]
const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const CATALOGUE = 'lib/activity-catalog.js';

// Chaque regle retiree en memoire (le disque n est jamais touche) doit rougir sa ligne.
const MUTATIONS = [
  { nom: 'tours-sans-leur-temps', rouge: '[A] 6 joueurs sur 2 machines font 3 tours de 15 min, soit 45 min', editions: [{ fichier: CATALOGUE, de: '  return Math.max(0, Math.trunc(Number(activity.defaultMinutes) || 0)) * sessionCount(sessions);', vers: '  return Math.max(0, Math.trunc(Number(activity.defaultMinutes) || 0));' }] },
  { nom: 'carte-sans-tours', rouge: '[D] la carte dit 6 joueurs en 3 tours de 15 min', editions: [{ fichier: 'lib/assistant-reservation.js', de: '      enTours,\n', vers: '' }] },
  { nom: 'garde-sur-une-seule-session', rouge: '[C] la garde ne donne pas a un groupe de 6 les machines d un groupe deja la', editions: [{ fichier: CATALOGUE, de: '  return Math.max(0, Math.trunc(Number(activity.defaultMinutes) || 0)) * sessionCount(sessions);', vers: '  return Math.max(0, Math.trunc(Number(activity.defaultMinutes) || 0));' }] },
];

// L activite telle que lib/activity-catalog.js listSellableActivities la sert, une fois le geste
// « ajouter_activite » fait : par personne, une session de 15 min, 2 machines d un joueur.
const RACING = {
  id: 'car_racing', name: 'Car racing', planned: false, resourceType: null, priceType: 'per_pax', priceValue: 10, pricing: null,
  unitLabel: 'par personne', order: null, defaultMinutes: 15, minMinutes: 15, maxMinutes: 15, stepMinutes: 30, note: '', dayAccess: false,
  maxPax: null, units: 2, maxUnitsPerBooking: null, capacityPerUnit: 1, unitIds: null,
};

function purger() {
  Object.keys(require.cache).forEach((cle) => { if (cle.startsWith(ROOT) && !cle.includes(`${path.sep}node_modules${path.sep}`)) delete require.cache[cle]; });
}

function armer(editions) {
  const parFichier = new Map();
  editions.forEach((e) => {
    const cible = path.normalize(path.join(ROOT, e.fichier));
    if (!parFichier.has(cible)) parFichier.set(cible, []);
    parFichier.get(cible).push(e);
  });
  const origine = Module._extensions['.js'];
  Module._extensions['.js'] = function charger(m, f) {
    const liste = parFichier.get(path.normalize(f));
    if (!liste) { origine(m, f); return; }
    let texte = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
    liste.forEach((e) => {
      if (texte.split(e.de).length !== 2) throw new Error(`ancre introuvable ou multiple : ${e.de.slice(0, 80)}`);
      texte = texte.split(e.de).join(e.vers);
    });
    m._compile(texte, f);
  };
  return () => { Module._extensions['.js'] = origine; };
}

// Le catalogue du moteur, avec le Car racing en plus : le module charge (mute ou non), puis sa liste
// vendable completee, avant que lib/visit-program.js et lib/reservation-ops.js ne la lisent.
function chargerLeMoteur() {
  const chemin = path.join(ROOT, CATALOGUE);
  const AC = require(chemin);
  const avec = (centre) => [...AC.listCenterActivities(centre).filter((a) => a.id !== RACING.id), { ...RACING }];
  require.cache[require.resolve(chemin)].exports = {
    ...AC,
    listCenterActivities: avec,
    getCenterActivity: (centre, id) => avec(centre).find((a) => a.id === String(id || '')) || null,
  };
  return { AC, VP: require(path.join(ROOT, 'lib/visit-program.js')), RO: require(path.join(ROOT, 'lib/reservation-ops.js')) };
}

async function verifier(editions = []) {
  const echecs = [];
  const ok = (cond, nom, detail = '') => {
    if (!cond) echecs.push(nom);
    if (!editions.length) console.log(`${cond ? 'ok  ' : 'FAIL'}  ${nom}${cond || !detail ? '' : `  ${String(detail).slice(0, 300)}`}`);
  };
  purger();
  const restaurer = armer(editions);
  try {
    const { AC, VP, RO } = chargerLeMoteur();

    if (!editions.length) console.log('\n[A] le temps du groupe est celui de tous ses tours');
    const tours = AC.activitySessionCount(RACING, 6);
    ok(tours === 3 && AC.activityEstimatedMinutes(RACING, { sessions: tours }) === 45 && AC.activitySessionCount(RACING, 2) === 1 && AC.activityEstimatedMinutes(RACING, { sessions: 1 }) === 15,
      '[A] 6 joueurs sur 2 machines font 3 tours de 15 min, soit 45 min', JSON.stringify({ tours, minutes: AC.activityEstimatedMinutes(RACING, { sessions: tours }) }));
    const avant = [
      AC.activityEstimatedMinutes({ priceType: 'grid_fun_run' }, { minutes: 30, sessions: 2 }),
      AC.activityEstimatedMinutes({ priceType: 'per_pax', defaultMinutes: 45 }, { sessions: 1 }),
      AC.activityEstimatedMinutes({ priceType: 'per_unit_hour', defaultMinutes: 60 }, { hours: 2, sessions: 1 }),
    ];
    ok(JSON.stringify(avant) === '[60,45,120]', '[A] le Fun Run, une activite sans machines et les tables a l heure gardent leur duree', JSON.stringify(avant));

    if (!editions.length) console.log('\n[B] la ligne du programme');
    const programme = VP.normalizeProgram([{ activityId: 'car_racing', participants: 6 }], { centerId: 'libramont', pax: 6, staff: true });
    const ligne = programme.items.find((x) => x.activityId === 'car_racing') || {};
    ok(ligne.sessions === 3 && ligne.rotation === true && ligne.minutes === 45 && ligne.price === 60 && ligne.priceKnown === true,
      '[B] la ligne dit 3 tours, 45 min et 60 € pour 6 joueurs a 10 €', JSON.stringify(ligne));

    if (!editions.length) console.log('\n[C] la garde des machines compte chaque tour');
    const jour = '2026-12-05';
    const dossier = (debut, joueurs, ligneDuProgramme, statut = 'confirmed') => ({
      centerId: 'libramont', date: jour, startTime: debut, status: statut, pax: joueurs,
      totalDuration: ligneDuProgramme.minutes / 60, program: { items: [ligneDuProgramme] }, opsPlan: null,
    });
    const deux = VP.normalizeProgram([{ activityId: 'car_racing', participants: 2 }], { centerId: 'libramont', pax: 2, staff: true }).items[0];
    // Deux joueurs prennent les deux machines de 15:15 a 15:30. Le groupe de 6 arrive a 15:00 et joue jusqu a
    // 15:45 : ses tours croisent forcement ces deux-la. Compte comme UNE session de 15 min, il passait.
    const dejaLa = [dossier('15:15', 2, deux)];
    const seul = RO.dotationDepassee(dossier('15:00', 6, ligne), []);
    const ensemble = RO.dotationDepassee(dossier('15:00', 6, ligne), dejaLa);
    const apres = RO.dotationDepassee(dossier('15:30', 6, ligne), dejaLa);
    ok(seul === '' && ensemble === 'Car racing' && apres === '',
      '[C] la garde ne donne pas a un groupe de 6 les machines d un groupe deja la', JSON.stringify({ seul, ensemble, apres }));
    const annule = RO.dotationDepassee(dossier('15:00', 6, ligne), [dossier('15:15', 2, deux, 'cancelled')]);
    ok(annule === '', '[C] un groupe annule ne tient aucune machine', JSON.stringify({ annule }));

    if (!editions.length) console.log('\n[D] la carte de l assistant dit les tours');
    const R = require(path.join(ROOT, 'lib/assistant-reservation.js'));
    const resume = R.resumeDu({ plan: { disponible: true, blocs: [] }, request: { program: { items: [ligne] } } }, { centreId: 'libramont', programme: [{ activityId: 'car_racing', participants: 6 }], montants: true });
    const dite = (resume.lignes || [])[0] || {};
    ok(dite.nom === 'Car racing' && dite.detail === '6 joueurs, 3 tours de 15 min', '[D] la carte dit 6 joueurs en 3 tours de 15 min', JSON.stringify(dite));
  } finally {
    restaurer();
    purger();
  }
  return echecs;
}

(async () => {
  if (process.argv.includes('--contre-preuves')) {
    let manquees = 0;
    for (const m of MUTATIONS) {
      // eslint-disable-next-line no-await-in-loop
      const echecs = await verifier(m.editions).catch((e) => [`erreur ${e.message}`]);
      const mord = echecs.includes(m.rouge);
      if (!mord) manquees += 1;
      console.log(`${mord ? 'ok  ' : 'FAIL'}  contre-preuve ${m.nom} : ${mord ? `rougit « ${m.rouge} »` : `ne mord pas (${echecs.join(' ; ') || 'tout vert'})`}`);
    }
    console.log(`activite-en-tours-check --contre-preuves: ${MUTATIONS.length - manquees}/${MUTATIONS.length} mordent`);
    process.exit(manquees ? 1 : 0);
  }
  const echecs = await verifier();
  console.log(`\n${echecs.length ? `activite-en-tours-check: ${echecs.length} echec(s)` : 'activite-en-tours-check: ALL OK'}`);
  process.exit(echecs.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

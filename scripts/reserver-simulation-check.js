// L HORLOGE DE LA FENETRE RESERVER DIT CE QUI TIENT (gate ne le 2026-10-08).
//
// Movsar sur la maquette v5 : chaque heure de l horloge dit si TOUT le plan
// tient pour CE groupe (laser puis bowling, 12 joueurs), avec ses deux points
// :00 et :30. lib/reserver-simulation.js prepare, pour chaque heure, le corps
// que la fenetre enverrait, et lit le verdict du moteur. Ce gate prouve les
// regles qui rendent ce verdict honnete :
//   [1] tout l enchainement glisse du meme ecart (depart, activites, parties),
//       sans toucher au corps d origine, et rien ne sort de la journee ;
//   [2] seules les heures de la grille sont essayees, sans doublon, bornees ;
//   [3] le verdict : « ko » dit pourquoi, « partage » quand une partie se joue
//       avec un autre groupe, « ok » sinon ;
//   [4] une heure en erreur devient un « ko » qui dit l erreur, les autres
//       heures continuent ;
//   [5] contre-preuves par mutation : le gate rougit si les parties ne
//       glissent plus, ou si le partage n est plus vu.
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MODULE = path.join(ROOT, 'lib', 'reserver-simulation.js');

let failures = 0;
function ok(cond, label) { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`); if (!cond) failures += 1; return cond; }

const CORPS = {
  date: '2026-10-10',
  pax: 12,
  type: 'visite',
  startTime: '15:00',
  preference: {
    activityOrder: ['laser_game', 'bowling'],
    preferredTimes: { laser_game: '15:00', bowling: '16:00' },
    laserGameTimes: ['15:00', '15:30'],
    laserPlacement: 'scheduled',
  },
  program: { items: [{ activityId: 'laser_game', units: 2 }, { activityId: 'bowling', minutes: 60 }] },
};

const planLaser = (blocs) => ({ ops: { planAvailable: true }, dossier: { opsPlan: { resourceBlocks: blocs, timeline: [] } } });

async function verifier(sim, { sortie = true } = {}) {
  const notes = [];
  const verif = (cond, label) => { notes.push([cond, label]); return cond; };

  // [1] Le glissement
  const decale = sim.decalerCorps(CORPS, 90);
  verif(decale.startTime === '16:30', `[1] le depart glisse de 1 h 30 (${decale.startTime})`);
  verif(decale.preference.preferredTimes.laser_game === '16:30' && decale.preference.preferredTimes.bowling === '17:30',
    `[1] chaque activite glisse du meme ecart (laser ${decale.preference.preferredTimes.laser_game}, bowling ${decale.preference.preferredTimes.bowling})`);
  verif(JSON.stringify(decale.preference.laserGameTimes) === JSON.stringify(['16:30', '17:00']),
    `[1] chaque partie de laser glisse (${JSON.stringify(decale.preference.laserGameTimes)})`);
  verif(CORPS.startTime === '15:00' && CORPS.preference.laserGameTimes[1] === '15:30', '[1] le corps d origine reste intact');
  const tard = sim.decalerCorps(CORPS, 9 * 60);
  verif(tard.startTime === '' || tard.preference.laserGameTimes.includes('') || tard.preference.preferredTimes.bowling === '',
    '[1] un glissement qui sort de la journee ne fabrique pas d heure fausse');
  verif(sim.decalerHeure('23:30', 60) === '', `[1] 23:30 + 1 h ne devient pas 24:30 (« ${sim.decalerHeure('23:30', 60)} »)`);

  // [2] La grille
  const valides = sim.candidatsValides(['10:00', '10:15', '10:30', '10:00', 'xx', '25:00', '22:30']);
  verif(JSON.stringify(valides) === JSON.stringify(['10:00', '10:30', '22:30']), `[2] grille, sans doublon (${JSON.stringify(valides)})`);
  const beaucoup = sim.candidatsValides(Array.from({ length: 60 }, (_, i) => sim.heureDe(i * 30)));
  verif(beaucoup.length === sim.CANDIDATS_MAX, `[2] borne a ${sim.CANDIDATS_MAX} heures (${beaucoup.length})`);

  // [3] Le verdict
  const ko = sim.verdictDuPlan({ planAvailable: false, planRefusal: 'Laser 16:00 : 6 places, il en faut 12.' }, { opsPlan: null });
  verif(ko.statut === 'ko' && /6 places/.test(ko.raison), `[3] ko dit pourquoi (${ko.raison})`);
  const sansRaison = sim.verdictDuPlan({ planAvailable: false }, { opsPlan: null });
  verif(sansRaison.statut === 'ko' && sansRaison.raison.length > 0, '[3] un ko sans motif du moteur dit quand meme quelque chose');
  const partage = sim.verdictDuPlan({ planAvailable: true }, { opsPlan: { resourceBlocks: [{ resourceType: 'laser_arena', playersBefore: 8 }] } });
  verif(partage.statut === 'partage' && /8 joueurs/.test(partage.raison), `[3] partage vu sur les joueurs deja inscrits (${partage.raison})`);
  const partage2 = sim.verdictDuPlan({ planAvailable: true }, { opsPlan: { resourceBlocks: [{ resourceType: 'laser_arena', sharedSession: true }] } });
  verif(partage2.statut === 'partage', '[3] partage vu sur la session partagee');
  const seul = sim.verdictDuPlan({ planAvailable: true }, { opsPlan: { resourceBlocks: [{ resourceType: 'laser_arena', playersBefore: 0 }, { resourceType: 'bowling_lane', lanes: [3, 4] }] } });
  verif(seul.statut === 'ok', `[3] ok quand l arene est a vous (${seul.statut})`);

  // [4] Les candidats, l un apres l autre
  const vus = [];
  const resultats = await sim.simulerCandidats({
    corps: CORPS,
    candidats: ['14:00', '14:15', '15:30', '16:00'],
    planifier: async (corps) => {
      vus.push(corps.startTime + '|' + corps.preference.laserGameTimes.join(','));
      if (corps.startTime === '15:30') throw new Error('Arene en maintenance.');
      if (corps.startTime === '16:00') return { ops: { planAvailable: false, planRefusal: 'Laser 16:00 : 6 places.' }, dossier: { opsPlan: null } };
      return planLaser([{ resourceType: 'laser_arena', playersBefore: 0, startTime: corps.startTime }]);
    },
    finDuPlan: () => '17:00',
  });
  verif(JSON.stringify(vus) === JSON.stringify(['14:00|14:00,14:30', '15:30|15:30,16:00', '16:00|16:00,16:30']),
    `[4] le moteur recoit chaque heure avec ses parties decalees, 14:15 ecartee (${JSON.stringify(vus)})`);
  const parHeure = Object.fromEntries(resultats.map((r) => [r.heure, r]));
  verif(parHeure['14:00'] && parHeure['14:00'].statut === 'ok' && parHeure['14:00'].fin === '17:00', '[4] 14:00 tient, avec sa fin');
  verif(parHeure['15:30'] && parHeure['15:30'].statut === 'ko' && /maintenance/.test(parHeure['15:30'].raison), '[4] une erreur devient un ko qui dit l erreur');
  verif(parHeure['16:00'] && parHeure['16:00'].statut === 'ko' && parHeure['16:00'].fin === '', '[4] un ko n annonce pas de fin');
  let refus = '';
  try { await sim.simulerCandidats({ corps: { ...CORPS, startTime: '' }, candidats: ['10:00'], planifier: async () => planLaser([]) }); } catch (e) { refus = e.message; }
  verif(/Heure de départ/.test(refus), '[4] sans heure de depart, rien n est essaye (refus clair)');

  if (sortie) notes.forEach(([cond, label]) => ok(cond, label));
  return notes;
}

function charger(source) {
  const fichier = path.join(os.tmpdir(), `reserver-simulation-mutant-${process.pid}-${Date.now()}.js`);
  fs.writeFileSync(fichier, source);
  try { return require(fichier); } finally { try { fs.unlinkSync(fichier); } catch (e) { /* nettoyage best-effort */ } }
}

async function contrePreuve(label, avant, apres, attendu) {
  const source = fs.readFileSync(MODULE, 'utf8');
  if (source.split(avant).length !== 2) { ok(false, `${label} : point de mutation introuvable (le gate a vieilli)`); return; }
  const mutant = charger(source.replace(avant, apres));
  const notes = await verifier(mutant, { sortie: false });
  const rouges = notes.filter(([cond]) => !cond).map(([, l]) => l);
  ok(rouges.some((l) => attendu.test(l)), `${label} -> le gate ROUGIT (${rouges.length} assertion(s), dont « ${rouges.find((l) => attendu.test(l)) || 'aucune attendue'} »)`);
}

(async () => {
  try {
    console.log('\n[1-4] LA SIMULATION DE LA FENETRE');
    await verifier(require(MODULE));
    console.log('\n[5] CONTRE-PREUVES PAR MUTATION');
    await contrePreuve('les parties de laser ne glissent plus',
      'preference.laserGameTimes = preference.laserGameTimes.map((heure) => decalerHeure(heure, ecart));',
      'preference.laserGameTimes = preference.laserGameTimes.slice();',
      /chaque partie de laser glisse/);
    await contrePreuve('le partage n est plus vu sur les joueurs deja inscrits',
      "&& (bloc.sharedSession || Number(bloc.playersBefore) > 0));",
      '&& bloc.sharedSession);',
      /partage vu sur les joueurs/);
  } catch (error) {
    console.error('\nreserver-simulation-check FAIL:', error.stack || error.message);
    failures += 1;
  }
  if (failures) { console.error(`\nreserver-simulation-check: ${failures} FAIL`); process.exit(1); }
  console.log('\nreserver-simulation-check: ALL OK - l horloge essaie chaque heure avec tout l enchainement, et dit pourquoi.');
})();

// L ARENE POUR VOUS SEULS (gate ne le 2026-10-08, regle S6 de la fenetre
// Reserver).
//
// `preference.arene === 'seuls'` (comptoir) : les blocs laser du dossier
// retiennent TOUTE la capacite de l arene (players = armes du centre), le
// groupe reste dans `joueursReels`. Une seule ecriture, et les controles
// existants voient la session pleine sans etre reecrits.
//   [1] les blocs laser portent players = 30, joueursReels = 8, arene « seuls » ;
//       le prix ne bouge pas (par participant, sur le programme) ;
//   [2] le moteur ET la base refusent un second groupe dans la session ;
//   [3] un autre groupe deja dans la session : le conflit le dit
//       (« Arène déjà occupée par 6 joueurs à 15:00. ») et la base refuse ;
//   [4] sans le choix (« auto »), rien ne change : 8 joueurs, et un second
//       groupe partage la session ;
//   [5] une modification au comptoir garde le choix (le plan enregistre le
//       porte) ;
//   [6] les lecteurs du groupe lisent joueursReels : le glisser d une partie
//       ne se croit pas en chevauchement, les donnees clients comptent 6, la
//       feuille de secours imprime 8 joueurs et non 30 ;
//   [7] contre-preuves par mutation.
// Zero reseau, zero base. Lancement : node scripts/reserver-arene-seuls-check.js
'use strict';
const path = require('path');
const Module = require('module');

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://gate:gate@127.0.0.1:1/gate';
process.env.PINLANE_CALENDAR_SYNC = 'off';

const ROOT = path.resolve(__dirname, '..');
const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
const LF = String.fromCharCode(10);

let failures = 0;
function ok(cond, label, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures += 1;
  return cond;
}

let mutations = [];
const compileOrigine = Module.prototype._compile;
Module.prototype._compile = function (contenu, nom) {
  const rel = path.relative(ROOT, nom).split(path.sep).join('/');
  const editions = mutations.filter((e) => e.fichier === rel);
  if (!editions.length) return compileOrigine.call(this, contenu, nom);
  let mute = contenu.split(CRLF).join(LF);
  for (const { de, vers } of editions) {
    if (mute.split(de).length - 1 !== 1) throw new Error(`ancre absente ou multiple dans ${rel} : ${de.slice(0, 70)}`);
    mute = mute.split(de).join(vers);
  }
  return compileOrigine.call(this, mute, nom);
};

function charger() {
  for (const cle of Object.keys(require.cache)) {
    if (cle.startsWith(ROOT) && !cle.includes(`${path.sep}node_modules${path.sep}`) && cle !== __filename) delete require.cache[cle];
  }
  return {
    requete: require(path.join(ROOT, 'lib/reservation-request.js')),
    ops: require(path.join(ROOT, 'lib/reservation-ops.js')),
    db: require(path.join(ROOT, 'lib/database.js')),
    move: require(path.join(ROOT, 'lib/reservation-activity-move.js')),
    clients: require(path.join(ROOT, 'lib/donnees-clients.js')),
    fenetre: require(path.join(ROOT, 'lib/reserver-fenetre.js')),
    feuille: require(path.join(ROOT, 'lib/feuille-secours.js')),
  };
}

const JOUR = '2026-10-17';
const BASE = { centerId: 'libramont', date: JOUR, name: 'Arene', phone: '0470', email: '', startTime: '15:00' };
const MARTIN = { id: 902, centerId: 'libramont', date: JOUR, name: 'Martin', status: 'confirmed', type: 'laser', startTime: '15:00', duration: 0.5, pax: 6, lanes: [],
  opsPlan: { resourceBlocks: [{ activityId: 'laser_game', resourceType: 'laser_arena', countIndex: 1, start: 900, end: 925, startTime: '15:00', endTime: '15:25', players: 6 }] } };
const etat = (reservations = []) => async () => ({ reservations, laneStatuses: {} });

async function preparer(M, corps, readState = etat(), options = {}) {
  const request = M.requete.normalizeReservationRequest(corps, { channel: 'staff', centerId: 'libramont' });
  const ops = await M.ops.prepareReservationOps(request, 'staff', { readState, ...options });
  return { ...request, ...ops };
}
const blocsLaser = (d) => ((d.opsPlan && d.opsPlan.resourceBlocks) || []).filter((b) => b.resourceType === 'laser_arena');
const LASER = (pax, extra = {}) => ({ ...BASE, type: 'laser', pax, laserGames: 1, duration: 0.5, ...extra });
const VISITE = (arene) => ({ ...BASE, type: 'visite', pax: 8, program: [{ activityId: 'laser_game', games: 2, participants: 8 }, { activityId: 'bowling', duration: 1, participants: 8 }],
  preference: { activityOrder: ['laser_game', 'bowling'], preferredTimes: { laser_game: '15:00', bowling: '16:00' }, laserGameTimes: ['15:00', '15:30'], laserPlacement: 'scheduled', ...(arene ? { arene } : {}) } });

async function mesurer() {
  const M = charger();
  const f = {};
  const seuls = await preparer(M, LASER(8, { preference: { arene: 'seuls' } }));
  const auto = await preparer(M, LASER(8));
  f.seulsBlocs = blocsLaser(seuls).map((b) => `${b.players}|${b.joueursReels}|${b.arene}|${b.remainingWeapons}`).join(' ');
  f.prix = `${seuls.basePrice}/${seuls.price} contre ${auto.basePrice}/${auto.price}`;
  const visiteSeuls = await preparer(M, VISITE('seuls'));
  const visiteAuto = await preparer(M, VISITE(null));
  f.visite = `${blocsLaser(visiteSeuls).map((b) => `${b.players}|${b.joueursReels}`).join(' ')} ; prix ${visiteSeuls.price} contre ${visiteAuto.price}`;
  // [2] Un second groupe dans la session privatisee.
  const enBase = { ...seuls, id: 7001, status: 'confirmed', lanes: [] };
  const second = await preparer(M, LASER(4), etat([enBase]));
  f.secondMoteur = second.planAvailable === false ? second.planRefusal : 'accepte';
  try { M.db.validateReservationResources({ ...second, name: 'Second' }, [enBase], {}, [], JOUR); f.secondBase = 'accepte'; } catch (e) { f.secondBase = e.message; }
  // [3] Martin deja dans la session.
  const avecMartin = await preparer(M, LASER(8, { preference: { arene: 'seuls' } }), etat([MARTIN]));
  f.conflit = JSON.stringify(avecMartin.areneConflits || []);
  try { M.db.validateReservationResources({ ...avecMartin }, [MARTIN], {}, [], JOUR); f.conflitBase = 'accepte'; } catch (e) { f.conflitBase = e.message; }
  // [4] Sans le choix : partage.
  const autoEnBase = { ...auto, id: 7002, status: 'confirmed', lanes: [] };
  const partage = await preparer(M, LASER(4), etat([autoEnBase]));
  f.auto = `${blocsLaser(auto).map((b) => `${b.players}|${b.joueursReels === undefined ? '-' : b.joueursReels}`).join(' ')} ; second ${partage.planAvailable === false ? 'refuse' : 'accepte'} (${blocsLaser(partage).map((b) => b.playersBefore).join(',')} avant lui)`;
  // [5] Une modification (PATCH) garde le choix porte par le plan enregistre.
  const modifie = await preparer(M, { ...enBase, startTime: '16:00', preference: undefined }, etat([]), { ignoreReservationId: 7001 });
  f.modification = blocsLaser(modifie).map((b) => `${b.startTime}|${b.players}|${b.joueursReels}`).join(' ');
  // [6] Les lecteurs du groupe. Le dossier privatise deplace par le glisser,
  // puis le meme dossier parti « à placer » dont l equipe pose la partie : ce
  // second chemin cree le bloc (gabarit du glisser), sans etape de plan qui
  // le double, et c est lui que le compte des joueurs voit.
  const glisser = (dossier) => {
    try {
      const deplace = M.move.buildActivityMove(dossier, { activityId: 'laser_game', startTime: '16:00', unitKey: '1.1' });
      return { deplace, texte: blocsLaser(deplace).map((b) => `${b.startTime}|${b.players}|${b.joueursReels}`).join(' ') };
    } catch (e) { return { deplace: null, texte: `refus : ${e.message}` }; }
  };
  f.glisserPlan = glisser({ ...enBase }).texte;
  const aPlacer = M.fenetre.versAPlacer({ ...enBase, id: 7003 }, { conflits: [{ type: 'arene', message: 'Arène déjà occupée par 6 joueurs à 15:00.' }], session: { member: { name: 'Rachel' } } });
  const pose = glisser(aPlacer);
  f.glisser = pose.texte;
  // La feuille de secours lit la frise : la partie posee par le glisser y
  // porte players = 30 (l arene) et joueursReels = 8 (le groupe).
  f.feuille = pose.deplace
    ? M.feuille.programmeDetaille(pose.deplace).filter((l) => l.activiteId === 'laser_game').map((l) => l.joueurs).join(',')
    : pose.texte;
  // Les donnees clients : une visite de 10 dont 6 jouent au laser, arene a
  // eux seuls, partie posee par le glisser. Sans joueursReels, les 30 places
  // retenues retombaient sur l effectif (10), pas sur les 6 joueurs.
  const visite6 = await preparer(M, { ...BASE, type: 'visite', pax: 10,
    program: [{ activityId: 'laser_game', games: 1, participants: 6 }, { activityId: 'bowling', duration: 1, participants: 10 }],
    preference: { activityOrder: ['laser_game', 'bowling'], preferredTimes: { laser_game: '15:00', bowling: '16:00' }, laserGameTimes: ['15:00'], laserPlacement: 'scheduled', arene: 'seuls' } });
  const pose6 = glisser(M.fenetre.versAPlacer({ ...visite6, id: 7004, status: 'confirmed' }, { conflits: [{ type: 'arene', message: 'Arène déjà occupée.' }], session: { member: { name: 'Rachel' } } }));
  f.clients = pose6.deplace ? M.clients.etapes(pose6.deplace).filter((e) => e.id === 'laser_game').map((e) => e.joueurs).join(',') : pose6.texte;
  return f;
}

function verifier(f, afficher = true) {
  const notes = [];
  const v = (cond, label) => notes.push([Boolean(cond), label]);
  v(f.seulsBlocs === '30|8|seuls|0', `[1] le bloc laser retient l arene : players|joueursReels|arene|places restantes = ${f.seulsBlocs}`);
  v(f.prix === '80/80 contre 80/80', `[1] le prix ne bouge pas (base/prix seuls ${f.prix})`);
  v(/^30\|8 30\|8 ; prix (\d+) contre \1$/.test(f.visite), `[1] une visite aussi : ses deux parties privatisees, meme prix (${f.visite})`);
  v(/^Laser charge a 15:00: 34\/30 joueurs/.test(f.secondMoteur), `[2] le moteur voit la session pleine (${f.secondMoteur})`);
  v(/^Laser Game complet sur ce créneau \(34\/30 joueurs/.test(f.secondBase), `[2] la base aussi (${f.secondBase})`);
  v(f.conflit === JSON.stringify([{ type: 'arene', message: 'Arène déjà occupée par 6 joueurs à 15:00.', heure: '15:00', joueurs: 6 }]),
    `[3] le conflit dit l arene occupee (${f.conflit})`);
  v(/^Laser Game complet sur ce créneau \(36\/30 joueurs/.test(f.conflitBase), `[3] sans « Créer quand même », la base refuse (${f.conflitBase})`);
  v(f.auto === '8|- ; second accepte (8 avant lui)', `[4] « auto » : le comportement d avant, la session se partage (${f.auto})`);
  v(f.modification === '16:00|30|8', `[5] deplace a 16:00 par une modification, le dossier garde l arene a lui (${f.modification})`);
  v(f.glisserPlan === '16:00|30|8', `[6] le glisser d une partie privatisee garde l arene (${f.glisserPlan})`);
  v(f.glisser === '16:00|30|8', `[6] la partie « à placer » posee par le glisser : arene gardee, pas de faux chevauchement avec le groupe (${f.glisser})`);
  v(f.clients === '6', `[6] les donnees clients comptent les 6 joueurs du laser, pas l arene ni l effectif (${f.clients})`);
  v(f.feuille === '8', `[6] la feuille de secours imprime les 8 joueurs du groupe, pas les 30 places retenues (${f.feuille})`);
  if (afficher) notes.forEach(([cond, label]) => ok(cond, label));
  return notes;
}

async function contrePreuve(nom, mutation, attendu) {
  mutations = [mutation];
  let rouges = [];
  try {
    rouges = verifier(await mesurer(), false).filter(([cond]) => !cond).map(([, l]) => l);
  } catch (error) {
    mutations = [];
    ok(!/ancre absente/.test(error.message), `contre-preuve « ${nom} » : le gate ROUGIT`, `exception : ${error.message.slice(0, 160)}`);
    return;
  }
  mutations = [];
  const trouve = rouges.find((l) => attendu.test(l));
  ok(Boolean(trouve), `contre-preuve « ${nom} » : le gate ROUGIT`, (trouve || `aucune attendue, ${rouges.length} rouge(s) : ${rouges[0] || ''}`).slice(0, 170));
}

(async () => {
  try {
    console.log('\n[1-6] L ARENE POUR VOUS SEULS');
    verifier(await mesurer());
    console.log('\n[7] CONTRE-PREUVES PAR MUTATION');
    await contrePreuve('le bloc garde le nombre de joueurs du groupe',
      { fichier: 'lib/reservation-ops.js', de: '      players: capacite,\n      weaponNeed: capacite,', vers: '      players: reels,\n      weaponNeed: reels,' },
      /\[2\] le moteur voit la session pleine/);
    await contrePreuve('l autre groupe deja dans la session n est plus signale',
      { fichier: 'lib/reservation-ops.js', de: '    if (autres > 0 && !vus.has(message)) {', vers: '    if (false) {' },
      /\[3\] le conflit dit l arene occupee/);
    await contrePreuve('une modification oublie le choix du plan enregistre',
      { fichier: 'lib/reservation-ops.js', de: "  return request && request.opsPlan && request.opsPlan.arene === 'seuls' ? 'seuls' : 'auto';", vers: "  return 'auto';" },
      /\[5\] deplace a 16:00/);
    await contrePreuve('le glisser compte la place retenue comme des joueurs',
      { fichier: 'lib/reservation-activity-move.js', de: '      const demand = concurrent.reduce((sum, block) => sum + Number((block.joueursReels ?? block.players)', vers: '      const demand = concurrent.reduce((sum, block) => sum + Number((block.players)' },
      /\[6\] la partie « à placer » posee par le glisser/);
    await contrePreuve('les donnees clients comptent l arene',
      { fichier: 'lib/donnees-clients.js', de: 'joueurs: Number(b.joueursReels ?? b.players) || 0', vers: 'joueurs: Number(b.players) || 0' },
      /\[6\] les donnees clients/);
    await contrePreuve('la feuille de secours imprime l arene',
      { fichier: 'lib/feuille-secours.js', de: '  return Number(b && (b.joueursReels ?? b.players)) || 0;', vers: '  return Number(b && b.players) || 0;' },
      /\[6\] la feuille de secours/);
  } catch (error) {
    console.error('\nreserver-arene-seuls-check ERREUR', error.stack || error.message);
    failures += 1;
  }
  if (failures) { console.error(`\nreserver-arene-seuls-check: ${failures} FAIL`); process.exit(1); }
  console.log('\nreserver-arene-seuls-check: ALL OK - l arene a vous seuls retient toutes les places, et le groupe garde son compte.');
  process.exit(0);
})();

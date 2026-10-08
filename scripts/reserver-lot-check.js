// LE LOT DE LA FENETRE RESERVER : PLUSIEURS DOSSIERS, DANS L ORDRE, SANS ECHEC
// MUET (gate ne le 2026-10-08, regle S5).
//
// Le VRAI handler api/staff-reservations.js (`dossiers: [...]`) et la VRAIE
// creation, sur la base en memoire. A 17:00, huit pistes libres.
//   [1] chaque dossier est planifie APRES que le precedent est en base : 40
//       joueurs prennent 7 pistes, le dossier suivant la 8e ; le 3e ne trouve
//       plus de piste, son echec est rendu avec son rang, les deux premiers
//       restent crees (207, ok false) ;
//   [2] tout passe : 201, ok true, aucun echec ;
//   [3] « Créer quand même » se decide dossier par dossier : le dossier 1
//       force part à placer sans rien tenir, le dossier 2 normal prend la
//       derniere piste et l arene jusqu a sa derniere place ; un `forcer`
//       pose sur le lot est ignore (complement du coordinateur, 2026-10-08) ;
//   [4] un dossier invalide ne fait pas tomber les autres ; un lot vide ou de
//       plus de 12 dossiers est refuse en 422 ;
//   [5] le centre est celui de la session, meme si un dossier en nomme un
//       autre ;
//   [6] contre-preuves par mutation.
// Lancement : node scripts/reserver-lot-check.js
'use strict';
const B = require('./reserver-banc.js');

let failures = 0;
function ok(cond, label, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures += 1;
  return cond;
}

const URL_RESA = '/api/staff-reservations';
const BOWLING = (nom, pax, extra = {}) => B.corpsStaff({ name: nom, type: 'bowling', pax, startTime: '17:00', duration: 1, totalDuration: 1, lanes: [], laneCount: Math.ceil(pax / 6), ...extra });

async function scenario(mutations = []) {
  const f = {};
  // [1] Trois dossiers, le 3e de trop.
  B.semer([]);
  let m = B.monter({ mutations });
  const lot = await m.appeler('POST', URL_RESA, { centerId: 'libramont', dossiers: [BOWLING('Grand groupe', 40), BOWLING('Petit', 4), BOWLING('De trop', 4)] });
  f.lot = { statut: lot.statut, ok: lot.json.ok, crees: (lot.json.reservations || []).map((r) => `${r.index}:${(r.reservation || {}).lanes.join('+')}`), echecs: lot.json.echecs || [] };
  f.enBase1 = [...B.base.reservations.values()].map((r) => `${r.name}:${r.lanes.join('+')}`).sort();
  // [2] Tout passe.
  B.semer([]);
  m = B.monter({ mutations });
  const tout = await m.appeler('POST', URL_RESA, { centerId: 'libramont', dossiers: [BOWLING('Un', 4), BOWLING('Deux', 4, { startTime: '18:00' }), B.corpsStaff({ name: 'Trois', type: 'laser', pax: 6, startTime: '19:00', laserGames: 2, duration: 1 })] });
  f.tout = { statut: tout.statut, ok: tout.json.ok, n: (tout.json.reservations || []).length, echecs: (tout.json.echecs || []).length, ordre: (tout.json.reservations || []).map((r) => r.reservation.name).join(',') };
  // [3] Un `forcer` pose sur le lot ne force personne.
  B.semer([]);
  m = B.monter({ mutations });
  const forceLot = await m.appeler('POST', URL_RESA, { centerId: 'libramont', forcer: true, dossiers: [BOWLING('Grand groupe', 40), BOWLING('Petit', 4), BOWLING('De trop', 4)] });
  f.forceLot = { statut: forceLot.statut, aPlacer: (forceLot.json.reservations || []).map((r) => r.aPlacer), echecs: (forceLot.json.echecs || []).map((e) => e.index) };
  // [3] Le dossier 1 force, le dossier 2 normal. Martin (6 joueurs) est dans
  // l arene a 15:00, les pistes 1 a 7 sont prises a 17:00.
  B.semer([
    B.ligne(902, { start_time: '15:00', type: 'laser', lanes: [], name: 'Martin', pax: 6, duration: 0.5,
      ops_plan: { resourceBlocks: [{ activityId: 'laser_game', resourceType: 'laser_arena', countIndex: 1, start: 900, end: 925, startTime: '15:00', endTime: '15:25', players: 6 }] } }),
    ...[1, 2, 3, 4, 5, 6, 7].map((piste) => B.ligne(910 + piste, { start_time: '17:00', lanes: [piste], name: `Piste ${piste}` })),
  ]);
  m = B.monter({ mutations });
  const visite = (nom, pax, laser, bowling, extra = {}) => B.corpsStaff({ name: nom, type: 'visite', pax, startTime: '15:00',
    program: [{ activityId: 'laser_game', games: 1, participants: laser }, { activityId: 'bowling', duration: 1, participants: bowling }],
    preference: { activityOrder: ['laser_game', 'bowling'], preferredTimes: { laser_game: '15:00', bowling: '17:00' }, laserGameTimes: ['15:00'], laserPlacement: 'scheduled', ...(extra.arene ? { arene: extra.arene } : {}) },
    ...(extra.forcer ? { forcer: true } : {}) });
  const parDossier = await m.appeler('POST', URL_RESA, { centerId: 'libramont', dossiers: [
    visite('Force', 8, 8, 8, { arene: 'seuls', forcer: true }),
    visite('Normal', 24, 24, 6),
  ] });
  const crees = parDossier.json.reservations || [];
  const blocsDe = (r) => ((r.reservation.opsPlan || {}).resourceBlocks || []);
  const rang = (index) => crees.find((r) => r.index === index);
  const force = rang(0);
  const normal = rang(1);
  f.parDossier = {
    statut: parDossier.statut,
    ok: parDossier.json.ok,
    aPlacer: crees.map((r) => r.aPlacer),
    force: force ? `${JSON.stringify(force.reservation.lanes)}|${blocsDe(force).length}|${force.reservation.validationStatus}` : `refuse : ${JSON.stringify(parDossier.json.echecs)}`,
    normal: normal ? `${JSON.stringify(normal.reservation.lanes)}|${blocsDe(normal).filter((b) => b.resourceType === 'laser_arena').map((b) => `${b.startTime}:${b.players}`).join(',')}` : `refuse : ${JSON.stringify(parDossier.json.echecs)}`,
  };
  // [4] Un dossier invalide au milieu ; des lots hors bornes.
  B.semer([]);
  m = B.monter({ mutations });
  const trou = await m.appeler('POST', URL_RESA, { centerId: 'libramont', dossiers: [BOWLING('Avant', 4), null, BOWLING('Apres', 4, { startTime: '18:00' })] });
  f.trou = { statut: trou.statut, crees: (trou.json.reservations || []).map((r) => r.index).join(','), echecs: trou.json.echecs || [] };
  const vide = await m.appeler('POST', URL_RESA, { centerId: 'libramont', dossiers: [] });
  const trop = await m.appeler('POST', URL_RESA, { centerId: 'libramont', dossiers: Array.from({ length: 13 }, (_, i) => BOWLING(`N${i}`, 2)) });
  f.bornes = `${vide.statut} ${vide.json.message} | ${trop.statut} ${trop.json.message}`;
  // [5] Le centre de la session.
  B.semer([]);
  m = B.monter({ mutations });
  const ailleurs = await m.appeler('POST', URL_RESA, { centerId: 'libramont', dossiers: [BOWLING('Ailleurs', 4, { centerId: 'gembloux', center_id: 'gembloux' })] });
  f.centre = `${ailleurs.statut} ${((ailleurs.json.reservations || [])[0] || {}).reservation ? ailleurs.json.reservations[0].reservation.centerId : JSON.stringify(ailleurs.json.echecs)}`;
  f.audits = m.journal.audits.filter((a) => a.action === 'createReservation').map((a) => a.context && a.context.lot && `${a.context.lot.index}/${a.context.lot.total}`);
  return f;
}

function verifier(f, afficher = true) {
  const notes = [];
  const v = (cond, label) => notes.push([Boolean(cond), label]);
  v(f.lot.statut === 207 && f.lot.ok === false, `[1] lot partiel : 207, ok false (${f.lot.statut}, ${f.lot.ok})`);
  v(JSON.stringify(f.lot.crees) === JSON.stringify(['0:1+2+3+4+5+6+7', '1:8']),
    `[1] dans l ordre, chacun apres le precedent : 40 joueurs sur 7 pistes, le suivant sur la 8e (${JSON.stringify(f.lot.crees)})`);
  v(f.lot.echecs.length === 1 && f.lot.echecs[0].index === 2 && /piste/i.test(f.lot.echecs[0].message),
    `[1] l echec dit son rang et sa raison (${JSON.stringify(f.lot.echecs)})`);
  v(JSON.stringify(f.enBase1) === JSON.stringify(['Grand groupe:1+2+3+4+5+6+7', 'Petit:8']), `[1] en base : les deux crees, rien d autre (${JSON.stringify(f.enBase1)})`);
  v(f.tout.statut === 201 && f.tout.ok === true && f.tout.n === 3 && f.tout.echecs === 0 && f.tout.ordre === 'Un,Deux,Trois',
    `[2] tout passe : 201, trois reservations dans l ordre (${JSON.stringify(f.tout)})`);
  v(f.forceLot.statut === 207 && JSON.stringify(f.forceLot.aPlacer) === '[false,false]' && JSON.stringify(f.forceLot.echecs) === '[2]',
    `[3] un forcer pose sur le lot est ignore : le 3e est refuse, pas mis à placer (${JSON.stringify(f.forceLot)})`);
  v(f.parDossier.statut === 201 && f.parDossier.ok === true && JSON.stringify(f.parDossier.aPlacer) === '[true,false]' && f.parDossier.force === '[]|0|staff_review',
    `[3] dossier 1 force : à placer, sans piste ni bloc (${JSON.stringify(f.parDossier)})`);
  v(f.parDossier.normal === '[8]|15:00:24', `[3] dossier 2 normal : la piste 8 et l arene jusqu a 30 (6 + 24) (${f.parDossier.normal})`);
  v(f.trou.statut === 207 && f.trou.crees === '0,2' && f.trou.echecs.length === 1 && f.trou.echecs[0].index === 1 && f.trou.echecs[0].message === 'Dossier invalide.',
    `[4] un dossier invalide au milieu : les autres crees, son echec rendu (${JSON.stringify(f.trou)})`);
  v(f.bornes === '422 Un envoi porte de 1 à 12 dossiers. | 422 Un envoi porte de 1 à 12 dossiers.', `[4] bornes du lot (${f.bornes})`);
  v(f.centre === '201 libramont', `[5] le dossier qui nomme un autre centre est cree dans celui de la session (${f.centre})`);
  v(JSON.stringify(f.audits) === JSON.stringify(['0/1']), `[5] le journal situe le dossier dans son lot (${JSON.stringify(f.audits)})`);
  if (afficher) notes.forEach(([cond, label]) => ok(cond, label));
  return notes;
}

async function contrePreuve(nom, mutation, attendu) {
  let rouges = [];
  try {
    rouges = verifier(await scenario([mutation]), false).filter(([cond]) => !cond).map(([, l]) => l);
  } catch (error) {
    ok(!/ancre absente/.test(error.message), `contre-preuve « ${nom} » : le gate ROUGIT`, `exception : ${error.message.slice(0, 160)}`);
    return;
  }
  const trouve = rouges.find((l) => attendu.test(l));
  ok(Boolean(trouve), `contre-preuve « ${nom} » : le gate ROUGIT`, (trouve || `aucune attendue, ${rouges.length} rouge(s) : ${rouges[0] || ''}`).slice(0, 170));
}

(async () => {
  try {
    console.log('\n[1-5] LE LOT');
    verifier(await scenario());
    console.log('\n[6] CONTRE-PREUVES PAR MUTATION');
    await contrePreuve('le lot planifie sur une journee figee, sans les dossiers deja crees',
      { fichier: 'api/staff-reservations.js', de: '      const prepare = await planifierPourLaFenetre(corps, session, { forcer: corps.forcer === true });', vers: '      const prepare = await planifierPourLaFenetre(corps, session, { forcer: corps.forcer === true, readState: async () => ({ reservations: [], laneStatuses: {} }) });' },
      /\[1\] dans l ordre/);
    await contrePreuve('le premier echec arrete le lot',
      { fichier: 'api/staff-reservations.js', de: '      echecs.push({ index, message: infra ? MESSAGE_INFRA : String(error.message), infra });', vers: '      throw error;' },
      /\[4\] un dossier invalide au milieu|\[1\] lot partiel/);
    await contrePreuve('le forcer du lot force tous les dossiers',
      { fichier: 'api/staff-reservations.js', de: '      const prepare = await planifierPourLaFenetre(corps, session, { forcer: corps.forcer === true });', vers: '      const prepare = await planifierPourLaFenetre(corps, session, { forcer: corps.forcer === true || body.forcer === true });' },
      /\[3\] un forcer pose sur le lot est ignore/);
    await contrePreuve('le forcer du dossier est ignore',
      { fichier: 'api/staff-reservations.js', de: '      const prepare = await planifierPourLaFenetre(corps, session, { forcer: corps.forcer === true });', vers: '      const prepare = await planifierPourLaFenetre(corps, session, { forcer: false });' },
      /\[3\] dossier 1 force/);
    await contrePreuve('le dossier garde le centre qu il nomme',
      { fichier: 'lib/reserver-fenetre.js', de: '  const corps = { ...(body || {}), ...(centreSession ? { centerId: centreSession } : {}) };', vers: '  const corps = { ...(body || {}) };' },
      /\[5\] le dossier qui nomme un autre centre/);
  } catch (error) {
    console.error('\nreserver-lot-check ERREUR', error.stack || error.message);
    failures += 1;
  }
  B.sortir('reserver-lot-check', failures, 'le lot cree dans l ordre, rend chaque echec, et ne force que les dossiers qui le demandent.');
})();

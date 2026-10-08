// « CRÉER QUAND MÊME » : UN DOSSIER EN CONFLIT PART À PLACER ET N OCCUPE RIEN
// (gate ne le 2026-10-08, regle S4 de la fenetre Reserver).
//
// Le VRAI handler api/staff-reservations.js et la VRAIE creation
// (lib/database.js, transaction et verrou de journee), sur la base en memoire.
//   [1] sans `forcer`, un dossier sans place est refuse comme avant ; avec
//       `forcer`, il est cree « à placer » : aucune piste (lanes [] et
//       laneCount 0), aucun bloc de ressource (laserManual), validation
//       « à vérifier », une note de l equipe au format existant qui dit le
//       conflit, signee du nom de la personne de la session ; la reponse porte
//       { aPlacer: true, conflits } ;
//   [2] un dossier à placer n occupe ni piste ni arene : le dossier suivant
//       prend les 7 dernieres pistes, et l arene jusqu a sa derniere place ;
//   [3] sans conflit, `forcer` ne change rien ;
//   [4] contre-preuves par mutation.
// Lancement : node scripts/reserver-a-placer-check.js
'use strict';
const path = require('path');
const B = require('./reserver-banc.js');

let failures = 0;
function ok(cond, label, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures += 1;
  return cond;
}

const URL_RESA = '/api/staff-reservations';
const MARTIN = () => B.ligne(902, { start_time: '15:00', type: 'laser', lanes: [], name: 'Martin', pax: 6, duration: 0.5,
  ops_plan: { resourceBlocks: [{ activityId: 'laser_game', resourceType: 'laser_arena', countIndex: 1, start: 900, end: 925, startTime: '15:00', endTime: '15:25', players: 6 }] } });
const PLEIN_16H = () => [1, 2, 3, 4, 5, 6, 7, 8].map((piste) => B.ligne(910 + piste, { start_time: '16:00', lanes: [piste], name: `Piste ${piste}` }));
const BOWLING = (heure, extra = {}) => B.corpsStaff({ type: 'bowling', pax: 4, startTime: heure, duration: 1, totalDuration: 1, lanes: [], laneCount: 1, ...extra });
const LASER = (heure, pax, extra = {}) => B.corpsStaff({ type: 'laser', pax, startTime: heure, laserGames: 1, duration: 0.5, ...extra });

async function scenario(mutations = []) {
  B.semer([MARTIN(), ...PLEIN_16H(), B.ligne(930, { start_time: '18:00', lanes: [5], name: 'Dupont', pax: 4 })]);
  const m = B.monter({ mutations });
  const f = {};
  // [1] Plus aucune piste a 16:00.
  const refus = await m.appeler('POST', URL_RESA, BOWLING('16:00'));
  f.refusStatut = refus.statut;
  f.refusMessage = refus.json.message || '';
  const force = await m.appeler('POST', URL_RESA, { ...BOWLING('16:00'), forcer: true });
  f.force = { statut: force.statut, aPlacer: force.json.aPlacer, conflits: force.json.conflits || [], r: force.json.reservation || {} };
  // L arene a vous seuls, Martin deja dedans.
  const refusLaser = await m.appeler('POST', URL_RESA, LASER('15:00', 8, { preference: { arene: 'seuls' } }));
  f.refusLaser = `${refusLaser.statut} ${refusLaser.json.message || ''}`;
  const laser = await m.appeler('POST', URL_RESA, { ...LASER('15:00', 8, { preference: { arene: 'seuls' } }), forcer: true });
  f.laser = { statut: laser.statut, aPlacer: laser.json.aPlacer, r: laser.json.reservation || {} };
  // [2] Les suivants : l arene jusqu a la derniere place (6 + 24 = 30), et a
  // 18:00 une piste demandee prise (Dupont, 5) part a placer, puis 40 joueurs
  // prennent les 7 autres pistes.
  const suivantLaser = await m.appeler('POST', URL_RESA, LASER('15:00', 24));
  f.suivantLaser = `${suivantLaser.statut} ${suivantLaser.json.message || ''}`;
  const pisteForcee = await m.appeler('POST', URL_RESA, { ...BOWLING('18:00', { lanes: [5] }), forcer: true });
  f.pisteForcee = { statut: pisteForcee.statut, aPlacer: pisteForcee.json.aPlacer, lanes: (pisteForcee.json.reservation || {}).lanes };
  const quarante = await m.appeler('POST', URL_RESA, BOWLING('18:00', { pax: 40, laneCount: 7 }));
  f.quarante = { statut: quarante.statut, lanes: (quarante.json.reservation || {}).lanes || [], message: quarante.json.message || '' };
  // [3] Sans conflit, forcer ne change rien.
  const libre = await m.appeler('POST', URL_RESA, { ...BOWLING('20:00'), forcer: true });
  f.libre = { statut: libre.statut, aPlacer: libre.json.aPlacer, conflits: libre.json.conflits || [], r: libre.json.reservation || {} };
  f.audits = m.journal.audits.filter((a) => a.action === 'createReservation').map((a) => a.context && a.context.aPlacer === true);
  return f;
}

function lireNote(notes) {
  const { lireNoteEquipe } = require(path.join(B.ROOT, 'lib/database.js'));
  return String(notes || '').split('\n').map(lireNoteEquipe).filter(Boolean);
}

function verifier(f, afficher = true) {
  const notes = [];
  const v = (cond, label) => notes.push([Boolean(cond), label]);
  v(f.refusStatut === 400 && /piste/i.test(f.refusMessage), `[1] sans forcer, 16:00 complet est refuse (${f.refusStatut} : ${f.refusMessage})`);
  const r = f.force.r;
  const plan = r.opsPlan || {};
  v(f.force.statut === 201 && f.force.aPlacer === true && f.force.conflits.some((c) => c.type === 'plan'),
    `[1] avec forcer : cree, aPlacer true, conflits rendus (${f.force.statut}, ${JSON.stringify(f.force.conflits.map((c) => c.message))})`);
  v(Array.isArray(r.lanes) && r.lanes.length === 0 && Array.isArray(plan.resourceBlocks) && plan.resourceBlocks.length === 0 && plan.laserManual === true,
    `[1] aucune piste, aucun bloc de ressource, laserManual (lanes ${JSON.stringify(r.lanes)}, blocs ${JSON.stringify(plan.resourceBlocks)})`);
  v(r.validationStatus === 'staff_review' && plan.aPlacer && plan.aPlacer.par === 'Rachel',
    `[1] validation « à vérifier », le plan dit qui l a pose (${r.validationStatus}, ${plan.aPlacer && plan.aPlacer.par})`);
  const note = lireNote(r.notes)[0];
  v(note && note.par === 'Rachel' && /^À placer : créé malgré le conflit\. /.test(note.t) && note.t.includes(f.force.conflits[0] && f.force.conflits[0].message) && /^\d{4}-\d{2}-\d{2}T/.test(note.le),
    `[1] note de l equipe au format existant, signee : ${JSON.stringify(note)}`);
  v(r.price === 39 && r.basePrice === 39, `[1] le dossier à placer garde son prix (base ${r.basePrice}, prix ${r.price})`);
  v(/^400 Laser Game complet sur ce créneau \(36\/30 joueurs/.test(f.refusLaser), `[1] l arene a vous seuls avec Martin dedans : refusee sans forcer (${f.refusLaser})`);
  const lr = f.laser.r;
  v(f.laser.statut === 201 && f.laser.aPlacer === true && (lr.opsPlan || {}).laserManual === true && ((lr.opsPlan || {}).resourceBlocks || []).length === 0
    && (lr.opsPlan || {}).arene === 'seuls' && ((lr.opsPlan || {}).laserPassPlan || {}).remainingGames === 1,
    `[1] le laser force part à placer, sa partie a placer, son choix d arene garde (${f.laser.statut}, ${JSON.stringify(lr.opsPlan && lr.opsPlan.laserPassPlan && lr.opsPlan.laserPassPlan.pendingUnits)})`);
  v(/^201 /.test(f.suivantLaser), `[2] l arene : 6 + 24 joueurs passent, le laser à placer n y prend aucune place (${f.suivantLaser})`);
  v(f.pisteForcee.statut === 201 && f.pisteForcee.aPlacer === true && JSON.stringify(f.pisteForcee.lanes) === '[]',
    `[2] piste 5 prise a 18:00, forcee : à placer sans piste (${JSON.stringify(f.pisteForcee)})`);
  v(f.quarante.statut === 201 && f.quarante.lanes.length === 7 && !f.quarante.lanes.includes(5),
    `[2] 40 joueurs prennent les 7 autres pistes : le dossier à placer n en tient aucune (${f.quarante.statut} ${JSON.stringify(f.quarante.lanes)} ${f.quarante.message})`);
  v(f.libre.statut === 201 && f.libre.aPlacer === false && f.libre.conflits.length === 0 && f.libre.r.lanes.length === 1
    && !(f.libre.r.opsPlan || {}).aPlacer && f.libre.r.validationStatus !== 'staff_review' && !lireNote(f.libre.r.notes).length,
    `[3] sans conflit, forcer ne change rien (${f.libre.statut}, pistes ${JSON.stringify(f.libre.r.lanes)}, ${f.libre.r.validationStatus})`);
  v(JSON.stringify(f.audits) === JSON.stringify([true, true, false, true, false, false]),
    `[3] le journal d audit dit qui est parti à placer (${JSON.stringify(f.audits)})`);
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
    console.log('\n[1-3] CRÉER QUAND MÊME');
    verifier(await scenario());
    console.log('\n[4] CONTRE-PREUVES PAR MUTATION');
    await contrePreuve('forcer est ignore',
      { fichier: 'lib/reserver-fenetre.js', de: '  const aPlacer = options.forcer === true && conflits.length > 0;', vers: '  const aPlacer = false;' },
      /\[1\] avec forcer : cree/);
    await contrePreuve('forcer sans conflit part quand meme à placer',
      { fichier: 'lib/reserver-fenetre.js', de: '  const aPlacer = options.forcer === true && conflits.length > 0;', vers: '  const aPlacer = options.forcer === true;' },
      /\[3\] sans conflit, forcer ne change rien/);
    await contrePreuve('la base attribue quand meme des pistes au dossier à placer',
      { fichier: 'lib/database.js', de: '  if (payload.opsPlan && typeof payload.opsPlan === \'object\' && payload.opsPlan.aPlacer) return false;\n', vers: '' },
      /\[2\] (piste 5 prise a 18:00|40 joueurs)|\[1\] aucune piste/);
    await contrePreuve('le laser à placer retombe sur sa partie implicite',
      { fichier: 'lib/reserver-fenetre.js', de: '    laserManual: true,\n    resourceBlocks: [],', vers: '    resourceBlocks: [],' },
      /\[2\] l arene : 6 \+ 24/);
    await contrePreuve('la note n est plus signee par la session',
      { fichier: 'lib/reserver-fenetre.js', de: '  const par = nomDuMembre(session);', vers: "  const par = 'Équipe';" },
      /\[1\] note de l equipe/);
  } catch (error) {
    console.error('\nreserver-a-placer-check ERREUR', error.stack || error.message);
    failures += 1;
  }
  B.sortir('reserver-a-placer-check', failures, 'un dossier force part à placer, signe, et ne prend ni piste ni arene.');
})();

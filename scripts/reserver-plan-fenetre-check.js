// LA SIMULATION DE LA FENETRE RESERVER DIT TOUT CE QUE LA CREATION POSERA
// (gate ne le 2026-10-08, regle S3 et ses deux complements).
//
// Le VRAI handler api/staff-reservations.js, en `dryRun`, sur la base en
// memoire (scripts/reserver-banc.js). Une journee : Dupont joue sur la piste 5
// de 16:00 a 17:00, Martin (6 joueurs) est dans l arene a 15:00.
//   [1] le plan d une visite (laser 2 parties puis bowling, 8 joueurs, pistes 5
//       et 6 demandees, arene « pour vous seuls ») porte ses conflits : l arene
//       occupee (« Arène déjà occupée par 6 joueurs à 15:00. »), la piste 5
//       prise (la piste, l heure, le nom de l occupant, la piste prise a la
//       place) ; et ses lignes de prix, qui font le prix ; ses blocs laser
//       disent la place retenue (30) ET le groupe (joueursReels 8) ;
//   [2] les heures de l horloge (forme chaine) : chacune avec statut, raison,
//       fin et conflits ; l arene occupee ferme l heure ; UNE seule lecture de
//       la journee pour toute la demande ;
//   [3] les variantes (forme objet) : seuls startTime, preference, lanes et
//       laneCount remplacent ceux du corps (un `pax` glisse dans la variante
//       est ignore) ; une piste choisie prise laisse l heure ouverte et le dit ;
//       une heure hors grille ou un depart invalide devient un « ko » qui dit
//       pourquoi, sans faire tomber les autres ; 48 essais au plus ;
//   [4] les autres dossiers du meme envoi sont simules d abord et occupent la
//       journee : le dossier suivant les voit, nommes « (même envoi) » ;
//   [5] contre-preuves par mutation.
// Lancement : node scripts/reserver-plan-fenetre-check.js
'use strict';
const B = require('./reserver-banc.js');

let failures = 0;
function ok(cond, label, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures += 1;
  return cond;
}

const URL_RESA = '/api/staff-reservations';
const pref = (laser, bowling, parties, extra = {}) => ({ activityOrder: ['laser_game', 'bowling'], preferredTimes: { laser_game: laser, bowling }, laserGameTimes: parties, laserPlacement: 'scheduled', ...extra });

function journee() {
  B.semer([
    B.ligne(901, { start_time: '16:00', lanes: [5], name: 'Dupont', pax: 4 }),
    B.ligne(902, { start_time: '15:00', type: 'laser', lanes: [], name: 'Martin', pax: 6, duration: 0.5,
      ops_plan: { resourceBlocks: [{ activityId: 'laser_game', resourceType: 'laser_arena', countIndex: 1, start: 900, end: 925, startTime: '15:00', endTime: '15:25', players: 6 }] } }),
  ]);
}

const VISITE = () => B.corpsStaff({
  type: 'visite', pax: 8, startTime: '15:00', lanes: [5, 6],
  program: [{ activityId: 'laser_game', games: 2, participants: 8 }, { activityId: 'bowling', duration: 1, participants: 8 }],
  preference: pref('15:00', '16:00', ['15:00', '15:30'], { arene: 'seuls' }),
});
const BOWLING = (heure = '16:00', extra = {}) => B.corpsStaff({ type: 'bowling', pax: 4, startTime: heure, duration: 1, totalDuration: 1, lanes: [], laneCount: 1, ...extra });

async function scenario(mutations = []) {
  journee();
  const m = B.monter({ mutations });
  const f = {};
  // [1] et [2]
  B.extra.lecturesJournee = 0;
  const r1 = await m.appeler('POST', URL_RESA, { ...VISITE(), dryRun: true, candidats: ['15:00', '17:00', '17:15'] });
  f.statut1 = r1.statut;
  f.plan = r1.json.plan || {};
  f.candidats1 = r1.json.candidats || [];
  f.lectures1 = B.extra.lecturesJournee;
  // [3]
  B.extra.lecturesJournee = 0;
  const r3 = await m.appeler('POST', URL_RESA, { ...BOWLING('15:00'), dryRun: true, candidats: [
    { heure: '16:00', startTime: '16:00', lanes: [5] },
    { heure: '16:00', startTime: '16:00', lanes: [7], pax: 99, type: 'laser', name: 'Ignore' },
    { heure: '18:00', startTime: '18:00', laneCount: 3 },
    { heure: '18:00', startTime: '18:00', laneCount: 9 },
    { heure: '16:15', startTime: '16:15' },
    { heure: '17:00', startTime: 'xx' },
    '19:00',
  ] });
  f.statut3 = r3.statut;
  f.variantes = r3.json.candidats || [];
  f.lectures3 = B.extra.lecturesJournee;
  const r3b = await m.appeler('POST', URL_RESA, { ...BOWLING('15:00'), dryRun: true, candidats: Array.from({ length: 60 }, (_, i) => ({ heure: '20:00', startTime: '20:00', lanes: [1 + (i % 8)] })) });
  f.borne = (r3b.json.candidats || []).length;
  // [4]
  B.extra.lecturesJournee = 0;
  const autre = B.corpsStaff({ name: 'Leroy', type: 'bowling', pax: 40, startTime: '17:00', duration: 1, totalDuration: 1, laneCount: 8, lanes: [] });
  const r4 = await m.appeler('POST', URL_RESA, { ...BOWLING('17:00', { lanes: [3] }), dryRun: true, autres: [autre], candidats: ['17:00', '18:00'] });
  f.statut4 = r4.statut;
  f.plan4 = r4.json.plan || {};
  f.autres4 = r4.json.autres || [];
  f.candidats4 = r4.json.candidats || [];
  f.lectures4 = B.extra.lecturesJournee;
  f.ecritures = [...B.base.reservations.keys()].length;
  return f;
}

const parHeure = (liste, heure) => liste.filter((c) => c.heure === heure);

function verifier(f, afficher = true) {
  const notes = [];
  const v = (cond, label) => notes.push([Boolean(cond), label]);
  const conflits = f.plan.conflits || [];
  v(f.statut1 === 200 && f.plan.disponible === true, `[1] la simulation repond 200 avec un plan (statut ${f.statut1})`);
  v(conflits.some((c) => c.type === 'arene' && c.message === 'Arène déjà occupée par 6 joueurs à 15:00.'),
    `[1] conflit arene : ${JSON.stringify((conflits.find((c) => c.type === 'arene') || {}).message || '')}`);
  v(conflits.some((c) => c.type === 'pistes' && c.message === 'Piste 5 prise de 16:00 à 17:00 par Dupont : le plan prend la piste 1 à la place.'),
    `[1] conflit pistes, avec la piste, l heure, l occupant et la remplacante : ${JSON.stringify((conflits.find((c) => c.type === 'pistes') || {}).message || '')}`);
  const lignes = f.plan.lignesPrix || [];
  const somme = lignes.reduce((s, l) => s + (Number(l.prix) || 0), 0);
  v(lignes.length === 2 && lignes.find((l) => l.activite === 'laser_game' && l.prix === 144) && lignes.find((l) => l.activite === 'bowling' && l.prix === 78) && somme === f.plan.prix,
    `[1] lignes de prix : ${lignes.map((l) => `${l.activite}=${l.prix}`).join(', ')} ; somme ${somme} = prix ${f.plan.prix}`);
  const blocsLaser = (f.plan.blocs || []).filter((b) => b.activite === 'laser_game');
  const blocsBowling = (f.plan.blocs || []).filter((b) => b.activite === 'bowling');
  v(blocsLaser.length === 2 && blocsLaser.every((b) => b.joueurs === 30 && b.joueursReels === 8 && b.arene === 'seuls'),
    `[1] l arene privatisee retient ses 30 places, le resume garde les 8 joueurs du groupe (${blocsLaser.map((b) => `${b.joueurs}|${b.joueursReels}|${b.arene}`).join(',')})`);
  v(blocsBowling.length > 0 && blocsBowling.every((b) => b.joueursReels === null && b.arene === ''),
    `[1] un bloc sans arene privatisee : joueursReels null, arene vide (${blocsBowling.map((b) => `${b.joueursReels}|${b.arene}`).join(',')})`);
  const c15 = parHeure(f.candidats1, '15:00')[0] || {};
  const c17 = parHeure(f.candidats1, '17:00')[0] || {};
  v(c15.statut === 'ko' && c15.raison === 'Arène déjà occupée par 6 joueurs à 15:00.' && Array.isArray(c15.conflits) && c15.conflits.some((c) => c.type === 'arene'),
    `[2] 15:00 ferme par l arene occupee (${c15.statut} : ${c15.raison})`);
  v(c17.statut === 'ok' && c17.fin === '19:00' && Array.isArray(c17.conflits) && c17.conflits.length === 0 && c17.raison === '',
    `[2] 17:00 tient, fin 19:00, aucun conflit (${JSON.stringify(c17)})`);
  v(!parHeure(f.candidats1, '17:15').length, '[2] 17:15 (hors grille, forme chaine) est ecartee comme avant');
  v(f.lectures1 === 1 && f.lectures3 === 1, `[2] une seule lecture de la journee par simulation (${f.lectures1} et ${f.lectures3})`);
  const [v5, v7, v3p, v9p, vHors, vDepart, vChaine] = f.variantes;
  v(f.statut3 === 200 && f.variantes.length === 7, `[3] sept essais, sept resultats (${f.variantes.length})`);
  v(v5 && v5.heure === '16:00' && v5.statut === 'ok' && (v5.conflits || []).some((c) => c.type === 'pistes' && /Piste 5 prise de 16:00 à 17:00 par Dupont/.test(c.message)),
    `[3] piste 5 choisie a 16:00 : l heure reste ouverte, le conflit est dit (${v5 && v5.statut}, ${JSON.stringify((v5 && v5.conflits || []).map((c) => c.message))})`);
  v(v7 && v7.statut === 'ok' && (v7.conflits || []).length === 0, `[3] pax, type et nom glisses dans la variante sont ignores (${v7 && v7.statut}, ${JSON.stringify(v7 && v7.conflits)})`);
  v(v3p && v3p.statut === 'ok' && (v3p.conflits || []).length === 0, `[3] laneCount 3 de la variante : tenu (${JSON.stringify(v3p && v3p.conflits)})`);
  v(v9p && v9p.statut === 'ok' && (v9p.conflits || []).some((c) => c.type === 'pistes' && /^9 pistes demandées, le plan en prend 8/.test(c.message)),
    `[3] laneCount 9 de la variante : borne au parc, et dit (${JSON.stringify((v9p && v9p.conflits || []).map((c) => c.message))})`);
  v(vHors && vHors.statut === 'ko' && vHors.raison === 'Heure hors grille : 16:15 (les départs se font à :00 et :30).',
    `[3] variante hors grille : ko qui dit pourquoi (${vHors && vHors.raison})`);
  v(vDepart && vDepart.statut === 'ko' && vDepart.raison === 'Heure de départ invalide pour cette variante.',
    `[3] variante au depart invalide : ko qui dit pourquoi (${vDepart && vDepart.raison})`);
  v(vChaine && vChaine.heure === '19:00' && vChaine.statut === 'ok' && Array.isArray(vChaine.conflits),
    `[3] une chaine melee aux variantes reste un decalage global (${vChaine && vChaine.heure} ${vChaine && vChaine.statut})`);
  v(f.borne === 48, `[3] 60 variantes envoyees, 48 essayees (${f.borne})`);
  const conflits4 = f.plan4.conflits || [];
  v(f.statut4 === 200 && f.autres4.length === 1 && f.autres4[0].plan && f.autres4[0].plan.disponible === true,
    `[4] l autre dossier du meme envoi est simule d abord (${JSON.stringify(f.autres4.map((a) => a.plan && a.plan.disponible))})`);
  v(f.plan4.disponible === false && conflits4.some((c) => c.type === 'plan')
    && conflits4.some((c) => c.type === 'pistes' && c.message === 'Piste 3 prise de 17:00 à 18:00 par Leroy (même envoi) : le plan ne la prend pas.'),
    `[4] le dossier suivant le voit occuper ses pistes : ${JSON.stringify(conflits4.map((c) => c.message))}`);
  const h17 = parHeure(f.candidats4, '17:00')[0] || {};
  const h18 = parHeure(f.candidats4, '18:00')[0] || {};
  v(h17.statut === 'ko' && h18.statut === 'ok', `[4] l horloge aussi : 17:00 ${h17.statut}, 18:00 ${h18.statut}`);
  v(f.lectures4 === 1, `[4] une seule lecture, autres dossiers compris (${f.lectures4})`);
  v(f.ecritures === 2, `[4] la simulation n ecrit rien (${f.ecritures} reservations en base, les 2 semees)`);
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
    console.log('\n[1-4] LA SIMULATION DE LA FENETRE, PAR LE VRAI HANDLER');
    verifier(await scenario());
    console.log('\n[5] CONTRE-PREUVES PAR MUTATION');
    await contrePreuve('le conflit de piste ne nomme plus l occupant',
      { fichier: 'lib/reserver-fenetre.js', de: '          const qui = nomDuDossier(autre);', vers: "          const qui = 'un autre dossier';" },
      /\[1\] conflit pistes/);
    await contrePreuve('chaque heure relit la journee',
      { fichier: 'api/staff-reservations.js', de: '    if (!lectures.has(cle)) lectures.set(cle, readStaffState(jour, centre, { avecBlocages: true }));', vers: '    lectures.set(cle, readStaffState(jour, centre, { avecBlocages: true }));' },
      /\[2\] une seule lecture/);
    await contrePreuve('l arene occupee ne ferme plus l heure',
      { fichier: 'lib/reserver-simulation.js', de: "  if (bloquant) return { statut: 'ko', raison: String(bloquant.message || 'Pas de plan possible à cette heure.') };", vers: '' },
      /\[2\] 15:00 ferme par l arene/);
    await contrePreuve('la variante remplace aussi le nombre de joueurs',
      { fichier: 'lib/reserver-simulation.js', de: "const CHAMPS_VARIANTE = ['startTime', 'preference', 'lanes', 'laneCount'];", vers: "const CHAMPS_VARIANTE = ['startTime', 'preference', 'lanes', 'laneCount', 'pax'];" },
      /\[3\] pax, type et nom/);
    await contrePreuve('les conflits ne voyagent plus avec les heures',
      { fichier: 'lib/reserver-simulation.js', de: "      resultats.push({ heure, ...verdict, fin: verdict.statut === 'ko' || typeof finDuPlan !== 'function' ? '' : finDuPlan(dossier.opsPlan, dossier), conflits: liste });", vers: "      resultats.push({ heure, ...verdict, fin: verdict.statut === 'ko' || typeof finDuPlan !== 'function' ? '' : finDuPlan(dossier.opsPlan, dossier), conflits: [] });" },
      /\[3\] piste 5 choisie a 16:00/);
    await contrePreuve('les autres dossiers ne sont pas poses dans la journee',
      { fichier: 'lib/reserver-fenetre.js', de: '        virtuelles.push(reservationVirtuelle(resultat.dossier, index));', vers: '' },
      /\[4\] le dossier suivant le voit/);
    await contrePreuve('les lignes de prix perdent leur montant',
      { fichier: 'lib/reserver-fenetre.js', de: '    prix: item.priceKnown === true && Number.isFinite(Number(item.price)) ? Number(item.price) : null,', vers: '    prix: null,' },
      /\[1\] lignes de prix/);
    await contrePreuve('le resume perd les joueurs du groupe',
      { fichier: 'lib/reserver-fenetre.js', de: '      joueursReels: nombreDuPlan(bloc.joueursReels),', vers: '      joueursReels: null,' },
      /\[1\] l arene privatisee retient ses 30 places/);
  } catch (error) {
    console.error('\nreserver-plan-fenetre-check ERREUR', error.stack || error.message);
    failures += 1;
  }
  B.sortir('reserver-plan-fenetre-check', failures, 'la simulation dit le plan, ses conflits et ses prix, heure par heure, sur une lecture.');
})();

// LES DEPARTS RAPIDES ET LE BOUTON « REFAIRE » DE LA FENETRE RESERVER (gate ne
// le 2026-10-08, regle S7 et son complement S8 bis).
//
// Le VRAI handler api/staff-reservations.js et la vraie lib/database.js, sur la
// base en memoire (scripts/reserver-banc.js), avec un historique seme autour
// d aujourd hui.
//   [1] GET ?departs=1&date : les 4 compositions les plus reservees du centre,
//       les 90 derniers jours, le meme jour de la semaine que la date ; le
//       nombre de joueurs ne separe pas deux compositions ; les annulees, les
//       autres jours, le trop ancien et les lignes fabriquees (simulation,
//       demonstration) ne comptent pas ; a egalite, la plus recente passe ;
//   [2] les epingles du gerant : lecture fail-soft sans la table (migration
//       0058 pas jouee), ecriture par le droit « Tarifs » (pricing.manage :
//       le Manager l a, le comptoir non), refus clairs ;
//   [3] GET ?client= rend `derniereComposition` : la DERNIERE visite passee de
//       ce client dans CE centre (ni une future, ni une annulee, ni celle d un
//       autre centre), les champs absents restent absents ; null sans visite
//       passee ;
//   [1][3] aucune des deux lectures ne fait transiter le plan entier (1 a 8 Ko
//       par ligne) : seules ses parties laser sont projetees, et un laser seul
//       les y retrouve ;
//   [4] contre-preuves par mutation.
// Lancement : node scripts/reserver-departs-check.js
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
const AUJOURDHUI = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(new Date());
function decaler(dateISO, jours) {
  const d = new Date(`${dateISO}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + jours);
  return d.toISOString().slice(0, 10);
}
const jourIso = (dateISO) => { const j = new Date(`${dateISO}T12:00:00Z`).getUTCDay(); return j === 0 ? 7 : j; };
// Les samedis passes des 90 derniers jours (B.JOUR est un samedi), du plus
// recent au plus ancien, et un samedi trop ancien.
const SAMEDIS = Array.from({ length: 91 }, (_, i) => decaler(AUJOURDHUI, -i)).filter((d) => jourIso(d) === 6);
const TROP_VIEUX = (() => { let d = decaler(AUJOURDHUI, -100); while (jourIso(d) !== 6) d = decaler(d, -1); return d; })();
const UN_VENDREDI = decaler(SAMEDIS[0], -1);

const BOWLING_1H = { type: 'bowling', duration: 1, program: null, label: 'Bowling Classique' };
const VISITE_LB = (pax) => ({ type: 'bowling', duration: 1, pax, label: 'Bowling 1h · Laser 2 parties',
  program: { items: [{ activityId: 'laser_game', games: 2, participants: pax, price: 18 * pax, priceKnown: true }, { activityId: 'bowling', duration: 1, minutes: 60, participants: pax, price: 39, priceKnown: true }], price: 0, priceComplete: true } });
const FORMULE_4 = { type: 'formule', formule_id: 'f4', duration: 1, label: 'FORMULE 4', program: null };
const LASER_3 = { type: 'laser', duration: 1.5, label: 'Laser Game', program: null, ops_plan: { laserPassPlan: { totalGames: 3 } } };
const MINIGOLF = { type: 'activite', duration: 0.5, label: 'Minigolf', program: { items: [{ activityId: 'minigolf_blacklight', participants: 4 }], price: 0, priceComplete: false } };

let id = 6000;
const ligne = (date, champs) => { id += 1; return B.ligne(id, { start_time: '15:00', date, lanes: [], pax: 4, phone: `04700000${String(id).slice(-2)}`, ...champs }); };

function historique() {
  const lignes = [];
  // A : bowling 1 h, 3 samedis (+ une annulee, un vendredi, une trop ancienne).
  [0, 1, 2].forEach((i) => lignes.push(ligne(SAMEDIS[i], BOWLING_1H)));
  lignes.push(ligne(SAMEDIS[3], { ...BOWLING_1H, status: 'cancelled' }));
  lignes.push(ligne(UN_VENDREDI, BOWLING_1H));
  // B : laser 2 parties + bowling, 4 samedis, effectifs differents.
  [6, 8, 10, 12].forEach((pax, i) => lignes.push(ligne(SAMEDIS[i], VISITE_LB(pax))));
  // C : formule 4, 2 samedis anciens ; D : laser 3 parties, 2 samedis recents
  // (a egalite avec C, D passe devant), et une 3e trop ancienne.
  [5, 6].forEach((i) => lignes.push(ligne(SAMEDIS[i], FORMULE_4)));
  [0, 1].forEach((i) => lignes.push(ligne(SAMEDIS[i], LASER_3)));
  lignes.push(ligne(TROP_VIEUX, LASER_3));
  // E : une seule visite reelle ; dix fabriquees qui ne comptent pas.
  lignes.push(ligne(SAMEDIS[2], MINIGOLF));
  [0, 1, 2, 3, 4].forEach((i) => lignes.push(ligne(SAMEDIS[i], { ...MINIGOLF, channel: 'sim-staff' })));
  [0, 1, 2, 3, 4].forEach((i) => lignes.push(ligne(SAMEDIS[i], { ...MINIGOLF, email: `demo${i}@demo.fungalaxy.test` })));
  // Le client « Refaire » : 0470 12 34 56 ; sa derniere visite passee est la
  // visite laser + bowling d il y a une semaine a 17:00 ; plus recentes mais
  // hors jeu : une annulee, une dans un autre centre, une a venir.
  const client = (date, heure, champs) => { id += 1; return B.ligne(id, { start_time: heure, date, lanes: [], pax: 6, name: 'Famille Lambert', phone: '+32 470 12 34 56', ...champs }); };
  // Ses visites passees ne tombent jamais un samedi : elles serviraient [1]
  // (un lundi, il y a 30 jours etait un samedi et le laser 3 parties
  // comptait 3 ; un samedi, il y a 7 jours aussi, et la formule 4) : le gate
  // rougissait selon le jour de la semaine (2026-10-19).
  const horsSamedi = (jours) => { let d = decaler(AUJOURDHUI, -jours); while (jourIso(d) === 6) d = decaler(d, -1); return d; };
  lignes.push(client(horsSamedi(30), '15:00', { ...LASER_3, pax: 5 }));
  lignes.push(client(horsSamedi(7), '15:00', { ...FORMULE_4, pax: 8 }));
  lignes.push(client(horsSamedi(7), '17:00', { type: 'bowling', duration: 1, label: 'Bowling 1h · Laser 2 parties',
    program: { items: [{ activityId: 'laser_game', games: 2, duration: 1, participants: 6, name: 'Laser Game', priceKnown: true, price: 108 }, { activityId: 'bowling', duration: 1, minutes: 60, participants: 6, laneCount: 1, priceKnown: true, price: 39 }], price: 147, priceComplete: true } }));
  lignes.push(client(decaler(AUJOURDHUI, -3), '15:00', { ...LASER_3, status: 'cancelled' }));
  lignes.push(client(decaler(AUJOURDHUI, -2), '15:00', { ...LASER_3, center_id: 'gembloux' }));
  lignes.push(client(decaler(AUJOURDHUI, 5), '15:00', { ...LASER_3 }));
  // Un client qui n est jamais venu : une seule reservation, a venir.
  lignes.push(B.ligne(6999, { start_time: '15:00', date: decaler(AUJOURDHUI, 4), lanes: [], pax: 3, name: 'Nouveau', phone: '0499 88 77 66', ...BOWLING_1H }));
  return lignes;
}

async function scenario(mutations = []) {
  B.semer(historique());
  const m = B.monter({ mutations });
  const f = {};
  // [1]
  const r1 = await m.appeler('GET', `${URL_RESA}?departs=1&date=${B.JOUR}`);
  f.statut1 = r1.statut;
  f.reponse1 = r1.json;
  const requete = B.extra.requetes.find((q) => q.quoi === 'departs') || {};
  f.parametres = (requete.p || []).slice(0, 4).join('|');
  f.sql = requete.sql || '';
  // Un laser seul sans programme ni duree, tel que la lecture le rend : ses
  // parties n existent plus que dans le plan projete (du texte).
  f.duPlan = require(path.join(B.ROOT, 'lib/departs-rapides.js')).compositionDeReservation({ type: 'laser', duration: null, program: null, parties_plan: '4' });
  const mauvaiseDate = await m.appeler('GET', `${URL_RESA}?departs=1&date=2026-02-31`);
  f.mauvaiseDate = `${mauvaiseDate.statut} ${mauvaiseDate.json.message}`;
  // [2] Les epingles.
  B.extra.epinglesAbsente = true;
  const sansTable = await m.appeler('GET', `${URL_RESA}?departs=1&date=${B.JOUR}`);
  f.sansTable = `${sansTable.statut} ${JSON.stringify(sansTable.json.epingles)} ${(sansTable.json.departs || []).length}`;
  const ecritureSansTable = await m.appeler('POST', `${URL_RESA}?departs=1`, { epingles: [{ libelle: 'Anniversaire laser', type: 'laser', laserGames: 3 }] });
  f.ecritureSansTable = `${ecritureSansTable.statut} ${ecritureSansTable.json.message}`;
  B.extra.epinglesAbsente = false;
  const epingles = [
    { libelle: '  Anniversaire <laser>  ', type: 'laser', laserGames: 3, pax: 10, inconnu: 'ignore' },
    { libelle: 'Team building', type: 'visite', activites: [{ activityId: 'bowling', duration: 2, participants: 9 }, { activityId: 'laser_game', games: 2 }] },
    { libelle: 'Formule 4', type: 'formule', formuleId: 'f4' },
  ];
  const ecrit = await m.appeler('POST', `${URL_RESA}?departs=1`, { epingles });
  f.ecrit = { statut: ecrit.statut, epingles: ecrit.json.epingles };
  const relu = await m.appeler('GET', `${URL_RESA}?departs=1&date=${B.JOUR}`);
  f.relu = relu.json.epingles;
  f.auditEpingles = m.journal.audits.filter((a) => a.action === 'ecrireDepartsEpingles').length;
  const invalide = await m.appeler('POST', `${URL_RESA}?departs=1`, { epingles: [{ libelle: 'Ok', type: 'bowling', duration: 1 }, { libelle: 'Mauvais', type: 'karting' }] });
  f.invalide = `${invalide.statut} ${invalide.json.message}`;
  const tropDEpingles = await m.appeler('POST', `${URL_RESA}?departs=1`, { epingles: Array.from({ length: 9 }, (_, i) => ({ libelle: `E${i}`, type: 'bowling', duration: 1 })) });
  f.tropDEpingles = `${tropDEpingles.statut} ${tropDEpingles.json.message}`;
  m.changerSession(B.sessionDuRole('staff-bar', { nom: 'Comptoir' }));
  const comptoir = await m.appeler('POST', `${URL_RESA}?departs=1`, { epingles: [] });
  const droitDemande = m.journal.permissions[m.journal.permissions.length - 1];
  const comptoirLit = await m.appeler('GET', `${URL_RESA}?departs=1&date=${B.JOUR}`);
  f.comptoir = `${comptoir.statut} ${comptoir.json.message} | lecture ${comptoirLit.statut}`;
  f.droitEcriture = droitDemande;
  m.changerSession(B.sessionDuRole('manager'));
  // [3] Refaire.
  B.extra.requetes.length = 0;
  const client = await m.appeler('GET', `${URL_RESA}?client=0470123456`);
  f.client = client.json.client || null;
  f.requeteDerniere = (B.extra.requetes.find((q) => q.quoi === 'derniere') || {}).p || [];
  f.sqlDerniere = (B.extra.requetes.find((q) => q.quoi === 'derniere') || {}).sql || '';
  const nouveau = await m.appeler('GET', `${URL_RESA}?client=0499887766`);
  f.nouveau = nouveau.json.client;
  f.lectureSeule = B.base.reservations.size;
  return f;
}

// Les colonnes d une lecture, et si le plan entier (ou toute la ligne) y passe.
const colonnesDe = (sql) => (/^select (.+?) from reservations /.exec(sql || '') || [])[1] || '';
const planEntier = (colonnes) => !colonnes || /(^|, )(ops_plan|\*)(, |$)/.test(colonnes);

function verifier(f, afficher = true) {
  const notes = [];
  const v = (cond, label) => notes.push([Boolean(cond), label]);
  const r = f.reponse1 || {};
  const departs = r.departs || [];
  v(f.statut1 === 200 && r.ok === true && r.date === B.JOUR && r.jourSemaine === 6 && r.jusqua === AUJOURDHUI && r.depuis === decaler(AUJOURDHUI, -90),
    `[1] reponse du jour : ${f.statut1}, ${r.date}, jour ${r.jourSemaine}, du ${r.depuis} au ${r.jusqua}`);
  v(f.parametres === `libramont|${decaler(AUJOURDHUI, -90)}|${AUJOURDHUI}|6`, `[1] la lecture porte le centre de la session, la fenetre de 90 jours et le samedi (${f.parametres})`);
  v(/status <> 'cancelled'/.test(f.sql) && /extract\(isodow from date\) = \$4/.test(f.sql) && /not \(not \(coalesce\(channel, ''\) not in \('sim-client', 'sim-staff'\)\) or lower\(coalesce\(email, ''\)\) like \$5\)/.test(f.sql) && /limit 5000/.test(f.sql),
    '[1] la requete ecarte les annulees, les autres jours et les lignes fabriquees, bornee a 5000 lignes');
  const resume = departs.map((d) => `${d.type}${d.formuleId ? `:${d.formuleId}` : ''}${d.laserGames ? `:${d.laserGames}p` : ''}${d.duration && !d.activites.length ? `:${d.duration}h` : ''}${d.activites.length ? `[${d.activites.map((a) => `${a.activityId}${a.games ? `x${a.games}` : ''}${a.duration ? `@${a.duration}h` : ''}`).join('+')}]` : ''}=${d.compte}`);
  v(JSON.stringify(resume) === JSON.stringify(['bowling[laser_gamex2+bowling@1h]=4', 'bowling:1h=3', 'laser:3p:1.5h=2', 'formule:f4:1h=2']),
    `[1] les 4 plus reservees, joueurs confondus, la plus recente devant a egalite : ${JSON.stringify(resume)}`);
  v(departs.length === 4 && departs[0].libelle === 'Bowling 1h · Laser 2 parties' && departs.every((d) => typeof d.cle === 'string' && d.cle && Array.isArray(d.activites)),
    `[1] chaque depart porte sa cle, son libelle et ses activites (${departs[0] && departs[0].libelle})`);
  v(departs.every((d) => !d.activites.some((a) => 'participants' in a)), '[1] une composition ne fige pas le nombre de joueurs');
  v(!planEntier(colonnesDe(f.sql)), `[1] la lecture des departs ne fait pas transiter le plan entier (${colonnesDe(f.sql)})`);
  v(JSON.stringify(f.duPlan) === JSON.stringify({ type: 'laser', laserGames: 4, program: [] }),
    `[1] un laser seul sans programme ni duree prend ses parties du plan projete (${JSON.stringify(f.duPlan)})`);
  v(f.mauvaiseDate === '422 Date invalide : AAAA-MM-JJ attendu.', `[1] une date qui n existe pas est refusee (${f.mauvaiseDate})`);
  v(f.sansTable === '200 [] 4', `[2] sans la table des epingles, la fenetre s ouvre quand meme (${f.sansTable})`);
  v(/^503 Départs épinglés non enregistrés : la base doit d'abord être mise à jour \(npm run db:migrate\)\./.test(f.ecritureSansTable), `[2] l ecriture sans table le dit (${f.ecritureSansTable})`);
  const attendu = [
    { libelle: 'Anniversaire laser', type: 'laser', laserGames: 3, pax: 10, activites: [] },
    { libelle: 'Team building', type: 'visite', activites: [{ activityId: 'bowling', duration: 2 }, { activityId: 'laser_game', games: 2 }] },
    { libelle: 'Formule 4', type: 'formule', formuleId: 'f4', activites: [] },
  ];
  v(f.ecrit.statut === 200 && JSON.stringify(f.ecrit.epingles) === JSON.stringify(attendu), `[2] le gerant epingle, nettoye et borne : ${JSON.stringify(f.ecrit.epingles)}`);
  v(JSON.stringify(f.relu) === JSON.stringify(attendu) && f.auditEpingles === 1, `[2] relues telles quelles, l ecriture tracee (${f.auditEpingles} trace)`);
  v(f.invalide === '422 Épingle n° 2 : type inconnu.', `[2] une epingle invalide est refusee avec son numero (${f.invalide})`);
  v(f.tropDEpingles === '422 8 départs épinglés au plus.', `[2] 8 au plus (${f.tropDEpingles})`);
  v(f.comptoir === '403 Permission insuffisante. | lecture 200' && f.droitEcriture === 'pricing.manage', `[2] le comptoir lit mais n epingle pas, le droit demande est « Tarifs » (${f.comptoir}, droit ${f.droitEcriture})`);
  const c = f.client || {};
  const derniere = c.derniereComposition;
  v(c.visites === 3 && c.nom === 'Famille Lambert', `[3] le client deja venu est reconnu (${c.visites} visites passees)`);
  v(JSON.stringify(derniere) === JSON.stringify({ type: 'bowling', duration: 1, pax: 6, program: [{ activityId: 'laser_game', duration: 1, games: 2, participants: 6 }, { activityId: 'bowling', duration: 1, minutes: 60, participants: 6 }] }),
    `[3] derniereComposition : la visite d il y a 7 jours a 17:00, champs absents absents : ${JSON.stringify(derniere)}`);
  v(f.requeteDerniere[0] === 'libramont' && f.requeteDerniere[1] === '470123456' && f.requeteDerniere[2] === AUJOURDHUI,
    `[3] lue dans le centre de la session, sur les 9 derniers chiffres, avant aujourd hui (${f.requeteDerniere.join('|')})`);
  v(!planEntier(colonnesDe(f.sqlDerniere)), `[3] la lecture de la derniere visite ne fait pas transiter le plan entier (${colonnesDe(f.sqlDerniere)})`);
  v(f.nouveau && f.nouveau.visites === 0 && f.nouveau.derniereComposition === null, `[3] sans visite passee : null (${JSON.stringify(f.nouveau && f.nouveau.derniereComposition)})`);
  v(f.lectureSeule === historique().length, `[3] lecture seule : la base n a pas bouge (${f.lectureSeule} lignes)`);
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
    console.log('\n[1-3] LES DEPARTS RAPIDES ET « REFAIRE »');
    verifier(await scenario());
    console.log('\n[4] CONTRE-PREUVES PAR MUTATION');
    await contrePreuve('le nombre de joueurs separe les compositions',
      { fichier: 'lib/departs-rapides.js', de: '    .map((ligne) => [ligne.activityId, ...QUANTITES.filter((champ) => ligne[champ] != null)', vers: '    .map((ligne) => [ligne.activityId, ...CHAMPS_REFAIRE.filter((champ) => ligne[champ] != null)' },
      /\[1\] les 4 plus reservees/);
    await contrePreuve('la fenetre remonte a 400 jours',
      { fichier: 'lib/database.js', de: 'const DEPARTS_FENETRE_JOURS = 90;', vers: 'const DEPARTS_FENETRE_JOURS = 400;' },
      /\[1\] (les 4 plus reservees|reponse du jour|la lecture porte)/);
    await contrePreuve('la requete ne filtre plus le jour de la semaine',
      { fichier: 'lib/database.js', de: '        and extract(isodow from date) = $4\n', vers: '        and $4::int > 0\n' },
      /\[1\] la requete ecarte/);
    await contrePreuve('le comptoir peut epingler',
      { fichier: 'api/staff-reservations.js', de: "        const sessionEpingles = await requireStaffPermission(req, res, 'pricing.manage', { centerId: body.centerId || body.center_id });", vers: "        const sessionEpingles = await requireStaffPermission(req, res, 'reservations.create', { centerId: body.centerId || body.center_id });" },
      /\[2\] le comptoir lit mais n epingle pas/);
    await contrePreuve('la lecture des epingles n est plus fail-soft',
      { fichier: 'lib/database.js', de: "    if (error && error.code === '42P01') return { epingles: [], par: '', le: '' };\n", vers: '' },
      /\[2\] sans la table des epingles/);
    await contrePreuve('Refaire perd les joueurs de chaque ligne',
      { fichier: 'lib/departs-rapides.js', de: '  composition.program = items.map((item) => ligneReduite(item, CHAMPS_REFAIRE)).filter(Boolean);', vers: '  composition.program = items.map((item) => ligneReduite(item, QUANTITES)).filter(Boolean);' },
      /\[3\] derniereComposition/);
    await contrePreuve('Refaire n est plus lu',
      { fichier: 'lib/database.js', de: "    derniereComposition = require('./departs-rapides').compositionDeReservation(derniere.rows[0] || null);", vers: '    derniereComposition = null;' },
      /\[3\] derniereComposition/);
    await contrePreuve('la lecture des departs remet le plan entier',
      { fichier: 'lib/database.js', de: "ops_plan->'laserPassPlan'->>'totalGames' as parties_plan, label\n", vers: 'ops_plan, label\n' },
      /\[1\] la lecture des departs ne fait pas transiter le plan entier/);
    await contrePreuve('la derniere visite remet le plan entier',
      { fichier: 'lib/database.js', de: "ops_plan->'laserPassPlan'->>'totalGames' as parties_plan\n", vers: 'ops_plan\n' },
      /\[3\] la lecture de la derniere visite ne fait pas transiter le plan entier/);
    await contrePreuve('les parties du plan ne sont plus lues',
      { fichier: 'lib/departs-rapides.js', de: '  const duPlan = nombre(ligne.parties_plan);', vers: '  const duPlan = null;' },
      /\[1\] un laser seul sans programme ni duree/);
  } catch (error) {
    console.error('\nreserver-departs-check ERREUR', error.stack || error.message);
    failures += 1;
  }
  B.sortir('reserver-departs-check', failures, 'les departs du jour, les epingles du gerant et « Refaire » lisent ce qu il faut, et rien d autre.');
})();

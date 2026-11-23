'use strict';
// LES GRANDS GROUPES, DE BOUT EN BOUT : LE SERVEUR (2026-11-23, lib/grand-groupe.js).
//
// Ansar, devant Réserver avec 80 joueurs divisés en 2 groupes : « pour quand ça divise en groupe, faut
// qu'on puisse tout modifier et choisir [...] faut qu'on puisse choisir l'heure de passage, choisir de
// diviser en plus de 2 groupes, genre 3, 4, etc., pouvoir mettre facilement quel groupe va où, et quand,
// à combien, etc. Vraiment un truc complet. »
//
// Ce gate joue le VRAI handler api/staff-reservations.js et le vrai moteur sur la base en memoire
// (scripts/reserver-banc.js), sans navigateur. Il verifie le plan que la fenetre recoit (dryRun) ET le
// dossier ecrit en base : ce qui s affiche est ce qui s ecrit.
//   [A] LE NOMBRE DE GROUPES : 80 joueurs au bowling et au laser se partagent d office en 3 groupes (30
//       armes) ; 4 choisis font 4 groupes de 20, au prix que le serveur ecrit ensuite ; 2 choisis se
//       refusent sur la case du groupe 1 (« 40 joueurs au laser, 30 armes à la fois »).
//   [B] LES HEURES DE CHAQUE GROUPE, A LA MINUTE : posees au comptoir, chaque groupe joue a son heure (le
//       bowling du groupe 3 a 16:10), ses deux parties de laser de demi-heure en demi-heure depuis sa minute
//       (15:10 puis 15:40) ; le plan les rend telles quelles et le dossier les ecrit.
//   [C] CE QUI COINCE SE DIT SUR LA CASE : deux groupes au bowling a la meme heure sans assez de pistes,
//       deux groupes au laser au-dela des armes, l arene prise par un autre groupe du dossier, un groupe a
//       deux endroits, une heure qui manque, un autre dossier qui tient l arene, une heure avant l ouverture
//       ou qui finit apres la fermeture (avec l heure qui coince). Chaque refus porte son groupe et son
//       activite (`coincent`). Deux petits groupes qui tiennent ensemble au laser passent.
//   [D] LA MODIFICATION GARDE CE QUE LE COMPTOIR A POSE : un joueur de plus garde les heures (27, 27, 27),
//       le dossier decale d une demi-heure decale chaque groupe, de nouvelles heures s ecrivent au prix du
//       calcul a blanc, des heures qui coincent se refusent (a blanc avec `coincent`, et rien ne s ecrit) ;
//       4 groupes choisis le restent quand le groupe change ; un groupe pose avant l arrivee fait commencer
//       le dossier avec lui (Modifier et creation), au meme prix ; d autres pistes envoyees par Modifier ne
//       remplacent jamais celles que le plan donne a chaque groupe.
//   [E] LES DOSSIERS EN DEUX GROUPES D AVANT RESTENT JUSTES : un dossier ecrit avant ce lot (sans heures
//       ni nombre dans son plan) garde ses deux groupes et sa rotation quand le groupe change, et un laser
//       qu il avait deplace au planning reste a son heure.
//   [F] LE GLISSER DU PLANNING : un groupe deplace au planning garde son heure a la modification suivante.
//   [G] LE CANAL PUBLIC ne lit ni le nombre ni les heures : le formulaire en ligne garde son plan.
//
// CONTRE-PREUVES : `--contre-preuves` rejoue le gate sur du code casse expres, une mutation a la fois, en
// memoire (le crochet de compilation du banc : le disque n est jamais touche), et exige que chacune
// rougisse sa lettre. `--seul=B` ne joue qu une lettre.
// Lancement : node scripts/groupes-check.js [--contre-preuves] [--seul=A]
// Zero reseau sortant, zero vraie base : rien ne part.

const path = require('path');
const { spawn } = require('child_process');

delete process.env.RESEND_API_KEY;
delete process.env.POSTGRES_URL;
process.env.DATABASE_URL = 'postgres://gate:gate@127.0.0.1:1/gate';
process.env.PINLANE_CALENDAR_SYNC = 'off';
const fetchOrigine = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url && url.url ? url.url : url);
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(u)) throw new Error(`gate : appel sortant refuse vers ${u.slice(0, 80)}`);
  return fetchOrigine(url, init);
};

const ROOT = path.resolve(__dirname, '..');
const argument = (nom) => { const a = process.argv.find((x) => x === `--${nom}` || x.startsWith(`--${nom}=`)); return a ? (a.includes('=') ? a.split('=')[1] : true) : null; };
const SEUL = typeof argument('seul') === 'string' ? argument('seul') : '';
const joue = (lettre) => !SEUL || SEUL === lettre;

const MOTEUR = 'lib/ops-engine.js';
const GG = 'lib/grand-groupe.js';
const OPS = 'lib/reservation-ops.js';
const API = 'api/staff-reservations.js';
const MOUVEMENT = 'lib/reservation-activity-move.js';

// LES MUTATIONS : une regle retiree a la fois, `lettre` le scenario qui doit rougir.
const MUTATIONS = [
  // [A] le nombre choisi ne compte plus : le moteur garde le plus petit que la place du centre demande.
  { nom: 'nombre-ignore', lettre: 'A', fichier: GG, de: '  const choisi = entier(voulu) >= 2 ? (souple ? Math.max(entier(voulu), coupe) : entier(voulu)) : coupe;', vers: '  const choisi = coupe;' },
  // [B] les heures du comptoir ne se posent plus, ou les parties retombent sur la grille du centre.
  { nom: 'heures-ignorees', lettre: 'B', fichier: MOTEUR, de: '  const auxHeures = Boolean(heuresVoulues) && heuresVoulues.length === decoupe.nombre;', vers: '  const auxHeures = false;' },
  { nom: 'parties-sur-la-grille', lettre: 'B', fichier: GG, de: '      const origine = ((t % grille) + grille) % grille;', vers: '      const origine = 0;' },
  // [C] les autres groupes du dossier ne comptent plus dans l arene ; les conflits perdent leur groupe ; un
  // groupe a deux endroits ne dit plus lequel ; ce qui coince ne remonte plus a la fenetre.
  { nom: 'freres-ignores', lettre: 'C', fichier: MOTEUR, de: '      const freres = Number(block.sousGroupe) > 0\n        ? scenario.resourceBlocks.filter(', vers: '      const freres = false\n        ? scenario.resourceBlocks.filter(' },
  { nom: 'conflits-sans-groupe', lettre: 'C', fichier: MOTEUR, de: '    if (Number(block.sousGroupe) > 0) {\n      for (let rang = conflitsAvant;', vers: '    if (false) {\n      for (let rang = conflitsAvant;' },
  { nom: 'chevauchement-sans-case', lettre: 'C', fichier: MOTEUR, de: '        ...(sousGroupe ? { conflict: { sousGroupe, activityId: current.activityId, avec: previous.activityId } } : {}),\n', vers: '' },
  { nom: 'coincent-perdus', lettre: 'C', fichier: OPS, de: '    ...(noSafePlan && coincent.length ? { groupesQuiCoincent: coincent } : {}),\n', vers: '' },
  // [C] un groupe hors des horaires du centre ne se dit plus sur sa case, ou plus avec son heure.
  { nom: 'horaires-sans-case', lettre: 'C', fichier: MOTEUR, de: '        ...(horsHoraires ? { conflict: horsHoraires.conflict } : {}),\n', vers: '' },
  { nom: 'horaires-phrase-du-dossier', lettre: 'C', fichier: MOTEUR, de: '    const reason = horsHoraires ? horsHoraires.raison : !manqueLeLibre', vers: '    const reason = !manqueLeLibre' },
  // [D] les pistes du corps redeviennent celles du dossier en sous-groupes (Modifier se fait refuser).
  { nom: 'pistes-du-corps-pour-les-groupes', lettre: 'D', fichier: API, de: '  if (shouldReplan && (pistesDuGrandGroupe || JSON.stringify(', vers: '  if (shouldReplan && (false || JSON.stringify(' },
  // [D] un groupe pose avant l arrivee laisse le dossier commencer apres lui.
  { nom: 'arrivee-apres-un-groupe', lettre: 'D', fichier: OPS, de: '    ...(avanceeParUnGroupe ? { startTime: minutesToTime(premierGroupe) } : {}),\n', vers: '' },
  // [D] la modification refait la rotation par-dessus les heures posees, oublie le nombre choisi, ou ecrit
  // des groupes qui ne tiennent pas.
  { nom: 'modif-sans-heures', lettre: 'D', fichier: OPS, de: "  const heures = garde.auxHeures === true || request.opsPlan.laserManual === true ? require('./grand-groupe').heuresDesBlocs(request.opsPlan, ecart) : null;", vers: "  const heures = request.opsPlan.laserManual === true ? require('./grand-groupe').heuresDesBlocs(request.opsPlan, ecart) : null;" },
  { nom: 'modif-sans-nombre', lettre: 'D', fichier: OPS, de: '      ...(garde.nombreChoisi === true && Number(garde.nombre) >= 2 ? { nombre: Number(garde.nombre) } : {}),\n', vers: '' },
  { nom: 'modif-ecrit-quand-meme', lettre: 'D', fichier: API, de: "    throw Object.assign(createHttpError(`Ces groupes ne tiennent pas au planning : ${motif}`, 422), { coincent: Array.isArray(ops.groupesQuiCoincent) ? ops.groupesQuiCoincent : [] });\n", vers: '' },
  // [E] un laser deplace au planning avant ce lot retombe sur la rotation ; les pistes de tout le dossier
  // redeviennent le souhait de chaque groupe (un groupe serre sur 3 pistes quand le groupe grandit).
  { nom: 'ancien-laser-deplace-perdu', lettre: 'E', fichier: OPS, de: "  const heures = garde.auxHeures === true || request.opsPlan.laserManual === true ? require('./grand-groupe').heuresDesBlocs(request.opsPlan, ecart) : null;", vers: "  const heures = garde.auxHeures === true ? require('./grand-groupe').heuresDesBlocs(request.opsPlan, ecart) : null;" },
  { nom: 'pistes-de-tout-le-dossier', lettre: 'E', fichier: MOTEUR, de: '    ...(preferredLanes.length && (nombre <= 1 || aLaMain || preferredLanes.length === pose.pistes) ? { preferredLanes: [...preferredLanes] } : {}),', vers: '    ...(preferredLanes.length ? { preferredLanes: [...preferredLanes] } : {}),' },
  // [H] la base ne voit plus les autres groupes du dossier sur les pistes : elle refuse ce que le moteur a juge.
  { nom: 'base-sans-les-freres', lettre: 'H', fichier: 'lib/database.js', de: '      const freres = Number(block.sousGroupe) > 0\n        ? serviceBlocks.filter(', vers: '      const freres = false\n        ? serviceBlocks.filter(' },
  // [F] le glisser du planning ne marque plus les heures du groupe.
  { nom: 'glisser-sans-marque', lettre: 'F', fichier: MOUVEMENT, de: '    if (heures) plan.grandGroupe = { ...old.grandGroupe, heures, auxHeures: true };\n', vers: '' },
  // [G] le canal public lit la demande.
  { nom: 'public-lit-les-groupes', lettre: 'G', fichier: MOTEUR, de: "  const demandeGrandGroupe = input.channel === 'staff' ? lireGrandGroupe(preference.grandGroupe) : null;", vers: '  const demandeGrandGroupe = lireGrandGroupe(preference.grandGroupe);' },
];

function lancer(args) {
  return new Promise((ok) => {
    const fil = spawn(process.execPath, [__filename, ...args], { cwd: ROOT, env: { ...process.env } });
    let sortie = '';
    fil.stdout.on('data', (d) => { sortie += d; });
    fil.stderr.on('data', (d) => { sortie += d; });
    const garde = setTimeout(() => fil.kill(), 300000);
    fil.on('close', (code) => { clearTimeout(garde); ok({ code, sortie }); });
  });
}

if (argument('contre-preuves')) {
  (async () => {
    const temoin = await lancer([]);
    if (temoin.code !== 0) {
      console.log(temoin.sortie.split('\n').filter((l) => /ROUGE|Error|erreur/.test(l)).slice(0, 12).join('\n'));
      console.log('\ngroupes-check --contre-preuves: le gate est rouge sans mutation, aucune contre-preuve ne compte');
      process.exit(1);
    }
    let rates = 0;
    const POOL = 3;
    let suivant = 0;
    const travailleur = async () => {
      while (suivant < MUTATIONS.length) {
        const m = MUTATIONS[suivant];
        suivant += 1;
        // eslint-disable-next-line no-await-in-loop
        const r = await lancer([`--mutation=${m.nom}`, `--seul=${m.lettre}`]);
        const mord = r.code === 1 && r.sortie.includes(`ROUGE [${m.lettre}]`) && !/ancre absente|ANCRE/.test(r.sortie);
        if (!mord) rates += 1;
        console.log(`${mord ? 'TUEE   ' : 'VIVANTE'} ${m.nom} (attendu : ROUGE [${m.lettre}], sortie ${r.code})${mord ? '' : `\n${r.sortie.split('\n').filter((l) => /ROUGE|ANCRE|ancre|Error/.test(l)).slice(0, 6).join('\n')}`}`);
      }
    };
    await Promise.all(Array.from({ length: POOL }, () => travailleur()));
    console.log(rates
      ? `\ngroupes-check --contre-preuves: ${rates} mutation(s) vivante(s)`
      : `\ngroupes-check --contre-preuves: ALL OK - ${MUTATIONS.length} mutations, chaque regle retiree fait rougir sa lettre`);
    process.exit(rates ? 1 : 0);
  })();
} else {
  principal().catch((error) => { console.error(error); process.exit(1); });
}

async function principal() {
  const nomMutation = typeof argument('mutation') === 'string' ? argument('mutation') : '';
  const mutation = nomMutation ? MUTATIONS.find((m) => m.nom === nomMutation) : null;
  if (nomMutation && !mutation) { console.error(`mutation inconnue : ${nomMutation}`); process.exit(2); }
  const B = require('./reserver-banc.js');
  const FX = require('./planning-v3-fixtures.js');
  const HORLOGE = { fichier: 'lib/booking-config.js', de: 'function getBusinessNowParts(date = new Date()) {', vers: 'function getBusinessNowParts(date = new Date(globalThis.__comptoirMaintenant || Date.now())) {' };
  let serveur;
  try {
    serveur = B.monter({
      mutations: [HORLOGE, ...(mutation ? [{ fichier: mutation.fichier, de: mutation.de, vers: mutation.vers }] : [])],
      session: B.sessionDuRole('direction', { nom: 'Accueil' }),
    });
  } catch (error) {
    console.log(`ANCRE DE MUTATION : ${error.message}`);
    process.exit(2);
  }

  let rouges = 0;
  let lettre = '';
  const section = (titre) => { lettre = (titre.match(/^\[([A-Z])\]/) || [])[1] || ''; console.log(`\n${titre}`); };
  const ok = (condition, quoi, detail) => {
    if (condition) { console.log(`ok    ${quoi}`); return; }
    rouges += 1;
    console.log(`ROUGE [${lettre}] ${quoi}${detail !== undefined ? ` : ${String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 700)}` : ''}`);
  };

  // La journee vide de la fixture, le matin : les heures du gate sont devant.
  const fx = FX.lireFixture('vide');
  const jour = fx.staffState.date;
  const vider = () => { globalThis.__comptoirMaintenant = FX.instant(jour, '10:00').getTime(); B.semer([]); };
  vider();
  // (ce que la fenetre Reserver envoie pour un grand groupe au bowling et au laser : le programme, et la
  // demande des groupes ; `parties` : les parties de laser de chaque groupe)
  const corps = (pax, gg, { parties = 1, debut = '14:00', centre = 'libramont' } = {}) => ({
    name: 'Groupe Essai', phone: '0470111222', email: '', notes: '', occasion: '', date: jour, startTime: debut, duration: 1, totalDuration: 2, lanes: [], pax, status: 'pending', type: 'visite', formuleId: '',
    program: [{ activityId: 'bowling', pax, participants: pax, duration: 1 }, { activityId: 'laser_game', pax, participants: pax, games: parties }],
    laserGames: 0, extras: [], channel: 'staff', requiresLanes: true, centerId: centre,
    preference: { activityOrder: ['bowling', 'laser_game'], preferredTimes: { bowling: debut, laser_game: debut }, grandGroupe: gg },
  });
  const simuler = async (c) => (await serveur.appeler('POST', '/api/staff-reservations', { ...c, dryRun: true })).json.plan || {};
  const creer = async (c) => serveur.appeler('POST', '/api/staff-reservations', c);
  const ligne = (id) => B.base.reservations.get(Number(id)) || B.base.reservations.get(id);
  const version = (r) => (r && r.updated_at && r.updated_at.toISOString ? r.updated_at.toISOString() : r && r.updated_at);
  const enMin = (h) => { const [a, b] = String(h).split(':').map(Number); return a * 60 + b; };
  // Le plan de la fenetre, en une ligne : « B1@14:00 L1@15:00 ... », trie.
  const horaire = (plan) => (plan.blocs || []).filter((b) => b.sousGroupe).map((b) => `${b.activite === 'bowling' ? 'B' : 'L'}${b.sousGroupe}@${b.debut}`).sort().join(' ');
  // Le dossier en base, de meme.
  const blocsDe = (r) => ((r && (r.ops_plan || r.opsPlan) && (r.ops_plan || r.opsPlan).resourceBlocks) || []).filter((b) => ['bowling_lane', 'laser_arena'].includes(b.resourceType));
  const horaireDe = (r) => blocsDe(r).map((b) => `${b.resourceType === 'bowling_lane' ? 'B' : 'L'}${b.sousGroupe || 0}@${String(b.startTime).slice(0, 5)}`).sort().join(' ');
  const joueursDe = (r) => blocsDe(r).filter((b) => b.resourceType === 'bowling_lane').sort((a, b) => a.sousGroupe - b.sousGroupe).map((b) => b.players).join('/');
  // Un groupe n est jamais a deux endroits.
  const unSeulEndroit = (blocs) => {
    const parGroupe = new Map();
    blocs.forEach((b) => { const n = Number(b.sousGroupe) || 0; if (!parGroupe.has(n)) parGroupe.set(n, []); parGroupe.get(n).push(b); });
    return [...parGroupe.values()].every((liste) => liste.map((b) => [enMin(b.debut || b.startTime), enMin(b.fin || b.endTime)]).sort((x, y) => x[0] - y[0]).every((p, i, t) => i === 0 || p[0] >= t[i - 1][1]));
  };
  const coince = (plan, groupe, activite, motif) => (plan.coincent || []).some((x) => x.groupe === groupe && x.activite === activite && motif.test(x.raison));

  try {
    // =======================================================================
    if (joue('A')) {
      section('[A] LE NOMBRE DE GROUPES : PROPOSE D OFFICE, CHOISI, REFUSE SUR SA CASE');
      vider();
      const auto = await simuler(corps(80, { impose: true }));
      const gg = auto.grandGroupe || {};
      ok(auto.disponible === true && gg.nombre === 3 && JSON.stringify(gg.tailles) === '[27,27,26]' && unSeulEndroit(auto.blocs || []),
        '[A] 80 au bowling et au laser, 30 armes : 3 groupes de 27, 27 et 26 proposes d office, chacun a un seul endroit', { dispo: auto.disponible, gg, refus: auto.refus });
      ok(Array.isArray(gg.heures) && gg.heures.length === 3 && gg.heures.every((h) => h.bowling && h.laser_game),
        '[A] le plan dit l heure de chaque groupe a chaque activite (ce que la page des groupes montre)', gg.heures);
      const quatre = await simuler(corps(80, { impose: true, nombre: 4 }));
      const gq = quatre.grandGroupe || {};
      ok(quatre.disponible === true && gq.nombre === 4 && JSON.stringify(gq.tailles) === '[20,20,20,20]' && gq.nombreChoisi === true && (quatre.blocs || []).filter((b) => b.sousGroupe).length === 8 && unSeulEndroit(quatre.blocs || []),
        '[A] 4 groupes choisis : 4 groupes de 20, chacun au bowling et au laser, a un seul endroit', { dispo: quatre.disponible, gq, refus: quatre.refus, horaire: horaire(quatre) });
      const deux = await simuler(corps(80, { impose: true, nombre: 2 }));
      ok(deux.disponible === false && /Groupe 1 : 40 joueurs au laser, 30 armes à la fois/.test(deux.refus || '') && coince(deux, 1, 'laser_game', /30 armes/),
        '[A] 2 groupes choisis : refuse, et le refus se dit sur la case laser du groupe 1', { refus: deux.refus, coincent: deux.coincent });
      const cree = await creer(corps(80, { impose: true, nombre: 4 }));
      const r = cree.json.reservation && ligne(cree.json.reservation.id);
      ok(cree.statut < 300 && Boolean(r) && Number(r.price) === Number(quatre.prix) && horaireDe(r) === horaire(quatre) && r.ops_plan.grandGroupe.nombre === 4,
        '[A] le dossier nait en 4 groupes, aux heures et au prix que le calcul a blanc montrait', r ? { prix: r.price, attendu: quatre.prix, horaire: horaireDe(r) } : `${cree.statut} ${cree.json.message || ''}`);
    }

    // =======================================================================
    if (joue('B')) {
      section('[B] LES HEURES DE CHAQUE GROUPE, POSEES AU COMPTOIR, A LA MINUTE');
      vider();
      const heures = [{ bowling: '14:00', laser_game: '15:00' }, { laser_game: '14:00', bowling: '15:00' }, { laser_game: '15:30', bowling: '16:10' }];
      const plan = await simuler(corps(80, { impose: true, nombre: 3, tailles: [27, 27, 26], heures }));
      const gg = plan.grandGroupe || {};
      ok(plan.disponible === true && horaire(plan) === 'B1@14:00 B2@15:00 B3@16:10 L1@15:00 L2@14:00 L3@15:30' && gg.auxHeures === true,
        '[B] chaque groupe joue a l heure posee : groupe 3 laser 15:30 puis bowling 16:10, a la minute', { horaire: horaire(plan), refus: plan.refus, gg });
      ok(JSON.stringify(gg.heures) === JSON.stringify([{ bowling: '14:00', laser_game: '15:00' }, { bowling: '15:00', laser_game: '14:00' }, { bowling: '16:10', laser_game: '15:30' }]) && plan.fin === '17:10',
        '[B] le plan rend ces heures, groupe par groupe, et la fin de la visite est celle du dernier groupe (17:10)', { heures: gg.heures, fin: plan.fin });
      const parties = await simuler(corps(80, { impose: true, nombre: 3, heures: [{ bowling: '14:00', laser_game: '15:10' }, { laser_game: '14:00', bowling: '15:00' }, { bowling: '16:00', laser_game: '17:00' }] }, { parties: 2 }));
      const lasers1 = (parties.blocs || []).filter((b) => b.activite === 'laser_game' && b.sousGroupe === 1).map((b) => b.debut).sort().join(' ');
      ok(parties.disponible === true && lasers1 === '15:10 15:40',
        '[B] deux parties de laser : le groupe 1 joue a 15:10 puis 15:40, de demi-heure en demi-heure depuis sa minute', { lasers1, refus: parties.refus });
      const cree = await creer(corps(80, { impose: true, nombre: 3, tailles: [27, 27, 26], heures }));
      const r = cree.json.reservation && ligne(cree.json.reservation.id);
      ok(cree.statut < 300 && Boolean(r) && horaireDe(r) === 'B1@14:00 B2@15:00 B3@16:10 L1@15:00 L2@14:00 L3@15:30' && joueursDe(r) === '27/27/26' && Number(r.price) === Number(plan.prix),
        '[B] le dossier ecrit les heures du comptoir, les joueurs de chaque groupe et le prix du calcul a blanc', r ? { horaire: horaireDe(r), joueurs: joueursDe(r), prix: r.price, attendu: plan.prix } : `${cree.statut} ${cree.json.message || ''}`);
    }

    // =======================================================================
    if (joue('C')) {
      section('[C] CE QUI COINCE SE DIT SUR LA CASE DU GROUPE');
      vider();
      const essai = (heures, nombre = 3, extra = {}) => simuler(corps(80, { impose: true, nombre, heures, ...extra }));
      const pistes = await essai([{ bowling: '14:00', laser_game: '15:00' }, { laser_game: '14:00', bowling: '15:00' }, { laser_game: '16:00', bowling: '15:00' }]);
      ok(pistes.disponible === false && coince(pistes, 3, 'bowling', /Pas assez de pistes libres à 15:00.*Le groupe 2 joue déjà à cette heure/),
        '[C] deux groupes au bowling a 15:00, 5 pistes chacun sur 8 : la case bowling du groupe 3 dit que le groupe 2 y joue deja', pistes.coincent || pistes.refus);
      const armes = await essai([{ bowling: '14:00', laser_game: '15:00' }, { laser_game: '14:00', bowling: '15:00' }, { laser_game: '15:00', bowling: '16:00' }]);
      ok(armes.disponible === false && coince(armes, 3, 'laser_game', /Laser à 15:00 : il reste 3 places sur 30 \(le groupe 1 y joue\), il en faut 26/),
        '[C] deux groupes au laser a 15:00, 27 et 26 sur 30 armes : la case laser du groupe 3 le dit', armes.coincent || armes.refus);
      // (six groupes de 14 et 13 : leurs armes tiennent ensemble, leurs parties ne partent pas ensemble)
      const arene = await essai([
        { bowling: '14:00', laser_game: '15:00' }, { bowling: '14:00', laser_game: '16:30' },
        { laser_game: '14:00', bowling: '15:00' }, { laser_game: '14:30', bowling: '15:00' },
        { laser_game: '15:10', bowling: '16:00' }, { laser_game: '17:00', bowling: '16:00' },
      ], 6);
      ok(arene.disponible === false && coince(arene, 5, 'laser_game', /Arène laser déjà prise à 15:10 par le groupe 1/),
        '[C] le laser du groupe 5 a 15:10, pendant la partie du groupe 1 : « Arène laser déjà prise à 15:10 par le groupe 1 »', arene.coincent || arene.refus);
      const deuxEndroits = await essai([{ bowling: '14:00', laser_game: '14:30' }, { laser_game: '14:00', bowling: '15:00' }, { laser_game: '16:00', bowling: '16:30' }]);
      ok(deuxEndroits.disponible === false && coince(deuxEndroits, 1, 'laser_game', /Groupe 1 : Bowling \(14:00-15:00\) et Laser Game \(14:30\) se chevauchent/) && coince(deuxEndroits, 1, 'bowling', /se chevauchent/),
        '[C] le groupe 1 au laser a 14:30 pendant son bowling : ses deux cases le disent', deuxEndroits.coincent || deuxEndroits.refus);
      const manque = await essai([{ bowling: '14:00', laser_game: '15:00' }, { bowling: '15:00' }, { laser_game: '16:00', bowling: '16:00' }]);
      ok(manque.disponible === false && coince(manque, 2, 'laser_game', /Groupe 2 : donnez l’heure du laser/),
        '[C] le groupe 2 sans heure de laser : sa case le demande', manque.coincent || manque.refus);
      // Une heure hors des horaires du centre (la journee de la fixture : 10:00 a 22:00) : la case du groupe le dit.
      const tot = await essai([{ bowling: '14:00', laser_game: '15:00' }, { laser_game: '08:00', bowling: '15:00' }, { laser_game: '16:00', bowling: '16:30' }]);
      ok(tot.disponible === false && coince(tot, 2, 'laser_game', /^Groupe 2 : le laser à 08:00 commence avant l’ouverture \(10:00\)\.$/) && (tot.coincent || []).length === 1,
        '[C] le laser du groupe 2 a 08:00 : sa case dit qu il commence avant l ouverture (10:00)', tot.coincent || tot.refus);
      const tard = await essai([{ bowling: '14:00', laser_game: '15:00' }, { laser_game: '14:00', bowling: '15:00' }, { bowling: '16:00', laser_game: '21:40' }]);
      ok(tard.disponible === false && coince(tard, 3, 'laser_game', /^Groupe 3 : le laser finit à 22:05, après la fermeture \(22:00\)\.$/),
        '[C] le laser du groupe 3 a 21:40 : sa case dit qu il finit a 22:05, apres la fermeture', tard.coincent || tard.refus);
      const ensemble = await simuler(corps(80, { impose: true, nombre: 6, heures: [
        { bowling: '14:00', laser_game: '15:00' }, { bowling: '14:00', laser_game: '15:00' },
        { laser_game: '14:00', bowling: '15:00' }, { laser_game: '14:30', bowling: '15:00' },
        { laser_game: '16:00', bowling: '16:30' }, { laser_game: '16:30', bowling: '17:00' },
      ] }));
      ok(ensemble.disponible === true && (ensemble.blocs || []).filter((b) => b.activite === 'laser_game' && b.debut === '15:00').length === 2,
        '[C] deux groupes de 14 et 13 au laser a 15:00 tiennent sur 30 armes : ils jouent la meme partie', { refus: ensemble.refus, coincent: ensemble.coincent, horaire: horaire(ensemble) });
      // Un autre dossier tient deja 10 armes a 15:00 : la case du groupe qui y va le dit.
      const autre = await creer({
        name: 'Laser Voisin', phone: '0470999888', email: '', notes: '', occasion: '', date: jour, startTime: '15:00', duration: 1, totalDuration: 1, lanes: [], pax: 10, status: 'pending', type: 'visite', formuleId: '',
        program: [{ activityId: 'laser_game', pax: 10, participants: 10, games: 1 }], laserGames: 0, extras: [], channel: 'staff', requiresLanes: false, centerId: 'libramont',
        preference: { activityOrder: ['laser_game'], preferredTimes: { laser_game: '15:00' }, laserGameTimes: ['15:00'], laserPlacement: 'scheduled' },
      });
      const voisin = await essai([{ bowling: '14:00', laser_game: '15:00' }, { laser_game: '14:00', bowling: '15:00' }, { laser_game: '15:30', bowling: '16:00' }]);
      ok(autre.statut < 300 && voisin.disponible === false && coince(voisin, 1, 'laser_game', /Laser à 15:00 : il reste 20 places sur 30, il en faut 27/),
        '[C] un autre dossier tient 10 armes a 15:00 : la case laser du groupe 1 dit qu il reste 20 places sur 30', { statut: autre.statut, coincent: voisin.coincent, refus: voisin.refus });
    }

    // =======================================================================
    if (joue('D')) {
      section('[D] LA MODIFICATION GARDE CE QUE LE COMPTOIR A POSE');
      vider();
      const heures = [{ bowling: '14:00', laser_game: '15:00' }, { laser_game: '14:00', bowling: '15:00' }, { laser_game: '15:30', bowling: '16:10' }];
      const cree = await creer(corps(80, { impose: true, nombre: 3, tailles: [27, 27, 26], heures }));
      const d = cree.json.reservation;
      ok(cree.statut < 300 && Boolean(d), '[D] le dossier aux heures du comptoir est cree', `${cree.statut} ${cree.json.message || ''}`);
      if (d) {
        const programme = (n) => [{ activityId: 'bowling', pax: n, participants: n, duration: 1 }, { activityId: 'laser_game', pax: n, participants: n, games: 1 }];
        const plus = await serveur.appeler('PATCH', '/api/staff-reservations', { id: d.id, centerId: 'libramont', pax: 81, program: programme(81), baseUpdatedAt: d.updatedAt });
        ok(plus.statut === 200 && horaireDe(ligne(d.id)) === 'B1@14:00 B2@15:00 B3@16:10 L1@15:00 L2@14:00 L3@15:30' && joueursDe(ligne(d.id)) === '27/27/27',
          '[D] un joueur de plus : les heures du comptoir restent, les groupes font 27, 27 et 27', `${plus.statut} ${plus.json.message || ''} ${horaireDe(ligne(d.id))} ${joueursDe(ligne(d.id))}`);
        const decale = await serveur.appeler('PATCH', '/api/staff-reservations', { id: d.id, centerId: 'libramont', startTime: '14:30', baseUpdatedAt: version(ligne(d.id)) });
        ok(decale.statut === 200 && horaireDe(ligne(d.id)) === 'B1@14:30 B2@15:30 B3@16:40 L1@15:30 L2@14:30 L3@16:00',
          '[D] le dossier decale a 14:30 : chaque groupe decale d une demi-heure, le groupe 3 a 16:40', `${decale.statut} ${decale.json.message || ''} ${horaireDe(ligne(d.id))}`);
        // Des heures qui coincent, d abord a blanc (ce que Modifier montre avant « Enregistrer »), puis pour de bon.
        const avant = horaireDe(ligne(d.id));
        const mauvaises = { id: d.id, centerId: 'libramont', preference: { grandGroupe: { impose: true, nombre: 3, tailles: [27, 27, 27], heures: [{ bowling: '14:30', laser_game: '14:30' }, { laser_game: '14:30', bowling: '15:30' }, { laser_game: '16:00', bowling: '16:40' }] } } };
        const aBlanc = await serveur.appeler('POST', '/api/staff-reservations', { dryRun: true, centerId: 'libramont', modification: { ...mauvaises, baseUpdatedAt: version(ligne(d.id)) } });
        const refus = aBlanc.json.refus || {};
        ok(/Ces groupes ne tiennent pas au planning : Groupe 1 : Bowling \(14:30-15:30\) et Laser Game \(14:30\) se chevauchent/.test(refus.message || '')
          && (refus.coincent || []).some((x) => x.groupe === 1 && x.activite === 'laser_game'),
        '[D] a blanc, des heures qui coincent se refusent en disant le groupe et sa case', refus);
        const ecrit = await serveur.appeler('PATCH', '/api/staff-reservations', { ...mauvaises, baseUpdatedAt: version(ligne(d.id)) });
        ok(ecrit.statut === 422 && horaireDe(ligne(d.id)) === avant, '[D] « Enregistrer » avec ces heures : refuse, le dossier ne bouge pas', `${ecrit.statut} ${ecrit.json.message || ''} ${horaireDe(ligne(d.id))}`);
        // De nouvelles heures qui tiennent : ecrites telles quelles, au prix du calcul a blanc.
        const bonnes = { id: d.id, centerId: 'libramont', preference: { grandGroupe: { impose: true, nombre: 3, tailles: [30, 26, 25], heures: [{ bowling: '14:30', laser_game: '15:40' }, { laser_game: '14:30', bowling: '15:30' }, { laser_game: '16:10', bowling: '16:40' }] } } };
        const blanc2 = await serveur.appeler('POST', '/api/staff-reservations', { dryRun: true, centerId: 'libramont', modification: { ...bonnes, baseUpdatedAt: version(ligne(d.id)) } });
        const vrai2 = await serveur.appeler('PATCH', '/api/staff-reservations', { ...bonnes, baseUpdatedAt: version(ligne(d.id)) });
        const r2 = ligne(d.id);
        ok(!blanc2.json.refus && vrai2.statut === 200 && horaireDe(r2) === 'B1@14:30 B2@15:30 B3@16:40 L1@15:40 L2@14:30 L3@16:10' && joueursDe(r2) === '30/26/25'
          && blanc2.json.reservation && Number(r2.price) === Number(blanc2.json.reservation.price),
        '[D] de nouvelles heures et de nouvelles tailles s ecrivent telles quelles, au prix que le calcul a blanc annoncait', { refus: blanc2.json.refus, statut: vrai2.statut, message: vrai2.json.message, horaire: horaireDe(r2), joueurs: joueursDe(r2), prix: r2.price, annonce: blanc2.json.reservation && blanc2.json.reservation.price });
      }
      // 4 groupes choisis, en rotation proposee : un joueur de moins les garde a 4.
      vider();
      const c4 = await creer(corps(80, { impose: true, nombre: 4 }));
      const d4 = c4.json.reservation;
      if (d4) {
        const moins = await serveur.appeler('PATCH', '/api/staff-reservations', { id: d4.id, centerId: 'libramont', pax: 79, program: [{ activityId: 'bowling', pax: 79, participants: 79, duration: 1 }, { activityId: 'laser_game', pax: 79, participants: 79, games: 1 }], baseUpdatedAt: d4.updatedAt });
        const r4 = ligne(d4.id);
        ok(moins.statut === 200 && r4.ops_plan.grandGroupe.nombre === 4 && joueursDe(r4) === '20/20/20/19',
          '[D] 4 groupes choisis : un joueur de moins, ils restent 4 (20, 20, 20 et 19)', `${moins.statut} ${moins.json.message || ''} ${r4 && r4.ops_plan.grandGroupe.nombre} ${joueursDe(r4)}`);
      } else ok(false, '[D] le dossier en 4 groupes est cree', `${c4.statut} ${c4.json.message || ''}`);
      // Un groupe pose AVANT l arrivee : le dossier commence avec lui (sa fiche, sa ligne au planning complet),
      // a blanc comme pour de bon, au meme prix ; a la creation aussi, sans se fier a l arrivee du corps.
      vider();
      const c60 = await creer(corps(60, { impose: true }, { debut: '15:30' }));
      const d60 = c60.json.reservation;
      if (d60) {
        const prixAvant = Number(ligne(d60.id).price);
        const avance = { id: d60.id, centerId: 'libramont', preference: { grandGroupe: { impose: true, nombre: 2, tailles: [30, 30], heures: [{ bowling: '15:30', laser_game: '16:30' }, { laser_game: '15:00', bowling: '16:30' }] } } };
        const blanc = await serveur.appeler('POST', '/api/staff-reservations', { dryRun: true, centerId: 'libramont', modification: { ...avance, baseUpdatedAt: version(ligne(d60.id)) } });
        const vrai = await serveur.appeler('PATCH', '/api/staff-reservations', { ...avance, baseUpdatedAt: version(ligne(d60.id)) });
        const r = ligne(d60.id);
        const annonce = blanc.json.reservation ? String(blanc.json.reservation.startTime).slice(0, 5) : '';
        ok(vrai.statut === 200 && String(r.start_time).slice(0, 5) === '15:00' && annonce === '15:00' && horaireDe(r) === 'B1@15:30 B2@16:30 L1@16:30 L2@15:00' && Number(r.price) === prixAvant,
          '[D] le laser du groupe 2 avance a 15:00 dans un dossier arrive a 15:30 : le dossier commence a 15:00 (a blanc aussi), au meme prix', { statut: vrai.statut, message: vrai.json.message, debut: r.start_time, annonce, horaire: horaireDe(r), prix: r.price, avant: prixAvant });
      } else ok(false, '[D] le dossier de 60 est cree', `${c60.statut} ${c60.json.message || ''}`);
      // Modifier envoie ses pistes (les libres a l heure du premier bowling) avec les groupes : le plan donne les
      // siennes a chaque groupe, le dossier en garde la reunion, au meme prix (avant : « Ce créneau vient de changer »).
      vider();
      const quatre = [{ laser_game: '15:30', bowling: '16:30' }, { laser_game: '15:30', bowling: '16:30' }, { bowling: '15:30', laser_game: '16:30' }, { bowling: '15:30', laser_game: '16:30' }];
      const c4h = await creer(corps(60, { impose: true, nombre: 4, heures: quatre }, { debut: '15:30' }));
      const d4h = c4h.json.reservation;
      if (d4h) {
        const r0 = ligne(d4h.id);
        const lu = (r) => (r.lanes || []).map(Number).sort((a, b) => a - b).join(',');
        const pistesAvant = lu(r0);
        const plus17 = quatre.map((h, i) => (i === 3 ? { ...h, laser_game: '17:00' } : { ...h }));
        const corpsModif = { id: d4h.id, centerId: 'libramont', lanes: [1, 2, 3, 4, 5], preference: { grandGroupe: { impose: true, nombre: 4, tailles: [15, 15, 15, 15], heures: plus17 } } };
        const blanc = await serveur.appeler('POST', '/api/staff-reservations', { dryRun: true, centerId: 'libramont', modification: { ...corpsModif, baseUpdatedAt: version(r0) } });
        const vrai = await serveur.appeler('PATCH', '/api/staff-reservations', { ...corpsModif, baseUpdatedAt: version(r0) });
        const r = ligne(d4h.id);
        ok(!blanc.json.refus && vrai.statut === 200 && /L4@17:00/.test(horaireDe(r)) && lu(r) === pistesAvant && Number(r.price) === Number(r0.price),
          '[D] Modifier envoie d autres pistes avec les groupes : chaque groupe garde celles du plan, le dossier leur reunion, au meme prix', { refus: blanc.json.refus, statut: vrai.statut, message: vrai.json.message, horaire: horaireDe(r), pistes: lu(r), avant: pistesAvant, prix: r.price });
      } else ok(false, '[D] le dossier en 4 groupes aux heures posees est cree', `${c4h.statut} ${c4h.json.message || ''}`);
      vider();
      const tot = await creer(corps(80, { impose: true, nombre: 3, heures: [{ bowling: '14:30', laser_game: '15:30' }, { laser_game: '14:00', bowling: '15:30' }, { laser_game: '16:00', bowling: '16:30' }] }, { debut: '14:30' }));
      const rt = tot.json.reservation && ligne(tot.json.reservation.id);
      ok(tot.statut < 300 && Boolean(rt) && String(rt.start_time).slice(0, 5) === '14:00' && horaireDe(rt) === 'B1@14:30 B2@15:30 B3@16:30 L1@15:30 L2@14:00 L3@16:00',
        '[D] a la creation, une arrivee a 14:30 envoyee avec le groupe 2 au laser a 14:00 : le dossier commence a 14:00', rt ? { debut: rt.start_time, horaire: horaireDe(rt) } : `${tot.statut} ${tot.json.message || ''}`);
    }

    // =======================================================================
    if (joue('E')) {
      section('[E] LES DOSSIERS EN DEUX GROUPES D AVANT RESTENT JUSTES ET MODIFIABLES');
      vider();
      const cree = await creer(corps(60, { impose: true }, { debut: '15:30' }));
      const d = cree.json.reservation;
      ok(cree.statut < 300 && Boolean(d) && horaireDe(ligne(d.id)) === 'B1@15:30 B2@16:30 L1@16:30 L2@15:30',
        '[E] 60 joueurs en deux groupes qui tournent, comme avant : groupe 1 bowling 15:30 puis laser 16:30, groupe 2 l inverse', d ? horaireDe(ligne(d.id)) : `${cree.statut} ${cree.json.message || ''}`);
      if (d) {
        // Le plan tel qu un dossier d avant ce lot l a ecrit : ni heures, ni nombre choisi, ni heures posees.
        const r = ligne(d.id);
        const { heures: _h, auxHeures: _a, nombreChoisi: _n, ...ancien } = r.ops_plan.grandGroupe;
        r.ops_plan = { ...r.ops_plan, grandGroupe: ancien };
        const plus = await serveur.appeler('PATCH', '/api/staff-reservations', { id: d.id, centerId: 'libramont', pax: 58, program: [{ activityId: 'bowling', pax: 58, participants: 58, duration: 1 }, { activityId: 'laser_game', pax: 58, participants: 58, games: 1 }], baseUpdatedAt: version(r) });
        const apres = ligne(d.id);
        ok(plus.statut === 200 && horaireDe(apres) === 'B1@15:30 B2@16:30 L1@16:30 L2@15:30' && joueursDe(apres) === '29/29' && apres.ops_plan.grandGroupe.premier === 'bowling',
          '[E] le dossier d avant, deux joueurs de moins : ses deux groupes de 29, la meme rotation', `${plus.statut} ${plus.json.message || ''} ${horaireDe(apres)} ${joueursDe(apres)}`);
        // Un laser deplace au planning avant ce lot : son plan le porte (laserManual), sans heures posees.
        const deplace = ligne(d.id);
        const blocs = deplace.ops_plan.resourceBlocks.map((b) => (b.resourceType === 'laser_arena' && Number(b.sousGroupe) === 1 ? { ...b, startTime: '17:30', endTime: '17:55' } : b));
        const { heures: _h2, auxHeures: _a2, nombreChoisi: _n2, ...ancien2 } = deplace.ops_plan.grandGroupe;
        deplace.ops_plan = { ...deplace.ops_plan, resourceBlocks: blocs, laserManual: true, grandGroupe: ancien2 };
        const encore = await serveur.appeler('PATCH', '/api/staff-reservations', { id: d.id, centerId: 'libramont', pax: 59, program: [{ activityId: 'bowling', pax: 59, participants: 59, duration: 1 }, { activityId: 'laser_game', pax: 59, participants: 59, games: 1 }], baseUpdatedAt: version(deplace) });
        ok(encore.statut === 200 && horaireDe(ligne(d.id)) === 'B1@15:30 B2@16:30 L1@17:30 L2@15:30',
          '[E] le laser du groupe 1 deplace a 17:30 avant ce lot reste a 17:30 quand le groupe change', `${encore.statut} ${encore.json.message || ''} ${horaireDe(ligne(d.id))}`);
      }
      // Le groupe grandit au-dela de deux fois les armes : il passe en 3 groupes, chacun sur ses pistes. Avant ce
      // lot, la modification se refusait (« Ce créneau vient de changer ») : les pistes de tout le dossier
      // etaient le souhait de chaque groupe, et la base ne voyait pas les autres groupes sur les pistes.
      vider();
      const c2 = await creer(corps(60, { impose: true }, { debut: '15:30' }));
      const d2 = c2.json.reservation;
      if (d2) {
        const grandit = await serveur.appeler('PATCH', '/api/staff-reservations', { id: d2.id, centerId: 'libramont', pax: 62, program: [{ activityId: 'bowling', pax: 62, participants: 62, duration: 1 }, { activityId: 'laser_game', pax: 62, participants: 62, games: 1 }], baseUpdatedAt: d2.updatedAt });
        const r2 = ligne(d2.id);
        const quilles = blocsDe(r2).filter((b) => b.resourceType === 'bowling_lane');
        const ensemble = (a, b) => enMin(a.startTime) < enMin(b.endTime) && enMin(b.startTime) < enMin(a.endTime);
        const communes = quilles.some((a, i) => quilles.some((b, j) => j > i && ensemble(a, b) && (a.lanes || []).some((p) => (b.lanes || []).includes(p))));
        ok(grandit.statut === 200 && joueursDe(r2) === '21/21/20' && quilles.map((b) => (b.lanes || []).length).join('/') === '4/4/4' && !communes && unSeulEndroit(blocsDe(r2)),
          '[E] 60 devenus 62 (plus que 2 fois 30 armes) : 3 groupes de 21, 21 et 20, 4 pistes chacun, jamais une piste a deux groupes', `${grandit.statut} ${grandit.json.message || ''} ${horaireDe(r2)} ${quilles.map((b) => `${b.sousGroupe}[${(b.lanes || []).join(',')}]`).join(' ')}`);
      } else ok(false, '[E] le dossier de 60 est cree', `${c2.statut} ${c2.json.message || ''}`);
    }

    // =======================================================================
    if (joue('H')) {
      section('[H] DEUX GROUPES SUR LES PISTES EN MEME TEMPS : LA BASE ECRIT CE QUE LE MOTEUR A JUGE');
      vider();
      // Le groupe 1 (27 joueurs, 5 pistes) et le groupe 3 (20 joueurs) au bowling a 14:00 : il reste 3 pistes, le
      // groupe 3 y joue en capacite de secours (8 par piste). Le moteur le dit possible ; la base l ecrit.
      const heures = [{ bowling: '14:00', laser_game: '15:00' }, { laser_game: '14:00', bowling: '15:00' }, { bowling: '14:00', laser_game: '15:30' }];
      const plan = await simuler(corps(74, { impose: true, nombre: 3, tailles: [27, 27, 20], heures }));
      const cree = await creer(corps(74, { impose: true, nombre: 3, tailles: [27, 27, 20], heures }));
      const r = cree.json.reservation && ligne(cree.json.reservation.id);
      const b3 = r ? blocsDe(r).find((b) => b.resourceType === 'bowling_lane' && Number(b.sousGroupe) === 3) : null;
      ok(plan.disponible === true && cree.statut < 300 && Boolean(b3) && (b3.lanes || []).length === 3 && horaireDe(r) === horaire(plan),
        '[H] le plan le dit possible et le dossier s ecrit : le groupe 3 sur les 3 pistes qui restent', { dispo: plan.disponible, refus: plan.refus, statut: cree.statut, message: cree.json.message, b3: b3 && b3.lanes });
    }

    // =======================================================================
    if (joue('F')) {
      section('[F] UN GROUPE DEPLACE AU PLANNING GARDE SON HEURE');
      vider();
      const cree = await creer(corps(60, { impose: true }, { debut: '15:30' }));
      const d = cree.json.reservation;
      if (d) {
        const pistes = [...new Set(((d.opsPlan && d.opsPlan.resourceBlocks) || []).filter((b) => b.resourceType === 'bowling_lane').flatMap((b) => b.lanes || []))].sort((a, b) => a - b);
        const glisse = await serveur.appeler('PATCH', '/api/staff-reservations', { id: d.id, centerId: 'libramont', baseUpdatedAt: d.updatedAt, activityMove: { activityId: 'bowling', startTime: '17:00', lanes: pistes } });
        const r = ligne(d.id);
        ok(glisse.statut === 200 && horaireDe(r) === 'B1@17:00 B2@18:00 L1@16:30 L2@15:30' && r.ops_plan.grandGroupe.auxHeures === true
          && JSON.stringify(r.ops_plan.grandGroupe.heures) === JSON.stringify([{ bowling: '17:00', laser_game: '16:30' }, { bowling: '18:00', laser_game: '15:30' }]),
        '[F] le bowling glisse a 17:00 : le plan garde les nouvelles heures de chaque groupe', `${glisse.statut} ${glisse.json.message || ''} ${horaireDe(r)} ${JSON.stringify(r.ops_plan.grandGroupe)}`);
        const plus = await serveur.appeler('PATCH', '/api/staff-reservations', { id: d.id, centerId: 'libramont', pax: 58, program: [{ activityId: 'bowling', pax: 58, participants: 58, duration: 1 }, { activityId: 'laser_game', pax: 58, participants: 58, games: 1 }], baseUpdatedAt: version(r) });
        ok(plus.statut === 200 && horaireDe(ligne(d.id)) === 'B1@17:00 B2@18:00 L1@16:30 L2@15:30',
          '[F] deux joueurs de moins ensuite : les groupes restent la ou le planning les a mis', `${plus.statut} ${plus.json.message || ''} ${horaireDe(ligne(d.id))}`);
      } else ok(false, '[F] le dossier est cree', `${cree.statut} ${cree.json.message || ''}`);
    }

    // =======================================================================
    if (joue('G')) {
      section('[G] LE CANAL PUBLIC NE LIT NI LE NOMBRE NI LES HEURES');
      vider();
      const { prepareReservationOps } = require(path.join(ROOT, OPS));
      const demande = { ...corps(80, { impose: true, nombre: 4, heures: [{ bowling: '14:00', laser_game: '15:00' }, { laser_game: '14:00', bowling: '15:00' }, { bowling: '15:00', laser_game: '16:00' }, { laser_game: '16:00', bowling: '16:30' }] }) };
      delete demande.channel;
      const sousGroupesDu = (ops) => ((ops && ops.opsPlan && ops.opsPlan.resourceBlocks) || []).filter((b) => b.sousGroupe).length;
      const enLigne = await prepareReservationOps({ ...demande }, 'public');
      const auComptoir = await prepareReservationOps({ ...demande }, 'staff');
      ok(sousGroupesDu(enLigne) === 0 && sousGroupesDu(auComptoir) === 8, '[G] le formulaire en ligne garde son plan ; le comptoir pose ses 4 groupes', { public: sousGroupesDu(enLigne), staff: sousGroupesDu(auComptoir) });
    }
  } catch (error) {
    ok(false, `exception : ${error.message}`, String(error.stack || '').split('\n').slice(0, 4).join(' | '));
  }

  console.log(rouges
    ? `\ngroupes-check: ${rouges} ROUGE(S)`
    : '\ngroupes-check: ALL OK - le nombre de groupes se choisit, chaque groupe joue aux heures posees au comptoir, ce qui coince se dit sur la case de son groupe, la modification garde ce qui a ete pose, les dossiers d avant restent justes et le canal public ne change pas');
  process.exit(rouges ? 1 : 0);
}

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
//   [I] « CRÉER » SUR DES GROUPES QUI GENENT UN AUTRE DOSSIER (4 pistes prises a 15:00, 20 armes au laser a 14:00)
//       se refuse avant la base, et la phrase dit chaque groupe, son activite et son heure ; jamais « Ce créneau
//       vient de changer ». « Créer quand même » part toujours a placer.
//   [J] « TOUT LE GROUPE » A 2, 3, 4 ET 5 GROUPES (2026-11-24 : a 3 groupes, « Cette partie ou cette vague ne fait
//       pas partie du dossier. »). Le calcul a blanc et l ecriture passent, chaque groupe garde ses joueurs, ses
//       pistes et son ordre, tout decale du meme ecart, le decalage inverse remet tout ; deux parties de laser et
//       des heures posees au comptoir aussi. La vague du groupe 3 se deplace seule, se retire et revient avec ses
//       15 joueurs et son groupe ; une vague qui n est pas au dossier reste refusee. Les pistes prises a la nouvelle
//       heure : chaque groupe en prend d autres, sans en partager. Le minigolf du groupe entier reste libre, ou
//       suit son heure posee. Le laser en groupes de 10 et 14, et 40 joueurs en 2 vagues de 20, sans grand groupe,
//       se decalent pareil. Rien de ce qui passait ne se refuse : un groupe grandi de 25 a 35 sans plan refait
//       place la 2e vague que les armes comptent, avec les 10 joueurs qui n en ont pas.
//   [K] DEUX GROUPES DU DOSSIER DANS L ARENE (2026-11-24 : le laser du groupe 3 pose a 15:10 pendant celui du groupe 1
//       passait, deux parties a la fois que Reserver refuse). La regle de Reserver, pas plus, pas moins : une vague
//       seule sur la partie d autres groupes du dossier se refuse, a blanc comme a l ecriture, et la phrase nomme la
//       vague qui gene et dit quoi faire ; partir avec eux se refuse quand les armes ne suffisent pas (45 sur 30) et
//       passe quand elles suffisent (15 + 15) ; deux groupes d un depart commun deplaces ensemble a la minute passent,
//       a blanc et a l ecriture ; un autre dossier dans la partie compte ses armes avec celles des groupes qui y
//       partent ensemble (15 + 10 + 15 sur 30 : refuse).
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
const FENETRE = 'lib/reserver-fenetre.js';

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
  // [I] « Créer » sur des groupes qui ne tiennent pas repart a la base (« Ce créneau vient de changer »), ou la
  // phrase ne dit plus le groupe ni l activite.
  { nom: 'creer-sans-refus-des-groupes', lettre: 'I', fichier: FENETRE, de: '  if (prepare.groupesRefuses) throw prepare.groupesRefuses;\n', vers: '' },
  { nom: 'refus-sans-groupe-ni-activite', lettre: 'I', fichier: FENETRE, de: "      phrase = `Groupe ${n}${quoi ? `, ${quoi}` : ''} : ${raison.charAt(0).toLowerCase()}${raison.slice(1)}`;\n", vers: '' },
  // [J] les vagues d une partie recomptees sur les armes (le calcul d avant, Math.ceil(joueurs / armes)) : la 3e
  // vague d un grand groupe ne fait plus partie du dossier.
  { nom: 'vagues-sur-les-armes', lettre: 'J', fichier: MOUVEMENT, de: '    const unite = vaguesDeLaPartie(old, game, players, capacity).find(vague => vague.wave === wave) || null;', vers: '    const waves = Math.ceil(players / capacity);\n    const unite = wave <= waves ? { wave, count: waves, pax: Math.floor(players / waves) + (wave <= players % waves ? 1 : 0), modele: null } : null;' },
  // [J] seules les vagues du plan comptent : une vague que les armes comptaient avant ce jour se refuse.
  { nom: 'vagues-du-plan-seulement', lettre: 'J', fichier: MOUVEMENT, de: '  const count = Math.max(0, ...dites, Number.isInteger(parLesArmes) ? parLesArmes : 0);', vers: '  const count = dites.length ? Math.max(...dites) : parLesArmes;' },
  // [J] une vague que rien ne decrit prend une part des armes, pas les joueurs qui manquent.
  { nom: 'vague-inconnue-sur-les-armes', lettre: 'J', fichier: MOUVEMENT, de: '  inconnues.forEach((unit, rang) => { unit.pax = Math.floor(reste / inconnues.length) + (rang < reste % inconnues.length ? 1 : 0); });', vers: '  inconnues.forEach((unit) => { unit.pax = Math.floor(players / count) + (unit.wave <= players % count ? 1 : 0); });' },
  // [J] une vague a placer revient avec une part des armes, pas les joueurs de son groupe.
  { nom: 'vague-a-placer-sur-les-armes', lettre: 'J', fichier: MOUVEMENT, de: '    const joueursVague = unite.pax;', vers: '    const joueursVague = Math.floor(players / Math.ceil(players / capacity)) + (wave <= players % Math.ceil(players / capacity) ? 1 : 0);' },
  // [J] une vague a placer revient sans son groupe ; ou le retrait ne note pas le groupe de la vague.
  { nom: 'vague-a-placer-sans-son-groupe', lettre: 'J', fichier: MOUVEMENT, de: 'groupPlayers: players, ...identiteDeLaVague(unite.modele), start: 0,', vers: 'groupPlayers: players, start: 0,' },
  { nom: 'retrait-sans-le-groupe', lettre: 'J', fichier: MOUVEMENT, de: 'pax: vague.pax, ...identiteDeLaVague(vague.modele) }));', vers: 'pax: vague.pax }));' },
  // [J] les vagues du plan (a placer comprises) recomptees sur les armes : la vague retiree du groupe 3 disparait.
  { nom: 'unites-sur-les-armes', lettre: 'J', fichier: MOUVEMENT, de: '      return vaguesDeLaPartie(old, countIndex, players, Number(center.resources?.laser?.weaponCount || 30)).map(vague => ({ countIndex, groupWaveIndex: vague.wave, groupWaveCount: vague.count, unitKey: `${countIndex}.${vague.wave}`, pax: vague.pax, ...identiteDeLaVague(vague.modele) }));', vers: '      const waves = Math.ceil(players / Number(center.resources?.laser?.weaponCount || 30));\n      return Array.from({ length: waves }, (_, index) => ({ countIndex, groupWaveIndex: index + 1, groupWaveCount: waves, unitKey: `${countIndex}.${index + 1}`, pax: Math.floor(players / waves) + (index < players % waves ? 1 : 0) }));' },
  // [J] la frise ne suit plus le decalage : le minigolf a son heure et les etapes du bowling restent ou elles etaient.
  { nom: 'frise-du-grand-groupe-figee', lettre: 'J', fichier: 'lib/decaler-le-groupe.js', de: '  if (Array.isArray(plan.timeline)) sortie.timeline = plan.timeline.map((b) => decalerUnBloc(b, ecart));\n', vers: '' },
  // [K] les groupes du dossier ne comptent plus dans l arene au deplacement ; le refus ne dit plus quoi faire ; un geste
  // qui deplace deux groupes d un depart commun se juge a chaque etape contre l autre pas encore deplace (le PATCH, son
  // calcul a blanc, l ecriture) ; les armes des groupes qui partent ensemble ne comptent plus avec un autre
  // dossier.
  { nom: 'freres-du-dossier-ignores', lettre: 'K', fichier: MOUVEMENT, de: "  if (activity === 'laser_game' && !removing) {\n    const armes = Number(center.resources?.laser?.weaponCount) || 30;", vers: "  if (false) {\n    const armes = Number(center.resources?.laser?.weaponCount) || 30;" },
  { nom: 'refus-sans-conseil', lettre: 'K', fichier: MOUVEMENT, de: " : une seule partie à la fois. ${ensembleTient ? `Partez avec ${saPartie.length > 1 ? 'eux' : 'lui'} à ${clock(start(gene))}, ou dès ${clock(end(gene))}.` : `Partez dès ${clock(end(gene))}.`}`);", vers: ' : une seule partie à la fois.`);' },
  { nom: 'geste-sans-ensemble', lettre: 'K', fichier: MOUVEMENT, de: '        && start(block) < end(movedBlock) && start(movedBlock) < end(block) && !bougeEncore(block));', vers: '        && start(block) < end(movedBlock) && start(movedBlock) < end(block));' },
  // [K] plus que Reserver : un depart commun que les armes tiennent se refuse.
  { nom: 'depart-commun-refuse-au-serveur', lettre: 'K', fichier: MOUVEMENT, de: '      if (parties <= lancements && prises + joueurs <= armes) continue;', vers: '      if (parties < lancements && prises + joueurs <= armes) continue;' },
  { nom: 'patch-sans-ensemble', lettre: 'K', fichier: API, de: '            const suivant = buildActivityMove(candidate, deplacement, { aLaMinute: true, ensemble: deplacements });', vers: '            const suivant = buildActivityMove(candidate, deplacement, { aLaMinute: true });' },
  { nom: 'blanc-sans-ensemble', lettre: 'K', fichier: API, de: '        candidat = essayer(candidat, deplacement, deplacements);', vers: '        candidat = essayer(candidat, deplacement);' },
  { nom: 'essais-sans-ensemble', lettre: 'K', fichier: API, de: '() => essayer(base, move, essai));', vers: '() => essayer(base, move));' },
  { nom: 'ecriture-sans-ensemble', lettre: 'K', fichier: 'lib/database.js', de: 'deplacements[0], input, deplacements.length > 1 ? 0 : null, deplacements);', vers: 'deplacements[0], input, deplacements.length > 1 ? 0 : null);' },
  { nom: 'armes-des-freres-ignorees', lettre: 'K', fichier: 'lib/database.js', de: '    const autresEtFreres = freres.length ? [...reservations, { ...payload, opsPlan: { resourceBlocks: freres } }] : reservations;', vers: '    const autresEtFreres = reservations;' },
  // [J] le bowling deplace donne toutes les pistes du dossier a chaque groupe.
  { nom: 'pistes-de-tout-le-groupe', lettre: 'J', fichier: MOUVEMENT, de: 'lanes: (block.lanes || []).map(lane => mapping.get(lane)), requiredLanes: (block.lanes || []).length,', vers: 'lanes: [...mapping.values()], requiredLanes: mapping.size,' },
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

    // =======================================================================
    if (joue('I')) {
      section('[I] « CRÉER » SUR DES GROUPES QUI GENENT UN AUTRE DOSSIER DIT LESQUELS');
      // 60 joueurs en 4 groupes de 15 : les groupes 1 et 2 au laser a 14:00 puis au bowling a 15:00, les groupes 3
      // et 4 l inverse, 3 pistes chacun.
      const heures = [{ laser_game: '14:00', bowling: '15:00' }, { laser_game: '14:00', bowling: '15:00' }, { bowling: '14:00', laser_game: '15:00' }, { bowling: '14:00', laser_game: '15:00' }];
      const quatre = corps(60, { impose: true, nombre: 4, heures });
      const voisin = (activite, heure, pax, lanes) => ({
        name: 'Dossier Voisin', phone: '0470999888', email: '', notes: '', occasion: '', date: jour, startTime: heure, duration: 1, totalDuration: 1, lanes, pax, status: 'pending', type: activite === 'bowling' ? 'bowling' : 'visite', formuleId: '',
        program: activite === 'bowling' ? [{ activityId: 'bowling', pax, participants: pax, duration: 1 }] : [{ activityId: 'laser_game', pax, participants: pax, games: 1 }],
        laserGames: 0, extras: [], channel: 'staff', requiresLanes: activite === 'bowling', centerId: 'libramont',
        preference: activite === 'bowling' ? { activityOrder: ['bowling'], preferredTimes: { bowling: heure } } : { activityOrder: ['laser_game'], preferredTimes: { laser_game: heure }, laserGameTimes: [heure], laserPlacement: 'scheduled' },
      });
      // Un autre dossier tient 4 pistes a 15:00 : il en reste 4 pour les 6 des groupes 1 et 2. La fenetre le dit sur
      // la case ; « Créer » (sans « Créer quand même ») refusait plus loin, a la base : « Ce créneau vient de changer ».
      vider();
      const pistes = await creer(voisin('bowling', '15:00', 20, [1, 2, 3, 4]));
      const avantPistes = B.base.reservations.size;
      const planPistes = await simuler(quatre);
      const creePistes = await creer(quatre);
      const ditPistes = String(creePistes.json.message || '');
      ok(pistes.statut < 300 && planPistes.disponible === false && (planPistes.coincent || []).some((x) => x.activite === 'bowling' && /Pas assez de pistes libres à 15:00/.test(x.raison)),
        '[I] MONTAGE : un autre dossier sur 4 pistes a 15:00, la fenetre dit sur la case qu un groupe manque de pistes', { statut: pistes.statut, coincent: planPistes.coincent, refus: planPistes.refus });
      ok(creePistes.statut === 409 && /^Ces groupes ne tiennent pas au planning : Groupe [12], bowling : pas assez de pistes libres à 15:00 : il en faut 3\./.test(ditPistes)
        && !/Ce créneau vient de changer/.test(ditPistes) && B.base.reservations.size === avantPistes,
      '[I] « Créer » : refuse, la phrase dit le groupe, le bowling et 15:00, rien ne s ecrit', { statut: creePistes.statut, message: ditPistes, ecrits: B.base.reservations.size - avantPistes });
      // Un autre dossier tient 20 armes au laser a 14:00 : les groupes 1 et 2 (15 + 15) n y tiennent pas.
      vider();
      const laser = await creer(voisin('laser_game', '14:00', 20, []));
      const avantLaser = B.base.reservations.size;
      const creeLaser = await creer(quatre);
      const ditLaser = String(creeLaser.json.message || '');
      ok(laser.statut < 300 && creeLaser.statut === 409 && /Groupe 1 : laser à 14:00 : il reste 10 places sur 30, il en faut 15\./.test(ditLaser)
        && /Groupe 2 : laser à 14:00 : plus aucune place sur 30 \(le groupe 1 y joue\), il en faut 15\./.test(ditLaser) && !/Ce créneau vient de changer/.test(ditLaser)
        && B.base.reservations.size === avantLaser,
      '[I] 20 armes prises au laser a 14:00 : « Créer » dit les groupes 1 et 2 au laser a 14:00, rien ne s ecrit', { statut: creeLaser.statut, message: ditLaser });
      // « Créer quand même » reste le choix de l equipe : le dossier part a placer, sans rien prendre.
      const force = await creer({ ...quatre, forcer: true });
      const place = force.json.reservation;
      ok(force.statut < 300 && Boolean(place) && place.validationStatus === 'staff_review' && !(place.lanes || []).length,
        '[I] « Créer quand même » : le dossier part a placer, sans piste', { statut: force.statut, message: force.json.message, statutDossier: place && place.validationStatus, pistes: place && place.lanes });
    }

    // =======================================================================
    if (joue('J')) {
      section('[J] « TOUT LE GROUPE » A 2, 3, 4 ET 5 GROUPES : CHAQUE GROUPE GARDE SES JOUEURS, SES PISTES ET SON ORDRE');
      // (ok ne rend rien : vrai rend la condition, pour sauter la suite d un montage rate)
      const vrai = (condition, quoi, detail) => { ok(condition, quoi, detail); return Boolean(condition); };
      const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      const plus = (h, ecart) => hhmm(enMin(String(h).slice(0, 5)) + ecart);
      // Chaque passage du dossier en base, son heure decalee de `ecart` : l activite, le groupe, la partie et la vague
      // (sur combien), la plage, les joueurs et les pistes.
      const empreinteDe = (blocs, ecart = 0) => blocs.map((b) => `${b.resourceType === 'bowling_lane' ? 'B' : 'L'}${b.sousGroupe || 0}#${b.countIndex || 1}.${b.groupWaveIndex || 1}/${b.groupWaveCount || 1}@${plus(b.startTime, ecart)}-${plus(b.endTime, ecart)} ${b.players}j[${(b.lanes || []).join(',')}]`).sort().join(' | ');
      const empreinte = (r, ecart = 0) => empreinteDe(blocsDe(r), ecart);
      // Les etapes de bowling et de laser de la frise, de meme ; l ordre de chaque groupe (ses activites, de la
      // premiere a la derniere) ; les heures de chaque groupe que le plan garde (ce que Modifier reprendra).
      const friseDe = (r, ecart = 0) => (((r.ops_plan || {}).timeline) || []).filter((s) => s && ['bowling', 'laser_game'].includes(s.activityId)).map((s) => `${s.activityId}${s.sousGroupe || 0}#${s.countIndex || 1}.${s.groupWaveIndex || 1}@${plus(s.startTime, ecart)} ${s.players}j`).sort().join(' ');
      const ordreDe = (r) => {
        const parGroupe = new Map();
        blocsDe(r).slice().sort((a, b) => enMin(a.startTime) - enMin(b.startTime)).forEach((b) => { const n = Number(b.sousGroupe) || 0; parGroupe.set(n, `${parGroupe.get(n) || ''}${b.resourceType === 'bowling_lane' ? 'B' : 'L'}`); });
        return [...parGroupe.entries()].sort((a, b) => a[0] - b[0]).map(([n, suite]) => `${n}:${suite}`).join(' ');
      };
      const heuresDe = (r, ecart = 0) => (((r.ops_plan || {}).grandGroupe || {}).heures || []).map((h) => ['bowling', 'laser_game'].filter((id) => h[id]).map((id) => `${id}@${plus(h[id], ecart)}`).join(' '));
      const decaler = (id, ecart, pistes = null) => serveur.appeler('PATCH', '/api/staff-reservations', { id, centerId: 'libramont', baseUpdatedAt: version(ligne(id)), toutLeGroupe: { ecart, ...(pistes ? { pistes } : {}) } });
      const aBlanc = async (id, ecarts) => (await serveur.appeler('POST', '/api/staff-reservations', { dryRun: true, centerId: 'libramont', deplacement: { id, centerId: 'libramont', baseUpdatedAt: version(ligne(id)), toutLeGroupe: { ecarts } } })).json;
      const glisser = (id, activityMove) => serveur.appeler('PATCH', '/api/staff-reservations', { id, centerId: 'libramont', baseUpdatedAt: version(ligne(id)), activityMove });
      const dire = (x) => `${x.statut} ${x.json.message || ''}`.trim();
      const ETRANGERE = 'Cette partie ou cette vague ne fait pas partie du dossier.';

      // Le groupe entier, de 2 a 5 groupes ; deux parties de laser ; les heures de [T5]
      // (scripts/planning-heure-glisser-check.js : les groupes 1 et 2 partent ensemble au laser a 15:30).
      const posees = [{ bowling: '16:30', laser_game: '15:30' }, { bowling: '16:30', laser_game: '15:30' }, { bowling: '15:30', laser_game: '16:30' }, { bowling: '15:30', laser_game: '16:30' }];
      for (const c of [
        { pax: 60, nombre: 2 }, { pax: 60, nombre: 3 }, { pax: 60, nombre: 4 }, { pax: 75, nombre: 5 },
        { pax: 60, nombre: 4, parties: 2 },
        { pax: 60, nombre: 4, tailles: [15, 15, 15, 15], heures: posees, debut: '15:30' },
      ]) {
        vider();
        const nom = `${c.nombre} groupes (${c.pax} joueurs${c.parties ? `, ${c.parties} parties de laser` : ''}${c.heures ? ', heures posees au comptoir' : ''})`;
        const cree = await creer(corps(c.pax, { impose: true, nombre: c.nombre, ...(c.tailles ? { tailles: c.tailles } : {}), ...(c.heures ? { heures: c.heures } : {}) }, { parties: c.parties || 1, debut: c.debut || '14:00' }));
        const r0 = cree.json.reservation && ligne(cree.json.reservation.id);
        const lasers = r0 ? blocsDe(r0).filter((b) => b.resourceType === 'laser_arena') : [];
        if (!vrai(cree.statut < 300 && Boolean(r0) && lasers.length === c.nombre * (c.parties || 1) && lasers.every((b) => b.groupWaveCount === c.nombre && Number(b.sousGroupe) >= 1),
          `[J] MONTAGE ${nom} : une vague de laser par groupe et par partie`, r0 ? empreinte(r0) : dire(cree))) continue;
        const id = r0.id;
        const attendu = { empreinte: empreinte(r0, 30), frise: friseDe(r0, 30), ordre: ordreDe(r0), heures: JSON.stringify(heuresDe(r0, 30)), arrivee: plus(r0.start_time, 30), origine: empreinte(r0) };
        const blanc = await aBlanc(id, [30, 60, -30]);
        ok(Array.isArray(blanc.essais) && blanc.essais.length === 3 && blanc.essais.every((e) => e && e.passe === true),
          `[J] ${nom} : le calcul a blanc de la pop-up laisse passer +30, +60 et -30 min`, blanc.essais || blanc.refus);
        const x = await decaler(id, 30);
        const r1 = ligne(id);
        ok(x.statut === 200 && empreinte(r1) === attendu.empreinte && ordreDe(r1) === attendu.ordre && String(r1.start_time).slice(0, 5) === attendu.arrivee,
          `[J] ${nom} : « Tout le groupe » +30 min passe, chaque groupe garde ses joueurs, ses pistes et son ordre, chaque passage 30 min plus tard`, { statut: dire(x), attendu: attendu.empreinte, lu: empreinte(r1), ordre: ordreDe(r1) });
        ok(x.statut === 200 && friseDe(r1) === attendu.frise && JSON.stringify(heuresDe(r1)) === attendu.heures && r1.ops_plan.grandGroupe.auxHeures === true,
          `[J] ${nom} : la frise et les heures de chaque groupe suivent, celles que Modifier gardera`, { frise: friseDe(r1), attendue: attendu.frise, heures: heuresDe(r1), attendues: attendu.heures });
        const y = await decaler(id, -30);
        ok(y.statut === 200 && empreinte(ligne(id)) === attendu.origine, `[J] ${nom} : le decalage inverse remet chaque passage a sa place`, { statut: dire(y), lu: empreinte(ligne(id)), attendu: attendu.origine });
      }

      // La vague du groupe 3, en 4 groupes de 15 : elle glisse seule, se retire, revient avec ses 15 joueurs et son
      // groupe ; une 5e vague, que le dossier n a pas, reste refusee.
      vider();
      const c4 = await creer(corps(60, { impose: true, nombre: 4 }));
      const d4 = c4.json.reservation && ligne(c4.json.reservation.id);
      if (vrai(c4.statut < 300 && Boolean(d4) && blocsDe(d4).some((b) => b.resourceType === 'laser_arena' && b.groupWaveIndex === 3 && Number(b.sousGroupe) === 3), '[J] MONTAGE : 4 groupes de 15, la vague 3 est celle du groupe 3', d4 ? empreinte(d4) : dire(c4))) {
        const id = d4.id;
        const l3 = () => blocsDe(ligne(id)).filter((b) => b.resourceType === 'laser_arena' && Number(b.groupWaveIndex) === 3);
        const sauf3 = (r) => empreinteDe(blocsDe(r).filter((b) => !(b.resourceType === 'laser_arena' && Number(b.groupWaveIndex) === 3)));
        const autres = sauf3(d4);
        // (une demi-heure ou le dossier ne joue plus rien : la fin de son dernier passage)
        const cible = hhmm(Math.ceil(Math.max(...blocsDe(d4).map((b) => enMin(b.endTime))) / 30) * 30);
        const heures3 = heuresDe(d4)[2].replace(/laser_game@\d\d:\d\d/, `laser_game@${cible}`);
        const seule = await glisser(id, { activityId: 'laser_game', unitKey: '1.3', startTime: cible });
        const glissee = l3();
        ok(seule.statut === 200 && glissee.length === 1 && String(glissee[0].startTime).slice(0, 5) === cible && glissee[0].players === 15 && Number(glissee[0].sousGroupe) === 3
          && sauf3(ligne(id)) === autres && heuresDe(ligne(id))[2] === heures3,
        `[J] la vague du groupe 3 glisse seule a ${cible} : ses 15 joueurs, son groupe, l heure du groupe 3 suit, les autres groupes ne bougent pas`, { statut: dire(seule), l3: glissee, heures: heuresDe(ligne(id)) });
        const retrait = await glisser(id, { activityId: 'laser_game', unitKey: '1.3', unplace: true });
        const passe = (ligne(id).ops_plan || {}).laserPassPlan || {};
        const enAttente = (passe.pendingUnits || []).find((u) => u.unitKey === '1.3');
        ok(retrait.statut === 200 && l3().length === 0 && Boolean(enAttente) && enAttente.pax === 15 && Number(enAttente.sousGroupe) === 3 && enAttente.groupWaveCount === 4
          && (passe.pendingUnits || []).length === 1 && passe.remainingGames === 1 && sauf3(ligne(id)) === autres,
        '[J] la vague du groupe 3 se retire : elle attend a placer avec ses 15 joueurs et son groupe, seule, les autres groupes ne bougent pas', { statut: dire(retrait), l3: l3().length, enAttente, aPlacer: (passe.pendingUnits || []).length, reste: passe.remainingGames, autres: sauf3(ligne(id)) === autres ? 'inchanges' : sauf3(ligne(id)) });
        const retour = await glisser(id, { activityId: 'laser_game', unitKey: '1.3', startTime: cible });
        const revenue = l3();
        const apres = (ligne(id).ops_plan || {}).laserPassPlan || {};
        ok(retour.statut === 200 && revenue.length === 1 && revenue[0].players === 15 && Number(revenue[0].sousGroupe) === 3 && Number(revenue[0].sousGroupes) === 4 && revenue[0].groupWaveCount === 4
          && !(apres.pendingUnits || []).length && apres.remainingGames === 0 && sauf3(ligne(id)) === autres && heuresDe(ligne(id))[2] === heures3,
        `[J] elle revient a ${cible} avec ses 15 joueurs et son groupe (3 sur 4), plus rien a placer`, { statut: dire(retour), revenue, laserPassPlan: apres, heures: heuresDe(ligne(id)) });
        const avantRefus = JSON.stringify(ligne(id).ops_plan);
        const etrangere = await glisser(id, { activityId: 'laser_game', unitKey: '1.5', startTime: cible });
        ok(etrangere.statut === 422 && etrangere.json.message === ETRANGERE && JSON.stringify(ligne(id).ops_plan) === avantRefus,
          '[J] une 5e vague, que le dossier n a pas : refusee, rien ne s ecrit', dire(etrangere));
      }

      // Sans grand groupe : 40 joueurs en 2 vagues de 20 (les armes), et le laser en groupes de 10 et 14 (2 vagues
      // sous 30 armes, lib/visit-program.js groupesDuLaser).
      const laserSeul = (pax, extra = {}) => ({
        name: 'Laser Essai', phone: '0470999888', email: '', notes: '', occasion: '', date: jour, startTime: '15:00', duration: 1, totalDuration: 1, lanes: [], pax, status: 'pending', type: 'visite', formuleId: '',
        program: [{ activityId: 'laser_game', pax, participants: pax, games: 1, ...extra }], laserGames: 0, extras: [], channel: 'staff', requiresLanes: false, centerId: 'libramont',
        preference: { activityOrder: ['laser_game'], preferredTimes: { laser_game: '15:00' }, laserGameTimes: ['15:00'], laserPlacement: 'scheduled' },
      });
      const vagues = (r) => blocsDe(r).filter((b) => b.resourceType === 'laser_arena').sort((a, b) => a.groupWaveIndex - b.groupWaveIndex).map((b) => b.players).join('/');
      for (const [nom, c, joueurs] of [['40 joueurs en 2 vagues de 20', laserSeul(40), '20/20'], ['le laser en groupes de 10 et 14', laserSeul(24, { groupes: [10, 14] }), '10/14']]) {
        vider();
        const cree = await creer(c);
        const r0 = cree.json.reservation && ligne(cree.json.reservation.id);
        if (!vrai(cree.statut < 300 && Boolean(r0) && vagues(r0) === joueurs, `[J] MONTAGE ${nom} : deux vagues (${joueurs})`, r0 ? empreinte(r0) : dire(cree))) continue;
        const attendu = empreinte(r0, 30);
        const blanc = await aBlanc(r0.id, [30]);
        const x = await decaler(r0.id, 30);
        ok(blanc.essais && blanc.essais[0] && blanc.essais[0].passe === true && x.statut === 200 && empreinte(ligne(r0.id)) === attendu && vagues(ligne(r0.id)) === joueurs,
          `[J] ${nom} : « Tout le groupe » +30 min passe (a blanc aussi), chaque vague garde ses joueurs`, { blanc: blanc.essais || blanc.refus, statut: dire(x), lu: empreinte(ligne(r0.id)), attendu });
        const etrangere = await glisser(r0.id, { activityId: 'laser_game', unitKey: '1.3', startTime: '18:00' });
        ok(etrangere.statut === 422 && etrangere.json.message === ETRANGERE, `[J] ${nom} : une 3e vague, que le dossier n a pas, reste refusee`, dire(etrangere));
      }

      // Rien de ce qui passait ne se refuse : un groupe de 25 (une vague) passe a 35 sans que son plan soit refait (une
      // replanification ratee le garde tel quel). Les armes comptent 2 vagues, la console propose la 2e a placer ; elle
      // se pose avec les 10 joueurs qui n ont pas de vague (avant : 17, et le groupe en comptait 42).
      vider();
      const c25 = await creer(laserSeul(25));
      const d25 = c25.json.reservation && ligne(c25.json.reservation.id);
      if (vrai(c25.statut < 300 && Boolean(d25) && vagues(d25) === '25', '[J] MONTAGE : 25 joueurs au laser, une vague', d25 ? empreinte(d25) : dire(c25))) {
        const grandi = ligne(d25.id);
        grandi.pax = 35;
        grandi.program = { ...grandi.program, items: grandi.program.items.map((i) => (i.activityId === 'laser_game' ? { ...i, pax: 35, participants: 35 } : i)) };
        const x = await glisser(d25.id, { activityId: 'laser_game', unitKey: '1.2', startTime: '16:00' });
        const deuxieme = blocsDe(ligne(d25.id)).find((b) => b.resourceType === 'laser_arena' && Number(b.groupWaveIndex) === 2);
        ok(x.statut === 200 && Boolean(deuxieme) && deuxieme.players === 10 && String(deuxieme.startTime).slice(0, 5) === '16:00' && vagues(ligne(d25.id)) === '25/10',
          '[J] le groupe grandi a 35 sans plan refait : la 2e vague que les armes comptent se place, avec les 10 joueurs qui n en ont pas', { statut: dire(x), vagues: vagues(ligne(d25.id)) });
      }

      // Les pistes prises a la nouvelle heure : un autre dossier joue sur la piste 1 a 16:00. Decale de 30 min, un groupe
      // y serait encore : le bowling prend d autres pistes, chaque groupe garde son nombre de pistes, deux groupes qui
      // jouent en meme temps n en partagent aucune, ceux qui partageaient les leurs a d autres heures les partagent
      // encore ; « Annuler » (les pistes d avant) remet tout.
      vider();
      const voisin = await creer({
        name: 'Bowling Voisin', phone: '0470999777', email: '', notes: '', occasion: '', date: jour, startTime: '16:00', duration: 1, totalDuration: 1, lanes: [1], pax: 4, status: 'pending', type: 'bowling', formuleId: '',
        program: [{ activityId: 'bowling', pax: 4, participants: 4, duration: 1 }], laserGames: 0, extras: [], channel: 'staff', requiresLanes: true, centerId: 'libramont',
        preference: { activityOrder: ['bowling'], preferredTimes: { bowling: '16:00' } },
      });
      const cp = await creer(corps(60, { impose: true, nombre: 4 }));
      const dp = cp.json.reservation && ligne(cp.json.reservation.id);
      const quilles = (r) => blocsDe(r).filter((b) => b.resourceType === 'bowling_lane');
      const pistesDuVoisin = voisin.json.reservation ? (ligne(voisin.json.reservation.id).lanes || []).map(Number).join(',') : '';
      const jusqua16 = (r) => quilles(r).some((b) => (b.lanes || []).map(Number).includes(1) && String(b.endTime).slice(0, 5) === '16:00');
      if (vrai(voisin.statut < 300 && pistesDuVoisin === '1' && cp.statut < 300 && Boolean(dp) && quilles(dp).length === 4 && jusqua16(dp),
        '[J] MONTAGE : un autre dossier sur la piste 1 a 16:00, un groupe du grand groupe y joue jusqu a 16:00', { voisin: dire(voisin), pistes: pistesDuVoisin, groupe: dp ? empreinte(dp) : dire(cp) })) {
        // Pour chaque paire de services : les memes pistes (=), une piste commune (~), aucune (.).
        const liens = (r) => { const q = quilles(r); return q.map((a, i) => q.slice(i + 1).map((b) => ((a.lanes || []).join(',') === (b.lanes || []).join(',') ? '=' : (a.lanes || []).some((p) => (b.lanes || []).includes(p)) ? '~' : '.')).join('')).join('|'); };
        const ensemble = (a, b) => enMin(a.startTime) < enMin(b.endTime) && enMin(b.startTime) < enMin(a.endTime);
        const sansPistes = (texte) => texte.replace(/\[[^\]]*\]/g, '');
        const origine = empreinte(dp);
        const pistesAvant = (dp.lanes || []).map(Number).sort((a, b) => a - b);
        const blanc = await aBlanc(dp.id, [30]);
        const x = await decaler(dp.id, 30);
        const r = ligne(dp.id);
        const q = quilles(r);
        const partagees = q.some((a, i) => q.some((b, j) => j > i && ensemble(a, b) && (a.lanes || []).some((p) => (b.lanes || []).includes(p))));
        const surLeVoisin = q.some((b) => (b.lanes || []).map(Number).includes(1) && enMin(b.endTime) > 16 * 60);
        const pistesApres = (r.lanes || []).map(Number).sort((a, b) => a - b);
        ok(x.statut === 200 && q.every((b, i) => (b.lanes || []).length === (quilles(dp)[i].lanes || []).length) && !partagees && !surLeVoisin && liens(r) === liens(dp)
          && sansPistes(empreinte(r)) === sansPistes(empreinte(dp, 30)) && pistesApres.join(',') !== pistesAvant.join(','),
        '[J] la piste 1 prise a 16:00 : le bowling prend d autres pistes, chaque groupe garde son nombre de pistes, aucun ne partage les siennes avec un groupe qui joue en meme temps, tout decale de 30 min', { statut: dire(x), avant: origine, apres: empreinte(r) });
        ok(blanc.essais && blanc.essais[0] && blanc.essais[0].passe === true && JSON.stringify(blanc.essais[0].pistes) === JSON.stringify(pistesApres),
          '[J] le calcul a blanc le disait, avec les pistes que le bowling prendrait', { blanc: blanc.essais || blanc.refus, ecrit: pistesApres });
        const annuler = await decaler(dp.id, -30, pistesAvant);
        ok(annuler.statut === 200 && empreinte(ligne(dp.id)) === origine, '[J] « Annuler » (-30 min, les pistes d avant) : chaque groupe retrouve ses pistes et ses heures', { statut: dire(annuler), lu: empreinte(ligne(dp.id)), attendu: origine });
      }

      // Les autres activites du dossier : le minigolf du groupe entier. « Libre », il reste libre quand le groupe se
      // decale ; une heure posee apres la rotation, il suit du meme ecart, comme chaque groupe.
      vider();
      const base = corps(60, { impose: true, nombre: 4 });
      const cm = await creer({ ...base, program: [...base.program, { activityId: 'minigolf_blacklight', pax: 60, participants: 60 }], preference: { ...base.preference, activityOrder: [...base.preference.activityOrder, 'minigolf_blacklight'] } });
      const dm = cm.json.reservation && ligne(cm.json.reservation.id);
      const autresDe = (r, ecart = 0) => (((r.ops_plan || {}).timeline) || []).filter((s) => s && s.type === 'activity' && !['bowling', 'laser_game'].includes(s.activityId))
        .map((s) => `${s.activityId}@${s.flexible ? 'libre' : `${plus(s.startTime, ecart)}-${plus(s.endTime, ecart)}${s.heurePosee ? ' posee' : ''}`}`).sort().join(' | ');
      if (vrai(cm.statut < 300 && Boolean(dm) && (dm.program.items || []).some((i) => i.activityId === 'minigolf_blacklight') && !/minigolf_blacklight@\d/.test(autresDe(dm)),
        '[J] MONTAGE : 4 groupes au bowling et au laser, et le minigolf du groupe entier, libre', dm ? { autres: autresDe(dm), blocs: empreinte(dm) } : dire(cm))) {
        const id = dm.id;
        const libre = { blocs: empreinte(dm, 30), autres: autresDe(dm) };
        const x = await decaler(id, 30);
        ok(x.statut === 200 && empreinte(ligne(id)) === libre.blocs && autresDe(ligne(id)) === libre.autres,
          '[J] le minigolf libre : « Tout le groupe » +30 min passe, chaque groupe 30 min plus tard, le minigolf reste libre', { statut: dire(x), blocs: empreinte(ligne(id)), autres: autresDe(ligne(id)) });
        const cible = hhmm(Math.ceil(Math.max(...blocsDe(ligne(id)).map((b) => enMin(b.endTime))) / 30) * 30);
        const heure = await glisser(id, { activityId: 'minigolf_blacklight', startTime: cible });
        const pose = ligne(id);
        if (vrai(heure.statut === 200 && new RegExp(`minigolf_blacklight@${cible}-\\d\\d:\\d\\d posee`).test(autresDe(pose)), `[J] MONTAGE : le minigolf recoit son heure, ${cible}, apres la rotation`, { statut: dire(heure), autres: autresDe(pose) })) {
          const attendu = { blocs: empreinte(pose, 30), autres: autresDe(pose, 30) };
          const blanc = await aBlanc(id, [30]);
          const y = await decaler(id, 30);
          ok(blanc.essais && blanc.essais[0] && blanc.essais[0].passe === true && y.statut === 200 && empreinte(ligne(id)) === attendu.blocs && autresDe(ligne(id)) === attendu.autres,
            '[J] le minigolf a son heure : « Tout le groupe » +30 min passe (a blanc aussi), le minigolf et chaque groupe 30 min plus tard', { blanc: blanc.essais || blanc.refus, statut: dire(y), autres: autresDe(ligne(id)), attendues: attendu.autres });
        }
      }
    }

    // =======================================================================
    if (joue('K')) {
      section('[K] DEUX GROUPES DU DOSSIER DANS L ARENE : LA REGLE DE RESERVER, PAS PLUS, PAS MOINS');
      const vrai = (condition, quoi, detail) => { ok(condition, quoi, detail); return Boolean(condition); };
      const dire = (x) => `${x.statut} ${x.json.message || ''}`.trim();
      const lasersK = (id) => blocsDe(ligne(id)).filter((b) => b.resourceType === 'laser_arena').map((b) => `L${b.sousGroupe}@${String(b.startTime).slice(0, 5)}`).sort().join(' ');
      const glisser = (id, activityMove) => serveur.appeler('PATCH', '/api/staff-reservations', { id, centerId: 'libramont', baseUpdatedAt: version(ligne(id)), activityMove });
      const enBloc = (id, activityMoves) => serveur.appeler('PATCH', '/api/staff-reservations', { id, centerId: 'libramont', baseUpdatedAt: version(ligne(id)), activityMoves });
      const essais = async (id, listes) => (await serveur.appeler('POST', '/api/staff-reservations', { dryRun: true, centerId: 'libramont', deplacement: { id, centerId: 'libramont', baseUpdatedAt: version(ligne(id)), essais: listes } })).json;
      const laser = (groupe, startTime) => ({ activityId: 'laser_game', unitKey: `1.${groupe}`, startTime });
      // Les groupes 1 et 2 au laser a 16:00 puis au bowling a 16:30 ; les groupes 3 et 4 au bowling a 17:30 puis au
      // laser a 18:30. A 16:10, les groupes 3 et 4 ne jouent rien : seule l arene peut refuser.
      vider();
      const cree = await creer(corps(60, { impose: true, nombre: 4, tailles: [15, 15, 15, 15], heures: [
        { laser_game: '16:00', bowling: '16:30' }, { laser_game: '16:00', bowling: '16:30' }, { bowling: '17:30', laser_game: '18:30' }, { bowling: '17:30', laser_game: '18:30' }] }, { debut: '16:00' }));
      const d = cree.json.reservation && ligne(cree.json.reservation.id);
      if (vrai(cree.statut < 300 && Boolean(d) && lasersK(d.id) === 'L1@16:00 L2@16:00 L3@18:30 L4@18:30',
        '[K] MONTAGE : 4 groupes de 15, les groupes 1 et 2 partent ensemble au laser a 16:00, les groupes 3 et 4 a 18:30', d ? lasersK(d.id) : dire(cree))) {
        const id = d.id;
        // Une vague seule sur la partie d une autre : refusee, a blanc comme a l ecriture, la phrase nomme la vague qui
        // gene et dit quoi faire ; rien ne bouge.
        const avant = lasersK(id);
        const blanc = await essais(id, [[laser(3, '16:10')]]);
        const x = await glisser(id, laser(3, '16:10'));
        const prise = /^Arène laser déjà prise à 16:10 par le laser des groupes 1 et 2, de 16:00 à 16:25 : une seule partie à la fois\. Partez dès 16:25\./;
        ok(blanc.essais && blanc.essais[0] && blanc.essais[0].passe === false && prise.test(blanc.essais[0].raison || ''),
          '[K] a blanc : le laser du groupe 3 a 16:10, pendant celui des groupes 1 et 2 (16:00 a 16:25), ne passe pas, la phrase nomme la vague et dit « Partez dès 16:25 »', blanc.essais || blanc.refus);
        ok(x.statut === 422 && prise.test(x.json.message || '') && lasersK(id) === avant,
          '[K] le PATCH le refuse avec la meme phrase (422) et rien ne bouge (deux parties a la fois : Reserver le refuse)', { statut: dire(x), lu: lasersK(id) });
        // Partir avec eux : 30 + 15 armes, refuse, la phrase dit ce qui reste.
        const y = await glisser(id, laser(3, '16:00'));
        ok(y.statut === 422 && /^Laser à 16:00 : plus aucune place sur 30 \(le laser des groupes 1 et 2 y joue, de 16:00 à 16:25\), il en faut 15\. Partez dès 16:25\./.test(y.json.message || '') && lasersK(id) === avant,
          '[K] au depart des groupes 1 et 2 : 45 armes sur 30, refuse, « plus aucune place sur 30 [...] il en faut 15 », rien ne bouge', { statut: dire(y), lu: lasersK(id) });
        // Pas moins que Reserver : le groupe 4 part seul a 19:00, revient au depart du groupe 3 (15 + 15 armes) ; a 18:40,
        // pendant la partie du groupe 3, il est refuse et la phrase propose leur depart commun.
        const z1 = await glisser(id, laser(4, '19:00'));
        const z2 = await glisser(id, laser(4, '18:40'));
        const z3 = await glisser(id, laser(4, '18:30'));
        ok(z1.statut === 200 && z2.statut === 422 && /^Arène laser déjà prise à 18:40 par le laser du groupe 3, de 18:30 à 18:55 : une seule partie à la fois\. Partez avec lui à 18:30, ou dès 18:55\./.test(z2.json.message || '')
          && z3.statut === 200 && lasersK(id) === 'L1@16:00 L2@16:00 L3@18:30 L4@18:30',
        '[K] le groupe 4 seul a 19:00 passe ; a 18:40, pendant le groupe 3, refuse (« Partez avec lui à 18:30, ou dès 18:55 ») ; au depart du groupe 3, 15 + 15 armes, il passe', { z1: dire(z1), z2: dire(z2), z3: dire(z3), lu: lasersK(id) });
        // Un geste qui deplace les deux groupes d un depart commun a la minute (la pastille « groupes 3 et 4 » du planning
        // complet) : chaque vague se joue a son tour, l autre va encore bouger, il passe, a blanc et a l ecriture.
        const blancBloc = await essais(id, [[laser(3, '18:40'), laser(4, '18:40')]]);
        const w = await enBloc(id, [laser(3, '18:40'), laser(4, '18:40')]);
        ok(blancBloc.essais && blancBloc.essais[0] && blancBloc.essais[0].passe === true && w.statut === 200 && lasersK(id) === 'L1@16:00 L2@16:00 L3@18:40 L4@18:40',
          '[K] les groupes 3 et 4 ensemble a 18:40 (un geste, deux vagues) : a blanc et a l ecriture, ils passent et partent ensemble', { blanc: blancBloc.essais || blancBloc.refus, statut: dire(w), lu: lasersK(id) });
        // (les memes deux heures changees dans Modifier : le calcul a blanc des deplacements ; rien ne s ecrit)
        const lasersDu = (r) => ((r && r.opsPlan && r.opsPlan.resourceBlocks) || []).filter((b) => b.resourceType === 'laser_arena').map((b) => `L${b.sousGroupe}@${String(b.startTime).slice(0, 5)}`).sort().join(' ');
        const blancDeplacements = (await serveur.appeler('POST', '/api/staff-reservations', { dryRun: true, centerId: 'libramont', deplacement: { id, centerId: 'libramont', baseUpdatedAt: version(ligne(id)), activityMoves: [laser(3, '18:50'), laser(4, '18:50')] } })).json;
        ok(!blancDeplacements.refus && lasersDu(blancDeplacements.reservation) === 'L1@16:00 L2@16:00 L3@18:50 L4@18:50' && lasersK(id) === 'L1@16:00 L2@16:00 L3@18:40 L4@18:40',
          '[K] Modifier, les groupes 3 et 4 a 18:50 : le calcul a blanc des deplacements les fait partir ensemble, rien ne s ecrit', { deplacements: blancDeplacements.refus || lasersDu(blancDeplacements.reservation), lu: lasersK(id) });
        // Un autre dossier dans la partie du groupe 3 (10 joueurs, arrive a 18:30, son laser a 18:40) : le groupe 4 qui la
        // rejoint ferait 40 armes sur 30.
        const s1 = await glisser(id, laser(4, '19:30'));
        const autre = await serveur.appeler('POST', '/api/staff-reservations', {
          name: 'Laser Dix', phone: '0470999777', email: '', notes: '', occasion: '', date: jour, startTime: '18:30', duration: 1, totalDuration: 1, lanes: [], pax: 10, status: 'pending', type: 'laser', formuleId: '',
          program: [{ activityId: 'laser_game', pax: 10, participants: 10, games: 1 }], laserGames: 1, extras: [], channel: 'staff', requiresLanes: false, centerId: 'libramont',
          preference: { activityOrder: ['laser_game'], preferredTimes: { laser_game: '18:30' } },
        });
        const idAutre = autre.json && autre.json.reservation && autre.json.reservation.id;
        const sonLaser = idAutre ? blocsDe(ligne(idAutre)).filter((b) => b.resourceType === 'laser_arena').map((b) => String(b.startTime).slice(0, 5)).join(' ') : '';
        if (vrai(s1.statut === 200 && autre.statut < 300 && sonLaser === '18:40', 'MONTAGE le groupe 4 a 19:30, un autre dossier de 10 joueurs dans la partie du groupe 3 (18:40)', { s1: dire(s1), autre: dire(autre), sonLaser })) {
          const s2 = await glisser(id, laser(4, '18:40'));
          ok(s2.statut === 409 && /^Plus assez d’armes pour le laser à 18:40 : il en reste 5 sur 30, il en faut 15\./.test(s2.json.message || '') && /L4@19:30/.test(lasersK(id)),
            '[K] le groupe 4 au depart du groupe 3 et de l autre dossier : 15 + 10 + 15 armes sur 30, refuse (« il en reste 5 sur 30, il en faut 15 »), il reste a 19:30', { statut: dire(s2), lu: lasersK(id) });
        }
      }
    }
  } catch (error) {
    ok(false, `exception : ${error.message}`, String(error.stack || '').split('\n').slice(0, 4).join(' | '));
  }

  console.log(rouges
    ? `\ngroupes-check: ${rouges} ROUGE(S)`
    : '\ngroupes-check: ALL OK - le nombre de groupes se choisit, chaque groupe joue aux heures posees au comptoir, ce qui coince se dit sur la case de son groupe, la modification garde ce qui a ete pose, les dossiers d avant restent justes, le canal public ne change pas et tout le groupe se decale a 2, 3, 4 et 5 groupes');
  process.exit(rouges ? 1 : 0);
}

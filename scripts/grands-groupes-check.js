'use strict';
// UN GRAND GROUPE AU COMPTOIR (2026-11-22, lib/grand-groupe.js).
//
// Ansar : « Quand ya grand groupe et qu'on réserve sur côté staff logiciel avec réservation par exemple 60
// personne pour bowling il gère pas dutout genre il est comme l'autre qui sait diviser groupe etc pour multi
// activité en plus etc ». La fenetre Reserver envoyait 60 joueurs au bowling comme UN service : dix pistes
// sur huit, chaque heure refusee. Le formulaire en ligne, lui, coupe le groupe sur la place du centre.
// LA REGLE DU COORDINATEUR (2026-11-22) : « aucun changement de prix silencieux pour les groupes qui
// passaient déjà ». Au bowling et au laser, un grand groupe garde le plan d avant tant qu il tient ; ses
// groupes ne tournent d office que quand il ne tient pas ; sinon la rotation est une option du ticket, qui
// dit ce qu elle change, et le staff choisit : rien ne bascule seul.
// Ce gate joue la VRAIE console (scripts/planning-v3-fixtures.js), le VRAI handler api/staff-reservations.js
// et le vrai moteur (scripts/reserver-banc.js, base en memoire), avec de vrais clics a 1366 x 768 : le
// nombre du groupe se tape dans « Autre », rien n est suppose des compteurs par activite. Il verifie
// toujours le dossier cree en base, pas seulement l ecran :
//   [A] 60 JOUEURS AU BOWLING SEUL, un dimanche vide : deux groupes l un apres l autre, cinq pistes cote a
//       cote chacun, 390 € ; le planning et la fiche disent « groupe 1 » et « groupe 2 ».
//   [B] 60 JOUEURS AU BOWLING ET AU LASER a 15:30 : le plan d avant tient (le bowling en deux services, puis
//       le laser), il reste, 990 € ; le ticket propose « Faire tourner 2 groupes : fin à 17:30, 990 € ».
//       Touche : deux groupes de 30 qui tournent (le groupe 1 au bowling pendant que le groupe 2 joue au
//       laser, puis ils echangent), et l inverse se propose. La page des groupes montre une rangee par groupe
//       et tient a l ecran ; l activite du groupe 1 se change d un toucher et le moteur recalcule ;
//       un groupe ne depasse jamais les 30 armes (pas de « + » a 30) ; planning et fiche par groupe ;
//       « Ils sont 58 » a l arrivee refait le plan, les deux groupes et leur ordre restent.
//   [C] LE PLAN IMPOSSIBLE : 60 joueurs a 19:30 un jour charge. Le plan d avant ne rentre pas avant la
//       fermeture, et les groupes qui tournent manquent de 12 armes au laser de 19:30 (18 places sur 30).
//       La rangee du bowling dit le verdict de tout le groupe (« laser, manque 12 armes »), le ticket aussi
//       (« Laser à 19:30 impossible »), et « Prendre 18:00 » propose l heure ou tout le groupe tient ; un
//       toucher, et le dossier nait a 18:00, ses groupes tournant d office. Rien ne part avant « Créer ».
//   [D] LE SERVEUR, sans navigateur : le prix suit les vrais joueurs de chaque activite (60 au bowling, 40 au
//       laser : 790 €) ; les tailles posees au comptoir (28 et 22) font les blocs et les pistes ; une taille
//       au-dessus des armes est refusee en le disant ; un autre centre se coupe sur sa propre place (Gembloux,
//       20 armes : 3 groupes de 20, deux au bowling en meme temps sur des pistes differentes) ; sans
//       « Faire tourner », le plan d avant, le meme que sans aucune demande (40 joueurs : 673 €), et les
//       groupes qui tournent d office quand il ne tient pas (60 joueurs a 20:00 : fin 22:00) ; une
//       modification garde les groupes ; le canal public ne lit jamais la demande (le formulaire en ligne ne
//       change pas).
//   [E] 40 JOUEURS AU BOWLING ET AU LASER a 15:30 : sans toucher, le plan et le prix d avant (tout le bowling
//       sur 7 pistes, puis le laser en deux vagues, 673 €, fin 17:25), rien ne bascule seul, et le dossier
//       nait ainsi. Le ticket propose « Faire tourner 2 groupes : fin à 17:00, 712 € », un bouton encadre ;
//       touche, la rotation au prix affiche, l inverse se propose, et le dossier nait en deux groupes de 20
//       qui tournent, 712 €.
//   [F] 60 JOUEURS A 20:00, fermeture a 22:00 : le plan d avant finirait apres la fermeture, les groupes
//       tournent d office, sans option a choisir, et le dossier nait ainsi (fin 22:00, 990 €).
//   [G] UNE HEURE TOUCHEE NE MET JAMAIS UN SOUS-GROUPE A DEUX ENDROITS (le lot du 2026-11-22 : la pop-up et
//       le glisser du planning complet sur un groupe qui tourne). 60 joueurs qui tournent a 15:30 : les heures
//       que le planning demande au serveur (deplacerABlanc, essais) ne proposent pas le bowling a 16:00 ni a
//       16:30 (« chevauche le Laser Game du groupe 1, de 16:30 à 16:55 »), ni le laser du groupe 1 a 16:00 ;
//       le PATCH du toucher refuse avec la meme phrase et le dossier ne bouge pas ; 17:00 s enregistre.
//   [H] UN GRAND GROUPE A LA MINUTE (le lot du 2026-11-22 : l heure tapee a la minute au comptoir). 60 au
//       bowling seul a 15:10 : 15:10 puis 16:10, 390 € comme a 15:30 ; 60 qui tournent a 15:10 : fin 17:10,
//       990 € ; a 19:40 (laser tape a 21:40), les groupes tournent d office des 19:40, fin 21:40 ; le dossier
//       nait a 15:10 en base, chaque groupe a un seul endroit. Au comptoir, en vrais clics : « Autre heure »
//       16:10 sur 60 au bowling, le ticket dit groupe 1 a 16:10 et groupe 2 a 17:10, et le dossier nait ainsi.
//   [I] LA DEMANDE A D ANSAR (2026-11-23, « 3, 4 groupes ou plus [...] qui va où, quand, combien », simple
//       aussi au planning complet). 60 joueurs a 15:30, « Faire tourner », la page des groupes : « + » deux
//       fois, 4 groupes de 15 ; chaque heure se touche et se tape (les groupes 1 et 2 au laser a 15:30 puis au
//       bowling a 16:30, les groupes 3 et 4 l inverse) ; rien ne coince, le ticket dit les 4 groupes ; le
//       dossier nait ainsi, au prix annonce ; le planning complet marque chaque groupe (« groupes 1 et 2 » sur
//       la partie de laser qu ils jouent ensemble), chaque mot de ses pastilles grises garde 3 px de place (en 12
//       px, jamais coupe) de 1366 a 768 de large et au telephone, ou la pastille garde aussi 3 px avec ce qui la
//       precede ; la fiche aussi. Modifier montre le bloc des groupes, lisible
//       (aucune case coupee, le bouton qui inverse sur la ligne de son groupe), et son programme dit le vrai
//       numero de chaque groupe au bowling : le laser du groupe 4 a 17:00 s ecrit, le reste ne bouge pas, au meme
//       prix, et le planning suit ; une heure a 08:00 rend la case du groupe 1 rouge avec sa raison, avant
//       « Enregistrer ».
//   [J] LES VAGUES QUE LE DOSSIER PORTE, PAS CELLES DES ARMES (2026-11-24 : la vague du groupe 3 retiree du
//       planning laser n apparaissait pas dans « Parties à placer », la console recomptait 60 joueurs en 2 vagues
//       de 30). Au planning laser, en vrais gestes (M, « Retirer du planning », toucher le jeton puis son depart) :
//       le laser du groupe 3 d un grand groupe en 4 groupes de 15 se retire, la file le montre avec ses 15 joueurs
//       et « groupe 3/4 », il se replace a 17:00 et quitte la file, puis rejoint le depart du groupe 4 (16:30, 15 + 15
//       armes, comme a Reserver) ; pareil pour la vague 2 (14 joueurs) d un laser en groupes de 10 et 14. Modifier
//       dit les vagues du dossier (« 4 vagues de 15 armes », « 2 vagues de 10 et 14 armes », « 2 sessions »), et la
//       bulle du compte celles que le serveur ecrirait a 58 et a 55 joueurs, et pour 50 joueurs au laser sur 60.
//   [K] MODIFIER APRES LE RETRAIT D UNE VAGUE (2026-11-24 : un grand groupe dont le laser du groupe 3 attend d etre
//       replace refusait toute modification, jusqu au nom). Un grand groupe en 4 groupes de 15 (le laser du groupe 3
//       retire, puis celui du groupe 4 deplace a 17:00) et un laser de 40 joueurs (sa vague 2 retiree), cote a cote,
//       en vrais gestes dans Modifier : le nom change s enregistre et rien ne bouge ; l arrivee 30 min plus tard
//       s enregistre, chaque passage pose suit de 30 min, et la vague retiree reste a placer avec ses joueurs (et son
//       groupe). Les deux dossiers pareils.
//   [*] Zero erreur JavaScript.
//
// CONTRE-PREUVES : `--contre-preuves` rejoue le gate sur du code casse expres, une mutation a la fois, en
// memoire (le serveur par le crochet de compilation du banc, la console par le serveur de fichiers), et
// exige que chacune rougisse sa lettre. Le disque n est jamais touche. `--seul=B` ne joue qu une lettre,
// `--captures` pose les ecrans dans captures-grands-groupes/ (jamais commites).
// Lancement : node scripts/grands-groupes-check.js [--contre-preuves] [--seul=A] [--captures]
// Zero reseau sortant, zero vraie base : rien ne part.

const fs = require('fs');
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
const PORT = Number(process.env.PINLANE_GRANDS_GROUPES_PORT || 7741);
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CAPTURES = path.join(ROOT, 'captures-grands-groupes');
const argument = (nom) => { const a = process.argv.find((x) => x === `--${nom}` || x.startsWith(`--${nom}=`)); return a ? (a.includes('=') ? a.split('=')[1] : true) : null; };
const SEUL = typeof argument('seul') === 'string' ? argument('seul') : '';
const joue = (lettre) => !SEUL || SEUL === lettre;
const lf = (t) => String(t).split('\r\n').join('\n');

const APP = 'assets/app-main.js';
const CORE = 'assets/booking-core.js';
const CSS = 'assets/pinlane-staff.css';
const PLANNING = 'assets/pinlane-planning-global.js';
const PLANNING_CSS = 'assets/pinlane-planning-global.css';
const MOTEUR = 'lib/ops-engine.js';
const GG = 'lib/grand-groupe.js';
const OPS = 'lib/reservation-ops.js';
const MOUVEMENT = 'lib/reservation-activity-move.js';
const FENETRE = 'lib/reserver-fenetre.js';

// LES MUTATIONS : une regle retiree a la fois. `lettre` : le scenario qui doit rougir. `serveur` : le
// code passe par le crochet de compilation du banc, sinon la console le recoit du serveur de fichiers.
const MUTATIONS = [
  // [A] le bowling seul repart en un service (la panne d Ansar) ; le planning et la fiche oublient le groupe.
  { nom: 'bowling-en-un-service', lettre: 'A', fichier: APP, de: "  const programme = s.type === 'visite' || adaptee || rsFmActive(s) || Boolean(rvGrandGroupe());", vers: "  const programme = s.type === 'visite' || adaptee || rsFmActive(s);" },
  { nom: 'planning-sans-groupe', lettre: 'A', fichier: PLANNING, de: "      var groupe = e.groupe ? 'groupe ' + e.groupe : e.groupes && e.groupes.length > 1 ? 'groupes ' + gfGroupesEnMots(e.groupes) : '';", vers: "      var groupe = '';" },
  { nom: 'fiche-sans-groupes', lettre: 'A', fichier: APP, de: "  const groupes = r.status === 'cancelled' ? null : sousGroupesDuDossier(r);", vers: '  const groupes = null;' },
  // [B] plus de rotation ; l activite du groupe 1 ne part pas ; une taille au-dela des armes ; la page deborde.
  { nom: 'sans-rotation', lettre: 'B', serveur: true, fichier: MOTEUR, de: "  const demandeGrandGroupe = input.channel === 'staff' ? lireGrandGroupe(preference.grandGroupe) : null;", vers: '  const demandeGrandGroupe = null;' },
  { nom: 'premier-oublie', lettre: 'B', fichier: APP, de: "  const premier = grand && grand.tourne && grand.ids.includes(voulu.premier) ? voulu.premier : '';", vers: "  const premier = '';" },
  // (le plafond de Reserver seul : Modifier a la meme fin de fonction, plafondDUnGroupeEdition)
  { nom: 'tailles-sans-plafond', lettre: 'B', fichier: APP, de: '  const plafonds = grand.ids.filter((id) => getQuickVisitParticipants(id) >= pax)', vers: '  const plafonds = grand.ids.filter(() => false)' },
  { nom: 'groupes-qui-debordent', lettre: 'B', fichier: CSS, de: '.qb-modal.rv.rs .rs-gg-c { display: flex; flex-direction: column; justify-content: center; gap: 1px; min-width: 0; min-height: 52px;', vers: '.qb-modal.rv.rs .rs-gg-c { display: flex; flex-direction: column; justify-content: center; gap: 1px; min-width: 0; min-height: 220px;' },
  { nom: 'sous-groupe-a-deux-endroits', lettre: 'B', serveur: true, fichier: MOTEUR, de: '    const cle = Number(fenetre.sousGroupe) || 0;', vers: '    const cle = 0;' },
  { nom: 'compte-sans-groupes', lettre: 'B', serveur: true, fichier: OPS, de: '    ...(isEdit ? grandGroupeGarde(request, shiftMinutes) : {}),\n', vers: '' },
  // [C] la rangee se tait, la proche se cherche sur le laser, le refus dit l heure de la ligne.
  { nom: 'rangee-muette', lettre: 'C', fichier: APP, de: '  if (rvRotationEnJeu(grand) && id === grand.ids[0]) return v;\n', vers: '' },
  { nom: 'proche-sur-le-laser', lettre: 'C', fichier: APP, de: '  const id = rvGroupesEnJeu(grand) ? grand.ids[0] : ids.includes(refus.activite) ? refus.activite : ids[0];', vers: '  const id = ids.includes(refus.activite) ? refus.activite : ids[0];' },
  { nom: 'heure-de-la-ligne', lettre: 'C', fichier: APP, de: "  const heureDuGrand = rvGroupesEnJeu(grand) ? ((/\\b(\\d{2}:\\d{2})\\b/.exec(raison) || [])[1] || s.startTime || '') : '';", vers: "  const heureDuGrand = '';" },
  // [D] le laser prend les tailles du groupe, les tailles posees sont ignorees, la capacite ne refuse plus,
  // la modification perd les groupes, le canal public lit la demande.
  { nom: 'laser-sur-les-tailles', lettre: 'D', serveur: true, fichier: GG, de: '    const parts = joueurs === personnes ? choisies.slice() : partsAuProrata(joueurs, choisies);', vers: '    const parts = choisies.slice();' },
  { nom: 'tailles-ignorees', lettre: 'D', serveur: true, fichier: GG, de: '    choisies = posees;\n', vers: '' },
  { nom: 'armes-depassees', lettre: 'D', serveur: true, fichier: GG, de: '    const trop = capacite > 0 ? parts.findIndex((part) => part > capacite) : -1;', vers: '    const trop = -1;' },
  { nom: 'modification-sans-groupes', lettre: 'D', serveur: true, fichier: OPS, de: '    ...(isEdit ? grandGroupeGarde(request, shiftMinutes) : {}),\n', vers: '' },
  { nom: 'public-lit-la-demande', lettre: 'D', serveur: true, fichier: MOTEUR, de: "  const demandeGrandGroupe = input.channel === 'staff' ? lireGrandGroupe(preference.grandGroupe) : null;", vers: '  const demandeGrandGroupe = lireGrandGroupe(preference.grandGroupe);' },
  { nom: 'pistes-du-groupe-partagees', lettre: 'D', serveur: true, fichier: MOTEUR, de: "      const occupees = dejaPoses.length ? [...reservations, pseudoReservationFromBlocks('grand-groupe', dejaPoses)] : reservations;", vers: '      const occupees = reservations;' },
  // [E] les groupes tournent d office meme quand le plan d avant tient (le prix change en silence) ;
  // l option manque, dit le prix d avant, ne fait rien ; le ticket croit les groupes en jeu sans que le
  // plan les pose.
  { nom: 'rotation-d-office', lettre: 'E', serveur: true, fichier: MOTEUR, de: '  if (grandGroupe && !grandGroupe.impose && !grandGroupe.rejoue) {', vers: '  if (false) {' },
  { nom: 'option-absente', lettre: 'E', fichier: APP, de: '  lignes.push(rsOptionDesGroupesHtml());\n', vers: '' },
  { nom: 'option-au-prix-d-avant', lettre: 'E', fichier: APP, de: "  const prix = Number.isFinite(Number(a.plan.prix)) && a.plan.prix !== null ? rsEuros(Number(a.plan.prix)) : '';", vers: '  const prix = rsEuros(Number((rvPlanCourant() || {}).prix));' },
  { nom: 'option-sans-effet', lettre: 'E', fichier: APP, de: '  s.grandGroupe = { ...(s.grandGroupe || {}), tourne: Boolean(oui) };\n', vers: '' },
  { nom: 'rotation-affichee-sans-le-plan', lettre: 'E', fichier: APP, de: '  if (plan) return Boolean(plan.grandGroupe && plan.grandGroupe.tourne);', vers: '  if (plan) return true;' },
  // [F] le plan d avant refuse sans repli sur les groupes qui tournent ; leur temps se somme au lieu
  // d aller du premier depart a la derniere fin ; la fenetre refuse d avance l heure du soir.
  { nom: 'pas-de-repli', lettre: 'F', serveur: true, fichier: MOTEUR, de: '    result = avant.ok ? avant : (enGroupes.ok || enGroupes.scenario || !avant.scenario ? enGroupes : avant);', vers: '    result = avant;' },
  { nom: 'duree-de-la-rotation-sommee', lettre: 'F', serveur: true, fichier: MOTEUR, de: '  const scheduledAnchorMinutes = rotation && anchorWindows.length\n    ? Math.max(...anchorWindows.map((window) => window.end)) - Math.min(...anchorWindows.map((window) => window.start))\n    : anchorWindows.reduce((sum, window) => sum + (window.end - window.start), 0);', vers: '  const scheduledAnchorMinutes = anchorWindows.reduce((sum, window) => sum + (window.end - window.start), 0);' },
  { nom: 'fenetre-refuse-d-avance', lettre: 'F', fichier: APP, de: '  return grand && grand.tourne ? Math.min(visite, rvDureeDUnGroupe()) : visite;', vers: '  return visite;' },
  // [G] une heure deplacee (la pop-up du planning complet, son glisser, Modifier) ne regarde plus le
  // sous-groupe : le compte des joueurs du groupe tient, le groupe 1 joue au bowling pendant son laser.
  { nom: 'sous-groupe-deplace-a-deux-endroits', lettre: 'G', serveur: true, fichier: MOUVEMENT, de: '    if (!groupe) continue;', vers: '    continue;' },
  // [H] un grand groupe a la minute : la rotation refuse la minute, se cale sur la grille du centre, ou
  // ses heures posees se rejouent par-dessus les groupes.
  { nom: 'rotation-refuse-la-minute', lettre: 'H', serveur: true, fichier: MOTEUR, de: "  if (!heuresVoulues && !aLaMinute && debut % PROGRAM_GRID_MINUTES !== 0) return { ok: false, code: 'off_grid'", vers: "  if (!heuresVoulues && debut % PROGRAM_GRID_MINUTES !== 0) return { ok: false, code: 'off_grid'" },
  { nom: 'rotation-sur-la-grille-du-centre', lettre: 'H', serveur: true, fichier: GG, de: '  const origine = ((Number(debut) % grille) + grille) % grille;', vers: '  const origine = 0;' },
  { nom: 'heures-posees-rejouees-sur-les-groupes', lettre: 'H', serveur: true, fichier: FENETRE, de: "  const aPoser = enSousGroupes ? heuresPosees.filter((posee) => posee.activityId !== 'bowling' && posee.activityId !== 'laser_game') : heuresPosees;", vers: '  const aPoser = heuresPosees;' },
  // [I] les heures posees a la page des groupes ne partent pas ; deux groupes au laser ensemble perdent leurs
  // numeros au planning complet ; Modifier n a plus le bloc des groupes ; une heure hors horaires ne se dit plus
  // sur sa case.
  { nom: 'heures-des-groupes-non-envoyees', lettre: 'I', fichier: APP, de: '    ...(heures ? { heures } : {}),\n', vers: '' },
  { nom: 'planning-groupes-ensemble-sans-numero', lettre: 'I', fichier: PLANNING, de: "      var groupe = e.groupe ? 'groupe ' + e.groupe : e.groupes && e.groupes.length > 1 ? 'groupes ' + gfGroupesEnMots(e.groupes) : '';", vers: "      var groupe = e.groupe ? 'groupe ' + e.groupe : '';" },
  { nom: 'modifier-sans-bloc-des-groupes', lettre: 'I', fichier: APP, de: '            ${groupesEditionHtml()}\n', vers: '' },
  { nom: 'horaires-hors-case', lettre: 'I', serveur: true, fichier: MOTEUR, de: '        ...(horsHoraires ? { conflict: horsHoraires.conflict } : {}),\n', vers: '' },
  // [I] Modifier : le programme d un groupe revient a cote de son nom (cases coupees, bouton qui inverse sous la
  // rangee) ; le bowling du programme redit « 1er groupe, 2e groupe » au lieu du vrai numero.
  { nom: 'modifier-programme-a-cote', lettre: 'I', fichier: CSS, de: 'body:is(.staff-mode, .admin-mode) .fx-modal .fm-gg-prog { flex: 1 1 100%; order: 2;', vers: 'body:is(.staff-mode, .admin-mode) .fx-modal .fm-gg-prog { flex: 1 1 320px; order: 0;' },
  // [I] la barre de Modifier annonce un prix que le serveur n ecrirait pas ; les pastilles du planning complet debordent de leur colonne.
  { nom: 'prix-annonce-malgre-refus', lettre: 'I', fichier: APP, de: '  if (!groupesRefuses && prix != null && Math.round(prix * 100)', vers: '  if (prix != null && Math.round(prix * 100)' },
  { nom: 'pastilles-qui-debordent', lettre: 'I', fichier: PLANNING_CSS, de: 'line-height: 17px; white-space: normal; overflow-wrap: anywhere; }', vers: 'line-height: 17px; white-space: nowrap; }' },
  // [I] la pastille grise revient a 0,7 px de marge dans la colonne de 54 px (la regle du 24/11 avant ce lot) ; au
  // telephone, elle se recolle au texte d avant.
  { nom: 'pastille-sans-marge', lettre: 'I', fichier: PLANNING_CSS, de: '@container feuille (min-width: 640px) and (max-width: 1059px) { .gf-x__h { margin-left: -4px; padding: 0 1px; font-weight: 600; }', vers: '@container feuille (min-width: 640px) and (max-width: 1059px) { .gf-x__h { margin-left: -4px; padding: 0 2px; }' },
  { nom: 'pastille-collee-au-telephone', lettre: 'I', fichier: PLANNING_CSS, de: '  .gf-x__h, .gf-x__hors { margin-left: 0; }\n', vers: '' },
  { nom: 'programme-groupes-ordinaux', lettre: 'I', fichier: APP, de: "${Number(etape.sousGroupe) > 0 ? `Groupe ${Number(etape.sousGroupe)}` : `${index ? `${index + 1}e` : '1er'} groupe`} à", vers: "${index ? `${index + 1}e` : '1er'} groupe à" },
  // [J] la console recompte les vagues sur les armes (la file perd le groupe 3) ; la vague a placer, la vague prise ou la
  // carte perdent leur groupe ; le toast redit « vague » ; Modifier et la bulle du compte recomptent sur les armes, oublient
  // le nombre de groupes choisi ou la part de chaque groupe au laser.
  { nom: 'vagues-sur-les-armes', lettre: 'J', fichier: CORE, de: '    const count = Math.max(getLaserWaveCount(joueurs), ...dites);', vers: '    const count = getLaserWaveCount(joueurs);' },
  { nom: 'a-placer-sans-groupe', lettre: 'J', fichier: CORE, de: "      players: Number(unit.players || getReservationActivityPlayers(reservation, 'laser_game') || 0),\n      ...laserSousGroupe(unit),\n", vers: "      players: Number(unit.players || getReservationActivityPlayers(reservation, 'laser_game') || 0),\n" },
  { nom: 'vague-prise-sans-groupe', lettre: 'J', fichier: CORE, de: '      unitKey: key,\n      ...laserSousGroupe(placed),\n', vers: '      unitKey: key,\n' },
  { nom: 'jeton-sans-groupe', lettre: 'J', fichier: APP, de: 'waveCount: p.waveCount, sousGroupe: p.sousGroupe, sousGroupes: p.sousGroupes })', vers: 'waveCount: p.waveCount })' },
  { nom: 'groupe-dit-vague', lettre: 'J', fichier: APP, de: '  if (Number(c.sousGroupe) > 0) parts.push(`groupe ${Number(c.sousGroupe)}/${Number(c.sousGroupes) || vagues}`);\n  else if (vagues > 1)', vers: '  if (vagues > 1)' },
  { nom: 'carte-en-vague', lettre: 'J', fichier: APP, de: '${Number(w.sousGroupe) > 0 ? ` · G${Number(w.sousGroupe)}/${Number(w.sousGroupes) || vagues}` : vagues > 1 ?', vers: '${vagues > 1 ?' },
  { nom: 'toast-en-vague', lettre: 'J', fichier: CORE, de: "    const unitLabel = Number(unit.sousGroupe) > 0 ? `Laser du groupe ${unit.sousGroupe}/${unit.sousGroupes || unit.waveCount} placé`\n      : ", vers: '    const unitLabel = ' },
  { nom: 'modifier-sur-les-armes', lettre: 'J', fichier: APP, de: '  if (!partenaires.length) return vaguesLaserEnMots(joueurs, r, e && e.pax);', vers: '  if (!partenaires.length) return vaguesLaserEnMots(joueurs);' },
  // [J] le planning laser refuse le depart commun de deux groupes du grand groupe (son verdict, ou son controle au placement).
  { nom: 'depart-commun-refuse', lettre: 'J', fichier: APP, de: '  const dessus = siennes.find(w => w.start < fin - 0.001 && w.end > d.t + 0.001 && !memeDepart(w));', vers: '  const dessus = siennes.find(w => w.start < fin - 0.001 && w.end > d.t + 0.001);' },
  { nom: 'depart-commun-refuse-au-placement', lettre: 'J', fichier: CORE, de: '    if (overlapping.some(window => Number(window.reservation?.id) === Number(reservation.id) && !memeDepart(window))) {', vers: '    if (overlapping.some(window => Number(window.reservation?.id) === Number(reservation.id))) {' },
  { nom: 'bulle-sur-les-armes', lettre: 'J', fichier: APP, de: 'vaguesLaserEnMots(joueursLaser, r, n) };', vers: 'vaguesLaserEnMots(joueursLaser) };' },
  { nom: 'nombre-de-groupes-oublie', lettre: 'J', fichier: APP, de: '  const nombre = Math.min(12, groupe, voulu >= 2 ? Math.max(voulu, coupe) : coupe);', vers: '  const nombre = Math.min(12, groupe, coupe);' },
  { nom: 'part-du-laser-oubliee', lettre: 'J', fichier: APP, de: '  if (n >= groupe) return tailles;', vers: '  return tailles;' },
  // [K] Modifier d un grand groupe : les pistes d un seul service contre celles du dossier (tout refuse, jusqu au nom) ;
  // la partie a placer sans sa derniere heure (« Groupe 3 : donnez l’heure du laser. ») ; la partie reposee a cette heure
  // au lieu de rester a placer ; le retrait qui oublie la derniere heure du groupe.
  { nom: 'pistes-d-un-service-seul', lettre: 'K', serveur: true, fichier: 'lib/database.js', de: '    && (Math.max(...serviceBlocks.map((block) => Number(block.requiredLanes))) === requiredCount || (enSousGroupes && pistesEnMemeTemps === requiredCount))', vers: '    && (Math.max(...serviceBlocks.map((block) => Number(block.requiredLanes))) === requiredCount)' },
  { nom: 'partie-a-placer-sans-heure', lettre: 'K', serveur: true, fichier: OPS, de: '  const heures = lues && enAttente.size ? lues.map((siennes, rang) => (enAttente.has(rang + 1) && !siennes.laser_game ? { ...siennes, ...derniere(rang) } : siennes)) : lues;', vers: '  const heures = lues;' },
  { nom: 'partie-a-placer-reposee', lettre: 'K', serveur: true, fichier: OPS, de: '    if (!enAttente.length) return plan;', vers: '    if (enAttente.length) return plan;' },
  { nom: 'derniere-heure-oubliee', lettre: 'K', serveur: true, fichier: MOUVEMENT, de: 'heures: heures.map((siennes, rang) => ({ ...(avant[rang] || {}), ...siennes })), auxHeures: true };', vers: 'heures, auxHeures: true };' },
];

// ---------------------------------------------------------------------------
// LES CONTRE-PREUVES : un fil par mutation, trois a la fois, chacun sur son port.
// ---------------------------------------------------------------------------
function lancer(args, port) {
  return new Promise((ok) => {
    const fil = spawn(process.execPath, [__filename, ...args], { cwd: ROOT, env: { ...process.env, PINLANE_GRANDS_GROUPES_PORT: String(port) } });
    let sortie = '';
    fil.stdout.on('data', (d) => { sortie += d; });
    fil.stderr.on('data', (d) => { sortie += d; });
    const garde = setTimeout(() => fil.kill(), 600000);
    fil.on('close', (code) => { clearTimeout(garde); ok({ code, sortie }); });
  });
}

if (argument('contre-preuves')) {
  (async () => {
    const temoin = await lancer([], PORT);
    if (temoin.code !== 0) {
      console.log(temoin.sortie.split('\n').filter((l) => /ROUGE|Error|erreur/.test(l)).slice(0, 12).join('\n'));
      console.log('\ngrands-groupes-check --contre-preuves: le gate est rouge sans mutation, aucune contre-preuve ne compte');
      process.exit(1);
    }
    const voulues = typeof argument('contre-preuves') === 'string' ? argument('contre-preuves').split(',') : null;
    const file = MUTATIONS.filter((m) => !voulues || voulues.includes(m.nom));
    let rates = 0;
    const POOL = 3;
    let suivant = 0;
    const travailleur = async (rang) => {
      while (suivant < file.length) {
        const m = file[suivant];
        suivant += 1;
        // eslint-disable-next-line no-await-in-loop
        const r = await lancer([`--mutation=${m.nom}`, `--seul=${m.lettre}`], PORT + 1 + rang);
        const mord = r.code === 1 && r.sortie.includes(`ROUGE [${m.lettre}]`) && !/ANCRE DE MUTATION|ancre absente/.test(r.sortie);
        if (!mord) rates += 1;
        console.log(`${mord ? 'TUEE   ' : 'VIVANTE'} ${m.nom} (attendu : ROUGE [${m.lettre}], sortie ${r.code})${mord ? '' : `\n${r.sortie.split('\n').filter((l) => /ROUGE|ANCRE|ancre|Error/.test(l)).slice(0, 6).join('\n')}`}`);
      }
    };
    await Promise.all(Array.from({ length: POOL }, (_, rang) => travailleur(rang)));
    console.log(rates
      ? `\ngrands-groupes-check --contre-preuves: ${rates} mutation(s) vivante(s)`
      : `\ngrands-groupes-check --contre-preuves: ALL OK - ${file.length} mutations, chaque regle retiree fait rougir sa lettre`);
    process.exit(rates ? 1 : 0);
  })();
} else {
  principal().catch((error) => { console.error(error); process.exit(1); });
}

async function principal() {
  const nomMutation = typeof argument('mutation') === 'string' ? argument('mutation') : '';
  const mutation = nomMutation ? MUTATIONS.find((m) => m.nom === nomMutation) : null;
  if (nomMutation && !mutation) { console.error(`mutation inconnue : ${nomMutation}`); process.exit(2); }
  // La console mutee : le texte servi au navigateur. L ancre doit exister une fois, sinon la contre-preuve
  // ne prouverait rien.
  const transformer = (rel, texte) => {
    if (!mutation || mutation.serveur || mutation.fichier !== rel) return texte;
    const t = lf(texte);
    if (t.split(mutation.de).length !== 2) { console.log(`ANCRE DE MUTATION absente ou multiple (${mutation.nom}) dans ${rel}`); process.exit(2); }
    return t.split(mutation.de).join(mutation.vers);
  };
  if (mutation && !mutation.serveur) transformer(mutation.fichier, fs.readFileSync(path.join(ROOT, mutation.fichier), 'utf8'));

  // La base en memoire et le faux 'pg' s installent au require ; le serveur (mute ou non) se monte avant
  // tout autre require du depot.
  const B = require('./reserver-banc.js');
  const FX = require('./planning-v3-fixtures.js');
  const HORLOGE_SERVEUR = { fichier: 'lib/booking-config.js', de: 'function getBusinessNowParts(date = new Date()) {', vers: 'function getBusinessNowParts(date = new Date(globalThis.__comptoirMaintenant || Date.now())) {' };
  const serveur = B.monter({
    mutations: [HORLOGE_SERVEUR, ...(mutation && mutation.serveur ? [{ fichier: mutation.fichier, de: mutation.de, vers: mutation.vers }] : [])],
    session: B.sessionDuRole('direction', { nom: 'Accueil' }),
  });
  FX.APPAREILS.comptoir = FX.APPAREILS.comptoir || { viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1, locale: 'fr-BE' };

  let rouges = 0;
  let lettre = '';
  const section = (titre) => { lettre = (titre.match(/^\[([A-Z])\]/) || [])[1] || ''; console.log(`\n${titre}`); };
  const ok = (condition, quoi, detail) => {
    if (condition) { console.log(`ok    ${quoi}`); return; }
    rouges += 1;
    console.log(`ROUGE [${lettre}] ${quoi}${detail !== undefined ? ` : ${String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 500)}` : ''}`);
  };

  const HEURE = '15:10';
  function ligneDepuis(r) {
    return {
      id: r.id, center_id: r.centerId || 'libramont', channel: r.channel || 'staff', name: String(r.name).replace('DÉMO · ', ''), phone: r.phone || '', email: r.email || '',
      date: r.date, start_time: r.startTime, duration: r.duration, total_duration: r.totalDuration ?? r.duration, lanes: (r.lanes || []).map(Number),
      pax: r.pax, status: r.status, base_price: r.basePrice, price: r.price, type: r.type, formule_id: r.formuleId || null, label: r.label,
      occasion: r.occasion || '', extras: r.extras || [], payment_method: r.paymentMethod || null, notes: r.notes || '',
      ops_plan: r.opsPlan || null, risk_level: r.riskLevel || '', risk_score: r.riskScore ?? null, validation_status: r.validationStatus || 'confirmed',
      activity_progress: r.activityProgress || {}, program: r.program || null, companions: r.companions || 0,
      created_at: new Date(r.createdAt), updated_at: new Date(r.updatedAt),
      acquisition: r.acquisition ?? null, client_key: r.clientKey || '', paid_at: r.paidAt ? new Date(r.paidAt) : null,
      amount_paid: r.amountPaid ?? null, discount_reason: r.discountReason || '', absent_at: r.absentAt ? new Date(r.absentAt) : null,
    };
  }
  function semer(fixture) {
    const fx = FX.lireFixture(fixture);
    globalThis.__comptoirMaintenant = FX.instant(fx.staffState.date, HEURE).getTime();
    B.semer(fx.staffState.reservations.map(ligneDepuis));
    return fx;
  }
  const blocsDe = (r) => ((r && r.ops_plan && r.ops_plan.resourceBlocks) || []).filter((b) => ['bowling_lane', 'laser_arena'].includes(b.resourceType));
  const seSuivent = (l) => Array.isArray(l) && l.length > 0 && l.map(Number).sort((a, b) => a - b).every((p, i, t) => i === 0 || p === t[i - 1] + 1);
  const enMin = (h) => { const [a, b] = String(h).split(':').map(Number); return a * 60 + b; };
  // Un sous-groupe n est jamais a deux endroits : ses passages ne se chevauchent pas.
  const sansChevauchement = (blocs) => {
    const parGroupe = new Map();
    blocs.forEach((b) => { const n = Number(b.sousGroupe) || 0; if (!parGroupe.has(n)) parGroupe.set(n, []); parGroupe.get(n).push(b); });
    return [...parGroupe.values()].every((liste) => liste.sort((x, y) => enMin(x.startTime) - enMin(y.startTime))
      .every((b, i, t) => i === 0 || enMin(b.startTime) >= enMin(t[i - 1].endTime)));
  };
  const resume = (blocs) => blocs.map((b) => `${b.resourceType === 'bowling_lane' ? 'B' : 'L'}${b.sousGroupe || 0}@${b.startTime}x${b.players}${b.lanes && b.lanes.length ? `[${b.lanes.join(',')}]` : ''}`).sort().join(' ');
  const sansPistes = (t) => t.replace(/\[[^\]]*\]/g, '');

  // -------------------------------------------------------------------------
  // LA CONSOLE, sur une fixture : la session de direction, les appels du comptoir au vrai handler.
  // -------------------------------------------------------------------------
  let browser = null;
  async function ouvrir(fixture) {
    semer(fixture);
    const m = await FX.monter(browser, {
      fixture, appareil: 'comptoir', theme: 'light', port: PORT, heure: HEURE,
      avantChargement: async (page) => {
        await page.exposeFunction('__fixtureServeur', async (corps) => serveur.appeler('PATCH', '/api/staff-reservations', corps));
        await page.exposeFunction('__vraiAppel', async (methode, url, corps) => serveur.appeler(methode, url, corps));
      },
    });
    const { page } = m;
    page.setDefaultTimeout(12000);
    await page.evaluate(() => {
      const avant = window.fetch;
      window.__appels = [];
      window.fetch = async (input, init) => {
        init = init || {};
        const u = new URL(typeof input === 'string' ? input : input.url, location.origin);
        const me = String(init.method || (typeof input === 'object' && input.method) || 'GET').toUpperCase();
        const json = (corps, status = 200) => new Response(JSON.stringify(corps), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
        if (u.pathname === '/api/staff-reservations' && me !== 'PATCH') {
          const corps = init.body ? JSON.parse(init.body) : undefined;
          window.__appels.push({ me, dryRun: Boolean(corps && corps.dryRun) });
          const rep = await window.__vraiAppel(me, u.pathname + u.search, corps);
          const j = rep.json || {};
          if (me === 'POST' && !(corps && corps.dryRun) && j.reservation) {
            const jour = j.reservation.date;
            (window.__FIXTURE__.jours[jour] = window.__FIXTURE__.jours[jour] || []).push(j.reservation);
          }
          return json(j, rep.statut);
        }
        return avant(input, init);
      };
    });
    await page.waitForSelector('.btn-new', { timeout: 15000 });
    const avant = new Set([...B.base.reservations.keys()]);
    return { ...m, avant };
  }
  const texte = (page, sel) => page.evaluate((s) => Array.from(document.querySelectorAll(s)).map((e) => e.textContent.replace(/\s+/g, ' ').trim()).join(' | '), sel);
  const capture = async (page, nom) => {
    if (!argument('captures')) return;
    fs.mkdirSync(CAPTURES, { recursive: true });
    await page.screenshot({ path: path.join(CAPTURES, `${nom}.png`) });
  };
  // Le nombre du groupe tape dans « Autre », comme au comptoir, puis la tabulation qui le valide : la
  // fenetre l a pris quand son groupe le dit et que les heures du bowling se montrent. Rien n est
  // suppose des compteurs par activite (ils peuvent devenir des champs a taper).
  async function soixante(page, n = 60) {
    await page.locator('.btn-new').first().click();
    await page.waitForSelector('#qbPax');
    await page.locator('#qbPax').click();
    // (ce que le champ contenait part sous la frappe, qu il se selectionne au focus ou non)
    await page.keyboard.press('Control+A');
    await page.keyboard.type(String(n));
    await page.keyboard.press('Tab');
    await page.waitForFunction((nb) => typeof quickBookState !== 'undefined' && quickBookState && Number(quickBookState.pax) === nb
      && Boolean(document.querySelector('.rs-seance [data-activite="bowling"][data-heure]')), n, { timeout: 12000 });
  }
  const pret = (page) => page.waitForFunction(() => { const b = document.querySelector('#rvCreer'); return b && b.dataset.pret === '1'; }, null, { timeout: 15000 });
  async function toucher(page, sel, attente = 0) {
    await page.locator(sel).first().click();
    if (attente) await page.waitForTimeout(attente);
  }
  // Le groupe, le bowling a son heure, puis le laser ajoute : le ticket attend le plan du serveur.
  async function bowlingEtLaser(page, n, heure) {
    await soixante(page, n);
    await toucher(page, `.rs-seance [data-activite="bowling"][data-heure="${heure}"]`);
    await pret(page).catch(() => {});
    await toucher(page, '#rsAjout-laser_game');
    await page.waitForFunction(() => /\d{2}:\d{2}/.test((document.querySelector('#rsL-a-laser_game') || {}).textContent || ''), null, { timeout: 15000 }).catch(() => {});
    await pret(page).catch(() => {});
  }
  // L option « Faire tourner » du ticket : son texte, ce qu elle choisirait, et son allure (un bouton
  // encadre : fond clair ou transparent, un bord, jamais souligne).
  const option = (page) => page.evaluate(() => {
    const b = document.querySelector('#rsGgOption');
    if (!b) return null;
    const st = getComputedStyle(b);
    const rgb = (st.backgroundColor.match(/\d+(\.\d+)?/g) || []).map(Number);
    const transparent = rgb.length >= 4 && rgb[3] < 0.1;
    const bord = (st.borderTopColor.match(/\d+(\.\d+)?/g) || []).map(Number);
    return {
      texte: b.textContent.replace(/\s+/g, ' ').trim(), tourne: b.dataset.tourne, tag: b.tagName,
      clair: transparent || (rgb.length >= 3 && (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) > 128),
      bord: st.borderTopStyle !== 'none' && !(bord.length >= 4 && bord[3] < 0.1) ? parseFloat(st.borderTopWidth) || 0 : 0,
      souligne: /underline/.test(st.textDecorationLine),
    };
  });
  const attendreOption = (page, tourne) => page.waitForFunction((t) => { const b = document.querySelector('#rsGgOption'); return Boolean(b && b.dataset.tourne === t); }, tourne, { timeout: 15000 }).catch(() => {});
  const tournent = (page) => page.waitForFunction(() => /2 groupes qui tournent/.test((document.querySelector('#rsL-groupes') || {}).textContent || ''), null, { timeout: 15000 }).catch(() => {});
  async function nouveaux(page, avant) {
    for (let i = 0; i < 80; i += 1) {
      const lignes = [...B.base.reservations.entries()].filter(([id]) => !avant.has(id)).map(([, r]) => r);
      if (lignes.length) return lignes;
      await page.waitForTimeout(100);
    }
    return [];
  }
  async function creer(page, avant) {
    await page.locator('#qbPhone').fill('0470 12 34 56');
    await page.waitForTimeout(300);
    await pret(page);
    await toucher(page, '#rvCreer');
    const lignes = await nouveaux(page, avant);
    return lignes[0] || null;
  }
  // La ligne du dossier au planning : ce que chaque case dit au survol (« Bowling de 15:30 à 16:30 · groupe 1 »).
  async function casesDuPlanning(page, id) {
    await page.waitForSelector(`.gf-r[data-gf-id="${id}"]`, { timeout: 15000 });
    return page.evaluate((i) => Array.from(document.querySelectorAll(`.gf-r[data-gf-id="${i}"] .gf-x`)).map((x) => x.getAttribute('title') || ''), id);
  }
  async function ouvrirLaFiche(page, id) {
    await page.locator(`.gf-r[data-gf-id="${id}"] .gf-nom__t`).first().click();
    await page.waitForSelector('.fx-programme', { timeout: 15000 });
    await page.waitForTimeout(400);
    return {
      groupes: await texte(page, '#ficheGroupes'),
      programme: await texte(page, '.fx-programme'),
    };
  }
  // Reserver tient sur un ecran de 1366 x 768 (la mesure de scripts/comptoir-check.js) : la colonne de
  // gauche ne defile pas, la fenetre reste dans l ecran.
  const tientALEcran = (page) => page.evaluate(() => {
    const col = document.querySelector('#rsCol');
    const fenetre = document.querySelector('.qb-modal.rv.rs');
    const r = fenetre ? fenetre.getBoundingClientRect() : { top: -1, bottom: 1e6 };
    return { col: col ? col.scrollHeight - col.clientHeight : 99, dehors: r.top < 0 || r.bottom > window.innerHeight ? 1 : 0 };
  });

  const navigateur = ['A', 'B', 'C', 'E', 'F', 'H', 'I', 'J', 'K'].some(joue);
  if (navigateur) {
    const { chromium } = require('playwright-core');
    browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  }
  const http = navigateur ? await FX.servir({ port: PORT, transformer }) : null;
  try {
    // =======================================================================
    if (joue('A')) {
      section('[A] 60 JOUEURS AU BOWLING SEUL : DEUX GROUPES L UN APRES L AUTRE');
      const { ctx, page, erreurs, avant } = await ouvrir('vide');
      try {
        await soixante(page);
        await toucher(page, '.rs-seance [data-activite="bowling"][data-heure="15:30"]');
        await pret(page).catch(() => {});
        const groupes = await texte(page, '#rsL-groupes');
        const bowling = await texte(page, '#rsL-a-bowling');
        ok(/2 groupes, l’un après l’autre/.test(groupes) && /30 et 30 joueurs/.test(groupes), '[A] le ticket dit « 2 groupes, l’un après l’autre », 30 et 30 joueurs', groupes);
        ok(/Groupe 1 à 15:30, groupe 2 à 16:30/.test(bowling) && /pistes \d à \d/.test(bowling) && /390 €/.test(bowling), '[A] la ligne du bowling dit chaque groupe a son heure, ses pistes et 390 €', bowling);
        const creerDit = await texte(page, '#rvCreer');
        ok(/Créer à 15:30/.test(creerDit), '[A] « Créer à 15:30 » : le plan tient (dix pistes sur huit refusaient chaque heure)', creerDit);
        await capture(page, '60-bowling-ticket');
        const r = await creer(page, avant);
        const blocs = blocsDe(r);
        const bowlings = blocs.filter((b) => b.resourceType === 'bowling_lane').sort((x, y) => enMin(x.startTime) - enMin(y.startTime));
        ok(r && Number(r.pax) === 60 && Number(r.price) === 390, '[A] le dossier en base : 60 joueurs, 390 €', r && { pax: r.pax, price: r.price });
        ok(bowlings.length === 2 && bowlings.map((b) => `${b.sousGroupe}@${b.startTime}-${b.endTime}x${b.players}`).join(' ') === '1@15:30-16:30x30 2@16:30-17:30x30',
          '[A] deux services de 30 joueurs, groupe 1 a 15:30, groupe 2 a 16:30', resume(blocs));
        ok(bowlings.every((b) => (b.lanes || []).length === 5 && seSuivent(b.lanes)), '[A] cinq pistes cote a cote pour chaque groupe', bowlings.map((b) => b.lanes));
        const gg = r && r.ops_plan && r.ops_plan.grandGroupe;
        ok(gg && gg.tourne === false && JSON.stringify(gg.tailles) === '[30,30]', '[A] le plan garde ses groupes (tailles 30 et 30, l un apres l autre)', gg);
        const cases = await casesDuPlanning(page, r.id);
        ok(cases.some((t) => /^Bowling de 15:30 à 16:30 · groupe 1 · pistes/.test(t)) && cases.some((t) => /^Bowling de 16:30 à 17:30 · groupe 2 · pistes/.test(t)),
          '[A] le planning dit « groupe 1 » et « groupe 2 » dans les cases du bowling', cases);
        await capture(page, '60-bowling-planning');
        const fiche = await ouvrirLaFiche(page, r.id);
        ok(/2 groupes, l’un après l’autre/.test(fiche.groupes) && /Groupe 1, 30 joueurs : bowling 15:30/.test(fiche.groupes) && /Groupe 2, 30 joueurs : bowling 16:30/.test(fiche.groupes),
          '[A] la fiche dit les groupes, un par ligne', fiche.groupes);
        ok(/pistes \d à \d · groupe 1/.test(fiche.programme) && /pistes \d à \d · groupe 2/.test(fiche.programme), '[A] chaque etape de la fiche porte son groupe', fiche.programme);
        await capture(page, '60-bowling-fiche');
        ok(erreurs.length === 0, '[*] zero erreur JavaScript (A)', erreurs.slice(0, 3).join(' | '));
      } finally { await ctx.close(); }
    }

    // =======================================================================
    if (joue('B')) {
      section('[B] 60 JOUEURS AU BOWLING ET AU LASER : LE PLAN D AVANT TIENT, LES GROUPES TOURNENT AU CHOIX');
      const { ctx, page, erreurs, avant } = await ouvrir('vide');
      try {
        await bowlingEtLaser(page, 60, '15:30');
        await attendreOption(page, '1');
        // Sans toucher : le plan d avant (le bowling en deux services, puis le laser), au prix d avant.
        const groupesAvant = await texte(page, '#rsL-groupes');
        const bowlingAvant = await texte(page, '#rsL-a-bowling');
        const laserAvant = await texte(page, '#rsL-a-laser_game');
        const totalAvant = await texte(page, '#rvTotalPied');
        ok(groupesAvant === '' && /Groupe 1 à 15:30, groupe 2 à 16:30/.test(bowlingAvant) && /17:30/.test(laserAvant) && /18:00/.test(laserAvant) && /990 €/.test(totalAvant),
          '[B] sans toucher, le plan d avant : le bowling en deux services (15:30, 16:30), puis le laser (17:30, 18:00), 990 €', { groupesAvant, bowlingAvant, laserAvant, totalAvant });
        const propose = await option(page);
        ok(propose && propose.tourne === '1' && propose.texte === 'Faire tourner 2 groupes : fin à 17:30, 990 €', '[B] le ticket propose « Faire tourner 2 groupes : fin à 17:30, 990 € »', propose);
        ok(propose && propose.tag === 'BUTTON' && propose.clair && propose.bord >= 1 && !propose.souligne, '[B] l option est un bouton encadre, ni noir ni lien', propose);
        const ecranOption = await tientALEcran(page);
        ok(ecranOption.col <= 1 && !ecranOption.dehors, '[B] Reserver tient a l ecran en 1366 x 768 (le plan d avant et l option)', ecranOption);
        await capture(page, '60-bowling-laser-option');
        // Le staff choisit : les deux groupes de 30 tournent.
        await toucher(page, '#rsGgOption');
        await tournent(page);
        await page.waitForFunction(() => /Groupe 2 à 15:30/.test((document.querySelector('#rsL-a-laser_game') || {}).textContent || ''), null, { timeout: 15000 }).catch(() => {});
        await pret(page).catch(() => {});
        await attendreOption(page, '0');
        const groupes = await texte(page, '#rsL-groupes');
        const bowling = await texte(page, '#rsL-a-bowling');
        const laser = await texte(page, '#rsL-a-laser_game');
        const total = await texte(page, '#rvTotalPied');
        ok(/2 groupes qui tournent/.test(groupes) && /30 et 30 joueurs/.test(groupes), '[B] touche : le ticket dit « 2 groupes qui tournent », 30 et 30 joueurs', groupes);
        ok(/Groupe 1 à 15:30, groupe 2 à 16:30/.test(bowling) && /390 €/.test(bowling), '[B] bowling : groupe 1 a 15:30, groupe 2 a 16:30, 390 €', bowling);
        ok(/Groupe 2 à 15:30, groupe 1 à 16:30/.test(laser) && /600 €/.test(laser), '[B] laser : groupe 2 a 15:30, groupe 1 a 16:30, 600 €', laser);
        ok(/990 €/.test(total), '[B] total 990 €, le prix que l option affichait', total);
        const inverse = await option(page);
        ok(inverse && inverse.tourne === '0' && inverse.texte === 'Ne pas faire tourner : fin à 18:25, 990 €', '[B] choisis, le ticket propose l inverse : « Ne pas faire tourner : fin à 18:25, 990 € »', inverse);
        const tourne = await texte(page, '#rsTourne-laser_game');
        ok(/Groupe 2 à 15:30, groupe 1 à 16:30\./.test(tourne), '[B] le bloc du laser dit quel groupe y joue a quelle heure', tourne);
        const bouton = await page.evaluate(() => {
          const b = document.querySelector('#rsTourneRegler-laser_game');
          if (!b) return null;
          const st = getComputedStyle(b);
          const rgb = (st.backgroundColor.match(/\d+(\.\d+)?/g) || []).map(Number);
          return { tag: b.tagName, fond: st.backgroundColor, clair: rgb.length >= 3 && (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) > 128, bord: parseFloat(st.borderTopWidth) || 0, souligne: /underline/.test(st.textDecorationLine) };
        });
        ok(bouton && bouton.tag === 'BUTTON' && bouton.clair && bouton.bord >= 1 && !bouton.souligne, '[B] « Régler les groupes » est un bouton encadre, ni noir ni lien', bouton);
        const ecranActivites = await tientALEcran(page);
        ok(ecranActivites.col <= 1 && !ecranActivites.dehors, '[B] Reserver tient a l ecran en 1366 x 768 (activites)', ecranActivites);
        await capture(page, '60-bowling-laser-ticket');
        await toucher(page, '#rsTourneRegler-laser_game');
        // (la page refaite le 2026-11-23 : une rangee par groupe, chaque case porte son groupe, son activite et
        // son heure, rsCaseDuGroupeHtml)
        await page.waitForSelector('#rsGgListe', { timeout: 15000 });
        const cellule = (g, a, h) => `#rsGgListe .rs-gg-c[data-groupe="${g}"][data-activite="${a}"][data-heure-groupe="${h}"]`;
        const grille = await page.evaluate((sels) => sels.map((s) => Boolean(document.querySelector(s))), [cellule(1, 'bowling', '15:30'), cellule(1, 'laser_game', '16:30'), cellule(2, 'laser_game', '15:30'), cellule(2, 'bowling', '16:30')]);
        ok(grille.every(Boolean), '[B] la page des groupes : groupe 1 bowling 15:30 puis laser 16:30, groupe 2 laser 15:30 puis bowling 16:30', grille);
        const phrase = await texte(page, '#rsGgPhrase');
        ok(/Le groupe 1 au bowling pendant que le groupe 2 joue au laser, puis ils échangent\./.test(phrase), '[B] la phrase du plan : le groupe 1 au bowling pendant que le groupe 2 joue au laser', phrase);
        // (les joueurs de chaque groupe se reglent d un « + » et d un « − », le total se lit au pied : un groupe
        // de 30 avec 30 armes n a pas de « + », son « − » reste)
        const pas = await page.evaluate(() => Array.from(document.querySelectorAll('#rsGgListe button[data-groupe="1"]')).map((b) => `${b.getAttribute('aria-label')}=${b.disabled ? 'off' : 'on'}`));
        ok(pas.includes('Joueurs du groupe 1, un de plus=off') && pas.includes('Joueurs du groupe 1, un de moins=on'), '[B] 30 et 30 avec 30 armes : pas un de plus au groupe 1, un de moins se peut', pas);
        const ecranGroupes = await tientALEcran(page);
        ok(ecranGroupes.col <= 1 && !ecranGroupes.dehors, '[B] la page des groupes tient a l ecran en 1366 x 768', ecranGroupes);
        await capture(page, '60-bowling-laser-groupes');
        await toucher(page, '#rsGgPremier-laser_game');
        await page.waitForSelector(cellule(1, 'laser_game', '15:30'), { timeout: 15000 }).catch(() => {});
        await pret(page).catch(() => {});
        const apres = await page.evaluate((sels) => sels.map((s) => Boolean(document.querySelector(s))), [cellule(1, 'laser_game', '15:30'), cellule(1, 'bowling', '16:30'), cellule(2, 'bowling', '15:30'), cellule(2, 'laser_game', '16:30')]);
        ok(apres.every(Boolean), '[B] « Groupe 1 : Laser » d un toucher : le moteur recalcule, le groupe 1 commence au laser', apres);
        const bowlingApres = await texte(page, '#rsL-a-bowling');
        ok(/Groupe 2 à 15:30, groupe 1 à 16:30/.test(bowlingApres), '[B] le ticket suit : bowling groupe 2 a 15:30, groupe 1 a 16:30', bowlingApres);
        await capture(page, '60-bowling-laser-groupe-1-au-laser');
        const r = await creer(page, avant);
        const blocs = blocsDe(r);
        ok(r && Number(r.pax) === 60 && Number(r.price) === 990, '[B] le dossier en base : 60 joueurs, 990 €', r && { pax: r.pax, price: r.price });
        ok(resume(blocs) === resume([
          { resourceType: 'laser_arena', sousGroupe: 1, startTime: '15:30', players: 30 },
          { resourceType: 'bowling_lane', sousGroupe: 1, startTime: '16:30', players: 30, lanes: (blocs.find((b) => b.resourceType === 'bowling_lane' && b.sousGroupe === 1) || {}).lanes },
          { resourceType: 'bowling_lane', sousGroupe: 2, startTime: '15:30', players: 30, lanes: (blocs.find((b) => b.resourceType === 'bowling_lane' && b.sousGroupe === 2) || {}).lanes },
          { resourceType: 'laser_arena', sousGroupe: 2, startTime: '16:30', players: 30 },
        ]) && blocs.length === 4, '[B] quatre passages : groupe 1 laser 15:30 puis bowling 16:30, groupe 2 bowling 15:30 puis laser 16:30, 30 joueurs chacun', resume(blocs));
        ok(sansChevauchement(blocs), '[B] aucun groupe n est a deux endroits a la fois', resume(blocs));
        ok(blocs.filter((b) => b.resourceType === 'bowling_lane').every((b) => (b.lanes || []).length === 5 && seSuivent(b.lanes)), '[B] cinq pistes cote a cote par groupe au bowling', blocs.map((b) => b.lanes));
        const gg = r && r.ops_plan && r.ops_plan.grandGroupe;
        ok(gg && gg.tourne === true && gg.premier === 'laser_game' && JSON.stringify(gg.tailles) === '[30,30]', '[B] le plan garde ses groupes : ils tournent, le groupe 1 commence au laser', gg);
        const cases = await casesDuPlanning(page, r.id);
        ok(cases.some((t) => /^Bowling de 15:30 à 16:30 · groupe 2/.test(t)) && cases.some((t) => /^Bowling de 16:30 à 17:30 · groupe 1/.test(t))
          && cases.some((t) => /^Laser à 15:30 · groupe 1/.test(t)) && cases.some((t) => /^Laser à 16:30 · groupe 2/.test(t)),
        '[B] le planning dit le groupe dans chaque case, bowling et laser', cases);
        await capture(page, '60-bowling-laser-planning');
        const fiche = await ouvrirLaFiche(page, r.id);
        ok(/2 groupes qui tournent/.test(fiche.groupes) && /Groupe 1, 30 joueurs : laser 15:30, bowling 16:30/.test(fiche.groupes) && /Groupe 2, 30 joueurs : bowling 15:30, laser 16:30/.test(fiche.groupes),
          '[B] la fiche dit qui joue quoi et quand, groupe par groupe', fiche.groupes);
        await capture(page, '60-bowling-laser-fiche');
        // Le groupe arrive a 58 (« Ils sont 60 », deux fois un de moins, Enregistrer) : le meme moteur
        // refait le plan, les deux groupes et leur ordre restent, 29 et 29, 970 €.
        await page.locator('.fx-programme .fz-compte').first().click();
        await page.waitForSelector('#comptePop', { timeout: 12000 });
        await page.locator('#comptePop [data-compte-pas="-1"]').click();
        await page.locator('#comptePop [data-compte-pas="-1"]').click();
        await page.locator('#comptePop .compte-pop__ok').click();
        let apresCompte = null;
        for (let i = 0; i < 80 && !(apresCompte && Number(apresCompte.pax) === 58); i += 1) {
          await page.waitForTimeout(100);
          apresCompte = B.base.reservations.get(Number(r.id)) || B.base.reservations.get(r.id);
        }
        const blocs58 = blocsDe(apresCompte);
        const gg58 = apresCompte && apresCompte.ops_plan && apresCompte.ops_plan.grandGroupe;
        ok(apresCompte && Number(apresCompte.pax) === 58 && Number(apresCompte.price) === 970
          && sansPistes(resume(blocs58)) === 'B1@16:30x29 B2@15:30x29 L1@15:30x29 L2@16:30x29' && gg58 && gg58.premier === 'laser_game',
        '[B] « Ils sont 58 » : le moteur refait le plan, deux groupes de 29 qui tournent dans le meme ordre, 970 €', apresCompte && `${apresCompte.pax} ${apresCompte.price} ${resume(blocs58)} ${JSON.stringify(gg58)}`);
        await page.waitForFunction(() => /Groupe 1, 29 joueurs : laser 15:30, bowling 16:30/.test((document.querySelector('#ficheGroupes') || {}).textContent || ''), null, { timeout: 12000 }).catch(() => {});
        const fiche58 = await texte(page, '#ficheGroupes');
        ok(/Groupe 1, 29 joueurs : laser 15:30, bowling 16:30/.test(fiche58) && /Groupe 2, 29 joueurs : bowling 15:30, laser 16:30/.test(fiche58), '[B] la fiche suit : 29 et 29', fiche58);
        ok(erreurs.length === 0, '[*] zero erreur JavaScript (B)', erreurs.slice(0, 3).join(' | '));
      } finally { await ctx.close(); }
    }

    // =======================================================================
    if (joue('C')) {
      section('[C] LE PLAN IMPOSSIBLE LE DIT ET PROPOSE L HEURE OU TOUT LE GROUPE TIENT');
      const { ctx, page, erreurs, avant } = await ouvrir('normal');
      try {
        await soixante(page);
        await toucher(page, '.rs-seance [data-activite="bowling"][data-heure="19:30"]');
        await page.waitForTimeout(800);
        await toucher(page, '#rsAjout-laser_game');
        await page.waitForFunction(() => /Prendre/.test((document.querySelector('#rvCreer') || {}).textContent || ''), null, { timeout: 15000 }).catch(() => {});
        await page.waitForFunction(() => /manque/.test((document.querySelector('.rs-seance .rs-h[data-activite="bowling"][data-heure="19:30"]') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
        // Ni le plan d avant (il finirait apres la fermeture), ni les groupes qui tournent : c est le refus
        // des groupes qui se dit, le plan qui se poserait d office.
        const groupes = await texte(page, '#rsL-groupes');
        ok(/2 groupes qui tournent/.test(groupes) && !(await option(page)), '[C] le ticket dit le plan qui se poserait d office, « 2 groupes qui tournent », sans option a choisir', groupes);
        const rangee = await page.evaluate(() => Object.fromEntries(Array.from(document.querySelectorAll('.rs-seance .rs-h[data-activite="bowling"][data-heure]')).map((b) => [b.dataset.heure, b.textContent.replace(/\s+/g, ' ').trim()])));
        ok(/laser, manque 12 armes/.test(rangee['19:30'] || '') && /laser, manque/.test(rangee['20:00'] || '') && /reste/.test(rangee['18:00'] || ''),
          '[C] la rangee du bowling dit le verdict de tout le groupe : 19:30 « laser, manque 12 armes », 18:00 tient', rangee);
        const laser = await texte(page, '#rsL-a-laser_game');
        ok(/Laser à 19:30, il reste 18 places sur 30, il en faut 30/.test(laser), '[C] la ligne du laser dit pourquoi : il reste 18 places sur 30 a 19:30', laser);
        const dit = await texte(page, '.rs-tk .rs-sr');
        ok(/Laser à 19:30 impossible/.test(dit), '[C] le refus dit l heure qui coince (19:30), pas l heure d une ligne', dit);
        const bouton = await page.evaluate(() => { const b = document.querySelector('#rvCreer'); return b ? { texte: b.textContent.replace(/\s+/g, ' ').trim(), proche: b.dataset.proche || '' } : null; });
        ok(bouton && bouton.proche === '18:00' && /^Prendre 18:00/.test(bouton.texte), '[C] « Prendre 18:00 » : l heure la plus proche ou tout le groupe tient', bouton);
        ok([...B.base.reservations.keys()].every((id) => avant.has(id)), '[C] rien ne part avant « Créer »', [...B.base.reservations.keys()].length);
        await capture(page, '60-impossible-19h30');
        await toucher(page, '#rvCreer');
        await pret(page).catch(() => {});
        const repris = await texte(page, '#rvCreer');
        const bowling = await texte(page, '#rsL-a-bowling');
        const laserPris = await texte(page, '#rsL-a-laser_game');
        ok(/Créer à 18:00/.test(repris) && /Groupe 1 à 18:00, groupe 2 à 19:00/.test(bowling) && /Groupe 2 à 18:00, groupe 1 à 19:00/.test(laserPris),
          '[C] un toucher : « Créer à 18:00 », bowling groupe 1 a 18:00, groupe 2 a 19:00, le laser a l inverse', `${repris} | ${bowling} | ${laserPris}`);
        await capture(page, '60-impossible-pris-18h00');
        const r = await creer(page, avant);
        const blocs = blocsDe(r);
        ok(r && String(r.start_time).slice(0, 5) === '18:00' && Number(r.price) === 990
          && sansPistes(resume(blocs)) === 'B1@18:00x30 B2@19:00x30 L1@19:00x30 L2@18:00x30',
        '[C] le dossier nait a 18:00 : groupe 1 bowling 18:00 puis laser 19:00, groupe 2 laser 18:00 puis bowling 19:00', r && `${r.start_time} ${r.price} ${resume(blocs)}`);
        ok(erreurs.length === 0, '[*] zero erreur JavaScript (C)', erreurs.slice(0, 3).join(' | '));
      } finally { await ctx.close(); }
    }

    // =======================================================================
    if (joue('D')) {
      section('[D] LE SERVEUR : LES VRAIS JOUEURS, LES TAILLES, LE PLAN D AVANT, LA MODIFICATION, LE CANAL PUBLIC');
      const fx = semer('vide');
      const jour = fx.staffState.date;
      // (les sous-groupes imposes, comme les envoie le comptoir qui a touche « Faire tourner »)
      const corps = (pax, laser, extra = {}) => ({
        name: 'Groupe Essai', phone: '0470111222', email: '', notes: '', occasion: '', date: jour, startTime: '15:30', duration: 1, totalDuration: 2, lanes: [], pax, status: 'pending', type: 'visite', formuleId: '',
        program: [{ activityId: 'bowling', pax, participants: pax, duration: 1 }, { activityId: 'laser_game', pax, participants: laser, games: 1 }],
        laserGames: 0, extras: [], channel: 'staff', requiresLanes: true, centerId: 'libramont',
        preference: { activityOrder: ['bowling', 'laser_game'], preferredTimes: { bowling: '15:30', laser_game: '15:30' }, grandGroupe: { impose: true } },
        ...extra,
      });
      // (la demande du comptoir qui n a pas touche « Faire tourner » : les heures de toujours, le laser
      // apres le bowling ; `gg` null : aucune demande de grand groupe, le chemin d avant)
      const dAvant = (pax, heure, laserA, total, gg) => corps(pax, pax, {
        startTime: heure, totalDuration: total,
        preference: { activityOrder: ['bowling', 'laser_game'], preferredTimes: { bowling: heure, laser_game: laserA }, laserGameTimes: [laserA], laserPlacement: 'scheduled', ...(gg ? { grandGroupe: gg } : {}) },
      });
      const simuler = async (c) => (await serveur.appeler('POST', '/api/staff-reservations', { ...c, dryRun: true })).json.plan || {};
      const passages = (plan) => (plan.blocs || []).filter((b) => b.sousGroupe).map((b) => `${b.activite === 'bowling' ? 'B' : 'L'}${b.sousGroupe}x${b.joueursReels || b.joueurs}${b.activite === 'bowling' ? `/${(b.pistes || []).length}p` : ''}`).sort().join(' ');
      const signature = (plan) => (plan.blocs || []).map((b) => `${b.activite}@${b.debut}-${b.fin}x${b.joueursReels || b.joueurs}[${(b.pistes || []).join(',')}]#${b.sousGroupe || 0}`).sort().join(' ');

      const partiel = await simuler(corps(60, 40));
      ok(partiel.disponible && Number(partiel.prix) === 790 && passages(partiel) === 'B1x30/5p B2x30/5p L1x20 L2x20',
        '[D] 60 au bowling, 40 au laser : chaque groupe envoie 20 joueurs au laser, 790 €', { prix: partiel.prix, passages: passages(partiel), refus: partiel.refus });
      const tailles = await simuler(corps(50, 50, { preference: { activityOrder: ['bowling', 'laser_game'], preferredTimes: { bowling: '15:30', laser_game: '15:30' }, grandGroupe: { tailles: [28, 22], impose: true } } }));
      ok(tailles.disponible && passages(tailles) === 'B1x28/5p B2x22/4p L1x28 L2x22' && Number(tailles.prix) === 851,
        '[D] tailles posees 28 et 22 : 5 puis 4 pistes, 28 puis 22 armes, 851 € (9 pistes et 50 joueurs au laser)', { prix: tailles.prix, passages: passages(tailles), refus: tailles.refus });
      const trop = await simuler(corps(60, 60, { preference: { activityOrder: ['bowling', 'laser_game'], preferredTimes: { bowling: '15:30', laser_game: '15:30' }, grandGroupe: { tailles: [40, 20], impose: true } } }));
      ok(trop.disponible === false && /Groupe 1 : 40 joueurs au laser, 30 armes à la fois/.test(trop.refus || ''), '[D] 40 et 20 avec 30 armes : refuse, et le refus dit pourquoi', trop.refus);
      // Un autre centre, sa propre place (sa configuration, jamais un chiffre du code) : Gembloux a 20 armes,
      // 60 joueurs y font 3 groupes de 20 ; deux groupes au bowling en meme temps n ont jamais une piste commune.
      const gembloux = await simuler({ ...corps(60, 60), centerId: 'gembloux' });
      const quilles = (gembloux.blocs || []).filter((b) => b.activite === 'bowling');
      const ensemble = (a, b) => enMin(a.debut) < enMin(b.fin) && enMin(b.debut) < enMin(a.fin);
      const communes = quilles.some((a, i) => quilles.some((b, j) => j > i && ensemble(a, b) && (a.pistes || []).some((p) => (b.pistes || []).includes(p))));
      const simultanes = quilles.some((a, i) => quilles.some((b, j) => j > i && ensemble(a, b)));
      ok(gembloux.disponible && gembloux.grandGroupe && JSON.stringify(gembloux.grandGroupe.tailles) === '[20,20,20]' && quilles.length === 3 && simultanes && !communes && Number(gembloux.prix) === 1068,
        '[D] Gembloux, 20 armes : 3 groupes de 20, deux groupes au bowling en meme temps sur des pistes differentes, 1068 €', { prix: gembloux.prix, refus: gembloux.refus, bowling: quilles.map((b) => `${b.sousGroupe}@${b.debut}[${(b.pistes || []).join(',')}]`) });

      // Sans « Faire tourner » : le plan d avant tant qu il tient, le meme que sans aucune demande ; les
      // groupes qui tournent d office seulement quand il ne tient pas.
      const auto40 = await simuler(dAvant(40, '15:30', '16:30', 2, {}));
      const sans40 = await simuler(dAvant(40, '15:30', '16:30', 2, null));
      ok(auto40.disponible && Number(auto40.prix) === 673 && auto40.fin === '17:25' && !auto40.grandGroupe && (auto40.blocs || []).every((b) => !b.sousGroupe),
        '[D] 40 au bowling et au laser, sans « Faire tourner » : le plan d avant, 673 €, fin 17:25, aucun sous-groupe', { prix: auto40.prix, fin: auto40.fin, gg: auto40.grandGroupe, refus: auto40.refus });
      ok(signature(auto40) !== '' && signature(auto40) === signature(sans40) && Number(sans40.prix) === Number(auto40.prix),
        '[D] ce plan est celui d avant : le meme, bloc pour bloc et au meme prix, que sans aucune demande de grand groupe', { auto: signature(auto40), sans: signature(sans40) });
      const tourne40 = await simuler(corps(40, 40));
      ok(tourne40.disponible && Number(tourne40.prix) === 712 && tourne40.fin === '17:00' && passages(tourne40) === 'B1x20/4p B2x20/4p L1x20 L2x20' && tourne40.grandGroupe && tourne40.grandGroupe.tourne === true,
        '[D] les memes 40 que le comptoir fait tourner : deux groupes de 20, 4 pistes chacun, fin 17:00, 712 €', { prix: tourne40.prix, fin: tourne40.fin, passages: passages(tourne40), refus: tourne40.refus });
      const soir = await simuler(dAvant(60, '20:00', '22:00', 3, {}));
      ok(soir.disponible && Number(soir.prix) === 990 && soir.fin === '22:00' && soir.grandGroupe && soir.grandGroupe.tourne === true && passages(soir) === 'B1x30/5p B2x30/5p L1x30 L2x30',
        '[D] 60 a 20:00 : le plan d avant finirait apres la fermeture, les groupes tournent d office, fin 22:00, 990 €', { prix: soir.prix, fin: soir.fin, gg: soir.grandGroupe, passages: passages(soir), refus: soir.refus });

      // Une modification (le depart decale d une demi-heure) garde les groupes et leur ordre.
      const cree = await serveur.appeler('POST', '/api/staff-reservations', corps(60, 60, { preference: { activityOrder: ['bowling', 'laser_game'], preferredTimes: { bowling: '15:30', laser_game: '15:30' }, grandGroupe: { premier: 'laser_game', impose: true } } }));
      const dossier = cree.json.reservation;
      ok(cree.statut < 300 && dossier && dossier.opsPlan && dossier.opsPlan.grandGroupe && dossier.opsPlan.grandGroupe.premier === 'laser_game', '[D] creation : les groupes tournent, le groupe 1 commence au laser', cree.json.message || (dossier && dossier.opsPlan && dossier.opsPlan.grandGroupe));
      if (dossier) {
        const modif = await serveur.appeler('PATCH', '/api/staff-reservations', { id: dossier.id, centerId: 'libramont', startTime: '16:00', baseUpdatedAt: dossier.updatedAt });
        const apres = B.base.reservations.get(Number(dossier.id)) || B.base.reservations.get(dossier.id);
        const blocs = blocsDe(apres);
        ok(modif.statut < 300 && sansPistes(resume(blocs)) === 'B1@17:00x30 B2@16:00x30 L1@16:00x30 L2@17:00x30' && apres.ops_plan.grandGroupe && apres.ops_plan.grandGroupe.premier === 'laser_game',
          '[D] decale a 16:00, le dossier garde ses deux groupes et leur ordre (groupe 1 laser 16:00 puis bowling 17:00)', `${modif.statut} ${modif.json.message || ''} ${resume(blocs)}`);
      }

      // Le formulaire en ligne : la meme demande (des sous-groupes imposes), par le chemin de la reservation
      // publique (api/public-reservations.js, prepareReservationOps canal public), ne fait aucun sous-groupe.
      semer('vide');
      const { prepareReservationOps } = require(path.join(ROOT, OPS));
      const demande = { ...corps(60, 60), channel: undefined };
      delete demande.channel;
      const sousGroupesDu = (ops) => ((ops && ops.opsPlan && ops.opsPlan.resourceBlocks) || []).filter((b) => b.sousGroupe).length;
      const enLigne = await prepareReservationOps({ ...demande }, 'public');
      const auComptoir = await prepareReservationOps({ ...demande }, 'staff');
      ok(sousGroupesDu(enLigne) === 0 && sousGroupesDu(auComptoir) > 0, '[D] la demande d un grand groupe ne vaut qu au comptoir : le canal public garde son plan', { public: sousGroupesDu(enLigne), staff: sousGroupesDu(auComptoir), refusPublic: enLigne && enLigne.planRefusal });
    }

    // =======================================================================
    if (joue('E')) {
      section('[E] 40 JOUEURS AU BOWLING ET AU LASER : LE PLAN D AVANT RESTE, FAIRE TOURNER EST UNE OPTION');
      // E1 : sans toucher a l option, le plan et le prix d avant, jusqu au dossier.
      {
        const { ctx, page, erreurs, avant } = await ouvrir('vide');
        try {
          await bowlingEtLaser(page, 40, '15:30');
          await attendreOption(page, '1');
          const propose = await option(page);
          ok(propose && propose.tourne === '1' && propose.texte === 'Faire tourner 2 groupes : fin à 17:00, 712 €', '[E] le ticket propose « Faire tourner 2 groupes : fin à 17:00, 712 € »', propose);
          ok(propose && propose.tag === 'BUTTON' && propose.clair && propose.bord >= 1 && !propose.souligne, '[E] l option est un bouton encadre, ni noir ni lien', propose);
          const ecran = await tientALEcran(page);
          ok(ecran.col <= 1 && !ecran.dehors, '[E] Reserver tient a l ecran en 1366 x 768 avec l option', ecran);
          await capture(page, '40-option-ticket');
          // Rien ne bascule seul : le temps passe, le ticket garde le plan d avant.
          await page.waitForTimeout(1500);
          const groupes = await texte(page, '#rsL-groupes');
          const bowling = await texte(page, '#rsL-a-bowling');
          const laser = await texte(page, '#rsL-a-laser_game');
          const total = await texte(page, '#rvTotalPied');
          const choisi = await page.evaluate(() => Boolean(quickBookState && quickBookState.grandGroupe && quickBookState.grandGroupe.tourne));
          ok(groupes === '' && !choisi && /673 €/.test(total) && /15:30/.test(bowling) && !/[Gg]roupe/.test(bowling),
            '[E] sans toucher, le plan d avant : aucun groupe qui tourne, tout le bowling a 15:30, 673 €', { groupes, bowling, total, choisi });
          ok(/16:30/.test(laser) && /17:00/.test(laser), '[E] le laser apres le bowling, en deux vagues : 16:30 et 17:00', laser);
          const creerDit = await texte(page, '#rvCreer');
          ok(/Créer à 15:30/.test(creerDit), '[E] « Créer à 15:30 »', creerDit);
          const r = await creer(page, avant);
          const blocs = blocsDe(r);
          const bowlings = blocs.filter((b) => b.resourceType === 'bowling_lane');
          const gg = r && r.ops_plan && r.ops_plan.grandGroupe;
          ok(r && Number(r.pax) === 40 && Number(r.price) === 673 && !gg && blocs.every((b) => !b.sousGroupe), '[E] le dossier en base au prix d avant : 40 joueurs, 673 €, aucun sous-groupe', r && { pax: r.pax, price: r.price, gg, blocs: resume(blocs) });
          ok(bowlings.length === 1 && bowlings[0].startTime === '15:30' && bowlings[0].endTime === '16:30' && Number(bowlings[0].players) === 40 && (bowlings[0].lanes || []).length === 7
            && resume(blocs.filter((b) => b.resourceType === 'laser_arena')) === 'L0@16:30x20 L0@17:00x20',
          '[E] le plan d avant en base : tout le bowling 15:30-16:30 sur 7 pistes, puis le laser en deux vagues de 20 (16:30, 17:00)', resume(blocs));
          ok(erreurs.length === 0, '[*] zero erreur JavaScript (E, sans toucher)', erreurs.slice(0, 3).join(' | '));
        } finally { await ctx.close(); }
      }
      // E2 : l option touchee, la rotation au prix affiche, jusqu au dossier.
      {
        const { ctx, page, erreurs, avant } = await ouvrir('vide');
        try {
          await bowlingEtLaser(page, 40, '15:30');
          await attendreOption(page, '1');
          const propose = await option(page);
          const affiche = propose ? Number((/(\d+) €$/.exec(propose.texte) || [])[1]) : NaN;
          await toucher(page, '#rsGgOption');
          await tournent(page);
          await pret(page).catch(() => {});
          await attendreOption(page, '0');
          const groupes = await texte(page, '#rsL-groupes');
          const total = await texte(page, '#rvTotalPied');
          const inverse = await option(page);
          ok(/2 groupes qui tournent/.test(groupes) && /20 et 20 joueurs/.test(groupes), '[E] touche : « 2 groupes qui tournent », 20 et 20 joueurs', groupes);
          ok(affiche === 712 && new RegExp(`(^|\\D)${affiche} €`).test(total), '[E] la rotation au prix affiche : 712 € au total', { affiche, total });
          ok(inverse && inverse.tourne === '0' && inverse.texte === 'Ne pas faire tourner : fin à 17:25, 673 €', '[E] l inverse se propose : « Ne pas faire tourner : fin à 17:25, 673 € »', inverse);
          await capture(page, '40-rotation-choisie');
          const r = await creer(page, avant);
          const blocs = blocsDe(r);
          const gg = r && r.ops_plan && r.ops_plan.grandGroupe;
          ok(r && Number(r.pax) === 40 && Number(r.price) === affiche, '[E] le dossier en base au prix affiche : 40 joueurs, 712 €', r && { pax: r.pax, price: r.price });
          ok(sansPistes(resume(blocs)) === 'B1@15:30x20 B2@16:00x20 L1@16:30x20 L2@15:30x20' && sansChevauchement(blocs)
            && blocs.filter((b) => b.resourceType === 'bowling_lane').every((b) => (b.lanes || []).length === 4 && seSuivent(b.lanes)),
          '[E] deux groupes de 20 qui tournent : groupe 1 bowling 15:30 puis laser 16:30, groupe 2 laser 15:30 puis bowling 16:00, 4 pistes cote a cote chacun', resume(blocs));
          ok(gg && gg.tourne === true && JSON.stringify(gg.tailles) === '[20,20]', '[E] le plan garde ses groupes : ils tournent, 20 et 20', gg);
          ok(erreurs.length === 0, '[*] zero erreur JavaScript (E, rotation choisie)', erreurs.slice(0, 3).join(' | '));
        } finally { await ctx.close(); }
      }
    }

    // =======================================================================
    if (joue('F')) {
      section('[F] 60 JOUEURS A 20:00 : LE PLAN D AVANT NE TIENT PAS, LES GROUPES TOURNENT D OFFICE');
      const { ctx, page, erreurs, avant } = await ouvrir('vide');
      try {
        await bowlingEtLaser(page, 60, '20:00');
        await tournent(page);
        await pret(page).catch(() => {});
        // (le temps d un calcul de l autre plan, s il en partait un : aucun ne doit partir)
        await page.waitForTimeout(1200);
        const groupes = await texte(page, '#rsL-groupes');
        const bowling = await texte(page, '#rsL-a-bowling');
        const laser = await texte(page, '#rsL-a-laser_game');
        const total = await texte(page, '#rvTotalPied');
        const creerDit = await texte(page, '#rvCreer');
        const propose = await option(page);
        ok(/2 groupes qui tournent/.test(groupes) && /30 et 30 joueurs/.test(groupes), '[F] sans rien toucher, le ticket dit « 2 groupes qui tournent », 30 et 30 joueurs', groupes);
        ok(/Groupe 1 à 20:00, groupe 2 à 21:00/.test(bowling) && /Groupe 2 à 20:00, groupe 1 à 21:00/.test(laser) && /990 €/.test(total),
          '[F] bowling groupe 1 a 20:00, groupe 2 a 21:00 ; laser groupe 2 a 20:00, groupe 1 a 21:00 ; 990 €', { bowling, laser, total });
        ok(!propose, '[F] rien a choisir : le plan d avant ne tient pas, aucune option', propose);
        ok(/Créer à 20:00/.test(creerDit), '[F] « Créer à 20:00 » : le plan tient', creerDit);
        await capture(page, '60-soir-d-office');
        const r = await creer(page, avant);
        const blocs = blocsDe(r);
        const gg = r && r.ops_plan && r.ops_plan.grandGroupe;
        ok(r && String(r.start_time).slice(0, 5) === '20:00' && Number(r.price) === 990
          && sansPistes(resume(blocs)) === 'B1@20:00x30 B2@21:00x30 L1@21:00x30 L2@20:00x30'
          && Math.max(...blocs.map((b) => enMin(b.endTime))) === enMin('22:00'),
        '[F] le dossier nait a 20:00 en deux groupes qui tournent, fin 22:00, 990 €', r && `${r.start_time} ${r.price} ${resume(blocs)}`);
        ok(gg && gg.tourne === true && JSON.stringify(gg.tailles) === '[30,30]', '[F] le plan garde ses groupes qui tournent, 30 et 30', gg);
        ok(erreurs.length === 0, '[*] zero erreur JavaScript (F)', erreurs.slice(0, 3).join(' | '));
      } finally { await ctx.close(); }
    }

    // =======================================================================
    if (joue('G')) {
      section('[G] UNE HEURE TOUCHEE NE MET JAMAIS UN SOUS-GROUPE A DEUX ENDROITS (PLANNING COMPLET, MODIFIER)');
      const fx = semer('vide');
      const jour = fx.staffState.date;
      const cree = await serveur.appeler('POST', '/api/staff-reservations', {
        name: 'Groupe Tourne', phone: '0470111222', email: '', notes: '', occasion: '', date: jour, startTime: '15:30', duration: 1, totalDuration: 2, lanes: [], pax: 60, status: 'pending', type: 'visite', formuleId: '',
        program: [{ activityId: 'bowling', pax: 60, participants: 60, duration: 1 }, { activityId: 'laser_game', pax: 60, participants: 60, games: 1 }],
        laserGames: 0, extras: [], channel: 'staff', requiresLanes: true, centerId: 'libramont',
        preference: { activityOrder: ['bowling', 'laser_game'], preferredTimes: { bowling: '15:30', laser_game: '15:30' }, grandGroupe: { impose: true } },
      });
      const d = cree.json.reservation;
      const ligne = (id) => B.base.reservations.get(Number(id)) || B.base.reservations.get(id);
      const avant = d ? sansPistes(resume(blocsDe(ligne(d.id)))) : '';
      ok(cree.statut < 300 && avant === 'B1@15:30x30 B2@16:30x30 L1@16:30x30 L2@15:30x30', '[G] le groupe tourne : groupe 1 bowling 15:30 puis laser 16:30, groupe 2 laser 15:30 puis bowling 16:30', `${cree.statut} ${cree.json.message || ''} ${avant}`);
      if (d) {
        const blocs = (d.opsPlan && d.opsPlan.resourceBlocks) || [];
        const pistes = [...new Set(blocs.filter((b) => b.resourceType === 'bowling_lane').flatMap((b) => b.lanes || []))].sort((a, b) => a - b);
        const laser1 = blocs.find((b) => b.resourceType === 'laser_arena' && Number(b.sousGroupe) === 1);
        const cle1 = laser1 ? `${laser1.countIndex}.${laser1.groupWaveIndex}` : '';
        // La pop-up et le glisser du planning complet demandent leurs heures ici (deplacerABlanc, essais) :
        // seules celles qui passent se proposent.
        const essais = async (moves) => (await serveur.appeler('POST', '/api/staff-reservations', { dryRun: true, deplacement: { id: d.id, centerId: 'libramont', baseUpdatedAt: d.updatedAt, essais: moves } })).json.essais || [];
        const bowling = await essais(['15:00', '16:00', '16:30', '17:00'].map((h) => [{ activityId: 'bowling', startTime: h, lanes: pistes }]));
        ok(bowling.length === 4 && bowling[0].passe === true && bowling[3].passe === true
          && bowling[1].passe === false && /Laser Game du groupe 1, de 16:30 à 16:55/.test(bowling[1].raison || '')
          && bowling[2].passe === false && /Laser Game du groupe 1/.test(bowling[2].raison || ''),
        '[G] le bowling a 16:00 ou 16:30 ne se propose pas (« chevauche le Laser Game du groupe 1, de 16:30 à 16:55 ») ; 15:00 et 17:00 passent', bowling);
        const laser = await essais(['16:00', '17:00'].map((h) => [{ activityId: 'laser_game', unitKey: cle1, startTime: h }]));
        ok(Boolean(cle1) && laser.length === 2 && laser[0].passe === false && /Bowling du groupe 1, de 15:30 à 16:30/.test(laser[0].raison || '') && laser[1].passe === true,
          '[G] le laser du groupe 1 a 16:00 chevauche son bowling et ne se propose pas ; 17:00 passe', { cle1, laser });
        // Le toucher s enregistre par le PATCH activityMove : la meme regle, rien ne s ecrit.
        const refuse = await serveur.appeler('PATCH', '/api/staff-reservations', { id: d.id, centerId: 'libramont', baseUpdatedAt: d.updatedAt, activityMove: { activityId: 'bowling', startTime: '16:00', lanes: pistes } });
        const inchange = sansPistes(resume(blocsDe(ligne(d.id))));
        ok(refuse.statut === 422 && /Laser Game du groupe 1/.test(refuse.json.message || '') && inchange === avant,
          '[G] le PATCH du bowling a 16:00 est refuse avec la meme phrase, le dossier ne bouge pas', `${refuse.statut} ${refuse.json.message || ''} ${inchange}`);
        // Une heure qui garde chaque sous-groupe a un seul endroit s enregistre.
        const pris = await serveur.appeler('PATCH', '/api/staff-reservations', { id: d.id, centerId: 'libramont', baseUpdatedAt: d.updatedAt, activityMove: { activityId: 'bowling', startTime: '17:00', lanes: pistes } });
        const deplace = blocsDe(ligne(d.id));
        ok(pris.statut === 200 && sansPistes(resume(deplace)) === 'B1@17:00x30 B2@18:00x30 L1@16:30x30 L2@15:30x30' && sansChevauchement(deplace),
          '[G] le bowling a 17:00 s enregistre : chaque sous-groupe reste a un seul endroit', `${pris.statut} ${pris.json.message || ''} ${sansPistes(resume(deplace))}`);
      }
    }

    // =======================================================================
    if (joue('H')) {
      section('[H] UN GRAND GROUPE A LA MINUTE : SES GROUPES PARTENT A L HEURE TAPEE');
      const fx = semer('vide');
      const jour = fx.staffState.date;
      // (le matin : les heures tapees sont devant, jamais l heure qu il est)
      globalThis.__comptoirMaintenant = FX.instant(jour, '10:00').getTime();
      // Ce que la fenetre envoie pour une heure tapee a la minute (rvALaMinute) : l heure au moteur, et
      // posee (heuresPosees), qui dit au serveur de la juger a sa minute. `impose` : les sous-groupes
      // voulus (un bowling seul trop grand, ou « Faire tourner » touche) ; sans lui, le plan d avant.
      const demande = ({ pax, heure, laserA = '', bowlingSeul = false, impose = true, posees = true }) => ({
        name: 'Groupe Minute', phone: '0470111222', email: '', notes: '', occasion: '', date: jour, startTime: heure, duration: 1, totalDuration: 3, lanes: [], pax, status: 'pending', type: 'visite', formuleId: '',
        program: bowlingSeul ? [{ activityId: 'bowling', pax, participants: pax, duration: 1 }] : [{ activityId: 'bowling', pax, participants: pax, duration: 1 }, { activityId: 'laser_game', pax, participants: pax, games: 1 }],
        laserGames: 0, extras: [], channel: 'staff', requiresLanes: true, centerId: 'libramont',
        preference: bowlingSeul
          ? { activityOrder: ['bowling'], preferredTimes: { bowling: heure }, grandGroupe: { impose: true } }
          : { activityOrder: ['bowling', 'laser_game'], preferredTimes: { bowling: heure, laser_game: laserA || heure }, ...(impose ? { grandGroupe: { impose: true } } : { laserGameTimes: [laserA || heure], laserPlacement: 'scheduled', grandGroupe: {} }) },
        ...(posees ? { heuresPosees: bowlingSeul ? { bowling: heure } : { bowling: heure, laser_game: laserA || heure } } : {}),
      });
      const simuler = async (c) => (await serveur.appeler('POST', '/api/staff-reservations', { ...c, dryRun: true })).json.plan || {};
      const horaire = (plan) => (plan.blocs || []).map((b) => `${b.activite === 'bowling' ? 'B' : 'L'}${b.sousGroupe || 0}@${b.debut}`).sort().join(' ');
      const seul = await simuler(demande({ pax: 60, heure: '15:10', bowlingSeul: true }));
      const seulGrille = await simuler(demande({ pax: 60, heure: '15:30', bowlingSeul: true, posees: false }));
      ok(seul.disponible === true && horaire(seul) === 'B1@15:10 B2@16:10' && Number(seul.prix) === 390 && Number(seulGrille.prix) === 390,
        '[H] 60 au bowling seul a 15:10 : deux groupes l un apres l autre, 15:10 puis 16:10, 390 € comme a 15:30', { horaire: horaire(seul), prix: seul.prix, grille: seulGrille.prix, refus: seul.refus });
      const tourne = await simuler(demande({ pax: 60, heure: '15:10' }));
      ok(tourne.disponible === true && horaire(tourne) === 'B1@15:10 B2@16:10 L1@16:10 L2@15:10' && Number(tourne.prix) === 990 && tourne.fin === '17:10',
        '[H] 60 qui tournent a 15:10 : groupe 1 bowling 15:10 puis laser 16:10, groupe 2 l inverse, fin 17:10, 990 €', { horaire: horaire(tourne), prix: tourne.prix, fin: tourne.fin, refus: tourne.refus });
      const soir = await simuler(demande({ pax: 60, heure: '19:40', laserA: '21:40', impose: false }));
      ok(soir.disponible === true && Boolean(soir.grandGroupe && soir.grandGroupe.tourne) && horaire(soir) === 'B1@19:40 B2@20:40 L1@20:40 L2@19:40' && soir.fin === '21:40',
        '[H] 60 a 19:40, laser tape a 21:40 : le plan d avant finirait apres la fermeture, les groupes tournent d office des 19:40, fin 21:40', { horaire: horaire(soir), fin: soir.fin, gg: soir.grandGroupe, refus: soir.refus });
      // Jusqu en base : la creation, telle que « Créer » l envoie.
      const cree = await serveur.appeler('POST', '/api/staff-reservations', demande({ pax: 60, heure: '15:10' }));
      const r = cree.json.reservation && (B.base.reservations.get(Number(cree.json.reservation.id)) || B.base.reservations.get(cree.json.reservation.id));
      ok(cree.statut < 300 && Boolean(r) && String(r.start_time).slice(0, 5) === '15:10' && sansPistes(resume(blocsDe(r))) === 'B1@15:10x30 B2@16:10x30 L1@16:10x30 L2@15:10x30' && sansChevauchement(blocsDe(r)) && Number(r.price) === 990,
        '[H] le dossier nait a 15:10, ses groupes a la minute, chacun a un seul endroit, 990 €', r ? `${r.start_time} ${r.price} ${resume(blocsDe(r))}` : `${cree.statut} ${cree.json.message || ''}`);
      // Au comptoir, en vrais clics : 60 tapes dans « Autre », le bowling, puis « Autre heure » 16:10 (il
      // est 15:10). La fenetre juge la minute a blanc, le ticket dit chaque groupe a la minute, et
      // « Créer » ecrit ce que le ticket montre.
      const { ctx, page, erreurs, avant } = await ouvrir('vide');
      try {
        await soixante(page);
        await toucher(page, '.rs-seance [data-activite="bowling"][data-heure="16:00"]');
        await pret(page).catch(() => {});
        await toucher(page, '.rs-h-autres[data-activite="bowling"]');
        await page.waitForSelector('#rsMin-bowling', { timeout: 12000 });
        await page.locator('#rsMin-bowling').click();
        await page.keyboard.type('1610');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => { const b = typeof rsEtat === 'function' ? rsEtat() : null; return Boolean(b) && !(b.minute && b.minute.etat === 'calcul'); }, null, { timeout: 15000 }).catch(() => {});
        await page.waitForFunction(() => /16:10/.test((document.querySelector('#rsL-a-bowling') || {}).textContent || ''), null, { timeout: 15000 }).catch(() => {});
        await pret(page).catch(() => {});
        const bowlingDit = await texte(page, '#rsL-a-bowling');
        const creerDit = await texte(page, '#rvCreer');
        ok(/Groupe 1 à 16:10, groupe 2 à 17:10/.test(bowlingDit) && /Créer à 16:10/.test(creerDit),
          '[H] « Autre heure » 16:10 sur 60 au bowling : le ticket dit groupe 1 a 16:10, groupe 2 a 17:10, « Créer à 16:10 »', { bowlingDit, creerDit });
        await capture(page, '60-bowling-a-la-minute');
        const rc = await creer(page, avant);
        const services = blocsDe(rc).filter((b) => b.resourceType === 'bowling_lane').map((b) => `${b.sousGroupe}@${b.startTime}-${b.endTime}x${b.players}`).sort().join(' ');
        ok(Boolean(rc) && String(rc.start_time).slice(0, 5) === '16:10' && services === '1@16:10-17:10x30 2@17:10-18:10x30',
          '[H] le dossier nait a 16:10 : groupe 1 de 16:10 a 17:10, groupe 2 de 17:10 a 18:10', rc ? `${rc.start_time} ${services}` : 'aucun dossier');
        ok(erreurs.length === 0, '[*] zero erreur JavaScript (H)', erreurs.slice(0, 3).join(' | '));
      } finally { await ctx.close(); }
    }

    // =======================================================================
    if (joue('I')) {
      section('[I] 60 JOUEURS EN 4 GROUPES, CHACUN A SON HEURE : RESERVER, PLANNING COMPLET, FICHE, MODIFIER');
      const { ctx, page, erreurs, avant } = await ouvrir('vide');
      // (une fenetre de confirmation, s il en vient une, se valide : le gate juge ce qui s ecrit)
      page.on('dialog', (d) => d.accept().catch(() => {}));
      const horaireDe = (r) => blocsDe(r).map((b) => `${b.resourceType === 'bowling_lane' ? 'B' : 'L'}${b.sousGroupe || 0}@${String(b.startTime).slice(0, 5)}x${b.players}`).sort().join(' ');
      try {
        await bowlingEtLaser(page, 60, '15:30');
        await attendreOption(page, '1');
        await toucher(page, '#rsGgOption');
        await tournent(page);
        await pret(page).catch(() => {});
        await toucher(page, '#rsL-groupes');
        await page.waitForSelector('#rsGgListe', { timeout: 15000 });
        // Deux groupes de plus, au « + » du nombre : 4 groupes de 15.
        for (let n = 3; n <= 4; n += 1) {
          await toucher(page, 'button[aria-label="Nombre de groupes, un de plus"]');
          await page.waitForFunction((k) => document.querySelectorAll('#rsGgListe .rs-gg-l').length === k, n, { timeout: 15000 }).catch(() => {});
          await pret(page).catch(() => {});
        }
        const quatre = await page.evaluate(() => Array.from(document.querySelectorAll('#rsGgListe .rs-gg-l')).map((l) => l.getAttribute('aria-label')));
        ok(quatre.length === 4 && quatre.every((t) => / · 15 joueurs · /.test(t)), '[I] « + » deux fois au nombre : 4 groupes de 15', quatre);
        // Chaque heure se touche et se tape, comme au comptoir : les groupes 1 et 2 au laser a 15:30 (15 + 15
        // armes sur 30) puis au bowling a 16:30, les groupes 3 et 4 l inverse.
        const poserHeure = async (groupe, activite, heure) => {
          await page.locator(`#rsGgListe b.rs-gg-h[data-saisie="t:${groupe}-${activite}"]`).first().click();
          await page.waitForSelector('#rsSaisie', { timeout: 8000 });
          await page.keyboard.press('Control+A');
          await page.keyboard.type(heure.replace(':', ''));
          await page.keyboard.press('Enter');
          await page.waitForFunction((x) => Boolean(document.querySelector(`#rsGgListe .rs-gg-c[data-groupe="${x[0]}"][data-activite="${x[1]}"][data-heure-groupe="${x[2]}"]`)), [groupe, activite, heure], { timeout: 15000 }).catch(() => {});
          await pret(page).catch(() => {});
        };
        const voulues = [[1, 'laser_game', '15:30'], [1, 'bowling', '16:30'], [2, 'laser_game', '15:30'], [2, 'bowling', '16:30'], [3, 'bowling', '15:30'], [3, 'laser_game', '16:30'], [4, 'bowling', '15:30'], [4, 'laser_game', '16:30']];
        for (const [groupe, activite, heure] of voulues) await poserHeure(groupe, activite, heure);
        const lignes = await page.evaluate(() => Array.from(document.querySelectorAll('#rsGgListe .rs-gg-l')).map((l) => l.getAttribute('aria-label')));
        ok(JSON.stringify(lignes) === JSON.stringify([
          'Groupe 1 · 15 joueurs · Laser 15:30 → Bowling 16:30',
          'Groupe 2 · 15 joueurs · Laser 15:30 → Bowling 16:30',
          'Groupe 3 · 15 joueurs · Bowling 15:30 → Laser 16:30',
          'Groupe 4 · 15 joueurs · Bowling 15:30 → Laser 16:30',
        ]), '[I] chaque groupe a ses heures, ses cases dans l ordre de ses heures', lignes);
        const rougesPage = await page.evaluate(() => document.querySelectorAll('#rsGgListe .is-ko').length);
        const phraseI = await texte(page, '#rsGgPhrase');
        ok(rougesPage === 0 && /Les heures sont celles que vous avez posées\./.test(phraseI), '[I] rien ne coince : aucune case rouge, la page dit que les heures sont celles posees', { rougesPage, phraseI });
        const ecranI = await tientALEcran(page);
        ok(ecranI.col <= 1 && !ecranI.dehors, '[I] la page des 4 groupes tient a l ecran en 1366 x 768', ecranI);
        await capture(page, '60-en-4-groupes-page');
        await toucher(page, '#rsRetour');
        await page.waitForSelector('#rsL-groupes', { timeout: 12000 });
        await pret(page).catch(() => {});
        const ticket = await texte(page, '#rsL-groupes');
        ok(/4 groupes qui tournent/.test(ticket) && /Groupe 1 · 15 · Laser 15:30 → Bowling 16:30/.test(ticket) && /Groupe 4 · 15 · Bowling 15:30 → Laser 16:30/.test(ticket),
          '[I] le ticket dit les 4 groupes, un par ligne', ticket);
        const prixAnnonce = await page.evaluate(() => { const p = rvPlanCourant(); return p && p.prix != null ? Number(p.prix) : null; });
        await capture(page, '60-en-4-groupes-ticket');
        const r = await creer(page, avant);
        const gg = r && r.ops_plan && r.ops_plan.grandGroupe;
        ok(Boolean(r) && String(r.start_time).slice(0, 5) === '15:30' && horaireDe(r) === 'B1@16:30x15 B2@16:30x15 B3@15:30x15 B4@15:30x15 L1@15:30x15 L2@15:30x15 L3@16:30x15 L4@16:30x15'
          && gg && gg.nombre === 4 && gg.auxHeures === true && prixAnnonce !== null && Number(r.price) === prixAnnonce,
        '[I] le dossier nait en 4 groupes de 15, aux heures posees, au prix que la fenetre annoncait', r ? { debut: r.start_time, horaire: horaireDe(r), gg, prix: r.price, annonce: prixAnnonce } : 'aucun dossier');
        ok(r && sansChevauchement(blocsDe(r)), '[I] aucun groupe n est a deux endroits a la fois', r && resume(blocsDe(r)));
        // Le planning complet marque chaque groupe : « groupe N » au bowling, « groupes 1 et 2 » sur la partie de laser
        // qu ils jouent ensemble.
        const cases = r ? await casesDuPlanning(page, r.id) : [];
        ok(cases.some((t) => /^Laser à 15:30 · groupes 1 et 2 ·/.test(t)) && cases.some((t) => /^Laser à 16:30 · groupes 3 et 4 ·/.test(t))
          && [1, 2].every((n) => cases.some((t) => new RegExp(`^Bowling de 16:30 à 17:30 · groupe ${n} ·`).test(t)))
          && [3, 4].every((n) => cases.some((t) => new RegExp(`^Bowling de 15:30 à 16:30 · groupe ${n} ·`).test(t))),
        '[I] le planning complet marque chaque groupe, « groupes 1 et 2 » sur la partie de laser qu ils jouent ensemble', cases);
        // [I] LE PLANNING COMPLET TIENT A 1280 PUIS A 1024 (2026-11-23) : « 15 joueurs » et « groupes 1 et 2 » debordaient
        // de leur colonne de quelques pixels. Chaque mot d une case reste dans sa colonne (et sa case), a 1366, 1280 et
        // 1024 de large ; le texte n est jamais tronque avec des points de suspension ni a une hauteur qui l ecrase.
        const largeurInitiale = page.viewportSize();
        const sortiesPlanning = {};
        for (const largeur of [1366, 1280, 1024]) {
          await page.setViewportSize({ width: largeur, height: largeurInitiale.height });
          await page.waitForTimeout(500);
          if (process.env.GG_CAPTURE_DIR) await page.screenshot({ path: require('path').join(process.env.GG_CAPTURE_DIR, `planning-${largeur}.png`) });
          sortiesPlanning[largeur] = r ? await page.evaluate((id) => {
            const rang = document.querySelector(`.gf-r[data-gf-id="${id}"]`);
            const sorties = [];
            if (!rang) return ['rang absent'];
            rang.querySelectorAll('.gf-x').forEach((x) => {
              const colonne = (x.closest('.gf-a') || x).getBoundingClientRect();
              const feuilles = Array.from(x.querySelectorAll('*')).filter((e) => e.children.length === 0 && (e.textContent || '').trim());
              feuilles.forEach((e) => {
                const b = e.getBoundingClientRect();
                const coupe = e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).display !== 'inline';
                if (b.width > 0 && (b.right > colonne.right + 0.5 || b.left < colonne.left - 0.5 || coupe)) sorties.push(`${(e.textContent || '').trim().slice(0, 30)} (${Math.round(b.right - colonne.right)}px, colonne ${Math.round(colonne.width)}px)`);
              });
            });
            return sorties;
          }, r.id) : [];
        }
        ok(Object.values(sortiesPlanning).every((l) => l.length === 0), '[I] le planning complet tient dans ses colonnes a 1366, 1280 et 1024 de large : « 15 joueurs » et « groupes 1 et 2 » ne debordent pas', sortiesPlanning);
        // [I] LA PASTILLE GRISE A UNE VRAIE MARGE (2026-11-24) : a 1024 de large, « groupes » tenait dans sa colonne de 54 px
        // avec 0,7 px de reste ; un navigateur qui dessine le mot un rien plus large l aurait coupe sans que rien rougisse.
        // Chaque mot de chaque pastille grise (« 15 joueurs », « groupes 1 et 2 ») garde au moins 3 px de place sur sa
        // ligne, en 12 px au moins, et aucun mot ne passe a la ligne en deux morceaux, a 1366, 1280, 1024 et 768 de large
        // comme au telephone. Au telephone, ou la case est une ligne, la pastille garde aussi 3 px au moins avec ce qui la
        // precede (elle touchait « Pistes 4-6 »).
        const margesPastilles = {};
        for (const largeur of [1366, 1280, 1024, 768, 390]) {
          await page.setViewportSize({ width: largeur, height: largeurInitiale.height });
          await page.waitForTimeout(400);
          margesPastilles[largeur] = r ? await page.evaluate((id) => Array.from(document.querySelectorAll(`.gf-r[data-gf-id="${id}"] .gf-x__h`)).map((h) => {
            const st = getComputedStyle(h);
            const px = (v) => parseFloat(v) || 0;
            const parent = h.parentElement;
            const pst = getComputedStyle(parent);
            const contenu = parent.getBoundingClientRect().width - px(pst.borderLeftWidth) - px(pst.borderRightWidth) - px(pst.paddingLeft) - px(pst.paddingRight);
            const place = contenu - px(st.marginLeft) - px(st.marginRight) - px(st.paddingLeft) - px(st.paddingRight) - px(st.borderLeftWidth) - px(st.borderRightWidth);
            const mots = [];
            const parcours = document.createTreeWalker(h, NodeFilter.SHOW_TEXT);
            for (let n = parcours.nextNode(); n; n = parcours.nextNode()) {
              const re = /\S+/g;
              for (let m = re.exec(n.data); m; m = re.exec(n.data)) {
                const plage = document.createRange();
                plage.setStart(n, m.index);
                plage.setEnd(n, m.index + m[0].length);
                const morceaux = Array.from(plage.getClientRects()).filter((x) => x.width > 0);
                mots.push({ mot: m[0], largeur: morceaux.reduce((s, x) => s + x.width, 0), morceaux: morceaux.length });
              }
            }
            const large = mots.reduce((a, b) => (b.largeur > a.largeur ? b : a), { mot: '', largeur: 0 });
            // (l ecart avec ce qui precede, seulement quand c est sur la meme ligne : au telephone)
            const bloc = h.closest('.gf-x__hors') || h;
            const avant = bloc.previousElementSibling;
            const a = avant ? avant.getBoundingClientRect() : null;
            const b = bloc.getBoundingClientRect();
            const ecart = a && a.width > 0 && Math.abs(a.top - b.top) < a.height ? Math.round((b.left - a.right) * 10) / 10 : null;
            return { texte: h.textContent.trim(), taille: px(st.fontSize), marge: Math.round((place - large.largeur) * 10) / 10, mot: large.mot, coupe: mots.filter((x) => x.morceaux > 1).map((x) => x.mot), ecart };
          }), r.id) : [];
        }
        const pastilles = Object.values(margesPastilles).flat();
        ok(pastilles.length > 0 && Object.values(margesPastilles).every((l) => l.some((p) => /groupes/.test(p.texte)))
          && pastilles.every((p) => p.taille >= 12 && p.marge >= 3 && !p.coupe.length && (p.ecart === null || p.ecart >= 3))
          && margesPastilles[390].every((p) => p.ecart !== null),
        '[I] chaque mot des pastilles grises garde au moins 3 px de place a 1366, 1280, 1024 et 768 de large et au telephone, en 12 px, aucun mot coupe ; au telephone, 3 px au moins avec ce qui la precede', margesPastilles);
        await page.setViewportSize(largeurInitiale);
        await page.waitForTimeout(300);
        await capture(page, '60-en-4-groupes-planning');
        const fiche = r ? await ouvrirLaFiche(page, r.id) : { groupes: '' };
        ok(/4 groupes qui tournent/.test(fiche.groupes) && /Groupe 1, 15 joueurs : laser 15:30, bowling 16:30/.test(fiche.groupes) && /Groupe 4, 15 joueurs : bowling 15:30, laser 16:30/.test(fiche.groupes),
          '[I] la fiche dit qui joue quoi et quand, groupe par groupe', fiche.groupes);
        // MODIFIER : le bloc des groupes. Le laser du groupe 4 passe a 17:00, le calcul a blanc le juge, « Enregistrer »
        // l ecrit ; le reste ne bouge pas, au meme prix.
        if (r) {
          await page.evaluate((i) => { serveurSaitModifierABlanc = true; closePos(); openPos(i); setTab('modifier'); }, r.id);
          await page.waitForSelector('#editGroupes .fm-gg-l', { timeout: 12000 });
          const bloc = await page.evaluate(() => ({ titre: ((document.getElementById('editGroupesTitre') || {}).textContent || '').trim(), lignes: Array.from(document.querySelectorAll('#editGroupes .fm-gg-l')).map((l) => l.getAttribute('aria-label')) }));
          ok(bloc.titre === '60 joueurs en 4 groupes' && bloc.lignes.length === 4 && bloc.lignes[0] === 'Groupe 1 · 15 joueurs · Laser 15:30 → Bowling 16:30',
            '[I] Modifier montre le bloc des groupes : 4 rangees, leurs joueurs et leurs heures', bloc);
          // (le premier passage au navigateur, 2026-11-23 : « Bowlin » coupe, « jusqu’ / à / 15:55 » sur trois lignes,
          // et le programme disait « 1er groupe à 15:30 » pour le groupe 3)
          await page.evaluate(() => { const z = document.getElementById('editGroupes'); if (z) z.scrollIntoView({ block: 'start' }); });
          const lecture = await page.evaluate(() => {
            const z = document.getElementById('editGroupes');
            const textes = Array.from(z.querySelectorAll('.fm-gg-a b, .fm-gg-a small'));
            return {
              coupes: textes.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent),
              surPlusieursLignes: Array.from(z.querySelectorAll('.fm-gg-a small')).filter((e) => e.getClientRects().length > 1 || e.getBoundingClientRect().height > 24).map((e) => e.textContent),
              inverserSousLaRangee: Array.from(z.querySelectorAll('.fm-gg-l')).filter((l) => { const b = l.querySelector('.fm-gg-inv'); const q = l.querySelector('.fm-gg-q'); return b && q && b.getBoundingClientRect().top > q.getBoundingClientRect().bottom; }).length,
            };
          });
          ok(lecture.coupes.length === 0 && lecture.surPlusieursLignes.length === 0 && lecture.inverserSousLaRangee === 0,
            '[I] Modifier : le bloc des groupes se lit a 1366 x 768, aucun nom ni detail coupe ou casse, le bouton qui inverse sur la ligne de son groupe', lecture);
          const services = await texte(page, '#posOverlay .fm-act-parties[data-parties-activite="bowling"]');
          ok(services === 'Groupe 3 à 15:30 · Groupe 4 à 15:30 · Groupe 1 à 16:30 · Groupe 2 à 16:30',
            '[I] Modifier, le programme : le bowling dit le vrai numero de chaque groupe, comme le bloc des groupes', services);
          await capture(page, '60-en-4-groupes-modifier');
          await page.locator('#editGg4-laser_game').fill('17:00');
          await page.keyboard.press('Tab');
          await page.waitForFunction(() => /Groupe 4 : laser 16:30 → 17:00/.test((document.getElementById('editModifs') || {}).textContent || ''), null, { timeout: 12000 }).catch(() => {});
          await page.waitForFunction(() => { const v = document.getElementById('editVerdict'); return Boolean(v) && !v.hidden && !/Vérification/.test(v.textContent || ''); }, null, { timeout: 15000 }).catch(() => {});
          const barre = await texte(page, '#editModifs');
          const verdict = await texte(page, '#editVerdict');
          ok(/Groupe 4 : laser 16:30 → 17:00/.test(barre) && !/Ne passera pas/.test(verdict), '[I] Modifier : le laser du groupe 4 a 17:00, la barre du bas le dit et le calcul a blanc ne refuse rien', { barre, verdict });
          await page.click('#posOverlay .es-save');
          let apres = null;
          for (let i = 0; i < 100; i += 1) {
            await page.waitForTimeout(100);
            apres = B.base.reservations.get(Number(r.id)) || B.base.reservations.get(r.id);
            if (apres && /L4@17:00/.test(horaireDe(apres))) break;
          }
          ok(apres && horaireDe(apres) === 'B1@16:30x15 B2@16:30x15 B3@15:30x15 B4@15:30x15 L1@15:30x15 L2@15:30x15 L3@16:30x15 L4@17:00x15' && Number(apres.price) === Number(r.price),
            '[I] « Enregistrer » : le laser du groupe 4 passe a 17:00, le reste ne bouge pas, au meme prix', apres && { horaire: horaireDe(apres), prix: apres.price, avant: r.price });
          await page.evaluate(() => { if (typeof closePos === 'function') closePos(); });
          await page.waitForFunction((id) => Array.from(document.querySelectorAll(`.gf-r[data-gf-id="${id}"] .gf-x`)).some((x) => /^Laser à 17:00 · groupe 4/.test(x.getAttribute('title') || '')), r.id, { timeout: 15000 }).catch(() => {});
          const cases2 = await casesDuPlanning(page, r.id);
          ok(cases2.some((t) => /^Laser à 16:30 · groupe 3 ·/.test(t)) && cases2.some((t) => /^Laser à 17:00 · groupe 4 ·/.test(t)),
            '[I] le planning complet suit : le groupe 3 seul au laser a 16:30, le groupe 4 a 17:00', cases2);
          // Une heure avant l ouverture : la case du groupe 1 le dit en rouge, avant « Enregistrer ».
          await page.evaluate((i) => { closePos(); openPos(i); setTab('modifier'); }, r.id);
          await page.waitForSelector('#editGroupes .fm-gg-l', { timeout: 12000 });
          // [I] UN PRIX QUE LE SERVEUR N ECRIRAIT PAS NE S ANNONCE PAS (2026-11-23) : le prix du champ differe de celui du
          // dossier (l estimation de la console seule, « 1 068 € → 990 € » vu au comptoir) ; avant tout refus la barre le
          // dit, des que le serveur refuse l heure d un groupe elle n annonce plus aucun prix.
          await page.evaluate((prix) => { state.editState.prixFige = true; state.editState.price = String(prix); majModifsEdition(); }, Number(r.price) + 78);
          const barrePrix = await texte(page, '#editModifs');
          ok(/Prix [\d\s.,]+ € → [\d\s.,]+ €/.test(barrePrix), '[I] Modifier : avant tout refus, la barre du bas annonce le prix du champ', barrePrix);
          // (l heure se tape comme au comptoir, puis le comptoir passe au champ suivant du bloc, l heure du bowling
          // du groupe 1. Le champ heure de Chromium a trois arrets de tabulation, les heures, les minutes et son
          // horloge : une seule tabulation apres l heure restait dans le champ, la frappe restait en cours et le
          // bloc ne se repeignait pas, par choix, groupesSortieEdition ; la barre du bas disait deja le refus.)
          await page.locator('#editGg1-laser_game').focus();
          await page.keyboard.type('0800');
          await page.locator('#editGg1-bowling').click();
          await page.waitForSelector('#editGroupes .fm-gg-c.is-ko[data-groupe="1"][data-activite="laser_game"]', { timeout: 15000 }).catch(() => {});
          const ko = await texte(page, '#editGroupes .fm-gg-l[data-groupe="1"] .fm-gg-ko');
          ok(/Groupe 1 : le laser à 08:00 commence avant l’ouverture \(\d{2}:\d{2}\)\./.test(ko), '[I] Modifier : le laser du groupe 1 a 08:00, sa case est rouge et dit pourquoi, avant « Enregistrer »', ko);
          const barreRefus = await texte(page, '#editModifs');
          ok(/commence avant l’ouverture/.test(await texte(page, '#editVerdict') + ko) && !/Prix/.test(barreRefus) && /Groupe 1 : laser/.test(barreRefus),
            '[I] Modifier : tant que l heure d un groupe est refusee, la barre du bas n annonce aucun prix (le reste y est)', { barreRefus, verdict: await texte(page, '#editVerdict') });
          await capture(page, '60-en-4-groupes-modifier-refus');
          await page.evaluate(() => { if (typeof closePos === 'function') closePos(); });
        }
        ok(erreurs.length === 0, '[*] zero erreur JavaScript (I)', erreurs.slice(0, 3).join(' | '));
      } finally { await ctx.close(); }
    }

    // =======================================================================
    if (joue('J')) {
      section('[J] LES VAGUES QUE LE DOSSIER PORTE : LE GROUPE 3 RETIRE DU PLANNING LASER SE PLACE ET SE REPLACE');
      const { ctx, page, erreurs } = await ouvrir('vide');
      try {
        const jour = FX.lireFixture('vide').staffState.date;
        const grand = await serveur.appeler('POST', '/api/staff-reservations', {
          name: 'Groupe Posé 4', phone: '0470111222', email: '', notes: '', occasion: '', date: jour, startTime: '15:30', duration: 1, totalDuration: 3, lanes: [], pax: 60, status: 'pending', type: 'visite', formuleId: '',
          program: [{ activityId: 'bowling', pax: 60, participants: 60, duration: 1 }, { activityId: 'laser_game', pax: 60, participants: 60, games: 1 }],
          laserGames: 0, extras: [], channel: 'staff', requiresLanes: true, centerId: 'libramont',
          preference: { activityOrder: ['bowling', 'laser_game'], preferredTimes: { bowling: '15:30', laser_game: '15:30' }, grandGroupe: { nombre: 4, tailles: [15, 15, 15, 15], impose: true,
            heures: [{ bowling: '16:30', laser_game: '15:30' }, { bowling: '16:30', laser_game: '15:30' }, { bowling: '15:30', laser_game: '16:30' }, { bowling: '15:30', laser_game: '16:30' }] } },
        });
        const parties = await serveur.appeler('POST', '/api/staff-reservations', {
          name: 'Laser Groupes', phone: '0470999888', email: '', notes: '', occasion: '', date: jour, startTime: '17:30', duration: 1, totalDuration: 1, lanes: [], pax: 24, status: 'pending', type: 'visite', formuleId: '',
          program: [{ activityId: 'laser_game', pax: 24, participants: 24, games: 1, groupes: [10, 14] }], laserGames: 0, extras: [], channel: 'staff', requiresLanes: false, centerId: 'libramont',
          preference: { activityOrder: ['laser_game'], preferredTimes: { laser_game: '17:30' }, laserGameTimes: ['17:30'], laserPlacement: 'scheduled' },
        });
        const g = grand.json && grand.json.reservation;
        const l = parties.json && parties.json.reservation;
        const lasersDe = (id) => blocsDe(B.base.reservations.get(Number(id))).filter((b) => b.resourceType === 'laser_arena')
          .map((b) => `${b.countIndex}.${b.groupWaveIndex}@${String(b.startTime).slice(0, 5)}x${b.players}${b.sousGroupe ? `g${b.sousGroupe}` : ''}`).sort().join(' ');
        const aPlacerDe = (id) => ((((B.base.reservations.get(Number(id)) || {}).ops_plan || {}).laserPassPlan || {}).pendingUnits || [])
          .map((u) => `${u.unitKey}x${u.pax}${u.sousGroupe ? `g${u.sousGroupe}` : ''}`).join(' ');
        const monte = grand.statut === 201 && Boolean(g) && lasersDe(g.id) === '1.1@15:30x15g1 1.2@15:30x15g2 1.3@16:30x15g3 1.4@16:30x15g4'
          && parties.statut === 201 && Boolean(l) && lasersDe(l.id) === '1.1@17:30x10 1.2@18:00x14';
        ok(monte, 'MONTAGE le grand groupe en 4 groupes de 15 (groupes 1 et 2 au laser a 15:30, 3 et 4 a 16:30) et le laser en groupes de 10 et 14 (17:30, 18:00)',
          { grand: grand.statut, g: g && lasersDe(g.id), parties: parties.statut, message: parties.json && parties.json.message, l: l && lasersDe(l.id) });
        if (monte) {
          await page.evaluate((dossiers) => {
            const liste = window.__FIXTURE__.jours[window.__FIXTURE__.jour];
            dossiers.forEach((d) => { liste.push({ ...d }); state.reservations.push({ ...d }); });
            openStaffPlanningResource('laser');
          }, [g, l]);
          await page.waitForSelector('#laserPlanningGridWrap .lp-dep', { timeout: 15000 });
          const file = () => page.evaluate(() => Array.from(document.querySelectorAll('#laserPlanningGridWrap .lp-jeton'))
            .map((j) => `${j.dataset.laserResId}:${j.dataset.laserUnit} ${j.textContent.replace(/\s+/g, ' ').trim()}`));
          const bandeau = () => page.evaluate(() => ((document.querySelector('#laserPlanningGridWrap .lp-placer__t') || {}).textContent || '').replace(/\s+/g, ' ').trim());
          const attendreBase = async (cond) => { for (let i = 0; i < 100 && !cond(); i += 1) await page.waitForTimeout(100); return cond(); };
          // Retirer au planning laser : le groupe se prend au clavier (M), « Retirer du planning » le rend a la file.
          const retirer = async (id, unite, t) => {
            const sel = `#laserPlanningGridWrap .lp-dep[data-lp-t="${t}"] .lp-g[data-laser-res-id="${id}"][data-laser-unit="${unite}"]`;
            await page.waitForSelector(sel, { timeout: 10000 });
            await page.focus(sel);
            await page.keyboard.press('m');
            await page.waitForSelector('#laserPlanningGridWrap .lp-placer', { timeout: 8000 });
            const dit = await bandeau();
            await page.locator('#laserPlanningGridWrap .lp-placer .lp-btn', { hasText: 'Retirer du planning' }).click();
            return dit;
          };
          // Replacer : toucher le jeton de la file, puis son depart.
          const replacer = async (id, unite, t) => {
            await page.locator(`#laserPlanningGridWrap .lp-jeton[data-laser-res-id="${id}"][data-laser-unit="${unite}"]`).click();
            await page.waitForSelector('#laserPlanningGridWrap .lp-placer', { timeout: 8000 });
            const dit = await bandeau();
            await page.locator(`#laserPlanningGridWrap .lp-dep[data-lp-t="${t}"] .lp-dep__jauge`).click();
            return dit;
          };

          // LE GRAND GROUPE : le laser du groupe 3 (16:30) se retire.
          const cartes = await page.evaluate(() => Array.from(document.querySelectorAll('#laserPlanningGridWrap .lp-dep .lp-g[data-laser-res-id]'))
            .map((e) => `${e.closest('[data-lp-t]').dataset.lpT}:${e.dataset.laserUnit} ${e.querySelector('.lp-card-info') ? e.querySelector('.lp-card-info').textContent.trim() : ''}`));
          ok((await file()).length === 0 && cartes.includes('16.5:1.3 15 j · P1/1 · G3/4 · fin 16:55') && cartes.includes('18:1.2 14 j · P1/1 · V2/2 · fin 18:25'),
            '[J] au depart, rien a placer ; au planning, le groupe 3 se dit « G3/4 » (le groupe du grand groupe), la vague 2 du laser en groupes « V2/2 »', { file: await file(), cartes });
          const prisG = await retirer(g.id, '1.3', 16.5);
          ok(/Groupe Posé 4 \(15\) · groupe 3\/4, à 16:30/.test(prisG), '[J] pris au planning (M), le bandeau dit « Groupe Posé 4 (15) · groupe 3/4, à 16:30 »', prisG);
          await attendreBase(() => aPlacerDe(g.id) === '1.3x15g3');
          await page.waitForFunction((id) => Boolean(document.querySelector(`#laserPlanningGridWrap .lp-jeton[data-laser-res-id="${id}"]`)), g.id, { timeout: 10000 }).catch(() => {});
          const fileG = await file();
          ok(aPlacerDe(g.id) === '1.3x15g3' && lasersDe(g.id) === '1.1@15:30x15g1 1.2@15:30x15g2 1.4@16:30x15g4'
            && fileG.length === 1 && /^\d+:1\.3 15 Groupe Posé 4.* groupe 3\/4$/.test(fileG[0]),
          '[J] « Retirer du planning » : en base le laser du groupe 3 attend (15 joueurs, groupe 3), « Parties à placer » le montre avec ses 15 joueurs et « groupe 3/4 »', { base: aPlacerDe(g.id), lasers: lasersDe(g.id), file: fileG });
          await capture(page, 'j-groupe-3-a-placer');
          const poseG = await replacer(g.id, '1.3', 17);
          ok(/^Où placer Groupe Posé 4 \(15\) · groupe 3\/4 \?/.test(poseG), '[J] le jeton touche, le bandeau dit « Où placer Groupe Posé 4 (15) · groupe 3/4 ? »', poseG);
          await attendreBase(() => aPlacerDe(g.id) === '' && /1\.3@17:00/.test(lasersDe(g.id)));
          await page.waitForFunction(() => !document.querySelector('#laserPlanningGridWrap .lp-jeton'), null, { timeout: 10000 }).catch(() => {});
          const toastG = await page.evaluate(() => ((document.getElementById('toast') || {}).textContent || '').replace(/\s+/g, ' ').trim());
          ok(aPlacerDe(g.id) === '' && lasersDe(g.id) === '1.1@15:30x15g1 1.2@15:30x15g2 1.3@17:00x15g3 1.4@16:30x15g4' && (await file()).length === 0 && /Laser du groupe 3\/4 placé à 17:00/.test(toastG),
            '[J] touche a 17:00 : le groupe 3 y joue, ses 15 joueurs et son groupe gardes, il quitte la file, le toast le dit', { lasers: lasersDe(g.id), aPlacer: aPlacerDe(g.id), file: await file(), toast: toastG });
          // Partir avec le groupe 4 a 16:30 (15 + 15 armes) : Reserver le fait, le planning laser aussi (le geste le prend
          // a 17:00, M, puis touche le depart de 16:30).
          const sel17 = `#laserPlanningGridWrap .lp-dep[data-lp-t="17"] .lp-g[data-laser-res-id="${g.id}"][data-laser-unit="1.3"]`;
          await page.waitForSelector(sel17, { timeout: 10000 });
          await page.focus(sel17);
          await page.keyboard.press('m');
          await page.waitForSelector('#laserPlanningGridWrap .lp-placer', { timeout: 8000 });
          await page.locator('#laserPlanningGridWrap .lp-dep[data-lp-t="16.5"] .lp-dep__jauge').click();
          await attendreBase(() => /1\.3@16:30/.test(lasersDe(g.id)));
          const raisonCommun = await bandeau();
          ok(lasersDe(g.id) === '1.1@15:30x15g1 1.2@15:30x15g2 1.3@16:30x15g3 1.4@16:30x15g4',
            '[J] le groupe 3 rejoint le depart du groupe 4 (16:30, 15 + 15 armes) : comme a Reserver, ils partent ensemble', { lasers: lasersDe(g.id), bandeau: raisonCommun });

          // LE LASER EN GROUPES DE 10 ET 14 : la vague 2 (18:00) se retire et se replace.
          const prisL = await retirer(l.id, '1.2', 18);
          ok(/Laser Groupes \(14\) · vague 2\/2, à 18:00/.test(prisL), '[J] le laser en groupes de 10 et 14 : la vague 2 prise, « Laser Groupes (14) · vague 2/2, à 18:00 »', prisL);
          await attendreBase(() => aPlacerDe(l.id) === '1.2x14');
          await page.waitForFunction((id) => Boolean(document.querySelector(`#laserPlanningGridWrap .lp-jeton[data-laser-res-id="${id}"]`)), l.id, { timeout: 10000 }).catch(() => {});
          const fileL = await file();
          ok(aPlacerDe(l.id) === '1.2x14' && fileL.length === 1 && /^\d+:1\.2 14 Laser Groupes.* vague 2\/2$/.test(fileL[0]),
            '[J] la vague 2 attend en base (14 joueurs), la file la montre avec ses 14 joueurs et « vague 2/2 »', { base: aPlacerDe(l.id), file: fileL });
          await replacer(l.id, '1.2', 18.5);
          await attendreBase(() => aPlacerDe(l.id) === '' && /1\.2@18:30/.test(lasersDe(l.id)));
          await page.waitForFunction(() => !document.querySelector('#laserPlanningGridWrap .lp-jeton'), null, { timeout: 10000 }).catch(() => {});
          ok(aPlacerDe(l.id) === '' && lasersDe(l.id) === '1.1@17:30x10 1.2@18:30x14' && (await file()).length === 0,
            '[J] touchee a 18:30, la vague 2 y joue avec ses 14 joueurs et quitte la file', { lasers: lasersDe(l.id), file: await file() });

          // MODIFIER ET LA BULLE DU COMPTE : les vagues du dossier.
          const lireModifier = async (id) => {
            await page.evaluate((i) => { if (typeof closePos === 'function') closePos(); openPos(i); setTab('modifier'); }, id);
            await page.waitForSelector('#posOverlay .fm', { timeout: 12000 });
            await page.waitForTimeout(300);
            return page.evaluate(() => ({
              vagues: ((document.querySelector('#posOverlay .fm [data-laser-vagues]') || {}).textContent || '').trim(),
              sessions: Array.from(document.querySelectorAll('#posOverlay .fm .fm-pistes .field-hint')).map((p) => p.textContent.replace(/\s+/g, ' ').trim()).join(' | '),
            }));
          };
          const mg = await lireModifier(g.id);
          ok(mg.vagues === '4 vagues de 15 armes', '[J] Modifier du grand groupe : « 4 vagues de 15 armes » (les armes seules disaient 2 vagues de 30)', mg);
          const ml = await lireModifier(l.id);
          ok(ml.vagues === '2 vagues de 10 et 14 armes', '[J] Modifier du laser en groupes de 10 et 14 : « 2 vagues de 10 et 14 armes » (les armes seules disaient 1 vague de 24)', ml);
          // (« Sessions » de Modifier, la ligne d un dossier laser dont le programme ne s adapte pas, lit les memes
          // vagues : 2 pour ces 24 joueurs ; sans dossier, les armes decident)
          const sessions = await page.evaluate((id) => { const r = state.reservations.find((x) => Number(x.id) === Number(id)); return [(taillesDesVaguesLaser(r, 24) || []).length, taillesDesVaguesLaser(null, 24)]; }, l.id);
          ok(sessions[0] === 2 && sessions[1] === null, '[J] les sessions du laser en groupes de 10 et 14 : 2 ; sans dossier, les armes seules', sessions);
          await page.evaluate(() => { if (typeof closePos === 'function') closePos(); });
          // La bulle du compte a 58 et 55 joueurs, et 50 joueurs au laser sur 60, disent les vagues que le serveur
          // ecrirait (son calcul a blanc de la meme modification).
          const vaguesDuServeur = async (pax, laser) => {
            const enBase = B.base.reservations.get(Number(g.id));
            const program = (enBase.program.items || []).map((i) => ({ ...i, pax, participants: i.activityId === 'laser_game' ? laser : pax }));
            const blanc = await serveur.appeler('POST', '/api/staff-reservations', { dryRun: true, centerId: 'libramont', modification: {
              id: g.id, centerId: 'libramont', baseUpdatedAt: new Date(enBase.updated_at).toISOString(), pax, program, date: enBase.date, startTime: String(enBase.start_time).slice(0, 5), lanes: enBase.lanes, requiresLanes: true } });
            const tailles = ((blanc.json && blanc.json.reservation && blanc.json.reservation.opsPlan && blanc.json.reservation.opsPlan.resourceBlocks) || [])
              .filter((b) => b.resourceType === 'laser_arena').sort((a, b) => Number(a.sousGroupe || 0) - Number(b.sousGroupe || 0)).map((b) => b.players);
            const uniques = [...new Set(tailles)];
            return { statut: blanc.statut, refus: blanc.json && blanc.json.refus, tailles, mots: tailles.length > 1 ? `${tailles.length} vagues de ${uniques.length === 1 ? uniques[0] : tailles.join(', ').replace(/, (\d+)$/, ' et $1')} armes` : '' };
          };
          for (const n of [58, 55]) {
            const bulle = await page.evaluate(([id, k]) => { const r = state.reservations.find((x) => Number(x.id) === Number(id)); return r ? preparerCompte(r, k).vagues : ''; }, [g.id, n]);
            const s = await vaguesDuServeur(n, n);
            ok(s.statut === 200 && s.tailles.length === 4 && bulle === s.mots, `[J] la bulle du compte a ${n} joueurs dit les vagues du serveur : « ${s.mots} »`, { bulle, ...s });
          }
          const auLaser = await page.evaluate((id) => { const r = state.reservations.find((x) => Number(x.id) === Number(id)); return r ? vaguesLaserEnMots(50, r, 60) : ''; }, g.id);
          const s50 = await vaguesDuServeur(60, 50);
          ok(s50.statut === 200 && s50.tailles.length === 4 && auLaser === s50.mots, `[J] 50 joueurs au laser sur 60 : la part de chaque groupe, comme le serveur, « ${s50.mots} »`, { auLaser, ...s50 });
        }
        ok(erreurs.length === 0, '[*] zero erreur JavaScript (J)', erreurs.slice(0, 3).join(' | '));
      } finally { await ctx.close(); }
    }

    // =======================================================================
    if (joue('K')) {
      section('[K] MODIFIER APRES LE RETRAIT D UNE VAGUE : LE GRAND GROUPE COMME UN DOSSIER ORDINAIRE');
      const { ctx, page, erreurs } = await ouvrir('vide');
      page.on('dialog', (d) => d.accept().catch(() => {}));
      try {
        const jour = FX.lireFixture('vide').staffState.date;
        const grand = await serveur.appeler('POST', '/api/staff-reservations', {
          name: 'Groupe Posé 4', phone: '0470111222', email: '', notes: '', occasion: '', date: jour, startTime: '15:30', duration: 1, totalDuration: 3, lanes: [], pax: 60, status: 'pending', type: 'visite', formuleId: '',
          program: [{ activityId: 'bowling', pax: 60, participants: 60, duration: 1 }, { activityId: 'laser_game', pax: 60, participants: 60, games: 1 }],
          laserGames: 0, extras: [], channel: 'staff', requiresLanes: true, centerId: 'libramont',
          preference: { activityOrder: ['bowling', 'laser_game'], preferredTimes: { bowling: '15:30', laser_game: '15:30' }, grandGroupe: { nombre: 4, tailles: [15, 15, 15, 15], impose: true,
            heures: [{ bowling: '16:30', laser_game: '15:30' }, { bowling: '16:30', laser_game: '15:30' }, { bowling: '15:30', laser_game: '16:30' }, { bowling: '15:30', laser_game: '16:30' }] } },
        });
        const ordinaire = await serveur.appeler('POST', '/api/staff-reservations', {
          name: 'Laser Quarante', phone: '0470999888', email: '', notes: '', occasion: '', date: jour, startTime: '18:00', duration: 1, totalDuration: 1, lanes: [], pax: 40, status: 'pending', type: 'visite', formuleId: '',
          program: [{ activityId: 'laser_game', pax: 40, participants: 40, games: 1 }], laserGames: 0, extras: [], channel: 'staff', requiresLanes: false, centerId: 'libramont',
          preference: { activityOrder: ['laser_game'], preferredTimes: { laser_game: '18:00' }, laserGameTimes: ['18:00'], laserPlacement: 'scheduled' },
        });
        const version = (id) => new Date(B.base.reservations.get(Number(id)).updated_at).toISOString();
        const passages = (id) => blocsDe(B.base.reservations.get(Number(id)))
          .map((b) => `${b.resourceType === 'bowling_lane' ? 'B' : 'L'}${b.sousGroupe || 0}#${b.countIndex || 1}.${b.groupWaveIndex || 1}@${String(b.startTime).slice(0, 5)}x${b.players}`).sort().join(' ');
        const aPlacerDe = (id) => ((((B.base.reservations.get(Number(id)) || {}).ops_plan || {}).laserPassPlan || {}).pendingUnits || [])
          .map((u) => `${u.unitKey}x${u.pax}${u.sousGroupe ? `g${u.sousGroupe}` : ''}`).join(' ');
        const plus = (texte, ecart) => texte.replace(/@(\d\d):(\d\d)/g, (_, h, m) => { const t = Number(h) * 60 + Number(m) + ecart; return `@${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; });
        const g = grand.json && grand.json.reservation;
        const o = ordinaire.json && ordinaire.json.reservation;
        const retraits = g && o ? [
          await serveur.appeler('PATCH', '/api/staff-reservations', { id: g.id, centerId: 'libramont', baseUpdatedAt: version(g.id), activityMove: { activityId: 'laser_game', unitKey: '1.3', unplace: true } }),
          await serveur.appeler('PATCH', '/api/staff-reservations', { id: o.id, centerId: 'libramont', baseUpdatedAt: version(o.id), activityMove: { activityId: 'laser_game', unitKey: '1.2', unplace: true } }),
        ] : [];
        // (puis le laser du groupe 4 deplace a 17:00, le groupe 3 toujours a placer : le dossier garde l heure du groupe 3,
        // que Modifier reprend le temps du calcul)
        const deplace = retraits.length ? await serveur.appeler('PATCH', '/api/staff-reservations', { id: g.id, centerId: 'libramont', baseUpdatedAt: version(g.id), activityMove: { activityId: 'laser_game', unitKey: '1.4', startTime: '17:00' } }) : null;
        const monte = grand.statut === 201 && ordinaire.statut === 201 && retraits.length === 2 && retraits.every((r) => r.statut === 200) && deplace && deplace.statut === 200
          && aPlacerDe(g.id) === '1.3x15g3' && /L4#1\.4@17:00x15/.test(passages(g.id)) && aPlacerDe(o.id) === '1.2x20';
        ok(monte, 'MONTAGE le grand groupe (le laser du groupe 3 retire, a placer, puis celui du groupe 4 deplace a 17:00) et un laser de 40 joueurs (sa vague 2 retiree, a placer)',
          { grand: grand.statut, ordinaire: ordinaire.statut, retraits: retraits.map((r) => `${r.statut} ${r.json.message || ''}`), deplace: deplace && `${deplace.statut} ${deplace.json.message || ''}`, g: g && `${aPlacerDe(g.id)} | ${passages(g.id)}`, o: o && aPlacerDe(o.id) });
        if (monte) {
          await page.evaluate((dossiers) => {
            const liste = window.__FIXTURE__.jours[window.__FIXTURE__.jour];
            dossiers.forEach((d) => { liste.push({ ...d }); state.reservations.push({ ...d }); });
            renderStaff();
          }, [deplace.json.reservation, retraits[1].json.reservation]);
          // Modifier, en vrais gestes : le champ change, « Enregistrer » ; le serveur ecrit ou refuse.
          const modifier = async (id, champ, valeur) => {
            await page.evaluate((i) => { if (typeof closePos === 'function') closePos(); openPos(i); setTab('modifier'); }, id);
            await page.waitForSelector('#posOverlay .fm', { timeout: 12000 });
            await page.fill(champ, valeur);
            await page.waitForTimeout(900);
            const verdict = await texte(page, '#editVerdict');
            const avant = version(id);
            await page.locator('#posOverlay .es-save').click();
            for (let i = 0; i < 80 && version(id) === avant && !(await page.evaluate(() => state.editError || '')); i += 1) await page.waitForTimeout(100);
            await page.waitForTimeout(300);
            const erreur = await page.evaluate(() => state.editError || '');
            await page.evaluate(() => { if (typeof closePos === 'function') closePos(); });
            return { ecrit: version(id) !== avant, verdict, erreur };
          };
          for (const [nom, id, arrivee] of [['le laser de 40 joueurs', o.id, '18:30'], ['le grand groupe', g.id, '16:00']]) {
            const avantNom = { passages: passages(id), aPlacer: aPlacerDe(id) };
            const m1 = await modifier(id, '#editNameInput', `${nom} renomme`);
            ok(m1.ecrit && !m1.erreur && passages(id) === avantNom.passages && aPlacerDe(id) === avantNom.aPlacer,
              `[K] ${nom} : Modifier le nom s enregistre, rien ne bouge, la vague retiree reste a placer`, { ...m1, passages: passages(id), aPlacer: aPlacerDe(id) });
            const avantHeure = { passages: passages(id), aPlacer: aPlacerDe(id) };
            const m2 = await modifier(id, '#editStartInput', arrivee);
            ok(m2.ecrit && !m2.erreur && passages(id) === plus(avantHeure.passages, 30) && aPlacerDe(id) === avantHeure.aPlacer,
              `[K] ${nom} : l arrivee 30 min plus tard s enregistre, chaque passage pose suit de 30 min, la vague retiree reste a placer avec ses joueurs${id === g.id ? ' et son groupe' : ''}`,
              { ...m2, avant: avantHeure.passages, apres: passages(id), aPlacer: aPlacerDe(id) });
          }
        }
        ok(erreurs.length === 0, '[*] zero erreur JavaScript (K)', erreurs.slice(0, 3).join(' | '));
      } finally { await ctx.close(); }
    }
  } catch (error) {
    ok(false, `exception : ${error.message}`, String(error.stack || '').split('\n').slice(0, 4).join(' | '));
  } finally {
    if (browser) await browser.close();
    if (http) http.close();
  }

  console.log(rouges
    ? `\ngrands-groupes-check: ${rouges} ROUGE(S)`
    : '\ngrands-groupes-check: ALL OK - un grand groupe se coupe au comptoir comme en ligne ; au bowling et au laser il garde le plan et le prix d avant tant qu ils tiennent, tourne au choix du comptoir au prix affiche, d office quand le plan d avant ne tient pas ; il se lit au ticket, au planning et a la fiche, et un plan impossible propose l heure qui tient');
  process.exit(rouges ? 1 : 0);
}

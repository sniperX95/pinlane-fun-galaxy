// LES NOMBRES ET LES HEURES SE TAPENT (2026-11-22).
//
// Ansar au comptoir : « Pouvoir mettre nombre écrire direct dessus sans que ça change direct partout
// pour une resa quand on réserve quand on a genre 60 pers et qu'on veut mettre 20 bowling 30 laser Game
// on peut pas écrire dessus direct on doit jouer avec les plus + et - c trop long », puis : « Possibilité
// de mettre l'heure qu'on veut pour chaque activité [...] à la minute [...] dans réservation dans
// modifier après une resa et uniquement côté staff ».
//
//   [A1] RESERVER, LE NOMBRE SE TAPE : un groupe de 60, le compteur du bowling touche devient un
//        champ (tout le nombre selectionne, clavier des chiffres), 20 puis Entree : le bowling a 20,
//        le laser et le groupe ne bougent pas, le nombre revient, le focus dessus ;
//   [A2] le laser a 30 (la sortie du champ valide) : les pistes suivent (4 pour 20 joueurs), les
//        armes aussi, le groupe reste 60 ;
//   [A3] un nombre impossible se dit sous le compteur, rien ne bouge : 70 (plus que le groupe), 0 ;
//   [A4] Echap laisse le nombre d avant, la fenetre reste ouverte ;
//   [A5] un nombre tape puis « + » : ce nombre plus un, jamais le groupe plus un ;
//   [A6] le groupe change ensuite (50) : les activites reglees gardent leur nombre ;
//   [C1] PLUS QUE L ACTIVITE N ACCUEILLE : un minigolf qui accueille 12 joueurs, 15 tape se refuse
//        sous son compteur (« 12 joueurs au plus »), rien ne bouge ; 10 se prend ;
//   [A7] le prix suit (le serveur : 156 EUR de bowling, 300 EUR de laser) ;
//   [A8] « Créer » ecrit 26 au bowling, 30 au laser, un groupe de 50 ;
//   [M1] MODIFIER, LE NOMBRE SE TAPE : le compteur du bowling touche devient un champ, 18 puis
//        Entree, le prix suit ;
//   [M2] LE GROUPE TAPE NE CHANGE PAS TOUT : 50 -> 45 frappe par frappe, le bowling regle reste a 18,
//        le laser qui suivait le groupe le suit (45) ;
//   [M3] Echap dans le groupe rend 50, la fiche reste ouverte ;
//   [M4] 80 au laser se refuse avec sa raison, rien ne bouge ;
//   [B1] RESERVER, « AUTRE HEURE » : la touche du bowling s appelle ainsi, sa page porte un champ a la
//        minute (type time, pas de 60 s) ; la fenetre tient sans defiler a 1366 x 768 ;
//   [B2] 16:10 tape puis Entree : le serveur juge le dossier a blanc, le moteur a 16:10 (l heure posee
//        part telle quelle), elle se prend, le ticket dit 16:10 a 17:10 ;
//   [B3] le laser a 17:25 et un minigolf a 18:40, chacun par son champ ;
//   [B8] LA COLONNE REVIENT EN PLACE : le panneau des heures du minigolf (3e activite) fait defiler la
//        colonne pour se montrer ; 18:40 prise, la colonne reprend sa position d avant (1366 x 768) ;
//   [B4] 23:50 au bowling ne tient pas : le champ dit pourquoi, rien ne bouge ;
//   [B5] « Créer » : le dossier a le bowling de 16:10 a 17:10, le laser a 17:25, le minigolf pose a
//        18:40, l arrivee a 16:10 ;
//   [B6] le planning et la fiche montrent 16:10 et 17:25 tels quels ;
//   [F1] L EN-TETE DE LA FICHE finit a la vraie fin de la derniere activite : « 16:10 → 19:25 » (le
//        minigolf pose de 18:40 a 19:25), plus « 18:35 » (le minigolf compte comme temps libre) ;
//   [F2] a la grille aussi : le meme dossier, minigolf pose de 18:30 a 19:15, finit a 19:15 ;
//   [B7] MODIFIER A LA MINUTE : le champ d heure du bowling accepte 18:05, « Enregistrer » l ecrit ;
//   [S1] LE SERVEUR : un groupe qui change ne fait plus refuser un dossier a la minute, le bowling
//        reste a 16:10 et le laser a 17:20 ;
//   [S2] une minute qui ne tient plus (toutes les pistes prises des 17:00) se refuse avec sa raison,
//        jamais l heure du moteur a sa place ;
//   [P1] LA MINUTE SE JUGE A SA MINUTE : toutes les pistes prises de 15:10 a 16:10, un bowling pose a
//        16:10 se cree (la demi-heure d avant, 16:00, le faisait refuser) ;
//   [P2] les pistes du moteur ne vont pas a la minute : 3 a 8 prises jusqu a 16:10, 1 et 2 des 17:00 ;
//        le bowling de 16:10 a 17:10 prend deux pistes cote a cote parmi 3 a 8 ;
//   [P3] les armes a la minute : 25 joueurs au laser de 17:00 a 17:25, 8 joueurs poses a 17:25 se
//        creent (a 17:00, il manquait des armes) ;
//   [P4] UN BOWLING SEUL A LA MINUTE, replanifie (un joueur de plus) : le moteur le place a 16:00 sur les
//        pistes 1 et 2, prises a 17:00 ; reposé a 16:10, il prend deux autres pistes libres, cote a cote ;
//   [S3] le client et l assistant gardent la grille : un bowling public a 15:15 et un glisser sans la
//        minute de l equipe se refusent ;
//   [R1] OUVRIR MODIFIER NE CHANGE AUCUNE HEURE (Libramont, 22/11 a 11:55, dossier 2053 « Radelet » :
//        « À enregistrer : Arrivée 14:30 → 10:30 » sans geste) : l onglet ouvert, puis l heure de l en-tete
//        touchee (le champ Arrivee prend le focus), la barre « À enregistrer » reste vide ;
//   [R2] quatre fleches vers le bas pour descendre dans la fiche ne reculent plus l arrivee de quatre
//        heures (la cause du 10:30) ;
//   [R3] une arrivee deja passee se dit d abord : « 10:30 est déjà passé : il est 15:10. » ;
//   [L1] LA PARTIE SE PARTAGE QUAND LES ARMES SUFFISENT : le laser du groupe (7) passe a 17:25, la partie
//        de Boucquiaux (4) part a 17:30 ; le verdict dit « Joue avec Boucquiaux à 17:30. », « Enregistrer »
//        ecrit 17:30 ; la fiche dit « avec Boucquiaux », la vague « 1 vague de 11 armes » ;
//        « Enregistrer » le redit et referme la fiche (jamais « Pas enregistré » pour une partie calee) ;
//   [L2] les armes manquent (25 joueurs a 18:30) : le refus le dit en clair, il en reste 5, la prochaine
//        partie libre ;
//   [L3] l autre groupe a choisi « Pour vous seuls » (19:30) : le refus le dit, avec la prochaine partie
//        libre ; jamais « 2/1 lancement » ni « joueurs/30 » ;
//   [*]  zero erreur JavaScript.
// La console reelle (journee « pic » de scripts/planning-v3-fixtures.js, samedi 16 janvier 2027 a
// 15:10), ses POST au VRAI handler api/staff-reservations.js sur la base en memoire de
// scripts/reserver-banc.js (scripts/comptoir-banc.js) : aucune base reelle, aucun reseau.
//
// CONTRE-PREUVES : `--contre-preuves` sert le code casse expres, une mutation a la fois (en memoire,
// le disque n est jamais touche) et exige que chacune rougisse sa cible. `--seul=A,C,M,B,S,P,R,L` ne joue que
// ces lettres ; `--ancres` verifie seulement que chaque ancre existe une fois.
// SAISIE_CAPTURES=<dossier> : les images (theme clair).
'use strict';
const fs = require('fs');
const path = require('path');
const eclats = require('./gates-eclats.js');
const { trancher } = require('./gates-tranche');
const C = require('./comptoir-banc.js');
const { chromium } = require('playwright-core');

const { B, FX, ROOT, JOUR } = C;
const PORT = Number(process.env.PINLANE_SAISIE_PORT || 5481);
const CASSE = String(process.env.SAISIE_CASSE || '');
const CAPTURES = process.env.SAISIE_CAPTURES ? path.resolve(process.env.SAISIE_CAPTURES) : '';
const lf = (t) => String(t).split('\r\n').join('\n');
const argument = (nom) => { const a = process.argv.find((x) => x === `--${nom}` || x.startsWith(`--${nom}=`)); return a ? (a.includes('=') ? a.split('=')[1] : true) : null; };

const APP = 'assets/app-main.js';
const MOUVEMENT = 'lib/reservation-activity-move.js';
const BASE = 'lib/database.js';
const MOTEUR = 'lib/ops-engine.js';
const FENETRE = 'lib/reserver-fenetre.js';
const HEURES = 'lib/heures-posees.js';
const B2 = '[B2] 16:10 : jugee a blanc a sa minute (moteur a 16:10), prise, le ticket dit 16:10 a 17:10';
const OPS = 'lib/reservation-ops.js';
const MUTATIONS = [
  { nom: 'nombre-en-texte', lettre: 'A', cible: '[A1] le compteur du bowling touche devient un champ, tout le nombre selectionne, clavier des chiffres', fichier: APP, de: '${saisie ? rsNombreHtml(saisie, valeur, aria) : `<b>${valeur}</b>`}', vers: '<b>${valeur}</b>' },
  { nom: 'champ-retient-sa-zone', lettre: 'A', cible: '[A1] 20 puis Entree : bowling 20, laser et groupe a 60, le nombre revient avec le focus', fichier: APP, de: '  if (champ && document.activeElement === champ) champ.blur();\n}\n\nfunction rsRendreLeNombre(cle) {', vers: '}\n\nfunction rsRendreLeNombre(cle) {' },
  { nom: 'plus-que-le-groupe', lettre: 'A', cible: '[A3] 70 au laser (plus que le groupe) : la raison sous le compteur, rien ne bouge', fichier: APP, de: '  if (n > groupe) return `${nom} : ${groupe} au plus, le groupe compte ${rvPluriel(', vers: '  if (n > groupe * 9) return `${nom} : ${groupe} au plus, le groupe compte ${rvPluriel(' },
  { nom: 'echap-valide', lettre: 'A', cible: '[A4] Echap laisse le nombre d avant, la fenetre reste ouverte', fichier: APP, de: '  if (b.saisie) return rsSaisieAnnuler();\n', vers: '' },
  { nom: 'plus-depuis-le-groupe', lettre: 'A', cible: '[A5] 25 tape puis « + » : 26, le groupe ne bouge pas', fichier: APP, de: '  rsJoueursBloc(id, getQuickVisitParticipants(id) + (Math.trunc(Number(delta)) || 0));', vers: '  rsJoueursBloc(id, Number(quickBookState.pax) + (Math.trunc(Number(delta)) || 0));' },
  { nom: 'compteur-modifier-en-texte', lettre: 'M', cible: '[M1] Modifier : le nombre du bowling se tape (18 puis Entree), le prix suit', fichier: APP, de: ' onclick="ouvrirJoueursEdition(\'${sid}\')"', vers: '' },
  { nom: 'modifier-suit-a-chaque-frappe', lettre: 'M', cible: '[M2] le groupe tape 45 frappe par frappe : le bowling regle reste a 18, le laser suit le groupe', fichier: APP, de: '  if (!Array.isArray(e.suiventLeGroupe)) {\n    const reglees = Array.isArray(e.joueursRegles) ? e.joueursRegles : [];\n    e.suiventLeGroupe = actives.filter(([id, options]) => !reglees.includes(id) && (!(Number(options.participants) > 0) || Math.trunc(Number(options.participants)) === reference)).map(([id]) => id);\n  }', vers: '  {\n    e.suiventLeGroupe = actives.filter(([id, options]) => !(Number(options.participants) > 0) || participantsLigneProgramme(options, reference) === reference).map(([id]) => id);\n  }' },
  { nom: 'echap-groupe-sans-retour', lettre: 'M', cible: '[M3] Echap dans le groupe rend 50, la fiche reste ouverte', fichier: APP, de: "  if (event.key !== 'Escape' || !e || !e.groupeAvantSaisie || !champ) return;", vers: '  return;' },
  { nom: 'pas-d-autre-heure', lettre: 'B', cible: '[B1] « Autre heure » ouvre un champ a la minute, la fenetre tient sans defiler', fichier: APP, de: 'function rsMinuteHtml(id, courante) {\n', vers: "function rsMinuteHtml(id, courante) {\n  return '';\n" },
  { nom: 'ancre-a-la-minute', lettre: 'B', cible: B2, fichier: APP, de: 'function rvALaMinute(reservation, programme) {\n', vers: "function rvALaMinute(reservation, programme) {\n  return '';\n" },
  { nom: 'minute-refusee-au-glisser', lettre: 'B', cible: '[B7] Modifier : le champ d heure du bowling accepte 18:05 et « Enregistrer » l ecrit', fichier: MOUVEMENT, serveur: true, de: "(activity === 'bowling' && !aLaMinute && target % 30)", vers: "(activity === 'bowling' && target % 30)" },
  { nom: 'pris-sans-verdict', lettre: 'B', cible: '[B4] 23:50 au bowling : le champ dit pourquoi, rien ne bouge', fichier: APP, de: '  const corps = rsCorpsALaMinute(id, heure, mode);\n', vers: '  rsPrendreHeureALaMinute(id, heure, mode);\n  return;\n  const corps = rsCorpsALaMinute(id, heure, mode);\n' },
  { nom: 'creation-sur-la-grille', lettre: 'B', cible: '[B5] le dossier cree : bowling 16:10 a 17:10, laser 17:25, minigolf pose a 18:40, arrivee 16:10', fichier: BASE, serveur: true, de: "  if (payload.channel === 'staff') return;\n", vers: '' },
  { nom: 'modifier-au-pas-de-30', lettre: 'B', cible: '[B7] Modifier : le champ d heure du bowling accepte 18:05 et « Enregistrer » l ecrit', fichier: APP, de: 'type="time" step="60" value="${escapeHtml(valeur)}" data-heure-champ=', vers: 'type="time" step="1800" value="${escapeHtml(valeur)}" data-heure-champ=' },
  { nom: 'replan-sur-la-grille', lettre: 'S', cible: '[S1] un joueur de plus : le dossier a la minute se replanifie, bowling 16:10, laser 17:20', fichier: OPS, serveur: true, de: '    const aLaMinute = staff && (options.aLaMinute === true || (isEdit && aLaMinuteDuDossier(request)));', vers: '    const aLaMinute = staff && options.aLaMinute === true;' },
  { nom: 'minute-perdue-sans-un-mot', lettre: 'S', cible: '[S2] le bowling a 16:10 ne tient plus : le changement se refuse avec sa raison', fichier: OPS, serveur: true, de: '  if (ignoreReservationId && staff && aLaMinuteDuDossier(request) && planResult && planResult.ok === false && recommended) {', vers: '  if (false) {' },
  { nom: 'public-a-la-minute', lettre: 'S', cible: '[S3] le client et l assistant gardent la grille (15:15 refuse, glisser sans la minute refuse)', fichier: BASE, serveur: true, de: "  if (payload.channel === 'staff') return;\n", vers: "  if (payload.channel !== 'aucun') return;\n" },
  { nom: 'minute-jugee-a-la-demi-heure', lettre: 'P', cible: '[P1] toutes les pistes prises de 15:10 a 16:10 : le bowling pose a 16:10 se cree', fichier: MOTEUR, serveur: true, de: '    if (!aLaMinute && start % PROGRAM_GRID_MINUTES !== 0) {', vers: '    if (start % PROGRAM_GRID_MINUTES !== 0) {' },
  { nom: 'reserver-sans-la-minute', lettre: 'P', cible: '[P2] 1 et 2 prises a 17:00 : le bowling de 16:10 prend deux pistes cote a cote parmi 3 a 8', fichier: FENETRE, serveur: true, de: "...(ancresALaMinute(heuresPosees) ? { aLaMinute: true } : {})", vers: '' },
  // (la garde des parties posees ignore aussi la rotation d un grand groupe depuis f961ef5 : l ancre la
  // garde, seule la minute du comptoir part)
  { nom: 'laser-a-la-demi-heure', lettre: 'P', cible: '[P3] 25 joueurs au laser jusqu a 17:25 : 8 joueurs poses a 17:25 se creent', fichier: MOTEUR, serveur: true, de: '  if (!laserOnSite && !aLaMinute && !rotation) {', vers: '  if (!laserOnSite && !rotation) {' },
  { nom: 'pistes-du-moteur-gardees', lettre: 'P', cible: '[P4] le bowling seul pose a 16:10 se replanifie sur deux autres pistes libres, cote a cote', fichier: HEURES, serveur: true, de: '    if (!autres || autres.length !== voulues) throw error;\n    return essayer({ ...move, lanes: autres });', vers: '    throw error;' },
  { nom: 'fin-sans-l-heure-posee', lettre: 'B', cible: '[F1] l en-tete de la fiche finit a 19:25, la fin du minigolf pose a 18:40', fichier: APP, de: '(step.avant === true || step.heurePosee === true) && step.flexible !== true', vers: 'step.avant === true && step.flexible !== true' },
  { nom: 'colonne-reste-defilee', lettre: 'B', cible: '[B8] 18:40 prise au minigolf : la colonne reprend sa position d avant le panneau', fichier: APP, de: 'function rsRemettreLaColonne(b) {\n', vers: 'function rsRemettreLaColonne(b) {\n  return;\n' },
  { nom: 'plus-que-l-activite', lettre: 'C', cible: '[C1] 15 au minigolf qui accueille 12 joueurs : la raison sous le compteur, rien ne bouge', fichier: APP, de: '  if (n > bornes.max) return `${nom} : ${rvPluriel(bornes.max, unite)} au plus.`;', vers: '  if (n > bornes.max * 9) return `${nom} : ${rvPluriel(bornes.max, unite)} au plus.`;' },
  { nom: 'ouverture-change-l-heure', lettre: 'R', cible: '[R1] Modifier ouvert, puis l heure de l en-tete touchee : la barre « À enregistrer » reste vide', fichier: APP, de: '  const etat = { ...reservation };\n  etat.lanesStr = pistesDeLaFormuleSeule(reservation).join(\', \');', vers: '  const etat = { ...reservation, startTime: \'10:30\' };\n  etat.lanesStr = pistesDeLaFormuleSeule(reservation).join(\', \');' },
  { nom: 'arrivee-aux-fleches', lettre: 'R', cible: '[R2] quatre fleches vers le bas ne reculent pas l arrivee', fichier: APP, de: "  if (!['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(event.key)) return;\n", vers: '  return;\n' },
  { nom: 'arrivee-passee-muette', lettre: 'R', cible: '[R3] 10:30 deja passee : le verdict le dit d abord', fichier: APP, de: '  if (arriveePassee) return { erreur: arriveePassee };\n', vers: '' },
  { nom: 'partie-jamais-partagee', lettre: 'L', cible: '[L1] 17:25 se cale sur la partie de Boucquiaux : « Joue avec Boucquiaux à 17:30. »', fichier: BASE, serveur: true, de: '  if (!equipe || !plan || !Array.isArray(plan.resourceBlocks)) return null;', vers: '  return null;' },
  { nom: 'armes-en-chiffres', lettre: 'L', cible: '[L2] 25 joueurs a 18:30 : le refus dit en clair qu il reste 5 armes, et la prochaine partie libre', fichier: BASE, serveur: true, de: '      if (!equipe) throw new Error(`Laser Game complet sur ce créneau (', vers: '      if (true) throw new Error(`Laser Game complet sur ce créneau (' },
  { nom: 'pour-eux-seuls-tu', lettre: 'L', cible: '[L3] « Pour vous seuls » a 19:30 : le refus le dit, avec la prochaine partie libre', fichier: BASE, serveur: true, de: '    seuls: bloc.arene === \'seuls\',\n', vers: '    seuls: false,\n' },
  { nom: 'partie-calee-pas-tenue', lettre: 'L', cible: '[L1] « Enregistrer » dit « Joue avec Boucquiaux à 17:30. » et referme la fiche, jamais « Pas enregistré »', fichier: APP, de: "    return d.point.activityId === 'laser_game' && partieCaleeEdition(dossier, d, apres);", vers: '    return false;' },
  { nom: 'assistant-a-la-minute', lettre: 'S', cible: '[S3] le client et l assistant gardent la grille (15:15 refuse, glisser sans la minute refuse)', fichier: MOUVEMENT, serveur: true, de: 'toutLeJeu = false, aLaMinute = false, ensemble = [] } = {}) {', vers: 'toutLeJeu = false, aLaMinute = true, ensemble = [] } = {}) {' },
];
const LES_MUTATIONS = new Map(MUTATIONS.map((m) => [m.nom, m]));

let echecs = 0;
let reussis = 0;
const mutation = CASSE ? LES_MUTATIONS.get(CASSE) : null;
if (CASSE && !mutation) { console.error(`saisie-nombres-heures-check : contre-preuve inconnue ${CASSE}`); process.exit(2); }
const compteAncre = (m) => lf(fs.readFileSync(path.join(ROOT, m.fichier), 'utf8')).split(m.de).length - 1;
if (mutation && compteAncre(mutation) !== 1) { console.error(`saisie-nombres-heures-check : la contre-preuve ${CASSE} ne trouve pas son ancre une seule fois`); process.exit(2); }

function ok(cond, label, detail) {
  if (cond) { reussis += 1; console.log(`ok    ${label}`); return true; }
  echecs += 1;
  console.log(`FAIL  ${label}${detail !== undefined ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  // Une contre-preuve s arrete des que sa cible rougit : la suite du scenario n a rien a lui apprendre.
  if (mutation && label === mutation.cible) throw Object.assign(new Error(`cible rouge : ${label}`), { cibleRouge: true });
  return false;
}

function transformer(rel, texte) {
  if (!mutation || mutation.serveur || mutation.fichier !== rel) return texte;
  return lf(texte).split(mutation.de).join(mutation.vers);
}

const serveur = C.monterServeur({ mutations: mutation && mutation.serveur ? [{ fichier: mutation.fichier, de: mutation.de, vers: mutation.vers }] : [] });
const ouvrir = (browser) => C.ouvrirConsole(browser, serveur, { port: PORT, theme: 'light', reservations: () => [] });
const finir = async (m, quoi) => { ok(m.erreurs.length === 0, `[*] zero erreur JavaScript (${quoi})`, m.erreurs.slice(0, 3).join(' | ')); await m.ctx.close(); };
const attendre = (page, fn, arg, timeout = 8000) => page.waitForFunction(fn, arg, { timeout }).then(() => true, () => false);
async function capture(page, nom) {
  if (!CAPTURES) return;
  fs.mkdirSync(CAPTURES, { recursive: true });
  await page.screenshot({ path: path.join(CAPTURES, nom) });
}
const planDe = (r) => (r && (typeof r.ops_plan === 'string' ? JSON.parse(r.ops_plan) : r.ops_plan)) || {};
const programmeDe = (r) => { const p = r && (typeof r.program === 'string' ? JSON.parse(r.program) : r.program); return (p && Array.isArray(p.items) ? p.items : Array.isArray(p) ? p : []); };
async function dossierCree(page, nom) {
  for (let i = 0; i < 80; i += 1) {
    const r = [...B.base.reservations.values()].find((x) => x.name === nom);
    if (r) return r;
    await page.waitForTimeout(100);
  }
  return null;
}

// ---------------------------------------------------------------------------
// La fenetre Reserver.
// ---------------------------------------------------------------------------
const lireR = (page) => page.evaluate(() => {
  const s = quickBookState;
  const b = s ? rsEtat() : null;
  if (!s || !b) return { ouverte: false, pax: null, bowling: null, laser: null, heures: {}, ticket: '', prix: {}, plan: null };
  const plan = rvPlanCourant();
  const actif = document.activeElement;
  const pistes = [...document.querySelectorAll('#rsZ-bowling .rs-pas')].find((p) => /^Pistes/.test(p.getAttribute('aria-label') || ''));
  return {
    pax: Number(s.pax),
    bowling: rvActivites().includes('bowling') ? getQuickVisitParticipants('bowling') : null,
    laser: rvActivites().includes('laser_game') ? getQuickVisitParticipants('laser_game') : null,
    saisie: b.saisie || '',
    bulle: ((document.querySelector('#quickBookOverlay .rs-pas-dit') || {}).textContent || '').trim(),
    champ: Boolean(document.getElementById('rsSaisie')),
    focus: actif ? ((actif.dataset && actif.dataset.saisie) || actif.id || actif.tagName) : '',
    ouverte: Boolean(document.querySelector('#quickBookOverlay:not(.hidden) .qb-modal.rv')),
    q: b.q,
    heures: Object.fromEntries(Object.entries(rvHeuresDesLignes()).map(([k, v]) => [k, v && v.heure])),
    ticket: ((document.getElementById('rsLignes') || {}).innerText || '').replace(/\s+/g, ' '),
    minute: b.minute ? { ...b.minute } : null,
    dit: ((document.querySelector('#quickBookOverlay .rs-minute-dit') || {}).textContent || '').trim(),
    pistes: pistes ? Number((pistes.querySelector('b') || {}).textContent) : null,
    prix: plan && Array.isArray(plan.lignesPrix) ? Object.fromEntries(plan.lignesPrix.map((l) => [l.activite, l.prix])) : {},
    plan: plan ? { dispo: plan.disponible, refus: plan.refus || '' } : null,
  };
});

async function groupe(page, n) {
  await page.locator('#qbPax').fill(String(n));
  await page.locator('#qbPax').press('Enter');
  await page.waitForTimeout(400);
}

async function scenarioA(browser) {
  const m = await ouvrir(browser);
  try {
    const { page } = m;
    await page.locator('.btn-new').click();
    await page.waitForTimeout(400);
    await groupe(page, 60);
    await page.locator('#rsZ-bowling .rs-h.is-on').first().click();
    await page.waitForTimeout(400);
    if (await page.locator('#rsAjout-laser_game').count()) await page.locator('#rsAjout-laser_game').click();
    await attendre(page, () => rvActivites().includes('laser_game') && getQuickVisitParticipants('laser_game') === 60);
    const depart = await lireR(page);
    const nombre = (id) => page.locator(`#quickBookOverlay [data-saisie="j:${id}"]`);
    if (await nombre('bowling').count()) await nombre('bowling').click();
    const ouvert = await page.evaluate(() => { const c = document.getElementById('rsSaisie'); return c && { valeur: c.value, debut: c.selectionStart, fin: c.selectionEnd, clavier: c.getAttribute('inputmode'), focus: document.activeElement === c }; });
    ok(Boolean(ouvert) && ouvert.valeur === '60' && ouvert.debut === 0 && ouvert.fin === 2 && ouvert.clavier === 'numeric' && ouvert.focus, '[A1] le compteur du bowling touche devient un champ, tout le nombre selectionne, clavier des chiffres', { depart: { bowling: depart.bowling, laser: depart.laser }, ouvert });
    await page.keyboard.type('20');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    const a1 = await lireR(page);
    ok(a1.bowling === 20 && a1.laser === 60 && a1.pax === 60 && !a1.champ && a1.focus === 'j:bowling', '[A1] 20 puis Entree : bowling 20, laser et groupe a 60, le nombre revient avec le focus', a1);
    await nombre('laser_game').click();
    await page.keyboard.type('30');
    await page.keyboard.press('Tab');
    await attendre(page, () => { const p = rvPlanCourant(); return Boolean(p && (p.lignesPrix || []).some((l) => l.activite === 'laser_game' && l.prix === 300)); }, null, 10000);
    const a2 = await lireR(page);
    ok(a2.laser === 30 && a2.bowling === 20 && a2.pax === 60 && !a2.champ && a2.pistes === 4 && /20 joueurs sur 60/.test(a2.ticket) && /30 joueurs sur 60/.test(a2.ticket), '[A2] laser 30 (sortie du champ) : 4 pistes pour 20 joueurs, 30 armes, le groupe reste 60', a2);
    ok(a2.prix.bowling === 156 && a2.prix.laser_game === 300, '[A7] le prix suit : 156 EUR de bowling (4 pistes), 300 EUR de laser (30 joueurs)', a2.prix);
    await capture(page, '1-reserver-60-20-bowling-30-laser.png');
    await nombre('laser_game').click();
    await page.keyboard.type('70');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    const a3 = await lireR(page);
    ok(a3.laser === 30 && a3.pax === 60 && a3.bowling === 20 && /60 au plus/.test(a3.bulle) && /Changez d’abord le nombre du groupe/.test(a3.bulle), '[A3] 70 au laser (plus que le groupe) : la raison sous le compteur, rien ne bouge', a3);
    await capture(page, '2-reserver-nombre-impossible.png');
    await nombre('laser_game').click();
    await page.keyboard.type('0');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    const a3b = await lireR(page);
    ok(a3b.laser === 30 && /au moins/.test(a3b.bulle), '[A3] 0 au laser : « au moins », rien ne bouge', a3b);
    await nombre('bowling').click();
    await page.keyboard.type('5');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const a4 = await lireR(page);
    ok(a4.bowling === 20 && a4.ouverte && !a4.champ && a4.focus === 'j:bowling', '[A4] Echap laisse le nombre d avant, la fenetre reste ouverte', a4);
    await nombre('bowling').click();
    await page.keyboard.type('25');
    await page.locator('#quickBookOverlay [aria-label="Joueurs, Bowling, un de plus"]').click();
    await page.waitForTimeout(400);
    const a5 = await lireR(page);
    ok(a5.bowling === 26 && a5.pax === 60 && a5.laser === 30, '[A5] 25 tape puis « + » : 26, le groupe ne bouge pas', a5);
    await groupe(page, 50);
    const a6 = await lireR(page);
    ok(a6.pax === 50 && a6.bowling === 26 && a6.laser === 30, '[A6] le groupe passe a 50 : le bowling garde 26, le laser 30', a6);
    await C.pret(page);
    await page.locator('#qbPhone').fill('0470 12 34 56');
    await page.locator('#qbName').fill('Banc Nombres');
    await page.waitForTimeout(200);
    await page.locator('#rvCreer').click();
    const r = await dossierCree(page, 'Banc Nombres');
    const lignes = programmeDe(r).map((l) => `${l.activityId}:${l.participants}`).sort().join(' ');
    ok(Boolean(r) && Number(r.pax) === 50 && lignes === 'bowling:26 laser_game:30', '[A8] « Créer » : bowling 26, laser 30, groupe de 50', r ? { pax: r.pax, lignes } : 'aucun dossier');
  } catch (error) {
    if (!error.cibleRouge) ok(false, '[A] scenario interrompu', String(error.message || error).slice(0, 300));
  } finally { await finir(m, 'A'); }
}

// ---------------------------------------------------------------------------
// Plus que l activite n accueille.
// ---------------------------------------------------------------------------
async function scenarioC(browser) {
  const m = await ouvrir(browser);
  try {
    const { page } = m;
    // (un centre dont le minigolf accueille 12 joueurs : le reglage maxPax du catalogue)
    await page.evaluate(() => setCenterActivities(getCenterActivities().map((a) => (a.id === 'minigolf_blacklight' ? { ...a, maxPax: 12, capacityPerUnit: null } : a))));
    await page.locator('.btn-new').click();
    await page.waitForTimeout(400);
    await groupe(page, 20);
    await page.locator('#rsT-minigolf_blacklight').click();
    await attendre(page, () => rvActivites().includes('minigolf_blacklight'));
    const lire = () => page.evaluate(() => ({ golf: getQuickVisitParticipants('minigolf_blacklight'), pax: Number(quickBookState.pax), bulle: ((document.querySelector('#quickBookOverlay .rs-pas-dit') || {}).textContent || '').trim(), champ: Boolean(document.getElementById('rsSaisie')) }));
    const depart = await lire();
    const nombre = page.locator('#quickBookOverlay [data-saisie="j:minigolf_blacklight"]');
    await nombre.click();
    await page.keyboard.type('15');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    const c1 = await lire();
    ok(depart.golf === 12 && c1.golf === 12 && c1.pax === 20 && /12 joueurs au plus/.test(c1.bulle) && !/groupe compte/.test(c1.bulle), '[C1] 15 au minigolf qui accueille 12 joueurs : la raison sous le compteur, rien ne bouge', { depart, c1 });
    await page.locator('#quickBookOverlay [data-saisie="j:minigolf_blacklight"]').click();
    await page.keyboard.type('10');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    const c2 = await lire();
    ok(c2.golf === 10 && c2.pax === 20 && !c2.bulle, '[C1] 10 au minigolf se prend, le groupe reste 20', c2);
  } catch (error) {
    if (!error.cibleRouge) ok(false, '[C] scenario interrompu', String(error.message || error).slice(0, 300));
  } finally { await finir(m, 'C'); }
}

// ---------------------------------------------------------------------------
// Modifier.
// ---------------------------------------------------------------------------
const lireM = (page) => page.evaluate(() => {
  const e = state.editState;
  const p = e && e.programmeEdite;
  return {
    pax: e ? Number(e.pax) : null,
    bowling: p ? participantsLigneProgramme(p.bowling, e.pax) : null,
    laser: p ? participantsLigneProgramme(p.laser_game, e.pax) : null,
    champ: Boolean(document.querySelector('#posOverlay input[data-saisie-joueurs]')),
    dit: ((document.querySelector('#posOverlay .dossier-saisie-dit') || {}).textContent || '').trim(),
    prix: Number(String((document.getElementById('editPriceInput') || {}).value || '').replace(',', '.')),
    groupe: (document.getElementById('editPaxInput') || {}).value,
    ouverte: Boolean(document.getElementById('posOverlay') && !document.getElementById('posOverlay').classList.contains('hidden')),
  };
});

async function creerParLaFenetre(page, { pax, nom, telephone }) {
  await page.locator('.btn-new').click();
  await page.waitForTimeout(400);
  await groupe(page, pax);
  await page.locator('#rsZ-bowling .rs-h.is-on').first().click();
  await page.waitForTimeout(400);
  if (await page.locator('#rsAjout-laser_game').count()) await page.locator('#rsAjout-laser_game').click();
  await attendre(page, () => rvActivites().includes('laser_game'));
  await C.pret(page);
  await page.locator('#qbPhone').fill(telephone);
  await page.locator('#qbName').fill(nom);
  await page.waitForTimeout(200);
  await page.locator('#rvCreer').click();
  return dossierCree(page, nom);
}

async function ouvrirModifier(page, id) {
  await page.waitForTimeout(600);
  await page.evaluate((rid) => openPos(rid), Number(id));
  await page.waitForTimeout(500);
  await page.evaluate(() => { const tab = [...document.querySelectorAll('#posOverlay button, #posOverlay [role="tab"]')].find((t) => /^Modifier$/i.test((t.textContent || '').trim())); if (tab) tab.click(); });
  await attendre(page, () => Boolean(state.editState && state.editState.programmeEdite));
}

async function scenarioM(browser) {
  const m = await ouvrir(browser);
  try {
    const { page } = m;
    const r = await creerParLaFenetre(page, { pax: 50, nom: 'Banc Modifier', telephone: '0470 12 34 59' });
    ok(Boolean(r), '[M] MONTAGE : le dossier de 50 avec bowling et laser est cree', r ? r.id : 'aucun');
    await ouvrirModifier(page, r.id);
    const depart = await lireM(page);
    const compteur = (id) => page.locator(`#posOverlay .dossier-activity[data-edit-activity="${id}"] .staff-stepper-value`);
    await compteur('bowling').click();
    await page.waitForTimeout(200);
    const ouvert = await page.evaluate(() => { const c = document.querySelector('#posOverlay input[data-saisie-joueurs="bowling"]'); return c && { valeur: c.value, debut: c.selectionStart, fin: c.selectionEnd, clavier: c.getAttribute('inputmode'), focus: document.activeElement === c }; });
    await page.keyboard.type('18');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    const m1 = await lireM(page);
    ok(Boolean(ouvert) && ouvert.valeur === '50' && ouvert.debut === 0 && ouvert.fin === 2 && ouvert.clavier === 'numeric' && m1.bowling === 18 && m1.laser === 50 && m1.pax === 50 && !m1.champ && m1.prix < depart.prix, '[M1] Modifier : le nombre du bowling se tape (18 puis Entree), le prix suit', { depart, ouvert, m1 });
    await page.focus('#editPaxInput');
    await page.keyboard.press('Control+A');
    await page.keyboard.type('45', { delay: 150 });
    await page.waitForTimeout(400);
    const m2 = await lireM(page);
    ok(m2.pax === 45 && m2.bowling === 18 && m2.laser === 45, '[M2] le groupe tape 45 frappe par frappe : le bowling regle reste a 18, le laser suit le groupe', m2);
    await capture(page, '4-modifier-nombres.png');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    const m3 = await lireM(page);
    ok(m3.pax === 50 && m3.groupe === '50' && m3.bowling === 18 && m3.laser === 50 && m3.ouverte, '[M3] Echap dans le groupe rend 50, la fiche reste ouverte', m3);
    await compteur('laser_game').click();
    await page.keyboard.type('80');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    const m4 = await lireM(page);
    ok(m4.laser === 50 && m4.bowling === 18 && /50 au plus/.test(m4.dit), '[M4] 80 au laser : la raison s affiche, rien ne bouge', m4);
  } catch (error) {
    if (!error.cibleRouge) ok(false, '[M] scenario interrompu', String(error.message || error).slice(0, 300));
  } finally { await finir(m, 'M'); }
}

// ---------------------------------------------------------------------------
// « Autre heure », a la minute.
// ---------------------------------------------------------------------------
async function minute(page, id, heure, { bouton = false } = {}) {
  const champ = page.locator(`#rsMin-${id}`);
  await champ.click();
  await page.keyboard.type(heure.replace(':', ''));
  if (bouton) await page.locator(`.rs-minute[data-minute="${id}"] .rs-minute-ok`).click();
  else await page.keyboard.press('Enter');
  await attendre(page, (i) => { const b = rsEtat(); return !(b.minute && b.minute.id === i && b.minute.etat === 'calcul'); }, id, 10000);
  await page.waitForTimeout(400);
}

async function scenarioB(browser) {
  const m = await ouvrir(browser);
  try {
    const { page } = m;
    await page.locator('.btn-new').click();
    await page.waitForTimeout(400);
    await groupe(page, 8);
    await page.locator('#rsZ-bowling .rs-h[data-heure="16:00"]').click();
    await attendre(page, () => rvActivites().includes('bowling'));
    const touche = (await page.locator('#rsZ-bowling .rs-h-autres').innerText()).replace(/\s+/g, ' ').trim();
    await page.locator('#rsZ-bowling .rs-h-autres').click();
    await page.waitForTimeout(400);
    const champ = await page.evaluate(() => { const c = document.getElementById('rsMin-bowling'); return c && { type: c.type, pas: c.getAttribute('step') }; });
    const tient = await page.evaluate(() => { const c = document.getElementById('rsCol'); return c ? c.scrollHeight <= c.clientHeight + 1 : null; });
    ok(touche === 'Autre heure' && Boolean(champ) && champ.type === 'time' && champ.pas === '60' && tient === true, '[B1] « Autre heure » ouvre un champ a la minute, la fenetre tient sans defiler', { touche, champ, tient });
    await capture(page, '3-reserver-autre-heure.png');
    const avant = m.journal.length;
    await minute(page, 'bowling', '16:10');
    await attendre(page, () => { const p = rvPlanCourant(); return Boolean(p && p.disponible); }, null, 10000);
    const b2 = await lireR(page);
    const blancs = m.journal.slice(avant).filter((j) => j.m === 'POST' && j.corps && j.corps.dryRun && j.corps.heuresPosees && j.corps.heuresPosees.bowling === '16:10');
    const jugee = blancs.find((j) => j.corps.preference && j.corps.preference.preferredTimes && j.corps.preference.preferredTimes.bowling === '16:10');
    ok(Boolean(jugee) && b2.q === 'activites' && b2.heures.bowling === '16:10' && /16:10 à 17:10/.test(b2.ticket) && b2.plan && b2.plan.dispo === true, B2, { b2, blancs: blancs.length });
    if (await page.locator('#rsAjout-laser_game').count()) await page.locator('#rsAjout-laser_game').click();
    await attendre(page, () => rvActivites().includes('laser_game'));
    await page.locator('#rsZ-laser_game .rs-h-autres').click();
    await page.waitForTimeout(400);
    await minute(page, 'laser_game', '17:25', { bouton: true });
    await page.locator('#rsT-minigolf_blacklight').click();
    await attendre(page, () => rvActivites().includes('minigolf_blacklight'));
    const colonne = () => page.evaluate(() => { const c = document.getElementById('rsCol'); return c ? Math.round(c.scrollTop) : null; });
    const avantPanneau = await colonne();
    await page.locator('#rsHB-minigolf_blacklight').click();
    await page.waitForTimeout(400);
    const panneauOuvert = await colonne();
    await minute(page, 'minigolf_blacklight', '18:40');
    await attendre(page, () => { const p = rvPlanCourant(); return Boolean(p && p.disponible); }, null, 10000);
    await page.waitForTimeout(400);
    const apresPanneau = await colonne();
    const b3 = await lireR(page);
    ok(b3.heures.bowling === '16:10' && b3.heures.laser_game === '17:25' && b3.heures.minigolf_blacklight === '18:40' && /17:25/.test(b3.ticket) && /18:40/.test(b3.ticket) && b3.plan && b3.plan.dispo === true, '[B3] le laser a 17:25 et le minigolf a 18:40, chacun par son champ', b3);
    ok(panneauOuvert > avantPanneau && apresPanneau === avantPanneau, '[B8] 18:40 prise au minigolf : la colonne reprend sa position d avant le panneau', { avantPanneau, panneauOuvert, apresPanneau });
    await capture(page, '5-reserver-heures-a-la-minute.png');
    await page.locator('#rsZ-bowling .rs-h-autres').click();
    await page.waitForTimeout(400);
    await minute(page, 'bowling', '23:50');
    const b4 = await lireR(page);
    ok(b4.q === 'autres' && /^23:50 ne tient pas\./.test(b4.dit) && /hors horaires/i.test(b4.dit) && b4.heures.bowling === '16:10', '[B4] 23:50 au bowling : le champ dit pourquoi, rien ne bouge', b4);
    await capture(page, '6-reserver-heure-refusee.png');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await C.pret(page);
    await page.locator('#qbPhone').fill('0470 12 34 57');
    await page.locator('#qbName').fill('Banc Minute');
    await page.waitForTimeout(200);
    await page.locator('#rvCreer').click();
    const r = await dossierCree(page, 'Banc Minute');
    const plan = planDe(r);
    const blocs = (plan.resourceBlocks || []).map((b) => `${b.resourceType}@${b.startTime}-${b.endTime}`).sort().join(' ');
    const golf = (plan.timeline || []).find((s) => s.activityId === 'minigolf_blacklight' && !s.flexible);
    ok(Boolean(r) && r.start_time === '16:10' && blocs === 'bowling_lane@16:10-17:10 laser_arena@17:25-17:50' && Boolean(golf) && golf.startTime === '18:40' && golf.heurePosee === true, '[B5] le dossier cree : bowling 16:10 a 17:10, laser 17:25, minigolf pose a 18:40, arrivee 16:10', r ? { debut: r.start_time, blocs, golf: golf && golf.startTime } : 'aucun dossier');
    if (!r) return;
    await page.waitForTimeout(800);
    const rangee = await page.evaluate(() => { const l = [...document.querySelectorAll('.pv2-res, [data-res-id], .pv-row, tr')].find((x) => /Banc Minute/.test(x.textContent || '')); return l ? l.textContent.replace(/\s+/g, ' ') : document.body.innerText.replace(/\s+/g, ' ').slice(0, 4000); });
    await capture(page, '7-planning-a-la-minute.png');
    await page.evaluate((rid) => openPos(rid), Number(r.id));
    await page.waitForTimeout(600);
    const fiche = await page.evaluate(() => ((document.getElementById('posOverlay') || {}).innerText || '').replace(/\s+/g, ' '));
    ok(/16:10/.test(rangee) && /17:25/.test(rangee) && /16:10/.test(fiche) && /17:10/.test(fiche) && /17:25/.test(fiche) && /18:40/.test(fiche), '[B6] le planning et la fiche montrent 16:10, 17:25 et 18:40 tels quels', { rangee: rangee.slice(0, 300), fiche: fiche.slice(0, 500) });
    const entete = await page.evaluate(() => { const r = state.selectedRes; return r ? getPosHeures(r, getStaffTerrainSpan(r)) : ''; });
    ok(/^16:10 → 19:25$/.test(entete) && fiche.includes('16:10 → 19:25'), '[F1] l en-tete de la fiche finit a 19:25, la fin du minigolf pose a 18:40', { entete, fiche: fiche.slice(0, 200) });
    const grille = await page.evaluate(() => {
      const copie = JSON.parse(JSON.stringify(state.selectedRes));
      (copie.opsPlan.timeline || []).forEach((s) => { if (s.activityId === 'minigolf_blacklight' && s.heurePosee) { s.startTime = '18:30'; s.endTime = '19:15'; } });
      return getPosHeures(copie, getStaffTerrainSpan(copie));
    });
    ok(/^16:10 → 19:15$/.test(grille), '[F2] a la grille aussi : minigolf pose de 18:30 a 19:15, l en-tete finit a 19:15', grille);
    await capture(page, '8-fiche-a-la-minute.png');
    await page.evaluate(() => { const tab = [...document.querySelectorAll('#posOverlay button, #posOverlay [role="tab"]')].find((t) => /^Modifier$/i.test((t.textContent || '').trim())); if (tab) tab.click(); });
    await attendre(page, () => Boolean(state.editState));
    await page.evaluate(() => ouvrirHeureActivite('bowling'));
    await page.waitForTimeout(300);
    const heure = page.locator('#posOverlay [data-heure-champ="bowling"]');
    await heure.click();
    await page.keyboard.type('1805');
    await page.waitForTimeout(2500);
    const valide = await heure.evaluate((c) => ({ valeur: c.value, valide: c.validity.valid, pas: c.getAttribute('step') }));
    await capture(page, '9-modifier-heure-a-la-minute.png');
    await page.locator('#posOverlay button', { hasText: /^Enregistrer$/ }).first().click();
    let ecrit = '';
    for (let i = 0; i < 50; i += 1) {
      const lu = (planDe(B.base.reservations.get(Number(r.id))).resourceBlocks || []).find((b) => b.resourceType === 'bowling_lane');
      ecrit = lu ? `${lu.startTime}-${lu.endTime}` : '';
      if (ecrit === '18:05-19:05') break;
      await page.waitForTimeout(100);
    }
    ok(valide.valide === true && valide.valeur === '18:05' && ecrit === '18:05-19:05', '[B7] Modifier : le champ d heure du bowling accepte 18:05 et « Enregistrer » l ecrit', { valide, ecrit });
    await page.waitForTimeout(600);
    await capture(page, '10-modifier-enregistre.png');
  } catch (error) {
    if (!error.cibleRouge) ok(false, '[B] scenario interrompu', String(error.message || error).slice(0, 300));
  } finally { await finir(m, 'B'); }
}

// ---------------------------------------------------------------------------
// Le serveur, sans navigateur.
// ---------------------------------------------------------------------------
function corpsMinute() {
  return {
    centerId: 'libramont', date: JOUR, name: 'Minute Serveur', phone: '0470111555', email: '', status: 'pending', channel: 'staff', allowPastStart: false,
    startTime: '16:10', duration: 1, totalDuration: 2, pax: 8, type: 'visite', lanes: [], laneCount: 2, requiresLanes: true,
    program: [{ activityId: 'bowling', pax: 8, participants: 8, duration: 1 }, { activityId: 'laser_game', pax: 8, participants: 8, games: 1 }],
    preference: { activityOrder: ['bowling', 'laser_game'], preferredTimes: { bowling: '16:00', laser_game: '17:00' }, laserGameTimes: ['17:00'], laserPlacement: 'scheduled' },
    heuresPosees: { bowling: '16:10', laser_game: '17:20' },
  };
}
const heuresEnBase = (id) => (planDe(B.base.reservations.get(Number(id))).resourceBlocks || []).map((b) => `${b.resourceType}@${b.startTime}`).sort().join(' ');

async function scenarioS() {
  try {
    serveur.changerSession(C.roleDe('direction'));
    const DB = require(path.join(ROOT, 'lib/database.js'));
    B.semer([]);
    const cree = await serveur.appeler('POST', '/api/staff-reservations', corpsMinute());
    const id = cree.json && cree.json.reservation && cree.json.reservation.id;
    ok(cree.statut === 201 && heuresEnBase(id) === 'bowling_lane@16:10 laser_arena@17:20', '[S] MONTAGE : le dossier a la minute est cree (bowling 16:10, laser 17:20)', { statut: cree.statut, message: cree.json && cree.json.message, heures: id && heuresEnBase(id) });
    const lu = await DB.getReservationById(Number(id));
    const items = (lu.program && lu.program.items) || [];
    const plus = await serveur.appeler('PATCH', '/api/staff-reservations', { id, centerId: 'libramont', baseUpdatedAt: lu.updatedAt, pax: 9, program: { ...lu.program, items: items.map((it) => ({ ...it, participants: 9, pax: 9 })) } });
    const apres = B.base.reservations.get(Number(id));
    ok(plus.statut === 200 && Number(apres.pax) === 9 && heuresEnBase(id) === 'bowling_lane@16:10 laser_arena@17:20', '[S1] un joueur de plus : le dossier a la minute se replanifie, bowling 16:10, laser 17:20', { statut: plus.statut, message: plus.json && plus.json.message, pax: apres.pax, heures: heuresEnBase(id) });
    // Toutes les pistes prises de 17:00 a 18:00 : 16:10 a 17:10 ne tient plus, 16:00 a 17:00 tiendrait.
    const pistes = Array.from({ length: 8 }, (_, i) => i + 1);
    const rangee = B.ligne(9001, { date: JOUR, start_time: '17:00', lanes: pistes, name: 'Pistes Prises', pax: 40, type: 'bowling', duration: 1, total_duration: 1, ops_plan: { startTime: '17:00', endTime: '18:00', resourceBlocks: [{ type: 'activity', activityId: 'bowling', resourceType: 'bowling_lane', startTime: '17:00', endTime: '18:00', lanes: pistes, players: 40 }], timeline: [] } });
    B.base.reservations.set(9001, rangee);
    const lu2 = await DB.getReservationById(Number(id));
    const items2 = (lu2.program && lu2.program.items) || [];
    const encore = await serveur.appeler('PATCH', '/api/staff-reservations', { id, centerId: 'libramont', baseUpdatedAt: lu2.updatedAt, pax: 10, program: { ...lu2.program, items: items2.map((it) => ({ ...it, participants: 10, pax: 10 })) } });
    const message = String((encore.json && encore.json.message) || '');
    ok(encore.statut >= 400 && /16:10/.test(message) && /pistes libres/.test(message) && heuresEnBase(id) === 'bowling_lane@16:10 laser_arena@17:20' && Number(B.base.reservations.get(Number(id)).pax) === 9, '[S2] le bowling a 16:10 ne tient plus : le changement se refuse avec sa raison', { statut: encore.statut, message, heures: heuresEnBase(id) });
    // Le client et l assistant : la grille.
    let publicRefuse = '';
    try { DB.validateReservationResources({ centerId: 'libramont', channel: 'public', name: 'Client Grille', phone: '+32470000000', date: JOUR, duration: 1, lanes: [], pax: 4, type: 'bowling', label: 'Bowling Classique', laneCount: 1, requiresLanes: true, startTime: '15:15' }, [], {}); } catch (error) { publicRefuse = error.message; }
    let glisser = '';
    try { require(path.join(ROOT, 'lib/reservation-activity-move.js')).buildActivityMove({ ...lu2, opsPlan: planDe(B.base.reservations.get(Number(id))) }, { activityId: 'bowling', startTime: '19:10', lanes: [1, 2] }); } catch (error) { glisser = error.message; }
    ok(/heures pleines ou demies/.test(publicRefuse) && /pleine ou demie/.test(glisser), '[S3] le client et l assistant gardent la grille (15:15 refuse, glisser sans la minute refuse)', { publicRefuse, glisser });
  } catch (error) {
    if (!error.cibleRouge) ok(false, '[S] scenario interrompu', String(error.message || error).slice(0, 300));
  }
}

// ---------------------------------------------------------------------------
// La minute jugee a sa minute : pistes et armes sur la vraie plage.
// ---------------------------------------------------------------------------
function corpsPose(nom, { bowling = null, laser = null, pax = 8 } = {}) {
  const program = [];
  const preferredTimes = {};
  const heuresPosees = {};
  const order = [];
  if (bowling) { program.push({ activityId: 'bowling', pax, participants: pax, duration: 1 }); preferredTimes.bowling = bowling; heuresPosees.bowling = bowling; order.push('bowling'); }
  if (laser) { program.push({ activityId: 'laser_game', pax, participants: pax, games: 1 }); preferredTimes.laser_game = laser; heuresPosees.laser_game = laser; order.push('laser_game'); }
  return {
    centerId: 'libramont', date: JOUR, name: nom, phone: '0470111555', email: '', status: 'pending', channel: 'staff', allowPastStart: false,
    startTime: bowling || laser, duration: 1, totalDuration: 2, pax, type: 'visite', lanes: [], laneCount: bowling ? 2 : 0, requiresLanes: Boolean(bowling),
    program,
    preference: { activityOrder: order, preferredTimes, ...(laser ? { laserGameTimes: [laser], laserPlacement: 'scheduled' } : {}) },
    heuresPosees,
  };
}
const rangeeBowling = (id, debut, fin, pistes, nom) => B.ligne(id, { date: JOUR, start_time: debut, lanes: pistes, name: nom, pax: 4 * pistes.length, type: 'bowling', duration: 1, total_duration: 1, ops_plan: { startTime: debut, endTime: fin, resourceBlocks: [{ type: 'activity', activityId: 'bowling', resourceType: 'bowling_lane', startTime: debut, endTime: fin, lanes: pistes, players: 4 * pistes.length }], timeline: [] } });
const rangeeLaser = (id, debut, fin, joueurs, nom) => B.ligne(id, { date: JOUR, start_time: debut, lanes: [], name: nom, pax: joueurs, type: 'laser', duration: 0.5, total_duration: 0.5, ops_plan: { startTime: debut, endTime: fin, resourceBlocks: [{ type: 'activity', activityId: 'laser_game', resourceType: 'laser_arena', startTime: debut, endTime: fin, players: joueurs, countIndex: 1, groupWaveIndex: 1 }], timeline: [] } });
const blocsDe = (id) => (planDe(B.base.reservations.get(Number(id))).resourceBlocks || []).map((b) => `${b.resourceType}@${b.startTime}-${b.endTime}${b.lanes && b.lanes.length ? `[${b.lanes.join(',')}]` : ''}`).sort().join(' ');
const pistesDe = (id) => [...new Set((planDe(B.base.reservations.get(Number(id))).resourceBlocks || []).filter((b) => b.resourceType === 'bowling_lane').flatMap((b) => b.lanes || []).map(Number))].sort((a, b) => a - b);
const seSuivent = (p) => p.length === 2 && p[1] === p[0] + 1;

async function scenarioP() {
  try {
    serveur.changerSession(C.roleDe('direction'));
    const DB = require(path.join(ROOT, 'lib/database.js'));
    const poser = (lignes) => { B.semer([]); lignes.forEach((l) => B.base.reservations.set(Number(l.id), l)); };
    const creer = async (corps) => { const rep = await serveur.appeler('POST', '/api/staff-reservations', corps); return { rep, id: rep.json && rep.json.reservation && rep.json.reservation.id }; };
    poser([rangeeBowling(9101, '15:10', '16:10', [1, 2, 3, 4, 5, 6, 7, 8], 'Pistes Avant')]);
    const p1 = await creer(corpsPose('Minute P1', { bowling: '16:10' }));
    ok(p1.rep.statut === 201 && /^bowling_lane@16:10-17:10\[\d,\d\]$/.test(blocsDe(p1.id)), '[P1] toutes les pistes prises de 15:10 a 16:10 : le bowling pose a 16:10 se cree', { statut: p1.rep.statut, message: p1.rep.json && p1.rep.json.message, blocs: p1.id && blocsDe(p1.id) });
    poser([rangeeBowling(9102, '15:10', '16:10', [3, 4, 5, 6, 7, 8], 'Pistes Avant'), rangeeBowling(9103, '17:00', '18:00', [1, 2], 'Pistes Apres')]);
    const p2 = await creer(corpsPose('Minute P2', { bowling: '16:10' }));
    const pistes2 = p2.id ? pistesDe(p2.id) : [];
    ok(p2.rep.statut === 201 && /^bowling_lane@16:10-17:10/.test(blocsDe(p2.id)) && seSuivent(pistes2) && pistes2.every((p) => p >= 3), '[P2] 1 et 2 prises a 17:00 : le bowling de 16:10 prend deux pistes cote a cote parmi 3 a 8', { statut: p2.rep.statut, message: p2.rep.json && p2.rep.json.message, blocs: p2.id && blocsDe(p2.id) });
    poser([rangeeLaser(9104, '17:00', '17:25', 25, 'Laser Avant')]);
    const p3 = await creer(corpsPose('Minute P3', { laser: '17:25' }));
    ok(p3.rep.statut === 201 && blocsDe(p3.id) === 'laser_arena@17:25-17:50', '[P3] 25 joueurs au laser jusqu a 17:25 : 8 joueurs poses a 17:25 se creent', { statut: p3.rep.statut, message: p3.rep.json && p3.rep.json.message, blocs: p3.id && blocsDe(p3.id) });
    // Un bowling seul, deplace a 16:10 dans Modifier, puis un joueur de plus.
    B.semer([]);
    const seul = await serveur.appeler('POST', '/api/staff-reservations', { centerId: 'libramont', date: JOUR, name: 'Minute P4', phone: '0470111556', email: '', status: 'pending', channel: 'staff', startTime: '16:00', duration: 1, totalDuration: 1, pax: 8, type: 'bowling', lanes: [], laneCount: 2, requiresLanes: true });
    const id4 = seul.json && seul.json.reservation && seul.json.reservation.id;
    const lu4 = id4 ? await DB.getReservationById(Number(id4)) : null;
    const pistes4 = id4 ? pistesDe(id4) : [];
    const deplace = lu4 ? await serveur.appeler('PATCH', '/api/staff-reservations', { id: id4, centerId: 'libramont', baseUpdatedAt: lu4.updatedAt, activityMove: { activityId: 'bowling', startTime: '16:10', lanes: pistes4 } }) : { statut: 0 };
    ok(seul.statut === 201 && deplace.statut === 200 && /^bowling_lane@16:10-17:10/.test(blocsDe(id4)), '[P] MONTAGE : un bowling seul deplace a 16:10', { creation: seul.statut, deplace: deplace.statut, message: deplace.json && deplace.json.message, blocs: id4 && blocsDe(id4) });
    // Ses pistes prises jusqu a 16:30, 5 a 8 jusqu a 16:10, 1 et 2 des 17:00 : a 16:00, seules 1 et 2 sont
    // libres (le moteur les prend) ; a 16:10, il faut deux pistes parmi 5 a 8.
    const autres = [1, 2, 3, 4, 5, 6, 7, 8].filter((p) => !pistes4.includes(p));
    const hautes = autres.slice(-4);
    const basses = autres.filter((p) => !hautes.includes(p));
    [rangeeBowling(9105, '15:30', '16:30', pistes4, 'Ses Pistes'), rangeeBowling(9106, '15:10', '16:10', hautes, 'Hautes Avant'), rangeeBowling(9107, '17:00', '18:00', basses, 'Basses Apres')].forEach((l) => B.base.reservations.set(Number(l.id), l));
    const lu5 = await DB.getReservationById(Number(id4));
    const plus = await serveur.appeler('PATCH', '/api/staff-reservations', { id: id4, centerId: 'libramont', baseUpdatedAt: lu5.updatedAt, pax: 9 });
    const pistes5 = pistesDe(id4);
    ok(plus.statut === 200 && Number(B.base.reservations.get(Number(id4)).pax) === 9 && /^bowling_lane@16:10-17:10/.test(blocsDe(id4)) && seSuivent(pistes5) && pistes5.every((p) => hautes.includes(p)), '[P4] le bowling seul pose a 16:10 se replanifie sur deux autres pistes libres, cote a cote', { statut: plus.statut, message: plus.json && plus.json.message, avant: pistes4, hautes, apres: blocsDe(id4) });
  } catch (error) {
    if (!error.cibleRouge) ok(false, '[P] scenario interrompu', String(error.message || error).slice(0, 300));
  }
}

// ---------------------------------------------------------------------------
// Libramont, 22/11 : l arrivee qui bougeait seule, la partie laser qui ne se partageait pas.
// ---------------------------------------------------------------------------
// Un autre groupe du jour, en base et dans la page (le planning et la fiche le lisent).
async function autreGroupe(page, id, { nom, debut, fin, joueurs, seuls = false }) {
  const DB = require(path.join(ROOT, 'lib/database.js'));
  const bloc = { type: 'activity', activityId: 'laser_game', resourceType: 'laser_arena', startTime: debut, endTime: fin, players: seuls ? 30 : joueurs, countIndex: 1, groupWaveIndex: 1, groupWaveCount: 1, ...(seuls ? { joueursReels: joueurs, arene: 'seuls', weaponNeed: 30 } : {}) };
  B.base.reservations.set(id, B.ligne(id, { date: JOUR, start_time: debut, lanes: [], name: nom, pax: joueurs, type: 'laser', status: 'confirmed', duration: 0.5, total_duration: 0.5, ops_plan: { startTime: debut, endTime: fin, resourceBlocks: [bloc], timeline: [], ...(seuls ? { arene: 'seuls' } : {}) } }));
  const lu = await DB.getReservationById(id);
  await page.evaluate((r) => { window.__FIXTURE__.jours[window.__FIXTURE__.jour].push(r); state.reservations.push(r); renderStaff(); }, JSON.parse(JSON.stringify(lu)));
}

const lireBarre = (page) => page.evaluate(() => ({
  modifs: typeof resumeModifsEdition === 'function' ? resumeModifsEdition() : null,
  barre: [...document.querySelectorAll('#posOverlay .fm-modif')].map((n) => n.textContent.trim()),
  arrivee: state.editState ? state.editState.startTime : null,
  champ: (document.getElementById('editStartInput') || {}).value || '',
  actif: document.activeElement ? document.activeElement.id : '',
  verdict: etatVerdictEdition(),
  heureRefusee: (verdictEdition().resultat || {}).heureRefusee || null,
}));

async function scenarioR(browser) {
  const m = await ouvrir(browser);
  try {
    const { page } = m;
    // (le verdict a blanc de Modifier : le serveur du banc le sait, comme api/staff-state.js le dit)
    await page.evaluate(() => { serveurSaitModifierABlanc = true; }); // eslint-disable-line no-undef
    const r = await creerParLaFenetre(page, { pax: 7, nom: 'Radelet', telephone: '0470 12 34 61' });
    ok(Boolean(r), '[R] MONTAGE : le dossier de 7 avec bowling et laser est cree', r ? r.id : 'aucun');
    await ouvrirModifier(page, r.id);
    await page.waitForTimeout(800);
    const r1a = await lireBarre(page);
    await page.evaluate(() => { setTab('details'); });
    await page.waitForTimeout(300);
    await page.evaluate(() => modifierDepuisFiche('heure'));
    await page.waitForTimeout(800);
    const r1b = await lireBarre(page);
    ok(r1a.modifs.length === 0 && !r1a.barre.length && r1b.actif === 'editStartInput' && r1b.modifs.length === 0 && !r1b.barre.length && r1b.arrivee === r.start_time, '[R1] Modifier ouvert, puis l heure de l en-tete touchee : la barre « À enregistrer » reste vide', { r1a, r1b, debut: r.start_time });
    for (let i = 0; i < 4; i += 1) { await page.keyboard.press('ArrowDown'); await page.waitForTimeout(120); }
    await page.waitForTimeout(500);
    const r2 = await lireBarre(page);
    ok(r2.arrivee === r.start_time && r2.champ === r.start_time && r2.modifs.length === 0, '[R2] quatre fleches vers le bas ne reculent pas l arrivee', { r2, debut: r.start_time });
    await page.locator('#editStartInput').click();
    await page.keyboard.type('1030');
    await page.waitForTimeout(1500);
    const r3 = await lireBarre(page);
    ok(r3.arrivee === '10:30' && r3.verdict.ton === 'refus' && r3.verdict.texte === 'Ne passera pas : 10:30 est déjà passé : il est 15:10.', '[R3] 10:30 deja passee : le verdict le dit d abord', r3);
    await capture(page, '11-modifier-arrivee-passee.png');
  } catch (error) {
    if (!error.cibleRouge) ok(false, '[R] scenario interrompu', String(error.message || error).slice(0, 300));
  } finally { await finir(m, 'R'); }
}

// (la fiche refermee puis rouverte : un etat d edition neuf, l heure du dossier dans le champ)
async function rouvrirModifier(page, id) {
  await page.evaluate(() => { if (typeof closePos === 'function') closePos(); });
  await page.waitForTimeout(400);
  await ouvrirModifier(page, id);
}

async function laserA(page, heure) {
  await page.evaluate(() => { if (heureOuverteEdition !== 'laser_game:1.1') ouvrirHeureActivite('laser_game:1.1'); });
  await page.waitForTimeout(300);
  const champ = page.locator('#posOverlay [data-heure-champ="laser_game:1.1"]');
  await champ.click();
  await page.keyboard.type(heure.replace(':', ''));
  await attendre(page, () => { const v = verdictEdition(); return v.pour === state.editState && !v.enCours && Boolean(v.resultat); }, null, 10000);
  await page.waitForTimeout(400);
  return lireBarre(page);
}

async function scenarioL(browser) {
  const m = await ouvrir(browser);
  try {
    const { page } = m;
    await autreGroupe(page, 9301, { nom: 'Boucquiaux', debut: '17:30', fin: '17:55', joueurs: 4 });
    await autreGroupe(page, 9302, { nom: 'Groupe Plein', debut: '18:30', fin: '18:55', joueurs: 25 });
    await autreGroupe(page, 9303, { nom: 'Groupe Prive', debut: '19:30', fin: '19:55', joueurs: 6, seuls: true });
    // (le verdict a blanc de Modifier : le serveur du banc le sait, comme api/staff-state.js le dit)
    await page.evaluate(() => { serveurSaitModifierABlanc = true; }); // eslint-disable-line no-undef
    const r = await creerParLaFenetre(page, { pax: 7, nom: 'Radelet Laser', telephone: '0470 12 34 62' });
    ok(Boolean(r), '[L] MONTAGE : le dossier de 7 avec bowling et laser est cree', r ? r.id : 'aucun');
    await ouvrirModifier(page, r.id);
    const l2 = await laserA(page, '18:25');
    const phrase2 = (l2.heureRefusee && l2.heureRefusee.phrase) || '';
    ok(phrase2 === 'Plus assez d’armes pour le laser à 18:25 : il en reste 5 sur 30, il en faut 7. La prochaine partie libre est à 19:00.' && !/lancement|joueurs, /.test(phrase2), '[L2] 25 joueurs a 18:30 : le refus dit en clair qu il reste 5 armes, et la prochaine partie libre', l2);
    await capture(page, '13-modifier-laser-armes.png');
    await rouvrirModifier(page, r.id);
    const l3 = await laserA(page, '19:25');
    const phrase3 = (l3.heureRefusee && l3.heureRefusee.phrase) || '';
    ok(phrase3.startsWith('L’arène est réservée « pour eux seuls » par Groupe Prive à 19:30 (6 joueurs)') && phrase3.endsWith('La prochaine partie libre est à 20:00.') && !/lancement|joueurs, /.test(phrase3), '[L3] « Pour vous seuls » a 19:30 : le refus le dit, avec la prochaine partie libre', l3);
    await rouvrirModifier(page, r.id);
    const l1 = await laserA(page, '17:25');
    const ecrit = await page.evaluate(() => { const v = verdictEdition(); const blocs = (((v.resultat || {}).ecrit || {}).opsPlan || {}).resourceBlocks || []; return blocs.filter((b) => b.resourceType === 'laser_arena').map((b) => `${b.startTime}-${b.endTime}`).join(' '); });
    ok(l1.verdict.texte === 'Joue avec Boucquiaux à 17:30.' && ecrit === '17:30-17:55', '[L1] 17:25 se cale sur la partie de Boucquiaux : « Joue avec Boucquiaux à 17:30. »', { l1, ecrit });
    await capture(page, '12-modifier-laser-partage.png');
    await page.locator('#posOverlay button', { hasText: /^Enregistrer$/ }).first().click();
    const toastVu = await attendre(page, () => /Joue avec Boucquiaux à 17:30\./.test((document.getElementById('toast') || {}).textContent || ''), null, 8000);
    const apresClic = await page.evaluate(() => ({ toast: ((document.getElementById('toast') || {}).textContent || '').replace(/\s+/g, ' ').trim(), note: noteHeuresEdition ? noteHeuresEdition.texte || '' : '', fiche: Boolean(document.querySelector('#posOverlay:not(.hidden) .edit-modal')) }));
    ok(toastVu && /^Heure changée : /.test(apresClic.toast) && !/Pas enregistré/.test(apresClic.note) && !apresClic.fiche, '[L1] « Enregistrer » dit « Joue avec Boucquiaux à 17:30. » et referme la fiche, jamais « Pas enregistré »', apresClic);
    let laser = '';
    for (let i = 0; i < 60; i += 1) {
      const lu = (planDe(B.base.reservations.get(Number(r.id))).resourceBlocks || []).find((b) => b.resourceType === 'laser_arena');
      laser = lu ? `${lu.startTime}-${lu.endTime}${lu.partageAvec ? ` avec ${lu.partageAvec.noms.join(',')}` : ''}` : '';
      if (laser.startsWith('17:30')) break;
      await page.waitForTimeout(100);
    }
    await page.waitForTimeout(1200);
    const fiche = await page.evaluate((rid) => {
      const res = state.reservations.find((x) => Number(x.id) === Number(rid)) || state.selectedRes;
      const etape = getGroupeProgramme(res).find((e) => e.activityId === 'laser_game');
      return { ou: etape ? etape.ou : '' };
    }, Number(r.id));
    await rouvrirModifier(page, r.id);
    await page.waitForTimeout(500);
    fiche.vague = await page.evaluate(() => ((document.querySelector('#posOverlay .fm [data-laser-vagues]') || {}).textContent || '').trim());
    ok(laser === '17:30-17:55 avec Boucquiaux' && fiche.ou === 'avec Boucquiaux' && fiche.vague === '1 vague de 11 armes, avec Boucquiaux', '[L1] « Enregistrer » ecrit 17:30 ; la fiche dit « avec Boucquiaux », la vague « 1 vague de 11 armes »', { laser, fiche });
    await page.evaluate(() => { if (typeof closePos === 'function') closePos(); });
    await page.waitForTimeout(600);
    await capture(page, '14-planning-partie-commune.png');
    await page.evaluate((rid) => openPos(rid), Number(r.id));
    await page.waitForTimeout(800);
    await capture(page, '15-fiche-partie-commune.png');
  } catch (error) {
    if (!error.cibleRouge) ok(false, '[L] scenario interrompu', String(error.message || error).slice(0, 300));
  } finally { await finir(m, 'L'); }
}

const SCENARIOS = { A: scenarioA, C: scenarioC, M: scenarioM, B: scenarioB, S: scenarioS, P: scenarioP, R: scenarioR, L: scenarioL };

function verifierLesAncres() {
  let mortes = 0;
  MUTATIONS.forEach((m) => { const n = compteAncre(m); if (n !== 1) { mortes += 1; console.log(`FAIL  ancre ${m.nom} trouvee ${n} fois : ${m.de.slice(0, 80)}`); } });
  console.log(`saisie-nombres-heures-check --ancres : ${MUTATIONS.length - mortes}/${MUTATIONS.length} uniques`);
  return mortes;
}

async function contrePreuves() {
  if (verifierLesAncres()) process.exit(1);
  const voulues = typeof argument('contre-preuves') === 'string' ? argument('contre-preuves').split(',') : null;
  const liste = trancher(voulues ? MUTATIONS.filter((m) => voulues.includes(m.nom)) : MUTATIONS);
  const runs = await eclats.enPool(liste, eclats.nombreDeFils(liste.length), (m, fil) => eclats.lancer(__filename, [`--seul=${m.lettre}`], {
    env: { ...process.env, SAISIE_CASSE: m.nom, SAISIE_CAPTURES: '', PINLANE_SAISIE_PORT: String(PORT + 1 + fil) },
    timeout: 300000,
  }));
  let mordent = 0;
  liste.forEach((m, i) => {
    const sortie = `${runs[i].stdout || ''}${runs[i].stderr || ''}`;
    if (runs[i].status === 2) { console.log(`FAIL  contre-preuve ${m.nom} DESARMEE : ${sortie.trim().split('\n').pop()}`); return; }
    const rouges = sortie.split('\n').filter((l) => l.startsWith('FAIL'));
    if (rouges.some((l) => l.includes(m.cible))) { mordent += 1; console.log(`ok    contre-preuve ${m.nom} : « ${m.cible} » rougit`); return; }
    console.log(`FAIL  contre-preuve ${m.nom} : « ${m.cible} » reste vert (${rouges.length} autre(s) rouge(s) : ${rouges[0] ? rouges[0].slice(0, 160) : sortie.trim().split('\n').pop().slice(0, 160)})`);
  });
  console.log(`saisie-nombres-heures-check --contre-preuves : ${mordent}/${liste.length} mordent`);
  process.exit(mordent === liste.length ? 0 : 1);
}

async function main() {
  if (argument('ancres')) process.exit(verifierLesAncres() ? 1 : 0);
  if (argument('contre-preuves')) { await contrePreuves(); return; }
  const seul = typeof argument('seul') === 'string' ? argument('seul').split(',') : Object.keys(SCENARIOS);
  const navigateur = seul.some((nom) => nom !== 'S' && nom !== 'P');
  const http = navigateur ? await FX.servir({ port: PORT, transformer }) : null;
  const browser = navigateur ? await chromium.launch({ executablePath: C.BROWSER_PATH, headless: true }) : null;
  try {
    for (const nom of seul) await SCENARIOS[nom](browser);
  } finally {
    if (browser) await browser.close();
    if (http) http.close();
  }
  console.log(`\nsaisie-nombres-heures-check : ${reussis} ok, ${echecs} echec(s)`);
  process.exit(echecs ? 1 : 0);
}

main().catch((erreur) => {
  console.error('saisie-nombres-heures-check : interrompu', erreur && (erreur.stack || erreur));
  process.exit(1);
});

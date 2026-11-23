'use strict';
// LES GRANDS GROUPES DANS RESERVER, SANS NAVIGATEUR (2026-11-23, lib/grand-groupe.js, assets/app-main.js).
//
// Ansar : « pour quand ça divise en groupe, faut qu'on puisse tout modifier et choisir [...] choisir l'heure
// de passage, choisir de diviser en plus de 2 groupes, genre 3, 4, etc., pouvoir mettre facilement quel
// groupe va où, et quand, à combien ». La page des groupes de la fenetre Reserver se joue ici dans une
// sandbox (les VRAIES fonctions de assets/app-main.js, la place d un centre de 8 pistes et 30 armes), sur
// des plans du serveur tels que la fenetre les recoit (lib/reserver-fenetre.js resumerPlanPourLaFenetre).
// Le vrai ecran se joue a part, dans un navigateur (scripts/grands-groupes-check.js --seul=B et --seul=I).
//   [A] LE NOMBRE DE GROUPES : le plus petit que la place demande (60 joueurs, 30 armes : 2 ; 80 : 3),
//       sinon celui que le comptoir a choisi, jamais moins que ce minimum, jamais plus que 12 ni que le groupe.
//   [B] LA DEMANDE AU SERVEUR : le nombre choisi, les joueurs seulement quand ils font le groupe, les heures
//       seulement toutes posees, pour ce depart et ces activites, avec leur nombre ; jamais l activite du
//       groupe 1 par-dessus des heures.
//   [C] LA PAGE : une rangee par groupe (« Groupe 2 · 30 joueurs · Laser 15:30 → Bowling 16:30 »), ses
//       cases dans l ordre de ses heures, ses pistes ; le « − » du nombre s arrete au minimum et dit
//       pourquoi ; un groupe ne depasse pas les armes ; ce qui coince est rouge sur SA case avec la phrase
//       du serveur, un refus sans case se lit sous les groupes (jamais les deux) ; le total contre le
//       groupe, rouge quand il ne le fait pas ; une heure qui manque se dit.
//   [D] LES GESTES : une heure changee garde les autres heures a l ecran et le dossier commence a la plus
//       tot ; l ordre d un groupe s inverse ; un autre nombre repart de parts egales et des heures du moteur,
//       revenu au minimum il n est plus un choix ; une taille tapee garde les autres.
//   [E] UNE HEURE TAPEE : « 1410 », « 14h10 », « 14.10 », « 905 », « 14h » ; « 24:00 », « 14:60 » non.
//   [F] « CRÉER » ATTEND des groupes qui font le groupe, chacun a ses heures ; le calcul a blanc, lui, part.
//   [G] LA FRAPPE dans une case : l heure et les joueurs passent par la case, un refus se dit dessous et
//       rien ne bouge (une heure illisible, plus que les armes, plus que le groupe).
//   [H] LE TICKET dit les groupes, un par ligne : « Groupe 1 · 30 · Bowling 15:30 → Laser 16:30 ».
//   [I] UN BOWLING SEUL de 60 : deux groupes l un apres l autre, des cases de bowling seulement, rien a
//       inverser.
//
// CONTRE-PREUVES : `--contre-preuves` rejoue tout sur du code casse expres, une mutation a la fois (en
// memoire, le disque n est jamais touche), et exige que chacune rougisse sa lettre.
// Lancement : node scripts/groupes-reserver-check.js [--contre-preuves]

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'assets', 'app-main.js');
const lf = (t) => String(t).split('\r\n').join('\n');

// Les vraies fonctions de la fenetre, prises une a une dans le fichier.
const FONCTIONS = [
  'escapeHtml', 'rvPluriel', 'rvListe', 'rvMinuscule', 'rvMinutesDe', 'rvEnHeure', 'joindrePistes', 'rsNomCourt', 'rsPhrase',
  'rsAriaLigne', 'rsLigne', 'rsPasHtml', 'rsNombreHtml', 'rsSaisieDitHtml', 'rsSaisieValider', 'rvConstruire',
  'rvGrandGroupe', 'rvDemandeGrandGroupe', 'rvRotationEnJeu', 'rvGroupesEnJeu', 'rvPartsEgales', 'rvTaillesAffichees',
  'rvTaillesVoulues', 'rvHeuresPosees', 'rvHeuresVoulues', 'rvHeuresAffichees', 'rvGroupesIncomplets', 'rvGroupesDuPlan',
  'rvCoincentDuPlan', 'rvPistesDites', 'rvLigneDuGrandGroupe', 'rvPassagesDuGroupe', 'rvProgrammeDuGroupe',
  'rsLigneGrandGroupeHtml', 'rvPlafondDUnGroupe', 'rvRaisonDuMinimum', 'rvPhraseDesGroupes', 'rsNombreDeGroupesHtml',
  'rsPremierDesGroupesHtml', 'rsCaseDuGroupeHtml', 'rsRangeeDuGroupeHtml', 'rsPiedDesGroupesHtml', 'rsNombreDeGroupes',
  'rsTailleDuGroupe', 'rsTaillesEgales', 'rsPremierGroupe', 'rsHeureDuGroupe', 'rsInverserLeGroupe',
  'rvPoserLesHeuresDesGroupes', 'rsHeuresProposees', 'rvHeureTapee', 'rsGgSaisieValider', 'rsGroupesHtml',
];
const CONSTANTES = ['const RV_ANCRABLES = ', 'const RV_GROUPES_MAX = '];

function extraire(source, nom) {
  const debut = source.indexOf(`\nfunction ${nom}(`);
  if (debut < 0 || source.indexOf(`\nfunction ${nom}(`, debut + 1) >= 0) throw new Error(`fonction ${nom} absente ou double`);
  const fin = source.indexOf('\n}\n', debut);
  return source.slice(debut + 1, fin + 2);
}

function constante(source, tete) {
  const debut = source.indexOf(`\n${tete}`);
  if (debut < 0) throw new Error(`constante absente : ${tete}`);
  return source.slice(debut + 1, source.indexOf('\n', debut + 1));
}

// LE CENTRE : 8 pistes, 6 joueurs par piste (8 en secours), 30 armes ; un service de bowling prend 48 joueurs.
const ENVIRONNEMENT = `
var quickBookState = null;
var document = { activeElement: null, getElementById: () => null, querySelectorAll: () => [] };
function setTimeout() {}
function timeToNum(t) { if (!t) return 0; const [h, m] = String(t).split(':').map(Number); return h + (m / 60); }
function rsFmActive() { return false; }
function rvActivites() { return quickBookState.ids.slice(); }
function splitGroupIntoBowlingServices(n) { return Array.from({ length: Math.max(1, Math.ceil(Number(n) / 48)) }, () => 0); }
function getLaserWaveCount(n) { return Math.max(1, Math.ceil(Number(n) / 30)); }
function getQuickVisitParticipants(id) { const v = (quickBookState.joueurs || {})[id]; return v == null ? Math.max(1, Number(quickBookState.pax) || 1) : v; }
function getLaserArenaCapacity() { return 30; }
function getAvailabilityLaneCount() { return 8; }
function getTotalLanes() { return 8; }
function getMaxPerLane() { return 6; }
function getEmergencyMaxPerLane() { return 8; }
function rvNomActivite(id) { return id === 'bowling' ? 'Bowling' : id; }
function rvPlanCourant() { return quickBookState.planCourant || null; }
function rvPlanEnCalcul() { return false; }
function rsEtat() { return quickBookState.rs; }
function rsRetourHtml() { return ''; }
function rsLigneIci() { return ''; }
const RV_I = { groupes: '<svg></svg>' };
function rsFermerSaisie() { quickBookState.rs.saisie = ''; }
function rsGeste(faire) { quickBookState.rs.saisieDit = null; faire(); }
function rsRendreLeNombre() {}
function rvChevauchements() { return new Map(); }
function syncQuickBookDuration() { throw new Error('PASSE-LA-GARDE'); }
`;

function sandbox(source) {
  const s = lf(source);
  const code = [ENVIRONNEMENT, ...CONSTANTES.map((c) => constante(s, c)), ...FONCTIONS.map((nom) => extraire(s, nom))].join('\n');
  const ctx = vm.createContext({ console, Math, JSON, Number, String, Array, Object, Boolean, Map, Set, Error, RegExp, Date });
  vm.runInContext(code, ctx, { filename: 'app-main.js (extraits)' });
  return ctx;
}

const PLAN_DEUX = () => ({
  disponible: true, fin: '17:30',
  grandGroupe: { tourne: true, nombre: 2, tailles: [30, 30], premier: 'bowling', heures: [{ bowling: '15:30', laser_game: '16:30' }, { bowling: '16:30', laser_game: '15:30' }] },
  blocs: [
    { activite: 'bowling', debut: '15:30', fin: '16:30', pistes: [1, 2, 3, 4, 5], sousGroupe: 1, sousGroupes: 2 },
    { activite: 'laser_game', debut: '16:30', fin: '16:55', pistes: [], sousGroupe: 1, sousGroupes: 2 },
    { activite: 'laser_game', debut: '15:30', fin: '15:55', pistes: [], sousGroupe: 2, sousGroupes: 2 },
    { activite: 'bowling', debut: '16:30', fin: '17:30', pistes: [4, 5, 6, 7, 8], sousGroupe: 2, sousGroupes: 2 },
  ],
});
const etat = (extra = {}) => ({
  pax: 60, type: 'visite', date: '2026-11-29', startTime: '15:30', ids: ['bowling', 'laser_game'],
  visit: { bowling: { on: true, duration: 1 }, laser_game: { on: true, games: 1 } },
  rs: { faits: { combien: true }, saisie: '', saisieDit: null }, planCourant: PLAN_DEUX(), ...extra,
});

function jouer(source) {
  const rouges = [];
  const ok = (lettre, condition, quoi, detail) => {
    if (condition) return;
    rouges.push({ lettre, quoi, detail: detail === undefined ? '' : String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 400) });
  };
  let c;
  try { c = sandbox(source); } catch (error) { return [{ lettre: '*', quoi: `sandbox : ${error.message}` }]; }
  const poser = (s) => { c.quickBookState = s; return s; };
  const appel = (texte) => vm.runInContext(texte, c);
  const json = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));
  // (une lettre qui plante rougit, les autres se jouent quand meme)
  const section = (lettre, faire) => { try { faire(); } catch (error) { rouges.push({ lettre, quoi: `[${lettre}] plantage : ${error.message}` }); } };
  // Une rangee de la page : ce qu elle dit (aria-label) et ce qu elle contient.
  const rangee = (html, n) => { const m = new RegExp(`<div class="rs-gg-l[^"]*" role="listitem" data-groupe="${n}" aria-label="([^"]*)">([\\s\\S]*?)</div>`).exec(html); return m ? { dit: m[1], html: m[2] } : null; };
  let page = '';

  section('A', () => {
  poser(etat());
  ok('A', JSON.stringify(json(appel('rvGrandGroupe()'))) === JSON.stringify({ ids: ['bowling', 'laser_game'], nombre: 2, minimum: 2, choisi: false, tourne: true }),
    '[A] 60 joueurs au bowling et au laser : 2 groupes au moins (30 armes), qui tournent', json(appel('rvGrandGroupe()')));
  poser(etat({ grandGroupe: { nombre: 4 } }));
  const quatre = json(appel('rvGrandGroupe()'));
  ok('A', quatre.nombre === 4 && quatre.choisi === true && quatre.minimum === 2, '[A] 4 groupes choisis au comptoir : 4', quatre);
  for (const voulu of [1, 13, 61]) {
    poser(etat({ grandGroupe: { nombre: voulu } }));
    const g = json(appel('rvGrandGroupe()'));
    ok('A', g.nombre === 2 && g.choisi === false, `[A] ${voulu} groupes ne se prend pas (au moins 2, au plus 12 et le groupe)`, g);
  }
  poser(etat({ pax: 80, grandGroupe: { nombre: 2 } }));
  const quatreVingts = json(appel('rvGrandGroupe()'));
  ok('A', quatreVingts.minimum === 3 && quatreVingts.nombre === 3 && quatreVingts.choisi === false, '[A] 80 joueurs : 3 groupes au moins, 2 ne se prend pas', quatreVingts);
  poser(etat({ pax: 20 }));
  ok('A', appel('rvGrandGroupe()') === null, '[A] 20 joueurs : un seul groupe, rien a partager');

  });
  section('B', () => {
  poser(etat({ grandGroupe: { tourne: true } }));
  ok('B', JSON.stringify(json(appel('rvDemandeGrandGroupe()'))) === JSON.stringify({ impose: true }), '[B] « Faire tourner » seul : les groupes imposes, rien d autre', json(appel('rvDemandeGrandGroupe()')));
  poser(etat({ grandGroupe: { nombre: 3 } }));
  ok('B', JSON.stringify(json(appel('rvDemandeGrandGroupe()'))) === JSON.stringify({ nombre: 3, impose: true }), '[B] 3 groupes choisis : le nombre part, les groupes sont imposes', json(appel('rvDemandeGrandGroupe()')));
  poser(etat({ grandGroupe: { tailles: [31, 29], pourPax: 60 } }));
  ok('B', JSON.stringify(json(appel('rvDemandeGrandGroupe()').tailles)) === '[31,29]', '[B] 31 et 29 pour 60 : les joueurs partent', json(appel('rvDemandeGrandGroupe()')));
  poser(etat({ grandGroupe: { tailles: [30, 28], pourPax: 60 } }));
  ok('B', !appel('rvDemandeGrandGroupe()').tailles, '[B] 30 et 28 pour 60 : les joueurs ne partent pas (le total ne fait pas le groupe)', json(appel('rvDemandeGrandGroupe()')));
  poser(etat({ pax: 62, grandGroupe: { tailles: [31, 29], pourPax: 60 } }));
  ok('B', !appel('rvDemandeGrandGroupe()').tailles, '[B] des joueurs tapes pour 60, le groupe passe a 62 : ils ne partent plus', json(appel('rvDemandeGrandGroupe()')));
  const heures = [{ bowling: '15:10', laser_game: '16:20' }, { bowling: '16:20', laser_game: '15:10' }];
  poser(etat({ startTime: '15:10', grandGroupe: { premier: 'laser_game', heures, pourDepart: '15:10', pourActivites: 'bowling,laser_game' } }));
  const avecHeures = json(appel('rvDemandeGrandGroupe()'));
  ok('B', JSON.stringify(avecHeures) === JSON.stringify({ nombre: 2, heures, impose: true }), '[B] les heures posees partent avec leur nombre, sans l activite du groupe 1', avecHeures);
  poser(etat({ startTime: '15:30', grandGroupe: { heures, pourDepart: '15:10', pourActivites: 'bowling,laser_game' } }));
  ok('B', !appel('rvDemandeGrandGroupe()').heures, '[B] le depart a change : les heures posees ne partent plus', json(appel('rvDemandeGrandGroupe()')));
  poser(etat({ startTime: '15:10', grandGroupe: { heures: [{ bowling: '15:10', laser_game: '16:20' }, { bowling: '16:20', laser_game: '' }], pourDepart: '15:10', pourActivites: 'bowling,laser_game' } }));
  ok('B', !appel('rvDemandeGrandGroupe()').heures, '[B] une heure manque : aucune heure ne part, le moteur propose les siennes', json(appel('rvDemandeGrandGroupe()')));

  });
  section('C', () => {
  poser(etat());
  page = appel('rsGroupesHtml()');
  const r1 = rangee(page, 1);
  const r2 = rangee(page, 2);
  ok('C', Boolean(r1 && r2) && !rangee(page, 3), '[C] deux rangees, une par groupe', page.slice(0, 300));
  ok('C', r1 && r1.dit === 'Groupe 1 · 30 joueurs · Bowling 15:30 → Laser 16:30' && r2 && r2.dit === 'Groupe 2 · 30 joueurs · Laser 15:30 → Bowling 16:30',
    '[C] chaque rangee dit son groupe, ses joueurs et son programme dans l ordre de ses heures', [r1 && r1.dit, r2 && r2.dit]);
  const cases = (html) => [...html.matchAll(/data-activite="([^"]+)" data-heure-groupe="([^"]*)"/g)].map((m) => `${m[1]}@${m[2]}`);
  ok('C', r2 && cases(r2.html).join(' ') === 'laser_game@15:30 bowling@16:30', '[C] le groupe 2 : la case du laser avant celle du bowling', r2 && cases(r2.html));
  ok('C', r1 && /<small>pistes 1 à 5<\/small>/.test(r1.html) && /<small>jusqu’à 16:55<\/small>/.test(r1.html), '[C] la case du bowling dit ses pistes, celle du laser sa fin', r1 && r1.html.slice(0, 600));
  ok('C', r1 && /class="rs-gg-h" role="button"[^>]*data-saisie="t:1-bowling"[^>]*>15:30<\/b>/.test(r1.html), '[C] l heure du bowling du groupe 1 se touche (15:30)', r1 && r1.html.slice(0, 600));
  const nombreBloc = (/<div class="rs-rangee rs-gg-n">([\s\S]*?)<\/div><\/div>/.exec(page) || [])[1] || '';
  ok('C', /aria-label="Nombre de groupes, un de moins" data-gg-nombre="1" disabled/.test(nombreBloc) && /aria-label="Nombre de groupes, un de plus" data-gg-nombre="1" onclick=/.test(nombreBloc)
    && /au moins 2 : 30 armes au laser/.test(nombreBloc), '[C] le nombre : le « − » s arrete a 2 et dit pourquoi (30 armes), le « + » reste', nombreBloc);
  ok('C', r1 && /aria-label="Joueurs du groupe 1, un de plus" data-groupe="1" disabled/.test(r1.html) && /aria-label="Joueurs du groupe 1, un de moins" data-groupe="1" onclick=/.test(r1.html),
    '[C] 30 joueurs au groupe 1, 30 armes : pas un de plus, un de moins se peut', r1 && r1.html.slice(0, 500));
  ok('C', /<p class="rs-gg-total" id="rsGgTotal" role="status">60 joueurs sur 60<\/p>/.test(page) && !/id="rsGgEgal"/.test(page) && !/id="rsGgAuto"/.test(page),
    '[C] le total : 60 joueurs sur 60, rien a remettre', (/rs-gg-pied[\s\S]*$/.exec(page) || [''])[0].slice(0, 400));
  ok('C', /id="rsGgPremier-bowling" data-premier="bowling" aria-pressed="true"/.test(page) && /id="rsGgInverser-1"/.test(page) && /id="rsGgInverser-2"/.test(page),
    '[C] aux heures du moteur : « Groupe 1 commence par », et chaque groupe peut inverser son ordre', page.slice(0, 200));
  // 80 joueurs : au moins 3 groupes (30 armes), le « − » s arrete a 3.
  poser(etat({ pax: 80, planCourant: null, grandGroupe: { tourne: true } }));
  const trois = (/<div class="rs-rangee rs-gg-n">([\s\S]*?)<\/div><\/div>/.exec(appel('rsGroupesHtml()')) || [])[1] || '';
  ok('C', /aria-label="Nombre de groupes, un de moins" data-gg-nombre="1" disabled/.test(trois) && /<b>3<\/b>/.test(trois) && /au moins 3 : 30 armes au laser/.test(trois),
    '[C] 80 joueurs : 3 groupes, le « − » s arrete a 3 et dit pourquoi', trois);
  // Ce qui coince, sur SA case.
  const refuse = PLAN_DEUX();
  refuse.disponible = false;
  refuse.refus = 'Laser à 15:30 : 18 places, il en faut 30. Décalez le départ.';
  refuse.coincent = [{ groupe: 2, activite: 'laser_game', raison: 'Laser à 15:30 : 18 places, il en faut 30. Décalez le départ.' }];
  poser(etat({ planCourant: refuse }));
  page = appel('rsGroupesHtml()');
  const rouge2 = rangee(page, 2);
  const rouge1 = rangee(page, 1);
  ok('C', rouge2 && /class="rs-gg-c is-laser is-ko" data-groupe="2" data-activite="laser_game"/.test(rouge2.html) && /ne tient pas/.test(rouge2.html)
    && /<small class="rs-gg-ko" role="alert">Laser à 15:30, 18 places, il en faut 30\. Décalez le départ\.<\/small>/.test(rouge2.html),
  '[C] le laser du groupe 2 ne tient pas : sa case est rouge et la phrase du serveur se lit sous la rangee', rouge2 && rouge2.html);
  ok('C', rouge1 && !/is-ko/.test(rouge1.html) && rouge2 && !/class="rs-gg-c is-bowling is-ko"/.test(rouge2.html), '[C] les autres cases restent comme elles sont', [rouge1 && rouge1.html.slice(0, 200)]);
  ok('C', !/id="rsGgRefus"/.test(page), '[C] le refus d une case ne se redit pas sous les groupes', (/rs-gg-liste[\s\S]*$/.exec(page) || [''])[0].slice(-600));
  // Un refus qui ne tient a aucune case (le centre ferme ce jour-la) : la phrase du serveur sous les groupes.
  const ferme = PLAN_DEUX();
  ferme.disponible = false;
  ferme.refus = 'Le centre est fermé à cette date.';
  poser(etat({ planCourant: ferme }));
  page = appel('rsGroupesHtml()');
  ok('C', /<p class="rs-texte rs-heure-refus" id="rsGgRefus" role="alert">Le centre est fermé à cette date\.<\/p>/.test(page),
    '[C] un refus sans case : la phrase du serveur se lit sous les groupes, en rouge', (/rs-gg-liste[\s\S]*$/.exec(page) || [''])[0].slice(-600));
  // Le total qui ne fait pas le groupe.
  poser(etat({ grandGroupe: { tailles: [30, 28], pourPax: 60 } }));
  page = appel('rsGroupesHtml()');
  ok('C', /<p class="rs-gg-total is-ko" id="rsGgTotal" role="status">58 joueurs sur 60 : il en manque 2<\/p>/.test(page) && /id="rsGgEgal" onclick="rsFixer\(\(\) => rsTaillesEgales\(\)\)">Partager également<\/button>/.test(page),
    '[C] 30 et 28 pour 60 : « il en manque 2 » en rouge, et « Partager également »', (/rs-gg-pied[\s\S]*$/.exec(page) || [''])[0].slice(0, 400));
  ok('C', /data-groupe="2" aria-label="Groupe 2 · 28 joueurs · /.test(page), '[C] le groupe 2 montre les 28 tapes', page.slice(0, 200));
  // Une heure qui manque.
  poser(etat({ planCourant: null, grandGroupe: { heures: [{ bowling: '15:10', laser_game: '' }, { bowling: '', laser_game: '' }], pourDepart: '15:30', pourActivites: 'bowling,laser_game' } }));
  page = appel('rsGroupesHtml()');
  ok('C', />15:10<\/b>/.test(page) && (page.match(/>--:--<\/b>/g) || []).length === 3 && /Donnez l’heure de chaque case/.test(page) && /id="rsGgAuto" onclick="rsFixer\(\(\) => rsHeuresProposees\(\)\)">Proposer les heures<\/button>/.test(page) && !/rsGgPremier-/.test(page),
    '[C] des heures posees a moitie : la page les montre, dit ce qui manque et propose les heures du moteur', page.slice(0, 900));

  });
  section('D', () => {
  const s = poser(etat());
  appel("rsHeureDuGroupe(2, 'bowling', '16:40')");
  ok('D', JSON.stringify(json(s.grandGroupe.heures)) === JSON.stringify([{ bowling: '15:30', laser_game: '16:30' }, { bowling: '16:40', laser_game: '15:30' }]) && s.startTime === '15:30' && s.grandGroupe.pourDepart === '15:30',
    '[D] le bowling du groupe 2 a 16:40 : les autres heures a l ecran restent, le depart aussi', { heures: s.grandGroupe.heures, depart: s.startTime });
  appel("rsHeureDuGroupe(1, 'bowling', '15:10')");
  ok('D', s.startTime === '15:10' && s.grandGroupe.pourDepart === '15:10' && s.heureArretee === true && s.heureProposee === false && appel('Boolean(rvHeuresVoulues(rvGrandGroupe()))'),
    '[D] le bowling du groupe 1 a 15:10 : le dossier commence a 15:10, l heure ne bouge plus toute seule', { depart: s.startTime, pour: s.grandGroupe.pourDepart });
  appel('rsInverserLeGroupe(1)');
  ok('D', JSON.stringify(json(s.grandGroupe.heures[0])) === JSON.stringify({ bowling: '16:30', laser_game: '15:10' }), '[D] « inverser » au groupe 1 : laser 15:10 puis bowling 16:30', s.grandGroupe.heures[0]);
  appel("rsTailleDuGroupe(1, 28)");
  ok('D', JSON.stringify(json(s.grandGroupe.tailles)) === '[28,30]' && s.grandGroupe.pourPax === 60, '[D] 28 tapes au groupe 1 : le groupe 2 garde ses 30', s.grandGroupe);
  appel('rsNombreDeGroupes(3)');
  ok('D', s.grandGroupe.nombre === 3 && !s.grandGroupe.tailles && !s.grandGroupe.heures, '[D] 3 groupes : parts egales et heures du moteur', s.grandGroupe);
  appel('rsNombreDeGroupes(2)');
  ok('D', !('nombre' in s.grandGroupe) && appel('rvGrandGroupe().choisi') === false, '[D] revenu a 2, le minimum : le nombre n est plus un choix', s.grandGroupe);
  appel("rsTailleDuGroupe(2, 31)");
  appel('rsTaillesEgales()');
  ok('D', !s.grandGroupe.tailles, '[D] « Partager également » rend les parts egales', s.grandGroupe);
  appel("rsHeureDuGroupe(2, 'laser_game', '15:40')");
  appel('rsHeuresProposees()');
  ok('D', !s.grandGroupe.heures && !s.grandGroupe.pourDepart, '[D] « Proposer les heures » rend les heures du moteur', s.grandGroupe);

  });
  section('E', () => {
  const tapees = { '14:10': '14:10', 1410: '14:10', '14h10': '14:10', '14.10': '14:10', 905: '09:05', '9:05': '09:05', '14h': '14:00', ' 14 h 10 ': '14:10', '24:00': '', '14:60': '', abc: '', '': '', 14100: '' };
  const lues = Object.fromEntries(Object.keys(tapees).map((t) => [t, appel(`rvHeureTapee(${JSON.stringify(t)})`)]));
  ok('E', Object.keys(tapees).every((t) => lues[t] === tapees[t]), '[E] les heures tapees se lisent comme au comptoir', lues);

  });
  section('F', () => {
  poser(etat({ grandGroupe: { tailles: [30, 28], pourPax: 60 } }));
  ok('F', JSON.stringify(json(appel('rvConstruire()'))) === JSON.stringify({ erreur: 'Les groupes font 58 joueurs sur 60 : corrigez un groupe.' }), '[F] 58 sur 60 : « Créer » le dit et ne part pas', json(appel('rvConstruire()')));
  poser(etat({ grandGroupe: { heures: [{ bowling: '15:30', laser_game: '16:30' }, { bowling: '', laser_game: '15:30' }], pourDepart: '15:30', pourActivites: 'bowling,laser_game' } }));
  ok('F', JSON.stringify(json(appel('rvConstruire()'))) === JSON.stringify({ erreur: 'Groupe 2 : donnez l’heure du bowling, ou touchez « Proposer les heures ».' }), '[F] une heure manque au groupe 2 : « Créer » le dit', json(appel('rvConstruire()')));
  const passe = (texte) => { try { appel(texte); return 'sans erreur'; } catch (error) { return error.message; } };
  ok('F', passe('rvConstruire({ simulation: true })') === 'PASSE-LA-GARDE', '[F] le calcul a blanc, lui, part (le serveur dit ce qui coince)');
  poser(etat({ grandGroupe: { tailles: [31, 29], pourPax: 60 } }));
  ok('F', passe('rvConstruire()') === 'PASSE-LA-GARDE', '[F] 31 et 29 pour 60 : « Créer » part');

  });
  section('G', () => {
  const t = poser(etat());
  const taper = (cle, texte) => { t.rs.saisie = cle; appel(`rsSaisieValider(${JSON.stringify(cle)}, ${JSON.stringify(texte)}, { clavier: true })`); };
  taper('t:2-laser_game', '1550');
  ok('G', t.grandGroupe && t.grandGroupe.heures && t.grandGroupe.heures[1].laser_game === '15:50' && t.grandGroupe.heures[1].bowling === '16:30' && t.rs.saisie === '',
    '[G] « 1550 » tape dans le laser du groupe 2 : 15:50, le reste a l ecran', t.grandGroupe);
  const avant = JSON.stringify(t.grandGroupe);
  taper('t:1-bowling', 'midi');
  ok('G', JSON.stringify(t.grandGroupe) === avant && t.rs.saisieDit && t.rs.saisieDit.cle === 't:1-bowling' && t.rs.saisieDit.texte === 'Groupe 1 : tapez une heure, par exemple 14:10.',
    '[G] « midi » : la case le dit, rien ne bouge', t.rs.saisieDit);
  taper('g:1', '31');
  ok('G', !t.grandGroupe.tailles && t.rs.saisieDit && t.rs.saisieDit.texte === 'Groupe 1 : 30 au plus à la fois.', '[G] 31 au groupe 1, 30 armes : refuse sous la case', t.rs.saisieDit);
  taper('g:2', '61');
  ok('G', !t.grandGroupe.tailles && t.rs.saisieDit && t.rs.saisieDit.texte === 'Groupe 2 : 60 au plus, le groupe compte 60 personnes.', '[G] 61 au groupe 2 : plus que le groupe, refuse', t.rs.saisieDit);
  taper('g:1', '25');
  ok('G', JSON.stringify(json(t.grandGroupe.tailles)) === '[25,30]' && !t.rs.saisieDit, '[G] 25 au groupe 1 : pris, le groupe 2 garde ses 30', t.grandGroupe);

  });
  section('H', () => {
  poser(etat());
  const ticket = appel('rsLigneGrandGroupeHtml()');
  ok('H', /<b>2 groupes qui tournent<\/b>/.test(ticket) && /<small>30 et 30 joueurs<\/small>/.test(ticket)
    && /<small class="is-garde">Groupe 1 · 30 · Bowling 15:30 → Laser 16:30<\/small><small class="is-garde">Groupe 2 · 30 · Laser 15:30 → Bowling 16:30<\/small>/.test(ticket),
  '[H] le ticket : 2 groupes qui tournent, puis une ligne par groupe', ticket);

  });
  section('I', () => {
  const seul = {
    disponible: true, fin: '17:30', grandGroupe: { tourne: false, nombre: 2, tailles: [30, 30], heures: [{ bowling: '15:30' }, { bowling: '16:30' }] },
    blocs: [{ activite: 'bowling', debut: '15:30', fin: '16:30', pistes: [1, 2, 3, 4, 5], sousGroupe: 1 }, { activite: 'bowling', debut: '16:30', fin: '17:30', pistes: [1, 2, 3, 4, 5], sousGroupe: 2 }],
  };
  poser(etat({ ids: ['bowling'], visit: { bowling: { on: true, duration: 1 } }, planCourant: seul }));
  page = appel('rsGroupesHtml()');
  const b2 = rangee(page, 2);
  ok('I', b2 && b2.dit === 'Groupe 2 · 30 joueurs · Bowling 16:30' && !/rsGgInverser-/.test(page) && !/rsGgPremier-/.test(page) && /Les groupes jouent l’un après l’autre\./.test(page)
    && /<b>2 groupes, l’un après l’autre<\/b>/.test(appel('rsLigneGrandGroupeHtml()')),
  '[I] 60 au bowling seul : deux groupes l un apres l autre, rien a inverser', b2 && b2.dit);
  });
  return rouges;
}

// LES MUTATIONS : une regle retiree a la fois, `lettre` le scenario qui doit rougir.
const MUTATIONS = [
  { nom: 'nombre-choisi-ignore', lettre: 'A', de: '  const choisi = voulu >= minimum && voulu <= Math.min(RV_GROUPES_MAX, pax) ? voulu : 0;', vers: '  const choisi = 0;' },
  { nom: 'nombre-sous-le-minimum', lettre: 'A', de: '  const choisi = voulu >= minimum && voulu <= Math.min(RV_GROUPES_MAX, pax) ? voulu : 0;', vers: '  const choisi = voulu >= 2 && voulu <= Math.min(RV_GROUPES_MAX, pax) ? voulu : 0;' },
  { nom: 'heures-non-envoyees', lettre: 'B', de: '    ...(heures ? { heures } : {}),\n', vers: '' },
  { nom: 'tailles-sans-total', lettre: 'B', de: '    && tailles.reduce((t, n) => t + n, 0) === pax ? tailles.slice() : null;', vers: '    ? tailles.slice() : null;' },
  { nom: 'premier-par-dessus-les-heures', lettre: 'B', de: '    ...(premier && !heures ? { premier } : {}),', vers: '    ...(premier ? { premier } : {}),' },
  { nom: 'heures-a-moitie-envoyees', lettre: 'B', de: '  return posees && posees.every((h) => grand.ids.every((id) => h[id])) ? posees : null;', vers: '  return posees;' },
  // (le saut de ligne devant : la meme ligne existe plus indentee dans Modifier, rangeeGroupeEditionHtml)
  { nom: 'case-sans-rouge', lettre: 'C', de: '\n  const raison = coincent.find((x) => x.groupe === n && x.activite === p.id);', vers: '\n  const raison = null;' },
  { nom: 'refus-sans-case-muet', lettre: 'C', de: "  const refus = plan && plan.disponible === false && !coincent.length && !manque && plan.refus ? rsPhrase(plan.refus) : '';", vers: "  const refus = '';" },
  { nom: 'refus-de-case-redit', lettre: 'C', de: "  const refus = plan && plan.disponible === false && !coincent.length && !manque && plan.refus ? rsPhrase(plan.refus) : '';", vers: "  const refus = plan && plan.disponible === false && !manque && plan.refus ? rsPhrase(plan.refus) : '';" },
  { nom: 'total-muet', lettre: 'C', de: '<p class="rs-gg-total${total === pax ? \'\' : \' is-ko\'}"', vers: '<p class="rs-gg-total"' },
  { nom: 'cases-dans-l-ordre-des-activites', lettre: 'C', de: '    .sort((a, b) => (a.heure ? rvMinutesDe(a.heure) : 1e4) - (b.heure ? rvMinutesDe(b.heure) : 1e4) || a.rang - b.rang);', vers: '    .sort((a, b) => a.rang - b.rang);' },
  { nom: 'moins-sous-le-minimum', lettre: 'C', de: '  const moins = n > grand.minimum ? `rsFixer(() => rsNombreDeGroupes(${n - 1}))` : \'\';', vers: '  const moins = n > 2 ? `rsFixer(() => rsNombreDeGroupes(${n - 1}))` : \'\';' },
  { nom: 'groupe-au-dela-des-armes', lettre: 'C', de: '  const plus = joueurs + 1 <= plafond ? `rsFixer(() => rsTailleDuGroupe(${n}, ${joueurs + 1}))` : \'\';', vers: '  const plus = `rsFixer(() => rsTailleDuGroupe(${n}, ${joueurs + 1}))`;' },
  { nom: 'heure-sans-depart', lettre: 'D', de: '    s.startTime = rvEnHeure(Math.min(...toutes.map(rvMinutesDe)));\n', vers: '' },
  { nom: 'heure-efface-les-autres', lettre: 'D', de: '  const heures = rvHeuresAffichees(grand) || Array.from({ length: grand.nombre }, () => ({}));', vers: '  const heures = Array.from({ length: grand.nombre }, () => ({}));' },
  // (avec la ligne qui suit : Modifier a la meme, groupesInverserEdition)
  { nom: 'inverser-sans-effet', lettre: 'D', de: '  heures[n - 1] = { ...heures[n - 1], [a]: heures[n - 1][b], [b]: heures[n - 1][a] };\n  rvPoserLesHeuresDesGroupes(grand, heures);', vers: '  rvPoserLesHeuresDesGroupes(grand, heures);' },
  { nom: 'nombre-garde-les-heures', lettre: 'D', de: '  const { tailles: _t, pourPax: _p, heures: _h, pourDepart: _d, pourActivites: _a, nombre: _n, ...reste } = s.grandGroupe || {};', vers: '  const { nombre: _n, ...reste } = s.grandGroupe || {};' },
  { nom: 'minimum-reste-un-choix', lettre: 'D', de: '  s.grandGroupe = voulu > grand.minimum ? { ...reste, nombre: voulu } : reste;', vers: '  s.grandGroupe = { ...reste, nombre: voulu };' },
  { nom: 'heure-tapee-stricte', lettre: 'E', de: ' || /^(\\d{1,2})(\\d{2})$/.exec(brut)', vers: '' },
  // (avec la ligne qui precede : Modifier a la meme garde, preparerModificationEdition)
  { nom: 'creer-sans-garde', lettre: 'F', de: "  const groupesIncomplets = simulation ? '' : rvGroupesIncomplets();\n  if (groupesIncomplets) return { erreur: groupesIncomplets };\n", vers: "  const groupesIncomplets = simulation ? '' : rvGroupesIncomplets();\n" },
  { nom: 'creer-sans-heures', lettre: 'F', de: '  const rang = posees ? posees.findIndex((h) => grand.ids.some((id) => !h[id])) : -1;', vers: '  const rang = -1;' },
  { nom: 'saisie-des-groupes-perdue', lettre: 'G', de: "  if (sorte === 'g' || sorte === 't') { rsGgSaisieValider(cle, sorte, quoi, brut, clavier); return; }\n", vers: '' },
  { nom: 'plafond-ignore-a-la-frappe', lettre: 'G', de: '    else if (Number(brut) > plafond) refus = `Groupe ${n} : ${plafond} au plus à la fois.`;\n', vers: '' },
  { nom: 'ticket-sans-groupes', lettre: 'H', de: '  const lignes = heures ? tailles.map((n, rang) => `Groupe ${rang + 1} · ${n} · ${rvProgrammeDuGroupe(grand, heures[rang])}`) : [];', vers: '  const lignes = [];' },
  { nom: 'inverser-un-bowling-seul', lettre: 'I', de: '  const inverser = grand.ids.length === 2 && passages.every((p) => p.heure)', vers: '  const inverser = passages.every((p) => p.heure)' },
];

const source = fs.readFileSync(APP, 'utf8');
if (process.argv.includes('--contre-preuves')) {
  const temoin = jouer(source);
  if (temoin.length) {
    console.log(temoin.slice(0, 8).map((r) => `ROUGE [${r.lettre}] ${r.quoi}`).join('\n'));
    console.log('\ngroupes-reserver-check --contre-preuves: le gate est rouge sans mutation, aucune contre-preuve ne compte');
    process.exit(1);
  }
  let rates = 0;
  for (const m of MUTATIONS) {
    const t = lf(source);
    if (t.split(m.de).length !== 2) { console.log(`ANCRE absente ou multiple : ${m.nom}`); rates += 1; continue; }
    const rouges = jouer(t.split(m.de).join(m.vers));
    const mord = rouges.some((r) => r.lettre === m.lettre);
    if (!mord) rates += 1;
    console.log(`${mord ? 'TUEE   ' : 'VIVANTE'} ${m.nom} (attendu : ROUGE [${m.lettre}])${mord ? '' : ` : ${rouges.map((r) => r.lettre).join('') || 'rien de rouge'}`}`);
  }
  console.log(rates ? `\ngroupes-reserver-check --contre-preuves: ${rates} mutation(s) vivante(s) sur ${MUTATIONS.length}` : `\ngroupes-reserver-check --contre-preuves: ALL OK (${MUTATIONS.length}/${MUTATIONS.length} tuees)`);
  process.exit(rates ? 1 : 0);
}
const rouges = jouer(source);
for (const r of rouges) console.log(`ROUGE [${r.lettre}] ${r.quoi}${r.detail ? ` : ${r.detail}` : ''}`);
console.log(rouges.length ? `\ngroupes-reserver-check: ${rouges.length} rouge(s)` : '\ngroupes-reserver-check: ALL OK');
process.exit(rouges.length ? 1 : 0);

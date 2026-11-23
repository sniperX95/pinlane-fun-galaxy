'use strict';
// LES GRANDS GROUPES DANS MODIFIER, SANS NAVIGATEUR (2026-11-23, assets/app-main.js, le bloc des groupes).
//
// Ansar : « pour quand ça divise en groupe, faut qu'on puisse tout modifier et choisir [...] choisir l'heure
// de passage, choisir de diviser en plus de 2 groupes, genre 3, 4, etc., pouvoir mettre facilement quel
// groupe va où, et quand, à combien ». Modifier montre sous le programme le meme bloc que la page des groupes
// de Reserver : le nombre de groupes, une rangee par groupe (ses joueurs, son programme, l heure de chaque
// activite a la minute), le total contre le groupe. Ce gate joue les VRAIES fonctions de assets/app-main.js
// dans une sandbox (un centre de 8 pistes et 30 armes), sur un dossier de 60 joueurs en deux groupes qui
// tournent tel que le serveur l ecrit (lib/grand-groupe.js). Le vrai ecran se joue a part, dans un
// navigateur (scripts/grands-groupes-check.js --seul=I).
//   [A] LE BLOC : « 60 joueurs en 2 groupes », une rangee par groupe dans l ordre de ses heures, ses pistes,
//       le « − » du nombre arrete au minimum avec sa raison (80 joueurs : 3, 30 armes), un groupe jamais
//       au-dela des armes ; un dossier qui n est pas en groupes garde un bloc vide et cache.
//   [B] RIEN DE TOUCHE, RIEN NE PART : sans geste sur le bloc (et quand le groupe change de nombre de joueurs),
//       aucune demande de groupes, aucune ligne, ni replanification ni prix qui suit ; un geste defait non plus.
//   [C] UNE HEURE CHANGEE PART : la demande au serveur (le nombre, les joueurs, toutes les heures), la ligne
//       de la barre du bas, la replanification, le prix qui suit, et la preference du dossier que
//       « Enregistrer » envoie.
//   [D] LE NOMBRE : un groupe de plus repart de parts egales et des heures du planning ; jamais moins que le
//       minimum ni plus que 12 ; revenu au nombre du dossier, plus rien ne part.
//   [E] LES JOUEURS : un total qui ne fait pas le groupe se dit et bloque « Enregistrer » ; « Partager
//       également » rend les parts egales.
//   [F] CE QUI COINCE : le refus du calcul a blanc garde ses cases ; la case du groupe est rouge, avec la
//       phrase du serveur sous sa rangee, et son champ se dit invalide.
//   [G] UNE HEURE EFFACEE : la barre le montre et « Enregistrer » dit laquelle manque.
//   [H] L ORDRE : « inverser » echange les deux heures d un groupe ; « Remettre les heures » rend celles du
//       planning.
//   [I] LE VERDICT : apres un calcul a blanc en 3 groupes, le bloc montre les heures et les joueurs que le
//       serveur ecrirait.
//
// CONTRE-PREUVES : `--contre-preuves` rejoue tout sur du code casse expres, une mutation a la fois (en
// memoire, le disque n est jamais touche), et exige que chacune rougisse sa lettre.
// Lancement : node scripts/groupes-modifier-check.js [--contre-preuves]

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'assets', 'app-main.js');
const lf = (t) => String(t).split('\r\n').join('\n');

// Les vraies fonctions de Modifier, prises une a une dans le fichier.
const FONCTIONS = [
  'escapeHtml', 'rvPluriel', 'rvPartsEgales', 'joindrePistes', 'rvPistesDites', 'minutesHeureEdition', 'valeurReservationComparable',
  'departsEdition', 'verdictEdition', 'dossierEcritDuVerdict', 'lireVerdictEdition',
  'groupesDuPlanEdition', 'joueursDesGroupesEdition', 'grandGroupeEdition', 'groupesDOrigineEdition', 'demandeGroupesEdition',
  'groupesIncompletsEdition', 'modifsGroupesEdition', 'coincentEdition', 'plafondDUnGroupeEdition', 'rangeeGroupeEditionHtml',
  'groupesEditionHtml', 'peindreGroupesEdition', 'apresGesteGroupesEdition', 'groupesNombreEdition', 'groupesTailleEdition',
  'groupesTaillePasEdition', 'groupesEgalesEdition', 'groupesHeureEdition', 'groupesInverserEdition', 'groupesHeuresDuPlanEdition',
  'editionReplanifie', 'editionChangeLePrix', 'resumeModifsEdition', 'preparerModificationEdition',
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
// Ce que Modifier fait d autre (pistes, prix, formule, notes) est remplace par un double qui ne change rien :
// seul le bloc des groupes est juge ici.
const ENVIRONNEMENT = `
var state = { editState: null, selectedRes: null, editError: '', laneStatuses: {} };
var document = { activeElement: null, getElementById: () => null, querySelectorAll: () => [], querySelector: () => null };
var rafraichi = 0;
function setTimeout() {}
function setEditError(m) { state.editError = m; }
function refreshEditPreview() { rafraichi += 1; }
function formuleChangeeEdition() { return Boolean(state.editState && state.editState.autreFormule); }
function getEditProgramItems() { const e = state.editState; return e && Array.isArray(e.items) ? e.items : []; }
function splitGroupIntoBowlingServices(n) { return Array.from({ length: Math.max(1, Math.ceil(Number(n) / 48)) }, () => 0); }
function getLaserWaveCount(n) { return Math.max(1, Math.ceil(Number(n) / 30)); }
function getLaserArenaCapacity() { return 30; }
function getAvailabilityLaneCount() { return 8; }
function getTotalLanes() { return 8; }
function getMaxPerLane() { return 6; }
function getEmergencyMaxPerLane() { return 8; }
function editProgramAChange() { return false; }
function illimiteChangeEdition() { return false; }
function areneChangeeEdition() { return false; }
function areneEdition() { return ''; }
function poseEditionChange() { return false; }
function enPlusEditionChange() { return false; }
function editArcadeTimingChanged() { return false; }
function parseLocalDate(iso) { return new Date(String(iso) + 'T12:00:00'); }
function modifsHeuresEdition() { return []; }
function modifsNotesEdition() { return []; }
function resolveDisplayFormule() { return null; }
function rvNomFormule(f) { return f.name; }
function modifsIllimiteEdition() { return []; }
function formatDurationLabel(h) { return h + ' h'; }
function parseLaneInput(s) { return String(s || '').split(',').map((x) => Number(x.trim())).filter((n) => n > 0); }
function pistesDeLaFormuleSeule(d) { return ((d && d.lanes) || []).map(Number); }
function modifsProgrammeEdition() { return []; }
function modifsEnPlusEdition() { return []; }
function heuresNouvellesEnvoyees() { return null; }
function nomActiviteHeureEdition(id) { return id; }
function modifsExtrasEdition() { return []; }
function getEditPriceValue() { return null; }
function formatMoneyCentimes(n) { return n + ' €'; }
const RV_OCCASIONS = [];
const STAFF_OCCASION_LABELS = {};
function dossierPourFormule(r) { return r; }
function choixIllimiteEdition() { return null; }
function reservationNeedsLanes() { return true; }
function getEditBowlingCapacityNeed() { return { requiredCount: 5 }; }
function todayStr() { return '2026-11-23'; }
function jourLongEdition(iso) { return iso; }
function arriveeDejaPasseeEdition() { return ''; }
function validateSlotWindow() { return { ok: true }; }
function getSuggestedEditLanes() { return [1, 2, 3, 4, 5, 6, 7, 8]; }
function debutBowlingEdition(d, e) { return e.startTime; }
function formatLaneInput(l) { return l.join(', '); }
function lanesConflict() { return []; }
function getLaserAvailability() { return { ok: true }; }
function refusTelephoneEdition() { return ''; }
function peindreTelephoneEdition() {}
function pistesTenuesParLaFormuleAdaptee() { return false; }
function peutAdapterFormule() { return false; }
function estFormuleIllimitee() { return false; }
function choixIllimiteEnvoye() { return null; }
function getEditPrixEstime() { return { utilisable: true }; }
function peutAdapterLeProgramme() { return false; }
function enPlusEnvoyesEdition() { return null; }
function editExtrasAChange() { return false; }
function extrasDepuisLignes() { return []; }
function getEditPrixActivites() { return null; }
function pistesALaMainDuDossier() { return 0; }
function notesEnvoyeesEdition() { return null; }
function getReservationPriceGap() { return 0; }
function sumExtras() { return 0; }
function getBasePrice() { return 990; }
function getFormuleLaneDuration() { return 1; }
function getFormuleTotalDuration() { return 2; }
function timeToNum(t) { if (!t) return 0; const [h, m] = String(t).split(':').map(Number); return h + (m / 60); }
function numToTime(n) { const m = Math.round(Number(n) * 60); return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); }
`;

function sandbox(source) {
  const s = lf(source);
  const code = [ENVIRONNEMENT, ...CONSTANTES.map((c) => constante(s, c)), ...FONCTIONS.map((nom) => extraire(s, nom))].join('\n');
  const ctx = vm.createContext({ console, Math, JSON, Number, String, Array, Object, Boolean, Map, Set, WeakMap, Error, RegExp, Date });
  vm.runInContext(code, ctx, { filename: 'app-main.js (extraits)' });
  return ctx;
}

// LE DOSSIER : 60 joueurs au bowling et au laser, deux groupes de 30 qui tournent (le groupe 1 au bowling a
// 15:30 puis au laser a 16:30, le groupe 2 l inverse), tel que le serveur l ecrit.
const bloc = (type, n, debut, fin, extra = {}) => ({ resourceType: type, activityId: type === 'bowling_lane' ? 'bowling' : 'laser_game', sousGroupe: n, startTime: debut, endTime: fin, ...extra });
const DOSSIER = (pax = 60, groupes = null) => ({
  id: 77, date: '2026-11-29', startTime: '15:30', pax, duration: 1, type: 'visite', formuleId: '', lanes: [1, 2, 3, 4, 5, 6, 7, 8], price: 990, basePrice: 990,
  status: 'pending', name: 'Club des Jeunes', phone: '0470111222', email: '', occasion: '', companions: 0, notes: '', extras: [], updatedAt: '2026-11-23T10:00:00.000Z',
  program: { items: [{ activityId: 'bowling', participants: pax, pax, duration: 1 }, { activityId: 'laser_game', participants: pax, pax, games: 1 }] },
  opsPlan: groupes || {
    grandGroupe: { tourne: true, nombre: 2, tailles: [30, 30], premier: 'bowling' },
    resourceBlocks: [
      bloc('bowling_lane', 1, '15:30', '16:30', { lanes: [1, 2, 3, 4, 5], players: 30 }),
      bloc('laser_arena', 1, '16:30', '16:55', { players: 30 }),
      bloc('laser_arena', 2, '15:30', '15:55', { players: 30 }),
      bloc('bowling_lane', 2, '16:30', '17:30', { lanes: [4, 5, 6, 7, 8], players: 30 }),
    ],
  },
});
const TROIS_GROUPES = (pax = 80) => ({
  grandGroupe: { tourne: true, nombre: 3, tailles: pax === 80 ? [27, 27, 26] : [20, 20, 20], premier: 'bowling' },
  resourceBlocks: [
    bloc('bowling_lane', 1, '15:30', '16:30', { lanes: [1, 2, 3, 4, 5], players: 27 }),
    bloc('laser_arena', 1, '16:30', '16:55', { players: 27 }),
    bloc('laser_arena', 2, '15:30', '15:55', { players: 27 }),
    bloc('bowling_lane', 2, '16:30', '17:30', { lanes: [4, 5, 6, 7, 8], players: 27 }),
    bloc('laser_arena', 3, '17:00', '17:25', { players: 26 }),
    bloc('bowling_lane', 3, '17:30', '18:30', { lanes: [1, 2, 3, 4, 5], players: 26 }),
  ],
});

function jouer(source) {
  const rouges = [];
  const ok = (lettre, condition, quoi, detail) => {
    if (condition) return;
    rouges.push({ lettre, quoi, detail: detail === undefined ? '' : String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 500) });
  };
  let c;
  try { c = sandbox(source); } catch (error) { return [{ lettre: '*', quoi: `sandbox : ${error.message}` }]; }
  const appel = (texte) => vm.runInContext(texte, c);
  const json = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));
  const memes = (a, b) => JSON.stringify(json(a)) === JSON.stringify(json(b));
  // Modifier ouvert sur un dossier : l etat d edition, et le dossier tel qu il etait a l ouverture.
  const ouvrir = (dossier = DOSSIER(), extra = {}) => {
    const e = { pax: dossier.pax, startTime: dossier.startTime, date: dossier.date, duration: dossier.duration, name: dossier.name, phone: dossier.phone, email: dossier.email, occasion: dossier.occasion, status: dossier.status, companions: 0, lanesStr: '', ...extra };
    c.state.selectedRes = dossier;
    c.state.editState = e;
    c.state.editError = '';
    c.__ouvert = { e, dossier };
    vm.runInContext('departsEdition().set(__ouvert.e, { origine: __ouvert.dossier, base: __ouvert.dossier }); verdictEdition().pour = null; verdictEdition().resultat = null; verdictEdition().enCours = false;', c);
    return e;
  };
  // (une lettre qui plante rougit, les autres se jouent quand meme)
  const section = (lettre, faire) => { try { faire(); } catch (error) { rouges.push({ lettre, quoi: `[${lettre}] plantage : ${error.message}` }); } };
  // Une rangee du bloc : ce qu elle dit (aria-label) et ce qu elle contient.
  const rangee = (html, n) => { const m = new RegExp(`<div class="fm-gg-l[^"]*" role="listitem" data-groupe="${n}" aria-label="([^"]*)">([\\s\\S]*?)</div>\\s*(?=<div class="fm-gg-l|</div>)`).exec(html); return m ? { dit: m[1], html: m[2] } : null; };
  const H60 = [{ bowling: '15:30', laser_game: '16:30' }, { bowling: '16:30', laser_game: '15:30' }];
  let page = '';

  section('A', () => {
    ouvrir();
    const g = json(appel('grandGroupeEdition()'));
    ok('A', g && g.nombre === 2 && g.minimum === 2 && g.choisi === false && memes(g.tailles, [30, 30]) && memes(g.heures, H60) && g.heuresTapees === false,
      '[A] le dossier en deux groupes : 2 groupes de 30, les heures du plan', g);
    page = appel('groupesEditionHtml()');
    const r1 = rangee(page, 1);
    const r2 = rangee(page, 2);
    ok('A', /<h5 class="fm-gg-titre" id="editGroupesTitre">60 joueurs en 2 groupes<\/h5>/.test(page) && Boolean(r1 && r2) && !rangee(page, 3),
      '[A] le bloc : « 60 joueurs en 2 groupes », une rangee par groupe', page.slice(0, 400));
    ok('A', r1 && r1.dit === 'Groupe 1 · 30 joueurs · Bowling 15:30 → Laser 16:30' && r2 && r2.dit === 'Groupe 2 · 30 joueurs · Laser 15:30 → Bowling 16:30',
      '[A] chaque rangee dit son groupe, ses joueurs et son programme dans l ordre de ses heures', [r1 && r1.dit, r2 && r2.dit]);
    ok('A', r1 && /data-activite="bowling" data-heure-groupe="15:30"><span class="fm-gg-a"><b>Bowling<\/b><small>pistes 1 à 5<\/small><\/span><input id="editGg1-bowling" class="input" type="time" step="60" value="15:30"/.test(r1.html)
      && /<small>jusqu’à 16:55<\/small>/.test(r1.html), '[A] la case du bowling dit ses pistes et son heure se tape a la minute ; celle du laser dit sa fin', r1 && r1.html.slice(0, 700));
    ok('A', /aria-label="Un groupe de moins" disabled/.test(page) && /aria-label="Un groupe de plus" onclick="groupesNombreEdition\(1\)"/.test(page)
      && /<small class="fm-gg-dit" id="editGgNombreDit">au moins 2 : 30 armes au laser<\/small>/.test(page),
    '[A] le nombre : le « − » s arrete a 2 et dit pourquoi (30 armes), le « + » reste', page.slice(0, 1200));
    ok('A', r1 && /aria-label="Groupe 1, un joueur de plus" disabled/.test(r1.html) && /aria-label="Groupe 1, un joueur de moins" onclick="groupesTaillePasEdition\(1, -1\)"/.test(r1.html),
      '[A] 30 joueurs au groupe 1, 30 armes : pas un de plus, un de moins se peut', r1 && r1.html.slice(0, 900));
    ok('A', /<p class="fm-gg-total" id="editGgTotal" role="status">60 joueurs sur 60<\/p>/.test(page) && !/id="editGgEgal"/.test(page) && !/id="editGgHeures"/.test(page) && /id="editGgInverser-1"/.test(page),
      '[A] le total : 60 joueurs sur 60, rien a remettre, chaque groupe peut inverser son ordre', page.slice(-700));
    // 80 joueurs en 3 groupes : le « − » s arrete a 3.
    ouvrir(DOSSIER(80, TROIS_GROUPES(80)));
    page = appel('groupesEditionHtml()');
    ok('A', /80 joueurs en 3 groupes/.test(page) && /aria-label="Un groupe de moins" disabled/.test(page) && /au moins 3 : 30 armes au laser/.test(page) && Boolean(rangee(page, 3)),
      '[A] 80 joueurs : 3 groupes, le « − » s arrete a 3 et dit pourquoi', page.slice(0, 1200));
    // Un dossier qui n est pas en groupes : le bloc reste pose, vide et cache (le verdict le remplit en place).
    ouvrir(DOSSIER(20, { resourceBlocks: [{ resourceType: 'bowling_lane', activityId: 'bowling', startTime: '15:30', endTime: '16:30', lanes: [1, 2, 3, 4], players: 20 }] }));
    ok('A', appel('groupesEditionHtml()') === '<div class="fm-groupes" id="editGroupes" hidden></div>' && appel('grandGroupeEdition()') === null,
      '[A] 20 joueurs sans groupes : un bloc vide et cache', appel('groupesEditionHtml()'));
    // Une autre formule choisie : le bloc se tait (la formule se replanifie depuis sa carte).
    ouvrir(DOSSIER(), { autreFormule: true });
    ok('A', appel('grandGroupeEdition()') === null, '[A] une autre formule choisie : plus de bloc des groupes');
  });

  section('B', () => {
    ouvrir();
    ok('B', appel('demandeGroupesEdition()') === null && json(appel('modifsGroupesEdition()')).length === 0 && appel('editionReplanifie()') === false
      && appel('editionChangeLePrix()') === false && json(appel('resumeModifsEdition()')).length === 0,
    '[B] rien de touche : aucune demande, aucune ligne, ni replanification ni prix qui suit', { demande: appel('demandeGroupesEdition()'), lignes: appel('resumeModifsEdition()') });
    const e = ouvrir();
    e.pax = 62;
    ok('B', appel('demandeGroupesEdition()') === null && memes(appel('resumeModifsEdition()'), ['Joueurs 60 → 62']),
      '[B] 62 joueurs sans toucher aux groupes : rien sur les groupes ne part, le serveur garde les siens', { demande: appel('demandeGroupesEdition()'), lignes: appel('resumeModifsEdition()') });
    ouvrir();
    appel('groupesTailleEdition(1, 28, true)');
    appel('groupesTailleEdition(1, 30, true)');
    ok('B', appel('demandeGroupesEdition()') === null && json(appel('resumeModifsEdition()')).length === 0,
      '[B] 28 puis 30 au groupe 1 : un geste defait ne part pas', { demande: appel('demandeGroupesEdition()'), lignes: appel('resumeModifsEdition()') });
  });

  section('C', () => {
    const e = ouvrir();
    const avant = c.rafraichi;
    appel("groupesHeureEdition(2, 'laser_game', '15:40')");
    const attendue = { impose: true, nombre: 2, tailles: [30, 30], heures: [{ bowling: '15:30', laser_game: '16:30' }, { bowling: '16:30', laser_game: '15:40' }] };
    ok('C', memes(appel('demandeGroupesEdition()'), attendue), '[C] le laser du groupe 2 a 15:40 : le nombre, les joueurs et toutes les heures partent', appel('demandeGroupesEdition()'));
    ok('C', memes(appel('resumeModifsEdition()'), ['Groupe 2 : laser 15:30 → 15:40']) && c.rafraichi > avant,
      '[C] la barre du bas : « Groupe 2 : laser 15:30 → 15:40 », et l ecran se rafraichit', appel('resumeModifsEdition()'));
    ok('C', appel('editionReplanifie()') === true && appel('editionChangeLePrix()') === true, '[C] le dossier se replanifie et le prix suit celui du serveur');
    const envoi = appel('preparerModificationEdition({ aBlanc: true })');
    const ecrit = envoi && !envoi.erreur ? json(envoi.appliquer(c.state.selectedRes)) : null;
    ok('C', ecrit && ecrit.preference && memes(ecrit.preference.grandGroupe, attendue) && envoi.prixSuivi === true && Number(ecrit.price) === 990,
      '[C] « Enregistrer » envoie ces groupes dans la preference du dossier, le prix suit le serveur', envoi && envoi.erreur ? envoi.erreur : ecrit && { preference: ecrit.preference, prix: ecrit.price, suivi: envoi.prixSuivi });
    ok('C', e.groupes && memes(e.groupes.heures, attendue.heures), '[C] le geste se garde dans l etat de Modifier', e.groupes);
  });

  section('D', () => {
    const e = ouvrir();
    appel('groupesNombreEdition(1)');
    ok('D', memes(appel('demandeGroupesEdition()'), { impose: true, nombre: 3, tailles: [20, 20, 20] }) && memes(appel('modifsGroupesEdition()'), ['Groupes 2 → 3']),
      '[D] un groupe de plus : 3 groupes de 20, les heures du planning (aucune ne part), « Groupes 2 → 3 »', { demande: appel('demandeGroupesEdition()'), lignes: appel('modifsGroupesEdition()') });
    page = appel('groupesEditionHtml()');
    ok('D', /60 joueurs en 3 groupes/.test(page) && rangee(page, 3) && rangee(page, 3).dit === 'Groupe 3 · 20 joueurs · Bowling sans heure → Laser sans heure'
      && /id="editGgCalcul">Le planning dira qui joue où à l’enregistrement\.<\/p>/.test(page) && /aria-label="Un groupe de moins" onclick=/.test(page),
    '[D] le bloc : 3 rangees de 20, sans heure jusqu au calcul du planning, le « − » revient', page.slice(0, 600));
    appel('groupesNombreEdition(-1)');
    ok('D', e.groupes && e.groupes.nombre === 2 && appel('demandeGroupesEdition()') === null && json(appel('modifsGroupesEdition()')).length === 0,
      '[D] revenu a 2, le nombre du dossier : plus rien ne part', { groupes: e.groupes, demande: appel('demandeGroupesEdition()') });
    appel('groupesNombreEdition(-1)');
    ok('D', e.groupes.nombre === 2, '[D] jamais moins que le minimum (2, 30 armes)', e.groupes);
    for (let i = 0; i < 14; i += 1) appel('groupesNombreEdition(1)');
    ok('D', e.groupes.nombre === 12, '[D] jamais plus que 12 groupes', e.groupes);
  });

  section('E', () => {
    ouvrir();
    appel('groupesTailleEdition(1, 28, true)');
    page = appel('groupesEditionHtml()');
    const prep = json(appel('preparerModificationEdition({ aBlanc: true })'));
    ok('E', /<p class="fm-gg-total is-ko" id="editGgTotal" role="status">58 joueurs sur 60 : il en manque 2<\/p>/.test(page) && /id="editGgEgal"/.test(page)
      && prep && prep.erreur === 'Les groupes font 58 joueurs sur 60 : corrigez un groupe.' && memes(appel('modifsGroupesEdition()'), ['Groupe 1 : 30 → 28 joueurs']),
    '[E] 28 au groupe 1 : « il en manque 2 » en rouge, « Partager également », et « Enregistrer » le dit', { prep, lignes: appel('modifsGroupesEdition()'), pied: (/fm-gg-pied[\s\S]*$/.exec(page) || [''])[0].slice(0, 400) });
    appel('groupesTailleEdition(2, 32, true)');
    ok('E', memes((appel('demandeGroupesEdition()') || {}).tailles, [28, 32]) && !json(appel('preparerModificationEdition({ aBlanc: true })')).erreur,
      '[E] 28 et 32 : le total fait le groupe, les joueurs partent (le serveur juge les armes)', appel('demandeGroupesEdition()'));
    appel('groupesEgalesEdition()');
    ok('E', memes(json(appel('grandGroupeEdition()')).tailles, [30, 30]) && appel('demandeGroupesEdition()') === null, '[E] « Partager également » rend 30 et 30', appel('grandGroupeEdition()'));
  });

  section('F', () => {
    const e = ouvrir();
    appel("groupesHeureEdition(2, 'laser_game', '08:00')");
    const raison = 'Groupe 2 : le laser à 08:00 commence avant l’ouverture (10:00).';
    const lu = json(appel(`lireVerdictEdition({ modification: true, refus: { message: 'Ces groupes ne tiennent pas au planning : ${raison}', statut: 422, coincent: [{ groupe: '2', activite: 'laser_game', raison: '${raison}' }] } }, {})`));
    ok('F', lu && lu.refus === `Ces groupes ne tiennent pas au planning : ${raison}` && memes(lu.coincent, [{ groupe: 2, activite: 'laser_game', raison }]),
      '[F] le refus du calcul a blanc garde ses cases (groupe, activite, phrase)', lu);
    c.__verdict = { pour: e, lu };
    appel('verdictEdition().pour = __verdict.pour; verdictEdition().enCours = false; verdictEdition().resultat = __verdict.lu;');
    page = appel('groupesEditionHtml()');
    const r2 = rangee(page, 2);
    const r1 = rangee(page, 1);
    ok('F', r2 && /<label class="fm-gg-c is-laser is-ko" for="editGg2-laser_game"/.test(r2.html) && /<small>ne tient pas<\/small>/.test(r2.html)
      && /aria-invalid="true"/.test(r2.html) && r2.html.includes(`<small class="fm-gg-ko" role="alert">${raison}</small>`),
    '[F] la case laser du groupe 2 est rouge, son champ se dit invalide, la phrase du serveur se lit sous sa rangee', r2 && r2.html);
    ok('F', r1 && !/is-ko/.test(r1.html), '[F] les cases du groupe 1 restent comme elles sont', r1 && r1.html.slice(0, 300));
  });

  section('G', () => {
    ouvrir();
    appel("groupesHeureEdition(1, 'bowling', '')");
    const prep = json(appel('preparerModificationEdition({ aBlanc: true })'));
    ok('G', memes(appel('resumeModifsEdition()'), ['Groupe 1 : bowling 15:30 → sans heure']) && prep && prep.erreur === 'Groupe 1 : donnez l’heure du bowling.',
      '[G] l heure du bowling du groupe 1 effacee : la barre le montre et « Enregistrer » dit laquelle manque', { lignes: appel('resumeModifsEdition()'), prep });
  });

  section('H', () => {
    const e = ouvrir();
    appel('groupesInverserEdition(1)');
    ok('H', e.groupes && memes(e.groupes.heures, [{ bowling: '16:30', laser_game: '15:30' }, { bowling: '16:30', laser_game: '15:30' }])
      && memes(appel('modifsGroupesEdition()'), ['Groupe 1 : bowling 15:30 → 16:30', 'Groupe 1 : laser 16:30 → 15:30']),
    '[H] « inverser » au groupe 1 : laser 15:30 puis bowling 16:30, et la barre le dit', { heures: e.groupes && e.groupes.heures, lignes: appel('modifsGroupesEdition()') });
    page = appel('groupesEditionHtml()');
    ok('H', /id="editGgHeures" onclick="groupesHeuresDuPlanEdition\(\)">Remettre les heures<\/button>/.test(page), '[H] « Remettre les heures » se propose', (/fm-gg-pied[\s\S]*$/.exec(page) || [''])[0].slice(0, 400));
    appel('groupesHeuresDuPlanEdition()');
    ok('H', !('heures' in e.groupes) && appel('demandeGroupesEdition()') === null, '[H] « Remettre les heures » rend celles du planning : plus rien ne part', e.groupes);
  });

  section('I', () => {
    const e = ouvrir();
    appel('groupesNombreEdition(1)');
    const ecrit = DOSSIER(60, TROIS_GROUPES(60));
    c.__verdict = { pour: e, resultat: { refus: '', lignes: [], ecrit, prixSuivi: true } };
    appel('verdictEdition().pour = __verdict.pour; verdictEdition().enCours = false; verdictEdition().resultat = __verdict.resultat;');
    const g = json(appel('grandGroupeEdition()'));
    ok('I', g && g.nombre === 3 && memes(g.tailles, [20, 20, 20]) && memes(g.heures, [{ bowling: '15:30', laser_game: '16:30' }, { bowling: '16:30', laser_game: '15:30' }, { bowling: '17:30', laser_game: '17:00' }]),
      '[I] apres le calcul a blanc en 3 groupes : le bloc montre les heures et les joueurs que le serveur ecrirait', g);
    page = appel('groupesEditionHtml()');
    ok('I', rangee(page, 3) && rangee(page, 3).dit === 'Groupe 3 · 20 joueurs · Laser 17:00 → Bowling 17:30' && !/id="editGgCalcul"/.test(page),
      '[I] la rangee du groupe 3 : laser 17:00 puis bowling 17:30', rangee(page, 3) && rangee(page, 3).dit);
  });
  return rouges;
}

// LES MUTATIONS : une regle retiree a la fois, `lettre` le scenario qui doit rougir. Les ancres portent assez de
// contexte pour n exister qu une fois : Reserver a des lignes soeurs (scripts/groupes-reserver-check.js).
const MUTATIONS = [
  { nom: 'bloc-jamais-montre', lettre: 'A', de: "  if (!ids.includes('bowling')) return null;\n  const minimum = Math.max(1, ...ids.map((id) => (id === 'bowling' ? splitGroupIntoBowlingServices(joueurs.bowling).length", vers: "  return null;\n  const minimum = Math.max(1, ...ids.map((id) => (id === 'bowling' ? splitGroupIntoBowlingServices(joueurs.bowling).length" },
  { nom: 'plancher-a-deux', lettre: 'A', de: '  const plancher = Math.max(2, g.minimum);', vers: '  const plancher = 2;' },
  { nom: 'programme-dans-l-ordre-des-activites', lettre: 'A', de: '    .sort((a, b) => (a.heure ? minutesHeureEdition(a.heure) : 1e4) - (b.heure ? minutesHeureEdition(b.heure) : 1e4) || a.rang - b.rang);', vers: '    .sort((a, b) => a.rang - b.rang);' },
  { nom: 'joueurs-au-dela-des-armes', lettre: 'A', de: '${joueurs + 1 <= plafond ? `onclick="groupesTaillePasEdition(${n}, 1)"` : \'disabled\'}', vers: '${`onclick="groupesTaillePasEdition(${n}, 1)"`}' },
  { nom: 'demande-sans-geste', lettre: 'B', de: '  if (memeNombre && !autresTailles && !autresHeures) return null;\n', vers: '' },
  { nom: 'joueurs-envoient-les-groupes', lettre: 'B', de: '  const g = e && e.groupes ? grandGroupeEdition() : null;\n  if (!g) return null;', vers: '  const g = e ? grandGroupeEdition() : null;\n  if (!g) return null;' },
  { nom: 'enregistrer-sans-les-groupes', lettre: 'C', de: "    if (groupesEnvoyes) updated.preference = { ...(updated.preference && typeof updated.preference === 'object' ? updated.preference : {}), grandGroupe: { ...groupesEnvoyes } };\n", vers: '' },
  { nom: 'barre-du-bas-muette', lettre: 'C', de: '  modifs.push(...modifsGroupesEdition());\n', vers: '' },
  { nom: 'replan-sans-les-groupes', lettre: 'C', de: '    || areneChangeeEdition()\n    || Boolean(demandeGroupesEdition());', vers: '    || areneChangeeEdition();' },
  { nom: 'prix-sans-les-groupes', lettre: 'C', de: '  if (demandeGroupesEdition()) return true;\n', vers: '' },
  { nom: 'nombre-sans-plancher', lettre: 'D', de: '  const n = Math.max(Math.max(2, g.minimum), Math.min(RV_GROUPES_MAX, pax, g.nombre + (Math.trunc(Number(delta)) || 0)));', vers: '  const n = g.nombre + (Math.trunc(Number(delta)) || 0);' },
  { nom: 'total-faux-accepte', lettre: 'E', de: '  if (g.taillesTapees && total !== pax) return `Les groupes font ${rvPluriel(total, \'joueur\')} sur ${pax} : corrigez un groupe.`;\n', vers: '' },
  { nom: 'egal-sans-effet', lettre: 'E', de: '  const { tailles: _t, pourPax: _p, ...reste } = e.groupes;\n  e.groupes = reste;', vers: '  const { tailles: _t, pourPax: _p, ...reste } = e.groupes;' },
  { nom: 'case-pas-rouge', lettre: 'F', de: '    const raison = coincent.find((x) => x.groupe === n && x.activite === p.id);', vers: '    const raison = null;' },
  { nom: 'verdict-perd-les-cases', lettre: 'F', de: '    const coincent = Array.isArray(reponse.refus.coincent) && reponse.refus.coincent.length ?', vers: '    const coincent = false ?' },
  { nom: 'heure-effacee-muette', lettre: 'G', de: '      if (g.heuresTapees && h[id] !== avant) lignes.push(', vers: '      if (g.heuresTapees && h[id] && h[id] !== avant) lignes.push(' },
  { nom: 'heure-manquante-acceptee', lettre: 'G', de: '  const rang = g.heuresTapees ? g.heures.findIndex((h) => g.ids.some((id) => !h[id])) : -1;', vers: '  const rang = -1;' },
  { nom: 'inverser-sans-effet', lettre: 'H', de: '  heures[n - 1] = { ...heures[n - 1], [a]: heures[n - 1][b], [b]: heures[n - 1][a] };\n  e.groupes = { ...(e.groupes || {}), nombre: g.nombre, heures };', vers: '  e.groupes = { ...(e.groupes || {}), nombre: g.nombre, heures };' },
  { nom: 'heures-du-plan-sans-effet', lettre: 'H', de: '  const { heures: _h, ...reste } = e.groupes;\n  e.groupes = reste;', vers: '  const { heures: _h, ...reste } = e.groupes;' },
  { nom: 'verdict-ignore', lettre: 'I', de: '  const plan = groupesDuPlanEdition(dossierEcritDuVerdict() || r);', vers: '  const plan = groupesDuPlanEdition(r);' },
];

const source = fs.readFileSync(APP, 'utf8');
if (process.argv.includes('--contre-preuves')) {
  const temoin = jouer(source);
  if (temoin.length) {
    console.log(temoin.slice(0, 8).map((r) => `ROUGE [${r.lettre}] ${r.quoi}`).join('\n'));
    console.log('\ngroupes-modifier-check --contre-preuves: le gate est rouge sans mutation, aucune contre-preuve ne compte');
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
  console.log(rates ? `\ngroupes-modifier-check --contre-preuves: ${rates} mutation(s) vivante(s) sur ${MUTATIONS.length}` : `\ngroupes-modifier-check --contre-preuves: ALL OK (${MUTATIONS.length}/${MUTATIONS.length} tuees)`);
  process.exit(rates ? 1 : 0);
}
const rouges = jouer(source);
for (const r of rouges) console.log(`ROUGE [${r.lettre}] ${r.quoi}${r.detail ? ` : ${r.detail}` : ''}`);
console.log(rouges.length ? `\ngroupes-modifier-check: ${rouges.length} rouge(s)` : '\ngroupes-modifier-check: ALL OK');
process.exit(rouges.length ? 1 : 0);

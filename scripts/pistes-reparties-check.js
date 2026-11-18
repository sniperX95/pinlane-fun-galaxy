'use strict';
// LES PISTES SE REPARTISSENT QUAND PINLANE CHOISIT (2026-11-18, assets/pinlane-pistes.js).
//
// Vosk (Fun Galaxy) via Ansar, 18/11 : « pas tout le temps faire en sorte que l'algo pousse la resa du bowling
// tout le temps sur la piste numero 1 ». Ansar : « quand c auto ça prend celle qui est la plus opti et pas juste
// tout le temps la 1 quand c libre [...] genre equilibrer ». Avant : 6 groupes sur 10 sur la piste 1, aucun sur
// les pistes 4 a 8 (capture du 18/11). La regle vit dans UN fichier, lu par le moteur (lib/ops-engine.js), par
// lib/database.js et par la console (assets/app-main.js). Ce gate la joue sur les trois :
//   [R] une journee vide : des groupes d une piste a la suite ne vont pas tous sur la 1, l ecart d usage entre
//       pistes reste d une reservation au plus ;
//   [E] l equilibre : une journee chargee posee en Auto garde un petit ecart, des groupes decales d une
//       demi-heure ne s empilent pas sur une paire, et sur cinq semaines la piste 1 ne sert pas plus que les autres ;
//   [P] une piste seule complete une paire entamee (reservation ou panne), mais pas au prix de l equilibre ;
//   [D] un groupe de 2 recoit une paire entiere ;
//   [G] un groupe de 3 ou plus recoit des pistes cote a cote ;
//   [M] une piste en maintenance ou bloquee n est jamais choisie ;
//   [X] meme entree, meme sortie : jamais de hasard, l ordre des pistes libres ne change rien, le tour du jour
//       passe par toutes les pistes ;
//   [N] la console choisit la piste du serveur (moteur et lib/database.js) a chaque pas d une journee chargee,
//       maintenance et reglage « pistes voisines » compris ;
//   [K] une reservation modifiee garde ses pistes quand elles sont libres (moteur, base, console) ;
//   [C] le compte des pistes libres ne change pas : la regle accorde N pistes des qu il y en a N de libres ;
//   [H] le vrai handler du comptoir en Auto (api/staff-reservations.js, banc en memoire) enregistre la piste que
//       la console montre pour cette journee, et un deplacement garde la piste.
//
// Sans base ni reseau : le banc de scripts/reserver-banc.js. Les contre-preuves chargent le code mute en
// memoire (crochet de compilation pour le serveur, texte mute pour la console) : aucun fichier n est ecrit.
// Lancement : node scripts/pistes-reparties-check.js [--contre-preuves]

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Module = require('module');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
for (const nom of Object.keys(process.env)) if (/^(PG|DATABASE|POSTGRES|RESEND|TWILIO|OPENROUTER|ANTHROPIC|OPENAI|BREVO|TELEGRAM)/i.test(nom)) delete process.env[nom];

const REGLE = 'assets/pinlane-pistes.js';
const MOTEUR = 'lib/ops-engine.js';
const BASE = 'lib/database.js';
const APP = 'assets/app-main.js';
const MUTATIONS = {
  'sans-equilibre': { f: REGLE, de: '    const charge = (piste) => Math.max(0, Number(usage[piste]) || 0);', vers: '    const charge = () => 0;', lettre: 'R' },
  'sans-tour-du-jour': { f: REGLE, de: '    const premiere = premierePisteDuJour(o.date, total);', vers: '    const premiere = 1;', lettre: 'E' },
  'paire-avant-equilibre': { f: REGLE, de: '      moyenne(groupe) - moinsUtilisee >= ECART_TOLERE_MINUTES ? 1 : 0,', vers: '      0,', lettre: 'E' },
  'sans-paire-entamee': { f: REGLE, de: '      nombre === 1 ? (entamee(groupe[0]) ? 0 : 1) : orphelines(groupe),', vers: '      nombre === 1 ? 0 : orphelines(groupe),', lettre: 'P' },
  'deux-sans-paire': { f: REGLE, de: 'const exige = (groupe) => [nombre === 2 && !paireEntiere(groupe) ? 1 : 0,', vers: 'const exige = (groupe) => [0,', lettre: 'D' },
  'groupe-eparpille': { f: REGLE, de: ' ? 1 : 0, groupe[groupe.length - 1] - groupe[0]];', vers: ' ? 1 : 0, 0];', lettre: 'G' },
  'hasard': { f: REGLE, de: '      Math.min(...groupe.map(rang)),', vers: '      Math.random(),', lettre: 'X' },
  'blocage-ignore': { f: MOTEUR, de: '      && !isLaneBlockedAt(availabilityBlocks, dateISO, lane, start, end)) {', vers: '      ) {', lettre: 'M' },
  'maintenance-ignoree': { f: BASE, de: "    if (!occupied.has(lane)\n      && laneStatuses[lane] !== 'maintenance'\n      && !isLaneBlockedAt(blocks, dateISO, lane, startMin, endMin)) {", vers: '    if (!occupied.has(lane)) {', lettre: 'M' },
  'moteur-sans-usage': { f: MOTEUR, de: '    usage: usageDesPistes(blocks.map((block) => ({ lanes: [block.lane], minutes: Number(block.end) - Number(block.start) }))),', vers: '    usage: {},', lettre: 'N' },
  'base-sans-date': { f: BASE, de: '    usage: usageDesPistesDuJour(reservations),\n    date: dateISO,\n    coteACote,\n', vers: "    usage: usageDesPistesDuJour(reservations),\n    date: '',\n    coteACote,\n", lettre: 'N' },
  'console-sans-usage': { f: APP, de: '    usage: usageDesPistesDuJour(date, ignoreId),', vers: '    usage: {},', lettre: 'N' },
  'console-sans-reglage': { f: APP, de: '    coteACote: getAvailabilitySessionCenter()?.resources?.bowling?.preferAdjacentLanes !== false,', vers: '    coteACote: true,', lettre: 'N' },
  'modification-reallouee': { f: MOTEUR, de: '    const preferred = preferredLanesFor(center, laneStatuses, reservations, { start, end }, availabilityBlocks, date, input.lanes);', vers: '    const preferred = null;', lettre: 'K' },
  'edition-console-reallouee': { f: APP, de: '  const kept = parseLaneInput(currentValue).filter(l => available.has(l));', vers: '  const kept = [];', lettre: 'K' },
  'groupe-refuse-sans-bloc': { f: REGLE, de: '    for (let i = 0; i + nombre <= libres.length; i += 1) candidats.push(libres.slice(i, i + nombre));', vers: '    for (let i = 0; i + nombre <= libres.length; i += 1) if (libres[i + nombre - 1] - libres[i] === nombre - 1) candidats.push(libres.slice(i, i + nombre));\n    if (!candidats.length) return null;', lettre: 'C' },
};
const MUTATION = (process.argv.find((a) => a.startsWith('--mutation=')) || '').slice('--mutation='.length);
if (MUTATION && !MUTATIONS[MUTATION]) { console.error(`mutation inconnue : ${MUTATION}`); process.exit(2); }
function muter(fichier, texte) {
  const m = MUTATION ? MUTATIONS[MUTATION] : null;
  const t = String(texte).split('\r\n').join('\n');
  if (!m || path.resolve(fichier) !== path.join(ROOT, m.f)) return t;
  if (t.split(m.de).length !== 2) throw new Error(`ANCRE DE MUTATION absente ou multiple (${MUTATION}) dans ${m.f}`);
  return t.split(m.de).join(m.vers);
}
const compiler = Module.prototype._compile;
Module.prototype._compile = function compilerMute(contenu, fichier) {
  return compiler.call(this, muter(fichier, contenu), fichier);
};

let rouges = 0;
let lettre = '';
function section(titre) { lettre = (titre.match(/^\[([A-Z])\]/) || [])[1] || ''; console.log(`\n${titre}`); }
function ok(condition, quoi, detail) {
  if (condition) { console.log(`ok    ${quoi}`); return; }
  rouges += 1;
  console.log(`ROUGE [${lettre}] ${quoi}${detail !== undefined ? ` : ${String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 400)}` : ''}`);
}
function jouer(fn) {
  try { fn(); } catch (error) { ok(false, `exception : ${error.message}`, String(error.stack || '').split('\n').slice(0, 3).join(' | ')); }
}

if (process.argv.includes('--contre-preuves')) {
  const temoin = spawnSync(process.execPath, [__filename], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
  if (temoin.status !== 0) { console.log(`${temoin.stdout || ''}${temoin.stderr || ''}`.split('\n').filter((l) => /ROUGE|Error/.test(l)).join('\n')); console.log('\npistes-reparties-check --contre-preuves: le gate est rouge sans mutation, aucune contre-preuve ne compte'); process.exit(1); }
  let rates = 0;
  for (const [nom, m] of Object.entries(MUTATIONS)) {
    const r = spawnSync(process.execPath, [__filename, `--mutation=${nom}`], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
    const sortie = `${r.stdout || ''}${r.stderr || ''}`;
    const mord = r.status === 1 && sortie.includes(`ROUGE [${m.lettre}]`) && !/ANCRE DE MUTATION/.test(sortie);
    if (!mord) rates += 1;
    console.log(`${mord ? 'TUEE ' : 'VIVANTE'} ${nom} (attendu : ROUGE [${m.lettre}], sortie ${r.status})${mord ? '' : `\n${sortie.split('\n').filter((l) => /ROUGE|ANCRE|Error/.test(l)).slice(0, 6).join('\n')}`}`);
  }
  console.log(rates ? `\npistes-reparties-check --contre-preuves: ${rates} mutation(s) vivante(s)` : '\npistes-reparties-check --contre-preuves: ALL OK - chaque regle retiree fait rougir sa lettre');
  process.exit(rates ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Les trois lecteurs de la regle.
// ---------------------------------------------------------------------------
const P = require(path.join(ROOT, REGLE));
const E = require(path.join(ROOT, MOTEUR));
const D = require(path.join(ROOT, BASE));
const { getCenter } = require(path.join(ROOT, 'lib/ops-knowledge.js'));
const CENTRE = getCenter('libramont');
const PARC = Number(CENTRE.resources.bowling.laneCount);
const TOUTES = Array.from({ length: PARC }, (_, i) => i + 1);

// Une fonction du source, accolades comptees.
function extraire(src, nom) {
  const debut = src.indexOf(`\nfunction ${nom}(`);
  if (debut < 0) throw new Error(`fonction absente de la console : ${nom}`);
  let i = src.indexOf('{', src.indexOf(')', debut));
  let profondeur = 0;
  for (; i < src.length; i += 1) {
    if (src[i] === '{') profondeur += 1;
    else if (src[i] === '}') { profondeur -= 1; if (profondeur === 0) break; }
  }
  return src.slice(debut + 1, i + 1);
}

// LA CONSOLE DANS UN BAC : le vrai booking-core, le vrai fichier de la regle, et les fonctions de la console qui
// choisissent les pistes, telles que la page les sert.
const lire = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const bac = vm.createContext({ console, state: { booking: {}, reservations: [], laneStatuses: {} }, document: { getElementById: () => null } });
bac.window = bac;
vm.runInContext(muter(path.join(ROOT, REGLE), lire(REGLE)), bac, { filename: REGLE });
vm.runInContext(lire('assets/booking-core.js'), bac, { filename: 'assets/booking-core.js' });
const sourceConsole = muter(path.join(ROOT, APP), lire(APP));
['tientSesPlaces', 'getOccupiedLanes', 'getFreeCount', 'usageDesPistesDuJour', 'allocateLanes', 'allocateLanesIncludingSeed', 'parseLaneInput', 'getAvailabilityLanePairs', 'getSuggestedEditLanes']
  .forEach((nom) => vm.runInContext(extraire(sourceConsole, nom), bac, { filename: `${APP} (${nom})` }));
let reglageVoisines = true;
bac.getBlocagesEnLigne = () => [];
bac.getAvailabilityLaneCount = () => PARC;
bac.getAvailabilitySessionCenter = () => ({ id: 'libramont', resources: { bowling: { laneCount: PARC, preferAdjacentLanes: reglageVoisines } } });
const copie = (v) => JSON.parse(JSON.stringify(v));
function console1(jour, journee, pannes, besoin, heure, duree, ignorer) {
  bac.state.reservations = copie(journee);
  bac.state.laneStatuses = copie(pannes || {});
  const r = bac.allocateLanes(besoin, jour, heure, duree, ignorer);
  return r ? [...r] : r;
}

const enMinutes = (heure) => { const [h, m] = heure.split(':').map(Number); return h * 60 + m; };
const enHeure = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
function moteur(jour, journee, pannes, besoin, heure, duree, blocs = [], centre = CENTRE) {
  return E.allocateLanes(centre, pannes || {}, journee, enMinutes(heure), enMinutes(heure) + Math.round(duree * 60), besoin, blocs, jour);
}
function base(jour, journee, pannes, besoin, heure, duree, blocs = [], voisines = true) {
  return D.allocateLanes(besoin, journee, pannes || {}, heure, duree, PARC, blocs, jour, voisines);
}
let idSuivant = 1000;
function dossier(jour, heure, duree, pistes, extra = {}) {
  idSuivant += 1;
  return { id: idSuivant, centerId: 'libramont', date: jour, startTime: heure, duration: duree, totalDuration: duree, lanes: [...pistes], pax: 4, type: 'bowling', status: 'pending', ...extra };
}
// Le plan du moteur pour un groupe de bowling, comme le comptoir le demande.
function planDuMoteur(jour, journee, pannes, heure, duree, joueurs, pistesVoulues = []) {
  const plan = E.planReservation({ centerId: 'libramont', date: jour, startTime: heure, pax: joueurs, type: 'bowling', duration: duree, channel: 'staff', lanes: pistesVoulues }, { reservations: journee, laneStatuses: pannes || {}, blocks: [] });
  const choisi = plan && plan.recommended;
  if (!choisi || !choisi.ok || choisi.startTime !== heure) return { plan, pistes: null, besoin: plan && plan.requiredLanes };
  return { plan, pistes: [...choisi.assignedLanes].map(Number).sort((a, b) => a - b), besoin: plan.requiredLanes, blocs: choisi.resourceBlocks };
}
function usage(journee) {
  const u = Object.fromEntries(TOUTES.map((p) => [p, 0]));
  journee.forEach((r) => (r.lanes || []).forEach((p) => { u[p] += Math.round(Number(r.duration) * 60); }));
  return u;
}
const ecart = (u) => Math.max(...Object.values(u)) - Math.min(...Object.values(u));
// Un hasard rejouable (jamais Math.random) : la meme journee a chaque passage.
function suite(graine) { let x = graine >>> 0; return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; }; }
function jourPlus(jour, n) { const d = new Date(`${jour}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
// Un jour dont le tour commence a la piste voulue.
function jourQuiCommencePar(piste, depuis = '2026-12-01') {
  for (let k = 0; k < PARC; k += 1) { const j = jourPlus(depuis, k); if (P.premierePisteDuJour(j, PARC) === piste) return j; }
  throw new Error(`aucun jour ne commence par la piste ${piste}`);
}

// Une journee chargee posee en Auto par le moteur, la console et la base jugees a chaque pas.
function journeeChargee(jour, graine, pannes = {}) {
  const r = suite(graine);
  const journee = [];
  const pas = [];
  for (let m = 10 * 60; m <= 21 * 60; m += 30) {
    const combien = Math.floor(r() * 3);
    for (let k = 0; k < combien; k += 1) {
      const pistes = r() < 0.6 ? 1 : r() < 0.7 ? 2 : 3 + Math.floor(r() * 2);
      const duree = [1, 1, 1, 1.5, 2][Math.floor(r() * 5)];
      const heure = enHeure(m);
      const voulu = planDuMoteur(jour, journee, pannes, heure, duree, pistes * 5);
      if (!voulu.pistes) continue;
      const parConsole = console1(jour, journee, pannes, voulu.besoin, heure, duree);
      const parBase = base(jour, journee, pannes, voulu.besoin, heure, duree);
      pas.push({ heure, besoin: voulu.besoin, moteur: voulu.pistes, console: parConsole && [...parConsole].sort((a, b) => a - b), base: parBase && [...parBase].sort((a, b) => a - b) });
      journee.push(dossier(jour, heure, duree, voulu.pistes, { opsPlan: { resourceBlocks: voulu.blocs } }));
    }
  }
  return { journee, pas };
}

// ---------------------------------------------------------------------------
section('[R] UNE JOURNEE VIDE : LES GROUPES D UNE PISTE NE VONT PAS TOUS SUR LA 1');
jouer(() => {
  const jour = '2026-11-28';
  const journee = [];
  for (let h = 10; h <= 21; h += 1) {
    const { pistes } = planDuMoteur(jour, journee, {}, enHeure(h * 60), 1, 4);
    if (pistes) journee.push(dossier(jour, enHeure(h * 60), 1, pistes));
  }
  const u = usage(journee);
  const surLa1 = journee.filter((r) => r.lanes.includes(1)).length;
  ok(journee.length === 12 && TOUTES.every((p) => u[p] > 0), '[R] douze groupes d une piste, une heure chacun, de 10:00 a 21:00 : chaque piste sert', journee.map((r) => `${r.startTime}:${r.lanes}`));
  ok(ecart(u) <= 60 && surLa1 <= 2, `[R] l ecart d usage reste d une reservation au plus (${ecart(u)} min), la piste 1 prend ${surLa1} groupe(s) sur 12`, u);
  // La journee de la capture du 18/11 : dix groupes, dont des groupes en meme temps.
  const capture = [];
  ['14:00', '14:00', '14:30', '15:00', '15:30', '16:00', '16:00', '17:00', '18:00', '19:00'].forEach((heure) => {
    const { pistes } = planDuMoteur(jour, capture, {}, heure, 1, 4);
    if (pistes) capture.push(dossier(jour, heure, 1, pistes));
  });
  const uc = usage(capture);
  ok(capture.length === 10 && ecart(uc) <= 60 && TOUTES.every((p) => uc[p] > 0), `[R] la journee de la capture (10 groupes) : chaque piste sert, ecart ${ecart(uc)} min`, capture.map((r) => `${r.startTime}:${r.lanes}`));
});

section('[E] L EQUILIBRE : JOURNEE CHARGEE, GROUPES DECALES, PLUSIEURS SEMAINES');
jouer(() => {
  [['2026-11-28', 7], ['2026-12-05', 11], ['2026-12-12', 23]].forEach(([jour, graine]) => {
    const { journee } = journeeChargee(jour, graine);
    const u = usage(journee);
    const total = Object.values(u).reduce((s, v) => s + v, 0);
    // Mesure du 18/11 sur 40 journees tirees : ecart median 120 min, au pire 150 ; la premiere libre donnait 480 et 690.
    ok(journee.length >= 15 && ecart(u) <= 150, `[E] journee chargee du ${jour} (${journee.length} groupes, ${Math.round(total / 60)} heures-piste) : ecart d usage ${ecart(u)} min, au plus deux heures et demie`, u);
  });
  // Un groupe d une piste toutes les demi-heures, une heure chacun : avant l equilibre, ils s empilaient sur une paire.
  const jour = '2026-11-28';
  const decales = [];
  for (let m = 10 * 60; m <= 21 * 60 + 30; m += 30) {
    const { pistes } = planDuMoteur(jour, decales, {}, enHeure(m), 1, 4);
    if (pistes) decales.push(dossier(jour, enHeure(m), 1, pistes));
  }
  const ud = usage(decales);
  ok(decales.length === 24 && ecart(ud) <= 60, `[E] 24 groupes decales d une demi-heure : ecart ${ecart(ud)} min, aucune paire ne prend tout`, ud);
  // Plusieurs semaines, une charge qui suit la semaine (lundi ferme, samedi plein), groupes d une piste. Le serveur
  // ne lit que la journee demandee : l equilibre entre les jours vient du tour quotidien, il reste un petit residu.
  const parJour = [0, 0, 2, 3, 2, 4, 8, 6];
  const premieres = [];
  [['2026-11-02', 35], ['2026-11-05', 56], ['2027-01-07', 35]].forEach(([debut, jours]) => {
    const cumul = Object.fromEntries(TOUTES.map((p) => [p, 0]));
    for (let d = 0; d < jours; d += 1) {
      const j = jourPlus(debut, d);
      const n = parJour[new Date(`${j}T12:00:00Z`).getUTCDay() || 7];
      const journeeJ = [];
      for (let k = 0; k < n; k += 1) {
        const heure = enHeure((14 + Math.floor(k * 8 / n)) * 60);
        const pistes = moteur(j, journeeJ, {}, 1, heure, 1);
        if (pistes) journeeJ.push(dossier(j, heure, 1, pistes));
      }
      if (debut === '2026-11-02' && journeeJ.length) premieres.push(journeeJ[0].lanes[0]);
      journeeJ.forEach((r) => r.lanes.forEach((p) => { cumul[p] += 60; }));
    }
    const moyenne = Object.values(cumul).reduce((s, v) => s + v, 0) / PARC;
    ok(cumul[1] - moyenne <= 180 && ecart(cumul) <= 360, `[E] ${jours} jours depuis le ${debut} : la piste 1 a servi ${cumul[1] / 60} h pour une moyenne de ${(moyenne / 60).toFixed(1)} h (au plus 3 h de plus), ecart entre pistes ${ecart(cumul) / 60} h`, cumul);
  });
  ok(premieres.filter((p) => p === 1).length <= Math.ceil(premieres.length / PARC) + 1, `[E] le premier groupe du jour change de piste : ${premieres.join(',')}`, premieres);
});

section('[P] UNE PISTE SEULE COMPLETE UNE PAIRE ENTAMEE, SANS PASSER AVANT L EQUILIBRE');
jouer(() => {
  const jour = jourQuiCommencePar(5);
  const journee = [dossier(jour, '15:00', 1, [1])];
  // Le tour du jour commence a la 5 : sans la paire, le groupe irait sur la 5 ; la 2 complete la paire 1-2.
  ['moteur', 'base', 'console'].forEach((qui) => {
    const r = qui === 'moteur' ? moteur(jour, journee, {}, 1, '15:00', 1) : qui === 'base' ? base(jour, journee, {}, 1, '15:00', 1) : console1(jour, journee, {}, 1, '15:00', 1);
    ok(JSON.stringify(r) === '[2]', `[P] ${qui} : piste 1 prise a 15:00, le groupe d une piste prend la 2 (paire 1-2 completee)`, r);
  });
  const enPanne = { 7: 'maintenance' };
  const r = moteur(jour, [], enPanne, 1, '15:00', 1);
  ok(JSON.stringify(r) === '[8]', '[P] la piste 7 en panne : le groupe d une piste prend la 8, sa voisine', r);
  // La 2 a deja servi deux heures, les autres rien : la paire attend, l equilibre passe.
  const chargee = [dossier(jour, '15:00', 1, [1]), dossier(jour, '10:00', 2, [2])];
  const r2 = moteur(jour, chargee, {}, 1, '15:00', 1);
  ok(r2 && r2[0] !== 2 && r2[0] !== 1, '[P] la 2 a deja deux heures de plus : la paire entamee ne la fait pas reprendre', r2);
});

section('[D] UN GROUPE DE 2 RECOIT UNE PAIRE ENTIERE');
jouer(() => {
  const jour = '2026-11-28';
  // Pistes 1 et 4 prises a 15:00 ; 2 et 3 n ont rien fait, 5 a 8 deux heures chacune.
  const journee = [dossier(jour, '15:00', 1, [1]), dossier(jour, '15:00', 1, [4]), ...[5, 6, 7, 8].map((p) => dossier(jour, '10:00', 2, [p]))];
  const paires = ['[5,6]', '[7,8]'];
  const { pistes } = planDuMoteur(jour, journee, {}, '15:00', 1, 10);
  ok(pistes && paires.includes(JSON.stringify(pistes)), '[D] moteur : 10 joueurs (2 pistes) a 15:00 recoivent une paire entiere, jamais 2 et 3', pistes);
  ok(paires.includes(JSON.stringify(base(jour, journee, {}, 2, '15:00', 1))) && paires.includes(JSON.stringify(console1(jour, journee, {}, 2, '15:00', 1))), '[D] base et console : la meme paire entiere', [base(jour, journee, {}, 2, '15:00', 1), console1(jour, journee, {}, 2, '15:00', 1)]);
  const vide = moteur(jour, [], {}, 2, '15:00', 1);
  ok(vide && vide[0] % 2 === 1 && vide[1] === vide[0] + 1, '[D] journee vide : une paire entiere (impaire puis paire)', vide);
});

section('[G] UN GROUPE DE 3 OU PLUS RECOIT DES PISTES COTE A COTE');
jouer(() => {
  const jour = '2026-11-28';
  // 4 et 7 prises a 15:00 ; 1, 2, 3 ont deux heures chacune, 5, 6, 8 rien : le bloc 1-2-3 passe quand meme.
  const journee = [dossier(jour, '15:00', 1, [4]), dossier(jour, '15:00', 1, [7]), ...[1, 2, 3].map((p) => dossier(jour, '10:00', 2, [p]))];
  ['moteur', 'base', 'console'].forEach((qui) => {
    const r = qui === 'moteur' ? moteur(jour, journee, {}, 3, '15:00', 1) : qui === 'base' ? base(jour, journee, {}, 3, '15:00', 1) : console1(jour, journee, {}, 3, '15:00', 1);
    ok(JSON.stringify(r) === '[1,2,3]', `[G] ${qui} : un groupe de 3 prend 1-2-3 cote a cote plutot que 5, 6 et 8 moins utilisees`, r);
  });
  const quatre = moteur(jour, [], {}, 4, '15:00', 1);
  ok(quatre && quatre[3] - quatre[0] === 3 && quatre[0] % 2 === 1, '[G] journee vide : un groupe de 4 prend deux paires entieres cote a cote', quatre);
});

section('[M] UNE PISTE EN MAINTENANCE OU BLOQUEE N EST JAMAIS CHOISIE');
jouer(() => {
  const jour = jourQuiCommencePar(5);
  // 1 a 4 ont trois heures chacune : la regle voudrait 5 ou 6, en panne.
  const journee = [1, 2, 3, 4].map((p) => dossier(jour, '10:00', 3, [p]));
  const pannes = { 5: 'maintenance', 6: 'maintenance' };
  const parQui = { moteur: moteur(jour, journee, pannes, 1, '15:00', 1), base: base(jour, journee, pannes, 1, '15:00', 1), console: console1(jour, journee, pannes, 1, '15:00', 1) };
  Object.entries(parQui).forEach(([qui, r]) => ok(r && ![5, 6].includes(r[0]), `[M] ${qui} : les pistes 5 et 6 en panne ne sont jamais choisies`, r));
  const blocs = [{ scopeType: 'lane', scopeRef: 5, date: jour, startMin: null, endMin: null }, { scopeType: 'lane', scopeRef: 6, date: jour, startMin: 14 * 60, endMin: 18 * 60 }];
  const parBloc = { moteur: moteur(jour, journee, {}, 1, '15:00', 1, blocs), base: base(jour, journee, {}, 1, '15:00', 1, blocs) };
  Object.entries(parBloc).forEach(([qui, r]) => ok(r && ![5, 6].includes(r[0]), `[M] ${qui} : la 5 bloquee toute la journee et la 6 de 14:00 a 18:00 ne sont jamais choisies`, r));
  const groupe = moteur(jour, journee, pannes, 2, '15:00', 1, blocs);
  ok(groupe && groupe.every((p) => ![5, 6].includes(p)), '[M] moteur : un groupe de 2 non plus', groupe);
});

section('[X] MEME ENTREE, MEME SORTIE');
jouer(() => {
  const texte = muter(path.join(ROOT, REGLE), lire(REGLE));
  ok(!/Math\.random|Date\.now|new Date\(\)/.test(texte), '[X] la regle ne lit ni le hasard ni l heure qu il est');
  const jour = '2026-11-28';
  const { journee } = journeeChargee(jour, 7);
  const base1 = journee.slice(0, 12);
  const sorties = new Set();
  for (let k = 0; k < 25; k += 1) sorties.add(JSON.stringify(moteur(jour, base1, {}, 1, '21:00', 1)));
  const libresDansLeDesordre = new Set([[1, 2, 3, 4, 5, 6, 7, 8], [8, 7, 6, 5, 4, 3, 2, 1], [5, 1, 8, 3, 2, 7, 4, 6]]
    .map((libres) => JSON.stringify(P.choisirPistes({ libres, nombre: 1, pistes: PARC, usage: {}, date: jour }))));
  const vides = new Set();
  for (let k = 0; k < 25; k += 1) vides.add(JSON.stringify(P.choisirPistes({ libres: TOUTES, nombre: 1, pistes: PARC, usage: {}, date: jour })));
  ok(sorties.size === 1 && vides.size === 1 && libresDansLeDesordre.size === 1, '[X] 25 fois la meme question, la meme piste ; l ordre des pistes libres ne change rien', [...sorties, ...vides, ...libresDansLeDesordre]);
  const tour = new Set();
  for (let k = 0; k < PARC; k += 1) tour.add(P.choisirPistes({ libres: TOUTES, nombre: 1, pistes: PARC, usage: {}, date: jourPlus(jour, k) })[0]);
  ok(tour.size === PARC, `[X] huit jours de suite, le premier groupe du jour passe par les ${PARC} pistes`, [...tour]);
});

section('[N] LA CONSOLE CHOISIT LA PISTE DU SERVEUR');
jouer(() => {
  [['2026-11-28', 7, {}], ['2026-12-05', 11, { 3: 'maintenance' }], ['2026-12-12', 23, { 8: 'maintenance', 1: 'maintenance' }]].forEach(([jour, graine, pannes]) => {
    const { pas } = journeeChargee(jour, graine, pannes);
    const ecarts = pas.filter((p) => JSON.stringify(p.moteur) !== JSON.stringify(p.console) || JSON.stringify(p.moteur) !== JSON.stringify(p.base));
    ok(pas.length >= 15 && !ecarts.length, `[N] ${jour}${Object.keys(pannes).length ? ` (pannes ${Object.keys(pannes).join(', ')})` : ''} : a chacun des ${pas.length} pas, console = moteur = base`, ecarts.slice(0, 3));
  });
  // Un centre qui renonce aux pistes voisines : les trois lisent le meme reglage.
  reglageVoisines = false;
  try {
    const jour = '2026-11-28';
    const sansVoisines = { ...CENTRE, resources: { ...CENTRE.resources, bowling: { ...CENTRE.resources.bowling, preferAdjacentLanes: false } } };
    // 1, 2, 3 et 5 ont deux heures : sans voisines, les trois moins utilisees (4, 6, 7) ; avec, le bloc 6-7-8.
    const journee = [1, 2, 3, 5].map((p) => dossier(jour, '10:00', 2, [p]));
    const m = moteur(jour, journee, {}, 3, '15:00', 1, [], sansVoisines);
    const b = base(jour, journee, {}, 3, '15:00', 1, [], false);
    const c = console1(jour, journee, {}, 3, '15:00', 1);
    ok(JSON.stringify(m) === '[4,6,7]' && JSON.stringify(m) === JSON.stringify(b) && JSON.stringify(m) === JSON.stringify(c), '[N] « pistes voisines » coupe : moteur, base et console prennent les memes trois pistes les moins utilisees (4, 6, 7)', [m, b, c]);
  } finally { reglageVoisines = true; }
});

section('[K] UNE RESERVATION MODIFIEE GARDE SES PISTES');
jouer(() => {
  const jour = '2026-11-28';
  // Le groupe est piste 3 a 14:00 ; on le deplace a 16:00. La 3 est libre a 16:00 et deja la plus utilisee.
  const groupe = dossier(jour, '14:00', 1, [3]);
  const autres = [dossier(jour, '10:00', 3, [3]), dossier(jour, '11:00', 1, [1])];
  const deplace = planDuMoteur(jour, autres, {}, '16:00', 1, 4, [3]);
  ok(JSON.stringify(deplace.pistes) === '[3]', '[K] moteur : deplace a 16:00, le groupe garde sa piste 3 (libre), meme si d autres servent moins', deplace.pistes);
  const verdict = D.validateReservationResources({ centerId: 'libramont', date: jour, startTime: '16:00', duration: 1, totalDuration: 1, pax: 4, type: 'bowling', lanes: [3], laneCount: 1, name: 'Groupe', phone: '0470000000', channel: 'staff' }, autres, {}, [], jour);
  ok(verdict && JSON.stringify(verdict.lanes) === '[3]', '[K] base : la piste demandee, libre, est celle qui s ecrit', verdict && verdict.lanes);
  bac.state.reservations = copie([groupe, ...autres]);
  bac.state.laneStatuses = {};
  const proposee = bac.getSuggestedEditLanes(1, jour, '16:00', 1, groupe.id, '3');
  ok(JSON.stringify(proposee && [...proposee]) === '[3]', '[K] console (Modifier) : la piste 3 reste proposee', proposee && [...proposee]);
  // La 3 est prise a 16:00 par un autre groupe : la regle reprend la main, sans casser.
  const prise = [...autres, dossier(jour, '16:00', 1, [3])];
  const ailleurs = planDuMoteur(jour, prise, {}, '16:00', 1, 4, [3]);
  ok(ailleurs.pistes && ailleurs.pistes[0] !== 3, '[K] la 3 prise a 16:00 : le moteur pose le groupe ailleurs, par la regle', ailleurs.pistes);
});

section('[C] LE COMPTE DES PISTES LIBRES NE CHANGE PAS');
jouer(() => {
  const jour = '2026-11-28';
  const r = suite(5);
  const fautes = [];
  for (let essai = 0; essai < 60; essai += 1) {
    const journee = [];
    TOUTES.forEach((p) => { if (r() < 0.45) journee.push(dossier(jour, '15:00', 1, [p])); });
    const pannes = r() < 0.3 ? { [1 + Math.floor(r() * PARC)]: 'maintenance' } : {};
    const libres = TOUTES.filter((p) => !journee.some((x) => x.lanes.includes(p)) && pannes[p] !== 'maintenance');
    for (let n = 1; n <= PARC; n += 1) {
      [['moteur', moteur(jour, journee, pannes, n, '15:00', 1)], ['base', base(jour, journee, pannes, n, '15:00', 1)], ['console', console1(jour, journee, pannes, n, '15:00', 1)]].forEach(([qui, g]) => {
        const juste = n <= libres.length ? (Array.isArray(g) && g.length === n && new Set(g).size === n && g.every((p) => libres.includes(p))) : g === null;
        if (!juste) fautes.push({ qui, n, libres, g });
      });
    }
  }
  ok(!fautes.length, '[C] 60 journees tirees : N pistes accordees des que N sont libres, null sinon, chez les trois', fautes.slice(0, 3));
  // Le moteur dit combien il en reste quand il refuse (lanesFreeOver) : le meme nombre qu avant.
  const pleine = [1, 2, 3, 4, 5].map((p) => dossier(jour, '15:00', 1, [p]));
  const refus = planDuMoteur(jour, pleine, {}, '15:00', 1, 30);
  const conflit = refus.plan && refus.plan.scenarios && refus.plan.scenarios.map((s) => (s.conflicts || [])[0]).find((c) => c && c.type === 'bowling_conflict' && c.libres !== undefined);
  ok(conflit && conflit.libres === 3, '[C] 30 joueurs a 15:00 avec 5 pistes prises : le moteur dit « 3 libres »', conflit || refus.plan && refus.plan.reason);
});

// ---------------------------------------------------------------------------
// [H] Le vrai handler du comptoir, sur le banc en memoire.
// ---------------------------------------------------------------------------
async function handler() {
  section('[H] LE COMPTOIR EN AUTO ENREGISTRE LA PISTE QUE LA CONSOLE MONTRE');
  process.env.DATABASE_URL = 'postgres://gate:gate@127.0.0.1:1/gate';
  process.env.PINLANE_CALENDAR_SYNC = 'off';
  const B = require('./reserver-banc.js');
  const m = B.monter({ session: B.sessionDuRole('manager') });
  const etat = require(path.join(ROOT, 'api/staff-state.js'));
  B.semer([]);
  const jour = B.JOUR;
  const lireJournee = async () => {
    const s = await B.appeler(etat, 'GET', `/api/staff-state?centerId=libramont&date=${jour}`);
    return (s.json.reservations || []).filter((r) => r.date === jour);
  };
  const ecarts = [];
  const posees = [];
  for (const [i, heure] of ['14:00', '14:00', '14:30', '15:00', '15:30', '16:00', '16:00', '17:00', '18:00', '19:00'].entries()) {
    const montree = console1(jour, await lireJournee(), {}, 1, heure, 1);
    const r = await m.appeler('POST', '/api/staff-reservations', B.corpsStaff({ type: 'bowling', pax: 4, startTime: heure, duration: 1, totalDuration: 1, lanes: [], laneCount: 1, requiresLanes: true, channel: 'staff', name: `Groupe ${i + 1}` }));
    const ecrite = r.json && r.json.reservation ? r.json.reservation.lanes : null;
    posees.push(`${heure}:${JSON.stringify(ecrite)}`);
    if (JSON.stringify(montree) !== JSON.stringify(ecrite)) ecarts.push({ heure, montree, ecrite, statut: r.statut, message: r.json && r.json.message });
  }
  const finale = await lireJournee();
  const u = usage(finale.map((r) => ({ lanes: r.lanes, duration: r.duration })));
  ok(!ecarts.length && finale.length === 10, `[H] dix groupes poses en Auto par le vrai handler : la piste ecrite est celle que la console montrait (${posees.join(' ')})`, ecarts);
  ok(TOUTES.every((p) => u[p] > 0) && ecart(u) <= 60, `[H] chaque piste sert, ecart ${ecart(u)} min`, u);
  // Deplacer un groupe garde sa piste quand elle est libre a la nouvelle heure.
  const cible = finale.find((r) => r.startTime === '18:00');
  const avant = cible ? [...cible.lanes] : null;
  const p = cible ? await m.appeler('PATCH', '/api/staff-reservations', { id: cible.id, centerId: 'libramont', startTime: '20:00' }) : null;
  const apres = p && p.json && p.json.reservation ? p.json.reservation.lanes : null;
  ok(p && p.statut === 200 && JSON.stringify(apres) === JSON.stringify(avant), '[H] le groupe de 18:00 deplace a 20:00 garde sa piste', { avant, apres, statut: p && p.statut, message: p && p.json && p.json.message });
}

handler().catch((error) => { lettre = 'H'; ok(false, `exception : ${error.message}`); }).then(() => {
  console.log(rouges ? `\npistes-reparties-check: ${rouges} ROUGE(S)` : '\npistes-reparties-check: ALL OK - les pistes se repartissent, la console montre la piste du serveur, les modifications gardent leurs pistes');
  process.exit(rouges ? 1 : 0);
});

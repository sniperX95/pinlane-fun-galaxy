'use strict';
// UN GROUPE DE PLUSIEURS PISTES LES RECOIT COTE A COTE (2026-11-21, assets/pinlane-pistes.js).
//
// Le gerant de Fun Galaxy, le 21/11 : « maintenant qu'on a mis l'algo pour pas que ça mette tout le temps piste 1
// pour le bowling, ça ne met plus des pistes ensemble quand c'est des groupes qui ont plusieurs personnes, donc
// plusieurs pistes : ça ne les met plus côte à côte ». La cause : la graine (les pistes qu un dossier a deja, une
// piste ajoutee par la fenetre) passait avant le cote a cote ; un groupe sur la 4 qui grandissait prenait la 6,
// les pistes 3 et 5 prises, alors que 1-2 et 7-8 etaient libres. Depuis l equilibre du 18/11, la voisine d une
// piste est plus souvent prise. Ce gate joue la regle sur le moteur, la base (le chemin de la reservation
// publique) et la console (Reserver, Modifier, « Ils sont N ») :
//   [V] un jour vide et un groupe de 12 : 2 pistes cote a cote, chaque jour du tour ;
//   [U] deux reservations d une piste ne prennent pas toutes les deux la piste 1 ;
//   [B] les pistes 3 et 5 prises : un groupe de 2 pistes recoit 1-2, 6-7 ou 7-8, jamais 4 et 6, qu il arrive
//       (moteur, base, console) ou qu il grandisse depuis la 4 (Modifier, « Ils sont N ») ;
//   [S] seules des pistes non voisines sont libres : le partage qui laisse le moins de trous, et la phrase du
//       staff (« pistes 3 et 6 : aucune paire côte à côte n’est libre ») sur le plan du moteur et dans la console ;
//   [M] une piste choisie a la main par le staff est respectee (regle, fenetre Reserver, moteur) ;
//   [D] le duckpin ne prend aucune piste de bowling.
//
// Sans base, sans reseau, sans navigateur. Les contre-preuves chargent le code mute en memoire (crochet de
// compilation pour le serveur, texte mute pour la console) : aucun fichier n est ecrit. Elles comprennent
// l ancienne attribution (la graine avant le cote a cote, le code du 20/11 mot pour mot) et « toujours la piste 1 ».
// Lancement : node scripts/pistes-cote-a-cote-check.js [--contre-preuves]

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Module = require('module');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
for (const nom of Object.keys(process.env)) if (/^(PG|DATABASE|POSTGRES|RESEND|TWILIO|OPENROUTER|ANTHROPIC|OPENAI|BREVO|TELEGRAM)/i.test(nom)) delete process.env[nom];

const REGLE = 'assets/pinlane-pistes.js';
const MOTEUR = 'lib/ops-engine.js';
const APP = 'assets/app-main.js';
const MUTATIONS = {
  // L attribution d avant, mot pour mot : la graine remplace les candidats, puis la paire, puis l ecart.
  'ancienne-attribution': { f: REGLE, lettre: 'B', edits: [
    ['      if (graine.length) candidats.push(...autourDeLaGraine(graine, libres, nombre));', '      if (graine.length) candidats.splice(0, candidats.length, ...autourDeLaGraine(graine, libres, nombre));'],
    ['const exige = (groupe) => [trous(groupe), -garde(groupe), nombre === 2 && !paireEntiere(groupe) ? 1 : 0];', 'const exige = (groupe) => [nombre === 2 && !paireEntiere(groupe) ? 1 : 0, groupe[groupe.length - 1] - groupe[0]];'],
  ] },
  // L equilibre seul : les pistes les moins utilisees, ou qu elles soient.
  'eparpillee-par-l-equilibre': { f: REGLE, lettre: 'B', edits: [['const exige = (groupe) => [trous(groupe),', 'const exige = (groupe) => [0,']] },
  'toujours-la-piste-1': { f: REGLE, lettre: 'U', edits: [['    if (libres.length < nombre) return null;\n', '    if (libres.length < nombre) return null;\n    return libres.slice(0, nombre);\n']] },
  'plus-de-trous': { f: REGLE, lettre: 'S', edits: [['return groupe.length ? groupe[groupe.length - 1] - groupe[0] - (groupe.length - 1) : 0;', 'return groupe.length ? (seSuivent(groupe) ? 0 : 1) : 0;']] },
  'partage-muet': { f: REGLE, lettre: 'S', edits: [["    if (pistes.length < 2 || seSuivent(pistes)) return '';", "    return '';"]] },
  'moteur-muet': { f: MOTEUR, lettre: 'S', edits: [['    if (separees) allocation.pistesSeparees = separees;\n', '']] },
  'main-ignoree': { f: REGLE, lettre: 'M', edits: [['    const fermes = lirePistes(o.fermes).filter((piste) => libres.includes(piste)).sort((a, b) => a - b);', '    const fermes = [];']] },
  'reserver-sans-main': { f: APP, lettre: 'M', edits: [['allocateLanesIncludingSeed(besoin, current, s.date, heure, duree, undefined, main);', 'allocateLanesIncludingSeed(besoin, current, s.date, heure, duree, undefined, []);']] },
};
const MUTATION = (process.argv.find((a) => a.startsWith('--mutation=')) || '').slice('--mutation='.length);
if (MUTATION && !MUTATIONS[MUTATION]) { console.error(`mutation inconnue : ${MUTATION}`); process.exit(2); }
function muter(fichier, texte) {
  const m = MUTATION ? MUTATIONS[MUTATION] : null;
  let t = String(texte).split('\r\n').join('\n');
  if (!m || path.resolve(fichier) !== path.join(ROOT, m.f)) return t;
  m.edits.forEach(([de, vers]) => {
    if (t.split(de).length !== 2) throw new Error(`ANCRE DE MUTATION absente ou multiple (${MUTATION}) dans ${m.f}`);
    t = t.split(de).join(vers);
  });
  return t;
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
  if (temoin.status !== 0) { console.log(`${temoin.stdout || ''}${temoin.stderr || ''}`.split('\n').filter((l) => /ROUGE|Error/.test(l)).join('\n')); console.log('\npistes-cote-a-cote-check --contre-preuves: le gate est rouge sans mutation, aucune contre-preuve ne compte'); process.exit(1); }
  let rates = 0;
  for (const [nom, m] of Object.entries(MUTATIONS)) {
    const r = spawnSync(process.execPath, [__filename, `--mutation=${nom}`], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
    const sortie = `${r.stdout || ''}${r.stderr || ''}`;
    const mord = r.status === 1 && sortie.includes(`ROUGE [${m.lettre}]`) && !/ANCRE DE MUTATION/.test(sortie);
    if (!mord) rates += 1;
    console.log(`${mord ? 'TUEE ' : 'VIVANTE'} ${nom} (attendu : ROUGE [${m.lettre}], sortie ${r.status})${mord ? '' : `\n${sortie.split('\n').filter((l) => /ROUGE|ANCRE|Error/.test(l)).slice(0, 6).join('\n')}`}`);
  }
  console.log(rates ? `\npistes-cote-a-cote-check --contre-preuves: ${rates} mutation(s) vivante(s)` : '\npistes-cote-a-cote-check --contre-preuves: ALL OK - chaque regle retiree fait rougir sa lettre');
  process.exit(rates ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Les lecteurs de la regle : le moteur, la base, la console.
// ---------------------------------------------------------------------------
const P = require(path.join(ROOT, REGLE));
const E = require(path.join(ROOT, MOTEUR));
const D = require(path.join(ROOT, 'lib/database.js'));
const { getCenter } = require(path.join(ROOT, 'lib/ops-knowledge.js'));
const CENTRE = getCenter('libramont');
const PARC = Number(CENTRE.resources.bowling.laneCount);

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
// choisissent les pistes (Reserver, Modifier et « Ils sont N », la phrase du partage), telles que la page les sert.
const lire = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const bac = vm.createContext({ console, state: { booking: {}, reservations: [], laneStatuses: {} }, document: { getElementById: () => null } });
bac.window = bac;
vm.runInContext(muter(path.join(ROOT, REGLE), lire(REGLE)), bac, { filename: REGLE });
vm.runInContext(lire('assets/booking-core.js'), bac, { filename: 'assets/booking-core.js' });
const sourceConsole = muter(path.join(ROOT, APP), lire(APP));
['tientSesPlaces', 'getOccupiedLanes', 'usageDesPistesDuJour', 'allocateLanes', 'pistesSepareesConsole', 'allocateLanesIncludingSeed', 'parseLaneInput', 'getSuggestedEditLanes', 'reconcileQuickLaneSelection']
  .forEach((nom) => vm.runInContext(extraire(sourceConsole, nom), bac, { filename: `${APP} (${nom})` }));
bac.getBlocagesEnLigne = () => [];
bac.getAvailabilityLaneCount = () => PARC;
bac.getAvailabilitySessionCenter = () => ({ id: 'libramont', resources: { bowling: { laneCount: PARC, preferAdjacentLanes: true } } });
let besoinReserver = 1;
bac.getQuickBookLaneNeed = () => ({ requiredCount: besoinReserver });
const copie = (v) => JSON.parse(JSON.stringify(v));
const trie = (l) => (Array.isArray(l) ? [...l].map(Number).sort((a, b) => a - b) : l);
function poserJournee(journee, pannes) { bac.state.reservations = copie(journee); bac.state.laneStatuses = copie(pannes || {}); }
function console1(jour, journee, besoin, heure, duree) { poserJournee(journee); return trie(bac.allocateLanes(besoin, jour, heure, duree)); }

const enMinutes = (heure) => { const [h, m] = heure.split(':').map(Number); return h * 60 + m; };
function base(jour, journee, besoin, heure, duree) { return trie(D.allocateLanes(besoin, journee, {}, heure, duree, PARC, [], jour, CENTRE.resources.bowling.preferAdjacentLanes !== false)); }
let idSuivant = 5000;
function dossier(jour, heure, duree, pistes, extra = {}) {
  idSuivant += 1;
  return { id: idSuivant, centerId: 'libramont', date: jour, startTime: heure, duration: duree, totalDuration: duree, lanes: [...pistes], pax: 4, type: 'bowling', status: 'pending', ...extra };
}
// Le plan du moteur pour un groupe de bowling, comme le comptoir (et la reservation publique) le demande.
function planDuMoteur(jour, journee, heure, duree, joueurs, pistesVoulues = []) {
  const plan = E.planReservation({ centerId: 'libramont', date: jour, startTime: heure, pax: joueurs, type: 'bowling', duration: duree, channel: 'staff', lanes: pistesVoulues }, { reservations: journee, laneStatuses: {}, blocks: [] });
  const choisi = plan && plan.recommended;
  if (!choisi || !choisi.ok || choisi.startTime !== heure) return { plan, pistes: null };
  const bloc = (choisi.resourceBlocks || []).find((b) => b.resourceType === 'bowling_lane') || {};
  return { plan, pistes: trie(choisi.assignedLanes), besoin: plan.requiredLanes, phrase: bloc.pistesSeparees || '' };
}
function jourPlus(jour, n) { const d = new Date(`${jour}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
// Les jours ouverts (le lundi est ferme a Libramont), un par piste de depart du tour.
function joursDuTour(depuis = '2026-12-01') {
  const jours = [];
  for (let k = 0; jours.length < PARC && k < 30; k += 1) {
    const j = jourPlus(depuis, k);
    if (new Date(`${j}T12:00:00Z`).getUTCDay() === 1) continue;
    if (!jours.some((x) => P.premierePisteDuJour(x, PARC) === P.premierePisteDuJour(j, PARC))) jours.push(j);
  }
  return jours;
}
const seSuivent = (l) => Array.isArray(l) && l.every((p, i) => i === 0 || p === l[i - 1] + 1);

// ---------------------------------------------------------------------------
section('[V] UN JOUR VIDE ET UN GROUPE DE 12 : 2 PISTES COTE A COTE');
jouer(() => {
  const jours = joursDuTour();
  ok(jours.length === PARC, `[V] ${jours.length} jours ouverts, un par piste de depart du tour`, jours);
  const vus = jours.map((jour) => {
    const m = planDuMoteur(jour, [], '15:00', 1, 12);
    return { jour, besoin: m.besoin, moteur: m.pistes, base: base(jour, [], 2, '15:00', 1), console: console1(jour, [], 2, '15:00', 1) };
  });
  ok(vus.every((v) => v.besoin === 2 && v.moteur && v.moteur.length === 2 && seSuivent(v.moteur)), '[V] moteur (Reserver en Auto, reservation publique) : 12 joueurs, 2 pistes qui se suivent, chaque jour du tour', vus.map((v) => `${v.jour}:${v.moteur}`));
  ok(vus.every((v) => seSuivent(v.base) && v.base.length === 2 && seSuivent(v.console) && v.console.length === 2), '[V] base (le chemin de la reservation publique) et console : 2 pistes qui se suivent', vus.map((v) => `${v.base}|${v.console}`));
  ok(new Set(vus.map((v) => v.moteur.join('-'))).size > 1, '[V] le bloc change selon le jour : l equilibre choisit QUEL bloc', vus.map((v) => v.moteur.join('-')));
  const quatre = jours.map((jour) => planDuMoteur(jour, [], '15:00', 1, 20).pistes);
  ok(quatre.every((l) => l && l.length === 4 && seSuivent(l)), '[V] 20 joueurs : 4 pistes qui se suivent, chaque jour', quatre);
});

section('[U] DEUX RESERVATIONS D UNE PISTE NE PRENNENT PAS TOUTES LES DEUX LA PISTE 1');
jouer(() => {
  const resultats = joursDuTour().map((jour) => {
    const journee = [];
    ['14:00', '16:00'].forEach((heure) => {
      const { pistes } = planDuMoteur(jour, journee, heure, 1, 4);
      if (pistes) journee.push(dossier(jour, heure, 1, pistes));
    });
    return { jour, pistes: journee.map((r) => r.lanes[0]) };
  });
  ok(resultats.every((r) => r.pistes.length === 2 && !(r.pistes[0] === 1 && r.pistes[1] === 1)), '[U] chaque jour du tour : deux groupes d une piste (14:00 puis 16:00) ne sont jamais tous les deux sur la 1', resultats.map((r) => `${r.jour}:${r.pistes}`));
  ok(resultats.filter((r) => r.pistes[0] === 1).length <= 1, '[U] le premier groupe du jour ne tombe sur la 1 qu un jour sur huit', resultats.map((r) => r.pistes[0]));
  const jour = joursDuTour()[0];
  const deux = [console1(jour, [], 1, '14:00', 1)];
  deux.push(console1(jour, [dossier(jour, '14:00', 1, deux[0])], 1, '16:00', 1));
  ok(!(deux[0][0] === 1 && deux[1][0] === 1), '[U] console : les deux memes groupes ne sont pas tous les deux sur la 1', deux);
});

section('[B] LES PISTES 3 ET 5 PRISES : 1-2, 6-7 OU 7-8, JAMAIS 4 ET 6');
jouer(() => {
  const ADMIS = ['1,2', '6,7', '7,8'];
  // Les pistes 1, 2, 7 et 8 ont servi le matin ; 4 et 6 rien : l equilibre seul prendrait 4 et 6.
  const jour = '2026-11-28';
  const matin = [1, 2, 7, 8].map((p) => dossier(jour, '10:00', 2, [p]));
  const journee = [...matin, dossier(jour, '15:00', 1, [3]), dossier(jour, '15:00', 1, [5])];
  const m = planDuMoteur(jour, journee, '15:00', 1, 12);
  ok(m.pistes && ADMIS.includes(m.pistes.join(',')), '[B] moteur (Reserver en Auto, reservation publique) : 12 joueurs a 15:00 recoivent 1-2, 6-7 ou 7-8', m.pistes);
  const b = base(jour, journee, 2, '15:00', 1);
  const c = console1(jour, journee, 2, '15:00', 1);
  ok(b && ADMIS.includes(b.join(',')) && c && ADMIS.includes(c.join(',')), '[B] base et console (Reserver) : la meme regle, jamais 4 et 6', [b, c]);
  // Le groupe sur la 4 qui grandit a 12 (Modifier quand les joueurs changent, « Ils sont 12 » : le meme
  // getSuggestedEditLanes) : il quitte la 4 pour un bloc cote a cote.
  const groupe = dossier(jour, '15:00', 1, [4], { pax: 6 });
  poserJournee([...journee, groupe]);
  const modifier = trie(bac.getSuggestedEditLanes(2, jour, '15:00', 1, groupe.id, '4'));
  ok(modifier && ADMIS.includes(modifier.join(',')), '[B] Modifier et « Ils sont 12 » : le groupe de la 4 recoit 1-2, 6-7 ou 7-8, jamais 4 et 6 ni 2 et 4', modifier);
  const regle = trie(P.choisirPistes({ libres: [1, 2, 4, 6, 7, 8], nombre: 2, pistes: PARC, graine: [4], usage: {}, date: jour }));
  ok(regle && ADMIS.includes(regle.join(',')), '[B] la regle : une graine sans voisine libre cede devant un bloc cote a cote', regle);
  const mod = planDuMoteur(jour, journee, '15:00', 1, 12, [4]);
  ok(mod.pistes && ADMIS.includes(mod.pistes.join(',')), '[B] moteur, modification qui demandait la 4 : un bloc cote a cote', mod.pistes);
  // Sa voisine libre : la graine reste (5 libre, 3 prise : 4-5 plutot qu un bloc ailleurs).
  const garde = trie(P.choisirPistes({ libres: [1, 2, 4, 5, 6, 7, 8], nombre: 2, pistes: PARC, graine: [4], usage: {}, date: jour }));
  ok(JSON.stringify(garde) === '[4,5]', '[B] la graine avec une voisine libre reste : 4 et 5', garde);
  const trois = trie(P.choisirPistes({ libres: [3, 4, 6, 7, 8], nombre: 3, pistes: PARC, graine: [3, 4], usage: {}, date: jour }));
  ok(JSON.stringify(trois) === '[6,7,8]', '[B] un groupe de 3-4 qui passe a 3 pistes, la 5 prise : 6-7-8, pas 3, 4 et 6', trois);
});

section('[S] SEULES DES PISTES NON VOISINES SONT LIBRES : LE PARTAGE QUI LAISSE LE MOINS DE TROUS, ET LA PHRASE');
jouer(() => {
  const jour = '2026-11-28';
  const PHRASE = 'pistes 3 et 6 : aucune paire côte à côte n’est libre';
  const prises = [1, 2, 4, 5, 7, 8].map((p) => dossier(jour, '15:00', 1, [p]));
  const m = planDuMoteur(jour, prises, '15:00', 1, 12);
  ok(m.pistes && m.pistes.join(',') === '3,6' && m.phrase === PHRASE, '[S] moteur : seules la 3 et la 6 sont libres, le plan les garde et dit « pistes 3 et 6 : aucune paire côte à côte n’est libre »', [m.pistes, m.phrase]);
  const c = console1(jour, prises, 2, '15:00', 1);
  const phraseConsole = bac.pistesSepareesConsole(c, jour, '15:00', 1);
  ok(c && c.join(',') === '3,6' && phraseConsole === PHRASE, '[S] console : les memes pistes, la meme phrase', [c, phraseConsole]);
  // Le moins de trous : 1-3 ou 6-8 (un trou), jamais 3-6 (deux trous) ; la 3 et la 6 n ont encore rien fait.
  const journee = [...[1, 8].map((p) => dossier(jour, '10:00', 2, [p])), ...[2, 4, 5, 7].map((p) => dossier(jour, '15:00', 1, [p]))];
  const moinsDeTrous = planDuMoteur(jour, journee, '15:00', 1, 12);
  ok(moinsDeTrous.pistes && ['1,3', '6,8'].includes(moinsDeTrous.pistes.join(',')) && /aucune paire côte à côte n’est libre$/.test(moinsDeTrous.phrase), '[S] libres 1, 3, 6 et 8 : un trou (1-3 ou 6-8), jamais 3 et 6, et la phrase', [moinsDeTrous.pistes, moinsDeTrous.phrase]);
  const regle3 = trie(P.choisirPistes({ libres: [1, 2, 5, 7, 8], nombre: 3, pistes: PARC, usage: {}, date: jour }));
  ok(JSON.stringify(regle3) === '[5,7,8]' && P.pistesSeparees({ pistes: regle3, libres: [1, 2, 5, 7, 8] }) === 'pistes 5, 7 et 8 : aucun bloc de 3 pistes côte à côte n’est libre', '[S] trois pistes, libres 1, 2, 5, 7 et 8 : 5, 7 et 8 (un trou), et la phrase', [regle3, P.pistesSeparees({ pistes: regle3, libres: [1, 2, 5, 7, 8] })]);
  const cote = planDuMoteur(jour, [], '15:00', 1, 12);
  ok(cote.pistes && seSuivent(cote.pistes) && cote.phrase === '' && P.pistesSeparees({ pistes: [3, 6], libres: [1, 2, 3, 6] }) === '', '[S] des pistes cote a cote, ou un bloc libre que le staff n a pas pris : aucune phrase', [cote.pistes, cote.phrase]);
});

section('[M] UNE PISTE CHOISIE A LA MAIN EST RESPECTEE');
jouer(() => {
  const jour = '2026-11-28';
  const regle = trie(P.choisirPistes({ libres: [1, 2, 4, 6, 7, 8], nombre: 2, pistes: PARC, fermes: [4], usage: {}, date: jour }));
  ok(regle && regle.includes(4) && regle.length === 2, '[M] la regle : la 4 touchee a la main reste, meme sans voisine libre', regle);
  ok(P.pistesSeparees({ pistes: regle, libres: [1, 2, 4, 6, 7, 8], fermes: [4] }) === `pistes ${regle.join(' et ')} : aucune paire côte à côte ne passe par la piste 4, choisie à la main`, '[M] et la phrase le dit', P.pistesSeparees({ pistes: regle, libres: [1, 2, 4, 6, 7, 8], fermes: [4] }));
  const voisine = trie(P.choisirPistes({ libres: [1, 2, 3, 4, 5, 6, 7, 8], nombre: 2, pistes: PARC, fermes: [4], usage: {}, date: jour }));
  ok(JSON.stringify(voisine) === '[3,4]', '[M] avec ses voisines libres : la 4 et sa voisine de paire', voisine);
  ok(P.pistesSeparees({ pistes: [3, 6], libres: [1, 2, 3, 6], fermes: [3, 6] }) === '', '[M] deux pistes posees a la main par le staff : aucune phrase, c est son choix', P.pistesSeparees({ pistes: [3, 6], libres: [1, 2, 3, 6], fermes: [3, 6] }));
  // La fenetre Reserver : la case de la piste 4 touchee au planning, 12 joueurs, 3 et 5 prises.
  const journee = [dossier(jour, '15:00', 1, [3]), dossier(jour, '15:00', 1, [5])];
  poserJournee(journee);
  besoinReserver = 2;
  bac.quickBookState = { type: 'bowling', formuleId: '', date: jour, startTime: '15:00', duration: 1, pax: 12, lanes: [4], lanesALaMain: [4], autoAssign: false };
  bac.reconcileQuickLaneSelection();
  const reserver = trie(bac.quickBookState.lanes);
  ok(reserver && reserver.length === 2 && reserver.includes(4), '[M] Reserver : la piste 4 touchee a la main reste, la fenetre ajoute la seconde', reserver);
  ok(bac.pistesSepareesConsole(reserver, jour, '15:00', 1, undefined, [4]).includes('la piste 4, choisie à la main'), '[M] Reserver : la phrase dit pourquoi elles ne se suivent pas', bac.pistesSepareesConsole(reserver, jour, '15:00', 1, undefined, [4]));
  const moteur = planDuMoteur(jour, journee, '15:00', 1, 12, [4, 6]);
  ok(moteur.pistes && moteur.pistes.join(',') === '4,6', '[M] moteur : deux pistes demandees par le staff (4 et 6) sont gardees telles quelles', moteur.pistes);
});

section('[D] LE DUCKPIN NE PREND AUCUNE PISTE DE BOWLING');
jouer(() => {
  const jour = '2026-11-28';
  const duckpin = dossier(jour, '15:00', 1, [], { type: 'duckpin', opsPlan: { resourceBlocks: [{ activityId: 'duckpin_bowling', resourceType: 'duckpin_lane', start: enMinutes('15:00'), end: enMinutes('16:00'), units: 2 }] } });
  const sans = planDuMoteur(jour, [], '15:00', 1, 12).pistes;
  const avec = planDuMoteur(jour, [duckpin], '15:00', 1, 12).pistes;
  ok(sans && avec && sans.join(',') === avec.join(',') && avec.every((p) => p >= 1 && p <= PARC), '[D] deux pistes de duckpin a 15:00 : le groupe de bowling garde les memes pistes de bowling', [sans, avec]);
});

console.log(rouges
  ? `\npistes-cote-a-cote-check: ${rouges} ROUGE(S)`
  : '\npistes-cote-a-cote-check: ALL OK - un groupe de plusieurs pistes les recoit cote a cote, le partage se dit, la main est respectee');
process.exit(rouges ? 1 : 0);

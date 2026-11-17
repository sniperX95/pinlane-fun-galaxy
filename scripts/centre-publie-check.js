// UN CENTRE QUI N A RIEN PUBLIE NE VEND RIEN EN LIGNE (2026-11-17, avant-lancement D2).
//
// Les horaires de repli et les grilles de prix de depart du code sont ceux du premier client. Un centre ne
// dans la console et passe « actif » avant que son gerant ait rien saisi ouvrait ses reservations en ligne
// aux heures de Libramont et vendait le bowling, le laser et le Fun Run aux prix de Fun Galaxy.
//
// [A] LA REGLE (lib/centre-publie.js), sans base. Un centre du fichier socle n est jamais concerne, meme
//     Gembloux dont la grille du fichier est un marqueur texte. Hors du socle : sans jour ouvert declare, il
//     manque les horaires ; avec des horaires, il manque les tarifs tant qu une activite vendue a la grille
//     (bowling a l heure, laser, Fun Run) n a pas la sienne. Le bowling vendu a la partie compte comme
//     declare. Une activite a prix fixe ne demande rien. Les deux phrases se distinguent de « pas encore »
//     (centre en preparation) et de « ne prend plus » (centre ferme).
// [B] LE SERVEUR (lib/ops-knowledge.js, le vrai, avec des centres comme la base les rend). Le refus des
//     creneaux et des reservations (publicBookingBlockReason) et la fermeture du formulaire (coupureEnLigne)
//     disent la meme phrase. Un centre qui a publie n en recoit aucune. Un centre en preparation garde son
//     propre refus. Les centres du socle ne bougent pas. La coupure decidee par l equipe garde sa phrase.
//
// Le parcours entier (console, catalogue, creneaux, reservation) est joue sur les vrais endpoints par
// scripts/second-client-onboarding-check.js et scripts/public-center-guard-check.js.
// Les contre-preuves chargent le code mute en memoire : aucun fichier n est ecrit.
// Lancement : node scripts/centre-publie-check.js [--contre-preuves]

'use strict';

const path = require('path');
const Module = require('module');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
// Aucune base : les centres sont poses en memoire, comme refreshCenterOverrides les poserait.
['DATABASE_URL', 'POSTGRES_URL'].forEach((cle) => { delete process.env[cle]; });

const MUTATIONS = {
  'socle-plus-exempt': { f: 'lib/centre-publie.js', de: " || SOCLE.has(String(centre.id || ''))) return '';", vers: ") return '';", lettre: 'A' },
  'horaires-non-exiges': { f: 'lib/centre-publie.js', de: "  if (!require('./center-facts').joursOuvertsDeclares(centre.defaultSchedule)) return 'horaires';\n", vers: '', lettre: 'A' },
  'tarifs-non-exiges': { f: 'lib/centre-publie.js', de: "    if (!grilleDeclaree(centre, nom)) return 'tarifs';\n", vers: '', lettre: 'A' },
  'tarif-a-la-partie-oublie': { f: 'lib/centre-publie.js', de: "    if (nom === 'bowling' && centre.resources && centre.resources.bowling && centre.resources.bowling.pricing) continue;\n", vers: '', lettre: 'A' },
  'refus-du-serveur-debranche': { f: 'lib/ops-knowledge.js', de: "  return require('./centre-publie').phraseNonPublie(center);\n}", vers: "  return '';\n}", lettre: 'B' },
  'formulaire-pas-ferme': { f: 'lib/ops-knowledge.js', de: "  if (!center.embed || center.embed.actif !== false) return /^(planned|closed)$/.test(String(center.status || '')) ? '' : require('./centre-publie').phraseNonPublie(center);", vers: "  if (!center.embed || center.embed.actif !== false) return '';", lettre: 'B' },
};
const MUTATION = (process.argv.find((a) => a.startsWith('--mutation=')) || '').slice('--mutation='.length);
if (MUTATION && !MUTATIONS[MUTATION]) { console.error(`mutation inconnue : ${MUTATION}`); process.exit(2); }
const compiler = Module.prototype._compile;
Module.prototype._compile = function compilerMute(contenu, fichier) {
  const m = MUTATION ? MUTATIONS[MUTATION] : null;
  if (m && path.resolve(fichier) === path.join(ROOT, m.f)) {
    const t = String(contenu).split('\r\n').join('\n');
    if (t.split(m.de).length !== 2) throw new Error(`ANCRE DE MUTATION absente ou multiple (${MUTATION}) dans ${m.f}`);
    return compiler.call(this, t.split(m.de).join(m.vers), fichier);
  }
  return compiler.call(this, contenu, fichier);
};

let rouges = 0;
let lettre = '';
function section(titre) { lettre = (titre.match(/^\[([A-Z])\]/) || [])[1] || ''; console.log(`\n${titre}`); }
function ok(condition, quoi, detail) {
  if (condition) { console.log(`ok    ${quoi}`); return; }
  rouges += 1;
  console.log(`ROUGE [${lettre}] ${quoi}${detail !== undefined ? ` : ${String(detail).slice(0, 300)}` : ''}`);
}

if (process.argv.includes('--contre-preuves')) {
  const temoin = spawnSync(process.execPath, [__filename], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  if (temoin.status !== 0) { console.log(`${temoin.stdout || ''}${temoin.stderr || ''}`.split('\n').filter((l) => /ROUGE|Error/.test(l)).join('\n')); console.log('\ncentre-publie-check --contre-preuves: le gate est rouge sans mutation, aucune contre-preuve ne compte'); process.exit(1); }
  let rates = 0;
  for (const [nom, m] of Object.entries(MUTATIONS)) {
    const r = spawnSync(process.execPath, [__filename, `--mutation=${nom}`], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
    const sortie = `${r.stdout || ''}${r.stderr || ''}`;
    const mord = r.status === 1 && sortie.includes(`ROUGE [${m.lettre}]`) && !/ANCRE DE MUTATION/.test(sortie);
    if (!mord) rates += 1;
    console.log(`${mord ? 'TUEE ' : 'VIVANTE'} ${nom} (attendu : ROUGE [${m.lettre}], sortie ${r.status})${mord ? '' : `\n${sortie.split('\n').filter((l) => /ROUGE|ANCRE|Error/.test(l)).slice(0, 6).join('\n')}`}`);
  }
  console.log(rates ? `\ncentre-publie-check --contre-preuves: ${rates} mutation(s) vivante(s)` : '\ncentre-publie-check --contre-preuves: ALL OK - chaque regle retiree fait rougir sa lettre');
  process.exit(rates ? 1 : 0);
}

const { manqueAPublier, phraseNonPublie, PHRASES } = require('../lib/centre-publie');
const CENTRES = require('../ops-knowledge/centers.json').centers;
const SEMAINE = { regular: { 0: { open: '10:00', close: '22:00' }, 1: null, 2: { open: '14:00', close: '22:00' }, 3: { open: '14:00', close: '22:00' }, 4: { open: '14:00', close: '22:00' }, 5: { open: '14:00', close: '23:00' }, 6: { open: '10:00', close: '23:00' } }, holiday: {} };
const BOWLING = { id: 'bowling', priceType: 'grid_bowling' };
const LASER = { id: 'laser_game', priceType: 'grid_laser' };
const FUN_RUN = { id: 'fun_run', priceType: 'grid_fun_run' };
const KARA = { id: 'kara-box', priceType: 'per_pax', priceValue: 10 };
const neuf = (plus) => ({ id: 'bowling-atlas', name: 'Bowling Atlas', status: 'active', ...plus });

section('[A] LA REGLE : ce qu un centre doit avoir publie pour vendre en ligne');
{
  const fichier = (id) => CENTRES.find((c) => c.id === id);
  ok(typeof fichier('gembloux').defaultSchedule === 'string' && manqueAPublier(fichier('gembloux'), { activites: [BOWLING, LASER] }) === '', 'Gembloux, dont la grille du fichier est un marqueur texte, n est pas concerne : il est du socle', manqueAPublier(fichier('gembloux'), { activites: [BOWLING, LASER] }));
  ok(CENTRES.every((c) => manqueAPublier(c, { activites: [BOWLING, LASER, FUN_RUN] }) === ''), 'aucun centre du fichier socle n est concerne (Libramont, Gembloux, Ciney, la demonstration)');
  ok(manqueAPublier(neuf({}), { activites: [] }) === 'horaires' && manqueAPublier(neuf({ defaultSchedule: 'to_confirm' }), { activites: [] }) === 'horaires', 'hors du socle, sans grille d horaires (ou avec un marqueur texte) : il manque les horaires');
  ok(manqueAPublier(neuf({ defaultSchedule: { regular: { 0: null, 1: null, 2: null }, holiday: {} } }), { activites: [] }) === 'horaires', 'une grille ou tous les jours sont fermes ne publie aucun horaire');
  ok(manqueAPublier(neuf({ defaultSchedule: SEMAINE }), { activites: [BOWLING] }) === 'tarifs', 'avec ses horaires mais sans grille, le bowling a l heure se vendrait au prix de depart : il manque les tarifs');
  ok(manqueAPublier(neuf({ defaultSchedule: SEMAINE, grillesTarif: { bowling: { 1: 34 } } }), { activites: [BOWLING] }) === '', 'sa grille du bowling posee : rien ne manque');
  ok(manqueAPublier(neuf({ defaultSchedule: SEMAINE, resources: { bowling: { laneCount: 8, pricing: { mode: 'per_game_per_person', tiers: [{ price: 7 }] } } } }), { activites: [BOWLING, KARA] }) === '', 'un bowling vendu a la partie porte son tarif : rien ne manque (le cas de N4 Bowling)');
  ok(manqueAPublier(neuf({ defaultSchedule: SEMAINE, grillesTarif: { bowling: { 1: 34 } } }), { activites: [BOWLING, LASER] }) === 'tarifs', 'il vend aussi du laser sans grille du laser : il manque les tarifs');
  ok(manqueAPublier(neuf({ defaultSchedule: SEMAINE, grillesTarif: { bowling: { 1: 34 }, laser: { 1: 9 }, funRun: { 15: 28 } } }), { activites: [BOWLING, LASER, FUN_RUN] }) === '', 'chaque activite a la grille a la sienne : rien ne manque');
  ok(manqueAPublier(neuf({ defaultSchedule: SEMAINE }), { activites: [KARA] }) === '' && manqueAPublier(neuf({ defaultSchedule: SEMAINE }), { activites: [] }) === '', 'une activite a prix fixe porte deja son prix : rien ne manque');
  ok(manqueAPublier(null) === '' && manqueAPublier(undefined) === '', 'sans centre, la regle ne dit rien (le refus « centre inconnu » vit ailleurs)');
  const phrases = Object.values(PHRASES);
  ok(phrases.length === 2 && phrases[0] !== phrases[1] && phrases.every((p) => /n’a pas publié/.test(p) && /pour le moment/.test(p) && !/pas encore|ne prend plus|inconnu/i.test(p)), 'deux phrases distinctes, qui ne se confondent ni avec « pas encore » ni avec « ne prend plus »', phrases.join(' | '));
  ok(phraseNonPublie(neuf({}), { activites: [] }) === PHRASES.horaires && phraseNonPublie(neuf({ defaultSchedule: SEMAINE }), { activites: [BOWLING] }) === PHRASES.tarifs, 'chaque manque a sa phrase');
}

section('[B] LE SERVEUR : il refuse et ferme le formulaire avec la meme phrase');
{
  const ops = require('../lib/ops-knowledge');
  // Un centre comme loadCenterRecords le rend : sa configuration enregistree sous la cle config.
  const config = (plus) => ({ config: plus });
  const TOUT = { bowling: { 0.5: 18, 1: 34, 1.5: 50, 2: 66 }, laser: { 1: 9, 2: 16, 3: 22 }, funRun: Object.fromEntries(require('../lib/booking-config').FUN_RUN_OPTIONS.map((o) => [o.minutes, 20 + o.minutes])) };
  ops.applyCenterRecords([
    { id: 'gate-nu', name: 'Gate Nu', status: 'active', timezone: 'Europe/Brussels', config: null },
    { id: 'gate-publie', name: 'Gate Publie', status: 'active', timezone: 'Europe/Brussels', ...config({ defaultSchedule: SEMAINE, grillesTarif: TOUT }) },
    { id: 'gate-prevu', name: 'Gate Prevu', status: 'planned', timezone: 'Europe/Brussels', config: null },
    { id: 'gate-coupe', name: 'Gate Coupe', status: 'active', timezone: 'Europe/Brussels', ...config({ defaultSchedule: SEMAINE, grillesTarif: TOUT, embed: { actif: false } }) },
  ]);
  const connu = (id) => { try { return ops.getCenter(id); } catch (e) { return null; } };
  ok(connu('gate-nu') && connu('gate-publie') && connu('gate-prevu'), 'MONTAGE : les centres du gate existent, comme nes dans la console');
  ok(ops.publicBookingBlockReason('gate-nu') === PHRASES.horaires, 'un centre actif qui n a rien publie : creneaux et reservations refuses, il le dit', ops.publicBookingBlockReason('gate-nu') || '(vide)');
  ok(ops.coupureEnLigne('gate-nu') === PHRASES.horaires, 'et son formulaire se ferme sur la meme phrase', ops.coupureEnLigne('gate-nu') || '(vide)');
  ok(ops.publicBookingBlockReason('gate-publie') === '' && ops.coupureEnLigne('gate-publie') === '', 'un centre qui a publie ses horaires et ses grilles ne recoit aucun refus', `${ops.publicBookingBlockReason('gate-publie')} | ${ops.coupureEnLigne('gate-publie')}`);
  ok(/pas encore/.test(ops.publicBookingBlockReason('gate-prevu')) && ops.coupureEnLigne('gate-prevu') === '', 'un centre en preparation garde son propre refus, « pas encore », jamais « rien de publie »', `${ops.publicBookingBlockReason('gate-prevu')} | ${ops.coupureEnLigne('gate-prevu')}`);
  ok(['libramont', 'gembloux', 'demo'].every((id) => ops.publicBookingBlockReason(id) === '' && ops.coupureEnLigne(id) === ''), 'les centres du socle ne recoivent aucun refus', ['libramont', 'gembloux', 'demo'].map((id) => `${id}:${ops.publicBookingBlockReason(id)}${ops.coupureEnLigne(id)}`).join(' '));
  ok(/ne se prennent pas ici pour le moment/.test(ops.coupureEnLigne('gate-coupe')) && !/n’a pas publié/.test(ops.coupureEnLigne('gate-coupe')), 'la coupure decidee par l equipe garde sa phrase', ops.coupureEnLigne('gate-coupe'));
}

console.log(rouges ? `\ncentre-publie-check: ${rouges} ROUGE(S)` : '\ncentre-publie-check: ALL OK');
process.exit(rouges ? 1 : 0);

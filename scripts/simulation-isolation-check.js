// Isolation des reservations de simulation : gate a DEUX SENS.
//
// Contexte (sonde prod lecture seule, 2026-07-19) : lib/ops-simulation.js
// appelle le vrai createReservation, donc 18 lignes de simulation
// (channel 'sim-staff' / 'sim-client') vivent dans la vraie table reservations
// et portaient 6790 EUR de CA fantome contre 6689 EUR de CA reel. Le predicat
// d'exclusion vit desormais dans lib/simulation-filter.js.
//
// SENS 1 : l'exclusion est PRESENTE a chaque point de consommation ANALYTIQUE
//   (CA, metriques, ciblage de messages). Sans ca, le CA affiche est gonfle et
//   une persona de simulation peut declencher un vrai email ou SMS.
//
// SENS 2 : l'exclusion est ABSENTE des trois lecteurs de CAPACITE
//   (readStaffState, readAvailabilitySnapshot, listReservationsForDate).
//   readStaffState n'est pas un lecteur d'affichage : c'est le readState du
//   planificateur (lib/reservation-ops.js). Si le planificateur cessait de voir
//   les lignes de simulation pendant que l'allocateur continue de les voir, le
//   plan attribuerait une piste occupee, ensureAssignableLanes leverait
//   "Ce creneau vient de changer", les alternatives seraient calculees sur le
//   meme etat filtre donc egalement occupees, et un vrai client payant
//   tournerait en boucle sur un echec. Ce sens 2 est ce qui empeche cette
//   regression de revenir un jour.
//
// Pourquoi un gate STATIQUE et des tests unitaires directs, et pas un test
// comportemental via withFakeDatabase : makeFakePg
// (scripts/run-backend-data-tests.js) matche les requetes par REGEX puis
// applique SON PROPRE filtre JS (statut/date/centre) en IGNORANT tout predicat
// SQL ajoute. Un test comportemental passant par la serait vert avec ou sans
// le correctif : faux vert.
//
// Garde anti-echantillon-vide : un gate qui n'inspecte rien et passe vert est
// un faux gate. Preuve d'echec sur echantillon vide :
//   node scripts/simulation-isolation-check.js <dossier-vide>  ->  exit 1

const fs = require('fs');
const path = require('path');

const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '..');

let failures = 0;
function ok(cond, label) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`);
  if (!cond) failures += 1;
  return cond;
}
function fail(message) {
  console.error(`simulation-isolation-check: FAIL ${message}`);
  process.exit(1);
}

// ── Chargement des sources inspectees ───────────────────────────────────────
// Chaque entree : fichier + ancres SQL/JS qui doivent porter l'exclusion.
const ANALYTIC_POINTS = [
  { file: 'lib/database.js', label: 'readAdminRangeState (analytics direction)', anchors: ['simulationSqlExclusion'] },
  { file: 'lib/direction-analytics.js', label: 'buildDirectionAnalytics (history ET rows)', anchors: ['excludeSimulationRows'] },
  { file: 'lib/center-metrics.js', label: 'buildDailyMetricsForDate (warehouse quotidien)', anchors: ['simulationSqlExclusion'] },
  { file: 'lib/ops-communications.js', label: 'relances / birthday_j30 / dormants / sequences', anchors: ['simulationSqlExclusion'] },
  { file: 'lib/marketing-roi.js', label: 'attribution ROI (jointure attributed)', anchors: ['simulationSqlExclusion'] },
  { file: 'lib/marketing-brain.js', label: 'cerveau marketing (reservations bookees)', anchors: ['simulationSqlExclusion'] },
  { file: 'lib/email-agent.js', label: 'matchClient (fiche CRM)', anchors: ['simulationSqlExclusion'] },
];

// Lecteurs de CAPACITE : l'exclusion doit y etre ABSENTE. On inspecte le CORPS
// de la fonction, pas le fichier : lib/database.js porte legitimement le
// predicat ailleurs (readAdminRangeState, deleteSimulationData).
const CAPACITY_READERS = [
  { file: 'lib/database.js', fn: 'readStaffState', why: 'readState du planificateur (lib/reservation-ops.js)' },
  { file: 'lib/database.js', fn: 'readAvailabilitySnapshot', why: 'disponibilites publiques du chemin de reservation' },
  { file: 'lib/database.js', fn: 'listReservationsForDate', why: 'allocateur de pistes (create/update/plan de retard)' },
];

const sources = new Map();
function loadSource(relative) {
  if (sources.has(relative)) return sources.get(relative);
  const full = path.join(root, relative);
  if (!fs.existsSync(full)) fail(`fichier inspecte introuvable: ${full}`);
  const content = fs.readFileSync(full, 'utf8');
  if (content.length < 500) fail(`fichier trop petit pour etre la vraie source: ${relative} (${content.length} octets)`);
  sources.set(relative, content);
  return content;
}

// Extrait le corps d'une fonction nommee par comptage d'accolades.
// ATTENTION : on saute d'abord la LISTE DE PARAMETRES. Un parametre destructure
// (`function f(a, b, { client = null } = {})`) ouvre une accolade avant le corps ;
// prendre le premier `{` rencontre renverrait `{ client = null }` comme corps,
// donc un corps vide de toute logique, et l'assertion passerait sur du vide.
// (Bug reel rencontre sur buildDailyMetricsForDate en ecrivant ce gate.)
function functionBody(content, name) {
  const header = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const match = header.exec(content);
  if (!match) return null;
  // Fin de la liste de parametres : parenthese fermante appariee.
  const parenOpen = content.indexOf('(', match.index);
  if (parenOpen === -1) return null;
  let parenDepth = 0;
  let parenClose = -1;
  for (let i = parenOpen; i < content.length; i += 1) {
    if (content[i] === '(') parenDepth += 1;
    else if (content[i] === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) { parenClose = i; break; }
    }
  }
  if (parenClose === -1) return null;
  const open = content.indexOf('{', parenClose);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < content.length; i += 1) {
    if (content[i] === '{') depth += 1;
    else if (content[i] === '}') {
      depth -= 1;
      if (depth === 0) return content.slice(open, i + 1);
    }
  }
  return null;
}

// ── Garde anti-echantillon-vide ─────────────────────────────────────────────
const filterPath = path.join(root, 'lib/simulation-filter.js');
if (!fs.existsSync(filterPath)) fail(`lib/simulation-filter.js introuvable dans ${root} (echantillon vide)`);

let inspectedBytes = 0;
for (const point of ANALYTIC_POINTS) inspectedBytes += loadSource(point.file).length;
for (const reader of CAPACITY_READERS) loadSource(reader.file);

if (ANALYTIC_POINTS.length < 7) fail(`echantillon analytique trop petit (${ANALYTIC_POINTS.length} points)`);
if (CAPACITY_READERS.length !== 3) fail(`les 3 lecteurs de capacite doivent etre inspectes (${CAPACITY_READERS.length})`);
if (inspectedBytes < 100000) fail(`echantillon trop petit (${inspectedBytes} octets) : ce n'est pas le vrai lib/`);

// ── [UNIT] le predicat lui-meme ─────────────────────────────────────────────
console.log('[UNIT] lib/simulation-filter.js');
const {
  SIMULATION_CHANNELS,
  isSimulationReservation,
  excludeSimulationRows,
  simulationSqlExclusion,
} = require(filterPath);

ok(SIMULATION_CHANNELS.length === 2
  && SIMULATION_CHANNELS.includes('sim-client')
  && SIMULATION_CHANNELS.includes('sim-staff'),
  `channels de simulation = sim-client + sim-staff (obtenu ${JSON.stringify(SIMULATION_CHANNELS)})`);

ok(isSimulationReservation({ channel: 'sim-staff' }) === true, 'sim-staff reconnu comme simulation');
ok(isSimulationReservation({ channel: 'sim-client' }) === true, 'sim-client reconnu comme simulation');
ok(isSimulationReservation({ channel: 'staff' }) === false, 'staff reconnu comme reel');
ok(isSimulationReservation({ channel: 'public' }) === false, 'public reconnu comme reel');
ok(isSimulationReservation({ channel: '' }) === false, 'channel vide reconnu comme reel (jamais de faux positif)');
ok(isSimulationReservation({}) === false, 'channel absent reconnu comme reel');
ok(isSimulationReservation(null) === false, 'ligne nulle non traitee comme simulation');
// Asymetrie assumee : la LECTURE ne retient QUE le channel, pas les notes.
// Le delete de resetSimulation retient les deux (channel OU notes '[SIM:%').
ok(isSimulationReservation({ channel: 'staff', notes: '[SIM:run_1] note collee' }) === false,
  'notes "[SIM:" seules ne suffisent PAS a la lecture (asymetrie assumee vs le delete)');

const mixed = [
  { id: 1, channel: 'public', price: 100 },
  { id: 2, channel: 'sim-client', price: 500 },
  { id: 3, channel: 'staff', price: 200 },
  { id: 4, channel: 'sim-staff', price: 900 },
];
const kept = excludeSimulationRows(mixed);
ok(kept.length === 2 && kept.every((row) => !String(row.channel).startsWith('sim-')),
  `excludeSimulationRows retire les 2 lignes de simulation (obtenu ${kept.length} reelles)`);
ok(kept.reduce((sum, row) => sum + row.price, 0) === 300,
  'le CA agrege ne compte que les lignes reelles (300, pas 1700)');
ok(excludeSimulationRows(mixed, { includeSimulation: true }).length === 4,
  'includeSimulation: true rend la liste intacte (opt-in console de simulation)');
ok(excludeSimulationRows(mixed, { includeSimulation: 'true' }).length === 2,
  'opt-in strictement booleen : une chaine ne desactive pas le filtre');
ok(excludeSimulationRows(null).length === 0, 'entree non tableau ne casse pas');

const sql = simulationSqlExclusion();
ok(sql.includes("'sim-client'") && sql.includes("'sim-staff'") && /not\s+in/i.test(sql),
  `fragment SQL exclut les deux channels (obtenu: ${sql})`);
ok(/coalesce\(\s*channel/i.test(sql), 'fragment SQL neutralise le NULL (coalesce)');
ok(simulationSqlExclusion('res').includes('res.channel'), 'fragment SQL supporte un alias de table');

// ── [SENS 1] exclusion PRESENTE aux points analytiques ──────────────────────
console.log('\n[SENS 1] exclusion presente aux points de consommation analytiques');
for (const point of ANALYTIC_POINTS) {
  const content = loadSource(point.file);
  const requires = /require\(['"]\.\/simulation-filter['"]\)/.test(content);
  const anchored = point.anchors.every((anchor) => content.includes(anchor));
  ok(requires && anchored, `${point.file} : ${point.label}`);
}

// direction-analytics : assertion COMPORTEMENTALE, pas textuelle. Verifier la
// presence de la chaine 'excludeSimulationRows' ne prouve RIEN : remplacer
// l'appel par excludeSimulationRows(history, { includeSimulation: true })
// neutralise totalement le filtre tout en gardant la chaine (faux vert
// demontre par un relecteur adverse). On compare donc deux executions : ajouter
// une ligne de simulation a l'historique ne doit RIEN changer au resultat.
const { buildDirectionAnalytics } = require(path.join(root, 'lib', 'direction-analytics.js'));
const ligneReelle = {
  id: 1, date: '2026-07-15', status: 'paid', price: 137, channel: 'public',
  email: 'vrai@client.be', phone: '+32470000001', pax: 4, type: 'bowling', formule_id: null,
};
const ligneSimulation = {
  id: 2, date: '2026-07-15', status: 'paid', price: 8642, channel: 'sim-staff',
  email: 'persona@simulation.local', phone: '+32470000002', pax: 6, type: 'bowling', formule_id: null,
};
const fenetre = { startDate: '2026-07-01', endDate: '2026-07-31', center: { id: 'libramont' } };
const sansSimulation = buildDirectionAnalytics({ history: [ligneReelle], ...fenetre });
const avecSimulation = buildDirectionAnalytics({ history: [ligneReelle, ligneSimulation], ...fenetre });
ok(JSON.stringify(sansSimulation) === JSON.stringify(avecSimulation),
  'buildDirectionAnalytics : ajouter une ligne de simulation ne change RIEN au resultat (comparaison de deux executions)');
ok(JSON.stringify(sansSimulation).includes('137'),
  'buildDirectionAnalytics : le CA reel ressort bien (le filtre ne vide pas tout)');

// ops-communications porte PLUSIEURS declencheurs de messages reels : chacun
// doit etre couvert, pas seulement le premier (un import unique ne prouve rien).
const commsContent = loadSource('lib/ops-communications.js');
const commsUses = (commsContent.match(/simulationSqlExclusion\(/g) || []).length;
// 5 requetes a couvrir : getRelanceStats, birthday_j30, dormants dormants,
// findCustomSequenceCandidates (clientsCte partagee + before_visit).
// L'import destructure ne compte pas : il n'appelle pas la fonction.
ok(commsUses >= 5, `lib/ops-communications.js applique l'exclusion a ses 5 requetes reservations (obtenu ${commsUses} appels)`);

// Le warehouse quotidien ne selectionne pas la colonne channel : le predicat
// DOIT etre en SQL, un filtre JS en aval serait impossible.
const metricsBody = functionBody(loadSource('lib/center-metrics.js'), 'buildDailyMetricsForDate');
// Garde anti-corps-vide : un corps tronque satisferait "0 filtre interdit"
// aussi bien qu'un corps correct.
// ANCRE plutot que TAILLE : un seuil en octets compte aussi les fins de ligne,
// donc une simple conversion CRLF -> LF faisait tomber la garde sous le seuil
// alors que la fonction n'avait pas bouge d'une virgule. On exige desormais que
// le corps contienne ce qu'il DOIT contenir : une lecture de reservations.
ok(metricsBody !== null && /from\s+reservations/i.test(metricsBody),
  `buildDailyMetricsForDate localisee avec un corps qui lit bien reservations (${metricsBody ? metricsBody.length : 0} octets)`);
if (metricsBody) {
  const metricsUses = (metricsBody.match(/simulationSqlExclusion\(/g) || []).length;
  ok(metricsUses >= 2, `buildDailyMetricsForDate filtre SES DEUX requetes (jour + premiere visite), obtenu ${metricsUses}`);
}

// Tout fichier de lib/ qui APPELLE le predicat doit l'importer. Sans ca, le
// fragment SQL leve un ReferenceError au moment de la requete, donc en prod
// seulement : `node --check` ne voit rien, l'import manquant est invisible.
// (Ce cas s'est produit lors de l'ecriture du correctif, sur center-metrics.js.)
const libDir = path.join(root, 'lib');
if (!fs.existsSync(libDir)) fail(`dossier lib/ introuvable dans ${root}`);
const libFiles = fs.readdirSync(libDir).filter((name) => name.endsWith('.js'));
if (libFiles.length < 10) fail(`echantillon lib/ trop petit (${libFiles.length} fichiers)`);
const callers = [];
for (const name of libFiles) {
  if (name === 'simulation-filter.js') continue;
  const content = fs.readFileSync(path.join(libDir, name), 'utf8');
  if (!/(simulationSqlExclusion|excludeSimulationRows|isSimulationReservation)\s*\(/.test(content)) continue;
  callers.push({ name, imports: /require\(['"]\.\/simulation-filter['"]\)/.test(content) });
}
ok(callers.length >= 7, `au moins 7 modules de lib/ appellent le predicat (obtenu ${callers.length})`);
const orphans = callers.filter((caller) => !caller.imports).map((caller) => caller.name);
ok(orphans.length === 0, `chaque appelant importe lib/simulation-filter${orphans.length ? ` (manquant: ${orphans.join(', ')})` : ''}`);

// EXHAUSTIVITE PAR DECOUVERTE ET PAR COMPTAGE.
// Deux faux verts ont ete DEMONTRES sur la version precedente de ce bloc (un
// relecteur adverse l'a fait passer vert sur du code casse). Ils sont fermes
// ici, et la maniere dont ils sont fermes compte :
//   1. Borner chaque lecture a son litteral gabarit faisait PARTAGER la meme
//      preuve a deux lectures voisines : une seule exclusion validait les deux,
//      et le gate imprimait "les 2 lecture(s) portent toutes le predicat" alors
//      qu'une seule le portait. Un gate qui affirme le contraire de la realite
//      est pire qu'un gate absent. On COMPTE desormais (autant d'exclusions que
//      de lectures), on ne cherche plus une simple presence.
//   2. Une liste de fichiers ecrite en dur ne DECOUVRE rien : un nouveau module
//      analytique calculant du CA sans filtre passait vert. Or c'est exactement
//      l'actif que ce correctif protege (le CA fantome depassait le CA reel).
//      On parcourt donc l'arborescence de production.
//
// ALLOWLIST : seuls ces fichiers peuvent lire reservations sans predicat,
// chacun pour une raison ECRITE. Toute autre lecture non filtree decouverte
// dans lib/, api/ ou workers/ fait echouer le gate.
const UNFILTERED_ALLOWLIST = new Map([
  ['lib/database.js', 'lectures de CAPACITE (readStaffState, readAvailabilitySnapshot, listReservationsForDate), acces par id, et le delete glouton de resetSimulation ; couvert nommement par le SENS 2'],
  ['lib/simulation-filter.js', 'porte le predicat lui-meme'],
]);

function walkJsFiles(relativeDir) {
  const absolute = path.join(root, relativeDir);
  if (!fs.existsSync(absolute)) return [];
  const found = [];
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const relative = `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) found.push(...walkJsFiles(relative));
    else if (entry.name.endsWith('.js')) found.push(relative);
  }
  return found;
}

const discovered = [...walkJsFiles('lib'), ...walkJsFiles('api'), ...walkJsFiles('workers')];
ok(discovered.length >= 20, `balayage par decouverte : arborescence de production parcourue (${discovered.length} fichiers)`);

let scannedReads = 0;
let scannedFiles = 0;
const offenders = [];
for (const relative of discovered) {
  const content = fs.readFileSync(path.join(root, relative), 'utf8');
  const reads = (content.match(/(?:from|join)\s+reservations\b/gi) || []).length;
  if (!reads) continue;
  scannedFiles += 1;
  scannedReads += reads;
  if (UNFILTERED_ALLOWLIST.has(relative)) continue;
  const exclusions = (content.match(/simulationSqlExclusion\s*\(/g) || []).length;
  if (exclusions < reads) {
    offenders.push(`${relative} (${reads} lecture(s) pour ${exclusions} exclusion(s))`);
  }
}
ok(scannedFiles >= 5, `plusieurs modules lisant reservations ont ete inspectes (obtenu ${scannedFiles})`);
ok(scannedReads >= 9, `balayage sur un echantillon reel de lectures (obtenu ${scannedReads})`);
ok(offenders.length === 0,
  `chaque lecture analytique porte AUTANT d'exclusions que de lectures${offenders.length ? ` (manquantes: ${offenders.join(' | ')})` : ''}`);

// La console de simulation doit garder la vue sur ses propres lignes.
const simContent = loadSource('lib/ops-simulation.js');
ok(/readAdminRangeState\([^)]*includeSimulation:\s*true/s.test(simContent),
  'lib/ops-simulation.js passe includeSimulation: true (sinon la console affiche un ecran vide)');

// ── [SQL] preuve comportementale sur le SQL REELLEMENT EMIS ────────────────
// On capture le texte des requetes emises par readAdminRangeState avec un faux
// pool pg. On asserte sur le SQL LUI-MEME, pas sur les lignes rendues : c'est
// le seul angle honnete ici, puisque makeFakePg
// (scripts/run-backend-data-tests.js) matche par regex puis applique son propre
// filtre JS en ignorant tout predicat SQL ajoute. Un test qui regarderait les
// lignes rendues serait vert avec ou sans le correctif.
const Module = require('module');
const originalLoad = Module._load;
const capturedQueries = [];

function fakePg() {
  class FakePool {
    async query(sql, params = []) {
      capturedQueries.push(String(sql));
      return { rows: [], rowCount: 0 };
    }

    async connect() {
      return {
        async query(sql, params = []) {
          capturedQueries.push(String(sql));
          return { rows: [], rowCount: 0 };
        },
        release() {},
      };
    }
  }
  return { Pool: FakePool };
}

const databasePath = path.join(root, 'lib/database.js');

async function runSqlChecks() {
  console.log('\n[SQL] readAdminRangeState : le SQL emis porte (ou non) le predicat');
  const previousUrl = process.env.DATABASE_URL;
  const previousSsl = process.env.DATABASE_SSL;
  let defaultSql = [];
  let optInSql = [];
  try {
    const fake = fakePg();
    Module._load = function load(request, parent, isMain) {
      if (request === 'pg') return fake;
      return originalLoad.call(this, request, parent, isMain);
    };
    delete require.cache[require.resolve(databasePath)];
    process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/test';
    process.env.DATABASE_SSL = 'disable';
    const database = require(databasePath);

    const grabReservationSql = async (options) => {
      capturedQueries.length = 0;
      await database.readAdminRangeState('2026-07-01', '2026-07-19', 'libramont', options);
      return capturedQueries.filter((sql) => /from\s+reservations/i.test(sql));
    };

    // Appel par defaut (toutes les pages direction / analytics / audiences).
    defaultSql = await grabReservationSql(undefined);
    // Appel opt-in de la console de simulation.
    optInSql = await grabReservationSql({ includeSimulation: true });
  } finally {
    Module._load = originalLoad;
    try { delete require.cache[require.resolve(databasePath)]; } catch (error) { /* deja purge */ }
    if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl;
    if (previousSsl === undefined) delete process.env.DATABASE_SSL; else process.env.DATABASE_SSL = previousSsl;
  }

  ok(defaultSql.length === 1, `appel par defaut : 1 requete reservations capturee (obtenu ${defaultSql.length})`);
  ok(optInSql.length === 1, `appel opt-in : 1 requete reservations capturee (obtenu ${optInSql.length})`);
  const defaultText = defaultSql[0] || '';
  const optInText = optInSql[0] || '';
  ok(/sim-client/.test(defaultText) && /sim-staff/.test(defaultText),
    'par defaut le SQL EXCLUT les channels de simulation (CA, analytics, audiences)');
  ok(optInText !== '' && !/sim-client/.test(optInText) && !/sim-staff/.test(optInText),
    'avec includeSimulation: true le SQL ne filtre RIEN (la console de simulation voit ses lignes, pas d ecran vide)');
  ok(defaultText !== optInText, 'les deux SQL different reellement (l option change la requete, pas un flag mort)');
}

// ── [SENS 2] exclusion ABSENTE des lecteurs de capacite ─────────────────────
function runCapacityChecks() {
  console.log('\n[SENS 2] exclusion absente des lecteurs de capacite (chemin de reservation reel)');
  const FORBIDDEN_IN_CAPACITY = /simulationSqlExclusion|excludeSimulationRows|isSimulationReservation|sim-client|sim-staff|includeSimulation/;
  for (const reader of CAPACITY_READERS) {
    const body = functionBody(loadSource(reader.file), reader.fn);
    // Meme garde, et meme raison de preferer une ANCRE a une TAILLE : un corps
    // mal extrait (donc vide) ferait passer l'assertion d'absence ci-dessous
    // pour une mauvaise raison, mais un seuil en octets casse sur un simple
    // changement de fins de ligne. Un lecteur de capacite lit forcement la
    // table reservations : c'est ca, la preuve que l'extraction a marche.
    if (!ok(body !== null && /from\s+reservations/i.test(body),
      `${reader.fn} localisee dans ${reader.file} avec un corps qui lit bien reservations (${body ? body.length : 0} octets)`)) continue;
    ok(!FORBIDDEN_IN_CAPACITY.test(body),
      `${reader.fn} ne filtre PAS la simulation : ${reader.why}`);
  }

  // Verrou de coherence : le planificateur doit toujours prendre readStaffState
  // par defaut. Si cette ligne bouge, le sens 2 ci-dessus ne protege plus rien.
  const opsContent = loadSource('lib/reservation-ops.js');
  ok(/readState\s*=\s*options\.readState\s*\|\|\s*readStaffState/.test(opsContent),
    'lib/reservation-ops.js : le planificateur lit toujours readStaffState par defaut');
}

runSqlChecks()
  .then(() => {
    runCapacityChecks();
    console.log('');
    if (failures) {
      fail(`${failures} assertion(s) en echec sur ${ANALYTIC_POINTS.length} points analytiques et ${CAPACITY_READERS.length} lecteurs de capacite.`);
    }
    console.log(`simulation-isolation-check: ALL OK (${ANALYTIC_POINTS.length} points analytiques filtres, ${CAPACITY_READERS.length} lecteurs de capacite intacts, ${inspectedBytes} octets inspectes)`);
  })
  .catch((error) => fail(`exception pendant les verifications: ${error && (error.stack || error.message || error)}`));

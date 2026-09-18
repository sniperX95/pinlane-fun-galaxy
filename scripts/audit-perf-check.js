// Gate de PERFORMANCE du journal d'audit (regle T5).
//
// LA QUESTION, PRECISEMENT : l'ecriture du journal allonge-t-elle la fenetre
// pendant laquelle createReservation tient son pg_advisory_xact_lock ?
//
// Pourquoi c'est LA question et pas la latence totale : lockDate
// (lib/database.js) pose un verrou XACT par couple (centre, date), tenu jusqu'au
// COMMIT. Tant qu'il est tenu, toutes les autres creations de reservation sur
// la MEME date sont serialisees. Un aller-retour reseau ajoute a l'interieur de
// cette fenetre ne coute pas 8 ms a une reservation : il coute 8 ms a CHAQUE
// reservation de la file, un samedi de rush. Une latence ajoutee APRES le
// COMMIT, elle, ne coute qu'a la requete qui la paie.
//
// COMMENT C'EST MESURE : faux pool pg avec latence simulee par aller-retour
// (defaut 8 ms, ordre de grandeur Neon depuis une fonction Vercel). Le faux
// pool horodate l'acquisition du verrou et le COMMIT : la fenetre mesuree est
// donc la vraie fenetre du vrai code, pas une estimation.
//
// LIMITE ASSUMEE, ET ELLE EST REELLE : il n'y a pas de base de staging dans ce
// projet (la preview Vercel ecrit dans la vraie base), donc cette mesure ne
// tourne PAS contre Postgres. Ce qu'elle mesure exactement : la STRUCTURE du
// chemin de code, c'est-a-dire combien d'allers-retours tombent a l'interieur
// du verrou. C'est ce qui determine le comportement en charge. Ce qu'elle ne
// mesure pas : le cout CPU reel de l'INSERT cote Postgres, negligeable devant
// un aller-retour reseau mais non nul.
//
// CONTRE-EPREUVE INTEGREE : le scenario C ecrit deliberement le journal DANS la
// transaction. Si la mesure ne voyait pas cette regression, elle ne prouverait
// rien. Le gate echoue si le scenario C ne montre PAS d'allongement.
//
// Lancement : node scripts/audit-perf-check.js [--iterations=200] [--latency=8]

const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;
function ok(cond, label) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`);
  if (!cond) failures += 1;
  return cond;
}

function argNumber(name, fallback) {
  const arg = process.argv.find((item) => item.startsWith(`--${name}=`));
  const value = arg ? Number(arg.split('=')[1]) : NaN;
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const ITERATIONS = argNumber('iterations', 200);
const LATENCY_MS = argNumber('latency', 8);

// Attente PRECISE. setTimeout n'est pas utilisable ici : sous Windows sa
// granularite reelle est de l'ordre de 15 ms, ce qui gonflerait une latence
// demandee de 8 ms a ~15 ms et rendrait les chiffres absolus faux (les ecarts
// resteraient valides, mais on ne pourrait plus lire la mesure telle quelle).
// L'attente active coute du CPU sur la duree du gate et donne une simulation
// fidele au dixieme de milliseconde.
function sleep(ms) {
  const until = performance.now() + ms;
  while (performance.now() < until) { /* attente active volontaire */ }
  return Promise.resolve();
}

// ---------------------------------------------------------------------------
// Faux pool avec latence simulee, qui horodate la fenetre de verrou.
// ---------------------------------------------------------------------------
const marks = { lockAt: 0, commitAt: 0, auditAt: 0, queriesUnderLock: 0 };
let auditInsideLock = false;

class FakeClient {
  constructor() { this.inTx = false; }

  async query(text, params = []) {
    const sql = String(text);

    // Chaque requete paie un aller-retour reseau : c'est ce qui rend la mesure
    // representative d'une base distante plutot que d'un appel local gratuit.
    await sleep(LATENCY_MS);

    if (/pg_advisory_xact_lock/i.test(sql)) {
      marks.lockAt = performance.now();
      marks.queriesUnderLock = 0;
      return { rows: [{}], rowCount: 1 };
    }
    if (/^COMMIT/i.test(sql.trim())) {
      marks.commitAt = performance.now();
      return { rows: [], rowCount: 0 };
    }
    if (/^BEGIN/i.test(sql.trim()) || /^ROLLBACK/i.test(sql.trim())) {
      return { rows: [], rowCount: 0 };
    }

    if (marks.lockAt && !marks.commitAt) marks.queriesUnderLock += 1;

    if (/insert into audit_log/i.test(sql)) {
      marks.auditAt = performance.now();
      // Le journal ecrit-il pendant que le verrou est tenu ?
      // ACCUMULATION, PAS AFFECTATION. Une premiere version ecrasait le drapeau
      // a chaque INSERT : l'ecriture legitime d'APRES le commit remettait le
      // drapeau a faux et effacait la detection d'une ecriture SOUS VERROU,
      // c'est-a-dire exactement la regression que cette sonde existe pour
      // interdire. Prouve par mutation : un INSERT injecte dans la transaction
      // de createReservation laissait la sonde au vert. Une fois vrai, le
      // drapeau ne doit plus jamais redevenir faux.
      auditInsideLock = auditInsideLock || (Boolean(marks.lockAt) && !marks.commitAt);
      return { rows: [{ id: 1, occurred_at: new Date().toISOString() }], rowCount: 1 };
    }

    if (/insert into reservations/i.test(sql)) {
      return { rows: [reservationRow()], rowCount: 1 };
    }
    if (/from lane_statuses/i.test(sql)) return { rows: [], rowCount: 0 };
    if (/from reservations/i.test(sql)) return { rows: [], rowCount: 0 };
    return { rows: [], rowCount: 0 };
  }

  release() {}
}

function reservationRow() {
  return {
    id: 1,
    center_id: 'libramont',
    channel: 'staff',
    name: 'Client Test',
    phone: '',
    email: 'test@exemple.be',
    date: '2026-09-12',
    start_time: '14:00',
    duration: 60,
    total_duration: 60,
    pax: 4,
    type: 'bowling',
    formule_id: '',
    lanes: [1],
    lane_count: 1,
    price: 60,
    base_price: 60,
    status: 'confirmed',
    validation_status: 'auto',
    notes: '',
    extras: {},
    payment_method: '',
    occasion: '',
    activity_progress: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

class FakePool {
  constructor(options = {}) { this.options = options; }
  async connect() { return new FakeClient(); }
  async query(text, params) { return new FakeClient().query(text, params); }
}

const pgPath = require.resolve('pg');
require.cache[pgPath] = { id: pgPath, filename: pgPath, loaded: true, exports: { Pool: FakePool } };
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake/fake';

const { createReservation } = require(path.join(ROOT, 'lib', 'database.js'));
const audit = require(path.join(ROOT, 'lib', 'audit-log.js'));

function percentile(values, p) {
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function baseInput() {
  return {
    centerId: 'libramont',
    channel: 'staff',
    name: 'Client Test',
    email: 'test@exemple.be',
    phone: '+32470000000',
    date: '2026-09-12',
    startTime: '14:00',
    duration: 60,
    pax: 4,
    type: 'bowling',
    lanes: [1],
    price: 60,
  };
}

// Un scenario = N creations. On mesure DEUX choses distinctes :
//   lockWindow : lockAt -> commitAt (le cout inflige aux AUTRES)
//   total      : debut -> fin de l'appel complet (le cout paye par soi-meme)
async function runScenario(label, { withAudit, auditInsideTransaction }) {
  let auditInsideLockThisScenario = false;
  const lockWindows = [];
  const totals = [];

  for (let i = 0; i < ITERATIONS; i += 1) {
    marks.lockAt = 0;
    marks.commitAt = 0;
    marks.auditAt = 0;
    auditInsideLock = false;

    const started = performance.now();
    try {
      if (auditInsideTransaction) {
        // Scenario de CONTRE-EPREUVE : on force une ecriture supplementaire
        // pendant que le verrou est tenu, en la glissant dans le meme cycle.
        // C'est ce que ferait un developpeur qui journaliserait "au plus pres"
        // de la mutation, dans withTransaction.
        await createReservationAvecAuditInterne();
      } else {
        await createReservation(baseInput());
        if (withAudit) {
          await audit.writeAuditLog({
            centerId: 'libramont',
            actorKind: 'staff',
            actorMemberId: 'm-42',
            actorLabel: 'Staff Test',
            surface: 'api/staff-reservations.js',
            action: 'createReservation',
            method: 'POST',
            entityType: 'reservation',
            entityId: '1',
            outcome: 'success',
            changes: { price: { before: null, after: 60 }, pax: { before: null, after: 4 } },
          });
        }
      }
    } catch (error) {
      console.error(`${label}: echec iteration ${i}`, error.message);
      throw error;
    }
    const ended = performance.now();

    if (auditInsideLock) auditInsideLockThisScenario = true;
    if (marks.lockAt && marks.commitAt) lockWindows.push(marks.commitAt - marks.lockAt);
    totals.push(ended - started);
  }

  return {
    label,
    auditInsideLockObserved: auditInsideLockThisScenario,
    lockP50: percentile(lockWindows, 50),
    lockP95: percentile(lockWindows, 95),
    totalP50: percentile(totals, 50),
    totalP95: percentile(totals, 95),
    samples: lockWindows.length,
  };
}

// Reproduit une journalisation faite DANS la transaction, sans modifier le code
// de production : on enveloppe le pool le temps de l'appel pour qu'une ecriture
// d'audit parte pendant que le verrou est tenu.
async function createReservationAvecAuditInterne() {
  const db = require(path.join(ROOT, 'lib', 'database.js'));
  const pool = db.getPool();
  const originalConnect = pool.connect.bind(pool);
  pool.connect = async () => {
    const client = await originalConnect();
    const originalQuery = client.query.bind(client);
    client.query = async (text, params) => {
      const result = await originalQuery(text, params);
      // Juste apres l'INSERT de la reservation, encore sous verrou.
      if (/insert into reservations/i.test(String(text))) {
        await originalQuery('insert into audit_log (center_id) values ($1)', ['libramont']);
      }
      return result;
    };
    return client;
  };
  try {
    return await createReservation(baseInput());
  } finally {
    pool.connect = originalConnect;
  }
}

function report(r) {
  console.log(
    `      ${r.label.padEnd(34)} verrou p50 ${r.lockP50.toFixed(1)} ms | verrou p95 ${r.lockP95.toFixed(1)} ms `
    + `| total p50 ${r.totalP50.toFixed(1)} ms | total p95 ${r.totalP95.toFixed(1)} ms`,
  );
}

(async () => {
  console.log(`[PERF] chemin de reservation, ${ITERATIONS} iterations, latence simulee ${LATENCY_MS} ms par aller-retour\n`);

  // MESURE APPARIEE, ET C'EST LA TOUT LE POINT (durci 2026-08-20).
  // Le signal cherche vaut un aller-retour (~8 ms) ; la machine, elle, execute
  // en meme temps le reste de la chaine de gates, navigateurs compris.
  // `setTimeout` derive alors de plusieurs millisecondes et le p95 d'UNE passe
  // devient bruite : la contre-epreuve a rendu -3,52 ms sous charge, puis
  // +7,87 / +7,86 / +8,01 ms trois fois de suite a vide. Un gate qui rougit
  // selon la charge de la machine ne prouve plus rien, et il finit par etre
  // ignore ou affaibli.
  //
  // On alterne donc les trois scenarios (A, B, C, A, B, C, ...) et on compare
  // les MEDIANES. La derive de l'ordonnanceur frappe les trois de la meme
  // façon a quelques millisecondes d'intervalle, donc elle s'annule dans la
  // difference. Le seuil, lui, ne bouge pas d'un pouce : la contre-epreuve
  // doit toujours voir un aller-retour entier.
  const PASSES = Number(process.env.PERF_PASSES || 3);
  const mediane = (xs) => {
    const t = xs.slice().sort((a, b) => a - b);
    const m = Math.floor(t.length / 2);
    return t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2;
  };
  // LA MESURE SE REFAIT TANT QUE SON TEMOIN NE RESSORT PAS. Une salve peut
  // tomber au milieu d une rafale de l ordonnanceur : dans ce cas le temoin C
  // ne se distingue pas de A, et AUCUNE conclusion sur le code n est possible.
  // On recommence alors, au lieu de rendre un verdict tire au sort.
  const TENTATIVES = Number(process.env.PERF_TENTATIVES || 3);
  let passes = { A: [], B: [], C: [] };
  let sansJournal = null; let avecJournal = null; let dansTransaction = null;
  let temoin = 0;
  for (let tentative = 1; tentative <= TENTATIVES; tentative += 1) {
  passes = { A: [], B: [], C: [] };
  for (let passe = 0; passe < PASSES; passe += 1) {
    const a = await runScenario('A. sans journal (reference)', { withAudit: false });
    const b = await runScenario('B. avec journal (livre)', { withAudit: true });
    const c = await runScenario('C. journal DANS la transaction', { withAudit: false, auditInsideTransaction: true });
    passes.A.push(a); passes.B.push(b); passes.C.push(c);
    if (passe === 0) { sansJournal = a; avecJournal = b; dansTransaction = c; }
    // Une seule ecriture de journal sous verrou, sur N passes, suffit a
    // condamner : cette observation-la n'est pas une moyenne.
    if (b.auditInsideLockObserved) avecJournal.auditInsideLockObserved = true;
  }
  sansJournal.lockP95 = mediane(passes.A.map((x) => x.lockP95));
  avecJournal.lockP95 = mediane(passes.B.map((x) => x.lockP95));
  dansTransaction.lockP95 = mediane(passes.C.map((x) => x.lockP95));
  sansJournal.totalP95 = mediane(passes.A.map((x) => x.totalP95));
  avecJournal.totalP95 = mediane(passes.B.map((x) => x.totalP95));
    temoin = dansTransaction.lockP95 - sansJournal.lockP95;
    if (temoin >= LATENCY_MS / 2) break;
    if (tentative < TENTATIVES) {
      console.log(`      (temoin a ${temoin.toFixed(2)} ms, mesure non concluante : nouvelle salve ${tentative + 1}/${TENTATIVES})`);
    }
  }
  console.log(`      (${PASSES} passes alternees, medianes retenues)
`);
  report(sansJournal);
  report(avecJournal);
  report(dansTransaction);

  console.log('');

  // ---- L'assertion qui compte -------------------------------------------
  // La fenetre de verrou ne doit pas bouger entre A et B. On tolere le bruit
  // de l'ordonnanceur (setTimeout n'est pas au nanoseconde pres), pas un
  // aller-retour : le seuil est place a la moitie d'un aller-retour, donc trop
  // bas pour laisser passer une requete supplementaire sous verrou.
  const deltaVerrou = avecJournal.lockP95 - sansJournal.lockP95;
  const deltaRegression = dansTransaction.lockP95 - sansJournal.lockP95;

  // A. LA MESURE EST-ELLE CONCLUANTE, sur CETTE machine, a CET instant ? Le
  // temoin C est une regression qu on provoque expres : s il ne ressort pas,
  // rien ne peut etre conclu du code, et un vert serait de la complaisance.
  ok(deltaRegression >= LATENCY_MS / 2,
    `la mesure est concluante : la regression temoin ressort a ${deltaRegression.toFixed(2)} ms `
    + `(il en faut au moins ${LATENCY_MS / 2} ms, sinon la machine couvre le signal)`);

  // B. LE VERROU NE BOUGE PAS. Le plafond n est plus un chiffre absolu, qui
  // mesurait la machine : c est une fraction de la regression temoin relevee
  // dans la MEME salve. Une vraie regression rapproche B de C, donc elle
  // depasse largement la moitie ; le bruit, lui, reste en dessous.
  const plafond = Math.min(LATENCY_MS, Math.max(LATENCY_MS / 2, deltaRegression / 2));
  ok(deltaVerrou < plafond,
    `la fenetre sous verrou n'est PAS allongee par le journal (delta p95 ${deltaVerrou.toFixed(2)} ms, `
    + `plafond ${plafond.toFixed(2)} ms calibre sur la regression temoin de ${deltaRegression.toFixed(2)} ms)`);

  ok(!avecJournal.auditInsideLockObserved,
    'aucune ecriture de journal n a eu lieu pendant que le verrou etait tenu (scenario livre)');

  // ---- La contre-epreuve : la mesure sait-elle voir une regression ? -----
  // La contre-epreuve d autrefois disait exactement ce que l assertion A
  // verifie desormais : la mesure sait voir une regression. Elle n est plus
  // repetee ici pour ne pas compter deux fois le meme controle.

  // ---- Le cout paye par la requete elle-meme ------------------------------
  const deltaTotal = avecJournal.totalP95 - sansJournal.totalP95;
  console.log(`\n      Cout paye par la requete qui journalise : +${deltaTotal.toFixed(1)} ms p95 `
    + `(un aller-retour, hors verrou, hors transaction).`);
  console.log('      Cout inflige aux autres reservations de la meme date : 0.');

  if (failures) {
    console.error(`\naudit-perf-check: ${failures} FAIL`);
    process.exit(1);
  }
  console.log('\naudit-perf-check: ALL OK');
})().catch((error) => {
  console.error('audit-perf-check: exception', error);
  process.exit(1);
});

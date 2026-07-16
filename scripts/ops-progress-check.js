// Progression live (0028) : tests du composant partage assets/ops-progress.js.
// Purs : le module est charge dans un sandbox vm (comme les autres modules
// navigateur), le poller recoit une horloge et un reseau injectes.
//
// Regle anti-faux-vert : chaque assertion de presence porte sur un echantillon
// PROUVE non vide (on verifie d'abord que la fixture a des etapes, puis que le
// rendu les contient). Aucune assertion "0 occurrence" seule.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');

function loadModule() {
  const sandbox = { console, setTimeout, clearTimeout };
  sandbox.window = {};
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(root, 'assets/ops-progress.js'), 'utf8'),
    sandbox,
    { filename: 'assets/ops-progress.js' },
  );
  const mod = sandbox.window.PinlaneOpsProgress;
  assert(mod, 'PinlaneOpsProgress manquant apres chargement');
  return mod;
}

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log('  ok ', name); }

const mod = loadModule();

// ── Rendu pur ────────────────────────────────────────────────────────────────

const runningJob = {
  id: 42,
  status: 'processing',
  steps: [
    { label: 'Je pose le calendrier des 8 prochaines semaines', at: '2026-07-17T08:00:01.000Z' },
    { label: 'Je fais rediger le plan par le modele', at: '2026-07-17T08:00:03.000Z' },
  ],
};

check('un job en cours rend TOUTES ses etapes reelles, la derniere en live', () => {
  assert.ok(runningJob.steps.length >= 2, 'fixture non vide (garde anti-echantillon-vide)');
  const html = mod.renderOpsJobProgress(runningJob);
  for (const step of runningJob.steps) {
    assert.ok(html.includes(step.label), `etape absente du rendu: ${step.label}`);
  }
  const liveCount = (html.match(/is-live/g) || []).length;
  assert.strictEqual(liveCount, 1, 'exactement une etape live');
  assert.ok(html.lastIndexOf('is-live') > html.indexOf('is-done'), 'la live est la derniere');
  assert.ok(html.includes('aria-live="polite"'), 'annonce accessible');
});

check('un job done rend Termine et aucune etape live', () => {
  const done = { ...runningJob, status: 'done' };
  const html = mod.renderOpsJobProgress(done);
  assert.ok(html.includes('Termine.'), 'mention Termine');
  assert.ok(html.includes(done.steps[1].label), 'les etapes restent visibles');
  assert.ok(!html.includes('is-live'), 'plus de point live une fois fini');
});

check('un job failed dit l\'echec, montre la cause et propose Reessayer', () => {
  const failed = { ...runningJob, status: 'failed', lastError: 'timeout du modele' };
  const html = mod.renderOpsJobProgress(failed);
  assert.ok(html.includes('La construction a echoue'), 'echec annonce');
  assert.ok(html.includes('timeout du modele'), 'cause reelle affichee');
  assert.ok(html.includes('job-progress-retry'), 'bouton reessayer present');
});

check('zero etape = etat honnete dit avec des mots, JAMAIS une etape inventee', () => {
  const queued = { id: 43, status: 'queued', steps: [] };
  const htmlQueued = mod.renderOpsJobProgress(queued);
  assert.ok(htmlQueued.includes('En file d\'attente sur le serveur.'), 'file d\'attente dite');
  assert.ok(!htmlQueued.includes('job-progress-step'), 'aucune ligne d\'etape fabriquee');
  const processing = { id: 43, status: 'processing', steps: [] };
  const htmlProcessing = mod.renderOpsJobProgress(processing);
  assert.ok(htmlProcessing.includes('premiere etape en cours'), 'prise en charge dite');
});

check('les labels d\'etape sont echappes (pas d\'injection HTML)', () => {
  const hostile = {
    id: 44,
    status: 'processing',
    steps: [{ label: '<img src=x onerror=alert(1)>', at: '2026-07-17T08:00:01.000Z' }],
  };
  const html = mod.renderOpsJobProgress(hostile);
  assert.ok(!html.includes('<img'), 'HTML hostile neutralise');
  assert.ok(html.includes('&lt;img'), 'HTML hostile echappe, pas supprime');
});

check('un job null rend une erreur avec retry, pas un squelette a vie', () => {
  const html = mod.renderOpsJobProgress(null);
  assert.ok(html.includes('Impossible de lire l\'avancement'), 'erreur dite');
  assert.ok(html.includes('job-progress-retry'), 'retry propose');
});

// ── Poller (horloge et reseau injectes) ─────────────────────────────────────

function makeClock() {
  const queue = [];
  let seq = 0;
  return {
    schedule(fn, ms) { const id = ++seq; queue.push({ id, fn, ms }); return id; },
    cancel(id) { const i = queue.findIndex((t) => t.id === id); if (i >= 0) queue.splice(i, 1); },
    async runNext() {
      const task = queue.shift();
      if (!task) return null;
      await task.fn();
      return task.ms;
    },
    get pending() { return queue.length; },
  };
}

async function settle() { await new Promise((resolve) => setImmediate(resolve)); }

(async () => {
  {
    const clock = makeClock();
    const responses = [
      { job: { id: 42, status: 'processing', steps: [{ label: 'etape 1', at: '2026-07-17T08:00:01Z' }] } },
      { job: { id: 42, status: 'done', steps: [{ label: 'etape 1', at: '2026-07-17T08:00:01Z' }, { label: 'etape 2', at: '2026-07-17T08:00:02Z' }] } },
    ];
    let calls = 0;
    const updates = [];
    let doneJob = null;
    const watcher = mod.createOpsJobWatcher({
      jobId: 42,
      centerId: 'libramont',
      requestImpl: async () => { calls += 1; return responses.shift(); },
      setTimeoutImpl: clock.schedule,
      clearTimeoutImpl: clock.cancel,
      doc: { hidden: false, addEventListener() {}, removeEventListener() {} },
      onUpdate: (job) => updates.push(job),
      onDone: (job) => { doneJob = job; },
    });
    watcher.start();
    await settle();
    assert.strictEqual(calls, 1, 'premiere lecture immediate');
    assert.strictEqual(clock.pending, 1, 'tick suivant programme');
    await clock.runNext();
    await settle();
    assert.strictEqual(calls, 2, 'seconde lecture');
    assert.ok(doneJob && doneJob.status === 'done', 'onDone appele avec le job final');
    assert.strictEqual(clock.pending, 0, 'plus AUCUN tick programme apres done');
    assert.ok(updates.length >= 2, 'chaque lecture a mis a jour le rendu');
    passed += 1; console.log('  ok  le poller suit les etapes puis s\'arrete de lui-meme sur done (async)');
  }

  {
    // Backoff : erreurs reseau -> delai x1.8 plafonne, puis retour a la base.
    const clock = makeClock();
    let fail = 3;
    const watcher = mod.createOpsJobWatcher({
      jobId: 7,
      centerId: 'libramont',
      requestImpl: async () => {
        if (fail > 0) { fail -= 1; throw new Error('reseau'); }
        return { job: { id: 7, status: 'processing', steps: [] } };
      },
      setTimeoutImpl: clock.schedule,
      clearTimeoutImpl: clock.cancel,
      doc: { hidden: false, addEventListener() {}, removeEventListener() {} },
    });
    watcher.start();
    await settle();
    assert.strictEqual(watcher.delay, 2700, 'apres 1 erreur : 1500 x 1.8 = 2700');
    await clock.runNext(); await settle();
    assert.strictEqual(watcher.delay, 4860, 'apres 2 erreurs : 4860');
    await clock.runNext(); await settle();
    assert.strictEqual(watcher.delay, 8748, 'apres 3 erreurs : 8748');
    await clock.runNext(); await settle();
    assert.strictEqual(watcher.delay, 1500, 'une lecture qui passe remet le delai de base');
    assert.strictEqual(watcher.errors, 0, 'compteur d\'erreurs remis a zero');
    watcher.stop();
    passed += 1; console.log('  ok  backoff reseau x1.8 plafonne puis retour a la base (async)');
  }

  {
    // Onglet cache : aucune requete, on reprogramme seulement.
    const clock = makeClock();
    let calls = 0;
    const doc = { hidden: true, addEventListener() {}, removeEventListener() {} };
    const watcher = mod.createOpsJobWatcher({
      jobId: 9,
      centerId: 'libramont',
      requestImpl: async () => { calls += 1; return { job: { id: 9, status: 'processing', steps: [] } }; },
      setTimeoutImpl: clock.schedule,
      clearTimeoutImpl: clock.cancel,
      doc,
    });
    watcher.start();
    await settle();
    assert.strictEqual(calls, 0, 'onglet cache : zero requete');
    assert.strictEqual(clock.pending, 1, 'mais le suivi reste programme');
    doc.hidden = false;
    await clock.runNext(); await settle();
    assert.strictEqual(calls, 1, 'onglet visible : la lecture repart');
    watcher.stop();
    assert.strictEqual(clock.pending, 0, 'stop() purge le timer');
    passed += 1; console.log('  ok  onglet cache = zero requete, reprise au retour, stop() purge (async)');
  }

  {
    // jobId invalide -> onFail immediat, aucun poll.
    let failed = false;
    let calls = 0;
    const watcher = mod.createOpsJobWatcher({
      jobId: 'nope',
      requestImpl: async () => { calls += 1; return {}; },
      setTimeoutImpl: () => { throw new Error('ne doit pas programmer'); },
      clearTimeoutImpl: () => {},
      doc: null,
      onFail: () => { failed = true; },
    });
    watcher.start();
    assert.strictEqual(failed, true, 'onFail appele');
    assert.strictEqual(calls, 0, 'aucune requete');
    passed += 1; console.log('  ok  jobId invalide -> echec immediat sans poll (async)');
  }

  console.log(`\nops-progress-check: ${passed} tests OK`);
})().catch((error) => {
  console.error('FAIL ', error.message);
  process.exit(1);
});

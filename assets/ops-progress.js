// Progression live d'un job ops (RUN B, 0028). Composant PARTAGE : RUN C le
// branche sur les onglets qui declenchent un travail reel (plan, studio...).
//
// Doctrine (la regle n°1 du repo) : AUCUNE etape inventee. Ce composant ne
// montre que ce que le serveur a ecrit dans ops_jobs.steps, c'est-a-dire ce
// que le handler du job a REELLEMENT fait, horodate. Tant que le serveur n'a
// rien franchi, on montre l'etat brut (en file, en cours) : jamais une barre
// qui avance toute seule, jamais un "chargement Monty".
//
// Deux pieces, separees pour etre testables sans navigateur :
// - renderOpsJobProgress(job) : PURE, job -> HTML (chaine).
// - createOpsJobWatcher(opts) : le poller (intervalle raisonnable, backoff sur
//   erreur reseau, pause quand l'onglet est cache, arret sur etat final).
(function attachOpsProgress(global) {
  'use strict';

  const POLL_MS = 1500;
  const POLL_MAX_MS = 10000;
  const BACKOFF_FACTOR = 1.8;
  const FINAL_STATUSES = ['done', 'failed', 'cancelled'];

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatStepTime(iso) {
    const date = new Date(iso || '');
    if (Number.isNaN(date.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  function isFinalStatus(status) {
    return FINAL_STATUSES.includes(String(status || ''));
  }

  // PURE : l'etat d'un job -> le HTML de la timeline. Chaque ligne est une
  // etape ECRITE par le serveur ; la derniere etape d'un job encore en cours
  // porte le point "live". Zero etape + queued/processing = etat honnete dit
  // avec des mots, pas une progression simulee.
  function renderOpsJobProgress(job) {
    if (!job || typeof job !== 'object') {
      return '<div class="job-progress" data-state="error"><p class="job-progress-error">Impossible de lire l\'avancement. <button type="button" class="job-progress-retry" data-action="job-progress-retry">Reessayer</button></p></div>';
    }
    const status = String(job.status || 'queued');
    const steps = Array.isArray(job.steps) ? job.steps : [];
    const running = !isFinalStatus(status);
    const lines = steps.map((step, index) => {
      const isLast = index === steps.length - 1;
      const live = running && isLast;
      const stateClass = live ? ' is-live' : ' is-done';
      return [
        `<li class="job-progress-step${stateClass}">`,
        '<span class="job-progress-dot" aria-hidden="true"></span>',
        `<span class="job-progress-label">${escapeHtml(step.label)}</span>`,
        step.at ? `<time class="job-progress-time" datetime="${escapeHtml(step.at)}">${escapeHtml(formatStepTime(step.at))}</time>` : '',
        '</li>',
      ].join('');
    });

    let footer = '';
    if (status === 'failed') {
      const reason = String(job.lastError || '').trim();
      footer = `<p class="job-progress-error">La construction a echoue${reason ? ` : ${escapeHtml(reason.slice(0, 160))}` : '.'} <button type="button" class="job-progress-retry" data-action="job-progress-retry">Reessayer</button></p>`;
    } else if (status === 'cancelled') {
      footer = '<p class="job-progress-note">Travail annule.</p>';
    } else if (status === 'done') {
      footer = '<p class="job-progress-done">Termine.</p>';
    } else if (!steps.length) {
      footer = status === 'processing'
        ? '<p class="job-progress-note">Le serveur a pris le travail, premiere etape en cours.</p>'
        : '<p class="job-progress-note">En file d\'attente sur le serveur.</p>';
    }

    return [
      `<div class="job-progress" data-state="${escapeHtml(status)}" role="status" aria-live="polite">`,
      lines.length ? `<ol class="job-progress-steps">${lines.join('')}</ol>` : '',
      footer,
      '</div>',
    ].filter(Boolean).join('');
  }

  // Le poller. Contrats :
  // - intervalle de base 1,5 s, backoff x1.8 (plafond 10 s) sur erreur reseau,
  //   retour a la base des qu'une lecture passe ;
  // - pause quand l'onglet est cache (visibilitychange), reprise immediate au
  //   retour ;
  // - arret definitif sur done/failed/cancelled ou stop() ;
  // - fail-soft : une erreur reseau s'AFFICHE (via onUpdate d'un pseudo-etat
  //   d'erreur seulement si aucune donnee encore) mais ne stoppe pas le suivi.
  function createOpsJobWatcher(options = {}) {
    const jobId = Number(options.jobId);
    const centerId = String(options.centerId || '');
    const request = options.requestImpl || ((url) => global.apiRequest(url));
    const doc = options.doc || (typeof document !== 'undefined' ? document : null);
    const schedule = options.setTimeoutImpl || ((fn, ms) => setTimeout(fn, ms));
    const cancel = options.clearTimeoutImpl || ((handle) => clearTimeout(handle));
    const onUpdate = typeof options.onUpdate === 'function' ? options.onUpdate : () => {};
    const onDone = typeof options.onDone === 'function' ? options.onDone : () => {};
    const onFail = typeof options.onFail === 'function' ? options.onFail : () => {};

    let delay = POLL_MS;
    let timer = null;
    let stopped = false;
    let lastJob = null;
    let consecutiveErrors = 0;

    function hidden() {
      return Boolean(doc && doc.hidden);
    }

    function finish(job) {
      stopped = true;
      if (timer) { cancel(timer); timer = null; }
      if (job && job.status === 'done') onDone(job);
      else onFail(job || lastJob || null);
    }

    async function tick() {
      timer = null;
      if (stopped) return;
      if (hidden()) {
        // Onglet cache : on ne consomme rien, on reverifiera au retour.
        timer = schedule(tick, delay);
        return;
      }
      try {
        const payload = await request(`/api/ops?action=job&id=${jobId}&centerId=${encodeURIComponent(centerId)}`);
        const job = payload && payload.job ? payload.job : null;
        if (!job) throw new Error('Job absent de la reponse.');
        lastJob = job;
        consecutiveErrors = 0;
        delay = POLL_MS;
        onUpdate(job);
        if (isFinalStatus(job.status)) { finish(job); return; }
      } catch (error) {
        consecutiveErrors += 1;
        delay = Math.min(POLL_MAX_MS, Math.round(delay * BACKOFF_FACTOR));
        // Une erreur reseau se dit : le rendu la montre au lieu de figer un
        // squelette a vie (lecon de l'audit, section 2).
        onUpdate(lastJob ? lastJob : null);
      }
      if (!stopped) timer = schedule(tick, delay);
    }

    function start() {
      if (!Number.isInteger(jobId) || jobId <= 0) {
        onFail(null);
        return api;
      }
      if (doc && typeof doc.addEventListener === 'function') {
        doc.addEventListener('visibilitychange', onVisibility);
      }
      tick();
      return api;
    }

    function onVisibility() {
      if (stopped || hidden()) return;
      // Retour sur l'onglet : lecture immediate plutot que d'attendre le timer.
      if (timer) { cancel(timer); timer = null; }
      tick();
    }

    function stop() {
      stopped = true;
      if (timer) { cancel(timer); timer = null; }
      if (doc && typeof doc.removeEventListener === 'function') {
        doc.removeEventListener('visibilitychange', onVisibility);
      }
    }

    const api = {
      start,
      stop,
      get delay() { return delay; },
      get errors() { return consecutiveErrors; },
      get lastJob() { return lastJob; },
    };
    return api;
  }

  // Cablage pratique : suit un job et maintient un element a jour. RUN C
  // fournit le point de montage et decide quoi faire a la fin.
  function watchJobProgress({ jobId, centerId, mount, onDone, onFail } = {}) {
    const watcher = createOpsJobWatcher({
      jobId,
      centerId,
      onUpdate: (job) => { if (mount) mount.innerHTML = renderOpsJobProgress(job); },
      onDone: (job) => {
        if (mount) mount.innerHTML = renderOpsJobProgress(job);
        if (typeof onDone === 'function') onDone(job);
      },
      onFail: (job) => {
        if (mount) mount.innerHTML = renderOpsJobProgress(job);
        if (typeof onFail === 'function') onFail(job);
      },
    });
    return watcher.start();
  }

  global.PinlaneOpsProgress = {
    renderOpsJobProgress,
    createOpsJobWatcher,
    watchJobProgress,
    POLL_MS,
    POLL_MAX_MS,
  };
})(typeof window !== 'undefined' ? window : this);

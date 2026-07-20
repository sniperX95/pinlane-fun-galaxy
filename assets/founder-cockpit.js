/* ============================================================================
   COCKPIT FONDATEUR (page 'cockpit', permission platform.admin)
   ----------------------------------------------------------------------------
   La console du PRODUIT pour son proprietaire : ce qui casse, l'adoption par
   centre, le travail reel des agents IA, le cout, le journal d'audit global,
   les prospects, et les commandes (sequences par centre, relance de jobs).

   Doctrine identique au reste de la console :
   - style Vercel NEUTRE : monochrome sauf le sens (vert = reussi, rouge =
     echec, ambre = attente, bleu = information), un seul bouton primaire,
     filets 1px, composants pv2 reutilises, AUCUNE couleur de marque client ;
   - chaque chiffre vient du bundle serveur (action founderCockpit), qui le
     tire d'une vraie requete. Ce fichier n'invente RIEN : quand une grandeur
     n'est pas mesurable, le bundle le dit (dailyMeasured: false) et l'ecran
     ecrit "pas encore mesure" au lieu d'un zero qui ressemble a une mesure ;
   - le SaaS n'est pas lance : bundle.testData = true, et le bandeau le dit ;
   - la page se reconstruit par innerHTML a chaque rendu : les transitions
     vivent sur des ETATS (:hover, :active), jamais sur le montage.
   ========================================================================== */
(function () {
  'use strict';

  if (typeof window === 'undefined') return;

  const esc = (value) => (typeof escapeHtml === 'function' ? escapeHtml(value ?? '') : String(value ?? ''));
  const escJs = (value) => (typeof escapeJsString === 'function' ? escapeJsString(String(value ?? '')) : String(value ?? '').replace(/['"\\]/g, ''));

  // Etat hors DOM : survit aux reconstructions innerHTML (meme patron que les
  // memoires de la page Emails).
  const fck = {
    loaded: false,
    loading: false,
    error: '',
    data: null,
    busy: '',            // cle de l'action en cours ('seq:<centre>:<cle>', 'job:<id>')
    auditFilter: { centerId: 'all', outcome: '', q: '' },
    auditRows: null,     // page filtree chargee via founderAuditLog (sinon bundle.audit)
    auditLoading: false,
    openSections: {},    // details deplies, restaures apres re-rendu
  };
  window.PinlaneFounderCockpit = fck;

  function centerId() {
    return (typeof state !== 'undefined' && state.adminCenterId) || 'libramont';
  }

  function toast(message) {
    if (typeof showAlert === 'function') showAlert(message);
  }

  // ---- Reseau ---------------------------------------------------------------

  async function load(force = false) {
    if (fck.loading || (fck.loaded && !force)) return;
    fck.loading = true;
    fck.error = '';
    render();
    try {
      const payload = await apiRequest('/api/ops?action=founderCockpit');
      fck.data = payload || null;
      fck.loaded = true;
    } catch (error) {
      // Message serveur si exposable, sinon phrase neutre. JAMAIS de stack.
      fck.error = (error && error.userMessage) || 'Le cockpit n\'a pas pu se charger. Rechargez dans un instant.';
    } finally {
      fck.loading = false;
      render();
    }
  }

  async function loadAudit() {
    fck.auditLoading = true;
    render();
    try {
      const f = fck.auditFilter;
      // Le parametre s'appelle auditCenter cote serveur : `action` et `centerId`
      // sont deja pris par le dispatcher. Pas de recherche libre : le filtre
      // serveur est une EGALITE exacte, un champ texte qui rendrait zero
      // resultat sur une frappe partielle serait une interface menteuse.
      const params = new URLSearchParams({ auditCenter: f.centerId || 'all', limit: '50' });
      if (f.outcome) params.set('outcome', f.outcome);
      const payload = await apiRequest(`/api/ops?action=founderAuditLog&${params.toString()}`);
      fck.auditRows = (payload && payload.entries) || [];
    } catch (error) {
      fck.auditRows = null;
      toast('Le journal n\'a pas pu etre filtre. Reessayez.');
    } finally {
      fck.auditLoading = false;
      render();
    }
  }

  window.fckReload = function () { fck.loaded = false; load(true); };

  window.fckAuditFilter = function (key, value) {
    fck.auditFilter[key] = value;
    loadAudit();
  };

  window.fckToggleSection = function (key, open) {
    fck.openSections[key] = Boolean(open);
  };

  // Bascule d'une sequence d'un centre depuis le cockpit. Passe par l'action
  // EXISTANTE automationSettings (deja tracee par le journal d'audit) : le
  // cockpit ne cree pas de chemin d'ecriture parallele.
  window.fckToggleSequence = async function (center, key, enabled) {
    const busyKey = `seq:${center}:${key}`;
    if (fck.busy) return;
    fck.busy = busyKey;
    render();
    try {
      await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'automationSettings', key, enabled, centerId: center }),
      });
      if (fck.data && fck.data.sequences && fck.data.sequences.perCenter && fck.data.sequences.perCenter[center]) {
        fck.data.sequences.perCenter[center][key] = { enabled };
      }
      toast(enabled ? 'Sequence activee.' : 'Sequence coupee.');
    } catch (error) {
      toast((error && error.userMessage) || 'La bascule n\'a pas ete enregistree.');
    } finally {
      fck.busy = '';
      render();
    }
  };

  // Relance d'un job rate (action dediee, gate platform.admin cote serveur).
  window.fckRequeueJob = async function (jobId) {
    const busyKey = `job:${jobId}`;
    if (fck.busy) return;
    fck.busy = busyKey;
    render();
    try {
      await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'requeueOpsJob', id: jobId, centerId: centerId() }),
      });
      toast('Job remis en file.');
      fck.loaded = false;
      load(true);
    } catch (error) {
      toast((error && error.userMessage) || 'Le job n\'a pas pu etre relance.');
      fck.busy = '';
      render();
    }
  };

  // Renvoi d'un mail en echec : action EXISTANTE retryCommunication, scopee
  // centre cote serveur sur la ligne reelle.
  window.fckRetryMail = async function (id, center) {
    const busyKey = `mail:${id}`;
    if (fck.busy) return;
    fck.busy = busyKey;
    render();
    try {
      await apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'retryCommunication', id, centerId: center }),
      });
      toast('Mail remis en file.');
      fck.loaded = false;
      load(true);
    } catch (error) {
      toast((error && error.userMessage) || 'Le renvoi a echoue.');
      fck.busy = '';
      render();
    }
  };

  // ---- Petits formateurs ----------------------------------------------------

  function when(iso) {
    if (!iso) return 'jamais';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return 'jamais';
    const deltaMs = Date.now() - date.getTime();
    const minutes = Math.round(deltaMs / 60000);
    if (minutes < 1) return 'a l\'instant';
    if (minutes < 60) return `il y a ${minutes} min`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `il y a ${hours} h`;
    const days = Math.round(hours / 24);
    return `il y a ${days} j`;
  }

  function chip(tone, label) {
    return `<span class="pv2-chip ${tone}">${esc(label)}</span>`;
  }

  const OUTCOME_CHIP = {
    success: () => chip('green', 'Succes'),
    error: () => chip('red', 'Erreur'),
    denied: () => chip('red', 'Refus'),
  };

  function panel(title, subtitle, body, aside = '') {
    return `<section class="pv2-panel">
      <header class="pv2-panel-head">
        <div><h2>${esc(title)}</h2>${subtitle ? `<p class="pv2-panel-sub">${subtitle}</p>` : ''}</div>
        ${aside}
      </header>
      ${body}
    </section>`;
  }

  function emptyLine(text) {
    return `<p class="pv2-quiet">${esc(text)}</p>`;
  }

  function sectionError(section) {
    return section && section.error ? emptyLine(section.error) : '';
  }

  // ---- Sections -------------------------------------------------------------

  function renderBreakage(b) {
    if (!b) return '';
    const mails = b.mails || {};
    const jobs = b.jobs || {};
    const worker = b.worker || {};
    const denied = b.denied || {};
    const problems = (Number(mails.failed) || 0) + (Number(jobs.failed) || 0)
      + (Number(worker.failed24h) || 0) + (Number(denied.count) || 0);

    let body = '';
    if (mails.error || jobs.error || worker.error || denied.error) {
      body += sectionError(mails) + sectionError(jobs) + sectionError(worker) + sectionError(denied);
    }
    if (!problems) {
      body += emptyLine('Rien ne casse en ce moment. Mails, jobs, worker et acces sont sains.');
    }
    if (Number(mails.failed) > 0) {
      const rows = (mails.recent || []).map((m) => `<tr>
        <td>${esc(m.subject || '(sans objet)')}<div class="pv2-cell-sub">${esc(m.recipient)} · ${esc(m.centerId)} · ${esc(when(m.createdAt))}</div></td>
        <td>${chip('red', `${m.attempts} tentative${m.attempts > 1 ? 's' : ''}`)}</td>
        <td class="fck-row-action"><button type="button" class="pv2-btn ghost" ${fck.busy === `mail:${m.id}` ? 'disabled' : ''} onclick="fckRetryMail(${Number(m.id)}, '${escJs(m.centerId)}')">${fck.busy === `mail:${m.id}` ? 'En cours…' : 'Renvoyer'}</button></td>
      </tr>`).join('');
      body += `<h3 class="fck-sub">${mails.failed} mail${mails.failed > 1 ? 's' : ''} en echec <span class="pv2-quiet">(${esc(mails.window)})</span></h3>
        <table class="pv2-table fck-table"><tbody>${rows}</tbody></table>`;
    }
    if (Number(jobs.failed) > 0) {
      const rows = (jobs.recent || []).map((j) => `<tr>
        <td>${esc(j.jobType)}<div class="pv2-cell-sub">${esc(j.centerId)} · ${esc(when(j.updatedAt))} · ${esc(String(j.lastError).slice(0, 90))}</div></td>
        <td>${chip('red', `${j.attempts}/${j.maxAttempts}`)}</td>
        <td class="fck-row-action"><button type="button" class="pv2-btn ghost" ${fck.busy === `job:${j.id}` ? 'disabled' : ''} onclick="fckRequeueJob(${Number(j.id)})">${fck.busy === `job:${j.id}` ? 'En cours…' : 'Relancer'}</button></td>
      </tr>`).join('');
      body += `<h3 class="fck-sub">${jobs.failed} job${jobs.failed > 1 ? 's' : ''} en echec <span class="pv2-quiet">(${esc(jobs.window)})</span></h3>
        <table class="pv2-table fck-table"><tbody>${rows}</tbody></table>`;
    }
    if (worker.lastRun) {
      const tone = worker.lastRun.status === 'ok' ? 'green' : (worker.lastRun.status === 'failed' ? 'red' : 'amber');
      body += `<p class="fck-line">Worker : dernier passage ${chip(tone, worker.lastRun.status === 'ok' ? 'sain' : worker.lastRun.status)}
        <span class="pv2-quiet">${esc(worker.lastRun.taskName)} · ${esc(when(worker.lastRun.startedAt))}${Number(worker.failed24h) ? ` · ${worker.failed24h} echec(s) sur 24 h` : ''}</span></p>`;
    } else if (!worker.error) {
      body += `<p class="fck-line">Worker : ${chip('amber', 'aucun passage enregistre')}</p>`;
    }
    if (Number(denied.count) > 0) {
      const rows = (denied.recent || []).map((d) => `<tr>
        <td>${esc(d.actorLabel || d.actorKind)}<div class="pv2-cell-sub">${esc(d.surface)} · ${esc(d.centerId)}${d.requestedCenter ? ` -> ${esc(d.requestedCenter)}` : ''} · ${esc(when(d.occurredAt))}</div></td>
        <td>${chip('red', esc(d.deniedReason || 'refus'))}</td>
      </tr>`).join('');
      body += `<h3 class="fck-sub">${denied.count} acces refuse${denied.count > 1 ? 's' : ''} <span class="pv2-quiet">(${esc(denied.window)})</span></h3>
        <table class="pv2-table fck-table"><tbody>${rows}</tbody></table>`;
    }
    return panel('Ce qui casse', 'Mails, jobs, worker, refus d\'acces. Ce qui demande une action passe devant.', body);
  }

  function renderAdoption(adoption, centers) {
    if (!adoption) return '';
    if (adoption.error) return panel('Vos clients s\'en servent-ils ?', '', sectionError(adoption));
    const byId = new Map((adoption.perCenter || []).map((c) => [c.centerId, c]));
    const cards = (centers || []).map((center) => {
      const a = byId.get(center.id) || { lastStaffAction: null, actions7d: 0, actions30d: 0, lastLogin: null, activeSessions: 0 };
      const silent = !a.lastStaffAction;
      return `<article class="fck-center-card">
        <header><strong>${esc(center.name)}</strong>${a.activeSessions ? chip('green', `${a.activeSessions} en ligne`) : ''}</header>
        <dl class="fck-kv">
          <div><dt>Derniere action staff</dt><dd>${silent ? chip('amber', 'aucune enregistree') : esc(when(a.lastStaffAction))}</dd></div>
          <div><dt>Actions 7 j / 30 j</dt><dd class="fck-num">${a.actions7d} / ${a.actions30d}</dd></div>
          <div><dt>Derniere connexion</dt><dd>${a.lastLogin ? esc(when(a.lastLogin)) : chip('amber', 'jamais')}</dd></div>
        </dl>
      </article>`;
    }).join('');
    // Fonctionnalites jamais touchees : le signal le plus utile pour decider
    // quoi construire et quoi retirer.
    const used = new Set((adoption.actions30d || []).map((row) => row.action));
    const top = (adoption.actions30d || []).slice(0, 8)
      .map((row) => `<span class="pv2-chip">${esc(row.action)} · ${row.count}</span>`).join(' ');
    return panel(
      'Vos clients s\'en servent-ils ?',
      `Le proprietaire plateforme est exclu de ces compteurs (${esc(adoption.window)}). ${used.size} action${used.size > 1 ? 's' : ''} distincte${used.size > 1 ? 's' : ''} utilisee${used.size > 1 ? 's' : ''} sur 30 jours.`,
      `<div class="fck-center-grid">${cards}</div>
       ${top ? `<h3 class="fck-sub">Les plus utilisees</h3><p class="fck-chips">${top}</p>` : emptyLine('Aucune action staff enregistree sur 30 jours.')}`,
    );
  }

  function renderAgents(agents) {
    if (!agents) return '';
    if (agents.error) return panel('Vos agents IA', '', sectionError(agents));
    const s = agents.suggestions || {};
    const d = agents.decisions || {};
    const plans = (agents.plans || []).map((p) => `<tr>
      <td>${esc(p.centerId)}<div class="pv2-cell-sub">${esc(p.fromDate)} -> ${esc(p.toDate)} · ${esc(p.mode)}</div></td>
      <td>${chip(p.status === 'proposed' ? 'amber' : 'green', esc(p.status))}</td>
      <td class="pv2-quiet">${esc(when(p.createdAt))}</td>
    </tr>`).join('');
    const insights = (agents.insights && agents.insights.perCenter || []).map((i) => `<tr>
      <td>${esc(i.centerId)}</td>
      <td class="fck-num">${i.count30d} <span class="pv2-quiet">sur 30 j</span></td>
      <td class="pv2-quiet">derniere ${esc(when(i.lastAt))}</td>
    </tr>`).join('');
    return panel(
      'Vos agents IA',
      'Ce qu\'ils ont reellement produit, avec les dates. Un agent silencieux depuis des jours est une information.',
      `<div class="fck-stats">
         <div class="fck-stat"><span class="fck-stat-num">${s.total || 0}</span><span class="fck-stat-cap">suggestions terrain<br>${s.pending ? `${chip('amber', `${s.pending} en attente`)}` : 'aucune en attente'} · derniere ${esc(when(s.lastAt))}</span></div>
         <div class="fck-stat"><span class="fck-stat-num">${d.d7 || 0}</span><span class="fck-stat-cap">decisions d\'agents (${esc(d.window || '7 j')})<br>derniere ${esc(when(d.lastAt))}</span></div>
       </div>
       ${insights ? `<h3 class="fck-sub">Insights marketing par centre</h3><table class="pv2-table fck-table"><tbody>${insights}</tbody></table>` : ''}
       ${plans ? `<h3 class="fck-sub">Plans marketing actifs</h3><table class="pv2-table fck-table"><tbody>${plans}</tbody></table>` : emptyLine('Aucun plan marketing actif.')}`,
    );
  }

  function renderCost(cost) {
    if (!cost) return '';
    if (cost.error) return panel('Ce que coute l\'IA', '', sectionError(cost));
    const spent = Number(cost.spentUsd) || 0;
    const budget = Number(cost.budgetUsd) || 0;
    const ratio = budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0;
    const tone = ratio >= 90 ? 'red' : (ratio >= 70 ? 'amber' : 'green');
    const months = (cost.months || []).map((m) => `<tr>
      <td>${esc(m.month)}</td><td class="fck-num">${m.costUsd.toFixed(2)} $</td><td class="pv2-quiet fck-num">${m.calls} appels</td>
    </tr>`).join('');
    return panel(
      'Ce que coute l\'IA',
      `Mois ${esc(cost.month)} : plafond ${budget.toFixed(2)} $ (lib/llm-budget).`,
      `${cost.monthMeasured
        ? `<p class="fck-line"><span class="fck-stat-num">${spent.toFixed(2)} $</span> depenses ${chip(tone, `${ratio} % du plafond`)}
             <span class="pv2-quiet">· ${cost.calls} appels · projection lineaire du mois ${Number(cost.projectionUsd).toFixed(2)} $ (projection, pas une mesure)</span></p>`
        : emptyLine('Aucune depense enregistree ce mois-ci.')}
       <p class="pv2-quiet">Cout par jour : pas encore mesure (le registre est mensuel).</p>
       ${months ? `<table class="pv2-table fck-table"><tbody>${months}</tbody></table>` : ''}`,
    );
  }

  function renderAudit(bundleAudit, centers) {
    const rows = fck.auditRows !== null ? fck.auditRows : ((bundleAudit && bundleAudit.entries) || []);
    const f = fck.auditFilter;
    const centerOptions = [{ id: 'all', name: 'Tous les centres' }].concat(centers || [])
      .map((c) => `<option value="${esc(c.id)}" ${f.centerId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
    const outcomes = [['', 'Tous les resultats'], ['success', 'Succes'], ['error', 'Erreurs'], ['denied', 'Refus']]
      .map(([v, l]) => `<option value="${esc(v)}" ${f.outcome === v ? 'selected' : ''}>${esc(l)}</option>`).join('');
    const list = rows.map((r) => `<tr>
      <td>${esc(r.actorLabel || r.actorMemberId || r.actorKind || 'systeme')}
        <div class="pv2-cell-sub">${esc(r.action)} · ${esc(r.centerId)} · ${esc(r.surface || '')}</div></td>
      <td>${(OUTCOME_CHIP[r.outcome] || (() => chip('', esc(r.outcome || ''))))()}</td>
      <td class="pv2-quiet">${esc(when(r.occurredAt))}</td>
    </tr>`).join('');
    return panel(
      'Journal d\'audit',
      'Qui a fait quoi, ou, avec quel resultat. Tout centre confondu : c\'est la vue plateforme.',
      `<div class="fck-audit-bar">
         <select class="pv2-input" onchange="fckAuditFilter('centerId', this.value)">${centerOptions}</select>
         <select class="pv2-input" onchange="fckAuditFilter('outcome', this.value)">${outcomes}</select>
       </div>
       ${fck.auditLoading ? emptyLine('Chargement du journal…')
        : (list ? `<table class="pv2-table fck-table"><tbody>${list}</tbody></table>`
          : emptyLine('Aucune entree pour ce filtre.'))}`,
    );
  }

  function renderLeads(leads) {
    if (!leads) return '';
    if (leads.error) return panel('Vos prospects', '', sectionError(leads));
    if (!leads.total) return panel('Vos prospects', '', emptyLine('Aucun prospect enregistre pour le moment.'));
    const rows = (leads.recent || []).map((l) => `<tr>
      <td>${esc(l.centerName || '(sans nom)')}</td>
      <td>${chip(l.status === 'new' ? 'amber' : '', esc(l.status))}</td>
      <td class="pv2-quiet">${esc(when(l.createdAt))}</td>
    </tr>`).join('');
    return panel(
      'Vos prospects',
      `${leads.total} au total (${esc(leads.window)}) · dernier ${esc(when(leads.lastAt))}`,
      `<table class="pv2-table fck-table"><tbody>${rows}</tbody></table>`,
    );
  }

  function renderSequences(sequences, centers) {
    if (!sequences) return '';
    if (sequences.error) return panel('Commandes : sequences par centre', '', sectionError(sequences));
    const keys = sequences.keys || [];
    const head = `<tr><th></th>${(centers || []).map((c) => `<th>${esc(c.name)}</th>`).join('')}</tr>`;
    const rows = keys.map((k) => {
      const cells = (centers || []).map((c) => {
        const cell = (sequences.perCenter && sequences.perCenter[c.id] && sequences.perCenter[c.id][k.key]) || { enabled: false };
        const busyKey = `seq:${c.id}:${k.key}`;
        return `<td><button type="button" class="mk-switch ${cell.enabled ? 'is-on' : ''}" role="switch"
          aria-checked="${cell.enabled ? 'true' : 'false'}" ${fck.busy === busyKey ? 'disabled' : ''}
          aria-label="${esc(k.label)} pour ${esc(c.name)}"
          onclick="fckToggleSequence('${escJs(c.id)}', '${escJs(k.key)}', ${cell.enabled ? 'false' : 'true'})"><span></span></button></td>`;
      }).join('');
      return `<tr><td>${esc(k.label)}</td>${cells}</tr>`;
    }).join('');
    return panel(
      'Commandes : sequences par centre',
      'Chaque bascule passe par le meme chemin que la console du centre, donc chaque geste est trace au journal.',
      `<table class="pv2-table fck-table fck-seq-table"><thead>${head}</thead><tbody>${rows}</tbody></table>`,
    );
  }

  // ---- Rendu ----------------------------------------------------------------

  function render() {
    const root = document.getElementById('staffCockpitPage');
    if (!root) return;
    if (!fck.loaded && !fck.loading && !fck.error) setTimeout(() => load(), 0);

    const d = fck.data || {};
    const generated = d.generatedAt ? when(d.generatedAt) : '';

    root.innerHTML = `<div class="pv2-shell fck-shell">
      <header class="pv2-bar">
        <div>
          <p class="pv2-crumb">Plateforme</p>
          <h1>Cockpit fondateur</h1>
          <p class="pv2-bar-sub">Tout le SaaS : ce qui casse, l'usage, les agents, le cout, le journal.${generated ? ` · actualise ${esc(generated)}` : ''}</p>
        </div>
        <div class="pv2-bar-actions">
          <button type="button" class="pv2-btn ghost" onclick="fckReload()">Actualiser</button>
        </div>
      </header>

      ${d.testData ? `<aside class="fck-testdata" role="note">
        Donnees de TEST : le SaaS n'est pas lance, tout ce qui suit vient des essais internes.
        Aucun chiffre de cette page n'est du reel client.
      </aside>` : ''}

      ${fck.error ? `<section class="pv2-panel"><p class="pv2-quiet">${esc(fck.error)}</p>
        <button type="button" class="pv2-btn" onclick="fckReload()">Reessayer</button></section>` : ''}

      ${fck.loading && !fck.data ? `<section class="pv2-panel"><p class="pv2-quiet">Chargement du cockpit…</p></section>` : ''}

      ${fck.data ? [
        renderBreakage(d.breakage),
        renderAdoption(d.adoption, d.centers),
        renderAgents(d.agents),
        renderCost(d.cost),
        renderAudit(d.audit, d.centers),
        renderSequences(d.sequences, d.centers),
        renderLeads(d.leads),
      ].join('') : ''}
    </div>`;
  }

  window.renderStaffFounderCockpitPage = render;
})();

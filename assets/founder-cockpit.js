/* ============================================================================
   COCKPIT FONDATEUR : CATEGORIE PLATEFORME (permission platform.admin)
   ----------------------------------------------------------------------------
   Quatre pages pour le proprietaire du PRODUIT, rendues dans #staffCockpitPage :
   - 'cockpit'            vue d'ensemble (inchangee sur le fond) ;
   - 'cockpit-agents'     les agents IA un par un + le cout (founderAgents) ;
   - 'cockpit-incidents'  triage unifie, erreurs console en tete (founderIncidents) ;
   - 'cockpit-clients'    comment chaque centre gere son etablissement (founderClients).

   Doctrine identique au reste de la console :
   - style Vercel NEUTRE : monochrome sauf le sens (vert = reussi, rouge =
     echec, ambre = attente), un seul bouton primaire, filets 1px, composants
     pv2 reutilises, AUCUNE couleur de marque client ;
   - chaque chiffre vient d'un bundle serveur. Ce fichier n'invente RIEN :
     quand une grandeur n'est pas mesurable, le bundle le dit
     (costPerAgentMeasured: false...) et l'ecran ecrit "pas encore mesure"
     au lieu d'un zero qui ressemble a une mesure ;
   - le SaaS n'est pas lance : bundle.testData = true, et le bandeau le dit ;
   - chaque page a son PROPRE cache d'etat et son propre fetch : une page en
     erreur ne casse pas les autres ;
   - les pages se reconstruisent par innerHTML a chaque rendu : les transitions
     vivent sur des ETATS (:hover, :active), jamais sur le montage. Les
     graphiques (window.PinlaneCharts) portent leur propre garde de premiere
     apparition via motionKey ;
   - JAMAIS de balise <header> : en mode console, `body.staff-mode header`
     ecrase tout <header> a hauteur 0. Uniquement div/section.
   ========================================================================== */
(function () {
  'use strict';

  if (typeof window === 'undefined') return;

  const esc = (value) => (typeof escapeHtml === 'function' ? escapeHtml(value ?? '') : String(value ?? ''));
  const escJs = (value) => (typeof escapeJsString === 'function' ? escapeJsString(String(value ?? '')) : String(value ?? '').replace(/['"\\]/g, ''));

  // Etat hors DOM : survit aux reconstructions innerHTML (meme patron que les
  // memoires de la page Emails). `fck` porte la page 'cockpit' historique.
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

  // Les trois autres pages de la categorie : action API dediee + cache dedie.
  const PAGE_ACTIONS = {
    'cockpit-agents': 'founderAgents',
    'cockpit-incidents': 'founderIncidents',
    'cockpit-clients': 'founderClients',
  };
  const PAGE_META = {
    'cockpit-agents': { title: 'Agents IA', sub: 'Ce que chaque agent produit reellement, et ce que l\'IA coute.' },
    'cockpit-incidents': { title: 'Incidents', sub: 'Triage unifie : les erreurs console des ecrans d\'abord, puis mails, jobs, worker et refus.' },
    'cockpit-clients': { title: 'Clients', sub: 'Comment chaque centre gere son etablissement : configuration, adoption, acteurs.' },
  };
  const pageStates = {
    'cockpit-agents': { loaded: false, loading: false, error: '', data: null },
    'cockpit-incidents': { loaded: false, loading: false, error: '', data: null },
    'cockpit-clients': { loaded: false, loading: false, error: '', data: null },
  };
  fck.pages = pageStates;

  // Page active + racine memorisee : les rendus internes (fin de fetch, busy)
  // redessinent la page reellement affichee, pas une autre.
  let activePageKey = 'cockpit';
  let activeRoot = null;

  function getRoot() {
    if (activeRoot && document.contains(activeRoot)) return activeRoot;
    return document.getElementById('staffCockpitPage');
  }

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

  async function loadPage(key, force = false) {
    const st = pageStates[key];
    if (!st) return;
    if (st.loading || (st.loaded && !force)) return;
    st.loading = true;
    st.error = '';
    render();
    try {
      const payload = await apiRequest(`/api/ops?action=${PAGE_ACTIONS[key]}`);
      st.data = payload || null;
      st.loaded = true;
    } catch (error) {
      const status = Number(error && error.status);
      // Action pas encore deployee cote serveur (400/404) : etat calme, pas
      // une fausse panne. Le front est livre avant les builders.
      st.error = (status === 400 || status === 404)
        ? 'Cette vue n\'est pas encore disponible cote serveur. Elle s\'allumera a la prochaine mise en production.'
        : ((error && error.userMessage) || 'La page n\'a pas pu se charger. Rechargez dans un instant.');
    } finally {
      st.loading = false;
      render();
    }
  }

  // Apres une action (renvoi de mail, relance de job), on recharge la page
  // REELLEMENT affichee, et on perime le bundle cockpit dans tous les cas :
  // les deux vues lisent les memes files.
  function reloadActive() {
    fck.loaded = false;
    if (activePageKey === 'cockpit') {
      load(true);
      return;
    }
    const st = pageStates[activePageKey];
    if (st) {
      st.loaded = false;
      loadPage(activePageKey, true);
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

  window.fckPageReload = function (key) {
    const st = pageStates[key];
    if (!st) return;
    st.loaded = false;
    st.error = '';
    loadPage(key, true);
  };

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
      reloadActive();
    } catch (error) {
      toast((error && error.userMessage) || 'Le job n\'a pas pu etre relance.');
      fck.busy = '';
      render();
    } finally {
      fck.busy = '';
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
      reloadActive();
    } catch (error) {
      toast((error && error.userMessage) || 'Le renvoi a echoue.');
      fck.busy = '';
      render();
    } finally {
      fck.busy = '';
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

  function isFresh24h(iso) {
    if (!iso) return false;
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return false;
    return Date.now() - t < 24 * 3600 * 1000;
  }

  function chip(tone, label) {
    return `<span class="pv2-chip ${tone}">${esc(label)}</span>`;
  }

  const OUTCOME_CHIP = {
    success: () => chip('green', 'Succes'),
    error: () => chip('red', 'Erreur'),
    denied: () => chip('red', 'Refus'),
  };

  function panel(title, subtitle, body, aside = '', attrs = '') {
    // <div>, pas <header> : en mode console, `body.staff-mode header` ecrase
    // tous les <header> a hauteur 0 (regle qui masque l'en-tete du site).
    return `<section class="pv2-panel"${attrs ? ` ${attrs}` : ''}>
      <div class="pv2-panel-head">
        <div><h2>${esc(title)}</h2>${subtitle ? `<p class="pv2-panel-sub">${subtitle}</p>` : ''}</div>
        ${aside}
      </div>
      ${body}
    </section>`;
  }

  function emptyLine(text) {
    return `<p class="pv2-quiet">${esc(text)}</p>`;
  }

  function sectionError(section) {
    return section && section.error ? emptyLine(section.error) : '';
  }

  function testDataBanner() {
    return `<aside class="fck-testdata" role="note">
        Donnees de TEST : le SaaS n'est pas lance, tout ce qui suit vient des essais internes.
        Aucun chiffre de cette page n'est du reel client.
      </aside>`;
  }

  // Serie potentiellement heterogene (chaines, objets) -> libelles surs.
  function toLabelList(list) {
    return (Array.isArray(list) ? list : [])
      .map((item) => (typeof item === 'string' ? item : (item && (item.id || item.name || item.path || item.url)) || ''))
      .filter(Boolean);
  }

  // ---- Sections (page 'cockpit', inchangee sur le fond) ---------------------

  function renderBreakage(b, title = 'Ce qui casse', subtitle = 'Mails, jobs, worker, refus d\'acces. Ce qui demande une action passe devant.', attrs = '') {
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
    return panel(title, subtitle, body, '', attrs);
  }

  function renderAdoption(adoption, centers) {
    if (!adoption) return '';
    if (adoption.error) return panel('Vos clients s\'en servent-ils ?', '', sectionError(adoption));
    const byId = new Map((adoption.perCenter || []).map((c) => [c.centerId, c]));
    const cards = (centers || []).map((center) => {
      const a = byId.get(center.id) || { lastStaffAction: null, actions7d: 0, actions30d: 0, lastLogin: null, activeSessions: 0 };
      const silent = !a.lastStaffAction;
      return `<article class="fck-center-card">
        <div class="fck-card-head"><strong>${esc(center.name)}</strong>${a.activeSessions ? chip('green', `${a.activeSessions} en ligne`) : ''}</div>
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
      <td>${chip(p.status === 'proposed' ? 'amber' : 'green', esc({ proposed: 'propose', applied: 'applique', active: 'actif' }[p.status] || p.status))}</td>
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
      <td>${chip(l.status === 'new' ? 'amber' : '', esc({ new: 'nouveau', contacted: 'contacte', converted: 'converti', rejected: 'ecarte' }[l.status] || l.status))}</td>
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

  // ---- Page Agents IA (founderAgents) ---------------------------------------

  // Les quatre agents du produit : toujours quatre cartes, meme si le bundle
  // en oublie un : une carte absente serait un silence invisible.
  const AGENT_ORDER = ['marketing', 'emails', 'suggestions', 'decisions'];
  const AGENT_LABELS = {
    marketing: 'Agent marketing',
    emails: 'Agent emails',
    suggestions: 'Suggestions terrain',
    decisions: 'Decisions automatiques',
  };

  function normalizeAgentList(raw) {
    let entries = [];
    if (Array.isArray(raw)) entries = raw;
    else if (raw && typeof raw === 'object') {
      entries = Object.keys(raw).map((key) => ({ key, ...(raw[key] || {}) }));
    }
    const byKey = new Map(entries.map((a) => [String(a.key || a.id || ''), a]));
    const keys = AGENT_ORDER.concat(entries.map((a) => String(a.key || a.id || '')).filter((k) => k && !AGENT_ORDER.includes(k)));
    return keys.map((key) => {
      const a = byKey.get(key);
      if (!a) return { key, label: AGENT_LABELS[key] || key, measured: false, lastAt: null, d7: 0, d30: 0, detail: '' };
      return {
        key,
        label: a.label || AGENT_LABELS[key] || key,
        measured: true,
        lastAt: a.lastAt || a.lastActivityAt || a.last || null,
        d7: Number(a.count7d ?? a.d7 ?? a.volume7d) || 0,
        d30: Number(a.count30d ?? a.d30 ?? a.volume30d) || 0,
        detail: a.detail || a.lastLabel || '',
      };
    });
  }

  function renderAgentCards(d) {
    const agents = normalizeAgentList(d.agents);
    const cards = agents.map((a) => {
      const silent = a.measured && a.d7 === 0;
      const statusChip = !a.measured ? chip('amber', 'aucune donnee') : (silent ? chip('amber', 'silencieux 7 j') : '');
      return `<article class="fck-center-card fck-agent-card">
        <div class="fck-card-head"><strong>${esc(a.label)}</strong>${statusChip}</div>
        <dl class="fck-kv">
          <div><dt>Derniere activite</dt><dd>${a.lastAt ? esc(when(a.lastAt)) : chip('amber', 'jamais')}</dd></div>
          <div><dt>Volume 7 j / 30 j</dt><dd class="fck-num">${a.measured ? `${a.d7} / ${a.d30}` : 'pas encore mesure'}</dd></div>
          ${a.detail ? `<div><dt>Derniere production</dt><dd>${esc(a.detail)}</dd></div>` : ''}
        </dl>
      </article>`;
    }).join('');
    return panel(
      'Un agent, une carte',
      'La derniere activite reelle et le volume. Un agent silencieux sur 7 jours est signale en ambre.',
      cards ? `<div class="fck-center-grid fck-agent-grid">${cards}</div>` : emptyLine('Pas encore de donnees sur la periode.'),
      '', 'data-fck-panel="agents"',
    );
  }

  function renderAgentsCost(cost) {
    const attrs = 'data-fck-panel="agents-cost"';
    if (!cost) return panel('Ce que coute l\'IA', '', emptyLine('Pas encore de donnees sur la periode.'), '', attrs);
    if (cost.error) return panel('Ce que coute l\'IA', '', sectionError(cost), '', attrs);
    const budget = Number(cost.budgetUsd) || 0;
    const months = Array.isArray(cost.months) ? cost.months : [];
    const chartsReady = Boolean(window.PinlaneCharts && typeof window.PinlaneCharts.barChart === 'function');
    const table = months.length
      ? `<table class="pv2-table fck-table"><tbody>${months.map((m) => `<tr>
          <td>${esc(m.month)}</td><td class="fck-num">${(Number(m.costUsd) || 0).toFixed(2)} $</td><td class="pv2-quiet fck-num">${Number(m.calls) || 0} appels</td>
        </tr>`).join('')}</tbody></table>`
      : emptyLine('Aucune depense enregistree pour le moment.');
    return panel(
      'Ce que coute l\'IA',
      `${budget > 0 ? `Plafond ${budget.toFixed(2)} $ par mois (lib/llm-budget). ` : ''}Montants en dollars US ; le graphique arrondit, le tableau donne l'exact.`,
      `${chartsReady && months.length ? '<div class="fck-chart" data-fck-chart="agents-cost"></div>' : ''}
       ${table}
       ${cost.costPerAgentMeasured === true ? '' : '<p class="pv2-quiet fck-cost-note">Cout par agent : non mesure (le registre de depense est global, pas ventile par agent).</p>'}`,
      '', attrs,
    );
  }

  function renderAgentsPage(st) {
    const d = st.data || {};
    return renderAgentCards(d) + renderAgentsCost(d.cost);
  }

  // Les graphiques se montent APRES l'innerHTML, sur les hotes marques.
  // window.PinlaneCharts porte sa propre garde de premiere apparition
  // (motionKey) : un re-rendu ne rejoue pas le dessin.
  function mountCharts(root) {
    const charts = window.PinlaneCharts;
    if (!charts || typeof charts.barChart !== 'function') return;
    const host = root.querySelector('[data-fck-chart="agents-cost"]');
    if (!host) return;
    const st = pageStates['cockpit-agents'];
    const months = (st.data && st.data.cost && Array.isArray(st.data.cost.months)) ? st.data.cost.months : [];
    const series = months
      .map((m) => ({ label: String(m.month || ''), value: Number(m.costUsd) || 0 }))
      .sort((a, b) => (a.label < b.label ? -1 : 1));
    try {
      charts.barChart(host, { series, format: 'int', motionKey: 'fck-agents-cost', height: 160 });
    } catch (error) { /* un graphique rate ne doit pas coucher la page */ }
  }

  // ---- Page Incidents (founderIncidents) ------------------------------------

  function normalizeConsoleGroups(d) {
    const src = d.console || d.consoleErrors || d.clientErrors || {};
    const groups = Array.isArray(src) ? src : (Array.isArray(src.groups) ? src.groups : []);
    return groups.map((g, index) => ({
      key: `inc:${g.id != null ? g.id : index}`,
      message: String(g.message || g.error || g.title || '(erreur sans message)').split('\n')[0].slice(0, 180),
      count: Number(g.count) || 0,
      lastAt: g.lastSeenAt || g.lastAt || null,
      centers: toLabelList(g.centers || g.centerIds),
      pages: toLabelList(g.pages || g.urls),
      stack: String(g.stack || g.stackSample || g.sample || ''),
    }));
  }

  function renderConsoleErrors(d) {
    const src = d.console || d.consoleErrors || {};
    const groups = normalizeConsoleGroups(d);
    const rows = groups.map((g) => {
      const fresh = isFresh24h(g.lastAt);
      const open = Boolean(fck.openSections[g.key]);
      return `<div class="fck-incident">
        <div class="fck-incident-head">
          <strong class="fck-incident-msg">${esc(g.message)}</strong>
          ${chip(fresh ? 'red' : '', `${g.count} occurrence${g.count > 1 ? 's' : ''}`)}
        </div>
        <div class="pv2-cell-sub">derniere ${esc(when(g.lastAt))} · centre${g.centers.length > 1 ? 's' : ''} : ${esc(g.centers.join(', ') || 'inconnu')} · page${g.pages.length > 1 ? 's' : ''} : ${esc(g.pages.slice(0, 3).join(', ') || 'inconnue')}</div>
        ${g.stack ? `<details class="fck-stack" ${open ? 'open' : ''} ontoggle="fckToggleSection('${escJs(g.key)}', this.open)">
          <summary>Extrait de stack</summary>
          <pre>${esc(g.stack)}</pre>
        </details>` : ''}
      </div>`;
    }).join('');
    return panel(
      'Erreurs console des ecrans',
      `Ce que les navigateurs des centres ont reellement jete comme erreurs${src.window ? ` (${esc(src.window)})` : ''}. Rouge = vu il y a moins de 24 h. Le savoir avant l'appel du client, c'est le but.`,
      src.error ? sectionError(src) : (rows ? `<div class="fck-incident-list">${rows}</div>` : emptyLine('Aucune erreur console enregistree sur la periode.')),
      '', 'data-fck-panel="console"',
    );
  }

  function renderIncidentsPage(st) {
    const d = st.data || {};
    const consolePanel = renderConsoleErrors(d);
    const b = d.breakage || ((d.mails || d.jobs || d.worker || d.denied)
      ? { mails: d.mails, jobs: d.jobs, worker: d.worker, denied: d.denied }
      : null);
    // Les erreurs console passent AU-DESSUS : c'est le signal que personne
    // d'autre ne remonte. Mails/jobs/worker/refus suivent, avec leurs actions.
    const rest = b
      ? renderBreakage(b, 'Mails, jobs, worker, refus', 'Le reste du triage. Ce qui demande une action passe devant.', 'data-fck-panel="breakage"')
      : '';
    return consolePanel + rest;
  }

  // ---- Page Clients (founderClients) ----------------------------------------

  function isPlatformOwnerActor(actor) {
    const haystack = [actor.memberId, actor.id, actor.roleId, actor.role].map((v) => String(v || '').toLowerCase());
    return haystack.some((v) => v.includes('platform-owner') || v.includes('platform_owner'));
  }

  function normalizeClientCenters(d) {
    const list = Array.isArray(d.centers) ? d.centers : (Array.isArray(d.perCenter) ? d.perCenter : []);
    return list.map((c) => {
      const adoption = c.adoption || c;
      return {
        id: String(c.id || c.centerId || ''),
        name: c.name || c.centerName || c.id || c.centerId || '(sans nom)',
        status: String(c.status || ''),
        config: c.config || c.setup || null,
        lastStaffAction: adoption.lastStaffAction || null,
        actions7d: Number(adoption.actions7d) || 0,
        actions30d: Number(adoption.actions30d) || 0,
        lastLogin: adoption.lastLogin || null,
        activeSessions: Number(adoption.activeSessions) || 0,
        actors: (Array.isArray(c.topActors) ? c.topActors : (Array.isArray(c.actors) ? c.actors : []))
          .filter((a) => a && !isPlatformOwnerActor(a)),
        mails: c.mails || c.mailVolume || null,
        sequences: c.sequences || null,
      };
    });
  }

  function clientStatusChip(status) {
    if (status === 'active') return chip('green', 'actif');
    if (status === 'planned') return chip('amber', 'en preparation');
    if (status === 'suspended' || status === 'paused') return chip('red', 'suspendu');
    return status ? chip('', status) : '';
  }

  function configSummary(config) {
    if (!config) return 'pas encore mesure';
    if (typeof config === 'string') return config;
    if (typeof config.done === 'number' && typeof config.total === 'number') {
      return `${config.done} / ${config.total} elements poses`;
    }
    if (Array.isArray(config)) {
      const done = config.filter((c) => c && (c.done || c.enabled)).length;
      return `${done} / ${config.length} elements poses`;
    }
    const keys = Object.keys(config);
    if (!keys.length) return 'pas encore mesure';
    const done = keys.filter((k) => Boolean(config[k])).length;
    return `${done} / ${keys.length} elements poses`;
  }

  function mailVolumeLine(mails) {
    if (mails == null) return 'pas encore mesure';
    if (typeof mails === 'number') return `${mails} sur 30 j`;
    const sent = mails.sent30d ?? mails.sent ?? null;
    const failed = mails.failed30d ?? mails.failed ?? null;
    if (sent == null && failed == null) return 'pas encore mesure';
    const sentN = Number(sent) || 0;
    return `${sentN} envoye${sentN > 1 ? 's' : ''}${failed != null ? ` · ${Number(failed) || 0} en echec` : ''} (30 j)`;
  }

  function sequencesLine(seq) {
    if (!seq) return 'pas encore mesure';
    if (typeof seq.active === 'number') {
      return `${seq.active}${typeof seq.total === 'number' ? ` / ${seq.total}` : ''} active${seq.active > 1 ? 's' : ''}`;
    }
    if (Array.isArray(seq)) {
      const on = seq.filter((s) => s === true || (s && s.enabled)).length;
      return `${on} / ${seq.length} active${on > 1 ? 's' : ''}`;
    }
    if (typeof seq === 'object') {
      const keys = Object.keys(seq);
      if (!keys.length) return 'pas encore mesure';
      const on = keys.filter((k) => seq[k] === true || (seq[k] && seq[k].enabled)).length;
      return `${on} / ${keys.length} active${on > 1 ? 's' : ''}`;
    }
    return 'pas encore mesure';
  }

  function renderClientCard(c) {
    const actorChips = c.actors.slice(0, 6).map((a) => {
      const label = a.label || a.name || a.memberId || '(inconnu)';
      const count = Number(a.count30d ?? a.count ?? a.actions30d) || 0;
      return `<span class="pv2-chip">${esc(label)} · ${count}</span>`;
    }).join(' ');
    return `<section class="fck-center-card fck-client-card">
      <div class="fck-card-head fck-client-head">
        <div><strong>${esc(c.name)}</strong> <span class="pv2-quiet">· ${esc(c.id)}</span></div>
        ${clientStatusChip(c.status)}
      </div>
      <dl class="fck-kv">
        <div><dt>Config posee</dt><dd>${esc(configSummary(c.config))}</dd></div>
        <div><dt>Derniere action staff</dt><dd>${c.lastStaffAction ? esc(when(c.lastStaffAction)) : chip('amber', 'aucune enregistree')}</dd></div>
        <div><dt>Actions 7 j / 30 j</dt><dd class="fck-num">${c.actions7d} / ${c.actions30d}</dd></div>
        <div><dt>Derniere connexion</dt><dd>${c.lastLogin ? esc(when(c.lastLogin)) : chip('amber', 'jamais')}</dd></div>
        <div><dt>Volume mails</dt><dd class="fck-num">${esc(mailVolumeLine(c.mails))}</dd></div>
        <div><dt>Sequences</dt><dd class="fck-num">${esc(sequencesLine(c.sequences))}</dd></div>
      </dl>
      <h3 class="fck-sub">Qui gere le centre</h3>
      ${actorChips ? `<p class="fck-chips">${actorChips}</p>` : emptyLine('Aucun acteur staff sur 30 jours (hors proprietaire plateforme).')}
    </section>`;
  }

  function renderClientsPage(st) {
    const d = st.data || {};
    const centers = normalizeClientCenters(d);
    const cards = centers.map(renderClientCard).join('');
    return panel(
      'Vos clients, centre par centre',
      'Identite, configuration, adoption, acteurs reels. Le proprietaire plateforme est exclu des acteurs : on lit LEUR gestion, pas la votre.',
      cards ? `<div class="fck-center-grid fck-client-grid">${cards}</div>` : emptyLine('Aucun centre enregistre pour le moment.'),
      '', 'data-fck-panel="clients"',
    );
  }

  // ---- Rendu ----------------------------------------------------------------

  function renderCockpitPage(root) {
    if (!fck.loaded && !fck.loading && !fck.error) setTimeout(() => load(), 0);

    const d = fck.data || {};
    const generated = d.generatedAt ? when(d.generatedAt) : '';

    root.innerHTML = `<div class="pv2-shell fck-shell">
      <section class="pv2-bar">
        <div>
          <div class="pv2-bar-crumb"><span class="pv2-live"></span>Plateforme</div>
          <h1>Cockpit fondateur</h1>
          <p class="pv2-bar-sub">Tout le SaaS : ce qui casse, l'usage, les agents, le cout, le journal.${generated ? ` · actualise ${esc(generated)}` : ''}</p>
        </div>
        <div class="pv2-bar-actions">
          <button type="button" class="pv2-btn ghost" onclick="fckReload()">Actualiser</button>
        </div>
      </section>

      ${d.testData ? testDataBanner() : ''}

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

  const PAGE_BODY_RENDERERS = {
    'cockpit-agents': renderAgentsPage,
    'cockpit-incidents': renderIncidentsPage,
    'cockpit-clients': renderClientsPage,
  };

  function renderSubPage(root, pageKey) {
    const st = pageStates[pageKey];
    const meta = PAGE_META[pageKey];
    if (!st || !meta) return;
    if (!st.loaded && !st.loading && !st.error) setTimeout(() => loadPage(pageKey), 0);

    const d = st.data || {};
    const generated = d.generatedAt ? when(d.generatedAt) : '';

    root.innerHTML = `<div class="pv2-shell fck-shell">
      <section class="pv2-bar">
        <div>
          <div class="pv2-bar-crumb"><span class="pv2-live"></span>Plateforme</div>
          <h1>${esc(meta.title)}</h1>
          <p class="pv2-bar-sub">${esc(meta.sub)}${generated ? ` · actualise ${esc(generated)}` : ''}</p>
        </div>
        <div class="pv2-bar-actions">
          <button type="button" class="pv2-btn ghost" onclick="fckPageReload('${escJs(pageKey)}')">Actualiser</button>
        </div>
      </section>

      ${d.testData ? testDataBanner() : ''}

      ${st.error ? `<section class="pv2-panel"><p class="pv2-quiet">${esc(st.error)}</p>
        <button type="button" class="pv2-btn" onclick="fckPageReload('${escJs(pageKey)}')">Reessayer</button></section>` : ''}

      ${st.loading && !st.data ? `<section class="pv2-panel"><p class="pv2-quiet">Chargement de la page…</p></section>` : ''}

      ${st.data ? PAGE_BODY_RENDERERS[pageKey](st) : ''}
    </div>`;

    if (pageKey === 'cockpit-agents' && st.data) mountCharts(root);
  }

  function render() {
    const root = getRoot();
    if (!root) return;
    if (activePageKey === 'cockpit') renderCockpitPage(root);
    else renderSubPage(root, activePageKey);
  }

  // Point d'entree public. Compatible avec l'appel historique sans argument :
  // renderStaffFounderCockpitPage()                       -> page selon le menu
  // renderStaffFounderCockpitPage(root, 'cockpit-agents') -> page demandee
  window.renderStaffFounderCockpitPage = function (root, pageKey) {
    if (root && root.nodeType === 1) activeRoot = root;
    let key = typeof pageKey === 'string' ? pageKey : '';
    if (key !== 'cockpit' && !PAGE_ACTIONS[key]) {
      const fromMenu = (typeof state !== 'undefined' && state.staffMenuPage) || '';
      key = (fromMenu === 'cockpit' || PAGE_ACTIONS[fromMenu]) ? fromMenu : 'cockpit';
    }
    activePageKey = key;
    render();
  };
})();

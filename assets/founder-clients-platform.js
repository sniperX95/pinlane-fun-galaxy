/* ============================================================================
   FRONT-CLIENTS PLATEFORME : outil du PROPRIETAIRE de Pinlane (platform.admin)
   ----------------------------------------------------------------------------
   ATTENTION a ne pas confondre avec la page "Clients" de la categorie Direction
   (founder-cockpit.js, cle 'cockpit-clients') : celle-la montre comment CHAQUE
   centre gere son etablissement. ICI, c'est l'inverse : Movsar gere les
   ENTREPRISES qui achetent Pinlane (Fun Galaxy, etc.), les provisionne cle en
   main (centre + roles Direction/Staff + codes d'acces) et suit leur statut.

   Rendue dans #staffCockpitPage (meme hote que founder-centres.js), via
   window.renderPlatformClientsPage(root). Meme doctrine que le reste de la
   console :
   - Vercel neutre : monochrome sauf le SENS (vert actif, bleu essai, ambre
     suspendu, rouge parti) ; un seul bouton primaire ; filets 1px ; primitives
     pv2-/fck- reutilisees ;
   - le SaaS n'est pas lance : bundle.testData = true, un bandeau le dit ;
   - la liste se reconstruit par innerHTML ; la MODALE vit dans un noeud a part
     (soeur de la liste) : sa transition d'entree ne joue qu'a la PREMIERE
     apparition (classe is-in), jamais sur un re-rendu partiel ;
   - ECRITURE reelle : createClient (client + centre + codes), addClientCenter
     (centre + codes), updateClientStatus (un choix). Les codes ne reviennent
     qu'UNE fois : l'etape "acces crees" les montre en clair, avec avertissement ;
   - JAMAIS de balise <header> (en mode console body.staff-mode header a hauteur
     0). Uniquement div/section. Prefixe de classes propre : fcp-.
   ========================================================================== */
(function () {
  'use strict';

  if (typeof window === 'undefined') return;

  const esc = (value) => {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(value == null ? '' : value);
    if (typeof escapeHtml === 'function') return escapeHtml(value == null ? '' : value);
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  };
  const escJs = (value) => {
    if (typeof window.escapeJsString === 'function') return window.escapeJsString(String(value == null ? '' : value));
    if (typeof escapeJsString === 'function') return escapeJsString(String(value == null ? '' : value));
    return String(value == null ? '' : value).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, ' ');
  };

  // Etat hors DOM : survit aux reconstructions innerHTML.
  const fcp = {
    loaded: false,
    loading: false,
    error: '',
    data: null,
    statusBusy: '',      // id du client dont on change le statut
    billingBusy: '',     // id du client dont on enregistre le prix mensuel
    search: '',          // filtre texte de la grille (nom + identifiant)
    statusFilter: 'all', // filtre statut de la grille
    modal: null,         // null | { mode:'new'|'addCenter', step:'form'|'codes', clientId }
    draft: null,         // fiche en cours de saisie
    result: null,        // { accessCodes, client, center } renvoye par le serveur
    needsReload: false,  // un ecrit a reussi : fermer la modale doit recharger
    saving: false,
    modalError: '',
  };
  window.PinlanePlatformClients = fcp;

  let activeRoot = null;

  function getRoot() {
    if (activeRoot && document.contains(activeRoot)) return activeRoot;
    return document.getElementById('staffCockpitPage');
  }

  function toast(message) {
    if (typeof window.showAlert === 'function') window.showAlert(message);
    else if (typeof showAlert === 'function') showAlert(message);
  }

  const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

  function num(n) {
    const v = Number(n);
    return Number.isFinite(v) ? String(v) : '0';
  }

  // Montant en euros, format fr-BE sans centimes. Les prix et le CA de cette
  // page sont des grandeurs metier : Geist Mono + tabular-nums cote CSS.
  function money(n) {
    const v = Number(n) || 0;
    try {
      return new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);
    } catch (_) {
      return `${Math.round(v)} EUR`;
    }
  }

  // Regle d'HONNETETE du MRR : tant qu'AUCUN prix n'est pose (clientsWithPrice
  // === 0), le MRR n'est pas une mesure -> "a definir", jamais un faux "0 EUR".
  // Des qu'un prix existe, on affiche la somme reelle des clients actifs.
  function mrrView(platform) {
    const p = platform || {};
    const withPrice = Number(p.clientsWithPrice) || 0;
    const clients = (fcp.data && Array.isArray(fcp.data.clients)) ? fcp.data.clients.length : 0;
    const clientCount = Number(p.clientCount != null ? p.clientCount : clients) || 0;
    const honest = withPrice <= 0; // aucun prix pose : le MRR n'est pas une mesure
    return {
      display: honest ? 'a definir' : money(p.mrr),
      hint: `${withPrice}/${clientCount} prix renseignes`,
    };
  }

  // ---- Reseau ---------------------------------------------------------------

  async function load(force = false) {
    if (fcp.loading || (fcp.loaded && !force)) return;
    fcp.loading = true;
    fcp.error = '';
    renderList();
    try {
      const payload = await window.apiRequest('/api/ops?action=platformClients');
      fcp.data = payload || null;
      fcp.loaded = true;
    } catch (error) {
      const status = Number(error && error.status);
      fcp.error = (status === 400 || status === 404)
        ? 'Cette vue n\'est pas encore disponible cote serveur. Elle s\'allumera a la prochaine mise en production.'
        : ((error && error.userMessage) || (error && error.message) || 'Les clients n\'ont pas pu se charger. Rechargez dans un instant.');
    } finally {
      fcp.loading = false;
      render();
    }
  }

  function reload() {
    fcp.loaded = false;
    load(true);
  }

  window.fcpReload = function () { reload(); };

  // ---- Statuts --------------------------------------------------------------

  const STATUS = {
    active: { label: 'actif', tone: 'green' },
    trial: { label: 'essai', tone: 'blue' },
    suspended: { label: 'suspendu', tone: 'amber' },
    churned: { label: 'parti', tone: 'red' },
  };
  const STATUS_ORDER = ['active', 'trial', 'suspended', 'churned'];

  // Les centres portent leur propre statut (actif / en preparation / ferme).
  const CENTER_STATUS = {
    active: { label: 'actif', tone: 'green' },
    planned: { label: 'en preparation', tone: 'amber' },
    closed: { label: 'ferme', tone: 'red' },
  };

  function chip(tone, label) {
    return `<span class="pv2-chip ${tone}">${esc(label)}</span>`;
  }
  function statusChip(status) {
    const s = STATUS[status];
    return s ? chip(s.tone, s.label) : (status ? chip('', String(status)) : '');
  }
  function centerStatusChip(status) {
    const s = CENTER_STATUS[status] || STATUS[status];
    return s ? chip(s.tone, s.label) : (status ? chip('', String(status)) : '');
  }

  function findClient(id) {
    const list = (fcp.data && Array.isArray(fcp.data.clients)) ? fcp.data.clients : [];
    return list.find((c) => c && c.id === id) || null;
  }

  // Retrouve un centre PARTOUT ou la page le montre : dans les cartes clients
  // et dans le bloc "Centres sans client". Renvoie { center, client|null }.
  function findAnyCenter(centerId) {
    const d = fcp.data || {};
    const clients = Array.isArray(d.clients) ? d.clients : [];
    for (const c of clients) {
      const hit = (Array.isArray(c.centers) ? c.centers : []).find((x) => x && x.id === centerId);
      if (hit) return { center: hit, client: c };
    }
    const orphan = (Array.isArray(d.orphanCenters) ? d.orphanCenters : []).find((x) => x && x.id === centerId);
    return orphan ? { center: orphan, client: null } : null;
  }

  // ---- Rendu : liste --------------------------------------------------------

  function testDataBanner() {
    return `<aside class="fck-testdata" role="note">
        Donnees de TEST : le SaaS n'est pas lance. Ces clients viennent des essais internes,
        aucun n'est un vrai client payant.
      </aside>`;
  }

  function metaLine(client) {
    const parts = [];
    if (client.plan) parts.push(`<span class="fcp-meta-plan">${esc(client.plan)}</span>`);
    if (client.contactEmail) parts.push(`<span>${esc(client.contactEmail)}</span>`);
    if (client.contactPhone) parts.push(`<span>${esc(client.contactPhone)}</span>`);
    if (!parts.length) return '';
    return `<div class="fcp-client-meta">${parts.join('<span class="fcp-sep" aria-hidden="true">·</span>')}</div>`;
  }

  function centerRow(center) {
    const c = center || {};
    const staff = c.staff == null ? '' : `<span class="fcp-center-staff">${esc(num(c.staff))} pers.</span>`;
    // Retirer = action DESTRUCTIVE : ghost teinte danger, et jamais en un clic
    // (fcpDeleteCenter ouvre une modale de confirmation qui NOMME le centre).
    const del = c.id
      ? `<button type="button" class="pv2-btn sm fck-danger-btn fcp-center-del" onclick="fcpDeleteCenter('${escJs(c.id)}')" aria-label="Retirer le centre ${esc(c.name || c.id)}">Retirer</button>`
      : '';
    return `<div class="fcp-center-row">
      <span class="fcp-center-name">${esc(c.name || c.id || '(centre)')}</span>
      <span class="fcp-center-tail">${staff}${centerStatusChip(c.status)}${del}</span>
    </div>`;
  }

  function centersBlock(centers) {
    if (!centers.length) {
      return `<div class="fcp-centers"><p class="pv2-quiet fcp-centers-empty">Aucun centre pour ce client.</p></div>`;
    }
    return `<div class="fcp-centers">
      <div class="fcp-centers-title">Centres</div>
      ${centers.map(centerRow).join('')}
    </div>`;
  }

  // Statut editable en un geste : select du kit fondateur (.fck-status-*),
  // identique cote Centres. Un select tient a toute largeur (contrairement a
  // l'ancien segmente 3 etats qui se chevauchait dans les cartes etroites).
  function statusSelect(client) {
    const busy = fcp.statusBusy === client.id;
    const cur = client.status || '';
    const options = STATUS_ORDER.map((k) => `<option value="${k}" ${cur === k ? 'selected' : ''}>${esc(STATUS[k].label)}</option>`).join('');
    const extra = (cur && !STATUS[cur]) ? `<option value="${esc(cur)}" selected>${esc(cur)}</option>` : '';
    return `<label class="fck-status-pick">
      <span class="fck-status-lab">Statut</span>
      <select class="fck-status-select" ${busy ? 'disabled' : ''} aria-label="Statut du client"
        onchange="fcpSetStatus('${escJs(client.id)}', this.value)">${extra}${options}</select>
    </label>`;
  }

  // Bloc facturation d'une carte : prix mensuel EDITABLE (POST setClientBilling).
  // Le prix vide vaut "a definir" : on n'affiche jamais un faux 0. Le CA 30 j
  // reel du client vit dans la ligne de metriques de la carte (avec centres et
  // effectif), aligne en Geist Mono : ici on ne garde que le CONTROLE editable.
  function billingBlock(client) {
    const c = client || {};
    const id = String(c.id || '');
    const price = c.monthlyPrice;
    const hasPrice = price != null && Number.isFinite(Number(price));
    const priceVal = hasPrice ? String(Number(price)) : '';
    const busy = fcp.billingBusy === id;
    return `<div class="fcp-billing">
      <label class="fcp-billing-lab" for="fcp-price-${esc(id)}">Prix mensuel</label>
      <div class="fcp-billing-edit">
        <input type="number" id="fcp-price-${esc(id)}" class="fcp-price-input" min="0" max="100000" step="1"
          inputmode="numeric" placeholder="a definir" value="${esc(priceVal)}" ${busy ? 'disabled' : ''}
          data-client="${esc(id)}" aria-label="Prix mensuel en euros de ${esc(c.name || id)}">
        <span class="fcp-price-unit">EUR/mois</span>
        <button type="button" class="pv2-btn sm fcp-price-save" ${busy ? 'disabled' : ''} onclick="fcpSaveBilling(this, '${escJs(id)}')">${busy ? '...' : 'Enregistrer'}</button>
      </div>
      ${hasPrice ? '' : '<span class="fcp-hint">Aucun prix pose : ce client ne compte pas dans le MRR.</span>'}
    </div>`;
  }

  function clientCard(client) {
    const c = client || {};
    const id = String(c.id || '');
    const centers = Array.isArray(c.centers) ? c.centers : [];
    const centerCount = Number.isFinite(Number(c.centerCount)) ? Number(c.centerCount) : centers.length;
    const staffCount = Number.isFinite(Number(c.staffCount))
      ? Number(c.staffCount)
      : centers.reduce((sum, x) => sum + (Number(x && x.staff) || 0), 0);
    const rev = c.revenue30d;
    const revText = (rev == null) ? '-' : money(rev);
    // Ligne de metriques scannable : les 3 chiffres qui comptent (CA reel 30 j,
    // nombre de centres, effectif), memes primitives .fca-metric que les cartes
    // Centres pour que les deux pages se lisent pareil, alignes en Geist Mono.
    return `<section class="fck-center-card fcp-client-card">
      <div class="fck-card-head">
        <div><strong>${esc(c.name || id || '(sans nom)')}</strong> <span class="pv2-quiet">· ${esc(id)}</span></div>
        ${statusChip(c.status)}
      </div>
      ${metaLine(c)}
      <div class="fca-metrics">
        <div class="fca-metric"><span class="fca-metric-num">${esc(revText)}</span><span class="fca-metric-cap">CA 30 j</span></div>
        <div class="fca-metric"><span class="fca-metric-num">${esc(num(centerCount))}</span><span class="fca-metric-cap">centre${centerCount > 1 ? 's' : ''}</span></div>
        <div class="fca-metric"><span class="fca-metric-num">${esc(num(staffCount))}</span><span class="fca-metric-cap">effectif</span></div>
      </div>
      ${billingBlock(c)}
      ${centersBlock(centers)}
      <div class="fck-card-foot">
        ${statusSelect(c)}
        <button type="button" class="pv2-btn fck-danger-btn" onclick="fcpDeleteClient('${escJs(id)}')">Supprimer le client</button>
        <button type="button" class="pv2-btn" onclick="fcpAddCenter('${escJs(id)}')">Ajouter un centre</button>
      </div>
    </section>`;
  }

  function orphansBlock() {
    const orphans = (fcp.data && Array.isArray(fcp.data.orphanCenters)) ? fcp.data.orphanCenters : [];
    if (!orphans.length) return '';
    return `<section class="pv2-panel fcp-orphans">
      <div class="pv2-panel-head has-sub">
        <div>
          <h2>Centres sans client</h2>
          <p class="pv2-panel-sub">Centres provisionnes mais pas encore rattaches a une entreprise cliente.</p>
        </div>
      </div>
      <div class="pv2-panel-body">
        <div class="fcp-centers">${orphans.map(centerRow).join('')}</div>
      </div>
    </section>`;
  }

  // En-tete KPI plateforme : MRR (regle d'honnetete), clients/centres actifs,
  // CA 30 j agrege. Tout vient de platformClients.platform ; on n'invente rien.
  // Reutilise la ligne KPI du kit fondateur (.fck-stats.fck-biz-stats > .fck-stat)
  // exactement comme le Cockpit refondu : meme grille cadree, memes chiffres en
  // Geist Mono tabulaires. On garde les hooks du gate (data-kpi, .fcp-kpi-num,
  // .fcp-kpi-hint) en double-classe sur les spans.
  function kpiHtml() {
    const p = fcp.data && fcp.data.platform;
    if (!p) return '';
    const mrr = mrrView(p);
    const cells = [
      { kpi: 'mrr', cap: 'MRR', num: mrr.display, hint: mrr.hint },
      { kpi: 'clients', cap: 'Clients actifs', num: num(p.activeClients) },
      { kpi: 'centers', cap: 'Centres actifs', num: num(p.activeCenters) },
      { kpi: 'ca', cap: 'CA 30 j', num: money(p.revenue30dAll) },
    ];
    const stats = cells.map((c) => `<div class="fck-stat" data-kpi="${esc(c.kpi)}">
        <span class="fck-stat-cap">${esc(c.cap)}</span>
        <span class="fck-stat-num fcp-kpi-num">${esc(c.num)}</span>
        ${c.hint ? `<span class="fck-stat-hint fcp-kpi-hint">${esc(c.hint)}</span>` : ''}
      </div>`).join('');
    return `<section class="pv2-panel" data-fcp-panel="kpis">
      <div class="pv2-panel-head has-sub">
        <div>
          <h2>Activite plateforme</h2>
          <p class="pv2-panel-sub">Clients, MRR et CA a l'echelle du SaaS. Le MRR reste "a definir" tant qu'aucun prix n'est pose.</p>
        </div>
      </div>
      <div class="pv2-panel-body">
        <div class="fck-stats fck-biz-stats">${stats}</div>
      </div>
    </section>`;
  }

  function filteredClients() {
    const d = fcp.data || {};
    const clients = Array.isArray(d.clients) ? d.clients : [];
    const q = (fcp.search || '').trim().toLowerCase();
    const sf = fcp.statusFilter || 'all';
    return clients.filter((c) => {
      if (!c) return false;
      if (sf !== 'all' && String(c.status || '') !== sf) return false;
      if (q) {
        const hay = `${c.name || ''} ${c.id || ''}`.toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function filterBar() {
    const d = fcp.data || {};
    const total = Array.isArray(d.clients) ? d.clients.length : 0;
    if (!total) return '';
    const sf = fcp.statusFilter || 'all';
    const opts = [['all', 'Tous les statuts']].concat(STATUS_ORDER.map((k) => [k, STATUS[k].label]))
      .map(([v, l]) => `<option value="${esc(v)}" ${sf === v ? 'selected' : ''}>${esc(l)}</option>`).join('');
    return `<div class="fck-filterbar" data-fcp-panel="filter">
      <input type="search" class="pv2-input fck-filter-search fcp-search" placeholder="Rechercher un client (nom ou identifiant)"
        value="${esc(fcp.search || '')}" aria-label="Rechercher un client" oninput="fcpSetSearch(this.value)">
      <select class="pv2-input fck-filter-select fcp-status-filter" aria-label="Filtrer par statut" onchange="fcpSetStatusFilter(this.value)">${opts}</select>
    </div>`;
  }

  function gridHtml() {
    const d = fcp.data || {};
    const total = Array.isArray(d.clients) ? d.clients.length : 0;
    const clients = filteredClients();
    if (clients.length) {
      return `<div class="fck-center-grid fcp-client-grid">${clients.map(clientCard).join('')}</div>`;
    }
    if (total) {
      return `<section class="pv2-panel"><div style="padding:16px"><p class="pv2-quiet">Aucun client ne correspond a la recherche.</p></div></section>`;
    }
    if (fcp.loaded && !fcp.error) {
      return `<section class="pv2-panel"><div style="padding:16px"><p class="pv2-quiet">Aucun client enregistre pour le moment. Cree le premier avec "Nouveau client".</p></div></section>`;
    }
    return '';
  }

  function listHtml() {
    const d = fcp.data || {};
    return `<div class="pv2-shell fck-shell fcp-shell">
      <section class="pv2-bar">
        <div>
          <div class="pv2-bar-crumb"><span class="pv2-live"></span>Plateforme</div>
          <h1>Clients Pinlane</h1>
          <p class="pv2-bar-sub">Les entreprises qui achetent Pinlane : provisionnement cle en main, centres, acces, statut.</p>
        </div>
        <div class="pv2-bar-actions">
          <button type="button" class="pv2-btn ghost" onclick="fcpReload()">Actualiser</button>
          <button type="button" class="pv2-btn primary" onclick="fcpOpenNew()">Nouveau client</button>
        </div>
      </section>

      ${kpiHtml()}
      ${d.testData ? testDataBanner() : ''}

      ${fcp.error ? `<section class="pv2-panel"><div style="padding:16px"><p class="pv2-quiet">${esc(fcp.error)}</p>
        <button type="button" class="pv2-btn" onclick="fcpReload()">Reessayer</button></div></section>` : ''}

      ${fcp.loading && !fcp.data ? `<section class="pv2-panel"><div style="padding:16px"><p class="pv2-quiet">Chargement des clients...</p></div></section>` : ''}

      ${filterBar()}
      <div id="fcpGrid">${gridHtml()}</div>
      ${orphansBlock()}
    </div>`;
  }

  // Filtres : re-rend UNIQUEMENT la grille (#fcpGrid), pas toute la page. La
  // barre de filtre reste dans le DOM -> le champ de recherche garde le focus
  // et le curseur pendant la frappe.
  function renderGridOnly() {
    const root = getRoot();
    const host = root && root.querySelector('#fcpGrid');
    if (host) host.innerHTML = gridHtml();
  }
  window.fcpSetSearch = function (value) { fcp.search = value == null ? '' : String(value); renderGridOnly(); };
  window.fcpSetStatusFilter = function (value) { fcp.statusFilter = value || 'all'; renderGridOnly(); };

  // Edition du prix mensuel d'un client : lit le champ de la carte, borne, puis
  // POST setClientBilling (meme helper apiRequest que createClient) et recharge.
  window.fcpSaveBilling = function (btn, clientId) {
    const wrap = btn && btn.closest ? btn.closest('.fcp-billing') : null;
    const input = wrap ? wrap.querySelector('.fcp-price-input') : null;
    saveClientBilling(clientId, input ? input.value : '');
  };

  async function saveClientBilling(clientId, raw) {
    if (fcp.billingBusy) return;
    const client = findClient(clientId);
    if (!client) { toast('Client introuvable. Actualise la liste.'); return; }
    const value = String(raw == null ? '' : raw).trim();
    let monthlyPrice;
    if (value === '') {
      monthlyPrice = null; // vide : efface le prix, retour a "a definir"
    } else {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0 || n > 100000) {
        toast('Prix invalide : un nombre entre 0 et 100000, ou vide pour effacer.');
        return;
      }
      monthlyPrice = n;
    }
    fcp.billingBusy = clientId;
    renderGridOnly();
    try {
      await window.apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'setClientBilling', clientId, monthlyPrice }),
      });
      toast('Prix mis a jour.');
      fcp.billingBusy = '';
      reload();
    } catch (error) {
      fcp.billingBusy = '';
      toast((error && error.userMessage) || (error && error.message) || 'Le prix n\'a pas ete enregistre.');
      renderGridOnly();
    }
  }

  function renderList() {
    const root = getRoot();
    if (!root) return;
    let page = root.querySelector('#fcpPage');
    if (!page) {
      // Premier montage : on ne pose QUE le conteneur de liste, jamais la modale.
      root.innerHTML = '<div id="fcpPage"></div>';
      page = root.querySelector('#fcpPage');
    }
    if (!fcp.loaded && !fcp.loading && !fcp.error) setTimeout(() => load(), 0);
    page.innerHTML = listHtml();
  }

  function render() {
    renderList();
    syncModal();
  }

  // ---- Modale : cycle de vie ------------------------------------------------

  function modalHeadContent() {
    let title = 'Client';
    let sub = '';
    if (fcp.modal) {
      if (fcp.modal.step === 'confirm') {
        if (fcp.modal.mode === 'deleteClient') {
          const cl = findClient(fcp.modal.clientId) || {};
          title = 'Supprimer le client';
          sub = `${esc(cl.name || fcp.modal.clientId || '')} · action definitive.`;
        } else {
          const hit = findAnyCenter(fcp.modal.centerId);
          const name = hit && hit.center ? (hit.center.name || hit.center.id) : fcp.modal.centerId;
          title = 'Retirer le centre';
          sub = `${esc(name || '')} · action definitive.`;
        }
      } else if (fcp.modal.step === 'codes') {
        title = 'Acces crees';
        sub = 'Copie ces codes maintenant. Ils ne seront plus jamais affiches.';
      } else if (fcp.modal.mode === 'new') {
        title = 'Nouveau client';
        sub = 'Cree l\'entreprise, son premier centre et ses acces (Direction, Staff).';
      } else {
        const cl = findClient(fcp.modal.clientId) || {};
        title = 'Ajouter un centre';
        sub = `Nouveau centre pour ${esc(cl.name || fcp.modal.clientId || 'ce client')}. Ses codes seront generes.`;
      }
    }
    const lockClose = fcp.saving;
    return `<div><h2 id="fcpModalTitle">${esc(title)}</h2><p>${sub}</p></div>
      <button type="button" class="fcp-close" aria-label="Fermer" ${lockClose ? 'disabled' : ''} onclick="fcpCloseModal()">&times;</button>`;
  }

  function modalPanelHtml() {
    return `<div class="fcp-panel" role="dialog" aria-modal="true" aria-labelledby="fcpModalTitle">
      <div class="fcp-modal-head">${modalHeadContent()}</div>
      <div class="fcp-modal-body">${modalBodyHtml()}</div>
      <div class="fcp-modal-foot">${modalFootHtml()}</div>
    </div>`;
  }

  function syncModal() {
    const root = getRoot();
    if (!root) return;
    const existing = root.querySelector('.fcp-overlay');
    if (!fcp.modal) { if (existing) existing.remove(); return; }
    if (existing) return; // deja monte : head/corps/pied se rafraichissent sur place

    const overlay = document.createElement('div');
    overlay.className = 'fcp-overlay';
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay && !fcp.saving) closeModal();
    });
    overlay.innerHTML = modalPanelHtml();
    root.appendChild(overlay);
    // Garde de premiere apparition : l'animation d'entree ne joue qu'ici.
    overlay.classList.add('is-in');
    requestAnimationFrame(() => {
      const f = overlay.querySelector('[data-autofocus]');
      if (f) { try { f.focus(); } catch (_) { /* focus best effort */ } }
    });
  }

  function refreshHead() {
    const root = getRoot();
    const head = root && root.querySelector('.fcp-modal-head');
    if (head) head.innerHTML = modalHeadContent();
  }
  function refreshBody() {
    const root = getRoot();
    const body = root && root.querySelector('.fcp-modal-body');
    if (!body) return;
    const st = body.scrollTop;
    body.innerHTML = modalBodyHtml();
    body.scrollTop = st;
  }
  function refreshFoot() {
    const root = getRoot();
    const foot = root && root.querySelector('.fcp-modal-foot');
    if (foot) foot.innerHTML = modalFootHtml();
    const closeBtn = root && root.querySelector('.fcp-close');
    if (closeBtn) closeBtn.disabled = fcp.saving;
  }

  function closeModal() {
    const shouldReload = fcp.needsReload;
    fcp.modal = null;
    fcp.draft = null;
    fcp.result = null;
    fcp.needsReload = false;
    fcp.saving = false;
    fcp.modalError = '';
    const root = getRoot();
    const overlay = root && root.querySelector('.fcp-overlay');
    if (overlay) overlay.remove();
    if (shouldReload) reload();
  }
  window.fcpCloseModal = function () { if (!fcp.saving) closeModal(); };

  // ---- Modale : corps -------------------------------------------------------

  function field(label, path, value, opts) {
    const o = opts || {};
    const attrs = [];
    if (o.placeholder) attrs.push(`placeholder="${esc(o.placeholder)}"`);
    if (o.pattern) attrs.push(`pattern="${esc(o.pattern)}"`);
    if (o.type) attrs.push(`type="${esc(o.type)}"`); else attrs.push('type="text"');
    if (o.autofocus) attrs.push('data-autofocus');
    if (o.autocomplete) attrs.push(`autocomplete="${esc(o.autocomplete)}"`);
    return `<div class="fcp-field ${o.span2 ? 'fcp-span2' : ''}">
      <label>${esc(label)}</label>
      <input ${attrs.join(' ')} value="${esc(value == null ? '' : value)}" oninput="fcpSet('${escJs(path)}', this.value)">
      ${o.hint ? `<span class="fcp-hint">${esc(o.hint)}</span>` : ''}
    </div>`;
  }

  function centerSection(center) {
    const c = center || {};
    return `<div class="fcp-section">
      <div class="fcp-section-title">Premier centre</div>
      <div class="fcp-fields">
        ${field('Identifiant du centre (slug)', 'center.id', c.id, { placeholder: 'fun-galaxy-namur', pattern: SLUG_RE.source, hint: 'Minuscules, chiffres et tirets simples.', span2: true })}
        ${field('Nom du centre', 'center.name', c.name, { placeholder: 'Fun Galaxy Namur', span2: true })}
      </div>
    </div>`;
  }

  function newClientBody() {
    const d = fcp.draft || {};
    const statusOptions = STATUS_ORDER.map((k) => `<option value="${k}" ${(d.status || 'trial') === k ? 'selected' : ''}>${esc(STATUS[k].label)}</option>`).join('');
    return `${fcp.modalError ? `<div class="fcp-modal-error" role="alert">${esc(fcp.modalError)}</div>` : ''}
      <div class="fcp-section">
        <div class="fcp-section-title">Entreprise cliente</div>
        <div class="fcp-fields">
          ${field('Identifiant (slug)', 'id', d.id, { placeholder: 'fun-galaxy', pattern: SLUG_RE.source, hint: 'Definitif : il identifie le client partout.', autofocus: true, span2: true })}
          ${field('Raison sociale', 'name', d.name, { placeholder: 'Fun Galaxy SRL', span2: true })}
          <div class="fcp-field">
            <label>Statut</label>
            <select onchange="fcpSet('status', this.value)">${statusOptions}</select>
          </div>
          ${field('Plan', 'plan', d.plan, { placeholder: 'Standard' })}
          ${field('Email de contact', 'contactEmail', d.contactEmail, { type: 'email', placeholder: 'contact@fun-galaxy.be', autocomplete: 'off' })}
          ${field('Telephone', 'contactPhone', d.contactPhone, { type: 'tel', placeholder: '+32 ...', autocomplete: 'off' })}
        </div>
      </div>
      ${centerSection(d.center)}`;
  }

  function addCenterBody() {
    const d = fcp.draft || {};
    const c = d.center || {};
    return `${fcp.modalError ? `<div class="fcp-modal-error" role="alert">${esc(fcp.modalError)}</div>` : ''}
      <div class="fcp-section">
        <div class="fcp-section-title">Nouveau centre</div>
        <div class="fcp-fields">
          ${field('Identifiant du centre (slug)', 'center.id', c.id, { placeholder: 'fun-galaxy-liege', pattern: SLUG_RE.source, hint: 'Minuscules, chiffres et tirets simples.', autofocus: true, span2: true })}
          ${field('Nom du centre', 'center.name', c.name, { placeholder: 'Fun Galaxy Liege', span2: true })}
        </div>
      </div>`;
  }

  function codeRow(entry) {
    const c = entry || {};
    const role = c.role ? String(c.role) : '';
    const isDir = role.toLowerCase() === 'direction';
    const code = c.code ? String(c.code) : '';
    const tag = isDir ? '<span class="fcp-code-tag">a remettre au client</span>' : '';
    const copyBtn = code
      ? `<button type="button" class="pv2-btn fcp-code-copy" data-code="${esc(code)}" onclick="fcpCopyCode(this)">Copier</button>`
      : '';
    const value = code ? esc(code) : '<span class="fcp-code-missing">code non genere</span>';
    return `<div class="fcp-code-row ${isDir ? 'is-primary' : ''}">
      <div class="fcp-code-main">
        <span class="fcp-code-role">${esc(role || 'Acces')}${tag}</span>
        <span class="fcp-code-value">${value}</span>
      </div>
      ${copyBtn}
    </div>`;
  }

  function codesBody() {
    const res = fcp.result || {};
    const codes = Array.isArray(res.accessCodes) ? res.accessCodes : [];
    // Direction en premier : c'est le code que le proprietaire remet au client.
    const sorted = codes.slice().sort((a, b) => {
      const ra = a && String(a.role || '').toLowerCase() === 'direction' ? 0 : 1;
      const rb = b && String(b.role || '').toLowerCase() === 'direction' ? 0 : 1;
      return ra - rb;
    });
    const rows = sorted.length ? sorted.map(codeRow).join('') : '<p class="pv2-quiet">Aucun code renvoye par le serveur.</p>';
    return `<div class="fcp-codes-warn" role="alert">
        <strong>Copie ces codes maintenant, ils ne seront plus affiches.</strong>
        Remets le code Direction au client : il se connecte avec, cote Etablissement.
      </div>
      <div class="fcp-codes">${rows}</div>`;
  }

  // ---- Modale : confirmation de suppression ---------------------------------
  // Une suppression NOMME ce qu'elle detruit avant d'agir : le client (et
  // pourquoi elle serait bloquee), ou le centre (et ce qui part avec lui).
  // La politique serveur est repetee ici pour que la confirmation soit honnete :
  // client avec centres = BLOQUE, centre avec reservations = REFUSE, centre
  // baseline (fichier) = REFUSE.

  function deleteClientBody() {
    const cl = findClient(fcp.modal.clientId) || {};
    const centers = Array.isArray(cl.centers) ? cl.centers : [];
    const n = Number.isFinite(Number(cl.centerCount)) ? Number(cl.centerCount) : centers.length;
    const label = `<strong>${esc(cl.name || fcp.modal.clientId || '')}</strong> <span class="pv2-quiet">· ${esc(cl.id || fcp.modal.clientId || '')}</span>`;
    if (n > 0) {
      const names = centers.map((x) => x && (x.name || x.id)).filter(Boolean).map((x) => esc(x)).join(', ');
      return `${fcp.modalError ? `<div class="fcp-modal-error" role="alert">${esc(fcp.modalError)}</div>` : ''}
        <div class="fck-confirm-warn" role="alert">
          ${label} possede encore <strong>${esc(num(n))} centre${n > 1 ? 's' : ''}</strong>${names ? ` (${names})` : ''} :
          la suppression est <strong>bloquee</strong>. Retire d'abord chacun de ses centres
          (bouton Retirer sur la carte), puis supprime le client.
        </div>`;
    }
    return `${fcp.modalError ? `<div class="fcp-modal-error" role="alert">${esc(fcp.modalError)}</div>` : ''}
      <div class="fck-confirm-warn" role="alert">
        Le client ${label} sera supprime definitivement de la plateforme.
        Aucun centre ne lui est rattache : seule sa fiche (statut, plan, contact, prix mensuel) disparait.
        <span class="fck-confirm-irrev">Cette action est irreversible.</span>
      </div>`;
  }

  function deleteCenterBody() {
    const hit = findAnyCenter(fcp.modal.centerId);
    const c = (hit && hit.center) || { id: fcp.modal.centerId };
    const owner = hit && hit.client ? `${esc(hit.client.name || hit.client.id)}` : '';
    const staff = Number(c.staff) || 0;
    const label = `<strong>${esc(c.name || c.id || '')}</strong> <span class="pv2-quiet">· ${esc(c.id || '')}</span>`;
    return `${fcp.modalError ? `<div class="fcp-modal-error" role="alert">${esc(fcp.modalError)}</div>` : ''}
      <div class="fck-confirm-warn" role="alert">
        Le centre ${label}${owner ? ` (client ${owner})` : ''} sera supprime definitivement,
        avec ses roles et acces staff${staff > 0 ? ` (<strong>${esc(num(staff))} personne${staff > 1 ? 's' : ''}</strong> perdront leur acces)` : ''}
        et ses journaux techniques.
        S'il porte des reservations, le serveur <strong>refusera</strong> plutot que de les effacer.
        Un centre de base du fichier (socle Fun Galaxy) n'est pas supprimable ici.
        <span class="fck-confirm-irrev">Cette action est irreversible.</span>
      </div>`;
  }

  function modalBodyHtml() {
    if (!fcp.modal) return '';
    if (fcp.modal.step === 'confirm') {
      return fcp.modal.mode === 'deleteClient' ? deleteClientBody() : deleteCenterBody();
    }
    if (fcp.modal.step === 'codes') return codesBody();
    return fcp.modal.mode === 'new' ? newClientBody() : addCenterBody();
  }

  function modalFootHtml() {
    if (!fcp.modal) return '';
    if (fcp.modal.step === 'confirm') {
      const saving = fcp.saving;
      // Client encore porteur de centres : la politique serveur BLOQUE ; la
      // modale ne propose donc aucun bouton destructif, seulement Fermer.
      if (fcp.modal.mode === 'deleteClient') {
        const cl = findClient(fcp.modal.clientId) || {};
        const n = Number.isFinite(Number(cl.centerCount)) ? Number(cl.centerCount) : (Array.isArray(cl.centers) ? cl.centers.length : 0);
        if (n > 0) {
          return `<button type="button" class="pv2-btn" onclick="fcpCloseModal()">Fermer</button>`;
        }
      }
      const label = fcp.modal.mode === 'deleteClient' ? 'Supprimer definitivement' : 'Retirer definitivement';
      return `<button type="button" class="pv2-btn ghost" ${saving ? 'disabled' : ''} onclick="fcpCloseModal()">Annuler</button>
        <button type="button" class="pv2-btn fck-confirm-danger" ${saving ? 'disabled' : ''} onclick="fcpConfirmDelete()">${saving ? 'Suppression...' : label}</button>`;
    }
    if (fcp.modal.step === 'codes') {
      return `<span class="fcp-foot-note">Un centre, ses roles et ses codes ont ete crees.</span>
        <button type="button" class="pv2-btn primary" onclick="fcpCloseModal()">Fermer</button>`;
    }
    const saving = fcp.saving;
    const isNew = fcp.modal.mode === 'new';
    const primaryLabel = isNew
      ? (saving ? 'Creation...' : 'Enregistrer')
      : (saving ? 'Ajout...' : 'Ajouter le centre');
    return `<button type="button" class="pv2-btn ghost" ${saving ? 'disabled' : ''} onclick="fcpCloseModal()">Annuler</button>
      <button type="button" class="pv2-btn primary" ${saving ? 'disabled' : ''} onclick="fcpSave()">${primaryLabel}</button>`;
  }

  // ---- Ouverture / edition ---------------------------------------------------

  window.fcpOpenNew = function () {
    fcp.draft = { id: '', name: '', status: 'trial', plan: '', contactEmail: '', contactPhone: '', center: { id: '', name: '' } };
    fcp.result = null;
    fcp.needsReload = false;
    fcp.modalError = '';
    fcp.saving = false;
    fcp.modal = { mode: 'new', step: 'form', clientId: null };
    syncModal();
  };

  window.fcpAddCenter = function (clientId) {
    const client = findClient(clientId);
    if (!client) { toast('Client introuvable. Actualise la liste.'); return; }
    fcp.draft = { center: { id: '', name: '' } };
    fcp.result = null;
    fcp.needsReload = false;
    fcp.modalError = '';
    fcp.saving = false;
    fcp.modal = { mode: 'addCenter', step: 'form', clientId: client.id };
    syncModal();
  };

  // ---- Suppression (confirmation obligatoire, jamais en un clic) ------------

  window.fcpDeleteClient = function (clientId) {
    const client = findClient(clientId);
    if (!client) { toast('Client introuvable. Actualise la liste.'); return; }
    fcp.draft = null;
    fcp.result = null;
    fcp.needsReload = false;
    fcp.modalError = '';
    fcp.saving = false;
    fcp.modal = { mode: 'deleteClient', step: 'confirm', clientId: client.id };
    syncModal();
  };

  window.fcpDeleteCenter = function (centerId) {
    const hit = findAnyCenter(centerId);
    if (!hit) { toast('Centre introuvable. Actualise la liste.'); return; }
    fcp.draft = null;
    fcp.result = null;
    fcp.needsReload = false;
    fcp.modalError = '';
    fcp.saving = false;
    fcp.modal = { mode: 'deleteCenter', step: 'confirm', centerId: hit.center.id };
    syncModal();
  };

  window.fcpConfirmDelete = async function () {
    if (!fcp.modal || fcp.modal.step !== 'confirm' || fcp.saving) return;
    const isClient = fcp.modal.mode === 'deleteClient';
    const body = isClient
      ? { action: 'deleteClient', id: fcp.modal.clientId }
      : { action: 'deleteCenter', id: fcp.modal.centerId };
    fcp.saving = true;
    fcp.modalError = '';
    refreshFoot();
    try {
      await window.apiRequest('/api/ops', { method: 'POST', body: JSON.stringify(body) });
      fcp.saving = false;
      fcp.needsReload = true; // closeModal recharge la liste (compteurs inclus)
      toast(isClient ? 'Client supprime.' : 'Centre retire.');
      closeModal();
    } catch (error) {
      // Refus serveur (baseline, reservations, centres restants...) : le
      // message expose s'affiche DANS la modale, rien n'a ete supprime.
      fcp.saving = false;
      fcp.modalError = (error && error.userMessage) || (error && error.message) || 'Suppression refusee. Reessaye.';
      refreshBody();
      refreshFoot();
    }
  };

  window.fcpSet = function (path, value) {
    if (!fcp.draft) return;
    const parts = String(path).split('.');
    let node = fcp.draft;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const k = parts[i];
      if (node[k] == null || typeof node[k] !== 'object') node[k] = {};
      node = node[k];
    }
    node[parts[parts.length - 1]] = value;
  };

  // ---- Ecriture --------------------------------------------------------------

  function trimmed(v) { return String(v == null ? '' : v).trim(); }

  async function saveNewClient() {
    const d = fcp.draft || {};
    const id = trimmed(d.id);
    const name = trimmed(d.name);
    const center = d.center || {};
    const centerId = trimmed(center.id);
    const centerName = trimmed(center.name);

    if (!SLUG_RE.test(id)) {
      fcp.modalError = 'Identifiant client invalide : minuscules, chiffres et tirets simples (ex. fun-galaxy).';
      refreshBody(); return;
    }
    if (!name) { fcp.modalError = 'La raison sociale est requise.'; refreshBody(); return; }
    if (findClient(id)) { fcp.modalError = 'Cet identifiant client existe deja.'; refreshBody(); return; }
    if (!SLUG_RE.test(centerId)) {
      fcp.modalError = 'Identifiant du centre invalide : minuscules, chiffres et tirets simples (ex. fun-galaxy-namur).';
      refreshBody(); return;
    }

    const body = {
      action: 'createClient',
      id,
      name,
      status: d.status || 'trial',
      center: centerName ? { id: centerId, name: centerName } : { id: centerId },
    };
    if (trimmed(d.plan)) body.plan = trimmed(d.plan);
    if (trimmed(d.contactEmail)) body.contactEmail = trimmed(d.contactEmail);
    if (trimmed(d.contactPhone)) body.contactPhone = trimmed(d.contactPhone);

    fcp.saving = true;
    fcp.modalError = '';
    refreshFoot();
    try {
      const payload = await window.apiRequest('/api/ops', { method: 'POST', body: JSON.stringify(body) });
      fcp.result = {
        accessCodes: (payload && Array.isArray(payload.accessCodes)) ? payload.accessCodes : [],
        client: payload && payload.client,
        center: payload && payload.center,
      };
      fcp.needsReload = true;
      fcp.saving = false;
      fcp.modal.step = 'codes';
      refreshHead(); refreshBody(); refreshFoot();
      toast('Client cree.');
    } catch (error) {
      fcp.saving = false;
      fcp.modalError = (error && error.userMessage) || (error && error.message) || 'Creation refusee. Reessaye.';
      refreshBody(); refreshFoot();
    }
  }

  async function saveAddCenter() {
    const d = fcp.draft || {};
    const center = d.center || {};
    const centerId = trimmed(center.id);
    const centerName = trimmed(center.name);
    if (!SLUG_RE.test(centerId)) {
      fcp.modalError = 'Identifiant du centre invalide : minuscules, chiffres et tirets simples (ex. fun-galaxy-liege).';
      refreshBody(); return;
    }
    const body = {
      action: 'addClientCenter',
      clientId: fcp.modal.clientId,
      center: centerName ? { id: centerId, name: centerName } : { id: centerId },
    };
    fcp.saving = true;
    fcp.modalError = '';
    refreshFoot();
    try {
      const payload = await window.apiRequest('/api/ops', { method: 'POST', body: JSON.stringify(body) });
      fcp.result = {
        accessCodes: (payload && Array.isArray(payload.accessCodes)) ? payload.accessCodes : [],
        client: payload && payload.client,
        center: payload && payload.center,
      };
      fcp.needsReload = true;
      fcp.saving = false;
      fcp.modal.step = 'codes';
      refreshHead(); refreshBody(); refreshFoot();
      toast('Centre ajoute.');
    } catch (error) {
      fcp.saving = false;
      fcp.modalError = (error && error.userMessage) || (error && error.message) || 'Ajout refuse. Reessaye.';
      refreshBody(); refreshFoot();
    }
  }

  window.fcpSave = function () {
    if (fcp.saving || !fcp.modal || fcp.modal.step !== 'form') return;
    if (fcp.modal.mode === 'new') saveNewClient();
    else saveAddCenter();
  };

  window.fcpSetStatus = async function (clientId, status) {
    if (fcp.statusBusy) return;
    const client = findClient(clientId);
    if (!client || client.status === status || !STATUS[status]) return;
    const previous = client.status;
    fcp.statusBusy = clientId;
    client.status = status; // optimiste
    renderList();
    try {
      await window.apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'updateClientStatus', id: clientId, status }),
      });
      toast('Statut mis a jour.');
    } catch (error) {
      client.status = previous; // rollback
      toast((error && error.userMessage) || (error && error.message) || 'Le statut n\'a pas ete change.');
    } finally {
      fcp.statusBusy = '';
      renderList();
    }
  };

  // ---- Copie de code ---------------------------------------------------------

  window.fcpCopyCode = function (btn) {
    if (!btn || !btn.getAttribute) return;
    const code = btn.getAttribute('data-code') || '';
    if (!code) return;
    const restore = btn.getAttribute('data-restore') || btn.textContent || 'Copier';
    const flash = () => {
      btn.setAttribute('data-restore', restore);
      btn.textContent = 'Copie';
      btn.classList.add('is-copied');
      setTimeout(() => { btn.textContent = restore; btn.classList.remove('is-copied'); }, 1200);
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(flash).catch(() => legacyCopy(code, flash));
        return;
      }
    } catch (_) { /* tombe sur le repli */ }
    legacyCopy(code, flash);
  };

  function legacyCopy(text, done) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'absolute';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      if (typeof done === 'function') done();
    } catch (_) { /* copie indisponible : sans bruit */ }
  }

  // Echap ferme la modale (une seule liaison, meme si le script est recharge).
  if (!window.__fcpKeydownBound) {
    window.__fcpKeydownBound = true;
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && fcp.modal && !fcp.saving) {
        e.preventDefault();
        closeModal();
      }
    });
  }

  // ---- Point d'entree public ------------------------------------------------

  window.renderPlatformClientsPage = function (root) {
    if (root && root.nodeType === 1) activeRoot = root;
    render();
  };
})();

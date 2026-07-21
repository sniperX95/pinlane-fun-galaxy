/* ============================================================================
   FRONT-CENTRES : CATEGORIE PLATEFORME (permission platform.admin)
   ----------------------------------------------------------------------------
   Surface phare du panneau fondateur : gerer TOUS les centres (tous clients)
   sans code, facon Shopify. Rendue dans #staffCockpitPage (meme hote que
   founder-cockpit.js), via window.renderFounderCentresPage(root).

   Doctrine identique au reste de la console :
   - style Vercel NEUTRE : monochrome sauf le SENS (vert = actif, ambre = en
     preparation, rouge = ferme), un seul bouton primaire, filets 1px, on
     reutilise les primitives pv2- et fck- ;
   - chaque grandeur vient du bundle serveur (founderCenters) ; robuste aux
     champs absents (config partielle, resources null) ;
   - le SaaS n'est pas lance : bundle.testData = true, et un bandeau le dit ;
   - la liste se reconstruit par innerHTML ; la MODALE vit dans un noeud a part
     (soeur de la liste) : sa transition d'entree ne joue qu'a la premiere
     apparition, jamais sur un re-rendu de la liste ou du corps ;
   - ECRITURE reelle et tracee : saveCenterConfig (patch partiel), setCenterStatus
     (un clic), saveCenter (nouveau centre). Inter-centres autorise cote serveur ;
   - JAMAIS de balise <header> : en mode console `body.staff-mode header` ecrase
     tout <header> a hauteur 0. Uniquement div/section.
   ========================================================================== */
(function () {
  'use strict';

  if (typeof window === 'undefined') return;

  const esc = (value) => (typeof escapeHtml === 'function' ? escapeHtml(value ?? '') : String(value ?? ''));
  const escJs = (value) => (typeof escapeJsString === 'function' ? escapeJsString(String(value ?? '')) : String(value ?? '').replace(/['"\\]/g, ''));

  // Etat hors DOM : survit aux reconstructions innerHTML.
  const fca = {
    loaded: false,
    loading: false,
    error: '',
    data: null,
    statusBusy: '',      // id du centre dont on change le statut (un clic)
    modal: null,         // null | { mode:'config'|'new', centerId }
    original: null,      // snapshot config a l'ouverture (pour le diff)
    draft: null,         // config en cours d'edition (ou fiche du nouveau centre)
    saving: false,
    modalError: '',
  };
  window.PinlaneFounderCentres = fca;

  let activeRoot = null;

  function getRoot() {
    if (activeRoot && document.contains(activeRoot)) return activeRoot;
    return document.getElementById('staffCockpitPage');
  }

  function toast(message) {
    if (typeof showAlert === 'function') showAlert(message);
  }

  // ---- Reseau ---------------------------------------------------------------

  async function load(force = false) {
    if (fca.loading || (fca.loaded && !force)) return;
    fca.loading = true;
    fca.error = '';
    renderList();
    try {
      const payload = await window.apiRequest('/api/ops?action=founderCenters');
      fca.data = payload || null;
      fca.loaded = true;
    } catch (error) {
      const status = Number(error && error.status);
      fca.error = (status === 400 || status === 404)
        ? 'Cette vue n\'est pas encore disponible cote serveur. Elle s\'allumera a la prochaine mise en production.'
        : ((error && error.userMessage) || 'Les centres n\'ont pas pu se charger. Rechargez dans un instant.');
    } finally {
      fca.loading = false;
      render();
    }
  }

  function reload() {
    fca.loaded = false;
    load(true);
  }

  window.fcaReload = function () { reload(); };

  // ---- Petits formateurs / lookups ------------------------------------------

  const STATUS = {
    active: { label: 'actif', tone: 'green', toneClass: 'tone-success' },
    planned: { label: 'en preparation', tone: 'amber', toneClass: 'tone-warning' },
    closed: { label: 'ferme', tone: 'red', toneClass: 'tone-danger' },
  };
  const STATUS_ORDER = ['active', 'planned', 'closed'];

  const SCHEDULE_MARKERS = {
    same_as_libramont_public_schedule: 'horaires publics Libramont',
    to_confirm: 'horaires a confirmer',
  };

  const DAY_ORDER = ['1', '2', '3', '4', '5', '6', '0'];
  const DAY_NAMES = { '1': 'Lundi', '2': 'Mardi', '3': 'Mercredi', '4': 'Jeudi', '5': 'Vendredi', '6': 'Samedi', '0': 'Dimanche' };

  const RESOURCE_KEYS = ['bowling', 'laser', 'partyTables', 'barDesk'];
  const RESOURCE_DEFAULTS = {
    bowling: { laneCount: 1, normalCapacityPerLane: 6, emergencyCapacityPerLane: 8, forceExtraLaneAtPax: 7, preferAdjacentLanes: true },
    laser: { weaponCount: 20, parallelLaunches: 1, canSplitGroupsCleanly: false, requiresCompleteGroupBeforeLaunch: true, riskLevel: 'managed' },
    partyTables: { softCapacity: 40, hardCapacity: 60 },
    barDesk: { handlesBooking: true, handlesBriefing: false, handlesFoodAndDrink: true, activityEscort: false },
  };
  const RISK_LABELS = { critical: 'critique', managed: 'maitrise', low: 'faible' };

  function money(n) {
    const v = Number(n) || 0;
    try {
      return new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);
    } catch (_) {
      return `${Math.round(v)} EUR`;
    }
  }

  function num(n) {
    const v = Number(n);
    return Number.isFinite(v) ? String(v) : '0';
  }

  function findCenter(id) {
    const list = (fca.data && Array.isArray(fca.data.centers)) ? fca.data.centers : [];
    return list.find((c) => c && c.id === id) || null;
  }

  function chip(tone, label) {
    return `<span class="pv2-chip ${tone}">${esc(label)}</span>`;
  }

  function statusChip(status) {
    const s = STATUS[status];
    return s ? chip(s.tone, s.label) : (status ? chip('', status) : '');
  }

  // Navigation de chemin ('a.b.c') sur un objet, avec creation a l'ecriture.
  function getPath(obj, path) {
    const parts = String(path).split('.');
    let node = obj;
    for (const k of parts) {
      if (node == null || typeof node !== 'object') return undefined;
      node = node[k];
    }
    return node;
  }
  function setPath(obj, path, value) {
    const parts = String(path).split('.');
    let node = obj;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const k = parts[i];
      if (node[k] == null || typeof node[k] !== 'object') node[k] = {};
      node = node[k];
    }
    node[parts[parts.length - 1]] = value;
  }

  function clone(x) {
    try { return x == null ? x : JSON.parse(JSON.stringify(x)); } catch (_) { return x; }
  }
  function eq(a, b) {
    return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
  }

  // Bornes issues de resourceModel (min/max/enum). Absentes -> repli neutre.
  function getBound(pathArr) {
    let node = fca.data && fca.data.resourceModel;
    for (const k of pathArr) {
      if (node == null || typeof node !== 'object') return null;
      node = node[k];
    }
    if (node && typeof node === 'object' && ('min' in node || 'max' in node || 'enum' in node || 'type' in node)) return node;
    return null;
  }
  function numAttrs(pathArr, fbMin, fbMax) {
    const b = getBound(pathArr) || {};
    const min = b.min != null ? b.min : fbMin;
    const max = b.max != null ? b.max : fbMax;
    let out = 'step="1"';
    if (min != null) out += ` min="${esc(min)}"`;
    if (max != null) out += ` max="${esc(max)}"`;
    return out;
  }
  function enumFor(pathArr, fallback) {
    const b = getBound(pathArr);
    return (b && Array.isArray(b.enum) && b.enum.length) ? b.enum : fallback;
  }

  // ---- Rendu : liste --------------------------------------------------------

  function testDataBanner() {
    return `<aside class="fck-testdata" role="note">
        Donnees de TEST : le SaaS n'est pas lance, tout ce qui suit vient des essais internes.
        Aucun chiffre de cette page n'est du reel client.
      </aside>`;
  }

  function scheduleSummary(sched) {
    if (!sched) return '';
    if (typeof sched === 'string') return SCHEDULE_MARKERS[sched] || sched.replace(/_/g, ' ');
    const reg = sched.regular;
    if (reg && typeof reg === 'object') {
      const open = Object.keys(reg).filter((k) => reg[k] && typeof reg[k] === 'object').length;
      return `${open} j/7 ouverts`;
    }
    return '';
  }

  function summaryHtml(config) {
    if (!config || typeof config !== 'object') return '<span class="pv2-quiet">Configuration a definir</span>';
    const parts = [];
    const res = config.resources || {};
    const b = res.bowling;
    if (b && b.laneCount != null) parts.push(`<span><strong>${esc(num(b.laneCount))}</strong> piste${Number(b.laneCount) > 1 ? 's' : ''}</span>`);
    const l = res.laser;
    if (l && l.weaponCount != null) parts.push(`<span><strong>${esc(num(l.weaponCount))}</strong> armes laser</span>`);
    const t = res.partyTables;
    if (t && t.hardCapacity != null) parts.push(`<span>tables <strong>${esc(num(t.hardCapacity))}</strong> pax</span>`);
    const sched = scheduleSummary(config.defaultSchedule);
    if (sched) parts.push(`<span>${esc(sched)}</span>`);
    // Separateur explicite entre chaque element : sans lui, deux <span> voisins
    // se lisent colles ("8 pistes30 armes laser").
    return parts.length ? parts.join('<span class="fca-sep" aria-hidden="true">·</span>') : '<span class="pv2-quiet">Configuration minimale</span>';
  }

  function statusSeg(center) {
    const busy = fca.statusBusy === center.id;
    const btns = STATUS_ORDER.map((key) => {
      const s = STATUS[key];
      const on = center.status === key;
      return `<button type="button" class="fca-seg-btn ${on ? `is-active ${s.toneClass}` : ''}"
        aria-pressed="${on ? 'true' : 'false'}" ${busy ? 'disabled' : ''}
        onclick="fcaSetStatus('${escJs(center.id)}', '${escJs(key)}')">${esc(s.label)}</button>`;
    }).join('');
    return `<div class="fca-seg-wrap"><span class="fca-seg-label">Statut</span><div class="fca-status-seg" role="group" aria-label="Statut du centre">${btns}</div></div>`;
  }

  function centerCard(center) {
    const id = String(center.id || '');
    return `<section class="fck-center-card">
      <div class="fck-card-head">
        <div><strong>${esc(center.name || id || '(sans nom)')}</strong> <span class="pv2-quiet">· ${esc(id)}</span></div>
        ${statusChip(center.status)}
      </div>
      <div class="fca-summary">${summaryHtml(center.config)}</div>
      <div class="fca-metrics">
        <div class="fca-metric"><span class="fca-metric-num">${esc(num(center.members))}</span><span class="fca-metric-cap">membres</span></div>
        <div class="fca-metric"><span class="fca-metric-num">${esc(num(center.reservations30d))}</span><span class="fca-metric-cap">resas 30 j</span></div>
        <div class="fca-metric"><span class="fca-metric-num">${esc(money(center.revenue30d))}</span><span class="fca-metric-cap">CA 30 j</span></div>
      </div>
      <div class="fca-card-foot">
        ${statusSeg(center)}
        <button type="button" class="pv2-btn" onclick="fcaOpenConfig('${escJs(id)}')">Configurer</button>
      </div>
    </section>`;
  }

  function listHtml() {
    const d = fca.data || {};
    const centers = Array.isArray(d.centers) ? d.centers : [];
    const cardsOrError = [];
    if (d.centersError) cardsOrError.push(`<p class="pv2-quiet">${esc(d.centersError)}</p>`);
    if (d.volumesError) cardsOrError.push(`<p class="pv2-quiet">${esc(d.volumesError)}</p>`);

    let grid = '';
    if (centers.length) {
      grid = `<div class="fck-center-grid">${centers.map(centerCard).join('')}</div>`;
    } else if (fca.loaded && !fca.error) {
      grid = `<section class="pv2-panel"><div style="padding:16px"><p class="pv2-quiet">Aucun centre enregistre pour le moment. Creez le premier avec "Nouveau centre".</p></div></section>`;
    }

    return `<div class="pv2-shell fck-shell">
      <section class="pv2-bar">
        <div>
          <div class="pv2-bar-crumb"><span class="pv2-live"></span>Plateforme</div>
          <h1>Centres</h1>
          <p class="pv2-bar-sub">Chaque centre du SaaS : statut, ressources, horaires, adoption. Tout est modifiable sans code, et chaque ecriture est tracee.</p>
        </div>
        <div class="pv2-bar-actions">
          <button type="button" class="pv2-btn ghost" onclick="fcaReload()">Actualiser</button>
          <button type="button" class="pv2-btn primary" onclick="fcaOpenNew()">Nouveau centre</button>
        </div>
      </section>

      ${d.testData ? testDataBanner() : ''}

      ${fca.error ? `<section class="pv2-panel"><div style="padding:16px"><p class="pv2-quiet">${esc(fca.error)}</p>
        <button type="button" class="pv2-btn" onclick="fcaReload()">Reessayer</button></div></section>` : ''}

      ${fca.loading && !fca.data ? `<section class="pv2-panel"><div style="padding:16px"><p class="pv2-quiet">Chargement des centres...</p></div></section>` : ''}

      ${cardsOrError.length ? `<section class="pv2-panel"><div style="padding:16px">${cardsOrError.join('')}</div></section>` : ''}
      ${grid}
    </div>`;
  }

  function renderList() {
    const root = getRoot();
    if (!root) return;
    let page = root.querySelector('#fcaPage');
    if (!page) {
      // Premier montage : on ne pose QUE le conteneur de liste, jamais la modale.
      root.innerHTML = '<div id="fcaPage"></div>';
      page = root.querySelector('#fcaPage');
    }
    if (!fca.loaded && !fca.loading && !fca.error) setTimeout(() => load(), 0);
    page.innerHTML = listHtml();
  }

  function render() {
    renderList();
    syncModal();
  }

  // ---- Modale : cycle de vie ------------------------------------------------

  function modalTitleSub() {
    if (fca.modal && fca.modal.mode === 'new') {
      return { title: 'Nouveau centre', sub: 'Cree une fiche centre. Les ressources et horaires se reglent ensuite.' };
    }
    const c = findCenter(fca.modal && fca.modal.centerId) || {};
    return { title: c.name || (fca.modal && fca.modal.centerId) || 'Centre', sub: `Configuration du centre (${esc(c.id || (fca.modal && fca.modal.centerId) || '')}).` };
  }

  function modalPanelHtml() {
    const { title, sub } = modalTitleSub();
    return `<div class="fca-panel" role="dialog" aria-modal="true" aria-labelledby="fcaModalTitle">
      <div class="fca-modal-head">
        <div><h2 id="fcaModalTitle">${esc(title)}</h2><p>${sub}</p></div>
        <button type="button" class="fca-close" aria-label="Fermer" ${fca.saving ? 'disabled' : ''} onclick="fcaCloseModal()">&times;</button>
      </div>
      <div class="fca-modal-body">${modalBodyHtml()}</div>
      <div class="fca-modal-foot">${modalFootHtml()}</div>
    </div>`;
  }

  function syncModal() {
    const root = getRoot();
    if (!root) return;
    const existing = root.querySelector('.fca-overlay');
    if (!fca.modal) { if (existing) existing.remove(); return; }
    if (existing) return; // deja monte : le corps/pied se rafraichissent sur place

    const overlay = document.createElement('div');
    overlay.className = 'fca-overlay';
    overlay.addEventListener('mousedown', (e) => {
      // Clic sur le fond (pas sur le panneau) ferme, sauf pendant un enregistrement.
      if (e.target === overlay && !fca.saving) closeModal();
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

  function refreshBody() {
    const root = getRoot();
    const body = root && root.querySelector('.fca-modal-body');
    if (!body) return;
    const st = body.scrollTop;
    body.innerHTML = modalBodyHtml();
    body.scrollTop = st;
  }
  function refreshFoot() {
    const root = getRoot();
    const foot = root && root.querySelector('.fca-modal-foot');
    if (foot) foot.innerHTML = modalFootHtml();
    const closeBtn = root && root.querySelector('.fca-close');
    if (closeBtn) closeBtn.disabled = fca.saving;
  }

  function closeModal() {
    fca.modal = null;
    fca.original = null;
    fca.draft = null;
    fca.saving = false;
    fca.modalError = '';
    const root = getRoot();
    const overlay = root && root.querySelector('.fca-overlay');
    if (overlay) overlay.remove();
  }
  window.fcaCloseModal = function () { if (!fca.saving) closeModal(); };

  // ---- Modale : corps -------------------------------------------------------

  function fieldNum(label, path, boundPath, fbMin, fbMax, hint, autofocus) {
    const v = getPath(fca.draft, path);
    return `<div class="fca-field">
      <label>${esc(label)}</label>
      <input type="number" ${numAttrs(boundPath, fbMin, fbMax)} value="${v == null ? '' : esc(v)}" ${autofocus ? 'data-autofocus' : ''}
        oninput="fcaSetNum('${escJs(path)}', this.value)">
      ${hint ? `<span class="fca-hint">${esc(hint)}</span>` : ''}
    </div>`;
  }

  function toggleRow(label, sub, path) {
    const on = !!getPath(fca.draft, path);
    return `<div class="fca-toggle-row">
      <span class="fca-toggle-label">${esc(label)}${sub ? `<span class="fca-toggle-sub">${esc(sub)}</span>` : ''}</span>
      <button type="button" class="mk-switch ${on ? 'is-on' : ''}" role="switch" aria-checked="${on ? 'true' : 'false'}"
        aria-label="${esc(label)}" onclick="fcaToggle('${escJs(path)}', this)"><span></span></button>
    </div>`;
  }

  function bowlingSection() {
    const on = !!getPath(fca.draft, 'resources.bowling');
    let inner = `<div class="fca-toggle-row"><span class="fca-toggle-label">Bowling actif dans ce centre</span>
      <button type="button" class="mk-switch ${on ? 'is-on' : ''}" role="switch" aria-checked="${on ? 'true' : 'false'}"
        aria-label="Bowling actif" onclick="fcaResourceToggle('bowling')"><span></span></button></div>`;
    if (on) {
      inner += `<div class="fca-fields">
        ${fieldNum('Nombre de pistes', 'resources.bowling.laneCount', ['resources', 'bowling', 'laneCount'], 1, 60)}
        ${fieldNum('Capacite normale / piste', 'resources.bowling.normalCapacityPerLane', ['resources', 'bowling', 'normalCapacityPerLane'], 1, 20)}
        ${fieldNum('Capacite exceptionnelle / piste', 'resources.bowling.emergencyCapacityPerLane', ['resources', 'bowling', 'emergencyCapacityPerLane'], 1, 30)}
        ${fieldNum('Piste supplementaire des (pax)', 'resources.bowling.forceExtraLaneAtPax', ['resources', 'bowling', 'forceExtraLaneAtPax'], 1, 30, 'Au-dela de ce nombre de joueurs, on ouvre une piste de plus.')}
      </div>
      ${toggleRow('Preferer les pistes adjacentes', 'Regroupe un meme groupe sur des pistes cote a cote.', 'resources.bowling.preferAdjacentLanes')}`;
    }
    return `<div class="fca-section"><div class="fca-section-title">Bowling</div>${inner}</div>`;
  }

  function laserSection() {
    const on = !!getPath(fca.draft, 'resources.laser');
    let inner = `<div class="fca-toggle-row"><span class="fca-toggle-label">Laser Game actif dans ce centre</span>
      <button type="button" class="mk-switch ${on ? 'is-on' : ''}" role="switch" aria-checked="${on ? 'true' : 'false'}"
        aria-label="Laser actif" onclick="fcaResourceToggle('laser')"><span></span></button></div>`;
    if (on) {
      const risk = getPath(fca.draft, 'resources.laser.riskLevel') || '';
      const options = enumFor(['resources', 'laser', 'riskLevel'], ['critical', 'managed', 'low'])
        .map((v) => `<option value="${esc(v)}" ${risk === v ? 'selected' : ''}>${esc(RISK_LABELS[v] || v)}</option>`).join('');
      inner += `<div class="fca-fields">
        ${fieldNum('Nombre d\'armes', 'resources.laser.weaponCount', ['resources', 'laser', 'weaponCount'], 1, 200)}
        ${fieldNum('Lancements en parallele', 'resources.laser.parallelLaunches', ['resources', 'laser', 'parallelLaunches'], 1, 20)}
        <div class="fca-field">
          <label>Niveau de risque operationnel</label>
          <select onchange="fcaSet('resources.laser.riskLevel', this.value)">${options}</select>
        </div>
      </div>
      ${toggleRow('Les groupes peuvent etre scindes proprement', '', 'resources.laser.canSplitGroupsCleanly')}
      ${toggleRow('Groupe complet requis avant de lancer', '', 'resources.laser.requiresCompleteGroupBeforeLaunch')}`;
    }
    return `<div class="fca-section"><div class="fca-section-title">Laser Game</div>${inner}</div>`;
  }

  function tablesSection() {
    const on = !!getPath(fca.draft, 'resources.partyTables');
    let inner = `<div class="fca-toggle-row"><span class="fca-toggle-label">Tables d'anniversaire</span>
      <button type="button" class="mk-switch ${on ? 'is-on' : ''}" role="switch" aria-checked="${on ? 'true' : 'false'}"
        aria-label="Tables actives" onclick="fcaResourceToggle('partyTables')"><span></span></button></div>`;
    if (on) {
      inner += `<div class="fca-fields">
        ${fieldNum('Capacite confortable (pax)', 'resources.partyTables.softCapacity', ['resources', 'partyTables', 'softCapacity'], 1, 500)}
        ${fieldNum('Capacite maximale (pax)', 'resources.partyTables.hardCapacity', ['resources', 'partyTables', 'hardCapacity'], 1, 500)}
      </div>`;
    }
    return `<div class="fca-section"><div class="fca-section-title">Tables</div>${inner}</div>`;
  }

  function barSection() {
    const on = !!getPath(fca.draft, 'resources.barDesk');
    let inner = `<div class="fca-toggle-row"><span class="fca-toggle-label">Comptoir / bar</span>
      <button type="button" class="mk-switch ${on ? 'is-on' : ''}" role="switch" aria-checked="${on ? 'true' : 'false'}"
        aria-label="Bar actif" onclick="fcaResourceToggle('barDesk')"><span></span></button></div>`;
    if (on) {
      inner += toggleRow('Prend les reservations', '', 'resources.barDesk.handlesBooking')
        + toggleRow('Fait le briefing', '', 'resources.barDesk.handlesBriefing')
        + toggleRow('Gere boissons et petite restauration', '', 'resources.barDesk.handlesFoodAndDrink')
        + toggleRow('Accompagne les groupes en activite', '', 'resources.barDesk.activityEscort');
    }
    return `<div class="fca-section"><div class="fca-section-title">Comptoir</div>${inner}</div>`;
  }

  function scheduleGrid(scope) {
    const sd = getPath(fca.draft, `defaultSchedule.${scope}`) || {};
    const rows = DAY_ORDER.map((day) => {
      const slot = sd[day];
      const open = slot && typeof slot === 'object';
      const times = open
        ? `<div class="fca-day-times">
            <input type="time" value="${esc(slot.open || '')}" aria-label="Ouverture ${esc(DAY_NAMES[day])}" oninput="fcaSet('defaultSchedule.${escJs(scope)}.${day}.open', this.value)">
            <span class="fca-dash">-</span>
            <input type="time" value="${esc(slot.close || '')}" aria-label="Fermeture ${esc(DAY_NAMES[day])}" oninput="fcaSet('defaultSchedule.${escJs(scope)}.${day}.close', this.value)">
          </div>`
        : `<span class="fca-day-closed">Ferme</span>`;
      return `<div class="fca-day">
        <span class="fca-day-name">${esc(DAY_NAMES[day])}</span>
        <button type="button" class="mk-switch ${open ? 'is-on' : ''}" role="switch" aria-checked="${open ? 'true' : 'false'}"
          aria-label="${esc(DAY_NAMES[day])} ouvert" onclick="fcaScheduleDay('${escJs(scope)}', '${day}')"><span></span></button>
        ${times}
      </div>`;
    }).join('');
    return `<div class="fca-days">${rows}</div>`;
  }

  function scheduleSection() {
    const sched = getPath(fca.draft, 'defaultSchedule');
    let inner;
    if (sched && typeof sched === 'object' && (sched.regular || sched.holiday)) {
      inner = `<div class="fca-section-note">Grille par defaut appliquee aux nouvelles semaines. Chaque jour : ouvert/ferme et les heures.</div>
        <div class="fca-section-title" style="text-transform:none;letter-spacing:0;font-size:12.5px;margin:2px 0 4px">Semaine ordinaire</div>
        ${scheduleGrid('regular')}
        <div class="fca-section-title" style="text-transform:none;letter-spacing:0;font-size:12.5px;margin:12px 0 4px">Jours feries</div>
        ${scheduleGrid('holiday')}`;
    } else {
      const label = typeof sched === 'string' ? (SCHEDULE_MARKERS[sched] || sched.replace(/_/g, ' ')) : 'aucune grille definie';
      inner = `<div class="fca-schedule-marker">
        <span class="pv2-quiet">Horaires : ${esc(label)}.</span>
        <button type="button" class="pv2-btn" onclick="fcaConvertSchedule()">Definir une grille</button>
      </div>`;
    }
    return `<div class="fca-section"><div class="fca-section-title">Horaires</div>${inner}</div>`;
  }

  function availabilitySection() {
    const av = getPath(fca.draft, 'activityAvailability');
    if (!av || typeof av !== 'object' || Array.isArray(av)) return '';
    const keys = Object.keys(av).filter((k) => typeof av[k] === 'boolean');
    if (!keys.length) return '';
    const rows = keys.map((k) => toggleRow(k.replace(/_/g, ' '), '', `activityAvailability.${k}`)).join('');
    return `<div class="fca-section"><div class="fca-section-title">Activites proposees</div>${rows}</div>`;
  }

  function configBody() {
    const status = getPath(fca.draft, 'status') || '';
    const tz = getPath(fca.draft, 'timezone') || '';
    const statusOptions = STATUS_ORDER.map((k) => `<option value="${k}" ${status === k ? 'selected' : ''}>${esc(STATUS[k].label)}</option>`).join('');
    return `${fca.modalError ? `<div class="fca-modal-error">${esc(fca.modalError)}</div>` : ''}
      <div class="fca-section">
        <div class="fca-section-title">General</div>
        <div class="fca-fields">
          <div class="fca-field">
            <label>Statut</label>
            <select data-autofocus onchange="fcaSet('status', this.value)">${statusOptions}</select>
          </div>
          <div class="fca-field">
            <label>Fuseau horaire</label>
            <input type="text" value="${esc(tz)}" placeholder="Europe/Brussels" oninput="fcaSet('timezone', this.value)">
            <span class="fca-hint">Identifiant IANA, ex. Europe/Brussels.</span>
          </div>
        </div>
      </div>
      ${bowlingSection()}
      ${laserSection()}
      ${tablesSection()}
      ${barSection()}
      ${scheduleSection()}
      ${availabilitySection()}`;
  }

  function newBody() {
    const d = fca.draft || {};
    const statusOptions = STATUS_ORDER.map((k) => `<option value="${k}" ${d.status === k ? 'selected' : ''}>${esc(STATUS[k].label)}</option>`).join('');
    return `${fca.modalError ? `<div class="fca-modal-error">${esc(fca.modalError)}</div>` : ''}
      <div class="fca-section">
        <div class="fca-section-title">Identite</div>
        <div class="fca-fields">
          <div class="fca-field fca-span2">
            <label>Identifiant (slug)</label>
            <input type="text" value="${esc(d.id || '')}" data-autofocus placeholder="fun-galaxy-namur"
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*" oninput="fcaSet('id', this.value)">
            <span class="fca-hint">Minuscules, chiffres et tirets simples. Definitif : il identifie le centre partout.</span>
          </div>
          <div class="fca-field fca-span2">
            <label>Nom affiche</label>
            <input type="text" value="${esc(d.name || '')}" placeholder="Fun Galaxy Namur" oninput="fcaSet('name', this.value)">
          </div>
          <div class="fca-field">
            <label>Statut initial</label>
            <select onchange="fcaSet('status', this.value)">${statusOptions}</select>
          </div>
          <div class="fca-field">
            <label>Fuseau horaire</label>
            <input type="text" value="${esc(d.timezone || '')}" placeholder="Europe/Brussels" oninput="fcaSet('timezone', this.value)">
          </div>
        </div>
      </div>`;
  }

  function modalBodyHtml() {
    if (!fca.modal) return '';
    return fca.modal.mode === 'new' ? newBody() : configBody();
  }

  function modalFootHtml() {
    if (!fca.modal) return '';
    const saving = fca.saving;
    const isNew = fca.modal.mode === 'new';
    const primaryLabel = isNew ? (saving ? 'Creation...' : 'Creer le centre') : (saving ? 'Enregistrement...' : 'Enregistrer');
    return `${!isNew ? '<span class="fca-foot-note">Chaque ecriture est tracee au journal d\'audit.</span>' : ''}
      <button type="button" class="pv2-btn ghost" ${saving ? 'disabled' : ''} onclick="fcaCloseModal()">Annuler</button>
      <button type="button" class="pv2-btn primary" ${saving ? 'disabled' : ''} onclick="fcaSave()">${primaryLabel}</button>`;
  }

  // ---- Ouverture / edition ---------------------------------------------------

  window.fcaOpenConfig = function (centerId) {
    const center = findCenter(centerId);
    if (!center) { toast('Centre introuvable. Actualisez la liste.'); return; }
    const config = (center.config && typeof center.config === 'object') ? center.config : {};
    // Le statut/fuseau se lisent depuis le centre si absents du config.
    const base = clone(config) || {};
    if (base.status == null && center.status != null) base.status = center.status;
    if (base.timezone == null && center.timezone != null) base.timezone = center.timezone;
    fca.original = clone(base);
    fca.draft = clone(base);
    fca.modalError = '';
    fca.saving = false;
    fca.modal = { mode: 'config', centerId: center.id };
    syncModal();
  };

  window.fcaOpenNew = function () {
    fca.original = null;
    fca.draft = { id: '', name: '', status: 'planned', timezone: 'Europe/Brussels' };
    fca.modalError = '';
    fca.saving = false;
    fca.modal = { mode: 'new', centerId: null };
    syncModal();
  };

  window.fcaSet = function (path, value) {
    if (!fca.draft) return;
    setPath(fca.draft, path, value);
  };

  window.fcaSetNum = function (path, raw) {
    if (!fca.draft) return;
    if (raw === '' || raw == null) { setPath(fca.draft, path, null); return; }
    const n = Number(raw);
    if (Number.isFinite(n)) setPath(fca.draft, path, n);
  };

  // Bascule d'un booleen feuille : on retourne l'etat et on met a jour le
  // bouton en place (pas de re-rendu -> pas de saut de scroll ni de focus).
  window.fcaToggle = function (path, btn) {
    if (!fca.draft) return;
    const cur = !!getPath(fca.draft, path);
    setPath(fca.draft, path, !cur);
    if (btn && btn.classList) {
      btn.classList.toggle('is-on', !cur);
      btn.setAttribute('aria-checked', String(!cur));
    }
  };

  // Bascule d'une ressource entiere (null <-> objet) : change les champs
  // affiches -> re-rendu du corps.
  window.fcaResourceToggle = function (activity) {
    if (!fca.draft || RESOURCE_KEYS.indexOf(activity) === -1) return;
    if (!fca.draft.resources || typeof fca.draft.resources !== 'object') fca.draft.resources = {};
    const cur = fca.draft.resources[activity];
    fca.draft.resources[activity] = (cur && typeof cur === 'object') ? null : clone(RESOURCE_DEFAULTS[activity]);
    refreshBody();
  };

  window.fcaScheduleDay = function (scope, day) {
    if (!fca.draft) return;
    const sd = fca.draft.defaultSchedule;
    if (!sd || typeof sd !== 'object') return;
    if (!sd[scope] || typeof sd[scope] !== 'object') sd[scope] = {};
    const cur = sd[scope][day];
    sd[scope][day] = (cur && typeof cur === 'object') ? null : { open: '10:00', close: '22:00' };
    refreshBody();
  };

  window.fcaConvertSchedule = function () {
    if (!fca.draft) return;
    const blank = () => DAY_ORDER.reduce((acc, d) => { acc[d] = null; return acc; }, {});
    fca.draft.defaultSchedule = { regular: blank(), holiday: blank() };
    refreshBody();
  };

  // ---- Ecriture --------------------------------------------------------------

  function computePatch() {
    const o = fca.original || {};
    const d = fca.draft || {};
    const patch = {};
    ['status', 'timezone'].forEach((k) => { if (!eq(d[k], o[k])) patch[k] = d[k]; });
    const oRes = o.resources || {};
    const dRes = d.resources || {};
    let resPatch = null;
    RESOURCE_KEYS.forEach((k) => {
      if (!eq(dRes[k] == null ? null : dRes[k], oRes[k] == null ? null : oRes[k])) {
        resPatch = resPatch || {};
        resPatch[k] = dRes[k] == null ? null : dRes[k];
      }
    });
    if (resPatch) patch.resources = resPatch;
    if (!eq(d.defaultSchedule, o.defaultSchedule)) patch.defaultSchedule = d.defaultSchedule;
    if (!eq(d.activityAvailability, o.activityAvailability)) patch.activityAvailability = d.activityAvailability;
    return patch;
  }

  async function saveConfig() {
    const patch = computePatch();
    if (!Object.keys(patch).length) { toast('Aucun changement a enregistrer.'); return; }
    fca.saving = true;
    fca.modalError = '';
    refreshFoot();
    try {
      await window.apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'saveCenterConfig', centerId: fca.modal.centerId, config: patch }),
      });
      toast('Configuration enregistree.');
      closeModal();
      reload();
    } catch (error) {
      fca.saving = false;
      fca.modalError = (error && error.userMessage) || 'Enregistrement refuse. Reessayez.';
      refreshBody();
      refreshFoot();
    }
  }

  async function saveNew() {
    const d = fca.draft || {};
    const id = String(d.id || '').trim();
    const name = String(d.name || '').trim();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
      fca.modalError = 'Identifiant invalide : minuscules, chiffres et tirets simples (ex. fun-galaxy-namur).';
      refreshBody();
      return;
    }
    if (!name) { fca.modalError = 'Le nom est requis.'; refreshBody(); return; }
    if (findCenter(id)) { fca.modalError = 'Cet identifiant existe deja.'; refreshBody(); return; }
    fca.saving = true;
    fca.modalError = '';
    refreshFoot();
    try {
      await window.apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'saveCenter', center: { id, name, status: d.status || 'planned', timezone: d.timezone || 'Europe/Brussels' } }),
      });
      toast('Centre cree.');
      closeModal();
      reload();
    } catch (error) {
      fca.saving = false;
      fca.modalError = (error && error.userMessage) || 'Creation refusee. Reessayez.';
      refreshBody();
      refreshFoot();
    }
  }

  window.fcaSave = function () {
    if (fca.saving || !fca.modal) return;
    if (fca.modal.mode === 'new') saveNew();
    else saveConfig();
  };

  window.fcaSetStatus = async function (centerId, status) {
    if (fca.statusBusy) return;
    const center = findCenter(centerId);
    if (!center || center.status === status || !STATUS[status]) return;
    fca.statusBusy = centerId;
    renderList();
    try {
      await window.apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'setCenterStatus', centerId, status }),
      });
      center.status = status;
      if (center.config && typeof center.config === 'object') center.config.status = status;
      toast('Statut mis a jour.');
    } catch (error) {
      toast((error && error.userMessage) || 'Le statut n\'a pas ete change.');
    } finally {
      fca.statusBusy = '';
      renderList();
    }
  };

  // Echap ferme la modale (une seule liaison, meme si le script est recharge).
  if (!window.__fcaKeydownBound) {
    window.__fcaKeydownBound = true;
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && fca.modal && !fca.saving) {
        e.preventDefault();
        closeModal();
      }
    });
  }

  // ---- Point d'entree public ------------------------------------------------

  window.renderFounderCentresPage = function (root) {
    if (root && root.nodeType === 1) activeRoot = root;
    render();
  };
})();

/* ============================================================================
   TARIFS ET FORMULES : CATEGORIE PLATEFORME (permission platform.admin)
   ----------------------------------------------------------------------------
   Editeur no-code du catalogue : par-dessus le socle produit, on pose des
   AJUSTEMENTS (prix per-pax, ancien prix barre, nom affiche, retrait), en
   GLOBAL (scope 'all') ou pour UN centre precis. Rendu dans #staffCockpitPage
   (meme hote que founder-cockpit.js / founder-centres.js), via
   window.renderFounderTarifsPage(root).

   Doctrine identique au reste de la console :
   - le socle vit dans le produit ; ici on ne touche QUE l'override. Un tarif
     remis a zero (resetFormuleOverride) revient au prix d'origine ;
   - le SaaS n'est pas lance : bundle.testData = true, un bandeau le dit, et une
     note honnete rappelle que rien n'est facture a un vrai client ;
   - style Vercel NEUTRE : monochrome sauf le SENS (ambre = modifie, rouge =
     retiree), un seul bouton primaire, filets 1px, primitives pv2-/fck- reutilisees ;
   - etat hors DOM sur window.PinlaneFounderTarifs : survit aux reconstructions
     innerHTML. La liste se rebatit ; la MODALE vit dans un noeud soeur, sa
     transition d'entree ne joue qu'a la premiere apparition (classe is-in) ;
   - patch PARTIEL : on n'envoie que les champs reellement changes par rapport a
     la valeur effective de la portee courante. priceValue borne 0..1000, nom <=120 ;
   - robuste aux champs absents (price null, steps absents, perCenter vide) ;
   - JAMAIS de balise <header> : en mode console, body.staff-mode header ecrase
     tout <header> a hauteur 0. Uniquement div/section.
   ========================================================================== */
(function () {
  'use strict';

  if (typeof window === 'undefined') return;

  const esc = (value) => (typeof window.escapeHtml === 'function' ? window.escapeHtml(value ?? '') : String(value ?? ''));
  const escJs = (value) => (typeof window.escapeJsString === 'function' ? window.escapeJsString(String(value ?? '')) : String(value ?? '').replace(/['"\\]/g, ''));

  const PRICE_MIN = 0;
  const PRICE_MAX = 1000;
  const NAME_MAX = 120;

  // Etat hors DOM : survit aux reconstructions innerHTML.
  const ftr = {
    loaded: false,
    loading: false,
    error: '',
    data: null,
    scope: 'all',        // 'all' | '<centerId>' : portee de l'edition
    modal: null,         // null | { formuleId }
    original: null,      // snapshot effectif a l'ouverture (pour le diff)
    draft: null,         // valeurs en cours d'edition
    saving: false,
    resetting: false,
    modalError: '',
  };
  window.PinlaneFounderTarifs = ftr;

  let activeRoot = null;

  function getRoot() {
    if (activeRoot && document.contains(activeRoot)) return activeRoot;
    return document.getElementById('staffCockpitPage');
  }

  function toast(message) {
    if (typeof window.showAlert === 'function') window.showAlert(message);
  }

  // ---- Reseau ---------------------------------------------------------------

  async function load(force = false) {
    if (ftr.loading || (ftr.loaded && !force)) return;
    ftr.loading = true;
    ftr.error = '';
    renderList();
    try {
      const payload = await window.apiRequest('/api/ops?action=founderCatalog');
      ftr.data = payload || null;
      ftr.loaded = true;
      // Portee devenue invalide (centre disparu du bundle) : retour au global.
      if (ftr.scope !== 'all' && !findCenter(ftr.scope)) ftr.scope = 'all';
    } catch (error) {
      const status = Number(error && error.status);
      ftr.error = (status === 400 || status === 404)
        ? "Cette vue n'est pas encore disponible cote serveur. Elle s'allumera a la prochaine mise en production."
        : ((error && error.userMessage) || "Le catalogue n'a pas pu se charger. Rechargez dans un instant.");
    } finally {
      ftr.loading = false;
      render();
    }
  }

  function reload() {
    ftr.loaded = false;
    load(true);
  }

  window.ftrReload = function () { reload(); };

  // ---- Lookups / formateurs -------------------------------------------------

  function formulas() {
    return (ftr.data && Array.isArray(ftr.data.formulas)) ? ftr.data.formulas : [];
  }
  function centers() {
    return (ftr.data && Array.isArray(ftr.data.centers)) ? ftr.data.centers : [];
  }
  function findCenter(id) {
    return centers().find((c) => c && c.id === id) || null;
  }
  function findFormula(id) {
    return formulas().find((f) => f && f.id === id) || null;
  }
  function scopeName() {
    if (ftr.scope === 'all') return 'tous les centres';
    const c = findCenter(ftr.scope);
    return c ? (c.name || c.id) : ftr.scope;
  }

  function money(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '';
    try {
      return new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(v);
    } catch (_) {
      return `${v} EUR`;
    }
  }

  function clampPrice(raw) {
    const v = Number(raw);
    if (!Number.isFinite(v)) return null;
    return Math.min(PRICE_MAX, Math.max(PRICE_MIN, v));
  }

  function eq(a, b) {
    return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
  }

  function chip(tone, label) {
    return `<span class="pv2-chip ${tone}">${esc(label)}</span>`;
  }

  // ---- Resolution effective (socle <- override 'all' <- override centre) ----

  function baseName(f) { return (f && f.name != null) ? String(f.name) : ''; }
  function basePrice(f) { const p = f && f.price; return (p && p.value != null) ? Number(p.value) : null; }
  function baseOld(f) { const p = f && f.price; return (p && p.oldValue != null) ? Number(p.oldValue) : null; }
  function allOverride(f) { return (f && f.override && typeof f.override === 'object') ? f.override : null; }
  function centerOverride(f, scope) {
    if (scope === 'all') return null;
    const pc = f && f.perCenter;
    return (pc && typeof pc === 'object' && pc[scope] && typeof pc[scope] === 'object') ? pc[scope] : null;
  }

  // Un override existe-t-il pour la portee courante (au moins un champ pose) ?
  function overrideExists(f, scope) {
    const ov = scope === 'all' ? allOverride(f) : centerOverride(f, scope);
    if (!ov) return false;
    return Object.keys(ov).some((k) => ov[k] != null && ov[k] !== '');
  }

  // Valeurs affichees/editables pour la portee. Le modele READ per-centre ne
  // porte que priceValue/enabled/removed : le nom et l'ancien prix retombent
  // donc sur l'override global ou le socle.
  function effective(f, scope) {
    const ao = allOverride(f) || {};
    const co = centerOverride(f, scope) || {};

    const name = (ao.name != null && ao.name !== '') ? String(ao.name) : baseName(f);

    let priceValue = basePrice(f);
    if (ao.priceValue != null) priceValue = Number(ao.priceValue);
    if (co.priceValue != null) priceValue = Number(co.priceValue);

    let priceOld = baseOld(f);
    if (ao.priceOld != null) priceOld = Number(ao.priceOld);

    let removed = false;
    if (ao.removed != null) removed = Boolean(ao.removed);
    if (ao.enabled === false) removed = true;
    if (co.removed != null) removed = Boolean(co.removed);
    if (co.enabled === false) removed = true;

    return {
      name,
      priceValue: Number.isFinite(priceValue) ? priceValue : null,
      priceOld: Number.isFinite(priceOld) ? priceOld : null,
      removed,
    };
  }

  // ---- Rendu : liste --------------------------------------------------------

  function testDataBanner() {
    return `<aside class="fck-testdata" role="note">
        Donnees de TEST : le SaaS n'est pas lance, tout ce qui suit vient des essais internes.
        Aucun tarif de cette page n'est facture a un vrai client.
      </aside>`;
  }

  function honestNote() {
    return `<aside class="ftr-note" role="note">
        Le catalogue de base vit dans le produit ; ici tu poses des ajustements par-dessus.
        Un tarif remis a zero revient au prix d'origine.
        Le SaaS n'est pas lance : rien n'est facture a un vrai client.
      </aside>`;
  }

  function scopeSelector() {
    const opts = [`<option value="all" ${ftr.scope === 'all' ? 'selected' : ''}>Tarif global (tous les centres)</option>`]
      .concat(centers().map((c) => `<option value="${esc(c.id)}" ${ftr.scope === c.id ? 'selected' : ''}>${esc(c.name || c.id)}</option>`))
      .join('');
    return `<div class="ftr-scope">
      <label for="ftrScope">Portee</label>
      <select id="ftrScope" class="pv2-input ftr-scope-select" onchange="ftrSetScope(this.value)">${opts}</select>
    </div>`;
  }

  function stepsSummary(f) {
    const steps = (f && Array.isArray(f.steps)) ? f.steps : [];
    if (!steps.length) return '<span class="pv2-quiet">Etapes definies dans le produit</span>';
    const shown = steps.slice(0, 4).map((s) => {
      if (!s || typeof s !== 'object') return '';
      const label = s.label ? String(s.label) : String(s.activityId || 'etape');
      const count = Number(s.count);
      const prefix = Number.isFinite(count) && count > 1 ? `${count}x ` : '';
      const dur = Number(s.durationMinutes);
      const durTxt = Number.isFinite(dur) && dur > 0 ? ` <span class="ftr-step-dur">${esc(dur)} min</span>` : '';
      const crit = s.critical ? ' <span class="ftr-step-crit" title="etape critique">critique</span>' : '';
      return `<span class="ftr-step">${esc(prefix + label)}${durTxt}${crit}</span>`;
    }).filter(Boolean);
    const more = steps.length > 4 ? `<span class="pv2-quiet">+${steps.length - 4}</span>` : '';
    const parts = more ? shown.concat(more) : shown;
    return parts.join('<span class="ftr-sep" aria-hidden="true">·</span>');
  }

  function priceBlock(eff) {
    if (eff.priceValue == null) {
      return '<div class="ftr-price"><span class="pv2-quiet">prix a definir</span></div>';
    }
    const old = (eff.priceOld != null && eff.priceOld > eff.priceValue)
      ? `<span class="ftr-price-old">${esc(money(eff.priceOld))}</span>`
      : '';
    return `<div class="ftr-price">
      <span class="ftr-price-now">${esc(money(eff.priceValue))}</span>
      ${old}
      <span class="ftr-price-unit">/ pers.</span>
    </div>`;
  }

  function formulaCard(f) {
    const id = String(f.id || '');
    const eff = effective(f, ftr.scope);
    const modified = overrideExists(f, ftr.scope);
    const badges = [];
    if (eff.removed) badges.push(chip('red', 'retiree'));
    if (modified) badges.push(chip('amber', 'modifie'));
    const family = f.family ? `<span class="pv2-chip">${esc(f.family)}</span>` : '';
    const minPax = (f.minPax != null) ? `<span class="ftr-meta">des ${esc(String(f.minPax))} pers.</span>` : '';
    const tags = (family || minPax) ? `<div class="ftr-tags">${family}${minPax}</div>` : '';
    return `<section class="fck-center-card ftr-card${eff.removed ? ' is-removed' : ''}">
      <div class="fck-card-head ftr-card-head">
        <div class="ftr-card-title"><strong>${esc(eff.name || id || '(sans nom)')}</strong></div>
        ${badges.length ? `<div class="ftr-badges">${badges.join('')}</div>` : ''}
      </div>
      ${tags}
      ${priceBlock(eff)}
      <div class="ftr-steps">${stepsSummary(f)}</div>
      <div class="ftr-card-foot">
        <button type="button" class="pv2-btn" onclick="ftrOpenEdit('${escJs(id)}')">Modifier</button>
      </div>
    </section>`;
  }

  function listHtml() {
    const list = formulas();
    let grid = '';
    if (list.length) {
      grid = `<div class="fck-center-grid ftr-grid">${list.map(formulaCard).join('')}</div>`;
    } else if (ftr.loaded && !ftr.error) {
      grid = '<section class="pv2-panel"><div style="padding:16px"><p class="pv2-quiet">Aucune formule dans le catalogue pour le moment.</p></div></section>';
    }

    return `<div class="pv2-shell fck-shell ftr-shell">
      <section class="pv2-bar">
        <div>
          <div class="pv2-bar-crumb"><span class="pv2-live"></span>Plateforme</div>
          <h1>Tarifs et formules</h1>
          <p class="pv2-bar-sub">Ajuste prix, ancien prix, nom et retrait par-dessus le catalogue produit. Portee courante : ${esc(scopeName())}.</p>
        </div>
        <div class="pv2-bar-actions">
          ${scopeSelector()}
          <button type="button" class="pv2-btn ghost" onclick="ftrReload()">Actualiser</button>
        </div>
      </section>

      ${honestNote()}
      ${(ftr.data && ftr.data.testData) ? testDataBanner() : ''}

      ${ftr.error ? `<section class="pv2-panel"><div style="padding:16px"><p class="pv2-quiet">${esc(ftr.error)}</p>
        <button type="button" class="pv2-btn" onclick="ftrReload()">Reessayer</button></div></section>` : ''}

      ${ftr.loading && !ftr.data ? '<section class="pv2-panel"><div style="padding:16px"><p class="pv2-quiet">Chargement du catalogue...</p></div></section>' : ''}

      ${grid}
    </div>`;
  }

  function renderList() {
    const root = getRoot();
    if (!root) return;
    let page = root.querySelector('#ftrPage');
    if (!page) {
      // Premier montage : on ne pose QUE le conteneur de liste, jamais la modale.
      root.innerHTML = '<div id="ftrPage"></div>';
      page = root.querySelector('#ftrPage');
    }
    if (!ftr.loaded && !ftr.loading && !ftr.error) setTimeout(() => load(), 0);
    if (page) page.innerHTML = listHtml();
  }

  function render() {
    renderList();
    syncModal();
  }

  // ---- Modale : cycle de vie ------------------------------------------------

  function modalTitleSub() {
    const f = findFormula(ftr.modal && ftr.modal.formuleId) || {};
    const eff = effective(f, ftr.scope);
    return {
      title: eff.name || (ftr.modal && ftr.modal.formuleId) || 'Formule',
      sub: `Ajustement pour ${esc(scopeName())}. Le prix per-pax est borne de 0 a 1000 EUR.`,
    };
  }

  function fieldText(label, path, value, hint, autofocus) {
    return `<div class="ftr-field ftr-span2">
      <label>${esc(label)}</label>
      <input type="text" value="${value == null ? '' : esc(value)}" maxlength="${NAME_MAX}" ${autofocus ? 'data-autofocus' : ''}
        oninput="ftrSet('${escJs(path)}', this.value)">
      ${hint ? `<span class="ftr-hint">${esc(hint)}</span>` : ''}
    </div>`;
  }

  function fieldPrice(label, path, value, hint) {
    return `<div class="ftr-field">
      <label>${esc(label)}</label>
      <div class="ftr-price-input">
        <input type="number" step="1" min="${PRICE_MIN}" max="${PRICE_MAX}" value="${value == null ? '' : esc(value)}"
          oninput="ftrSetNum('${escJs(path)}', this.value)">
        <span class="ftr-unit">EUR</span>
      </div>
      ${hint ? `<span class="ftr-hint">${esc(hint)}</span>` : ''}
    </div>`;
  }

  function modalBodyHtml() {
    if (!ftr.modal) return '';
    const d = ftr.draft || {};
    const removedSub = d.removed
      ? '<span class="ftr-toggle-sub">Masquee pour cette portee.</span>'
      : '<span class="ftr-toggle-sub">La formule reste dans le produit, seulement cachee ici.</span>';
    return `${ftr.modalError ? `<div class="ftr-modal-error">${esc(ftr.modalError)}</div>` : ''}
      <div class="ftr-section">
        <div class="ftr-section-title">Nom affiche</div>
        <div class="ftr-fields">
          ${fieldText('Nom de la formule', 'name', d.name, 'Laisse le nom du catalogue si tu ne veux pas le changer.', true)}
        </div>
      </div>
      <div class="ftr-section">
        <div class="ftr-section-title">Prix</div>
        <div class="ftr-fields">
          ${fieldPrice('Prix per-pax', 'priceValue', d.priceValue, 'Ce que paie une personne.')}
          ${fieldPrice('Ancien prix (barre)', 'priceOld', d.priceOld, 'Affiche barre a cote du prix. Vide = aucun.')}
        </div>
      </div>
      <div class="ftr-section">
        <div class="ftr-toggle-row">
          <span class="ftr-toggle-label">Retirer cette formule${removedSub}</span>
          <button type="button" class="mk-switch ${d.removed ? 'is-on' : ''}" role="switch" aria-checked="${d.removed ? 'true' : 'false'}"
            aria-label="Retirer cette formule" onclick="ftrToggleRemoved(this)"><span></span></button>
        </div>
      </div>`;
  }

  function modalFootHtml() {
    if (!ftr.modal) return '';
    const f = findFormula(ftr.modal.formuleId);
    const hasOverride = f ? overrideExists(f, ftr.scope) : false;
    const busy = ftr.saving || ftr.resetting;
    return `<span class="ftr-foot-note">Chaque ecriture est tracee au journal d'audit.</span>
      ${hasOverride ? `<button type="button" class="pv2-btn ghost" ${busy ? 'disabled' : ''} onclick="ftrReset()">${ftr.resetting ? 'Remise a zero...' : 'Revenir au tarif de base'}</button>` : ''}
      <button type="button" class="pv2-btn ghost" ${busy ? 'disabled' : ''} onclick="ftrCloseModal()">Annuler</button>
      <button type="button" class="pv2-btn primary" ${busy ? 'disabled' : ''} onclick="ftrSave()">${ftr.saving ? 'Enregistrement...' : 'Enregistrer'}</button>`;
  }

  function modalPanelHtml() {
    const { title, sub } = modalTitleSub();
    return `<div class="ftr-panel" role="dialog" aria-modal="true" aria-labelledby="ftrModalTitle">
      <div class="ftr-modal-head">
        <div><h2 id="ftrModalTitle">${esc(title)}</h2><p>${sub}</p></div>
        <button type="button" class="ftr-close" aria-label="Fermer" ${ftr.saving || ftr.resetting ? 'disabled' : ''} onclick="ftrCloseModal()">&times;</button>
      </div>
      <div class="ftr-modal-body">${modalBodyHtml()}</div>
      <div class="ftr-modal-foot">${modalFootHtml()}</div>
    </div>`;
  }

  function syncModal() {
    const root = getRoot();
    if (!root) return;
    const existing = root.querySelector('.ftr-overlay');
    if (!ftr.modal) { if (existing) existing.remove(); return; }
    if (existing) return; // deja monte : le corps/pied se rafraichissent sur place

    const overlay = document.createElement('div');
    overlay.className = 'ftr-overlay';
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay && !ftr.saving && !ftr.resetting) closeModal();
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
    const body = root && root.querySelector('.ftr-modal-body');
    if (!body) return;
    const st = body.scrollTop;
    body.innerHTML = modalBodyHtml();
    body.scrollTop = st;
  }
  function refreshFoot() {
    const root = getRoot();
    const foot = root && root.querySelector('.ftr-modal-foot');
    if (foot) foot.innerHTML = modalFootHtml();
    const closeBtn = root && root.querySelector('.ftr-close');
    if (closeBtn) closeBtn.disabled = ftr.saving || ftr.resetting;
  }

  function closeModal() {
    ftr.modal = null;
    ftr.original = null;
    ftr.draft = null;
    ftr.saving = false;
    ftr.resetting = false;
    ftr.modalError = '';
    const root = getRoot();
    const overlay = root && root.querySelector('.ftr-overlay');
    if (overlay) overlay.remove();
  }
  window.ftrCloseModal = function () { if (!ftr.saving && !ftr.resetting) closeModal(); };

  // ---- Ouverture / edition --------------------------------------------------

  window.ftrOpenEdit = function (formuleId) {
    const f = findFormula(formuleId);
    if (!f) { toast('Formule introuvable. Actualisez la liste.'); return; }
    const eff = effective(f, ftr.scope);
    const snapshot = { name: eff.name, priceValue: eff.priceValue, priceOld: eff.priceOld, removed: eff.removed };
    ftr.original = { ...snapshot };
    ftr.draft = { ...snapshot };
    ftr.modalError = '';
    ftr.saving = false;
    ftr.resetting = false;
    ftr.modal = { formuleId: f.id };
    syncModal();
  };

  window.ftrSet = function (path, value) {
    if (!ftr.draft) return;
    if (path === 'name') ftr.draft.name = String(value == null ? '' : value);
  };

  window.ftrSetNum = function (path, raw) {
    if (!ftr.draft) return;
    if (path !== 'priceValue' && path !== 'priceOld') return;
    if (raw === '' || raw == null) { ftr.draft[path] = null; return; }
    ftr.draft[path] = clampPrice(raw);
  };

  // Bascule du retrait : on retourne l'etat et on met le bouton a jour en place
  // (pas de re-rendu du corps -> pas de saut de scroll ni de focus).
  window.ftrToggleRemoved = function (btn) {
    if (!ftr.draft) return;
    const cur = Boolean(ftr.draft.removed);
    ftr.draft.removed = !cur;
    if (btn && btn.classList) {
      btn.classList.toggle('is-on', !cur);
      btn.setAttribute('aria-checked', String(!cur));
    }
  };

  window.ftrSetScope = function (value) {
    const next = (value === 'all' || findCenter(value)) ? value : 'all';
    if (next === ftr.scope) return;
    ftr.scope = next;
    if (ftr.modal) closeModal();
    renderList();
  };

  // ---- Ecriture -------------------------------------------------------------

  // Diff effectif -> patch PARTIEL : seuls les champs reellement changes sont
  // envoyes. Les cles suivent le contrat serveur (name, priceValue, priceOld, removed).
  function computePatch() {
    const o = ftr.original || {};
    const d = ftr.draft || {};
    const patch = {};
    if (!eq(d.name, o.name)) patch.name = String(d.name == null ? '' : d.name).trim().slice(0, NAME_MAX);
    if (!eq(d.priceValue, o.priceValue)) patch.priceValue = d.priceValue;
    if (!eq(d.priceOld, o.priceOld)) patch.priceOld = d.priceOld;
    if (!eq(d.removed, o.removed)) patch.removed = Boolean(d.removed);
    return patch;
  }

  async function saveOverride() {
    const patch = computePatch();
    if (!Object.keys(patch).length) { toast('Aucun changement a enregistrer.'); return; }
    if ('priceValue' in patch && (patch.priceValue == null || !Number.isFinite(patch.priceValue))) {
      ftr.modalError = 'Indique un prix per-pax entre 0 et 1000 EUR.';
      refreshBody();
      refreshFoot();
      return;
    }
    if ('name' in patch && !patch.name) {
      ftr.modalError = 'Le nom ne peut pas etre vide. Reviens au tarif de base pour retirer un nom pose.';
      refreshBody();
      refreshFoot();
      return;
    }
    ftr.saving = true;
    ftr.modalError = '';
    refreshFoot();
    try {
      await window.apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'saveFormuleOverride', formuleId: ftr.modal.formuleId, centerId: ftr.scope, patch }),
      });
      toast('Ajustement enregistre.');
      closeModal();
      reload();
    } catch (error) {
      ftr.saving = false;
      ftr.modalError = (error && error.userMessage) || 'Enregistrement refuse. Reessayez.';
      refreshBody();
      refreshFoot();
    }
  }

  async function resetOverride() {
    ftr.resetting = true;
    ftr.modalError = '';
    refreshFoot();
    try {
      await window.apiRequest('/api/ops', {
        method: 'POST',
        body: JSON.stringify({ action: 'resetFormuleOverride', formuleId: ftr.modal.formuleId, centerId: ftr.scope }),
      });
      toast('Tarif remis a la base.');
      closeModal();
      reload();
    } catch (error) {
      ftr.resetting = false;
      ftr.modalError = (error && error.userMessage) || 'Remise a zero refusee. Reessayez.';
      refreshBody();
      refreshFoot();
    }
  }

  window.ftrSave = function () {
    if (ftr.saving || ftr.resetting || !ftr.modal) return;
    saveOverride();
  };

  window.ftrReset = function () {
    if (ftr.saving || ftr.resetting || !ftr.modal) return;
    resetOverride();
  };

  // Echap ferme la modale (une seule liaison, meme si le script est recharge).
  if (!window.__ftrKeydownBound) {
    window.__ftrKeydownBound = true;
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && ftr.modal && !ftr.saving && !ftr.resetting) {
        e.preventDefault();
        closeModal();
      }
    });
  }

  // ---- Point d'entree public ------------------------------------------------

  window.renderFounderTarifsPage = function (root) {
    if (root && root.nodeType === 1) activeRoot = root;
    render();
  };
})();

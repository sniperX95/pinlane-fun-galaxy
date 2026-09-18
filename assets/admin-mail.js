// Onglet « Mails » de la console direction : studio complet :
// Historique · Composer (envoi libre, identités, amélioration IA) · Modèles
// personnalisés · Identités d'expéditeur · Analyse des envois.
// Backend : actions emailStudio / sendDirectEmail / saveEmailTemplate /
// saveEmailIdentity / improveEmailWithAi / emailInsights (api/ops.js).
/* global apiRequest, escapeHtml, state, toast, renderAdminDashboard */

const MS_SECTIONS = {
  compose: 'Composer',
  history: 'Historique',
  templates: 'Modèles',
  identities: 'Identités',
  insights: 'Analyse',
};

const MS_CATEGORIES = {
  marketing: 'Marketing',
  promotion: 'Promotion',
  information: 'Information',
  serieux: 'Sérieux / officiel',
  relance: 'Relance client',
};

// Modèles de départ intégrés : remplissent le composer, éditables ensuite.
// {{centre}} = le NOM du centre courant, substitué à l'insertion
// (msApplyTemplate) : aucun modèle ne porte le nom d'un client en dur.
const MS_STARTERS = [
  { key: 'promo-semaine', category: 'promotion', name: 'Offre de la semaine', subject: 'Cette semaine chez {{centre}}, {{offre}}', body: 'Bonjour {{prenom}},\n\nCette semaine chez {{centre}}, {{offre}}.\n\nValable du {{date_debut}} au {{date_fin}}, réservez votre créneau en ligne en une minute.\n\nBien à vous,\nL\'équipe {{centre}}' },
  { key: 'marketing-anniversaire', category: 'marketing', name: 'Pack anniversaire', subject: 'Un anniversaire inoubliable, sans stress pour vous', body: 'Bonjour {{prenom}},\n\nUn anniversaire à organiser ? Bowling, laser game, table décorée et cruches de boissons, l\'équipe s\'occupe de tout pendant que vous profitez.\n\nIndiquez la date et le nombre d\'enfants, et la formule adaptée vous sera proposée.\n\nL\'équipe {{centre}}' },
  { key: 'serieux-entreprise', category: 'serieux', name: 'Proposition entreprise', subject: 'Votre événement d\'équipe chez {{centre}}, proposition', body: 'Bonjour {{prenom}},\n\nSuite à votre demande, voici la proposition de {{centre}} pour votre événement d\'équipe, avec un créneau privatisé, les activités au choix (bowling, laser game) et un espace repas.\n\nL\'équipe reste disponible pour ajuster la formule à votre budget et vos horaires.\n\nCordialement,\nLa direction {{centre}}' },
  { key: 'relance-client', category: 'relance', name: 'On ne vous a plus vu', subject: 'Ça fait longtemps, {{prenom}} !', body: 'Bonjour {{prenom}},\n\nCela fait un moment sans vous voir au centre, les pistes vous attendent.\n\nRéservez en ligne quand vous voulez, ça prend une minute.\n\nÀ bientôt,\nL\'équipe {{centre}}' },
];

const msState = {
  section: 'compose',
  loading: false,
  loadedCenter: '',
  error: '',
  channel: null,
  templates: [],
  identities: [],
  history: [],
  historyLoaded: false,
  historyFilter: '',
  historyStatus: '',
  openMailId: null,
  insights: null,
  insightsLoaded: false,
  draft: { to: '', subject: '', body: '', identityId: '', category: 'marketing', templateRef: '' },
  aiBusy: false,
  aiTips: [],
  aiMode: '',
  sendBusy: false,
  editingTemplate: null,
  identityForm: false,
};

function msCenterId() {
  return (typeof state !== 'undefined' && state.adminCenterId) || 'libramont';
}

function msEsc(value) {
  return typeof escapeHtml === 'function' ? escapeHtml(String(value ?? '')) : String(value ?? '');
}

function msRefresh() {
  if (typeof state !== 'undefined' && state.view === 'admin' && state.adminTab === 'mail'
    && typeof renderAdminDashboard === 'function') {
    renderAdminDashboard();
  }
}

function msDateFr(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
}

// ---------------------------------------------------------------------------
// Chargements
// ---------------------------------------------------------------------------

async function loadMailStudio(force = false) {
  if (msState.loading) return;
  if (!force && msState.loadedCenter === msCenterId() && msState.channel) return;
  msState.loading = true;
  msState.error = '';
  msRefresh();
  try {
    const payload = await apiRequest(`/api/ops?action=emailStudio&centerId=${encodeURIComponent(msCenterId())}`);
    msState.templates = payload.templates || [];
    msState.identities = payload.identities || [];
    msState.channel = payload.channel || {};
    msState.loadedCenter = msCenterId();
    const def = msState.identities.find((i) => i.isDefault);
    if (def && !msState.draft.identityId) msState.draft.identityId = String(def.id);
  } catch (error) {
    msState.error = error.message || 'Studio mails momentanément indisponible.';
  } finally {
    msState.loading = false;
    msRefresh();
  }
}

async function loadMailHistory(force = false) {
  if (msState.historyLoaded && !force) return;
  try {
    const payload = await apiRequest(`/api/ops?action=communications&centerId=${encodeURIComponent(msCenterId())}&limit=200`);
    msState.history = payload.communications || [];
    msState.historyLoaded = true;
    msRefresh();
  } catch (error) {
    if (typeof toast === 'function') toast(error.message || 'Historique indisponible.');
  }
}

async function loadMailInsights(force = false) {
  if (msState.insightsLoaded && !force) return;
  try {
    const payload = await apiRequest(`/api/ops?action=emailInsights&centerId=${encodeURIComponent(msCenterId())}`);
    msState.insights = payload.insights || null;
    msState.insightsLoaded = true;
    msRefresh();
  } catch (error) {
    msState.insightsLoaded = true;
  }
}

function msSetSection(key) {
  if (!MS_SECTIONS[key]) return;
  msState.section = key;
  if (key === 'history') loadMailHistory();
  if (key === 'insights') loadMailInsights();
  msRefresh();
}

// ---------------------------------------------------------------------------
// Rendu principal
// ---------------------------------------------------------------------------

function renderAdminMailTab() {
  const nav = `<div class="dh-range">${Object.entries(MS_SECTIONS).map(([key, label]) => `
    <button type="button" class="${msState.section === key ? 'active' : ''}" onclick="msSetSection('${key}')">${label}</button>`).join('')}
  </div>`;

  const channelNote = msState.channel && !msState.channel.resendConfigured
    ? '<div class="ms-note warn" role="alert">Canal d\'envoi email non configuré : les mails sont enregistrés en file et partiront dès que l\'envoi sera activé.</div>'
    : '';

  const header = `<div class="dh-head">
    <div>
      <h2 class="dh-title">Mails du centre</h2>
      <p class="dh-sub">Envoyer, suivre, modéliser et analyser toutes les communications email.</p>
    </div>
    <div class="dh-controls">${nav}</div>
  </div>`;

  if (msState.loading && !msState.channel) {
    return `<div class="dh-wrap">${header}<div class="dh-chart-empty">Chargement du studio mails…</div></div>`;
  }
  if (msState.error && !msState.channel) {
    return `<div class="dh-wrap">${header}
      <div class="dh-error" role="alert">${msEsc(msState.error)}
        <button type="button" class="admin-btn" onclick="loadMailStudio(true)">Réessayer</button></div></div>`;
  }

  const sections = {
    compose: renderMsCompose,
    history: renderMsHistory,
    templates: renderMsTemplates,
    identities: renderMsIdentities,
    insights: renderMsInsights,
  };
  return `<div class="dh-wrap">${header}${channelNote}${sections[msState.section]()}</div>`;
}

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------

function renderMsCompose() {
  const d = msState.draft;
  const identityOptions = [
    `<option value="">Expéditeur par défaut (${msEsc(msState.channel?.defaultFrom || 'plateforme')})</option>`,
    ...msState.identities.map((i) => `<option value="${i.id}" ${String(i.id) === d.identityId ? 'selected' : ''}>${msEsc(i.label)}, ${msEsc(i.email)}</option>`),
  ].join('');

  const templateOptions = [
    '<option value=""> Partir de zéro </option>',
    `<optgroup label="Modèles de départ">${MS_STARTERS.map((s) => `<option value="starter:${s.key}" ${d.templateRef === `starter:${s.key}` ? 'selected' : ''}>${msEsc(s.name)} (${MS_CATEGORIES[s.category]})</option>`).join('')}</optgroup>`,
    msState.templates.length
      ? `<optgroup label="Vos modèles">${msState.templates.map((t) => `<option value="custom:${t.id}" ${d.templateRef === `custom:${t.id}` ? 'selected' : ''}>${msEsc(t.name)} (${MS_CATEGORIES[t.category] || t.category})</option>`).join('')}</optgroup>`
      : '',
  ].join('');

  const tips = msState.aiTips.length ? `
    <div class="ms-tips">
      <div class="ms-tips-title">${msState.aiMode === 'ia' ? 'Réécrit par l\'IA : points corrigés :' : `Analyse du brouillon${msState.channel?.aiConfigured ? '' : ' (IA non branchée : conseils automatiques)'} :`}</div>
      <ul>${msState.aiTips.map((t) => `<li>${msEsc(t)}</li>`).join('')}</ul>
    </div>` : '';

  return `<section class="dh-card">
    <h3>Nouveau mail</h3>
    <div class="ms-form">
      <div class="ms-grid-2">
        <label class="ms-field"><span>Destinataire *</span>
          <input type="email" id="msTo" class="ms-input" placeholder="client@exemple.be" value="${msEsc(d.to)}" oninput="msState.draft.to = this.value">
        </label>
        <label class="ms-field"><span>Expéditeur</span>
          <select id="msIdentity" class="ms-input" onchange="msState.draft.identityId = this.value">${identityOptions}</select>
        </label>
      </div>
      <div class="ms-grid-2">
        <label class="ms-field"><span>Modèle</span>
          <select class="ms-input" onchange="msApplyTemplate(this.value)">${templateOptions}</select>
        </label>
        <label class="ms-field"><span>Catégorie</span>
          <select class="ms-input" onchange="msState.draft.category = this.value">${Object.entries(MS_CATEGORIES).map(([k, v]) => `<option value="${k}" ${d.category === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        </label>
      </div>
      <label class="ms-field"><span>Objet *</span>
        <input type="text" id="msSubject" class="ms-input" maxlength="150" value="${msEsc(d.subject)}" oninput="msState.draft.subject = this.value">
      </label>
      <label class="ms-field"><span>Message * <em>(les {{variables}} restent modifiables avant envoi)</em></span>
        <textarea id="msBody" class="ms-input ms-body" rows="10" oninput="msState.draft.body = this.value">${msEsc(d.body)}</textarea>
      </label>
      ${tips}
      <div class="ms-actions">
        <button type="button" class="admin-btn" ${msState.aiBusy ? 'disabled' : ''} onclick="msImproveWithAi(this)">${msState.aiBusy ? 'Analyse en cours…' : 'Améliorer avec l\'IA'}</button>
        <button type="button" class="admin-btn" onclick="msSaveDraftAsTemplate()">Enregistrer comme modèle</button>
        <span class="ms-actions-spacer"></span>
        <button type="button" class="admin-btn primary" ${msState.sendBusy ? 'disabled' : ''} onclick="msSendDirect(this)">${msState.sendBusy ? 'Envoi…' : 'Envoyer le mail'}</button>
      </div>
      <p class="dh-sub">Le mail part avec la mise en page du centre (en-tête, pied de page) et s'ajoute automatiquement à l'historique.</p>
    </div>
  </section>`;
}

function msApplyTemplate(ref) {
  msState.draft.templateRef = ref;
  if (!ref) return;
  const [kind, key] = ref.split(':');
  const tpl = kind === 'starter'
    ? MS_STARTERS.find((s) => s.key === key)
    : msState.templates.find((t) => String(t.id) === key);
  if (!tpl) return;
  // Le nom du CENTRE COURANT remplace {{centre}} à l'insertion : le texte posé
  // dans le composer est prêt à envoyer, sans jeton brut ni nom d'un autre
  // client. Repli froid : l'id du centre (les listes chargées portent le nom).
  const centreName = (typeof getCurrentStaffCenterName === 'function' && getCurrentStaffCenterName())
    || (typeof getCurrentStaffCenterId === 'function' && getCurrentStaffCenterId())
    || 'votre centre';
  const withCentre = (text) => String(text || '').replace(/\{\{\s*centre\s*\}\}/gi, centreName);
  msState.draft.subject = withCentre(tpl.subject);
  msState.draft.body = withCentre(tpl.body);
  msState.draft.category = tpl.category;
  msState.aiTips = [];
  msRefresh();
}

async function msImproveWithAi(button) {
  const d = msState.draft;
  if (!d.subject.trim() && !d.body.trim()) {
    if (typeof toast === 'function') toast('Écris d\'abord un objet ou un message à améliorer.');
    return;
  }
  msState.aiBusy = true;
  msRefresh();
  try {
    const payload = await apiRequest('/api/ops', {
      method: 'POST',
      body: JSON.stringify({ action: 'improveEmailWithAi', centerId: msCenterId(), subject: d.subject, body: d.body, category: d.category }),
    });
    msState.aiTips = payload.tips || [];
    msState.aiMode = payload.mode || 'deterministe';
    if (payload.mode === 'ia' && payload.subject && payload.body) {
      msState.draft.subject = payload.subject;
      msState.draft.body = payload.body;
      if (typeof toast === 'function') toast('Brouillon réécrit par l\'IA : relis avant envoi.');
    }
  } catch (error) {
    if (typeof toast === 'function') toast(error.message || 'Analyse impossible pour le moment.');
  } finally {
    msState.aiBusy = false;
    msRefresh();
  }
}

async function msSendDirect(button) {
  if (msState.sendBusy) return;
  const d = msState.draft;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.to.trim())) {
    if (typeof toast === 'function') toast('Adresse email du destinataire invalide.');
    return;
  }
  if (!d.subject.trim() || !d.body.trim()) {
    if (typeof toast === 'function') toast('Objet et message sont requis.');
    return;
  }
  if (/\{\{[^}]+\}\}/.test(`${d.subject} ${d.body}`)
    && !window.confirm('Le mail contient encore des {{variables}} non remplacées. Envoyer quand même ?')) {
    return;
  }
  if (!window.confirm(`Envoyer ce mail à ${d.to.trim()} ?`)) return;
  msState.sendBusy = true;
  msRefresh();
  try {
    await apiRequest('/api/ops', {
      method: 'POST',
      body: JSON.stringify(window.PinlaneApiClient.withMessageAttempt(d, {
        action: 'sendDirectEmail',
        centerId: msCenterId(),
        to: d.to.trim(),
        subject: d.subject,
        body: d.body,
        identityId: d.identityId || null,
        category: d.category,
        templateRef: d.templateRef,
      })),
    });
    // Provider configuration is not a delivery receipt. The history carries
    // the actual status, including a queued retry or an earlier cancellation.
    if (typeof toast === 'function') toast('Mail enregistré : consultez son état d\'envoi dans l\'historique.');
    msState.draft = { to: '', subject: '', body: '', identityId: msState.draft.identityId, category: 'marketing', templateRef: '' };
    msState.aiTips = [];
    msState.historyLoaded = false;
  } catch (error) {
    if (typeof toast === 'function') toast(error.message || 'Envoi impossible pour le moment.');
  } finally {
    msState.sendBusy = false;
    msRefresh();
  }
}

async function msSaveDraftAsTemplate() {
  const d = msState.draft;
  if (!d.subject.trim() && !d.body.trim()) {
    if (typeof toast === 'function') toast('Rien à enregistrer : le brouillon est vide.');
    return;
  }
  const name = window.prompt('Nom du modèle :', d.subject.slice(0, 40) || 'Nouveau modèle');
  if (!name) return;
  try {
    const payload = await apiRequest('/api/ops', {
      method: 'POST',
      body: JSON.stringify({ action: 'saveEmailTemplate', centerId: msCenterId(), name, category: d.category, subject: d.subject, body: d.body }),
    });
    msState.templates = [payload.template, ...msState.templates];
    if (typeof toast === 'function') toast('Modèle enregistré.');
    msRefresh();
  } catch (error) {
    if (typeof toast === 'function') toast(error.message || 'Enregistrement impossible.');
  }
}

// ---------------------------------------------------------------------------
// Historique
// ---------------------------------------------------------------------------

const MS_STATUS_LABELS = {
  sent: 'Envoyé', delivered: 'Délivré', queued: 'En file', failed: 'Échec', cancelled: 'Annulé', draft: 'Brouillon',
};

function renderMsHistory() {
  if (!msState.historyLoaded) return '<section class="dh-card"><div class="dh-chart-empty">Chargement de l\'historique…</div></section>';
  const filter = msState.historyFilter.toLowerCase();
  const rows = msState.history
    .filter((c) => c.channel === 'email')
    .filter((c) => !msState.historyStatus || c.status === msState.historyStatus)
    .filter((c) => !filter || `${c.recipient} ${c.subject} ${c.templateId}`.toLowerCase().includes(filter));
  const open = msState.history.find((c) => c.id === msState.openMailId) || null;

  const statusFilters = ['', 'sent', 'queued', 'failed'].map((s) => `
    <button type="button" class="${msState.historyStatus === s ? 'active' : ''}" onclick="msState.historyStatus='${s}';msRefresh()">${s ? MS_STATUS_LABELS[s] : 'Tous'}</button>`).join('');

  const table = rows.length ? `
    <table class="dh-table">
      <thead><tr><th>Date</th><th>Destinataire</th><th>Objet</th><th>Modèle</th><th>Statut</th><th></th></tr></thead>
      <tbody>${rows.slice(0, 100).map((c) => `
        <tr>
          <td class="dh-mono">${msDateFr(c.sentAt || c.createdAt || c.scheduledAt)}</td>
          <td>${msEsc(c.recipient || '-')}</td>
          <td>${msEsc(c.subject || '(sans objet)')}</td>
          <td class="dh-contact">${msEsc((c.templateId || 'direct').replace(/^studio_/, ''))}</td>
          <td><span class="ms-pill ${msEsc(c.status)}">${MS_STATUS_LABELS[c.status] || msEsc(c.status)}</span>${c.lastError ? `<div class="ms-error-hint" title="${msEsc(c.lastError)}">${msEsc(c.lastError.slice(0, 60))}</div>` : ''}</td>
          <td><button type="button" class="admin-btn" onclick="msOpenMail(${c.id})">Voir</button></td>
        </tr>`).join('')}
      </tbody>
    </table>` : '<div class="dh-chart-empty">Aucun mail ne correspond à ces filtres.</div>';

  const viewer = open ? `
    <div class="ms-viewer">
      <div class="ms-viewer-head">
        <div>
          <strong>${msEsc(open.subject || '(sans objet)')}</strong>
          <div class="dh-sub">À ${msEsc(open.recipient)} · ${msDateFr(open.sentAt || open.createdAt)} · <span class="ms-pill ${msEsc(open.status)}">${MS_STATUS_LABELS[open.status] || open.status}</span></div>
        </div>
        <div class="ms-viewer-actions">
          <button type="button" class="admin-btn" onclick="msReuseMail(${open.id})">Réutiliser</button>
          <button type="button" class="admin-btn" onclick="msState.openMailId=null;msRefresh()">Fermer</button>
        </div>
      </div>
      <iframe class="ms-iframe" sandbox="" title="Aperçu du mail"></iframe>
    </div>` : '';

  return `<section class="dh-card">
    <div class="ms-history-bar">
      <input type="search" class="ms-input ms-search" placeholder="Rechercher (destinataire, objet, modèle…)" value="${msEsc(msState.historyFilter)}" oninput="msState.historyFilter=this.value;msRefresh()">
      <div class="dh-range">${statusFilters}</div>
      <button type="button" class="admin-btn" onclick="loadMailHistory(true)">Actualiser</button>
    </div>
    ${table}
    ${viewer}
  </section>`;
}

function msOpenMail(id) {
  msState.openMailId = msState.openMailId === id ? null : id;
  msRefresh();
  // L'iframe sandbox est remplie après rendu (srcdoc via propriété, pas d'attribut inline).
  const open = msState.history.find((c) => c.id === msState.openMailId);
  if (open) {
    requestAnimationFrame(() => {
      const frame = document.querySelector('.ms-iframe');
      if (frame) frame.srcdoc = open.body || `<p style="font-family:sans-serif">${msEsc(open.payload?.textBody || '(vide)')}</p>`;
    });
  }
}

function msReuseMail(id) {
  const mail = msState.history.find((c) => c.id === id);
  if (!mail) return;
  msState.draft = {
    to: mail.recipient || '',
    subject: mail.subject || '',
    body: mail.payload?.textBody || '',
    identityId: msState.draft.identityId,
    category: mail.payload?.category || 'marketing',
    templateRef: '',
  };
  msState.section = 'compose';
  msState.aiTips = [];
  msRefresh();
}

// ---------------------------------------------------------------------------
// Modèles
// ---------------------------------------------------------------------------

function renderMsTemplates() {
  const editing = msState.editingTemplate;
  const form = editing ? `
    <div class="ms-viewer">
      <h3>${editing.id ? 'Modifier le modèle' : 'Nouveau modèle'}</h3>
      <div class="ms-form">
        <div class="ms-grid-2">
          <label class="ms-field"><span>Nom *</span><input type="text" id="msTplName" class="ms-input" value="${msEsc(editing.name || '')}"></label>
          <label class="ms-field"><span>Catégorie</span>
            <select id="msTplCategory" class="ms-input">${Object.entries(MS_CATEGORIES).map(([k, v]) => `<option value="${k}" ${editing.category === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
          </label>
        </div>
        <label class="ms-field"><span>Objet</span><input type="text" id="msTplSubject" class="ms-input" value="${msEsc(editing.subject || '')}"></label>
        <label class="ms-field"><span>Corps</span><textarea id="msTplBody" class="ms-input ms-body" rows="8">${msEsc(editing.body || '')}</textarea></label>
        <div class="ms-actions">
          <button type="button" class="admin-btn primary" onclick="msSaveTemplate(this)">Enregistrer</button>
          <button type="button" class="admin-btn" onclick="msState.editingTemplate=null;msRefresh()">Annuler</button>
        </div>
      </div>
    </div>` : '';

  const grid = msState.templates.length ? `
    <div class="ms-tpl-grid">${msState.templates.map((t) => `
      <div class="ms-tpl-card">
        <div class="ms-tpl-head"><strong>${msEsc(t.name)}</strong><span class="ms-pill">${MS_CATEGORIES[t.category] || t.category}</span></div>
        <div class="ms-tpl-subject">${msEsc(t.subject || '(sans objet)')}</div>
        <div class="ms-tpl-body">${msEsc((t.body || '').slice(0, 140))}${(t.body || '').length > 140 ? '…' : ''}</div>
        <div class="ms-actions">
          <button type="button" class="admin-btn" onclick="msApplyTemplate('custom:${t.id}');msSetSection('compose')">Utiliser</button>
          <button type="button" class="admin-btn" onclick="msEditTemplate(${t.id})">Modifier</button>
          <button type="button" class="admin-btn" onclick="msArchiveTemplate(${t.id})">Archiver</button>
        </div>
      </div>`).join('')}
    </div>` : '<div class="dh-chart-empty">Aucun modèle personnalisé. Créez-en un ou partez d\'un « modèle de départ » dans le composer.</div>';

  return `<section class="dh-card">
    <div class="dh-report-head">
      <h3>Vos modèles (${msState.templates.length})</h3>
      <button type="button" class="admin-btn primary" onclick="msState.editingTemplate={};msRefresh()">Nouveau modèle</button>
    </div>
    <p class="dh-sub">Les modèles de départ (promo, anniversaire, entreprise, relance) sont toujours disponibles dans le composer, enregistrez vos propres versions ici.</p>
    ${form}
    ${grid}
  </section>`;
}

function msEditTemplate(id) {
  const t = msState.templates.find((x) => x.id === id);
  if (t) { msState.editingTemplate = { ...t }; msRefresh(); }
}

async function msSaveTemplate(button) {
  const editing = msState.editingTemplate || {};
  const name = document.getElementById('msTplName')?.value?.trim();
  if (!name) { if (typeof toast === 'function') toast('Nom du modèle requis.'); return; }
  if (button) button.disabled = true;
  try {
    const payload = await apiRequest('/api/ops', {
      method: 'POST',
      body: JSON.stringify({
        action: 'saveEmailTemplate',
        centerId: msCenterId(),
        id: editing.id || null,
        name,
        category: document.getElementById('msTplCategory')?.value,
        subject: document.getElementById('msTplSubject')?.value || '',
        body: document.getElementById('msTplBody')?.value || '',
      }),
    });
    msState.templates = editing.id
      ? msState.templates.map((t) => (t.id === payload.template.id ? payload.template : t))
      : [payload.template, ...msState.templates];
    msState.editingTemplate = null;
    if (typeof toast === 'function') toast('Modèle enregistré.');
  } catch (error) {
    if (typeof toast === 'function') toast(error.message || 'Enregistrement impossible.');
    if (button) button.disabled = false;
    return;
  }
  msRefresh();
}

async function msArchiveTemplate(id) {
  if (!window.confirm('Archiver ce modèle ? Il disparaîtra de la liste (récupérable en base).')) return;
  try {
    await apiRequest('/api/ops', {
      method: 'POST',
      body: JSON.stringify({ action: 'archiveEmailTemplate', centerId: msCenterId(), id }),
    });
    msState.templates = msState.templates.filter((t) => t.id !== id);
    if (typeof toast === 'function') toast('Modèle archivé.');
    msRefresh();
  } catch (error) {
    if (typeof toast === 'function') toast(error.message || 'Archivage impossible.');
  }
}

// ---------------------------------------------------------------------------
// Identités
// ---------------------------------------------------------------------------

function renderMsIdentities() {
  const list = msState.identities.length ? `
    <div class="dh-report-list">${msState.identities.map((i) => `
      <div class="dh-report-item" style="cursor:default">
        <span class="dh-report-kind">${msEsc(i.label)}</span>
        <span class="dh-mono">${msEsc(i.email)}</span>
        ${i.isDefault ? '<span class="ms-pill sent">Par défaut</span>' : `<button type="button" class="admin-btn" onclick="msSetDefaultIdentity(${i.id})">Définir par défaut</button>`}
        <span class="dh-report-meta"><button type="button" class="admin-btn" onclick="msDeleteIdentity(${i.id})">Supprimer</button></span>
      </div>`).join('')}
    </div>` : `<div class="dh-chart-empty">Aucune adresse configurée : les mails partent de l'expéditeur par défaut de la plateforme (${msEsc(msState.channel?.defaultFrom || '')}). Ajoutez vos adresses (contact@, info@, promo@…) dès qu'elles existent.</div>`;

  const form = msState.identityForm ? `
    <div class="ms-viewer">
      <div class="ms-form">
        <div class="ms-grid-2">
          <label class="ms-field"><span>Libellé * (ex : Contact, Info, Promo)</span><input type="text" id="msIdLabel" class="ms-input"></label>
          <label class="ms-field"><span>Adresse email *</span><input type="email" id="msIdEmail" class="ms-input" placeholder="contact@votredomaine.be"></label>
        </div>
        <label class="ms-check"><input type="checkbox" id="msIdDefault"> Utiliser par défaut pour les nouveaux mails</label>
        <div class="ms-actions">
          <button type="button" class="admin-btn primary" onclick="msSaveIdentity(this)">Ajouter</button>
          <button type="button" class="admin-btn" onclick="msState.identityForm=false;msRefresh()">Annuler</button>
        </div>
      </div>
    </div>` : '';

  return `<section class="dh-card">
    <div class="dh-report-head">
      <h3>Adresses d'expéditeur</h3>
      <button type="button" class="admin-btn primary" onclick="msState.identityForm=true;msRefresh()">Ajouter une adresse</button>
    </div>
    <p class="dh-sub">Chaque adresse doit être vérifiée chez le fournisseur d'envoi (domaine validé) pour être réellement utilisée : sinon l'envoi retombe sur l'adresse par défaut.</p>
    ${form}
    ${list}
  </section>`;
}

async function msSaveIdentity(button) {
  const label = document.getElementById('msIdLabel')?.value?.trim();
  const email = document.getElementById('msIdEmail')?.value?.trim();
  if (!label || !email) { if (typeof toast === 'function') toast('Libellé et adresse requis.'); return; }
  if (button) button.disabled = true;
  try {
    const payload = await apiRequest('/api/ops', {
      method: 'POST',
      body: JSON.stringify({
        action: 'saveEmailIdentity',
        centerId: msCenterId(),
        label,
        email,
        isDefault: Boolean(document.getElementById('msIdDefault')?.checked),
      }),
    });
    await loadMailStudio(true);
    msState.identityForm = false;
    if (typeof toast === 'function') toast('Adresse ajoutée.');
  } catch (error) {
    if (typeof toast === 'function') toast(error.message || 'Ajout impossible.');
    if (button) button.disabled = false;
  }
  msRefresh();
}

async function msSetDefaultIdentity(id) {
  const identity = msState.identities.find((i) => i.id === id);
  if (!identity) return;
  try {
    await apiRequest('/api/ops', {
      method: 'POST',
      body: JSON.stringify({ action: 'saveEmailIdentity', centerId: msCenterId(), id, label: identity.label, email: identity.email, isDefault: true }),
    });
    await loadMailStudio(true);
  } catch (error) {
    if (typeof toast === 'function') toast(error.message || 'Modification impossible.');
  }
}

async function msDeleteIdentity(id) {
  if (!window.confirm('Supprimer cette adresse d\'expéditeur ?')) return;
  try {
    await apiRequest('/api/ops', {
      method: 'POST',
      body: JSON.stringify({ action: 'deleteEmailIdentity', centerId: msCenterId(), id }),
    });
    await loadMailStudio(true);
    if (typeof toast === 'function') toast('Adresse supprimée.');
  } catch (error) {
    if (typeof toast === 'function') toast(error.message || 'Suppression impossible.');
  }
}

// ---------------------------------------------------------------------------
// Analyse
// ---------------------------------------------------------------------------

function renderMsInsights() {
  if (!msState.insightsLoaded) return '<section class="dh-card"><div class="dh-chart-empty">Analyse des envois…</div></section>';
  const ins = msState.insights;
  if (!ins) return '<section class="dh-card"><div class="dh-chart-empty">Analyse momentanément indisponible.</div></section>';
  const t = ins.totals;

  const tiles = [
    { label: 'Mails au total', value: t.total },
    { label: 'Envoyés', value: t.sent },
    { label: 'Échecs', value: t.failed, sub: `${t.failRate} % des tentatives` },
    { label: 'En file', value: t.queued },
  ].map((k) => `<div class="dh-tile">
    <div class="dh-tile-label">${k.label}</div>
    <div class="dh-tile-value">${k.value}</div>
    <div class="dh-tile-foot">${k.sub ? `<span class="dh-tile-sub">${k.sub}</span>` : ''}</div>
  </div>`).join('');

  const maxWeek = Math.max(...ins.weekly.map((w) => Number(w.count)), 1);
  const weeklyBars = ins.weekly.length ? `<div class="dh-rows">${ins.weekly.map((w) => `
    <div class="dh-row">
      <div class="dh-row-label">Sem. ${msEsc(String(w.week).slice(5))}</div>
      <div class="dh-row-track"><div class="dh-row-bar" style="width:${Math.max((Number(w.count) / maxWeek) * 100, 2)}%;background:var(--chart-1)"></div></div>
      <div class="dh-row-value">${w.count}</div>
    </div>`).join('')}</div>` : '<div class="dh-chart-empty">Pas encore d\'envois sur 8 semaines.</div>';

  const maxTpl = Math.max(...ins.byTemplate.map((x) => Number(x.count)), 1);
  const templateBars = ins.byTemplate.length ? `<div class="dh-rows">${ins.byTemplate.map((x) => `
    <div class="dh-row">
      <div class="dh-row-label">${msEsc((x.template_id || 'direct').replace(/^studio_/, ''))}</div>
      <div class="dh-row-track"><div class="dh-row-bar" style="width:${Math.max((Number(x.count) / maxTpl) * 100, 2)}%;background:var(--chart-2)"></div></div>
      <div class="dh-row-value">${x.count}</div>
    </div>`).join('')}</div>` : '<div class="dh-chart-empty">Aucun envoi sur 30 jours.</div>';

  const failures = ins.failureReasons.length ? `
    <ul class="ms-failures">${ins.failureReasons.map((f) => `<li><span class="ms-pill failed">${f.count}×</span> ${msEsc(f.reason)}</li>`).join('')}</ul>`
    : '<div class="dh-chart-empty">Aucun échec sur 90 jours.</div>';

  return `
    <div class="dh-tiles">${tiles}</div>
    <div class="dh-grid-2">
      <section class="dh-card"><h3>Volume par semaine (8 sem.)</h3>${weeklyBars}</section>
      <section class="dh-card"><h3>Par modèle (30 jours)</h3>${templateBars}</section>
    </div>
    <div class="dh-grid-2">
      <section class="dh-card"><h3>Causes d'échec (90 jours)</h3>${failures}</section>
      <section class="dh-card"><h3>Recommandations</h3>
        <ul class="ms-recos">${ins.recommendations.map((r) => `<li>${msEsc(r)}</li>`).join('')}</ul>
        <button type="button" class="admin-btn" onclick="loadMailInsights(true)">Recalculer</button>
      </section>
    </div>`;
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function initAdminMailTab() {
  loadMailStudio();
}

// Test INTERACTIF de la page Emails & relances v3 (vraie gestion de mails).
// Playwright pilote de vrais clics : séquences automatiques (toggle + éditeur
// complet sujet/corps/timing + reset), composer universel (autocomplete client,
// identités, modèles, envoi sendDirectEmail), boîte de réception (pipe Reçus,
// analyse IA, réponse 1-clic avec replyToCommunicationId), « Coller un mail
// reçu », pv2OpenComposer préfill. Contrats : spec emails-v3 (C1-C5, C8, C9).
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_EMAILS_PORT || 4217);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function serveStatic() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname === '') filePath = path.join(ROOT, 'index.html');
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(content);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

async function installMock(page) {
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await page.addInitScript(({ expiresAt }) => {
    const perms = ['dashboard.view', 'planning.view', 'reservations.view', 'clients.view', 'emails.view', 'emails.send', 'campaigns.manage', 'marketing.agents', 'settings.manage', 'direction.view'];
    const qaSession = { token: 'qa', cookieBacked: false, centerId: 'libramont', expiresAt, member: { id: 'qa', name: 'QA', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };
    // État serveur simulé des séquences : settings = overrides, defaults =
    // textes/timings de référence (contrat C1). Le POST étendu mute ce state.
    const autoState = {
      request_received: { enabled: true }, confirmation: { enabled: true }, reminder_48h: { enabled: true }, post_visit: { enabled: true },
      birthday_j30: { enabled: true }, reactivation: { enabled: false },
    };
    const VARS = ['prenom', 'date', 'heure', 'formule', 'pax', 'centre'];
    const autoDefaults = {
      request_received: { enabled: true, subject: 'On a bien reçu votre demande', body: 'Bonjour {{prenom}}, votre demande du {{date}} est bien arrivée.', variables: VARS },
      confirmation: { enabled: true, subject: 'Votre réservation est confirmée', body: 'Bonjour {{prenom}}, votre réservation du {{date}} à {{heure}} est confirmée.', variables: VARS },
      reminder_48h: { enabled: true, subject: 'Rappel de votre venue', body: 'Bonjour {{prenom}}, on vous attend le {{date}} à {{heure}}.', offsetDays: 2, variables: VARS },
      post_visit: { enabled: true, subject: 'Merci de votre visite', body: 'Merci {{prenom}} ! Revenez quand vous voulez.', offsetDays: 1, variables: VARS },
      birthday_j30: { enabled: true, subject: 'L’anniversaire approche', body: 'Bonjour {{prenom}}, on vous re-réserve la fête ?', offsetDays: 30, variables: VARS },
      reactivation: { enabled: false, subject: 'Ça fait un moment', body: 'Bonjour {{prenom}}, bowling et laser vous attendent.', cap: 20, variables: VARS },
    };
    const autoStats = {
      request_received: { sent30d: 37, failed30d: 20 }, confirmation: { sent30d: 42, failed30d: 1 }, reminder_48h: { sent30d: 31, failed30d: 0 },
      post_visit: { sent30d: 28, failed30d: 2 }, birthday_j30: { sent30d: 4, failed30d: 0 }, reactivation: { sent30d: 0, failed30d: 0 },
    };
    const comms = [
      { id: 1, centerId: 'libramont', channel: 'email', direction: 'outbound', templateId: 'confirmation', recipient: 'a@x.be', subject: 'Votre réservation est confirmée', status: 'delivered', sentAt: new Date(Date.now() - 3600e3).toISOString(), payload: { textBody: 'Bonjour, votre réservation est confirmée.' } },
      { id: 2, centerId: 'libramont', channel: 'email', direction: 'outbound', templateId: 'reminder_48h', recipient: 'b@x.be', subject: 'Rappel de votre venue', status: 'queued', scheduledAt: new Date(Date.now() + 3600e3).toISOString(), payload: {} },
      { id: 3, centerId: 'libramont', channel: 'email', direction: 'outbound', templateId: 'birthday_j30', recipient: 'c@x.be', subject: 'L’anniversaire approche 🎂', status: 'failed', lastError: 'You can only send testing emails to your own email address (proprio@example.com). To send emails to other recipients, please verify a domain at resend.com/domains', attempts: 2, payload: {} },
      // Boîte de réception : 2 mails reçus analysés (contrat C4/C5).
      { id: 4, centerId: 'libramont', channel: 'email', direction: 'inbound', status: 'received', templateId: null, recipient: 'client1@x.be', subject: 'Anniversaire pour mon fils', createdAt: new Date(Date.now() - 7200e3).toISOString(), payload: { from: 'client1@x.be', textBody: 'Bonjour, je voudrais organiser un anniversaire pour mon fils de 8 ans, vous avez de la place samedi ?', analysis: { intent: 'anniversaire', intentLabel: 'Anniversaire', summary: 'Veut organiser un anniversaire (8 ans) et demande la dispo de samedi', urgency: 'normale', reply: { subject: 'Re: Anniversaire pour mon fils', body: 'Bonjour,\n\nAvec plaisir ! Dites-nous la date exacte et le nombre d’enfants, on vous propose la formule adaptée.\n\nL’équipe Fun Galaxy' }, clientName: 'Client Un', provider: 'rules' } } },
      { id: 5, centerId: 'libramont', channel: 'email', direction: 'inbound', status: 'received', templateId: null, recipient: 'client2@x.be', subject: 'Annulation résa de demain', createdAt: new Date(Date.now() - 3600e3).toISOString(), payload: { from: 'client2@x.be', textBody: 'Je dois annuler ma réservation de demain, désolé.', repliedAt: new Date(Date.now() - 1800e3).toISOString(), replyCommunicationId: 77, analysis: { intent: 'annulation', intentLabel: 'Annulation', summary: 'Annule sa réservation de demain', urgency: 'haute', reply: { subject: 'Re: Annulation résa de demain', body: 'Bonjour, c’est noté, votre réservation est annulée.' }, provider: 'rules' } } },
    ];
    const lanes = () => Array.from({ length: 8 }).reduce((a, _, i) => { a[i + 1] = 'active'; return a; }, {});
    const J = (p) => new Response(JSON.stringify(p), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', etag: `qa-${Date.now()}` } });
    const nf = window.fetch.bind(window);
    window.__QA_POSTS__ = [];
    window.__QA_EMAIL_META_REQUESTS__ = { studio: 0, legacy: 0 };
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const u = new URL(raw, window.location.origin);
      const m = String(init.method || 'GET').toUpperCase();
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session: qaSession, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: perms }], members: [{ id: 'qa', name: 'QA', contact: 'q@x', roleId: 'direction', status: 'active', code: 'X', lastSeen: new Date().toISOString() }], events: [], permissions: perms } });
      if (u.pathname === '/api/staff-state') return J({ ok: true, revision: 'qa', reservations: [], laneStatuses: lanes(), centerId: 'libramont' });
      if (u.pathname === '/api/admin-range') return J({ ok: true, reservations: [], emails: [], agentEvents: [], centerId: 'libramont' });
      if (u.pathname === '/api/marketing-agents') return J({ ok: true, centers: [], updatedAt: new Date().toISOString() });
      if (u.pathname === '/api/ops' && m === 'POST') {
        const b = JSON.parse(init.body || '{}');
        window.__QA_POSTS__.push(b);
        if (b.action === 'automationSettings') {
          if (b.reset) {
            autoState[b.key] = { enabled: !!(autoState[b.key] && autoState[b.key].enabled) };
          } else if (autoState[b.key]) {
            if ('enabled' in b) autoState[b.key].enabled = !!b.enabled;
            if (b.subject !== undefined) autoState[b.key].subject = b.subject;
            if (b.body !== undefined) autoState[b.key].body = b.body;
            if (b.offsetDays !== undefined) autoState[b.key].offsetDays = Number(b.offsetDays);
            if (b.cap !== undefined) autoState[b.key].cap = Number(b.cap);
          }
          return J({ ok: true, settings: JSON.parse(JSON.stringify(autoState)), defaults: autoDefaults, stats: autoStats });
        }
        if (b.action === 'sendDirectEmail') {
          return J({ ok: true, communication: { id: 99, status: 'queued' } });
        }
        // Aperçu et test rendus par le serveur : le front ne fabrique jamais le
        // HTML du mail lui-même.
        if (b.action === 'automationPreview') {
          return J({ ok: true, subject: `Aperçu ${b.key}`, html: `<html><body><p>Rendu serveur de ${b.key}</p></body></html>`, textBody: 'texte' });
        }
        if (b.action === 'sendAutomationTest') {
          return J({ ok: true, recipient: 'qa@fungalaxy.be', subject: `[TEST] ${b.key}`, status: 'sent', error: '' });
        }
        if (b.action === 'retryCommunication') {
          const target = comms.find((c) => Number(c.id) === Number(b.id));
          if (target) { target.status = 'sent'; target.lastError = ''; target.sentAt = new Date().toISOString(); }
          return J({ ok: true, id: b.id, status: 'sent', error: '' });
        }
        if (b.action === 'analyzeInboundEmail') {
          const analysis = { intent: 'prix', intentLabel: 'Prix', summary: 'Demande le prix pour un groupe', urgency: 'normale', reply: { subject: 'Re: votre demande', body: 'Bonjour, on vous confirme le tarif par retour.' }, provider: 'rules' };
          if (b.store) {
            comms.push({ id: 6, centerId: 'libramont', channel: 'email', direction: 'inbound', status: 'received', templateId: null, recipient: b.from, subject: 'Mail collé', createdAt: new Date().toISOString(), payload: { from: b.from, textBody: b.body, analysis } });
            return J({ ok: true, communication: { id: 6 }, analysis });
          }
          return J({ ok: true, analysis });
        }
        if (b.action === 'customSequences') {
          if (b.op === 'delete') { window.__QA_SEQS__ = []; return J({ ok: true, sequences: [] }); }
          const saved = { id: 'cs_test1', enabled: true, ...(b.sequence || {}) };
          window.__QA_SEQS__ = [saved];
          return J({ ok: true, sequences: [saved] });
        }
        if (b.action === 'emailBrain') {
          return J({ ok: true, overrides: { faq: b.faq || {}, signature: b.signature || '', extra: b.extra || '' }, defaults: { intents: {}, faq: {}, signature: '' } });
        }
        if (b.action === 'saveEmailTemplate') return J({ ok: true, template: { id: 8 } });
        if (b.action === 'saveEmailIdentity') return J({ ok: true, identity: { id: 3 } });
        if (b.action === 'improveEmailWithAi') {
          return J({ ok: true, mode: 'ia', tips: ['Objet un peu court : vise 30-60 caractères.'], subject: 'Sujet amélioré par IA', body: 'Corps amélioré par IA.' });
        }
        if (b.action === 'directEmailPreview') {
          return J({ ok: true, subject: b.subject || 'Aperçu', html: `<html><body><p>apercu serveur : ${b.subject || ''}</p></body></html>` });
        }
        return J({ ok: true });
      }
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'automationSettings') {
        return J({ ok: true, settings: JSON.parse(JSON.stringify(autoState)), defaults: autoDefaults, stats: autoStats });
      }
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'customSequences') {
        return J({ ok: true, sequences: window.__QA_SEQS__ || [], limits: { maxSequences: 10, cap: [1, 100], triggers: { after_visit: { label: 'X jours après une visite', days: [1, 90], variables: ['prenom', 'centre'] }, before_visit: { label: 'X jours avant une venue prévue', days: [1, 60], variables: ['prenom', 'centre', 'date', 'heure', 'formule', 'pax'] }, inactive: { label: 'Clients plus vus depuis X jours', days: [30, 365], variables: ['prenom', 'centre'] }, weekly: { label: 'Chaque semaine, un jour fixe', variables: ['prenom', 'centre'] }, monthly: { label: 'Chaque mois, un jour fixe', variables: ['prenom', 'centre'] } }, segments: { all: 'Tous les clients avec email', dormant: 'Dormants (+90 jours)', loyal: 'Fidèles', birthdays: 'Clients anniversaire' } } });
      }
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'emailBrain') {
        return J({ ok: true, overrides: { faq: {}, signature: '', extra: '' }, defaults: { intents: { reservation: 'Réservation', annulation: 'Annulation / report', anniversaire: 'Anniversaire', prix: 'Prix & tarifs', horaires: 'Horaires', reclamation: 'Réclamation', autre: 'Autre' }, faq: { horaires: { subject: 'Nos horaires', body: 'Réponse type horaires du fichier.' } }, signature: "L'équipe Fun Galaxy" } });
      }
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'emailStudio') {
        window.__QA_EMAIL_META_REQUESTS__.studio += 1;
        return J({ ok: true, templates: [{ id: 7, label: 'Modèle maison', subject: 'Sujet du modèle {{prenom}}', body: 'Corps du modèle pour {{prenom}}.' }], identities: [{ id: 1, label: 'Accueil', email: 'contact@fungalaxy.be', isDefault: true }, { id: 2, label: 'Direction', email: 'direction@fungalaxy.be' }], channel: { resendConfigured: true, aiConfigured: false } });
      }
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'emailTemplates') {
        window.__QA_EMAIL_META_REQUESTS__.legacy += 1;
        return J({ ok: false, error: 'Action Ops GET inconnue.' });
      }
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'communications') return J({ ok: true, communications: comms });
      if (u.pathname === '/api/ops') return J({ ok: true, communications: comms, samples: [], suggestions: [], events: [], ecosystem: null, agents: [], activations: [], orchestration: {} });
      if (u.pathname === '/api/simulation') return J({ ok: true, status: 'idle', simulation: null });
      if (u.pathname === '/api/public-booking-meta') return J({ ok: true, today: new Date().toISOString().slice(0, 10), durationOptions: [], formules: [], center: { id: 'libramont', status: 'active', defaultSchedule: { regular: { '0': { open: '10:00', close: '22:00' }, '1': null, '2': { open: '14:00', close: '22:00' }, '3': { open: '12:00', close: '22:00' }, '4': { open: '14:00', close: '22:00' }, '5': { open: '14:00', close: '24:00' }, '6': { open: '10:00', close: '24:00' } }, holiday: {} }, holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] }, offerAvailability: {} } });
      return nf(input, init);
    };
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession));
  }, { expiresAt });
}

let failures = 0;
function ok(cond, label) { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`); if (!cond) failures += 1; return cond; }

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  const errs = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errs.push(msg.text()); });
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  const missed = new Set();
  page.on('response', (r) => { if (r.status() === 404) { const u = new URL(r.url()); missed.add(u.pathname + u.search); } });
  try {
    await installMock(page);
    await page.goto(`${BASE_URL}/?v=em-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
    await page.evaluate(() => {
      state.staffMenuPage = 'emails'; state.staffTheme = 'dark';
      save(); setView('staff'); renderStaff();
    });
    await page.waitForTimeout(900);
    await page.waitForFunction(() => typeof opsAdminCache !== 'undefined' && (opsAdminCache.communications || []).length > 0, null, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(200);

    // Captures optionnelles : PINLANE_EMAILS_SHOTS=<dossier> pour REGARDER la
    // page au lieu de la deviner. Le harnais est deja monte (mock, session,
    // navigation) : le dupliquer ailleurs le ferait diverger silencieusement.
    // N'altere ni les assertions ni le code de sortie.
    if (process.env.PINLANE_EMAILS_SHOTS) {
      const shotDir = process.env.PINLANE_EMAILS_SHOTS;
      fs.mkdirSync(shotDir, { recursive: true });
      // setStaffTheme() est le SEUL chemin qui pose data-theme sur <html>
      // (app-main.js, applyStaffTheme). Affecter state.staffTheme a la main
      // change la variable et rien d'autre : les deux captures sortaient
      // identiques, en sombre, et le theme clair n'etait jamais regarde.
      for (const theme of ['dark', 'light']) {
        await page.evaluate((t) => { setStaffTheme(t); }, theme);
        await page.waitForTimeout(500);
        await page.setViewportSize({ width: 1400, height: 900 });
        await page.waitForTimeout(200);
        await page.screenshot({ path: path.join(shotDir, `emails-${theme}-desktop.png`), fullPage: true });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(shotDir, `emails-${theme}-mobile.png`), fullPage: true });
      }
      // L'inventaire « Tous les mails du centre » est replie par defaut : sans
      // cette capture, son etat deplie n'est jamais regarde par personne.
      await page.setViewportSize({ width: 1400, height: 900 });
      await page.evaluate(() => { setStaffTheme('dark'); pv2ToggleMailInventory(); });
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(shotDir, 'emails-dark-inventaire.png'), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(shotDir, 'emails-dark-inventaire-mobile.png'), fullPage: true });
      await page.setViewportSize({ width: 1400, height: 900 });
      await page.evaluate(() => { pv2ToggleMailInventory(); });
      await page.waitForTimeout(400);
      console.log(`[SHOTS] captures ecrites dans ${shotDir}`);
    }

    console.log('\n[LOAD] page Emails v3');
    const load = await page.evaluate(() => ({
      cards: document.querySelectorAll('#staffEmailsPage .mk-auto').length,
      labels: [...document.querySelectorAll('#staffEmailsPage .mk-auto-head strong')].map((el) => el.textContent),
      switches: document.querySelectorAll('#staffEmailsPage .mk-switch').length,
      onCount: document.querySelectorAll('#staffEmailsPage .mk-switch.is-on').length,
      statsTxt: (document.querySelector('#staffEmailsPage .mk-auto .mk-auto-stats') || {}).textContent || '',
      previewBtns: [...document.querySelectorAll('#staffEmailsPage .mk-auto .mk-auto-preview')].filter((el) => /Voir le mail/.test(el.textContent)).length,
      editBtns: document.querySelectorAll('#staffEmailsPage .mk-auto-edit-btn').length,
      pipeline: document.querySelectorAll('#staffEmailsPage .pv2-pipe').length,
      tableRows: document.querySelectorAll('#staffEmailsPage .pv2-table tbody tr').length,
      newMsgBtn: [...document.querySelectorAll('#staffEmailsPage .pv2-bar-actions button')].some((b) => /Nouveau message/.test(b.textContent)),
      emailMetaRequests: { ...window.__QA_EMAIL_META_REQUESTS__ },
      // Libelle renomme : « Analyser un reçu » se lisait comme un reçu de
      // caisse. Le panneau sert a COLLER un mail reçu d'un client.
      analyzeBtn: [...document.querySelectorAll('#staffEmailsPage .pv2-bar-actions button')].some((b) => /Coller un mail reçu/.test(b.textContent)),
      alert: (document.querySelector('#staffEmailsPage .pv2-alert') || {}).textContent || '',
      failedCellTxt: [...document.querySelectorAll('#staffEmailsPage .pv2-cell-fail')].map((el) => el.textContent).join(' | '),
      pageText: (document.getElementById('staffEmailsPage') || {}).textContent || '',
      pipeAll: ((document.querySelector('#staffEmailsPage .pv2-pipe[data-pipe="all"]') || {}).textContent || '').trim().replace(/\s+/g, ' '),
      pipeSent: ((document.querySelector('#staffEmailsPage .pv2-pipe[data-pipe="sent"] .pv2-pipe-value') || {}).textContent || '') + ' ' + ((document.querySelector('#staffEmailsPage .pv2-pipe[data-pipe="sent"] .pv2-pipe-label') || {}).textContent || ''),
      pipeFailed: ((document.querySelector('#staffEmailsPage .pv2-pipe[data-pipe="failed"] .pv2-pipe-value') || {}).textContent || '') + ' ' + ((document.querySelector('#staffEmailsPage .pv2-pipe[data-pipe="failed"] .pv2-pipe-label') || {}).textContent || ''),
      pipeQueuedTone: [...document.querySelectorAll('#staffEmailsPage .pv2-table tbody .pv2-chip')].map((c) => (/En attente/.test(c.textContent) ? [...c.classList].find((k) => k !== 'pv2-chip') : '')).filter(Boolean)[0] || '',
    }));
    if (missed.size) console.log('URLs 404 :', [...missed].slice(0, 5).join(' · '));
    ok(errs.length === 0, `aucune erreur console (${errs.length})${errs.length ? ' → ' + errs.slice(0, 3).join(' | ') : ''}`);
    ok(load.cards === 6, `6 cartes séquences, Demande recue incluse (obtenu ${load.cards})`);
    ok(load.labels.some((l) => /30 jours avant l’anniversaire/.test(l)) && load.labels.some((l) => /Réactiver les clients dormants/.test(l)), 'séquences anniversaire + réactivation présentes, libellées en français lisible');
    // F6 : aucun jargon ne doit revenir par la fenêtre sur cet écran.
    // « no-show » a survécu à la passe précédente ALORS QU'une assertion de
    // non-régression existait déjà sur le sujet : elle ne listait pas le mot.
    // Une assertion qui ne nomme pas la propriété qui échoue reste verte pour
    // rien. Le seul anglicisme restant de l'écran est donc nommé ici.
    ok(!/J-30|En file|no.?show/i.test(load.pageText), `aucun jargon résiduel (J-30 / En file / no-show) sur la page`);
    ok(load.onCount === 5, `5 séquences ON au départ (obtenu ${load.onCount})`);
    ok(/37\u00a0envoyés/.test(load.statsTxt), `stats 30 j affichées avec espace insécable (${JSON.stringify(load.statsTxt.trim().slice(0, 30))})`);
    ok(/sur 30\u00a0jours/.test(load.statsTxt), 'période explicite sur la carte de séquence (F8), unité insécable');
    ok(load.previewBtns === 6, `« Voir le mail » sur chaque carte : l'aperçu est le VRAI mail rendu serveur (obtenu ${load.previewBtns})`);
    ok(load.editBtns === 6, `bouton Modifier sur chaque carte (obtenu ${load.editBtns})`);
    // COMPORTEMENT : le clic carte (éditeur FERMÉ) rend le mail réellement en
    // vigueur (aucun brouillon d'une autre carte), dans l'iframe sandboxée.
    const cardPreview = await page.evaluate(async () => {
      const before = window.__QA_POSTS__.filter((p) => p.action === 'automationPreview').length;
      [...document.querySelectorAll('#staffEmailsPage .mk-auto .mk-auto-preview')].find((el) => /Voir le mail/.test(el.textContent)).click();
      await new Promise((r) => setTimeout(r, 400));
      const post = window.__QA_POSTS__.filter((p) => p.action === 'automationPreview').slice(-1)[0];
      const overlay = document.getElementById('emailPreviewOverlay');
      const frame = overlay ? overlay.querySelector('iframe') : null;
      const out = { posted: window.__QA_POSTS__.filter((p) => p.action === 'automationPreview').length - before, noDraft: post && post.subject === undefined && post.body === undefined, sandboxed: frame ? frame.getAttribute('sandbox') === '' : false };
      if (typeof closeEmailPreview === 'function') closeEmailPreview();
      return out;
    });
    ok(cardPreview.posted === 1 && cardPreview.sandboxed, 'clic « Voir le mail » -> rendu serveur dans l\'iframe sandboxée');
    ok(cardPreview.noDraft, 'éditeur fermé -> AUCUN brouillon joint : le mail montré est celui en vigueur');
    ok(load.pipeline === 6, `pipeline avec pipe Reçus (obtenu ${load.pipeline})`);
    ok(/^1 Échec$/.test(load.pipeFailed), `accord du libellé au compteur : « ${load.pipeFailed} » et non « 1 Échecs »`);
    ok(/^1 Envoyé$/.test(load.pipeSent), `accord du libellé au compteur : « ${load.pipeSent} »`);
    ok(/^Tout\s*\(3\)$/.test(load.pipeAll), `total invariable écrit « Tout (3) » et non « 3 Tout » (obtenu « ${load.pipeAll} »)`);
    ok(load.pipeQueuedTone === 'amber', `« En attente » est un état d'attente, donc ambre et non bleu (obtenu ${load.pipeQueuedTone || 'aucun'})`);
    ok(load.tableRows === 3, `file d'envoi = 3 lignes, reçus exclus (obtenu ${load.tableRows})`);
    ok(load.newMsgBtn && load.analyzeBtn, 'boutons « Nouveau message » + « Coller un mail reçu » dans la bar');

    // Un mail qui n'est pas parti doit se voir SANS avoir a le chercher : la
    // fixture contient 1 echec (« Mailbox full »), le bandeau doit s'imposer en
    // tete de page et nommer la cause en francais.
    /* ══ G2 : LE CABLAGE DES FILTRES ═══════════════════════════════════════
       Trou demontre par mutation : un relecteur a recable le segment « Echecs »
       sur la cle de filtre des envoyes (les echecs devenaient INATTEIGNABLES
       depuis la barre) et le gate sortait ALL OK. Il ne verifiait que la
       PRESENCE de six boutons, jamais ce qu'un clic produit.
       On CLIQUE donc chaque segment, et on lit la file obtenue : nombre de
       lignes, colonne de tete, ET statut lu dans chaque ligne. Une regex sur le
       source ne verrait pas la difference ; un vrai clic suivi d'un vrai releve,
       si. */
    console.log('\n[G2 CABLAGE DES FILTRES] un clic par segment, on lit la file obtenue');
    // Les comptes ATTENDUS sont derives des donnees vivantes, pas ecrits en dur :
    // le scenario precedent a deja envoye des mails et colle un mail recu, donc
    // un chiffre fige serait faux. Ils sont calcules par un chemin INDEPENDANT
    // du cablage teste (on lit le statut brut de chaque ligne de donnees, on ne
    // rappelle pas le filtre de l'application).
    const expected = await page.evaluate(() => {
      const rows = getStaffEmailRows();
      const inbound = (r) => r.direction === 'inbound' || r.status === 'received';
      const out = rows.filter((r) => !inbound(r));
      return {
        all: out.length,
        failed: out.filter((r) => r.statusKind === 'failed').length,
        sent: out.filter((r) => r.statusKind === 'sent').length,
        queued: out.filter((r) => r.statusKind === 'queued').length,
        inbound: rows.filter(inbound).length,
        review: out.filter((r) => r.templateId === 'staff_review_request').length,
      };
    });
    const segCases = [
      { key: 'all', status: null, head: 'Message' },
      { key: 'failed', status: 'Échec', head: 'Message' },
      { key: 'sent', status: 'Envoyé', head: 'Message' },
      { key: 'queued', status: 'En attente', head: 'Message' },
      { key: 'inbound', status: null, head: 'De' },
      { key: 'review', status: null, head: 'Message' },
    ];
    // Un jeu de donnees ou tous les segments seraient vides validerait tout et
    // ne prouverait rien : on exige au moins un segment non vide avant de lire.
    ok(expected.failed + expected.sent + expected.queued + expected.inbound > 0,
      'echantillon non vide : ' + JSON.stringify(expected));
    for (const c of segCases) {
      const seen = await page.evaluate(async (key) => {
        const btn = document.querySelector('#staffEmailsPage .pv2-pipe[data-pipe="' + key + '"]');
        if (!btn) return { missing: true, rows: -1, head: '', statuses: [], activeKey: '' };
        btn.click();
        await new Promise((r) => setTimeout(r, 250));
        const body = [...document.querySelectorAll('#staffEmailsPage .pv2-mail-list .pv2-table tbody tr')];
        const dataRows = body.filter((tr) => !tr.querySelector('.pv2-empty'));
        const active = document.querySelector('#staffEmailsPage .pv2-pipe.active');
        return {
          missing: false,
          activeKey: active ? active.getAttribute('data-pipe') : '',
          rows: dataRows.length,
          head: ((document.querySelector('#staffEmailsPage .pv2-mail-list thead th') || {}).textContent || '').trim(),
          statuses: dataRows.map((tr) => (tr.children[tr.children.length - 2].textContent || '').trim()),
        };
      }, c.key);
      ok(!seen.missing && seen.activeKey === c.key, 'segment « ' + c.key + ' » : c\'est bien lui qui devient actif (obtenu ' + (seen.activeKey || 'aucun') + ')');
      ok(seen.rows === expected[c.key], 'segment « ' + c.key + ' » : la file affichee correspond au segment (' + expected[c.key] + ' attendue(s), ' + seen.rows + ' affichee(s))');
      ok(seen.head === c.head, 'segment « ' + c.key + ' » : colonne de tete « ' + c.head + ' » (obtenu « ' + seen.head + ' »)');
      if (c.status) {
        ok(seen.statuses.length > 0 && seen.statuses.every((t) => t.includes(c.status)),
          'segment « ' + c.key + ' » : chaque ligne affichee porte le statut « ' + c.status + ' » (obtenu ' + JSON.stringify(seen.statuses) + ')');
      }
    }
    await page.evaluate(() => { pv2EmailFilter('all'); });
    await page.waitForTimeout(250);
    console.log('\n[ECHECS] remontee proactive en tete de page');
    ok(/1 mail n'est jamais parti|1 mail n’est jamais parti/.test(load.alert), `bandeau d'alerte affiche (${load.alert.trim().slice(0, 60)})`);
    ok(/Domaine d.envoi pas encore vérifié/.test(load.alert), 'cause traduite en francais, pas le message brut du fournisseur');
    ok(!/resend.com.domains/.test(load.alert), 'le message technique brut ne remonte pas dans le bandeau');
    ok(/Domaine d.envoi pas encore vérifié/.test(load.failedCellTxt), `cause lisible directement dans la liste (${load.failedCellTxt})`);

    console.log('\n[ECHECS] renvoyer un mail en echec');
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('#staffEmailsPage .pv2-table tbody tr')].find((r) => /Échec/.test(r.textContent));
      row.click();
    });
    await page.waitForTimeout(300);
    const failDetail = await page.evaluate(() => ({
      fix: (document.querySelector('#staffEmailsPage .pv2-mail-error') || {}).textContent || '',
      rawHidden: !!document.querySelector('#staffEmailsPage .pv2-mail-error-raw'),
      retryBtn: [...document.querySelectorAll('#staffEmailsPage .pv2-mail-error-actions button')].some((b) => /Renvoyer/.test(b.textContent)),
    }));
    ok(/domaine du centre n.est pas vérifié/.test(failDetail.fix), 'le detail dit QUOI FAIRE, pas seulement que ca a rate');
    ok(failDetail.rawHidden, 'message technique conserve, replie sous « Message technique »');
    ok(failDetail.retryBtn, 'bouton « Renvoyer ce mail » propose sur un echec recent');
    await page.evaluate(() => {
      [...document.querySelectorAll('#staffEmailsPage .pv2-mail-error-actions button')].find((b) => /Renvoyer/.test(b.textContent)).click();
    });
    await page.waitForTimeout(400);
    const retried = await page.evaluate(() => window.__QA_POSTS__.filter((p) => p.action === 'retryCommunication').slice(-1)[0]);
    ok(retried && Number(retried.id) === 3, `POST retryCommunication {id} (obtenu ${JSON.stringify(retried)})`);

    console.log('\n[TOGGLE] activer Réactivation → POST + switch ON');
    await page.evaluate(() => {
      const card = [...document.querySelectorAll('#staffEmailsPage .mk-auto')].find((c) => c.querySelector('[data-switch-key="auto:reactivation"]'));
      card.querySelector('.mk-switch').click();
    });
    await page.waitForTimeout(400);
    const afterOn = await page.evaluate(() => ({
      posts: window.__QA_POSTS__.filter((p) => p.action === 'automationSettings'),
      onCount: document.querySelectorAll('#staffEmailsPage .mk-switch.is-on').length,
    }));
    ok(afterOn.posts.length === 1 && afterOn.posts[0].key === 'reactivation' && afterOn.posts[0].enabled === true, 'POST automationSettings {reactivation, true}');
    ok(afterOn.onCount === 6, 'switch Réactivation passé ON');

    console.log('\n[TOGGLE] couper Anniversaire J-30 → POST enabled:false');
    await page.evaluate(() => {
      const card = [...document.querySelectorAll('#staffEmailsPage .mk-auto')].find((c) => c.querySelector('[data-switch-key="auto:birthday_j30"]'));
      card.querySelector('.mk-switch').click();
    });
    await page.waitForTimeout(400);
    const afterOff = await page.evaluate(() => ({
      last: window.__QA_POSTS__.filter((p) => p.action === 'automationSettings').slice(-1)[0],
      onCount: document.querySelectorAll('#staffEmailsPage .mk-switch.is-on').length,
    }));
    ok(afterOff.last && afterOff.last.key === 'birthday_j30' && afterOff.last.enabled === false, 'POST {birthday_j30, false}');
    ok(afterOff.onCount === 5, 'switch repassé OFF');

    console.log('\n[ÉDITEUR] personnaliser la séquence anniversaire');
    await page.evaluate(() => {
      const card = [...document.querySelectorAll('#staffEmailsPage .mk-auto')].find((c) => c.querySelector('[data-switch-key="auto:birthday_j30"]'));
      card.querySelector('.mk-auto-edit-btn').click();
    });
    await page.waitForTimeout(300);
    const editor = await page.evaluate(() => {
      const edit = document.querySelector('#staffEmailsPage .mk-auto-edit');
      const subject = edit ? edit.querySelector('#mkAutoSubject') : null;
      return {
        open: !!edit,
        placeholder: subject ? subject.getAttribute('data-placeholder') || '' : '',
        rawBraces: edit ? /\{\{[a-z_]+\}\}/.test((edit.querySelector('.pv2-varbar') || {}).textContent || '') : true,
        varChips: edit ? [...edit.querySelectorAll('.pv2-varbar .pv2-tool-var')].map((b) => b.textContent) : [],
        tokedit: edit ? !!edit.querySelector('#mkAutoBody.pv2-tokedit') : false,
        timingOptions: edit ? edit.querySelectorAll('select option').length : 0,
      };
    });
    ok(editor.open, 'éditeur inline ouvert');
    ok(/anniversaire approche/i.test(editor.placeholder), `placeholder = texte par défaut (${editor.placeholder.slice(0, 30)}…)`);
    ok(editor.varChips.length >= 3 && editor.varChips.includes('Prénom') && !editor.rawBraces,
      `les variables sont des JETONS cliquables en français, plus des accolades (${editor.varChips.join(' · ')})`);
    ok(editor.tokedit, 'la zone de frappe est un éditeur à jetons (plus un textarea à accolades)');
    ok(editor.timingOptions >= 5, `timing en libellés FR (${editor.timingOptions} options)`);
    // LA DEMANDE EXACTE DU PROPRIÉTAIRE, prouvée : cliquer un jeton insère la
    // variable AU CURSEUR, l'écran montre « Prénom » qui brille, JAMAIS {{.
    const chipInsert = await page.evaluate(async () => {
      const ta = document.getElementById('mkAutoBody');
      ta.value = 'Bonjour , à bientôt';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.setSelectionRange(8, 8);
      [...document.querySelectorAll('#staffEmailsPage .pv2-varbar .pv2-tool-var')].find((b) => b.textContent === 'Prénom').click();
      await new Promise((r) => setTimeout(r, 150));
      const el = document.getElementById('mkAutoBody');
      return {
        value: el.value,
        visible: el.innerText,
        toks: el.querySelectorAll('.pl-tok').length,
      };
    });
    ok(chipInsert.value === 'Bonjour {{prenom}}, à bientôt', `la VALEUR garde {{prenom}} pour le serveur (obtenu « ${chipInsert.value} »)`);
    ok(!chipInsert.visible.includes('{{') && /Prénom/.test(chipInsert.visible) && chipInsert.toks === 1,
      `l'ÉCRAN montre le jeton « Prénom » et AUCUNE accolade (visible : « ${chipInsert.visible.trim()} »)`);
    // Nettoyage : le corps écrit pour la preuve ne doit pas polluer le test
    // d'enregistrement qui suit (il vérifie que SEUL l'objet modifié part).
    await page.evaluate(() => {
      const ta = document.getElementById('mkAutoBody');
      ta.value = '';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.evaluate(() => {
      pv2AutoEditField('subject', 'Sujet perso anniversaire');
      pv2AutoEditSave('birthday_j30');
    });
    await page.waitForTimeout(400);
    const saved = await page.evaluate(() => ({
      last: window.__QA_POSTS__.filter((p) => p.action === 'automationSettings').slice(-1)[0],
      modified: !!document.querySelector('#staffEmailsPage .mk-auto-mod'),
    }));
    ok(saved.last && saved.last.key === 'birthday_j30' && saved.last.subject === 'Sujet perso anniversaire' && saved.last.body === undefined, 'POST étendu {key, subject}, champs inchangés non envoyés');
    ok(saved.modified, 'pilule « modifié » affichée sur la carte');

    // L'apercu doit montrer le VRAI mail rendu par le serveur, avec le texte en
    // cours de saisie et non encore enregistre. Et l'envoi de test ne doit
    // JAMAIS transporter d'adresse : le serveur envoie au membre connecte.
    console.log('\n[APERCU + TEST] le brouillon en cours, rendu par le serveur');
    await page.evaluate(() => {
      const card = [...document.querySelectorAll('#staffEmailsPage .mk-auto')].find((c) => c.querySelector('[data-switch-key="auto:birthday_j30"]'));
      card.querySelector('.mk-auto-edit-btn').click();
    });
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      pv2AutoEditField('body', 'Brouillon pas encore enregistre');
      [...document.querySelectorAll('#staffEmailsPage .mk-auto-edit-actions button')].find((b) => /Voir le mail/.test(b.textContent)).click();
    });
    await page.waitForTimeout(400);
    const previewed = await page.evaluate(() => ({
      post: window.__QA_POSTS__.filter((p) => p.action === 'automationPreview').slice(-1)[0],
      overlay: !!document.getElementById('emailPreviewOverlay'),
      frameSandboxed: (document.querySelector('#emailPreviewOverlay iframe') || {}).getAttribute
        ? document.querySelector('#emailPreviewOverlay iframe').getAttribute('sandbox') === ''
        : false,
    }));
    ok(previewed.post && previewed.post.body === 'Brouillon pas encore enregistre', `apercu demande avec le brouillon en cours (${JSON.stringify(previewed.post && previewed.post.body)})`);
    ok(previewed.overlay && previewed.frameSandboxed, 'mail rendu dans une iframe sandboxee, jamais injecte dans la page');
    await page.evaluate(() => closeEmailPreview());

    await page.evaluate(() => {
      [...document.querySelectorAll('#staffEmailsPage .mk-auto-edit-actions button')].find((b) => /envoyer un test/.test(b.textContent)).click();
    });
    await page.waitForTimeout(400);
    const tested = await page.evaluate(() => window.__QA_POSTS__.filter((p) => p.action === 'sendAutomationTest').slice(-1)[0]);
    ok(tested && tested.key === 'birthday_j30', 'POST sendAutomationTest {key}');
    ok(tested && tested.to === undefined && tested.recipient === undefined && tested.email === undefined,
      `SECURITE : aucune adresse destinataire dans la requete (champs envoyes : ${Object.keys(tested || {}).join(', ')})`);

    console.log('\n[ÉDITEUR] réinitialiser → défauts');
    await page.evaluate(() => {
      const card = [...document.querySelectorAll('#staffEmailsPage .mk-auto')].find((c) => c.querySelector('[data-switch-key="auto:birthday_j30"]'));
      card.querySelector('.mk-auto-edit-btn').click();
    });
    await page.waitForTimeout(250);
    await page.evaluate(() => pv2AutoEditReset('birthday_j30'));
    await page.waitForTimeout(400);
    const resetState = await page.evaluate(() => ({
      last: window.__QA_POSTS__.filter((p) => p.action === 'automationSettings').slice(-1)[0],
      modified: !!document.querySelector('#staffEmailsPage .mk-auto-mod'),
    }));
    ok(resetState.last && resetState.last.key === 'birthday_j30' && resetState.last.reset === true, 'POST {key, reset:true}');
    ok(!resetState.modified, 'pilule « modifié » retirée après reset');

    console.log('\n[SCROLL] ouvrir un message ne renvoie JAMAIS en haut de page');
    const scrollKept = await page.evaluate(async () => {
      window.scrollTo(0, 500);
      await new Promise((r) => setTimeout(r, 120));
      const before = window.scrollY;
      const rows = [...document.querySelectorAll('#staffEmailsPage tr[onclick^="pv2SelectEmail"]')];
      if (!rows.length || before < 300) return { found: false };
      rows[Math.min(3, rows.length - 1)].click();
      await new Promise((r) => setTimeout(r, 350));
      const after = window.scrollY;
      window.scrollTo(0, 0);
      return { found: true, before, after, kept: Math.abs(after - before) < 60 };
    });
    ok(scrollKept.found, 'la file porte des lignes cliquables et la page peut defiler');
    ok(scrollKept.kept, `cliquer un message GARDE la position de lecture (${scrollKept.before} -> ${scrollKept.after})`);

    console.log('\n[COMPOSER] nouveau message : sélecteur maison PILOTÉ, modèle, envoi');
    await page.evaluate(() => {
      window.getStaffClientRows = () => [
        { id: 'c1', name: 'Marie Dupont', email: 'marie@test.be', reservations: 4, lastVisitAgo: 'il y a 12 jours' },
        { id: 'c2', name: 'Lucas Petit', email: 'lucas@test.be', reservations: 2, lastVisitAgo: 'il y a 3 jours' },
        { id: 'c3', name: 'Martin Duval', email: 'martin@test.be', reservations: 1, lastVisitAgo: 'il y a 60 jours' },
      ];
      [...document.querySelectorAll('#staffEmailsPage .pv2-bar-actions button')].find((b) => /Nouveau message/.test(b.textContent)).click();
    });
    await page.waitForTimeout(500);
    const composer = await page.evaluate(() => {
      const overlay = document.getElementById('pv2MailOverlay');
      return {
        inBody: !!overlay && overlay.parentElement === document.body,
        open: !!overlay && !overlay.classList.contains('hidden') && !!overlay.querySelector('.pv2-composer'),
        inPage: !!document.querySelector('#staffEmailsPage .pv2-composer'),
        combo: !!document.getElementById('pv2ComboList'),
        noDatalist: !document.getElementById('pv2ClientsList'),
        identities: [...document.querySelectorAll('.pv2-composer select')][0]?.options.length || 0,
        toolbar: document.querySelectorAll('.pv2-composer .pv2-toolbar .pv2-tool').length,
        preview: !!document.getElementById('pv2ComposerPreview'),
        paper: !!document.querySelector('.pv2-composer .pv2-mail-paper') && !!document.getElementById('pv2PreviewSubject') && !!document.getElementById('pv2PreviewMeta'),
        tokedit: !!document.querySelector('#pv2ComposerBody.pv2-tokedit') && !!document.querySelector('#pv2ComposerSubject.pv2-tokedit'),
        tplToggle: !!document.querySelector('.pv2-composer .pv2-tpl-toggle'),
        antifill: (document.getElementById('pv2ComposerTo') || {}).getAttribute
          ? { auto: document.getElementById('pv2ComposerTo').getAttribute('autocomplete'), ph: document.getElementById('pv2ComposerTo').getAttribute('placeholder') || '' }
          : { auto: '', ph: '' },
        emailMetaRequests: { ...window.__QA_EMAIL_META_REQUESTS__ },
      };
    });
    ok(composer.inBody && composer.open, 'le composeur vit dans une SURCOUCHE montée sur document.body');
    ok(composer.emailMetaRequests.studio === 1 && composer.emailMetaRequests.legacy === 0,
      `le composeur charge ses métadonnées via emailStudio, sans boucle legacy (${JSON.stringify(composer.emailMetaRequests)})`);
    ok(!composer.inPage, 'CONTRE-PREUVE : plus aucun composeur dans la page (les re-rendus ne peuvent plus le toucher)');
    ok(await page.evaluate(() => document.documentElement.classList.contains('pv2-lock') && getComputedStyle(document.body).overflow === 'hidden'),
      'la page derrière est VERROUILLÉE : la molette ne peut plus la faire défiler sous la surcouche (bug vidéo du 2026-08-06)');
    ok(composer.combo && composer.noDatalist, 'sélecteur maison présent, la datalist native a disparu (contre-preuve)');
    ok(composer.identities === 2, `2 identités d'expéditeur (obtenu ${composer.identities})`);
    ok(composer.toolbar >= 7, `barre d'outils : gras, italique, liste, lien, bouton + variables (${composer.toolbar} outils)`);
    ok(composer.preview && composer.paper, 'l\'aperçu est UN MAIL : papier clair, objet en tête, De/À');
    ok(composer.tokedit, 'objet et message sont des éditeurs à JETONS : les accolades n\'existent plus à l\'écran');
    ok(composer.tplToggle, 'le sélecteur de modèle est un bouton maison (plus de select natif fermable par un re-rendu)');
    ok(/one-time-code/.test(composer.antifill.auto || '') && !/email/i.test(composer.antifill.ph),
      'l\'autocomplétion d\'adresses du navigateur est neutralisée (le menu fantôme de Chrome ne peut plus recouvrir la liste)');

    // LA GALERIE DE MODÈLES : ouverte par le bouton, groupée, et STABLE sous
    // les re-rendus de page : c'était le bug « ça s'affiche une seconde puis
    // ça part » (le select natif mourait à chaque poll).
    await page.evaluate(() => { document.querySelector('.pv2-composer .pv2-tpl-toggle').click(); });
    await page.waitForTimeout(250);
    const gallery = await page.evaluate(() => {
      const picker = document.getElementById('pv2TplPicker');
      const card = document.querySelector('#pv2MailOverlay .pv2-composer');
      if (card) card.dataset.qaNode = 'stable';
      return {
        open: !!picker,
        groups: [...document.querySelectorAll('#pv2TplPicker .pv2-tpl-group h4')].map((el) => el.textContent),
        cards: document.querySelectorAll('#pv2TplPicker .pv2-tpl-card').length,
        maison: [...document.querySelectorAll('#pv2TplPicker .pv2-tpl-origin')].length,
        chips: document.querySelectorAll('#pv2TplPicker .pl-var').length,
      };
    });
    ok(gallery.open, 'la galerie de modèles s\'ouvre');
    ok(gallery.groups.length >= 5 && gallery.groups.includes('Relancer') && gallery.groups.includes('Service client') && gallery.groups.includes('Vos modèles'),
      `modèles groupés par moment commercial + « Vos modèles » (${gallery.groups.join(' · ')})`);
    ok(gallery.cards >= 13, `bibliothèque fournie : ${gallery.cards} cartes (4 options avant la refonte)`);
    ok(gallery.maison >= 1, 'l\'origine « maison » se lit sur les modèles du centre');
    ok(gallery.chips >= 6, `les variables des cartes sont des JETONS nommés, plus des accolades (${gallery.chips} jetons)`);
    const stability = await page.evaluate(async () => {
      renderStaffData();
      await new Promise((r) => setTimeout(r, 300));
      renderStaffEmailsPage();
      await new Promise((r) => setTimeout(r, 300));
      const card = document.querySelector('#pv2MailOverlay .pv2-composer');
      return {
        pickerStillOpen: !!document.getElementById('pv2TplPicker'),
        sameNode: !!card && card.dataset.qaNode === 'stable',
      };
    });
    ok(stability.pickerStillOpen, 'LE BUG EST MORT : la galerie ouverte SURVIT à deux re-rendus complets de la page');
    ok(stability.sameNode, 'le composeur est LE MÊME NŒUD après les re-rendus : la page ne le reconstruit jamais');
    await page.evaluate(async () => {
      [...document.querySelectorAll('#pv2TplPicker .pv2-tpl-card')].find((el) => /On ne vous a plus vu/.test(el.textContent)).click();
      await new Promise((r) => setTimeout(r, 250));
    });
    const galleryPicked = await page.evaluate(() => ({
      closed: !document.getElementById('pv2TplPicker'),
      toggleLabel: (document.querySelector('.pv2-composer .pv2-tpl-toggle') || {}).textContent || '',
    }));
    ok(galleryPicked.closed && /On ne vous a plus vu/.test(galleryPicked.toggleLabel), 'choisir une carte applique le modèle et referme la galerie');

    // PILOTAGE RÉEL du sélecteur : frappe, liste filtrée avec contexte,
    // flèche + Entrée. Une assertion de présence ne prouverait rien : c'est
    // précisément le composant qui « buguait à la flèche ».
    await page.click('#pv2ComposerTo');
    await page.keyboard.type('mar', { delay: 40 });
    await page.waitForTimeout(200);
    const comboOpen = await page.evaluate(() => ({
      // Visibilité RENDUE, pas la propriété : un display qui bat [hidden] a
      // déjà fait mentir ce test une fois (barre vide peinte sous le champ).
      visible: getComputedStyle(document.getElementById('pv2ComboList')).display !== 'none',
      options: [...document.querySelectorAll('#pv2ComboList .pv2-combo-opt strong')].map((s) => s.textContent),
      meta: (document.querySelector('#pv2ComboList .pv2-combo-meta') || {}).textContent || '',
      focusAlive: document.activeElement && document.activeElement.id === 'pv2ComposerTo',
    }));
    ok(comboOpen.visible && comboOpen.options.length === 2, `frappe « mar » → 2 clients proposés (${comboOpen.options.join(', ')})`);
    ok(/visite/.test(comboOpen.meta) || /il y a/.test(comboOpen.meta), `chaque ligne porte du contexte utile (${comboOpen.meta})`);
    ok(comboOpen.focusAlive, 'le focus reste dans le champ pendant la frappe (aucun re-rendu ne le tue)');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
    const picked = await page.evaluate(() => ({
      value: document.getElementById('pv2ComposerTo').value,
      name: pv2Mail.draft.name,
      closed: getComputedStyle(document.getElementById('pv2ComboList')).display === 'none',
    }));
    ok(picked.value === 'marie@test.be' && picked.name === 'Marie Dupont', `flèche + Entrée sélectionne Marie (${picked.value}, ${picked.name})`);
    ok(picked.closed, 'la liste se referme après la sélection');

    await page.evaluate(() => { pv2ComposerTemplate('starter:relance-client'); });
    await page.waitForTimeout(300);
    const filled = await page.evaluate(() => ({
      subject: document.getElementById('pv2ComposerSubject').value,
      body: document.getElementById('pv2ComposerBody').value,
    }));
    ok(/longtemps, Marie/.test(filled.subject), `modèle prérempli avec prénom substitué (${filled.subject})`);
    ok(/Bonjour Marie/.test(filled.body), 'corps prérempli avec {{prenom}} → Marie');
    ok(/Fun Galaxy Libramont/.test(filled.body), 'la signature porte le NOM DU CENTRE résolu, plus aucun centre codé en dur');
    await page.evaluate(() => pv2ComposerSend());
    await page.waitForTimeout(400);
    const sent = await page.evaluate(() => ({
      post: window.__QA_POSTS__.filter((p) => p.action === 'sendDirectEmail').slice(-1)[0],
      closed: !document.querySelector('#pv2MailOverlay:not(.hidden) .pv2-composer'),
    }));
    ok(sent.post && sent.post.to === 'marie@test.be' && /longtemps/.test(sent.post.subject) && sent.post.identityId === '1', 'POST sendDirectEmail {to, subject, identityId défaut}');
    ok(sent.post.replyToCommunicationId === null, 'pas de replyTo pour un message libre');
    ok(sent.closed, 'composer fermé après envoi');

    /* ══ VARIABLES BLOQUANTES : rien ne part avec une accolade ══════════════
       Bug réel du 2026-08-05 : fill() ne remplaçait QUE {{prenom}}, le modèle
       « Offre de la semaine » partait chez le client avec « {{offre}} » en
       toutes lettres. La preuve est comportementale ET contre-prouvée : le
       même envoi passe une fois les trous remplis. */
    console.log('\n[VARIABLES] l\'envoi est bloqué tant qu\'un {{…}} n\'est pas rempli');
    const varsBlocked = await page.evaluate(async () => {
      pv2OpenComposer({ to: 'marie@test.be', name: 'Marie Dupont' });
      await new Promise((r) => setTimeout(r, 200));
      pv2ComposerTemplate('starter:promo-semaine');
      await new Promise((r) => setTimeout(r, 200));
      const before = window.__QA_POSTS__.filter((p) => p.action === 'sendDirectEmail').length;
      pv2ComposerSend();
      await new Promise((r) => setTimeout(r, 300));
      const after = window.__QA_POSTS__.filter((p) => p.action === 'sendDirectEmail').length;
      const hint = document.getElementById('pv2ComposerVarsHint');
      return {
        stillOpen: !!document.querySelector('#pv2MailOverlay:not(.hidden) .pv2-composer'),
        posted: after - before,
        hintShown: !!hint && !hint.hidden,
        hintText: hint ? hint.textContent : '',
        marks: document.querySelectorAll('#pv2ComposerPreview .pv2-var-missing').length,
        subject: document.getElementById('pv2ComposerSubject').value,
      };
    });
    ok(/\{\{offre\}\}/.test(varsBlocked.subject), `le trou {{offre}} du modèle est VISIBLE dans l'objet (${varsBlocked.subject.slice(0, 50)}…)`);
    ok(varsBlocked.posted === 0, `AUCUN sendDirectEmail n'est parti avec une variable non remplie (${varsBlocked.posted} envoi)`);
    ok(varsBlocked.stillOpen, 'le composer reste ouvert pour corriger');
    ok(varsBlocked.hintShown && /offre/.test(varsBlocked.hintText), `le rappel nomme ce qui manque (${varsBlocked.hintText.trim().slice(0, 60)})`);
    ok(varsBlocked.marks >= 3, `l'aperçu surligne chaque variable manquante (${varsBlocked.marks} marquées : offre, date_debut, date_fin)`);
    // LA DEMANDE EXACTE : dans la ZONE D'ÉCRITURE non plus, aucune accolade ne
    // se voit : la valeur serveur garde {{offre}}, l'écran montre le jeton.
    const editorScreen = await page.evaluate(() => {
      const el = document.getElementById('pv2ComposerBody');
      return { visible: el.innerText, raw: el.value, toks: el.querySelectorAll('.pl-tok').length };
    });
    ok(!editorScreen.visible.includes('{{') && editorScreen.toks >= 3 && /\{\{offre\}\}/.test(editorScreen.raw),
      `l'éditeur montre des jetons, jamais {{ (écran sans accolade, ${editorScreen.toks} jetons, valeur serveur intacte)`);
    const varsPassed = await page.evaluate(async () => {
      pv2ComposerField('subject', 'Cette semaine : une partie offerte des 2 parties');
      pv2ComposerField('body', 'Bonjour Marie,\n\nCette semaine on vous gate : **une partie offerte** des la deuxieme partie jouee.\n\n- valable du lundi au jeudi\n- sur reservation en ligne\n\n[En profiter](https://reservation.test)\n\nL\'equipe Fun Galaxy Libramont');
      pv2ComposerSend();
      await new Promise((r) => setTimeout(r, 300));
      const post = window.__QA_POSTS__.filter((p) => p.action === 'sendDirectEmail').slice(-1)[0];
      return { post, closed: !document.querySelector('#pv2MailOverlay:not(.hidden) .pv2-composer') };
    });
    ok(varsPassed.post && !/\{\{/.test(varsPassed.post.subject + varsPassed.post.body), 'CONTRE-PREUVE : trous remplis, le MÊME envoi part, zéro accolade dans ce qui est envoyé');
    ok(varsPassed.closed, 'composer fermé après l\'envoi corrigé');

    /* ══ LA FRAPPE SURVIT AUX RE-RENDUS (bug prod 2026-08-05) ═══════════════
       « une fois qu'on check les clients ça fait tout bugger on peut plus
       écrire » : la page se re-rend (poll, données qui arrivent) et le focus
       du champ en cours de frappe part dans le vide : les lettres suivantes ne
       s'écrivent NULLE PART. On tape, on force un re-rendu au milieu, on
       retape : tout doit s'écrire, curseur compris, et la liste du sélecteur
       ouverte doit survivre au re-rendu. */
    console.log('\n[FRAPPE SOUS POLL] le focus et le curseur survivent à un re-rendu');
    const typing = await page.evaluate(async () => {
      window.getStaffClientRows = () => [
        { id: 'c1', name: 'Marie Dupont', email: 'marie@test.be', reservations: 4, lastVisitAgo: 'il y a 12 jours' },
      ];
      pv2OpenComposer({ to: 'marie@test.be', name: 'Marie Dupont' });
      await new Promise((r) => setTimeout(r, 250));
      return true;
    });
    ok(typing, 'composer ouvert avec un client choisi');
    await page.click('#pv2ComposerBody');
    await page.keyboard.type('abc', { delay: 25 });
    await page.evaluate(() => { renderStaffEmailsPage(); });
    await page.waitForTimeout(150);
    await page.keyboard.type('def', { delay: 25 });
    const typed = await page.evaluate(() => ({
      value: document.getElementById('pv2ComposerBody').value,
      focused: document.activeElement && document.activeElement.id === 'pv2ComposerBody',
    }));
    ok(typed.value === 'abcdef', `un re-rendu au milieu de la frappe ne mange AUCUNE lettre (obtenu « ${typed.value} »)`);
    ok(typed.focused, 'le focus est toujours dans le champ message après le re-rendu');
    // Curseur au MILIEU : corriger une faute pendant qu'un poll arrive.
    await page.evaluate(() => { const ta = document.getElementById('pv2ComposerBody'); ta.setSelectionRange(3, 3); });
    await page.evaluate(() => { renderStaffEmailsPage(); });
    await page.waitForTimeout(150);
    await page.keyboard.type('X');
    const caret = await page.evaluate(() => document.getElementById('pv2ComposerBody').value);
    ok(caret === 'abcXdef', `le CURSEUR est restauré au même endroit, pas jeté en fin de texte (obtenu « ${caret} »)`);
    // La liste du sélecteur ouverte survit elle aussi au re-rendu.
    await page.click('#pv2ComposerTo');
    await page.evaluate(() => { const i = document.getElementById('pv2ComposerTo'); i.value = ''; pv2ComboInput('mar'); });
    await page.waitForTimeout(120);
    await page.evaluate(() => { renderStaffEmailsPage(); });
    await page.waitForTimeout(200);
    const comboSurvives = await page.evaluate(() => ({
      visible: getComputedStyle(document.getElementById('pv2ComboList')).display !== 'none',
      options: document.querySelectorAll('#pv2ComboList .pv2-combo-opt').length,
      focused: document.activeElement && document.activeElement.id === 'pv2ComposerTo',
    }));
    ok(comboSurvives.visible && comboSurvives.options > 0, `la liste ouverte du sélecteur survit au re-rendu (${comboSurvives.options} option(s) encore affichée(s))`);
    ok(comboSurvives.focused, 'et le champ « À » garde le focus');
    await page.evaluate(async () => { pv2CloseComposer(); await new Promise((r) => setTimeout(r, 150)); });

    /* ══ TENUE À L'ÉCHELLE : 5000 clients dans le sélecteur ═════════════════ */
    console.log('\n[COMBO 5000] le sélecteur tient à 5000 clients');
    const bigCombo = await page.evaluate(async () => {
      window.getStaffClientRows = () => Array.from({ length: 5000 }, (_, i) => ({
        id: `c${i}`, name: `Client ${i}`, email: `client${i}@test.be`, reservations: i % 9, lastVisitAgo: 'il y a ' + (i % 90) + ' jours',
      }));
      pv2OpenComposer({});
      await new Promise((r) => setTimeout(r, 200));
      const t0 = performance.now();
      pv2ComboInput('client49');
      const elapsed = performance.now() - t0;
      const options = document.querySelectorAll('#pv2ComboList .pv2-combo-opt').length;
      pv2CloseComposer();
      await new Promise((r) => setTimeout(r, 150));
      return { elapsed: Math.round(elapsed * 10) / 10, options };
    });
    ok(bigCombo.options > 0 && bigCombo.options <= 8, `jamais plus de 8 lignes affichées (obtenu ${bigCombo.options})`);
    ok(bigCombo.elapsed < 120, `filtrage instantané sur 5000 clients (${bigCombo.elapsed} ms)`);

    /* ══ APERÇU SERVEUR : le mail FINAL, rendu par le même chemin que l'envoi ══ */
    console.log('\n[APERÇU FINAL] variables résolues, iframe sandboxée');
    const finalPreview = await page.evaluate(async () => {
      window.getStaffClientRows = () => [{ id: 'c1', name: 'Marie Dupont', email: 'marie@test.be' }];
      pv2OpenComposer({ to: 'marie@test.be', name: 'Marie Dupont' });
      await new Promise((r) => setTimeout(r, 200));
      pv2ComposerField('subject', 'Bonjour {{prenom}}');
      pv2ComposerField('body', 'Un mot pour {{prenom}} du centre {{centre}}.');
      pv2ComposerServerPreview();
      await new Promise((r) => setTimeout(r, 350));
      const post = window.__QA_POSTS__.filter((p) => p.action === 'directEmailPreview').slice(-1)[0];
      const overlay = document.getElementById('emailPreviewOverlay');
      const frame = overlay ? overlay.querySelector('iframe') : null;
      const out = { post, overlay: !!overlay, sandboxed: frame ? frame.getAttribute('sandbox') === '' : false };
      if (typeof closeEmailPreview === 'function') closeEmailPreview();
      pv2CloseComposer();
      await new Promise((r) => setTimeout(r, 150));
      return out;
    });
    ok(finalPreview.post && finalPreview.post.subject === 'Bonjour Marie' && !/\{\{/.test(finalPreview.post.body),
      `l'aperçu part avec les variables RÉSOLUES (« ${finalPreview.post && finalPreview.post.subject} »)`);
    ok(finalPreview.overlay && finalPreview.sandboxed, 'rendu dans l\'iframe sandboxée, jamais injecté dans la page');

    // « Garder en modèle » : un modèle fourni retouché devient un modèle À SOI
    // (préremplit l'éditeur de la bibliothèque, chemin saveEmailTemplate déjà
    // testé plus haut). Un bouton affiché doit faire quelque chose.
    const keepAsTpl = await page.evaluate(async () => {
      pv2OpenComposer({ to: 'marie@test.be', name: 'Marie Dupont' });
      await new Promise((r) => setTimeout(r, 200));
      pv2ComposerTemplate('starter:relance-client');
      await new Promise((r) => setTimeout(r, 200));
      [...document.querySelectorAll('#pv2MailOverlay .pv2-composer button')].find((b) => /Garder en modèle/.test(b.textContent)).click();
      await new Promise((r) => setTimeout(r, 250));
      const editing = pv2Settings.tplEditing;
      const out = { open: pv2Settings.open, view: pv2Settings.view, name: editing ? editing.name : '', subject: editing ? editing.subject : '' };
      pv2Settings.tplEditing = null; pv2Settings.open = false; pv2CloseComposer();
      await new Promise((r) => setTimeout(r, 150));
      return out;
    });
    ok(keepAsTpl.open && keepAsTpl.view === 'templates' && /ma version/.test(keepAsTpl.name) && /longtemps/.test(keepAsTpl.subject),
      `« Garder en modèle » ouvre la bibliothèque préremplie (« ${keepAsTpl.name} », objet repris)`);

    console.log('\n[INBOX] pipe Reçus → analyse → réponse 1-clic');
    await page.evaluate(() => pv2EmailFilter('inbound'));
    await page.waitForTimeout(400);
    const inbox = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#staffEmailsPage .pv2-table tbody tr')];
      return {
        count: rows.length,
        pipeActive: !!document.querySelector('#staffEmailsPage .pv2-pipe.active'),
        firstIntent: rows[0] ? (rows[0].querySelector('.pv2-inbox-intent') || {}).textContent : '',
        repliedBadge: rows.some((r) => /Répondu/.test(r.textContent)),
        toReplyBadge: rows.some((r) => /À répondre/.test(r.textContent)),
      };
    });
    ok(inbox.count === 2, `2 mails reçus listés (obtenu ${inbox.count})`);
    ok(inbox.firstIntent === 'Anniversaire', `badge intent sur la ligne (${inbox.firstIntent})`);
    ok(inbox.repliedBadge && inbox.toReplyBadge, 'badges « Répondu » et « À répondre » distincts');
    await page.evaluate(() => {
      const uid = getStaffEmailRows().find((r) => r.id === 4).uid;
      pv2SelectEmail(uid);
    });
    await page.waitForTimeout(300);
    const detail = await page.evaluate(() => ({
      summary: (document.querySelector('#staffEmailsPage .pv2-inbox-summary p') || {}).textContent || '',
      intent: (document.querySelector('#staffEmailsPage .pv2-inbox-analysis .pv2-inbox-intent') || {}).textContent || '',
      replySubject: (document.querySelector('#staffEmailsPage .pv2-inbox-reply-subject') || {}).value || '',
      original: (document.querySelector('#staffEmailsPage .pv2-mail-preview') || {}).textContent || '',
    }));
    ok(/anniversaire/i.test(detail.summary), `« Ce qu'il veut » affiché (${detail.summary.slice(0, 40)}…)`);
    ok(/Re: Anniversaire/.test(detail.replySubject), 'réponse proposée préremplie (sujet)');
    ok(/organiser un anniversaire/.test(detail.original), 'mail original visible');
    await page.evaluate(() => {
      const uid = getStaffEmailRows().find((r) => r.id === 4).uid;
      pv2InboxReplyField(uid, 'body', 'Réponse éditée par le staff avant envoi.');
      pv2InboxReply(uid);
    });
    await page.waitForTimeout(400);
    const replied = await page.evaluate(() => window.__QA_POSTS__.filter((p) => p.action === 'sendDirectEmail').slice(-1)[0]);
    ok(replied && replied.replyToCommunicationId === 4, 'POST sendDirectEmail avec replyToCommunicationId=4');
    ok(replied.to === 'client1@x.be' && /éditée par le staff/.test(replied.body), 'réponse ÉDITÉE envoyée au bon expéditeur');

    console.log('\n[ANALYSER UN REÇU] coller un mail → store → Reçus');
    await page.evaluate(() => {
      [...document.querySelectorAll('#staffEmailsPage .pv2-bar-actions button')].find((b) => /Coller un mail reçu/.test(b.textContent)).click();
    });
    await page.waitForTimeout(300);
    const analyzeOpen = await page.evaluate(() => !!document.querySelector('#staffEmailsPage .pv2-analyze'));
    ok(analyzeOpen, 'panneau « Analyser un email reçu » ouvert');
    await page.evaluate(() => {
      pv2AnalyzeField('from', 'groupe@ecole.be');
      pv2AnalyzeField('body', 'Bonjour, combien pour 25 élèves un mardi ?');
      pv2AnalyzeSubmit();
    });
    await page.waitForTimeout(500);
    const analyzed = await page.evaluate(() => ({
      post: window.__QA_POSTS__.filter((p) => p.action === 'analyzeInboundEmail').slice(-1)[0],
      filter: state.staffEmailFilter,
    }));
    ok(analyzed.post && analyzed.post.store === true && analyzed.post.from === 'groupe@ecole.be', 'POST analyzeInboundEmail {from, store:true}');
    ok(analyzed.filter === 'inbound', 'bascule automatique sur les Reçus');

    console.log('\n[PV2OPENCOMPOSER] préfill depuis la fiche client');
    await page.evaluate(() => pv2OpenComposer({ to: 'x@y.be', name: 'X Y' }));
    await page.waitForTimeout(300);
    const prefill = await page.evaluate(() => ({
      open: !!document.querySelector('#pv2MailOverlay:not(.hidden) .pv2-composer'),
      to: (document.getElementById('pv2ComposerTo') || {}).value || '',
    }));
    ok(prefill.open && prefill.to === 'x@y.be', `pv2OpenComposer préremplit le destinataire (${prefill.to})`);

    // capture optionnelle
    if (process.env.EMAILS_SHOT) {
      await page.screenshot({ path: `${process.env.EMAILS_SHOT}/emails-v3-dark.png`, fullPage: false });
    }
    console.log('\n[V4 SÉQUENCE PERSO] créer sa propre automatisation');
    const seqRes = await page.evaluate(async () => {
      pv2SeqNew();
      await new Promise((r) => setTimeout(r, 150));
      const editorOpen = !!document.querySelector('.pv2-seq-editor');
      pv2SeqField('name', 'Relance J+7');
      pv2SeqField('trigger.days', 7);
      pv2SeqField('subject', 'On se revoit ?');
      pv2SeqField('body', 'Bonjour {{prenom}}, revenez nous voir !');
      pv2SeqField('cap', 15);
      pv2SeqSave();
      await new Promise((r) => setTimeout(r, 300));
      const post = window.__QA_POSTS__.filter((p) => p.action === 'customSequences').slice(-1)[0];
      const card = [...document.querySelectorAll('.pv2-seq-card')].length;
      return { editorOpen, post, card };
    });
    ok(seqRes.editorOpen, 'éditeur de séquence ouvert via + Créer');
    ok(seqRes.post && seqRes.post.sequence && seqRes.post.sequence.name === 'Relance J+7' && seqRes.post.sequence.trigger.type === 'after_visit' && Number(seqRes.post.sequence.trigger.days) === 7, 'POST customSequences complet (nom, déclencheur, délai)');
    ok(seqRes.card === 1, 'carte « perso » rendue dans la grille des séquences');

    console.log('\n[MENSUEL] le nouveau déclencheur : chaque mois, un jour fixe, une cible');
    const monthly = await page.evaluate(async () => {
      pv2SeqNew();
      await new Promise((r) => setTimeout(r, 150));
      pv2SeqField('trigger.type', 'monthly');
      await new Promise((r) => setTimeout(r, 200));
      const editor = document.querySelector('.pv2-seq-editor');
      const labels = [...editor.querySelectorAll('.pv2-composer-field > span')].map((el) => el.textContent.trim());
      const dayOptions = (editor.querySelectorAll('select')[1] || {}).options ? editor.querySelectorAll('select')[1].options.length : 0;
      pv2SeqField('name', 'Rendez-vous mensuel');
      pv2SeqField('trigger.monthday', 15);
      pv2SeqField('segment', 'loyal');
      pv2SeqField('subject', 'On se voit ce mois-ci ?');
      pv2SeqField('body', 'Bonjour {{prenom}}, le centre vous attend.');
      pv2SeqSave();
      await new Promise((r) => setTimeout(r, 300));
      const post = window.__QA_POSTS__.filter((p) => p.action === 'customSequences').slice(-1)[0];
      return { labels, dayOptions, post };
    });
    ok(monthly.labels.some((l) => /Jour du mois/.test(l)) && monthly.labels.some((l) => /À qui/.test(l)),
      `le déclencheur mensuel expose jour du mois + cible (${monthly.labels.filter((l) => /Jour|qui/.test(l)).join(' · ')})`);
    ok(monthly.dayOptions === 28, `28 jours proposés, jamais un 30 qui sauterait février (obtenu ${monthly.dayOptions})`);
    ok(monthly.post && monthly.post.sequence.trigger.type === 'monthly' && Number(monthly.post.sequence.trigger.monthday) === 15 && monthly.post.sequence.segment === 'loyal',
      'POST customSequences {monthly, jour 15, cible fidèles}');

    console.log("\n[V4 RÉGLAGES] modèles, adresses, cerveau de l'agent");
    const setRes = await page.evaluate(async () => {
      pv2OpenSettings('agent');
      await new Promise((r) => setTimeout(r, 350));
      const panel = !!document.querySelector('.pv2-settings');
      const faqFields = document.querySelectorAll('.pv2-settings textarea').length;
      pv2BrainField('signature', null, 'La team FG');
      pv2BrainField('faq', 'horaires', 'Custom horaires du gérant.');
      pv2BrainSave();
      await new Promise((r) => setTimeout(r, 300));
      const post = window.__QA_POSTS__.filter((p) => p.action === 'emailBrain').slice(-1)[0];
      pv2SettingsView('templates');
      await new Promise((r) => setTimeout(r, 150));
      pv2TplEdit(null);
      await new Promise((r) => setTimeout(r, 150));
      pv2TplField('name', 'Mon modèle');
      pv2TplField('subject', 'Sujet perso');
      pv2TplField('body', 'Corps perso');
      pv2TplSave();
      await new Promise((r) => setTimeout(r, 300));
      const tplPost = window.__QA_POSTS__.filter((p) => p.action === 'saveEmailTemplate').slice(-1)[0];
      return { panel, faqFields, post, tplPost };
    });
    ok(setRes.panel && setRes.faqFields >= 7, 'panneau Réglages → vue Agent avec les réponses par sujet');
    ok(setRes.post && setRes.post.signature === 'La team FG' && setRes.post.faq && setRes.post.faq.horaires && setRes.post.faq.horaires.body === 'Custom horaires du gérant.', 'POST emailBrain (signature + FAQ modifiée)');
    ok(setRes.tplPost && setRes.tplPost.name === 'Mon modèle', "création d'un modèle depuis la page (POST saveEmailTemplate)");



    /* ══ G1 : L'INVENTAIRE DES MAILS ═══════════════════════════════════════
       Trou demontre par mutation : un relecteur a SUPPRIME l'appel
       mailInventoryPanel() du rendu ; l'inventaire disparaissait entierement de
       la page et le gate sortait ALL OK avec 61 assertions vertes. Or « tout
       doit etre visible et pilotable depuis cet ecran » est une demande
       explicite : c'est le SEUL endroit qui dit quels mails existent, y compris
       les cinq qu'aucun autre ecran ne montre.
       Assertion COMPORTEMENTALE : on clique le vrai bouton, on compte les vraies
       lignes, et on verifie que l'inventaire DISTINGUE ce qui part au client de
       ce qui part a l'equipe. */
    console.log('\n[G1 INVENTAIRE] la liste de tous les mails du centre, ouverte par un clic');
    const inv = await page.evaluate(async () => {
      const find = () => [...document.querySelectorAll('#staffEmailsPage .mail-inv button')].find((b) => /Voir la liste|Masquer la liste/.test(b.textContent));
      let btn = find();
      if (!btn) return { noButton: true, rows: -1, client: -1, equipe: -1, labels: [], offWeight: null };
      if (/Masquer/.test(btn.textContent)) { btn.click(); await new Promise((r) => setTimeout(r, 250)); btn = find(); }
      btn.click();
      await new Promise((r) => setTimeout(r, 300));
      const rows = [...document.querySelectorAll('#staffEmailsPage .mail-inv-table tbody tr')];
      const audience = (tr) => { const el = tr.querySelector('[data-audience]'); return el ? el.getAttribute('data-audience') : ''; };
      const off = document.querySelector('#staffEmailsPage .mail-inv-table .pv2-chip.is-off');
      const live = document.querySelector('#staffEmailsPage .mail-inv-table .pv2-chip.is-live');
      return {
        noButton: false,
        rows: rows.length,
        client: rows.filter((tr) => audience(tr) === 'client').length,
        equipe: rows.filter((tr) => audience(tr) === 'equipe').length,
        labels: rows.map((tr) => ((tr.querySelector('strong') || {}).textContent || '')),
        offWeight: (off && live) ? { off: Number(getComputedStyle(off).fontWeight), live: Number(getComputedStyle(live).fontWeight) } : null,
      };
    });
    ok(!inv.noButton, 'l\'inventaire « Tous les mails du centre » existe et s\'ouvre depuis la page');
    ok(inv.rows === 11, 'l\'inventaire liste bien les 11 mails reellement envoyes (obtenu ' + inv.rows + ')');
    ok(inv.client === 8 && inv.equipe === 3, 'il distingue ce qui part au CLIENT (8) de ce qui part a l\'EQUIPE (3) : obtenu ' + inv.client + '/' + inv.equipe);
    ok(inv.labels.some((l) => /Retard : décision à prendre/.test(l)) && inv.labels.some((l) => /Changement d.horaire/.test(l)),
      'les mails NON pilotables y figurent aussi (alerte retard, changement d\'horaire) : ce sont ceux qu\'aucun autre ecran ne montre');
    ok(!!inv.offWeight && inv.offWeight.off > inv.offWeight.live,
      'hierarchie remise a l\'endroit : l\'exception « Coupee » (' + (inv.offWeight && inv.offWeight.off) + ') pese plus que l\'etat normal « Active » (' + (inv.offWeight && inv.offWeight.live) + ')');

    /* ══ MOUVEMENT : la garde de non-rejeu ═════════════════════════════════
       Une animation d'entree posee sur un noeud interieur de cette page
       REJOUERAIT a chaque reconstruction (chaque frappe dans la recherche,
       chaque arrivee de donnees) : c'est le defaut le plus visible de tous, et
       c'est ce qui fait qu'une interface « animee » a l'air baclee.
       On le VERIFIE au lieu de l'affirmer. */
    console.log('\n[MOUVEMENT] aucune entree ne rejoue sur un simple re-rendu');
    const motion = await page.evaluate(async () => {
      pv2CloseComposer();
      await new Promise((r) => setTimeout(r, 250));
      pv2OpenComposer({ to: 'motion@test.be' });
      await new Promise((r) => setTimeout(r, 250));
      // Surcouche : l'entree est posee sur le panneau a l'OUVERTURE reelle, et
      // comme la page ne le reconstruit jamais, elle ne peut pas rejouer : on
      // verifie le noeud IDENTIQUE apres deux re-rendus complets.
      const cardEl = document.querySelector('#pv2MailOverlay .pv2-composer');
      const onOpen = !!cardEl && cardEl.classList.contains('pv2-mount');
      if (cardEl) cardEl.dataset.qaMotion = 'meme-noeud';
      renderStaffEmailsPage();
      await new Promise((r) => setTimeout(r, 150));
      const after = document.querySelector('#pv2MailOverlay .pv2-composer');
      const onRerender = !(after && after.dataset.qaMotion === 'meme-noeud');
      renderStaffEmailsPage();
      await new Promise((r) => setTimeout(r, 100));
      const railEl = () => document.querySelector('#staffEmailsPage .pv2-pipe-rail');
      const railStill = railEl() ? railEl().getAttribute('data-moved') : 'absent';

      /* ══ D3 : LE GATE MESURE D'OU LE RAIL PART, PAS SEULEMENT QU'IL PART ═══
         Les deux assertions data-moved (railStill=0, railMoved=1) sont restees
         VERTES pendant que l'animation etait visiblement cassee : le rail
         surgissait de scaleX(~0) au bord gauche au lieu de glisser depuis le
         segment precedent. Un booleen « il a bouge » ne peut pas voir ca.
         On lit donc la MATRICE calculee du rail a la premiere frame apres le
         clic. Le rail fait 100 px de base, transform-origin 0 50% : m41 est sa
         position de depart, m11*100 sa largeur de depart. --dur-move vaut
         180 ms et la courbe (0.77, 0, 0.175, 1) demarre tres lentement, donc a
         la premiere frame le rail n'a pratiquement pas encore avance : la
         valeur lue est bien la geometrie de DEPART. */
      pv2EmailFilter('sent');
      await new Promise((r) => setTimeout(r, 320));
      const bar = document.querySelector('#staffEmailsPage .pv2-pipeline');
      const prevSeg = bar.querySelector('.pv2-pipe.active');
      const fromSeg = { key: prevSeg.getAttribute('data-pipe'), x: prevSeg.offsetLeft, w: prevSeg.offsetWidth };
      const targetSeg = bar.querySelector('.pv2-pipe[data-pipe="failed"]');
      const toSeg = { x: targetSeg.offsetLeft, w: targetSeg.offsetWidth };
      const railGeo = () => {
        const m = new DOMMatrixReadOnly(getComputedStyle(railEl()).transform);
        return { x: Math.round(m.m41 * 100) / 100, w: Math.round(m.a * 100 * 100) / 100 };
      };
      targetSeg.click();
      const railStart = await new Promise((res) => requestAnimationFrame(() => res(railGeo())));
      await new Promise((r) => setTimeout(r, 400));
      const railEnd = railGeo();
      const railMoved = railEl() ? railEl().getAttribute('data-moved') : 'absent';
      pv2CloseComposer();
      pv2EmailFilter('all');
      await new Promise((r) => setTimeout(r, 200));
      return { onOpen, onRerender, railStill, railMoved, fromSeg, toSeg, railStart, railEnd };
    });
    ok(motion.onOpen, 'l\'entree du composer est animee a sa VRAIE apparition (classe .pv2-mount posee)');
    ok(motion.onRerender === false, 'elle ne PEUT pas rejouer : le panneau est le MEME NOEUD apres les re-rendus de page');
    ok(motion.railStill === '0', 'l\'indicateur du segmente ne bouge pas quand seules les donnees changent (data-moved=' + motion.railStill + ')');
    ok(motion.railMoved === '1', 'il GLISSE quand la gerante change de filtre (data-moved=' + motion.railMoved + ')');
    // Le segment de depart est choisi LOIN du bord gauche (« Envoyes ») : une
    // geometrie nulle ne peut donc pas passer pour une geometrie juste.
    ok(motion.fromSeg.x > 100 && motion.fromSeg.w > 100,
      'point de depart mesurable : le segment precedent « ' + motion.fromSeg.key + ' » est a x=' + motion.fromSeg.x + ' et large de ' + motion.fromSeg.w + ' px');
    ok(Math.abs(motion.railStart.w - motion.fromSeg.w) <= 6,
      'GEOMETRIE DE DEPART : le rail part de la LARGEUR du segment precedent (' + motion.fromSeg.w + ' px attendus, ' + motion.railStart.w + ' px mesures) et non de ~0');
    ok(Math.abs(motion.railStart.x - motion.fromSeg.x) <= 6,
      'GEOMETRIE DE DEPART : le rail part de la POSITION du segment precedent (' + motion.fromSeg.x + ' px attendus, ' + motion.railStart.x + ' px mesures) et non du bord gauche');
    ok(Math.abs(motion.railEnd.w - motion.toSeg.w) <= 2 && Math.abs(motion.railEnd.x - motion.toSeg.x) <= 2,
      'et il ARRIVE sur le segment choisi (attendu x=' + motion.toSeg.x + ' w=' + motion.toSeg.w + ', mesure x=' + motion.railEnd.x + ' w=' + motion.railEnd.w + ')');

    /* ══ D2 : LE CYCLE DE VIE DE L'OBSERVATEUR SUIT CELUI DU NOEUD ══════════
       La page se reconstruit ENTIEREMENT a chaque frappe. Un observateur cree
       par rendu et jamais deconnecte s'accumule lineairement, retient un
       sous-arbre detache, et surtout se declenche ensuite sur ce noeud mort :
       c'est la cause racine mesuree du defaut de geometrie ci-dessus.
       Mesure : on instrumente ResizeObserver, on tape 10 caracteres, on compte. */
    const roLeak = await page.evaluate(async () => {
      const Native = window.ResizeObserver;
      const seen = { created: 0, detachedCallbacks: 0, live: new Set() };
      window.ResizeObserver = class extends Native {
        constructor(cb) {
          super((entries, obs) => {
            for (const e of entries) if (!document.contains(e.target)) seen.detachedCallbacks += 1;
            return cb(entries, obs);
          });
          seen.created += 1; seen.live.add(this);
        }
        disconnect() { seen.live.delete(this); return super.disconnect(); }
      };
      const before = String(state.staffEmailQuery || '');
      for (const c of 'abcdefghij') {
        setStaffEmailQuery((state.staffEmailQuery || '') + c);
        await new Promise((r) => setTimeout(r, 120));
      }
      await new Promise((r) => setTimeout(r, 400));
      window.ResizeObserver = Native;
      setStaffEmailQuery(before);
      await new Promise((r) => setTimeout(r, 250));
      return { created: seen.created, detached: seen.detachedCallbacks, live: seen.live.size };
    });
    ok(roLeak.created <= 1,
      'FUITE : 10 frappes dans la recherche ne laissent au plus 1 observateur vivant (obtenu ' + roLeak.created + ' cree(s), ' + roLeak.live + ' vivant(s))');
    ok(roLeak.detached === 0,
      'et AUCUN rappel ne porte sur un noeud detache du document (obtenu ' + roLeak.detached + ')');

    /* ══ D4 : TOUT SURVOL DE CETTE PAGE EST DERRIERE (hover: hover) ═════════
       Le rapport precedent AFFIRMAIT « survols derriere media query » ; la
       mesure l'a dementi (3 des 5 regles ajoutees etaient dehors). On ne
       l'affirme plus, on le compte, en parcourant le CSSOM reellement charge.
       Sur des segments defilables au doigt, un :hover non garde reste colle
       apres le toucher. */
    const hoverAudit = await page.evaluate(() => {
      const out = { total: 0, guarded: 0, unguarded: [] };
      // Ordre des tests : le selecteur D'ABORD. Depuis le CSS imbrique, une
      // CSSStyleRule expose elle aussi un `cssRules` (vide) : tester `cssRules`
      // en premier faisait tomber TOUTES les regles dans la branche recursive
      // et l'audit renvoyait 0 regle trouvee, donc 0 regle en faute. C'est
      // exactement le trou qu'on est en train de corriger ailleurs, d'ou
      // l'assertion de non-vacuite qui accompagne celle-ci.
      const walk = (rules, guarded) => {
        for (const r of rules) {
          if (r instanceof CSSMediaRule) {
            walk(r.cssRules, guarded || /hover\s*:\s*hover/.test(r.media.mediaText));
            continue;
          }
          if (r.selectorText && /#staffEmailsPage/.test(r.selectorText) && /:hover/.test(r.selectorText)) {
            out.total += 1;
            if (guarded) out.guarded += 1; else out.unguarded.push(r.selectorText);
          }
          if (r.cssRules && r.cssRules.length) walk(r.cssRules, guarded);
        }
      };
      for (const sheet of document.styleSheets) { try { walk(sheet.cssRules, false); } catch (e) { /* feuille externe */ } }
      return out;
    });
    ok(hoverAudit.total >= 5, 'la page declare bien ses regles de survol (' + hoverAudit.total + ' trouvees dans le CSSOM)');
    ok(hoverAudit.unguarded.length === 0,
      'AUCUNE regle de survol hors @media (hover: hover) : ' + hoverAudit.guarded + '/' + hoverAudit.total + ' gardees'
      + (hoverAudit.unguarded.length ? ' (dehors : ' + hoverAudit.unguarded.join(' | ') + ')' : ''));

    /* ══ D5 : ORDRE DE TABULATION = ORDRE VISUEL (WCAG 1.3.2 et 2.4.3) ══════
       Les segments sont des <button> : ils sont dans le parcours clavier. Une
       passe precedente les reordonnait visuellement a 640 px avec order:-2 /
       order:-1, sans toucher le DOM : au clavier on sautait dans le desordre.
       On mesure a 390 px, la largeur ou le defaut vivait. */
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    const tabOrder = await page.evaluate(() => {
      const segs = [...document.querySelectorAll('#staffEmailsPage .pv2-pipeline .pv2-pipe')];
      return {
        dom: segs.map((s) => s.getAttribute('data-pipe')),
        lefts: segs.map((s) => s.offsetLeft),
        orders: segs.map((s) => getComputedStyle(s).order),
        allButtons: segs.every((s) => s.tagName === 'BUTTON'),
      };
    });
    const visualFollowsDom = tabOrder.lefts.every((v, i) => i === 0 || v > tabOrder.lefts[i - 1]);
    ok(tabOrder.allButtons, 'les segments sont atteignables au clavier (tous des <button>)');
    ok(visualFollowsDom,
      'a 390 px l\'ordre VISUEL suit l\'ordre du DOM, donc l\'ordre de tabulation : ' + tabOrder.dom.join(' < ') + ' aux abscisses ' + tabOrder.lefts.join(', '));
    ok(tabOrder.orders.every((o) => Number(o) === 0),
      'aucune propriete order ne desynchronise le visuel du DOM (obtenu ' + JSON.stringify(tabOrder.orders) + ')');
    await page.setViewportSize({ width: 1400, height: 950 });
    await page.waitForTimeout(300);

    /* ══ D7 : CHAQUE CHIFFRE AFFICHE EST COUVERT PAR UNE LEGENDE JUSTE ══════
       La legende ajoutee par la passe precedente englobait « Recus » dans « les
       N messages de la file », alors que les recus sont precisement ce qui
       n'est PAS dans la file sortante : la phrase censee lever la confusion en
       creait une autre. On verifie les DEUX perimetres contre les DEUX chiffres
       reellement affiches sur les segments. */
    const scope = await page.evaluate(() => {
      const p = document.querySelector('#staffEmailsPage .pv2-pipeline-scope');
      const val = (k) => {
        const el = document.querySelector('#staffEmailsPage .pv2-pipe[data-pipe="' + k + '"] .pv2-pipe-value');
        return el ? Number(String(el.textContent).replace(/\D/g, '')) : null;
      };
      return { text: p ? p.textContent.replace(/\s+/g, ' ').trim() : '', all: val('all'), inbound: val('inbound') };
    });
    const fileClaim = scope.text.match(/portent sur les (\d+) messages de la file/);
    const inboundClaim = scope.text.match(/Reçus compte à part les (\d+) mails/);
    ok(!!fileClaim && Number(fileClaim[1]) === scope.all,
      'le perimetre « file » annonce le meme chiffre que le segment Tout (' + scope.all + ' affiche, ' + (fileClaim ? fileClaim[1] : 'aucun') + ' annonce)');
    ok(!!inboundClaim && Number(inboundClaim[1]) === scope.inbound,
      'le perimetre « recus » est annonce A PART, avec le chiffre du segment Recus (' + scope.inbound + ' affiche, ' + (inboundClaim ? inboundClaim[1] : 'aucun') + ' annonce)');
    ok(!/Reçus/.test(scope.text.split('.')[0] || ''),
      'la phrase qui decrit la file ne compte pas « Recus » dedans : « ' + (scope.text.split('.')[0] || '').slice(0, 90) + ' »');

    console.log('\n[V4 ENVOI PROGRAMMÉ] composer → plus tard');
    const schedRes = await page.evaluate(async () => {
      pv2OpenSettings(); // referme les réglages
      pv2OpenComposer({ to: 'client@test.be', name: 'Paul Martin' });
      await new Promise((r) => setTimeout(r, 200));
      pv2ComposerField('subject', 'Message programmé');
      pv2ComposerField('body', 'Contenu.');
      pv2ComposerField('when', 'later');
      const future = new Date(Date.now() + 86400000);
      const pad = (n) => String(n).padStart(2, '0');
      pv2ComposerField('scheduledAt', future.getFullYear() + '-' + pad(future.getMonth() + 1) + '-' + pad(future.getDate()) + 'T10:00');
      pv2ComposerSend();
      await new Promise((r) => setTimeout(r, 300));
      return window.__QA_POSTS__.filter((p) => p.action === 'sendDirectEmail').slice(-1)[0];
    });
    ok(schedRes && schedRes.scheduledAt && new Date(schedRes.scheduledAt).getTime() > Date.now(), 'POST sendDirectEmail avec scheduledAt futur');

    if (process.env.EM_SHOT) { await page.screenshot({ path: process.env.EM_SHOT + '/emails-v3-dark.png', fullPage: false }); }
    if (errs.length) { console.log('\nConsole errors:\n' + errs.join('\n')); }
  } catch (e) {
    console.error('\nemails-page-check FAIL:', e.stack || e.message);
    if (errs.length) console.log('Console errors:\n' + errs.join('\n'));
    failures += 1;
  } finally {
    await browser.close();
    server.close();
  }
  if (failures) { console.error(`\nemails-page-check: ${failures} FAIL`); process.exit(1); }
  console.log('\nemails-page-check: ALL OK');
}
// Le harnais (serveur statique + mock complet) est reutilisable par une sonde
// externe : elle importe installMock/serveStatic au lieu de les dupliquer, ce
// qui les ferait diverger silencieusement.
if (require.main === module) main();
module.exports = { serveStatic, installMock, BASE_URL, BROWSER_PATH, PORT };

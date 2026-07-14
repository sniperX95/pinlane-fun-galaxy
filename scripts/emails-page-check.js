// Test INTERACTIF de la page Emails & relances v3 (vraie gestion de mails).
// Playwright pilote de vrais clics : séquences automatiques (toggle + éditeur
// complet sujet/corps/timing + reset), composer universel (autocomplete client,
// identités, modèles, envoi sendDirectEmail), boîte de réception (pipe Reçus,
// analyse IA, réponse 1-clic avec replyToCommunicationId), « Analyser un
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
    // État serveur simulé des séquences — settings = overrides, defaults =
    // textes/timings de référence (contrat C1). Le POST étendu mute ce state.
    const autoState = {
      confirmation: { enabled: true }, reminder_48h: { enabled: true }, post_visit: { enabled: true },
      birthday_j30: { enabled: true }, reactivation: { enabled: false },
    };
    const VARS = ['prenom', 'date', 'heure', 'formule', 'pax', 'centre'];
    const autoDefaults = {
      confirmation: { enabled: true, subject: 'Votre réservation est confirmée', body: 'Bonjour {{prenom}}, votre réservation du {{date}} à {{heure}} est confirmée.', variables: VARS },
      reminder_48h: { enabled: true, subject: 'Rappel de votre venue', body: 'Bonjour {{prenom}}, on vous attend le {{date}} à {{heure}}.', offsetDays: 2, variables: VARS },
      post_visit: { enabled: true, subject: 'Merci de votre visite', body: 'Merci {{prenom}} ! Revenez quand vous voulez.', offsetDays: 1, variables: VARS },
      birthday_j30: { enabled: true, subject: 'L’anniversaire approche', body: 'Bonjour {{prenom}}, on vous re-réserve la fête ?', offsetDays: 30, variables: VARS },
      reactivation: { enabled: false, subject: 'Ça fait un moment', body: 'Bonjour {{prenom}}, bowling et laser vous attendent.', cap: 20, variables: VARS },
    };
    const autoStats = {
      confirmation: { sent30d: 42, failed30d: 1 }, reminder_48h: { sent30d: 31, failed30d: 0 },
      post_visit: { sent30d: 28, failed30d: 2 }, birthday_j30: { sent30d: 4, failed30d: 0 }, reactivation: { sent30d: 0, failed30d: 0 },
    };
    const comms = [
      { id: 1, centerId: 'libramont', channel: 'email', direction: 'outbound', templateId: 'confirmation', recipient: 'a@x.be', subject: 'Votre réservation est confirmée', status: 'delivered', sentAt: new Date(Date.now() - 3600e3).toISOString(), payload: { textBody: 'Bonjour, votre réservation est confirmée.' } },
      { id: 2, centerId: 'libramont', channel: 'email', direction: 'outbound', templateId: 'reminder_48h', recipient: 'b@x.be', subject: 'Rappel de votre venue', status: 'queued', scheduledAt: new Date(Date.now() + 3600e3).toISOString(), payload: {} },
      { id: 3, centerId: 'libramont', channel: 'email', direction: 'outbound', templateId: 'birthday_j30', recipient: 'c@x.be', subject: 'L’anniversaire approche 🎂', status: 'failed', lastError: 'Mailbox full', attempts: 2, payload: {} },
      // Boîte de réception : 2 mails reçus analysés (contrat C4/C5).
      { id: 4, centerId: 'libramont', channel: 'email', direction: 'inbound', status: 'received', templateId: null, recipient: 'client1@x.be', subject: 'Anniversaire pour mon fils', createdAt: new Date(Date.now() - 7200e3).toISOString(), payload: { from: 'client1@x.be', textBody: 'Bonjour, je voudrais organiser un anniversaire pour mon fils de 8 ans, vous avez de la place samedi ?', analysis: { intent: 'anniversaire', intentLabel: 'Anniversaire', summary: 'Veut organiser un anniversaire (8 ans) et demande la dispo de samedi', urgency: 'normale', reply: { subject: 'Re: Anniversaire pour mon fils', body: 'Bonjour,\n\nAvec plaisir ! Dites-nous la date exacte et le nombre d’enfants, on vous propose la formule adaptée.\n\nL’équipe Fun Galaxy' }, clientName: 'Client Un', provider: 'rules' } } },
      { id: 5, centerId: 'libramont', channel: 'email', direction: 'inbound', status: 'received', templateId: null, recipient: 'client2@x.be', subject: 'Annulation résa de demain', createdAt: new Date(Date.now() - 3600e3).toISOString(), payload: { from: 'client2@x.be', textBody: 'Je dois annuler ma réservation de demain, désolé.', repliedAt: new Date(Date.now() - 1800e3).toISOString(), replyCommunicationId: 77, analysis: { intent: 'annulation', intentLabel: 'Annulation', summary: 'Annule sa réservation de demain', urgency: 'haute', reply: { subject: 'Re: Annulation résa de demain', body: 'Bonjour, c’est noté — votre réservation est annulée.' }, provider: 'rules' } } },
    ];
    const lanes = () => Array.from({ length: 8 }).reduce((a, _, i) => { a[i + 1] = 'active'; return a; }, {});
    const J = (p) => new Response(JSON.stringify(p), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', etag: `qa-${Date.now()}` } });
    const nf = window.fetch.bind(window);
    window.__QA_POSTS__ = [];
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
        return J({ ok: true });
      }
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'automationSettings') {
        return J({ ok: true, settings: JSON.parse(JSON.stringify(autoState)), defaults: autoDefaults, stats: autoStats });
      }
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'customSequences') {
        return J({ ok: true, sequences: window.__QA_SEQS__ || [], limits: { maxSequences: 10, cap: [1, 100], triggers: { after_visit: { label: 'X jours après une visite', days: [1, 90], variables: ['prenom', 'centre'] }, before_visit: { label: 'X jours avant une venue prévue', days: [1, 60], variables: ['prenom', 'centre', 'date', 'heure', 'formule', 'pax'] }, inactive: { label: 'Clients plus vus depuis X jours', days: [30, 365], variables: ['prenom', 'centre'] }, weekly: { label: 'Chaque semaine, un jour fixe', variables: ['prenom', 'centre'] } }, segments: { all: 'Tous les clients avec email', dormant: 'Dormants (+90 jours)', loyal: 'Fidèles', birthdays: 'Clients anniversaire' } } });
      }
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'emailBrain') {
        return J({ ok: true, overrides: { faq: {}, signature: '', extra: '' }, defaults: { intents: { reservation: 'Réservation', annulation: 'Annulation / report', anniversaire: 'Anniversaire', prix: 'Prix & tarifs', horaires: 'Horaires', reclamation: 'Réclamation', autre: 'Autre' }, faq: { horaires: { subject: 'Nos horaires', body: 'Réponse type horaires du fichier.' } }, signature: "L'équipe Fun Galaxy" } });
      }
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'emailTemplates') {
        return J({ ok: true, templates: [{ id: 7, label: 'Modèle maison', subject: 'Sujet du modèle {{prenom}}', body: 'Corps du modèle pour {{prenom}}.' }], identities: [{ id: 1, label: 'Accueil', email: 'contact@fungalaxy.be', isDefault: true }, { id: 2, label: 'Direction', email: 'direction@fungalaxy.be' }], channel: { resendConfigured: true, aiConfigured: false } });
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

    console.log('\n[LOAD] page Emails v3');
    const load = await page.evaluate(() => ({
      cards: document.querySelectorAll('#staffEmailsPage .mk-auto').length,
      labels: [...document.querySelectorAll('#staffEmailsPage .mk-auto-head strong')].map((el) => el.textContent),
      switches: document.querySelectorAll('#staffEmailsPage .mk-switch').length,
      onCount: document.querySelectorAll('#staffEmailsPage .mk-switch.is-on').length,
      statsTxt: (document.querySelector('#staffEmailsPage .mk-auto .mk-auto-stats') || {}).textContent || '',
      preview: !!document.querySelector('#staffEmailsPage .mk-auto-preview summary'),
      editBtns: document.querySelectorAll('#staffEmailsPage .mk-auto-edit-btn').length,
      pipeline: document.querySelectorAll('#staffEmailsPage .pv2-pipe').length,
      tableRows: document.querySelectorAll('#staffEmailsPage .pv2-table tbody tr').length,
      newMsgBtn: [...document.querySelectorAll('#staffEmailsPage .pv2-bar-actions button')].some((b) => /Nouveau message/.test(b.textContent)),
      analyzeBtn: [...document.querySelectorAll('#staffEmailsPage .pv2-bar-actions button')].some((b) => /Analyser un reçu/.test(b.textContent)),
    }));
    if (missed.size) console.log('URLs 404 :', [...missed].slice(0, 5).join(' · '));
    ok(errs.length === 0, `aucune erreur console (${errs.length})${errs.length ? ' → ' + errs.slice(0, 3).join(' | ') : ''}`);
    ok(load.cards === 5, `5 cartes séquences (obtenu ${load.cards})`);
    ok(load.labels.some((l) => /Anniversaire J-30/.test(l)) && load.labels.some((l) => /Réactivation/.test(l)), 'Anniversaire J-30 + Réactivation présentes');
    ok(load.onCount === 4, `4 séquences ON au départ (obtenu ${load.onCount})`);
    ok(/42 envoyés/.test(load.statsTxt), `stats 30 j affichées (${load.statsTxt.trim().slice(0, 40)})`);
    ok(load.preview, 'aperçu du message dépliable');
    ok(load.editBtns === 5, `bouton Modifier sur chaque carte (obtenu ${load.editBtns})`);
    ok(load.pipeline === 6, `pipeline avec pipe Reçus (obtenu ${load.pipeline})`);
    ok(load.tableRows === 3, `file d'envoi = 3 lignes, reçus exclus (obtenu ${load.tableRows})`);
    ok(load.newMsgBtn && load.analyzeBtn, 'boutons « Nouveau message » + « Analyser un reçu » dans la bar');

    console.log('\n[TOGGLE] activer Réactivation → POST + switch ON');
    await page.evaluate(() => {
      const card = [...document.querySelectorAll('#staffEmailsPage .mk-auto')].find((c) => /Réactivation/.test(c.textContent));
      card.querySelector('.mk-switch').click();
    });
    await page.waitForTimeout(400);
    const afterOn = await page.evaluate(() => ({
      posts: window.__QA_POSTS__.filter((p) => p.action === 'automationSettings'),
      onCount: document.querySelectorAll('#staffEmailsPage .mk-switch.is-on').length,
    }));
    ok(afterOn.posts.length === 1 && afterOn.posts[0].key === 'reactivation' && afterOn.posts[0].enabled === true, 'POST automationSettings {reactivation, true}');
    ok(afterOn.onCount === 5, 'switch Réactivation passé ON');

    console.log('\n[TOGGLE] couper Anniversaire J-30 → POST enabled:false');
    await page.evaluate(() => {
      const card = [...document.querySelectorAll('#staffEmailsPage .mk-auto')].find((c) => /Anniversaire J-30/.test(c.textContent));
      card.querySelector('.mk-switch').click();
    });
    await page.waitForTimeout(400);
    const afterOff = await page.evaluate(() => ({
      last: window.__QA_POSTS__.filter((p) => p.action === 'automationSettings').slice(-1)[0],
      onCount: document.querySelectorAll('#staffEmailsPage .mk-switch.is-on').length,
    }));
    ok(afterOff.last && afterOff.last.key === 'birthday_j30' && afterOff.last.enabled === false, 'POST {birthday_j30, false}');
    ok(afterOff.onCount === 4, 'switch repassé OFF');

    console.log('\n[ÉDITEUR] personnaliser la séquence anniversaire');
    await page.evaluate(() => {
      const card = [...document.querySelectorAll('#staffEmailsPage .mk-auto')].find((c) => /Anniversaire J-30/.test(c.textContent));
      card.querySelector('.mk-auto-edit-btn').click();
    });
    await page.waitForTimeout(300);
    const editor = await page.evaluate(() => {
      const edit = document.querySelector('#staffEmailsPage .mk-auto-edit');
      return {
        open: !!edit,
        placeholder: edit ? edit.querySelector('input').placeholder : '',
        hasVars: edit ? /\{\{prenom\}\}/.test(edit.textContent) : false,
        timingOptions: edit ? edit.querySelectorAll('select option').length : 0,
      };
    });
    ok(editor.open, 'éditeur inline ouvert');
    ok(/anniversaire approche/i.test(editor.placeholder), `placeholder = texte par défaut (${editor.placeholder.slice(0, 30)}…)`);
    ok(editor.hasVars, 'variables {{prenom}}… documentées');
    ok(editor.timingOptions >= 5, `timing en libellés FR (${editor.timingOptions} options)`);
    await page.evaluate(() => {
      pv2AutoEditField('subject', 'Sujet perso anniversaire');
      pv2AutoEditSave('birthday_j30');
    });
    await page.waitForTimeout(400);
    const saved = await page.evaluate(() => ({
      last: window.__QA_POSTS__.filter((p) => p.action === 'automationSettings').slice(-1)[0],
      modified: !!document.querySelector('#staffEmailsPage .mk-auto-mod'),
    }));
    ok(saved.last && saved.last.key === 'birthday_j30' && saved.last.subject === 'Sujet perso anniversaire' && saved.last.body === undefined, 'POST étendu {key, subject} — champs inchangés non envoyés');
    ok(saved.modified, 'pilule « modifié » affichée sur la carte');

    console.log('\n[ÉDITEUR] réinitialiser → défauts');
    await page.evaluate(() => {
      const card = [...document.querySelectorAll('#staffEmailsPage .mk-auto')].find((c) => /Anniversaire J-30/.test(c.textContent));
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

    console.log('\n[COMPOSER] nouveau message : client, identité, modèle, envoi');
    await page.evaluate(() => {
      window.getStaffClientRows = () => [
        { id: 'c1', name: 'Marie Dupont', email: 'marie@test.be' },
        { id: 'c2', name: 'Lucas Petit', email: 'lucas@test.be' },
      ];
      [...document.querySelectorAll('#staffEmailsPage .pv2-bar-actions button')].find((b) => /Nouveau message/.test(b.textContent)).click();
    });
    await page.waitForTimeout(500);
    const composer = await page.evaluate(() => ({
      open: !!document.querySelector('#staffEmailsPage .pv2-composer'),
      datalist: document.querySelectorAll('#pv2ClientsList option').length,
      hasMarie: [...document.querySelectorAll('#pv2ClientsList option')].some((o) => o.value === 'marie@test.be'),
      identities: [...document.querySelectorAll('#staffEmailsPage .pv2-composer select')][0]?.options.length || 0,
    }));
    ok(composer.open, 'panneau composer ouvert');
    ok(composer.datalist >= 2 && composer.hasMarie, `autocomplete clients (${composer.datalist} suggestions, marie@test.be présent)`);
    ok(composer.identities === 2, `2 identités d'expéditeur (obtenu ${composer.identities})`);
    await page.evaluate(() => {
      const input = document.getElementById('pv2ComposerTo');
      input.value = 'marie@test.be';
      input.dispatchEvent(new Event('input'));
      pv2ComposerTemplate('starter:relance-client');
    });
    await page.waitForTimeout(300);
    const filled = await page.evaluate(() => ({
      subject: document.getElementById('pv2ComposerSubject').value,
      body: document.getElementById('pv2ComposerBody').value,
    }));
    ok(/longtemps, Marie/.test(filled.subject), `modèle prérempli avec prénom substitué (${filled.subject})`);
    ok(/Bonjour Marie/.test(filled.body), 'corps prérempli avec {{prenom}} → Marie');
    await page.evaluate(() => pv2ComposerSend());
    await page.waitForTimeout(400);
    const sent = await page.evaluate(() => ({
      post: window.__QA_POSTS__.filter((p) => p.action === 'sendDirectEmail').slice(-1)[0],
      closed: !document.querySelector('#staffEmailsPage .pv2-composer'),
    }));
    ok(sent.post && sent.post.to === 'marie@test.be' && /longtemps/.test(sent.post.subject) && sent.post.identityId === '1', 'POST sendDirectEmail {to, subject, identityId défaut}');
    ok(sent.post.replyToCommunicationId === null, 'pas de replyTo pour un message libre');
    ok(sent.closed, 'composer fermé après envoi');

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
      [...document.querySelectorAll('#staffEmailsPage .pv2-bar-actions button')].find((b) => /Analyser un reçu/.test(b.textContent)).click();
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
      open: !!document.querySelector('#staffEmailsPage .pv2-composer'),
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
main();

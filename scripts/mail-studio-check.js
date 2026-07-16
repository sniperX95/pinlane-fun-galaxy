// Vérification manuelle onglet « Mails » (admin-mail.js) : composer, envoi,
// IA fallback, historique + aperçu, modèles CRUD, identités, analyse,
// dark + mobile, zéro pageerror. Stubs API stateful côté page.
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const PORT = 4195;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const OUT = path.join(ROOT, 'artifacts', 'audit', 'mail-studio');
const BROWSER_PATH =
  process.env.E2E_BROWSER_PATH ||
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
  '.png': 'image/png', '.jpg': 'image/jpeg',
};

function serveStatic() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, BASE_URL);
    let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname === '') filePath = path.join(ROOT, 'index.html');
    if (!filePath.startsWith(ROOT)) { response.writeHead(403); response.end(); return; }
    fs.readFile(filePath, (error, content) => {
      if (error) { response.writeHead(404); response.end('Not found'); return; }
      response.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(content);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

const qaSource = fs.readFileSync(path.join(ROOT, 'scripts', 'run-visual-qa.js'), 'utf8').split('\n');
const startIdx = qaSource.findIndex((l) => l.startsWith('async function installQaApi'));
let endIdx = -1;
for (let i = startIdx + 1; i < qaSource.length; i++) { if (/^\}/.test(qaSource[i])) { endIdx = i; break; } }
const installQaApi = eval(`(${qaSource.slice(startIdx, endIdx + 1).join('\n').replace(/^async function installQaApi/, 'async function')})`);

function assert(cond, msg) { if (!cond) throw new Error(`ASSERT: ${msg}`); }

async function setupPage(context, pageErrors) {
  const page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('dialog', (dialog) => dialog.accept());
  await installQaApi(page);
  await page.addInitScript(() => {
    // Stub stateful du studio : les POST mutent ces tableaux.
    const store = {
      templates: [{ id: 11, centerId: 'libramont', name: 'Promo laser', category: 'promotion', subject: 'Soirée laser -20%', body: 'Bonjour {{prenom}}, ce vendredi…', archived: false }],
      identities: [{ id: 5, centerId: 'libramont', label: 'Contact', email: 'contact@fungalaxy.be', isDefault: true }],
      comms: [
        { id: 901, channel: 'email', templateId: 'confirmation', recipient: 'a@b.be', subject: 'Confirmation réservation', body: '<h1>Conf</h1>', status: 'sent', attempts: 1, lastError: '', sentAt: '2026-07-10T14:00:00Z', createdAt: '2026-07-10T13:59:00Z', payload: {} },
        { id: 902, channel: 'email', templateId: 'studio_promotion', recipient: 'c@d.be', subject: 'Offre été', body: '<h1>Été</h1>', status: 'failed', attempts: 3, lastError: 'Resend 403 domaine non vérifié', createdAt: '2026-07-09T10:00:00Z', payload: { textBody: 'Offre été…', category: 'promotion' } },
        { id: 903, channel: 'email', templateId: 'relance', recipient: 'e@f.be', subject: 'On vous attend', body: '<h1>Re</h1>', status: 'queued', attempts: 0, lastError: '', createdAt: '2026-07-11T08:00:00Z', payload: {} },
      ],
      nextId: 1000,
    };
    window.__msStore = store;
    const attach = () => {
      const prevFetch = window.fetch;
      window.fetch = async (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input.url, location.origin);
        const body = init?.body ? JSON.parse(init.body) : {};
        const action = url.searchParams.get('action') || body.action;
        const json = (payload) => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
        if (url.pathname === '/api/ops') {
          if (action === 'emailStudio') return json({ ok: true, templates: store.templates.filter((t) => !t.archived), identities: store.identities, channel: { resendConfigured: false, aiConfigured: false, defaultFrom: 'onboarding@resend.dev' } });
          if (action === 'communications') return json({ ok: true, communications: store.comms });
          if (action === 'emailInsights') {
            return json({ ok: true, insights: { totals: { total: 56, sent: 24, failed: 29, queued: 3, failRate: 54.7 }, byTemplate: [{ template_id: 'confirmation', count: 30 }, { template_id: 'studio_promotion', count: 8 }], byStatus: [], weekly: [{ week: '2026-06-29', count: 12 }, { week: '2026-07-06', count: 9 }], failureReasons: [{ reason: 'Resend 403 domaine non vérifié', count: 21 }], recommendations: ['Le canal d’envoi n’est pas configuré : premier blocage à lever.', 'Taux d’échec élevé (54.7 %).'] } });
          }
          if (action === 'improveEmailWithAi') return json({ ok: true, mode: 'deterministe', tips: ['Objet court : vise 30-60 caractères.', 'Aucun appel à action détecté.'], subject: null, body: null });
          if (action === 'sendDirectEmail') {
            const comm = { id: store.nextId++, channel: 'email', templateId: `studio_${body.category}`, recipient: body.to, subject: body.subject, body: `<h1>${body.subject}</h1>`, status: 'queued', attempts: 0, lastError: '', createdAt: new Date().toISOString(), payload: { textBody: body.body, category: body.category } };
            store.comms.unshift(comm);
            window.__msSent = body;
            return json({ ok: true, communication: comm, dispatched: null, resendConfigured: false });
          }
          if (action === 'saveEmailTemplate') {
            const tpl = { id: body.id || store.nextId++, centerId: 'libramont', name: body.name, category: body.category || 'marketing', subject: body.subject || '', body: body.body || '', archived: false };
            if (body.id) store.templates = store.templates.map((t) => (t.id === body.id ? tpl : t));
            else store.templates.unshift(tpl);
            return json({ ok: true, template: tpl });
          }
          if (action === 'archiveEmailTemplate') {
            store.templates = store.templates.map((t) => (t.id === body.id ? { ...t, archived: true } : t));
            return json({ ok: true, template: store.templates.find((t) => t.id === body.id) });
          }
          if (action === 'saveEmailIdentity') {
            const identity = { id: body.id || store.nextId++, centerId: 'libramont', label: body.label, email: body.email, isDefault: Boolean(body.isDefault) };
            if (identity.isDefault) store.identities = store.identities.map((i) => ({ ...i, isDefault: false }));
            if (body.id) store.identities = store.identities.map((i) => (i.id === body.id ? identity : i));
            else store.identities.push(identity);
            return json({ ok: true, identity });
          }
          if (action === 'deleteEmailIdentity') {
            store.identities = store.identities.filter((i) => i.id !== body.id);
            return json({ ok: true, deleted: body.id });
          }
        }
        return prevFetch(input, init);
      };
    };
    setTimeout(attach, 0);
    document.addEventListener('DOMContentLoaded', attach, { once: true });
  });
  return page;
}

async function openMailTab(page) {
  await page.goto(`${BASE_URL}/#staff/dashboard`, { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => setView('admin'));
  await page.waitForTimeout(1800);
  await page.evaluate(() => setAdminTab('mail'));
  await page.waitForTimeout(1200);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const pageErrors = [];

  // ---- Parcours complet light desktop -------------------------------------
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
    const page = await setupPage(context, pageErrors);
    await openMailTab(page);

    assert(await page.locator('#adminTabMail').count() === 1, 'bouton onglet Mails présent');
    assert(await page.locator('#msTo').count() === 1, 'composer rendu');
    assert(await page.locator('.ms-note.warn').count() === 1, 'bannière canal non configuré visible');

    // Modèle de départ → remplit le brouillon
    await page.locator('select.ms-input').nth(1).selectOption('starter:promo-semaine');
    await page.waitForTimeout(400);
    const subject = await page.evaluate(() => msState.draft.subject);
    assert(subject.includes('Fun Galaxy'), `modèle de départ appliqué (reçu "${subject.slice(0, 40)}")`);
    await page.screenshot({ path: path.join(OUT, '01-composer-light.png'), fullPage: true });

    // IA (fallback déterministe stubbe) → tips visibles
    await page.locator('.ms-actions .admin-btn').first().click();
    await page.waitForTimeout(700);
    assert(await page.locator('.ms-tips li').count() >= 2, 'conseils IA affichés');
    await page.screenshot({ path: path.join(OUT, '02-ia-tips.png') });

    // Envoi (dialogs auto-acceptés) → stub reçoit le payload, brouillon reset
    await page.locator('#msTo').fill('boss@fungalaxy.be');
    await page.evaluate(() => { msState.draft.to = 'boss@fungalaxy.be'; });
    await page.locator('.ms-actions .admin-btn.primary').click();
    await page.waitForTimeout(900);
    const sent = await page.evaluate(() => window.__msSent);
    assert(sent && sent.to === 'boss@fungalaxy.be' && sent.action === 'sendDirectEmail', 'envoi transmis à l’API');
    const draftAfter = await page.evaluate(() => msState.draft.to);
    assert(draftAfter === '', 'brouillon réinitialisé après envoi');

    // Historique : table + aperçu + filtre
    await page.evaluate(() => msSetSection('history'));
    await page.waitForTimeout(800);
    const histRows = await page.locator('.dh-table tbody tr').count();
    assert(histRows === 4, `historique rendu (reçu ${histRows} lignes, attendu 4 avec l'envoi test)`);
    await page.locator('.dh-table tbody tr button').first().click();
    await page.waitForTimeout(500);
    assert(await page.locator('.ms-iframe').count() === 1, 'aperçu du mail ouvert');
    await page.screenshot({ path: path.join(OUT, '03-historique-apercu.png'), fullPage: true });
    await page.evaluate(() => { msState.historyStatus = 'failed'; msRefresh(); });
    await page.waitForTimeout(300);
    assert(await page.locator('.dh-table tbody tr').count() === 1, 'filtre statut échec');
    await page.evaluate(() => { msState.historyStatus = ''; msRefresh(); });

    // Modèles : création + carte
    await page.evaluate(() => msSetSection('templates'));
    await page.waitForTimeout(400);
    assert(await page.locator('.ms-tpl-card').count() === 1, 'modèle existant listé');
    await page.evaluate(() => { msState.editingTemplate = {}; msRefresh(); });
    await page.waitForTimeout(300);
    await page.locator('#msTplName').fill('Mail école');
    await page.locator('#msTplSubject').fill('Sortie scolaire chez Fun Galaxy');
    await page.locator('#msTplBody').fill('Bonjour, votre classe est la bienvenue…');
    await page.locator('.ms-actions .admin-btn.primary').click();
    await page.waitForTimeout(600);
    assert(await page.locator('.ms-tpl-card').count() === 2, 'nouveau modèle ajouté');
    await page.screenshot({ path: path.join(OUT, '04-modeles.png'), fullPage: true });

    // Identités : ajout + défaut
    await page.evaluate(() => msSetSection('identities'));
    await page.waitForTimeout(400);
    assert(await page.locator('.dh-report-item').count() === 1, 'identité existante listée');
    await page.evaluate(() => { msState.identityForm = true; msRefresh(); });
    await page.waitForTimeout(300);
    await page.locator('#msIdLabel').fill('Promo');
    await page.locator('#msIdEmail').fill('promo@fungalaxy.be');
    await page.locator('.ms-actions .admin-btn.primary').click();
    await page.waitForTimeout(900);
    assert(await page.locator('.dh-report-item').count() === 2, 'identité ajoutée');
    await page.screenshot({ path: path.join(OUT, '05-identites.png') });

    // Analyse : tuiles + recommandations
    await page.evaluate(() => msSetSection('insights'));
    await page.waitForTimeout(800);
    assert(await page.locator('.dh-tile').count() === 4, 'tuiles analyse rendues');
    assert(await page.locator('.ms-recos li').count() >= 2, 'recommandations affichées');
    await page.screenshot({ path: path.join(OUT, '06-analyse.png'), fullPage: true });

    await page.close();
    await context.close();
  }

  // ---- Dark desktop + light mobile ----------------------------------------
  for (const [name, opts] of [
    ['07-mails-dark-desktop', { viewport: { width: 1440, height: 900 }, colorScheme: 'dark' }],
    ['08-mails-light-mobile', { viewport: { width: 390, height: 844 }, colorScheme: 'light' }],
  ]) {
    const context = await browser.newContext(opts);
    const page = await setupPage(context, pageErrors);
    await openMailTab(page);
    assert(await page.locator('#msTo').count() === 1, `${name} : composer rendu`);
    const overflow = await page.evaluate(() => {
      window.scrollTo(9999, 0);
      const scrolled = window.scrollX;
      window.scrollTo(0, 0);
      return scrolled;
    });
    assert(overflow <= 0, `${name} : pas de scroll horizontal (reçu ${overflow}px)`);
    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
    await page.close();
    await context.close();
  }

  // Les init scripts Playwright s'exécutent aussi dans l'iframe sandbox de
  // l'aperçu et y échouent sur localStorage : artefact du harnais, pas de l'app.
  const critical = pageErrors.filter((e) => !/ResizeObserver|favicon|lacks the 'allow-same-origin'/i.test(e));
  if (critical.length) {
    console.log('PAGE ERRORS:', JSON.stringify(critical, null, 1));
    throw new Error(`${critical.length} erreur(s) page`);
  }
  await browser.close();
  server.close();
  console.log('MAIL STUDIO CHECK: ALL OK');
}

main().catch((e) => { console.error(e); process.exit(1); });

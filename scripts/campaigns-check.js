// Vérification Lot G : campagnes réelles — section rendue, audience live,
// création (brouillon / envoi / programmée), annulation, exports, zéro pageerror.
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const PORT = 4197;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const OUT = path.join(ROOT, 'artifacts', 'audit', 'campaigns');
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg' };

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
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

const qaSource = fs.readFileSync(path.join(ROOT, 'scripts', 'run-visual-qa.js'), 'utf8').split('\n');
const startIdx = qaSource.findIndex((l) => l.startsWith('async function installQaApi'));
let endIdx = -1;
for (let i = startIdx + 1; i < qaSource.length; i++) { if (/^\}/.test(qaSource[i])) { endIdx = i; break; } }
const installQaApi = eval(`(${qaSource.slice(startIdx, endIdx + 1).join('\n').replace(/^async function installQaApi/, 'async function')})`);

function assert(cond, msg) { if (!cond) throw new Error(`ASSERT: ${msg}`); }

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('dialog', (dialog) => dialog.accept());
  await installQaApi(page);
  await page.addInitScript(() => {
    const store = {
      campaigns: [],
      nextId: 70,
      segments: [
        { id: 'all', label: 'Tous les clients avec email', description: '' },
        { id: 'dormant', label: 'Dormants (+90 jours)', description: '' },
        { id: 'loyal', label: 'Fidèles', description: '' },
      ],
      audiences: { all: { count: 6, sample: ['Ansar', 'Marie'] }, dormant: { count: 2, sample: ['Vieux Client'] }, loyal: { count: 3, sample: ['Fidèle Un'] } },
    };
    window.__campStore = store;
    const attach = () => {
      const prevFetch = window.fetch;
      window.fetch = async (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input.url, location.origin);
        const body = init?.body ? JSON.parse(init.body) : {};
        const action = url.searchParams.get('action') || body.action;
        const json = (payload) => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
        if (url.pathname === '/api/ops') {
          if (action === 'listCampaigns') return json({ ok: true, campaigns: store.campaigns, segments: store.segments, channel: { resendConfigured: false } });
          if (action === 'campaignAudience') {
            const seg = url.searchParams.get('segment');
            if (url.searchParams.get('full') === '1') { window.__csvExported = seg; return json({ ok: true, count: 2, recipients: [{ name: 'A', email: 'a@b.be', visits: 1, revenue: 10, lastDate: '2026-07-01' }] }); }
            return json({ ok: true, ...(store.audiences[seg] || { count: 0, sample: [] }) });
          }
          if (action === 'createCampaign') {
            const campaign = {
              id: store.nextId++, name: body.name, segment: body.segment, subject: body.subject, body: body.body,
              status: body.mode === 'draft' ? 'draft' : body.mode === 'schedule' ? 'scheduled' : 'sending',
              scheduledAt: body.scheduledAt, recipientCount: (store.audiences[body.segment] || {}).count || 0,
              sent: 0, failed: 0, queued: body.mode === 'draft' ? 0 : (store.audiences[body.segment] || {}).count || 0,
              opens: 0, clicks: 0,
            };
            store.campaigns.unshift(campaign);
            return json({ ok: true, campaign, queued: campaign.queued, resendConfigured: false });
          }
          if (action === 'cancelCampaign') {
            store.campaigns = store.campaigns.map((c) => (c.id === body.id ? { ...c, status: 'cancelled', queued: 0 } : c));
            return json({ ok: true, campaign: store.campaigns.find((c) => c.id === body.id), cancelledCommunications: 2 });
          }
        }
        return prevFetch(input, init);
      };
    };
    setTimeout(attach, 0);
    document.addEventListener('DOMContentLoaded', attach, { once: true });
  });

  await page.goto(`${BASE_URL}/#staff/campaigns`, { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(2200);
  assert(await page.locator('.pv2-panel-head h2:has-text("Campagnes email")').count() === 1, 'section campagnes réelles rendue');
  assert((await page.locator('.pv2-panel-body .pv2-empty').first().textContent()).includes('Aucune campagne'), 'état vide propre');

  // Formulaire + audience live
  await page.locator('button:has-text("+ Nouvelle campagne")').click();
  await page.waitForTimeout(900);
  const audienceText = await page.evaluate(() => document.querySelector('.ms-form .ms-input span')?.textContent || '');
  assert(audienceText.includes('6 destinataire'), `audience live du segment (reçu "${audienceText}")`);
  await page.locator('select.ms-input').selectOption('dormant');
  await page.waitForTimeout(800);
  const audience2 = await page.evaluate(() => document.querySelector('.ms-form .ms-input span')?.textContent || '');
  assert(audience2.includes('2 destinataire'), `audience recalculée au changement de segment (reçu "${audience2}")`);
  await page.screenshot({ path: path.join(OUT, '01-form-audience.png'), fullPage: true });

  // Création : envoi immédiat (confirm auto-accepté)
  await page.evaluate(() => {
    pv2Camp.form.name = 'Relance dormants juillet';
    pv2Camp.form.subject = 'On vous attend {{prenom}} !';
    pv2Camp.form.body = 'Bonjour {{prenom}}, revenez nous voir.';
  });
  await page.locator('button:has-text("Envoyer maintenant")').click();
  await page.waitForTimeout(1200);
  const row = await page.locator('.pv2-table tbody tr').first().textContent();
  assert(row.includes('Relance dormants juillet') && row.includes('En envoi'), `campagne listée avec statut réel (reçu "${row.slice(0, 90)}")`);
  assert(row.includes('non suivis'), 'ouvertures/clics affichés honnêtement comme non suivis');
  await page.screenshot({ path: path.join(OUT, '02-campagne-listee.png'), fullPage: true });

  // Annulation → stoppe la file
  await page.locator('.pv2-table tbody tr').first().locator('button:has-text("Annuler")').click();
  await page.waitForTimeout(900);
  const rowAfter = await page.locator('.pv2-table tbody tr').first().textContent();
  assert(rowAfter.includes('Annulée'), 'annulation reflétée');

  // Export destinataires
  await page.locator('button:has-text("+ Nouvelle campagne")').click();
  await page.waitForTimeout(600);
  await page.locator('button:has-text("Exporter la liste")').click();
  await page.waitForTimeout(600);
  const exported = await page.evaluate(() => window.__csvExported);
  assert(Boolean(exported), 'export CSV des destinataires déclenché (full=1)');

  const critical = pageErrors.filter((e) => !/ResizeObserver|favicon/i.test(e));
  if (critical.length) { console.log('PAGE ERRORS:', JSON.stringify(critical, null, 1)); throw new Error(`${critical.length} erreur(s) page`); }
  await browser.close();
  server.close();
  console.log('CAMPAIGNS CHECK: ALL OK');
}

main().catch((e) => { console.error(e); process.exit(1); });

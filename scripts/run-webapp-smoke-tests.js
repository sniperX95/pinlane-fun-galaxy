// Fumee du parcours reel sur la PRODUCTION (mngfunglxy.com). HORS de la chaine
// test:ops:all A DESSEIN : il depend du reseau et de l etat deploye, un rouge
// d infrastructure bloquerait tout push. A lancer A LA MAIN apres chaque
// deploiement : node scripts/run-webapp-smoke-tests.js
const path = require('path');
const { chromium } = require('playwright-core');

const baseUrl = process.env.E2E_BASE_URL || 'https://www.mngfunglxy.com';
const staffCode = process.env.PINLANE_E2E_STAFF_CODE || '';
const browserPath =
  process.env.E2E_BROWSER_PATH ||
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: browserPath,
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 920 },
  });
  const consoleErrors = [];
  const pageErrors = [];

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  try {
    await page.goto(`${baseUrl}/?v=e2e-smoke-${Date.now()}`, {
      waitUntil: 'networkidle',
      timeout: 45000,
    });

    const bodyText = await page.locator('body').innerText({ timeout: 15000 });
    // Ancres = la COPIE PRODUIT du tunnel (recapitulatif, reservation, total
    // estime), jamais le nom du tenant ni un libelle d etape : la copie a deja
    // change trois fois et l ancienne regex (Fun Galaxy|Pinlane|Date et
    // joueurs) rougissait sur un site parfaitement sain (mesure 2026-08-31).
    assert(/réservation|récapitulatif|total estimé/i.test(bodyText), 'La page publique ne rend pas le contenu attendu.');
    assert(await page.locator('#btnStaff').count(), 'Le bouton Staff est introuvable.');
    const staffButton = page.locator('#btnStaff');
    if (await staffButton.isVisible()) {
      await staffButton.click();
    } else {
      await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
      await page.evaluate(() => window.setView('staff'));
    }
    await page.locator('#authOverlay:not(.hidden)').waitFor({ timeout: 15000 });
    assert(await page.locator('#loginPass').isVisible(), 'Le formulaire de connexion staff ne s affiche pas.');

    let authenticated = false;
    if (staffCode) {
      await page.locator('#loginPass').fill(staffCode);
      await Promise.all([
        page.waitForResponse((response) => response.url().includes('/api/staff-auth') && response.request().method() === 'POST'),
        page.locator('#authOverlay button[type="submit"]').click(),
      ]);
      await page.waitForTimeout(900);
      const overlayStillVisible = await page.locator('#authOverlay:not(.hidden)').count();
      assert(!overlayStillVisible, 'La connexion staff a echoue avec le code E2E fourni.');
      authenticated = true;

      await page.locator('#staffView .kpi-grid .kpi').first().waitFor({ timeout: 15000 });
      const kpiMedia = await page.$$eval('#staffView .kpi-grid .kpi', (cards) => cards.slice(0, 4).map((card) => {
        const before = window.getComputedStyle(card, '::before');
        const after = window.getComputedStyle(card, '::after');
        return {
          beforeVisible:
            before.display !== 'none' &&
            before.content !== 'none' &&
            before.backgroundImage !== 'none' &&
            (Number.parseFloat(before.width) || 0) >= 32 &&
            (Number.parseFloat(before.height) || 0) >= 32,
          afterVisible:
            after.display !== 'none' &&
            after.content !== 'none' &&
            after.backgroundImage !== 'none' &&
            (Number.parseFloat(after.width) || 0) >= 72 &&
            (Number.parseFloat(after.height) || 0) >= 28,
        };
      }));
      assert(kpiMedia.length >= 4, 'Les KPI du planning staff ne sont pas rendus.');
      assert(
        kpiMedia.every((item) => item.beforeVisible && item.afterVisible),
        'Les KPI du planning staff ont perdu leurs icones ou mini-graphes.'
      );
    }

    const blockingConsoleErrors = consoleErrors.filter((entry) => (
      !/favicon|net::ERR_ABORTED|Failed to load resource/i.test(entry)
    ));
    assert(!pageErrors.length, `Erreur JavaScript navigateur: ${pageErrors.join(' | ')}`);
    assert(!blockingConsoleErrors.length, `Erreur console navigateur: ${blockingConsoleErrors.join(' | ')}`);

    console.log(JSON.stringify({
      ok: true,
      baseUrl,
      publicPage: 'ok',
      staffGate: authenticated ? 'authenticated' : 'login-visible',
    }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

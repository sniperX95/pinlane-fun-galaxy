// Verifie que chaque DETAIL EXTRAIT montre vraiment quelque chose.
//
// La scene decoupe des morceaux du clip pour les faire vivre au premier plan.
// Un recadrage mal place tombe sur une zone vide de l'interface : a l'ecran
// ca donne une vignette grise qui a l'air d'un bug, et personne ne le voit en
// regardant six images au hasard.
//
// Le discriminant est l'ECART-TYPE de luminance : une zone qui porte du texte
// ou des blocs a du contraste, une zone vide n'en a aucun.
//
// Usage : node marketing/promo-video/check-fragments.js [scene.html]

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const REPO = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(REPO, 'node_modules/playwright-core'));

const SCENE = process.argv[2] || 'scene-pro.html';
const ECART_MIN = 12;
const TMP = path.join(require('os').tmpdir(), 'frag-check.png');      // en dessous : la vignette est un aplat

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 2560, height: 1440 } });
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  await page.goto('file://' + path.join(__dirname, SCENE).replace(/\\/g, '/'), { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1200);

  const plans = await page.evaluate(() => window.__PLANS_INFO || null);
  const bornes = plans || await page.evaluate(() => {
    // Les bornes ne sont pas exposees : on les relit depuis la scene.
    const t = [];
    for (let i = 0; i < 8; i++) t.push(i);
    return t;
  });

  // Instants de controle : le milieu de chaque plan, la ou tout est en place.
  const INSTANTS = [1.6, 4.9, 8.5, 11.7, 14.8, 18.0, 21.2];
  const lignes = [];
  let rates = 0;

  for (const t of INSTANTS) {
    await page.evaluate((x) => window.renderFrame(x), t);
    await page.waitForFunction(() => window.SCRUB_SETTLED(), null, { timeout: 6000 }).catch(() => {});
    await page.evaluate(() => { if (window.PAINT) window.PAINT(); });
    await page.waitForTimeout(120);

    // On CAPTURE la vignette au lieu de relire le canvas : une video chargee
    // en file:// « teinte » le canvas et getImageData y est interdit. La
    // capture, elle, voit exactement ce que verra le film.
    const mesures = [];
    for (const id of ['f1', 'f2']) {
      const png = await page.locator('#' + id).screenshot();
      fs.writeFileSync(TMP, png);
      const gris = execFileSync('ffmpeg', ['-v', 'error', '-i', TMP,
        '-vf', 'format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 64 * 1024 * 1024 });
      let n = 0, somme = 0, somme2 = 0;
      for (let i = 0; i < gris.length; i += 8) { const l = gris[i]; somme += l; somme2 += l * l; n++; }
      const moy = somme / n;
      mesures.push({ id, moy, ecart: Math.sqrt(Math.max(0, somme2 / n - moy * moy)) });
    }

    for (const m of mesures) {
      const ok = m.ecart >= ECART_MIN;
      if (!ok) rates++;
      lignes.push(`  t=${String(t).padStart(5)}s  ${m.id}  ecart-type ${m.ecart.toFixed(1).padStart(6)}  `
        + `moyenne ${(m.moy || 0).toFixed(0).padStart(3)}  ${ok ? 'ok' : 'PLAT'}`);
    }
  }

  const horsClip = await page.evaluate(() => window.SCRUB_ERRORS || []);
  await browser.close();

  console.log(lignes.join('\n'));
  console.log(`\nerreurs JS : ${erreurs.length ? erreurs.slice(0, 3).join(' | ') : 'aucune'}`);
  console.log(`scrubs hors clip : ${horsClip.length ? JSON.stringify(horsClip.slice(0, 4)) : 'AUCUN'}`);
  console.log(`vignettes plates : ${rates} (seuil d'ecart-type ${ECART_MIN})`);

  if (erreurs.length || horsClip.length || rates) process.exit(1);
  console.log('OK : tous les details extraits portent du contenu');
})().catch((e) => { console.error(e.message); process.exit(1); });

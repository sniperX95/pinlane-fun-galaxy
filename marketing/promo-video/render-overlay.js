// Rend overlay.html en video AVEC CANAL ALPHA, pour la composer par-dessus
// l'enregistrement des vraies interactions.
//
// Le format doit conserver la transparence : PNG en entree, QuickTime PNG en
// sortie. Un mp4 h264 classique ecraserait l'alpha et poserait un cadre noir
// sur tout le produit.
//
// Usage : node marketing/promo-video/render-overlay.js [--fps 30]

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(REPO, 'node_modules/playwright-core'));
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; };

const FPS = Number(arg('fps', 30));
const W = 2560, H = 1440;
const OUT = path.join(REPO, 'artifacts/promo-video');
const FRAMES = path.join(OUT, 'overlay-frames');

(async () => {
  fs.rmSync(FRAMES, { recursive: true, force: true });
  fs.mkdirSync(FRAMES, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.goto('file://' + path.join(__dirname, 'overlay.html').replace(/\\/g, '/'), { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);

  const DUR = await page.evaluate(() => window.SCENE_DURATION || 15);
  const total = Math.round(DUR * FPS);
  console.log(`overlay : ${DUR}s x ${FPS} fps = ${total} frames (alpha)`);

  for (let i = 0; i < total; i++) {
    await page.evaluate((t) => window.renderFrame(t), i / FPS);
    await page.screenshot({
      path: path.join(FRAMES, `f${String(i).padStart(5, '0')}.png`),
      omitBackground: true,          // <- c'est ce qui conserve la transparence
      animations: 'disabled',
    });
    if (i % 90 === 0) process.stdout.write(`\r  ${Math.round((i / total) * 100)}%   `);
  }
  process.stdout.write('\r  100%   \n');
  await browser.close();

  const mov = path.join(OUT, 'overlay-ads.mov');
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error',
    '-framerate', String(FPS), '-i', path.join(FRAMES, 'f%05d.png'),
    '-c:v', 'qtrle', '-pix_fmt', 'argb', mov], { stdio: ['ignore', 'ignore', 'pipe'] });

  console.log(`OK : ${path.relative(REPO, mov)} (${(fs.statSync(mov).size / 1048576).toFixed(0)} Mo, alpha conserve)`);
  fs.rmSync(FRAMES, { recursive: true, force: true });
})().catch((e) => { console.error('render-overlay:', e.message); process.exit(1); });

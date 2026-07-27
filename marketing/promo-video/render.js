// Rendu image par image de scene.html, puis assemblage en MP4 par ffmpeg.
//
// Pourquoi image par image et pas une capture video : une capture ecran depend
// de la charge machine, saute des frames et donne un resultat different a
// chaque execution. Ici on PILOTE le temps (window.renderFrame(t)) : le film
// est reproductible au pixel pres, et on peut le re-rendre apres une retouche
// sans rejouer la mise en scene.
//
// Usage : node marketing/promo-video/render.js [--fps 30] [--scale 1]

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(REPO, 'node_modules/playwright-core'));

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? def : process.argv[i + 1];
};

const FPS = Number(arg('fps', 30));
const SCALE = Number(arg('scale', 1));
const W = 1920, H = 1080;
const OUT_DIR = path.join(REPO, 'artifacts', 'promo-video');
const FRAME_DIR = path.join(OUT_DIR, 'frames');

(async () => {
  fs.rmSync(FRAME_DIR, { recursive: true, force: true });
  fs.mkdirSync(FRAME_DIR, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: W, height: H },
    deviceScaleFactor: SCALE,
  });

  const url = 'file://' + path.join(__dirname, 'scene.html').replace(/\\/g, '/');
  await page.goto(url, { waitUntil: 'networkidle' });
  // Les woff2 doivent etre pretes AVANT la premiere capture, sinon les
  // premieres frames sortent avec la police de repli.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);

  const DUR = await page.evaluate(() => {
    // DUR est une const du module de scene : on la relit sans la dupliquer ici.
    return Number(/const DUR = ([\d.]+)/.exec(document.querySelector('script:last-of-type').textContent)[1]);
  });
  const total = Math.round(DUR * FPS);
  console.log(`Rendu : ${DUR}s x ${FPS} fps = ${total} frames, ${W * SCALE}x${H * SCALE}`);

  const started = Date.now();
  for (let i = 0; i < total; i++) {
    const t = i / FPS;
    await page.evaluate((time) => window.renderFrame(time), t);
    await page.screenshot({
      path: path.join(FRAME_DIR, `f${String(i).padStart(5, '0')}.png`),
      animations: 'disabled',
    });
    if (i % 60 === 0 || i === total - 1) {
      const pct = Math.round(((i + 1) / total) * 100);
      process.stdout.write(`\r  ${pct}% (${i + 1}/${total})   `);
    }
  }
  process.stdout.write('\n');
  await browser.close();
  console.log(`Frames rendues en ${Math.round((Date.now() - started) / 1000)}s`);

  // -- Assemblage ------------------------------------------------------------
  // yuv420p + dimensions paires : sans ca, le fichier ne lit pas sur les
  // lecteurs materiels ni dans la plupart des apps sociales.
  const mp4 = path.join(OUT_DIR, 'pinlane-promo-1080p.mp4');
  execFileSync('ffmpeg', [
    '-y', '-framerate', String(FPS),
    '-i', path.join(FRAME_DIR, 'f%05d.png'),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '17',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    mp4,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  const sizeMb = (fs.statSync(mp4).size / 1048576).toFixed(1);
  console.log(`MP4  : ${path.relative(REPO, mp4)} (${sizeMb} Mo)`);

  // Version carree 1:1, recadree au centre : format des posts LinkedIn / X.
  const square = path.join(OUT_DIR, 'pinlane-promo-1080x1080.mp4');
  execFileSync('ffmpeg', [
    '-y', '-i', mp4,
    '-vf', 'crop=1080:1080:420:0',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    square,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  console.log(`Carre: ${path.relative(REPO, square)} (${(fs.statSync(square).size / 1048576).toFixed(1)} Mo)`);

  // Poster : la premiere image d'un film promo est souvent celle qu'on voit
  // le plus (miniature, lien partage). On prend une frame de la scene finale.
  const poster = path.join(OUT_DIR, 'pinlane-promo-poster.png');
  fs.copyFileSync(path.join(FRAME_DIR, `f${String(Math.round(23 * FPS)).padStart(5, '0')}.png`), poster);
  console.log(`Poster: ${path.relative(REPO, poster)}`);
})().catch((error) => {
  console.error('render: erreur', error.message);
  process.exit(1);
});

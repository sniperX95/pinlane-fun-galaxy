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
const W = Number(arg('w', 1920)), H = Number(arg('h', 1080));
const OUT_DIR = path.join(REPO, 'artifacts', 'promo-video');
const FRAME_DIR = path.join(OUT_DIR, 'frames-' + (arg('out','pinlane-promo')));

(async () => {
  fs.rmSync(FRAME_DIR, { recursive: true, force: true });
  fs.mkdirSync(FRAME_DIR, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: W, height: H },
    deviceScaleFactor: SCALE,
  });

  const SCENE = arg('scene', 'scene.html');
  const url = 'file://' + path.join(__dirname, SCENE).replace(/\\/g, '/');
  await page.goto(url, { waitUntil: 'networkidle' });
  // Les captures produit sont chargees en <img> : sans cette attente, les
  // premieres frames sortiraient avec des cadres vides.
  await page.evaluate(() => Promise.all(
    [...document.images].filter((i) => !i.complete).map((i) => new Promise((r) => { i.onload = i.onerror = r; })),
  ));
  // Les woff2 doivent etre pretes AVANT la premiere capture, sinon les
  // premieres frames sortent avec la police de repli.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);

  const DUR = await page.evaluate(() => window.SCENE_DURATION || 25);
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
  const NAME = arg('out', 'pinlane-promo');
  const mp4 = path.join(OUT_DIR, NAME + '-1080p.mp4');
  execFileSync('ffmpeg', [
    '-y', '-framerate', String(FPS),
    '-i', path.join(FRAME_DIR, 'f%05d.png'),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '17',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    mp4,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  // -- Bande-son ------------------------------------------------------------
  // Muxee si soundtrack.js a ete lance pour ce nom. -shortest evite qu'une
  // piste audio plus longue que l'image rallonge la video d'une seconde noire.
  const wav = arg('audio', path.join(OUT_DIR, `${NAME}-audio.wav`));
  if (fs.existsSync(wav)) {
    const withSound = path.join(OUT_DIR, `${NAME}-1080p-son.mp4`);
    execFileSync('ffmpeg', [
      '-y', '-i', mp4, '-i', wav,
      '-map', '0:v:0', '-map', '1:a:0',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest',
      '-movflags', '+faststart', withSound,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    fs.renameSync(withSound, mp4);
    console.log('Bande-son muxee (aac 192k)');
  } else {
    console.log('Pas de bande-son : lancer soundtrack.js --out ' + NAME);
  }

  const sizeMb = (fs.statSync(mp4).size / 1048576).toFixed(1);
  console.log(`MP4  : ${path.relative(REPO, mp4)} (${sizeMb} Mo)`);

  // Version LEGERE pour l'envoi et le web : meme image, debit plafonne. Un
  // master a 14 Mo ne passe pas dans une messagerie ni dans un mail.
  const web = path.join(OUT_DIR, `${NAME}-web.mp4`);
  execFileSync('ffmpeg', [
    '-y', '-i', mp4,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '28',
    '-maxrate', '900k', '-bufsize', '1800k',
    '-vf', 'scale=1280:720:flags=lanczos',
    '-c:a', 'aac', '-b:a', '112k',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', web,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  console.log(`Web  : ${path.relative(REPO, web)} (${(fs.statSync(web).size / 1048576).toFixed(1)} Mo, 720p)`);

  // Version carree : seulement depuis un master paysage.
  if (H <= W) {
  const square = path.join(OUT_DIR, NAME + '-1080x1080.mp4');
  execFileSync('ffmpeg', [
    '-y', '-i', mp4,
    '-vf', 'crop=1080:1080:420:0',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    square,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  console.log(`Carre: ${path.relative(REPO, square)}`);
  }

  // Poster : la miniature est souvent l'image la plus vue d'un film promo.
  // On la prend a 92 % de la duree (scene finale) quelle que soit la scene.
  const poster = path.join(OUT_DIR, NAME + '-poster.png');
  const posterFrame = Math.min(total - 1, Math.round(DUR * 0.92 * FPS));
  fs.copyFileSync(path.join(FRAME_DIR, `f${String(posterFrame).padStart(5, '0')}.png`), poster);
  console.log(`Poster: ${path.relative(REPO, poster)}`);
})().catch((error) => {
  console.error('render: erreur', error.message);
  process.exit(1);
});

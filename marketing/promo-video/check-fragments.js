// Verifie les VIGNETTES DE DETAIL, sur trois points independants.
//
// 1. ELLES MONTRENT QUELQUE CHOSE. Le discriminant est l'ECART-TYPE de
//    luminance : une zone qui porte du texte a du contraste, une zone vide
//    n'en a aucun. Une vignette grise a l'air d'un bug et ne se voit pas en
//    regardant six images au hasard.
//
// 2. ELLES SONT NETTES. On compare la definition NATIVE de la capture a la
//    taille qu'elle occupe dans le film : en dessous de 1 pixel source par
//    pixel de film, l'image est agrandie : c'est exactement ce qui rendait la
//    version precedente molle (520 px de video etires sur 822 px de film).
//
// 3. AUCUNE N'EST MANQUANTE. Une cle absente du manifeste afficherait un cadre
//    vide sans lever d'erreur.
//
// Usage : node marketing/promo-video/check-fragments.js [scene.html]

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const REPO = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(REPO, 'node_modules/playwright-core'));

const SCENE = process.argv[2] || 'scene-net.html';
const ECART_MIN = 12;
const DSF_FILM = 1.5;
const DEFINITION_MIN = 1.0;
const TMP = path.join(require('os').tmpdir(), 'frag-check.png');      // en dessous : la vignette est un aplat

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 2560, height: 1440 } });
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  await page.goto('file://' + path.join(__dirname, SCENE).replace(/\\/g, '/'), { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1200);

  // Instants de controle : le milieu de chaque plan, la ou tout est en place.
  const INSTANTS = [1.6, 4.9, 8.5, 11.7, 14.8, 18.0, 21.2];
  const lignes = [];
  let plats = 0, mous = 0;

  for (const t of INSTANTS) {
    await page.evaluate((x) => window.renderFrame(x), t);
    await page.waitForFunction(() => window.SCRUB_SETTLED(), null, { timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(120);

    // La DEFINITION se lit dans le DOM : pixels natifs de la capture contre
    // largeur reellement occupee dans le film. C'est une mesure exacte, elle
    // ne depend d'aucun seuil.
    const infos = await page.evaluate((dsf) => ['f1', 'f2'].map((id) => {
      const el = document.getElementById(id);
      const img = el.querySelector('img');
      const large = el.getBoundingClientRect().width;
      return {
        id,
        src: (img.getAttribute('src') || '').split('/').pop(),
        natif: img.naturalWidth,
        cadre: Math.round(large),
        definition: img.naturalWidth / Math.max(1, large * dsf),
      };
    }), DSF_FILM);

    for (const info of infos) {
      const png = await page.locator('#' + info.id).screenshot();
      fs.writeFileSync(TMP, png);
      const gris = execFileSync('ffmpeg', ['-v', 'error', '-i', TMP,
        '-vf', 'format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 64 * 1024 * 1024 });
      let n = 0, somme = 0, somme2 = 0;
      for (let i = 0; i < gris.length; i += 8) { const l = gris[i]; somme += l; somme2 += l * l; n++; }
      const moy = somme / n;
      const ecart = Math.sqrt(Math.max(0, somme2 / n - moy * moy));
      const plat = ecart < ECART_MIN;
      const mou = info.definition < DEFINITION_MIN;
      if (plat) plats++;
      if (mou) mous++;
      lignes.push(`  t=${String(t).padStart(5)}s  ${info.id}  ${info.src.padEnd(22)}`
        + ` ecart-type ${ecart.toFixed(1).padStart(5)}  ${String(info.natif).padStart(4)}px sur ${String(info.cadre).padStart(3)}`
        + `  definition x${info.definition.toFixed(2)}  ${plat ? 'PLAT' : (mou ? 'MOU' : 'ok')}`);
    }
  }

  const horsClip = await page.evaluate(() => window.SCRUB_ERRORS || []);
  const manquants = await page.evaluate(() => window.DETAILS_MANQUANTS || []);
  await browser.close();

  console.log(lignes.join('\n'));
  console.log(`\nerreurs JS : ${erreurs.length ? erreurs.slice(0, 3).join(' | ') : 'aucune'}`);
  console.log(`scrubs hors clip : ${horsClip.length ? JSON.stringify(horsClip.slice(0, 4)) : 'AUCUN'}`);
  console.log(`details manquants : ${manquants.length ? manquants.join(', ') : 'AUCUN'}`);
  console.log(`vignettes plates : ${plats} (seuil d'ecart-type ${ECART_MIN})`);
  console.log(`vignettes agrandies : ${mous} (definition minimale x${DEFINITION_MIN})`);

  if (erreurs.length || horsClip.length || manquants.length || plats || mous) process.exit(1);
  console.log('OK : chaque vignette porte du contenu, et aucune n\'est agrandie');
})().catch((e) => { console.error(e.message); process.exit(1); });

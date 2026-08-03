// LES ASSETS DU FILM « MAILS ET RELANCES » (build in public, format carre).
//
// Meme principe que `promo-shotcraft-assets.js`, applique a une autre page :
// on ouvre le PRODUIT en mode demonstration (`?demo=1`), on le photographie, et
// on LIT SES DONNEES dans le DOM. La narration se construit ensuite sur ces
// valeurs-la : la phrase dite et l'image montree ne peuvent plus se contredire,
// parce qu'elles sortent de la meme lecture.
//
// Ce que ce script ne fait PAS : ecrire un libelle a la main. Le film precedent
// avait paye cette erreur (« ca dit piste 6 alors que c'est piste 5 ») parce
// qu'une liste de titres etait appliquee par rang aux cartes.
//
// Sortie :
//   marketing/promo-video/shotcraft/public/textures/relances/*.png
//   marketing/promo-video/shotcraft/src/relances/live-layout.json
//
// Usage : node scripts/promo-relances-assets.js

const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const SHOT = path.join(ROOT, 'marketing/promo-video/shotcraft');
const OUT = path.join(SHOT, 'public/textures/relances');
const LAYOUT = path.join(SHOT, 'src/relances/live-layout.json');
const PORT = 4612;
const BASE = `http://127.0.0.1:${PORT}`;

const VIEW = { width: 1920, height: 1080 };
const DSF = 2;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };

const serve = () => new Promise((resolve) => {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE);
    let file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname === '') file = path.join(ROOT, 'index.html');
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, content) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(content);
    });
  });
  server.listen(PORT, '127.0.0.1', () => resolve(server));
});

const RATES = [];

// Taille reelle d'un PNG. En-tete PNG : largeur et hauteur en gros-boutiste aux
// octets 16..23. Une texture publiee sous une hauteur de page qui n'est pas la
// sienne est etiree en silence par le film, et les elements superposes derivent.
const verifierTexture = (nom, hAttendue) => {
  const png = fs.readFileSync(path.join(OUT, nom));
  const w = png.readUInt32BE(16);
  const h = png.readUInt32BE(20);
  if (w !== VIEW.width * DSF || h !== Math.round(hAttendue * DSF)) {
    RATES.push(`${nom} : ${w}x${h} px alors que la page annonce ${hAttendue} CSS`
      + ` en densite ${DSF} (attendu ${VIEW.width * DSF}x${Math.round(hAttendue * DSF)})`);
  }
};

// Photographie un noeud du DOM, fond transparent, a sa taille reelle. Le clip
// exige `fullPage` : sans lui il est borne au viewport et l'image sort etiree.
const decouper = async (page, sel, nom, index = 0) => {
  const boite = await page.evaluate(([s, i]) => {
    const el = document.querySelectorAll(s)[i];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height };
  }, [sel, index]);
  if (!boite || boite.width < 4 || boite.height < 4) {
    RATES.push(`decoupe introuvable ou vide : ${nom} (${sel} #${index})`);
    return null;
  }
  await page.screenshot({ path: path.join(OUT, `${nom}.png`), clip: boite, fullPage: true, omitBackground: true });
  return boite;
};

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(path.dirname(LAYOUT), { recursive: true });

  const server = await serve();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: DSF });
  // Thème clair et animations figees. Une capture prise a mi-transition sort a
  // demi transparente, et rien ne le signale.
  await ctx.addInitScript(() => {
    const poser = () => {
      if (!document.body) { requestAnimationFrame(poser); return; }
      const st = document.createElement('style');
      st.textContent = '*,*::before,*::after{animation-duration:0s !important;transition-duration:0s !important}';
      document.head.appendChild(st);
      document.documentElement.setAttribute('data-theme', 'light');
    };
    poser();
  });

  const page = await ctx.newPage();
  await page.goto(`${BASE}/?demo=1&v=${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForFunction(() => typeof window.openStaffMenuPage === 'function', null, { timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.openStaffMenuPage('emails'));
  await page.waitForTimeout(2500);

  const layout = { pageW: VIEW.width };

  // LE FOND DU FILM VIENT DU PRODUIT. La camera cadre un point de la page : des
  // qu'elle vise pres d'un bord, elle montre du hors-page. Peindre l'arriere-plan
  // de la couleur MESUREE du fond rend cette zone invisible.
  layout.fond = await page.evaluate(() => {
    const lis = (el) => (el ? getComputedStyle(el).backgroundColor : '');
    const vide = (c) => !c || c === 'transparent' || /rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(c);
    for (const el of [document.body, document.documentElement]) {
      const c = lis(el);
      if (!vide(c)) return c;
    }
    return 'rgb(255,255,255)';
  });

  /* ---- CE QUE LA PAGE DIT, LU DANS LE DOM --------------------------------
     C'est le §0.6 du manuel : la narration ne peut parler que de ce qui est
     ici. Un champ vide arrete le script, parce qu'une phrase construite sur
     une valeur absente sort en « envoyé sur 30 jours » sans nombre devant. */
  const donnees = await page.evaluate(() => {
    const texte = (el) => (el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '');

    /* LES CARTES SE RECONNAISSENT A LEUR FORME, PAS A UNE CLASSE.
       `.pv2-seq-card` existe dans le source mais AUCUN element du DOM rendu ne
       porte de classe contenant « seq » (mesure : 0). Un selecteur devine, une
       forme se verifie : une carte de sequence est le seul bloc qui porte a la
       fois un interrupteur et un bouton « Modifier ». */
    const candidats = Array.from(document.querySelectorAll('div,article,section')).filter((el) => (
      el.querySelector('input[type="checkbox"],[role="switch"],button[class*="switch"],[class*="toggle"]')
      && /Modifier/.test(el.textContent || '')
      && (el.textContent || '').length < 400
    ));
    // Un ancetre qui contient six cartes remplit le meme critere. On ne garde
    // que les elements qui n'en contiennent aucun autre : les cartes elles-memes.
    const feuilles = candidats.filter((el) => !candidats.some((a) => a !== el && el.contains(a)));
    // ORDRE DE LECTURE, pas ordre de longueur de texte : la premiere version
    // triait par taille et rendait « Merci post-visite » en position 1.
    feuilles.sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return (ra.top - rb.top) || (ra.left - rb.left);
    });

    const sequences = feuilles.slice(0, 6).map((el) => {
      const t = texte(el);
      const r = el.getBoundingClientRect();
      return {
        titre: texte(el.querySelector('h3,h4,strong,[class*="title"]')),
        // Le compteur s'arrete AVANT le bouton : « 456 envoyes sur 30 jours
        // Modifier » embarquait le libelle du bouton dans la donnee.
        compteur: (t.match(/\d+\s*envoy[^]*?30 jours/) || [''])[0].trim(),
        allumee: !!el.querySelector('input:checked,[aria-checked="true"],[role="switch"][aria-checked="true"]'),
        boite: { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height },
      };
    });

    return {
      sequences,
      pipeline: Array.from(document.querySelectorAll('[role="tab"],[class*="pipe"]'))
        .map(texte).filter((t) => t && t.length < 60),
      hauteur: document.documentElement.scrollHeight,
      tousLesMails: (document.body.innerText.match(/\d+ messages partent d[^\n]*/) || [''])[0],
    };
  });

  console.log(`sequences lues : ${donnees.sequences.length}`);
  donnees.sequences.forEach((s) => console.log(`   ${s.allumee ? 'ON ' : 'off'}  ${s.titre}  ${s.compteur}`));
  console.log(`hauteur de page : ${donnees.hauteur} px`);

  // GARDE `donnees-non-vides`.
  if (donnees.sequences.length < 6) RATES.push(`${donnees.sequences.length} sequences lues au lieu de 6`);
  donnees.sequences.forEach((s, i) => {
    if (!s.titre) RATES.push(`sequence ${i + 1} : titre vide`);
    if (!s.compteur) RATES.push(`sequence ${i + 1} (${s.titre}) : compteur vide`);
  });

  // ---- 1. la page entiere, en vue « Tous » --------------------------------
  const hauteurTous = donnees.hauteur;
  await page.screenshot({ path: path.join(OUT, 'emails-full.png'), fullPage: true });
  verifierTexture('emails-full.png', hauteurTous);
  layout.emails = { pageH: hauteurTous };

  // Les six cartes de sequence, en decoupes transparentes : elles volent une a
  // une dans le plan qui les enumere.
  // Les six cartes, en decoupes transparentes : elles volent une a une dans le
  // plan qui les enumere. On photographie la BOITE deja lue, ce qui garantit que
  // l'image et la donnee viennent du meme element.
  layout.sequences = [];
  for (let i = 0; i < donnees.sequences.length; i += 1) {
    const s = donnees.sequences[i];
    await page.screenshot({
      path: path.join(OUT, `seq${i + 1}.png`), clip: s.boite, fullPage: true, omitBackground: true,
    });
    layout.sequences.push(s);
  }

  // ---- 2. la boite de reception, un mail ouvert ---------------------------
  await page.evaluate(() => window.pv2EmailOriginFilter('inbound'));
  await page.waitForTimeout(1200);
  const premiere = await page.evaluate(() => {
    const tr = document.querySelector('tbody tr');
    if (!tr) return false;
    tr.click();
    return true;
  });
  if (!premiere) RATES.push('aucune ligne dans la boite de reception');
  await page.waitForTimeout(1500);

  const hauteurRecus = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.screenshot({ path: path.join(OUT, 'recus-full.png'), fullPage: true });
  verifierTexture('recus-full.png', hauteurRecus);
  layout.recus = { pageH: hauteurRecus };

  // Les trois blocs qui portent la demonstration : le mail brut, ce que l'agent
  // en comprend, et la reponse qu'il propose. Ils sont vises par leur LIBELLE
  // et non par une position : un mot ne peut plus etre coupe.
  layout.blocs = {};
  const parLibelle = async (libelle, nom) => {
    const boite = await page.evaluate((lib) => {
      // L'APOSTROPHE N'EST PAS UNE : la page ecrit « Ce qu'il veut » avec une
      // apostrophe DROITE (U+0027), mon libelle portait la typographique. Les
      // deux se ressemblent a l'ecran et ne s'egalent jamais en memoire.
      const nettoie = (t) => t.replace(/[‘’ʼ]/g, "'").replace(/\s+/g, ' ').trim();
      const labels = Array.from(document.querySelectorAll('div,span,p,label'))
        .filter((el) => nettoie(el.textContent || '') === nettoie(lib));
      const el = labels[0] && labels[0].parentElement;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height };
    }, libelle);
    if (!boite) { RATES.push(`bloc introuvable : « ${libelle} »`); return; }
    await page.screenshot({ path: path.join(OUT, `${nom}.png`), clip: boite, fullPage: true, omitBackground: true });
    layout.blocs[nom] = boite;
  };
  await parLibelle('Mail reçu', 'mail-recu');
  await parLibelle("Ce qu'il veut", 'ce-quil-veut');
  await parLibelle('Réponse proposée (IA)', 'reponse-ia');

  // Les lignes de la boite de reception, une par une.
  layout.lignesRecues = [];
  for (let i = 0; i < 3; i += 1) {
    const boite = await decouper(page, 'tbody tr', `recu${i + 1}`, i);
    layout.lignesRecues.push({ ...(boite || {}) });
  }

  /* LA BOITE DE RECEPTION SE LIT ICI, PAS PLUS HAUT.
     La premiere version la lisait dans la meme passe que les sequences, donc
     AVANT la bascule d'onglet : elle ramenait la file d'envoi. Rien ne l'aurait
     signale, les deux sont des `tbody tr` et les deux sont non vides. */
  donnees.recus = await page.evaluate(() => Array.from(document.querySelectorAll('tbody tr')).map((tr) => {
    const t = (el) => (el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '');
    const cel = Array.from(tr.querySelectorAll('td')).map(t);
    return { colonnes: cel, de: cel[0] || '', demande: cel[1] || '', statut: cel[2] || '' };
  }));
  console.log('boite de reception :');
  donnees.recus.forEach((r) => console.log(`   ${r.de}  ->  ${r.demande}  [${r.statut}]`));
  if (donnees.recus.length < 3) RATES.push(`${donnees.recus.length} mails recus au lieu de 3`);
  donnees.recus.forEach((r, i) => {
    if (!r.demande) RATES.push(`mail recu ${i + 1} : la colonne « Demande » est vide`);
  });

  layout.lignesRecues.forEach((l, i) => { l.texte = (donnees.recus[i] || {}).demande || ''; });
  layout.donnees = donnees;
  fs.writeFileSync(LAYOUT, `${JSON.stringify(layout, null, 2)}\n`);

  await browser.close();
  server.close();

  const images = fs.readdirSync(OUT).filter((f) => f.endsWith('.png'));
  console.log(`\n${images.length} images ecrites dans ${path.relative(ROOT, OUT)}`);
  console.log(`layout : ${path.relative(ROOT, LAYOUT)}`);
  if (RATES.length) {
    console.error('\nECHEC :');
    RATES.forEach((r) => console.error(`  - ${r}`));
    process.exit(1);
  }
  console.log('OK : toutes les donnees lues, toutes les textures a la bonne taille.');
})();

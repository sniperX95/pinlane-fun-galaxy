// ENREGISTREMENT de vraies interactions dans le produit, pour la video promo.
//
// Les versions precedentes faisaient panner des captures FIXES : on voyait le
// produit, jamais quelqu'un s'en servir. Ici Playwright pilote reellement
// l'application (remplir le formulaire, choisir un creneau, taper ses
// coordonnees, naviguer dans le back-office) et enregistre la session. Ce qui
// est a l'ecran EST le produit en fonctionnement, pas une reconstitution.
//
// Le film final est rendu en 3840x2160 ; ce clip y vit dans une carte reduite.
// Voir la note sur recordVideo plus bas : la capture reste a sa taille native.
//
// Sortie : un webm par scenario dans artifacts/promo-clips/.
//
// Usage : node scripts/promo-record.js [--cssw 2560] [--cssh 1440]

const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; };
// DEUX PIEGES PAYES ICI, ne pas les rejouer :
//
// 1. Ouvrir l'application a 3840 pixels CSS ne donne pas une belle image : elle
//    a une largeur de contenu maximale, elle se retrouve minuscule au milieu de
//    marges vides. La bonne mise en page est a 2560.
//
// 2. `deviceScaleFactor` N'AUGMENTE PAS la definition de recordVideo. Playwright
//    capture le viewport a sa taille CSS et le POSE en haut a gauche d'un cadre
//    de la taille demandee, le reste en gris. Demander 3840x2160 sur un viewport
//    de 2560 donne donc 33 % de gris a droite et en bas, pas du 4K.
//    -> la video est enregistree a sa taille naturelle.
//
// Ce n'est pas une perte : le clip vit dans une carte de ~1500 px CSS, soit
// 2250 px reels dans un rendu 4K. Une source de 2560 y est encore REDUITE.
const CSS_W = Number(arg('cssw', 2560));
const CSS_H = Number(arg('cssh', 1440));
const W = CSS_W;
const H = CSS_H;
const OUT = path.join(ROOT, 'artifacts/promo-clips');
const PORT = 4601;
const BASE_URL = `http://127.0.0.1:${PORT}`;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };

// Journal des gestes REELLEMENT joues. Un scenario qui rate en silence donnerait
// un clip ou il ne se passe rien : on le saurait trop tard, au montage.
const DONE = [];
const MISSED = [];

function loadFromVisualQa(name) {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/run-visual-qa.js'), 'utf8');
  const start = src.indexOf('async function ' + name + '(');
  if (start === -1) throw new Error(name + ' introuvable dans run-visual-qa.js');
  const end = new RegExp('\\r?\\n\\}\\r?\\n').exec(src.slice(start));
  if (!end) throw new Error('fin de ' + name + ' introuvable');
  const body = src.slice(start, start + end.index + end[0].length);
  // eslint-disable-next-line no-new-func
  return new Function('BASE_URL', body + '\nreturn ' + name + ';')(BASE_URL);
}

const serve = () => new Promise((resolve) => {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
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

// Un curseur visible est INDISPENSABLE : sans lui, les elements changent d'etat
// tout seuls et le spectateur ne comprend pas qu'on manipule le produit.
const CURSOR_CSS = `
  #__promoCursor{position:fixed;width:42px;height:42px;z-index:2147483647;pointer-events:none;
    left:0;top:0;transition:none;filter:drop-shadow(0 4px 12px rgba(0,0,0,.95))}
  #__promoRipple{position:fixed;width:26px;height:26px;border-radius:50%;z-index:2147483646;
    pointer-events:none;border:4px solid #3291ff;opacity:0}`;

async function installCursor(page) {
  await page.evaluate((css) => {
    const s = document.createElement('style');
    s.textContent = css;
    document.head.appendChild(s);
    const c = document.createElement('div');
    c.id = '__promoCursor';
    c.innerHTML = '<svg viewBox="0 0 24 24" width="42" height="42"><path d="M5 2l14 10.5-6.2.6 3.4 6.9-2.9 1.4-3.3-6.9L5 19z" fill="#fff" stroke="#000" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    document.body.appendChild(c);
    const r = document.createElement('div');
    r.id = '__promoRipple';
    document.body.appendChild(r);
    window.__promoMove = (x, y) => { c.style.transform = `translate(${x}px, ${y}px)`; };
    window.__promoClick = (x, y) => {
      r.style.left = (x - 13) + 'px'; r.style.top = (y - 13) + 'px';
      r.style.transition = 'none'; r.style.opacity = '.95'; r.style.transform = 'scale(1)';
      requestAnimationFrame(() => {
        r.style.transition = 'transform .5s cubic-bezier(.2,.8,.3,1), opacity .5s';
        r.style.opacity = '0'; r.style.transform = 'scale(5)';
      });
      c.style.transform = `translate(${x}px, ${y}px) scale(.78)`;
      setTimeout(() => { c.style.transform = `translate(${x}px, ${y}px) scale(1)`; }, 130);
    };
  }, CURSOR_CSS);
}

// Deplacement humain : courbe, acceleration puis freinage. Une souris ne va
// jamais en ligne droite a vitesse constante.
async function moveTo(page, x, y, steps = 22) {
  const from = await page.evaluate(() => window.__promoAt || { x: 300, y: 300 });
  const cx = (from.x + x) / 2 + (y - from.y) * .22;
  const cy = (from.y + y) / 2 - (x - from.x) * .22;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const e = t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const u = 1 - e;
    const px = u * u * from.x + 2 * u * e * cx + e * e * x;
    const py = u * u * from.y + 2 * u * e * cy + e * e * y;
    await page.evaluate(([a, b]) => { window.__promoMove(a, b); window.__promoAt = { x: a, y: b }; }, [px, py]);
    await page.waitForTimeout(9);
  }
}

async function boxOf(page, sel) {
  // Un champ sous la ligne de flottaison n'est pas « absent » : il faut y aller.
  // Sans ce defilement, l'etape 3 du parcours (nom, telephone) etait sautee.
  const near = await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    if (r.top < 0 || r.bottom > window.innerHeight) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    return true;
  }, sel);
  if (!near) return null;
  await page.waitForTimeout(520);            // le defilement doit finir
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    if (r.top > window.innerHeight || r.bottom < 0) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, sel);
}

async function clickAt(page, sel, label, settle = 560) {
  const box = await boxOf(page, sel);
  if (!box) { MISSED.push(label); console.log(`   (absent) ${label}`); return false; }
  await moveTo(page, box.x, box.y);
  await page.waitForTimeout(150);        // temps de survol : l'etat hover se voit
  await page.evaluate(([a, b]) => window.__promoClick(a, b), [box.x, box.y]);
  await page.waitForTimeout(80);
  await page.evaluate((s) => { const el = document.querySelector(s); if (el) el.click(); }, sel);
  await page.waitForTimeout(settle);
  DONE.push(label);
  console.log(`   clic ${label}`);
  return true;
}

// La frappe caractere par caractere : c'est ce qui fait « quelqu'un utilise le
// produit » plutot que « une valeur est apparue ».
async function typeInto(page, sel, text, label) {
  const box = await boxOf(page, sel);
  if (!box) { MISSED.push(label); console.log(`   (absent) ${label}`); return false; }
  await moveTo(page, box.x, box.y);
  await page.evaluate(([a, b]) => window.__promoClick(a, b), [box.x, box.y]);
  await page.evaluate((s) => { const el = document.querySelector(s); if (el) { el.focus(); el.value = ''; } }, sel);
  for (const ch of text) {
    await page.evaluate(([s, c]) => {
      const el = document.querySelector(s);
      if (!el) return;
      el.value += c;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, [sel, ch]);
    await page.waitForTimeout(52);
  }
  await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (el) el.dispatchEvent(new Event('change', { bubbles: true }));
  }, sel);
  await page.waitForTimeout(300);
  DONE.push(label);
  console.log(`   saisie ${label} = "${text}"`);
  return true;
}

// Clique le n-ieme enfant visible d'un conteneur : les options (durees,
// formules, creneaux) sont generees, on ne peut pas les cibler en dur.
async function clickNth(page, container, n, label) {
  const sel = await page.evaluate(([c, i]) => {
    const host = document.querySelector(c);
    if (!host) return null;
    const kids = [...host.children].filter((k) => k.getBoundingClientRect().height > 8);
    const el = kids[i];
    if (!el) return null;
    el.setAttribute('data-promo-pick', '1');
    return `${c} > [data-promo-pick="1"]`;
  }, [container, n]);
  if (!sel) { MISSED.push(label); console.log(`   (absent) ${label}`); return false; }
  const ok = await clickAt(page, sel, label);
  await page.evaluate(() => document.querySelectorAll('[data-promo-pick]').forEach((e) => e.removeAttribute('data-promo-pick')));
  return ok;
}

// Cible un element par son TEXTE visible. Les cartes de sequences d'emails
// (« Confirmation », « Rappel avant la venue »…) sont generees et n'ont pas
// d'identifiant stable : c'est leur libelle qui les designe, et c'est ce meme
// libelle que la voix prononce dans le film.
async function clickByText(page, text, label, settle = 620) {
  const sel = await page.evaluate((needle) => {
    // Sans depouiller les accents, « Reactiver » ne trouve pas « Réactiver » :
    // la sequence nommee par la voix off serait absente de l'image.
    const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, ' ').trim().toLowerCase();
    const want = norm(needle);
    const cands = [...document.querySelectorAll('button, a, [role="button"], .card, .seq-card, li, div')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.width < 40 || r.height < 18) return false;
        if (r.top < 0 || r.top > window.innerHeight) return false;
        return norm(el.textContent).includes(want);
      });
    // Le plus PETIT element qui contient le texte : sinon on cible le body.
    const el = cands.sort((a, b) => (a.getBoundingClientRect().width * a.getBoundingClientRect().height)
      - (b.getBoundingClientRect().width * b.getBoundingClientRect().height))[0];
    if (!el) return null;
    el.setAttribute('data-promo-txt', '1');
    return '[data-promo-txt="1"]';
  }, text);
  if (!sel) { MISSED.push(label); console.log(`   (absent) ${label}`); return false; }
  const ok = await clickAt(page, sel, label, settle);
  await page.evaluate(() => document.querySelectorAll('[data-promo-txt]').forEach((e) => e.removeAttribute('data-promo-txt')));
  return ok;
}

// Survol appuye : sur un plan serre, voir l'element REAGIR sous le curseur
// vaut mieux qu'un clic qui change de page trop vite.
async function hoverText(page, text, label) {
  const box = await page.evaluate((needle) => {
    // Sans depouiller les accents, « Reactiver » ne trouve pas « Réactiver » :
    // la sequence nommee par la voix off serait absente de l'image.
    const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, ' ').trim().toLowerCase();
    const want = norm(needle);
    const el = [...document.querySelectorAll('button, a, [role="button"], .card, li, div')]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 60 && r.height > 24 && r.top > 0 && r.top < window.innerHeight
          && norm(e.textContent).includes(want);
      })
      .sort((a, b) => (a.getBoundingClientRect().width * a.getBoundingClientRect().height)
        - (b.getBoundingClientRect().width * b.getBoundingClientRect().height))[0];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, text);
  if (!box) { MISSED.push(label); console.log(`   (absent) ${label}`); return false; }
  await moveTo(page, box.x, box.y);
  await page.mouse.move(box.x, box.y);
  await page.waitForTimeout(760);
  DONE.push(label);
  console.log(`   survol ${label}`);
  return true;
}

// Ferme le panneau ouvert en cliquant SUR LE FOND, comme un vrai utilisateur
// (`posOverlay` ecoute exactement ce clic). `Escape` ne fait rien ici : sans
// cette fermeture, la fiche reservation restait a l'ecran 19 s sur 24 et
// masquait toutes les pages suivantes du film.
async function closeOverlay(page, label = 'fermeture du panneau') {
  const pt = await page.evaluate(() => {
    const ov = [...document.querySelectorAll('[id$="Overlay"], [id$="Modal"]')]
      .find((o) => {
        const s = getComputedStyle(o);
        const r = o.getBoundingClientRect();
        return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > .05
          && r.width > 200 && r.height > 200;
      });
    if (!ov) return null;
    const or = ov.getBoundingClientRect();
    // Le panneau est l'enfant le plus grand : on vise a cote, sur le fond.
    const panel = [...ov.children]
      .map((c) => c.getBoundingClientRect())
      .sort((a, b) => b.width * b.height - a.width * a.height)[0];
    const y = Math.max(or.top + 30, Math.min(or.bottom - 30, or.top + or.height / 2));
    const x = panel && panel.left - or.left > 90 ? or.left + 45 : or.right - 45;
    return { x, y, id: ov.id };
  });
  if (!pt) return false;
  await moveTo(page, pt.x, pt.y, 14);
  await page.evaluate(([a, b]) => window.__promoClick(a, b), [pt.x, pt.y]);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(620);
  const still = await page.evaluate((id) => {
    const o = document.getElementById(id);
    if (!o) return false;
    const s = getComputedStyle(o);
    return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > .05;
  }, pt.id);
  if (still) { MISSED.push(label + ' (reste ouvert)'); console.log(`   PANNEAU TOUJOURS OUVERT : ${pt.id}`); return false; }
  DONE.push(label);
  console.log(`   ${label} (${pt.id})`);
  return true;
}

// La console Direction interroge /api/admin-range sur une periode de 30 jours.
// Le mock QA ne repond que pour la date de depart, donc la console affichait
// « Pas encore de donnees sur cette periode » : aucun graphique a filmer.
// On etend le mock a toute la periode, avec un volume plus fort le week-end
// pour que la courbe ressemble a un vrai centre. C'est de la donnee de DEMO,
// au meme titre que la journee seedee pour le planning.
async function seedDirectionRange(page) {
  const ok = await page.evaluate(() => {
    const build = window.__PINLANE_QA_RESERVATIONS__;
    if (typeof build !== 'function') return false;
    const precedent = window.fetch;
    window.fetch = (input, init) => {
      const href = typeof input === 'string' ? input : (input && input.url) || '';
      let url;
      try { url = new URL(href, location.origin); } catch (e) { return precedent(input, init); }
      if (url.pathname !== '/api/admin-range') return precedent(input, init);
      const debut = url.searchParams.get('startDate');
      const fin = url.searchParams.get('endDate');
      const out = [];
      const d = new Date(debut + 'T00:00:00Z');
      const stop = new Date(fin + 'T00:00:00Z');
      let jour = 0;
      while (d <= stop && jour < 120) {
        const iso = d.toISOString().slice(0, 10);
        const s = d.getUTCDay();
        const n = s === 6 ? 5 : s === 0 ? 4 : s === 5 ? 3 : 2;
        build(iso).slice(0, n).forEach((r, k) => {
          out.push({ ...r, id: (jour + 1) * 100 + k, date: iso });
        });
        d.setUTCDate(d.getUTCDate() + 1);
        jour += 1;
      }
      return Promise.resolve(new Response(
        JSON.stringify({ ok: true, reservations: out, emails: [], agentEvents: [],
          centerId: url.searchParams.get('centerId') || 'libramont' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));
    };
    return true;
  });
  console.log(ok ? '   periode Direction alimentee' : '   ATTENTION : mock QA introuvable, Direction restera vide');
  return ok;
}

(async () => {
  const installQaApi = loadFromVisualQa('installQaApi');
  const seedStressDay = loadFromVisualQa('seedStressDay');
  const renderStaffPage = loadFromVisualQa('renderStaffPage');

  const server = await serve();
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch();

  // ---- SCENARIO 1 : le client reserve VRAIMENT ------------------------------
  {
    const ctx = await browser.newContext({
      viewport: { width: CSS_W, height: CSS_H },

      recordVideo: { dir: path.join(OUT, 'raw-client'), size: { width: W, height: H } },
    });
    const page = await ctx.newPage();
    await installQaApi(page);
    await page.goto(`${BASE_URL}/?v=rec-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
      if (typeof setView === 'function') setView('client');
    });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1000);
    await installCursor(page);

    console.log('SCENARIO 1 - le client reserve');
    await page.waitForTimeout(400);
    await typeInto(page, '#fPax', '6', 'nombre de joueurs');
    await clickAt(page, '#segFormule', 'onglet Nos Formules');
    await clickNth(page, '#formuleGrid', 1, 'une formule');
    await clickAt(page, '#segBowling', 'retour Bowling simple');
    await clickNth(page, '#durGrid', 2, 'duree de jeu');
    await clickAt(page, '#btnStep1', 'Verifier les disponibilites', 1100);
    // Etape 2 : le creneau. C'est LE moment ou le produit prouve sa valeur.
    await clickNth(page, '#slotList', 0, 'un creneau disponible', 900);
    await typeInto(page, '#fName', 'Camille Dubois', 'nom du client');
    await typeInto(page, '#fPhone', '0470112233', 'telephone');
    await page.waitForTimeout(900);
    await ctx.close();
  }

  // ---- SCENARIO 2 : l'equipe pilote le centre ------------------------------
  {
    const ctx = await browser.newContext({
      viewport: { width: CSS_W, height: CSS_H },

      recordVideo: { dir: path.join(OUT, 'raw-staff'), size: { width: W, height: H } },
    });
    const page = await ctx.newPage();
    await installQaApi(page);
    await page.goto(`${BASE_URL}/?v=rec2-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await seedStressDay(page);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1100);
    await installCursor(page);

    console.log('SCENARIO 2 - on SUIT une reservation');
    // Le film raconte une histoire, pas une visite guidee des menus :
    // la reservation tombe, elle se pose dans le planning, la confirmation
    // part, le rappel avant la venue suit, la relance reveille les dormants.
    // Chaque etape ci-dessous est nommee par la voix off au montage.
    const menu = await page.evaluate(() => [...document.querySelectorAll('.fgx-menu-nav [data-fgx-menu-key]')]
      .map((el) => ({ key: el.getAttribute('data-fgx-menu-key'), label: (el.getAttribute('title') || '').trim() }))
      .filter((k) => k.key && k.key !== 'dashboard'));
    console.log(`   ${menu.length} entrees de menu trouvees`);
    const go = async (key, label) => {
      const item = menu.find((k) => k.key === key);
      if (!item) { MISSED.push(label); console.log(`   (menu absent) ${label}`); return false; }
      return clickAt(page, `.fgx-menu-nav [data-fgx-menu-key="${item.key}"]`, item.label || label, 820);
    };

    // 1. « Elle se pose dans votre planning » : la reservation, ouverte.
    await renderStaffPage(page, 'planning');
    await page.waitForTimeout(800);
    await hoverText(page, 'Famille Lambert', 'survol de la reservation');
    await clickAt(page, '.booking', 'ouverture de la reservation', 1600);
    await closeOverlay(page, 'fermeture de la fiche');

    // 2. La liste des reservations : la meme resa, vue autrement.
    await go('reservations', 'Reservations');
    await hoverText(page, 'Famille Lambert', 'la resa dans la liste');

    // 3-5. Les sequences d'emails, une par une, dans l'ordre du texte dit.
    await go('emails', 'Emails & relances');
    await page.waitForTimeout(400);
    for (const [txt, label] of [
      ['Confirmation', 'sequence Confirmation'],
      ['Rappel avant la venue', 'sequence Rappel avant la venue'],
      ['Reactiver les clients dormants', 'sequence Reactiver les dormants'],
    ]) {
      // Le survol d'abord (la carte reagit), le clic ensuite si la carte existe.
      const seen = await hoverText(page, txt, label);
      if (seen) await page.waitForTimeout(320);
    }
    await clickByText(page, 'Nouveau message', 'ouvrir un nouveau message', 1300);
    await closeOverlay(page, 'fermeture du message');

    // 6. Marketing : l'agent IA. On lui PARLE, c'est tout l'interet.
    await go('campaigns', 'Marketing');
    await page.waitForTimeout(500);
    await typeInto(page, '[placeholder*="Demande-moi"], #mkwAsk, textarea',
      'un post pour la soiree fluo de samedi', 'demande a l agent marketing');
    await page.waitForTimeout(600);
    for (const onglet of ['Le plan', 'Concurrents', 'Résultats']) {
      await clickByText(page, onglet, `onglet marketing ${onglet}`, 820);
    }

    // 7. Etablissement : tout se regle depuis l'interface.
    await go('establishment', 'Etablissement');
    await page.waitForTimeout(500);
    for (const onglet of ['Horaires & fermetures', 'Offres & activités']) {
      await clickByText(page, onglet, `onglet etablissement ${onglet}`, 900);
    }
    await hoverText(page, 'Fun Galaxy Gembloux', 'un autre centre');

    // 8. La data analysee.
    //
    // La console Direction (`setView('admin')`) N'EST PAS filmable ici : elle
    // agrege /api/admin-range, et le mock QA ne produit rien qu'elle sache
    // exploiter — elle affiche « Pas encore de donnees sur cette periode »
    // meme apres avoir alimente la periode et force `loadAdminDashboard(true)`.
    // Ses graphiques demandent le vrai pipeline de donnees.
    //
    // On filme donc la page Clients, qui rend de VRAIES analyses sur les
    // memes donnees : panier moyen, visites et depense par client, a relancer.
    // Montrer un ecran vide « parce que c'etait dans le script » serait pire
    // que de montrer une autre surface qui, elle, prouve le propos.
    await go('clients', 'Clients');
    await page.waitForTimeout(600);
    await hoverText(page, 'Panier moyen', 'le panier moyen');
    await clickNth(page, '.table tbody, tbody', 0, 'une fiche client', 1200);
    await page.mouse.move(CSS_W * .62, CSS_H * .42);
    await page.waitForTimeout(800);

    // 9. Vue d'ensemble : les compteurs du jour.
    await go('dashboard', "Vue d'ensemble");
    await page.mouse.move(CSS_W * .5, CSS_H * .3);
    await page.waitForTimeout(1400);
    await ctx.close();
  }

  await browser.close();
  server.close();

  const clips = [];
  for (const d of ['raw-client', 'raw-staff']) {
    const dir = path.join(OUT, d);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.webm')) continue;
      const src = path.join(dir, f);
      const dst = path.join(OUT, `${d.replace('raw-', '')}.webm`);
      fs.renameSync(src, dst);
      clips.push(`${path.basename(dst)} (${(fs.statSync(dst).size / 1048576).toFixed(1)} Mo)`);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(`\nclips ${W}x${H} (natif, sans remplissage) : ` + (clips.join(', ') || 'AUCUN'));
  console.log(`gestes joues : ${DONE.length}  -  ${DONE.join(' | ')}`);
  if (MISSED.length) console.log(`gestes MANQUES : ${MISSED.join(' | ')}`);
  if (!clips.length) process.exit(1);
  // Un clip sans geste, c'est un screencast fixe : autant le savoir ici.
  if (DONE.length < 8) { console.error(`\nECHEC : ${DONE.length} gestes seulement, le clip serait statique`); process.exit(1); }
})().catch((e) => { console.error('promo-record:', e.message); process.exit(1); });

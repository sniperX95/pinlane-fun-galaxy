'use strict';
// CE QUI SE TOUCHE REPOND (2026-11-05). Le robot de la console trouvait sur main deux vrais
// culs-de-sac : la jauge d un depart laser qui ne se reserve pas (hors des heures, ferme, deja
// joue) ne disait rien au toucher, et la ligne « File vide » des mails envoyes prenait la main et
// le survol d une ligne qui s ouvre. Banc du robot (scripts/robot-console.js) : les fichiers du
// depot, les doublures de staff-console-perf-check, rien ne sort.
// `--contre-preuves` : chaque correction retiree a son tour, sa verification rougit.
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawnSync } = require('child_process');

const DEPOT = path.resolve(__dirname, '..');
const { chromium } = require(path.join(DEPOT, 'node_modules/playwright-core'));
const BROWSER = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = Number(process.env.PINLANE_CIBLES_PORT || 4421);
const BASE = `http://127.0.0.1:${PORT}`;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

const MUTATIONS = [
  { nom: 'jauge-muette', cible: 'la jauge d un depart qui ne se reserve pas dit pourquoi', fichier: 'assets/app-main.js', de: '    if (pourquoi) { toast(`${lpHeure(d.t)} : ${pourquoi}.`); return; }', vers: '    if (pourquoi) return;' },
  { nom: 'ligne-vide-cliquable', cible: 'la ligne « File vide » ne prend pas la main', fichier: 'assets/staff-pages-v2.js', de: '<tr class="pv2-vide"><td colspan="5"><div class="pv2-empty"><strong>File vide</strong>', vers: '<tr><td colspan="5"><div class="pv2-empty"><strong>File vide</strong>' },
];
const CASSE = MUTATIONS.find((m) => m.nom === process.env.CIBLES_CASSE) || null;

// Les doublures du gate de performance de la console, comme le robot.
const gate = fs.readFileSync(path.join(DEPOT, 'scripts/staff-console-perf-check.js'), 'utf8').replace(/\r\n/g, '\n');
const a = gate.indexOf('function installerMock(page) {');
const b = gate.indexOf('}, { expiresAt, JOUR });\n}', a) + '}, { expiresAt, JOUR });\n}'.length;
const samedi = new Date(); samedi.setDate(samedi.getDate() + ((6 - samedi.getDay() + 7) % 7 || 7));
const JOUR = `${samedi.getFullYear()}-${String(samedi.getMonth() + 1).padStart(2, '0')}-${String(samedi.getDate()).padStart(2, '0')}`;
// eslint-disable-next-line no-eval
const installerMock = (0, eval)(`(function (JOUR) { ${gate.slice(a, b)}; return installerMock; })`)(JOUR);

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.woff2': 'font/woff2' };
const serveur = http.createServer((rq, rs) => {
  const u = new URL(rq.url, BASE);
  if (u.pathname.startsWith('/api/')) { rs.writeHead(200, { 'Content-Type': 'application/json' }); rs.end('{"ok":true}'); return; }
  const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
  const f = path.join(DEPOT, rel);
  if (!f.startsWith(DEPOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rs.writeHead(404); rs.end(); return; }
  rs.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  // Une contre-preuve sert le fichier casse expres, en memoire : le depot ne change pas.
  if (CASSE && path.relative(DEPOT, f).split(path.sep).join('/') === CASSE.fichier) {
    rs.end(fs.readFileSync(f, 'utf8').split(CASSE.de).join(CASSE.vers));
    return;
  }
  fs.createReadStream(f).pipe(rs);
});

async function ouvrir(browser, hash) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'fr-BE' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(9000);
  page.__erreurs = [];
  page.on('pageerror', (e) => { const m = String(e.message || e); if (!/sandboxed and lacks/.test(m)) page.__erreurs.push(m.slice(0, 170)); });
  await page.route('**/*', (route) => { const r = route.request(); if (!r.url().startsWith(BASE) && r.method() !== 'GET') return route.abort(); return route.continue(); });
  await installerMock(page);
  // L heure du banc est figee a 16:00 du jour (2026-11-06). Lancee apres minuit, aucune partie
  // du jour n etait encore jouee : le banc ne trouvait plus de depart qui ne se reserve pas, et
  // la contre-preuve jauge-muette passait sans rien verifier.
  const seize = new Date(); seize.setHours(16, 0, 0, 0);
  await page.clock.setFixedTime(seize);
  await page.goto(`${BASE}/${hash}`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => typeof window.setView === 'function' && typeof state !== 'undefined', null, { timeout: 30000 });
  await dormir(900);
  return { ctx, page };
}

async function principal() {
  let echecs = 0;
  const ok = (condition, nom, detail) => {
    if (condition) console.log(`ok    ${nom}`);
    else { echecs += 1; console.log(`FAIL  ${nom}  ${JSON.stringify(detail)}`); }
  };
  if (CASSE) {
    const texte = fs.readFileSync(path.join(DEPOT, CASSE.fichier), 'utf8');
    if (texte.split(CASSE.de).length - 1 !== 1) { console.log(`DESARMEE ancre ${CASSE.nom}`); process.exit(2); }
  }
  await new Promise((r) => serveur.listen(PORT, r));
  const browser = await chromium.launch({ executablePath: BROWSER, headless: true });
  try {
    // [1] Le planning laser : un depart qui ne se reserve pas, touche hors d un groupe.
    const laser = await ouvrir(browser, '#/staff/planning/laser');
    const t = await laser.page.evaluate(() => {
      const d = lpModele().departs.find((x) => (x.hors || x.ferme || x.joue) && document.querySelector(`.lp-dep__jauge[data-lp-t="${x.t}"]`));
      return d ? d.t : null;
    });
    ok(t !== null, 'le banc montre un depart laser qui ne se reserve pas', t);
    if (t !== null) {
      await laser.page.evaluate((x) => {
        const el = document.getElementById('toast');
        if (el) { el.classList.add('hidden'); el.textContent = ''; }
        document.querySelector(`.lp-dep__jauge[data-lp-t="${x}"]`).click();
      }, t);
      await dormir(300);
      const dit = await laser.page.evaluate(() => { const el = document.getElementById('toast'); return el && !el.classList.contains('hidden') ? el.textContent.replace(/\s+/g, ' ').trim() : ''; });
      ok(/hors des heures|fermé|déjà jouée/.test(dit), 'la jauge d un depart qui ne se reserve pas dit pourquoi', dit);
    }
    ok(!laser.page.__erreurs.length, 'le planning laser sans erreur JavaScript', laser.page.__erreurs);
    await laser.ctx.close();

    // [2] Les mails envoyes, file vide : la ligne ne se presente pas comme une ligne qui s ouvre.
    const mails = await ouvrir(browser, '#/staff/emails/envoyes');
    const vide = await mails.page.evaluate(() => {
      const bloc = document.querySelector('.pv2-table tbody .pv2-empty');
      const tr = bloc && bloc.closest('tr');
      return tr ? { curseur: getComputedStyle(tr).cursor, classe: tr.className } : null;
    });
    ok(vide !== null, 'le banc montre la file vide des mails envoyes', vide);
    ok(vide && vide.curseur !== 'pointer', 'la ligne « File vide » ne prend pas la main', vide);
    ok(!mails.page.__erreurs.length, 'les mails envoyes sans erreur JavaScript', mails.page.__erreurs);
    await mails.ctx.close();
  } finally {
    await browser.close();
    serveur.close();
  }
  console.log(echecs ? `console-cibles-check: ${echecs} FAIL` : 'console-cibles-check: ALL OK - ce qui se touche repond.');
  process.exit(echecs ? 1 : 0);
}

// Une mutation a la fois, un navigateur a la fois, chacune sur son port.
function contrePreuves() {
  let mordent = 0;
  MUTATIONS.forEach((m, i) => {
    const r = spawnSync(process.execPath, [__filename], { env: { ...process.env, CIBLES_CASSE: m.nom, PINLANE_CIBLES_PORT: String(PORT + 1 + i) }, encoding: 'utf8', timeout: 240000 });
    const sortie = `${r.stdout || ''}${r.stderr || ''}`;
    if (r.status === 2) { console.log(`FAIL  contre-preuve ${m.nom} DESARMEE`); return; }
    if (sortie.split('\n').some((l) => l.startsWith('FAIL') && l.includes(m.cible))) { mordent += 1; console.log(`ok    contre-preuve ${m.nom} : « ${m.cible} » rougit`); return; }
    console.log(`FAIL  contre-preuve ${m.nom} : « ${m.cible} » reste vert (${sortie.trim().split('\n').pop().slice(0, 160)})`);
  });
  console.log(`console-cibles-check --contre-preuves : ${mordent}/${MUTATIONS.length} mordent`);
  process.exit(mordent === MUTATIONS.length ? 0 : 1);
}

if (process.argv.includes('--contre-preuves')) contrePreuves();
else principal().catch((error) => { console.log(`FAIL  exception ${String(error && error.stack).slice(0, 400)}`); process.exit(1); });

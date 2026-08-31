// LE GATE DU CALENDRIER DU TUNNEL, DANS UNE IFRAME CROSS-ORIGIN (2026-08-21).
//
// LA PLAINTE : « ici pour le formulaire c'est bizarre parce qu'on peut pas
// cliquer » (Movsar, capture du tunnel de N4). Le bouton calendrier existait,
// il ne faisait rien.
//
// LA CAUSE, mesuree sur le VRAI site de N4 (n4-bowling.vercel.app embarque
// app.pinlane.be) : `showPicker() called from cross-origin iframe`, une
// SecurityError de specification, pas un incident. Le tunnel vit exactement
// la : dans le site du gerant, dans une iframe d'une autre origine. Le repli
// `focus()` ne montre rien sur ordinateur, donc le calendrier n'etait PAS
// ouvrable la ou tous les clients reservent.
//
// CE GATE REJOUE CE CONTEXTE, il ne le simule pas : deux serveurs locaux sur
// des PORTS differents sont deux origines differentes pour le navigateur,
// exactement comme n4-bowling.vercel.app et app.pinlane.be. La section [1]
// prouve d'ailleurs que showPicker y jette encore : si un jour ce n'est plus
// vrai, cette assertion le dira.
//
// CE QUI EST MESURE : le DOM du calendrier maison, la valeur du champ apres un
// VRAI clic sur un jour, l'evenement `change` reellement emis (c'est lui qui
// declenche les horaires et les creneaux), et le refus des dates passees.
//
// Sortie 0 quand tout est vert. Sortie 1 sinon.
// Lancement : node scripts/tunnel-date-picker-check.js

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const TUNNEL_PORT = Number(process.env.PINLANE_TUNNEL_PICKER_PORT || 4301);
const HOST_PORT = TUNNEL_PORT + 1;
const TUNNEL_ORIGIN = `http://127.0.0.1:${TUNNEL_PORT}`;
// MEME machine, PORT different : deux origines distinctes pour le navigateur.
// C'est ce qui rend la SecurityError de showPicker reproductible hors ligne.
const HOST_ORIGIN = `http://localhost:${HOST_PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

const checks = [];
function record(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail: detail || '' });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' :: ' + detail : ''}`);
}
function section(title) { console.log(`\n${title}`); }

// Sert le depot comme Vercel : /reserver et /reserver/:center rendent index.html.
function serveTunnel() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, TUNNEL_ORIGIN);
    let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || /^\/reserver(\/[a-z0-9-]+)?\/?$/i.test(url.pathname)) filePath = path.join(ROOT, 'index.html');
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(content);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(TUNNEL_PORT, '127.0.0.1', () => resolve(server)); });
}

// Le site du gerant : une page qui embarque le tunnel, comme le fait N4.
function serveHost() {
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Site du gerant</title></head>
<body style="margin:0;background:#0b0b0b">
<iframe id="tunnel" title="Reservation" src="${TUNNEL_ORIGIN}/reserver?embed=1&center=libramont" style="width:1180px;height:900px;border:0"></iframe>
</body></html>`;
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(HOST_PORT, () => resolve(server)); });
}

function isoInDays(delta) {
  const d = new Date();
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

(async () => {
  const tunnelServer = await serveTunnel();
  const hostServer = await serveHost();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  let crashed = 0;
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
    // Aucune base, aucun reseau : les API repondent le minimum viable.
    await page.route('**/api/**', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ ok: true, formulas: [], activities: [], slots: [], centers: [], reservations: [] }),
    }));
    await page.goto(`${HOST_ORIGIN}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });

    const frame = await (async () => {
      for (let i = 0; i < 40; i += 1) {
        const hit = page.frames().find((f) => f.url().includes(`:${TUNNEL_PORT}`));
        if (hit) return hit;
        await page.waitForTimeout(250);
      }
      return null;
    })();
    if (!frame) throw new Error('le tunnel ne s est pas charge dans l iframe');
    await frame.waitForSelector('.date-picker-trigger', { state: 'visible', timeout: 30000 });

    section('[1] Le contexte reel : une iframe d une AUTRE origine');
    const context = await frame.evaluate(() => {
      let sameOrigin = true;
      try { void window.top.location.href; } catch (e) { sameOrigin = false; }
      let pickerError = '';
      try { document.getElementById('fDate').showPicker(); } catch (e) { pickerError = `${e.name}: ${e.message}`; }
      return { sameOrigin, pickerError, hasShowPicker: typeof document.getElementById('fDate').showPicker === 'function' };
    });
    record('le tunnel est bien dans une iframe cross-origin', context.sameOrigin === false, `sameOrigin=${context.sameOrigin}`);
    record('showPicker existe dans ce navigateur', context.hasShowPicker === true);
    record(
      'et il JETTE ici : c est la raison d etre du calendrier maison',
      /SecurityError/.test(context.pickerError) || /NotAllowedError/.test(context.pickerError),
      context.pickerError || 'aucune erreur',
    );

    section('[2] Le bouton ouvre un calendrier, et le clic choisit vraiment la date');
    await frame.evaluate(() => {
      window.__changes = 0;
      document.getElementById('fDate').addEventListener('change', () => { window.__changes += 1; });
    });
    await frame.click('.date-picker-trigger');
    const opened = await frame.evaluate(() => {
      const pop = document.querySelector('.staff-calendar-pop');
      if (!pop) return { present: false };
      const r = pop.getBoundingClientRect();
      return {
        present: true,
        visible: r.width > 0 && r.height > 0,
        insideViewport: r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight + 1 && r.right <= window.innerWidth + 1,
        role: pop.getAttribute('role'),
        days: pop.querySelectorAll('.staff-cal-day:not(.is-out)').length,
      };
    });
    record('un calendrier s ouvre dans le tunnel', opened.present === true);
    record('il a une surface reelle', opened.visible === true, opened.present ? `${opened.days} jours` : 'absent');
    record('il tient dans le cadre du tunnel', opened.insideViewport === true);
    record('il s annonce comme un dialogue', opened.role === 'dialog', String(opened.role));

    // LE GATE DOIT SURVIVRE A LA FIN DU MOIS. `aujourd hui + 3` tombe dans le
    // mois SUIVANT trois jours par mois : le calendrier s ouvre sur le mois
    // courant, le jour vise n etait donc pas dans la grille et les six
    // verifications qui suivent tombaient en cascade (constate le 2026-08-31,
    // un 31 : cible 2026-09-03). Un gate qui rougit selon le jour du calendrier
    // n apprend rien - il apprend seulement a ignorer les rouges. On navigue
    // donc jusqu au mois de la cible avant de la chercher, ce qui teste EN PLUS
    // les fleches de mois.
    const target = isoInDays(3);
    const clicked = await frame.evaluate(async (iso) => {
      const moisDe = (valeur) => valeur.slice(0, 7);
      const trouver = () => [...document.querySelectorAll('.staff-cal-day')]
        .find((b) => (b.getAttribute('onclick') || '').includes(iso));
      // Au plus deux sauts : la cible est a trois jours, elle ne peut etre que
      // dans le mois courant ou le suivant.
      for (let saut = 0; saut < 3; saut += 1) {
        const btn = trouver();
        if (btn) { btn.click(); return { found: true, sauts: saut }; }
        const suivant = [...document.querySelectorAll('.staff-cal-nav')]
          .find((b) => (b.getAttribute('aria-label') || '').toLowerCase().includes('suivant'));
        if (!suivant) return { found: false, sauts: saut, raison: 'aucune fleche de mois' };
        suivant.click();
        await new Promise((r) => setTimeout(r, 120));
      }
      return { found: false, sauts: 3, raison: `cible hors des mois parcourus (${moisDe(iso)})` };
    }, target);
    record('le jour vise est proposé par la grille', clicked.found === true,
      `${target}${clicked.sauts ? ` (${clicked.sauts} saut(s) de mois)` : ''}${clicked.raison ? ` - ${clicked.raison}` : ''}`);
    await frame.waitForTimeout(300);
    const after = await frame.evaluate(() => ({
      value: document.getElementById('fDate').value,
      changes: window.__changes,
      popStillThere: !!document.querySelector('.staff-calendar-pop'),
    }));
    record('la date choisie est posee dans le champ', after.value === target, `${after.value} attendu ${target}`);
    record('un evenement change est emis (horaires et creneaux suivent)', after.changes >= 1, `${after.changes} evenement(s)`);
    record('le calendrier se referme apres le choix', after.popStillThere === false);

    section('[3] Les dates passees restent refusees');
    // On repart d un calendrier FERME : la gachette bascule, et si l etape
    // precedente a laisse le calendrier ouvert (cible introuvable), ce clic le
    // refermait et les deux verifications suivantes tombaient sur une grille
    // vide - un faux rouge qui masquait le vrai defaut.
    await frame.evaluate(() => { if (typeof closeStaffCalendar === 'function') closeStaffCalendar(); });
    await frame.waitForTimeout(120);
    await frame.click('.date-picker-trigger');
    // MEME PIEGE DANS L AUTRE SENS. Le calendrier s ouvre sur le mois de la date
    // RETENUE : apres avoir choisi le 3 septembre a l etape precedente, il
    // montre septembre, et hier (30 aout) n y est pas. On recule jusqu au mois
    // de la cible, comme on avancait plus haut.
    const past = await frame.evaluate(async (iso) => {
      const trouver = () => [...document.querySelectorAll('.staff-cal-day')]
        .find((b) => (b.getAttribute('onclick') || '').includes(iso));
      for (let saut = 0; saut < 3; saut += 1) {
        const btn = trouver();
        if (btn) return { present: true, disabled: btn.disabled, blocked: btn.classList.contains('is-blocked'), sauts: saut };
        const precedent = [...document.querySelectorAll('.staff-cal-nav')]
          .find((b) => (b.getAttribute('aria-label') || '').toLowerCase().includes('pr'));
        if (!precedent) return { present: false, raison: 'aucune fleche de mois' };
        precedent.click();
        await new Promise((r) => setTimeout(r, 120));
      }
      return { present: false, raison: 'cible hors des mois parcourus' };
    }, isoInDays(-1));
    record('hier est present dans la grille', past.present === true,
      past.present ? `${past.sauts} saut(s) de mois` : (past.raison || 'absent'));
    record('hier est desactive, pas cliquable', past.present && past.disabled === true && past.blocked === true);
    await frame.evaluate(() => { if (typeof closeStaffCalendar === 'function') closeStaffCalendar(); });

    section('[4] Contre-preuve : l ancien bouton n ouvrait rien ici');
    const legacy = await frame.evaluate(() => {
      const el = document.getElementById('fDate');
      let reached = 'aucun';
      try { if (el.showPicker) { el.showPicker(); reached = 'showPicker'; } } catch (e) { reached = 'exception'; }
      if (reached !== 'showPicker') { el.focus(); el.click(); reached = reached === 'exception' ? 'repli focus' : reached; }
      return { reached, pop: !!document.querySelector('.staff-calendar-pop') };
    });
    record('l ancien chemin tombe dans son repli', legacy.reached === 'repli focus', legacy.reached);
    record('et il n affiche AUCUN calendrier : le gate rougirait', legacy.pop === false);

    section('[5] Non-regression : la console garde son calendrier');
    const consolePage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await consolePage.route('**/api/**', (route) => route.fulfill({
      status: 200, contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ ok: true, authenticated: false, reservations: [], centers: [] }),
    }));
    await consolePage.goto(`${TUNNEL_ORIGIN}/?v=cal-${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // `state` est declare en `let` : il vit dans la portee globale lexicale,
    // pas sur window. On l'interroge par son nom, comme le fait le code.
    await consolePage.waitForFunction(() => typeof openStaffCalendar === 'function' && typeof state !== 'undefined', null, { timeout: 20000 });
    const staffPick = await consolePage.evaluate(() => {
      const before = state.currentDate;
      const anchor = document.body;
      openStaffCalendar({ currentTarget: anchor, preventDefault() {}, stopPropagation() {} });
      const pop = document.querySelector('.staff-calendar-pop');
      const day = pop ? pop.querySelector('.staff-cal-day:not(.is-out)') : null;
      const iso = day ? (day.getAttribute('onclick') || '').match(/'([0-9-]{10})'/) : null;
      if (day) day.click();
      return {
        opened: !!pop,
        picked: iso ? iso[1] : '',
        currentDate: state.currentDate,
        before,
        noneBlocked: pop ? true : false,
      };
    });
    record('le calendrier de la console s ouvre toujours', staffPick.opened === true);
    record(
      'et choisir un jour change toujours la date de travail',
      Boolean(staffPick.picked) && staffPick.currentDate === staffPick.picked,
      `${staffPick.before} -> ${staffPick.currentDate}`,
    );
    await consolePage.close();
  } catch (error) {
    console.error('\nERREUR DU GATE:', error && (error.stack || error.message || error));
    crashed = 1;
  } finally {
    await browser.close();
    tunnelServer.close();
    hostServer.close();
  }

  const red = checks.filter((c) => !c.ok).length;
  console.log(`\n${red || crashed ? 'ECHEC' : 'ALL OK'} : ${checks.length - red}/${checks.length} verifications`);
  process.exit(red || crashed ? 1 : 0);
})();

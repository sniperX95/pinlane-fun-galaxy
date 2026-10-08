// L ARENE POUR VOUS SEULS AU PLANNING (gate ne le 2026-10-08, suite de la
// regle S6 de la fenetre Reserver).
//
// Un groupe de 8 qui privatise l arene retient ses 30 armes : le bloc laser
// porte players = 30 (l occupation : la session est pleine) et joueursReels
// = 8 (le groupe). Le planning dit le GROUPE partout ou il ecrit « N
// joueurs », et garde l occupation pleine.
//   [1] la puce du groupe au planning laser dit 8 j, et pourquoi la session
//       est pleine (« arène pour eux seuls ») ;
//   [2] la session reste pleine : sa jauge est a 100 % ;
//   [3] la fiche dit « 8 joueurs » pour la partie, jamais 30 ;
//   [4] un groupe ordinaire (sans le choix) garde son compte (6 j), sans la
//       mention ;
//   [5] contre-preuves : la puce relue sur players dit 30 j, et [1] rougit ;
//       la fiche relue sur players dit 30 joueurs, et [3] rougit.
// Le serveur et le moteur ont leur gate (reserver-arene-seuls-check).
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { serveStatic, installMock, boot, BROWSER_PATH } = require('./reserver-v5-check');

const ROOT = path.resolve(__dirname, '..');
const MUTATION = {
  de: 'Number(window.joueursReels ?? window.players) || Number(reservation?.pax) || 0);',
  vers: 'Number(window.players) || Number(reservation?.pax) || 0);',
};
// La fiche relue sur les armes : la partie dit 30 joueurs.
const MUTATION_FICHE = {
  de: "quoi: `${Number(f.joueursReels ?? f.players) || effectifActivite('laser_game')} joueurs",
  vers: "quoi: `${Number(f.players) || effectifActivite('laser_game')} joueurs",
};

let echecs = 0;
function ok(cond, label, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) echecs += 1;
  return cond;
}

// Les deux groupes du jour, servis par le faux serveur (le sondage les rend
// a chaque tour, jamais un etat vide).
async function installerGroupes(page) {
  await page.addInitScript(() => {
    const precedent = window.fetch;
    const bloc = (debut, extra) => ({ resourceType: 'laser_arena', activityId: 'laser_game', start: debut, end: debut + 25 / 60, duration: 25 / 60, countIndex: 1, groupWaveCount: 1, groupWaveIndex: 1, ...extra });
    window.__GROUPES__ = () => {
      const date = typeof todayStr === 'function' ? todayStr() : new Date().toISOString().slice(0, 10);
      return [
        { id: 9401, centerId: 'libramont', date, name: 'Groupe Seuls', phone: '+32470000401', status: 'confirmed', type: 'laser', startTime: '15:00', duration: 0.5, totalDuration: 0.5, pax: 8, laserGames: 1, price: 80, basePrice: 80, lanes: [],
          opsPlan: { resourceBlocks: [bloc(15, { players: 30, joueursReels: 8, arene: 'seuls' })] } },
        { id: 9402, centerId: 'libramont', date, name: 'Groupe Normal', phone: '+32470000402', status: 'confirmed', type: 'laser', startTime: '17:00', duration: 0.5, totalDuration: 0.5, pax: 6, laserGames: 1, price: 60, basePrice: 60, lanes: [],
          opsPlan: { resourceBlocks: [bloc(17, { players: 6 })] } },
      ];
    };
    window.fetch = async (input, init = {}) => {
      const brut = typeof input === 'string' ? input : (input && input.url) || '';
      const u = new URL(brut, window.location.origin);
      if (u.pathname === '/api/staff-state' || u.pathname === '/api/admin-range') {
        return new Response(JSON.stringify({ ok: true, revision: 'qa-seuls', reservations: window.__GROUPES__(), laneStatuses: {}, centerId: 'libramont', syncedAt: new Date().toISOString() }), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
      }
      return precedent(input, init);
    };
  });
}

async function mesurer(browser, mutation) {
  const contexte = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await contexte.newPage();
  page.setDefaultTimeout(8000);
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(`PAGEERROR: ${e.message}`));
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource|favicon/i.test(msg.text())) erreurs.push(msg.text()); });
  if (mutation) {
    const source = fs.readFileSync(path.join(ROOT, 'assets', 'app-main.js'), 'utf8').replace(/\r\n/g, '\n');
    const n = source.split(mutation.de).length - 1;
    if (n !== 1) throw new Error(`contre-preuve desarmee : ancre trouvee ${n} fois`);
    const mute = source.replace(mutation.de, () => mutation.vers);
    await page.route('**/assets/app-main.js*', (route) => route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: mute }));
  }
  try {
    await installMock(page);
    await installerGroupes(page);
    await boot(page);
    await page.evaluate(() => {
      state.reservations = window.__GROUPES__();
      state.currentDate = todayStr();
      state.staffMenuPage = 'planning';
      state.staffResourceView = 'laser';
      renderStaff();
    });
    await page.waitForSelector('.laser-group-card[data-laser-res-id="9401"]', { timeout: 8000 });
    const f = await page.evaluate(() => {
      const puce = (id) => {
        const el = document.querySelector(`.laser-group-card[data-laser-res-id="${id}"] .laser-group-count`);
        return el ? { texte: el.textContent.replace(/\s+/g, ''), titre: el.getAttribute('title') || '' } : null;
      };
      const carte = document.querySelector('.laser-group-card[data-laser-res-id="9401"]');
      const session = carte ? carte.closest('.laser-session-slot') : null;
      const jauge = session ? [...session.querySelectorAll('.laser-meter-segment')].reduce((s, seg) => s + (parseFloat(seg.style.width) || 0), 0) : 0;
      return { seuls: puce(9401), normal: puce(9402), jauge: Math.round(jauge) };
    });
    await page.evaluate(() => openPos(9401));
    await page.waitForTimeout(400);
    const fiche = await page.evaluate(() => (document.getElementById('posOverlay') || {}).innerText || '');
    f.fiche8 = /\b8 joueurs\b/.test(fiche);
    f.fiche30 = /\b30 joueurs\b/.test(fiche);
    f.erreurs = erreurs;
    return f;
  } finally {
    await contexte.close();
  }
}

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    const f = await mesurer(browser, null);
    ok(Boolean(f.seuls && f.normal), 'MONTAGE : les deux groupes sont au planning laser', JSON.stringify({ seuls: f.seuls, normal: f.normal }));
    ok(Boolean(f.seuls) && f.seuls.texte === '8j' && /arène pour eux seuls/.test(f.seuls.titre), '[1] la puce dit le groupe (8 j) et pourquoi la session est pleine', JSON.stringify(f.seuls));
    ok(f.jauge >= 99, '[2] la session reste pleine : la jauge est a 100 %', `${f.jauge} %`);
    ok(f.fiche8 && !f.fiche30, '[3] la fiche dit « 8 joueurs », jamais 30', JSON.stringify({ huit: f.fiche8, trente: f.fiche30 }));
    ok(Boolean(f.normal) && f.normal.texte === '6j' && !/seuls/.test(f.normal.titre), '[4] un groupe ordinaire garde son compte, sans la mention', JSON.stringify(f.normal));
    ok(f.erreurs.length === 0, 'zero erreur JS ni console', f.erreurs.slice(0, 3).join(' | '));
    const m = await mesurer(browser, MUTATION);
    ok(Boolean(m.seuls) && m.seuls.texte === '30j', '[5] contre-preuve : la puce relue sur les armes dit 30 j, [1] rougirait', JSON.stringify(m.seuls));
    const mf = await mesurer(browser, MUTATION_FICHE);
    ok(mf.fiche30, '[5] contre-preuve : la fiche relue sur les armes dit 30 joueurs, [3] rougirait', JSON.stringify({ huit: mf.fiche8, trente: mf.fiche30 }));
  } finally {
    await browser.close();
    server.close();
  }
  console.log(echecs ? `\narene-seuls-planning-check : ${echecs} echec(s)` : '\narene-seuls-planning-check: ALL OK, le planning dit le groupe et garde l arene pleine.');
  process.exit(echecs ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

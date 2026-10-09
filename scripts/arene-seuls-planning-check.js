// L ARENE POUR VOUS SEULS AU PLANNING (gate ne le 2026-10-08, suite de la
// regle S6 de la fenetre Reserver).
//
// Un groupe de 8 qui privatise l arene retient ses 30 armes : le bloc laser
// porte players = 30 (l occupation : le depart est plein) et joueursReels
// = 8 (le groupe). Le planning dit le GROUPE partout ou il ecrit un nombre
// de joueurs, et garde l occupation pleine.
//   [1] le groupe, dans la ligne de son depart, dit 8 (jamais 30) et pourquoi
//       le depart est plein (« arène pour eux seuls ») ;
//   [1b] le prochain depart dit « 8 armes à préparer », pas 30 ;
//   [2] le depart reste plein : 30 sur 30, « complet », ses 30 cases prises
//       (8 au groupe, 22 tenues pour lui) ;
//   [3] la fiche dit « 8 joueurs » pour la partie, jamais 30 ;
//   [4] un groupe ordinaire (sans le choix) garde son compte (6), sans la
//       mention ;
//   [5] contre-preuves : le groupe relu sur players dit 30, et [1] rougit ;
//       la fiche relue sur players dit 30 joueurs, et [3] rougit.
// La page est figee a 14:55 d un samedi : 15:00 est le prochain depart, quelle
// que soit l heure du lancement du gate.
// Le serveur et le moteur ont leur gate (reserver-arene-seuls-check).
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { serveStatic, installMock, boot, BROWSER_PATH } = require('./reserver-v5-check');

const ROOT = path.resolve(__dirname, '..');
const JOUR = '2026-10-10';
const MAINTENANT = new Date(`${JOUR}T14:55:00`);
// Le groupe relu sur les armes qu il retient : il dit 30.
const MUTATION = {
  de: 'function lpGroupe(w) { return Math.max(1, Number(w.joueursReels ?? w.players) || Number(w.reservation?.pax) || 1); }',
  vers: 'function lpGroupe(w) { return Math.max(1, Number(w.players) || Number(w.reservation?.pax) || 1); }',
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
    // A 13:55, 14:00 est le prochain depart : 15:00 et 17:00 sont dans la
    // liste de la journee.
    const avant = new Date(MAINTENANT.getTime() - 60 * 60 * 1000);
    await page.clock.setFixedTime(avant);
    await installMock(page, { maintenant: avant.getTime() });
    await installerGroupes(page);
    await boot(page, { installer: false });
    await page.evaluate(() => {
      state.reservations = window.__GROUPES__();
      state.currentDate = todayStr();
      openStaffPlanningResource('laser');
    });
    await page.waitForSelector('#laserPlanningGridWrap .lp-dep .lp-g[data-laser-res-id="9401"]', { timeout: 8000 });
    const f = await page.evaluate(() => {
      const puce = (id) => {
        const el = document.querySelector(`#laserPlanningGridWrap .lp-dep .lp-g[data-laser-res-id="${id}"]`);
        const n = el ? el.querySelector('span') : null;
        return el ? { texte: (n ? n.textContent : '').replace(/\s+/g, ' ').trim(), titre: el.getAttribute('title') || '' } : null;
      };
      const rang = document.querySelector('#laserPlanningGridWrap .lp-dep[data-lp-t="15"]');
      const cases = rang ? [...rang.querySelectorAll('.lp-cases i')] : [];
      const depart = rang ? {
        occupe: (rang.querySelector('.lp-dep__n b') || {}).textContent || '',
        reste: (rang.querySelector('.lp-dep__n small') || {}).textContent || '',
        cases: cases.length,
        // Une case du groupe porte son dossier (data-lp-id), quelle que soit sa couleur.
        groupe: cases.filter((i) => i.hasAttribute('data-lp-id') && !i.classList.contains('is-prive')).length,
        tenues: cases.filter((i) => i.classList.contains('is-prive')).length,
        vides: cases.filter((i) => !i.className).length,
      } : null;
      return { seuls: puce(9401), normal: puce(9402), depart };
    });
    // A 14:55, 15:00 est le prochain depart : la carte du haut dit les armes
    // a preparer pour lui.
    await page.clock.setFixedTime(MAINTENANT);
    await page.evaluate(() => renderLaserPlanning());
    f.prochain = await page.evaluate(() => {
      const p = document.querySelector('#laserPlanningGridWrap .lp-prochain[data-lp-t="15"]');
      if (!p) return null;
      const g = p.querySelector('.lp-groupe__sel[data-laser-res-id="9401"] .lp-n');
      return {
        armes: [...p.querySelectorAll('.lp-prochain__g b, .lp-prochain__g small')].map((e) => e.textContent.trim()).join(' '),
        detail: g ? g.textContent.replace(/\s+/g, ' ').trim() : '',
      };
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
    ok(Boolean(f.seuls && f.normal && f.depart), 'MONTAGE : les deux groupes et le depart de 15:00 sont au planning laser', JSON.stringify({ seuls: f.seuls, normal: f.normal }));
    ok(Boolean(f.seuls) && f.seuls.texte === '8 · arène pour eux seuls' && /: 8 joueurs, arène pour eux seuls\./.test(f.seuls.titre) && !/30/.test(f.seuls.titre),
      '[1] le groupe dit 8, et pourquoi le depart est plein', JSON.stringify(f.seuls));
    ok(Boolean(f.prochain) && f.prochain.armes === '8 armes à préparer' && f.prochain.detail === '8 joueurs · arène pour eux seuls',
      '[1b] le prochain depart dit 8 armes a preparer, pas 30', JSON.stringify(f.prochain));
    ok(Boolean(f.depart) && f.depart.occupe === '30' && f.depart.reste === 'complet' && f.depart.cases === 30 && f.depart.groupe === 8 && f.depart.tenues === 22 && f.depart.vides === 0,
      '[2] le depart reste plein : 30 sur 30, 8 cases au groupe, 22 tenues pour lui', JSON.stringify(f.depart));
    ok(f.fiche8 && !f.fiche30, '[3] la fiche dit « 8 joueurs », jamais 30', JSON.stringify({ huit: f.fiche8, trente: f.fiche30 }));
    ok(Boolean(f.normal) && f.normal.texte === '6' && /: 6 joueurs\./.test(f.normal.titre) && !/seuls/.test(f.normal.titre), '[4] un groupe ordinaire garde son compte, sans la mention', JSON.stringify(f.normal));
    ok(f.erreurs.length === 0, 'zero erreur JS ni console', f.erreurs.slice(0, 3).join(' | '));
    const m = await mesurer(browser, MUTATION);
    ok(Boolean(m.seuls) && /^30 · arène pour eux seuls$/.test(m.seuls.texte), '[5] contre-preuve : le groupe relu sur les armes dit 30, [1] rougirait', JSON.stringify(m.seuls));
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

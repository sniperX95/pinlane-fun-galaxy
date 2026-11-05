// Outils pour piloter le vrai formulaire sur le banc local.
'use strict';
const path = require('path');
const WT = path.resolve(__dirname, '..', '..');
const { chromium, webkit } = require(path.join(WT, 'node_modules/playwright-core'));
const BROWSER = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
async function attendre(page, fn, ms, arg) { try { await page.waitForFunction(fn, arg, { timeout: ms || 8000 }); return true; } catch (e) { return false; } }
// ROBOT_MOTEUR=webkit : le moteur de Safari, celui de tous les iPhone.
const lancer = () => (process.env.ROBOT_MOTEUR === 'webkit' ? webkit.launch({ headless: true }) : chromium.launch({ executablePath: BROWSER, headless: true }));
async function ouvrir(browser, { base = 'http://127.0.0.1:4377', centre = 'libramont', date = '2026-11-07', pax = 8, formule, choix, activities, w = 390, h = 844, contexte, avantHeures }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 700, deviceScaleFactor: w < 700 ? 2 : 1, ...(contexte || {}) });
  const page = await ctx.newPage();
  page.setDefaultTimeout(9000);
  page.__erreurs = []; browser.__dernierePage = page;
  page.on('pageerror', (e) => page.__erreurs.push(String(e.message || e)));
  await page.goto(`${base}/fungalaxy/${centre}`, { waitUntil: 'networkidle', timeout: 45000 });
  await attendre(page, () => document.body.classList.contains('is-ready') && document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour', 15000);
  await page.click('#dayBtn');
  await attendre(page, () => !document.querySelector('#dayPop').hidden && document.querySelectorAll('#calGrid .fg-cal__day').length >= 28, 5000);
  const [y, mo] = date.split('-').map(Number);
  const cible = `${MOIS[mo - 1].charAt(0).toUpperCase() + MOIS[mo - 1].slice(1)} ${y}`;
  for (let k = 0; k < 14; k += 1) {
    const titre = await page.evaluate(() => document.querySelector('#calTitle').textContent.trim());
    if (titre === cible) break;
    await page.click('#calNext');
    await attendre(page, (t) => document.querySelector('#calTitle').textContent.trim() !== t, 3000, titre);
  }
  await attendre(page, (d) => { const b = document.querySelector(`#calGrid .fg-cal__day[data-date="${d}"]`); return b && !b.classList.contains('is-loading'); }, 8000, date);
  await page.click(`#calGrid .fg-cal__day[data-date="${date}"]`);
  await page.waitForTimeout(300);
  await page.fill('#paxInput', String(pax));
  await page.press('#paxInput', 'Tab');
  await page.waitForTimeout(250);
  await page.click('#goActivities');
  await attendre(page, () => document.querySelector('.fg-scene[data-scene="activites"].is-active') && !document.querySelector('.fg-scene.is-entering'), 5000);
  await page.waitForTimeout(400);
  if (formule) { await page.click('#tabFor'); await page.waitForTimeout(400); await page.click(`.fg-card--formule[data-formule="${formule}"]`); await page.waitForTimeout(150); if (choix) { await page.click(`[data-choix="${choix}"]`).catch(() => {}); } }
  else for (const id of activities) { await page.click(`[data-activity-toggle="${id}"]`); await page.waitForTimeout(350); }
  await page.waitForTimeout(250);
  if (avantHeures) await avantHeures(page);
  await page.click('#goHours');
  await attendre(page, () => document.querySelector('.fg-scene[data-scene="heures"].is-active') && !document.querySelector('.fg-scene.is-entering'), 6000);
  await attendre(page, () => !document.querySelector('#hourZone').classList.contains('is-busy') && document.querySelector('#planZone .fg-visit, #planZone .fg-notice'), 20000);
  await page.waitForTimeout(500);
  return { ctx, page };
}
const etat = (page) => page.evaluate(() => {
  const txt = (el) => (el ? el.innerText.replace(/\s*\n+\s*/g, ' | ').replace(/\s+/g, ' ').trim() : '');
  const lignes = [...document.querySelectorAll('#hourZone .fg-etape[data-partie]')].filter((li) => li.getClientRects().length).map((li) => {
    const c = ['is-open', 'is-choisi', 'is-propose', 'is-vide', 'is-surplace', 'is-libre'].filter((x) => li.classList.contains(x)).map((x) => x.slice(3, 6)).join(',');
    return `${li.dataset.cle}=${li.querySelector('.fg-etape__heure').dataset.mot || ''}[${c}]`;
  });
  const conseil = [...document.querySelectorAll('#hourZone .fg-conseil')].filter((c) => !c.hidden).map(txt);
  const pleines = [...document.querySelectorAll('#hourZone .fg-etape.is-open .fg-chip')].filter((c) => (c.classList.contains('is-on') && !c.classList.contains('is-autre')) || (c.classList.contains('is-proposed') && !c.hasAttribute('data-suggere'))).map((c) => c.dataset.time);
  const warn = txt(document.querySelector('#planZone .fg-visit__warn'));
  const notice = txt(document.querySelector('#planZone .fg-notice'));
  return { lignes: lignes.join(' | '), recap: txt(document.querySelector('#planZone .fg-visit')) || notice, conseil, pleines, warn, bouton: !document.querySelector('#goContact').disabled, largeur: document.documentElement.scrollWidth };
});
async function montrer(page, nom) {
  const e = await etat(page);
  console.log(`[${nom}]\n  lignes  ${e.lignes}\n  pleine  ${e.pleines.join(',') || '-'}  conseil ${JSON.stringify(e.conseil)}${e.warn ? `  warn ${e.warn}` : ''}\n  recap   ${e.recap}\n  bouton ${e.bouton}${page.__erreurs.length ? `  ERREURS ${page.__erreurs.join(';')}` : ''}`);
  return e;
}
const calme = async (page) => { await page.waitForTimeout(250); await attendre(page, () => !document.querySelector('#hourZone').classList.contains('is-busy'), 15000); await page.waitForTimeout(500); };
async function ouvrirLigne(page, cle) {
  const ouverte = await page.evaluate((c) => { const li = document.querySelector(`#hourZone .fg-etape[data-cle="${c}"]`); return Boolean(li && li.classList.contains('is-open')); }, cle);
  if (!ouverte) { await page.click(`#hourZone .fg-etape[data-cle="${cle}"] .fg-etape__tete`); await page.waitForTimeout(450); }
  if (cle === 'arrivee' || cle === 'arcade_time') await attendre(page, (c) => document.querySelectorAll(`#hourZone .fg-track[data-activity="${c}"] .fg-chip`).length > 0, 10000, cle);
}
async function poser(page, cle, h) {
  await ouvrirLigne(page, cle);
  const id = cle.split('#')[0];
  await page.click(`#hourZone .fg-track[data-activity="${id}"] .fg-chip[data-time="${h}"]`);
  await calme(page);
}
module.exports = { lancer, ouvrir, etat, montrer, calme, ouvrirLigne, poser, attendre };

#!/usr/bin/env node
'use strict';
// =============================================================================
// LES HORAIRES BLOQUES, VUS PAR LES CLIENTS (formulaire Fun Galaxy)
// -----------------------------------------------------------------------------
// Movsar, 2026-09-29 : « lorsqu un client choisit ses horaires, ca montre que
// les horaires choisis sont bloques pour lui pendant 10 minutes max [...] au
// bout du timer, s il n a pas confirme, ca annule et c est relibere [...] si 3
// personnes sont sur la meme page au meme moment ».
//
// Le serveur (verrou, echeance, conversion, trois clients en meme temps) est
// prouve par scripts/slot-holds-check.js. Ici, des NAVIGATEURS, plusieurs a
// la fois, sur le serveur de dev (blocages en memoire, meme contrat) :
//   [A] « Ces horaires me vont » bloque : le bandeau le dit sur les
//       coordonnees et le recapitulatif, avec l heure limite et un decompte
//       parti de dix minutes ; le jeton accompagne ensuite chaque lecture des
//       horaires.
//   [B] LES AUTRES : un deuxieme et un troisieme client qui visent la meme
//       place restent sur les horaires ; la phrase dit qu elle n est plus
//       libre et quand elle se libere ; leurs horaires se relisent. Un
//       quatrieme, qui ne touche a rien, voit ses horaires bouger tout seuls.
//   [C] L ECHEANCE : a zero, le bandeau dit que rien n est plus garanti et
//       propose de les bloquer a nouveau ; la place revient aux autres ; si
//       un autre l a prise, la reprise est refusee et mene a d autres horaires.
//   [D] LA CONFIRMATION porte le jeton, le blocage devient la reservation.
//   [E] CHANGER DE PROGRAMME rend la place tout de suite ; revenir sur le meme
//       choix ne relance pas le decompte.
//   [F] Sans serveur de blocage (503), le client avance sans bandeau.
//   [G] A 390 px, le bandeau tient dans l ecran, le decompte se voit.
//   [H] Contre-epreuves : chaque regle retiree du formulaire, ce gate ROUGIT.
//
// Captures dans ux/holds (a regarder, pas a comparer au pixel).
// AUCUNE BASE, AUCUN ENVOI.
// =============================================================================
const fs = require('fs');
const http = require('http');
const path = require('path');

delete process.env.RESEND_API_KEY;
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
process.env.PINLANE_CALENDAR_SYNC = 'off';
process.env.PINLANE_DEVTUNNEL_HOLD_SECONDS = '600';

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PINLANE_HOLD_PORT || 4396);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CAPTURES = process.env.PINLANE_HOLD_CAPTURES || path.join(ROOT, 'tmp', 'holds');

let echecs = 0;
function ok(cond, label, detail) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) echecs += 1;
  return Boolean(cond);
}
function section(t) { console.log(`\n--- ${t}`); }
async function attendre(page, fn, ms, arg) {
  try { await page.waitForFunction(fn, arg, { timeout: ms, polling: 100 }); return true; } catch (error) { return false; }
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------------------------------------------------------------------------
// Le serveur de dev, enveloppe : une contre-epreuve du formulaire est servie
// en memoire (le disque n est jamais touche), et l adresse du blocage peut
// repondre a la demande : 503 (serveur en panne), 404 brut (l adresse manque,
// deploiement ou reecriture), 404 du centre (un vrai refus, JSON ok:false).
// ---------------------------------------------------------------------------
let formulaireCasse = null;
let blocagesEnPanne = '';
function serveur(mock) {
  const base = mock.createServer({ port: PORT });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    const fichierCasse = formulaireCasse && (formulaireCasse.fichier || 'assets/fungalaxy-booking.js');
    if (fichierCasse && url.pathname === `/${fichierCasse}`) {
      const src = fs.readFileSync(path.join(ROOT, fichierCasse), 'utf8').replace(/\r\n/g, '\n');
      res.writeHead(200, { 'Content-Type': `${fichierCasse.endsWith('.css') ? 'text/css' : 'text/javascript'}; charset=utf-8`, 'Cache-Control': 'no-store' });
      res.end(src.split(formulaireCasse.de).join(formulaireCasse.vers));
      return;
    }
    // Tous les navigateurs du gate partagent 127.0.0.1 : le plafond de
    // requetes par adresse (60 par minute sur la disponibilite) les
    // compterait ensemble, et un refus 429 passerait pour un defaut du
    // formulaire. En prod chaque client a son adresse.
    const seaux = globalThis.__pinlaneRateBuckets;
    if (seaux) [...seaux.keys()].filter((k) => /^public-(availability|holds|reservations):/.test(k)).forEach((k) => seaux.delete(k));
    if (blocagesEnPanne && url.pathname === '/api/public-holds') {
      if (blocagesEnPanne === '404-brut') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end('Not found');
        return;
      }
      if (blocagesEnPanne === '404-centre') {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: false, message: REFUS_CENTRE }));
        return;
      }
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: false, code: 'hold_unavailable', message: 'Vos horaires n’ont pas pu être retenus pour le moment.' }));
      return;
    }
    base.emit('request', req, res);
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

// Sept pistes sur huit prises toute la journee : la huitieme est la derniere.
function semer(mock) {
  mock.blocagesDev.clear();
  mock.occupationDev.length = 0;
  mock.dernierePose.blocages.length = 0;
  mock.dernierePose.body = null;
  for (let l = 1; l <= 7; l += 1) {
    mock.occupationDev.push({
      id: 700 + l, centerId: 'libramont', date: mock.DATE, startTime: '10:00', duration: 14, totalDuration: 14,
      lanes: [l], pax: 6, status: 'confirmed', validationStatus: 'confirmed', type: 'bowling', opsPlan: null, program: null, name: 'Groupe',
    });
  }
  process.env.PINLANE_DEVTUNNEL_HOLD_SECONDS = '600';
}

async function allerAuMois(page, dateStr) {
  const [y, mo] = dateStr.split('-').map(Number);
  const cible = `${cap(MOIS[mo - 1])} ${y}`;
  for (let k = 0; k < 16; k += 1) {
    const titre = await page.evaluate(() => document.querySelector('#calTitle').textContent.trim());
    if (titre === cible) break;
    const [nom, an] = titre.split(' ');
    const courant = Number(an) * 12 + MOIS.indexOf(nom.toLowerCase());
    await page.click(y * 12 + (mo - 1) > courant ? '#calNext' : '#calPrev');
    await attendre(page, (x) => document.querySelector('#calTitle').textContent.trim() !== x, 3000, titre);
  }
  return attendre(page, (d) => { const b = document.querySelector(`#calGrid .fg-cal__day[data-date="${d}"]`); return b && !b.classList.contains('is-loading'); }, 8000, dateStr);
}

// Un client jusqu aux horaires, plan calcule. Ses requetes de disponibilite
// et de blocage sont gardees (en-tete du jeton compris).
async function client(browser, mock, { largeur = 1440, hauteur = 900, etiquette = 'hold', activites = ['bowling'] } = {}) {
  const ctx = await browser.newContext({ viewport: { width: largeur, height: hauteur } });
  const page = await ctx.newPage();
  const erreurs = [];
  const dispo = [];
  const blocages = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  page.on('request', (r) => {
    if (r.url().indexOf('/api/public-availability?') >= 0) dispo.push({ jeton: r.headers()['x-pinlane-hold'] || '' });
  });
  page.on('response', async (r) => {
    if (r.url().indexOf('/api/public-holds') < 0) return;
    let json = null;
    try { json = await r.json(); } catch (e) { json = null; }
    blocages.push({ statut: r.status(), json: json || {} });
  });
  await page.goto(`${BASE_URL}/fungalaxy/libramont?v=${etiquette}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('body.is-ready', { timeout: 20000 });
  await page.click('#dayBtn');
  await allerAuMois(page, mock.DATE);
  await page.click(`#calGrid .fg-cal__day[data-date="${mock.DATE}"]`);
  await page.click('#goActivities');
  await attendre(page, () => document.querySelector('.fg-scene[data-scene="activites"].is-active') && !document.querySelector('.fg-scene.is-entering'), 8000);
  for (const id of activites) await page.click(`#gridAct .fg-card[data-activity="${id}"]`);
  await page.click('#goHours');
  const pret = await attendre(page, () => document.querySelector('.fg-scene[data-scene="heures"].is-active') && !document.querySelector('.fg-scene.is-entering')
    && document.querySelector('#planZone .fg-visit') && !document.querySelector('#hourZone').classList.contains('is-busy') && !document.querySelector('#goContact').disabled, 20000);
  return { ctx, page, erreurs, dispo, blocages, pret };
}
// L heure retenue du bowling : posee par le client (is-on) ou proposee par
// le serveur (is-proposed).
const heureBowling = (page) => page.evaluate(() => {
  const t = document.querySelector('#hourZone .fg-track[data-activity="bowling"]');
  const c = t && (t.querySelector('.fg-chip.is-on') || t.querySelector('.fg-chip.is-proposed'));
  return c ? c.dataset.time : '';
});
// Un clic qui ne bloque pas le gate : sur un formulaire casse, l element
// attendu peut ne jamais apparaitre, et c est un verdict, pas une panne.
async function cliquer(page, sel, ms = 5000) {
  try { await page.click(sel, { timeout: ms }); return true; } catch (error) { return false; }
}
async function continuer(page) {
  await page.click('#goContact');
  // L aller-retour du blocage : le bouton travaille, puis l ecran change ou
  // l alerte des horaires parle.
  await attendre(page, () => !document.querySelector('#goContact').classList.contains('is-busy'), 10000);
  return attendre(page, () => (document.querySelector('.fg-scene[data-scene="contact"].is-active') && !document.querySelector('.fg-scene.is-entering'))
    || !document.querySelector('#hourErr').hidden, 10000);
}
function lireBandeau(page, scene) {
  return page.evaluate((s) => {
    const b = document.querySelector(`.fg-scene[data-scene="${s}"] [data-hold]`);
    if (!b) return null;
    const txt = (n) => (n ? n.textContent.replace(/\s+/g, ' ').trim() : '');
    const btn = b.querySelector('[data-hold-action]');
    const temps = b.querySelector('[data-hold-temps]');
    const r = b.getBoundingClientRect();
    return {
      visible: !b.hidden && r.height > 0,
      titre: txt(b.querySelector('[data-hold-titre]')),
      sous: txt(b.querySelector('[data-hold-sous]')),
      temps: temps && !temps.hidden ? txt(temps) : '',
      tempsLargeur: temps && !temps.hidden ? temps.getBoundingClientRect().width : 0,
      bouton: btn && !btn.hidden ? txt(btn) : '',
      urgent: b.classList.contains('is-urgent'),
      libre: b.classList.contains('is-libre'),
      gauche: r.left, droite: r.right,
      deborde: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  }, scene);
}
async function remplirContact(page) {
  await page.fill('#cPrenom', 'Camille');
  await page.fill('#cNom', 'Test');
  await page.fill('#cEmail', 'groupe@example.org');
  await page.fill('#cTel', '0491301667');
  await page.click('.fg-occasion[data-occasion="anniversaire"]');
  await page.check('#cConsent');
  await page.click('#goRecap');
  return attendre(page, () => document.querySelector('.fg-scene[data-scene="recap"].is-active') && !document.querySelector('.fg-scene.is-entering'), 8000);
}
async function passerLaVitrine(page) {
  await attendre(page, () => { const v = document.querySelector('#vitrine'); return !v || !v.hasAttribute('data-attendue'); }, 5000);
  const ouverte = await page.evaluate(() => { const v = document.querySelector('#vitrine'); return Boolean(v && !v.hidden); });
  if (ouverte) {
    await page.click('#vitrine .fg-vitrine__non');
    await attendre(page, () => document.querySelector('#vitrine').hidden, 3000);
  }
}
async function capture(page, nom) {
  try {
    fs.mkdirSync(CAPTURES, { recursive: true });
    await page.screenshot({ path: path.join(CAPTURES, `${nom}.png`) });
  } catch (error) { /* la capture n est pas une verification */ }
}
// Une capture a l arret : les animations d entree finies (borne : un point
// qui pulse tourne sans fin), l element qui compte dans l ecran. Sinon la
// capture montre un ecran a moitie peint, l alerte hors du cadre.
async function captureAu(page, nom, sel) {
  await attendre(page, () => document.getAnimations().every((a) => a.playState !== 'running'
    || (a.effect && a.effect.getTiming().iterations === Infinity)), 4000);
  if (sel) await page.evaluate((s) => { const e = document.querySelector(s); if (e && !e.hidden) e.scrollIntoView({ block: 'center' }); }, sel);
  await pause(300);
  await capture(page, nom);
}
const secondes = (t) => { const m = /^(\d+):(\d{2})$/.exec(t || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };

// ---------------------------------------------------------------------------
// LES SCENARIOS. Chacun rend des faits ; les verdicts sont poses a part, et
// les contre-epreuves rejouent les memes scenarios sur un formulaire casse.
// ---------------------------------------------------------------------------
async function scenarioTenir(browser, mock, etiquette) {
  semer(mock);
  const A = await client(browser, mock, { etiquette: `${etiquette}-a` });
  const heureA = await heureBowling(A.page);
  const passe = await continuer(A.page);
  const surContact = await A.page.evaluate(() => Boolean(document.querySelector('.fg-scene[data-scene="contact"].is-active')));
  await attendre(A.page, () => { const b = document.querySelector('.fg-scene[data-scene="contact"] [data-hold]'); return b && !b.hidden; }, 3000);
  const bandeau = await lireBandeau(A.page, 'contact');
  await capture(A.page, `${etiquette}-contact`);
  const tenu = A.blocages.find((b) => b.statut === 201);
  const jeton = tenu ? tenu.json.holdToken : '';
  // Retour aux horaires, une autre heure posee : la lecture porte le jeton.
  await cliquer(A.page, '.fg-scene[data-scene="contact"] [data-back]');
  await attendre(A.page, () => document.querySelector('.fg-scene[data-scene="heures"].is-active') && !document.querySelector('.fg-scene.is-entering'), 8000);
  const lecturesAvant = A.dispo.length;
  const sel = '#hourZone .fg-track[data-activity="bowling"] .fg-chip[data-time="14:00"]';
  const periode = await A.page.evaluate((s) => { const c = document.querySelector(s); const sec = c && c.closest('.fg-period'); return sec && !sec.classList.contains('is-open') ? sec.dataset.period : ''; }, sel);
  if (periode) await cliquer(A.page, `#hourZone .fg-track[data-activity="bowling"] .fg-period[data-period="${periode}"] .fg-period__btn`);
  await attendre(A.page, (s) => { const c = document.querySelector(s); return c && c.getBoundingClientRect().height > 30; }, 4000, sel);
  await cliquer(A.page, sel);
  await attendre(A.page, (n) => !document.querySelector('#hourZone').classList.contains('is-busy'), 15000);
  await pause(300);
  const lecturesApres = A.dispo.slice(lecturesAvant);
  const serveur = jeton ? (mock.blocagesDev.get(jeton) || {}).etat : '';
  // L onglet ferme : la place est rendue tout de suite (pagehide).
  await A.ctx.close();
  await pause(600);
  return {
    pret: A.pret, heureA, passe, surContact, bandeau, jeton, serveur,
    apresFermeture: jeton ? (mock.blocagesDev.get(jeton) || {}).etat : '',
    lecturesAvecJeton: lecturesApres.length > 0 && lecturesApres.every((l) => l.jeton === jeton),
    lectures: lecturesApres.length,
    erreurs: A.erreurs,
  };
}

async function scenarioLesAutres(browser, mock, etiquette) {
  semer(mock);
  // Quatre clients ouvrent les horaires AVANT que le premier bloque. B et C
  // arrivent en dernier et continuent aussitot apres A, ensemble : leurs
  // horaires n ont pas encore ete relus (toutes les 20 s depuis leur
  // arrivee), ils visent la place que A vient de prendre. D, arrive le
  // premier, ne touche a rien.
  const D = await client(browser, mock, { etiquette: `${etiquette}-d` });
  const A = await client(browser, mock, { etiquette: `${etiquette}-a` });
  const B = await client(browser, mock, { etiquette: `${etiquette}-b` });
  const C = await client(browser, mock, { etiquette: `${etiquette}-c` });
  const heures = [await heureBowling(A.page), await heureBowling(B.page), await heureBowling(C.page), await heureBowling(D.page)];
  await continuer(A.page);
  const aPasse = await A.page.evaluate(() => Boolean(document.querySelector('.fg-scene[data-scene="contact"].is-active')));
  const lire = async (P) => {
    await continuer(P.page);
    await attendre(P.page, () => !document.querySelector('#hourZone').classList.contains('is-busy') && document.querySelector('#planZone .fg-visit'), 15000);
    return P.page.evaluate(() => {
      const e = document.querySelector('#hourErr');
      const t = document.querySelector('#hourZone .fg-track[data-activity="bowling"]');
      const c = t && (t.querySelector('.fg-chip.is-on') || t.querySelector('.fg-chip.is-proposed'));
      return {
        surHoraires: Boolean(document.querySelector('.fg-scene[data-scene="heures"].is-active')),
        alerte: e && !e.hidden ? e.textContent.replace(/\s+/g, ' ').trim() : '',
        heure: c ? c.dataset.time : '',
      };
    });
  };
  const [b, c] = await Promise.all([lire(B), lire(C)]);
  await captureAu(B.page, `${etiquette}-pris`, '#hourErr');
  // D ne touche a rien : ses horaires se relisent seuls (toutes les 20 s).
  const dAvant = heures[3];
  await attendre(D.page, (h) => {
    const t = document.querySelector('#hourZone .fg-track[data-activity="bowling"]');
    const x = t && (t.querySelector('.fg-chip.is-on') || t.querySelector('.fg-chip.is-proposed'));
    return x && x.dataset.time !== h;
  }, 22000, dAvant);
  const dApres = await heureBowling(D.page);
  const erreurs = [...A.erreurs, ...B.erreurs, ...C.erreurs, ...D.erreurs];
  const actifs = [...mock.blocagesDev.values()].filter((x) => x.etat === 'actif').length;
  await Promise.all([A.ctx.close(), B.ctx.close(), C.ctx.close(), D.ctx.close()]);
  return { heures, aPasse, b, c, dAvant, dApres, actifs, erreurs };
}

async function scenarioEcheance(browser, mock, etiquette) {
  semer(mock);
  const A = await client(browser, mock, { etiquette: `${etiquette}-a` });
  const B = await client(browser, mock, { etiquette: `${etiquette}-b` });
  process.env.PINLANE_DEVTUNNEL_HOLD_SECONDS = '5';
  await continuer(A.page);
  process.env.PINLANE_DEVTUNNEL_HOLD_SECONDS = '600';
  const pendant = await lireBandeau(A.page, 'contact');
  const echu = await attendre(A.page, () => { const b = document.querySelector('.fg-scene[data-scene="contact"] [data-hold]'); return b && b.classList.contains('is-libre'); }, 9000);
  const apres = await lireBandeau(A.page, 'contact');
  await capture(A.page, `${etiquette}-echu`);
  // La place est revenue : B la prend.
  await continuer(B.page);
  const bPasse = await B.page.evaluate(() => Boolean(document.querySelector('.fg-scene[data-scene="contact"].is-active')));
  // A veut la reprendre : refuse, la phrase dit quand elle se libere.
  await cliquer(A.page, '.fg-scene[data-scene="contact"] [data-hold-action]');
  await attendre(A.page, () => { const b = document.querySelector('.fg-scene[data-scene="contact"] [data-hold-action]'); return b && b.dataset.action === 'rechoisir'; }, 8000);
  const refus = await lireBandeau(A.page, 'contact');
  await capture(A.page, `${etiquette}-reprise-refusee`);
  await cliquer(A.page, '.fg-scene[data-scene="contact"] [data-hold-action]');
  const retour = await attendre(A.page, () => document.querySelector('.fg-scene[data-scene="heures"].is-active') && !document.querySelector('.fg-scene.is-entering')
    && !document.querySelector('#hourZone').classList.contains('is-busy') && document.querySelector('#planZone .fg-visit'), 15000);
  const heureApres = await heureBowling(A.page);
  const erreurs = [...A.erreurs, ...B.erreurs];
  await Promise.all([A.ctx.close(), B.ctx.close()]);
  return { pendant, echu, apres, bPasse, refus, retour, heureApres, erreurs };
}

async function scenarioConfirmer(browser, mock, etiquette) {
  semer(mock);
  const A = await client(browser, mock, { etiquette: `${etiquette}-a` });
  await continuer(A.page);
  const jeton = (A.blocages.find((b) => b.statut === 201) || { json: {} }).json.holdToken || '';
  const recap = await remplirContact(A.page);
  const bandeauRecap = await lireBandeau(A.page, 'recap');
  await capture(A.page, `${etiquette}-recap`);
  await passerLaVitrine(A.page);
  await cliquer(A.page, '#confirmBtn');
  const fin = await attendre(A.page, () => document.querySelector('.fg-scene[data-scene="fin"].is-active'), 15000);
  const corps = mock.dernierePose.body || {};
  const bandeauxCaches = await A.page.evaluate(() => Array.from(document.querySelectorAll('[data-hold]')).every((b) => b.hidden));
  await A.ctx.close();
  return { recap, bandeauRecap, fin, jeton, envoye: corps.holdToken || '', etat: jeton ? (mock.blocagesDev.get(jeton) || {}).etat : '', bandeauxCaches, sansContact: !('name' in ((A.blocages[0] || {}).json || {})) };
}

async function scenarioChanger(browser, mock, etiquette) {
  semer(mock);
  const A = await client(browser, mock, { etiquette: `${etiquette}-a` });
  await continuer(A.page);
  const jeton = (A.blocages.find((b) => b.statut === 201) || { json: {} }).json.holdToken || '';
  const t0 = secondes((await lireBandeau(A.page, 'contact')).temps);
  // Retour, puis le meme choix : aucun nouveau blocage, le decompte continue.
  await cliquer(A.page, '.fg-scene[data-scene="contact"] [data-back]');
  await attendre(A.page, () => document.querySelector('.fg-scene[data-scene="heures"].is-active') && !document.querySelector('.fg-scene.is-entering'), 8000);
  await pause(2200);
  await continuer(A.page);
  const t1 = secondes((await lireBandeau(A.page, 'contact')).temps);
  const demandes = mock.dernierePose.blocages.filter((b) => b.action === 'hold' && b.jeton === jeton).length;
  // Retour aux activites, une activite de plus : la place est rendue.
  await cliquer(A.page, '.fg-scene[data-scene="contact"] [data-back]');
  await attendre(A.page, () => document.querySelector('.fg-scene[data-scene="heures"].is-active') && !document.querySelector('.fg-scene.is-entering'), 8000);
  await cliquer(A.page, '.fg-scene[data-scene="heures"] [data-back]');
  await attendre(A.page, () => document.querySelector('.fg-scene[data-scene="activites"].is-active') && !document.querySelector('.fg-scene.is-entering'), 8000);
  await cliquer(A.page, '#gridAct .fg-card[data-activity="laser_game"]');
  await attendre(A.page, (j) => false, 1500);
  const libere = mock.dernierePose.blocages.some((b) => b.action === 'release' && b.jeton === jeton && b.libere);
  const etat = (mock.blocagesDev.get(jeton) || {}).etat;
  await A.ctx.close();
  return { t0, t1, demandes, libere, etat };
}

const REFUS_CENTRE = 'Ce centre n’accepte pas de réservation en ligne pour le moment.';
async function scenarioPanne(browser, mock, etiquette, mode = '503') {
  semer(mock);
  blocagesEnPanne = mode;
  try {
    const A = await client(browser, mock, { etiquette: `${etiquette}-a` });
    await continuer(A.page);
    const surContact = await A.page.evaluate(() => Boolean(document.querySelector('.fg-scene[data-scene="contact"].is-active')));
    const bandeau = await lireBandeau(A.page, 'contact');
    const alerte = await A.page.evaluate(() => { const e = document.querySelector('#hourErr'); return e && !e.hidden ? e.textContent.replace(/\s+/g, ' ').trim() : ''; });
    await A.ctx.close();
    return { surContact, bandeau, alerte };
  } finally {
    blocagesEnPanne = '';
  }
}
// Une adresse de blocage absente ne bloque personne ; un refus du centre, si.
function verifierAdresseAbsente(r, dire = true) {
  const c = r.surContact && r.bandeau && !r.bandeau.visible && !r.alerte;
  return dire ? ok(c, '[F] l adresse du blocage absente (404 brut, sans JSON) : le client avance, sans bandeau, sans refus', JSON.stringify({ contact: r.surContact, alerte: r.alerte })) : Boolean(c);
}

async function scenarioTelephone(browser, mock, etiquette, seulementOrdre = false) {
  semer(mock);
  const A = await client(browser, mock, { etiquette: `${etiquette}-a`, largeur: 390, hauteur: 844 });
  await continuer(A.page);
  await attendre(A.page, () => { const b = document.querySelector('.fg-scene[data-scene="contact"] [data-hold]'); return b && !b.hidden; }, 3000);
  const bandeau = await lireBandeau(A.page, 'contact');
  // Sur telephone l ecran des coordonnees range ses blocs en colonne (rang
  // CSS par bloc) : le bandeau doit suivre le fil des etapes et le titre, et
  // preceder la carte de la visite et les champs. Sans rang, il passait en
  // tete, au-dessus du fil des etapes.
  const ordre = await A.page.evaluate(() => {
    const s = document.querySelector('.fg-scene[data-scene="contact"]');
    const r = (sel) => { const e = s.querySelector(sel); return e ? e.getBoundingClientRect() : null; };
    const b = r('[data-hold]'); const etapes = r('.fg-steps'); const titre = r('.fg-title'); const carte = r('.fg-recall'); const champs = r('.fg-fields');
    return {
      apresEtapes: Boolean(b && etapes && b.top >= etapes.bottom - 1),
      apresTitre: Boolean(b && titre && b.top >= titre.bottom - 1),
      avantCarte: Boolean(b && carte && b.bottom <= carte.top + 1),
      avantChamps: Boolean(b && champs && b.bottom <= champs.top + 1),
    };
  });
  await captureAu(A.page, `${etiquette}-telephone`, '.fg-scene[data-scene="contact"] [data-hold]');
  await A.ctx.close();
  if (seulementOrdre) return { bandeau, largeur: 390, ordre };
  // Les deux dernieres minutes, a l ecran : un blocage de 100 s.
  semer(mock);
  process.env.PINLANE_DEVTUNNEL_HOLD_SECONDS = '100';
  const U = await client(browser, mock, { etiquette: `${etiquette}-u` });
  await continuer(U.page);
  process.env.PINLANE_DEVTUNNEL_HOLD_SECONDS = '600';
  const urgent = await lireBandeau(U.page, 'contact');
  await capture(U.page, `${etiquette}-urgent`);
  await U.ctx.close();
  return { bandeau, largeur: 390, ordre, urgent };
}

// ---------------------------------------------------------------------------
// LES VERDICTS.
// ---------------------------------------------------------------------------
const TENU = 'Vos horaires sont bloqués pour vous';
function verifierTenir(r, dire = true) {
  const v = [
    [r.pret && r.passe && r.surContact, '[A] « Ces horaires me vont » bloque les horaires et mene aux coordonnees'],
    [r.bandeau && r.bandeau.visible && r.bandeau.titre === TENU, '[A] le bandeau le dit', r.bandeau && r.bandeau.titre],
    [r.bandeau && /^Jusqu’à \d{2}:\d{2}\. Sans validation d’ici là, ils sont remis en vente\.$/.test(r.bandeau.sous), '[A] avec l heure limite, et ce qui se passe ensuite', r.bandeau && r.bandeau.sous],
    [r.bandeau && secondes(r.bandeau.temps) >= 590 && secondes(r.bandeau.temps) <= 600, '[A] le decompte part de dix minutes', r.bandeau && r.bandeau.temps],
    [r.serveur === 'actif', '[A] le serveur tient un blocage pour ce jeton', r.serveur],
    [r.apresFermeture === 'libere', '[A] l onglet ferme, la place est rendue tout de suite', r.apresFermeture],
    [r.lecturesAvecJeton, '[A] de retour aux horaires, chaque lecture porte le jeton (ses horaires restent libres pour lui)', `${r.lectures} lecture(s)`],
    [!r.erreurs.length, '[A] aucune erreur de page', r.erreurs.join(' | ')],
  ];
  return v.map(([c, l, d]) => (dire ? ok(c, l, d) : Boolean(c))).every(Boolean);
}
function verifierLesAutres(r, dire = true) {
  const libere = /Ces horaires ne sont plus libres\..*se libère au plus tard à \d{2}:\d{2}\./;
  const v = [
    [r.heures.every((h) => h === r.heures[0]) && r.heures[0], '[B] quatre clients voient la meme heure, la derniere piste', r.heures.join(',')],
    [r.aPasse, '[B] le premier la bloque'],
    [r.b.surHoraires && libere.test(r.b.alerte), '[B] le deuxieme reste sur les horaires : la phrase dit qu elle n est plus libre, et quand elle se libere', r.b.alerte],
    [r.c.surHoraires && libere.test(r.c.alerte), '[B] le troisieme aussi', r.c.alerte],
    [r.b.heure && r.b.heure !== r.heures[0], '[B] leurs horaires se relisent : la place prise n est plus proposee', `${r.heures[0]} -> ${r.b.heure}`],
    [r.dApres && r.dApres !== r.dAvant, '[B] le quatrieme, sans rien toucher, voit ses horaires bouger (relus toutes les 20 s)', `${r.dAvant} -> ${r.dApres}`],
    [r.actifs === 1, '[B] un seul blocage en cours', String(r.actifs)],
    [!r.erreurs.length, '[B] aucune erreur de page', r.erreurs.join(' | ')],
  ];
  return v.map(([c, l, d]) => (dire ? ok(c, l, d) : Boolean(c))).every(Boolean);
}
function verifierEcheance(r, dire = true) {
  const v = [
    [r.pendant && r.pendant.titre === TENU && secondes(r.pendant.temps) <= 5, '[C] un blocage de 5 s se decompte', r.pendant && r.pendant.temps],
    [r.echu && r.apres && r.apres.titre === 'Vos horaires ne sont plus bloqués' && r.apres.bouton === 'Les bloquer à nouveau' && !r.apres.temps, '[C] a zero, le bandeau dit que rien n est plus garanti et propose de les bloquer a nouveau', r.apres && `${r.apres.titre} / ${r.apres.bouton}`],
    [r.bPasse, '[C] la place revient aux autres : un deuxieme client la bloque'],
    [r.refus && /se libère au plus tard à \d{2}:\d{2}/.test(r.refus.sous) && r.refus.bouton === 'Choisir d’autres horaires', '[C] la reprise est refusee, et dit quand la place se libere', r.refus && r.refus.sous],
    [r.retour && r.heureApres && r.heureApres !== '', '[C] « Choisir d’autres horaires » ramene aux horaires, relus', r.heureApres],
    [!r.erreurs.length, '[C] aucune erreur de page', r.erreurs.join(' | ')],
  ];
  return v.map(([c, l, d]) => (dire ? ok(c, l, d) : Boolean(c))).every(Boolean);
}
function verifierConfirmer(r, dire = true) {
  const v = [
    [r.recap && r.bandeauRecap && r.bandeauRecap.visible && r.bandeauRecap.titre === TENU, '[D] le recapitulatif montre le meme bandeau', r.bandeauRecap && r.bandeauRecap.titre],
    [r.fin && r.jeton && r.envoye === r.jeton, '[D] la confirmation porte le jeton', `${r.jeton.slice(0, 6)}… / ${r.envoye.slice(0, 6)}…`],
    [r.etat === 'converti', '[D] le blocage est devenu la reservation', r.etat],
    [r.bandeauxCaches, '[D] une fois reserve, plus aucun bandeau'],
  ];
  return v.map(([c, l, d]) => (dire ? ok(c, l, d) : Boolean(c))).every(Boolean);
}
function verifierOrdreTelephone(r, dire = true) {
  const o = r.ordre || {};
  const c = o.apresEtapes && o.apresTitre && o.avantCarte && o.avantChamps;
  return dire ? ok(c, '[G] le bandeau suit le fil des etapes et le titre, avant la carte de la visite et les champs', JSON.stringify(o)) : Boolean(c);
}
function verifierChanger(r, dire = true) {
  const v = [
    [r.demandes === 1 && r.t1 < r.t0, '[E] revenir sur le meme choix ne relance pas le decompte', `${r.demandes} demande(s), ${r.t0}s puis ${r.t1}s`],
    [r.libere && r.etat === 'libere', '[E] changer de programme rend la place tout de suite', `${r.libere} ${r.etat}`],
  ];
  return v.map(([c, l, d]) => (dire ? ok(c, l, d) : Boolean(c))).every(Boolean);
}

async function main() {
  const mock = require('./dev-tunnel-server');
  const { chromium } = require('playwright-core');
  const srv = await serveur(mock);
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    section('[A] BLOQUER EN PASSANT AUX COORDONNEES');
    verifierTenir(await scenarioTenir(browser, mock, 'tenir'));
    section('[B] LES AUTRES CLIENTS, AU MEME MOMENT');
    verifierLesAutres(await scenarioLesAutres(browser, mock, 'autres'));
    section('[C] L ECHEANCE');
    verifierEcheance(await scenarioEcheance(browser, mock, 'echeance'));
    section('[D] LA CONFIRMATION');
    verifierConfirmer(await scenarioConfirmer(browser, mock, 'confirmer'));
    section('[E] CHANGER, REVENIR');
    verifierChanger(await scenarioChanger(browser, mock, 'changer'));
    section('[F] SANS SERVEUR DE BLOCAGE');
    const panne = await scenarioPanne(browser, mock, 'panne');
    ok(panne.surContact && panne.bandeau && !panne.bandeau.visible, '[F] le client avance, sans bandeau (rien n est promis)', JSON.stringify(panne.bandeau && { visible: panne.bandeau.visible }));
    verifierAdresseAbsente(await scenarioPanne(browser, mock, 'absente', '404-brut'));
    const refusCentre = await scenarioPanne(browser, mock, 'centre', '404-centre');
    ok(!refusCentre.surContact && refusCentre.alerte === REFUS_CENTRE, '[F] un vrai refus du centre (404 JSON ok:false) reste un refus : le client reste sur les horaires, la phrase du centre s affiche', JSON.stringify({ contact: refusCentre.surContact, alerte: refusCentre.alerte }));
    section('[G] A 390 PX');
    const tel = await scenarioTelephone(browser, mock, 'tel');
    ok(tel.bandeau && tel.bandeau.visible && tel.bandeau.gauche >= 0 && tel.bandeau.droite <= tel.largeur && tel.bandeau.deborde <= 0, '[G] le bandeau tient dans l ecran, rien ne deborde', JSON.stringify({ g: tel.bandeau && tel.bandeau.gauche, d: tel.bandeau && tel.bandeau.droite, deborde: tel.bandeau && tel.bandeau.deborde }));
    ok(tel.bandeau && tel.bandeau.tempsLargeur > 20 && /^\d+:\d{2}$/.test(tel.bandeau.temps), '[G] le decompte se voit', tel.bandeau && tel.bandeau.temps);
    verifierOrdreTelephone(tel);
    ok(tel.urgent && tel.urgent.urgent && tel.urgent.titre === TENU, '[G] les deux dernieres minutes passent a l ambre', JSON.stringify(tel.urgent && { urgent: tel.urgent.urgent, temps: tel.urgent.temps }));

    section('[H] CONTRE-EPREUVES DU FORMULAIRE');
    const src = fs.readFileSync(path.join(ROOT, 'assets/fungalaxy-booking.js'), 'utf8').replace(/\r\n/g, '\n');
    const casses = [
      {
        de: "    goContact.classList.add('is-busy'); goContact.setAttribute('aria-busy', 'true');\n    retenir(corpsBlocage(), cle).then(function (r) {",
        vers: "    versLeContact(); return;\n    retenir(corpsBlocage(), cle).then(function (r) {",
        jouer: async () => !verifierLesAutres(await scenarioLesAutres(browser, mock, 'k-sans-blocage'), false),
        label: 'sans le blocage au passage, les autres clients passent aussi : ce gate ROUGIRAIT',
      },
      {
        // Le calcul passe par la lecture bornee (lire, 2026-10-12) : meme regle,
        // le jeton voyage dans son en-tete.
        de: "    lire(urlDispo(), { headers: enteteBlocage(), signal: controle.signal })\n      .then(function (rep) {\n        if (id !== requeteEnCours) return;",
        vers: "    lire(urlDispo(), { signal: controle.signal })\n      .then(function (rep) {\n        if (id !== requeteEnCours) return;",
        jouer: async () => !verifierTenir(await scenarioTenir(browser, mock, 'k-sans-entete'), false),
        label: 'sans le jeton dans la lecture des horaires, le client ne voit plus sa propre place : ce gate ROUGIRAIT',
      },
      {
        de: '    if (reste <= 0) {\n      clearInterval(blocage.minuteur); blocage.minuteur = 0;',
        vers: '    if (false) {\n      clearInterval(blocage.minuteur); blocage.minuteur = 0;',
        jouer: async () => !verifierEcheance(await scenarioEcheance(browser, mock, 'k-sans-echeance'), false),
        label: 'sans l echeance a l ecran, le bandeau promet encore une place rendue : ce gate ROUGIRAIT',
      },
      {
        de: '      if (blocage.jeton) corps.holdToken = blocage.jeton;\n      return fetch(\'/api/public-reservations\'',
        vers: '      return fetch(\'/api/public-reservations\'',
        jouer: async () => !verifierConfirmer(await scenarioConfirmer(browser, mock, 'k-sans-jeton'), false),
        label: 'sans le jeton a la confirmation, le blocage ne devient pas la reservation : ce gate ROUGIRAIT',
      },
      {
        de: 'goContact.disabled = true; annulerPlan(); libererBlocage(); }',
        vers: 'goContact.disabled = true; annulerPlan(); }',
        jouer: async () => !verifierChanger(await scenarioChanger(browser, mock, 'k-sans-liberation'), false),
        label: 'sans la liberation, un programme change garde la place dix minutes : ce gate ROUGIRAIT',
      },
      {
        de: "    if (blocage.etat === 'tenu' && blocage.cle === cle && blocage.echeance > Date.now()) { versLeContact(); return; }\n",
        vers: '',
        jouer: async () => !verifierChanger(await scenarioChanger(browser, mock, 'k-relance'), false),
        label: 'sans la memoire du choix bloque, revenir relance dix minutes : ce gate ROUGIRAIT',
      },
      {
        de: "        if ((res.statut === 422 || res.statut === 404) && x.ok === false && x.message) return { refus: true, message: x.message, code: x.code || '', fromPax: x.fromPax };",
        vers: "        if (res.statut === 422 || res.statut === 404) return { refus: true, message: x.message || '', code: x.code || '', fromPax: x.fromPax };",
        jouer: async () => !verifierAdresseAbsente(await scenarioPanne(browser, mock, 'k-404', '404-brut'), false),
        label: 'sans le tri des 404, une adresse de blocage absente bloquerait tous les clients sur les horaires : ce gate ROUGIRAIT',
      },
      {
        fichier: 'assets/fungalaxy-booking.css',
        de: '  .fg-scene[data-scene="contact"] .fg-hold { order: 2; margin-top: 0; margin-bottom: 22px; }\n',
        vers: '',
        jouer: async () => !verifierOrdreTelephone(await scenarioTelephone(browser, mock, 'k-sans-rang', true), false),
        label: 'sans le rang du bandeau, il repasse au-dessus du fil des etapes sur telephone : ce gate ROUGIRAIT',
      },
    ];
    const sources = { 'assets/fungalaxy-booking.js': src };
    for (const c of casses) {
      const fichier = c.fichier || 'assets/fungalaxy-booking.js';
      if (!sources[fichier]) sources[fichier] = fs.readFileSync(path.join(ROOT, fichier), 'utf8').replace(/\r\n/g, '\n');
      if (sources[fichier].split(c.de).length !== 2) { ok(false, `contre-epreuve montable : ancre introuvable (${c.de.trim().slice(0, 60)})`); continue; }
      formulaireCasse = { fichier, de: c.de, vers: c.vers };
      try {
        ok(await c.jouer(), c.label);
      } catch (error) {
        // Le parcours casse s est arrete en route : c est bien un rouge, dit tel quel.
        ok(true, c.label, `(le parcours s arrete : ${String(error.message || error).split(String.fromCharCode(10))[0].slice(0, 90)})`);
      } finally { formulaireCasse = null; }
    }
    // Le formulaire restaure repasse au vert.
    ok(verifierTenir(await scenarioTenir(browser, mock, 'restaure'), false), 'formulaire restaure : le blocage refonctionne');
  } finally {
    formulaireCasse = null;
    blocagesEnPanne = '';
    await browser.close();
    srv.close();
  }
  console.log(`\n${echecs === 0 ? 'fungalaxy-hold-check: ALL OK' : `fungalaxy-hold-check: ${echecs} echec(s)`}`);
  process.exit(echecs === 0 ? 0 : 1);
}

main().catch((error) => { console.error(error); process.exit(1); });

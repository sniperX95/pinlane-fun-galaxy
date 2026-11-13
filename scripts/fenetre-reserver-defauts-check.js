#!/usr/bin/env node
'use strict';
/* ============================================================================
   GATE : la fenetre Reserver, trois defauts vus par Ansar (2026-11-13)

   Ansar, devant la fenetre du comptoir : « quand on choisi bowling a 18h donc
   fini a 19 et que je prends lasergame a 18h30 ça dit rien », « choix du nombre
   de joueur passe souvent a la trappe », et sur la page du laser « les heures
   partent dans des boutons en dessous ».

   [F1] UNE HEURE PENDANT L AUTRE ACTIVITE DU GROUPE LE DIT, avant le toucher.
        Le laser a 17:00, le bowling « juste après » (17:30 a 18:30) : la touche
        18:00 du laser dit « pendant le bowling », dans le ton d avis (elle reste
        touchable, le bowling suivra). Elle disait « reste 8 ».
   [F2] CE QUI BOUGE TOUT SEUL SE DIT. Le laser deplace a 18:00, le bowling part
        a 18:30 : sa ligne du ticket dit « Déplacé de 17:30 à 18:30 ». Rien ne le
        disait.
   [F3] PENDANT UNE ACTIVITE FIXEE, LE TON DU REFUS. Le bowling pose a la main a
        22:30 : les touches 22:30 et 23:00 du laser disent « pendant le bowling »
        en rouge (le plan les refusera : « se chevauchent »).
   [F4] LE MOT D UNE HEURE SE LIT EN ENTIER : aucun mot coupe a la largeur de sa
        touche (« manque 1… », « bowling, … »).
   [F5] LA QUESTION DES JOUEURS VIENT AU GESTE. Une heure touchee sans nombre
        ouvre « Combien de joueurs ? » (le focus y est), Echap la ferme, Créer la
        rouvre, un toucher y repond : le nombre est pris, l heure gardee.
   [F6] UN NOMBRE DEVINE N EST PAS UN NOMBRE DIT. La porte du laser du planning
        posait 4 joueurs et la fenetre les tenait pour choisis : elle s ouvre sur
        la question. Un nombre vraiment dit (reserverAuComptoir) reste pris.
   [F7] LES HEURES DE LA PAGE LASER PRENNENT LEUR HAUTEUR (1100 x 700) : la
        derniere ligne de touches finit dans sa rangee, au-dessus d « Arène ». Elle
        passait 120 px dessous.
   [*]  Zero erreur JavaScript.

   Le banc est celui de reserver-seances-check : la VRAIE console
   (planning-v3-fixtures, le samedi 16 janvier 2027 a 15:10, 46 groupes), le VRAI
   handler api/staff-reservations.js et le vrai moteur (reserver-banc, base en
   memoire). Chaque toucher est un vrai clic (page.click), jamais un clic par
   JavaScript. Le gate asserte d abord son MONTAGE (ce que le banc doit offrir
   pour que la regle se juge), puis la regle.

   CONTRE-PREUVES : `--contre-preuves` sert le code d avant, une regle a la fois
   (le disque n est jamais touche), et exige que chacune rougisse sa cible.
   `--ancres` verifie que chaque ancre existe une seule fois.

   Zero reseau sortant, zero vraie base : rien ne part.
   ========================================================================== */
const fs = require('fs');
const path = require('path');

delete process.env.RESEND_API_KEY;
delete process.env.POSTGRES_URL;
process.env.DATABASE_URL = 'postgres://gate:gate@127.0.0.1:1/gate';
process.env.PINLANE_CALENDAR_SYNC = 'off';
const fetchOrigine = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url && url.url ? url.url : url);
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(u)) throw new Error(`gate : appel sortant refuse vers ${u.slice(0, 80)}`);
  return fetchOrigine(url, init);
};

const B = require('./reserver-banc.js');
const FX = require('./planning-v3-fixtures.js');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_FENETRE_PORT || 4937);
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HEURE = '15:10';
const APP = 'assets/app-main.js';
const CSS = 'assets/pinlane-staff.css';
const lf = (t) => String(t).split('\r\n').join('\n');

// LE CODE D AVANT, une regle a la fois. `cible` : la lettre qui doit rougir.
const MUTATIONS = [
  { nom: 'pendant-muet', cible: 'F1', fichier: APP, de: '  if (!plages || !heure || !RV_ANCRABLES.includes(id)) return null;', vers: '  return null;' },
  { nom: 'deplacement-muet', cible: 'F2', fichier: APP, de: '  if (id) s.deplace = { id, avant: avant.lignes[id].heure, apres: apres[id].heure };', vers: '' },
  { nom: 'fixe-en-avis', cible: 'F3', fichier: APP, de: "${pendant ? (pendant.suit ? ' is-pendant' : ' is-coince') : ''}${gris ? ' is-efface' : ''}\"${on ? ` id=\"rvHeure-${escapeHtml(id)}\"` : ''}", vers: "${pendant ? ' is-pendant' : ''}${gris ? ' is-efface' : ''}\"${on ? ` id=\"rvHeure-${escapeHtml(id)}\"` : ''}" },
  { nom: 'mot-coupe', cible: 'F4', fichier: CSS, de: '.qb-modal.rv.rs .rs-h small { font-size: 12px; font-weight: 400; line-height: 1.2; color: var(--muted); max-width: 100%; overflow-wrap: break-word; text-wrap: balance; }', vers: '.qb-modal.rv.rs .rs-h small { font-size: 12px; font-weight: 400; line-height: 1.2; color: var(--muted); white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }' },
  { nom: 'question-absente', cible: 'F5', fichier: APP, de: '  b.demandeJoueurs = true;\n  b.focusQuestionJoueurs = true;\n', vers: '' },
  { nom: 'nombre-devine', cible: 'F6', fichier: APP, de: '  if (prefill.pax != null) rsEtat(quickBookState).faits.combien = !prefill.paxIndicatif;', vers: '  if (prefill.pax != null) rsEtat(quickBookState).faits.combien = true;' },
  { nom: 'heures-ecrasees', cible: 'F7', fichier: CSS, de: '.qb-modal.rv.rs .rs-rang { flex: 1 0 auto; display: grid; grid-template-columns: 76px minmax(0, 1fr); gap: 10px; min-height: 44px; max-height: 120px; }\n.qb-modal.rv.rs .rs-rang.is-heures { flex: none; max-height: none; }', vers: '.qb-modal.rv.rs .rs-rang { flex: 1 1 52px; display: grid; grid-template-columns: 76px minmax(0, 1fr); gap: 10px; min-height: 44px; max-height: 120px; }' },
];

const argument = (nom) => process.argv.includes(`--${nom}`);
let mutation = null;
let echecs = [];
let reussis = 0;
function ok(cond, label, detail) {
  if (cond) { reussis += 1; if (!mutation) console.log(`ok    ${label}`); return true; }
  echecs.push(label);
  if (!mutation) console.log(`FAIL  ${label}${detail !== undefined ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  return false;
}

function compterAncre(m) {
  return lf(fs.readFileSync(path.join(ROOT, m.fichier), 'utf8')).split(m.de).length - 1;
}

function transformer(rel, texte) {
  if (!mutation || mutation.fichier !== rel) return texte;
  return lf(texte).split(mutation.de).join(mutation.vers);
}

// ---------------------------------------------------------------------------
// LE MONTAGE (celui de reserver-seances-check)
// ---------------------------------------------------------------------------
const HORLOGE_SERVEUR = { fichier: 'lib/booking-config.js', de: 'function getBusinessNowParts(date = new Date()) {', vers: 'function getBusinessNowParts(date = new Date(globalThis.__comptoirMaintenant || Date.now())) {' };

function ligneDepuis(r) {
  return {
    id: r.id, center_id: r.centerId || 'libramont', channel: r.channel || 'staff', name: String(r.name).replace('DÉMO · ', ''), phone: r.phone || '', email: r.email || '',
    date: r.date, start_time: r.startTime, duration: r.duration, total_duration: r.totalDuration ?? r.duration, lanes: (r.lanes || []).map(Number),
    pax: r.pax, status: r.status, base_price: r.basePrice, price: r.price, type: r.type, formule_id: r.formuleId || null, label: r.label,
    occasion: r.occasion || '', extras: r.extras || [], payment_method: r.paymentMethod || null, notes: r.notes || '',
    ops_plan: r.opsPlan || null, risk_level: r.riskLevel || '', risk_score: r.riskScore ?? null, validation_status: r.validationStatus || 'confirmed',
    activity_progress: r.activityProgress || {}, program: r.program || null, companions: r.companions || 0,
    created_at: new Date(r.createdAt), updated_at: new Date(r.updatedAt),
    acquisition: r.acquisition ?? null, client_key: r.clientKey || '', paid_at: r.paidAt ? new Date(r.paidAt) : null,
    amount_paid: r.amountPaid ?? null, discount_reason: r.discountReason || '', absent_at: r.absentAt ? new Date(r.absentAt) : null,
  };
}

const serveur = B.monter({ mutations: [HORLOGE_SERVEUR], session: B.sessionDuRole('direction', { nom: 'Accueil' }) });

async function ouvrirConsole(browser, { largeur = 1366, hauteur = 768 } = {}) {
  FX.APPAREILS.comptoir = { viewport: { width: largeur, height: hauteur }, deviceScaleFactor: 1, locale: 'fr-BE' };
  const fx = FX.lireFixture('pic');
  globalThis.__comptoirMaintenant = FX.instant(fx.staffState.date, HEURE).getTime();
  B.semer(fx.staffState.reservations.map(ligneDepuis));
  const m = await FX.monter(browser, {
    fixture: 'pic', appareil: 'comptoir', theme: 'light', port: PORT, heure: HEURE,
    avantChargement: async (page) => {
      await page.exposeFunction('__fixtureServeur', async (corps) => serveur.appeler('PATCH', '/api/staff-reservations', corps));
      await page.exposeFunction('__vraiAppel', async (methode, url, corps) => serveur.appeler(methode, url, corps));
      await page.route('**/*fixture=*', async (route) => {
        const r = await route.fetch();
        let b = await r.text();
        b = b.split('DÉMO · ').join('').split('D\\u00c9MO \\u00b7 ').join('').replace(/\[DEMO-JOURS[^"\\]*\]\s*/g, '').replace(/Dossier fictif de d(?:é|\\u00e9)monstration[^"]*/g, '');
        await route.fulfill({ response: r, body: b });
      });
    },
  });
  const { page } = m;
  page.setDefaultTimeout(8000);
  await page.evaluate(() => {
    const avant = window.fetch;
    window.fetch = async (input, init) => {
      init = init || {};
      const u = new URL(typeof input === 'string' ? input : input.url, location.origin);
      const me = String(init.method || (typeof input === 'object' && input.method) || 'GET').toUpperCase();
      const json = (corps, status = 200) => new Response(JSON.stringify(corps), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'surMesureCatalogue') return json({ ok: true, centerId: 'libramont', surMesure: { categories: [], articles: [] } });
      if (u.pathname === '/api/staff-reservations' && me !== 'PATCH') {
        const corps = init.body ? JSON.parse(init.body) : undefined;
        const rep = await window.__vraiAppel(me, u.pathname + u.search, corps);
        return json(rep.json || {}, rep.statut);
      }
      return avant(input, init);
    };
  });
  await page.waitForSelector('.gf-r', { timeout: 10000 });
  return m;
}

const pret = (page) => page.waitForFunction(() => { const b = document.querySelector('#rvCreer'); return b && b.dataset.pret === '1'; }, null, { timeout: 8000 }).catch(() => {});
// Les heures d un bloc, une fois que le serveur les a relues.
const lues = (page, id) => page.waitForSelector(`.rs-s-l[data-verifie="1"] [data-activite="${id}"]`, { timeout: 8000 }).catch(() => {});
const seance = (id, heure) => `.rs-s-l [data-activite="${id}"][data-heure="${heure}"]`;
async function touche(page, id, heure) {
  await page.locator(seance(id, heure)).click();
  await page.waitForTimeout(150);
  await lues(page, id);
  await page.waitForTimeout(600);
}
const lireTouche = (page, id, heure) => page.evaluate((s) => {
  const b = document.querySelector(s);
  return b ? { mot: ((b.querySelector('small') || {}).textContent || '').trim(), pendant: b.classList.contains('is-pendant'), coince: b.classList.contains('is-coince'), titre: b.getAttribute('title') || '' } : null;
}, seance(id, heure));
const lignes = (page) => page.evaluate(() => JSON.parse(JSON.stringify(rvHeuresDesLignes())));

// ---------------------------------------------------------------------------
// [F1] [F2] [F3] [F4] LE GROUPE A DEUX ENDROITS
// ---------------------------------------------------------------------------
async function scenarioChevauchement(browser, lettres) {
  const m = await ouvrirConsole(browser);
  const { page } = m;
  try {
    await page.locator('.btn-new').click();
    await page.locator('#rsHaut [data-pax="8"]').click();
    await pret(page);
    // Le laser d abord (« Choisir » le prend a la place du bowling propose), a 17:00.
    await page.locator('#rsAjout-laser_game').click();
    await lues(page, 'laser_game');
    await touche(page, 'laser_game', '17:00');
    // Le bowling ajoute, puis pris « juste après » le laser.
    await page.locator('#rsAjout-bowling').click();
    await lues(page, 'bowling');
    await touche(page, 'bowling', '17:30');
    const l1 = await lignes(page);
    const monte = l1.laser_game && l1.laser_game.heure === '17:00' && l1.laser_game.index === 0 && l1.bowling && l1.bowling.heure === '17:30' && l1.bowling.foulee === true;
    ok(monte, '[F1] montage : le laser a 17:00, le bowling juste apres (17:30, a la suite)', l1);
    if (lettres.includes('F1')) {
      const t = await lireTouche(page, 'laser_game', '18:00');
      ok(Boolean(t) && t.pendant && !t.coince && t.mot === 'pendant le bowling' && /Pendant le bowling de 17:30 à 18:30/.test(t.titre), '[F1] la touche 18:00 du laser dit « pendant le bowling », en avis, et le survol ce qui se passera', t);
    }
    if (lettres.includes('F4')) {
      const mots = await page.evaluate(() => Array.from(document.querySelectorAll('.rs-s-l .rs-h small')).filter((s) => s.getClientRects().length).map((s) => ({ mot: s.textContent.trim(), coupe: s.scrollWidth > s.clientWidth + 1 })));
      const longs = mots.filter((x) => x.mot.length >= 12);
      ok(longs.length >= 2, '[F4] montage : des mots longs sous les heures (« manque 2 armes », « pendant le bowling »)', mots.map((x) => x.mot).slice(0, 12));
      ok(longs.length >= 2 && !mots.some((x) => x.coupe), '[F4] aucun mot d heure coupe a la largeur de sa touche', mots.filter((x) => x.coupe).map((x) => x.mot));
    }
    // Le laser deplace sur l heure du bowling : le bowling suit, le ticket le dit.
    await touche(page, 'laser_game', '18:00');
    const l2 = await lignes(page);
    if (lettres.includes('F2')) {
      const dit = await page.evaluate(() => { const d = document.getElementById('rsDeplace'); const l = d && d.closest('[data-activite]'); return { dit: d ? d.textContent.trim() : '', ligne: l ? l.dataset.activite : '', visible: Boolean(d && d.getClientRects().length) }; });
      ok(l2.laser_game.heure === '18:00' && l2.bowling.heure === '18:30', '[F2] montage : le laser a 18:00, le bowling a suivi a 18:30', l2);
      ok(dit.visible && dit.ligne === 'bowling' && dit.dit === 'Déplacé de 17:30 à 18:30', '[F2] la ligne du bowling dit « Déplacé de 17:30 à 18:30 »', dit);
    }
    if (lettres.includes('F3')) {
      // Le bowling pose a la main a 22:30 (pas la suite) : il ne suivra plus.
      await touche(page, 'bowling', '22:30');
      const l3 = await lignes(page);
      ok(l3.bowling && l3.bowling.heure === '22:30' && l3.bowling.foulee === false, '[F3] montage : le bowling fixe a 22:30', l3);
      const a = await lireTouche(page, 'laser_game', '22:30');
      const b = await lireTouche(page, 'laser_game', '23:00');
      ok([a, b].every((t) => t && t.coince && !t.pendant && t.mot === 'pendant le bowling'), '[F3] les touches 22:30 et 23:00 du laser disent « pendant le bowling » dans le ton du refus', { a, b });
    }
  } finally {
    ok(m.erreurs.length === 0, '[*] zero erreur JavaScript (chevauchement)', m.erreurs.slice(0, 3).join(' | '));
    await m.ctx.close();
  }
}

// ---------------------------------------------------------------------------
// [F5] [F6] LES JOUEURS
// ---------------------------------------------------------------------------
const carte = (page) => page.evaluate(() => {
  const c = document.getElementById('rsQJ');
  return c && c.getClientRects().length ? { focus: Boolean(document.activeElement && document.activeElement.closest('#rsQJ')), titre: (c.querySelector('#rsQJT') || {}).textContent || '' } : null;
});
const fenetre = (page) => page.evaluate(() => (quickBookState ? { pax: quickBookState.pax, choisi: rsEtat().faits.combien, pied: (document.getElementById('rvCreer') || {}).textContent.trim(), heure: (rvHeuresDesLignes().bowling || {}).heure || quickBookState.startTime } : null));

async function scenarioJoueurs(browser, lettres) {
  const m = await ouvrirConsole(browser);
  const { page } = m;
  try {
    if (lettres.includes('F5')) {
      await page.locator('.btn-new').click();
      await page.waitForSelector('#rsHaut [data-pax]');
      ok(!(await carte(page)) && (await fenetre(page)).choisi === false, '[F5] montage : la fenetre s ouvre sans nombre, sans question par-dessus');
      await lues(page, 'bowling');
      await page.locator(seance('bowling', '18:00')).click();
      await page.waitForTimeout(400);
      const c1 = await carte(page);
      ok(Boolean(c1) && c1.focus && c1.titre === 'Combien de joueurs ?', '[F5] une heure touchee sans nombre ouvre « Combien de joueurs ? », le focus y est', c1);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
      const f0 = await fenetre(page);
      ok(!(await carte(page)) && Boolean(f0), '[F5] Echap ferme la question, pas la fenetre');
      if (f0) {
        await page.locator('#rvCreer').click();
        await page.waitForTimeout(300);
        ok(f0.pied === 'Combien de joueurs ?' && Boolean(await carte(page)), '[F5] « Combien de joueurs ? » au pied rouvre la question', f0.pied);
        const repondre = page.locator('#rsQJ [data-pax-q="8"]');
        if (await repondre.count()) {
          await repondre.click();
          await page.waitForTimeout(400);
        }
        const f = await fenetre(page);
        ok(Boolean(f) && !(await carte(page)) && f.pax === 8 && f.choisi === true && f.heure === '18:00', '[F5] un toucher y repond : 8 joueurs pris, le bowling de 18:00 garde', f);
      } else ok(false, '[F5] la fenetre reste ouverte pour repondre');
      await page.evaluate(() => { if (quickBookState) closeQuickBook(); });
    }
    if (lettres.includes('F6')) {
      await page.evaluate(() => openQuickBookForLaserSession(17.5, 6));
      await page.waitForTimeout(500);
      const f1 = await fenetre(page);
      const c = await carte(page);
      ok(f1.choisi === false && f1.pied === 'Combien de joueurs ?' && Boolean(c) && c.focus, '[F6] la porte du laser du planning ne pose plus 4 joueurs : la fenetre s ouvre sur la question', { ...f1, carte: c });
      await page.evaluate(() => closeQuickBook());
      await page.evaluate(() => reserverAuComptoir({ type: 'laser', startTime: '17:30', pax: 6 }));
      await page.waitForTimeout(500);
      const f2 = await fenetre(page);
      ok(f2.choisi === true && f2.pax === 6 && !(await carte(page)), '[F6] un nombre vraiment dit (6) reste pris, sans question', f2);
      await page.evaluate(() => closeQuickBook());
    }
  } finally {
    ok(m.erreurs.length === 0, '[*] zero erreur JavaScript (joueurs)', m.erreurs.slice(0, 3).join(' | '));
    await m.ctx.close();
  }
}

// ---------------------------------------------------------------------------
// [F7] LES HEURES DE LA PAGE LASER
// ---------------------------------------------------------------------------
async function scenarioPageLaser(browser) {
  const m = await ouvrirConsole(browser, { largeur: 1100, hauteur: 700 });
  const { page } = m;
  try {
    await page.locator('.btn-new').click();
    await page.locator('#rsHaut [data-pax="8"]').click();
    await pret(page);
    await page.locator('#rsAjout-laser_game').click();
    await lues(page, 'laser_game');
    await touche(page, 'laser_game', '17:00');
    await page.locator('#rsL-a-laser_game').click();
    await page.waitForSelector('.rs-choix.is-heures');
    await page.waitForTimeout(800);
    const r = await page.evaluate(() => {
      const rangs = Array.from(document.querySelectorAll('.rs-rang')).filter((x) => x.getClientRects().length);
      const heure = rangs.find((x) => x.querySelector('.rs-choix.is-heures'));
      const apres = heure ? rangs[rangs.indexOf(heure) + 1] : null;
      if (!heure || !apres) return null;
      const touches = Array.from(heure.querySelectorAll('.rs-choix > *')).map((t) => t.getBoundingClientRect());
      const lignesDeTouches = new Set(touches.map((t) => Math.round(t.top))).size;
      const bas = Math.max(...touches.map((t) => t.bottom));
      return { lignesDeTouches, bas: Math.round(bas), rangBas: Math.round(heure.getBoundingClientRect().bottom), suivant: (apres.querySelector('.rs-lbl') || {}).textContent, suivantHaut: Math.round(apres.getBoundingClientRect().top) };
    });
    ok(Boolean(r) && r.lignesDeTouches >= 3, '[F7] montage : a 1100 x 700, les heures du laser tiennent sur trois lignes ou plus', r);
    ok(Boolean(r) && r.bas <= r.rangBas + 1 && r.rangBas <= r.suivantHaut + 1, `[F7] la derniere ligne d heures finit dans sa rangee, au-dessus d « ${r ? r.suivant : 'Arène'} »`, r);
  } finally {
    ok(m.erreurs.length === 0, '[*] zero erreur JavaScript (page laser)', m.erreurs.slice(0, 3).join(' | '));
    await m.ctx.close();
  }
}

async function jouer(browser, lettres) {
  if (lettres.some((x) => ['F1', 'F2', 'F3', 'F4'].includes(x))) await scenarioChevauchement(browser, lettres);
  if (lettres.some((x) => ['F5', 'F6'].includes(x))) await scenarioJoueurs(browser, lettres);
  if (lettres.includes('F7')) await scenarioPageLaser(browser);
}

(async () => {
  if (argument('ancres')) {
    const mauvaises = MUTATIONS.filter((m) => compterAncre(m) !== 1);
    mauvaises.forEach((m) => console.log(`FAIL  ancre ${m.nom} trouvee ${compterAncre(m)} fois dans ${m.fichier}`));
    console.log(`fenetre-reserver-defauts-check --ancres : ${MUTATIONS.length - mauvaises.length}/${MUTATIONS.length} uniques`);
    process.exit(mauvaises.length ? 1 : 0);
  }
  const toutes = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7'];
  const http = await FX.servir({ port: PORT, transformer });
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  let code = 0;
  try {
    if (!argument('contre-preuves')) {
      await jouer(browser, toutes);
      console.log(`\n${reussis} ok, ${echecs.length} en echec`);
      code = echecs.length ? 1 : 0;
    } else {
      let muettes = 0;
      for (const m of MUTATIONS) {
        if (compterAncre(m) !== 1) { console.log(`FAIL  contre-preuve ${m.nom} : ancre trouvee ${compterAncre(m)} fois`); muettes += 1; continue; }
        mutation = m;
        echecs = [];
        await jouer(browser, [m.cible]);
        const mordue = echecs.some((label) => label.startsWith(`[${m.cible}]`) && !/montage/.test(label));
        const montage = echecs.filter((label) => /montage/.test(label));
        if (mordue && !montage.length) console.log(`ok    contre-preuve ${m.nom} : [${m.cible}] rougit (${echecs.filter((x) => x.startsWith(`[${m.cible}]`)).length} controle(s))`);
        else { muettes += 1; console.log(`FAIL  contre-preuve ${m.nom} : ${montage.length ? `le montage casse (${montage.join(' | ')})` : `[${m.cible}] reste vert`}`); }
      }
      mutation = null;
      console.log(`\n${MUTATIONS.length - muettes}/${MUTATIONS.length} contre-preuves mordent`);
      code = muettes ? 1 : 0;
    }
  } finally {
    await browser.close();
    http.close();
  }
  process.exit(code);
})().catch((e) => { console.error(e); process.exit(1); });

// LE FORMULAIRE TELEPHONE V2 : PLUS PETIT, EN FLUX, NATIF, ET LE CADRE SUIT.
//
// Verdict de Movsar sur son iPhone (Chrome et Safari), 2026-09-01 : « c est
// disproportionne, les activites debordent sur le bouton Continuer, le bouton
// monte par-dessus le nombre de joueurs, le calendrier s ouvre deux fois, et ca
// vivra DANS le site du centre ». Mesures du meme jour (WebKit iPhone 14,
// 390x664, tunnel pur, vraies gestes) : cartes de 84 px pour 31 px de texte
// (2,5 rangees visibles sur 4), CTA sticky colle SUR le compteur quand le
// clavier retrecit l ecran, focus programmatique qui ouvrait le clavier a
// l arrivee, bouton calendrier qui ouvrait le calendrier maison PUIS le natif,
// trois activites cochees perdues par un aller-retour sur « Nos formules »,
// cadre embarque fige a 720 px avec un ecran qui defilait dedans.
//
// Ce gate prouve, sur les DEUX moteurs (Chromium = Android, WebKit = iPhone),
// par les gestes reels du client :
//   A. MONTAGE : le tunnel boote a /reserver/libramont, 8 activites rendues.
//   B. VENUE : arrive sur « Vous etes combien ? », AUCUN champ n a le focus au
//      doigt ; le bouton « Voir les activites » est en flux SOUS le compteur,
//      et il y reste quand le clavier retrecit l ecran (modele Android).
//   C. DATE : au doigt, le bouton calendrier n existe pas ; le tap a l endroit
//      de l icone touche le champ natif lui-meme.
//   D. ACTIVITES : les 8 cartes tiennent SANS defiler, le dock ne parle pas
//      pour une allocation ordinaire, la sous-barre est absente, la question
//      tient sous 22 px.
//   E. PANIER : trois activites cochees, un tour par « Nos formules », retour
//      « A la carte » : les trois sont toujours la.
//   F. OPTIONS : « 1 session de laser game » n est pas un avertissement.
//   G. EMBARQUE : dans une page hote, le cadre prend la hauteur du contenu
//      (moins que le plancher d avant), rien ne defile dedans, et chaque
//      changement d ecran est signale au site (pinlane:screen).
//
// Contre-epreuves par mutation (4), restauration verifiee par hash :
//   m1 CTA venue remis en sticky            -> B rougit
//   m2 panier carte efface par les formules -> E rougit
//   m3 body embarque remis a 100dvh         -> G rougit
//   m4 dock qui parle pour tout             -> D rougit
//
// Lancement : node scripts/tunnel-mobile-v2-check.js
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..');
const { chromium, webkit, devices } = require(path.join(ROOT, 'node_modules', 'playwright-core'));
const PORT = Number(process.env.PINLANE_MOBILE_V2_PORT || 4266);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP = path.join(ROOT, 'assets', 'app-main.js');
const CSS = path.join(ROOT, 'assets', 'pinlane-client.css');
// LA DATE DU GATE SE CALCULE, ELLE NE S ECRIT PLUS EN DUR. Posee '2026-09-12'
// le 2026-09-02, elle est devenue passee le 13 : le tunnel remettait le champ a
// aujourd hui avec « Cette date est deja passee », et le gate mourait sur le
// bouton retour du haut, invisible, sans qu une ligne du produit ait bouge. Le
// catalogue factice n ouvre que le samedi : on prend le prochain samedi a trois
// jours au moins, heure de Bruxelles. PINLANE_MOBILE_V2_DATE force une date
// (preuve a plusieurs dates) ; today reste le vrai jour, comme l API reelle.
function jourBruxelles(decalage = 0) {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + decalage));
}
function prochainSamedi(auMoins = 3) {
  const curseur = jourBruxelles(auMoins);
  while (curseur.getUTCDay() !== 6) curseur.setUTCDate(curseur.getUTCDate() + 1);
  return curseur.toISOString().slice(0, 10);
}
const AUJOURDHUI = jourBruxelles(0).toISOString().slice(0, 10);
const DATE = process.env.PINLANE_MOBILE_V2_DATE || prochainSamedi(3);

let failures = [];
function ok(cond, id, detail) {
  const good = Boolean(cond);
  console.log(`${good ? 'ok  ' : 'FAIL'}  ${id}${good || !detail ? '' : `  [${detail}]`}`);
  if (!good) failures.push(id);
  return good;
}
function sha(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

// Le catalogue REEL de Libramont (GET public-booking-meta, 2026-09-01) : huit
// activites, la forme exacte de la prod, pour que la grille mesuree soit celle
// que le client voit.
const ACTIVITIES = [
  { id: 'bowling', name: 'Bowling', planned: true, resourceType: 'bowling_lane', priceType: 'grid_bowling', priceValue: null, pricing: null, unitLabel: 'par piste', order: 1, defaultMinutes: 60, minMinutes: 60, maxMinutes: 60, stepMinutes: 30, note: '', maxPax: null, units: null, capacityPerUnit: null, unitIds: null },
  { id: 'laser_game', name: 'Laser Game', planned: true, resourceType: 'laser_arena', priceType: 'grid_laser', priceValue: null, pricing: null, unitLabel: 'par personne', order: 2, defaultMinutes: 22, minMinutes: 22, maxMinutes: 22, stepMinutes: 30, note: '', maxPax: null, units: null, capacityPerUnit: null, unitIds: null },
  { id: 'minigolf_blacklight', name: 'Minigolf Blacklight', planned: false, resourceType: 'soft_capacity', priceType: 'per_pax', priceValue: 10, pricing: null, unitLabel: 'par personne', order: 3, defaultMinutes: 45, minMinutes: 30, maxMinutes: 75, stepMinutes: 30, note: '12 trous', maxPax: null, units: null, capacityPerUnit: null, unitIds: null },
  { id: 'billards', name: 'Billards', planned: false, resourceType: 'soft_capacity', priceType: 'per_unit_hour', priceValue: 10, pricing: null, unitLabel: 'par table et par heure', order: 5, defaultMinutes: 60, minMinutes: 60, maxMinutes: 180, stepMinutes: 60, note: '', maxPax: null, units: null, capacityPerUnit: null, unitIds: null },
  { id: 'arcade_time', name: 'Arcades', planned: false, resourceType: 'bar_service_then_autonomous', priceType: 'per_pax', priceValue: null, pricing: null, unitLabel: 'par personne', order: 6, defaultMinutes: 30, minMinutes: 30, maxMinutes: 30, stepMinutes: 30, note: '', maxPax: null, units: null, capacityPerUnit: null, unitIds: null },
  { id: 'playground', name: 'Playground', planned: false, resourceType: 'soft_capacity', priceType: 'per_pax', priceValue: 12, pricing: null, unitLabel: 'par enfant', order: 7, defaultMinutes: 60, minMinutes: 60, maxMinutes: 60, stepMinutes: 30, note: 'accès à la journée', maxPax: null, units: null, capacityPerUnit: null, unitIds: null },
  { id: 'duckpin_bowling', name: 'Duckpin Bowling', planned: false, resourceType: 'duckpin_lane', priceType: 'grid_bowling', priceValue: null, pricing: null, unitLabel: 'par piste', order: 8, defaultMinutes: 60, minMinutes: 60, maxMinutes: 60, stepMinutes: 30, note: '', maxPax: null, units: 2, capacityPerUnit: 6, unitIds: ['9', '10'] },
  { id: 'fun_run', name: 'Fun Run by PIXEL', planned: false, resourceType: 'soft_capacity', priceType: 'grid_fun_run', priceValue: null, pricing: null, unitLabel: 'la session', order: 9, defaultMinutes: 30, minMinutes: 15, maxMinutes: 30, stepMinutes: 30, note: '5 joueurs max.', maxPax: 5, units: null, capacityPerUnit: null, unitIds: null },
];

function metaPayload() {
  return {
    ok: true, today: AUJOURDHUI, durationOptions: [],
    formules: [{ id: 'f1', name: 'FORMULE 1', family: 'Formules anniversaires', desc: ['1h de Bowling', '1 partie Laser Game'], price: 26, type: 'per_pax', minPax: 6, oldPrice: 34, noHolidays: false, hasBowling: true, bowlingDur: 1, notes: [] }],
    activities: ACTIVITIES.map((a) => ({ ...a })),
    center: {
      id: 'libramont', status: 'active',
      defaultSchedule: { regular: { 6: { open: '10:00', close: '24:00' } }, holiday: {} },
      holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] },
      offerAvailability: {},
      day: { date: DATE, open: true, schedule: { open: 10, close: 24, label: '10h - Minuit' }, closedLabel: '', closedWindows: [], unavailableFormulaIds: [], unavailableActivityIds: [], unavailableFormulaReason: {} },
    },
  };
}

// La page hote : un site de centre, en-tete colle, le script d embed a sa place.
const HOST_HTML = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;font-family:sans-serif}header{position:sticky;top:0;height:56px;background:#1b1b2f}main{padding:12px}footer{height:400px}</style></head><body><header></header><main><h1>Réservez</h1><script src="${BASE_URL}/embed.js" data-center="libramont"></script></main><footer></footer>
<script>window.__ecrans = 0; window.__hauteurs = []; addEventListener('message', function (e) { if (!e.data) return; if (e.data.type === 'pinlane:screen') window.__ecrans += 1; if (e.data.type === 'pinlane:height') window.__hauteurs.push(Number(e.data.height)); });</script></body></html>`;

function serveStatic() {
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    const json = (status, payload) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(payload)); };
    if (url.pathname === '/host.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(HOST_HTML); return; }
    if (url.pathname === '/api/public-booking-meta') return json(200, metaPayload());
    if (url.pathname.startsWith('/api/')) return json(200, { ok: true, slots: [], suggestions: [] });
    let p = decodeURIComponent(url.pathname);
    if (p === '/' || p === '/reserver' || p.startsWith('/reserver/')) p = '/index.html';
    const filePath = path.resolve(path.join(ROOT, p));
    if (!filePath.startsWith(path.resolve(ROOT))) { res.writeHead(403); res.end(); return; }
    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(content);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

async function settle(frame, ms = 350) {
  await frame.waitForTimeout(ms);
  await frame.waitForFunction(() => document.getAnimations({ subtree: true }).filter((a) => a.playState === 'running').length === 0, null, { timeout: 2500 }).catch(() => {});
}

async function bootVenue(page, { embed = false } = {}) {
  await page.goto(`${BASE_URL}/${embed ? 'host.html' : `reserver/libramont?v=mv2-${embed ? 'e' : 's'}`}`, { waitUntil: 'networkidle', timeout: 45000 });
  const frame = embed ? page.frames().find((f) => f !== page.mainFrame()) : page.mainFrame();
  await frame.waitForFunction(() => typeof window.goStep === 'function' && document.querySelectorAll('#clientView .activity-card').length >= 8, null, { timeout: 20000 });
  await frame.evaluate((date) => {
    const fd = document.getElementById('fDate');
    fd.value = date;
    fd.dispatchEvent(new Event('change', { bubbles: true }));
  }, DATE);
  await settle(frame);
  return frame;
}

async function tap(frame, selector) {
  const loc = frame.locator(selector).first();
  await loc.scrollIntoViewIfNeeded({ timeout: 3000 });
  await loc.click({ timeout: 4000 });
}

const MESURES = {
  venue: () => {
    const cta = document.getElementById('btnVenueContinue');
    const stepper = document.querySelector('#clientView .pax-stepper');
    const c = cta.getBoundingClientRect(); const s = stepper.getBoundingClientRect();
    const chevauche = Math.max(0, Math.min(c.bottom, s.bottom) - Math.max(c.top, s.top)) > 0 && Math.max(0, Math.min(c.right, s.right) - Math.max(c.left, s.left)) > 0;
    return { focusPax: document.activeElement === document.getElementById('fPax'), position: getComputedStyle(cta).position, ctaSousStepper: c.top >= s.bottom - 1, chevauche, coarse: matchMedia('(pointer: coarse)').matches };
  },
  date: () => {
    const input = document.getElementById('fDate');
    const trigger = document.querySelector('#clientView .date-picker-trigger');
    const r = input.getBoundingClientRect();
    const hit = document.elementFromPoint(r.right - 22, r.top + r.height / 2);
    return { triggerAffiche: Boolean(trigger) && getComputedStyle(trigger).display !== 'none', hitEstLeChamp: hit === input };
  },
  activites: () => {
    const scroller = document.querySelector('#clientView .s1-scroller');
    const cards = [...document.querySelectorAll('#clientView .activity-card')];
    const sr = scroller.getBoundingClientRect();
    const foot = document.querySelector('#step1 .step-foot');
    const fr = foot.getBoundingClientRect();
    const dansLaVue = cards.filter((c) => { const r = c.getBoundingClientRect(); return r.top >= sr.top - 1 && r.bottom <= sr.bottom + 1 && r.bottom <= fr.top + 1; }).length;
    const dock = document.getElementById('stepStatusDock');
    const under = document.querySelector('#clientView .tunnel-underbar');
    const question = document.querySelector('#clientView .s1-what-head .panel-title');
    return {
      cartes: cards.length, dansLaVue, defileNecessaire: scroller.scrollHeight > scroller.clientHeight + 1,
      dockVivant: Boolean(dock && dock.classList.contains('is-live')), dockTexte: dock ? dock.textContent.trim().slice(0, 60) : '',
      sousBarreVisible: Boolean(under) && getComputedStyle(under).display !== 'none',
      questionPx: question ? parseFloat(getComputedStyle(question).fontSize) : 0,
      hauteurCarte: Math.round(cards[0].getBoundingClientRect().height),
    };
  },
  panier: () => (typeof getChosenActivities === 'function' ? getChosenActivities().map((a) => a.id) : []),
  options: () => {
    const dock = document.getElementById('stepStatusDock');
    return { surOptions: document.getElementById('step1').classList.contains('is-options'), dockVivant: Boolean(dock && dock.classList.contains('is-live')), dockTexte: dock ? dock.textContent.trim().slice(0, 80) : '' };
  },
  embarque: () => {
    const body = document.body;
    const stepBody = document.querySelector('#clientView .step.is-current .step-body');
    return {
      classe: body.classList.contains('embed-mode'),
      bodyAuto: Math.abs(body.getBoundingClientRect().height - window.innerHeight) > 2 || getComputedStyle(body).height !== `${window.innerHeight}px`,
      bodyH: Math.round(body.getBoundingClientRect().height), vh: window.innerHeight,
      defileDedans: Boolean(stepBody) && stepBody.scrollHeight > stepBody.clientHeight + 1,
    };
  },
};

async function scenarios(engineName, browser, descriptor) {
  const ctx = await browser.newContext({ ...descriptor, locale: 'fr-BE', colorScheme: 'light' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`  [pageerror ${engineName}] ${e.message.split('\n')[0]}`));
  const tag = (id) => `${engineName}:${id}`;

  // --- A. montage ---
  const frame = await bootVenue(page);
  ok(true, tag('montage : tunnel boote avec 8 activites'));

  // --- B. venue : question du groupe, pas de focus, CTA en flux sous le compteur ---
  await tap(frame, '#btnVenueContinue');
  await settle(frame);
  let v = await frame.evaluate(MESURES.venue);
  ok(v.coarse, tag('emulation : pointeur grossier'), JSON.stringify(v));
  ok(!v.focusPax, tag('venue : aucun focus programmatique au doigt (pas de clavier a l arrivee)'));
  ok(v.position === 'static', tag('venue : le CTA est en flux (position static)'), v.position);
  ok(v.ctaSousStepper && !v.chevauche, tag('venue : le CTA reste SOUS le compteur'), JSON.stringify(v));
  const vp = page.viewportSize();
  await frame.evaluate(() => document.getElementById('fPax').focus());
  await page.setViewportSize({ width: vp.width, height: Math.max(260, vp.height - 300) });
  await settle(frame, 250);
  v = await frame.evaluate(MESURES.venue);
  ok(v.ctaSousStepper && !v.chevauche, tag('venue + clavier (ecran retreci) : le CTA ne monte pas sur le compteur'), JSON.stringify(v));
  await page.setViewportSize(vp);
  await frame.evaluate(() => document.activeElement && document.activeElement.blur());
  await settle(frame, 200);

  // --- C. date : retour a la question du jour ---
  await tap(frame, '#mTopBack');
  await settle(frame);
  const d = await frame.evaluate(MESURES.date);
  ok(!d.triggerAffiche, tag('date : le bouton calendrier maison n existe pas au doigt'));
  ok(d.hitEstLeChamp, tag('date : le tap sur l icone touche le champ natif'), JSON.stringify(d));
  await tap(frame, '#btnVenueContinue');
  await settle(frame, 250);

  // --- D. activites ---
  await tap(frame, '#btnVenueContinue');
  await settle(frame);
  const a = await frame.evaluate(MESURES.activites);
  ok(a.cartes === 8 && a.dansLaVue === 8 && !a.defileNecessaire, tag('activites : les 8 cartes tiennent sans defiler'), JSON.stringify(a));
  ok(a.hauteurCarte <= 64, tag('activites : une carte fait au plus 64 px'), String(a.hauteurCarte));
  ok(!a.dockVivant, tag('activites : le dock se tait pour une allocation ordinaire'), a.dockTexte);
  ok(!a.sousBarreVisible, tag('activites : pas de sous-barre contacts sur cet ecran'));
  ok(a.questionPx > 0 && a.questionPx <= 22, tag('activites : la question tient sous 22 px'), String(a.questionPx));

  // --- E. panier ---
  await tap(frame, '.activity-card[data-activity="laser_game"] .activity-toggle');
  await tap(frame, '.activity-card[data-activity="minigolf_blacklight"] .activity-toggle');
  await settle(frame, 250);
  await tap(frame, '#segFormule');
  await settle(frame, 300);
  await tap(frame, '#segCarte');
  await settle(frame, 300);
  const panier = await frame.evaluate(MESURES.panier);
  ok(panier.length === 3 && panier.includes('laser_game') && panier.includes('minigolf_blacklight'), tag('panier : les 3 activites survivent a un tour par les formules'), panier.join(','));

  // --- F. options : 1 session de laser = pas un avertissement ---
  await tap(frame, '#btnStep1');
  await settle(frame);
  const o = await frame.evaluate(MESURES.options);
  ok(o.surOptions, tag('options : la page des reglages s ouvre'));
  ok(!o.dockVivant, tag('options : « 1 session de laser game » ne fait pas parler le dock'), o.dockTexte);
  await page.close();

  // --- G. embarque ---
  // CONTEXTE NEUF : la page hote partage l origine du tunnel (127.0.0.1:port),
  // donc le brouillon sauve par le scenario precedent (localStorage) aurait
  // fait booter le cadre directement sur les activites (mesure : 492 px, carte
  // venue a 0 px, « Continuer » invisible). Le client d un site arrive vierge.
  await ctx.close();
  const ctx2 = await browser.newContext({ ...descriptor, locale: 'fr-BE', colorScheme: 'light' });
  const host = await ctx2.newPage();
  const f2 = await bootVenue(host, { embed: true });
  await host.waitForFunction(() => window.__hauteurs.length > 0, null, { timeout: 10000 }).catch(() => {});
  const e0 = await f2.evaluate(MESURES.embarque);
  const h0 = await host.evaluate(() => ({ cadre: Math.round(document.querySelector('iframe').getBoundingClientRect().height), postees: window.__hauteurs.slice(), ecrans: window.__ecrans }));
  if (process.env.PINLANE_MOBILE_V2_DEBUG) {
    // Diagnostic : d ou vient la hauteur ? (chaque boite de la pile, dans l iframe)
    const pile = await f2.evaluate(() => ['header', 'main', '#clientView', '#clientView .tunnel-shell', '#clientView .tunnel-stage', '#clientView .tunnel-track', '#step1', '#step1 .step-body', '#step1 .s1-when', '#step1 .step-foot', '#clientView .m-topbar', '#clientView .tunnel-underbar', '#stepStatusDock', '#alertBox']
      .map((sel) => { const el = document.querySelector(sel); if (!el) return `${sel}:absent`; const c = getComputedStyle(el); return `${sel}:${Math.round(el.getBoundingClientRect().height)} (pos ${c.position}, min ${c.minHeight}, pad ${c.paddingTop}/${c.paddingBottom})`; }));
    console.log(`  [debug embarque ${engineName}] vh=${e0.vh} body=${e0.bodyH} postees=${h0.postees.join('>')}\n    ${pile.join('\n    ')}`);
  }
  ok(e0.classe, tag('embarque : body.embed-mode pose'));
  ok(e0.bodyAuto && !e0.defileDedans, tag('embarque : le corps prend la hauteur du contenu, rien ne defile dedans'), JSON.stringify(e0));
  ok(h0.cadre > 200 && h0.cadre < 480 && Math.abs(h0.cadre - e0.bodyH) <= 8, tag('embarque : le cadre suit le contenu (sous le plancher d avant)'), JSON.stringify(h0));
  await tap(f2, '#btnVenueContinue');
  await settle(f2, 300);
  await tap(f2, '#btnVenueContinue');
  await settle(f2, 500);
  await host.waitForFunction(() => window.__ecrans >= 1, null, { timeout: 5000 }).catch(() => {});
  const h1 = await host.evaluate(() => ({ cadre: Math.round(document.querySelector('iframe').getBoundingClientRect().height), ecrans: window.__ecrans }));
  const e1 = await f2.evaluate(MESURES.embarque);
  ok(h1.ecrans >= 1, tag('embarque : le changement d ecran est signale au site hote'), String(h1.ecrans));
  ok(h1.cadre > h0.cadre && !e1.defileDedans, tag('embarque : les activites font grandir le cadre, sans defilement interne'), JSON.stringify({ h0: h0.cadre, h1: h1.cadre, e1 }));
  await host.close();
  await ctx2.close();
}

// PINLANE_MOBILE_V2_ONLY=chromium|webkit : un seul moteur, sans contre-epreuves
// (diagnostic). PINLANE_MOBILE_V2_DEBUG=1 : la pile des hauteurs du cadre.
const ONLY = String(process.env.PINLANE_MOBILE_V2_ONLY || '');
async function runSuite() {
  const server = await serveStatic();
  try {
    if (ONLY !== 'webkit') {
      const chrome = await chromium.launch({ executablePath: BROWSER_PATH });
      try { await scenarios('chromium', chrome, devices['Pixel 7']); } finally { await chrome.close(); }
    }
    if (ONLY !== 'chromium') {
      const wk = await webkit.launch();
      try { await scenarios('webkit', wk, devices['iPhone 14']); } finally { await wk.close(); }
    }
  } finally { server.close(); }
}

const MUTATIONS = [
  { file: CSS, name: 'm1 : CTA venue remis en sticky', find: '#clientView .step1-body.is-solo .s1-continue { position: static; margin-top: var(--space-2); }', replace: '#clientView .step1-body.is-solo .s1-continue { position: sticky; bottom: 0; margin-top: var(--space-2); }', expect: 'venue : le CTA est en flux (position static)' },
  { file: APP, name: 'm2 : panier carte efface par les formules', find: 'if (Object.keys(panier).length) state.booking.carteActivities = panier;', replace: 'void panier; /* mutation gate */', expect: 'panier : les 3 activites survivent a un tour par les formules' },
  { file: CSS, name: 'm3 : body embarque remis a 100dvh', find: 'body.client-mode.embed-mode { height: auto; min-height: 0; overflow: visible; display: block; }', replace: 'body.client-mode.embed-mode { min-height: 0; overflow: visible; display: block; }', expect: 'embarque : le corps prend la hauteur du contenu, rien ne defile dedans' },
  { file: APP, name: 'm4 : dock qui parle pour tout', find: "const paxPrevient = Boolean(pax && pax.querySelector('[data-prevenir=\"1\"]'));", replace: 'const paxPrevient = Boolean(pax); /* mutation gate */', expect: 'activites : le dock se tait pour une allocation ordinaire' },
];

async function main() {
  console.log('=== MOBILE V2 : gestes reels, deux moteurs ===');
  // MONTAGE : le parcours suppose un samedi a venir, seul jour ouvert du
  // catalogue factice ; une date passee ou un autre jour ferait mentir la suite.
  const jourSemaine = new Date(`${DATE}T12:00:00Z`).getUTCDay();
  ok(/^\d{4}-\d{2}-\d{2}$/.test(DATE) && DATE >= AUJOURDHUI && jourSemaine === 6, 'montage : la date du gate est un samedi a venir', `${DATE} (aujourd hui ${AUJOURDHUI}, jour ${jourSemaine})`);
  await runSuite();
  const nominal = failures.slice();
  if (nominal.length) {
    console.log(`\n${nominal.length} echec(s) en nominal : ${nominal.join(' | ')}`);
    process.exit(1);
  }
  if (ONLY) { console.log('\nNominal vert (un seul moteur, contre-epreuves sautees : diagnostic).'); process.exit(0); }
  console.log('\n=== CONTRE-EPREUVES PAR MUTATION ===');
  for (const m of MUTATIONS) {
    const avant = sha(m.file);
    const src = fs.readFileSync(m.file, 'utf8');
    if (!src.includes(m.find)) { console.log(`FAIL  ${m.name} : ancre introuvable`); failures.push(m.name); continue; }
    fs.writeFileSync(m.file, src.replace(m.find, m.replace));
    failures = [];
    let attrape = false;
    try {
      // Un seul moteur suffit pour la contre-epreuve (le nominal a couvert les deux).
      const server = await serveStatic();
      try {
        const chrome = await chromium.launch({ executablePath: BROWSER_PATH });
        try { await scenarios('chromium', chrome, devices['Pixel 7']); } catch (error) { console.log(`  (scenario interrompu : ${String(error.message).split('\n')[0]})`); } finally { await chrome.close(); }
      } finally { server.close(); }
      attrape = failures.some((id) => id.endsWith(m.expect));
    } finally {
      fs.writeFileSync(m.file, src);
    }
    failures = [];
    ok(attrape, `${m.name} : le gate rougit sur « ${m.expect} »`);
    ok(sha(m.file) === avant, `${m.name} : fichier restaure a l identique (hash)`);
  }
  console.log(failures.length ? `\n${failures.length} echec(s)` : '\nTous les controles passent (nominal + 4 contre-epreuves).');
  process.exit(failures.length ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });

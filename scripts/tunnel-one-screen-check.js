// UNE ETAPE = UN ECRAN, et pas au prix de l'information.
//
// Objectif pose par Movsar (2026-08-15) : « eviter le plus de devoir scroller
// vers le bas, genre de tout voir d'une traite ». Ce gate mesure la hauteur
// REELLE de chaque etape dans un vrai navigateur, aux deux themes, sur les
// VIEWPORTS REELS : l'ancienne fenetre de 900 px de haut n'existe sur aucun
// laptop (1920x1080 + zoom systeme 125 % + chrome du navigateur = ~730 px
// utiles ; un petit laptop en donne ~610). C'est la que « une etape = un
// ecran » se prouve, en PIXELS, jamais sur un ratio arrondi.
//
// LES QUATRE PIEGES QU'IL REND IMPOSSIBLES :
//   1. tenir dans l'ecran en CACHANT de l'information : chaque activite choisie
//      par le client et chaque heure de la journee doivent rester dans le DOM ;
//   2. tenir dans l'ecran en RABOTANT : aucune cible tactile sous 44 px, aucun
//      texte du parcours sous 11,5 px ;
//   3. un defilement interne INVISIBLE : tout bloc qui defile en lui-meme doit
//      le dire (etat de debordement + boutons de deplacement) et rester
//      parcourable au clavier ;
//   4. une carte MUETTE au lecteur d'ecran : chaque bouton du parcours doit
//      porter un nom accessible non vide dans l'arbre d'accessibilite REEL
//      (CDP), pas seulement un texte visuel (bug attrape en prod le
//      2026-08-15 : les huit cartes d'activite rendaient « button » sans nom).
//
// LE BUDGET : sur ordinateur (1536x730 et 1280x610), CHAQUE etape tient dans
// UN ecran, comparaison en pixels. Sur telephone (390x844), les budgets sont
// etablis sur la mesure et le gate empeche qu'ils REMONTENT.
//
// Contre-epreuves par mutation : on rend une etape trop haute expres, et on
// rend les cartes muettes expres ; le gate rougit ; restauration inverse.
//
// Lancement : node scripts/tunnel-one-screen-check.js
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const database = require('../lib/database');

const CLIENT_CSS = path.join(ROOT, 'assets/pinlane-client.css');
const APP_JS = path.join(ROOT, 'assets/app-main.js');
const PORT = Number(process.env.PINLANE_ONESCREEN_PORT || 4215);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

function nextSaturday() {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).split('-').map(Number);
  const c = new Date(Date.UTC(y, m - 1, d));
  do { c.setUTCDate(c.getUTCDate() + 1); } while (c.getUTCDay() !== 6);
  return c.toISOString().slice(0, 10);
}
const DATE = nextSaturday();

// Aucun acces a la base : l'instantane est neutralise avant le chargement de
// l'API (le .env porte la production).
database.readAvailabilitySnapshot = async () => ({ reservations: [], laneStatuses: {}, blocks: [], date: DATE, centerId: 'libramont' });
const availability = require('../api/public-availability.js');

const ACTIVITIES = [
  { id: 'bowling', name: 'Bowling', planned: true, priceType: 'grid_bowling', priceValue: null, unitLabel: 'par piste', order: 1, defaultMinutes: 60 },
  { id: 'laser_game', name: 'Laser Game', planned: true, priceType: 'grid_laser', priceValue: null, unitLabel: 'par personne', order: 2, defaultMinutes: 22 },
  { id: 'minigolf_blacklight', name: 'Minigolf Blacklight', planned: false, priceType: 'per_pax', priceValue: null, unitLabel: 'par personne', note: '12 niveaux', order: 3, defaultMinutes: 45 },
  { id: 'billards', name: 'Billards', planned: false, priceType: 'per_unit_hour', priceValue: null, unitLabel: 'par table et par heure', order: 5, defaultMinutes: 60, minMinutes: 60, maxMinutes: 180, stepMinutes: 60 },
  { id: 'arcade_time', name: 'Arcades', planned: false, priceType: 'per_pax', priceValue: null, unitLabel: '', order: 6, defaultMinutes: 30 },
  { id: 'playground', name: 'Playground', planned: false, priceType: 'per_pax', priceValue: 12, unitLabel: 'par enfant', order: 7, defaultMinutes: 60 },
  { id: 'duckpin_bowling', name: 'Duckpin Bowling', planned: false, priceType: 'grid_bowling', priceValue: null, unitLabel: 'par piste', order: 8, defaultMinutes: 60 },
  { id: 'fun_run', name: 'Fun Run by PIXEL', planned: false, priceType: 'grid_fun_run', priceValue: null, unitLabel: 'par session', note: '5 joueurs max.', order: 9, defaultMinutes: 15 },
];

function metaPayload() {
  return {
    ok: true, today: DATE, durationOptions: [], formules: [], activities: ACTIVITIES,
    center: {
      id: 'libramont', status: 'active',
      defaultSchedule: { regular: { 0: { open: '10:00', close: '22:00' }, 1: null, 2: { open: '14:00', close: '22:00' }, 3: { open: '12:00', close: '22:00' }, 4: { open: '14:00', close: '22:00' }, 5: { open: '14:00', close: '24:00' }, 6: { open: '10:00', close: '24:00' } }, holiday: {} },
      holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] }, offerAvailability: {},
      day: { date: DATE, open: true, schedule: { open: 10, close: 24, label: '10h - Minuit' }, closedLabel: '', closedWindows: [], unavailableFormulaIds: [], unavailableActivityIds: [], unavailableFormulaReason: {} },
    },
  };
}

function serveStatic() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, BASE_URL);
    if (url.pathname === '/api/public-booking-meta') { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(metaPayload())); return; }
    if (url.pathname === '/api/public-availability') { try { await availability(req, res); } catch (error) { res.writeHead(500); res.end(JSON.stringify({ ok: false })); } return; }
    if (url.pathname === '/api/public-reservations') { let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => { res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: true, reservation: { id: 1 }, ops: {}, communications: [], warnings: [] })); }); return; }
    let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname === '/') filePath = path.join(ROOT, 'index.html');
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(content);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

let failures = 0;
function ok(cond, label) { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`); if (!cond) failures += 1; return cond; }

// Hauteur reelle de la page, cibles trop petites, textes trop petits, et blocs
// qui defilent sans le dire.
const MEASURE = () => {
  const root = document.scrollingElement || document.documentElement;
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  // SCENE HORIZONTALE (2026-08-17) : l'etape courante porte .is-current, les
  // autres sont inertes et hors champ. On ne mesure que l'ecran affiche.
  const step = document.querySelector('#clientView .step.is-current');
  const scope = step || document;
  const smallTargets = [...scope.querySelectorAll('button, input, textarea, select, summary, [role="button"]')]
    .filter(visible)
    .filter((el) => {
      if (el.getBoundingClientRect().height >= 44) return false;
      // Une case a cocher dans une etiquette cliquable : la CIBLE est
      // l'etiquette, c'est elle qu'on mesure.
      const label = el.closest('label');
      return !(label && label.getBoundingClientRect().height >= 44);
    })
    .map((el) => `${el.id || (el.className || el.tagName).toString().split(' ')[0] || el.tagName}:${Math.round(el.getBoundingClientRect().height)}`);
  const smallText = [...scope.querySelectorAll('*')]
    .filter((el) => visible(el) && el.children.length === 0 && (el.textContent || '').trim().length > 2)
    .map((el) => `${(el.className || el.tagName).toString().split(' ')[0]}:${Math.round(parseFloat(getComputedStyle(el).fontSize) * 10) / 10}`)
    .filter((entry) => parseFloat(entry.split(':')[1]) < 11.5);
  // Tout bloc qui defile en lui-meme doit le DIRE.
  const silentScrollers = [...scope.querySelectorAll('*')]
    .filter((el) => visible(el) && el.scrollWidth > el.clientWidth + 4 && ['auto', 'scroll'].includes(getComputedStyle(el).overflowX))
    .filter((el) => !el.dataset.overflow || el.dataset.overflow === 'none')
    .map((el) => (el.className || el.tagName).toString().split(' ')[0]);
  // DEFILEMENT VERTICAL : en zero-scroll de page, seules les zones ASSUMEES
  // (scrollbar fine visible, jamais masquee) ont le droit de rouler dans leur
  // boite. Tout AUTRE bloc qui coupe son contenu verticalement est un
  // mensonge d'ecran : de l'information disparait sans aucun signal.
  const ALLOWED_V_SCROLL = ['s1-scroller', 's2-slots', 's3-extra', 'recap-list-scroll'];
  const hiddenClippers = [...scope.querySelectorAll('*')]
    .filter((el) => visible(el) && el.scrollHeight > el.clientHeight + 4)
    .filter((el) => !['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
    .filter((el) => {
      const style = getComputedStyle(el);
      const scrolls = ['auto', 'scroll'].includes(style.overflowY);
      const allowed = ALLOWED_V_SCROLL.some((cls) => el.classList.contains(cls)) || el.id === 'recapList' || el.id === 'slotList';
      if (scrolls && allowed) return false;           // scroller assume
      if (!scrolls && style.overflowY === 'visible') return false; // deborde vers le parent, mesure la-bas
      return true;                                    // coupe ou roule sans droit
    })
    .map((el) => (el.className || el.tagName).toString().split(' ')[0]);
  // LA DECISION NE QUITTE JAMAIS L'ECRAN : le pied de l'etape courante (CTA
  // principal, ou le retour quand la decision est un clic de carte, ou les
  // actions du recapitulatif) est ENTIEREMENT dans la fenetre.
  // Premier candidat REELLEMENT peint (display:none passe :not([hidden]) :
  // le bouton d'ouverture masque en duo capturait le poste de decision).
  const footCandidates = scope.querySelectorAll
    ? [...scope.querySelectorAll('.s1-continue, .step-foot .btn-primary, .step-actions .btn-primary, .step-foot .btn-secondary, .success-wrap .btn-secondary')]
    : [];
  // REFONTE MOBILE 2026-08-18 (invariant recale, documente) : sous 640 px le
  // retour vit dans la BARRE HAUTE (.m-top-back), et le pied de l etape
  // creneau simple a disparu (la decision est le tap d une carte d heure).
  // Quand l etape ne peint aucun candidat, la barre haute est la decision de
  // repli : elle doit etre entierement visible, comme le pied avant elle.
  const foot = footCandidates.find((el) => el.getBoundingClientRect().height > 0)
    || document.querySelector('.m-topbar .m-top-back:not([hidden])')
    || null;
  const footRect = foot ? foot.getBoundingClientRect() : null;
  const footVisible = Boolean(footRect && footRect.height > 0 && footRect.bottom <= root.clientHeight + 1 && footRect.top >= 0);
  // LARGEUR REELLEMENT UTILISEE par la coquille du tunnel. Mesure du
  // 2026-08-15 : sur 1920 px elle prenait 744 px, soit 39 % de l ecran, et le
  // contenu ne commencait qu a 756 px du bord. « tout est recroqueville [...]
  // ca fait trop serre » (Movsar).
  const wrap = document.querySelector('#clientView .tunnel-shell');
  const wrapWidth = wrap ? Math.round(wrap.getBoundingClientRect().width) : 0;
  // TRONCATURE REELLE : on retire le clamp le temps d une mesure et on compare
  // la hauteur naturelle a la hauteur affichee. Un `-webkit-line-clamp` qui
  // coupe ne se voit sur aucune autre metrique (scrollHeight reste egal).
  const clipped = [...scope.querySelectorAll('.activity-name, .activity-price, .activity-note, .formule-name, .formule-card-list li, .slot-card-time, .slot-card-end, .slot-card-tag, .slot-card-meta')]
    .filter(visible)
    .filter((el) => {
      const shown = el.getBoundingClientRect().height;
      const clamp = el.style.webkitLineClamp;
      const white = el.style.whiteSpace;
      el.style.webkitLineClamp = 'unset';
      el.style.whiteSpace = 'normal';
      const natural = el.getBoundingClientRect().height;
      el.style.webkitLineClamp = clamp;
      el.style.whiteSpace = white;
      return natural > shown + 1;
    })
    .map((el) => `${(el.className || el.tagName).toString().split(' ')[0]}:${(el.textContent || '').trim().slice(0, 18)}`);
  return {
    scrollHeight: Math.round(root.scrollHeight),
    clientHeight: Math.round(root.clientHeight),
    wrapWidth,
    wrapShare: root.clientWidth ? Math.round((wrapWidth / root.clientWidth) * 100) : 0,
    clipped,
    fits: root.scrollHeight <= root.clientHeight,
    screens: Math.round((root.scrollHeight / root.clientHeight) * 100) / 100,
    hScroll: root.scrollWidth > root.clientWidth,
    smallTargets,
    smallTextCount: smallText.length,
    smallText: [...new Set(smallText)].slice(0, 8),
    silentScrollers,
    hiddenClippers: [...new Set(hiddenClippers)],
    footVisible,
    chipsInDom: document.querySelectorAll('.anchor-chip').length,
    freeActivities: [...document.querySelectorAll('.anchor-free-item')].map((el) => el.textContent.replace(/\s+/g, ' ').trim().split('réglé')[0].trim()),
    activityCards: document.querySelectorAll('#activityPicker .activity-card').length,
  };
};

// L'arbre d'accessibilite REEL (CDP), pas une heuristique : c'est ce que recoit
// un lecteur d'ecran. Un bouton visible sans nom est un bouton qu'on ne peut
// pas actionner sans voir.
async function unnamedButtons(session) {
  const { nodes } = await session.send('Accessibility.getFullAXTree');
  return nodes
    .filter((node) => node.role?.value === 'button' && !node.ignored)
    .filter((node) => !(node.name?.value || '').trim()).length;
}

async function settle(page) {
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
  await page.waitForTimeout(80);
}

async function walkTunnel(page, session, viewport, theme) {
  const out = {};
  const ax = { total: 0 };
  const sweep = async () => { if (session) ax.total += await unnamedButtons(session); };
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto(`${BASE_URL}/?v=one-${viewport.width}-${theme}-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForFunction(() => typeof window.setView === 'function' && typeof window.goStep === 'function', null, { timeout: 15000 });
  await page.evaluate((t) => { document.documentElement.setAttribute('data-theme', t); }, theme);
  await page.evaluate((d) => {
    state.view = 'client'; state.booking.date = d; state.booking.pax = 8; state.booking.mode = 'carte';
    state.booking.venueConfirmed = true; // le geste d'ouverture, comme un client
    state.booking.activities = { bowling: { duration: 1 }, laser_game: { games: 2 }, minigolf_blacklight: {}, arcade_time: {}, billards: { units: 2, hours: 1.5 }, fun_run: {} };
    setView('client'); applyChosenActivitiesToBooking(); syncBookingTypeUi();
    goStep(1, { animate: false, focus: false });
  }, DATE);
  await page.waitForTimeout(450);
  await settle(page);
  out.step1 = await page.evaluate(MEASURE);
  await sweep();

  await page.evaluate(() => goStep2());
  await page.waitForTimeout(1200);
  await settle(page);
  out.step2 = await page.evaluate(MEASURE);
  await sweep();

  await page.evaluate(() => { const i = getCurrentFormulaAnchorSlotIndex(); if (i >= 0) selectSlot(i); });
  await page.waitForTimeout(500);
  await settle(page);
  out.step3 = await page.evaluate(MEASURE);
  await sweep();

  await page.evaluate(() => {
    document.getElementById('fName').value = 'Marie Dupont';
    document.getElementById('fPhone').value = '+32 470 00 00 00';
    document.getElementById('fEmail').value = 'marie@email.com';
    goStep4();
  });
  await page.waitForTimeout(700);
  await settle(page);
  out.step4 = await page.evaluate(MEASURE);
  await sweep();

  await page.evaluate(async () => { await confirmBooking(); });
  await page.waitForTimeout(900);
  await settle(page);
  out.step5 = await page.evaluate(MEASURE);
  await sweep();
  out.unnamedButtons = ax.total;
  return out;
}

// LES VIEWPORTS REELS, et le budget EN ECRANS de chacun. 1 = tient dans la
// fenetre, comparaison en pixels.
//   - 1536x730 : laptop 1920x1080, zoom systeme 125 %, chrome du navigateur.
//     C'est l'ecran de Movsar : la reference du rejet du 2026-08-15 (l'etape 1
//     y faisait 1,96 ecran REEL pendant que le gate validait « un ecran » sur
//     une fenetre fictive de 900 px).
//   - 1280x610 : petit laptop apres zoom.
//   - 390x844 : telephone reel (iPhone 12-15). Les budgets telephone sont des
//     MESURES (panier de six activites, le plus lourd accepte), le gate
//     empeche qu'ils remontent ; l'ecart de +1,5 % absorbe la variation de
//     longueur des dates (« 22 août » vs « 26 septembre »).
// LARGEUR MINIMALE UTILISEE par palier. Le tunnel doit EXPLOITER l ecran :
// bride a min(1080px), il prenait 39 % d un 1920 et le contenu ne commencait
// qu a 756 px du bord. Au-dela du plafond (1750 px) la part baisse
// mecaniquement, et c est voulu : une coquille infinie ne sert plus personne,
// le plancher devient donc une largeur en pixels.
const VIEWPORTS = [
  // SCENE HORIZONTALE (2026-08-17) : le budget est 1 PARTOUT, telephone
  // compris : la page ne defile jamais, ce qui est long roule dans sa zone
  // assumee. Les anciens budgets telephone (3,05 / 2,2 / 1,73 / 1,8) sont
  // ABAISSES, jamais releves : c'est le sens unique impose par ce gate.
  // LARGEUR IDEALE (2026-08-18, Movsar : « pas obligé de prendre tout
  // l espace, juste espace ideal ») : la coquille plafonne a 1280 px et se
  // centre. Le plancher (minWidth) empeche un retour en douce a l'etroit ;
  // le plafond (maxWidth) empeche le retour au plein ecran. Telephone :
  // toute la largeur, comme avant.
  { width: 1536, height: 730, minWidth: 1150, maxWidth: 1300, budgets: { step1: 1, step2: 1, step3: 1, step4: 1, step5: 1 } },
  { width: 1280, height: 610, minWidth: 1100, maxWidth: 1300, budgets: { step1: 1, step2: 1, step3: 1, step4: 1, step5: 1 } },
  { width: 1920, height: 900, minWidth: 1150, maxWidth: 1300, budgets: { step1: 1, step2: 1, step3: 1, step4: 1, step5: 1 } },
  { width: 2560, height: 1300, minWidth: 1150, maxWidth: 1300, budgets: { step1: 1, step2: 1, step3: 1, step4: 1, step5: 1 } },
  { width: 390, height: 844, minShare: 92, budgets: { step1: 1, step2: 1, step3: 1, step4: 1, step5: 1 } },
  // TELEPHONE REEL AVEC LE CHROME DU NAVIGATEUR (2026-08-18, verdict de
  // Movsar sur son iPhone) : Safari mange ~180 px (barre URL + barre basse),
  // il reste ~664 px utiles. C'est la hauteur ou le panneau venue etouffait
  // les activites : valider a 844 seulement etait la meme erreur que la
  // fenetre fictive de 900 px du 2026-08-15.
  { width: 390, height: 664, minShare: 92, budgets: { step1: 1, step2: 1, step3: 1, step4: 1, step5: 1 } },
];

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1536, height: 730 } });
  const session = await page.context().newCDPSession(page);
  await session.send('Accessibility.enable');
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  const measured = {};
  try {
    for (const viewport of VIEWPORTS) {
      for (const theme of ['light', 'dark']) {
        console.log(`\n[${viewport.width}x${viewport.height} px / ${theme}]`);
        const walk = await walkTunnel(page, session, viewport, theme);
        measured[`${viewport.width}-${theme}`] = walk;
        ['step1', 'step2', 'step3', 'step4', 'step5'].forEach((stepKey) => {
          const m = walk[stepKey];
          const budget = viewport.budgets[stepKey];
          // Comparaison en PIXELS, jamais sur le ratio arrondi : 904 px pour une
          // fenetre de 900 donnait « 1 ecran » et passait, alors que la page
          // defilait bel et bien de 4 px.
          ok(m.scrollHeight <= Math.round(m.clientHeight * budget),
            `${stepKey} : ${m.scrollHeight} px, ${m.screens} ecran(s) pour un budget de ${budget}${budget === 1 ? ' (tient dans la fenetre)' : ''}`);
          ok(!m.hScroll, `${stepKey} : aucun debordement horizontal de la page`);
          ok(m.footVisible, `${stepKey} : la decision (CTA du pied d ecran) est entierement visible`);
          ok(m.hiddenClippers.length === 0, `${stepKey} : aucun contenu coupe sans zone de defilement assumee${m.hiddenClippers.length ? ` (${m.hiddenClippers.join(', ')})` : ''}`);
          ok(m.smallTargets.length === 0, `${stepKey} : aucune cible sous 44 px${m.smallTargets.length ? ` (${m.smallTargets.join(', ')})` : ''}`);
          ok(m.smallTextCount === 0, `${stepKey} : aucun texte sous 11,5 px (${m.smallTextCount}${m.smallTextCount ? ' : ' + m.smallText.join(', ') : ''})`);
          ok(m.silentScrollers.length === 0, `${stepKey} : aucun defilement interne muet${m.silentScrollers.length ? ` (${m.silentScrollers.join(', ')})` : ''}`);
        });
        ok(walk.unnamedButtons === 0,
          `lecteur d ecran : aucun bouton sans nom accessible sur les 5 etapes (${walk.unnamedButtons})`);
        // LA LARGEUR IDEALE : ni etriquee, ni plein ecran. Mesuree sur
        // l etape 1, la plus large.
        const shell = walk.step1;
        if (viewport.minWidth) {
          ok(shell.wrapWidth >= viewport.minWidth && shell.wrapWidth <= viewport.maxWidth,
            `largeur : la coquille fait ${shell.wrapWidth} px (fenetre ideale ${viewport.minWidth}-${viewport.maxWidth} px)`);
        } else {
          ok(shell.wrapShare >= viewport.minShare,
            `largeur : la coquille prend ${shell.wrapShare} % de l ecran (${shell.wrapWidth} px, plancher ${viewport.minShare} %)`);
        }
        // ELARGIR N EST PAS ROGNER : aucun libelle coupe, a aucun palier.
        ['step1', 'step2', 'step4'].forEach((stepKey) => {
          const m = walk[stepKey];
          ok(m.clipped.length === 0,
            `${stepKey} : aucun libelle tronque (${m.clipped.length}${m.clipped.length ? ' : ' + m.clipped.slice(0, 3).join(' | ') : ''})`);
        });
      }
    }

    // --- L'INFORMATION N'A PAS ETE SACRIFIEE A LA HAUTEUR --------------------
    console.log('\n[Rien n a ete cache pour tenir dans l ecran]');
    const desktop = measured['1536-light'];
    ok(desktop.step1.activityCards === 8, `etape 1 : les 8 activites du centre sont proposees (${desktop.step1.activityCards})`);
    ok(desktop.step2.chipsInDom === 53, `etape creneau : les 53 heures du jour restent dans le DOM (${desktop.step2.chipsInDom})`);
    // Les activites SANS creneau choisies par le client sont nommees a l'etape
    // creneau. C'est le defaut que Movsar a photographie : sa visite y etait
    // amputee de quatre activites sur six.
    ['Minigolf Blacklight', 'Billards', 'Arcades', 'Fun Run by PIXEL'].forEach((label) => {
      ok(desktop.step2.freeActivities.some((entry) => entry.startsWith(label)),
        `etape creneau : « ${label} » est nommee (${desktop.step2.freeActivities.join(' | ') || 'aucune'})`);
    });
    ok(consoleErrors.length === 0, `aucune erreur console (${consoleErrors.length})`);

    // --- CONTRE-EPREUVES PAR MUTATION ---------------------------------------
    console.log('\n[Contre-epreuve par mutation : ce gate sait-il rougir ?]');
    const referenceViewport = VIEWPORTS[0];
    // LA SCENE, cassee expres : sans son verrou (flex + overflow hidden), les
    // cinq etapes reprennent leur hauteur naturelle et la page deborde -> le
    // budget « 1 ecran » doit rougir. C'est la mutation qui protege le contrat
    // central du zero-defilement.
    const css = fs.readFileSync(CLIENT_CSS, 'utf8');
    const stageAnchor = 'flex: 1; min-height: 0; overflow: hidden; /* verrou de scene : une etape = un ecran */';
    ok(css.split(stageAnchor).length - 1 === 1, 'ancre de mutation de scene unique');
    let mutatedHeight = null;
    let mutatedFits = null;
    try {
      fs.writeFileSync(CLIENT_CSS, css.replace(stageAnchor, ''));
      const walk = await walkTunnel(page, null, referenceViewport, 'light');
      mutatedHeight = walk.step1.scrollHeight;
      mutatedFits = walk.step1.fits;
    } finally {
      fs.writeFileSync(CLIENT_CSS, css);
    }
    ok(mutatedFits === false && mutatedHeight > referenceViewport.height,
      `scene deverrouillee : la page deborde (${mutatedHeight} px) -> le budget ROUGIRAIT`);
    const restored = await walkTunnel(page, null, referenceViewport, 'light');
    ok(restored.step1.fits === true,
      `restauration inverse : la scene retient un ecran (${restored.step1.scrollHeight} px)`);

    // LA LARGEUR, remise a l etroit expres : la coquille revient a un plafond
    // de 1080 px et le plancher de largeur doit rougir.
    const cssWide = fs.readFileSync(CLIENT_CSS, 'utf8');
    const wideAnchor = 'width: min(94vw, 1280px);';
    ok(cssWide.split(wideAnchor).length - 1 === 1, 'ancre de mutation de largeur unique');
    let narrow = null;
    try {
      fs.writeFileSync(CLIENT_CSS, cssWide.replace(wideAnchor, 'width: min(700px, 100%);'));
      const walk = await walkTunnel(page, null, referenceViewport, 'light');
      narrow = walk.step1;
    } finally {
      fs.writeFileSync(CLIENT_CSS, cssWide);
    }
    ok(narrow.wrapWidth < 1150,
      );
    const wideAgain = (await walkTunnel(page, null, referenceViewport, 'light')).step1;
    ok(wideAgain.wrapWidth >= referenceViewport.minWidth && wideAgain.wrapWidth <= referenceViewport.maxWidth,
      `restauration inverse : la coquille retrouve sa largeur ideale (${wideAgain.wrapWidth} px)`);

    // Les cartes muettes du 2026-08-15, reproduites expres : nom explicite
    // vide ET contenu retire de l'arbre (aria-hidden). Le balayage CDP doit
    // rougir, sinon il ne protege rien.
    const appJs = fs.readFileSync(APP_JS, 'utf8');
    const labelAnchor = "const hint = activityPriceHint(activity, pax);";
    const textAnchor = '<span class="activity-text">';
    ok(appJs.split(labelAnchor).length - 1 === 1 && appJs.split(textAnchor).length - 1 === 1,
      'ancres de mutation accessibilite uniques');
    let mutedButtons = null;
    try {
      fs.writeFileSync(APP_JS, appJs
        .replace(labelAnchor, 'return "";\n  const hint = activityPriceHint(activity, pax);')
        .replace(textAnchor, '<span class="activity-text" aria-hidden="true">'));
      const walk = await walkTunnel(page, session, referenceViewport, 'light');
      mutedButtons = walk.unnamedButtons;
    } finally {
      fs.writeFileSync(APP_JS, appJs);
    }
    ok(mutedButtons >= 8,
      `cartes rendues muettes expres : ${mutedButtons} boutons sans nom dans l arbre reel -> le balayage ROUGIRAIT`);
    const restoredAx = await walkTunnel(page, session, referenceViewport, 'light');
    ok(restoredAx.unnamedButtons === 0,
      `restauration inverse : plus aucun bouton muet (${restoredAx.unnamedButtons})`);
  } finally {
    await browser.close();
    server.close();
  }

  if (failures) {
    console.error(`\ntunnel-one-screen-check: FAIL ${failures} assertion(s)`);
    process.exit(1);
  }
  console.log('\ntunnel-one-screen-check: ALL OK - le tunnel tient dans son budget d ecrans sans rien cacher.');
}

main().catch((error) => { console.error(error); process.exit(1); });

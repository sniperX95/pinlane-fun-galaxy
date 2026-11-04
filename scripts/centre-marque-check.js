// LE CENTRE SE VOIT PARTOUT (Ansar, 2026-11-04, avant le lancement sur deux centres : entre le
// planning de Libramont et celui de Gembloux, « on remarque pas la diff », et « surtout sur la page
// reservation client »).
//
// [A] DANS LA CONSOLE, CHAQUE CENTRE SE RECONNAIT D UN COUP D OEIL. La barre du planning porte son
//     enseigne : le nom en toutes lettres, dans la typo d affiche, a sa couleur, sans aplat (le bloc
//     plein a ete refuse sur image). Lisible en theme sombre et en theme clair. L initiale du menu
//     suit, le titre de l onglet le dit. Deux centres, deux couleurs.
// [B] L ENSEIGNE NE CASSE PAS LA BARRE. De l ordinateur au telephone : le nom n est pas coupe, rien
//     ne deborde, le champ de recherche reste utilisable.
// [C] LA FENETRE DE RESERVATION DIT OU L ON RESERVE. C est la que se tromper de centre coute.
// [D] SANS CENTRE OUVERT, AUCUNE MARQUE. Jamais le premier de la liste a la place du bon.
// [E] LA PAGE CLIENT DIT LE CENTRE, TOUT LE TEMPS. A cote du logo sur la page, en tete du cadre dans
//     le site du client, jamais coupe, et dans le titre de l onglet. (Le recapitulatif et le recu :
//     scripts/fungalaxy-form-check.js, qui joue le parcours entier.)
//
// Tout est simule, sans reseau ni base. Les contre-preuves (--contre-preuves) servent le code
// mute en memoire : aucun fichier n est ecrit.
// Lancement : node scripts/centre-marque-check.js [--contre-preuves]

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_CENTRE_MARQUE_PORT || 4296);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webp': 'image/webp' };
const JOUR = '2026-11-21';
const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
const LF = String.fromCharCode(10);
const CENTRES = { libramont: 'Libramont', gembloux: 'Gembloux' };

const MUTATIONS = [
  { nom: 'le menu ne pose plus la marque', lettre: '[A]', fichier: 'assets/staff-menu.js', de: '    poserMarqueCentre();\n    root.innerHTML', vers: '    root.innerHTML' },
  { nom: 'tous les centres prennent la meme couleur', lettre: '[A]', fichier: 'assets/staff-menu.js', de: 'return TEINTES_CENTRE[somme % TEINTES_CENTRE.length];', vers: 'return TEINTES_CENTRE[0];' },
  { nom: 'le bloc plein revient', lettre: '[A]', fichier: 'assets/pinlane-planning-global.css', de: 'overflow: hidden; color: var(--centre-texte); font-family: Anton', vers: 'overflow: hidden; background: var(--centre-fond); color: var(--centre-encre); font-family: Anton' },
  { nom: 'l enseigne perd sa typo d affiche', lettre: '[A]', fichier: 'assets/pinlane-planning-global.css', de: 'font-family: Anton, Impact, "Arial Narrow", sans-serif; font-size: 27px;', vers: 'font-size: 27px;' },
  { nom: 'en theme clair, l enseigne garde sa couleur du sombre', lettre: '[A]', fichier: 'assets/pinlane-planning-global.css', de: "[data-theme='light'] .pb-centre { color: var(--centre-texte-clair); }", vers: '' },
  { nom: 'le nom se coupe dans la barre', lettre: '[B]', fichier: 'assets/pinlane-planning-global.css', de: 'display: block; max-width: 230px; padding: 0 6px 0 2px;', vers: 'display: block; max-width: 50px; padding: 0 6px 0 2px;' },
  { nom: 'quand la place manque, l enseigne reste en haut', lettre: '[B]', fichier: 'assets/pinlane-planning-global.css', de: '@container barre (max-width: 1040px) {\n  .pb-ligne > .pb-centre { display: none; }\n', vers: '@container barre (max-width: 1040px) {\n' },
  { nom: 'dans la rangee des chiffres, l enseigne disparait', lettre: '[B]', fichier: 'assets/pinlane-planning-global.css', de: '  .pb-leg { display: none; }\n  .pb-bande::before { content: var(--centre-nom, none);', vers: '  .pb-ligne > .pb-centre { display: none; }\n  .pb-bande::before { content: none;' },
  { nom: 'la fenetre de reservation perd le centre', lettre: '[C]', fichier: 'assets/app-main.js', de: '<span class="rs-centre">${escapeHtml(typeof window.staffCenterShortName === \'function\' ? window.staffCenterShortName() : \'\')}</span>', vers: '' },
  { nom: 'le premier centre de la liste prend la marque d un centre inconnu', lettre: '[D]', fichier: 'assets/staff-menu.js', de: 'return getMenuCenters().find(center => center.id === id) || null;', vers: 'return getMenuCenters().find(center => center.id === id) || getMenuCenters()[0] || null;' },
  { nom: 'la page client ne pose plus le centre', lettre: '[E]', fichier: 'assets/fungalaxy-booking.js', de: "$$('[data-centre-ville]').forEach(function (el) { el.textContent = villeCentre; });", vers: '' },
  { nom: 'dans le site du client, le centre disparait', lettre: '[E]', fichier: 'assets/fungalaxy-booking.css', de: '.fg.is-embed .fg-centre--cadre { display: block; min-height: calc(1.12em + 11px); }', vers: '' },
  { nom: 'dans le site du client, le formulaire saute quand le nom arrive', lettre: '[E]', fichier: 'assets/fungalaxy-booking.css', de: '.fg.is-embed .fg-centre--cadre { display: block; min-height: calc(1.12em + 11px); }', vers: '.fg.is-embed .fg-centre--cadre:not(:empty) { display: block; }' },
  { nom: 'au telephone, le nom se coupe a cote du logo', lettre: '[E]', fichier: 'assets/fungalaxy-booking.css', de: '.fg-top__gauche { flex: none; gap: 10px; }', vers: '.fg-top__gauche { flex: 0 1 170px; gap: 10px; }' },
];

const overrides = new Map();
const serveur = http.createServer((req, res) => {
  const url = new URL(req.url, BASE_URL);
  if (url.pathname === '/hote') {
    res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
    res.end(`<!doctype html><meta charset="utf-8"><body style="margin:0"><iframe src="/fungalaxy/${url.searchParams.get('c')}?embed=1" style="width:100%;height:760px;border:0"></iframe></body>`);
    return;
  }
  const page = /^\/fungalaxy\/[a-z-]+\/?$/.test(url.pathname);
  const rel = page ? 'fungalaxy.html' : url.pathname === '/' || url.pathname === '' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const type = MIME[path.extname(rel).toLowerCase()] || 'application/octet-stream';
  if (overrides.has(rel)) { res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(overrides.get(rel)); return; }
  const f = path.join(ROOT, rel);
  if (!f.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(f, (err, c) => { if (err) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(c); });
});

async function monter(page, centre) {
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await page.addInitScript(({ expiresAt, centre, JOUR }) => {
    const perms = ['dashboard.view', 'planning.view', 'planning.bowling', 'planning.laser', 'reservations.view', 'reservations.create', 'reservations.quick', 'centers.switch', 'direction.view'];
    const session = { token: 'qa', cookieBacked: false, centerId: centre, expiresAt, member: { id: 'qa', name: 'QA', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };
    const ouvert = Object.fromEntries(['0', '1', '2', '3', '4', '5', '6'].map((j) => [j, { open: '10:00', close: '24:00' }]));
    const fiche = (id) => ({ id, name: `Fun Galaxy ${id === 'gembloux' ? 'Gembloux' : 'Libramont'}`, clientId: 'fun-galaxy', clientName: 'Fun Galaxy', status: 'active', timezone: 'Europe/Brussels', resources: { bowling: { laneCount: 8, normalCapacityPerLane: 6, emergencyCapacityPerLane: 7, forceExtraLaneAtPax: 8, preferAdjacentLanes: true }, laser: { weaponCount: 20, parallelLaunches: 1, canSplitGroupsCleanly: false, requiresCompleteGroupBeforeLaunch: true, riskLevel: 'critical' }, partyTables: null }, defaultSchedule: { regular: ouvert, holiday: {} }, activityAvailability: {}, holidaySettings: { enabled: false, overrides: [], formulaBlockedPeriods: [] }, offerAvailability: {}, classification: {}, customActivities: [] });
    const liste = [fiche('libramont'), fiche('gembloux')];
    const resas = (d) => [{ id: 9001, name: 'Dupont', phone: '+32470860011', email: 'a@x.test', date: d, startTime: '14:00', duration: 1, lanes: [1], status: 'confirmed', pax: 6, price: 39, type: 'bowling', label: 'Bowling', centerId: centre }];
    const pistes = () => Array.from({ length: 8 }).reduce((a, _, i) => { a[i + 1] = 'active'; return a; }, {});
    const J = (p) => { const s = JSON.stringify(p); let h = 0; for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0; return new Response(s, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', etag: `qa-${(h >>> 0).toString(36)}` } }); };
    const nf = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : (input && input.url) || '';
      const u = new URL(raw, window.location.origin);
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: perms }], members: [{ id: 'qa', name: 'QA', contact: 'q@x', roleId: 'direction', status: 'active', code: 'X', lastSeen: new Date().toISOString() }], events: [], permissions: perms } });
      if (u.pathname === '/api/staff-customer-notes') { const lot = u.searchParams.get('reservationIds'); const n = (id) => ({ eligible: true, clientKey: `p:${id}`, note: null }); if (lot !== null) return J({ ok: true, notesByReservationId: Object.fromEntries(lot.split(',').filter(Boolean).map((id) => [String(Number(id)), n(id)])) }); return J({ ok: true, ...n(u.searchParams.get('reservationId')) }); }
      if (u.pathname === '/api/staff-state') { const d = u.searchParams.get('date') || JOUR; return J({ ok: true, revision: `qa-${d}`, reservations: resas(d), laneStatuses: pistes(), centerId: centre }); }
      if (u.pathname === '/api/public-booking-meta') return J({ ok: true, today: JOUR, durationOptions: [], formules: [], center: null });
      if (u.pathname === '/api/admin-range') return J({ ok: true, reservations: resas(u.searchParams.get('startDate') || JOUR), emails: [], agentEvents: [], centerId: centre });
      if (u.pathname.startsWith('/api/')) return J({ ok: true, centers: liste, activities: [], communications: [], samples: [], suggestions: [], events: [], ecosystem: null, agents: [], activations: [], orchestration: {} });
      return nf(input, init);
    };
    window.__QA_RESAS__ = resas; window.__QA_PISTES__ = pistes;
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(session));
  }, { expiresAt, centre, JOUR });
}

// Rien ne sort : la typo d affiche retombe sur sa police de repli, plus large, donc le pire cas.
const sansReseau = (ctx) => ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());

async function ouvrirPlanning(browser, centre, largeur, hauteur = 820) {
  const ctx = await browser.newContext({ viewport: { width: largeur, height: hauteur } });
  await sansReseau(ctx);
  const page = await ctx.newPage();
  await monter(page, centre);
  await page.goto(`${BASE_URL}/?c=${centre}`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForFunction(() => typeof window.setView === 'function' && typeof window.loadStaffCenterConfig === 'function', null, { timeout: 20000 });
  await page.evaluate(async ({ centre, JOUR }) => {
    state.currentDate = JOUR; state.adminCenterId = centre; state.staffMenuPage = 'planning'; state.staffTheme = 'dark';
    state.reservations = window.__QA_RESAS__(JOUR); state.laneStatuses = window.__QA_PISTES__();
    setView('staff');
    while (staffCenterConfigCache.loading) { await new Promise((r) => setTimeout(r, 30)); }
    await loadStaffCenterConfig(true);
    renderStaff();
  }, { centre, JOUR });
  await page.waitForTimeout(500);
  return { ctx, page };
}

const lireMarque = (page) => page.evaluate(() => {
  const couleur = (e, prop) => (e ? getComputedStyle(e)[prop] : '');
  const haut = document.querySelector('#planningCentre');
  const rHaut = haut ? haut.getBoundingClientRect() : { width: 0, height: 0, left: 0, right: 0 };
  // Quand la place manque, l enseigne est le contenu genere de la rangee des chiffres.
  const bande = document.querySelector('#planningBande');
  const avant = bande ? getComputedStyle(bande, '::before') : null;
  const nomBande = avant && avant.content && avant.content !== 'none' ? avant.content.replace(/^"|"$/g, '') : '';
  const enHaut = rHaut.width > 0 && rHaut.height > 0;
  const p = haut;
  const gaucheBande = bande ? bande.getBoundingClientRect().left + parseFloat(getComputedStyle(bande).paddingLeft) : 0;
  const r = enHaut ? rHaut : { width: nomBande ? parseFloat(avant.width) || 0 : 0, height: nomBande ? parseFloat(avant.height) || 0 : 0, left: gaucheBande, right: gaucheBande + (parseFloat(avant && avant.width) || 0) };
  const chip = document.querySelector('.fgx-center-dot');
  const barre = document.querySelector('.pb-ligne');
  const rech = document.querySelector('#gfRecherche');
  return {
    nom: enHaut ? haut.textContent.trim() : nomBande,
    enHaut,
    visible: r.width > 0 && r.height > 0,
    coupe: enHaut ? haut.scrollWidth > haut.clientWidth + 1 : false,
    gauche: Math.round(r.left), droite: Math.round(r.right),
    fond: couleur(p, 'backgroundColor'), texte: enHaut ? couleur(p, 'color') : (avant ? avant.color : ''), police: enHaut ? couleur(p, 'fontFamily') : (avant ? avant.fontFamily : ''),
    page: couleur(document.querySelector('#planningBarre'), 'backgroundColor'),
    initiale: chip ? chip.textContent.trim() : '', fondInitiale: couleur(chip, 'backgroundColor'), encreInitiale: couleur(chip, 'color'),
    titre: document.title,
    deborde: barre ? barre.scrollWidth - barre.clientWidth : 0,
    recherche: rech ? Math.round(rech.getBoundingClientRect().width) : 0,
    debordePage: document.documentElement.scrollWidth - window.innerWidth,
  };
});
function luminance(rgb) {
  const m = String(rgb).match(/[\d.]+/g);
  if (!m) return 0;
  const [r, g, b] = m.slice(0, 3).map((v) => { const c = Number(v) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contraste = (a, b) => { const x = luminance(a); const y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const transparent = (c) => c === 'transparent' || /rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(String(c));

async function verifierConsole(browser, ok) {
  const couleurs = {};
  for (const [id, nom] of Object.entries(CENTRES)) {
    const { ctx, page } = await ouvrirPlanning(browser, id, 1366, 800);
    const m = await lireMarque(page);
    couleurs[id] = m.texte;
    ok(m.visible && m.nom === nom, `[A] ${nom} : la barre du planning porte son nom`, JSON.stringify(m.nom));
    ok(/^"?Anton/.test(m.police) && transparent(m.fond), `[A] ${nom} : une enseigne a la typo d affiche, sans aplat`, `${m.police} / ${m.fond}`);
    ok(contraste(m.texte, m.page) >= 4.5, `[A] ${nom} : l enseigne se lit en theme sombre`, `${contraste(m.texte, m.page).toFixed(1)}:1`);
    ok(m.initiale === nom.charAt(0) && !transparent(m.fondInitiale) && contraste(m.fondInitiale, m.encreInitiale) >= 4.5, `[A] ${nom} : l initiale du menu, sur sa couleur`, `${m.initiale} ${m.fondInitiale}`);
    ok(m.titre === `${nom} · Pinlane`, `[A] ${nom} : l onglet du navigateur le dit`, m.titre);
    await page.evaluate(() => { setStaffTheme('light'); });
    await page.waitForTimeout(250);
    const clair = await lireMarque(page);
    ok(clair.page !== m.page && contraste(clair.texte, clair.page) >= 4.5, `[A] ${nom} : l enseigne se lit en theme clair`, `${contraste(clair.texte, clair.page).toFixed(1)}:1 sur ${clair.page}`);
    await page.evaluate(() => { setStaffTheme('dark'); });
    await page.evaluate(() => { openQuickBook(); });
    const ouverte = await page.waitForFunction(() => document.querySelector('.qb-modal.rv.rs'), null, { timeout: 8000 }).then(() => true).catch(() => false);
    const fenetre = await page.evaluate(() => { const e = document.querySelector('.rs-tk-t .rs-centre'); const r = e ? e.getBoundingClientRect() : { width: 0 }; return { nom: e ? e.textContent.trim() : '', large: Math.round(r.width), texte: e ? getComputedStyle(e).color : '' }; });
    ok(ouverte && fenetre.nom === nom && fenetre.large > 0 && fenetre.texte === m.texte, `[C] ${nom} : la fenetre de reservation dit le centre, a sa couleur`, JSON.stringify(fenetre));
    await ctx.close();
  }
  ok(Boolean(couleurs.libramont) && couleurs.libramont !== couleurs.gembloux, '[A] deux centres, deux couleurs', JSON.stringify(couleurs));

  for (const largeur of [1180, 1024, 960, 820, 390]) {
    const { ctx, page } = await ouvrirPlanning(browser, 'gembloux', largeur, 800);
    const m = await lireMarque(page);
    ok(m.visible && m.nom === 'Gembloux' && !m.coupe && m.droite <= largeur, `[B] a ${largeur} px, le nom est entier et a l ecran`, `${m.nom} ${m.gauche}-${m.droite}`);
    ok(m.enHaut === (largeur >= 1180), `[B] a ${largeur} px, l enseigne est ${largeur >= 1180 ? 'en tete de barre' : 'dans la rangee des chiffres'}`, String(m.enHaut));
    ok(m.deborde <= 1 && m.debordePage <= 1, `[B] a ${largeur} px, rien ne deborde`, `barre ${m.deborde}, page ${m.debordePage}`);
    ok(m.recherche >= 120, `[B] a ${largeur} px, le champ de recherche reste utilisable`, `${m.recherche} px`);
    await ctx.close();
  }

  const { ctx, page } = await ouvrirPlanning(browser, 'centre-absent', 1366, 800);
  const m = await lireMarque(page);
  ok(!m.visible && m.titre === 'Pinlane', '[D] sans centre ouvert, aucune marque, pas celle du premier de la liste', JSON.stringify({ nom: m.nom, titre: m.titre }));
  await ctx.close();
}

async function brancherClient(ctx, retard = 0) {
  await sansReseau(ctx);
  await ctx.route('**/api/**', async (route) => {
    if (retard) await new Promise((r) => setTimeout(r, retard));
    const u = new URL(route.request().url());
    const id = u.searchParams.get('centerId') || 'libramont';
    const ville = CENTRES[id] || id;
    if (u.pathname !== '/api/public-booking-meta') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, today: JOUR, bookingHorizonDays: 365, durationOptions: [], formules: [], activities: [], center: { id, status: 'active', demonstration: false, name: `Fun Galaxy ${ville}`, city: ville, address: `Rue de l essai 1, 5000 ${ville}`, identity: {}, contact: { phone: '0470/00.00.00', email: 'qa@x.test' }, customRequest: { fromPax: 31 }, booking: {}, calendar: {} } }) });
  });
}

async function verifierClient(browser, ok) {
  for (const [id, nom] of Object.entries(CENTRES)) {
    for (const largeur of [1366, 390, 320]) {
      const ctx = await browser.newContext({ viewport: { width: largeur, height: 780 } });
      await brancherClient(ctx);
      const page = await ctx.newPage();
      await page.goto(`${BASE_URL}/fungalaxy/${id}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForFunction(() => { const e = document.querySelector('.fg-top .fg-centre'); return e && e.textContent; }, null, { timeout: 5000 }).catch(() => {});
      const m = await page.evaluate(() => {
        const e = document.querySelector('.fg-top .fg-centre');
        const logo = document.querySelector('.fg-top__logo').getBoundingClientRect();
        const r = e ? e.getBoundingClientRect() : { width: 0, height: 0, left: 0, right: 0, top: 0, bottom: 0 };
        const cta = document.querySelector('.fg-top__cta');
        const c = cta.getBoundingClientRect();
        return { nom: e ? e.textContent : '', visible: r.width > 0 && r.height > 0, coupe: e ? e.scrollWidth > e.clientWidth + 1 : false, droite: Math.round(r.right), aDroiteDuLogo: r.left >= logo.right, ctaGauche: c.width ? Math.round(c.left) : null, deborde: document.documentElement.scrollWidth - window.innerWidth, titre: document.title };
      });
      ok(m.visible && m.nom === nom && m.aDroiteDuLogo, `[E] ${nom} a ${largeur} px : le centre est a cote du logo`, JSON.stringify(m.nom));
      ok(!m.coupe && m.droite <= (m.ctaGauche === null ? largeur : m.ctaGauche) && m.deborde <= 1, `[E] ${nom} a ${largeur} px : le nom est entier, rien ne deborde`, `droite ${m.droite}, bouton ${m.ctaGauche}, debord ${m.deborde}`);
      if (largeur === 1366) ok(m.titre.includes(nom), `[E] ${nom} : l onglet du navigateur le dit`, m.titre);
      await ctx.close();
    }
  }
  // Le serveur repond lentement : le formulaire est deja la quand le nom arrive, et il ne doit pas sauter.
  const ctx = await browser.newContext({ viewport: { width: 900, height: 780 } });
  await brancherClient(ctx, 1200);
  const page = await ctx.newPage();
  await page.goto(`${BASE_URL}/hote?c=gembloux`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  // (la hauteur du nom, pas sa position : ce banc n a pas de vrai catalogue, et l alerte qui s ouvre au-dessus ne dit rien du nom)
  const hautDuFormulaire = () => page.evaluate(() => { const f = document.querySelector('iframe'); const d = f && f.contentDocument; const s = d && d.querySelector('.fg-centre--cadre'); return s && d.body.classList.contains('is-embed') ? Math.round(s.getBoundingClientRect().height) : null; });
  await page.waitForFunction(() => { const f = document.querySelector('iframe'); const d = f && f.contentDocument; return Boolean(d && d.body && d.body.classList.contains('is-embed') && d.querySelector('.fg-stage')); }, null, { timeout: 8000 }).catch(() => {});
  const avantNom = await page.evaluate(() => { const d = document.querySelector('iframe').contentDocument; const e = d.querySelector('.fg-centre--cadre'); return e ? e.textContent : '?'; });
  const hautAvant = await hautDuFormulaire();
  await page.waitForFunction(() => { const f = document.querySelector('iframe'); const d = f && f.contentDocument; const e = d && d.querySelector('.fg-centre--cadre'); return e && e.textContent; }, null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(200);
  const hautApres = await hautDuFormulaire();
  ok(avantNom === '' && hautAvant > 0 && hautAvant === hautApres, '[E] dans le site du client, le formulaire ne saute pas quand le nom arrive', `avant « ${avantNom} » ${hautAvant}, apres ${hautApres}`);
  const cadre = await page.evaluate(() => {
    const d = document.querySelector('iframe').contentDocument;
    const e = d.querySelector('.fg-centre--cadre');
    const r = e ? e.getBoundingClientRect() : { width: 0, height: 0, top: -1 };
    return { nom: e ? e.textContent : '', large: Math.round(r.width), haut: Math.round(r.top), bandeau: d.defaultView.getComputedStyle(d.querySelector('.fg-top')).display };
  });
  ok(cadre.nom === 'Gembloux' && cadre.large > 0 && cadre.haut >= 0 && cadre.bandeau === 'none', '[E] dans le site du client, le centre reste dit en tete du cadre', JSON.stringify(cadre));
  await ctx.close();
}

async function verifier(browser, ok) {
  await verifierConsole(browser, ok);
  await verifierClient(browser, ok);
}

(async () => {
  await new Promise((r, x) => { serveur.once('error', x); serveur.listen(PORT, '127.0.0.1', r); });
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  let code = 0;
  try {
    if (process.argv.includes('--contre-preuves')) {
      const seule = process.env.CENTRE_MARQUE_SEULE || '';
      for (const mut of MUTATIONS.filter((m) => m.nom.includes(seule))) {
        overrides.clear();
        const source = fs.readFileSync(path.join(ROOT, mut.fichier), 'utf8').split(CRLF).join(LF);
        if (source.split(mut.de).length !== 2) { console.log(`FAIL  ancre absente ou multiple : ${mut.nom}`); code = 1; continue; }
        overrides.set(mut.fichier, source.split(mut.de).join(mut.vers));
        const rouges = [];
        await verifier(browser, (cond, label) => { if (!cond) rouges.push(label); });
        const mord = rouges.some((l) => l.startsWith(mut.lettre));
        console.log(`${mord ? 'OK  ' : 'FAIL'}  contre-preuve : ${mut.nom} : ${rouges.length} rouge(s), ${rouges[0] || 'aucun'}`);
        if (!mord) code = 1;
      }
      overrides.clear();
    } else {
      let fautes = 0;
      await verifier(browser, (cond, label, detail = '') => { console.log(`${cond ? 'OK  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`); if (!cond) fautes += 1; });
      console.log(fautes ? `centre-marque-check : ${fautes} defaut(s).` : 'centre-marque-check : ALL OK');
      if (fautes) code = 1;
    }
  } finally {
    await browser.close();
    serveur.close();
  }
  process.exit(code);
})().catch((e) => { console.error(e); process.exit(1); });

'use strict';
// UNE ACTION DE LA CONSOLE VA AU CENTRE AFFICHE, JAMAIS AU CENTRE DE CONNEXION (Ansar, 2026-11-04 : « quon ai pas des
// interferance et des resa qui spawn a gembloux et pas a libra »). L audit du meme jour l a trouve : une direction connectee
// a Libramont qui regarde Gembloux fermait les pistes de Libramont, y creait ses lots et ses fermetures, et la console
// disait « c est fait ». Une session reste sur son centre de connexion : ce que la requete ne nomme pas tombe la.
//
//   [E] la vraie console, connectee a Libramont, montre Gembloux : chaque ecriture nomme Gembloux, sa lecture aussi ;
//   [S] ces memes corps, rejoues sur les vrais gestionnaires : chaque ecrivain recoit Gembloux, Libramont n est pas touche ;
//       une requete qui ne nomme rien va au centre de la session, jamais a Libramont par defaut ;
//   [R] une reservation ne change pas de centre par une modification ;
//   [M] un mail d equipe dit de quel centre il parle : les deux centres partagent une seule boite ;
//   [C] les contre-preuves : le code d avant, compile en memoire, fait rougir chacune de ces regles.
//
// Rien ne part : ni base, ni reseau, et le disque n est jamais ecrit.
// Lancement : node scripts/console-centre-check.js
for (const nom of Object.keys(process.env)) if (/^(PG|DATABASE|POSTGRES|RESEND|TWILIO)/i.test(nom)) delete process.env[nom];
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');
const B = require('./reserver-banc');

const ROOT = B.ROOT;
const PORT = Number(process.env.PINLANE_CONSOLE_CENTRE_PORT || 5293);
const BASE = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const VISIBLE = 'gembloux';
const CONNEXION = 'libramont';

let echecs = 0;
function ok(condition, message, detail) {
  if (condition) { console.log(`ok    ${message}`); return; }
  echecs += 1;
  console.log(`FAIL  ${message}${detail === undefined ? '' : `  ${(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 500)}`}`);
}

// LE CODE D AVANT, servi en memoire : une ligne d ecriture qui ne nomme plus de centre.
const AVANT_CONSOLE = [
  { vise: 'pisteBascule', fichier: 'assets/app-main.js', de: 'body: JSON.stringify({ centerId: getCurrentStaffCenterId(), lane: i, status: nextStatus })', vers: 'body: JSON.stringify({ lane: i, status: nextStatus })' },
  { vise: 'pisteMaintenance', fichier: 'assets/app-main.js', de: "body: JSON.stringify({ centerId: getCurrentStaffCenterId(), lane, status: 'maintenance',", vers: "body: JSON.stringify({ lane, status: 'maintenance'," },
  { vise: 'blocage', fichier: 'assets/app-main.js', de: "const body = { action: 'saveAvailabilityBlock', centerId: getCurrentStaffCenterId(), scopeType, recurrence };", vers: "const body = { action: 'saveAvailabilityBlock', scopeType, recurrence };" },
  { vise: 'suppression', fichier: 'assets/app-main.js', de: "JSON.stringify({ action: 'deleteAvailabilityBlock', centerId: getCurrentStaffCenterId(), id: Number(id) })", vers: "JSON.stringify({ action: 'deleteAvailabilityBlock', id: Number(id) })" },
  { vise: 'client', fichier: 'assets/app-main.js', de: '?client=${encodeURIComponent(chiffres)}&centerId=${encodeURIComponent(getCurrentStaffCenterId())}`', vers: '?client=${encodeURIComponent(chiffres)}`' },
  { vise: 'lot', fichier: 'assets/app-main.js', de: 'JSON.stringify({ centerId: (dossiers[0] && dossiers[0].centerId) || getCurrentStaffCenterId(), dossiers })', vers: 'JSON.stringify({ dossiers })' },
];
let servies = [];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const serveur = http.createServer((rq, rs) => {
  const u = new URL(rq.url, BASE);
  const rel = u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname.replace(/^\/+/, ''));
  const f = path.join(ROOT, rel);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { rs.writeHead(404); rs.end('absent'); return; }
  let contenu = fs.readFileSync(f);
  const editions = servies.filter((e) => e.fichier === rel);
  if (editions.length) {
    let texte = contenu.toString('utf8').split('\r\n').join('\n');
    for (const e of editions) {
      if (texte.split(e.de).length !== 2) throw new Error(`ancre absente ou multiple : ${e.de.slice(0, 70)}`);
      texte = texte.split(e.de).join(e.vers);
    }
    contenu = texte;
  }
  rs.writeHead(200, { 'Content-Type': TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  rs.end(contenu);
});

// La session est a Libramont ; tout le reste de l API repond sans rien faire, et note ce qu on lui envoie.
function doublures({ expiresAt, connexion }) {
  const perms = ['dashboard.view', 'planning.view', 'planning.bowling', 'planning.laser', 'planning.drag', 'reservations.view', 'reservations.create', 'reservations.edit', 'reservations.status', 'clients.view', 'settings.manage', 'direction.view', 'pricing.manage', 'centers.switch'];
  const session = { token: 'qa', cookieBacked: false, centerId: connexion, expiresAt, member: { id: `${connexion}:dir`, name: 'Direction' }, role: { id: 'director', name: 'Direction', locked: false }, permissions: perms };
  const ouvert = Object.fromEntries(['0', '1', '2', '3', '4', '5', '6'].map((j) => [j, { open: '10:00', close: '22:00' }]));
  const fiche = (id) => ({ id, name: `Fun Galaxy ${id}`, status: 'active', timezone: 'Europe/Brussels', resources: { bowling: { laneCount: 8, normalCapacityPerLane: 6 }, laser: { weaponCount: 20, parallelLaunches: 1 } }, activityAvailability: { bowling: true, laser_game: true }, defaultSchedule: { regular: ouvert, holiday: {} } });
  const J = (p) => new Response(JSON.stringify(p), { status: 200, headers: { 'content-type': 'application/json' } });
  const nf = window.fetch.bind(window);
  window.__envois = [];
  window.__listes = [];
  window.fetch = async (input, init = {}) => {
    const raw = typeof input === 'string' ? input : (input && input.url) || '';
    let u;
    try { u = new URL(raw, window.location.origin); } catch (e) { return nf(input, init); }
    if (!u.pathname.startsWith('/api/')) return nf(input, init);
    const methode = String(init.method || 'GET').toUpperCase();
    if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session });
    let corps = null;
    try { corps = init.body ? JSON.parse(init.body) : null; } catch (e) { corps = null; }
    if (methode !== 'GET') window.__envois.push({ chemin: u.pathname, methode, corps });
    if (u.searchParams.has('client')) window.__envois.push({ chemin: u.pathname, methode, client: true, centre: u.searchParams.get('centerId') });
    if (u.pathname === '/api/ops' && methode === 'GET') {
      const action = u.searchParams.get('action');
      if (action === 'centerConfig') return J({ ok: true, centers: [fiche(connexion), fiche('gembloux')], activities: [{ id: 'bowling', label: 'Bowling' }, { id: 'laser_game', label: 'Laser Game' }] });
      if (action === 'listAvailabilityBlocks') {
        window.__listes.push(u.searchParams.get('centerId'));
        return J({ ok: true, centerId: u.searchParams.get('centerId'), blocks: [{ id: 1, centerId: u.searchParams.get('centerId'), scopeType: 'center', scopeRef: null, recurrence: 'once', date: '2026-08-15', dayOfWeek: null, dateFrom: null, dateUntil: null, startMin: null, endMin: null, reason: '', createdBy: 'qa' }] });
      }
    }
    if (u.pathname.endsWith('/public-booking-meta')) return J({ ok: true, formules: [], durationOptions: [], center: null });
    return J({ ok: true, lane: { status: 'maintenance' }, block: { id: 9 }, removed: 1, client: null, reservations: [], laneStatuses: {}, communications: [] });
  };
  try { localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(session)); } catch (e) { /* le test le verra */ }
}

async function jouerConsole(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.on('dialog', (d) => { d.accept().catch(() => {}); });
  try {
    await page.addInitScript(doublures, { expiresAt: new Date(Date.now() + 86400000).toISOString(), connexion: CONNEXION });
    await page.goto(`${BASE}/?v=centre-${Date.now()}`, { waitUntil: 'load', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function' && typeof window.renderStaffUtilityPage === 'function' && typeof state !== 'undefined');
    // Le selecteur de centre change le navigateur, pas la session : c est exactement ce que fait ceci.
    await page.evaluate((c) => {
      if (typeof hasSavedAuth === 'function') hasSavedAuth();
      state.adminCenterId = c;
      state.currentDate = '2026-09-01';
      state.isHolidayMode = false;
      state.staffMenuPage = 'establishment';
      setView('staff');
    }, VISIBLE);
    await page.waitForSelector('.eb-pli-d .availability-blocks #avb-scope', { state: 'attached', timeout: 15000 });
    await page.evaluate(() => ebBasculerPli(document.querySelector('.availability-blocks').closest('.eb-blk'), true));
    await page.waitForSelector('.availability-blocks #avb-scope', { state: 'visible' });
    await page.waitForFunction(() => document.querySelectorAll('#avbList .availability-item').length >= 1);
    const envoi = (filtre) => page.evaluate((src) => { const f = eval(src); return window.__envois.filter(f).slice(-1)[0] || null; }, filtre);
    const attendreEnvoi = (filtre) => page.waitForFunction((src) => { const f = eval(src); return window.__envois.some(f); }, filtre, { timeout: 6000 }).catch(() => {});

    // Fermer le centre un jour, comme le gerant : la fenetre, le jour, Enregistrer.
    await page.selectOption('#avb-scope', 'center');
    await page.selectOption('#avb-recurrence', 'once');
    await page.fill('#avb-date', '2026-11-20');
    await page.click('#avbSubmit');
    const estBlocage = "(e) => e.corps && e.corps.action === 'saveAvailabilityBlock'";
    await attendreEnvoi(estBlocage);
    // Supprimer un blocage de la liste.
    await page.click('#avbList .availability-item[data-block-id="1"] .availability-del');
    const estSuppression = "(e) => e.corps && e.corps.action === 'deleteAvailabilityBlock'";
    await attendreEnvoi(estSuppression);
    // Les pistes, puis le client deja venu, puis un lot de deux reservations. La fenetre Reserver vit sur un etat que ses
    // propres gates pilotent ; ici seul importe ce qui part, donc « construire » rend une reservation faite.
    await page.evaluate(async () => {
      await toggleMaint(3);
      await submitLaneMaintForm(4);
      quickBookState = { phone: '0470111222' };
      await rvChercherClientConnu();
      quickBookState = null;
      window.rvConstruire = () => ({ reservation: { date: '2026-11-20', startTime: '20:00', type: 'bowling', pax: 4, name: 'Essai', phone: '0470111222', duration: 1, totalDuration: 1 }, requiredCount: 1, needsLanes: true });
      rvResas = [{ name: 'Essai', phone: '0470111222' }, { name: 'Essai', phone: '0470111222' }];
      quickBookState = rvResas[0];
      await rvCreerLeLot();
      rvResas = [];
      quickBookState = null;
    });
    return {
      montage: await page.evaluate(() => ({ visible: getCurrentStaffCenterId(), connexion: state.staffAuthSession && state.staffAuthSession.centerId })),
      listes: await page.evaluate(() => window.__listes.slice()),
      blocage: await envoi(estBlocage),
      suppression: await envoi(estSuppression),
      pisteBascule: await envoi("(e) => e.chemin === '/api/staff-lanes' && e.corps && e.corps.lane === 3"),
      pisteMaintenance: await envoi("(e) => e.chemin === '/api/staff-lanes' && e.corps && e.corps.lane === 4 && e.corps.status === 'maintenance'"),
      client: await envoi('(e) => e.client === true'),
      lot: await envoi("(e) => e.chemin === '/api/staff-reservations' && e.corps && Array.isArray(e.corps.dossiers)"),
    };
  } finally {
    await ctx.close();
  }
}
const nomme = {
  blocage: (c) => Boolean(c.blocage && c.blocage.corps.centerId === VISIBLE),
  suppression: (c) => Boolean(c.suppression && c.suppression.corps.centerId === VISIBLE),
  pisteBascule: (c) => Boolean(c.pisteBascule && c.pisteBascule.corps.centerId === VISIBLE),
  pisteMaintenance: (c) => Boolean(c.pisteMaintenance && c.pisteMaintenance.corps.centerId === VISIBLE),
  client: (c) => Boolean(c.client && c.client.centre === VISIBLE),
  lot: (c) => Boolean(c.lot && c.lot.corps.centerId === VISIBLE && c.lot.corps.dossiers.length === 2),
};
const LIBELLES = {
  blocage: 'fermer le centre un jour', suppression: 'supprimer un blocage', pisteBascule: 'fermer une piste', pisteMaintenance: 'programmer la maintenance d une piste', client: 'chercher un client deja venu', lot: 'creer un lot de deux reservations',
};

// LES VRAIS GESTIONNAIRES : les ecrivains sont doubles et notent le centre qu ils recoivent.
const session = (c) => ({ centerId: c, member: { id: 'm', name: 'Direction' }, role: { id: 'direction', locked: true }, permissions: [] });
function doubler(relatif, surcharge) {
  const chemin = require.resolve(path.join(ROOT, relatif));
  const reel = require(chemin);
  require.cache[chemin] = { id: chemin, filename: chemin, loaded: true, exports: { ...reel, ...surcharge } };
}
const vus = [];
function chargerEcrivains() {
  doubler('lib/database.js', { updateLaneStatus: async (lane, status, centerId) => { vus.push({ ecrit: 'piste', lane, status, centerId }); return { lane, status }; } });
  doubler('lib/availability-blocks.js', {
    upsertAvailabilityBlock: async (pool, entree) => { vus.push({ ecrit: 'blocage', centerId: entree.centerId }); return { id: 1 }; },
    deleteAvailabilityBlock: async (pool, entree) => { vus.push({ ecrit: 'suppression', centerId: entree.centerId, id: entree.id }); return { ok: true, removed: 1 }; },
    refreshAvailabilityBlocks: async () => ({}),
  });
}
const JOUR_RESA = B.JOUR;

async function serveurDit(capture) {
  const m = B.monter({ session: session(CONNEXION) });
  chargerEcrivains();
  const lanes = require(path.join(ROOT, 'api/staff-lanes.js'));
  const ops = require(path.join(ROOT, 'api/ops.js'));
  const ecrit = async (handler, methode, url, corps) => { vus.length = 0; const r = await B.appeler(handler, methode, url, corps); return { statut: r.statut, vus: vus.slice() }; };
  const seul = (r, type) => r.vus.length === 1 && r.vus[0].ecrit === type && r.vus[0].centerId === VISIBLE;

  const a = await ecrit(lanes, 'PATCH', '/api/staff-lanes', capture.pisteBascule.corps);
  ok(a.statut === 200 && seul(a, 'piste'), '[S] fermer une piste a Gembloux depuis une session de Libramont : la piste de Gembloux, et elle seule', a);
  const b = await ecrit(lanes, 'PATCH', '/api/staff-lanes', capture.pisteMaintenance.corps);
  ok(b.statut === 200 && seul(b, 'piste'), '[S] programmer la maintenance : a Gembloux', b);
  const c = await ecrit(ops, 'POST', '/api/ops', capture.blocage.corps);
  ok(c.statut === 200 && seul(c, 'blocage'), '[S] fermer le centre un jour : Gembloux est ferme, pas Libramont', c);
  const d = await ecrit(ops, 'POST', '/api/ops', capture.suppression.corps);
  ok(d.statut === 200 && seul(d, 'suppression'), '[S] supprimer un blocage : celui de Gembloux', d);

  B.semer([]);
  const corpsResa = (heure) => B.corpsStaff({ centerId: capture.lot.corps.centerId, type: 'bowling', pax: 4, startTime: heure, duration: 1, totalDuration: 1, lanes: [], laneCount: 1 });
  const lot = await m.appeler('POST', '/api/staff-reservations', { centerId: capture.lot.corps.centerId, dossiers: [corpsResa('20:00'), corpsResa('21:00')] });
  const centres = (lot.json.reservations || []).map((x) => x.reservation && x.reservation.centerId);
  ok(centres.length === 2 && centres.every((x) => x === VISIBLE), `[S] un lot de deux reservations : les deux a Gembloux (JOUR ${JOUR_RESA})`, { statut: lot.statut, centres, message: lot.json.message, echecs: lot.json.echecs });

  // Rien de nomme : le centre de la session, jamais Libramont par defaut.
  m.changerSession(session('gembloux'));
  const e = await ecrit(lanes, 'PATCH', '/api/staff-lanes', { lane: 3, status: 'maintenance' });
  ok(e.statut === 200 && seul(e, 'piste'), '[S] une session de Gembloux qui ne nomme aucun centre : sa piste, jamais celle de Libramont', e);
  // La vue « tous les centres » n est le centre de personne : elle ne ferme aucune piste.
  m.changerSession(session(CONNEXION));
  const f = await ecrit(lanes, 'PATCH', '/api/staff-lanes', { centerId: 'all', lane: 3, status: 'maintenance' });
  ok(f.statut === 422 && f.vus.length === 0, '[S] la vue de tous les centres ne ferme aucune piste', f);
}

// Une modification qui nomme un autre centre est refusee ; sur son centre, elle passe.
async function modification(mutations = []) {
  delete require.cache[require.resolve(path.join(ROOT, 'api/staff-reservations.js'))];
  const m = B.monter({ session: session(CONNEXION), mutations });
  const ligne = B.ligne(901, { center_id: CONNEXION, status: 'pending', name: 'Essai', phone: '0470111222', date: B.JOUR, type: 'bowling', pax: 4, lanes: [1], lane_count: 1 });
  B.semer([ligne]);
  const ailleurs = await m.appeler('PATCH', '/api/staff-reservations', { id: 901, centerId: VISIBLE, notes: 'par erreur' });
  const relu = await m.S.db.getReservationById(901);
  const temoin = await m.appeler('PATCH', '/api/staff-reservations', { ...relu, centerId: CONNEXION, requiresLanes: true, laneCount: 1, allowPastStart: true, baseUpdatedAt: relu && relu.updatedAt, name: 'Essai bis' });
  return { ailleurs: { statut: ailleurs.statut, message: ailleurs.json.message }, centre: relu && relu.centerId, temoin: { statut: temoin.statut, message: temoin.json.message, nom: temoin.json.reservation && temoin.json.reservation.name } };
}

(async () => {
  await new Promise((r) => serveur.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    const capture = await jouerConsole(browser);
    ok(capture.montage.visible === VISIBLE && capture.montage.connexion === CONNEXION, 'MONTAGE : connecte a Libramont, la console montre Gembloux', capture.montage);
    ok(capture.listes.length > 0 && capture.listes.every((c) => c === VISIBLE), '[E] la liste des blocages est lue a Gembloux : on supprime ce qu on voit', capture.listes);
    for (const cle of Object.keys(nomme)) ok(nomme[cle](capture), `[E] ${LIBELLES[cle]} : l envoi nomme Gembloux`, capture[cle]);

    await serveurDit(capture);

    const modif = await modification();
    ok(modif.ailleurs.statut === 422 && /reste dans son centre/.test(String(modif.ailleurs.message)) && modif.centre === CONNEXION, '[R] une reservation de Libramont ne passe pas a Gembloux par une modification', modif);
    ok(modif.temoin.statut < 300 && modif.temoin.nom === 'Essai bis', '[R] temoin : sur son centre, la modification passe', modif.temoin);

    const { buildMessage } = require(path.join(ROOT, 'lib/ops-communications.js'));
    for (const [id, nom] of [['gembloux', 'Gembloux'], ['libramont', 'Libramont']]) {
      const dossier = { centerId: id, date: B.JOUR, startTime: '15:00', name: 'Essai', phone: '0470111222', pax: 4, type: 'bowling', label: 'Bowling', delayMinutes: 15, depassementTables: { count: 6, limit: 5, startTime: '15:00', endTime: '16:00' } };
      for (const modele of ['staff_review_request', 'staff_alert', 'delay_staff_attention', 'staff_tables_limit']) {
        const mail = buildMessage({ reservation: dossier, templateId: modele, channel: 'email' });
        ok(String(mail.subject).includes(nom), `[M] ${modele} dit ${nom} dans son objet`, mail.subject);
      }
    }

    // [C] Le code d avant : chaque regle de la console rougit, et une seule edition suffit a chacune.
    servies = AVANT_CONSOLE;
    const avant = await jouerConsole(browser);
    servies = [];
    for (const { vise } of AVANT_CONSOLE) ok(!nomme[vise](avant), `[C] contre-preuve : sans le centre dans l envoi, « ${LIBELLES[vise]} » rougit`, avant[vise]);

    await B.contrePreuve(ok, {
      nom: 'pistes-libramont-par-defaut',
      fichier: 'api/staff-lanes.js',
      de: "{ centerId: body.centerId || body.center_id || '' });",
      vers: "{ centerId: body.centerId || body.center_id || 'libramont' });",
      rejouer: async (mutations) => {
        delete require.cache[require.resolve(path.join(ROOT, 'api/staff-lanes.js'))];
        B.monter({ session: session('gembloux'), mutations });
        chargerEcrivains();
        const lanes = require(path.join(ROOT, 'api/staff-lanes.js'));
        vus.length = 0;
        await B.appeler(lanes, 'PATCH', '/api/staff-lanes', { lane: 3, status: 'maintenance' });
        delete require.cache[require.resolve(path.join(ROOT, 'api/staff-lanes.js'))];
        return vus.slice();
      },
      attendu: (v) => v.length === 1 && v[0].centerId === 'gembloux',
      libelle: 'une piste sans centre tomberait a Libramont',
    });
    await B.contrePreuve(ok, {
      nom: 'reservation-qui-change-de-centre',
      fichier: 'api/staff-reservations.js',
      de: "if (!switchSession) return;\n        sendError(res, 422, 'Une réservation reste dans son centre : annulez-la et recréez-la dans l autre.');\n        return;",
      vers: "if (!switchSession) return;",
      rejouer: (mutations) => modification(mutations),
      attendu: (v) => v.ailleurs.statut === 422,
      libelle: 'la reservation changerait de centre',
    });
  } finally {
    await browser.close();
    serveur.close();
  }
  B.sortir('console-centre-check', echecs, 'une action de la console va au centre affiche, jamais au centre de connexion');
})().catch((e) => { console.error(e); process.exit(1); });

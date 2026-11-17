// LA MISE EN ROUTE D UN CENTRE NEUF (2026-11-17, avant-lancement D7).
//
// Apres sa creation, un centre ne dans la console se reglait a la main et sans fil : horaires, activites,
// tarifs, coordonnees, puis le passage a « Ouvert a la reservation ». Rien ne disait ce qui manquait ni ou le
// regler, et un centre passe « ouvert » trop tot restait ferme en ligne (D2) sans que la direction sache
// pourquoi.
//
// [A] LA REGLE (lib/mise-en-route.js), sans base : les centres du socle et un centre archive n en ont pas ;
//     un centre neuf a ses cinq etapes dans l ordre, chacune faite ou non selon sa config, avec l endroit ou
//     la faire ; « en ligne » dit exactement ce que dit la regle du formulaire (lib/centre-publie.js).
// [B] LE SERVEUR (api/ops.js, action centerConfig) : la page Etablissement recoit la mise en route de chaque
//     centre, lue APRES le rechauffage du catalogue du centre.
// [C] LA PAGE (assets/app-main.js, la vraie console servie, API simulees, Playwright) : la carte en haut de
//     la page Etablissement, la prochaine etape en bouton plein, chaque bouton mene a sa rubrique, a son champ
//     ou a la page des prix ; rien pour un centre en ligne ni pour Fun Galaxy ; en lecture seule, aucun
//     bouton.
//
// Les contre-preuves mutent le code en memoire (lib et api) ou le fichier SERVI (la page) : rien n est ecrit.
// Lancement : node scripts/mise-en-route-check.js [--contre-preuves] [--captures=<dossier>]

'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const Module = require('module');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
['DATABASE_URL', 'POSTGRES_URL'].forEach((cle) => { delete process.env[cle]; });

const MUTATIONS = {
  'socle-guide': { f: 'lib/mise-en-route.js', de: "  if (!centre || typeof centre !== 'object' || estDuSocle(centre)) return null;", vers: "  if (!centre || typeof centre !== 'object') return null;", lettre: 'A' },
  'tarifs-oublies': { f: 'lib/mise-en-route.js', de: '      fait: vendues.length > 0 && sansPrix.length === 0,', vers: '      fait: vendues.length > 0,', lettre: 'A' },
  'en-ligne-sans-la-regle': { f: 'lib/mise-en-route.js', de: '  const enLigne = ouvert && vendues.length > 0 && !manqueAPublier(centre, { activites: vendues });', vers: '  const enLigne = ouvert && vendues.length > 0;', lettre: 'A' },
  'page-sans-mise-en-route': { f: 'api/ops.js', de: "centers: require('../lib/mise-en-route').avecMiseEnRoute(avecCalendrier), activities", vers: 'centers: avecCalendrier, activities', lettre: 'B' },
  'mise-en-route-sans-catalogue': { f: 'api/ops.js', de: '    try { await refreshCatalog(pool); } catch (error) { /* catalogue fichier */ }\n', vers: '', lettre: 'B' },
  'carte-absente': { f: 'assets/app-main.js', de: '    ${ebMiseEnRouteHtml(center, canEdit)}\n', vers: '', lettre: 'C' },
  'bouton-plein-au-premier': { f: 'assets/app-main.js', de: 'const principale = Boolean(prochaine) && e.cle === prochaine.cle;', vers: 'const principale = i === 0;', lettre: 'C' },
  'champ-pas-pose': { f: 'assets/app-main.js', de: 'if (champ) { focusEstablishmentField(champ); return; }', vers: 'if (champ) { return; }', lettre: 'C' },
  'lecture-seule-avec-boutons': { f: 'assets/app-main.js', de: "const permis = e.aller && e.aller.page === 'prices' ? canUseStaffPermission('pricing.manage') : canEdit;", vers: 'const permis = true;', lettre: 'C' },
  'bouton-plein-repeint': { f: 'assets/pinlane-staff.css', de: '.establishment-page.eb .eb-b.eb-mer-plein {', vers: '.establishment-page.eb .eb-mer-plein {', lettre: 'C' },
  'menu-sans-mise-en-route': { f: 'api/ops.js', de: "sendJson(res, 200, { ok: true, centers: require('../lib/mise-en-route').avecMiseEnRoute(centers), owner });", vers: 'sendJson(res, 200, { ok: true, centers, owner });', lettre: 'B' },
  'accueil-tout-a-jour': { f: 'assets/app-main.js', de: 'const inboxTodos = [...getDashMiseEnRouteTodos(), ...getDashInboxTodos()];', vers: 'const inboxTodos = getDashInboxTodos();', lettre: 'C' },
  'en-ligne-sans-activite': { f: 'lib/mise-en-route.js', de: '  const enLigne = ouvert && vendues.length > 0 && !manqueAPublier(centre, { activites: vendues });', vers: '  const enLigne = ouvert && !manqueAPublier(centre, { activites: vendues });', lettre: 'A' },
};
const MUTATION = (process.argv.find((a) => a.startsWith('--mutation=')) || '').slice('--mutation='.length);
if (MUTATION && !MUTATIONS[MUTATION]) { console.error(`mutation inconnue : ${MUTATION}`); process.exit(2); }
const SANS_PAGE = process.argv.includes('--sans-page');
const CAPTURES = (process.argv.find((a) => a.startsWith('--captures=')) || '').slice('--captures='.length);

function muter(relatif, texte) {
  const m = MUTATION ? MUTATIONS[MUTATION] : null;
  const t = String(texte).split('\r\n').join('\n');
  if (!m || relatif !== m.f) return t;
  if (t.split(m.de).length !== 2) throw new Error(`ANCRE DE MUTATION absente ou multiple (${MUTATION}) dans ${m.f}`);
  return t.split(m.de).join(m.vers);
}
const compiler = Module.prototype._compile;
Module.prototype._compile = function compilerMute(contenu, fichier) {
  return compiler.call(this, muter(path.relative(ROOT, path.resolve(fichier)).split(path.sep).join('/'), contenu), fichier);
};

let rouges = 0;
let lettre = '';
function section(titre) { lettre = (titre.match(/^\[([A-Z])\]/) || [])[1] || ''; console.log(`\n${titre}`); }
function ok(condition, quoi, detail) {
  if (condition) { console.log(`ok    ${quoi}`); return; }
  rouges += 1;
  console.log(`ROUGE [${lettre}] ${quoi}${detail !== undefined ? ` : ${String(detail).slice(0, 300)}` : ''}`);
}

if (process.argv.includes('--contre-preuves')) {
  const temoin = spawnSync(process.execPath, [__filename], { cwd: ROOT, encoding: 'utf8', timeout: 240000 });
  if (temoin.status !== 0) { console.log(`${temoin.stdout || ''}${temoin.stderr || ''}`.split('\n').filter((l) => /ROUGE|Error/.test(l)).join('\n')); console.log('\nmise-en-route-check --contre-preuves: le gate est rouge sans mutation, aucune contre-preuve ne compte'); process.exit(1); }
  // La suite d avant mise en ligne saute les mutations de la page (navigateur) : la nuit les rejoue.
  const sansPage = process.env.PINLANE_SANS_CONTRE_PREUVES === '1';
  const jouees = Object.entries(MUTATIONS).filter(([, m]) => !(sansPage && m.lettre === 'C'));
  if (sansPage) console.log(`GATE-SAUTE-PARTIE contre-preuves : ${Object.keys(MUTATIONS).length - jouees.length} mutations de la page pas rejouees (la nuit, ou quand le diff touche ce gate)`);
  let rates = 0;
  for (const [nom, m] of jouees) {
    const r = spawnSync(process.execPath, [__filename, `--mutation=${nom}`, ...(m.lettre === 'C' ? [] : ['--sans-page'])], { cwd: ROOT, encoding: 'utf8', timeout: 240000 });
    const sortie = `${r.stdout || ''}${r.stderr || ''}`;
    const mord = r.status === 1 && sortie.includes(`ROUGE [${m.lettre}]`) && !/ANCRE DE MUTATION/.test(sortie);
    if (!mord) rates += 1;
    console.log(`${mord ? 'TUEE ' : 'VIVANTE'} ${nom} (attendu : ROUGE [${m.lettre}], sortie ${r.status})${mord ? '' : `\n${sortie.split('\n').filter((l) => /ROUGE|ANCRE|Error/.test(l)).slice(0, 6).join('\n')}`}`);
  }
  console.log(rates ? `\nmise-en-route-check --contre-preuves: ${rates} mutation(s) vivante(s)` : '\nmise-en-route-check --contre-preuves: ALL OK - chaque regle retiree fait rougir sa lettre');
  process.exit(rates ? 1 : 0);
}

const { miseEnRoute, avecMiseEnRoute } = require('../lib/mise-en-route');
const { manqueAPublier } = require('../lib/centre-publie');

const SEMAINE = { regular: { 0: { open: '10:00', close: '22:00' }, 1: null, 2: { open: '14:00', close: '22:00' }, 3: { open: '14:00', close: '22:00' }, 4: { open: '14:00', close: '22:00' }, 5: { open: '14:00', close: '23:00' }, 6: { open: '10:00', close: '23:00' } }, holiday: {} };
const BOWLING = { id: 'bowling', name: 'Bowling', priceType: 'grid_bowling' };
const LASER = { id: 'laser_game', name: 'Laser Game', priceType: 'grid_laser' };
const KARA = { id: 'kara-box', name: 'Kara Box', priceType: 'per_pax', priceValue: 10 };
const CONTACT = { address: 'Rue de la Gare 4, 5000 Namur', phone: '081 22 33 44' };
const neuf = (plus) => ({ id: 'bowling-atlas', name: 'Bowling Atlas', status: 'planned', ...plus });
const cles = (m) => (m ? m.etapes.map((e) => e.cle).join(',') : 'aucune');
const etape = (m, cle) => (m ? m.etapes.find((e) => e.cle === cle) : null) || {};

section('[A] LA REGLE : lib/mise-en-route.js');
for (const id of ['libramont', 'gembloux', 'ciney']) ok(miseEnRoute({ id, name: id, status: id === 'ciney' ? 'planned' : 'active' }) === null, `${id} (socle) n a pas de mise en route`);
ok(miseEnRoute(neuf({ status: 'closed' }), { activites: [] }) === null, 'un centre archive n en a pas');
const vide = miseEnRoute(neuf(), { activites: [] });
ok(cles(vide) === 'horaires,activites,tarifs,coordonnees,ouvrir' && vide.restantes === 5 && vide.enLigne === false, 'un centre neuf : cinq etapes dans l ordre, aucune faite', JSON.stringify(vide));
ok(etape(vide, 'horaires').aller.page === 'establishment' && etape(vide, 'horaires').aller.rubrique === 'horaires'
  && etape(vide, 'activites').aller.rubrique === 'activites' && etape(vide, 'tarifs').aller.page === 'prices'
  && etape(vide, 'coordonnees').aller.champ === 'estab-address' && etape(vide, 'ouvrir').aller.champ === 'estab-status', 'chaque etape dit ou la faire', JSON.stringify(vide && vide.etapes.map((e) => e.aller)));
const sansPrix = miseEnRoute(neuf({ defaultSchedule: SEMAINE, publicInfo: { address: CONTACT.address } }), { activites: [BOWLING, LASER, KARA] });
ok(etape(sansPrix, 'horaires').fait && etape(sansPrix, 'horaires').phrase === 'Ouvert 6 jours sur 7.', 'des horaires poses : l etape est faite et dit combien de jours', etape(sansPrix, 'horaires').phrase);
ok(etape(sansPrix, 'activites').fait && etape(sansPrix, 'activites').phrase === 'Bowling, Laser Game et Kara Box se réservent.', 'les activites vendues se nomment', etape(sansPrix, 'activites').phrase);
ok(!etape(sansPrix, 'tarifs').fait && etape(sansPrix, 'tarifs').phrase === 'Bowling et Laser Game n’ont pas encore de prix.', 'les activites vendues a la grille sans prix se nomment, pas celle a prix fixe', etape(sansPrix, 'tarifs').phrase);
ok(!etape(sansPrix, 'coordonnees').fait && etape(sansPrix, 'coordonnees').aller.champ === 'estab-phone' && /votre téléphone/.test(etape(sansPrix, 'coordonnees').phrase), 'l adresse posee sans telephone : l etape mene au champ du telephone', JSON.stringify(etape(sansPrix, 'coordonnees')));
const pret = neuf({ defaultSchedule: SEMAINE, publicInfo: CONTACT, grillesTarif: { bowling: { 1: 30 }, laser: { 1: 9 } } });
const mPret = miseEnRoute(pret, { activites: [BOWLING, LASER, KARA] });
ok(etape(mPret, 'tarifs').fait && etape(mPret, 'coordonnees').fait && !etape(mPret, 'ouvrir').fait && mPret.restantes === 1 && /^Tout est prêt/.test(etape(mPret, 'ouvrir').phrase), 'tout pose mais prevu : une etape, « Tout est prêt »', JSON.stringify(mPret));
const ouvert = miseEnRoute({ ...pret, status: 'active' }, { activites: [BOWLING, LASER, KARA] });
ok(ouvert.enLigne === true && ouvert.restantes === 0, 'tout pose et ouvert : en ligne, rien ne reste', JSON.stringify(ouvert));
const tropTot = miseEnRoute(neuf({ status: 'active', grillesTarif: { bowling: { 1: 30 } } }), { activites: [BOWLING] });
ok(tropTot.enLigne === false && !etape(tropTot, 'ouvrir').fait && etape(tropTot, 'ouvrir').phrase === 'Votre centre est ouvert, mais le formulaire reste fermé tant que les horaires manquent.', 'ouvert trop tot (sans horaires) : la carte dit pourquoi le formulaire reste ferme', etape(tropTot, 'ouvrir').phrase);
const sansActivite = miseEnRoute(neuf({ status: 'active', defaultSchedule: SEMAINE }), { activites: [] });
ok(sansActivite.enLigne === false && etape(sansActivite, 'ouvrir').phrase === 'Votre centre est ouvert, mais le formulaire reste fermé tant que les activités manquent.', 'ouvert sans aucune activite : pas « en ligne », rien ne se vend', JSON.stringify(sansActivite));
const variantes = [
  [neuf(), []], [neuf({ status: 'active' }), [BOWLING]], [neuf({ status: 'active', defaultSchedule: SEMAINE }), [BOWLING]],
  [neuf({ status: 'active', defaultSchedule: SEMAINE }), [KARA]], [{ ...pret, status: 'active' }, [BOWLING, LASER]], [neuf({ status: 'active', defaultSchedule: SEMAINE, resources: { bowling: { pricing: { perGame: 6 } } } }), [BOWLING]],
  [neuf({ status: 'active', defaultSchedule: SEMAINE }), []],
];
const desaccords = variantes.filter(([c, activites]) => miseEnRoute(c, { activites }).enLigne !== (c.status === 'active' && activites.length > 0 && manqueAPublier(c, { activites }) === ''));
ok(desaccords.length === 0, '« en ligne » dit ce que dit la regle du formulaire, avec quelque chose a vendre (7 variantes)', desaccords.map(([c]) => JSON.stringify(c)).join(' | '));
// Ansar rejette le deux-points au milieu d une phrase (memoire ce-qu-ansar-appelle-fait-ia).
const phrases = [vide, sansPrix, mPret, ouvert, tropTot, sansActivite].flatMap((m) => m.etapes.map((e) => e.phrase));
ok(phrases.every((p) => !/ : /.test(p)), 'aucune phrase n a de deux-points au milieu', phrases.filter((p) => / : /.test(p)).join(' | '));

section('[B] LE SERVEUR : api/ops.js, action centerConfig');
const liste = avecMiseEnRoute([{ id: 'libramont', name: 'Libramont', status: 'active' }, neuf(), neuf({ id: 'vieux', status: 'closed' })]);
ok(!('miseEnRoute' in liste[0]) && liste[1].miseEnRoute && liste[1].miseEnRoute.etapes.length === 5 && !('miseEnRoute' in liste[2]), 'la liste des centres : seul le centre neuf porte sa mise en route', JSON.stringify(liste.map((c) => [c.id, Boolean(c.miseEnRoute)])));
const ops = muter('api/ops.js', fs.readFileSync(path.join(ROOT, 'api', 'ops.js'), 'utf8'));
const debut = ops.indexOf("  if (action === 'centerConfig') {");
const bloc = debut < 0 ? '' : ops.slice(debut, ops.indexOf('\n    return;\n  }', debut));
const iCatalogue = bloc.indexOf('await refreshCatalog(pool)');
const iEnvoi = bloc.indexOf("centers: require('../lib/mise-en-route').avecMiseEnRoute(avecCalendrier)");
ok(iEnvoi > 0, 'la page Etablissement recoit la mise en route de chaque centre', bloc.slice(-300));
ok(iCatalogue > 0 && iCatalogue < iEnvoi, 'le catalogue du centre est rechauffe avant de lire ses etapes', `${iCatalogue} / ${iEnvoi}`);
const debutMenu = ops.indexOf("  if (action === 'menuCenters') {");
const blocMenu = debutMenu < 0 ? '' : ops.slice(debutMenu, ops.indexOf('\n    return;\n  }', debutMenu));
const iMenuCatalogue = blocMenu.indexOf('await refreshCatalog(getPool())');
const iMenuEnvoi = blocMenu.indexOf("centers: require('../lib/mise-en-route').avecMiseEnRoute(centers), owner");
ok(iMenuEnvoi > 0 && iMenuCatalogue > 0 && iMenuCatalogue < iMenuEnvoi, 'la liste des centres du menu (la Vue d ensemble) porte aussi la mise en route, catalogue rechauffe avant', blocMenu.slice(-300));

(async () => {
  if (SANS_PAGE) { fin(); return; }
  section('[C] LA PAGE : la vraie console servie (Playwright, API simulees)');
  await page();
  fin();
})().catch((error) => { console.error(error); process.exit(1); });

function fin() {
  console.log(rouges ? `\nmise-en-route-check: ${rouges} ROUGE(S)` : '\nmise-en-route-check: ALL OK');
  process.exit(rouges ? 1 : 0);
}

async function page() {
  const { chromium } = require('playwright-core');
  const PORT = Number(process.env.PINLANE_MISE_EN_ROUTE_PORT || 4237);
  const BASE_URL = `http://127.0.0.1:${PORT}`;
  const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webp': 'image/webp', '.jpg': 'image/jpeg' };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    let fichier = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname === '') fichier = path.join(ROOT, 'index.html');
    if (!fichier.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(fichier, (err, contenu) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      const relatif = path.relative(ROOT, fichier).split(path.sep).join('/');
      let corps = contenu;
      try {
        if (MUTATION && MUTATIONS[MUTATION].f === relatif) corps = Buffer.from(muter(relatif, contenu.toString('utf8')), 'utf8');
      } catch (error) { console.log(`ROUGE [C] ${error.message}`); rouges += 1; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(fichier).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(corps);
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', resolve); });
  const navigateur = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const erreurs = [];
  try {
    // Le centre neuf du gerant : ses horaires poses, rien d autre. Les etapes viennent de la vraie regle.
    const centreNeuf = { ...neuf({ defaultSchedule: SEMAINE, timezone: 'Europe/Brussels', resources: {}, activityAvailability: {}, holidaySettings: { enabled: false, overrides: [], formulaBlockedPeriods: [] }, offerAvailability: {}, classification: {}, customActivities: [], publicInfo: {} }) };
    centreNeuf.miseEnRoute = miseEnRoute(centreNeuf, { activites: [] });
    const centreEnLigne = { ...centreNeuf, status: 'active', miseEnRoute: ouvert };
    const funGalaxy = { ...centreNeuf, id: 'libramont', name: 'Fun Galaxy Libramont', status: 'active' };
    delete funGalaxy.miseEnRoute;

    const ouvrirConsole = async (lectureSeule) => {
      const p = await navigateur.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: CAPTURES ? 2 : 1 });
      p.on('pageerror', (err) => erreurs.push(String(err && err.message)));
      await p.addInitScript(({ lectureSeule, expiresAt }) => {
        const toutes = ['dashboard.view', 'planning.view', 'reservations.view', 'settings.manage', 'direction.view', 'pricing.manage'];
        const perms = lectureSeule ? ['dashboard.view', 'planning.view', 'reservations.view', 'direction.view'] : toutes;
        const roleId = lectureSeule ? 'regard' : 'direction';
        const session = { token: 'qa', cookieBacked: false, centerId: 'bowling-atlas', expiresAt, member: { id: 'qa', name: 'QA', roleId }, role: { id: roleId, name: lectureSeule ? 'Regard' : 'Direction', locked: !lectureSeule }, permissions: perms };
        const J = (corps) => new Response(JSON.stringify(corps), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
        const natif = window.fetch.bind(window);
        window.fetch = async (input, init = {}) => {
          const u = new URL(typeof input === 'string' ? input : (input && input.url) || '', window.location.origin);
          if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session, accessControl: { selectedRoleId: roleId, selectedMemberId: 'qa', roles: [{ id: roleId, name: session.role.name, code: 'QA', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: !lectureSeule, permissions: perms }], members: [{ id: 'qa', name: 'QA', contact: 'q@x', roleId, status: 'active', code: 'X', lastSeen: new Date().toISOString() }], events: [], permissions: perms } });
          if (u.pathname === '/api/staff-state') return J({ ok: true, revision: 'qa', reservations: [], laneStatuses: {}, centerId: 'bowling-atlas' });
          if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'centerConfig') return J({ ok: true, centers: window.__CENTRES__ || [], activities: [] });
          if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'menuCenters') return J({ ok: true, centers: window.__CENTRES__ || [], owner: false });
          if (u.pathname.startsWith('/api/')) return J({ ok: true, reservations: [], emails: [], communications: [], samples: [], suggestions: [], events: [], agents: [], activations: [], orchestration: {} });
          return natif(input, init);
        };
        window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(session));
      }, { lectureSeule, expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString() });
      await p.goto(`${BASE_URL}/?v=mer-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
      await p.waitForFunction(() => typeof window.setView === 'function' && typeof window.loadStaffCenterConfig === 'function', null, { timeout: 15000 });
      return p;
    };
    const montrer = async (p, centres) => {
      await p.evaluate(async (centres) => {
        window.__CENTRES__ = centres;
        state.adminCenterId = centres[0].id;
        state.staffTheme = 'dark';
        setView('staff');
        while (staffCenterConfigCache.loading) await new Promise((r) => setTimeout(r, 30));
        await loadStaffCenterConfig(true);
        openStaffMenuPage('establishment');
      }, centres);
      await p.waitForSelector(`[data-estab-page][data-eb-center="${centres[0].id}"]`, { timeout: 15000 });
      await p.waitForTimeout(200);
    };
    const lire = (p) => p.evaluate(() => {
      const carte = document.querySelector('.eb-mer');
      return {
        carte: Boolean(carte),
        titre: carte ? carte.querySelector('.eb-mer-h p').textContent : '',
        // Le fond PEINT du bouton : la classe seule ne prouvait rien (le 17/11, une regle plus bas le repeignait en blanc).
        lignes: carte ? [...carte.querySelectorAll('.eb-mer-e')].map((li) => { const b = li.querySelector('button'); return { cle: li.dataset.mer, fait: li.classList.contains('est-fait'), bouton: b ? b.textContent : '', plein: b ? getComputedStyle(b).backgroundColor === 'rgb(0, 112, 243)' : false }; }) : [],
      };
    });

    const p = await ouvrirConsole(false);
    await montrer(p, [centreNeuf]);
    const vu = await lire(p);
    ok(vu.carte && vu.titre === 'Encore 4 étapes avant que vos clients puissent réserver en ligne.', 'un centre neuf : la carte en haut de la page Etablissement dit ce qui reste', JSON.stringify(vu));
    ok(vu.lignes.map((l) => `${l.cle}:${l.fait ? 'fait' : 'a faire'}`).join(',') === 'horaires:fait,activites:a faire,tarifs:a faire,coordonnees:a faire,ouvrir:a faire', 'les cinq etapes, les horaires faits', JSON.stringify(vu.lignes));
    const pleins = vu.lignes.filter((l) => l.plein);
    ok(pleins.length === 1 && pleins[0].cle === 'activites' && pleins[0].bouton === 'Choisir les activités', 'un seul bouton bleu plein, sur la prochaine etape', JSON.stringify(vu.lignes));
    if (CAPTURES && !MUTATION) { fs.mkdirSync(CAPTURES, { recursive: true }); await p.screenshot({ path: path.join(CAPTURES, 'mise-en-route.png') }); }
    await p.click('.eb-mer-e[data-mer="activites"] button');
    ok(await p.evaluate(() => !document.getElementById('eb-p-activites').hidden), '« Choisir les activités » ouvre la rubrique des activites');
    await p.click('.eb-mer-e[data-mer="coordonnees"] button');
    ok(await p.evaluate(() => !document.getElementById('eb-p-centre').hidden && document.activeElement && document.activeElement.id === 'estab-address'), '« Ajouter » ouvre la rubrique du centre, le curseur dans l adresse', await p.evaluate(() => (document.activeElement || {}).id));
    if (CAPTURES && !MUTATION) { await p.waitForTimeout(300); await p.screenshot({ path: path.join(CAPTURES, 'mise-en-route-adresse.png') }); }
    await p.click('.eb-mer-e[data-mer="tarifs"] button');
    await p.waitForTimeout(200);
    ok(await p.evaluate(() => state.staffMenuPage === 'prices'), '« Poser les prix » ouvre la page des prix', await p.evaluate(() => state.staffMenuPage));
    await montrer(p, [centreEnLigne]);
    ok(!(await lire(p)).carte, 'un centre en ligne : plus de carte');
    await montrer(p, [funGalaxy]);
    ok(!(await lire(p)).carte, 'Fun Galaxy : aucune carte');
    await p.close();

    // La Vue d ensemble, premier ecran du gerant, sans passer par Etablissement : la liste des centres du menu.
    const accueil = await ouvrirConsole(false);
    const lireAccueil = async (centres) => {
      await accueil.evaluate(async (centres) => {
        window.__CENTRES__ = centres;
        state.adminCenterId = centres[0].id;
        state.staffTheme = 'dark';
        setView('staff');
        await loadMenuCenters(true);
        openStaffMenuPage('dashboard');
        renderStaff();
      }, centres);
      await accueil.waitForSelector('#staffDashboardPage .dash-todo-card', { timeout: 15000 });
      await accueil.waitForTimeout(300);
      return accueil.evaluate(() => {
        const ligne = document.querySelector('#staffDashboardPage [data-todo="setup"]');
        const lu = (sel) => (ligne && ligne.querySelector(sel) ? ligne.querySelector(sel).textContent : '');
        return { ligne: Boolean(ligne), titre: lu('strong'), texte: lu('p'), bouton: lu('button'), etat: ((document.querySelector('#staffDashboardPage .dash-state') || {}).textContent || '').trim() };
      });
    };
    const dash = await lireAccueil([centreNeuf]);
    ok(dash.ligne && dash.titre === 'Mise en route du centre' && dash.texte === 'Encore 4 étapes avant la réservation en ligne.' && dash.bouton === 'Continuer', 'la Vue d ensemble met la mise en route dans « À traiter »', JSON.stringify(dash));
    ok(dash.etat && !/Tout est à jour/.test(dash.etat), 'la Vue d ensemble ne dit plus « Tout est à jour » a un centre qui ne vend rien', dash.etat);
    if (CAPTURES && !MUTATION) await accueil.screenshot({ path: path.join(CAPTURES, 'accueil-mise-en-route.png') });
    await accueil.click('#staffDashboardPage [data-todo="setup"] button');
    await accueil.waitForSelector('.eb-mer', { timeout: 15000 }).catch(() => {});
    ok(await accueil.evaluate(() => state.staffMenuPage === 'establishment' && Boolean(document.querySelector('.eb-mer'))), '« Continuer » ouvre la page Etablissement sur sa mise en route');
    ok(!(await lireAccueil([funGalaxy])).ligne, 'Fun Galaxy : rien dans « À traiter »');
    await accueil.close();

    const regard = await ouvrirConsole(true);
    await montrer(regard, [centreNeuf]);
    const vuRegard = await lire(regard);
    ok(vuRegard.carte && vuRegard.lignes.length === 5 && vuRegard.lignes.every((l) => !l.bouton), 'en lecture seule : la carte se lit, sans aucun bouton', JSON.stringify(vuRegard.lignes));
    await regard.evaluate(() => { openStaffMenuPage('dashboard'); renderStaff(); });
    await regard.waitForSelector('#staffDashboardPage .dash-todo-card', { timeout: 15000 });
    ok(!(await regard.evaluate(() => Boolean(document.querySelector('#staffDashboardPage [data-todo="setup"]')))), 'en lecture seule : rien dans « À traiter », ce role ne regle pas le centre');
    await regard.close();
    const miennes = erreurs.filter((e) => /ebMiseEnRoute|ebAllerEtape|miseEnRoute/.test(e));
    ok(miennes.length === 0, 'aucune erreur de la carte dans la page', miennes.join(' | '));
  } finally {
    await navigateur.close();
    server.close();
  }
}

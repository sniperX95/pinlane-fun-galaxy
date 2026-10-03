// LE PRIX D UN DOSSIER NE CHANGE PAS PARCE QU ON L A REGARDE.
//
// Au comptoir, "Adapter pour ce dossier" ouvre le panneau de composition d une
// reservation. Mesure du 2026-08-31 : la SIMPLE OUVERTURE du panneau, sans un
// seul clic sur une case, ecrasait le prix du dossier par un total recalcule
// aux valeurs par DEFAUT.
//
// Fixture : 3 tables de billard reservees 2 heures a 20 EUR la table et par
// heure, soit 120 EUR reellement vendus au comptoir. A l ouverture du panneau,
// le champ tombait a 20 EUR, et un simple "Enregistrer" envoyait price=20 au
// serveur - 100 EUR perdus, 83 % du dossier - pendant que program.items
// montrait toujours units:3, hours:2 intacts en base. Invisible sur la fiche,
// visible seulement en caisse.
//
// LA CHAINE, en trois maillons, tous dans assets/app-main.js :
//   1. buildEditProgramFromReservation ne recopiait duration/games QUE pour le
//      bowling et le laser. Pour toute autre activite elle ne gardait que le
//      on/off, en jetant units / hours / minutes / participants.
//   2. getEditProgramItems reconstruisait donc des lignes nues.
//   3. estimerPrixProgramme appelait getFreeActivityPrice sans ces valeurs, qui
//      retombaient sur leurs defauts (units=1, hours=1) : 20 x 1 x 1 = 20.
// Le tunnel public les passait correctement depuis toujours : seul le chemin du
// COMPTOIR etait touche.
//
// LE MEME DEFAUT, TROUVE PAR LA CAMPAGNE DU 2026-09-29 sur un dossier du
// formulaire : 20 personnes, bowling, duckpin en deux tours, minigolf pour les
// 8 qui attendent au tarif d attente (8 EUR) : 376 EUR. A la simple ouverture
// du panneau, le champ tombait a 356 : le minigolf compte pour les 20 au prix
// du catalogue (200 EUR), le duckpin « tarif non saisi ». Et un prix d ami
// (80 EUR pour une visite qui en vaut 99) repartait au plein tarif pareil.
// Deux regles : la fiche chiffre chaque ligne comme le serveur (participants,
// tarif d attente, duckpin a la piste et par tour), et le prix ne suit
// l estimation QUE si on a change le contenu ou les joueurs.
//
// Ce gate pilote un VRAI navigateur sur le VRAI bundle (montage repris de
// scripts/edit-sheet-check.js). Pour chaque dossier, dans cet ordre :
//   A. ouvrir le panneau ne change RIEN au prix ;
//   B. enregistrer sans avoir rien touche renvoie le prix REEL au serveur ;
//   C. le detail du panneau chiffre chaque ligne comme le serveur.
//
// CONTRE-EPREUVES servies EN MEMOIRE (le disque n est pas touche) : chaque
// regle retiree du bundle, la verification qu elle garde tombe. `--mutate`
// garde l ancienne contre-epreuve sur disque (oubli des reglages).
//
// Lancement : node scripts/edit-price-options-check.js
const PORT = Number(process.env.PINLANE_EDIT_PRICE_PORT || 4503);
const http = require('http');
const fs = require('fs');
const p = require('path');
// Le depot est celui qui contient ce script. Un chemin Windows ecrit en dur ici
// faisait mourir la CI Linux sur ce gate depuis le 2026-08-31.
const REPO = p.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const EDGE = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

// Le bundle servi : celui du disque, ou une copie mutee en memoire.
let appMute = null;
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (appMute !== null && u.pathname === '/assets/app-main.js') {
    res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-store' });
    res.end(appMute);
    return;
  }
  let f = p.join(REPO, decodeURIComponent(u.pathname));
  if (u.pathname === '/') f = p.join(REPO, 'index.html');
  fs.readFile(f, (e, c) => {
    if (e) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[p.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(c);
  });
});

let failures = 0;
function ok(cond, label) { console.log((cond ? 'ok  ' : 'FAIL') + '  ' + label); if (!cond) failures += 1; return cond; }

// Contre-epreuve historique : on remet l oubli des reglages dans le bundle, on
// prouve que le gate rougit, et on restaure par edition inverse.
if (process.argv.includes('--mutate')) {
  const APP = p.join(REPO, 'assets', 'app-main.js');
  const source = fs.readFileSync(APP, 'utf8');
  const marqueur = 'if (Object.keys(reglages).length) etat.othersOptions[id] = reglages;';
  if (!source.includes(marqueur)) {
    console.error('mutation impossible : le report des reglages est introuvable dans assets/app-main.js');
    process.exit(1);
  }
  const mute = source.replace(marqueur, 'void reglages;');
  fs.writeFileSync(APP, mute);
  const { spawnSync } = require('child_process');
  const run = spawnSync(process.execPath, [__filename], { encoding: 'utf8', env: { ...process.env, PINLANE_EDIT_PRICE_PORT: String(PORT + 1) } });
  fs.writeFileSync(APP, source);
  console.log(run.stdout || '');
  if (run.status === 0) {
    console.error('CONTRE-EPREUVE RATEE : le gate reste vert sans le report des reglages.');
    process.exit(1);
  }
  console.log('contre-epreuve OK : sans le report des reglages, le gate rougit ; bundle restaure a l identique.');
  process.exit(0);
}

// LES DOSSIERS. 9001 : billards du comptoir. 9002 : le dossier du formulaire
// relu en base apres la campagne (programme tel que la base le garde). 9003 :
// un prix d ami sur une visite qui en vaut 99.
const DOSSIERS = {
  9001: { attendu: 120, detail: null },
  9002: { attendu: 376, detail: ['Bowling 1h|156', 'Minigolf Blacklight|64', 'Duckpin Bowling 1h|156'] },
  9003: { attendu: 80, detail: null },
};

async function mesurer(b) {
  const pg = await b.newPage({ viewport: { width: 1500, height: 1000 } });
  const erreurs = [];
  pg.on('pageerror', (e) => erreurs.push(e.message));
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

  await pg.addInitScript(({ expiresAt }) => {
    const perms = ['dashboard.view', 'planning.view', 'planning.bowling', 'planning.laser', 'planning.drag', 'reservations.view', 'reservations.create', 'reservations.edit', 'reservations.cancel', 'reservations.status', 'clients.view', 'payments.view', 'payments.markPaid', 'settings.manage', 'direction.view'];
    const qaSession = { token: 'qa', centerId: 'libramont', expiresAt, member: { id: 'qa', name: 'Rachel', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };
    // Date du CENTRE, calculee comme todayStr() de l'app (booking-core.js,
    // fuseau Europe/Brussels), jamais dans le fuseau du navigateur : juste sur
    // un poste belge, fausse sur un runner CI en UTC entre 22 h et minuit UTC.
    const jour = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const lire = (type) => jour.find((part) => part.type === type)?.value;
    const today = `${lire('year')}-${lire('month')}-${lire('day')}`;
    const R = [
      // Reservation reelle : 3 tables de billard reservees pour 2 HEURES.
      // Prix facture reel au dossier = 120 EUR (20 EUR/table/heure x 3 tables x 2h).
      {
        id: 9001, name: 'BILLARD TEST', phone: '+32487000000', email: 'b@x.be', date: today,
        startTime: '18:00', duration: 2, pax: 6, price: 120, basePrice: 120,
        type: 'activite', label: 'Billards', lanes: [], status: 'paid', centerId: 'libramont',
        channel: 'staff', activityProgress: {}, extras: [],
        program: { items: [{ activityId: 'billards', units: 3, hours: 2, pax: 6 }] },
      },
      // Le dossier M12 de la campagne du 2026-09-29, tel que la base le relit.
      {
        id: 9002, name: 'GROUPE ATTENTE', phone: '+32487000001', email: 'g@x.be', date: today,
        startTime: '11:00', duration: 1, pax: 20, price: 376, basePrice: 376,
        type: 'bowling', label: 'Bowling · Minigolf Blacklight 8 pers. · Duckpin Bowling', lanes: [1, 2, 3, 4], status: 'pending', centerId: 'libramont',
        channel: 'public', activityProgress: {}, extras: [],
        program: {
          items: [
            { activityId: 'bowling', name: 'Bowling', planned: true, duration: 1, minutes: 60, priceType: 'grid_bowling', price: 156, priceKnown: true },
            { activityId: 'minigolf_blacklight', name: 'Minigolf Blacklight', planned: false, minutes: 45, sessions: 1, participants: 8, waitOffer: true, waitPricePerPax: 8, priceType: 'per_pax', price: 64, priceKnown: true },
            { activityId: 'duckpin_bowling', name: 'Duckpin Bowling', planned: false, duration: 1, units: 4, minutes: 120, sessions: 2, priceType: 'grid_bowling', price: 156, priceKnown: true },
          ],
          price: 376,
          priceComplete: true,
        },
      },
      // Un prix d ami : bowling 1 h et minigolf pour 6, 99 EUR au catalogue,
      // vendu 80 au comptoir.
      {
        id: 9003, name: 'PRIX AMI', phone: '+32487000002', email: 'a@x.be', date: today,
        startTime: '15:00', duration: 1, pax: 6, price: 80, basePrice: 99,
        type: 'bowling', label: 'Bowling · Minigolf Blacklight', lanes: [5], status: 'paid', centerId: 'libramont',
        channel: 'staff', activityProgress: {}, extras: [],
        program: {
          items: [
            { activityId: 'bowling', name: 'Bowling', planned: true, duration: 1, minutes: 60, price: 39, priceKnown: true },
            { activityId: 'minigolf_blacklight', name: 'Minigolf Blacklight', planned: false, minutes: 45, price: 60, priceKnown: true },
          ],
          price: 99,
          priceComplete: true,
        },
      },
    ];
    const ACTIVITIES = [
      { id: 'billards', name: 'Billards', priceType: 'per_unit_hour', priceValue: 20, unitLabel: 'par table et par heure', bookable: true, order: 5 },
      { id: 'minigolf_blacklight', name: 'Minigolf Blacklight', priceType: 'per_pax', priceValue: 10, unitLabel: 'par personne', bookable: true, order: 3 },
      { id: 'duckpin_bowling', name: 'Duckpin Bowling', priceType: 'grid_bowling', priceValue: null, unitLabel: 'par piste', bookable: true, order: 7, units: 2, capacityPerUnit: 6 },
    ];
    const J = (payload) => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
    const nf = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : (input && input.url) || '';
      const u = new URL(raw, window.location.origin);
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session: qaSession, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: perms }], members: [], events: [], permissions: perms } });
      if (u.pathname === '/api/staff-state') return J({ ok: true, revision: 'qa', reservations: R, laneStatuses: Array.from({ length: 8 }).reduce((a, _, i) => { a[i + 1] = 'active'; return a; }, {}), centerId: 'libramont' });
      if (u.pathname === '/api/admin-range') return J({ ok: true, reservations: R, laneStatuses: {}, centerId: 'libramont', revision: 'qa', syncedAt: new Date().toISOString() });
      if (u.pathname === '/api/staff-reservations' && String(init.method || 'GET').toUpperCase() === 'PATCH') {
        const body = JSON.parse(init.body || '{}');
        window.__QA_PATCH__ = window.__QA_PATCH__ || [];
        window.__QA_PATCH__.push(body);
        const idx = R.findIndex((r) => String(r.id) === String(body.id));
        const base = idx >= 0 ? R[idx] : R[0];
        const merged = { ...base, ...body };
        if (idx >= 0) R[idx] = merged;
        return J({ ok: true, reservation: merged });
      }
      if (u.pathname === '/api/staff-reservations') return J({ ok: true, reservation: R[0] });
      if (u.pathname === '/api/ops') return J({ ok: true, communications: [], samples: [], suggestions: [], events: [], customRequests: [] });
      if (u.pathname === '/api/public-booking-meta') return J({ ok: true, today, durationOptions: [], formules: [], activities: ACTIVITIES, center: { id: 'libramont', status: 'active', defaultSchedule: { regular: { 0: { open: '10:00', close: '22:00' }, 1: { open: '10:00', close: '22:00' }, 2: { open: '10:00', close: '22:00' }, 3: { open: '10:00', close: '22:00' }, 4: { open: '10:00', close: '22:00' }, 5: { open: '10:00', close: '24:00' }, 6: { open: '10:00', close: '24:00' } }, holiday: {} }, holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] }, offerAvailability: {} } });
      return nf(input, init);
    };
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession));
  }, { expiresAt });

  await pg.goto('http://127.0.0.1:' + PORT + '/?v=' + Date.now(), { waitUntil: 'networkidle' });
  await pg.waitForFunction(() => typeof window.setView === 'function');
  await pg.evaluate(() => window.setView('staff'));
  await pg.waitForTimeout(1800);
  await pg.waitForFunction(() => typeof window.openStaffReservationDetail === 'function', { timeout: 20000 });

  const resultats = {};
  for (const id of Object.keys(DOSSIERS).map(Number)) {
    await pg.evaluate((rid) => { window.__QA_PATCH__ = []; window.openStaffReservationDetail(rid); }, id);
    await pg.waitForSelector('.pos-tabs, .edit-form, [role="tab"]', { timeout: 15000 }).catch(() => {});
    await pg.evaluate(() => {
      const fiche = document.querySelector('#posOverlay, .pos-sheet') || document;
      const tab = [...fiche.querySelectorAll('button, a, [role="tab"]')].find((t) => /^Modifier$/i.test(t.textContent.trim()));
      if (tab) tab.click();
    });
    await pg.waitForSelector('.edit-form', { timeout: 15000 }).catch(() => {});
    await pg.waitForTimeout(400);
    // Ouvrir "Adapter pour ce dossier" SANS RIEN COCHER NI TAPER.
    const clique = await pg.evaluate(() => {
      const btn = [...document.querySelectorAll('.edit-adapter-btn')].find((x) => /Adapter pour ce dossier/i.test(x.textContent));
      if (btn) { btn.click(); return true; }
      return false;
    });
    await pg.waitForTimeout(300);
    const apres = await pg.evaluate(() => ({
      champ: document.getElementById('editPriceInput') ? document.getElementById('editPriceInput').value : null,
      ligne: document.getElementById('editPrixEstime') ? document.getElementById('editPrixEstime').textContent : null,
      detail: Array.from(document.querySelectorAll('.edit-prix-detail li')).map((li) => `${(li.querySelector('span') || li).textContent.replace(/\s+/g, ' ').trim()}|${(li.querySelector('b') || {}).textContent || ''}`),
    }));
    // Le staff clique "Enregistrer" sans avoir touche a rien.
    const envoye = await pg.evaluate(async () => {
      const form = document.querySelector('.edit-form');
      if (!form) return null;
      form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true }));
      await new Promise((r) => setTimeout(r, 500));
      const patches = window.__QA_PATCH__ || [];
      return patches.length ? patches[patches.length - 1] : null;
    });
    resultats[id] = { clique, apres, envoye };
    await pg.evaluate(() => { if (typeof closePos === 'function') closePos(); });
    await pg.waitForTimeout(300);
  }
  await pg.close();
  return { resultats, erreurs };
}

function juger(m) {
  const v = [];
  const r1 = m.resultats[9001] || {};
  v.push({ ok: Boolean(r1.clique), label: '[9001] bouton "Adapter pour ce dossier" trouve et clique' });
  v.push({ ok: r1.apres && String(r1.apres.champ) === '120', label: `[A] billards : le champ de prix apres simple ouverture affiche le prix reel du dossier (affiche ${r1.apres && r1.apres.champ}, attendu 120)` });
  v.push({ ok: Boolean(r1.envoye) && Number(r1.envoye.price) === 120, label: `[B] billards : prix ENVOYE au serveur apres un simple enregistrement = 120 (envoye ${r1.envoye ? r1.envoye.price : 'aucun PATCH'})` });
  const lignes = r1.envoye && r1.envoye.program && r1.envoye.program.items ? r1.envoye.program.items : null;
  // Rien n a change : le programme ne repart pas (ou repart intact).
  v.push({ ok: !lignes || (lignes.length === 1 && Number(lignes[0].units) === 3 && Number(lignes[0].hours) === 2), label: `[B] billards : le programme envoye, s il part, porte toujours 3 tables x 2 h (${JSON.stringify(lignes)})` });

  const r2 = m.resultats[9002] || {};
  v.push({ ok: Boolean(r2.clique), label: '[9002] bouton "Adapter pour ce dossier" trouve et clique' });
  v.push({ ok: r2.apres && String(r2.apres.champ) === '376', label: `[A] offre d attente : le champ garde les 376 EUR du dossier a la simple ouverture (affiche ${r2.apres && r2.apres.champ})` });
  v.push({ ok: Boolean(r2.envoye) && Number(r2.envoye.price) === 376, label: `[B] offre d attente : un simple enregistrement renvoie 376 EUR (envoye ${r2.envoye ? r2.envoye.price : 'aucun PATCH'})` });
  const detail = (r2.apres && r2.apres.detail) || [];
  const attendu = DOSSIERS[9002].detail;
  const lu = detail.map((l) => { const [nom, montant] = l.split('|'); return { nom, montant: parseFloat(String(montant).replace(/[^\d,.]/g, '').replace(',', '.')) }; });
  const conforme = attendu.every((a) => { const [nom, montant] = a.split('|'); return lu.some((l) => l.nom.indexOf(nom) === 0 && l.montant === Number(montant)); });
  v.push({
    ok: conforme && lu.length === attendu.length && /pendant l’attente, 8 pers\./.test(detail.join(' ')) && !/À partir de/.test((r2.apres && r2.apres.ligne) || ''),
    label: `[C] le detail chiffre chaque ligne comme le serveur : bowling 156, minigolf pour les 8 qui attendent au tarif d attente 64, duckpin 4 pistes 156 (${detail.join(' ; ')} · ${r2.apres && r2.apres.ligne})`,
  });

  const r3 = m.resultats[9003] || {};
  v.push({ ok: r3.apres && String(r3.apres.champ) === '80', label: `[A] prix d ami : le champ garde les 80 EUR du dossier a la simple ouverture (affiche ${r3.apres && r3.apres.champ}, la visite en vaut 99)` });
  v.push({ ok: Boolean(r3.envoye) && Number(r3.envoye.price) === 80, label: `[B] prix d ami : un simple enregistrement renvoie 80 EUR (envoye ${r3.envoye ? r3.envoye.price : 'aucun PATCH'})` });
  v.push({ ok: m.erreurs.length === 0, label: `aucune erreur JS dans la page (${m.erreurs.slice(0, 2).join(' | ')})` });
  return v;
}

// CHAQUE REGLE RETIREE, LA VERIFICATION QU ELLE GARDE TOMBE.
const MUTATIONS = [
  {
    nom: 'le prix suit l estimation sans qu on ait rien change',
    de: '  return editProgramAChange() || Number(e.pax) !== Number(r.pax) || editArcadeTimingChanged();',
    vers: '  return true;',
    vise: /^\[A\] prix d ami/,
  },
  {
    nom: 'la fiche oublie le tarif d attente',
    de: '    if (item.waitOffer === true && Number(item.waitPricePerPax) > 0) {',
    vers: '    if (false) {',
    vise: /^\[C\] le detail chiffre chaque ligne/,
  },
  {
    nom: 'la fiche ne sait plus chiffrer le duckpin',
    de: "    if (activite && activite.priceType === 'grid_bowling' && typeof getActivityUnitPlan === 'function') {",
    vers: '    if (false) {',
    vise: /^\[C\] le detail chiffre chaque ligne/,
  },
];

srv.listen(PORT, '127.0.0.1', async () => {
  const b = await chromium.launch({ executablePath: EDGE, headless: true });
  try {
    const mesure = await mesurer(b);
    console.log('9002 apres ouverture :', JSON.stringify(mesure.resultats[9002] && mesure.resultats[9002].apres));
    juger(mesure).forEach((x) => ok(x.ok, x.label));

    console.log('\n[MUTATION] chaque regle retiree du bundle servi, le gate rougit sur SA verification');
    const source = fs.readFileSync(p.join(REPO, 'assets', 'app-main.js'), 'utf8');
    for (const mut of MUTATIONS) {
      const n = source.split(mut.de).length - 1;
      if (!ok(n === 1, `[mutation] l ancre de « ${mut.nom} » existe une seule fois (${n})`)) continue;
      appMute = source.split(mut.de).join(mut.vers);
      let tombes = [];
      try {
        tombes = juger(await mesurer(b)).filter((x) => !x.ok);
      } finally {
        appMute = null;
      }
      const vises = tombes.filter((x) => mut.vise.test(x.label));
      ok(vises.length > 0, `[mutation] « ${mut.nom} » fait tomber sa verification (${vises.length} visee(s) sur ${tombes.length} tombee(s))`);
    }
    ok(appMute === null && fs.readFileSync(p.join(REPO, 'assets', 'app-main.js'), 'utf8') === source, '[mutation] le bundle sur le disque est intact');
  } finally {
    await b.close();
  }
  srv.close(() => {
    console.log('');
    console.log(failures === 0 ? 'GATE VERT' : `GATE ROUGE (${failures} echec(s))`);
    process.exit(failures === 0 ? 0 : 1);
  });
});

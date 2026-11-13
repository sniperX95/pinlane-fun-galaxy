#!/usr/bin/env node
'use strict';
/* ============================================================================
   GATE : la fenetre Reserver reprise dans le detail (2026-11-13)

   Ansar, devant trois maquettes : « aucune ne me plait je prefere encore la
   notre mais juste vraiment tout bien retravailler dans les details techniques
   qui fonctionne super correctement ». Un jury a l aveugle et un audit sur le
   banc ont trouve ce qui suit ; chaque lettre en tient un.

   LE SOIR CHARGE (12 joueurs, laser en 3 parties a 20:00, 12, 10 puis 8) :
   [P1] tout le monde joue chaque partie : le total dit « 25 € par joueur ».
   [P2] 12, 10 puis 8 : personne ne paie 21,33 €, le total dit « en moyenne ».
   [M]  la page du laser : « manque 10 armes » tient sur deux lignes dans sa
        touche (« manque / 10 / armes » avant).
   [A1] le bowling AJOUTE se pose a la premiere heure qui tient apres le laser
        (22:00 ; « juste après », 21:30, manque une piste). Il partait a 15:00,
        l heure du bowling propose a l ouverture.
   [R1] le laser a 20:30 dit ce qui reste : la partie 3 n a que 8 joueurs (le
        compte prenait 12 a chaque partie et la touche restait muette).
   [T2] le bowling fixe a 22:00 : le laser a 22:30 dit « pendant le bowling »
        (le compte de la fin de visite, parti de l heure du laser, disait « trop
        tard » ; la vraie raison est le bowling).
   [C2] la partie 2 posee a 22:00 tomberait sur le bowling : « pendant le
        bowling », jamais « groupe occupé ».
   [R2] les parties 2 et 3 disent ce qui reste sous leur heure.
   [L1] le ticket : « il ne restera aucune piste » (« il restera 0 piste »).
   [C1] « groupe occupé » sans rien qui chevauche a l ecran (le moteur replace
        l activite d apres et retombe sur le laser) se dit par le vrai manque de
        l heure : « manque 1 arme » a 15:30.
   LE BOWLING PRIS QUAND MEME A 21:30 (il suit le laser) :
   [T1] 22:00 et 22:30 disent « trop tard » : le bowling d apres finirait apres
        minuit, la fenetre n envoyait rien et la touche restait grise, sans un
        mot.
   [F1] le refus est sous la ligne du bowling, pas au-dessus du total, et ne se
        redit pas sous chaque heure (« bowling, manque 1 piste ») : le laser a
        15:30 dit son propre manque.
   [F2] un refus du serveur qui ne parle que du bowling deja en defaut laisse
        l heure du laser dire son manque (« manque 6 armes », vu muet au
        telephone a 17:30) ; sans manque, elle ne le redit pas.
   [S1] le ticket qui a une suite sous son bord s estompe ; le telephone se voit
        en entier.
   [E1] « Créer quand même » ne montre pas « Entrée ».
   [E2] le numero tape puis Entree ne cree rien : le dossier « à placer » se
        cree au toucher de son bouton seulement.
   [E3] « Prendre 22:00 à la place » prend 22:00 d un toucher.
   DEMAIN, 8 JOUEURS :
   [A2] le bowling ajoute apres le laser de 15:00 se pose « juste après »
        (15:30), pas a 10:00, l ouverture.
   UNE FORMULE :
   [FO] chaque touche d heure garde son texte dedans (deux restes par touche).
   [*]  Zero erreur JavaScript.

   Le banc est celui de fenetre-reserver-defauts-check : la VRAIE console
   (planning-v3-fixtures, le samedi 16 janvier 2027 a 15:10, 46 groupes), le
   VRAI handler api/staff-reservations.js et le vrai moteur (reserver-banc, base
   en memoire). Chaque toucher est un vrai clic. Le gate asserte d abord son
   MONTAGE, puis la regle.

   CONTRE-PREUVES : `--contre-preuves` sert le code d avant, une regle a la fois
   (le disque n est jamais touche), et exige que chacune rougisse sa cible ;
   `--tranche=K/N` n en joue qu une part. `--ancres` verifie chaque ancre.

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
const { trancher } = require('./gates-tranche');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_DETAILS_PORT || 4947);
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HEURE = '15:10';
const APP = 'assets/app-main.js';
const CSS = 'assets/pinlane-staff.css';
const lf = (t) => String(t).split('\r\n').join('\n');

// LE CODE D AVANT, une regle a la fois. `cible` : la lettre qui doit rougir.
const MUTATIONS = [
  { nom: 'ajout-liste-recente', cible: 'A1', fichier: APP, de: "remplace ? { liste: [], suite: '' } : rsListeBloc(id, { frais: true });", vers: "remplace ? { liste: [], suite: '' } : rsListeBloc(id);" },
  { nom: 'ajout-demain-ouverture', cible: 'A2', fichier: APP, de: "remplace ? { liste: [], suite: '' } : rsListeBloc(id, { frais: true });", vers: "remplace ? { liste: [], suite: '' } : rsListeBloc(id);" },
  { nom: 'reste-du-groupe-entier', cible: 'R1', fichier: APP, de: 'return rsPlaceDesDeparts(rvEcartsLaser().map((minutes, k) => [numToTime((base + minutes) / 60), Number(parPartie[k]) || joueurs]));', vers: 'return rsPlaceDesDeparts(rvEcartsLaser().map((minutes, k) => [numToTime((base + minutes) / 60), joueurs]));' },
  { nom: 'heure-sans-dossier-muette', cible: 'T1', fichier: APP, de: '        else sansDossier.push(rvRefusDeLaVariante(id, 0, heure));\n', vers: '' },
  { nom: 'trop-tard-avant-le-bowling', cible: 'T2', fichier: APP, de: '  return coince && coince.local && pendant && !pendant.suit ? null : coince;', vers: '  return coince;' },
  { nom: 'partie-sans-chevauchement', cible: 'C2', fichier: APP, de: '  if (!plages || !plages.lignes.laser_game) return null;', vers: '  return null;' },
  { nom: 'parties-sans-reste', cible: 'R2', fichier: APP, de: ": motPendant || rsResteDit(x.place).replace(/ armes?$/, '');", vers: ': motPendant;' },
  { nom: 'il-restera-zero', cible: 'L1', fichier: APP, de: "  const liste = (mots || []).filter(Boolean);\n  if (!liste.length) return '';", vers: "  const liste = (mots || []).filter(Boolean);\n  if (liste.length) return `il restera ${liste.join(', ')}`;" },
  { nom: 'refus-sans-activite', cible: 'F1', fichier: APP, de: "  const candidate = nomme ? (nomme.type === 'arene' ? 'laser_game' : 'bowling') : parType ? (parType.type === 'bowling_conflict' ? 'bowling' : 'laser_game') : parPhrase || (ids.length === 1 ? ids[0] : '');", vers: "  const candidate = nomme ? (nomme.type === 'arene' ? 'laser_game' : 'bowling') : ids.length === 1 ? ids[0] : '';" },
  { nom: 'chevauchement-groupe-occupe', cible: 'C1', fichier: APP, de: "  if (!coince || coince.court !== 'groupe occupé' || pendant || !x) return null;", vers: '  return null;' },
  { nom: 'refus-deja-muet', cible: 'F2', fichier: APP, de: '  if (!place || !(place.manque > 0)) return null;', vers: '  return null;' },
  { nom: 'ticket-sans-fondu', cible: 'S1', fichier: APP, de: "  const zone = document.querySelector('.qb-modal.rv .rs-tk-c');\n  if (!zone) return;", vers: "  const zone = document.querySelector('.qb-modal.rv .rs-tk-c');\n  return;" },
  { nom: 'entree-affichee', cible: 'E1', fichier: APP, de: '  const entree = !(s.submitting || bloque || attente) && !(refuse && s.forcer && !lot);', vers: '  const entree = !(s.submitting || bloque || attente);' },
  { nom: 'entree-cree-quand-meme', cible: 'E2', fichier: APP, de: '  if (rsEntreeCree()) rsCreer();\n}', vers: '  rsCreer();\n}' },
  { nom: 'lien-sans-reprise', cible: 'E3', fichier: APP, de: '  if (reprise) rsPrendreProche();\n', vers: '' },
  { nom: 'total-sans-moyenne', cible: 'P2', fichier: APP, de: '  if (!s || (rvFormule() && !s.adaptee)) return false;', vers: '  return false;' },
  { nom: 'mot-sur-trois-lignes', cible: 'M', fichier: CSS, de: '.qb-modal.rv.rs .rs-choix.is-heures .rs-p { padding-left: 4px; padding-right: 4px; }', vers: '' },
  { nom: 'touche-formule-figee', cible: 'FO', fichier: CSS, de: '.qb-modal.rv.rs .rs-s-l.is-formule { --rs-h-min: 100px; }\n.qb-modal.rv.rs .rs-s-l.is-formule .rs-h { height: auto; min-height: 62px; padding: 6px 4px; }', vers: '.qb-modal.rv.rs .rs-s-l.is-formule .rs-h { height: 62px; }' },
];

// L etape du soir charge ou chaque lettre se juge : une contre-preuve s arrete la.
const ETAPE = { P1: 1, P2: 1, M: 1, A1: 2, R1: 2, T2: 2, C2: 2, R2: 2, L1: 2, C1: 2, T1: 3, F1: 3, F2: 3, S1: 3, E1: 3, E2: 4, E3: 5 };

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
// LE MONTAGE (celui de fenetre-reserver-defauts-check)
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
  // (les creations, pas les plans a blanc : ce qu Entree a vraiment envoye, [E2])
  await page.evaluate(() => {
    const avant = window.fetch;
    window.__creations = [];
    window.fetch = async (input, init) => {
      init = init || {};
      const u = new URL(typeof input === 'string' ? input : input.url, location.origin);
      const me = String(init.method || (typeof input === 'object' && input.method) || 'GET').toUpperCase();
      const json = (corps, status = 200) => new Response(JSON.stringify(corps), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'surMesureCatalogue') return json({ ok: true, centerId: 'libramont', surMesure: { categories: [], articles: [] } });
      if (u.pathname === '/api/staff-reservations' && me !== 'PATCH') {
        const corps = init.body ? JSON.parse(init.body) : undefined;
        if (me === 'POST' && corps && !corps.dryRun) window.__creations.push({ forcer: Boolean(corps.forcer || (Array.isArray(corps.reservations) && corps.reservations.some((r) => r && r.forcer))) });
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
// Le plan du ticket est la (refuse ou non), le repeint passe.
const plan = async (page) => {
  await page.waitForFunction(() => quickBookState && quickBookState.plan && quickBookState.plan.etat !== 'calcul' && quickBookState.plan.cle === quickBookState.cleCourante, null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(400);
};
const lues = (page, id) => page.waitForSelector(`.rs-s-l[data-verifie="1"] [data-activite="${id}"]`, { timeout: 8000 }).catch(() => {});
const partiesLues = (page) => page.waitForSelector('.rs-parties .rs-s-l[data-verifie="1"]', { timeout: 8000 }).catch(() => {});
const lignes = (page) => page.evaluate(() => JSON.parse(JSON.stringify(rvHeuresDesLignes())));
// Une touche d heure : son mot, son ton, la place de son texte.
const lire = (page, selecteur) => page.evaluate((s) => {
  const b = document.querySelector(s);
  if (!b) return null;
  const rb = b.getBoundingClientRect();
  const smalls = [...b.querySelectorAll('small')].filter((x) => x.getClientRects().length);
  const lh = (x) => parseFloat(getComputedStyle(x).lineHeight) || 14;
  return {
    mot: smalls.map((x) => x.textContent.trim()).join(' | '),
    lignes: Math.max(0, ...smalls.map((x) => Math.round(x.getBoundingClientRect().height / lh(x)))),
    dedans: [...b.querySelectorAll('b, small')].every((x) => { const r = x.getBoundingClientRect(); return r.left >= rb.left - 1 && r.right <= rb.right + 1 && r.top >= rb.top - 1 && r.bottom <= rb.bottom + 1; }),
    coince: b.classList.contains('is-coince'),
    pendant: b.classList.contains('is-pendant'),
    on: b.classList.contains('is-on'),
  };
}, selecteur);
const bloc = (id, heure) => `.rs-s-l [data-activite="${id}"][data-heure="${heure}"]`;
const partie = (k, heure) => `.rs-parties .rs-h[data-partie="${k}"][data-heure-p="${heure}"]`;
const sousTotal = (page) => page.evaluate(() => ((document.querySelector('#rsL-total small') || {}).textContent || '').trim());
const motsDesHeures = (page) => page.evaluate(() => [...document.querySelectorAll('.qb-modal.rv .rs-h small, .qb-modal.rv .rs-p small')].filter((x) => x.getClientRects().length).map((x) => x.textContent.trim()));

// ---------------------------------------------------------------------------
// LE SOIR CHARGE : [P1] [P2] [M] [A1] [R1] [T1] [C2] [R2] [L1] [F1] [F2] [C1] [S1] [E1] [E2] [E3]
// ---------------------------------------------------------------------------
async function scenarioSoir(browser, lettres) {
  const jusqua = Math.max(...lettres.map((x) => ETAPE[x] || 0));
  if (!jusqua) return;
  const voit = (x) => lettres.includes(x);
  const m = await ouvrirConsole(browser);
  const { page } = m;
  try {
    await page.locator('.btn-new').click();
    await page.locator('#rsHaut [data-pax="12"]').click();
    await pret(page);
    await page.locator('#rsAjout-laser_game').click();
    await lues(page, 'laser_game');
    await page.locator('#rsL-a-laser_game').click();
    await page.waitForSelector('.rs-rang.is-heures');
    await page.locator('[data-parties="3"]').click();
    await plan(page);
    await page.locator('.rs-rang.is-heures [data-heure-l="20:00"]').click();
    await pret(page);
    const l0 = await lignes(page);
    ok(l0.laser_game && l0.laser_game.heure === '20:00' && (await page.evaluate(() => rvPartiesLaser())) === 3, '[*] montage : 12 joueurs, le laser en 3 parties a 20:00', l0);
    if (voit('P1')) ok(/^25\s*€ par joueur$/.test(await sousTotal(page)), '[P1] tout le monde a chaque partie : le total dit « 25 € par joueur », sans « en moyenne »', await sousTotal(page));
    for (let i = 0; i < 2; i += 1) { await page.locator('[data-partie-joueurs="2"][aria-label$="un de moins"]').click(); await page.waitForTimeout(150); }
    for (let i = 0; i < 4; i += 1) { await page.locator('[data-partie-joueurs="3"][aria-label$="un de moins"]').click(); await page.waitForTimeout(150); }
    await pret(page);
    const liste = await page.evaluate(() => rsJoueursDesParties());
    ok(JSON.stringify(liste) === '[12,10,8]', '[*] montage : 12, 10 puis 8 joueurs', liste);
    if (voit('P2')) ok(/^21,33\s*€ par joueur en moyenne$/.test(await sousTotal(page)), '[P2] 12, 10 puis 8 : le total dit « 21,33 € par joueur en moyenne »', await sousTotal(page));
    if (voit('M')) {
      await page.waitForSelector('.rs-rang.is-heures [data-heure-l="19:30"] small', { timeout: 8000 }).catch(() => {});
      const t = await lire(page, '.rs-rang.is-heures [data-heure-l="19:30"]');
      ok(Boolean(t) && t.mot === 'manque 10 armes', '[M] montage : 19:30, sur la page du laser, dit « manque 10 armes »', t);
      ok(Boolean(t) && t.lignes <= 2 && t.dedans, '[M] « manque 10 armes » tient sur deux lignes, dans sa touche', t);
    }
    if (jusqua < 2) return;

    // Le bowling ajoute apres le laser.
    await page.locator('.rs-retour, [onclick^="rsRetour"]').first().click();
    await page.locator('#rsAjout-bowling').click();
    await lues(page, 'bowling');
    await plan(page);
    await lues(page, 'laser_game');
    await partiesLues(page);
    await page.waitForTimeout(400);
    const l1 = await lignes(page);
    const juste = await lire(page, bloc('bowling', '21:30'));
    ok(Boolean(juste) && /manque 1 piste/.test(juste.mot), '[*] montage : « juste après » le laser (21:30), il manque une piste au bowling', juste);
    if (voit('A1')) ok(l1.bowling && l1.bowling.heure === '22:00', '[A1] le bowling ajoute se pose a 22:00, la premiere heure qui tient apres le laser', l1.bowling);
    if (voit('R1')) {
      const t = await lire(page, bloc('laser_game', '20:30'));
      ok(Boolean(t) && /^reste \d+$/.test(t.mot), '[R1] le laser a 20:30 dit ce qui reste (la partie 3 n a que 8 joueurs)', t);
    }
    if (voit('T2')) {
      const t = await lire(page, bloc('laser_game', '22:30'));
      ok(Boolean(t) && t.mot === 'pendant le bowling' && t.coince, '[T2] avec le bowling fixe a 22:00, le laser a 22:30 dit « pendant le bowling », pas « trop tard »', t);
    }
    if (voit('C2')) {
      const t = await lire(page, partie(1, '22:00'));
      const mots = await motsDesHeures(page);
      ok(Boolean(t) && t.mot === 'pendant le bowling' && t.coince, '[C2] la partie 2 a 22:00 dit « pendant le bowling »', t);
      ok(!mots.some((x) => /groupe occupé/.test(x)), '[C2] aucune heure ne dit « groupe occupé »', mots.filter((x) => /groupe/.test(x)));
    }
    if (voit('R2')) {
      const deux = await lire(page, '.rs-parties .rs-h.is-on[data-partie="1"]');
      const trois = await lire(page, '.rs-parties .rs-h.is-on[data-partie="2"]');
      ok([deux, trois].every((t) => t && /reste \d+$/.test(t.mot)), '[R2] les parties 2 et 3 disent ce qui reste sous leur heure', { deux, trois });
    }
    if (voit('L1')) {
      const apres = await page.evaluate(() => ((document.querySelector('#rsL-a-bowling .is-apres') || {}).textContent || '').trim());
      ok(apres === 'il ne restera aucune piste', '[L1] le ticket dit « il ne restera aucune piste »', apres);
    }
    if (voit('C1')) {
      // Le verdict que le moteur rend quand l activite d apres retombe sur le laser (lu au banc le
      // 2026-11-13) : « groupe occupé », sans rien qui chevauche a l ecran. La touche lit le manque de
      // CETTE heure, compte par ce poste.
      const c = await page.evaluate(() => {
        const verdict = { statut: 'ko', court: 'groupe occupé', activite: 'bowling', raison: 'Bowling (15:00-16:00) et Laser Game (partie 1) (15:30) se chevauchent : décalez l\'une des deux heures.' };
        const x = { heure: '15:30', verdict, place: rsPlaceLaser('15:30') };
        const plages = rsPlagesDuTicket();
        return { manque: x.place ? x.place.manque : null, pendant: rsPendant('laser_game', '15:30', plages), refus: rvRefusDuPlan(), mot: rsMotDeLHeure('laser_game', x, plages) };
      });
      ok(c.manque === 1 && !c.pendant && !c.refus, '[C1] montage : a 15:30 il manque 1 arme, rien ne chevauche a l ecran, le ticket tient', c);
      ok(c.mot === 'manque 1 arme', '[C1] « groupe occupé » sans chevauchement a l ecran se dit « manque 1 arme »', c.mot);
    }
    if (jusqua < 3) return;

    // Le bowling pris quand meme a 21:30, ou il manque une piste.
    await page.locator(bloc('bowling', '21:30')).click();
    await plan(page);
    await lues(page, 'laser_game');
    await page.waitForTimeout(500);
    const f = await page.evaluate(() => ({ forcer: Boolean(quickBookState.forcer), refuse: Boolean(rvPlanCourant() && !rvPlanCourant().disponible), creer: (document.getElementById('rvCreer') || {}).textContent.trim() }));
    ok(f.forcer && f.refuse && /^Créer quand même à 20:00/.test(f.creer), '[*] montage : le bowling pris quand meme a 21:30, le plan refuse', f);
    if (voit('F1')) {
      const r = await page.evaluate(() => {
        const sous = document.querySelector('#rsL-a-bowling #rvRefus');
        const dessus = [...document.querySelectorAll('#rvVerdict .rs-v-ligne.is-ko')].filter((x) => x.getClientRects().length);
        return { sous: sous && sous.getClientRects().length ? sous.textContent.trim() : '', dessus: dessus.map((x) => x.textContent.trim()) };
      });
      const mots = await motsDesHeures(page);
      ok(/pistes/.test(r.sous) && !r.dessus.length, '[F1] le refus des pistes est sous la ligne du bowling, rien en rouge au-dessus du total', r);
      ok(!mots.some((x) => /^bowling, /.test(x)), '[F1] aucune heure du laser ne redit « bowling, manque 1 piste »', mots.filter((x) => /^bowling/.test(x)));
    }
    if (voit('T1')) {
      const a = await lire(page, bloc('laser_game', '22:00'));
      const b = await lire(page, bloc('laser_game', '22:30'));
      ok([a, b].every((t) => t && t.mot === 'trop tard' && t.coince), '[T1] le bowling suit le laser : 22:00 et 22:30 disent « trop tard », dans le ton du refus', { a, b });
    }
    if (voit('F1')) {
      const t = await lire(page, bloc('laser_game', '15:30'));
      ok(Boolean(t) && t.mot === 'manque 1 arme' && t.coince, '[F1] le laser a 15:30 dit son manque (« manque 1 arme »), pas le refus du bowling', t);
    }
    if (voit('F2')) {
      // Le verdict lu au banc en 390 px (2026-11-13) : le serveur replace le bowling pris quand meme
      // et ne cite que lui ; le laser a 17:30 manque lui-meme de 6 armes, la touche restait muette.
      const m = await page.evaluate(() => {
        const plages = rsPlagesDuTicket();
        const verdict = { statut: 'ko', court: 'groupe occupé', activite: 'bowling', raison: 'Bowling (17:00-18:00) et Laser Game (17:30) se chevauchent : décalez l\'une des deux heures.' };
        const manque = { heure: '17:30', verdict, place: { libre: 0, manque: 6, unite: 'arme' }, mot: '' };
        const reste = { heure: '17:30', verdict, place: { libre: 18, manque: 0, unite: 'arme' }, mot: 'reste 18' };
        return { refus: (rvRefusDuPlan() || {}).activite || '', manque: rsMotDeLHeure('laser_game', manque, plages), coince: Boolean(rsCoince(manque, 'laser_game')), reste: rsMotDeLHeure('laser_game', reste, plages), resteCoince: Boolean(rsCoince(reste, 'laser_game')) };
      });
      ok(m.refus === 'bowling' && m.manque === 'manque 6 armes' && m.coince, '[F2] un refus qui ne parle que du bowling laisse l heure dire son manque (« manque 6 armes »), dans le ton du refus', m);
      ok(m.reste === 'reste 18' && !m.resteCoince, '[F2] sans manque, l heure ne redit pas le refus du bowling (« reste 18 »)', m);
    }
    if (voit('S1')) {
      await page.waitForTimeout(200);
      const z = await page.evaluate(() => {
        const zone = document.querySelector('.qb-modal.rv .rs-tk-c');
        const tel = document.getElementById('qbPhone');
        const rz = zone.getBoundingClientRect();
        const rt = tel.getBoundingClientRect();
        return { cache: zone.scrollHeight - zone.clientHeight - zone.scrollTop, fondu: zone.classList.contains('a-suite'), masque: getComputedStyle(zone).maskImage || getComputedStyle(zone).webkitMaskImage || '', telEntier: rt.top >= rz.top - 0.5 && rt.bottom <= rz.bottom + 0.5 };
      });
      ok(z.cache > 2, '[S1] montage : le ticket a une suite sous son bord (l alerte prend sa place)', z);
      ok(z.fondu && /gradient/.test(z.masque) && z.telEntier, '[S1] son bas s estompe, et le telephone se voit en entier', z);
    }
    if (voit('E1')) {
      const kbd = await page.evaluate(() => Boolean(document.querySelector('#rvCreer kbd')));
      ok(!kbd, '[E1] « Créer quand même » ne montre pas « Entrée »');
    }
    if (jusqua < 4) return;

    await page.fill('#qbPhone', '0470 12 34 56');
    await page.locator('#qbPhone').press('Enter');
    await page.waitForTimeout(1500);
    if (voit('E2')) {
      const e = await page.evaluate(() => ({ creations: window.__creations.length, ouverte: Boolean(quickBookState) }));
      ok(e.creations === 0 && e.ouverte, '[E2] le numero puis Entree ne cree rien : la fenetre reste ouverte', e);
    }
    if (jusqua < 5) return;

    const lien = await page.evaluate(() => ((document.getElementById('rvForcer') || {}).textContent || '').trim());
    ok(lien === 'Prendre 22:00 à la place', '[*] montage : le lien dit « Prendre 22:00 à la place »', lien);
    await page.locator('#rvForcer').click();
    await pret(page);
    await page.waitForTimeout(300);
    if (voit('E3')) {
      const e = await page.evaluate(() => ({ bowling: (rvHeuresDesLignes().bowling || {}).heure, forcer: Boolean(quickBookState.forcer), creer: (document.getElementById('rvCreer') || {}).textContent.trim() }));
      ok(e.bowling === '22:00' && !e.forcer && /^Créer à 20:00\s*Entrée$/.test(e.creer), '[E3] « Prendre 22:00 à la place » prend 22:00 d un toucher : Créer revient, avec Entrée', e);
    }
  } finally {
    ok(m.erreurs.length === 0, '[*] zero erreur JavaScript (soir charge)', m.erreurs.slice(0, 3).join(' | '));
    await m.ctx.close();
  }
}

// ---------------------------------------------------------------------------
// [A2] DEMAIN : LE BOWLING JUSTE APRES
// ---------------------------------------------------------------------------
async function scenarioDemain(browser) {
  const m = await ouvrirConsole(browser);
  const { page } = m;
  try {
    await page.locator('.btn-new').click();
    await page.locator('#rsHaut [data-pax="8"]').click();
    await pret(page);
    await page.locator('#rsHaut button', { hasText: 'Demain' }).first().click();
    await pret(page);
    await page.locator('#rsAjout-laser_game').click();
    await lues(page, 'laser_game');
    await page.locator(bloc('laser_game', '15:00')).click();
    await pret(page);
    const l0 = await lignes(page);
    ok(l0.laser_game && l0.laser_game.heure === '15:00' && !l0.bowling, '[*] montage : demain, le laser seul a 15:00', l0);
    await page.locator('#rsAjout-bowling').click();
    await lues(page, 'bowling');
    await pret(page);
    const juste = await lire(page, bloc('bowling', '15:30'));
    ok(Boolean(juste) && /^reste \d+$/.test(juste.mot), '[*] montage : « juste après » le laser (15:30), le bowling tient', juste);
    const l1 = await lignes(page);
    ok(l1.bowling && l1.bowling.heure === '15:30' && l1.bowling.foulee === true, '[A2] le bowling ajoute se pose « juste après » le laser, a 15:30, pas a l ouverture', l1.bowling);
  } finally {
    ok(m.erreurs.length === 0, '[*] zero erreur JavaScript (demain)', m.erreurs.slice(0, 3).join(' | '));
    await m.ctx.close();
  }
}

// ---------------------------------------------------------------------------
// [FO] UNE FORMULE : CHAQUE TOUCHE GARDE SON TEXTE DEDANS
// ---------------------------------------------------------------------------
async function scenarioFormule(browser) {
  const m = await ouvrirConsole(browser);
  const { page } = m;
  try {
    await page.locator('.btn-new').click();
    await page.locator('#rsHaut [data-pax="10"]').click();
    await pret(page);
    await page.locator('#rsCorps button', { hasText: 'Formules' }).first().click();
    await page.waitForSelector('.rs-fs-g button');
    await page.locator('.rs-fs-g button').first().click();
    await page.waitForSelector('.rs-s-l.is-formule[data-verifie="1"]', { timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(400);
    const touches = await page.evaluate(() => [...document.querySelectorAll('.rs-s-l.is-formule .rs-h[data-heure]')].map((b) => {
      const rb = b.getBoundingClientRect();
      const mots = [...b.querySelectorAll('small')].map((x) => x.textContent.trim());
      const dedans = [...b.querySelectorAll('b, small')].every((x) => { const r = x.getBoundingClientRect(); return r.left >= rb.left - 1 && r.right <= rb.right + 1 && r.top >= rb.top - 1 && r.bottom <= rb.bottom + 1; });
      return { heure: b.dataset.heure, mots, dedans };
    }));
    const deux = touches.filter((x) => x.mots.length === 2);
    ok(deux.length >= 5, '[FO] montage : des heures de la formule disent deux restes (pistes et armes)', touches.slice(0, 4));
    ok(deux.length >= 5 && touches.every((x) => x.dedans), '[FO] chaque touche d heure de la formule garde son texte dedans', touches.filter((x) => !x.dedans).map((x) => x.heure));
  } finally {
    ok(m.erreurs.length === 0, '[*] zero erreur JavaScript (formule)', m.erreurs.slice(0, 3).join(' | '));
    await m.ctx.close();
  }
}

async function jouer(browser, lettres) {
  await scenarioSoir(browser, lettres);
  if (lettres.includes('A2')) await scenarioDemain(browser);
  if (lettres.includes('FO')) await scenarioFormule(browser);
}

(async () => {
  if (argument('ancres')) {
    const mauvaises = MUTATIONS.filter((m) => compterAncre(m) !== 1);
    mauvaises.forEach((m) => console.log(`FAIL  ancre ${m.nom} trouvee ${compterAncre(m)} fois dans ${m.fichier}`));
    console.log(`fenetre-reserver-details-check --ancres : ${MUTATIONS.length - mauvaises.length}/${MUTATIONS.length} uniques`);
    process.exit(mauvaises.length ? 1 : 0);
  }
  const toutes = [...Object.keys(ETAPE), 'A2', 'FO'];
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
      const liste = trancher(MUTATIONS);
      for (const m of liste) {
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
      console.log(`\n${liste.length - muettes}/${liste.length} contre-preuves mordent`);
      code = muettes ? 1 : 0;
    }
  } finally {
    await browser.close();
    http.close();
  }
  process.exit(code);
})().catch((e) => { console.error(e); process.exit(1); });

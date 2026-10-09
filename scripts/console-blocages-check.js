#!/usr/bin/env node
'use strict';
// =============================================================================
// LES HORAIRES RETENUS EN LIGNE, VUS DE LA CONSOLE (planning bowling et laser)
// -----------------------------------------------------------------------------
// Movsar, 2026-09-29 : un client qui choisit ses horaires les bloque dix
// minutes, « et ca bloque vraiment ». Au comptoir, l equipe doit le voir :
// sinon une piste libre a l ecran est refusee par le serveur, sans raison
// visible.
//
// Le serveur est le vrai : scripts/slot-holds-check.js sert de banc (handler
// public, verrou, table en memoire, lecture staff-state). Un groupe reserve la
// piste 1 a 14:00 ; un client en ligne retient un bowling a 14:00 (le serveur
// lui donne une autre piste), un autre un laser a 16:00 pour 10. La console
// (index.html reel, Edge headless, pouls vivant) recoit la journee telle que
// staff-state la sert :
//   [A] LE BLOCAGE ARRIVE pendant que le planning est ouvert : une carte « En
//       ligne » apparait sans rechargement, sur la piste que le serveur a
//       retenue, a l heure, avec l heure ou elle se libere ; elle recouvre les
//       cases (aucune reservation ne s y lance) ; ce n est pas une reservation
//       du poste, et le vrai groupe reste a sa place.
//   [B] LE PLANNING LASER compte les 10 joueurs dans la capacite du lancement,
//       avec une carte en attente, sans action.
//   [C] L ECHEANCE : un blocage echu ne se dessine plus, meme avant la
//       prochaine lecture ; et quand le serveur ne le sert plus (le pouls fait
//       relire la journee), il disparait du planning laser et rend ses armes.
//   [D] CONTRE-EPREUVES : le code de la console casse une regle a la fois
//       (servi en memoire, le disque n est jamais touche) ; ce gate ROUGIT.
//
// AUCUNE BASE, AUCUN ENVOI.
// =============================================================================
const fs = require('fs');
const http = require('http');
const path = require('path');

delete process.env.RESEND_API_KEY;
delete process.env.POSTGRES_URL;

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PINLANE_CONSOLE_BLOCAGES_PORT || 4402);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CAPTURES = process.env.PINLANE_CONSOLE_BLOCAGES_CAPTURES || '';
const DELAI = 6000;
const LF = String.fromCharCode(10);

// Le banc d abord : il remplace pg par la base en memoire avant tout require
// de lib/.
const banc = require('./slot-holds-check.js');
const S = banc.charger();
const dev = require('./dev-console-server.js');
const { listCentersForSession } = require('../lib/center-scope.js');

let echecs = 0;
let bavard = true;
const verdicts = {};
function ok(cond, cle, label, detail) {
  verdicts[cle] = Boolean(cond) && verdicts[cle] !== false;
  if (bavard) console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond && bavard) echecs += 1;
  return Boolean(cond);
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const attendre = (page, fn, arg, ms = DELAI) => page.waitForFunction(fn, arg, { timeout: ms, polling: 100 }).then(() => true).catch(() => false);
const heureBruxelles = (iso) => new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' });

// ---------------------------------------------------------------------------
// LES CONTRE-EPREUVES : le code de la console, casse une regle a la fois.
// ---------------------------------------------------------------------------
const MUTATIONS = [
  {
    nom: 'la journee lue ne garde pas ses blocages',
    de: '    memoriserBlocagesEnLigne(getCurrentStaffCenterId(), dateStr, payload.holds);\n',
    vers: '',
    cible: 'arrive',
  },
  {
    nom: 'la carte en attente n est plus posee sur la piste',
    de: '      ${holdHtml}\n',
    vers: '',
    cible: 'arrive',
  },
  {
    nom: 'un blocage qui arrive ne change pas la signature du planning',
    de: '    blocagesEnLigne: getBlocagesEnLigne(dateStr).map(b => `${b.id}@${b.blocage.expiresAt}`),\n',
    vers: '',
    cible: 'signature',
  },
  {
    nom: 'un blocage echu se dessine encore',
    de: '    .filter(b => Date.parse(b.blocage.expiresAt) > maintenant);\n',
    vers: '    ;\n',
    cible: 'echu',
  },
  {
    nom: 'le planning laser ignore les blocages',
    de: '  const enLigne = getBlocagesEnLigne(jour).flatMap(',
    vers: '  const enLigne = [].flatMap(',
    cible: 'laser',
  },
  {
    nom: 'la carte tient sur une ligne',
    fichier: 'assets/pinlane-staff.css',
    de: '.planning-hold__txt { display: flex; flex-direction: column; min-width: 0; }\n',
    vers: '.planning-hold__txt { display: block; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }\n',
    cible: 'arrive',
  },
];
let casse = null;
const fichierDe = (m) => m.fichier || 'assets/app-main.js';

// ---------------------------------------------------------------------------
// LE SERVEUR : la console (fichiers du depot, serveur de developpement), la
// journee servie par le banc, le pouls qui dit quand elle a change.
// ---------------------------------------------------------------------------
const serveurJour = { etat: null, version: 0, lectures: 0 };
function servirJournee(etat) {
  serveurJour.etat = JSON.parse(JSON.stringify({ ok: true, ...etat }));
  serveurJour.version += 1;
}

function serveur() {
  const interne = dev.creerServeur(dev.creerRepondeurFixtures({ origine: BASE_URL }));
  const servir = interne.listeners('request')[0];
  return http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    if (casse && url.pathname === `/${fichierDe(casse)}`) {
      const src = fs.readFileSync(path.join(ROOT, fichierDe(casse)), 'utf8').split(String.fromCharCode(13) + LF).join(LF);
      res.writeHead(200, { 'Content-Type': `${fichierDe(casse).endsWith('.css') ? 'text/css' : 'text/javascript'}; charset=utf-8`, 'Cache-Control': 'no-store' });
      res.end(src.split(casse.de).join(casse.vers));
      return;
    }
    servir(req, res);
  });
}

function reponseJson(route, corps) {
  return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Cache-Control': 'no-store' }, body: JSON.stringify(corps) });
}

async function brancher(ctx, centres) {
  await ctx.route('**/api/ops**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const action = url.searchParams.get('action') || '';
    if (req.method() === 'GET' && action === 'pulse') {
      const date = url.searchParams.get('date') || '';
      const domaines = {};
      ['communications', 'suggestions', 'evenements', 'prises', 'reservations', 'pistes', 'blocages', 'demandes', 'catalogue', 'config', 'equipe', 'notes', 'courrier']
        .forEach((nom) => { domaines[nom] = `${nom}-0`; });
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) domaines[`jour:${date}`] = `jour-${date === banc.JOUR ? serveurJour.version : 0}`;
      return reponseJson(route, { ok: true, centerId: dev.CENTER_ID, domaines, empreinte: Object.values(domaines).join('.') });
    }
    if (req.method() === 'GET' && action === 'centerConfig') return reponseJson(route, { ok: true, activities: [], centers: centres });
    if (req.method() === 'GET' && action === 'listAvailabilityBlocks') return reponseJson(route, { ok: true, blocks: [] });
    return route.continue();
  });
  await ctx.route('**/api/staff-state**', async (route) => {
    const url = new URL(route.request().url());
    const date = url.searchParams.get('date') || '';
    if (url.searchParams.get('days')) return reponseJson(route, { ok: true, centerId: dev.CENTER_ID, endDate: date, days: [] });
    if (date !== banc.JOUR || !serveurJour.etat) {
      return reponseJson(route, { ok: true, date, centerId: dev.CENTER_ID, reservations: [], laneStatuses: {}, laneMaintenance: {}, revision: `vide-${date}` });
    }
    serveurJour.lectures += 1;
    return reponseJson(route, serveurJour.etat);
  });
  await ctx.route('**/api/staff-auth**', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const reponse = await route.fetch();
    const corps = await reponse.json();
    // Les deux plannings demandent leurs droits : la session du gate les porte.
    if (corps && corps.session) corps.session.permissions = [...new Set([...(corps.session.permissions || []), 'planning.bowling', 'planning.laser', 'reservations.quick'])];
    return route.fulfill({ response: reponse, json: corps });
  });
}

async function ouvrir(browser, centres) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'Europe/Brussels' });
  await brancher(ctx, centres);
  const page = await ctx.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String((e && e.message) || e)));
  await page.addInitScript(({ jour }) => {
    try { localStorage.setItem('funGalaxy_v4', JSON.stringify({ view: 'staff', staffMenuPage: 'planning', currentDate: jour, staffTheme: 'light' })); } catch (e) { /* stockage indisponible */ }
  }, { jour: banc.JOUR });
  await page.goto(`${BASE_URL}/#/staff/planning`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof state === 'object' && state && state.view === 'staff' && typeof window.synchroniserLaConsole === 'function', null, { timeout: 20000 });
  // Le temoin : s il survit, aucun rechargement n a eu lieu.
  await page.evaluate(() => { window.__temoinBlocages = 'pose'; });
  return { ctx, page, erreurs };
}

// Une capture a l arret (les cartes redessinees jouent leur entree), l element
// qui compte dans l ecran.
async function capture(page, nom, sel) {
  // Les contre-epreuves ne photographient rien : la capture montre le code du
  // depot, jamais une version cassee expres.
  if (!CAPTURES || casse) return;
  try {
    await attendre(page, () => document.getAnimations().every((a) => a.playState !== 'running'
      || (a.effect && a.effect.getTiming().iterations === Infinity)), null, 4000);
    if (sel) await page.evaluate((s) => { const e = document.querySelector(s); if (e) e.scrollIntoView({ block: 'center' }); }, sel);
    await pause(300);
    fs.mkdirSync(CAPTURES, { recursive: true });
    await page.screenshot({ path: path.join(CAPTURES, `${nom}.png`) });
  } catch (error) { /* la capture n est pas une verification */ }
}

// ---------------------------------------------------------------------------
// LE PARCOURS : il rend des faits ; les verdicts sont poses a part.
// ---------------------------------------------------------------------------
async function parcours(browser, centres) {
  const F = {};
  // Le matin : un groupe sur la piste 1 a 14:00, aucun blocage.
  banc.semer([banc.reservationLigne(801, '14:00', [1], { name: 'Famille Lambert' })]);
  servirJournee(await S.db.readStaffState(banc.JOUR, 'libramont', { blocagesAPart: true }));
  const P = await ouvrir(browser, centres);
  const { page } = P;
  await page.evaluate(() => setStaffResourceView('bowling'));
  F.pret = await attendre(page, () => document.querySelector('#planningGridWrap .booking[data-booking-res-id="801"]'), null, 15000);
  F.aucuneAvant = await page.evaluate(() => document.querySelectorAll('.planning-hold').length === 0);

  // [A] Deux clients retiennent en ligne, la console ouverte.
  const bowling = await banc.retenir(S, banc.BOWLING('14:00'));
  const laser = await banc.retenir(S, banc.LASER('16:00', { pax: 10 }));
  F.retenus = `${bowling.statut},${laser.statut}`;
  const etat = await S.db.readStaffState(banc.JOUR, 'libramont', { blocagesAPart: true });
  const hB = etat.holds.find((h) => h.type === 'bowling');
  const hL = etat.holds.find((h) => h.type === 'laser');
  F.serveur = { piste: hB && hB.lanes[0], heureB: hB && heureBruxelles(hB.blocage.expiresAt), heureL: hL && heureBruxelles(hL.blocage.expiresAt), joueurs: hL && hL.pax };
  servirJournee(etat);
  F.arrive = await attendre(page, () => document.querySelector('#planningGridWrap .planning-hold'), null, DELAI);
  // Une peinture encore en vol au demarrage peut afficher le blocage meme
  // sans son empreinte. Garder la preuve du contrat de rafraichissement,
  // independamment de cette peinture : identite ET echeance dans la signature.
  F.signatureBlocages = await page.evaluate(() => {
    const signature = JSON.parse(getStaffDataSignature(state.currentDate));
    const attendus = getBlocagesEnLigne(state.currentDate).map(b => `${b.id}@${b.blocage.expiresAt}`);
    return attendus.length > 0 && JSON.stringify(signature.blocagesEnLigne) === JSON.stringify(attendus);
  });
  F.carte = await page.evaluate(() => {
    const cartes = [...document.querySelectorAll('#planningGridWrap .planning-hold')];
    const c = cartes[0];
    if (!c) return { n: 0 };
    const r = c.getBoundingClientRect();
    const dessous = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    // L heure de liberation se lit en entier : son texte tient dans sa boite
    // (mesure au noeud de texte) et sa boite dans la carte.
    const heure = c.querySelector('small');
    let heureEntiere = false;
    if (heure) {
      const plage = document.createRange();
      plage.selectNodeContents(heure);
      const t = plage.getBoundingClientRect();
      const h = heure.getBoundingClientRect();
      heureEntiere = t.width <= h.width + 0.5 && h.bottom <= r.bottom + 0.5 && h.right <= r.right + 0.5;
    }
    return {
      n: cartes.length,
      piste: Number(c.dataset.holdLane),
      debut: Number(c.dataset.holdStart),
      texte: c.textContent.replace(/\s+/g, ' ').trim(),
      titre: c.getAttribute('title') || '',
      recouvre: Boolean(dessous && dessous.closest('.planning-hold') === c),
      colonne: Number((c.closest('.lane-col') || { dataset: {} }).dataset.lane),
      heureEntiere,
    };
  });
  F.groupe = await page.evaluate(() => {
    const b = document.querySelector('#planningGridWrap .booking[data-booking-res-id="801"]');
    return b ? Number(b.dataset.bookingLane) : 0;
  });
  F.pasUneReservation = await page.evaluate(() => state.reservations.every((r) => Number(r.id) > 0)
    && !document.querySelector('#planningGridWrap .booking[data-booking-res-id^="-"]'));
  F.sansRechargement = await page.evaluate(() => window.__temoinBlocages === 'pose');
  await capture(page, 'console-planning-bowling');

  // [B] Le planning laser.
  await page.evaluate(() => setStaffResourceView('laser'));
  F.laserVu = await attendre(page, () => document.querySelector('#laserPlanningGridWrap .lp-g.is-enligne'), null, DELAI);
  F.laser = await page.evaluate(() => {
    const carte = document.querySelector('#laserPlanningGridWrap .lp-g.is-enligne');
    if (!carte) return null;
    // Le planning Laser (maquette E) : une ligne par depart ; sa jauge compte
    // les armes, son libelle les dit au lecteur d ecran.
    const rangee = carte.closest('.lp-dep');
    const sub = document.getElementById('laserPlanningSub');
    const cases = rangee ? [...rangee.querySelectorAll('.lp-cases i')] : [];
    return {
      texte: carte.textContent.replace(/\s+/g, ' ').trim(),
      heureRangee: rangee ? rangee.querySelector('.lp-dep__h').textContent.trim() : '',
      capacite: rangee ? `${rangee.querySelector('.lp-dep__n b').textContent.trim()}/${getAvailabilityLaserCapacity()}` : '',
      dit: rangee ? rangee.querySelector('.lp-dep__jauge').getAttribute('aria-label') : '',
      sous: sub ? sub.textContent.trim() : '',
      // Neutre : ni la couleur d un groupe sur la carte, ni sur la jauge ;
      // ses 10 cases sont celles de la reservation en ligne.
      neutre: Boolean(rangee) && !/\bk\d\b/.test(carte.className) && !cases.some((i) => /\bk\d\b/.test(i.className))
        && cases.filter((i) => i.classList.contains('is-enligne')).length === 10,
    };
  });
  F.capaciteArmes = await page.evaluate(() => getAvailabilityLaserCapacity());
  if (F.laserVu) {
    await page.click('#laserPlanningGridWrap .lp-g.is-enligne');
    await pause(400);
  }
  F.clicSansEffet = await page.evaluate(() => quickBookState === null && document.getElementById('quickBookOverlay').classList.contains('hidden'));
  await capture(page, 'console-planning-laser', '#laserPlanningGridWrap .lp-g.is-enligne');

  // [C] Un blocage echu ne se dessine plus, meme avant la prochaine lecture :
  // la journee est servie avec le blocage bowling qui echoit dans 6 s.
  await page.evaluate(() => setStaffResourceView('bowling'));
  const bientot = JSON.parse(JSON.stringify(etat));
  const echeanceProche = new Date(Date.now() + 6000).toISOString();
  bientot.holds.forEach((h) => { if (h.type === 'bowling') h.blocage.expiresAt = echeanceProche; });
  bientot.revision = `${etat.revision}::bientot`;
  servirJournee(bientot);
  F.echuAvant = await attendre(page, (iso) => {
    const c = document.querySelector('#planningGridWrap .planning-hold');
    return Boolean(c) && getBlocagesEnLigne(state.currentDate).some((b) => b.blocage.expiresAt === iso);
  }, echeanceProche, DELAI);
  const lecturesAvant = serveurJour.lectures;
  await pause(Math.max(0, Date.parse(echeanceProche) - Date.now()) + 400);
  await page.evaluate(() => renderPlanning());
  F.echuApres = await page.evaluate(() => document.querySelectorAll('#planningGridWrap .planning-hold').length);
  F.echuSansLecture = serveurJour.lectures === lecturesAvant;

  // Le serveur ne le sert plus : dix minutes passent, la journee relue n a
  // plus aucun blocage, le planning laser rend ses armes.
  await page.evaluate(() => setStaffResourceView('laser'));
  F.laserAvantEcheance = await attendre(page, () => document.querySelector('#laserPlanningGridWrap .lp-g.is-enligne'), null, DELAI);
  banc.base.horloge += 11 * 60 * 1000;
  const apres = await S.db.readStaffState(banc.JOUR, 'libramont', { blocagesAPart: true });
  F.serveurVide = apres.holds.length === 0 && apres.revision !== etat.revision;
  servirJournee(apres);
  F.laserParti = await attendre(page, () => !document.querySelector('#laserPlanningGridWrap .lp-g.is-enligne'), null, DELAI);
  F.armesRendues = await page.evaluate(() => {
    const rangee = document.querySelector('#laserPlanningGridWrap .lp-dep[data-lp-t="16"]');
    return rangee ? `${rangee.querySelector('.lp-dep__n b').textContent.trim()}/${getAvailabilityLaserCapacity()}` : '';
  });
  F.erreurs = P.erreurs.slice();
  await P.ctx.close();
  return F;
}

function verdict(F) {
  ok(F.pret && F.aucuneAvant, 'pret', '[A] le planning est ouvert, le groupe de 14:00 sur la piste 1, aucune carte en attente');
  ok(F.retenus === '201,201', 'retenus', '[A] deux clients retiennent en ligne (serveur reel)', F.retenus);
  ok(F.arrive && F.carte.n === 1, 'arrive', '[A] le blocage arrive : une carte « En ligne », sans rechargement', `${F.carte.n} carte(s)`);
  ok(F.signatureBlocages, 'signature', '[A] la signature du planning porte l identite et l echeance des blocages recus');
  ok(F.carte.piste === F.serveur.piste && F.carte.colonne === F.serveur.piste && F.carte.debut === 14, 'arrive', '[A] sur la piste que le serveur a retenue, a 14:00', `piste ${F.carte.piste} (serveur ${F.serveur.piste}), debut ${F.carte.debut}`);
  ok(F.carte.texte === `En ligne libre à ${F.serveur.heureB}` && /^Réservation en ligne en cours : sans confirmation, la place se libère à \d{2}:\d{2}\.$/.test(F.carte.titre), 'arrive', '[A] elle dit quand la piste se libere', `${F.carte.texte} / ${F.carte.titre}`);
  ok(F.carte.heureEntiere, 'arrive', '[A] l heure de liberation se lit en entier, sur une piste etroite');
  ok(F.carte.recouvre, 'arrive', '[A] elle recouvre les cases : aucune reservation ne s y lance');
  ok(F.groupe === 1 && F.pasUneReservation, 'arrive', '[A] le groupe reste piste 1 ; le blocage n est pas une reservation du poste', `groupe piste ${F.groupe}`);
  ok(F.sansRechargement, 'arrive', '[A] sans rechargement (le temoin a survecu)');
  ok(F.laserVu && F.laser && /^En ligne 10 · libre à \d{2}:\d{2}$/.test(F.laser.texte) && F.laser.texte.includes(`libre à ${F.serveur.heureL}`), 'laser', '[B] le planning laser montre la carte en attente, ses 10 joueurs et l heure de liberation', F.laser && F.laser.texte);
  ok(F.laser && F.laser.heureRangee === '16:00' && F.laser.capacite === `10/${F.capaciteArmes}`
    && F.laser.dit.startsWith(`16:00 : 10 sur ${F.capaciteArmes}, ${F.capaciteArmes - 10} places. En ligne 10, libre à ${F.serveur.heureL}.`),
  'laser', '[B] les 10 joueurs comptent dans la capacite de 16:00', F.laser && `${F.laser.heureRangee} ${F.laser.capacite} / ${F.laser.dit}`);
  ok(F.laser && F.laser.sous === '0 départ · 0 joueur · 1 en ligne en cours', 'laser', '[B] l en-tete la compte a part, pas comme un depart', F.laser && F.laser.sous);
  ok(F.laser && F.laser.neutre, 'laser', '[B] un depart qui ne porte que la reservation en ligne reste neutre (aucune couleur de groupe)');
  ok(F.clicSansEffet, 'laser', '[B] un clic sur la carte en attente ne lance rien');
  // Le serveur sert encore le blocage (sa liste est celle d avant l echeance) :
  // seul le filtre de la console peut le retirer.
  ok(F.echuAvant && F.echuApres === 0, 'echu', '[C] un blocage echu ne se dessine plus, meme avant la prochaine lecture', `${F.echuApres} carte(s), ${F.echuSansLecture ? 'sans' : 'avec'} relecture entre-temps`);
  ok(F.serveurVide && F.laserAvantEcheance && F.laserParti && F.armesRendues === `0/${F.capaciteArmes}`, 'serveur', '[C] le serveur ne le sert plus : il disparait du planning laser et rend ses armes', `${F.armesRendues}`);
  ok(!F.erreurs.length, 'erreurs', 'aucune erreur de page', F.erreurs.join(' | '));
}

async function main() {
  const { chromium } = require('playwright-core');
  const centres = await listCentersForSession({ query: async () => { throw new Error('hors ligne'); } }, { centerId: 'libramont', permissions: [] });
  const srv = serveur();
  await new Promise((resolve) => srv.listen(PORT, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    console.log('--- la console, sur le code du depot');
    verdict(await parcours(browser, centres));

    console.log('\n--- contre-epreuves');
    const sources = {};
    for (const m of MUTATIONS) {
      const fichier = fichierDe(m);
      if (!sources[fichier]) sources[fichier] = fs.readFileSync(path.join(ROOT, fichier), 'utf8').split(String.fromCharCode(13) + LF).join(LF);
      if (sources[fichier].split(m.de).length !== 2) { ok(false, 'ancre', `contre-epreuve montable : ancre introuvable (${m.de.trim().slice(0, 60)})`); continue; }
      casse = m;
      Object.keys(verdicts).forEach((k) => { delete verdicts[k]; });
      bavard = false;
      let rouge = false;
      let detail = '';
      try {
        verdict(await parcours(browser, centres));
        rouge = verdicts[m.cible] === false;
        detail = Object.keys(verdicts).filter((k) => verdicts[k] === false).join(',');
      } catch (error) {
        rouge = true;
        detail = `le parcours s arrete : ${String(error.message || error).split(LF)[0].slice(0, 90)}`;
      } finally {
        casse = null;
        bavard = true;
      }
      ok(rouge, 'contre', `sans la regle « ${m.nom} », ce gate ROUGIT`, detail);
    }
  } finally {
    casse = null;
    await browser.close();
    srv.close();
  }
  console.log(`\n${echecs === 0 ? 'console-blocages-check: ALL OK' : `console-blocages-check: ${echecs} echec(s)`}`);
  process.exit(echecs === 0 ? 0 : 1);
}

main().catch((error) => { console.error(error); process.exit(1); });

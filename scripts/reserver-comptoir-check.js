// LA FENETRE RESERVER AU COMPTOIR : JUSTE, DU PREMIER COUP (2026-10-12).
//
// La reservation en ligne n ouvrira au public que quand l equipe note TOUTES
// ses reservations dans Pinlane (Projects/pinlane/ouverture-vacances-2026-10-12,
// condition 1). Movsar, sur la nouvelle fenetre : « bcp plus dure qu avant et
// bcp d erreur et de problème ». La QA du 2026-10-12 (Evidence Collector, sur
// 83a6629) en a releve dix ; ce gate les rejoue, sur la VRAIE console (index.html
// du depot, Edge headless) branchee aux VRAIS handlers (api/staff-reservations,
// api/staff-state, api/public-booking-meta, api/public-reservations), au vrai
// moteur et a la vraie lib/database.js, sur la base en memoire du banc
// (scripts/reserver-banc.js). Le faux serveur de reserver-v5-check accepte tout :
// c est pour cela qu il n a pas vu D1.
//
// LA FENETRE « LES SEANCES » (2026-11-03) a remplace celle de 2026-10 : les
// memes regles s y lisent autrement (ouvrirReserver, lireTicket, memeEtat). Le
// nombre de joueurs se touche avant de creer ; l horloge, l arrivee conseillee,
// « joueurs par piste », « Aussi au programme » et la bascule Formule/Activites
// n existent plus ; scripts/reserver-seances-check.js tient ses 12 commandes.
//
//   [D1] AU COMPTOIR, RIEN N EST OBLIGATOIRE. Sans telephone ni nom, « Créer »
//        cree le dossier (nom lisible « Client », telephone vide, jamais un
//        numero invente) ; il reste modifiable dans la fiche (le telephone n y
//        est pas exige, le PATCH passe) ; le tunnel public garde ses champs
//        obligatoires, et un champ qui manque vraiment se nomme. Un dossier
//        anonyme ne devient pas un faux client « Client » dans le CRM.
//   [D2] JAMAIS UNE HEURE PASSEE PROPOSEE. A 15:12, 8 pistes prises de 15:00 a
//        17:00 : aucune sortie (« Prendre HH:MM », les seances) ni aucune heure
//        libre avant 15:00 (15:00 reste proposable) ; une heure deja passee se
//        dit « passée » a qui a le droit « Modifier une date passée » (« Plus
//        tôt » sur la page Autres), elle n existe pas pour les autres. 15:30
//        coince : au niveau forcer (Manager), la toucher la prend « à placer » et
//        le lien « Prendre HH:MM à la place » prend l heure proche (jamais avant
//        15:00) ; sans lui (Staff bar), la toucher ne la prend pas, et 15:30
//        tapee a la barre donne le refus et ses sorties.
//   [D3] UNE FORMULE EN VACANCES SE RESERVE AU COMPTOIR. F4 pour 10 un jour de
//        vacances : un vrai plan (pistes et arene posees), la vraie raison dite
//        avant le clic et notee sur le dossier, jamais « Pas de plan possible » ;
//        en ligne, la formule reste refusee.
//   [D4] LE NOM D UN CLIENT RECONNU NE SE DOUBLE PAS quand on le retape.
//   [D5] LE VERDICT SUIT LA JOURNEE. Un autre poste prend la derniere piste :
//        le verdict ne dit plus « possible », et Entree ne repond pas « Il faut
//        1 piste disponible ».
//   [D6] « LASER 12 A 16:30 » DEPUIS « + Réservation » EN 7 CLICS AU PLUS.
//   [D7] EN AUTO, AUCUNE PISTE N EST ENVOYEE COMME UN CHOIX, et jamais
//        « Simulation » a l ecran : deux resas du meme envoi ne se voient pas
//        en conflit sur une piste que personne n a choisie.
//   [D8] AU CLAVIER, LES SEANCES SE PARCOURENT : les fleches vont d une heure a
//        sa voisine, Entree sur une heure atteinte au clavier la choisit (sans
//        rien creer) et le focus reste sur l heure choisie (pas sur la fenetre).
//   [D9] TABLETTE 1024 x 768 ET TELEPHONE 390 : rien de coupe ni de cache.
//   [D10] LES MOTS : accents, pistes conseillees justes, un verdict et un pied
//        qui disent le meme etat, la seance en cours dite « maintenant ».
//   [*]  Zero erreur JS ni erreur console.
//
// Contre-preuves : node scripts/reserver-comptoir-check.js --contre-preuves
// (ou --contre-preuves=nom,nom). Chaque correctif est retire en memoire, cote
// navigateur (fichier servi) ou cote serveur (crochet de compilation du banc),
// et la lettre qu il protege doit rougir. Le disque n est jamais touche.
// --ancres verifie seulement que chaque ancre de contre-preuve est unique.
//
// Captures : --captures=<dossier> rejoue D1, D2, D3 et D6 a 1280 x 800,
// 1024 x 768 et 390 x 844 (tactile), en clair et en sombre, et photographie
// chaque etape qui compte ; les verdicts y comptent aussi.
//
// Zero reseau sortant, zero vraie base : rien ne part.
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const { Readable } = require('stream');

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
const { chromium } = require('playwright-core');

const ROOT = B.ROOT;
const PORT = Number(process.env.PINLANE_COMPTOIR_PORT || 4471);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const EDGE = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CAPTURES = process.env.PINLANE_COMPTOIR_CAPTURES || '';
const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
const LF = String.fromCharCode(10);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg' };

// ---------------------------------------------------------------------------
// LES JOURS ET LES HEURES. Le jour du banc (un samedi, une semaine devant au
// moins) est « aujourd hui » dans la page, figee a 15:12 heure de Bruxelles.
// ---------------------------------------------------------------------------
const JOUR = B.JOUR;
function instantBruxelles(jour, heure, minute) {
  const [y, m, d] = jour.split('-').map(Number);
  for (let decalage = -3; decalage <= 3; decalage += 1) {
    const t = new Date(Date.UTC(y, m - 1, d, heure - decalage, minute, 0));
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(t);
    const lire = (k) => (parts.find((p) => p.type === k) || {}).value;
    if (`${lire('year')}-${lire('month')}-${lire('day')}` === jour && Number(lire('hour')) % 24 === heure && Number(lire('minute')) === minute) return t;
  }
  throw new Error(`${heure}:${minute} introuvable a Bruxelles le ${jour}`);
}
const A_1512 = instantBruxelles(JOUR, 15, 12);
function decalerJour(jour, n) {
  const d = new Date(`${jour}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// LE SERVEUR : les fichiers du depot, les vrais handlers montes sur le banc.
// ---------------------------------------------------------------------------
let banc = null;
let mutationFront = null;
// Les editions serveur de la contre-preuve en cours : chaque montage du banc
// (B.monter recompile les modules) les applique.
let mutationsServeur = [];
const desarmees = [];
const journalApi = [];

function monter({ role = 'manager', mutations = mutationsServeur } = {}) {
  const monte = B.monter({ session: B.sessionDuRole(role), mutations });
  const { STAFF_ROLE_PRESETS } = require(path.join(ROOT, 'lib/staff-auth.js'));
  banc = {
    role,
    monte,
    perms: [...STAFF_ROLE_PRESETS.find((r) => r.id === role).permissions],
    staffState: require(path.join(ROOT, 'api/staff-state.js')),
    bookingMeta: require(path.join(ROOT, 'api/public-booking-meta.js')),
    publicReservations: require(path.join(ROOT, 'api/public-reservations.js')),
  };
  return banc;
}

function sessionPour(role, perms) {
  return {
    token: 'gate-comptoir', centerId: 'libramont',
    expiresAt: new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString(),
    member: { id: `m-${role}`, name: 'Rachel', roleId: role },
    role: { id: role, name: role, locked: false },
    permissions: perms,
  };
}

function lireCorps(req) {
  return new Promise((resolve) => { const b = []; req.on('data', (c) => b.push(c)); req.on('end', () => resolve(Buffer.concat(b).toString('utf8'))); });
}

async function relayer(handler, req, res, nom) {
  const brut = req.method === 'GET' ? '' : await lireCorps(req);
  const faux = Readable.from(brut ? [Buffer.from(brut)] : []);
  faux.method = req.method;
  faux.url = req.url;
  faux.headers = { ...req.headers, host: 'localhost' };
  faux.socket = { remoteAddress: '127.0.0.1' };
  const sortie = {
    statusCode: 200, entetes: {}, corps: '', req: faux,
    setHeader(k, v) { this.entetes[k.toLowerCase()] = v; }, getHeader(k) { return this.entetes[k.toLowerCase()]; },
    end(b) { this.corps = b === undefined ? '' : String(b); },
  };
  try { await handler(faux, sortie); } catch (e) { sortie.statusCode = 500; sortie.corps = JSON.stringify({ ok: false, message: `gate : exception ${e.message}` }); }
  let corps = null;
  try { corps = brut ? JSON.parse(brut) : null; } catch (e) { corps = brut; }
  let reponse = null;
  try { reponse = JSON.parse(sortie.corps); } catch (e) { reponse = null; }
  journalApi.push({ nom, methode: req.method, url: req.url, statut: sortie.statusCode, corps, reponse });
  res.statusCode = sortie.statusCode;
  Object.entries(sortie.entetes).forEach(([k, v]) => res.setHeader(k, v));
  res.end(sortie.corps);
}

function json(res, statut, corps) {
  res.statusCode = statut;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(corps));
}

function demarrerServeur() {
  const serveur = http.createServer(async (req, res) => {
    const url = new URL(req.url, BASE_URL);
    const p = url.pathname;
    try {
      if (p === '/api/staff-reservations') return relayer(banc.monte.handler, req, res, 'staff-reservations');
      if (p === '/api/staff-state') return relayer(banc.staffState, req, res, 'staff-state');
      if (p === '/api/public-booking-meta') return relayer(banc.bookingMeta, req, res, 'public-booking-meta');
      if (p === '/api/staff-auth') {
        const session = sessionPour(banc.role, banc.perms);
        return json(res, 200, { ok: true, authenticated: true, session, accessControl: { selectedRoleId: banc.role, selectedMemberId: session.member.id, roles: [{ id: banc.role, name: banc.role, code: 'GC', tone: 'manager', accessCode: 'X', updatedAt: new Date().toISOString(), locked: false, permissions: banc.perms }], members: [], events: [], permissions: banc.perms } });
      }
      if (p === '/api/staff-customer-notes') {
        const lot = url.searchParams.get('reservationIds');
        const sansNote = () => ({ eligible: false, clientKey: '', note: null });
        if (lot !== null) return json(res, 200, { ok: true, notesByReservationId: Object.fromEntries(lot.split(',').filter(Boolean).map((id) => [String(Number(id)), sansNote()])) });
        return json(res, 200, { ok: true, ...sansNote() });
      }
      if (p === '/api/admin-range') return json(res, 200, { ok: true, reservations: [], laneStatuses: {}, centerId: 'libramont', revision: 'gate', syncedAt: new Date().toISOString() });
      if (p === '/api/ops') return json(res, 200, { ok: true, communications: [], samples: [], suggestions: [], events: [], customRequests: [] });
      if (p.startsWith('/api/')) return json(res, 200, { ok: true, reservations: [], communications: [], samples: [], suggestions: [], events: [] });
      let fichier = path.join(ROOT, decodeURIComponent(p));
      if (p === '/' || p === '') fichier = path.join(ROOT, 'index.html');
      if (!fichier.startsWith(ROOT)) { res.writeHead(403); res.end('Interdit'); return; }
      fs.readFile(fichier, (err, contenu) => {
        if (err) { res.writeHead(404); res.end('Introuvable'); return; }
        let corps = contenu;
        const rel = path.relative(ROOT, fichier).split(path.sep).join('/');
        const mutations = (mutationFront || []).filter((m) => m.fichier === rel);
        if (mutations.length) {
          let texte = contenu.toString('utf8').split(CRLF).join(LF);
          mutations.forEach((m) => {
            const n = texte.split(m.de).length - 1;
            if (n !== 1) desarmees.push(`${m.nom || rel} (ancre trouvee ${n} fois)`);
            texte = texte.split(m.de).join(m.vers);
          });
          corps = Buffer.from(texte, 'utf8');
        }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(fichier).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(corps);
      });
    } catch (e) {
      json(res, 500, { ok: false, message: `gate : ${e.message}` });
    }
  });
  return new Promise((resolve, reject) => { serveur.once('error', reject); serveur.listen(PORT, '127.0.0.1', () => resolve(serveur)); });
}

// ---------------------------------------------------------------------------
// LA JOURNEE ET SES DOSSIERS.
// ---------------------------------------------------------------------------
// Une piste prise de `debut` a `fin` par un autre groupe.
function pisteOccupee(id, piste, debut = '15:00', duree = 2, extra = {}) {
  return B.ligne(id, { start_time: debut, lanes: [piste], duration: duree, total_duration: duree, name: `Groupe piste ${piste}`, ...extra });
}
function lireBase() {
  return [...B.base.reservations.values()].map((r) => ({
    id: r.id, nom: r.name, tel: r.phone, email: r.email, date: String(r.date).slice(0, 10), debut: String(r.start_time).slice(0, 5), pistes: (r.lanes || []).map(Number), pax: r.pax, type: r.type,
    formule: r.formule_id, statut: r.status, validation: r.validation_status, notes: r.notes || '', canal: r.channel,
    plan: r.ops_plan || null,
    blocs: r.ops_plan && Array.isArray(r.ops_plan.resourceBlocks) ? r.ops_plan.resourceBlocks : [],
  }));
}
const creees = (avant) => lireBase().filter((r) => !avant.has(r.id));

// Le corps que le tunnel public envoie (slot-holds-check : visite()), avec ou
// sans telephone.
function corpsPublic(extra = {}) {
  return { centerId: 'libramont', date: JOUR, startTime: '15:00', pax: 4, companions: 0, channel: 'public', occasion: '', type: 'visite',
    program: [{ activityId: 'bowling', duration: 1 }], preference: { preferredTimes: { bowling: '15:00' }, laserGameTimes: [], laserPlacement: 'scheduled', arrivalConfidence: 'normal' },
    price: 0, basePrice: 0, duration: 1, totalDuration: 1, name: 'Client Essai', email: 'client@example.test', phone: '0470000000', ...extra };
}
let ipSuivante = 30;
async function appelerPublic(corps) {
  ipSuivante += 1;
  const ip = `10.31.0.${ipSuivante % 250}`;
  const req = Readable.from([Buffer.from(JSON.stringify(corps))]);
  req.method = 'POST';
  req.url = '/api/public-reservations';
  req.headers = { host: 'localhost', 'content-type': 'application/json', 'x-forwarded-for': ip };
  req.socket = { remoteAddress: ip };
  const res = { statusCode: 200, entetes: {}, corps: '', req, setHeader(k, v) { this.entetes[k.toLowerCase()] = v; }, getHeader(k) { return this.entetes[k.toLowerCase()]; }, end(b) { this.corps = String(b || ''); } };
  await banc.publicReservations(req, res);
  let corpsRep = {};
  try { corpsRep = JSON.parse(res.corps); } catch (e) { corpsRep = {}; }
  return { statut: res.statusCode, json: corpsRep };
}

// ---------------------------------------------------------------------------
// LA CONSOLE DANS EDGE.
// ---------------------------------------------------------------------------
// La taille et le theme des captures (--captures) ; sinon, le poste du comptoir.
let vue = null;
async function ouvrirConsole(browser, { viewport = vue ? vue.viewport : { width: 1280, height: 820 }, instant = A_1512, theme = vue ? vue.theme : 'dark', toucher = Boolean(vue && vue.toucher) } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'fr-BE', timezoneId: 'Europe/Brussels', colorScheme: theme, hasTouch: toucher, isMobile: false });
  const page = await context.newPage();
  page.setDefaultTimeout(9000);
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(`PAGEERROR: ${String(e.message || e).slice(0, 300)}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|favicon/i.test(m.text())) erreurs.push(m.text().slice(0, 300)); });
  if (instant) await page.clock.setFixedTime(instant);
  const session = sessionPour(banc.role, banc.perms);
  await page.addInitScript(({ session, theme }) => {
    try {
      window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(session));
      window.localStorage.setItem('pinlane-theme', theme);
    } catch (e) { /* stockage indisponible */ }
  }, { session, theme });
  await page.goto(`${BASE_URL}/?v=comptoir-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
  await page.evaluate(() => window.setView('staff'));
  // Le theme de la console vit dans son etat (sombre par defaut).
  if (theme !== 'dark') await page.evaluate((t) => setStaffTheme(t), theme);
  await page.waitForFunction(() => typeof window.getCenterActivities === 'function' && window.getCenterActivities().length >= 3, null, { timeout: 15000 });
  await page.waitForTimeout(800);
  return { context, page, erreurs };
}

async function planPose(page, attendu = null, ms = 9000) {
  return page.waitForFunction((attendu) => {
    const s = typeof quickBookState !== 'undefined' ? quickBookState : null;
    if (!s || !s.plan || s.plan.etat !== 'ok' || s.plan.cle !== s.cleCourante) return false;
    return attendu === null || Boolean(s.plan.resultat && s.plan.resultat.disponible) === attendu;
  }, attendu, { timeout: ms, polling: 100 }).then(() => true, () => false);
}

async function candidatsPoses(page, ms = 9000) {
  return page.waitForFunction(() => {
    const s = typeof quickBookState !== 'undefined' ? quickBookState : null;
    return Boolean(s && s.candidats && s.candidats.etat === 'ok' && s.candidats.base === s.cleCourante);
  }, null, { timeout: ms, polling: 100 }).then(() => true, () => false);
}

async function fenetreFermee(page, ms = 8000) {
  return page.waitForFunction(() => quickBookState === null, null, { timeout: ms, polling: 100 }).then(() => true, () => false);
}

const texteDe = (page, sel) => page.evaluate((sel) => { const el = document.querySelector(sel); return el ? el.innerText.replace(/\s+/g, ' ').trim() : ''; }, sel);

// LA FENETRE « LES SEANCES » (2026-11-03, assets/app-main.js, bloc RESERVER, LES
// SEANCES). A gauche les joueurs, le jour et les seances de chaque activite ; a
// droite le ticket : ses lignes (#rsLignes, un refus en rouge sur sa ligne :
// #rvRefus), le client au ticket (#qbPhone obligatoire, #qbName, #qbNotes), la ligne d etat #rvVerdict et le pied,
// dont le seul bouton plein est #rvCreer (data-pret="1" quand le plan du serveur
// tient ; « Prendre 17:00 », data-proche, quand le planning refuse).
async function ouvrirReserver(page) {
  await page.locator('.btn-new').first().click();
  await page.waitForSelector('#quickBookOverlay .qb-modal.rv.rs', { timeout: 8000 });
}

// Le nombre de joueurs se touche avant tout (« Combien de joueurs ? »).
async function choisirJoueurs(page, n) {
  await page.click(`#quickBookOverlay #rsHaut [data-pax="${n}"]`);
}

async function lireTicket(page) {
  return page.evaluate(() => {
    const t = (el) => (el ? el.innerText.replace(/\s+/g, ' ').trim() : '');
    const creer = document.getElementById('rvCreer');
    const refus = document.getElementById('rvRefus');
    return {
      verdict: t(document.getElementById('rvVerdict')),
      lignesVerdict: [...document.querySelectorAll('#rvVerdict .rs-v-ligne')].map((p) => ({ texte: t(p), classe: p.className })),
      refus: t(refus),
      refusRouge: Boolean(refus && /is-ko/.test(refus.className)),
      ticket: t(document.getElementById('rsLignes')),
      creer: creer ? { texte: t(creer), pret: creer.dataset.pret || '', proche: creer.dataset.proche || '', bloque: creer.classList.contains('is-bloque') } : null,
    };
  });
}

// LE HAUT ET LE BAS DU TICKET DISENT LE MEME ETAT. L ancienne fenetre peignait un
// bandeau dans son pied (.rv-etat-pied) ; la nouvelle dit l etat une seule fois (la
// ligne d etat, ou le rouge sur la ligne du ticket) et son pied ne porte que Créer.
// Un refus arrete Créer (« Prendre 17:00 », ou bloque), un avertissement le laisse
// pret : un verdict rouge au-dessus d un Créer pret, ou un Créer arrete sous un
// ticket sans refus, se contredisent.
async function memeEtat(page) {
  const t = await lireTicket(page);
  const verdict = t.refusRouge || t.lignesVerdict.some((l) => /is-ko/.test(l.classe)) ? 'ko' : t.lignesVerdict.some((l) => /is-att/.test(l.classe)) ? 'att' : 'ok';
  const pied = t.creer && t.creer.pret === '1' && !t.creer.bloque ? 'pret' : 'arrete';
  return { verdict, pied, creer: t.creer ? t.creer.texte : '', lignes: t.lignesVerdict.map((l) => l.texte), meme: (verdict === 'ko') === (pied === 'arrete') };
}

// Une condition lue cote serveur (la base du banc), attendue sans la page.
async function attendreNode(condition, ms = 8000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (condition()) return true;
    await new Promise((ok) => setTimeout(ok, 150));
  }
  return Boolean(condition());
}

// Une capture a l arret (les entrees animees finies), l element qui compte
// dans l ecran. Une contre-preuve ne photographie rien : la capture montre le
// code du depot, jamais une version cassee expres.
let dossierCaptures = CAPTURES;
async function capture(page, nom, sel = '') {
  if (!dossierCaptures || mutationFront || mutationsServeur.length) return;
  try {
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || (a.effect && a.effect.getTiming().iterations === Infinity)), null, { timeout: 4000 }).catch(() => {});
    if (sel) await page.evaluate((s) => { const el = document.querySelector(s); if (el) el.scrollIntoView({ block: 'center' }); }, sel);
    await page.waitForTimeout(250);
    fs.mkdirSync(dossierCaptures, { recursive: true });
    await page.screenshot({ path: path.join(dossierCaptures, `${nom}${vue ? `-${vue.nom}-${vue.theme === 'light' ? 'clair' : 'sombre'}` : ''}.png`) });
  } catch (err) { /* la capture n est pas une verification */ }
}

// Un clic COMPTE : la meme chose qu un doigt, sur la cible visible.
async function clic(compteur, locator, quoi) {
  await locator.first().click({ timeout: 6000 });
  compteur.push(quoi);
  await locator.page().waitForTimeout(350);
}

// ---------------------------------------------------------------------------
// LES SCENARIOS. `v(lettre, cond, label, detail)` note un verdict.
// ---------------------------------------------------------------------------

const TEL_COMPTOIR = '0470 12 34 56';

// LE TELEPHONE AVANT LE CLIC QUI CREE (2026-11-11) : la creation l exige ; un parcours qui ne le tape
// pas encore le tape ici, juste avant « Créer », sans rien changer au reste de son geste.
async function avecTelephone(page) {
  const vide = await page.evaluate(() => { const c = document.getElementById('qbPhone'); return Boolean(c) && !c.value.trim(); });
  if (vide) await page.fill('#qbPhone', TEL_COMPTOIR);
}

// [D1] serveur : la creation staff exige le telephone (2026-11-11), la fiche, le tunnel, le CRM.
async function scenarioD1Serveur(v) {
  B.semer([]);
  monter({ role: 'staff-bar' });
  const m = banc.monte;
  const corps = B.corpsStaff({ type: 'bowling', pax: 4, startTime: '18:00', duration: 1, totalDuration: 1, lanes: [], laneCount: 1, name: 'Client', phone: '', email: '' });
  const sansTel = await m.appeler('POST', '/api/staff-reservations', corps);
  v('D1', sansTel.statut === 422 && /t[ée]l[ée]phone/i.test(String(sansTel.json.message || '')) && !sansTel.json.reservation, 'le comptoir refuse de creer sans telephone, et le refus le nomme', `${sansTel.statut} ${sansTel.json.message || ''}`);
  const r = await m.appeler('POST', '/api/staff-reservations', { ...corps, phone: '+32 470 12 34 56' });
  const cree = r.json.reservation || {};
  v('D1', r.statut === 201 && cree.id && /470123456$/.test(String(cree.phone || '').replace(/\D/g, '')) && cree.name === 'Client', 'avec le telephone seul, le comptoir cree : 201, nom lisible « Client »', `${r.statut} ${r.json.message || ''} ${cree.id ? `#${cree.id} « ${cree.name} » tel « ${cree.phone} »` : ''}`);
  const sansNom = await m.appeler('POST', '/api/staff-reservations', { ...corps, name: '', phone: '+32 470 12 34 56' });
  v('D1', sansNom.statut >= 400 && /nom/i.test(String(sansNom.json.message || '')), 'un champ qui manque vraiment se nomme (nom absent d un appel direct)', `${sansNom.statut} ${sansNom.json.message || ''}`);
  if (cree.id) {
    // La fiche : un PATCH du dossier entier, telephone vide compris (un dossier d avant la regle).
    monter({ role: 'manager' });
    const patch = await banc.monte.appeler('PATCH', '/api/staff-reservations', { ...cree, pax: 5, phone: '', allowPastStart: true, baseUpdatedAt: cree.updatedAt });
    v('D1', patch.statut === 200 && patch.json.reservation && Number(patch.json.reservation.pax) === 5 && patch.json.reservation.phone === '', 'le dossier sans telephone reste modifiable (PATCH du dossier entier)', `${patch.statut} ${patch.json.message || ''}`);
    const ajout = await banc.monte.appeler('PATCH', '/api/staff-reservations', { id: cree.id, phone: '+32 470 12 34 56', baseUpdatedAt: (patch.json.reservation || cree).updatedAt });
    v('D1', ajout.statut === 200 && ajout.json.reservation && /470123456$/.test(String(ajout.json.reservation.phone || '').replace(/\D/g, '')), 'un telephone s ajoute plus tard a la fiche', `${ajout.statut} ${ajout.json.message || ''}`);
  }
  // Le tunnel public : son telephone reste obligatoire, et le refus le nomme.
  monter({ role: 'manager' });
  const pub = await appelerPublic(corpsPublic({ phone: '' }));
  v('D1', pub.statut >= 400 && /t[ée]l[ée]phone/i.test(String(pub.json.message || '')), 'en ligne, le telephone reste obligatoire et le refus le nomme', `${pub.statut} ${pub.json.message || ''}`);
  const pubOk = await appelerPublic(corpsPublic({ startTime: '19:00', preference: { preferredTimes: { bowling: '19:00' }, laserGameTimes: [], laserPlacement: 'scheduled', arrivalConfidence: 'normal' } }));
  v('D1', pubOk.statut === 201 || pubOk.statut === 200, 'MONTAGE : en ligne, un dossier complet passe', `${pubOk.statut} ${pubOk.json.message || ''}`);
  // Le CRM : un dossier sans contact n invente pas un client « Client ».
  const { analyserDonnees, cleClient } = require(path.join(ROOT, 'lib/donnees-clients.js'));
  const anonyme = { id: 1, name: 'Client', phone: '', email: '', clientKey: 'n:client', status: 'confirmed', date: JOUR, price: 30, pax: 4 };
  v('D1', cleClient(anonyme) === '' && cleClient({ ...anonyme, clientKey: '', name: 'Famille Durand' }) === 'n:famille durand', 'les donnees clients : un dossier anonyme n a pas d identite, un nom tape en garde une', `${JSON.stringify(cleClient(anonyme))}`);
  const { clientKey } = require(path.join(ROOT, 'lib/direction-analytics.js'));
  v('D1', clientKey(anonyme) === '' && clientKey({ ...anonyme, name: 'Famille Durand' }) === 'n:famille durand', 'le pilotage : meme regle', JSON.stringify(clientKey(anonyme)));
  void analyserDonnees;
}

// [D1] navigateur : au comptoir, rien tape, « Créer » cree ; la fiche n exige
// pas le telephone ; le CRM de la console ne fabrique pas de client.
async function scenarioD1(browser, v) {
  B.semer([]);
  monter({ role: 'staff-bar' });
  let id = null;
  {
    const { context, page, erreurs } = await ouvrirConsole(browser);
    try {
      const avant = new Set(lireBase().map((r) => r.id));
      await ouvrirReserver(page);
      // La fenetre des seances demande le nombre de joueurs avant de creer
      // (« Combien de joueurs ? ») : un toucher, rien de tape.
      await choisirJoueurs(page, 4);
      const pose = await planPose(page, true);
      // Le comptoir : le ticket porte le telephone du client, vide et obligatoire.
      const qui = await page.evaluate(() => { const c = document.getElementById('qbPhone'); return c ? { valeur: c.value, aria: c.getAttribute('aria-label') || '', exige: c.getAttribute('aria-required') === 'true' } : null; });
      v('D1', pose && Boolean(qui) && qui.valeur === '' && qui.exige && /obligatoire/i.test(qui.aria), 'MONTAGE : « + Réservation » a 15:12 ouvre la fenetre au comptoir, plan pose', `plan ${pose}, champ client ${JSON.stringify(qui)}`);
      await capture(page, 'D1-comptoir-ouvert');
      await page.click('#rvCreer');
      await page.waitForTimeout(400);
      const sansTel = await page.evaluate(() => ({ ouverte: quickBookState !== null, focus: document.activeElement ? document.activeElement.id : '' }));
      v('D1', sansTel.ouverte && sansTel.focus === 'qbPhone' && creees(avant).length === 0, 'au comptoir, rien tape : « Créer » ne cree rien et mene au telephone', JSON.stringify({ ...sansTel, creees: creees(avant).length }));
      await page.fill('#qbPhone', '0470 12 34 56');
      await page.click('#rvCreer');
      const ferme = await fenetreFermee(page);
      const nouvelles = creees(avant);
      const erreur = ferme ? '' : await texteDe(page, '#quickBookOverlay #rvVerdict');
      v('D1', ferme && nouvelles.length === 1 && String(nouvelles[0].tel || '').replace(/\D/g, '').endsWith('470123456') && nouvelles[0].nom === 'Client', 'au comptoir, le telephone seul tape : « Créer » cree le dossier (son numero, nom « Client »)', ferme ? JSON.stringify(nouvelles.map((r) => ({ nom: r.nom, tel: r.tel, debut: r.debut }))) : `refus : « ${erreur} »`);
      if (!ferme) await capture(page, 'D1-refus');
      id = nouvelles[0] ? nouvelles[0].id : null;
      // Le CRM de la console : aucun client « Client » fabrique.
      await page.waitForFunction((id) => !id || (state.reservations || []).some((r) => Number(r.id) === Number(id)), id, { timeout: 9000 }).catch(() => {});
      // Le meme dossier : anonyme, il n est pas un client ; avec un nom tape,
      // il en est un (le CRM de la console marche, il ne rend pas vide pour tout).
      const crm = await page.evaluate((id) => {
        const r = (state.reservations || []).find((x) => Number(x.id) === Number(id));
        if (!r || typeof buildStaffClientRowsFromReservations !== 'function') return null;
        const noms = (lignes) => lignes.map((x) => x.name);
        const sansContact = { ...r, phone: '', email: '', clientKey: '' };
        return { anonyme: noms(buildStaffClientRowsFromReservations([sansContact, { ...sansContact, id: -1 }])), nomme: noms(buildStaffClientRowsFromReservations([{ ...sansContact, name: 'Famille Durand' }])) };
      }, id);
      v('D1', Boolean(crm) && crm.anonyme.length === 0 && crm.nomme.includes('Famille Durand'), 'les clients de la console : deux dossiers anonymes ne font pas un client « Client », un nom tape en fait un', JSON.stringify(crm));
      v('*', erreurs.length === 0, 'zero erreur JS ni console [D1 comptoir]', erreurs.slice(0, 2).join(' | '));
    } finally { await context.close(); }
  }
  if (!id) { v('D1', false, 'la fiche du dossier se modifie', 'aucun dossier cree au comptoir'); return; }
  // La fiche, par un role qui modifie : le telephone n y est pas exige, et
  // l enregistrement passe (le formulaire se soumet, le PATCH aussi).
  monter({ role: 'manager' });
  {
    const { context, page, erreurs } = await ouvrirConsole(browser);
    try {
      await page.waitForFunction((id) => (state.reservations || []).some((r) => Number(r.id) === Number(id)), id, { timeout: 9000 });
      await page.evaluate((id) => openPos(id), id);
      await page.waitForTimeout(500);
      await page.evaluate(() => {
        const fiche = document.querySelector('#posOverlay, .pos-sheet') || document;
        const onglet = [...fiche.querySelectorAll('button, a, [role="tab"]')].find((t) => /^Modifier$/i.test(t.textContent.trim()));
        if (onglet) onglet.click();
      });
      // (le telephone attend dans un pli depuis le 2026-11-02)
      await page.click('#editContactPli > summary', { timeout: 9000 });
      await page.waitForSelector('.edit-form #editPhoneInput', { timeout: 9000 });
      const requis = await page.evaluate(() => document.getElementById('editPhoneInput').required);
      v('D1', requis === false, 'la fiche « Modifier » n exige pas le telephone', `required=${requis}`);
      await capture(page, 'D1-fiche-sans-telephone', '#editPhoneInput');
      await page.fill('#editPaxInput', '5');
      await page.evaluate(() => document.querySelector('.edit-form').requestSubmit());
      const enregistre = await attendreNode(() => Number((lireBase().find((r) => r.id === id) || {}).pax) === 5, 9000);
      const ligne = lireBase().find((r) => r.id === id) || {};
      const erreurFiche = await texteDe(page, '.edit-form .edit-error, .edit-form [role="alert"], #posOverlay .pos-error');
      v('D1', enregistre && Number(ligne.pax) === 5 && /470123456$/.test(String(ligne.tel || '').replace(/\D/g, '')), 'la fiche enregistre le dossier (5 joueurs), son telephone garde', `base pax ${ligne.pax} tel « ${ligne.tel} » ${erreurFiche ? `erreur « ${erreurFiche} »` : ''}`);
      v('*', erreurs.length === 0, 'zero erreur JS ni console [D1 fiche]', erreurs.slice(0, 2).join(' | '));
    } finally { await context.close(); }
  }
}

// [D2] 15:12, huit pistes prises de 15:00 a 17:00.
async function scenarioD2(browser, v, { role = 'manager' } = {}) {
  B.semer([1, 2, 3, 4, 5, 6, 7, 8].map((p) => pisteOccupee(820 + p, p)));
  monter({ role });
  const { context, page, erreurs } = await ouvrirConsole(browser);
  // La page « Autres » : toutes les heures du jour ; celles qui ne tiennent pas
  // s effacent (.is-efface) et restent touchables.
  const lireAutres = () => page.evaluate(() => ({
    heures: [...document.querySelectorAll('#quickBookOverlay .rs-heures .rs-h[data-heure]')].map((b) => ({ h: b.dataset.heure, efface: b.classList.contains('is-efface'), aria: b.getAttribute('aria-label') || '' })),
    plusTot: Boolean(document.getElementById('rsPlusTot')),
  }));
  const ouvrirAutres = async () => {
    await page.click('#quickBookOverlay #rsZ-bowling .rs-h-autres');
    await page.waitForSelector('#quickBookOverlay .rs-heures .rs-h[data-heure]', { timeout: 6000 });
    await page.waitForTimeout(300);
  };
  try {
    const avant = new Set(lireBase().map((r) => r.id));
    await ouvrirReserver(page);
    await choisirJoueurs(page, 4);
    await planPose(page);
    // (depuis le 2026-11-02, la fenetre s ouvre d elle-meme sur une heure qui tient :
    // 15:30 se choisit a la main, sur la page « Autres » ou elle est effacee)
    await ouvrirAutres();
    const autres = await lireAutres();
    const passeesDuJour = autres.heures.filter((x) => x.h < '15:00');
    const quinze = autres.heures.find((x) => x.h === '15:00');
    v('D2', Boolean(quinze), '15:00 reste proposable (le creneau en cours)', JSON.stringify(autres.heures.slice(0, 2)));
    if (role === 'manager') {
      // Les heures d avant ne se montrent que derriere « Plus tôt », pour noter un groupe deja venu.
      const avantPlusTot = passeesDuJour.length === 0 && autres.plusTot;
      if (autres.plusTot) await page.click('#rsPlusTot');
      await page.waitForTimeout(300);
      const tot = await lireAutres();
      const passees = tot.heures.filter((x) => x.h < '15:00');
      v('D2', passees.every((x) => x.efface), 'la page « Autres » ne peint aucune heure passee comme libre', JSON.stringify(passees.filter((x) => !x.efface).slice(0, 3)));
      await capture(page, `D2-plus-tot-${role}`, '.rs-heures');
      // Choisie, une heure passee se dit « passée » (noter un groupe deja venu).
      const notee = passees.find((x) => x.h === '14:00') || passees[0];
      let dite = '';
      if (notee) {
        await page.click(`#quickBookOverlay .rs-heures .rs-h[data-heure="${notee.h}"]`);
        await planPose(page);
        await page.waitForTimeout(300);
        const t = await lireTicket(page);
        dite = `${t.verdict} ${t.refus}`.trim();
        await capture(page, `D2-passee-${role}`, '#rvVerdict');
        await ouvrirAutres();
      }
      v('D2', avantPlusTot && passees.length > 0 && /passée/.test(dite), 'avec le droit « Modifier une date passée », les heures passees restent la (« Plus tôt »), dites « passée » une fois choisies', `plus tot ${autres.plusTot}, ${passees.length} heure(s) avant 15:00, ${notee ? notee.h : '-'} : « ${dite.slice(0, 120)} »`);
    } else {
      v('D2', passeesDuJour.every((x) => x.efface), 'la page « Autres » ne peint aucune heure passee comme libre', JSON.stringify(passeesDuJour.filter((x) => !x.efface).slice(0, 3)));
      v('D2', passeesDuJour.length === 0 && !autres.plusTot, 'sans ce droit, la page « Autres » commence au creneau en cours (pas de « Plus tôt »)', JSON.stringify({ premieres: autres.heures.slice(0, 2).map((x) => x.h), plusTot: autres.plusTot }));
    }
    await capture(page, `D2-autres-${role}`, '.rs-heures');
    // 15:30 coince (2026-11-03) : au niveau forcer, la toucher la prend « à placer », et le
    // lien du pied dit l heure proche et la prend (« Prendre HH:MM à la place », 2026-11-13) ;
    // sans lui, la toucher ne la prend pas, et l heure tapee a la barre donne le refus et ses
    // sorties (« Prendre HH:MM » sur Créer).
    await page.click('#quickBookOverlay .rs-heures .rs-h[data-heure="15:30"]');
    // Les sorties : l heure proche, et les seances qui tiennent (une heure qui coince reste a
    // sa place, elle n est pas une sortie).
    const SEANCES = '#quickBookOverlay #rsZ-bowling .rs-h[data-heure]:not(.is-on):not(.is-coince):not(.is-efface)';
    let sorties;
    if (role === 'manager') {
      await page.waitForSelector('#rvAPlacer', { timeout: 6000 }).catch(() => {});
      const prise = await page.evaluate(() => ({ heure: quickBookState.startTime, forcer: Boolean(quickBookState.forcer), aPlacer: Boolean(document.getElementById('rvAPlacer')) }));
      v('D2', prise.heure === '15:30' && prise.forcer && prise.aPlacer, 'au niveau forcer, toucher 15:30 qui coince la prend « à placer »', JSON.stringify(prise));
      await candidatsPoses(page);
      await page.waitForFunction(() => { const a = document.getElementById('rvForcer'); return Boolean(a && a.dataset.reprise); }, null, { timeout: 6000 }).catch(() => {});
      await page.waitForTimeout(300);
      sorties = await page.evaluate((sel) => {
        const lien = document.getElementById('rvForcer');
        return { proche: (lien && lien.dataset.reprise) || '', lien: lien ? lien.textContent.trim() : '', seances: [...document.querySelectorAll(sel)].map((b) => b.dataset.heure) };
      }, SEANCES);
      v('D2', Boolean(sorties.proche) && sorties.lien === `Prendre ${sorties.proche} à la place`, 'MONTAGE : 15:30 prise quand meme, le lien dit l heure proche (« Prendre HH:MM à la place »)', JSON.stringify(sorties));
      await capture(page, `D2-sorties-${role}`, '#rvForcer');
      await page.click('#rvForcer');
      const tient = await planPose(page, true);
      const reprise = await page.evaluate(() => ({ heure: rvHeureReglee('bowling', 0) || quickBookState.startTime, forcer: Boolean(quickBookState.forcer) }));
      v('D2', tient && reprise.heure === sorties.proche && !reprise.forcer, 'le lien prend cette heure : le bowling y tient, plus rien de force', JSON.stringify(reprise));
    } else {
      await page.waitForTimeout(300);
      const gardee = await page.evaluate(() => ({ heure: quickBookState.startTime, forcer: Boolean(quickBookState.forcer) }));
      v('D2', gardee.heure !== '15:30' && !gardee.forcer, 'sans le niveau forcer, toucher 15:30 qui coince ne la prend pas', JSON.stringify(gardee));
      await page.click('#rsRetour');
      await page.waitForSelector('#quickBookOverlay .is-q-activites', { timeout: 6000 });
      await page.keyboard.press('4');
      await page.locator('#rsBarre').fill('4 bowling 15h30');
      await page.locator('#rsBarre').evaluate((champ) => champ.blur());
      const refuse = await planPose(page, false);
      await candidatsPoses(page);
      await page.waitForFunction(() => { const b = document.getElementById('rvCreer'); return Boolean(b && b.dataset.proche); }, null, { timeout: 6000 }).catch(() => {});
      await page.waitForTimeout(300);
      sorties = await page.evaluate((sel) => ({
        proche: (document.getElementById('rvCreer') || { dataset: {} }).dataset.proche || '',
        seances: [...document.querySelectorAll(sel)].map((b) => b.dataset.heure),
      }), SEANCES);
      v('D2', refuse && Boolean(sorties.proche), 'MONTAGE : 15:30 refuse (pistes prises), des sorties proposees', `refus ${refuse}, ${JSON.stringify(sorties)}`);
      await capture(page, `D2-sorties-${role}`, '#rvRefus');
      // La sortie la plus proche (« Prendre HH:MM »), puis Creer.
      await page.click('#rvCreer');
      await planPose(page, true);
    }
    const heuresSorties = [sorties.proche, ...sorties.seances].filter(Boolean);
    v('D2', heuresSorties.every((h) => h >= '15:00'), 'aucune sortie avant le creneau de la demi-heure en cours (15:00)', JSON.stringify(heuresSorties));
    await page.waitForFunction(() => { const b = document.getElementById('rvCreer'); return Boolean(b && b.dataset.pret === '1'); }, null, { timeout: 6000 }).catch(() => {});
    await avecTelephone(page);
    await page.click('#rvCreer');
    await fenetreFermee(page);
    const nouvelles = creees(avant);
    v('D2', nouvelles.length === 1 && nouvelles[0].debut >= '15:00', 'la sortie choisie cree un dossier a une heure qui n est pas passee', JSON.stringify(nouvelles.map((r) => `${r.debut} pistes ${r.pistes.join('+')}`)));
    v('*', erreurs.length === 0, `zero erreur JS ni console [D2 ${role}]`, erreurs.slice(0, 2).join(' | '));
  } finally { await context.close(); }
}

// Le premier jour de vacances ouvert, au moins une semaine devant (les
// formules « hors vacances » y sont bloquees en ligne).
function jourDeVacances() {
  const { isFormulaBlockedDate, getSchedule } = require(path.join(ROOT, 'lib/booking-config.js'));
  const { getCenter } = require(path.join(ROOT, 'lib/ops-knowledge.js'));
  const centre = getCenter('libramont');
  for (let n = 7; n < 400; n += 1) {
    const d = decalerJour(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(new Date()), n);
    if (isFormulaBlockedDate(d, centre) && getSchedule(d, centre)) return d;
  }
  return '';
}

// Le premier jour ordinaire ouvert (ni vacances ni ferie), une semaine devant
// le jour de la page (JOUR : la console y est figee a 15:12). Compte depuis la
// vraie date, il tombait avant la page des que le banc passait apres lui
// (le 03/11 pour un banc au 07/11) : « 15:00 est déjà passée ».
function jourHorsVacances() {
  const { isFormulaBlockedDate, getSchedule } = require(path.join(ROOT, 'lib/booking-config.js'));
  const { getCenter } = require(path.join(ROOT, 'lib/ops-knowledge.js'));
  const centre = getCenter('libramont');
  for (let n = 7; n < 400; n += 1) {
    const d = decalerJour(JOUR, n);
    if (!isFormulaBlockedDate(d, centre) && getSchedule(d, centre)) return d;
  }
  return '';
}

// [D3] F4 pour 10 enfants, un jour de vacances, au comptoir.
async function scenarioD3(browser, v) {
  B.semer([]);
  monter({ role: 'manager' });
  const jour = jourDeVacances();
  v('D3', Boolean(jour), 'MONTAGE : un jour de vacances ouvert existe dans l annee', jour);
  if (!jour) return;
  const { context, page, erreurs } = await ouvrirConsole(browser, { instant: instantBruxelles(jour, 11, 0) });
  try {
    const avant = new Set(lireBase().map((r) => r.id));
    await page.evaluate((jour) => openQuickBook({ date: jour, startTime: '15:30', type: 'formule', formuleId: 'f4', pax: 10 }), jour);
    await page.waitForSelector('#quickBookOverlay .qb-modal.rv', { timeout: 8000 });
    await planPose(page);
    await page.waitForTimeout(300);
    const etat = await page.evaluate(() => {
      const p = quickBookState.plan && quickBookState.plan.resultat;
      return p ? { disponible: p.disponible, refus: p.refus, avertissement: p.avertissement, blocs: (p.blocs || []).map((b) => `${b.activite}:${b.debut}${b.pistes.length ? ` p${b.pistes.join('+')}` : ''}`), conflits: (p.conflits || []).map((c) => c.message) } : null;
    });
    // Avant le clic : tout ce que la fenetre montre (le ticket, sa ligne d etat, le pied,
    // et la page de gauche).
    const fenetre = await texteDe(page, '#quickBookOverlay .qb-modal');
    const verdict = await texteDe(page, '#rvVerdict');
    v('D3', Boolean(etat && etat.disponible && etat.blocs.some((b) => /^bowling:.* p\d/.test(b)) && etat.blocs.some((b) => /^laser_game:/.test(b))), 'au comptoir, F4 en vacances a un vrai plan : pistes et arene posees', JSON.stringify(etat));
    // Le prerequis : le serveur donne la raison avec le plan ; la fenetre doit la dire.
    v('D3', Boolean(etat) && /vacances/i.test(String(etat.avertissement || '')), 'MONTAGE : le plan du serveur porte la vraie raison (vacances)', JSON.stringify(etat ? etat.avertissement : null));
    v('D3', /vacances/i.test(fenetre) && !/Pas de plan possible/i.test(fenetre), 'la vraie raison (vacances) est dite avant le clic, jamais « Pas de plan possible »', `verdict « ${verdict.slice(0, 160)} »`);
    // Un avertissement n est pas un refus : il se dit en orange, et Créer reste pret.
    const couleurs = await memeEtat(page);
    v('D3', couleurs.meme && couleurs.verdict === 'att' && couleurs.pied === 'pret', 'c est un avertissement : le verdict le dit en orange, Créer reste pret', JSON.stringify(couleurs));
    await capture(page, 'D3-formule-vacances', '#rvVerdict');
    await avecTelephone(page);
    await page.click('#rvCreer');
    const ferme = await fenetreFermee(page);
    const nouvelles = creees(avant);
    const r = nouvelles[0] || {};
    v('D3', ferme && nouvelles.length === 1 && r.pistes.length >= 1 && r.blocs.length > 0 && !(r.plan && r.plan.aPlacer), 'le dossier est cree place (pistes et blocs), pas « à placer »', JSON.stringify({ ferme, pistes: r.pistes, blocs: (r.blocs || []).length, aPlacer: Boolean(r.plan && r.plan.aPlacer) }));
    v('D3', /vacances/i.test(r.notes || ''), 'la raison est notee sur le dossier', JSON.stringify(String(r.notes || '').slice(0, 160)));
    v('*', erreurs.length === 0, 'zero erreur JS ni console [D3]', erreurs.slice(0, 2).join(' | '));
  } finally { await context.close(); }
  // En ligne, la formule reste bloquee ce jour-la.
  const pub = await appelerPublic(corpsPublic({ date: jour, type: 'formule', formuleId: 'f4', formulaId: 'f4', program: undefined, pax: 10, startTime: '15:30', preference: {} }));
  v('D3', pub.statut >= 400 && !lireBase().some((x) => x.date === jour && x.canal === 'public'), 'en ligne, F4 reste refusee un jour de vacances', `${pub.statut} ${pub.json.message || ''}`);
  // Le serveur : un refus dit sa vraie raison (le moteur la donne dans le plan).
  const sim = await banc.monte.appeler('POST', '/api/staff-reservations', B.corpsStaff({ date: jour, type: 'formule', formuleId: 'f4', pax: 2, startTime: '15:30', dryRun: true }));
  const plan = sim.json.plan || {};
  v('D3', plan.disponible === false && /minimum|6/i.test(String(plan.refus || '')) && !(plan.conflits || []).some((c) => /Pas de plan possible/.test(c.message)), 'un refus du moteur dit sa vraie raison (F4 a 2 : le minimum), jamais « Pas de plan possible »', JSON.stringify({ refus: plan.refus, conflits: (plan.conflits || []).map((c) => c.message) }));
}

// [D4] Le nom d un client deja venu, retape.
async function scenarioD4(browser, v) {
  B.semer([B.ligne(840, { date: '2026-09-12', start_time: '15:00', lanes: [2], name: 'Famille Lambert', phone: '+32 470 55 44 33', pax: 6 })]);
  monter({ role: 'manager' });
  const { context, page, erreurs } = await ouvrirConsole(browser);
  try {
    await page.evaluate((jour) => openQuickBook({ date: jour, startTime: '18:00', pax: 6 }), JOUR);
    // Le telephone et le nom ont chacun leur champ, au ticket (2026-11-11).
    await page.waitForSelector('#qbPhone', { timeout: 8000 });
    await page.click('#qbPhone');
    await page.keyboard.press('Control+A');
    await page.keyboard.type('0470 55 44 33', { delay: 15 });
    const reconnu = await page.waitForFunction(() => quickBookState && quickBookState.clientConnu && quickBookState.clientConnu.etat === 'ok' && quickBookState.name === 'Famille Lambert', null, { timeout: 6000 }).then(() => true, () => false);
    v('D4', reconnu, 'MONTAGE : le numero reconnait la Famille Lambert, son nom est repris', '');
    await page.click('#qbName');
    await page.keyboard.type('Famille Lambert', { delay: 15 });
    const nom = await page.evaluate(() => ({ etat: quickBookState.name, champ: (document.getElementById('qbName') || {}).value }));
    v('D4', nom.etat === 'Famille Lambert' && nom.champ === 'Famille Lambert', 'retaper le nom reconnu ne le double pas', JSON.stringify(nom));
    await capture(page, 'D4-nom-reconnu');
    v('*', erreurs.length === 0, 'zero erreur JS ni console [D4]', erreurs.slice(0, 2).join(' | '));
  } finally { await context.close(); }
}

// [D5] Un autre poste prend la derniere piste pendant que la fenetre est ouverte.
async function scenarioD5(browser, v) {
  B.semer([1, 2, 3, 4, 5, 6, 7].map((p) => pisteOccupee(850 + p, p)));
  monter({ role: 'manager' });
  const { context, page, erreurs } = await ouvrirConsole(browser);
  try {
    await ouvrirReserver(page);
    await choisirJoueurs(page, 4);
    const possible = await planPose(page, true);
    await page.waitForFunction(() => { const b = document.getElementById('rvCreer'); return Boolean(b && b.dataset.pret === '1'); }, null, { timeout: 6000 }).catch(() => {});
    // « Possible » se lit sur le ticket : la ligne du bowling dit sa piste, Créer est pret.
    const avantTicket = await lireTicket(page);
    const avantTexte = `${avantTicket.ticket} | ${avantTicket.creer ? avantTicket.creer.texte : ''}`;
    v('D5', possible && /piste 8\b/.test(avantTicket.ticket) && Boolean(avantTicket.creer && avantTicket.creer.pret === '1'), 'MONTAGE : a l heure proposee, il reste la piste 8 : « possible »', avantTexte.slice(0, 160));
    // L autre poste.
    const autre = await banc.monte.appeler('POST', '/api/staff-reservations', B.corpsStaff({ type: 'bowling', pax: 4, startTime: '15:30', duration: 1, totalDuration: 1, lanes: [8], laneCount: 1, name: 'Autre poste', phone: '0470999999' }));
    v('D5', autre.statut === 201, 'MONTAGE : un autre poste prend la piste 8 a 15:30', `${autre.statut} ${autre.json.message || ''}`);
    const suivi = await page.waitForFunction(() => {
      const s = quickBookState;
      const p = s && s.plan && s.plan.etat === 'ok' && s.plan.cle === s.cleCourante ? s.plan.resultat : null;
      return Boolean(p && p.disponible === false);
    }, null, { timeout: 9000, polling: 200 }).then(() => true, () => false);
    await page.waitForTimeout(400);
    // Il ne dit plus « possible » : le refus est en rouge sur la ligne, et Créer n est plus
    // pret a creer l heure dite (il propose une sortie ou s arrete).
    const apres = await lireTicket(page);
    const apresTexte = `${apres.refus} | ${apres.creer ? apres.creer.texte : ''}`;
    v('D5', suivi && apres.refusRouge && Boolean(apres.creer) && apres.creer.pret !== '1' && !/^Créer à/.test(apres.creer.texte), 'le verdict suit la journee : il ne dit plus « possible »', apresTexte.slice(0, 140));
    const avant = new Set(lireBase().map((r) => r.id));
    await page.focus('#rvCreer');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1200);
    const erreur = await texteDe(page, '#quickBookOverlay .qb-modal');
    const nouvelles = creees(avant);
    const ditApres = await texteDe(page, '#rvVerdict');
    v('D5', nouvelles.length === 0 && !/Il faut 1 piste/.test(erreur), 'Entree ne cree rien par-dessus l autre poste, et ne repond pas « Il faut 1 piste disponible »', `« ${(erreur.match(/[^.]*Il faut 1 piste[^.]*/) || [ditApres])[0].slice(0, 140)} » ${nouvelles.length} cree(s)`);
    await capture(page, 'D5-autre-poste');
    v('*', erreurs.length === 0, 'zero erreur JS ni console [D5]', erreurs.slice(0, 2).join(' | '));
  } finally { await context.close(); }
}

// [D6] « Laser 12 a 16:30 » depuis le bouton « + Réservation ».
async function scenarioD6(browser, v) {
  B.semer([]);
  monter({ role: 'staff-bar' });
  const { context, page, erreurs } = await ouvrirConsole(browser);
  const clics = [];
  try {
    const avant = new Set(lireBase().map((r) => r.id));
    await clic(clics, page.locator('#planningReserver'), 'Réservation');
    await page.waitForSelector('#quickBookOverlay .qb-modal.rv.rs', { timeout: 8000 });
    await clic(clics, page.locator('#quickBookOverlay #rsHaut [data-pax="12"]'), '12');
    // Le laser est replie a cote du bowling propose : « Choisir » le prend a sa place
    // (2026-11-08), puis un toucher sur 16:30 choisit l heure ; toute la journee est la.
    // Si 16:30 n est pas parmi les seances montrees, on passe par « Autres », comme au
    // comptoir (un geste de plus, compte).
    await clic(clics, page.locator('#quickBookOverlay #rsAjout-laser_game'), 'Choisir (laser)');
    await page.waitForSelector('#quickBookOverlay #rsZ-laser_game .rs-s-l .rs-h-autres', { timeout: 6000 });
    const seance = page.locator('#quickBookOverlay #rsZ-laser_game .rs-h[data-heure="16:30"]');
    if (await seance.first().isVisible().catch(() => false)) {
      await clic(clics, seance, 'laser 16:30');
    } else {
      await clic(clics, page.locator('#quickBookOverlay #rsZ-laser_game .rs-h-autres'), 'Autres (laser)');
      await clic(clics, page.locator('#quickBookOverlay .rs-heures .rs-h[data-heure="16:30"]'), '16:30');
    }
    const compo = await page.evaluate(() => rvActivites());
    v('D6', JSON.stringify(compo) === '["laser_game"]', '« Choisir » sur le laser compose un laser seul (le bowling de depart n etait qu une proposition)', JSON.stringify(compo));
    await planPose(page, true);
    await capture(page, 'D6-laser-12-1630');
    await avecTelephone(page);
    await clic(clics, page.locator('#rvCreer'), 'Créer');
    const ferme = await fenetreFermee(page);
    const nouvelles = creees(avant);
    const r = nouvelles[0] || {};
    v('D6', ferme && nouvelles.length === 1 && r.type === 'laser' && Number(r.pax) === 12 && r.debut === '16:30', 'le dossier est le laser de 12 a 16:30', JSON.stringify(nouvelles.map((x) => `${x.type} ${x.pax} ${x.debut}`)));
    v('D6', clics.length <= 7, `${clics.length} clics au plus 7 (${clics.join(' > ')})`, '');
    v('*', erreurs.length === 0, 'zero erreur JS ni console [D6]', erreurs.slice(0, 2).join(' | '));
  } catch (e) {
    v('D6', false, 'le parcours en clics va au bout', `${String(e.message || e).split(LF)[0]} (clics : ${clics.join(' > ')})`);
  } finally { await context.close(); }
}

// [D7] Deux resas du meme client, en Auto, au meme moment.
async function scenarioD7(browser, v) {
  B.semer([]);
  monter({ role: 'manager' });
  const { context, page, erreurs } = await ouvrirConsole(browser);
  try {
    journalApi.length = 0;
    await page.evaluate((jour) => openQuickBook({ date: jour, startTime: '18:00', type: 'bowling', pax: 6 }), JOUR);
    await planPose(page, true);
    await page.click('#rvEncore');
    await page.waitForTimeout(400);
    // La 2e resa du lot a son propre nombre de joueurs, a toucher (« Combien de joueurs ? »).
    await choisirJoueurs(page, 4);
    await planPose(page);
    await page.waitForTimeout(500);
    const sims = journalApi.filter((j) => j.nom === 'staff-reservations' && j.corps && j.corps.dryRun);
    const pistesEnvoyees = sims.flatMap((j) => [j.corps, ...(j.corps.autres || [])]).map((c) => (Array.isArray(c.lanes) ? c.lanes.length : 0));
    const texte = await texteDe(page, '#quickBookOverlay .qb-modal');
    v('D7', sims.length > 0 && pistesEnvoyees.every((n) => n === 0), 'en Auto, la simulation n envoie aucune piste comme un choix (le serveur attribue)', JSON.stringify({ simulations: sims.length, pistes: pistesEnvoyees }));
    v('D7', !/Simulation/.test(texte) && !/prise de 18:00 à 19:00/.test(texte), 'aucun faux conflit, jamais « Simulation » a l ecran', (texte.match(/[^.]*(Simulation|prise de 18:00)[^.]*/) || [''])[0].slice(0, 160));
    await capture(page, 'D7-deux-resas');
    // Un VRAI conflit dans le meme envoi (la 2e resa choisit a la main la
    // piste que la 1re prend) nomme la 1re par son rang, jamais « Simulation ».
    const pisteDeLaPremiere = await page.evaluate(() => {
      const p = rvResas[0] && rvResas[0].plan && rvResas[0].plan.resultat;
      const b = p ? (p.blocs || []).find((x) => x.activite === 'bowling' && x.pistes.length) : null;
      return b ? b.pistes[0] : 0;
    });
    await page.evaluate((piste) => toggleQuickLane(piste), pisteDeLaPremiere);
    await planPose(page);
    await page.waitForTimeout(400);
    const vrai = await page.evaluate(() => ((quickBookState.plan && quickBookState.plan.resultat && quickBookState.plan.resultat.conflits) || []).map((c) => c.message).join(' | '));
    v('D7', /la réservation 1 de cet envoi/.test(vrai) && !/Simulation/.test(vrai), 'un vrai conflit du meme envoi nomme la 1re resa par son rang', `piste ${pisteDeLaPremiere} : ${vrai.slice(0, 180)}`);
    await page.evaluate(() => setQuickAutoAssign());
    await planPose(page);
    await page.waitForTimeout(300);
    const avant = new Set(lireBase().map((r) => r.id));
    await avecTelephone(page);
    await page.click('#rvCreer');
    await fenetreFermee(page);
    const nouvelles = creees(avant);
    const pistes = nouvelles.flatMap((r) => r.pistes);
    v('D7', nouvelles.length === 2 && new Set(pistes).size === pistes.length && pistes.length >= 2, 'les deux resas sont creees, chacune sur ses pistes', JSON.stringify(nouvelles.map((r) => `${r.pax} p${r.pistes.join('+')}`)));
    v('*', erreurs.length === 0, 'zero erreur JS ni console [D7]', erreurs.slice(0, 2).join(' | '));
  } finally { await context.close(); }
}

// [D8] Le clavier dans les seances (l horloge de l ancienne fenetre n existe plus).
async function scenarioD8(browser, v) {
  B.semer([]);
  monter({ role: 'manager' });
  const { context, page, erreurs } = await ouvrirConsole(browser);
  // Une seance se nomme par son heure ; l heure choisie porte l id #rvHeure-<activite>.
  const focus = () => page.evaluate(() => { const a = document.activeElement; if (!a) return ''; const h = a.classList.contains('rs-h') && a.dataset.heure ? `${a.id ? `#${a.id}` : 'h'}:${a.dataset.heure}` : ''; if (h) return h; if (a.id) return `#${a.id}`; return `.${String(a.className).split(' ').join('.')}`; });
  try {
    const avant = new Set(lireBase().map((r) => r.id));
    await page.evaluate((jour) => openQuickBook({ date: jour, startTime: '18:00', type: 'bowling', pax: 4 }), JOUR);
    await planPose(page, true);
    await page.waitForSelector('#quickBookOverlay #rsZ-bowling #rvHeure-bowling', { timeout: 6000 });
    await page.waitForTimeout(400);
    await page.focus('#rvHeure-bowling');
    const ouvert = await focus();
    v('D8', ouvert === '#rvHeure-bowling:18:00', 'MONTAGE : le focus sur la seance choisie, 18:00', ouvert);
    await page.keyboard.press('ArrowRight');
    const droite = await focus();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    const gauche = await focus();
    v('D8', droite === 'h:18:30' && gauche === 'h:17:30', 'les fleches parcourent les heures', `${ouvert} > ${droite} > ${gauche}`);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    const visee = await focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);
    const apres = await focus();
    const heure = await page.evaluate(() => quickBookState && quickBookState.startTime);
    const nouvelles = creees(avant);
    // Deux choses : le focus ne tombe pas sur la fenetre (il reste sur une seance), et
    // c est la seance choisie qui l a.
    v('D8', visee === 'h:18:30' && heure === '18:30' && /^(#rvHeure-bowling|h):\d{2}:\d{2}$/.test(apres) && nouvelles.length === 0, 'Entree sur une heure atteinte au clavier la pose (sans creer), le focus reste sur les seances (pas sur la fenetre)', `${visee} > ${heure}, focus ${apres}, ${nouvelles.length} cree(s)`);
    v('D8', apres === '#rvHeure-bowling:18:30', 'apres Entree, le focus est sur l heure choisie', `focus ${apres}`);
    await capture(page, 'D8-clavier', '#rvHeure-bowling');
    // LA RANGEE QUI BOUGE SOUS LE FOCUS. Toute la journee est a l ecran (2026-11-08) : la
    // rangee ne glisse plus quand l heure change. Elle bouge encore quand son debut change
    // (le jour, la seance en cours qui passe) : chaque touche gardee dit alors une autre
    // heure, et le focus suit l heure, pas la place.
    const premiere = () => page.evaluate(() => { const b = document.querySelector('#quickBookOverlay #rsZ-bowling .rs-h[data-heure]'); return b ? b.dataset.heure : ''; });
    const debutAvant = await premiere();
    const lendemain = await page.evaluate((jour) => { const d = new Date(`${jour}T12:00:00`); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }, JOUR);
    await page.evaluate((jour) => rsJour(jour), lendemain);
    await planPose(page).catch(() => {});
    await page.waitForTimeout(400);
    const debutApres = await premiere();
    const suivi = await focus();
    v('D8', debutApres !== debutAvant && /:18:30$/.test(suivi), 'le jour change sous le focus, la rangee commence ailleurs : le focus reste sur 18:30', `${debutAvant} > ${debutApres}, focus ${suivi}`);
    v('*', erreurs.length === 0, 'zero erreur JS ni console [D8]', erreurs.slice(0, 2).join(' | '));
  } finally { await context.close(); }
}

// Ce qui est coupe ou cache : un element est entier quand son texte tient dans
// sa boite et que sa boite tient dans celle qui le fait defiler ou le coupe.
const MESURE = `(() => {
  const coupe = (el) => {
    if (!el) return 'absent';
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return 'invisible';
    let p = el.parentElement;
    while (p && p !== document.body) {
      const st = getComputedStyle(p);
      if (/(hidden|auto|scroll|clip)/.test(st.overflowX + st.overflowY)) {
        const q = p.getBoundingClientRect();
        if (r.left < q.left - 0.5 || r.right > q.right + 0.5 || r.top < q.top - 0.5 || r.bottom > q.bottom + 0.5) return 'coupe par ' + (p.id || p.className || p.tagName);
      }
      p = p.parentElement;
    }
    if (r.right > window.innerWidth + 0.5 || r.left < -0.5) return 'hors ecran';
    return '';
  };
  const texteCoupe = (el) => {
    if (!el) return 'absent';
    const range = document.createRange();
    range.selectNodeContents(el);
    const t = range.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return t.width > r.width + 1 ? 'texte coupe (' + Math.round(t.width) + ' > ' + Math.round(r.width) + ')' : '';
  };
  return { coupe, texteCoupe };
})()`;

// [D9] La tablette 1024 x 768 et le telephone 390.
async function scenarioD9(browser, v) {
  B.semer([]);
  monter({ role: 'manager' });
  {
    const { context, page, erreurs } = await ouvrirConsole(browser, { viewport: { width: 1024, height: 768 }, toucher: true });
    try {
      await ouvrirReserver(page);
      await planPose(page);
      await page.waitForTimeout(400);
      const lu = await page.evaluate((MESURE) => {
        const { coupe, texteCoupe } = eval(MESURE);
        // La rangee Jour finit par « Autre date » ; la rangee Joueurs va de 1 a 20.
        const autre = [...document.querySelectorAll('#quickBookOverlay #rsHaut .rs-seg > *')].pop();
        const tailles = [...document.querySelectorAll('#quickBookOverlay #rsHaut [data-pax]')].map((b) => ({ t: b.textContent.trim(), c: coupe(b) }));
        const champ = document.getElementById('qbPhone');
        let placeholder = champ ? '' : 'absent';
        if (champ) {
          const ctx = document.createElement('canvas').getContext('2d');
          const st = getComputedStyle(champ);
          ctx.font = `${st.fontWeight} ${st.fontSize} ${st.fontFamily}`;
          const largeur = ctx.measureText(champ.placeholder).width;
          const utile = champ.clientWidth - parseFloat(st.paddingLeft) - parseFloat(st.paddingRight);
          placeholder = largeur > utile + 1 ? `invite coupee (${Math.round(largeur)} > ${Math.round(utile)})` : '';
        }
        return { autre: autre ? `${autre.textContent.trim()} ${coupe(autre)}` : 'absent', autreCoupe: autre ? coupe(autre) : 'absent', tailles, invite: champ ? `« ${champ.placeholder} » ${texteCoupe(champ) || placeholder}` : 'absent', placeholder };
      }, MESURE);
      v('D9', lu.autreCoupe === '', '1024 x 768 : le bouton de date « Autre » est entier', lu.autre);
      v('D9', lu.tailles.length >= 8 && lu.tailles.every((t) => t.c === ''), '1024 x 768 : toutes les tailles du groupe (jusqu a 20) se voient', JSON.stringify(lu.tailles.filter((t) => t.c)));
      v('D9', lu.placeholder === '', '1024 x 768 : l invite du champ client n est pas coupee', lu.invite);
      await capture(page, 'D9-1024');
      v('*', erreurs.length === 0, 'zero erreur JS ni console [D9 1024]', erreurs.slice(0, 2).join(' | '));
    } finally { await context.close(); }
  }
  {
    const { context, page, erreurs } = await ouvrirConsole(browser, { viewport: { width: 390, height: 844 }, toucher: true });
    // Ce qui se touche est entier sous le doigt : rien du pied (ligne d etat, Créer)
    // ni d autre chose par-dessus, une fois amene a l ecran.
    const sousLeDoigt = (sels) => page.evaluate(async (sels) => {
      const res = [];
      for (const sel of sels) {
        const b = document.querySelector(sel);
        if (!b) { res.push({ t: sel, ok: false, dessus: 'absent' }); continue; }
        b.scrollIntoView({ block: 'nearest' });
        await new Promise((ok) => setTimeout(ok, 120));
        const r = b.getBoundingClientRect();
        const dessus = r.width && r.height ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
        const lu = dessus && dessus.closest('label') ? dessus.closest('label') : dessus;
        res.push({ t: sel, ok: Boolean(dessus && (dessus === b || b.contains(dessus) || (lu && lu.contains(b)))), dessus: dessus ? (dessus.id || dessus.className || dessus.tagName) : 'rien' });
      }
      return res;
    }, sels);
    try {
      await ouvrirReserver(page);
      await planPose(page);
      await page.waitForTimeout(400);
      // Au telephone, le ticket s ouvre au toucher du resume (barre basse).
      await page.click('#quickBookOverlay #rsResume');
      await page.waitForSelector('#quickBookOverlay .qb-modal.rv.rs.is-ticket', { timeout: 6000 });
      await page.waitForTimeout(300);
      const ticket = await sousLeDoigt(['#qbPhone', '#qbName', '#qbNotes', '#rsL-client']);
      // « E-mail, occasion » ouvre la page de l e-mail.
      await page.click('#quickBookOverlay #rsL-client');
      await page.waitForSelector('#quickBookOverlay #qbEmail', { timeout: 6000 });
      await page.waitForTimeout(300);
      const client = await sousLeDoigt(['#qbEmail']);
      const sous = [...ticket, ...client];
      v('D9', sous.length === 5 && sous.every((x) => x.ok), '390 : le telephone, le nom, la note et l e-mail se touchent, rien du pied par-dessus', JSON.stringify(sous.filter((x) => !x.ok)));
      await capture(page, 'D9-390', '#qbEmail');
      v('*', erreurs.length === 0, 'zero erreur JS ni console [D9 390]', erreurs.slice(0, 2).join(' | '));
    } finally { await context.close(); }
  }
}

// La page d une ligne du bowling : ses touches « Pistes » (combien, laquelle est
// prise, laquelle est dite conseillee), le mot sous une heure, le tarif en tete.
async function lirePistes(page) {
  return page.evaluate(() => ({
    touches: [...document.querySelectorAll('#quickBookOverlay [data-pistes]')].map((b) => ({ n: Number(b.dataset.pistes), texte: ((b.querySelector('b') || {}).textContent || '').trim(), on: b.getAttribute('aria-pressed') === 'true', sous: ((b.querySelector('small') || {}).textContent || '').trim() })),
    tete: ((document.querySelector('#quickBookOverlay .rs-seance.is-page .rs-s-n small') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
    heures: [...document.querySelectorAll('#quickBookOverlay [data-heure-l]')].map((b) => ({ h: b.dataset.heureL, mot: ((b.querySelector('small') || {}).textContent || '').trim(), nom: b.getAttribute('aria-label') || '' })),
  }));
}

// [D10] Les mots.
async function scenarioD10(browser, v) {
  // 1. Un refus de pistes se dit avec ses accents.
  B.semer([1, 2, 3, 4, 5, 6, 7, 8].map((p) => pisteOccupee(870 + p, p)));
  monter({ role: 'manager' });
  {
    const { context, page, erreurs } = await ouvrirConsole(browser);
    try {
      await ouvrirReserver(page);
      await choisirJoueurs(page, 4);
      await page.evaluate(() => rvChoisirHeure('bowling', 0, '15:30'));
      await planPose(page, false);
      await page.waitForSelector('#quickBookOverlay #rvRefus', { timeout: 6000 }).catch(() => {});
      // Le refus se dit une fois, en rouge sur la ligne du ticket.
      const refus = await texteDe(page, '#quickBookOverlay #rvRefus');
      v('D10', !/ a \d{1,2}:\d{2}/.test(refus) && /à 15:30/.test(refus), 'les refus du moteur ont leurs accents (« à 15:30 »)', refus.slice(0, 140));
      v('*', erreurs.length === 0, 'zero erreur JS ni console [D10 refus]', erreurs.slice(0, 2).join(' | '));
    } finally { await context.close(); }
  }
  // Le laser plein se dit en clair : combien de joueurs, combien de places.
  B.semer([B.ligne(880, { start_time: '16:30', type: 'laser', lanes: [], name: 'Groupe laser', pax: 26, duration: 0.5,
    ops_plan: { resourceBlocks: [{ activityId: 'laser_game', resourceType: 'laser_arena', countIndex: 1, start: 990, end: 1015, startTime: '16:30', endTime: '16:55', players: 26 }] } })]);
  monter({ role: 'manager' });
  const laser = await banc.monte.appeler('POST', '/api/staff-reservations', B.corpsStaff({ type: 'laser', pax: 12, startTime: '16:30', laserGames: 1, duration: 0.5, dryRun: true }));
  const raisonLaser = String((laser.json.plan || {}).refus || ((laser.json.plan || {}).conflits || []).map((c) => c.message).join(' '));
  // La regle, pas la phrase : l heure accentuee, ce qui reste (4 places sur
  // 30) et ce qu il faut (12), sans jargon (« lancement(s) », « 38/30 »).
  v('D10', /à 16:30/.test(raisonLaser) && /\b4 places?\b/.test(raisonLaser) && /\b30\b/.test(raisonLaser) && /\b12\b/.test(raisonLaser) && !/lancement\(s\)|charge a |\d+\/\d+ joueurs/.test(raisonLaser), 'le laser plein se dit en clair (« à 16:30 », il reste 4 places sur 30, il en faut 12)', raisonLaser.slice(0, 160));
  // 2 a 6, sur une journee vide.
  B.semer([]);
  monter({ role: 'manager' });
  const { context, page, erreurs } = await ouvrirConsole(browser);
  try {
    // 2. A 15:12, la seance en cours (15:00) se dit « maintenant » : jamais une
    // heure d arrivee deja passee.
    await page.evaluate((jour) => openQuickBook({ date: jour, startTime: '15:00', type: 'bowling', pax: 4 }), JOUR);
    await planPose(page);
    await page.waitForFunction(() => { const b = document.querySelector('#quickBookOverlay #rsZ-bowling .rs-h[data-heure="15:00"] small'); return Boolean(b && b.textContent.trim()); }, null, { timeout: 6000 }).catch(() => {});
    const seances = await page.evaluate(() => [...document.querySelectorAll('#quickBookOverlay #rsZ-bowling .rs-h[data-heure]')].map((b) => ({ h: b.dataset.heure, mot: ((b.querySelector('.rs-h-tag') || {}).textContent || '').trim() })));
    const enCours = seances.find((x) => x.h === '15:00');
    v('D10', Boolean(enCours) && enCours.mot === 'maintenant' && seances.every((x) => x.h >= '15:00'), 'a 15:12, la seance en cours (15:00) se dit « maintenant », jamais une arrivee deja passee', JSON.stringify(seances.slice(0, 3)));
    // 3. Les pistes conseillees sont celles que le plan pose ; « libres » ne compte
    // pas le groupe. La page de la ligne du bowling les dit.
    await page.evaluate((jour) => { closeQuickBook(); openQuickBook({ date: jour, startTime: '18:00', type: 'bowling', pax: 5 }); }, JOUR);
    await planPose(page);
    await page.waitForTimeout(300);
    await page.click('#quickBookOverlay #rsL-a-bowling');
    await page.waitForSelector('#quickBookOverlay [data-pistes]', { timeout: 6000 });
    await page.waitForFunction(() => { const b = document.querySelector('#quickBookOverlay [data-heure-l="18:00"] small'); return Boolean(b && b.textContent.trim()); }, null, { timeout: 6000 }).catch(() => {});
    const plan5 = await page.evaluate(() => (quickBookState.plan && quickBookState.plan.resultat ? quickBookState.plan.resultat.blocs : []).filter((b) => b.activite === 'bowling').flatMap((b) => b.pistes));
    const p5 = await lirePistes(page);
    const prise5 = (p5.touches.find((t) => t.on) || {}).n || 0;
    const conseillee5 = (p5.touches.find((t) => t.sous === 'conseillé') || {}).n || 0;
    v('D10', prise5 > 0 && prise5 === conseillee5 && prise5 === new Set(plan5).size, 'les pistes conseillees sont celles que le plan pose', `${JSON.stringify(p5.touches.map((t) => `${t.texte}${t.on ? '*' : ''}${t.sous ? ` (${t.sous})` : ''}`))} | plan ${JSON.stringify(plan5)}`);
    const libresTete = (p5.tete.match(/(\d+) pistes? libres?/) || [])[1];
    const dix8 = p5.heures.find((x) => x.h === '18:00') || {};
    const motDix8 = dix8.mot || '';
    // Ce qui RESTERA apres ce groupe (2026-11-05) : 8 pistes, une pour lui, il en reste 7. La
    // touche le dit en court (« reste 7 », 2026-11-08 : toute la journee tient dans des
    // touches plus petites), son nom en entier (« reste 7 pistes »).
    const libresHeure = (motDix8.match(/^reste (\d+)$/) || [])[1];
    const libresNom = ((dix8.nom || '').match(/reste (\d+) pistes?/) || [])[1];
    v('D10', libresHeure === '7' && libresNom === '7' && (!libresTete || libresTete === '8'), 'sur une journee vide, la ligne dit ce qui restera apres le groupe : 7 pistes sur 8', `tete « ${p5.tete} » | 18:00 « ${motDix8} » nom « ${dix8.nom || ''} »`);
    // 4. Le haut et le bas du ticket disent le meme etat.
    const c1 = await memeEtat(page);
    v('D10', c1.meme, 'le verdict et le pied ont la meme couleur (bowling 5)', JSON.stringify(c1));
    // 4 bis. Le nombre CONSEILLE est celui du centre : deux pistes posees pour 4
    // joueurs ne deplacent pas « conseillé » sur 2 ; chaque touche nomme ce qu elle
    // compte (« 2 pistes »).
    await choisirJoueurs(page, 4);
    await planPose(page);
    await page.click('#quickBookOverlay [data-pistes="2"]');
    await planPose(page);
    await page.waitForTimeout(300);
    const p4 = await lirePistes(page);
    const prise4 = (p4.touches.find((t) => t.on) || {}).n || 0;
    const conseillees4 = p4.touches.filter((t) => t.sous === 'conseillé').map((t) => t.n);
    v('D10', prise4 === 2 && conseillees4.join() === '1', 'le nombre dit « conseillé » est celui de la regle Auto (2 pistes posees pour 4 joueurs : 1 conseillee)', JSON.stringify(p4.touches.map((t) => `${t.texte}${t.on ? '*' : ''}${t.sous ? ` (${t.sous})` : ''}`)));
    v('D10', p4.touches.length > 0 && p4.touches.every((t) => /^\d+ pistes?$/.test(t.texte) && Number(t.texte.split(' ')[0]) === t.n), 'la suggestion de pistes nomme ce qu elle compte (« Avec 3 pistes », pas « Avec 3, ils sont »)', JSON.stringify(p4.touches.map((t) => t.texte)));
    await page.evaluate(() => { quickBookState.pistesNombre = null; renderQuickBook(); });
    // 5. Des pistes choisies a la main, puis plus de joueurs : seules les
    // choisies se disent « choisies à la main » (la ligne du ticket).
    await page.evaluate(() => { toggleQuickLane(7); toggleQuickLane(8); });
    await planPose(page);
    await page.evaluate(() => setQuickPax(20));
    await planPose(page);
    await page.waitForTimeout(300);
    const etape = await texteDe(page, '#quickBookOverlay #rsL-a-bowling');
    const pistesEtape = ((etape.match(/pistes? ([\d, et]+)/) || [])[1] || '').match(/\d+/g) || [];
    const ditesALaMain = /dont ([\d, et]+) choisies? à la main/.test(etape) ? (etape.match(/dont ([\d, et]+) choisies? à la main/)[1].match(/\d+/g) || []) : /choisies? à la main/.test(etape) ? pistesEtape : [];
    v('D10', pistesEtape.length >= 4 && ditesALaMain.every((p) => p === '7' || p === '8') && ditesALaMain.length > 0, 'des pistes ajoutees par la fenetre ne se disent pas « choisies à la main » (seules 7 et 8 le sont)', etape);
    // 6. Une formule adaptee : le detail du prix (le recu de la page Total) fait le total.
    await page.evaluate((jour) => { closeQuickBook(); openQuickBook({ date: jour, startTime: '18:00', type: 'formule', formuleId: 'f4', pax: 10 }); }, JOUR);
    await planPose(page);
    await page.evaluate(() => rvAdapterFormule(true));
    await planPose(page);
    await page.waitForTimeout(300);
    await page.click('#quickBookOverlay #rsL-total');
    await page.waitForSelector('#quickBookOverlay .rs-recu li', { timeout: 6000 });
    const prix = await page.evaluate(() => ({
      total: ((document.querySelector('#quickBookOverlay .rs-total-g') || {}).textContent || '').trim(),
      pied: ((document.getElementById('rvTotalPied') || {}).textContent || '').trim(),
      lignes: [...document.querySelectorAll('#quickBookOverlay .rs-recu li')].map((li) => ({ detail: ((li.querySelector('small') || {}).textContent || '').trim(), montant: ((li.querySelector('b') || {}).textContent || '').trim(), texte: li.innerText.replace(/\s+/g, ' ').trim() })),
    }));
    // Le detail dit d ou vient le total : un prix fois un nombre qui fait sa ligne,
    // et des montants dont la somme le fait.
    const euros = (t) => Number(String(t).replace(/[^\d,.-]/g, '').replace(',', '.')) || 0;
    const total = euros(prix.total);
    const somme = prix.lignes.reduce((s, l) => s + euros(l.montant), 0);
    const produits = prix.lignes.map((l) => ({ l, m: /(\d+) joueurs? × (\d+(?:[.,]\d+)?)/.exec(l.detail) })).filter((x) => x.m);
    const explique = prix.lignes.length > 0 && produits.every((x) => Math.abs(Number(x.m[1]) * euros(x.m[2]) - euros(x.l.montant)) < 0.01) && Math.abs(somme - total) < 0.01 && Math.abs(euros(prix.pied) - total) < 0.01;
    v('D10', total > 0 && explique, 'le detail d une formule adaptee fait son total', JSON.stringify(prix));
    const c2 = await memeEtat(page);
    v('D10', c2.meme, 'le verdict et le pied ont la meme couleur (formule adaptee)', JSON.stringify(c2));
    // 6 bis. Une formule un jour ordinaire : son programme (minigolf, boissons)
    // ne passe pas la ligne d etat en orange.
    const ordinaire = jourHorsVacances();
    await page.evaluate((jour) => { closeQuickBook(); openQuickBook({ date: jour, startTime: '15:00', type: 'formule', formuleId: 'f4', pax: 10 }); }, ordinaire);
    const poseOrdinaire = await planPose(page, true);
    await page.waitForTimeout(300);
    const c3 = await memeEtat(page);
    v('D10', poseOrdinaire && c3.meme, `le verdict et le pied ont la meme couleur (F4 un jour ordinaire, ${ordinaire})`, JSON.stringify(c3));
    // F4 se valide toujours (reglage du centre) : elle a un ecart de toute facon.
    // F3 n a pas d ecart : seul son programme existe en plus de ses activites.
    await page.evaluate((jour) => { closeQuickBook(); openQuickBook({ date: jour, startTime: '15:00', type: 'formule', formuleId: 'f3', pax: 10 }); }, ordinaire);
    const poseF3 = await planPose(page, true);
    await page.waitForTimeout(300);
    const montageF3 = await page.evaluate(() => {
      const plan = rvPlanCourant();
      const ids = rvActivites();
      return { ecarts: rvEcartsDuPlan(plan), programme: ((plan && plan.etapes) || []).filter((e) => !ids.includes(e.activite) && e.libelle && !/accueil/i.test(e.libelle)).map((e) => `${e.libelle} ${e.debut}`) };
    });
    const c4 = await memeEtat(page);
    v('D10', poseF3 && montageF3.ecarts.length === 0 && montageF3.programme.length > 0, `MONTAGE : F3 un jour ordinaire, sans ecart, avec un programme (${ordinaire})`, JSON.stringify(montageF3));
    v('D10', c4.meme && c4.verdict === 'ok', 'le programme d une formule se lit sans passer le verdict en orange au-dessus d un pied vert (F3)', JSON.stringify(c4));
    // 7. Ouvrir les Formules puis revenir (« ‹ Activités ») ne perd pas le laser compose.
    await page.evaluate((jour) => { closeQuickBook(); openQuickBook({ date: jour, startTime: '18:00', type: 'bowling', pax: 6 }); rvAppliquerComposition({ type: 'visite', program: [{ activityId: 'bowling', duration: 1 }, { activityId: 'laser_game', games: 1 }] }); }, JOUR);
    await page.waitForTimeout(300);
    await page.click('#quickBookOverlay #rsFormules');
    await page.waitForSelector('#quickBookOverlay .rs-fs-g', { timeout: 6000 });
    await page.waitForTimeout(300);
    await page.click('#quickBookOverlay #rsRetour');
    await page.waitForSelector('#quickBookOverlay #rsZ-bowling', { timeout: 6000 });
    await page.waitForTimeout(300);
    const compo = await page.evaluate(() => rvActivites());
    const lignesTicket = await page.evaluate(() => [...document.querySelectorAll('#quickBookOverlay #rsLignes .rs-tk-a')].map((b) => b.id.replace(/^rsL-/, '')));
    v('D10', compo.includes('laser_game') && compo.includes('bowling') && lignesTicket.includes('a-bowling') && lignesTicket.includes('a-laser_game') && !lignesTicket.includes('a-formule'), 'Formules puis retour : la composition reste (bowling et laser)', JSON.stringify({ compo, lignesTicket }));
    v('*', erreurs.length === 0, 'zero erreur JS ni console [D10]', erreurs.slice(0, 2).join(' | '));
  } finally { await context.close(); }
}

// ---------------------------------------------------------------------------
// LE PASSAGE ET LES CONTRE-PREUVES.
// ---------------------------------------------------------------------------
const SCENARIOS = {
  D1: async (browser, v, o) => { await scenarioD1Serveur(v); if (!o.serveurSeul) await scenarioD1(browser, v); },
  D2: async (browser, v) => { await scenarioD2(browser, v, { role: 'manager' }); await scenarioD2(browser, v, { role: 'staff-bar' }); },
  D3: (browser, v) => scenarioD3(browser, v),
  D4: (browser, v) => scenarioD4(browser, v),
  D5: (browser, v) => scenarioD5(browser, v),
  D6: (browser, v) => scenarioD6(browser, v),
  D7: (browser, v) => scenarioD7(browser, v),
  D8: (browser, v) => scenarioD8(browser, v),
  D9: (browser, v) => scenarioD9(browser, v),
  D10: (browser, v) => scenarioD10(browser, v),
};

// Les correctifs, retires un a un. `cote` : 'front' (fichier servi, la page
// le recoit mute) ou 'serveur' (compile en memoire par le banc) ; `edits` :
// les ancres (uniques, verifiees avant de jouer) et ce qui les remplace.
const APP = 'assets/app-main.js';
const CSS = 'assets/pinlane-staff.css';
const e = (fichier, de, vers) => ({ fichier, de, vers });
const MUTATIONS = [
  // D1
  { nom: 'telephone-exige', cote: 'serveur', vise: ['D1'], serveurSeul: true, edits: [e('lib/database.js', "{ required: channel === 'public', champ: 'téléphone' }", "{ required: true, champ: 'téléphone' }")] },
  // Le serveur exige le telephone a la creation (2026-11-11) : sans sa garde, le comptoir creerait sans.
  { nom: 'telephone-libre-au-serveur', cote: 'serveur', vise: ['D1'], serveurSeul: true, edits: [e('api/staff-reservations.js', "  if (require('../lib/telephone-du-client').telephoneValide(corps && corps.phone)) return;", '  return;')] },
  { nom: 'champ-sans-nom', cote: 'serveur', vise: ['D1'], serveurSeul: true, edits: [e('lib/database.js', '    const error = new Error(`Champ requis manquant : ${champ}.`);', "    const error = new Error('Champ requis manquant.');")] },
  { nom: 'refus-masque-en-ligne', cote: 'serveur', vise: ['D1'], serveurSeul: true, edits: [e('lib/database.js', '    error.statusCode = 422;\n    error.expose = true;\n    throw error;\n  }\n  return normalized;', '    error.expose = true;\n    throw error;\n  }\n  return normalized;')] },
  { nom: 'anonyme-client', cote: 'serveur', vise: ['D1'], serveurSeul: true, edits: [e('lib/donnees-clients.js', "  return String(nom || '').trim().toLowerCase() === NOM_ANONYME;", '  return false;')] },
  { nom: 'fiche-telephone-requis', cote: 'front', vise: ['D1'], edits: [e(APP, 'oninput="setEditField(\'phone\', this.value)" placeholder="Facultatif">', 'oninput="setEditField(\'phone\', this.value)" required>')] },
  { nom: 'crm-console-anonyme', cote: 'front', vise: ['D1'], edits: [e(APP, "  return nom && nom !== 'client' ? `name:${nom}` : '';", "  return `name:${nom || 'client'}`;")] },
  // D2 (la page « Autres » et la sortie d un refus partent du creneau en cours ;
  // les seances viennent des creneaux proposes, getQuickBookAvailableSlots)
  { nom: 'plancher-du-jour', cote: 'front', vise: ['D2'], edits: [
    e(APP, '  const debut = plancher !== null ? Math.max(schedule.open, plancher) : schedule.open;', '  const debut = schedule.open;'),
    e(APP, ' && r.heure !== s.startTime && !rvHeurePassee(s.date, r.heure))', ' && r.heure !== s.startTime)'),
    e(APP, '  if (plancher !== null) minTime = Math.max(minTime, plancher);', '  void plancher;'),
  ] },
  { nom: 'droit-passe-ignore', cote: 'front', vise: ['D2'], edits: [e(APP, '  if (!bornes || !rvPeutNoterLePasse()) return [];', '  if (!bornes) return [];')] },
  // D3
  { nom: 'raison-moteur-ignoree', cote: 'serveur', vise: ['D3'], edits: [e('lib/reservation-ops.js', "  const moteur = planResult.plan && typeof planResult.plan === 'object' ? [planResult.plan.reason, planResult.plan.warning] : [];", '  const moteur = [];')] },
  { nom: 'vacances-bloquees', cote: 'serveur', vise: ['D3'], edits: [e('lib/ops-engine.js', "  if (String(input.channel || '').toLowerCase() !== 'staff') return planFormulaSelonRegles(input, context);", '  if (true) return planFormulaSelonRegles(input, context);')] },
  { nom: 'avertissement-perdu', cote: 'serveur', vise: ['D3'], edits: [e('lib/reservation-ops.js', '!noSafePlan && planResult?.plan?.avertissementComptoir', 'false')] },
  // D4
  { nom: 'nom-reconnu-ajoute', cote: 'front', vise: ['D4'], edits: [e(APP, '  rvSelectionnerAuFocus(champ);\n}\n\n// LE PRIX DE REFERENCE', '  void champ;\n}\n\n// LE PRIX DE REFERENCE')] },
  // D5
  { nom: 'heure-vue-qui-bouge', cote: 'front', vise: ['D5'], edits: [e(APP, '  if (plan && plan.disponible) quickBookState.heureArretee = true;\n', '')] },
  { nom: 'cle-sans-journee', cote: 'front', vise: ['D5'], edits: [e(APP, "  return corps ? `${JSON.stringify(corps)}|${rvRevisionDuJour(corps.date)}` : '';", "  return corps ? JSON.stringify(corps) : '';")] },
  // D6 (chaque toucher ajoute, mais le bowling de depart n est qu une proposition : la
  // premiere autre activite le remplace, rsPrendre ; le laser a ses seances sur l ecran
  // d accueil, rsActivitesHtml)
  { nom: 'bowling-garde', cote: 'front', vise: ['D6'], edits: [e(APP, "  if (id !== 'bowling' && rvBowlingProposeIntact()) { rsRemplacer(id, variante); rsPoserJoueursDeclares(id); } else rsBasculer(id, variante);", '  rsBasculer(id, variante);')] },
  { nom: 'laser-hors-accueil', cote: 'front', vise: ['D6'], edits: [e(APP, '  const zones = getQuickBookActivityChoices().filter((c) => RV_ANCRABLES.includes(c.id)).map(', "  const zones = getQuickBookActivityChoices().filter((c) => c.id === 'bowling').map(")] },
  // D7
  { nom: 'auto-envoie-ses-pistes', cote: 'front', vise: ['D7'], edits: [
    e(APP, '  } else if (needsLanes && !s.autoAssign) {', '  } else if (needsLanes) {'),
    e(APP, '    lanes = [...s.lanes];\n    if (!forcer && !simulation) {', '    lanes = s.autoAssign ? (allocateLanes(requiredCount, s.date, s.startTime, duration) || []) : [...s.lanes];\n    if (!forcer && !simulation) {'),
  ] },
  { nom: 'nom-simulation', cote: 'front', vise: ['D7'], edits: [e(APP, "    name: simulation ? '' : (s.name.trim() || 'Client'),", "    name: simulation ? 'Simulation' : (s.name.trim() || 'Client'),")] },
  { nom: 'virtuel-sans-rang', cote: 'serveur', vise: ['D7'], edits: [e('lib/reserver-fenetre.js', 'nom ? `${nom} (même envoi)` : `la réservation ${Number(reservation.rang) || 1} de cet envoi`', "`${nom || 'un autre dossier'} (même envoi)`")] },
  // D8 (les fleches passent par rsTouche puis rsFleches ; apres un geste, le focus
  // reste sur la touche, rsPoserFocus)
  { nom: 'fleches-inertes', cote: 'front', vise: ['D8'], edits: [e(APP, "  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) { rsFleches(event); return; }", '')] },
  { nom: 'focus-heure', cote: 'front', vise: ['D8'], edits: [e(APP, "  if (overlay && actif && !cachee && actif !== document.body && actif !== overlay.querySelector('.qb-modal.rv') && overlay.contains(actif)) return;\n", '')] },
  // (la rangee des seances glisse pour garder l heure choisie en vue : le focus suit
  // l heure, pas la place, rvRepeindre)
  { nom: 'focus-garde-la-place', cote: 'front', vise: ['D8'], edits: [e(APP, '  } else if (actifHeure && cleHeure(actif) !== actifHeure) {', '  } else if (false) {')] },
  // D9 (la tablette range les joueurs sur deux rangees de 7 ; les jours se disent
  // courts ; le ticket a sa largeur ; au telephone, le pied a sa rangee a lui)
  { nom: 'tailles-masquees', cote: 'front', vise: ['D9'], edits: [e(CSS, '  .qb-modal.rv.rs .rs-ns { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; }', '  .qb-modal.rv.rs .rs-ns { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; }\n  .qb-modal.rv.rs .rs-ns .rs-n:nth-child(n+7) { display: none; }')] },
  { nom: 'jours-coupes', cote: 'front', vise: ['D9'], edits: [e(APP, "  const court = (iso) => { const t = rsDateLue(iso, { weekday: 'short', day: 'numeric' });", "  const court = (iso) => { const t = rsDateLue(iso, { weekday: 'long', day: 'numeric', month: 'long' });")] },
  { nom: 'billet-etroit', cote: 'front', vise: ['D9'], edits: [e(CSS, '  .qb-modal.rv.rs { --rs-gouttiere: 20px; --rs-ticket: 316px; }', '  .qb-modal.rv.rs { --rs-gouttiere: 20px; --rs-ticket: 180px; }')] },
  { nom: 'pied-par-dessus', cote: 'front', vise: ['D9'], edits: [e(CSS, '  .qb-modal.rv.rs .rs-tk-p { grid-row: 4; display: grid;', '  .qb-modal.rv.rs .rs-tk-p { grid-row: 2; align-self: end; z-index: 3; display: grid;')] },
  // D10
  { nom: 'accents-moteur', cote: 'serveur', vise: ['D10'], edits: [e('lib/ops-engine.js', 'message: `Pas assez de pistes libres à ${minutesToTime(start)}.`,', 'message: `Pas assez de pistes libres a ${minutesToTime(start)}.`,')] },
  { nom: 'laser-jargon', cote: 'serveur', vise: ['D10'], edits: [e('lib/ops-engine.js', '            ? `Laser à ${heureLaser} : ${places}, il en faut ${groupe}. Décalez le départ.`', '            ? `Laser charge a ${heureLaser}: ${players}/${weaponCount} joueurs et ${launchCount}/${parallelLaunches} lancement(s).`')] },
  // (le mot sous une seance, rsMotHeure : le creneau en cours, puis les pistes libres)
  { nom: 'arrivee-passee', cote: 'front', vise: ['D10'], edits: [e(APP, "  if (!x.tag && id === 'bowling' && timeToNum(x.heure) === rvPlancherDuJour(s.date)) x.tag = 'maintenant';\n", '')] },
  { nom: 'pistes-libres', cote: 'front', vise: ['D10'], edits: [e(APP, "  return place && !place.manque ? `reste ${rvPluriel(place.libre, place.unite)}` : '';", "  return place && !place.manque ? `reste ${rvPluriel(place.libre + place.prend, place.unite)}` : '';")] },
  // (les touches « Pistes » de la ligne du bowling, rsLigneBowlingHtml)
  { nom: 'conseil-ou-choix', cote: 'front', vise: ['D10'], edits: [e(APP, "n === auto ? 'conseillé' : n < auto ? 'à la main' : ''", "besoin === n ? 'conseillé' : n < auto ? 'à la main' : ''")] },
  { nom: 'avec-sans-nom', cote: 'front', vise: ['D10'], edits: [e(APP, "cles.push(rsPetite(rvPluriel(n, 'piste'), besoin === n,", 'cles.push(rsPetite(String(n), besoin === n,')] },
  // (un ecart se dit en orange sur la ligne d etat, rsVerdictHtml ; le pied n a plus
  // de bandeau : l ancienne « pied-sans-ecarts » n a plus de cible)
  { nom: 'ecart-dit-en-rouge', cote: 'front', vise: ['D3', 'D10'], edits: [e(APP, '      ecarts.forEach((ecart) => morceaux.push(`<p class="rs-v-ligne is-att">${escapeHtml(ecart)}</p>`));', '      ecarts.forEach((ecart) => morceaux.push(`<p class="rs-v-ligne is-ko">${escapeHtml(ecart)}</p>`));')] },
  // (chaque point a savoir se dit : le premier seul cachait la raison des vacances)
  { nom: 'premier-ecart-seul', cote: 'front', vise: ['D3'], edits: [e(APP, '      ecarts.forEach((ecart) => morceaux.push(', '      ecarts.slice(0, 1).forEach((ecart) => morceaux.push(')] },
  { nom: 'programme-en-ecart', cote: 'front', vise: ['D10'], edits: [e(APP, '  if (plan.avertissement) ecarts.push(plan.avertissement);\n  (plan.aSurveiller', "  if (plan.avertissement) ecarts.push(plan.avertissement);\n  (plan.etapes || []).filter((x) => !rvActivites().includes(x.activite) && x.libelle && !/accueil/i.test(x.libelle)).forEach((x) => ecarts.push(`Aussi au programme : ${x.libelle} à ${x.debut}`));\n  (plan.aSurveiller")] },
  // (le recu de la page Total, rsRecuHtml)
  { nom: 'detail-a-la-carte', cote: 'front', vise: ['D10'], edits: [e(APP, "  if (f) {\n    const quantite = f.type === 'per_lane'", "  if (f && !s.adaptee) {\n    const quantite = f.type === 'per_lane'")] },
  { nom: 'main-pour-toutes', cote: 'front', vise: ['D10'], edits: [e(APP, "        : aLaMain.length >= pistes.length ? (pistes.length > 1 ? ', choisies à la main' : ', choisie à la main')", "        : true ? (pistes.length > 1 ? ', choisies à la main' : ', choisie à la main')")] },
  // (la porte Formules ne fait qu ouvrir la page : seule une formule touchee change la
  // composition, rsFormule)
  { nom: 'formule-efface', cote: 'front', vise: ['D10'], edits: [e(APP, 'id="rsFormules" onclick="rsOuvrir(\'formules\')"', 'id="rsFormules" onclick="rvModeFormule(); rsOuvrir(\'formules\')"')] },
];

// Une ancre absente ou double desarmerait la contre-preuve en silence : on la
// compte sur le disque (fins de ligne ramenees a LF) avant de jouer.
function ancresDe(m) {
  return m.edits.map((x) => {
    const texte = fs.readFileSync(path.join(ROOT, x.fichier), 'utf8').split(CRLF).join(LF);
    return { fichier: x.fichier, n: texte.split(x.de).length - 1 };
  }).filter((a) => a.n !== 1);
}

async function passe(browser, lettres, { bavard = true, mutation = null } = {}) {
  const echecs = new Set();
  const v = (lettre, cond, label, detail = '') => {
    if (bavard || !cond) console.log(`${cond ? 'ok  ' : 'FAIL'}  [${lettre}] ${label}${detail ? `  ->  ${detail}` : ''}`);
    if (!cond) echecs.add(lettre);
  };
  mutationsServeur = mutation && mutation.cote === 'serveur' ? mutation.edits : [];
  mutationFront = mutation && mutation.cote === 'front' ? mutation.edits : null;
  try {
    for (const l of lettres) {
      if (bavard) console.log(`\n[${l}]`);
      try { await SCENARIOS[l](browser, v, { serveurSeul: Boolean(mutation && mutation.serveurSeul) }); } catch (err) { v(l, false, `le scenario ${l} va au bout`, String(err.stack || err.message || err).split(LF).slice(0, 2).join(' / ')); }
    }
  } finally {
    mutationFront = null;
    mutationsServeur = [];
  }
  return echecs;
}

async function main() {
  const arg = process.argv.find((a) => a.startsWith('--contre-preuves'));
  const seules = (process.argv.find((a) => a.startsWith('--lettres=')) || '').split('=')[1];
  if (process.argv.includes('--ancres')) {
    const fausses = MUTATIONS.map((m) => ({ nom: m.nom, fausses: ancresDe(m) })).filter((x) => x.fausses.length);
    fausses.forEach((x) => console.log(`FAIL  ${x.nom} : ${JSON.stringify(x.fausses)}`));
    console.log(fausses.length ? `\n${fausses.length} contre-preuve(s) desarmee(s)` : `\n${MUTATIONS.length}/${MUTATIONS.length} ancres uniques`);
    process.exit(fausses.length ? 1 : 0);
  }
  const serveur = await demarrerServeur();
  monter({ role: 'manager' });
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const argCaptures = process.argv.find((a) => a.startsWith('--captures='));
  let rouge = false;
  try {
    if (argCaptures) {
      // D1, D2, D3 et D6 rejoues a trois tailles, en clair et en sombre : les
      // verdicts comptent aussi, le parcours doit tenir a chaque taille.
      dossierCaptures = path.resolve(argCaptures.split('=')[1]);
      const VUES = [
        { nom: '1280x800', viewport: { width: 1280, height: 800 } },
        { nom: '1024x768', viewport: { width: 1024, height: 768 } },
        { nom: '390x844', viewport: { width: 390, height: 844 }, toucher: true },
      ];
      const echecs = [];
      for (const theme of ['light', 'dark']) {
        for (const x of VUES) {
          vue = { ...x, theme };
          console.log(`\n== ${x.nom} ${theme}`);
          const ko = await passe(browser, ['D1', 'D2', 'D3', 'D6'], { bavard: false });
          ko.forEach((l) => echecs.push(`${l} ${x.nom} ${theme}`));
        }
      }
      vue = null;
      rouge = echecs.length > 0;
      console.log(rouge ? `\nreserver-comptoir-check --captures : ${echecs.join(', ')} en echec` : `\nreserver-comptoir-check --captures: D1, D2, D3, D6 tiennent a 3 tailles, clair et sombre (${dossierCaptures})`);
    } else if (!arg) {
      const lettres = seules ? seules.split(',') : Object.keys(SCENARIOS);
      const echecs = await passe(browser, lettres);
      rouge = echecs.size > 0;
      console.log(rouge ? `\nreserver-comptoir-check : ${[...echecs].join(', ')} en echec` : '\nreserver-comptoir-check: ALL OK, le comptoir cree juste, du premier coup.');
    } else {
      const choix = arg.includes('=') ? arg.split('=')[1].split(',') : MUTATIONS.map((m) => m.nom);
      const manquees = [];
      for (const nom of choix) {
        const m = MUTATIONS.find((x) => x.nom === nom);
        if (!m) { manquees.push(`${nom} (inconnue)`); continue; }
        const fausses = ancresDe(m);
        if (fausses.length) { manquees.push(`${nom} (ancre ${fausses.map((a) => `${a.fichier} x${a.n}`).join(', ')})`); console.log(`FAIL  la contre-preuve « ${nom} » est desarmee : ${JSON.stringify(fausses)}`); continue; }
        console.log(`\n-- contre-preuve « ${nom} » (${m.cote}) : doit rougir sur ${m.vise.join(', ')}`);
        const echecs = await passe(browser, m.vise, { bavard: false, mutation: m });
        const mord = m.vise.every((l) => echecs.has(l));
        console.log(`${mord ? 'ok  ' : 'FAIL'}  la contre-preuve « ${nom} » fait rougir ${m.vise.join(', ')}`);
        if (!mord) manquees.push(nom);
      }
      if (desarmees.length) manquees.push(...desarmees.map((d) => `desarmee : ${d}`));
      rouge = manquees.length > 0;
      console.log(rouge ? `\nreserver-comptoir-check --contre-preuves : ${manquees.join(' ; ')}` : `\nreserver-comptoir-check --contre-preuves: ${choix.length}/${choix.length} mordent`);
    }
  } finally {
    await browser.close();
    serveur.close();
  }
  process.exit(rouge ? 1 : 0);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

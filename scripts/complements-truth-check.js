// LA MONTEE DE FORMULE : CE QUI EST PROPOSE EST TENABLE, ET CE QUI EST ANNONCE
// EST CE QUI SERA FACTURE.
//
// POURQUOI CE GATE EXISTE. Movsar, 2026-09-03 : « a la fin du formulaire, un peu
// comme un McDo, on propose autre chose : pour seulement 5 EUR de plus, vous
// avez du mini golf, une partie en plus, ou 30 minutes de bowling. Des trucs
// logiques, des prix logiques. » Ce que le lot livre est la MONTEE DE FORMULE :
// sur le dernier ecran avant confirmation, les formules du catalogue de CE
// centre qui contiennent tout ce que le client a deja, plus quelque chose.
//
// C est le seul endroit du produit ou un MONTANT est PROMIS avant d etre
// applique, sur l ecran ou le client dit oui. Trois relectures adverses ont
// trouve, dans la premiere version du lot, des defauts reels et mesures : une
// carte qui vendait « 5 min de Boissons » (un temps de service d equipe) a
// 80 EUR, une proposition INVISIBLE sur le chemin par defaut (le client qui ne
// touche a rien), une garde de dotation qui refusait des visites realisables,
// et un montant annonce que rien ne confrontait au prix du serveur.
//
// LES SEPT PROPRIETES VERROUILLEES ICI, chacune parce qu elle peut se re-casser
// en silence :
//
//   [A] LE MONTANT ANNONCE EST LE MONTANT REEL. L ecart entre le total AVANT et
//       le total APRES acceptation, lu sur #recapTotal dans un vrai navigateur,
//       egale au centime le montant que la carte a annonce. La valeur attendue
//       est RECALCULEE en Node depuis getBasePrice : elle n est jamais recopiee
//       du produit, et jamais lue dans le texte de la carte.
//
//   [B] LE MONTANT FACTURE NE DEPASSE JAMAIS LE MONTANT ANNONCE. Ecrit en
//       INEGALITE, jamais en egalite : le delta se calcule sans startTime, la
//       facture avec, et un palier horaire ne peut que faire BAISSER le prix
//       (assertPricingUnderBase interdit qu un palier depasse le prix de base).
//       Une egalite stricte rougirait le jour ou le produit se comporterait
//       exactement comme prevu. La facture est le prix du dossier REELLEMENT
//       cree par le POST public, pas un chiffre d ecran.
//
//   [C] TOUTE CARTE AFFICHEE EST TENABLE, ET UNE CARTE MORTE NE CASSE RIEN. Une
//       carte n existe que si la visite ENTIERE passe la porte de la validation
//       aux heures retenues : on l accepte, on confirme, et le dossier part en
//       201. Et si l option meurt entre l affichage et le clic (le centre bloque
//       la formule pendant que le client lit), le dossier reste IDENTIQUE champ
//       par champ et le client lit une raison courte.
//
//   [D] SEUL L ECART POSITIF SE MONTRE, ET IL APPARTIENT A CE CENTRE. Temoin
//       negatif : ffm, dont la seule candidate couvrante (f1) est MOINS chere,
//       ne rend aucune carte. Temoin de portee : le montant suit le prix du
//       CENTRE demande, pas le socle, et un centre inconnu de la fiche des
//       centres ne rend rien.
//
//   [E] ACCEPTER NE DEPLACE RIEN D AUTRE. Meme date, memes pistes, memes heures
//       d ancres ; le dossier reste de type formule avec son formuleId et ne
//       porte aucun program. Et ne rien cliquer ne change rien, champ par champ.
//
//   [F] LA GARDE DE DOTATION EST JOIGNABLE SUR TOUTE VISITE. Montage asserte :
//       la dotation est reellement saturee. Puis une visite « bowling + duckpin »
//       est refusee quand les pistes sont prises pendant toute la visite, et une
//       activite sans dotation reste acceptee.
//
//   [G] LE DERNIER ECRAN RESTE UTILISABLE. Cartes affichees, bouton de
//       confirmation entierement visible ET tapable (hit-test reel) en 390x844
//       et 1440x900, deux themes ; aucune cible sous 44 px, aucun texte sous
//       11,5 px, chaque bouton porte un nom accessible ; le bloc vit dans
//       #recapList et jamais dans .recap-decision (c est ce qui l empeche
//       physiquement de pousser « Confirmer la reservation » hors de l ecran).
//
// IL VERIFIE DES COMPORTEMENTS, JAMAIS DES PRESENCES. Aucune assertion ne dit
// « la chaine X est dans le HTML » : chaque propriete est mesuree sur ce que
// l ECRAN rend et sur ce que le SERVEUR fait, apres un vrai parcours du tunnel.
//
// LE MONTAGE EST ASSERTE AVANT LA PROPRIETE. Un gate qui n a pas monte la
// situation qu il pretend tester est vert pour rien : chaque propriete commence
// par prouver que la carte est bien la, chiffree, et que son bouton passe un
// hit-test reel.
//
// CONTRE-EPREUVE PAR MUTATION SERVIE EN MEMOIRE. Rien n est jamais ecrit sur le
// disque : les fichiers CLIENT sont servis mutes par le serveur du gate, les
// modules SERVEUR sont compiles mutes par un crochet sur Module.prototype._compile
// puis re-requis. Chaque mutation doit faire tomber LA propriete visee, pas
// seulement le montage.
//
// Usage : node scripts/complements-truth-check.js
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_COMPLEMENTS_PORT || 4645);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
const LF = String.fromCharCode(10);

let failures = 0;
function ok(cond, label, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures += 1;
  return cond;
}

// ---------------------------------------------------------------------------
// LA DONNEE DU JOUR. Un samedi STRICTEMENT futur (le tunnel masque les creneaux
// deja passes de la journee en cours) et un vendredi pour le temoin negatif :
// ffm ne se vend que ce jour-la.
// ---------------------------------------------------------------------------
function prochainJour(dow) {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date()).split('-').map(Number);
  const c = new Date(Date.UTC(y, m - 1, d));
  do { c.setUTCDate(c.getUTCDate() + 1); } while (c.getUTCDay() !== dow);
  return c.toISOString().slice(0, 10);
}
const DATE = prochainJour(6);
const VENDREDI = prochainJour(5);
const CENTRE = 'libramont';
const PAX = 8;
// La formule COURANTE du parcours et la montee qu on attend. Elles ne portent
// aucun montant : les prix sont relus du catalogue effectif du centre.
const FORMULE_COURANTE = 'f5';

// ---------------------------------------------------------------------------
// LA BASE EST REMPLACEE PAR UNE LISTE EN MEMOIRE, mais les HANDLERS sont les
// vrais : c est le chemin de decision qu on mesure, pas le stockage. Le .env du
// depot porte la production : aucun acces n est laisse ouvert.
// ---------------------------------------------------------------------------
function mock(rel, exports) {
  const resolu = require.resolve(path.join(ROOT, rel));
  require.cache[resolu] = { id: resolu, filename: resolu, loaded: true, exports };
}
mock('lib/rate-limit', {
  enforceRateLimit: () => false,
  checkRateLimit: () => ({ allowed: true, remaining: 999, retryAfterSeconds: 0 }),
  getClientIp: () => 'gate',
});

const database = require(path.join(ROOT, 'lib/database'));
const RESERVATIONS = [];
const BLOCAGES = [];
const POSTS = [];
let nextId = 1;
database.readAvailabilitySnapshot = async (date, centerId = CENTRE) => ({
  date,
  centerId,
  laneStatuses: {},
  blocks: BLOCAGES.filter((b) => b.centerId === centerId),
  reservations: RESERVATIONS.filter((r) => r.date === date && (r.centerId || CENTRE) === centerId),
});
database.readStaffState = database.readAvailabilitySnapshot;
database.createOpsEvent = async () => ({});
// Meme passage qu en production : createReservation normalise avant d ecrire, et
// la liste blanche de normalizeReservationProgram ne conserve pas laneCount.
// Ranger le payload brut mesurerait une forme que la base ne produit jamais.
database.createReservation = async (payload) => {
  const range = database.normalizeReservationPayload({ ...payload }, {});
  const row = { ...range, id: nextId += 1, date: payload.date, centerId: payload.centerId, status: range.status || 'pending' };
  RESERVATIONS.push(row);
  return row;
};

const {
  BOWLING_PRICES,
  DURATION_OPTIONS,
  LASER_GAME_OPTIONS,
  getBasePrice,
  getEffectiveFormules,
  getFormuleLaneDuration,
  getRequiredLaneCount,
  getSchedule,
  resolveBowlingCapacity,
  setFormuleOverrides,
} = require(path.join(ROOT, 'lib/booking-config'));
const { getCenter } = require(path.join(ROOT, 'lib/ops-knowledge'));
const { listSellableActivities } = require(path.join(ROOT, 'lib/activity-catalog'));

// LE PRIX ATTENDU, RECALCULE ICI. Meme arithmetique que la disponibilite
// (getBasePrice, duree de piste de la formule, pistes requises), jamais un
// nombre recopie du produit ni du catalogue.
function prixServeur(formuleId, pax, centerId = CENTRE) {
  const formule = getEffectiveFormules(centerId).find((f) => f.id === formuleId) || null;
  if (!formule) return null;
  return getBasePrice(
    'formule',
    getFormuleLaneDuration(formule),
    getRequiredLaneCount('formule', pax, formuleId, null),
    pax,
    formuleId,
    centerId,
    { bowlingConfig: null, dateStr: DATE },
  );
}
// Ce que la facture arrondit, des DEUX cotes (lib/reservation-request
// estimatePublicPrice : Math.max(0, Math.round(base))).
const facture = (v) => Math.max(0, Math.round(Number(v) || 0));

// ---------------------------------------------------------------------------
// LES MODULES SERVEUR MUTABLES. Un crochet sur Module.prototype._compile sert
// une copie mutee au moment du require ; on jette alors le cache des seuls
// modules cibles et on les re-requiert. Le disque n est jamais touche, donc
// aucune restauration ne peut etre oubliee apres un echec.
// ---------------------------------------------------------------------------
const MODULES_MUTABLES = ['lib/booking-complements.js', 'api/public-availability.js', 'lib/reservation-ops.js', 'api/public-reservations.js'];
let mutationsServeur = [];
const compileOrigine = Module.prototype._compile;
Module.prototype._compile = function (contenu, nom) {
  const rel = path.relative(ROOT, nom).split(path.sep).join('/');
  const editions = mutationsServeur.filter((e) => e.fichier === rel);
  if (!editions.length) return compileOrigine.call(this, contenu, nom);
  let mute = contenu.split(CRLF).join(LF);
  for (const { de, vers } of editions) {
    if (mute.split(de).length - 1 !== 1) {
      throw new Error(`ancre absente ou multiple dans ${rel} : ${de.slice(0, 70)}`);
    }
    mute = mute.split(de).join(vers);
  }
  return compileOrigine.call(this, mute, nom);
};

let availabilityHandler = null;
let reservationsHandler = null;
function rechargerApi() {
  for (const rel of MODULES_MUTABLES) delete require.cache[require.resolve(path.join(ROOT, rel))];
  const rops = require(path.join(ROOT, 'lib/reservation-ops'));
  // Les hooks post-creation (emails, jobs) ne sont pas le sujet et parlent au
  // reseau : ils sont neutralises a CHAQUE rechargement, sinon le module frais
  // repartirait avec les vrais.
  rops.afterReservationCreated = async () => ({ communications: [], warnings: [] });
  availabilityHandler = require(path.join(ROOT, 'api/public-availability.js'));
  reservationsHandler = require(path.join(ROOT, 'api/public-reservations.js'));
}
rechargerApi();

async function avecMutationsServeur(editions, fn) {
  mutationsServeur = editions;
  rechargerApi();
  try {
    return await fn();
  } finally {
    mutationsServeur = [];
    rechargerApi();
  }
}

// ---------------------------------------------------------------------------
// LES FICHIERS CLIENT SONT SERVIS, donc mutables par le serveur du gate.
// ---------------------------------------------------------------------------
const overrides = new Map();
function sourceDisque(fichier) {
  return fs.readFileSync(path.join(ROOT, fichier), 'utf8').split(CRLF).join(LF);
}
async function avecMutationsClient(editions, fn) {
  const avant = new Map();
  editions.forEach(({ fichier }) => {
    if (!avant.has(fichier)) avant.set(fichier, overrides.has(fichier) ? overrides.get(fichier) : null);
  });
  editions.forEach(({ fichier, de, vers }) => {
    const source = overrides.has(fichier) ? overrides.get(fichier) : sourceDisque(fichier);
    if (source.split(de).length - 1 !== 1) {
      throw new Error(`ancre absente ou multiple dans ${fichier} : ${de.slice(0, 70)}`);
    }
    overrides.set(fichier, source.split(de).join(vers));
  });
  try {
    return await fn();
  } finally {
    avant.forEach((valeur, fichier) => {
      if (valeur === null) overrides.delete(fichier); else overrides.set(fichier, valeur);
    });
  }
}

// ---------------------------------------------------------------------------
// LE CATALOGUE SERVI AU TUNNEL. Compose ICI depuis les memes bibliotheques que
// api/public-booking-meta (getEffectiveFormules, DURATION_OPTIONS, la fiche du
// centre) : aucun prix, aucun horaire, aucun libelle n est recopie dans ce
// gate, donc rien ne peut deriver du produit.
// ---------------------------------------------------------------------------
function metaPayload() {
  const centre = getCenter(CENTRE);
  const capacite = resolveBowlingCapacity(CENTRE);
  const horaire = getSchedule(DATE) || { open: 10, close: 24, label: '' };
  return {
    ok: true,
    today: DATE,
    bookingHorizonDays: 365,
    durationOptions: DURATION_OPTIONS,
    formules: getEffectiveFormules(CENTRE),
    laserOptions: LASER_GAME_OPTIONS,
    bowlingPrices: BOWLING_PRICES,
    activities: listSellableActivities({ centerId: CENTRE, availability: centre.activityAvailability || null }),
    center: {
      id: centre.id,
      name: centre.name || '',
      city: '',
      identity: centre.identity || null,
      status: centre.status || 'active',
      branding: centre.branding || null,
      defaultSchedule: centre.defaultSchedule || null,
      holidaySettings: centre.holidaySettings || { enabled: true, overrides: [], formulaBlockedPeriods: [] },
      offerAvailability: centre.offerAvailability || {},
      activityAvailability: centre.activityAvailability || null,
      booking: {
        laneCount: capacite.laneCount,
        normalCapacityPerLane: capacite.normalCapacityPerLane,
        emergencyCapacityPerLane: capacite.emergencyCapacityPerLane,
        bowlingPrices: BOWLING_PRICES,
        laserOptions: LASER_GAME_OPTIONS,
      },
      day: {
        date: DATE,
        open: true,
        schedule: horaire,
        closedLabel: '',
        closedWindows: [],
        unavailableFormulaIds: [],
        unavailableActivityIds: [],
        unavailableFormulaReason: {},
      },
    },
  };
}

function serveur() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, BASE_URL);
    if (url.pathname === '/api/public-booking-meta') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(metaPayload()));
      return;
    }
    if (url.pathname === '/api/public-availability') {
      try { await availabilityHandler(req, res); } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: String((error && error.message) || error) }));
      }
      return;
    }
    if (url.pathname === '/api/public-reservations') {
      // Le corps est relu pour la trace ET re-injecte : le handler consomme le
      // flux, on ne peut pas le lire deux fois.
      let brut = '';
      req.on('data', (c) => { brut += c; });
      await new Promise((resolve) => req.on('end', resolve));
      let corps = null;
      try { corps = JSON.parse(brut); } catch (error) { corps = { brut: brut.slice(0, 200) }; }
      const faux = Object.assign(require('stream').Readable.from([brut]), {
        method: req.method, url: req.url, headers: req.headers, socket: req.socket, connection: req.connection,
      });
      const ecrit = res.end.bind(res);
      let reponse = '';
      res.end = (chunk, ...reste) => { if (chunk) reponse += chunk; return ecrit(chunk, ...reste); };
      try { await reservationsHandler(faux, res); } catch (error) {
        if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json' }); }
        ecrit(JSON.stringify({ ok: false, message: String((error && error.message) || error) }));
      }
      let rendu = null;
      try { rendu = JSON.parse(reponse); } catch (error) { rendu = null; }
      POSTS.push({ corps, statut: res.statusCode, reponse: rendu });
      return;
    }
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (overrides.has(rel)) {
      res.writeHead(200, { 'Content-Type': MIME[path.extname(rel).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(overrides.get(rel));
      return;
    }
    let filePath = path.join(ROOT, rel);
    if (url.pathname === '/' || url.pathname === '') filePath = path.join(ROOT, 'index.html');
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(content);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

// Requete HTTP simple, pour les proprietes qui se mesurent sans navigateur.
function getJson(params) {
  const url = `${BASE_URL}/api/public-availability?${new URLSearchParams(params).toString()}`;
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve({ statut: res.statusCode, corps: JSON.parse(body) }); } catch (e) { resolve({ statut: res.statusCode, corps: {} }); } });
    }).on('error', reject);
  });
}
function postJson(payload) {
  const data = Buffer.from(JSON.stringify(payload));
  return new Promise((resolve, reject) => {
    const req = http.request(`${BASE_URL}/api/public-reservations`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'content-length': data.length },
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve({ statut: res.statusCode, corps: JSON.parse(body) }); } catch (e) { resolve({ statut: res.statusCode, corps: {} }); } });
    });
    req.on('error', reject);
    req.end(data);
  });
}

// ---------------------------------------------------------------------------
// LE PARCOURS. Un contexte NEUF par scenario : un contexte partage transmet le
// localStorage d une page a l autre, et le scenario suivant heriterait de
// l etat du precedent. Ce piege a deja coute un gate dans ce depot.
// ---------------------------------------------------------------------------
let enMutation = false;
async function pageNeuve(browser, viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.on('pageerror', (e) => {
    if (enMutation) { console.log(`      (mutation) erreur JS attendue : ${e.message}`); return; }
    console.log(`FAIL  erreur JS dans la page : ${e.message}`);
    failures += 1;
  });
  return { page, fermer: () => context.close() };
}

// Ce que l ecran rend du bloc de montees : cartes visibles, montant, bouton et
// son hit-test REEL (elementFromPoint au centre de la cible).
const LIRE_BLOC = () => {
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const nombres = (t) => (String(t || '').match(/\d+(?:[.,]\d+)?/g) || []).map((n) => Number(n.replace(',', '.')));
  const bloc = document.getElementById('recapComplements');
  const total = document.getElementById('recapTotal');
  const totalTexte = total ? (total.textContent || '').trim() : '';
  const cartes = bloc ? [...bloc.querySelectorAll('.complement-card')].filter(visible).map((carte) => {
    const bouton = carte.querySelector('.complement-add');
    const r = bouton ? bouton.getBoundingClientRect() : null;
    const cx = r ? Math.round(r.left + r.width / 2) : 0;
    const cy = r ? Math.round(r.top + r.height / 2) : 0;
    const touche = r ? document.elementFromPoint(cx, cy) : null;
    return {
      id: bouton ? bouton.dataset.complement : '',
      nom: (carte.querySelector('.complement-name') || {}).textContent || '',
      ajouts: (carte.querySelector('.complement-adds') || {}).textContent || '',
      duree: (carte.querySelector('.complement-total') || {}).textContent || '',
      montantTexte: ((carte.querySelector('.complement-amount') || {}).textContent || '').trim(),
      ariaBouton: bouton ? (bouton.getAttribute('aria-label') || '') : '',
      hauteurBouton: r ? Math.round(r.height) : 0,
      hitTest: Boolean(bouton && touche && (touche === bouton || bouton.contains(touche))),
      centre: [cx, cy],
    };
  }) : [];
  const zone = document.getElementById('complementStatus');
  return {
    blocPresent: Boolean(bloc && visible(bloc)),
    dansRecapList: Boolean(bloc && bloc.closest('#recapList')),
    dansDecision: Boolean(bloc && bloc.closest('.recap-decision')),
    cartes,
    // Le module vit en portee de script : on lit la donnee SERVEUR, pas le texte.
    payload: (typeof formulaComplements !== 'undefined' && Array.isArray(formulaComplements))
      ? formulaComplements.map((c) => ({ formuleId: c.formuleId, deltaTotal: c.deltaTotal, deltaPerPax: c.deltaPerPax, amountLabel: c.amountLabel, addsLabel: c.addsLabel, totalLabel: c.totalLabel || '' }))
      : [],
    totalTexte,
    total: nombres(totalTexte.replace(/[\u202F\u00A0]/g, ''))[0] ?? null,
    statut: zone ? (zone.textContent || '').trim() : null,
    statutTon: zone ? (zone.dataset.tone || '') : '',
    dossier: {
      formuleId: state.booking.formuleId,
      type: state.booking.type,
      date: state.booking.date,
      pax: state.booking.pax,
      startTime: state.booking.startTime,
      lanes: JSON.stringify(state.booking.allocatedLanes || []),
      laneCount: state.booking.laneCount,
      duration: state.booking.duration,
      totalDuration: state.booking.totalDuration,
      ancres: JSON.stringify((state.booking.opsPlan && state.booking.opsPlan.anchorPlan && state.booking.opsPlan.anchorPlan.times) || {}),
      program: state.booking.program ? 'present' : 'absent',
      serverProgram: state.booking.serverProgram ? 'present' : 'absent',
    },
    focus: document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : '',
  };
};

async function allerAuRecap(page, { formuleId = FORMULE_COURANTE, pax = PAX, date = DATE, theme = 'light', viewport } = {}) {
  if (viewport) await page.setViewportSize(viewport);
  await page.goto(`${BASE_URL}/?v=complements-${Date.now()}-${Math.random().toString(16).slice(2)}`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForFunction(() => typeof window.setView === 'function' && typeof window.goStep === 'function', null, { timeout: 20000 });
  await page.evaluate((t) => { document.documentElement.setAttribute('data-theme', t); }, theme);
  await page.evaluate(({ d, id, p }) => {
    state.view = 'client';
    state.booking.date = d;
    state.booking.pax = p;
    state.booking.venueConfirmed = true;
    setView('client');
    setType('formule');
    selectFormule(id);
    syncBookingTypeUi();
    goStep(1, { animate: false, focus: false });
  }, { d: date, id: formuleId, p: pax });
  await page.waitForTimeout(300);
  await page.evaluate(() => goStep2());
  await page.waitForTimeout(1200);
  const surOptions = await page.evaluate(() => Number(state.step) === 1);
  if (surOptions) {
    await page.evaluate(() => goStep2());
    await page.waitForTimeout(1200);
  }
  await page.waitForFunction(() => Array.isArray(state.availableSlots) && state.availableSlots.length > 0, null, { timeout: 20000 });
  await page.evaluate(() => { const i = getCurrentFormulaAnchorSlotIndex(); if (i >= 0) selectSlot(i); });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    document.getElementById('fName').value = 'Marie Dupont';
    document.getElementById('fPhone').value = '+32 470 00 00 00';
    document.getElementById('fEmail').value = 'marie@exemple.be';
    goStep4();
  });
  await page.waitForTimeout(700);
  await poser(page);
  return page.evaluate(LIRE_BLOC);
}

// LE BLOC EST EN FIN DE #recapList, LA COLONNE QUI DEFILE : mesurer son bouton
// sans l amener a vue rendrait un rectangle mis en page mais CLIPPE par le
// scrolleur, et le hit-test taperait ce qui est peint a cette place (mesure :
// « total-box »). Le client, lui, fait defiler. On fait donc ce que fait le
// client, PUIS on mesure. Et on attend la fin des animations : une carte
// mesuree en cours d entree rend 43,1 px pour un bouton de 44.
async function poser(page) {
  await page.evaluate(() => {
    const bloc = document.getElementById('recapComplements');
    if (bloc && typeof bloc.scrollIntoView === 'function') bloc.scrollIntoView({ block: 'center' });
  });
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
  await page.waitForTimeout(120);
}

// Le clic REEL, a la souris, sur le centre du bouton : pas un appel de fonction.
async function cliquerAjouter(page, carte) {
  await page.evaluate((id) => {
    const b = document.querySelector(`#recapComplements .complement-add[data-complement="${id}"]`);
    if (b) b.focus();
  }, carte.id);
  await page.mouse.click(carte.centre[0], carte.centre[1]);
  await page.waitForFunction(() => {
    const zone = document.getElementById('complementStatus');
    return Boolean(zone && (zone.textContent || '').trim() && (zone.dataset.tone || '') !== 'busy');
  }, null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(400);
  await poser(page);
  return page.evaluate(LIRE_BLOC);
}

async function confirmer(page) {
  await page.evaluate(async () => { await confirmBooking(); });
  await page.waitForTimeout(900);
}

// ---------------------------------------------------------------------------
// [A] [B] [C1] [E] : un seul parcours qui accepte et confirme, un second qui ne
// clique rien. Les deux se comparent champ par champ.
// ---------------------------------------------------------------------------
async function mesurerParcours(browser, { accepter }) {
  RESERVATIONS.length = 0;
  BLOCAGES.length = 0;
  POSTS.length = 0;
  const { page, fermer } = await pageNeuve(browser);
  try {
    const avant = await allerAuRecap(page);
    let apres = avant;
    if (accepter && avant.cartes.length) apres = await cliquerAjouter(page, avant.cartes[0]);
    await confirmer(page);
    return { avant, apres, post: POSTS[POSTS.length - 1] || null, posts: POSTS.length };
  } finally {
    await fermer();
  }
}

function jugerAB(m) {
  const v = [];
  const prixCourant = prixServeur(FORMULE_COURANTE, PAX);
  const carte = m.avant.cartes[0] || null;
  const paye = m.avant.payload[0] || null;

  // MONTAGE : sans carte chiffree et tapable, tout ce qui suit serait vert pour rien.
  v.push({ ok: m.avant.blocPresent && m.avant.cartes.length >= 1, label: '[montage] le recapitulatif rend au moins une carte de montee', detail: `${m.avant.cartes.length} carte(s)` });
  v.push({ ok: Boolean(carte && carte.hitTest && carte.hauteurBouton >= 44), label: '[montage] le bouton Ajouter passe un hit-test reel et fait au moins 44 px', detail: carte ? `hit=${carte.hitTest} h=${carte.hauteurBouton}` : 'aucune carte' });
  v.push({ ok: Boolean(paye && Number(paye.deltaTotal) > 0 && /\d/.test(carte ? carte.montantTexte : '')), label: '[montage] la carte est CHIFFREE (montant serveur > 0, montant a l ecran)', detail: paye ? `${paye.deltaTotal} / ${carte && carte.montantTexte}` : 'aucun payload' });
  v.push({ ok: m.avant.total === prixCourant, label: '[montage] le total affiche AVANT est bien le prix serveur de la formule courante', detail: `ecran=${m.avant.total} node=${prixCourant}` });

  if (!carte || !paye) return v;
  const prixMonte = prixServeur(paye.formuleId, PAX);
  const attendu = facture(prixMonte) - facture(prixCourant);

  // [A] LE MONTANT ANNONCE EST LE MONTANT REEL.
  v.push({
    ok: Number(paye.deltaTotal) === attendu,
    label: '[A] LE MONTANT ANNONCE EST LE MONTANT REEL : la carte annonce exactement l ecart des deux prix serveur',
    detail: `annonce=${paye.deltaTotal} attendu=${attendu} (${prixCourant} -> ${prixMonte})`,
  });
  const ecartEcran = m.apres.total !== null && m.avant.total !== null ? Math.round((m.apres.total - m.avant.total) * 100) / 100 : null;
  v.push({
    ok: ecartEcran === attendu,
    label: '[A] LE MONTANT ANNONCE EST LE MONTANT REEL : le total de l ecran bouge exactement de ce montant',
    detail: `#recapTotal ${m.avant.total} -> ${m.apres.total} (ecart ${ecartEcran}, attendu ${attendu})`,
  });

  // [B] LE MONTANT FACTURE NE DEPASSE JAMAIS LE MONTANT ANNONCE (inegalite).
  const dossier = m.post && m.post.reponse && m.post.reponse.reservation ? m.post.reponse.reservation : null;
  v.push({ ok: Boolean(dossier), label: '[montage] la confirmation a bien cree un dossier', detail: m.post ? `HTTP ${m.post.statut}` : 'aucun POST' });
  if (dossier) {
    const factureFinale = Number(dossier.price) || 0;
    v.push({
      ok: factureFinale - facture(prixCourant) <= Number(paye.deltaTotal) + 0.001,
      label: '[B] LE MONTANT FACTURE NE DEPASSE JAMAIS LE MONTANT ANNONCE',
      detail: `facture=${factureFinale} base=${facture(prixCourant)} ecart=${factureFinale - facture(prixCourant)} <= annonce=${paye.deltaTotal}`,
    });
    // [C1] TOUTE CARTE AFFICHEE EST TENABLE : la visite entiere a passe la porte.
    v.push({
      ok: m.post.statut === 201 && String(dossier.formuleId || '') === String(paye.formuleId),
      label: '[C] TOUTE CARTE AFFICHEE EST TENABLE : la visite entiere passe la validation aux heures retenues',
      detail: `HTTP ${m.post.statut} formule=${dossier.formuleId}`,
    });
    // [E] ACCEPTER NE DEPLACE RIEN D AUTRE.
    v.push({
      ok: m.avant.dossier.date === m.apres.dossier.date
        && m.avant.dossier.startTime === m.apres.dossier.startTime
        && m.avant.dossier.lanes === m.apres.dossier.lanes
        && m.avant.dossier.ancres === m.apres.dossier.ancres,
      label: '[E] ACCEPTER NE DEPLACE RIEN D AUTRE : meme date, memes pistes, memes heures d ancres',
      detail: `${m.avant.dossier.startTime}/${m.avant.dossier.lanes}/${m.avant.dossier.ancres} -> ${m.apres.dossier.startTime}/${m.apres.dossier.lanes}/${m.apres.dossier.ancres}`,
    });
    v.push({
      ok: m.apres.dossier.type === 'formule' && m.apres.dossier.formuleId === paye.formuleId && m.apres.dossier.program === 'absent'
        && String(dossier.type) === 'formule' && !dossier.program,
      label: '[E] ACCEPTER NE DEPLACE RIEN D AUTRE : le dossier reste une FORMULE et ne porte aucun program',
      detail: `ecran type=${m.apres.dossier.type} formule=${m.apres.dossier.formuleId} program=${m.apres.dossier.program} | base type=${dossier.type} program=${dossier.program ? 'present' : 'absent'}`,
    });
  }
  return v;
}

function jugerTemoinSansClic(accepte, temoin) {
  const v = [];
  const dA = accepte.post && accepte.post.reponse && accepte.post.reponse.reservation;
  const dT = temoin.post && temoin.post.reponse && temoin.post.reponse.reservation;
  v.push({ ok: Boolean(dT), label: '[montage] le parcours SANS clic cree lui aussi un dossier', detail: temoin.post ? `HTTP ${temoin.post.statut}` : 'aucun POST' });
  if (!dA || !dT) return v;
  const champs = ['date', 'startTime', 'pax', 'centerId', 'type'];
  const identiques = champs.filter((c) => String(dA[c]) === String(dT[c]));
  v.push({
    ok: identiques.length === champs.length,
    label: '[E] NE RIEN CLIQUER NE CHANGE RIEN : le dossier temoin est identique champ par champ, hors formule et prix',
    detail: champs.map((c) => `${c}:${dT[c]}${String(dA[c]) === String(dT[c]) ? '' : ` != ${dA[c]}`}`).join(' '),
  });
  v.push({
    ok: String(dT.formuleId) === FORMULE_COURANTE && Number(dT.price) === facture(prixServeur(FORMULE_COURANTE, PAX)),
    label: '[E] NE RIEN CLIQUER NE CHANGE RIEN : le temoin garde sa formule et son prix de depart',
    detail: `formule=${dT.formuleId} prix=${dT.price} attendu=${facture(prixServeur(FORMULE_COURANTE, PAX))}`,
  });
  return v;
}

// ---------------------------------------------------------------------------
// [C2] UNE CARTE MORTE AU CLIC NE CASSE RIEN.
// ---------------------------------------------------------------------------
async function mesurerCarteMorte(browser) {
  RESERVATIONS.length = 0;
  BLOCAGES.length = 0;
  POSTS.length = 0;
  const { page, fermer } = await pageNeuve(browser);
  try {
    const avant = await allerAuRecap(page);
    const carte = avant.cartes[0] || null;
    if (!carte) return { avant, apres: avant, carte: null, bloquee: false };
    // LE CENTRE BLOQUE LA FORMULE PENDANT QUE LE CLIENT LIT LA CARTE. Meme forme
    // qu un blocage pose depuis la console (lib/availability-blocks) : jour
    // entier, portee formule.
    BLOCAGES.push({
      id: 1, centerId: CENTRE, scopeType: 'formula', scopeRef: carte.id, recurrence: 'once',
      date: DATE, dayOfWeek: null, dateFrom: null, dateUntil: null, startMin: null, endMin: null,
      reason: 'gate', createdBy: 'gate',
    });
    const apres = await cliquerAjouter(page, carte);
    return { avant, apres, carte, bloquee: true };
  } finally {
    BLOCAGES.length = 0;
    await fermer();
  }
}

function jugerCarteMorte(m) {
  const v = [];
  v.push({ ok: Boolean(m.carte) && m.bloquee, label: '[montage] une carte etait affichee, et le centre a bloque SA formule avant le clic', detail: m.carte ? m.carte.id : 'aucune carte' });
  if (!m.carte) return v;
  const champs = Object.keys(m.avant.dossier);
  const bouges = champs.filter((c) => m.avant.dossier[c] !== m.apres.dossier[c]);
  v.push({
    ok: bouges.length === 0,
    label: '[C] UNE CARTE MORTE AU CLIC LAISSE LE DOSSIER IDENTIQUE CHAMP PAR CHAMP',
    detail: bouges.length ? `champs deplaces : ${bouges.map((c) => `${c} ${m.avant.dossier[c]} -> ${m.apres.dossier[c]}`).join(' | ')}` : 'aucun champ deplace',
  });
  v.push({
    ok: m.avant.total === m.apres.total,
    label: '[C] UNE CARTE MORTE AU CLIC NE TOUCHE PAS LE TOTAL',
    detail: `${m.avant.total} -> ${m.apres.total}`,
  });
  v.push({
    ok: Boolean(m.apres.statut && m.apres.statut.length > 3) && m.apres.statutTon === 'ko',
    label: '[C] UNE CARTE MORTE AU CLIC DIT POURQUOI : le client lit une raison courte',
    detail: `« ${m.apres.statut} » ton=${m.apres.statutTon}`,
  });
  v.push({
    ok: !m.apres.cartes.some((c) => c.id === m.carte.id),
    label: '[C] LA CARTE MORTE DISPARAIT : un second clic ne peut pas echouer pareil',
    detail: `${m.apres.cartes.length} carte(s) restantes`,
  });
  // Le focus ne doit pas retomber sur le corps de page : renderRecap detruit le
  // bouton qui l avait.
  v.push({
    ok: m.apres.focus !== 'BODY',
    label: '[C] LA REPONSE AU CLIC NE FAIT PAS PERDRE SA PLACE AU CLAVIER',
    detail: `activeElement=${m.apres.focus}`,
  });
  return v;
}

// ---------------------------------------------------------------------------
// [D] SEUL L ECART POSITIF SE MONTRE, ET IL APPARTIENT A CE CENTRE.
// Mesure serveur : aucun navigateur n est necessaire pour une regle de portee.
// ---------------------------------------------------------------------------
function creneauFabrique(heure = '14:00') {
  // Le module ne lit du creneau que son heure et le plan d ancres retenu : on le
  // fabrique pour pouvoir interroger n importe quel centre sans passer par la
  // disponibilite publique (qui refuse un centre inconnu bien avant le module).
  return { time: heure, lanes: [], opsPlan: { anchorPlan: { times: { laser_game: heure }, laserGameTimes: [heure], laserPlacement: 'scheduled' } } };
}
function cartesModule(centerId, formuleId, pax, date = DATE) {
  const complements = require(path.join(ROOT, 'lib/booking-complements'));
  return complements.buildFormulaComplements({
    centerId,
    formuleId,
    date,
    pax,
    retainedSlot: creneauFabrique(),
    type: 'formule',
    duration: 0,
    priceOptions: { bowlingConfig: null, dateStr: date },
    reservations: [],
    laneStatuses: {},
    blocks: [],
    passesFinalGuards: null,
  });
}

async function mesurerD() {
  // Temoin negatif : ffm et sa seule candidate couvrante, MOINS chere.
  const ffmVendredi = await getJson({ date: VENDREDI, type: 'formule', pax: String(PAX), centerId: CENTRE, formuleId: 'ffm' });
  // Portee : le meme appel sur deux centres dont les prix effectifs different.
  const overrideAvant = null;
  const prixLibramont = prixServeur('f2', PAX, CENTRE);
  setFormuleOverrides(new Map([[`f2|gembloux`, { priceValue: Number(getEffectiveFormules(CENTRE).find((f) => f.id === 'f2').price) + 7 }]]));
  const prixGembloux = prixServeur('f2', PAX, 'gembloux');
  const cartesIci = cartesModule(CENTRE, FORMULE_COURANTE, PAX);
  const cartesLa = cartesModule('gembloux', FORMULE_COURANTE, PAX);
  setFormuleOverrides(new Map());
  const cartesInconnu = cartesModule('centre-hors-plateforme', FORMULE_COURANTE, PAX);
  return { ffmVendredi, prixLibramont, prixGembloux, cartesIci, cartesLa, cartesInconnu, overrideAvant };
}

function jugerD(m) {
  const v = [];
  const catalogue = getEffectiveFormules(CENTRE);
  const prixFfm = prixServeur('ffm', PAX);
  const couvrantesMoinsCheres = catalogue.filter((f) => f.id !== 'ffm' && f.type === catalogue.find((x) => x.id === 'ffm').type && prixServeur(f.id, PAX) < prixFfm);
  v.push({
    ok: couvrantesMoinsCheres.length > 0 && m.ffmVendredi.corps.slots && m.ffmVendredi.corps.slots.length > 0,
    label: '[montage] ffm a bien des creneaux ce vendredi et des formules MOINS cheres au catalogue',
    detail: `${(m.ffmVendredi.corps.slots || []).length} creneaux, moins cheres : ${couvrantesMoinsCheres.map((f) => f.id).join(',') || 'aucune'}`,
  });
  v.push({
    ok: (m.ffmVendredi.corps.complements || []).length === 0,
    label: '[D] SEUL L ECART POSITIF SE MONTRE : ffm ne rend aucune carte (sa seule couvrante est moins chere)',
    detail: `${(m.ffmVendredi.corps.complements || []).length} carte(s)`,
  });
  v.push({
    ok: m.cartesIci.length > 0 && m.cartesLa.length > 0,
    label: '[montage] les deux centres rendent bien une carte, seuls leurs prix different',
    detail: `${CENTRE}:${m.cartesIci.length} gembloux:${m.cartesLa.length}`,
  });
  v.push({
    ok: m.prixGembloux !== m.prixLibramont,
    label: '[montage] l override de prix pose sur gembloux mord bien sur getBasePrice',
    detail: `f2 a ${PAX} personnes : ${CENTRE}=${m.prixLibramont} gembloux=${m.prixGembloux}`,
  });
  v.push({
    ok: m.cartesIci.length > 0 && m.cartesLa.length > 0
      && m.cartesIci[0].deltaTotal !== m.cartesLa[0].deltaTotal,
    label: '[D] LE MONTANT APPARTIENT A CE CENTRE : deux centres aux prix differents annoncent des montants differents',
    detail: `prix f2 ${m.prixLibramont} vs ${m.prixGembloux} ; deltas ${m.cartesIci[0] && m.cartesIci[0].deltaTotal} vs ${m.cartesLa[0] && m.cartesLa[0].deltaTotal}`,
  });
  v.push({
    ok: m.cartesInconnu.length === 0,
    label: '[D] UN CENTRE INCONNU DE LA PLATEFORME NE REND AUCUNE CARTE',
    detail: `${m.cartesInconnu.length} carte(s)`,
  });
  return v;
}

// ---------------------------------------------------------------------------
// [F] LA GARDE DE DOTATION EST JOIGNABLE SUR TOUTE VISITE.
// ---------------------------------------------------------------------------
const { listCenterActivities } = require(path.join(ROOT, 'lib/activity-catalog'));
function corpsVisite(program, pax, index, heure) {
  return {
    name: `Groupe ${index}`, phone: '+32470000000', email: `g${index}@exemple.be`,
    date: DATE, startTime: heure, duration: 1, totalDuration: 1, pax,
    type: 'visite', program, centerId: CENTRE, channel: 'public',
  };
}
function heurePlus(heure, minutes) {
  const [h, m] = String(heure).split(':').map(Number);
  const t = h * 60 + m + minutes;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

async function mesurerF() {
  RESERVATIONS.length = 0;
  BLOCAGES.length = 0;
  const catalogue = listCenterActivities(CENTRE);
  const finie = catalogue.find((a) => !a.planned && Number(a.units) > 0) || null;
  const absorbable = catalogue.find((a) => !a.planned && !(Number(a.units) > 0)) || null;
  if (!finie || !absorbable) return { finie, absorbable };
  const parUnite = Math.max(1, Number(finie.capacityPerUnit) || 1);
  const dotation = Math.trunc(Number(finie.units));
  const HEURE = '15:00';
  const SUIVANTE = heurePlus(HEURE, 60);
  // MONTAGE : la dotation est saturee sur TOUTE la fenetre de la visite mixte
  // (deux heures). Une activite libre n a aucune heure imposee : saturer la
  // premiere heure seulement ne monte pas la situation qu on pretend tester.
  let poses = 0;
  for (const heure of [HEURE, SUIVANTE]) {
    for (let i = 1; i <= dotation; i += 1) {
      const r = await postJson(corpsVisite([{ activityId: finie.id, duration: 1 }], parUnite, `${heure}-${i}`, heure));
      if (r.statut >= 200 && r.statut < 300) poses += 1;
    }
  }
  const satureA = await postJson(corpsVisite([{ activityId: finie.id, duration: 1 }], parUnite, 'sat-a', HEURE));
  const satureB = await postJson(corpsVisite([{ activityId: finie.id, duration: 1 }], parUnite, 'sat-b', SUIVANTE));
  const melange = await postJson(corpsVisite([{ activityId: 'bowling', duration: 1 }, { activityId: finie.id, duration: 1 }], parUnite, 'mix', HEURE));
  const libre = await postJson(corpsVisite([{ activityId: 'bowling', duration: 1 }, { activityId: absorbable.id, duration: 1 }], parUnite, 'libre', HEURE));

  // ORDRE HETEROGENE, sur la forme RANGEE EN BASE. Un gros groupe qui prend
  // toute la dotation, puis un groupe d une seule unite. C est le seul ordre qui
  // distingue « compter des unites » de « compter des dossiers » : la liste
  // blanche de normalizeReservationProgram ne conserve pas laneCount, donc un
  // comptage qui retombe sur 1 laisse passer le second groupe et vend trois
  // pistes pour deux.
  RESERVATIONS.length = 0;
  const gros = await postJson(corpsVisite([{ activityId: finie.id, duration: 1 }], parUnite * dotation, 'gros', HEURE));
  const rangeSansLaneCount = RESERVATIONS.length
    ? !((RESERVATIONS[RESERVATIONS.length - 1].program || {}).items || []).some((i) => i && i.laneCount != null)
    : false;
  const petit = await postJson(corpsVisite([{ activityId: finie.id, duration: 1 }], parUnite, 'petit', HEURE));
  RESERVATIONS.length = 0;
  return { finie, absorbable, dotation, parUnite, poses, satureA, satureB, melange, libre, gros, petit, rangeSansLaneCount };
}

function jugerF(m) {
  const v = [];
  v.push({ ok: Boolean(m.finie && m.absorbable), label: '[montage] le centre declare une activite a dotation finie ET une activite absorbable', detail: m.finie ? `${m.finie.id}:${m.finie.units} / ${m.absorbable.id}` : 'aucune' });
  if (!m.finie || !m.absorbable) return v;
  v.push({ ok: m.poses === m.dotation * 2, label: '[montage] la dotation est occupee sur les deux heures de la visite', detail: `${m.poses}/${m.dotation * 2} dossiers poses` });
  v.push({ ok: m.satureA.statut === 409 && m.satureB.statut === 409, label: '[montage] la dotation est reellement SATUREE aux deux heures', detail: `HTTP ${m.satureA.statut} / ${m.satureB.statut}` });
  v.push({
    ok: m.melange.statut === 409,
    label: '[F] LA GARDE DE DOTATION EST JOIGNABLE SUR TOUTE VISITE : bowling + activite comptee est refuse quand la dotation est prise',
    detail: `HTTP ${m.melange.statut}`,
  });
  v.push({
    ok: m.libre.statut >= 200 && m.libre.statut < 300,
    label: '[F] UNE ACTIVITE SANS DOTATION RESTE ACCEPTEE dans la meme forme a deux lignes',
    detail: `HTTP ${m.libre.statut}`,
  });
  v.push({
    ok: m.gros.statut >= 200 && m.gros.statut < 300 && m.rangeSansLaneCount,
    label: '[montage] le gros groupe est accepte, et la base range son programme SANS laneCount (la forme de production)',
    detail: `HTTP ${m.gros.statut} laneCount absent du programme range : ${m.rangeSansLaneCount}`,
  });
  v.push({
    ok: m.petit.statut === 409,
    label: '[F] LA GARDE COMPTE DES UNITES, PAS DES DOSSIERS : apres un groupe qui prend toute la dotation, un groupe d une unite est refuse',
    detail: `groupe de ${m.parUnite * m.dotation} puis groupe de ${m.parUnite} : HTTP ${m.petit.statut}`,
  });
  return v;
}

// ---------------------------------------------------------------------------
// [G] LE DERNIER ECRAN RESTE UTILISABLE.
// ---------------------------------------------------------------------------
const MESURER_ECRAN = () => {
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const etape = document.querySelector('#clientView .step.is-current') || document;
  const confirmer = document.getElementById('btnConfirmBooking');
  const r = confirmer ? confirmer.getBoundingClientRect() : null;
  const cx = r ? Math.round(r.left + r.width / 2) : 0;
  const cy = r ? Math.round(r.top + r.height / 2) : 0;
  const touche = r ? document.elementFromPoint(cx, cy) : null;
  const petitesCibles = [...etape.querySelectorAll('button, a[href], input, select, summary, [role="button"]')]
    .filter(visible)
    .filter((el) => el.getBoundingClientRect().height < 44)
    .filter((el) => { const l = el.closest('label'); return !(l && l.getBoundingClientRect().height >= 44); })
    .map((el) => `${el.id || (el.className || el.tagName).toString().split(' ')[0]}:${Math.round(el.getBoundingClientRect().height)}`);
  const petitsTextes = [...etape.querySelectorAll('*')]
    .filter((el) => visible(el) && el.children.length === 0 && (el.textContent || '').trim().length > 2)
    .map((el) => `${(el.className || el.tagName).toString().split(' ')[0]}:${Math.round(parseFloat(getComputedStyle(el).fontSize) * 10) / 10}`)
    .filter((e) => parseFloat(e.split(':')[1]) < 11.5);
  const boutonsSansNom = [...etape.querySelectorAll('button, [role="button"]')]
    .filter(visible)
    .filter((el) => !((el.getAttribute('aria-label') || '').trim() || (el.textContent || '').trim() || (el.getAttribute('title') || '').trim()))
    .map((el) => (el.className || el.tagName).toString().split(' ')[0]);
  return {
    confirmerVisible: Boolean(r && r.top >= 0 && r.bottom <= window.innerHeight + 0.5 && r.height > 0),
    confirmerTapable: Boolean(confirmer && touche && (touche === confirmer || confirmer.contains(touche))),
    confirmerRect: r ? { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) } : null,
    fenetre: window.innerHeight,
    petitesCibles,
    petitsTextes,
    boutonsSansNom,
  };
};

async function mesurerG(browser) {
  const out = [];
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    for (const theme of ['light', 'dark']) {
      RESERVATIONS.length = 0;
      BLOCAGES.length = 0;
      const { page, fermer } = await pageNeuve(browser, viewport);
      try {
        // allerAuRecap amene deja le bloc a vue : c est le PIRE cas pour le
        // bouton de confirmation, celui ou le client a fait defiler la colonne
        // jusqu au bout. S il reste visible et tapable la, il l est partout.
        const bloc = await allerAuRecap(page, { theme, viewport });
        const ecran = await page.evaluate(MESURER_ECRAN);
        out.push({ viewport: `${viewport.width}x${viewport.height}`, theme, bloc, ecran });
      } finally {
        await fermer();
      }
    }
  }
  return out;
}

function jugerG(mesures) {
  const v = [];
  mesures.forEach((m) => {
    const cle = `${m.viewport} ${m.theme}`;
    v.push({ ok: m.bloc.cartes.length >= 1, label: `[montage] ${cle} : le bloc de montees est bien a l ecran`, detail: `${m.bloc.cartes.length} carte(s)` });
    v.push({
      ok: m.bloc.dansRecapList && !m.bloc.dansDecision,
      label: `[G] ${cle} : le bloc vit dans #recapList, jamais dans .recap-decision`,
      detail: `recapList=${m.bloc.dansRecapList} decision=${m.bloc.dansDecision}`,
    });
    v.push({
      ok: m.ecran.confirmerVisible && m.ecran.confirmerTapable,
      label: `[G] ${cle} : « Confirmer la reservation » reste entierement visible ET tapable`,
      detail: `${JSON.stringify(m.ecran.confirmerRect)} fenetre=${m.ecran.fenetre} tapable=${m.ecran.confirmerTapable}`,
    });
    v.push({
      ok: m.ecran.petitesCibles.length === 0 && m.ecran.petitsTextes.length === 0,
      label: `[G] ${cle} : aucune cible sous 44 px, aucun texte sous 11,5 px`,
      detail: `cibles=${m.ecran.petitesCibles.join(',') || 'aucune'} textes=${m.ecran.petitsTextes.join(',') || 'aucun'}`,
    });
    v.push({
      ok: m.ecran.boutonsSansNom.length === 0,
      label: `[G] ${cle} : chaque bouton porte un nom accessible`,
      detail: m.ecran.boutonsSansNom.join(',') || 'aucun bouton muet',
    });
  });
  return v;
}

// ---------------------------------------------------------------------------
// LES PROPRIETES ET LEURS MUTATIONS.
// ---------------------------------------------------------------------------
const COMPLEMENTS = 'lib/booking-complements.js';
const OPS = 'lib/reservation-ops.js';
const APP = 'assets/app-main.js';

function propriete(cle, titre, mesurer, juger, mutations) {
  return { cle, titre, mesurer, juger, mutations };
}

async function construirePROPRIETES(browser) {
  return [
    propriete('A+B+C1+E', 'LE MONTANT ANNONCE EST LE MONTANT REEL, ET LA FACTURE NE LE DEPASSE PAS',
      async () => mesurerParcours(browser, { accepter: true }),
      jugerAB,
      [
        {
          nom: 'la carte annonce un montant qui n est pas l ecart des deux prix serveur',
          vise: /\[A\] LE MONTANT ANNONCE EST LE MONTANT REEL/,
          serveur: [{ fichier: COMPLEMENTS, de: '  const deltaTotal = prixFacture(candidatePrice) - prixFacture(currentPrice);', vers: '  const deltaTotal = prixFacture(candidatePrice) - prixFacture(currentPrice) + 1;' }],
        },
        {
          nom: 'accepter une montee touche au programme du dossier',
          vise: /\[E\] ACCEPTER NE DEPLACE RIEN D AUTRE/,
          client: [{ fichier: APP, de: '    b.formuleId = wanted;', vers: '    b.formuleId = wanted;\n    b.program = { items: [] };' }],
        },
      ]),
    propriete('C2', 'UNE CARTE MORTE AU CLIC NE CASSE RIEN',
      async () => mesurerCarteMorte(browser),
      jugerCarteMorte,
      [
        {
          nom: 'un refus au clic adopte quand meme la formule refusee',
          vise: /\[C\] UNE CARTE MORTE AU CLIC LAISSE LE DOSSIER IDENTIQUE/,
          client: [{ fichier: APP, de: '    const slot = (payload.slots || []).find(item => item && item.time === b.startTime) || null;\n    if (!slot) {\n      oublier(payload.message || \'\');\n      return;\n    }', vers: '    const slot = (payload.slots || []).find(item => item && item.time === b.startTime) || null;\n    if (!slot) {\n      b.formuleId = wanted;\n      oublier(payload.message || \'\');\n      return;\n    }' }],
        },
        {
          nom: 'la reponse au clic est ecrite sans reposer le focus',
          vise: /\[C\] LA REPONSE AU CLIC NE FAIT PAS PERDRE SA PLACE AU CLAVIER/,
          client: [{ fichier: APP, de: '  const cible = document.getElementById(\'recapComplements\') || document.getElementById(\'btnConfirmBooking\');', vers: '  const cible = null;' }],
        },
      ]),
    propriete('D', 'SEUL L ECART POSITIF SE MONTRE, ET IL APPARTIENT A CE CENTRE',
      async () => mesurerD(),
      jugerD,
      [
        {
          nom: 'une montee moins chere se propose quand meme',
          vise: /\[D\] SEUL L ECART POSITIF SE MONTRE/,
          serveur: [{ fichier: COMPLEMENTS, de: '  if (!(deltaTotal > 0)) {', vers: '  if (false && !(deltaTotal > 0)) {' }],
        },
        {
          nom: 'le prix de la candidate est lu SANS le centre (le socle au lieu du catalogue du centre)',
          vise: /\[D\] LE MONTANT APPARTIENT A CE CENTRE/,
          serveur: [{
            fichier: COMPLEMENTS,
            de: '  const candidatePrice = getBasePrice(\n    priceType,\n    priceDuration,\n    candidateLaneCount,\n    pax,\n    candidate.id,\n    centerId,\n    priceOptions,\n  );',
            vers: '  const candidatePrice = getBasePrice(\n    priceType,\n    priceDuration,\n    candidateLaneCount,\n    pax,\n    candidate.id,\n    undefined,\n    priceOptions,\n  );',
          }],
        },
        {
          nom: 'le catalogue est lu SANS le centre (un centre inconnu herite du socle)',
          vise: /\[D\] UN CENTRE INCONNU DE LA PLATEFORME NE REND AUCUNE CARTE/,
          serveur: [
            { fichier: COMPLEMENTS, de: '  const catalogue = getEffectiveFormules(centerId);', vers: '  const catalogue = getEffectiveFormules();' },
            { fichier: COMPLEMENTS, de: '  try {\n    center = getCenter(centerId);\n  } catch (error) {\n    return [];\n  }', vers: '  try {\n    center = getCenter(centerId);\n  } catch (error) {\n    center = getCenter(\'libramont\');\n  }' },
          ],
        },
      ]),
    propriete('F', 'LA GARDE DE DOTATION EST JOIGNABLE SUR TOUTE VISITE',
      async () => mesurerF(),
      jugerF,
      [
        {
          nom: 'la garde de dotation est neutralisee',
          vise: /\[F\] LA GARDE DE DOTATION EST JOIGNABLE/,
          serveur: [{ fichier: OPS, de: 'const manque = dotationDepassee(', vers: 'const manque = false && dotationDepassee(' }],
        },
        {
          nom: 'le comptage d unites retombe au « 1 » silencieux',
          vise: /\[F\] LA GARDE COMPTE DES UNITES, PAS DES DOSSIERS/,
          serveur: [{ fichier: OPS, de: '  const compte = Number(item && item.laneCount);\n  if (Number.isFinite(compte) && compte > 0) return Math.trunc(compte);', vers: '  const compte = Number(item && item.laneCount);\n  if (true) return Number.isFinite(compte) && compte > 0 ? Math.trunc(compte) : 1;' }],
        },
      ]),
    propriete('G', 'LE DERNIER ECRAN RESTE UTILISABLE',
      async () => mesurerG(browser),
      jugerG,
      [
        {
          nom: 'le bloc de montees demenage dans la colonne de decision',
          vise: /\[G\] .* le bloc vit dans #recapList/,
          client: [{
            fichier: APP,
            de: '    ${renderComplementCards()}\n  `;\n}',
            vers: '  `;\n  const zoneDecision = document.querySelector(\'#clientView .recap-decision\');\n  const htmlComplements = renderComplementCards();\n  if (zoneDecision && htmlComplements) zoneDecision.insertAdjacentHTML(\'afterbegin\', htmlComplements);\n}',
          }],
        },
      ]),
  ];
}

// ---------------------------------------------------------------------------
async function main() {
  const server = await serveur();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    console.log(`[date] samedi ${DATE} · vendredi ${VENDREDI} · centre ${CENTRE} · ${PAX} personnes · formule ${FORMULE_COURANTE}`);
    const PROPRIETES = await construirePROPRIETES(browser);

    for (const p of PROPRIETES) {
      console.log(`\n[${p.cle}] ${p.titre}`);
      const mesure = await p.mesurer();
      p.juger(mesure).forEach((v) => ok(v.ok, v.label, v.detail));
      if (p.cle === 'A+B+C1+E') {
        // Le temoin « ne rien cliquer » se compare au parcours qu on vient de faire.
        const temoin = await mesurerParcours(browser, { accepter: false });
        jugerTemoinSansClic(mesure, temoin).forEach((v) => ok(v.ok, v.label, v.detail));
      }
    }

    // =====================================================================
    console.log('\n[MUTATION] LE GATE SAIT-IL ROUGIR ? - au moins une mutation par propriete');
    // =====================================================================
    // Ce qui est asserte ici, ce n est pas que la mutation casse quelque chose :
    // c est que LA MESURE DE CETTE PROPRIETE-LA tombe, et sur LA phrase visee.
    for (const p of PROPRIETES) {
      for (const mut of (p.mutations || [])) {
        const editions = [...(mut.serveur || []), ...(mut.client || [])];
        const introuvables = editions
          .map((e) => ({ e, n: sourceDisque(e.fichier).split(e.de).length - 1 }))
          .filter((x) => x.n !== 1);
        if (!ok(introuvables.length === 0,
          `[mutation ${p.cle}] les ${editions.length} ancre(s) de « ${mut.nom} » existent UNE seule fois dans le source livre`,
          introuvables.length
            ? `${introuvables.map((x) => `${x.n} occurrence(s) dans ${x.e.fichier} : ${x.e.de.slice(0, 45)}`).join(' · ')} : la contre-epreuve est DESARMEE`
            : editions.map((e) => e.fichier).join(' · '))) continue;

        let verdicts = [];
        enMutation = true;
        try {
          const jouer = async () => p.juger(await p.mesurer());
          verdicts = mut.serveur && mut.serveur.length
            ? await avecMutationsServeur(mut.serveur, async () => (
              mut.client && mut.client.length ? avecMutationsClient(mut.client, jouer) : jouer()
            ))
            : await avecMutationsClient(mut.client || [], jouer);
        } catch (error) {
          verdicts = [{ ok: false, label: `la mesure ne tourne plus : ${String(error.message).split('\n')[0]}`, detail: '' }];
        } finally {
          enMutation = false;
        }
        const tombes = verdicts.filter((v) => !v.ok);
        const vises = tombes.filter((v) => mut.vise.test(v.label));
        ok(vises.length > 0,
          `[mutation ${p.cle}] « ${mut.nom} » fait bien tomber la propriete [${p.cle}] elle-meme`,
          vises.length
            ? `${vises.length} verdict(s) vise(s) sur ${tombes.length} tombe(s)`
            : `LA SONDE EST AVEUGLE sur ce point : ${tombes.length} verdict(s) tombe(s), aucun ne vise la propriete`);
      }
    }

    // Le depot n a jamais ete touche : la contre-epreuve vit en memoire. On le
    // VERIFIE quand meme, parce qu une mutation laissee en place est le genre de
    // degat qu on ne voit qu au commit suivant.
    ok(overrides.size === 0, '[mutation] aucune mutation client ne survit', `${overrides.size} override(s)`);
    ok(mutationsServeur.length === 0, '[mutation] aucune mutation serveur ne survit', `${mutationsServeur.length} edition(s)`);
    for (const p of PROPRIETES) {
      for (const mut of (p.mutations || [])) {
        for (const e of [...(mut.serveur || []), ...(mut.client || [])]) {
          ok(sourceDisque(e.fichier).includes(e.de), `[mutation ${p.cle}] le fichier ${e.fichier} sur le disque est intact`);
        }
      }
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n${failures ? `${failures} assertion(s) en echec` : 'Tous les controles passent'}`);
  process.exit(failures ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });

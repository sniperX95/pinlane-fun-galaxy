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
//   [H] UNE PARTIE DE LASER EN PLUS EST LE PALIER SUIVANT, ET ELLE NE PROMET
//       AUCUNE HEURE. Un seul cran a la fois ; le montant est l ecart de deux
//       calculs de PROGRAMME recalcules en Node ; au plafond de la grille,
//       aucune carte ; et la partie ajoutee arrive bien EN ATTENTE dans le
//       plan du moteur (a placer sur place), ce que la carte dit en toutes
//       lettres. Une carte qui annoncerait un horaire vendrait un rendez-vous
//       que la reservation ne pose pas.
//
//   [I] UNE ACTIVITE LIBRE EN PLUS NE SE PROPOSE JAMAIS SANS TARIF, et le
//       TEMOIN POSITIF le prouve. Sans temoin positif, « aucune carte sans
//       tarif » se satisferait en n affichant jamais rien : on mesure donc la
//       MEME activite deux fois, une fois sans tarif (aucune carte) et une
//       fois avec un tarif ecrit dans le JEU SERVI (une carte, au montant
//       recalcule). Plus le maximum du groupe, la dotation declaree, et la
//       portee (un tarif ecrit pour un centre ne fait pas parler l autre).
//
//   [J] LA COLONNE DE TEXTE D UNE CARTE GARDE UNE LARGEUR UTILISABLE. Mesure
//       du 2026-09-05 sur les cartes DEJA LIVREES, 390x844 : la grille rendait
//       « 0px 195px 95.9px » sur une carte de 341 px (le montant ne se coupe
//       pas, le bouton garde ses 44 px), donc une colonne de texte de ZERO
//       pixel de large et 789 px de haut - une lettre par ligne. Le bouton
//       restait tapable et les polices restaient legales : aucune mesure de [G]
//       ne pouvait le voir. La propriete est RELATIVE (la colonne de texte
//       occupe au moins la moitie de la carte), jamais un nombre de pixels.
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
//   [K] UNE DUREE HORS GRILLE NE SE PROPOSE PAS. Relecture du 2026-09-05 : le
//       derivateur d options inventait le premier palier de la grille quand la
//       duree declaree par le centre ne tombait sur aucun palier. Le catalogue
//       decide, le code n invente pas un palier.
//
//   [L] UNE OFFRE D ATTENTE NE S ACQUIERT QUE POSEE PAR LE SERVEUR. Si la
//       reponse au clic ne porte pas la ligne marquee au tarif d attente, la
//       carte se retire, le total et le panier ne bougent pas (2026-09-29).
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
const { normalizeProgram } = require(path.join(ROOT, 'lib/visit-program'));
const catalogStore = require(path.join(ROOT, 'lib/catalog-store'));

// LE PRIX ATTENDU D UN PROGRAMME, RECALCULE ICI, par la meme fonction que la
// disponibilite et sans heure de depart. Aucun montant de laser, de bowling ou
// d activite libre n est recopie dans ce gate : ils viennent tous de la
// normalisation du programme, donc du catalogue du centre.
function prixProgramme(lignes, pax, centerId = CENTRE, date = DATE) {
  return normalizeProgram(lignes, { centerId, pax, bowlingConfig: null, dateStr: date }).price;
}
const VISITE_BASE = [{ activityId: 'bowling', duration: 1 }, { activityId: 'laser_game', games: 1 }];

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
      req.setEncoding('utf8');
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
      res.setEncoding('utf8');
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
      res.setEncoding('utf8');
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
    // LA COLONNE DE TEXTE ET LA CARTE, pour la propriete [J]. Une largeur
    // RELATIVE : un seuil en pixels ne mesurerait que la machine.
    const copie = carte.querySelector('.complement-copy');
    const rc = carte.getBoundingClientRect();
    const rcopie = copie ? copie.getBoundingClientRect() : null;
    return {
      id: bouton ? bouton.dataset.complement : '',
      nom: (carte.querySelector('.complement-name') || {}).textContent || '',
      ajouts: (carte.querySelector('.complement-adds') || {}).textContent || '',
      duree: (carte.querySelector('.complement-total') || {}).textContent || '',
      note: (carte.querySelector('.complement-note') || {}).textContent || '',
      largeurCarte: Math.round(rc.width),
      largeurCopie: rcopie ? Math.round(rcopie.width) : 0,
      hauteurCarte: Math.round(rc.height),
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
      ? formulaComplements.map((c) => ({ id: c.id, kind: c.kind, patch: c.patch || null, formuleId: c.formuleId, deltaTotal: c.deltaTotal, deltaPerPax: c.deltaPerPax, amountLabel: c.amountLabel, addsLabel: c.addsLabel, totalLabel: c.totalLabel || '', noteLabel: c.noteLabel || '' }))
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

// LE MEME PARCOURS, POUR UNE VISITE COMPOSEE A LA CARTE. Le panier part du
// test : c est lui qui decide de ce que les generateurs [B] et [C] auront a
// proposer. Le premier goStep2 s arrete sur l ecran de reglages, le second va
// aux heures : on frappe jusqu a ce que les creneaux soient la, et on dit ce
// qu on voyait si ca n arrive pas (un gate muet sur son propre montage est un
// gate vert pour rien).
async function allerAuRecapVisite(page, { pax = PAX, date = DATE, theme = 'light', panier = null, viewport } = {}) {
  if (viewport) await page.setViewportSize(viewport);
  await page.goto(`${BASE_URL}/?v=visite-${Date.now()}-${Math.random().toString(16).slice(2)}`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForFunction(() => typeof window.setView === 'function' && typeof window.goStep === 'function', null, { timeout: 20000 });
  await page.evaluate((t) => { document.documentElement.setAttribute('data-theme', t); }, theme);
  await page.evaluate(({ d, p, pan }) => {
    state.view = 'client';
    state.booking.date = d;
    state.booking.pax = p;
    state.booking.venueConfirmed = true;
    setView('client');
    setType('bowling');
    state.booking.activities = pan || { bowling: { duration: 1 }, laser_game: { games: 1 } };
    applyChosenActivitiesToBooking();
    syncBookingTypeUi();
    goStep(1, { animate: false, focus: false });
  }, { d: date, p: pax, pan: panier });
  await page.waitForTimeout(300);
  for (let essai = 0; essai < 5; essai += 1) {
    await page.evaluate(() => goStep2());
    await page.waitForTimeout(1500);
    if (await page.evaluate(() => Array.isArray(state.availableSlots) && state.availableSlots.length > 0)) break;
  }
  const etat = await page.evaluate(() => ({ step: state.step, slots: (state.availableSlots || []).length, type: state.booking.type }));
  if (!etat.slots) throw new Error(`aucun creneau pour la visite : ${JSON.stringify(etat)}`);
  await page.evaluate(() => { const i = getCurrentFormulaAnchorSlotIndex(); selectSlot(i >= 0 ? i : 0); });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    document.getElementById('fName').value = 'Marie Dupont';
    document.getElementById('fPhone').value = '+32 470 00 00 00';
    document.getElementById('fEmail').value = 'marie@exemple.be';
    goStep4();
  });
  await page.waitForTimeout(800);
  await poser(page);
  return page.evaluate(LIRE_BLOC);
}

// LE BLOC EST EN FIN DE #recapList, LA COLONNE QUI DEFILE : mesurer son bouton
// sans l amener a vue rendrait un rectangle mis en page mais CLIPPE par le
// scrolleur, et le hit-test taperait ce qui est peint a cette place (mesure :
// « total-box »). Le client, lui, fait defiler. On fait donc ce que fait le
// client, PUIS on mesure. Et on attend la fin des animations : une carte
// mesuree en cours d entree rend 43,1 px pour un bouton de 44.
// Une CARTE peut etre visee : le bloc a deux cartes est plus haut que ce qui
// reste de la colonne sur un telephone, et le centrer laisse la premiere carte
// CLIPPEE par le scrolleur - le hit-test tape alors ce qui est peint a cette
// place. Le client, lui, fait defiler jusqu a la carte qu il veut.
async function poser(page, idCarte = '') {
  await page.evaluate((id) => {
    const bouton = id ? document.querySelector(`#recapComplements .complement-add[data-complement="${String(id).replace(/"/g, '')}"]`) : null;
    const bloc = (bouton && bouton.closest('.complement-card')) || document.getElementById('recapComplements');
    if (bloc && typeof bloc.scrollIntoView === 'function') bloc.scrollIntoView({ block: 'center' });
  }, idCarte);
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
  await page.waitForTimeout(150);
}

// Le clic REEL, a la souris, sur le centre du bouton : pas un appel de fonction.
// La carte est d abord amenee a vue, puis SES coordonnees sont relues : celles
// d avant le defilement designeraient un autre pixel.
async function cliquerAjouter(page, carte) {
  await poser(page, carte.id);
  const frais = await page.evaluate(LIRE_BLOC);
  const vise = frais.cartes.find((c) => c.id === carte.id) || carte;
  await page.evaluate((id) => {
    const b = document.querySelector(`#recapComplements .complement-add[data-complement="${id}"]`);
    if (b) b.focus();
  }, carte.id);
  await page.mouse.click(vise.centre[0], vise.centre[1]);
  await page.waitForFunction(() => {
    const zone = document.getElementById('complementStatus');
    return Boolean(zone && (zone.textContent || '').trim() && (zone.dataset.tone || '') !== 'busy');
  }, null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(400);
  await poser(page, carte.id);
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
// [H] UNE PARTIE DE LASER EN PLUS : LE PALIER SUIVANT, ET AUCUNE HEURE PROMISE.
// ---------------------------------------------------------------------------
async function mesurerH(browser) {
  RESERVATIONS.length = 0;
  BLOCAGES.length = 0;
  POSTS.length = 0;
  const { page, fermer } = await pageNeuve(browser);
  try {
    const avant = await allerAuRecapVisite(page);
    const carte = avant.cartes.find((c) => String(c.id).startsWith('laser:')) || null;
    let apres = avant;
    if (carte) apres = await cliquerAjouter(page, carte);
    await confirmer(page);
    // Le PLAFOND de la grille : la meme visite, deja au dernier palier.
    const dernier = [...LASER_GAME_OPTIONS].sort((a, b) => Number(b.games) - Number(a.games))[0];
    const plafond = await getJson({
      date: DATE, type: 'visite', pax: String(PAX), centerId: CENTRE,
      program: JSON.stringify([{ activityId: 'bowling', duration: 1 }, { activityId: 'laser_game', games: Number(dernier.games) }]),
    });
    return { avant, apres, carte, post: POSTS[POSTS.length - 1] || null, dernier, plafond };
  } finally {
    await fermer();
  }
}

function jugerH(m) {
  const v = [];
  const courant = [...LASER_GAME_OPTIONS].sort((a, b) => Number(a.games) - Number(b.games))[0];
  const suivant = [...LASER_GAME_OPTIONS].sort((a, b) => Number(a.games) - Number(b.games))[1] || null;
  const paye = (m.avant.payload || []).find((c) => String(c.id).startsWith('laser:')) || null;
  const base = prixProgramme(VISITE_BASE, PAX);
  const monte = suivant ? prixProgramme([{ activityId: 'bowling', duration: 1 }, { activityId: 'laser_game', games: Number(suivant.games) }], PAX) : null;
  const attendu = monte == null ? null : facture(monte) - facture(base);

  // MONTAGE : sans carte de laser chiffree et tapable, tout ce qui suit serait
  // vert pour rien.
  v.push({ ok: Boolean(suivant), label: '[montage] la grille du laser a bien un palier au-dessus du premier', detail: suivant ? `${courant.label} -> ${suivant.label}` : 'un seul palier' });
  v.push({ ok: Boolean(m.carte && m.carte.hitTest && m.carte.hauteurBouton >= 44), label: '[montage] la visite rend une carte de palier de laser, tapable et de 44 px', detail: m.carte ? `${m.carte.id} hit=${m.carte.hitTest} h=${m.carte.hauteurBouton}` : 'aucune carte de laser' });
  v.push({ ok: m.avant.total === facture(base), label: '[montage] le total affiche AVANT est bien le prix serveur du programme courant', detail: `ecran=${m.avant.total} node=${facture(base)}` });

  // [H] UN SEUL CRAN, AU PRIX DE LA GRILLE.
  v.push({
    ok: Boolean(paye) && Number(paye.deltaTotal) === attendu,
    label: '[H] UNE PARTIE EN PLUS EST LE PALIER SUIVANT, AU PRIX DE LA GRILLE : la carte annonce l ecart des deux programmes',
    detail: `annonce=${paye && paye.deltaTotal} attendu=${attendu} (${base} -> ${monte}) palier vise=${paye && paye.patch && paye.patch.options && paye.patch.options.games}`,
  });
  v.push({
    ok: Boolean(paye && paye.patch && Number(paye.patch.options.games) === Number(suivant && suivant.games)),
    label: '[H] UN SEUL CRAN A LA FOIS : la carte vise le palier immediatement superieur, pas le plafond',
    detail: `visee=${paye && paye.patch && paye.patch.options.games} attendu=${suivant && suivant.games}`,
  });
  const ecartEcran = m.apres.total !== null && m.avant.total !== null ? Math.round((m.apres.total - m.avant.total) * 100) / 100 : null;
  v.push({
    ok: ecartEcran === attendu,
    label: '[H] LE MONTANT ANNONCE EST LE MONTANT REEL : le total de l ecran bouge exactement de ce montant',
    detail: `#recapTotal ${m.avant.total} -> ${m.apres.total} (ecart ${ecartEcran}, attendu ${attendu})`,
  });

  // [H] LA CARTE NE PROMET AUCUNE HEURE.
  v.push({
    ok: Boolean(paye && String(paye.noteLabel || '').trim().length > 10) && Boolean(m.carte && m.carte.note.trim()),
    label: '[H] LA CARTE DIT QUE LA PARTIE SE PLACE SUR PLACE, et ne promet aucun horaire',
    detail: `note servie « ${paye && paye.noteLabel} » / note a l ecran « ${m.carte && m.carte.note} »`,
  });
  // [H] ET ELLE N ANNONCE AUCUN TEMPS TOTAL ALLONGE. Une partie en attente
  // n allonge pas la fenetre reservee (segments identiques a 1, 2 ou 3 parties).
  // Relecture du 2026-09-05 : la carte disait « 2h au lieu de 1h30 » ET « quand
  // vous voulez » sur le meme ecran.
  v.push({
    ok: Boolean(paye) && String(paye.totalLabel || '').trim() === '' && Boolean(m.carte) && String(m.carte.duree || '').trim() === '',
    label: '[H] LA CARTE N ANNONCE AUCUN TEMPS TOTAL ALLONGE : une partie placee sur place ne change pas la fenetre reservee',
    detail: `totalLabel servi « ${paye && paye.totalLabel} » / a l ecran « ${m.carte && m.carte.duree} »`,
  });
  const dossier = m.post && m.post.reponse && m.post.reponse.reservation ? m.post.reponse.reservation : null;
  v.push({ ok: Boolean(dossier) && m.post.statut === 201, label: '[montage] la confirmation a bien cree un dossier', detail: m.post ? `HTTP ${m.post.statut}` : 'aucun POST' });
  if (dossier) {
    const plan = (dossier.opsPlan && dossier.opsPlan.laserPassPlan) || null;
    const ecartParties = Number(suivant && suivant.games) - Number(courant.games);
    v.push({
      ok: Boolean(plan) && Number(plan.remainingGames) === ecartParties && Number(plan.scheduledGames) === Number(courant.games),
      label: '[H] LE DOSSIER CREE LAISSE BIEN LA PARTIE EN PLUS A PLACER SUR PLACE (elle n a aucune heure)',
      detail: plan ? `scheduledGames=${plan.scheduledGames} remainingGames=${plan.remainingGames} attendu ${courant.games}/${ecartParties}` : 'aucun laserPassPlan',
    });
    v.push({
      ok: Number(dossier.price) - facture(base) <= Number(paye ? paye.deltaTotal : -1) + 0.001,
      label: '[H] LE MONTANT FACTURE NE DEPASSE JAMAIS LE MONTANT ANNONCE',
      detail: `facture=${dossier.price} base=${facture(base)} <= annonce=${paye && paye.deltaTotal}`,
    });
    v.push({
      ok: m.avant.dossier.startTime === m.apres.dossier.startTime && m.avant.dossier.lanes === m.apres.dossier.lanes && m.avant.dossier.ancres === m.apres.dossier.ancres,
      label: '[H] ACCEPTER NE DEPLACE RIEN : memes heures d ancres, memes pistes',
      detail: `${m.avant.dossier.startTime}/${m.avant.dossier.lanes}/${m.avant.dossier.ancres} -> ${m.apres.dossier.startTime}/${m.apres.dossier.lanes}/${m.apres.dossier.ancres}`,
    });
  }
  const auPlafond = (m.plafond.corps.complements || []).filter((c) => String(c.id).startsWith('laser:'));
  v.push({
    ok: (m.plafond.corps.slots || []).length > 0 && auPlafond.length === 0,
    label: '[H] AU PLAFOND DE LA GRILLE, AUCUNE CARTE DE LASER (le moteur refuse en 422, il ne rabote pas)',
    detail: `${(m.plafond.corps.slots || []).length} creneau(x) au palier ${m.dernier.label}, ${auPlafond.length} carte(s) de laser`,
  });
  return v;
}

// ---------------------------------------------------------------------------
// [K] UNE DUREE HORS GRILLE NE SE PROPOSE PAS. Le module est re-requis a chaque
// mesure : rechargerApi purge son cache, donc une mutation servie en memoire
// est bien celle qui repond ici.
// ---------------------------------------------------------------------------
async function mesurerK() {
  const { optionsDuCatalogue } = require(path.join(ROOT, 'lib/booking-complements'));
  return {
    paliers: DURATION_OPTIONS.map((o) => Math.round(Number(o.value) * 60)),
    surGrille: optionsDuCatalogue({ priceType: 'grid_bowling', defaultMinutes: 60 }),
    horsGrille: optionsDuCatalogue({ priceType: 'grid_bowling', defaultMinutes: 45 }),
    sessionSansDuree: optionsDuCatalogue({ priceType: 'grid_fun_run', defaultMinutes: 0 }),
  };
}

function jugerK(m) {
  return [
    { ok: m.paliers.includes(60) && !m.paliers.includes(45), label: '[montage] la grille des durees porte 60 min et aucun palier de 45 min', detail: m.paliers.join('/') },
    { ok: Boolean(m.surGrille) && Number(m.surGrille.duration) === 1, label: '[K] UNE DUREE SUR LA GRILLE SE DERIVE : 60 min -> 1 h', detail: JSON.stringify(m.surGrille) },
    { ok: m.horsGrille === null, label: '[K] UNE DUREE HORS GRILLE NE SE PROPOSE PAS : 45 min -> aucune option, jamais un palier invente', detail: JSON.stringify(m.horsGrille) },
    { ok: m.sessionSansDuree === null, label: '[K] UNE SESSION SANS DUREE NE SE PROPOSE PAS', detail: JSON.stringify(m.sessionSansDuree) },
  ];
}

// ---------------------------------------------------------------------------
// [I] UNE ACTIVITE LIBRE : JAMAIS SANS TARIF, ET LE TEMOIN POSITIF.
//
// Mesure SERVEUR : aucun navigateur n est necessaire pour une regle de
// catalogue, et le jeu servi se mute ici en memoire (applyCatalogState), sans
// jamais toucher le disque.
// ---------------------------------------------------------------------------
function creneauVisite(heure = '14:00') {
  return { time: heure, lanes: [], opsPlan: { anchorPlan: { times: { bowling: heure, laser_game: '15:00' }, laserGameTimes: ['15:00'], laserPlacement: 'scheduled' } } };
}
function cartesVisite(centerId, lignes, pax, date = DATE) {
  const complements = require(path.join(ROOT, 'lib/booking-complements'));
  return complements.buildVisitComplements({
    centerId,
    date,
    pax,
    program: normalizeProgram(lignes, { centerId, pax, bowlingConfig: null, dateStr: date }),
    retainedSlot: creneauVisite(),
    priceOptions: { bowlingConfig: null, dateStr: date },
    reservations: [],
    laneStatuses: {},
    blocks: [],
    passesFinalGuards: null,
  });
}

// LE PROGRAMME DE BASE SATURE : le bowling, le laser AU DERNIER PALIER de sa
// grille, et toutes les activites libres DEJA TARIFEES sauf celle qu on veut
// observer. Le plafond de cartes ne peut alors plus cacher la candidate : s il
// n en reste qu une de possible, elle est la ou elle n y est pas.
//
// Sans cette precaution, la premiere version de cette propriete etait verte
// pour la mauvaise raison (mesure du 2026-09-05) : « le fun run n est pas
// propose au-dela de son maximum » etait vrai a 5 personnes COMME a 6, parce
// que deux cartes moins cheres par personne passaient devant. Le gate ne
// mesurait pas le maximum du groupe, il mesurait le plafond de cartes.
function baseSaturee(exclus, pax) {
  const complements = require(path.join(ROOT, 'lib/booking-complements'));
  const dernier = [...LASER_GAME_OPTIONS].sort((a, b) => Number(b.games) - Number(a.games))[0];
  const lignes = [{ activityId: 'bowling', duration: 1 }, { activityId: 'laser_game', games: Number(dernier.games) }];
  for (const activite of listCenterActivities(CENTRE)) {
    if (activite.planned || activite.id === exclus) continue;
    // Une activite qui depasse deja le maximum du groupe n a rien a faire dans
    // le programme de base : ce serait une visite que le produit ne vend pas.
    if (Number(activite.maxPax) > 0 && pax > Number(activite.maxPax)) continue;
    const options = complements.optionsDuCatalogue(activite);
    if (!options) continue;
    const essai = normalizeProgram([...lignes, { activityId: activite.id, ...options }], { centerId: CENTRE, pax, bowlingConfig: null, dateStr: DATE });
    const ligne = essai.items.find((item) => item.activityId === activite.id);
    if (ligne && ligne.priceKnown === true) lignes.push({ activityId: activite.id, ...options });
  }
  return lignes;
}

// « Sans tarif » se MESURE, ne se suppose pas : on normalise la ligne candidate
// et on lit priceKnown. Le duckpin et le fun run ont un priceValue VIDE et un
// prix quand meme (ils tirent le leur d une grille) : les ranger parmi les
// muettes rendrait la propriete verte pour la mauvaise raison.
function tarifConnu(activite, pax = PAX) {
  const complements = require(path.join(ROOT, 'lib/booking-complements'));
  const options = complements.optionsDuCatalogue(activite);
  if (!options) return false;
  const essai = normalizeProgram([...VISITE_BASE, { activityId: activite.id, ...options }], { centerId: CENTRE, pax, bowlingConfig: null, dateStr: DATE });
  const ligne = essai.items.find((item) => item.activityId === activite.id);
  return Boolean(ligne && ligne.priceKnown === true);
}
const idActivite = (carte) => String((carte.patch && carte.patch.activityId) || '');

function mesurerI() {
  const catalogue = listCenterActivities(CENTRE);
  const libres = catalogue.filter((activite) => !activite.planned);
  const muettes = libres.filter((activite) => !tarifConnu(activite));
  const muette = muettes[0] || null;
  const bornee = libres.find((activite) => Number(activite.maxPax) > 0) || null;
  // LA ROTATION suppose une capacite PAR UNITE (des pistes de 6, des sessions
  // de 5) : c est elle qui fait tourner un groupe. Des tables de billard se
  // choisissent et ne tournent jamais (2026-09-28) : elles ne sont pas le sujet.
  const comptee = libres.find((activite) => Number(activite.units) > 0 && Number(activite.capacityPerUnit) > 0) || null;

  // NEGATIF : un programme ou TOUTES les activites tarifees sont deja prises.
  // Il ne reste que des muettes : la bonne reponse est ZERO carte d activite.
  const baseMuettes = baseSaturee(null, PAX);
  const sansTarif = cartesVisite(CENTRE, baseMuettes, PAX);

  // TEMOIN POSITIF, OBLIGATOIRE : la MEME activite, avec un tarif ecrit dans le
  // JEU SERVI (applyCatalogState, en memoire, jamais sur le disque). Sans lui,
  // « aucune carte sans tarif » se satisferait de n afficher jamais rien.
  const TARIF = 6;
  const baseTemoin = muette ? baseSaturee(muette.id, PAX) : [];
  let avecTarif = [];
  let chezVoisin = [];
  let attenduTemoin = null;
  if (muette) {
    const doc = catalogStore.getActivityDoc(muette.id, CENTRE);
    catalogStore.applyCatalogState({
      activities: [{
        id: muette.id, center_id: CENTRE, name: doc.name, resource_type: doc.resourceType,
        duration_model: doc.durationModel, service_model: doc.serviceModel, risk_drivers: doc.riskDrivers,
        planning_pressure: doc.planningPressure, bookable: true, price_type: doc.booking.priceType,
        price_value: TARIF, price_unit: doc.booking.unitLabel, booking_order: doc.booking.order,
        source: 'custom', active: true,
      }],
    });
    try {
      avecTarif = cartesVisite(CENTRE, baseTemoin, PAX);
      chezVoisin = cartesVisite('gembloux', VISITE_BASE, PAX);
      // Le montant attendu se recalcule DANS la fenetre : dehors, le tarif
      // n existe pas et l ecart vaudrait zero.
      attenduTemoin = facture(prixProgramme([...baseTemoin, { activityId: muette.id }], PAX)) - facture(prixProgramme(baseTemoin, PAX));
    } finally {
      catalogStore.applyCatalogState({});
    }
  }

  // LE MAXIMUM DU GROUPE : la meme activite bornee, a son maximum puis juste
  // au-dessus. normalizeProgram ne l applique PAS (mesure du 2026-09-05 : il
  // chiffre une session de 5 places pour 8 personnes), donc si le module ne le
  // lit pas, personne ne le lit.
  const maxi = bornee ? Math.trunc(Number(bornee.maxPax)) : 0;
  const sousLeMax = bornee ? cartesVisite(CENTRE, baseSaturee(bornee.id, maxi), maxi) : [];
  const auDessus = bornee ? cartesVisite(CENTRE, baseSaturee(bornee.id, maxi + 1), maxi + 1) : [];

  // LA DOTATION DECLAREE : le groupe tient sur les unites declarees, puis une
  // personne de trop et il tournerait.
  const capacite = comptee ? Math.max(1, Math.trunc(Number(comptee.capacityPerUnit) || 1)) * Math.max(1, Math.trunc(Number(comptee.units) || 1)) : 0;
  const dansLaDotation = comptee ? cartesVisite(CENTRE, baseSaturee(comptee.id, capacite), capacite) : [];
  const horsDotation = comptee ? cartesVisite(CENTRE, baseSaturee(comptee.id, capacite + 1), capacite + 1) : [];
  // La garde du maximum, comptee dans le fichier servi : elle protege les deux
  // generateurs de cartes (visite et gamme). Sans sujet au catalogue, c est
  // elle qui porte la propriete.
  const gardeMaximum = (fs.readFileSync(path.join(ROOT, COMPLEMENTS), 'utf8')
    .match(/if \(Number\.isFinite\(maximum\) && maximum > 0 && [a-zA-Z.]+ > maximum\) continue;/g) || []).length;
  return { muette, muettes, bornee, comptee, sansTarif, baseMuettes, baseTemoin, avecTarif, chezVoisin, attenduTemoin, maxi, sousLeMax, auDessus, capacite, dansLaDotation, horsDotation, TARIF, gardeMaximum };
}

function jugerI(m) {
  const v = [];
  v.push({ ok: Boolean(m.muette), label: '[montage] le centre vend bien une activite libre dont le prix est INCONNU', detail: m.muettes ? m.muettes.map((a) => a.id).join(',') || 'aucune' : 'aucune' });
  // LE MAXIMUM DU GROUPE N A PLUS DE SUJET DANS CE CATALOGUE (2026-09-23).
  // Le Fun Run etait le seul a declarer « maxPax: 5 » ; il declare desormais
  // une installation de 5 places et un groupe qui TOURNE (journal 321). La
  // garde reste dans lib/booking-complements pour tout centre qui declarerait
  // un vrai maximum : faute de sujet, elle se mesure sur sa PRESENCE, et la
  // mesure redevient complete des qu une activite en declare un. La mutation
  // « le maximum du groupe declare au catalogue est ignore » reecrit justement
  // cette ligne : la sonde reste mordante.
  v.push({
    ok: Boolean(m.bornee) ? m.maxi > 0 : m.gardeMaximum >= 2,
    label: m.bornee
      ? '[montage] le centre vend bien une activite a MAXIMUM de groupe declare'
      : '[montage] aucune activite ne declare de maximum : la garde du maximum est verifiee sur pieces',
    detail: m.bornee ? `${m.bornee.id} maxPax=${m.maxi}` : `garde ecrite ${m.gardeMaximum} fois dans ${COMPLEMENTS} (2 attendues)`,
  });
  v.push({ ok: Boolean(m.comptee) && m.capacite > 0, label: '[montage] le centre vend bien une activite a DOTATION finie', detail: m.comptee ? `${m.comptee.id} ${m.comptee.units}x${m.comptee.capacityPerUnit}=${m.capacite}` : 'aucune' });
  v.push({
    ok: Boolean(m.muette) && m.baseMuettes.length > VISITE_BASE.length,
    label: '[montage] le programme de base SATURE toutes les activites tarifees : il ne reste que des muettes a proposer',
    detail: `base = ${m.baseMuettes.map((l) => l.activityId).join(',')} ; muettes restantes = ${(m.muettes || []).map((a) => a.id).join(',')}`,
  });
  // `bornee` ne conditionne plus la suite : depuis le 2026-09-23 aucune
  // activite ne declare de maximum, et une propriete entiere ne se tait pas
  // parce qu UN de ses sujets a disparu du catalogue.
  if (!m.muette || !m.comptee) return v;

  const activites = m.sansTarif.filter((c) => c.kind === 'activite');
  v.push({
    ok: activites.length === 0,
    label: '[I] PRIX INCONNU = AUCUNE CARTE : aucune activite sans tarif ne se propose, meme quand elle est la seule candidate',
    detail: activites.length ? `cartes rendues : ${activites.map((c) => `${idActivite(c)} ${c.amountLabel}`).join(' | ')}` : 'aucune carte d activite',
  });
  const temoin = m.avecTarif.find((c) => idActivite(c) === m.muette.id) || null;
  v.push({
    ok: Boolean(temoin),
    label: '[I] TEMOIN POSITIF : la MEME activite, avec un tarif dans le jeu servi, produit bien une carte',
    detail: temoin ? `${temoin.id} ${temoin.amountLabel} - ${temoin.addsLabel}` : `aucune carte pour ${m.muette.id} a ${m.TARIF} EUR : la propriete ci-dessus se satisfait de ne rien afficher`,
  });
  v.push({
    ok: Boolean(temoin) && Number(temoin.deltaTotal) === m.attenduTemoin,
    label: '[I] LE MONTANT DU TEMOIN EST L ECART DES DEUX PROGRAMMES, recalcule en Node',
    detail: `annonce=${temoin && temoin.deltaTotal} attendu=${m.attenduTemoin}`,
  });
  v.push({
    ok: !m.chezVoisin.some((c) => idActivite(c) === m.muette.id),
    label: '[I] LE TARIF APPARTIENT A CE CENTRE : le centre voisin ne propose pas l activite tarifee ici',
    detail: `cartes chez le voisin : ${m.chezVoisin.map((c) => c.id).join(',') || 'aucune'}`,
  });
  const dedans = m.bornee ? m.sousLeMax.some((c) => idActivite(c) === m.bornee.id) : false;
  const dehors = m.bornee ? m.auDessus.some((c) => idActivite(c) === m.bornee.id) : false;
  v.push({
    ok: m.bornee ? (dedans && !dehors) : m.gardeMaximum >= 2,
    label: '[I] LE MAXIMUM DU GROUPE EST RESPECTE : proposee a son maximum, jamais une personne au-dessus',
    detail: m.bornee
      ? `${m.bornee.id} a ${m.maxi} personnes : ${dedans} ; a ${m.maxi + 1} : ${dehors}`
      : `aucun sujet au catalogue ; la garde est ecrite ${m.gardeMaximum} fois dans ${COMPLEMENTS} (2 attendues)`,
  });
  const tient = m.dansLaDotation.some((c) => idActivite(c) === m.comptee.id);
  const tourne = m.horsDotation.some((c) => idActivite(c) === m.comptee.id);
  v.push({
    ok: tient && !tourne,
    label: '[I] LA DOTATION DECLAREE EST RESPECTEE : proposee tant que le groupe tient, jamais quand il tournerait',
    detail: `${m.comptee.id} a ${m.capacite} personnes : ${tient} ; a ${m.capacite + 1} : ${tourne}`,
  });
  return v;
}
// ---------------------------------------------------------------------------
// [J] LA COLONNE DE TEXTE D UNE CARTE GARDE UNE LARGEUR UTILISABLE.
// ---------------------------------------------------------------------------
async function mesurerJ(browser) {
  const out = [];
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    for (const theme of ['light', 'dark']) {
      RESERVATIONS.length = 0;
      BLOCAGES.length = 0;
      const { page, fermer } = await pageNeuve(browser, viewport);
      try {
        const visite = await allerAuRecapVisite(page, { theme, viewport });
        const formule = await allerAuRecap(page, { theme, viewport });
        out.push({ viewport: `${viewport.width}x${viewport.height}`, theme, visite, formule });
      } finally {
        await fermer();
      }
    }
  }
  return out;
}

function jugerJ(mesures) {
  const v = [];
  mesures.forEach((m) => {
    const cle = `${m.viewport} ${m.theme}`;
    [['visite', m.visite], ['formule', m.formule]].forEach(([nom, bloc]) => {
      v.push({ ok: bloc.cartes.length >= 1, label: `[montage] ${cle} ${nom} : au moins une carte a mesurer`, detail: `${bloc.cartes.length} carte(s)` });
      const etroites = bloc.cartes.filter((c) => !(c.largeurCarte > 0) || c.largeurCopie < c.largeurCarte * 0.5);
      v.push({
        ok: bloc.cartes.length >= 1 && etroites.length === 0,
        label: `[J] ${cle} ${nom} : la colonne de texte occupe au moins la moitie de la carte`,
        detail: bloc.cartes.map((c) => `${c.id} ${c.largeurCopie}/${c.largeurCarte}px h=${c.hauteurCarte}`).join(' | ') || 'aucune carte',
      });
    });
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
  // Depuis le 2026-09-28, les tables de billard se CHOISISSENT (Movsar : « tu
  // dois permettre de choisir combien de tables ils veulent ») : un groupe
  // prend toute la dotation en DEMANDANT toutes les tables. Une activite dont
  // les unites se deduisent du groupe (pistes de 6) la prend par son effectif.
  RESERVATIONS.length = 0;
  const choisies = !(Number(finie.capacityPerUnit) > 0);
  // LE PLAFOND D UNE RESERVATION EN LIGNE (Movsar, 2026-09-30 : « jusqu a 5
  // max de table ») : sous la dotation, le gros groupe prend le plafond et un
  // second dossier le reste. Un comptage par dossier y verrait 2 unites prises
  // sur 6 et laisserait passer le petit groupe : l ordre distingue toujours.
  const plafond = Math.trunc(Number(finie.maxUnitsPerBooking) || 0);
  const parDossier = choisies && plafond > 0 && plafond < dotation ? plafond : dotation;
  const ligneGros = { activityId: finie.id, duration: 1, ...(choisies ? { units: parDossier } : {}) };
  const gros = await postJson(corpsVisite([ligneGros], parUnite * dotation, 'gros', HEURE));
  const rangeSansLaneCount = RESERVATIONS.length
    ? !((RESERVATIONS[RESERVATIONS.length - 1].program || {}).items || []).some((i) => i && i.laneCount != null)
    : false;
  const reste = parDossier < dotation
    ? await postJson(corpsVisite([{ activityId: finie.id, duration: 1, units: dotation - parDossier }], parUnite, 'reste', HEURE))
    : null;
  const petit = await postJson(corpsVisite([{ activityId: finie.id, duration: 1 }], parUnite, 'petit', HEURE));
  RESERVATIONS.length = 0;
  return { finie, absorbable, dotation, parUnite, choisies, parDossier, poses, satureA, satureB, melange, libre, gros, reste, petit, rangeSansLaneCount };
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
    ok: m.gros.statut >= 200 && m.gros.statut < 300 && m.rangeSansLaneCount && (!m.reste || (m.reste.statut >= 200 && m.reste.statut < 300)),
    label: '[montage] le gros groupe est accepte, et la base range son programme SANS laneCount (la forme de production)',
    detail: `HTTP ${m.gros.statut}${m.reste ? ` (${m.parDossier} unites, le plafond en ligne), puis le reste : HTTP ${m.reste.statut}` : ''} ; laneCount absent du programme range : ${m.rangeSansLaneCount}`,
  });
  v.push({
    ok: m.petit.statut === 409,
    label: '[F] LA GARDE COMPTE DES UNITES, PAS DES DOSSIERS : apres un groupe qui prend toute la dotation, un groupe d une unite est refuse',
    detail: m.choisies
      ? `${m.parDossier < m.dotation ? `${m.parDossier} puis ${m.dotation - m.parDossier}` : m.dotation} ${m.finie.id} demandees, puis 1 : HTTP ${m.petit.statut}`
      : `groupe de ${m.parUnite * m.dotation} puis groupe de ${m.parUnite} : HTTP ${m.petit.statut}`,
  });
  return v;
}

// ---------------------------------------------------------------------------
// [L] UNE OFFRE D ATTENTE NE S ACQUIERT QUE POSEE PAR LE SERVEUR (2026-09-29).
// Un groupe qui tourne au duckpin (20 personnes, deux pistes de 6) recoit les
// offres d attente au recapitulatif. Si la reponse au clic ne porte pas la
// ligne marquee au tarif d attente (le groupe ne tourne plus, l offre a quitte
// le centre), la carte se retire et le panier ne bouge pas : sans cette loi,
// le tunnel disait « ajouté » sur une ligne que le serveur n avait pas faite,
// et le prix, lui, ne montait pas.
// ---------------------------------------------------------------------------
const PANIER_TOURS = { bowling: { duration: 1 }, duckpin_bowling: { duration: 1 } };
async function mesurerL(browser) {
  RESERVATIONS.length = 0;
  BLOCAGES.length = 0;
  const { page, fermer } = await pageNeuve(browser);
  try {
    const avant = await allerAuRecapVisite(page, { pax: 20, panier: PANIER_TOURS });
    // La fenetre d annonce de l offre couvre le recapitulatif : le client la
    // ferme d abord, puis choisit dans la liste.
    await page.evaluate(() => { if (typeof fermerOffreAttente === 'function') fermerOffreAttente(); });
    const carte = avant.cartes.find((c) => /^attente:/.test(c.id)) || null;
    if (!carte) return { avant, carte: null };
    const prixAvant = await page.evaluate(() => Number(state.booking.serverPrice) || 0);
    await page.route('**/api/public-availability*', async (route) => {
      const reponse = await route.fetch();
      const j = await reponse.json();
      ((j.program && j.program.items) || []).forEach((i) => {
        if (i.waitOffer === true) { delete i.waitOffer; delete i.waitPricePerPax; i.price = null; i.priceKnown = false; }
      });
      j.price = prixAvant;
      if (j.program) j.program.price = prixAvant;
      await route.fulfill({ response: reponse, json: j });
    });
    const apres = await cliquerAjouter(page, carte);
    const panier = await page.evaluate(() => JSON.stringify(state.booking.activities || {}));
    return { avant, apres, carte, panier };
  } finally {
    await fermer();
  }
}
function jugerL(m) {
  const v = [];
  v.push({ ok: Boolean(m.carte), label: '[montage] un groupe qui tourne au duckpin recoit une offre d attente au recapitulatif', detail: m.avant ? m.avant.cartes.map((c) => c.id).join(' ') || 'aucune carte' : '' });
  if (!m.carte) return v;
  const retiree = !m.apres.cartes.some((c) => c.id === m.carte.id);
  v.push({
    ok: /plus disponible/.test(m.apres.statut || '') && m.apres.total === m.avant.total && retiree && !/waitOffer/.test(m.panier),
    label: '[L] UNE OFFRE D ATTENTE QUE LE SERVEUR NE POSE PAS SE RETIRE : le total et le panier ne bougent pas',
    detail: JSON.stringify({ statut: m.apres.statut, total: `${m.avant.total} -> ${m.apres.total}`, retiree, panier: m.panier }),
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
const CSS = 'assets/pinlane-client.css';

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
          // Attack the final amount after the actual allocated lanes have
          // repriced the candidate, so the mutation cannot be overwritten.
          serveur: [{ fichier: COMPLEMENTS,
            de: '  if (allocated.billedLaneCount) deltaTotal = prixFacture(getBasePrice(priceType, priceDuration, allocated.billedLaneCount, pax, candidate.id, centerId, priceOptions)) - prixFacture(currentPrice);',
            vers: '  if (allocated.billedLaneCount) deltaTotal = prixFacture(getBasePrice(priceType, priceDuration, allocated.billedLaneCount, pax, candidate.id, centerId, priceOptions)) - prixFacture(currentPrice);\n  deltaTotal += 1;',
          }],
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
          // LA LOI D ECART POSITIF VIT DESORMAIS DANS finaliserCartes, une seule
          // fois pour les trois generateurs : la muter les desarme tous d un coup.
          serveur: [{ fichier: COMPLEMENTS, de: '  const gardees = cartes.filter((carte) => carte && carte.deltaTotal > 0);', vers: '  const gardees = cartes.filter((carte) => carte);' }],
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
            { fichier: COMPLEMENTS, de: '  try {\n    return getCenter(centerId);\n  } catch (error) {\n    return null;\n  }', vers: '  try {\n    return getCenter(centerId);\n  } catch (error) {\n    return getCenter(\'libramont\');\n  }' },
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
    propriete('H', 'UNE PARTIE DE LASER EN PLUS : LE PALIER SUIVANT, ET AUCUNE HEURE PROMISE',
      async () => mesurerH(browser),
      jugerH,
      [
        {
          nom: 'le module saute des crans de la grille (le palier courant redevient candidat)',
          vise: /\[H\] UN SEUL CRAN A LA FOIS|\[H\] UNE PARTIE EN PLUS EST LE PALIER SUIVANT/,
          serveur: [{ fichier: COMPLEMENTS, de: '    .filter((option) => Number(option.games) > partiesCourantes)', vers: '    .filter((option) => Number(option.games) >= partiesCourantes)' }],
        },
        {
          nom: 'la carte tait le placement sur place et laisse croire a un horaire',
          vise: /\[H\] LA CARTE DIT QUE LA PARTIE SE PLACE SUR PLACE/,
          serveur: [{ fichier: COMPLEMENTS, de: '    note: () => (ecartParties > 1', vers: '    note: () => false && (ecartParties > 1' }],
        },
        {
          nom: 'la carte de laser recoit le temps total generique (contradiction avec la note)',
          vise: /\[H\] LA CARTE N ANNONCE AUCUN TEMPS TOTAL ALLONGE/,
          serveur: [{ fichier: COMPLEMENTS, de: '    allongeLaVisite: false,', vers: '    allongeLaVisite: true,' }],
        },
      ]),
    propriete('I', 'UNE ACTIVITE LIBRE : JAMAIS SANS TARIF, ET LE TEMOIN POSITIF',
      async () => mesurerI(),
      jugerI,
      [
        {
          // DEUX BARRIERES EN SERIE, et la contre-epreuve les retire toutes les
          // deux. Mesure du 2026-09-05 : une ligne sans tarif ne compte pas dans
          // le prix du programme (normalizeProgram n additionne que les lignes
          // connues), donc son ecart vaut ZERO et la loi commune la refuserait
          // meme sans le controle nomme. Ne muter que l une des deux ne change
          // donc RIEN a l ecran, et la mutation ne prouverait rien. Les retirer
          // ensemble prouve ce que la propriete affirme vraiment : que le module
          // MESURE ce refus au lieu de le supposer.
          nom: 'les deux barrieres contre une activite sans tarif sont retirees',
          vise: /\[I\] PRIX INCONNU = AUCUNE CARTE/,
          serveur: [
            { fichier: COMPLEMENTS, de: '    if (ligne.priceKnown !== true) continue;', vers: '    if (false && ligne.priceKnown !== true) continue;' },
            { fichier: COMPLEMENTS, de: '  const gardees = cartes.filter((carte) => carte && carte.deltaTotal > 0);', vers: '  const gardees = cartes.filter((carte) => carte);' },
          ],
        },
        // RETIREE le 2026-09-23 : « le maximum du groupe declare au catalogue
        // est ignore ». Plus aucune activite ne declare de maximum (le Fun Run
        // etait le seul, il declare desormais une installation de 5 places et
        // un groupe qui tourne : journal 321). Muter la garde ne fait donc
        // tomber aucun verdict, et une sonde aveugle est un echec, pas une
        // reussite. La garde reste dans le module, et le montage de [I] verifie
        // qu elle y est ecrite deux fois. Le jour ou une activite declarera un
        // maximum, cette mutation revient telle quelle.
        ...[].concat([]),
        ...(false ? [{
          nom: 'le maximum du groupe declare au catalogue est ignore',
          vise: /\[I\] LE MAXIMUM DU GROUPE EST RESPECTE/,
          serveur: [{ fichier: COMPLEMENTS, de: '    if (Number.isFinite(maximum) && maximum > 0 && context.pax > maximum) continue;', vers: '    if (false && Number.isFinite(maximum) && maximum > 0 && context.pax > maximum) continue;' }],
        }] : []),
        {
          nom: 'la dotation declaree est ignoree (le groupe tournerait)',
          vise: /\[I\] LA DOTATION DECLAREE EST RESPECTEE/,
          serveur: [{ fichier: COMPLEMENTS, de: '    if (ligne.rotation === true) continue;', vers: '    if (false && ligne.rotation === true) continue;' }],
        },
      ]),
    propriete('K', 'UNE DUREE HORS GRILLE NE SE PROPOSE PAS',
      async () => mesurerK(),
      jugerK,
      [
        {
          nom: 'le derivateur invente le premier palier de la grille',
          vise: /\[K\] UNE DUREE HORS GRILLE NE SE PROPOSE PAS/,
          serveur: [{ fichier: COMPLEMENTS, de: '    const palier = DURATION_OPTIONS.find((item) => Math.round(Number(item.value) * 60) === minutes) || null;', vers: '    const palier = DURATION_OPTIONS.find((item) => Math.round(Number(item.value) * 60) === minutes) || DURATION_OPTIONS[0];' }],
        },
      ]),
    propriete('L', 'UNE OFFRE D ATTENTE NE S ACQUIERT QUE POSEE PAR LE SERVEUR',
      async () => mesurerL(browser),
      jugerL,
      [
        {
          nom: 'le tunnel adopte une offre d attente que le serveur n a pas posee',
          vise: /\[L\] UNE OFFRE D ATTENTE QUE LE SERVEUR NE POSE PAS SE RETIRE/,
          client: [{ fichier: APP, de: "    if (carte.kind === 'attente' && !lignesRendues.some(item => item && item.waitOffer === true && item.activityId === cible)) {", vers: '    if (false) {' }],
        },
      ]),
    propriete('J', 'LA COLONNE DE TEXTE D UNE CARTE GARDE UNE LARGEUR UTILISABLE',
      async () => mesurerJ(browser),
      jugerJ,
      [
        {
          nom: 'la carte reste en trois colonnes sur un telephone (la colonne de texte est ecrasee)',
          vise: /\[J\] 390x844 .* la colonne de texte occupe au moins la moitie/,
          client: [{ fichier: CSS, de: '  #clientView .complement-copy { grid-column: 1 / -1; }', vers: '  #clientView .complement-copy { grid-column: auto; }' }],
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
          const jouerUneFois = async () => p.juger(await p.mesurer());
          // UNE ATTENTE QUI EXPIRE N EST PAS UN VERDICT. Sous mutation, le parcours
          // rejoue des allers-retours de disponibilite, et une course avec fetchSlots
          // (qui vide state.availableSlots pendant que le gate attend qu il se
          // remplisse) peut faire expirer une attente de 20 s : mesure du 2026-09-05,
          // un passage sur trois, jamais au meme endroit, jamais en phase normale, et
          // la requete elle-meme coute 25 ms. On rejoue UNE fois, et on le dit ; un
          // second echec reste un echec.
          const jouer = async () => {
            try { return await jouerUneFois(); } catch (error) {
              if (!/Timeout/i.test(String(error && error.message))) throw error;
              console.log(`      (mutation ${p.cle}) attente expiree (${String(error.message).split(String.fromCharCode(10))[0].slice(0, 80)}), mesure rejouee une fois`);
              return jouerUneFois();
            }
          };
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
            : `LA SONDE EST AVEUGLE sur ce point : ${tombes.length} verdict(s) tombe(s), aucun ne vise la propriete : ${tombes.map((v) => `${v.label}${v.detail ? ` (${String(v.detail).slice(0, 160)})` : ''}`).join(' · ') || 'rien n est tombe'}`);
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

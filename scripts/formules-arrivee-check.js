'use strict';
// LA FORMULE PAR HEURE D ARRIVEE (2026-10-12).
//
// Le gerant de Fun Galaxy Libramont : un groupe de 10 prend une formule et veut
// arriver a 10:00, le bowling et le laser sont complets jusqu a 10:30 (ou
// 12:00). Le groupe commence par le libre de la formule (arcades, boissons,
// minigolf), puis joue au bowling et au laser des qu ils sont libres, dans des
// bornes reglables par le centre (attente sans activite, duree de la visite,
// duree retenue pour le minigolf). Sans heure d arrivee, rien ne change.
//
// Ce gate joue le vrai code en processus (handlers HTTP appeles sans reseau,
// base simulee en memoire, aucune ecriture) :
//   [A] sans heure d arrivee, rien ne change : aucune cle d arrivee dans les
//       reponses, reponses identiques octet pour octet quel que soit le
//       reglage d arrivee du centre, duree du libre par defaut egale a la
//       duree historique, signature d une demande sans arrivee inchangee ;
//   [B] F1, 10 personnes, pistes et arene pleines de 10:00 a 10:30, arrivee
//       10:00 : l accueil, les boissons, bowling 10:30, laser apres, les
//       arcades juste apres lui (rien pendant l accueil, 2026-10-13) ;
//   [C] pleines jusqu a 12:00 : l attente depasse la borne, l arrivee se
//       reserve quand meme et l avis dit pourquoi (Movsar, 2026-10-13 : « on
//       peut prendre l heure qu on veut, juste si c est vraiment impossible on
//       peut pas, et si y a un petit probleme tu le notifies ») ;
//   [D] la borne de duree de la visite, explicite puis automatique : un avis,
//       jamais un refus ;
//   [E] la duree du minigolf (freeDurationPolicy) deplace la fin d une
//       formule avec minigolf, aux deux endroits ou le moteur la lit ;
//   [F] le POST avec preference.arrivalTime : dossier coherent, signature,
//       modification au comptoir, alternatives d une arrivee refusee ;
//   [G] la liste des arrivees et le POST disent le meme verdict pour chaque
//       heure, blocages du planning compris ;
//   [H] arrivalFirst false coupe l arrivee ; heure illisible, hors grille ou
//       apres une ancre deja posee ; une ancre posee pendant les dix minutes
//       d accueil (2026-10-13) ;
//   [I] le reglage traverse normalizeCenterConfig, toEditableConfig,
//       projectCenterRow et son repli, la meta publique et le moteur ;
//   [K] (2026-10-13) la reponse d une arrivee porte la grille du bowling et
//       du laser, jugee avec elle : chaque heure dit ce que sa demande dira,
//       « serré » compris, le soir aussi, et avec une partie de laser deja
//       posee (Formule 4) ; une heure avant l arrivee ou pendant son accueil
//       se prend et avance l arrivee ; ses heures proposees sont celles du
//       plan de l arrivee, aucune quand elle est refusee ; la liste des
//       arrivees se juge avec les heures posees apres chacune, celles d avant
//       se liberent (le dernier choix gagne).
//   [L] (2026-10-13) les arcades a leur heure : jamais pendant l accueil,
//       choisies par le client (le bowling et le laser se placent autour),
//       refusees sur une activite posee ou pendant l accueil, leur grille
//       (arcades=1, de la fin de l accueil puis les demi-heures) qui libere
//       l activite posee qu elle chevauche, le bowling
//       pose sur elles qui les decale, la liste des arrivees qui les libere,
//       la partie de laser a la suite apres elles ; l attente qui dit son
//       trou, l arrivee plus tard que le serveur verifie ; le POST, la
//       signature et la modification au comptoir.
//   --mutate : une mutation EN MEMOIRE par regle (crochet de compilation, le
//       disque n est jamais ecrit, son empreinte est comparee avant et apres) ;
//       chacune doit faire rougir ce gate.
//   --base <commit> : [A+] la matrice sans arrivee jouee sur les sources du
//       commit (lib/ et api/), puis sur l arbre de travail, octet pour octet.
//
// Lancement : node scripts/formules-arrivee-check.js [--mutate] [--base <commit>]

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Module = require('module');
const { Readable } = require('stream');
const { execFileSync } = require('child_process');

for (const cle of Object.keys(process.env)) {
  if (/(^PG|DATABASE|POSTGRES|RESEND|SECRET|TOKEN|API_KEY|PASSWORD|PASSPHRASE)/i.test(cle)) delete process.env[cle];
}
process.env.PINLANE_CALENDAR_SYNC = 'off';

const ROOT = path.resolve(__dirname, '..');
const CENTRE = 'libramont';
const PAX = 10;
const ARGS = process.argv.slice(2);
const MUTATE = ARGS.includes('--mutate');
const BASE = (() => {
  const rang = ARGS.indexOf('--base');
  return rang >= 0 ? String(ARGS[rang + 1] || '').trim() : '';
})();

let echecs = 0;
function ok(cond, label, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail ? `\n      ${detail}` : ''}`);
  if (!cond) echecs += 1;
  return Boolean(cond);
}
function section(titre) { console.log(`\n[${titre}]`); }

// Un scenario rend une liste de verdicts ; le meme scenario sert au passage
// normal et aux contre-epreuves (qui ne regardent que s il rougit).
function verdict(cond, label, detail = '') {
  return { ok: Boolean(cond), label, detail: cond ? '' : String(detail || '') };
}
function rapporter(verdicts) {
  verdicts.forEach((item) => ok(item.ok, item.label, item.detail));
}

const minutesDe = (hhmm) => {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  return h * 60 + m;
};
const heureDe = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
// Le libelle d une duree tel que le moteur l ecrit (1 h 20, 50 min, 2 h).
function libelleDuree(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const heures = Math.floor(total / 60);
  const reste = total % 60;
  if (!heures) return `${reste} min`;
  return reste ? `${heures} h ${String(reste).padStart(2, '0')}` : `${heures} h`;
}

// ---------------------------------------------------------------------------
// LE CROCHET DE COMPILATION, pose avant tout require du code : la contre-
// epreuve remplace UNE ancre au moment ou Node compile le fichier (jamais sur
// le disque), l option --base substitue les sources du commit donne.
// ---------------------------------------------------------------------------
let ACTIVES = [];
let SOURCES_BASE = null;
const compiler = Module.prototype._compile;
Module.prototype._compile = function compilerAvecMutation(source, fichier) {
  const rel = path.relative(ROOT, fichier).split(path.sep).join('/');
  let texte = SOURCES_BASE && SOURCES_BASE.has(rel) ? SOURCES_BASE.get(rel) : source;
  ACTIVES.forEach((mutation) => {
    if (mutation.fichier !== rel) return;
    const fin = texte.includes('\r\n') ? '\r\n' : '\n';
    const de = mutation.de.split('\n').join(fin);
    const vers = mutation.vers.split('\n').join(fin);
    mutation.trouvee = texte.split(de).length - 1;
    if (mutation.trouvee === 1) {
      texte = texte.split(de).join(vers);
      mutation.appliquee += 1;
    }
  });
  return compiler.call(this, texte, fichier);
};

// ---------------------------------------------------------------------------
// LA BASE SIMULEE : les dossiers du jour, les blocages du planning, et ce que
// la creation recoit. Lue par readAvailabilitySnapshot (la liste) et par
// readStaffState (le POST), qui, comme en production, ne porte pas les
// blocages : le POST les lit a part.
// ---------------------------------------------------------------------------
const ETAT = { reservations: [], blocks: [], creees: [], recu: null, prochain: 7000 };
let DATE = '';

function reservationsDuJour(date = DATE, centerId = CENTRE) {
  return [...ETAT.reservations, ...ETAT.creees].filter((r) => r.date === date && (r.centerId || CENTRE) === centerId);
}
function poserEtat({ reservations = [], blocks = [] } = {}) {
  ETAT.reservations = reservations;
  ETAT.blocks = blocks;
  ETAT.creees = [];
  ETAT.recu = null;
}

function mock(rel, exports) {
  const resolu = require.resolve(path.join(ROOT, rel));
  require.cache[resolu] = { id: resolu, filename: resolu, loaded: true, exports };
}
function purger() {
  Object.keys(require.cache)
    .filter((cle) => cle.startsWith(ROOT) && !cle.includes(`${path.sep}node_modules${path.sep}`))
    .forEach((cle) => { delete require.cache[cle]; });
}

// Un handler HTTP appele en memoire : la requete est un flux (le corps d un
// POST se lit par `for await`), la reponse garde son corps BRUT.
function appeler(handler, method, chemin, params = null, corps = null) {
  const query = params
    ? new URLSearchParams(Object.entries(params)
      .filter(([, valeur]) => valeur !== undefined && valeur !== null && valeur !== '')
      .map(([cle, valeur]) => [cle, typeof valeur === 'string' ? valeur : JSON.stringify(valeur)])).toString()
    : '';
  const req = Readable.from(corps ? [Buffer.from(JSON.stringify(corps))] : []);
  Object.assign(req, {
    method,
    url: `${chemin}${query ? `?${query}` : ''}`,
    headers: { host: 'interne', 'x-forwarded-for': 'gate', 'content-type': 'application/json', 'user-agent': 'gate' },
  });
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      entetes: {},
      setHeader(cle, valeur) { this.entetes[String(cle).toLowerCase()] = valeur; },
      getHeader(cle) { return this.entetes[String(cle).toLowerCase()]; },
      writeHead(code) { this.statusCode = code; return this; },
      end(body) {
        const texte = String(body || '');
        let json = null;
        try { json = JSON.parse(texte); } catch (error) { json = null; }
        resolve({ status: this.statusCode, body: texte, json });
      },
    };
    Promise.resolve()
      .then(() => handler(req, res))
      .catch((error) => resolve({ status: 500, body: String((error && error.stack) || error), json: null }));
  });
}

// Le code, recharge a neuf (une contre-epreuve le recharge mute).
function charger() {
  purger();
  mock('lib/rate-limit', {
    enforceRateLimit: () => false,
    checkRateLimit: () => ({ allowed: true, remaining: 999, retryAfterSeconds: 0 }),
    getClientIp: () => 'gate',
  });
  const database = require(path.join(ROOT, 'lib/database.js'));
  const lire = async (date, centerId = CENTRE) => ({ date, centerId, laneStatuses: {}, reservations: reservationsDuJour(date, centerId), blocks: ETAT.blocks });
  database.readAvailabilitySnapshot = lire;
  database.readStaffState = async (date, centerId = CENTRE) => {
    const { blocks: _blocks, ...etat } = await lire(date, centerId);
    return etat;
  };
  database.createOpsEvent = async () => ({});
  database.readUpsellSlotHold = async () => null;
  database.readMatchingSlotHold = async () => null;
  database.reservationDejaConfirmee = async () => null;
  // La creation : la validation de la base (sous verrou en production), puis
  // la ligne telle que la base la normalise.
  database.createReservation = async (payload) => {
    ETAT.recu = payload;
    const valide = database.validateReservationResources({ ...payload }, reservationsDuJour(payload.date, payload.centerId), {}, ETAT.blocks, payload.date);
    ETAT.prochain += 1;
    const ligne = { ...valide.payload, id: ETAT.prochain, date: payload.date, centerId: payload.centerId, status: 'confirmed', signatureDemande: payload.signatureDemande };
    ETAT.creees.push(ligne);
    return ligne;
  };
  const journal = require(path.join(ROOT, 'lib/audit-log.js'));
  journal.writeAuditLog = async () => ({ ok: true, id: null, warning: null });
  const rops = require(path.join(ROOT, 'lib/reservation-ops.js'));
  rops.afterReservationCreated = async () => ({ communications: [], warnings: [] });
  const disponibilite = require(path.join(ROOT, 'api/public-availability.js'));
  const reservationsApi = require(path.join(ROOT, 'api/public-reservations.js'));
  const meta = require(path.join(ROOT, 'api/public-booking-meta.js'));
  return {
    database,
    rops,
    engine: require(path.join(ROOT, 'lib/ops-engine.js')),
    knowledge: require(path.join(ROOT, 'lib/ops-knowledge.js')),
    bookingConfig: require(path.join(ROOT, 'lib/booking-config.js')),
    centerConfig: require(path.join(ROOT, 'lib/center-config.js')),
    centerScope: require(path.join(ROOT, 'lib/center-scope.js')),
    demande: require(path.join(ROOT, 'lib/demande-publique.js')),
    visite: () => require(path.join(ROOT, 'lib/formula-visit.js')),
    get: (params) => appeler(disponibilite, 'GET', '/api/public-availability', { centerId: CENTRE, date: DATE, pax: String(PAX), ...params }),
    meta: (params) => appeler(meta, 'GET', '/api/public-booking-meta', { centerId: CENTRE, ...params }),
    post: (corps) => appeler(reservationsApi, 'POST', '/api/public-reservations', null, corps),
  };
}

// Le reglage d arrivee du centre, le temps d une mesure (override en memoire,
// comme la console le poserait en base).
async function avecReglage(H, formulaVisit, fn) {
  H.knowledge.applyCenterOverrides(new Map([[CENTRE, { formulaVisit }]]));
  try {
    return await fn();
  } finally {
    H.knowledge.applyCenterOverrides(new Map());
  }
}

// ---------------------------------------------------------------------------
// LES JOURNEES
// ---------------------------------------------------------------------------
let prochainId = 100;
// Les huit pistes et l arene (30 armes) prises sur [debut, fin).
function pleines(debut, fin) {
  const dossiers = [];
  const duree = (minutesDe(fin) - minutesDe(debut)) / 60;
  for (let piste = 1; piste <= 8; piste += 1) {
    prochainId += 1;
    dossiers.push({ id: prochainId, centerId: CENTRE, date: DATE, startTime: debut, duration: duree, totalDuration: duree, pax: 6, lanes: [piste], laneCount: 1, type: 'bowling', status: 'confirmed', validationStatus: 'confirmed', program: null, opsPlan: null });
  }
  for (let t = minutesDe(debut); t < minutesDe(fin); t += 30) {
    prochainId += 1;
    dossiers.push({ id: prochainId, centerId: CENTRE, date: DATE, startTime: heureDe(t), duration: 0.5, pax: 30, type: 'laser', status: 'confirmed', validationStatus: 'confirmed', program: null,
      opsPlan: { resourceBlocks: [{ resourceType: 'laser_arena', activityId: 'laser_game', start: t, end: t + 25, startTime: heureDe(t), endTime: heureDe(t + 25), players: 30 }] } });
  }
  return dossiers;
}
// Des blocages du planning sur [debut, fin) : les huit pistes une a une et le
// laser (portee activite), ou l activite bowling entiere.
function blocagesPistesEtLaser(debut, fin) {
  const blocs = [];
  for (let piste = 1; piste <= 8; piste += 1) {
    blocs.push({ id: 500 + piste, centerId: CENTRE, date: DATE, scopeType: 'lane', scopeRef: String(piste), startMin: minutesDe(debut), endMin: minutesDe(fin), recurrence: 'once', reason: 'Entretien' });
  }
  blocs.push({ id: 520, centerId: CENTRE, date: DATE, scopeType: 'activity', scopeRef: 'laser_game', startMin: minutesDe(debut), endMin: minutesDe(fin), recurrence: 'once', reason: 'Entretien' });
  return blocs;
}
function blocageBowling(debut, fin) {
  return [{ id: 530, centerId: CENTRE, date: DATE, scopeType: 'activity', scopeRef: 'bowling', startMin: minutesDe(debut), endMin: minutesDe(fin), recurrence: 'once', reason: 'Entretien' }];
}

// Un samedi a plus d une semaine, au fuseau du centre, ou F1 et F3 se vendent
// et ou le centre ouvre a 10:00 au plus tard.
function choisirDate(H) {
  const centre = H.knowledge.getCenter(CENTRE);
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).split('-').map(Number);
  const curseur = new Date(Date.UTC(y, m - 1, d + 8));
  for (let essai = 0; essai < 200; essai += 1) {
    const jour = curseur.toISOString().slice(0, 10);
    const horaire = curseur.getUTCDay() === 6 ? H.bookingConfig.getSchedule(jour, centre) : null;
    const vendues = ['f1', 'f3'].every((id) => {
      const formule = H.bookingConfig.FORMULES.find((item) => item.id === id);
      return formule && H.bookingConfig.getFormuleAvailability(formule, jour, PAX, '', centre).ok;
    });
    if (horaire && Number(horaire.open) <= 10 && Number(horaire.close) >= 22 && vendues && !H.bookingConfig.isFormulaBlockedDate(jour, centre)) return jour;
    curseur.setUTCDate(curseur.getUTCDate() + 1);
  }
  return '';
}

const CONTACT = { name: 'Groupe Gate', email: 'gate@exemple.be', phone: '+32470000000' };
// Les durees que le formulaire envoie avec une formule (celles de la reponse
// des disponibilites : `duration`, `totalDuration`), lues au catalogue.
const DUREES = new Map();
function retenirDurees(H) {
  H.bookingConfig.FORMULES.forEach((formule) => {
    DUREES.set(formule.id, {
      duration: Number(H.bookingConfig.getFormuleLaneDuration(formule)) || 1,
      totalDuration: Number(H.bookingConfig.getFormuleTotalDuration(formule)) || 1,
    });
  });
}
function corpsFormule(formuleId, heure, preference = {}) {
  return { centerId: CENTRE, date: DATE, startTime: heure, type: 'formule', formuleId, pax: PAX, ...(DUREES.get(formuleId) || { duration: 1, totalDuration: 1 }), ...CONTACT, preference };
}

// LE COEUR DU POST : prepareReservationOps sur le canal public, l etat lu
// comme en production (sans blocages), les blocages lus a part ; puis la
// validation de la creation sur le dossier qu elle recevrait.
async function verdictDuPost(H, corps, canal = 'public') {
  const ops = await H.rops.prepareReservationOps(corps, canal, {
    readState: async (date, centerId) => {
      const { blocks: _blocks, ...etat } = { date, centerId, laneStatuses: {}, reservations: reservationsDuJour(date, centerId), blocks: ETAT.blocks };
      return etat;
    },
    readBlocks: async () => ETAT.blocks,
  });
  if (ops.blockOnlineConfirmation || !ops.opsPlan) return { ok: false, raison: ops.planRefusal || '', ops };
  const pistes = Array.isArray(ops.opsPlan.assignedLanes) ? ops.opsPlan.assignedLanes : [];
  try {
    H.database.validateReservationResources({ ...corps, ...ops, ...(pistes.length ? { lanes: pistes } : {}), channel: canal }, reservationsDuJour(), {}, ETAT.blocks, DATE);
    return { ok: true, raison: '', ops };
  } catch (error) {
    return { ok: false, raison: String((error && error.message) || error), ops };
  }
}

const heuresDuPlan = (plan) => JSON.stringify((plan && plan.anchorPlan && plan.anchorPlan.times) || {});
const arriveeDe = (rep) => (rep && rep.json && rep.json.arrival) || {};

// ---------------------------------------------------------------------------
// [A] SANS HEURE D ARRIVEE, RIEN NE CHANGE
// ---------------------------------------------------------------------------
const CLES_ARRIVEE = new Set(['arrivalPlan', 'arrivals', 'arrivalBounds', 'firstAcceptableArrival', 'arrival']);
function clesArrivee(valeur, chemin = '$', trouvees = []) {
  if (Array.isArray(valeur)) valeur.forEach((item, rang) => clesArrivee(item, `${chemin}[${rang}]`, trouvees));
  else if (valeur && typeof valeur === 'object') {
    Object.keys(valeur).forEach((cle) => {
      if (CLES_ARRIVEE.has(cle)) trouvees.push(`${chemin}.${cle}`);
      clesArrivee(valeur[cle], `${chemin}.${cle}`, trouvees);
    });
  }
  return trouvees;
}

// Les cles dont le corps differe d une mesure a l autre ; une cle absente d un
// cote compte comme un ecart.
function ecartsEntre(gauche, droite) {
  const corpsGauche = new Map(gauche.map((item) => [item.cle, item.body]));
  const corpsDroite = new Map(droite.map((item) => [item.cle, item.body]));
  const cles = new Set([...corpsGauche.keys(), ...corpsDroite.keys()]);
  return [...cles].filter((cle) => corpsGauche.get(cle) !== corpsDroite.get(cle));
}

// Les demandes SANS arrivee : la liste du formulaire (formules, avec ou sans
// heure posee), une visite, un bowling.
function matriceGet() {
  const demandes = [];
  ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'hlg'].forEach((formuleId) => {
    demandes.push({ type: 'formule', formuleId });
    demandes.push({ type: 'formule', formuleId, preferredTimes: { bowling: '15:00' } });
    demandes.push({ type: 'formule', formuleId, preferredTimes: { laser_game: '16:00' }, laserGameTimes: ['16:00'] });
  });
  demandes.push({ type: 'bowling', pax: '6', duration: '1' });
  demandes.push({ type: 'visite', pax: '8', program: [{ activityId: 'bowling', duration: 1 }, { activityId: 'laser_game', games: 1 }, { activityId: 'arcade_time' }] });
  return demandes;
}
function matricePost() {
  const corps = [];
  ['f1', 'f3', 'f4', 'f5'].forEach((formuleId) => {
    corps.push(corpsFormule(formuleId, '15:00'));
    corps.push(corpsFormule(formuleId, '15:00', { preferredTimes: { bowling: '15:00', laser_game: '16:30' }, laserGameTimes: ['16:30'], laserPlacement: 'scheduled', arrivalConfidence: 'normal' }));
  });
  return corps;
}
const JOURNEES_A = () => [['vide', { reservations: [] }], ['pleines 10:00-10:30', { reservations: pleines('10:00', '10:30') }]];

async function mesurerSansArrivee(H) {
  const corpsGet = [];
  const corpsPost = [];
  for (const [nom, journee] of JOURNEES_A()) {
    poserEtat(journee);
    for (const demande of matriceGet()) {
      const rep = await H.get(demande);
      corpsGet.push({ cle: `${nom} GET ${JSON.stringify(demande)}`, status: rep.status, body: rep.body, json: rep.json });
    }
    for (const corps of matricePost()) {
      const ops = await H.rops.prepareReservationOps(corps, 'public', {});
      corpsPost.push({ cle: `${nom} POST ${corps.formuleId} ${JSON.stringify(corps.preference)}`, body: JSON.stringify(ops), json: ops });
    }
    // Les modifications au comptoir d un dossier SANS arrivee : sans changer
    // l heure, decale d une demi-heure, puis avec son programme (formule
    // adaptee a son contenu).
    const pose = await H.rops.prepareReservationOps(corpsFormule('f1', '15:00'), 'public', {});
    if (pose.opsPlan) {
      const dossier = { ...corpsFormule('f1', pose.startTime || '15:00'), id: 8001, opsPlan: pose.opsPlan, ignoreReservationId: 8001 };
      const programme = [
        { activityId: 'bowling', duration: 1, participants: PAX },
        { activityId: 'laser_game', games: 1, participants: PAX },
        { activityId: 'arcade_time', participants: PAX },
      ];
      for (const [cle, modif] of [['meme heure', {}], ['decale', { startTime: heureDe(minutesDe(dossier.startTime) + 30) }], ['programme', { program: programme }]]) {
        const ops = await H.rops.prepareReservationOps({ ...dossier, ...modif }, 'staff', {});
        corpsPost.push({ cle: `${nom} MODIF ${cle}`, body: JSON.stringify(ops), json: ops });
      }
    }
  }
  const signatures = matricePost().map((corps) => H.demande.signatureDemande(corps));
  return { corpsGet, corpsPost, signatures };
}

async function scenarioA(H) {
  const v = [];
  const premiere = await mesurerSansArrivee(H);
  const seconde = await mesurerSansArrivee(H);
  // Les comparaisons se font cle par cle : chaque cle doit etre unique.
  const unique = (liste) => new Set(liste.map((item) => item.cle)).size === liste.length;
  const deterministe = unique(premiere.corpsGet) && unique(premiere.corpsPost)
    && ecartsEntre(premiere.corpsGet, seconde.corpsGet).length === 0
    && ecartsEntre(premiere.corpsPost, seconde.corpsPost).length === 0;
  v.push(verdict(deterministe, `MONTAGE deux passes identiques octet pour octet (${premiere.corpsGet.length} GET, ${premiere.corpsPost.length} POST)`));
  const servies = premiere.corpsGet.filter((item) => item.status === 200 && item.json && Array.isArray(item.json.slots) && item.json.slots.length).length;
  v.push(verdict(servies >= 10, `MONTAGE la matrice sert des creneaux (${servies} reponses avec creneaux)`));
  // Le prerequis du coeur du POST : sur la journee vide, chaque formule
  // demandee a 15:00 sans heure posee recoit son plan.
  const posees = premiere.corpsPost.filter((item) => item.cle.startsWith('vide POST') && item.cle.endsWith(' {}'));
  const planifiees = posees.filter((item) => item.json && item.json.opsPlan && !item.json.blockOnlineConfirmation);
  v.push(verdict(posees.length >= 4 && planifiees.length === posees.length, `MONTAGE le coeur du POST planifie chaque formule demandee sans heure posee sur la journee vide (${planifiees.length}/${posees.length})`,
    posees.filter((item) => !planifiees.includes(item)).map((item) => `${item.cle} : ${item.json && item.json.planRefusal}`).join(' | ')));
  const fuites = [...premiere.corpsGet, ...premiere.corpsPost]
    .map((item) => ({ cle: item.cle, cles: clesArrivee(item.json) }))
    .filter((item) => item.cles.length);
  v.push(verdict(fuites.length === 0, 'aucune reponse sans arrivee ne porte de cle d arrivee (arrival, arrivals, arrivalPlan, arrivalBounds, firstAcceptableArrival)',
    fuites.slice(0, 3).map((item) => `${item.cle} : ${item.cles.slice(0, 3).join(', ')}`).join(' | ')));
  const autreReglage = await avecReglage(H, { arrivalFirst: false, maxWaitMinutes: 0, maxVisitMinutes: 60 }, () => mesurerSansArrivee(H));
  const ecarts = [
    ...ecartsEntre(premiere.corpsGet, autreReglage.corpsGet),
    ...ecartsEntre(premiere.corpsPost, autreReglage.corpsPost),
  ];
  v.push(verdict(ecarts.length === 0, 'les reponses sans arrivee sont identiques octet pour octet, que le centre coupe l arrivee ou serre ses bornes', ecarts.slice(0, 3).join(' | ')));
  // La duree du libre par defaut : la formule d avant le reglage, etape par
  // etape, pour chaque formule du catalogue.
  const { freeStepMinutes, formulaVisitOf } = H.visite();
  const politique = formulaVisitOf(H.knowledge.getCenter(CENTRE)).freeDurationPolicy;
  const differences = [];
  H.knowledge.loadOpsKnowledge().formulas.forEach((formule) => {
    (formule.steps || []).forEach((etape) => {
      const activite = etape.activityId ? H.knowledge.loadOpsKnowledge().activityById.get(etape.activityId) : null;
      const modele = (activite && activite.durationModel) || {};
      const historique = Number(etape.durationMinutes || modele.defaultMinutes || modele.gameMinutes || 30);
      const retenue = freeStepMinutes(etape, modele, politique);
      if (retenue !== historique) differences.push(`${formule.id}/${etape.activityId} ${retenue} au lieu de ${historique}`);
    });
  });
  v.push(verdict(politique === 'default' && differences.length === 0, `sans reglage, la duree retenue pour chaque activite libre est la duree d avant (politique ${politique})`, differences.slice(0, 4).join(' | ')));
  const sansArrivee = JSON.parse(H.demande.signatureDemande(corpsFormule('f1', '10:00', { preferredTimes: { bowling: '10:30' } })));
  const avecArrivee = JSON.parse(H.demande.signatureDemande(corpsFormule('f1', '10:00', { preferredTimes: { bowling: '10:30' }, arrivalTime: '10:00' })));
  v.push(verdict(sansArrivee.length === 11 && avecArrivee.length === 12 && JSON.stringify(avecArrivee.slice(0, 11)) === JSON.stringify(sansArrivee),
    'la signature d une demande sans arrivee garde ses 11 champs ; l arrivee s ajoute en 12e, le reste identique', JSON.stringify([sansArrivee.length, avecArrivee.length])));
  return v;
}

// ---------------------------------------------------------------------------
// [B] ARRIVER A 10:00 QUAND TOUT EST PRIS JUSQU A 10:30
// ---------------------------------------------------------------------------
async function scenarioB(H) {
  const v = [];
  poserEtat({ reservations: pleines('10:00', '10:30') });
  const pose = await H.get({ type: 'formule', formuleId: 'f1', preferredTimes: { bowling: '10:00' } });
  v.push(verdict(pose.status === 200 && pose.json && pose.json.slots.length === 0, 'MONTAGE sans arrivee, le bowling de 10:00 est refuse (pistes prises)', pose.json && pose.json.message));
  const rep = await H.get({ type: 'formule', formuleId: 'f1', arrival: '10:00' });
  const arrivee = arriveeDe(rep);
  const slot = (rep.json && rep.json.slots && rep.json.slots[0]) || null;
  const plan = (slot && slot.opsPlan) || {};
  v.push(verdict(rep.status === 200 && arrivee.ok === true && slot && slot.time === '10:00', 'arriver a 10:00 se reserve : un creneau a 10:00', `${rep.status} ${arrivee.code || ''} ${arrivee.reason || ''}`));
  const heures = arrivee.anchors || {};
  v.push(verdict(heures.bowling === '10:30', 'le bowling est pose a 10:30, des que les pistes se liberent', JSON.stringify(heures)));
  v.push(verdict(heures.laser_game && minutesDe(heures.laser_game) >= minutesDe('11:30'), 'le laser vient apres le bowling (11:30 au plus tot)', JSON.stringify(heures)));
  // RIEN PENDANT L ACCUEIL (Movsar, 2026-10-13 : « pourquoi tu mets
  // automatiquement l heure d arrivee a arcade ») : de 10:10 a 10:30, vingt
  // minutes ne tiennent pas les 30 minutes d arcades ; les boissons s y font,
  // les arcades passent juste apres le laser.
  const avant = arrivee.before || [];
  v.push(verdict(avant.length > 0 && avant.every((item) => item.activityId === 'service_drinks'),
    'avant le bowling, les boissons seulement : les 20 minutes d apres l accueil ne tiennent pas les arcades', JSON.stringify(avant)));
  v.push(verdict(arrivee.waitMinutes === 10, '10 minutes d attente : le trou de 10:10 a 10:30, moins les boissons', String(arrivee.waitMinutes)));
  const frise = arrivee.frise || [];
  const arcadesFrise = frise.find((segment) => segment.activityId === 'arcade_time') || {};
  const laserFrise = frise.find((segment) => segment.kind === 'anchor' && segment.activityId === 'laser_game') || {};
  v.push(verdict(frise.every((segment) => !segment.startTime || minutesDe(segment.startTime) >= minutesDe('10:10'))
    && arcadesFrise.placement === 'after' && Boolean(arcadesFrise.startTime) && arcadesFrise.startTime === laserFrise.endTime,
  `la frise : rien avant 10:10, les arcades juste apres le laser (${arcadesFrise.startTime})`, JSON.stringify(frise)));
  // L ACCUEIL D ABORD (Movsar, 2026-10-13 : l arrivee « 10 min avant
  // (accueil) », partout) : l accueil commence a l heure choisie, jamais dix
  // minutes avant, et la premiere activite a heure fixe vient apres lui.
  const accueil = (plan.timeline || []).find((etape) => etape.label === 'Arrivée & accueil') || null;
  v.push(verdict(plan.startTime === '10:00' && plan.arrivalPlan && plan.arrivalPlan.arrivalTime === '10:00' && plan.arrivalTime === '10:00'
    && accueil && accueil.startTime === '10:00' && accueil.endTime === '10:10',
  'le plan commence a l arrivee (10:00), l accueil aussi (10:00 a 10:10), jamais dix minutes avant l heure choisie',
  `${plan.startTime} ${plan.arrivalPlan && plan.arrivalPlan.arrivalTime} ${plan.arrivalTime} accueil ${accueil && `${accueil.startTime}-${accueil.endTime}`}`));
  // Sur une journee libre, rien ne se pose pendant l accueil : arriver a 10:00
  // donne les arcades d abord, le bowling a 10:30.
  poserEtat({ reservations: [] });
  const libre = arriveeDe(await H.get({ type: 'formule', formuleId: 'f1', arrival: '10:00' }));
  const premiere = ((libre.frise || []).find((segment) => segment.kind === 'anchor') || {}).startTime || '';
  v.push(verdict(libre.ok === true && premiere && minutesDe(premiere) >= minutesDe('10:10') && (libre.anchors || {}).bowling === '10:30',
    'journee libre, arrivee 10:00 : la premiere activite a heure fixe vient apres les 10 minutes d accueil (bowling 10:30, pas 10:00)', JSON.stringify(libre.anchors)));
  poserEtat({ reservations: pleines('10:00', '10:30') });
  // Movsar, 2026-10-12 : les arcades ont une heure choisie, le planning de la
  // console doit les montrer a leur vraie heure ; le reste du libre garde le
  // pass de la visite.
  const arcades = (plan.timeline || []).find((etape) => etape.activityId === 'arcade_time');
  v.push(verdict(arcades && arcades.type === 'activity' && arcades.flexible === false && arcades.startTime === arcadesFrise.startTime && arcades.endTime === arcadesFrise.endTime,
    `les arcades sont une etape a heure du plan, celle de la frise (${arcadesFrise.startTime}-${arcadesFrise.endTime}), jamais pendant l accueil`, JSON.stringify(arcades && { type: arcades.type, flexible: arcades.flexible, startTime: arcades.startTime, endTime: arcades.endTime })));
  const boissons = (plan.timeline || []).filter((etape) => etape.activityId === 'service_drinks');
  v.push(verdict(boissons.length > 0 && boissons.every((etape) => etape.flexible === true && etape.startTime === '10:00' && etape.endTime === plan.arrivalPlan.endTime && !('plannedStartTime' in etape)),
    'les boissons gardent le pass de toute la visite, sans heure propre', JSON.stringify(boissons.map((etape) => [etape.flexible, etape.startTime, etape.endTime]))));
  const friseBoissons = frise.filter((segment) => segment.activityId === 'service_drinks');
  v.push(verdict(friseBoissons.length > 0 && friseBoissons.every((segment) => segment.timed === false && !('startTime' in segment)),
    'dans la frise, les boissons n ont pas d heure, seulement leur place', JSON.stringify(friseBoissons)));
  const bowling = (plan.resourceBlocks || []).find((bloc) => bloc.resourceType === 'bowling_lane');
  v.push(verdict(bowling && bowling.startTime === '10:30' && Array.isArray(bowling.lanes) && bowling.lanes.length > 0, 'les pistes du bowling sont posees a 10:30', JSON.stringify(bowling && { startTime: bowling.startTime, lanes: bowling.lanes })));
  v.push(verdict(slot && slot.visitEndTime === arrivee.endTime && arrivee.endTime === plan.arrivalPlan.endTime,
    'la fin annoncee est celle du programme, sans la marge de l equipe', `${slot && slot.visitEndTime} ${arrivee.endTime}`));
  return v;
}

// ---------------------------------------------------------------------------
// [C] PLEINES JUSQU A 12:00 : L ATTENTE DEPASSE LA BORNE, L ARRIVEE SE PREND
// ---------------------------------------------------------------------------
async function scenarioC(H) {
  const v = [];
  poserEtat({ reservations: pleines('10:00', '12:00') });
  const libre = H.engine.getFormulaAnchorModel(H.knowledge.getFormula('f1')).freeMinutes;
  const rep = await H.get({ type: 'formule', formuleId: 'f1', arrival: '10:00' });
  const arrivee = arriveeDe(rep);
  const avis = arrivee.warning || {};
  // L accueil n est pas de l attente : rien ne se fait pendant lui, le libre
  // de la formule commence apres (2026-10-13).
  const attendue = minutesDe('12:00') - minutesDe('10:00') - H.engine.FORMULA_ARRIVAL_MINUTES - libre;
  v.push(verdict(rep.status === 200 && rep.json.slots.length === 1 && arrivee.ok === true && avis.code === 'arrival_wait',
    'arriver a 10:00 se reserve, avec un avis d attente (plus aucun refus)', `${arrivee.code || ''} ${arrivee.reason || ''} ${JSON.stringify(avis)}`));
  v.push(verdict(arrivee.anchors && Object.values(arrivee.anchors).length === 2 && Math.min(...Object.values(arrivee.anchors).map(minutesDe)) === minutesDe('12:00'),
    'le bowling et le laser se jouent des qu ils sont libres (12:00)', JSON.stringify(arrivee.anchors)));
  v.push(verdict(avis.waitMinutes === attendue && arrivee.waitMinutes === attendue && avis.maxWaitMinutes === 30,
    `l attente sans activite vaut les deux heures prises moins l accueil et le libre de la formule (${attendue} min), la borne 30 min`, `${avis.waitMinutes} / ${arrivee.waitMinutes} / ${avis.maxWaitMinutes}`));
  v.push(verdict(String(avis.reason).includes('12:00') && String(avis.reason).includes(libelleDuree(attendue)) && /complets? jusqu’à 12:00/.test(String(avis.cause)) && !/arriver/i.test(String(avis.cause)),
    `l avis dit jusqu a quand c est complet (12:00) et l attente (${libelleDuree(attendue)}), sa cause sans l heure d arrivee`, `${avis.reason} | ${avis.cause}`));
  // LA TRANSACTION : le POST de cette arrivee cree le dossier, aux heures que
  // l ecran a montrees.
  const post = await verdictDuPost(H, corpsFormule('f1', '10:00', { arrivalTime: '10:00' }));
  v.push(verdict(post.ok === true && heuresDuPlan(post.ops.opsPlan) === JSON.stringify(arrivee.anchors || {}),
    'le POST de cette arrivee se reserve, aux heures montrees', post.ok ? heuresDuPlan(post.ops.opsPlan) : post.raison));
  const liste = await H.get({ type: 'formule', formuleId: 'f1', arrivals: '1' });
  const entrees = (liste.json && liste.json.arrivals) || [];
  const sansAvis = entrees.find((entree) => entree.ok && !entree.warning);
  const avant = entrees.filter((entree) => minutesDe(entree.time) < minutesDe('11:00'));
  v.push(verdict(sansAvis && sansAvis.time === '11:00' && avant.length === 2 && avant.every((entree) => entree.ok && entree.warning && entree.warning.code === 'arrival_wait' && entree.waitMinutes > 30),
    'la liste : 10:00 et 10:30 se prennent avec leur avis d attente, 11:00 est la premiere sans', JSON.stringify(entrees.slice(0, 3).map((entree) => [entree.time, entree.ok, entree.waitMinutes, entree.warning && entree.warning.code]))));
  v.push(verdict(sansAvis && sansAvis.waitMinutes <= 30, 'a 11:00 l attente tient dans la borne', sansAvis && String(sansAvis.waitMinutes)));
  v.push(verdict(liste.json.firstAcceptableArrival === '10:00', 'la premiere arrivee possible est 10:00, l attente ne la retire pas', String(liste.json.firstAcceptableArrival)));
  return v;
}

// ---------------------------------------------------------------------------
// [D] LA BORNE DE DUREE DE LA VISITE
// ---------------------------------------------------------------------------
async function scenarioD(H) {
  const v = [];
  poserEtat({ reservations: pleines('10:00', '10:30') });
  const mesuree = arriveeDe(await H.get({ type: 'formule', formuleId: 'f1', arrival: '10:00' }));
  const duree = Number(mesuree.visitMinutes);
  // LA DUREE NATURELLE, base de la borne automatique : la meme visite sans
  // son attente, accueil compris (rien ne se fait pendant lui, 2026-10-13).
  const naturelle = duree - Number(mesuree.waitMinutes);
  v.push(verdict(naturelle >= 60 && duree >= naturelle, `MONTAGE la visite dure ${duree} min, ${naturelle} sans son attente`));
  await avecReglage(H, { maxWaitMinutes: 120, maxVisitMinutes: duree }, async () => {
    poserEtat({ reservations: pleines('10:00', '10:30') });
    const pile = arriveeDe(await H.get({ type: 'formule', formuleId: 'f1', arrival: '10:00' }));
    v.push(verdict(pile.ok === true && !pile.warning, `borne de duree a ${duree} min : une visite qui dure exactement la borne passe, sans avis`, `${pile.code} ${pile.reason} ${JSON.stringify(pile.warning)}`));
    poserEtat({ reservations: pleines('10:00', '12:00') });
    const rep = await H.get({ type: 'formule', formuleId: 'f1', arrival: '10:00' });
    const arrivee = arriveeDe(rep);
    const avis = arrivee.warning || {};
    v.push(verdict(arrivee.ok === true && rep.json.slots.length === 1 && avis.code === 'arrival_visit' && avis.visitMinutes > duree && avis.maxVisitMinutes === duree,
      'attente acceptee (120 min), visite plus longue que la borne : elle se reserve avec un avis de duree', `${arrivee.code || ''} ${JSON.stringify(avis)}`));
    v.push(verdict(String(avis.reason).includes(libelleDuree(avis.visitMinutes)), 'l avis dit la duree de la visite', avis.reason));
    const entrees = ((await H.get({ type: 'formule', formuleId: 'f1', arrivals: '1' })).json || {}).arrivals || [];
    const sansAvis = entrees.find((entree) => entree.ok && !entree.warning);
    const avant = sansAvis ? entrees.filter((entree) => minutesDe(entree.time) < minutesDe(sansAvis.time)) : [];
    v.push(verdict(sansAvis && sansAvis.visitMinutes <= duree && avant.length > 0 && avant.every((entree) => entree.ok && entree.warning && entree.warning.code === 'arrival_visit'),
      `la premiere arrivee sans avis (${sansAvis && sansAvis.time}) tient dans la duree, les precedentes se prennent avec l avis de duree`, JSON.stringify(entrees.slice(0, 4).map((entree) => [entree.time, entree.ok, entree.warning && entree.warning.code, entree.visitMinutes]))));
  });
  // Automatique (0) : la duree naturelle plus deux heures.
  await avecReglage(H, { maxWaitMinutes: 240, maxVisitMinutes: 0 }, async () => {
    poserEtat({ reservations: pleines('10:00', '12:00') });
    const accepte = arriveeDe(await H.get({ type: 'formule', formuleId: 'f1', arrival: '10:00' }));
    v.push(verdict(accepte.ok === true && !accepte.warning && accepte.visitMinutes <= naturelle + 120, `borne automatique : ${accepte.visitMinutes} min tiennent sous ${naturelle} + 120, sans avis`, `${accepte.code} ${accepte.reason} ${JSON.stringify(accepte.warning)}`));
    poserEtat({ reservations: pleines('10:00', '14:00') });
    const longue = arriveeDe(await H.get({ type: 'formule', formuleId: 'f1', arrival: '10:00' }));
    const avisLong = longue.warning || {};
    v.push(verdict(longue.ok === true && avisLong.code === 'arrival_visit' && avisLong.maxVisitMinutes === naturelle + 120 && avisLong.waitMinutes <= 240,
      `borne automatique : pleines jusqu a 14:00, l attente passe (240), la visite depasse ${naturelle} + 120 : avis de duree`, `${longue.code || ''} ${JSON.stringify(avisLong)}`));
  });
  return v;
}

// ---------------------------------------------------------------------------
// [E] LA DUREE DU MINIGOLF
// ---------------------------------------------------------------------------
async function scenarioE(H) {
  const v = [];
  const modele = H.knowledge.loadOpsKnowledge().activityById.get('minigolf_blacklight').durationModel;
  v.push(verdict(modele && modele.type === 'open_range' && modele.minMinutes < modele.defaultMinutes && modele.defaultMinutes < modele.maxMinutes,
    `MONTAGE le minigolf a une duree ouverte (${modele && modele.minMinutes} / ${modele && modele.defaultMinutes} / ${modele && modele.maxMinutes} min)`));
  const fins = {};
  const sansAttente = {};
  const finsSansArrivee = {};
  const minigolf = {};
  for (const politique of ['min', 'default', 'max']) {
    await avecReglage(H, { freeDurationPolicy: politique }, async () => {
      poserEtat({ reservations: [] });
      const arrivee = arriveeDe(await H.get({ type: 'formule', formuleId: 'f3', arrival: '10:00' }));
      fins[politique] = arrivee.ok ? minutesDe(arrivee.endTime) : NaN;
      sansAttente[politique] = arrivee.ok ? Number(arrivee.visitMinutes) - Number(arrivee.waitMinutes) : NaN;
      minigolf[politique] = ((arrivee.frise || []).find((segment) => segment.activityId === 'minigolf_blacklight') || {}).minutes;
      const pose = await H.get({ type: 'formule', formuleId: 'f3', preferredTimes: { bowling: '15:00' } });
      const slot = pose.json && pose.json.slots && pose.json.slots[0];
      finsSansArrivee[politique] = slot ? minutesDe(slot.visitEndTime) : NaN;
    });
  }
  v.push(verdict(minigolf.min === modele.minMinutes && minigolf.default === modele.defaultMinutes && minigolf.max === modele.maxMinutes,
    'la frise retient la duree du reglage pour le minigolf', JSON.stringify(minigolf)));
  // La visite sans son attente bouge exactement de l ecart de duree du
  // minigolf ; la fin peut en perdre une part dans un trou de la grille des
  // demi-heures (le libre commence apres l accueil, 2026-10-13), jamais
  // reculer.
  v.push(verdict(sansAttente.default - sansAttente.min === modele.defaultMinutes - modele.minMinutes && sansAttente.max - sansAttente.default === modele.maxMinutes - modele.defaultMinutes
    && fins.min <= fins.default && fins.default <= fins.max,
    'arrivee 10:00, F3 : la visite sans son attente bouge exactement de l ecart de duree du minigolf, la fin ne recule jamais', JSON.stringify({ sansAttente, fins: Object.fromEntries(Object.entries(fins).map(([cle, fin]) => [cle, heureDe(fin)])) })));
  v.push(verdict(finsSansArrivee.default - finsSansArrivee.min === modele.defaultMinutes - modele.minMinutes && finsSansArrivee.max - finsSansArrivee.default === modele.maxMinutes - modele.defaultMinutes,
    'sans arrivee (bowling pose a 15:00), le meme ecart : le reglage vaut aux deux endroits ou le moteur lit le libre', JSON.stringify(Object.fromEntries(Object.entries(finsSansArrivee).map(([cle, fin]) => [cle, Number.isFinite(fin) ? heureDe(fin) : 'aucun'])))));
  poserEtat({ reservations: [] });
  const repSansReglage = await H.get({ type: 'formule', formuleId: 'f3', arrival: '10:00' });
  const sansReglage = arriveeDe(repSansReglage);
  v.push(verdict(minutesDe(sansReglage.endTime) === fins.default, 'sans reglage, la duree par defaut', sansReglage.endTime));
  // LE MINIGOLF N A PAS D HEURE (Movsar, 2026-10-12) : ni dans les etapes du
  // plan (le pass de la visite), ni dans la frise (sa duree seulement).
  const planF3 = ((repSansReglage.json && repSansReglage.json.slots && repSansReglage.json.slots[0]) || {}).opsPlan || {};
  const etapeMinigolf = (planF3.timeline || []).find((etape) => etape.activityId === 'minigolf_blacklight');
  v.push(verdict(etapeMinigolf && etapeMinigolf.flexible === true && etapeMinigolf.startTime === '10:00' && etapeMinigolf.endTime === sansReglage.endTime && !('plannedStartTime' in etapeMinigolf) && !('placement' in etapeMinigolf),
    'le minigolf reste le pass de toute la visite, sans heure propre', JSON.stringify(etapeMinigolf && { flexible: etapeMinigolf.flexible, startTime: etapeMinigolf.startTime, endTime: etapeMinigolf.endTime })));
  const segmentMinigolf = (sansReglage.frise || []).find((segment) => segment.activityId === 'minigolf_blacklight');
  v.push(verdict(segmentMinigolf && segmentMinigolf.timed === false && !('startTime' in segmentMinigolf) && segmentMinigolf.minutes === modele.defaultMinutes,
    'dans la frise, le minigolf n a que sa duree (celle du reglage), pas d heure', JSON.stringify(segmentMinigolf)));
  // ARCADES ET MINIGOLF DANS LA MEME ATTENTE : bowling pris jusqu a 11:30,
  // arrivee 10:00. Les arcades apres l accueil (10:10), le minigolf sans
  // heure avant le bowling.
  poserEtat({ reservations: pleines('10:00', '11:30') });
  const repAttente = await H.get({ type: 'formule', formuleId: 'f3', arrival: '10:00' });
  const attente = arriveeDe(repAttente);
  const planAttente = ((repAttente.json && repAttente.json.slots && repAttente.json.slots[0]) || {}).opsPlan || {};
  const arcadesF3 = (planAttente.timeline || []).find((etape) => etape.activityId === 'arcade_time');
  const avantF3 = (attente.before || []).map((item) => item.activityId);
  v.push(verdict(attente.ok === true && attente.anchors && attente.anchors.bowling === '11:30', 'F3, bowling pris jusqu a 11:30 : arriver a 10:00 se reserve, bowling a 11:30', `${attente.code || ''} ${attente.reason || ''} ${JSON.stringify(attente.anchors)}`));
  v.push(verdict(arcadesF3 && arcadesF3.flexible === false && arcadesF3.startTime === '10:10' && avantF3.includes('minigolf_blacklight') && avantF3[0] === 'arcade_time',
    'les arcades commencent apres l accueil (10:10, jamais a l heure d arrivee), le minigolf se fait aussi avant le bowling, sans heure', JSON.stringify({ arcades: arcadesF3 && [arcadesF3.flexible, arcadesF3.startTime], avant: attente.before })));
  return v;
}

// ---------------------------------------------------------------------------
// [F] LE POST : LE DOSSIER, SA SIGNATURE, SA MODIFICATION, SES ALTERNATIVES
// ---------------------------------------------------------------------------
async function scenarioF(H) {
  const v = [];
  poserEtat({ reservations: pleines('10:00', '10:30') });
  const montre = arriveeDe(await H.get({ type: 'formule', formuleId: 'f1', arrival: '10:00' }));
  const preference = { arrivalTime: '10:00', preferredTimes: montre.anchors || {}, laserGameTimes: montre.laserGameTimes || [], laserPlacement: 'scheduled', arrivalConfidence: 'normal' };
  const rep = await H.post({ ...corpsFormule('f1', '10:00', preference) });
  const recu = ETAT.recu || {};
  const ligne = ETAT.creees[0] || {};
  const plan = ligne.opsPlan || {};
  v.push(verdict(rep.status === 201 && ETAT.creees.length === 1, 'le POST avec preference.arrivalTime cree le dossier', `${rep.status} ${rep.json && rep.json.message}`));
  v.push(verdict(ligne.startTime === '10:00' && plan.startTime === '10:00' && plan.arrivalPlan && plan.arrivalPlan.arrivalTime === '10:00',
    'le dossier commence a l arrivee (10:00), son plan aussi', `${ligne.startTime} ${plan.startTime} ${plan.arrivalPlan && plan.arrivalPlan.arrivalTime}`));
  v.push(verdict(heuresDuPlan(plan) === JSON.stringify(montre.anchors || {}), 'le dossier garde les heures montrees (bowling, laser)', `${heuresDuPlan(plan)} / ${JSON.stringify(montre.anchors)}`));
  v.push(verdict(plan.arrivalPlan && plan.arrivalPlan.endTime === montre.endTime && Array.isArray(plan.arrivalPlan.frise) && plan.arrivalPlan.frise.length === (montre.frise || []).length,
    'le dossier porte la frise et la fin montrees', `${plan.arrivalPlan && plan.arrivalPlan.endTime} / ${montre.endTime}`));
  v.push(verdict(Number(ligne.totalDuration) === Math.ceil(montre.visitMinutes / 30) / 2, 'la duree du dossier couvre la visite depuis l arrivee', `${ligne.totalDuration} h pour ${montre.visitMinutes} min`));
  const signature = JSON.parse(String(recu.signatureDemande || '[]'));
  v.push(verdict(JSON.stringify(signature[signature.length - 1]) === JSON.stringify(['arrivalTime', '10:00']), 'la signature enregistree porte l arrivee', recu.signatureDemande));
  const autre = H.demande.signatureDemande({ ...corpsFormule('f1', '10:00', { ...preference, arrivalTime: '10:30' }) });
  const meme = H.demande.signatureDemande({ ...corpsFormule('f1', '10:00', { ...preference }) });
  v.push(verdict(autre !== recu.signatureDemande && meme === recu.signatureDemande, 'deux arrivees differentes sont deux demandes, la meme arrivee la meme'));

  // LA MODIFICATION AU COMPTOIR : le meme dossier, sans changer l heure, puis
  // decale d une heure.
  const lire = async (date, centerId) => ({ date, centerId, laneStatuses: {}, reservations: reservationsDuJour(date, centerId) });
  const sansChangement = await H.rops.prepareReservationOps({ ...ligne, ignoreReservationId: ligne.id }, 'staff', { readState: lire });
  const planGarde = sansChangement.opsPlan || {};
  v.push(verdict(heuresDuPlan(planGarde) === heuresDuPlan(plan) && planGarde.arrivalPlan && planGarde.arrivalPlan.arrivalTime === '10:00' && planGarde.startTime === '10:00',
    'modifier le dossier sans toucher a l heure garde l arrivee, le bowling et le laser', `${heuresDuPlan(planGarde)} arrivee ${planGarde.arrivalPlan && planGarde.arrivalPlan.arrivalTime} debut ${planGarde.startTime}`));
  const decale = await H.rops.prepareReservationOps({ ...ligne, ignoreReservationId: ligne.id, startTime: '11:00' }, 'staff', { readState: lire });
  const planDecale = decale.opsPlan || {};
  const attendu = Object.fromEntries(Object.entries(montre.anchors || {}).map(([id, heure]) => [id, heureDe(minutesDe(heure) + 60)]));
  v.push(verdict(heuresDuPlan(planDecale) === JSON.stringify(attendu) && planDecale.arrivalPlan && planDecale.arrivalPlan.arrivalTime === '11:00' && decale.startTime === '11:00',
    'decaler le dossier d une heure decale l arrivee, le bowling et le laser d une heure', `${heuresDuPlan(planDecale)} arrivee ${planDecale.arrivalPlan && planDecale.arrivalPlan.arrivalTime} debut ${decale.startTime}`));
  // Une modification qui porte le PROGRAMME (la fiche du comptoir : formule
  // adaptee a son contenu) garde aussi l arrivee et les heures.
  const programme = [
    { activityId: 'bowling', duration: 1, participants: PAX },
    { activityId: 'laser_game', games: 1, participants: PAX },
    { activityId: 'arcade_time', participants: PAX },
  ];
  const adaptee = await H.rops.prepareReservationOps({ ...ligne, ignoreReservationId: ligne.id, program: programme }, 'staff', { readState: lire });
  const planAdapte = adaptee.opsPlan || {};
  v.push(verdict(planAdapte.arrivalPlan && planAdapte.arrivalPlan.arrivalTime === '10:00' && planAdapte.startTime === '10:00' && heuresDuPlan(planAdapte) === heuresDuPlan(plan),
    'modifier le contenu de la formule au comptoir (programme) garde l arrivee, le bowling et le laser',
    `${heuresDuPlan(planAdapte)} arrivee ${planAdapte.arrivalPlan && planAdapte.arrivalPlan.arrivalTime} debut ${planAdapte.startTime} ${adaptee.planRefusal || adaptee.planWarning || ''}`));
  // Au comptoir, une creation par arrivee commence a l arrivee, quelle que
  // soit l heure envoyee.
  poserEtat({ reservations: pleines('10:00', '10:30') });
  const comptoir = await H.rops.prepareReservationOps(corpsFormule('f1', '10:30', { arrivalTime: '10:00' }), 'staff', { readState: lire });
  v.push(verdict(comptoir.startTime === '10:00' && comptoir.opsPlan && comptoir.opsPlan.startTime === '10:00',
    'au comptoir, le dossier prend l heure d arrivee (10:00), pas l heure envoyee (10:30)', `${comptoir.startTime} ${comptoir.opsPlan && comptoir.opsPlan.startTime}`));

  // LES ALTERNATIVES D UNE ARRIVEE REFUSEE : d autres arrivees, chacune a son
  // heure, les heures du client relachees. Une longue attente ne refuse plus
  // rien (2026-10-13) : le refus est ici une arrivee apres le bowling que la
  // demande pose (11:00, bowling 10:30), que l ecran ne laisse plus partir
  // mais que le serveur doit refuser.
  poserEtat({ reservations: pleines('10:00', '10:30') });
  const refus = await H.post({ ...corpsFormule('f1', '11:00', { arrivalTime: '11:00', preferredTimes: { bowling: '10:30' } }) });
  const alternatives = (refus.json && refus.json.alternatives) || [];
  v.push(verdict(refus.status === 409 && alternatives.length > 1, 'une arrivee refusee au POST rend des alternatives', `${refus.status} ${refus.json && refus.json.message} (${alternatives.length})`));
  const incoherentes = alternatives.filter((alt) => !(alt.opsPlan && alt.opsPlan.arrivalPlan && alt.opsPlan.arrivalPlan.arrivalTime === alt.startTime
    && minutesDe(alt.startTime) % 30 === 0 && String(alt.summary || '').includes(`Arrivée ${alt.startTime}`)));
  const heuresAlt = alternatives.map((alt) => `${alt.date} ${alt.startTime}`);
  v.push(verdict(alternatives.length > 1 && incoherentes.length === 0 && new Set(heuresAlt).size === heuresAlt.length, 'chaque alternative est une arrivee a son heure, toutes differentes (grille, plan et resume d accord)',
    `${incoherentes.slice(0, 2).map((alt) => `${alt.date} ${alt.startTime} ${alt.summary}`).join(' | ')} [${heuresAlt.join(', ')}]`));
  const premiereAlt = alternatives[0] || {};
  const bowlingAlt = minutesDe(JSON.parse(heuresDuPlan(premiereAlt.opsPlan || {}) || '{}').bowling);
  v.push(verdict(premiereAlt.date === DATE && premiereAlt.startTime === '11:00' && bowlingAlt >= minutesDe('11:10'),
    'la premiere alternative garde l arrivee demandee (11:00), le bowling replace apres elle', `${premiereAlt.date} ${premiereAlt.startTime} ${heuresDuPlan(premiereAlt.opsPlan || {})}`));
  return v;
}

// ---------------------------------------------------------------------------
// [G] LA LISTE DES ARRIVEES ET LE POST DISENT LA MEME CHOSE
// ---------------------------------------------------------------------------
const JOURNEES_G = () => [
  ['pleines 10:00-10:30', { reservations: pleines('10:00', '10:30') }],
  ['pleines 10:00-12:00', { reservations: pleines('10:00', '12:00') }],
  // Les blocages a 10:30, pas a 10:00 : depuis l accueil d abord (2026-10-13),
  // rien ne commence a l heure d arrivee, une demi-heure bloquee a 10:00 ne
  // touchait plus aucune visite et la regle ne se voyait plus.
  ['pistes et laser bloques au planning 10:30-11:00', { reservations: [], blocks: blocagesPistesEtLaser('10:30', '11:00') }],
  ['bowling bloque au planning 10:00-10:30', { reservations: [], blocks: blocageBowling('10:00', '10:30') }],
];

async function comparerJournee(H, nom, journee, formuleId = 'f1') {
  poserEtat(journee);
  const liste = await H.get({ type: 'formule', formuleId, arrivals: '1' });
  const entrees = (liste.json && liste.json.arrivals) || [];
  const desaccords = [];
  for (const entree of entrees) {
    const seule = arriveeDe(await H.get({ type: 'formule', formuleId, arrival: entree.time }));
    if (seule.ok !== entree.ok || (seule.code || '') !== (entree.code || '') || (entree.ok && JSON.stringify(seule.anchors) !== JSON.stringify(entree.anchors))) {
      desaccords.push(`${entree.time} liste ${entree.ok ? 'oui' : entree.code}, heure seule ${seule.ok ? 'oui' : seule.code}`);
    }
    const post = await verdictDuPost(H, corpsFormule(formuleId, entree.time, { arrivalTime: entree.time }));
    if (post.ok !== entree.ok || (entree.ok && heuresDuPlan(post.ops.opsPlan) !== JSON.stringify(entree.anchors))) {
      desaccords.push(`${entree.time} liste ${entree.ok ? `oui ${JSON.stringify(entree.anchors)}` : entree.code}, POST ${post.ok ? `oui ${heuresDuPlan(post.ops.opsPlan)}` : `non (${post.raison})`}`);
    }
    if (entree.ok) {
      const pose = await verdictDuPost(H, corpsFormule(formuleId, entree.time, { arrivalTime: entree.time, preferredTimes: entree.anchors, laserGameTimes: entree.laserGameTimes, laserPlacement: 'scheduled', arrivalConfidence: 'normal' }));
      if (!pose.ok || heuresDuPlan(pose.ops.opsPlan) !== JSON.stringify(entree.anchors)) {
        desaccords.push(`${entree.time} heures posees du formulaire : POST ${pose.ok ? heuresDuPlan(pose.ops.opsPlan) : `non (${pose.raison})`}`);
      }
    }
  }
  return { nom, entrees, desaccords };
}

async function scenarioG(H, seulement = null) {
  const v = [];
  for (const [nom, journee] of JOURNEES_G()) {
    if (seulement && !seulement.includes(nom)) continue;
    const r = await comparerJournee(H, nom, journee);
    const dix = r.entrees.find((entree) => entree.time === '10:00') || {};
    if (nom.startsWith('pistes et laser')) {
      v.push(verdict(dix.ok === true && dix.anchors && dix.anchors.bowling === '11:00', 'MONTAGE pistes bloquees de 10:30 a 11:00 : la liste lit les blocages (bowling 11:00, pas 10:30, pour une arrivee a 10:00)', JSON.stringify(dix)));
    }
    if (nom.startsWith('bowling bloque')) {
      const dixTrente = r.entrees.find((entree) => entree.time === '10:30') || {};
      v.push(verdict(dix.ok === false && dix.code === 'final_guard' && dixTrente.ok === true, 'MONTAGE bowling bloque : la garde finale de la creation refuse 10:00 dans la liste, 10:30 passe', `${dix.code} ${dix.reason} / ${dixTrente.ok}`));
    }
    v.push(verdict(r.entrees.length >= 20 && r.desaccords.length === 0, `${nom} : chaque heure (${r.entrees.length}) a le meme verdict dans la liste, seule, et au POST`, r.desaccords.slice(0, 4).join(' | ')));
  }
  return v;
}

// ---------------------------------------------------------------------------
// [H] LE CENTRE COUPE L ARRIVEE ; LES HEURES QUI NE SE DEMANDENT PAS
// ---------------------------------------------------------------------------
async function scenarioH(H) {
  const v = [];
  await avecReglage(H, { arrivalFirst: false }, async () => {
    poserEtat({ reservations: pleines('10:00', '10:30') });
    const rep = await H.get({ type: 'formule', formuleId: 'f1', arrival: '10:00' });
    const arrivee = arriveeDe(rep);
    v.push(verdict(rep.status === 200 && rep.json.slots.length === 0 && arrivee.code === 'arrival_disabled' && rep.json.message === arrivee.reason && arrivee.reason.length > 20,
      'arrivalFirst false : l arrivee est refusee, la reponse dit que le centre ne la propose pas', `${arrivee.code} ${rep.json && rep.json.message}`));
    const liste = await H.get({ type: 'formule', formuleId: 'f1', arrivals: '1' });
    v.push(verdict(Array.isArray(liste.json.arrivals) && liste.json.arrivals.length === 0 && liste.json.arrivalBounds && liste.json.arrivalBounds.arrivalFirst === false && liste.json.message === arrivee.reason,
      'arrivalFirst false : la liste est vide et le dit', JSON.stringify({ n: liste.json.arrivals && liste.json.arrivals.length, message: liste.json.message })));
    const post = await verdictDuPost(H, corpsFormule('f1', '10:00', { arrivalTime: '10:00' }));
    v.push(verdict(post.ok === false && post.raison === arrivee.reason, 'arrivalFirst false : le POST refuse avec la meme raison', post.raison));
  });
  poserEtat({ reservations: pleines('10:00', '10:30') });
  const horsGrille = await H.get({ type: 'formule', formuleId: 'f1', arrival: '10:15' });
  v.push(verdict(arriveeDe(horsGrille).code === 'off_grid' && horsGrille.json.slots.length === 0 && arriveeDe(horsGrille).firstAcceptableTime === '10:00',
    'une arrivee hors grille (10:15) est refusee et la premiere possible proposee (10:00)', `${arriveeDe(horsGrille).code} ${horsGrille.json.message}`));
  const illisible = await H.get({ type: 'formule', formuleId: 'f1', arrival: 'midi' });
  v.push(verdict(arriveeDe(illisible).code === 'arrival_invalid' && !('firstAcceptableTime' in arriveeDe(illisible)), 'une arrivee illisible est refusee sans proposition', arriveeDe(illisible).code));
  const apres = await H.get({ type: 'formule', formuleId: 'f1', arrival: '11:00', preferredTimes: { bowling: '10:30' } });
  v.push(verdict(arriveeDe(apres).code === 'arrival_after_anchor' && String(arriveeDe(apres).reason).includes('10:30'), 'une arrivee apres le bowling deja pose (10:30) est refusee et le dit', `${arriveeDe(apres).code} ${arriveeDe(apres).reason}`));
  const postApres = await verdictDuPost(H, corpsFormule('f1', '11:00', { arrivalTime: '11:00', preferredTimes: { bowling: '10:30' } }));
  v.push(verdict(postApres.ok === false && postApres.raison === arriveeDe(apres).reason, 'le POST refuse cette arrivee avec la meme raison', postApres.raison));
  // L ACCUEIL (Movsar, 2026-10-13) : un bowling pose PILE a l heure d arrivee
  // n a pas ses dix minutes d accueil, journee libre ou non.
  poserEtat({ reservations: [] });
  const pile = await H.get({ type: 'formule', formuleId: 'f1', arrival: '10:00', preferredTimes: { bowling: '10:00' } });
  v.push(verdict(arriveeDe(pile).code === 'arrival_welcome' && /accueil/.test(String(arriveeDe(pile).reason)) && String(arriveeDe(pile).reason).includes('10:00') && pile.json.slots.length === 0,
    'journee libre : un bowling pose a l heure d arrivee (10:00) est refuse, il commencerait pendant l accueil', `${arriveeDe(pile).code} ${arriveeDe(pile).reason}`));
  const postPile = await verdictDuPost(H, corpsFormule('f1', '10:00', { arrivalTime: '10:00', preferredTimes: { bowling: '10:00' } }));
  v.push(verdict(postPile.ok === false && postPile.raison === arriveeDe(pile).reason, 'le POST refuse ce bowling avec la meme raison', postPile.raison));
  return v;
}

// ---------------------------------------------------------------------------
// [K] LES HEURES DES ACTIVITES AVEC UNE ARRIVEE CHOISIE (2026-10-13)
// Movsar : « quand ils choisissent l heure d arrivee on peut pas choisir les
// heures qu on veut pour les autres activites ». La reponse d une arrivee
// porte la grille des activites, jugee AVEC elle, heure par heure, en mode
// rapide ; chaque heure doit dire ce que la demande de cette heure (calcul
// complet, la porte de la reservation) dira. La liste des arrivees se juge
// avec les heures deja posees.
// ---------------------------------------------------------------------------
async function scenarioK(H) {
  const v = [];
  // `apresAccueil` : seules les heures que la porte juge (celles d avant la fin
  // de l accueil se disent sans calcul, et les journees du matin les prouvent).
  const verifierGrille = async (nom, arrivee, { apresAccueil = false, formuleId = 'f1' } = {}) => {
    const rep = await H.get({ type: 'formule', formuleId, arrival: arrivee });
    const grille = (rep.json && rep.json.anchors && rep.json.anchors.activities) || [];
    // Les activites a heure fixe de la formule, lues dans sa grille sans arrivee.
    const sans = await H.get({ type: 'formule', formuleId });
    const grilleSans = (sans.json && sans.json.anchors && sans.json.anchors.activities) || [];
    const attendues = grilleSans.map((a) => a.activityId).join(', ');
    v.push(verdict(rep.status === 200 && grille.length > 0 && grille.map((a) => a.activityId).join(', ') === attendues && grille.every((a) => Array.isArray(a.times) && a.times.length > 0),
      `${nom}, arrivee ${arrivee} : la reponse porte la grille de ses activites a heure fixe (${attendues})`, `${rep.status} ${grille.map((a) => `${a.activityId}:${(a.times || []).length}`).join(' ')}`));
    const ecarts = [];
    let prenables = 0;
    let serrees = 0;
    let avancees = 0;
    let gardees = 0;
    for (const activite of grille) {
      for (const entree of activite.times) {
        // AVANT L ARRIVEE OU PENDANT SON ACCUEIL (le dernier choix gagne,
        // 2026-10-13) : l heure que la journee sans arrivee prend se prend, elle
        // decale l arrivee (conflit « arrivee ») et dit l heure ou elle l avance ;
        // celle qu elle refuse garde ce refus (le soir, la fermeture).
        const debut = minutesDe(entree.time);
        if (debut < minutesDe(arrivee) + 10) {
          const sansArrivee = ((grilleSans.find((a) => a.activityId === activite.activityId) || { times: [] }).times.find((x) => x.time === entree.time)) || { ok: false, code: 'absente' };
          const code = debut < minutesDe(arrivee) ? 'arrival_before' : 'arrival_welcome';
          if (sansArrivee.ok !== false) {
            avancees += 1;
            if (!(entree.ok === false && entree.code === code && entree.conflict && entree.conflict.activityId === 'arrivee' && entree.conflict.time === arrivee
              && String(entree.reason).includes(`avance votre arrivée à ${heureDe(debut - 10)}`))) {
              ecarts.push(`${activite.activityId}@${entree.time} avant la fin de l accueil : ${entree.ok === false ? entree.code : 'ok'} ${JSON.stringify(entree.conflict || null)} ${entree.reason || ''}`);
            }
          } else if (entree.ok !== false || entree.code !== sansArrivee.code) {
            gardees += 1;
            ecarts.push(`${activite.activityId}@${entree.time} refusee sans arrivee (${sansArrivee.code}) mais ${entree.ok === false ? entree.code : 'ok'} avec`);
          } else {
            gardees += 1;
          }
          if (apresAccueil) continue;
        }
        const pose = { [activite.activityId]: entree.time };
        const seule = await H.get({ type: 'formule', formuleId, arrival: arrivee, preferredTimes: pose, ...(activite.activityId === 'laser_game' ? { laserGameTimes: [entree.time] } : {}) });
        const verdictSeul = arriveeDe(seule);
        if (entree.ok !== false) prenables += 1;
        if (entree.warning) serrees += 1;
        if ((entree.ok !== false) !== (verdictSeul.ok === true)) ecarts.push(`${activite.activityId}@${entree.time} grille ${entree.ok === false ? entree.code : 'ok'} / demande ${verdictSeul.ok ? 'ok' : verdictSeul.code}`);
        else if (entree.ok !== false && Boolean(entree.warning) !== Boolean(verdictSeul.warning)) ecarts.push(`${activite.activityId}@${entree.time} grille ${entree.warning ? 'serre' : 'sans avis'} / demande ${verdictSeul.warning ? 'serre' : 'sans avis'}`);
        else if (entree.ok !== false && String(entree.endTime || '') !== String(verdictSeul.endTime || '')) ecarts.push(`${activite.activityId}@${entree.time} grille fin ${entree.endTime} / demande fin ${verdictSeul.endTime}`);
      }
    }
    v.push(verdict(prenables > 0 && ecarts.length === 0, `${nom}, arrivee ${arrivee} : chaque heure de la grille dit ce que sa demande dira, « serré » et la fin compris ; avant la fin de l accueil, l heure avance l arrivee ou garde son refus (${prenables} prenables, ${serrees} avec avis, ${avancees} qui avancent l arrivee, ${gardees} refus gardes)`, ecarts.slice(0, 4).join(' | ')));
    return grille;
  };
  // Une formule a plusieurs parties de laser (Formule 4), une partie deja
  // posee : chaque heure dit ce que sa demande dira, la partie touchee
  // composee comme l ecran la compose (elle rejoint la partie posee, ou prend
  // la place de celle qu elle chevauche, verdict `move`).
  const verifierParties = async (nom, arrivee, posee) => {
    const poses = { preferredTimes: { laser_game: posee }, laserGameTimes: [posee] };
    const rep = await H.get({ type: 'formule', formuleId: 'f4', arrival: arrivee, ...poses });
    const grille = (rep.json && rep.json.anchors && rep.json.anchors.activities) || [];
    const ecarts = [];
    let jugees = 0;
    let prenables = 0;
    let deplacements = 0;
    for (const activite of grille) {
      for (const entree of activite.times) {
        if (minutesDe(entree.time) < minutesDe(arrivee) + 10) continue;
        if (activite.activityId === 'laser_game' && entree.time === posee) continue;
        let demande = { preferredTimes: { laser_game: posee, [activite.activityId]: entree.time }, laserGameTimes: [posee] };
        let attendu = entree.ok !== false;
        if (activite.activityId === 'laser_game') {
          const remplacee = entree.ok === false && entree.move ? String(entree.move.replaces || '') : '';
          const parties = [...[posee].filter((partie) => partie !== remplacee), entree.time].sort();
          demande = { preferredTimes: { laser_game: parties[0] }, laserGameTimes: parties };
          if (remplacee) { attendu = entree.move.ok === true; deplacements += 1; }
        }
        jugees += 1;
        if (attendu) prenables += 1;
        const seule = arriveeDe(await H.get({ type: 'formule', formuleId: 'f4', arrival: arrivee, ...demande }));
        // Le verdict que l ecran lira : celui du deplacement, s il y en a un.
        const lu = entree.ok === false && entree.move ? entree.move : entree;
        if (attendu !== (seule.ok === true)) ecarts.push(`${activite.activityId}@${entree.time} grille ${attendu ? 'ok' : entree.code} / demande ${seule.ok ? 'ok' : seule.code}`);
        else if (attendu && Boolean(lu.warning) !== Boolean(seule.warning)) ecarts.push(`${activite.activityId}@${entree.time} grille ${lu.warning ? lu.warning.code : 'sans avis'} / demande ${seule.warning ? seule.warning.code : 'sans avis'}`);
        else if (attendu && lu === entree && String(entree.endTime || '') !== String(seule.endTime || '')) ecarts.push(`${activite.activityId}@${entree.time} grille fin ${entree.endTime} / demande fin ${seule.endTime}`);
      }
    }
    v.push(verdict(rep.status === 200 && grille.length === 2 && prenables > 0 && ecarts.length === 0,
      `${nom}, arrivee ${arrivee}, une partie de laser posee a ${posee} : chaque heure dit ce que sa demande dira (${jugees} heures, ${prenables} prenables, ${deplacements} deplacements)`, ecarts.slice(0, 4).join(' | ')));
  };
  poserEtat({ reservations: [] });
  const libre = await verifierGrille('journee libre', '10:00');
  const bowling = (libre.find((a) => a.activityId === 'bowling') || { times: [] }).times;
  const dix = bowling.find((t) => t.time === '10:00') || {};
  v.push(verdict(dix.ok === false && dix.code === 'arrival_welcome' && dix.conflict && dix.conflict.activityId === 'arrivee' && /accueil/.test(String(dix.reason)) && /avance votre arrivée à 09:50/.test(String(dix.reason)),
    'le bowling de 10:00, pendant l accueil de l arrivee de 10:00 : il se prend et avance l arrivee a 09:50', `${dix.code} ${JSON.stringify(dix.conflict || null)} ${dix.reason}`));
  const loin = bowling.find((t) => t.time === '15:00') || {};
  const avisLoin = loin.warning || {};
  v.push(verdict(loin.ok !== false && avisLoin.code === 'arrival_wait' && avisLoin.waitMinutes > 30 && /votre bowling à 15:00/.test(String(avisLoin.reason)) && avisLoin.cause === 'Avec votre bowling à 15:00',
    'le bowling de 15:00, loin de l arrivee de 10:00 : il se prend, avec un avis d attente qui dit le bowling', `${loin.ok === false ? loin.code : 'ok'} ${JSON.stringify(avisLoin)}`));
  await verifierGrille('journee libre', '14:00');
  // LE SOIR, PRES DE LA FERMETURE (cas releves au banc le 13/10). Formule 3 :
  // sans arrivee, le bowling de 21:30 a 22:30 est refuse pour la fermeture
  // (le minigolf et les arcades viendraient apres lui) ; arrive a 21:00, le
  // groupe les fait avant, et ces heures se prennent. Formule 4 : avec une
  // arrivee a 21:00, la visite deborde la fermeture, « serré » vient du
  // verdict de l arrivee.
  const grilleDe = (rep) => (rep && rep.json && rep.json.anchors && rep.json.anchors.activities) || [];
  const heuresDe = (grille, id) => (grille.find((a) => a.activityId === id) || { times: [] }).times;
  const f3Sans = heuresDe(grilleDe(await H.get({ type: 'formule', formuleId: 'f3' })), 'bowling');
  const f3Soir = heuresDe(await verifierGrille('journee libre, Formule 3', '21:00', { apresAccueil: true, formuleId: 'f3' }), 'bowling');
  const levees = f3Soir.filter((t) => t.ok !== false && minutesDe(t.time) >= minutesDe('21:10')
    && ['schedule', 'schedule_free'].includes((f3Sans.find((x) => x.time === t.time) || {}).code)).map((t) => t.time);
  v.push(verdict(levees.length > 0, `Formule 3, arrivee 21:00 : des heures de bowling refusees sans arrivee pour la fermeture se prennent avec elle (${levees.join(', ')})`,
    f3Soir.filter((t) => minutesDe(t.time) >= minutesDe('21:10')).map((t) => `${t.time} ${t.ok === false ? t.code : 'ok'} (sans arrivee ${(f3Sans.find((x) => x.time === t.time) || {}).code || 'ok'})`).join(' | ')));
  const f4Soir = await verifierGrille('journee libre, Formule 4', '21:00', { apresAccueil: true, formuleId: 'f4' });
  const serreesSoir = f4Soir.flatMap((a) => a.times.filter((t) => t.ok !== false && t.warning).map((t) => `${a.activityId} ${t.time}`));
  v.push(verdict(serreesSoir.length > 0, `Formule 4, arrivee 21:00 : les heures dont la visite deborde la fermeture se disent « serré » (${serreesSoir.slice(0, 4).join(', ')})`));
  await verifierParties('journee libre', '10:00', '11:00');
  // L HEURE PROPOSEE de chaque activite est celle du plan de cette arrivee :
  // celle de la journee sans arrivee (bowling 10:00 pour une arrivee a 10:30)
  // se disait « proposé » sur une heure refusee pendant l accueil.
  const avecPlan = await H.get({ type: 'formule', formuleId: 'f1', arrival: '10:30' });
  const proposees = (avecPlan.json && avecPlan.json.anchors && avecPlan.json.anchors.defaultTimes) || {};
  const duPlan = (avecPlan.json && avecPlan.json.arrival && avecPlan.json.arrival.anchors) || {};
  const grilleDuPlan = (avecPlan.json && avecPlan.json.anchors && avecPlan.json.anchors.activities) || [];
  const tenues = Object.entries(proposees).every(([id, t]) => ((grilleDuPlan.find((a) => a.activityId === id) || { times: [] }).times.find((x) => x.time === t) || { ok: false }).ok !== false);
  v.push(verdict(avecPlan.json && avecPlan.json.arrival && avecPlan.json.arrival.ok === true && Object.keys(duPlan).length === 2
    && JSON.stringify(proposees) === JSON.stringify(duPlan) && minutesDe(proposees.bowling) >= minutesDe('10:40') && tenues,
  `journee libre, arrivee 10:30 : les heures proposees de la grille sont celles du plan de l arrivee (${JSON.stringify(proposees)}), prenables`, `grille ${JSON.stringify(proposees)} / plan ${JSON.stringify(duPlan)}`));
  // Une arrivee vraiment impossible (la garde finale de la creation refuse
  // 10:00, le bowling bloque au planning) ne propose aucune heure d activite.
  poserEtat({ reservations: [], blocks: blocageBowling('10:00', '10:30') });
  const refusee = await H.get({ type: 'formule', formuleId: 'f1', arrival: '10:00' });
  const sansPlan = (refusee.json && refusee.json.anchors && refusee.json.anchors.defaultTimes) || null;
  v.push(verdict(refusee.json && refusee.json.arrival && refusee.json.arrival.ok === false && sansPlan && Object.keys(sansPlan).length === 0,
    `une arrivee refusee (${refusee.json && refusee.json.arrival && refusee.json.arrival.code}, arrivee 10:00) ne propose aucune heure d activite`, JSON.stringify(sansPlan)));
  // Des heures prises au milieu de la matinee : certaines heures tiennent,
  // d autres sont completes, d autres font attendre (un avis, plus un refus).
  poserEtat({ reservations: pleines('12:00', '13:00') });
  const prise = await verifierGrille('pistes et arene pleines de 12:00 a 13:00', '10:00');
  const codes = new Set(prise.flatMap((a) => a.times.filter((t) => t.ok === false).map((t) => t.code)));
  const attentes = prise.flatMap((a) => a.times.filter((t) => t.ok !== false && t.warning && t.warning.code === 'arrival_wait'));
  v.push(verdict(codes.has('capacity') && !codes.has('arrival_wait') && attentes.length > 0,
    'MONTAGE cette journee-la, la grille porte des heures completes, et des heures loin de l arrivee qui se prennent avec un avis d attente', `${[...codes].join(',')} / ${attentes.length} avis`));
  // L avis d une attente que cause une heure POSEE dit cette heure, et ne
  // pretend aucun complet un jour libre (« Laser Game est complet jusqu a
  // 10:30 » s ecrivait, la demi-heure de l accueil prise pour du complet).
  poserEtat({ reservations: [] });
  const attendre = arriveeDe(await H.get({ type: 'formule', formuleId: 'f1', arrival: '10:00', preferredTimes: { bowling: '13:00' } }));
  const avisAttendre = attendre.warning || {};
  v.push(verdict(attendre.ok === true && avisAttendre.code === 'arrival_wait' && /Avec votre bowling à 13:00/.test(String(avisAttendre.reason)) && !/complet/i.test(String(avisAttendre.reason)) && avisAttendre.cause === 'Avec votre bowling à 13:00',
    'journee libre, bowling pose a 13:00, arrivee 10:00 : elle se prend, l avis dit le bowling pose, aucun complet', JSON.stringify(avisAttendre)));
  // LA LISTE DES ARRIVEES, avec le bowling pose a 14:00 : LE DERNIER CHOIX
  // GAGNE (Movsar, 2026-10-13 : « c est vraiment pas normal de pouvoir choisir
  // aucun horaire »). Une arrivee avant 13:50 garde le bowling ; une arrivee
  // apres le libere (`releases`), et se juge sans lui, comme l ecran la
  // demandera. Chaque heure dit ce que cette demande dira.
  const liste = await H.get({ type: 'formule', formuleId: 'f1', arrivals: '1', preferredTimes: { bowling: '14:00' } });
  const entrees = (liste.json && liste.json.arrivals) || [];
  const ecarts = [];
  for (const entree of entrees) {
    const libere = minutesDe(entree.time) + 10 > minutesDe('14:00');
    if (libere !== (JSON.stringify(entree.releases || []) === JSON.stringify(['bowling']))) ecarts.push(`${entree.time} libere ${JSON.stringify(entree.releases || [])}`);
    const seule = arriveeDe(await H.get({ type: 'formule', formuleId: 'f1', arrival: entree.time, ...(libere ? {} : { preferredTimes: { bowling: '14:00' } }) }));
    if (Boolean(entree.ok) !== Boolean(seule.ok) || (!entree.ok && entree.code !== seule.code) || (entree.ok && JSON.stringify(entree.anchors) !== JSON.stringify(seule.anchors))) {
      ecarts.push(`${entree.time} liste ${entree.ok ? JSON.stringify(entree.anchors) : entree.code} / demande ${seule.ok ? JSON.stringify(seule.anchors) : seule.code}`);
    }
  }
  const tiennent = entrees.filter((entree) => entree.ok).map((entree) => entree.time);
  const gardent = entrees.filter((entree) => entree.ok && !entree.releases);
  v.push(verdict(entrees.length > 0 && ecarts.length === 0 && gardent.length > 0 && gardent.every((entree) => entree.anchors && entree.anchors.bowling === '14:00'),
    `la liste des arrivees se juge avec le bowling pose a 14:00 apres chacune, libere avant (tiennent : ${tiennent.join(', ')})`, ecarts.slice(0, 4).join(' | ')));
  const apres = entrees.find((entree) => entree.time === '14:30') || {};
  v.push(verdict(apres.ok === true && JSON.stringify(apres.releases) === JSON.stringify(['bowling']) && apres.anchors && minutesDe(apres.anchors.bowling) >= minutesDe('14:40'),
    'arriver a 14:30, apres le bowling pose a 14:00 : l arrivee se prend, le bowling se libere et se replace apres elle', `${apres.ok === false ? apres.code : 'ok'} ${JSON.stringify(apres.releases)} ${JSON.stringify(apres.anchors)}`));
  const sans = await H.get({ type: 'formule', formuleId: 'f1', arrivals: '1' });
  const entreesSans = (sans.json && sans.json.arrivals) || [];
  const memes = entrees.filter((entree) => entree.releases).every((entree) => {
    const libre = entreesSans.find((x) => x.time === entree.time) || {};
    return libre.ok === entree.ok && JSON.stringify(libre.anchors) === JSON.stringify(entree.anchors) && !libre.releases;
  });
  v.push(verdict(entreesSans.length === entrees.length && entreesSans.every((entree) => !entree.releases) && memes,
    'sans heure posee, la liste ne libere rien ; une arrivee qui libere le bowling dit ce que la journee libre dit', `${entreesSans.length} / ${entrees.length}`));
  return v;
}

// ---------------------------------------------------------------------------
// [I] LE REGLAGE TRAVERSE LA CONFIGURATION
// ---------------------------------------------------------------------------
async function scenarioI(H) {
  const v = [];
  const { FORMULA_VISIT_DEFAULTS } = H.visite();
  const brut = { arrivalFirst: 'false', maxWaitMinutes: '45', maxVisitMinutes: 30, freeDurationPolicy: 'max' };
  const attendu = { arrivalFirst: false, maxWaitMinutes: 45, maxVisitMinutes: 60, freeDurationPolicy: 'max' };
  const egal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const normalise = H.centerConfig.normalizeCenterConfig({ formulaVisit: brut }, CENTRE).formulaVisit;
  v.push(verdict(egal(normalise, attendu), 'normalizeCenterConfig borne le reglage (texte lu, duree de visite remontee a 60)', JSON.stringify(normalise)));
  const bornes = [
    [{ maxWaitMinutes: 999 }, 'maxWaitMinutes', 240],
    [{ maxWaitMinutes: -5 }, 'maxWaitMinutes', 0],
    [{ maxWaitMinutes: 'beaucoup' }, 'maxWaitMinutes', FORMULA_VISIT_DEFAULTS.maxWaitMinutes],
    [{ maxVisitMinutes: 5000 }, 'maxVisitMinutes', 720],
    [{ maxVisitMinutes: 0 }, 'maxVisitMinutes', 0],
    [{ freeDurationPolicy: 'tout' }, 'freeDurationPolicy', 'default'],
    [{ arrivalFirst: 'peut-etre' }, 'arrivalFirst', true],
  ].filter(([entree, cle, valeur]) => H.centerConfig.normalizeCenterConfig({ formulaVisit: entree }, CENTRE).formulaVisit[cle] !== valeur);
  v.push(verdict(bornes.length === 0, 'les bornes : attente 0 a 240, visite 0 (automatique) ou 60 a 720, politique min/default/max, sinon le defaut', JSON.stringify(bornes)));
  v.push(verdict(egal(H.centerConfig.normalizeCenterConfig({}, CENTRE).formulaVisit, FORMULA_VISIT_DEFAULTS), 'sans reglage : les defauts (arrivee proposee, 30 min, automatique, default)', JSON.stringify(H.centerConfig.normalizeCenterConfig({}, CENTRE).formulaVisit)));
  await avecReglage(H, brut, async () => {
    const centre = H.knowledge.getCenter(CENTRE);
    v.push(verdict(egal(H.centerConfig.toEditableConfig(centre).formulaVisit, attendu), 'toEditableConfig rend le reglage borne', JSON.stringify(H.centerConfig.toEditableConfig(centre).formulaVisit)));
    v.push(verdict(egal(H.visite().formulaVisitOf(centre), attendu), 'le moteur lit le meme reglage (formulaVisitOf)'));
    const meta = await H.meta({});
    v.push(verdict(meta.status === 200 && meta.json && meta.json.center && egal(meta.json.center.formulaVisit, attendu), 'la meta publique donne le reglage au formulaire', JSON.stringify(meta.json && meta.json.center && meta.json.center.formulaVisit)));
    poserEtat({ reservations: [] });
    const dispo = await H.get({ type: 'formule', formuleId: 'f1', arrivals: '1' });
    v.push(verdict(dispo.json && egal(dispo.json.arrivalBounds, { ...attendu, welcomeMinutes: H.engine.FORMULA_ARRIVAL_MINUTES }) && H.engine.FORMULA_ARRIVAL_MINUTES === 10,
      'la liste des arrivees annonce les bornes du centre, et les dix minutes d accueil avec lesquelles l ecran libere les heures d avant', JSON.stringify(dispo.json && dispo.json.arrivalBounds)));
  });
  const ligne = H.centerScope.projectCenterRow({ id: CENTRE, name: 'Fun Galaxy Libramont', status: 'active', timezone: 'Europe/Brussels', settings: { config: { formulaVisit: brut } } });
  v.push(verdict(egal(ligne.formulaVisit, attendu), 'projectCenterRow (ecran Etablissement) rend le reglage borne', JSON.stringify(ligne.formulaVisit)));
  const repli = await H.centerScope.listCentersForSession({ query: async () => { throw new Error('base absente'); } }, { centerId: CENTRE });
  v.push(verdict(Array.isArray(repli) && repli[0] && egal(repli[0].formulaVisit, FORMULA_VISIT_DEFAULTS), 'le repli sans base rend le reglage par defaut', JSON.stringify(repli && repli[0] && repli[0].formulaVisit)));
  return v;
}

// ---------------------------------------------------------------------------
// [A+] LE DIFFERENTIEL CONTRE UN COMMIT (--base)
// ---------------------------------------------------------------------------
function sourcesDuCommit(commit) {
  const git = (...args) => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const changes = git('diff', '--name-only', commit, '--', 'lib', 'api', 'ops-knowledge').split('\n').map((ligne) => ligne.trim()).filter(Boolean);
  const sources = new Map();
  const autres = [];
  changes.forEach((rel) => {
    if (!rel.endsWith('.js')) { autres.push(rel); return; }
    let source = null;
    try { source = git('show', `${commit}:${rel}`); } catch (error) { source = null; }
    if (source !== null) sources.set(rel, source);
  });
  return { sources, changes, autres };
}

async function differentiel(commit) {
  let base = null;
  try {
    base = sourcesDuCommit(commit);
  } catch (error) {
    ok(false, `--base ${commit} : commit illisible`, String(error && error.message));
    return;
  }
  ok(base.sources.size > 0 && base.autres.length === 0, `MONTAGE ${base.sources.size} sources de lib/ et api/ different de ${commit} ; aucun autre fichier de donnees`, base.autres.join(', '));
  SOURCES_BASE = base.sources;
  let avant = null;
  let metaAvant = null;
  try {
    const H = charger();
    avant = await mesurerSansArrivee(H);
    metaAvant = await H.meta({});
  } finally {
    SOURCES_BASE = null;
  }
  const H = charger();
  const apres = await mesurerSansArrivee(H);
  const metaApres = await H.meta({});
  const ecartsGet = ecartsEntre(avant.corpsGet, apres.corpsGet);
  const ecartsPost = ecartsEntre(avant.corpsPost, apres.corpsPost);
  ok(ecartsGet.length === 0, `GET sans arrivee : ${avant.corpsGet.length} reponses identiques octet pour octet a ${commit}`, ecartsGet.slice(0, 3).join(' | '));
  ok(ecartsPost.length === 0, `coeur du POST sans arrivee : ${avant.corpsPost.length} plans identiques octet pour octet a ${commit}`, ecartsPost.slice(0, 3).join(' | '));
  ok(JSON.stringify(avant.signatures) === JSON.stringify(apres.signatures), `signatures sans arrivee : ${avant.signatures.length} identiques a ${commit}`);
  const metaSansReglage = metaApres.json ? JSON.parse(metaApres.body) : null;
  if (metaSansReglage && metaSansReglage.center) delete metaSansReglage.center.formulaVisit;
  ok(metaAvant.json && metaSansReglage && JSON.stringify(metaAvant.json) === JSON.stringify(metaSansReglage) && metaApres.json.center && metaApres.json.center.formulaVisit,
    `meta publique : identique a ${commit}, plus la seule cle center.formulaVisit`);
}

// ---------------------------------------------------------------------------
// [J] LES CONTRE-EPREUVES (--mutate)
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// [L] LES ARCADES A LEUR HEURE, LE TEMPS LIBRE (2026-10-13)
// ---------------------------------------------------------------------------
// Movsar : « pourquoi tu mets automatiquement l heure d arrivee a arcade [...]
// ils peuvent choisir heure d arrivee mais aussi arcade, mettre arcade pendant
// temps d attente [...] des pop up adaptees en fonction du temps libre ».
const friseDe = (arrivee) => (arrivee && arrivee.frise) || [];
const arcadesDe = (arrivee) => friseDe(arrivee).find((segment) => segment.kind === 'free' && segment.activityId === 'arcade_time') || null;
const etapeArcades = (plan) => ((plan && plan.timeline) || []).find((etape) => etape.activityId === 'arcade_time') || {};
async function scenarioL(H) {
  const v = [];
  const fermeture = Math.round(Number(H.bookingConfig.getSchedule(DATE, H.knowledge.getCenter(CENTRE)).close) * 60);
  poserEtat({ reservations: [] });
  // 1. Rien ne se pose pendant l accueil : rangees par la frise, les arcades
  //    commencent apres les dix minutes, jamais a l heure d arrivee.
  const rangee = arriveeDe(await H.get({ type: 'formule', formuleId: 'f1', arrival: '10:00' }));
  const arcRangee = arcadesDe(rangee);
  v.push(verdict(rangee.ok === true && arcRangee && arcRangee.timed === true && minutesDe(arcRangee.startTime) >= minutesDe('10:10') && !arcRangee.chosen && !rangee.arcadeTime,
    'sans heure choisie, la frise range les arcades apres les dix minutes d accueil (jamais a 10:00)', JSON.stringify(arcRangee)));

  // 2. Les arcades a l heure du client.
  const choisie = await H.get({ type: 'formule', formuleId: 'f1', arrival: '10:00', arcade: '10:30' });
  const arrC = arriveeDe(choisie);
  const arcC = arcadesDe(arrC) || {};
  const planC = ((choisie.json && choisie.json.slots && choisie.json.slots[0]) || {}).opsPlan || {};
  const etapeC = etapeArcades(planC);
  v.push(verdict(arrC.ok === true && arcC.startTime === '10:30' && arcC.endTime === '11:00' && arcC.chosen === true && arrC.arcadeTime === '10:30',
    'arcades choisies a 10:30 : la frise les pose a 10:30-11:00, a l heure du client', `${arrC.code || ''} ${arrC.reason || ''} ${JSON.stringify(arcC)}`));
  v.push(verdict(arrC.anchors && arrC.anchors.bowling === '11:00' && minutesDe(arrC.anchors.laser_game) >= minutesDe('12:00'),
    'le bowling et le laser se placent autour des arcades (bowling 11:00, laser apres)', JSON.stringify(arrC.anchors)));
  v.push(verdict(etapeC.flexible === false && etapeC.startTime === '10:30' && etapeC.endTime === '11:00' && planC.arrivalPlan && planC.arrivalPlan.arcadeTime === '10:30',
    'le plan porte les arcades a 10:30 (etape a heure du planning) et leur heure choisie', JSON.stringify([etapeC.flexible, etapeC.startTime, etapeC.endTime])));
  const sansArrivee = await H.get({ type: 'formule', formuleId: 'f1', preferredTimes: { bowling: '15:00' } });
  const sansArriveeArcade = await H.get({ type: 'formule', formuleId: 'f1', preferredTimes: { bowling: '15:00' }, arcade: '16:30' });
  v.push(verdict(sansArrivee.status === 200 && sansArrivee.body === sansArriveeArcade.body, 'sans heure d arrivee, une heure d arcade ne change rien a la reponse, au caractere pres'));

  // 3. Pendant l accueil, puis sur le bowling pose : refusees, avec ce qui les gene.
  const accueil = arriveeDe(await H.get({ type: 'formule', formuleId: 'f1', arrival: '10:00', arcade: '10:00' }));
  v.push(verdict(accueil.ok === false && accueil.code === 'arcade_before_arrival' && accueil.conflict && accueil.conflict.activityId === 'arrivee',
    'des arcades a 10:00, pendant l accueil d une arrivee a 10:00, se refusent (l arrivee en cause)', `${accueil.code} ${accueil.reason}`));
  const surBowling = arriveeDe(await H.get({ type: 'formule', formuleId: 'f1', arrival: '10:00', preferredTimes: { bowling: '11:00' }, arcade: '11:00' }));
  v.push(verdict(surBowling.ok === false && surBowling.code === 'arcade_overlap' && surBowling.conflict && surBowling.conflict.activityId === 'bowling' && surBowling.conflict.time === '11:00',
    'des arcades sur le bowling pose (11:00) se refusent, le bowling en cause', `${surBowling.code} ${surBowling.reason} ${JSON.stringify(surBowling.conflict)}`));

  // 4. La grille des arcades, seule : de la fin de l accueil a la fermeture.
  const grille = await H.get({ type: 'formule', formuleId: 'f1', arrival: '10:00', preferredTimes: { bowling: '11:00' }, arcades: '1' });
  const heures = (grille.json && grille.json.arcadeTimes) || [];
  const parHeure = Object.fromEntries(heures.map((entree) => [entree.time, entree]));
  v.push(verdict(heures.length > 10 && heures[0].time === '10:10' && heures[1].time === '10:30' && heures.slice(1).every((entree) => minutesDe(entree.time) % 30 === 0) && heures.every((entree) => minutesDe(entree.time) + 30 <= fermeture) && !(grille.json.slots || []).length && !grille.json.anchors,
    'la grille des arcades part de la fin de l accueil (10:10), puis les demi-heures jusqu a la fermeture, seule (ni plan ni grille des activites)', JSON.stringify(heures.slice(0, 3).map((entree) => entree.time))));
  v.push(verdict(parHeure['10:10'] && parHeure['10:10'].ok === true && !parHeure['10:10'].releases,
    'arcades a 10:10, des la fin de l accueil : se prennent sans rien deplacer', JSON.stringify(parHeure['10:10'])));
  v.push(verdict(parHeure['10:30'] && parHeure['10:30'].ok === true && !parHeure['10:30'].releases,
    'arcades a 10:30 : se prennent sans rien deplacer (avant le bowling de 11:00)', JSON.stringify(parHeure['10:30'])));
  v.push(verdict(parHeure['11:00'] && parHeure['11:00'].ok === true && JSON.stringify(parHeure['11:00'].releases) === '["bowling"]' && parHeure['11:00'].conflict && parHeure['11:00'].conflict.time === '11:00',
    'arcades a 11:00, sur le bowling pose : se prennent et le liberent (le dernier choix gagne)', JSON.stringify(parHeure['11:00'])));

  // 5. Le bowling pose sur les arcades choisies les decale.
  const grilleBowling = await H.get({ type: 'formule', formuleId: 'f1', arrival: '10:00', arcade: '10:30' });
  const bowling = ((grilleBowling.json && grilleBowling.json.anchors && grilleBowling.json.anchors.activities) || []).find((activite) => activite.activityId === 'bowling') || {};
  const b1030 = (bowling.times || []).find((entree) => entree.time === '10:30') || {};
  const b1100 = (bowling.times || []).find((entree) => entree.time === '11:00') || {};
  v.push(verdict(b1030.ok === false && b1030.code === 'arcade_overlap' && b1030.conflict && b1030.conflict.activityId === 'arcade_time' && b1030.conflict.time === '10:30',
    'le bowling a 10:30, sur les arcades choisies : il decale les arcades (conflit arcade_time), il ne se refuse pas', JSON.stringify(b1030)));
  v.push(verdict(b1100.ok === true, 'le bowling a 11:00, apres les arcades, se prend', JSON.stringify(b1100)));

  // 6. La liste des arrivees libere les arcades posees avant chacune.
  const liste = await H.get({ type: 'formule', formuleId: 'f1', arrivals: '1', arcade: '11:00' });
  const entrees = (liste.json && liste.json.arrivals) || [];
  const a1000 = entrees.find((entree) => entree.time === '10:00') || {};
  const a1100 = entrees.find((entree) => entree.time === '11:00') || {};
  v.push(verdict(a1000.ok === true && !(a1000.releases || []).includes('arcade_time') && a1000.arcadeTime === '11:00',
    'arrivee 10:00, arcades choisies a 11:00 : elles restent a 11:00', JSON.stringify({ ok: a1000.ok, releases: a1000.releases, arcadeTime: a1000.arcadeTime })));
  v.push(verdict(a1100.ok === true && (a1100.releases || []).includes('arcade_time') && !a1100.arcadeTime,
    'arrivee 11:00 : les arcades de 11:00 tombent pendant son accueil, la liste les libere et la frise les range', JSON.stringify({ ok: a1100.ok, code: a1100.code, releases: a1100.releases, arcadeTime: a1100.arcadeTime })));

  // 7. La Formule 2 : la partie de laser a la suite passe apres les arcades.
  const f2 = arriveeDe(await H.get({ type: 'formule', formuleId: 'f2', arrival: '10:00', preferredTimes: { laser_game: '10:30' }, laserGameTimes: ['10:30'], arcade: '11:00' }));
  const suiteF2 = friseDe(f2).find((segment) => segment.kind === 'laser_suite') || {};
  const arcF2 = arcadesDe(f2) || {};
  v.push(verdict(f2.ok === true && arcF2.startTime === '11:00' && suiteF2.startTime && minutesDe(suiteF2.startTime) >= minutesDe(arcF2.endTime),
    'Formule 2 : la partie de laser a la suite passe apres les arcades choisies (11:00), jamais dessus', `${f2.code || ''} ${JSON.stringify({ arcades: [arcF2.startTime, arcF2.endTime], suite: [suiteF2.startTime, suiteF2.endTime] })}`));

  // 8. L attente dit son trou ; arriver plus tard, meme programme.
  poserEtat({ reservations: pleines('10:00', '12:00') });
  const tot = arriveeDe(await H.get({ type: 'formule', formuleId: 'f1', arrival: '10:00' }));
  const attenteAvant = friseDe(tot).find((segment) => segment.kind === 'wait' && segment.placement === 'before') || {};
  v.push(verdict(tot.ok === true && attenteAvant.gapStartTime === '10:10' && attenteAvant.gapEndTime === '12:00' && attenteAvant.gapMinutes === 110 && !('startTime' in attenteAvant),
    'pleines jusqu a 12:00 : l attente d avant le bowling dit son trou (10:10 a 12:00), pas d heure a elle', JSON.stringify(attenteAvant)));
  const later = tot.later || {};
  const plusTard = later.time ? arriveeDe(await H.get({ type: 'formule', formuleId: 'f1', arrival: later.time })) : {};
  v.push(verdict(Boolean(later.time) && minutesDe(later.time) > minutesDe('10:00') && later.savedMinutes > 0 && plusTard.ok === true
    && JSON.stringify(plusTard.anchors) === JSON.stringify(tot.anchors) && plusTard.waitMinutes === later.waitMinutes && tot.waitMinutes - plusTard.waitMinutes === later.savedMinutes,
    `arriver plus tard (${later.time}) : proposee avec l attente gagnee, le bowling et le laser aux memes heures, et c est la visite qu on aura`, JSON.stringify({ later, anchors: [tot.anchors, plusTard.anchors], attentes: [tot.waitMinutes, plusTard.waitMinutes] })));
  poserEtat({ reservations: [] });
  const sansAttente = arriveeDe(await H.get({ type: 'formule', formuleId: 'f3', arrival: '14:00' }));
  v.push(verdict(sansAttente.ok === true && sansAttente.waitMinutes === 0 && !sansAttente.later, 'sans attente avant la premiere activite, aucune arrivee plus tard', JSON.stringify([sansAttente.waitMinutes, sansAttente.later])));

  // 9. Des arcades sur la seule heure du bowling : le refus les nomme.
  poserEtat({ reservations: [...pleines('10:00', '12:00'), ...pleines('13:00', heureDe(fermeture))] });
  const sansArc = arriveeDe(await H.get({ type: 'formule', formuleId: 'f3', arrival: '10:00' }));
  const seule = arriveeDe(await H.get({ type: 'formule', formuleId: 'f3', arrival: '10:00', arcade: '12:00' }));
  v.push(verdict(sansArc.ok === true && (sansArc.anchors || {}).bowling === '12:00', 'MONTAGE F3, le bowling n est libre que de 12:00 a 13:00 : arriver a 10:00 se reserve, bowling 12:00', JSON.stringify(sansArc.anchors)));
  v.push(verdict(seule.ok === false && seule.code === 'arcade_overlap' && /arcades à 12:00/.test(String(seule.reason)) && /bowling/i.test(String(seule.reason)) && !seule.conflict,
    'des arcades a 12:00 prennent la seule heure du bowling : le refus dit les arcades, pas « complet »', `${seule.code} ${seule.reason}`));

  // 10. Le POST, sa signature, la modification au comptoir.
  poserEtat({ reservations: [] });
  const montre = arriveeDe(await H.get({ type: 'formule', formuleId: 'f1', arrival: '10:00', arcade: '10:30' }));
  const pref = { arrivalTime: '10:00', arcadeTime: '10:30', preferredTimes: montre.anchors || {}, laserGameTimes: montre.laserGameTimes || [], laserPlacement: 'scheduled', arrivalConfidence: 'normal' };
  const post = await verdictDuPost(H, corpsFormule('f1', '10:00', pref));
  const planPost = (post.ops && post.ops.opsPlan) || {};
  v.push(verdict(post.ok === true && etapeArcades(planPost).startTime === '10:30' && planPost.arrivalPlan && planPost.arrivalPlan.arcadeTime === '10:30' && heuresDuPlan(planPost) === JSON.stringify(montre.anchors || {}),
    'le POST avec preference.arcadeTime se reserve : arcades a 10:30, les heures montrees', post.ok ? JSON.stringify([etapeArcades(planPost).startTime, heuresDuPlan(planPost)]) : post.raison));
  const sig = JSON.parse(H.demande.signatureDemande(corpsFormule('f1', '10:00', pref)));
  const sigAutre = H.demande.signatureDemande(corpsFormule('f1', '10:00', { ...pref, arcadeTime: '11:00' }));
  const { arcadeTime: _arcade, ...prefSans } = pref;
  const sigSans = JSON.parse(H.demande.signatureDemande(corpsFormule('f1', '10:00', prefSans)));
  v.push(verdict(JSON.stringify(sig[sig.length - 1]) === JSON.stringify(['arcadeTime', '10:30']) && sigAutre !== JSON.stringify(sig) && JSON.stringify(sigSans) === JSON.stringify(sig.slice(0, -1)),
    'la signature porte l heure d arcade en dernier ; une autre heure est une autre demande ; sans elle, la signature d avant', JSON.stringify(sig.slice(-2))));
  const lire = async (date, centerId) => ({ date, centerId, laneStatuses: {}, reservations: reservationsDuJour(date, centerId) });
  const dossier = { ...corpsFormule('f1', '10:00', { arrivalConfidence: 'normal' }), id: 8101, opsPlan: planPost, ignoreReservationId: 8101 };
  const garde = await H.rops.prepareReservationOps({ ...dossier }, 'staff', { readState: lire });
  const decale = await H.rops.prepareReservationOps({ ...dossier, startTime: '11:00' }, 'staff', { readState: lire });
  const arcGarde = etapeArcades(garde.opsPlan);
  const arcDecale = etapeArcades(decale.opsPlan);
  v.push(verdict(arcGarde.startTime === '10:30' && garde.opsPlan && garde.opsPlan.arrivalPlan && garde.opsPlan.arrivalPlan.arcadeTime === '10:30',
    'modifier le dossier sans toucher a l heure garde les arcades a 10:30', JSON.stringify([arcGarde.startTime, garde.planRefusal || ''])));
  v.push(verdict(arcDecale.startTime === '11:30' && decale.opsPlan && decale.opsPlan.arrivalPlan && decale.opsPlan.arrivalPlan.arrivalTime === '11:00',
    'decale d une heure (arrivee 11:00), les arcades suivent (11:30)', JSON.stringify([arcDecale.startTime, decale.planRefusal || ''])));
  return v;
}

const MUTATIONS = [
  { nom: 'la borne d attente ne previent plus', fichier: 'lib/ops-engine.js',
    de: '  if (plan.waitMinutes > reglage.maxWaitMinutes) {', vers: '  if (false && plan.waitMinutes > reglage.maxWaitMinutes) {', scenarios: ['C'] },
  { nom: 'la borne de duree de visite ne previent plus', fichier: 'lib/ops-engine.js',
    de: '  if (plan.visitMinutes > maxVisitMinutes) {', vers: '  if (false && plan.visitMinutes > maxVisitMinutes) {', scenarios: ['D'] },
  { nom: 'la porte de la reservation ne previent plus des bornes (seule la recherche les lit)', fichier: 'lib/ops-engine.js',
    de: "      return { ok: true, code: '', reason: '', scenario: decorated, arrival: borne, warning: warning || avis };",
    vers: "      return { ok: true, code: '', reason: '', scenario: decorated, arrival: borne, ...(warning ? { warning } : {}) };", scenarios: ['C'] },
  { nom: 'une borne depassee refuse de nouveau l arrivee', fichier: 'lib/ops-engine.js',
    de: "      return { ok: true, code: '', reason: '', scenario: decorated, arrival: borne, warning: warning || avis };",
    vers: '      return { ok: false, code: borne.code, reason: borne.reason, scenario: decorated, arrival: borne };', scenarios: ['C', 'K'] },
  { nom: 'le libre ne remplit plus l attente avant la premiere ancre', fichier: 'lib/ops-engine.js',
    de: '  const rangees = meilleurRangement(trous.map((trou) => trou.fin - trou.debut), mobiles.map((rang) => libres[rang].minutes));',
    vers: '  const rangees = mobiles.map(() => -1);', scenarios: ['B'] },
  { nom: 'le choix ne prend plus la visite qui finit le plus tot', fichier: 'lib/ops-engine.js',
    de: '  const classer = (gauche, droite) => (gauche.raw.end - droite.raw.end)', vers: '  const classer = (gauche, droite) => (droite.raw.end - gauche.raw.end)', scenarios: ['B'] },
  { nom: 'les arcades perdent leur heure', fichier: 'lib/formula-visit.js',
    de: "const ACTIVITES_A_HEURE = Object.freeze(['arcade_time']);", vers: 'const ACTIVITES_A_HEURE = Object.freeze([]);', scenarios: ['B'] },
  { nom: 'le minigolf (et tout le libre) recoit une heure', fichier: 'lib/formula-visit.js',
    de: "  return Boolean(step && ACTIVITES_A_HEURE.includes(step.activityId)) && model.type !== 'open_range';", vers: '  return Boolean(step && step.activityId);', scenarios: ['E'] },
  { nom: 'les arcades ne passent plus en tete de l attente', fichier: 'lib/ops-engine.js',
    de: '    .sort((gauche, droite) => (Number(Boolean(libres[droite].aHeure)) - Number(Boolean(libres[gauche].aHeure))) || (gauche - droite));',
    vers: '    .sort((gauche, droite) => gauche - droite);', scenarios: ['E'] },
  { nom: 'la duree du minigolf ignore le reglage', fichier: 'lib/formula-visit.js',
    de: "  const borne = ouverte && policy === 'min' ? Number(model.minMinutes)\n    : ouverte && policy === 'max' ? Number(model.maxMinutes)\n      : 0;",
    vers: '  const borne = 0;', scenarios: ['E'] },
  { nom: 'le reglage par defaut change la duree du libre de toutes les formules', fichier: 'lib/formula-visit.js',
    de: "  freeDurationPolicy: 'default',\n});", vers: "  freeDurationPolicy: 'max',\n});", scenarios: ['A'] },
  { nom: 'le chemin de l arrivee prend les demandes sans arrivee (l heure de debut devient l arrivee)', fichier: 'lib/ops-engine.js',
    de: '  if (demandeUneArrivee(preference)) {\n    return planFormulaFromArrival(input, context, { center, formula, date, pax, preference });',
    vers: '  if (demandeUneArrivee({ arrivalTime: preference.arrivalTime || input.startTime })) {\n    return planFormulaFromArrival(input, context, { center, formula, date, pax, preference: { ...preference, arrivalTime: preference.arrivalTime || input.startTime } });',
    scenarios: ['A'] },
  { nom: 'le centre qui coupe l arrivee ne la coupe plus', fichier: 'lib/ops-engine.js',
    de: '  if (!reglage.arrivalFirst) {\n    return { ok: false, code: \'arrival_disabled\'', vers: '  if (false) {\n    return { ok: false, code: \'arrival_disabled\'', scenarios: ['H'] },
  { nom: 'une arrivee hors grille passe', fichier: 'lib/ops-engine.js',
    de: "  if (minutes % PROGRAM_GRID_MINUTES !== 0) {\n    return { ok: false, code: 'off_grid'", vers: "  if (false) {\n    return { ok: false, code: 'off_grid'", scenarios: ['H'] },
  { nom: 'une arrivee apres une ancre deja posee passe', fichier: 'lib/ops-engine.js',
    de: '    .find((window) => window.start < finAccueil);', vers: '    .find(() => false);', scenarios: ['H'] },
  { nom: 'l accueil ne compte plus : une ancre se pose a l heure d arrivee', fichier: 'lib/ops-engine.js',
    de: '  const finAccueil = arrivee + FORMULA_ARRIVAL_MINUTES;', vers: '  const finAccueil = arrivee;', scenarios: ['H'] },
  { nom: 'l accueil repart dix minutes avant l heure choisie', fichier: 'lib/ops-engine.js',
    de: '  const accueil = arrivee;', vers: '  const accueil = arrivee - FORMULA_ARRIVAL_MINUTES;', scenarios: ['B'] },
  { nom: 'la grille avec arrivee n est plus jugee avec elle (serveur)', fichier: 'api/public-availability.js',
    de: '            anchorMeta = formulaArrivalAnchorGrid({ centerId, date, formuleId, pax, duration, arrival: heureArrivee, preference: posees, anchorMeta, snapshot, guardFor: gardeDuPlan, proposees: entree.ok ? entree.anchors : null });',
    vers: '            void formulaArrivalAnchorGrid;', scenarios: ['K'] },
  { nom: 'la grille avec arrivee propose les heures de la journee sans arrivee', fichier: 'lib/availability-slots.js',
    de: '  return { ...anchorMeta, defaultTimes, activities };', vers: '  return { ...anchorMeta, activities };', scenarios: ['K'] },
  { nom: 'une heure de laser se juge seule, sans la partie deja posee', fichier: 'lib/availability-slots.js',
    de: '      essai.laserGameTimes = [...autres, time].sort();', vers: '      essai.laserGameTimes = [time];', scenarios: ['K'] },
  { nom: 'la grille avec arrivee perd l avis « serré » de l arrivee', fichier: 'lib/availability-slots.js',
    de: "        return { ...base, ok: true, code: '', reason: '', ...(verdict.endTime ? { endTime: verdict.endTime } : {}), ...(verdict.warning ? { warning: verdict.warning } : {}) };",
    vers: "        return { ...base, ok: true, code: '', reason: '', ...(verdict.endTime ? { endTime: verdict.endTime } : {}) };", scenarios: ['K'] },
  { nom: 'un refus pour la fermeture ne se rejuge plus avec l arrivee', fichier: 'lib/availability-slots.js',
    de: "  const REJUGES = new Set(['schedule', 'schedule_free']);", vers: '  const REJUGES = new Set();', scenarios: ['K'] },
  { nom: 'la liste des arrivees se juge sans les heures posees', fichier: 'api/public-availability.js',
    de: '                formulaArrivalEntries({ centerId, date, formuleId, pax, duration, preference: groupe.preference, times: groupe.times, snapshot, guardFor: gardeDuPlan, memo })',
    vers: '                formulaArrivalEntries({ centerId, date, formuleId, pax, duration, times: groupe.times, snapshot, guardFor: gardeDuPlan, memo })', scenarios: ['K'] },
  { nom: 'la liste juge chaque arrivee avec toutes les heures posees (le dernier choix ne gagne plus)', fichier: 'api/public-availability.js',
    de: '          const garde = (texte) => !(minutesDe(texte) < seuil);', vers: '          const garde = () => true;', scenarios: ['K'] },
  { nom: 'la liste libere aussi les heures posees apres l arrivee', fichier: 'api/public-availability.js',
    de: '          const garde = (texte) => !(minutesDe(texte) < seuil);', vers: '          const garde = () => false;', scenarios: ['K'] },
  { nom: 'la liste ne dit plus ce que l arrivee libere', fichier: 'api/public-availability.js',
    de: '.forEach((entree, rang) => verdicts.set(groupe.times[rang], groupe.releases.length ? { ...entree, releases: groupe.releases } : entree));',
    vers: '.forEach((entree, rang) => verdicts.set(groupe.times[rang], entree));', scenarios: ['K'] },
  { nom: 'une heure avant l arrivee se refuse de nouveau', fichier: 'lib/availability-slots.js',
    de: "        if (entry.ok === false) return entry;\n        const { endTime: _finSansArrivee, ...sansArrivee } = entry;",
    vers: "        return { time: entry.time, ok: false, code: debut < arrivee ? 'arrival_before' : 'arrival_welcome', reason: 'Avant votre arrivée.' };\n        const { endTime: _finSansArrivee, ...sansArrivee } = entry;", scenarios: ['K'] },
  { nom: 'une heure avant l arrivee perd son conflit « arrivee »', fichier: 'lib/availability-slots.js',
    de: "          conflict: { activityId: 'arrivee', label: 'Arrivée', time: heure },", vers: '', scenarios: ['K'] },
  // (Garder le refus sans arrivee d une heure d avant l arrivee ne se montre
  // pas ici : les journees du gate n ont aucune heure refusee pour la
  // fermeture avant une arrivee. La regle sert aux formules bornees dans la
  // journee et aux parties de laser deplacees.)
  { nom: 'la demi-heure de l accueil se dit « complet »', fichier: 'lib/ops-engine.js',
    de: '      .filter((item) => Number.isFinite(item.heure) && item.heure > premiereGrille)', vers: '      .filter((item) => Number.isFinite(item.heure) && item.heure > arrivee)', scenarios: ['K'] },
  { nom: 'l avis ne dit plus l heure posee qui le cause', fichier: 'lib/ops-engine.js',
    de: "    return posees.length ? `Avec ${posees.join(' et ')}` : '';", vers: "    return '';", scenarios: ['K'] },
  { nom: 'l avis perd sa cause (l ecran ne peut plus regrouper les attentes)', fichier: 'lib/ops-engine.js',
    de: '    return { ...verdict, warning: { ...verdict.warning, reason, ...(cause ? { cause } : {}) } };', vers: '    return { ...verdict, warning: { ...verdict.warning, reason } };', scenarios: ['C', 'K'] },
  { nom: 'la signature ignore l arrivee', fichier: 'lib/demande-publique.js',
    de: "    ...(arrivee ? [['arrivalTime', arrivee]] : []),", vers: '    ...([]),', scenarios: ['F'] },
  { nom: 'l ecart d une modification se mesure a la premiere ancre', fichier: 'lib/reservation-ops.js',
    de: '  const reference = Number.isFinite(arrivee) ? arrivee : Math.min(...starts);', vers: '  const reference = Math.min(...starts);', scenarios: ['F'] },
  { nom: 'une modification perd l arrivee de son plan', fichier: 'lib/reservation-ops.js',
    de: '  if (!Number.isFinite(arrivee) || demandeUneArrivee(preference)) return {};', vers: '  if (true) return {};', scenarios: ['F'] },
  { nom: 'une formule modifiee avec son programme perd l arrivee de son plan', fichier: 'lib/reservation-ops.js',
    de: '    ...(isEdit ? arriveeGardee(request, request.preference || {}, { shiftMinutes, times, laserGameTimes }) : {}),', vers: '    ...({}),', scenarios: ['F'] },
  { nom: 'le dossier du comptoir garde l heure envoyee au lieu de l arrivee', fichier: 'lib/reservation-ops.js',
    de: "    ...((channel === 'public' || modeArrivee) && recommended?.startTime ? { startTime: recommended.startTime } : {}),",
    vers: "    ...(channel === 'public' && recommended?.startTime ? { startTime: recommended.startTime } : {}),", scenarios: ['F'] },
  { nom: 'les alternatives d une arrivee refusee gardent l heure refusee', fichier: 'lib/reservation-alternatives.js',
    de: '            ? { ...(variant.preference || {}), arrivalTime: startTime }', vers: '            ? { ...(variant.preference || {}) }', scenarios: ['F'] },
  { nom: 'le POST ne lit plus les blocages du jour', fichier: 'lib/reservation-ops.js',
    de: '            ...(blocagesArrivee ? { blocks: blocagesArrivee } : {}),', vers: '            ...({}),', scenarios: ['G|pistes et laser bloques au planning 10:30-11:00'] },
  { nom: 'la liste des arrivees saute la garde finale de la creation', fichier: 'lib/availability-slots.js',
    de: '    const refus = finalGuardRefusal(slot, guardFor(recommended));', vers: "    const refus = '';", scenarios: ['G|bowling bloque au planning 10:00-10:30'] },
  { nom: 'le refus ne propose plus la premiere arrivee possible', fichier: 'api/public-availability.js',
    de: '          const premiere = possibles.length ? possibles[0].time : null;', vers: '          const premiere = null;', scenarios: ['H'] },
  { nom: 'les bornes ne donnent plus les minutes d accueil a l ecran', fichier: 'api/public-availability.js',
    de: '            welcomeMinutes: FORMULA_ARRIVAL_MINUTES,', vers: '', scenarios: ['I'] },
  { nom: 'la configuration chargee perd le reglage', fichier: 'lib/center-config.js',
    de: '    formulaVisit: normalizeFormulaVisit(merged.formulaVisit),', vers: '    formulaVisit: normalizeFormulaVisit(null),', scenarios: ['I'] },
  { nom: 'toEditableConfig perd le reglage', fichier: 'lib/center-config.js',
    de: '    formulaVisit: normalizeFormulaVisit(center.formulaVisit),', vers: '    formulaVisit: normalizeFormulaVisit(null),', scenarios: ['I'] },
  { nom: 'l ecran Etablissement ne recoit plus le reglage', fichier: 'lib/center-scope.js',
    de: '    // Etablissement pourra la montrer et la remettre dans ses champs.\n    formulaVisit: config.formulaVisit,',
    vers: '    // Etablissement pourra la montrer et la remettre dans ses champs.', scenarios: ['I'] },
  { nom: 'la meta publique ne donne plus le reglage', fichier: 'api/public-booking-meta.js',
    de: '        formulaVisit: normalizeFormulaVisit(center.formulaVisit),', vers: '        formulaVisit: undefined,', scenarios: ['I'] },
  // Les arcades a leur heure et le temps libre (2026-10-13).
  { nom: 'une heure d arcade choisie ne se pose plus', fichier: 'lib/ops-engine.js',
    de: '    libres[rangArcade] = { ...arcade, start: debutArcade };', vers: '    void debutArcade;', scenarios: ['L'] },
  { nom: 'des arcades pendant l accueil passent', fichier: 'lib/ops-engine.js',
    de: '    if (debutArcade < finAccueil) {', vers: '    if (false) {', scenarios: ['L'] },
  { nom: 'des arcades sur une activite a heure fixe passent', fichier: 'lib/ops-engine.js',
    de: '      .find((plage) => overlap(debutArcade, finArcade, plage.start, plage.end));', vers: '      .find(() => false);', scenarios: ['L'] },
  { nom: 'les parties a la suite restent sur les arcades', fichier: 'lib/ops-engine.js',
    de: '    if (laSuite && overlap(debutArcade, finArcade, laSuite.start, laSuite.end)) {', vers: '    if (false) {', scenarios: ['L'] },
  { nom: 'le libre recommence a l heure d arrivee, pendant l accueil', fichier: 'lib/ops-engine.js',
    de: '  const frise = rangerLesLibres({ debut: finAccueil, occupees: [...plagesAncres, ...suite], libres });',
    vers: '  const frise = rangerLesLibres({ debut: arrivee, occupees: [...plagesAncres, ...suite], libres });', scenarios: ['L'] },
  { nom: 'la porte de la reservation ne voit plus l heure d arcade', fichier: 'lib/ops-engine.js',
    de: '...(demandeArrivee ? { arrivalStart: demandeArrivee.minutes, arcadeStart } : {})', vers: '...(demandeArrivee ? { arrivalStart: demandeArrivee.minutes } : {})', scenarios: ['L'] },
  { nom: 'le refus des arcades ne nomme plus l activite posee qu elles chevauchent', fichier: 'lib/ops-engine.js',
    de: '  if (!sonde.ok) return refusArrivee(time, sonde.code, sonde.reason, sonde.conflict ? { conflict: sonde.conflict } : {});', vers: '  if (!sonde.ok) return refusArrivee(time, sonde.code, sonde.reason);', scenarios: ['L'] },
  { nom: 'un refus cause par les arcades se dit « complet »', fichier: 'lib/ops-engine.js',
    de: '  if (possibles.length && !mesurees.length && Number.isFinite(arcadeStart)) {', vers: '  if (false) {', scenarios: ['L'] },
  { nom: 'les attentes ne disent plus leur trou', fichier: 'lib/ops-engine.js',
    de: '      return { ...sansHeure, gapStartTime: minutesToTime(gapStart), gapEndTime: minutesToTime(gapEnd), gapMinutes: gapEnd - gapStart };', vers: '      return sansHeure;', scenarios: ['L'] },
  { nom: 'la duree naturelle oublie l accueil', fichier: 'lib/ops-engine.js',
    de: '  const naturelle = Math.max((finAccueil - arrivee) + occupeesMinutes + libresMinutes + transitions, tableMinutes);',
    vers: '  const naturelle = Math.max(occupeesMinutes + libresMinutes + transitions, tableMinutes);', scenarios: ['D'] },
  { nom: 'la grille des arcades ne part plus de la fin de l accueil', fichier: 'api/public-availability.js',
    de: '          if (finAccueil % 30 && finAccueil % 5 === 0 && finAccueil + duree <= fermeture) candidates.unshift(finAccueil);', vers: '', scenarios: ['L'] },
  { nom: 'la grille des arcades ne libere plus l activite posee', fichier: 'api/public-availability.js',
    de: "            liste.push(!verdict.ok && verdict.code === 'arcade_overlap' && posee", vers: '            liste.push(false', scenarios: ['L'] },
  { nom: 'une heure posee sur les arcades se refuse au lieu de les decaler', fichier: 'lib/availability-slots.js',
    de: "    if (verdict && verdict.ok === false && verdict.code === 'arcade_overlap' && essai.arcadeTime) {", vers: '    if (false) {', scenarios: ['L'] },
  { nom: 'la liste des arrivees garde les arcades posees avant l arrivee', fichier: 'api/public-availability.js',
    de: '          const arcadeGardee = Boolean(heureArcade) && garde(heureArcade);', vers: '          const arcadeGardee = Boolean(heureArcade);', scenarios: ['L'] },
  { nom: 'l arrivee plus tard n est plus proposee', fichier: 'api/public-availability.js',
    de: '            if (autre && autre.ok && memes(autre) && Number(autre.waitMinutes) < Number(entree.waitMinutes)) {', vers: '            if (false) {', scenarios: ['L'] },
  { nom: 'la signature ignore l heure d arcade', fichier: 'lib/demande-publique.js',
    de: "    ...(arcade ? [['arcadeTime', arcade]] : []),", vers: '    ...([]),', scenarios: ['L'] },
  { nom: 'une modification perd l heure d arcade', fichier: 'lib/reservation-ops.js',
    de: '    ...(garderArcade ? { arcadeTime: minutesToTime(timeToMinutes(arcade) + shiftMinutes) } : {}),', vers: '    ...({}),', scenarios: ['L'] },
  { nom: 'une modification decalee laisse les arcades a leur heure', fichier: 'lib/reservation-ops.js',
    de: '{ arcadeTime: minutesToTime(timeToMinutes(arcade) + shiftMinutes) }', vers: '{ arcadeTime: minutesToTime(timeToMinutes(arcade)) }', scenarios: ['L'] },
];

const SCENARIOS = {
  A: { titre: 'A. SANS HEURE D ARRIVEE, RIEN NE CHANGE', run: scenarioA },
  B: { titre: 'B. F1, 10 PERSONNES, TOUT EST PRIS DE 10:00 A 10:30, ARRIVEE 10:00', run: scenarioB },
  C: { titre: 'C. TOUT EST PRIS JUSQU A 12:00 : L ATTENTE DEPASSE LA BORNE', run: scenarioC },
  D: { titre: 'D. LA BORNE DE DUREE DE LA VISITE', run: scenarioD },
  E: { titre: 'E. LA DUREE DU MINIGOLF (freeDurationPolicy)', run: scenarioE },
  F: { titre: 'F. LE POST : DOSSIER, SIGNATURE, MODIFICATION, ALTERNATIVES', run: scenarioF },
  G: { titre: 'G. LA LISTE DES ARRIVEES ET LE POST, HEURE PAR HEURE', run: scenarioG },
  H: { titre: 'H. LE CENTRE COUPE L ARRIVEE ; LES HEURES QUI NE SE DEMANDENT PAS', run: scenarioH },
  I: { titre: 'I. LE REGLAGE TRAVERSE LA CONFIGURATION', run: scenarioI },
  K: { titre: 'K. LES HEURES DES ACTIVITES AVEC UNE ARRIVEE CHOISIE', run: scenarioK },
  L: { titre: 'L. LES ARCADES A LEUR HEURE, LE TEMPS LIBRE', run: scenarioL },
};

async function jouer(H, cle) {
  const [nom, journee] = cle.split('|');
  try {
    return journee ? await SCENARIOS[nom].run(H, [journee]) : await SCENARIOS[nom].run(H);
  } catch (error) {
    return [{ ok: false, label: `scenario ${cle} : exception`, detail: String((error && error.stack) || error).split('\n').slice(0, 3).join(' '), exception: true }];
  }
}

// L empreinte des fichiers du code : une contre-epreuve ne doit rien ecrire.
function empreinteDisque() {
  const hash = crypto.createHash('sha256');
  ['lib', 'api', 'ops-knowledge', 'scripts'].forEach((dossier) => {
    const parcourir = (rel) => {
      const absolu = path.join(ROOT, rel);
      fs.readdirSync(absolu, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1)).forEach((entree) => {
        const enfant = `${rel}/${entree.name}`;
        if (entree.isDirectory()) { if (entree.name !== 'node_modules') parcourir(enfant); return; }
        hash.update(enfant);
        hash.update(fs.readFileSync(path.join(ROOT, enfant)));
      });
    };
    parcourir(dossier);
  });
  return hash.digest('hex');
}

async function contreEpreuves() {
  const avant = empreinteDisque();
  let rougies = 0;
  for (const mutation of MUTATIONS) {
    Object.assign(mutation, { trouvee: -1, appliquee: 0 });
    ACTIVES = [mutation];
    let verdicts = [];
    try {
      const H = charger();
      for (const cle of mutation.scenarios) verdicts = verdicts.concat(await jouer(H, cle));
    } finally {
      ACTIVES = [];
    }
    const montable = mutation.trouvee === 1 && mutation.appliquee >= 1;
    if (!ok(montable, `contre-epreuve montable : ${mutation.nom} (${mutation.fichier})`, `ancre trouvee ${mutation.trouvee} fois, appliquee ${mutation.appliquee}`)) continue;
    const rouges = verdicts.filter((item) => !item.ok);
    const vraiRouge = rouges.some((item) => !item.exception);
    if (ok(vraiRouge, `${mutation.nom} : ce gate ROUGIT`, rouges.length ? `seulement des exceptions : ${rouges[0].detail}` : 'aucun verdict rouge')) rougies += 1;
    if (vraiRouge) console.log(`      (${rouges.filter((item) => !item.exception)[0].label})`);
  }
  const H = charger();
  const retour = [...await jouer(H, 'B'), ...await jouer(H, 'C')];
  ok(retour.every((item) => item.ok), 'le code d origine recharge : B et C sont verts de nouveau', retour.filter((item) => !item.ok).map((item) => item.label).join(' | '));
  ok(empreinteDisque() === avant, 'aucun fichier de lib/, api/, ops-knowledge/ ni scripts/ n a ete ecrit par les contre-epreuves');
  console.log(`\n[contre-epreuves] ${rougies}/${MUTATIONS.length} mutations font rougir ce gate`);
}

async function main() {
  const H = charger();
  DATE = choisirDate(H);
  if (!ok(Boolean(DATE), 'MONTAGE un samedi ou F1 et F3 se vendent, ouvert des 10:00')) {
    process.exit(1);
  }
  retenirDurees(H);
  console.log(`[date] samedi ${DATE}, Fun Galaxy Libramont, groupe de ${PAX}`);
  for (const cle of Object.keys(SCENARIOS)) {
    section(SCENARIOS[cle].titre);
    rapporter(await jouer(H, cle));
  }
  if (BASE) {
    section(`A+. LE DIFFERENTIEL CONTRE ${BASE}`);
    await differentiel(BASE);
  }
  if (MUTATE) {
    section('J. CONTRE-EPREUVES (mutations en memoire)');
    await contreEpreuves();
  }
  console.log(`\n${echecs === 0 ? 'formules-arrivee-check: ALL OK' : `formules-arrivee-check: ${echecs} echec(s)`}`);
  process.exit(echecs === 0 ? 0 : 1);
}

main().catch((error) => { console.error(error); process.exit(1); });

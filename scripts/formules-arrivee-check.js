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
//   [M] (2026-10-13, modele A, Movsar : « oui ok pour la A », l heure
//       d arcade « Facultatif », « lorsque il commence a louverture du
//       centre ils peuvent venir a lheure pile ») SANS heure d arrivee : les
//       arcades a l heure du client ouvrent la visite, le bowling et le laser
//       se proposent autour d elles et jamais dessus, une heure sur elles les
//       decale ; l arrivee dix minutes avant la premiere activite, a l heure
//       pile a l ouverture ; la liste des heures d arcade (arcades=1, de
//       l ouverture a la fermeture) qui libere l activite posee qu elle
//       chevauche ; le POST, la signature, la modification au comptoir ; les
//       mails qui ne disent plus « 10 minutes plus tot » a l ouverture.
//   [N] (2026-10-13, Movsar : « oui » a la Formule 4 au choix) « 60 min
//       d'arcades » a la place des deux parties de Laser Game : la variante
//       declaree au socle et servie par la meta, son programme lu sur la
//       carte servie (la base la reecrit), retiree quand la base n a plus le
//       laser ou que la carte ne le dit plus ; les variantes que le centre
//       coupe ou que le jour bloque ; sans variante ou avec la premiere, la
//       meme reponse au caractere pres, un identifiant inconnu refuse (409)
//       par les disponibilites, le blocage et la reservation ; la grille et
//       chaque creneau sans laser, avec les arcades de la variante, libres
//       ou posees, la liste des heures d arcade et une arrivee l arene prise ;
//       le POST l arene pleine, la signature ; la modification au comptoir,
//       decalee ou adaptee ; la garde de la base, le retard, le deplacement
//       du bowling et le dossier a placer qui n inventent aucune partie ; les
//       mails ; la console (planning, fiche, modification, resume et puces du
//       groupe, onglet Modifier).
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
    hold: (corps) => appeler(reservationsApi, 'POST', '/api/public-reservations?action=hold', null, corps),
    comms: () => require(path.join(ROOT, 'lib/ops-communications.js')),
    deplacer: () => require(path.join(ROOT, 'lib/reservation-activity-move.js')),
    fenetre: () => require(path.join(ROOT, 'lib/reserver-fenetre.js')),
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
  // La meta ne gagne que des cles : le reglage d arrivee du centre
  // (center.formulaVisit) et les variantes d une formule (formules[].choices,
  // lib/formula-choice), chacune comptee seulement quand le commit ne l a
  // pas ; tout le reste au caractere pres.
  const metaSansAjouts = metaApres.json ? JSON.parse(metaApres.body) : null;
  const ajoutees = [];
  const centreAvant = (metaAvant.json && metaAvant.json.center) || {};
  if (metaSansAjouts && metaSansAjouts.center && !('formulaVisit' in centreAvant) && 'formulaVisit' in metaSansAjouts.center) {
    delete metaSansAjouts.center.formulaVisit;
    ajoutees.push('center.formulaVisit');
  }
  const formulesAvant = new Map(((metaAvant.json && metaAvant.json.formules) || []).map((formule) => [formule.id, formule]));
  ((metaSansAjouts && metaSansAjouts.formules) || []).forEach((formule) => {
    const avantElle = formulesAvant.get(formule.id);
    if (avantElle && !('choices' in avantElle) && 'choices' in formule) {
      delete formule.choices;
      ajoutees.push(`formules[${formule.id}].choices`);
    }
  });
  ok(metaAvant.json && metaSansAjouts && JSON.stringify(metaAvant.json) === JSON.stringify(metaSansAjouts) && metaApres.json.center && metaApres.json.center.formulaVisit,
    `meta publique : identique a ${commit}, plus les seules cles ajoutees (${ajoutees.join(', ') || 'aucune'})`);
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
  // Sans heure d arrivee, l heure d arcade se pose aussi (modele A, [M]).
  const sansArrivee = await H.get({ type: 'formule', formuleId: 'f1', preferredTimes: { bowling: '15:00' } });
  const sansArriveeArcade = await H.get({ type: 'formule', formuleId: 'f1', preferredTimes: { bowling: '15:00' }, arcade: '16:30' });
  const planSansArrivee = (((sansArriveeArcade.json && sansArriveeArcade.json.slots) || [])[0] || {}).opsPlan || {};
  v.push(verdict(sansArrivee.status === 200 && sansArrivee.body !== sansArriveeArcade.body && etapeArcades(planSansArrivee).startTime === '16:30' && etapeArcades(planSansArrivee).flexible === false && !planSansArrivee.arrivalPlan,
    'sans heure d arrivee, une heure d arcade se pose aussi (16:30, etape a heure), sans plan d arrivee', JSON.stringify([etapeArcades(planSansArrivee).startTime, etapeArcades(planSansArrivee).flexible, Boolean(planSansArrivee.arrivalPlan)])));

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

// ---------------------------------------------------------------------------
// [M] LE MODELE A : SANS HEURE D ARRIVEE, LES ARCADES A L HEURE DU CLIENT
// ---------------------------------------------------------------------------
const premierCreneau = (rep) => ((rep && rep.json && rep.json.slots) || [])[0] || {};
const grilleDe = (rep, id) => ((((rep && rep.json && rep.json.anchors) || {}).activities || []).find((activite) => activite.activityId === id) || { times: [] }).times;
const heureDeLaGrille = (rep, id, heure) => grilleDe(rep, id).find((entree) => entree.time === heure) || {};
async function scenarioM(H) {
  const v = [];
  const fermeture = Math.round(Number(H.bookingConfig.getSchedule(DATE, H.knowledge.getCenter(CENTRE)).close) * 60);
  poserEtat({ reservations: [] });

  // 1. Des arcades a 13:00 sans heure d arrivee : la visite commence avec
  //    elles, le bowling et le laser s enchainent apres, l arrivee dix
  //    minutes avant.
  const a13 = await H.get({ type: 'formule', formuleId: 'f1', arcade: '13:00' });
  const c13 = premierCreneau(a13);
  const p13 = c13.opsPlan || {};
  const e13 = etapeArcades(p13);
  const h13 = (p13.anchorPlan && p13.anchorPlan.times) || {};
  v.push(verdict(a13.status === 200 && c13.time === '13:00' && e13.flexible === false && e13.startTime === '13:00' && e13.endTime === '13:30' && p13.anchorPlan && p13.anchorPlan.arcadeTime === '13:00' && !p13.arrivalPlan && !(a13.json && a13.json.arrival),
    'des arcades a 13:00, sans heure d arrivee : la visite commence avec elles (etape a heure, heure choisie au plan, aucun plan d arrivee)', JSON.stringify({ time: c13.time, etape: [e13.flexible, e13.startTime, e13.endTime], arcade: p13.anchorPlan && p13.anchorPlan.arcadeTime })));
  v.push(verdict(h13.bowling === '13:30' && minutesDe(h13.laser_game) >= minutesDe('14:30') && p13.arrivalTime === '12:50' && p13.arrivalMinutes === 10,
    'le bowling (13:30) et le laser s enchainent apres elles ; l arrivee dix minutes avant elles (12:50)', JSON.stringify({ heures: h13, arrivee: p13.arrivalTime, avance: p13.arrivalMinutes })));

  // 2. La grille se juge avec elles : une heure sur les arcades les decale
  //    (le dernier choix gagne), les autres se prennent.
  const b1300 = heureDeLaGrille(a13, 'bowling', '13:00');
  const b1230 = heureDeLaGrille(a13, 'bowling', '12:30');
  const b1200 = heureDeLaGrille(a13, 'bowling', '12:00');
  const l1300 = heureDeLaGrille(a13, 'laser_game', '13:00');
  v.push(verdict(b1300.ok === false && b1300.code === 'arcade_overlap' && b1300.conflict && b1300.conflict.activityId === 'arcade_time' && b1300.conflict.time === '13:00'
    && b1230.ok === false && b1230.code === 'arcade_overlap' && l1300.ok === false && l1300.code === 'arcade_overlap' && b1200.ok === true,
    'la grille avec arcades a 13:00 : le bowling a 12:30 et 13:00 et le laser a 13:00 les decalent (conflit arcade_time), le bowling a 12:00 se prend', JSON.stringify({ b1300, b1230, b1200: b1200.ok, l1300: l1300.code })));
  v.push(verdict(/arcades \(13:00\)/i.test(String(b1300.reason)) && /décale/.test(String(b1300.reason)) && a13.json.anchors.defaultTimes && a13.json.anchors.defaultTimes.bowling === '13:30',
    'leur raison dit les arcades qu elles decalent ; l heure proposee du bowling est celle du plan (13:30)', `${b1300.reason} ${JSON.stringify(a13.json.anchors && a13.json.anchors.defaultTimes)}`));

  // 3. Le bowling pose a 12:00, les arcades a 13:00 : le laser se propose
  //    apres elles, jamais dessus.
  const autour = await H.get({ type: 'formule', formuleId: 'f1', arcade: '13:00', preferredTimes: { bowling: '12:00' } });
  const hA = ((premierCreneau(autour).opsPlan || {}).anchorPlan || {}).times || {};
  v.push(verdict(hA.bowling === '12:00' && minutesDe(hA.laser_game) >= minutesDe('13:30'),
    'bowling pose a 12:00, arcades a 13:00 : le laser se propose apres elles (13:30), jamais sur elles', JSON.stringify(hA)));

  // 4. A l ouverture, l heure pile : sans rien choisir, la premiere visite
  //    commence a l ouverture et l arrivee aussi, accueil et table compris ;
  //    plus tard, dix minutes avant.
  const defaut = await H.get({ type: 'formule', formuleId: 'f1' });
  const d0 = premierCreneau(defaut);
  const pd = d0.opsPlan || {};
  const accueil = (pd.timeline || []).find((etape) => etape.label === 'Arrivée & accueil') || {};
  const ouverture = Math.round(Number(H.bookingConfig.getSchedule(DATE, H.knowledge.getCenter(CENTRE)).open) * 60);
  v.push(verdict(d0.time === heureDe(ouverture) && pd.arrivalTime === heureDe(ouverture) && pd.arrivalMinutes === 0 && accueil.startTime === heureDe(ouverture) && accueil.endTime === heureDe(ouverture),
    `a l ouverture (${heureDe(ouverture)}), l heure pile : l arrivee est celle de la premiere activite, avance 0, l accueil ne passe pas avant l ouverture`, JSON.stringify({ time: d0.time, arrivee: pd.arrivalTime, avance: pd.arrivalMinutes, accueil: [accueil.startTime, accueil.endTime] })));
  const phrase = String((pd.customerCommitment || [])[0] || '');
  v.push(verdict(/à l'ouverture : présentez-vous à/.test(phrase) && !/minutes avant/.test(phrase), 'la phrase au client dit l ouverture, jamais « 0 minutes avant »', phrase));
  const plusTard = premierCreneau(await H.get({ type: 'formule', formuleId: 'f1', preferredTimes: { bowling: heureDe(ouverture + 30) } })).opsPlan || {};
  v.push(verdict(plusTard.arrivalTime === heureDe(ouverture + 20) && plusTard.arrivalMinutes === 10 && /présentez-vous 10 minutes avant/.test(String((plusTard.customerCommitment || [])[0] || '')),
    `le bowling a ${heureDe(ouverture + 30)} : l arrivee dix minutes avant (${heureDe(ouverture + 20)}), la phrase le dit`, JSON.stringify([plusTard.arrivalTime, plusTard.arrivalMinutes])));
  const arcOuv = premierCreneau(await H.get({ type: 'formule', formuleId: 'f1', arcade: heureDe(ouverture) })).opsPlan || {};
  v.push(verdict(arcOuv.arrivalTime === heureDe(ouverture) && arcOuv.arrivalMinutes === 0 && etapeArcades(arcOuv).startTime === heureDe(ouverture),
    'des arcades a l ouverture : l arrivee a leur heure, sans avance', JSON.stringify([arcOuv.arrivalTime, arcOuv.arrivalMinutes, etapeArcades(arcOuv).startTime])));

  // 5. La liste des heures d arcade sans arrivee : de l ouverture a la
  //    fermeture, seule ; une heure sur le bowling pose se prend et le
  //    libere (le dernier choix gagne), les autres ne deplacent rien.
  const liste = await H.get({ type: 'formule', formuleId: 'f1', arcades: '1', preferredTimes: { bowling: '14:00' } });
  const heures = (liste.json && liste.json.arcadeTimes) || [];
  const parHeure = Object.fromEntries(heures.map((entree) => [entree.time, entree]));
  v.push(verdict(liste.status === 200 && heures.length > 10 && heures[0].time === heureDe(Math.ceil(ouverture / 30) * 30) && heures.every((entree) => minutesDe(entree.time) % 30 === 0 && minutesDe(entree.time) + 30 <= fermeture)
    && !(liste.json.slots || []).length && !liste.json.anchors && !liste.json.arrival,
    'la liste des heures d arcade sans arrivee part de l ouverture, demi-heure par demi-heure jusqu a la fermeture, seule (ni plan, ni grille, ni arrivee)', JSON.stringify(heures.slice(0, 3).map((entree) => entree.time))));
  const x1400 = parHeure['14:00'] || {};
  const x1330 = parHeure['13:30'] || {};
  v.push(verdict(x1400.ok === true && x1400.conflict && x1400.conflict.activityId === 'bowling' && x1400.conflict.time === '14:00' && x1330.ok === true && !x1330.conflict && Boolean(x1330.endTime),
    'arcades a 14:00, sur le bowling pose : se prennent et le liberent (conflit bowling) ; a 13:30, juste avant lui, sans rien deplacer, avec la fin de la visite', JSON.stringify({ x1400, x1330 })));
  // A la fin du bowling pose (15:00) : les arcades se prennent sans rien
  // deplacer, le laser se propose apres elles. Une heure proposee sur elles
  // faisait refuser cette heure (« Plus de visite possible »).
  const x1500 = parHeure['15:00'] || {};
  v.push(verdict(x1500.ok === true && !x1500.conflict,
    'arcades a 15:00, a la fin du bowling pose : se prennent sans rien deplacer (aucune heure proposee ne se pose sur elles)', JSON.stringify(x1500)));
  const libreBowling = premierCreneau(await H.get({ type: 'formule', formuleId: 'f1', arcade: '14:00' })).opsPlan || {};
  v.push(verdict(etapeArcades(libreBowling).startTime === '14:00' && ((libreBowling.anchorPlan || {}).times || {}).bowling !== '14:00',
    'le clic qui libere le bowling : arcades a 14:00, le bowling replace ailleurs', JSON.stringify((libreBowling.anchorPlan || {}).times)));

  // 6. Le POST, sa signature, la modification au comptoir.
  const montre = await H.get({ type: 'formule', formuleId: 'f1', arcade: '13:00' });
  const planMontre = premierCreneau(montre).opsPlan || {};
  const pref = { arcadeTime: '13:00', preferredTimes: (planMontre.anchorPlan || {}).times || {}, laserGameTimes: [], laserPlacement: 'scheduled', arrivalConfidence: 'normal' };
  const post = await verdictDuPost(H, corpsFormule('f1', '13:00', pref));
  const planPost = (post.ops && post.ops.opsPlan) || {};
  v.push(verdict(post.ok === true && etapeArcades(planPost).startTime === '13:00' && planPost.anchorPlan && planPost.anchorPlan.arcadeTime === '13:00' && !planPost.arrivalPlan && heuresDuPlan(planPost) === heuresDuPlan(planMontre),
    'le POST avec preference.arcadeTime, sans arrivee : arcades a 13:00, les heures montrees', post.ok ? JSON.stringify([etapeArcades(planPost).startTime, heuresDuPlan(planPost)]) : post.raison));
  const sig = JSON.parse(H.demande.signatureDemande(corpsFormule('f1', '13:00', pref)));
  const { arcadeTime: _arc, ...prefSans } = pref;
  const sigSans = JSON.parse(H.demande.signatureDemande(corpsFormule('f1', '13:00', prefSans)));
  v.push(verdict(JSON.stringify(sig[sig.length - 1]) === JSON.stringify(['arcadeTime', '13:00']) && !JSON.stringify(sig).includes('arrivalTime') && JSON.stringify(sigSans) === JSON.stringify(sig.slice(0, -1)),
    'la signature porte l heure d arcade sans arrivee, en dernier ; sans elle, la signature d avant', JSON.stringify(sig.slice(-2))));
  const lire = async (date, centerId) => ({ date, centerId, laneStatuses: {}, reservations: reservationsDuJour(date, centerId) });
  const dossier = { ...corpsFormule('f1', '13:00', { arrivalConfidence: 'normal' }), id: 8201, opsPlan: planPost, ignoreReservationId: 8201 };
  const garde = await H.rops.prepareReservationOps({ ...dossier }, 'staff', { readState: lire });
  const decale = await H.rops.prepareReservationOps({ ...dossier, startTime: '14:00' }, 'staff', { readState: lire });
  v.push(verdict(etapeArcades(garde.opsPlan).startTime === '13:00' && heuresDuPlan(garde.opsPlan) === heuresDuPlan(planPost),
    'modifier le dossier sans toucher a l heure garde les arcades a 13:00 et le bowling et le laser a leurs heures', JSON.stringify([etapeArcades(garde.opsPlan).startTime, heuresDuPlan(garde.opsPlan), garde.planRefusal || ''])));
  v.push(verdict(etapeArcades(decale.opsPlan).startTime === '14:00' && ((decale.opsPlan || {}).anchorPlan || {}).times && decale.opsPlan.anchorPlan.times.bowling === '14:30',
    'decale d une heure (14:00), les arcades et le bowling suivent (14:00, 14:30)', JSON.stringify([etapeArcades(decale.opsPlan).startTime, heuresDuPlan(decale.opsPlan), decale.planRefusal || ''])));

  // 7. Les mails : a l ouverture, l heure pile ; sinon dix minutes avant.
  const comms = H.comms();
  const dossierMail = (avance) => ({ id: 8301, centerId: CENTRE, date: DATE, startTime: '10:00', type: 'formule', formuleId: 'f1', pax: PAX, name: 'Client', email: 'client@example.test', phone: '+32470000000', opsPlan: { arrivalTime: avance ? '09:50' : '10:00', arrivalMinutes: avance, resourceBlocks: [], timeline: [] } });
  const texteMail = (avance, templateId, channel = 'email') => { const m = comms.buildMessage({ reservation: dossierMail(avance), templateId, channel }); return `${m.body || ''} ${m.preheader || ''}`; };
  const conf0 = texteMail(0, 'confirmation');
  const rap0 = texteMail(0, 'reminder_48h');
  const sms0 = texteMail(0, 'confirmation', 'sms');
  const conf10 = texteMail(10, 'confirmation');
  v.push(verdict(/Rendez-vous à 10:00 : l'équipe vous accueille/.test(conf0) && !/minutes plus tôt|minutes avant|min avant/.test(conf0 + rap0 + sms0) && /tout le groupe à 10:00/.test(rap0),
    'a l ouverture (avance 0), la confirmation, le rappel et le SMS disent l heure, jamais « 10 minutes plus tot »', [conf0, rap0, sms0].map((x) => x.slice(0, 160)).join(' || ')));
  v.push(verdict(/Merci d'arriver 10 minutes plus tôt/.test(conf10), 'avec une avance de 10 min, la confirmation dit toujours de venir 10 minutes plus tot', conf10.slice(0, 200)));
  return v;
}

// ---------------------------------------------------------------------------
// [N] LA FORMULE 4 AU CHOIX : 60 MIN D ARCADES A LA PLACE DES DEUX LASERS
// ---------------------------------------------------------------------------
// Movsar, le 13/10 : « oui » a la Formule 4 au choix, « 2 parties de Laser
// Game » (le contenu de sa carte, par defaut) ou « 60 min d'arcades » a leur
// place, au meme prix et avec la meme duree de carte. La variante se declare
// au socle de la formule (lib/booking-config, `choices`), lib/formula-choice
// la joue, le plan la garde (`opsPlan.formulaChoice`) et chaque relecture du
// dossier la reprend. Le scenario se joue par parties (N|grille, N|console...)
// pour qu une contre-epreuve ne rejoue que ce qu elle touche.
const blocsLaser = (plan) => ((plan && plan.resourceBlocks) || []).filter((bloc) => bloc && bloc.resourceType === 'laser_arena');
const etapeDuPlan = (plan, id) => ((plan && plan.timeline) || []).find((etape) => etape && etape.activityId === id) || {};
const varianteDuPlan = (plan) => (plan && plan.formulaChoice && plan.formulaChoice.id) || '';
function sansVariante(plan) {
  const { formulaChoice: _variante, ...reste } = plan || {};
  return reste;
}
// L arene prise de `debut` a `fin` : 30 joueurs a chaque demi-heure.
function arenePrise(debut, fin) {
  const dossiers = [];
  for (let t = minutesDe(debut); t < minutesDe(fin); t += 30) {
    prochainId += 1;
    dossiers.push({ id: prochainId, centerId: CENTRE, date: DATE, startTime: heureDe(t), duration: 0.5, pax: 30, type: 'laser', status: 'confirmed', validationStatus: 'confirmed', program: null,
      opsPlan: { resourceBlocks: [{ resourceType: 'laser_arena', activityId: 'laser_game', start: t, end: t + 25, startTime: heureDe(t), endTime: heureDe(t + 25), players: 30 }] } });
  }
  return dossiers;
}
// La variante « 60 min d'arcades », lue au socle de la Formule 4.
function varianteArcades(H) {
  const f4 = H.bookingConfig.FORMULES.find((formule) => formule.id === 'f4') || {};
  const socle = Array.isArray(f4.choices) ? f4.choices : [];
  const arcades = socle[1] || {};
  return { f4, socle, arcades, minutes: Number((((arcades.steps || [])[0]) || {}).durationMinutes) || 0 };
}
// La variante servie garde ce que le socle declare (identifiant, libelle, ce
// qu elle remplace et ce qu elle pose) ; son programme se juge a part.
const memeVariante = (servie, declaree) => Boolean(servie) && ['id', 'label', 'replaces', 'steps'].every((cle) => JSON.stringify(servie[cle]) === JSON.stringify(declaree[cle]));
// LA REGLE DU PROGRAMME D UNE VARIANTE : les lignes de la carte, celle du
// laser remplacee par les siennes a sa place, les autres telles quelles, et
// plus un mot de laser.
const parleDuLaser = (ligne) => /laser/i.test(String(ligne));
function programmeTenu(carte, programme, choix) {
  const siennes = ((choix && choix.descWith) || []).map(String);
  if (!Array.isArray(carte) || !Array.isArray(programme) || !siennes.length || !carte.some(parleDuLaser)) return false;
  const autres = programme.filter((ligne) => !siennes.includes(ligne));
  return siennes.every((ligne) => programme.includes(ligne)) && !programme.some(parleDuLaser)
    && programme.indexOf(siennes[0]) === carte.findIndex(parleDuLaser)
    && JSON.stringify(autres) === JSON.stringify(carte.filter((ligne) => !parleDuLaser(ligne)));
}
// Une ligne de la table formulas pour la Formule 4, avec la carte donnee.
function ligneDeLaBase(f4, lignes) {
  return {
    id: 'f4', owner_client_id: 'fungalaxy', name: f4.name, family: f4.family, min_pax: f4.minPax, price_type: f4.type, price_value: f4.price, price_old: f4.oldPrice,
    not_during_holidays: Boolean(f4.noHolidays), valid_days: null, time_limit_min_minutes: null, time_limit_max_minutes: null, human_validation: null, order_policy: null,
    is_birthday_formula: true, best: false, description_lines: lignes, sort_index: 4, source: 'seed', active: true,
  };
}
// Le refus d une variante inconnue : 409, son code, une phrase au client qui
// suit les regles d ecriture (lib/client-writing), sans promesse.
function refusDuChoix(rep) {
  const { verifierEcritureClient } = require(path.join(ROOT, 'lib/client-writing.js'));
  const message = String((rep && rep.json && rep.json.message) || '');
  return Boolean(rep) && rep.status === 409 && Boolean(rep.json) && rep.json.ok === false && rep.json.code === 'formula_choice_unavailable'
    && Boolean(message) && verifierEcritureClient(message, { etat: 'sans-promesse' }).length === 0;
}
// Le bowling pose a 15:00, avec ou sans la variante.
const preferenceDuBowling = (variante) => ({ preferredTimes: { bowling: '15:00' }, laserGameTimes: [], laserPlacement: 'scheduled', arrivalConfidence: 'normal', ...(variante ? { formulaChoice: variante.id } : {}) });
// Le dossier de reference : la Formule 4 aux arcades, le bowling a 15:00, cree
// par le coeur du POST sur une journee vide, puis enregistre tel quel.
async function dossierAuxArcades(H, arcades) {
  poserEtat({ reservations: [] });
  const cree = await verdictDuPost(H, corpsFormule('f4', '15:00', preferenceDuBowling(arcades)));
  const plan = (cree.ops && cree.ops.opsPlan) || {};
  const debut = (cree.ops && cree.ops.startTime) || '15:00';
  const montage = verdict(cree.ok && varianteDuPlan(plan) === arcades.id && !blocsLaser(plan).length,
    'MONTAGE le dossier de reference : la Formule 4 aux arcades, le bowling a 15:00, cree par le coeur du POST sur une journee vide',
    cree.ok ? JSON.stringify({ variante: varianteDuPlan(plan), laser: blocsLaser(plan).length }) : cree.raison);
  const existant = { ...corpsFormule('f4', debut), id: 8402, opsPlan: plan, lanes: (plan.assignedLanes || []).slice(), status: 'confirmed', validationStatus: 'confirmed', notes: '' };
  return { montage, plan, debut, existant };
}
// LA CONSOLE EN BAC A SABLE : booking-core entier, puis les fonctions de la
// fiche et du planning extraites d app-main. Une contre-epreuve sur ces
// fichiers s y applique comme le crochet de compilation (le disque n est
// jamais ecrit).
function sourceNavigateur(rel) {
  let texte = fs.readFileSync(path.join(ROOT, rel), 'utf8');
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
  return texte.split('\r\n').join('\n');
}
function laConsole() {
  const vm = require('vm');
  const bac = {
    window: {}, document: { addEventListener() {}, getElementById: () => null },
    console: { log() {}, warn() {}, error() {} },
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout, clearTimeout, state: { booking: {}, reservations: [] },
  };
  bac.globalThis = bac;
  vm.createContext(bac);
  vm.runInContext(sourceNavigateur('assets/booking-core.js'), bac, { timeout: 20000 });
  const app = sourceNavigateur('assets/app-main.js');
  const manquantes = [];
  ['escapeHtml', 'formulaActivityToken', 'getFormulaActivityIds', 'getFormulaFreePassIds', 'getFormulaLaserGameCount',
    'getLaserGameCountForReservation', 'buildEditProgramFromReservation', 'nomDeLaFormuleAchetee', 'resumeGroupe',
    'renderActivitesCourtes', 'formuleAcheteeDuDossier', 'renderEditFormuleBloc'].forEach((nom) => {
    const debut = app.indexOf(`\nfunction ${nom}(`);
    const fin = debut < 0 ? -1 : app.indexOf('\n}\n', debut + 1);
    if (fin < 0) { manquantes.push(nom); return; }
    vm.runInContext(app.slice(debut + 1, fin + 2), bac);
  });
  // Ce que le resume et l onglet Modifier lisent d autre, sans rapport avec la
  // formule : le comptoir (pas un manager), un dossier sans programme.
  vm.runInContext("var peutAdapterFormule = function () { return false; }, resumeProgrammeReservation = function () { return ''; };", bac);
  const appelle = (nom, ...args) => {
    const rendu = bac[nom](...args);
    return rendu === undefined ? null : JSON.parse(JSON.stringify(rendu));
  };
  return { manquantes, appelle };
}

const PARTIES_N = ['donnee', 'grille', 'post', 'comptoir', 'base', 'retard', 'planning', 'mails', 'console'];
async function scenarioN(H, seulement = null) {
  const inconnues = (seulement || []).filter((partie) => !PARTIES_N.includes(partie));
  if (inconnues.length) throw new Error(`scenario N : partie inconnue ${inconnues.join(', ')}`);
  const veut = (partie) => !seulement || seulement.includes(partie);
  const v = [];
  const { f4, socle, arcades, minutes } = varianteArcades(H);
  let reference = null;
  const laReference = async () => {
    if (!reference) {
      reference = await dossierAuxArcades(H, arcades);
      v.push(reference.montage);
    }
    return reference;
  };

  // 1. La donnee : le socle de la formule, la meta publique, le programme lu
  //    sur la carte servie (la base la reecrit), les variantes que le centre
  //    ou le jour ne jouent pas.
  if (veut('donnee')) {
    v.push(verdict(socle.map((choix) => choix.id).join(',') === 'laser2,arcade60' && minutes > 0 && Boolean(arcades.label) && (arcades.descReplaces || []).length > 0 && (arcades.descWith || []).length > 0,
      'MONTAGE le socle de la Formule 4 declare deux variantes : 2 parties de Laser Game (sa carte), puis 60 min d arcades, avec les mots de la carte qu elle remplace et ses lignes', JSON.stringify(socle)));
    const lireF4 = async () => ((((await H.meta({})).json || {}).formules || []).find((formule) => formule.id === 'f4')) || {};
    const meta = await H.meta({});
    const formulesMeta = (meta.json && meta.json.formules) || [];
    const metaF4 = formulesMeta.find((formule) => formule.id === 'f4') || {};
    const declarent = formulesMeta.filter((formule) => Array.isArray(formule.choices)).map((formule) => formule.id);
    const servies = Array.isArray(metaF4.choices) ? metaF4.choices : [];
    v.push(verdict(meta.status === 200 && servies.length === socle.length && socle.every((choix, rang) => memeVariante(servies[rang], choix)) && declarent.join(',') === 'f4' && metaF4.price === f4.price,
      'la meta publique sert les variantes du socle de la Formule 4, au prix de sa carte ; aucune autre formule n en declare',
      JSON.stringify({ meta: servies, declarent, prix: [metaF4.price, f4.price] })));
    v.push(verdict(programmeTenu(metaF4.desc, (servies[1] || {}).desc, arcades),
      'le programme de « 60 min d arcades » est la carte servie, sa ligne de laser remplacee par les siennes, les autres lignes telles quelles', JSON.stringify({ carte: metaF4.desc, variante: (servies[1] || {}).desc })));
    // LA CARTE DE LA BASE (en production, les cartes de F1 a F5 y sont
    // reecrites) : la variante garde les mots du centre. Une base qui retire
    // le laser de la formule, ou une carte qui ne le dit plus, retirent le
    // choix. Un seul identifiant declare n est pas un choix.
    const store = require(path.join(ROOT, 'lib/catalog-store.js'));
    const sousLaBase = async (etat) => {
      store.applyCatalogState({ centerClients: [{ id: CENTRE, client_id: 'fungalaxy' }], ...etat });
      try { return await lireF4(); } finally { store.applyCatalogState({}); }
    };
    const reecrite = ['1 partie de Minigolf Blacklight', '1 h de Bowling', '2 parties de Laser Game', '2 cruches de boissons'];
    const f4Reecrite = await sousLaBase({ formulas: [ligneDeLaBase(f4, reecrite)] });
    const varianteReecrite = (Array.isArray(f4Reecrite.choices) ? f4Reecrite.choices[1] : null) || {};
    v.push(verdict(JSON.stringify(f4Reecrite.desc) === JSON.stringify(reecrite) && programmeTenu(reecrite, varianteReecrite.desc, arcades),
      'la carte de la Formule 4 reecrite en base : « 60 min d arcades » garde les mots du centre, sa ligne de laser remplacee par les siennes', JSON.stringify({ carte: f4Reecrite.desc, variante: varianteReecrite.desc })));
    const f4SansLaser = await sousLaBase({
      formulas: [ligneDeLaBase(f4, f4.desc)],
      steps: [
        { formula_id: 'f4', owner_client_id: 'fungalaxy', position: 1, activity_id: 'minigolf_blacklight', count: 1 },
        { formula_id: 'f4', owner_client_id: 'fungalaxy', position: 2, activity_id: 'bowling', count: 1, duration_minutes: 60, critical: true },
      ],
    });
    const f4Muette = await sousLaBase({ formulas: [ligneDeLaBase(f4, f4.desc.filter((ligne) => !parleDuLaser(ligne)).concat(['2 parties en arene']))] });
    v.push(verdict(Array.isArray(f4SansLaser.desc) && !('choices' in f4SansLaser) && Array.isArray(f4Muette.desc) && !('choices' in f4Muette),
      'la base qui retire le laser de la Formule 4, ou sa carte qui ne le dit plus, retirent le choix : la variante remplacerait ce que la formule n a pas, ou ne saurait pas dire ce qu elle remplace',
      JSON.stringify({ sansLaser: f4SansLaser.choices || null, muette: f4Muette.choices || null })));
    const seule = require(path.join(ROOT, 'lib/formula-choice.js')).choixApplicables(socle.slice(0, 1), H.knowledge.getFormula('f4').steps, f4.desc);
    v.push(verdict(Array.isArray(seule) && seule.length === 0, 'une formule qui ne declare qu une variante n en propose aucune : il n y a rien a choisir', JSON.stringify(seule)));
    // LE LASER COUPE AU CENTRE : la variante des deux parties de laser dit ce
    // qui lui manque, celle des arcades se joue ; la formule garde le verdict
    // de sa carte, pour qui ne lit pas les variantes.
    const fiche = H.knowledge.getCenter(CENTRE);
    H.knowledge.applyCenterOverrides(new Map([[CENTRE, { activityAvailability: { ...(fiche.activityAvailability || {}), laser_game: false } }]]));
    let f4Coupee = {};
    try { f4Coupee = await lireF4(); } finally { H.knowledge.applyCenterOverrides(new Map()); }
    const [laserCoupe, arcadesSeules] = Array.isArray(f4Coupee.choices) ? f4Coupee.choices : [];
    v.push(verdict(Boolean(laserCoupe && arcadesSeules) && (laserCoupe.missingActivityIds || []).includes('laser_game') && !arcadesSeules.missingActivityIds && (f4Coupee.missingActivityIds || []).includes('laser_game'),
      'le laser coupe au centre : les deux parties de laser disent ce qui leur manque, « 60 min d arcades » se joue ; la Formule 4 garde le verdict de sa carte',
      JSON.stringify({ formule: f4Coupee.missingActivityIds || null, variantes: f4Coupee.choices || null })));
    // LE JOUR : une variante dont une ancre ou une activite qu elle pose est
    // bloquee toute la journee ne se propose pas.
    const leMeta = require(path.join(ROOT, 'api/public-booking-meta.js')).__test;
    const bloquees = (...ids) => ids.map((id, rang) => ({ id: 640 + rang, centerId: CENTRE, scopeType: 'activity', scopeRef: id, recurrence: 'once', date: DATE, startMin: null, endMin: null }));
    const leJour = (blocs) => leMeta.buildDayStatus(blocs, DATE, H.knowledge.getCenter(CENTRE), CENTRE);
    const ecarteesDe = (statut) => JSON.stringify(((statut && statut.unavailableFormulaChoiceIds) || {}).f4 || []);
    const jourLibre = leJour([]);
    const sansLaser = leJour(bloquees('laser_game'));
    const sansArcades = leJour(bloquees('arcade_time'));
    const sansRien = leJour(bloquees('laser_game', 'arcade_time'));
    v.push(verdict(!('unavailableFormulaChoiceIds' in jourLibre)
      && ecarteesDe(sansLaser) === JSON.stringify([socle[0].id]) && (sansLaser.unavailableFormulaIds || []).includes('f4')
      && ecarteesDe(sansArcades) === JSON.stringify([arcades.id]) && !(sansArcades.unavailableFormulaIds || []).includes('f4')
      && ecarteesDe(sansRien) === JSON.stringify([socle[0].id, arcades.id]),
      'le jour dit les variantes qui ne se jouent pas : le laser bloque ecarte les deux parties de laser, les arcades bloquees ecartent « 60 min d arcades », les deux les ecartent toutes ; la carte garde son verdict, sans blocage rien ne s ajoute',
      JSON.stringify({ libre: jourLibre.unavailableFormulaChoiceIds || null, laser: [sansLaser.unavailableFormulaChoiceIds || null, sansLaser.unavailableFormulaIds], arcades: sansArcades.unavailableFormulaChoiceIds || null, tout: sansRien.unavailableFormulaChoiceIds || null })));
    const calendrier = (leMeta.buildCalendar(bloquees('laser_game'), 1, H.knowledge.getCenter(CENTRE), CENTRE, DATE) || [])[0] || {};
    v.push(verdict(calendrier.date === DATE && ecarteesDe(calendrier) === JSON.stringify([socle[0].id]),
      'le calendrier du formulaire porte les variantes du jour', JSON.stringify(calendrier.unavailableFormulaChoiceIds || null)));
  }

  // 2. La grille et les creneaux. Sans variante ou avec la premiere : la meme
  //    reponse au caractere pres ; un identifiant inconnu se refuse.
  if (veut('grille')) {
    poserEtat({ reservations: [] });
    const ecarts = [];
    const montages = [];
    const premiere = socle.length ? socle[0].id : 'laser2';
    for (const demande of [{}, { preferredTimes: { bowling: '15:00' } }, { arcades: '1' }]) {
      const sans = await H.get({ type: 'formule', formuleId: 'f4', ...demande });
      const servie = sans.status === 200 && Boolean(sans.json) && sans.json.ok !== false && (demande.arcades ? Array.isArray(sans.json.arcadeTimes) : (sans.json.slots || []).length > 0);
      if (!servie) montages.push(`${JSON.stringify(demande)} ${sans.status}`);
      const avec = await H.get({ type: 'formule', formuleId: 'f4', ...demande, formulaChoice: premiere });
      if (avec.body !== sans.body) ecarts.push(`${JSON.stringify(demande)} formulaChoice=${premiere}`);
    }
    v.push(verdict(montages.length === 0, 'MONTAGE sans variante, la Formule 4 se sert (200, des creneaux ; la liste des heures d arcade)', montages.join(' | ')));
    v.push(verdict(ecarts.length === 0, 'avec la premiere variante (le contenu de la carte) : la Formule 4 rend la meme reponse au caractere pres', ecarts.join(' | ')));
    const inconnue = await H.get({ type: 'formule', formuleId: 'f4', formulaChoice: 'inconnue' });
    v.push(verdict(refusDuChoix(inconnue),
      'un identifiant que la formule ne declare pas se refuse (409, formula_choice_unavailable), avec une phrase qui suit les regles d ecriture au client', `${inconnue.status} ${String(inconnue.body).slice(0, 200)}`));

    const rep = await H.get({ type: 'formule', formuleId: 'f4', formulaChoice: arcades.id });
    const ancres = (rep.json && rep.json.anchors) || {};
    const aHeure = (ancres.activities || []).map((activite) => activite.activityId);
    const libres = (ancres.freePass || []).map((libre) => libre.activityId);
    v.push(verdict(rep.status === 200 && aHeure.join(',') === 'bowling' && ancres.laserGames === 0 && libres.includes('arcade_time') && libres.includes('minigolf_blacklight'),
      '« 60 min d arcades » : seul le bowling a une heure a choisir, aucune partie de laser, les arcades et le minigolf sont libres', JSON.stringify({ aHeure, laserGames: ancres.laserGames, libres })));
    const creneaux = (rep.json && rep.json.slots) || [];
    const fautifs = creneaux.filter((creneau) => {
      const plan = creneau.opsPlan || {};
      return blocsLaser(plan).length || Number(etapeDuPlan(plan, 'arcade_time').durationMinutes) !== minutes || !etapeDuPlan(plan, 'minigolf_blacklight').activityId || varianteDuPlan(plan) !== arcades.id;
    }).map((creneau) => creneau.time);
    v.push(verdict(creneaux.length >= 4 && fautifs.length === 0,
      `chaque creneau propose (${creneaux.length}) pose le bowling, le minigolf et ${minutes} min d arcades, aucun laser, et son plan garde la variante`, fautifs.slice(0, 4).join(', ') || `${creneaux.length} creneaux`));

    const pose = premierCreneau(await H.get({ type: 'formule', formuleId: 'f4', formulaChoice: arcades.id, preferredTimes: { bowling: '15:00' } })).opsPlan || {};
    const heuresPose = (pose.anchorPlan && pose.anchorPlan.times) || {};
    v.push(verdict(heuresPose.bowling === '15:00' && !('laser_game' in heuresPose) && !blocsLaser(pose).length && Number(etapeDuPlan(pose, 'arcade_time').durationMinutes) === minutes && varianteDuPlan(pose) === arcades.id,
      'le bowling pose a 15:00 : le plan le garde, sans laser, avec les arcades de la variante, et garde la variante', JSON.stringify({ heures: heuresPose, laser: blocsLaser(pose).length, variante: varianteDuPlan(pose) })));

    const a13 = premierCreneau(await H.get({ type: 'formule', formuleId: 'f4', formulaChoice: arcades.id, arcade: '13:00' })).opsPlan || {};
    const e13 = etapeDuPlan(a13, 'arcade_time');
    const fin13 = heureDe(minutesDe('13:00') + minutes);
    v.push(verdict(e13.flexible === false && e13.startTime === '13:00' && e13.endTime === fin13 && !blocsLaser(a13).length && varianteDuPlan(a13) === arcades.id,
      `les arcades posees a 13:00 durent les ${minutes} min de la variante (jusqu a ${fin13}), sans laser`, JSON.stringify([e13.startTime, e13.endTime, e13.flexible, blocsLaser(a13).length, varianteDuPlan(a13)])));

    // La liste des heures d arcade (arcades=1), l arene prise toute la
    // journee : avec la variante, ses heures se jugent sans laser, chacune dit
    // une fin apres les minutes de la variante, la derniere les laisse avant
    // la fermeture. Une arrivee se juge aussi avec elle.
    const horaire = H.bookingConfig.getSchedule(DATE, H.knowledge.getCenter(CENTRE));
    const fermeture = Math.round(Number(horaire.close) * 60);
    poserEtat({ reservations: arenePrise(heureDe(Math.round(Number(horaire.open) * 60)), heureDe(fermeture)) });
    const liste = await H.get({ type: 'formule', formuleId: 'f4', formulaChoice: arcades.id, arcades: '1' });
    const listeSans = await H.get({ type: 'formule', formuleId: 'f4', arcades: '1' });
    const heures = (liste.json && liste.json.arcadeTimes) || [];
    const prises = heures.filter((entree) => entree.ok);
    const derniere = prises.length ? prises[prises.length - 1] : null;
    const heuresSans = (listeSans.json && listeSans.json.arcadeTimes) || [];
    const finTropTot = (entree) => !entree.endTime || minutesDe(entree.endTime) < minutesDe(entree.time) + minutes;
    v.push(verdict(prises.length > 0 && heuresSans.length === 0 && Boolean(derniere) && minutesDe(derniere.time) + minutes <= fermeture && !prises.some(finTropTot),
      `l arene prise toute la journee, la liste des heures d arcade (arcades=1) existe avec la variante, jamais sans elle ; chaque heure dit une fin apres ses ${minutes} min, la derniere (${derniere && derniere.time}) les laisse avant la fermeture`,
      JSON.stringify({ prises: prises.length, derniere, sans: heuresSans.length, fautives: prises.filter(finTropTot).slice(0, 2) })));
    const arrivee = arriveeDe(await H.get({ type: 'formule', formuleId: 'f4', formulaChoice: arcades.id, arrival: '14:00' }));
    const segmentArcades = friseDe(arrivee).find((segment) => segment.activityId === 'arcade_time') || {};
    const dureeArcades = segmentArcades.startTime && segmentArcades.endTime ? minutesDe(segmentArcades.endTime) - minutesDe(segmentArcades.startTime) : Number(segmentArcades.minutes) || 0;
    v.push(verdict(arrivee.ok === true && !friseDe(arrivee).some((segment) => segment.activityId === 'laser_game') && dureeArcades === minutes,
      `l arene prise toute la journee, une arrivee a 14:00 se prend avec la variante : sa frise pose ${minutes} min d arcades et aucun laser`,
      JSON.stringify({ ok: arrivee.ok, code: arrivee.code, frise: friseDe(arrivee).map((segment) => [segment.kind, segment.activityId, segment.startTime, segment.endTime, segment.minutes]) })));
    poserEtat({ reservations: [] });
  }

  // 3. Le POST, l arene prise toute la journee : la variante se reserve, les
  //    deux lasers non. La signature du blocage porte la variante.
  if (veut('post')) {
    const horaire = H.bookingConfig.getSchedule(DATE, H.knowledge.getCenter(CENTRE));
    poserEtat({ reservations: arenePrise(heureDe(Math.round(Number(horaire.open) * 60)), heureDe(Math.round(Number(horaire.close) * 60))) });
    const corpsDefaut = corpsFormule('f4', '15:00', preferenceDuBowling(null));
    const corpsArcades = corpsFormule('f4', '15:00', preferenceDuBowling(arcades));
    const defaut = await verdictDuPost(H, corpsDefaut);
    const choisi = await verdictDuPost(H, corpsArcades);
    const planChoisi = (choisi.ops && choisi.ops.opsPlan) || {};
    v.push(verdict(!defaut.ok, 'MONTAGE l arene prise toute la journee : la Formule 4 et ses deux parties de laser ne se reservent pas', defaut.raison || 'reservee'));
    v.push(verdict(choisi.ok && !blocsLaser(planChoisi).length && Number(etapeDuPlan(planChoisi, 'arcade_time').durationMinutes) === minutes && varianteDuPlan(planChoisi) === arcades.id,
      'la meme demande avec « 60 min d arcades » se reserve : le dossier garde la variante et ses arcades, la garde de la base n invente aucune partie de laser',
      choisi.ok ? JSON.stringify({ laser: blocsLaser(planChoisi).length, variante: varianteDuPlan(planChoisi) }) : choisi.raison));
    const sigDefaut = JSON.parse(H.demande.signatureDemande(corpsDefaut));
    const sigArcades = JSON.parse(H.demande.signatureDemande(corpsArcades));
    v.push(verdict(sigArcades.length === sigDefaut.length + 1 && JSON.stringify(sigArcades.slice(0, -1)) === JSON.stringify(sigDefaut) && JSON.stringify(sigArcades[sigArcades.length - 1]) === JSON.stringify(['formulaChoice', arcades.id]),
      'la signature du blocage porte la variante en dernier, le reste identique ; sans elle, la signature d avant', JSON.stringify(sigArcades.slice(-1))));
    const sigPremiere = H.demande.signatureDemande(corpsFormule('f4', '15:00', { ...preferenceDuBowling(null), formulaChoice: socle[0].id }));
    v.push(verdict(sigPremiere === H.demande.signatureDemande(corpsDefaut),
      'la premiere variante (le contenu de la carte) signe comme la demande sans variante', sigPremiere.slice(-120)));
    // Une variante que la formule ne declare pas : le blocage et la
    // reservation publics se refusent, rien n est cree.
    poserEtat({ reservations: [] });
    const corpsInconnu = corpsFormule('f4', '15:00', { ...preferenceDuBowling(null), formulaChoice: 'inconnue' });
    const blocage = await H.hold(corpsInconnu);
    const reservation = await H.post(corpsInconnu);
    v.push(verdict(refusDuChoix(blocage) && refusDuChoix(reservation) && ETAT.creees.length === 0,
      'une variante que la formule ne declare pas : le blocage et la reservation se refusent (409, formula_choice_unavailable) et rien n est cree',
      JSON.stringify([blocage.status, blocage.json && blocage.json.code, reservation.status, reservation.json && reservation.json.code, ETAT.creees.length])));
  }

  // 4. La modification au comptoir garde la variante, decalee ou adaptee.
  if (veut('comptoir')) {
    const { plan, debut } = await laReference();
    const dossier = { ...corpsFormule('f4', debut), id: 8401, opsPlan: plan, ignoreReservationId: 8401 };
    const decale = await H.rops.prepareReservationOps({ ...dossier, startTime: heureDe(minutesDe(debut) + 30) }, 'staff', {});
    const planDecale = decale.opsPlan || {};
    v.push(verdict(varianteDuPlan(planDecale) === arcades.id && !blocsLaser(planDecale).length && Number(etapeDuPlan(planDecale, 'arcade_time').durationMinutes) === minutes,
      'decalee d une demi-heure au comptoir, sans rien renvoyer de la variante, la Formule 4 garde ses arcades, sans laser', JSON.stringify({ variante: varianteDuPlan(planDecale), laser: blocsLaser(planDecale).length, refus: decale.planRefusal || '' })));
    const programme = [
      { activityId: 'minigolf_blacklight', participants: PAX },
      { activityId: 'bowling', duration: 1, participants: PAX },
      { activityId: 'arcade_time', participants: PAX },
    ];
    const adaptee = await H.rops.prepareReservationOps({ ...dossier, program: programme }, 'staff', {});
    const planAdaptee = adaptee.opsPlan || {};
    v.push(verdict(Number(etapeDuPlan(planAdaptee, 'arcade_time').durationMinutes) === minutes && !blocsLaser(planAdaptee).length && varianteDuPlan(planAdaptee) === arcades.id,
      `adaptee au comptoir a son contenu (minigolf, bowling, arcades), elle part de la formule de la variante : ${minutes} min d arcades, sans laser, la variante gardee`,
      JSON.stringify({ arcades: etapeDuPlan(planAdaptee, 'arcade_time').durationMinutes, laser: blocsLaser(planAdaptee).length, variante: varianteDuPlan(planAdaptee), refus: adaptee.planRefusal || '' })));
  }

  // 5. Les dossiers du jour : la garde de la base ne prete pas de laser a la
  //    Formule 4 aux arcades.
  if (veut('base')) {
    const { existant } = await laReference();
    const laserDe25 = (heure) => ({ centerId: CENTRE, channel: 'public', name: 'Laser Gate', phone: '+32470000001', email: '', date: DATE, startTime: heure, duration: 0.5, totalDuration: 0.5,
      pax: 25, status: 'pending', basePrice: 0, price: 0, type: 'laser', label: '1 partie Laser Game', laneCount: 0, requiresLanes: false, opsPlan: null });
    const tiennent = (dossiers) => ['16:00', '16:30', '17:00'].filter((heure) => {
      try {
        H.database.validateReservationResources(laserDe25(heure), dossiers, {}, [], DATE);
        return true;
      } catch (error) {
        return false;
      }
    });
    const sansLaVariante = tiennent([{ ...existant, opsPlan: sansVariante(existant.opsPlan) }]);
    const avecLaVariante = tiennent([existant]);
    v.push(verdict(sansLaVariante.length < 3, 'MONTAGE sans la variante gardee, le meme dossier invente ses deux parties de laser apres le bowling et prend l arene', `tiennent : ${sansLaVariante.join(', ') || 'aucune'}`));
    v.push(verdict(avecLaVariante.length === 3, 'avec elle, la garde de la base n invente aucune partie : un groupe de 25 au laser a 16:00, 16:30 et 17:00 se reserve a cote de la Formule 4 aux arcades', `tiennent : ${avecLaVariante.join(', ') || 'aucune'}`));
  }

  // 6. Un retard se replanifie avec la variante.
  if (veut('retard')) {
    const { existant, debut } = await laReference();
    const pistesPrises = [];
    for (let piste = 1; piste <= 8; piste += 1) {
      prochainId += 1;
      pistesPrises.push({ id: prochainId, centerId: CENTRE, date: DATE, startTime: heureDe(minutesDe(debut) + 60), duration: 1, totalDuration: 1, pax: 6, lanes: [piste], laneCount: 1, type: 'bowling', status: 'confirmed', validationStatus: 'confirmed', program: null, opsPlan: null });
    }
    const retard = (dossierRetard) => {
      try {
        return H.engine.analyzeDelay({ centerId: CENTRE, date: DATE, reservation: dossierRetard, plan: dossierRetard.opsPlan, delayMinutes: 15 }, { reservations: pistesPrises, laneStatuses: {} });
      } catch (error) {
        return { alternatives: [], erreur: String((error && error.message) || error) };
      }
    };
    const avecLaser = (analyse) => (analyse.alternatives || []).filter((alternative) => (alternative.laser || []).length).length;
    const resume = (analyse) => JSON.stringify(analyse.erreur || (analyse.alternatives || []).map((alternative) => [alternative.startTime, (alternative.laser || []).length]));
    const retardSans = retard({ ...existant, opsPlan: sansVariante(existant.opsPlan) });
    const retardAvec = retard(existant);
    v.push(verdict((retardSans.alternatives || []).length > 0 && avecLaser(retardSans) > 0, 'MONTAGE un retard de 15 min heurte les pistes prises : sans la variante gardee, les solutions de rechange replanifient les deux parties de laser', resume(retardSans)));
    v.push(verdict((retardAvec.alternatives || []).length > 0 && avecLaser(retardAvec) === 0, 'avec elle, les solutions de rechange du retard gardent les arcades : aucune partie de laser', resume(retardAvec)));
  }

  // 7. Le planning : deplacer le bowling, un dossier a placer.
  if (veut('planning')) {
    const { existant } = await laReference();
    const deplacer = (dossierDeplace, heure) => {
      try {
        const rendu = H.deplacer().buildActivityMove(dossierDeplace, { activityId: 'bowling', startTime: heure, lanes: (dossierDeplace.lanes || []).slice() });
        return { ok: true, laser: blocsLaser(rendu.opsPlan).length, variante: varianteDuPlan(rendu.opsPlan) };
      } catch (error) {
        return { ok: false, raison: String((error && error.message) || error) };
      }
    };
    const deplaceSans = deplacer({ ...existant, opsPlan: sansVariante(existant.opsPlan) }, '17:30');
    const deplaceAvec = deplacer(existant, '17:30');
    v.push(verdict(deplaceSans.ok ? deplaceSans.laser > 0 : /laser/i.test(deplaceSans.raison), 'MONTAGE sans la variante gardee, deplacer le bowling fait apparaitre les deux parties de laser', JSON.stringify(deplaceSans)));
    v.push(verdict(deplaceAvec.ok && deplaceAvec.laser === 0 && deplaceAvec.variante === arcades.id, 'avec elle, le bowling se deplace a 17:30 sans faire apparaitre de laser, et le plan garde la variante', JSON.stringify(deplaceAvec)));
    const aPlacer = (dossierAPlacer) => H.fenetre().versAPlacer(dossierAPlacer, { conflits: [{ type: 'gate', message: 'Conflit de gate.' }], session: {}, demande: {} });
    const placeSans = aPlacer({ ...existant, opsPlan: sansVariante(existant.opsPlan) });
    const placeAvec = aPlacer(existant);
    v.push(verdict(Number(((placeSans.opsPlan || {}).laserPassPlan || {}).totalGames) > 0, 'MONTAGE sans la variante gardee, le dossier a placer attend ses parties de laser', JSON.stringify((placeSans.opsPlan || {}).laserPassPlan || null)));
    v.push(verdict(!(placeAvec.opsPlan || {}).laserPassPlan && varianteDuPlan(placeAvec.opsPlan) === arcades.id, 'avec elle, le dossier a placer garde la variante et n attend aucune partie de laser', JSON.stringify({ variante: varianteDuPlan(placeAvec.opsPlan), parties: (placeAvec.opsPlan || {}).laserPassPlan || null })));
  }

  // 8. Les mails disent le programme de la variante ; l equipe la lit.
  if (veut('mails')) {
    const { existant } = await laReference();
    const comms = H.comms();
    const client = { ...existant, name: 'Client Gate', email: 'client@example.test', phone: '+32470000000', label: 'FORMULE 4' };
    const corpsMail = (reservation, templateId) => String((comms.buildMessage({ reservation, templateId, channel: 'email' }) || {}).body || '');
    const confirmation = corpsMail(client, 'confirmation');
    const rappel = corpsMail(client, 'reminder_48h');
    // La regle, pas ses mots : une ligne du programme nomme les arcades ; le
    // laser n apparait nulle part.
    const ditLesArcades = (texte) => texte.split('\n').some((ligne) => /arcade/i.test(ligne));
    v.push(verdict(ditLesArcades(confirmation) && ditLesArcades(rappel) && !/laser/i.test(confirmation + rappel),
      'la confirmation et le rappel disent les arcades de la variante et ne parlent jamais de laser', [confirmation, rappel].map((texte) => texte.replace(/\n/g, ' / ').slice(0, 300)).join(' || ')));
    const rappelSans = corpsMail({ ...client, opsPlan: sansVariante(client.opsPlan) }, 'reminder_48h');
    v.push(verdict(/laser/i.test(rappelSans), 'MONTAGE sans variante, le rappel d une formule garde sa phrase d avant sur le laser', rappelSans.replace(/\n/g, ' / ').slice(-260)));
    const offreDe = (plan) => {
      const message = comms.buildMessage({ reservation: { ...client, opsPlan: { ...plan, validation: { mode: 'staff_review', raison: 'formule' } } }, templateId: 'staff_review_request', channel: 'email' }) || {};
      return ((message.details || []).find((detail) => detail.label === 'Offre') || {}).value || '';
    };
    const offre = offreDe(client.opsPlan);
    const offreSans = offreDe(sansVariante(client.opsPlan));
    v.push(verdict(Boolean(offreSans) && !offreSans.includes(arcades.label) && offre.startsWith(offreSans) && offre.endsWith(arcades.label),
      'le mail de validation de l equipe nomme la variante avec l offre ; sans elle, l offre d avant', JSON.stringify({ offre, offreSans })));
  }

  // 9. La console : le planning, la fiche, la modification, le resume et les
  //    puces de la carte du groupe, l onglet Modifier.
  if (veut('console')) {
    const { plan, debut } = await laReference();
    const vue = laConsole();
    const pourConsole = { id: 8403, centerId: CENTRE, date: DATE, startTime: debut, type: 'formule', formuleId: 'f4', label: 'FORMULE 4', pax: PAX, duration: 1, lanes: (plan.assignedLanes || []).slice(), opsPlan: plan };
    const consoleSans = { ...pourConsole, opsPlan: sansVariante(plan) };
    v.push(verdict(vue.manquantes.length === 0, 'MONTAGE la console en bac a sable : booking-core entier et les fonctions de la fiche extraites d app-main', vue.manquantes.join(', ')));
    if (!vue.manquantes.length) {
      const sessions = (dossierConsole) => vue.appelle('getFormulaLaserFallbackWindows', dossierConsole).length;
      v.push(verdict(sessions(consoleSans) > 0 && sessions(pourConsole) === 0, 'le planning de la console n estime aucune session de laser pour la variante (sans elle, ses sessions estimees)', JSON.stringify([sessions(pourConsole), sessions(consoleSans)])));
      const fiche = (dossierConsole) => vue.appelle('getFormulaActivityChecklist', dossierConsole).map((item) => item.activityId);
      v.push(verdict(fiche(consoleSans).includes('laser_game') && !fiche(pourConsole).includes('laser_game') && fiche(pourConsole).includes('arcade_time'), 'la fiche liste les arcades de la variante, aucune partie de laser', JSON.stringify({ avec: fiche(pourConsole), sans: fiche(consoleSans) })));
      const parties = (dossierConsole) => vue.appelle('getLaserGameCountForReservation', dossierConsole);
      v.push(verdict(parties(consoleSans) > 0 && parties(pourConsole) === 0, 'la console ne compte aucune partie de laser a la variante', JSON.stringify([parties(pourConsole), parties(consoleSans)])));
      const modif = vue.appelle('buildEditProgramFromReservation', pourConsole) || {};
      const modifSans = vue.appelle('buildEditProgramFromReservation', consoleSans) || {};
      const on = (etat, id) => Boolean(etat && etat[id] && etat[id].on);
      v.push(verdict(on(modifSans, 'laser_game') && !on(modif, 'laser_game') && on(modif, 'bowling') && Boolean(modif.others && modif.others.arcade_time),
        'la modification repart du contenu de la variante : le bowling et les arcades, sans laser', JSON.stringify({ avec: [modif.laser_game, modif.others], sans: [modifSans.laser_game, modifSans.others] })));
      // Le resume et les puces de la carte du groupe (surfaces vivantes du
      // planning) nomment la variante avec la formule.
      const nommee = (dossierConsole) => [String(vue.appelle('resumeGroupe', dossierConsole) || ''), String(vue.appelle('renderActivitesCourtes', dossierConsole) || '')];
      const [resumeAvec, pucesAvec] = nommee(pourConsole);
      const [resumeSans, pucesSans] = nommee(consoleSans);
      const echappee = String(vue.appelle('escapeHtml', arcades.label) || '');
      v.push(verdict(Boolean(resumeSans) && resumeAvec.includes(resumeSans) && resumeAvec.includes(arcades.label) && !resumeSans.includes(arcades.label)
        && Boolean(echappee) && pucesAvec.includes(echappee) && !pucesSans.includes(echappee) && !parleDuLaser(resumeAvec + pucesAvec),
        'le resume et les puces de la carte du groupe nomment la variante avec la formule, aucun laser ; sans elle, le nom seul', JSON.stringify({ resumeAvec, resumeSans, pucesAvec })));
      // L onglet Modifier, au comptoir : le contenu que le dossier a achete.
      const ongletModifier = (dossierConsole) => {
        const formule = vue.appelle('formuleAcheteeDuDossier', dossierConsole);
        return String(vue.appelle('renderEditFormuleBloc', dossierConsole, formule, (formule && formule.desc) || []) || '').replace(/\s+/g, ' ');
      };
      const modifierAvec = ongletModifier(pourConsole);
      const modifierSans = ongletModifier(consoleSans);
      v.push(verdict(/arcade/i.test(modifierAvec) && !parleDuLaser(modifierAvec) && parleDuLaser(modifierSans),
        'l onglet Modifier (comptoir) recopie le contenu de la variante : les arcades, aucun laser ; sans elle, celui de la carte', JSON.stringify({ avec: modifierAvec.slice(0, 300), sans: modifierSans.slice(0, 200) })));
    }
  }
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
    de: '  const reference = Number.isFinite(arrivee) ? arrivee : Math.min(...starts, ...(Number.isFinite(arcade) ? [arcade] : []));', vers: '  const reference = Math.min(...starts);', scenarios: ['F', 'M'] },
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
    de: 'bowlingConfig, arcadeStart, ...(demandeArrivee ? { arrivalStart: demandeArrivee.minutes } : {}) });', vers: 'bowlingConfig, ...(demandeArrivee ? { arrivalStart: demandeArrivee.minutes } : {}) });', scenarios: ['L', 'M'] },
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
  // Le modele A : sans heure d arrivee (2026-10-13).
  { nom: 'sans arrivee, l heure d arcade ne se pose plus', fichier: 'lib/ops-engine.js',
    de: '  if (sansArrivee && arcadeStart !== null && arcadeStart !== undefined && Number.isFinite(Number(arcadeStart))) {', vers: '  if (false) {', scenarios: ['M'] },
  { nom: 'sans arrivee, des arcades sur une activite a heure fixe passent', fichier: 'lib/ops-engine.js',
    de: '      const heurtee = orderedWindows.find((window) => overlap(arcade.start, arcade.end, window.start, window.end));', vers: '      const heurtee = null;', scenarios: ['M'] },
  { nom: 'la visite ne commence plus avec les arcades', fichier: 'lib/ops-engine.js',
    de: '  const firstStart = Math.min(...anchorBlocks.map((block) => block.start), ...(arcadeFixee ? [arcadeFixee.start] : []));', vers: '  const firstStart = Math.min(...anchorBlocks.map((block) => block.start));', scenarios: ['M'] },
  { nom: 'l arrivee passe de nouveau avant l ouverture', fichier: 'lib/ops-engine.js',
    de: '  const posee = demandeArrivee ? raw : arriveeALOuverture(raw, window.open);', vers: '  const posee = raw;', scenarios: ['M'] },
  { nom: 'la phrase au client dit « 0 minutes avant » a l ouverture', fichier: 'lib/ops-engine.js',
    de: '    customerCommitment.unshift(avance > 0', vers: '    customerCommitment.unshift(true', scenarios: ['M'] },
  { nom: 'le creneau change une avance de 0 minute en rien', fichier: 'lib/availability-slots.js',
    de: '      arrivalMinutes: Number.isFinite(scenario.arrivalMinutes) ? scenario.arrivalMinutes : null,', vers: '      arrivalMinutes: scenario.arrivalMinutes || null,', scenarios: ['M'] },
  { nom: 'la grille des activites ne voit plus les arcades choisies', fichier: 'api/public-availability.js',
    de: '      const arcadeDeLaGrille = !demandeArrivee && !listeArcadesSansArrivee && heureArcade ? { arcadeTime: heureArcade } : {};', vers: '      const arcadeDeLaGrille = {};', scenarios: ['M'] },
  { nom: 'une heure sur les arcades se refuse au lieu de les decaler (sans arrivee)', fichier: 'lib/ops-engine.js',
    de: '  if (arcadeEnCause && Number.isFinite(arcadeStart)) {', vers: '  if (false) {', scenarios: ['M'] },
  { nom: 'les heures proposees se posent sur les arcades', fichier: 'lib/ops-engine.js',
    de: '  const libre = (debut, activityId) => !arcade || !overlap(debut, debut + placeDe(activityId), arcade.start, arcade.end);', vers: '  const libre = () => true;', scenarios: ['M'] },
  { nom: 'sans heure retenue, les heures proposees ne partent plus des arcades', fichier: 'lib/ops-engine.js',
    de: '  if (!ancre && arcade && firstStart === null) {', vers: '  if (false) {', scenarios: ['M'] },
  { nom: 'la liste des heures d arcade sans arrivee se tait', fichier: 'api/public-availability.js',
    de: '        if (listeArcadesSansArrivee) {', vers: '        if (false) {', scenarios: ['M'] },
  { nom: 'la liste des heures d arcade sans arrivee ne libere plus l activite posee', fichier: 'api/public-availability.js',
    de: '          if (!touchee) {', vers: '          if (true) {', scenarios: ['M'] },
  { nom: 'la demande avec arcades seules ne compose plus autour d elles', fichier: 'api/public-availability.js',
    de: '          || Boolean(heureArcade);', vers: '          || false;', scenarios: ['M'] },
  { nom: 'le plan demande sans l heure d arcade', fichier: 'api/public-availability.js',
    de: '                ...(heureArcade ? { arcadeTime: heureArcade } : {}),', vers: '', scenarios: ['M'] },
  { nom: 'la signature ne porte l heure d arcade qu avec une arrivee', fichier: 'lib/demande-publique.js',
    de: "  const arcade = pref.arcadeTime !== undefined && pref.arcadeTime !== null ? String(pref.arcadeTime).trim().slice(0, 5) : '';", vers: "  const arcade = arrivee && pref.arcadeTime !== undefined && pref.arcadeTime !== null ? String(pref.arcadeTime).trim().slice(0, 5) : '';", scenarios: ['M'] },
  { nom: 'une modification perd les arcades sans arrivee', fichier: 'lib/reservation-ops.js',
    de: '    ...arcadeGardee(request, preference, { shiftMinutes }),', vers: '    ...({}),', scenarios: ['M'] },
  { nom: 'le mail redit « 10 minutes plus tot » a l ouverture', fichier: 'lib/ops-communications.js',
    de: '      : Math.max(0, Math.round(Number(avanceDuPlan)));', vers: '      : Math.max(0, Math.round(Number(avanceDuPlan))) || 10;', scenarios: ['M'] },
  // La Formule 4 au choix (2026-10-13).
  { nom: 'le catalogue ne relaie plus les variantes du socle', fichier: 'lib/catalog-store.js',
    de: '  if (choix.length) formule.choices = choix;', vers: '', scenarios: ['N|donnee'] },
  { nom: 'le programme de la variante repart du texte du socle', fichier: 'lib/catalog-store.js',
    de: '  const choix = choixApplicables(canonical.choices, canonical.steps, formule.desc);',
    vers: '  const choix = choixApplicables(canonical.choices, canonical.steps, (BOOKING_BASE_BY_ID.get(canonical.id) || {}).desc);', scenarios: ['N|donnee'] },
  { nom: 'une variante remplace une activite que la formule n a pas', fichier: 'lib/formula-choice.js',
    de: 'remplacees.length > 0 && remplacees.every((activityId) => presentes.has(activityId))', vers: 'remplacees.length > 0', scenarios: ['N|donnee'] },
  { nom: 'une variante qui ne sait pas dire ce qu elle remplace se propose', fichier: 'lib/formula-choice.js',
    de: '    return Boolean(programmes[rang]);', vers: '    return true;', scenarios: ['N|donnee'] },
  { nom: 'une seule variante declaree se propose', fichier: 'lib/formula-choice.js',
    de: '  if (liste.length < 2) return [];\n  const presentes', vers: '  const presentes', scenarios: ['N|donnee'] },
  { nom: 'le centre juge chaque variante sur la carte', fichier: 'api/public-booking-meta.js',
    de: '    const absentes = absentesDuDocument(rang > 0 ? formuleAvecChoix(doc, choix) : doc, availability);', vers: '    const absentes = absentesDuDocument(doc, availability);', scenarios: ['N|donnee'] },
  { nom: 'le jour juge chaque variante sur les ancres de la carte', fichier: 'api/public-booking-meta.js',
    de: '        const jouee = rang > 0 ? formuleAvecChoix(doc, choix) : doc;', vers: '        const jouee = doc;', scenarios: ['N|donnee'] },
  { nom: 'le jour ne regarde pas ce que la variante pose', fichier: 'api/public-booking-meta.js',
    de: '          || siennes.some((id) => unavailableActivityIds.includes(id));', vers: '          || false;', scenarios: ['N|donnee'] },
  { nom: 'le calendrier perd les variantes du jour', fichier: 'api/public-booking-meta.js',
    de: '      ...(status.unavailableFormulaChoiceIds ? { unavailableFormulaChoiceIds: status.unavailableFormulaChoiceIds } : {}),', vers: '', scenarios: ['N|donnee'] },
  { nom: 'la premiere variante joue la suivante', fichier: 'lib/formula-choice.js',
    de: '  return rang > 0 ? liste[rang] : null;', vers: '  return rang > 0 ? liste[rang] : liste[1] || null;', scenarios: ['N|grille'] },
  { nom: 'une variante inconnue se joue sur la carte (disponibilites)', fichier: 'api/public-availability.js',
    de: '      if (choixInconnu(formuleId, choixFormule)) {', vers: '      if (false) {', scenarios: ['N|grille'] },
  { nom: 'les heures d arcade se jugent sans la variante', fichier: 'api/public-availability.js',
    de: "            preference: avecChoix({ preferredTimes: completes, laserGameTimes: partiesCompletes, laserPlacement, arrivalConfidence: 'normal', arcadeTime: time }),",
    vers: "            preference: { preferredTimes: completes, laserGameTimes: partiesCompletes, laserPlacement, arrivalConfidence: 'normal', arcadeTime: time },", scenarios: ['N|grille'] },
  { nom: 'une arrivee se juge sans la variante', fichier: 'api/public-availability.js',
    de: '          ...(heureArcade ? { arcadeTime: heureArcade } : {}),\n          ...(variante ? { formulaChoice: variante.id } : {}),\n        };',
    vers: '          ...(heureArcade ? { arcadeTime: heureArcade } : {}),\n        };', scenarios: ['N|grille'] },
  { nom: 'la grille des activites ignore la variante (moteur)', fichier: 'lib/ops-engine.js',
    de: '  const formula = formuleAvecChoix(formuleBrute, varianteDemandee(formuleBrute && formuleBrute.id, input.formulaChoice));', vers: '  const formula = formuleBrute;', scenarios: ['N|grille'] },
  { nom: 'la grille des activites se demande sans la variante (serveur)', fichier: 'api/public-availability.js',
    de: '...arcadeDeLaGrille, ...(variante ? { formulaChoice: variante.id } : {}) }, engineContext);', vers: '...arcadeDeLaGrille }, engineContext);', scenarios: ['N|grille'] },
  { nom: 'le serveur ne lit plus la variante demandee', fichier: 'api/public-availability.js',
    de: '      const variante = varianteDemandee(formuleId, choixFormule);', vers: '      const variante = null;', scenarios: ['N|grille'] },
  { nom: 'le plan d une heure posee se demande sans la variante', fichier: 'api/public-availability.js',
    de: '                ...(heureArcade ? { arcadeTime: heureArcade } : {}),\n                ...(variante ? { formulaChoice: variante.id } : {}),', vers: '                ...(heureArcade ? { arcadeTime: heureArcade } : {}),', scenarios: ['N|grille'] },
  { nom: 'le plan ne garde plus la variante jouee', fichier: 'lib/ops-engine.js',
    de: '    ...(formula && formula.formulaChoice ? { formulaChoice: formula.formulaChoice } : {}),', vers: '', scenarios: ['N|grille'] },
  { nom: 'le creneau perd la variante de son plan', fichier: 'lib/availability-slots.js',
    de: '      ...(scenario.formulaChoice ? { formulaChoice: scenario.formulaChoice } : {}),', vers: '', scenarios: ['N|grille'] },
  { nom: 'le moteur ignore la variante de la demande', fichier: 'lib/ops-engine.js',
    de: '  const avecChoix = formuleAvecChoix(rawFormula, varianteDemandee(rawFormula && rawFormula.id, preference.formulaChoice));', vers: '  const avecChoix = rawFormula;', scenarios: ['N|post'] },
  { nom: 'la garde de la base invente les deux lasers de la carte', fichier: 'lib/database.js',
    de: "    formula = require('./formula-choice').formuleDuDossier(getFormula(reservation.formuleId), reservation);", vers: '    formula = getFormula(reservation.formuleId);', scenarios: ['N|post', 'N|base'] },
  { nom: 'la signature ignore la variante', fichier: 'lib/demande-publique.js',
    de: "    ...(variante ? [['formulaChoice', variante]] : []),", vers: '    ...([]),', scenarios: ['N|post'] },
  { nom: 'la signature porte l identifiant brut de la premiere variante', fichier: 'lib/demande-publique.js',
    de: "  const variante = (varianteDemandee(r.formuleId, pref.formulaChoice) || {}).id || '';",
    vers: "  const variante = pref.formulaChoice !== undefined && pref.formulaChoice !== null ? String(pref.formulaChoice).trim().slice(0, 40) : '';", scenarios: ['N|post'] },
  { nom: 'une variante inconnue se reserve sur la carte (blocage, reservation)', fichier: 'lib/demande-publique.js',
    de: '  if (formuleDemandee && choixInconnu(formuleDemandee, preference.formulaChoice)) {', vers: '  if (false) {', scenarios: ['N|post'] },
  { nom: 'une modification perd la variante de son plan', fichier: 'lib/reservation-ops.js',
    de: '      if (choixFormule && preferenceMoteur.formulaChoice === undefined) preferenceMoteur = { ...preferenceMoteur, formulaChoice: choixFormule };', vers: '', scenarios: ['N|comptoir'] },
  { nom: 'la formule adaptee repart de la carte (deux lasers, arcades du catalogue)', fichier: 'lib/reservation-ops.js',
    de: "    base = formuleAvecChoix(getFormula(formuleId, request.centerId || 'libramont'), varianteDemandee(formuleId, choix));", vers: "    base = getFormula(formuleId, request.centerId || 'libramont');", scenarios: ['N|comptoir'] },
  { nom: 'un retard se replanifie sans la variante', fichier: 'lib/ops-engine.js',
    de: '      ...(choixGarde ? { formulaChoice: choixGarde.id } : {}),', vers: '', scenarios: ['N|retard'] },
  { nom: 'deplacer le bowling fait apparaitre les deux lasers de la carte', fichier: 'lib/reservation-activity-move.js',
    de: "    const formulaGames = current.formuleId ? (formuleDuDossier(getFormula(current.formuleId), current)?.steps || []).filter(step => step.activityId === 'laser_game').reduce((sum,step) => sum+Number(step.count || 1),0) : 0;",
    vers: "    const formulaGames = current.formuleId ? (getFormula(current.formuleId)?.steps || []).filter(step => step.activityId === 'laser_game').reduce((sum,step) => sum+Number(step.count || 1),0) : 0;", scenarios: ['N|planning'] },
  { nom: 'le dossier a placer perd la variante', fichier: 'lib/reserver-fenetre.js',
    de: '    ...(avant.formulaChoice ? { formulaChoice: avant.formulaChoice } : {}),', vers: '', scenarios: ['N|planning'] },
  { nom: 'le dossier a placer attend les deux lasers de la carte', fichier: 'lib/reserver-fenetre.js',
    de: "      return ((require('./formula-choice').formuleDuDossier(getFormula(dossier.formuleId), dossier) || {}).steps || [])", vers: '      return ((getFormula(dossier.formuleId) || {}).steps || [])', scenarios: ['N|planning'] },
  { nom: 'le rappel promet le laser a la variante aux arcades', fichier: 'lib/ops-communications.js',
    de: "    const laserPromis = !varianteDuDossier || ((formuleDuDossier(formula, reservation) || {}).steps || []).some((step) => step && step.activityId === 'laser_game');", vers: '    const laserPromis = true;', scenarios: ['N|mails'] },
  { nom: 'le mail de l equipe ne nomme plus la variante', fichier: 'lib/ops-communications.js',
    de: "        { label: 'Offre', value: varianteDuDossier ? `${offreLisible}, ${varianteDuDossier.label}` : offreLisible },", vers: "        { label: 'Offre', value: offreLisible },", scenarios: ['N|mails'] },
  { nom: 'le planning de la console estime les deux lasers de la carte', fichier: 'assets/booking-core.js',
    de: '  const formule = reservation.formuleId ? applyReservationFormulaChoice(FORMULES.find(x => x.id === reservation.formuleId), reservation) : null;', vers: '  const formule = reservation.formuleId ? FORMULES.find(x => x.id === reservation.formuleId) : null;', scenarios: ['N|console'] },
  { nom: 'la fiche liste les deux lasers de la carte', fichier: 'assets/booking-core.js',
    de: '  const steps = applyReservationFormulaChoiceToSteps(getFormulaActivitySteps(getReservationFormulaId(reservation)), reservation);', vers: '  const steps = getFormulaActivitySteps(getReservationFormulaId(reservation));', scenarios: ['N|console'] },
  { nom: 'la console compte les deux lasers de la carte', fichier: 'assets/app-main.js',
    de: '  return getFormulaLaserGameCount(applyReservationFormulaChoice(formule, reservation));', vers: '  return getFormulaLaserGameCount(formule);', scenarios: ['N|console'] },
  { nom: 'la modification repart de la carte', fichier: 'assets/app-main.js',
    de: '  const formule = r && r.formuleId ? applyReservationFormulaChoice(resolveDisplayFormule(r.formuleId), r) : null;', vers: '  const formule = r && r.formuleId ? resolveDisplayFormule(r.formuleId) : null;', scenarios: ['N|console'] },
  { nom: 'la carte du groupe ne nomme plus la variante', fichier: 'assets/app-main.js',
    de: '  return base && variante ? `${base} \u00b7 ${variante.label}` : base;', vers: '  return base;', scenarios: ['N|console'] },
  { nom: 'le resume du groupe repart du nom de la carte', fichier: 'assets/app-main.js',
    de: '  if (formule) return nomDeLaFormuleAchetee(r, formule.name);', vers: '  if (formule) return formule.name;', scenarios: ['N|console'] },
  { nom: 'les puces d une carte payee taisent la variante', fichier: 'assets/app-main.js',
    de: '    noms = [nomDeLaFormuleAchetee(r, formule ? formule.name : getReservationLabel(r))].filter(Boolean);',
    vers: '    noms = [formule ? formule.name : getReservationLabel(r)].filter(Boolean);', scenarios: ['N|console'] },
  { nom: 'l onglet Modifier recopie la carte', fichier: 'assets/app-main.js',
    de: "  return String((r && r.type) || '') === 'formule' ? applyReservationFormulaChoice(resolveDisplayFormule(r.formuleId), r) : null;",
    vers: "  return String((r && r.type) || '') === 'formule' ? resolveDisplayFormule(r.formuleId) : null;", scenarios: ['N|console'] },
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
  M: { titre: 'M. LE MODELE A : LES ARCADES SANS HEURE D ARRIVEE, L ARRIVEE A L OUVERTURE', run: scenarioM },
  N: { titre: 'N. LA FORMULE 4 AU CHOIX : 60 MIN D ARCADES A LA PLACE DES DEUX LASERS', run: scenarioN },
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

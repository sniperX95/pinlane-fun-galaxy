// LE GATE DU CENTRE PUBLIC : UN IDENTIFIANT INCONNU EST REFUSE, ET UN STATUT SE
// LIT APRES LE RECHAUFFAGE DES CENTRES (2026-09-14).
//
// CE QUI A ETE MESURE EN PRODUCTION le 2026-09-13 (lecture seule) :
// /api/public-booking-meta refuse un centre inexistant en 404 depuis le
// 2026-08-20, mais /api/public-availability repondait 200 et un calendrier :
// horaires de repli, catalogue par defaut, tout libre. Un site mal branche
// affichait des creneaux pour un centre qui n existe pas.
//
// LA PORTE VOISINE, lue dans le code le 2026-09-14 : les deux handlers publics
// lisaient le statut du centre (planned, closed) AVANT de rechauffer les centres
// de la base. Sur une instance froide, un centre ne dans la console est inconnu
// du fichier socle : le verdict tombait a vide, et le centre « en preparation »
// servait ses creneaux et prenait la reservation. Le commentaire de
// public-reservations disait « lu APRES le rechauffage » depuis le 2026-08-22 ;
// le code du meme commit le lisait avant.
//
// CE QUE CE GATE VERROUILLE, chaque requete sur une instance FROIDE (modules du
// depot purges) et une base factice :
//   A. un centre inexistant : 404 en lecture, aucun creneau, identifiant nettoye ;
//   B. sans centerId : Libramont, comme la ligne d installation historique ;
//   C. un centre ne dans la console et actif : servi, la resolution suit le rechauffage ;
//   D. le meme centre en preparation : aucun creneau, et il DIT pourquoi ;
//   E. ce centre en preparation en ecriture : 422, aucune insertion tentee ;
//   E2. la meme garde quand le centre arrive par center_id, l autre nom du champ ;
//   F. un centre inexistant en ecriture : 404, aucune insertion tentee ;
//   G. contre-mesure : le centre actif ne recoit aucun de ces refus.
// Le montage [0] prouve d abord que la situation existe : sans rechauffage, le
// centre de la console est bien inconnu, et le jour choisi est ouvert.
//
// Zero reseau, zero base : 'pg' est remplace dans require.cache AVANT tout
// require du depot. Sortie 0 quand tout est vert, 1 sinon.
// Lancement : node scripts/public-center-guard-check.js

const path = require('path');
const { Readable } = require('stream');

process.env.NODE_ENV = 'test';
delete process.env.VERCEL;
process.env.DATABASE_URL = 'postgres://gate/gate';
process.env.DATABASE_SSL = 'disable';

const ROOT = path.resolve(__dirname, '..');

const checks = [];
function record(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail: detail || '' });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' :: ' + detail : ''}`);
}
function section(title) { console.log(`\n${title}`); }

// Deux centres qui n existent QU EN BASE, comme ceux crees depuis la console.
// Toute autre lecture rend zero ligne ; toute ecriture est comptee, pour prouver
// qu un refus tombe avant elle.
const CENTRE_ACTIF = 'gate-console-actif';
const CENTRE_PREVU = 'gate-console-prevu';
const INCONNU = 'centre-qui-n-existe-pas';
const CENTERS = [
  { id: CENTRE_ACTIF, name: 'Gate Console Actif', status: 'active', timezone: 'Europe/Brussels', settings: null },
  { id: CENTRE_PREVU, name: 'Gate Console Prevu', status: 'planned', timezone: 'Europe/Brussels', settings: null },
];
const ecritures = [];
let lecturesCentres = 0;

class FakePool {
  async query(text, params = []) {
    const sql = String(text).replace(/\s+/g, ' ').trim();
    if (/from centers\b/i.test(sql)) {
      lecturesCentres += 1;
      const voulus = (params || []).map((v) => String(v == null ? '' : v));
      const lignes = /\bwhere\b/i.test(sql) && voulus.length ? CENTERS.filter((row) => voulus.includes(row.id)) : CENTERS;
      return { rows: lignes.map((row) => ({ ...row })), rowCount: lignes.length };
    }
    if (/\binsert into\b|\bupdate \w+ set\b|\bdelete from\b/i.test(sql)) ecritures.push(sql.slice(0, 120));
    return { rows: [], rowCount: 0 };
  }
  async connect() {
    const self = this;
    return { query: (t, p) => self.query(t, p), release() {} };
  }
  on() { return this; }
  async end() {}
}

const PG_PATH = require.resolve('pg');
require.cache[PG_PATH] = { id: PG_PATH, filename: PG_PATH, loaded: true, exports: { Pool: FakePool } };

// Une instance serverless fraiche : aucun module du depot en memoire, donc ni
// centres rechauffes, ni catalogue, ni compteur de limite de debit.
function purgeRepoModules() {
  for (const key of Object.keys(require.cache)) {
    if (key === PG_PATH) continue;
    if (!key.startsWith(ROOT)) continue;
    if (key.includes(`${path.sep}node_modules${path.sep}`)) continue;
    if (key === __filename) continue;
    delete require.cache[key];
  }
}

function fakeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    getHeader(name) { return this.headers[String(name).toLowerCase()]; },
    removeHeader(name) { delete this.headers[String(name).toLowerCase()]; },
    end(payload) { if (payload !== undefined && this.body === null) this.body = payload; this.ended = true; },
    write(chunk) { this.body = (this.body || '') + chunk; },
  };
}
function jsonOf(res) { try { return JSON.parse(String(res.body || '')); } catch (error) { return null; } }

let ipCounter = 0;
function nouvelleAdresse() { ipCounter += 1; return `10.9.${Math.floor(ipCounter / 200)}.${(ipCounter % 200) + 1}`; }

async function lireDispo(query) {
  purgeRepoModules();
  const handler = require(path.join(ROOT, 'api', 'public-availability.js'));
  const adresse = nouvelleAdresse();
  const req = {
    method: 'GET',
    url: `/api/public-availability?${query}`,
    headers: { host: 'gate.local', 'x-forwarded-for': adresse },
    socket: { remoteAddress: adresse },
  };
  const res = fakeRes();
  await handler(req, res);
  return { status: res.statusCode, json: jsonOf(res) };
}

async function ecrireReservation(body) {
  purgeRepoModules();
  const handler = require(path.join(ROOT, 'api', 'public-reservations.js'));
  const adresse = nouvelleAdresse();
  const req = Readable.from([Buffer.from(JSON.stringify(body), 'utf8')]);
  req.method = 'POST';
  req.url = '/api/public-reservations';
  req.headers = { host: 'gate.local', 'content-type': 'application/json', 'x-forwarded-for': adresse };
  req.socket = { remoteAddress: adresse };
  const res = fakeRes();
  await handler(req, res);
  const json = jsonOf(res);
  return { status: res.statusCode, json, message: (json && json.message) || '' };
}

function bodyFor(centerId, date) {
  return {
    centerId, type: 'bowling', date, startTime: '14:00', pax: 4, duration: 1,
    name: 'Gate Centre Public', email: 'gate@example.com', phone: '0470000000', lanes: [1],
  };
}

const REFUS_CENTRE = /inconnu|pas encore|ne prend plus/i;

(async () => {
  let failed = 0;
  try {
    const cfg = require(path.join(ROOT, 'lib', 'booking-config.js'));
    // Un samedi a venir, calcule et jamais ecrit en dur : un jour de fermeture
    // rendrait « aucun creneau » vrai sur n importe quel code, garde ou pas.
    const [y, m, d] = cfg.todayStr().split('-').map(Number);
    const curseur = new Date(Date.UTC(y, m - 1, d + 3));
    while (curseur.getUTCDay() !== 6) curseur.setUTCDate(curseur.getUTCDate() + 1);
    const bientot = curseur.toISOString().slice(0, 10);
    const dispo = (centre) => `${centre ? `centerId=${encodeURIComponent(centre)}&` : ''}date=${bientot}&type=bowling&pax=4&duration=1`;

    section('[0] MONTAGE : un centre ne dans la console est inconnu d une instance froide');
    {
      purgeRepoModules();
      const ops = require(path.join(ROOT, 'lib', 'ops-knowledge.js'));
      const connu = (id) => { try { return ops.getCenter(id); } catch (error) { return null; } };
      record('avant rechauffage, le centre en preparation est inconnu du socle fichier', connu(CENTRE_PREVU) === null);
      record('ciney est en preparation dans le socle fichier (scenario E2)', /pas encore/i.test(ops.publicBookingBlockReason('ciney')), ops.publicBookingBlockReason('ciney') || '(vide)');
      record('son verdict de statut tombe donc a vide tant que rien n est rechauffe', ops.publicBookingBlockReason(CENTRE_PREVU) === '', ops.publicBookingBlockReason(CENTRE_PREVU) || '(vide)');
      const { getPool } = require(path.join(ROOT, 'lib', 'database.js'));
      await ops.refreshCenterOverrides(getPool(), { force: true });
      const chaud = connu(CENTRE_PREVU);
      record('apres rechauffage, la base factice le fait exister en preparation', Boolean(chaud && chaud.status === 'planned'), chaud ? `status=${chaud.status}` : 'toujours inconnu');
      record('et l identifiant « inexistant » du gate reste inconnu partout', connu(INCONNU) === null);
      record('la date du gate est dans l horizon de reservation', cfg.bookingDateOutOfRange(bientot) === '' || cfg.bookingDateOutOfRange(bientot) == null, `${bientot} -> ${cfg.bookingDateOutOfRange(bientot) || 'dans l horizon'}`);
      const ouvert = await lireDispo(dispo(''));
      const creneauxOuverts = ouvert.json && Array.isArray(ouvert.json.slots) ? ouvert.json.slots.length : 0;
      record('le jour choisi est ouvert : sans centerId, Libramont y a des creneaux', creneauxOuverts > 0, `creneaux=${creneauxOuverts} message=${(ouvert.json && ouvert.json.message) || '(vide)'}`);
    }

    section('[A] Lecture : un centre inexistant est refuse, pas servi');
    {
      const r = await lireDispo(dispo(INCONNU));
      record('le serveur repond 404', r.status === 404, `status=${r.status}`);
      record('la reponse dit que le centre est inconnu', Boolean(r.json && r.json.ok === false && /inconnu/i.test(r.json.message || '')), (r.json && r.json.message) || '(aucun message)');
      const creneaux = r.json && Array.isArray(r.json.slots) ? r.json.slots.length : 0;
      record('aucun creneau n est servi', creneaux === 0, `creneaux=${creneaux}`);
      const bizarre = await lireDispo(dispo('Fantome<script>"x'));
      const renvoye = bizarre.json && typeof bizarre.json.centerId === 'string' ? bizarre.json.centerId : null;
      record('l identifiant renvoye est nettoye, c est une entree utilisateur', bizarre.status === 404 && renvoye !== null && /^[a-z0-9-]*$/.test(renvoye), `status=${bizarre.status} centerId=${JSON.stringify(renvoye)}`);
    }

    section('[B] Lecture sans centerId : Libramont, comme la ligne d installation historique');
    {
      const r = await lireDispo(dispo(''));
      record('pas de 404 sans centerId', r.status !== 404, `status=${r.status}`);
      record('la reponse est un calendrier, pas un refus', Boolean(r.json && r.json.ok === true) && !REFUS_CENTRE.test((r.json && r.json.message) || ''), `ok=${r.json && r.json.ok} message=${(r.json && r.json.message) || '(vide)'}`);
    }

    section('[C] Lecture d un centre ne dans la console et actif, instance froide : servi');
    {
      lecturesCentres = 0;
      const r = await lireDispo(dispo(CENTRE_ACTIF));
      record('pas de 404 : le centre est resolu APRES le rechauffage', r.status !== 404, `status=${r.status}`);
      record('la reponse est un calendrier, pas un refus', Boolean(r.json && r.json.ok === true) && !REFUS_CENTRE.test((r.json && r.json.message) || ''), `ok=${r.json && r.json.ok} message=${(r.json && r.json.message) || '(vide)'}`);
      record('la base a bien ete lue pour le connaitre', lecturesCentres > 0, `lectures de centers=${lecturesCentres}`);
    }

    section('[D] Lecture du centre en preparation, instance froide : aucun creneau, et il le dit');
    {
      const r = await lireDispo(dispo(CENTRE_PREVU));
      const creneaux = r.json && Array.isArray(r.json.slots) ? r.json.slots.length : -1;
      record('aucun creneau', creneaux === 0, `creneaux=${creneaux} status=${r.status}`);
      record('la reponse dit que le centre n ouvre pas encore', Boolean(r.json && /pas encore/i.test(r.json.message || '')), (r.json && r.json.message) || '(aucun message)');
    }

    section('[E] Ecriture chez le centre en preparation, instance froide : refusee avant toute insertion');
    {
      ecritures.length = 0;
      const r = await ecrireReservation(bodyFor(CENTRE_PREVU, bientot));
      record('refus 422', r.status === 422, `status=${r.status}`);
      record('le refus dit que le centre n ouvre pas encore', /pas encore/i.test(r.message), r.message || '(aucun message)');
      record('aucune insertion tentee', ecritures.length === 0, ecritures[0] || 'aucune');
    }

    section('[E2] La meme garde quand le centre arrive par center_id, l autre nom du champ');
    {
      ecritures.length = 0;
      const corps = bodyFor('ciney', bientot);
      delete corps.centerId;
      corps.center_id = 'ciney';
      const r = await ecrireReservation(corps);
      record('refus 422', r.status === 422, `status=${r.status}`);
      record('le refus dit que le centre n ouvre pas encore', /pas encore/i.test(r.message), r.message || '(aucun message)');
      record('aucune insertion tentee', ecritures.length === 0, ecritures[0] || 'aucune');
    }

    section('[F] Ecriture chez un centre inexistant : refusee en 404 avant toute insertion');
    {
      ecritures.length = 0;
      const r = await ecrireReservation(bodyFor(INCONNU, bientot));
      record('refus 404', r.status === 404, `status=${r.status}`);
      record('le refus dit que le centre est inconnu', /inconnu/i.test(r.message), r.message || '(aucun message)');
      record('aucune insertion tentee', ecritures.length === 0, ecritures[0] || 'aucune');
    }

    section('[G] CONTRE-MESURE : le centre actif ne recoit aucun de ces refus');
    {
      const r = await ecrireReservation(bodyFor(CENTRE_ACTIF, bientot));
      record('ni inconnu, ni en preparation, ni ferme', r.status !== 404 && !REFUS_CENTRE.test(r.message), `status=${r.status} message=${r.message || '(vide)'}`);
    }
  } catch (error) {
    console.error('\nERREUR DU GATE:', error && (error.stack || error.message || error));
    failed = 1;
  }

  const red = checks.filter((c) => !c.ok).length;
  console.log(`\n${red || failed ? 'ECHEC' : 'ALL OK'} : ${checks.length - red}/${checks.length} verifications`);
  process.exit(red || failed ? 1 : 0);
})();

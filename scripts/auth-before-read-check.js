// LA BASE NE PARLE PAS AVANT L'AUTHENTIFICATION.
//
// Defaut trouve le 2026-08-20 en verifiant la PROD apres un deploiement :
// `PATCH /api/staff-reservations` repondait 404 pour un id inexistant et 401
// pour un id existant, SANS session. La reservation etait lue avant tout
// controle (la permission depend du centre de cette reservation, d'ou l'ordre
// naturel mais faux). Deux consequences : un oracle d'enumeration offert a
// n'importe qui, et une lecture de base gratuite, en boucle, sans compte.
//
// Ce gate mesure l'ORDRE, pas l'intention : il compte les lectures reelles de
// la table `reservations` pendant un appel sans session. Zero lecture, sinon
// c'est que la base a parle en premier.
//
// Zero reseau, zero base : 'pg' est remplace dans require.cache avant tout
// chargement, comme dans audit-log-check.
const path = require('path');
const ROOT = path.join(__dirname, '..');

let echecs = 0;
function ok(cond, label) {
  console.log((cond ? 'ok    ' : 'FAIL  ') + label);
  if (!cond) echecs += 1;
}

const lectures = [];
class FakePool {
  async query(text, params) {
    const sql = String(text || '');
    if (/from\s+reservations/i.test(sql)) {
      lectures.push({ sql: sql.slice(0, 60), params });
      const id = Number((params || [])[0]);
      // 1332 existe, 999999 n'existe pas : c'est CE contraste qui fabriquait
      // l'oracle en prod (404 contre 401).
      if (id === 1332) {
        return { rowCount: 1, rows: [{ id: 1332, center_id: 'libramont', date: '2026-08-20', start_time: '10:00', duration: 1.5, pax: 4, type: 'bowling', status: 'paid', lanes: [1], name: 'X', phone: '+32', email: 'x@x.be' }] };
      }
      return { rowCount: 0, rows: [] };
    }
    return { rowCount: 0, rows: [] };
  }

  async connect() {
    const self = this;
    return { query: (t, p) => self.query(t, p), release() {}, };
  }
}

const pgPath = require.resolve('pg');
require.cache[pgPath] = { id: pgPath, filename: pgPath, loaded: true, exports: { Pool: FakePool } };
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake/fake';

const handler = require(path.join(ROOT, 'api', 'staff-reservations.js'));
const db = require(path.join(ROOT, 'lib', 'database.js'));

function fakeReq(method, body) {
  const charge = JSON.stringify(body);
  return {
    method,
    url: '/api/staff-reservations',
    headers: { 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() { yield Buffer.from(charge); },
  };
}

function fakeRes() {
  return {
    statusCode: 0, corps: '', headersSent: false,
    setHeader() {},
    writeHead(code) { this.statusCode = code; this.headersSent = true; },
    end(chunk) { if (chunk) this.corps += String(chunk); this.headersSent = true; },
  };
}

async function appel(method, body) {
  lectures.length = 0;
  const res = fakeRes();
  try { await handler(fakeReq(method, body), res); } catch (error) { res.erreur = error.message; }
  return { statut: res.statusCode, lectures: lectures.length, corps: res.corps };
}

(async () => {
  console.log('');
  console.log('[SANS SESSION] la base doit rester muette');
  for (const method of ['PATCH', 'DELETE']) {
    const existant = await appel(method, { id: 1332, name: 'x' });
    ok(existant.statut === 401, method + ' sur un id EXISTANT : 401 (recu ' + existant.statut + ')');
    ok(existant.lectures === 0, method + ' sur un id EXISTANT : ZERO lecture de la base (' + existant.lectures + ')');

    const absent = await appel(method, { id: 999999, name: 'x' });
    ok(absent.statut === 401, method + ' sur un id INEXISTANT : 401 (recu ' + absent.statut + ')');
    ok(absent.lectures === 0, method + ' sur un id INEXISTANT : ZERO lecture de la base (' + absent.lectures + ')');

    // L'ASSERTION QUI COMPTE : les deux reponses sont INDISCERNABLES. C'est
    // elle qui ferme l'oracle, pas le code 401 pris isolement.
    ok(existant.statut === absent.statut,
      method + ' : id existant et id inexistant repondent PAREIL, aucun oracle d enumeration (' + existant.statut + ' / ' + absent.statut + ')');
  }

  console.log('');
  console.log('[Contre-epreuve : ce compteur voit-il vraiment une lecture ?]');
  // Sans cette preuve, « zero lecture » serait vert meme si la sonde etait
  // aveugle : elle mesurerait alors l'absence de sa propre mesure.
  lectures.length = 0;
  const lu = await db.getReservationById(1332);
  ok(lectures.length > 0 && lu && lu.id === 1332,
    'une lecture reelle FAIT monter le compteur (' + lectures.length + ' lecture(s)) -> le gate ROUGIRAIT si la base parlait');

  console.log('');
  if (echecs) {
    console.log('auth-before-read-check: ' + echecs + ' echec(s).');
    process.exit(1);
  }
  console.log('auth-before-read-check: ALL OK - aucune lecture de base avant l authentification.');
})();

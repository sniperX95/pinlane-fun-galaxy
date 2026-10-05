// LA PAGE SECOURS LIT DU VRAI ET TELECHARGE DES FICHIERS QUI S OUVRENT (2026-10-05).
//
// Sur une vraie base LOCALE et le vrai handler api/ops :
//   [A] secoursEtat : les adresses du centre et des envois vides quand rien
//       n est parti (l ecran dit « jamais », rien d invente) ;
//   [B] feuilleSecours : un PDF nomme, au nom du centre et de la date ;
//       vierge=1 aussi ; une date mal formee est refusee (400) ;
//   [C] classeurJour : un classeur Excel (zip) nomme ;
//   [D] la permission demandee est reservations.view (l accueil), jamais plus
//       large ni plus etroite : lue dans la source servie.
//
// Usage : PINLANE_TEST_DATABASE_URL=postgres://...localhost... node scripts/secours-api-check.js
'use strict';

const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const ROOT = path.resolve(__dirname, '..');
if (!process.env.PINLANE_TEST_DATABASE_URL) {
  console.log('secours-api-check: SAUTE (PINLANE_TEST_DATABASE_URL absent)');
  process.exit(0);
}
process.env.DATABASE_URL = process.env.PINLANE_TEST_DATABASE_URL;
const u = new URL(process.env.DATABASE_URL);
if (!(['localhost', '127.0.0.1', ''].includes(u.hostname) || /host=\//.test(process.env.DATABASE_URL))) { console.error('secours-api-check: REFUSE, base non locale'); process.exit(1); }
process.env.DATABASE_SSL = 'disable';
const staffAuth = require(path.join(ROOT, 'lib/staff-auth'));
const session = { member: { id: 'gate', name: 'Gate' }, centerId: 'libramont', authorizedCenterId: 'libramont', permissions: ['*'], role: { id: 'direction' } };
staffAuth.requireStaffPermission = async () => session;
staffAuth.getStaffSessionFromRequest = async () => session;
const ops = require(path.join(ROOT, 'api/ops.js'));
const db = require(path.join(ROOT, 'lib/database.js'));

let failures = 0;
function ok(cond, label, detail = '') { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`); if (!cond) failures += 1; }
function get(url) {
  return new Promise((resolve, reject) => {
    const req = Readable.from([]); req.method = 'GET'; req.url = url; req.headers = { host: 'localhost' }; req.socket = { remoteAddress: '10.0.0.9' };
    const morceaux = [];
    const res = { statusCode: 200, h: {}, setHeader(k, v) { this.h[k.toLowerCase()] = v; }, getHeader(k) { return this.h[k.toLowerCase()]; }, writeHead(s, h) { this.statusCode = s; if (h) Object.assign(this.h, h); return this; }, write(c) { morceaux.push(Buffer.from(c)); }, end(d) { if (d) morceaux.push(Buffer.from(d)); resolve({ status: this.statusCode, h: this.h, corps: Buffer.concat(morceaux) }); } };
    Promise.resolve(ops(req, res)).catch(reject);
  });
}

(async () => {
  const pool = db.getPool();
  const e = await get('/api/ops?action=secoursEtat&centerId=libramont');
  const etat = JSON.parse(e.corps.toString() || '{}');
  ok(e.status === 200 && Array.isArray(etat.emails) && etat.envois && etat.sauvegarde && typeof etat.sauvegarde.configuree === 'boolean', '[A] l etat se lit (adresses, envois, sauvegarde)', e.corps.toString().slice(0, 160));
  const jour = ((await pool.query("select date::text as d from reservations where center_id = 'libramont' group by date order by count(*) desc limit 1")).rows[0] || {}).d || '2026-11-14';
  const f = await get(`/api/ops?action=feuilleSecours&centerId=libramont&date=${jour}`);
  ok(f.status === 200 && f.h['content-type'] === 'application/pdf' && f.corps.slice(0, 5).toString() === '%PDF-' && f.h['content-disposition'] === `attachment; filename="feuille-libramont-${jour}.pdf"`, '[B] la feuille du jour : un PDF nomme', f.h['content-disposition']);
  const v = await get(`/api/ops?action=feuilleSecours&centerId=libramont&date=${jour}&vierge=1`);
  ok(v.status === 200 && /feuille-vierge-libramont/.test(v.h['content-disposition'] || '') && v.corps.slice(0, 5).toString() === '%PDF-', '[B] la feuille vierge');
  const m = await get('/api/ops?action=feuilleSecours&centerId=libramont&date=hier');
  ok(m.status === 400, '[B] une date mal formee est refusee', `${m.status}`);
  const x = await get(`/api/ops?action=classeurJour&centerId=libramont&date=${jour}`);
  ok(x.status === 200 && x.corps.slice(0, 2).toString() === 'PK' && /\.xlsx"$/.test(x.h['content-disposition'] || ''), '[C] le classeur Excel du jour', x.h['content-disposition']);
  const t0 = Date.now();
  const tout = await get('/api/ops?action=exportComplet&centerId=libramont');
  const duree = Date.now() - t0;
  ok(tout.status === 200 && tout.corps.slice(0, 2).toString() === 'PK' && /pinlane-export-complet-libramont-/.test(tout.h['content-disposition'] || ''), '[E] tout exporter : un classeur Excel du centre', `${duree} ms`);
  ok(duree < 2000, '[E] en moins de 2 secondes', `${duree} ms`);
  const { lireZip } = require(path.join(ROOT, 'lib/xlsx-writer.js'));
  const fichiers = lireZip(tout.corps);
  const xmlTout = fichiers.map((e) => Buffer.from(e.donnees).toString('utf8')).join(' ');
  ok(!/access_code|code_hash|code_enc|token_hash/.test(xmlTout), '[E] aucun code d acces ni jeton dans l export');
  const source = fs.readFileSync(path.join(ROOT, 'api/ops.js'), 'utf8');
  ok(/action === 'secoursEtat' \|\| action === 'feuilleSecours' \|\| action === 'classeurJour'\) return 'reservations\.view';/.test(source), '[D] permission reservations.view');
  ok(/action === 'exportComplet'\) return \['exports\.download', 'settings\.manage', 'direction\.view'\];/.test(source), '[D] tout exporter : direction ou export seulement');
  await pool.end().catch(() => {});
  console.log('');
  console.log(failures ? `secours-api-check: ${failures} FAIL` : 'secours-api-check: ALL OK (etat reel, feuille, vierge, Excel, permission)');
  process.exit(failures ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });

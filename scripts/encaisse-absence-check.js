// CE QUI A ETE ENCAISSE, ET LE GROUPE QUI N EST PAS VENU (2026-10-06, 0056).
//   [A] analyse : l encaisse est le montant note (sinon le prix), la remise
//       se compte, un groupe absent sort des visites et du chiffre et compte
//       comme absence (au total, par source, par client) ;
//   [B] Direction : le montant encaisse de la periode suit le montant note,
//       un absent ne compte pas ;
//   [C] base reelle (PINLANE_TEST_DATABASE_URL, migration 0056 posee) :
//       l encaisse ne se note que sur un dossier paye, une remise exige sa
//       raison, un groupe paye ne peut pas etre absent, pointer « arrivé »
//       efface l absence, quitter « payé » efface le montant (trigger) ;
//       sans la migration, le refus le dit (409), rien ne casse.
//   Contre-epreuve : sans exclure les absents, [A] rougit.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let failures = 0;
function ok(c, l, d = '') { console.log(`${c ? 'ok  ' : 'FAIL'}  ${l}${d ? `  ${d}` : ''}`); if (!c) failures += 1; }

const url = process.env.PINLANE_TEST_DATABASE_URL || '';
const locale = /localhost|127\.0\.0\.1|host=\//.test(url);
if (url && locale) { process.env.DATABASE_URL = url; process.env.DATABASE_SSL = 'disable'; }

const { analyserDonnees } = require(path.join(ROOT, 'lib/donnees-clients.js'));
const { buildDirectionAnalytics } = require(path.join(ROOT, 'lib/direction-analytics.js'));

const google = { source: 'Google Ads', dernier: { source: 'Google Ads' } };
const base = { channel: 'public', pax: 6, startTime: '14:00', type: 'bowling' };
const history = [
  { ...base, id: 1, date: '2026-09-10', name: 'Ana', phone: '+32470000001', status: 'paid', price: 100, amountPaid: 80, discountReason: 'geste', acquisition: google },
  { ...base, id: 2, date: '2026-09-11', name: 'Ben', phone: '+32470000002', status: 'paid', price: 60 },
  { ...base, id: 3, date: '2026-09-12', name: 'Ana', phone: '+32470000001', status: 'pending', price: 90, absentAt: '2026-09-12T13:00:00Z', acquisition: google },
];
const a = analyserDonnees({ history, startDate: '2026-09-01', endDate: '2026-09-30' });
console.log('[A] analyse');
ok(a.totaux.reservations === 2 && a.totaux.chiffre === 160, '[A] l absent sort des reservations et du chiffre', JSON.stringify(a.totaux));
ok(a.totaux.encaisse === 140 && a.totaux.remises === 20, '[A] encaisse = montant note (80) + prix (60), remise 20');
ok(a.totaux.absences === 1 && a.totaux.tauxAbsence === 33.3, '[A] une absence sur trois dossiers');
const g = a.sources.find((s) => s.source === 'Google Ads');
ok(g && g.absences === 1 && g.reservations === 1 && g.encaisse === 80, '[A] Google Ads : 1 venue, 1 absence, 80 encaisses', JSON.stringify(g));
const ana = a.clients.find((c) => c.nom === 'Ana');
ok(ana && ana.visites === 1 && ana.absences === 1 && ana.paye === 80, '[A] la cliente : une visite, une absence, 80 payes', JSON.stringify(ana && { v: ana.visites, a: ana.absences, p: ana.paye }));

console.log('[B] Direction');
const d = buildDirectionAnalytics({ history: history.map((r) => ({ ...r, status: r.status === 'pending' ? 'pending' : r.status })), startDate: '2026-09-01', endDate: '2026-09-30', center: {} });
ok(d.totals.reservations === 2 && d.totals.collected === 140, '[B] encaisse de la periode : 140, l absent ne compte pas', JSON.stringify({ r: d.totals.reservations, c: d.totals.collected }));

(async () => {
  console.log('[C] base reelle');
  if (!url) console.log('[C] PINLANE_TEST_DATABASE_URL absente, saute\nGATE-SAUTE-PARTIE [C] base reelle (PINLANE_TEST_DATABASE_URL absente)');
  else if (!locale) ok(false, '[C] base refusee : pas locale');
  else {
    const db = require(path.join(ROOT, 'lib/database.js'));
    const pool = db.getPool();
    const migree = (await pool.query("select 1 from information_schema.columns where table_name = 'reservations' and column_name = 'absent_at'")).rowCount > 0;
    const jour = '2031-03-15';
    const nettoyer = () => pool.query("delete from reservations where date = $1 and name = 'Gate Encaisse'", [jour]);
    await nettoyer();
    const ins = await pool.query("insert into reservations (center_id, channel, name, phone, email, date, start_time, duration, total_duration, lanes, pax, status, base_price, price, type) values ('libramont','staff','Gate Encaisse','+32470999111','g@e.be',$1,'14:00',1,1,'{1}',6,'pending',78,78,'bowling') returning *", [jour]);
    let r = db.mapReservation(ins.rows[0]);
    const v = (x) => (x.updatedAt instanceof Date ? x.updatedAt.toISOString() : x.updatedAt);
    const geste = async (g0) => {
      try { r = await db.noterEncaisseOuAbsence({ id: r.id, centerId: 'libramont', baseUpdatedAt: v(r), ...g0 }); return { ok: true }; } catch (e) { return { ok: false, code: e.statusCode, message: e.message }; }
    };
    const statut = async (status, extra = {}) => { r = await db.setReservationStatus({ id: r.id, centerId: 'libramont', baseUpdatedAt: v(r), status, ...extra }); };
    try {
      if (!migree) {
        const x = await geste({ absent: true });
        ok(!x.ok && x.code === 409 && /db:migrate/.test(x.message), '[C] base sans 0056 : refus clair (409, « db:migrate »)', x.message);
      } else {
        let x = await geste({ encaissement: { montant: 50 } });
        ok(!x.ok && x.code === 422, '[C] pas d encaisse sur un dossier non paye');
        x = await geste({ absent: true });
        ok(x.ok && r.absentAt, '[C] absent pose');
        await statut('arrived');
        ok(r.absentAt === null, '[C] pointer arrive efface l absence (trigger)');
        await statut('paid', { paymentMethod: 'Carte' });
        x = await geste({ encaissement: { montant: 68 } });
        ok(!x.ok && /pourquoi/i.test(x.message), '[C] une remise sans raison est refusee');
        x = await geste({ encaissement: { montant: 68, raison: 'joueur en moins' } });
        ok(x.ok && r.amountPaid === 68 && r.discountReason === 'joueur en moins', '[C] remise notee avec sa raison');
        x = await geste({ absent: true });
        ok(!x.ok && x.code === 422, '[C] un groupe paye ne peut pas etre absent');
        x = await geste({ encaissement: { montant: 78 } });
        ok(x.ok && r.amountPaid === null, '[C] revenir au prix efface la remise');
        await geste({ encaissement: { montant: 70, raison: 'geste' } });
        await statut('arrived');
        ok(r.amountPaid === null && r.discountReason === '', '[C] quitter « payé » efface le montant (trigger)');
        x = await geste({ absent: true, encaissement: { montant: 1 } });
        ok(!x.ok, '[C] un seul geste a la fois');
      }
    } finally {
      await nettoyer();
      await pool.end();
    }
  }

  const source = fs.readFileSync(path.join(ROOT, 'lib/donnees-clients.js'), 'utf8');
  const ancre = 'const estVenu = (r) => ACTIFS.has(r.status) && !estAbsent(r);';
  if (source.split(ancre).length !== 2) ok(false, '[contre-épreuve] ancre absente');
  else {
    const f = path.join(ROOT, 'lib', `.encaisse-mute-${process.pid}.js`);
    fs.writeFileSync(f, source.replace(ancre, 'const estVenu = (r) => ACTIFS.has(r.status);'));
    try {
      const m = require(f).analyserDonnees({ history, startDate: '2026-09-01', endDate: '2026-09-30' });
      ok(m.totaux.reservations !== 2, '[contre-épreuve] sans exclure les absents, [A] rougit');
    } finally { fs.unlinkSync(f); }
  }
  console.log('');
  console.log(failures ? `encaisse-absence-check: ${failures} FAIL` : 'encaisse-absence-check: ALL OK (encaisse reel, remises, absences, garde-fous base)');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

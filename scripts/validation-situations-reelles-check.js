// L EQUIPE N EST APPELEE QUE POUR CE QUE SON CENTRE A CHOISI, SUR DE VRAIES RESERVATIONS (2026-10-05).
//
// Movsar : « les choses qui n ont pas su etre placees doivent avoir une logique
// serieuse [...] le moins possible ! [...] modifiable l intensite ». Le module
// pur (situations-validation-check) prouve la regle ; CE gate prouve qu elle
// tient de bout en bout, sur une vraie base Postgres et les vrais handlers, par
// le chemin NORMAL du formulaire : les heures, le blocage des horaires
// (/api/public-holds), puis la confirmation avec son jeton.
//
//   [A] Minimal (le defaut) : aucun mail a l equipe, meme l arene laser
//       presque pleine et partagee ; ce qui est vu reste « a surveiller » ;
//   [B] Normal : un mail pour l arene presque pleine (27/30), aucun pour un
//       simple partage ;
//   [C] Prudent : un mail aussi pour le partage ;
//   [D] un interrupteur : Minimal + « laser partage » allume ;
//   [E] une formule reglee « toujours valider » dans Tarifs & formules l est
//       AUSSI par le chemin du blocage (avant : ce chemin confirmait tout) ;
//   [F] au comptoir, la personne qui saisit est l equipe : aucun mail ;
//   [G] la decision interne (qui nomme la taille d un autre groupe) ne sort
//       jamais dans une reponse publique.
//   Contre-epreuve : le blocage qui confirme tout, remis, fait rougir [E].
//
// SECURITE : base LOCALE seulement, n efface que ses propres journees de test,
// remet le reglage du centre et celui de la F4 comme il les a trouves.
//
// Usage : PINLANE_TEST_DATABASE_URL=postgres://...localhost.../base_de_test node scripts/validation-situations-reelles-check.js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');

const ROOT = path.resolve(__dirname, '..');
if (!process.env.PINLANE_TEST_DATABASE_URL) {
  console.log('validation-situations-reelles-check: SAUTE (PINLANE_TEST_DATABASE_URL absent : ce gate a besoin d une base Postgres locale)');
  console.log('GATE-SAUTE PINLANE_TEST_DATABASE_URL absent');
  process.exit(0);
}
process.env.DATABASE_URL = process.env.PINLANE_TEST_DATABASE_URL;
const urlBase = new URL(process.env.DATABASE_URL);
if (!(['localhost', '127.0.0.1', ''].includes(urlBase.hostname) || /host=\//.test(process.env.DATABASE_URL))) {
  console.error('validation-situations-reelles-check: REFUSE, la base n est pas locale (' + urlBase.hostname + ')');
  process.exit(1);
}
process.env.DATABASE_SSL = process.env.DATABASE_SSL || 'disable';
process.env.PINLANE_CALENDAR_SYNC = 'off';
process.env.STAFF_REVIEW_EMAIL = 'accueil-staff@gate.example.org';
delete process.env.RESEND_API_KEY;

let failures = 0;
function ok(cond, label, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures += 1;
  return cond;
}

let ip = 40;
function appel(handler, { method = 'POST', url = '/', body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = Readable.from(body == null ? [] : [Buffer.from(JSON.stringify(body))]);
    req.method = method;
    req.url = url;
    ip += 1;
    req.headers = { 'content-type': 'application/json', host: 'localhost', 'x-forwarded-for': `10.7.${Math.floor(ip / 250)}.${ip % 250}`, 'user-agent': 'gate' };
    req.socket = { remoteAddress: `10.6.${Math.floor(ip / 250)}.${ip % 250}` };
    const res = {
      statusCode: 200, h: {},
      setHeader(k, v) { this.h[k.toLowerCase()] = v; }, getHeader(k) { return this.h[k.toLowerCase()]; },
      writeHead(s, h) { this.statusCode = s; if (h) Object.assign(this.h, h); return this; },
      end(d) { let j = null; try { j = d ? JSON.parse(String(d)) : null; } catch (e) { j = String(d); } resolve({ status: this.statusCode, body: j }); },
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

// L equipe connectee, pour le comptoir : la permission est accordee ici, le
// handler et le moteur restent les vrais.
const staffAuth = require(path.join(ROOT, 'lib/staff-auth'));
const session = { member: { id: 'gate', name: 'Gate' }, centerId: 'libramont', authorizedCenterId: 'libramont', permissions: ['*'], role: { id: 'direction' } };
staffAuth.requireStaffPermission = async () => session;
staffAuth.getStaffSessionFromRequest = async () => session;

const dispoApi = require(path.join(ROOT, 'api/public-availability.js'));
const publicApi = require(path.join(ROOT, 'api/public-reservations.js'));
const staffApi = require(path.join(ROOT, 'api/staff-reservations.js'));
const db = require(path.join(ROOT, 'lib/database.js'));
const cc = require(path.join(ROOT, 'lib/center-config.js'));
const ok_ = require(path.join(ROOT, 'lib/ops-knowledge.js'));
const { refreshFormuleOverrides } = require(path.join(ROOT, 'lib/booking-config.js'));
const pool = db.getPool();
const sql = async (q, p = []) => (await pool.query(q, p)).rows;

const fuites = [];
function surveillerFuite(etiquette, corps) {
  const texte = JSON.stringify(corps || {});
  if (/"validation":\{/.test(texte) || /declencheurs|aSurveiller/.test(texte)) fuites.push(etiquette);
}

// LE CHEMIN DU FORMULAIRE : les heures, le blocage, puis la confirmation.
async function reserver(o, handler = publicApi) {
  const centerId = 'libramont';
  const params = { centerId, date: o.date, pax: String(o.pax) };
  if (o.formuleId) { params.type = 'formule'; params.formuleId = o.formuleId; } else {
    params.type = 'visite'; params.program = JSON.stringify(o.program); params.softReserve = '1';
    params.preferredTimes = JSON.stringify({ [o.program[0].activityId]: o.time });
  }
  const d = await appel(dispoApi, { method: 'GET', url: '/api/public-availability?' + new URLSearchParams(params).toString() });
  surveillerFuite('heures', d.body);
  const rep = d.body || {};
  const slot = o.formuleId ? (rep.slots || []).find((s) => s.time === o.time) : (rep.slots || [])[0];
  if (!slot) return { statut: 'heure absente' };
  const price = slot.price != null ? slot.price : rep.price;
  const body = {
    centerId, name: o.name, phone: '+3247066' + String(1000 + ip).slice(-4), email: o.name.toLowerCase().replace(/[^a-z0-9]+/g, '.') + '@gate.example.org',
    date: o.date, startTime: slot.time, pax: o.pax, companions: 0, channel: 'public', occasion: '', sansOffres: false, notes: '',
    preference: { preferredTimes: o.formuleId ? {} : { [o.program[0].activityId]: o.time }, laserGameTimes: [], laserPlacement: 'scheduled', arrivalConfidence: 'normal' },
    price: Number(price) || 0, quotedPrice: Number(price) || 0, basePrice: Number(price) || 0,
    duration: Number(rep.duration) || 1, totalDuration: Number(rep.totalDuration) || Number(rep.duration) || 1,
    laneCount: Number(slot.laneCount || rep.laneCount) || 0, requiresLanes: Boolean(rep.requiresLanes), label: rep.label || '',
    ...(o.formuleId ? { type: 'formule', formuleId: o.formuleId } : { type: 'visite', program: o.program }),
    ...(slot.lanes ? { lanes: slot.lanes } : {}), ...(slot.opsPlan ? { opsPlan: slot.opsPlan } : {}),
  };
  const { name, phone, email, notes, ...sansContact } = body;
  const h = await appel(handler, { url: '/api/public-reservations?action=hold', body: sansContact });
  surveillerFuite('blocage', h.body);
  if (h.status !== 201) return { statut: `blocage ${h.status}` };
  const r = await appel(handler, { url: '/api/public-reservations', body: { ...body, holdToken: h.body.holdToken } });
  surveillerFuite('confirmation', r.body);
  const res = r.body && r.body.reservation;
  if (!res) return { statut: `confirmation ${r.status}` };
  const enBase = (await sql('select validation_status, ops_plan from reservations where id = $1', [res.id]))[0];
  const mails = await sql('select template_id from communications where reservation_id = $1', [res.id]);
  const v = enBase.ops_plan && enBase.ops_plan.validation;
  return {
    statut: enBase.validation_status,
    staff: mails.filter((m) => m.template_id === 'staff_review_request').length,
    pourquoi: v ? v.declencheurs.map((x) => x.id).sort().join(',') : '',
    surveiller: v ? v.aSurveiller.map((x) => x.id).sort().join(',') : '',
    raison: v ? v.raison : '',
  };
}

// Des jours hors conges scolaires wallons, propres a ce gate.
const J = { vide: '2026-12-05', partage: '2026-12-06', plein: '2026-12-12' };
async function nettoyer() {
  for (const j of Object.values(J)) {
    await sql('delete from communications where reservation_id in (select id from reservations where date = $1 and email like $2)', [j, '%@gate.example.org']).catch(() => {});
    await sql('delete from reservations where date = $1 and email like $2', [j, '%@gate.example.org']);
    await sql('delete from slot_holds where date = $1', [j]).catch(() => {});
  }
}
async function niveau(n, situations = {}) {
  await cc.saveCenterConfigOverride(pool, 'libramont', { validationEquipe: { niveau: n, situations } });
  await ok_.refreshCenterOverrides(pool, { force: true });
}
const laser = (pax, name, date = J.plein) => ({ date, time: '15:00', pax, program: [{ activityId: 'laser_game', games: 1 }], name });

(async () => {
  const centre = (await sql("select settings from centers where id = 'libramont'"))[0];
  const reglageAvant = centre && centre.settings && centre.settings.config && centre.settings.config.validationEquipe;
  const f4Avant = (await sql("select human_validation from formule_overrides where formule_id = 'f4' and center_id = 'libramont'"))[0];
  const resultats = {};
  try {
    for (const n of ['minimal', 'normal', 'prudent']) {
      await nettoyer();
      await niveau(n);
      const f4 = await reserver({ date: J.vide, time: '15:00', pax: 8, formuleId: 'f4', name: `F4 ${n}` });
      await reserver(laser(10, `A ${n}`, J.partage));
      const partage = await reserver(laser(8, `B ${n}`, J.partage));
      await reserver(laser(20, `C ${n}`));
      const plein = await reserver(laser(8, `D ${n}`));
      resultats[n] = { f4, partage, plein };
    }
    await nettoyer();
    await niveau('minimal', { laser_partage: true });
    await reserver(laser(10, 'A interrupteur', J.partage));
    resultats.interrupteur = await reserver(laser(8, 'B interrupteur', J.partage));

    console.log('[A] Minimal');
    const m = resultats.minimal;
    ok(m.f4.statut === 'confirmed' && m.partage.statut === 'confirmed' && m.plein.statut === 'confirmed', '[A] tout se confirme', JSON.stringify([m.f4.statut, m.partage.statut, m.plein.statut]));
    ok(m.f4.staff + m.partage.staff + m.plein.staff === 0, '[A] aucun mail a l equipe');
    ok(m.plein.surveiller === 'laser_partage,laser_plein' && m.partage.surveiller === 'laser_partage', '[A] ce qui est vu reste « a surveiller »', `${m.plein.surveiller} / ${m.partage.surveiller}`);
    console.log('[B] Normal');
    const n = resultats.normal;
    ok(n.plein.statut === 'staff_review' && n.plein.staff === 1 && n.plein.pourquoi === 'laser_plein', '[B] arene presque pleine (27/30) : validation et un mail, pour cette raison', JSON.stringify(n.plein));
    ok(n.partage.statut === 'confirmed' && n.partage.staff === 0, '[B] un simple partage ne derange pas');
    ok(n.f4.statut === 'confirmed' && n.f4.staff === 0, '[B] une F4 seule ne derange pas');
    console.log('[C] Prudent');
    const p = resultats.prudent;
    ok(p.partage.statut === 'staff_review' && p.partage.staff === 1 && p.partage.pourquoi === 'laser_partage', '[C] le partage derange', JSON.stringify(p.partage));
    ok(p.plein.pourquoi === 'laser_partage,laser_plein', '[C] l arene pleine dit ses deux raisons');
    console.log('[D] interrupteur');
    ok(resultats.interrupteur.statut === 'staff_review' && resultats.interrupteur.pourquoi === 'laser_partage', '[D] Minimal + laser partage allume : validation', JSON.stringify(resultats.interrupteur));

    console.log('[E] formule « toujours valider », par le blocage');
    await nettoyer();
    await niveau('minimal');
    await sql("insert into formule_overrides (formule_id, center_id, human_validation, removed, updated_at) values ('f4', 'libramont', 'required', false, now()) on conflict (formule_id, center_id) do update set human_validation = 'required'");
    await refreshFormuleOverrides(pool, { force: true });
    const toujours = await reserver({ date: J.vide, time: '15:00', pax: 8, formuleId: 'f4', name: 'F4 toujours' });
    ok(toujours.statut === 'staff_review' && toujours.staff === 1 && /toujours valider/.test(toujours.raison), '[E] validation, un mail, et la raison dite', JSON.stringify(toujours));

    // CONTRE-EPREUVE : le blocage qui confirmait tout, remis.
    const source = fs.readFileSync(path.join(ROOT, 'api/public-reservations.js'), 'utf8');
    const ancre = "validationStatus: decision.requise ? 'staff_review' : 'confirmed',";
    if (source.split(ancre).length !== 2) ok(false, '[contre-épreuve] ancre absente');
    else {
      const f = path.join(os.tmpdir(), `public-reservations-mute-${process.pid}.js`);
      fs.writeFileSync(f, source.replace(ancre, "validationStatus: 'confirmed',").split("require('../").join(`require('${ROOT.split(path.sep).join('/')}/`));
      const mute = require(f);
      fs.unlinkSync(f);
      await nettoyer();
      const avantCorrection = await reserver({ date: J.vide, time: '15:00', pax: 8, formuleId: 'f4', name: 'F4 mutant' }, mute);
      ok(avantCorrection.statut === 'confirmed', '[contre-épreuve] le blocage qui confirme tout, remis : [E] rougit', avantCorrection.statut);
    }

    console.log('[F] comptoir');
    await nettoyer();
    await niveau('prudent');
    await appel(staffApi, { url: '/api/staff-reservations', body: { centerId: 'libramont', name: 'Comptoir A', phone: '+32470000101', email: 'comptoir.a@gate.example.org', date: J.plein, startTime: '18:00', pax: 10, type: 'visite', program: [{ activityId: 'laser_game', games: 1 }], channel: 'staff' } });
    const c = await appel(staffApi, { url: '/api/staff-reservations', body: { centerId: 'libramont', name: 'Comptoir B', phone: '+32470000102', email: 'comptoir.b@gate.example.org', date: J.plein, startTime: '18:00', pax: 8, type: 'visite', program: [{ activityId: 'laser_game', games: 1 }], channel: 'staff' } });
    const resC = c.body && c.body.reservation;
    const mailsC = resC ? await sql("select template_id from communications where reservation_id = $1 and template_id = 'staff_review_request'", [resC.id]) : [];
    ok(resC && resC.validationStatus === 'confirmed' && mailsC.length === 0, '[F] meme en Prudent, un partage saisi au comptoir : confirme, aucun mail', resC && resC.validationStatus);
    ok(resC && resC.opsPlan && resC.opsPlan.validation && resC.opsPlan.validation.aSurveiller.some((x) => x.id === 'laser_partage'), '[F] le partage reste visible « a surveiller » sur la fiche');

    console.log('[G] rien d interne dans les reponses publiques');
    ok(fuites.length === 0, '[G] heures, blocage et confirmation sans la decision interne', fuites.join(', '));
  } finally {
    await nettoyer();
    await cc.saveCenterConfigOverride(pool, 'libramont', { validationEquipe: reglageAvant || { niveau: 'minimal', situations: {} } });
    if (f4Avant) await sql("update formule_overrides set human_validation = $1 where formule_id = 'f4' and center_id = 'libramont'", [f4Avant.human_validation]);
    else await sql("delete from formule_overrides where formule_id = 'f4' and center_id = 'libramont' and name is null and price_value is null and price_old is null and enabled is null and removed = false and sort_index is null");
  }
  console.log('');
  console.log(failures ? `validation-situations-reelles-check: ${failures} FAIL` : 'validation-situations-reelles-check: ALL OK (niveaux, interrupteur, formule par le blocage, comptoir, aucune fuite publique ; 1 contre-epreuve)');
  process.exit(failures ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });

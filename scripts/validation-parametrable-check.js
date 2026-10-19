// LA VALIDATION PAR L EQUIPE SE REGLE PAR CENTRE, ET LE MOTEUR LA SUIT (2026-10-05).
//
// Movsar : les mails « à valider » doivent partir « seulement quand c est quasi
// vraiment impossible », puis « l idee c est de pouvoir rendre ca parametrable
// completement cote produit ». Mesure avant correction, sur de vraies
// reservations en ligne : la FORMULE 4 partait en validation 3 fois sur 3 (mail
// a l accueil, simple « demande recue » au client), la 2 et la 5 des que
// l arene laser etait partagee.
//
// CE QUE CE GATE PROUVE, SUR UNE VRAIE BASE POSTGRES ET LES VRAIS HANDLERS
// (api/public-availability puis api/public-reservations, le parcours exact du
// formulaire : on demande les heures, on reserve avec la reponse du serveur) :
//   [A] reglage du centre « seulement si impossible » : F4 confirmee, aucun
//       mail staff, le client recoit « confirmation » ;
//   [B] le meme centre repasse la F4 en « toujours » depuis Tarifs & formules
//       (upsertClientFormuleOverride, le chemin de l ecran) : la F4 suivante
//       part en validation, un mail staff, « demande recue » au client ;
//   [C] « si l arene laser est partagee » : F5 seule dans l arene confirmee,
//       F5 qui partage l arene en validation ;
//   [D] effacer le reglage du centre (null) : la formule reprend le mode du
//       catalogue (F4 = « toujours » dans le socle) ;
//   [E] un autre centre n est jamais touche par le reglage d un centre ;
//   [F] mode inconnu refuse ; le centre ne peut pas ecrire la portee « all » ;
//   [G] une base SANS la colonne (migration pas encore jouee) : le catalogue se
//       lit quand meme, le mode retombe sur le catalogue, et regler la
//       validation dit clairement qu il faut migrer.
//
// SECURITE : refuse de tourner ailleurs que sur une base LOCALE (localhost ou
// socket), et n efface que ses propres journees de test.
//
// Usage : PINLANE_TEST_DATABASE_URL=postgres://...localhost.../base_de_test node scripts/validation-parametrable-check.js
'use strict';

const path = require('path');
const { Readable } = require('stream');
const ROOT = path.resolve(__dirname, '..');

// La base de ce gate se donne par sa PROPRE variable : un poste qui porte la
// DATABASE_URL de production (celui qui lance db:migrate) saute ce gate au lieu
// de le voir refuser, et test:ops:all reste vert sans base locale.
if (!process.env.PINLANE_TEST_DATABASE_URL) {
  console.log('validation-parametrable-check: SAUTE (PINLANE_TEST_DATABASE_URL absent : ce gate a besoin d une base Postgres locale)');
  console.log('GATE-SAUTE PINLANE_TEST_DATABASE_URL absent');
  process.exit(0);
}
process.env.DATABASE_URL = process.env.PINLANE_TEST_DATABASE_URL;
const urlBase = new URL(process.env.DATABASE_URL);
const locale = ['localhost', '127.0.0.1', ''].includes(urlBase.hostname) || /host=\//.test(process.env.DATABASE_URL);
if (!locale) {
  console.error('validation-parametrable-check: REFUSE, la base n est pas locale (' + urlBase.hostname + ')');
  process.exit(1);
}
process.env.DATABASE_SSL = process.env.DATABASE_SSL || 'disable';
process.env.PINLANE_CALENDAR_SYNC = 'off';
process.env.STAFF_REVIEW_EMAIL = process.env.STAFF_REVIEW_EMAIL || 'accueil-staff@gate.example.org';
delete process.env.RESEND_API_KEY;

let failures = 0;
function ok(cond, label, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures += 1;
  return cond;
}

let ip = 20;
function appel(handler, { method = 'POST', url = '/', body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = Readable.from(body == null ? [] : [Buffer.from(JSON.stringify(body))]);
    req.method = method;
    req.url = url;
    ip += 1;
    // Une adresse par appel : le limiteur public (10/min) ne doit pas fausser la mesure.
    req.headers = { 'content-type': 'application/json', host: 'localhost', 'x-forwarded-for': `10.9.${Math.floor(ip / 250)}.${ip % 250}`, 'user-agent': 'gate' };
    req.socket = { remoteAddress: `10.8.${Math.floor(ip / 250)}.${ip % 250}` };
    const res = {
      statusCode: 200, h: {},
      setHeader(k, v) { this.h[k.toLowerCase()] = v; }, getHeader(k) { return this.h[k.toLowerCase()]; },
      writeHead(s, h) { this.statusCode = s; if (h) Object.assign(this.h, h); return this; },
      end(d) { let j = null; try { j = d ? JSON.parse(String(d)) : null; } catch (e) { j = String(d); } resolve({ status: this.statusCode, body: j }); },
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

const dispoApi = require(path.join(ROOT, 'api/public-availability.js'));
const publicApi = require(path.join(ROOT, 'api/public-reservations.js'));
const db = require(path.join(ROOT, 'lib/database.js'));
const overrides = require(path.join(ROOT, 'lib/catalog-overrides.js'));
const { refreshFormuleOverrides } = require(path.join(ROOT, 'lib/booking-config.js'));
const pool = db.getPool();
const sql = async (q, p = []) => (await pool.query(q, p)).rows;

// LE PARCOURS DU FORMULAIRE (assets/fungalaxy-booking.js) : les heures, puis la reservation.
async function reserver(o) {
  const centerId = o.centerId || 'libramont';
  const params = { centerId, date: o.date, pax: String(o.pax) };
  if (o.formuleId) { params.type = 'formule'; params.formuleId = o.formuleId; } else {
    params.type = 'visite'; params.program = JSON.stringify(o.program); params.softReserve = '1';
    params.preferredTimes = JSON.stringify({ [o.program[0].activityId]: o.time });
  }
  const d = await appel(dispoApi, { method: 'GET', url: '/api/public-availability?' + new URLSearchParams(params).toString() });
  if (d.status !== 200 || !d.body || !d.body.ok) return { status: d.status, body: d.body, etape: 'heures' };
  const rep = d.body;
  const slot = o.formuleId ? (rep.slots || []).find((s) => s.time === o.time) : (rep.slots || [])[0];
  if (!slot) return { status: 0, etape: 'heure', heures: (rep.slots || []).map((s) => s.time) };
  const price = slot.price != null ? slot.price : rep.price;
  const body = {
    centerId, name: o.name, phone: '+3247055' + String(1000 + ip).slice(-4), email: o.name.toLowerCase().replace(/[^a-z0-9]+/g, '.') + '@gate.example.org',
    date: o.date, startTime: slot.time, pax: o.pax, companions: 0, channel: 'public', occasion: '', sansOffres: false, notes: '',
    preference: { preferredTimes: o.formuleId ? {} : { [o.program[0].activityId]: o.time }, laserGameTimes: [], laserPlacement: 'scheduled', arrivalConfidence: 'normal' },
    price: Number(price) || 0, quotedPrice: Number(price) || 0, basePrice: Number(price) || 0,
    duration: Number(rep.duration) || 1, totalDuration: Number(rep.totalDuration) || Number(rep.duration) || 1,
    laneCount: Number(slot.laneCount || rep.laneCount) || 0, requiresLanes: Boolean(rep.requiresLanes), label: rep.label || '',
    ...(o.formuleId ? { type: 'formule', formuleId: o.formuleId } : { type: 'visite', program: o.program }),
    ...(slot.lanes ? { lanes: slot.lanes } : {}), ...(slot.opsPlan ? { opsPlan: slot.opsPlan } : {}),
  };
  const r = await appel(publicApi, { url: '/api/public-reservations', body });
  const res = r.body && r.body.reservation;
  const mails = res ? await sql('select template_id from communications where reservation_id = $1', [res.id]) : [];
  return {
    status: r.status, res, message: r.body && r.body.message,
    staff: mails.filter((m) => m.template_id === 'staff_review_request').length,
    client: mails.map((m) => m.template_id).filter((t) => t === 'confirmation' || t === 'request_received').join('+'),
  };
}

// Des samedis de test, hors conges scolaires wallons, loin dans le futur proche.
const JOURS = ['2026-11-07', '2026-11-14', '2026-11-21', '2026-11-28'];
const CENTRE = 'libramont';
const AUTRE = 'gembloux';
async function nettoyer() {
  for (const j of JOURS) {
    await sql('delete from communications where reservation_id in (select id from reservations where date = $1 and email like $2)', [j, '%@gate.example.org']).catch(() => {});
    await sql('delete from reservations where date = $1 and email like $2', [j, '%@gate.example.org']);
  }
}
async function regler(centre, formuleId, mode) {
  const out = await overrides.upsertClientFormuleOverride(pool, { formuleId, centerId: centre, patch: { humanValidation: mode } });
  await refreshFormuleOverrides(pool, { force: true });
  return out;
}

(async () => {
  const colonne = await sql("select 1 from information_schema.columns where table_name = 'formule_overrides' and column_name = 'human_validation'");
  if (!colonne.length) {
    console.error('validation-parametrable-check: la base n a pas la colonne human_validation (npm run db:migrate)');
    process.exit(1);
  }
  // L etat de depart de chaque reglage touche, remis a la fin.
  const avant = await sql("select formule_id, center_id, human_validation from formule_overrides where formule_id in ('f4','f5') and center_id in ($1, $2)", [CENTRE, AUTRE]);
  await nettoyer();
  try {
    console.log('[A] « seulement si impossible »');
    await regler(CENTRE, 'f4', 'recommended');
    const a = await reserver({ date: JOURS[0], time: '15:00', pax: 8, formuleId: 'f4', name: 'Gate A F4' });
    ok(a.status === 201 && a.res && a.res.validationStatus === 'confirmed', '[A] F4 confirmee', `${a.status} ${a.res && a.res.validationStatus}`);
    ok(a.staff === 0 && a.client === 'confirmation', '[A] aucun mail staff, le client recoit sa confirmation', `staff ${a.staff}, client ${a.client}`);

    console.log('[B] le centre repasse la F4 en « toujours »');
    await regler(CENTRE, 'f4', 'required');
    const b = await reserver({ date: JOURS[0], time: '11:00', pax: 8, formuleId: 'f4', name: 'Gate B F4' });
    ok(b.status === 201 && b.res && b.res.validationStatus === 'staff_review', '[B] F4 en validation', `${b.status} ${b.res && b.res.validationStatus}`);
    ok(b.staff === 1 && b.client === 'request_received', '[B] un mail staff, « demande recue » au client', `staff ${b.staff}, client ${b.client}`);

    console.log('[C] « si l arene laser est partagee »');
    await regler(CENTRE, 'f5', 'required_when_laser_busy');
    const seule = await reserver({ date: JOURS[1], time: '19:00', pax: 8, formuleId: 'f5', name: 'Gate C F5 seule' });
    ok(seule.status === 201 && seule.res && seule.res.validationStatus === 'confirmed' && seule.staff === 0, '[C] F5 seule dans l arene : confirmee, aucun mail', `${seule.status} ${seule.res && seule.res.validationStatus} staff ${seule.staff}`);
    const groupe = await reserver({ date: JOURS[1], time: '15:00', pax: 10, program: [{ activityId: 'laser_game', games: 1 }], name: 'Gate C groupe laser' });
    ok(groupe.status === 201, '[C] montage : un groupe occupe l arene a 15:00', String(groupe.status));
    const partage = await reserver({ date: JOURS[1], time: '15:00', pax: 8, formuleId: 'f5', name: 'Gate C F5 partage' });
    const partagee = partage.res && (partage.res.opsPlan && partage.res.opsPlan.resourceBlocks || []).some((x) => x.resourceType === 'laser_arena' && (Number(x.playersBefore) > 0 || x.sharedSession));
    ok(partagee, '[C] montage : la F5 partage bien l arene', JSON.stringify(partage.res && partage.res.opsPlan && partage.res.opsPlan.resourceBlocks && partage.res.opsPlan.resourceBlocks.filter((x) => x.resourceType === 'laser_arena').map((x) => [x.startTime, x.playersBefore])));
    ok(partage.res && partage.res.validationStatus === 'staff_review' && partage.staff === 1, '[C] F5 qui partage l arene : en validation, un mail staff', `${partage.res && partage.res.validationStatus} staff ${partage.staff}`);
    await regler(CENTRE, 'f5', 'recommended');
    const partage2 = await reserver({ date: JOURS[1], time: '15:00', pax: 6, formuleId: 'f5', name: 'Gate C F5 partage reglee' });
    ok(partage2.res && partage2.res.validationStatus === 'confirmed' && partage2.staff === 0, '[C] la meme situation en « seulement si impossible » : confirmee, aucun mail', `${partage2.status} ${partage2.res && partage2.res.validationStatus} staff ${partage2.staff}`);

    console.log('[D] reglage efface : retour au catalogue');
    await regler(CENTRE, 'f4', null);
    const d = await reserver({ date: JOURS[2], time: '15:00', pax: 8, formuleId: 'f4', name: 'Gate D F4' });
    const socle = require(path.join(ROOT, 'lib/ops-knowledge.js')).getFormula('f4', CENTRE);
    const attendu = String((socle && socle.humanValidation) || 'recommended') === 'required' ? 'staff_review' : 'confirmed';
    ok(d.res && d.res.validationStatus === attendu, '[D] sans reglage du centre, la F4 suit le catalogue (' + ((socle && socle.humanValidation) || 'recommended') + ')', `${d.res && d.res.validationStatus}`);

    console.log('[E] un centre ne touche pas l autre');
    await regler(CENTRE, 'f4', 'required');
    await regler(AUTRE, 'f4', 'recommended');
    const e = await reserver({ centerId: AUTRE, date: JOURS[3], time: '15:00', pax: 8, formuleId: 'f4', name: 'Gate E F4 autre' });
    ok(e.res && e.res.validationStatus === 'confirmed' && e.staff === 0, '[E] Gembloux en « seulement si impossible » pendant que Libramont est en « toujours »', `${e.status} ${e.res && e.res.validationStatus} ${e.message || ''}`);
    const vue = await overrides.buildClientCatalog(pool, CENTRE);
    const f4 = vue.formulas.find((f) => f.id === 'f4');
    ok(f4 && f4.effective.humanValidation === 'required' && f4.centerOverride && f4.centerOverride.humanValidation === 'required', '[E] l ecran Tarifs lit le reglage du centre', JSON.stringify(f4 && { eff: f4.effective.humanValidation, own: f4.centerOverride }));

    console.log('[F] gardes');
    let refus = '';
    try { await overrides.upsertClientFormuleOverride(pool, { formuleId: 'f4', centerId: CENTRE, patch: { humanValidation: 'jamais' } }); } catch (err) { refus = err.message; }
    ok(/inconnu/i.test(refus), '[F] un mode inconnu est refuse', refus);
    refus = '';
    try { await overrides.upsertClientFormuleOverride(pool, { formuleId: 'f4', centerId: 'all', patch: { humanValidation: 'recommended' } }); } catch (err) { refus = err.message; }
    ok(/global/i.test(refus), '[F] un centre ne regle pas la portee commune', refus);
  } finally {
    // Remise en etat : les reglages d avant, et aucune reservation de test.
    for (const centre of [CENTRE, AUTRE]) for (const f of ['f4', 'f5']) {
      const ligne = avant.find((x) => x.center_id === centre && x.formule_id === f);
      await sql('update formule_overrides set human_validation = $3 where formule_id = $1 and center_id = $2', [f, centre, ligne ? ligne.human_validation : null]).catch(() => {});
    }
    await nettoyer();
  }

  console.log('[G] une base sans la colonne');
  // Un faux pool qui repond comme une base pas encore migree.
  const vieux = {
    query: async (q, p) => {
      if (/human_validation/.test(q)) { const e = new Error('column "human_validation" does not exist'); e.code = '42703'; throw e; }
      if (/^\s*select/i.test(q)) return { rows: [{ formule_id: 'f4', center_id: CENTRE, name: null, price_value: 41, price_old: null, enabled: null, removed: false, sort_index: null }] };
      return { rows: [{ formule_id: 'f4', center_id: CENTRE, name: null, price_value: 41, price_old: null, enabled: null, removed: false, sort_index: null }] };
    },
  };
  delete require.cache[require.resolve(path.join(ROOT, 'lib/catalog-overrides.js'))];
  const neuf = require(path.join(ROOT, 'lib/catalog-overrides.js'));
  const carte = await neuf.loadFormuleOverrides(vieux);
  const ligne = carte.get(`f4|${CENTRE}`);
  ok(ligne && ligne.priceValue === 41 && ligne.humanValidation === null, '[G] la carte des surcharges se lit sans la colonne (prix garde, mode du catalogue)', JSON.stringify(ligne));
  let message = '';
  try { await neuf.upsertClientFormuleOverride(vieux, { formuleId: 'f4', centerId: CENTRE, patch: { humanValidation: 'recommended' } }); } catch (err) { message = err.message; }
  ok(/db:migrate/.test(message), '[G] regler la validation dit qu il faut migrer', message);
  const prix = await neuf.upsertClientFormuleOverride(vieux, { formuleId: 'f4', centerId: CENTRE, patch: { priceValue: 41 } });
  ok(prix && prix.priceValue === 41, '[G] un prix s enregistre toujours, comme avant', JSON.stringify(prix));
  // La migration est jouee PENDANT que la fonction tourne : une minute plus
  // tard, la colonne est redemandee et le reglage passe, sans redemarrage.
  const migre = {
    query: async (q) => {
      const ligneMigree = { formule_id: 'f4', center_id: CENTRE, name: null, price_value: 41, price_old: null, enabled: null, removed: false, sort_index: null, human_validation: 'recommended' };
      return { rows: [ligneMigree] };
    },
  };
  const maintenant = Date.now;
  Date.now = () => maintenant() + 61 * 1000;
  let apres = null;
  try { apres = await neuf.upsertClientFormuleOverride(migre, { formuleId: 'f4', centerId: CENTRE, patch: { humanValidation: 'recommended' } }); } catch (err) { apres = { erreur: err.message }; }
  Date.now = maintenant;
  ok(apres && apres.humanValidation === 'recommended', '[G] migration jouee en cours de route : le reglage passe une minute apres, sans redemarrage', JSON.stringify(apres));

  await pool.end().catch(() => {});
  console.log('');
  console.log(failures ? `validation-parametrable-check: ${failures} FAIL` : 'validation-parametrable-check: ALL OK (reglage par centre suivi par le moteur, les mails et l ecran ; base ancienne toleree)');
  process.exit(failures ? 1 : 0);
})().catch(async (error) => {
  console.error(error);
  await pool.end().catch(() => {});
  process.exit(1);
});
